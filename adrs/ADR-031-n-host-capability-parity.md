# ADR-031 — N-host capability parity (hooks + cross-surface intents)

> Status: **Accepted**（用户拍板·2026-07-09）
> Date: 2026-07-09
> Scope: Extends ADR-028 from dual-host (Claude Code / Codex) to N-host parity discipline;
>   adds a Capability INTENT layer for cross-surface gaps (reinject, PostToolBatch, workflow,
>   path tokens, ccm quota/account); introduces Cursor as the third documented host (IDE Agent
>   only). Does not implement `plugin/dist/cursor` or `ccm/harnesses/cursor.ts` in this ADR
>   (follow-on implementation PRs).
> Source: `design_docs/harnesses/cursor.md` (2026-07-09) + Cursor dual-track design plan.
> Related: ADR-028 (hook parity contract), ADR-005 (skill separation), ADR-014 (ccm process boundary).

---

## 1. Context

cc-master already ships a **dual-host** alignment stack for hooks (ADR-028):

- `plugin/src/hooks/<hook>/CONTRACT.md` — host-neutral business-rule SSOT per hook.
- `design_docs/hook-parity-matrix.md` — generated divergence view.
- `tests/hooks/test_parity-fixtures.sh` — behavioral equivalence-class fixtures.
- `scripts/check-hook-parity-touch.sh` — PR-diff existence gate.

Commands use a parallel but lighter pattern: `plugin/src/commands/_manifest/commands.yaml`
`intent` + per-host `adapters/<host>/strategy.yaml` (`host_native` vs `adapter_guidance`).

Cursor IDE Agent is the third harness. Investigation (`design_docs/harnesses/cursor.md`)
shows:

- **Track A**: skills, most hooks, and plugin commands can follow existing SAP/PHIP projection
  with modest event-name mapping (e.g. `preToolUse` / `postToolUse` / `beforeSubmitPrompt` / `stop`).
- **Track B**: several capabilities have **no 1:1 mechanism** (compaction reinject substrate,
  `PostToolBatch`, Claude Workflow, Claude statusline/account pool). These must be expressed as
  **declared divergences** with compensating substitutes — the same discipline Codex already uses
  for `stop_allow_until` vs fingerprint dedup (verify-board CONTRACT).

ADR-028's machinery is **dual-column** (`claude-code` | `codex`). Adding Cursor without
generalizing the model would recreate silent drift: hook CONTRACTs would omit cursor from
`required_hosts`, commands would lack `host_coverage.cursor`, and Track B gaps would be
undocumented.

## 2. Decision

### 2.1 N-host parity (extend ADR-028, do not fork)

Known harness hosts for plugin parity (2026-07-09):

```text
claude-code | codex | cursor
```

Rules:

1. **Hook CONTRACT.md** remains the SSOT for hook business rules. `PARITY anchors` may list
   `required_hosts: [claude-code, codex, cursor]` when cursor implementation is planned or
   implemented. Cursor-only rules are allowed only with explicit `affected_hosts: [cursor]` in
   「降级行为」.
2. **`hooks.yaml` `host_coverage`** gains a `cursor:` key per hook (`implemented` |
   `implemented-*` | `planned` | `unsupported`). `gen-hook-parity-matrix.sh` renders a **third
   column** for cursor.
3. **Degradation taxonomy unchanged** (HOOKPAR / ADR-028):
   - `event-unavailable` — no equivalent trigger on that host.
   - `protocol-capability-gap` — trigger exists; semantics differ; intentional adaptation with
     `compensating_mechanism`.
   - `host-convention-divergence` — implementation drift; must carry `tracked_by`; not a
     permanent acceptable end state.
4. **`check-hook-parity-touch.sh`** generalizes: if any host under `host_coverage` with status
   matching `implemented*` is touched in a PR diff for `implementations/<host>/`, the hook's
   CONTRACT.md must also be touched in the same diff (existence check only).
5. **Behavioral fixtures** assert **equivalence classes**, not byte-identical output — existing
   verify-board precedent. Cursor fixtures join when `implementations/cursor/` exists.

### 2.2 Capability INTENT layer (new, cross-surface)

For capabilities that span hooks, commands, skills, and/or ccm — especially Track B gaps — add:

```text
design_docs/harnesses/capabilities/<capability-id>.md
```

Each Capability Card is host-neutral **intent + acceptance** SSOT. Fixed sections:

- Intent (host-neutral)
- Acceptance (testable equivalence classes)
- Host mechanisms table
- Declared divergence (`kind`, `compensating_mechanism`, `tracked_by`)
- Linked surfaces (hook rules, command ids, skill adapters)
- Probe deps (`cursor.md` Dogfood Backlog IDs)

Generated aggregate:

```text
design_docs/capability-parity-matrix.md   # scripts/gen-capability-parity-matrix.sh
```

`run-tests.sh` runs `gen-capability-parity-matrix.sh --check` alongside hook matrix check.

Capability Cards are **developer docs** (not plugin-distributed). They complement hook CONTRACTs:
hook CONTRACT = per-hook rules; Capability Card = cross-cutting user-visible capability that may
touch multiple hooks/commands/skills.

### 2.3 Commands + skills host coverage

1. **`commands.yaml`** each command gains `host_coverage.cursor` (mirror codex patterns:
   `implemented` | `host_native` | `adapter_guidance` | `planned` | `unsupported`).
2. **Every required command** must have `plugin/src/commands/<id>/adapters/cursor/strategy.yaml`
   even when `mode: planned` — proves the adapter was reviewed.
3. **Every distributed runtime skill** must have `adapters/cursor/strategy.yaml` (`copy` |
   `planned` | `unsupported_stub`).
4. **Content contract test** (`tests/content/capability-host-coverage.test.mjs`): for each known
   host and each required command/skill, strategy file must exist.

### 2.4 Cursor dual-track delivery discipline

| Track | What | How |
| --- | --- | --- |
| **A** | SAP/PHIP 1:1 surfaces | SDD: CONTRACT/capability first → TDD: parity fixture → `implementations/cursor/` |
| **B** | Non-1:1 capabilities | Capability Card declares substitute + kind → implement substitute → fixture locks declared class |

**Forbidden**: shipping Cursor hook code without updating CONTRACT.md or Capability Card;
pretending Track B is Track A (silent 1:1 assumption).

### 2.5 Scope exclusions (this ADR)

- No `plugin/dist/cursor` build, no `sync-plugin-dist.sh` full cursor projection, no
  `ccm/harnesses/cursor.ts`, no `install.sh` cursor path — follow-on implementation PRs.
- Cursor Cloud Agents — out of scope; capability cards may note `event-unavailable` where official
  docs exclude hooks.
- AGENTS.md §「hook N-host 锁步」prose updated on Accept (extends ADR-028 dual-host wording).

## 3. Consequences

### 3.1 Positive

- Third host adds without ad-hoc docs; same grep/CI discipline as Codex.
- Track B gaps (reinject, PostToolBatch, Workflow) have a durable SSOT and generated matrix.
- Commands/skills gain the same "reviewed adapter" proof as hooks.

### 3.2 Negative

- More manifest files (`adapters/cursor/strategy.yaml` placeholders).
- Two generated matrices to keep in sync.
- Cursor implementation blocked on probe backlog items in capability cards.

### 3.3 Neutral

- ADR-028 remains valid; this ADR extends rather than supersedes it.
- Hook matrix script gains one column; no change to hook body logic in the Accept-phase design drop.

## 4. Alternatives Considered

### 4.1 Cursor-only fork (separate plugin repo)

Rejected — violates paragoge source-to-adapter model and duplicates SKILL A / board discipline.

### 4.2 Rely on Cursor third-party Claude hooks only

Rejected as **formal adapter** — acceptable for quick validation only; native `.cursor-plugin` +
Cursor events required for production (cursor.md §Hooks).

### 4.3 Expand CONTRACT.md only (no Capability layer)

Rejected — cross-surface gaps (Workflow skill + PostToolBatch hook + dispatch references) do not
fit a single hook CONTRACT cleanly.

## 5. Related

- [ADR-028](ADR-028-hook-parity-contract-and-normalization.md) — dual-host hook parity (extended here).
- [design_docs/harnesses/cursor.md](../design_docs/harnesses/cursor.md) — Cursor IDE Agent facts.
- [design_docs/harnesses/capabilities/README.md](../design_docs/harnesses/capabilities/README.md) — Capability Card index.
- [design_docs/capability-parity-matrix.md](../design_docs/capability-parity-matrix.md) — generated view.

## 6. References

- Cursor official docs (hooks / skills / plugins) — 2026-07-09.
- `design_docs/plans/2026-07-07-hook-parity-system.md` — HOOKPAR taxonomy origin.
