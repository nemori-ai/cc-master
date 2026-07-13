# Cross-harness three-origin cached context delivery v1

> Status: C1 implementation contract
> Date: 2026-07-13
> Effect floor: `c1-three-origin-context-equivalence-v1`
> Scope: one frozen board + one cached machine revision -> bounded agent-visible context on Claude
> Code, Codex, and Cursor origins
> Non-scope: collector refresh, provider/model request, reservation, attempt, spawn, account mutation,
> credential discovery, board write, or live dispatch

## 1. Contract boundary

`ccm` is the only semantic owner. It consumes the existing `ccm/orchestrator-context/v1` and the
same board revision, runs the already-approved pure shadow evaluator for eligible `ready` tasks,
and emits `ccm/origin-context-delivery/v1`. Origin adapters may only map that delivery to a
host-native envelope and suppress an unchanged delivery hash. They must not recompute freshness,
eligibility, utility, candidate order, reason codes, or route selection.

The input cache is the fixed, local, atomically published file
`<CC_MASTER_HOME>/cache/machine-context-cache.json`. Hooks never refresh it. Missing, malformed,
stale, or unknown facts remain explicit cached data and cannot authorize dispatch. The delivery is
shadow-only: `dispatch_enabled:false` and no reservation/attempt/process side effect exists.

## 2. Agent-visible schema and budget

`ccm orchestrator context --cached-only --agent-visible ... --json` returns:

```json
{
  "schema": "ccm/origin-context-delivery/v1",
  "cached_only": true,
  "shadow_only": true,
  "dispatch_enabled": false,
  "origin_harness": "codex",
  "revisions": { "board": "sha256:...", "machine": "machine-r17" },
  "content_sha256": "sha256:...",
  "content_bytes": 2048,
  "content": "<ambient source=\"orchestrator-context\">..."
}
```

The embedded payload uses `ccm/origin-context/v1` and contains only:

- cached availability, board/machine revision, freshness state, and bounded validity time;
- contract activation and the hard facts `shadow_only:true`, `dispatch_enabled:false`;
- candidate id/harness/surface plus availability/quota/auth/model/runtime and qualification
  predicate/status;
- at most 12 board-order `ready` route summaries: task id/status, eligibility, descriptive outcome,
  selected candidate id/harness/surface, and stable reason codes;
- safe machine-readable warning codes and explicit truncation counters.

Qualification refs, absolute or relative paths, identity, balance, argv/env, provider raw response,
credential/token/email, model prompt, transcript, and arbitrary warning prose are excluded. The
whole ambient string, not merely its inner JSON, is at most 4096 UTF-8 bytes. Bounding removes
warnings, then tail route summaries, then whole tail candidates; it never partially truncates a
load-bearing fact. Omission can only reduce information and never creates eligibility.

The delivery hash covers the exact ambient content. The agent payload omits `as_of`; therefore
routine calls remain stable inside one freshness state, while a board revision, machine revision,
freshness boundary, candidate fact, or route judgment change produces a new hash.

## 3. Origin timing and declared divergence

| Origin | Initial/resume delivery | Mid-turn decision delta | Honest degradation |
| --- | --- | --- | --- |
| Claude Code | `SessionStart(startup|resume|compact)` additional context | `PostToolBatch`, only when delivery hash changes | no matching active board or local timeout -> silent RC0 |
| Codex | verified `SessionStart` system/additional context substrate | no fake PostToolBatch; next SessionStart / durable inbox is the floor | no equivalent batch event is declared, not simulated |
| Cursor IDE | no dynamic SessionStart registration (D4 is a confirmed drop bug) | verified `postToolUse.additional_context`, first delivery then hash deltas only | before first tool, static alwaysApply role substrate + on-demand ccm read; no full reinject claim |

All three parse one ccm-owned delivery schema. Semantic equivalence keeps the frozen board, cached
candidate facts, candidate order, policy, revisions, authority, headroom, and non-origin-dependent
eligibility/reason codes identical. A `host-native` candidate is origin-local by definition, so its
eligibility may differ only by the mechanical `host-native-origin-mismatch` reason, and selection may
resolve to the corresponding origin-local native candidate. After normalizing `origin_harness`,
descriptive `same-*` versus `other-harness-cli` outcomes, and an eligible origin-local native
candidate to the `origin-native` equivalence class, the route judgment must be identical. CLI
candidates—including same-harness CLI—remain common candidates and must retain identical
eligibility/reasons/order across origins; the origin adapter may not create any additional
difference.

## 4. Failure matrix

| Failure | Hook result | Agent-visible truth | Forbidden behavior |
| --- | --- | --- | --- |
| no matching active board / ambiguous board | RC0, empty stdout | none | guessing a board or reading another session |
| cache missing | RC0, bounded `available:false` once per delivery state | machine revision `unknown`, warning code | refresh/probe/network |
| cache malformed / secret-shaped | RC0, bounded `available:false` or empty | never echoes parse input | raw error, credential/value echo |
| stale / not-yet-observed cache | RC0, explicit freshness | route summaries ineligible/no-route | treating stale/unknown as pass |
| ccm absent, nonzero, malformed, slow, or timed out | RC0, empty stdout | none | blocking the harness or falling back to a collector |
| sidecar read/write failure | RC0; delivery remains fail-open | ccm truth unchanged | board write or using sidecar as authority |
| unchanged hash on delta event | RC0, empty stdout | already delivered | routine telemetry spam/new Cursor round |
| host lacks an event | declared Track B substitute | same ccm truth at the next supported timing | nearest-event fake parity |

## 5. Acceptance oracle

1. One frozen board/cache fixture projected for all three origins has identical authority,
   revisions, cached candidate facts/order, policy-derived CLI eligibility/reasons, and route
   judgment after normalizing origin-descriptive labels plus the origin-local native equivalence
   class. An all-native fixture selects each origin's own eligible native candidate; common CLI,
   rejected-native, origin-stay, and no-route fixtures remain equal under the same rule.
2. Same-harness CLI remains `cli-headless`; it is never folded into host-native.
3. Ambient payload and each host-native context field are at most 4096 UTF-8 bytes and contain no
   ref/path/credential/private-shaped data.
4. Claude SessionStart + PostToolBatch, Codex SessionStart, and Cursor postToolUse return RC0; delta
   delivery is revision-hash deduplicated.
5. Cursor hooks contain no SessionStart dynamic-context registration. Claude/Codex/Cursor envelope
   differences are tested as one semantic equivalence class.
6. A sleeping fake collector, provider/network/process/account spies, missing/corrupt cache, and a
   malicious correctly hashed fake ccm output produce zero forbidden calls and never leak data.
   Origin adapters accept only the exact allowlisted `ccm/origin-context/v1` structure and reject
   unknown nested fields or private-shaped values without echoing them.
7. Existing raw `ccm/orchestrator-context/v1` and `ccm route advise` behavior remains unchanged;
   `--agent-visible` is additive and shadow-only.

## 6. Rollback

Removing the per-host registration or setting the hook-injection kill switch disables delivery and
returns to legacy origin-only orchestration. No board migration, reservation cleanup, process
cleanup, or provider rollback is required because this contract creates no authoritative runtime
state; the dedupe sidecar is disposable.
