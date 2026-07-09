---
path: plugin/src/skills/_hosts/cursor/AGENTS.md
version: v0.1
last-edited: 2026-07-09
content-summary: |
  Cursor skill adapter host base. Shared SAP projection rules for Cursor IDE Agent.
---

# Cursor Skill Host Base

Cursor adapter projects each `plugin/src/skills/<skill>/canonical/` to `plugin/dist/cursor/skills/<skill>/` when `adapters/cursor/strategy.yaml` is `mode: copy` (or `unsupported_stub`).

Path token rules:

- Do **not** invent `${CURSOR_PLUGIN_ROOT}` / `${CURSOR_SKILL_DIR}` in skill prose — Cursor does not document skill-body path substitution.
- Skill bodies use plain relative paths inside the skill tree.
- Hook scripts get install root via launcher-injected `CC_MASTER_PLUGIN_ROOT` (or absolute command paths); see `capabilities.yaml` path_tokens.

Dispatch / quota facts live in `capabilities.yaml`:

- Background dispatch: Task (subagent) + Shell (`block_until_ms: 0`).
- Workflow: unsupported → `authoring-workflows` stays stub.
- Watchdog: degrade to background-shell floor.
- Quota: single `billing_period` (~30d), source `cursor-dashboard`; no account switch; no 5h/7d pacing.
