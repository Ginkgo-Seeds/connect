# Ginkgo Connect

Foundation for a governed, read-only integration platform.

> Status: Foundation 001. Product capabilities are intentionally not implemented yet.

## Repository layout

- `apps/api`: Fastify composition root and technical health endpoint.
- `apps/web`: static Next.js foundation page.
- `apps/worker`: worker composition root without a queue implementation.
- `packages/*`: framework-independent contracts and package boundaries.
- `infra/docker`: local PostgreSQL, Redis, and MinIO services.
- `docs`: architecture decisions, operations, and extraction provenance.

## Requirements

- Node.js 24.14.0
- pnpm 11.17.0
- Docker with Compose

## Foundation gates

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config
docker compose up -d --wait
docker compose ps
```

Copy `.env.example` to `.env` only when you need to customize local defaults. The
example values are development-only placeholders and must never be used in a
shared or production environment.

See [local development](docs/operations/local-development.md) for health
verification and service endpoints.
