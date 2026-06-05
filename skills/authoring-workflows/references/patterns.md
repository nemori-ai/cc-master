# Patterns — orchestration shapes, when to use them, and where they live

> One section per pattern: *when to reach for it*, a minimal skeleton, and which
> bundled `assets/templates/` skeleton or `assets/examples/` workflow
> demonstrates it. The patterns are confirmed by the tool contract and the
> community catalog (ray-amjad, alexop.dev); see `mechanism.md` for the
> underlying semantics. The four niche shapes at the end are **prose only** —
> no bundled file.

Every bundled template and example is referenced from this page. Copy from a
template for the bare control-flow shape; copy from an example for a full,
real-prompt composition.

---

## fan-out + synthesize

**When:** a single task decomposes into independent parts that you need *all of*
before combining — "review every file in this diff," "audit all 40 dependencies,"
"map every struct field." Use `parallel()` because synthesis needs the whole set.

```js
const parts = await parallel(items.map((it) => () => agent(`work ${it}`)))
const summary = await agent(`synthesize:\n${JSON.stringify(parts.filter(Boolean))}`)
```

**Demonstrated by:** `assets/templates/fan-out.js` (the bare barrier shape).

---

## pipeline-by-default

**When:** multi-stage work where stages need **not** synchronize — item A can
reach stage 2 while item B is still in stage 1. This is the **default** for any
multi-stage shape; only escalate to a barrier when a stage truly needs the whole
previous set (see the smell-test in `mechanism.md` §3).

```js
const out = await pipeline(items,
  (it) => agent(`stage 1 for ${it}`),
  (prev, it) => agent(`stage 2 for ${it} using ${JSON.stringify(prev)}`),
)
```

**Demonstrated by:** `assets/templates/pipeline.js` (the bare streaming shape).

---

## adversarial-verify

**When:** findings must be trustworthy. For each finding, spawn skeptic agent(s)
that try to **refute** it (default `isReal = false`; insufficient evidence → kill
it). Keep only survivors. This is the canonical quality multiplier — independent
agents attack each other's claims until the answers converge.

```js
const verified = await pipeline(findings,
  (f) => agent(`Try to REFUTE this finding. Default isReal=false if unsure:\n${JSON.stringify(f)}`,
    { schema: { type: 'object', properties: { isReal: { type: 'boolean' } }, required: ['isReal'] } })
    .then((v) => ({ ...f, verdict: v })))
return verified.filter((f) => f.verdict?.isReal)
```

**Demonstrated by:** `assets/examples/review-adversarial-verify.js` (dimensions →
find → per-finding adversarial verify).

---

## perspective-diverse-verify

**When:** a finding can fail in several distinct ways, so a single verifier lens
misses redundant failure modes. Give each verifier a **different lens** —
correctness / security / performance / reproducibility — and require the finding
to survive all of them. The diverse-lens variant of adversarial-verify.

```js
const LENSES = ['correctness', 'security', 'performance', 'reproducibility']
const verdicts = await parallel(LENSES.map((lens) => () =>
  agent(`Verify this finding from the ${lens} angle — try to break it:\n${JSON.stringify(finding)}`,
    { label: `verify:${lens}` })))
```

**Demonstrated by:** `assets/examples/review-adversarial-verify.js` — its
`DIMENSIONS` (bugs / security / perf) carry the same diverse-lens idea across the
*find* stage; apply the same lens list to the *verify* stage when a finding
warrants it.

---

## judge-panel

**When:** the solution space is wide and "iterate one attempt" is weaker than
"generate several independent attempts and pick." Generate N approaches from
different angles (MVP-first / risk-first / user-first), score them with a parallel
judge, synthesize from the winner while grafting the best of the runners-up.

```js
const proposals = await parallel(ANGLES.map((a) => () => agent(`design from angle: ${a}`)))
const scored = await parallel(proposals.filter(Boolean).map((p) => () =>
  agent(`score 0-10:\n${JSON.stringify(p)}`, { schema: SCORE }).then((s) => ({ ...p, score: s.score }))))
const winner = scored.filter(Boolean).sort((a, b) => b.score - a.score)[0]
const final = await agent(`synthesize from the winner:\n${JSON.stringify(winner)}`)
```

**Demonstrated by:** `assets/examples/design-judge-panel.js`.

---

## loop-until-count

**When:** you have a concrete target count — "find 10 bugs," "produce 5 options."
Loop while the count is below target, but **always** keep a hard stop (the target
*is* the stop here; never write an unbounded `while`).

```js
const found = []
while (found.length < 10) {
  const r = await agent('find the next item not yet found')
  found.push(r)
}
```

**Demonstrated by:** the loop control-flow templates as a family — adapt
`assets/templates/loop-until-dry.js` by swapping the dry-round guard for a count
guard.

---

## loop-until-budget

**When:** depth should scale to the user's `'+Nk'` budget directive and the ideal
count is unknown. Loop while the shared token budget has headroom. The
`budget.total` guard is mandatory — without it, `remaining()` is `Infinity` and
the loop runs to the 1,000-agent cap.

```js
const RESERVE = 50_000
const out = []
while (budget.total && budget.remaining() > RESERVE) {
  out.push(await agent('produce the next batch'))
}
```

**Demonstrated by:** `assets/templates/loop-until-budget.js`.

---

## loop-until-dry

**When:** unknown-size discovery — find *all* bugs, *all* call sites. Counters
miss the tail; dry-rounds don't. Dedup against a `seen` set (not a `confirmed`
set, or rejected items reappear every round and the loop never converges), and
stop after K consecutive rounds that surface nothing new.

```js
const DRY_LIMIT = 2
const seen = new Set(), all = []
let dry = 0
while (dry < DRY_LIMIT) {
  const r = await agent('find items not yet in the seen set', { schema: ITEMS })
  const fresh = (r.items ?? []).filter((x) => !seen.has(x))
  if (fresh.length === 0) { dry++; continue }
  dry = 0
  fresh.forEach((x) => { seen.add(x); all.push(x) })
}
```

**Demonstrated by:** `assets/templates/loop-until-dry.js`.

---

## multi-modal-sweep

**When:** a question is best answered by searching from several **independent
angles** that catch different things — by keyword/grep, by entity/symbol, by
structure/architecture, by history/changelog. Sweep all angles, then dedup across
the whole set (a barrier *is* correct here — the dedup needs every angle's hits)
before the expensive deep-read.

```js
const swept = await parallel(ANGLES.map((a) => () => agent(`research the question ${a}`, { schema: HITS })))
const deduped = [...new Set(swept.filter(Boolean).flatMap((r) => r.hits ?? []))]
const reads = await pipeline(deduped, (ref) => agent(`deep-read ${ref}`))
```

**Demonstrated by:** `assets/examples/research-multimodal-sweep.js`.

---

## completeness-critic

**When:** you want to know what you *missed*, not just confirm what you found.
After the work, send one critic agent to ask "what is missing — an angle not
swept, a claim unverified, a source unread?" What it finds is the next round of
work. Pairs naturally with multi-modal-sweep and any discovery loop.

```js
const gaps = await agent(
  `Given these findings, what is MISSING — an unswept angle, an unverified claim, an unread source?\n${JSON.stringify(findings)}`)
```

**Demonstrated by:** `assets/examples/research-multimodal-sweep.js` (its final
`Critique` phase is exactly this critic).

---

## migrate / discover → transform → verify (with worktree isolation)

**When:** a migration touches many sites that you must (1) discover, (2) transform
each in isolation so parallel edits don't conflict, (3) verify with a gate. The
only shape that needs `isolation: 'worktree'` — each site transforms in its own
worktree so concurrent file edits never collide.

```js
const found = await agent('enumerate every migration site', { schema: SITES })
const out = await pipeline(found.sites ?? [],
  (site) => agent(`apply migration to ${site}, commit in your worktree`, { isolation: 'worktree' }),
  (prev, site) => agent(`verify the migration at ${site} (run the gate)`, { schema: VERIFY }).then((v) => ({ site, ...v })))
```

**Demonstrated by:** `assets/examples/migrate-discover-transform-verify.js` (the
only bundled asset using `isolation: 'worktree'`).

---

## scout-then-fanout (entry shape)

**When:** you don't know the work-list before the task — the most common real
entry shape. One scout agent returns the list; then pipeline/parallel over it.
(Often you scout inline in the main thread instead; this is the in-workflow
version.)

```js
const scout = await agent('enumerate the work items as a JSON list', { schema: ITEMS })
const out = await pipeline(scout.items ?? [], (it) => agent(`process ${it}`))
```

**Demonstrated by:** `assets/templates/scout-then-fanout.js`.

---

## Deferred niche shapes (prose only — no bundled file)

These are real shapes but too narrow to ship as their own template/example in v1.
Compose them from the primitives above when you actually need them.

**tournament-bracket.** When you have many candidates and want a single winner
via pairwise elimination rather than absolute scoring (judge-panel scores
*absolutely*; a bracket compares *relatively*). Run rounds: pair candidates, a
judge agent picks the winner of each pair, halve the field, repeat until one
remains. Each round is a `parallel()` over pairs; the loop over rounds is a
plain `while (field.length > 1)`. Use it when relative comparison is more reliable
than an absolute 0–10 score, and the field is large enough that scoring everyone
is wasteful.

**self-repair-loop.** When an agent's output must pass a gate and you want it to
fix its own failures up to a bounded number of attempts. Loop: produce → run the
gate → if it fails, feed the gate's diagnostics back into the next attempt's
prompt; stop on pass or after `MAX_ATTEMPTS`. This is loop-until-{count} with a
structured pass/fail gate instead of a counter, plus a hard attempt cap as the
fuse. Dedup-against-seen does **not** apply (it's the same item being repaired);
the fuse is the attempt count. Use it for "make this compile / pass tests"
single-artifact convergence — *not* for multi-finding discovery.

**staged-escalation.** When work should start cheap and only escalate to an
expensive model/approach when the cheap stage fails or returns low confidence.
A `pipeline()` whose stage 1 is a cheap pass and stage 2 is conditional — stage 2
short-circuits (returns the stage-1 result unchanged) when stage 1 already cleared
a confidence threshold, and only spawns the expensive `agent('escalate: ' + item, { model: ... })` when
it didn't. Use it to spend the strong model only where the weak model struggled,
rather than uniformly. Beware: `model` is part of the cache key (`api-reference.md`),
so the escalation branch reruns live on resume if you change the model choice.
