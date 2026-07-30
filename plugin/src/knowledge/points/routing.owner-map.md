---
point: routing.owner-map
---

## 权威陈述

<!-- ccm:k:start point:routing.owner-map -->
每个承重不变量只有一个 owner；其它文档只留一句摘要和精确指针：

| 关切 | 权威 owner | 何时再 drill |
|---|---|---|
| 八段路由顺序、executor / target 正交、effect floor 表、资格硬门、同档 fallback、handle gate、terminal ≠ done | **本页** | 每次派发只需从主 skill 直达本页一次 |
| dataflow / T₁/T∞、host 后台机制展开、parallel vs pipeline、escalation、writer 隔离、admission、liveness | [`dispatch.md`](dispatch.md) | routing record 之外确实要计算 lane / liveness 或设计具体并行机制时 |
| 复杂性 / 风险 / duration 的深化判断，以及容量收紧后的 owner 动作 | [`model-allocation.md`](model-allocation.md) | floor 边界或容量动作需要解释时 |
| 动态 provider / model / quota 事实、证据层级、freshness 与 selected-target binding | `pacing-and-estimation`；入口为 {{CROSS_HARNESS_TARGET_FACTS_POINTER}} | 读取或解释当前事实时；不要把 catalog 抄回这里 |
| `ccm` flags、JSON、board 字段与生命周期 verb | {{CCM_COMMAND_CATALOG_POINTER}} | 真正敲命令或写 board 时 |
| artifact、diff、tests、hash 与异构第二视角 | [`resume-verify.md`](resume-verify.md) | 要实际执行端点验收步骤时；只解释 terminal ≠ done 不再 drill |
<!-- ccm:k:end point:routing.owner-map -->
