---
point: devloop.two-scale
---

## 权威陈述

<!-- ccm:k:start point:devloop.two-scale -->
## 两尺度 dev loop:外层编排,内层下降

同一套优化语言在两个尺度上工作:

- **外层 loop(master orchestrator)**:你不写代码,但你定义/锐化 objective,确保测量仪器存在,把 subagents 分配到不同优化组件,调 explore/exploit,识别 plateau 并 replan/restart,在收敛时验收并停机。你拥有的是优化系统,不是实现细节。
- **内层 loop(执行 agent)**:你拿一个带验收标准的任务,陈述当前 hypothesis,做最小有用改动,测量,读梯度,调整/重启/停机。

坏 handoff 把 dev task 写成一句 work order;好 handoff 把它写成可优化问题:objective 是什么、instrument 在哪、artifact 是什么、哪些约束不可碰、何时 stop/restart、哪些优化状态必须持续写回 board。长程任务的外层 loop 要有一份 optimization ledger:目标函数、当前 hypothesis、测量读数、plateau / restart 判断、下一步 probe。compact 是机械动作,你通常只能在 after compact 后感知;所以不要等某个"压缩前时机",而是在工作过程中持续用 board 管住这些信息。怎么用 board 承载这份 ledger,见 [references/optimization-ledger.md](references/optimization-ledger.md)。

<!-- ccm:k:end point:devloop.two-scale -->

## 失效类型

`capability_gap`（主体：事实方法） —— 删掉后,orchestrator 不会自发采用'外层定义目标与测量、内层做梯度下降'这套优化语言来拆分两个尺度的角色,只会退回默认的、看起来完全正常的工单式派发,不知道自己缺了什么。

主体是外层编排 loop 与内层下降 loop 的两尺度概念框架，缺了就分不清自己此刻拥有的是优化系统还是实现细节。

## 失败形态

'工单式' handoff 本身长得和正常派发没有任何区别——没有报错、没有红旗,orchestrator 只是反复把同一句模糊指令重新派给下一个执行者、指望结果变好,却从未意识到自己其实卡在了一个 plateau,因为压根没有可读的记录能告诉它'这其实是同一个失败方向的第 N 次重试'。
