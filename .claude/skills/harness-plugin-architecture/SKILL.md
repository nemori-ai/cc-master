---
name: harness-plugin-architecture
description: 'Use when 设计、审查或重构 cc-master / 类似项目的多 agent harness plugin adapter：新增或修复 host adapter、建立 N-host capability parity、判断 Track A / Track B、为跨 hooks/commands/skills/ccm 的能力建立 Capability INTENT / hook CONTRACT，或处理 Cursor IDE plugin 的非 1:1 语义。覆盖 source-to-adapter、SAP/PHIP、host-native manifest / path / hook / command 边界。Do NOT use when 只实现投影脚本（adapter-projection-engineering）、只做打包发布（plugin-release-engineering）、只改一个 skill body（cc-master-skillsmith），或只设计不改 plugin adapter 的 cross-harness headless CLI worker transport；后者以 design_docs/cross-harness-orchestration-capability-model.md 为合同 SSOT，按普通 engineering / dev loop 推进。'
---

# 多 Harness 插件架构

你负责把项目维护成 paragoge 式的多 harness plugin/CLI 工程。先保护结构边界，再改具体实现。

## 先判断任务类型

- 改 runtime skill 语义：进入 `plugin/src/skills/<skill>/canonical/`。
- 改某 host 如何接收 skill：进入 `plugin/src/skills/<skill>/adapters/<host>/strategy.yaml` 和 `plugin/src/skills/_hosts/<host>/`。
- 改单个 hook 的业务契约：进入 `plugin/src/hooks/<hook>/CONTRACT.md`；改 coverage / stage / registration contract 才进入 `plugin/src/hooks/_manifest/`。
- 改某 host 的 hook 实现：进入 `plugin/src/hooks/<hook>/implementations/<host>/` 和 `plugin/src/hooks/_hosts/<host>/`。
- 改跨 hooks / commands / skills / ccm 的用户可见能力：进入 Capability Card，再按 Track A / Track B 找单 surface contract 与 host adapter；读 `references/n-host-capability-parity.md`。
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

1. 先确认目标 host、当前已支持的 host 集合和改动属于 plugin adapter 还是另一种 execution surface。
2. 列出会被改动的 projection surface：skills、hooks、commands、manifest、CLI install、release package。
3. 对每个 surface 明确 source-of-truth 和 generated output。
4. 改 source，并运行 projection。
5. 验证 host-native dist，而不是只验证 source。

## 何时读 references

- 设计或审查 `plugin/src` / `plugin/dist` 边界：读 `references/source-to-adapter.md`。
- 新增或修复 host adapter：读 `references/host-adapter-boundaries.md`，再读 `design_docs/harnesses/<host>.md` 和 `design_docs/harnesses/compatibility-matrix.md`。
- 新增 N+1 host、处理 Cursor 非 1:1 能力或跨 surface capability：读 `references/n-host-capability-parity.md`；Cursor IDE plugin 与 headless Agent CLI 的 scope 不可混用。
- 把 cross-harness 能力接入 origin plugin（cached context landing、host-native attempt invoke/bind、跨 session 提示）时：读 `references/cross-harness-origin-integration.md`；same-harness / other-harness CLI provider、quota store、supervisor 的架构与合同回到 `design_docs/cross-harness-orchestration-capability-model.md`，实现按普通 engineering / dev loop 推进。
- 盘点 runtime skill 正文里哪些内容该模块化 / 变量化 / overlay：读 `design_docs/harnesses/skill-host-coupling-audit.md`。

## Skill adapter 纪律

- 默认模式是 canonical + slot/overlay。一个 skill 的方法论只应该有一份 canonical。
- `unsupported_stub` 只用于该 skill 的核心方法论在某 host 下确实不可用；如果只是机制不同，抽 slot。
- `partial_overlay` 是最后手段，不是解除 stub 的捷径。用它前先证明：哪些段落无法 slot 化、为什么不能通过 reference / overlay 表达、什么时候退回 canonical copy。
- `master-orchestrator-guide` 这类产品主路径 skill 尤其不能靠 partial fork 维护；主路径差异必须收敛成 host capability slots。
- 涉及 Codex 项目级 skills 或 `.agents/skills` 同步：读 `references/codex-project-skills.md`。
- 涉及打包、安装、版本线、发布：读 `references/plugin-release-system.md`。
