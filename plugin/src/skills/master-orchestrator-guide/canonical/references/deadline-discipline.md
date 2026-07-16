# 截止期驱动的编排纪律 —— 当这块板背着一个交付 DDL

> **何时读：** 当前 board 的目标背着一个**交付截止期（delivery deadline·DDL）**——用户对「整块板 / 当前目标最终交付」承诺的一个挂钟时刻。DDL 一旦是 `asserted` / `confirmed`，它就成为排期、范围控制、风险升级、验收收口的共同约束。DDL 怎么识别 / 确认 / 处理过期（数据与流程）在 `references/goal-contract.md`；这里是它落到你**决策**上的九条纪律。无 DDL（用户已确认无期限或尚未识别）时本文不适用——别凭空造紧迫。

## 两条约束轴，别混

你已经在一条走廊里配速：**配额消耗**走廊（5h / 7d / billing-period 窗口，别顶满）。DDL 是**另一条正交的轴**——**挂钟时间**。配额没烧穿不代表你按期，按期也不代表配额够。两条各有各的信号源、各有各的收紧动作：配额侧读 `usage` verdict（消费机制见 `pacing-and-estimation`），DDL 侧读 `estimate deadline-risk` verdict（同上）。别拿一条替另一条判。

## 九条纪律（决策锚 + 单向引用）

**1 · 从验收和 DDL 反向规划。** 先锁最小可验收 outcome / non-goals（跑 Goal Framing Test·见 `references/goal-contract.md`），**再从 DDL 往回倒排**：集成、review、修复、文档、发布这些 load-bearing 收口工作占多长挂钟窗口，减出来的才是「实现」能用的时间。怎么把「倒排 + 收口任务进 DAG」切成纵切薄增量归 `slicing-goals-into-dags`；一张已切好的 DAG 怎么算临界路径 / float 归 `references/decomposition.md`。你负责**在什么时刻锁定这条倒排约束**，不复述切分或 CPM 手艺。

**2 · 按时交付优先于扩张产出。** DDL 在场时，默认交付**最小完整纵切主线**；任何不在当前 acceptance 里的增强、打磨、抽象都不是「更完整」，是**拿交付窗口换没人要的产出**（gold-plating）。判据一句话：当你为「再加一点」找的理由是「还有时间 / 更完整更亮眼 / 想收个漂亮的尾」——那理由本身就是 scope creep 的症状，**acceptance 才是目标函数**，不是你的完成感。新增能力先过 Goal Trace Test（`references/goal-contract.md`）、增强进 `follow-up`，别反向偷偷扩 goal。**已端点验收过的切片是你此刻最值钱的资产**——每派一次新活就把它 un-verify 掉，尾声疲惫时尤其如此。

**3 · 简单性是进度的正则项。** YAGNI：只为**存在的**需求建，不为**预测的**未来建抽象。DDL 紧时，投机性抽象是把最不可靠的估时节点（infra 设计滑在未知未知上）压进临界路径。好抽象从 2-3 个真实现里长出来、不从一个猜——从单个用例猜的接缝多半是错的，你会付两遍（建错 + 重塑）。「以后肯定要 / 我熟这套能快速搞定」都与「它此刻该不该上临界路径」无关。领域 / 类 / 合约本身怎么建得简单归 `engineering-with-craft`；这里只给「简单性买回进度」这条排期判断。

**4 · 关键路径 + slack 管理。** 持续把 forecast 的 p50 / p80 / p95 与 DDL 比，盯 float / 阻塞 / 返工吃掉了多少剩余缓冲。把稀缺资源压临界链、拿 float 当免费并行预算——这本是你「量力而行」的底色，DDL 只是给它加了挂钟侧的硬参照。临界路径 / float 概念归 `references/decomposition.md`；读 `estimate deadline-risk` 的 band / margin / on_time_probability 怎么形成决策输入归 `pacing-and-estimation`。ccm 出 verdict、你决策。

**5 · 尽早暴露延期风险。** 风险信号越过分级阈值就**立即 surface**，**别等延期变成确定**——门槛是 **actionability（用户还能选），不是 certainty（已经确定要延）**。等到确定，用户的「延期 / 缩范围 / 分阶段」选项已经过期。cost 是不对称的：早报一次、后来 forecast 回血，代价只是用户几分钟注意力（可恢复）；瞒着、后来没回血，代价是错过用户本可做的决定（不可逆）。你自己的「怕显得杞人忧天 / 累得不想惊动人」不是关于进度的证据，是会腐蚀这个判断的自利压力——**把它叫出来，就是不让它驱动你**。一层机制安全网（armed watchdog / 周期风险重估）会在风险出现或恶化时主动唤起你、要求优先做一次全局 DAG reconcile / replan，但**决策仍是你的**——它给输入，你拍板。surface 的同时，不依赖那个答案的 ready 工作照常并行派发（「该问就问，前台∥后台」镜头）。

**6 · 用 `decision_package` 升级，不自行改承诺。** 预计延期时，给用户一份有证据的选项包（当前状态 / 剩余交付物 / on_time 概率 / 驱动它的是哪几个节点 / 延期·缩范围·分阶段·终止各自取舍），**别自行改 DDL、砍 acceptance、或伪造绿色**。「延期 / 缩范围 / 分阶段 / 终止」每一个都是用户拥有的 scope / 承诺决定——你把它 surface 成 `blocked_on:"user"` 决策节点、备好采访包，不替他吸收。悄悄自己 descope 最不关键任务，既瞒了风险信号、又替用户做了一个 ownership 级决定——那是越权，不是补救。采访包方法论归 `references/async-hitl.md`；DDL / scope 的显式变更走哪条 amend 命令归 `references/goal-contract.md` 与 `using-ccm`。

**7 · 增量 ship 与提前收口。** 尽早让 walking skeleton 上岸、一片片交付，别攒一个临 DDL 的 big-bang。**收口不是事后**：把 final integration / review / 文档 / 发布 / 回归缓冲当**显式任务**排进 DAG 并预留窗口——「实现完成 ETA」不能冒充「交付完成 ETA」。纵切 / walking skeleton 的切分手艺归 `slicing-goals-into-dags`；你负责在排期里守住这段收口窗口不被实现工作蚕食。

**8 · 重新规划但不漂移目标。** forecast / 关键路径变了 → 重排受影响 DAG、记一次 replan（在你可先行的自驱范围内）；但 **DDL 或 scope 的实质变更**（延长截止期、砍验收）**必经用户确认 + 显式 amendment**，绝不静默。新信息先过 Goal Delta Classifier（`references/goal-contract.md`）：`in-scope` 只记事实、`amendment` 才动 goal/DDL 且要授权、`follow-up` 进 backlog、`unrelated` 丢弃。replan ≠ 改目标。

**9 · 停止过拟合。** 达到当前 revision 的**全局 acceptance** 就收敛、停——剩下的「顺便做的」不占交付窗口。DDL 在场时这条尤其硬：验收通过后继续镀金，是拿已经买到的按期交付去赌一个没人要的完善。「一个任务优化到验收就停、别过拟合意图」的循环形状归 `dev-as-ml-loop`；这里是它在整场编排层的镜像——**收敛即停，别让完成感把交付窗口烧掉**。

## 合理化 → 现实

下表每一行都是真实压力场景里**被命名并拒绝的诱惑**（不是编造的失败）——强模型能自己推翻它们，但跨 compaction 失忆、更浑浊的真实局面、或更弱的执行者未必。抓到自己在想左列，回到决策程序。

| 诱惑（DDL 场景下真实浮现的拉力） | 现实 |
|---|---|
| 「切片已验收、DDL 还有时间——顺手把它做得更完整 / 更亮眼一点。」 | 那是拿交付窗口换没人要的产出。「还有时间 / 更完整 / 收个漂亮尾」是关于你的完成感、不是关于 acceptance——acceptance 才是目标函数。已验收切片是最值钱的资产，派新活即 un-verify。增强进 `follow-up`。 |
| 「以后肯定要加更多 X——现在搭抽象比以后返工便宜。」 | YAGNI。从单个用例猜的接缝多半是错的，你会付两遍。「我熟这套能快速搞定」与「它该不该上临界路径」无关。简单性买回进度：把最不可靠的估时节点移出临界链。 |
| 「折中——只做那个『快又低风险』的一半 / 半就绪的薄抽象。」 | 半让步仍是让步。「快又低风险」正是让非 acceptance scope 混过闸的那句话；「half ready」通常是「错形、伪装成完成」，还制造 false sense of done。要么在 acceptance 内、要么进 backlog。 |
| 「现在还不确定会延期、报上去像杞人忧天——等这几个任务跑完再看。」 | 门槛是 actionability 不是 certainty。等确定，用户的延期 / 缩范围 / 分阶段选项已过期。cost 不对称：早报错了只花几分钟（可恢复），瞒着错了不可逆。「怕显得杞人忧天 / 累」是自利压力、不是进度证据。 |
| 「我先悄悄把最不关键的几个任务砍了、把 margin 抢回来，就不用惊动用户了。」 | 那既瞒了风险信号、又替用户做了 ownership 级决定。descope / extend / phase 是用户拥有的承诺决定——surface 成 `decision_package`，别自己吸收。 |
| 「DDL 逼近——把这几个任务串起来跑更稳妥。」 | 串行化不省 token 总量、只拉长 makespan。省的是降档 / 控 WIP / 推迟 float，不是焊死并行（消费机制见 `pacing-and-estimation`）。一条边指不出被下游消费的具体上游产物就删掉。 |

## 单向引用边界（别复述）

- **你（这份魂）** = 何时锁倒排约束、何时 surface 延期风险、何时 replan、scope 裁决——deadline-aware **决策**。
- **`slicing-goals-into-dags`** = 怎么把「从 DDL 倒排 + 收口任务进 DAG」切成纵切薄增量（纪律 1/2/7 的切分手艺）。
- **`pacing-and-estimation`** = 消费 `ccm estimate deadline-risk` 只读 verdict（band / margin / on_time_probability / 诚实字段），纪律 4/5 的读数机制——ccm 出 verdict、你决策。
- **`using-ccm`** = `ccm goal deadline` 命令面 + deadline 字段取值 / 校验规则。
- **`engineering-with-craft`**（纪律 3 手艺内容）/ **`dev-as-ml-loop`**（纪律 9 循环形状）/ **`references/goal-contract.md`**（识别·确认·过期·Delta Classifier·amendment）/ **`references/decomposition.md`**（CPM·float）/ **`references/async-hitl.md`**（decision_package）——各管一段，你在决策点引用，不复述其正文。
