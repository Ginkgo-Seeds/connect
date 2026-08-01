# Local development

## Runtime

- Node.js 24.14.0
- pnpm 11.17.0
- Docker with Compose

## Code gates

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Infrastructure

The Compose project uses development-only defaults when `.env` is absent.
Override them by copying `.env.example` to `.env`.

```bash
docker compose config
docker compose up -d --wait
docker compose ps
```

Foundation 002 database checks use PostgreSQL 17.6 through Testcontainers, so
Docker must be running before `pnpm test`.

PostgreSQL uses two deliberately separate roles:

- `ginkgo_admin` is the database owner and is used only by migrations and
  administrative local checks through `DATABASE_ADMIN_URL`.
- `ginkgo_app` is the runtime role used through `DATABASE_URL`. It has no
  `SUPERUSER`, `CREATEDB`, `CREATEROLE`, or `BYPASSRLS`, cannot alter the
  schema or disable triggers, and receives only `CONNECT`, schema `USAGE`, and
  table `SELECT`, `INSERT`, and `UPDATE`.

The Compose entrypoint creates `ginkgo_app` only when PostgreSQL initializes an
empty data directory. If a local volume predates this role split, back up any
needed data and deliberately recreate that volume before using Foundation 002;
entrypoint initialization scripts do not rerun against an existing volume.

Prisma schema and migration gates use the administrative URL:

```bash
pnpm --filter @connect/db prisma:validate
pnpm --filter @connect/db prisma:generate
pnpm --filter @connect/db prisma:migrate:deploy
```

Local endpoints:

| Service    | Endpoint                 |
| ---------- | ------------------------ |
| PostgreSQL | `127.0.0.1:15432`        |
| Redis      | `127.0.0.1:16379`        |
| MinIO API  | `http://127.0.0.1:19000` |
| MinIO UI   | `http://127.0.0.1:19001` |

Health verification:

```bash
docker compose exec -T postgres pg_isready -U ginkgo_admin -d ginkgo_connect
docker compose exec -T postgres psql -U ginkgo_admin -d ginkgo_connect -Atc \
  "SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = 'ginkgo_app'"
docker compose exec -T redis sh -c 'redis-cli -a "$REDIS_PASSWORD" ping'
curl --fail http://127.0.0.1:19000/minio/health/live
```

Volumes are persistent. `docker compose down` stops services without deleting
data; adding `--volumes` deliberately deletes local data and is not part of the
normal local workflow.
