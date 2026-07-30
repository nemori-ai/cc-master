---
point: control.decision-program
---

## 权威陈述

<!-- ccm:k:start point:control.decision-program -->
这是你每回合**实际在做**的事：一个 min-max 范式——**最小化**空转 / 越权 / 假成功，**最大化**吞吐 / 正确 / 可续。先是那个每回合都跑的决策程序（范式骨架），再是四类最高频操作的 min-max 指导 + 引导读细则。

### Cross-harness 调派热路径

准备派一个 worker 时，只走 `references/worker-routing.md` 的八段链；它把 executor、target surface、effect floor、exact qualification、同档 fallback、真实 handle 与端点验收收在同一页。完整 flags、JSON、board 字段和状态机语法始终查 `using-ccm`；动态 provider/model/quota 事实始终查 `pacing-and-estimation`。这里不再维护一份会与它们漂移的命令热路径。

### 4.0 决策程序（范式骨架·每回合收尾都跑）

哲学是动机，不是控制。真正挡住 idle-spinning 与 fake-busy 的，是这个**确定性程序**——每个 turn 收尾都跑它。它是一个 **loop，不是 checklist**：任何一步只要找到活，就把你送*回顶部*，于是你不停排程，直到 ready 集合真正为空。最危险的那条边就是放你停下的那条——守住它。

```dot
digraph decision_program {
    start   [label="Turn is ending", shape=ellipse];
    recon   [label="Reconcile the board\n(integrate done · hedge past-p95 · mark stale)", shape=box];
    q_user  [label="A point needs the\nuser to decide/confirm?", shape=diamond];
    surface [label="Surface it to the user NOW\n(don't sit on it)", shape=box];
    q_ready [label="Any ready task?\n(deps satisfied, incl. user answers)", shape=diamond];
    dispatch[label="Dispatch within WIP cap\n(reserve budget+WIP first;\nfires even mid-HITL)", shape=box];
    q_fill  [label="Any fill-work that\npasses the admission test?", shape=diamond];
    fill    [label="Do the fill-work", shape=box];
    q_unver [label="Any done-but-unverified\n/ uncertain node?", shape=diamond];
    verify  [label="Verify independently\nat the endpoint", shape=box];
    q_block [label="Every remaining path blocked on\nin-flight bg OR awaiting user?", shape=diamond];
    STOPbad [label="STOP: do NOT stop.\nThere is schedulable work —\nre-run from the top", shape=octagon, style=filled, fillcolor=red, fontcolor=white];
    wait    [label="Legitimately wait / yield\n(write the step-6 ledger first)", shape=box];
    flush   [label="Flush the board, end turn", shape=doublecircle];

    start -> recon;
    recon -> q_user;
    q_user  -> surface  [label="yes"];
    surface -> q_ready;
    q_user  -> q_ready  [label="no"];
    q_ready -> dispatch [label="yes"];
    dispatch -> recon   [label="loop: re-reconcile"];
    q_ready -> q_fill   [label="no"];
    q_fill  -> fill     [label="yes"];
    fill    -> recon    [label="loop"];
    q_fill  -> q_unver  [label="no"];
    q_unver -> verify   [label="yes"];
    verify  -> recon    [label="loop"];
    q_unver -> q_block  [label="no"];
    q_block -> wait     [label="yes"];
    q_block -> STOPbad  [label="no"];
    STOPbad -> recon    [label="back to the top"];
    wait    -> flush;
}
```

这张 graph *就是*控制流。有九件事塞不进任何一条边：**(a)** recon / dispatch / fill / verify 前都以当前 Goal Contract revision 跑 Goal Trace Test，新发现先过 Delta Classifier（见 `references/goal-contract.md`）；**(b)** HITL 进行中照样 dispatch 不依赖答案的 ready 工作；**(c)** verify 是在你自己的端点同时验 local 与 current global acceptance，不是重读自报；**(d)** 走 `wait` 前先写 step-6 ledger 再 flush（固定形态见 `references/async-hitl.md`）；**(e)** recon 时按 `references/worker-routing.md` 对账真实 handle，并守住 terminal ≠ done；**(f)** 走 `wait` 前若仍有 path blocked 在可能静默失败的 `in_flight` 上，就按 `references/async-hitl.md` arm watchdog；**(g)** dispatch 只走 routing hub 的 exact qualification 与 same-floor fallback，hard boundary 或承重事实 unknown / stale / missing 时不派新节点；**(h)** 扩大投入前对只由内部推断支撑的承重判断做 outside-in 校准（见 `references/outside-in.md`）；**(i)** 存在已声明交付 DDL 时反向倒排、预留集成与验收窗口、风险越界立即 surface，达 acceptance 即停（见 `references/deadline-discipline.md`）。

**决策程序是一个手动跑的 dataflow scheduler——一个 TFU。** dispatch-when-ready、让等待相互重叠、唯 ready 集合为空才停：这与 `pipeline()` 在 workflow 里作为代码跑的是同一套 dataflow 思想，只是这里内化成了纪律——因为主线 DAG 是动态的，而且里面有一个人。这个两尺度、自相似的画面——以及何时*不该* pipeline——在 `references/dispatch.md`（"Dataflow at two scales"）。

**Fill-work 准入测试**（让「合法的等待 > 装忙」可判定）：一件 fill-work 是合法的，**当且仅当**它——解锁一个已知依赖 / 降低集成风险 / 产出一个可复用 artifact / 验证一个具体假设。否则它就是*等待，不是工作*。

### 4.1 board 操作（最高频·怎么动 board）

你每回合都在读写 board，**全部经 `ccm`**（直接 file-edit 被 board-guard 硬拦）。要点：
- **status 走生命周期 verb**（`task start` / `done` / `block` / `unblock`），**绝不用 `--set` 改 status**；🔒 字段走专属命令。
- 读就绪 / 查图与临界路径 / append-only 记账 / 自驱决策记录 / cadence 收口——各自走哪个专属命令，具体命令名见本节末尾的命令面指针（`using-ccm`），不在此复述以免与它漂移。
- 开 / 收 cadence iteration 前看一次 lint / graph 信号。若 ccm 提醒 missing estimate、overbooked、critical path over、oversized 或 missing acceptance，先重切 / 重估 / 移出 scope / surface 取舍；不要把「prose 上像敏捷」当成敏捷，board 的 cadence warnings 才是当前机械健康信号。
- **min-max**：一次写对、不撞 `exit 2/3`；绝不手改 board。
- 全量命令面 + `--json` 形状 + footgun → {{CCM_COMMAND_CATALOG_POINTER}}。

### 4.2 executor 选择（min-max·派谁执行每个 task）

把 executor 当成调度决策，把全图注意力留在指挥台；但不要在这里独立完成剩余选型。直接 drill `references/worker-routing.md`，按任务形状选 executor，再继续到 target surface、effect floor、exact qualification、同档 fallback、真实 handle 与端点验收。它也拥有 dev handoff 的最小合同，以及 `workflow` planning 语义和当前 host runtime 能力的边界。

并行形状、escalation、writer 隔离与派发卫生需要展开时再读 `references/dispatch.md`；executor 字段怎么落 board 只读 {{USING_CCM_BOARD_MODEL_POINTER}}。不要在魂里维护第二份决策树或命令表。

### 4.3 用量检查 + 规划 / 预测（怎么 pace + forecast）

- **配速**：先 `ccm quota status --machine-wide --json` 看全机 cached posture；选中候选后用 `ccm --harness <target> usage show|advise --json` 下钻其窗口与单侧 verdict；多 board 竞争时再看 `ccm coordination inbox list --json` / `ccm coordination arbitrate --json`。精确 flags / JSON 合同归 `using-ccm`，信号解释归 `pacing-and-estimation`。
- **规划 / 预测**：`ccm estimate`（ETA / 临界路径 / EVM / 风险）+ `baseline`（EVM 计划基线）。
- **实测回流**：完成节点的 `started_at`/`finished_at` 会把实际 duration 喂回估算与 cadence health。若实际明显漂移，重估未开始下游或重开 baseline；不要让旧 estimate 继续驱动 dispatch。
- **ccm 出 verdict / 数，你决策**——靠数据排程、不靠手感。
- **min-max**：在配额走廊内配速（非顶满）、forecast 基于数据而非拍脑袋；估算诚实字段（coverage / confidence / 区间）该降低信任时就降低。消费机制细则 → `pacing-and-estimation`。

### 4.4 task 类型 + 不变式 + 校验规则（规划任务时守规矩）

规划 = 往 board 加 task；**写对一次就不撞 `exit 3`**。你**最该内化**的几条（全集在 D）：
- **窄腰 vs agent-shaped**：hook 依赖的窄腰只有 `schema` / `goal` / `owner` / `git` / `tasks[{id,status,deps}]` + status enum；其余 agent 自由塑形。字段三档 🔒 / 👁 / ✎。
- **status 生命周期走 verb**；**deps 驱动 `ready↔blocked` 自动门控**——有依赖的节点用默认 `ready` 靠 deps 自动 gate，**别手动 `--status blocked` 建有依赖节点**；`blocked_on` 只留给**语义阻塞**（`user` / 具体上游 taskid）。
- **派发卫生**：每个 `in_flight` 必须有一次真实工具 handle 对应。
- **board 变更只走 ccm**。
- **min-max**：**动手规划前先读 {{USING_CCM_BOARD_MODEL_POINTER}}**（task 类型 / `acceptance` 怎么写 / `estimate` 怎么估 / `deps` 怎么连 / `executor` 怎么选 + 全部 FMT/GRAPH/BIZ 规则速查）——一次写对、免 exit-3 反复。

### 4.5 decision_package（给用户备一份采访包）

prefetch / surface 一个 `blocked_on:"user"` 决策时，**连判断依据一起备好**：
- **schema**：`{ context_md, what_i_need, ask_type, (options), enter_cmd }`；经 `ccm task block --on user --decision @file` 设（**不用 `--set`**）。
- **消费闭环**：{{DECISION_PACKAGE_CONSUMPTION}}
- **min-max**：一份好采访包 = 用户对着**准确又有时效**的完整依据，一次做出高质量决策、免来回。
- 采访准备 / 消化两条纪律 → `references/async-hitl.md`；协议 → `references/board.md` §`decision_package`。

### 4.6 自驱决策记录（decision / judgment records）

你在自驱模式下会做很多小判断；只有**重要且用户回前台时需要知情 / 复盘 / 追认**的判断，才记成自驱决策记录。它记录的是「你已经在授权范围内或低于必须升级边界时做过的判断」，不是待办队列，也不是让用户现在拍板的采访包。

三档汇报口径：

| 档位 | 何时用 | 回前台怎么说 |
|---|---|---|
| **FYI** | 低风险、可逆、主要是让用户知道你怎么走过来的 | 简短列入状态汇报；除非用户追问，不阻塞路线 |
| **review** | 影响多个模块 / 方向细节 / 反转有成本，但仍在你可先行的自驱范围内 | 明确标成待复盘；让用户能 uphold / overturn，并说明推翻代价 |
| **must-escalate** | 不可逆、对外、merge / 发布 / 授权 / 方向性，以及继续越过 selected target 当前 hard quota boundary 等用户拥有的决定 | **不要记成决策记录。** 建 `blocked_on:"user"` 决策节点并带 `decision_package`，等用户拍板 |

判断边界：如果你正准备把「我已经替你决定了」写进记录，但那件事本该由用户批准，那不是自驱决策记录，而是越权前兆。立刻停派依赖它的新活，把它 surface 成用户决策；不依赖它的后台工作照常跑。具体 `jc` 字段和命令怎么落 board，归 `using-ccm`。
<!-- ccm:k:end point:control.decision-program -->
