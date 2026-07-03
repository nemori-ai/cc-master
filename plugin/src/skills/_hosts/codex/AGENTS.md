---
path: plugin/src/skills/_hosts/codex/AGENTS.md
version: v0.1
last-edited: 2026-07-03
content-summary: |
  Codex skill adapter host base。记录 cc-master SAP 投影到 Codex skill surface 的共同规则。
---

# Codex Skill Host Base

Codex project skills are discovered from `.agents/skills`. Codex plugin/runtime skill packaging is still an adapter track, so this host base currently governs skill projection only.

Known facts verified on 2026-07-03:

- Codex project skills live in `.agents/skills`, not `.codex/skills`.
- Codex follows symlinked skill folders.
- Codex `SKILL.md` does not perform runtime path variable substitution.
- Codex CLI 0.142.5 does not expand `${CODEX_PLUGIN_ROOT}` in hook commands and does not expose `CODEX_PLUGIN_ROOT` in hook env.

Projection rules:

- Never copy Claude Code-only tool instructions into Codex dist unless the strategy explicitly marks them safe.
- If a skill depends on unported Claude Code capabilities, use `mode: unsupported_stub`.
- Do not invent Codex path tokens; use absolute install-time paths or a verified Codex mechanism only after a probe.
