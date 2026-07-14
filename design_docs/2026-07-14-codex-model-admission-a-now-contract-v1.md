# Codex model admission A-now executable contract v1

> Status: C2 contract implemented as a controlled production walking skeleton; default contract
> regression is GREEN; real-provider invocation remains unexercised
>
> Contract: `ccm/codex-model-admission-a-now/v1`
>
> Date: 2026-07-14 UTC

## 1. Purpose and frozen decisions

This contract freezes the smallest implementable C2 slice after the model-admission architecture
restart. It incorporates the approved decisions directly, so an implementation does not need the
temporary decision documents to interpret the contract:

1. **A-now / B-later; scheme C stops.** One per-run supervisor live-collects facts, calls a pure
   in-memory W1, and invokes at most one inspect child from the same process. Persistent admission
   receipts, PKI, distributed consume and persistent positive launch authority are not C2.
2. **Strict is the default.** C2 v1 has no trusted-workspace automatic-live mode. An automatic real
   provider request is rejected unless a later version names a verified OS-boundary backend. A
   user/operator may separately authorize one exact read-only inspect attempt.
3. **Exact ID plus a separately authorized real attempt.** Catalog/list output is discovery only.
   The first real provider request is a distinct authorization boundary. Actual model and effort are
   checked after the child starts.

Input decision SHA-256 values:

- user decision record: `69177708c1439828e1c254a21213b21f145ba62bfcc19ea0e61fa26fecd549b2`
- architecture restart: `0f523057c43842c5fe66d9299444c8c55642a70472a251d0279c671ef686b236`
- fresh restart review: `5677ecbaafab968793714595f320cf5da690fe221902d28df55a4a1715aacda5`

This contract does not authorize a real Codex request, paid canary, login/logout, account switching,
credential/config mutation, board write, GitHub action, package publication or release.

## 2. Scope and non-goals

The v1 vertical is one Codex read-only inspect attempt with:

- an exact non-alias model ID and exact effort;
- live, read-only binary/auth/catalog/7d-quota/policy/worktree collection by the attempt supervisor;
- an immutable ordinary in-memory `EvaluationCut`;
- a total deterministic W1 with no I/O or launch capability;
- one non-exported supervisor launch seam with at-most-once semantics;
- requested/resolved/actual identity reconciliation;
- terminal evidence that still requires parent acceptance.

Out of scope: writer tasks, alias/default/fallback selection, automatic account switching, trusted-
workspace automatic launch, a privileged service, cross-machine or replicated authority, central
fairness, persistent model-admission receipts, signed caches, PKI, a paid canary and promotion.

## 3. Ownership and authority lattice

| Object | Owner | May do | Must never do |
| --- | --- | --- | --- |
| dispatch request | current ccm under task/attempt authority | freeze exact selector/effect/worktree/idempotency | imply live model/auth/quota truth |
| live collectors | exact per-run supervisor | read current facts once for this attempt | mutate account/config/credential; return cached facts as live |
| `EvaluationCut` | supervisor memory | carry typed immutable current facts into W1 | act as a capability after serialization |
| W1 | pure domain function | return deterministic admit/reject and ordered reasons | read disk/network/clock, refresh, journal, sign or spawn |
| launch capability | private supervisor closure | call the provider runtime port at most once after W1 admit | be exported, serialized, accepted from public JSON or replayed |
| invoke intent/idempotency claim | run-control subsystem | conservatively deny duplicate/retry and support reconciliation | positively establish model/auth/quota admission |
| audit/cache/journal | run store | explain past facts, redact, correlate, observe and reconcile | authorize a future provider spawn |
| actual identity event | supervised provider channel | report observed actual model/effort | copy requested/resolved values when actual is missing |
| parent verifier | master/acceptance layer | accept artifacts and true-done the task | infer acceptance from provider terminal alone |

Persistent run-control state is **negative-only authority**: its presence may make a launch less
permissive, never more permissive. Deleting, replaying or forging it cannot create a positive right to
spawn. A durable invoke ambiguity remains `uncertain` and is never automatically retried.

## 4. Versioned request and authorization

The normalized request schema is `ccm/codex-model-admission-request/v1`:

```json
{
  "schema": "ccm/codex-model-admission-request/v1",
  "attempt_id": "attempt-1",
  "run_ref": "ccm-run:v1:run-1",
  "idempotency_key": "sha256:<64-lower-hex>",
  "provider": "codex",
  "operation": "inspect",
  "selector": {
    "kind": "exact",
    "model_id": "gpt-contract-fixture",
    "effort": "high"
  },
  "workspace": {
    "root_realpath": "/absolute/isolated/worktree",
    "baseline_sha256": "sha256:<64-lower-hex>",
    "effect": "read-only",
    "approval": "never",
    "network": "provider-only"
  },
  "launch": {
    "mode": "fixture|operator-explicit|automatic",
    "provider_target": "controlled-fixture|real-codex",
    "authorization": null
  }
}
```

For `operator-explicit + real-codex`, `launch.authorization` is required and has schema
`ccm/provider-request-authorization/v1`. It binds exactly:

- one `attempt_id`, `run_ref` and `idempotency_key`;
- provider `codex`, operation `inspect`, exact `model_id` and `effort`;
- exact workspace realpath, baseline digest and `read-only` effect;
- issuer `user|operator`, nonempty authority reference, issue/expiry times and a nonce.

The executable binding set is exactly these 16 leaves: `schema`, `issuer`, `authority_ref`,
`attempt_id`, `run_ref`, `idempotency_key`, `provider`, `operation`, `model_id`, `effort`,
`workspace_realpath`, `baseline_sha256`, `effect`, `issued_at`, `expires_at` and `nonce`. The fixture
matrix mutates each leaf alone. `issued_at` later than explicit evaluation `now`, `expires_at <= now`,
an empty required string, an unknown enum or any identity mismatch rejects as
`provider_request_authorization_mismatch`; a `fresh` label cannot override an expired timestamp.

The grant expires before W1 evaluation or provider invocation, cannot be supplied by workspace
content, cannot be widened by an agent, and authorizes one provider request only. It is not an account
switch authorization. C2 v1 rejects `automatic + real-codex` as
`automatic_live_spawn_disabled_strict`; a future OS-boundary contract must version that behavior.

`fixture + controlled-fixture` requires no real-provider grant and can be used by hermetic tests. Any
crossed combination is invalid. The request and its three nested objects are closed shapes: unknown
keys reject before live collection, so ambient environment, argv or permission data cannot be
smuggled through the request. The collected cut must repeat the exact attempt/run/key, selector,
workspace, launch mode/target and authorization or the supervisor returns `request_cut_mismatch`
before recheck or spawn.

## 5. Live `EvaluationCut`

The supervisor materializes `ccm/codex-model-admission-cut/v1` as an immutable ordinary in-memory
value. Required fields are:

```text
identity:
  attempt_id, run_ref, idempotency_key, supervisor_instance_id
  collected_by = exact current supervisor instance
  collection_epoch = nonempty per-attempt nonce
request:
  exact model_id, exact effort, operation=inspect, launch mode/target
binary:
  source=live-readonly, exact path/version/behavior revision, fresh+complete
auth:
  source=live-readonly, state=authenticated, opaque account/credential identity,
  observed_at, valid_until, fresh+complete
discovery:
  source=live-readonly, authority=discovery-only,
  model_identity_kind=provider-cli-model-id, source_method=model/list,
  exact model entry and supported efforts,
  observed_at, valid_until, fresh+complete
resolution:
  exact requested model/effort and exact resolved model/effort
quota_7d:
  source=live-readonly, status=ample, opaque account/pool identity,
  observed_at, valid_until, fresh+complete
policy:
  source=current-authority, cross_harness=allow, effect=read-only, approval=never,
  account_mutation=forbidden, credential_write=forbidden, launch mode/authorization result
workspace:
  exact root_realpath/baseline, isolated=true, write_set=empty
reservation:
  held=true, same account/pool/workspace/attempt identities, valid_until
provenance:
  persistent_evidence_used=false
```

The cut may contain audit references for correlation, but W1 must ignore their content. A cut with
`source=cache|ledger|receipt|replay`, missing provenance, a different supervisor/epoch, stale or
unknown required facts is not live and rejects. Catalog discovery proves only that an exact selector
is visible and an effort is advertised; it never proves account entitlement or authorizes a real
request.

The retired Codex 5h field is not part of W1. A 24h burn-rate field, if carried for audit, is advisory
and cannot change the verdict. Fresh complete 7d `ample` is the only percentage admission status.

## 6. W1 contract

Production W1 is conceptually:

```ts
evaluateCodexAdmissionV1(cut: Readonly<EvaluationCutV1>, now: Instant): W1DecisionV1
```

It is total, deterministic and pure. Same canonical input and explicit `now` produce byte-equivalent
decision/reason ordering. It accepts no ports or ambient clock. The return value is ordinary data:

```json
{
  "verdict": "admit|reject",
  "reason_codes": ["ordered_reason"],
  "provider_target": "controlled-fixture|real-codex|null",
  "provider_spawn_permitted": true,
  "real_provider_request_permitted": false
}
```

`provider_spawn_permitted` and `real_provider_request_permitted` are explanatory results for the
private composition root, not callable capabilities. Reject sets both false; a controlled fixture
may set only the former; an exact separately authorized real attempt may set both true. The decision
is **not a bearer credential**. No public API, launcher or later process may accept this JSON or its
digest as spawn authority. An audit layer may compute a cut digest after evaluation, but that digest
is not a W1 output and has no authority. Positive launch requires all of the following in one
supervisor call stack:

1. the supervisor just collected the live cut;
2. its direct call to W1 returned `admit`;
3. reservation, authorization expiry, worktree baseline and identity revisions remain unchanged at
   the private invocation seam;
4. the same supervisor still owns its unexported, unused launch capability.

Required reject reasons include `persistent_only_evidence`, `cut_replayed`, `auth_unknown`,
`auth_stale`, `catalog_stale`, `model_exact_mismatch`, `effort_exact_mismatch`, `quota_7d_unknown`,
`quota_7d_tight`, `quota_7d_exhausted`, `quota_7d_stale`, `policy_denied`,
`provider_request_authorization_missing`, `provider_request_authorization_mismatch`,
`automatic_live_spawn_disabled_strict`, `workspace_mismatch`, `reservation_invalid` and
`account_identity_conflict`. Multiple failures use a frozen deterministic priority in the fixture
domain; implementations must not hide a higher-priority authority failure behind a later mismatch.

## 7. Supervisor launch state machine

```text
collecting
  -> evaluating
       -> rejected                         # spawn 0
       -> admitted-in-memory
            -> preinvoke-recheck
                 -> rejected               # spawn 0
                 -> durable invoke-intent  # negative-only after publication
                      -> invoking           # one private runtime call
                           -> started       # real OS/process-tree handle
                           -> uncertain     # result ambiguous; no retry
```

At-most-once means provider-work spawn count is `<= 1` for one logical
`(attempt_id,idempotency_key)`. It does not promise exactly once: pre-spawn reject/failure may yield
zero, and an OS-call crash may leave an unknown zero/one result.

- same-process second invocation: reject/no-op, spawn delta 0;
- same-key concurrent/replayed request: spawn delta 0; caller-shaped durable markers are
  negative-only and return `original_run_attach_required` unless the supervisor's private
  run-control port returns a closed attached handle bound exactly to attempt/run/key/provider target
  and the compiled invocation;
- serialized W1 decision or audit entry: reject, spawn delta 0;
- crash after invoke intent and before handle binding: `uncertain`, retain reservation/worktree,
  spawn delta 0 on every automatic retry;
- handoff attaches to the same `run_ref`; it never reconstructs W1 or calls spawn;
- only a new explicitly authorized attempt/key may later launch after reconciliation policy permits.

The supervisor input distinguishes a missing `durableControl` property from a property whose value is
`undefined`, `null` or any other value. Only a genuinely missing property is normalized to the exact
fresh-state record below. Once the caller supplies the property, its value is persistent-control
input and must pass this closed three-key schema; it is never coerced to absence:

On the first `run()` call, the supervisor synchronously binds both property presence and a closed,
immutable parsed copy before collection, preinvoke recheck, attach, spawn or any other caller callback.
All later authority consumes only that bound state and never re-reads the input or its nested alias.
If property inspection or closed-state materialization throws, binding produces the same typed
`durable_control_invalid` zero-spawn result as any other invalid supplied value; it does not throw,
retry the read or fall back to fresh authority.

Binding is a one-way synchronous state machine: `unbound -> binding -> bound`. The supervisor must
publish `binding` before invoking any caller-controlled property inspection or materialization. A
`run()` that reenters while that state is `binding` returns typed `durable_control_invalid` without
reading the property again and without entering preparation, preinvoke, attach or spawn. Once the
outer materialization closes `bound`, later sequential or concurrent calls reuse that one immutable
value and the existing at-most-once launch capability.

| exact `durable_control` state | meaning | launch behavior |
| --- | --- | --- |
| `{home_claim:"absent", invoke_intent:"absent", started_handle:"absent"}` | canonical new attempt | may continue to the private fresh spawn path |
| `{home_claim:"same-key-same-request", invoke_intent:"durable", started_handle:"present"}` | canonical durable attach | private exact attach only; never fresh spawn |
| `{home_claim:"same-key-same-request", invoke_intent:"durable", started_handle:"unknown"}` | canonical invoke ambiguity | `uncertain/invoke_outcome_ambiguous_no_auto_retry`, spawn delta 0 |
| `{home_claim:"same-key-different-request", invoke_intent:"absent", started_handle:"absent"}` | canonical idempotency conflict | `reject/idempotency_conflict`, spawn delta 0 |

The object has exactly those three keys and no others. Primitive values, arrays, empty objects,
missing or extra keys, unknown enum values, wrong field types and every crossed/partial combination
outside the four rows return `reject/durable_control_invalid`, spawn delta 0. In particular,
`undefined`, `null`, `{}` and an unknown object are supplied invalid state, not aliases for a missing
property or for canonical all-absent. No such result can acquire a verified started handle or become
task-done from caller terminal data plus parent verification.

The public endpoint may return normalized data, but the provider runtime port and in-memory launch
token are private to the supervisor composition root.

The supervisor alone compiles `ccm/codex-provider-compiled-invocation/v1` from the admitted immutable
cut. The compiled value fixes the absolute executable, ordered argv, exact cwd, empty explicit env,
read-only permission profile and empty write set. Its binding repeats attempt/run/key,
supervisor/epoch, exact model/effort/workspace/baseline, authorization, auth/quota/reservation
identities and current policy. The runtime port accepts this value as its only argument; no downstream
adapter may independently reconstruct model, effort, workspace, permissions or environment.

Immediately before consuming the one-shot capability, the supervisor issues a closed
`ccm/codex-model-admission-preinvoke-challenge/v1`. An unchanged confirmation must use
`ccm/codex-model-admission-preinvoke-confirmation/v1` and echo the complete expected binding exactly.
Any missing, additional or changed load-bearing field returns `preinvoke_invalid` with spawn zero.
Collector and recheck have explicit bounded timeouts. Throws, timeouts, clone/materialization faults
and malformed confirmations become typed zero-authority terminals. A `changed` confirmation always
maps to the frozen public reason `preinvoke_authority_changed`; its free-form reason can only select
a closed diagnostic category in separate `ccm/bounded-redacted-diagnostic/v1` evidence. Arbitrary,
overlong and sensitive-looking input never crosses the public result boundary verbatim.

The executable test seam is `createAuthorityHarness(input, runtimePort) -> { invoke() }`. The
`runtimePort` is injected and owned by the test process; production must capture it in the returned
harness closure and must not copy it into `input`, a decision, an audit entry or JSON. A fresh harness
instance is invoked twice in each of two fixtures, once sequentially and once concurrently. The
test-controlled spawn port delays completion by one event-loop turn and counts calls independently,
so setting `used` only after an await, returning fabricated `spawn_count_delta`, or accepting a
serialized `used` flag cannot make the at-most-once test pass. There is deliberately no
`private_launch_capability` field in a fixture input.

Before calling either the fresh-spawn port or the durable-attach port, the harness synchronously
publishes one shared in-progress authority latch. Durable attach also publishes that latch before its
first and only `attachOriginalRun` property read, because accessor or Proxy lookup is caller-controlled
code. Lookup reentry receives the same immediate zero-effect result as callback reentry; a lookup
fault becomes stable `reject/authority_internal_invariant`, and a missing or non-function port becomes
stable `uncertain/original_run_attach_required`. Neither case may fall back to fresh spawn.

If a runtime port synchronously reenters `invoke()`—even when the port awaits the nested result—the
nested call returns the typed zero-effect result `reuse/invoking/authority_effect_in_progress`
immediately; it neither reads the attach property nor calls a port again, and it does not await the
promise whose completion depends on the current port stack. After the port has returned control,
ordinary asynchronous concurrent callers continue to await the one shared attempt and receive the
existing terminal duplicate/reuse semantics. Port throw, invalid-handle and reconciliation behavior
remain owned by the outer attempt.

## 8. Actual identity and completion

After a real or controlled child starts, actual identity must come from the supervised provider event
channel:

| Actual observation | Attempt outcome | Task outcome |
| --- | --- | --- |
| exact model and effort match | provider may continue to terminal | still not done |
| model mismatch | failed: `actual_model_mismatch` | not done |
| effort mismatch | failed: `actual_effort_mismatch` | not done |
| actual identity missing/ambiguous | uncertain: `actual_identity_unknown` | not done |

Requested/resolved values must not be copied into `actual`. Provider terminal success produces an
artifact/attempt terminal only. A separate parent verifier owns acceptance and true-done. Reconcile
before a verified started or attached handle, after admission/preinvoke reject, after an unverified
durable marker, or after ambiguous spawn returns `provider_not_started`; provider
failure/cancellation can never become terminal success. Repeating
the same provider event is idempotent and may later add parent verification, while a conflicting
terminal event fails closed as `provider_terminal_conflict`.

## 9. Effects and privacy

Contract evaluation and RED fixtures have these exact effects:

```text
real_provider_requests = 0
paid_canaries = 0
login/logout/switch/import/copy/device-auth/refresh = 0
account_mutations = 0
credential_or_config_writes = 0
board_writes = 0
remote_mutations = 0
```

Effect counts are test-owned observations, never evaluator input and never accepted from evaluator
output. Every evaluator seam runs in a new Node permission-restricted child process. Loading has two
explicit phases: a loader-safe pre-bind observer keeps the established filesystem/process/network
probes active while `tsx` binds a TypeScript evaluator, then a deny-by-default sweep replaces every
function currently exported by the filesystem, child-process, worker and network modules before any
evaluator export is called. This is capability-surface enumeration, not a mutation API denylist, so
new functions such as `fs.utimesSync` are denied and recorded without naming them in advance.
`syncBuiltinESMExports` updates built-in ESM bindings after each boundary transition.

The `tsx` transform worker is the sole loader-phase exception: `--allow-worker` permits that worker
until the module exports bind, after which the Worker constructor is replaced before evaluator
execution. Module initialization is therefore a trusted loader phase, while evaluator behavior is
the restricted contract target; a future claim about hostile import-time initializers requires a
separate pre-execution bundling/loader contract rather than widening this v1 test.

Test-owned semantic ports independently record controlled fixture spawn, real-provider/canary,
login/logout/switch, credential import/copy/write/refresh, config, board and remote mutation
attempts in the append-only journal at attempt time. An async-resource completion handshake waits for
evaluator-owned work to quiesce before the wrapper submits its result frame; a non-quiescent
invocation is itself a journalled boundary attempt. Thus a post-return `setImmediate` attempt, a
caught denial or an output that reports zeros cannot erase an observation. The controlled fixture
port is the sole allowed positive effect and is still counted by the test process.

Evaluator stdout/stderr are untrusted logs, never a result or observation channel. The parent opens
two wrapper-only pipes: one accepts exactly one terminal result frame, while the other is an
append-only observer journal written synchronously at each boundary/semantic/effect attempt. The
parent waits for child terminal or kill/reap, then derives counts and attempt arrays from the journal;
it never accepts evaluator/worker snapshot data. A missing, duplicate or malformed result frame is a
typed zero-authority protocol deny. Evaluator-written legacy sentinel text, including a later
`beforeExit` line, has no protocol meaning. A semantic port invoked from `beforeExit` is therefore
either structurally rejected when registered or present in the final parent-owned journal; it cannot
return a false zero.

The handshake is not its own liveness authority. The parent runner also owns a two-second wall-clock
ceiling and non-interceptable child kill/reap. If a referenced timer keeps the child alive after its
wrapper result, or recursive microtasks starve the child's own deadline, the parent returns typed
`CCM_EVALUATOR_NON_QUIESCENT`, marks observation completeness false and exposes no result or positive
spawn authority. This is a test-process fail-closed bound; it does not add production launch
authority.

A future production attempt may increment `real_provider_requests` to one only after a matching
`operator-explicit` authorization (or a later versioned OS-boundary authority) and W1 admit. Account
or credential mutation remains zero on success, reject, timeout, cancellation and failure.

Audit stores only bounded redacted refs, digests and reason codes. Raw credentials, authorization
headers, cookies, tokens, email, credential paths, prompts and private provider responses do not enter
the audit record or audit-digest input. Provider artifacts require a separate access/retention
contract and are never model-admission authority.

## 10. Executable fixture domains and acceptance

Fixtures use `ccm/codex-model-admission-a-now-fixtures/v1` and have four domains:

1. `w1.json`: live exact positive controls, all 16 grant-leaf mutations, uncoupled label/timestamp
   expiry, and persistent/stale/replay/mismatch/quota/policy/workspace/reservation rejects;
2. `authority.json`: non-serializable authority, observed same-instance sequential/concurrent
   one-shot, duplicate and crash ambiguity;
3. `reconciliation.json`: requested/resolved/actual separation and terminal-not-done;
4. `effects.json`: sandbox-observed zero-real-request/canary/account/credential/config/board/remote
   effects, plus one observed controlled-fixture spawn.

The opt-in executable test is:

```bash
cd ccm/apps/cli
node --import tsx --test test/codex-model-admission-a-now-contract.red.ts
```

After implementation, `codex-model-admission-a-now.test.ts` runs the frozen evaluator, authority,
reconciliation and effect case matrices in the default suite. The permission-restricted process and
liveness fault calibration remains the explicit command above because it owns long-lived hostile
child processes and its parent wall-clock/reap authority must stay isolated from the repository-wide
test worker pool. The separate `codex-model-admission-supervisor.test.ts` proves that the production
composition root shares one live collection and one private launch capability across sequential and
concurrent calls, while persistent-only evidence, strict automatic mode and changed preinvoke
authority all produce zero spawn. `codex-model-admission-r2.test.ts` additionally freezes the exact
request→cut→compiled invocation→preinvoke→spawn binding, owner-frozen reason priority, stable
no-retry failure states, terminal-event consistency and bounded collector/recheck liveness.

The permission-bound fault file intentionally retains the `.red.ts` suffix and remains an explicit
isolated gate; the semantic matrix is promoted through the default test named above. The production-
reachable module at `ccm/apps/cli/src/codex-model-admission-a-now.ts` exports `evaluateW1Case`,
`createAuthorityHarness`, `evaluateReconciliationCase` and `evaluateEffectCase`, while a separate
reachability test shows the real supervisor composition root consumes them through the package
entry. The authority harness must consume its injected runtime port; `evaluateEffectCase` receives
frozen semantic effect ports. A fixture lookup, evaluator that reads `expected`, serialized launch
capability, implementation-owned effect counter or self-reported `observed` input is invalid.

The fixture and observer-calibration tests must stay green while the four implementation-domain
tests stay honestly RED. Calibration first loads a minimal `.ts` evaluator to prove that loader
binding is reachable. It then executes a deliberately unsafe module that ignores every grant
binding, calls the spawn port twice, attempts real file writes through both a named and an unlisted
filesystem API, schedules a forbidden account port after returning, and attempts process/network
access. The matrix must reject every grant mutation, observe two calls, record every attempt even
when the counterfeit catches the denial, and leave no marker file. This proves the runner kills the
reviewed counterfeit classes rather than merely naming mutants.

Liveness calibration additionally runs one evaluator that leaves a referenced interval and one that
recursively queues microtasks. Each must become a bounded typed non-quiescent deny, expose zero spawn
authority and leave no evaluator child behind. A finite evaluator-owned `setImmediate` remains a
negative control and must not be rejected.

## 11. Stop/restart rule

Stop this slice when the versioned contract, fixture manifest, mutation adequacy and honest RED are
frozen. Do not implement a real provider call here. If an implementation proposal needs a persistent
positive admission receipt, cross-process signer, distributed consume or hostile-same-UID durable
authority, stop and open a C3/B-later product decision instead of extending this C2 contract.
