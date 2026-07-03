# Agent Harness 资料库

本目录沉淀 cc-master 的多 agent harness 兼容资料。它从 paragoge 的 CLI + plugin source-to-adapter 体系中迁移了可复用知识，但所有 host 事实已经按本仓资料和实测重新校对。

## 文档地图

- `compatibility-matrix.md`：Claude Code 与 Codex 的 plugin / skill / hook / command / memory 兼容矩阵。
- `claude-code.md`：Claude Code adapter 事实和本仓落点。
- `codex.md`：Codex adapter 事实、实测结论和当前风险。
- `skill-host-coupling-audit.md`：`plugin/src/skills/*/canonical` 里 Claude Code 专有指导的盘点，以及应抽成 host capability / path token / overlay 的落点。
- `skill-adaptation-task-list.md`：skills 多 host adapter 化的跟踪清单。
- `../plans/2026-07-03-plugin-harness-neutral-commands-hooks.md`：commands / hooks / Codex skills adapter 化实施计划与任务清单。
- `ccm-host-coupling-audit.md`：`ccm` CLI / engine 源码中绑定 Claude Code config、statusline、credentials、plugin manager 的盘点。
- `paragoge-import-audit.md`：从 paragoge 迁移了什么、修正了什么、哪些结论不能沿用。

## 当前状态

- `claude-code` 是当前唯一发布 adapter。
- `codex` 是下一阶段 adapter；本仓已经同步项目 meta-skills 到 `.agents/skills`，但 runtime plugin adapter 尚未发布。
- `plugin/src -> plugin/dist/<host>` 是架构边界；`plugin/dist` 只作为生成产物。

## 资料来源

- paragoge 的兼容矩阵、agent mechanism 文档、SAP/PHIP host 目录规范。
- cc-master 的 Claude Code hooks 研究：`design_docs/research/claude-code-hooks-reference.md`。
- Codex 官方 manual，本次校对日期：2026-07-03。
- Codex CLI 0.142.5 本地 probe，本次校对日期：2026-07-03。
