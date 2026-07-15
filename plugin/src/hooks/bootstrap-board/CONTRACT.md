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
  line, literal prefix match — no inline mention) with one of the recognized trigger spellings:
  `cc-master:as-master-orchestrator`, `cc-master-as-master-orchestrator`, or (Cursor host-native
  slash commands) `/as-master-orchestrator` / `/cc-master-as-master-orchestrator`. Anything else is
  silent (dormant, since arming hasn't happened yet).
- `rule-bootstrap-fresh-arm`: on fresh trigger (no `--resume`), create a new `<home>/boards/*.board.json`
  and stamp `owner.session_id` = the current session id, `owner.active = true`. This is the ARM act.
- `rule-bootstrap-raw-request-is-evidence`: the free-form text in the trigger is source evidence, not
  the canonical goal. Fresh bootstrap must never pass it as `ccm board init --goal` or otherwise
  copy it into `board.goal`; the new board starts with `goal:""` and a
  `ccm/goal-contract/v1` skeleton at revision 1 with `assurance:"pending"`. The injected next step
  tells the agent to load `master-orchestrator-guide`, refine an unambiguous goal, persist it through
  `ccm goal set`, and run `ccm goal check` before DAG decomposition.
- `rule-bootstrap-structured-created-path`: fresh bootstrap obtains the created artifact path only
  from `ccm board init --json`'s schema-owned `data.board_path` field. The path must be absolute and
  identify a board artifact; hook implementations must not scrape human-readable CLI output.
  Spaces, Unicode, and symlinked homes are opaque path data and do not change ARM semantics.
- `rule-bootstrap-structured-path-capability`: before any host implementation performs the
  mutating init, legacy migration, or directory creation, it runs the read-only
  `CC_MASTER_NO_AUTOINSTALL=1 ccm board init --capabilities --json --no-input` endpoint and requires capability
  both `board-init/structured-board-path-v1` and `goal-contract/v1`. Capability is authoritative because independently released
  plugin/ccm builds may share version `0.20.0`. Missing or malformed capability output fails loudly
  before any persistent effect. The first planned compatible release is ccm `0.21.0`; an older ccm
  rejects the unknown flag during argument parsing, before its legacy init resolver can create a
  parent directory. The hook also sets `CC_MASTER_NO_AUTOINSTALL=1` on its fallback `ccm --version`
  probe, so both probes leave `CC_MASTER_HOME` and `CLAUDE_CONFIG_DIR` byte-identical. Current ccm
  independently exempts this capability endpoint from statusline auto-install, so its public read-only
  contract does not depend on caller discipline. Capability discovery is deliberately separate from
  `--dry-run`: discovery must happen before any init-path resolution or persistence in legacy binaries;
  `--dry-run` remains zero-write and omits `data.board_path` because no artifact exists.
- `rule-bootstrap-resume-arm`: on `--resume [selector]`, select an existing board (by stem or the
  unique-match rule when no selector given), refuse to steal a board that is currently
  `owner.active:true` for a *different* session, otherwise re-stamp `owner.session_id` to the current
  session and set `owner.active = true` (including reviving an archived board). `tasks[]` / `log[]` /
  `goal` / `goal_contract` / `git` are preserved untouched. Resume context requires `ccm goal check`
  and reading the current Goal Brief (when present) before reconciling or dispatching work.
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
- rule: rule-bootstrap-fresh-arm
  required_hosts: [claude-code, cursor]
- rule: rule-bootstrap-ccm-hard-precheck
  required_hosts: [claude-code, codex, cursor]
- rule: rule-bootstrap-structured-path-capability
  required_hosts: [claude-code, codex, cursor]
- rule: rule-bootstrap-raw-request-is-evidence
  required_hosts: [claude-code, codex, cursor]
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
