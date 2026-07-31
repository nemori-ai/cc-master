---
point: ccm.board.task-fields
---

## 权威陈述

<!-- ccm:k:start point:ccm.board.task-fields -->
## A. task 字段速查

### 🔒 load-bearing 字段

**这些字段走专属命令，`--set` 被拒（exit 3）。**

| 字段 | 类型 | 专属命令 | 含义一句话 |
|---|---|---|---|
| `id` | string（唯一非空） | `task add <id>` | DAG 节点标识符，被 deps/parent 引用 |
| `status` | enum（8 个值） | `task start / done / retry / block / set-status` | 状态机当前态，只能经 verb 转移 |
| `deps` | string[] | `task add --deps` / `task update --add-dep / --rm-dep` | 上游 dep 列表，驱动 readySet 计算 |
| `parent` | string?（可缺） | `task add --parent` / `task update --parent` | 归属 owner 节点的容器边（嵌套深度=1） |

**为什么 id/status/deps/parent 是 🔒？** 这四个字段被 hook、图算法、readySet、lint 机器读取。手改绕过写关卡，会造成悬挂引用、环、lint 拦不住的非法态转移——后果是 board 说谎，所有下游消费者（viewer / resume / hook）沿着错误输入跑。**这正是为什么 board 变更根本不给手改的路**：{{USING_CCM_BOARD_GUARD_GUIDANCE}}

> `--set tasks[T1].status=done` 和裸 `--set status=done`（task verb 语境）都会被 🔒 守门拒（exit 3）。status 永远走 verb。

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
| `observability` | {{USING_CCM_OBSERVABILITY_SOURCE}} | 可选遥测；缺失优雅降级，不影响派发逻辑 |
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
| `watchdog` | board 顶层 | `ccm watchdog arm / disarm` | {{USING_CCM_WATCHDOG_HOOK_REMINDER}} |
| `task.wip_limit` | task 级 | `ccm task add/update --wip-limit N` | 覆写 owner_wip_limit（per-owner cap） |

**board 级 ✎ 字段（走专属 noun、不经 `--set`）：**

- `baseline`——EVM 计划基线（plan 基线 SSOT），用 `ccm baseline snapshot / show / reset` 维护；缺→无 EVM baseline，形状坏→`FMT-BASELINE` warn。命令详见 command-catalog 的 baseline namespace、规则见下方 [N 节](#n-校验规则全集速查fmt--graph--biz) `FMT-BASELINE`。
- `meta.contracts.task_planning` + `meta.contracts.agent_routing`——routing contract 的成对 activation marker，只用 `ccm board enable-contract` 写；两者都缺表示 legacy，成对精确启用才是 enabled，部分写入 / 版本不匹配 / activation 元数据坏会触发 `FMT-CONTRACTS` hard。`--preflight` 只读列 gap；启用时精确 grandfather 已 terminal 的历史 subagent attempt，terminal 后 retry 会失去豁免。不要用 `board update --set-json meta...` 绕 dedicated writer。
{{USING_CCM_BOARD_POLICY_GUIDANCE}}
- `delivery_contract`——declared-mode v1 的 target 声明与冻结 snapshot。用 `ccm target set/show/refresh` 维护；缺失的历史 board 逐字保持现有 dependency/ready/reconcile 行为。当前唯一可持久化 mode 是 `declared`；`strict` 只存在于只读 `--strict-dry-run` preview，不能写板。Git target 只用本地 objects，artifact target 绑定 immutable manifest digest；branch/worktree 只定位 repository，不是交付证据。
- `coordination`——多 orchestrator 协调**感知**块，让 M 个并行 orchestrator 互相看见、各自独立配速（**hook 不读**·跨板只读读侧是 `ccm peers`）。可扩展对象，字段全 optional：
  - `priority` ∈ `{'urgent','high','normal','low','trivial'}`（**板级**优先级·非板内任务排序·缺/坏 → 解析为 `normal`）——这是跨板协调的裁决主轴 + 机械 fair-share 权重源（用户声明的协调 hint·不喂引擎的板内任务调度）。**专属 flag：`ccm board update --priority <urgent|high|normal|low|trivial>`**（枚举校验在 update 端·非法值 → `exit 2`；init 时用户给的板级优先级经它落盘）。
  - `state.current`（此刻在烧什么·喂即时 fair-share）：`active_tasks`（int·数字）/ `workload`（string·人类可读）/ `burn_contribution`（number·对聚合配额% burn 的估计贡献）。
  - `state.planned`（还剩多少活·喂价值/紧迫推理）：`remaining_work`（string·人类可读）/ `cost_to_complete_pct`（number·偿付力）。
  - `inbox`（入站中介建议收件箱）：通知数组，缺失 = 空。每条通知有 `id` / `kind` / `status` / `created_at` / `expires_at` / `strength` / `summary` / `payload` / `consumed_at` / `consumed_note`；`kind` 闭集为 `pacing_throttle`、`pacing_yield`、`pacing_claim`、`pacing_switch`、`pacing_stop`、`hitl_turn`、`artifact_serialize`、`quota_state_change`、`deadline_risk`（交付 DDL 风险 durable 审计条目·deadline-risk hook 直接注入 advisory 后立即 self-ack 一条）；`status` 是 `unconsumed → consumed|expired`。你用 `ccm coordination inbox list --unconsumed` 读取，消费后用 `ccm coordination inbox ack <id...> --note ...` 标记 consumed；低层 producer 用 `ccm coordination notify` append。每次 ccm 写盘前自动跑 `reconcileInbox`：过期未消费转 expired、同 kind 只保留最新 unconsumed、终态按 TTL/capacity GC。形状坏→`FMT-INBOX` warn（永不 hard）。

  数字字段喂机械 floor、人类可读字段喂 agentic 价值推理；**缺即降级**（`ccm peers` 把该 peer 的对应维度退 null·配速退单板·fail-safe）。形状坏→`FMT-COORD` warn（永不 hard·advisory ✎）。读侧详见 command-catalog 的 peers namespace、规则见下方 [N 节](#n-校验规则全集速查fmt--graph--biz) `FMT-COORD`。**token-blind**：本块只含 goal/priority/workload/%——绝无任何 secret。
- `owner.harness`——当前 board 所属 harness 的观察字段，取值 `claude-code | codex | cursor | kimi-code | unknown`。它**不是武装闸**：hook arming 仍只看 `owner.active` + `owner.session_id`；`owner.harness` 只给 `ccm peers` / 后续池中介做配额池分区。ARM 时 bootstrap 通过 `ccm board stamp-harness` 从当前进程 env 的可信 harness detect 盖写；无可信 env 时不写、不覆盖已有值。缺失或坏值都按 `unknown` 降级；`ccm peers` 会把 unknown board 放进单例池，避免跨 harness 或不明来源 board 混排。坏值→`FMT-HARNESS` warn。
- `agents`——**运行时 agent 登记簿**（✎ 非窄腰·hook 不读），跨所有派发类型的统一花名册：凡派发（sub-agent / 后台 shell / workflow / 跨 harness worker）皆登记。手工登记只用 `ccm agent create / bind / link / terminal / probe` 写、`ccm agent list / show` 读、`ccm agent amend / rm` 事后修正；跨 harness 同步 tracked transport 可用 `ccm worker dispatch` 经专用 repository 原子写该 agent 自己的 `dispatch/handle/lifecycle/links`。两条路径都别用 `--set-json` 手拼（会绕过状态机校验、handle 证据闸与幂等 link）。缺 → 无登记（花名册空）；形状坏 → `FMT-AGENTS` warn；`in_flight` task 无登记指向 → `BIZ-INFLIGHT-AGENT` warn 软提示。概念与字段取值见 [C.6 节](#c6-agents运行时-agent-登记簿)。
- `runtime`——**hook-owned 运行时参数区**（✎ 非窄腰），装「周期 hook/script 跑起来后维护的瞬态簿记」。白名单键（多数是 ISO-8601 UTC 时间戳·一个是任意非空字符串指纹）：`last_identity_remind`（周期身份提示 hook 读它判阈值·ISO）、`last_critpath_remind`（周期临界路径提示 hook 读它判阈值·ISO）、`last_goal_remind`（Goal Contract 对齐提示判阈值·ISO）、`last_account_switch`（账号切换机制写换号时刻·usage-pacing hook 读它做「检测到换号」ambient·ISO）、`stop_allow_until`（Codex Stop hook 释放闸：agent 独立确认本板可停后写一个短期未来时刻·ISO）、`last_deadline_risk_check`（交付 DDL 风险 hook 上次重估时刻·判周期重估阈值·ISO）、`last_deadline_risk_fingerprint`（交付 DDL 风险 hook 上次 risk-input 指纹·非空字符串·判 verdict/driver/bucket 是否变化以去重节流·**不是时间戳**）——周期 hook / 换号写侧注入 / Stop 释放确认后经 `ccm board set-param` 写回（带锁·进程边界）。**写法收窄**：唯一写口是 `ccm board set-param <白名单 key> <value>`（least-privilege·非白名单 key / 非法值 / 字符串键传空值 → `exit 2`）——agent 走 `ccm` 命令改 board 天然保留它（`ccm` 字段级合并、不整盘覆写；agent 自己**永不手写 `runtime.*`**）。缺/坏 → graceful-degrade（周期提示退化为「从未提示」；Stop 释放闸退化为继续阻止停止）；形状坏→`FMT-RUNTIME` warn（永不 hard）。**token-blind**：参数区只有时间戳等簿记·绝无 secret。

> **不要把 observed 字段写进硬 waist。** 这三档的边界由 `ccm` 引擎权威定义（每字段的 tier 元数据）。

---
<!-- ccm:k:end point:ccm.board.task-fields -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删了这条，agent 不知道哪些字段走 --set 会被拒 exit 3（load-bearing）、哪些 read-only、哪些 flexible 可写，试错成本高。

主体是 task 三档字段（锁定/灵活/观察）各自的名字、写口与缺失行为，纯本项目接口速查。
