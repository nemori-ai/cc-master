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

**修法不在本表**——每条规则「怎么修」由 `ccm` 的报错自己说出来（含为什么要紧 + 补救动作 + 实际 id）。这里只留触发条件与文档内导航：报错会过期吗？不会；表会。所以本表不再抄一份。

想提前知道某条规则怎么修，读它的报错即可——撞上它时它就在你眼前，比翻表快。


### FMT 家族（格式 / 类型）

| 规则 id | level | 什么触发它 | 详见 |
|---|---|---|---|
| `FMT-JSON` | hard | board 不是合法 JSON，或顶层不是对象 | — |
| `FMT-SCHEMA` | hard | `schema` 不是字符串字面量 `"cc-master/v2"` | — |
| `FMT-GOAL` | hard | `goal` 不是字符串 | — |
| `FMT-GOAL-CONTRACT` | hard | 存在的 `goal_contract` schema/revision/assurance/updated_at/brief ref+sha256 形状非法 | — |
| `FMT-DEADLINE` | hard | 存在的 `goal_contract.deadline` 形状非法：`state` 不在 `{pending,asserted,confirmed,none}`；`asserted`/`confirmed` 缺 `at` 或 `at` 非严格 ISO-8601 UTC；`none` 带 `at`；`precision` 非 `{minute,day}`；`kind` 非 `{hard,soft}`；`rev` 非整数≥1；`provenance.source` 非枚举 | [I 小节](#o-交付-ddl-字段取值--四态状态机) |
| `FMT-OWNER` | hard | `owner` 不是对象，或 `active` 非 bool，或 `session_id` 非字符串 | — |
| `FMT-HARNESS` | warn | `owner.harness` 存在但不在 `{claude-code,codex,cursor,kimi-code,unknown}` | — |
| `FMT-GIT` | hard | `git` 不是对象，或 `worktree`/`branch` 存在却非字符串 | — |
| `FMT-TASKS` | hard | `tasks` 不是数组 | — |
| `FMT-ID` | hard | task 不是对象，或 `id` 不是非空字符串 | — |
| `FMT-ID-UNIQUE` | hard | 同一个 task id 出现多次 | — |
| `FMT-STATUS` | hard | `status` 不在 8 个枚举值内 | [B 节](#b-status-八态语义--生命周期) |
| `FMT-DEPS` | hard | `deps` 缺失、非数组、或含非字符串元素 | — |
| `FMT-PARENT` | hard | `parent` 键存在但值非「非空字符串」 | — |
| `FMT-EXECUTOR` | hard | `executor` 不在 5 个枚举值内 | [C 节](#c-executor-五种语义--选择决策树) |
| `FMT-ROLE` | hard | `role` 不在 {normal, fill-work} 内 | — |
| `FMT-REF` | hard | `references[].ref` 不是绝对路径或 URL（含相对路径） | [L 节](#l-referencesartifactverified-语义) |
| `FMT-TYPE` | warn | `type` 不在已知 taskType 集合内（开放枚举） | — |
| `FMT-REF-KIND` | warn | `references[].kind` 不在 refKind 枚举内（开放枚举） | — |
| `FMT-BLOCKED-ON` | warn | `blocked_on` 既非 `"user"` 也非存在的 task id | [G 节](#g-blocked_on-怎么选) |
| `FMT-WIP` | warn | task 级 `wip_limit` 非数字 | — |
| `FMT-MODEL` | warn | task `model` 存在却非字符串 | — |
| `FMT-SCHEDULING` | warn | `scheduling.wip_limit` / `owner_wip_limit`（或旧板顶层 `wip_limit`）非数字 | — |
| `FMT-WATCHDOG` | warn | canonical `watchdog` / legacy `wakeup` 的 `job_id` 缺失或空白、`mechanism` 不在枚举内，或 `armed_at`/`fire_at` 非严格 ISO-8601 UTC | [K 节](#k-watchdog何时-armwatchdog--legacy-wakeup-字段含义) |
| `FMT-META` | warn | `meta.template_version` 非整数，或 `meta.created_at` 非 ISO-8601 UTC | — |
| `FMT-LOG` | warn | `log` 非数组，或条目缺 `ts`/`summary`、`ts` 非 ISO、`kind` 不在枚举内 | — |
| `FMT-JUDGMENT-CALLS` | warn | `judgment_calls` 非数组，或条目 `summary` 空、`category`/`severity`/`status` 不在各枚举内、时间戳非 ISO | [H 节](#h-judgment_calljc何时建severity-怎么定) |
| `FMT-CADENCE` | warn | `cadence` 非对象，或 iteration 的 `id` 空、`status` 不在 {open,shipped}、时间非 ISO、`members` 非字符串数组 | [I 节](#i-cadence-与-iteration节奏怎么定) |
| `FMT-BASELINE` | warn | `baseline` 非对象，或 `captured_at`/`t0`/`history[].reset_at` 非严格 ISO-8601 UTC、`task_estimates`/`dag_snapshot` 非对象、`bac_h` 非数字、`history` 非数组 | — |
{{USING_CCM_FMT_POLICY_ROW}}
| `FMT-COORD` | warn | `coordination` 非对象，或 `priority` 不在 `{urgent,high,normal,low,trivial}` 枚举，或 `state`/`state.current`/`state.planned` 非对象、数字字段（`active_tasks`/`burn_contribution`/`cost_to_complete_pct`）非数字、人类可读字段（`workload`/`remaining_work`）非字符串 | [A 节](#a-task-字段速查) |
| `FMT-INBOX` | warn | `coordination.inbox` 存在但非数组，或通知条目 id 非空唯一 / kind / status / strength / ISO 时间 / consumed_at 状态对应关系不合法 | — |
| `FMT-RUNTIME` | warn | `runtime` 非对象，或已知键类型不合法（时间锚 `last_identity_remind` / `last_critpath_remind` / `last_goal_remind` / `last_account_switch` / `stop_allow_until` / `last_deadline_risk_check` 须严格 ISO-8601 UTC；`last_deadline_risk_fingerprint` 须非空字符串） | — |
| `FMT-AGENTS` | warn | `agents` 存在但非数组；或既有 agent 字段形状/枚举/时间/link/ref 非法；`dispatch` 若存在但 schema/key/digest/phase/claim/PID/evidence/typed capability/terminal/reconciliation 形状非法也会命中 | [C.6 节](#c6-agents运行时-agent-登记簿) |
| `FMT-ESTIMATE` | warn | `estimate` 不是 `{value:number, unit:string}` 对象 | [E 节](#e-estimate-怎么估) |
| `FMT-ACCEPTANCE` | warn | `acceptance` 既非字符串也非对象，或对象 `criteria` 空、`criterion.status` 不在 {pending,met,failed} | [D 节](#d-acceptance-怎么写好) |
| `FMT-DEPENDENCY-GATE` | hard | `dependency_gate` 存在但不是 `{kind:"review",required_verdict:"APPROVE"}` | 用 `task add| — |
| `FMT-REVIEW-VERDICT` | hard | 非空 `review_verdict` 不在 `{APPROVE,REQUEST-CHANGES}` | 用 `task done --review-verdict APPROVE| — |
| `FMT-CONTRACTS` | hard | `meta.contracts` 只出现 planning/routing 一半、版本不是精确 v1、activation time / grandfathered terminal 形状坏 | — |
| `FMT-TASK-PLANNING` | warn | `task.planning` 存在但不满足 `ccm/task-planning/v1` | — |
| `FMT-TASK-ROUTING` | warn | `task.routing` 存在但不满足 `ccm/agent-routing/v1` | — |
| `FMT-DELIVERY-CONTRACT` | hard | `delivery_contract` 不是 declared v1、target/snapshot 形状坏，或试图持久化 strict | — |
| `FMT-TASK-DELIVERY` | hard | candidate/observation/proof 形状或 immutable binding 坏，或持久化 derived qualification | — |
| `FMT-DEPENDENCY-REQUIREMENTS` | hard | requirement 不是 candidate/delivered、delivered target 未声明、waiver authority/scope/expiry 坏，或写了 `qualified` bool | — |
| `FMT-TIME` | warn | 时间锚（`created_at`/`started_at`/`finished_at`/`owner.heartbeat`）存在却非严格 ISO-8601 UTC（`YYYY-MM-DDTHH:MM:SSZ`） | — |

### GRAPH 家族（图完整性）

| 规则 id | level | 什么触发它 | 详见 |
|---|---|---|---|
| `GRAPH-DANGLING` | hard | `deps` 指向一个不存在的 task id | [F 节](#f-deps-怎么连) |
| `GRAPH-SELFLOOP` | hard | `deps` 含自己（自环） | — |
| `GRAPH-CYCLE` | hard | deps 图存在有向环 | — |
| `GRAPH-PARENT-EXISTS` | hard | `parent` 指向一个不存在的 owner id | [J 节](#j-parent--owner-嵌套语义) |
| `GRAPH-PARENT-DEPTH` | hard | owner 的子节点自己又是某些节点的 parent（违反 depth=1） | [J 节](#j-parent--owner-嵌套语义) |
| `GRAPH-PARENT-CYCLE` | hard | parent 链存在环（含自指 / 2-环） | — |
| `GRAPH-ROLLUP` | warn | 标 `done` 的 owner 仍有非 done 子节点 | [J 节](#j-parent--owner-嵌套语义) |
| `GRAPH-CONNECTED` | warn | 把 `deps` ∪ `parent` 容器边当无向边算弱连通分量（**在非 fill-work 节点上**），分量 > 1（图被切成多个互不相连的子图 / 有孤岛节点） | [F 节](#f-deps-怎么连) |

### BIZ 家族（条件业务规则）

| 规则 id | level | 什么触发它 | 详见 |
|---|---|---|---|
| `BIZ-AWAITING` | hard | awaiting-user 节点（`blocked_on:"user"` + status ∈ {blocked, in_flight}）缺 `decision_package` 对象 | [G 节](#g-blocked_on-怎么选) |
| `BIZ-GOAL-PENDING` | warn | `assurance:pending` 的 Goal Contract 已有 ready / in_flight / uncertain 执行任务 | — |
| `BIZ-DEADLINE-PENDING` | warn | 交付 DDL 未 settle（`deadline` 键缺失或 `state:pending`）却已有 ready / in_flight / uncertain 执行任务 | [I 小节](#o-交付-ddl-字段取值--四态状态机) |
| `BIZ-DEADLINE-OVERDUE` | warn | `state:asserted|confirmed` 的交付 DDL 已过期（`now>=at`）而板未归档且交付未验收完成——**交付验收 marker** 读显式 `goal_contract.delivery.accepted:true`（用户/缩范围/分阶段场景显式声明）或全 task trulyDone 派生；已验收即不再 overdue | — |
| `BIZ-CADENCE-SHIPPED` | hard | iteration 标 `shipped` 但 members 未全部 done+verified（含不存在的 member） | [I 节](#i-cadence-与-iteration节奏怎么定) |
| `BIZ-CADENCE-MISSING-ESTIMATE` | warn | open iteration 的 member 缺有效 `estimate` | [E 节](#e-estimate-怎么估) |
| `BIZ-CADENCE-OVERBOOKED` | warn | open iteration 的 member 估时总量超过 timebox（deadline-started_at 或 `target.ship_every`，含小幅 grace） | — |
| `BIZ-CADENCE-CRITICAL-PATH-OVER` | warn | open iteration 的 member 依赖关键路径超过 timebox（含小幅 grace） | — |
| `BIZ-TASK-OVERSIZED-FOR-CADENCE` | warn | 单个 iteration member 的 estimate 超过 `cadence.target.ship_every`（含小幅 grace） | — |
| `BIZ-AGILE-ACCEPTANCE-MISSING` | warn | cadence member 缺清晰 `acceptance` | — |
| `BIZ-ESTIMATE-STALE` | warn | 实测 duration 与 estimate 明显漂移，提示下游重估 | — |
| `BIZ-STATUS-DEPS` | warn | deps 门控不一致：`ready` 但 deps 未全满足 / `blocked` 无 `blocked_on` 但 deps 全满足 | [B 节](#ready--blocked-由系统按-deps-自动门控) |
| `BIZ-NATIVE-ATTEMPT-PROJECTION` | **hard** | opt-in task 的 attempt/create/cancel/binding schema、ordinal/dispatch identity、reconciliation 完整性/顺序/值绑定、state×record 时序可达性或 status/handle 专属 projection 不一致，或 active history/handle 被 generic 写路径伪造 | [B 节](#native-attempt-专属-projection) |
| `BIZ-DECISION-PACKAGE` | warn | `decision_package` 在但字段不全：`context_md`/`what_i_need`/`enter_cmd` 空、`ask_type` 不在枚举、decision 型 `options` 空、`inputs_hash` 非 `sha256:<64hex>` | [G 节](#g-blocked_on-怎么选) |
| `BIZ-DEV-REFS` | **hard** | `type=development` 的 task 缺 `kind=spec`≥1 或 `kind=plan`≥1 引用 | [L 节](#l-referencesartifactverified-语义) |
| `BIZ-ACCEPTANCE-REQUIRED` | warn | type ∈ {development, development-demo, acceptance, e2e-integration} 但 `acceptance` 为空 | [D 节](#d-acceptance-怎么写好) |
| `BIZ-EXECUTOR-HANDLE` | warn | `status=in_flight` 且 `executor` ∈ {subagent, workflow}，但缺真实 `handle`；valid native no-handle projection 除外 | [C 节](#c-executor-五种语义--选择决策树) |
| `BIZ-INFLIGHT-AGENT` | warn | task 已 `in_flight`，但无任何 agent 登记指向它——既没有任一 `agents[].links[].task_id` 等于本 task id，也没有任一 `routing.attempts[]` 条目带非空 `agent_ref` | [C.6 节](#c6-agents运行时-agent-登记簿) |
| `BIZ-ROUTED-PLANNING-REQUIRED` | hard | contract-enabled、非 grandfathered `subagent` 缺合法 planning 或正数 estimate | [C.5](#c5-cross-harness-planning--routing-合同) |
| `BIZ-ROUTE-POLICY-REQUIRED` | hard | contract-enabled、非 grandfathered `subagent` 缺合法 provider-neutral routing policy / ample+tight chains | — |
| `BIZ-ROUTE-SELECTION-REQUIRED` | hard | contract-enabled `in_flight` subagent 没有合格 current selection，或 selection 不在声明 chain / evidence 失效 | — |
| `BIZ-ROUTE-ATTEMPT-REQUIRED` | hard | contract-enabled `in_flight` subagent 不是恰好一个 running attempt，或 attempt/selection/handle/snapshot 不一致 | — |
| `BIZ-EXTERNAL-ISSUE` | warn | `executor=external` 但缺 `kind=issue` 引用 | — |
| `BIZ-EXTERNAL-ARTIFACT` | warn | `executor=external` 且 `status=done`，但 `artifact` 等于同一个 `kind=issue` tracking URL | — |
| `BIZ-TIME-ORDER` | warn | 时间序乱：`started_at` 早于 `created_at` / `finished_at` 早于 `started_at` / 有 finished 无 started / `in_flight` 无 started / `done` 无 finished | — |
| `BIZ-DONE-VERIFIED` | hard | done 真语义（`status=done` ∧ `verified=true` ∧ `artifact` 非空）缺失 | [L 节](#l-referencesartifactverified-语义) |
| `BIZ-REVIEW-VERDICT-GATE` | hard | task 有非空 `review_verdict`，却没有合法显式 review gate | 先用 `task add| — |
| `BIZ-DELIVERY-CANDIDATE-BINDING` | hard | current delivery candidate fingerprint/fields 不再精确绑定当前 true-done `finished_at` / `artifact` / subject，或不是合法保留在 `stale` 上的旧 attempt evidence | — |
| `DELIVERY_SIZE_CAP` | hard | targets >64、单 task observations >128、单 downstream requirements >256 | 拆 board / 归档旧 attempt；不要用超大 metadata 把 board 变成 evidence store |
| `BIZ-DEPENDENCY-REQUIREMENT` | warn | requirement exact key 已不是当前 `deps[]` edge | — |
| `BIZ-DELIVERY-PROOF` | warn | 显式 edge 当前为 unqualified/unknown | — |
| `BIZ-DELIVERY-IMPACT` | warn | 显式 edge 未 qualified，但 downstream 已越过 planned/blocked | — |

---

<!-- ccm:k:end point:ccm.board.validation-rules -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删了这条，agent 不知道某个字段填什么值踩哪条 rule、severity 是 hard 还是 warn，只能反复试错撞 exit 3 / lint warning。

主体是 FMT/GRAPH/BIZ 各条 lint 规则的 id、level 与触发条件，是本引擎的校验事实表。

## 边界

规则集与 lint 引擎演进、版本变化绑定。当前版本以 ccm/engine 的 board-lint-core.ts INVARIANTS 为权威（速-of-truth）。本表是用户提前避坑的快照，新 lint rule 出现时本表滞后。

## 失败形态

隐蔽形态：agent 按旧版本的规则表从容填 board 数据，新版本 lint 出现前所未有的 hard rule，agent 突然无法落盘，茫然不知是 bug 还是自己理解错。或 agent 混淆 severity，以为「hard 就必须满足」，其实 --force 可以越过，导致放弃本可以写的改动。
