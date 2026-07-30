---
point: capacity.ranking-and-contraction
---

## 权威陈述

<!-- ccm:k:start point:capacity.ranking-and-contraction -->
排序、taste tie-break 与 fallback 的不可换序合同以 [`worker-routing.md`](worker-routing.md#同档排序与-fallback) 为准。这里额外强调：排序 advisory 不做 provider probe、不写 board、也不替你发车；它只能消费调用方已经完成 live qualification 的候选。把最终选择用到的策略 revision、task taxonomy、evidence refs 与取舍理由记入 routing rationale，不把易腐社区台账复制进 board。

## 容量收紧时按顺序决策

读取 `pacing-and-estimation` 给出的 verdict、`strength`、`nearest_reset`、WIP / high-float burn 影响和可用 wakeup handle 后，按下面的 owner-side 顺序行动：

1. 先在同一 effect floor 内改用成本更低、quota 更充足的候选；只有任务重新切成机械 leaf 后，那个新 leaf 才能合法使用较低角色档。不要把原任务直接降档。
2. 再降低 WIP，把 high-float 工作推迟到 reset 之后；可外部化的非临界工作只有拿到真实 background handle 才移出前台。
3. 硬停 verdict 出现时停止派新节点；让在飞任务到安全点并验收其产物。
4. 存在真实 wakeup handle 时按 `nearest_reset` arm watchdog；没有 handle 就明确记录“不可自动唤醒”。
5. 若目标仍要求越过当前容量边界，把范围 / 期限 / 继续消耗的选择立即 surface 给用户；不要替用户跨硬总闸。

账号切换与容量来源只服从 selected-target 的当前事实和既存 policy；未证明的 payer、容量或授权不得作为 fallback。各 provider 的当前边界只从 `pacing-and-estimation` 读取，不在本文复制。
<!-- ccm:k:end point:capacity.ranking-and-contraction -->
