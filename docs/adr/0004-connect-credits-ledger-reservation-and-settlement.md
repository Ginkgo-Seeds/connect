# ADR 0004: Connect Credits ledger, reservation, and settlement

- Status: Accepted
- Date: 2026-07-28
- Implementation: Pending

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

## Consequences

Future design must define precision, pricing versions, overdraft policy,
expiration, reconciliation, and failure recovery. Foundation 001 implements no
billing tables, balances, pricing logic, reservation service, or settlement
service.
