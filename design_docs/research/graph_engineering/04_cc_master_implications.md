# Graph Engineering 对 cc-master 的影响：结构 substrate 已有，相邻执行/证据面仍是 partial

> 本文是静态仓内审计，不是 ADR、路线拍板或“测试刚刚全绿”的声明。外部依据见[社区与 Anthropic](01_community_and_anthropic_evidence.md)、[学术谱系](02_academic_landscape.md)和[工程分类](03_engineering_taxonomy.md)。

## 核心判断

cc-master 已不是“纯 loop 系统”，而是一个 **graph-aware control loop**。这个限定描述由当前 task-graph 结构基底承重，不表示执行/证据各 plane 已经闭环：

```text
Goal Contract
    ↓
task DAG + deps / declared qualification edges
    ↓
deps-ready set + CPM
    ↓
master hand-run selection/dispatch → verify → reconcile/replan

相邻但不能压成完整链路的 planes：
  agent registry/link       = bounded partial
  native-attempt ledger     = partial；live invoke unsupported
  delivery production gate = 仅显式 declared edges；strict 仅 read-only dry-run
  evidence/provenance       = 不完整；claim-level provenance 未闭环
```

当前强 substrate 负责表达 task、deps、部分 qualification、ready 与 CPM；registry、native attempt、delivery 和 evidence 只提供不同成熟度的相邻能力，不能把 generic agent link 冒充 native attempt，也不能把 attempt artifact 冒充完整 claim provenance。外层循环负责观察变化、reconcile、verify 和动态 replan。当前主要缺口是把若干由 master 手工维持的控制面动作升级为可查询、可模拟、可审计的机制，同时保留用户已定义的 master/HITL authority，而不是再引入一套 graph 名词或 UI。

## 审计证据优先级

```text
production code/test
  > accepted ADR
  > canonical runtime guide
  > current capability snapshot
  > historical spec/vision
```

主要仓内承重来源包括 [board model](../../../ccm/packages/engine/src/board-model.ts)、[graph core](../../../ccm/packages/engine/src/board-graph-core.ts)、[native attempt](../../../ccm/packages/engine/src/native-attempt.ts)、CLI 的 [task](../../../ccm/apps/cli/src/handlers/task.ts)/[goal](../../../ccm/apps/cli/src/handlers/goal.ts)/[agent](../../../ccm/apps/cli/src/handlers/agent.ts)/[cadence](../../../ccm/apps/cli/src/handlers/cadence.ts)/[watchdog](../../../ccm/apps/cli/src/handlers/watchdog.ts)/[provider](../../../ccm/apps/cli/src/handlers/provider.ts) handlers，以及 [Goal Contract guide](../../../plugin/src/skills/master-orchestrator-guide/canonical/references/goal-contract.md)、[resume/verify guide](../../../plugin/src/skills/master-orchestrator-guide/canonical/references/resume-verify.md)、[async HITL guide](../../../plugin/src/skills/master-orchestrator-guide/canonical/references/async-hitl.md)。

本轮未重新跑完整 tests；“已实现/部分实现”的判断来自 production surface、已存在 contract tests 与 accepted ADR 的交叉核对。

## 当前能力矩阵

| 能力 | 当前状态 | 证据强度 | 诚实边界 |
| --- | --- | --- | --- |
| Goal Contract | 实现 | 强：[ADR-035](../../../adrs/ADR-035-goal-contract-lifecycle.md)、goal handler、canonical guide | scope/Trace Test 仍需 master 的语义判断 |
| 静态 task DAG | 实现 | 强：[ADR-003](../../../adrs/ADR-003-board-narrow-waist.md)、[ADR-013](../../../adrs/ADR-013-board-v2-data-model-and-cli.md)、engine | board 主要是当前快照，不是完整事件历史 |
| deps/ready + qualification | deps/ready 实现；delivery qualification 为 declared opt-in | 强：[ADR-023](../../../adrs/ADR-023-deps-driven-gating-and-blocked-on-discriminator.md)、[ADR-036](../../../adrs/ADR-036-declared-delivery-dependency-truth.md)、graph core | production delivery gate 只作用于显式 declared edges；strict 仅 read-only dry-run，不能持久化或启用；strict-default 未获授权 |
| 动态 task add/remove/replan | 部分实现 | 强：task handler 与相应 tests | 无一等 `graph_revision`、原子 change set、diff/rollback |
| Ready set/dataflow dispatch | 部分实现 | 强：graph core/CLI；中：hand-run guide | ready 可机械计算；顶层 selection/dispatch 仍由 master 执行 |
| CPM/WIP/cadence | 部分实现 | 强：graph core、cadence handler/tests | WIP 多为 advisory；mixed/unit 权重不能报确定工期 |
| HITL/decision package | 部分实现 | 中强：async-HITL guide、board model、Stop ledger | package 完整性和用户授权不能完全自动证明 |
| Agent registry/liveness | 部分实现 | 强：agent handler/probe/tests | 登记完整性 warn-only；PID/mtime/legacy handle 证据有限 |
| Native-attempt ledger | 部分实现 | 混合：[native-attempt engine](../../../ccm/packages/engine/src/native-attempt.ts)、[ledger spec](../../../design_docs/2026-07-13-codex-native-attempt-ledger-spec.md)、red tests 与 [capability model](../../../design_docs/cross-harness-orchestration-capability-model.md) | dedicated ledger/writer 为 partial；live host-native invoke unsupported；generic agent registry link 不是 native attempt |
| Evidence/provenance | 部分实现 | 混合：attempt/artifact 合同与 canonical verification 方法论 | attempt/artifact evidence 在发展，claim→source/tool/decision provenance 未闭环 |
| Delivery qualification/true-done | declared opt-in 实现；strict 为 dry-run only | 强：[ADR-026](../../../adrs/ADR-026-done-true-semantics.md)、[ADR-036](../../../adrs/ADR-036-declared-delivery-dependency-truth.md)、tests | production gate 仅显式 declared edges；strict 不能持久化/启用，strict-default 未授权；terminal、task done、delivery 与 Goal acceptance 持续分层 |
| Cross-harness routing | 部分实现 | 强：[ADR-034](../../../adrs/ADR-034-additive-routed-task-contracts.md)、provider drivers；中：[capability model](../../../design_docs/cross-harness-orchestration-capability-model.md) | raw wrapper 已有；automatic route→admission→spawn 未闭环 |
| Watchdog/liveness | 部分实现 | 强：watchdog handler/tests、[ADR-011（由根文档引用）](../../../AGENTS.md) | 无通用 durable supervisor；host wakeup 能力不等价 |
| Graph visualization | 实现 | 强：viewer code/tests | read-only，不是 graph editor/runtime authority |
| 多 orchestrator 协调 | 部分实现 | 强：[ADR-017](../../../adrs/ADR-017-multi-orchestrator-coordination.md)、[ADR-032](../../../adrs/ADR-032-deterministic-pool-arbiter-and-notification-inbox.md)、engine/tests | deterministic advisory/arbiter 有限；无跨-board dependency/claim graph |

## 明确不支持：不能为叙事降格成“部分实现”

- Codex/Cursor dynamic Workflow API 当前是 unsupported adapter surface。
- Native-attempt writer 自动调用 host tool 未实现；[native-attempt spec](../../../design_docs/2026-07-13-codex-native-attempt-ledger-spec.md)把 live invoke 保持在边界外。
- `ccm agent` 不是自动 spawn/route/dispatch engine；它主要是登记、探测、读取操作面。
- Delivery strict 只是 read-only dry-run，不能持久化或启用；production gate 只对显式 declared edges 生效，strict-default 仍需用户另行批准。
- [run-store v2](../../../design_docs/2026-07-15-run-store-capability-v2-contract.md)仍是 capability contract/red-test 方向，不应写成 production durable supervisor。
- agent-teams、RemoteTrigger/云 scheduled routines 不是 portable floor；根 [AGENTS 红线](../../../AGENTS.md)明确限制。

Graph Engineering 叙事不能用来模糊 host capability 和 runtime authority 的事实边界。

## 四个尺度必须持续分开

| 尺度 | 当前 cc-master 对象 | Graph/loop 关系 |
| --- | --- | --- |
| 外层 orchestration loop | reconcile→ready selection→dispatch→verify→replan | graph control plane 的 hand-run scheduler |
| 任务内部 dev loop | proposal→measure→adjust→converge | executor plane；不能搬给 master 亲自执行 |
| Board task graph | tasks、deps、状态机、qualification、ready、CPM/WIP | 当前最强 graph semantics |
| Workflow/program graph | 可编译、可复用的局部 pipeline | 中层机制；不是顶层动态 orchestration 的 universal surface |

另需分开 task DAG、execution/attempt graph、evidence/provenance graph 与 coordination graph；以及 provider terminal、task done、delivery qualification 和 Goal acceptance。

## 真实缺口

### Graph lifecycle

1. **Revision 缺位**：task add/update/remove 可用，但没有一等 plan revision、change set、原子多节点 transaction、diff/rollback。
2. **Artifact invalidation 缺位**：新 dependency 或 input 变化后，缺统一规则决定哪些 artifacts/attempts 失效或可复用。
3. **Resume fence 不统一**：action hash、input fingerprint、dep pins 主要仍是方法论，没有跨任务机械闭环。
4. **History/replay 不一等**：board 偏当前快照；graph mutation 的历史、原因、validator 和 authorizer 不是统一 journal。

### Execution/admission

5. **顶层 scheduler 未闭环**：ready set 可计算，route/selection/admission/dispatch 仍需 master 手工协调。
6. **WIP/admission 多为 advisory**：缺对 claim/spawn 的普遍 hard gate；过早硬化又有 false block 风险。
7. **Durable run journal/lease/attach 未 production**：run-store v2 仍是未来能力合同。
8. **Registry/liveness 偏弱**：登记完整性 warn-only，handle/probe 不能代替完整 attempt lifecycle。

### Cross-harness/authority

9. **Transport 不等于 authority**：raw provider wrapper 已有，automatic route→reservation→claim/spawn transaction 未完成。
10. **Host 能力不等价**：Codex native-attempt live spawn 与 Codex/Cursor dynamic Workflow 不支持；wakeup/supervisor 也不等价。
11. **多 orchestrator 仅有限协调**：有资源/配额 arbiter/inbox，但没有跨 board work graph 或强 claim protocol。

### Evidence/measurement

12. **Claim-level provenance 不完整**：attempt/artifact evidence 在发展，但最终结论→来源/工具输出/decision 的可查询图仍弱。
13. **CPM 数据质量有限**：mixed/unit weight 使 critical path 只能 advisory。
14. **缺联合效果面板**：graph churn、recovery、quality、token、latency、human burden 与 variance 尚未形成统一评测。

## Preserve / Strengthen / Experiment / Reject

### Preserve：已有资产，不能被热词破坏

| 对象 | 为什么保留 | 证据强度 | 红线/用户边界 |
| --- | --- | --- | --- |
| Board narrow waist + `ccm` single writer | 保持 SSOT、hook 稳定和可审计写入 | 强：AGENTS、ADR-003、engine | 红线2；改 waist 必须用户拍板并同步 hooks/tests |
| Goal Contract 先于切图 | 防止高效优化错误目标 | 强：ADR-035、handler/guide | 现有纪律无需新增批准 |
| task/actor/attempt/delivery/Goal identity 分离 | 防 terminal=done 和 evidence 覆写；保留边界不等于各 plane 已闭环 | 混合/部分：[ADR-026](../../../adrs/ADR-026-done-true-semantics.md)、[ADR-036](../../../adrs/ADR-036-declared-delivery-dependency-truth.md)、agent registry/capability model、[native-attempt spec](../../../design_docs/2026-07-13-codex-native-attempt-ledger-spec.md) | 支撑 true-done 与身份分离；不得合并，不把 generic link 当 attempt |
| Qualification-aware ready set | 未 review/approval/delivery 的边不得误解锁 | 强：engine/ADR/tests | 维持 fail-closed，不需新授权 |
| Master/HITL authority | graph mutation/dispatch 仍有责任主体 | 方法论强、runtime 能力混合：canonical guide/AGENTS/capability model | 这是产品/authority 方向；任何权力下放须用户批准。只有方案迫使 master 亲自做单元实现或 review 时，才同时触发红线4 |
| Track A/B host honesty | 不把某 host 特性冒充 portable capability | 强：ADR-031/capability model | 红线5；不得用 graph 叙事改写支持边界 |

### Strengthen：沿现有语义补机械闭环

| 对象 | 推荐增量 | 证据/价值 | 风险与批准边界 |
| --- | --- | --- | --- |
| Plan revision/change set | 先放 flexible tier/read model，记录 diff、rationale、affected nodes、validator | 学术中强；直接补动态 replan 缺口 | 若扩 waist/状态机，触发红线2与用户设计批准 |
| Input fingerprint/dep pins | 把 resume-verify 的方法论做成可查询 fence | 中强；降低 stale action/replay | 不得绕 `ccm` writer；合同设计需单独审查 |
| Registry completeness/attempt links | orphan、terminal-without-evidence、task-without-attempt diagnostics | 强仓内缺口；支持 true-done | 升为 hard gate 前需 shadow false-positive 数据和批准 |
| Central execution/evidence read model | server-side join task/attempt/artifact/delivery/provenance | 强；前端保持零业务推理 | 只读低风险；不得暗含 writer authority |
| WIP/admission observability | 显示超限、reservation 与 backpressure 原因 | 中强；控制成本/并发 | shadow 无需；claim/spawn hard gate 需用户批准 |
| Evidence freshness/coverage | source/artifact/claim 关系及过期提示 | 学术中强；防 provenance laundering | 必须区分“有链”与“链支持 claim” |

### Experiment：只读/shadow、可证伪、可撤回

| 实验 | 允许输出 | 禁止动作 | 晋级前置 |
| --- | --- | --- | --- |
| Shadow next-node scheduler | 候选 task/model/worker + rationale | 写 board、claim、spawn | 与现有 ready/qualification parity；固定输入 deterministic |
| Graph rewrite proposal | revision diff、影响面、invalidation 建议 | 自动 add/rm/deps/update | 独立 validator、人工 baseline、rollback/kill switch |
| Route simulation | route chain、cost/quality/risk forecast | reservation、account switch、provider spawn | 跨 harness capability/live proof；unknown fail-closed |
| Artifact-quality gating | 早退/改路由建议 | 未授权终止或跳过验收 | calibrated judge、matched-budget 对照、false-negative 上限 |
| Partial-order mining | 从成功 attempts 推断候选可并行边 | 直接固化 dependency | trace diversity、domain validator、回放对照 |
| Graph health metrics | churn、stale evidence、orphan、recovery、ready drift | 改写执行 | 定义稳定、无前端业务推理 |

任何 Experiment 晋级至少要满足：固定输入 deterministic；与 ready/qualification constraint parity；no-write/no-spawn spy；unknown/bad data fail-closed；rationale 可解释；有人类 baseline；有 kill switch/rollback；provider success 不直接投影为 task done。

### Reject / Defer：当前证据不足或违反不变式

| 对象 | 裁决理由 | 红线/批准边界 |
| --- | --- | --- |
| 因热词把产品更名为 Graph Engineering | 社区术语不稳定，Anthropic 未采用，易制造过度 claim | 产品方向必须用户决定；当前拒绝 |
| 中央 autonomous scheduler 取代 master | 当前证据不足，且与现有 master/HITL authority 方向冲突，自动错误会扩大 | 当前拒绝；这是用户产品/authority 决策，不因名称自动构成红线4。若具体方案破坏 conductor/executor 分离、迫使 master 亲自实现/review，再按红线4拦截；若改 waist/portable floor，另触发2/5 |
| LLM 点对点协商成为 SSOT | 冲突、丢证据、不可审计；已有 arbiter/single writer 方向相反 | 破 narrow waist；必须拒绝 |
| 云 routine/agent-teams/单一 host Workflow 作 portable floor | capability 不等价，破 ship-anywhere | 红线5；不得默认启用 |
| Shadow advice 直接触发 fallback/spawn | advice→authority 越级，capability model 未授权 | 需独立 guarded design 与用户批准 |
| terminal/done 直接等同 Goal acceptance | 与 true-done、delivery、Goal Contract 直接冲突 | 永久反模式，不应接受 |
| 通用 graph DB/daemon 塞入 hooks | 破 hook runtime 与进程边界 | 红线1/5；图算法留 engine/CLI |

## 对六条红线的逐项影响

1. **Hooks runtime**：不能把 Python、graph DB client 或 npm/TS runtime 塞入 hooks。图算法应留在 `@ccm/engine`/`ccm`，plugin 经进程边界调用。
2. **Board narrow waist**：revision/provenance 并不天然要求扩 waist。先做 flexible-tier/read model；若确需扩 waist，必须同 PR 修改所有 hooks/tests，并由用户批准。
3. **Skill 边界**：A 管 orchestration decision/scheduling；D 管 `ccm` board/route/attempt/account 的 CLI 操作机制；E 管 DAG slicing；F 管 task-internal loop；G 管工程手艺；H 管 usage/estimate/model-policy 等只读 advisory 的消费。B 只在 workflow authoring 被触发时介入，I 只在经验→资产蒸馏时介入。不能把 Graph Engineering 复制成多个 skill 的第二 SSOT；若未来提议新建 Graph Engineering skill，必须另过 `curating-skill-portfolios` 准入，本专栏不自动推出其存在。
4. **指挥不演奏**：自动化应增强 reconcile、diagnose、propose 和 verify gate，不能推动 master 亲自实现或亲自 review。
5. **Ship-anywhere**：不能把单一 host Workflow、timer、agent-teams、外部 graph daemon 当 universal floor；能力必须 Track A/B 诚实分层。
6. **Dormant-until-armed**：任何新 graph observer/hook 仍必须先过 armed gate；bootstrap 是唯一 ARM 豁免。

## 建议的路线表达

不建议说“cc-master 从 loop engineering 迁移到 graph engineering”。更准确且可验证的表达是：

> cc-master 已有 task DAG、deps/declared qualification、ready/CPM 与 hand-run control loop；agent registry、native-attempt、delivery 和 evidence/provenance 仍是成熟度不一的相邻 partial planes。研究方向是逐步机械化 graph lifecycle 的 read model、revision proposal、recovery fence 和 provenance，在不扩大 authority、不破 ship-anywhere 的前提下，以 shadow evidence 决定哪些机制值得晋级。

这个方向与[工程操作性定义](03_engineering_taxonomy.md)一致，也把社区热词转化为具体、可证伪的能力问题。实验顺序、指标与 stop gate 见[研究议程](05_research_agenda.md)。
