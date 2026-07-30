import { randomUUID } from 'node:crypto';

import {
  computeFrozenDecisionHash,
  createApprovalEnvelope,
  type ApprovalEnvelope,
  type CommandMetadata,
  type FrozenDecision,
  type Task,
  type TrustedOrganizationContext,
} from '@connect/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDatabaseClient,
  CreditRepository,
  KernelPersistenceError,
  OutboxRepository,
  PrismaKernelStore,
  type DatabaseClient,
} from '../src/index.js';
import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from './postgres.js';

describe('PrismaKernelStore on PostgreSQL', () => {
  let database: TestDatabase;
  let client: DatabaseClient;
  let credits: CreditRepository;
  let store: PrismaKernelStore;

  beforeAll(async () => {
    database = await startTestDatabase();
    client = createDatabaseClient(database.connectionString);
    credits = new CreditRepository(client);
    store = new PrismaKernelStore(client);
  }, 120_000);

  afterAll(async () => {
    if (client) {
      await client.$disconnect();
    }
    if (database) {
      await stopTestDatabase(database);
    }
  });

  it('persists lifecycle, evidence, settlement, events and outbox atomically', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    await credits.grant(context, 1_000n, command('grant'));
    const ingested = await store.createTask(
      context,
      makeTaskInput(),
      command('create'),
    );
    const classified = await store.classifyTask(
      context,
      ingested,
      command('classify'),
    );
    const decision = makeDecision(classified, false, 100n);
    const planned = await store.freezeDecision(
      context,
      classified,
      decision,
      command('freeze'),
    );
    const gated = await store.gateAutomatically(
      context,
      planned,
      decision,
      command('gate'),
    );
    const claim = await store.claimExecution(
      context,
      gated,
      'worker-a',
      new Date(Date.now() + 60_000),
      command('claim'),
    );
    expect(claim.acquired).toBe(true);
    const dispatched = await store.dispatchExecution(
      context,
      claim,
      command('dispatch'),
    );
    const executed = await store.recordExecutionSuccess(
      context,
      dispatched,
      {
        outcome: 'SUCCEEDED',
        actualUsage: 60n,
        evidence: [
          {
            purpose: 'EXECUTION',
            type: 'CHECKSUM',
            strength: 'STRONG',
            producer: 'executor-a',
            contentHash: 'sha256:proof',
          },
        ],
        effectMayHaveOccurred: true,
      },
      command('success'),
    );
    expect(executed.state).toBe('EXECUTED');
    const verified = await store.markVerified({
      context,
      taskId: executed.id,
      expectedVersion: executed.version,
      idempotencyKey: 'verify',
    });
    const committed = await store.commitTask({
      context,
      taskId: verified.id,
      expectedVersion: verified.version,
      idempotencyKey: 'commit',
    });

    expect(committed.state).toBe('COMMITTED');
    const account = await credits.get(context);
    expect(account).toMatchObject({ available: 940n, reserved: 0n });
    const events = await client.taskEvent.findMany({
      where: { taskId: committed.id },
      orderBy: { sequence: 'asc' },
    });
    expect(events.map(({ sequence }) => sequence)).toEqual(
      events.map((_, index) => BigInt(index + 1)),
    );
    expect(new Set(events.map(({ sequence }) => sequence)).size).toBe(
      events.length,
    );
    expect(
      await client.outboxMessage.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(events.length);
  });

  it('keeps approval valid when reservation fails and gates on a later resume', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    const ingested = await store.createTask(
      context,
      makeTaskInput(),
      command('approval-create'),
    );
    const classified = await store.classifyTask(
      context,
      ingested,
      command('approval-classify'),
    );
    const decision = makeDecision(classified, true, 250n);
    const planned = await store.freezeDecision(
      context,
      classified,
      decision,
      command('approval-freeze'),
    );
    const envelope = createApprovalEnvelope({
      id: randomUUID(),
      decision,
      createdAt: new Date(),
    });
    const blocked = await store.blockForApproval(
      context,
      planned,
      envelope,
      command('approval-block'),
    );
    const stillBlocked = await store.approveAndTryGate(
      context,
      blocked.id,
      envelope.id,
      'approved',
      command('approval-decide'),
    );

    expect(stillBlocked.state).toBe('BLOCKED');
    expect(
      await client.approvalDecision.count({
        where: { approvalEnvelopeId: envelope.id },
      }),
    ).toBe(1);
    expect(
      await client.creditReservation.count({ where: { taskId: blocked.id } }),
    ).toBe(0);
    expect(
      await client.taskEvent.findFirst({
        where: { taskId: blocked.id, name: 'task.resume_failed' },
      }),
    ).toMatchObject({ fromState: 'BLOCKED', toState: null });

    await credits.grant(context, 500n, command('approval-grant'));
    const resumes = await Promise.allSettled([
      store.resumeApproved(context, blocked.id, command('approval-resume-a')),
      store.resumeApproved(context, blocked.id, command('approval-resume-b')),
    ]);
    expect(resumes.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    const gated = resumes.find(
      (result): result is PromiseFulfilledResult<Task> =>
        result.status === 'fulfilled',
    )!.value;
    expect(gated.state).toBe('GATED');
    expect(
      await client.creditReservation.count({
        where: { taskId: blocked.id, status: 'ACTIVE' },
      }),
    ).toBe(1);
  });

  it('allows only one concurrent CAS transition and never duplicates sequence', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    const ingested = await store.createTask(
      context,
      makeTaskInput(),
      command('race-create'),
    );
    const results = await Promise.allSettled([
      store.classifyTask(context, ingested, command('race-a')),
      store.classifyTask(context, ingested, command('race-b')),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    const events = await client.taskEvent.findMany({
      where: { taskId: ingested.id },
      orderBy: { sequence: 'asc' },
    });
    expect(events.map(({ sequence }) => sequence)).toEqual([1n, 2n]);
  });

  it('enforces request-hash idempotency and tenant isolation', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    const first = await store.createTask(
      context,
      makeTaskInput(),
      command('idempotent'),
    );
    await store.classifyTask(context, first, command('idempotent-classify'));
    const duplicate = await store.createTask(
      context,
      makeTaskInput(),
      command('idempotent'),
    );
    expect(duplicate.id).toBe(first.id);
    expect(duplicate).toMatchObject({
      state: 'INGESTED',
      version: first.version,
      eventSequence: first.eventSequence,
    });
    expect(await store.getTask(context, first.id)).toMatchObject({
      state: 'CLASSIFIED',
    });

    await expect(
      store.createTask(context, makeTaskInput(), {
        idempotencyKey: 'idempotent',
        requestHash: 'different',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<KernelPersistenceError>>({
        code: 'IDEMPOTENCY_KEY_REUSED',
      }),
    );
    expect(
      await store.getTask(
        { ...makeContext(), organizationId: randomUUID() },
        first.id,
      ),
    ).toBeNull();
  });

  it('claims outbox rows without overlap using SKIP LOCKED', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    for (const key of ['outbox-a', 'outbox-b', 'outbox-c', 'outbox-d']) {
      await store.createTask(context, makeTaskInput(), command(key));
    }
    const outbox = new OutboxRepository(client);
    const [first, second] = await Promise.all([
      outbox.claimBatch('publisher-a', 2),
      outbox.claimBatch('publisher-b', 2),
    ]);
    const ids = [...first, ...second].map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
  });

  it('persists budget overrun and capped settlement in one transaction', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    await credits.grant(context, 1_000n, command('overrun-grant'));
    const { decision, gated } = await prepareGated(
      store,
      context,
      'overrun',
      100n,
    );
    const claim = await store.claimExecution(
      context,
      gated,
      'worker-overrun',
      new Date(Date.now() + 60_000),
      command('overrun-claim'),
    );
    const result = {
      outcome: 'SUCCEEDED' as const,
      actualUsage: 150n,
      evidence: [
        {
          purpose: 'EXECUTION' as const,
          type: 'CHECKSUM' as const,
          strength: 'STRONG' as const,
          producer: 'executor-a',
          contentHash: 'sha256:overrun',
        },
      ],
      effectMayHaveOccurred: false,
    };
    const dispatched = await store.dispatchExecution(
      context,
      claim,
      command('overrun-dispatch'),
    );
    const failed = await store.recordBudgetOverrun(
      context,
      dispatched,
      result,
      command('overrun-record'),
    );
    const duplicate = await store.recordBudgetOverrun(
      context,
      dispatched,
      result,
      command('overrun-record'),
    );

    expect(duplicate.id).toBe(failed.id);
    expect(failed.state).toBe('FAILED');
    expect(await credits.get(context)).toMatchObject({
      available: 900n,
      reserved: 0n,
    });
    expect(
      await client.executionAttempt.findUnique({
        where: { taskId: failed.id },
      }),
    ).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      actualUsage: 150n,
      chargedCredits: decision.reservedMaximum,
      overrunCredits: 50n,
      effectMayHaveOccurred: true,
    });
    expect(
      await client.creditLedger.findFirst({
        where: { taskId: failed.id, entryType: 'SETTLE' },
      }),
    ).toMatchObject({
      amount: 100n,
      actualUsage: 150n,
      overrunCredits: 50n,
    });
    expect(
      await client.creditLedger.count({
        where: { taskId: failed.id, entryType: 'SETTLE' },
      }),
    ).toBe(1);
    const terminalEvents = await client.taskEvent.findMany({
      where: {
        taskId: failed.id,
        name: { in: ['execution.budget_overrun', 'task.failed'] },
      },
      orderBy: { sequence: 'asc' },
    });
    expect(terminalEvents.map(({ name }) => name)).toEqual([
      'execution.budget_overrun',
      'task.failed',
    ]);
    expect(terminalEvents[0]?.toState).toBeNull();
    expect(terminalEvents[1]?.toState).toBe('FAILED');
  });

  it('reuses one attempt and idempotency key for concurrent claim and reclaim', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    await credits.grant(context, 500n, command('attempt-grant'));
    const { gated } = await prepareGated(store, context, 'attempt', 100n);
    const claims = await Promise.all([
      store.claimExecution(
        context,
        gated,
        'worker-a',
        new Date(Date.now() + 60_000),
        command('attempt-claim-a'),
      ),
      store.claimExecution(
        context,
        gated,
        'worker-b',
        new Date(Date.now() + 60_000),
        command('attempt-claim-b'),
      ),
    ]);
    const acquired = claims.find(({ acquired: won }) => won);
    expect(acquired).toBeDefined();
    expect(
      await client.executionAttempt.count({ where: { taskId: gated.id } }),
    ).toBe(1);

    await client.executionAttempt.update({
      where: { id: acquired!.attempt.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });
    const current = await store.getTask(context, gated.id);
    const reclaimed = await store.claimExecution(
      context,
      current!,
      'worker-reclaimer',
      new Date(Date.now() + 60_000),
      command('attempt-reclaim'),
    );
    expect(reclaimed.acquired).toBe(true);
    expect(reclaimed.attempt.id).toBe(acquired!.attempt.id);
    expect(reclaimed.attempt.idempotencyKey).toBe(
      acquired!.attempt.idempotencyKey,
    );
    expect(reclaimed.attempt.claims).toBe(2);

    const dispatched = await store.dispatchExecution(
      context,
      reclaimed,
      command('attempt-dispatch'),
    );
    const failed = await store.recordExecutionFailure(
      context,
      dispatched,
      {
        outcome: 'FAILED',
        actualUsage: 10n,
        evidence: [],
        failureCode: 'UNCERTAIN',
        effectMayHaveOccurred: true,
      },
      'UNCERTAIN',
      command('attempt-uncertain'),
    );
    const afterUncertain = await store.claimExecution(
      context,
      failed,
      'worker-c',
      new Date(Date.now() + 60_000),
      command('attempt-after-uncertain'),
    );
    expect(afterUncertain.acquired).toBe(false);
    expect(afterUncertain.attempt.id).toBe(dispatched.attempt.id);
  });

  it('never reclaims a DISPATCHED lease and requires reconciliation without releasing credits', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    await credits.grant(context, 100n, command('dispatched-crash-grant'));
    const { gated } = await prepareGated(
      store,
      context,
      'dispatched-crash',
      100n,
    );
    const claimed = await store.claimExecution(
      context,
      gated,
      'worker-before-crash',
      new Date(Date.now() + 60_000),
      command('dispatched-crash-claim'),
    );
    const dispatched = await store.dispatchExecution(
      context,
      claimed,
      command('dispatched-crash-dispatch'),
    );
    await client.executionAttempt.update({
      where: { id: dispatched.attempt.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });

    const current = await store.getTask(context, gated.id);
    const reclaimed = await store.claimExecution(
      context,
      current!,
      'worker-after-crash',
      new Date(Date.now() + 60_000),
      command('dispatched-crash-reclaim'),
    );

    expect(reclaimed.acquired).toBe(false);
    expect(reclaimed.task.state).toBe('FAILED');
    expect(reclaimed.attempt).toMatchObject({
      id: dispatched.attempt.id,
      idempotencyKey: dispatched.attempt.idempotencyKey,
      status: 'RECONCILIATION_REQUIRED',
      executionPhase: 'TERMINAL',
      effectState: 'POSSIBLE',
      effectMayHaveOccurred: true,
    });
    expect(
      await client.creditReservation.findUnique({
        where: { taskId: gated.id },
      }),
    ).toMatchObject({ status: 'ACTIVE', reservedAmount: 100n });
    expect(
      await client.creditLedger.count({
        where: {
          taskId: gated.id,
          entryType: { in: ['SETTLE', 'RELEASE'] },
        },
      }),
    ).toBe(0);
    expect(await credits.get(context)).toMatchObject({
      available: 0n,
      reserved: 100n,
    });
    expect(
      await client.taskEvent.findFirst({
        where: {
          taskId: gated.id,
          name: 'execution.reconciliation_required',
        },
      }),
    ).toBeDefined();
  });

  it('persists reconciliation after an executor result cannot be recorded and preserves the active reservation', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    await credits.grant(context, 100n, command('persist-failure-grant'));
    const { gated } = await prepareGated(
      store,
      context,
      'persist-failure',
      100n,
    );
    const claimed = await store.claimExecution(
      context,
      gated,
      'worker-persist-failure',
      new Date(Date.now() + 60_000),
      command('persist-failure-claim'),
    );
    const dispatched = await store.dispatchExecution(
      context,
      claimed,
      command('persist-failure-dispatch'),
    );
    const result = {
      outcome: 'SUCCEEDED' as const,
      actualUsage: 40n,
      evidence: [
        {
          purpose: 'EXECUTION' as const,
          type: 'CHECKSUM' as const,
          strength: 'STRONG' as const,
          producer: 'executor-a',
          contentHash: 'sha256:persist-failure-proof',
        },
      ],
      effectMayHaveOccurred: true,
      output: { externalReference: 'effect-123' },
    };
    await database.adminPool.query(`
      CREATE OR REPLACE FUNCTION reject_execution_result_outbox()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.topic = 'execution.succeeded' THEN
          RAISE EXCEPTION 'test execution result persistence failure'
            USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_execution_result_outbox_trigger
        BEFORE INSERT ON outbox_messages
        FOR EACH ROW EXECUTE FUNCTION reject_execution_result_outbox();
    `);
    try {
      await expect(
        store.recordExecutionSuccess(
          context,
          dispatched,
          result,
          command('persist-failure-success'),
        ),
      ).rejects.toBeDefined();
    } finally {
      await database.adminPool.query(`
        DROP TRIGGER reject_execution_result_outbox_trigger ON outbox_messages;
        DROP FUNCTION reject_execution_result_outbox();
      `);
    }

    expect(
      await client.executionAttempt.findUnique({
        where: { id: dispatched.attempt.id },
      }),
    ).toMatchObject({
      status: 'CLAIMED',
      executionPhase: 'DISPATCHED',
      effectState: 'POSSIBLE',
      effectMayHaveOccurred: true,
    });
    const reconciled = await store.recordPostExecutionPersistenceFailure(
      context,
      dispatched,
      result,
      'DATABASE_WRITE_FAILED',
      command('persist-failure-reconcile'),
    );

    expect(reconciled.state).toBe('FAILED');
    expect(
      await client.executionAttempt.findUnique({
        where: { id: dispatched.attempt.id },
      }),
    ).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      executionPhase: 'TERMINAL',
      effectState: 'CONFIRMED',
      effectMayHaveOccurred: true,
      actualUsage: 40n,
      failureCode: 'POST_EXECUTION_PERSISTENCE_FAILURE',
      failureMessage: 'DATABASE_WRITE_FAILED',
    });
    expect(
      await client.creditReservation.findUnique({
        where: { taskId: gated.id },
      }),
    ).toMatchObject({ status: 'ACTIVE', reservedAmount: 100n });
    expect(
      await client.creditLedger.count({
        where: {
          taskId: gated.id,
          entryType: { in: ['SETTLE', 'RELEASE'] },
        },
      }),
    ).toBe(0);
    expect(await credits.get(context)).toMatchObject({
      available: 0n,
      reserved: 100n,
    });
    expect(await store.listTaskEvidence(context, gated.id)).toEqual([
      expect.objectContaining({
        attemptId: dispatched.attempt.id,
        purpose: 'EXECUTION',
        contentHash: 'sha256:persist-failure-proof',
      }),
    ]);
    const reconciliationEvents = await client.taskEvent.findMany({
      where: {
        taskId: gated.id,
        name: 'execution.reconciliation_required',
      },
    });
    expect(reconciliationEvents).toHaveLength(1);
    expect(
      await client.outboxMessage.count({
        where: { eventId: reconciliationEvents[0]!.id },
      }),
    ).toBe(1);
  });

  it('keeps DISPATCHED and the reservation durable when reconciliation persistence also fails', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    await credits.grant(context, 100n, command('double-failure-grant'));
    const { gated } = await prepareGated(
      store,
      context,
      'double-failure',
      100n,
    );
    const claimed = await store.claimExecution(
      context,
      gated,
      'worker-double-failure',
      new Date(Date.now() + 60_000),
      command('double-failure-claim'),
    );
    const dispatched = await store.dispatchExecution(
      context,
      claimed,
      command('double-failure-dispatch'),
    );
    const result = {
      outcome: 'SUCCEEDED' as const,
      actualUsage: 30n,
      evidence: [
        {
          purpose: 'EXECUTION' as const,
          type: 'CHECKSUM' as const,
          strength: 'STRONG' as const,
          producer: 'executor-a',
          contentHash: 'sha256:double-failure-proof',
        },
      ],
      effectMayHaveOccurred: true,
    };
    await database.adminPool.query(`
      CREATE OR REPLACE FUNCTION reject_post_dispatch_outbox()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.topic IN (
          'execution.succeeded',
          'execution.reconciliation_required'
        ) THEN
          RAISE EXCEPTION 'test post-dispatch database outage'
            USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_post_dispatch_outbox_trigger
        BEFORE INSERT ON outbox_messages
        FOR EACH ROW EXECUTE FUNCTION reject_post_dispatch_outbox();
    `);
    try {
      await expect(
        store.recordExecutionSuccess(
          context,
          dispatched,
          result,
          command('double-failure-success'),
        ),
      ).rejects.toBeDefined();
      await expect(
        store.recordPostExecutionPersistenceFailure(
          context,
          dispatched,
          result,
          'DATABASE_WRITE_FAILED',
          command('double-failure-reconcile'),
        ),
      ).rejects.toBeDefined();
    } finally {
      await database.adminPool.query(`
        DROP TRIGGER reject_post_dispatch_outbox_trigger ON outbox_messages;
        DROP FUNCTION reject_post_dispatch_outbox();
      `);
    }

    expect(await store.getTask(context, gated.id)).toMatchObject({
      state: 'GATED',
      version: dispatched.task.version,
    });
    expect(
      await client.executionAttempt.findUnique({
        where: { id: dispatched.attempt.id },
      }),
    ).toMatchObject({
      status: 'CLAIMED',
      executionPhase: 'DISPATCHED',
      effectState: 'POSSIBLE',
      replayPolicy: 'NO_AUTOMATIC_REEXECUTION_AFTER_DISPATCH',
      effectMayHaveOccurred: true,
      actualUsage: null,
    });
    expect(
      await client.creditReservation.findUnique({
        where: { taskId: gated.id },
      }),
    ).toMatchObject({ status: 'ACTIVE', reservedAmount: 100n });
    expect(
      await client.creditLedger.count({
        where: {
          taskId: gated.id,
          entryType: { in: ['SETTLE', 'RELEASE'] },
        },
      }),
    ).toBe(0);
    expect(
      await client.commandReceipt.count({
        where: {
          organizationId: context.organizationId,
          operation: 'execution.reconcile_after_persistence_failure',
        },
      }),
    ).toBe(0);
  });

  it('prevents two tasks from overdrawing one account', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    await credits.grant(context, 100n, command('dispute-grant'));
    const first = await preparePlanned(store, context, 'dispute-a', 100n);
    const second = await preparePlanned(store, context, 'dispute-b', 100n);
    const results = await Promise.all([
      store.gateAutomatically(
        context,
        first.planned,
        first.decision,
        command('dispute-gate-a'),
      ),
      store.gateAutomatically(
        context,
        second.planned,
        second.decision,
        command('dispute-gate-b'),
      ),
    ]);
    expect(results.map(({ state }) => state).sort()).toEqual([
      'FAILED',
      'GATED',
    ]);
    expect(await credits.get(context)).toMatchObject({
      available: 0n,
      reserved: 100n,
    });
  });

  it('serializes concurrent informational events through Task.eventSequence', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    const task = await store.createTask(
      context,
      makeTaskInput(),
      command('info-create'),
    );

    const appendWithCasRetry = async (key: string): Promise<Task> => {
      let expected = task;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await store.appendInformationalEvent(
            context,
            expected,
            'credits.insufficient',
            { key },
            command(key),
          );
        } catch (error) {
          if (
            !(error instanceof KernelPersistenceError) ||
            error.code !== 'TASK_CAS_CONFLICT'
          ) {
            throw error;
          }
          expected = (await store.getTask(context, task.id))!;
        }
      }
      throw new Error('CAS_RETRY_EXHAUSTED');
    };
    await Promise.all([
      appendWithCasRetry('info-a'),
      appendWithCasRetry('info-b'),
    ]);
    const events = await client.taskEvent.findMany({
      where: { taskId: task.id },
      orderBy: { sequence: 'asc' },
    });
    expect(events.map(({ sequence }) => sequence)).toEqual([1n, 2n, 3n]);
    expect(events.slice(1).every(({ toState }) => toState === null)).toBe(true);
  });

  it('uses only persisted Evidence to authorize VERIFIED and COMMITTED', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    await credits.grant(context, 100n, command('evidence-grant'));
    const { gated } = await prepareGated(store, context, 'evidence', 100n);
    const claim = await store.claimExecution(
      context,
      gated,
      'worker-evidence',
      new Date(Date.now() + 60_000),
      command('evidence-claim'),
    );
    const dispatched = await store.dispatchExecution(
      context,
      claim,
      command('evidence-dispatch'),
    );
    await client.executionAttempt.update({
      where: { id: dispatched.attempt.id },
      data: {
        status: 'SUCCEEDED',
        executionPhase: 'TERMINAL',
        effectState: 'CONFIRMED',
        effectMayHaveOccurred: true,
        actualUsage: 5n,
        chargedCredits: 5n,
        overrunCredits: 0n,
        finishedAt: new Date(),
      },
    });
    await client.evidence.create({
      data: {
        id: randomUUID(),
        organizationId: context.organizationId,
        taskId: dispatched.task.id,
        attemptId: dispatched.attempt.id,
        purpose: 'EXECUTION',
        type: 'LOG',
        strength: 'WEAK',
        producer: 'other-executor',
      },
    });
    const executedRow = await client.task.update({
      where: { id: dispatched.task.id },
      data: { state: 'EXECUTED', version: { increment: 1 } },
    });
    const fabricatedEvidence = [
      {
        purpose: 'EXECUTION',
        type: 'CHECKSUM',
        strength: 'STRONG',
        producer: 'executor-a',
        contentHash: 'sha256:fabricated',
      },
    ];
    const fabricatedVerifyRequest = {
      context,
      taskId: executedRow.id,
      expectedVersion: executedRow.version,
      idempotencyKey: 'evidence-verify',
      evidence: fabricatedEvidence,
    };
    await expect(store.markVerified(fabricatedVerifyRequest)).rejects.toEqual(
      expect.objectContaining<Partial<KernelPersistenceError>>({
        code: 'VALID_EVIDENCE_REQUIRED',
      }),
    );
    const forcedVerified = await client.task.update({
      where: { id: executedRow.id },
      data: { state: 'VERIFIED', version: { increment: 1 } },
    });
    const fabricatedCommitRequest = {
      context,
      taskId: forcedVerified.id,
      expectedVersion: forcedVerified.version,
      idempotencyKey: 'evidence-commit',
      evidence: fabricatedEvidence,
    };
    await expect(store.commitTask(fabricatedCommitRequest)).rejects.toEqual(
      expect.objectContaining<Partial<KernelPersistenceError>>({
        code: 'VALID_EVIDENCE_REQUIRED',
      }),
    );
    expect(await store.getTask(context, executedRow.id)).toMatchObject({
      state: 'VERIFIED',
    });
    expect(
      await client.creditLedger.count({
        where: { taskId: executedRow.id, entryType: 'SETTLE' },
      }),
    ).toBe(0);
    expect(
      await client.creditReservation.findUnique({
        where: { taskId: executedRow.id },
      }),
    ).toMatchObject({ status: 'ACTIVE' });
  });

  it('derives tenant authority only from trusted context across credits, attempts, Evidence and events', async () => {
    const tenantA = makeContext();
    const tenantB = makeContext();
    await credits.ensureOrganization(tenantA);
    await credits.ensureOrganization(tenantB);
    await credits.grant(tenantB, 100n, command('tenant-b-grant'));
    const { gated } = await prepareGated(
      store,
      tenantB,
      'tenant-boundary',
      100n,
    );
    const claimed = await store.claimExecution(
      tenantB,
      gated,
      'worker-tenant-b',
      new Date(Date.now() + 60_000),
      command('tenant-b-claim'),
    );
    const dispatched = await store.dispatchExecution(
      tenantB,
      claimed,
      command('tenant-b-dispatch'),
    );
    const executed = await store.recordExecutionSuccess(
      tenantB,
      dispatched,
      {
        outcome: 'SUCCEEDED',
        actualUsage: 25n,
        evidence: [
          {
            purpose: 'EXECUTION',
            type: 'CHECKSUM',
            strength: 'STRONG',
            producer: 'executor-a',
            contentHash: 'sha256:tenant-b-proof',
          },
        ],
        effectMayHaveOccurred: true,
      },
      command('tenant-b-success'),
    );
    const tenantBBalance = await credits.get(tenantB);

    expect(await credits.get(tenantA)).toBeNull();
    expect(await store.getTask(tenantA, executed.id)).toBeNull();
    expect(await store.getExecutionSnapshot(tenantA, executed.id)).toBeNull();
    expect(await store.listTaskEvidence(tenantA, executed.id)).toEqual([]);
    expect(await store.listTaskEvents(tenantA, executed.id)).toEqual([]);
    await expect(
      store.markVerified({
        context: tenantA,
        taskId: executed.id,
        expectedVersion: executed.version,
        idempotencyKey: 'tenant-a-verify-b',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<KernelPersistenceError>>({
        code: 'TASK_NOT_FOUND',
      }),
    );
    await expect(
      store.commitTask({
        context: tenantA,
        taskId: executed.id,
        expectedVersion: executed.version,
        idempotencyKey: 'tenant-a-commit-b',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<KernelPersistenceError>>({
        code: 'TASK_NOT_FOUND',
      }),
    );
    await expect(
      Promise.resolve().then(() =>
        store.recordExecutionFailure(
          tenantA,
          dispatched,
          null,
          'FORGED_TENANT',
          command('tenant-a-fail-b'),
        ),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<KernelPersistenceError>>({
        code: 'TENANT_MISMATCH',
      }),
    );
    expect(await credits.get(tenantB)).toEqual(tenantBBalance);
    expect(
      await client.creditLedger.count({
        where: {
          taskId: executed.id,
          entryType: { in: ['SETTLE', 'RELEASE'] },
        },
      }),
    ).toBe(0);
  });

  it('round-trips credit values above Number.MAX_SAFE_INTEGER', async () => {
    const context = makeContext();
    const amount = BigInt(Number.MAX_SAFE_INTEGER) + 123_456n;
    await credits.ensureOrganization(context);
    const first = await credits.grant(context, amount, command('bigint-grant'));
    await credits.grant(context, 1n, command('bigint-grant-later'));
    const replay = await credits.grant(
      context,
      amount,
      command('bigint-grant'),
    );
    expect(replay).toEqual(first);
    expect(await credits.get(context)).toMatchObject({
      available: amount + 1n,
    });
  });

  it('freezes once under concurrency and keeps one immutable snapshot', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    const ingested = await store.createTask(
      context,
      makeTaskInput(),
      command('freeze-race-create'),
    );
    const classified = await store.classifyTask(
      context,
      ingested,
      command('freeze-race-classify'),
    );
    const first = makeDecision(classified, false, 10n);
    const second = makeDecision(classified, false, 20n);
    const results = await Promise.allSettled([
      store.freezeDecision(
        context,
        classified,
        first,
        command('freeze-race-a'),
      ),
      store.freezeDecision(
        context,
        classified,
        second,
        command('freeze-race-b'),
      ),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(
      await client.frozenDecision.count({ where: { taskId: classified.id } }),
    ).toBe(1);
  });

  it('requires a successor Task for a persisted capability gap', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    const ingested = await store.createTask(
      context,
      makeTaskInput(),
      command('gap-create'),
    );
    const classified = await store.classifyTask(
      context,
      ingested,
      command('gap-classify'),
    );
    const decision = makeCapabilityGapDecision(classified);
    const blocked = await store.freezeDecision(
      context,
      classified,
      decision,
      command('gap-freeze'),
    );
    expect(blocked).toMatchObject({
      state: 'BLOCKED',
      blockReason: 'CAPABILITY_GAP',
    });
    await expect(
      store.gateAutomatically(
        context,
        blocked,
        decision,
        command('gap-illegal-gate'),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<KernelPersistenceError>>({
        code: 'AUTOMATIC_GATE_NOT_ALLOWED',
      }),
    );
    expect(await store.getTask(context, blocked.id)).toMatchObject({
      state: 'BLOCKED',
      blockReason: 'CAPABILITY_GAP',
    });
  });

  it('makes approval and rejection mutually exclusive under concurrency', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    await credits.grant(context, 100n, command('decision-race-grant'));
    const ingested = await store.createTask(
      context,
      makeTaskInput(),
      command('decision-race-create'),
    );
    const classified = await store.classifyTask(
      context,
      ingested,
      command('decision-race-classify'),
    );
    const decision = makeDecision(classified, true, 100n);
    const planned = await store.freezeDecision(
      context,
      classified,
      decision,
      command('decision-race-freeze'),
    );
    const envelope = createApprovalEnvelope({
      id: randomUUID(),
      decision,
      createdAt: new Date(),
    });
    const blocked = await store.blockForApproval(
      context,
      planned,
      envelope,
      command('decision-race-block'),
    );
    const results = await Promise.allSettled([
      store.approveAndTryGate(
        context,
        blocked.id,
        envelope.id,
        'yes',
        command('decision-race-approve'),
      ),
      store.reject(
        context,
        blocked.id,
        envelope.id,
        'no',
        command('decision-race-reject'),
      ),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(
      await client.approvalDecision.count({
        where: { approvalEnvelopeId: envelope.id },
      }),
    ).toBe(1);
  });

  it('rejects a human decision without the frozen approval scope and writes nothing', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    const { blocked, envelope } = await prepareBlockedApproval(
      store,
      context,
      'reject-scope',
      10n,
    );
    const unauthorized = {
      ...context,
      actorRef: 'user:without-scope',
      actorScopes: [],
    };

    await expect(
      store.reject(
        unauthorized,
        blocked.id,
        envelope.id,
        'not authorized',
        command('reject-scope-decision'),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<KernelPersistenceError>>({
        code: 'APPROVAL_SCOPE_REQUIRED',
      }),
    );
    expect(await store.getTask(context, blocked.id)).toMatchObject({
      state: 'BLOCKED',
      blockReason: 'AWAITING_APPROVAL',
      version: blocked.version,
    });
    expect(
      await client.approvalDecision.count({
        where: { approvalEnvelopeId: envelope.id },
      }),
    ).toBe(0);
    expect(
      await client.commandReceipt.count({
        where: {
          organizationId: context.organizationId,
          operation: 'approval.reject',
        },
      }),
    ).toBe(0);
  });

  it('rejects an expired envelope without persisting a rejection', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    const { blocked, envelope } = await prepareBlockedApproval(
      store,
      context,
      'reject-expired',
      10n,
      new Date(Date.now() - 1_000),
      new Date(Date.now() - 2_000),
    );

    await expect(
      store.reject(
        context,
        blocked.id,
        envelope.id,
        'too late',
        command('reject-expired-decision'),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<KernelPersistenceError>>({
        code: 'APPROVAL_ENVELOPE_EXPIRED',
      }),
    );
    expect(await store.getTask(context, blocked.id)).toMatchObject({
      state: 'BLOCKED',
      version: blocked.version,
    });
    expect(
      await client.approvalDecision.count({
        where: { approvalEnvelopeId: envelope.id },
      }),
    ).toBe(0);
  });

  it('rejects an envelope whose persisted hash diverges from its immutable content', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    const { blocked, envelope } = await prepareBlockedApproval(
      store,
      context,
      'reject-hash',
      10n,
    );
    await database.adminPool.query(
      'ALTER TABLE approval_envelopes DISABLE TRIGGER approval_envelopes_append_only',
    );
    try {
      await database.adminPool.query(
        'UPDATE approval_envelopes SET envelope_hash = $1 WHERE id = $2::uuid',
        ['sha256:tampered', envelope.id],
      );
    } finally {
      await database.adminPool.query(
        'ALTER TABLE approval_envelopes ENABLE TRIGGER approval_envelopes_append_only',
      );
    }

    await expect(
      store.reject(
        context,
        blocked.id,
        envelope.id,
        'tampered',
        command('reject-hash-decision'),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<KernelPersistenceError>>({
        code: 'APPROVAL_ENVELOPE_HASH_MISMATCH',
      }),
    );
    expect(await store.getTask(context, blocked.id)).toMatchObject({
      state: 'BLOCKED',
      version: blocked.version,
    });
    expect(
      await client.approvalDecision.count({
        where: { approvalEnvelopeId: envelope.id },
      }),
    ).toBe(0);
  });

  it('refuses a second human decision after approval remains BLOCKED for insufficient credits', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    const { blocked, envelope } = await prepareBlockedApproval(
      store,
      context,
      'second-decision',
      100n,
    );
    const stillBlocked = await store.approveAndTryGate(
      context,
      blocked.id,
      envelope.id,
      'approved once',
      command('second-decision-approve'),
    );
    expect(stillBlocked).toMatchObject({
      state: 'BLOCKED',
      blockReason: 'AWAITING_APPROVAL',
    });

    await expect(
      store.reject(
        context,
        stillBlocked.id,
        envelope.id,
        'try to reverse',
        command('second-decision-reject'),
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<KernelPersistenceError>>({
        code: 'APPROVAL_ALREADY_DECIDED',
      }),
    );
    expect(
      await client.approvalDecision.findFirst({
        where: { approvalEnvelopeId: envelope.id },
      }),
    ).toMatchObject({ verdict: 'APPROVED' });
    expect(
      await client.approvalDecision.count({
        where: { approvalEnvelopeId: envelope.id },
      }),
    ).toBe(1);
  });

  it('fails an expired approval snapshot without recalculating it', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    const ingested = await store.createTask(
      context,
      makeTaskInput(),
      command('expired-create'),
    );
    const classified = await store.classifyTask(
      context,
      ingested,
      command('expired-classify'),
    );
    const decision = rehashDecision({
      ...makeDecision(classified, true, 10n),
      validUntil: new Date(Date.now() - 1_000),
    });
    const planned = await store.freezeDecision(
      context,
      classified,
      decision,
      command('expired-freeze'),
    );
    const envelope = createApprovalEnvelope({
      id: randomUUID(),
      decision,
      createdAt: new Date(Date.now() - 2_000),
    });
    const blocked = await store.blockForApproval(
      context,
      planned,
      envelope,
      command('expired-block'),
    );
    const failed = await store.approveAndTryGate(
      context,
      blocked.id,
      envelope.id,
      null,
      command('expired-approve'),
    );
    expect(failed.state).toBe('FAILED');
    expect(
      await client.approvalDecision.count({
        where: { approvalEnvelopeId: envelope.id },
      }),
    ).toBe(0);
    expect(
      await client.taskEvent.findFirst({
        where: { taskId: failed.id, name: 'approval.invalid' },
      }),
    ).toBeDefined();
  });

  it('lets only settlement or release win and rolls back the losing financial path', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    await credits.grant(context, 100n, command('financial-race-grant'));
    const { gated } = await prepareGated(
      store,
      context,
      'financial-race',
      100n,
    );
    const claim = await store.claimExecution(
      context,
      gated,
      'worker-financial',
      new Date(Date.now() + 60_000),
      command('financial-race-claim'),
    );
    const settledResult = {
      outcome: 'FAILED' as const,
      actualUsage: 40n,
      evidence: [],
      effectMayHaveOccurred: false,
    };
    const dispatchCommand = command('financial-race-dispatch');
    const settleCommand = command('financial-race-settle');
    const releaseCommand = command('financial-race-release');
    const results = await Promise.allSettled([
      (async () => {
        const dispatched = await store.dispatchExecution(
          context,
          claim,
          dispatchCommand,
        );
        return store.recordExecutionFailure(
          context,
          dispatched,
          settledResult,
          'FAILED_WITH_USAGE',
          settleCommand,
        );
      })(),
      store.recordExecutionFailure(
        context,
        claim,
        null,
        'FAILED_WITHOUT_USAGE',
        releaseCommand,
      ),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    const terminalLedger = await client.creditLedger.findMany({
      where: {
        taskId: gated.id,
        entryType: { in: ['SETTLE', 'RELEASE'] },
      },
    });
    expect(terminalLedger).toHaveLength(1);
    const account = await credits.get(context);
    expect(account!.available).toBeGreaterThanOrEqual(0n);
    expect(account!.reserved).toBe(0n);

    if (terminalLedger[0]?.entryType === 'SETTLE') {
      const dispatched = await store.dispatchExecution(
        context,
        claim,
        dispatchCommand,
      );
      await expect(
        store.recordExecutionFailure(
          context,
          dispatched,
          settledResult,
          'FAILED_WITH_USAGE',
          settleCommand,
        ),
      ).resolves.toMatchObject({ state: 'FAILED' });
    } else {
      await expect(
        store.recordExecutionFailure(
          context,
          claim,
          null,
          'FAILED_WITHOUT_USAGE',
          releaseCommand,
        ),
      ).resolves.toMatchObject({ state: 'FAILED' });
    }
    expect(
      await client.creditLedger.count({
        where: {
          taskId: gated.id,
          entryType: { in: ['SETTLE', 'RELEASE'] },
        },
      }),
    ).toBe(1);
  });

  it('rolls back Task, event and receipt when outbox persistence fails', async () => {
    const context = makeContext();
    await credits.ensureOrganization(context);
    const ingested = await store.createTask(
      context,
      makeTaskInput(),
      command('rollback-create'),
    );
    await database.adminPool.query(`
      CREATE OR REPLACE FUNCTION reject_test_outbox()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.topic = 'task.classified' THEN
          RAISE EXCEPTION 'test outbox failure' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_test_outbox_trigger
        BEFORE INSERT ON outbox_messages
        FOR EACH ROW EXECUTE FUNCTION reject_test_outbox();
    `);
    try {
      await expect(
        store.classifyTask(context, ingested, command('rollback-classify')),
      ).rejects.toBeDefined();
    } finally {
      await database.adminPool.query(`
        DROP TRIGGER reject_test_outbox_trigger ON outbox_messages;
        DROP FUNCTION reject_test_outbox();
      `);
    }
    expect(await store.getTask(context, ingested.id)).toMatchObject({
      state: 'INGESTED',
      version: ingested.version,
      eventSequence: ingested.eventSequence,
    });
    expect(
      await client.taskEvent.count({ where: { taskId: ingested.id } }),
    ).toBe(1);
    expect(
      await client.commandReceipt.count({
        where: {
          organizationId: context.organizationId,
          operation: 'task.classify',
        },
      }),
    ).toBe(0);
  });
});

function makeContext(): TrustedOrganizationContext {
  return {
    organizationId: randomUUID(),
    actorRef: 'user:test',
    actorScopes: ['tasks.approve', 'credits.reserve'],
    correlationId: randomUUID(),
  };
}

function command(key: string): CommandMetadata {
  return { idempotencyKey: key, requestHash: `hash:${key}` };
}

function makeTaskInput() {
  return {
    intent: 'test.intent',
    inputs: { source: 'integration' },
    riskLevel: 'R1' as const,
    maturity: 'SIMULATION' as const,
  };
}

function makeDecision(
  task: Task,
  approvalRequired: boolean,
  maximum: bigint,
): FrozenDecision {
  const decision: Omit<FrozenDecision, 'decisionHash'> = {
    id: randomUUID(),
    taskId: task.id,
    organizationId: task.organizationId,
    canonicalIntent: task.intent,
    chosenSkillId: 'skill-a',
    chosenSkillVersion: '1.0.0',
    chosenExecutorRef: 'executor-a',
    executorVersion: '1.0.0',
    skillManifestHash: 'sha256:manifest',
    toolId: 'tool-a',
    toolVersion: '1.0.0',
    modelRef: null,
    rankedFallbacks: [],
    catalogVersion: 'catalog-1',
    policyId: 'policy-a',
    policyVersion: 'policy-1',
    policySnapshot: { mode: 'test' },
    pricingVersion: 'pricing-1',
    pricingSnapshot: { unit: 'credit' },
    estimatedCredits: maximum,
    reservedMaximum: maximum,
    validUntil: new Date(Date.now() + 3_600_000),
    riskLevel: task.riskLevel,
    maturity: task.maturity,
    requiredEvidence: {
      types: ['CHECKSUM'],
      minimumStrength: 'STRONG',
      producerMustMatchExecutor: true,
    },
    requiredScopes: ['tasks.approve'],
    approvalRequired,
    decisionInputsHash: 'sha256:inputs',
    algorithmVersion: 'foundation-002-v1',
    capabilityGapReason: null,
    resolvedAt: new Date(),
  };
  return {
    ...decision,
    decisionHash: computeFrozenDecisionHash(decision),
  };
}

function rehashDecision(decision: FrozenDecision): FrozenDecision {
  return {
    ...decision,
    decisionHash: computeFrozenDecisionHash(decision),
  };
}

function makeCapabilityGapDecision(task: Task): FrozenDecision {
  return rehashDecision({
    ...makeDecision(task, false, 0n),
    chosenSkillId: null,
    chosenSkillVersion: null,
    chosenExecutorRef: null,
    executorVersion: null,
    skillManifestHash: null,
    toolId: null,
    toolVersion: null,
    modelRef: null,
    pricingVersion: null,
    pricingSnapshot: null,
    validUntil: null,
    requiredEvidence: {
      types: [],
      minimumStrength: 'STRONG',
      producerMustMatchExecutor: true,
    },
    requiredScopes: [],
    capabilityGapReason: 'CAPABILITY_GAP',
  });
}

async function preparePlanned(
  store: PrismaKernelStore,
  context: TrustedOrganizationContext,
  prefix: string,
  maximum: bigint,
): Promise<{
  decision: FrozenDecision;
  planned: Task;
}> {
  const ingested = await store.createTask(
    context,
    makeTaskInput(),
    command(`${prefix}-create`),
  );
  const classified = await store.classifyTask(
    context,
    ingested,
    command(`${prefix}-classify`),
  );
  const decision = makeDecision(classified, false, maximum);
  const planned = await store.freezeDecision(
    context,
    classified,
    decision,
    command(`${prefix}-freeze`),
  );
  return { decision, planned };
}

async function prepareGated(
  store: PrismaKernelStore,
  context: TrustedOrganizationContext,
  prefix: string,
  maximum: bigint,
): Promise<{
  decision: FrozenDecision;
  gated: Task;
}> {
  const { decision, planned } = await preparePlanned(
    store,
    context,
    prefix,
    maximum,
  );
  const gated = await store.gateAutomatically(
    context,
    planned,
    decision,
    command(`${prefix}-gate`),
  );
  return { decision, gated };
}

async function prepareBlockedApproval(
  store: PrismaKernelStore,
  context: TrustedOrganizationContext,
  prefix: string,
  maximum: bigint,
  validUntil = new Date(Date.now() + 3_600_000),
  envelopeCreatedAt = new Date(),
): Promise<{
  decision: FrozenDecision;
  envelope: ApprovalEnvelope;
  blocked: Task;
}> {
  const ingested = await store.createTask(
    context,
    makeTaskInput(),
    command(`${prefix}-create`),
  );
  const classified = await store.classifyTask(
    context,
    ingested,
    command(`${prefix}-classify`),
  );
  const decision = rehashDecision({
    ...makeDecision(classified, true, maximum),
    validUntil,
  });
  const planned = await store.freezeDecision(
    context,
    classified,
    decision,
    command(`${prefix}-freeze`),
  );
  const envelope = createApprovalEnvelope({
    id: randomUUID(),
    decision,
    createdAt: envelopeCreatedAt,
  });
  const blocked = await store.blockForApproval(
    context,
    planned,
    envelope,
    command(`${prefix}-block`),
  );
  return { decision, envelope, blocked };
}
