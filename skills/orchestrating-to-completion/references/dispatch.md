# Dispatch — choosing a mechanism + orchestrating parallelism

The core of main-thread orchestration: choose *where* to run each node and orchestrate the
lanes. Source: research report 3 (LLM-Compiler TFU dataflow) + codex second review.

## Contents

- [The fractal three altitudes](#the-fractal-three-altitudes)
- [Dataflow at two scales](#dataflow-at-two-scales--why-the-altitudes-are-self-similar)
- [Background execution mechanisms — the three](#background-execution-mechanisms--there-are-exactly-three)
- [Selection criteria — control / synthesis / context](#selection-criteria--control--synthesis--context-not-count)
- [Intra vs inter workflow](#intra-vs-inter-workflow--axis--lifecycle-coupling)
- [Re-altitude via escalation](#re-altitude-core--via-escalation-never-blind-kill)
- [Hybrid + admission control](#hybrid--admission-control)
- [Dispatch hygiene](#dispatch-hygiene--mechanics-that-bite-the-moment-you-run-real-parallel-work)

---

## The fractal three altitudes

Dispatch is fractal across three altitudes — choosing a mechanism = choosing at which altitude
a node executes:

- **Top (main thread)** = a **dataflow scheduler**: dispatches background mechanisms onto DAG
  nodes and interleaves HITL, bounded by WIP + a shared budget, recording everything on the
  board.
- **Middle** = fan-out *inside* a workflow.
- **Leaf** = a sub-agent / shell.

---

## Dataflow at two scales — why the altitudes are self-similar

The three altitudes are not three ideas — they are **one dataflow idea (dispatch-when-ready,
never block at a barrier) appearing at two scales**. Internalizing this is what lets you carry
the same instinct into an unfamiliar situation instead of matching it against a rule list.

The academic root is the LLM-Compiler **Task Fetching Unit** (report 3): a dependency is
dispatched the instant its inputs are ready; nothing already-runnable waits on something
not-yet-ready, and the planner streams the graph so plan and execute overlap. cc-master runs
that same algorithm at two scales:

- **Macro (main thread) — dataflow as an internalized *mindset*.** The decision program *is* a
  hand-run TFU: reconcile the board (the observation blackboard) → dispatch ready tasks
  (fetch-when-ready) → fill-work in the gaps (planner/executor overlap) → verify at the endpoint
  (the Joiner gate) → wait only when the ready set is empty. There is **no `pipeline()`
  primitive here** — the main-thread DAG is dynamic, heterogeneous, and has a human in it, so no
  compile-time script can express it. Dataflow lives as discipline (lenses 3 & 4), not as code.
- **Micro (inside a workflow) — dataflow as an explicit *primitive*.** Here `pipeline()` is real
  code: deterministic, journaled, resumable. But rigid — once a workflow starts its structure is
  fixed, with no mid-run input (`authoring-workflows/references/mechanism.md` §7).

**The cut between the two scales is the cut by dynamism.** Work that must adapt mid-run — react
to an external completion, re-altitude an escalation, absorb a HITL answer — belongs at the
macro scale (board + decision program, LLM in the loop). Work fixable at compile time — uniform
items streaming through fixed stages — belongs in a `pipeline()`. This is the LLM-Compiler split
*"the LLM emits the graph, code schedules it"* scaled up from one agent task to a whole
long-horizon orchestration: the main-thread LLM does the dynamic planning (emit + replan), the
workflow script does the deterministic scheduling. Self-similar — one scale nested in the other.

**The caveat that stops you over-applying it.** `pipeline()` optimizes *throughput* (many like
items through fixed stages); a single long-horizon goal is a *heterogeneous DAG* whose governing
tool is the **critical path** (CPM / work-span), not pipeline throughput. So pipeline
parallelism is a **constituent** of cc-master, not its top-level skeleton:

- the **critical chain** sets the makespan — pipelining can't help a serial dependency;
- only the **non-critical float** is the free parallel budget a pipeline / fan-out fills;
- **batches of like subtasks** (migrate N files, review N findings) are its home turf.

The top-level skeleton is dataflow DAG *scheduling*; a `pipeline()` is its degenerate special
case when the items happen to be uniform. Reaching for fan-out on a serial critical chain is the
classic mis-apply — when T₁/T∞ ≈ 1, don't fan out at all.

---

## Background execution mechanisms — there are exactly three

Teach the agent only these three. (No other background mechanisms exist for this plugin's
purposes.)

- **shell** — mechanically checkable execution (build / test / pull data / listen / poll CI).
  Zero token cost. Must be configured with a **timeout + success predicate + log capture**,
  and failures must be routable to a downstream reasoning node (otherwise split into a "shell
  execution node + sub-agent diagnosis node").
- **sub-agent** (`run_in_background`) — one **terminal** reasoning unit: a single evidence
  surface + a single reasoning chain + a single deliverable + no need to fan out + no need for
  a unified schema + context-safe + carrying an explicit escalation path.
- **workflow** — when you need **deterministic control over multiple leaves** (fan-out /
  fan-in · a unified leaf schema · adversarial verification / retry / loop · joint synthesis ·
  context-flood risk · journal-resume) — **choose it even when the leaf count is small**.

### Waiting on external state — with a background shell

cc-master is event-driven: when a background job finishes, the harness wakes the main thread
and re-enters — so it never needs a timer to poll. For state the harness *cannot* track for you
(CI status, a remote queue, an approval timeout), wait on it with a background shell that polls
its own predicate and rides the completion notification back in:

```bash
until <external state ready>; do sleep 60; done   # run_in_background → harness notifies on exit, re-enters
```

This is event-driven and ship-anywhere — it reuses an existing building block (a background
shell + the completion notification) rather than introducing a separate timer mechanism.

---

## Selection criteria — control / synthesis / context, NOT count

Do not choose by how many things there are. Choose by control / synthesis / context:

- Does it need reasoning? **No → shell.**
- Reasoning and **terminal → sub-agent.**
- Need **deterministic control over multiple leaves → workflow.**

---

## Intra vs inter workflow — axis = lifecycle coupling

The primary axis is **lifecycle coupling**, not count.

- **One workflow** — the leaves share a single lifecycle: same goal / schema / quality gate /
  budget envelope / synthesis point / acceptable failure policy, with no mid-stream HITL need.
- **Multiple workflows** — the streams differ in priority / failure mode / restart cost /
  budget ceiling / escalation / integration timing, or each needs an independent gate
  discussion.

HITL is only one axis; failure isolation, priority, and integration timing matter equally.
**Middle tier**: a single workflow with multiple phases; one level of `workflow()` nesting.

---

## Re-altitude (core) — via escalation, never blind kill

A sub-agent that discovers it is actually a **sub-DAG**:

- **must not self-promote or fan out on its own** (a workflow leaf likewise cannot spawn);
- it **STOPs and returns an escalation result** (a scope map + proposed leaves + deps + partial
  evidence + the reason);
- the orchestrator **supersedes** the old node and uses that map to seed a workflow.

You re-altitude **by checkpoint, not by blind kill.** Corollary: a workflow leaf's prompt must
be small and terminal enough; when unsure, first run a scoping sub-agent / workflow.

Node-status routing for this: `uncertain → verification node`; `stale → upstream changed,
re-run`; `escalated → supersede → workflow`.

---

## Hybrid + admission control

The top tier can have a shell + N sub-agents + a workflow in flight simultaneously. Govern it
with admission control:

- **Reserve before launch** — reserve WIP + token budget on launch (reserve-on-launch, not
  spend-then-report).
- **WIP cap includes the integration burden** — to avoid the synchronization cliff when N
  workflows all return at once.
- **Concurrency cap = min** of: CPU/IO, model budget, rate limit, context-return budget, and
  synthesis load.

---

## Dispatch hygiene — mechanics that bite the moment you run real parallel work

- **Absolute paths to the work target — never inherit cwd.** The orchestrator's cwd is often
  *not* the repo the work lands in (you may be driving from a different worktree or a parent
  directory). Every dispatched agent's prompt must give **absolute paths** to the target and
  tell it not to rely on inherited cwd — otherwise files land in the wrong tree.
- **Single-committer: leaves write + self-test, the orchestrator commits.** Parallel agents
  that each `git commit` race the git index. Instruct each leaf to **write its files and run
  its tests to prove green, but never commit**; the orchestrator verifies at the endpoint and
  commits in dependency order. (The end-to-end argument again — commit integrity belongs at the
  orchestrator endpoint, not the leaf. See `resume-verify.md`.)
- **Serialize writers to a shared mutable file across waves.** If several tasks append to the
  same file (a shared test file, a registry), two of them in the *same* wave will clobber each
  other. Put those writers in **different waves** so at most one touches the file at a time —
  the orchestrator absorbs this coordination cost so the leaves stay independent and disjoint.
