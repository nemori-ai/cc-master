# Host Adapter 边界

## Host 事实不能靠猜

新增 host adapter 前，先确认该 host 当前机制：

- plugin manifest 位置和 schema
- skill discovery 位置
- skill frontmatter / sidecar 支持范围
- hook 配置位置、event、payload、decision output
- command/slash-command 支持方式
- runtime path variables 和 environment variables
- trust / permission / sandbox 行为

如果文档与实测冲突，以实测当前目标版本为准，并把冲突写入 host base。

本仓的校对版 host 事实库在 `design_docs/harnesses/`：

- `design_docs/harnesses/compatibility-matrix.md`
- `design_docs/harnesses/claude-code.md`
- `design_docs/harnesses/codex.md`
- `design_docs/harnesses/cursor.md`
- `design_docs/harnesses/capabilities/` — cross-surface Capability INTENT cards (ADR-031)
- `design_docs/harnesses/paragoge-import-audit.md`

这些文件已经吸收 paragoge 的可复用资料，并按本仓 Claude Code 研究与 Codex 实测修正。不要为了同一批事实默认回读 `../paragoge`。

## Path token 策略

不要把某个 host 的 path token 写成共享 canonical 事实。

Claude Code 已验证可用：

- `${CLAUDE_PLUGIN_ROOT}`
- `${CLAUDE_SKILL_DIR}`
- `${CLAUDE_PLUGIN_DATA}`

Codex 已验证事实：

- Codex project skills 读 `.agents/skills`，不是 `.codex/skills`。
- Codex `SKILL.md` 不做 path variable substitution。
- Codex CLI 0.142.5 中 plugin-bundled hook 会被发现，但 hook command 里的 `${CODEX_PLUGIN_ROOT}` 不展开，hook 环境里也没有 `CODEX_PLUGIN_ROOT`。

因此，跨 host canonical 里需要路径时，用中性 slot 或相对 runtime 约定，再由 adapter 投影。

## Strategy 文件该记录什么

`adapters/<host>/strategy.yaml` 至少记录：

- host
- skill 或 hook id
- source
- target
- copy / patch / overlay 规则
- path token rewrite
- host-specific metadata/permission decisions
- 当前不支持的 host gap

即使当前 host 是 no-op copy，也保留 strategy 文件，表示 adapter 被审视过。
