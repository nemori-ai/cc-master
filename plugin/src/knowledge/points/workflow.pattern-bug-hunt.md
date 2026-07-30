---
point: workflow.pattern-bug-hunt
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-bug-hunt -->
## bug-hunt-loop

**何时：** 全仓找 bug，你既不知道总共有多少、又要求每个报出来的 bug 都可信。把
**loop-until-dry**（一直搜到 K 个 dry round 都挖不出新东西）和 **adversarial-verify**
（出报告前对每个幸存者 refute 一遍）组合起来。当 completeness *和* 低误报率都要时，用它，
而不是单趟 review。

**由谁演示：** `assets/examples/bug-hunt-loop.js`。

---

<!-- ccm:k:end point:workflow.pattern-bug-hunt -->
