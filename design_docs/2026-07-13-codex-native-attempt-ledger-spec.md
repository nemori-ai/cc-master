# Codex API/tool native-attempt ledger v1

> Status: **Frozen C2 implementation contract; ledger implemented; host-native live dispatch unsupported**
> Date: 2026-07-13 UTC
> Board task: `xh_c2_native_attempt_spec`
> Contract IDs: `ccm/native-attempt/v1`, `ccm/native-handle-evidence-record/codex-api-tool/v1`, `ccm/native-private-evidence-authentication/v1`, `ccm/native-attempt-feature-probe/codex-api-tool/v1`
> Depends on: [`2026-07-10-cross-harness-contract-spine.md`](2026-07-10-cross-harness-contract-spine.md), [`cross-harness-orchestration-capability-model.md`](cross-harness-orchestration-capability-model.md) §§4–6, 10, 15

## R1 authority correction (post-PR115)

This contract consumes, and never competes with, the unique launch authority frozen by
`2026-07-13-cross-harness-quota-admission-contract.md`. A native-attempt create is launch-capable
only when a ccm-owned production composition has atomically staged one claim against an already
`committed`, still-current reservation/ticket. The claim is committed only after the new board bytes
are durable. Missing, held, expired, mismatched, or already-consumed authority rejects the write;
board and claim bytes remain unchanged.

The shared, provider-neutral identity vocabulary is `ccm/canonical-launch-identity/v1`, implemented
once in `@ccm/engine` and reusable by the future Cursor provider driver. Its closed shape binds:

- origin harness, target harness, adapter, surface, transport and candidate;
- exact provider, model and effort from the selected routing candidate;
- account fingerprint, workspace ref, worktree ref and baseline commit;
- the complete permission snapshot/profile/deny set;
- separate immutable input and request SHA-256 digests;
- exact runtime image SHA-256 and the exact model/effort selector.

Native code, quota code, and future Cursor code call the shared canonical builder/digest. They do
not maintain a second field list, JSON canonicalizer, or hash implementation.

The owner-store launch record is `ccm/native-launch-authority/v1`. It contains the canonical launch
identity and digest, the authoritative committed reservation projection, the complete
`ccm/quota-admission-ticket/v1`, its canonical digest, and the native claim id. The ticket repeats
the attempt, account, pool, identity, runtime, launch idempotency, nonce and expiry bindings from the
quota contract. The reservation repeats the ticket and digest committed by the quota writer. The
native ledger stores only this immutable, non-secret authority projection; later bind, terminal and
reconciliation evidence scopes repeat its reservation id, ticket digest and launch-identity digest.

`attempt.dispatch` therefore has the closed, immutable launch-input fields `key`, `input_hash`,
`request_hash`, `launch_claim_id`, and `claim_owner_session_ref`. `input_hash` and `request_hash` are
distinct facts even when an upstream caller happens to derive equal bytes.

The installed composition root is `runProduction`, not the injectable router test seam. It always
constructs the ccm-owned admission/claim boundary and private-evidence authenticator from the
resolved `CC_MASTER_HOME`; caller-supplied test boundaries are not accepted as production evidence.
Owner records, producer registrations, staged claim locks, committed claims and evidence-consumption
records live under that home with owner-only permissions. An offline fixture may materialize those
same production records and exercise `runProduction`, but receives no fixture-only verifier or
resolver shortcut.

The stage file is itself a durable owner-only intent record with the staging process identity. If
that process dies after the board rename but before the owner claim/consumption commit, an exact
retry may reclaim that stage only
when the locked board already contains the same immutable attempt or evidence ref/hash. A missing
projection, changed identity/payload, unrelated stage, or still-live stage owner is never reclaimed.
This closes the
post-board/pre-owner-commit crash window without granting a second launch or consuming conflicting
evidence.

Lifecycle time is causal evidence, not display metadata. Both mutation apply and hard board
projection enforce the applicable partial order:

```text
created_at <= spawn.observed_at <= roster.observed_at == bound_at
             <= terminal/reconcile observed_at
```

Every later reconciliation observation is strictly after the preceding lifecycle observation.
Impossible time order rejects before durable board or claim/evidence consumption.

## 1. Scope and evidence verdict

This slice freezes the first host-native attempt contract. The ledger, dedicated writer, and private evidence authentication surface are implemented: `@ccm/engine` validates and applies the lifecycle,
ccm owns the locked board/evidence transaction, and the five dedicated CLI verbs in §5 are executable
and contract-tested. **Host-native live dispatch/spawn remains unsupported**: no host strategy projects
an invoke artifact, no Codex origin adapter invokes spawn/list/wait/interrupt, and no provider/model
request is made by this surface. The checked-in tests exercise the implemented ledger contract without
claiming or calling a live host runtime.

The selected origin is narrowly:

```text
origin  = codex
surface = codex-api-tool-multi-agent
gate    = spawn/list/wait/interrupt tools are actually exposed in the current origin session
```

This does not select every Codex CLI/App/background-thread surface. It does not infer a native
handle from “Codex supports subagents” as a product claim. The selection is based on the first
origin in the approved Codex → Claude Code → Cursor implementation order whose current tracked
facts describe a real returned identifier and a reconciliation/control surface:

| Origin/surface | Evidence | Verdict for this contract |
| --- | --- | --- |
| Codex API/tool multi-agent | [`harnesses/codex.md`](harnesses/codex.md) §Background and Parallel Execution states the usage discipline that a real `spawn_agent` return must precede using an agent ID as a handle. The checked-in feature-probe fixture freezes the detector shape, but is explicitly synthetic and does not prove the current session exposes the tools. | **Selected for contract only; runtime unsupported.** A trusted sanitized live probe is still required before promotion. |
| Claude Code Agent | [`harnesses/skill-host-coupling-audit.md`](harnesses/skill-host-coupling-audit.md) gives a Capability Surface recommendation for Agent/Task-style dispatch. The cited file is not a captured handle-return probe and does not prove a returned `agentId`. | Plausible later candidate, not proven by the cited audit and not implemented by this slice. |
| Cursor IDE Task | [`harnesses/cursor.md`](harnesses/cursor.md) documents Task + subagent hooks, but its completed D1–D12 probe set does not prove the Task return handle/reconciliation contract. | Not selected; remains unsupported for native-attempt v1. |

No provider/model call was made to write or validate this spec. A binary version check is not a
handle probe. The replayable detector input/schema is frozen in
`ccm/packages/engine/test/fixtures/native-attempt/codex-api-tool-feature-probe-v1.json`. Its checked-in
case is a **sanitized contract template**, not a claim about the active development environment:
even when all four logical tool declarations are present it returns
`selected-for-contract-only`, `runtime_status:unsupported`, and `promotion_eligible:false` because
the producer is unverified. Version-only input and any missing operation return `unsupported`.

Promotion requires replacing that synthetic observation with a sanitized, private-adapter-produced
probe record that proves the exact spawn response shape, list/reconcile observation, wait/terminal
race, interrupt semantics, parent/child lineage, and zero credential/account mutation on the target
version. Raw environment, identity, credential, prompt, and transcript material remains outside the
fixture; only logical operation names and input/output shape hashes may be checked in.

## 2. Capability INTENT

Capability ID: `native-attempt-ledger`.

Given a contract-enabled routed `executor=subagent` task whose selected candidate is this origin's
`surface=host-native`, the origin master can:

1. atomically create one append-only `starting` attempt and receive at most one launch permission;
2. invoke the exposed Codex native spawn tool only after that create succeeds;
3. bind only an owner-only evidence record produced over the authenticated ccm private adapter
   channel; the record contains the opaque identifier returned by spawn and same-origin roster
   corroboration, while the public writer accepts only its ref;
4. enter `running`/task `in_flight` only in the same atomic bind that records the real handle;
5. record terminal or cancellation evidence without ever marking the task `done`;
6. reconcile or conservatively classify the attempt through a dedicated writer after ambiguous
   spawn, cancellation, parent interruption, or handoff, including a fenced orphan audit;
7. preserve immutable origin session, parent, account, workspace, worktree, and baseline lineage;
8. make every create/bind/cancel/terminal replay either an exact no-op or a hard conflict.

### 2.1 Acceptance

- No handle means no `running` attempt and no task `in_flight` projection.
- An arbitrary non-empty string, task ID, parent session ID, PID, prompt text, or intended future
  spawn is never a real handle.
- A caller-supplied `source`, `attestor`, raw binding object, or `verified:true` flag is not trusted
  evidence. Public CLI input can name an existing evidence record but cannot create or certify it.
- Provider/native terminal means task `uncertain`, never task `done`; parent endpoint verification
  is mandatory.
- Cancellation acknowledgement is not terminal proof. A raced success/failure is recorded as the
  observed terminal class, not rewritten to `cancelled`.
- Exact retries create zero duplicate attempt records, handle binds, control effects, terminal
  events, or launch permissions.
- Missing/unknown/drifted account or worktree lineage cannot be silently normalized; automatic
  native launch remains unavailable until the lineage is proven.
- The handle is `legacy_session_bound`. No cross-session attach/resume/cancel claim is allowed.
- Ambiguous observations project the task to `uncertain` and clear the active handle projection.
  A complete fenced orphan audit clears the handle, seeds `ready`, and then runs ordinary dependency
  gating through `reconcileGating`; the resulting task projection is `ready|blocked`. Unmet deps always
  project to `blocked`. The result may permit a later explicit create, never an automatic respawn.

### 2.2 Non-goals

- no cross-harness CLI worker or durable supervisor;
- no generic Codex CLI/App/background-terminal contract;
- no model/effort scoring, entitlement, pricing, or quota-policy evaluator; this slice only consumes
  and revalidates an already committed quota reservation/ticket;
- no account login/logout/switch, credential read/copy/import/write, or automatic account fallback;
- no route scoring, fallback policy, task acceptance, or board `done` ownership in a host adapter;
- no claim that a one-shot ledger permit alone mechanically prevents a caller from bypassing ccm
  and invoking the host tool twice.

The last item is load-bearing. The current Codex tool surface does not expose a ccm-owned provider
idempotency key. Ledger idempotency is specifiable now; provider-level duplicate-spawn prevention
requires an origin adapter/wrapper that consumes the permit exactly once or a future native surface
with an idempotency key. Until that endpoint is proven, runtime status stays `unsupported`.

## 3. Activation, ownership, and versions

This contract is additive. It keeps `schema: "cc-master/v2"`, the narrow waist, and
`executor: "subagent"`. A board opts into the native real-handle gate only with:

```json
{
  "meta": {
    "contracts": {
      "task_planning": "ccm/task-planning/v1",
      "agent_routing": "ccm/agent-routing/v1",
      "native_attempt": "ccm/native-attempt/v1"
    }
  }
}
```

Without `native_attempt`, the C1 `route-bind` path remains the existing syntactic opaque-handle
claim and MUST NOT be relabeled a real native handle. With `native_attempt` enabled, a selected
`host-native` candidate may enter flight only through the five dedicated operations in §5;
`route-bind`, generic setters, task status writers, and `--force` cannot construct or repair it.

| State/decision | Single owner |
| --- | --- |
| Schema, transition legality, issue taxonomy, verified-record content linkage | `@ccm/engine` pure contract |
| Selection, append-only attempt projection, task status/handle projection | active ccm dedicated writer under board lock |
| Native spawn/list/wait/interrupt invocation and raw evidence capture | registered Codex origin adapter on an exposed API/tool surface |
| Producer authentication, evidence signature/hash verification, owner-only record store | ccm private adapter channel; never a public registry verb or caller JSON field |
| Account/worktree facts | referenced machine/worktree evidence; adapter may only compare refs |
| Final task acceptance | parent master/verifier through the existing true-done path |

The host adapter never owns route score, candidate policy, attempt validation, board state machine,
account mutation, or task completion. `@ccm/engine` is deliberately not the producer-authentication
boundary: its pure operation endpoint receives a ccm-verified record projection and rechecks all
create/candidate/lineage links. The locked ccm writer must authenticate the producer and record
before invoking that pure endpoint. A direct engine caller cannot turn an unverified JSON object
into trusted evidence.

## 4. Native attempt and handle shapes

### 4.1 Attempt summary

Every native attempt appended to `task.routing.attempts[]` has this minimum shape:

```json
{
  "schema": "ccm/native-attempt/v1",
  "id": "attempt-opaque",
  "ordinal": 1,
  "candidate_id": "codex-native",
  "surface": "host-native",
  "transport": "codex-api-tool-multi-agent",
  "state": "starting",
  "created_at": "2026-07-13T08:00:00Z",
  "dispatch": {
    "key": "stable-dispatch-key",
    "input_hash": "sha256:...",
    "request_hash": "sha256:...",
    "launch_claim_id": "opaque-one-shot-claim",
    "claim_owner_session_ref": "opaque-origin-session-ref"
  },
  "lineage": {
    "origin_session_ref": "opaque-origin-session-ref",
    "parent_target": "/root/task-name",
    "expected_child_target": "/root/task-name/expected-child",
    "account_fingerprint_ref": "opaque-account-snapshot-ref",
    "workspace_ref": "opaque-workspace-ref",
    "worktree_ref": "opaque-worktree-lease-ref",
    "baseline_commit": "40-hex-commit",
    "permission": {
      "snapshot_ref": "opaque-permission-snapshot-ref",
      "profile": "workspace-write",
      "denies": ["account-mutation", "push-remote"]
    }
  },
  "selection_snapshot": { "candidate_id": "codex-native", "chain": "ample", "selected_at": "...", "evidence": {}, "reason_codes": [] },
  "launch_authority": { "schema": "ccm/native-launch-authority/v1", "canonical_identity_digest": "sha256:...", "ticket_digest": "sha256:...", "reservation": {}, "ticket": {} },
  "handle_binding": null,
  "cancel": null,
  "terminal": null
}
```

`selection_snapshot` is the entire immutable C1 selection, not a mutable ref. It must be present in
the create request and in the appended attempt, byte-for-value equal in parsed JSON, and its
`candidate_id` must equal both the attempt candidate and a candidate in the selected policy chain.
The contract fixture is self-contained and is not allowed to outsource this check to a `selection_ref`.
`expected_child_target` is frozen before spawn and cannot be supplied for the first time at bind.
`ordinal` is monotonic per task. `dispatch.key`, `input_hash`, and `request_hash` are immutable and
value-bound to the committed canonical launch identity. All timestamps use exact
canonical UTC second precision and must round-trip to the same calendar instant; impossible dates
and invalid leap days fail closed.

Lineage references are opaque and secret-free. They may identify a local owner-only record, but
board/agent-visible data never carries email, token, credential path/value, raw environment, or raw
host response. An unknown account/worktree ref is a negative capability for automatic native
launch, not a placeholder that later code may reinterpret as proof. `permission.snapshot_ref`
identifies the ccm-owned preflight fact used for both create and bind. The observed profile must be
the selected candidate's profile (or a mechanically proven stricter profile), and its effective
deny set must be a superset of every candidate/task deny. Unknown profiles, profile drift, or a
missing deny are ineligible; prompt wording is not permission evidence.

### 4.2 Real handle evidence and trust boundary

`running` requires a signed owner-only record with this minimum payload (the fixture carries the
complete replayable shape):

```json
{
  "schema": "ccm/native-handle-evidence-record/codex-api-tool/v1",
  "record_id": "owner-only-evidence-ref",
  "record_hash": "sha256:...",
  "producer": {
    "producer_id": "registered-codex-origin-adapter",
    "channel": "ccm-private-adapter/v1",
    "registration_ref": "private-registration-ref",
    "signature": "ed25519:..."
  },
  "create_link": {
    "task_id": "T1",
    "attempt_id": "attempt-1",
    "candidate_id": "codex-native",
    "dispatch_key": "dispatch-1",
    "input_hash": "sha256:...",
    "request_hash": "sha256:...",
    "launch_claim_id": "claim-1",
    "reservation_id": "reservation-1",
    "ticket_digest": "sha256:...",
    "launch_identity_digest": "sha256:..."
  },
  "expected": {
    "transport": "codex-api-tool-multi-agent",
    "parent_target": "/root/parent",
    "child_target": "/root/parent/child"
  },
  "observed": {
    "handle_kind": "codex-agent-id",
    "handle": "opaque-id-returned-by-spawn",
    "canonical_target": "/root/parent/child",
    "spawn": { "owner_record_ref": "owner://spawn", "raw_evidence_hash": "sha256:...", "observed_at": "..." },
    "roster": { "owner_record_ref": "owner://roster", "raw_evidence_hash": "sha256:...", "observed_at": "...", "handle": "opaque-id-returned-by-spawn", "state": "running" },
    "current_lineage": {
      "origin_session_ref": "...",
      "parent_target": "/root/parent",
      "expected_child_target": "/root/parent/child",
      "account_fingerprint_ref": "...",
      "workspace_ref": "...",
      "worktree_ref": "...",
      "baseline_commit": "...",
      "permission": {
        "snapshot_ref": "opaque-permission-snapshot-ref",
        "profile": "workspace-write",
        "denies": ["account-mutation", "push-remote"]
      }
    }
  }
}
```

The canonical `record_hash` covers the schema, record ID, producer ID/private channel/registration,
create link, expected targets, and all observations; the producer signature covers that hash. The
producer is registered before launch for one origin/transport/session trust scope. The launch claim
is consumed by the create transaction before any adapter may spawn and is never printed in the
public create result. The adapter writes raw spawn/roster observations to the owner-only evidence store,
signs the canonical record hash with its registered key, and returns only `record_id` to the public
workflow. The ccm writer resolves the ref, verifies owner-store provenance, hash, signature,
producer scope, exact create/authority linkage, and one-shot evidence consumption, then passes a
verified projection to the engine.
The board stores only the normalized handle, `record_id`, `record_hash`, producer ID, and durability
class. It never stores raw responses, the producer private key, or the private channel credential.

The public `bind` endpoint accepts `--evidence-record-ref`; it does **not** accept `--binding`,
`--source`, `--attestor`, raw response JSON, or a caller-provided `verified` flag. Owner-only file
permissions are defense in depth, not the trust proof: the registered signature/private-channel
provenance is mandatory. The threat boundary excludes compromise of the ccm process or registered
adapter private key, but includes arbitrary board/CLI callers and workspace-writable files.

A **real handle** is the exact opaque target identifier in the signed spawn observation, equal to
the same-handle roster observation and the create-frozen expected child. Every create link and every
current-lineage observation must equal the immutable attempt snapshot. Missing, invalid, replayed,
or mismatched evidence fails before board mutation. A non-empty string, parent/session/task ID,
pre-spawn name, or uncorroborated ambiguous response is never a real handle; ambiguity is recorded
through reconciliation as `uncertain`.

### 4.3 Private evidence authentication algorithm

`ccm/native-private-evidence-authentication/v1` is a ccm-owned composition-root boundary, not an
engine or public-CLI attestation flag. For bind, the locked writer MUST perform all of the following
before calling `nativeAttemptApply` or changing board bytes:

1. reject any caller/record field named `verified_by_ccm` (or equivalent caller certification);
2. resolve the public ref from the configured ccm owner store and require provenance
   `store=ccm-owner-evidence/v1`, the configured owner-home scope, `visibility=owner-only`, and the
   same resolved `record_ref`, with `record.record_id == record_ref`; workspace files and a bare
   `resolve()` object are not provenance;
3. canonicalize exactly `{schema,record_id,producer:{producer_id,channel,registration_ref},
   create_link,expected,observed}` as UTF-8 JSON with recursively sorted object keys, preserved
   array order, and no insignificant whitespace, then compare
   `record_hash == "sha256:" + SHA-256(canonical_bytes)`;
4. look up `registration_ref` in the private producer registry and require exact producer ID,
   channel, Ed25519 key ID/fingerprint, and non-revoked registration;
5. verify the Ed25519 signature over the ASCII bytes of the declared `record_hash` using that
   registration's public key;
6. require the registration trust scope to equal the attempted origin, transport, and immutable
   `origin_session_ref` (no prefix, parent-session, or same-brand inference);
7. recheck the create link, handle corroboration, account/workspace/worktree/baseline/permission
   lineage, and expected child against the immutable attempt;
8. require the committed launch claim to match the attempt's reservation, ticket, and canonical
   identity digests, then stage one evidence-consumption identity under the same transaction as the
   board projection. The same attempt+record exact replay is a no-op; a different record/projection
   is rejected. Failed authentication or failed board commit consumes nothing.

The handler receives only the authentication result/projection, never a resolver object whose
contents are implicitly trusted. The engine still rechecks content linkage, but it cannot replace
steps 1–8. The executable CLI oracle injects this authentication boundary, records its check trace,
and makes the old resolver-only seam throw; endpoint acceptance therefore requires the real router
and handler to cross the complete path. Its bind request is
`{record_ref, expected:{origin,task_id,attempt_id,candidate_id,transport,dispatch_key,input_hash,
request_hash,launch_claim_id,reservation_id,ticket_digest,launch_identity_digest,lineage}}`;
`expected` must be derived from the locked board attempt, not copied
from the evidence record. Missing or unequal expected context is a create-link failure.

## 5. Dedicated operation semantics

The current executable ccm command surface is:

```text
ccm task native-attempt-create <task-id> --selection @selection.json --attempt @attempt.json --replay-intent <accept-no-launch|require-new-launch> [--json]
ccm task native-attempt-bind <task-id> --attempt-id <id> --evidence-record-ref <owner-ref> [--json]
ccm task native-attempt-cancel <task-id> --attempt-id <id> --request @cancel.json [--acknowledgement-terminal-class <class>] [--json]
ccm task native-attempt-terminal <task-id> --attempt-id <id> --evidence-record-ref <owner-ref> [--requested-task-status <status>] [--json]
ccm task native-attempt-reconcile <task-id> --attempt-id <id> --evidence-record-ref <owner-ref> [--json]
```

These five verbs are dedicated ledger writers, not host-tool wrappers. `runProduction` always
resolves create authority and later evidence through the owner home; test-only injected boundaries
are overwritten at this composition root. The two optional negative-contract flags reject attempts
to treat a cancellation acknowledgement as terminal or to make native terminal evidence write task
`done`; they do not add alternate state transitions. `--json` selects the
operation-result output shape. While live dispatch is unsupported, create's
`launch_allowed:true` is the one-shot result for the exact committed identity/claim; the command
does not itself spawn, and no current host adapter consumes that result.

The pure engine endpoint is frozen as
`nativeAttemptApply(board, command) -> {ok, board, result?, issues?}`. It never mutates its input.
On any rejected command, `ok:false`, the returned board and input board are value-identical to the
pre-call board, and `issues[]` contains stable codes. The ccm handlers resolve/authenticate private
evidence before calling it, then commit the returned board through the existing locked write gate.
The executable contract oracle calls this endpoint and the real CLI router; symbol/registry existence
alone is not acceptance.

### 5.1 Create: `absent → starting`

Preconditions: enabled contracts; task `ready`; valid selected `host-native` Codex candidate; a
ccm-owner launch record carrying a committed, unexpired reservation/ticket and exact canonical
identity; no other `starting|running|uncertain` native attempt and no unfenced orphan; immutable full
selection, request hash, lineage, expected child, and parent authority;
account/worktree/session facts are known and mutually consistent.

The current account fingerprint must resolve as known+current, and the ccm-resolved permission
snapshot must prove a compatible profile plus every required deny. A known-but-different account,
an unknown account ref, an incompatible/unknown profile, or an omitted deny fails before append.

The writer stages the unique launch claim, atomically freezes the self-contained selection and
authority, appends `state:"starting"`, durably writes the board, commits the claim, and returns
`created:true, launch_allowed:true` exactly once to the private adapter workflow. It does not expose
the launch claim secret in public JSON, set `task.handle`, or move the
task to `in_flight`. An exact retry returns the same attempt with
`created:false, launch_allowed:false`. A changed request under the same dispatch key is
`NATIVE-ATTEMPT-REPLAY-CONFLICT`.

If the first response is lost, retry withholds launch. An exact retry may accept that result; a
retry explicitly demanding another launch permission is `NATIVE-LAUNCH-REPLAY-DENIED`. Safety wins
over convenience; the caller must reconcile the starting attempt and must not spawn again.

### 5.2 Bind: `starting → running`

Bind accepts only a ccm-authenticated owner-only evidence record whose origin session, parent,
expected child, account, workspace, worktree, baseline, candidate, attempt, dispatch, request, and
launch claim equal the create snapshot, and whose current permission snapshot/profile/effective
denies remain compatible with the create preflight. It atomically records a normalized `handle_binding`
containing the record ref/hash and producer ID, changes the attempt to `running`, projects the exact opaque
handle to `task.handle`, and changes `task.status: ready → in_flight`.

Exact replay is a no-op. A second/different record or handle, lineage drift, wrong child, another
active attempt, raw/free-form JSON, an unregistered producer, a bad signature/hash, or conflicting
evidence consumption is a hard conflict with zero partial writes. Bind timeout or ambiguous spawn
outcome changes the
attempt to `uncertain` through reconciliation; it never fabricates a handle and never auto-spawns a
replacement.

### 5.3 Cancel: request is not terminal

Cancel appends one immutable request `{id, request_hash, requested_at,
requested_by_session_ref, control, reason_code}`. For this surface the only canonical `control`
value is `"interrupt-agent"`; aliases and free-form spellings fail closed. The attempt remains
`running` while cancellation is requested because the worker may still be running or may race to success/failure. The first
request returns one host-control effect; an exact replay returns zero. A different request while one
is unresolved is a conflict and leaves the board byte-for-value unchanged.

For this selected surface, `interrupt_agent` interrupts the current turn but leaves the agent
addressable. Its acknowledgement alone cannot prove terminal cancellation. The adapter must record
the subsequent list/wait/final observation through the private evidence channel; no trustworthy
outcome projects the attempt/task to `uncertain` through reconcile.

### 5.4 Terminal: `running|uncertain → terminal`

Terminal consumes a ccm-verified evidence record containing closed
`class: succeeded|failed|cancelled|startup_failed`, strict UTC observation time, normalized result
ref, artifact refs, and an evidence hash. Exact replay is a no-op; conflicting terminal evidence is
immutable-history corruption and leaves the board unchanged.

For a running task, the writer atomically records terminal evidence, clears the active
`task.handle` projection, and moves `task.status: in_flight → uncertain`. It never writes `done`,
`verified`, or final acceptance. The
parent must read the result/artifacts, verify input/worktree hashes, run task acceptance, and then
choose true-done, failed, repair, replan, or a new append-only attempt.

A startup failure may be terminal only when trusted evidence proves no worker was created. An
ambiguous spawn/bind/crash is `uncertain`, not `startup_failed`.

### 5.5 Reconcile: the only repair/classification writer

`native-attempt-reconcile` consumes a ccm-authenticated evidence ref; callers do not choose a task
status or write an attempt state directly. It appends one immutable reconciliation record and
supports exactly these projections:

| Prior → observation | Attempt projection | Task projection |
| --- | --- | --- |
| `starting|running → uncertain` | append ambiguity/control-loss evidence; preserve any prior binding in history | `uncertain`, clear active `task.handle` |
| `uncertain → running` | only the same bound handle, create link, expected child, and current lineage may be re-proven | `in_flight`, re-project that exact handle |
| `uncertain → terminal` | append trusted terminal evidence; terminal becomes immutable | `uncertain`, handle absent, never `done` |
| `uncertain → orphaned` | require origin unavailable, handle unaddressable, and write authority fenced in an owner-only orphan audit | `ready|blocked`, handle absent; `reconcileGating` applies ordinary deps gating, a later explicit create is permitted only when ready, and automatic respawn remains false |

`orphaned` means the audit is complete enough to fence the old writer, not merely “the parent went
away.” The writer seeds `ready` only as input to ordinary `reconcileGating`; unmet deps produce
`blocked`, so orphan recovery never bypasses dependency gates. Missing fencing is
`NATIVE-ORPHAN-AUDIT-INCOMPLETE` and continues to block launch. Exact
reconcile replay is a no-op. A different record/classification for an already-applied reconciliation
is `NATIVE-RECONCILE-CONFLICT`; terminal and orphaned history cannot be rewritten. Generic setters,
`route-bind`, `--force`, and task status verbs cannot perform any of these projections.

## 6. State machine and idempotency

```text
absent ──create──> starting ──bind(real handle)──> running ──terminal──> terminal
                         │                            │
                         └─reconcile ambiguous──────> uncertain
                                                      ▲  │
running ──cancel request──> running ──reconcile unknown┘  ├─reconcile same handle──> running
                                                         ├─reconcile evidence────> terminal
                                                         └─fenced orphan audit───> orphaned
```

`terminal` and `orphaned` are immutable. At most one attempt may be
`starting|running|uncertain` for a task. An `uncertain` attempt blocks another launch until the
dedicated writer proves the same handle running, records terminal evidence, or completes a fenced
orphan audit. Merely labeling an attempt orphaned is not sufficient. No operation rewrites an
earlier attempt, selection snapshot, binding record, reconciliation record, or orphan audit.

| Operation | Idempotency key | Exact replay | Conflict |
| --- | --- | --- | --- |
| create | task + dispatch key + request hash | same attempt, no new launch permission | same key/different hash or active attempt |
| bind | attempt + signed evidence record hash | no-op | different handle/lineage/child/create link/evidence |
| cancel | attempt + cancel request ID/hash | no-op, no host effect | different unresolved request |
| terminal | attempt + terminal evidence hash | no-op | different class/result/evidence |
| reconcile | attempt + reconciliation evidence record hash | no-op | different classification/evidence or immutable target |

Ledger idempotency does not by itself prove provider idempotency. The implementation gate MUST
show a one-shot origin adapter path and duplicate-spawn=0 under response loss/crash, or keep native
dispatch unsupported.

## 7. Handoff and lineage

The v1 durability class is exactly `legacy_session_bound`:

- the handle is useful only while the originating Codex collaboration tree can list/wait/interrupt
  that target;
- a new harness session must not claim attach/resume/cancel from an ID string alone;
- handoff quiesces new native launches, performs a bounded drain, and records input/request,
  artifact, lineage, terminal, and evidence hashes;
- if the old session disappears before terminal proof, classify `uncertain`/`orphaned`, preserve the
  worktree and evidence, and do not respawn or release related authority automatically. Only a
  trusted orphan audit that fences the old write authority may close the attempt as `orphaned` and
  project the task to dependency-gated `ready|blocked`; unmet deps remain `blocked`, and the operation
  still performs no spawn.

`attach` and `durable_run_ref` are explicitly outside this contract. They require a supervisor or a
future host probe proving a cross-session native lease/control surface.

Account and worktree lineage are immutable across one attempt. Codex/Cursor account switching is
not supported and no native attempt verb may call login/logout/switch or write credential/config
state. If the current account fingerprint, origin session, workspace, worktree lease, or baseline
does not match the create snapshot, bind/control/terminal/reconcile-to-running projection fails
closed with zero board mutation. A trusted reconcile record may only classify the situation
`uncertain` until lineage is restored or orphan authority is fenced.

## 8. Error taxonomy

The following issue codes are frozen for fixtures and the implemented engine validator:

| Code | Meaning |
| --- | --- |
| `NATIVE-HANDLE-MISSING` | bind has no returned opaque handle |
| `NATIVE-HANDLE-UNATTESTED` | signed record lacks matching spawn and roster observations for the handle |
| `NATIVE-HANDLE-PARENT-SESSION` | parent/session/task identity was substituted for a child handle |
| `NATIVE-LINEAGE-MISMATCH` | session/account/workspace/worktree/baseline/parent differs from create |
| `NATIVE-EXPECTED-CHILD-MISMATCH` | observed canonical child differs from the create-frozen child target |
| `NATIVE-EVIDENCE-RECORD-MISSING` | evidence ref is absent or does not resolve in the owner-only store |
| `NATIVE-EVIDENCE-OWNER-STORE-PROVENANCE` | ref did not resolve from the configured owner-only ccm evidence store/scope |
| `NATIVE-EVIDENCE-CANONICAL-HASH-MISMATCH` | declared record hash differs from the frozen canonical payload hash |
| `NATIVE-EVIDENCE-SIGNATURE-INVALID` | Ed25519 signature does not verify over the declared record hash |
| `NATIVE-EVIDENCE-REGISTRATION-UNKNOWN` | producer registration is absent/revoked or does not identify the signed producer/key |
| `NATIVE-EVIDENCE-TRUST-SCOPE-MISMATCH` | registered origin/transport/session scope does not equal the attempt |
| `NATIVE-EVIDENCE-CLAIM-REUSED` | evidence consumption identity or its committed launch linkage conflicts with an existing owner record |
| `NATIVE-EVIDENCE-CALLER-VERIFICATION-FORBIDDEN` | caller/record supplied `verified_by_ccm` or equivalent certification |
| `NATIVE-EVIDENCE-UNTRUSTED-PRODUCER` | other private-channel/producer authentication failure not covered by the specific codes above |
| `NATIVE-EVIDENCE-CREATE-LINK-MISMATCH` | evidence task/attempt/candidate/dispatch/request/claim differs from create |
| `NATIVE-ACCOUNT-FINGERPRINT-UNKNOWN` | current/create/bind account fingerprint ref does not resolve in the trusted fact store |
| `NATIVE-ACCOUNT-FINGERPRINT-MISMATCH` | a known current/bind account fingerprint differs from the create snapshot |
| `NATIVE-PERMISSION-PROFILE-INCOMPATIBLE` | permission snapshot is unknown or profile is not equal/mechanically stricter than selected profile |
| `NATIVE-PERMISSION-DENY-INCOMPATIBLE` | effective deny set omits a candidate/task-required denial |
| `NATIVE-LAUNCH-AUTHORITY-MISSING` | create lacks the owner-store launch authority needed to stage a claim |
| `NATIVE-LAUNCH-AUTHORITY-INVALID` | reservation/ticket/identity is incomplete, expired, uncommitted, or mismatched |
| `NATIVE-LAUNCH-CLAIM-REUSED` | launch claim is already committed/staged for a different identity, or a stranded stage lacks matching durable board proof |
| `NATIVE-ATTEMPT-REPLAY-CONFLICT` | same idempotency key carries different immutable input |
| `NATIVE-ATTEMPT-ACTIVE` | another starting/running/unaudited uncertain attempt blocks create |
| `NATIVE-LAUNCH-REPLAY-DENIED` | replay attempted to obtain a second launch permission |
| `NATIVE-TERMINAL-DIRECT-DONE` | native terminal writer attempted task completion |
| `NATIVE-CANCEL-UNCONFIRMED` | interrupt acknowledgement was treated as terminal cancellation |
| `NATIVE-HANDOFF-UNSUPPORTED` | session-bound handle was claimed durable/attachable |
| `NATIVE-ROUTE-BIND-BYPASS` | legacy `route-bind`, generic setter/status writer, or `--force` attempted native projection |
| `NATIVE-ORPHAN-AUDIT-INCOMPLETE` | orphan classification lacks unavailable/unaddressable/fenced authority proof |
| `NATIVE-RECONCILE-CONFLICT` | replay changes reconciliation record/classification or rewrites terminal/orphaned history |

Errors identify code/path/reason but never echo raw handle response, account identity, credentials,
argv/env, transcript, or secret-shaped values.

## 9. Executable fixtures and verification gate

The executable oracle is:

- `ccm/packages/engine/test/fixtures/native-attempt/codex-api-tool-v1.json`;
- `ccm/packages/engine/test/fixtures/native-attempt/codex-api-tool-feature-probe-v1.json`;
- `ccm/packages/engine/test/native-attempt-contract.red.test.ts`;
- `ccm/packages/engine/test/native-attempt-r1-authority.red.test.ts`;
- `ccm/packages/engine/test/native-attempt-r1-causal.red.test.ts`;
- `ccm/apps/cli/test/handler-native-attempt.red.test.ts`;
- `ccm/apps/cli/test/native-attempt-production-r1.red.test.ts`.

The focused suites prove that the fixtures are coherent, the engine validator and five real CLI
handlers enforce the frozen state/security contract, and host-native live dispatch remains honestly
unsupported. Run:

```bash
cd ccm
pnpm --filter @ccm/engine build

pnpm --filter @ccm/engine exec node --test test/native-attempt-contract.red.test.ts test/native-attempt-r1-authority.red.test.ts test/native-attempt-r1-causal.red.test.ts

pnpm --filter ccm exec node --import tsx --test test/handler-native-attempt.red.test.ts test/native-attempt-production-r1.red.test.ts test/registry.test.ts
```

Both focused commands MUST pass today. The engine suite calls the implemented operation endpoint for
every positive/replay/conflict/mutation case and asserts returned board state plus failure atomicity.
The CLI suite calls the real router/handlers against a temporary board and owner evidence store,
including a `route-bind` bypass attempt; `registry.test.ts` pins the five command/flag registrations.
The suites also run deliberate counterfeits: a
no-op/fixture-lookup engine and registry-only verbs without handlers must be rejected by the same
observable-state requirements. Stubs, registry-only verbs, arbitrary handle acceptance,
caller-controlled `verified` fields, and fixture-specific special cases do not satisfy the gate.

The bind authentication fixture contains independent, fully materialized, precomputed records; it
does not mutate one signed positive record at test time. The default coherence oracle proves the
expected cryptographic property of each vector, while the opt-in CLI oracle sends its ref through
the real router/authentication/handler path and requires the frozen issue plus byte-identical board:

| Vector | Isolated property |
| --- | --- |
| `bind-owner-store-provenance` | valid canonical hash/signature/registration/scope/claim, wrong store provenance |
| `bind-bad-signature` | canonical hash correct, registered producer/scope correct, signature invalid |
| `bind-bad-canonical-hash` | signature valid over declared hash, canonical payload hash differs |
| `bind-unknown-registration` | canonical hash/signature valid under an unregistered key |
| `bind-wrong-trust-scope` | canonical hash/signature valid under a registered but wrong-session scope |
| `bind-reused-claim` | otherwise valid record, claim pre-bound to a different record hash |
| `bind-caller-verified-by-ccm` | otherwise valid signed record contains forbidden caller certification |

Account/permission endpoint coverage is also frozen as an engine+CLI matrix, not prose-only:

| Endpoint | Required negative cases |
| --- | --- |
| create | known-but-drifted account fingerprint; unknown account fingerprint; incompatible permission profile; missing `account-mutation` or task-required deny |
| bind | independently signed known-but-drifted account fingerprint; independently signed unknown account fingerprint; independently signed incompatible permission profile; independently signed missing required deny |

All eight account/permission rows and all seven authentication rows must return their specific
issue before board mutation. `reconcile_running` and
`reconcile_terminal`, like uncertain/orphaned, must each be invoked twice through both engine and
real CLI endpoint matrices; the second invocation must be an exact no-op with byte/value-identical
board state.

A future host-native live dispatch/spawn implementation may promote only after:

1. the existing spec → validator/transition tests → dedicated writers/private evidence chain remains
   green while a Codex origin adapter is added after those boundaries;
2. every negative issue above fails through engine and CLI endpoints with the board byte/value
   unchanged, while create/bind/cancel/terminal/reconcile exact replay and conflicting replay are
   exercised through those endpoints;
3. a sanitized opt-in native probe proves spawn response, handle corroboration, terminal race,
   interrupt semantics, account/worktree lineage, and zero account/credential mutation;
4. response-loss/crash replay proves duplicate spawn=0, or the adapter remains unsupported;
5. parent verification proves native terminal/reconcile never writes task `done`;
6. legacy boards and C1 `route-bind` retain their old, honestly weaker handle-claim semantics, but
   an opted-in native task rejects `route-bind` and generic/forced status projection;
7. unsupported Claude/Cursor/generic-Codex surfaces remain unsupported rather than inheriting this
   one surface's proof.

Rollback is contract disablement: stop new native creates, preserve append-only attempts/evidence,
and continue legacy origin orchestration. Disabling new launch is not permission to kill or erase an
active/uncertain worker.
