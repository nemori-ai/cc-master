---
point: workflow.pattern-loop-count
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-loop-count -->
## loop-until-count

**何时：** 你有一个明确的目标 count——「找 10 个 bug」「产出 5 个选项」。count 没到目标
就 loop，但**永远**留一个硬停（这里目标*本身*就是那个停；绝不写无界的 `while`）。

```js
const found = []
while (found.length < 10) {
  const r = await agent('find the next item not yet found')
  found.push(r)
}
```

**由谁演示：** loop 控制流 template 算一个家族——把
`assets/templates/loop-until-dry.js` 里的 dry-round 守卫换成一个 count 守卫即可。

---

<!-- ccm:k:end point:workflow.pattern-loop-count -->

## 失效类型

`capability_gap`（主体：事实方法） —— 不知道有明确 count 时应该用有界循环并留硬停，会误写无界 while(true) 或缺失停止条件，导致死循环或无限尝试

主体是 loop-until-count 的控制流方法——以目标 count 本身作硬停，属于缺方法而非缺事实。

## 边界

适用于目标 count **客观确定**的场景（『找 10 个 bug』『产出 5 个方案』）。若实际发现无法达成 count（如查遍全仓都不足 10 个），应该在循环中检测『连续 K 轮无新发现』而不是死等，然后 graceful 降级。

## 失败形态

无界循环是最明显的灾难（hang）；次级失败是『循环 count 次然后停』但缺『每轮是否有进展』的判定，导致在某些情况下浪费算力。强模型如果倾向于「反正迭代可以无限试」，更容易陷入这个陷阱而不是设硬停。
