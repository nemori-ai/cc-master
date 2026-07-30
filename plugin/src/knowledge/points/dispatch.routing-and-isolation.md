---
point: dispatch.routing-and-isolation
---

## 权威陈述

<!-- ccm:k:start point:dispatch.routing-and-isolation -->
executor 不按数量选，harness × model 也不是默认值。完整顺序只有一份：[`worker-routing.md`](worker-routing.md#一条不可换序的路由链) 的「任务形状 → executor → target surface → effect floor → exact qualification → 同档排序/fallback → 真实 handle → 端点验收」。本页只展开其中并行与 runtime 机制，不另写 executor 决策树或模型资格表。

---

## 派前取证 —— harness × model 不是默认值

派前资格硬门、same-floor fallback 与证据留存以 [`worker-routing.md`](worker-routing.md#做-exact-qualification) 为准；动态 provider/model/quota 事实继续由 `pacing-and-estimation` 持有。这里只提醒一件 runtime 相关的事：最终 model / effort 必须进入真实 provider argv，不能只写在计划文字里让 CLI 默默吃默认值。

---

## 并行 writer 的隔离前置条件

**硬纪律：派发任何并行 writer / subagent 之前，先给每个 writer 指定一棵独立的隔离工作树（例如各自的 git worktree），并把它的绝对路径与位置核对写进派发 prompt。多个 writer 绝不共享同一路径；只读 agent 才可共享。**没有独立工作树，就不要并行派 writer——先建立隔离，或改为串行。

共享一棵树会让并行结果失去可信度：co-edit 同一文件会互撞；一个 worker 会读到另一个尚未完成的中间态，产出假绿；你也无法在端点按任务干净验收、归因与落 commit。隔离不是整洁偏好，而是端点证据成立的前提。

每个 writer 只在自己的树里写、自测并报告 artifact；你在各树端点独立验收，再统一集成。即使任务预计修改不同文件，也不把「大概不会撞」当成共享路径的许可证。

---

## 跨 harness 的当前最小闭环

origin 不是 worker pool 边界；target surface、真实 help、资格硬门、provider argv、handle gate 与端点收口都按 [`worker-routing.md`](worker-routing.md#executor-不等于-target-surface) 做。本文不再维护第二条 cross-harness 热路径。你在这里继续关心的是机制层：并行 writer 的隔离、workflow 生命周期耦合、escalation、admission 与派发卫生。

---

<!-- ccm:k:end point:dispatch.routing-and-isolation -->
