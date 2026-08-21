import type { LeadCandidate } from '@connect/core';

import type { ConnectorDescriptor } from './index.js';

export interface FirecrawlLeadDiscoveryRequest {
  readonly target: string;
  readonly maxLeads: number;
}

export interface FirecrawlLeadRecord {
  readonly recordId?: string | undefined;
  readonly name?: string | undefined;
  readonly title?: string | undefined;
  readonly company?: string | undefined;
  readonly companyUrl?: string | undefined;
  readonly city?: string | undefined;
  readonly state?: string | undefined;
  readonly location?: string | undefined;
  readonly phone?: string | undefined;
  readonly industry?: string | undefined;
  readonly companySize?: string | undefined;
  readonly fundingStage?: string | undefined;
  readonly profileUrl?: string | undefined;
  readonly sourceUrl?: string | undefined;
  readonly notes?: string | undefined;
}

export interface FirecrawlLeadCollectionResult {
  readonly records: readonly FirecrawlLeadRecord[];
  readonly evidenceReference: string;
}

export interface FirecrawlLeadTransport {
  collectLeads(
    request: FirecrawlLeadDiscoveryRequest,
  ): Promise<FirecrawlLeadCollectionResult>;
}

export interface FirecrawlLeadSourcePolicy {
  readonly sourceId: string;
  readonly policyEligible: boolean;
  readonly policyDecisionRef: string;
}

export class SourcePolicyBlockedError extends Error {
  public readonly code = 'SOURCE_POLICY_BLOCKED';

  public constructor(sourceId: string) {
    super(`Lead source is not policy-eligible: ${sourceId}`);
    this.name = 'SourcePolicyBlockedError';
  }
}

export const firecrawlLeadDiscoveryDescriptor: ConnectorDescriptor = {
  id: 'firecrawl.lead-discovery',
  operations: ['sales.lead.discover'],
  readOnly: true,
};

function nonEmpty(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function recordName(record: FirecrawlLeadRecord): string | undefined {
  return nonEmpty(record.company) ?? nonEmpty(record.name);
}

function recordSourceUrl(record: FirecrawlLeadRecord): string | undefined {
  return (
    nonEmpty(record.sourceUrl) ??
    nonEmpty(record.profileUrl) ??
    nonEmpty(record.companyUrl)
  );
}

export class FirecrawlLeadDiscoveryAdapter {
  public constructor(
    private readonly transport: FirecrawlLeadTransport,
    private readonly sourcePolicy: FirecrawlLeadSourcePolicy,
  ) {}

  public async discover(
    request: FirecrawlLeadDiscoveryRequest,
  ): Promise<readonly LeadCandidate[]> {
    if (!this.sourcePolicy.policyEligible) {
      throw new SourcePolicyBlockedError(this.sourcePolicy.sourceId);
    }
    if (!request.target.trim()) {
      throw new Error('target must not be empty');
    }
    if (!Number.isInteger(request.maxLeads) || request.maxLeads < 1) {
      throw new Error('maxLeads must be a positive integer');
    }

    const result = await this.transport.collectLeads(request);
    const candidates: LeadCandidate[] = [];

    for (const [index, record] of result.records.entries()) {
      const name = recordName(record);
      if (!name) continue;

      const categories = [
        nonEmpty(record.industry),
        nonEmpty(record.companySize),
        nonEmpty(record.fundingStage),
      ].filter((value): value is string => value !== undefined);
      const sourceUrl = recordSourceUrl(record);

      candidates.push({
        name,
        city: nonEmpty(record.city),
        state: nonEmpty(record.state),
        phoneRaw: nonEmpty(record.phone),
        website: nonEmpty(record.companyUrl),
        categories,
        source: {
          sourceId: this.sourcePolicy.sourceId,
          policyEligible: true,
          policyDecisionRef: this.sourcePolicy.policyDecisionRef,
          sourceRecordId: nonEmpty(record.recordId),
          sourceUrl,
          evidenceRef: `${result.evidenceReference}#record-${index + 1}`,
        },
      });
    }

    return candidates;
  }
}
