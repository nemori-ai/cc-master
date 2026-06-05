# API reference — primitive signatures, opts, cache key, failure semantics

> Quick-ref for the `Workflow` tool contract. Every signature and option below is
> from the tool schema — **no invented options**. If an option is not listed
> here, it does not exist; do not pass it.

## `agent(prompt, opts?) → Promise<string | object>`

Spawn a fresh-context leaf subagent.

- **Return:** the leaf's final text (a `string`) when no `schema` is given; a
  **validated object** matching `schema` when one is given (validation is at the
  tool-call layer — no `JSON.parse`). A user-skipped agent returns **`null`**
  (hence `.filter(Boolean)`).

### `opts` (all optional)

| Option | Type | Meaning |
|---|---|---|
| `label` | string | Display name in `/workflows`. Purely decorative — **never** affects the cache. |
| `phase` | string | Joins the named progress group. Must match a `meta.phases[].title`. Decorative — never affects the cache. **Prefer `opts.phase` over a global `phase()` call inside concurrent `parallel`/`pipeline` stages** (avoids group-attribution races). |
| `schema` | JSON Schema | Force structured output; `agent()` returns the validated object. **Changing it invalidates the cache.** |
| `model` | string | Override the model. Default inherits the main-loop model — the contract says that is "almost always correct," so omit unless sure. **Changing it invalidates the cache.** |
| `isolation` | `'worktree'` | Run this agent in a fresh git worktree. Use **only** when parallel agents would edit the same files and conflict (≈200–500 ms + disk per agent). **Changing it invalidates the cache.** |
| `agentType` | string | Use a custom subagent type, resolved from the same registry as the Agent tool. **Changing it invalidates the cache.** |

## `parallel(thunks) → Promise<any[]>`  — BARRIER

- **Argument:** an **array of thunks** — `[() => agent(...), () => agent(...)]`.
  Never an array of promises (bare promises start immediately and bypass the
  concurrency limiter).
- **Barrier:** waits for **all** thunks; returns a result array in input order.
- **Failure:** a thrown thunk → `null` in its slot. The call **never rejects**.
  Always `.filter(Boolean)` afterward.
- **Cap:** ≤ 4,096 thunks per call.

## `pipeline(items, ...stages) → Promise<any[]>`  — NO BARRIER

- **Arguments:** an `items` array, then one or more stage callbacks.
- **Streaming:** each item flows through all stages independently — no barrier
  between stages.
- **Stage signature:** each stage callback receives `(prevResult, originalItem, index)`.
- **Failure:** a thrown stage drops that item to `null` and skips its remaining
  stages.
- **Cap:** ≤ 4,096 items per call.

## `phase(title) → void`

Opens a named progress group; agents spawned after it join the group. `title`
must exactly match a `meta.phases[].title`. Inside concurrent stages, prefer
`opts.phase` instead (race-free).

## `log(message) → void`

Emits one narrative line above the progress tree. Use it to **say out loud what
was dropped** — top-N truncation, no-retry, sampling — so silent narrowing does
not read as "full coverage."

## `workflow(nameOrRef, args?) → Promise<any>`

Inline-run another workflow and return its return value. Pass a saved workflow
name or `{scriptPath}`.

- **One level only:** calling `workflow()` *inside a child* throws.
- The child **shares** this run's concurrency cap, agent counter, abort signal,
  and token budget.
- An unknown name / unreadable path / child syntax error **throws** — `catch` it
  to degrade gracefully.

## `args` — injected global

The input value passed to the `Workflow` tool, exposed verbatim as a script
global. **Pass actual JSON values (arrays/objects), not JSON strings** — a
stringified list arrives as one `string`, and `args.filter` / `args.map` will
throw. `undefined` if nothing was passed.

## `budget` — injected global

`{ total, spent(), remaining() }`, a shared output-token pool.

- `budget.total` = the user's `'+500k'`-style target; `null` if none was set.
- `budget.spent()` = output tokens this turn, **shared across the main loop and
  all workflows** (not per-workflow).
- `budget.remaining()` = `max(0, total − spent())`; `Infinity` when there is no
  target.
- The target is a **hard ceiling**: once `spent()` reaches `total`, a new
  `agent()` call **throws**.
- **Always guard budget loops with `budget.total`:**
  `while (budget.total && budget.remaining() > 50_000) { ... }` — without the
  guard, `remaining()` is `Infinity` and the loop charges into the 1,000-agent cap.

## Cache key — the four elements (`agent()` resume identity)

Resume identity is content-based (§5 of `mechanism.md`). An `agent()` call's
cache identity is determined by **four** things:

1. `prompt`
2. `schema`
3. `model`
4. `isolation` (and `agentType`, which behaves the same way)

Changing any of these (or the `prompt` text) makes that call — and everything
after it — run live. `label` and `phase` are decorative and **never** part of the
cache key.

## Failure semantics (summary)

| Site | On error |
|---|---|
| `agent()` user-skip | returns `null` |
| `parallel()` thunk throws | that slot becomes `null`; the call never rejects |
| `pipeline()` stage throws | that item becomes `null`; its remaining stages are skipped |
| `workflow()` unknown/unreadable/nested | **throws** (catch to degrade) |
| `agent()` after `budget.total` exhausted | **throws** |
| `Date.now()` / `Math.random()` / arg-less `new Date()` | **throws** (determinism guard) |

## Hard caps (see `mechanism.md` §6)

- Concurrency: `min(16, cpu cores − 2)` per workflow.
- Total agents per run: 1,000.
- Items per `parallel`/`pipeline` call: 4,096.
- Script size: 512 KB.

## `meta` (the required script header)

The first statement must be `export const meta = { ... }`, a **pure literal**
(no identifiers, calls, template literals, or spreads). Required keys: `name`
(string), `description` (string). `phases: [{ title }]` is conventional and its
titles should match your `phase()` / `opts.phase` strings. The **harness
enforces all of this** — `meta` (pure literal + required keys) is validated at
launch; determinism / caps / escape-hatch violations throw at runtime. There is
no separate linter — the runtime is the authoritative check.
