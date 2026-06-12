# ADR-007 — All hooks are dormant-until-armed (board-derived arming gate)

> Status: **Accepted**
> Date: 2026-06-11
> Scope: All cc-master hooks (`bootstrap-board.sh` / `reinject.sh` / `verify-board.sh` / `posttool-batch.sh` / `usage-pacing.js`) and any future hook. Establishes a single arming contract every hook must satisfy before producing any output / block.
> Source: Reinject false-activation gap (a brand-new session that never ran `as-master-orchestrator` got re-anchored as an orchestrator just because *some other* session left an active board behind) + the new notification/pacing hooks (`posttool-batch` / `usage-pacing`) which, ungated, would fire in every host session.
> Co-signed: user (owner)
> Elevation: this decision has been **elevated to a non-negotiable red line — [`../AGENTS.md`](../AGENTS.md) §3 red line 6** (dormant-until-armed), guarded by the `grep -rL 'board_matches\|isArmed' hooks/scripts/*.sh hooks/scripts/*.js` PR/CI checkpoint.

---

## 1. Context

cc-master's hooks are the orchestrator's runtime: they survive compaction, re-inject the role, gate completion, surface background-agent completions, soft-warn on over-dispatch, and sense the 5h/7d usage wall. But a hook is wired at the **plugin level** — once installed, every one of these hooks fires in **every** Claude Code session in that host, including sessions that are *not* orchestrations and never ran `/cc-master:as-master-orchestrator`.

Without a gate this is actively harmful, not merely noisy:

- **`reinject.sh`** previously activated on *any* active board in home and discarded the stdin `session_id`. A brand-new, unrelated session got falsely re-anchored as an orchestrator just because a different session had left an active board behind (the **false-activation gap** that triggered this ADR).
- **`usage-pacing.js`**, ungated, would read the host-global usage JSONL and inject a pacing warning into **every** session on the machine — polluting plain coding sessions with orchestrator-only chatter.
- **`posttool-batch.sh`** would nudge "you're over-dispatched" in sessions that have no board and no dispatched work at all.

The hard part is **state**. A hook runs in a fresh shell, blind to agent context, and must decide "is this session an armed orchestration?" **across compaction and across the gap between separate `Stop` / `SessionStart` / `PostToolBatch` fires** — events that share no in-process memory. We need a persistence substrate the hook can read on every cold fire.

Investigation conclusion (recorded so it is not re-litigated): **Claude Code exposes no native, hook-readable, cross-compaction session state.** Hooks receive only their event's stdin JSON (which carries `session_id`); there is no durable per-session key/value a hook can stash an "armed" flag in. **Disk is the only durable channel** a hook can both write (at arm time) and read (on every later fire). cc-master already has exactly such an on-disk artifact: the **board** (`*.board.json`), which is the orchestration's single source of truth (ADR-003) and already lives in a configurable home keyed per orchestration.

## 2. Decision

**Every cc-master hook is dormant until the session is *armed*, and arming is derived entirely from the board on disk.**

### 2.1 The arming predicate

A session is **armed** ⟺ the home (`$CC_MASTER_HOME`, else `<project>/.claude/cc-master/`) holds a `*.board.json` whose:

- `owner.active` is `true`, **and**
- `owner.session_id` **equals the `session_id` from this hook's stdin** (exact literal string match).

This is exactly the `board_matches` helper in the bash hooks and `isArmed` in `usage-pacing.js`. **Not armed → the hook stays fully silent: empty stdout, exit 0, never `decision:block`.** No usage read, no nudge, no completion gate — the hook behaves as if it does not exist.

### 2.2 Reuse already-pinned narrow-waist fields only (no new contract)

Arming reads **only** `owner.active` and `owner.session_id` — both **already** pinned narrow-waist fields (ADR-003). The gate adds **no** new hook-dependent field and reads **nothing** from the board's agent-shaped parts (tasks, log, flexible fields are untouched for the arming decision). **ADR-003's narrow waist is therefore unchanged by this ADR.**

### 2.3 Degraded match — symmetric, for compaction robustness **and** unclaimed-board adoption

The degrade fires when **either** side's `session_id` is empty:

- **stdin `session_id` empty** (e.g. a compaction event that drops it) → fall back to matching **any** active board in home. Trades a sliver of cross-session precision for robustness across the compaction boundary, where losing arming entirely would be the worse failure (the orchestrator silently un-roles itself mid-run).
- **board's `owner.session_id` empty** (`""`) → the board is **unclaimed**, and the current session **adopts** it (armed). Without this, a board stamped with an empty `owner.session_id` could never literally equal a *non-empty* stdin sid → **permanently orphaned**: no resuming session could ever arm on it, breaking resume (CODEX12). Empty-session_id boards arise when bootstrap stamps the field blank (building a board on a stdin that carried no `session_id`), or when a board is migrated / hand-edited.

A non-empty board `session_id` against a non-empty stdin sid always uses the **exact-match** path. Crucially, the degrade adopts **only** an *empty* board `session_id` — a board whose `owner.session_id` is **non-empty but `!= sid`** still does **not** match and the hook stays dormant. That is the real cross-session pollution defence (red line 6) and it is left untouched; the symmetric degrade does **not** collapse into "any active board arms" (§4.3 Alternative C remains rejected).

### 2.4 Literal session-id comparison (security note)

The board's `session_id` **value** is extracted with a fixed regex and compared as a **literal shell string** — the stdin `sid` is **never** spliced into a `grep -E` pattern. A session id carrying regex metacharacters (`.`, `*`, `[`, …) would otherwise match the *wrong* board. (Same defensive extraction across all bash hooks; the node hook compares strings natively.)

### 2.5 `bootstrap-board.sh` is the sole exempt hook — it *is* the ARM action

`bootstrap-board.sh` (on `UserPromptSubmit`) **cannot** require a prior armed board — it is what **creates** the armed state. It is the **only** gate-exempt hook. To make the session-scoped gate satisfiable the instant the board is born, bootstrap **stamps `owner.session_id` from the stdin `session_id`** (instead of leaving it `""`), so the creating session immediately owns its board and the very next `Stop` / `SessionStart` fire sees itself as armed. Arming is thus an explicit, sentinel-gated user action (`/cc-master:as-master-orchestrator`), never an accident.

### 2.6 Disarming = `/stop` + goal-hook

A session is **disarmed** when `/cc-master:stop` archives the board (`owner.active:false`). After that the arming predicate is false for every hook, and they all go silent again — the `Stop` goal-hook (`verify-board.sh`) included, since an inactive board no longer matches. There is no separate "reset" mechanism: arm = bootstrap, disarm = stop. Re-arming starts a fresh board.

### 2.7 Official-semantics ruling — what the session-scoped gate does NOT break (authoritatively verified)

CODEX12 first read the session-scoped gate as silently orphaning any active board whose `owner.session_id` did not match the stdin sid, including across resume / compaction — which would break resume broadly. That first reading rests on a **wrong premise**. The platform semantics were **authoritatively verified against the official Claude Code docs** (via `claude-code-guide`, honouring Finding #30's discipline that platform semantics must be authoritatively verified, never assumed):

- **`claude --resume` / `--continue` (`-c`) preserve the original `session_id`** — the `SessionStart` event fires with `source:"resume"` and the **same** `session_id`.
- **Compaction preserves the `session_id`** too — `SessionStart` fires with `source:"compact"`, `session_id` unchanged.
- `SessionStart` carries a `source` field whose values are `startup` / `resume` / `compact` / `clear`.
- **Sessions are independent** — a brand-new session (no `--resume`/`-c`) always gets a **fresh** `session_id`; there is no official范式 for a brand-new independent session "taking over" a prior session's board.

**Therefore:**

- **On the official resume / compaction paths, arming and reinject keep working unchanged** — the exact-match gate matches because the `session_id` is carried through. This is **not** a bug, and §2.3's symmetric degrade is **not** needed for that path.
- **A brand-new independent session staying dormant on another session's active board is the design goal, not a resume failure** — it is exactly red line 6 (no cross-session pollution), and §4.3 rejects "any active board arms."
- **The one genuine gap is the empty-`session_id` board** — an *unclaimed* board (`owner.session_id == ""`) can never literally equal a non-empty stdin sid and is permanently orphaned. **Only** this case needs the §2.3 symmetric degrade (adoption). A non-empty-but-mismatched board `session_id` is deliberately left dormant.

## 3. Consequences

### 3.1 Positive

- **Zero cross-session pollution.** A plain coding session in the same host gets no reinject, no pacing warning, no integrate-nudge, no completion gate. The plugin is invisible until explicitly armed.
- **Closes the reinject false-activation gap** — re-anchoring now requires *this* session to own an active board, not merely that *some* board is active.
- **One contract, six hooks.** A single, auditable predicate (`board_matches` / `isArmed`) is the gate everywhere; reviewing a new hook is "does its first act check arming?"
- **No new persistence substrate, no new waist field.** Arming reuses the board that already exists and the two fields already pinned — cheapest possible mechanism, ADR-003 untouched.

### 3.2 Negative

- **Disk dependency for arming.** If the board is unreadable / the home is misconfigured, every hook silently no-ops. This is the safe failure direction (silence, never a spurious block), but it means a broken home = a fully dormant orchestration with no loud error.
- **Degraded-match imprecision.** With an empty stdin `session_id`, two concurrent armed orchestrations in the same home both match; a hook may act on the wrong board for that one fire. Symmetrically, an **unclaimed** board (empty `owner.session_id`) is adopted by whichever active session fires next — if two sessions race, the first to fire claims it for that fire. Both are accepted as strictly better than the alternatives: losing arming across compaction (empty stdin sid), or permanently orphaning the board (empty board sid). The non-empty-but-mismatched case is **not** affected — it stays dormant (red line 6).

### 3.3 Neutral

- **Arming ≠ correctness of the board's contents.** The gate only asks "is this session an armed orchestration?"; the goal-hook's completion logic, WIP counting, etc. remain each hook's own concern downstream of the gate.
- **Per-fire cost is one directory scan** of `*.board.json` headers — negligible for the low-frequency events these hooks bind (`Stop` / `SessionStart` / `PostToolBatch`).
- **Resume / compaction are unaffected (§2.7).** Per the authoritatively-verified platform semantics, `--resume`/`-c` and compaction carry the original `session_id` through, so the exact-match gate keeps arming and reinject working across them; the symmetric degrade exists **only** for unclaimed (empty-session_id) boards, not for the resume path.

## 4. Alternatives Considered

### 4.1 Alternative A: a dedicated per-session arming sidecar (not the board)

Write a separate `<session_id>.armed` marker at bootstrap and have every hook check *that* instead of the board. Rejected: it duplicates state that the board already encodes (`owner.active` + `owner.session_id`), creating a second source of truth that can drift from the board (armed marker present but board archived, or vice versa). Reusing the board keeps arming and orchestration lifecycle inseparable — `/stop` archives the board and disarms in one act.

### 4.2 Alternative B: a native Claude Code session flag

Stash "armed" in some native per-session state Claude Code persists across compaction. Rejected because **it does not exist** — the investigation found no native, hook-readable, cross-compaction session store (only the event's stdin `session_id`). Disk is the only durable channel a hook can read on every cold fire (§1).

### 4.3 Alternative C: home-scoped activation (the pre-ADR reinject behaviour)

Treat "any active board in home" as armed and ignore stdin `session_id`. Rejected: this **is** the false-activation gap — it falsely arms unrelated sessions that merely share a home with someone else's active board. Session-scoping (`owner.session_id == sid`) is precisely the fix.

### 4.4 Alternative D: gate via environment variable set at bootstrap

Export an env var when the orchestrator command runs and have hooks check it. Rejected: a hook fires in a fresh shell that does not inherit the agent's environment, and the var would not survive compaction or a new `Stop` fire. Env is not a cross-fire channel; disk is.

## 5. Related

- [`ADR-003-board-narrow-waist.md`](ADR-003-board-narrow-waist.md) — arming reads **only** the already-pinned `owner.active` / `owner.session_id`; this ADR adds no new waist field and leaves ADR-003 intact.
- [`ADR-006-hooks-may-use-node-js.md`](ADR-006-hooks-may-use-node-js.md) — unblocks `usage-pacing.js` (node), which carries the same arming gate as `isArmed`.
- [`ADR-004-loop-dissolution-and-goal-hook.md`](ADR-004-loop-dissolution-and-goal-hook.md) — the `Stop` goal-hook (`verify-board.sh`) is itself gated by arming (an archived board no longer matches → disarmed).
- [`ADR-002-ship-anywhere-scope.md`](ADR-002-ship-anywhere-scope.md) — the disk-as-only-channel conclusion is consistent with ship-anywhere (no native session-state dependency assumed).
- [`../AGENTS.md`](../AGENTS.md) §3 red line 6 — this decision is **elevated to a non-negotiable red line** (dormant-until-armed), with the `grep -rL 'board_matches\|isArmed' hooks/scripts/*.sh hooks/scripts/*.js`-must-only-leave-`bootstrap-board.sh` PR/CI checkpoint.
- [`../AGENTS.md`](../AGENTS.md) §12 — the hook arming discipline (hard rule) restates this ADR's gate for hook authors.
- [`../design_docs/2026-06-11-orchestrator-as-program-redesign.md`](../design_docs/2026-06-11-orchestrator-as-program-redesign.md) — the hooks-as-runtime design that introduced the notification/pacing hooks needing this gate.

## 6. References

- [`../design_docs/research/claude-code-hooks-reference.md`](../design_docs/research/claude-code-hooks-reference.md) — hook event capabilities (stdin `session_id`, block / additionalContext); the basis for "no native cross-compaction session state, disk is the only durable channel."
