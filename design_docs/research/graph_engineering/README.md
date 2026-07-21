# Graph Engineering 深度研究专栏

> 检索截止：**2026-07-21**。本专栏是研究材料，不是 ADR、产品更名或实现承诺。

## 一句话结论

“Graph Engineering”目前更像一个正在形成、边界尚未稳定的社区上位标签：它把工作流/DAG、运行时重规划、多 agent 协作、checkpoint、HITL、验证器与 provenance 等既有实践重新聚合。现有证据不支持“graph 自动优于 loop”或“Anthropic 已从 loop engineering 正式转向 graph engineering”。对 cc-master 更准确的描述是：它已经有 Goal Contract、task DAG、deps/ready 与 CPM 等 **graph-aware control-loop 结构基底**；agent registry、native-attempt、delivery qualification 与 claim provenance 则成熟度不一，不能压成完整执行链。下一步值得研究的是可审计的 graph lifecycle/control plane，而不是再画一层 nodes/edges。

## 阅读路径

1. [执行摘要](00_executive_summary.md)：核心结论、证据强度与决策含义。
2. [社区话语与 Anthropic 证据](01_community_and_anthropic_evidence.md)：可核验时间线、归因等级、反证和传播漂移。
3. [学术谱系](02_academic_landscape.md)：thought、task、communication、workflow 与 provenance 五类图的研究矩阵。
4. [工程分类与操作性定义](03_engineering_taxonomy.md)：什么才算 graph engineering、生命周期、控制面与失败模式。
5. [对 cc-master 的影响](04_cc_master_implications.md)：当前能力/缺口，以及 Preserve / Strengthen / Experiment / Reject 分级。
6. [研究与验证议程](05_research_agenda.md)：可证伪假设、shadow experiments、指标和晋级闸。

## 研究问题

- “loop engineering → graph engineering”是可验证的技术迁移，还是新标签对既有工程谱系的重新包装？
- Anthropic 官方、Anthropic 员工个人、第三方转述与我们的工程推断分别能支持什么？
- 学术文献中的“graph”究竟是思维搜索、任务执行、通信拓扑、工作流程序，还是证据/provenance？
- graph 的收益来自 nodes/edges，还是来自显式契约、调度、验证、恢复、版本和证据生命周期？
- cc-master 哪些 task-graph substrate 有强实现证据，哪些相邻 execution/evidence planes 仍是 partial、设计合同或缺口？
- 哪些增量值得保留、补强、实验，哪些会破坏 narrow waist、HITL、ship-anywhere 或“指挥不演奏”？

## 证据分层

本专栏采用以下分层，引用时不跨层偷渡：

| 层级 | 可承担的主张 | 典型来源 |
| --- | --- | --- |
| 官方/规范/同行评议 | 产品事实、正式定义、论文范围内的结果 | Anthropic/Claude 官方材料、W3C、会议论文页 |
| 作者原文/实证 preprint | 作者自己的定义与条件性实验结果 | arXiv、作者文章 |
| 员工个人/主办方转录 | 个人实践或特定活动发言 | 员工署名文章、活动原视频/转录 |
| 第三方报道/供应商文章 | 传播路径、分类线索、待核验归纳 | 媒体、vendor blog |
| 本报告推断 | 跨来源综合，必须显式标记为推断 | 本专栏各报告的综合段落 |

仓内事实使用 `production code/test > accepted ADR > canonical runtime guide > current capability snapshot > historical vision/spec` 的优先序。外部承重技术主张尽量直接链接论文、标准或官方页面；社区热度和搜索结果不作为性能证据。

## 操作性定义

本专栏把 **graph engineering** 定义为：

> 对 graph-shaped agent system 的完整生命周期与控制面进行工程化：为节点、边、状态、资格、版本、调度、执行实例、证据、恢复、权限和评测建立可执行且可审计的契约。

因此，只有 `nodes[]/edges[]`、可视化画布或“多个 agent 彼此发消息”都不足以构成 graph engineering。详见[工程分类](03_engineering_taxonomy.md)。Loop 也没有消失：cycle 本就是 graph 的一种结构；节点内部仍可运行受限 loop；外层仍需要 `observe → reconcile → verify → replan` 控制循环。

## 方法与限制

- 检索覆盖公开网页、论文/标准、框架官方文档，以及 cc-master 当前源码、测试、ADR 与 canonical guide；未覆盖私域群聊、删除内容、全部非英语社区或所有公开视频。
- 本轮采集到多条自 2026-07-18 起集中出现的 X 帖；未登录状态下正文不可读，只记录 URL/可见 metadata，不转述其论证，也不对传播规模作无指标判断。
- Boris Cherny 的活动原视频本轮未做逐字 timestamp 核验；第三方转录只能证明相应转录存在，不能充当 Anthropic 官方架构规范。
- “未检得 Anthropic 采用 Graph Engineering 命名”是截至截止日、在本轮公开检索范围内的阴性结果，不是绝对不存在的证明。
- 学术结果跨模型、任务、预算、token、延迟和并发资源，不可直接横比；多项 2025–2026 工作尚缺独立复现。
- 没有发现同模型、同预算、同工具、同任务的公开 loop-vs-graph apples-to-apples benchmark。
- 本轮社区样本自 2026-07-18 起集中出现，截至研究日约三天；这只能证明样本时间聚集，不能据此推断传播规模或长期术语收敛。
- cc-master 映射是静态仓内审计；不声称本轮重新执行了完整测试套件。

## 使用边界

这些材料可以作为能力审计、实验设计和未来 ADR 的输入，但不能单独授权：产品更名、board waist 扩张、自动写图、自动 route/spawn、中央自治 scheduler、跨 harness 能力宣称、commit/PR/merge 或发布。涉及上述事项时，以[对 cc-master 的影响](04_cc_master_implications.md)所列用户拍板边界为准。

## 更新建议

建议在以下事件发生时复核本专栏：Anthropic/Claude 官方采用或明确拒绝该术语；出现可复现的 loop-vs-graph 对照研究；动态 graph rewrite/provenance 获得成熟标准；cc-master 的 run-store、native-attempt、route/admission 或 board revision 进入 production。更新时应保留检索截止、来源等级、阴性检索和反证，不以新热词覆盖旧证据。
