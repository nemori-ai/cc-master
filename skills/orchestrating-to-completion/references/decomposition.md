# Decomposition — goal → dependency DAG

Turn a long-horizon goal into a scheduled dependency graph: decompose into task nodes, draw
dependency edges, get a DAG, compute the critical path, decide how many lanes are worth
opening, and give every node a contract before you dispatch it.

Source: research report 4 (CPM / work-span / Brent).

---

## 1. Goal → task nodes → dependency edges → DAG

Any decomposable goal is a **DAG** (nodes = units of work, edges = dependencies). The
legality of an execution order is guaranteed by **topological sort**: a node is `ready` only
after all of its predecessors are done. This is the graph-theory basis of the dataflow
"dispatch when ready" idea — a fork point is a node with out-degree > 1, a join point is a
node with in-degree > 1.

Steps:

1. Decompose the goal into task nodes, draw the dependency edges, get a DAG.
2. Run a **topological sort** to fix a legal execution order.
3. Run CPM (next section) to find the critical path.

---

## 2. Critical Path Method — forward/backward pass, float

**CPM** (Kelley & Walker, 1959) uses deterministic durations to find "the chain of tasks
that determines the project's shortest completion time" — the **critical path**. Tasks on
the critical path have **float / slack = 0**: any delay there directly delays the whole
project.

Two passes:

- **Forward pass** → each task's **ES / EF** (earliest start / earliest finish).
- **Backward pass** → **LS / LF** (latest start / latest finish) and **float = LS − ES**.

Two distinct slacks, with different scheduling priorities:

- **Total float** — how long a task can slip without delaying the whole project.
- **Free float** — how long it can slip without delaying its successor tasks.

PERT (three-point estimate: optimistic / most-likely / pessimistic, for uncertain durations)
applies when durations are unknown; **CPM is for known durations**. Because agent task
durations are inherently uncertain, lean toward a **PERT mindset** (carry buffers).

**The core operable claim**: only compressing tasks **on the critical path** shortens the
total duration; compressing non-critical-path tasks is wasted effort. A non-critical task's
**float is your "free" parallel/overlap budget** — fill waiting windows with it.

**Resource decision**: put the strongest resources on critical-path tasks (opus impl + dual
reviewers + orchestrator watching closely); give high-float tasks cheaper resources and defer
them into gaps.

---

## 3. Parallelism = T₁/T∞ — how many lanes are worth it

The work-span model quantifies whether parallelism is worth it and what its ceiling is:

- **Work T₁** = total operations on a single processor.
- **Span / depth T∞** = the longest serial chain forced by data dependencies (= the length
  of the critical path).
- **Parallelism = T₁/T∞** = the maximum possible speedup at any processor count.

This tells you "how many lanes of parallelism this goal is at most worth":

- If parallelism ≈ 1 (one long serial chain), fan-out is pointless — **don't waste the agent
  budget**, run it sequentially.
- If parallelism is high, fan out boldly.

**Brent's theorem** (greedy scheduling bound, Brent 1974) gives the expectation anchor:
`T_p ≤ T∞ + (T₁ − T∞)/p`, equivalently `T₁/p ≤ T_p ≤ T₁/p + T∞`. Intuition: actual time ≈
the parallelizable part amortized over p workers + the incompressible critical path. With N
tasks, a critical path of length t, and p lanes, expect ≈ `t + (N−t)/p` — use this to judge
the **marginal value of adding one more lane**.

**Amdahl's reminder**: your own serial synthesis work (writing the plan, verifying,
integrating) is the serial fraction `s`. No amount of parallel agents fixes total time if you
don't overlap this part — which is exactly why "don't idle" overlaps your synthesis with
background execution. **Graham anomaly** is the warning that scheduling is non-monotone in its
parameters: adding processors or shortening tasks can *lengthen* makespan — never assume "more
workers = faster".

---

## 4. Granularity tradeoff

Get the node size right:

- **Too fine** → coordination explosion (the overhead of dispatching, tracking, and
  reconciling more nodes than the work warrants).
- **Too coarse** → cannot be parallelized and cannot be verified at the endpoint (a node so
  large it bundles independent sub-work that should have been separate lanes, or so opaque you
  cannot independently check it).

Pick a granularity where each node is an independently dispatchable, independently verifiable
unit of work.

---

## 5. Per-node contract — define before dispatch

Before dispatching a node, define its contract:

- **Input deps** — pin the upstream artifact (version / hash) each dependency feeds in. See
  `resume-verify.md` for dependency pinning and stale detection.
- **Output schema** — shaped by what downstream needs: `verdict` · `evidence` · `confidence` ·
  `blockers` · `open-q` (open questions) · `artifacts`.
- **Success predicate** — the explicit condition under which the node counts as done.
- **Timeout + budget** — the time/token ceiling for the node.
- **Escalation condition** — when the node should STOP and return an escalation result instead
  of pressing on (see `dispatch.md` re-altitude).

A node without a contract cannot be dispatched safely, cannot be verified at the endpoint, and
cannot be resumed from a content hash.
