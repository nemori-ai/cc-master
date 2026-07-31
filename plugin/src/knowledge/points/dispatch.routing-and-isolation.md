---
point: dispatch.routing-and-isolation
---

## 权威陈述

<!-- ccm:k:start point:dispatch.routing-and-isolation -->
executor 不按数量选，harness × model 也不是默认值。完整顺序只有一份：「任务形状 → executor → target surface → effect floor → exact qualification → 同档排序/fallback → 真实 handle → 端点验收」。本页只展开其中并行与 runtime 机制，不另写 executor 决策树或模型资格表。

---

## 派前取证 —— harness × model 不是默认值

这里只提醒一件 runtime 相关的事：最终 model / effort 必须进入真实 provider argv，不能只写在计划文字里让 CLI 默默吃默认值。

---

## 并行 writer 的隔离前置条件

**硬纪律：派发任何并行 writer / subagent 之前，先给每个 writer 指定一棵独立的隔离工作树（例如各自的 git worktree），并把它的绝对路径与位置核对写进派发 prompt。多个 writer 绝不共享同一路径；只读 agent 才可共享。**没有独立工作树，就不要并行派 writer——先建立隔离，或改为串行。

共享一棵树会让并行结果失去可信度：co-edit 同一文件会互撞；一个 worker 会读到另一个尚未完成的中间态，产出假绿；你也无法在端点按任务干净验收、归因与落 commit。隔离不是整洁偏好，而是端点证据成立的前提。

每个 writer 只在自己的树里写、自测并报告 artifact；你在各树端点独立验收，再统一集成。即使任务预计修改不同文件，也不把「大概不会撞」当成共享路径的许可证。

---

## 跨 harness 的当前最小闭环

origin 不是 worker pool 边界。本文不再维护第二条 cross-harness 热路径。你在这里继续关心的是机制层：并行 writer 的隔离、workflow 生命周期耦合、escalation、admission 与派发卫生。

---
<!-- ccm:k:end point:dispatch.routing-and-isolation -->

## 失效类型

`motivation_conflict`（主体：行为约束） —— 清楚并行写者需要隔离工作树，但当任务列表显示各写者预计改动不同文件时，容易把『大概率不冲突』当成可以省掉建独立工作树这一步的理由，尤其在赶时间或嫌搭建麻烦时。

主体是「没有独立隔离工作树就不要并行派 writer」这条硬纪律，共享一棵树省事得多，动机完美的执行者知道了就会先建隔离或改串行。

## 边界

只适用于真实并发写（同一时间窗口内多个写者同时活跃）；对严格串行执行（一个完成合并后再派下一个），不存在并发写风险，此时不必单独建树——这不是省事而是并发窗口本身不存在。

## 为什么它随模型变强而更重要

强模型更擅长论证『这次预判过了、文件不重叠、风险可控』这类看似经过分析的理由，把跳过隔离步骤包装成一次深思熟虑的判断而非省事，讲得越细致越像真的做过风险评估。

## 失败形态

每个写者确实各自声称改了不同文件，端点验收时也各自报了产出，但因为共用同一个工作目录，索引/构建缓存/未提交的中间态互相污染过——最终结果表面对得上号，问题出在过程中谁都无法保证读到的是干净状态。
