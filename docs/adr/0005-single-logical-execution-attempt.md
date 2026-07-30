# ADR 0005: One logical execution attempt per Task

- Status: Accepted
- Date: 2026-07-28
- Implementation: Foundation 002

## Context

An executor may perform an external effect immediately before a worker crashes.
Creating a fresh attempt or idempotency key during recovery could repeat that
effect and charge the organization twice.

## Decision

- A Task owns exactly one ExecutionAttempt, enforced by `UNIQUE(taskId)`.
- The attempt ID and executor idempotency key remain stable for the lifetime of
  the Task.
- A lease reclaim increments operational claim metadata but reuses the same
  attempt and idempotency key.
- No PostgreSQL transaction remains open while the executor or another external
  provider is called.
- Before the executor is called, a short transaction persists `dispatchedAt`,
  `executionPhase = DISPATCHED`, `effectState = POSSIBLE`, and
  `replayPolicy = NO_AUTOMATIC_REEXECUTION_AFTER_DISPATCH`, together with its
  TaskEvent and outbox message. The external call begins only after commit.
- An expired `CLAIMED` lease may be reclaimed only when it has never reached
  `DISPATCHED`, has no possible effect, and retains
  `ALLOW_BEFORE_DISPATCH`.
- An expired `DISPATCHED` lease is never reclaimed automatically in Foundation 002. It keeps the same attempt ID and idempotency key, moves to
  `RECONCILIATION_REQUIRED`, records
  `execution.reconciliation_required`, and preserves the active credit
  reservation.
- A known or possible external effect that cannot be resolved locally moves the
  attempt to `RECONCILIATION_REQUIRED` and prevents automatic re-execution.
- Executor errors and failures while persisting a returned executor result are
  separate boundaries. If result persistence fails, the system attempts a
  reconciliation write without releasing credits. If that write also fails,
  it propagates `POST_EXECUTION_PERSISTENCE_FAILURE`; the durable
  `DISPATCHED` marker remains the retry guard.
- A terminal failure is never retried by creating another attempt for the same
  Task. Business retry requires a successor Task linked by `supersedesTaskId`.

## Consequences

The execution adapter must honor the stable idempotency key, and operators need
a future reconciliation workflow for uncertain effects. Multi-attempt retry
policies, automatic compensation, and a reconciliation UI are explicitly
deferred beyond Foundation 002.
