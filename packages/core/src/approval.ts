import type {
  ApprovalEnvelope,
  FrozenDecision,
  JsonValue,
  TrustedOrganizationContext,
} from './domain.js';
import { hashCanonicalJson } from './canonical.js';

export interface CreateApprovalEnvelopeInput {
  readonly id: string;
  readonly decision: FrozenDecision;
  readonly createdAt: Date;
}

function envelopeHashPayload(
  envelope: Omit<ApprovalEnvelope, 'envelopeHash'>,
): JsonValue {
  return {
    id: envelope.id,
    taskId: envelope.taskId,
    organizationId: envelope.organizationId,
    frozenDecisionId: envelope.frozenDecisionId,
    decisionHash: envelope.decisionHash,
    policyVersion: envelope.policyVersion,
    pricingVersion: envelope.pricingVersion,
    toolVersion: envelope.toolVersion,
    executorVersion: envelope.executorVersion,
    estimatedCredits: envelope.estimatedCredits.toString(),
    reservedMaximum: envelope.reservedMaximum.toString(),
    requiredScopes: envelope.requiredScopes,
    validUntil: envelope.validUntil.toISOString(),
    createdAt: envelope.createdAt.toISOString(),
  };
}

export function computeApprovalEnvelopeHash(
  envelope: Omit<ApprovalEnvelope, 'envelopeHash'>,
): string {
  return hashCanonicalJson(envelopeHashPayload(envelope));
}

export function createApprovalEnvelope(
  input: CreateApprovalEnvelopeInput,
): ApprovalEnvelope {
  const decision = input.decision;
  if (
    !decision.approvalRequired ||
    decision.validUntil === null ||
    decision.pricingVersion === null ||
    decision.toolVersion === null ||
    decision.executorVersion === null
  ) {
    throw new Error('DECISION_NOT_APPROVABLE');
  }

  const withoutHash: Omit<ApprovalEnvelope, 'envelopeHash'> = {
    id: input.id,
    taskId: decision.taskId,
    organizationId: decision.organizationId,
    frozenDecisionId: decision.id,
    decisionHash: decision.decisionHash,
    policyVersion: decision.policyVersion,
    pricingVersion: decision.pricingVersion,
    toolVersion: decision.toolVersion,
    executorVersion: decision.executorVersion,
    estimatedCredits: decision.estimatedCredits,
    reservedMaximum: decision.reservedMaximum,
    requiredScopes: decision.requiredScopes,
    validUntil: decision.validUntil,
    createdAt: input.createdAt,
  };

  return {
    ...withoutHash,
    envelopeHash: computeApprovalEnvelopeHash(withoutHash),
  };
}

export function hasRequiredScopes(
  actorScopes: readonly string[],
  requiredScopes: readonly string[],
): boolean {
  const available = new Set(actorScopes);
  return requiredScopes.every((scope) => available.has(scope));
}

export function validateApprovalEnvelope(
  envelope: ApprovalEnvelope,
  decision: FrozenDecision,
  now: Date,
): void {
  if (
    envelope.taskId !== decision.taskId ||
    envelope.organizationId !== decision.organizationId ||
    envelope.frozenDecisionId !== decision.id ||
    envelope.decisionHash !== decision.decisionHash ||
    envelope.policyVersion !== decision.policyVersion ||
    envelope.pricingVersion !== decision.pricingVersion ||
    envelope.toolVersion !== decision.toolVersion ||
    envelope.executorVersion !== decision.executorVersion ||
    envelope.estimatedCredits !== decision.estimatedCredits ||
    envelope.reservedMaximum !== decision.reservedMaximum ||
    envelope.validUntil.getTime() !== decision.validUntil?.getTime() ||
    !sameScopes(envelope.requiredScopes, decision.requiredScopes)
  ) {
    throw new Error('APPROVAL_ENVELOPE_MISMATCH');
  }

  const { envelopeHash, ...withoutHash } = envelope;
  if (computeApprovalEnvelopeHash(withoutHash) !== envelopeHash) {
    throw new Error('APPROVAL_ENVELOPE_HASH_MISMATCH');
  }

  if (now.getTime() > envelope.validUntil.getTime()) {
    throw new Error('APPROVAL_ENVELOPE_EXPIRED');
  }
}

export function validateApprovalAuthorization(
  context: TrustedOrganizationContext,
  envelope: ApprovalEnvelope,
  decision: FrozenDecision,
  now: Date,
): void {
  if (
    context.organizationId !== envelope.organizationId ||
    envelope.organizationId !== decision.organizationId ||
    envelope.taskId !== decision.taskId
  ) {
    throw new Error('APPROVAL_TENANT_OR_TASK_MISMATCH');
  }
  validateApprovalEnvelope(envelope, decision, now);
  if (!hasRequiredScopes(context.actorScopes, envelope.requiredScopes)) {
    throw new Error('APPROVAL_SCOPE_REQUIRED');
  }
}

function sameScopes(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const normalizedLeft = [...new Set(left)].sort();
  const normalizedRight = [...new Set(right)].sort();
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((scope, index) => scope === normalizedRight[index])
  );
}
