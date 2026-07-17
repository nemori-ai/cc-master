# board-model-guide —— board 模型操作指南

> **面向操作者的派生视图。** board 协议的**权威定义**（enums / 字段三档元数据 / 不变式注册表 / 状态机）在 `ccm` 引擎里——实时真相用 `ccm <namespace> --help` 取。**本文只给操作侧：概念是什么、字段什么时候设什么值、场景怎么选。绝不复述权威定义。**

---

## 目录（TOC）

- [A. task 字段速查](#a-task-字段速查)
  - [🔒 load-bearing 字段（走专属命令，不用 --set）](#-load-bearing-字段)
  - [✎ flexible 字段（默认 --set，合约字段走专属写口）](#-flexible-字段)
  - [👁 observed 字段（hook 若有则用，走具名 flag）](#-observed-字段)
- [B. status 八态语义 + 生命周期](#b-status-八态语义--生命周期)
  - [各态语义速查](#各态语义速查)
  - [native-attempt 专属 projection](#native-attempt-专属-projection)
  - [status 何时转向哪态（决策指导）](#status-何时转向哪态)
  - [uncertain vs blocked_on（辨析）](#uncertain-vs-blocked_on-辨析)
- [C. executor 五种语义 + 选择决策树](#c-executor-五种语义--选择决策树)
  - [各 executor 语义](#各-executor-语义)
  - [executor 选择决策树](#executor-选择决策树)
- [C.5 cross-harness planning / routing 合同](#c5-cross-harness-planning--routing-合同)
- [C.6 agents[]：运行时 agent 登记簿](#c6-agents运行时-agent-登记簿)
- [D. acceptance 怎么写好](#d-acceptance-怎么写好)
- [E. estimate 怎么估](#e-estimate-怎么估)
- [F. deps 怎么连](#f-deps-怎么连)
- [G. blocked_on 怎么选](#g-blocked_on-怎么选)
- [H. judgment_call（jc）：何时建、severity 怎么定](#h-judgment_calljc何时建severity-怎么定)
- [I. cadence 与 iteration：节奏怎么定](#i-cadence-与-iteration节奏怎么定)
- [J. parent / owner 嵌套语义](#j-parent--owner-嵌套语义)
- [K. watchdog：何时 arm、watchdog / legacy wakeup 字段含义](#k-watchdog何时-armwatchdog--legacy-wakeup-字段含义)
- [L. references、artifact、verified 语义](#l-referencesartifactverified-语义)
- [M. 决策树 / 反模式深化](#m-决策树--反模式深化)
- [N. 校验规则全集速查（FMT / GRAPH / BIZ）](#n-校验规则全集速查fmt--graph--biz)
  - [FMT 家族（格式 / 类型）](#fmt-家族格式--类型)
  - [GRAPH 家族（图完整性）](#graph-家族图完整性)
  - [BIZ 家族（条件业务规则）](#biz-家族条件业务规则)
- [O. 交付 DDL 字段取值 + 四态状态机](#o-交付-ddl-字段取值--四态状态机)

---

## A. task 字段速查

### 🔒 load-bearing 字段

**这些字段走专属命令，`--set` 被拒（exit 3）。**

| 字段 | 类型 | 专属命令 | 含义一句话 |
|---|---|---|---|
| `id` | string（唯一非空） | `task add <id>` | DAG 节点标识符，被 deps/parent 引用 |
| `status` | enum（8 个值） | `task start / done / retry / block / set-status` | 状态机当前态，只能经 verb 转移 |
| `deps` | string[] | `task add --deps` / `task update --add-dep / --rm-dep` | 上游 dep 列表，驱动 readySet 计算 |
| `parent` | string?（可缺） | `task add --parent` / `task update --parent` | 归属 owner 节点的容器边（嵌套深度=1） |

**为什么 id/status/deps/parent 是 🔒？** 这四个字段被 hook、图算法、readySet、lint 机器读取。手改绕过写关卡，会造成悬挂引用、环、lint 拦不住的非法态转移——后果是 board 说谎，所有下游消费者（viewer / resume / hook）沿着错误输入跑。**这正是为什么 board 变更根本不给手改的路**：直接 file-edit 目标 board（编辑工具或 shell 重定向/文本替换手改）会被 kimi-code PreToolUse board-guard hook **当场 deny**。手改绕过写关卡会静默腐蚀 deps 图 / 状态机 / 窄腰——机制层直接不给你这条路。

> `--set tasks[T1].status=done` 和裸 `--set status=done`（task verb 语境）都会被 🔒 守门拒（exit 3）。status 永远走 verb（锚 2·SKILL.md）。

### ✎ flexible 字段

**默认用 `--set`（`task add`/`task update <id>` 里裸 `--set field=value` 即作用于该 task；跨 task 用 `tasks[<id>].field` 前缀；板级顶层用 `board update --set`），或各自的具名 flag。例外是 `delivery` / `dependency_requirements`：虽属 flexible tier，仍保留给下表中的专属命令，generic setter 会拒绝 root 与 nested path。写入后非 `--json` 输出回显实际落点（`set tasks[T1].field`）。**

| 字段 | 何时设 | 操作侧要点 |
|---|---|---|
| `title` | 建 task 时（推荐） | 一句话，让 viewer 卡片可读 |
| `description` | 需详细说明时 | 长文，viewer 详情栏展示 |
| `acceptance` | 开发类 task 必须，其余推荐 | 见 [D. acceptance 怎么写好](#d-acceptance-怎么写好) |
| `references` | 开发类 task 必须，其余推荐 | ref 只能绝对路径或 URL，禁相对（FMT-REF·exit 3） |
| `estimate` | 估点时 | 见 [E. estimate 怎么估](#e-estimate-怎么估) |
| `executor` | 派发前必须设 | 见 [C. executor 五种语义](#c-executor-五种语义--选择决策树) |
| `planning` | opt-in cross-harness route 前，先把 task 自身画像评估完整 | `ccm/task-planning/v1` whole object；只走 `ccm task set-planning`，不能用 generic setter；字段与顺序见 [C.5](#c5-cross-harness-planning--routing-合同) |
| `routing` | planning 后，为 `subagent` 声明 provider-neutral candidates、ample/tight 链与 fallback | `ccm/agent-routing/v1`；policy 只走 `task set-routing`，selection/attempt/handle 只走 `route-bind`；attempts append-only；见 [C.5](#c5-cross-harness-planning--routing-合同) |
| `handle` | legacy 真实派发后、任务进入 `in_flight` 前必须；native bind/reconcile 时由专属 writer 投影 | 记录真实 opaque 句柄，resume 靠它 recon；`ready` / `blocked` future task 不预填，native-active 时禁止 `task update --handle` / 通用 setter 自填 |
| `artifact` | 产出落盘后（`task done` 时带 `--artifact`） | 绝对路径或 URL；done 真语义（verified+artifact）靠它；`task retry` 会归档旧值并从当前 attempt 清除 |
| `verified` | 端点验收通过后 | `task done --verified` 一步到位，或 `task update --verified`；`task retry` 原子复位为布尔 `false` |
| `dependency_gate` | review task 必须明确批准后才允许下游开始时 | `task add|update --review-gate APPROVE`；缺省保持旧板的 status-only 依赖语义 |
| `review_verdict` | 当前 review attempt 产出明确结论时 | `task done --review-verdict APPROVE|REQUEST-CHANGES`；只有当前 attempt 的 APPROVE 满足显式 review gate；`task retry` 先归档旧值、再从当前 attempt 清除 |
| `delivery` | 当前 true-done attempt 要证明 candidate / target delivery 时 | 只用 `task attest-delivery` 写；candidate fingerprint 由命令按当前 `finished_at` + `artifact` 重算，observations 绑定 immutable target snapshot；reviewed proof 每次重读绝对 attestation path 并验 digest/binding；stale 可留旧证据审计但不 qualify，retry 整块归档并清 current |
| `dependency_requirements` | downstream 需把某条 deps edge 从 legacy 升为 candidate/delivered 合约时 | 只用 `dependency require/default/waive`；exact key 优先 `*`；waiver 必须显式 user authorization；资格是 `qualified|unqualified|unknown` 派生值，绝不持久化布尔 |
| `blocked_on` | `task block --on` 时自动设 | `"user"` 或某 task id；见 [G. blocked_on 怎么选](#g-blocked_on-怎么选) |
| `justification` | 需记录决策理由时 | 解释「为什么建这个 task / 用这个方法」 |
| `observability` | 后台任务完成 / recon 时，从 kimi-code subagent result、后台 Bash 任务、cloud task 或外部 run 的可得 telemetry 抄取 | 可选遥测；缺失优雅降级，不影响派发逻辑 |
| `created_at` / `started_at` / `finished_at` | `task add` / `task start` / `task done` 时自动盖 | 严格 `YYYY-MM-DDTHH:MM:SSZ`；viewer timeline 靠它；retry 开新 attempt 时清后两者并归档旧值 |
| `hitl_rounds` | 每次 `blocked_on:user` 往返 + 1 | 量化人工介入成本；缺省 = 0 |
| `decision_package` | 建 `blocked_on:user` 节点时**必须**（BIZ-AWAITING hard error） | 见 [G. blocked_on 怎么选](#g-blocked_on-怎么选) 里的 awaiting-user 小节 |
| `role` | 标 fill-work 时 | `normal`（默认）或 `fill-work`（临界路径等待窗口的填充活） |
| `type` | 建 task 时 | 见下方 taskType 枚举说明 |
| `output_schema` | 需约束结构化产出时（低频） | workflow 节点的产出契约 |
| `dep_pins` | 钉依赖快照时（低频） | freshness / inputs_hash 用 |
| `model` | 派发 / 完成时记录该 task **实际使用**的模型 selector | 先用 `ccm provider facts <provider> --json` 取得 fresh catalog、再用对应 transport 证明 live admission，最后 `ccm task update <id> --set model=<admitted-provider-model-id>`（无具名 flag·裸 path 即本 task）；它不是候选 / fallback 字段——计划中的 provider/model/effort 候选归 `routing.policy.candidates`；estimate 层按档分层校准读实际值，缺→无 tier 校准 |

**taskType 枚举参考**（开放枚举，未知值 warn 不 fail）：

| type | 触发的 BIZ 规则 |
|---|---|
| `development` | 必须有 `acceptance`（warn）+ references 含 `spec`≥1 和 `plan`≥1（**hard**，缺则拒写，`--force` 可越——`BIZ-DEV-REFS`） |
| `development-demo` | 必须有 `acceptance` |
| `acceptance` | 必须有 `acceptance` |
| `e2e-integration` | 必须有 `acceptance` |
| `design` / `planning` / `doc-alignment` / `pr` | 无强制 acceptance 要求 |

### 👁 observed 字段

**hook 若有则用、缺失则对应行为静默关闭（graceful degrade）。走具名 flag。**

| 字段 | 位置 | 具名 flag | 缺失时的行为 |
|---|---|---|---|
| `scheduling.wip_limit` | board 顶层 | `ccm board update --wip-limit N` | 全局过调度软警告静默关闭 |
| `scheduling.owner_wip_limit` | board 顶层 | `ccm board update --owner-wip N` | 每 owner 过调度软警告静默关闭 |
| `owner.harness` | board owner 子字段 | `ccm board stamp-harness`（ARM 时 bootstrap 调用） | 缺失解析为 `unknown`；`ccm peers` 按它分配额池，hook 武装闸不读它 |
| `goal_contract` | board 顶层 | `ccm goal set / confirm / amend`；其 `deadline` 子对象走 `ccm goal deadline set / confirm / confirm-none / amend` | 缺失表示 legacy board；hook 保持兼容但不提供 revision / Brief 完整性守卫。交付 DDL 嵌在 `goal_contract.deadline`（单一 SSOT，随 goal revision 走）——字段取值见 [O 小节](#o-交付-ddl-字段取值--四态状态机) |
| `watchdog` | board 顶层 | `ccm watchdog arm / disarm` | kimi-code hook 可以在 Stop / SessionStart 等事件里注入提醒；只有带 nonblank `job_id` 且未过期的 canonical `watchdog` / legacy `wakeup` 才算健康并静默提醒。hook 不能凭空创建未来唤醒：不要把提醒当成 durable timer，它只能在 kimi-code 再次触发相关事件时发声。 |
| `task.wip_limit` | task 级 | `ccm task add/update --wip-limit N` | 覆写 owner_wip_limit（per-owner cap） |

**board 级 ✎ 字段（走专属 noun、不经 `--set`）：**

- `baseline`——EVM 计划基线（plan 基线 SSOT），用 `ccm baseline snapshot / show / reset` 维护；缺→无 EVM baseline，形状坏→`FMT-BASELINE` warn。命令详见 command-catalog 的 baseline namespace、规则见下方 [N 节](#n-校验规则全集速查fmt--graph--biz) `FMT-BASELINE`。
- `meta.contracts.task_planning` + `meta.contracts.agent_routing`——routing contract 的成对 activation marker，只用 `ccm board enable-contract` 写；两者都缺表示 legacy，成对精确启用才是 enabled，部分写入 / 版本不匹配 / activation 元数据坏会触发 `FMT-CONTRACTS` hard。`--preflight` 只读列 gap；启用时精确 grandfather 已 terminal 的历史 subagent attempt，terminal 后 retry 会失去豁免。不要用 `board update --set-json meta...` 绕 dedicated writer。
- `policy`——可读取历史 `autonomous_account_switch`，但 kimi-code account switch 永久不可用；stored `allow` 不产生能力。不要把它用作 dispatch、login/logout 或 credential mutation 输入；形状坏仍触发 `FMT-POLICY` warn。
- `delivery_contract`——declared-mode v1 的 target 声明与冻结 snapshot。用 `ccm target set/show/refresh` 维护；缺失的历史 board 逐字保持现有 dependency/ready/reconcile 行为。当前唯一可持久化 mode 是 `declared`；`strict` 只存在于只读 `--strict-dry-run` preview，不能写板。Git target 只用本地 objects，artifact target 绑定 immutable manifest digest；branch/worktree 只定位 repository，不是交付证据。
- `coordination`——多 orchestrator 协调**感知**块，让 M 个并行 orchestrator 互相看见、各自独立配速（**hook 不读**·跨板只读读侧是 `ccm peers`）。可扩展对象，字段全 optional：
  - `priority` ∈ `{'urgent','high','normal','low','trivial'}`（**板级**优先级·非板内任务排序·缺/坏 → 解析为 `normal`）——这是跨板协调的裁决主轴 + 机械 fair-share 权重源（用户声明的协调 hint·不喂引擎的板内任务调度）。**专属 flag：`ccm board update --priority <urgent|high|normal|low|trivial>`**（枚举校验在 update 端·非法值 → `exit 2`；init 时用户给的板级优先级经它落盘）。
  - `state.current`（此刻在烧什么·喂即时 fair-share）：`active_tasks`（int·数字）/ `workload`（string·人类可读）/ `burn_contribution`（number·对聚合配额% burn 的估计贡献）。
  - `state.planned`（还剩多少活·喂价值/紧迫推理）：`remaining_work`（string·人类可读）/ `cost_to_complete_pct`（number·偿付力）。
  - `inbox`（入站中介建议收件箱）：通知数组，缺失 = 空。每条通知有 `id` / `kind` / `status` / `created_at` / `expires_at` / `strength` / `summary` / `payload` / `consumed_at` / `consumed_note`；`kind` 闭集为 `pacing_throttle`、`pacing_yield`、`pacing_claim`、`pacing_switch`、`pacing_stop`、`hitl_turn`、`artifact_serialize`、`quota_state_change`、`deadline_risk`（交付 DDL 风险 durable 审计条目·deadline-risk hook 直接注入 advisory 后立即 self-ack 一条）；`status` 是 `unconsumed → consumed|expired`。你用 `ccm coordination inbox list --unconsumed` 读取，消费后用 `ccm coordination inbox ack <id...> --note ...` 标记 consumed；低层 producer 用 `ccm coordination notify` append。每次 ccm 写盘前自动跑 `reconcileInbox`：过期未消费转 expired、同 kind 只保留最新 unconsumed、终态按 TTL/capacity GC。形状坏→`FMT-INBOX` warn（永不 hard）。

  数字字段喂机械 floor、人类可读字段喂 agentic 价值推理；**缺即降级**（`ccm peers` 把该 peer 的对应维度退 null·配速退单板·fail-safe）。形状坏→`FMT-COORD` warn（永不 hard·advisory ✎）。读侧详见 command-catalog 的 peers namespace、规则见下方 [N 节](#n-校验规则全集速查fmt--graph--biz) `FMT-COORD`。**token-blind**：本块只含 goal/priority/workload/%——绝无任何 secret。
- `owner.harness`——当前 board 所属 harness 的观察字段，取值 `claude-code | codex | cursor | kimi-code | unknown`。它**不是武装闸**：hook arming 仍只看 `owner.active` + `owner.session_id`；`owner.harness` 只给 `ccm peers` / 后续池中介做配额池分区。ARM 时 bootstrap 通过 `ccm board stamp-harness` 从当前进程 env 的可信 harness detect 盖写；无可信 env 时不写、不覆盖已有值。缺失或坏值都按 `unknown` 降级；`ccm peers` 会把 unknown board 放进单例池，避免跨 harness 或不明来源 board 混排。坏值→`FMT-HARNESS` warn。
- `agents`——**运行时 agent 登记簿**（✎ 非窄腰·hook 不读），跨所有派发类型的统一花名册：凡派发（sub-agent / 后台 shell / workflow / 跨 harness worker）皆登记。只用 `ccm agent create / bind / link / terminal / probe` 写、`ccm agent list / show` 读、`ccm agent amend / rm` 事后修正（`amend` 补正 handle 域·`rm` 删登记·均不经状态机）——别用 `--set-json` 手拼（会绕过状态机校验、handle 证据闸与幂等 link）。缺 → 无登记（花名册空）；形状坏 → `FMT-AGENTS` warn；`in_flight` task 无登记指向 → `BIZ-INFLIGHT-AGENT` warn 软提示。概念与字段取值见 [C.6 节](#c6-agents运行时-agent-登记簿)。
- `runtime`——**hook-owned 运行时参数区**（✎ 非窄腰），装「周期 hook/script 跑起来后维护的瞬态簿记」。白名单键（多数是 ISO-8601 UTC 时间戳·一个是任意非空字符串指纹）：`last_identity_remind`（周期身份提示 hook 读它判阈值·ISO）、`last_critpath_remind`（周期临界路径提示 hook 读它判阈值·ISO）、`last_goal_remind`（Goal Contract 对齐提示判阈值·ISO）、`last_account_switch`（账号切换机制写换号时刻·usage-pacing hook 读它做「检测到换号」ambient·ISO）、`stop_allow_until`（Codex Stop hook 释放闸：agent 独立确认本板可停后写一个短期未来时刻·ISO）、`last_deadline_risk_check`（交付 DDL 风险 hook 上次重估时刻·判周期重估阈值·ISO）、`last_deadline_risk_fingerprint`（交付 DDL 风险 hook 上次 risk-input 指纹·非空字符串·判 verdict/driver/bucket 是否变化以去重节流·**不是时间戳**）——周期 hook / 换号写侧注入 / Stop 释放确认后经 `ccm board set-param` 写回（带锁·进程边界）。**写法收窄**：唯一写口是 `ccm board set-param <白名单 key> <value>`（least-privilege·非白名单 key / 非法值 / 字符串键传空值 → `exit 2`）——agent 走 `ccm` 命令改 board 天然保留它（`ccm` 字段级合并、不整盘覆写；agent 自己**永不手写 `runtime.*`**·见 `master-orchestrator-guide` 的 board-写纪律）。缺/坏 → graceful-degrade（周期提示退化为「从未提示」；Stop 释放闸退化为继续阻止停止）；形状坏→`FMT-RUNTIME` warn（永不 hard）。**token-blind**：参数区只有时间戳等簿记·绝无 secret。

> **不要把 observed 字段写进硬 waist。** 这三档的边界由 `ccm` 引擎权威定义（每字段的 tier 元数据）。

---

## B. status 八态语义 + 生命周期

### 各态语义速查

| status | 含义 | 对 readySet 的影响 | 典型下一步 |
|---|---|---|---|
| `ready` | deps 全满足，可以派发 | **在 readySet 里** | `task start` → in_flight |
| `in_flight` | 已派发、正在跑 | 不在 readySet | 等完成 → `task done` / 失败处置 |
| `blocked` | **两种来源**（见下）：① deps 门控（deps 未全满足·**系统自动**·无 `blocked_on`）② 语义阻塞（在等 user 或另一 task·**手动**·有 `blocked_on`） | 不在 readySet | ① deps 门控：**别手动改**——deps 全满足时任意 ccm 写命令自动归回 ready；② 语义阻塞：`task unblock <id>`（清 `blocked_on`·交回 deps 门控） |
| `done` | 执行完成 | 普通/旧 task 满足 deps；显式 review gate 还须 `review_verdict=APPROVE` | 无须再动，除非上游产物变 → `stale` |
| `escalated` | sub-agent 返回 escalation（超出能力范围） | 不在 readySet | 仍沿用本节点时 `task retry`，或 supersede 后建新 task |
| `failed` | 节点失败 | 不在 readySet | `task retry` 开新 attempt，或升级处置 → `escalated` |
| `stale` | 上游产物变了、需重跑 | 不在 readySet | 重确认输入后 `task retry`（先归档旧 evidence，再开干净新 attempt；旧 review verdict 不参与当前 gate） |
| `uncertain` | 做了但未验（验证节点尚未派出） | 不在 readySet | 验收通过 → `done`，失败 → `failed`，重做 → `in_flight` |

### native-attempt 专属 projection

板通过 `meta.contracts.native_attempt: "ccm/native-attempt/v1"` 显式 opt in 后，latest native attempt 的 append-only 状态与 task 的 status/handle 是一个由 ccm dedicated writer 独占的 projection；它不是 generic status/handle 字段的另一种写法。

| Attempt state / observation | Task projection | 唯一入口 |
|---|---|---|
| `starting` | `ready`，无 `handle` | `native-attempt-create` |
| `running`（认证 spawn + 同 handle live roster 证据） | `in_flight`，投影该真实 opaque handle | `native-attempt-bind` 或同一 handle 的 `native-attempt-reconcile` |
| `uncertain` | `uncertain`，清 active `handle`；阻止新 launch | `native-attempt-reconcile` |
| `terminal`（认证 terminal evidence） | `uncertain`，无 `handle`，绝不直接 `done`/`verified` | `native-attempt-terminal` 或 `native-attempt-reconcile` |
| `orphaned`（完成 fenced orphan audit） | 清 `handle` 后由普通 deps gating 归一为 `ready` 或 `blocked`；只允许后来显式 create | `native-attempt-reconcile` |

latest attempt 为 `starting|running|uncertain` 时，mutation boundary 统一拒绝 generic `task start/done/block/unblock/set-status`、`task update --handle` / 通用 setter、legacy `route-bind` 及其 `--force` 绕路；`BIZ-NATIVE-ATTEMPT-PROJECTION` hard lint 同时捕获 board 上被手改出的 projection mismatch。terminal 只是 worker 事实，不是父 task 验收：父层验证 result/artifact 后，仍从 `uncertain` 走普通 `task done --verified --artifact` true-done 不变式。

attempt 内的 lifecycle record 也受同一 hard projection 约束：`starting` 只能保留 create 初态，不能预载 `handle_binding`、cancel、terminal、时间戳、orphan audit 或 reconciliation；cancel 必须建立在已认证 binding 之后，terminal/orphan record 只能出现在对应可达状态。reconciliation 必须是按 observation time 严格递增的完整可信链：每条都保留私有 evidence ref/hash、source、descriptor、target 与 current lineage，running/terminal/orphaned 的专属 payload 还须分别与原 binding、顶层 terminal、顶层 fenced orphan audit 值相等；classification-only、缺字段、重排或只补一个看似合理顶层 audit 的历史一律 hard-fail。即使加 `--force`，不可能由 dedicated writer 产生的 state×record 组合也会被拒；不要靠手改 board 预填“未来证据”。

**runtime 边界：**当前三 host 的 native-attempt strategy 都是 `unsupported`，Codex 不投影 invoke artifact，也不会默认 spawn。production composition 已能从 owner home 认证 committed reservation/ticket + canonical launch identity、唯一 claim 和 Ed25519 evidence，并在 board durable commit 两侧做可恢复 transaction；这只证明 launch/evidence authority 与 ledger 原子性，不等于 host invocation 已接通。五个 `native-attempt-*` 命令不是 host tool wrapper。`expected_child_target` 是 create 时冻结的期望，不是 spawn/roster 观察，更不能单独证明 handle。

### status 何时转向哪态

**完整合法转移表（ccm 强制）：**

```
ready      → in_flight, blocked
in_flight  → done, uncertain, escalated, failed, blocked
blocked    → ready, in_flight
done       → stale
uncertain  → done, failed, in_flight
escalated  → ready
failed     → ready, escalated
stale      → ready
```

**操作决策——遇到以下情况选哪个状态：**

| 情况 | 选哪个 status | 命令 |
|---|---|---|
| 正常派发后台任务 | `in_flight` | `task start` |
| 后台任务完成、端点验收通过 | `done` | `task done --artifact ... --verified` |
| 后台任务完成、但验证任务还没派 | `uncertain` 或 `blocked_on:<verify-task>` | 见下方辨析 |
| 等用户决策 | `blocked`（`blocked_on:user`） | `task block --on user --decision @file` |
| 等另一 task 完成（非 deps 关系） | `blocked`（`blocked_on:<taskid>`） | `task block --on <taskid>` |
| sub-agent 返回说超出能力 | `escalated` | `task set-status <id> escalated` |
| 任务失败 | `failed` | `task set-status <id> failed` |
| 上游 artifact 变了 | `stale` | `task set-status <id> stale` |
| stale / failed / escalated 节点确认重跑 | 请求 `ready`（新 attempt）；只有 deps 全满足时才保持 `ready`，否则最终归一为 `blocked` | `task retry <id>` |

**retry 是 attempt 边界，不是 status setter：** `task retry` 先把来源 status 与旧 `started_at` / `finished_at` / `artifact` / `verified` / `review_verdict` / `delivery` 归档为 `ccm/task-retry/v1` log detail，再清空当前 attempt 的 `started_at` / `finished_at` / `artifact` / `review_verdict` / `delivery`、把 `verified` 设为布尔 `false`，并请求落 `ready`。这些步骤在同一持锁写入里原子发生；随后 deps 门控用同一个 dependency qualification evaluator 归一最终态（只有 deps 全满足，即 declared edge `qualified` / legacy edge satisfied，才→`ready`；否则→`blocked`），human/JSON 输出逐 task 报这个最终态。旧 verdict / candidate / observation 即使已归档也绝不参与新 attempt 门控。批量任一 id 不可 retry 时整批不落盘。合法的通用 `set-status <id> ready` 也走同一 reset，避免旧入口泄漏旧证据。

**`--force` 越闸是逃生口，不是捷径：** 正常流程用 verb；重跑 stale/failed/escalated 用 `task retry`。用 `--force` 跳 `in_flight` 直接 `done` 会造成无 `started_at` 的 done 节点——伪造审计轨迹，影响 timeline 与 p95 估算。

### ready ↔ blocked 由系统按 deps 自动门控

**每次 ccm 写命令落盘前，引擎自动跑一趟 `reconcileGating` 归一化**——把每个「**无 `blocked_on`**（非语义阻塞）且 status ∈ {ready, blocked}」的 task 按 deps 资格重定：**deps 全满足（declared edge `qualified` / legacy edge satisfied）→ `ready`，否则 → `blocked`**。缺 `delivery_contract` 的历史板、以及 declared 板中未声明 requirement 的边，逐字保持 legacy `dependencySatisfied` 行为。显式 requirement 的 edge 先要求 `taskTrulyDone`；review gate 的 `REQUEST-CHANGES` / 缺 APPROVE 优先 fail closed；再按 candidate 或指定 target delivered 求值。这意味着：

- **你几乎不用手动在 ready/blocked 之间搬**——普通上游 done，或 review 上游 APPROVE 后，下游会自动翻成 `ready`；反之未满足的依赖会让新节点自动落成 `blocked`。
- **手动 `task set-status <id> ready` 会被 deps 否决**——若该 task deps 未全满足且无 `blocked_on`，下一趟归一化会把它打回 `blocked`。想让一个 deps 未满足的节点强行可派发，是设计味道问题（该先切依赖），不是状态问题。
- **`blocked_on` 是「语义阻塞」判别器**：有 `blocked_on`（等 `user` / 等某 task）的节点**整体豁免**自动门控——即便 deps 全满足也不会被翻成 ready（它在等的是人 / 另一件事，不是拓扑就绪）。解除语义阻塞用 **`task unblock <id>`**（清 `blocked_on`，交回 deps 门控按满足度定 ready/blocked），不要用 `set-status`。
- **手改 board 造出的不一致态**（ready 但 deps 未全满足 / blocked 无 blocked_on 但 deps 全满足）由 `BIZ-STATUS-DEPS` warn 兜（见 [N 节](#n-校验规则全集速查fmt--graph--biz)）——CLI 写路径经归一化**永不产生**这类态，看到它多半是手编辑的板。

### uncertain vs blocked_on 辨析

这是最常混淆的两个态：

| | `uncertain` | `blocked_on:<verify-task>` |
|---|---|---|
| **语义** | 做了但不确定是否通过，验证节点尚未派出 | 产物已在，正等一个**具名**的下游 verify 裁决 |
| **hook 提醒行为** | 每拍主动提醒「resolve uncertain」 | 不提醒（已有明确等待目标） |
| **什么时候用** | verify 任务还没建/派 | verify 任务已经在 in_flight（有具名 id） |
| **噪声级别** | 高（重复提醒） | 低（只等具名依赖） |

**操作建议：** 一旦你派出了 verify 任务（它有 id 了），就把「做了未验」的节点从 `uncertain` 改成 `blocked_on:<verify-task-id>`，消掉每拍噪声、语义也更准确。

---

## C. executor 五种语义 + 选择决策树

### 各 executor 语义

| executor | 谁来做 | 典型场景 | 必须的字段 |
|---|---|---|---|
| `subagent` | kimi-code Task 子代理 | `ready` / `blocked` future task 可先写 `executor=subagent`，表达将由 kimi-code Task 子代理执行的计划；真实派发时再调用 Task tool。当前 cc-master 不把 Claude Code `run_in_background` 语义投影成 kimi-code 原语。 | 只有真实 Task 结果返回的 subagent id 才是 `handle`；先回填该真实 handle，再转 `in_flight`。future task 不预填 placeholder，也不能用当前主会话 id 冒充。 |
| `workflow` | 未支持 | kimi-code adapter 没有 verified `Workflow` 等价物；不要为了表达“复杂任务”写 workflow。 | 不应进入 `in_flight`；拆成可追踪 task（Task / 后台 Bash）或用 `external`。 |
| `external` | 外部系统 / 外部调度 | GitHub issue、CI job、人工任务、系统 cron 等不在当前 session 内的 work item。 | references 含 `kind=issue`≥1；`handle` 可记录 issue URL / run id；`artifact` 只在外部实际产出（PR / commit / report / run）可验时填写。 |
| `user` | 用户 | 等人拍板、提供凭据、确认策略或回答需求。 | `blocked_on:"user"` + `decision_package`。 |
| `self` | 当前主线 agent | 只用于极小的编排维护动作；不要把单元实施伪装成 self。 | 写清为何不派发。 |

### executor 选择决策树

```
这个任务需要人类拍板 / 操作？
  ↓ 是 → executor: user
  ↓ 否

这是编排决策本身（replan / 整合结果 / HITL 消化）？
  ↓ 是 → executor: master-orchestrator
  ↓ 否

这个任务会用外部系统完成（CI / 外部 review / 第三方 API）？
  ↓ 是 → executor: external  （必须带 reference kind=issue 指向外部 ticket）
  ↓ 否

kimi-code 下，`executor` 仍是 board 的领域字段，不是 kimi-code API 名。`ready` / `blocked` future task 可先写 `executor=subagent`（host 已验证等价物时也可先选 `workflow`），表达执行计划，但此时不造 handle。真实派发时再调用 **Task**；只有真实 Task 结果能提供 handle，先把它回填，再转 `in_flight`。未验证的派发原语或当前主会话 id 都不能代替 worker handle；没有真实句柄就不要标 `in_flight`。用 **Bash**（后台任务）启后台命令后记 Bash 任务 id；否则用 `master-orchestrator` 记调度动作，或用 `external` 记录真实外部 run。没有被 cc-master adapter 验证成等价派发原语前，不要套用 Claude Code 的完成通知或 workflow 语义。
```

**executor 与 handle 的关系：** `executor` 是谁来执行的计划，因此 `ready` / `blocked` future task 可先选 `subagent` 或 `workflow`，**不要预填 placeholder / phantom handle**。legacy 调用真实派发工具后，立即把其返回的句柄写入 task（`task update --handle <句柄>`），再转 `in_flight`；只有 `status=in_flight` 且 `executor∈{subagent,workflow}` 时，缺 handle 才触发 `BIZ-EXECUTOR-HANDLE`。opt-in native attempt 的 handle 只能由认证 evidence 经 `native-attempt-bind/reconcile` 投影，generic update 会被拒。`external` 节点靠 `reference kind=issue` 的 URL 去外部系统查；`handle` 可选地记录 issue URL / issue number / 外部 run id，方便 recon。`user` 和 `master-orchestrator` 没有后台句柄。

### external + issue tracking 语义

`executor: external` 表示这件工作由当前 session 外的人或系统推进，board 只跟踪它。`references.kind=issue` 是**进度追踪锚点**（tracking anchor），不是完成证据。GitHub issue open / in-progress / closed 都只是外部状态：**closed 不等于 board done**。

| 字段 | external issue task 怎么用 |
|---|---|
| `references[{kind:"issue"}]` | 指向 GitHub issue / ticket，作为外部进度的固定入口（`BIZ-EXTERNAL-ISSUE` warn 兜） |
| `handle` | 可选；写 issue URL、`owner/repo#N`、CI run id 等可续查句柄 |
| `artifact` | 外部实际产出：PR、commit、release、报告、CI run、交付文档等；**不要只填同一个 issue URL**（`BIZ-EXTERNAL-ARTIFACT` warn 兜） |
| `status` | issue 仍 open / in progress → 通常保持 `in_flight`；issue closed 但尚未端点验收 → `uncertain` 或保持非 done；只有验收 artifact 后才 `done --verified --artifact` |

外部实现方说“done”或 GitHub issue 被关闭时，你先把 task 视为“待验收信号”，不要直接 `done`。若 artifact 已可查但你还没验，落 `uncertain`；若发现外部进度停滞 / 被 block / 长期无响应，用 `blocked` / `stale` / watchdog 记录真实状态与下一步 follow-up。

**反模式：**
- 把 `user` 任务标成 `subagent`——看起来在跑、其实没人做。
- 真实派发后把 `executor: subagent` 任务标成 `in_flight`，却不带派发工具返回的真实 `handle`——会触发 `BIZ-EXECUTOR-HANDLE` warn，resume 时也找不到后台任务；唯一例外是通过 hard native projection 校验、尚不应有 active handle 的 native attempt 状态。反之，future `ready` / `blocked` 任务不应为了消 warning 预填 phantom handle。
- 把 orchestrator 自己的整合工作标 `subagent`——指挥不演奏（orchestrator 协调、不亲手做单元工作），orchestrator 的工作应标 `master-orchestrator`。

---

## C.5 cross-harness planning / routing 合同

这是 **opt-in 的 board planning / ledger / activation contract**，不是自动派发器。它把「任务需要什么」和「有哪些合格执行候选」分开持久化，使换 session、换 origin harness 或 resume 后仍能重建选择依据：

| 对象 | 回答的问题 | 写口 |
|---|---|---|
| `task.planning` · `ccm/task-planning/v1` | 任务本身有多难、多险、上下文多大，质量底线、预算姿态与能力边界是什么 | `ccm task set-planning <id> --profile @/abs/planning.json` |
| `task.routing` · `ccm/agent-routing/v1` | 哪些 host-native / cli-headless candidate 合格，ample / tight 各按什么链尝试，哪些失败可 fallback | `ccm task set-routing <id> --policy @/abs/routing-policy.json` |
| `routing.selected` + `routing.attempts[]` + task `handle/status` projection | 实际选了谁、依据何在、哪个 running attempt 与 opaque handle 对应 | `ccm task route-bind <id> --selection @/abs/selection.json --attempt @/abs/attempt.json` |
| `board.meta.contracts` | 本板是否要求非 grandfathered `subagent` 都遵守上述合同 | `ccm board enable-contract [--preflight]` |

### planning：先评估任务，不先选品牌

`planning.dimensions` 七维都必填；它们描述任务，不描述当前 session 所在 harness：

| 维度 | 合法值 |
|---|---|
| `reasoning` | `routine | multi-step | novel | frontier` |
| `uncertainty` | `low | medium | high | unknown` |
| `risk` | `low | medium | high | critical` |
| `scope` | `local | multi-file | cross-module | cross-repo` |
| `context` | `small | medium | large | oversized` |
| `coordination` | `none | single-boundary | multi-boundary` |
| `reversibility` | `reversible | costly | irreversible` |

同一 profile 还必须带：严格 UTC `assessed_at`、非空 `assessor`、`estimate_confidence: low|medium|high`、`quality.effect_floor`、`budget.posture: ample|tight`、正整数 `budget.max_attempts`，以及 `capabilities.required/preferred/forbidden` 三组 capability object。新写入的模型角色 policy 中，`quality.effect_floor` 只取 `O | T1 | T2 | T3`：设计 / 规格和高风险异族 review 用 `O`，完整规格实现与常规异族 review 用 `T1`，只读研究 / grounded summarize 用 `T2`，机械确定性工作用 `T3`。`required` 至少一个；三组 id 各自唯一且不可跨组重叠。task 本身还要有正数 `estimate`。

```json
{
  "schema": "ccm/task-planning/v1",
  "assessed_at": "2026-07-16T08:00:00Z",
  "assessor": "master-orchestrator",
  "dimensions": {
    "reasoning": "multi-step",
    "uncertainty": "medium",
    "risk": "medium",
    "scope": "multi-file",
    "context": "medium",
    "coordination": "single-boundary",
    "reversibility": "reversible"
  },
  "estimate_confidence": "medium",
  "quality": { "effect_floor": "T1" },
  "budget": { "posture": "ample", "max_attempts": 2 },
  "capabilities": {
    "required": [{ "id": "repository-reasoning" }],
    "preferred": [{ "id": "structured-output" }],
    "forbidden": [{ "id": "account-mutation" }]
  }
}
```

### routing：候选是跨 harness 资源，不是 origin-local 默认值

`routing.policy` 精确承载：

- `objective`：`quality-first | balanced | cost-first`。
- `constraints`：非空 `effect_floor`；`quota_unknown` 必须是 `ineligible`；`cross_harness_quota_admission` 必须是 `ample-only`。
- `candidates[]`：每项显式给 `id`、`surface: host-native|cli-headless`、`adapter`、`harness`、`provider`、**精确** `model`（禁止 `auto`）、`effort`、`capabilities[]`、`effect_floors_met[]`、`permission{profile,denies[]}`、`account_mutation:"forbidden"`、`requires[]`。候选能力必须覆盖 planning.required、满足 effect floor，permission.denies 必须覆盖 planning.forbidden 和 `account-mutation`。
- `requires[]` 至少含 `capability-match`、`effect-floor`、`permission-compatible`、`account-mutation-forbidden`；其它机械资格（例如 runtime health）可显式追加。
- `chains.ample` / `chains.tight`：candidate id 的有序、无重复链；同 harness 也只有显式列成 candidate 才能 fallback 回去。两条链都必须保持 planning 的同一 effect floor；tight 只能在同档候选中改为价格 / quota 优先，不得用降档冒充 fallback。
- `fallback.on` 只允许机械失败：`binary-unavailable | auth-expired | model-unavailable | model-mismatch | quota-tight | rate-limited | startup-timeout | transport-error`。
- `fallback.never_on` 必须覆盖：`policy-blocked | permission-blocked | security-blocked | workspace-mismatch | task-blocked | acceptance-failed`；`exhaustion:"fail-closed"`、`same_harness:"explicit-candidate-only"` 固定 fail-closed。

`set-routing` 只生成 `mode:"cross-harness"`、`selected:null`、`attempts:[]` 的 envelope；**它不读取 provider、不选择 candidate、不 reserve、不 spawn、不 fallback**。candidate 的 `harness/provider/model/effort/surface` 是 ledger 中的计划事实，不是 ccm 对各家 CLI flags 的复制。

先用 `ccm model-policy show --task <task-taxonomy> --json` 取得三路共用的角色 / 事实 / affinity 视图，再对每个候选独立取得 live admission。只把已过硬门的精确 target 写进 routing policy：

- 系统 / 架构 / spec 节点：`effect_floor: "O"`；master 独有全图判断用 `executor=master-orchestrator`，可独立交付设计 artifact 才用 O subagent。
- 实现节点：完整 spec 下用 `T1`；常规 review 也用与 producer 不同 family 的异族 `T1`。
- 安全 / 架构 / adversarial review：用异族 `O`；无 O 容量就保持 gate blocked。
- repository / web research：`T2`；纯机械提取可另切 `T3` leaf，不能原地降低研究节点的 floor。

示意链：`chains.ample=["t1-quality", "t1-cheap"]`，`chains.tight=["t1-cheap", "t1-quality"]`。两条都只引用 `effect_floors_met` 含 `T1` 且已准入的候选；quota tight 可重排，不得塞入 T2。Cursor third-party Fable / Sol 还必须有明确 payer、paid-use 与 retention 授权，否则不要写进任何 chain。

community taste 只影响合格候选的近似同分排序。最终 routing rationale 应通过现有 selection / log 记下 model-policy registry revision、task taxonomy、采用或忽略的 evidence refs 与理由；不要把 community ledger 全量复制进 board，也不要把它写进 `effect_floors_met`。

### activation 与写入顺序

**在 legacy board 上准备现有 subagent task：**

```bash
ccm task update T7 --estimate 3h
ccm task set-planning T7 --profile @/abs/planning.json
ccm task set-routing T7 --policy @/abs/routing-policy.json
ccm board enable-contract --preflight --json   # 只读；ready:true 才继续
ccm board enable-contract
```

`enable-contract` 会为现有 `done|failed|escalated` subagent 记录精确 grandfather fingerprint；它们不必伪造历史 planning/routing。若之后 retry，该新 attempt 不再豁免。activation 没有 generic setter 或 disable 旁路，先 preflight 再启用。

**已 enabled 的 board 新建 subagent task：**先建 planned task，完整准备 `estimate` / planning / routing，最后一次性把 executor 定成 `subagent`；启用后的 subagent executor 会冻结，不能靠改 executor 绕 route gate。

```bash
ccm task add T8 --type planning --estimate 2h
ccm task set-planning T8 --profile @/abs/planning.json
ccm task set-routing T8 --policy @/abs/routing-policy.json
ccm task update T8 --executor subagent
```

只有派发面已经返回非空 opaque running handle、且 selection evidence 在有效时间窗内把 candidate 的每个 `requires` predicate **恰好一次**证明为 `pass` 时，才调用 `route-bind`。它原子写 `routing.selected`、append running attempt（并冻结完整 `selection_snapshot`）、投影 task `handle`，再把 task 转为 `in_flight`；attempt 的 candidate/model/effort 必须与 selection/candidate 一致。当前合同只校验 handle 的非空 syntactic claim，不把它升级成 live provider attestation。

### 与显式 `ccm worker` raw wrapper 的当前边界

`ccm worker help/run` 已是 current 的 session-bound raw wrapper，但它与 routing ledger **没有自动接线**：不会读 policy 自动选 route，不会把 process terminal 当 running handle，不会调用 `route-bind`，也不会自动 fallback。同步 `worker run` 只在 child terminal 后返回 process envelope；provider exit 0 也不等于 parent acceptance 通过。

因此，只使用 raw wrapper 的 board 可以保持 legacy lifecycle；不要为了“看起来先进”启用一个当前派发面拿不到 opaque running handle 的 routing contract。等实际 dispatch surface 能返回 handle 时再按上面的 activation/bind 顺序 opt in。无 `meta.contracts`、无 `planning/routing` 的历史 board/task 继续逐字保持 legacy 行为。

---

## C.6 agents[]：运行时 agent 登记簿

`agents[]` 是 board 级 ✎ 段（hook 不读·窄腰零碰撞）：**跨所有派发类型的统一运行时花名册**。纪律一句话：**凡派发皆登记**——你每派出去一个 sub-agent / 后台 shell / workflow / 跨 harness CLI worker，就 `ccm agent create` 登记一条，让花名册、viewer 和 resume 后的自己能看见「现在总共多少 agent 在跑、各自在干什么、还活着没」。

**agent 和 executor 的分层（别合并、别互推）：**

| | task 的 `executor` | `agents[]` 里的一条记录 |
|---|---|---|
| **层** | planning 层：**计划**由哪类执行者做 | runtime 层：**实际跑起来**的运行时实例 |
| **基数** | 每 task 一个值 | 与 task 多对多（一个 agent 可服务多个 task，一个 task 可换多个 agent） |
| **何时写** | 派发前规划时 | 真实派发那一刻（create）+ 拿到句柄时（bind） |

一个 `executor: subagent` 的 task 被真实派发时，对应动作是两笔：task 侧照旧（`task start` / `--handle`），agent 侧 `agent create` + `agent bind` + `agent link <id> --task <task-id>`。join 存 agent 侧 `links[]`，不动 task 的 routing / attempt 结构。

**生命周期状态机：何时转哪态（只走专属 verb，别用 `--set` / `--set-json` 手改）：**

| 情况 | 转到 | 命令 |
|---|---|---|
| 刚发起派发、还没拿到句柄 | `starting` | `agent create --type ... --harness ... --intent "..."` |
| 拿到真实句柄（session id / pid） | `running` | `agent bind <id> --handle <kind:value>`——**无真实证据会被拒（exit 3）**，别用占位值硬凑 |
| probe 发现会话文件陈旧（在但不动了） | `uncertain` | `agent probe` 自动降级，不用手转 |
| probe 确定性判死 | `orphaned` | `agent probe` 自动降级，不用手转。判死只认两种确定性证据：① `pid` kill-0 进程不存在；② mtime 类方法的「曾在而消失」——上一次同方法观测到过 `alive`/`silent`、本次**完整**扫描确认文件缺失。**从未见过文件只出 `unknown`、state 不动**（启动竞态下文件可能尚未落盘）；扫描不完整（目录预算耗尽 / 读取失败）也不判死 |
| worker 收工或起跑失败（成功 / 失败 / 根本没起来都要收口） | `terminal` | `agent terminal <id> --outcome "..."`——`starting` 也能直接收口（启动失败别留永久僵尸）。**terminal ≠ task done**，task 仍走父层独立验收；terminal 是唯一终态，probe 永不复活 |
| `uncertain` / `orphaned` 后观测到还活着 | `running` | `agent probe` 双向 reconcile 自动归回，但复活按证据强度分级：`uncertain` 任何方法的 `alive` 都归回；**`orphaned` 只被 session / transcript 文件类的 `alive` 复活**（按 sid / 路径寻址、身份强），`pid` 的 `alive` 不够格（kill-0 不验进程身份·pid 复用会产生假 alive）。也可重新 `bind` 交新 handle |

**登记后要修正 handle：用 `amend`，别重复 `create`。** 发现 handle 拼错、attach 命令漏了 `cd`、transcript 路径写错——`ccm agent amend <id> --handle/--attach-cmd/--transcript` 就地补正 handle 域三件套（任何状态可用，含 `terminal`；不做状态转移、不碰 `lifecycle.state` / `probe` / `links` / `intent`）。**绝不重复 `create` 一条新登记**——同一个真实 worker 两行 roster 是撕裂，花名册 / viewer / resume 后的自己会数错在跑的 agent。真多登记 / 误登记出来的多余行用 `ccm agent rm <id>`（破坏性·非 TTY 须 `--yes`）清除；`amend` 补正保留的那条、`rm` 删多出来的那条。两者都不经状态机。

**handle.kind 怎么选：**

| kind | 什么派发用 | attach 方式 |
|---|---|---|
| `session-id` | 跨 harness CLI worker（codex / claude-code headless） | `--attach-cmd` 记一键接入命令，**必须自包含**——执行位置敏感的连 `cd` 一起登记（如 `cd /abs/worktree && claude --resume <sid>`：claude-code 的 resume 必须在原 cwd 执行，session 按项目目录归档）。codex 的 sid 运行时才生成：先 `pid` + `--transcript` 兜底 bind，再从 `codex exec --json` 日志首行 `thread.started` 事件取 `thread_id`（即 sid）升级 bind（完整配方见 command-catalog 的 agent bind 节；`codex exec resume --last` 接错 session 风险，不可作 attach 命令） |
| `pid` | 后台 shell 进程 | 无 attach；probe 用进程存活判定 |
| `task-id` | 以 task 粒度跟踪、只有 transcript 可查的派发 | `--transcript` 记 transcript 路径引用（绝不内嵌内容） |
| `none` | 尚无证据（create 后的缺省态） | 不可手选——bind 不接受 `none` |

**probe 字段是 ccm 写的，别手填。** `probe.{last_probe_at, method, observed, as_of}` 与 probe 引发的 lifecycle 升降级全部由 `ccm agent probe` 落盘；`observed` 的语义是保真观测（`alive` / `silent` / `gone` / `unknown`）——`gone` 只出自确定性证据（pid kill-0 判死，或「上次同方法观测到过、本次完整扫描确认消失」的 seen-before 判死），从未见过的文件 / 扫描不完整只出 `unknown`；拿不到就 `unknown`，ccm 不会用相邻字段推导补齐，你也不要手拼一个「看起来合理」的观测值伪造活性。上一次的 `probe.method` / `probe.observed` 还是下一次 seen-before 判死的输入——手改它会让判死链失真。同理 `account_ref` / `quota_pool_ref` 当前是预留位（保持 `null`），别自创取值。

**会撞的规则**（详见 [N 节](#n-校验规则全集速查fmt--graph--biz)）：段形状坏 → `FMT-AGENTS` warn（graceful·不拦写盘，但 `ccm agent list/show` 与 viewer 花名册会读不出坏条目）；task 已 `in_flight` 却无任何 agent 登记指向它 → `BIZ-INFLIGHT-AGENT` warn（软提示补登记）。

---

## D. acceptance 怎么写好

`acceptance` 是这个 task 的「目标函数」——什么情况算完成。acceptance 哲学（验收 = ML 优化目标函数的设计）属于 `dev-as-ml-loop` skill；这里只给**操作侧：怎么填好这个字段**。

**两种形式：**

**1. 一句话 DoD（轻量，推荐优先用）**

```bash
ccm task add T3 --type development --accept "用户能在 3 秒内完成注册流程，端到端测试全绿"
```

或用文件：

```bash
ccm task add T3 --accept @/abs/path/to/acceptance.md
```

**2. 结构化 criteria 对象（需机器可判断多条件时）**

```bash
ccm task update T3 --set-json 'acceptance={"criteria":[
  {"desc":"E2E 测试全绿","kind":"test","check":"npm run test:e2e","status":"pending"},
  {"desc":"P95 响应 <500ms","kind":"metric","target":"<500ms","status":"pending"}
]}'
```

**写好 acceptance 的三条操作原则：**

| 原则 | 好的写法 | 坏的写法（反模式） |
|---|---|---|
| **可验收** | "单元测试全绿 + PR merged" | "代码质量好"（无法机器或人工判定） |
| **粒度合适** | 一句话覆盖完成条件 | 把实现步骤写进 acceptance（那是 description / plan 的事） |
| **不过细** | "lint 无 error" | "第 47 行变量名改成 camelCase"（implementation detail） |

**特定 type 的 acceptance 要求：**

- `development` / `development-demo` / `acceptance` / `e2e-integration`：**必须**有 `acceptance`，否则 lint 报 `BIZ-ACCEPTANCE-REQUIRED` warn。
- 其余 type：推荐写，不强制。

**acceptance object 里的 `criteria[].status`：** 每条 criterion 有自己的 `status`（`pending / met / failed`）。`acceptanceConverged`（ccm 内部谓词）= criteria 全 `met` 且非空，才算目标函数收敛。你在验收时逐条把 `status` 更新到 `met` / `failed`（`task update --set-json`），视图里的 acceptance 灯就会随之更新。

---

## E. estimate 怎么估

`estimate` 存时间估算，喂 CPM 算临界路径，也喂 cadence health 判断 iteration 是否装得下。

**格式：**

```bash
ccm task add T3 --estimate 3h    # 3 小时
ccm task add T4 --estimate 90m   # 90 分钟
ccm task add T5 --estimate 2d    # 2 天
ccm task add T6 --estimate 1w    # 1 周
```

存储形态是 `{value: 3, unit: "h"}`，由 ccm 自动解析。

**粒度参考（操作侧）：**

| 粒度 | 典型 estimate | 行动指南 |
|---|---|---|
| 几分钟 | `15m`–`30m` | 考虑合并到上下游，太细增加调度开销 |
| 半小时到几小时 | `1h`–`6h` | 理想粒度，可并行、可独立验收 |
| 半天到一天 | `4h`–`8h` | 可接受；估算有 24% 离散度，误差在一个数量级内 |
| 多天 | `2d`+  | **考虑再切**：任务畸大往往意味着可以纵切成更小的、可独立交付的薄片——切法参见 `slicing-goals-into-dags` skill |
| 超过 1 周 | `1w`+ | 几乎肯定要拆；这种粒度的 estimate 误差巨大、无法驱动有效调度 |

**estimate 缺失时的降级：** CPM 用默认 unit（工期排序仍运行，但 makespan 是 `weight_source: "mixed"`，精度降低）。但在 open cadence iteration 里，缺 estimate 会触发 `BIZ-CADENCE-MISSING-ESTIMATE` warn：这不是 hard gate，但表示你无法判断本轮 timebox 是否 overbooked。

**不要把 estimate 当承诺：** 它是输入，不是 SLA。`actual = finished_at − started_at`（从时间戳可算），事后回流校准下次估点。

---

## F. deps 怎么连

`deps` 是 task 的「依赖边」——只有当 deps 中的 task 全部满足之后，这个 task 才进 readySet 可以派发。普通/旧 task 以 `status=done` 满足；显式 review gate 必须 `status=done` 且 verdict 为 `APPROVE`。

**操作命令：**

```bash
# 建 task 时一起加
ccm task add T5 --deps T1,T3

# 建好之后增减
ccm task update T5 --add-dep T2
ccm task update T5 --rm-dep T3
```

**review 审批依赖：执行完成与批准是两件事。** 要求某个 review 明确批准后才放行下游时，在 review task 上声明 gate：

```bash
ccm task add R1 --type review --review-gate APPROVE
ccm task add IMPLEMENT --deps R1
ccm task start R1

# 审查执行完成，但要求修改：R1=done；IMPLEMENT 仍 blocked
ccm task done R1 --artifact /abs/review.md --verified --review-verdict REQUEST-CHANGES

# 修改完成后复活并执行新一轮审查；stale→ready 自动清旧 verdict
ccm task set-status R1 stale
ccm task set-status R1 ready
ccm task start R1
ccm task done R1 --artifact /abs/review-v2.md --verified --review-verdict APPROVE
```

`review_verdict` 只属于当前 attempt。`stale|failed|escalated → ready` 是统一 retry 边界，会清除 current verdict；旧值即使进入 retry 审计也不参与门控。retry 后 `task done` 不带 verdict 时仍保持缺失，绝不会复用上轮 `APPROVE`。缺失、空、null、非法值或 `REQUEST-CHANGES` 都不会开门（非法形状还会被 lint hard gate 拒绝）。没有 `dependency_gate` 的旧板/普通 task 继续按 status-only 语义运行，不需要迁移。

**declared delivery edge 的三层真相：**

1. `candidate-complete`：上游满足 `taskTrulyDone`；它证明本 attempt 已完成并验收，不证明已到接收端。
2. `target-delivered`：当前 candidate 对冻结 target snapshot 有可重验 proof。Git 支持本地 exact containment，或
   “integration commit contained + fresh APPROVE attestation 精确绑定”的 reviewed reconciliation；非 Git 支持
   immutable artifact/ref/digest manifest containment。target ref 漂移或本地 object 缺失后旧 observation 变
   `unknown`，不是 false positive。
3. `dependency-qualified`：downstream exact edge（或 `*` fallback）的 requirement 求值得到
   `qualified|unqualified|unknown`。这是派生值，不落一个可陈旧的 bool。waiver 只会让 exact
   user-authorized、edge-scoped、未过期 requirement `qualified_by=waiver`；它始终
   `target_delivered=false`。

```bash
ccm target set main --kind git-ref --ref refs/remotes/origin/main
ccm dependency require DOWN UP --level delivered --target main
ccm task attest-delivery UP --target main --method git-commit-contained --candidate-commit <oid>
ccm dependency explain DOWN UP
```

`candidate` requirement 只需第一层；`delivered` requirement 必须第二层（或有效 waiver）。所有显式 edge
都先过 true-done + review gate。`ccm delivery audit --strict-dry-run` 只把未声明 edge 在本次读取里显示为
unknown，绝不改 persisted mode；strict-default 尚未启用。

**真实数据依赖 vs 虚假保险边：**

| | 真实数据依赖 | 虚假保险边（反模式） |
|---|---|---|
| **定义** | T5 的执行**需要** T1 的 artifact 作为输入 | T5 和 T1 没有真实数据依赖，但「感觉应该先做 T1」 |
| **影响** | 合法：T1 done 之前 T5 不进 readySet | 阻塞本可并行的工作，拉长 makespan |
| **检测** | 问：「去掉这条边、T5 能先跑吗？」是 → 虚假边 | |
| **处理** | 保留 | 删掉，用 `task update --rm-dep` |

**deps 的图约束（lint 强制）：**
- 不能有悬挂引用（`GRAPH-DANGLING`·hard error）：被 deps 引用的 id 必须存在
- 不能自环（`GRAPH-SELFLOOP`·hard error）
- 不能有有向环（`GRAPH-CYCLE`·hard error）
- 希望全图弱连通、无孤岛子图（`GRAPH-CONNECTED`·**warn 非 hard**）：连通性 = **deps 边 ∪ parent 容器边**，把二者都当无向边算，若分量数 > 1（某任务和主图没有任何依赖/归属关系、成了孤岛）发 warn，列出各分量的 task-id（主图 = 最大分量、其余 = 孤岛）。为目标聚焦希望图全通但不强求，故只 warn 不阻断；edge case：0/1 个（非 fill-work）任务或全连通不 warn。**parent 容器边计入连通**——一个 `deps:[]` 的嵌套子任务经其 owner 连进主图、不被误判孤岛。修法：给孤岛补 deps 连回主图（或挂到一个已连通的 owner 下），或确认它独立后忽略。
  - **连通性只在「非 fill-work」节点上判——`role:fill-work` 豁免**：fill-work 定义即「脱离主图的填闲并行工作」、**故意独立**，把它计入会对每个 fill-work 节点常态误报孤岛（cry-wolf）。故连通性判定时 fill-work 节点整体从节点集剔除（连同其边），纯 fill-work 的孤岛不再 warn——无需给 fill-work 硬凑 deps 连回主图。
  - **`awaiting-user` / 决策门节点**不**豁免**（用户拍板的设计原则）：一个 `blocked_on:user` 的决策门本应是**某主图工作节点的前驱 / 子 / 子图 / 节点本身**——它 gate 某段下游工作，故理应连进主图。一个无上下游的孤立决策门正是该 warn 的**真遗漏**（漏接了它 gate 的下游），照常计入 GRAPH-CONNECTED。修法不是豁免，而是把它接进主图：让它 gate 的那个下游工作节点 `deps` 含这个决策门（决策门 gate 下游），或给决策门本身合理 deps。

deps 图的排期、临界路径计算（哪条链条最长、哪个 task 先派最解锁下游）属于 `master-orchestrator-guide` skill 的调度方法论范畴；本文给的是「怎么连对」，不复述排期。

---

## G. blocked_on 怎么选

`blocked_on` 由 `task block --on <target>` 命令设，只有两种合法值：

```
blocked_on = "user"     # 阻塞在用户决策 / 操作
blocked_on = "<taskid>" # 阻塞在另一个 task（非 deps 关系的动态阻塞）
```

**`blocked_on` 是「语义阻塞」判别器：** 有 `blocked_on` 的 blocked 节点是在等**人 / 另一件事**（语义阻塞），与「deps 拓扑就绪」正交——它**豁免** deps 驱动的自动门控（`reconcileGating`），即便 deps 全满足也不会被自动翻成 ready。无 `blocked_on` 的 blocked 节点则是纯 **deps 门控**（系统据 deps 满足度自动定 ready/blocked，见 [B 节](#ready--blocked-由系统按-deps-自动门控)）。**解除语义阻塞用 `task unblock <id>`**（清 `blocked_on`，交回 deps 门控），别手 `set-status`。

**选择表：**

| 情况 | 选 blocked_on | 备注 |
|---|---|---|
| 需要用户拍板 / 提供输入 / 审批 | `"user"` | 必须带 `decision_package`（否则 BIZ-AWAITING hard error）；解除用 `task unblock` |
| 等某个先决任务，但它不是 deps 里的静态依赖 | `"<taskid>"` | 动态阻塞；taskid 必须存在（否则 FMT-BLOCKED-ON warn）；解除用 `task unblock` |
| deps 里的 task 尚未满足 | 不用 block | deps 门控本身就是阻塞——**系统自动**把它落成 `blocked`（无 `blocked_on`），deps 全满足时自动归回 `ready`，无需手动 block/set-status |

**别把 awaiting-user 决策伪装成 judgment_call。** `blocked_on:"user"` + `decision_package` 表示「用户还没拍板、agent 不能替他决定」；`judgment_call` 表示「agent 已经做过一个重要自驱判断，等用户回来知情 / 复盘 / 追认」。merge / 发布 / 不可逆 / 对外 / 授权 / 方向性决定这类 must-escalate 边界，必须走 awaiting-user 决策节点，而不是先斩后奏记成 jc。

**awaiting-user 节点的 decision_package 必须提前备好：**

`blocked_on: "user"` 的节点是给用户的「采访包」——用户点开 `cc-master:discuss` 时靠 `decision_package` 里的内容理解上下文、做决策。**没有包 = discuss 开不起来**，所以 lint 对这类节点做 `BIZ-AWAITING` hard 校验：

```bash
# 正确：block 时同时带 decision_package
ccm task block T9 --on user --decision @/abs/path/decision.json
```

`decision.json` 的 canonical 字段：`prepared_at` / `inputs_hash` / `freshness` / `ask_type` / `context_md` / `question` / `what_i_need` / `why_it_matters` / `options[]` / `enter_cmd`。`ask_type` ∈ `{decision, advice, solution}`——明确告诉用户要「决策、建议还是方案」：

| ask_type | 什么时候用 |
|---|---|
| `decision` | 有几个方案，要用户选其一（`options[]` 必填非空） |
| `advice` | 需要用户提供建议或判断，没有预设选项 |
| `solution` | 需要用户提供一个解法（你不知道方案是什么） |

---

## H. judgment_call（jc）：何时建、severity 怎么定

**judgment_call（jc）是自驱决策记录（autonomous decision record / judgment record）**——记录 agent 在自驱模式下**已经做过**的重要判断。它的存在价值：用户回前台 / 新 session resume 后，能快速了解「这里 agent 自己判断了什么、为什么、影响多大、是否需要复盘或追认」。

它不是待办队列，也不是 awaiting-user 的替代品。拿不准时先问一句：**这件事是我能先行、但需要用户事后知情或复盘，还是只有用户能拍板？** 前者建 jc；后者建 `blocked_on:"user"` 节点并挂 `decision_package`。

**何时建 jc：**

| 场景 | 要不要建 jc |
|---|---|
| 在两个技术方案之间做了选择，影响后续路径但仍可推翻 | **建** |
| 依赖版本 / API 漂移，选择了兼容策略 | **建** |
| 发现 spec 和实现有偏差，自己判断了临时路线 | **建** |
| 为了继续推进，选择了一个可逆的默认值 / 降级策略 | **建**（通常 low/medium） |
| merge / 发布 / 对外承诺 / 授权 / 不可逆迁移 / 方向性拍板 | **不建 jc；改建 `blocked_on:"user"` + `decision_package`** |
| 执行明确的既定方案，无自由裁量 | **不建** |
| 小的实现细节（变量命名、函数拆法）无不可逆影响 | **不建**（太多 jc 会淹没重要条目） |

```bash
ccm jc add "选用 ICU MessageFormat 而非自研格式化" \
  --category architecture \
  --severity high \
  --decision "采用 ICU MF，理由：生态成熟、多语言团队熟悉" \
  --rationale "自研维护成本高、缺陷风险大" \
  --impact "i18n 格式化层完全依赖 ICU MF 生态"
```

**category 四选一：**

| category | 含义 |
|---|---|
| `architecture` | 技术架构 / 技术选型决策 |
| `drift` | 与原计划 / spec 的偏离 |
| `spec-impl-misalignment` | 发现 spec 和实现不一致、自行裁量 |
| `other` | 不属于以上三类 |

**severity 怎么定（对应回前台汇报强度）：**

| severity | 汇报口径 | 判断标准 | 示例 |
|---|---|---|---|
| `low` | FYI | 影响局部、可逆、风险小 | 选择一个默认配置 / 轻量降级 |
| `medium` | review | 影响多个模块、反转有成本 | 选用某个库替代另一个 |
| `high` | review（优先提） | 影响架构或核心路径、反转代价大 | 换接口协议、改存储方案 |
| `critical` | must-escalate 检查 | 影响系统整体、涉及安全 / 合规、或接近不可逆边界 | 若仍可推翻才记 jc；若需要用户授权，改走 `blocked_on:"user"` |

**jc 的生命周期：**

1. **`pending_review`**（建立时）：等用户审阅
2. **`upheld`**（`ccm jc resolve J1 --status upheld`）：事后看决策是对的
3. **`overturned`**（`ccm jc resolve J1 --status overturned --note "理由"`）：需要推翻、重做

high / critical jc 在 kimi-code Stop hook / recon 提醒回前台时会被显眼提示——用户不必主动去查，hook 会告知；缺 hook 时由你在 recon 中主动检查。

---

## I. cadence 与 iteration：节奏怎么定

**cadence 是在纯 DAG 调度之上叠加节奏约束**——给长跑编排设定「多久应该交付一次可见的价值」和「当前这轮包含哪些任务」。适合需要对外持续汇报进度、或要求定期 ship 的目标。

**两层概念：**

- **`target`**（节奏目标）：`ship_every`（多久 ship 一次，如 `3h`）+ `min_unit`（最小 ship 单元，如 `"1 PR"`）
- **`iteration`**（具体一轮）：`open` → `shipped` 的生命周期，有明确 goal + deadline + members

**怎么定节奏（操作侧）：**

```bash
# 先设节奏目标
ccm cadence update --ship-every 3h --min-unit "1 PR"

# 开一个具体 iteration
ccm cadence open I1 \
  --goal "完成 i18n 框架 + 2 个 locale" \
  --deadline 2026-06-25T18:00:00Z \
  --members T0,T1,T2

# iteration 结束时收口（members 必须全 done + verified）
ccm cadence ship I1
```

**deadline 必须严格 ISO-8601 UTC（`YYYY-MM-DDTHH:MM:SSZ`）**：非此格式的 `deadline` 会触发 `FMT-CADENCE` warn，且 viewer 时间轴可能错误渲染。

**iteration members 的选取原则：**
- 只纳入**本轮真正能完成并验收**的 task（不要把「可能完成」的也放进去）
- 每个 member 要有 `estimate` + `acceptance`。缺 estimate 会让容量判断失明，缺 acceptance 会让「本轮 ship 了什么」不可验。
- `members` 估时总量、member 内关键路径、单个 oversized task 都会被 lint 作为 warn 提醒。看到 `BIZ-CADENCE-OVERBOOKED` / `BIZ-CADENCE-CRITICAL-PATH-OVER` / `BIZ-TASK-OVERSIZED-FOR-CADENCE`，优先拆小或移出本轮；不要靠强行 `ship` 掩盖超载。
- members 全部 `done + verified` 才能 `cadence ship`（`BIZ-CADENCE-SHIPPED`·hard error）
- 若 members 无法按时全部完成：提前从 iteration 里移出来，不要强行 ship 不完整的 iteration

**无 cadence 时（纯 DAG 模式）：** board 只有 tasks 和 deps，ccm 按 readySet 调度，没有时间约束。cadence 是可选的节奏层，缺失时 ccm 正常运转。

---

## J. parent / owner 嵌套语义

`parent` 是容器边——让 board 承载 **depth=1 的嵌套调度图**（owner 节点 + 它的子节点）。

**核心语义：**

```
parent 边方向：子 → 父（指向容器 owner）
deps  边方向：任务 → 上游（指向 dep）
两者正交，互不影响
```

**操作示例：**

```bash
# 建 owner 容器节点（本身是顶层节点，不带 parent）
ccm task add PHASE1 --title "第一阶段：框架建设" --type planning

# 建子节点，归属 PHASE1
ccm task add T1 --parent PHASE1 --deps T0 --type development --accept "框架测试全绿"
ccm task add T2 --parent PHASE1 --deps T0 --type development --accept "配置层单测全绿"

# 查某 owner 的子节点
ccm task list --parent PHASE1
```

**depth=1 不变式（ccm 强制）：**
- owner 的子不能再有子（`GRAPH-PARENT-DEPTH`·hard error）
- parent 引用必须存在（`GRAPH-PARENT-EXISTS`·hard error）
- parent 链无环（`GRAPH-PARENT-CYCLE`·hard error）

**rollup 纪律（关键，容易踩）：**

父节点 `done` 应当满足：① 全子 done ② 父自身端点验收过（整合子产物、跑全套测试）。

lint 的 `GRAPH-ROLLUP` 规则在「done owner 有非 done 子」时发 warn（不 hard fail，容许「父整合中、子刚标完」的瞬态）。

**给 parent 节点加 deps 的反模式：**

```bash
# 反模式：给 owner 本身加真实依赖边
ccm task update PHASE1 --add-dep T5  # T5 是另一个 owner 的子

# 正确：依赖关系连在叶节点上
ccm task update T1 --add-dep T5      # T1 的产出确实依赖 T5
```

owner 容器节点的 `deps` 应该为空或只含真实的 board 级前置（整个阶段的前置条件）。把父的 deps 连到另一 owner 的子节点，语义上是「整个 PHASE1 的所有子都等那个子」，几乎总是错的——往往应该只有 PHASE1 里某个具体子 task 依赖 T5。

**`parent` vs `deps` 正交性（重要）：** 子节点可以 `parent` 指 owner-A，同时 `deps` 指 owner-B 的某个子——两条边各表各的。拓扑就绪（deps 全满足）和所属容器（parent 指向）是两件独立的事。

---

## K. watchdog：何时 arm、watchdog / legacy wakeup 字段含义

kimi-code 下 watchdog 先是 board 里的 liveness 契约：记录“什么时候该回来 recon、回来查什么、超时如何处置”。它不等于已经存在一个 kimi-code-native 的 CronCreate/ScheduleWakeup 工具。需要自动唤醒时，降级到 background Bash-floor 或外部调度，并把句柄写进 board。

**何时 arm watchdog：**

| 情况 | 要不要 arm |
|---|---|
| 派发 sub-agent 后进入空转等待 | **arm**，fire_at 设为 p95 估算时刻 |
| 等用户回复（`blocked_on:user`） | 视情况——等待时间可预期时可 arm；长期等用户可不 arm |
| 短时间内就能确认（几分钟）| **不用 arm**，直接等 |
| 无 `in_flight` 任务 | **不用 arm**，没有静默失败风险 |

kimi-code hook 可以在 Stop / SessionStart 等事件里注入提醒；只有带 nonblank `job_id` 且未过期的 canonical `watchdog` / legacy `wakeup` 才算健康并静默提醒。hook 不能凭空创建未来唤醒：不要把提醒当成 durable timer，它只能在 kimi-code 再次触发相关事件时发声。

**arm 命令：**

```bash
ccm watchdog arm \
  --fire-at 2026-06-25T14:00:00Z \
  --mechanism cron \
  --job-id cron-abc123 \
  --checklist "recon T7 后台 subagent 是否还活着"
```

**mechanism 降级链（按情境选）：**

| mechanism | 适用情境 | 降级到 |
|---|---|---|
| `cron` | cron / CI scheduler / systemd timer / GitHub Actions 等外部调度；先创建并拿 scheduler id / run URL | 下一项 |
| `loop` | 仅当当前 kimi-code 环境有已验证且已创建的 recurring automation；`job_id` 写 automation id | 下一项 |
| `monitor` | 可续查的外部状态 watcher；`job_id` 写 watcher / run id | 下一项 |
| `shell` | kimi-code Bash 后台任务 + 轮询任务输出；`job_id` 写真实 Bash 任务 id | 没有真实 handle 就不要 arm，改记 blocked / recon 状态 |

kimi-code 没有 CronCreate / ScheduleWakeup。你可以启动 background Bash 后台任务做 until 轮询，但必须把 Bash 任务 id、日志、取消命令和检查项写进 board，且不要依赖它向当前 kimi-code thread 自动回注 Claude 式 task-notification。

**watchdog 字段含义速查（legacy board 的同形字段名为 `wakeup`）：**

| 字段 | 含义 |
|---|---|
| `armed_at` | arm 时刻（ISO-8601 UTC） |
| `fire_at` | watchdog 预定触发时刻（ISO-8601 UTC·严格定宽） |
| `mechanism` | 使用的唤醒机制（cron/loop/monitor/shell） |
| `job_id` | **必填 nonblank string**；真实 wakeup handle：后台 Bash id、外部 scheduler job id；用于追踪、disarm / recon，不能省略或填空白。不要伪造 CronCreate / ScheduleWakeup job id。。没有真实 handle 就不要 arm |
| `checklist` | 被唤醒后逐一检查的事项清单 |

**退役 watchdog 必须两件一起做：**

```bash
# 1. 取消外部调度任务（如果用了 cron）
取消 watchdog 时，同时取消真实机制：删 cron / 停 CI schedule / 停 systemd timer / 停 后台 Bash 任务（按 Bash 任务 id）。只改 board 不停真实机制，会留下重复唤醒和误报。

# 2. 从 board 删除 canonical watchdog + legacy wakeup 整字段
ccm watchdog disarm
```

kimi-code 下尤其要防“纸面 disarm”：如果 watchdog 记录的是外部 scheduler 或 后台 Bash 任务，`ccm watchdog disarm` 只更新 board，不保证外部机制已停。每次 disarm 都要同步处理真实 scheduler / shell，并在 log 里写清结果。

**存量不健康记录的 self-heal：** `ccm watchdog status --json` 会把缺失 / 空白 `job_id` 与过期
`fire_at` 都报告为 `health.armed:false`，并给出 `code` / `action`；先 `disarm`，再创建真实机制、拿到
handle，最后重新 arm。legacy 缺 handle 只触发 `FMT-WATCHDOG` warn，不会卡死其它合法写入。

**过期 wakeup 的 self-heal：** 如果 board 有 `wakeup` 但 `fire_at` 已过期（比现在早），kimi-code Stop hook / recon 会把它当「未 armed」处理，重新提醒你选择真实可用的 wakeup handle。这是对「arm 后忘了退役」的自愈机制。

---

## L. references、artifact、verified 语义

### references（任务引用）

`references` 把外部文档 / spec / issue 等链接到 task 上，让执行者不需要找人问「spec 在哪」。

```bash
ccm task add T3 \
  --ref spec:/abs/path/to/spec.md \
  --ref plan:/abs/path/to/plan.md \
  --ref web:https://example.com/api-docs
```

**ref 的 `kind` 枚举（开放，未知值 warn 不 fail）：**

| kind | 含义 |
|---|---|
| `spec` | 规格说明文档 |
| `plan` | 实现计划 / 工程设计文档 |
| `doc` | 通用文档 |
| `web` | 外部 URL |
| `code` | 代码文件路径 |
| `issue` | 外部 issue / ticket（executor=external 时必须有） |
| `other` | 其他 |

`kind=issue` 的 URL 是 tracking anchor。它让 orchestrator 能回到同一个 GitHub issue / ticket 看外部进度、评论、链接出的 PR；它本身不是 artifact，也不是 done 证据。

**lint 强制（BIZ-DEV-REFS·hard）：** `type=development` 的 task 必须有 `kind=spec`≥1 且 `kind=plan`≥1。缺失会**拒绝落盘**（`exit 3`，`--force` 可越）——执行者不该拿到一个没有 spec/plan 链接的 development task 就蒙着头开始做，而不是基于设计文档。修法：`ccm task update <id> --add-ref spec:/abs/spec.md --add-ref plan:/abs/plan.md`。

**ref 的格式约束（FMT-REF·hard error）：** `ref` 值必须是绝对路径（`/abs/path`）或 URL（`http(s)://...`）。**禁止相对路径**（如 `./docs/spec.md`），因为 board 会跟随编排 home 移动，相对路径解析基准会漂移。

### artifact（产物链接）

`artifact` 是 task 完成后的产出链接。

```bash
# done 时顺手带上
ccm task done T3 --artifact /abs/path/to/output.ts --verified

# 或分开设
ccm task update T3 --artifact /abs/path/to/output.ts
```

**「done 真语义」三要素（BIZ-DONE-VERIFIED·hard）：** `status=done` ∧ `verified=true` ∧ `artifact` 非空。这是完整意义上的「真的做完并验了」。缺 `--verified` 或缺非空 `--artifact` 时,`ccm task done` 会在写入关卡被拒绝落盘(exit 3);若还没端点验收或没有产物,先别标 `done`,用 `uncertain` / `in_flight` / `stale` 等真实状态。

**external artifact 额外边界（BIZ-EXTERNAL-ARTIFACT·warn）：** 对 `executor=external` 的 task，`artifact` 应是外部实际产出（PR / commit / release / report / CI run 等）。如果 `artifact` 只是同一个 `kind=issue` URL，lint 会 warn：issue link 是 tracking anchor；issue closed 不等于 board done。

### verified（端点验收布尔）

`verified` **不是 status enum 的一个值**——它是与 `status` 正交的独立布尔标记。

```
status = "done"   ← 状态机里的终态
verified = true   ← 端点验收通过
```

两者正交：一个 task 可以 `status=done`（结束了）但 `verified=false`（没有端点验收过）。

重跑时 `task retry` 会把旧 `verified`（包括 `true`）归档后将当前值设为真正的布尔 `false`；不要用 `task update --set verified=false`，通用 `--set` 的值是字符串，且它不能替代完整的 attempt reset。

**什么时候设 verified：**
- sub-agent 跑完、你作为 orchestrator 做了独立的端点验收（不信 leaf 的自报）之后
- `run-tests.sh` 全绿 + `plugin validate` 过了之后
- 不要在没有独立验收的情况下设 verified（等于伪造审计轨迹）

---

## M. 决策树 / 反模式深化

### footgun 深化（比 SKILL.md 更详细的操作原因分析）

**footgun 1：`--set status=done` 想绕状态机**

```bash
# ❌ 错误（exit 3：裸 path 在 task verb 语境 scope 到本 task，status 是 🔒 字段被守门拒）
ccm task update T3 --set status=done

# 历史注：旧版 ccm 裸 path 落 board 顶层——这条命令曾 exit 0 却写出一个顶层 junk 字段、
# 任务 status 纹丝不动。现在裸 path 作用于本 task，🔒 守门当场拒，不再有静默错落点。

# ✅ 正确
ccm task done T3 --artifact /abs/output.md --verified
```

**footgun 2：`ready → done` 非法（必须先 in_flight）**

根因：ccm 状态机强制「起跑后才能完成」——完成没有 `started_at` 的任务等于在 board 里声称一件事完成了、却没有「什么时候开始做」的记录，是审计轨迹的谎言。

```bash
# ❌ 错误（exit 3: ready → done 非法;即便已 in_flight,缺 --verified/--artifact 也会被 BIZ-DONE-VERIFIED 拒绝）
ccm task done T3

# ✅ 正确（两步）
ccm task start T3          # ready → in_flight，盖 started_at
ccm task done T3 --verified --artifact /abs/output.md   # in_flight → done，盖 finished_at，带 true-done 证据
```

**footgun 2b：用 generic verb / `--force` 修 native-active projection**

```bash
# ❌ 都会被 mutation boundary 拒绝；--force 不是 native 专属状态机的逃生口
ccm task start T3 --force
ccm task update T3 --handle guessed-child
ccm task route-bind T3 --selection @selection.json --attempt @attempt.json --force

# ✅ 只让 dedicated writer 消费 ccm 私有认证 evidence
ccm task native-attempt-bind T3 --attempt-id attempt-1 --evidence-record-ref evidence:bind-1

# terminal 只到 uncertain；父层独立验收后才走普通 true-done
ccm task done T3 --verified --artifact /abs/output.md
```

**footgun 3：重跑只改 status，沿用旧完成证据**

```bash
# ❌ 错误：字段 setter 不能原子清时间、artifact、verified、review_verdict，也可能把 false 写成字符串
ccm task update T3 --set verified=false

# ✅ 正确：旧证据进 append-only log，当前 attempt 从干净的 ready 开始
ccm task set-status T3 stale
ccm task retry T3
ccm task start T3
```

**footgun 4：给 parent 节点加真实的子级 deps**

```bash
# ❌ 反模式：PHASE1 依赖 T_prev（另一个 owner 的子节点）
ccm task update PHASE1 --add-dep T_prev

# 语义问题：等于说「整个 PHASE1 的全部子任务都在等 T_prev」
# 实际意图几乎总是：只有 PHASE1 里的某一个子节点在等 T_prev

# ✅ 正确：把依赖连在叶节点上
ccm task update T1 --add-dep T_prev    # 只有需要 T_prev 的那个子 task 等它
```

**footgun 4：`board update --set goal=…` 想经通用逃生口改 🔒 字段**

```bash
# ❌ 错误（exit 3：goal 是 board 顶层 🔒 字段，--set 被守门拒）
ccm board update --set goal="新目标"

# ✅ Goal Contract board：走 revisioned 专属生命周期
ccm goal amend --summary "新目标" --reason "用户改变范围" --assurance asserted

# ✅ 仅没有 goal_contract 的 legacy board 可走旧具名 flag
ccm board update --goal "legacy 新目标"

# board update 的 --set/--set-json 是板级顶层 ✎ 字段的正门（裸 path 落 board 顶层）：
ccm board update --set notes="收尾备注"
```

**footgun 5：退役 watchdog 只做一件**

```bash
# ❌ 只 disarm，外部 cron 没取消
ccm watchdog disarm    # board 的 watchdog / legacy wakeup 字段删了，但 cron 还在跑

# ❌ 只 CronDelete，board 没清
# （board 里仍有 nonblank handle + future fire_at，读侧无法知道外部机制已消失，仍会认为 healthy）

# ✅ 两件一起做
# 1. CronDelete <job_id>（在工具层）
# 2. ccm watchdog disarm（board 端）
```

**footgun 6：`task show <id>` 返回 data:null 不报错（exit 0）**

```bash
# ❌ 容易踩：id 不存在时 exit 0，data 是 null
ccm task show T_nonexistent --json
# → {"ok": true, "data": null}   exit 0

# ✅ 调用方自己判 data 是否为 null
RESULT=$(ccm task show T99 --json)
if echo "$RESULT" | grep -q '"data":null'; then
  echo "T99 不存在"
fi
```

**footgun 7：ISO 时间字段非严格 UTC**

```bash
# ❌ 本地时区（lint FMT-TIME warn，viewer 跨天算时长会错）
--deadline "2026-06-25T18:00:00+08:00"

# ❌ 带毫秒（格式不匹配 YYYY-MM-DDTHH:MM:SSZ）
--fire-at "2026-06-25T18:00:00.000Z"

# ✅ 严格 UTC 定宽
--deadline "2026-06-25T10:00:00Z"  # UTC 时间（原 +08:00 减 8 小时）
```

### 多 active board 消歧

当 home 里有多个 active board 时，不带限定词的命令会报 `Ambiguous`：

```bash
# ❌ 报错：多个 active board
ccm board show

# ✅ 按 goal 子串消歧
ccm board show --goal "i18n"

# ✅ 或直接指定文件路径
ccm board show --board /abs/path/to/20260625T120000Z-12345.board.json
```

---

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
| `FMT-DEADLINE` | hard | 存在的 `goal_contract.deadline` 形状非法：`state` 不在 `{pending,asserted,confirmed,none}`；`asserted`/`confirmed` 缺 `at` 或 `at` 非严格 ISO-8601 UTC；`none` 带 `at`；`precision` 非 `{minute,day}`；`kind` 非 `hard`（v1）；`rev` 非整数≥1；`provenance.source` 非枚举 | 只用 `ccm goal deadline set/confirm/confirm-none/amend` 写（见 [I 小节](#o-交付-ddl-字段取值--四态状态机)）；`deadline.updated_at` 形状坏只 warn（`FMT-TIME`·不拦写盘） |
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
| `FMT-POLICY` | warn | 历史 `policy` 非对象，或值不在 `{allow, deny}` | 只作兼容诊断；kimi-code no-switch 不因 stored `allow` 改变 |
| `FMT-COORD` | warn | `coordination` 非对象，或 `priority` 不在 `{urgent,high,normal,low,trivial}` 枚举，或 `state`/`state.current`/`state.planned` 非对象、数字字段（`active_tasks`/`burn_contribution`/`cost_to_complete_pct`）非数字、人类可读字段（`workload`/`remaining_work`）非字符串 | 全 optional·缺即降级（`ccm peers` 把该维度退 null）；priority 仅五挡——非法值退化为 normal。永不 hard（advisory ✎·fail-safe）——见 [A 节](#a-task-字段速查) coordination 块 |
| `FMT-INBOX` | warn | `coordination.inbox` 存在但非数组，或通知条目 id 非空唯一 / kind / status / strength / ISO 时间 / consumed_at 状态对应关系不合法 | 缺失 = 空 inbox；append 用 `ccm coordination notify`，消费用 `ccm coordination inbox ack <id...>`，不要手拼。`kind` 闭集、`status` 单调；坏形态只 warn，读取侧跳过坏条目 |
| `FMT-RUNTIME` | warn | `runtime` 非对象，或已知键类型不合法（时间锚 `last_identity_remind` / `last_critpath_remind` / `last_goal_remind` / `last_account_switch` / `stop_allow_until` / `last_deadline_risk_check` 须严格 ISO-8601 UTC；`last_deadline_risk_fingerprint` 须非空字符串） | hook-owned ✎ 参数区：用 `ccm board set-param <白名单 key> <value>` 写（白名单 + 按 key 声明类型校验在 verb 层·时间锚要 ISO / 指纹要非空字符串）；缺/坏一律 graceful-degrade（周期 hook 退化为「从未提示」·首次必提示；Stop 释放闸退化为继续阻止停止）。未知键 silent-on-unknown。永不 hard |
| `FMT-AGENTS` | warn | `agents` 存在但非数组；或条目非对象、`id` 不合 ID 文法 / 重复、`type`/`harness`/`handle.kind`/`lifecycle.state`/`probe.observed`/`probe.method` 不在各枚举、`intent`/`model`/`handle.value` 非字符串、`launch`/`handle`/`lifecycle`/`probe` 非对象、时间锚非严格 ISO-8601 UTC、`links` 非数组或条目缺非空 `task_id`、`account_ref`/`quota_pool_ref` 既非 null 也非字符串 | 只用 `ccm agent create/bind/link/terminal/probe` 写（自动生成合法 id、盖标准时间戳、校验枚举与转移），别 `--set-json` 手拼。graceful：坏形状不拦写盘，但 `ccm agent list/show` 与 viewer 花名册读不出坏条目——见 [C.6 节](#c6-agents运行时-agent-登记簿) |
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
| `BIZ-DEADLINE-OVERDUE` | warn | `state:asserted|confirmed` 的交付 DDL 已过期（`now>=at`）而全局 acceptance 未完成（板未归档且存在未 trulyDone 任务） | 别静默降验收/伪造完成——先向用户报告状态/剩余交付物/方案，再由用户裁决延期（`ccm goal deadline amend --user-authorized`）/缩范围（`ccm goal amend`）/分阶段/终止 |
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

## O. 交付 DDL 字段取值 + 四态状态机

交付 DDL（delivery deadline）落 `goal_contract.deadline`——「整块 board / 当前 Goal Contract revision 最终交付」的时间承诺，单一 SSOT，随 goal revision 走。它是 👁 观察字段（嵌在已是 👁 的 `goal_contract` 内），窄腰一字不动。只走专属 verb 写：`ccm goal deadline set / confirm / confirm-none / amend`（命令签名见 [command-catalog goal deadline](command-catalog.md#goal-deadline)）；泛型 `--set goal_contract.*` 被拒。

**与三个近邻概念严格区分**（别混）：

| 概念 | 是什么 | 落点 |
|---|---|---|
| **交付 DDL（本字段）** | 整块交付的时间承诺 / 约束 | `goal_contract.deadline` |
| `cadence.iterations[].deadline` | 单个 iteration 的局部 timebox 末端 | `cadence.iterations[i].deadline`（并存·语义正交·DDL 不替代它） |
| ETA | 基于当前 DAG / 吞吐算出的**预测** | `ccm estimate forecast` 的 `p50/p80/p95`（每次算·非承诺） |
| task timeout / watchdog | worker 硬超时 / 自我唤醒 | `watchdog.*`（DDL 不替代任何超时机制） |

**四态 settledness 状态机**（`deadline.state`·与 goal `assurance` 正交）：

| `state` | 含义 | `at` | dispatch 门控 |
|---|---|---|---|
| **（`deadline` 键缺失）** | **未询问**（fresh skeleton 默认） | 无 | 门控（= pending 语义） |
| `pending` | 已识别候选但未 settle（歧义 / 冲突 / 待用户答） | 可无 / 可有暂定候选 | **门控**（不 settle 不派发） |
| `asserted` | 无歧义 evidence / 显式 `--ddl` 转写的候选（可逆推进） | 有 | 放行 |
| `confirmed` | 用户明确确认的截止期（`--user-authorized`） | 有 | 放行 |
| `none` | 用户明确确认**无 DDL** | 无 | 放行（不再追问） |

- **`none` ≠ 键缺失 / `pending`**：`none` 是显式持久状态（用户确认无 DDL）——`goal check` 见它即 `ok`，不再 `deadline_pending`、不再追问。「未询问」（键缺失）与「仍歧义」（pending）才门控派发。
- **`asserted` 语义收紧**：`asserted` 只可来自**显式 `--ddl`**，或**用户输入文本里的无歧义绝对时刻**（如「2026-08-01 09:00 UTC 前交付」）。推断 / 相对表达（「周五前」「尽快」「本月底」）/ 多源冲突一律用 `pending`——识别到候选但未 settle，先向用户确认再升 `asserted`/`confirmed`。别把模糊输入当 `asserted` 蒙混过门。

**字段取值**：

- **`at`**：严格 ISO-8601 UTC（`YYYY-MM-DDTHH:MM:SSZ`）。用户给本地时刻由 **agent 换算成 UTC** 后经 `--at` 传入；ccm 不做时区换算 / 自然语言解析（语义归 agent）。原始表达传 `--provenance-raw`、假定时区传 `--tz-input`（审计留痕）。
- **`precision`**：`minute`（默认·精确到秒的挂钟时刻）或 `day`（只给日期）。`--precision day` 落当日 UTC **末刻 `23:59:59Z`**（「当日交付」而非「当日 00:00」），且**必须带 `--tz-input`**（date-only 无时区证据不可落板）。
- **`kind`**：v1 恒 `hard`（字段预留 `soft`·行为差异作 follow-up；`FMT-DEADLINE` 拒绝非 `hard`）。
- **`rev`**：单调递增修订号，每次 `set/confirm/confirm-none/amend` +1，与 `board.log` decision 条目（revision / reason / timestamp）配套构成审计。
- **`provenance`**：`{raw?, source?, tz_input?}`——原始表达 / 来源（`goal-evidence|cli-flag|user-reply`）/ 假定时区，供审计，不参与任何计算。

**授权与审计**：`confirm` / `confirm-none` / `amend` 强制 `--user-authorized`（agent 绝不自授权）；`amend` 额外强制 `--reason`。deadline 的任何写**绝不 bump `goal_contract.revision`**（延长/改期不是目标 scope 变更），只刷 `deadline.updated_at` + `goal_contract.updated_at` + `rev`+1 + append `board.log`。`ccm goal amend`（目标 scope 变更）**原样保留** deadline 子对象——scope 改了 ≠ deadline 改了，不静默丢弃。

**会撞的规则**：形状坏 → `FMT-DEADLINE` hard（exit 3）；未 settle 却已有可执行任务 → `BIZ-DEADLINE-PENDING` warn；`asserted`/`confirmed` 已过期而全局 acceptance 未完成 → `BIZ-DEADLINE-OVERDUE` warn（都在 [N 节](#n-校验规则全集速查fmt--graph--biz)）。legacy board（无 `goal_contract` / 无 `deadline` 键）三规则皆早返回、板仍合法。

> **schema 版本说明：** 当前引擎期望 `schema === "cc-master/v2"`。如果你看到的 board 或别处文档写 `cc-master/v1`（旧板 / 旧叙事），以 `ccm board --help` / 引擎 board-model 为准——schema 锚点是机器读的窄腰字段，别手改。

---

> **实时真相永远以 `ccm <namespace> <cmd> --help` 为准**——本文是操作地图，`--help` 是当前领土。全量命令签名 / flag / `--json` 输出形状在 [command-catalog.md](command-catalog.md)。校验规则的权威实现在 ccm 引擎（board-model 注册表给每条规则的 level）。
