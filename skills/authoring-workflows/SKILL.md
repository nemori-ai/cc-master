---
name: authoring-workflows
description: Use when writing a Claude Code dynamic-workflow script — picks the right paradigm (fan-out/pipeline/loop), validates the script with a runnable linter before running, and points to mechanism/patterns/api references plus templates and examples.
---

# Authoring dynamic workflows

A dynamic workflow moves the "what runs next" decision out of the LLM and into a
deterministic JavaScript script that a runtime executes in the background. Use
this skill when you are about to write one. The discipline here is small: **be
honest about whether you need a workflow, pick the paradigm by its shape, and let
a runnable linter — not prose self-checking — be the gate before you launch.**

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

## 3. Author flow — draft, then validate before launching

1. **Draft** from a skeleton in `assets/templates/` (or a full composition in
   `assets/examples/`). Fill in the real prompts, schemas, and work-list. Keep
   `meta` a pure literal with `name` + `description` as the first statement.
2. **Validate with the runnable linter — this is the gate, not prose
   self-checking.** Run:

   ```sh
   node scripts/validate-workflow.mjs <your-script.js>
   ```

   It deterministically checks meta-first / pure-literal meta, the determinism三禁
   (`Date.now` / `Math.random` / arg-less `new Date()`), escape hatches
   (`require` / node-builtin imports / `process.*`), and that `parallel()` is
   given thunks, not bare promises. **Fix every ERROR before launching** — exit
   code `0` is clean, `1` means at least one ERROR. A workflow that fails the
   linter will not resume correctly and may not run at all.
3. **Launch** only after the linter is clean.

This mirrors the orchestration principle "trust only deterministic endpoint
verification, not prose self-check": the linter is the endpoint check.

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

Every bundled `.js` is itself kept linter-clean, so any template or example is a
known-good starting point.
