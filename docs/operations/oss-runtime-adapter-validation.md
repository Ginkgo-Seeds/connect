# OSS Runtime Adapter Validation Gates v1

Status: test/evidence design only  
Tracking: `Ginkgo-Seeds/ginkgo-connect#5`.

## Validation sequence

```text
static provenance/license review
-> adapter contract review
-> deterministic fixture tests
-> negative/security tests
-> local/dedicated prototype
-> governed read-only E2E
-> evidence packet
-> lifecycle review
```

No step implies automatic promotion.

## Common adapter gates

| Gate | Required evidence |
|---|---|
| Caller boundary | public request cannot choose provider/adapter/executor/upstream project |
| Secret boundary | raw secret rejected; scoped credential reference used at runtime boundary |
| Contract mapping | valid Ginkgo input maps to implementation request and normalized result |
| Error mapping | implementation errors map to stable Ginkgo error categories |
| Timeout | deadline enforced and normalized |
| Cancellation | cancellation produces deterministic normalized outcome where supported |
| Retry | bounded, observable and idempotency-aware |
| Evidence | upstream/run refs mapped without leaking secrets |
| Cost/usage | recorded when implementation exposes reliable usage data |
| Isolation | tenant/workspace/session boundaries tested where applicable |
| Pinning | exact upstream version/commit recorded |
| License | exact files/features used have a recorded decision |

## Langflow

Positive:

- health/readiness;
- one deterministic graph/fixture invoked behind a semantic Ginkgo binding;
- normalized result independent from graph/component IDs;
- evidence includes pinned runtime version.

Negative:

- caller tries to pass Langflow graph/component ID as routing authority;
- missing credential reference;
- malformed graph response;
- timeout;
- unavailable runtime.

Promotion blocker: no public `langflow.*` business capability.

## Dify

Before any runtime test:

- record exact license/version;
- classify deployment as dedicated vs shared/multi-tenant;
- record branding posture;
- block any shared source-based deployment path that lacks explicit commercial/legal clearance.

Runtime tests, if cleared for the selected deployment mode, follow the common adapter gates.

## CrewAI

Positive:

- execute a bounded fixture task supplied by TaskOps;
- normalized result/evidence returned;
- execution does not select or rewrite Ginkgo capability/provider routing.

Negative:

- task attempts to override Domain Router/provider policy;
- task attempts unbounded side effects;
- task requests lifecycle promotion;
- timeout/cancellation and bounded retry behavior.

## OpenHands

Positive:

- bounded test repository task in isolated fixture;
- generated diff/test evidence returned;
- no production write authority.

Hard-stop negative fixtures:

- merge;
- release/tag;
- deploy;
- secret rotation;
- permission escalation;
- policy mutation;
- force push;
- production data mutation.

Every hard stop must fail closed and be observable.

## Agenta

Positive:

- send a Ginkgo-defined eval run to an isolated test workspace;
- recover run/version/trace refs;
- preserve Ginkgo scenario identity and evidence semantics.

Negative:

- Agenta verdict attempts to auto-promote a skill;
- cross-workspace data access;
- secret leakage in trace metadata;
- missing/stale run result.

Agenta is evidence storage/observability only; lifecycle review remains external to the adapter.

## Browser Use

Target capability: `browser.task.execute`.

Positive fixture:

- local deterministic site;
- allowlisted origin;
- read-only goal;
- bounded max steps;
- action ledger + evidence refs;
- normalized result.

Negative fixtures:

- disallowed origin;
- raw cookie/token in caller payload;
- max-step exhaustion;
- timeout;
- form submit under read-only mode;
- external mutation without policy/approval interlock;
- request for stealth/anti-bot bypass;
- attempt to silently fallback to `browser.session.execute`.

## Evidence packet schema checklist

Each candidate evidence packet must contain:

- candidate ID;
- adapter version;
- upstream URL;
- immutable upstream pin;
- license decision ref;
- Ginkgo capability/binding refs;
- test run refs;
- positive scenario results;
- negative/security scenario results;
- secret scan/redaction result;
- cost/duration observations where applicable;
- known limitations;
- reviewer decision;
- lifecycle ceiling.

## Production gate

```text
FEATURE
-> PROTOTYPE
-> VALIDATED
-> INTEGRATED
-> PRODUCTION
```

Production eligibility requires a separate explicit promotion decision after integrated evidence. This file authorizes no runtime activation.
