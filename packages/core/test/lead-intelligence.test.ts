import { describe, expect, it } from 'vitest';

import {
  buildLeadBatch,
  deduplicateLeads,
  normalizeBrazilianPhone,
  normalizeLead,
  qualifyLead,
  resolveWhatsAppStatus,
  type LeadCandidate,
} from '../src/index.js';

function candidate(overrides: Partial<LeadCandidate> = {}): LeadCandidate {
  return {
    name: 'Acme Automacao Ltda',
    city: 'Curitiba',
    state: 'PR',
    phoneRaw: '(41) 99999-0000',
    website: 'https://www.acme.example.com',
    categories: ['automacao', 'software'],
    source: {
      sourceId: 'fixture-directory',
      sourceRecordId: 'acme-1',
      sourceUrl: 'https://directory.example/acme',
      policyEligible: true,
      policyDecisionRef: 'policy:fixture-directory:v1',
      evidenceRef: 'evidence:source:acme-1',
    },
    signals: {
      commercialFit: { value: true, evidenceRef: 'evidence:fit' },
      digitalPresence: { value: true, evidenceRef: 'evidence:digital' },
      operationalScale: { value: true, evidenceRef: 'evidence:scale' },
      automationOpportunity: {
        value: true,
        evidenceRef: 'evidence:automation',
      },
    },
    ...overrides,
  };
}

describe('lead intelligence normalization', () => {
  it.each([
    ['(41) 99999-0000', '+5541999990000'],
    ['41 3256-1011', '+554132561011'],
    ['+55 (11) 98888-7777', '+5511988887777'],
  ])('normalizes Brazilian phone %s', (input, expected) => {
    expect(normalizeBrazilianPhone(input)).toBe(expected);
  });

  it.each(['123', '+1 415 555 0100', '00 0000-0000'])(
    'rejects malformed or non-Brazilian phone %s',
    (input) => {
      expect(normalizeBrazilianPhone(input)).toBeUndefined();
    },
  );

  it('does not treat wa.me navigation as conclusive WhatsApp evidence', () => {
    expect(
      resolveWhatsAppStatus({
        status: 'VALID',
        method: 'wa_me_navigation',
        conclusive: true,
        evidenceRef: 'browser:wa-me-opened',
      }),
    ).toBe('UNKNOWN');
  });

  it('accepts and retains approved conclusive WhatsApp evidence', () => {
    const evidence = {
      status: 'VALID' as const,
      method: 'provider_explicit_status',
      conclusive: true,
      evidenceRef: 'provider:status:123',
    };

    expect(resolveWhatsAppStatus(evidence)).toBe('VALID');
    expect(normalizeLead(candidate({ whatsappEvidence: evidence }))).toEqual(
      expect.objectContaining({
        whatsappStatus: 'VALID',
        whatsappEvidence: evidence,
      }),
    );
  });
});

describe('lead intelligence qualification', () => {
  it('scores only observed evidence-backed signals plus deterministic data quality', () => {
    const qualification = qualifyLead(normalizeLead(candidate()));

    expect(qualification.score).toBe(100);
    expect(qualification.band).toBe('HOT');
    expect(qualification.components).toEqual({
      commercialFit: 30,
      digitalPresence: 15,
      operationalScale: 20,
      automationOpportunity: 25,
      dataQuality: 10,
    });
    expect(qualification.evidenceRefs).toEqual([
      'evidence:fit',
      'evidence:digital',
      'evidence:scale',
      'evidence:automation',
    ]);
  });

  it('does not invent qualification points when signals are absent', () => {
    const qualification = qualifyLead(
      normalizeLead(candidate({ signals: undefined })),
    );

    expect(qualification.score).toBe(10);
    expect(qualification.band).toBe('LOW');
    expect(qualification.evidenceRefs).toEqual([]);
  });
});

describe('lead intelligence deduplication', () => {
  it('deduplicates by canonical phone/domain and preserves provenance', () => {
    const first = normalizeLead(candidate());
    const second = normalizeLead(
      candidate({
        name: 'ACME Automação',
        source: {
          sourceId: 'second-source',
          sourceRecordId: 'row-22',
          policyEligible: true,
          policyDecisionRef: 'policy:second-source:v1',
          evidenceRef: 'evidence:second',
        },
      }),
    );

    const result = deduplicateLeads([first, second]);

    expect(result).toHaveLength(1);
    expect(result[0]?.sourceRefs).toHaveLength(2);
  });

  it('does not wash blocked provenance through an eligible duplicate', () => {
    const result = buildLeadBatch(
      [
        candidate({
          source: {
            sourceId: 'blocked-source',
            sourceRecordId: 'blocked-acme',
            policyEligible: false,
            policyDecisionRef: 'policy:blocked',
            evidenceRef: 'evidence:blocked',
          },
        }),
        candidate({
          name: 'ACME Automação',
          source: {
            sourceId: 'allowed-source',
            sourceRecordId: 'allowed-acme',
            policyEligible: true,
            policyDecisionRef: 'policy:allowed',
            evidenceRef: 'evidence:allowed',
          },
        }),
      ],
      {
        targetAcceptedLeads: 1,
        minimumScore: 60,
        requirePhone: true,
      },
    );

    expect(result.duplicatesRemoved).toBe(1);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0]?.reasons).toContain('SOURCE_POLICY_BLOCKED');
  });
});

describe('lead batch acceptance gates', () => {
  it('keeps raw-result count separate from accepted-lead count', () => {
    const result = buildLeadBatch(
      [
        candidate({
          whatsappEvidence: {
            status: 'VALID',
            method: 'provider_explicit_status',
            conclusive: true,
            evidenceRef: 'wa:1',
          },
        }),
        candidate({
          name: 'Blocked Co',
          phoneRaw: '(11) 98888-1111',
          website: 'https://blocked.example',
          source: {
            sourceId: 'blocked-source',
            sourceRecordId: 'blocked-1',
            policyEligible: false,
            policyDecisionRef: 'policy:blocked',
            evidenceRef: 'blocked:evidence',
          },
          whatsappEvidence: {
            status: 'VALID',
            method: 'provider_explicit_status',
            conclusive: true,
            evidenceRef: 'wa:2',
          },
        }),
        candidate({
          name: 'Unknown WhatsApp Co',
          phoneRaw: '(21) 97777-2222',
          website: 'https://unknown.example',
          source: {
            sourceId: 'fixture-directory',
            sourceRecordId: 'unknown-1',
            policyEligible: true,
            policyDecisionRef: 'policy:fixture-directory:v1',
            evidenceRef: 'unknown:evidence',
          },
          whatsappEvidence: {
            status: 'VALID',
            method: 'wa_me_navigation',
            conclusive: true,
            evidenceRef: 'wa-me:opened',
          },
        }),
      ],
      {
        targetAcceptedLeads: 2,
        minimumScore: 60,
        requirePhone: true,
        requireWhatsapp: true,
      },
    );

    expect(result.rawResults).toBe(3);
    expect(result.accepted).toHaveLength(1);
    expect(result.targetReached).toBe(false);
    expect(result.status).toBe('PARTIAL_EXHAUSTED');
    expect(result.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasons: expect.arrayContaining(['SOURCE_POLICY_BLOCKED']),
        }),
        expect.objectContaining({
          reasons: expect.arrayContaining(['WHATSAPP_NOT_VALIDATED']),
        }),
      ]),
    );
  });

  it('returns TARGET_REACHED only from accepted unique leads', () => {
    const acceptedWhatsApp = {
      status: 'VALID' as const,
      method: 'provider_explicit_status',
      conclusive: true,
      evidenceRef: 'wa:valid',
    };

    const result = buildLeadBatch(
      [
        candidate({ whatsappEvidence: acceptedWhatsApp }),
        candidate({
          name: 'Beta Sistemas',
          phoneRaw: '(11) 97777-1000',
          website: 'https://beta.example',
          source: {
            sourceId: 'fixture-directory',
            sourceRecordId: 'beta-1',
            policyEligible: true,
            policyDecisionRef: 'policy:fixture-directory:v1',
            evidenceRef: 'evidence:beta',
          },
          whatsappEvidence: acceptedWhatsApp,
        }),
      ],
      {
        targetAcceptedLeads: 2,
        minimumScore: 60,
        requirePhone: true,
        requireWhatsapp: true,
      },
    );

    expect(result.accepted).toHaveLength(2);
    expect(result.targetReached).toBe(true);
    expect(result.status).toBe('TARGET_REACHED');
  });
});
