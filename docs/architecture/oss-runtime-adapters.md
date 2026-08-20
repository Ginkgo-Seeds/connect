# Governed OSS Runtime Adapter Pack v1

Status: FEATURE / architecture only  
Tracking: `Ginkgo-Seeds/ginkgo-connect#5`  
Date: 2026-08-20

## Objective

Define how Ginkgo Connect may integrate selected open-source agent, runtime and evaluation projects without turning them into caller-visible routing authority or a second Ginkgo architecture.

Candidates:

- Langflow;
- Dify;
- CrewAI;
- OpenHands;
- Agenta;
- Browser Use as a separate browser adapter track.

## Canonical ownership

```text
Caller chooses semantic CAPABILITY
-> Domain Router chooses eligible SKILL/BINDING/ADAPTER/PROVIDER
-> TaskOps/Executor Router chooses EXECUTOR
```

No Connect adapter may add caller fields that select:

- upstream project;
- provider/model;
- adapter;
- executor;
- workflow/graph ID;
- raw endpoint;
- credential/token/API key;
- raw cookie/session secret.

Connect translates Ginkgo semantic contracts into implementation-specific requests and normalizes implementation results back into Ginkgo contracts.

## Adapter envelope

Every adapter candidate must define:

```text
adapter_id
adapter_version
supported_bindings
provider/runtime identity
health/readiness
credential reference scheme
timeout/cancellation
input mapping
output mapping
normalized errors
evidence/provenance mapping
cost/usage telemetry
retry ownership
tenant/workspace isolation
upstream version pin
license decision
```

Raw credentials are never accepted from a public CapabilityRequest.

## Langflow track

Candidate role:

```text
ADAPTER_RUNTIME_CANDIDATE
```

Potential uses:

- dedicated/internal agent runtime;
- RAG/knowledge workflow implementation;
- prototyping provider-neutral Ginkgo skills.

Boundary:

- no public `langflow.*` business capability;
- component IDs, graph IDs and Langflow-specific configuration remain internal;
- Ginkgo contracts own semantic input/output;
- Domain Router remains responsible for implementation eligibility;
- retry/fallback policy remains Ginkgo-owned.

License posture: MIT upstream, still subject to dependency/model/provider terms.

## Dify track

Candidate role:

```text
CONDITIONAL_ADAPTER_RUNTIME_CANDIDATE
```

Potential uses:

- dedicated tenant agent/RAG deployments;
- operator surface where commercially cleared.

Mandatory gate:

- Dify's modified Apache 2.0 license adds restrictions, including multi-tenant and frontend-branding conditions;
- no shared Ginkgo SaaS deployment is authorized by this feature;
- commercial/legal clearance is required before any deployment pattern that crosses those restrictions.

Adapter behavior remains the same as any other provider: semantic Ginkgo input/output, normalized error/evidence mapping and no caller-selected Dify workflow authority.

## CrewAI track

Candidate role:

```text
EXECUTOR_RUNTIME_CANDIDATE
```

CrewAI is evaluated as an internal multi-agent execution implementation, not a second Domain Router or provider-selection authority.

Allowed candidate scope after validation:

- research/report execution;
- bounded multi-agent workflows;
- task decomposition under an already authorized TaskOps job.

Forbidden architectural authority:

- selecting Ginkgo providers independently of Domain Router policy;
- changing capability semantics;
- lifecycle promotion;
- bypassing Approval/External Gate;
- creating unbounded autonomous side effects.

License posture: MIT upstream, dependency/model terms separate.

## OpenHands track

Candidate role:

```text
ENGINEERING_EXECUTOR_CANDIDATE
```

Potential use:

- bounded repository/code tasks;
- maintenance/test/evaluation work for Agent Foundry.

Default hard stops:

- merge;
- mark Ready;
- release/tag;
- deploy;
- production data mutation;
- secrets/credential rotation;
- permission escalation;
- policy mutation;
- lifecycle promotion;
- force push/history rewrite.

The core/enterprise source boundary must be reviewed path-by-path before packaging or redistribution.

## Agenta track

Candidate role:

```text
EVAL_OBSERVABILITY_CANDIDATE
```

Potential use:

- optional Agent Foundry evaluation workspace/backend;
- trace/version/test-run persistence.

Ginkgo remains authoritative for:

- eval scenario semantics;
- evidence requirements;
- lifecycle gates;
- promotion decisions;
- canonical skill contracts.

Agenta success is implementation evidence, not lifecycle authority.

## Browser Use track

Candidate role:

```text
ADAPTER_PROVIDER_CANDIDATE
```

Target capability:

```text
browser.task.execute
```

Candidate mapping:

```text
BINDING   browser-use.browser.task.execute
ADAPTER   browser-use
PROVIDER  browser-use-runtime
```

This is distinct from `browser.session.execute` / Playwright.

Required adapter controls:

- explicit allowed origins;
- max steps and timeout;
- read-only vs side-effect intent;
- opaque session refs only;
- upload/download policy;
- action ledger;
- screenshot/DOM/evidence refs according to policy;
- normalized failure codes;
- approval/policy interlock before external mutation;
- no stealth/anti-bot bypass capability.

## Error normalization

Adapters must map implementation-specific failures into stable categories such as:

```text
AUTH_REQUIRED
PERMISSION_DENIED
INVALID_INPUT
POLICY_BLOCKED
EXTERNAL_GATE_BLOCKED
RATE_LIMITED
UPSTREAM_UNAVAILABLE
TIMEOUT
CANCELLED
RESOURCE_LIMIT
CONTRACT_MISMATCH
UNKNOWN_UPSTREAM_ERROR
```

Exact canonical error schema must be reused from ai-stack where applicable; this document does not create a second core error envelope.

## Retry and fallback

Adapter-local hidden retry must not change business semantics.

Rules:

- retry policy is explicit and bounded;
- side-effecting requests require idempotency strategy before retry;
- fallback defaults to `none`;
- no auto-fallback across Langflow/Dify/CrewAI/OpenHands/Browser Use;
- executor fallback is a TaskOps/Executor Router concern, not adapter policy;
- provider fallback is a Domain Router policy concern and only valid under frozen same-semantics rules.

## Credential boundary

```text
public request
-> credential reference resolved by governed runtime
-> adapter receives scoped secret material only at execution boundary
-> upstream
```

Forbidden:

- raw API keys in CapabilityRequest;
- credentials in logs/evidence;
- credentials committed to GitHub;
- cookies/tokens in browser caller payloads;
- adapters exposing another tenant's credentials/session.

## Evidence requirements

Each candidate needs an evidence packet containing:

1. immutable upstream pin;
2. license/path decision;
3. supported Ginkgo binding/capability mapping;
4. input/output contract tests;
5. negative/security tests;
6. credential redaction evidence;
7. timeout/cancellation behavior;
8. normalized error tests;
9. cost/usage telemetry behavior when applicable;
10. tenant/workspace isolation evidence where applicable;
11. governed local/read-only E2E before promotion.

## Lifecycle

Every candidate in this pack remains:

```text
lifecycle_status: FEATURE
routing_eligible: false
production_eligible: false
```

No adapter is implemented or enabled by this document.

## Non-goals

- no secrets;
- no live provider activation;
- no Dify shared multi-tenant deployment;
- no browser mutation;
- no autonomous engineering production writes;
- no automatic fallback;
- no P0 core contract changes;
- no provider/executor selection by caller.
