# cc-master 产品功能手册（Feature Manual）

> 本手册是 cc-master 已交付能力和明确边界的面向人索引。README 负责快速理解和上手；协议、字段和算法的单一真相源仍分别在 `@ccm/engine`、CLI registry、hook CONTRACT 和分发 skills 中。
>
> 末次全量同步：2026-07-23，plugin `0.21.0` / `ccm 0.22.0` 正式版；web-viewer 是随 ccm 内嵌并按 build identity 刷新的只读组件。

## 1. 产品模型

cc-master 不是一个替 agent 做决定的中央调度框架。行动者始终是运行在 Claude Code、Codex、Cursor 或 Kimi Code 中的 agent；`as-master-orchestrator` 把当前主会话初始化成 master orchestrator，插件在运行时提供行为指导和通知，独立安装的 `ccm` 提供可验证的状态、进程和只读决策事实。

产品由三层组成：

1. **cc-master plugin**：四 origin 的 commands / skills / rules / hooks，把 agent 的身份、决策程序、恢复和通知接进各 harness。
2. **`ccm` CLI + `@ccm/engine`**：board、Goal Contract、worker、agent registry、quota、model policy、runtime、monitor 和 viewer 的命令/状态单一真相源。
3. **`ccm web-viewer`**：本机只读 mission-control，展示 board、Goal Contract、DAG、routing、agents、decisions、peers 和状态报告。

支持的 origin 是 **Claude Code、Codex、Cursor IDE plugin、Kimi Code**；可被 `ccm worker` 直接启动的本机 headless worker 是 **Claude Code CLI、Codex CLI、Cursor Agent CLI、Kimi Code CLI**。Cursor IDE 与 Cursor Agent 是两个独立 surface，不混为一个客户端。

## 2. 状态图例

| 标记 | 含义 |
|---|---|
| ✅ | 已在 main 实现并有自动化验收 |
| 🟡 | 已交付最小闭环，但仍有显式能力边界 |
| 📐 | 仅有后续设计/路线，不计入当前能力 |

## 3. 八个分发 skill

八个 skill 对所有 origin 共享核心视角，host adapter 只保留真实的调用差异，不再为 origin 隔离重复模型、quota 或 worker 心智。

| Skill | 职责 | 状态 |
|---|---|---|
| `master-orchestrator-guide` | master orchestrator 身份、主线决策、已切 DAG 排期、派发/恢复/验收/换号决策边界 | ✅ |
| `authoring-workflows` | 可用 host 上的确定性 workflow 写法；不支持的 host 明示降级 | ✅ |
| `using-ccm` | CLI 操作手册、board 模型、状态机、Agent Registry 和引擎校验规则的全量派生视图 | ✅ |
| `slicing-goals-into-dags` | 把目标纵切为可早交付、可并行、可验收的 DAG | ✅ |
| `dev-as-ml-loop` | 单个开发任务按“提议→测量→调整→收敛”优化到验收 | ✅ |
| `engineering-with-craft` | DDD / SDD / TDD / OOP 工程手艺和实现红线 | ✅ |
| `pacing-and-estimation` | 消费 quota、usage、estimate、model-policy 等只读 advisory；决策仍归 orchestrator | ✅ |
| `distilling-lessons-into-assets` | 将复盘证据路由为纪律文档、skill、workflow 或 subagent 资产 | ✅ |

### 3.1 统一模型分配

所有 origin 都能看到跨 harness 的统一候选，而不是只看当前 harness：

- **O（orchestrator）**：系统/架构/需求/方案设计和特别重要的 adversarial review。当前项目候选为 Claude Code Fable 5、Codex GPT-5.6 Sol、Cursor first-party Grok 4.5；Cursor API 的 Fable 5 / GPT-5.6 Sol 只有在明确允许额外付费时才可选。
- **T1**：规格完整后的主要实现档。
- **T2**：常规 review、测试、仓库研究和结构化总结。
- **T3**：机械、低风险、可强验证的批量工作。

排序顺序是：能力/权限/效果硬门 → 当前安装、认证、quota/admission 事实 → 成本、延迟、上下文和集成约束 → 社区 task-affinity taste 只作有时效的同档 tie-break。fallback 只能沿已声明候选链机械降级，不能越过安全、权限或效果底线。

## 4. Goal、board 与运行时 actor

### 4.1 Goal Contract ✅

fresh board 以 pending skeleton 起步。原始 prompt 和 GitHub issue 是需求证据，不是 canonical goal；orchestrator 通过 `ccm goal set|confirm|amend|show|check` 维护带 revision 的 Goal Contract，复杂上下文用不可变、哈希校验的 Goal Brief。交付截止时间有 `pending|asserted|confirmed|none` 四态和独立 revision；`ccm goal deadline ...` 负责显式 settle/amend，不能从自然语言静默猜成权威 DDL。resume、compaction 和完成闸都重对齐当前 revision 与 deadline settledness。

### 4.2 Board ✅

board 是单一可写编排事实源；所有写入经 `ccm` 带锁关卡。`@ccm/engine` 维护字段 tier、状态机、DAG、临界路径和完整的 FMT / GRAPH / BIZ 规则 registry；规则数量只从引擎派生，不在手册里另建易漂移常量。`done` 必须同时有 `verified:true` 和非空 artifact；retry 会归档旧 attempt 证据并清空当前 attempt。

可选 routed-task contract 为 task 增加：难度、effect/capability/permission floor、ample/tight candidates、fallback 权限和每 attempt 不可变 selection snapshot。legacy board 保持兼容。

### 4.3 Task、agent、attempt 三分 ✅

- **task**：计划和验收单元。
- **agent**：真实运行 actor，由 `agents[]` 和 `ccm agent create|bind|link|terminal|probe|list|show` 登记。
- **attempt**：某次执行的证据边界；重试不会复用旧 review 或 artifact。

手工/native 派发顺序是 create starting agent → 实际 spawn → bind handle/link task → task 进入 `in_flight`。对本机 cross-harness CLI worker，`ccm worker dispatch` 已把 idempotent claim、真实 spawn、Agent Registry create/bind/link、typed transcript/attach enrichment 和 terminal reconciliation 合成一次同步命令；调用方仍须持有外层 background handle。两条路径中 agent terminal 都只说明进程生命周期结束，绝不自动等于 task 通过验收。

### 4.4 Delivery truth ✅

可选 delivery/dependency contract 区分“候选通过验收”和“候选已经进入下游真实消费的 baseline”。Git、immutable artifact 或 reviewed reconciliation 形成 delivery evidence；target 漂移、retry 或旧 review 会使资格失效。未启用 contract 的旧边继续采用 legacy readiness。

## 5. Cross-harness worker 最小闭环

### 5.1 `ccm worker` ✅

`ccm worker` 是本机 harness CLI 的薄 wrapper，而不是另一套 agent framework：

- 发现已安装的 Claude Code、Codex、Cursor Agent、Kimi Code 可执行文件；
- 展示目标 CLI 的真实 help / 参数面；
- 原样透传 target-native argv，避免 ccm 复制一套会漂移的参数 schema；
- `worker run` 启动零 board 副作用的 session-bound raw worker；`worker dispatch` 在相同 transport 外包上 Agent Registry 的 tracked lifecycle；
- 捕获结构化结果、真实 PID、typed identity/transcript/attach 与 lifecycle evidence；
- 取消或结束时管理 owned process tree，并等待后代收敛。

当前边界为 🟡：它完成了本机跨 harness 调用与生命周期管理的 MVP，但不是 durable remote transport；不承诺统一各厂商 session 语义，也不把 sandbox/隔离能力包装成已具备。Cursor Agent 在不支持其 OS sandbox 的 Linux 5.15 主机上仍可按明确允许的非 sandbox 路径做受限验证。

### 5.2 Cursor 双 surface ✅

这组事实来自三个互不替代的只读面：`ccm harness list --machine-wide --json` 报告 Cursor IDE plugin 与 Cursor Agent CLI 的本机 surface inventory；`ccm quota status --machine-wide --json` 报告已有 cached quota posture；`ccm model-policy ...` 消费 role candidate、qualification 与 admission。任一面都不能从另一个面推断：IDE 安装不证明 Agent CLI 已安装、认证、额度可用或具备 role eligibility，反之亦然；只有已独立通过相应事实门的 Cursor Agent 才能进入 headless worker dispatch。

### 5.3 Runtime supply chain 🟡

`ccm runtime stage|activate|resolve|invoke|doctor|rollback` 提供官方 provenance、内容寻址、原子激活、恢复和回滚。Linux 支持 attested fd-exact invoke；macOS 使用 attested final-path tier 并诚实暴露同 UID 竞争边界；Windows 仍 fail-closed、未支持。

## 6. Machine-wide quota 与 pacing

### 6.1 一个生产者、四 origin 消费 ✅

`ccm` 是 quota 事实唯一生产者。Claude Code、Codex、Cursor origin 的 bootstrap 注册 exact subscription，hook 从 cached posture 生成 pre-context 和 coordination notification；Kimi origin 当前通过显式 `ccm usage show|advise` / machine-wide cached read 消费同一事实，因为它没有可靠的非阻断 mid-flight landing。四个 origin 都能读取本机全部已支持 harness 的 provider-scoped 状态，但只有前三个具备已验收的自动 landing。hook 不抓 provider token、不自行重算权威结论，也不以 agent 数量猜 quota。

当前信号：

- **Claude Code**：本机账号池的 5h/7d 信号和 policy；可在用户授权的 policy 下切换账号。
- **Codex**：官方已退役 5h 上限，只以 7d 为硬 ceiling；rolling 24h 仅作消耗过快 advisory。Codex 不自动切号。
- **Cursor Agent**：跨 session 共享的当前订阅周期信号。Cursor IDE statusline 与 Cursor Agent 事实分开；Cursor 不自动切号。
- **Kimi Code**：managed endpoint 的 rolling 5h/7d 用量窗口；短命 access token 可在有界锁内自动刷新，失败则给出显式恢复提示。Kimi 不提供账号池或自动切号。

cached signal 过期、schema 不匹配或来源不足时显示 unknown/不可用，不把缺失解释为“额度充足”。跨 session 通知只使用已落盘、带 provenance 和 freshness 的 provider-scoped posture。

### 6.2 Quota admission ✅

`ccm quota status|preflight|reserve|audit` 组合 observation、policy、effect、reservation、ticket/run lineage 和 durable store，形成 provider-neutral live admission。Codex 只把 7d 当硬 quota 信号；rolling-24h 不会变成拒绝权威。

### 6.3 Model policy ✅

`ccm model-policy` 分离官方 provider facts、项目 role candidates 和有时效的社区 task-affinity。请求必须绑定当前 candidate、qualification 和 admission；调用方不能凭空发明 provider route、evidence 或永不允许的 override。

## 7. Plugin hooks 与通知

所有 hook 都遵守 dormant-until-armed：只有当前 session 经 `as-master-orchestrator` 接管 active board 后才工作。Claude Code、Codex、Cursor、Kimi Code 由共享 CONTRACT + host adapter 保持业务语义 parity；没有等价事件的 host 明示 Track B 补偿或 unsupported，不能把“有包”写成“所有事件 1:1”。Kimi 当前有 ARM/board guard/lint/Stop verify 核心闭环，compaction 后由 manifest `sessionStart.skill` 恢复静态角色基座；它没有可靠的动态 PostCompact 注入、batch-boundary、coordination inbox、identity nudge 或 mid-flight pacing hook。

| 能力 | 作用 | 状态 |
|---|---|---|
| bootstrap / resume | 建板或接管旧板，盖 session/origin，注册运行时订阅 | ✅ |
| reinject / orchestrator context | compaction 后恢复身份、Goal Contract、任务和 machine-wide facts | ✅ |
| verify-board | Stop 前检查未完成目标、后台 agent/watchdog 和真实完成证据 | ✅ |
| board-guard / board-lint | 阻止绕过 `ccm` 手改 board；写后检查结构 | ✅ |
| usage-pacing | 消费 ccm cached quota/advisory；不自行成为 quota authority | ✅ |
| coordination inbox | 把跨 session 的 decision-grade 通知送到当前 orchestrator | ✅ |
| identity / critical-path nudge | 长会话内恢复角色与关键链注意力 | ✅ |

注入标签为 `<ambient>`、`<advisory>`、`<directive>`；只有 directive 能要求 continuation。hook 缺 ccm 或拿不到可靠 cached fact 时优雅降级，不伪造状态。

## 8. Viewer、status 和后台服务

### 8.1 `ccm web-viewer` ✅

viewer 已是交付能力，不是设计稿。它由 `ccm web-viewer start|open|status|stop|restart|serve` 管理，监听 localhost、token-gated、运行时零外网，前端资产随 ccm SEA 内嵌并在 upgrade/install 后 reconcile。页面提供 Graph / Board / List / Timeline、Goal Contract 与 DDL、planning/routing badges、DecisionCard、peers/inbox、Agent Registry roster/inspector、task links、filters 和 shareable URL state；已登记 actor 可从 agent drawer 流式查看 harness 适配后的 raw transcript。Claude Code、Codex、Kimi Code 有原生来源，Cursor 当前接受显式可读的外部 transcript，native SQLite streaming 仍 deferred。UI 是只读消费者，不能写 board。

### 8.2 `ccm status-report` ✅

`render|write|show|watch` 生成稳定 `ccm/status-report/v1` 派生报告，覆盖进度、blocked-on-user、in-flight、ready、done、critical path、health、risks 和 next actions；artifact 写在 home 的 report 目录，不污染 board。

### 8.3 Monitor 与 service reconcile ✅

`ccm monitor` 提供可选后台监控；`ccm services reconcile --after-binary-replace` 在安装/升级后恢复 wanted monitor/web-viewer。Linux systemd user service 和 macOS launchd 使用平台 serializer；卸载/停用失败返回可重放的非零结果，不把部分成功伪装为成功。

## 9. 安装、兼容与诚实边界

- **Node.js 22+ 与 bash 是硬前置**；ccm 以 Linux/macOS x64/arm64 SEA 发布，Windows 尚未支持。
- plugin 与 ccm 是两条版本线：裸 `v*` 发布 plugin，`ccm-v*` 发布 ccm。分开升级时先升级 ccm，再升级 plugin；旧 plugin/新 ccm 以 additive/legacy 兼容为原则，但新 plugin 依赖的新命令必须由对应 ccm 版本提供。
- plugin 对 Claude Code、Codex、Cursor、Kimi Code 分别生成 host-native artifact；共享版本号不代表四 host 的 API 形状完全相同。
- `ccm worker`/Agent Registry 是已交付 MVP；durable supervisor transport、远程 worker、Windows runtime、统一 provider sandbox 和更强 isolation 是 post-MVP，不应写成当前能力。
- Claude/Codex/Cursor/Kimi provider CLI 会演化，因此 ccm 透传真实参数并暴露真实 target help；只把稳定的发现、生命周期、evidence 和 board contract 放在 ccm 层。

## 10. 维护纪律

1. CLI verb、状态机、字段 tier 或 lint 规则变化时，同 PR 更新 `using-ccm`；规则总数以引擎 registry 为准。
2. hook 行为变化时，同 PR 更新 host-neutral CONTRACT、host coverage 和 parity fixture。
3. skill 的统一心智留 canonical；只有不可消除的 host 调用差异留 slot/overlay。
4. 用户可见变化进入根 `CHANGELOG.md`；ccm 包行为另由 changesets 生成各包 changelog。
5. 新能力没有端点证据时标 🟡 或 📐；“有 schema/fixture”不等于“真实 provider 已生产可用事实”。
