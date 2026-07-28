# AGENTS.md

## Scope

Ginkgo Connect is a dedicated monorepo. Do not copy donor repository code
without first adding a provenance entry to `docs/extraction-manifest.md`.

## Required boundaries

- `packages/core` must remain framework- and vendor-independent. It must not
  import Prisma, Fastify, BullMQ, LLM providers, connector SDKs, or access
  `process.env`.
- `packages/boundary` contains contracts and ports only. It must not depend on
  Prisma or concrete adapters.
- Applications are composition roots and own concrete runtime wiring.
- PostgreSQL is the future source of truth. Redis is ephemeral infrastructure.
- Decisions and evidence will be append-only when implemented.

## Foundation 001 exclusions

Do not add Prisma models, Power BI, Claude, OAuth, billing, BullMQ, n8n, product
screens, or donor domain code in this foundation slice.

## Verification

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before
committing. Infrastructure changes additionally require the Docker Compose
configuration and health gates documented in `docs/operations`.
