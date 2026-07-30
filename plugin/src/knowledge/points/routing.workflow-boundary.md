---
point: routing.workflow-boundary
---

## 权威陈述

<!-- ccm:k:start point:routing.workflow-boundary -->
`executor=workflow` 可以跨 host 保留：它表示一个节点拥有结构化多叶、fan-out / join 或 stage 化责任。它不自行承诺当前 host 存在名为 `Workflow` 的 runtime，也不授权你调用别的 host 的 API。

{{WORKFLOW_RUNTIME_SEMANTICS}}

无论 host 怎样实现，最终都要落到真实可调用机制与真实 handle；只在计划里写了 `workflow`，不算发车。需要学习具体 workflow 脚本语法时才调用 `authoring-workflows`；若当前 adapter 明示 runtime unsupported，就按本节的 host-native 映射执行，不把脚本语义冒充可用工具。

<!-- ccm:k:end point:routing.workflow-boundary -->
