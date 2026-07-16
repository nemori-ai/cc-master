# Cross-harness model role and allocation policy

> 状态：**方案草案；只定义统一政策与实施切片，不声明 runtime 已实现**
> 日期：2026-07-16 UTC
> 范围：任意 supported origin 中的 master orchestrator，面向全机可用 harness / surface 的模型角色认证、任务亲和度、任务分配、ample/tight fallback 与异构 review
> 非范围：本文不修改 `@ccm/engine` schema、不把候选模型写成 live entitlement、不授权付费 API 调用或自动换号，也不替代 provider CLI 当次真实 help / catalog

## 1. 结论

本项目需要在现有 `economy / balanced / frontier` 之上建立一条**正交的角色轴**，而不是增加一个更贵的价格档：

- **`role_grade=O`**：能够承担系统边界、架构、方案、规格、任务分解、资源配置和高风险仲裁的模型资格；它是一项按 `model × surface × effort × harness/client version` 认证的角色，不是厂商宣传词或单项 benchmark 排名。
- **`role_grade=T1`**：在完整 spec、plan、acceptance 和测试仪器下，高保真执行实现的默认档，也是常规异族 review 的最低档；绝大多数实现优先使用这一档，而不是默认消耗 `O`。
- **`role_grade=T2`**：仓库代码只读研究、web primary-source gathering 与 grounded summarize 的默认档；不承担常规 review。
- **`role_grade=T3`**：格式化、确定性提取、测试重跑、机械迁移等有强机器闸的叶子；它不是本轮用户政策的承重档，只作为 tight posture 的最低成本补充。

`role_grade` 的合法值只有 `O | T1 | T2 | T3`。review、frontend、test、architecture 等是任务 capability/taxonomy，不再生成 `review-grade`、`implementation-grade` 等第二套档位词汇。

四档表达的是**该运行配置已被本项目证明能承担什么角色**。价格、速度、通用 benchmark、厂商 family tier 仍是事实输入，不能直接代替角色认证。

在这两条轴之外，再引入第三条、仅用于合格候选内排序的软信号：**`task_affinity / taste`（任务亲和度 / 工作品味）**。三条轴严格分工：

1. **能力 / effect floor** 回答“能不能可靠完成”；
2. **价格 / quota / latency / admission** 回答“此刻是否值得且允许调用”；
3. **任务亲和度 / taste** 只回答“都已合格的候选里，谁更像是这类工作的好选择”。

亲和度不得让一个未通过 effect floor、live availability、quota、permission、payer 或付费授权硬门的模型获得准入，也不得把社区“好用”传闻升格为 `certified`。

统一默认政策是：

| 工作类型 | 默认 executor / 角色档 | 关键边界 |
| --- | --- | --- |
| 系统、架构、方案、规格设计 | `master-orchestrator`，或 `subagent` + `O` | 设计若是主线编排判断、HITL/全局上下文不可外包，executor 为 master；可独立验收的设计研究可交 `O` subagent |
| 实现 | `subagent` + `T1` | 完整 spec/plan/acceptance 是降到 T1 的前提；规格缺口、frontier uncertainty 或连续失败先回到 O 修设计，不靠盲目升档掩盖 |
| 常规 review | 不同模型家族的 `subagent` + `role_grade=T1` | 异族优先；review 是观测，不替代 master 的端点验收；明显弱于 producer 时降低 finding 先验并逐条复核 |
| 安全 / 架构 / adversarial / 不可逆高风险 review | 不同家族的 `subagent` + `O` | 只对高杠杆节点使用，避免把 O 变成所有 diff 的昂贵默认 reviewer |
| 仓库代码研究、web search / summarize 等只读调研 | `subagent` + `T2` | 只读权限、引用与 provenance 是 effect floor 的一部分；事实新鲜度不能靠更强模型补齐 |

这条政策先按角色选 effect floor，再在所有 harness 的合格候选中比较质量、成本、额度、上下文搬运和启动开销；不得先按 origin 或品牌筛选。

## 2. 现状审计与 gap

### 2.1 已有的正确地基

当前仓库已有四块可复用地基：

1. [`master-orchestrator-guide/references/model-allocation.md`](../plugin/src/skills/master-orchestrator-guide/canonical/references/model-allocation.md) 已要求同时看复杂性、不确定性/风险和 duration，并把具体型号交给 fresh provider facts 与 live admission。
2. [`pacing-and-estimation`](../plugin/src/skills/pacing-and-estimation/canonical/SKILL.md) 已把事实消费与 master 决策分开；`ccm provider facts <provider> --json` 会返回来源、有效期、unknown 和自动选择 blocker。
3. [`using-ccm` board model guide §C.5](../plugin/src/skills/using-ccm/canonical/references/board-model-guide.md) 已有 opt-in `task.planning` / `task.routing` 合同：任务画像与候选链分离，candidate 显式带 `harness/provider/surface/model/effort/capabilities/effect_floors_met`，ample/tight 链与 fail-closed fallback 已存在。
4. [`resume-verify.md`](../plugin/src/skills/master-orchestrator-guide/canonical/references/resume-verify.md) 已明确异构族系第二视角、空审不通过和弱 reviewer 审强 producer 的不对称收益。

因此无需新增 executor enum，也无需新造第九个 runtime skill。主要缺口是角色语义、模型事实和现有 skill 的职责落点没有闭合。

### 2.2 当前主要偏差

| Gap | 当前表现 | 风险 / 应改方向 |
| --- | --- | --- |
| 通用 tier 与角色资格混为一谈 | registry 只有 `economy / balanced / frontier`；Fable 5 甚至被写成 `economy`，但 Anthropic 将其定位为最困难、长程、可跨阶段规划和委派的模型 | 价格/通用 tier 不能承载 orchestrator 资格；增加正交 role certification，并修正事实 registry 的语义 |
| “临界路径用强模型”过粗 | 主指导多处把最强模型压临界路径，高风险实现也默认 frontier | 临界性提高失败代价，但不自动要求 O；先判工作角色和 effect floor，完整规格下实现默认 T1 |
| 设计与实现没有明确分层 | 复杂实现、架构仲裁、端点验收落在同一 `frontier` 桶 | O 用于形成/修正规格与高风险仲裁；T1 用于按规格实现；端点验收仍是 master 职责 |
| review 只有“异族”原则，没有角色档 policy | 已要求不同 family，却没定义 routine 与 security/architecture/adversarial 的不同 reviewer floor | routine review 默认异族 `role_grade=T1`；高风险 review 使用异族 `role_grade=O` |
| origin-local overlay 限制全局视角 | 三个 adapter 分别只描述当前 origin 的模型档与用量 | target 模型事实与角色 policy 必须三 origin 共享；仅 origin-native launch/completion/hook 机制保留 host-specific |
| Cursor 双路线 / payer 未完整建模 | ccm facts 只登记 first-party Auto/Composer/Grok；本机 `cursor-agent --list-models` 还能看到 Fable 5 与 GPT-5.6 Sol，但当前 registry 不证明它们的 payer、quota 或 automatic eligibility | first-party 与 **Cursor Agent third-party-model route, payer unknown** 分开；后者只能在 payer/billing/policy 显式授权后进入链，绝不作 silent fallback |
| official facts 被误当 live admission | `fresh` snapshot 仍有 entitlement/quota/transport blocker | 角色认证、catalog、entitlement、quota、exact selector、transport admission 缺一不可；unknown 保持 unknown |
| 缺少本项目角色 eval | 官方 benchmark 能证明广义能力，却不能证明遵守 cc-master 的 board/HITL/dispatch 纪律 | 建 `role_grade=O|T1|T2|T3` 本地 holdout eval；认证绑定 surface/effort/version，支持过期与撤销 |
| 缺少“同档模型更适合哪类任务”的可维护信号 | 通用 benchmark 与厂商定位很难解释 frontend、单测、架构、大量实现、review 等实际工作中的差异 | 建独立 task-affinity 软信号 registry；一手实践需带来源、样本、矛盾与衰减，且只能在通过硬门的候选中排序 |

## 3. 模型事实与当前候选状态

### 3.1 证据等级

模型进入 route chain 要依次过四层，前一层不能替代后一层：

1. **官方能力事实**：厂商定位、价格、benchmark、产品 availability。
2. **本机 catalog 事实**：实际安装 CLI 的 version/help/model list，证明 selector 当下可见。
3. **live admission 事实**：当前账号 entitlement、payer/pool、quota、exact selector、permission、transport 均与 selected target 绑定。
4. **cc-master 角色认证**：在本项目 holdout eval 上证明该 `model × surface × effort × version` 满足指定 `role_grade=O|T1|T2|T3`。

官方“旗舰 / 最智能 / agentic”只支持把模型列为 `candidate`；只有第四层可以写 `certified`。认证状态应是：

```text
candidate → certified → expired | revoked
      └──────────────→ rejected
```

### 3.2 用户指定的 O 候选核验

| Harness / target surface | 用户指定候选 | 当前可证明事实 | 当前政策状态 |
| --- | --- | --- | --- |
| Claude Code CLI | Claude Fable 5 | Anthropic 官方称其适合最困难、长程、异步工作，可在 agent harness 中跨阶段规划、委派 sub-agents、检查自身工作；本机 `claude --help` 接受 `fable` / `claude-fable-5` selector。Fable 可能依赖 credits/plan，且官方说明部分安全领域会 fallback、使用 Fable 需要 30 天 retention | **O candidate**；必须补 live entitlement、quota、exact admission 和本项目 O eval；安全/隐私敏感任务先检查 fallback 与 retention |
| Codex CLI | GPT-5.6 Sol | OpenAI 官方将 Sol 定位为 flagship / complex reasoning and coding；GA 页给出 Coding Agent Index、SWE-Bench Pro、DeepSWE、Terminal-Bench 2.1 等结果，并说明 Codex 可选 Sol/Terra/Luna 与 effort；本机 Codex cache/config 可见 `gpt-5.6-sol` | **O candidate**；需当前账号 live admission 与 O eval；`max/ultra` 是 effort/topology，不是新的 model role |
| Cursor first-party / Cursor Agent CLI | Cursor Grok 4.5 | Cursor 官方称其为最智能模型，覆盖困难长程工具任务，并明确属于 first-party model pool、可用于 CLI；本机 `cursor-agent --list-models` 可见 low/medium/high 与 fast selectors | **O candidate**；先限定 `cursor-agent-cli`；exact selector、first-party payer、quota 与 O eval 全部通过后才 certified |
| Cursor IDE native Task | Cursor Grok 4.5 | 官方声明覆盖 desktop，但当前 ccm facts 仍把 IDE task catalog/selector acceptance 列为 unknown | **unknown candidate**；不得用 CLI catalog 补 IDE admission |
| Cursor Agent third-party-model route, payer unknown | Claude Fable 5 | 本机 Cursor Agent catalog 可见多个 Fable selector，并标注 `NO ZDR`；当前 ccm registry 未证明该路线的 payer/quota | **user-policy candidate, runtime unsupported/unknown**；要有显式 payer/billing 授权、data-retention 允许、quota 与 admission，永不自动 fallback |
| Cursor Agent third-party-model route, payer unknown | GPT-5.6 Sol | 本机 Cursor Agent catalog 可见多个 Sol selector；当前 ccm registry 未证明该 selector 的 payer/quota/automatic eligibility | **user-policy candidate, runtime unsupported/unknown**；同上，不从 first-party pool 事实推断第三方模型路线 |

这里统一称 **Cursor Agent third-party-model route, payer unknown**：它只说本机 catalog 中出现第三方模型 selector，不表示 ccm 已有稳定 surface/provider id，更不表示已证明计费归属。实施前应由 capability registry 给出正式 route/provider/payer id。

### 3.3 当前事实 registry 必须修正的内容

后续 implementation 至少要修正：

- Fable 5 不应继续以 `tier:"economy"` 表达；若 `tier` 是通用能力/价格混合字段，应先拆义再迁移，避免直接改成另一个含糊值。
- Claude Fable 的 source 应增加能力/benchmark主发布页，而不只引用 redeploy/availability 公告。
- Cursor provider facts 必须区分 `cursor-agent-cli:first-party`、`cursor-ide-plugin` 与 **Cursor Agent third-party-model route, payer unknown**；同品牌或同 identity 不共享 entitlement/quota。
- role certification 不写进易腐 prose；registry 需携带 `role_grade: O|T1|T2|T3`、`state`、`surface`、`min_effort`、`harness_version_range`、`eval_suite_revision`、`score/variance/seeds`、`certified_at/valid_until`、`blockers` 与 provenance。
- `ccm provider facts` 的官方事实与本地 role certification 可在同一 normalized read model 中呈现，但必须保留来源分层，不能把官方 benchmark 标成 cc-master eval。

## 4. 统一任务政策

### 4.1 系统、架构、方案与规格设计

满足以下任一即要求 `O` effect floor：跨模块/跨仓边界、公共协议/schema、不可逆迁移、权限/安全/配额 authority、运行时生命周期、多个消费者的架构权衡、需要形成可供 T1 执行的完整 spec/plan。

executor 选择：

- 判断依赖 master 独有的全图、HITL、board authority 或路线取舍：`executor=master-orchestrator`。
- 可形成独立 artifact、可由 master 验收：`executor=subagent`，routing candidate 必须 `effect_floors_met` 包含 `O`。
- 一个 O subagent 发现工作实为 sub-DAG 时仍不得自行提拔；按现有 escalation 合同返回 scope map，由 master 重切。

O 的产物至少包括：问题边界、非目标、约束/不变式、候选与 trade-off、决策、contracts、failure modes、migration/rollback、acceptance、仍需用户拍板的事项。缺这些内容时，不应把“用了 O”当成设计完成证据。

### 4.2 实现

实现默认 `T1`，前提是 task 已有：

- 清晰 spec 与 plan；
- 可机械或端点验证的 acceptance；
- 输入 pin / 影响范围 / non-goals；
- 适当测试仪器与权限边界；
- 对 cross-harness task，完整 planning/routing candidate 与真实 target facts。

下列情况不应直接把实现升到 O 继续硬做：规格互相矛盾、关键 invariant 缺失、需要决定新 architecture、连续失败显示方向错误。正确动作是停实现、回到 O 设计/修约，再由 T1 继续。只有任务本身不可拆且 frontier novelty 与实现动作不可分时，O 才可作为 implementation candidate，并记录理由。

### 4.3 常规 review

常规 review 默认选择与 producer **不同 family** 的 `role_grade=T1`。review prompt 只给 diff、acceptance、相关 contract 与必要上下文，不夹带 producer/master 的结论。

模型档不是 review authority：

- reviewer 明显弱于 producer 时，finding 的先验降低但仍逐条复核；
- `APPROVE`、空 review 或 provider exit 0 都不自动令 task done；
- acceptance failure 不在 fallback 允许集合，必须 replan/rework，不能换模型重复抽样到绿。

### 4.4 安全、架构与 adversarial review

以下节点使用异族 O：权限/credential/隔离、更新/安装/rollback、跨 session durability、进程生命周期、配额扣费与账户 mutation、公开 schema/协议、安全边界、不可逆数据迁移、用户明确标为 adversarial 的关键检查。

这类 review 的目标是对抗 producer 的盲区，不是再写一份设计。每轮要有保险丝；找不到新信息且 acceptance 已闭合时停止，避免无限 refine。

### 4.5 只读仓库研究与 web research / summarize

默认使用 T2，并把能力 floor 写成“只读研究 + 可追溯来源”，而不是只写“便宜模型”：

- repository research 禁止写工作树；产出文件/符号/行号、结论与 unknown；
- web research 优先 primary/official sources；产出 URL、retrieved_at、摘录边界、冲突与时效；
- summarize 不把来源没有说的推断伪装成事实；
- 大量机械抓取/去重可降 T3，最终综合仍由 T2；高风险领域研究或需形成架构判断时升 O，而不是让 T2 越权作结论。

## 5. ample / tight chains 与 fallback

### 5.1 不降 effect floor

配额紧张只改变**同一 effect floor 内的候选顺序、effort、WIP 与发车时点**，不自动降低任务需要的角色资格：

| 工作 | `ample` 默认链 | `tight` 默认链 |
| --- | --- | --- |
| 设计 / 规格 | 异构 O 候选按任务适配、质量、上下文成本排序 | 最便宜的已认证 O；无 O headroom 就缩 scope、延后或 surface 用户，不降 T1 假装完成 |
| 实现 | T1 中质量优先，再按 harness headroom 与集成成本 | T1 中成本/配额优先；仅对强机械闸、低风险叶子允许已认证 T2 候选 |
| 常规 review | 异族 `role_grade=T1` | 保留异族要求；可推迟非临界 review，不用 T2 或同族低档冒充第二视角 |
| 高风险 review | 异族 O | 保留异族 O；无容量则阻塞下游 gate，不静默降级 |
| 只读研究 | T2；并行多个独立 source lane | T2 成本优先，机械提取可 T3；减少 lane/范围而非牺牲 provenance |

`effort` 与 role 正交。相同 family 的 low/medium/high/max 只有在 role eval 证明最低 effort 仍过 floor 时，才可作为 tight chain 的降本动作；`fast` 主要改变延迟/credits 消耗，不自动属于低成本链；`ultra` 是多-agent topology，不记录成 leaf role/tier。

### 5.2 Cursor Agent third-party-model route 的额外约束

Cursor first-party Grok 与 Cursor catalog 中的 Fable/Sol 不得放在同一个未区分 payer 的 fallback chain。后者统一标为 **Cursor Agent third-party-model route, payer unknown**，且必须额外要求：

- 明确 route/provider/payer，不再使用 `payer unknown`；
- 用户或 board policy 对本次额外计费已有明确授权；
- 该 payer 的 quota / on-demand 状态 fresh 且 ample；
- data retention / ZDR、workspace 与 permission 满足任务要求；
- `fallback.never_on` 继续包含 policy/security/permission/workspace/acceptance failure。

在 `tight` posture 中，未经新的明确授权不得从 first-party 自动溢出该第三方模型路线；这与“模型具备 `role_grade=O` 能力”完全正交。

## 6. board / executor / routing 落点

不新增 executor 值。`executor` 只回答“责任归谁”；target harness/model/role 放在 planning/routing：

| 语义 | 现有落点 | 建议规范值 / 用法 |
| --- | --- | --- |
| 任务需要的角色 | `planning.quality.effect_floor` | 值只能是 `O | T1 | T2 | T3`；该值就是 `role_grade` |
| 工作能力 | `planning.capabilities.required/preferred/forbidden` | `system-design`、`architecture-reasoning`、`spec-authoring`、`implementation-from-spec`、`heterogeneous-review`、`security-adversarial-review`、`read-only-repository-research`、`primary-source-web-research` |
| 任务难度/风险 | `planning.dimensions` | 继续使用七维；role policy 是由它们与工作类型导出的判断，不另造 `complexity` 单字段 |
| 配额姿态 | `planning.budget.posture` | `ample` / `tight`；不改变 effect floor |
| 候选模型 | `routing.policy.candidates[]` | 精确 `harness/provider/surface/model/effort`；`effect_floors_met[]` 只包含经未过期认证的 `O | T1 | T2 | T3` |
| 充足/紧张链 | `routing.policy.chains.ample/tight` | 只引用已显式声明且已 admission 的 candidate id；同 harness fallback 也必须显式 |
| 最终选择 | `routing.selected` / attempts | 记录 role certification revision、target facts revision 与 qualification evidence；没有 accountable handle 不进 `in_flight` |

`master-orchestrator` executor 不需要 routing candidate；但若它承担一个 O 设计节点，board 应在 acceptance/artifact 中明确其设计交付物。`subagent` 设计节点则必须通过 O candidate 的 effect floor。

当前 `ccm worker run` 仍是显式 raw wrapper、不会自动读取 routing policy 或 fallback。实施 skill policy 时必须继续诚实描述该边界；不能因为 board 已写 ample/tight 链就宣称 runtime 已自动执行。

## 7. skill portfolio 落点

### 7.1 Counterfactual Probe

候选“新建一个 `model-role-policy` skill”的评分：

| 维 | 评分 | 证据 |
| --- | --- | --- |
| D1 audience-plane | 1 | 受众是运行中的 master orchestrator，属于分发用户面 |
| D2 bounded-context | 0 | 候选同时跨“事实消费、编排决策、ccm 写法、DAG 切分”四个已有 bounded context |
| D3 Probe A/B | A: strong；B: strong | agent 缺动态跨 provider role facts；也会默认把贵/强模型等同 O、让 O 做全部实现或在 tight 时静默降 floor |
| Verdict | **不新建；按职责拆回现有 skills** | 虽有增量与覆写价值，但 D2 不通过；建第九 skill 会直接制造红线 3 重叠 |

### 7.2 现有 skill 的唯一职责

| Skill | 应承载 | 不应承载 |
| --- | --- | --- |
| `master-orchestrator-guide` | `role_grade=O|T1|T2|T3` 任务角色判断；设计/实现/review/research/机械任务默认 policy；异族 review；ample/tight 不降 floor；把 task affinity 仅作为合格候选的有界 tie-break；最终 route judgment | provider selector 表、价格/benchmark/社区帖第二份拷贝、CLI exact flags |
| `pacing-and-estimation` | 读取全机 provider facts、quota、角色认证、freshness/unknown/relative cost；读取亲和度的来源、时效、矛盾和不确定性；把事实与软信号分层整理成 advisory | 决定 executor、route、WIP、是否发车；把 affinity 伪装成能力认证 |
| `using-ccm` | `provider facts` / inventory / usage / quota / worker help 的真实命令；planning/routing 字段与 writers；查询 affinity advisory 及 evidence refs 的操作面 | 宣布哪个角色该做哪类任务、维护品牌偏好或亲和度内容 |
| `slicing-goals-into-dags` | 切片时识别“设计 spine”与可按完整规格实现的薄片；为 frontend、unit-test、architecture、implementation、review、code/web research 等稳定任务 taxonomy 产生 planning profile | 给具体模型分档、复制 role/affinity registry 或 schema |

`engineering-with-craft` 继续定义设计/实现/测试内容应长什么样；`dev-as-ml-loop` 继续定义单任务优化循环与 eval 心智。它们不是模型路由 policy 的落点。

## 8. Task affinity / taste 软信号

### 8.1 定位与硬边界

`task_affinity` 表达模型在特定工作形态上的稳定偏好，例如“更擅长权衡架构”、“长 checklist 实现跟进更稳”、“review 召回高但噪声大”。它是可反驳、可衰减的统计性假设，不是模型人格、品牌标签或永久定论。

路由必须先过硬门，后用软信号：

```text
all discovered targets
  → effect floor / role certification
  → exact surface + selector + version admission
  → entitlement + quota + permission + workspace
  → payer + paid-use + retention authorization
  → eligible candidates
  → project eval / accepted production outcomes
  → cost, latency, headroom, context-transfer cost
  → bounded task-affinity tie-break
  → selected target
```

因此：

- affinity 不参与 `effect_floors_met`、`certified`、`eligible_for_automatic_selection` 的生成；
- affinity 不得跨越用户付费授权、数据保留、安全、permission、workspace 或 quota hard deny；
- 项目自有 holdout eval 与经端点验收的生产 outcome 始终高于社区 taste；两者冲突时降低社区信号权重，而不“少数服从帖子”；
- affinity 调整必须有上限：只允许在同一角色档、综合基础分落入预设等价带的候选间调整先后，不能让一个项目 eval 明显更差的模型跨带超车。

### 8.2 稳定任务 taxonomy

亲和度必须挂在稳定 task taxonomy，不挂“适合写代码”这类过宽标签。第一版最小 taxonomy 是：

| Taxonomy | 任务边界 | 建议观测量 |
| --- | --- | --- |
| `frontend-ui-implementation` | 已有 design/acceptance 下的 UI 实现、样式与交互细节 | 视觉验收、交互正确性、设计忠实度、无障碍、返工次数 |
| `unit-test-authoring` | 针对已知 contract 的单元测试设计与实现 | 故障检出率、脆弱性、边界覆盖、误报、mutation score |
| `architecture-design` | 边界、协议、生命周期、权限、迁移与 trade-off | 不变式完整性、备选诚实性、failure modes、可实施性、后续返工 |
| `implementation-from-spec` | 按完整 spec/plan/acceptance 实现 | spec fidelity、一次通过率、scope drift、测试与集成成本 |
| `large-refactor` | 保持外部 contract 的大范围重构 | 行为等价性、遗漏、diff coherence、verifier 返工次数 |
| `code-review-recall` | 尽可能发现真问题的 review | 真问题 recall、高风险 false negative |
| `code-review-precision` | 给出可行且少噪声的 review | precision、重复/泛化 finding 比例、修复可操作性 |
| `repository-code-research` | 只读定位代码、contract、历史与影响面 | 引用正确性、覆盖、unknown 保真、无写入 |
| `web-primary-source-research` | 查找时效性事实并优先一手/官方来源 | source quality、freshness、冲突报告、引用忠实度 |
| `source-grounded-summarization` | 在来源边界内压缩、比较和摘要 | unsupported inference、覆盖、歧义保留、引用对齐 |

`review` 拆成 recall 和 precision，是因为当前外部实践已显示同一模型可能“抓得多”却“噪声也大”。把两者压成一个 taste 分会丢掉路由上最有用的信息。

### 8.3 来源 ledger、权重与衰减

社区亲和度优先收录能追溯到实际操作者的一手实践：有公开 workload/指标的开发者复盘、官方论坛中使用者自述、GitHub issue/discussion 中可复现或重复发生的报告。厂商托管但由具名外部操作者提供、且披露 workload/metric 的实践，可作为带 `low-confidence` 与 `promotional-selection-bias` 标记的 seed 入库；普通厂商自述仍只可用于官方能力事实，不作为“社区 taste”。搜索摘要、转述、无链接 KOL 结论不入库。

每条 ledger 必须保存：

- `url / author / published_at / retrieved_at`；
- `model / surface / effort / harness_or_client_version`，不明则显式 `unknown`；
- `task_taxonomy`、workload / repo / domain、样本数、comparator、观测 outcome；
- `signal: positive | negative | mixed`、方向分与 `confidence`；
- 可复现性、与本项目 surface 的转移限制、已知 `contradictions[]`；
- `ttl_days / valid_until / superseded_by`。

默认衰减建议：披露 workload 与量化指标的开发者比较为 60 天；有版本与可复现细节的 GitHub/forum 报告为 30 天；单用户主观事例为 14 天。这是 default，entry 可因样本质量收窄。目标模型、harness 或 system prompt 发生承重更新时，相关条目立即降为 stale，不等 TTL 自然到期。

聚合时保留正反两类 evidence，用时间衰减、样本质量、可复现性、surface 匹配度和来源独立性加权。相互矛盾不得被“多数票”抹平；应输出 `mixed / confidence lowered`，并把争议任务交给项目 eval 解决。

### 8.4 registry 与 normalized read model

亲和度应使用独立的 **task-affinity registry**，不写进 provider facts/model registry：后者是 model id、surface、availability、price、quota/admission 等尽量客观的事实面；前者是会衰减、相互矛盾且可能快速反转的经验信号。把它们混在一个 registry，会让“实际可用”和“有人偏爱”在代码上变得无法区分。

建议 schema 形状：

```json
{
  "schema": "ccm.task-affinity/v1",
  "revision": "...",
  "entries": [{
    "id": "...",
    "target": {
      "model_family": "...",
      "selector": "...",
      "surface": "...",
      "effort": "...",
      "harness_version_range": "..."
    },
    "task_taxonomy": "architecture-design",
    "signal": "positive",
    "direction": 0.45,
    "confidence": 0.6,
    "source": {
      "kind": "developer-public-retrospective",
      "url": "...",
      "author": "...",
      "published_at": "...",
      "retrieved_at": "..."
    },
    "sample": {
      "n": 1,
      "workload": "...",
      "comparator": "...",
      "outcome": "..."
    },
    "limitations": ["..."],
    "contradictions": ["entry-id"],
    "ttl_days": 30,
    "valid_until": "..."
  }]
}
```

`direction` 与 `confidence` 分开：强烈主观喜好可以方向强、但因 `n=1` 而信心低。聚合分由机器根据 ledger 派生，不允许人工直接写一个“模型善于 frontend = 0.9”的无来源数字。

ccm 可在 normalized read model 层联合 provider facts、role certification、project eval/production outcome 与 affinity digest，但 JSON 必须保留 `hard_facts / project_evidence / community_advisory` 分层和 evidence refs。命令面可以是独立 affinity query，或 provider facts 的明确 advisory 子树；无论最终命名如何，都不得让社区信号出现在 admission/eligibility 字段中。

### 8.5 board / skill 的消费方式

第一阶段不动 board narrow waist，也不强制每个 task 持久化社区证据。路由管线从 `planning.capabilities` 与 task artifact 归一到上述 taxonomy；先构造已通过硬门的 candidates，再向 affinity read model 查同 task 的当前 digest。最终 judgment/routing rationale 只需记录 registry revision、task taxonomy、被采用/忽略的 evidence refs 与原因；不把社区信号复制进每张 board。

skill 消费顺序是：

1. `slicing-goals-into-dags` 为任务形成稳定 taxonomy/capabilities，不选型号；
2. `pacing-and-estimation` 读取全机硬事实、项目证据和社区 advisory，显式标注 stale/unknown/mixed；
3. `master-orchestrator-guide` 要求 master 先过硬门，再把 affinity 作为有界 tie-break，并对高优先级 judgment call 留证；
4. `using-ccm` 只教真实 query 与 board/routing writer，不复制某模型“有品味”的内容。

### 8.6 当前可追溯的外部信号

下表只是候选发现 / tie-break seed，不是本项目认证。未找到可追溯一手实践的单元格明确保持 `unknown`，不用品牌定位补空。

| Model / taxonomy | 一手外部信号 | 当前判读 |
| --- | --- | --- |
| Fable 5 / `architecture-design` | CodeRabbit 开发者公开复盘认为 Fable 在 architectural judgment、planning taste 和 open-ended trade-offs 上更强 | 正向、中低信心；是外部生产评测，但不是 cc-master workload |
| GPT-5.6 Sol / `implementation-from-spec` 与 test repair | 同一复盘报告 Sol 在长程实现、test repair 与难 review 中 follow-through 较强 | 正向、中低信心；`test repair` 不自动推导 `unit-test-authoring` |
| GPT-5.6 Sol / `code-review-recall` | CodeRabbit 披露 Sol 在其 review workload 中 recall 增加 7.4pp，99 个样本通过 69 个，但产生 231 条 raw comments | recall 正向、precision 负向/混合；中等信心，不能跨 harness 直接比 headline denominator |
| Cursor Grok 4.5 / `large-refactor` | Cursor 官方论坛用户 Artemonim 报告：在 GPT-5.5 orchestrator 下用 Grok 4.5 High 作为主 subagent，重构 Python 项目并重写约 6k 行，verifier 促成后续修正 | 正向、低信心；`n=1`，且“需 verifier 返修”必须同时保留 |
| Fable 5 / 低层 systems / cyber-adjacent | Claude Code GitHub 用户 `gowy222` 报告 Fable 5 在 syscall/ABI、lock-free repo research 和 design/review 中三次被安全分类降级到 Opus | 负向 operational-affinity 风险、低到中信心；是未独立复现的用户报告，与官方广义 coding 能力定位并存，短 TTL |
| GPT-5.6 Sol / `frontend-ui-implementation` | OpenAI 发布页收录合作伙伴 Triple Whale 的七任务 frontend benchmark：其声称 GPT-5.6 在五分 rubric 上得 4.4，高于其报告的 GPT-5.5 与 Claude 4.8 | 正向、**低信心 seed**；来自供应商发布页精选 partner testimonial，有 promotional selection bias，样本/rubric 未由本项目复现 |
| 三个目标模型 / `frontend-ui-implementation` | 尚无条件对齐的独立社区比较证据 | **unknown**；上述 partner seed 不足以形成跨模型 affinity 结论，不从通用 coding benchmark 推断 |
| 三个目标模型 / `unit-test-authoring` | 现有证据只涉及 test repair，不足以证明测试设计品质 | **unknown** |
| 三个目标模型 / repository/web research 与 grounded summarize | 未找到能按本文 provenance/unknown 标准判读的比较 | **unknown**；应优先建本项目 T2-research eval |

## 9. 持续更新、benchmark 与 eval

### 9.1 registry 分层

建议形成三份可独立刷新、最终由 ccm normalized read model 汇合的数据：

1. **provider facts registry**：官方 model id/alias、surface、availability、价格、context、effort、benchmark、source URL、retrieved/valid time、unknown；静态 facts 永不自动授权 selection。
2. **cc-master role certification registry**：`role_grade: O|T1|T2|T3`、surface、effort、harness/client version、eval suite revision、seed 数、质量分布、cost/latency、认证/过期/撤销时间与 blocker。
3. **task-affinity registry**：按 task taxonomy 保存一手社区实践 ledger、方向、置信、矛盾和衰减；它永不参与 hard admission。

任何官方 model/selector、CLI major/minor behavior、system prompt、tool surface、effort 语义或安全 fallback 变化，都使受影响的 role certification 过期，直到回归 eval 通过。

### 9.2 角色 eval suite

| Suite | 主要测量 | 通过重点 |
| --- | --- | --- |
| O-orchestration | Goal Contract、需求缺口发现、DAG/依赖、架构 trade-off、HITL 边界、cross-harness route、失败恢复、停止条件 | 不是“写得长”，而是边界/不变式完整、无越权、可让 T1 执行、能收敛 |
| T1-implementation | spec fidelity、non-goal 守卫、测试、diff correctness、scope、一次通过率/返工成本 | 以完整规格为输入；不能让模型自行重写架构目标 |
| T1-review | finding precision/recall、contract misread、噪声率、异族盲区增益 | 分普通/并发/状态机/迁移，报告 producer×reviewer matrix |
| O-adversarial | security boundary、权限、secret、lifecycle、rollback、failure-mode coverage | 高风险 false negative floor；空审/泛泛建议不通过 |
| T2-research | source quality、引用正确性、覆盖、冲突/unknown 保真、只读纪律、摘要忠实性 | primary/official source 优先；禁止无来源推断 |

每个 suite 使用 holdout、多个 seeds 与固定 harness/tool contract；至少报告质量分布、失败类型、token/credits、latency、retry 后总成本。单次 headline score 不足以认证。官方 benchmark、社区/KOL 实践可作为候选发现和外部效度证据，不能直接写 `certified`。

### 9.3 生产校准

在不保存敏感 transcript 的前提下，记录 normalized outcome：task role、requested/resolved model、surface/effort/version、artifact acceptance、review findings 分类、重试数、duration/cost bucket。只有端点验收结果回馈 role policy；provider exit 0 不算成功标签。

当某 candidate 的 acceptance regression、retry/cost、security finding 或 model-mismatch 超阈值时，先降为 `expired/revoked` 并 fail closed，再调查；不要为维持可用链而降低 benchmark。

### 9.4 maintenance control plane 与资产归宿

模型、价格、benchmark、CLI selector 和社区实践都是易变事实，不能靠人偶尔修 skill prose 来保鲜。按 `distilling-lessons-into-assets` 的归宿判断，本能力的资产分工是：

| 内容性质 | 唯一归宿 | Why |
| --- | --- | --- |
| 项目当前认可的 model/surface/version/price/benchmark/provenance、role eval 和 affinity evidence | 进 git 跟踪的 ccm model-policy meta registry；本文保留 schema/policy 叙事 | 它们是项目专属、可过期的事实，需要 diff/review 与 provenance，不是 runtime skill 的永久判断力 |
| 抓取官方页、校验 schema/hash/TTL、生成候选 diff 和投影 attestation | repo scripts + GitHub Actions scheduled/manual routine | 输入确定后机制形状确定，应由机器重复执行，不需要新 persona |
| 如何分角色、读 unknown/stale、在合格候选间用 affinity、ample/tight 如何决策 | 现有 `master-orchestrator-guide`、`pacing-and-estimation`、`using-ccm`、`slicing-goals-into-dags` | 这是运行时需被反复触发的判断力，但不应复制具体动态值 |
| 本项目“动态事实不进 skill”的约束 | `AGENTS.md` 只留一句触发条件 + 指向 registry/本文的指针 | 让贡献者知道何时深读，却不制造第二 SSOT |

不为 maintenance 新建 runtime skill 或常驻 subagent。任务不需要独立 persona/工具权限，而确定性部分可由 script/routine 完成；为它新建角色只会增加 portfolio 和生命周期负担。

### 9.5 tracked meta registry 形状

建议把当前 `ccm/apps/cli/src/provider-model-facts.json` 演进为 ccm 包边界内的独立 tracked data plane（实施时可经迁移保留兼容 import）：

```text
ccm/data/model-policy/
  schemas/
    provider-facts.schema.json
    role-certifications.schema.json
    task-affinity.schema.json
  registries/
    provider-facts.json
    role-certifications.json
    task-affinity.json
  provenance/
    <source-id>.json
```

共享最小字段为 `schema/revision`、`source`、`observed_at`、`valid_until`、`model/model_family`、`surface`、`client_version_range`、`task_taxonomy`、`confidence`、`unknown`、`supersedes`。不同 registry 再加自己的承重字段：provider facts 加 price/benchmark/availability，role certification 加 suite/score/variance/seeds/state，affinity 加 signal/direction/sample/contradictions/decay。

`provenance/` 保存结构化来源摘要、content hash 与取证时间，不复制受版权保护的长文。registry entry 只用 stable `source_refs`。所有对易变事实的改动必须能通过 source URL/hash 与 git diff 审查；没有 provenance 的值只能写 `unknown`。

### 9.6 remote routine 与 machine-local probe 分离

两类证据不同源、不同权限，不能用同一 routine 伪装闭环：

| 管线 | 责任 | 产物 | 不得声称 |
| --- | --- | --- | --- |
| **remote evidence routine** | 查官方 model/price/lifecycle/benchmark 页，查优先级一手 developer/forum/GitHub 实践，检测新版本与来源内容 hash 变化 | 候选 issue 或 draft PR，含 structured diff、source refs、受影响 surface/role/taxonomy 与建议重跑 eval | 不证明本机已安装、当前账号 entitlement/quota、exact selector 可调用 |
| **machine-local surface probe** | 在目标机读实际 CLI version/help/model catalog/auth 与 target-bound admission；必要时在授权后 canary | 本机短 TTL evidence envelope，按 `surface + selector + version + account/payer` 绑定，不将 credential/账号私密信息提交 git | 不修改公共 benchmark/taste，不把“本机可见”推广为所有机器可用 |

remote routine 只有**提案权**：可开 issue/draft PR，不直接改生产 routing state，不 auto-merge，不因官方 headline 自动给新模型角色认证。任何承重改动须经独立 review，并按类型经过 project eval 和目标机 live admission；用于付费 API 的 route 仍需原有显式授权。

### 9.7 freshness 、失效策略与 cadence

| 证据类型 | 建议 cadence / TTL | stale 时的路由行为 |
| --- | --- | --- |
| 官方 lifecycle/model id/selector/surface/payer/retention 等承重事实 | remote 每周；发布前；发现厂商变更立即刷新；默认 TTL 7 天 | **fail closed** 于 automatic routing；保留手工查证路径 |
| 价格/计费单位 | remote 每周 + 付费 canary/发布前；TTL 7 天 | 对有金额/自动溢出风险的路由 **fail closed**；对已有固定包席且不影响授权的相对排序 fail soft，忽略 cost 优化 |
| 官方 benchmark / capability claim | remote 每月 + model release 触发；TTL 30 天 | **fail soft**：不再用于排序/候选推荐，不影响已有 live admission |
| role certification / 项目 eval | client/system-prompt/tool contract 变更或每月回归；validity 显式绑定版本范围 | 对所需 role floor **fail closed**，候选回到 `candidate/expired` |
| community task affinity | remote 每两周；条目按 14/30/60 天衰减 | **fail soft to neutral**：忽略 stale affinity，不阻断本已合格的候选 |
| machine-local catalog/auth/admission | 每次 CLI version 变化、登录/账号/payer 变化、临近 dispatch 按 driver TTL 刷新 | selector/entitlement/admission 为承重事实，**fail closed**；不用 remote registry 补证 |

额外触发点：任一 supported harness CLI 版本变化、provider 宣布 model lifecycle/计费改动、项目发布前、路由生产 outcome 显著回归，都不等定期时钟而立即开刷新候选。

owner 不是新 subagent：**ccm model-policy data owner** 负责 schema/provenance 与 routine 健康，**provider/surface code owner** 负责当地 probe 契约，**runtime skill owner** 只审消费语义与投影等价性。承重 registry PR 至少需一名不是提案人的 reviewer；不用 routine bot 自己批准自己。

### 9.8 generated provider guidance snapshot / attestation

`plugin/src/skills/provider-guidance-runtime.json` 继续是**派生 attestation**，不是第四份 facts registry。投影/发布管线从 tracked registry 读 revision/hash，校验 canonical skill 只包含“怎么查、怎么读 unknown/stale、怎么决策”的稳定契约，再生成：

- source registry path/schema/revision/content hash；
- generator version 与 `generated_at`；
- 各 host 投影中 provider-guidance 文件的 hash；
- 语义等价性与仅 origin-native 差异的校验结果。

attestation 不展开模型表、价格、benchmark 或 community taste 值。运行时 skill 通过已安装 ccm 查当前 normalized read model；ccm 缺失/返回 stale 时按上表显式 unknown 或降级，不从 plugin 内嵌 snapshot 偷偷复活旧事实。生成物与 registry 不同步时，projection/release check 必须失败。

## 10. 分阶段实施切片

按四个可独立集成、逐步扩面的纵向阶段推进；每阶段都同时贯通事实、查询、决策与可验证行为，不先横向铺完某一技术层：

1. **V0 — walking skeleton**：落一个最小 tracked registry，只收录 **1 个已核验 target**；提供 **1 个 ccm 只读 query** 返回它的事实、角色资格与 unknown/stale 状态；在 `master-orchestrator-guide` 提供 **1 个真实决策入口**；以 **1 个 board shadow-route fixture** 证明同一条路径能从任务输入走到可追溯 advice。全程不 spawn、不付费、不 enforcement，但这一薄片可独立集成和演示。
2. **V1 — 三 harness 能力与场景扩面**：把同一条纵向路径扩到 Claude Code、Codex、Cursor 三个 harness，补齐 O/T1/T2/T3 角色档和稳定 task taxonomy；接入 task affinity 的 provenance、TTL、contradiction 与有界 tie-break；同步 `pacing-and-estimation`、`using-ccm`、`slicing-goals-into-dags` 的消费/操作指导，并验证三 host 对 target 信息的统一视角。
3. **V2 — 可信维护闭环**：补 role eval 与版本绑定的认证/过期/撤销；remote routine 只产出候选 issue/draft PR，machine-local probe 独立验证 catalog/auth/admission；生成 registry/projection attestation，并用 fixture 证明 remote 事实不能替代 live admission、routine 不改 production routing 且不 auto-merge。
4. **V3 — 生产证明与最后执法**：在明确授权、合格主机与 payer 边界内做各 surface 的最小 canary，先 shadow 比较并校准 ample/tight 与 affinity cap；只有 registry、eval、read model、skill、route evidence 和 canary 全闭合后，才考虑把 effect-floor vocabulary 与 role-certification revision 变成 routing hard gate；legacy board 保持兼容。

## 11. 验收标准

本方案完整落地时应满足：

- 任意 origin 对同一 machine revision、同一 task profile 得到相同的适用 `role_grade` 判断与 selected-target 候选事实；差异只来自真实 origin-native launch/completion 能力。
- 设计任务不能被未认证 O candidate route；完整规格的普通实现不会默认烧 O。
- 常规 review 默认异族 T1；security/architecture/adversarial review 才默认异族 O。
- read-only research 默认 T2，且 provenance/unknown/只读权限进入 effect floor。
- `tight` 不降低 effect floor；无合格容量时缩范围、推迟或请求用户决策。
- Cursor first-party 与 third-party-model route 的 payer/配额/授权不混链；Fable 的 NO-ZDR/retention 约束可阻止不合格任务。
- 每个 selected candidate 可追溯到 official facts revision、live admission evidence 和未过期 role certification；任一承重 unknown 都 fail closed。
- community affinity 只在已过上述硬门、且项目 eval/生产 outcome 基础分相近的候选间调整先后；不能提升未认证、未授权或额度不足的 target。
- frontend、unit-test、architecture、implementation、review recall/precision、repository/web research 和 summarize 都有稳定 taxonomy；证据不足的单元格稳定输出 `unknown`，不从品牌或通用 benchmark 猜测。
- remote maintenance routine 只开候选 issue/draft PR，不改 production routing、不 auto-merge；承重改动经独立 review、project eval 和 machine-local admission 后才生效。
- stale lifecycle/selector/payer/role-certification/live-admission 在 automatic routing 上 fail closed；stale benchmark 与 community taste fail soft 为不参与排序。
- plugin runtime skills 只包含消费、unknown 与决策指导；具体模型/价格/benchmark/affinity 值只在 tracked registry。`provider-guidance-runtime.json` 只证明 registry/projection hash 和语义等价性。
- 三 host projection 不再各维护一份 target model policy；provider facts、role certification 与 task affinity registry 各自更新一次即可被所有 origin 消费。

## 12. Primary sources 与本机观测

### 官方来源

- OpenAI, [GPT-5.6: Frontier intelligence that scales with your ambition](https://openai.com/index/gpt-5-6/)：Sol/Terra/Luna 的定位、Codex/API availability、价格、effort/multi-agent 与公开 benchmark。
- OpenAI Developers, [Models](https://developers.openai.com/api/docs/models)：Sol 用于 complex reasoning/coding、Terra 平衡能力与成本、Luna 用于成本敏感高吞吐。
- Anthropic, [Claude Fable 5 and Claude Mythos 5](https://www.anthropic.com/news/claude-fable-5-mythos-5)：Fable 的长程 agentic/coding/knowledge-work 能力与评测叙事。
- Anthropic, [Claude Fable 5](https://www.anthropic.com/claude/fable)：agent harness 中跨阶段规划、委派 sub-agents、自检、价格、availability、retention 与安全 fallback。
- Anthropic, [Redeploying Fable 5](https://www.anthropic.com/news/redeploying-fable-5)：当前恢复 availability 与 credits/plan 条件。
- Cursor, [Introducing Grok 4.5](https://cursor.com/blog/grok-4-5)：first-party pool、CLI/desktop availability、长程工具任务、价格与 benchmark 限制说明。
- Cursor, [Composer 2.5](https://cursor.com/changelog/composer-2-5)：较低一档实现候选的 sustained work / instruction following 与价格事实。

### 一手社区 / 开发者实践

- Juan Pablo Flores & Gowtham Kishore Vijay, CodeRabbit, [GPT-5.6 Sol and Terra Benchmark](https://www.coderabbit.ai/blog/gpt-5-6-sol-and-terra-benchmark), 2026-07-09：公开 review workload 的比较、Sol 的 implementation/test-repair/review 观察，以及 Fable 的 architecture/planning taste 判读；不同 harness denominator 不可直接互比。
- Artemonim, Cursor Forum, [Share your Thoughts on Grok 4.5](https://forum.cursor.com/t/share-your-thoughts-on-grok-4-5/165160/8), 2026-07-08：Grok 4.5 High 作为 subagent 执行大范围 Python 重构的 `n=1` 自述，同时披露 verifier 促成返修。
- `gowy222`, anthropics/claude-code issue [#66728](https://github.com/anthropics/claude-code/issues/66728), 2026-06-10：Fable 5 在低层 systems/cyber-adjacent 任务中触发安全分类/降级的三次用户报告；尚未独立复现，只作短 TTL 负向 operational signal。

### 2026-07-16 本机零推理观测

- `ccm provider facts codex|claude-code|cursor --json`：三份 snapshot 均 fresh，但 `eligible_for_automatic_selection:false`，仍有 live entitlement/quota/transport blockers。
- `claude --version` = `2.1.209`；`claude --help` 明确接受 `fable` / `claude-fable-5`。
- `codex --version` = `0.144.4`；本机模型 cache/config 可见 `gpt-5.6-sol`。
- `cursor-agent --version` = `2026.07.09-a3815c0`；`--list-models` 可见 Cursor Grok 4.5 first-party selectors，以及 Fable 5 / GPT-5.6 Sol selectors。该 catalog 只证明 selector 可见，不证明 payer、quota、调用成功或自动准入；本轮没有发起任何 provider inference。
