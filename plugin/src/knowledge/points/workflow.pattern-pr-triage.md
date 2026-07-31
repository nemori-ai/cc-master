---
point: workflow.pattern-pr-triage
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-pr-triage -->
## pr-issue-triage

**何时：** 你有一批打开的 PR/issue 要分类、定优先级，但这份 list 事先并不知道。组合
**scout-then-fanout**（scout 出打开的项）→ 对每项 fan-out 一个分类器 → **judge-panel** 把
标好的这一批排成优先级队列。用它来「triage 整个 backlog」，而不是处理单个已知项。

**由谁演示：** `assets/examples/pr-issue-triage.js`。

---

<!-- ccm:k:end point:workflow.pattern-pr-triage -->

## 失效类型

`capability_gap`（主体：事实方法） —— 删掉后,遇到'一批未知列表的 PR/issue 需要分类定优先级'时,不知道项目里已经有一份 scout-then-fanout + judge-panel 的组合配方和可运行示例脚本,只能临时现拼,还可能拼错顺序。

主体是 scout-then-fanout 加 judge-panel 组合出 backlog triage 的复合形状方法。
