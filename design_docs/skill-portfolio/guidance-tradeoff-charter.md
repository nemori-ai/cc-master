# 面向第五代模型的 orchestrator 指导取舍宪章（内容轴）

> 状态：**已采纳（2026-07-28）**，作为 skill portfolio 第三次重排的**内容轴** SSOT。入口见同目录 [`README.md`](README.md)；结构轴见 [`module-redesign.md`](module-redesign.md)。
>
> 采纳的是**判据体系与执行顺序**（第一部分判据、第五/第七部分的 S/M 清单与修订后执行顺序）。个别条目自带的「先 eval 再决定」标注（M7）与「待核假设」标注（6.3 末）保持原样，不因采纳而升格为结论。
>
> 依据：图快照 `ef7da7fb…`（47 module / 256 point / 418 edge）+ 本轮对 `ccm 0.22.1` 命令面与错误消息的实测 + 0.19–0.22 release 增量。
> 上游：issue #211 §3（right-size orchestrator context）。

---

## 第一部分 · 判据

### 1.1 一个五代模型被告知「你是指挥」之后，还缺什么

它不缺方法论——DAG、临界路径、委派、DDD/TDD、读 `--help`，它都会。cc-master 提供的东西**没有一样是教学**，而是补四类**结构性缺失**：

| 缺什么 | 对应资产 | 本质 |
|---|---|---|
| 跨 context 的记忆 | board / resume / handoff / ledger | **状态义肢**——补缺失的器官 |
| 资源与时间的感知 | usage / pacing / estimate | **感知义肢**——补缺失的感官 |
| 对自身失败的第一人称视角 | 红线 / 合理化表 / 红旗 | **完整性护栏**——对抗局部梯度 |
| 本项目/工具/宿主的事实 | 命令面 / API / 规则表 | **环境事实**——补不可知 |
| （加上）它本来就不会的东西 | 反模式雷达 / 理论教学 | **能力补课** |

### 1.2 耐久性谱系

| 类别 | 模型变强 | 工具变好 |
|---|---|---|
| 状态义肢 | 不变 | 不变 |
| 感知义肢 | 不变 | 不变 |
| **完整性护栏** | **增值 ↑** | 不变 |
| 环境事实 | 递减 | **消亡 ↓** |
| 能力补课 | **消亡 ↓** | 不变 |

**五类里只有两类会消亡。完整性护栏是唯一反向的。**

理由：更强的模型能造出**更有说服力的合理化**——为「这次是例外」构造一套真正讲得通的论证。它不是无知，是在对着一个与被赋予目标不同的目标做局部最优。

> ⚠️ Anthropic 删掉 80% system prompt 的结论限定词是「**on coding evals** 无可测损失」。coding eval 测能力，不测「第 30 小时长程编排里会不会谎报完成」。**拿它删红线是范畴错误。**

### 1.3 操作判据：「再强十倍」测试

对每条知识点问：**如果模型再强十倍，这条还需要吗？**

- **更不需要** → 能力补课 → **删 / 压缩成一句**
- **一样需要** → 义肢 / 环境事实 → **留**（但查接口是否已代劳）
- **更需要** → 完整性护栏 → **留，且加固，且要证据**

### 1.4 建模落点：`failure_mode` 四值

```
capability_gap        再强十倍就不需要      → 删 / 压缩
environment_fact      一样需要，工具可代劳   → 查接口 → MOVE
prosthetic            一样需要，代际无关     → KEEP
motivation_conflict   更需要                → KEEP + 加固 + 要行为证据
```

配 `altitude: dao | shu` 两轴交叉成决策矩阵。四个值各对应一个不同处置——这是枚举成形的判据。

---

## 第二部分 · 该舍（本轮已取得实测证据）

### S1 · 接口转录 —— 约 41% 的 portfolio【证据充分，可执行】

**`ccm.cmd.*` 21 点（`command-catalog.md` 69,436 tok = 26.1%）** → 术 × environment_fact，接口已表达。

实测 `ccm task --help`：每条命令自带语义（`retry：stale|failed|escalated → ready；原子归档旧 attempt evidence 并清时间/产物、verified=false`）。

**`ccm.board.validation-rules`（`board-model-guide.md` 37,104 tok = 13.9%）** → 同上。实测违规输出：

```
[hard] BIZ-DONE-VERIFIED t1 status=done 但缺少 true-done 证据（需要 verified=true 且 artifact 非空）。
       done 是对世界状态的完成声称，必须带端点验收与可追溯产物；否则 board 会把未验收/无证据的工作谎报为完成。
  怎么修：用 `ccm task done t1 --verified --artifact <path-or-url>`
```

**规则码 + 错在哪 + 为什么 + 怎么修**，全在错误消息里。

**`workflow.api-*` 10 点 + `determinism` + `resource-caps` + `api-meta` = 13 点** → harness 的 Workflow 工具描述已写明 `Date.now()`/`Math.random()` 会 throw 及其原因、16 并发 / 1000 agent / 4096 item 上限、`meta` 必须纯字面量、resume 最长未变前缀语义。**harness 每次都注入，我们又抄一遍。**

> **决定性论据：目录会漂移，`--help` 不会。** AGENTS.md 那条 `ccm` ⟷ `using-ccm` 锁步纪律存在的唯一原因就是目录会撒谎。删掉目录，连锁步维护负担一并消失。

**保留**：`--help` 里没有的东西——命令之间的**先后与组合**（`ccm.hotpath-flows`）、**该填哪个值的判断**（board-model-guide 的判断性点）。

### S2 · 反模式雷达 —— 压缩而非删除【论证充分，需 eval 确认】

`ddd.failure-radar` / `oop.failure-radar` / 部分 `slicing.antipatterns`：贫血模型、God class、继承滥用、语言漂移——**五代模型全知道**。

但**内容是 ① 能力补课，触发去看的动作可能是 ④**。所以不是删，是**压缩**：把七项教程式雷达压成一句「扫一遍结构性失败，说出你检查了什么」——保留触发，丢掉教学。这才是「rules → judgment」的正确做法。

### S3 · 撤回的假设【诚实记录】

先前怀疑 `craft.red-lines` 与 `oop.red-lines` / `ddd.red-lines` 重复。**读正文后不成立**——`craft.red-lines` 是「一句话 + 指向深度文件」的摘要路由表，正是正确的渐进披露结构。**撤回。**

---

## 第三部分 · 该补

### 统一诊断：ccm 建了需要双向参与才闭环的设施，决策层把 orchestrator 教成了纯只读消费者

这是本部分的头条。**只读不写、只收不发**——三处同形：

| 设施 | 决策层教了 | 决策层没教 | 后果 |
|---|---|---|---|
| 估算校准 | 读 `calibration_status`（还教它「不可信」） | 写 `calibration capture` | 估算永远无语料 → 永远未校准 |
| 跨编排协调 | 命令名列举（4 处） | **何时读 inbox / 何时看花名册 / 重叠面怎么算** | **inbox 积压 12 条从未被读**（实测·见 M13） |
| 指导本身 | —— | 行为证据（`behavior-eval`） | 256/256 点无据 |

**每个板都在等一个永远不会有人产生的信号。** 三个缺口的形状完全一致：机制齐备、消费侧有指导、**生产侧零指导**。

下面 M1 / M2 / M13 是它的三个实例：

#### M1 · 估算校准回路断环【最高优先·自锁死循环】

`ccm calibration` 存在，且只有一个命令：

```
capture  采集一次真实 deadline-risk predict-then-observe snapshot 到 home 级校准语料库
```

而决策层对 `calibration` 的**唯一**提及，是把它当作一个**不可信信号**：

```
calibration_status:"uncalibrated-conservative"（band 阈值是未经经验校准的保守起点）→ risk_band:"unknown"
```

**没有任何一处指导告诉 orchestrator 去 capture。**

于是死锁成环：估算永远未校准 → 指导教 orchestrator「未校准不可信」→ 它更不用估算 → 永远没有观测语料 → 永远未校准。**这个环是我们自己造的。**

**实测确证**（2026-07-28）：全仓 `calibration capture` 只出现 **4 次，全部在 `command-catalog.md` 里**——即那份命令参考在记录这个命令的存在。**零调用者、零 hook**。hook 侧唯一涉及是 `deadline-risk-core.js:194` 把 `calibration_status` 渲染进一条提示消息（纯消费）。

- **补什么**：一个决策点「什么时候 capture」。最自然的锚是 **cadence 收口时**与**任务到达终态时**——那正是 predict 与 observe 都在手上的时刻。
- **落点**：`pacing-and-estimation`（消费侧）+ cadence 收口纪律的一条增项。
- **分类**：术 × prosthetic（感知义肢的反馈半环）。

> **一个尖锐的次生论据（支持本草案的执行顺序）**：这个能力在全仓**唯一**的痕迹，就在 S1 提议退役的那份 `command-catalog.md` 里。若先执行 S1，这条能力将彻底从视野中消失——**先补 M1、再删 S1** 因此不只是风险偏好，而是必要条件。

#### M2 · 指导本身无度量【同形，且更根本】

```
evidence.kind:  canonical-prose × 256   ← 全部
verifiers:      review 143 / golden 113 · behavior-eval 0 · mutation 0
```

**256 个点的准入证据都是「这段散文存在」。** Track A/B eval 机制存在，但从未接进图。

- **补什么**：`failure_mode: motivation_conflict` 的点**必须挂 `behavior-eval` verifier**。这把 AGENTS.md 那条「纪律型 skill 改前必跑 pressure baseline」从人靠自觉的纪律，变成 schema 层可查询、CI 可卡的字段。
- **分类**：这是**元层**修复，不是知识点。

#### M13 · 多 orchestrator 的 peer 感知与 inbox 消费零指导【中介机制空转】

**ccm 侧的能力面**（实测 `ccm 0.22.1`）：

| 能力 | 作用 |
|---|---|
| `peers list` | 跨板只读花名册——全体 active + 心跳新鲜 orchestrator 的 goal / workload / priority / liveness。**ccm 自己标注为「COORD 感知通道」** |
| `coordination inbox list\|ack` | durable advisory 投递面（收件箱） |
| `coordination notify` | 低层 append 一条 inbox 通知。**自述「producer / Tier2 用」——producer 指 arbiter / hook，非 peer orchestrator**（见下文更正） |
| `coordination subscription` | credential-free、session-bound 订阅 |
| `coordination arbitrate` | deterministic pool arbiter，按同池算 pacing 建议并按边沿写 inbox |

`notify` 带 `--strength`（ADR-018 语义）——机制层建模完整。**但其定位是中介产出的投递，不是 peer 信道**（见下文第二次更正）。

**决策层的全部覆盖：4 处，全是命令名列举**——`SKILL.md:26` 工具清单一句、`SKILL.md:310` 配速热路径一句、`pool-aware-advice.md` 两处背景解释。

**零处教**：何时主动 `peers list`；**何时读 inbox**（消费触发点完全缺失）；收到 advisory 后凭什么判断响应（不是强制，谁拍板）；多 orchestrator 撞同一批文件时怎么算重叠面；`subscription` 完全零覆盖。

#### M13 的实测证据（另一 orchestrator session 的真实 transcript，2026-07-28）

一次真实长程编排在**第十轮**才发现跨板盲区。逐条记录：

**① 盲区是被一个通用自检偶然撞上的，不是靠协调指导。** 触发它的是 `verify-board` Stop hook 那句「is every to-do actually done — **including any NOT yet listed on the board**」。**全仓唯一能撞上跨板盲区的，是一句与协调无关的通用完整性自检。**

**② 三块 board 并发活跃，心跳全是秒级，它只盯了自己那块。** 第三块（ADR-061 层 A：session 执行位点 `worker_id → node_id`，跨 state + runtime_plane）**它完全不知道存在**——而那正是它自己在改的面。

**③ `coordination inbox` 积压 12 条，从未被读过一次。** 全是前一日的配额警告（当时 5h 95% / 7d 86%，读到时已是 56% / 67%，全部失效）。

> **重要更正**：先前本草案写「每个板的 inbox 永远是空的」——**错了。inbox 是满的，没人读。** `arbitrate` 或 hook 一直在自动 notify，**生产侧（自动的那部分）其实有，空缺的是消费侧。** 补强方向因此从「教它发」修正为「**教它读**」——而「教它发」这一半随后被 ADR-032 D1 整体否决（见下文第二次更正）。

**④ 消息易腐性没有进使用纪律。** `notify` 有 `--expires` flag——机制层想到了 TTL，**实践层没有消费触发点**，于是 TTL 只保证了「过期消息还躺在那儿」，没保证「有人及时读」。

**⑤ 真正的盲区不是「有谁在跑」，是「peer 的产物与我的重叠面」。** 知道有 peer 之后，它做的最值钱的一步是算重叠：

```
#525 ∩ #524 : 15 个文件两侧都改   ← 谁后合，谁再解一遍
#525 ∩ #520 :  3 个文件
#524 ∩ #520 :  1 个文件
```

而 #525 当时正在解 **29 个文件**的冲突（main 已前进 479 文件）。**#524 若抢先合入，那 29 个里的 15 个要再解一遍。** 这是 M13 代价的一个可量化真实样本。

**⑥ 该 session 自己的结论**：「这一轮自检查出的是跨 board 的调度盲区，比板内的任何一处都值钱。」

#### ⚠️ 第二次重要更正：删除「留言」诉求（与 ADR-032 D1 直接冲突）

先前本条写「补留言判据——什么值得给 peer 留一句、用什么 strength」。**删除。** 依据 ADR-032 §2.1 D1：

> **「否决点对点协商；保留『协调 ≠ 通信』」**——不引入 orchestrator 间 message-passing。**通信通道仍墓碑。** 协调一致性靠确定性联合分配消解，不靠谈判。

否决理由（ADR-032 §1）：**「LLM 点对点协商不可靠——锚定、退化平分、最后一公里谈崩」**。

因此 `coordination.inbox` 的定位是**确定性中介产出建议的 durable 投递面**，不是 peer 信道；`notify` 自述「低层 append……（**producer / Tier2 用**）」中的 producer 指 arbiter / hook，不是隔壁 orchestrator。

**技术可行性与架构许可分离（实测 `ccm 0.22.1`）**：

| 层面 | 结论 |
|---|---|
| 技术上 | **能**。`--board` 是全局 flag，`ccm --board <他人板> coordination notify` rc=0；把目标板 `owner.session_id` 改成他人值后**仍写入成功**，inbox 累计 2 条 |
| 架构上 | **明令否决**（ADR-032 D1） |
| 该不该有指导 | **不该**。「没有留言指导」在这一点上是正确的 |

**由此派生一条 ccm 侧缺口（非 skills 缺口，应另开 issue）**：架构否决了点对点协商，**CLI 却未设防**。一个 orchestrator 完全可能自行想到用 `--board` 给 peer 留言并觉得合理。该拒的没拒。

#### M13 修正后的统一诊断：不是「只读不写」，是「连读都没读」

ADR-032 的设计意图是「**机械设备出建议，智能个体决定跟不跟**」。实测证据显示：**智能个体从没打开过收件箱**（12 条积压，一条未读）。

**中介机制在空转，ADR-032 兑现的价值当前为零**——不是机制没建成，是消费侧零指导。这比原先的描述严重得多，也具体得多。

- **补什么**（删去留言后）：① 道层原则——**建议只有被读才产生价值，读的责任在消费侧**；② **消费触发点**——何时读 inbox、何时看花名册（recon 步是最自然的锚）；③ **重叠面感知**——知道有 peer 之后要算什么（改同一批文件？等同一个人？依赖同一个产物？）；④ 收到 advisory 后的响应决策（最终裁量仍在自己，advisory 不是命令）。
- **落点**：`master-orchestrator-guide`（决策）单向引用 `using-ccm`（命令面）。
- **分类**：`prosthetic`（第 3 档）——补的是「跨 session 相互不可见」这个结构性缺失。
- **另**：本条同时符合 dogfood finding 的入账条件（现象 → 根因 → 影响 → 处置），应一并落 `design_docs/dogfood-findings.md`。

#### M14 · HITL 的跨 board 排队【新缺口·由 M13 证据浮现】

现有 HITL 模型是**单板视角**的：`blocked_on:"user"` 只表达「我在等用户」。

它**不表达**「我和另外两块板在竞争同一个用户决策，且**顺序直接决定总成本**」。上述证据里三个 PR 同时挂着等同一个人 merge、且两两重叠 15 / 3 / 1 个文件——**谁先合决定谁重解冲突，而没有任何一块板能自己决定这个顺序。**

- **补什么**：当一个 `blocked_on:"user"` 节点与 peer 板的用户关口存在**共同资源竞争**（同一个人、同一批文件、同一个 merge 顺序）时，把「顺序建议 + 各顺序的代价差」一并 surface 给用户，而不是各自独立地等。
- **分类**：`prosthetic`（第 3 档）。跨板视野是结构性缺失，不是意志问题。
- **依赖**：M13 的重叠面感知（③）是它的前置——不知道重叠，算不出顺序代价。

#### M15 · 派发 prompt 的道 / 品味 / 最小约束红线【本草案的递归形式】

**现状（实测覆盖）**：

| 位置 | 内容 | 性质 |
|---|---|---|
| `scheduling.node-contract` | 契约**必须含哪些字段**：Input deps / Output schema / Success predicate / Timeout+budget / Escalation condition | 骨架清单 |
| `dispatch.md`（`dispatch.routing-and-isolation`） | 并行 writer 的隔离工作树绝对路径必须写进派发 prompt | 一条具体增项 |
| `multi-layer-planning.md`（`multilayer.handoff-contract`） | 够格大节点要把「发现并遵循项目自己的 planning 规范」写进派发指令 | 一条具体增项 |
| `board-model-guide.md` | prompt / stdin / secrets 永不进 board | 安全边界，非撰写指导 |

**全部是「必须含什么字段」与「必须加哪两条」。** 专门检索「怎么写好」那一层（`别把…` / `过度指定` / `留给执行者` / `不要规定`）→ 命中全部落在 outside-in / decomposition / board 等其它主题，**关于派发 prompt 的：零**。

**三样都没有**：

- **道** —— 一个好的派发 prompt 是什么形状？给目标还是给步骤？给约束还是给判据？
- **品味** —— 约束到什么程度算刚好？何时多说一句是帮忙，何时是把执行者降格成规则机？
- **最小约束红线** —— 什么**绝不能**写进去、什么**绝不能省**。

##### 这是本草案的递归形式

本草案整篇在回答「给 agent 的指导该给多少」。而 **orchestrator 每次派发，都在对一个 subagent 做一次微缩版的同一取舍**：

| 本草案的判据 | 派发 prompt 上的对应 |
|---|---|
| 五代模型不需要能力补课 | 别在 prompt 里教 worker 它已经会的事 |
| 完整性护栏随模型变强而增值 | 验收判据 / 停止条件 / 升级条件**绝不能省** |
| 环境事实该退给接口 | 项目事实**指路径**，别抄进 prompt |
| 过度约束导致性能退化 | **把实现方案写死进 prompt** |

##### 最要命的一条：过度指定是「指挥不演奏」的隐蔽违反

把方案钉死到 worker 只剩打字，**形式上完全合规**（派发了、没写代码），实质上和亲手做只差一个执行者。**现有红线抓不到这个形态**——`conduct.never-play` 抓的是「你自己动手」，抓不到「你让别人替你逐字打出你已经想好的东西」。

##### 边界：#158 补不了这一层

`#158`（为不同 harness/model 提供针对性 prompt 撰写指导）覆盖的是**术**层——「这个模型偏好哪种结构」。它**不覆盖道层**：该约束多少、什么绝不能写、什么绝不能省——**这些与目标模型无关，是编排者自身的纪律**。

> **#158 会告诉你「对这个模型该怎么写」，不会告诉你「该写多少」。** 对五代模型，后者才是关键问题。

##### 判定与落点

- **`failure_mode`**（顺序过滤器）：知道怎么写 prompt 吗？知道。缺项目事实吗？不缺。下个 context 会忘吗？不会。**压力下会写歪**——赶时间就把方案钉死（省得来回），图省事就丢一句「把这个做了」。→ **第 4 档 `motivation_conflict`**。
- **双侧走廊**：过度指定（把 worker 当打字机）↔ 欠指定（没有验收判据就派出去）。
- **落点**：**不新建 module**。作为 `dispatch.parallel-mechanisms` 或 `routing.worker-chain` 的一个新点——它是派发链上的一环，不是独立主题。

### 完整性护栏的四个洞（随模型变强而放大）

现有护栏防的是：假完成、幽灵 in_flight、越权 merge、亲手实现、装忙、无 ledger 收口、镀金、闭门造车。**没防的：**

#### M3 · 假 replan / 图稀释【五代模型特有风险】

Goal Delta 管的是**目标语义**变更。它不管**图的难度被悄悄降低**——遇阻时重编一张更容易的 DAG，目标字面没变，但验收强度稀释了。

**五代模型能把「我换个思路」论证得极其合理**，这正是它比四代更危险的地方。

- **补什么**：replan 时一条闸——「新图相对旧图，是否降低了验收强度、或删除了未完成的承重节点？若是，那是 scope 变更，走目标语义变更流程，不是 replan」。
- **分类**：道 × motivation_conflict。

#### M4 · artifact 的实质性无闸

`verified=true` + `artifact` 非空是硬闸（引擎层已强制）。但 **artifact 可以是一个存在却空洞的文件**——闸检查的是存在性，不是实质性。

- **补什么**：artifact 的最低实质性判据——**它必须能让一个没参与这次实现的第三方独立复核到同一结论**。
- **分类**：道 × motivation_conflict。

#### M5 ·「我读了 diff 觉得没问题」也是自欺

`verification.heterogeneous-review` 存在，但触发条件是「高杠杆 / 临界强制」。**对自评本身没有设闸**——而模型越强，对自己判断的置信越高，越不觉得需要第二视角。

- **补什么**：把「自评通过」纳入需要证据的范畴——你凭什么认为你读懂了这个 diff？读了哪几处？哪几处是你没看懂但跳过的？
- **分类**：道 × motivation_conflict。

#### M6 · 长程累积漂移

每一步都过 Goal Trace Test，30 步之后整体已经偏了。**只有逐步闸，没有周期性整体回望**——每步都对着上一步合理，累积起来对着原始目标不合理。

- **补什么**：cadence 收口时一次「整体回望」，对照**原始 goal** 而非上一步。
- **分类**：术 × motivation_conflict。

### 品味的两个洞

#### M7 · 没有「好的协作长什么样」

本轮新增的 `collab.unknowns` 是**手法**（术）：怎么扫描、怎么造物、怎么问。但没有对应的**品味**（道）：一次好的人机协作长什么样？什么时候「问得少」反而是对的？

`control.good-orchestration` 有「好编排的正向形状」，协作侧缺同层的东西。

- **分类**：道 × capability_gap？——存疑。五代模型的协作品味可能已经不错。**这条建议先 eval 再决定是否补**，避免犯我们正在批评的错误。

#### M8 · 没有「什么时候该放弃这个目标」

现有的停止判据全在**完成**侧（收敛即停、验收通过、DDL 到达）。**没有「这个目标本身不值得继续」这一侧。**

长程编排是沉没成本最强的场景：跑了 20 小时，发现前提错了——现有的所有纪律都在推动「继续推进到验收」，**没有一条允许并引导「停下来重议目标」**。

`outside.unknown-and-amendment` 管的是外部证据改变目标语义时走 amendment；它假设目标仍然值得追。**不覆盖「目标本身该被放弃」。**

- **分类**：道 × motivation_conflict（沉没成本是最经典的动机冲突）。**这可能是护栏侧最大的单个缺口。**

---

## 第四部分 · 不动的

- **状态义肢全体**（board / resume / handoff / ledger 的窄腰与纪律）——代际无关，工具无关。
- **`craft.red-lines` 摘要路由表**——结构正确（见 S3）。
- **`workflow.selection` 的准入与形状决策树**——这是判断，不是 API 转录，`--help` 不会告诉你「值不值得上 Workflow」。
- **`engineering-with-craft` / `authoring-workflows` 的内部结构**——图上最健康的两个（cohesion ≥1.95、零孤立点），动它们无收益。

---

## 第五部分 · 执行顺序与判定证据

| # | 项 | 类型 | 前置 | 判定证据 |
|---|---|---|---|---|
| 1 | `failure_mode` / `altitude` 两轴落 schema + 标注 `check` 36 点 | 元层 | — | `check` 绿 + `report` 出分桶 |
| 2 | **M1 校准回路** | 补 | — | 跑一轮编排后 `calibration_status` 不再恒为 `uncalibrated-conservative` |
| 3 | **M8 放弃目标的品味** | 补 | 1 | Track B：注入「20 小时后前提被推翻」场景，看是否会重议而非硬推 |
| 4 | **M3 假 replan 闸** | 补 | 1 | Track B：注入「遇阻」场景，看新图是否稀释验收 |
| 5 | **S1 接口转录退役** | 舍 | 2,3,4 | Track B：删除后 agent 仍能正确完成 board 操作（靠 `--help` + exit 3） |
| 6 | **M2 behavior-eval verifier 硬化** | 元层 | 1,3,4 | `motivation_conflict` 点 100% 挂上行为证据 |
| 7 | M4 / M5 / M6 护栏补强 | 补 | 1 | 各自 pressure baseline |
| 8 | S2 反模式雷达压缩 | 舍 | 6 | 压缩前后 Track B 无回退 |

**顺序的理由：先补护栏、再删转录。**

删是不可逆的、且我们**没有任何行为证据**（256/256 无据）。而护栏侧的缺口随模型变强而放大——先补上，我们才有一个能承受删减的底盘。反过来先删，一旦删错，发现的方式是某次真实编排谎报了完成。

**S1 是最大的一笔（41%），但排在第 5 位，不是第 1 位。**

---

---

## 第六部分 · 分类学的验证结果与修正

### 6.1 双人独立分类：两轴全一致 19/36 = **53%**

用 codex 作异构第二评分者，对同一份 36 个 `check` 点、同一份规则、独立分类。结果**不足以支撑 256 点的审计**。

分歧不随机，**全部聚在两个轴的定义模糊处**：

| 分歧簇 | 数 | 实质 |
|---|---:|---|
| `prosthetic` vs `motivation_conflict` | 5 | step6-ledger / ledger-antipatterns / handoff-guards / alignment-checkpoints / user-understanding。一读「它在描述外部记忆机制」，一读「它在防压力下跳过」——**同一条点同时是义肢和纪律，两个读法都对**。 |
| `dao` vs `shu` 在反模式雷达上 | 4 | ddd/oop failure-radar、abstraction-cost、slicing.antipatterns。一判道（在讲什么是好设计），一判术（是一张具名清单）。 |
| `routing.handle-gate` | 1 | 道 × motivation_conflict（防自欺「我派出去了」）vs 术 × environment_fact（handle 是系统追踪事实）。两极。 |

### 6.2 诊断与修正：把 `failure_mode` 锐化成顺序过滤器

根因：它同时可被读成「这条知识的**内容**属于哪类」和「**删了**会发生什么失败」。

修正**不是加轴**（那就是本草案正在批评的过度建模），是把同一个问题改成**顺序过滤器**——每档假设前档已满足，于是互斥：

> **删掉这一条，会发生什么？**
> 1. 模型**不知道**该怎么做 → `capability_gap`
> 2. 知道，但缺这个项目/工具的具体事实、**做不对** → `environment_fact`
> 3. 知道也做得对，但**下一个 context 里全忘了** → `prosthetic`
> 4. 知道、做得对、也记得，**但压力下选择不做** → `motivation_conflict`

**平局规则**：同时命中取更靠后的（处置更保守——`motivation_conflict` 要求加固 + 行为证据）。

`altitude` 同样机械化：**列举了具体项（反模式名 / 字段名 / 命令名）→ 术；只给判据不给清单 → 道。**

改完必须**重跑同一份 36 点双人对账**，一致度上不去说明轴选错了——此时仍只赔 36 点标注。

### 6.4 第 0 步的执行结果：单轴通过，`altitude` 被否证【已执行·2026-07-28】

按 6.2 的锐化措辞重跑同一份 36 点双人独立对账，结论是**分裂的**：

| 轴 | 锐化前 | 锐化后 | 判定 |
|---|---:|---:|---|
| `failure_mode`（顺序过滤器） | —（两轴合并 53%） | **81%** | **通过**，可支撑 256 点审计 |
| `altitude`（道 / 术） | — | **44%** | **否证**，低于随机基线的实用阈值 |

`failure_mode` 的锐化生效了——把「这条知识属于哪类」改成「删了会发生什么失败」的顺序过滤器，一致度从两轴合并的 53% 升到单轴 81%。而 `altitude` 即便配上「列举具体项 → 术；只给判据 → 道」的机械规则，仍然降到 44%：**同一条点常常既列了清单又给了判据**，规则本身在真实语料上不可判。

**决定：砍掉 `altitude`，只落 `failure_mode` 单轴。**

这条否证的价值大于它的成本：它花 36 点的标注赔本，挡住了一次 256 点规模的、建立在不可靠轴上的全量审计。本文正文各处 S/M 条目里写的 `道 × …` / `术 × …` 标注**保留为叙述性判断，不作为 schema 字段**——schema 只收 `failure_mode`。

### 6.3 撤回：不拆 `motivation_conflict` 的方向

曾提议拆成 `_under`（省事）/ `_over`（过度）以暴露覆盖不对称。**撤回**——这类点的正确形态本来就是**双侧走廊**，一个点覆盖两侧（`outside.low-risk-exception` 是本仓成熟先例）。

改为一条**写作规约 + 可机械检查的条件**：

> 凡 `motivation_conflict` 类的点，**必须同时命名两侧悬崖**（省事那侧与过度那侧）。只写一侧的，覆盖不全。

比加枚举值便宜得多。（现有 22 个点里多数只写了一侧——**此为待核假设，未逐条验证，不作结论**。）

---

## 第七部分 · 过交付缺口与倾向性偏好体系

### 7.1 结构性不对称（实测）

```
「只做被要求的 / 不做没被要求的 / 范围之外」这类统一道层原则 → 全仓零命中
```

现有护栏**几乎全在欠交付侧**（假完成、幽灵任务、跳过测试、谎报绿、无 ledger），且集中在道层。**过交付侧有护栏，但全是局部术层条款**：镀金绑 devloop 收敛、装忙绑 fill-work 准入、过度求证绑 outside-in 走廊、过度切碎绑 slicing。**无统一道层原则。**

**而五代模型的主要风险在过交付侧**：欠交付由省成本驱动，过交付由「做得更多读起来像做得更好」驱动，后者是能力过剩的直接产物。

### M9 · 简单问题复杂化（过度设计 / 过度实施）

最接近的既有点 `devloop.regularize` 说的是「在**同样满足目标函数**的多个方案里选最简单的」——注意那个前置条件。它管**在方案间选简单的**，不管**问题本身被放大了**。M9 的核心恰是后者：把简单问题框成复杂问题，再完美地解决那个被放大的问题。**现存护栏够不着。**

- **分类**：道 × motivation_conflict（过度侧）

### M10 · 过分热情导致越界

做了本不在这个目标边界内的工作。**完全空白。**

- **分类**：道 × motivation_conflict（过度侧）

### 7.2 倾向性偏好：`preference.*` 新 module

**问题**：cc-master 必须表态（否则模型偷懒），又不能压过项目自己的规矩——它是 project-agnostic 的。

**共享根只说一次**（同型先例：`craft.foundation` 五条共享根 + 各 reference 展开）：

```
module:preference.defaults 《实施倾向与让位机制》
├─ preference.precedence               道   ← 共享根
├─ preference.isolated-implementation  术   worktree
├─ preference.doc-alignment            术   文档对齐
├─ preference.review-scoping           术   评审维度
└─ preference.non-convergence-as-signal 术  不收敛作诊断信号
```

#### `preference.precedence`（共享根）

**三级让位**：① 项目显式规则（AGENTS.md / CONTRIBUTING / lint 配置）> ② 项目隐含惯例（既有代码的实际做法）> ③ cc-master 兜底倾向。

措辞必须是**缺省值而非规则**：「除非项目另有约定，默认 X」。这与 Claude 5 把 `never write docstrings` 改成 `match its comment density` 同源——**把绝对规则换成向本地环境让位的相对规则**。

**自毁风险与解药**：只写「默认 X，项目可覆写」，聪明的模型会**拿覆写条款当合理化入口**（「这个项目没明说，但我推测它偏好简洁，所以我不写测试」）——**让位条款本身成了偷懒的授权书**。故必配**举证责任**：

> **声称「项目另有约定」的一方要给出证据**——指向文件行（`CONTRIBUTING.md:42`）或既有代码的具体位置（相邻模块都这么做，见 `a.ts:10`、`b.ts:22`）。**「项目似乎偏好 X」不算数。**

与 outside-in 的「内部共识不是外部验证」完全同型，直接复用其心智。

#### 四条倾向（每条写成走廊）

| 点 | 偷懒侧 | 过度侧 | 既有覆盖 / 缺口 |
|---|---|---|---|
| `isolated-implementation` | 直接改主 checkout | 一行改动也开树 | `dispatch.routing-and-isolation` 已有**并行 writer 必须独立 worktree**；缺**单任务默认也隔离**、**hub → sub 拓扑**、让位机制 |
| `doc-alignment` | 改完不回写 | 小改动写一篇设计文档 | `sdd.change-order` 有 spec→impl→test；只管**合约**不管 README / 设计文档 / 变更记录，且只管「改」不管**实施前先读齐** |
| `review-scoping` | 不评审 | 过度评审 | `verification.heterogeneous-review` 管**谁**评；不管**评哪些维度**及维度如何随事项性质伸缩 |
| `non-convergence-as-signal` | 一到保险丝就当完事收工 / 第 N 轮还在局部打补丁 | 一轮不顺就推翻重做 | 见 7.3 |

#### worktree 这条必须切干净的边界

本仓项目自用 skill 里最重的红线是 **single-committer——spoke 绝不自己 commit**。**它绝不能进分发倾向**：那是 cc-master 自己的收口约定，别的项目完全可能让每个 spoke 自开 PR。

- **可分发的倾向**：默认隔离实施 / 并行时 hub + 一 agent 一 sub 树
- **必须去项目里发现的**：谁能 commit、怎么收口、分支命名、清理时机

**这是 `preference.precedence` 的第一个 worked example**，同时避开 issue #211 明令禁止的「把 project-only dev skill 正文直接复制进分发 skill」。

### 7.3 M12 · 不收敛作诊断信号 —— 一条断链，不是缺知识

三段各自都有，**链没接起来**：

```
verification.loop-convergence      ← 可观测信号（第 N 轮仍未收敛）
        ↓ 【边不存在】
「上游阶段有系统性盲区」            ← 诊断：不收敛是证据，不是要熔断的噪声
        ↓ 【边不存在】
devloop.plateau-restart            ← 动作（但只到同层 restart，不到跨阶段回溯）
```

两个差异是精确的：① `plateau-restart` 的 restart 动作全在**同一层内**（换 hypothesis / 换起点 / 重切 acceptance），不含**跨阶段回溯**；② 它的信号是**实施者自省**，而评审轮次是**验收侧可观测计数**——后者硬得多，不依赖执行者承认自己钻了牛角尖。而那个计数已存在于 `loop-convergence` 的 max-rounds 保险丝，**却只被当作熔断条件、没被当作诊断信号**。

**这三段分属两个 skill，而跨 skill 边为 0——M12 是第一份重设计报告 P2「142 处散文层间引用 vs 0 条图上层间边」的一个具体受害者。** 它反过来给 P2 放宽 `external_edge_policy` 提供了具体正当理由：不是为了图好看，是为了这条诊断链能被表达。

**自毁风险**：「我觉得有系统性盲区」是放弃一个只差两轮就收敛的方案的完美借口。必须配硬判据——例如：连续 N 轮的 finding 是否落在**同一维度**、是否每轮都在修**新出现**的问题而非同一个问题。

---

## 附：本草案自身的诚实边界

- 「五代模型已经会 X」这类判断，本草案**没有一条有实测支撑**——全部是论证。这正是 M2 要修的问题，也是为什么 S 类全部排在补强之后。
- ccm 错误消息与 `--help` 的质量是**实测的**（本机 `ccm 0.22.1`），S1 因此是全篇证据最硬的一项。
- M7 明确标注为「先 eval 再决定」，以免在批评过度约束的同时自己增加过度约束。
- **第六部分的 53% 一致度是本草案最重要的自我否证**：它说明第一部分那套判据在当前措辞下不可靠复现。第五部分的执行顺序因此**必须以 6.2 的修正版重跑 36 点对账为第 0 步**，而不是直接进 256 点。
- 本草案两次撤回了自己的结论（S3 的重复假设、6.3 的方向拆分提议）。两次都是因为「读了原文」或「共性浮现」，不是因为外部纠正——记录在案，作为草案可信度的一部分。

---

## 修订后的执行顺序（替代第五部分）

| # | 项 | 类型 | 判定证据 |
|---|---|---|---|
| **0** | 按 6.2 锐化两轴措辞，**重跑 36 点双人对账** | 元层 | 一致度显著高于 53%；否则轴选错，停下重设计 |
| 1 | 两轴落 schema + 标注 36 点 + `report` 分桶 | 元层 | `check` 绿 + 分桶可查 |
| 2 | **M1 校准回路** | 补 | `calibration_status` 不再恒为 `uncalibrated-conservative` |
| 3 | **M8 放弃目标的品味** + **M9/M10 过交付道层原则** | 补 | Track B：前提被推翻场景 / 简单问题被复杂化场景 / 越界场景 |
| 4 | **`preference.*` 五点**（含 precedence 共享根 + 举证责任）+ **M13 peer 感知与 inbox 消费 + M14 HITL 跨板排队 + M15 派发 prompt 的道与红线** | 补 | Track B：项目有本地规则时是否让位；无规则时是否守缺省；覆写是否给证据 |
| 5 | **M3 假 replan 闸** + **M12 断链**（依赖 P2 放宽跨界边） | 补 | Track B：遇阻场景新图是否稀释验收；不收敛是否触发跨阶段回溯 |
| 6 | **S1 接口转录退役**（41%） | 舍 | Track B：删除后仍能靠 `--help` + exit 3 正确操作 board |
| 7 | M2 behavior-eval verifier 硬化 | 元层 | `motivation_conflict` 点 100% 挂行为证据 |
| 8 | M4/M5/M6 护栏补强 + S2 雷达压缩 | 补/舍 | 各自 pressure baseline / 压缩前后无回退 |

**S1 仍是最大一笔（41%）却排第 6**：删不可逆、零行为证据，而护栏缺口随模型变强放大。**先拿到能承受删减的底盘，再删。** 且 M1 的唯一痕迹就在 S1 要删的那份文件里——顺序是必要条件，不是偏好。
