import {
  createApprovalEnvelope,
  validateApprovalEnvelope,
} from './approval.js';
import { freezeDecision, resolveSkill } from './decision.js';
import type {
  CommandMetadata,
  ExecutionResult,
  Task,
  TrustedOrganizationContext,
} from './domain.js';
import { validateExecutionEvidence } from './evidence.js';
import type {
  ClockPort,
  EffectivePolicyProvider,
  ExecutionClaim,
  ExecutorEligibilityProvider,
  IdentifierPort,
  KernelStore,
  PricingProvider,
  SkillCatalogProvider,
  SkillExecutor,
} from './ports.js';

export interface TaskRunnerDependencies {
  readonly store: KernelStore;
  readonly catalogProvider: SkillCatalogProvider;
  readonly policyProvider: EffectivePolicyProvider;
  readonly pricingProvider: PricingProvider;
  readonly eligibilityProvider: ExecutorEligibilityProvider;
  readonly executors: Readonly<Record<string, SkillExecutor>>;
  readonly clock: ClockPort;
  readonly identifiers: IdentifierPort;
  readonly workerId: string;
  readonly leaseMilliseconds: number;
}

export class TaskRunner {
  public constructor(private readonly dependencies: TaskRunnerDependencies) {}

  public async run(
    context: TrustedOrganizationContext,
    taskId: string,
    command: CommandMetadata,
  ): Promise<Task> {
    for (let step = 0; step < 12; step += 1) {
      const task = await this.dependencies.store.getTask(context, taskId);
      if (task === null) {
        throw new Error('TASK_NOT_FOUND');
      }

      switch (task.state) {
        case 'INGESTED':
          await this.dependencies.store.classifyTask(context, task, command);
          break;
        case 'CLASSIFIED':
          await this.runOrPersistFailure(context, task, command, () =>
            this.plan(context, task, command),
          );
          break;
        case 'PLANNED':
          await this.runOrPersistFailure(context, task, command, () =>
            this.gate(context, task, command),
          );
          break;
        case 'BLOCKED':
        case 'COMMITTED':
        case 'FAILED':
          return task;
        case 'GATED':
          if (!(await this.execute(context, task, command))) {
            return (
              (await this.dependencies.store.getTask(context, task.id)) ?? task
            );
          }
          break;
        case 'EXECUTED':
          await this.runOrPersistFailure(context, task, command, () =>
            this.verify(context, task, command),
          );
          break;
        case 'VERIFIED':
          await this.commit(context, task, command);
          break;
        default: {
          const exhaustive: never = task.state;
          throw new Error(`UNKNOWN_TASK_STATE:${String(exhaustive)}`);
        }
      }
    }

    throw new Error('RUNNER_STEP_LIMIT');
  }

  public approve(
    context: TrustedOrganizationContext,
    taskId: string,
    approvalEnvelopeId: string,
    reason: string | null,
    command: CommandMetadata,
  ): Promise<Task> {
    return this.dependencies.store.approveAndTryGate(
      context,
      taskId,
      approvalEnvelopeId,
      reason,
      command,
    );
  }

  public resume(
    context: TrustedOrganizationContext,
    taskId: string,
    command: CommandMetadata,
  ): Promise<Task> {
    return this.dependencies.store.resumeApproved(context, taskId, command);
  }

  public reject(
    context: TrustedOrganizationContext,
    taskId: string,
    approvalEnvelopeId: string,
    reason: string | null,
    command: CommandMetadata,
  ): Promise<Task> {
    return this.dependencies.store.reject(
      context,
      taskId,
      approvalEnvelopeId,
      reason,
      command,
    );
  }

  private async plan(
    context: TrustedOrganizationContext,
    task: Task,
    command: CommandMetadata,
  ): Promise<void> {
    const resolutionContext = {
      organizationId: context.organizationId,
      taskId: task.id,
      intent: task.intent,
    };
    const [catalog, policy] = await Promise.all([
      this.dependencies.catalogProvider.loadCurrentCatalog(resolutionContext),
      this.dependencies.policyProvider.loadEffectivePolicy(resolutionContext),
    ]);

    const eligibleSkills = [];
    for (const skill of catalog.skills) {
      if (await this.dependencies.eligibilityProvider.isEligible(skill)) {
        eligibleSkills.push(skill);
      }
    }
    const eligibleCatalog = { ...catalog, skills: eligibleSkills };
    const resolution = resolveSkill(task, eligibleCatalog, policy);
    const pricing =
      resolution.chosen === null
        ? null
        : await this.dependencies.pricingProvider.loadCurrentPricing({
            ...resolutionContext,
            skill: resolution.chosen,
          });
    const decision = freezeDecision({
      id: this.dependencies.identifiers.next(),
      task,
      catalog: eligibleCatalog,
      policy,
      resolution,
      pricing,
      resolvedAt: this.dependencies.clock.now(),
    });
    await this.dependencies.store.freezeDecision(
      context,
      task,
      decision,
      command,
    );
  }

  private async gate(
    context: TrustedOrganizationContext,
    task: Task,
    command: CommandMetadata,
  ): Promise<void> {
    const decision = await this.dependencies.store.getFrozenDecision(
      context,
      task.id,
    );
    if (decision === null) {
      throw new Error('FROZEN_DECISION_NOT_FOUND');
    }

    if (decision.approvalRequired) {
      const envelope = createApprovalEnvelope({
        id: this.dependencies.identifiers.next(),
        decision,
        createdAt: this.dependencies.clock.now(),
      });
      await this.dependencies.store.blockForApproval(
        context,
        task,
        envelope,
        command,
      );
      return;
    }

    await this.dependencies.store.gateAutomatically(
      context,
      task,
      decision,
      command,
    );
  }

  private async execute(
    context: TrustedOrganizationContext,
    task: Task,
    command: CommandMetadata,
  ): Promise<boolean> {
    const leaseUntil = new Date(
      this.dependencies.clock.now().getTime() +
        this.dependencies.leaseMilliseconds,
    );
    const claim = await this.dependencies.store.claimExecution(
      context,
      task,
      this.dependencies.workerId,
      leaseUntil,
      command,
    );
    if (!claim.acquired) {
      return false;
    }

    const executorRef = claim.decision.chosenExecutorRef;
    if (executorRef === null) {
      await this.dependencies.store.recordExecutionFailure(
        context,
        claim,
        null,
        'EXECUTOR_NOT_FROZEN',
        command,
      );
      return true;
    }
    const executor = this.dependencies.executors[executorRef];
    if (executor === undefined) {
      await this.dependencies.store.recordExecutionFailure(
        context,
        claim,
        null,
        'EXECUTOR_NOT_CONFIGURED',
        command,
      );
      return true;
    }

    const dispatched = await this.dependencies.store.dispatchExecution(
      context,
      claim,
      command,
    );
    if (!dispatched.acquired) {
      return false;
    }

    let result: ExecutionResult;
    try {
      result = await executor.execute({
        task: dispatched.task,
        decision: dispatched.decision,
        attemptId: dispatched.attempt.id,
        idempotencyKey: dispatched.attempt.idempotencyKey,
        maximumCredits: dispatched.decision.reservedMaximum,
      });
    } catch (error) {
      await this.persistReconciliationOrThrow(
        context,
        dispatched,
        null,
        errorCode(error),
        command,
      );
      return true;
    }

    try {
      if (result.actualUsage > dispatched.decision.reservedMaximum) {
        await this.dependencies.store.recordBudgetOverrun(
          context,
          dispatched,
          result,
          command,
        );
        return true;
      }

      const evidence = validateExecutionEvidence(
        result.evidence,
        dispatched.decision.requiredEvidence,
        executorRef,
      );
      if (result.outcome === 'FAILED' || !evidence.ok) {
        await this.dependencies.store.recordExecutionFailure(
          context,
          dispatched,
          result,
          result.failureCode ?? evidence.code ?? 'EXECUTION_FAILED',
          command,
        );
        return true;
      }

      await this.dependencies.store.recordExecutionSuccess(
        context,
        dispatched,
        result,
        command,
      );
    } catch (error) {
      await this.persistReconciliationOrThrow(
        context,
        dispatched,
        result,
        errorCode(error),
        command,
      );
    }
    return true;
  }

  private async verify(
    context: TrustedOrganizationContext,
    task: Task,
    command: CommandMetadata,
  ): Promise<void> {
    await this.dependencies.store.markVerified({
      context,
      taskId: task.id,
      expectedVersion: task.version,
      idempotencyKey: command.idempotencyKey,
    });
  }

  private async commit(
    context: TrustedOrganizationContext,
    task: Task,
    command: CommandMetadata,
  ): Promise<void> {
    await this.dependencies.store.commitTask({
      context,
      taskId: task.id,
      expectedVersion: task.version,
      idempotencyKey: command.idempotencyKey,
    });
  }

  private async persistReconciliationOrThrow(
    context: TrustedOrganizationContext,
    claim: ExecutionClaim,
    result: ExecutionResult | null,
    failureCode: string,
    command: CommandMetadata,
  ): Promise<void> {
    try {
      await this.dependencies.store.recordPostExecutionPersistenceFailure(
        context,
        claim,
        result,
        failureCode,
        command,
      );
    } catch {
      throw new Error('POST_EXECUTION_PERSISTENCE_FAILURE');
    }
  }

  private async runOrPersistFailure(
    context: TrustedOrganizationContext,
    task: Task,
    command: CommandMetadata,
    operation: () => Promise<void>,
  ): Promise<void> {
    try {
      await operation();
    } catch (error) {
      await this.dependencies.store.failTask(
        context,
        task,
        errorCode(error),
        command,
      );
    }
  }
}

export { validateApprovalEnvelope };

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'UNKNOWN_FAILURE';
  }
  return /^[A-Z][A-Z0-9_:.-]*$/u.test(error.message)
    ? error.message
    : error.name;
}
