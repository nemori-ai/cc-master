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

你的 routing record 至少保留这些字段：

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

## 失效类型

`motivation_conflict`（主体：行为约束） —— 删掉后,派发者仍然知道这八步该按顺序走,但在想显得高效或已经很确信某个 target 会成功时,会选择跳步或事后补齐顺序——原文自带的三个反例(先看品牌、先排名、先写 in_flight)正是这种压力下的选择性失守。

要求每次派发都完整按固定次序写出八段证据并给出理由，跳步与倒推是省力近路，规则本身不需额外方法即可遵守。

## 为什么它随模型变强而更重要

模型越强,'我已经很确信这个 target 能行'这种高置信度感受本身越容易被误当成资格核验已经发生过的证据;模型越强,写出的 routing record 也越擅长把跳步之后的结果包装成叙事通顺、看似完整走过八步的报告,让审阅者更难分辨这是真走过八步,还是高质量地编了一份八步说辞。

## 失败形态

routing record 是在派发已经成功之后才补写的——八个字段按顺序整整齐齐地出现,读起来像是真的按序收集了证据,但实际上这些字段是从已知结果反推出来的叙述,派发当时根本没有真的按这个顺序收集对应证据;任何'字段是否齐全、顺序是否正确'的检查都会判它通过。
