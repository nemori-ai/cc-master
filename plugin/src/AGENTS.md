---
path: plugin/src/AGENTS.md
version: v0.5
last-edited: 2026-07-27
content-summary: |
  cc-master plugin source tree 入口。定义 paragoge-style source-of-truth：skills 使用 SAP，hooks 使用 PHIP，skill knowledge graph 使用 repo-only graph-first authored source root，host dist 只由可信投影事务发布。
---

# plugin/src/

`plugin/src/` 是 plugin runtime 语义源，不是可安装产物。可安装产物只出现在 `plugin/dist/<host>/`。

## 目录职责

| 路径 | 职责 |
| --- | --- |
| `commands/` | command adapter source：`_manifest/` + `_hosts/<host>/` + `<command>/adapters/<host>/`；Claude Code 当前投影为 slash-command markdown |
| `adapters/` | 跨 surface capability 的 origin host-native invocation 映射；只调 host tool/归一观察，不拥有 ccm 状态机或 board writer |
| `knowledge/` | Skill knowledge graph 的 repo-only authored maintainer source root；point/module/typed edge 是全局事实，8 个 accepted composition 是派生 skill artifacts；可多 composition 消费同一 SSOT；本目录禁止进入 dist/package/release |
| `skills/` | SAP：每个 skill 的 `canonical/` runtime body + `adapters/<host>/strategy.yaml` |
| `hooks/` | PHIP：hook contract、host base、每个 hook 的 `implementations/<host>/` |
| `.{claude,codex,cursor,kimi}-plugin/` | 四个 host 的 adapter manifest source；Kimi 最终投影为根 `kimi.plugin.json` |

## Source 纪律

- 改 runtime 语义先改 `plugin/src/`，再运行 `bash scripts/check-plugin-dist-sync.sh`（它会生成 Claude Code + Codex dist 并检查 diff）。
- 不手改 `plugin/dist/<host>/` 下的投影结果。
- 修改 `knowledge/` 前先读取 `node scripts/skill-knowledge.mjs contract --json` 的 capability registry；`change` / `check` / `compile` / `contract` / `explain` / `path` / `report` / `materialize` 已实现。`compile` 只把 accepted composition 的产品效果投影进普通 host skill surface；binding/path 只作 evidence，不能反推 owner/membership。四 host fixture probe 已交付，**不等于** CLI host integration。`check --host|--base` / `report --host` 仍 exit 10。不要复制 `design_docs/skill-knowledge-graph/examples/` 来伪装真实 inventory。
- full host sync 在 compiler 前冻结 source snapshot 与 trusted projection plan；只有 sealed verified snapshot 可 publish。package 只消费 receipt/attestation/frozen bundle plan，不 sync、不重新 compile。
- 若 `plugin/dist/<host>/` 因同步产生 diff，必须和对应 `plugin/src` 改动同 commit 提交；根目录 `.githooks/pre-push` 会机械执行这道门。
- Host-specific 事实落在 `adapters/<host>/`、`_hosts/<host>/` 或 hook launcher/implementation 中；共享正文不要新增 Codex / Claude Code 混杂假设。
- `commands/**/body.md` 与 `skills/` 的 runtime body 会直接注入 agent context。只写第二人称任务指令；不要写维护者注释、adapter 说明、host 对照、deprecated/分发机制解释。这些工程事实写进 strategy / docs，不进 runtime prompt/skill body。
