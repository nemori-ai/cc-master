# ADR-009 — `--resume` is an explicit, authorized cross-session re-arm (resuming an existing board, incl. reviving an archived one)

> Status: **Accepted**
> Date: 2026-06-15
> Scope: `bootstrap-board.sh` (the sole arming-exempt hook) gains a SECOND arm form; `commands/as-master-orchestrator.md` (resume narrative); `commands/stop.md` (the `/stop` end-state semantics softened to "explicitly reversible archive"); `skills/orchestrating-to-completion/references/{board.md,resume-verify.md}`. The other four hooks (`reinject.sh` / `verify-board.sh` / `posttool-batch.sh` / `usage-pacing.js`) and ADR-007's arming predicate are **unchanged byte-for-byte**.
> Source: 2026-06-15 resume-board mechanism design (forks #2 `--resume` flag + #4 any-board-takeover, both user-decided); the "no supported path lets an abandoned-active board be resumed by a new session" gap left open by ADR-007 §2.7.
> Co-signed: user (owner)

---

## 1. Context

Today `/cc-master:as-master-orchestrator <goal>` **always creates a brand-new board** — that is `bootstrap-board.sh`'s only job. Once the original session is closed / crashes / the user opens a fresh session on another machine, that board still carries `owner.active:true`, but its `owner.session_id` can never equal the new session's sid. Per the ADR-007 arming gate (§2.3 asymmetric degrade, §2.7 official-semantics), **a brand-new session stays dormant on it** — by design (red line 6, no cross-session pollution).

ADR-007 §2.7 states this explicitly and authoritatively: *"A brand-new independent session staying dormant on another session's active board is the design goal, not a resume failure"* and *"there is no official pattern for a brand-new independent session 'taking over' a prior session's board."* That was the correct stance **at the time it was written**: there genuinely was no authorized takeover path, and silently auto-adopting a board would pollute (CODEX14, ADR-007 §4.5).

But it also means **no supported path lets an abandoned-active (or `/stop`-archived) board be resumed by a new session** — the user who lost their session, or who `/stop`-ped and changed their mind, had to re-decompose the goal from scratch. ADR-009 fills exactly that hole: it turns "takeover" from an **accident** (which ADR-007 rightly forbids) into an **explicit, authorized, audited** action.

The geometry is constrained by one locked invariant (resume-board design §0): **only a hook can read the session sid from stdin** — the command body / main agent cannot reliably obtain its own session sid (ADR-007 §4.4: env does not cross fires, agent context is blind to the hook). Therefore the "stamp a new sid" re-arm **can only happen inside `bootstrap-board.sh`** — the one arming-exempt hook (ADR-007 §2.5). This makes the design question not "where does re-arm live" (it must be bootstrap) but "is bootstrap stamping a new sid onto a **pre-existing** board a legitimate ARM, or a red-line-6 violation?"

## 2. Decision

**`/cc-master:as-master-orchestrator --resume [selector]` is a legitimate, explicit, user-authorized cross-session re-arm.** It is `bootstrap-board.sh`'s **second arm form** — instead of creating a fresh board, it re-stamps `owner` onto a **selected pre-existing** board. This is allowed; the implicit auto-adoption ADR-007 §4.5 rejected remains forbidden.

### 2.1 Resume is an ARM, not a bypass of arming

Red line 6 = "an unarmed session stays dormant." Resume **is** the act of arming, identical in kind to fresh bootstrap on every axis that matters:

- it runs through the **same** `bootstrap-board.sh` (the sole arming-exempt hook — ADR-007 §2.5);
- it is the **same** explicit, sentinel-gated user command (`/cc-master:as-master-orchestrator`);
- it **stamps `owner.session_id`** with the creating session's sid, exactly as fresh bootstrap does.

The **only** difference is that it stamps onto an already-existing board rather than a newly-created one. This falls **inside** the spirit of red line 6: arming is still an explicit, sentinel-gated, user-driven action — not an accident, not a silent adoption.

### 2.2 Explicit takeover (ADR-009) vs implicit auto-adoption (CODEX14, rejected) — the load-bearing distinction

ADR-009 is **not** a reversal of CODEX14 (ADR-007 §4.5). The two are different animals; ADR-009 draws the line sharply:

| | CODEX14 — auto-adopt blank-sid board (**rejected, still rejected**) | ADR-009 — `--resume` takeover (**allowed**) |
|---|---|---|
| Trigger | **Implicit** — any session, no user action; the hook adopts an unclaimed board on its own | **Explicit** — the user runs `/cc-master:as-master-orchestrator --resume <selector>` |
| Selection | None — adopts whatever blank board exists | A **selector** (board filename / timestamp prefix / goal substring) picks ONE board; ambiguity → no write |
| Safety gate | None | A **live-detection gate**: a board that looks possibly-live (fresh heartbeat / mtime) requires explicit `--force-takeover` two-step confirmation |
| Who decided | The hook, on its own initiative | The user, by command |

CODEX12 (objecting to orphaning a blank board) and CODEX14 (objecting to the cross-session pollution that auto-adoption caused) squeezed from both sides; ADR-007 ruled **dormancy over adoption** because red line 6 is non-negotiable. ADR-009 does **not** disturb that ruling: a blank-sid board is **still** not auto-adopted by any hook on its own. ADR-009 only adds an **explicit, selector-driven, live-gated** command path — the very "explicit migration / ownership step" ADR-007 §2.7 / §4.5 already pointed to as the correct way to claim such a board ("claimed by an explicit re-arm — re-run `as-master-orchestrator`").

### 2.3 Any board is resumable, including reviving an archived board (fork #4)

The candidate set is **every** board in home — both `owner.active:true` (abandoned-active) and `owner.active:false` (`/stop`-archived). On takeover, `owner.active` is set **unconditionally to `true`**:

- **abandoned-active** board → `active` was already `true` (idempotent write), just re-stamp the sid;
- **archived** board (`/stop`-ped, `active:false`) → **revived** (`false → true`) **and** re-stamped — one `--resume` undoes a `/stop` the user changed their mind about.

Reviving an archived board is the most sensitive sub-case, and it is **still** an authorized ARM: `/stop` setting `active:false` is hereby defined as a **reversible archive**, not a permanent end-state, and one explicit `--resume` flipping it back is a user-command-driven arm, not an implicit adoption. The archive file is preserved either way (`/stop` never deletes), so revival flips only `active` + `owner` while keeping `tasks` / `log` / `goal` / `git` intact — the audit chain is unbroken.

### 2.4 Only narrow-waist `owner` fields are touched (ADR-003 unchanged)

Re-arm rewrites **only** `owner.session_id` (always), `owner.active` (→ `true`, unconditionally), and `owner.heartbeat` (→ takeover timestamp). All three are **already-pinned** narrow-waist fields (ADR-003). `tasks` / `log` / `goal` / `git` are passed through byte-for-byte. **ADR-003's narrow waist is therefore unchanged by this ADR** — same posture as ADR-007. `owner.heartbeat` gains its first reader (the resume live-detection probe) and its first fixed writer discipline (an active session flushes it each turn — command-body discipline), but it is **not** a new field; it was already pinned, just previously unread.

### 2.5 The live-takeover safety gate (the conductor-never-plays extension of "ask the user first")

Re-stamping the sid **takes the board away** from whatever session owned it — if the prior session is in fact still alive (the user merely opened a second terminal), that is a harmful concurrent takeover whose background work is orphaned. This is an outward-facing / possibly-affects-others action (red line 4's "irreversible → ask the user first"). The gate, before any write:

- reads `owner.heartbeat` + file mtime; a board fresh within a conservative threshold looks **possibly-live** → bootstrap injects a warning and **does not re-stamp** unless the selector already carries `--force-takeover`;
- no usable freshness signal (no heartbeat, mtime unreadable) → conservatively **require force** (assume possibly-live);
- the threshold is biased to err toward "possibly-live" (asking for one more `--force-takeover` confirmation is cheaper than silently stealing a live board).

This makes "take over a board that still looks alive" an **explicit two-step user confirmation**, consistent with red line 4.

### 2.6 ADR-007's arming gate and the other four hooks are unchanged

ADR-009 changes **nothing** in ADR-007's arming predicate (`owner.active:true AND owner.session_id == stdin sid`, degraded to any-active only on empty stdin sid). The other four hooks' `board_matches` / `isArmed` are **byte-for-byte unchanged**. The only delta is that `bootstrap-board.sh` (already the sole arming-exempt hook) gains one more code path to reach the armed state — "stamp onto a selected old board" alongside the existing "stamp onto a freshly-created board." ADR-007 §2.7's factual statement *"there is no official pattern for a brand-new independent session 'taking over' a prior session's board"* is the one line that ADR-009 updates: dormancy remains the **default**; explicit `--resume` is the **authorized exception**.

### 2.7 How the hook detects resume vs fresh — an unconditional args line + symmetric dual-path demux

`bootstrap-board.sh` must decide, after its trigger gate already fired, whether **this** invocation is a fresh bootstrap or a `--resume` takeover. Because `bootstrap-board.sh` is a UserPromptSubmit hook and the prompt it sees may arrive in two shapes — the **raw command** (`/cc-master:as-master-orchestrator …`) or the **expanded command body** (the static markdown, recognized by its `cc-master:bootstrap:v1` sentinel) — the detection runs on **both paths, identically**:

- **the command body renders one machine-readable args line unconditionally**, right after the sentinel: `<!-- cc-master:args: $ARGUMENTS -->`. This is plain `$ARGUMENTS` substitution — it always renders regardless of content, carries the raw `$ARGUMENTS` verbatim, and is **not** resume-specific (no content branch is needed or possible in a static body — see §4.4);
- **both paths then run the same `--resume` first-token demux**: the raw-command path strips the command prefix and tests the leading token; the body-sentinel path recovers the args from the unconditional line (anchored standalone, comment-wrapper stripped, per the Finding #16 discipline) and tests the leading token the same way. A leading `--resume` → `mode=resume` + selector; anything else (including a mid-goal `--resume`) → `mode=fresh`, the original byte-unchanged path.

Because the routing is symmetric, **the body-sentinel path genuinely handles `--resume`** — it is a real, exercised path, not inert defensive code. This is the fix for codex Finding 2 (the earlier design rendered a resume-specific line only conditionally — which a static body cannot do — so under an expanded body `--resume` fell through to a spurious fresh board). The two paths exist as **defensive redundancy** because which shape UserPromptSubmit actually receives is not empirically settled in this repo (Finding #15/#16: the marker can reach UserPromptSubmit through other channels — sub-agent reports / task-notifications — and the external claim that UserPromptSubmit always sees the raw command was not independently confirmed here). Whichever shape arrives, resume is routed correctly. The alternative that was *rejected* — a resume-only marker rendered *conditionally* — is in §4.4.

## 3. Consequences

### 3.1 Positive

- **Low-friction cross-session continuation.** A lost / crashed / `/stop`-ped orchestration can be picked up by one explicit command in a new session, without re-decomposing the goal.
- **Revival is reversible and audited.** `/stop` is no longer a one-way door; `tasks`/`log`/`goal` are preserved across archive → revive, so the history is intact.
- **Red line 6 spirit held, not bent.** The takeover is explicit, selector-scoped, live-gated, and runs through the same arming-exempt bootstrap — it is arming, not a bypass; the implicit auto-adoption red line 6 forbids stays forbidden.
- **No new waist field, ADR-003 untouched.** Re-arm reuses three already-pinned `owner` fields; `owner.heartbeat` merely gains a first reader/writer.

### 3.2 Negative

- **`/stop`'s end-state semantics are weakened** from "irreversible from the hooks' view" to "explicitly reversible archive." A user who `/stop`-ped expecting permanence must now know revival is possible — `stop.md` is updated to say so plainly. The mitigation is that revival is still an **explicit** command, never automatic.
- **Live-takeover detection is weak on legacy boards.** `owner.heartbeat` had no writer before this ADR, so existing boards mostly carry empty/stale heartbeats — early live-detection leans on file mtime alone, a weaker signal. This is a known transition-period limitation that fills in once the heartbeat-flush discipline propagates (every active session writing it each turn).
- **Stale-board pollution risk on revival.** Reviving an old archived board re-arms the full hook set against possibly-stale `tasks`. Mitigated by the command-body **reconcile discipline**: on takeover the agent reconciles the whole DAG and runs orphaned `in_flight` tasks through endpoint verification / re-dispatch (`resume-verify.md`), never trusting old task state blindly.

### 3.3 Neutral

- **Selection ambiguity never writes.** When a selector matches zero or multiple boards (or is empty with multiple candidates), bootstrap injects a disambiguation context and writes nothing — the user re-sends a precise `--resume`. Re-stamping is an irreversible takeover, so "never guess, never write on ambiguity" mirrors the existing `/stop` / `/status` "ask the user on ambiguity" discipline.
- **Orphaned `in_flight` reconcile is a behavioral discipline.** Whether the agent actually endpoint-verifies-or-re-dispatches (rather than idle-waiting on a dead handle) is guarded by dogfood + the command body pointing to `resume-verify.md`, not by a hook — the same class of behavioral guard as the rest of the orchestration method.

## 4. Alternatives Considered

### 4.1 Alternative A: keep ADR-007's "no takeover pattern" stance — never resume cross-session

Leave it as it is: a new session simply cannot resume another session's board; the user re-decomposes the goal from scratch. Rejected: this is the gap. It forces total re-work after any session loss, and it conflates "no *implicit auto-adoption*" (correctly forbidden) with "no *explicit authorized takeover*" (a real, desired capability). ADR-009 separates the two.

### 4.2 Alternative B: revise ADR-007's text in place instead of writing ADR-009

Edit ADR-007 §2.7 / §4.5 to say "actually, explicit takeover is fine now." Rejected: an ADR is an **immutable decision snapshot** (adrs/AGENTS.md §3). ADR-007's stance was correct *at its time* (there was no authorized takeover path then; auto-adoption would pollute). Rewriting it would erase "why we decided that then." ADR-009 is a **refinement / supplement**, not a supersession: ADR-007's arming predicate is wholly intact; only its factual "no takeover pattern" line is updated, recorded in ADR-007's Related as a cross-reference (not a body edit).

### 4.3 Alternative C: a separate `resume` subcommand / a separate command file

Ship a second command (`/cc-master:resume`) rather than a `--resume` flag on the existing command. Rejected (resume-board design §2.4): Claude Code slash commands do not natively support subcommands, so `resume` would also just be `$ARGUMENTS` text — no real subcommand benefit, while a second command file doubles the sentinel / trigger surface. The `--resume` flag on the one existing command keeps a single trigger face; `--` makes it nearly impossible to collide with a real goal.

### 4.4 Alternative D: detect resume vs fresh by *conditionally* rendering a resume-specific marker in the command body

Have the static command body render a machine-readable `cc-master:resume <selector>` line **only when** `$ARGUMENTS` contains `--resume`. **Rejected** — and this rejection still holds: a static slash-command body cannot branch on argument *content*. It only does `$ARGUMENTS` / `$1` variable substitution, with no `if`; there is no way to render a line *conditionally on what the user typed*. So a resume-specific marker that appears only under `--resume` is unimplementable in a static body — exactly the trap codex Finding 2 caught (the old `cc-master:resume` line was never rendered, so under an expanded body `--resume` fell through to a spurious fresh board).

**What is actually adopted (and why it sidesteps this trap)** — the mechanism that ships is the §2.7 dual-path demux, *not* a conditional marker:

- the command body renders the args line **unconditionally**, right after the sentinel: `<!-- cc-master:args: $ARGUMENTS -->`. This is plain `$ARGUMENTS` substitution — it always renders, it is **not** resume-specific and needs **no** content branch, so it is fully expressible in a static body;
- the hook then runs the recovered args through the **same `--resume` first-token demux on both paths** — the raw-command path (the prompt value starts with `/cc-master:as-master-orchestrator …`) and the body-sentinel path (the prompt is the expanded body, args recovered from the unconditional line). Fresh-vs-resume routing is therefore **identical** on the two paths;
- consequently the hook's body-sentinel branch is **not** inert defensive code — it genuinely handles `--resume` (that is the Finding 2 fix). It is a real, exercised path, kept because the raw-vs-expanded shape UserPromptSubmit actually receives is not empirically settled in this repo (Finding #15/#16: the marker can reach UserPromptSubmit through other channels — sub-agent reports / task-notifications — and claude-code-guide's claim that UserPromptSubmit always sees the *raw* command was not independently confirmed here). Defensive **dual** handling means resume is routed correctly whichever shape arrives.

The load-bearing distinction: what was rejected is *conditional rendering of a resume-only marker* (impossible in a static body); what was adopted is an *unconditional args line + symmetric demux* (trivially possible, and it makes both hook paths route resume). The adopted mechanism is recorded in §2 Decision (§2.7); the two sections do not conflict.

## 5. Related

- [`ADR-007-hook-arming-gate.md`](ADR-007-hook-arming-gate.md) — the arming gate this ADR refines. ADR-007's predicate and the other four hooks are **unchanged**; only its §2.7 factual "no takeover pattern" line is updated (dormancy stays the default, `--resume` is the authorized exception). See ADR-007 §2.7 / Related for the reciprocal cross-reference.
- [`ADR-003-board-narrow-waist.md`](ADR-003-board-narrow-waist.md) — re-arm touches **only** the already-pinned `owner.session_id` / `owner.active` / `owner.heartbeat`; no new waist field, ADR-003 intact.
- [`ADR-002-ship-anywhere-scope.md`](ADR-002-ship-anywhere-scope.md) — resume introduces no new background mechanism; selection + live-probe are local file reads (pure bash), consistent with ship-anywhere.
- [`../AGENTS.md`](../AGENTS.md) §3 red line 6 / §12 hook arming discipline — the "bootstrap is the sole exempt ARM action" description now notes ARM has two forms (fresh / resume), without changing the red-line substance.
- [`../skills/orchestrating-to-completion/references/board.md`](../skills/orchestrating-to-completion/references/board.md) — `owner.session_id` resume note + `owner.heartbeat` upgrade (first reader/writer).
- [`../skills/orchestrating-to-completion/references/resume-verify.md`](../skills/orchestrating-to-completion/references/resume-verify.md) — the orphaned-`in_flight` reconcile discipline (content-hash + endpoint verification) the resume command body points to.

## 6. References

- Saltzer–Reed–Clark, *End-to-End Arguments in System Design* (1984) — the endpoint-verification argument underpinning the orphaned-`in_flight` reconcile (verify at the endpoint, never trust a dead handle's self-report).
