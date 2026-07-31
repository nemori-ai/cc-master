---
point: workflow.pattern-loop-budget
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-loop-budget -->
## loop-until-budget

**何时：** 深度要随用户的 `'+Nk'` budget 指令伸缩，而理想的 count 又说不准。共享 token
budget 还有余量就 loop。`budget.total` 守卫是必须的——少了它，`remaining()` 就是
`Infinity`，loop 会一路跑到 1,000-agent 的 cap。

```js
const RESERVE = 50_000
const out = []
while (budget.total && budget.remaining() > RESERVE) {
  out.push(await agent('produce the next batch'))
}
```

**由谁演示：** `assets/templates/loop-until-budget.js`。

---

<!-- ccm:k:end point:workflow.pattern-loop-budget -->

## 失效类型

`capability_gap`（主体：事实方法） —— 知道 loop 与 budget 概念但忘记了本框架的两个关键守卫：budget.total 常量检查与 RESERVE 缓冲的必要性

主体是「按共享 token budget 伸缩深度」的循环方法与其守卫写法，缺了不知道怎么让深度随预算自适应。

## 边界

此模式仅用于「深度随 budget 伸缩且理想 count 不可预知」的场景。禁止用于：① count 可前置计算（直接 for 循环）② 无 budget 约束（退化为无限循环）③ RESERVE 无意义（单轮产出极小）。RESERVE 通常设为当前 budget 的 10–20%，保留给最后一轮收敛。

## 失败形态

最常见：忘记 budget.total 守卫导致 remaining() 返回 Infinity，loop 一路跑到 agent 上限（1000）才 cap。次常见：RESERVE 设得太小无实际作用，或太大使 budget 提前耗尽浪费配额。隐蔽形态：loop 内用了 Date.now() 或 Math.random()，加上隐式重试导致非幂等行为；或嵌套 parallel/pipeline 导致实际 token 消耗与 budget 预期严重不符。
