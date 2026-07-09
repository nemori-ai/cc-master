# Paragoge Import Audit

更新时间：2026-07-09。

本文件记录从 `../paragoge` 迁移到 cc-master 的长期有效资料，以及迁移时做过的校对和修正。以后不要为了同一批资料反复读取 `../paragoge`；优先读 `design_docs/harnesses/`。

## Migrated Concepts

采用并落地的 paragoge 体系：

- `plugin/src -> plugin/dist/<host>` 的 source-to-adapter 投影模型。
- SAP：runtime skill canonical source + per-host adapter strategy。
- PHIP：hook contract / lifecycle manifest + host-native implementation。
- Host adapter 边界：manifest、skills、hooks、commands、project memory、path token、validator 分开处理。
- 兼容矩阵写法：按 harness surface 对比，而不是按文件树对比。

已在本仓落地的位置：

- `plugin/src/skills/<skill>/canonical/`
- `plugin/src/skills/<skill>/adapters/claude-code/strategy.yaml`
- `plugin/src/hooks/_manifest/`
- `plugin/src/hooks/_hosts/claude-code/`
- `plugin/src/hooks/<hook>/implementations/claude-code/`
- `scripts/sync-plugin-dist.sh`
- `.claude/skills/harness-plugin-architecture/`
- `.claude/skills/adapter-projection-engineering/`
- `.claude/skills/plugin-release-engineering/`

## Corrected Facts

### Codex project skills

paragoge 资料中曾把 Codex skill/project memory 机制写得不够确定。本仓按 Codex 官方 manual 校正：

- Codex 项目级 skills 目录是 `.agents/skills`。
- 本仓不使用 `.codex/skills`。
- Codex 支持 symlinked skill folders，因此 `.agents/skills` 可以由 `.claude/skills` 生成 symlink。

### Codex hook path token

paragoge 旧实现曾尝试使用 `${CODEX_PLUGIN_ROOT}` 一类 token。本仓对 Codex CLI 0.142.5 的 probe 表明：

- plugin-bundled hook 会被发现；
- 绝对路径 hook command 可以执行；
- `${CODEX_PLUGIN_ROOT}` 不会在 hook command 中展开；
- hook 环境里没有 `CODEX_PLUGIN_ROOT`。

因此 Codex adapter 不得依赖 `${CODEX_PLUGIN_ROOT}`，除非后续官方文档和本地 probe 同时证明它可用。

### Codex hooks key and events

paragoge 2026-05 资料中 Codex hooks 信息已落后。本仓按 2026-07-03 获取的 Codex manual 修正：

- 当前稳定配置 key 是 `hooks`。
- `codex_hooks` 是 deprecated alias。
- 事件集合比旧资料更广，新增 adapter 前必须按当前 manual 和 probe 重新列入 `_hosts/codex/`。

### Claude Code hooks

Claude Code hooks 以本仓 `design_docs/research/claude-code-hooks-reference.md` 为准。paragoge 的 Claude Code hook 文档可作为历史输入，但不能覆盖本仓已确认的结论：

- hook runtime 可用 bash + node/JS；
- additionalContext、blocking 行为和事件字段按本仓 hooks research 维护；
- cc-master hooks 还必须满足 dormant-until-armed。

### Cursor harness

paragoge **未覆盖** Cursor。本仓 2026-07-09 按 Cursor 官方文档（hooks / skills / plugins / rules / third-party hooks）+ 对 Claude Code / Codex adapter 的对照推导，新增 [`cursor.md`](cursor.md) 作为第三 harness 调研落盘。

- 事实来源：官方 docs 2026-07-09；**无本仓 probe**（见 `cursor.md` §Dogfood Backlog）。
- 未从 paragoge 复制任何 Cursor 机制。
- MVP adapter（`plugin/dist/cursor`、ccm `cursor.ts`、install）**未实现**；用户审阅调研后再决定。

## Non-migrated Material

未整体迁移 paragoge 的以下内容：

- 与 cc-master 当前目标无关的 host 细节，例如 opencode、Kimi CLI、OpenClaw 等。（Cursor 已单独调研落盘，见上节。）
- paragoge 的技能优化、eval、论文 survey 全量资料。
- paragoge 的具体 product positioning 和 requirement backlog。

这些资料可以将来按需引入，但必须走本目录的校对规则，而不是原样复制。

## Maintenance Rule

当 paragoge、官方文档、实测三者冲突时：

```text
current probe > current official docs > cc-master research > paragoge old docs
```

如果没有 probe，不要把不稳定的 host 机制写成已验证事实。
