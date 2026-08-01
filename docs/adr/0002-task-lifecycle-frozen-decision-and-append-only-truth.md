# ADR 0002: Task lifecycle, frozen decisions, and append-only truth

- Status: Accepted
- Date: 2026-07-28
- Implementation: Foundation 002

## Context

Governed execution requires an auditable distinction between mutable planning
and an approved decision that is ready for execution. Rewriting historical
evidence would make reviews, recovery, and financial reconciliation unreliable.

## Decision

- Task lifecycle transitions will be explicit, validated, and recorded.
- A frozen decision is written once per Task and is immutable. Corrections
  require a successor Task linked by `supersedesTaskId`; resume never
  recalculates the decision.
- Frozen decisions, approval envelopes, human approval decisions, Evidence,
  TaskEvents, credit ledger entries, and command receipts are append-only at
  the PostgreSQL trigger layer.
- ExecutionAttempt is a mutable operational projection with exactly one logical
  identity per Task. ADR 0005 defines its lifecycle and retry boundary.
- Derived views may be rebuilt from those facts but cannot replace them as the
  authoritative history.
- Human approval is represented by a dedicated, mutually exclusive
  ApprovalDecision plus an ATTESTATION Evidence record. Technical Evidence may
  reference the same envelope without becoming a second human decision.
- Informational TaskEvents use `toState = null`; facts never require an
  artificial state transition.
- `VERIFIED` and `COMMITTED` are authorized only from Evidence reloaded from
  PostgreSQL inside the lifecycle transaction. Their public commands accept a
  trusted organization context, Task identity, expected version, and command
  metadata; they do not accept an execution snapshot or Evidence supplied by a
  caller.
- Verification reloads the Task, FrozenDecision, the Task's single persisted
  ExecutionAttempt, and only the execution Evidence matching that organization,
  Task, and attempt. Commit reloads and revalidates the same facts before credit
  settlement. Evidence from another tenant, Task, attempt, or an in-memory
  request cannot authorize either transition.

## Consequences

The Foundation 002 schema and repositories implement the lifecycle,
idempotency, causal links, tenant-safe foreign keys, and historical
reconstruction. Product APIs and UI remain outside this decision.
