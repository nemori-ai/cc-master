---
title: The decision program
description: Every turn ends with the same deterministic loop — reconcile, surface, dispatch, verify — and waiting is only legal when nothing is schedulable.
section: concepts
order: 2
deeper:
  - label: master-orchestrator-guide SKILL.md — the orchestrator's standing manual
    url: https://github.com/nemori-ai/cc-master/blob/main/plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md
  - label: ADR-009 — explicit cross-session resume and re-arm
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-009-resume-cross-session-re-arm.md
  - label: ADR-011 — the self-wakeup watchdog
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-011-self-wakeup-watchdog.md
---

The orchestrator does not free-wheel. At the end of **every turn** it runs the same deterministic loop — a manually executed dataflow scheduler. The loop is what lets a long orchestration stay productive without you watching it, and its most dangerous edge is the one that lets it stop.

## The loop

1. **Reconcile the board.** Integrate finished work, hedge anything past its p95 duration, mark stale what upstream changes invalidated. Every `in_flight` task is checked against a real process or agent handle — a task marked running with no handle is a phantom, and only ground truth (git, tool results) exposes it.
2. **Surface user decisions — now.** If a point genuinely needs you, it is raised immediately with a prepared decision package: context, options, tradeoffs. The orchestrator never sits on a foreseeable question, and never decides a merge/irreversible/outward step on your behalf.
3. **Dispatch everything ready.** A task whose dependencies just cleared fires at once — within the WIP cap, and even mid-conversation with you. Waiting at a barrier is forbidden; independent work never serializes behind your answer.
4. **Fill-work, or verify.** No ready tasks? Do work that passes the admission test (unblocks a dependency, reduces integration risk, produces a reusable artifact, verifies a concrete assumption). Anything `done`-but-unverified gets independently verified at the orchestrator's own endpoint.
5. **Wait — only if nothing is schedulable.** A legitimate wait means every remaining path is blocked on an in-flight background task or on your answer. Before yielding, the orchestrator writes its ledger (per-path evidence, both to the conversation and the board) and flushes the board.

Any step that finds work sends the loop back to the top. The only legal exit is an empty ready set.

## The watchdog: a net for silent failures

Your harness re-invokes the agent when a background task **completes** — but it is structurally blind to tasks that hang, die silently, or never start (phantoms). Before waiting on a path that depends on a possibly-silent background task, the orchestrator arms a **watchdog**: a self-wakeup that brings it back to reconcile against ground truth.

The mechanism is a degradation chain — `CronCreate` / `ScheduleWakeup` where the harness offers them, with a background-shell `until` polling loop as the universal floor. The watchdog is recorded on the board (`ccm watchdog arm …`) so it survives compaction, and a ceiling fires a re-check rather than a kill — a healthy slow task gets re-armed, not executed. Pure awaiting-user waits need no watchdog: your reply is itself the wake event.

## Surviving compaction and sessions

Two mechanisms make the loop durable:

- **Reinjection.** After every context compaction, a SessionStart hook re-injects the orchestrator's full operating manual and the machine-wide facts into context. The role does not fade as the conversation grows.
- **The board as identity.** Armed state is derived from the board on disk (`owner.session_id` + `owner.active`), not from conversation memory — so the orchestrator recognizes its own run after any reset.

## Resume and handoff

`--resume` is an explicit, safe takeover: the new session stamps its id onto a chosen existing board (live runs are guarded against double-ownership), keeps `goal`/`tasks`/`log`, and re-arms every hook — including reviving an archived board. Step zero of any resume is landing in the board's recorded worktree; the resumed session then reconciles live evidence rather than trusting the board blindly. For a planned move, `/cc-master:handoff-to-new-session` writes a narrative handoff document and archives the board for the next session to pick up.
