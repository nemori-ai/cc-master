# 异步完成 + HITL

> **服务愿景：C3**（自主决策 vs 人类接入的边界）。**何时读：** 驱动异步完成 + human-in-the-loop 时——in-flight 的 p95 追踪与 hedging、收到通知即整合（integrate-on-notification）、HITL 模型（用户即异步 worker）、前台对话 ∥ 后台执行、step-6 ledger、**等待前 arm watchdog（自我唤醒安全网）**。

怎样异步地驱动各项工作收尾，并把用户当成一个特殊的异步 worker——让前台对话与后台执行并行跑，主线永不空等（idle-wait）。

来源：research report 2（"主线不空等" = 一处生态缺口）+ 镜头 4 与 7。

---

## In-flight 追踪 —— `started_at` → p95 → hedge / degrade

每个已派发的节点在 board 上携带 `started_at`（起跑时刻，严格 ISO-8601 UTC；旧板的旧名 `dispatched_at` 仍被 view.html read-fallback 认出——见 `references/board.md`）。把它已耗的时间对照**这一类任务的 p95 时长**来追踪。一旦某个节点超过它那一类的 p95：

- **hedge** —— 为同一任务再派一个备份 agent，谁先完成用谁；或
- **degrade** —— 让它带着降级的结果通过。

这背后的纪律（"某个 agent 卡死了 → 退回任务池" / "60 分钟硬截止"）：别让单个慢 agent 拖垮整批。**别** busy-poll 单个 agent 的进度，也别手搓 file-size 轮询去猜它完成没有（已被证明是瞎蒙的失招）——用结构化并发（structured-concurrency）的 join，再拿有用的工作填满等待窗口。

> **澄清（别误读成与 `dispatch.md` 打架）：** 这里禁的是**主线前台 busy-poll**——指挥在前台空转忙等单个 agent。而 `dispatch.md` §「等待外部状态」推荐的**后台 shell 轮询**（`until … sleep` 骑完成通知重入）是正交且正确的：它把轮询放进一个零 token 的后台 shell、靠完成通知驱动重入，主线照样去填等待窗口、绝不空转。一个是前台空等（禁），一个是后台等外部状态（荐）。

---

## 整合各项完成 —— 收到 `<task-notification>` 时

当一个 `<task-notification>` 到达：

1. **对账 board（reconcile）** —— 把完成的后台结果折回它的节点，标 `done`（在端点验收之后——见 `resume-verify.md`）。
2. **解锁新就绪** —— 凡是最后一条依赖刚被满足的节点，转为 `ready`。
3. **在 WIP 内派发** —— 在 WIP cap 内启动这些新就绪的节点。

这就是决策程序里"收到通知即整合"的那一半（step 1 + step 3）：你不轮询；通知驱动对账，对账驱动下一次派发。

---

## HITL 模型 —— 用户是一个特殊的异步 worker（镜头 4 & 7）

- **用户决策即刻抛出** —— 一旦某个点需要用户拍板或确认，就立刻抛给用户，别压着（镜头 4：明明能行动却被动，就是罪过）。同时也别在本该由用户决定的事情上越界：任何不可逆 / 对外 / 方向性 / 最终批准（如 merge）都必须先问（镜头 7，别擅自做主）。
- **用户输入是一条异步依赖** —— 把它建模成一个 board 节点：`status: "blocked"`、`blocked_on: "user"`。用户的回答不过是满足那条边的又一条异步依赖。
- **prefetch 可预见的用户决策——ask-trigger 是"只有用户能回答"，绝不是"该节点变就绪了"** —— 扫一遍 DAG 里那些还没就绪的节点，挑出决策形态的歧义（可接受的停机时间、scope 砍取、go/no-go 约束、spec 没写到的点）。只要用户可达、且答案会左右派什么 / 怎么派，**现在就问**——一个自然的前台节拍（一次状态回复）就是完美的载体。一个 prefetch 来的答案是白赚的 float；"到那一步我再停下来问"会把未来的临界路径死死焊在用户的在线时间表上。边界：这**不是**"把整个问题积压一次清空"——一个 context 都还不存在的投机性问题，换来的是不可靠的答案外加噪声。只问那些已经成形为决策、且可预见会卡住某条路径的问题；把它们攒进节拍里一并问，别一个个去戳。
- **不依赖用户的就绪工作照样派** —— 前台问题与后台执行**并行**跑。把一个问题抛给用户，绝不连带卡住那些不需要这个答案的工作（镜头 7：前台对话 ∥ 后台执行）。
- **合法等待**（镜头 4）只在这种时刻才到来：每一条剩余路径要么被一个 `in_flight` 后台任务卡住、要么已抛给用户等答——这时你才安心地等上一个节拍。**但若剩余路径里有一条是 blocked 在某个可能静默失败的 `in_flight` 后台任务上，等待前先 arm 一个 watchdog（见下「等待前 arm watchdog」）**——纯 awaiting-user 的等待不需 watchdog（用户那条线由本节的 HITL / 既有通知路径覆盖）。

前台对话 ∥ 后台执行就是全部要义：问用户一个问题，和让后台继续跑，从来不互斥。

---

## goal-hook —— Stop 时强制自检 + board 闸

cc-master 对抗"过早停止"的确定性守卫是 **goal-hook**（`verify-board` 这个 Stop hook）。当你试图停止时，它读**你的 board**（绝不读你的推理）并对 Stop 设闸：board 但凡还携带可行动的工作——一个 `ready` 任务，或一个 `uncertain` 的"做了但未验"节点——它就拦下把你踢回去。当 board 已是完成状态时，它会先**强制你对照 board 的 `goal` 做一次自检**，再放你走（连续拦太多次时有一根保险丝会松开闸，所以一次误判不会把你永久焊死）。

因为 hook 是个 shell——它看到的是 board，不是对话——所以自检这件事得你自己来：让 board 的 `status` enum 保持诚实（依赖已满足、可派的标 `ready`，被卡住的标 `blocked`，做了但未验的标 `uncertain`），并把你的决策程序 step-6 ledger + 验收证据写进对话和 board 两边。hook 对 board 状态设闸；真正让一次 Stop 可信的，是你写下的那份自检。

### step-6 ledger —— 固定形态（单一来源）

这是 SKILL.md 决策程序所指向的权威定义。goal-hook 读 board 来给你的 Stop 设闸，但**它读不到你的推理**——所以每当这一回合走到决策程序 step 6，就把结论**连同验收证据一起写进对话和 board 两边**，用一个固定形态：

- **每条仍未关闭的路径一行**：`<task-id> · <status> · <blocker | evidence>`
- 然后**一行裁决**，恰好是以下之一：
  - `goal met` —— 每条路径都 `done`、且已在端点验过；
  - `legitimate waiting: every path blocked or surfaced` —— 每条剩余路径要么被一个 in-flight 后台任务卡住、要么在等一个用户回答；
  - `still working` —— 还有可排程的工作（那你根本不该在 step 6——回到决策程序顶端）。

hook 对 board 状态设闸；这份写下的 ledger 才是让"done"*可信*、而不只是被嘴上断言的东西。一句光秃秃的"看起来做完了"、拿不出每条路径的证据，**不算**一次有效的 Stop。

---

## 等待前 arm watchdog —— 静默失败盲区的安全网

> 这是 SKILL.md 决策程序 `wait` 边所指向的权威心智。它**层叠于** harness 自动重唤起**之上**，不替代它（来源：ADR-011）。

### 为什么 harness 的自动重唤起还不够

harness 对它追踪的后台任务**完成**已会自动重唤起主线——正常完成、报错都覆盖，事件驱动、免费、不动它。这是正常路径，绝大多数等待靠它就够。

但自动重唤起是 **completion-triggered**：它只在一个被追踪的任务**触发了完成事件**时才把你带回来。盲区正是那些**永不触发完成事件**的失败：

- **hang 死** —— 任务死锁 / 卡在锁上 / 无限自旋，永不退出，永不发完成事件。
- **静默死** —— 进程被 OOM-kill / 被宿主回收 / 连接断了，没有干净的退出事件抛给 harness（死了却没死亡证明）。
- **幽灵任务（phantom）** —— board 标着 `in_flight`，但底层任务从未真正派出（spawn 失败、被 race 吞了）——压根没有进程可供「完成」（[[Finding #17]] / [[Finding #46]] 的精确病根：board / 自报都「显示在跑」，背后没有活 worker）。

这三种里 harness 都**行为正确**——它没有事件可重唤起。失败模式的定义性质就是**事件的缺席**。没有多少「完成处理」能补上这个洞，因为它落在「完成处理」覆盖范围的**补集**里。**「跑了 N 小时一直靠自动重唤起、从没出过事」不是反证**——那 N 小时的成功样本全部抽自「完成了的任务」这个总体，幸存者偏差：一个静默 hang 的签名就是「什么都没发生」，看起来和「还在跑」一模一样，故它在你的成功日志里**按构造不可见**。

### 触发条件 —— 何时该 arm（按 mechanism，不按 ritual）

走决策程序 `wait` 边之前判一次：**剩余 path 里是否有一条 blocked 在某个可能静默失败的 `in_flight` 后台任务上？**

- **有 → arm 一个 watchdog。** 尤其当某 `in_flight` 是 phantom 嫌疑（dispatched 已久、零输出、不确定是否真启动），或它是一条长 stateful 活（大 refactor / 长导入 / 跑测试套件），又或每条剩余 path 都压在它身上（blast radius = 整个目标可能永久卡死、你 yield 后再不被唤醒）。
- **纯 awaiting-user 的等待 → 不 arm。** 用户那条线由既有 HITL / 通知路径覆盖（用户回复也是事件驱动重唤起），没有「静默失败」盲区给 watchdog 补。在这里 arm 一个 watchdog 是 **ritual / cargo-cult**——它会按 timer fire、却没有任何东西可 reconcile，白烧一拍。**「刚学了 arm watchdog 是好习惯，所以等待前一律 arm 以防忘」是把 pattern 退化成仪式**——pattern 的价值来自匹配一个真实盲区；对着没有盲区的等待 fire 它不让你更安全，只制造噪声（违镜头 4 的「装忙」另一面）。按它的**机制**用，不按习惯用。

### 双层记录 —— board 是实质，prompt 是指针

arm 时记两层（compaction 会吃掉 prompt，但 board 还在）：

- **实质 = board**（持久、扛 compaction）：在 board 写一条 top-level `wakeup` 记录（schema 见 `board.md` §柔性边），含 `armed_at` / `fire_at` / `mechanism` / `job_id` / `checklist`。`checklist` = 被唤醒后要逐个 recon / 确认的事项（如「recon T12 handle vs 地面真相」「验 T7 的 400 文件是否真落盘」）。
- **指针 = wakeup prompt**（轻、易朽）：只说「watchdog fired：重读 board <路径>，跑决策程序 recon——逐个 in_flight 对地面真相、处置静默失败、re-arm 或继续」。prompt 触发、board 供料；compaction 后 prompt 没了也无妨，board 还在。

**为什么记 board 而非只靠 in-context 推理**：watchdog 真正承重的边界是**跨 compaction 失忆**——一个 compaction 后重新 materialize 的 orchestrator，context 里没有「我该 arm 一个 watchdog」这个念头了。把它写进 board（+ 由 verify-board hook 在完成态握手时回提，见 `external-coordinates.md`），才让这个念头扛过失忆边界。在单次决策里推「该不该 arm」一个有能力的模型自己就会推对；真正失守的是「这个念头压根没出现」，board + hook 正是补这一层。

### 被唤醒后 —— recon 对地面真相，再退役 watchdog（两件一起做）

watchdog fire 把你叫回来后：跑决策程序 recon，**逐个 `in_flight` 对地面真相**（① 是否带真实 handle；② `git status` / 工具结果里有无真实产物或 transcript；③ 三者皆空 = phantom，降级回 `ready` 重派——验证法见 `dispatch.md` §派发卫生）。处置完静默失败的、该 re-arm 的 re-arm（仍有可能静默失败的 in_flight 就再 arm 一个），然后继续决策程序。

**退役 watchdog = 两件一起做，缺一不可**：当一个 watchdog 不再需要时（recon 完毕无可监视的 in_flight、或某 `in_flight` 已正常完成被 harness 先叫回），退役它要**同时**：

1. **CronDelete 清掉待发 job**（若机制是 CronCreate 这类会重复 fire 的），免得它在已无事可 reconcile 时反复把你叫醒（白烧拍）；
2. **从 board 移除 / 清空 `wakeup` 对象**——把它从 board 删掉，让 `wakeup` 字段 ABSENT。

**为什么第 2 件同样不可省（陈旧 `wakeup` 是真盲区）**：verify-board hook 对 board 的 `wakeup` 是 **soft-observed**——见到任何 root `wakeup` 对象就当作"已 armed"、**静默不提醒**（present = armed）。所以只 CronDelete 了 job、却把陈旧 `wakeup` 对象留在 board 上，会让 hook（和 compaction 后的你自己）**误判仍有 watchdog armed**——于是下一次出现"有可能静默失败的 in_flight"等待时，hook 静默掉本该发出的"arm a watchdog"提醒，**重新打开本功能要堵的那个静默失败盲区**。

> **不变式：当前无 watchdog armed 时，`board.wakeup` 必须 ABSENT。** 别在 board 上留陈旧残骸——一个已退役 watchdog 的 `wakeup` 对象不是无害遗物，它是一面骗 hook 与未来的你"还在守着"的假旗。正常路径下多半是某个 `in_flight` 先正常完成、harness 先把你叫回来——这时 watchdog 成了一个待发的空响，记得在那次重入里就**两件一起做**（CronDelete job **且** 清掉 `wakeup` 对象）。来源 [[Finding #56]]（陈旧 `wakeup` 重开盲区，codex 第二验收者抓到）。

工具降级链（CronCreate → ScheduleWakeup → Monitor → background-shell `until` 兜底）+ 各自的可用性 / cache-warmth 心智在 `dispatch.md` §派发卫生（watchdog/liveness 维度）。
