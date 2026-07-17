---
title: Hooks
description: Event-driven guardrails that stay completely dormant until a board says this session is an orchestration.
section: concepts
order: 3
deeper:
  - label: ADR-007 — the board-derived arming gate
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-007-hook-arming-gate.md
  - label: ADR-018 — the tagged hook→agent message protocol
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-018-hook-agent-message-protocol.md
  - label: Hook parity matrix — per-harness coverage, generated
    url: https://github.com/nemori-ai/cc-master/blob/main/design_docs/hook-parity-matrix.md
---

Hooks are cc-master's runtime nerves: small bash or Node scripts the harness fires on lifecycle events (session start, prompt submit, pre/post tool use, stop). They run in a shell **blind to the agent's context** — they can only read the board on disk and the event payload on stdin — and their only way to reach the agent is injecting text into context.

## Dormant until armed

A plugin-level hook fires in **every** session of the harness, including sessions that never started an orchestration. So every cc-master hook is **dormant until armed**: before producing any output it checks the boards directory for a board whose `owner.active` is true and whose `owner.session_id` matches this session. No match → empty stdout, exit 0, no block. Your plain coding sessions stay untouched.

The single exception is `bootstrap-board` — it **is** the arming action. Fired by the `as-master-orchestrator` entrypoint, it creates the board (or re-arms an existing one on `--resume`), and from that moment every other hook wakes up. Disarming is `/cc-master:stop`, which archives the board.

## Three kinds of injected messages

There is no neutral injection — anything added to context shapes the next token. So every hook message carries a machine-readable tag declaring **who decides** and **how hard it pushes**:

| Tag | Decision belongs to | Attention |
|---|---|---|
| `<ambient source="…">` | the agent | low — update your world model; not a to-do |
| `<advisory source="…" strength="weak\|strong">` | the agent | weigh it (weak: casually, strong: seriously) — you still decide |
| `<directive source="…">` | the system | full — comply, and understand the why it carries |

Most messages are advisories: the orchestrator is a judgmental scheduler, not a rule machine. Directives are reserved for hard gates (board-write guard, completion check, missing prerequisite), and always include the reason. `source` is mandatory on every tag so every influence stays traceable.

## The hook inventory

| Hook | Stage | What it does |
|---|---|---|
| `bootstrap-board` | prompt submit | Creates or resumes the board — the only ARM action; also hard-checks that `ccm` is installed |
| `reinject` | session start | Re-injects the orchestrator's operating manual after compaction |
| `orchestrator-context` | session start / context delta | Injects frozen machine-wide facts (quota posture, peers) as ambient context |
| `board-guard` | pre-tool-use | Denies direct file edits to `*.board.json`; redirects to the right `ccm` verb |
| `board-lint` | post-tool-use | Structural lint backstop after writes |
| `verify-board` | stop | The completion gate — unfinished goal, live background work, or unverified tasks block the stop |
| `usage-pacing` | stop / tool batch | Carries `ccm`'s quota verdict into context as a labeled advisory |
| `coordination-inbox` | stop | Surfaces cross-orchestration decision notifications |
| `identity-nudge` | stop | Periodic role and critical-path reminders inside long sessions |
| `posttool-batch` | tool batch | Background-task completion notifications (Claude Code only) |

Not every harness fires every stage — coverage per harness lives in the generated parity matrix linked below, and where a stage is missing the hook degrades honestly instead of faking it.

## What hooks may write

Hooks read the board's narrow waist to decide arming — and nothing more. The single sanctioned write path is a whitelist of `runtime.*` parameters (for example "when did I last nudge") written through `ccm board set-param`, under the same lock and lint as any other write. Everything a hook knows beyond that goes to the agent as a tagged message, never into the board.
