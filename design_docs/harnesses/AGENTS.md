---
path: design_docs/harnesses/AGENTS.md
version: v1.0
last-edited: 2026-07-09
agent-edit-policy: |
  本目录是 cc-master 的 agent harness 机制资料库。它吸收 paragoge 的可复用资料，
  但不是 paragoge 的镜像；任何事实都要按本仓当前目标校对后再落地。
content-summary: |
  记录 Claude Code / Codex / Cursor (IDE Agent) 等 agent harness 的 plugin、skill、hook、
  command、project memory 机制事实，以及 cc-master 的 source-to-adapter 投影决策。
---

# Harness 资料维护规则

本目录是本仓多 agent harness 兼容工作的本地资料源。不要把 `../paragoge` 当成长期依赖；需要 paragoge 经验时，先读本目录。

## 证据优先级

1. 本仓针对当前目标版本的实测结果。
2. 当前官方文档或官方 CLI/manual。
3. 本仓已有研究资料，例如 `design_docs/research/claude-code-hooks-reference.md`。
4. paragoge 旧资料，用作架构启发和待校对输入，不直接作为事实源。

## 更新纪律

- 写入 host 事实时，标明日期、来源、版本或 probe 结论。
- 文档与实测冲突时，以实测为准，并在 `paragoge-import-audit.md` 记录修正。
- 新增 host adapter 前，先补本目录的 host 机制页和兼容矩阵，再改 `plugin/src`。
- 不在 runtime skill 中引用本目录；这里是开发者资料，不随插件分发。
