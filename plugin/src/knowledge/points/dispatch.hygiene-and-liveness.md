---
point: dispatch.hygiene-and-liveness
---

## 权威陈述

<!-- ccm:k:start point:dispatch.hygiene-and-liveness -->
- **注册先于 task 起跑，handle 是 `in_flight` 的唯一入场券。** `agent create` 只是建立 `starting` runtime 记录，可以先于 spawn；它不证明 worker 已经运行。真正派出 worker 后，先把返回的真实 handle bind 到 agent、link 到 task，再经 `ccm` 生命周期 verb 让普通 task 进入 `in_flight`。没有 handle 或 link 的 `in_flight` 是**幽灵任务（phantom）**。recon 时先 `ccm agent list` 重建 roster，再对关联条目做 `ccm agent show` / `ccm agent probe`，核对 handle、task link、liveness 与 git / transcript / 工具产物；三者皆空就按 phantom 处置。若 `ccm agent show` 返回已存的 attach command，只执行那条自包含命令；不要凭记忆编造新的 attach 操作。agent terminal 仍只是 runtime 事实，父 task 必须独立验收。
- **用隔离树的绝对路径指向工作目标——绝不靠继承 cwd。** 你的 cwd 常常*不是*工作落地的那棵树。每个被派发 writer 的 prompt 都必须给出其专属工作树的**绝对路径**、要求先核对位置，并告诉它别依赖继承来的 cwd——否则文件会落进错误的树。
- **单一提交者：叶子负责写 + 自测，你负责提交。** 独立 worktree 解决并行写入隔离，不授予叶子提交权。要求每个叶子**写它的文件、跑它的测试证明是绿的，但绝不 commit**；由你在各树端点验收、统一集成，再按依赖序提交。（又是 end-to-end argument——commit 完整性归你的端点，不归叶子。见 `resume-verify.md`。）
- **隔离不消除语义冲突。** 若几个任务都修改同一个共享文件（一个共享测试文件、一个 registry），它们不会在执行中彼此覆盖，却可能在集成时冲突。能错峰就拆进不同的波；必须同波就预建显式 integration 节点，由你在端点合并并重跑集成验收。

---

## watchdog / liveness —— 给静默失败盲区配一张安全网

派发卫生堵的是「board 标了却没真派」（phantom，见上面〈派发卫生〉）；**watchdog 堵的是它的下游孪生**——一个真派出去的 `in_flight` 任务**事后 hang 死 / 静默死**，或那个 phantom 一直没被戳穿，而你又走到了 `wait` 边。harness 的自动重唤起是 **completion-triggered**：只在任务**触发完成事件**时把你带回来，对「永不触发完成事件」的失败（hang / 静默死 / phantom）结构性失明（完整论证 + 「N 小时成功日志不是反证」的幸存者偏差，见 `async-hitl.md` §等待前 arm watchdog）。

**external issue tracking**：`executor=external` + `references.kind=issue` 的节点不在当前 session 里运行；issue URL 是 tracking anchor，让你回外部系统看进度。不要把 GitHub issue closed 当完成事件本身：closed 只说明外部侧声称收口，下一步是找到实际 artifact（PR / commit / report / release / CI run）并端点验收；验收前保持 `uncertain` 或其它非 done 状态。

**何时 arm**：走 `wait` 边前，剩余 path 里有 blocked 在**可能静默失败的 `in_flight`** 上的（不只是 awaiting-user），或关键 external issue 长时间没有外部进展 / 没有后续 artifact 可验 → arm 一个 watchdog 定时唤醒，间隔回来 recon 对地面真相。纯 awaiting-user 不 arm（按 mechanism 用、不按 ritual 用——触发条件与 board 双层记录见 `async-hitl.md`）。

**工具降级链（按优先级，缺则降级）**——ship-anywhere 诚实性：不同 harness 的唤醒能力不同，故教法是降级链 + 显式可用性提示，不假设某个工具名到处都在：

{{WATCHDOG_WAKEUP_TOOL_CHAIN}}

被唤醒后 recon 用的就是上面派发卫生那套地面真相验证法（handle / `git status` / 工具结果），处置完静默失败的、该 re-arm 的 re-arm——细节在 `async-hitl.md` §等待前 arm watchdog。
<!-- ccm:k:end point:dispatch.hygiene-and-liveness -->

## 失效类型

`motivation_conflict`（主体：行为约束） —— 知道要先绑定真实 handle 再标记任务在跑、要用绝对路径、叶子不能自己提交，但在追求推进速度时会倾向于先把状态标好、把琐碎的核验步骤往后放。

主体是一串必须/绝不的派发卫生纪律（先 bind handle 再 in_flight、绝不靠继承 cwd、叶子绝不 commit、等待前 arm watchdog），每条的偷懒路径都更快。

## 为什么它随模型变强而更重要

模型越强，越能把“这个任务逻辑上大概率会成功，先标上不影响正确性，回头一定核实”或“这次改动小，叶子直接提交更省一轮往返”这类效率论证讲得像是审慎的工程取舍，而不是抄近道。

## 失败形态

派发后立刻把任务标成在跑，实际派发因为某个参数错误静默失败，之后没有人再回头核对 handle 是否真的绑定——这个任务此后在记录上一直显示“在跑”，直到某次巡检才被戳穿是幽灵，期间可能已经空等了很久。
