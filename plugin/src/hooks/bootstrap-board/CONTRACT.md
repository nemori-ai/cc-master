# bootstrap-board CONTRACT

Host-neutral business-rule SSOT for the `bootstrap-board` hook (HOOKPAR-DEC). Host implementations
(`implementations/<host>/`) are projections of this contract, not independent specs — change the
rule here first, then bring both host implementations into line (or register a divergence below).

## 触发意图（why this hook exists）

`bootstrap-board` is the **only ARM action** in the whole PHIP system (AGENTS.md §12 hook 武装纪律).
Every other hook is dormant until a board with `owner.active:true` and a matching `session_id` exists
under `<home>/boards/`. This hook is what creates that condition — either by writing a fresh board
(fresh start) or by re-arming an existing archived board onto the current session (`--resume`).

## 业务规则

- `rule-bootstrap-trigger-prefix`: the hook only acts when the user prompt begins (first non-empty
  line, literal prefix match — no inline mention) with one of the recognized
  `cc-master:as-master-orchestrator` / `cc-master-as-master-orchestrator` prompt-prefix spellings.
  Anything else is silent (dormant, since arming hasn't happened yet).
- `rule-bootstrap-fresh-arm`: on fresh trigger (no `--resume`), create a new `<home>/boards/*.board.json`
  and stamp `owner.session_id` = the current session id, `owner.active = true`. This is the ARM act.
- `rule-bootstrap-resume-arm`: on `--resume [selector]`, select an existing board (by stem or the
  unique-match rule when no selector given), refuse to steal a board that is currently
  `owner.active:true` for a *different* session, otherwise re-stamp `owner.session_id` to the current
  session and set `owner.active = true` (including reviving an archived board). `tasks[]` / `log[]` /
  `goal` / `git` are preserved untouched.
- `rule-bootstrap-init-flags`: `--priority` / `--wip` / `--owner-wip` / `--policy-switch` passed on the
  triggering prompt are applied to the newly-armed board's coordination/scheduling/policy fields at
  init time (best-effort — a flag-apply failure must not block arming).
- `rule-bootstrap-ccm-hard-precheck`: before creating/arming a board, the hook hard-checks that the
  `ccm` binary is present (`command -v ccm`, or `$CCM_BIN` if set). If absent, the hook **refuses to
  arm** (no board is created/re-armed) and relays a user-facing reminder to install `ccm` (ADR-021).

## 注入 taxonomy

- The ccm-missing refusal reminder is a **directive** (`source="bootstrap-board"`): it is a hard
  precondition failure, not something the agent can reasonably override.
- All other bootstrap output (confirmation of the board that was created/resumed, flag-apply notes)
  is informational/ambient — it reports what just happened, it does not ask the agent to weigh a
  decision.

## 武装语义

This hook **is** the arming mechanism — it does not read an armed-gate itself (the one hook exempt
from AGENTS.md §12's `runHook`/`isArmed` grep door). Its own "gate" is the trigger-prefix match
(`rule-bootstrap-trigger-prefix`); everything before that match is a no-op.

## PARITY anchors

```yaml
- rule: rule-bootstrap-ccm-hard-precheck
  required_hosts: [claude-code, cursor]
```

## 降级行为

```yaml
- rule: bootstrap-slash-command-expansion
  kind: protocol-capability-gap
  affected_hosts: [codex]
  reason: >
    Codex has no verified plugin-distributed custom slash-command expansion mechanism (probed and
    confirmed absent, see _hosts/codex/strategy.yaml bootstrap.unsupported). Claude Code expands
    `/cc-master:as-master-orchestrator ...` through its slash-command surface before the hook ever
    sees the prompt; Codex has no equivalent, so it can only match on the literal typed prompt text.
  compensating_mechanism: >
    The hook matches directly on the literal prompt-prefix spellings listed in
    rule-bootstrap-trigger-prefix (including the bare `cc-master-as-master-orchestrator` form a user
    would actually type without slash-command sugar).
  tracked_by: "adrs/ADR-028-hook-parity-contract-and-normalization.md"

- rule: bootstrap-ccm-hard-precheck-missing-on-codex
  kind: host-convention-divergence
  affected_hosts: [codex]
  reason: >
    Discovered during HOOKPAR-DEC drafting (out of the four originally-scoped divergences, so fixed
    in a follow-up rather than this PR): claude-code bootstrap-board.sh hard-checks `command -v ccm`
    (or `$CCM_BIN`) before creating/arming a board and refuses to arm with a user-facing directive if
    `ccm` is missing (ADR-021). codex bootstrap-board-core.js has no equivalent precheck — it spawns
    `ccm` directly (board init / update / policy set) and only degrades per-call (via try/catch
    `notes.push(...)`), so a missing `ccm` on Codex can still arm an empty, half-initialized board
    rather than refusing to arm at all.
  compensating_mechanism: "none yet — per-call spawn failures are caught and reported as notes, but arming still proceeds."
  tracked_by: "backlog — not in HOOKPAR-DEC's four-item fix scope (FUSE / rollup / board-guard fallback / ADR-018 tags); needs its own follow-up to port ADR-021's fail-loud precheck to Codex bootstrap"

- rule: bootstrap-beforeSubmitPrompt-envelope
  kind: protocol-capability-gap
  affected_hosts: [cursor]
  reason: >
    Cursor `beforeSubmitPrompt` only accepts `continue` + `user_message` (not `additional_context`).
    Bootstrap ARM notices must use `user_message` with `continue: true`; ccm-missing refusal uses
    `continue: false` + directive in `user_message`.
  compensating_mechanism: >
    `_hosts/cursor/launcher.js` maps kind:context|system on user-prompt-submit to
    `{ continue: true, user_message }`; kind:block|deny to `{ continue: false, user_message }`.
    SSOT: `_hosts/cursor/ENVELOPE.md`.
  tracked_by: "plugin v0.17.2 envelope fix"
```
