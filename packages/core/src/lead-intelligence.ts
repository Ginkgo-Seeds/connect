export type ContactStatus = 'VALID' | 'INVALID' | 'UNKNOWN' | 'NOT_CHECKED';
export type LeadBand = 'HOT' | 'GOOD' | 'MEDIUM' | 'LOW';

export interface LeadSourceRef {
  readonly sourceId: string;
  readonly policyEligible: boolean;
  readonly policyDecisionRef?: string | undefined;
  readonly sourceRecordId?: string | undefined;
  readonly sourceUrl?: string | undefined;
  readonly evidenceRef?: string | undefined;
}

export interface ObservedSignal {
  readonly value: boolean;
  readonly evidenceRef: string;
}

export interface LeadObservedSignals {
  readonly commercialFit?: ObservedSignal | undefined;
  readonly digitalPresence?: ObservedSignal | undefined;
  readonly operationalScale?: ObservedSignal | undefined;
  readonly automationOpportunity?: ObservedSignal | undefined;
}

export interface WhatsAppValidationEvidence {
  readonly status: Exclude<ContactStatus, 'NOT_CHECKED'>;
  readonly method: string;
  readonly conclusive: boolean;
  readonly evidenceRef?: string | undefined;
}

export interface LeadCandidate {
  readonly name: string;
  readonly city?: string | undefined;
  readonly state?: string | undefined;
  readonly phoneRaw?: string | undefined;
  readonly website?: string | undefined;
  readonly domain?: string | undefined;
  readonly categories?: readonly string[] | undefined;
  readonly rating?: number | undefined;
  readonly reviewCount?: number | undefined;
  readonly source: LeadSourceRef;
  readonly signals?: LeadObservedSignals | undefined;
  readonly whatsappEvidence?: WhatsAppValidationEvidence | undefined;
}

export interface NormalizedLead {
  readonly canonicalName: string;
  readonly displayName: string;
  readonly city?: string | undefined;
  readonly state?: string | undefined;
  readonly phoneRaw?: string | undefined;
  readonly phoneE164?: string | undefined;
  readonly phoneStatus: ContactStatus;
  readonly whatsappStatus: ContactStatus;
  readonly whatsappEvidence?: WhatsAppValidationEvidence | undefined;
  readonly website?: string | undefined;
  readonly domain?: string | undefined;
  readonly categories: readonly string[];
  readonly rating?: number | undefined;
  readonly reviewCount?: number | undefined;
  readonly sourceRefs: readonly LeadSourceRef[];
  readonly signals?: LeadObservedSignals | undefined;
}

export interface LeadQualification {
  readonly score: number;
  readonly band: LeadBand;
  readonly components: Readonly<{
    commercialFit: number;
    digitalPresence: number;
    operationalScale: number;
    automationOpportunity: number;
    dataQuality: number;
  }>;
  readonly evidenceRefs: readonly string[];
}

export interface LeadBatchPolicy {
  readonly targetAcceptedLeads: number;
  readonly minimumScore: number;
  readonly acceptedBands?: readonly LeadBand[] | undefined;
  readonly requirePhone?: boolean | undefined;
  readonly requireWhatsapp?: boolean | undefined;
}

export interface QualifiedLead {
  readonly lead: NormalizedLead;
  readonly qualification: LeadQualification;
}

export interface RejectedLead {
  readonly lead: NormalizedLead;
  readonly reasons: readonly string[];
}

export interface LeadBatchResult {
  readonly rawResults: number;
  readonly normalizedResults: number;
  readonly duplicatesRemoved: number;
  readonly accepted: readonly QualifiedLead[];
  readonly rejected: readonly RejectedLead[];
  readonly targetAcceptedLeads: number;
  readonly targetReached: boolean;
  readonly status: 'TARGET_REACHED' | 'PARTIAL_EXHAUSTED';
}

const CONCLUSIVE_WHATSAPP_METHODS = new Set([
  'official_api',
  'provider_explicit_status',
  'manual_verified_attestation',
]);

function cleanText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function canonicalizeLeadName(value: string): string {
  return cleanText(value);
}

export function canonicalizeDomain(value?: string): string | undefined {
  if (!value) return undefined;

  const candidate = value.trim().toLowerCase();
  if (!candidate) return undefined;

  try {
    const url = candidate.includes('://')
      ? new URL(candidate)
      : new URL(`https://${candidate}`);
    return url.hostname.replace(/^www\./, '') || undefined;
  } catch {
    return undefined;
  }
}

export function normalizeBrazilianPhone(value?: string): string | undefined {
  if (!value) return undefined;

  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+') && !digits.startsWith('55')) return undefined;
  if (digits.startsWith('00')) return undefined;

  const national =
    digits.startsWith('55') && (digits.length === 12 || digits.length === 13)
      ? digits.slice(2)
      : digits.length === 10 || digits.length === 11
        ? digits
        : undefined;

  if (!national) return undefined;

  const ddd = Number(national.slice(0, 2));
  const subscriber = national.slice(2);
  if (ddd < 11 || ddd > 99 || /^0/.test(subscriber)) return undefined;

  return `+55${national}`;
}

export function resolveWhatsAppStatus(
  evidence?: WhatsAppValidationEvidence,
): ContactStatus {
  if (!evidence) return 'UNKNOWN';
  if (!evidence.conclusive) return 'UNKNOWN';
  if (!CONCLUSIVE_WHATSAPP_METHODS.has(evidence.method)) return 'UNKNOWN';
  return evidence.status;
}

export function normalizeLead(candidate: LeadCandidate): NormalizedLead {
  const phoneE164 = normalizeBrazilianPhone(candidate.phoneRaw);
  const domain = canonicalizeDomain(candidate.domain ?? candidate.website);

  return {
    canonicalName: canonicalizeLeadName(candidate.name),
    displayName: candidate.name.trim(),
    city: candidate.city?.trim() || undefined,
    state: candidate.state?.trim().toUpperCase() || undefined,
    phoneRaw: candidate.phoneRaw,
    phoneE164,
    phoneStatus: candidate.phoneRaw ? (phoneE164 ? 'VALID' : 'INVALID') : 'UNKNOWN',
    whatsappStatus: resolveWhatsAppStatus(candidate.whatsappEvidence),
    whatsappEvidence: candidate.whatsappEvidence,
    website: candidate.website?.trim() || undefined,
    domain,
    categories: candidate.categories ?? [],
    rating: candidate.rating,
    reviewCount: candidate.reviewCount,
    sourceRefs: [candidate.source],
    signals: candidate.signals,
  };
}

function signalScore(
  signal: ObservedSignal | undefined,
  points: number,
  evidence: string[],
): number {
  if (!signal?.value) return 0;
  evidence.push(signal.evidenceRef);
  return points;
}

export function qualifyLead(lead: NormalizedLead): LeadQualification {
  const evidenceRefs: string[] = [];
  const commercialFit = signalScore(
    lead.signals?.commercialFit,
    30,
    evidenceRefs,
  );
  const digitalPresence = signalScore(
    lead.signals?.digitalPresence,
    15,
    evidenceRefs,
  );
  const operationalScale = signalScore(
    lead.signals?.operationalScale,
    20,
    evidenceRefs,
  );
  const automationOpportunity = signalScore(
    lead.signals?.automationOpportunity,
    25,
    evidenceRefs,
  );

  let dataQuality = 0;
  if (lead.phoneStatus === 'VALID') dataQuality += 4;
  if (lead.domain) dataQuality += 2;
  if (lead.city) dataQuality += 1;
  if (lead.categories.length > 0) dataQuality += 1;
  if (lead.sourceRefs.some((source) => source.evidenceRef)) dataQuality += 2;

  const score = Math.min(
    100,
    commercialFit +
      digitalPresence +
      operationalScale +
      automationOpportunity +
      dataQuality,
  );

  const band: LeadBand =
    score >= 80 ? 'HOT' : score >= 60 ? 'GOOD' : score >= 40 ? 'MEDIUM' : 'LOW';

  return {
    score,
    band,
    components: {
      commercialFit,
      digitalPresence,
      operationalScale,
      automationOpportunity,
      dataQuality,
    },
    evidenceRefs,
  };
}

function leadKeys(lead: NormalizedLead): readonly string[] {
  const keys: string[] = [];

  for (const source of lead.sourceRefs) {
    if (source.sourceRecordId) {
      keys.push(`source:${source.sourceId}:${source.sourceRecordId}`);
    }
  }
  if (lead.phoneE164) keys.push(`phone:${lead.phoneE164}`);
  if (lead.domain) keys.push(`domain:${lead.domain}`);
  if (lead.canonicalName && lead.city) {
    keys.push(`name-city:${lead.canonicalName}:${cleanText(lead.city)}`);
  }

  return keys;
}

function mergeSignals(
  primary?: LeadObservedSignals,
  duplicate?: LeadObservedSignals,
): LeadObservedSignals | undefined {
  if (!primary && !duplicate) return undefined;
  return {
    commercialFit: primary?.commercialFit ?? duplicate?.commercialFit,
    digitalPresence: primary?.digitalPresence ?? duplicate?.digitalPresence,
    operationalScale: primary?.operationalScale ?? duplicate?.operationalScale,
    automationOpportunity:
      primary?.automationOpportunity ?? duplicate?.automationOpportunity,
  };
}

function contactStatusRank(status: ContactStatus): number {
  switch (status) {
    case 'VALID':
      return 4;
    case 'INVALID':
      return 3;
    case 'UNKNOWN':
      return 2;
    case 'NOT_CHECKED':
      return 1;
  }
}

function preferContactStatus(
  primary: ContactStatus,
  duplicate: ContactStatus,
): ContactStatus {
  return contactStatusRank(primary) >= contactStatusRank(duplicate)
    ? primary
    : duplicate;
}

function mergeLead(primary: NormalizedLead, duplicate: NormalizedLead): NormalizedLead {
  const sourceMap = new Map<string, LeadSourceRef>();
  for (const source of [...primary.sourceRefs, ...duplicate.sourceRefs]) {
    const key = `${source.sourceId}:${source.sourceRecordId ?? source.sourceUrl ?? source.evidenceRef ?? ''}`;
    sourceMap.set(key, source);
  }

  const preferredWhatsapp =
    contactStatusRank(primary.whatsappStatus) >=
    contactStatusRank(duplicate.whatsappStatus)
      ? primary
      : duplicate;

  return {
    ...primary,
    phoneRaw: primary.phoneRaw ?? duplicate.phoneRaw,
    phoneE164: primary.phoneE164 ?? duplicate.phoneE164,
    phoneStatus: preferContactStatus(primary.phoneStatus, duplicate.phoneStatus),
    whatsappStatus: preferContactStatus(
      primary.whatsappStatus,
      duplicate.whatsappStatus,
    ),
    whatsappEvidence: preferredWhatsapp.whatsappEvidence,
    website: primary.website ?? duplicate.website,
    domain: primary.domain ?? duplicate.domain,
    city: primary.city ?? duplicate.city,
    state: primary.state ?? duplicate.state,
    categories: [...new Set([...primary.categories, ...duplicate.categories])],
    rating: primary.rating ?? duplicate.rating,
    reviewCount:
      Math.max(primary.reviewCount ?? 0, duplicate.reviewCount ?? 0) || undefined,
    sourceRefs: [...sourceMap.values()],
    signals: mergeSignals(primary.signals, duplicate.signals),
  };
}

export function deduplicateLeads(
  leads: readonly NormalizedLead[],
): readonly NormalizedLead[] {
  const unique: NormalizedLead[] = [];
  const keyOwner = new Map<string, number>();

  for (const lead of leads) {
    const keys = leadKeys(lead);
    const owner = keys
      .map((key) => keyOwner.get(key))
      .find((index): index is number => index !== undefined);

    if (owner === undefined) {
      const index = unique.length;
      unique.push(lead);
      for (const key of keys) keyOwner.set(key, index);
      continue;
    }

    const merged = mergeLead(unique[owner]!, lead);
    unique[owner] = merged;
    for (const key of leadKeys(merged)) keyOwner.set(key, owner);
  }

  return unique;
}

export function buildLeadBatch(
  candidates: readonly LeadCandidate[],
  policy: LeadBatchPolicy,
): LeadBatchResult {
  if (!Number.isInteger(policy.targetAcceptedLeads) || policy.targetAcceptedLeads < 1) {
    throw new Error('targetAcceptedLeads must be a positive integer');
  }
  if (policy.minimumScore < 0 || policy.minimumScore > 100) {
    throw new Error('minimumScore must be between 0 and 100');
  }

  const normalized = candidates.map(normalizeLead);
  const unique = deduplicateLeads(normalized);
  const acceptedBands = new Set(policy.acceptedBands ?? ['HOT', 'GOOD']);
  const accepted: QualifiedLead[] = [];
  const rejected: RejectedLead[] = [];

  for (const lead of unique) {
    const reasons: string[] = [];
    const qualification = qualifyLead(lead);

    if (!lead.sourceRefs.every((source) => source.policyEligible)) {
      reasons.push('SOURCE_POLICY_BLOCKED');
    }
    if (policy.requirePhone && lead.phoneStatus !== 'VALID') {
      reasons.push('PHONE_NOT_VALID');
    }
    if (policy.requireWhatsapp && lead.whatsappStatus !== 'VALID') {
      reasons.push('WHATSAPP_NOT_VALIDATED');
    }
    if (qualification.score < policy.minimumScore) {
      reasons.push('SCORE_BELOW_THRESHOLD');
    }
    if (!acceptedBands.has(qualification.band)) {
      reasons.push('BAND_NOT_ACCEPTED');
    }

    if (reasons.length === 0) {
      accepted.push({ lead, qualification });
    } else {
      rejected.push({ lead, reasons });
    }
  }

  const targetReached = accepted.length >= policy.targetAcceptedLeads;
  return {
    rawResults: candidates.length,
    normalizedResults: normalized.length,
    duplicatesRemoved: normalized.length - unique.length,
    accepted,
    rejected,
    targetAcceptedLeads: policy.targetAcceptedLeads,
    targetReached,
    status: targetReached ? 'TARGET_REACHED' : 'PARTIAL_EXHAUSTED',
  };
}
