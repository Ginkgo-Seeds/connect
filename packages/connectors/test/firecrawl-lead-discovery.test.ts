import { normalizeLead } from '@connect/core';
import { describe, expect, it, vi } from 'vitest';

import {
  FirecrawlLeadDiscoveryAdapter,
  SourcePolicyBlockedError,
  type FirecrawlLeadTransport,
} from '../src/index.js';

describe('FirecrawlLeadDiscoveryAdapter', () => {
  it('maps legitimately collected Firecrawl lead records into factual candidates', async () => {
    const transport: FirecrawlLeadTransport = {
      collectLeads: vi.fn().mockResolvedValue({
        evidenceReference: 'firecrawl:fixture:run-1',
        records: [
          {
            recordId: 'company-1',
            company: 'Acme Automacao',
            companyUrl: 'https://acme.example.com',
            city: 'Curitiba',
            state: 'PR',
            phone: '(41) 99999-0000',
            industry: 'automation software',
            companySize: '11-50',
            sourceUrl: 'https://directory.example/acme',
          },
        ],
      }),
    };
    const adapter = new FirecrawlLeadDiscoveryAdapter(transport, {
      sourceId: 'firecrawl-public-web',
      policyEligible: true,
      policyDecisionRef: 'policy:lead-source:firecrawl-public-web:v1',
    });

    const result = await adapter.discover({
      target: 'automation companies in Curitiba',
      maxLeads: 20,
    });

    expect(result).toEqual([
      expect.objectContaining({
        name: 'Acme Automacao',
        city: 'Curitiba',
        state: 'PR',
        phoneRaw: '(41) 99999-0000',
        website: 'https://acme.example.com',
        categories: ['automation software', '11-50'],
        source: expect.objectContaining({
          sourceId: 'firecrawl-public-web',
          sourceRecordId: 'company-1',
          policyEligible: true,
          evidenceRef: 'firecrawl:fixture:run-1#record-1',
        }),
      }),
    ]);

    const normalized = normalizeLead(result[0]!);
    expect(normalized.phoneStatus).toBe('VALID');
    expect(normalized.whatsappStatus).toBe('UNKNOWN');
    expect(normalized.signals).toBeUndefined();
  });

  it('fails closed before collection when the source policy is blocked', async () => {
    const collectLeads = vi.fn();
    const adapter = new FirecrawlLeadDiscoveryAdapter(
      { collectLeads },
      {
        sourceId: 'unreviewed-directory',
        policyEligible: false,
        policyDecisionRef: 'policy:blocked',
      },
    );

    await expect(
      adapter.discover({ target: 'software companies', maxLeads: 10 }),
    ).rejects.toBeInstanceOf(SourcePolicyBlockedError);
    expect(collectLeads).not.toHaveBeenCalled();
  });

  it('drops unusable records instead of fabricating a company identity', async () => {
    const adapter = new FirecrawlLeadDiscoveryAdapter(
      {
        collectLeads: vi.fn().mockResolvedValue({
          evidenceReference: 'firecrawl:fixture:run-2',
          records: [{ phone: '(11) 98888-7777', notes: 'name missing' }],
        }),
      },
      {
        sourceId: 'firecrawl-public-web',
        policyEligible: true,
        policyDecisionRef: 'policy:lead-source:firecrawl-public-web:v1',
      },
    );

    await expect(
      adapter.discover({ target: 'software companies', maxLeads: 10 }),
    ).resolves.toEqual([]);
  });

  it.each([
    [{ target: '', maxLeads: 10 }, 'target must not be empty'],
    [{ target: 'software', maxLeads: 0 }, 'maxLeads must be a positive integer'],
  ])('validates adapter input before transport execution', async (request, message) => {
    const collectLeads = vi.fn();
    const adapter = new FirecrawlLeadDiscoveryAdapter(
      { collectLeads },
      {
        sourceId: 'firecrawl-public-web',
        policyEligible: true,
        policyDecisionRef: 'policy:lead-source:firecrawl-public-web:v1',
      },
    );

    await expect(adapter.discover(request)).rejects.toThrow(message);
    expect(collectLeads).not.toHaveBeenCalled();
  });
});
