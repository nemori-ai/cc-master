# External coordinates（外部坐标系）—— 愿景索引 + hook 共享词汇

> **服务愿景：全部 C1–C6**（这是把魂接到外部坐标的导航表，不专属某一项能力）。**何时读：** ① 想沿愿景轴定位「哪条镜头 / 哪个 reference / 哪个决策程序节点服务哪项能力」时；② compaction 后 / 任意时刻看到一个 hook 从你 context 之外注入的短语，想顺着它回到对应的镜头或决策程序锚点时。

这张表是**导航用的坐标系**，不是每回合要跑的决策输入——它把魂连到两类真相源：六项 charter 能力（C1–C6，即下方愿景索引表）和五个 hook（注入短语的 SSOT 在本 plugin 的 hook 脚本里）。**魂主文只留一句指针指向这里，详表不在魂里重复**——因为「常驻重注的魂里复述一张 hook / 愿景状态映射表」容易 desync：魂一旦滞后就会把一个已 live 的 hook 误标成 TODO，且魂内 SSOT 重复本身就是 reinject 负担。要核 hook 注入短语的当前真相，永远以本 plugin 的 hook 脚本为准；要核某 reference 服务哪项愿景，以各 reference header 的 `服务愿景：Cx` tag 为准——这张表只是把它们汇到一处方便定位。

---

## Vision index（愿景索引）—— 按愿景定位镜头、reference、决策程序节点

从一项能力出发，顺藤摸到激励它的镜头、讲透 HOW 的 reference、强制它的决策程序节点、以及从外部为它命名的 hook 短语。每个 reference 的 header 里也各带一个愿景 tag，于是共鸣双向可发现。（每个 reference 的 *read-when* 触发条件，就写在各 reference 的 header 里。）

| 愿景 | 镜头 | Reference(s) | 决策程序节点 | Hook 共鸣（注入短语 → 锚点） |
|---|---|---|---|---|
| **C1** 异步并行 + 完整落地 | 1 / 3 / 4 / 6 | `dispatch` · `resume-verify` · `board` · `async-hitl` | recon → dispatch → verify → wait（整个 loop） | SessionStart "integrate any completed background results first / Do not restart work already done/verified" → recon/integrate + 镜头 6; Stop "is every to-do actually done — including any NOT yet listed on the board" → 镜头 1 + step-6 ledger; Stop (watchdog) "arm a watchdog wakeup / watchdog 自我唤醒" → wait 边 + 镜头 4（等待前给可能静默失败的 in_flight arm watchdog，见 `async-hitl.md` §等待前 arm watchdog） |
| **C2** 控制 token 消耗速度 | 5 | `pacing-and-estimation` skill（消费层）· `cost-decisions`（换号决策锚） | dispatch 的 "reserve budget+WIP first" 备注 | Stop (H8 usage-pacing·ADR-024 单侧 verdict) "[cc-master pacing] 账户配额临界 ... pace 杠杆（见 orchestrating-to-completion / pacing-and-estimation）" (`throttle`) → 镜头 5（减速侧·ADR-024 退役了加速侧）; "切到下一份配额" (`switch`) → 镜头 5 + pacing-and-estimation 的 effective-N 缩放（多账号·effective-N 由 hook 从 `accounts.json` 号池算，非起跑 flag·hook policy=allow 下机械换号）; "5h 配额触硬停 ... arm 一个 watchdog ... 守到 nearest_reset 回血" (`stop_5h`) → 镜头 5（本窗烧穿）+ wait 边; "7d 配额硬总闸 ... 暂停 dispatch 新节点" (`stop_7d`) → 镜头 5（7d 总闸收紧）+ 决策程序 dispatch §(f) + 镜头 7（surface 用户） |
| **C3** 自主决策 vs 人类接入边界 | 7 | `async-hitl` | q_user → surface | Stop "every point that needs the user surfaced / marked `blocked_on:"user"`"; Stop (H3) "Unanswered user decisions still on this board" → 镜头 7 |
| **C4** 分解 / 管理 / 更新 / 规划 | 2 | `decomposition`（§3 `ccm board graph` 机器算）· `board` · `resume-verify` §4 | recon（integrate / mark stale） | bootstrap & Stop "Decompose the goal into a dependency DAG" → 镜头 2 + decomposition; Stop "self-check against this board's `goal`" → board/goal 重认领 |
| **C5** 资源预算内的高效调度 | 2 / 3 / 5 | `dispatch` · `decomposition`（§3 `ccm board graph`）| dispatch（WIP cap）· fill（准入测试） | PostToolBatch (H5) "WIP is over the cap ... defer high-float ... (lens 5)" → 镜头 5 + fill 准入; Stop "A `ready` task can proceed now" → q_ready; 保险丝 "`ready` task that cannot actually proceed (mark it `blocked`/`escalated`)" → 保险丝红线 |
| **C6** 按难度选模型档位 | 2（一行） | `pacing-and-estimation` skill（model-tiers） | *(无节点——by design)* | *(无现存 hook；模型选择是判断，不可由 hook 强制)* |

这张地图把话挑明：C2/C6 的「薄 hook + 无节点 / 旁注节点」姿态是 **by design**，不是疏漏（模型分档与 pacing *派生自*镜头 2/5——为它们加一条红线会违背 Iron Law；见 `pacing-and-estimation` skill）。C2 的 hook 列现由 H8（usage-pacing，Stop 上的第二个 hook，5h burn-rate 感知）兑现——感知是 hook 的活、怎么 pace 仍是认知（属 SKILL A 的认知判断）。

---

## When a hook speaks to you（当 hook 对你说话）—— hook ↔ skill 共享词汇

有几个 hook 会从你的 context 之外注入提示，它们**刻意沿用本 skill 的词汇**——看到下面任一短语，就是你的某个镜头 / 决策程序节点被从外部点名了，顺着它回到对应锚点：

- **SessionStart** "invoke the orchestrating-to-completion skill and continue the decision program"、"recognise it by its goal"、"integrate any completed background results first" → 你刚 compact 过：回到魂的 *Board protocol essentials*，重新认领你的 board，从 **recon** 重启决策程序——排程之前先整合（镜头 1 / 6）。
- **UserPromptSubmit** "Decompose the goal into a dependency DAG ... run the decision program" → 一场新 orchestration 的起点：**镜头 2** + `decomposition.md`——派发之前先画 DAG。
- **PostToolBatch** (H5) "WIP is over the cap ... Don't add more parallel work next round — consider deferring high-float tasks to keep ~75% utilization (lens 5)" → **镜头 5**：别再加并行工作，推迟 high-float 任务。它是软警告，不是 block。
- **Stop** —— 决策程序从外部为你兜底；它的每条注入各指向一个锚点：
  - "this board still has a `ready` or `uncertain` task ... Resolve it" → **q_ready / q_unver** 还有活：别停，回去跑（镜头 3 / 6）。
  - "every point that needs the user surfaced / marked `blocked_on:"user"`" → **镜头 7**，该问就问。完成态握手现在还会**显式列出**任何挂起的用户停泊决策——"Unanswered user decisions still on this board: \<titles\>" (H3) → **镜头 7**：停下之前，逐项确认它们确实仍挂起（或就地解决）。
  - "self-check against this board's `goal` ... every to-do actually done — including any NOT yet listed on the board" → **step-6 ledger** + **镜头 1**，完整落地。
  - 保险丝 "a `ready` task that cannot actually proceed (mark it `blocked`/`escalated`)" → 你撞上了「每个 loop 都必须有保险丝」那条红线：揪出假 `ready`。
  - (watchdog 完成态握手) "arm a watchdog wakeup ... wakeup 字段缺失" / "watchdog 自我唤醒" → **wait 边 + 镜头 4**：这块板有 `in_flight` 后台任务、却没 arm watchdog（board 无 `wakeup`）——停下前为可能静默失败的 in_flight arm a watchdog wakeup（CronCreate / ScheduleWakeup / Monitor / background-shell until 兜底），把「被唤醒后 recon 什么」写进 board 的 `wakeup.checklist`，否则后台任务静默失败时没人回来看（ADR-011；soft-observed，已 arm 则不提醒）。怎么 arm 是你的认知判断，它是软提示、不是 block。
  - (H8 usage-pacing，Stop 上的第二个 hook·verdict `throttle`) "[cc-master pacing] 账户配额临界 ... pace 杠杆（见 orchestrating-to-completion / pacing-and-estimation）" → **镜头 5（减速侧）**：你贴近 5h burn-rate 墙了——怎么 pace 是你的认知判断（downgrade 模型 / 降 WIP / defer float），它是软提示，不是 block。**ADR-024 退役了旧的「欠用→加速」侧**——pacing 现只在逼近上界时出声，不再有 "可加速" / "额度白白蒸发" 的加速提示。
  - (H8 usage-pacing，verdict `stop_5h`) "5h 配额触硬停 ... arm 一个 watchdog 自我唤醒 ... 守到 <nearest_reset> 后配额回血" → **镜头 5（本窗烧穿）+ wait 边**：当前 5h 配额本窗口烧穿、无可切备号 / 7d 亦吃紧——不是终点，是 arm 一个 watchdog 守到 reset 回血再续派的信号（软提示·不是 block）。
  - (H8 usage-pacing，多账号 effective-N·verdict `switch`) "你声明了 N 份可序列消费的配额 ... 切到下一份配额" → **镜头 5（撞墙侧按 N 分叉·换号）**：effective-N 由 `usage-pacing.js` 从号池 registry `accounts.json` 算（数非 active 且 token 未过期的可切入备号 + 当前在用号；无 registry = 天然单账号 N=1）——**不是起跑 flag**（旧 `--num_account N` 起跑声明已砍·TR6，号池经 `ccm account` CLI 管理）。N>1 且 7d 仍有余量时，当前账号 5h 烧满是「切到下一份配额」的触发信号、不是减速信号；**7d 总闸不随 N 变**（与序列/并行度正交）。`usage-pacing` hook 在 policy=allow 下**机械换号**（见 "[号池·已自动换号]" ambient）——你只调配速；policy=deny / 全池逼顶时 surface 用户拍。细节与诚实天花板见 `pacing-and-estimation` skill（pacing-levers / usage-signals）。切不切仍是认知判断，软提示不是 block。
  - (H8 usage-pacing，7d≥85% dispatch 闸) "7d 配额硬总闸 ... 暂停 dispatch 新节点 ... blocked_on:\"user\"" → **镜头 5（7d 总闸收紧）+ 决策程序 dispatch 节点 §(f) + 镜头 7**：7d `used%` 达 85%——总闸从「挡加速」收紧到「挡派发本身」：**停 dispatch 任何新节点**（含临界路径节点），把「是否继续消耗 7d 配额」作 `blocked_on:"user"` surface 用户拍板（在飞任务可跑完 / 验收，但不派新活）。注入里的「非阻断」只意味着 hook 物理上 block 不了你的 dispatch 工具调用，执行暂停是你的活——别读成「可忽略的 FYI」。N>1 时「切到下一份配额（切账号刷新 7d）」是用户可选的一个响应，与「暂停续耗」并列由用户拍，切换本身不由本闸执行。细节见 `pacing-and-estimation` skill（pacing-levers）+ 决策锚 `cost-decisions.md` + ADR-010 §2.6。

*（H3/H5/H8 现均已 live。注入短语的当前真相以本 plugin 的 hook 脚本为准——本表与脚本漂移时信脚本，删/加 hook 的 PR 必带 `grep 'H[0-9]'` 全量核对。）*
