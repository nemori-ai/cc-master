---
path: plugin/src/hooks/_hosts/claude-code/AGENTS.md
version: v0.1
last-edited: 2026-07-03
content-summary: |
  Claude Code hook adapter host base。记录 PHIP 投影到 Claude Code hooks.json + hooks/scripts 的规则。
---

# Claude Code Hook Host Base

Claude Code adapter 投影规则：

- registration source：`plugin/src/hooks/_hosts/claude-code/hooks.json`
- script source：`plugin/src/hooks/<hook>/implementations/claude-code/*`
- dist registration：`plugin/dist/claude-code/hooks/hooks.json`
- dist scripts：`plugin/dist/claude-code/hooks/scripts/*`

Hook command 中使用 `${CLAUDE_PLUGIN_ROOT}/hooks/scripts/<script>`。
