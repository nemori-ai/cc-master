---
path: plugin/src/skills/_hosts/kimi-code/AGENTS.md
version: v0.1
last-edited: 2026-07-16
content-summary: |
  kimi-code skill adapter host base. Shared SAP projection rules for the Moonshot kimi-code CLI agent.
---

# kimi-code Skill Host Base

kimi-code adapter projects each `plugin/src/skills/<skill>/canonical/` to `plugin/dist/kimi-code/skills/<skill>/` when `adapters/kimi-code/strategy.yaml` is `mode: copy` (or `unsupported_stub`). kimi discovers plugin skills via the managed plugin manifest `skills: "./skills/"` field (user-level `$KIMI_CODE_HOME/skills/` + `~/.agents/skills/`; project-level `.kimi-code/skills/` + `.agents/skills/` are the non-plugin discovery roots).

Skill frontmatter aliases kimi accepts (`normalizeMetadata`): `name`, `description` (both required for a directory skill), `type` (`prompt` default), `whenToUse` (`when-to-use` / `when_to_use`), `disableModelInvocation` (`disable-model-invocation` / `disable_model_invocation`), `arguments`. The canonical `name` + `description` frontmatter projects unchanged.

Path token rules:

- Skill prose that references its own bundled resources uses `${KIMI_SKILL_DIR}/...` — kimi does documented text substitution (`content.replaceAll`) on `${KIMI_SKILL_DIR}` in skill/command bodies. This is stronger than Cursor (which has no skill-body path token).
- Do **not** write `${KIMI_PLUGIN_ROOT}` in skill prose — it is only a hook/MCP subprocess env, never substituted in bodies (`grep` count 0).
- Do **not** project `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_SKILL_DIR}` into kimi skill bodies. Cross-skill references stay bare skill names (no leading `/`).
- Hook scripts get the install root from launcher-injected `CC_MASTER_PLUGIN_ROOT` (or `$KIMI_PLUGIN_ROOT` in the manifest hook command); see `capabilities.yaml` path_tokens.

Projection rules:

- Copy the host-neutral canonical body; do not copy Claude-only guidance. Where canonical has `{{SLOT}}` markers, provide a kimi overlay under `adapters/kimi-code/overlays/`.
- A capability with no verified kimi equivalent projects as `unsupported_stub` (e.g. `authoring-workflows` — no Workflow tool). The stub description keeps routing language + the gap boundary.

Dispatch / quota facts live in `capabilities.yaml`:

- Background dispatch: built-in subagent roles (coder/explore/plan/general + Agent Swarm; no custom roles) via the Task tool, plus the `Bash` tool background task (not Cursor's `Shell`).
- Workflow: unsupported → `authoring-workflows` stays `unsupported_stub`.
- Watchdog: degrade to the background-Bash floor (no agent-facing CronCreate / ScheduleWakeup / Monitor).
- Quota: **no CLI quota signal at all** — `ccm usage` returns `available:false`; no 5h/7d/billing-period pacing, no account switch.
- Command surface: host-native plugin `commands[]`, namespaced `cc-master:<command>`.
