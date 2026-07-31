---
point: workflow.background-contract
---

## 权威陈述

<!-- ccm:k:start point:workflow.background-contract -->
## 7. 后台执行（让主线空出来的那个契约）

一次 `Workflow` 工具调用**立刻带一个 task ID 返回**；workflow 在后台跑，完成时往对话里
注入一个 `<task-notification>`。所以主线不被阻塞——它立刻拿回控制权，能在 workflow 跑的
同时做下一件事。（主动短间隔轮询是浪费——harness 会在完成时重新唤醒你。）但有一条限制要
记牢：workflow 一旦启动，它的脚本结构就定死了——**没有 mid-run 输入**。workflow 内部的
「持续推进」，是你写流式 `pipeline()` 时就做下的 compile-time 决策，而不是 runtime 现场的
临场调整。
<!-- ccm:k:end point:workflow.background-contract -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉后模型不知道这种后台执行原语一旦启动就没有 mid-run 输入通道、也会自动在完成时唤醒对话，可能设计出假设运行中可插入指令的流程，或者不必要地做浪费资源的轮询等待。

主体是后台执行的接口事实——立刻返回 task ID、完成时注入 task-notification、无 mid-run 输入，属于本 harness 特有行为。

## 边界

这条限制只约束已经启动之后的运行期行为；启动前对脚本结构、参数、分支逻辑的设计不受限——可以把所有希望在"运行中"发生的判断逻辑，在启动前就以编译期决策的形式写进脚本里。

## 失败形态

最隐蔽的形态是把"运行期需要临场判断"的逻辑硬塞进已启动的脚本里，自以为可以跑到中途根据情况调整分支——脚本本身结构完整、语法正确，看起来没问题，但那些"临场判断"分支其实在启动那一刻就已经编译死，永远走不到真正意义上的运行期分支。
