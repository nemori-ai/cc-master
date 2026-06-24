# ADR-002 — Ship-anywhere scope: supported background mechanisms

> Status: **Accepted** — *Superseded in part by [ADR-011](ADR-011-self-wakeup-watchdog.md)*:
> the `ScheduleWakeup` / cron (local timer primitives) exclusion is **narrowed** —
> they are now permitted for self-wakeup / watchdog (silent-failure safety net,
> background-shell still the floor). **agent-teams and cloud `scheduled routines`
> (claude.ai OAuth) remain excluded.** Everything below stands except that one
> narrowing.
> *Further amended by [ADR-014](ADR-014-cli-decoupling-as-independent-product.md)*:
> the ship-anywhere 「no external prerequisite / 单件自包含」 stance is revised — the
> `ccm` CLI becomes a **host-preinstalled per-OS Node SEA binary** the plugin shells
> out to (TS/npm deps locked behind the process boundary; host-vs-model-backend
> distinction per ADR-006). The **dispatch-mechanism scope below is unaffected**.
> Date: 2026-06-08
> Scope: The set of background-execution mechanisms cc-master teaches and depends
> on, across both skills and all commands/hooks. Constrains what may ever be added
> as a dispatch mechanism.
> Source: cc-master design invariant #5 (CONTRIBUTING.md); `design_docs/spec.md`
> §12 (intentional exclusions); background-mechanism research.

---

## 1. Context

cc-master is a long-horizon orchestrator: it dispatches background work, keeps the
main thread productive while it waits, and re-enters when work completes. Claude
Code (and its various host platforms) expose several mechanisms that *could* carry
background work:

- background shell (`run_in_background` on a `Bash` invocation),
- sub-agents (`Task` with `run_in_background`),
- workflows (dynamic-workflow scripts),
- **agent teams** (experimental flag `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`),
- **scheduled routines** (cloud-persistent / offline, but require a claude.ai
  account), and
- timer primitives `ScheduleWakeup` / `CronCreate` (the substrate under native
  `/loop`).

The temptation is to teach all of them so the orchestrator has the richest toolbox.
But cc-master's entire promise is that it works **everywhere it ships** — including
managed runtimes (Bedrock / Vertex / Foundry) and offline / account-less setups.
A mechanism that only works on claude.ai, or only behind an experimental flag, is a
trap: the agent will reach for a tool that is not actually available and stall.

## 2. Decision

**The supported background mechanisms are exactly: background shell, sub-agent
(`run_in_background`), and workflow. Everything else is out of scope by design.**

- **Excluded — agent teams**: gated behind an experimental flag; not reliably
  available. Not taught, not mentioned in the skills.
- **Excluded — scheduled routines**: cloud-persistent but require a claude.ai
  account; not available on Bedrock / Vertex / Foundry. Not taught.
- **Excluded — `ScheduleWakeup` / cron / native `/loop`** *(narrowed by ADR-011 —
  see below)*: `ScheduleWakeup` is unsupported on Bedrock / Vertex / Foundry and
  cron sessions expire after 7 days. The one legitimate use *for waiting on
  external state the harness cannot track* (CI, a remote queue, an approval
  timeout) is dissolved into the **background-shell** primitive
  (`until <ready>; do sleep N; done` dropped into `run_in_background`, with harness
  completion re-entry). See ADR-004.
  - **Narrowed by [ADR-011](ADR-011-self-wakeup-watchdog.md)**: there is a *second*
    legitimate use the background-shell floor does not cover — the **silent-failure
    blind spot** (a background task hangs / dies silently / was never dispatched →
    no completion event → the orchestrator waits forever). For that, `ScheduleWakeup`
    and **`CronCreate` (`durable:false` — a *local* in-session memory scheduler, no
    claude.ai OAuth)** are now **permitted as a watchdog safety net** layered on top
    of harness completion re-entry. They are taught via a *degradation chain*
    (CronCreate / ScheduleWakeup / Monitor) with **background-shell still the
    universal floor**, so ship-anywhere remains a hard guarantee. This narrowing is
    confined to those local timer primitives — it does **not** unblock cloud
    `scheduled routines` / `/schedule` / RemoteTrigger (still claude.ai-bound) nor
    agent-teams (still flag-gated). See ADR-011 §2.2 + §4.3.

The skills say nothing about the excluded mechanisms — not even to warn against
them — so the agent never reaches for a tool it cannot use.

## 3. Consequences

### 3.1 Positive

- **Portability is a hard guarantee, not a hope**: every taught mechanism works on
  every supported platform; there is no "works on claude.ai only" cliff.
- **Event-driven by default**: background shell + sub-agent + workflow all
  re-enter on completion, which is what cc-master wants anyway — no polling timers
  to manage, no 7-day expiry to design around.
- **Smaller surface to teach**: three mechanisms, cleanly explained, instead of six
  with availability caveats.

### 3.2 Negative

- **No native scheduled / offline persistence**: a deployment that *does* run on
  claude.ai and wants cron-style persistence gets nothing from cc-master out of the
  box; it must add that itself, outside the supported scope.
- The orchestrator cannot lean on a managed timer for "wake me in 6 hours" — it
  must express waiting as a background-shell loop instead.

### 3.3 Neutral

- The line is a moving target: if a mechanism becomes reliably universal, a future
  ADR can promote it. The scope is a snapshot of what is portable *today*.

## 4. Alternatives Considered

### 4.1 Alternative A: deeply integrate agent teams + scheduled routines

Rejected. It would give a richer toolbox on the platforms that support them, but it
breaks the core promise: the skills would have to fork on platform/availability,
and an agent on Bedrock would be taught to use a tool that errors. A general
ship-anywhere plugin must not teach mechanisms that are not reliably available
everywhere.

### 4.2 Alternative B: teach the excluded mechanisms "best-effort, may not work"

Rejected. A best-effort mechanism with a "may not work here" caveat is worse than
no mechanism: it adds cognitive load, invites the agent to try-and-fail, and erodes
trust in the deterministic skeleton. cc-master's stance is to keep the toolbox
small and every tool in it real.

## 5. Related

- [`ADR-001-hooks-pure-bash.md`](ADR-001-hooks-pure-bash.md) — the same
  ship-anywhere constraint applied to the hook runtime.
- [`ADR-004-loop-dissolution-and-goal-hook.md`](ADR-004-loop-dissolution-and-goal-hook.md)
  — `/loop`/`ScheduleWakeup` dissolved into background shell for ship-anywhere.
- [`ADR-011-self-wakeup-watchdog.md`](ADR-011-self-wakeup-watchdog.md) — narrows the
  `ScheduleWakeup`/cron (local timer primitives) exclusion: permitted as a watchdog
  safety net for the silent-failure blind spot (background-shell still the floor);
  cloud routines / agent-teams stay excluded.
- [`ADR-014-cli-decoupling-as-independent-product.md`](ADR-014-cli-decoupling-as-independent-product.md)
  — further amends the ship-anywhere 口径: 「no external prerequisite」 → host-preinstalled
  `ccm` SEA binary + process boundary (dispatch-mechanism scope unaffected).
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — design invariant #5.
- [`../design_docs/spec.md`](../design_docs/spec.md) — §12 intentional exclusions
  (agent teams, scheduled routines).

## 6. References

- `design_docs/2026-06-08-native-goal-loop-integration.md` — the background-mechanism
  research that confirmed which mechanisms are real but non-portable.
