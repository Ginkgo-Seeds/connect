import type {
  Maturity,
  RiskLevel,
  TaskBlockReason,
  TaskState,
} from './states.js';

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface TrustedOrganizationContext {
  readonly organizationId: string;
  readonly actorRef: string;
  readonly actorScopes: readonly string[];
  readonly correlationId: string;
}

export interface CommandMetadata {
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface CreateTaskInput {
  readonly intent: string;
  readonly instruction?: string;
  readonly inputs: Readonly<Record<string, JsonValue>>;
  readonly riskLevel: RiskLevel;
  readonly maturity: Maturity;
  readonly supersedesTaskId?: string;
}

export interface Task {
  readonly id: string;
  readonly organizationId: string;
  readonly intent: string;
  readonly instruction: string | null;
  readonly inputs: Readonly<Record<string, JsonValue>>;
  readonly riskLevel: RiskLevel;
  readonly maturity: Maturity;
  readonly state: TaskState;
  readonly blockReason: TaskBlockReason | null;
  readonly version: number;
  readonly eventSequence: bigint;
  readonly correlationId: string;
  readonly supersedesTaskId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const EVIDENCE_TYPES = [
  'LOG',
  'SNAPSHOT',
  'DIFF',
  'TEST_RESULT',
  'CHECKSUM',
  'EXTERNAL_CONFIRMATION',
  'ATTESTATION',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const EVIDENCE_STRENGTHS = ['WEAK', 'MEDIUM', 'STRONG'] as const;
export type EvidenceStrength = (typeof EVIDENCE_STRENGTHS)[number];

export const EVIDENCE_PURPOSES = [
  'APPROVAL',
  'EXECUTION',
  'VERIFICATION',
] as const;
export type EvidencePurpose = (typeof EVIDENCE_PURPOSES)[number];

export interface EvidenceRequirement {
  readonly types: readonly EvidenceType[];
  readonly minimumStrength: EvidenceStrength;
  readonly producerMustMatchExecutor: boolean;
  readonly contentHashPrefix?: string;
}

export interface EvidenceDraft {
  readonly purpose: EvidencePurpose;
  readonly type: EvidenceType;
  readonly strength: EvidenceStrength;
  readonly producer: string;
  readonly contentHash: string | null;
  readonly payload?: JsonValue;
  readonly approvalEnvelopeId?: string;
}

export interface PersistedEvidence extends EvidenceDraft {
  readonly id: string;
  readonly taskId: string;
  readonly organizationId: string;
  readonly attemptId: string | null;
  readonly createdAt: Date;
}

export interface SkillDefinition {
  readonly skillId: string;
  readonly version: string;
  readonly executorRef: string;
  readonly executorVersion: string;
  readonly manifestHash: string;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly modelRef: string | null;
  readonly supportedIntents: readonly string[];
  readonly riskLevel: RiskLevel;
  readonly maturity: Maturity;
  readonly lifecycleStatus: 'ACTIVE' | 'SUSPENDED';
  readonly requiredEvidence: EvidenceRequirement;
  readonly requiredScopes: readonly string[];
}

export interface SkillCatalog {
  readonly version: string;
  readonly skills: readonly SkillDefinition[];
}

export interface EffectivePolicy {
  readonly policyId: string;
  readonly version: string;
  readonly maxRisk: RiskLevel;
  readonly blockedSkillIds: readonly string[];
  readonly preferredSkillIds: readonly string[];
  readonly approvalRequiredAtOrAbove: RiskLevel;
  readonly snapshot: Readonly<Record<string, JsonValue>>;
}

export interface PricingSnapshot {
  readonly version: string;
  readonly estimatedCredits: bigint;
  readonly reservedMaximum: bigint;
  readonly validUntil: Date;
  readonly snapshot: Readonly<Record<string, JsonValue>>;
}

export interface FrozenDecision {
  readonly id: string;
  readonly taskId: string;
  readonly organizationId: string;
  readonly canonicalIntent: string;
  readonly chosenSkillId: string | null;
  readonly chosenSkillVersion: string | null;
  readonly chosenExecutorRef: string | null;
  readonly executorVersion: string | null;
  readonly skillManifestHash: string | null;
  readonly toolId: string | null;
  readonly toolVersion: string | null;
  readonly modelRef: string | null;
  readonly rankedFallbacks: readonly string[];
  readonly catalogVersion: string;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly policySnapshot: Readonly<Record<string, JsonValue>>;
  readonly pricingVersion: string | null;
  readonly pricingSnapshot: Readonly<Record<string, JsonValue>> | null;
  readonly estimatedCredits: bigint;
  readonly reservedMaximum: bigint;
  readonly validUntil: Date | null;
  readonly riskLevel: RiskLevel;
  readonly maturity: Maturity;
  readonly requiredEvidence: EvidenceRequirement;
  readonly requiredScopes: readonly string[];
  readonly approvalRequired: boolean;
  readonly decisionInputsHash: string;
  readonly decisionHash: string;
  readonly algorithmVersion: string;
  readonly capabilityGapReason: string | null;
  readonly resolvedAt: Date;
}

export interface ApprovalEnvelope {
  readonly id: string;
  readonly taskId: string;
  readonly organizationId: string;
  readonly frozenDecisionId: string;
  readonly decisionHash: string;
  readonly policyVersion: string;
  readonly pricingVersion: string;
  readonly toolVersion: string;
  readonly executorVersion: string;
  readonly estimatedCredits: bigint;
  readonly reservedMaximum: bigint;
  readonly requiredScopes: readonly string[];
  readonly validUntil: Date;
  readonly envelopeHash: string;
  readonly createdAt: Date;
}

export type ApprovalVerdict = 'APPROVED' | 'REJECTED';

export interface ApprovalDecision {
  readonly id: string;
  readonly approvalEnvelopeId: string;
  readonly taskId: string;
  readonly organizationId: string;
  readonly verdict: ApprovalVerdict;
  readonly actorRef: string;
  readonly actorScopes: readonly string[];
  readonly reason: string | null;
  readonly envelopeHash: string;
  readonly decisionHash: string;
  readonly commandId: string;
  readonly decidedAt: Date;
}

export interface ExecutionAttempt {
  readonly id: string;
  readonly taskId: string;
  readonly organizationId: string;
  readonly idempotencyKey: string;
  readonly status:
    'PENDING' | 'CLAIMED' | 'SUCCEEDED' | 'FAILED' | 'RECONCILIATION_REQUIRED';
  readonly claimedAt: Date | null;
  readonly claimedBy: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly dispatchedAt: Date | null;
  readonly executionPhase: 'CLAIMED' | 'DISPATCHED' | 'TERMINAL';
  readonly effectState: 'NONE' | 'POSSIBLE' | 'CONFIRMED';
  readonly replayPolicy:
    'ALLOW_BEFORE_DISPATCH' | 'NO_AUTOMATIC_REEXECUTION_AFTER_DISPATCH';
  readonly claims: number;
  readonly actualUsage: bigint | null;
  readonly chargedCredits: bigint | null;
  readonly overrunCredits: bigint | null;
  readonly providerCostMinor: bigint | null;
  readonly providerCostCurrency: string | null;
  readonly effectMayHaveOccurred: boolean;
}

export interface PersistedTaskEvent {
  readonly id: string;
  readonly organizationId: string;
  readonly taskId: string;
  readonly sequence: bigint;
  readonly name: string;
  readonly fromState: TaskState;
  readonly toState: TaskState | null;
  readonly payload: Readonly<Record<string, JsonValue>>;
  readonly correlationId: string;
  readonly commandId: string;
  readonly occurredAt: Date;
}

export interface ExecutionResult {
  readonly outcome: 'SUCCEEDED' | 'FAILED';
  readonly actualUsage: bigint;
  readonly evidence: readonly EvidenceDraft[];
  readonly output?: JsonValue;
  readonly failureCode?: string;
  readonly failureMessage?: string;
  readonly providerCostMinor?: bigint;
  readonly providerCostCurrency?: string;
  readonly effectMayHaveOccurred: boolean;
}
