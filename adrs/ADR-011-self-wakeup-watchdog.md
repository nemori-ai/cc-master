# ADR-011 — 前台空转期 watchdog 自我唤醒（ScheduleWakeup/cron 解禁，安全网层叠于 harness 自动重唤起之上）

> Status: **Accepted**（部分收窄 ADR-002 的 ScheduleWakeup/cron 排除；补充 ADR-004 的 background-shell 消解，非取代）
> Date: 2026-06-16
> Scope: 编排方法论（`skills/master-orchestrator-guide/SKILL.md` 决策程序 `wait` 边 + 镜头4/6 + `references/async-hitl.md`·`dispatch.md`·`board.md`·`external-coordinates.md`）+ `verify-board`（完成态握手 watchdog 提醒 clause）+ board 柔性边 canonical `watchdog` / legacy `wakeup` + 红线 5（AGENTS.md §3）+ `design_docs/spec.md` §12
> Source: dogfood Finding #17 / Finding #46（幽灵任务——派发未真正发出 / 静默失败，无完成事件，orchestrator 永远等不到唤醒）+ 实现契约 `design_docs/plans/idle-self-wakeup-impl-contract.md`

---

## 1. Context

cc-master 是事件驱动的：派出后台工作（background shell / sub-agent / workflow）后让主线在等待窗口里主动推进，harness 在它追踪的后台任务**完成**时（正常完成 / 报错都覆盖）自动重唤起主线重入。这条主路径免费、可靠、不需任何定时器——是 ADR-002 / ADR-004 把 `/loop`·`ScheduleWakeup`·cron 整体排除、统一消解进 background-shell 的前提。

但这条路径有一个结构盲区：**静默失败**。后台任务可能 hang 死、静默死、或压根没被派出（幽灵任务 Finding #17 / Finding #46）。这些情形**不产生完成事件**——harness 没有可重入的信号，orchestrator 于是永远等不到唤醒，停在一个它以为"还在等后台"、实则后台早已无声死去的等待里。ADR-004 的 background-shell `until <ready>; do sleep N; done` 兜底**只对"等一个会到来的外部就绪信号"成立**；对"任务静默失败、就绪信号永不到来"这一侧，单靠 harness 完成重入无法自愈。

ADR-002 当时把 ScheduleWakeup/cron 整体排除，理由是 ship-anywhere（ScheduleWakeup 在 Bedrock/Vertex/Foundry 不支持、cron 会话 7 天过期）+ 事件驱动本就不需轮询。这个理由对**正常完成路径**完全成立，但对**静默失败盲区**留了缺口——盲区恰恰需要一个"间隔回来对账地面真相"的定时唤醒，而这正是 timer primitives 的天职。本 ADR 在不破 ship-anywhere 的前提下，为这个盲区补一张 watchdog 安全网。

## 2. Decision

**为前台空转期的静默失败盲区补一张 watchdog 安全网——合法等待前，若剩余 path 中存在 blocked 在 in_flight 后台任务上的（不只是 awaiting user），arm 一个定时唤醒，间隔回来 recon 对账地面真相。watchdog 层叠于 harness 自动重唤起之上（补盲区，非替换主路径）。**

### 2.1 唤醒机制 = 安全网，层叠于 harness 自动重唤起之上

- **harness 自动重唤起**仍是正常完成的**主路径**——免费、事件驱动、不动。它处理一切产生完成事件的终态。
- **watchdog 定时唤醒只补静默失败盲区**——只在"可能静默失败的 in_flight 后台任务"存在时 arm，间隔回来对账。它不取代 harness，也不在正常完成路径上增加任何开销。

### 2.2 watchdog 工具降级链（情境三件套 + universal floor）

按优先级，缺则降级：

1. **CronCreate `recurring:false`（首选 / 通用 watchdog）** —— 本地 session 内存调度器，`durable:false`，**不需 claude.ai OAuth**，**只在 REPL idle 时 fire**（正好在 orchestrator 空转时叫回、不打断正在干的活）。间隔 ≈ 最长 in_flight 任务的 p95 + 余量（cache 心智：<270s 保温 / ≥1200s 长等，贴 ScheduleWakeup 的 cache-warmth 心智）。先拿真实 job id 再 arm；退役时**两件一起做**：按 id **CronDelete 清掉待发 job**，且运行 `ccm watchdog disarm` 删除 canonical / legacy board 记录。
2. **ScheduleWakeup** —— `/loop` dynamic 时原生的自定步长 + cache-warmth 信号；可作 CronCreate 的同档替代。
3. **Monitor** —— 某后台任务有可观测 liveness 信号（log 文件 / 进程）时用：`tail -f | grep -E --line-buffered '<进度>|<失败签名>'`，事件驱动、精准。**"silence ≠ success"**：filter 必须覆盖失败终态，不能只 grep happy path。
4. **background-shell `until <ready>; do sleep N; done` 丢进 `run_in_background`（universal ship-anywhere floor）** —— ADR-004 的既有消解，**永远兜底**：上面三者在某宿主不可用时，这条恒可用（harness 完成重入）。

> **ship-anywhere 诚实性**：即便用户已开放 ScheduleWakeup/cron，不同宿主（Bedrock/Vertex/Foundry）可用性仍有别。故教法是**降级链 + 显式可用性提示**，background-shell 永为 floor。不假设新工具到处都在——这是 ADR-002 ship-anywhere 精神在解禁后的延续，而非废弃。

### 2.3 "被唤醒后看什么"的记录 = 双层

- **实质 = board**（持久、扛 compaction）：先创建真实唤醒并拿 handle，再用 `ccm watchdog arm ... --job-id <handle>` 写 canonical `watchdog` 柔性边记录（legacy `wakeup` 只读兼容）。
- **指针 = wakeup prompt**（轻、易朽）：只说"watchdog fired：重读 board <路径>，跑决策程序 recon——逐个 in_flight 对地面真相、处置静默失败、re-arm 或继续"。prompt 触发、board 供料；compaction 后 prompt 没了也无妨，board 还在。

### 2.4 board `watchdog` 柔性边（legacy `wakeup` 兼容；soft-observed，不动硬 narrow-waist）

canonical top-level 可选对象 `watchdog`（旧板同形 `wakeup` 继续兼容读取）：

```json
"watchdog": {
  "armed_at": "<iso>",
  "fire_at": "<iso>",
  "mechanism": "cron" | "loop" | "monitor" | "shell",
  "job_id": "<CronCreate 返回的 job id / handle>",
  "checklist": ["recon T1 handle vs 地面真相", "验 T3 产物是否落盘", "..."]
}
```

- 语义：**对象存在不等于 armed**；只有 `job_id` 为 nonblank 真实句柄且 `fire_at` 未过期才健康。`checklist` = 被唤醒后要 recon / 确认的事项清单。
- 这是**柔性边**（agent-shaped）+ 被 hook 以 soft-observed 方式读。**绝不进硬 waist**——`schema`/`goal`/`owner`/`git`/`tasks[{id,status,deps}]`+status enum 才是硬 waist（ADR-003 一字不动，红线 2 不破）。

### 2.5 触发条件 + hook 软提醒

- **何时 arm**：走决策程序 `wait` 边之前，**若剩余 path 中存在 blocked 在 in_flight 后台任务上的（不只是 awaiting user）** → arm 一个 watchdog。纯 awaiting-user 的等待不需 watchdog（用户那条线由既有 HITL / PushNotification 覆盖）。
- **hook 软提醒**：`verify-board` 完成态握手 soft-observed 读 canonical `watchdog` / legacy `wakeup`：有 in_flight 且无健康记录（缺/非对象、`job_id` 缺失或空白、`fire_at` 已过期）→ 注入"为可能静默失败的 in_flight 任务 arm a watchdog wakeup"提醒。canonical 短语锚点 **"arm a watchdog wakeup" / "watchdog 自我唤醒"**。hook 只 bash + node/JS（红线 1·ADR-006 不破，不引 jq/python）；武装闸不变（红线 6·ADR-007：未武装一律静默）。

## 3. Consequences

### 3.1 Positive

- **静默失败盲区第一次有自愈机制**：幽灵任务（Finding #17/#46）、hang 死、静默死不再让 orchestrator 无限期空等——间隔回来对账地面真相，处置后 re-arm 或继续。
- **不动正常完成主路径**：harness 自动重唤起仍是免费的事件驱动主路径；watchdog 只在盲区存在时叠加，正常完成路径零开销。
- **ship-anywhere 仍是硬保证**：降级链以 background-shell 为 universal floor，CronCreate `durable:false` 是本地 session 内存调度（不需 claude.ai），故即便 ScheduleWakeup/cron 在某宿主缺席，floor 恒可用。
- **board 扛 compaction**：唤醒后看什么落 board 柔性边（持久），prompt 只作易朽指针——compaction 吃掉 prompt 也不丢 recon 清单。

### 3.2 Negative

- **新增一个易朽外部资源要管 + 一条 board 卫生不变式**：退役一个 watchdog 是**两件一起做**——① 按 `job_id` 清掉真实外部 job（否则重复 fire），② `ccm watchdog disarm` 删除 canonical `watchdog` 与 legacy `wakeup` 整字段。第 2 件同样不可省：只删外部 job、却把 nonblank handle + future `fire_at` 留在 board，读侧仍无法知道机制已消失；只删 board 则外部 job 仍会空响。**不变式：当前无 watchdog armed 时，两字段都必须 ABSENT**。存量缺/空 handle 只产生 `FMT-WATCHDOG` warn 与 status/hook unarmed 诊断，不让其它写入死锁。
- **降级链 + 可用性提示增加教法面**：比 ADR-002"三机制干净排除"的简洁面更复杂——多了一条降级链要教、要让 agent 判断当前宿主哪一档可用。以 background-shell 永为 floor 兜底来控制这个复杂度。
- **watchdog 间隔是估计、非精确**：间隔取 p95 + 余量是启发式；间隔过短 → 空转 recon 噪声，过长 → 静默失败发现慢。无法精确闭环（任务时长不可预测）。

### 3.3 Neutral

- ADR-002 / ADR-004 的 background-shell 消解**不废**——它从"唯一兜底"变为"降级链的 floor"，语义增强而非取代。
- `watchdog` 是柔性边，legacy `wakeup` 是兼容读入口：两者缺失都合法；board 有 in_flight 任务时，无健康记录恰会触发提醒。soft-observed 指「有则校验使用、坏值不把 board 变成 hard-invalid」，不指「对象存在就 armed」。

## 4. Alternatives Considered

### 4.1 Alternative A: 为何安全网而非替换 harness 自动重唤起

**否决"用 watchdog 定时轮询替换 harness 完成重入"。** harness 自动重唤起对一切产生完成事件的终态（正常完成 / 报错）免费且可靠——把它换成定时轮询是用更贵、更不精准的机制取代一个已经好用的事件驱动主路径，纯倒退。盲区只在"无完成事件的静默失败"这一侧，故正确形态是**层叠的安全网**——只补盲区、不碰主路径。把 watchdog 定位成"替换"会让正常完成路径平白背上轮询开销，且与 cc-master 事件驱动的根本气质相悖。

### 4.2 Alternative B: 为何降级链而非单一 primitive

**否决"只教 CronCreate 一个 primitive"（或只教 background-shell 一个）。** 单一 primitive 两头不讨好：

- **只教 CronCreate / ScheduleWakeup**：破 ship-anywhere——ScheduleWakeup 在 Bedrock/Vertex/Foundry 不支持，cron 会话有过期约束；某宿主缺席时 agent 够不到唯一的 watchdog，盲区又无人补。这正是 ADR-002 当初整体排除它们的理由，不能简单推翻。
- **只教 background-shell**：它是 floor、永远可用，但对"REPL idle 时精准叫回、不打断干活"这类情境不如 CronCreate `recurring:false` 贴合（background-shell 的 sleep 轮询不感知 REPL idle 状态）；也无法利用某后台任务的可观测 liveness 信号（那是 Monitor 的强项）。

故教法是**情境三件套（CronCreate / ScheduleWakeup / Monitor）按优先级降级 + background-shell 为 universal floor**：能用更贴情境的就用，缺则逐级降级，最差也有 floor 恒可用。这把"ship-anywhere 硬保证"和"贴情境的高效唤醒"两者都拿到，而非二选一。

### 4.3 Alternative C: 为何 CronCreate 本地调度 ≠ 被排除的 claude.ai routines / RemoteTrigger

**关键区分，否决"CronCreate 解禁 = 把被 ADR-002 排除的 scheduled routines 也放进来"。** 二者机制根本不同：

- **CronCreate `durable:false` / `recurring:false`** = **本地 session 内存调度器**——job 活在当前 session 进程内，不需 claude.ai 账户 / OAuth，不依赖云持久层。它在任何能跑 Claude Code REPL 的宿主上本地可用（可用性差异仅在个别 managed runtime，故仍配降级链 + floor）。这与 background-shell 同属"本地、ship-anywhere 友好"的一档，故可解禁。
- **scheduled routines / `/schedule` 云 routines / RemoteTrigger** = **云持久 / 需 claude.ai OAuth**——离线持久、跨 session 存活靠 claude.ai 后端，Bedrock/Vertex/Foundry 上根本没有。**仍排除、仍不教**（破 ship-anywhere，ADR-002 这部分排除不收窄）。

所以本 ADR 收窄的**只是** ScheduleWakeup + CronCreate（本地 timer primitives），**agent-teams 仍排除**（实验开关 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`，不可靠），**RemoteTrigger / claude.ai 云 routines 仍不教**（需 OAuth、破 ship-anywhere）。把"本地内存调度"和"云持久 routines"混为一谈，是误读本决策的最大风险点——故在此显式钉死边界。

## 5. Related

- [`ADR-002-ship-anywhere-scope.md`](ADR-002-ship-anywhere-scope.md) —— 本 ADR **部分收窄**其 ScheduleWakeup/cron 排除（"Superseded in part by ADR-011"）；agent-teams / 云 routines 排除不收窄。
- [`ADR-004-loop-dissolution-and-goal-hook.md`](ADR-004-loop-dissolution-and-goal-hook.md) —— background-shell 消解仍是 floor，本 ADR 在其上补 timer primitives（补充非取代）。
- [`ADR-003-board-narrow-waist.md`](ADR-003-board-narrow-waist.md) —— canonical `watchdog` / legacy `wakeup` 是柔性边，硬 waist 一字不动（红线 2）。
- [`ADR-006-hooks-may-use-node-js.md`](ADR-006-hooks-may-use-node-js.md) —— `verify-board.sh` watchdog 提醒走 bash（+node 若必要），不引 jq/python（红线 1）。
- [`ADR-007-hook-arming-gate.md`](ADR-007-hook-arming-gate.md) —— hook 武装闸不变，watchdog 提醒只在武装态注入（红线 6）。
- [`../design_docs/dogfood-findings.md`](../design_docs/dogfood-findings.md) —— Finding #17 / Finding #46（幽灵任务——本决策的触发源）。
- [`../design_docs/spec.md`](../design_docs/spec.md) §12 —— 有意排除决策留痕（ScheduleWakeup/cron 从"排除"改写为"许可用于 watchdog"）。

## 6. References

- 实现契约 `design_docs/plans/idle-self-wakeup-impl-contract.md`（本 ADR 锁定的 §1 设计 + §2 共享常量来源；临时计划、gitignored）。
- 配额滚动窗口口径（5h / 7d，影响 watchdog 间隔的 cache-warmth 心智）：https://code.claude.com/docs/en/costs.md
