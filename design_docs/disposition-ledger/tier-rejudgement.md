# `both` 桶 62 条的档位统一重判

> 执行方：第二方（非判据作者）。判据来源：[`failure-mode-tier-boundary.md`](failure-mode-tier-boundary.md) §3（2026-08-06 用户批准）。本文只用那一条判据，不引入第二把尺。
>
> 判定已落地：`plugin/src/knowledge/graph/modules/*.json` 的 `failure_mode` 与母本 `## 失效类型` 首行档位标注已同步改完，`check --stage K3` `ok=true` / `diagnostics=0`。

---

## 0. 判据与它的可执行形式

> **假设一个更强的模型已经知道这条的全部内容，这条还需要存在吗？**
> 不需要 → 价值在具体内容 → `capability_gap` / `environment_fact`；仍需要 → 它是预先立好、用来对抗压力的规则 → `motivation_conflict`。
>
> 可执行形式：**价值是否绑定在它的具体措辞 / 分类 / 命令上。绑定 → cap/env；换成任何等价物都不损失 → 护栏。**

判据在 62 条上落地时，只有一处需要说清楚——§3 的反例（`conduct.deserting-podium`）说明「具体内容承重」不等于「它是个框架」，而是**别的东西依赖这一套具体内容**（hook 注入与 skill 之间靠它对齐）。所以「绑定」判成立只在三种形态：

- **(a) 本工具 / 本 host 的事实**——换个说法就错（`ccm` 的合法取值、状态转移、`workflow()` 的抛错条件）。
- **(b) 共享命名 / 分类约定**——价值来自「大家用同一套」，不是来自这套本身更聪明（离席四向、四类资产、ML 组件角色表）。
- **(c) 被另一方消费的 schema / 协议形状**——节点契约的 output schema、escalation 结果的形状、content-hash / journal。

不落这三种、且删掉后的损失是「知道却仍会选另一条更便宜的路」——就是护栏。**「这条很重要」不是判据**；重要性与耐久性正交，判据只量后者。

一个附带的一致性检验：护栏档的原型是「正确路径更费力，压力下选便宜的」。凡我判成护栏的，错误路径必须**当下更省事**；若错误路径反而更贵（例如求稳而过度设计），那不是动机冲突，是先验错误，留在能力补课档。

---

## 1. 结果

| | 条数 |
|---|---:|
| 变动 | **8**（全部 `capability_gap` → `motivation_conflict`） |
| 维持原档 | **54** |
| 合计 | **62** ✅ |

桶内分布：

| | 重判前 | 重判后 |
|---|---:|---:|
| `capability_gap` | 17 | **9** |
| `environment_fact` | 7 | 7 |
| `motivation_conflict` | 37 | **45** |
| `prosthetic` | 1 | 1 |

全局分布（267 点）：

| | 重判前 | 重判后 |
|---|---:|---:|
| `environment_fact` | 112 | 112 |
| `capability_gap` | 87 | **79** |
| `motivation_conflict` | 63 | **71** |
| `prosthetic` | 5 | 5 |

**与判据文档的预估有出入，如实记账**：§4 预计能力补课档 87 → 约 70，实测是 **87 → 79**。差在 17 条 cap 里有 9 条不是「方法主体 + 压力失效」的真两难，而是落在上面 (a)(b)(c) 三种承重形态里（详见 §3 的两条完整推演）。预注册表的分母因此缩小 8 而不是 17——**实测范围要按 79 重排，不是 70**。

判不了的：**0 条**。判据不直接适用的：**1 条**（`devloop.ledger-antipatterns`，`prosthetic`，见 §5）。

---

## 2. 逐条判定

「还需要吗」列 = 判据原问的答案（更强模型已知全部内容后）。「理由」指向该点正文里的具体证据。

### 2.1 变动的 8 条（`capability_gap` → `motivation_conflict`）

| point_id | 原档 | 新档 | 还需要吗 | 理由（指向正文证据） |
|---|---|---|---|---|
| `capacity.ranking-and-contraction` | cap | **motiv** | 仍需要 | 正文的承重物是「同档换候选 → 降 WIP → 推迟 float → 停派 → arm → surface」这条**由便宜到贵的 lever 次序**；`effect floor` / `verdict` / `nearest_reset` 的定义都归别处（`pacing.decision-vectors`）。它自己点名的失效是「直接把任务整体降档」「替用户跨硬总闸」——两条都是次序里最贵那一步被跳过去换省事，正文因此才写「不要把原任务直接降档」「不要替用户跨硬总闸」。 |
| `ddd.strategic-boundaries` | cap | **motiv** | 仍需要 | 失效描述自陈「模型大致仍知道边界该看语言分歧，但真到设计时会更倾向用『放在一起改着方便』这类顺手的理由去合并边界，因为那样当下更省事」——即已知却选另一条。三轴 / 子域分类 / 合并三度量都是业界通用词汇，换一组等价启发式不损失系统内对齐，不落 (b)。 |
| `devloop.explore-exploit` | cap | **motiv** | 仍需要 | 判据文档 §2 的样例之一。正文自陈「明知该先验证方向再精修」，坏在「沉没成本会把它拉向顺手做完 / 做漂亮」——纯动机。 |
| `devloop.instrument` | cap | **motiv** | 仍需要 | 失效自陈「知道要先读懂失败信号再改下一版、要先确认仪器本身可信」，但「在想尽快看到绿灯的心态下会跳过诊断直接换个方向再试」。「先架仪器再下降」「失败是梯度」是可被更强模型自行补出的解读，跳过诊断则是当下更快的那条路。 |
| `devloop.plateau-restart` | cap | **motiv** | 仍需要 | 正文自己写「沉没成本是**局部最小值的引力**，不是继续的理由」——这句在说：知道信号也仍会被拉住。信号清单（「再改一下就好了已经说了第三遍」）可换等价表述，被拉住这件事不会因此消失；继续打补丁比退回换方案便宜。 |
| `goal.trace-and-delta` | cap | **motiv** | 仍需要 | 判据文档 §2 的样例之一。失效自陈「完全清楚该先做 Goal Trace Test」，坏在「这么明显有用，先做完再解释也一样」，正文因此写死「无法追溯就先分类，**绝不先做后解释**」。Delta Classifier 四分类的**动作**（`goal amend` / revision +1）是 ccm 事实，但那部分归 `goal.alignment-checkpoints` 与命令面。 |
| `multilayer.admission-and-escalation` | cap | **motiv** | 仍需要 | escalation 的**机制**（STOP + 交出 map + supersede）正文明说「机制 SSOT 在 dispatch.md，此处不复述」——本点只剩准入门槛与「纵深消化 vs 炸开成顶层并行」的分界。它自陈的失效是「escalate 要停下来写 map、而继续往下钻感觉在持续推进，靠着沉没成本闷头串行做完」：停下来是更贵的那条路。 |
| `oop.encapsulation-vocabulary` | cap | **motiv** | 仍需要 | 失效逐字自陈「agent 通常已经懂聚合根 / 守卫 / 值对象这些概念，但赶时间时会选更省事的 setter 或『写个注释代替真正的守卫』，并说服自己这次够简单不用整套仪式」。正文那句「**设计文档里的不变式不是不变式**」正是为堵这句合理化而写。 |

### 2.2 维持 `capability_gap` 的 9 条

| point_id | 还需要吗 | 理由（含承重形态） |
|---|---|---|
| `conduct.deserting-podium` | 不需要（内容承重） | 判据文档 §3 的反例本身：四方向命名是系统内共享词汇，hook 注入与 skill 之间靠它对齐——(b)。删掉的损失是「失去把当下滑坡状态归类命名的能力」，是能力不是意愿。 |
| `ddd.design-focus` | 不需要 | 承重物是「现在确定 / 推迟到实现」两列表 + 逻辑正确性约束 vs 工业质量参数的划线。失效描述里没有诱惑项，末句自陈「是判据不是抄近路诱惑」——损失是分配判断力。 |
| `devloop.ml-components` | 不需要 | 七个组件角色（objective owner / instrumentation builder / … / restart trigger）是派发时的共享调度词汇——(b)。失效是「派发时只会想谁来写代码，不会主动检查缺哪个组件」，是清单缺席而非违规。（注：本条进 `both` 桶是关键词假阳——命中的「会想」出自「只**会想**谁来写代码」，不是压力措辞。） |
| `dispatch.dataflow-and-mechanisms` | 不需要 | `executor` 的 5 个取值是 board 字段事实——(a)；两层（executor 值 vs 后台机制）与三高度分形是把默认「逐项排队」换掉的框架。失效说「模型不会自发想到把两层拆开」，是能力缺口。 |
| `dispatch.workflow-and-escalation` | 不需要 | escalation 结果的形状（scope map + 提议叶子 + deps + 部分证据）是编排者要消费的协议——(c)；生命周期耦合判据与 admission control 并发上限是可判定内容。其中「绝不自我提拔」这半条护栏已由 `conduct.red-lines` / `routing.ordered-chain` 承担，本点不重复承担。 |
| `distill.taxonomy` | 不需要 | 四类资产的名字与「适合 / 不适合承载」定义是路由决策树与落地手艺两份 reference 共同引用的分类约定——(b)。压力那一半由同族的 `distill.landing-rationalization`（Rationalization Table）单独承担，两点不重叠。 |
| `scheduling.node-contract` | 不需要 | output schema 的字段名（`verdict` / `evidence` / `confidence` / `blockers` / `open-q` / `artifacts`）由下游节点与 joiner 消费——(c)；「优先给可执行的验收物而不是散文」是可判定判据。 |
| `slicing.walking-skeleton` | 不需要 | 构造方法本身（最薄端到端线 / 脊椎只放不可再薄的共享核心 / schema 增量生长）就是价值。**且它过不了便宜性检验**：失效是「出于一次做对、少走回头路的求稳心态把 schema 一次定全」——错误路径**更贵**，不是省事，故不属动机冲突原型。 |
| `verification.hash-and-stale` | 不需要 | content-hash = `hash(spec + upstream outputs + key context)`、journal、`dep_pins`、stale 标记是一套机制与 board 字段——(a)+(c)。失效是「删掉后不会想到把 workflow 当增量构建引擎」，纯能力。 |

### 2.3 维持 `environment_fact` 的 7 条

7 条全部落 (a)：内容是本工具 / 本 host 的事实，换个说法就是错的。压力措辞出现在它们的失效描述里，但被压力威胁的那条纪律各有自己的护栏点，不由事实点承担。

| point_id | 还需要吗 | 理由 |
|---|---|---|
| `ccm.board.blocked-on` | 不需要（事实承重） | `blocked_on` 只有 `"user"` / `"<taskid>"` 两种合法值、`task unblock` 清它、`decision_package` 缺则 BIZ-AWAITING hard error——逐条是引擎会拒的具体事实。「把 must-escalate 包装成 judgment_call」这条压力归 `hitl.step6-ledger` 与红线。 |
| `ccm.board.cadence` | 不需要 | `cadence update/open/ship` 的签名与「deadline 必须严格 ISO-8601 UTC，否则 `FMT-CADENCE` warn」是照抄才对的事实。 |
| `ccm.status-state-machine` | 不需要 | 合法转移表、`ready → done` 非法、`--set tasks[T].status` 撞 exit 3——写错就撞引擎。末尾的 Rationalization Table 正文自陈是「附加条款」。 |
| `goal.alignment-checkpoints` | 不需要 | 六个检查点各跑哪道闸（`goal check` 返回 `ok` 而非 `deadline_pending`、legacy board 无 `goal_contract` 时怎么办）是本项目 lifecycle 的具体约定。 |
| `pacing.decision-vectors` | 不需要 | 三条 burn 影响向量的含义 + 「它们是输入不是动作，动作交回决策层」的**归属约定**——是本系统的分工事实（(b)），不是一条对抗诱惑的规则。 |
| `routing.workflow-boundary` | 不需要 | 「`executor=workflow` 不担保当前 host 存在同名 runtime」是 host 事实，猜错就去调不存在的接口。 |
| `workflow.pattern-nested-composition` | 不需要 | `workflow()` 共享 parent 的 cap / budget / abort、**只允许一层**、名字或语法出错会抛错——引擎语义，换等价物即错。 |

### 2.4 维持 `motivation_conflict` 的 37 条

37 条逐条过了同一把尺，**零变动**。它们共同满足两条：① 删掉后的损失是「知道却仍会选另一条路」（多数点的失效描述逐字这么写）；② 错误路径当下更便宜；③ 不落 (a)(b)(c)——其中的事实 / 命令 / 词汇成分都在别处单点承担（命令面归 ccm 事实点、七镜头命名归 SKILL 正文、交接步骤归命令体）。

| point_id | 还需要吗 | 理由（更省事的那条路 / 正文自陈） |
|---|---|---|
| `ccm.single-write-path` | 仍需要 | 正文点名「万一 ccm 这一下不响应…绝不退回手改 JSON 顶上去」——被堵的是「只是临时垫一下」。 |
| `ccm.write-gate` | 仍需要 | 正文直接写「别因为『就改一个字段、Write 更快』在 ccm 可用时绕开它」；四道保护是理由，不是被保护物。 |
| `conduct.never-play` | 仍需要 | 「绝不亲手实现或 review」，亲手做明显更快。 |
| `conduct.red-lines` | 仍需要 | 自带「违背字面就是违背精神」——正文承认压力下会构造例外论证。 |
| `control.identity-mandate` | 仍需要 | 身份信条每次 compaction 重注，就是为压力下守角色；`task/agent/attempt` 三层区分是理由链的一环，不是被消费的 schema。 |
| `control.operating-lenses` | 仍需要 | 六个镜头每条的正确做法都比默认更麻烦（就绪即发、主动榨干工作池、只信端点验收）。 |
| `control.rationalization-guards` | 仍需要 | 整段就是合理化对照表——内容形式即护栏。 |
| `control.role-consequences` | 仍需要 | 提供的是遵守的**意愿**（五种死法的逐条否定），不补方法也不补事实。 |
| `craft.evidence-over-claim` | 仍需要 | 「绿闸不算证据」；取证比信绿灯费力。 |
| `craft.red-lines` | 仍需要 | 五条红线全是「别图省事这么写」。 |
| `ddd.red-lines` | 仍需要 | 直接导入别的 BC 模型、提交前发事件都是更省事的近路。 |
| `deadline.guards-and-boundary` | 仍需要 | 正文卷首自陈「每一行都是真实压力场景里被命名并拒绝的诱惑」。 |
| `deadline.nine-disciplines` | 仍需要 | 早报风险、不镀金、不自行改承诺，条条比沉默更费力。 |
| `devloop.fit-intent` | 仍需要 | hard-code 让测试变绿是最快的那条路。 |
| `dispatch.hygiene-and-liveness` | 仍需要 | 「先绑 handle 再 `in_flight`」——先标状态更快；`ccm agent` 命令面归 ccm 事实点。 |
| `dispatch.routing-and-isolation` | 仍需要 | 「没有独立隔离工作树就不要并行派 writer」，共享一棵树省事得多。 |
| `distill.fallback-no-drop` | 仍需要 | 静默丢弃是最省事的近路，兜底动作本身不难。 |
| `distill.landing-rationalization` | 仍需要 | 整段是自我说服清单。 |
| `handoff.judgment-template` | 仍需要 | 累了直接 dump board 更省力；大段正文都在拆这个自我说服。 |
| `handoff.procedure-and-drain` | 仍需要 | 正文明说「命令体给的是逐步落地；这里只钉每步的**为什么**与纪律边界」——步骤 schema 不归它。 |
| `handoff.rationale-and-guards` | 仍需要 | 主体是 Rationalization Table 与 Red Flags。 |
| `hitl.step6-ledger` | 仍需要 | 三个裁决字符串只被自己和人读，不构成对外 schema；被堵的是「一句光秃秃的『看起来做完了』」。 |
| `oop.red-lines` | 仍需要 | 裸 catch-all、idle wrapper 都是图省事就会越过的线。 |
| `outside.unknown-and-amendment` | 仍需要 | 五步协议堵的是「编造信心」与「永久停摆」两种更省事的收场。 |
| `routing.handle-gate` | 仍需要 | 直接标 `in_flight` 明显更省事。 |
| `routing.ordered-chain` | 仍需要 | **借线**：八段次序确被别处单一引用，看似 (c)。但正文自陈「知道这八步该按顺序走，但在想显得高效或已经很确信某个 target 会成功时，会选择跳步或事后补齐顺序」，且三个反例（先看品牌 / 先排名 / 先写 `in_flight`）都是省力形态——按判据原问，已知次序后仍需要它，故留护栏。routing record 的字段清单是次序的载体，不是被第三方消费的独立 schema。 |
| `sdd.change-order` | 仍需要 | 先动实现是明显更快的近路。 |
| `sdd.drift-red-line` | 仍需要 | 附带的整张借口对照表即证。 |
| `sdd.implementation-gate` | 仍需要 | 正文写「时间紧、无人可评审，都不构成跳过的理由」。 |
| `slicing.why-cut` | 仍需要 | 慢下来打磨切分比立刻开派费力。 |
| `tdd.completion-gate` | 仍需要 | 自报全绿是最省事的近路。 |
| `tdd.iron-law` | 仍需要 | 「写了产码才想起写测试：删掉，重来」——删掉已完成的工作远比留着适配费力。 |
| `tdd.rationalizations` | 仍需要 | 正文自陈「谈判本身就是症状」。 |
| `tdd.red-evidence` | 仍需要 | 不读失败输出是最省事的那一步。 |
| `verification.endpoint-procedure` | 仍需要 | 信下层自报绿明显更快。 |
| `verification.resume-takeover` | 仍需要 | 正文引 pressure baseline 实证：强模型在三压下默认信任 ambient cwd 直奔验收。 |
| `verification.terminal-is-not-done` | 仍需要 | 采信 worker 自报 / CI 绿更省事。 |

---

## 3. 三条完整推演（含两条维持原档）

### 3.1 变动：`oop.encapsulation-vocabulary`（cap → motiv）

- **正文承重物**：聚合根是唯一变更入口、变更方法同时携带守卫 + 状态翻转 + 时间戳、值对象冻结、不变式编号并在声明处强制。
- **问判据**：更强的模型已经知道这一整套——它还需要这条存在吗？
- **落 (a)/(b)/(c) 吗**：不落。聚合根 / 值对象 / 不变式是业界通用词汇，不是本系统为对齐而立的约定；没有第二方消费一份由它定义的 schema；不是 ccm / host 事实。换成任何等价表述，系统内没有别处会因此对不上。
- **便宜性**：`workspace.status = "archived"` 一行 setter，比设计一个带守卫与状态翻转的领域动词便宜得多。
- **正文自证**：失效描述逐字写「通常已经懂这些概念，但赶时间时会选更省事的 setter 或『写个注释代替真正的守卫』，并说服自己这次够简单不用整套仪式」；正文那句「**设计文档里的不变式不是不变式**」就是为堵「写个注释代替守卫」而立。
- **判定**：仍需要 → `motivation_conflict`。

### 3.2 维持：`conduct.deserting-podium`（cap 不变）

- **正文承重物**：把所有坏编排姿态归一为「离席」，并切成向下 / 向内 / 向前 / 向虚四个方向，配一句用法——「先叫出方向，再回到决策程序」。
- **问判据**：更强的模型已经知道这四类——它还需要这条存在吗？
- **落哪一种**：(b)。更强的模型能自己发明**一套**分类，但**这一套**是系统内共享词汇：hook 注入用它、skill 之间靠它对齐。换一套等价分类，注入文本与 skill 正文当场对不上——损失是真的。
- **失效是能力还是意愿**：正文自陈「删掉后 agent 仍抽象知道『别亲自实现』『别空等』，但**失去把当下滑坡状态归类命名的能力**」。丢的是命名与检出，不是遵守的意愿；被命名之后该不该守，由 `conduct.red-lines` 与 `control.rationalization-guards` 两条护栏承担。
- **判定**：不需要（内容承重）→ 维持 `capability_gap`。

### 3.3 维持：`slicing.walking-skeleton`（cap 不变，且是护栏原型的反例）

- **正文承重物**：第一片不是「地基层」而是一根最薄的端到端线；共享 schema 只定这根线用到的最小字段、按纵切增量生长；前置依赖只放不可再薄的共享脊椎。
- **问判据**：更强的模型知道这套构造法后，还需要这条吗？
- **落哪一种**：不落 (a)(b)(c)——它是构造方法，不是约定或 schema。所以初看像是「内容可被推导 → 该降为护栏」。
- **便宜性检验推翻了这个方向**：失效描述说的错误行为是「出于『一次做对、少走回头路』的求稳心态，把共享 schema 和前置依赖一次性定得比这根线实际需要的更全」——**这条错误路径更贵，不更便宜**。动机冲突的原型是「正确路径更费力，压力下选便宜的」；这里正好反过来，是先验偏差（求稳），不是意愿失守。把它判成护栏，会让「护栏」这一档同时装下省事与求稳两种相反的动力，档位失去预测力。
- **判定**：损失仍是能力（缺一个正确的构造先验）→ 维持 `capability_gap`。

---

## 4. 与判据文档预估的差异（须端点复核的一处）

判据文档 §4 预计「能力补课档 87 → 约 70」，实测 **79**。差额 9 条全部来自 §2.2——它们的具体内容落在 (a)(b)(c) 三种承重形态里，或（`slicing.walking-skeleton`）过不了便宜性检验。若复核者认为 (b)「共享命名约定」判得过宽，最可能被翻的三条依次是 `distill.taxonomy`、`devloop.ml-components`、`dispatch.workflow-and-escalation`；`conduct.deserting-podium` 是判据文档自己钉的反例，不在可翻之列。

**下游影响**：能力补课档预注册表的分母从 87 变 79（去掉本文 §2.1 的 8 条），实测范围与预算按 79 重排。护栏档 63 → 71。

---

## 5. 判据不直接适用的 1 条

`devloop.ledger-antipatterns`（`prosthetic`，维持）。判据的两个分支只覆盖 cap/env ↔ motiv 这条边界。这条点过「还需要吗」= **仍需要**，但理由既不是内容承重、也不是意愿失守：正文的承重物是「聊天上下文会被压缩，board 才是跨 compaction 的 durable memory」——它补的是**上下文压缩这个结构性限制**，模型变强并不消除压缩。这正是 `prosthetic` 这一档的定义，比 `motivation_conflict` 更精确。维持原档，不按 cap/env↔motiv 判据强判。

---

## 6. 自证

- **62 条全覆盖**：变动 8 + 维持 54 = 62 ✅（分档：cap 9 / env 7 / motiv 45 / pros 1 = 62）。
- **分桶数复现**：重判**前**跑分桶查询得 `both` 桶 62 条、cap 17 / env 7 / motiv 37 / pros 1，与判据文档 §1 表格逐格一致。**重判后重跑同一查询会得 61**——`capacity.ranking-and-contraction` 的新标注不含「主体是 / 主体：」字样，掉出了机械分桶条件；这是标注改写的副作用，不是漏判（该点在 §2.1 有判定）。要复现原 62 条，请在改动前的 commit 上跑那段查询。
- **两份副本同步**：module JSON 的 `failure_mode` 与母本 `## 失效类型` 首行标注同改；`tests/content/knowledge-failure-mode-parity.test.mjs` 通过。变动 8 条的标注用既有形态 `` `motivation_conflict`（双重性质·方法部分更强的模型能自己补回来，留下的是约束） ``（仓内已有 7 例），与它们第二行仍在陈述「主体是方法框架」不冲突——这正是「双重性质」要表达的；失效描述本身一字未改。
- **收口**：`reconcile-passages --write` 无新增改动（`失效类型` 段不在 passage span 内）；`refresh-analysis --write` 八个 composition 全 `fresh`、`diagnostics: []`；`check --stage K3` `ok=true`、`diagnostics: []`、`errors: 0`、`debts: 0`。
- **回归**：12 个非隔离层 knowledge content 测试（parity / change-transactions / external-edge-policy / final-runtime-topology / k1-validator-ir / k1-pilot-query / k2-small / k2-using-ccm / k2-medium-local / k3-00-graph-first / scaffold / host-portability）共 104 用例全绿、0 失败。未跑 `tests/heavy-tests.txt` 与 `tests/quarantine.txt` 登记的四个 knowledge 测试：本次只改 `failure_mode` 字段与母本 `失效类型` 段，`失效类型` 不在 passage span 内、`knowledge/` 是 repo-only 不进 dist，故不触及投影与编译；`git status` 亦确认无 skill 正文 / `plugin/dist` 变化，无需 `regenerate-attestations.sh`。
- **全局分布**：env 112（不变）/ cap 87 → **79** / motiv 63 → **71** / pros 5（不变），合计 267。

---

## 端点复核（由判据作者执行，非重判执行者）

复核范围：改动面、授权边界、数字、以及执行者主动标出的两处存疑。

### 通过的部分

- **改动面精确**：14 文件 / 16 行改 16 行删，每处一行。**只动档位标注，失效描述一字未改**——与授权一致。未碰 skill 正文、`plugin/dist`、`ccm/`，未 commit。
- **数字逐格吻合**：`env 112 / cap 79 / motiv 71 / pros 5`，与执行者报告一致；`K1`/`K3` 全 `ok / diag=0`。
- **抽查判定成立**：`devloop.ml-components` 维持 `capability_gap` 判对了——它的失效是「**不会主动想到**去检查缺哪个组件」，那是缺分析框架，不是知道却不做。更强的模型知道了就会用 → 不需要 → cap。

### 驳回一条：执行者自加的「便宜性」子判据不成立

执行者提出：护栏的原型是「正确路径更费力」，所以错误路径必须**当下更省事**；据此让 `slicing.walking-skeleton` 维持 `capability_gap`（它的错误行为——求稳把 schema 一次定全——**更贵不更便宜**）。

**这条推论错了，而且本仓自己的知识就是反例。** `delivery.no-inflation` / `delivery.no-overreach` 记的正是：**过交付由「做得更多读起来像做得更好」驱动，代价更高却仍是动机冲突**。动机不总是「省力」，也可以是「显得更负责/更稳妥」。

按**已批准的判据本身**重看：该点自陈「明知道第一片该是最薄的端到端线，但出于『一次做对、少走回头路』的**求稳心态**」——知道且不做，更强的模型知道了仍会这样 → **仍需要 → `motivation_conflict`**。

**已改。** 最终分布：`env 112 / cap 78 / motiv 72 / pros 5`。

> 记这一条不是为了纠一个点，是为了钉住：**判据只有已批准的那一条。** 从它派生的「可执行形式」可以帮助识别，但一旦某个派生形式与判据本身给出不同答案，**以判据为准**。执行者主动把这条推论标出来供审，是对的做法——没标出来才是问题。

### 一条存疑，未单方面改

`distill.taxonomy` 描述明写「维护者知道四类资产的定义，但在『赶紧蒸馏、别扯皮分类』的**压力下**会混杂」，按判据该翻成护栏；但四类资产分类法确实是系统内共享词汇（`/cc-master:distill` 命令与 `distilling-lessons-into-assets` 都引用它），落在 §3 反例那一类。

**两种读法都站得住，故维持执行者判定并记在此处。** 若后续实测显示它属护栏，翻它不影响其它 77 条。

### 分母：79 → **78**，而非判据文档预估的 ~70

预估值是主控写诊断时的粗估，**不是目标**。真实分母以逐条判定为准，78 就是 78。能力补课档预注册表的实测范围按 **78** 重排。
