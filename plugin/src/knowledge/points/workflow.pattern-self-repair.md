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

## 失效类型

`capability_gap`（主体：事实方法） —— 删掉这条，模型不知道「结构化 gate + attempt 硬上限」这个模式组合，倾向于用无界的 retry 或固定计数重试。

主体是「产出→跑 gate→把诊断喂回下一次 attempt 并加硬 cap」的单 artifact 收敛方法及其适用边界。

## 边界

仅用于单个 artifact 的结构化 pass/fail gate 场景，且 gate 判定严格；不用于多发现项去重（那是 loop-until-dry 的职责）。

## 失败形态

attempt 计数超过上限后 loop 继续运行，或返回未修成的失败但 agent 不自停；或混淆与 loop-until-dry（对多发现项无限扫）的界限。
