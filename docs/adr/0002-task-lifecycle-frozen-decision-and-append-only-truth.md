# ADR 0002: Task lifecycle, frozen decisions, and append-only truth

- Status: Accepted
- Date: 2026-07-28
- Implementation: Pending

## Context

Governed execution requires an auditable distinction between mutable planning
and an approved decision that is ready for execution. Rewriting historical
evidence would make reviews, recovery, and financial reconciliation unreliable.

## Decision

- Task lifecycle transitions will be explicit, validated, and recorded.
- A frozen decision is immutable. Corrections create a new decision or event
  linked to the superseded record.
- Evidence, approvals, execution attempts, and lifecycle transitions are
  append-only facts.
- Derived views may be rebuilt from those facts but cannot replace them as the
  authoritative history.
- Human approval will be represented as explicit evidence rather than inferred
  from an execution outcome.

## Consequences

Future persistence and APIs must support idempotency, causal links, and
historical reconstruction. Foundation 001 provides no task state machine,
evidence store, approval flow, or execution engine; it records only the approved
design constraint.
