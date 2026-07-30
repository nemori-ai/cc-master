---
point: workflow.admission
---

## 权威陈述

<!-- ccm:k:start point:workflow.admission -->
## 1. 先问清自己——你究竟需不需要 workflow？

workflow 是有开销的，只值得任务要协调**几十到几百个 agent**、且必须把中间结果挡在 context
*之外*时用。若你还没在派发决策关确认过这一步，先回 `master-orchestrator-guide` 的
`dispatch.md`（选择标准一节）过一遍——「该选 workflow 还是 subagent」是那里的判断标准单一
持有，本节不复述。确认要上 workflow 之后，才往下走范式决策树。

<!-- ccm:k:end point:workflow.admission -->
