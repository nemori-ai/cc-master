---
point: workflow.execution-model
---

## 权威陈述

<!-- ccm:k:start point:workflow.execution-model -->
## 1. 一句话本质

一个 dynamic workflow 把「下一步跑什么」的决策**从 LLM 手里收走、交给一段确定性的
JavaScript 脚本**。LLM 把脚本写一次；runtime 在后台执行它。中间结果活在**脚本变量**里，
而不在 context window 里——只有最终答案回到 caller。一次 run 能协调几十到几百个 agent 却
不淹掉 context，靠的正是这一点。

脚本是个**纯协调器**：没有文件系统、没有 shell、没有 Node API。所有带副作用的活（读、写、
跑命令）都委托给带一次性 context 的 leaf agent，只有它们的结果回来。

<!-- ccm:k:end point:workflow.execution-model -->
