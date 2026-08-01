import type {
  EffectivePolicy,
  FrozenDecision,
  JsonValue,
  PricingSnapshot,
  SkillCatalog,
  SkillDefinition,
  Task,
} from './domain.js';
import { hashCanonicalJson } from './canonical.js';
import type { Maturity, RiskLevel } from './states.js';

const RISK_ORDER: Readonly<Record<RiskLevel, number>> = {
  R0: 0,
  R1: 1,
  R2: 2,
  R3: 3,
};

const MATURITY_ORDER: Readonly<Record<Maturity, number>> = {
  SIMULATION: 0,
  SHADOW: 1,
  PRODUCTION: 2,
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function skillRef(skill: SkillDefinition): string {
  return `${skill.skillId}@${skill.version}`;
}

function skillHashPayload(skill: SkillDefinition): JsonValue {
  return {
    skillId: skill.skillId,
    version: skill.version,
    executorRef: skill.executorRef,
    executorVersion: skill.executorVersion,
    manifestHash: skill.manifestHash,
    toolId: skill.toolId,
    toolVersion: skill.toolVersion,
    modelRef: skill.modelRef,
    supportedIntents: [...skill.supportedIntents].sort(compareText),
    riskLevel: skill.riskLevel,
    maturity: skill.maturity,
    lifecycleStatus: skill.lifecycleStatus,
    requiredEvidence: {
      types: [...skill.requiredEvidence.types].sort(compareText),
      minimumStrength: skill.requiredEvidence.minimumStrength,
      producerMustMatchExecutor:
        skill.requiredEvidence.producerMustMatchExecutor,
      contentHashPrefix: skill.requiredEvidence.contentHashPrefix ?? null,
    },
    requiredScopes: [...skill.requiredScopes].sort(compareText),
  };
}

export interface ResolutionResult {
  readonly chosen: SkillDefinition | null;
  readonly fallbacks: readonly SkillDefinition[];
}

export function resolveSkill(
  task: Task,
  catalog: SkillCatalog,
  policy: EffectivePolicy,
): ResolutionResult {
  const ranked = catalog.skills
    .filter(
      (skill) =>
        skill.lifecycleStatus === 'ACTIVE' &&
        (skill.supportedIntents.includes(task.intent) ||
          skill.supportedIntents.includes('*')) &&
        MATURITY_ORDER[skill.maturity] >= MATURITY_ORDER[task.maturity] &&
        RISK_ORDER[skill.riskLevel] <= RISK_ORDER[policy.maxRisk] &&
        !policy.blockedSkillIds.includes(skill.skillId),
    )
    .map((skill) => ({
      skill,
      specificity: skill.supportedIntents.includes(task.intent) ? 0 : 1,
      preference: policy.preferredSkillIds.indexOf(skill.skillId),
    }))
    .sort((left, right) => {
      if (left.specificity !== right.specificity) {
        return left.specificity - right.specificity;
      }

      const leftPreferred =
        left.preference === -1 ? Number.MAX_SAFE_INTEGER : left.preference;
      const rightPreferred =
        right.preference === -1 ? Number.MAX_SAFE_INTEGER : right.preference;
      if (leftPreferred !== rightPreferred) {
        return leftPreferred - rightPreferred;
      }

      if (
        MATURITY_ORDER[left.skill.maturity] !==
        MATURITY_ORDER[right.skill.maturity]
      ) {
        return (
          MATURITY_ORDER[right.skill.maturity] -
          MATURITY_ORDER[left.skill.maturity]
        );
      }

      if (
        RISK_ORDER[left.skill.riskLevel] !== RISK_ORDER[right.skill.riskLevel]
      ) {
        return (
          RISK_ORDER[left.skill.riskLevel] - RISK_ORDER[right.skill.riskLevel]
        );
      }

      return compareText(skillRef(left.skill), skillRef(right.skill));
    })
    .map(({ skill }) => skill);

  return {
    chosen: ranked[0] ?? null,
    fallbacks: ranked.slice(1),
  };
}

function decisionHashPayload(
  decision: Omit<FrozenDecision, 'decisionHash'>,
): JsonValue {
  return {
    id: decision.id,
    taskId: decision.taskId,
    organizationId: decision.organizationId,
    canonicalIntent: decision.canonicalIntent,
    chosenSkillId: decision.chosenSkillId,
    chosenSkillVersion: decision.chosenSkillVersion,
    chosenExecutorRef: decision.chosenExecutorRef,
    executorVersion: decision.executorVersion,
    skillManifestHash: decision.skillManifestHash,
    toolId: decision.toolId,
    toolVersion: decision.toolVersion,
    modelRef: decision.modelRef,
    rankedFallbacks: decision.rankedFallbacks,
    catalogVersion: decision.catalogVersion,
    policyId: decision.policyId,
    policyVersion: decision.policyVersion,
    policySnapshot: decision.policySnapshot,
    pricingVersion: decision.pricingVersion,
    pricingSnapshot: decision.pricingSnapshot,
    estimatedCredits: decision.estimatedCredits.toString(),
    reservedMaximum: decision.reservedMaximum.toString(),
    validUntil: decision.validUntil?.toISOString() ?? null,
    riskLevel: decision.riskLevel,
    maturity: decision.maturity,
    requiredEvidence: {
      types: [...decision.requiredEvidence.types].sort(compareText),
      minimumStrength: decision.requiredEvidence.minimumStrength,
      producerMustMatchExecutor:
        decision.requiredEvidence.producerMustMatchExecutor,
      contentHashPrefix: decision.requiredEvidence.contentHashPrefix ?? null,
    },
    requiredScopes: decision.requiredScopes,
    approvalRequired: decision.approvalRequired,
    decisionInputsHash: decision.decisionInputsHash,
    algorithmVersion: decision.algorithmVersion,
    capabilityGapReason: decision.capabilityGapReason,
    resolvedAt: decision.resolvedAt.toISOString(),
  };
}

export function computeFrozenDecisionHash(
  decision: Omit<FrozenDecision, 'decisionHash'>,
): string {
  return hashCanonicalJson(decisionHashPayload(decision));
}

export function assertFrozenDecisionIntegrity(decision: FrozenDecision): void {
  if (
    decision.estimatedCredits < 0n ||
    decision.reservedMaximum < decision.estimatedCredits
  ) {
    throw new Error('INVALID_FROZEN_DECISION_CREDITS');
  }
  const hasChoice = decision.chosenSkillId !== null;
  if (
    hasChoice !== (decision.chosenSkillVersion !== null) ||
    hasChoice !== (decision.chosenExecutorRef !== null) ||
    hasChoice !== (decision.executorVersion !== null) ||
    hasChoice !== (decision.skillManifestHash !== null) ||
    hasChoice !== (decision.toolId !== null) ||
    hasChoice !== (decision.toolVersion !== null) ||
    hasChoice !== (decision.pricingVersion !== null) ||
    hasChoice !== (decision.pricingSnapshot !== null) ||
    hasChoice !== (decision.validUntil !== null) ||
    hasChoice === (decision.capabilityGapReason !== null) ||
    (!hasChoice &&
      (decision.modelRef !== null ||
        decision.estimatedCredits !== 0n ||
        decision.reservedMaximum !== 0n ||
        decision.approvalRequired))
  ) {
    throw new Error('INVALID_FROZEN_DECISION_CHOICE');
  }
  const { decisionHash, ...withoutHash } = decision;
  if (computeFrozenDecisionHash(withoutHash) !== decisionHash) {
    throw new Error('FROZEN_DECISION_HASH_MISMATCH');
  }
}

export interface FreezeDecisionInput {
  readonly id: string;
  readonly task: Task;
  readonly catalog: SkillCatalog;
  readonly policy: EffectivePolicy;
  readonly resolution: ResolutionResult;
  readonly pricing: PricingSnapshot | null;
  readonly resolvedAt: Date;
}

export function freezeDecision(input: FreezeDecisionInput): FrozenDecision {
  const { chosen } = input.resolution;
  if (chosen !== null && input.pricing === null) {
    throw new Error('PRICING_REQUIRED');
  }
  if (
    input.pricing !== null &&
    (input.pricing.estimatedCredits < 0n ||
      input.pricing.reservedMaximum < input.pricing.estimatedCredits)
  ) {
    throw new Error('INVALID_PRICING_SNAPSHOT');
  }

  const approvalRequired =
    chosen !== null &&
    RISK_ORDER[input.task.riskLevel] >=
      RISK_ORDER[input.policy.approvalRequiredAtOrAbove];

  const decisionInputsHash = hashCanonicalJson({
    task: {
      taskId: input.task.id,
      organizationId: input.task.organizationId,
      intent: input.task.intent,
      instruction: input.task.instruction,
      inputs: input.task.inputs,
      riskLevel: input.task.riskLevel,
      maturity: input.task.maturity,
    },
    catalog: {
      version: input.catalog.version,
      skills: [...input.catalog.skills]
        .sort((left, right) => compareText(skillRef(left), skillRef(right)))
        .map(skillHashPayload),
    },
    policy: {
      policyId: input.policy.policyId,
      version: input.policy.version,
      maxRisk: input.policy.maxRisk,
      blockedSkillIds: [...input.policy.blockedSkillIds].sort(compareText),
      preferredSkillIds: input.policy.preferredSkillIds,
      approvalRequiredAtOrAbove: input.policy.approvalRequiredAtOrAbove,
      snapshot: input.policy.snapshot,
    },
    pricing:
      input.pricing === null
        ? null
        : {
            version: input.pricing.version,
            estimatedCredits: input.pricing.estimatedCredits.toString(),
            reservedMaximum: input.pricing.reservedMaximum.toString(),
            validUntil: input.pricing.validUntil.toISOString(),
            snapshot: input.pricing.snapshot,
          },
  });

  const withoutHash: Omit<FrozenDecision, 'decisionHash'> = {
    id: input.id,
    taskId: input.task.id,
    organizationId: input.task.organizationId,
    canonicalIntent: input.task.intent,
    chosenSkillId: chosen?.skillId ?? null,
    chosenSkillVersion: chosen?.version ?? null,
    chosenExecutorRef: chosen?.executorRef ?? null,
    executorVersion: chosen?.executorVersion ?? null,
    skillManifestHash: chosen?.manifestHash ?? null,
    toolId: chosen?.toolId ?? null,
    toolVersion: chosen?.toolVersion ?? null,
    modelRef: chosen?.modelRef ?? null,
    rankedFallbacks: input.resolution.fallbacks.map(skillRef),
    catalogVersion: input.catalog.version,
    policyId: input.policy.policyId,
    policyVersion: input.policy.version,
    policySnapshot: input.policy.snapshot,
    pricingVersion: input.pricing?.version ?? null,
    pricingSnapshot: input.pricing?.snapshot ?? null,
    estimatedCredits: input.pricing?.estimatedCredits ?? 0n,
    reservedMaximum: input.pricing?.reservedMaximum ?? 0n,
    validUntil: input.pricing?.validUntil ?? null,
    riskLevel: input.task.riskLevel,
    maturity: input.task.maturity,
    requiredEvidence:
      chosen === null
        ? {
            types: [],
            minimumStrength: 'STRONG',
            producerMustMatchExecutor: true,
          }
        : {
            ...chosen.requiredEvidence,
            types: [...chosen.requiredEvidence.types].sort(compareText),
          },
    requiredScopes: [...(chosen?.requiredScopes ?? [])].sort(compareText),
    approvalRequired,
    decisionInputsHash,
    algorithmVersion: 'foundation-002.v1',
    capabilityGapReason: chosen === null ? 'CAPABILITY_GAP' : null,
    resolvedAt: input.resolvedAt,
  };

  return {
    ...withoutHash,
    decisionHash: computeFrozenDecisionHash(withoutHash),
  };
}
