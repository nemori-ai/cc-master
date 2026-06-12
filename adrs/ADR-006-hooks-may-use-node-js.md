# ADR-006 — Hooks may use bash + Node.js / JavaScript (JS only)

> Status: **Accepted** (supersedes ADR-001's "no `node`" stance; preserves its ship-anywhere spirit)
> Date: 2026-06-11
> Scope: All current + future hooks and the red-line-1 self-check. Corrects ADR-001 §2 and §4.2.
> Source: User (owner) correction — Claude Code is itself a Node application, so `node` is guaranteed wherever a hook fires; ADR-001's "no node" rested on a **model-backend vs CLI-host conflation**.
> Co-signed: user (owner)

---

## 1. Context

ADR-001 forbade `node` (and `jq`) in hooks on the premise that `node` "is not guaranteed to be on the hook's `PATH` in every managed runtime — including Amazon Bedrock, Google Vertex, and Azure AI Foundry."

That premise **conflated two different things**:

- the **model backend** (Bedrock / Vertex / Foundry) — *where the LLM runs*, and
- the **runtime host** — *where the Claude Code CLI runs*.

Hooks fire **only when the Claude Code CLI runs**, and the CLI **is itself a Node application** (distributed on npm, requires Node ≥ 18). So in any environment that can fire a hook, Node is present — *regardless* of which model backend is configured. Bedrock/Vertex/Foundry change where the model lives, not whether the CLI host has Node.

The cost of the misapplied "no node": hooks parse JSON with hand-rolled `grep`/`sed`/`awk` anchors (`verify-board.sh` is ~400 lines of escape-aware awk to do what `JSON.parse` does in one line; Finding #5 — a `}`/`"` in a field silently truncated by a `sed` anchor — is the documented cost), and **C2 "sense token usage inside the loop" was deemed impossible as a hook** (it needs to parse JSONL + compute, which the pure-bash rule forbade), leaving the orchestrator's #1 vision capability with no in-loop mechanism.

## 2. Decision

**Hooks may use bash and/or Node.js — running plain `.js` via `node`.**

- **JS only.** No TypeScript run directly: TS needs a transpile/runtime not universally present (native `node` type-stripping needs node ≥ 23.6; `tsx`/`ts-node` are not guaranteed), and a build step would break cc-master's "plugin = source, no build" form. Write and ship `.js`. **No build step.**
- **Still forbidden in hooks** (NOT guaranteed by Claude Code): `jq`, `python`, and any other runtime not bundled with the CLI. Unlike `node`, these are separate installs Claude Code does not guarantee.
- **Prefer bash for simple / high-frequency hooks.** A `node` process start costs ~tens of ms per fire — negligible for infrequent events (Stop / SessionStart / SubagentStop / PreCompact) but non-trivial for per-tool events (PostToolUse). Reach for `node` when **structured JSON parsing or computation** (usage from JSONL, deps-graph integrity, anything where bash string-parsing is fragile or impossible) earns its keep.
- **Ship-anywhere spirit preserved.** The rule was always "depend only on what Claude Code guarantees." That set simply, correctly, includes `node` — so this is a **factual correction, not a reversal of principle**.

## 3. Consequences

### 3.1 Positive

- **C2 becomes a hook.** A `node` hook (on `Stop` / `PostToolBatch`) can read the usage JSONL, compute the 5h/7d burn-rate (exactly what `scripts/cc-usage.sh` does in Python), and inject a pacing warning via `additionalContext` — turning "the loop never invokes the usage sensor" (prose, lost across compaction) into a deterministic runtime notification. The one gap that seemed permanently prose/script-only is now closeable.
- **Board parsing becomes trivial.** `JSON.parse` replaces hand-rolled anchors; the whole class of Finding #5 silent-truncation bugs disappears for any hook migrated to node.
- **New hooks are simpler and less fragile**, lowering the cost of the notification-channel hooks (SubagentStop / PostToolBatch / extended Stop·reinject).

### 3.2 Negative

- **`node` startup overhead** (~tens of ms) per fire — keep high-frequency hooks (per-tool `PostToolUse`) in bash or keep the node work minimal.
- **Residual `node`-on-`PATH` edge**: guaranteed for npm/global Claude Code installs; a **standalone-binary install** may bundle node without exposing `node` on `PATH`, where a `node`-invoking hook would fail. Mitigation if cc-master targets those: a `command -v node` guard with a bash fallback, or document the requirement. (Owner accepts this edge for the npm-install majority.)

### 3.3 Neutral

- **Existing bash hooks stay valid** — no mandate to rewrite `bootstrap-board.sh` / `reinject.sh` / `verify-board.sh`; migrate to node opportunistically where it simplifies.
- **ADR-003 narrow waist is unaffected** — node makes *reading* the waist easier; it does not change the pinned contract. (The "shell parsing is hard → keep the waist small" pressure relaxes, but the waist stays small for its own reasons — ADR-003.)

## 4. Alternatives Considered

### 4.1 Alternative A: keep pure bash (ADR-001 as-is)

Rejected. It rests on the corrected model-backend/host conflation and pays real costs (awk JSON parsers, Finding #5 truncation, C2 unclosable) to avoid a risk that does not exist where hooks actually run.

### 4.2 Alternative B: allow TypeScript directly

Rejected. TS needs a transpile/runtime not universally present, or a build step that breaks the "plugin = source" form. **JS only** keeps zero runtime assumptions beyond `node` itself.

### 4.3 Alternative C: allow `python` / `jq` too

Rejected. Unlike `node`, these are **not** guaranteed by Claude Code — allowing them reintroduces exactly the ship-anywhere risk ADR-001 rightly guarded against. The corrected boundary is precisely "what Claude Code guarantees = bash + node."

## 5. Related

- [`ADR-001-hooks-pure-bash.md`](ADR-001-hooks-pure-bash.md) — **superseded by this ADR** (Status → Superseded). Its ship-anywhere *spirit* is preserved; only the "no node" *fact* is corrected.
- [`ADR-002-ship-anywhere-scope.md`](ADR-002-ship-anywhere-scope.md) — ship-anywhere still holds; `node` *is* ship-anywhere (it ships with Claude Code).
- [`ADR-003-board-narrow-waist.md`](ADR-003-board-narrow-waist.md) — waist unaffected; node only eases reading it.
- [`../AGENTS.md`](../AGENTS.md) §3 red line 1 — revised in sync with this ADR.
- [`../design_docs/dogfood-findings.md`](../design_docs/dogfood-findings.md) — Finding #5 (awk truncation), the cost this removes.

## 6. References

- [`../design_docs/research/claude-code-hooks-reference.md`](../design_docs/research/claude-code-hooks-reference.md) — hook event capabilities (block / additionalContext).
- [`../design_docs/2026-06-11-orchestrator-as-program-redesign.md`](../design_docs/2026-06-11-orchestrator-as-program-redesign.md) — the hooks-as-runtime design that this constraint unblocks (esp. C2 as a node hook).
