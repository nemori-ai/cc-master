---
title: Getting started
description: Install ccm and the plugin, fire your first orchestration, and learn the handful of commands you will actually type.
section: start
order: 1
deeper:
  - label: README — full install and everyday-use reference
    url: https://github.com/nemori-ai/cc-master/blob/main/README.md
  - label: Feature manual — what is shipped vs. still on the way
    url: https://github.com/nemori-ai/cc-master/blob/main/design_docs/feature-manual.md
  - label: Sample orchestration walkthrough — watch one run end to end
    url: https://github.com/nemori-ai/cc-master/blob/main/examples/sample-orchestration/walkthrough.md
---

cc-master has two installable pieces: **`ccm`**, the engine CLI that owns all state, and the **plugin**, which teaches your agent harness to orchestrate. One installer sets up both. `ccm` is a hard prerequisite — without it the plugin refuses to start an orchestration — so the installer always places it first.

## Install

```bash
# latest of both version lines (plugin + ccm)
curl -fsSL https://raw.githubusercontent.com/nemori-ai/cc-master/main/install.sh | bash

# pin either line independently — the two release on separate tracks
curl -fsSL https://raw.githubusercontent.com/nemori-ai/cc-master/main/install.sh | bash -s -- \
  --ccm-version ccm-v0.21.0 --plugin-version v0.20.1

# target one harness, or fan out to every supported harness on the machine
curl -fsSL https://raw.githubusercontent.com/nemori-ai/cc-master/main/install.sh | bash -s -- --harness claude-code
curl -fsSL https://raw.githubusercontent.com/nemori-ai/cc-master/main/install.sh | bash -s -- --all-harnesses
```

The installer detects your OS/arch, downloads the right `ccm` binary, verifies every downloaded asset against the release's `SHA256SUMS`, then installs the adapter for each detected harness. A checksum mismatch stops the install — treat it as a release-integrity failure, not a prompt to bypass.

**Requirements:** Node.js 22+, `unzip`, and a SHA256 tool (`sha256sum`, `shasum`, or `openssl`); online installs also need `curl` or `wget`. Claude Code installation uses the `claude` CLI (≥ v2.1.195). Supported harnesses: Claude Code, Codex, Cursor, kimi-code. `ccm` ships for Linux and macOS (x64/arm64); Windows is not supported yet.

## Verify the install

```bash
ccm --version
```

Then start a session in your harness and use its entrypoint:

| Harness | Start an orchestration |
|---|---|
| Claude Code | `/cc-master:as-master-orchestrator <goal>` |
| Codex | `$cc-master-as-master-orchestrator <goal>` |
| Cursor | `/as-master-orchestrator <goal>` |
| kimi-code | `cc-master:as-master-orchestrator <goal>` |

Add `--resume` to any of them to take over an existing board instead of starting fresh.

## Your first orchestration

Give it a goal that has real shape — one shared foundation, then independent parallel work:

```
/cc-master:as-master-orchestrator Internationalize the app to 6 locales
  (i18n framework + per-locale translation + locale routing)
```

Here is what happens after you hit enter:

1. **Bootstrap.** The entrypoint fires the bootstrap hook, which creates a **board** — one JSON file under `~/.cc_master/boards/` that becomes the single source of truth for this run.
2. **Goal Contract.** Your sentence is treated as evidence, not as the plan. The orchestrator rewrites it into a short, testable Goal Contract and asks you only about ambiguities that would change the outcome — then confirms it before any task exists.
3. **DAG.** The goal is sliced into a dependency graph: extract strings and wire the framework first, then six locale tasks that can all run at once.
4. **Parallel dispatch.** Ready tasks go to background workers immediately — the groundwork may get a stronger model tier, the mechanical translations a cheaper one.
5. **Decision package.** When a call is genuinely yours ("translate product terms or keep them in English?"), it surfaces with context and options — while everything that doesn't depend on the answer keeps running.
6. **Endpoint verification.** A green gate or a worker's self-report never counts as done. The orchestrator verifies each result independently before marking it `done`.
7. **Stop.** `/cc-master:stop` runs a completion check against the Goal Contract, then archives the board. You can `--resume` it later — even from a different session or harness.

## The everyday five

The in-session commands are harness-specific; `ccm` commands always run in your terminal.

- **Status** — `ccm status-report show`: progress, blockers, critical path, next actions.
- **Watch** — `ccm web-viewer open`: the live plan as a read-only graph in your browser.
- **Answer a waiting decision** — `/cc-master:discuss <decision>` (Codex: `$cc-master-discuss`, Cursor: `/discuss`, kimi-code: `cc-master:discuss`).
- **Stop** — `/cc-master:stop` (Codex: `$cc-master-stop`, Cursor: `/cc-master-stop`, kimi-code: `cc-master:stop`). Archives the board; resumable later.
- **Resume** — add `--resume` to your harness entrypoint; the new session reconciles live evidence and picks up from the breakpoint.

## Honest limits

Not every harness gets every capability. kimi-code ships the skills, commands, and core hooks but has no custom subagent roles, no Workflow equivalent, and no CLI quota signal; Codex and Cursor never auto-switch accounts; Cursor paces against its billing period. The Feature Manual (linked below) is the honest current/partial/target boundary — check it before assuming a capability exists on your harness.
