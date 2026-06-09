# ADR-001 — Hooks are pure bash

> Status: **Accepted**
> Date: 2026-06-08
> Scope: All three hook scripts (`hooks/scripts/bootstrap-board.sh`,
> `reinject.sh`, `verify-board.sh`) and their test suite. Constrains every future
> hook and any board-field the hooks must parse.
> Source: cc-master design invariant #1 (CONTRIBUTING.md); reconfirmed during the
> goal-hook design (`design_docs/2026-06-08-goal-hook-design.md` hard constraints).

---

## 1. Context

cc-master's deterministic skeleton is three Claude Code hooks: a UserPromptSubmit
hook that bootstraps the board, a SessionStart hook that re-injects role + board
after compaction, and a Stop hook that gates "don't stop while work remains." Each
hook receives JSON on stdin (session id, prompt, etc.) and must read the board
file, which is itself JSON.

The obvious way to parse JSON is `jq`, or to shell out to `node` (Claude Code
already requires Node). But a hook runs in a shell that is **blind to agent
context** and must execute on **every platform cc-master ships to** — including
managed runtimes like Amazon Bedrock, Google Vertex, and Azure AI Foundry, where
`jq` is not guaranteed to be installed and the Node toolchain available to the
agent is not guaranteed to be on the hook's `PATH`. A hook that silently fails
because `jq` is missing would break the single deterministic guarantee the whole
design rests on.

## 2. Decision

**Hooks are pure bash. No `jq`, no `node`, no other runtime.**

- All JSON the hooks touch (stdin payload + board file) is parsed with POSIX shell
  tools only: `grep -oE`, `sed -n 's/.../\1/p'`, `cksum`, `awk`, `case` globs.
- The narrow waist (ADR-003) is deliberately kept small precisely so that
  shell-string parsing of it stays tractable.
- Robustness against the absence of structured parsing is bought with explicit
  pattern anchors and decoy-key hardening (e.g. counting `"id"` keys, anchoring
  the session-id extraction) rather than a JSON library.
- The test suite (`run-tests.sh`) and `claude plugin validate .` are the gate; a
  hook that introduces `jq`/`node` is rejected. Red-line self-check:
  `grep -rE 'jq|node' hooks/scripts/` must be empty.

## 3. Consequences

### 3.1 Positive

- **Ship-anywhere**: the deterministic skeleton runs identically on standard
  Claude Code, Bedrock, Vertex, and Foundry — no install step, no dependency
  probe, no graceful-degradation branch.
- **Deterministic + dependency-free**: behavior cannot vary by which version of
  `jq` is on the box; the only requirements are bash and (for the Node content
  contract test, not the hooks themselves) Node 22+.
- **Forces a small waist**: the cost of shell parsing keeps the board contract
  minimal, which is independently good (ADR-003).

### 3.2 Negative

- **String handling is verbose and fragile by nature**: extracting nested values
  needs hand-rolled `sed`/`grep` anchors; certain payloads bite (Finding #5 — a
  `goal_condition` containing `}` or `"` was silently truncated by a `sed`
  anchor, which is exactly the failure mode this constraint accepts as its cost).
- Each new field a hook must read costs more than it would with `jq`, which is a
  standing pressure to keep the waist small.

### 3.3 Neutral

- Tests must cover decoy keys and adversarial strings, because the parser cannot
  rely on a real JSON grammar.

## 4. Alternatives Considered

### 4.1 Alternative A: parse JSON with `jq`

Rejected. `jq` is not guaranteed present on Bedrock / Vertex / Foundry. Either we
ship a dependency probe + degradation path (complexity, and a silent-failure risk
if the probe is wrong), or we accept that the deterministic guarantee is only
deterministic where `jq` happens to be installed. Both defeat the purpose.

### 4.2 Alternative B: shell out to `node` for parsing

Rejected. Node is required to *run* Claude Code, but the hook's shell environment
is not guaranteed to have `node` on `PATH` in every managed runtime, and invoking
the agent's Node toolchain from inside a deterministic gate couples the gate to a
heavier, slower, less predictable runtime. The whole value of the skeleton is that
it is the one part that does not depend on the LLM or its environment.

## 5. Related

- [`ADR-002-ship-anywhere-scope.md`](ADR-002-ship-anywhere-scope.md) — the broader
  ship-anywhere constraint this is one instance of.
- [`ADR-003-board-narrow-waist.md`](ADR-003-board-narrow-waist.md) — the small
  waist that keeps shell parsing tractable.
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — design invariant #1 (the red line).
- [`../design_docs/dogfood-findings.md`](../design_docs/dogfood-findings.md) —
  Finding #5 (silent truncation), the documented cost of string-only parsing.

## 6. References

- `design_docs/2026-06-08-goal-hook-design.md` — hard constraints: "hook pure
  bash, no jq/node, ship-anywhere (incl. Bedrock/Vertex/Foundry)."
