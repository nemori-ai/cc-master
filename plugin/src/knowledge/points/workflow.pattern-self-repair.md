---
point: workflow.pattern-self-repair
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-self-repair -->
## self-repair-loop

**何时：** 一个 agent 的输出必须通过某个 gate，而你想让它在有限次 attempt 之内自己修自己的
失败。Loop：产出 → 跑 gate → 没过就把 gate 的诊断喂回下一次 attempt 的 prompt；通过、或到
`MAX_ATTEMPTS` 就停。这相当于把计数器换成结构化 pass/fail gate 的 loop-until-{count}，再加
一道硬 attempt cap 当保险丝。dedup-against-seen 在这里**不**适用（被修的始终是同一个 item），
保险丝就是 attempt 计数。用它做「把这个改到能编译 / 能测过」的单-artifact 收敛——*不是*用于
多-finding 的发现。

**由谁演示：** `assets/examples/self-repair-loop.js`。

---

<!-- ccm:k:end point:workflow.pattern-self-repair -->
