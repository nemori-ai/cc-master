---
point: routing.workflow-boundary
---

## 权威陈述

<!-- ccm:k:start point:routing.workflow-boundary -->
`executor=workflow` 可以跨 host 保留：它表示一个节点拥有结构化多叶、fan-out / join 或 stage 化责任。它不自行承诺当前 host 存在名为 `Workflow` 的 runtime，也不授权你调用别的 host 的 API。

{{WORKFLOW_RUNTIME_SEMANTICS}}

无论 host 怎样实现，最终都要落到真实可调用机制与真实 handle；只在计划里写了 `workflow`，不算发车。若当前 adapter 明示 runtime unsupported，就按本节的 host-native 映射执行，不把脚本语义冒充可用工具。
<!-- ccm:k:end point:routing.workflow-boundary -->

## 失效类型

`environment_fact`（主体：事实方法） —— 模型会想当然地认为「结构化多叶」这个标记值本身就担保了当前 host 存在同名可调用 runtime，删掉后会去调用不存在的接口，或误把写好字段当成已经派发。

主体是 executor=workflow 在本体系中的语义边界与当前 host 是否存在同名 runtime 的事实。

## 失败形态

对应字段规规矩矩写着一个合法值，看起来这个节点「已经有了派发方案」，但背后从未真的触发任何 host 侧调用、也没有拿到可核验的运行凭证——board 记录形式完整，实际上仍是零动作的空白位，容易被误读成「已在推进」。
