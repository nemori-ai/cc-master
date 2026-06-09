# Mechanism — how the Workflow runtime actually behaves

> Read this BEFORE trusting any belief about the engine. It exists to stop two
> classes of mistake: (1) guessing whether code runs in parallel, and (2)
> believing reverse-engineering folklore that the live tool contract has since
> revised. Adapted from research report 1
> (`design_docs/research/01-claude-code-dynamic-workflow-mechanism.md`).

## Contents

- [§0 Contract vs internals](#0-the-one-distinction-that-governs-everything-contract-vs-internals)
- [§1 One-line essence](#1-one-line-essence)
- [§2 The 7 primitives + 2 injected objects](#2-the-7-primitives--2-injected-objects-true-semantics)
- [§3 `parallel` (barrier) vs `pipeline` (streaming) + the smell-test](#3-parallel-barrier-vs-pipeline-streaming--the-core-clarification)
- [§4 Determinism三禁 — and why](#4-determinism三禁-the-three-forbidden-things--and-why)
- [§5 Resume = "longest unchanged prefix"](#5-resume--longest-unchanged-prefix)
- [§6 Hard caps](#6-hard-caps-resource-bounds)
- [§7 Background execution](#7-background-execution-the-contract-that-makes-the-main-thread-free)

## 0. The one distinction that governs everything: contract vs internals

Always separate two layers:

- **Behavior contract** — what the runtime *promises* a primitive does. This is
  documented: it comes from the `Workflow` tool schema the agent is handed and
  from `code.claude.com/docs/en/workflows`. **You can rely on it.**
- **Internal mechanism** — *how* the runtime achieves that promise (the sandbox
  flavor, the journal file format, the exact cache index). This is a black box;
  Anthropic almost never documents it. **Do not build beliefs on it.**

For an author, the contract is enough. Everything below that is marked
"confirmed" is contract-level; everything marked "unknown" is internals you must
not depend on.

### Confirmed contract (rely on these)

| Fact | Confirmation |
|---|---|
| `agent()`/`parallel()`/`pipeline()`/`phase()`/`log()`/`workflow()`/`args`/`budget` semantics | tool schema (first-party) |
| `parallel` is a **barrier**; `pipeline` is **no-barrier streaming** | tool schema |
| Failure semantics (thunk throw → `null` slot; stage throw → item dropped) | tool schema |
| determinism三禁 throw (`Date.now`/`Math.random`/arg-less `new Date()`) | tool schema (behavior) |
| resume = **longest unchanged prefix** of `agent()` calls | tool schema |
| Concurrency `min(16, cpu cores − 2)` per workflow | tool schema |
| 1,000 agents total per run; 4,096 items per `parallel`/`pipeline` call; 512 KB script | tool schema |
| `budget` = `{total, spent(), remaining()}`; `spent()` = output tokens, shared across main loop + all workflows | tool schema |
| `workflow()` is one-level nesting; child shares concurrency/counter/abort/budget | tool schema |
| `args` is passed **verbatim as actual JSON values** (not stringified) | tool schema |

### Internal unknowns (never depend on these)

- Whether the sandbox is a `vm`-module in-process sandbox, QuickJS, or
  `isolated-vm`. (The "V8 isolate" story is **folklore** — it actually describes
  a *different* product, Cloudflare-backed Managed Agents, not the workflow
  runtime.)
- The cache key's true index (content-hash vs positional index+content).
- The journal on-disk format (`agent-<id>.jsonl` is a community guess).
- Whether the determinism guard is a pre-execution AST gate or a runtime throw.
- The 180 s per-agent stall timeout and 30 s VM timeout (community single-source;
  re-verify against the current build before relying).

## 1. One-line essence

A dynamic workflow moves the "what runs next" decision **out of the LLM and into
a deterministic JavaScript script**. The LLM writes the script once; a runtime
executes it in the background. Intermediate results live in **script variables**,
not the context window — only the final answer returns to the caller. This is
what lets a single run coordinate tens-to-hundreds of agents without drowning the
context.

The script is a **pure coordinator**: no filesystem, no shell, no Node APIs. All
side-effecting work (read, write, run commands) is delegated to leaf agents with
throwaway context; only their results come back.

## 2. The 7 primitives + 2 injected objects (true semantics)

| Primitive / object | What it does | Barrier? |
|---|---|---|
| `agent(prompt, opts?)` | Spawn a fresh-context leaf subagent; returns its text, or a validated object if `schema` given. User skip → `null`. | n/a |
| `parallel(thunks)` | Run an **array of thunks** concurrently and wait for ALL. | **YES** |
| `pipeline(items, ...stages)` | Stream each item independently through all stages. | **NO** |
| `phase(title)` | Open a named progress group for the agents that follow. | n/a |
| `log(message)` | Emit one narrative line above the progress tree. | n/a |
| `workflow(nameOrRef, args?)` | Inline-run another workflow (one level only). | n/a |
| `args` | The input value passed to the run, exposed verbatim as a global. | n/a |
| `budget` | `{total, spent(), remaining()}` — shared output-token pool. | n/a |

`agent()` detail: with no `schema` it returns the leaf's final text (a string);
with a JSON `schema` it returns a validated **object** (no `JSON.parse` needed) —
validation happens at the tool-call layer and a mismatch makes the model retry.
A user-skipped agent returns `null`, which is why `.filter(Boolean)` appears
everywhere. (Full opts in `api-reference.md`.)

## 3. `parallel` (barrier) vs `pipeline` (streaming) — the core clarification

Both "run things in parallel," but the **shape** differs completely. This is the
single most common source of confusion.

**`parallel(thunks)` — a barrier fan-out.**
- Takes an **array of thunks**: `[() => agent(...), () => agent(...)]` — **not**
  an array of promises. (Bare promises start immediately, bypass the concurrency
  limiter, and are a known anti-pattern.)
- It is a **barrier**: it waits for *every* thunk before returning.
- It **never rejects**: a thrown thunk becomes `null` in its result slot. Always
  `.filter(Boolean)` — the result array is designed to have holes.
- Use **only** when the downstream step genuinely needs the whole set at once:
  cross-set dedup/merge, count-based early-exit ("0 bugs → skip all verification"),
  or comparing one item against the whole group.

**`pipeline(items, ...stages)` — no-barrier streaming.**
- Each item flows **independently** through **all** stages — item A can be in
  stage 3 while item B is still in stage 1. No barrier between stages.
- Wall-clock ≈ the slowest *single item's whole chain*, not the sum of the
  slowest stage at each step.
- Each stage callback receives `(prevResult, originalItem, index)` — annotate
  later stages with `originalItem`/`index` instead of threading context through.
- A thrown stage drops that item to `null` and skips its remaining stages.
- **This is the default for multi-stage work.**

### The smell-test (decide which one)

If you find yourself writing:

```js
const a = await parallel(...)
const b = transform(a)        // flatten / map / filter — NO cross-item dependency
const c = await parallel(b.map(...))
```

…that intermediate `transform` does **not** need a barrier — rewrite it as a
pipeline: `pipeline(items, stageA, r => transform([r]).flat(), stageB)`.

A barrier is justified **only** when stage N truly needs the *whole set* from
stage N−1 (dedup/merge, count early-exit, "compare against all other findings").
"Cleaner code" and "the stages are conceptually independent" are **not** reasons
to use a barrier — barrier latency is real: with 5 finders where the slowest is
3× the fastest, the barrier wastes two-thirds of the fast finders' idle time.

## 4. Determinism三禁 (the three forbidden things) — and *why*

Inside a workflow script, three classic JavaScript non-determinism sources
**throw (fail-loud)**:

1. `Date.now()`
2. `Math.random()`
3. arg-less `new Date()` / `Date()` — but `new Date(specificValue)` is fine.

**Why:** a run is journaled so it can resume. Resume replays cached `agent()`
results for the unchanged prefix (§5). If the script's *control flow* depended on
a wall clock or a random draw, the replay would diverge from the original run and
the journal would be meaningless — the cache would silently go stale. So the
runtime forbids the non-determinism rather than letting resume break quietly.

**The workarounds:**
- Need a timestamp? Pass it in via `args`.
- Need agents to differ? Vary the prompt by **loop index** or a **per-index
  label**, not by randomizing.

So if your `Date.now()` "broke resume," the real story is: the runtime threw to
*protect* resume — the script must be deterministic for the longest-unchanged-prefix
cache to be sound.

## 5. Resume = "longest unchanged prefix"

The contract's exact wording:

> "the **longest unchanged prefix** of `agent()` calls returns cached results
> instantly; the first edited/new call and everything after it runs live. Same
> script + same args → 100% cache hit."

Mental model: resume walks the **sequence** of `agent()` calls in order,
comparing each by content (`prompt` + the cache-affecting opts). As long as a
call is unchanged it hits the cache; at the **first** changed call it switches to
live, and everything after it runs live too. It is therefore *prefix-ordered +
content-compared* — neither purely positional nor an out-of-order content-hash.

- `schema` / `model` / `isolation` / `agentType` changes **invalidate** the cache
  (force a rerun of that call).
- `label` / `phase` are purely decorative and **never** invalidate.

This is the "edit-and-resume" workflow: run once → Write/Edit the saved script →
re-invoke with `{scriptPath, resumeFromRunId}`; the unchanged prefix replays
instantly, so you only pay live cost for what you changed and what follows it.

## 6. Hard caps (resource bounds)

| Cap | Value |
|---|---|
| Concurrent agents per workflow | **`min(16, cpu cores − 2)`** — excess queues, runs as slots free |
| Total agents per run | **1,000** (runaway-loop backstop, far above real need) |
| Items per single `parallel()`/`pipeline()` call | **4,096** (explicit error if exceeded — not a silent truncation) |
| Script size | **512 KB** (`maxLength: 524288` on the `script` param) |

**Engineering consequence:** you can hand `parallel`/`pipeline` up to 4,096 items
and they all complete, but only ~`min(16, cores−2)` run at any instant — the rest
queue. This is why fanning out 100 agents does **not** give a 100× speedup: a
fixed concurrency window throttles throughput (Amdahl/Gustafson + a fixed window).
Plan parallelism for the window you actually have, not the item count.

## 7. Background execution (the contract that makes the main thread free)

A `Workflow` tool call **returns immediately with a task ID**; the workflow runs
in the background and injects a `<task-notification>` into the conversation on
completion. So the main thread is not blocked — it gets control back immediately
and can do the next thing while the workflow runs. (Active short-interval polling
is wasteful — the harness re-wakes you on completion.) Note the limit, though:
once a workflow starts, its script structure is fixed — there is **no mid-run
input**. "Continuous progress" inside a workflow is a compile-time decision you
make by writing a streaming `pipeline()`, not a runtime adaptation.
