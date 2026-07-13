# Cross-harness orchestration capability model

> 状态：**tracked capability SSOT；current / partial / target 分层描述**
> 日期：2026-07-10 UTC
> 方向批准：用户已于 2026-07-10 批准 cross-harness A–F 推荐包；architecture / authority / privacy / lifecycle 方向生效，具体 implementation、API、schema、runtime 与 rollout 仍为 `target`
> 适用范围：cc-master master orchestrator 在 Claude Code、Codex、Cursor 任一 origin harness 中，对本机 host-native 与 cross-harness agent workers 的规划、选择、派发、管理、恢复和验收
> 非范围：本文不是 implementation spec，不定义最终 CLI 名、JSON wire schema、阈值、模型价格或 provider flags；所有标为 `target` 的能力在对应 spec / ADR / contract / test 晋升前都不得宣称 shipped

## 1. 文档角色、证据层级与晋升规则

本文长期回答五个问题：

1. master orchestrator 为完成产品 charter，必须闭合哪些责任；
2. 每项责任需要哪些信息、由谁唯一拥有、何时送达；
3. Claude Code、Codex、Cursor origin 如何用不同 host surface 表达同一决策语义；
4. host-native task 与 cross-harness CLI run 如何共享 task / route / attempt / true-done 语义；
5. 一项能力达到什么证据门后，才可以从 target 晋升为 partial 或 current。

### 1.1 状态词是承重合同

| 状态 | 含义 | 允许的产品声明 |
| --- | --- | --- |
| `current` | 当前 tracked source、生成产物和对应测试 / probe 已存在 | 可以描述为已提供，但必须保留已登记的 host divergence |
| `partial` | 相邻能力已存在，或只有部分 host / surface / lifecycle 生效 | 只能描述具体已覆盖范围；不得用相邻能力代称完整能力 |
| `target` | 本文确认产品需要此能力，但 implementation、contract 或验收尚未落地 | 只能写“计划 / 目标 / 待实现”，不得出现在用户可用命令清单中 |
| `unsupported` | 目标 host 没有等价机制，且已有诚实 substitute 或明确拒绝 | 必须写 declared divergence；不得伪装 Track A parity |

以下等式一律为假：

```text
plugin installed       = headless worker available
binary installed       = authenticated
authenticated          = model entitled
model visible          = quota visible
quota visible          = projected task fit
detached child         = durable supervisor
provider succeeded     = task accepted
Unix process survived  = industrial runtime lifecycle
```

### 1.2 与其他 SSOT 的关系

- 产品六项 charter 以 [`design_docs/spec.md`](spec.md) §1.0 为准。
- board narrow waist、CLI process boundary、advisory 边界等已接受结构决策，以 [`adrs/`](../adrs/) 中对应 ADR 为准；本文不修改它们。
- 当前 host 事实和易变 probe 以 [`design_docs/harnesses/`](harnesses/) 为准，尤其是 [Claude Code](harnesses/claude-code.md)、[Codex](harnesses/codex.md)、[Cursor IDE Agent](harnesses/cursor.md) 与 [compatibility matrix](harnesses/compatibility-matrix.md)。
- 跨 surface 能力差异以 [`design_docs/harnesses/capabilities/`](harnesses/capabilities/) 的 Capability Cards、hook `CONTRACT.md` 和 per-host strategy 为准。
- 运行时方法论以 `plugin/src/skills/master-orchestrator-guide/canonical/` 为准；本文不复述其纪律正文。
- 本文是**能力完整性模型**，不是 wire-level implementation spec。后续正式 spec 负责精确 schema、commands、state machine、migration 和 rollout；ADR 负责把已批准方向固化为不可轻易逆转的 architecture / authority / lifecycle 决策。若冲突，已批准 ADR 与已实现 contract 高于本文的 target capability；本文须在同一 PR 回写状态和链接。

### 1.3 晋升规则

一项 target 能力只有完成下列落点，才能晋升：

| 内容类型 | 正式落点 |
| --- | --- |
| architecture、authority、runtime lifecycle | ADR + implementation spec |
| board / task / route / attempt 类型、不变式、数学 | `@ccm/engine` contract + property tests |
| CLI、machine facts、stores、process lifecycle | ccm CLI / provider runtime + JSON contract tests |
| model / price / benchmark / lifecycle facts | versioned evidence registry + generated guide；不写死在本文 |
| master judgment | canonical skill / reference；经 skill eval |
| origin host 差异 | Capability Card、hook CONTRACT、SAP/PHIP strategy + equivalence fixture |
| viewer | ccm read-model contract；frontend render-only |

每次晋升必须同时：更新本文状态、链接实际 SSOT、补负例、证明 legacy path 未回归。仅有代码、文档、生成文件或一次付费调用中的任意单项，都不足以晋升。

### 1.4 已批准方向与仍待晋升的 target implementation

用户已于 2026-07-10 批准 A–F 推荐包：per-run supervisor 而非先造中央 daemon、cross-harness 默认 deny、home-scoped lazy quota store + cached-only hook、immutable side-by-side runtime、provider 分阶段 rollout，以及 local-only minimal outcome corpus。**方向已批准不等于实现已存在**：对应 implementation、API、schema、runtime、migration 和 tests 在逐切片通过晋升门前仍全部是 `target`，不得写成 current/shipped。实现若扩大 authority、改变隐私默认、让中央 daemon 成为 correctness 前提、扩到跨机器，或触碰 Codex/Cursor account mutation forbidden 边界，必须重新走 direction gate，不能从本能力模型推导授权。

## 2. Charter → responsibility → evidence 闭环

cross-harness orchestration 不是“三个 CLI 互相 shell out”。它必须形成一个可恢复、可解释、有权限与额度边界的控制闭环：

```text
恢复 board 与全场状态
  → 排当前增量、临界路径和 WIP
  → 塑造可独立验收的 task profile
  → 看见全机 surface / auth / model / quota / negative capability
  → hard eligibility → advisory utility → master judgment
  → authority / worktree / permission / reservation / live recheck
  → host-native bind 或 cross-CLI supervisor dispatch
  → journal / heartbeat / notification / attach / reconcile
  → 父层独立验收与 HITL
  → outcome / estimate 回馈 → replan
```

| Charter | master 不可外包的责任 | 系统必须提供 | 终点证据 |
| --- | --- | --- | --- |
| 异步并行、完整落地 | 维护 ready-set、WIP、临界路径和每条 path 的收敛 | native 与 CLI 统一 attempt；真实 handle/ref；跨 session recon | 每个 in-flight 有可验证 handle/ref；每个 terminal 已验收、重派或显式 orphan |
| 控制 token / 配额 burn | 看全机 pool，调整 WIP、模型档、route 或暂停 | per-surface quota observations、freshness、forecast、reservation、decision delta | unknown/tight 自动 spawn 为零；reservation 可审计 |
| 自主与 HITL 边界 | 可逆小步自决，把方向、授权和不可逆动作交还用户 | board/home/task authority、side-effect policy、fresh decision package | 未授权 external write、续耗、destructive force 为零 |
| 目标分解、管理和规划 | 建 DAG、task profile、acceptance、input pins 和 replan | planning aggregate、required/preferred/forbidden capabilities | routed task 缺 profile/acceptance 不能 in-flight |
| 资源约束下最大化效率 | 比较 makespan、quota opportunity、context movement 和 integration cost | origin-native + cross-CLI 候选全集、utility breakdown、WIP/read model | route rationale 可重放；“跨 harness”本身没有奖励项 |
| 按难度/时长选模型 | 定 effect floor、effort、ample/tight chain 和验收强度 | live entitlement × versioned evidence × local outcome | requested/resolved/registry revision 与 acceptance 可关联 |

### 2.1 master 必须持续完成的十三个 decision jobs

| Job | 最小输入 | master 动作 | 缺失时行为 |
| --- | --- | --- | --- |
| 恢复身份与全场 | board/goal/worktree/owner、DAG revision、run/projection freshness | 落正确 worktree，lint/reconcile，认回所有 path | 不能证明 board/worktree/owner 就不 dispatch/verify |
| 排当前增量 | deps、estimate/actual、critical path/float、WIP、forecast confidence | 删假依赖、critical-ready 优先、控制整合悬崖 | coverage 低只信结构，不报伪精确 ETA |
| 塑造 task | objective/non-goals、profile、acceptance、input pins、side effects | 重切、升 altitude 或写 planning/chains | profile/acceptance 不全只 planning，不 routed dispatch |
| 发现 execution surfaces | harness/surface、binary/version、invocation/result/cancel/resume/permission | 建候选全集，不先按品牌预选 | absent/unknown surface 不进候选；IDE/CLI 不互推 |
| 守 identity / pool | opaque identity、auth/workspace、pool/payer/scope、mutation policy | 绑定已授权 identity/pool；必要时请求手工 auth | auth unknown/expired → ineligible；不复制 credential |
| 选 model / effort | live models/features、registry evidence、price validity、outcome confidence | hard filter 后设 objective/effort/verification strength | stale 降 confidence；unclassified 只低风险 canary 或显式覆盖 |
| 判全机 quota | pool/bucket/unit/window/reset/payer、freshness/error、reservation | 降 WIP/档、改 route、推迟 float 或 surface 用户 | hard-stale/partial/unknown 承重 bucket → ineligible |
| 比较 route | eligibility reasons、quality/cost/quota/latency/context/risk/overhead、policy | 接受或 override advisory 并落 rationale | 无显式 candidate/chain/authority 不派 |
| Admission / dispatch | live auth/model/quota、reservation、worktree、permission、runtime、idempotency | reserve → recheck → launch → 拿 handle → in-flight | 无 handle 不 in-flight；状态变化释放/重选 |
| Midflight 监督 | heartbeat/event seq、actual model/usage、timeout/error/circuit、projection lag | integrate-on-notification、cancel/reconcile/replan | silence 不等于死亡；unknown writer → orphan audit，不重派 |
| Handoff / resume | handle class、run/journal/runtime/lease/control、worktree/account lineage | quiesce new dispatch；按 class drain/attach/poll/audit | legacy/session-bound 与 durable 分流，不能一刀切 |
| 端点验收 | terminal、artifact/diff/tests/schema、input hash、verifier family | 父层跑 gate/读 diff；done 或新 attempt/replan | success/空 review/gate-green 都不自动 done |
| HITL / upgrade | decision owner/freshness；runtime hashes/leases/protocol/transaction | 预取 decision package；stage/activate/rollback/drain 或拒绝 | 含糊默许不算批准；无 journal floor 拒绝 activation |

## 3. 四层信息预算

动态事实越多，越不能永久写进 SKILL A。信息必须按“需要多快进入 context”分层。

| 层 | 内容 | Producer / delivery | Target budget | 失败语义 |
| --- | --- | --- | --- | --- |
| Always-context | role/board goal、ready/in-flight/user 摘要、WIP/overall posture、authority、surface posture、run attention、drill ref | ccm cached context → host adapter SessionStart / role substrate | ≤4 KiB；route 摘要≤12；无 raw telemetry/identity | cache missing/corrupt → `available:false` 或空 envelope，hook RC0；不得同步 probe |
| Decision delta | eligible↔ineligible、ample↔tight、429/reset、identity/model change、run terminal/stale、policy/worktree invalid、user reply | home read model / coordination inbox → 有界 host event | 同 revision 去重；初始 cooldown 15 min；只带 previous→current + reason + action | 无 event 时 durable inbox / 下次 start；routine telemetry 静默 |
| On-demand drilldown | normalized capability/quota provenance、utility、model evidence、run timeline/artifacts、policy/runtime | 显式本地 ccm read / refresh | 分页/opaque refs；不自动塞 prompt | stale 明确 warning；承重 decision 需 explicit refresh/preflight |
| Durable refs | planning/routing/attempt 摘要、run/journal/runtime/reservation/artifact refs、decision package、projection seq | board 小摘要 + home store 大证据 | board 不塞 stdout/catalog/raw buckets；journal append-only | ref 不可读 → uncertain/orphan；不能靠 handoff prose 猜 live state |

严禁进入 agent-visible projection：token、refresh token、email、credential path、raw private response、完整 argv/env、不可比较的精确余额、全量 transcript。大证据只留 owner-only home store，以 opaque ref 暴露。所有 allowlisted string（含 warning、qualification ref 与未来扩展字段）在 cache producer 和 public-context consumer 两侧递归执行 value-level secret guard：标准高信号 `sk-<long-token>` 与 `Bearer <long-opaque-token>` 不得因 token 只含字母而漏过，拒绝错误也不得回显原值；明确的短标签、`token budget` / `authentication unavailable` 等运行状态句和 `REDACTED` 占位符必须继续可表达。

### 3.1 Delivery timing

```text
ARM / SessionStart / resume
  ├─ role substrate + board goal + unresolved path
  └─ cached machine/context revision（missing = unknown）

task planning
  └─ profile + acceptance + required capabilities + ample/tight chains

route advice
  └─ eligibility / utility / reasons + source revisions

dispatch preflight
  ├─ live capability/model/quota recheck
  ├─ reservation + worktree + permission + authority
  └─ durable launch intent + real handle/run_ref

in flight
  ├─ heartbeat 留 run store
  ├─ decision-grade delta 入 inbox/context
  └─ completion 唤醒 reconcile

handoff / terminal
  ├─ classify handle → attach/poll/audit
  └─ normalized result → parent verification → true-done/replan
```

## 4. Ownership、dependency direction 与 single-writer

### 4.1 组件唯一职责

本表定义 target ownership 边界；某个组件是否已存在、存在到哪一档，以 §13 gap matrix 为准。不得因为 ownership 已清晰就宣称 runtime 已实现。

| Component | 唯一拥有 | Readers | Persistent writer | 明确不拥有 |
| --- | --- | --- | --- | --- |
| `@ccm/engine` | board/planning/routing/attempt/reservation 类型和不变式；纯 eligibility/headroom/utility/fallback legality；read model | ccm CLI、tests、viewer bundle | 无 IO；composition root 在锁内调用 mutation | CLI flags、fs/network/process、credential、品牌偏好、prompt policy、最终 route |
| ccm CLI composition root | 稳定 JSON/exit 语义；组合 engine/registry/stores/runtime；board projection；operator verbs | plugin、operator、hooks、viewer backend | board dedicated writers/active-version reconciler | master judgment、第二份 skill policy、provider stream 细节 |
| provider runtime + drivers | surface probe/compile/spawn/poll/cancel/resume/parser、process tree、redaction、permission compilation | supervisor、contract tests | 只经 supervisor 写 run sandbox/journal | board、task acceptance、品牌路由 policy |
| capability/quota stores | machine surface/auth/model/permission/quota facts、TTL/provenance/error/circuit/revision | context/route/preflight/report | collectors single-flight 原子发布 | credential、不可比 pool 聚合、route authorization |
| reservation/worktree manager | account+pool 占位、worktree lease/nonce/ownership/cleanup proof | dispatch/reconcile/GC | per-run 幂等 lease writer | provider billing 真相、task judgment |
| run store / supervisor | immutable request、launch intent、runtime lease、journal/heartbeat/control/artifacts | run API/reconciler/verifier | supervisor 是 journal/heartbeat/lease 唯一 writer | board direct write、credential、task done |
| runtime install registry | immutable versions、current/previous、transaction/provenance、runtime lease index、drain/GC | launcher/dispatch/attach/doctor | installer transaction writer；GC 只删 eligible image | board 业务、provider credential、upgrade-kill active run |
| model-evidence registry | alias/lifecycle/price/benchmark/official/community evidence、provenance、outcome schema | plugin policy、route inputs、viewer | curation/generator；独立 outcome writer | live entitlement/quota、最终选择 |
| plugin canonical policy | task profile、objective、candidate chains、最终 route rationale、WIP/HITL/verification judgment | master agent | 只经 ccm dedicated verbs 写 planning/routing/judgment/true-done | provider flags/parser、price 第二份表、reservation、journal |
| plugin host adapter | manifest/path/registration、host event mapping、cached envelope conversion、origin-native invocation+handle bind、declared divergence | origin master | 只经稳定 ccm API 写 native attempt bind/event | machine facts、route scorer、cross-CLI driver、board state machine |
| viewer/report | render ccm read model、freshness/provenance/operator attention | human/operator | 无 board/route write | eligibility/utility 重算、raw identity/balance |

```text
plugin canonical judgment ──stable JSON──> ccm CLI composition root
plugin host adapter ────────cached/native─┤
                                         ├─ @ccm/engine → board/read model
stable launcher → current runtime ───────┼─ provider supervisor → target CLI
                                         │                         └→ run journal/lease
                                         └─ active-version reconciler ←─────┘
viewer ───────────────────────────────────── read model only
```

### 4.2 每类状态只有一个 writer

| State | 唯一 writer | 禁止的第二 writer |
| --- | --- | --- |
| planning / routing policy | ccm dedicated writer，输入来自 master judgment | generic free-form setter、driver、viewer |
| selection / attempt board projection | active-version ccm dispatch/reconciler | old supervisor、hook、frontend |
| run journal / heartbeat / runtime lease | exact pinned supervisor | origin plugin、new CLI 直接改 journal |
| capability / quota revision | 对应 collector，经 home single-flight/atomic publish | hook、skill prose、viewer |
| reservation / worktree lease | reservation/worktree manager | provider child、prompt、board 自由字段 |
| runtime current / previous / transaction | installer/runtime registry | supervisor、plugin updater、GC 绕 transaction |
| final task acceptance | master/verifier 经 true-done verb | provider terminal、driver、viewer |

边界口诀：**ccm 证明事实、执行机械闸、托管进程和持久状态；plugin 做 canonical judgment 与 host-native delivery；engine 不硬编码品牌、型号优先级或 prompt policy。**

## 5. 三 origin delivery 与 Track A/B

具体事件、payload 和版本事实可能变化，必须回读 [`design_docs/harnesses/`](harnesses/)；本节只锁定等价 intent 与诚实降级。

| Timing | Claude Code origin | Codex origin | Cursor IDE origin | 共同 acceptance / degradation |
| --- | --- | --- | --- | --- |
| ARM confirmation | `UserPromptSubmit` context | prompt-first `UserPromptSubmit` context | `beforeSubmitPrompt.user_message` | 只有 bootstrap 可 ARM；ccm 缺失不建半武装 board |
| Session start/resume | SessionStart startup/resume/compact | SessionStart additional context | 目标版本 probe 通过才用 SessionStart；否则 alwaysApply 只放静态 role/ref | cached-only；missing/corrupt → 空或 unknown；零 provider probe |
| Compaction role | SessionStart compact 重注 | host resume/compact substrate | `preCompact` 不能注入；alwaysApply Track B 保底 | Cursor 不宣称 full reinject parity；动态 snapshot 不塞 alwaysApply |
| Mid-turn delta | PostToolBatch 只在边变化 | 无 PostToolBatch；不用每次 PostToolUse 伪装 batch | 仅目标版本 probe 通过时使用有界 PostToolUse delta | 无等价 event 就 inbox/下次 start；routine delta 静默 |
| Stop action | block/advisory/inbox | block 或 systemMessage/inbox | followup_message 只给真实 decision/action | Cursor followup 会开新轮，routine quota 摘要不得使用 |
| Native completion | task notification | 已发现的 subagent handle/completion | subagentStop/AwaitShell/notify_on_output | native handle/result 逐 host probe；没有 handle 不 running |
| Cross-run completion | ccm coordination delta + reconcile | 同左 | 同左 | durable fact 来自 ccm，不依赖 origin event |
| Handoff/resume | board resume + run attach | 同左 | 新 conversation 重新 ARM 后同左 | 先 classify handle，再 drain/attach/poll/orphan |

Track 纪律：

- Track A：host 有原生等价 surface。按 Capability/hook CONTRACT → host implementation → equivalence-class fixture → projection → real probe 推进。
- Track B：host 无 1:1 机制。必须有 declared divergence、compensating mechanism 和 target acceptance；不得用相似 event 名制造 parity。
- Cursor IDE plugin 与 Cursor Agent CLI 是两个 descriptor / contract；任一侧 installed/authenticated 不推出另一侧可用。
- Codex/Cursor 无 PostToolBatch 是负能力，不应由逐工具事件伪装。
- origin delivery fail-open 只表示 context/notification 降级；dispatch mechanical gate 仍独立 fail-closed。

## 6. 统一 task、route、attempt 与 handoff 语义

### 6.1 Host-native 与 cross-CLI 共享 contract

| 语义 | 共同要求 | Host-native 差异 | Cross-CLI 差异 |
| --- | --- | --- | --- |
| task planning | 多维 profile、acceptance、input pins、required/preferred/forbidden capabilities | context movement 可更低，仍不免 profile | explicit minimal envelope/worktree/ref |
| routing | candidate、effect floor、quota/policy/permission gate、rationale | `surface=host-native`；origin overhead 计入 | `surface=cli-headless`；driver/runtime identity 固定 |
| attempt | append-only ordinal、requested/resolved、真实 handle、artifact、terminal taxonomy | plugin create native lease，再 invoke + bind host handle | ccm launch intent → supervisor hello → run_ref |
| lifecycle | starting/running/terminal/uncertain/orphaned；无 handle 不 running | durability 依 host probe，不默认跨 session | target 为 independent supervisor + journal/lease |
| completion | terminal 不是 done；父层独立验收 | native success 只是 attempt terminal | structured success 也只是 attempt terminal |

Task profile 必须先于模型品牌，至少覆盖 reasoning、uncertainty、risk、scope、context、coordination、reversibility、duration/confidence、capability needs、data/permission/side effect、acceptance、inputs、budget/timeout 和 restart/escalation 条件。字段与 writer 的精确形式属于后续 engine contract；在该 contract 落地前，这一段仍为 `target`。

### 6.2 Handoff 四类分流

| Class | 可证明事实 | Handoff action | 新 session 可做 | 禁止声称 |
| --- | --- | --- | --- | --- |
| `legacy_session_bound` | 只有 origin session/native handle；无 durable lease/journal | 优先有限 drain；保存 input/artifact hash | content hash + endpoint verification；证据不足才新 attempt | “所有 native task 都继续”或“全部已死” |
| `durable_run_ref` | run_ref+journal+runtime lease+nonce/process identity+compatible hello | quiesce new dispatch；不取消 run；写稳 refs/control/acceptance | attach/poll/cancel/reconcile 同一 attempt | “handoff 必须 drain”或另 spawn 替代 worker |
| `journal_only` | journal 可读，但 control protocol 无交集 | 保留 run/reservation/worktree；记录 control 降级 | cached poll/terminal projection；兼容 mailbox 才 cancel | PID 猜 kill、承诺 resume/cancel |
| `orphaned` | 无法证明 writer 活/死，或 journal/lease 冲突 | 隔离 worktree、保留 reservation、启动 audit | 解析 artifact 或等 operator；审计后才重派/释放 | 把 unknown 伪装 failed/not-found，或 duplicate spawn |

目标程序：`quiesce new dispatch → classify in-flight handles → cheap terminal work可收敛则收敛 → durable refs写稳 → legacy有限drain → new session按class attach/poll/audit`。这不是 current handoff 已实现声明。

## 7. Machine facts、model evidence、quota 与 admission

### 7.1 Surface inventory 只是候选域入口

每个 target descriptor 至少包含：

- `harness_id`、`surface_id/kind`、origin/target role；
- binary absolute path、version/hash、driver/schema range、probe source/time；
- opaque auth/workspace fingerprint、auth kind/state/expiry、payer scope；
- live model IDs/efforts、structured result、permission、cancel/resume/nested-agent control；
- quota source/pool/bucket ref、freshness/error/circuit；
- account mutation、external write、nested orchestration、network/MCP 等 negative capabilities，值域需区分 `forbidden/unsupported/unknown/supported`。

必须分别发现 Claude native/CLI、Codex native/CLI、Cursor IDE plugin、`agent|cursor-agent` headless。PATH 只有其中任一种的正反 fixture 都要正确。

### 7.2 Auth、account 与 pool 固定边界

- Codex/Cursor 只读当前认证 identity；login/logout/account/session switch、credential import/copy/write 永久 forbidden，并以 process/fs spy 验收。
- Cursor first-party 与 API-included 是同 identity 下不同 pool；on-demand/BYOK/team/shared 另列，不合并成单一“Cursor剩余”。pool routing 不是换账号。
- Claude 账号池是独立既有能力；仍受原 board policy/identity guard，cross-harness allow 不扩大换号 authority。
- credential rotation 无法证明同账号时，旧 capability/quota/reservation 保守 invalidate。

### 7.3 Model evidence 与 live entitlement 分层

versioned registry 提供 alias/lifecycle/capability/price/cache、官方定位、可比 benchmark scaffold、community/KOL 弱证据、source/hash/retrieved/effective/expiry；live capability 证明当前 surface/account 实际可用 model/effort。生产 candidate 取交集：registry 有/live 无不派；live 有/registry 无标 `unclassified-new-model`，只允许低风险强验收 canary 或显式覆盖。

模型名、价格、benchmark 和 provider CLI 快照不得复制到本文。它们变化时更新 registry / host facts，而不是修改 capability model。

### 7.4 Quota observation、headroom 与 reservation

- observation 忠实保存 identity/payer/pool/bucket/unit/window/reset/source/schema/observed/valid/error；不同 aggregation key 永不 join。
- pure engine 只派生 `ample|tight|exhausted|unknown`、projected fit、forecast/confidence 与 reason；不冒充 provider 账单。
- target home snapshot store 为 0600、atomic revision、single-flight、soft/hard stale、reset invalidation、circuit；monitor 仅可选 prewarm，不是 correctness 前提。
- hook 只能 cached-read；pre-dispatch 才 live recheck，并在同 identity+pool 取得 reservation。
- overall tight 可改投另一个**自身 ample**的 pool；不能用便宜小模型偷烧目标 tight pool 尾部。

### 7.5 两阶段 route 与 admission transaction

1. Hard eligibility：surface/binary/auth/model/effect floor/quota freshness+fit/policy/permission/privacy/worktree/circuit/runtime 全部通过。
2. Advisory utility：比较 `P_accept`、total cost-to-accepted-result、quota opportunity、wall latency、context movement、orchestration/integration overhead、critical-path impact。

engine 接收调用方 objective/weights，输出 eligible/rejected、分项与 sensitivity；master 决定 quality-first/balanced/cost-first、接受/override advisory、最终 route 与 rationale。engine 不硬编码 provider/model 优先级。

```text
validate planning/routing/authority
  → read/refresh capability + quota
  → account+pool reservation under lock
  → worktree/baseline/permission/env/runtime live recheck
  → durable launch intent + starting attempt
  → native invoke+bind OR exact-runtime supervisor claim+spawn
  → verify real handle/hello
  → project running + task in_flight
```

相同 dispatch key 至多一个 launch claim/run；orphan audit 前 reservation 不释放。Fallback 只处理 allowlisted mechanical failures，如 binary/auth expiry、model unavailable/mismatch、quota/rate、startup/transport。policy、permission、privacy、workspace、安全拒绝、business block、acceptance failure和用户决定不得靠换 candidate 绕过。

## 8. Security、worktree 与 side-effect authority

- writer 只用 orchestrator-owned isolated worktree；同 worktree 同时一个 live writer；baseline/dirty/owner nonce spawn 前复核。
- permission profile 是 candidate 一部分，由 native adapter / provider driver 映射；默认 deny nested agents、commit/push/PR/merge、账号 mutation、外部写、未声明 network/MCP。
- child env 从最小 allowlist 构造，剥离 GitHub/cloud/非目标 provider credential；secret 不进 argv/board/journal/log。
- host 无法机械表达 write/nested/network deny 时，只允许 inspect 或 candidate ineligible；prompt 不是安全边界。
- commit、push、PR、merge、release、数据跨 provider、总配额续耗、destructive force 各自需要明确 authority；cross-harness allow 不蕴含任何一项。
- worker role 必须机械阻止 ARM master board、nested master、父 board direct write 和未经授权的 repository/external side effects。

## 9. Supervisor continuity、journal 与 runtime lifecycle

本节全部为 `target`，直到正式 runtime spec、ADR 和 active-run tests 晋升。current ccm 的 monitor、detached service 或 SEA 原路径覆盖不构成本节实现。

### 9.1 Durable run contract

run store 最小集合：immutable request/input hash、launch intent/nonce、runtime identity、supervisor lease、append-only framed journal、heartbeat/control endpoint、provider session、reservation/worktree refs、artifacts、last projected sequence。public handle 是 `run_ref`，不是 PID。

Provider driver 只拥有 host CLI flags/stream/parser/permission mapping；supervisor 统一拥有 process group/Windows Job Object、timeout escalation、redaction、journal/heartbeat/terminal。二者都不写 board。

### 9.2 Journal、projection 与 attach

- event 带 run/attempt、monotonic sequence、writer runtime/hash、timestamp、framing/checksum；半写尾部可恢复，unknown event 保留 raw evidence 而不猜业务语义。
- active-version ccm reconciler 以 `last_applied_seq` 幂等投影 attempt 摘要/terminal；old supervisor 永远 `board_write_mode=none`。
- control handshake 协商 control/journal ranges、runtime hash、nonce/process-start/boot identity；PID/session ID 不是 kill authority。
- 有 control 交集走 RPC；无交集但 base journal 可读走 journal-only；连 journal floor 不可读时 upgrade activation 必须拒绝。
- attach 在 run management lock 下登记 manager-session lease，不改变 provider account/worktree/session lineage，不 spawn 第二 worker。

### 9.3 Upgrade、reinstall、rollback 和 GC

目标方案需要 immutable version directories、stable launcher、current/previous、verified transaction、active-run lease、drain 和 lease-aware GC。新 task 走 new current，active run 固定 old runtime 自然收敛；普通 upgrade/reinstall/rollback 不 hot-reload、不强杀、不偷换已启动 image。

默认 reinstall 保留 active/unresolved runtime 与 `$CC_MASTER_HOME/runs`；uninstall 遇 active lease 拒绝；purge-home 是独立 destructive authority。force 必须逐 run 列出 orphan、control loss、child survival 和 reservation retention 后果，不能把删文件冒充成功停止。

## 10. Endpoint verification、outcome 与 HITL

| Evidence stage | 系统能证明 | master 必须做 | 不能推导 |
| --- | --- | --- | --- |
| provider process terminal | exit/event/structured schema/provider session | 检查 normalized result 和错误分类 | terminal=accepted |
| attempt succeeded | actual model/usage、artifact refs、worktree/input hash | 亲读 diff/产物，运行真实 tests/fixtures | succeeded=task done |
| verifier verdict | 独立/异构 review findings 与 gate evidence | 逐条裁决 finding，必要时 repair/replan | 空 review/绿色命令=无缺陷 |
| task done | acceptance 全部通过、artifact+verified、side effects 获授权 | 更新 board/outcome/estimate，收敛 deps | requested model=actual model |

acceptance failure 不是 transport fallback。master 应按诊断选择同 session repair、升 effort、换 family、重切 task 或 HITL，并创建新的 append-only attempt 与 rationale。

local outcome corpus 的 local-only minimal-data 方向已于 2026-07-10 批准，但实现仍为 `target`。实现时只保存 task bucket、actual route/model/effort、acceptance、rework、wall、usage/cost/quota delta、error/context movement、sample size/confidence；不保存 prompt/source/diff/credential/email/transcript，并支持 disable/export/purge。小样本不得自动翻转 production prior。

必须 surface 用户：cross-harness 总授权、跨 provider 数据边界、硬配额/付费续耗、手工 auth、external write/merge/release、critical quality-cost tradeoff、destructive cancel/uninstall/purge、产品方向。decision package 必须带 owner、options/tradeoffs、critical-path impact、fresh evidence、inputs hash/freshness和可执行入口；stale 先 reground。

## 11. Capability maturity L0–L4

| Level | 能力边界 | 可以诚实宣称 | 不能宣称 | 晋级 gate |
| --- | --- | --- | --- | --- |
| L0 Legacy origin-only | current board/DAG、origin-specific pacing、session-local native handle、true-done/HITL | 当前 harness 内编排 | cross-harness、全机 quota、durable native run | legacy clean；无 target 误写 shipped |
| L1 Machine visibility + shadow | surface/auth/model/quota facts、freshness、四层 context、planning/chains、shadow advice | master 可看见全机组合和解释建议 | 真实 spawn、quota guarantee | 三 origin cached summary 等价；unknown 保真；hook 零 credential/network |
| L2 Safe cross-harness inspect | 一个 CLI driver、reservation/live gate、read-only run/status/cancel/result、parent verify | opt-in 调研/review/诊断 | 安全 writer、跨 session 长跑、三 provider fallback | duplicate spawn=0；terminal≠done；cleanup；真实 inspect canary |
| L3 Durable multi-provider writer | isolated worktree/permission、supervisor/journal/lease/attach、immutable runtime、三 drivers/fallback | 可恢复真实 writer orchestration | 自动学习即最优、中央公平 daemon | origin crash/upgrade/handoff 不中断 managed run；security 负例全零 |
| L4 Economically adaptive | outcome posterior、forecast/sensitivity、多 board fairness、registry freshness、privacy lifecycle | 基于本地证据优化 accepted-result 成本/速度 | 统一模型排行榜或无置信区间自动真理 | shadow baseline、sample/interval、kill/rollback/export/purge；规模证据后才评 daemon |

成熟度是整条 evidence chain 的最小值；不能因为一个 provider canary 成功就把整个系统标成 L2/L3。

## 12. S0–S10 纵切与 safety gates

以下是已批准方向下的 target implementation slicing；进入每个切片前仍需对应 implementation spec/ADR/contract，把该切片的 schema、migration、tests 和 rollback 锁定。

| Slice | 纵向增量 | Dependencies | Endpoint / safety gate |
| --- | --- | --- | --- |
| S0 Contract foundation | planning/routing/attempt schema、conditional invariants、dedicated writers、legacy migration | A–F approved；slice spec/contract | legacy 全绿；routed start 无 route/handle 不能 in-flight |
| S1 Machine read-only skeleton | surface inventory、capability/quota schema+home store、cached context；Cursor headless发现 | S0 types | 三 origin 同 revision；hook 零 probe/secret；shadow only |
| S2 Runtime supply chain | immutable layout、launcher/current/previous、stage/verify/activate/rollback | A–F approved；runtime ADR/spec | migration dry-run；provenance/path/permission 负例不 activate |
| S3 Supervisor core | synthetic driver、run store/journal/lease、detach/cancel/reconcile/attach、projection | S0+S2 | parent death/upgrade/handoff same run；zero board direct write |
| S4 Quota admission | collectors、derived headroom、single-flight/circuit、reservation/live recheck | S1+S3 | unknown/tight/conflict spawn=0；reservation crash-safe |
| S5 Model registry | evidence schema/provenance/generator、live intersection、outcome privacy shell | S0+S1 | source/hash/effective date完整；不可比不join；unclassified fail-safe |
| S6 Codex inspect vertical | route advice→Codex CLI→terminal→uncertain→independent verify | S3+S4+S5 | opt-in read-only canary；actual model/usage/result完整；terminal≠done |
| S7 Safe writer | worktree lease、permission/env/redaction、process-tree cleanup | S6 | isolated write canary；zero commit/push/nested/credential leak |
| S8 Claude + Cursor | Claude quota unknown保真、Cursor headless/dual-pool、三路safe fallback | S4+S7 | auth≠quota、pool不混、account mutation=0、taxonomy不绕权 |
| S9 Plugin/hook/read model | canonical policy、three-origin delivery/native ledger、using-ccm、viewer/report、worker role | S1+S6+S8 | 任意 origin 同事实/同 run；Track A/B等价；frontend零推理 |
| S10 Learning/rollout | shadow eval、local outcomes、kill switches、metrics、retention/operator rollout | S6+S7+S8+S9 | safety先归零；价值有baseline/区间；kill/rollback有效 |

```text
direction ─┬─> S0 ─┬─> S1 ─┬─> S4 ─┬─> S6 ─> S7 ─> S8 ─> S9 ─> S10
           │       │       │       └─> S8
           │       │       └─> S5 ─> S6
           │       └─> S3 ─────────> S6
           └─> S2 ────────> S3
```

| Gate | 阻止什么 | 必要证据 |
| --- | --- | --- |
| SG0 contract | 自由字段伪造 route/attempt | dedicated/append-only writer property tests |
| SG1 visibility | installed/auth/model/quota 越级推理 | surface/freshness/negative capability fixtures |
| SG2 runtime | detached child在upgrade/handoff失管 | immutable pin、lease/journal/attach、active-run e2e |
| SG3 admission | unknown/tight/并发TOCTOU仍spawn | live recheck + reservation concurrency/crash tests |
| SG4 writer | worktree/credential/side-effect越权 | isolated lease、env/process/fs spy、cleanup tests |
| SG5 fallback | policy/security/acceptance failure被换模掩盖 | failure taxonomy golden + chain monotonicity |
| SG6 parity | 三 origin 各自发明判断或假 parity | Capability INTENT + Track A/B equivalence + host probe |
| SG7 learning | 小样本/隐私数据自动改 production | shadow baseline、confidence、privacy/export/purge tests |

## 13. Current / partial / target gap matrix

本表是本文唯一的成熟度快照。current 证据变化时必须回读实现和 host facts，并在同一 PR 更新本表。

| Domain | Current | Partial / honest gap | Target | Slice |
| --- | --- | --- | --- | --- |
| Board/lock/DAG | board v2、状态机、lock、ready/graph/estimate | planning/routing/attempt 不存在 | additive contracts、conditional gates、dedicated writers | S0 |
| Task CLI | add/update/start/done 等 | routed task 可无 route 直接 start | planning/routing dedicated writers、dispatch/run control | S0/S6 |
| Machine registry | 已知 host 安装/session/usage descriptors；Cursor IDE plugin 与 `agent|cursor-agent` CLI 已有独立 `ccm/machine-surface/v1` read-only descriptors、auth/model/quota unknown 保真与 negative capabilities | 仅 Cursor C1 slice；其余 host 尚无统一 surface 快照，Cursor model/quota/permission 仍无 live proof | 全 host surface-level capability snapshots | S1 |
| Account boundary | Claude token-blind vault/policy；Codex account mutation unsupported | Cursor 需要全路径 spy；无统一 opaque auth snapshot | provider-neutral identity + Codex/Cursor hard negative | S1/S8 |
| Usage/pacing | 三路 reader、engine pacing/forecast、monitor sweep | 单 origin 窄 signal；monitor非持久store；multi-bucket/pool语义不足 | home machine quota read model + honest derivation | S1/S4 |
| Reservation | 无 | pacing 不是 reservation | account+pool lease/live recheck/orphan retention | S4 |
| Model guidance | skills 中已有 per-host 模型档/选型 prose | 无 live entitlement × versioned evidence registry | registry/provenance/generator/outcome calibration | S5/S10 |
| Cross route policy | additive task planning/routing contract、ample/tight 明示 chain、cached-only pure shadow advice（同 harness CLI 不折叠 native） | 无 live quota admission/reservation/attempt/spawn；当前 advice 不授权 dispatch | deny-by-default mechanical admission、master rationale、可恢复 attempt | S0/S4/S5 |
| Worktree/permission | board记录worktree；已有安全范式 | 无 lease/env/profile/provider enforcement | isolated writer + permission compiler + redaction | S7 |
| Provider execution | 无 cross driver | CLI research 是设计事实，不是 runtime | driver facets + structured result/error fixtures | S3/S6/S8 |
| Supervisor/run store | monitor有 detached service 技术片段 | detached/unref 不等于 attempt supervisor | per-run journal/lease/process tree/control/artifacts | S3 |
| Attach/handoff | board可re-arm；legacy handoff/drain | 无run manager/control；叙事偏session-bound | 四类handle分流 + same-run attach/reconcile | S3/S9 |
| Runtime lifecycle | Unix SEA原路径替换；singleton reconcile | 无immutable/lease/protocol/Windows工业合同 | stable launcher + side-by-side + drain/GC/provenance | S2/S3 |
| Plugin substrate | 三host packages、SAP/PHIP/commands/hooks；三 origin 已消费同一 `ccm/origin-context-delivery/v1`（≤4KiB、脱敏、shadow-only），Claude/Codex SessionStart、Cursor verified postToolUse Track B | 无 native ledger/真实 dispatch；Codex 无 mid-turn batch event，Cursor dynamic SessionStart 仍是已确认 gap | canonical policy + host landing + worker role + equivalence | S9 |
| Native subagent | 三host已有各自指导/工具面 | handle/result/cancel durability未统一 | native attempt create/bind/heartbeat/result/cancel | S0/S9 |
| Coordination/HITL | inbox、discuss、Stop continuation、judgment logs | route-loss/run attention taxonomy未接入 | decision-grade notification + fresh package | S9 |
| Viewer/report | board status/report/web viewer | 无planning/route/quota-at-selection/attempt/operator attention | one read model；frontend render-only | S9 |
| Verification | true-done/endpoint discipline | provider result/outcome linkage无 | terminal→independent verify→done/outcome | S6/S10 |
| Tests/rollout | board/account/usage/monitor/services/release tests | 无provider/supervisor/crash/canary/parity/lifecycle eval | hermetic fixtures + opt-in canary + kill/metrics | all/S10 |

不得用邻近 current 能力代称 target：monitor ≠ quota store；detached child ≠ supervisor；plugin installed ≠ headless eligible；provider success ≠ done；Unix inode存活 ≠ runtime lifecycle。

## 14. N+1 host onboarding checklist

### 14.1 Scope 与事实

- [ ] 分开 origin interactive/plugin 与 target headless/provider surface；descriptor 独立 probe。
- [ ] 新增 tracked host facts，记录目标版本、official source、retrieved_at、real probe 和冲突仲裁。
- [ ] binary/config/plugin/auth/model/quota 逐字段证明，unknown 不由相邻字段推导。
- [ ] account mutation、nested orchestration、external write、network/MCP 等 negative capability 明确。

### 14.2 Plugin SAP/PHIP/command

- [ ] `skills/_hosts/<host>/capabilities.yaml` 与每个 distributed skill strategy；默认 canonical+slot/overlay。
- [ ] hook host strategy/registration/launcher；先 Capability INTENT / hook CONTRACT，再实现。
- [ ] command strategy/coverage；带参入口不假设 skill args 或其他 host command 形状。
- [ ] path token/install root/data root/cwd/runtime env 均有真实 probe。
- [ ] Track A 跑 source→projection→host-native dist→probe；Track B 有 divergence+substitute+acceptance。

### 14.3 Cross-harness core

- [ ] inventory/capability/quota/execution facets 与 origin plugin adapter 是独立 contract。
- [ ] quota source 保留 pool/payer/aggregation/freshness；不可见即 unknown。
- [ ] invocation/result/actual model/cancel/resume/permission/workspace/error fixtures 齐全。
- [ ] native attempt 可 create/bind/heartbeat/result/cancel，真实 handle 缺失不 running。
- [ ] worker 不能 ARM/nested master/父 board direct write；account mutation 逐 host 明确。

### 14.4 Delivery、continuity 与 release

- [ ] ARM/session/resume/handoff 可认回 board；SessionStart/compact/Stop/pre/post/batch 逐项 Track A/B。
- [ ] cached summary 有 payload cap、delta hash/dedupe、fail-open/privacy；hook 零 probe。
- [ ] 新 origin 按 handle class 分流并对 durable run attach/reconcile；duplicate spawn=0。
- [ ] coordination/HITL 可达；无 completion event 时有 watchdog/reconcile floor。
- [ ] Capability Cards、matrices、equivalence fixtures 更新；不只测生成文件存在。
- [ ] package/install/upgrade/uninstall/rollback 与 active-run lifecycle 通过。
- [ ] provider schema drift 只 circuit-open 对应 facet，不拖垮其他 host/legacy path。

## 15. Industrial Definition of Done

### 15.1 Endpoint scenarios

1. 同一 frozen board+machine revision 在三 origin 生成语义等价、脱敏、≤4 KiB context；坏 cache/collector sleep 时 hook RC0 且零 network/credential read。
2. Codex/Cursor `auth=true, quota=unknown`从不 automatic eligible；Cursor IDE/headless 独立安装/认证正反 case 正确。
3. 同 task 在三 origin 得到同 ccm eligibility/reason；真实 native capability/overhead 可改变候选事实，但 host 不改 core semantics。
4. contract-enabled task 缺 profile/chains/authority/reservation/handle 任一项不能 in-flight；generic setter 不可绕过。
5. 并发 dispatch 同 pool 不超订；相同 idempotency key/launch intent duplicate worker=0。
6. native subagent 无真实 handle 不 running；重复 bind/terminal 幂等。
7. origin 强杀后 durable supervisor 继续；任一新 origin attach same run；legacy/journal-only/orphan 正确分流。
8. PID reuse/reboot/protocol no-overlap 不误 attach/kill；orphan audit 前不重派/释放 reservation。
9. active run upgrade/reinstall/rollback：旧 run 固定 old hash，新 run 走 current；零中断、零reservation loss、零 active runtime 误 GC。
10. old supervisor/new board direct write=0；active-version reconciler 按 journal seq 幂等 projection。
11. worker 尝试 ARM/nested/commit/push/external write 或 Codex/Cursor account mutation 被机械拒绝。
12. provider succeeded 但 diff/test/schema 不满足时 task 不 done；acceptance failure 创建新 attempt/replan 而非 transport fallback。
13. Cursor SessionStart probe 失败则 registration off；PostToolUse/Stop substitute 不写作 full reinject；无 PostToolBatch host 不伪造 batch。
14. global disable 后 new dispatch=0，active run继续drain/可显式cancel，legacy origin-only仍可用。
15. N+1 host 未向 engine 加品牌分支、未复制 canonical policy/provider facts，并通过完整 checklist。

### 15.2 Safety metrics 必须先归零

- unknown/tight/hard-stale/unauthorized cross-harness spawn = 0；
- credential/account mutation/secret leak/unauthorized side effect = 0；
- duplicate spawn、reservation提前释放、orphan writer误清理 = 0；
- provider success直接task done = 0；old supervisor写new board = 0；
- upgrade/reinstall中断active run、active runtime误GC = 0；
- hook network/credential read、payload超cap、identity泄漏 = 0；
- frontend eligibility/utility重算或board write = 0。

### 15.3 Value 与 operability

- terminal run 的 normalized terminal/artifact/actual-model evidence coverage 必须公开；目标值、样本量和缺失项由 implementation spec 锁定。
- compatible attach 与 journal-only observability 必须在声明支持的平台达到各自明确 SLO。
- 经济型 route 只有在 final acceptance 不劣于 baseline 的前提下，才比较 cost-to-accept 改善。
- 并行吞吐以 critical-path wall、rework 和 acceptance 联合衡量；不以 cross-harness call rate 作为成功指标。
- route override/fallback/evidence coverage/requested-vs-resolved 必须可审计。
- cached context latency、payload、single-flight provider call 数必须有机械 SLO。
- 所有价值指标必须报告样本量、置信区间与 coverage；未达样本门不自动调 production weights。

### 15.4 Kill、rollback 与 rollout

最严格 kill switch 生效：runtime activation disable、supervisor attach RPC disable、runtime quarantine/drain、global/home cross-harness disable、quota refresh disable、hook injection disable、provider/collector circuit、board deny、task candidate disabled。停止新 dispatch 不等于 kill active run；rollback 保留 attempt/artifact/lease，只切 current 或关闭单 driver。

Rollout 顺序：fixture-only contracts → machine read-only/context shadow → runtime synthetic active-run gate → shadow route → Codex inspect → isolated writer → Claude → Cursor → explicit automatic fallback → viewer/operator → local outcome suggestion。普通 CI 不打付费 provider；真实 canary 必须 explicit opt-in、有 budget、cleanup 和 rollback。

## 16. Review checklist

任何实现 PR 或设计变更应逐项回答：

- [ ] 它落在哪个 capability、state 和 slice？是否把 target 误写成 current？
- [ ] 唯一 owner/writer 是谁？是否引入第二份 route/quota/model/process 真相？
- [ ] unknown、stale、partial、unsupported 是否保真并 fail 在正确边界？
- [ ] 三 origin 共享的是 intent 还是字节形状？Track A/B 是否诚实？
- [ ] host-native 与 cross-CLI 是否共用 task/route/attempt/true-done？
- [ ] hook 是否 cached-only、脱敏、有界、可去重、fail-open？dispatch 是否独立 fail-closed？
- [ ] account、worktree、permission、side-effect、worker role 是否机械可证？
- [ ] origin session 消失、ccm upgrade、protocol no-overlap、PID reuse、reboot 时会怎样？
- [ ] provider terminal 与 task acceptance 是否仍有父层验收闸？
- [ ] negative fixtures、endpoint scenario、kill/rollback 是否与正路径同 PR？
- [ ] 易变 host/model/price/CLI facts 是否只链接权威材料，而未复制进本模型？

这份模型的最终约束可以压缩成一句话：

> 任意 origin harness 的 master 必须看见同一套可追溯事实、执行同一套授权和验收语义，并通过 ccm 管理同一个可恢复 attempt；host 只决定 landing 和 native transport，不决定事实、状态机或真完成。
