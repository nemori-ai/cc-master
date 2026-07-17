---
title: Add a hook
description: A new hook is a small script — but it must sleep until armed, speak in labeled messages, and run on bash or Node alone.
section: guides
order: 2
deeper:
  - label: ADR-006 — why hooks may use bash + Node (and nothing else)
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-006-hooks-may-use-node-js.md
  - label: ADR-007 — the arming gate every hook must pass
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-007-hook-arming-gate.md
  - label: ADR-018 — the ambient/advisory/directive injection protocol
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-018-hook-agent-message-protocol.md
---

Hooks let you react to harness lifecycle events — session start, prompt submit, pre/post tool use, stop — with logic the agent cannot see and cannot skip. They are also the most constrained surface in the project, because a hook fires in **every** session of the harness, whether or not an orchestration is running. Three hard rules keep that safe.

## Rule 1: bash or Node, nothing else

A hook must run on any machine that can run the harness CLI: **bash, or Node with the standard library only**. No `jq`, no Python, no `tsx`, no npm dependencies. Use bash for simple high-frequency hooks and Node when you need real JSON parsing or computation. Reach the board and engine state exclusively through the `ccm` binary (shell + JSON) — never import engine code.

## Rule 2: dormant until armed

Your hook's first act, on every fire, is the arming check: is there a board in `<home>/boards/` with `owner.active: true` and `owner.session_id` matching the stdin payload? If not — empty stdout, exit 0, no block. A hook that talks in a non-orchestration session is a bug, full stop.

You do not implement this from scratch. The shared `hook-common.js` library owns the predicate (`isArmed`, `boardMatches`, `listMatchingBoards`) and a `runHook(spec)` harness that wraps your hook body: arming gate first, then your logic, with all exceptions caught into a silent exit 0. Node hooks delegate arming through `runHook({ arm: 'boards' })` (harness fills matching boards for you) or `arm: 'custom'` when the body needs its own composite gate. Read-only narrow-waist fields only — `owner.active`, `owner.session_id` — to decide arming.

Two corollaries:

- **Fail open.** A crashing guard must never freeze the agent. Unexpected error → silent exit 0. (The exception is bootstrap's prerequisite check, which fails loud by design — that is the arming action itself.)
- **Writes are whitelisted.** Hooks read the board's narrow waist and nothing else. The only sanctioned write is `ccm board set-param` against the `runtime.*` parameter namespace (e.g. recording when your hook last nudged), under the same lock and lint as any write.

## Rule 3: label every injection

Anything your hook prints reaches the agent as in-context text, and in-context text always steers. Wrap every message in one of the three protocol tags, with `source` naming your hook:

- `<ambient source="my-hook">` — background facts; updates the world model, not a to-do.
- `<advisory source="my-hook" strength="weak|strong">` — a recommendation the agent weighs. Most hooks should live here.
- `<directive source="my-hook">` — a hard gate; reserve for genuine constraints, and always include the **why** plus what to do instead.

Pick the lowest class that does the job. An advisory dressed as a command trains the agent to ignore real directives.

## Where the files go

Hooks follow the PHIP layout — a host-neutral contract plus per-host implementations:

```
plugin/src/hooks/_manifest/hooks.yaml          # registry: id, stage, per-host coverage
plugin/src/hooks/<your-hook>/CONTRACT.md       # business rules, host-neutral (SSOT)
plugin/src/hooks/<your-hook>/implementations/
  claude-code/<your-hook>.js + meta.yaml       # one dir per supported host
  codex/…
```

Declare the hook in `_manifest/hooks.yaml` with its stage and an honest coverage value per host (`implemented`, `unsupported`, or a qualified middle state). If the hook ships on more than one host, the CONTRACT is the shared source of truth — business-rule changes land in every covered host's implementation in the same PR, or the CONTRACT's degradation section must say why not.

## Test it

Hook tests are bash, in `tests/hooks/`, and run through `bash run-tests.sh`. Test the three shapes that matter: **unarmed** (silent, exit 0), **armed + trigger** (produces the labeled message or the gate decision), and **garbage input** (fail-open). For multi-host hooks, the parity fixture suite runs one host-neutral stdin against each implementation and expects the same decision class.

Then regenerate the adapters (`bash scripts/sync-plugin-dist.sh --host <host>`) and re-run the suite before opening the PR.
