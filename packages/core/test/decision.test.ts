import { describe, expect, it } from 'vitest';

import {
  assertFrozenDecisionIntegrity,
  freezeDecision,
  hashCanonicalJson,
  resolveSkill,
  type EffectivePolicy,
  type PricingSnapshot,
  type SkillCatalog,
  type SkillDefinition,
  type Task,
} from '../src/index.js';

const task: Task = {
  id: 'task-1',
  organizationId: 'org-1',
  intent: 'demo.run',
  instruction: null,
  inputs: {},
  riskLevel: 'R1',
  maturity: 'SIMULATION',
  state: 'CLASSIFIED',
  blockReason: null,
  version: 1,
  eventSequence: 2n,
  correlationId: 'corr-1',
  supersedesTaskId: null,
  createdAt: new Date('2026-07-28T10:00:00.000Z'),
  updatedAt: new Date('2026-07-28T10:00:00.000Z'),
};

const requirement = {
  types: ['EXTERNAL_CONFIRMATION'] as const,
  minimumStrength: 'STRONG' as const,
  producerMustMatchExecutor: true,
};

function skill(
  skillId: string,
  supportedIntents: readonly string[],
): SkillDefinition {
  return {
    skillId,
    version: '1',
    executorRef: `executor:${skillId}`,
    executorVersion: '1',
    manifestHash: `hash:${skillId}`,
    toolId: `tool:${skillId}`,
    toolVersion: '1',
    modelRef: null,
    supportedIntents,
    riskLevel: 'R1',
    maturity: 'PRODUCTION',
    lifecycleStatus: 'ACTIVE',
    requiredEvidence: requirement,
    requiredScopes: ['task:approve'],
  };
}

const policy: EffectivePolicy = {
  policyId: 'policy',
  version: '3',
  maxRisk: 'R3',
  blockedSkillIds: [],
  preferredSkillIds: [],
  approvalRequiredAtOrAbove: 'R3',
  snapshot: { mode: 'default' },
};

const pricing: PricingSnapshot = {
  version: 'price-2',
  estimatedCredits: 10n,
  reservedMaximum: 20n,
  validUntil: new Date('2026-07-29T10:00:00.000Z'),
  snapshot: { unit: 'connect-credit' },
};

describe('deterministic decisions', () => {
  it('prefers an exact intent and is independent of catalog order', () => {
    const exact = skill('exact', ['demo.run']);
    const wildcard = skill('wildcard', ['*']);
    const catalogA: SkillCatalog = {
      version: '7',
      skills: [wildcard, exact],
    };
    const catalogB: SkillCatalog = {
      version: '7',
      skills: [exact, wildcard],
    };

    expect(resolveSkill(task, catalogA, policy)).toEqual(
      resolveSkill(task, catalogB, policy),
    );
    expect(resolveSkill(task, catalogA, policy).chosen?.skillId).toBe('exact');
  });

  it('uses a stable lexical tie-break', () => {
    const result = resolveSkill(
      task,
      { version: '7', skills: [skill('zeta', ['*']), skill('alpha', ['*'])] },
      policy,
    );
    expect(result.chosen?.skillId).toBe('alpha');
  });

  it('freezes the same material inputs to the same hash', () => {
    const catalog = { version: '7', skills: [skill('exact', ['demo.run'])] };
    const resolution = resolveSkill(task, catalog, policy);
    const input = {
      id: 'decision-1',
      task,
      catalog,
      policy,
      resolution,
      pricing,
      resolvedAt: new Date('2026-07-28T10:05:00.000Z'),
    };
    expect(freezeDecision(input)).toEqual(freezeDecision(input));
  });

  it('hashes material Task inputs while ignoring catalog iteration order', () => {
    const exact = skill('exact', ['demo.run']);
    const fallback = skill('fallback', ['*']);
    const freeze = (
      candidateTask: Task,
      skills: readonly SkillDefinition[],
    ) => {
      const catalog = { version: '7', skills };
      return freezeDecision({
        id: 'decision-1',
        task: candidateTask,
        catalog,
        policy,
        resolution: resolveSkill(candidateTask, catalog, policy),
        pricing,
        resolvedAt: new Date('2026-07-28T10:05:00.000Z'),
      });
    };
    const first = freeze(task, [fallback, exact]);
    const reordered = freeze(task, [exact, fallback]);
    const changed = freeze({ ...task, inputs: { customer: 'different' } }, [
      fallback,
      exact,
    ]);
    expect(reordered.decisionInputsHash).toBe(first.decisionInputsHash);
    expect(reordered.decisionHash).toBe(first.decisionHash);
    expect(changed.decisionInputsHash).not.toBe(first.decisionInputsHash);
    expect(changed.decisionHash).not.toBe(first.decisionHash);
    expect(() => assertFrozenDecisionIntegrity(first)).not.toThrow();
    expect(() =>
      assertFrozenDecisionIntegrity({
        ...first,
        reservedMaximum: first.reservedMaximum + 1n,
      }),
    ).toThrow('FROZEN_DECISION_HASH_MISMATCH');
  });

  it('persists a capability gap without pricing', () => {
    const catalog = { version: '7', skills: [] };
    const decision = freezeDecision({
      id: 'decision-gap',
      task,
      catalog,
      policy,
      resolution: resolveSkill(task, catalog, policy),
      pricing: null,
      resolvedAt: new Date('2026-07-28T10:05:00.000Z'),
    });
    expect(decision.chosenSkillId).toBeNull();
    expect(decision.capabilityGapReason).toBe('CAPABILITY_GAP');
  });

  it('canonicalizes object key order', () => {
    expect(hashCanonicalJson({ b: 2, a: 1 })).toBe(
      hashCanonicalJson({ a: 1, b: 2 }),
    );
  });
});
