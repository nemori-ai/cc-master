# Skill Knowledge Graph 研究专栏

**主题**：如何把文件系统中的 Agent Skills 从“Markdown 文件集合”演化为有稳定知识身份、
证据绑定、类型化关系、可计算导航和完整维护生命周期的知识系统。

**调研窗口**：2025-07-23 ～ 2026-07-23<br>
**完成日期**：2026-07-23<br>
**当前状态**：研究完成；设计已在
[`design_docs/skill-knowledge-graph/`](../../skill-knowledge-graph/README.md) 正式接受为 K0 合同；
编译器、编辑器、projection 与 CI 实现仍待后续切片。

## 这组报告回答什么

1. Agent Skills 官方规范已经解决了什么，仍缺什么？
2. 一份 Markdown 内多个知识点应该怎样获得稳定身份，并映射回文件与行号区间？
3. skill 内部知识图、跨 skill portfolio 图、runtime navigation 与 host projection 应怎样分层？
4. “任意知识点到目标知识点不超过 3 hops”怎样成为可执行、可验证的产品约束？
5. 知识点在移动、细化、拆分、合并、废弃时怎样保留 lineage，避免静默漂移？
6. 哪些机制应该做成 schema/compiler/CI，哪些维护纪律应进入现有 dev skills？

## 报告地图

| 报告 | 文件 | 主要问题 |
|---|---|---|
| 执行摘要 | [00_executive_summary.md](00_executive_summary.md) | 最终结论、证据强度、推荐架构 |
| 官方规范与工程实践 | [01_official_skill_format_and_harness_evidence.md](01_official_skill_format_and_harness_evidence.md) | Agent Skills、Anthropic、OpenAI 实际承诺到哪一层 |
| 学术谱系 | [02_academic_landscape_2025_2026.md](02_academic_landscape_2025_2026.md) | skill maintenance、composition、document routing、evidence binding 的近一年研究 |
| 工程分类 | [03_engineering_taxonomy.md](03_engineering_taxonomy.md) | 节点、边、图 plane、hops、生命周期、健康指标 |
| cc-master 映射 | [04_cc_master_implications.md](04_cc_master_implications.md) | 当前缺口、推荐形态、portfolio owner、红线与阶段落地 |
| 研究议程 | [05_research_agenda.md](05_research_agenda.md) | 尚未被文献回答的问题、实验和晋级门 |

**最短阅读路径**：执行摘要 → cc-master 映射 →
[正式规范](../../skill-knowledge-graph/specification.md)。
**准备实现前**：再读工程分类与研究议程。

## 证据等级

| 标记 | 含义 |
|---|---|
| `[官方规范]` | 官方格式、接口或产品规范；可承担“系统承诺了什么” |
| `[官方实践]` | 官方工程文章；可承担实践经验，不等于跨系统标准 |
| `[同行评审]` | 已进入 ACL/EMNLP/TMLR 等正式评审渠道 |
| `[预印本]` | 2026 新论文；可提供方向与待验证假设，不能直接外推 |
| `[仓内实测]` | 对当前 cc-master checkout 的只读扫描或具体文本案例 |
| `[本报告推论]` | 从多条证据推导出的设计判断，不冒充来源原话 |

所有技术结论优先使用一手来源。二手文章不承担关键事实。

## 与 `graph_engineering/` 专栏的边界

[Graph Engineering 专栏](../graph_engineering/README.md)研究的是 agent 系统的 task/execution/
control/evidence graph：任务怎样调度、执行、恢复和验收。

本专栏研究的是 **skill knowledge graph**：

```text
skill knowledge graph                 task/execution graph
知识点、owner、路由、lineage           task、deps、attempt、artifact、state
回答“agent 该读什么、按什么顺序读”      回答“系统该执行什么、何时执行”
```

两者会在 runtime 发生交叉——任务触发某个知识模块，知识模块指导任务决策——但不得合并 schema，
也不得用一个图的成功指标替代另一个图的正确性。

## SSOT 约定

- 本专栏是本轮调研证据与推论的 SSOT。
- 正式规范只保留研究结论摘要并回指本专栏，不重复铺陈论文。
- Markdown 正文仍是未来 runtime 知识的 evidence floor；产品裁决与实现边界以
  [正式规范](../../skill-knowledge-graph/specification.md)和
  [ADR-038](../../../adrs/ADR-038-git-native-skill-knowledge-graph.md)为准。
