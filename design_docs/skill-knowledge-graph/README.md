# Skill Knowledge Graph

本目录是 cc-master **skill knowledge graph 治理系统的正式、持续维护入口**。它把分发
skills 中的 Markdown 知识正文保留为最终产品，同时为知识模块、知识点、权威关系、运行时导航、
变更谱系与 host projection 建立 Git-native 的可计算合同。

## 阅读路由

| 目的 | 入口 |
|---|---|
| 理解完整拓扑、SSOT、三跳、事务、工具链与 CI 合同 | [specification.md](specification.md) |
| 维护者执行 health / typed change / witness（无独立 meta-skill） | [specification.md](specification.md) §12–13 + [cli-contract.md](cli-contract.md) + `node scripts/skill-knowledge.mjs` |
| 查询当前可执行能力、稳定 JSON envelope、diagnostic 与 exit code | [cli-contract.md](cli-contract.md) |
| 编写或验证 authored graph source | [schemas/knowledge-source.schema.json](schemas/knowledge-source.schema.json) |
| 编写或验证语义变更事务 | [schemas/knowledge-change.schema.json](schemas/knowledge-change.schema.json) |
| 看一套最小但完整的 source 示例 | [examples/](examples/) |
| 查四 host anchor/path/partial/stub 冻结合同与 fixture | [fixtures/host-portability/](fixtures/host-portability/) |
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

当前是 **K1 pilot**：

- `plugin/src/knowledge/` 已落真实 inventory：**1** admitted skill、**3 modules / 9 points**，绑定 canonical Markdown marker/span；
- `check` / `contract` / `compile` / `change` / `report` / `path` / `explain` 已实现（K1 pilot 查询面 + 四 host runtime projection + typed change transactions）；
- standalone Draft 2020-12 validators、Markdown binding、graph invariants、authored hop analysis 已交付（`hop_analysis` 仍覆盖 authored navigation plane；final-host H1–H4 由 `compile` 证明）；
- 四 host fixture probe 已交付（`host_portability_probe=true`），**不等于** CLI `check --host` integration；
- `runtime_projection=true`：`compile` 写入 `plugin/dist/<host>/knowledge/` 与 skill nav/anchors，final verifier 只计真实可点击边；
- typed change transactions 已交付：`change begin → validate → apply` 冻结 scope/base/hash，验证闭合集合并以 rollback-safe publication 写入 immutable ledger（`typed_change_transactions=true`）；
- `check --host` 或 `check --base`、`report --host` 仍 exit 10。

未来项只留真实缺口：`behavioral_evidence_tracking`，以及 `check --host` CLI 接线。在 K3 全覆盖验收之前，不得对外声称八个分发 skill 已满足全图有向直径 `≤ 3`。
