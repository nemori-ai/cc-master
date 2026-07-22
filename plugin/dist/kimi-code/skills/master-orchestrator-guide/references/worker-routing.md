# Worker 路由 —— 从任务形状到端点验收

> **何时读：** 你准备派一个 worker，或需要解释「为什么是这个 executor、这个 target、这个模型档与这个 fallback」时读。本页是稳定路由合同的入口；从主 skill 到这里 drill 一次，就应能完成整条派发记录。只有要研究并行机制、容量动作或命令语法时，才继续打开末尾列出的 owner。

## 目录

- [一条不可换序的路由链](#一条不可换序的路由链)
- [任务形状决定 executor](#任务形状决定-executor)
- [executor 不等于 target surface](#executor-不等于-target-surface)
- [workflow 是规划语义，不保证同名 runtime](#workflow-是规划语义不保证同名-runtime)
- [确定 effect floor](#确定-effect-floor)
- [做 exact qualification](#做-exact-qualification)
- [同档排序与 fallback](#同档排序与-fallback)
- [拿到真实 handle 才算派发](#拿到真实-handle-才算派发)
- [终端态之后做端点验收](#终端态之后做端点验收)
- [权威 owner 地图](#权威-owner-地图)

## 一条不可换序的路由链

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

这不是可交换的清单。先看品牌再猜任务档，会让偏好替代能力门；先排名再做资格核验，会把 `candidate` 偷换成可派发 target；先写 `in_flight` 再找 handle，会制造幽灵任务；把 agent terminal 当 task done，会绕过验收。任一承重证据是 unknown、stale、conflicting 或 deny，就停在对应硬门，不用感觉补值。

你的 routing record 至少保留这些字段，字段怎么写入 board 则只查 `using-ccm`：

```yaml
task_shape: <terminal-leaf | deterministic-sub-dag | orchestration-only | user-decision | external-tracking>
executor: <subagent | workflow | master-orchestrator | user | external>
target_surface: <exact harness + surface>
effect_floor: <O | T1 | T2 | T3>
qualification: <evidence refs + freshness + unknown/blockers>
ranked_fallback: <qualified same-floor chain + rationale>
runtime_handle: <real recon-able handle>
endpoint_verdict: <artifact + checks + acceptance evidence>
```

## 任务形状决定 executor

先看责任与控制形状，再看数量。五个 executor 是跨 compaction 的规划语义：

| 任务形状 | executor | 你要守的边界 |
|---|---|---|
| 一条终端推理 / 实现链，能一次独立验收 | `subagent` | 默认把可外包实现交出去；叶子发现自己其实是 sub-DAG 时停止并返回 scope map，不自行 fan out |
| 多个叶子需要确定性 fan-out / join、共享 schema 或 stage | `workflow` | 它描述结构化多叶责任；是否有同名 runtime 另看下一节 |
| 调度、reconcile、端点验收、整合、replan | `master-orchestrator` | 只保留真正不可外包的指挥职责，不借此亲手实现或 review |
| 需要用户判断、授权或拍板 | `user` | 立即 surface；不依赖答案的 ready 工作仍照常派发 |
| session 外已有工作或事实源需要追踪 | `external` | 记录 issue、run、URL 或其它 tracking anchor；外部 closed 只是待验收信号 |

先辨认图的真实形状：只有下游会直接消费某个上游 artifact / hash 时才画依赖边；一条串行临界链不要为了“并行”强拆 fan-out，独立叶子也不要因预算紧而画假串行边。复杂图可用 work/span 或 `T₁/T∞` 辅助决定 lane 数；机制、escalation、隔离与 admission control 的深入判断见 [`dispatch.md`](dispatch.md#两个尺度上的-dataflow--为何这些高度是自相似的)。

派 dev worker 的 handoff 至少给齐：objective（含 acceptance / non-goals）、measurement、artifact、constraints、stop-or-restart、所需 skill pointers。非原子或不能一次验收的节点，再给一份已认可 spec，或先派 scoping；不要把未决架构偷偷交给实现 worker 猜。

## executor 不等于 target surface

`executor` 回答「谁以什么责任形状执行」，`target surface` 回答「在哪个可调用面真正启动」。它们正交：`subagent` 不等于当前 origin 的 subagent，`workflow` 也不等于某个固定工具名。当前 origin 只是指挥台，不是 worker pool 边界。

从全机 inventory 中选精确 `harness + surface`，先确认它确实可调用、能返回可 recon 的 handle、对目标 workspace 有所需权限，再比较任务适配度与容量。此 host 当前能用于发车或追踪的机制包括：kimi-code Task subagent / 后台 Bash 任务 / 外部 scheduler 或 CI job。目标 CLI 的真实调用形状只看本次解析出的 [using-ccm worker help](../../using-ccm/references/command-catalog.md#worker-help)；不要凭记忆复制 provider flags，也不要把 `ccm` 当成 model / effort 参数翻译层。

如果 worker 要写文件，派前还必须给它一棵独立工作树的绝对路径并验证写权限；多个并行 writer 不共享同一路径。跨 harness 的同步 wrapper 要放进当前 origin 可追踪的后台 terminal / shell / session，真正的后台 handle 来自外层机制。

## workflow 是规划语义，不保证同名 runtime

`executor=workflow` 可以跨 host 保留：它表示一个节点拥有结构化多叶、fan-out / join 或 stage 化责任。它不自行承诺当前 host 存在名为 `Workflow` 的 runtime，也不授权你调用别的 host 的 API。

当前 kimi-code adapter **不支持 Claude Code Workflow runtime**。你仍可用 `executor=workflow` 表达结构化多叶的 planning 责任，但发车时要把叶子映射成 kimi-code Task、后台 Bash 或独立 board tasks，并分别记录真实 handle；不要调用或声称调用 `Workflow`、`agent()`、`parallel()`、`pipeline()`。

无论 host 怎样实现，最终都要落到真实可调用机制与真实 handle；只在计划里写了 `workflow`，不算发车。需要学习具体 workflow 脚本语法时才调用 `authoring-workflows`；若当前 adapter 明示 runtime unsupported，就按本节的 host-native 映射执行，不把脚本语义冒充可用工具。

## 确定 effect floor

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

统一模型事实与证据分层从 `pacing-and-estimation` 的模型事实页读取；selected-target 的 surface / model / quota / binding 解释只按 [pacing-and-estimation 目标事实口径](../../pacing-and-estimation/references/cross-harness-target-facts.md)。这些页面拥有动态事实，你不要在本页或 board 复制 provider 型号、窗口、价格与 quota catalog。精确查询和写入语法查 `using-ccm` skill 的 `references/command-catalog.md`。

任一硬门没有证据，就把候选标为 `insufficient` 并换另一个候选；如果没有候选满足 floor，就阻塞、重切任务或 surface 给用户，不把未知包装成 fallback。

## 同档排序与 fallback

只对已经通过 exact qualification、且满足同一 effect floor 的候选排序：

1. 先比较 cost、quota headroom、latency、context fit、task affinity 与 integration cost。
2. 只有基础分进入声明过的等价带，且社区证据有 provenance、TTL、confidence、contradictions 与衰减时，才让 taste 做有界 tie-break；stale / mixed / unknown 不加分。
3. fallback 只沿同档、已准入、非 `never_on` 的候选链移动。policy、security、permission、workspace、payer、retention 或 acceptance failure 不是“换个模型继续猜”的理由，必须停下重规划或 surface。

容量紧时先在同档换成本更低或余量更足的已认证 target，再降 WIP、推迟 high-float 工作、等待 reset 或缩 scope；不能直接降低原任务 floor。复杂性 / 风险 / duration 的深化判断与容量动作顺序见 [`model-allocation.md`](model-allocation.md#容量收紧时按顺序决策)。

## 拿到真实 handle 才算派发

你可以先登记一个 `starting` runtime actor，但只有真实机制成功返回可 recon handle 后，才能把它 bind 到 agent、link 到 task，再让普通 task 进入 `in_flight`。没有 handle 或 link 的 `in_flight` 是幽灵任务；spawn 失败要收掉 `starting` 登记。

精确 command / field / status verb 只查 `using-ccm` skill 的 `references/command-catalog.md`，不要从本文复制一套命令表。派后立即在 routing record 留下 agent、task、attempt 的关联与 handle provenance；三者可关联，不能合并成一个状态。

## 终端态之后做端点验收

runtime terminal 只说明 child process 或 agent 停了，不说明父 task 完成。runtime 一旦停止，无论 artifact 后续能否通过验收，都先终结 agent 登记（terminalize）并记录它的实际 outcome；不要让已停止的 runtime 因父 task 尚未验收而变成 zombie running agent。这个 runtime 生命周期更新不是 task verdict。

然后你在自己的端点收割 artifact，并独立核对 diff、tests、acceptance、必要的全局 contract 与 content hash；高杠杆或 correctness-critical 结果再加异构族系第二视角。只有证据通过，才把 task 标成 done / verified。验收失败时 task 保持 active，再 retry 或 replan；也可按证据 supersede 或 surface，但不静默放行。

external issue closed、CI green、空 review 与 worker 自报成功都只是验收输入。完整验收与续跑合同见 [`resume-verify.md`](resume-verify.md#3-端点验收--唯一可靠的正确性点)。

## 权威 owner 地图

每个承重不变量只有一个 owner；其它文档只留一句摘要和精确指针：

| 关切 | 权威 owner | 何时再 drill |
|---|---|---|
| 八段路由顺序、executor / target 正交、effect floor 表、资格硬门、同档 fallback、handle gate、terminal ≠ done | **本页** | 每次派发只需从主 skill 直达本页一次 |
| dataflow / T₁/T∞、host 后台机制展开、parallel vs pipeline、escalation、writer 隔离、admission、liveness | [`dispatch.md`](dispatch.md) | 任务形状或并行机制不平凡时 |
| 复杂性 / 风险 / duration 的深化判断，以及容量收紧后的 owner 动作 | [`model-allocation.md`](model-allocation.md) | floor 边界或容量动作需要解释时 |
| 动态 provider / model / quota 事实、证据层级、freshness 与 selected-target binding | `pacing-and-estimation`；入口为 [pacing-and-estimation 目标事实口径](../../pacing-and-estimation/references/cross-harness-target-facts.md) | 读取或解释当前事实时；不要把 catalog 抄回这里 |
| `ccm` flags、JSON、board 字段与生命周期 verb | `using-ccm` skill 的 `references/command-catalog.md` | 真正敲命令或写 board 时 |
| artifact、diff、tests、hash 与异构第二视角 | [`resume-verify.md`](resume-verify.md) | runtime terminal 后收口 task 时 |
