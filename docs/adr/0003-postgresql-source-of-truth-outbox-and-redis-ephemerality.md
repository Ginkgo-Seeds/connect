# ADR 0003: PostgreSQL source of truth, outbox, and Redis ephemerality

- Status: Accepted
- Date: 2026-07-28
- Implementation: Foundation 002 persistence and transactional outbox

## Context

The platform needs durable business truth and asynchronous execution without
allowing cache or queue state to become authoritative.

## Decision

- PostgreSQL is the official source of truth for durable domain, evidence,
  approval, and financial records.
- Durable state changes and future integration events will use a transactional
  outbox.
- Redis is restricted to queues, locks, rate limits, and cache data that can be
  reconstructed or safely expired.
- Consumers will be idempotent and will not infer durable completion solely from
  Redis state.
- Task state, its TaskEvents, and one outbox message per event are committed in
  the same PostgreSQL transaction.
- Event sequence is allocated by CAS-incrementing `Task.eventSequence`; queries
  based on `MAX(sequence) + 1` are forbidden.
- Outbox tenant, event identity, topic, payload, schema version, and creation
  time are immutable. Only claim, retry scheduling, error, attempt count, and
  publication fields may change.
- Concurrent claims use `FOR UPDATE SKIP LOCKED`.

## Consequences

Loss of Redis cannot remove business truth. Foundation 002 implements the
outbox schema, database claim primitive, and command receipts. It intentionally
does not implement an outbox dispatcher, BullMQ integration, or consumer retry
policy.
