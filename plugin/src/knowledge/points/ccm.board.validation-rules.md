---
point: ccm.board.validation-rules
---

## 权威陈述

<!-- ccm:k:start point:ccm.board.validation-rules -->
## N. 校验规则全集速查（FMT / GRAPH / BIZ）

这一节是为了让你**用 ccm 编辑字段 / 操作 board 时一次就写对**——不因不知道某条规则而反复撞 `exit 3` / warn 低效重试。

**level 含义（读表前必看）：**

| level | 后果 | 行动 |
|---|---|---|
| **hard** | **写不进去（exit 3）**——ccm 写命令在落盘前拒绝；万一 `Bash` 手改漏过 board-guard 溜进来则 PostToolUse lint hook 事后报、`run-tests.sh` / CLI 端点闸真红 | **必须先满足才能写盘** |
| **warn** | **能写进去，但有问题**——lint 报告里出现，多数是 graceful degrade（对应功能静默关闭）或可疑数据 | 当回合修掉，别带病往下跑 |
| **reserved** | 登记在册、lint 暂不强制 | 操作上推荐满足，但不会被拦 |

规则按家族分组：**FMT**（格式 / 类型）· **GRAPH**（图完整性）· **BIZ**（条件业务规则）。已经在正文别处讲透的，表里给一行 + 指向该小节。

### FMT 家族（格式 / 类型）

| 规则 id | level | 什么触发它 | 怎么一次写对 |
|---|---|---|---|
| `FMT-JSON` | hard | board 不是合法 JSON，或顶层不是对象 | 用 ccm 写盘（写入校验挡大多数手写坏 JSON）；手改时检查逗号/括号配对 |
| `FMT-SCHEMA` | hard | `schema` 不是字符串字面量 `"cc-master/v2"` | 永远让 bootstrap / ccm 建板，别手写 schema；当前期望值 `cc-master/v2` |
| `FMT-GOAL` | hard | `goal` 不是字符串 | `ccm board init --goal "..."` / `ccm board update --goal "..."`，goal 永远是字符串（空串也合法） |
| `FMT-GOAL-CONTRACT` | hard | 存在的 `goal_contract` schema/revision/assurance/updated_at/brief ref+sha256 形状非法 | 只用 `ccm goal set / confirm / amend` 写；Brief 路径与 hash 另由 `ccm goal check` 校验 |
| `FMT-DEADLINE` | hard | 存在的 `goal_contract.deadline` 形状非法：`state` 不在 `{pending,asserted,confirmed,none}`；`asserted`/`confirmed` 缺 `at` 或 `at` 非严格 ISO-8601 UTC；`none` 带 `at`；`precision` 非 `{minute,day}`；`kind` 非 `{hard,soft}`；`rev` 非整数≥1；`provenance.source` 非枚举 | 只用 `ccm goal deadline set/confirm/confirm-none/amend` 写（见 [I 小节](#o-交付-ddl-字段取值--四态状态机)）；`deadline.updated_at` 形状坏只 warn（`FMT-TIME`·不拦写盘） |
| `FMT-OWNER` | hard | `owner` 不是对象，或 `active` 非 bool，或 `session_id` 非字符串 | 别手改 owner——它是武装闸读的；session_id 空串 `""` 合法（待显式 re-arm 认领） |
| `FMT-HARNESS` | warn | `owner.harness` 存在但不在 `{claude-code,codex,cursor,kimi-code,unknown}` | 不手填；ARM 时由 `ccm board stamp-harness` 从可信 harness env 写入。缺失向后兼容为 `unknown`；坏值只 warn，`ccm peers` 按 unknown 单例池降级 |
| `FMT-GIT` | hard | `git` 不是对象，或 `worktree`/`branch` 存在却非字符串 | `ccm board update --branch / --worktree`，值都是字符串 |
| `FMT-TASKS` | hard | `tasks` 不是数组 | tasks 永远是数组（`[]` 合法）；用 `task add` 而非手拼 |
| `FMT-ID` | hard | task 不是对象，或 `id` 不是非空字符串 | `ccm task add <id>` 的 id 必填非空 |
| `FMT-ID-UNIQUE` | hard | 同一个 task id 出现多次 | id 全局唯一；不要复制粘贴 task 忘改 id |
| `FMT-STATUS` | hard | `status` 不在 8 个枚举值内 | status 走 verb（`task start/done/block/set-status`），不手写——见 [B 节](#b-status-八态语义--生命周期) |
| `FMT-DEPS` | hard | `deps` 缺失、非数组、或含非字符串元素 | deps 是钉死窄腰字段，必填；无上游写 `--deps`（空数组），有上游 `--deps T1,T2` |
| `FMT-PARENT` | hard | `parent` 键存在但值非「非空字符串」 | `--parent <ownerId>`（单个存在的 owner id 字符串），或不写 parent 让它成顶层 |
| `FMT-EXECUTOR` | hard | `executor` 不在 5 个枚举值内 | `--executor` ∈ {user, master-orchestrator, subagent, workflow, external}——见 [C 节](#c-executor-五种语义--选择决策树) |
| `FMT-ROLE` | hard | `role` 不在 {normal, fill-work} 内 | `--role normal`（默认）或 `--role fill-work` |
| `FMT-REF` | hard | `references[].ref` 不是绝对路径或 URL（含相对路径） | `--ref kind:/abs/path` 或 `--ref kind:https://...`，**禁相对路径**——见 [L 节](#l-referencesartifactverified-语义) |
| `FMT-TYPE` | warn | `type` 不在已知 taskType 集合内（开放枚举） | 用已知 type；未知值不致命但可能是 typo，会让基于 type 的 BIZ 规则漏触发 |
| `FMT-REF-KIND` | warn | `references[].kind` 不在 refKind 枚举内（开放枚举） | kind ∈ {spec, plan, doc, web, code, issue, other}，未知值不致命 |
| `FMT-BLOCKED-ON` | warn | `blocked_on` 既非 `"user"` 也非存在的 task id | `task block --on user` 或 `--on <存在的 taskid>`——见 [G 节](#g-blocked_on-怎么选) |
| `FMT-WIP` | warn | task 级 `wip_limit` 非数字 | `--wip-limit N`（整数）；非数字会让 per-owner WIP 覆写静默失效 |
| `FMT-MODEL` | warn | task `model` 存在却非字符串 | 从 fresh `ccm provider facts` 与 live admission 取得实际 selector 后，`ccm task update <id> --set model=<admitted-provider-model-id>`（裸 path 即本 task）；非 string → estimate 层 tier 分层校准降级忽略 |
| `FMT-SCHEDULING` | warn | `scheduling.wip_limit` / `owner_wip_limit`（或旧板顶层 `wip_limit`）非数字 | `ccm board update --wip-limit N --owner-wip N`（整数）；非数字 → WIP 软警告静默关闭 |
| `FMT-WATCHDOG` | warn | canonical `watchdog` / legacy `wakeup` 的 `job_id` 缺失或空白、`mechanism` 不在枚举内，或 `armed_at`/`fire_at` 非严格 ISO-8601 UTC | 先创建真实机制拿 handle，再 `ccm watchdog arm --mechanism <cron/loop/monitor/shell> --fire-at YYYY-MM-DDTHH:MM:SSZ --job-id <handle>`；存量缺 handle 先 `status` 诊断、`disarm` 后重建——见 [K 节](#k-watchdog何时-armwatchdog--legacy-wakeup-字段含义) |
| `FMT-META` | warn | `meta.template_version` 非整数，或 `meta.created_at` 非 ISO-8601 UTC | meta 由 bootstrap 写，别手改；template_version 是整数 |
| `FMT-LOG` | warn | `log` 非数组，或条目缺 `ts`/`summary`、`ts` 非 ISO、`kind` 不在枚举内 | `ccm log add "<summary>" --kind <enum>`；ts 自动盖严格 UTC，summary 非空 |
| `FMT-JUDGMENT-CALLS` | warn | `judgment_calls` 非数组，或条目 `summary` 空、`category`/`severity`/`status` 不在各枚举内、时间戳非 ISO | 用 `ccm jc add/resolve` 而非手拼——见 [H 节](#h-judgment_calljc何时建severity-怎么定) |
| `FMT-CADENCE` | warn | `cadence` 非对象，或 iteration 的 `id` 空、`status` 不在 {open,shipped}、时间非 ISO、`members` 非字符串数组 | 用 `ccm cadence update/open/ship`；deadline 严格 UTC——见 [I 节](#i-cadence-与-iteration节奏怎么定) |
| `FMT-BASELINE` | warn | `baseline` 非对象，或 `captured_at`/`t0`/`history[].reset_at` 非严格 ISO-8601 UTC、`task_estimates`/`dag_snapshot` 非对象、`bac_h` 非数字、`history` 非数组 | 用 `ccm baseline snapshot/reset` 维护、别手拼；时间严格 UTC（estimate evm 读它，格式不对则 EVM 时间轴错位） |
{{USING_CCM_FMT_POLICY_ROW}}
| `FMT-COORD` | warn | `coordination` 非对象，或 `priority` 不在 `{urgent,high,normal,low,trivial}` 枚举，或 `state`/`state.current`/`state.planned` 非对象、数字字段（`active_tasks`/`burn_contribution`/`cost_to_complete_pct`）非数字、人类可读字段（`workload`/`remaining_work`）非字符串 | 全 optional·缺即降级（`ccm peers` 把该维度退 null）；priority 仅五挡——非法值退化为 normal。永不 hard（advisory ✎·fail-safe）——见 [A 节](#a-task-字段速查) coordination 块 |
| `FMT-INBOX` | warn | `coordination.inbox` 存在但非数组，或通知条目 id 非空唯一 / kind / status / strength / ISO 时间 / consumed_at 状态对应关系不合法 | 缺失 = 空 inbox；append 用 `ccm coordination notify`，消费用 `ccm coordination inbox ack <id...>`，不要手拼。`kind` 闭集、`status` 单调；坏形态只 warn，读取侧跳过坏条目 |
| `FMT-RUNTIME` | warn | `runtime` 非对象，或已知键类型不合法（时间锚 `last_identity_remind` / `last_critpath_remind` / `last_goal_remind` / `last_account_switch` / `stop_allow_until` / `last_deadline_risk_check` 须严格 ISO-8601 UTC；`last_deadline_risk_fingerprint` 须非空字符串） | hook-owned ✎ 参数区：用 `ccm board set-param <白名单 key> <value>` 写（白名单 + 按 key 声明类型校验在 verb 层·时间锚要 ISO / 指纹要非空字符串）；缺/坏一律 graceful-degrade（周期 hook 退化为「从未提示」·首次必提示；Stop 释放闸退化为继续阻止停止）。未知键 silent-on-unknown。永不 hard |
| `FMT-AGENTS` | warn | `agents` 存在但非数组；或既有 agent 字段形状/枚举/时间/link/ref 非法；`dispatch` 若存在但 schema/key/digest/phase/claim/PID/evidence/typed capability/terminal/reconciliation 形状非法也会命中 | 手工登记只用 `ccm agent create/bind/link/terminal/probe`，tracked worker 用 `ccm worker dispatch` 专用 writer；别 `--set-json` 手拼。graceful：坏形状不拦普通 lint 写盘，但 tracked aggregate rehydrate 会额外拒绝伪造 running、缺 PID evidence 或跨 task link——见 [C.6 节](#c6-agents运行时-agent-登记簿) |
| `FMT-ESTIMATE` | warn | `estimate` 不是 `{value:number, unit:string}` 对象 | `--estimate 3h`（ccm 自动解析成对象），别手拼——见 [E 节](#e-estimate-怎么估) |
| `FMT-ACCEPTANCE` | warn | `acceptance` 既非字符串也非对象，或对象 `criteria` 空、`criterion.status` 不在 {pending,met,failed} | `--accept "一句话"` 或 `--set-json acceptance={criteria:[...]}`——见 [D 节](#d-acceptance-怎么写好) |
| `FMT-DEPENDENCY-GATE` | hard | `dependency_gate` 存在但不是 `{kind:"review",required_verdict:"APPROVE"}` | 用 `task add|update --review-gate APPROVE` 声明；非法 gate fail closed |
| `FMT-REVIEW-VERDICT` | hard | 非空 `review_verdict` 不在 `{APPROVE,REQUEST-CHANGES}` | 用 `task done --review-verdict APPROVE|REQUEST-CHANGES`；缺失/null 表示尚无结论 |
| `FMT-CONTRACTS` | hard | `meta.contracts` 只出现 planning/routing 一半、版本不是精确 v1、activation time / grandfathered terminal 形状坏 | 只用 `ccm board enable-contract` 成对启用；两者都缺就是合法 legacy；不要手写 `meta.contracts` |
| `FMT-TASK-PLANNING` | warn | `task.planning` 存在但不满足 `ccm/task-planning/v1` | 用 `task set-planning --profile` whole-object writer；enabled subagent 的缺/坏还会升级命中 `BIZ-ROUTED-PLANNING-REQUIRED` hard |
| `FMT-TASK-ROUTING` | warn | `task.routing` 存在但不满足 `ccm/agent-routing/v1` | 用 `task set-routing --policy` 建 envelope、`route-bind` 写 selection/attempt；enabled subagent 的缺/坏还会命中 route BIZ hard gate |
| `FMT-DELIVERY-CONTRACT` | hard | `delivery_contract` 不是 declared v1、target/snapshot 形状坏，或试图持久化 strict | 用 `target set/refresh`；只持久化 `mode:declared`，strict 仅 dry-run preview |
| `FMT-TASK-DELIVERY` | hard | candidate/observation/proof 形状或 immutable binding 坏，或持久化 derived qualification | 只用 `task attest-delivery`；proof 必须精确绑定当前 candidate 与冻结 target snapshot |
| `FMT-DEPENDENCY-REQUIREMENTS` | hard | requirement 不是 candidate/delivered、delivered target 未声明、waiver authority/scope/expiry 坏，或写了 `qualified` bool | 用 `dependency require/default/waive`；qualification 永远读取时派生 |
| `FMT-TIME` | warn | 时间锚（`created_at`/`started_at`/`finished_at`/`owner.heartbeat`）存在却非严格 ISO-8601 UTC（`YYYY-MM-DDTHH:MM:SSZ`） | 用 ccm verb 自动盖戳（盖标准格式）；手填时严格 UTC 定宽、无时区偏移、无毫秒 |

### GRAPH 家族（图完整性）

| 规则 id | level | 什么触发它 | 怎么一次写对 |
|---|---|---|---|
| `GRAPH-DANGLING` | hard | `deps` 指向一个不存在的 task id | dep 必须指向真实存在的上游 id；`ccm next` / `ccm task list` 先确认 id——见 [F 节](#f-deps-怎么连) |
| `GRAPH-SELFLOOP` | hard | `deps` 含自己（自环） | 删掉指向自己的 dep（自环 = 永远 blocked） |
| `GRAPH-CYCLE` | hard | deps 图存在有向环 | 打破环——删环上某条 deps 边，让依赖回到无环 DAG |
| `GRAPH-PARENT-EXISTS` | hard | `parent` 指向一个不存在的 owner id | parent 指向真实存在的 owner；现有 id 用 `ccm task list` 查——见 [J 节](#j-parent--owner-嵌套语义) |
| `GRAPH-PARENT-DEPTH` | hard | owner 的子节点自己又是某些节点的 parent（违反 depth=1） | owner 只能含 leaf 子；孙节点改挂顶层 owner，或把中间节点升为顶层——见 [J 节](#j-parent--owner-嵌套语义) |
| `GRAPH-PARENT-CYCLE` | hard | parent 链存在环（含自指 / 2-环） | parent 链回到「子单跳指向无 parent 的顶层 owner」 |
| `GRAPH-ROLLUP` | warn | 标 `done` 的 owner 仍有非 done 子节点 | 确认子全 done + 父端点验收过再标父 done；容许「父整合中、子刚标完」的瞬态——见 [J 节](#j-parent--owner-嵌套语义) |
| `GRAPH-CONNECTED` | warn | 把 `deps` ∪ `parent` 容器边当无向边算弱连通分量（**在非 fill-work 节点上**），分量 > 1（图被切成多个互不相连的子图 / 有孤岛节点） | 为目标聚焦希望图全通（但不强求·warn 非 hard）；给孤岛节点补上指向主图的 deps（它依赖谁 / 谁依赖它），或确认它确实独立后忽略本 warning。消息会列出各分量的 task-id（主图 = 最大分量、其余 = 孤岛）。**连通性 = deps ∪ parent 容器边**（嵌套子任务 `deps:[]` 经 owner 连进主图·不误判孤岛）。**`role:fill-work` 豁免**（故意独立·从节点集剔除·不 cry-wolf）；**`awaiting-user`/决策门不豁免**（本应 gate 某主图工作节点·孤立即真遗漏·用户拍板）——见 [F 节](#f-deps-怎么连) |

### BIZ 家族（条件业务规则）

| 规则 id | level | 什么触发它 | 怎么一次写对 |
|---|---|---|---|
| `BIZ-AWAITING` | hard | awaiting-user 节点（`blocked_on:"user"` + status ∈ {blocked, in_flight}）缺 `decision_package` 对象 | `task block --on user --decision @file`，必须带采访包——见 [G 节](#g-blocked_on-怎么选) |
| `BIZ-GOAL-PENDING` | warn | `assurance:pending` 的 Goal Contract 已有 ready / in_flight / uncertain 执行任务 | 先澄清并用 `ccm goal set` / `goal amend` settle，再切 DAG / 派发；等待用户时只保留完整 `blocked_on:user` `decision_package` |
| `BIZ-DEADLINE-PENDING` | warn | 交付 DDL 未 settle（`deadline` 键缺失或 `state:pending`）却已有 ready / in_flight / uncertain 执行任务 | 拆 DAG 前先 `ccm goal deadline set/confirm`（确认交付截止期）或 `ccm goal deadline confirm-none`（确认无 DDL）——见 [I 小节](#o-交付-ddl-字段取值--四态状态机) |
| `BIZ-DEADLINE-OVERDUE` | warn | `state:asserted|confirmed` 的交付 DDL 已过期（`now>=at`）而板未归档且交付未验收完成——**交付验收 marker** 读显式 `goal_contract.delivery.accepted:true`（用户/缩范围/分阶段场景显式声明）或全 task trulyDone 派生；已验收即不再 overdue | 按 `kind` 分档响应，判据一致：**`soft`（软目标）超期 → advisory nudge**（提示但不阻断·同步进度/剩余交付物后可继续推进·软目标超期不强制停派）；**`hard`（硬承诺）超期 → directive**（须先向用户报告状态/剩余交付物/方案，由用户裁决延期 `ccm goal deadline amend --user-authorized` / 缩范围 `ccm goal amend` / 分阶段 / 终止）。两档都别静默降验收/伪造完成 |
| `BIZ-CADENCE-SHIPPED` | hard | iteration 标 `shipped` 但 members 未全部 done+verified（含不存在的 member） | 先把成员推到 done+verified 再 `ccm cadence ship`，或移出 members——见 [I 节](#i-cadence-与-iteration节奏怎么定) |
| `BIZ-CADENCE-MISSING-ESTIMATE` | warn | open iteration 的 member 缺有效 `estimate` | 给 member 补 `--estimate 3h` 这类估时，或移出本轮；否则 overbook / critical-path 判断会失明——见 [E 节](#e-estimate-怎么估) 与 [I 节](#i-cadence-与-iteration节奏怎么定) |
| `BIZ-CADENCE-OVERBOOKED` | warn | open iteration 的 member 估时总量超过 timebox（deadline-started_at 或 `target.ship_every`，含小幅 grace） | 拆小、移出非本轮 member、降低 WIP 后重排；不要用 shipped 掩盖超载 |
| `BIZ-CADENCE-CRITICAL-PATH-OVER` | warn | open iteration 的 member 依赖关键路径超过 timebox（含小幅 grace） | 重切临界链上的大节点，删假依赖边，或把 scope/timebox 取舍 surface 给用户 |
| `BIZ-TASK-OVERSIZED-FOR-CADENCE` | warn | 单个 iteration member 的 estimate 超过 `cadence.target.ship_every`（含小幅 grace） | 默认再切成能在一个 cadence 目标内验收的薄片；若不能切，写清理由并接受 warn |
| `BIZ-AGILE-ACCEPTANCE-MISSING` | warn | cadence member 缺清晰 `acceptance` | 给该 member 补一句 DoD 或 criteria；没有验收标准的节点不该作为可 ship 切片收口 |
| `BIZ-ESTIMATE-STALE` | warn | 实测 duration 与 estimate 明显漂移，提示下游重估 | 用新的实测反馈重估未开始下游，必要时重开 baseline / replan |
| `BIZ-STATUS-DEPS` | warn | deps 门控不一致：`ready` 但 deps 未全满足 / `blocked` 无 `blocked_on` 但 deps 全满足 | **CLI 写路径经 `reconcileGating` 永不产生此态**——看到它多半是手改 board；跑任意 ccm 写命令触发归一，或 `task unblock`/`set-status` 手动对齐——见 [B 节](#ready--blocked-由系统按-deps-自动门控) |
| `BIZ-NATIVE-ATTEMPT-PROJECTION` | **hard** | opt-in task 的 attempt/create/cancel/binding schema、ordinal/dispatch identity、reconciliation 完整性/顺序/值绑定、state×record 时序可达性或 status/handle 专属 projection 不一致，或 active history/handle 被 generic 写路径伪造 | 不手改、不用 generic verb 或 `--force` 修；只走 `native-attempt-create/bind/cancel/terminal/reconcile`，让认证 evidence 驱动 projection——见 [B 节](#native-attempt-专属-projection) |
| `BIZ-DECISION-PACKAGE` | warn | `decision_package` 在但字段不全：`context_md`/`what_i_need`/`enter_cmd` 空、`ask_type` 不在枚举、decision 型 `options` 空、`inputs_hash` 非 `sha256:<64hex>` | 备齐采访包字段；decision 型必须有非空 options——见 [G 节](#g-blocked_on-怎么选) |
| `BIZ-DEV-REFS` | **hard** | `type=development` 的 task 缺 `kind=spec`≥1 或 `kind=plan`≥1 引用 | development task 加 `--ref spec:/abs/spec.md --ref plan:/abs/plan.md`（`task add`）或 `--add-ref`（`task update`）；`--force` 可越——见 [L 节](#l-referencesartifactverified-语义) |
| `BIZ-ACCEPTANCE-REQUIRED` | warn | type ∈ {development, development-demo, acceptance, e2e-integration} 但 `acceptance` 为空 | 这些 type 必须带 `--accept`——见 [D 节](#d-acceptance-怎么写好) |
| `BIZ-EXECUTOR-HANDLE` | warn | `status=in_flight` 且 `executor` ∈ {subagent, workflow}，但缺真实 `handle`；valid native no-handle projection 除外 | legacy 派发工具返回句柄后 `task update --handle <后台句柄>`，再转 `in_flight`；`ready` / `blocked` future task 不预填；native attempt 只走 dedicated writer，由 hard rule 接管——见 [C 节](#c-executor-五种语义--选择决策树) |
| `BIZ-INFLIGHT-AGENT` | warn | task 已 `in_flight`，但无任何 agent 登记指向它——既没有任一 `agents[].links[].task_id` 等于本 task id，也没有任一 `routing.attempts[]` 条目带非空 `agent_ref` | 凡派发皆登记：`ccm agent create` + `ccm agent link <agent-id> --task <task-id>` 补登记，让花名册 / viewer 能观测这次派发——见 [C.6 节](#c6-agents运行时-agent-登记簿) |
| `BIZ-ROUTED-PLANNING-REQUIRED` | hard | contract-enabled、非 grandfathered `subagent` 缺合法 planning 或正数 estimate | 先补 estimate，再用 `task set-planning` 写完整画像；enabled 新 task 最后才把 executor 定成 subagent——见 [C.5](#c5-cross-harness-planning--routing-合同) |
| `BIZ-ROUTE-POLICY-REQUIRED` | hard | contract-enabled、非 grandfathered `subagent` 缺合法 provider-neutral routing policy / ample+tight chains | 用 `task set-routing`；candidate 必须满足 planning capability/effect/permission 交叉约束 |
| `BIZ-ROUTE-SELECTION-REQUIRED` | hard | contract-enabled `in_flight` subagent 没有合格 current selection，或 selection 不在声明 chain / evidence 失效 | 不用 generic start/force；取得 fresh qualification evidence与真实 handle 后走 `route-bind` |
| `BIZ-ROUTE-ATTEMPT-REQUIRED` | hard | contract-enabled `in_flight` subagent 不是恰好一个 running attempt，或 attempt/selection/handle/snapshot 不一致 | selection + running attempt 只经 `route-bind` 原子写；attempts append-only，不手改 |
| `BIZ-EXTERNAL-ISSUE` | warn | `executor=external` 但缺 `kind=issue` 引用 | external task 加 `--ref issue:https://github.com/o/r/issues/N` 做外部追踪锚点 |
| `BIZ-EXTERNAL-ARTIFACT` | warn | `executor=external` 且 `status=done`，但 `artifact` 等于同一个 `kind=issue` tracking URL | 把 artifact 改成外部实际产出（PR / commit / release / report / CI run）；若 issue closed 但尚未验收，别标 done，先用 `uncertain` / `in_flight` / `stale` |
| `BIZ-TIME-ORDER` | warn | 时间序乱：`started_at` 早于 `created_at` / `finished_at` 早于 `started_at` / 有 finished 无 started / `in_flight` 无 started / `done` 无 finished | 用 ccm verb（`start`/`done`）按序盖戳，别手填出乱序时间 |
| `BIZ-DONE-VERIFIED` | hard | done 真语义（`status=done` ∧ `verified=true` ∧ `artifact` 非空）缺失 | `task done --verified --artifact /abs/...`;若尚未端点验收或没有产物,不要标 `done`——见 [L 节](#l-referencesartifactverified-语义) |
| `BIZ-REVIEW-VERDICT-GATE` | hard | task 有非空 `review_verdict`，却没有合法显式 review gate | 先用 `task add|update --review-gate APPROVE` 声明下游门控语义，再记录 verdict |
| `BIZ-DELIVERY-CANDIDATE-BINDING` | hard | current delivery candidate fingerprint/fields 不再精确绑定当前 true-done `finished_at` / `artifact` / subject，或不是合法保留在 `stale` 上的旧 attempt evidence | `done→stale` 可留证据审计但不会 qualify；`retry` 会原子归档并清空，开新 attempt 后重新 attest；不得伪造 fingerprint 或复用旧 candidate |
| `DELIVERY_SIZE_CAP` | hard | targets >64、单 task observations >128、单 downstream requirements >256 | 拆 board / 归档旧 attempt；不要用超大 metadata 把 board 变成 evidence store |
| `BIZ-DEPENDENCY-REQUIREMENT` | warn | requirement exact key 已不是当前 `deps[]` edge | 删除/改正陈旧 requirement；metadata 不会创建隐藏 DAG edge |
| `BIZ-DELIVERY-PROOF` | warn | 显式 edge 当前为 unqualified/unknown | 跑 `dependency explain` 看 containment、drift、missing-object、review 或 waiver diagnostic |
| `BIZ-DELIVERY-IMPACT` | warn | 显式 edge 未 qualified，但 downstream 已越过 planned/blocked | 跑任意 ccm 写命令触发 reconcile，使状态回到 declared truth 后补 proof |

---

<!-- ccm:k:end point:ccm.board.validation-rules -->
