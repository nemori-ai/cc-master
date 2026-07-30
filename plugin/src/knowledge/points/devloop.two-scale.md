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
