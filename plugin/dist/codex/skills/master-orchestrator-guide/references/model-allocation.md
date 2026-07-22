# 模型分配与容量动作

稳定的 `O / T1 / T2 / T3` floor、exact qualification 与 same-floor fallback 顺序只在 [`worker-routing.md`](worker-routing.md#确定-effect-floor) 定义；动态 provider/model/quota 事实只从 `pacing-and-estimation` 读取。本文只深化两类编排判断：复杂性 / 风险 / duration 怎样影响分配，以及容量收紧后怎样行动。

## 先判任务，再分模型

同时看三轴：**复杂性**（问题结构有多难）、**不确定性 / 风险**（错了代价多大）、**duration**（会占用多久）。duration 是成本与排期信号，不是智力需求信号：

- 长机械任务优先拆小、切薄；降低 WIP，把非临界部分推迟或放到有真实 handle 的 background，而不是仅因耗时长就升档。
- 短而不可逆的裁决可以使用强档；临界路径只提高失败代价，不自动决定型号。
- cadence 出现 `oversized` / `overbooked` 时，先重切与重新放置工作，再决定是否升档。

为高风险裁决选择当前可用的强模型，为可机械验收的任务选择满足契约的低成本模型；具体型号必须来自全机 selected-target 候选集。

## floor 之后再深化分配

你先在 [`worker-routing.md`](worker-routing.md#确定-effect-floor) 定 floor，再用本页三轴检查边界案例。不要因为任务很长就升档，不要因为任务在 float 上就降档，也不要因为 master 坐在前台就把组织角色误当 O 资格。具体 target 必须再过 hub 的 [exact qualification](worker-routing.md#做-exact-qualification)；本页不维护型号、surface、窗口或价格目录。

## 可执行排序与 fallback

排序、taste tie-break 与 fallback 的不可换序合同以 [`worker-routing.md`](worker-routing.md#同档排序与-fallback) 为准。这里额外强调：排序 advisory 不做 provider probe、不写 board、也不替你发车；它只能消费调用方已经完成 live qualification 的候选。把最终选择用到的策略 revision、task taxonomy、evidence refs 与取舍理由记入 routing rationale，不把易腐社区台账复制进 board。

## 容量收紧时按顺序决策

读取 `pacing-and-estimation` 给出的 verdict、`strength`、`nearest_reset`、WIP / high-float burn 影响和可用 wakeup handle 后，按下面的 owner-side 顺序行动：

1. 先在同一 effect floor 内改用成本更低、quota 更充足的候选；只有任务重新切成机械 leaf 后，那个新 leaf 才能合法使用较低角色档。不要把原任务直接降档。
2. 再降低 WIP，把 high-float 工作推迟到 reset 之后；可外部化的非临界工作只有拿到真实 background handle 才移出前台。
3. 硬停 verdict 出现时停止派新节点；让在飞任务到安全点并验收其产物。
4. 存在真实 wakeup handle 时按 `nearest_reset` arm watchdog；没有 handle 就明确记录“不可自动唤醒”。
5. 若目标仍要求越过当前容量边界，把范围 / 期限 / 继续消耗的选择立即 surface 给用户；不要替用户跨硬总闸。

账号切换与容量来源只服从 selected-target 的当前事实和既存 policy；未证明的 payer、容量或授权不得作为 fallback。各 provider 的当前边界只从 `pacing-and-estimation` 读取，不在本文复制。
