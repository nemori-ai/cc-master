---
point: routing.qualification-and-fallback
---

## 权威陈述

<!-- ccm:k:start point:routing.qualification-and-fallback -->
先按任务的判断密度、风险与错误代价定最低 effect floor，再看具体型号。duration 与临界性影响成本和排期，不自动升档或降档；档位也不作“高档天然包含低档资格”的传递猜测。

| 工作形态 | 最低 effect floor | 典型约束 |
|---|---|---|
| 系统、架构、方案、规格设计；安全、架构、adversarial 或不可逆高风险裁决 / review | `O` | 需要全图、HITL 或 board authority 时仍由 `master-orchestrator` 裁决；独立设计 artifact 才派 O subagent |
| 已有完整 spec / plan / acceptance 的实现；常规异构 review | `T1` | spec 缺关键 invariant 时回到 O 修设计，不让实现 worker 猜；review 与 producer 使用不同模型家族 |
| 仓库只读研究、primary-source research、grounded summarize | `T2` | 保留路径、来源、freshness、冲突与 unknown；不写工作树 |
| 机械、确定性、可机械验收的提取 / 变换 / 校验 | `T3` | 一旦需要语义判断，升回对应角色档 |

`executor=master-orchestrator` 是组织角色；`effect_floor=O` 是某个精确模型组合的资格。O subagent 不因此取得用户授权或 board authority，前台 master 也不因坐在指挥台就自动取得 O 资格。

## 做 exact qualification

effect floor 只定义门槛，不证明任何具体 target 已过门。对每个候选逐项核验，并让所有证据绑定到同一个 freshness 时点：

1. **角色资格**：精确 `model / selector + surface + effort + version` 有满足当前 floor 的认证证据；registry 的 `candidate` 只表示值得验证。
2. **实时准入**：目标 binary / surface 可用，当前账号或 payer 有 entitlement，policy 与 live admission 允许这次调用。
3. **容量证据**：quota 与 payer / pool 指向同一 target；missing、stale、unknown、另一 surface 的余量都不能补成可用。
4. **执行边界**：permission / sandbox / workspace / write capability 足以完成任务；retention、数据边界与付费授权允许发送这些上下文。
5. **可追踪性**：这条 surface 能返回真实 handle，后续能 probe、收割 artifact 并端点验收。

你不要在本页或 board 复制 provider 型号、窗口、价格与 quota catalog。

任一硬门没有证据，就把候选标为 `insufficient` 并换另一个候选；如果没有候选满足 floor，就阻塞、重切任务或 surface 给用户，不把未知包装成 fallback。

## 同档排序与 fallback

只对已经通过 exact qualification、且满足同一 effect floor 的候选排序：

1. 先比较 cost、quota headroom、latency、context fit、task affinity 与 integration cost。
2. 只有基础分进入声明过的等价带，且社区证据有 provenance、TTL、confidence、contradictions 与衰减时，才让 taste 做有界 tie-break；stale / mixed / unknown 不加分。
3. fallback 只沿同档、已准入、非 `never_on` 的候选链移动。policy、security、permission、workspace、payer、retention 或 acceptance failure 不是“换个模型继续猜”的理由，必须停下重规划或 surface。

容量紧时先在同档换成本更低或余量更足的已认证 target，再降 WIP、推迟 high-float 工作、等待 reset 或缩 scope；不能直接降低原任务 floor。
<!-- ccm:k:end point:routing.qualification-and-fallback -->

## 失效类型

`capability_gap`（主体：事实方法） —— 知道容量证据必须和目标绑定在同一个来源、不能用未知或另一 surface 的余量补齐，但容量紧张时会倾向于把相近但不严格对应的证据当成够用，先把任务派出去再说。

主体是定 effect floor、逐项做 exact qualification、同档排序与 fallback 的判据体系，缺的是这套判断框架。

## 失败形态

某个候选在别的 surface 上确实有余量证据，被顺手当成这个候选自己的余量填了进来——字段表面看齐全了、“有容量证据”这一项打了勾，实质证据来源张冠李戴，并不满足容量必须与目标同源这条硬约束。
