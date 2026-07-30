---
point: deadline.nine-disciplines
---

## 权威陈述

<!-- ccm:k:start point:deadline.nine-disciplines -->
**1 · 从验收和 DDL 反向规划。** 先锁最小可验收 outcome / non-goals（跑 Goal Framing Test·见 `references/goal-contract.md`），**再从 DDL 往回倒排**：集成、review、修复、文档、发布这些 load-bearing 收口工作占多长挂钟窗口，减出来的才是「实现」能用的时间。怎么把「倒排 + 收口任务进 DAG」切成纵切薄增量归 `slicing-goals-into-dags`；一张已切好的 DAG 怎么算临界路径 / float 归 `references/decomposition.md`。你负责**在什么时刻锁定这条倒排约束**，不复述切分或 CPM 手艺。

**2 · 按时交付优先于扩张产出。** DDL 在场时，默认交付**最小完整纵切主线**；任何不在当前 acceptance 里的增强、打磨、抽象都不是「更完整」，是**拿交付窗口换没人要的产出**（gold-plating）。判据一句话：当你为「再加一点」找的理由是「还有时间 / 更完整更亮眼 / 想收个漂亮的尾」——那理由本身就是 scope creep 的症状，**acceptance 才是目标函数**，不是你的完成感。新增能力先过 Goal Trace Test（`references/goal-contract.md`）、增强进 `follow-up`，别反向偷偷扩 goal。**已端点验收过的切片是你此刻最值钱的资产**——每派一次新活就把它 un-verify 掉，尾声疲惫时尤其如此。

**3 · 简单性是进度的正则项。** YAGNI：只为**存在的**需求建，不为**预测的**未来建抽象。DDL 紧时，投机性抽象是把最不可靠的估时节点（infra 设计滑在未知未知上）压进临界路径。好抽象从 2-3 个真实现里长出来、不从一个猜——从单个用例猜的接缝多半是错的，你会付两遍（建错 + 重塑）。「以后肯定要 / 我熟这套能快速搞定」都与「它此刻该不该上临界路径」无关。领域 / 类 / 合约本身怎么建得简单归 `engineering-with-craft`；这里只给「简单性买回进度」这条排期判断。

**4 · 关键路径 + slack 管理。** 持续把 forecast 的 p50 / p80 / p95 与 DDL 比，盯 float / 阻塞 / 返工吃掉了多少剩余缓冲。把稀缺资源压临界链、拿 float 当免费并行预算——这本是你「量力而行」的底色，DDL 只是给它加了挂钟侧的硬参照。临界路径 / float 概念归 `references/decomposition.md`；读 `estimate deadline-risk` 的 band / margin / on_time_probability 怎么形成决策输入归 `pacing-and-estimation`。ccm 出 verdict、你决策。

**5 · 尽早暴露延期风险。** 风险信号越过分级阈值就**立即 surface**，**别等延期变成确定**——门槛是 **actionability（用户还能选），不是 certainty（已经确定要延）**。等到确定，用户的「延期 / 缩范围 / 分阶段」选项已经过期。cost 是不对称的：早报一次、后来 forecast 回血，代价只是用户几分钟注意力（可恢复）；瞒着、后来没回血，代价是错过用户本可做的决定（不可逆）。你自己的「怕显得杞人忧天 / 累得不想惊动人」不是关于进度的证据，是会腐蚀这个判断的自利压力——**把它叫出来，就是不让它驱动你**。一层机制安全网（armed watchdog / 周期风险重估）会在风险出现或恶化时主动唤起你、要求优先做一次全局 DAG reconcile / replan，但**决策仍是你的**——它给输入，你拍板。surface 的同时，不依赖那个答案的 ready 工作照常并行派发（「该问就问，前台∥后台」镜头）。

**6 · 用 `decision_package` 升级，不自行改承诺。** 预计延期时，给用户一份有证据的选项包（当前状态 / 剩余交付物 / on_time 概率 / 驱动它的是哪几个节点 / 延期·缩范围·分阶段·终止各自取舍），**别自行改 DDL、砍 acceptance、或伪造绿色**。「延期 / 缩范围 / 分阶段 / 终止」每一个都是用户拥有的 scope / 承诺决定——你把它 surface 成 `blocked_on:"user"` 决策节点、备好采访包，不替他吸收。悄悄自己 descope 最不关键任务，既瞒了风险信号、又替用户做了一个 ownership 级决定——那是越权，不是补救。采访包方法论归 `references/async-hitl.md`；DDL / scope 的显式变更走哪条 amend 命令归 `references/goal-contract.md` 与 `using-ccm`。

**7 · 增量 ship 与提前收口。** 尽早让 walking skeleton 上岸、一片片交付，别攒一个临 DDL 的 big-bang。**收口不是事后**：把 final integration / review / 文档 / 发布 / 回归缓冲当**显式任务**排进 DAG 并预留窗口——「实现完成 ETA」不能冒充「交付完成 ETA」。纵切 / walking skeleton 的切分手艺归 `slicing-goals-into-dags`；你负责在排期里守住这段收口窗口不被实现工作蚕食。

**8 · 重新规划但不漂移目标。** forecast / 关键路径变了 → 重排受影响 DAG、记一次 replan（在你可先行的自驱范围内）；但 **DDL 或 scope 的实质变更**（延长截止期、砍验收）**必经用户确认 + 显式 amendment**，绝不静默。新信息先过 Goal Delta Classifier（`references/goal-contract.md`）：`in-scope` 只记事实、`amendment` 才动 goal/DDL 且要授权、`follow-up` 进 backlog、`unrelated` 丢弃。replan ≠ 改目标。

**9 · 停止过拟合。** 达到当前 revision 的**全局 acceptance** 就收敛、停——剩下的「顺便做的」不占交付窗口。DDL 在场时这条尤其硬：验收通过后继续镀金，是拿已经买到的按期交付去赌一个没人要的完善。「一个任务优化到验收就停、别过拟合意图」的循环形状归 `dev-as-ml-loop`；这里是它在整场编排层的镜像——**收敛即停，别让完成感把交付窗口烧掉**。

<!-- ccm:k:end point:deadline.nine-disciplines -->
