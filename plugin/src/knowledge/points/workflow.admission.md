---
point: workflow.admission
---

## 权威陈述

<!-- ccm:k:start point:workflow.admission -->
## 1. 先问清自己——你究竟需不需要 workflow？

workflow 是有开销的，只值得任务要协调**几十到几百个 agent**、且必须把中间结果挡在 context
*之外*时用。先在派发决策关确认「该选 workflow 还是 subagent」；确认要上 workflow 之后，才往下走范式决策树。
<!-- ccm:k:end point:workflow.admission -->

## 失效类型

`capability_gap`（主体：事实方法） —— 删掉后 agent 失去几十到几百个 agent 且中间结果必须挡在 context 外这个具体准入门槛,无法判断一个任务到底够不够格上 Workflow。

主体是 workflow 的准入判据（值不值得上、规模与 context 隔离条件），缺了就没有选型标准。

## 失败形态

任务只需要三五个后台 agent、产物也不大,却先搭一套 Workflow 脚手架(定义 stage/artifact/state 文件)来处理;或者反过来,已经在协调上百个 agent、中间产物明显撑爆 context,却仍用零散 subagent 硬扛不升级——两种都是没真按这条门槛卡过的表现。
