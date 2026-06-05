---
name: authoring-workflows
description: Use whenever you are about to call the Workflow tool or author/debug a Claude Code dynamic-workflow script — even if you think you already know the API. Picks the right paradigm (fan-out/pipeline/loop), writes to the runtime's own validation contract (the harness is the authoritative checker), and points to mechanism/patterns/api references plus templates and examples. The engine has non-obvious determinism and resume rules; consult this before guessing rather than after a failed run.
---

# Authoring dynamic workflows

A dynamic workflow moves the "what runs next" decision out of the LLM and into a
deterministic JavaScript script that a runtime executes in the background. Use
this skill when you are about to write one. The discipline here is small: **be
honest about whether you need a workflow, pick the paradigm by its shape, and
write to the runtime's own validation contract — the harness is the authoritative
gate, so you don't reimplement it.**

## 1. The honest test — do you even need a workflow?

A workflow earns its keep when a task needs **tens-to-hundreds of agents**
coordinated, with intermediate results kept *out* of your context. It is overkill
otherwise.

- A two-line bugfix does **not** need a five-agent review panel.
- A single lookup does **not** need a fan-out.
- If the work is one reasoning chain with one deliverable, dispatch a single
  sub-agent — not a workflow.

Reach for a workflow only when at least one of these is true: the work fans out
into many independent units, the intermediate output would flood your context, or
you want a reusable quality pattern (adversarial cross-review, judge panel). If
none hold, stop here.

## 2. Paradigm decision tree

Pick by the **shape** of the work, not by taste. (Full semantics in
`references/mechanism.md`; full pattern catalog in `references/patterns.md`.)

- **Independent tasks AND you need ALL results together** → **fan-out**
  (`parallel()`, a barrier). Template: `assets/templates/fan-out.js`.
- **Multi-stage work where stages need not synchronize** → **pipeline**
  (`pipeline()`, streaming — **the default**; item A can be in stage 2 while item
  B is still in stage 1). Template: `assets/templates/pipeline.js`.
- **Unknown count** → **loop**:
  - depth should scale to a `'+Nk'` budget → **loop-until-budget**
    (`assets/templates/loop-until-budget.js`).
  - unknown-size discovery (find *all* of something) → **loop-until-dry**
    (`assets/templates/loop-until-dry.js`).
- **You don't know the work-list yet** → **scout-then-fanout**: one scout agent
  enumerates the list, then pipeline/parallel over it. The most common real entry
  shape. Template: `assets/templates/scout-then-fanout.js`.

> **Default to `pipeline()`.** A barrier (`parallel()`) is justified only when a
> downstream stage truly needs the *whole* previous set (dedup/merge, count-based
> early-exit, "compare against all others"). "Cleaner code" is not a reason — the
> barrier's latency is real. See the smell-test in `references/mechanism.md` §3.

## 3. Author flow — draft to the harness contract, then launch

1. **Draft** from a skeleton in `assets/templates/` (or a full composition in
   `assets/examples/`). Fill in the real prompts, schemas, and work-list. Keep
   `meta` a pure literal with `name` + `description` as the first statement.
2. **Write to the harness's validation contract.** The runtime is the
   authoritative checker — there is **no separate linter to run, and you should
   not reimplement one**. The contract:
   - `meta` is the first statement and a pure literal (`name` + `description`
     required) — the harness validates this **at launch**.
   - no `Date.now()` / `Math.random()` / arg-less `new Date()` — the harness
     **throws on these at runtime** (they break resume).
   - no `require` / node-builtin imports / `process.*` — the sandbox rejects them.
   - `parallel()` takes thunks (`() => ...`), not bare promises (a bare promise
     executes eagerly and loses the barrier).
   - stay under the caps (16 concurrent / 1,000 total / 4,096 per call / 512 KB).

   See `references/mechanism.md` for what each constraint means and why.
3. **Launch.** If the harness rejects the script or throws, its error is
   authoritative — read it, fix per `references/mechanism.md`, relaunch.

> **Why no linter?** The runtime already validates `meta` (at launch) and
> determinism / caps / escape (at runtime), authoritatively. A separate static
> linter would only be a drift-prone heuristic re-implementation of the harness's
> own checks — worse than the real thing. So this skill teaches you the contract
> instead of shipping a second validator. (The orchestration principle "trust the
> deterministic endpoint, not prose self-check" is satisfied by the harness — it
> *is* the endpoint.)

## 4. Reference index — read before you guess

- **`references/mechanism.md`** — read this **before trusting any belief about
  the engine**. Confirmed contract vs internal unknowns; the 7 primitives'
  true semantics; `parallel`(barrier) vs `pipeline`(streaming) + the smell-test;
  why `Date.now()` breaks resume; resume = "longest unchanged prefix"; the hard
  caps (16 concurrent / 1,000 total / 4,096 per call / 512 KB).
- **`references/patterns.md`** — pick the *shape*: fan-out+synthesize,
  pipeline-by-default, adversarial-verify, perspective-diverse-verify,
  judge-panel, loop-until-{count,budget,dry}, multi-modal-sweep,
  completeness-critic, plus deferred niche shapes (tournament-bracket /
  self-repair-loop / staged-escalation). Each says *when* + skeleton + which
  bundled asset demonstrates it.
- **`references/api-reference.md`** — primitive signatures, every `agent()` opt
  (`label`/`phase`/`schema`/`model`/`isolation`/`agentType`), the cache-key four
  elements, and failure semantics. No invented options.
- **`assets/templates/`** — 5 control-flow skeletons (copy → fill).
- **`assets/examples/`** — 4 complete, real-prompt workflows
  (review-adversarial-verify, design-judge-panel, research-multimodal-sweep,
  migrate-discover-transform-verify).

Every bundled template and example is written to the harness contract, so any one
of them is a known-good starting point.
