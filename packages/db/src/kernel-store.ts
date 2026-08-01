import { randomUUID } from 'node:crypto';

import {
  hashCanonicalJson,
  assertFrozenDecisionIntegrity,
  validateApprovalAuthorization,
  validateApprovalEnvelope,
  validateExecutionEvidence,
  canTaskTransition,
  type ApprovalEnvelope,
  type ClockPort,
  type CommandMetadata,
  type CreateTaskInput,
  type EvidenceDraft,
  type ExecutionClaim,
  type ExecutionResult,
  type ExecutionSnapshot,
  type FrozenDecision,
  type JsonValue,
  type KernelStore,
  type PersistedEvidence,
  type PersistedTaskEvent,
  type Task,
  type TaskBlockReason,
  type TaskState,
  type TrustedOrganizationContext,
  type VersionedTaskCommand,
} from '@connect/core';

import type { DatabaseClient } from './client.js';
import { KernelPersistenceError } from './errors.js';
import {
  Prisma,
  type Task as DatabaseTask,
} from './generated/prisma/client.js';
import {
  toApprovalEnvelope,
  toEvidence,
  toExecutionAttempt,
  toFrozenDecision,
  toTask,
  toTaskEvent,
} from './mappers.js';
import { inSerializableTransaction } from './transaction.js';

interface EventSpec {
  readonly name: string;
  readonly toState: TaskState | null;
  readonly payload?: Readonly<Record<string, JsonValue>>;
}

interface ReservedCredits {
  readonly acquired: boolean;
  readonly reservationId: string | null;
}

type Transaction = Prisma.TransactionClient;

export class PrismaKernelStore implements KernelStore {
  public constructor(
    private readonly client: DatabaseClient,
    private readonly clock: ClockPort = { now: () => new Date() },
  ) {}

  public async createTask(
    context: TrustedOrganizationContext,
    input: CreateTaskInput,
    command: CommandMetadata,
  ): Promise<Task> {
    return inSerializableTransaction(this.client, async (transaction) => {
      const previous = await this.readReceiptTask(
        transaction,
        context,
        'task.create',
        command,
      );
      if (previous !== null) {
        return previous;
      }

      const taskId = randomUUID();
      const task = await transaction.task.create({
        data: {
          id: taskId,
          organizationId: context.organizationId,
          intent: input.intent,
          instruction: input.instruction ?? null,
          inputs: asInputJson(input.inputs),
          riskLevel: input.riskLevel,
          maturity: input.maturity,
          state: 'INGESTED',
          version: 1,
          eventSequence: 1n,
          correlationId: context.correlationId,
          supersedesTaskId: input.supersedesTaskId ?? null,
        },
      });
      await this.persistEvents(
        transaction,
        task,
        'INGESTED',
        1n,
        context,
        command,
        [
          {
            name: 'task.ingested',
            toState: null,
            payload: { intent: input.intent },
          },
        ],
      );
      const created = toTask(task);
      await this.writeReceipt(
        transaction,
        context,
        'task.create',
        command,
        created,
      );
      return created;
    });
  }

  public async getTask(
    context: TrustedOrganizationContext,
    taskId: string,
  ): Promise<Task | null> {
    const task = await this.client.task.findFirst({
      where: { id: taskId, organizationId: context.organizationId },
    });
    return task === null ? null : toTask(task);
  }

  public async getFrozenDecision(
    context: TrustedOrganizationContext,
    taskId: string,
  ): Promise<FrozenDecision | null> {
    const decision = await this.client.frozenDecision.findFirst({
      where: { taskId, organizationId: context.organizationId },
    });
    return decision === null ? null : toFrozenDecision(decision);
  }

  public appendInformationalEvent(
    context: TrustedOrganizationContext,
    task: Task,
    name: InformationalTaskEventName,
    payload: Readonly<Record<string, JsonValue>>,
    command: CommandMetadata,
  ): Promise<Task> {
    return this.runTaskCommand(
      context,
      task.id,
      `task.inform:${name}`,
      command,
      async (transaction) =>
        this.advanceTask(transaction, context, task, null, null, command, [
          { name, toState: null, payload },
        ]),
    );
  }

  public classifyTask(
    context: TrustedOrganizationContext,
    task: Task,
    command: CommandMetadata,
  ): Promise<Task> {
    return this.runTaskCommand(
      context,
      task.id,
      'task.classify',
      command,
      async (transaction) =>
        this.advanceTask(
          transaction,
          context,
          task,
          'CLASSIFIED',
          null,
          command,
          [{ name: 'task.classified', toState: 'CLASSIFIED' }],
        ),
    );
  }

  public failTask(
    context: TrustedOrganizationContext,
    task: Task,
    failureCode: string,
    command: CommandMetadata,
  ): Promise<Task> {
    return this.runTaskCommand(
      context,
      task.id,
      `task.fail:${task.state}`,
      command,
      async (transaction) =>
        this.advanceTask(transaction, context, task, 'FAILED', null, command, [
          {
            name: 'task.failed',
            toState: 'FAILED',
            payload: { failureCode },
          },
        ]),
    );
  }

  public freezeDecision(
    context: TrustedOrganizationContext,
    task: Task,
    decision: FrozenDecision,
    command: CommandMetadata,
  ): Promise<Task> {
    return this.runTaskCommand(
      context,
      task.id,
      'task.freeze_decision',
      command,
      async (transaction) => {
        this.assertTenant(context, decision.organizationId);
        if (decision.taskId !== task.id) {
          throw new KernelPersistenceError('DECISION_TASK_MISMATCH');
        }
        assertFrozenDecisionIntegrity(decision);
        await transaction.frozenDecision.create({
          data: {
            id: decision.id,
            organizationId: decision.organizationId,
            taskId: decision.taskId,
            canonicalIntent: decision.canonicalIntent,
            chosenSkillId: decision.chosenSkillId,
            chosenSkillVersion: decision.chosenSkillVersion,
            chosenExecutorRef: decision.chosenExecutorRef,
            executorVersion: decision.executorVersion,
            skillManifestHash: decision.skillManifestHash,
            toolId: decision.toolId,
            toolVersion: decision.toolVersion,
            modelRef: decision.modelRef,
            rankedFallbacks: asInputJson(decision.rankedFallbacks),
            catalogVersion: decision.catalogVersion,
            policyId: decision.policyId,
            policyVersion: decision.policyVersion,
            policySnapshot: asInputJson(decision.policySnapshot),
            pricingVersion: decision.pricingVersion,
            pricingSnapshot:
              decision.pricingSnapshot === null
                ? Prisma.DbNull
                : asInputJson(decision.pricingSnapshot),
            estimatedCredits: decision.estimatedCredits,
            reservedMaximum: decision.reservedMaximum,
            validUntil: decision.validUntil,
            riskLevel: decision.riskLevel,
            maturity: decision.maturity,
            requiredEvidence: asInputJson(decision.requiredEvidence),
            requiredScopes: asInputJson(decision.requiredScopes),
            approvalRequired: decision.approvalRequired,
            decisionInputsHash: decision.decisionInputsHash,
            decisionHash: decision.decisionHash,
            algorithmVersion: decision.algorithmVersion,
            capabilityGapReason: decision.capabilityGapReason,
            resolvedAt: decision.resolvedAt,
          },
        });

        const capabilityGap = decision.chosenSkillId === null;
        return this.advanceTask(
          transaction,
          context,
          task,
          capabilityGap ? 'BLOCKED' : 'PLANNED',
          capabilityGap ? 'CAPABILITY_GAP' : null,
          command,
          [
            {
              name: 'decision.frozen',
              toState: null,
              payload: { decisionHash: decision.decisionHash },
            },
            {
              name: capabilityGap ? 'task.blocked' : 'task.planned',
              toState: capabilityGap ? 'BLOCKED' : 'PLANNED',
              payload: capabilityGap
                ? { reason: decision.capabilityGapReason ?? 'CAPABILITY_GAP' }
                : {},
            },
          ],
        );
      },
    );
  }

  public blockForApproval(
    context: TrustedOrganizationContext,
    task: Task,
    envelope: ApprovalEnvelope,
    command: CommandMetadata,
  ): Promise<Task> {
    return this.runTaskCommand(
      context,
      task.id,
      'task.request_approval',
      command,
      async (transaction) => {
        this.assertTenant(context, envelope.organizationId);
        if (task.state !== 'PLANNED') {
          throw new KernelPersistenceError('APPROVAL_GATE_REQUIRES_PLANNED');
        }
        const decision = await this.requireDecision(
          transaction,
          context,
          task.id,
        );
        if (!decision.approvalRequired) {
          throw new KernelPersistenceError('APPROVAL_NOT_REQUIRED');
        }
        validateApprovalEnvelope(envelope, decision, envelope.createdAt);
        await transaction.approvalEnvelope.create({
          data: {
            id: envelope.id,
            organizationId: envelope.organizationId,
            taskId: envelope.taskId,
            frozenDecisionId: envelope.frozenDecisionId,
            decisionHash: envelope.decisionHash,
            policyVersion: envelope.policyVersion,
            pricingVersion: envelope.pricingVersion,
            toolVersion: envelope.toolVersion,
            executorVersion: envelope.executorVersion,
            estimatedCredits: envelope.estimatedCredits,
            reservedMaximum: envelope.reservedMaximum,
            requiredScopes: asInputJson(envelope.requiredScopes),
            validUntil: envelope.validUntil,
            envelopeHash: envelope.envelopeHash,
            createdAt: envelope.createdAt,
          },
        });
        return this.advanceTask(
          transaction,
          context,
          task,
          'BLOCKED',
          'AWAITING_APPROVAL',
          command,
          [
            {
              name: 'approval.requested',
              toState: null,
              payload: { approvalEnvelopeId: envelope.id },
            },
            { name: 'task.blocked', toState: 'BLOCKED' },
          ],
        );
      },
    );
  }

  public gateAutomatically(
    context: TrustedOrganizationContext,
    task: Task,
    decision: FrozenDecision,
    command: CommandMetadata,
  ): Promise<Task> {
    return this.runTaskCommand(
      context,
      task.id,
      'task.auto_gate',
      command,
      async (transaction) => {
        if (
          task.state !== 'PLANNED' ||
          decision.approvalRequired ||
          decision.chosenSkillId === null
        ) {
          throw new KernelPersistenceError('AUTOMATIC_GATE_NOT_ALLOWED');
        }
        const reservation = await this.reserveCredits(
          transaction,
          context.organizationId,
          task.id,
          decision,
          command.idempotencyKey,
        );
        if (!reservation.acquired) {
          return this.advanceTask(
            transaction,
            context,
            task,
            'FAILED',
            null,
            command,
            [
              {
                name: 'task.gate_failed',
                toState: null,
                payload: { code: 'INSUFFICIENT_CREDITS' },
              },
              {
                name: 'task.failed',
                toState: 'FAILED',
                payload: { code: 'INSUFFICIENT_CREDITS' },
              },
            ],
          );
        }
        return this.advanceTask(
          transaction,
          context,
          task,
          'GATED',
          null,
          command,
          [
            {
              name: 'credits.reserved',
              toState: null,
              payload: { reservationId: reservation.reservationId ?? '' },
            },
            { name: 'task.gated', toState: 'GATED' },
          ],
        );
      },
    );
  }

  public approveAndTryGate(
    context: TrustedOrganizationContext,
    taskId: string,
    approvalEnvelopeId: string,
    reason: string | null,
    command: CommandMetadata,
  ): Promise<Task> {
    return this.runTaskCommand(
      context,
      taskId,
      'approval.approve',
      command,
      async (transaction) => {
        const loaded = await this.loadApprovalContext(
          transaction,
          context,
          taskId,
          approvalEnvelopeId,
        );
        const invalid = approvalAuthorizationInvalidCode(
          context,
          loaded.envelope,
          loaded.decision,
          this.clock.now(),
        );
        if (invalid === 'APPROVAL_SCOPE_REQUIRED') {
          throw new KernelPersistenceError(invalid);
        }
        if (invalid !== null) {
          return this.advanceTask(
            transaction,
            context,
            loaded.task,
            'FAILED',
            null,
            command,
            [
              {
                name: 'approval.invalid',
                toState: null,
                payload: { code: invalid },
              },
              {
                name: 'task.failed',
                toState: 'FAILED',
                payload: { code: invalid },
              },
            ],
          );
        }

        await this.insertApprovalDecision(
          transaction,
          context,
          loaded.envelope,
          'APPROVED',
          reason,
          command,
        );
        const reservation = await this.reserveCredits(
          transaction,
          context.organizationId,
          taskId,
          loaded.decision,
          command.idempotencyKey,
        );
        if (!reservation.acquired) {
          return this.advanceTask(
            transaction,
            context,
            loaded.task,
            null,
            'AWAITING_APPROVAL',
            command,
            [
              { name: 'approval.approved', toState: null },
              {
                name: 'task.resume_failed',
                toState: null,
                payload: { code: 'INSUFFICIENT_CREDITS' },
              },
            ],
          );
        }
        return this.advanceTask(
          transaction,
          context,
          loaded.task,
          'GATED',
          null,
          command,
          [
            { name: 'approval.approved', toState: null },
            {
              name: 'credits.reserved',
              toState: null,
              payload: { reservationId: reservation.reservationId ?? '' },
            },
            { name: 'task.gated', toState: 'GATED' },
          ],
        );
      },
    );
  }

  public resumeApproved(
    context: TrustedOrganizationContext,
    taskId: string,
    command: CommandMetadata,
  ): Promise<Task> {
    return this.runTaskCommand(
      context,
      taskId,
      'approval.resume',
      command,
      async (transaction) => {
        const row = await transaction.task.findFirst({
          where: { id: taskId, organizationId: context.organizationId },
        });
        if (row === null) {
          throw new KernelPersistenceError('TASK_NOT_FOUND');
        }
        if (
          row.state !== 'BLOCKED' ||
          row.blockReason !== 'AWAITING_APPROVAL'
        ) {
          throw new KernelPersistenceError('APPROVAL_RESUME_NOT_ALLOWED');
        }
        const envelopeRow = await transaction.approvalEnvelope.findFirst({
          where: { taskId, organizationId: context.organizationId },
          include: { decision: true, frozenDecision: true },
        });
        if (
          envelopeRow === null ||
          envelopeRow.decision?.verdict !== 'APPROVED'
        ) {
          throw new KernelPersistenceError('APPROVAL_NOT_GRANTED');
        }
        const envelope = toApprovalEnvelope(envelopeRow);
        const decision = toFrozenDecision(envelopeRow.frozenDecision);
        const invalid = approvalInvalidCode(
          envelope,
          decision,
          this.clock.now(),
        );
        if (invalid !== null) {
          return this.advanceTask(
            transaction,
            context,
            toTask(row),
            'FAILED',
            null,
            command,
            [
              {
                name: 'task.resume_failed',
                toState: null,
                payload: { code: invalid },
              },
              {
                name: 'task.failed',
                toState: 'FAILED',
                payload: { code: invalid },
              },
            ],
          );
        }
        const reservation = await this.reserveCredits(
          transaction,
          context.organizationId,
          taskId,
          decision,
          command.idempotencyKey,
        );
        if (!reservation.acquired) {
          return this.advanceTask(
            transaction,
            context,
            toTask(row),
            null,
            'AWAITING_APPROVAL',
            command,
            [
              {
                name: 'task.resume_failed',
                toState: null,
                payload: { code: 'INSUFFICIENT_CREDITS' },
              },
            ],
          );
        }
        return this.advanceTask(
          transaction,
          context,
          toTask(row),
          'GATED',
          null,
          command,
          [
            {
              name: 'credits.reserved',
              toState: null,
              payload: { reservationId: reservation.reservationId ?? '' },
            },
            { name: 'task.gated', toState: 'GATED' },
          ],
        );
      },
    );
  }

  public reject(
    context: TrustedOrganizationContext,
    taskId: string,
    approvalEnvelopeId: string,
    reason: string | null,
    command: CommandMetadata,
  ): Promise<Task> {
    return this.runTaskCommand(
      context,
      taskId,
      'approval.reject',
      command,
      async (transaction) => {
        const loaded = await this.loadApprovalContext(
          transaction,
          context,
          taskId,
          approvalEnvelopeId,
        );
        this.assertApprovalAuthorization(
          context,
          loaded.envelope,
          loaded.decision,
        );
        await this.insertApprovalDecision(
          transaction,
          context,
          loaded.envelope,
          'REJECTED',
          reason,
          command,
        );
        return this.advanceTask(
          transaction,
          context,
          loaded.task,
          'FAILED',
          null,
          command,
          [
            { name: 'approval.rejected', toState: null },
            {
              name: 'task.failed',
              toState: 'FAILED',
              payload: { code: 'APPROVAL_REJECTED' },
            },
          ],
        );
      },
    );
  }

  public async claimExecution(
    context: TrustedOrganizationContext,
    task: Task,
    workerId: string,
    leaseUntil: Date,
    command: CommandMetadata,
  ): Promise<ExecutionClaim> {
    this.assertTenant(context, task.organizationId);
    return inSerializableTransaction(this.client, async (transaction) => {
      const receipt = await this.findReceipt(
        transaction,
        context,
        'execution.claim',
        command,
      );
      if (receipt !== null) {
        const current = await this.requireTask(transaction, context, task.id);
        const decision = await this.requireDecision(
          transaction,
          context,
          task.id,
        );
        const attempt = await transaction.executionAttempt.findFirstOrThrow({
          where: { taskId: task.id, organizationId: context.organizationId },
        });
        return {
          task: current,
          decision,
          attempt: toExecutionAttempt(attempt),
          acquired: false,
        };
      }
      const commandTask = await this.requireTask(transaction, context, task.id);
      if (commandTask.state !== 'GATED') {
        const decision = await this.requireDecision(
          transaction,
          context,
          task.id,
        );
        const existingAttempt = await transaction.executionAttempt.findFirst({
          where: { taskId: task.id, organizationId: context.organizationId },
        });
        if (existingAttempt === null) {
          throw new KernelPersistenceError('EXECUTION_ATTEMPT_NOT_FOUND');
        }
        return {
          task: commandTask,
          decision,
          attempt: toExecutionAttempt(existingAttempt),
          acquired: false,
        };
      }

      const existing = await transaction.executionAttempt.findFirst({
        where: { taskId: task.id, organizationId: context.organizationId },
      });
      const now = this.clock.now();
      let eventName = 'execution.claimed';
      let attempt;
      if (existing === null) {
        attempt = await transaction.executionAttempt.create({
          data: {
            id: randomUUID(),
            organizationId: context.organizationId,
            taskId: task.id,
            idempotencyKey: `task:${task.id}:execution`,
            status: 'CLAIMED',
            claimedAt: now,
            claimedBy: workerId,
            leaseExpiresAt: leaseUntil,
            claims: 1,
          },
        });
      } else {
        const leaseExpired =
          existing.status === 'CLAIMED' &&
          existing.leaseExpiresAt !== null &&
          existing.leaseExpiresAt.getTime() <= now.getTime();
        if (leaseExpired && existing.executionPhase === 'DISPATCHED') {
          const reconciled = await transaction.executionAttempt.update({
            where: { id: existing.id },
            data: {
              status: 'RECONCILIATION_REQUIRED',
              executionPhase: 'TERMINAL',
              effectState: 'POSSIBLE',
              effectMayHaveOccurred: true,
              failureCode: 'DISPATCHED_LEASE_EXPIRED',
              finishedAt: now,
            },
          });
          const failedTask = await this.advanceTask(
            transaction,
            context,
            commandTask,
            'FAILED',
            null,
            command,
            [
              {
                name: 'execution.reconciliation_required',
                toState: null,
                payload: {
                  attemptId: existing.id,
                  failureCode: 'DISPATCHED_LEASE_EXPIRED',
                },
              },
              {
                name: 'task.failed',
                toState: 'FAILED',
                payload: { failureCode: 'DISPATCHED_LEASE_EXPIRED' },
              },
            ],
          );
          await this.writeReceipt(
            transaction,
            context,
            'execution.claim',
            command,
            failedTask,
          );
          return {
            task: failedTask,
            decision: await this.requireDecision(transaction, context, task.id),
            attempt: toExecutionAttempt(reconciled),
            acquired: false,
          };
        }
        const canReclaim =
          leaseExpired &&
          existing.executionPhase === 'CLAIMED' &&
          existing.dispatchedAt === null &&
          existing.effectState === 'NONE' &&
          existing.replayPolicy === 'ALLOW_BEFORE_DISPATCH' &&
          !existing.effectMayHaveOccurred;
        if (!canReclaim) {
          const current = await this.requireTask(transaction, context, task.id);
          const decision = await this.requireDecision(
            transaction,
            context,
            task.id,
          );
          return {
            task: current,
            decision,
            attempt: toExecutionAttempt(existing),
            acquired: false,
          };
        }
        eventName = 'execution.lease_reclaimed';
        attempt = await transaction.executionAttempt.update({
          where: { id: existing.id },
          data: {
            status: 'CLAIMED',
            claimedAt: now,
            claimedBy: workerId,
            leaseExpiresAt: leaseUntil,
            claims: { increment: 1 },
          },
        });
      }

      const updatedTask = await this.advanceTask(
        transaction,
        context,
        commandTask,
        null,
        null,
        command,
        [
          {
            name: eventName,
            toState: null,
            payload: { attemptId: attempt.id },
          },
        ],
      );
      await this.writeReceipt(
        transaction,
        context,
        'execution.claim',
        command,
        updatedTask,
      );
      return {
        task: updatedTask,
        decision: await this.requireDecision(transaction, context, task.id),
        attempt: toExecutionAttempt(attempt),
        acquired: true,
      };
    });
  }

  public async dispatchExecution(
    context: TrustedOrganizationContext,
    claim: ExecutionClaim,
    command: CommandMetadata,
  ): Promise<ExecutionClaim> {
    this.assertClaimTenant(context, claim);
    return inSerializableTransaction(this.client, async (transaction) => {
      const previous = await this.readReceiptTask(
        transaction,
        context,
        'execution.dispatch',
        command,
      );
      if (previous !== null) {
        const attempt = await transaction.executionAttempt.findFirstOrThrow({
          where: {
            id: claim.attempt.id,
            taskId: claim.task.id,
            organizationId: context.organizationId,
          },
        });
        return {
          task: previous,
          decision: await this.requireDecision(
            transaction,
            context,
            claim.task.id,
          ),
          attempt: toExecutionAttempt(attempt),
          acquired: false,
        };
      }

      const now = this.clock.now();
      const updatedAttempt = await transaction.executionAttempt.updateMany({
        where: {
          id: claim.attempt.id,
          taskId: claim.task.id,
          organizationId: context.organizationId,
          status: 'CLAIMED',
          executionPhase: 'CLAIMED',
          dispatchedAt: null,
        },
        data: {
          dispatchedAt: now,
          executionPhase: 'DISPATCHED',
          effectState: 'POSSIBLE',
          replayPolicy: 'NO_AUTOMATIC_REEXECUTION_AFTER_DISPATCH',
          effectMayHaveOccurred: true,
        },
      });
      if (updatedAttempt.count !== 1) {
        throw new KernelPersistenceError('EXECUTION_DISPATCH_CAS_CONFLICT');
      }
      const updatedTask = await this.advanceTask(
        transaction,
        context,
        claim.task,
        null,
        null,
        command,
        [
          {
            name: 'execution.dispatched',
            toState: null,
            payload: {
              attemptId: claim.attempt.id,
              replayPolicy: 'NO_AUTOMATIC_REEXECUTION_AFTER_DISPATCH',
            },
          },
        ],
      );
      await this.writeReceipt(
        transaction,
        context,
        'execution.dispatch',
        command,
        updatedTask,
      );
      const attempt = await transaction.executionAttempt.findFirstOrThrow({
        where: {
          id: claim.attempt.id,
          taskId: claim.task.id,
          organizationId: context.organizationId,
        },
      });
      return {
        task: updatedTask,
        decision: await this.requireDecision(
          transaction,
          context,
          claim.task.id,
        ),
        attempt: toExecutionAttempt(attempt),
        acquired: true,
      };
    });
  }

  public recordExecutionSuccess(
    context: TrustedOrganizationContext,
    claim: ExecutionClaim,
    result: ExecutionResult,
    command: CommandMetadata,
  ): Promise<Task> {
    this.assertClaimTenant(context, claim);
    return this.runTaskCommand(
      context,
      claim.task.id,
      'execution.succeed',
      command,
      async (transaction) => {
        const decision = await this.requireDecision(
          transaction,
          context,
          claim.task.id,
        );
        const executor = decision.chosenExecutorRef;
        if (
          executor === null ||
          !validateExecutionEvidence(
            result.evidence,
            decision.requiredEvidence,
            executor,
          ).ok
        ) {
          throw new KernelPersistenceError('VALID_EVIDENCE_REQUIRED');
        }
        await this.finishAttempt(
          transaction,
          context,
          claim.attempt.id,
          'SUCCEEDED',
          result,
          null,
          decision.reservedMaximum,
        );
        await this.insertEvidence(
          transaction,
          context,
          claim.task.id,
          claim.attempt.id,
          result.evidence,
        );
        return this.advanceTask(
          transaction,
          context,
          claim.task,
          'EXECUTED',
          null,
          command,
          [
            { name: 'execution.succeeded', toState: null },
            { name: 'task.executed', toState: 'EXECUTED' },
          ],
        );
      },
    );
  }

  public recordExecutionFailure(
    context: TrustedOrganizationContext,
    claim: ExecutionClaim,
    result: ExecutionResult | null,
    failureCode: string,
    command: CommandMetadata,
  ): Promise<Task> {
    this.assertClaimTenant(context, claim);
    return this.runTaskCommand(
      context,
      claim.task.id,
      'execution.fail',
      command,
      async (transaction) => {
        const decision = await this.requireDecision(
          transaction,
          context,
          claim.task.id,
        );
        const persistedAttempt =
          await transaction.executionAttempt.findFirstOrThrow({
            where: {
              id: claim.attempt.id,
              taskId: claim.task.id,
              organizationId: context.organizationId,
            },
          });
        if (
          result === null &&
          persistedAttempt.executionPhase === 'DISPATCHED'
        ) {
          throw new KernelPersistenceError(
            'DISPATCHED_EXECUTION_REQUIRES_RECONCILIATION',
          );
        }
        if (result === null) {
          await this.releaseReservation(
            transaction,
            context.organizationId,
            claim.task.id,
            claim.attempt.id,
            command.idempotencyKey,
          );
        } else {
          await this.settleReservation(
            transaction,
            context.organizationId,
            claim.task.id,
            claim.attempt.id,
            result,
            decision,
            command.idempotencyKey,
          );
          await this.insertEvidence(
            transaction,
            context,
            claim.task.id,
            claim.attempt.id,
            result.evidence,
          );
        }
        await this.finishAttempt(
          transaction,
          context,
          claim.attempt.id,
          result?.effectMayHaveOccurred ? 'RECONCILIATION_REQUIRED' : 'FAILED',
          result,
          failureCode,
          decision.reservedMaximum,
        );
        const events: EventSpec[] = [];
        if (result?.effectMayHaveOccurred) {
          events.push({
            name: 'execution.reconciliation_required',
            toState: null,
            payload: { failureCode },
          });
        }
        events.push(
          { name: 'execution.failed', toState: null, payload: { failureCode } },
          { name: 'task.failed', toState: 'FAILED', payload: { failureCode } },
        );
        return this.advanceTask(
          transaction,
          context,
          claim.task,
          'FAILED',
          null,
          command,
          events,
        );
      },
    );
  }

  public recordBudgetOverrun(
    context: TrustedOrganizationContext,
    claim: ExecutionClaim,
    result: ExecutionResult,
    command: CommandMetadata,
  ): Promise<Task> {
    this.assertClaimTenant(context, claim);
    return this.runTaskCommand(
      context,
      claim.task.id,
      'execution.budget_overrun',
      command,
      async (transaction) => {
        const decision = await this.requireDecision(
          transaction,
          context,
          claim.task.id,
        );
        if (result.actualUsage <= decision.reservedMaximum) {
          throw new KernelPersistenceError('BUDGET_OVERRUN_NOT_PRESENT');
        }
        await this.settleReservation(
          transaction,
          context.organizationId,
          claim.task.id,
          claim.attempt.id,
          result,
          decision,
          command.idempotencyKey,
        );
        await this.finishAttempt(
          transaction,
          context,
          claim.attempt.id,
          'RECONCILIATION_REQUIRED',
          { ...result, effectMayHaveOccurred: true },
          'BUDGET_OVERRUN',
          decision.reservedMaximum,
        );
        await this.insertEvidence(
          transaction,
          context,
          claim.task.id,
          claim.attempt.id,
          result.evidence,
        );
        return this.advanceTask(
          transaction,
          context,
          claim.task,
          'FAILED',
          null,
          command,
          [
            {
              name: 'execution.budget_overrun',
              toState: null,
              payload: {
                actualUsage: result.actualUsage.toString(),
                reservedMaximum: decision.reservedMaximum.toString(),
              },
            },
            {
              name: 'task.failed',
              toState: 'FAILED',
              payload: { code: 'BUDGET_OVERRUN' },
            },
          ],
        );
      },
    );
  }

  public recordPostExecutionPersistenceFailure(
    context: TrustedOrganizationContext,
    claim: ExecutionClaim,
    result: ExecutionResult | null,
    failureCode: string,
    command: CommandMetadata,
  ): Promise<Task> {
    this.assertClaimTenant(context, claim);
    return this.runTaskCommand(
      context,
      claim.task.id,
      'execution.reconcile_after_persistence_failure',
      command,
      async (transaction) => {
        const task = await this.requireTask(
          transaction,
          context,
          claim.task.id,
        );
        const decision = await this.requireDecision(
          transaction,
          context,
          claim.task.id,
        );
        const attempt = await transaction.executionAttempt.findFirstOrThrow({
          where: {
            id: claim.attempt.id,
            taskId: claim.task.id,
            organizationId: context.organizationId,
          },
        });
        if (
          attempt.status !== 'CLAIMED' ||
          attempt.executionPhase !== 'DISPATCHED'
        ) {
          return task;
        }

        // Once DISPATCHED is durable, the external effect boundary has been
        // crossed. A later persistence failure can no longer prove the
        // absence of an effect, even if the executor response claimed none.
        const effectMayHaveOccurred = true;
        const updated = await transaction.executionAttempt.updateMany({
          where: {
            id: attempt.id,
            organizationId: context.organizationId,
            status: 'CLAIMED',
            executionPhase: 'DISPATCHED',
          },
          data: {
            status: 'RECONCILIATION_REQUIRED',
            executionPhase: 'TERMINAL',
            effectState:
              result?.effectMayHaveOccurred === true ? 'CONFIRMED' : 'POSSIBLE',
            effectMayHaveOccurred,
            actualUsage: result?.actualUsage ?? null,
            chargedCredits: null,
            overrunCredits:
              result !== null && result.actualUsage > decision.reservedMaximum
                ? result.actualUsage - decision.reservedMaximum
                : 0n,
            providerCostMinor: result?.providerCostMinor ?? null,
            providerCostCurrency: result?.providerCostCurrency ?? null,
            output:
              result?.output === undefined
                ? Prisma.JsonNull
                : asInputJson(result.output),
            failureCode: 'POST_EXECUTION_PERSISTENCE_FAILURE',
            failureMessage: failureCode,
            finishedAt: this.clock.now(),
          },
        });
        if (updated.count !== 1) {
          throw new KernelPersistenceError('EXECUTION_ATTEMPT_CAS_CONFLICT');
        }
        if (result !== null) {
          await this.insertEvidence(
            transaction,
            context,
            task.id,
            attempt.id,
            result.evidence,
          );
        }
        return this.advanceTask(
          transaction,
          context,
          task,
          'FAILED',
          null,
          command,
          [
            {
              name: 'execution.reconciliation_required',
              toState: null,
              payload: {
                attemptId: attempt.id,
                idempotencyKey: attempt.idempotencyKey,
                actualUsage: result?.actualUsage.toString() ?? null,
                effectMayHaveOccurred,
                executorVersion: decision.executorVersion,
                toolVersion: decision.toolVersion,
                persistenceErrorCode: failureCode,
              },
            },
            {
              name: 'task.failed',
              toState: 'FAILED',
              payload: {
                failureCode: 'POST_EXECUTION_PERSISTENCE_FAILURE',
              },
            },
          ],
        );
      },
    );
  }

  public async getExecutionSnapshot(
    context: TrustedOrganizationContext,
    taskId: string,
  ): Promise<ExecutionSnapshot | null> {
    const task = await this.client.task.findFirst({
      where: { id: taskId, organizationId: context.organizationId },
      include: {
        frozenDecision: true,
        executionAttempt: true,
        evidence: {
          where: { purpose: 'EXECUTION' },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (
      task?.frozenDecision === null ||
      task?.executionAttempt === null ||
      task === null
    ) {
      return null;
    }
    return {
      task: toTask(task),
      decision: toFrozenDecision(task.frozenDecision),
      attempt: toExecutionAttempt(task.executionAttempt),
      evidence: task.evidence.map(toEvidence),
    };
  }

  public async listTaskEvidence(
    context: TrustedOrganizationContext,
    taskId: string,
  ): Promise<readonly PersistedEvidence[]> {
    const evidence = await this.client.evidence.findMany({
      where: { organizationId: context.organizationId, taskId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return evidence.map(toEvidence);
  }

  public async listTaskEvents(
    context: TrustedOrganizationContext,
    taskId: string,
  ): Promise<readonly PersistedTaskEvent[]> {
    const events = await this.client.taskEvent.findMany({
      where: { organizationId: context.organizationId, taskId },
      orderBy: { sequence: 'asc' },
    });
    return events.map(toTaskEvent);
  }

  public markVerified(input: VersionedTaskCommand): Promise<Task> {
    const { context, taskId, expectedVersion, idempotencyKey } = input;
    const command = versionedCommandMetadata(
      taskId,
      expectedVersion,
      idempotencyKey,
    );
    return this.runTaskCommand(
      context,
      taskId,
      'task.verify',
      command,
      async (transaction) => {
        const snapshot = await this.loadPersistedExecutionSnapshot(
          transaction,
          context,
          taskId,
        );
        this.assertExpectedVersion(snapshot.task, expectedVersion);
        if (snapshot.task.state !== 'EXECUTED') {
          throw new KernelPersistenceError('VERIFICATION_REQUIRES_EXECUTED');
        }
        const executor = snapshot.decision.chosenExecutorRef;
        if (
          executor === null ||
          !validateExecutionEvidence(
            snapshot.evidence,
            snapshot.decision.requiredEvidence,
            executor,
          ).ok
        ) {
          throw new KernelPersistenceError('VALID_EVIDENCE_REQUIRED');
        }
        return this.advanceTask(
          transaction,
          context,
          snapshot.task,
          'VERIFIED',
          null,
          command,
          [{ name: 'task.verified', toState: 'VERIFIED' }],
        );
      },
    );
  }

  public commitTask(input: VersionedTaskCommand): Promise<Task> {
    const { context, taskId, expectedVersion, idempotencyKey } = input;
    const command = versionedCommandMetadata(
      taskId,
      expectedVersion,
      idempotencyKey,
    );
    return this.runTaskCommand(
      context,
      taskId,
      'task.commit',
      command,
      async (transaction) => {
        const snapshot = await this.loadPersistedExecutionSnapshot(
          transaction,
          context,
          taskId,
        );
        this.assertExpectedVersion(snapshot.task, expectedVersion);
        if (snapshot.task.state !== 'VERIFIED') {
          throw new KernelPersistenceError('COMMIT_REQUIRES_VERIFIED');
        }
        const executor = snapshot.decision.chosenExecutorRef;
        if (
          executor === null ||
          !validateExecutionEvidence(
            snapshot.evidence,
            snapshot.decision.requiredEvidence,
            executor,
          ).ok
        ) {
          throw new KernelPersistenceError('VALID_EVIDENCE_REQUIRED');
        }
        const result: ExecutionResult = {
          outcome: 'SUCCEEDED',
          actualUsage: snapshot.attempt.actualUsage ?? 0n,
          evidence: [],
          effectMayHaveOccurred: snapshot.attempt.effectMayHaveOccurred,
          ...(snapshot.attempt.providerCostMinor === null
            ? {}
            : { providerCostMinor: snapshot.attempt.providerCostMinor }),
          ...(snapshot.attempt.providerCostCurrency === null
            ? {}
            : {
                providerCostCurrency: snapshot.attempt.providerCostCurrency,
              }),
        };
        await this.settleReservation(
          transaction,
          context.organizationId,
          snapshot.task.id,
          snapshot.attempt.id,
          result,
          snapshot.decision,
          command.idempotencyKey,
        );
        return this.advanceTask(
          transaction,
          context,
          snapshot.task,
          'COMMITTED',
          null,
          command,
          [{ name: 'task.committed', toState: 'COMMITTED' }],
        );
      },
    );
  }

  private async runTaskCommand(
    context: TrustedOrganizationContext,
    taskId: string,
    operation: string,
    command: CommandMetadata,
    execute: (transaction: Transaction) => Promise<Task>,
  ): Promise<Task> {
    return inSerializableTransaction(this.client, async (transaction) => {
      const previous = await this.readReceiptTask(
        transaction,
        context,
        operation,
        command,
      );
      if (previous !== null) {
        return previous;
      }
      const task = await execute(transaction);
      await this.writeReceipt(transaction, context, operation, command, task);
      if (task.id !== taskId) {
        throw new KernelPersistenceError('COMMAND_TASK_MISMATCH');
      }
      return task;
    });
  }

  private async advanceTask(
    transaction: Transaction,
    context: TrustedOrganizationContext,
    task: Task,
    nextState: TaskState | null,
    blockReason: TaskBlockReason | null,
    command: CommandMetadata,
    events: readonly EventSpec[],
  ): Promise<Task> {
    if (events.length === 0) {
      throw new KernelPersistenceError('TASK_EVENT_REQUIRED');
    }
    this.assertTenant(context, task.organizationId);
    if (
      nextState !== null &&
      !canTaskTransition(task.state, task.blockReason, nextState)
    ) {
      throw new KernelPersistenceError(
        `INVALID_TASK_TRANSITION:${task.state}:${nextState}`,
      );
    }
    const stateSql =
      nextState === null
        ? Prisma.sql`"state"`
        : Prisma.sql`${nextState}::"TaskState"`;
    const blockReasonSql =
      nextState === null
        ? Prisma.sql`"block_reason"`
        : blockReason === null
          ? Prisma.sql`NULL::"TaskBlockReason"`
          : Prisma.sql`${blockReason}::"TaskBlockReason"`;
    const rows = await transaction.$queryRaw<
      Array<{ id: string; eventSequence: bigint | string }>
    >(Prisma.sql`
      UPDATE "tasks"
      SET "state" = ${stateSql},
          "block_reason" = ${blockReasonSql},
          "version" = "version" + 1,
          "event_sequence" = "event_sequence" + ${BigInt(events.length)},
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${task.id}::uuid
        AND "organization_id" = ${context.organizationId}::uuid
        AND "state" = ${task.state}::"TaskState"
        AND "version" = ${task.version}
      RETURNING "id", "event_sequence" AS "eventSequence"
    `);
    const allocation = rows[0];
    if (allocation === undefined) {
      throw new KernelPersistenceError('TASK_CAS_CONFLICT');
    }
    const updated = await transaction.task.findFirstOrThrow({
      where: { id: allocation.id, organizationId: context.organizationId },
    });
    const firstSequence =
      BigInt(allocation.eventSequence) - BigInt(events.length) + 1n;
    await this.persistEvents(
      transaction,
      updated,
      task.state,
      firstSequence,
      context,
      command,
      events,
    );
    return toTask(updated);
  }

  private async persistEvents(
    transaction: Transaction,
    task: DatabaseTask,
    commandStartState: TaskState,
    firstSequence: bigint,
    context: TrustedOrganizationContext,
    command: CommandMetadata,
    events: readonly EventSpec[],
  ): Promise<void> {
    for (const [index, event] of events.entries()) {
      const eventId = randomUUID();
      const sequence = firstSequence + BigInt(index);
      const payload = event.payload ?? {};
      await transaction.taskEvent.create({
        data: {
          id: eventId,
          organizationId: context.organizationId,
          taskId: task.id,
          sequence,
          name: event.name,
          fromState: commandStartState,
          toState: event.toState,
          payload: asInputJson(payload),
          correlationId: context.correlationId,
          commandId: command.idempotencyKey,
        },
      });
      await transaction.outboxMessage.create({
        data: {
          id: randomUUID(),
          organizationId: context.organizationId,
          eventId,
          topic: event.name,
          payload: asInputJson({
            eventId,
            organizationId: context.organizationId,
            taskId: task.id,
            sequence: sequence.toString(),
            name: event.name,
            fromState: commandStartState,
            toState: event.toState,
            data: payload,
          }),
          schemaVersion: 1,
        },
      });
    }
  }

  private async reserveCredits(
    transaction: Transaction,
    organizationId: string,
    taskId: string,
    decision: FrozenDecision,
    commandId: string,
  ): Promise<ReservedCredits> {
    const existing = await transaction.creditReservation.findFirst({
      where: { taskId, organizationId },
    });
    if (existing !== null) {
      return {
        acquired: existing.status === 'ACTIVE',
        reservationId: existing.id,
      };
    }
    const account = await transaction.$queryRaw<Array<{ available: bigint }>>(
      Prisma.sql`
        UPDATE "credit_accounts"
        SET "available" = "available" - ${decision.reservedMaximum},
            "reserved" = "reserved" + ${decision.reservedMaximum},
            "version" = "version" + 1,
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "organization_id" = ${organizationId}::uuid
          AND "available" >= ${decision.reservedMaximum}
        RETURNING "available"
      `,
    );
    if (account.length === 0) {
      return { acquired: false, reservationId: null };
    }
    const reservationId = randomUUID();
    await transaction.creditReservation.create({
      data: {
        id: reservationId,
        organizationId,
        taskId,
        status: 'ACTIVE',
        reservedAmount: decision.reservedMaximum,
        pricingVersion: decision.pricingVersion ?? 'CAPABILITY_GAP',
      },
    });
    await transaction.creditLedger.create({
      data: {
        id: randomUUID(),
        organizationId,
        taskId,
        reservationId,
        entryType: 'RESERVE',
        amount: decision.reservedMaximum,
        availableDelta: -decision.reservedMaximum,
        reservedDelta: decision.reservedMaximum,
        pricingVersion: decision.pricingVersion,
        executorVersion: decision.executorVersion,
        commandId,
      },
    });
    return { acquired: true, reservationId };
  }

  private async settleReservation(
    transaction: Transaction,
    organizationId: string,
    taskId: string,
    attemptId: string,
    result: ExecutionResult,
    decision: FrozenDecision,
    commandId: string,
  ): Promise<void> {
    const reservation = await transaction.creditReservation.findFirst({
      where: { taskId, organizationId },
    });
    if (reservation === null) {
      throw new KernelPersistenceError('ACTIVE_RESERVATION_REQUIRED');
    }
    if (reservation.status === 'SETTLED') {
      return;
    }
    if (reservation.status !== 'ACTIVE') {
      throw new KernelPersistenceError('RESERVATION_ALREADY_RELEASED');
    }
    const charged =
      result.actualUsage > reservation.reservedAmount
        ? reservation.reservedAmount
        : result.actualUsage;
    const returned = reservation.reservedAmount - charged;
    const overrun =
      result.actualUsage > reservation.reservedAmount
        ? result.actualUsage - reservation.reservedAmount
        : 0n;
    const accounts = await transaction.$queryRaw<Array<{ version: number }>>(
      Prisma.sql`
        UPDATE "credit_accounts"
        SET "available" = "available" + ${returned},
            "reserved" = "reserved" - ${reservation.reservedAmount},
            "version" = "version" + 1,
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "organization_id" = ${organizationId}::uuid
          AND "reserved" >= ${reservation.reservedAmount}
        RETURNING "version"
      `,
    );
    if (accounts.length === 0) {
      throw new KernelPersistenceError('CREDIT_ACCOUNT_INVARIANT_VIOLATION');
    }
    await transaction.creditReservation.update({
      where: { id: reservation.id },
      data: {
        status: 'SETTLED',
        settledAmount: charged,
        releasedAmount: null,
        terminalAt: this.clock.now(),
      },
    });
    await transaction.creditLedger.create({
      data: {
        id: randomUUID(),
        organizationId,
        taskId,
        reservationId: reservation.id,
        attemptId,
        entryType: 'SETTLE',
        amount: charged,
        availableDelta: returned,
        reservedDelta: -reservation.reservedAmount,
        actualUsage: result.actualUsage,
        overrunCredits: overrun,
        pricingVersion: decision.pricingVersion,
        executorVersion: decision.executorVersion,
        providerCostMinor: result.providerCostMinor ?? null,
        providerCostCurrency: result.providerCostCurrency ?? null,
        commandId,
      },
    });
  }

  private async releaseReservation(
    transaction: Transaction,
    organizationId: string,
    taskId: string,
    attemptId: string,
    commandId: string,
  ): Promise<void> {
    const reservation = await transaction.creditReservation.findFirst({
      where: { taskId, organizationId },
    });
    if (reservation === null || reservation.status === 'RELEASED') {
      return;
    }
    if (reservation.status !== 'ACTIVE') {
      throw new KernelPersistenceError('RESERVATION_ALREADY_SETTLED');
    }
    await transaction.creditAccount.update({
      where: { organizationId },
      data: {
        available: { increment: reservation.reservedAmount },
        reserved: { decrement: reservation.reservedAmount },
        version: { increment: 1 },
      },
    });
    await transaction.creditReservation.update({
      where: { id: reservation.id },
      data: {
        status: 'RELEASED',
        releasedAmount: reservation.reservedAmount,
        terminalAt: this.clock.now(),
      },
    });
    await transaction.creditLedger.create({
      data: {
        id: randomUUID(),
        organizationId,
        taskId,
        reservationId: reservation.id,
        attemptId,
        entryType: 'RELEASE',
        amount: reservation.reservedAmount,
        availableDelta: reservation.reservedAmount,
        reservedDelta: -reservation.reservedAmount,
        commandId,
      },
    });
  }

  private async finishAttempt(
    transaction: Transaction,
    context: TrustedOrganizationContext,
    attemptId: string,
    status: 'SUCCEEDED' | 'FAILED' | 'RECONCILIATION_REQUIRED',
    result: ExecutionResult | null,
    failureCode: string | null,
    maximumCredits: bigint,
  ): Promise<void> {
    const updated = await transaction.executionAttempt.updateMany({
      where: {
        id: attemptId,
        organizationId: context.organizationId,
        status: 'CLAIMED',
        executionPhase: result === null ? 'CLAIMED' : 'DISPATCHED',
      },
      data: {
        status,
        executionPhase: 'TERMINAL',
        effectState:
          result === null
            ? 'NONE'
            : result.effectMayHaveOccurred
              ? 'CONFIRMED'
              : 'NONE',
        actualUsage: result?.actualUsage ?? null,
        chargedCredits:
          result === null
            ? null
            : result.actualUsage > maximumCredits
              ? maximumCredits
              : result.actualUsage,
        overrunCredits:
          result !== null && result.actualUsage > maximumCredits
            ? result.actualUsage - maximumCredits
            : 0n,
        providerCostMinor: result?.providerCostMinor ?? null,
        providerCostCurrency: result?.providerCostCurrency ?? null,
        effectMayHaveOccurred: result?.effectMayHaveOccurred ?? false,
        output:
          result?.output === undefined
            ? Prisma.JsonNull
            : asInputJson(result.output),
        failureCode,
        failureMessage: result?.failureMessage ?? null,
        finishedAt: this.clock.now(),
      },
    });
    if (updated.count !== 1) {
      throw new KernelPersistenceError('EXECUTION_ATTEMPT_CAS_CONFLICT');
    }
  }

  private async insertEvidence(
    transaction: Transaction,
    context: TrustedOrganizationContext,
    taskId: string,
    attemptId: string,
    evidence: readonly EvidenceDraft[],
  ): Promise<void> {
    for (const item of evidence) {
      await transaction.evidence.create({
        data: {
          id: randomUUID(),
          organizationId: context.organizationId,
          taskId,
          attemptId,
          approvalEnvelopeId: item.approvalEnvelopeId ?? null,
          purpose: item.purpose,
          type: item.type,
          strength: item.strength,
          producer: item.producer,
          contentHash: item.contentHash,
          payload:
            item.payload === undefined
              ? Prisma.JsonNull
              : asInputJson(item.payload),
        },
      });
    }
  }

  private async insertApprovalDecision(
    transaction: Transaction,
    context: TrustedOrganizationContext,
    envelope: ApprovalEnvelope,
    verdict: 'APPROVED' | 'REJECTED',
    reason: string | null,
    command: CommandMetadata,
  ): Promise<void> {
    const decisionHash = hashCanonicalJson({
      approvalEnvelopeId: envelope.id,
      envelopeHash: envelope.envelopeHash,
      verdict,
      actorRef: context.actorRef,
      actorScopes: [...context.actorScopes].sort(),
      reason,
    });
    await transaction.approvalDecision.create({
      data: {
        id: randomUUID(),
        organizationId: context.organizationId,
        taskId: envelope.taskId,
        approvalEnvelopeId: envelope.id,
        verdict,
        actorRef: context.actorRef,
        actorScopes: asInputJson([...context.actorScopes].sort()),
        reason,
        envelopeHash: envelope.envelopeHash,
        decisionHash,
        commandId: command.idempotencyKey,
        decidedAt: this.clock.now(),
      },
    });
    await transaction.evidence.create({
      data: {
        id: randomUUID(),
        organizationId: context.organizationId,
        taskId: envelope.taskId,
        approvalEnvelopeId: envelope.id,
        purpose: 'APPROVAL',
        type: 'ATTESTATION',
        strength: 'STRONG',
        producer: context.actorRef,
        contentHash: decisionHash,
        payload: asInputJson({ verdict, envelopeHash: envelope.envelopeHash }),
      },
    });
  }

  private async loadApprovalContext(
    transaction: Transaction,
    context: TrustedOrganizationContext,
    taskId: string,
    approvalEnvelopeId: string,
  ): Promise<{
    task: Task;
    envelope: ApprovalEnvelope;
    decision: FrozenDecision;
  }> {
    const task = await this.requireTask(transaction, context, taskId);
    if (task.state !== 'BLOCKED' || task.blockReason !== 'AWAITING_APPROVAL') {
      throw new KernelPersistenceError('APPROVAL_DECISION_NOT_ALLOWED');
    }
    const envelope = await transaction.approvalEnvelope.findFirst({
      where: {
        id: approvalEnvelopeId,
        taskId,
        organizationId: context.organizationId,
      },
      include: { frozenDecision: true, decision: true },
    });
    if (envelope === null) {
      throw new KernelPersistenceError('APPROVAL_ENVELOPE_NOT_FOUND');
    }
    if (envelope.decision !== null) {
      throw new KernelPersistenceError('APPROVAL_ALREADY_DECIDED');
    }
    return {
      task,
      envelope: toApprovalEnvelope(envelope),
      decision: toFrozenDecision(envelope.frozenDecision),
    };
  }

  private async loadPersistedExecutionSnapshot(
    transaction: Transaction,
    context: TrustedOrganizationContext,
    taskId: string,
  ): Promise<ExecutionSnapshot> {
    const task = await this.requireTask(transaction, context, taskId);
    const decision = await this.requireDecision(transaction, context, taskId);
    const attempt = await transaction.executionAttempt.findFirst({
      where: { organizationId: context.organizationId, taskId },
    });
    if (attempt === null) {
      throw new KernelPersistenceError('EXECUTION_ATTEMPT_NOT_FOUND');
    }
    if (
      attempt.status !== 'SUCCEEDED' ||
      attempt.executionPhase !== 'TERMINAL'
    ) {
      throw new KernelPersistenceError('SUCCESSFUL_EXECUTION_REQUIRED');
    }
    const evidence = await transaction.evidence.findMany({
      where: {
        organizationId: context.organizationId,
        taskId,
        attemptId: attempt.id,
        purpose: 'EXECUTION',
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return {
      task,
      decision,
      attempt: toExecutionAttempt(attempt),
      evidence: evidence.map(toEvidence),
    };
  }

  private async requireTask(
    transaction: Transaction,
    context: TrustedOrganizationContext,
    taskId: string,
  ): Promise<Task> {
    const task = await transaction.task.findFirst({
      where: { id: taskId, organizationId: context.organizationId },
    });
    if (task === null) {
      throw new KernelPersistenceError('TASK_NOT_FOUND');
    }
    return toTask(task);
  }

  private async requireDecision(
    transaction: Transaction,
    context: TrustedOrganizationContext,
    taskId: string,
  ): Promise<FrozenDecision> {
    const decision = await transaction.frozenDecision.findFirst({
      where: { taskId, organizationId: context.organizationId },
    });
    if (decision === null) {
      throw new KernelPersistenceError('FROZEN_DECISION_NOT_FOUND');
    }
    return toFrozenDecision(decision);
  }

  private async readReceiptTask(
    transaction: Transaction,
    context: TrustedOrganizationContext,
    operation: string,
    command: CommandMetadata,
  ): Promise<Task | null> {
    const receipt = await this.findReceipt(
      transaction,
      context,
      operation,
      command,
    );
    if (receipt?.taskId === null || receipt === null) {
      return null;
    }
    const task = taskFromReceipt(receipt.result);
    if (
      task.id !== receipt.taskId ||
      task.organizationId !== context.organizationId
    ) {
      throw new KernelPersistenceError('INVALID_COMMAND_RECEIPT');
    }
    return task;
  }

  private async findReceipt(
    transaction: Transaction,
    context: TrustedOrganizationContext,
    operation: string,
    command: CommandMetadata,
  ) {
    const receipt = await transaction.commandReceipt.findUnique({
      where: {
        organizationId_operation_idempotencyKey: {
          organizationId: context.organizationId,
          operation,
          idempotencyKey: command.idempotencyKey,
        },
      },
    });
    if (receipt !== null && receipt.requestHash !== command.requestHash) {
      throw new KernelPersistenceError('IDEMPOTENCY_KEY_REUSED');
    }
    return receipt;
  }

  private async writeReceipt(
    transaction: Transaction,
    context: TrustedOrganizationContext,
    operation: string,
    command: CommandMetadata,
    task: Task,
  ): Promise<void> {
    await transaction.commandReceipt.create({
      data: {
        id: randomUUID(),
        organizationId: context.organizationId,
        operation,
        idempotencyKey: command.idempotencyKey,
        requestHash: command.requestHash,
        taskId: task.id,
        result: taskReceiptPayload(task),
      },
    });
  }

  private assertTenant(
    context: TrustedOrganizationContext,
    organizationId: string,
  ): void {
    if (context.organizationId !== organizationId) {
      throw new KernelPersistenceError('TENANT_MISMATCH');
    }
  }

  private assertExpectedVersion(task: Task, expectedVersion: number): void {
    if (task.version !== expectedVersion) {
      throw new KernelPersistenceError('TASK_CAS_CONFLICT');
    }
  }

  private assertClaimTenant(
    context: TrustedOrganizationContext,
    claim: ExecutionClaim,
  ): void {
    this.assertTenant(context, claim.task.organizationId);
    this.assertTenant(context, claim.decision.organizationId);
    this.assertTenant(context, claim.attempt.organizationId);
    if (
      claim.task.id !== claim.decision.taskId ||
      claim.task.id !== claim.attempt.taskId
    ) {
      throw new KernelPersistenceError('EXECUTION_CLAIM_TASK_MISMATCH');
    }
  }

  private assertApprovalAuthorization(
    context: TrustedOrganizationContext,
    envelope: ApprovalEnvelope,
    decision: FrozenDecision,
  ): void {
    try {
      validateApprovalAuthorization(
        context,
        envelope,
        decision,
        this.clock.now(),
      );
    } catch (error) {
      throw new KernelPersistenceError(
        error instanceof Error
          ? error.message
          : 'APPROVAL_AUTHORIZATION_FAILED',
      );
    }
  }
}

export type InformationalTaskEventName =
  | 'task.resume_failed'
  | 'credits.insufficient'
  | 'execution.lease_reclaimed'
  | 'execution.reconciliation_required';

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function taskReceiptPayload(task: Task): Prisma.InputJsonValue {
  return asInputJson({
    task: {
      id: task.id,
      organizationId: task.organizationId,
      intent: task.intent,
      instruction: task.instruction,
      inputs: task.inputs,
      riskLevel: task.riskLevel,
      maturity: task.maturity,
      state: task.state,
      blockReason: task.blockReason,
      version: task.version,
      eventSequence: task.eventSequence.toString(),
      correlationId: task.correlationId,
      supersedesTaskId: task.supersedesTaskId,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    },
  });
}

function taskFromReceipt(result: unknown): Task {
  if (
    result === null ||
    typeof result !== 'object' ||
    !('task' in result) ||
    result.task === null ||
    typeof result.task !== 'object'
  ) {
    throw new KernelPersistenceError('INVALID_COMMAND_RECEIPT');
  }
  const task = result.task as Record<string, unknown>;
  if (
    typeof task.id !== 'string' ||
    typeof task.organizationId !== 'string' ||
    typeof task.intent !== 'string' ||
    typeof task.riskLevel !== 'string' ||
    typeof task.maturity !== 'string' ||
    typeof task.state !== 'string' ||
    typeof task.version !== 'number' ||
    typeof task.eventSequence !== 'string' ||
    typeof task.correlationId !== 'string' ||
    typeof task.createdAt !== 'string' ||
    typeof task.updatedAt !== 'string'
  ) {
    throw new KernelPersistenceError('INVALID_COMMAND_RECEIPT');
  }
  return {
    id: task.id,
    organizationId: task.organizationId,
    intent: task.intent,
    instruction: typeof task.instruction === 'string' ? task.instruction : null,
    inputs: task.inputs as Readonly<Record<string, JsonValue>>,
    riskLevel: task.riskLevel as Task['riskLevel'],
    maturity: task.maturity as Task['maturity'],
    state: task.state as TaskState,
    blockReason:
      typeof task.blockReason === 'string'
        ? (task.blockReason as TaskBlockReason)
        : null,
    version: task.version,
    eventSequence: BigInt(task.eventSequence),
    correlationId: task.correlationId,
    supersedesTaskId:
      typeof task.supersedesTaskId === 'string' ? task.supersedesTaskId : null,
    createdAt: new Date(task.createdAt),
    updatedAt: new Date(task.updatedAt),
  };
}

function approvalInvalidCode(
  envelope: ApprovalEnvelope,
  decision: FrozenDecision,
  now: Date,
): string | null {
  try {
    validateApprovalEnvelope(envelope, decision, now);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'APPROVAL_ENVELOPE_INVALID';
  }
}

function approvalAuthorizationInvalidCode(
  context: TrustedOrganizationContext,
  envelope: ApprovalEnvelope,
  decision: FrozenDecision,
  now: Date,
): string | null {
  try {
    validateApprovalAuthorization(context, envelope, decision, now);
    return null;
  } catch (error) {
    return error instanceof Error
      ? error.message
      : 'APPROVAL_AUTHORIZATION_FAILED';
  }
}

function versionedCommandMetadata(
  taskId: string,
  expectedVersion: number,
  idempotencyKey: string,
): CommandMetadata {
  return {
    idempotencyKey,
    requestHash: hashCanonicalJson({ taskId, expectedVersion }),
  };
}
