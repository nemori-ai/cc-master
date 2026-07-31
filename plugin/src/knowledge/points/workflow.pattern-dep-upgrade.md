---
point: workflow.pattern-dep-upgrade
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-dep-upgrade -->
## dep-upgrade-sweep

**何时：** 你想一次 bump 很多依赖，每个 upgrade 各自隔离让并行编辑不冲突、只保留仍然绿的
bump。这是带 `isolation: 'worktree'` 的 **discover → transform → verify** 形状、特化到依赖
升级（发现过时的 dep → 在各自的 worktree 里逐个 upgrade → gate → 留下绿的）。用它做批量
依赖维护。

**由谁演示：** `assets/examples/dep-upgrade-sweep.js`。

---

<!-- ccm:k:end point:workflow.pattern-dep-upgrade -->

## 失效类型

`capability_gap`（主体：事实方法） —— 模型可能不知道如何将依赖隔离升级的 discover-transform-verify 形态与 worktree 隔离结合，保留仅通过 gate 的 bump

主体是 discover→transform→verify 加 worktree 隔离的批量升级形状，是一套方法而非本项目事实。
