---
name: harness-plugin-architecture
description: 当你要把 cc-master 或类似项目设计/重构成多 agent harness 兼容的 CLI + plugin 架构时使用；覆盖 paragoge 式 source-to-adapter、SAP skills、PHIP hooks、host adapter 边界、path token 策略和目录不变量。
---

# 多 Harness 插件架构

你负责把项目维护成 paragoge 式的多 harness plugin/CLI 工程。先保护结构边界，再改具体实现。

## 先判断任务类型

- 改 runtime skill 语义：进入 `plugin/src/skills/<skill>/canonical/`。
- 改某 host 如何接收 skill：进入 `plugin/src/skills/<skill>/adapters/<host>/strategy.yaml` 和 `plugin/src/skills/_hosts/<host>/`。
- 改 hook contract：先改 `plugin/src/hooks/_manifest/`。
- 改某 host 的 hook 实现：进入 `plugin/src/hooks/<hook>/implementations/<host>/` 和 `plugin/src/hooks/_hosts/<host>/`。
- 改可安装产物：改 projection 脚本，不手改 `plugin/dist/<host>/`。
- 改发布、打包、版本线：读 `plugin-release-system.md`。

## 架构不变量

`plugin/src/` 是语义源，`plugin/dist/<host>/` 是生成产物。不要从 dist 反推 source，也不要在 dist 中手修 bug。

Skills 走 SAP：

```text
plugin/src/skills/<skill>/
  canonical/
  adapters/<host>/strategy.yaml
```

Hooks 走 PHIP：

```text
plugin/src/hooks/
  _manifest/
  _hosts/<host>/
  <hook>/implementations/<host>/
```

Commands 和 host manifests 可以先保持当前 host 源布局，但一旦出现第二个 host，就必须下沉到 host adapter 层，避免共享 source 带 host 假设。

## 工作流程

1. 先确认目标 host 和当前阶段：Claude Code only、Codex second host、还是通用多 host。
2. 列出会被改动的 projection surface：skills、hooks、commands、manifest、CLI install、release package。
3. 对每个 surface 明确 source-of-truth 和 generated output。
4. 改 source，并运行 projection。
5. 验证 host-native dist，而不是只验证 source。

## 何时读 references

- 设计或审查 `plugin/src` / `plugin/dist` 边界：读 `references/source-to-adapter.md`。
- 新增或修复 host adapter：读 `references/host-adapter-boundaries.md`，再读 `design_docs/harnesses/<host>.md` 和 `design_docs/harnesses/compatibility-matrix.md`。
- 盘点 runtime skill 正文里哪些内容该模块化 / 变量化 / overlay：读 `design_docs/harnesses/skill-host-coupling-audit.md`。

## Skill adapter 纪律

- 默认模式是 canonical + slot/overlay。一个 skill 的方法论只应该有一份 canonical。
- `unsupported_stub` 只用于该 skill 的核心方法论在某 host 下确实不可用；如果只是机制不同，抽 slot。
- `partial_overlay` 是最后手段，不是解除 stub 的捷径。用它前先证明：哪些段落无法 slot 化、为什么不能通过 reference / overlay 表达、什么时候退回 canonical copy。
- `master-orchestrator-guide` 这类产品主路径 skill 尤其不能靠 partial fork 维护；主路径差异必须收敛成 host capability slots。
- 涉及 Codex 项目级 skills 或 `.agents/skills` 同步：读 `references/codex-project-skills.md`。
- 涉及打包、安装、版本线、发布：读 `references/plugin-release-system.md`。
