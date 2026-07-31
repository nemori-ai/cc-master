---
point: workflow.pattern-scout-fanout
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-scout-fanout -->
## scout-then-fanout (entry shape)

**何时：** 动手之前你还不知道 work-list——现实里最常见的入口形状。让一个 scout agent 返回
这份 list，再对它 pipeline / parallel。（通常你会把 scout 内联在主线里跑；这里给的是
in-workflow 的版本。）

```js
const scout = await agent('enumerate the work items as a JSON list', { schema: ITEMS })
const out = await pipeline(scout.items ?? [], (it) => agent(`process ${it}`))
```

**由谁演示：** `assets/templates/scout-then-fanout.js`。

---

<!-- ccm:k:end point:workflow.pattern-scout-fanout -->

## 失效类型

`capability_gap`（主体：事实方法） —— 不知道 work-list 未知时应先 scout 再 fan-out，会硬编码 work-list 或手动串行化 scout 与处理，导致编排脆弱或无法独立测试 scout 逻辑

主体是 work-list 未知时先派 scout 枚举再 fan out 的入口形状方法。

## 边界

只适用于 work-list 在**运行时才能确定**的场景。若 work-list 预先已知（配置、命令行参数），直接 fan-out 即可，不需要 scout 阶段。反过来，需求变化时也能通过改 scout 逻辑灵活适应。

## 失败形态

不知道模式，可能把 work-list 硬编码进脚本或环境变量，或用命令行参数串联 scout 与 fan-out 而不是用 workflow 表达。结果代码对需求变化脆弱；scout 逻辑复用性低；测试和调试难以隔离。
