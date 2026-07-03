---
path: plugin/src/skills/_hosts/claude-code/AGENTS.md
version: v0.1
last-edited: 2026-07-03
content-summary: |
  Claude Code skill adapter host base。记录 cc-master SAP 投影到 Claude Code skill surface 的共同规则。
---

# Claude Code Skill Host Base

Claude Code adapter 把每个 `plugin/src/skills/<skill>/canonical/` 投影到 `plugin/dist/claude-code/skills/<skill>/`。

路径变量规则：

- 跨 plugin 文件引用使用 `${CLAUDE_PLUGIN_ROOT}`。
- 当前 skill 自己目录内脚本或资产可使用 `${CLAUDE_SKILL_DIR}`。
- 持久数据使用 `${CLAUDE_PLUGIN_DATA}`，不要写入 `${CLAUDE_PLUGIN_ROOT}`。

