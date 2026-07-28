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

Local endpoints:

| Service    | Endpoint                 |
| ---------- | ------------------------ |
| PostgreSQL | `127.0.0.1:15432`        |
| Redis      | `127.0.0.1:16379`        |
| MinIO API  | `http://127.0.0.1:19000` |
| MinIO UI   | `http://127.0.0.1:19001` |

Health verification:

```bash
docker compose exec -T postgres pg_isready -U ginkgo_connect -d ginkgo_connect
docker compose exec -T redis sh -c 'redis-cli -a "$REDIS_PASSWORD" ping'
curl --fail http://127.0.0.1:19000/minio/health/live
```

Volumes are persistent. `docker compose down` stops services without deleting
data; adding `--volumes` deliberately deletes local data and is not part of the
normal local workflow.
