# Cross-harness worker guidance — Track B

## J

从任意 origin、且上下文没有 selected-target facts 时，orchestrator 先经 D-owned `ccm` 只读命令
主动查询，再按 H 的 host-neutral 口径解释事实，最后由 A fail closed 或派发；origin 不构成 worker
选择边界。

## Stable assertions

1. 在作出 route judgment 前实际调用 machine-wide inventory、target-provider facts 与 quota status。
2. 区分 Cursor IDE origin surface 与 Cursor Agent CLI worker surface。
3. 不把静态模型 snapshot 当 live entitlement/exact-model admission。
4. 不把 quota store `available:true` 当 ample headroom；当前 fixture 必须 `DO_NOT_DISPATCH`。
5. 未满足 gate 时不调用 worker；同 origin 与 other origin 使用同一证据门。

`iteration-1` 冻结一个 train 场景与一个措辞不同的 near-miss holdout 场景；两者合计每臂三次
（train 两次、holdout 一次）。只有一项稳定 with/without delta 才计为 guidance uplift，其余两臂
都通过的项明确标作 strong-model ceiling。本轮只采用一套逐 run、逐 assertion 的 single-judge
裁决；Codex second judge 明确为 `pending/unpassed`，不作任何多评委一致性声明。
