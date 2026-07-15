# verify-board CONTRACT

Host-neutral business-rule SSOT for the `verify-board` hook (HOOKPAR-DEC). This is cc-master's
most safety-critical hook — the Stop-time gate that decides whether the orchestrator is allowed to
end its turn.

## 触发意图

A Stop hook can only `block` or (silently) `allow` — it cannot "softly nudge." verify-board reads
the session's active board(s)' `tasks[].status` distribution (never the conversation) and decides
whether stopping now would abandon unfinished/unverified/un-surfaced work.

## 业务规则

- `rule-verify-board-empty-board`: an active board with zero real tasks (`tasks[]` has no entries
  with a non-empty `id`) is blocked — a bootstrapped-but-never-decomposed board must not be treated
  as "done."
- `rule-verify-board-actionable`: any task with `status` `ready` or `uncertain` blocks — there is
  either work that can proceed now, or output awaiting verification.
- `rule-verify-board-self-check-handshake`: once the board is in a "settled" completion state (every
  task is `in_flight`/`blocked`/`done`/`failed`/`escalated`/`stale`, none `ready`/`uncertain`), the
  agent must self-check against the current Goal Contract revision and both local task acceptance
  and global goal acceptance at least once before being allowed to stop on that exact completion
  state. The completion fingerprint includes revision, assurance, goal summary, and Brief hash so an
  amendment necessarily invalidates an earlier handshake.
- `rule-verify-board-goal-integrity`: run `ccm goal check --board <path> --json --no-input` before a
  completion allow. A confirmed malformed contract, missing Brief, or hash mismatch blocks. Failure
  to spawn the checker, timeout, signal termination, malformed transport envelope, or another
  transiently unavailable check is not evidence of tampering: preserve locally known pending-goal
  semantics, continue the other local Stop gates, and emit a non-blocking strong advisory asking the
  agent to retry `ccm goal check`. A pending Goal
  Contract blocks normal completion; the only legal stop is a handoff made exclusively of complete,
  explicit `blocked_on:"user"` `decision_package` records (required non-empty context/need/type/hash/entry
  fields, plus options for a decision), so the user can supply the information needed to
  refine/confirm the goal. A status label without that package does not qualify. Legacy boards retain
  their pre-contract behavior.
- `rule-verify-board-pending-user`: on a settled/legacy goal, any task with `status:"blocked"` and
  `blocked_on:"user"` is named explicitly in the completion-handshake block reason — the agent must
  not silently claim completion over an open decision. The pending-goal handoff above is the narrow
  exception: stopping is how the complete `decision_package` reaches the user.
- `rule-verify-board-watchdog-reminder`: a `in_flight` task with no healthy armed watchdog triggers a
  reminder to arm one before stopping, framed as "come back and recon ground truth," not a verdict
  that the task is dead. A `board.watchdog`/legacy `board.wakeup` record is healthy only when it has
  a non-blank string `job_id` that identifies the real external scheduler/loop/monitor/shell handle
  and a `fire_at` that has not passed. Missing/blank handles and expired records are unarmed; a
  missing or malformed `fire_at` remains a graceful-degrade future record only when the accountable
  handle is present. The hook never repairs or deletes legacy records: `ccm watchdog status`
  diagnoses them, then the agent retires the record with `ccm watchdog disarm`, creates a real
  wakeup, and re-arms with its `--job-id`. User-facing recovery text names missing/blank handles,
  uses the canonical `watchdog.checklist` write field, and never instructs writes to legacy
  `wakeup.checklist`.
- `rule-verify-board-rollup-check`: if any owner task is `status:"done"` while some task whose
  `parent` points at it is not `done`, the block reason names the inconsistent owner/child pair
  (soft reminder, layered onto whichever other rule already triggered the block — this rule never
  triggers a block by itself).
- `rule-verify-board-fuse`: consecutive `block` decisions on the same session are counted; once the
  streak reaches 5, the hook force-`allow`s (releases the Stop) and emits a strong advisory telling
  the agent to go check for a stuck `ready` task instead of trusting the gate blindly. This is a
  dead-man's-switch against an infinite Stop loop, independent of *why* the gate keeps blocking.
- `rule-verify-board-tag-protocol`: a true `block` decision is wrapped in a `<directive>` (a hard
  system gate, must comply, reason states why); the fuse-release warning is wrapped in a
  `<advisory strength="strong">` (high stakes, but the decision to act on it is the agent's).
- `rule-verify-board-dormant-no-match`: no matching active board for this session → silent allow
  (dormant, no orchestration in flight).

## 注入 taxonomy

- Real `block` reasons → `directive` (hard gate, must comply to proceed).
- Fuse-tripped release warning and a transiently unavailable Goal Contract probe →
  `advisory strength="strong"` (not a gate — the agent is now free to stop when no independent local
  gate blocks; the advisory flags that state needs reconfirmation).

## 武装语义

Dormant until at least one board matches `owner.active:true` + `owner.session_id` for the current
session (empty match set → silent allow, `rule-verify-board-dormant-no-match`). Reads
`tasks[].status`/`parent`/`blocked_on`/`title`, `watchdog`/`wakeup`, and (Claude Code only)
`runtime.stop_allow_until`-equivalent bookkeeping is host-local sidecar state, not board content —
never writes board.

## PARITY anchors

Structural anchors (`// PARITY: <rule>` comments) that `tests/content/hook-injection-contracts.test.mjs`
mechanically greps for in each required host's implementation files — a low-cost check that a rule
isn't silently un-implemented on a host it claims to cover. This does NOT prove the two hosts'
judgment tables are byte-identical (only a behavior-level fixture test can, see §3.3 layer②) — it
only proves "both hosts' source at least declares awareness of this rule."

```yaml
- rule: rule-verify-board-fuse
  required_hosts: [claude-code, codex, cursor]
- rule: rule-verify-board-rollup-check
  required_hosts: [claude-code, codex]
- rule: rule-verify-board-tag-protocol
  required_hosts: [claude-code, codex, cursor]
- rule: rule-verify-board-goal-integrity
  required_hosts: [claude-code, codex, cursor]
```

## 降级行为

```yaml
- rule: verify-board-fingerprint-dedup
  kind: protocol-capability-gap
  affected_hosts: [codex]
  reason: >
    Claude Code's rule-verify-board-self-check-handshake is implemented as a fingerprint of the
    settled completion state (a POSIX cksum over sorted task id/status/blocked_on/parent + watchdog
    state); the same completion state is only handshaken once, and re-Stopping on an unchanged
    completion state silently allows. Codex has no equivalent per-fingerprint dedup sidecar.
  compensating_mechanism: >
    Codex uses an explicit release valve instead: the agent, having independently verified it is
    safe to stop, writes `runtime.stop_allow_until <future-ISO-UTC>` via
    `ccm board set-param`, and verify-board-core.js skips blocking while that timestamp is still in
    the future. This is a different mechanism (explicit agent action vs. automatic dedup) that
    partially compensates for the same underlying goal ("don't re-ask about a completion state that
    was already handshaken"), but is not a byte-for-byte equivalent — an agent that forgets to set
    `stop_allow_until` will be re-blocked every Stop on an unchanged completion state (mitigated by
    rule-verify-board-fuse, which is host-symmetric).
  tracked_by: "n/a — intentional protocol adaptation, not tracked as a bug"

- rule: verify-board-fuse-missing-on-codex
  kind: host-convention-divergence
  affected_hosts: [codex]
  reason: >
    Prior to HOOKPAR-DEC, Codex verify-board-core.js had no fuse/circuit-breaker at all — with no
    fingerprint dedup (see above) and no fuse, a misjudging Stop gate (or an agent that never sets
    `stop_allow_until`) could block every single Stop indefinitely with no host-side escape hatch.
  compensating_mechanism: >
    Fixed in this round — codex verify-board-core.js now tracks a session-scoped consecutive-block
    streak sidecar and force-allows + strong-advisory-warns at streak >= 5, matching the safety goal
    of claude-code verify-board.js's FUSE (not the same trigger key — Claude keys release on an
    unchanged fingerprint, Codex keys on raw consecutive-block count — but both bound worst-case
    Stop-loop duration).
  tracked_by: "adrs/ADR-028-hook-parity-contract-and-normalization.md (fixed, this PR)"

- rule: verify-board-rollup-missing-on-codex
  kind: host-convention-divergence
  affected_hosts: [codex]
  reason: >
    Prior to HOOKPAR-DEC, Codex verify-board-core.js never called `ccm board lint`, so it had no
    rollup-consistency reminder at all (silent omission, not declared anywhere).
  compensating_mechanism: >
    Fixed in this round — codex verify-board-core.js now spawns `ccm board lint --board <path>
    --json` per board (mirroring claude-code's rollupOwnersViaCcm), extracts GRAPH-ROLLUP violation
    owners, and appends the same "owner X is done but child Y is <status>" note. `ccm` unavailable →
    skip this soft reminder for that board (graceful degrade, other Stop-gate logic still runs).
  tracked_by: "adrs/ADR-028-hook-parity-contract-and-normalization.md (fixed, this PR)"

- rule: verify-board-tag-protocol-missing-on-codex
  kind: host-convention-divergence
  affected_hosts: [codex]
  reason: >
    Prior to HOOKPAR-DEC, Codex verify-board-core.js emitted bare `{kind:'block'|'system', message}`
    with no ADR-018 tag wrapper.
  compensating_mechanism: >
    Fixed in this round — codex verify-board-core.js now wraps block reasons in a local
    `directive('verify-board', body)` and the fuse-release warning in
    `advisory('verify-board', 'strong', body)` (local duplicates matching claude-code hook-common.js
    wrapper output shape byte-for-byte, since Codex has no shared hook-common to import).
  tracked_by: "adrs/ADR-028-hook-parity-contract-and-normalization.md (fixed, this PR)"

- rule: verify-board-cursor-stop-envelope
  kind: protocol-capability-gap
  affected_hosts: [cursor]
  reason: >
    Cursor has no Claude `decision:block` on Stop. Continuation gate uses `followup_message`
    (auto-continue). FUSE release advisories also use `followup_message` (not `additional_context`).
  compensating_mechanism: >
    verify-board-core.js emits kind:block for gate reasons and kind:system for FUSE release;
    launcher maps all stop kinds to `{ followup_message }`. FUSE sidecar + `stop_allow_until` +
    hooks.json `loop_limit: 5` bound worst-case loops. SSOT: `_hosts/cursor/ENVELOPE.md`.
  tracked_by: "plugin v0.17.2 envelope fix"
```
