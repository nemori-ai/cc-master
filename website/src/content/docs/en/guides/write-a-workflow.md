---
title: Write a workflow
description: When the work list is long and mechanical, hand it to a deterministic script — and keep a hundred intermediate results out of the agent's context.
section: guides
order: 3
deeper:
  - label: authoring-workflows SKILL.md — the full authoring contract
    url: https://github.com/nemori-ai/cc-master/blob/main/plugin/src/skills/authoring-workflows/canonical/SKILL.md
  - label: Harness compatibility matrix — where workflows exist
    url: https://github.com/nemori-ai/cc-master/blob/main/design_docs/harnesses/compatibility-matrix.md
---

A **dynamic workflow** takes the "what runs next" decision away from the LLM and gives it to a deterministic JavaScript script, executed by the harness runtime in the background. The LLM still does the thinking inside each step; the script owns the control flow — fan-out, sequencing, retries, dedup — and only the final synthesis comes back into context.

## Do you need one?

A workflow has real overhead. Reach for it only when both are true:

- You are coordinating **dozens to hundreds of agent calls** over a work list, and
- the intermediate results must stay **out of context** (fifty file reviews should not fill the orchestrator's window; the summary should).

Otherwise use the simpler mechanisms: a **subagent** for one independent implementation task, a **background shell** for zero-token waiting and polling. If the work fits in one prompt, none of this applies.

## The shape

Every workflow is one JS file. `meta` must be the first statement, a pure literal. Inside, `agent(prompt, options)` runs one LLM step; control-flow primitives compose them. Three rules the runtime enforces hard: no `Date.now()` / `Math.random()` / bare `new Date()` (they break resume), no `require` / Node builtins / `process.*` (sandbox), and `parallel()` takes **thunks**, not promises. Caps: 16 concurrent, 1,000 total agent calls, 512 KB.

## Pattern 1 — fan-out (barrier)

Independent tasks, and you need **all** results before moving on:

```js
export const meta = {
  name: 'locale-translate',
  description: 'Translate extracted strings into 6 locales concurrently.',
  phases: [{ title: 'Translate' }],
}
const locales = args ?? ['fr', 'de', 'es', 'ja', 'ko', 'zh']
const results = await parallel(locales.map((loc) => () =>
  agent(`Translate strings/en.json into ${loc}; write strings/${loc}.json`, { phase: 'Translate' })
))
return results.filter(Boolean)
```

## Pattern 2 — pipeline (the default)

Multi-stage work where item A can reach stage 2 while item B is still in stage 1. **Prefer this over a barrier** unless a later stage genuinely needs the whole previous batch (dedup, merge, compare-against-all):

```js
export const meta = {
  name: 'review-then-verify',
  description: 'Review each changed file, then adversarially verify every finding.',
  phases: [{ title: 'Review' }, { title: 'Verify' }],
}
const files = args ?? ['src/a.ts', 'src/b.ts']
const out = await pipeline(files,
  (f) => agent(`Review ${f}; return findings as a list`, { phase: 'Review' }),
  (findings, f) => agent(`Try to refute each finding for ${f}: ${JSON.stringify(findings)}`, { phase: 'Verify' }),
)
return out.filter(Boolean)
```

## Pattern 3 — loop until dry

Unknown-size discovery — find *all* of something. Counters miss the tail; consecutive empty rounds don't:

```js
export const meta = {
  name: 'bug-hunt',
  description: 'Keep hunting until 2 consecutive rounds find nothing new.',
  phases: [{ title: 'Hunt' }],
}
const DRY_LIMIT = 2
const seen = new Set(), all = []
let dry = 0
while (dry < DRY_LIMIT) {
  const r = await agent('Find bug candidates not yet seen; return { items: [...] }', {
    phase: 'Hunt',
    schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'] },
  })
  const fresh = (r?.items ?? []).filter((x) => !seen.has(x))
  if (fresh.length === 0) { dry++; continue }
  dry = 0
  fresh.forEach((x) => { seen.add(x); all.push(x) })
}
return all
```

Real workflows compose these: scout-then-fan-out, loop with an adversarial-verify gate, self-repair with a bounded retry. The skill ships 5 templates and 12 complete examples (bug hunts, PR triage, migration sweeps, tournament brackets) — start from the closest one instead of a blank file. And there is no separate linter to run: the harness validates `meta` at launch and determinism at runtime, so its errors are the authoritative checker. Read them, fix, relaunch.

## Harness support — read this first

Dynamic workflows are currently a **Claude Code-only** capability. Codex, Cursor, and kimi-code have no verified equivalent of the Workflow tool; on those hosts the skill ships as an explicit unsupported stub, and the orchestrator falls back to subagents and background shells for the same shapes. Check the compatibility matrix before designing a host-independent plan around `parallel()` / `pipeline()`.
