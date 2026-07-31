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

## 失效类型

`environment_fact`（主体：事实方法） —— 模型面对协调多个 agent 的脚本任务时，默认反应是脚本自己直接读写/跑命令、中间结果留在会话里累积，不会自发想到把决策权交给纯协调脚本、把副作用全部委托给叶子 agent 这种架构。

主体是 dynamic workflow 的执行模型事实——决策交给确定性脚本、中间结果在变量里、脚本是无 fs/shell/Node API 的纯协调器。

## 失败形态

脚本本身确实没有直接调用被禁止的底层接口，形式上「零副作用」达标，但做法是把该交给叶子 agent 独立完成的实际改动，拆成「取原始内容→脚本里代为拼接处理→再整段塞进下一条指令」来回搬运——协调器没碰底层接口，却事实上顶替了本该独立完成的重活，中间结果也没能真正省下上下文空间，只是绕了一圈仍旧膨胀。
