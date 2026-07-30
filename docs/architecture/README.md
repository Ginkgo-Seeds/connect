# Foundation architecture

Applications are composition roots. Packages expose contracts and remain
independent from runtime frameworks unless their boundary explicitly permits an
adapter dependency.

```mermaid
flowchart TB
  web["apps/web<br/>Next.js"]
  api["apps/api<br/>Fastify"]
  worker["apps/worker<br/>composition root"]

  ui["@connect/ui"]
  connectors["@connect/connectors"]
  llm["@connect/llm"]
  exports["@connect/exports"]
  boundary["@connect/boundary"]
  db["@connect/db"]
  core["@connect/core"]
  shared["@connect/shared"]

  postgres[("PostgreSQL<br/>official source of truth")]
  redis[("Redis<br/>ephemeral")]
  minio[("MinIO<br/>local object storage")]

  web --> ui
  api --> connectors
  api --> llm
  api --> exports
  worker --> core
  connectors --> boundary
  llm --> core
  exports --> boundary
  boundary --> core
  db --> core
  core --> shared

  api -. "future wiring" .-> postgres
  worker -. "future wiring" .-> redis
  api -. "future wiring" .-> minio
```

The dotted infrastructure links describe intended composition-root ownership;
Foundation 001 does not provide database, queue, object-storage, connector, or
LLM adapters.
