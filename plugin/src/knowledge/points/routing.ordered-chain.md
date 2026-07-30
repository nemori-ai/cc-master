---
point: routing.ordered-chain
---

## 权威陈述

<!-- ccm:k:start point:routing.ordered-chain -->
你每次派发都按同一顺序写出八段证据：

```text
task shape
  → executor
  → target surface
  → O/T1/T2/T3 effect floor
  → exact qualification
  → same-floor ranking / fallback
  → real runtime handle
  → endpoint verification
```

这不是可交换的清单。routing record 的输出字段也必须保持这一次序；即使 effect floor 的判断依据来自 task shape，也不得把 `effect_floor` 提前到 `target_surface` 之前。`target_surface` 在这里先声明精确执行面，不等于先按品牌 / 型号替 floor 做决定；后一个 `effect_floor` 仍只由任务形状与风险推出。`effect_floor` 必须写出档位，以及仅由任务形状、风险与错误代价推出该档位的理由；只写 `T1` 之类的标签不算完成，也不得用某个 target 的品牌、容量或偏好倒推理由。先看品牌再猜任务档，会让偏好替代能力门；先排名再做资格核验，会把 `candidate` 偷换成可派发 target；先写 `in_flight` 再找 handle，会制造幽灵任务；
把 agent terminal 当 task done，会绕过验收。
任一承重证据是 unknown、stale、conflicting 或 deny，就停在对应硬门，不用感觉补值。

你的 routing record 至少保留这些字段，字段怎么写入 board 则只查 `using-ccm`：

```yaml
task_shape: <terminal-leaf | deterministic-sub-dag | orchestration-only | user-decision | external-tracking>
executor: <subagent | workflow | master-orchestrator | user | external>
target_surface: <exact harness + surface>
effect_floor: <O | T1 | T2 | T3 + task-shape/risk rationale>
qualification: <evidence refs + freshness + unknown/blockers>
ranked_fallback: <qualified same-floor chain + rationale>
runtime_handle: <real recon-able handle>
endpoint_verdict: <artifact + checks + acceptance evidence>
```
<!-- ccm:k:end point:routing.ordered-chain -->
