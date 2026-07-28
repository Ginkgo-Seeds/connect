# ADR 0003: PostgreSQL source of truth, outbox, and Redis ephemerality

- Status: Accepted
- Date: 2026-07-28
- Implementation: Infrastructure only; persistence model pending

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

## Consequences

Loss of Redis must not cause loss of business truth. Outbox schema, dispatch,
retry behavior, and idempotency records remain future work. Foundation 001 only
provides healthy local PostgreSQL and Redis containers and does not claim these
patterns are implemented.
