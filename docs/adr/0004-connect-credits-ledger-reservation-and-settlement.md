# ADR 0004: Connect Credits ledger, reservation, and settlement

- Status: Accepted
- Date: 2026-07-28
- Implementation: Foundation 002

## Context

The product will use its own credit model. Governed execution needs to reserve a
maximum amount before work begins and reconcile it with the final charge without
silently mutating balances.

## Decision

- Connect Credits will use an append-only ledger.
- An execution will reserve credits before external work is authorized.
- Successful or partially billable work will settle the applicable amount and
  release the unused reservation.
- Rejected, cancelled, or non-billable work will release its reservation.
- Reservation, settlement, and release operations will be idempotent and
  traceable to the originating task and execution.
- Ledger truth will live in PostgreSQL, not Redis.
- All credit and provider-cost values are integers represented as PostgreSQL
  `BIGINT` and TypeScript `bigint`; floating point is forbidden.
- Each Task has at most one logical reservation. Reserve, settle, or release is
  committed atomically with the associated lifecycle facts.
- Settlement is capped at the reserved maximum. If actual usage exceeds that
  ceiling, settlement, ledger, attempt overrun, Evidence, Task failure,
  TaskEvents, and outbox messages are one transaction.
- Approval is durable before reservation. Insufficient balance keeps the Task
  blocked, preserves the approval, and emits an informational resume-failure
  event without creating an active reservation.
- Crossing the persisted `DISPATCHED` boundary means that an external effect is
  possible. If the executor result cannot be persisted, the existing
  reservation remains active: the system neither releases it blindly nor
  settles an unconfirmed charge. The attempt and Task require reconciliation,
  with known usage and Evidence retained when available.
- A result explicitly persisted with reliable usage may be settled according to
  the normal failure policy. Missing or uncertain post-dispatch information is
  never interpreted as proof that no effect occurred.

## Consequences

Foundation 002 defines integer precision, versioned pricing snapshots, a
no-overdraft policy, reservation/settlement/release, and explicit overrun
reconciliation. Credit purchase, Stripe, pricing administration, and product UI
remain outside scope.
