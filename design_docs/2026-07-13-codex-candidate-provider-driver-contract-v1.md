# Codex candidate / provider / driver contract v1

Status: **implemented read-only candidate; live production/promotion remains separately gated**
Contract id: `ccm/codex-candidate-provider-driver/v1`
Planned CLI endpoint: `ccm provider inspect codex --request @<file> --json`
Fixture contract: `ccm/codex-candidate-provider-driver-fixture/v1`

This document freezes the Codex-specific qualification and read-only headless execution boundary
needed by the cross-harness routing model. `ccm provider inspect codex` now compiles a real
read-only CLI invocation through the provider-runtime port and the opt-in suite proves that same
router seam against a controlled binary. Passing fixtures still does not authorize a paid canary,
route promotion, or a real model request outside an explicit operator invocation.

The RED harness is deliberately black-box at the handler boundary. Production-visible inputs are
limited to the request, isolated standard home roots, a real-shaped registry snapshot, deterministic
clock/cancel test seams, and a narrow `ccm/provider-runtime-capabilities/v1` port that resolves and
spawns only the selected provider executable. The handler never receives a fixture catalog path,
scenario id, expected result, trace path, or per-run proof nonce. Each fake executable embeds a fresh
nonce at materialization time; the nonce enters the handler only through correlated app-server
replies, the JSONL execution channel, and the structured result. A fixture lookup plus superficial
process spawns therefore cannot satisfy the runtime proof.

Normative words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are used as requirements.

## 1. Scope and ownership

The endpoint performs one read-only inspection transaction:

1. collect installed-binary and behavioral-capability evidence;
2. collect read-only auth, entitlement, model-catalog, and quota evidence;
3. qualify one explicit Codex model and reasoning effort;
4. when qualification passes, compile and execute one read-only `codex exec` attempt;
5. parse the JSONL stream and structured final output;
6. return a normalized, provenance-bearing result.

The provider adapter owns Codex flags, probe protocol, stream parsing, model resolution, and
provider error normalization. The supervisor owns process lifetime, timeout/cancellation signals,
retry policy, journals, and board transitions. Neither this endpoint nor its adapter writes a board.
`route-bind` remains a claim-binding operation, not a provider spawn handle.

Out of scope for v1:

- credential-file access, a paid canary, or an unapproved real model request;
- login, logout, account switching, token refresh initiated by `ccm`, auth-file writes, or other
  credential mutation;
- automatic account switching on Codex or Cursor;
- board narrow-waist or routing-contract schema changes;
- changing the existing Codex seven-day hard-ceiling authority or threshold;
- treating this contract, a fixture, a version string, or a registry row as current capability.

## 2. Version and compatibility rules

Every request, evidence record, fixture, and result carries an exact schema id. A v1 reader MUST
reject an unknown major version. Additive optional fields are permitted; changing a field's meaning,
freshness rule, eligibility role, or failure class requires a new major contract id.

The following identifiers are distinct and MUST NOT be substituted for one another:

- binary version: informational provenance only;
- behavioral capability probe: proof that required flags, JSONL events, and structured output work;
- model registry version: static policy provenance;
- live model-catalog snapshot: current entitlement evidence;
- requested model/effort: the route's explicit intent;
- resolved model/effort: exact catalog entry selected before invocation;
- actual model/effort: provider-emitted execution evidence, when a verified channel exists.

A version match is never a capability pass. A registry match is never entitlement or execution
proof.

## 3. Request contract

The endpoint accepts one JSON request:

```json
{
  "schema": "ccm/codex-provider-inspect-request/v1",
  "request_id": "opaque-idempotency-and-correlation-id",
  "provider": "codex",
  "model": "explicit-catalog-id",
  "effort": "explicit-supported-reasoning-effort",
  "workspace": "/absolute/readable/worktree",
  "prompt": "read-only inspection prompt",
  "output_schema": { "type": "object" },
  "permission": {
    "sandbox": "read-only",
    "approval": "never",
    "network": "provider-only",
    "account_mutation": "forbidden",
    "credential_write": "forbidden"
  },
  "timeouts_ms": { "startup": 10000, "idle": 30000, "hard": 120000 }
}
```

Required validation:

- `provider` is exactly `codex`.
- `request_id`, `workspace`, `model`, `effort`, `prompt`, and `output_schema` are explicit.
- `workspace` is an absolute path and is passed as an argv element, never shell-interpolated.
- `model:auto`, an empty model, omitted effort, or effort `auto` is `model_auto_forbidden`.
- all five permission values above are fixed; a request for broader authority is
  `permission_blocked` or `account_mutation_forbidden` before any Codex process starts.
- timeouts are positive, bounded values. The fixture runner MAY inject a deterministic clock and
  abort signal; those controls are test-only and are not provider authority.

The request is immutable once qualification begins. The normalized result repeats the requested,
resolved, and actual identities separately.

## 4. Candidate evidence

### 4.1 Common evidence envelope

Every load-bearing observation uses this envelope:

```json
{
  "evidence_id": "opaque",
  "kind": "binary-capability|auth|entitlement|model-catalog|quota|execution",
  "source": {
    "provider": "codex",
    "surface": "cli-headless|app-server",
    "method": "exact probe or event name",
    "revision": "exact source payload/schema revision",
    "binary_realpath": "/absolute/path/to/codex",
    "binary_version": "informational-only",
    "schema_version": "provider payload version or null"
  },
  "observed_at": "RFC3339",
  "valid_until": "RFC3339 or null",
  "freshness": "fresh|soft-stale|hard-stale|unknown",
  "completeness": "complete|partial|unknown",
  "payload_sha256": "hex digest of redacted canonical payload",
  "redactions": ["credential", "token", "email"],
  "errors": []
}
```

`valid_until` MUST come from provider reset/expiry facts or an explicit adapter TTL policy. It MUST
NOT be inferred from the CLI version. A missing timestamp, contradictory clock, partial required
payload, or failed parse cannot become fresh evidence. Raw secret-bearing payloads are never stored;
only bounded redacted excerpts and digests may be retained.

Canonical provenance is not a presence check. V1 canonical JSON is UTF-8 JSON with object keys
sorted lexicographically at every depth, arrays kept in source order, no insignificant whitespace,
and ordinary JSON number/string/null encoding. Every evidence reference follows:

```text
payload_sha256 = sha256(canonical(redacted exact source payload))
evidence_id = "ev-" + sha256(canonical({
  schema: "ccm/provider-evidence-reference/v1",
  source_method: source.method,
  source_revision: source.revision,
  payload_sha256
}))
```

`source.revision` is mandatory and comes from the provider payload/schema revision, registry
`version`, request schema, or verified execution-event schema. It is not the adapter build version.
Changing any payload byte, method, or revision changes the reference. An arbitrary non-empty id or
an id reassigned across facets is invalid.

Auth, live model catalog, quota, and registry have independent envelopes, timestamps, TTLs,
freshness, completeness, payload digests, and evidence ids. Implementations MUST NOT reuse the
freshness or evidence id of one facet for another. A fresh auth read does not refresh the model
catalog, quota, or registry; a fresh registry does not refresh provider evidence.

### 4.2 Installed binary and behavioral capability

`installed:true` requires successful path resolution to an executable regular file plus a realpath.
It does not imply auth, entitlement, quota, or driver support.

The adapter MUST behaviorally prove the v1 surface it will use. At minimum:

- noninteractive `exec` exists;
- `--json`, `--output-schema`, `--output-last-message`, `--model`, `--sandbox read-only`,
  `--ask-for-approval never`, `--ephemeral`, and `--cd`/`-C` are accepted as required by the
  compiler;
- JSONL emits identifiable thread, turn, item, terminal, and top-level error shapes;
- structured final output is separable from progress output;
- the selected app-server methods for account, model, and rate-limit reads exist.

Help text MAY seed a probe but cannot be the only proof. The fixture `CXD-016` pins the failure mode
where a plausible version string exists but the behavioral probe is missing.

### 4.3 Authentication and account identity

The read-only auth snapshot distinguishes:

- `authenticated`: a non-mutating account read proves a usable session;
- `unauthenticated`: provider explicitly reports no account;
- `expired`: provider explicitly reports expired auth;
- `unknown`: probe absent, malformed, contradictory, or stale.

Opaque `credential_id` and `account_id` fingerprints may correlate evidence. Tokens, refresh tokens,
cookies, email addresses, and raw credential files MUST NOT enter results, fixtures, logs, or board
state. `unknown`, `expired`, and `unauthenticated` are automatically ineligible.

The adapter MUST NOT invoke `login`, `logout`, `switch`, device-auth, refresh, or any auth-writing
command. It MUST NOT write the Codex credential store. If a fresh non-mutating session cannot run
without credential mutation, the candidate fails closed as `credential_write_required`.

### 4.4 Entitlement and model registry

The model snapshot is collected from a live, read-only catalog method and preserves for each entry:

- provider catalog id and display model;
- hidden/default metadata without treating either as entitlement by itself;
- `supportedReasoningEfforts` and `defaultReasoningEffort`;
- model-provider/account scope;
- observation and freshness envelope.

The repository registry is a versioned allowlist/generator input, not live proof. Its snapshot has
its own schema/version/source, `observed_at`, `valid_until`, freshness, completeness, canonical
payload digest, and evidence id. `unknown` or `hard-stale` registry evidence fails closed even when
the requested row happens to be present. Automatic qualification requires the exact intersection:

```text
explicit request
  ∩ versioned registry allowlist
  ∩ fresh live account entitlement
  ∩ behaviorally supported CLI surface
```

The requested model MUST be a concrete catalog id. Resolution is exact in v1: requested model equals
resolved model, and requested effort equals resolved effort. Alias expansion, default model choice,
default reasoning effort, and `auto` are forbidden. Missing/duplicate catalog rows, unsupported
effort, entitlement ambiguity, or any requested/resolved difference is fail-closed.

### 4.5 Multi-bucket quota

The adapter consumes the app-server multi-bucket map when present and also preserves the legacy
single bucket as a separately sourced compatibility observation. It MUST NOT collapse, average, or
join incomparable buckets.

Each normalized bucket preserves one source row and one window. A provider row with primary and
secondary windows therefore produces two normalized buckets; the multi-bucket map and the legacy
single-bucket compatibility view remain separate sources even if they describe the same account.
Each normalized bucket preserves:

```json
{
  "bucket_id": "stable adapter id",
  "provider_limit_id": "limit_id or legacy-single",
  "limit_name": "provider label or null",
  "credential_id": "opaque",
  "account_id": "opaque",
  "payer_id": "opaque or unknown",
  "pool_id": "opaque or unknown",
  "shared_scope": "account|organization|project|unknown",
  "unit": "percent_used|credits|unknown",
  "window": {
    "duration_minutes": 10080,
    "used_percent": 42,
    "resets_at": "RFC3339 or null"
  },
  "rate_limit_reached_type": null,
  "observed_at": "RFC3339",
  "valid_until": "RFC3339 or null",
  "freshness": "fresh|soft-stale|hard-stale|unknown",
  "source_method": "account/rateLimits/read",
  "source_schema": "rateLimitsByLimitId|legacy-rateLimits",
  "source_evidence_id": "ev-...",
  "source_payload_sha256": "hex",
  "source_revision": "provider rate-limit revision",
  "source_path": "/rateLimitsByLimitId/codex/secondary"
}
```

`source_path` is an RFC 6901 JSON Pointer to the exact row/window in the digested response. The
stable id is:

```text
bucket_id = "bucket-" + sha256(canonical({
  schema: "ccm/codex-quota-bucket-reference/v1",
  source_evidence_id,
  source_revision,
  source_path
}))
```

Every other bucket value is a deterministic projection of that source row/window. Opaque identity,
scope, unit, label, usage, reset, timestamps, and freshness are deep-compared to the raw response;
non-empty substitutions and cross-bucket swaps are provenance failures.

Provider credits and reset-credit fields are preserved as distinct evidence, never converted into
window percent without a declared unit conversion. Unknown bucket identity, scope, unit, or window
remains unknown.

#### Codex pacing law

For `provider=codex`:

1. Any historical or unexpected five-hour field is retained only as ignored provenance. It MUST NOT
   affect eligibility, routing posture, pacing, fallback, reset/refill advice, or wakeup scheduling.
2. The existing seven-day window is the only percentage-based hard ceiling. Its authority and
   threshold are unchanged by this contract.
3. A provider-declared active hard rejection may normalize as provider unavailability, but no other
   bucket receives an invented percentage ceiling.
4. Automatic eligibility requires fresh, complete seven-day admission evidence with status
   `ample`. `unknown`, `tight`, `hard-stale`, or exhausted is ineligible. No fallback converts it to
   eligible.
5. Rolling 24-hour burn is advisory only. It compares timestamped seven-day usage snapshots against
   `100 / 7` percentage points per day and reports delta, elapsed interval, daily budget, ratio,
   coverage, source, and confidence. It never becomes a hard gate.
6. Insufficient history, reset crossing, contradictions, hard-stale endpoints, or an interval too
   short for the declared policy yields `unavailable` or low confidence, never false precision.

An available rolling-24h advisory has this complete additive shape:

```json
{
  "status": "available",
  "advisory_only": true,
  "delta_percent_points": 8,
  "elapsed_hours": 24,
  "daily_budget_percent_points": 14.285714285714286,
  "burn_ratio": 0.56,
  "coverage": 1,
  "source_evidence_ids": ["quota-evidence-id"],
  "source_payload_sha256": "hex",
  "source_revision": "provider rate-limit revision",
  "derivation_sha256": "hex",
  "confidence": "high"
}
```

`burn_ratio` is the interval's dailyized percentage-point burn divided by `100 / 7`. Each numeric
field becomes `null` when unavailable (including `coverage`), confidence becomes `unavailable`, and
the implementation does not retain a previous number behind an unavailable status. Source ids must
resolve exactly to the quota/history evidence whose digest and revision are repeated alongside the
calculation. `derivation_sha256` hashes the algorithm id, complete source reference, ordered raw
history, and complete output excluding only the digest itself. A stale number, wrong evidence id,
wrong revision, or changed numeric output cannot remain coherent. An above-budget ratio never
changes `admission_7d`, a predicate, eligibility, fallback, or wakeup scheduling.

`quota-tight` in this contract means the current seven-day hard-ceiling policy is tight; it does not
mean the rolling 24-hour advisory is above budget. The two signals MUST use different fields.

## 5. Eligibility decision

The candidate response contains one result for every predicate; absent predicates are failures, not
implicit passes:

- `binary-available`
- `behavioral-capability-proven`
- `auth-fresh`
- `entitlement-fresh`
- `registry-allowed`
- `model-exact`
- `effort-exact`
- `quota-7d-ample`
- `permission-read-only`
- `approval-never`
- `account-mutation-forbidden`
- `credential-write-forbidden`

`automatic_eligible:true` requires all predicates to pass on fresh evidence. `unknown`, `partial`,
`tight`, or `hard-stale` on a load-bearing predicate fails closed. An advisory rolling-24h overrun is
reported but does not change the boolean.

The decision includes deterministic reason codes and evidence ids. It never includes raw auth or a
claim that a model request occurred.

Each predicate is explicit and has the stable shape
`{id, passed, reason_code, evidence_ids}`. The list contains all twelve predicate ids on every
normalized inspection result, including early request/policy rejection. `evidence_ids` may be empty
only when the corresponding probe was mechanically not attempted; it is never an implicit pass.

## 6. Read-only invocation compiler

Only an eligible candidate may compile an invocation. The compiler emits an argv array and an
allowlisted child environment; it MUST NOT construct a shell command string.

The provider handler receives process authority only through the injected
`ccm/provider-runtime-capabilities/v1` port:

```text
process.resolveExecutable(provider) -> absolute path | null
process.spawnProvider({executable, argv, cwd, env, stdio}) -> child handle
network.request(operation) -> denied/observable (zero calls are permitted in v1)
```

It MUST NOT import or invoke `child_process`, workers/cluster, raw socket, DNS, HTTP(S), TLS,
datagram, `fetch`, WebSocket, shell, or an alternate executable path directly. The process port
accepts only the path returned for `codex`; every probe and execution spawn is recorded. Provider
traffic belongs to the controlled Codex child, not the host handler.

The semantic argv is:

```text
<absolute-codex-binary>
exec
-
--json
--output-schema <absolute-run-owned-schema-file>
--output-last-message <absolute-run-owned-result-file>
--model <resolved-model>
-c model_reasoning_effort=<resolved-effort>
--sandbox read-only
--ask-for-approval never
--ephemeral
-C <absolute-workspace>
```

Equivalent flag ordering or documented long/short spellings are allowed only when the behavioral
probe proves them. The compiled record MUST preserve the exact argv, redacted env-key allowlist,
stdin digest, cwd, permission profile, requested/resolved identities, and compiler version.

For the portable v1 fixture every provider-child spawn receives exactly these environment keys and
no others: `CODEX_HOME`, `HOME`, `NO_COLOR`, `PATH`, `TMPDIR`. A platform adapter may define a
different audited exact set in a later contract revision, but wildcards and parent-env spreading are
forbidden. Credential, harness-token, proxy, socket, shell-init, tool-config, and arbitrary unknown
variables never survive compilation. The test injects named and randomized unknown canaries; the
runtime port deep-compares both keys and the compiler-selected root/path values, and the controlled
child independently rejects any extra or missing key. Secrets cannot be smuggled through an allowed
key with a substituted value.

Forbidden compilation or fallback behavior:

- shell interpolation, TUI mode, resume/fork, workspace-write/danger-full-access, approval prompts,
  implicit model/default effort, config persistence, or user config mutation;
- `codex login`, `codex logout`, account switching, auth-store repair, or credential copying;
- automatic retry with a different model/effort/account;
- converting a candidate rejection into a provider call.

Run-owned output/schema files live outside credential roots. Credential roots are read-only to the
child for this contract. The fixture runner records every spawn and credential-sentinel digest.

## 7. Parser and identity reconciliation

The JSONL parser is incremental and bounded. It MUST:

- reject malformed JSON lines rather than skip them;
- preserve unknown event/item types as redacted evidence while refusing to use them for a required
  predicate;
- require a valid thread start and turn lifecycle;
- accept exactly one terminal outcome and reject missing or duplicate terminals;
- give a top-level provider error precedence over an apparent successful final message;
- validate the final message against the requested output schema;
- distinguish provider terminal state from task acceptance;
- retain stderr only as a bounded, redacted diagnostic.

Identity reconciliation has three immutable fields:

```json
{
  "requested": { "model": "...", "effort": "...", "evidence_id": "..." },
  "resolved": { "model": "...", "effort": "...", "evidence_id": "..." },
  "actual": { "model": "...", "effort": "...", "evidence_id": "..." }
}
```

Requested evidence uses method `ccm-provider-inspect/request`, the request schema revision, and the
immutable canonical request digest. Resolved evidence uses method
`ccm-provider-model-resolution/intersection`, revision
`ccm/codex-model-resolution-intersection/v1`, and a canonical payload containing the requested and
resolved pairs plus catalog and registry evidence ids, digests, and revisions. Actual evidence uses
the verified event method, event schema revision, and canonical event digest. All three ids follow
§4.1, are distinct, and resolve to retained evidence. V1 success requires exact equality across all
three pairs. The actual pair MUST come from a
behaviorally verified provider execution channel; it cannot be copied from argv, the request,
registry, output text, or adapter assumptions. If the installed CLI does not expose a verified
actual-model/effort channel, the result is `actual_model_missing`, and live promotion remains
blocked. The current official `codex exec --json` documentation does not by itself establish such a
field; the fixture event that exercises reconciliation is synthetic evidence, not a current-product
claim.

Partial actual evidence remains visible rather than collapsed. A verified execution event with a
model but no effort returns `actual: {model, effort:null, evidence_id}` and
`actual_effort_missing`; no verified identity event returns `actual:null` and
`actual_model_missing`.

Any mismatch is `model_mismatch` or `effort_mismatch` and is never normalized as success, even if the
structured final output is otherwise valid.

## 8. Normalized result

The CLI uses the existing `{ok:true,data}` JSON envelope when inspection itself completed, including
normalized candidate or provider rejection. Usage/contract errors use the existing CLI error
envelope and nonzero exit code.

`data` has this additive v1 shape:

```json
{
  "schema": "ccm/codex-provider-inspection/v1",
  "contract": "ccm/codex-candidate-provider-driver/v1",
  "request_id": "opaque",
  "provider": "codex",
  "candidate": {
    "automatic_eligible": false,
    "predicates": [],
    "reason_codes": []
  },
  "identity": {
    "requested": { "model": "...", "effort": "...", "evidence_id": "..." },
    "resolved": null,
    "actual": null
  },
  "quota": {
    "admission_7d": "ample|tight|exhausted|unknown|hard-stale",
    "five_hour_effect": "ignored",
    "rolling_24h": {
      "status": "available|unavailable",
      "advisory_only": true,
      "delta_percent_points": 8,
      "elapsed_hours": 24,
      "daily_budget_percent_points": 14.285714285714286,
      "burn_ratio": 0.56,
      "coverage": 1,
      "source_evidence_ids": ["..."],
      "source_payload_sha256": "hex",
      "source_revision": "provider rate-limit revision",
      "derivation_sha256": "hex",
      "confidence": "high|low|unavailable"
    },
    "buckets": []
  },
  "execution": {
    "attempted": false,
    "invocation_compiled": false,
    "parser_exercised": false,
    "terminal_count": 0,
    "timeout_phase": null,
    "cancel_observed": false
  },
  "result": { "status": "rejected|succeeded|failed|timed_out|cancelled", "output": null },
  "error": { "code": "quota_unknown", "retry": "refresh_evidence", "message": "redacted" },
  "evidence": [],
  "side_effects": {
    "board_writes": 0,
    "account_mutations": 0,
    "credential_writes": 0,
    "remote_mutations": 0
  }
}
```

For eligible execution paths, `invocation_compiled` and `parser_exercised` MUST reflect actual code
paths, not fixture declarations. The runtime proof fixture additionally requires spawn evidence from
the controlled binary. A registry-only implementation, schema validator, or parser invoked directly
cannot satisfy the opt-in suite.

## 9. Error taxonomy

| Code | Layer | Automatic eligibility / normalized status | Retry class |
| --- | --- | --- | --- |
| `binary_unavailable` | candidate | ineligible / rejected | after install or path refresh |
| `binary_capability_unproven` | candidate | ineligible / rejected | after behavioral probe |
| `auth_required` / `auth_expired` / `auth_unknown` | candidate | ineligible / rejected | explicit user auth or fresh read |
| `entitlement_unknown` / `model_unavailable` | candidate | ineligible / rejected | fresh catalog only |
| `registry_unknown` / `registry_hard_stale` | candidate | ineligible / rejected | fresh registry snapshot only |
| `model_auto_forbidden` | request | rejected | change request |
| `model_mismatch` / `effort_mismatch` | reconcile | failed | never silently retry another identity |
| `quota_unknown` / `quota_tight` / `quota_hard_stale` | candidate | ineligible / rejected | fresh quota evidence |
| `quota_7d_exhausted` | candidate | ineligible / rejected | seven-day reset/policy |
| `permission_blocked` | compiler | rejected | change authorized permission contract |
| `account_mutation_forbidden` / `credential_write_required` | policy | rejected | user action outside this endpoint |
| `structured_output_malformed` | parser | failed | policy-controlled new attempt only |
| `stream_malformed` / `terminal_missing` / `terminal_duplicate` | parser | failed | policy-controlled new attempt only |
| `actual_model_missing` | reconcile | failed | capability upgrade/probe, not assumption |
| `actual_effort_missing` | reconcile | failed | capability upgrade/probe, not assumption |
| `startup_timeout` / `idle_timeout` / `hard_timeout` | supervisor/driver | timed_out | mechanical policy only |
| `cancelled` | supervisor/driver | cancelled | never auto-resume |
| `provider_rate_limited` | provider | failed | provider reset/fresh quota |
| `transport_error` / `provider_failed` | provider | failed | mechanical policy only |
| `task_blocked` | result | failed | never automatic fallback |

Unknown error codes are `provider_failed` plus preserved redacted provenance; they never become
success or automatic eligibility.

## 10. Fixture and promotion gates

The fixture catalog is
`ccm/apps/cli/test/fixtures/codex-candidate-provider-driver-v1/scenarios.json`. It is test-owned
expected data and is never passed to the endpoint. It covers:

- binary absent and version-only-without-capability;
- auth unknown/hard-stale, live catalog missing/hard-stale, and registry unknown/hard-stale as
  independently varied evidence;
- `model:auto` rejection;
- multi-bucket quota unknown, tight, hard-stale, seven-day exhausted, and five-hour ignored;
- requested/resolved/actual model mismatch, actual effort mismatch, and partial/missing actual
  identity evidence;
- malformed JSONL and malformed structured output;
- timeout and cancellation;
- missing actual model evidence;
- requested account mutation and credential immutability.

Default tests validate only the frozen fixture/contract invariants and MUST be green. They also run
two anti-counterfeit calibrations: a mutation matrix proves independently corrupted-but-nonempty
bucket identity/usage/reset/revision, rolling value/reference, and requested/resolved binding cannot
pass the same seam oracle; an independently enumerated authority calibration dynamically loads a
test-owned counterfeit provider only after the host guard is installed, then directly invokes every
guarded net/socket, DNS, HTTP, HTTPS, TLS, datagram, fetch, WebSocket, child-process
spawn/exec/fork, Worker, and cluster entry point. Every call MUST throw synchronously with its exact
`{authority, api}` record. The counterfeit arguments fail in native pre-I/O validation (and cluster
uses a local enumeration tripwire), so deleting any corresponding guard makes the default test RED
without reaching a network or starting a process. A platform without a native global WebSocket gets
an explicitly audited deny stub rather than skipped coverage. The RED suite is enabled only with
`CCM_CODEX_PROVIDER_CONTRACT_RED=1`. Every RED case calls the implemented CLI endpoint through
`router.run`; eligible execution cases additionally require independently captured requests,
responses, JSONL/result digests, process signals, and spawn records from the fake Codex binary.

The RED runner snapshots complete protected trees before and after the endpoint: workspace,
`CC_MASTER_HOME` (including board and registry sentinels), Codex auth/config, both Cursor config and
agent roots, Claude config, and neutral `HOME`. It checks the parent environment and installs
fail-loud external-tool shims as secondary evidence. The load-bearing process/network proof is the
injected runtime port plus a host guard installed before the router/provider module loads: standard
Node socket/DNS/HTTP/TLS/datagram/fetch/WebSocket and process/worker/cluster entry points are denied
and recorded, while only `spawnProvider` retains the captured ability to start the controlled Codex
binary. Every actual child env is exact-set checked. This closes ordinary direct/absolute-process
and direct-network escape classes without claiming resistance to hostile native addons or Node
internal bindings; those are forbidden dependencies outside the TypeScript provider-module trust
boundary. Endpoint `side_effects.*` remains telemetry, not proof. The prior missing-runtime RED
(`unknown command: provider`) is retired; a regression to it is a contract failure.

The two non-production controls are `CCM_CODEX_PROVIDER_NOW` (deterministic clock) and
`CCM_CODEX_PROVIDER_TEST_CANCEL_AFTER_MS` (fixture abort injection); the registry seam is a
real-shaped read-only snapshot named by `CCM_CODEX_MODEL_REGISTRY_PATH`. None may be forwarded to the
provider child. No other `CCM_CODEX_FIXTURE_*` variable is permitted.

Promotion order is now:

1. fixture-backed parser/compiler + synthetic supervisor (implemented);
2. explicit operator-invoked, read-only candidate probe/execution (implemented, no routing bind);
3. shadow routing with no provider request;
4. separately authorized paid canary.

No stage may infer a later stage from documents or fixtures. A real provider probe or live auth read
occurs only when an operator explicitly invokes this endpoint; paid canaries, route binding, and
any account/credential mutation require separate approved authority.

## 11. Authoritative inputs and supersession

This contract consumes:

- `design_docs/2026-07-10-cross-harness-contract-spine.md` for routing/claim boundaries;
- `design_docs/cross-harness-orchestration-capability-model.md` for provider-driver/supervisor
  ownership and evidence rules;
- `design_docs/harnesses/codex.md` for repository-local harness facts;
- the 2026-07-13 Codex seven-day pacing decision for the retired five-hour ceiling.

Where older research or capability prose teaches Codex five-hour pacing or automatic account
switching, this contract and the 2026-07-13 product decision supersede it. This document does not
alter Claude Code pacing/account behavior or invent Cursor quota equivalence.
