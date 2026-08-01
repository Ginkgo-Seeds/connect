import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from './postgres.js';

describe('Foundation 002 PostgreSQL baseline', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await startTestDatabase();
  }, 120_000);

  afterAll(async () => {
    if (database) {
      await stopTestDatabase(database);
    }
  });

  it('creates all kernel relations and protection triggers', async () => {
    const relations = await database.pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`,
    );
    expect(relations.rows.map(({ table_name }) => table_name)).toEqual(
      expect.arrayContaining([
        'approval_decisions',
        'approval_envelopes',
        'command_receipts',
        'credit_accounts',
        'credit_ledger',
        'credit_reservations',
        'evidence',
        'execution_attempts',
        'frozen_decisions',
        'organizations',
        'outbox_messages',
        'task_events',
        'tasks',
      ]),
    );

    const triggers = await database.pool.query<{ trigger_name: string }>(
      `SELECT trigger_name
       FROM information_schema.triggers
       WHERE trigger_schema = 'public'
       ORDER BY trigger_name`,
    );
    expect(triggers.rows.map(({ trigger_name }) => trigger_name)).toEqual(
      expect.arrayContaining([
        'approval_decisions_append_only',
        'approval_envelopes_append_only',
        'command_receipts_append_only',
        'credit_ledger_append_only',
        'evidence_append_only',
        'frozen_decisions_append_only',
        'outbox_messages_protect_payload',
        'task_events_append_only',
      ]),
    );
  });

  it('runs functional SQL as a constrained application role', async () => {
    const role = await database.pool.query<{
      current_user: string;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT current_user, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
       FROM pg_roles
       WHERE rolname = current_user`,
    );
    expect(role.rows[0]).toEqual({
      current_user: 'ginkgo_app',
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolbypassrls: false,
    });
    await expect(
      database.pool.query(
        'CREATE TABLE application_must_not_own_schema(id int)',
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      database.pool.query(
        'ALTER TABLE task_events DISABLE TRIGGER task_events_append_only',
      ),
    ).rejects.toMatchObject({ code: '42501' });
    const deletePrivilege = await database.pool.query<{ allowed: boolean }>(
      `SELECT has_table_privilege(
         current_user,
         'task_events',
         'DELETE'
       ) AS allowed`,
    );
    expect(deletePrivilege.rows[0]?.allowed).toBe(false);
  });

  it('allows an informational event and rejects a reflexive transition', async () => {
    const organizationId = randomUUID();
    const taskId = randomUUID();
    await database.pool.query('INSERT INTO organizations (id) VALUES ($1)', [
      organizationId,
    ]);
    await database.pool.query(
      `INSERT INTO tasks (
         id, organization_id, intent, risk_level, maturity, state,
         version, event_sequence, correlation_id, block_reason
       ) VALUES ($2, $1, 'test', 'R0', 'SIMULATION', 'BLOCKED',
         1, 2, 'corr', 'AWAITING_APPROVAL')`,
      [organizationId, taskId],
    );

    await expect(
      database.pool.query(
        `INSERT INTO task_events (
           id, organization_id, task_id, sequence, name, from_state,
           to_state, correlation_id, command_id
         ) VALUES ($1, $2, $3, 1, 'task.resume_failed', 'BLOCKED',
           NULL, 'corr', 'cmd')`,
        [randomUUID(), organizationId, taskId],
      ),
    ).resolves.toBeDefined();

    await expect(
      database.pool.query(
        `INSERT INTO task_events (
           id, organization_id, task_id, sequence, name, from_state,
           to_state, correlation_id, command_id
         ) VALUES ($1, $2, $3, 2, 'invalid', 'BLOCKED',
           'BLOCKED', 'corr', 'cmd')`,
        [randomUUID(), organizationId, taskId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('blocks UPDATE and DELETE on every append-only relation for the application role', async () => {
    await seedProtectedGraph(database);
    const relations = [
      'frozen_decisions',
      'approval_envelopes',
      'approval_decisions',
      'task_events',
      'evidence',
      'credit_ledger',
      'command_receipts',
    ];

    for (const relation of relations) {
      await expect(
        database.pool.query(
          `UPDATE "${relation}" SET "id" = "id"
           WHERE "id" = (SELECT "id" FROM "${relation}" LIMIT 1)`,
        ),
      ).rejects.toMatchObject({ code: '55000' });
      await expect(
        database.adminPool.query(
          `GRANT DELETE ON TABLE "${relation}" TO "ginkgo_app"`,
        ),
      ).resolves.toBeDefined();
      try {
        await expect(
          database.pool.query(
            `DELETE FROM "${relation}"
             WHERE "id" = (SELECT "id" FROM "${relation}" LIMIT 1)`,
          ),
        ).rejects.toMatchObject({ code: '55000' });
      } finally {
        await database.adminPool.query(
          `REVOKE DELETE ON TABLE "${relation}" FROM "ginkgo_app"`,
        );
      }
      await expect(
        database.adminPool.query(
          `DELETE FROM "${relation}"
           WHERE "id" = (SELECT "id" FROM "${relation}" LIMIT 1)`,
        ),
      ).rejects.toMatchObject({ code: '55000' });
    }
  });

  it('keeps one human decision while allowing technical evidence on the same envelope', async () => {
    const seeded = await seedProtectedGraph(database);
    await expect(
      database.pool.query(
        `INSERT INTO evidence (
           id, organization_id, task_id, approval_envelope_id, purpose,
           type, strength, producer, content_hash
         ) VALUES ($1, $2, $3, $4, 'EXECUTION', 'CHECKSUM', 'STRONG',
           'executor:test', 'sha256:technical')`,
        [randomUUID(), seeded.organizationId, seeded.taskId, seeded.envelopeId],
      ),
    ).resolves.toBeDefined();
    await expect(
      database.pool.query(
        `INSERT INTO approval_decisions (
           id, organization_id, task_id, approval_envelope_id, verdict,
           actor_ref, actor_scopes, envelope_hash, decision_hash, command_id,
           decided_at
         ) VALUES ($1, $2, $3, $4, 'REJECTED', 'actor:other', '[]',
           'envelope-hash', 'decision-hash-2', 'reject', CURRENT_TIMESTAMP)`,
        [randomUUID(), seeded.organizationId, seeded.taskId, seeded.envelopeId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('allows only operational outbox updates and forbids immutable updates or deletes', async () => {
    const seeded = await seedProtectedGraph(database);
    await expect(
      database.pool.query(
        `UPDATE outbox_messages
         SET claimed_at = CURRENT_TIMESTAMP,
             claimed_by = 'publisher',
             attempts = attempts + 1,
             available_at = CURRENT_TIMESTAMP,
             last_error_code = 'RETRY',
             published_at = CURRENT_TIMESTAMP
         WHERE event_id = $1`,
        [seeded.eventId],
      ),
    ).resolves.toBeDefined();
    await expect(
      database.pool.query(
        `UPDATE outbox_messages SET topic = 'changed' WHERE event_id = $1`,
        [seeded.eventId],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await database.adminPool.query(
      'GRANT DELETE ON TABLE outbox_messages TO ginkgo_app',
    );
    try {
      await expect(
        database.pool.query('DELETE FROM outbox_messages WHERE event_id = $1', [
          seeded.eventId,
        ]),
      ).rejects.toMatchObject({ code: '55000' });
    } finally {
      await database.adminPool.query(
        'REVOKE DELETE ON TABLE outbox_messages FROM ginkgo_app',
      );
    }
    await expect(
      database.adminPool.query(
        'DELETE FROM outbox_messages WHERE event_id = $1',
        [seeded.eventId],
      ),
    ).rejects.toMatchObject({ code: '55000' });
  });
});

async function seedProtectedGraph(database: TestDatabase): Promise<{
  organizationId: string;
  taskId: string;
  envelopeId: string;
  eventId: string;
}> {
  const organizationId = randomUUID();
  const taskId = randomUUID();
  const decisionId = randomUUID();
  const envelopeId = randomUUID();
  const eventId = randomUUID();
  await database.pool.query('INSERT INTO organizations (id) VALUES ($1)', [
    organizationId,
  ]);
  await database.pool.query(
    `INSERT INTO tasks (
       id, organization_id, intent, risk_level, maturity, state, block_reason,
       version, event_sequence, correlation_id
     ) VALUES ($1, $2, 'protected', 'R1', 'SIMULATION', 'BLOCKED',
       'AWAITING_APPROVAL', 1, 1, 'correlation')`,
    [taskId, organizationId],
  );
  await database.pool.query(
    `INSERT INTO frozen_decisions (
       id, organization_id, task_id, canonical_intent, chosen_skill_id,
       chosen_skill_version, chosen_executor_ref, executor_version,
       skill_manifest_hash, tool_id, tool_version, ranked_fallbacks,
       catalog_version, policy_id, policy_version, policy_snapshot,
       pricing_version, pricing_snapshot, estimated_credits, reserved_maximum,
       valid_until, risk_level, maturity, required_evidence, required_scopes,
       approval_required, decision_inputs_hash, decision_hash,
       algorithm_version, resolved_at
     ) VALUES (
       $1, $2, $3, 'protected', 'skill', '1', 'executor', '1',
       'manifest', 'tool', '1', '[]', 'catalog', 'policy', '1', '{}',
       'pricing', '{}', 10, 10, CURRENT_TIMESTAMP + INTERVAL '1 hour',
       'R1', 'SIMULATION', '{}', '[]', TRUE, 'inputs-hash',
       'decision-hash', 'v1', CURRENT_TIMESTAMP
     )`,
    [decisionId, organizationId, taskId],
  );
  await database.pool.query(
    `INSERT INTO approval_envelopes (
       id, organization_id, task_id, frozen_decision_id, decision_hash,
       policy_version, pricing_version, tool_version, executor_version,
       estimated_credits, reserved_maximum, required_scopes, valid_until,
       envelope_hash, created_at
     ) VALUES (
       $1, $2, $3, $4, 'decision-hash', '1', 'pricing', '1', '1',
       10, 10, '[]', CURRENT_TIMESTAMP + INTERVAL '1 hour',
       'envelope-hash', CURRENT_TIMESTAMP
     )`,
    [envelopeId, organizationId, taskId, decisionId],
  );
  await database.pool.query(
    `INSERT INTO approval_decisions (
       id, organization_id, task_id, approval_envelope_id, verdict,
       actor_ref, actor_scopes, envelope_hash, decision_hash, command_id,
       decided_at
     ) VALUES (
       $1, $2, $3, $4, 'APPROVED', 'actor:test', '[]',
       'envelope-hash', 'approval-hash', 'approve', CURRENT_TIMESTAMP
     )`,
    [randomUUID(), organizationId, taskId, envelopeId],
  );
  await database.pool.query(
    `INSERT INTO task_events (
       id, organization_id, task_id, sequence, name, from_state, to_state,
       correlation_id, command_id
     ) VALUES (
       $1, $2, $3, 1, 'approval.approved', 'BLOCKED', NULL,
       'correlation', 'approve'
     )`,
    [eventId, organizationId, taskId],
  );
  await database.pool.query(
    `INSERT INTO evidence (
       id, organization_id, task_id, approval_envelope_id, purpose,
       type, strength, producer, content_hash
     ) VALUES (
       $1, $2, $3, $4, 'APPROVAL', 'ATTESTATION', 'STRONG',
       'actor:test', 'approval-hash'
     )`,
    [randomUUID(), organizationId, taskId, envelopeId],
  );
  await database.pool.query(
    `INSERT INTO credit_ledger (
       id, organization_id, entry_type, amount, available_delta,
       reserved_delta, command_id
     ) VALUES ($1, $2, 'OPENING_GRANT', 10, 10, 0, 'grant')`,
    [randomUUID(), organizationId],
  );
  await database.pool.query(
    `INSERT INTO command_receipts (
       id, organization_id, operation, idempotency_key, request_hash, task_id,
       result
     ) VALUES ($1, $2, 'task.create', 'create', 'hash', $3, '{}')`,
    [randomUUID(), organizationId, taskId],
  );
  await database.pool.query(
    `INSERT INTO outbox_messages (
       id, organization_id, event_id, topic, payload
     ) VALUES ($1, $2, $3, 'approval.approved', '{}')`,
    [randomUUID(), organizationId, eventId],
  );
  return { organizationId, taskId, envelopeId, eventId };
}
