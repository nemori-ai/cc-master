# ADR-026 — done 真语义 hard gate：`done` 必带 verified + artifact

> Status: **Accepted**
> Date: 2026-07-06
> Scope: `@ccm/engine` board-model / board-lint-core / CLI 写入关卡消费方；`using-ccm` 操作文档同步。明确不扩大 board narrow waist，不改 hooks 依赖字段。
> Source: GitHub #32 board integrity 线（true-done hard gate）+ `design_docs/plans/2026-07-06-issue-integrity-line.md`。

---

## 1. Context

`status=done` was historically a plain task state. That let a board claim work was complete while lacking endpoint verification or a traceable artifact. `BIZ-DONE-VERIFIED` already existed as a reserved invariant and `taskTrulyDone(task)` already defined the intended predicate, but lint did not enforce it.

## 2. Decision

`done` now means:

```text
status === "done" && verified === true && artifact is non-empty
```

`BIZ-DONE-VERIFIED` is a hard invariant. Any board write that produces a `done` task without `verified:true` and a non-empty `artifact` is rejected by the `ccm` write validation path.

`ccm task done <id>` therefore succeeds only when called with both:

```bash
ccm task done <id> --verified --artifact <path-or-url>
```

## 3. Consequences

### 3.1 Positive

- Board progress cannot silently overstate completion: a done task must carry both endpoint verification and a traceable artifact.
- The rule lives in `@ccm/engine` lint, so every `ccm` write path gets the same gate instead of only one CLI verb.
- The existing `taskTrulyDone(task)` predicate becomes the shared semantic anchor for lint and other consumers.

### 3.2 Negative

- Existing boards with bare `done` tasks now fail hard lint until migrated.
- `task done` requires callers to supply evidence at completion time; uncertain or unverified work must remain non-done.

### 3.3 Neutral

This does not expand the board narrow waist. `verified` and `artifact` remain flexible task fields. Hooks must not directly depend on them, and no `status:"verified"` state is introduced.

## 4. Alternatives Considered

### 4.1 Warn first, hard later

This would reduce migration pain but would not provide a mechanism guarantee. Board writes could still persist a false `done` claim. Rejected for #32 true-done acceptance.

### 4.2 CLI verb-only validation

Rejecting missing `--verified` / `--artifact` only inside `ccm task done` would leave other write paths able to produce invalid `done` tasks. Rejected because board integrity belongs in the engine invariant registry and lint write gate.

## 5. Migration

Existing boards with bare `done` tasks must either add truthful `verified:true` plus a non-empty `artifact`, or move the task back to the most accurate non-done state (`uncertain`, `in_flight`, `stale`, etc.).
