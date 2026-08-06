---
point: capacity.ranking-and-contraction
---

## 权威陈述

<!-- ccm:k:start point:capacity.ranking-and-contraction -->
这里额外强调：排序 advisory 不做 provider probe、不写 board、也不替你发车；它只能消费调用方已经完成 live qualification 的候选。把最终选择用到的策略 revision、task taxonomy、evidence refs 与取舍理由记入 routing rationale，不把易腐社区台账复制进 board。

## 容量收紧时按顺序决策

读取 verdict、`strength`、`nearest_reset`、WIP / high-float burn 影响和可用 wakeup handle 后，按下面的 owner-side 顺序行动：

1. 先在同一 effect floor 内改用成本更低、quota 更充足的候选；只有任务重新切成机械 leaf 后，那个新 leaf 才能合法使用较低角色档。不要把原任务直接降档。
2. 再降低 WIP，把 high-float 工作推迟到 reset 之后；可外部化的非临界工作只有拿到真实 background handle 才移出前台。
3. 硬停 verdict 出现时停止派新节点；让在飞任务到安全点并验收其产物。
4. 存在真实 wakeup handle 时按 `nearest_reset` arm watchdog；没有 handle 就明确记录“不可自动唤醒”。
5. 若目标仍要求越过当前容量边界，把范围 / 期限 / 继续消耗的选择立即 surface 给用户；不要替用户跨硬总闸。

账号切换与容量来源只服从 selected-target 的当前事实和既存 policy；未证明的 payer、容量或授权不得作为 fallback。各 provider 的当前边界不在本文复制。
<!-- ccm:k:end point:capacity.ranking-and-contraction -->

## 失效类型

`motivation_conflict`（双重性质·方法部分更强的模型能自己补回来，留下的是约束） —— 删掉后,agent 在容量紧张时容易直接把任务整体降档、或替用户跨越硬总闸这类更省事的近路,而不是按同档换候选→降 WIP→停派→watchdog→surface 的既定顺序处理。

删掉后缺少容量收紧时降档→降 WIP→硬停→arm→surface 的有序决策框架。

## 边界

适用于板处于容量/配额收紧、已拿到 verdict 之后的资源决策顺序;容量充足、无需取舍的常规调度不适用。没有真实例外——即便目标紧迫,也没有跳过前几步、直接换号或直接降档原任务的合法路径。

## 失败形态

配额紧张时直接把某任务的执行角色改成低档模型继续跑,记录写着『为控制成本调整了档位』——但任务从未被重新切成机械 leaf,复杂度和判断力要求没变,只是套了个更省钱的外壳,规避了应做的重新切片。
