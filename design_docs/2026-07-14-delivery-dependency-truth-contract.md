# ccm delivery / dependency truth contract

Date: 2026-07-14 UTC

Status: **Accepted for declared-mode v1**

Scope: `@ccm/engine` board model、dependency qualification、task retry lifecycle、`ccm` CLI 与只读 read models。
Decision: [ADR-036](../adrs/ADR-036-declared-delivery-dependency-truth.md)

## 1. Purpose and rollout boundary

`done + verified + artifact` proves that a task's current candidate passed endpoint acceptance. It does not prove that the candidate is present in the baseline consumed by a downstream dependency. This contract separates those facts without changing the board narrow waist.

Declared-mode v1 is additive:

- boards without `delivery_contract` retain the existing `dependencySatisfied` behavior exactly;
- boards with `delivery_contract.mode="declared"` apply the new evaluator only to explicitly declared dependency requirements;
- undeclared edges on a declared board retain legacy behavior;
- strict evaluation exists only as a read-only dry-run/readiness report;
- no command in v1 may persist `mode:"strict"`, migrate a board automatically, or infer delivery from task names, branches, worktrees, URLs, or provider state.

Strict-default and any real board migration require a later user decision. This document does not authorize them.

## 2. Ubiquitous language

| Term | Definition |
|---|---|
| candidate | The immutable subject bound to the current accepted task attempt. |
| candidate-complete | `taskTrulyDone(task)`: `status=done && verified=true && artifact` is non-empty. |
| delivery target | A declared symbolic target plus the immutable snapshot observed locally. |
| target-delivered | The current candidate has locally re-verifiable delivery proof against the current target snapshot. |
| dependency requirement | A downstream-owned requirement for one `deps[]` edge, resolved by exact dep id before `*`. |
| dependency-qualified | A derived `qualified | unqualified | unknown` result; never a persisted boolean. |
| waiver | User-authorized, edge-scoped, expiring permission to consume without target delivery. It never makes `target_delivered` true. |

The evaluator returns:

```ts
type Qualification = {
  state: 'qualified' | 'unqualified' | 'unknown'
  basis: 'legacy' | 'candidate' | 'delivery' | 'waiver'
  reasons: Array<{ code: string; message: string }>
  candidate_complete: boolean
  target_delivered?: boolean
  target_id?: string
  observation_id?: string
  qualified_by?: 'legacy' | 'candidate' | 'delivery' | 'waiver'
}
```

## 3. Invariants

1. **Candidate truth remains the existing true-done predicate.** Delivery commands cannot set `status`, `verified`, `artifact`, or `review_verdict`.
2. **Explicit contract edges first require true-done.** A task that merely has `status=done` is not candidate-complete under candidate or delivered requirements.
3. **Review rejection wins.** If an upstream declares the existing review gate, only exact `review_verdict="APPROVE"` qualifies; missing, malformed, or `REQUEST-CHANGES` is fail-closed even when delivery evidence exists.
4. **Delivery evidence binds the current attempt.** The candidate fingerprint includes task id, current `finished_at`, current `artifact`, and the immutable subject.
5. **Retry/reactivation is an atomic attempt boundary.** Existing retry evidence and current `delivery` are archived together, then current delivery evidence is cleared. Prior observations never qualify the new attempt.
6. **Qualification is derived.** No `qualified:true` field is valid contract state.
7. **Target snapshots are immutable facts.** A symbolic git ref or artifact manifest is re-resolved locally. Drift makes old observations `unknown` until refresh/re-attestation establishes current facts.
8. **Branch/worktree presence is not proof.** They may locate a repository, but neither existence nor deletion affects an immutable containment/digest result.
9. **Waivers do not counterfeit delivery.** A live waiver yields `state=qualified`, `qualified_by=waiver`, and `target_delivered=false` with authority, reason, scope, and expiry exposed in human and JSON output.
10. **No implicit network.** Proof operations may use local git objects and local immutable files only. They must not fetch, call a provider/harness, read credentials, or depend on a daemon.
11. **Contract fields have dedicated writers.** Although the three roots remain flexible-tier fields, generic `--set` / `--set-json` cannot author or replace `delivery_contract`, `delivery`, or `dependency_requirements`; only the commands in §8 may write them and enforce proof, scope, and authorization.

## 4. Flexible board fields

All three roots are ✎ flexible for narrow-waist compatibility, but are reserved to dedicated domain writers rather than generic setters. `schema`, `goal`, `owner`, `git`, `tasks[{id,status,deps,parent}]`, the status enum, and hook behavior are unchanged.

### 4.1 Board `delivery_contract`

```json
{
  "delivery_contract": {
    "schema": "ccm/delivery-contract/v1",
    "mode": "declared",
    "targets": {
      "main": {
        "kind": "git-ref",
        "repository": { "source": "board.git.worktree" },
        "ref": "refs/remotes/origin/main",
        "snapshot": {
          "oid": "<40-or-64-hex-object-id>",
          "observed_at": "2026-07-14T00:00:00Z"
        }
      },
      "design-archive": {
        "kind": "artifact-set",
        "namespace": "file:/absolute/manifest.json",
        "snapshot": {
          "digest": "sha256:<64hex>",
          "observed_at": "2026-07-14T00:00:00Z"
        }
      }
    }
  }
}
```

Limits: at most 64 targets; target ids are `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; refs, namespaces, and local paths are bounded to 4096 UTF-8 bytes. `mode:"strict"` is reserved but rejected by declared-mode v1 writers and hard lint. Strict evaluation is an ephemeral override used only by audit/explain.

`repository.source="board.git.worktree"` reuses the current orchestration checkout as the local object store. A target may instead provide `repository.worktree` for an explicit local repository. Neither value is delivery evidence.

An `artifact-set` namespace points to a local immutable JSON manifest:

```json
{
  "schema": "ccm/artifact-set/v1",
  "entries": [
    {
      "logical_name": "decision-contract",
      "version": "2026-07-14",
      "ref": "file:/absolute/report.md",
      "digest": "sha256:<64hex>"
    }
  ]
}
```

The target snapshot digest is the SHA-256 of the exact manifest bytes. A manifest is limited to 1 MiB and 4096 entries.

### 4.2 Upstream task `delivery`

```json
{
  "delivery": {
    "schema": "ccm/task-delivery/v1",
    "candidate": {
      "fingerprint": "sha256:<64hex>",
      "bound_finished_at": "2026-07-14T07:23:51Z",
      "bound_artifact": "/absolute/final-review.md",
      "subject": {
        "kind": "git-commit",
        "commit_oid": "<oid>"
      }
    },
    "observations": [
      {
        "id": "D-<stable-id>",
        "target": "main",
        "candidate_fingerprint": "sha256:<64hex>",
        "target_snapshot": { "oid": "<oid>" },
        "outcome": "delivered",
        "proof": {
          "method": "git-commit-contained",
          "candidate_commit": "<oid>",
          "target_oid": "<oid>"
        },
        "checked_at": "2026-07-14T07:30:00Z"
      }
    ]
  }
}
```

Supported candidate subjects are:

- `git-commit`: exact immutable commit OID;
- `artifact`: immutable `ref`, `digest`, `logical_name`, and `version`.

Observations are append-only within the current attempt and capped at 128. Outcomes are `delivered | not-delivered | unknown`; waiver is never an observation outcome. The latest observation matching current candidate fingerprint and current target snapshot is authoritative.

### 4.3 Downstream task `dependency_requirements`

```json
{
  "dependency_requirements": {
    "*": { "level": "candidate" },
    "UPSTREAM": {
      "level": "delivered",
      "target": "main",
      "waiver_record": {
        "id": "W-<stable-id>",
        "authorized_by": "user",
        "authorized_at": "2026-07-14T08:00:00Z",
        "reason": "External receiver accepted an inaccessible target",
        "expires_at": "2026-07-21T00:00:00Z",
        "target": "main",
        "downstream": "DOWNSTREAM",
        "dependency": "UPSTREAM"
      }
    }
  }
}
```

Exact dependency id wins over `*`. Requirement keys other than `*` must appear in the downstream `deps[]`. At most 256 requirement entries are allowed. `level=candidate` has no target. `level=delivered` requires an existing target.

Waiver creation requires `--user-authorized`, a non-empty reason, an expiry strictly after authorization time, and exact downstream/dependency/target binding. There is no unscoped or non-expiring waiver in v1.

## 5. Qualification algorithm

For downstream `D` and upstream `U`:

1. If `delivery_contract` is absent, return the exact legacy `dependencySatisfied(U)` result.
2. Resolve `D.dependency_requirements[U.id]`, else `D.dependency_requirements["*"]`.
3. If no requirement exists in declared mode, return exact legacy behavior. Under ephemeral strict evaluation, return `unknown(DEPENDENCY_REQUIREMENT_MISSING)`.
4. Require `taskTrulyDone(U)`. Then apply the existing review gate. A negative or malformed review gate returns `unqualified(DELIVERY_REVIEW_REJECTED)`.
5. `level=candidate` returns `qualified(candidate)`.
6. A live, exactly scoped, user-authorized waiver returns `qualified(waiver)` and `target_delivered=false`.
7. `level=delivered` resolves the target and current candidate observation. Missing/malformed/unverifiable facts return `unknown`; a verified negative containment or digest mismatch returns `unqualified`; a verified proof returns `qualified(delivery)`.

`readySet`, `reconcileGating`, dependency lint, dependency explain, status report, and web-viewer read models consume this one evaluator. Only `qualified` satisfies an explicit edge.

## 6. Proof methods

### 6.1 Local git exact containment

`git-commit-contained` resolves the declared ref locally, verifies both objects exist, and runs exact ancestor containment against the stored target snapshot. A contained candidate commit is delivered. A readable non-ancestor is not delivered. A missing/GC'd candidate object is unknown. No command may run `fetch`, `pull`, contact a remote, or use a branch/worktree's existence as proof.

### 6.2 Reviewed reconciliation containment

`reviewed-reconciliation-contained` is accepted only when:

- the integration commit exists locally and is contained in the target snapshot;
- a local attestation file is at most 1 MiB and has schema `ccm/delivery-review-attestation/v1`;
- it records `verdict:"APPROVE"` and exactly binds current candidate fingerprint, target id, target snapshot OID, integration commit OID, and reviewed base OID;
- the proof observation stores both the attestation's absolute local path (`attestation_ref`) and SHA-256 digest of its exact bytes.

Every later qualification reopens the bounded attestation file, verifies its digest, parses its verdict, and rechecks the full binding. An unavailable or mutated file is `unknown`/fail-closed. A stale review against another candidate, integration commit, or target snapshot is likewise unknown; `REQUEST-CHANGES` is unqualified. Stable patch-id alone is never sufficient proof.

### 6.3 Non-git immutable artifact

`artifact-digest-contained` requires the current artifact subject's exact logical name, version, ref, and digest to appear in the locally verified artifact-set manifest whose bytes match the target snapshot digest. Missing files are unknown; readable digest mismatch is unqualified.

## 7. Lifecycle

- `task attest-delivery` is legal only for a candidate-complete task and cannot modify completion fields.
- `done -> stale` may legally retain the prior attempt's exactly bound delivery evidence for audit, but immediately makes every explicit edge unqualified because candidate-complete is false.
- every `stale | failed | escalated -> ready` retry/reactivation archives `delivery` inside the existing `ccm/task-retry/v1` prior evidence and removes the current field atomically.
- target refresh updates the target snapshot and appends revalidation observations for current candidates. A failed exact-git or artifact revalidation records an honest negative/unknown observation without erasing the originating proof method, so a later refresh can retry it and recover to delivered when local facts change. Reviewed reconciliation always requires a fresh attestation bound to the new snapshot. Refresh then runs ordinary ready/blocked reconciliation.
- ready children may become blocked; active or completed children are never silently transitioned. Lint/read models emit `BIZ-DELIVERY-IMPACT` with the affected status for human action.

## 8. CLI contract

Declared-mode v1 provides:

```text
ccm target set|show|refresh
ccm delivery check
ccm delivery audit --strict-dry-run
ccm task attest-delivery
ccm dependency require|default|explain|waive
```

The CLI registry is noun+verb, so the design phrase “delivery target set/show/refresh” maps to the
equivalent top-level `target` noun instead of introducing a third command level. Domain ownership and
the persisted contract are unchanged.

All mutating commands support the existing board selection, lock, atomic write, `--dry-run`, human, and `--json` conventions. Proof failure cannot be bypassed with `--force`.

Generic `board update --set-json` and `task add|update --set-json` reject every path rooted at board `delivery_contract` or task `delivery` / `dependency_requirements` with exit 3. This prevents raw JSON from bypassing local proof, candidate fingerprint recomputation, dependency-edge scope, or `--user-authorized` waiver admission.

Exit semantics reuse existing codes: `0` success/readable blocked result, `2` usage or illegal method, `3` validation/proof requirement failure, `4` lock timeout, `5` board/task/target not found, `7` missing user authorization. JSON and human forms carry the same stable diagnostic codes.

## 9. Lint and compatibility

The engine registers:

- `FMT-DELIVERY-CONTRACT` hard when present;
- `FMT-TASK-DELIVERY` hard when present;
- `FMT-DEPENDENCY-REQUIREMENTS` hard when present;
- `BIZ-DELIVERY-CANDIDATE-BINDING` hard;
- `BIZ-DEPENDENCY-REQUIREMENT` warn for stale non-dep keys; malformed declarations are covered by the hard `FMT-DEPENDENCY-REQUIREMENTS` rule;
- `BIZ-DELIVERY-PROOF` warn for unknown/not-delivered/drift;
- `BIZ-DELIVERY-IMPACT` warn for active/completed downstream impact.

Proof/business failure is not a hard board-write lint by itself: recording an honest rollback or drift must remain writable. Shape, binding, authority, and cap violations are hard.

Malformed contracts fail closed where explicitly consumed. Cycles, dangling dependencies, parent depth, status enum, review gate, and all legacy rules remain unchanged.

## 10. Acceptance

The implementation is accepted only with RED→GREEN evidence for:

- byte/semantic legacy parity, including review `APPROVE` and `REQUEST-CHANGES`;
- declared candidate/delivered/undeclared edges and mixed multi-dependency graphs;
- stranded native-attempt and synthetic-supervisor fixtures blocked while exact, contract-only, and reviewed/hardened deliveries qualify to their declared scope;
- target drift, missing git objects, review rejection/stale binding, retry reset, artifact digest match/mismatch, waiver authority/scope/expiry;
- malformed/cyclic/unknown/cap inputs, dry-run no mutation, lock concurrency, and a proof runner that has no network/fetch path;
- engine/CLI/read-model/document/projection parity.

Strict-default activation, provider/harness calls, real board migration, automatic fetch, daemon dependence, push/PR/merge/release, and credential/account mutation are explicitly outside this slice.
