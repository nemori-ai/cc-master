---
title: Run multiple orchestrations
description: Several boards on one machine share the same quota pools — a read-only roster, a notification inbox, and a deterministic arbiter keep them fair.
section: guides
order: 4
deeper:
  - label: ADR-017 — multi-orchestrator coordination layer
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-017-multi-orchestrator-coordination.md
  - label: Feature manual — coordination, monitor, and viewer status
    url: https://github.com/nemori-ai/cc-master/blob/main/design_docs/feature-manual.md
---

You can run several orchestrations at once — different projects, different sessions, even different harnesses — all from one machine. They share one thing that matters: **quota**. cc-master's coordination layer exists so two hungry orchestrators do not burn the same window blind. Its design line is deliberate: **coordination ≠ communication**. Boards never negotiate with each other; a deterministic machine computes fair shares, and each orchestrator decides whether to follow.

## See the other boards: the peers roster

```bash
ccm peers list --json
```

A read-only, cross-board roster of every live orchestration in your home: goal summary, workload, board priority, liveness (heartbeat freshness), and which harness pool it belongs to. Peers are partitioned by `(harness, account pool)` — boards in different pools never compete, and the roster never pretends they do.

## Give a board a voice: priority

```bash
ccm board update --priority high      # urgent | high | normal | low | trivial
```

Priority is the input the arbiter weighs. Set it when you create the board (`as-master-orchestrator --priority high`) or later via `board update`. It is an agent-shaped field — a claim, not a lock — so set it honestly; the arbiter cannot tell a real deadline from vanity.

## The deterministic pool arbiter

```bash
ccm coordination arbitrate --json
```

One mechanical arbiter per quota pool computes a **priority-weighted fair share** of the available headroom — weights are `urgent 8 : high 4 : normal 2 : low 1 : trivial 0.5` — and turns it into per-board rows: `pacing_yield`, `pacing_claim`, `pacing_throttle`, `pacing_switch`, `pacing_stop`, or `hold`. Same inputs, same outputs, every time; the intelligence lives on the consumption side (your orchestrator reads the row, applies judgment, may override). A board running alone sees exactly the single-board verdict it would have had anyway — no coordination noise invented.

## The inbox: decisions that need an ack

```bash
ccm coordination inbox list --json
ccm coordination inbox ack <id...>
```

Routine facts inject directly; decision-grade suggestions land in the board's `coordination.inbox` as durable notifications (`unconsumed` → `consumed`/`expired`, same-kind superseded so nothing piles up). A `coordination-inbox` hook surfaces them to the orchestrator; `ack` marks them consumed once acted on. Edge-triggered dedup keeps the inbox quiet unless the pressure band, the roster, or your target share actually changed.

## Close the idle blind spot: the monitor daemon

Hooks only fire at session boundaries — while your foreground session sits idle, background workers can still burn through a window with nobody watching. `ccm monitor` is an optional, advisory daemon that senses continuously and writes to the inbox on edges:

```bash
ccm monitor start
ccm monitor status
ccm monitor install-service   # optional: launchd / systemd --user
```

It is an accelerator, never a prerequisite: absent, it stays silent and the hook path keeps working. Home services (`monitor`, `web-viewer`) are reconciled automatically after any `ccm` binary replace, so an upgrade never leaves a stale daemon running old logic.

## See it all: the viewer board switcher

`ccm web-viewer open` shows every live board in your home one click apart — the fastest way to answer "what are all my orchestrations doing right now" without touching a terminal command per board.
