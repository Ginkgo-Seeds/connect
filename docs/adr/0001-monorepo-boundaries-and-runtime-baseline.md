# ADR 0001: Monorepo boundaries and runtime baseline

- Status: Accepted
- Date: 2026-07-28
- Implementation: Foundation baseline implemented; product adapters remain pending

## Context

Ginkgo Connect needs one repository with independently testable applications and
packages. Its kernel must not acquire dependencies on web frameworks, queues,
database clients, model providers, or connector SDKs.

The planned runtime is Node.js 24 LTS. TypeScript 7.0.2 exists, but the current
`typescript-eslint` 8.65.0 peer range is `>=4.8.4 <6.1.0`. Treating TypeScript 7
as a drop-in toolchain dependency would make lint support unsupported.

## Decision

- Use a pnpm 11 workspace orchestrated by Turborepo.
- Use ESM and strict TypeScript settings throughout the repository.
- Applications are composition roots and own runtime configuration and concrete
  adapter wiring.
- `core` remains framework- and vendor-independent and never reads
  `process.env`.
- `boundary` exposes contracts and ports and does not import Prisma.
- Enforce the dependency graph through package metadata checks, lint rules, and
  architecture tests.
- Use TypeScript 6.0.2 through the package alias
  `typescript: npm:@typescript/typescript6@6.0.2` until the lint and framework
  toolchain officially supports TypeScript 7.
- Invoke the aliased compiler through its published `tsc6` binary. The
  compatibility package intentionally does not publish a `tsc` binary, although
  it remains resolvable as `typescript` by tools that import the programmatic
  API.
- Pin the compatibility package's internal `@typescript/old` alias to
  `typescript@6.0.2`; its upstream `^6` range would otherwise resolve a
  different compiler patch than the approved baseline.

## Runtime and tool versions

- Node.js 24.14.0
- pnpm 11.17.0
- TypeScript 6.0.2 compatibility baseline
- ESLint 10.8.0 and typescript-eslint 8.65.0
- Next.js 16.2.12
- Vitest 4.1.10
- Prisma 7.9.1
- Turborepo 2.10.7

## Consequences

TypeScript 7 features are unavailable until the compatibility decision is
revisited. Lint and typecheck remain fully enabled. Foundation 002 subsequently
implemented Prisma persistence under the package boundaries established here;
that design is recorded in ADRs 0002–0005.

No planned version required substitution during initial scaffolding. The only
proven operational divergence was changing workspace compiler commands from
`tsc` to `tsc6`, as required by the exact TypeScript 6.0.2 compatibility package.
Lint and typecheck remain enabled.
