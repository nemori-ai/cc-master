---
title: Pace quota & accounts
description: Read the real windows, take the engine's verdict, switch accounts only with authority — and never let a token touch the agent's context.
section: guides
order: 5
deeper:
  - label: pacing-and-estimation SKILL.md — the consumption-side discipline
    url: https://github.com/nemori-ai/cc-master/blob/main/plugin/src/skills/pacing-and-estimation/canonical/SKILL.md
  - label: 'ADR-024 — single-sided pacing: throttle, switch, stop'
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-024-single-sided-pacing-switch-stop.md
  - label: ADR-016 — board-scoped authority and the switch policy gate
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-016-board-scoped-orchestrator-authority.md
---

Long orchestrations live and die by quota windows. cc-master's rule of thumb: **the engine produces the verdict, the orchestrator makes the call, and authority comes from you** — never from the agent itself.

## Where the signals come from

On Claude Code, cc-master's status line feeds the 5h/7d quota sidecar automatically (installed on your first `ccm` command; `ccm statusline uninstall` restores yours). Every harness's posture lands in a machine-wide cache that any session can read:

```bash
ccm quota status --machine-wide --json        # cached posture for every supported target
ccm --harness claude-code usage show --json   # drill into one target's current windows
ccm --harness claude-code usage advise --json # …and its verdict
```

Missing, stale, or schema-mismatched signals report as `unknown` / `available: false` — a gap is never read as "plenty of quota." Bind every decision to one exact `harness + surface + window`; never average across surfaces.

## The five verdicts

`ccm usage advise` returns one single-sided verdict per selected target:

| Verdict | Meaning | Typical response |
|---|---|---|
| `hold` | Inside the corridor (or no signal) | keep going |
| `throttle` | Tight, no healthy escape | slow down: lower tiers, cap WIP, defer float work |
| `switch` | Tight, but a healthy standby account exists | move to the next quota share (Claude Code only) |
| `stop_5h` | The 5h window is burned through pool-wide | pause dispatch; arm a watchdog for `nearest_reset` |
| `stop_7d` | The 7d hard gate is hit | stop dispatching; surface the capacity tradeoff to the user |

There is deliberately **no "accelerate" verdict** — unused quota evaporating is not a reason to invent work. The verdict carries `strength`, evidence, and honesty fields; acting on it (or not) remains the orchestrator's judgment.

## Windows differ per harness

| Harness | Pacing window | Auto-switch |
|---|---|---|
| Claude Code | 5h + 7d | only under an existing policy or your explicit authorization |
| Codex | **7d hard only** (rolling-24h is advisory) | never |
| Cursor | subscription **billing period** — IDE and Agent CLI are separate surfaces | never |
| kimi-code | **no CLI quota signal — not paced at all** | never |

One account hitting its 7d ceiling means `switch`, not `stop` — only a fully exhausted pool stops the work.

## The account pool (Claude Code)

```bash
ccm account add <email>      # capture the currently logged-in account
ccm account list
ccm account switch <email>   # overwrite official credentials, no restart
ccm account refresh <email>  # re-capture an aging token
ccm account delete <email>
```

Three guarantees make this safe:

- **Policy gate.** A board can set `policy.autonomous_account_switch: deny`, and `switch` then refuses with exit 7 — checked in the engine before any credential is touched. Granting that authority is a user act (`--user-authorized`); the agent must never self-authorize.
- **Token-blind.** Tokens live in the OS keychain or a `0600` vault file and move only inside the `ccm` subprocess. The registry stores *pointers*, never values, and no token ever enters the agent's context, transcript, board, or logs.
- **Honest exhaustion.** If every account in the pool is against a hard gate, selection returns "none available" and the situation is surfaced to you instead of switching blindly into a wall.

Codex, Cursor, and kimi-code have no account pool and never auto-switch.

## Forecast before you commit

Pacing tells you how fast to burn; estimation tells you whether the plan fits at all:

```bash
ccm estimate forecast --json          # P50/P80/P95 ETA from thousands of Monte-Carlo runs
ccm estimate risk --json              # which tasks are most likely to slip
ccm estimate cost-to-complete --json  # total quota-% the remaining backlog will cost
```

Forecasts carry coverage and confidence fields and a hard honesty wall — P95, never a fake 100%. When a throttle verdict meets a P80 ETA that no longer fits the window, that tension is a user decision: shrink scope, switch, or wait for reset.
