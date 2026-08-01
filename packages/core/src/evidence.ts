import type {
  EvidenceDraft,
  EvidenceRequirement,
  PersistedEvidence,
} from './domain.js';

const STRENGTH_RANK = {
  WEAK: 0,
  MEDIUM: 1,
  STRONG: 2,
} as const;

export interface EvidenceValidation {
  readonly ok: boolean;
  readonly code: string | null;
}

export function validateExecutionEvidence(
  evidence: readonly (EvidenceDraft | PersistedEvidence)[],
  requirement: EvidenceRequirement,
  executorRef: string,
): EvidenceValidation {
  const executionEvidence = evidence.filter(
    (item) => item.purpose === 'EXECUTION',
  );

  if (executionEvidence.length === 0) {
    return { ok: false, code: 'NO_EXECUTION_EVIDENCE' };
  }

  const matches = executionEvidence.some((item) => {
    const acceptedType =
      requirement.types.length === 0 || requirement.types.includes(item.type);
    const acceptedStrength =
      STRENGTH_RANK[item.strength] >=
      STRENGTH_RANK[requirement.minimumStrength];
    const acceptedProducer =
      !requirement.producerMustMatchExecutor || item.producer === executorRef;
    const acceptedHash =
      requirement.contentHashPrefix === undefined ||
      (item.contentHash?.startsWith(requirement.contentHashPrefix) ?? false);

    return acceptedType && acceptedStrength && acceptedProducer && acceptedHash;
  });

  return matches
    ? { ok: true, code: null }
    : { ok: false, code: 'EVIDENCE_REQUIREMENT_NOT_SATISFIED' };
}
