# Extraction manifest

This document records donor baselines and the provenance of every donor artifact
introduced into Ginkgo Connect.

## Donor baselines

| Repository                 | Source commit                              | Access    |
| -------------------------- | ------------------------------------------ | --------- |
| `ginkgoai/ginkgo-tree`     | `194061c600b5f5779008bbc644c2193475ee8164` | Read-only |
| `ginkgoai/ginkgo-platform` | `9b5db872e9d4583018dea74671f6f3304cfccfa2` | Read-only |
| `ginkgoai/ai-stack`        | `f4540ca91c72e86606867cb88faf776e565bd141` | Read-only |

## Imported artifacts

Every imported artifact must use the following fields:

| repository | sourceCommit | sourcePath | destinationPath | treatment | reason | verification |
| ---------- | ------------ | ---------- | --------------- | --------- | ------ | ------------ |

Valid future values for `treatment` are `copied`, `adapted`, and `rewritten`.

## Foundation 002

| repository             | sourceCommit                               | sourcePath                            | destinationPath                       | treatment   | reason                                                                                                                                                | verification                                                                |
| ---------------------- | ------------------------------------------ | ------------------------------------- | ------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `ginkgoai/ginkgo-tree` | `194061c600b5f5779008bbc644c2193475ee8164` | `packages/core/src/states.ts`         | `packages/core/src/states.ts`         | `adapted`   | Preserve the canonical risk/maturity vocabulary and explicit transition-table approach while restricting the lifecycle to Foundation 002 states.      | Unit transition matrix and terminal-state tests.                            |
| `ginkgoai/ginkgo-tree` | `194061c600b5f5779008bbc644c2193475ee8164` | `packages/core/src/kernel.ts`         | `packages/core/src/decision.ts`       | `adapted`   | Preserve deterministic discovery/filter/rank/freeze semantics with locale-independent ordering and immutable snapshots.                               | Catalog permutation, tie-break, policy filter, and capability-gap tests.    |
| `ginkgoai/ginkgo-tree` | `194061c600b5f5779008bbc644c2193475ee8164` | `packages/core/src/contracts.ts`      | `packages/core/src/domain.ts`         | `rewritten` | Retain only domain concepts; remove client-authoritative organization input, Zod coupling, mutable arrays, and incomplete frozen-decision fields.     | Typecheck plus decision/approval unit tests.                                |
| `ginkgoai/ginkgo-tree` | `194061c600b5f5779008bbc644c2193475ee8164` | `packages/core/src/ports.ts`          | `packages/core/src/ports.ts`          | `rewritten` | Replace chatty persistence calls with transaction-shaped commands, explicit trusted tenant context, bigint credits, and stable execution identity.    | Architecture tests, store contract tests, and PostgreSQL transaction tests. |
| `ginkgoai/ginkgo-tree` | `194061c600b5f5779008bbc644c2193475ee8164` | `packages/core/src/runner.ts`         | `packages/core/src/runner.ts`         | `rewritten` | Resume must load the persisted decision; external calls must occur outside database transactions; failures and finance require atomic store commands. | Runner unit tests and worker/PostgreSQL integration flow.                   |
| `ginkgoai/ginkgo-tree` | `194061c600b5f5779008bbc644c2193475ee8164` | `packages/db/src/store.ts`            | `packages/db/src/kernel-store.ts`     | `rewritten` | Add CAS, atomic event/outbox sequencing, one logical execution attempt, immutable approvals, and idempotent credit operations.                        | Real PostgreSQL lifecycle, idempotency, and concurrency tests.              |
| `ginkgoai/ginkgo-tree` | `194061c600b5f5779008bbc644c2193475ee8164` | `packages/db/prisma/schema.prisma`    | `packages/db/prisma/schema.prisma`    | `rewritten` | Extract only the kernel persistence concepts and add FrozenDecision, approval, outbox, append-only enforcement, tenant-safe FKs, and integer credits. | Prisma validation, baseline deployment, SQL constraint/trigger tests.       |
| `ginkgoai/ginkgo-tree` | `194061c600b5f5779008bbc644c2193475ee8164` | `packages/db/src/evidence-binding.ts` | `packages/core/src/evidence.ts`       | `adapted`   | Move the deterministic matcher into the pure domain and fail closed without legacy evidence fallback.                                                 | Evidence type, strength, producer, purpose, and hash tests.                 |
| `ginkgoai/ginkgo-tree` | `194061c600b5f5779008bbc644c2193475ee8164` | `test/kernel-flow.test.ts`            | `packages/core/test/runner.test.ts`   | `adapted`   | Retain determinism, gated execution, replay, evidence, and budget scenarios under the new transactional contracts.                                    | Vitest unit suite and PostgreSQL composition-root suite.                    |
| `ginkgoai/ginkgo-tree` | `194061c600b5f5779008bbc644c2193475ee8164` | `test/evidence-binding.test.ts`       | `packages/core/test/evidence.test.ts` | `adapted`   | Preserve the fail-closed evidence cases while separating approval attestations from effect evidence.                                                  | Vitest evidence suite.                                                      |

The reviewed token engine and CRM task artifacts from
`ginkgoai/ginkgo-platform@9b5db872e9d4583018dea74671f6f3304cfccfa2`
were discarded as implementation sources: they accept tenant authority at the
request boundary, use unsafe JavaScript numeric representations, and include
Supabase, RLS, n8n, Stripe, CRM, and product-domain concerns excluded from this
foundation.
