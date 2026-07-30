import { describe, expect, it, vi } from 'vitest';

import {
  TaskRunner,
  type ExecutionClaim,
  type FrozenDecision,
  type KernelStore,
  type Task,
  type TaskRunnerDependencies,
  type TrustedOrganizationContext,
} from '../src/index.js';

const context: TrustedOrganizationContext = {
  organizationId: 'org-1',
  actorRef: 'actor-1',
  actorScopes: ['tasks.approve'],
  correlationId: 'correlation-1',
};

describe('TaskRunner external-call boundaries', () => {
  it('calls an executor only after the claim store operation has closed', async () => {
    let task = makeTask('GATED', 4);
    let storeOperationActive = false;
    const decision = makeDecision(task);
    const claim: ExecutionClaim = {
      task,
      decision,
      attempt: {
        id: 'attempt-1',
        taskId: task.id,
        organizationId: task.organizationId,
        idempotencyKey: 'stable-execution-key',
        status: 'CLAIMED',
        claimedAt: new Date('2026-07-28T00:00:00.000Z'),
        claimedBy: 'worker',
        leaseExpiresAt: new Date('2026-07-28T00:01:00.000Z'),
        dispatchedAt: null,
        executionPhase: 'CLAIMED',
        effectState: 'NONE',
        replayPolicy: 'ALLOW_BEFORE_DISPATCH',
        claims: 1,
        actualUsage: null,
        chargedCredits: null,
        overrunCredits: null,
        providerCostMinor: null,
        providerCostCurrency: null,
        effectMayHaveOccurred: false,
      },
      acquired: true,
    };
    const dispatchedClaim: ExecutionClaim = {
      ...claim,
      task: { ...task, version: task.version + 1 },
      attempt: {
        ...claim.attempt,
        dispatchedAt: new Date('2026-07-28T00:00:01.000Z'),
        executionPhase: 'DISPATCHED',
        effectState: 'POSSIBLE',
        replayPolicy: 'NO_AUTOMATIC_REEXECUTION_AFTER_DISPATCH',
        effectMayHaveOccurred: true,
      },
    };
    const claimExecution = vi.fn(async () => {
      storeOperationActive = true;
      await Promise.resolve();
      storeOperationActive = false;
      return claim;
    });
    const recordExecutionFailure = vi.fn(async () => {
      storeOperationActive = true;
      task = makeTask('FAILED', 6);
      storeOperationActive = false;
      return task;
    });
    const store = {
      getTask: vi.fn(async () => task),
      claimExecution,
      dispatchExecution: vi.fn(async () => dispatchedClaim),
      recordExecutionFailure,
    } as unknown as KernelStore;
    const execute = vi.fn(async () => {
      expect(storeOperationActive).toBe(false);
      return {
        outcome: 'FAILED' as const,
        actualUsage: 2n,
        evidence: [],
        failureCode: 'EXPECTED_TEST_FAILURE',
        effectMayHaveOccurred: false,
      };
    });
    const runner = new TaskRunner(
      makeDependencies(store, { 'executor-a': { execute } }),
    );

    const result = await runner.run(context, task.id, {
      idempotencyKey: 'run',
      requestHash: 'hash:run',
    });

    expect(result.state).toBe('FAILED');
    expect(execute).toHaveBeenCalledOnce();
    expect(recordExecutionFailure).toHaveBeenCalledOnce();
  });

  it('reconciles instead of releasing after post-executor persistence failure', async () => {
    let task = makeTask('GATED', 4);
    const claim = makeExecutionClaim(task);
    const dispatched: ExecutionClaim = {
      ...claim,
      task: { ...task, version: task.version + 1 },
      attempt: {
        ...claim.attempt,
        dispatchedAt: new Date('2026-07-28T00:00:01.000Z'),
        executionPhase: 'DISPATCHED',
        effectState: 'POSSIBLE',
        replayPolicy: 'NO_AUTOMATIC_REEXECUTION_AFTER_DISPATCH',
        effectMayHaveOccurred: true,
      },
    };
    const result = {
      outcome: 'SUCCEEDED' as const,
      actualUsage: 2n,
      evidence: [
        {
          purpose: 'EXECUTION' as const,
          type: 'CHECKSUM' as const,
          strength: 'STRONG' as const,
          producer: 'executor-a',
          contentHash: 'sha256:proof',
        },
      ],
      effectMayHaveOccurred: true,
    };
    const recordExecutionFailure = vi.fn();
    const recordPostExecutionPersistenceFailure = vi.fn(
      async (
        _context: TrustedOrganizationContext,
        receivedClaim: ExecutionClaim,
        receivedResult: typeof result | null,
      ) => {
        expect(receivedClaim.attempt.executionPhase).toBe('DISPATCHED');
        expect(receivedResult).toEqual(result);
        task = makeTask('FAILED', 7);
        return task;
      },
    );
    const store = {
      getTask: vi.fn(async () => task),
      claimExecution: vi.fn(async () => claim),
      dispatchExecution: vi.fn(async () => dispatched),
      recordExecutionSuccess: vi.fn(async () => {
        throw new Error('DATABASE_WRITE_FAILED');
      }),
      recordExecutionFailure,
      recordPostExecutionPersistenceFailure,
    } as unknown as KernelStore;
    const execute = vi.fn(async () => result);
    const runner = new TaskRunner(
      makeDependencies(store, { 'executor-a': { execute } }),
    );

    const final = await runner.run(context, task.id, {
      idempotencyKey: 'post-execution-failure',
      requestHash: 'hash:post-execution-failure',
    });

    expect(final.state).toBe('FAILED');
    expect(execute).toHaveBeenCalledOnce();
    expect(recordPostExecutionPersistenceFailure).toHaveBeenCalledOnce();
    expect(recordExecutionFailure).not.toHaveBeenCalled();
  });

  it('treats an executor exception after DISPATCHED as an unknown possible effect', async () => {
    let task = makeTask('GATED', 4);
    const claim = makeExecutionClaim(task);
    const dispatched: ExecutionClaim = {
      ...claim,
      task: { ...task, version: task.version + 1 },
      attempt: {
        ...claim.attempt,
        dispatchedAt: new Date('2026-07-28T00:00:01.000Z'),
        executionPhase: 'DISPATCHED',
        effectState: 'POSSIBLE',
        replayPolicy: 'NO_AUTOMATIC_REEXECUTION_AFTER_DISPATCH',
        effectMayHaveOccurred: true,
      },
    };
    const recordExecutionFailure = vi.fn();
    const recordPostExecutionPersistenceFailure = vi.fn(
      async (
        _context: TrustedOrganizationContext,
        receivedClaim: ExecutionClaim,
        receivedResult: unknown,
        failureCode: string,
      ) => {
        expect(receivedClaim.attempt.executionPhase).toBe('DISPATCHED');
        expect(receivedResult).toBeNull();
        expect(failureCode).toBe('EXECUTOR_CONNECTION_LOST');
        task = makeTask('FAILED', 7);
        return task;
      },
    );
    const store = {
      getTask: vi.fn(async () => task),
      claimExecution: vi.fn(async () => claim),
      dispatchExecution: vi.fn(async () => dispatched),
      recordExecutionFailure,
      recordPostExecutionPersistenceFailure,
    } as unknown as KernelStore;
    const execute = vi.fn(async () => {
      throw new Error('EXECUTOR_CONNECTION_LOST');
    });
    const runner = new TaskRunner(
      makeDependencies(store, { 'executor-a': { execute } }),
    );

    const final = await runner.run(context, task.id, {
      idempotencyKey: 'executor-connection-lost',
      requestHash: 'hash:executor-connection-lost',
    });

    expect(final.state).toBe('FAILED');
    expect(execute).toHaveBeenCalledOnce();
    expect(recordPostExecutionPersistenceFailure).toHaveBeenCalledOnce();
    expect(recordExecutionFailure).not.toHaveBeenCalled();
  });

  it('propagates POST_EXECUTION_PERSISTENCE_FAILURE when reconciliation cannot be recorded', async () => {
    const task = makeTask('GATED', 4);
    const claim = makeExecutionClaim(task);
    const dispatched: ExecutionClaim = {
      ...claim,
      task: { ...task, version: task.version + 1 },
      attempt: {
        ...claim.attempt,
        dispatchedAt: new Date('2026-07-28T00:00:01.000Z'),
        executionPhase: 'DISPATCHED',
        effectState: 'POSSIBLE',
        replayPolicy: 'NO_AUTOMATIC_REEXECUTION_AFTER_DISPATCH',
        effectMayHaveOccurred: true,
      },
    };
    const recordExecutionFailure = vi.fn();
    const store = {
      getTask: vi.fn(async () => task),
      claimExecution: vi.fn(async () => claim),
      dispatchExecution: vi.fn(async () => dispatched),
      recordExecutionSuccess: vi.fn(async () => {
        throw new Error('DATABASE_WRITE_FAILED');
      }),
      recordExecutionFailure,
      recordPostExecutionPersistenceFailure: vi.fn(async () => {
        throw new Error('DATABASE_STILL_UNAVAILABLE');
      }),
    } as unknown as KernelStore;
    const execute = vi.fn(async () => ({
      outcome: 'SUCCEEDED' as const,
      actualUsage: 2n,
      evidence: [
        {
          purpose: 'EXECUTION' as const,
          type: 'CHECKSUM' as const,
          strength: 'STRONG' as const,
          producer: 'executor-a',
          contentHash: 'sha256:proof',
        },
      ],
      effectMayHaveOccurred: true,
    }));
    const runner = new TaskRunner(
      makeDependencies(store, { 'executor-a': { execute } }),
    );

    await expect(
      runner.run(context, task.id, {
        idempotencyKey: 'reconciliation-write-failure',
        requestHash: 'hash:reconciliation-write-failure',
      }),
    ).rejects.toThrow('POST_EXECUTION_PERSISTENCE_FAILURE');
    expect(execute).toHaveBeenCalledOnce();
    expect(recordExecutionFailure).not.toHaveBeenCalled();
  });

  it('resumes from the frozen approval without reloading providers', async () => {
    const blocked = {
      ...makeTask('BLOCKED', 5),
      blockReason: 'AWAITING_APPROVAL' as const,
    };
    const resumeApproved = vi.fn(async () => ({
      ...blocked,
      state: 'GATED' as const,
      blockReason: null,
      version: blocked.version + 1,
    }));
    const store = { resumeApproved } as unknown as KernelStore;
    const providerCall = vi.fn(() => {
      throw new Error('PROVIDER_MUST_NOT_BE_CALLED_ON_RESUME');
    });
    const runner = new TaskRunner({
      ...makeDependencies(store, {}),
      catalogProvider: { loadCurrentCatalog: providerCall },
      policyProvider: { loadEffectivePolicy: providerCall },
      pricingProvider: { loadCurrentPricing: providerCall },
    });

    const result = await runner.resume(context, blocked.id, {
      idempotencyKey: 'resume',
      requestHash: 'hash:resume',
    });

    expect(result.state).toBe('GATED');
    expect(resumeApproved).toHaveBeenCalledOnce();
    expect(providerCall).not.toHaveBeenCalled();
  });

  it('persists provider failures as Task data', async () => {
    let task = makeTask('CLASSIFIED', 2);
    const failTask = vi.fn(
      async (
        _context: TrustedOrganizationContext,
        _expected: Task,
        failureCode: string,
      ) => {
        expect(failureCode).toBe('CATALOG_UNAVAILABLE');
        task = makeTask('FAILED', 3);
        return task;
      },
    );
    const store = {
      getTask: vi.fn(async () => task),
      failTask,
    } as unknown as KernelStore;
    const runner = new TaskRunner({
      ...makeDependencies(store, {}),
      catalogProvider: {
        loadCurrentCatalog: async () => {
          throw new Error('CATALOG_UNAVAILABLE');
        },
      },
      policyProvider: {
        loadEffectivePolicy: async () => ({
          policyId: 'policy',
          version: '1',
          maxRisk: 'R3',
          blockedSkillIds: [],
          preferredSkillIds: [],
          approvalRequiredAtOrAbove: 'R3',
          snapshot: {},
        }),
      },
    });

    const result = await runner.run(context, task.id, {
      idempotencyKey: 'provider-failure',
      requestHash: 'hash:provider-failure',
    });

    expect(result.state).toBe('FAILED');
    expect(failTask).toHaveBeenCalledOnce();
  });
});

function makeDependencies(
  store: KernelStore,
  executors: TaskRunnerDependencies['executors'],
): TaskRunnerDependencies {
  return {
    store,
    catalogProvider: {
      loadCurrentCatalog: async () => ({ version: 'unused', skills: [] }),
    },
    policyProvider: {
      loadEffectivePolicy: async () => {
        throw new Error('unused');
      },
    },
    pricingProvider: {
      loadCurrentPricing: async () => {
        throw new Error('unused');
      },
    },
    eligibilityProvider: { isEligible: async () => true },
    executors,
    clock: { now: () => new Date('2026-07-28T00:00:00.000Z') },
    identifiers: { next: () => 'id' },
    workerId: 'worker',
    leaseMilliseconds: 60_000,
  };
}

function makeTask(state: Task['state'], version: number): Task {
  return {
    id: 'task-1',
    organizationId: 'org-1',
    intent: 'demo.run',
    instruction: null,
    inputs: {},
    riskLevel: 'R1',
    maturity: 'SIMULATION',
    state,
    blockReason: null,
    version,
    eventSequence: BigInt(version),
    correlationId: 'correlation-1',
    supersedesTaskId: null,
    createdAt: new Date('2026-07-28T00:00:00.000Z'),
    updatedAt: new Date('2026-07-28T00:00:00.000Z'),
  };
}

function makeExecutionClaim(task: Task): ExecutionClaim {
  return {
    task,
    decision: makeDecision(task),
    attempt: {
      id: 'attempt-1',
      taskId: task.id,
      organizationId: task.organizationId,
      idempotencyKey: 'stable-execution-key',
      status: 'CLAIMED',
      claimedAt: new Date('2026-07-28T00:00:00.000Z'),
      claimedBy: 'worker',
      leaseExpiresAt: new Date('2026-07-28T00:01:00.000Z'),
      dispatchedAt: null,
      executionPhase: 'CLAIMED',
      effectState: 'NONE',
      replayPolicy: 'ALLOW_BEFORE_DISPATCH',
      claims: 1,
      actualUsage: null,
      chargedCredits: null,
      overrunCredits: null,
      providerCostMinor: null,
      providerCostCurrency: null,
      effectMayHaveOccurred: false,
    },
    acquired: true,
  };
}

function makeDecision(task: Task): FrozenDecision {
  return {
    id: 'decision-1',
    taskId: task.id,
    organizationId: task.organizationId,
    canonicalIntent: task.intent,
    chosenSkillId: 'skill-a',
    chosenSkillVersion: '1',
    chosenExecutorRef: 'executor-a',
    executorVersion: '1',
    skillManifestHash: 'manifest',
    toolId: 'tool-a',
    toolVersion: '1',
    modelRef: null,
    rankedFallbacks: [],
    catalogVersion: '1',
    policyId: 'policy',
    policyVersion: '1',
    policySnapshot: {},
    pricingVersion: '1',
    pricingSnapshot: {},
    estimatedCredits: 10n,
    reservedMaximum: 10n,
    validUntil: new Date('2026-07-29T00:00:00.000Z'),
    riskLevel: task.riskLevel,
    maturity: task.maturity,
    requiredEvidence: {
      types: ['CHECKSUM'],
      minimumStrength: 'STRONG',
      producerMustMatchExecutor: true,
    },
    requiredScopes: [],
    approvalRequired: false,
    decisionInputsHash: 'inputs',
    decisionHash: 'decision',
    algorithmVersion: 'v1',
    capabilityGapReason: null,
    resolvedAt: new Date('2026-07-28T00:00:00.000Z'),
  };
}
