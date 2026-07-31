---
point: hitl.watchdog
---

## 权威陈述

<!-- ccm:k:start point:hitl.watchdog -->
> 这是 SKILL.md 决策程序 `wait` 边所指向的权威心智。它**层叠于** harness 自动重唤起**之上**，不替代它。

### 探活双轨 —— 机械兜底 ∥ 心智防迟钝

判一个 `in_flight` 后台任务「还活着长跑」vs「静默死 / hang」用**两条互补的轨**，共享一条节制原则：

- **轨 1 · 机械式 watchdog（背景自动、兜底）**——arm 一个定时唤醒（下文「触发条件」「双层记录」「工具降级链」），按 timer 把你叫回来 recon。它保底——防你 compaction 后**忘了**还有个可能静默失败的 in_flight。
- **轨 2 · 心智式主动探活（防迟钝）**——在 reconcile / 合法等待窗口里**搭车**瞄一眼 in_flight 的地面真相，别等 watchdog ceiling 到点才发现 hang 已浪费时间。它防迟钝——纯靠轨 1，ceiling 才是你最早察觉 hang 的时刻。

**两轨互补**：轨 1 防忘、轨 2 防迟钝；都受下面这条**共享节制**约束——探活成本（token + 挤占工作流）必须低于它防的 hang 损失，否则就是 ritual。

### 轨 2 的节制判据 —— 主动探活是搭车副产品，不是独立轮询循环

核心：**主动探活搭 reconcile 和等待窗口的便车，绝不另起一个轮询 loop**。何时该顺手探、何时该克制：

| 该主动探（零成本搭车 / 高风险） | 该克制（探了也白探 / 该让位） |
|---|---|
| reconcile 时顺带 `git status` / mtime 瞄一眼 in_flight（已经在 recon，零额外成本） | 刚派发不久、还没到合理完成时间——探了也白探（没产出≠死） |
| 合法等待窗口里（本来就 idle，不挤占工作流） | 有别的 `ready` / fill-work 就绪——让位，工作流优先（「主观能动」镜头） |
| 高风险任务：联网 / 远程、已近 ceiling、超长 stateful 跑 | 纯本地 + harness 完成事件可靠——靠轨 1 机械兜底就够，别手搓轮询 |

**「刚学了主动探活是好习惯、所以每拍都主动 tail 一遍」是把 pattern 退化成仪式**——前台空转主动盯单个 agent 正是 `dispatch.md` / 本文 §In-flight 追踪 禁的 busy-poll。按它的**机制**用（匹配真盲区 / 高风险），不按习惯用。

### 为什么 harness 的自动重唤起还不够

harness 对它追踪的后台任务**完成**已会自动重唤起主线——正常完成、报错都覆盖，事件驱动、免费、不动它。这是正常路径，绝大多数等待靠它就够。

但自动重唤起是 **completion-triggered**：它只在一个被追踪的任务**触发了完成事件**时才把你带回来。盲区正是那些**永不触发完成事件**的失败：

- **hang 死** —— 任务死锁 / 卡在锁上 / 无限自旋，永不退出，永不发完成事件。
- **静默死** —— 进程被 OOM-kill / 被宿主回收 / 连接断了，没有干净的退出事件抛给 harness（死了却没死亡证明）。
- **幽灵任务（phantom）** —— board 标着 `in_flight`，但底层任务从未真正派出（spawn 失败、被 race 吞了）——压根没有进程可供「完成」（board / 自报都「显示在跑」，背后没有活 worker）。

这三种里 harness 都**行为正确**——它没有事件可重唤起。失败模式的定义性质就是**事件的缺席**。没有多少「完成处理」能补上这个洞，因为它落在「完成处理」覆盖范围的**补集**里。**「跑了 N 小时一直靠自动重唤起、从没出过事」不是反证**——那 N 小时的成功样本全部抽自「完成了的任务」这个总体，幸存者偏差：一个静默 hang 的签名就是「什么都没发生」，看起来和「还在跑」一模一样，故它在你的成功日志里**按构造不可见**。

### 触发条件 —— 何时该 arm（按 mechanism，不按 ritual）

走决策程序 `wait` 边之前判一次：**剩余 path 里是否有一条 blocked 在某个可能静默失败的 `in_flight` 后台任务上？**

- **有 → arm 一个 watchdog。** 尤其当某 `in_flight` 是 phantom 嫌疑（dispatched 已久、零输出、不确定是否真启动），或它是一条长 stateful 活（大 refactor / 长导入 / 跑测试套件），又或每条剩余 path 都压在它身上（blast radius = 整个目标可能永久卡死、你 yield 后再不被唤醒）。
- **external issue / run 长时间无进展 → arm 一个 recon watchdog。** 外部 issue 没有当前 session 的完成事件；它 open / in-progress / closed 都不会自动证明 board 完成。watchdog 到点回来查 tracking anchor、是否有 PR / commit / report artifact、是否需要 follow-up 或把 task 转 `uncertain` / `stale` / `blocked`。
- **纯 awaiting-user 的等待 → 不 arm。** 用户那条线由既有 HITL / 通知路径覆盖（用户回复也是事件驱动重唤起），没有「静默失败」盲区给 watchdog 补。在这里 arm 一个 watchdog 是 **ritual / cargo-cult**——它会按 timer fire、却没有任何东西可 reconcile，白烧一拍。**「刚学了 arm watchdog 是好习惯，所以等待前一律 arm 以防忘」是把 pattern 退化成仪式**——pattern 的价值来自匹配一个真实盲区；对着没有盲区的等待 fire 它不让你更安全，只制造噪声（违「主观能动」镜头的「装忙」另一面）。按它的**机制**用，不按习惯用。

### 双层记录 —— board 是实质，prompt 是指针

arm 时记两层（compaction 会吃掉 prompt，但 board 还在）。顺序不能反：**先创建真实
scheduler / loop / monitor / shell 并拿到可追踪、可退役的 handle，再 arm board 记录**；没有 handle 就保持
blocked / recon 状态，不得声称 armed。

- **实质 = board**（持久、扛 compaction）：用 `ccm watchdog arm --fire-at <ISO-UTC> --mechanism <cron|loop|monitor|shell> --job-id <handle> --checklist <事项>` 写 canonical top-level `watchdog` 记录。`job_id` 对所有 mechanism 都是必填 nonblank handle；`checklist` = 被唤醒后要逐个 recon / 确认的事项（如「recon T12 handle vs 地面真相」「验 T7 的 400 文件是否真落盘」）。旧板的同形 `wakeup` 只作兼容读取，不再作为新写入口。
- **指针 = wakeup prompt**（轻、易朽）：只说「watchdog fired：重读 board <路径>，跑决策程序 recon——逐个 in_flight 对地面真相、处置静默失败、re-arm 或继续」。prompt 触发、board 供料；compaction 后 prompt 没了也无妨，board 还在。

**为什么记 board 而非只靠 in-context 推理**：watchdog 真正承重的边界是**跨 compaction 失忆**——一个 compaction 后重新 materialize 的 orchestrator，context 里没有「我该 arm 一个 watchdog」这个念头了。把它写进 board（board 扛得过 compaction，且停止时的 board 闸会回提你「有 in_flight 却没 arm watchdog」），才让这个念头扛过失忆边界。在单次决策里推「该不该 arm」一个有能力的模型自己就会推对；真正失守的是「这个念头压根没出现」，board + hook 正是补这一层。

### ceiling = recon 触发器，不是死亡判据（写法纪律）

watchdog 的 ceiling（间隔 / fire_at）是一个**「回来看一眼」的触发器，绝不是「它死了」的判据**——三条连带纪律：

- **fire_at 过期 + 任务仍 in_flight ≠ 死。** 它只是叫你回来 **recon 地面真相**。recon 后若健康（`git status` 在动 / 输出文件 mtime 还在变 / 它正合法阻塞在一条长静默命令上如 `run-tests` / 大编译 / 网络等待），就**延长重 arm（fresh fire_at）、不误杀**——唯有 recon 见**卡死无变化、且已远超一个慷慨 ceiling** 才判 hang。verify-board hook 把「fire_at 过期 + in_flight」当提醒触发器（self-heal），那是叫你回来 recon，不是叫你 kill。
- **勿用 output-size 停滞当存活信号。** sub-agent 合法阻塞在长静默命令时输出本就该静——停滞检测把「正常的长静默」误当「死亡」，阈值调长漏报真 hang、调短狂误报，治标不治本（活体案例：一个任务跑全套 gate 期间零输出、被停滞检测误报卡死、watchdog 提前 fire）。harness 完成事件已是精确快路径；watchdog 只需一个**足够宽的纯时间 ceiling** 兜真 hang。
- **B 分诊 ceiling（按任务类别定长短）**——纯本地 sub-agent 用**长 ceiling**（≈15–20min，覆盖 TDD / 大 refactor 这类长跑、避免误杀）；联网 / 远程任务（codex 等）用**短 ceiling**（≈5–7min，hang 风险高、早发现）。ceiling ≈ 该类任务 p95 + 余量，不是一刀切。

### 被唤醒后 —— recon 对地面真相，再退役 watchdog（两件一起做）

watchdog fire 把你叫回来后：跑决策程序 recon，先用 `ccm agent list` 重建 runtime roster，再对关联条目执行 `ccm agent show` / `ccm agent probe`，逐个核对 `in_flight` 的真实 handle、task link 与活性证据。`ccm agent show` 返回已存的 attach command 时，只执行那条自包含命令；没有独立的 attach verb 可凭记忆编造。再把 registry 证据与 `git status` / transcript / 工具结果 / 输出文件 mtime 对照：证据皆空 = phantom，降回 `ready` 重派；有活动但仍在飞 = 健康长跑，延长重 arm、**不杀**。agent terminal ≠ task done，父 task 仍须独立验收。处置完静默失败的、该 re-arm 的 re-arm（仍有可能静默失败的 in_flight 就再 arm 一个），然后继续决策程序。

**退役 watchdog = 两件一起做，缺一不可**：当一个 watchdog 不再需要时（recon 完毕无可监视的 in_flight、或某 `in_flight` 已正常完成被 harness 先叫回），退役它要**同时**：

1. {{WATCHDOG_RETIRE_SCHEDULER_GUIDANCE}}
2. **运行 `ccm watchdog disarm`**——删除 canonical `watchdog` 与 legacy `wakeup` 两个整字段，让它们都
   ABSENT；不留 `null` / 空对象。

**为什么第 2 件同样不可省（陈旧记录会制造状态分叉）**：verify-board 与 `ccm watchdog status` 都会读取
canonical `watchdog` / legacy `wakeup`。只有带 nonblank `job_id` 且 `fire_at` 未过期的记录才算 armed；
缺 handle / 空白 handle / 已过期会明确视为 unarmed 并提醒。即使如此，只删外部 job、不删仍写着有效 handle
与 future `fire_at` 的 board 记录，读侧仍无法知道外部机制已消失；只删 board、不停外部 job，又会留下空响。
两边必须一起退役。

> **不变式：当前无 watchdog armed 时，`board.watchdog` 与 `board.wakeup` 必须都 ABSENT。** 正常路径下
> 多半是某个 `in_flight` 先正常完成、harness 先把你叫回来——这时 watchdog 成了一个待发的空响，记得在
> 那次重入里就两件一起做（按 `job_id` 取消真实 job，且 `ccm watchdog disarm`）。若 `status --json` 报
> `missing-accountable-handle` / `expired`，按它的 `action` 先 disarm；仍需守护时创建真实 wakeup、拿 handle 后重 arm。

{{WATCHDOG_WAKEUP_TOOL_CHAIN_INLINE}}在 `dispatch.md` §派发卫生（watchdog/liveness 维度）。
<!-- ccm:k:end point:hitl.watchdog -->

## 失效类型

`prosthetic`（双重性质·方法部分补不回来，它才是承重结构） —— 删掉后，agent 在压力下会把探活/退役当可选仪式选择性执行——比如只清 board 记录不取消真实定时器（或反之），或觉得“纯本地稳定跑没必要 arm”而放过真实盲区任务不设防。

watchdog 这个装置的存在理由就是把「还有个可能静默失败的 in_flight」这个念头写进 board 以扛过 compaction 失忆，文中自陈单次决策模型自己会推对。

## 失败形态

退役只做一半：清了 board.watchdog 但没取消真实 job（留下一个未来会 fire 进陈旧上下文的空响），或取消了 job 但 board 仍写着有效 job_id 与未来 fire_at——两种都表面“看起来处理过了”，只有下次 reconcile 才会发现状态对不上。
