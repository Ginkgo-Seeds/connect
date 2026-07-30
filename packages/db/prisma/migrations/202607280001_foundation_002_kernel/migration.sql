CREATE TYPE "TaskState" AS ENUM (
  'INGESTED', 'CLASSIFIED', 'PLANNED', 'BLOCKED', 'GATED',
  'EXECUTED', 'VERIFIED', 'COMMITTED', 'FAILED'
);
CREATE TYPE "TaskBlockReason" AS ENUM ('AWAITING_APPROVAL', 'CAPABILITY_GAP');
CREATE TYPE "RiskLevel" AS ENUM ('R0', 'R1', 'R2', 'R3');
CREATE TYPE "Maturity" AS ENUM ('SIMULATION', 'SHADOW', 'PRODUCTION');
CREATE TYPE "ApprovalVerdict" AS ENUM ('APPROVED', 'REJECTED');
CREATE TYPE "ExecutionAttemptStatus" AS ENUM (
  'PENDING', 'CLAIMED', 'SUCCEEDED', 'FAILED', 'RECONCILIATION_REQUIRED'
);
CREATE TYPE "ExecutionPhase" AS ENUM ('CLAIMED', 'DISPATCHED', 'TERMINAL');
CREATE TYPE "ExecutionEffectState" AS ENUM ('NONE', 'POSSIBLE', 'CONFIRMED');
CREATE TYPE "ExecutionReplayPolicy" AS ENUM (
  'ALLOW_BEFORE_DISPATCH', 'NO_AUTOMATIC_REEXECUTION_AFTER_DISPATCH'
);
CREATE TYPE "EvidencePurpose" AS ENUM ('APPROVAL', 'EXECUTION', 'VERIFICATION');
CREATE TYPE "EvidenceType" AS ENUM (
  'LOG', 'SNAPSHOT', 'DIFF', 'TEST_RESULT', 'CHECKSUM',
  'EXTERNAL_CONFIRMATION', 'ATTESTATION'
);
CREATE TYPE "EvidenceStrength" AS ENUM ('WEAK', 'MEDIUM', 'STRONG');
CREATE TYPE "CreditReservationStatus" AS ENUM ('ACTIVE', 'SETTLED', 'RELEASED');
CREATE TYPE "CreditLedgerType" AS ENUM ('OPENING_GRANT', 'RESERVE', 'SETTLE', 'RELEASE');

CREATE TABLE "organizations" (
  "id" UUID PRIMARY KEY,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "tasks" (
  "id" UUID PRIMARY KEY,
  "organization_id" UUID NOT NULL,
  "intent" TEXT NOT NULL,
  "instruction" TEXT,
  "inputs" JSONB NOT NULL DEFAULT '{}',
  "risk_level" "RiskLevel" NOT NULL,
  "maturity" "Maturity" NOT NULL,
  "state" "TaskState" NOT NULL DEFAULT 'INGESTED',
  "block_reason" "TaskBlockReason",
  "version" INTEGER NOT NULL DEFAULT 0,
  "event_sequence" BIGINT NOT NULL DEFAULT 0,
  "correlation_id" TEXT NOT NULL,
  "supersedes_task_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tasks_id_organization_key" UNIQUE ("id", "organization_id"),
  CONSTRAINT "tasks_organization_fk" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "tasks_supersedes_fk"
    FOREIGN KEY ("supersedes_task_id", "organization_id")
    REFERENCES "tasks"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "tasks_version_nonnegative" CHECK ("version" >= 0),
  CONSTRAINT "tasks_event_sequence_nonnegative" CHECK ("event_sequence" >= 0),
  CONSTRAINT "tasks_block_reason_consistency" CHECK (
    ("state" = 'BLOCKED' AND "block_reason" IS NOT NULL)
    OR ("state" <> 'BLOCKED' AND "block_reason" IS NULL)
  )
);

CREATE INDEX "tasks_organization_state_created_idx"
  ON "tasks" ("organization_id", "state", "created_at");
CREATE INDEX "tasks_correlation_idx" ON "tasks" ("correlation_id");
CREATE INDEX "tasks_supersedes_idx" ON "tasks" ("supersedes_task_id");

CREATE TABLE "frozen_decisions" (
  "id" UUID PRIMARY KEY,
  "organization_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "canonical_intent" TEXT NOT NULL,
  "chosen_skill_id" TEXT,
  "chosen_skill_version" TEXT,
  "chosen_executor_ref" TEXT,
  "executor_version" TEXT,
  "skill_manifest_hash" TEXT,
  "tool_id" TEXT,
  "tool_version" TEXT,
  "model_ref" TEXT,
  "ranked_fallbacks" JSONB NOT NULL DEFAULT '[]',
  "catalog_version" TEXT NOT NULL,
  "policy_id" TEXT NOT NULL,
  "policy_version" TEXT NOT NULL,
  "policy_snapshot" JSONB NOT NULL,
  "pricing_version" TEXT,
  "pricing_snapshot" JSONB,
  "estimated_credits" BIGINT NOT NULL DEFAULT 0,
  "reserved_maximum" BIGINT NOT NULL DEFAULT 0,
  "valid_until" TIMESTAMPTZ,
  "risk_level" "RiskLevel" NOT NULL,
  "maturity" "Maturity" NOT NULL,
  "required_evidence" JSONB NOT NULL,
  "required_scopes" JSONB NOT NULL DEFAULT '[]',
  "approval_required" BOOLEAN NOT NULL,
  "decision_inputs_hash" TEXT NOT NULL,
  "decision_hash" TEXT NOT NULL,
  "algorithm_version" TEXT NOT NULL,
  "capability_gap_reason" TEXT,
  "resolved_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "frozen_decisions_task_key" UNIQUE ("task_id"),
  CONSTRAINT "frozen_decisions_task_organization_key"
    UNIQUE ("task_id", "organization_id"),
  CONSTRAINT "frozen_decisions_id_organization_key" UNIQUE ("id", "organization_id"),
  CONSTRAINT "frozen_decisions_id_task_organization_key"
    UNIQUE ("id", "task_id", "organization_id"),
  CONSTRAINT "frozen_decisions_task_fk" FOREIGN KEY ("task_id", "organization_id")
    REFERENCES "tasks"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "frozen_decisions_credit_bounds" CHECK (
    "estimated_credits" >= 0
    AND "reserved_maximum" >= "estimated_credits"
  ),
  CONSTRAINT "frozen_decisions_choice_consistency" CHECK (
    (
      "chosen_skill_id" IS NULL
      AND "chosen_skill_version" IS NULL
      AND "chosen_executor_ref" IS NULL
      AND "executor_version" IS NULL
      AND "skill_manifest_hash" IS NULL
      AND "tool_id" IS NULL
      AND "tool_version" IS NULL
      AND "model_ref" IS NULL
      AND "pricing_version" IS NULL
      AND "pricing_snapshot" IS NULL
      AND "valid_until" IS NULL
      AND "estimated_credits" = 0
      AND "reserved_maximum" = 0
      AND "approval_required" = FALSE
      AND "capability_gap_reason" IS NOT NULL
    )
    OR (
      "chosen_skill_id" IS NOT NULL
      AND "chosen_skill_version" IS NOT NULL
      AND "chosen_executor_ref" IS NOT NULL
      AND "executor_version" IS NOT NULL
      AND "skill_manifest_hash" IS NOT NULL
      AND "tool_id" IS NOT NULL
      AND "tool_version" IS NOT NULL
      AND "pricing_version" IS NOT NULL
      AND "pricing_snapshot" IS NOT NULL
      AND "valid_until" IS NOT NULL
      AND "capability_gap_reason" IS NULL
    )
  )
);
CREATE INDEX "frozen_decisions_organization_hash_idx"
  ON "frozen_decisions" ("organization_id", "decision_hash");

CREATE TABLE "approval_envelopes" (
  "id" UUID PRIMARY KEY,
  "organization_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "frozen_decision_id" UUID NOT NULL,
  "decision_hash" TEXT NOT NULL,
  "policy_version" TEXT NOT NULL,
  "pricing_version" TEXT NOT NULL,
  "tool_version" TEXT NOT NULL,
  "executor_version" TEXT NOT NULL,
  "estimated_credits" BIGINT NOT NULL,
  "reserved_maximum" BIGINT NOT NULL,
  "required_scopes" JSONB NOT NULL DEFAULT '[]',
  "valid_until" TIMESTAMPTZ NOT NULL,
  "envelope_hash" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "approval_envelopes_task_key" UNIQUE ("task_id"),
  CONSTRAINT "approval_envelopes_task_organization_key"
    UNIQUE ("task_id", "organization_id"),
  CONSTRAINT "approval_envelopes_decision_key" UNIQUE ("frozen_decision_id"),
  CONSTRAINT "approval_envelopes_decision_organization_key"
    UNIQUE ("frozen_decision_id", "organization_id"),
  CONSTRAINT "approval_envelopes_decision_task_organization_key"
    UNIQUE ("frozen_decision_id", "task_id", "organization_id"),
  CONSTRAINT "approval_envelopes_id_organization_key" UNIQUE ("id", "organization_id"),
  CONSTRAINT "approval_envelopes_id_task_organization_key"
    UNIQUE ("id", "task_id", "organization_id"),
  CONSTRAINT "approval_envelopes_task_fk" FOREIGN KEY ("task_id", "organization_id")
    REFERENCES "tasks"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "approval_envelopes_decision_fk"
    FOREIGN KEY ("frozen_decision_id", "task_id", "organization_id")
    REFERENCES "frozen_decisions"("id", "task_id", "organization_id")
    ON DELETE RESTRICT,
  CONSTRAINT "approval_envelopes_credit_bounds" CHECK (
    "estimated_credits" >= 0
    AND "reserved_maximum" >= "estimated_credits"
  )
);
CREATE INDEX "approval_envelopes_validity_idx"
  ON "approval_envelopes" ("organization_id", "valid_until");

CREATE TABLE "approval_decisions" (
  "id" UUID PRIMARY KEY,
  "organization_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "approval_envelope_id" UUID NOT NULL,
  "verdict" "ApprovalVerdict" NOT NULL,
  "actor_ref" TEXT NOT NULL,
  "actor_scopes" JSONB NOT NULL DEFAULT '[]',
  "reason" TEXT,
  "envelope_hash" TEXT NOT NULL,
  "decision_hash" TEXT NOT NULL,
  "command_id" TEXT NOT NULL,
  "decided_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "approval_decisions_envelope_key" UNIQUE ("approval_envelope_id"),
  CONSTRAINT "approval_decisions_envelope_organization_key"
    UNIQUE ("approval_envelope_id", "organization_id"),
  CONSTRAINT "approval_decisions_envelope_task_organization_key"
    UNIQUE ("approval_envelope_id", "task_id", "organization_id"),
  CONSTRAINT "approval_decisions_envelope_fk"
    FOREIGN KEY ("approval_envelope_id", "task_id", "organization_id")
    REFERENCES "approval_envelopes"("id", "task_id", "organization_id")
    ON DELETE RESTRICT,
  CONSTRAINT "approval_decisions_task_fk"
    FOREIGN KEY ("task_id", "organization_id")
    REFERENCES "tasks"("id", "organization_id") ON DELETE RESTRICT
);
CREATE INDEX "approval_decisions_task_idx"
  ON "approval_decisions" ("organization_id", "task_id");

CREATE TABLE "execution_attempts" (
  "id" UUID PRIMARY KEY,
  "organization_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "status" "ExecutionAttemptStatus" NOT NULL DEFAULT 'PENDING',
  "claimed_at" TIMESTAMPTZ,
  "claimed_by" TEXT,
  "lease_expires_at" TIMESTAMPTZ,
  "dispatched_at" TIMESTAMPTZ,
  "execution_phase" "ExecutionPhase" NOT NULL DEFAULT 'CLAIMED',
  "effect_state" "ExecutionEffectState" NOT NULL DEFAULT 'NONE',
  "replay_policy" "ExecutionReplayPolicy" NOT NULL DEFAULT 'ALLOW_BEFORE_DISPATCH',
  "claims" INTEGER NOT NULL DEFAULT 0,
  "actual_usage" BIGINT,
  "charged_credits" BIGINT,
  "overrun_credits" BIGINT,
  "provider_cost_minor" BIGINT,
  "provider_cost_currency" TEXT,
  "effect_may_have_occurred" BOOLEAN NOT NULL DEFAULT FALSE,
  "output" JSONB,
  "failure_code" TEXT,
  "failure_message" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ,
  CONSTRAINT "execution_attempts_task_key" UNIQUE ("task_id"),
  CONSTRAINT "execution_attempts_task_organization_key"
    UNIQUE ("task_id", "organization_id"),
  CONSTRAINT "execution_attempts_id_organization_key" UNIQUE ("id", "organization_id"),
  CONSTRAINT "execution_attempts_id_task_organization_key"
    UNIQUE ("id", "task_id", "organization_id"),
  CONSTRAINT "execution_attempts_idempotency_key"
    UNIQUE ("organization_id", "idempotency_key"),
  CONSTRAINT "execution_attempts_task_fk" FOREIGN KEY ("task_id", "organization_id")
    REFERENCES "tasks"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "execution_attempts_claims_nonnegative" CHECK ("claims" >= 0),
  CONSTRAINT "execution_attempts_usage_nonnegative" CHECK (
    ("actual_usage" IS NULL OR "actual_usage" >= 0)
    AND ("charged_credits" IS NULL OR "charged_credits" >= 0)
    AND ("overrun_credits" IS NULL OR "overrun_credits" >= 0)
    AND ("provider_cost_minor" IS NULL OR "provider_cost_minor" >= 0)
  ),
  CONSTRAINT "execution_attempts_dispatch_consistency" CHECK (
    (
      "dispatched_at" IS NULL
      AND "execution_phase" IN ('CLAIMED', 'TERMINAL')
      AND "effect_state" = 'NONE'
      AND "replay_policy" = 'ALLOW_BEFORE_DISPATCH'
      AND "effect_may_have_occurred" = FALSE
    )
    OR (
      "dispatched_at" IS NOT NULL
      AND "execution_phase" IN ('DISPATCHED', 'TERMINAL')
      AND "replay_policy" = 'NO_AUTOMATIC_REEXECUTION_AFTER_DISPATCH'
      AND "effect_may_have_occurred" = ("effect_state" IN ('POSSIBLE', 'CONFIRMED'))
    )
  )
);
CREATE INDEX "execution_attempts_lease_idx"
  ON "execution_attempts" ("status", "lease_expires_at");

CREATE TABLE "task_events" (
  "id" UUID PRIMARY KEY,
  "organization_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "sequence" BIGINT NOT NULL,
  "name" TEXT NOT NULL,
  "from_state" "TaskState" NOT NULL,
  "to_state" "TaskState",
  "payload" JSONB,
  "correlation_id" TEXT NOT NULL,
  "command_id" TEXT NOT NULL,
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_events_id_organization_key" UNIQUE ("id", "organization_id"),
  CONSTRAINT "task_events_task_sequence_key" UNIQUE ("task_id", "sequence"),
  CONSTRAINT "task_events_task_fk" FOREIGN KEY ("task_id", "organization_id")
    REFERENCES "tasks"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "task_events_sequence_positive" CHECK ("sequence" > 0),
  CONSTRAINT "task_events_transition_not_reflexive" CHECK (
    "to_state" IS NULL OR "from_state" <> "to_state"
  )
);
CREATE INDEX "task_events_timeline_idx"
  ON "task_events" ("organization_id", "task_id", "occurred_at");

CREATE TABLE "evidence" (
  "id" UUID PRIMARY KEY,
  "organization_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "attempt_id" UUID,
  "approval_envelope_id" UUID,
  "purpose" "EvidencePurpose" NOT NULL,
  "type" "EvidenceType" NOT NULL,
  "strength" "EvidenceStrength" NOT NULL,
  "producer" TEXT NOT NULL,
  "content_hash" TEXT,
  "payload" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "evidence_task_fk" FOREIGN KEY ("task_id", "organization_id")
    REFERENCES "tasks"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "evidence_attempt_fk" FOREIGN KEY ("attempt_id", "organization_id")
    REFERENCES "execution_attempts"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "evidence_approval_envelope_fk"
    FOREIGN KEY ("approval_envelope_id", "task_id", "organization_id")
    REFERENCES "approval_envelopes"("id", "task_id", "organization_id")
    ON DELETE RESTRICT,
  CONSTRAINT "evidence_attempt_task_fk"
    FOREIGN KEY ("attempt_id", "task_id", "organization_id")
    REFERENCES "execution_attempts"("id", "task_id", "organization_id")
    ON DELETE RESTRICT
);
CREATE INDEX "evidence_task_purpose_idx"
  ON "evidence" ("organization_id", "task_id", "purpose", "created_at");
CREATE INDEX "evidence_content_hash_idx" ON "evidence" ("content_hash");

CREATE TABLE "credit_accounts" (
  "organization_id" UUID PRIMARY KEY,
  "available" BIGINT NOT NULL DEFAULT 0,
  "reserved" BIGINT NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_accounts_organization_fk" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "credit_accounts_nonnegative" CHECK (
    "available" >= 0 AND "reserved" >= 0 AND "version" >= 0
  )
);

CREATE TABLE "credit_reservations" (
  "id" UUID PRIMARY KEY,
  "organization_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "status" "CreditReservationStatus" NOT NULL DEFAULT 'ACTIVE',
  "reserved_amount" BIGINT NOT NULL,
  "settled_amount" BIGINT,
  "released_amount" BIGINT,
  "pricing_version" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "terminal_at" TIMESTAMPTZ,
  CONSTRAINT "credit_reservations_task_key" UNIQUE ("task_id"),
  CONSTRAINT "credit_reservations_task_organization_key"
    UNIQUE ("task_id", "organization_id"),
  CONSTRAINT "credit_reservations_id_organization_key" UNIQUE ("id", "organization_id"),
  CONSTRAINT "credit_reservations_id_task_organization_key"
    UNIQUE ("id", "task_id", "organization_id"),
  CONSTRAINT "credit_reservations_task_fk" FOREIGN KEY ("task_id", "organization_id")
    REFERENCES "tasks"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "credit_reservations_amounts" CHECK (
    "reserved_amount" >= 0
    AND ("settled_amount" IS NULL OR (
      "settled_amount" >= 0 AND "settled_amount" <= "reserved_amount"
    ))
    AND ("released_amount" IS NULL OR (
      "released_amount" >= 0 AND "released_amount" <= "reserved_amount"
    ))
  ),
  CONSTRAINT "credit_reservations_terminal_consistency" CHECK (
    ("status" = 'ACTIVE'
      AND "settled_amount" IS NULL
      AND "released_amount" IS NULL
      AND "terminal_at" IS NULL)
    OR ("status" = 'SETTLED'
      AND "settled_amount" IS NOT NULL
      AND "released_amount" IS NULL
      AND "terminal_at" IS NOT NULL)
    OR ("status" = 'RELEASED'
      AND "settled_amount" IS NULL
      AND "released_amount" IS NOT NULL
      AND "terminal_at" IS NOT NULL)
  )
);
CREATE INDEX "credit_reservations_organization_status_idx"
  ON "credit_reservations" ("organization_id", "status");

CREATE TABLE "credit_ledger" (
  "id" UUID PRIMARY KEY,
  "organization_id" UUID NOT NULL,
  "task_id" UUID,
  "reservation_id" UUID,
  "attempt_id" UUID,
  "entry_type" "CreditLedgerType" NOT NULL,
  "amount" BIGINT NOT NULL,
  "available_delta" BIGINT NOT NULL,
  "reserved_delta" BIGINT NOT NULL,
  "actual_usage" BIGINT,
  "overrun_credits" BIGINT,
  "pricing_version" TEXT,
  "executor_version" TEXT,
  "provider_cost_minor" BIGINT,
  "provider_cost_currency" TEXT,
  "command_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_ledger_reservation_type_key"
    UNIQUE ("reservation_id", "entry_type"),
  CONSTRAINT "credit_ledger_reservation_fk"
    FOREIGN KEY ("reservation_id", "task_id", "organization_id")
    REFERENCES "credit_reservations"("id", "task_id", "organization_id")
    ON DELETE RESTRICT,
  CONSTRAINT "credit_ledger_organization_fk"
    FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "credit_ledger_task_fk"
    FOREIGN KEY ("task_id", "organization_id")
    REFERENCES "tasks"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "credit_ledger_attempt_fk"
    FOREIGN KEY ("attempt_id", "task_id", "organization_id")
    REFERENCES "execution_attempts"("id", "task_id", "organization_id")
    ON DELETE RESTRICT,
  CONSTRAINT "credit_ledger_amounts_nonnegative" CHECK (
    "amount" >= 0
    AND ("actual_usage" IS NULL OR "actual_usage" >= 0)
    AND ("overrun_credits" IS NULL OR "overrun_credits" >= 0)
    AND ("provider_cost_minor" IS NULL OR "provider_cost_minor" >= 0)
  ),
  CONSTRAINT "credit_ledger_entry_consistency" CHECK (
    ("entry_type" = 'OPENING_GRANT'
      AND "task_id" IS NULL
      AND "reservation_id" IS NULL
      AND "attempt_id" IS NULL)
    OR ("entry_type" = 'RESERVE'
      AND "task_id" IS NOT NULL
      AND "reservation_id" IS NOT NULL
      AND "attempt_id" IS NULL)
    OR ("entry_type" IN ('SETTLE', 'RELEASE')
      AND "task_id" IS NOT NULL
      AND "reservation_id" IS NOT NULL
      AND "attempt_id" IS NOT NULL)
  )
);
CREATE INDEX "credit_ledger_organization_timeline_idx"
  ON "credit_ledger" ("organization_id", "created_at");
CREATE INDEX "credit_ledger_task_idx" ON "credit_ledger" ("task_id");

CREATE TABLE "command_receipts" (
  "id" UUID PRIMARY KEY,
  "organization_id" UUID NOT NULL,
  "operation" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "task_id" UUID,
  "result" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "command_receipts_idempotency_key"
    UNIQUE ("organization_id", "operation", "idempotency_key"),
  CONSTRAINT "command_receipts_organization_fk"
    FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "command_receipts_task_fk"
    FOREIGN KEY ("task_id", "organization_id")
    REFERENCES "tasks"("id", "organization_id") ON DELETE RESTRICT
);
CREATE INDEX "command_receipts_task_idx"
  ON "command_receipts" ("organization_id", "task_id");

CREATE TABLE "outbox_messages" (
  "id" UUID PRIMARY KEY,
  "organization_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "topic" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimed_at" TIMESTAMPTZ,
  "claimed_by" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_error_code" TEXT,
  "published_at" TIMESTAMPTZ,
  CONSTRAINT "outbox_messages_event_key" UNIQUE ("event_id"),
  CONSTRAINT "outbox_messages_event_organization_key"
    UNIQUE ("event_id", "organization_id"),
  CONSTRAINT "outbox_messages_event_fk" FOREIGN KEY ("event_id", "organization_id")
    REFERENCES "task_events"("id", "organization_id") ON DELETE RESTRICT,
  CONSTRAINT "outbox_messages_attempts_nonnegative" CHECK ("attempts" >= 0),
  CONSTRAINT "outbox_messages_schema_version_positive" CHECK ("schema_version" > 0)
);
CREATE INDEX "outbox_messages_organization_idx"
  ON "outbox_messages" ("organization_id", "created_at");
CREATE INDEX "outbox_messages_pending_idx"
  ON "outbox_messages" ("available_at", "created_at")
  WHERE "published_at" IS NULL;

CREATE OR REPLACE FUNCTION reject_append_only_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'append-only relation % does not permit %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "frozen_decisions_append_only"
  BEFORE UPDATE OR DELETE ON "frozen_decisions"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER "approval_envelopes_append_only"
  BEFORE UPDATE OR DELETE ON "approval_envelopes"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER "approval_decisions_append_only"
  BEFORE UPDATE OR DELETE ON "approval_decisions"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER "task_events_append_only"
  BEFORE UPDATE OR DELETE ON "task_events"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER "evidence_append_only"
  BEFORE UPDATE OR DELETE ON "evidence"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER "credit_ledger_append_only"
  BEFORE UPDATE OR DELETE ON "credit_ledger"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER "command_receipts_append_only"
  BEFORE UPDATE OR DELETE ON "command_receipts"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE OR REPLACE FUNCTION protect_outbox_message()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'outbox messages cannot be deleted' USING ERRCODE = '55000';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
    OR NEW."event_id" IS DISTINCT FROM OLD."event_id"
    OR NEW."topic" IS DISTINCT FROM OLD."topic"
    OR NEW."payload" IS DISTINCT FROM OLD."payload"
    OR NEW."schema_version" IS DISTINCT FROM OLD."schema_version"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'immutable outbox fields cannot be changed'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "outbox_messages_protect_payload"
  BEFORE UPDATE OR DELETE ON "outbox_messages"
  FOR EACH ROW EXECUTE FUNCTION protect_outbox_message();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ginkgo_app') THEN
    RAISE EXCEPTION 'required PostgreSQL application role ginkgo_app is missing';
  END IF;
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO ginkgo_app',
    current_database()
  );
END;
$$;

GRANT USAGE ON SCHEMA public TO "ginkgo_app";
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO "ginkgo_app";
