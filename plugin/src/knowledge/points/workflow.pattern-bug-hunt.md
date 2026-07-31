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

## 失效类型

`capability_gap`（主体：事实方法） —— 删了这条，agent 不知道有这个模式，可能选择单趟 review（低假阳但遗漏 bug）或无脑迭代（高假阳但力求完整性），意识不到完整性与低误报率需要组合设计。

主体是 loop-until-dry 与 adversarial-verify 的组合方法，以及「completeness 和低误报同时要时用它」的选型判据。

## 边界

适用于「既要 completeness 又要低假阳率」的场景。边界是仅需其一的情况（只要低假阳放弃完整性、或只要完整性接受高假阳）不用本模式。一旦选了必须完整实施两个环节。

## 失败形态

隐蔽形态：agent 实施了 loop-until-dry（一直搜到 K 轮 dry）但省略了 adversarial-verify（对每个候选反驳一遍），声称找齐了所有 bug 但实际是一堆假阳，用户被淹没；或只顾低误报、3 轮 dry 就停了、留下真实的边界 case bug。
