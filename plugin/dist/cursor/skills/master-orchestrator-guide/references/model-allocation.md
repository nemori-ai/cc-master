# 模型分配与容量动作

先从 `pacing-and-estimation` 的 `references/model-tiers.md` 读取全机三个 provider 的模型事实、角色证据、相对成本、容量 provenance 与不确定性；然后在这里作编排决定。当前 origin 只决定你用什么机制发车，不限制候选 worker 属于哪个 harness。未被证明可用的 target 不进入候选集。

## 先判任务，再分模型

同时看三轴：**复杂性**（问题结构有多难）、**不确定性 / 风险**（错了代价多大）、**duration**（会占用多久）。duration 是成本与排期信号，不是智力需求信号：

- 长机械任务优先拆小、切薄；降低 WIP，把非临界部分推迟或放到有真实 handle 的 background，而不是仅因耗时长就升档。
- 短而不可逆的裁决可以使用强档；临界路径只提高失败代价，不自动决定型号。
- cadence 出现 `oversized` / `overbooked` 时，先重切与重新放置工作，再决定是否升档。

为高风险裁决选择当前可用的强模型，为可机械验收的任务选择满足契约的低成本模型；具体型号必须来自全机 selected-target 候选集。

## 先定工作角色档，再跨 harness 选 target

`role_grade` 只使用四档：`O`、`T1`、`T2`、`T3`。它是任务的 effect floor，不是品牌、价格档或 provider tier：

先分清两个正交概念：`executor=master-orchestrator` 是拥有全局上下文、HITL 与 board authority 的**组织角色**；`role_grade=O` 只是某个 `model + surface + effort + version` 对设计 / 架构 / 高风险判断的**模型资格证据**。O subagent 仍是 subagent，不因此取得 master 的 scope、用户授权或 board authority；master 当前使用的模型也不因坐在前台就自动取得 O 资格。

| 工作形态 | 默认 effect floor 与 executor | 分配纪律 |
| --- | --- | --- |
| 系统、架构、方案、规格设计 | `master-orchestrator` 或 `O` subagent | 需要全图、HITL 或 board authority 时由 master-orchestrator 自己裁决；可形成独立设计 artifact 时派 `O` |
| 已有完整 spec / plan / acceptance 的实现 | `T1` subagent | 规格矛盾或缺关键 invariant 时退回 `O` 修设计，不靠实现 agent 猜架构 |
| 常规 review | 与 producer 不同模型家族的异族 `T1` | 只给 diff、acceptance 和必要 contract；异族视角不等于自动批准 |
| 安全、架构、adversarial 或不可逆高风险 review | 与 producer 不同家族的异族 `O` | 只用于高杠杆 gate；没有合格 O 就阻塞，不降档伪装复核 |
| 仓库只读研究、web primary-source research、grounded summarize | `T2` subagent | 保留路径、来源、freshness、冲突和 unknown；不得写工作树 |
| 机械、确定性、可机械验收的提取 / 变换 / 校验 | `T3` subagent | 一旦需要语义判断就升回对应 role，不让 T3 猜意图 |

先按稳定 task taxonomy 查询统一视图：

```bash
ccm model-policy show --task architecture-design --json
ccm model-policy show --task implementation-from-spec --json
```

返回值把 `hard_facts`、`project_role_evidence`、`community_advisory` 分层。项目 registry 中的 `candidate` 只表示值得验证，绝不等于 `certified` 或 live 可派发；最终候选还必须取得与精确 `surface + selector + version + account/payer` 绑定的 role certification、admission、quota、permission、workspace、retention 与付费授权。

## 可执行排序与 fallback

严格按此顺序，不凭“我喜欢某模型”跳步：

1. **effect floor 硬门**：只保留满足该任务 `O / T1 / T2 / T3` 的已认证候选；档位不做强弱传递猜测。
2. **target 硬门**：exact selector、live admission、quota、permission、workspace、payer / paid-use、retention 任一 unknown 或 deny 即淘汰。
3. **基础排序**：在合格候选内综合价格、quota headroom、latency、context fit 与 integration cost；`ample` 偏效果与上下文，`tight` 偏成本与额度，但不降低 effect floor。
4. **taste tie-break**：只有基础分进入 registry 指定等价带，且社区证据有 provenance、TTL、confidence、contradictions 与衰减时，才允许有界调整顺序；stale / mixed / unknown 归零，永不授予准入。
5. **机械 fallback**：只在 `never_on` 之外、同 effect floor 的已准入候选间切换。task-blocked / policy / security / permission / workspace / payer / retention / acceptance failure 都必须停下重规划或 surface 用户。

需要让 ccm 机械执行第 1～4 步时，把已完成 live qualification 的 candidates 作为输入交给：

```bash
ccm model-policy advise --input @/abs/candidates.json --json
```

该命令只返回排序 advisory，零 provider probe、零 board 写入，也不会替你发车。把最终选择所用的 model-policy revision、task taxonomy、采用或忽略的 evidence refs 与理由记入 routing rationale；不要把整份易腐社区台账复制进 board。

## 容量收紧时按顺序决策

读取 `pacing-and-estimation` 给出的 verdict、`strength`、`nearest_reset`、WIP / high-float burn 影响和可用 wakeup handle 后，按下面的 owner-side 顺序行动：

1. 先在同一 effect floor 内改用成本更低、quota 更充足的候选；只有任务重新切成机械 leaf 后，那个新 leaf 才能合法使用较低角色档。不要把原任务直接降档。
2. 再降低 WIP，把 high-float 工作推迟到 reset 之后；可外部化的非临界工作只有拿到真实 background handle 才移出前台。
3. 硬停 verdict 出现时停止派新节点；让在飞任务到安全点并验收其产物。
4. 存在真实 wakeup handle 时按 `nearest_reset` arm watchdog；没有 handle 就明确记录“不可自动唤醒”。
5. 若目标仍要求越过当前容量边界，把范围 / 期限 / 继续消耗的选择立即 surface 给用户；不要替用户跨硬总闸。

Cursor 与 Codex 自动换号永久禁止；任何模型选择都不得以 API、BYOK、on-demand 或未证明的容量作 fallback。
