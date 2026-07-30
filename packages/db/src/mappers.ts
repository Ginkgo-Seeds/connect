import type {
  ApprovalEnvelope,
  ExecutionAttempt,
  FrozenDecision,
  JsonValue,
  PersistedEvidence,
  PersistedTaskEvent,
  Task,
} from '@connect/core';

import type {
  ApprovalEnvelope as DatabaseApprovalEnvelope,
  Evidence as DatabaseEvidence,
  ExecutionAttempt as DatabaseExecutionAttempt,
  FrozenDecision as DatabaseFrozenDecision,
  Task as DatabaseTask,
  TaskEvent as DatabaseTaskEvent,
} from './generated/prisma/client.js';

export function toTask(row: DatabaseTask): Task {
  return {
    id: row.id,
    organizationId: row.organizationId,
    intent: row.intent,
    instruction: row.instruction,
    inputs: asJsonObject(row.inputs),
    riskLevel: row.riskLevel,
    maturity: row.maturity,
    state: row.state,
    blockReason: row.blockReason,
    version: row.version,
    eventSequence: row.eventSequence,
    correlationId: row.correlationId,
    supersedesTaskId: row.supersedesTaskId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toFrozenDecision(row: DatabaseFrozenDecision): FrozenDecision {
  return {
    id: row.id,
    taskId: row.taskId,
    organizationId: row.organizationId,
    canonicalIntent: row.canonicalIntent,
    chosenSkillId: row.chosenSkillId,
    chosenSkillVersion: row.chosenSkillVersion,
    chosenExecutorRef: row.chosenExecutorRef,
    executorVersion: row.executorVersion,
    skillManifestHash: row.skillManifestHash,
    toolId: row.toolId,
    toolVersion: row.toolVersion,
    modelRef: row.modelRef,
    rankedFallbacks: asStringArray(row.rankedFallbacks),
    catalogVersion: row.catalogVersion,
    policyId: row.policyId,
    policyVersion: row.policyVersion,
    policySnapshot: asJsonObject(row.policySnapshot),
    pricingVersion: row.pricingVersion,
    pricingSnapshot:
      row.pricingSnapshot === null ? null : asJsonObject(row.pricingSnapshot),
    estimatedCredits: row.estimatedCredits,
    reservedMaximum: row.reservedMaximum,
    validUntil: row.validUntil,
    riskLevel: row.riskLevel,
    maturity: row.maturity,
    requiredEvidence:
      row.requiredEvidence as unknown as FrozenDecision['requiredEvidence'],
    requiredScopes: asStringArray(row.requiredScopes),
    approvalRequired: row.approvalRequired,
    decisionInputsHash: row.decisionInputsHash,
    decisionHash: row.decisionHash,
    algorithmVersion: row.algorithmVersion,
    capabilityGapReason: row.capabilityGapReason,
    resolvedAt: row.resolvedAt,
  };
}

export function toApprovalEnvelope(
  row: DatabaseApprovalEnvelope,
): ApprovalEnvelope {
  return {
    id: row.id,
    taskId: row.taskId,
    organizationId: row.organizationId,
    frozenDecisionId: row.frozenDecisionId,
    decisionHash: row.decisionHash,
    policyVersion: row.policyVersion,
    pricingVersion: row.pricingVersion,
    toolVersion: row.toolVersion,
    executorVersion: row.executorVersion,
    estimatedCredits: row.estimatedCredits,
    reservedMaximum: row.reservedMaximum,
    requiredScopes: asStringArray(row.requiredScopes),
    validUntil: row.validUntil,
    envelopeHash: row.envelopeHash,
    createdAt: row.createdAt,
  };
}

export function toExecutionAttempt(
  row: DatabaseExecutionAttempt,
): ExecutionAttempt {
  return {
    id: row.id,
    taskId: row.taskId,
    organizationId: row.organizationId,
    idempotencyKey: row.idempotencyKey,
    status: row.status,
    claimedAt: row.claimedAt,
    claimedBy: row.claimedBy,
    leaseExpiresAt: row.leaseExpiresAt,
    dispatchedAt: row.dispatchedAt,
    executionPhase: row.executionPhase,
    effectState: row.effectState,
    replayPolicy: row.replayPolicy,
    claims: row.claims,
    actualUsage: row.actualUsage,
    chargedCredits: row.chargedCredits,
    overrunCredits: row.overrunCredits,
    providerCostMinor: row.providerCostMinor,
    providerCostCurrency: row.providerCostCurrency,
    effectMayHaveOccurred: row.effectMayHaveOccurred,
  };
}

export function toTaskEvent(row: DatabaseTaskEvent): PersistedTaskEvent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    taskId: row.taskId,
    sequence: row.sequence,
    name: row.name,
    fromState: row.fromState,
    toState: row.toState,
    payload: row.payload === null ? {} : asJsonObject(row.payload),
    correlationId: row.correlationId,
    commandId: row.commandId,
    occurredAt: row.occurredAt,
  };
}

export function toEvidence(row: DatabaseEvidence): PersistedEvidence {
  const evidence: PersistedEvidence = {
    id: row.id,
    taskId: row.taskId,
    organizationId: row.organizationId,
    attemptId: row.attemptId,
    purpose: row.purpose,
    type: row.type,
    strength: row.strength,
    producer: row.producer,
    contentHash: row.contentHash,
    createdAt: row.createdAt,
    ...(row.approvalEnvelopeId === null
      ? {}
      : { approvalEnvelopeId: row.approvalEnvelopeId }),
    ...(row.payload === null ? {} : { payload: row.payload as JsonValue }),
  };
  return evidence;
}

function asStringArray(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string')
  ) {
    throw new Error('INVALID_DATABASE_STRING_ARRAY');
  }
  return value;
}

function asJsonObject(value: unknown): Readonly<Record<string, JsonValue>> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('INVALID_DATABASE_JSON_OBJECT');
  }
  return value as Readonly<Record<string, JsonValue>>;
}
