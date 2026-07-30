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
