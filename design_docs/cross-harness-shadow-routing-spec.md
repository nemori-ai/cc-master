# Cross-harness cached context and shadow route contract v1

> Status: C1 implementation contract
> Date: 2026-07-13
> Scope: frozen machine facts -> cached orchestrator context -> pure shadow route advice
> Non-scope: provider probe, model request, reservation, launch, process management, board mutation, account mutation

## 1. Boundary

This slice is advisory and read-only. It consumes a caller-supplied cached machine snapshot and an
already-planned task. It never refreshes the snapshot, probes a provider, resolves credentials,
reserves quota, launches a process, or writes the board. `spawned` is therefore always `false`.

The contract is provider-neutral. Harness identity and whether a candidate is same-harness or
cross-harness are descriptive outcome facts, never utility inputs. `host-native` and
`cli-headless` remain distinct candidates even when their `harness` values match the origin.

## 2. Cached machine snapshot

The input schema is `ccm/machine-context-cache/v1`:

```json
{
  "schema": "ccm/machine-context-cache/v1",
  "revision": "machine-r17",
  "board_revision": "board-r8",
  "observed_at": "2026-07-13T03:00:00Z",
  "valid_until": "2026-07-13T03:10:00Z",
  "candidates": [
    {
      "candidate_id": "codex-cli",
      "harness": "codex",
      "surface": "cli-headless",
      "availability": "available",
      "quota": "ample",
      "auth": "authenticated",
      "model": "available",
      "runtime": "healthy",
      "qualifications": [
        { "predicate": "runtime-healthy", "status": "pass", "ref": "cache://runtime/codex" }
      ]
    }
  ],
  "warnings": []
}
```

`revision` is an opaque immutable cache revision. Times are strict UTC and must satisfy
`observed_at <= valid_until`. Candidate IDs are unique. `availability` is
`available|unavailable|unknown`; quota is `ample|tight|exhausted|unknown`; qualification status is
`pass|fail|unknown`. Auth (`authenticated|unauthenticated|expired|unknown`), model
(`available|unavailable|unknown`), and runtime (`healthy|unhealthy|unknown`) are independent facts;
none is inferred from aggregate availability. Unknown is data and is never inferred to pass.
Candidate harness/surface must match the routing-policy candidate with the same ID; a mismatch is
ineligible, not silently normalized.

The cache carries no credential, identity, token, argv, environment, transcript, balance, or
provider raw response. Producers remain responsible for redaction before atomic cache publication,
but the public boundary also recursively rejects secret/private-shaped keys and high-signal
credential/token-shaped values without echoing them. Value detection covers `sk-` tokens, GitHub
tokens, bearer values, JWTs, and explicit API-key/credential assignments while allowing ordinary operational prose
such as “token budget”, “API key is not configured”, or “credential: unavailable”. The
agent-visible projection is built from an explicit candidate/qualification allowlist; unknown benign
extension fields are stripped rather than cloned.

## 3. Cached orchestrator context

`ccm orchestrator context --cached-only --snapshot @<file> --as-of <UTC> --json` emits
`ccm/orchestrator-context/v1`. `--cached-only` is mandatory; there is no live fallback. The result
contains the origin, board and machine revisions, freshness (`fresh|stale|unknown`), normalized
candidate facts, warnings, and `cached_only:true`.

Missing or malformed cache returns exit 0 with `available:false`, `freshness.state:"unknown"`, and a
machine-readable warning; it is never refreshed. Every timestamp must be exact canonical UTC at
second precision and round-trip to the same calendar instant; impossible dates and invalid leap days
are rejected rather than normalized by the runtime. A cache is fresh only while
`observed_at <= as_of <= valid_until`; before observation it is unknown and after validity it is
stale. Neither can qualify a route. The public state must agree with all three timestamps, and route
advice recomputes freshness at its own `--as-of`; replay after expiry therefore fails closed even if
the context was originally fresh. `available:false` is independently load-bearing and cannot
qualify. The board revision is a SHA-256 of recursively key-sorted canonical parsed JSON, not raw
bytes, insertion-order `JSON.stringify`, or a manually writable board field.

The serialized `ccm/orchestrator-context/v1` projection is deterministically bounded to 4096 UTF-8
bytes. Revisions, freshness, availability, and complete included candidate facts are never
partially truncated. Long warning/ref strings are shortened first, then tail warnings and whole
tail candidates are omitted until the bound holds. `truncation.{applied,omitted_candidates,
omitted_warnings,shortened_fields,max_bytes}` makes every loss explicit; omitted candidate facts can
only reduce eligibility.

## 4. Pure shadow advice

`ccm route advise <task-id> --context @<file> --origin <harness> --as-of <UTC> --json` reads the
board and context, validates `task.planning` and `task.routing`, then evaluates the explicit chain
chosen by `planning.budget.posture`.

For every candidate, the engine derives the four contract predicates
`capability-match`, `effect-floor`, `permission-compatible`, and
`account-mutation-forbidden` from the accepted planning/routing contract. Every other declared
`candidate.requires[]` predicate must have exactly one cached qualification row. Missing rows become
`unknown`; duplicate rows or harness/surface mismatches reject the input contract.
`runtime-healthy` is cached evidence, not an optimistic derived override: fail/unknown/missing stays
fail/unknown, while a row contradicting the independent runtime fact rejects the snapshot.

The context origin must equal the advice origin; a caller cannot relabel Codex-captured context as a
Cursor/Claude origin. Eligibility additionally requires:

- fresh context and matching non-unknown board revision;
- `availability=available`;
- `auth=authenticated`, `model=available`, and `runtime=healthy`;
- quota not `unknown` or `exhausted`;
- every `cli-headless` candidate has `quota=ample`, including same-harness CLI;
- every declared qualification is `pass`.

The advisory selects the first eligible candidate in the explicit chain. The chain is master policy;
the engine does not add brand/crossness weights. If an origin-native candidate is selected after an
earlier CLI candidate was rejected, the outcome is `origin-stay`; otherwise the existing outcomes
`same-native`, `same-harness-cli`, `other-harness-cli`, and `no-route` apply. The output includes
candidate evaluations, stable reason codes, qualification evidence, sensitivity (eligible
alternatives and rejected candidates before the selection), input revisions, warnings, and
`spawned:false`.

No-route is successful advisory data: `eligible:false`, `selected:null`, `outcome:"no-route"`, and
stable rejection reasons. It is never an exception and never starts an attempt.

## 5. Safety and rollback

- Both commands are `read:true` and use the board read pipeline only.
- The engine module imports no fs/network/process/credential API.
- The CLI handler is created through a deny-by-default composition boundary. Its only admitted
  effects are one selected-board read and one explicit snapshot/context read; process, network,
  credential, reservation, attempt, board-write, and arbitrary-file-write capabilities throw if
  called. Endpoint tests inject spies and assert the exact read trace plus zero forbidden effects
  over same-native, same-harness CLI, other-harness CLI, origin-stay, and no-route.
- Codex and Cursor account mutation remains forbidden; this slice contains no login/logout/switch
  path.
- Disabling or omitting these commands leaves legacy origin orchestration unchanged. No migration or
  cleanup is needed because the slice creates no durable state.

## 6. Acceptance oracle

Under frozen revisions, golden tests must replay:

1. Codex origin -> Codex host-native (`same-native`);
2. Codex origin -> Codex CLI (`same-harness-cli`, never collapsed into native);
3. Cursor/Claude origin -> Codex CLI (`other-harness-cli`);
4. an earlier CLI rejection -> origin-native (`origin-stay`);
5. no eligible candidate -> `no-route`.

Changing only the origin label may change the descriptive same/other outcome but never eligibility or
chain order. Unknown/stale/mismatched revisions remain visible and ineligible. Handler tests compare
board bytes before/after and source guards reject process/network/provider imports.
