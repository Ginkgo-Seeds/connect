import { describe, expect, it } from 'vitest';

import {
  computeApprovalEnvelopeHash,
  createApprovalEnvelope,
  hasRequiredScopes,
  validateApprovalAuthorization,
  validateApprovalEnvelope,
  type FrozenDecision,
} from '../src/index.js';

const decision: FrozenDecision = {
  id: 'decision-1',
  taskId: 'task-1',
  organizationId: 'org-1',
  canonicalIntent: 'demo.run',
  chosenSkillId: 'demo',
  chosenSkillVersion: '1',
  chosenExecutorRef: 'executor:demo',
  executorVersion: '2',
  skillManifestHash: 'manifest',
  toolId: 'tool',
  toolVersion: '3',
  modelRef: null,
  rankedFallbacks: [],
  catalogVersion: '4',
  policyId: 'policy',
  policyVersion: '5',
  policySnapshot: {},
  pricingVersion: '6',
  pricingSnapshot: {},
  estimatedCredits: 10n,
  reservedMaximum: 20n,
  validUntil: new Date('2026-07-29T00:00:00.000Z'),
  riskLevel: 'R3',
  maturity: 'PRODUCTION',
  requiredEvidence: {
    types: ['EXTERNAL_CONFIRMATION'],
    minimumStrength: 'STRONG',
    producerMustMatchExecutor: true,
  },
  requiredScopes: ['task:approve'],
  approvalRequired: true,
  decisionInputsHash: 'inputs',
  decisionHash: 'decision-hash',
  algorithmVersion: 'foundation-002.v1',
  capabilityGapReason: null,
  resolvedAt: new Date('2026-07-28T00:00:00.000Z'),
};

describe('approval envelopes', () => {
  it('binds material frozen fields and validates before expiry', () => {
    const envelope = createApprovalEnvelope({
      id: 'envelope-1',
      decision,
      createdAt: new Date('2026-07-28T01:00:00.000Z'),
    });
    expect(() =>
      validateApprovalEnvelope(
        envelope,
        decision,
        new Date('2026-07-28T02:00:00.000Z'),
      ),
    ).not.toThrow();
    expect(() =>
      validateApprovalEnvelope(
        { ...envelope, envelopeHash: 'tampered' },
        decision,
        new Date('2026-07-28T02:00:00.000Z'),
      ),
    ).toThrow('APPROVAL_ENVELOPE_HASH_MISMATCH');
  });

  it('rejects an expired envelope', () => {
    const envelope = createApprovalEnvelope({
      id: 'envelope-1',
      decision,
      createdAt: new Date('2026-07-28T01:00:00.000Z'),
    });
    expect(() =>
      validateApprovalEnvelope(
        envelope,
        decision,
        new Date('2026-07-30T00:00:00.000Z'),
      ),
    ).toThrow('APPROVAL_ENVELOPE_EXPIRED');
  });

  it('checks actor scopes without trusting the request body', () => {
    expect(hasRequiredScopes(['task:approve'], ['task:approve'])).toBe(true);
    expect(hasRequiredScopes([], ['task:approve'])).toBe(false);
  });

  it('uses one validator for tenant, scopes, integrity and expiry', () => {
    const envelope = createApprovalEnvelope({
      id: 'envelope-authorization',
      decision,
      createdAt: new Date('2026-07-28T01:00:00.000Z'),
    });
    const context = {
      organizationId: decision.organizationId,
      actorRef: 'user:approver',
      actorScopes: ['task:approve'],
      correlationId: 'correlation-1',
    };
    expect(() =>
      validateApprovalAuthorization(
        context,
        envelope,
        decision,
        new Date('2026-07-28T02:00:00.000Z'),
      ),
    ).not.toThrow();
    expect(() =>
      validateApprovalAuthorization(
        { ...context, actorScopes: [] },
        envelope,
        decision,
        new Date('2026-07-28T02:00:00.000Z'),
      ),
    ).toThrow('APPROVAL_SCOPE_REQUIRED');
    expect(() =>
      validateApprovalAuthorization(
        context,
        { ...envelope, envelopeHash: 'tampered' },
        decision,
        new Date('2026-07-28T02:00:00.000Z'),
      ),
    ).toThrow('APPROVAL_ENVELOPE_HASH_MISMATCH');
    const loweredScopesWithoutHash = {
      ...envelope,
      requiredScopes: [] as const,
    };
    const loweredScopes = {
      ...loweredScopesWithoutHash,
      envelopeHash: computeApprovalEnvelopeHash(loweredScopesWithoutHash),
    };
    expect(() =>
      validateApprovalAuthorization(
        { ...context, actorScopes: [] },
        loweredScopes,
        decision,
        new Date('2026-07-28T02:00:00.000Z'),
      ),
    ).toThrow('APPROVAL_ENVELOPE_MISMATCH');
  });
});
