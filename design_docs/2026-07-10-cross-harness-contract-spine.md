# Cross-harness contract spine v1

> Status: **Accepted implementation contract for C1/S0**
> Date: 2026-07-10
> Scope: additive board contracts, route candidate/selection/running-attempt invariants, dedicated ccm writers, and legacy activation
> Direction source: [`cross-harness-orchestration-capability-model.md`](cross-harness-orchestration-capability-model.md) §§4, 6, 12 and the user-approved A–F package

## 1. Boundary and non-goals

This slice adds the smallest contract needed by later shadow routing and run management. It does not probe a harness, reserve quota, spawn a worker, rank a provider/model, or claim that a supplied handle is durable. The contract is provider-neutral and preserves:

- `schema: "cc-master/v2"` and the existing board narrow waist;
- the existing `executor` enum and `executor: "subagent"` meaning;
- every board without explicit contract activation as a legacy board;
- default-deny real cross-harness dispatch and zero credential/account mutation.

The new fields are flexible, hook-blind edges with stricter writer policy. Flexible does not mean freely replaceable: `planning`, `routing`, `routing.selected`, and `routing.attempts` are structured state with dedicated writers.

## 2. Activation and migration

A board is contract-enabled only when both entries are present with the exact values below:

```json
{
  "meta": {
    "contracts": {
      "task_planning": "ccm/task-planning/v1",
      "agent_routing": "ccm/agent-routing/v1",
      "agent_routing_activated_at": "2026-07-10T08:00:00Z",
      "agent_routing_grandfathered_terminal": [
        { "task_id": "HIST-1", "created_at": "2026-07-01T08:00:00Z" }
      ]
    }
  }
}
```

Partial or wrong-valued activation is invalid. Unknown additional contract keys are preserved for forward extension. Missing `meta.contracts` means legacy mode and does not trigger any new hard gate.

`ccm board enable-contract --preflight` is read-only and reports every non-terminal `executor=subagent` task that cannot survive activation. Historical terminal tasks (`done|failed|escalated`) are explicitly grandfathered and listed in the report; activation never asks an operator to invent planning/routing evidence after the work ended. `ccm board enable-contract` writes both entries, an immutable activation timestamp, and the exact `{task_id,created_at}` fingerprints of those terminal tasks atomically only when preflight is clean. The exemption applies only while the same fingerprint remains in a terminal status. `failed`/`escalated` moving back to `ready`, or `done` moving through `stale` to `ready`, immediately loses the exemption and must satisfy the new contract before any routed start. Deleting/recreating the same ID also gets a new `created_at` and cannot inherit the old exemption. It never rewrites, deletes, or guesses existing task data. Operators backfill active/future tasks via the dedicated task writers, then retry activation. This is an additive migration; no board v3 and no eager home rewrite exists.

## 3. Planning contract

`task.planning` has this minimum form:

```json
{
  "schema": "ccm/task-planning/v1",
  "assessed_at": "2026-07-10T08:00:00Z",
  "assessor": "master-orchestrator",
  "dimensions": {
    "reasoning": "novel",
    "uncertainty": "medium",
    "risk": "high",
    "scope": "cross-module",
    "context": "large",
    "coordination": "single-boundary",
    "reversibility": "costly"
  },
  "estimate_confidence": "medium",
  "quality": {
    "effect_floor": "meets-required-capabilities"
  },
  "budget": {
    "posture": "ample",
    "max_attempts": 3
  },
  "capabilities": {
    "required": [{ "id": "structured-output" }],
    "preferred": [],
    "forbidden": [{ "id": "push-remote" }]
  },
  "rationale": "Optional human-readable judgment."
}
```

All seven dimensions are required and independently enumerated. Capability IDs and `quality.effect_floor` are open, non-empty strings. IDs are unique within a list and may not overlap across required/preferred/forbidden. `required` is non-empty. `budget.posture` is `ample|tight`; it chooses the initial policy chain without claiming that the target pool itself is healthy, and `max_attempts` is a positive integer. A contract-enabled routed task also carries a positive existing `task.estimate` `{value,unit}` so planning confidence is anchored to a concrete estimate rather than a free-floating label. Models, providers, harnesses, quota state, prices, and dynamic eligibility evidence do not belong in planning.

The schema is versioned and may add optional dimensions or constraints in a future contract revision. Unknown fields are preserved, but this v1 validator never infers a model/provider preference from them. Duration confidence intervals, data-classification envelopes, and restart/escalation detail are intentionally deferred to a later compatible revision; existing task `acceptance`, `estimate`, and `references` remain their C1 anchors.

The only whole-object writer is:

```text
ccm task set-planning <task-id> --profile @/absolute/planning.json
```

## 4. Routing policy and candidate domain

`task.routing` is written initially as:

```json
{
  "schema": "ccm/agent-routing/v1",
  "mode": "cross-harness",
  "policy": {
    "objective": "balanced",
    "constraints": {
      "effect_floor": "meets-required-capabilities",
      "quota_unknown": "ineligible",
      "cross_harness_quota_admission": "ample-only"
    },
    "candidates": [],
    "chains": { "ample": [], "tight": [] },
    "fallback": {
      "on": [],
      "never_on": ["policy-blocked", "permission-blocked", "workspace-mismatch", "acceptance-failed"],
      "exhaustion": "fail-closed",
      "same_harness": "explicit-candidate-only"
    }
  },
  "selected": null,
  "attempts": []
}
```

Every candidate has unique non-empty `id`, `surface`, `adapter`, `harness`, `provider`, `model`, `effort`, plus:

- `capabilities[]`: open capability IDs the candidate can supply;
- `effect_floors_met[]`: open effect-floor IDs this candidate is eligible to satisfy;
- `permission: {profile, denies[]}`: the mechanically compiled permission profile and denied capabilities/side effects;
- `account_mutation: "forbidden"`;
- a non-empty unique `requires[]`, which must include `capability-match`, `effect-floor`, `permission-compatible`, and `account-mutation-forbidden` in addition to any runtime/auth/quota predicates.

`surface` is exactly `host-native` or `cli-headless`; model IDs remain open strings, but `auto` is forbidden. For every candidate, planning `required` must be a subset of candidate capabilities, the planning effect floor must appear in `effect_floors_met`, and every planning `forbidden` ID plus `account-mutation` must appear in `permission.denies`. These are set constraints, not independent field-presence checks. Each chain contains unique existing candidate IDs. Both `ample` and `tight` chains are explicit model/effort fallback orders; each candidate carries its own full identity and qualification requirements. Same-harness CLI is never folded into host-native and receives no implicit fallback. Harness brand and “crossness” have no score or preference in this contract.

`fallback.on` is restricted to the versioned mechanical failure allowlist (`binary-unavailable`, `auth-expired`, `model-unavailable`, `model-mismatch`, `quota-tight`, `rate-limited`, `startup-timeout`, `transport-error`). `fallback.never_on` must include policy, permission, security/workspace, task/business, and acceptance failures. The two sets may not overlap. This makes fallback a recovery mechanism, never an authority bypass. New provider-specific failure classes require a contract revision or an explicit mapping to an existing generic class; brand strings never become failure policy.

Golden route outcomes use the same candidate representation for:

- origin `host-native` candidate;
- origin-matching `cli-headless` candidate;
- other-harness `cli-headless` candidate;
- origin-stay, represented by choosing an explicit origin-native candidate because no CLI candidate clears the caller's objective;
- no-route, represented by no selection and no attempt.

The policy-only writer is:

```text
ccm task set-routing <task-id> --policy @/absolute/routing.json
```

The input is the `policy` object (objective/constraints/candidates/chains/fallback); the writer constructs the versioned routing envelope with `selected:null` and `attempts:[]`. It cannot overwrite an existing attempt history.

## 5. Selection and running attempt bind

The first state-changing route writer is:

```text
ccm task route-bind <task-id> \
  --selection @/absolute/selection.json \
  --attempt @/absolute/attempt.json
```

It is a record/bind operation after an origin adapter or future supervisor supplies a non-empty opaque **handle claim**. It does not launch or probe anything. C1 proves only syntactic non-emptiness, atomic ownership, and projection consistency; it does **not** call that claim a real/live/durable handle. Real-handle proof requires a trusted native lease or supervisor attestation and remains deferred to C2.

Selection must contain:

- `candidate_id` present in its declared `chain` (`ample` or `tight`);
- strict UTC `selected_at`;
- evidence with strict UTC `observed_at` and `valid_until`, where `observed_at <= selected_at <= valid_until`;
- one `qualification_results[]` entry for every candidate `requires[]` predicate, all with `status: "pass"`;
- non-empty `reason_codes[]`; optional rationale and snapshot/revision refs.

The attempt input must contain a unique `id`, matching `candidate_id`, `state: "running"`, a strict UTC `started_at`, and a non-empty `handle` claim. Its requested model/effort, when supplied, must match the candidate. The dedicated writer copies the entire selection—including qualification evidence, chain, reason codes, and rationale—into immutable `attempt.selection_snapshot`. The bind atomically:

1. writes `routing.selected`;
2. appends the running attempt (never replaces history);
3. projects `task.handle = attempt.handle`;
4. transitions `ready -> in_flight` and stamps `started_at`.

For legacy migration only, an already-`in_flight` task may be bound without changing its status; it must still pass the same planning/routing/selection/attempt checks. Updating `routing.selected` later never changes an earlier attempt snapshot, so fallback cannot erase the audit reason for a prior attempt.

No generic setter, `task update`, `task start`, `task set-status`, `task add --status in_flight`, or `--force` may create this state. `--force` may bypass ordinary lint/transition policy, but never the routed-start mutation gate. Until a trusted attestation producer lands, this is called the **handle-claim gate**, not the real-handle gate.

## 6. Conditional invariants

When both contracts are enabled, every `executor=subagent` task:

- must have valid planning and a valid routing policy before activation succeeds;
- if `status=in_flight`, must additionally have a valid selection and exactly one running attempt;
- must have `task.handle` equal to that running attempt handle;
- must have the running attempt candidate and immutable selection snapshot equal to the selected projection;
- must mechanically prove required capability/effect floor/permission denies/account-mutation constraints through the selected candidate and passing qualification evidence.

Format findings are warnings while a legacy board is being prepared. Contract-enabled violations are hard. A terminal provider/attempt state is not task completion and is outside this slice.

## 7. Writer policy

The engine exposes writer policy independently from field tier:

| Path | Policy |
| --- | --- |
| `board.meta.contracts` | dedicated |
| `task.planning` | dedicated |
| `task.routing` / `task.routing.policy` / `task.routing.selected` | dedicated |
| `task.routing.attempts` | append-only |

The generic `--set` and `--set-json` paths reject these roots before write/lint and cannot be restored by `--force`. Board lint remains a backstop for externally corrupted JSON, not the authority for constructing valid routed state.

## 8. Failure and rollback

Validation errors are fail-closed and identify the missing/invalid contract segment. No-route is data, not an exception and never spawns. Disabling use of the feature means not enabling contracts on more boards; legacy boards continue unchanged. Contract fields may remain on a board without activation and are ignored by legacy state transitions, allowing rollback without destructive migration.

## 9. Test oracle

The acceptance suite must prove:

1. the complete legacy board corpus still lints and mutates as before;
2. activation preflight is read-only and activation is all-or-nothing;
3. generic setters reject every dedicated/append-only root, including with `--force`;
4. routed tasks cannot enter `in_flight` via start/set-status/add, including with `--force`;
5. route-bind rejects missing/stale/unqualified/mismatched/duplicate/no-handle records;
6. four route outcome fixtures plus no-route validate without provider/network/process activity.
