# Skill Knowledge Graph

本目录是 cc-master **skill knowledge graph 治理系统的正式、持续维护入口**。它把分发
skills 中的 Markdown 知识正文保留为最终产品，同时为知识模块、知识点、权威关系、运行时导航、
变更谱系与 host projection 建立 Git-native 的可计算合同。

## 阅读路由

| 目的 | 入口 |
|---|---|
| 理解完整拓扑、SSOT、三跳、事务、工具链与 CI 合同 | [specification.md](specification.md) |
| 查询当前可执行能力、稳定 JSON envelope、diagnostic 与 exit code | [cli-contract.md](cli-contract.md) |
| 编写或验证 authored graph source | [schemas/knowledge-source.schema.json](schemas/knowledge-source.schema.json) |
| 编写或验证语义变更事务 | [schemas/knowledge-change.schema.json](schemas/knowledge-change.schema.json) |
| 看一套最小但完整的 source 示例 | [examples/](examples/) |
| 追溯近一年官方规范、论文与工程证据 | [../research/skill_knowledge_graph/README.md](../research/skill_knowledge_graph/README.md) |
| 理解为何选 Git-native JSON + Markdown，而不选数据库 | [../../adrs/ADR-038-git-native-skill-knowledge-graph.md](../../adrs/ADR-038-git-native-skill-knowledge-graph.md) |

## SSOT 边界

- [specification.md](specification.md) 是当前治理模型与不变式的 evergreen SSOT。
- `schemas/` 是 source/change document 的机器合同 SSOT；若 prose 与 schema 冲突，先视为
  contract drift，必须在同一变更中消歧，不能任选一边。
- canonical Markdown span 是知识正文 SSOT；JSON 不复制完整 HOW。
- module JSON 是模块 intent、boundary、membership、access 与路由元数据的 SSOT。
- change set 是语义身份演化的审计记录，不替代 Git diff，也不替代当前 materialized source。
- `plugin/dist/<host>/knowledge/` 与注入的导航块是未来编译产物，不是 authored SSOT。

## 当前成熟度

当前完成 **K0 executable outer contract**：

- 架构、source/change/output schema、示例、治理门与 K0→K3 晋级条件已经确定；
- K1 实现前的 `C1`–`C14` hardening contract 已进入 specification、Schema、CLI registry 与 examples；
- `plugin/src/knowledge/` 已成为正式 authored source root，但 inventory 有意为空并报告 debt；
- `node scripts/skill-knowledge.mjs contract --json` 提供机器可读 capability registry；
- `check --stage K0 --json` 已接入无第三方依赖的 content tests 与 GitHub Actions；
- 未实现的 `compile/report/path/explain/change` 均 fail closed（exit 10）。

合同冻结不等于能力实现。完整 JSON Schema instance validator、真实 pilot inventory、Markdown binding、图不变式、类型化编辑器、
projection 与 hop analysis 仍属于 K1+。在 K3 全覆盖验收之前，不得对外声称八个分发 skill 已满足
全图有向直径 `≤ 3`。
