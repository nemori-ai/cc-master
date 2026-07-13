# board-model-guide —— board 模型操作指南

> **面向操作者的派生视图。** board 协议的**权威定义**（enums / 字段三档元数据 / 不变式注册表 / 状态机）在 `ccm` 引擎里——实时真相用 `ccm <namespace> --help` 取。**本文只给操作侧：概念是什么、字段什么时候设什么值、场景怎么选。绝不复述权威定义。**

---

## 目录（TOC）

- [A. task 字段速查](#a-task-字段速查)
  - [🔒 load-bearing 字段（走专属命令，不用 --set）](#-load-bearing-字段)
  - [✎ flexible 字段（--set 改，task verb 裸 path 即本 task）](#-flexible-字段)
  - [👁 observed 字段（hook 若有则用，走具名 flag）](#-observed-字段)
- [B. status 八态语义 + 生命周期](#b-status-八态语义--生命周期)
  - [各态语义速查](#各态语义速查)
  - [status 何时转向哪态（决策指导）](#status-何时转向哪态)
  - [uncertain vs blocked_on（辨析）](#uncertain-vs-blocked_on-辨析)
- [C. executor 五种语义 + 选择决策树](#c-executor-五种语义--选择决策树)
  - [各 executor 语义](#各-executor-语义)
  - [executor 选择决策树](#executor-选择决策树)
- [D. acceptance 怎么写好](#d-acceptance-怎么写好)
- [E. estimate 怎么估](#e-estimate-怎么估)
- [F. deps 怎么连](#f-deps-怎么连)
- [G. blocked_on 怎么选](#g-blocked_on-怎么选)
- [H. judgment_call（jc）：何时建、severity 怎么定](#h-judgment_calljc何时建severity-怎么定)
- [I. cadence 与 iteration：节奏怎么定](#i-cadence-与-iteration节奏怎么定)
- [J. parent / owner 嵌套语义](#j-parent--owner-嵌套语义)
- [K. watchdog：何时 arm、wakeup 字段含义](#k-watchdog何时-armwakeup-字段含义)
- [L. references、artifact、verified 语义](#l-referencesartifactverified-语义)
- [M. 决策树 / 反模式深化](#m-决策树--反模式深化)
- [N. 校验规则全集速查（FMT / GRAPH / BIZ）](#n-校验规则全集速查fmt--graph--biz)
  - [FMT 家族（格式 / 类型）](#fmt-家族格式--类型)
  - [GRAPH 家族（图完整性）](#graph-家族图完整性)
  - [BIZ 家族（条件业务规则）](#biz-家族条件业务规则)

---

## A. task 字段速查

### 🔒 load-bearing 字段

**这些字段走专属命令，`--set` 被拒（exit 3）。**

| 字段 | 类型 | 专属命令 | 含义一句话 |
|---|---|---|---|
| `id` | string（唯一非空） | `task add <id>` | DAG 节点标识符，被 deps/parent 引用 |
| `status` | enum（8 个值） | `task start / done / block / set-status` | 状态机当前态，只能经 verb 转移 |
| `deps` | string[] | `task add --deps` / `task update --add-dep / --rm-dep` | 上游 dep 列表，驱动 readySet 计算 |
| `parent` | string?（可缺） | `task add --parent` / `task update --parent` | 归属 owner 节点的容器边（嵌套深度=1） |

**为什么 id/status/deps/parent 是 🔒？** 这四个字段被 hook、图算法、readySet、lint 机器读取。手改绕过写关卡，会造成悬挂引用、环、lint 拦不住的非法态转移——后果是 board 说谎，所有下游消费者（viewer / resume / hook）沿着错误输入跑。**这正是为什么 board 变更根本不给手改的路**：直接 file-edit 目标 board（`Write`/`Edit`/`MultiEdit`，或 `Bash` 用 `sed`/`echo`/`tee`/`cat >` 手改）会被 PreToolUse hook **当场 deny**。手改绕过写关卡会静默腐蚀 deps 图 / 状态机 / 窄腰——机制层直接不给你这条路。

> `--set tasks[T1].status=done` 和裸 `--set status=done`（task verb 语境）都会被 🔒 守门拒（exit 3）。status 永远走 verb（锚 2·SKILL.md）。

### ✎ flexible 字段

**这些字段用 `--set`（`task add`/`task update <id>` 里裸 `--set field=value` 即作用于该 task；跨 task 用 `tasks[<id>].field` 前缀；板级顶层用 `board update --set`），或各自的具名 flag。写入后非 `--json` 输出回显实际落点（`set tasks[T1].field`）。**

| 字段 | 何时设 | 操作侧要点 |
|---|---|---|
| `title` | 建 task 时（推荐） | 一句话，让 viewer 卡片可读 |
| `description` | 需详细说明时 | 长文，viewer 详情栏展示 |
| `acceptance` | 开发类 task 必须，其余推荐 | 见 [D. acceptance 怎么写好](#d-acceptance-怎么写好) |
| `references` | 开发类 task 必须，其余推荐 | ref 只能绝对路径或 URL，禁相对（FMT-REF·exit 3） |
| `estimate` | 估点时 | 见 [E. estimate 怎么估](#e-estimate-怎么估) |
| `executor` | 派发前必须设 | 见 [C. executor 五种语义](#c-executor-五种语义--选择决策树) |
| `handle` | 真实派发后、任务进入 `in_flight` 前必须 | 记录派发工具返回的真实句柄，resume 靠它 recon；`ready` / `blocked` future task 不预填 |
| `artifact` | 产出落盘后（`task done` 时带 `--artifact`） | 绝对路径或 URL；done 真语义（verified+artifact）靠它 |
| `verified` | 端点验收通过后 | `task done --verified` 一步到位，或 `task update --verified` |
| `blocked_on` | `task block --on` 时自动设 | `"user"` 或某 task id；见 [G. blocked_on 怎么选](#g-blocked_on-怎么选) |
| `justification` | 需记录决策理由时 | 解释「为什么建这个 task / 用这个方法」 |
| `observability` | 后台任务完成时，从 task-notification 里抄 `<usage>` 块 | 可选遥测；缺失优雅降级，不影响派发逻辑 |
| `created_at` / `started_at` / `finished_at` | `task add` / `task start` / `task done` 时自动盖 | 严格 `YYYY-MM-DDTHH:MM:SSZ`；viewer timeline 靠它 |
| `hitl_rounds` | 每次 `blocked_on:user` 往返 + 1 | 量化人工介入成本；缺省 = 0 |
| `decision_package` | 建 `blocked_on:user` 节点时**必须**（BIZ-AWAITING hard error） | 见 [G. blocked_on 怎么选](#g-blocked_on-怎么选) 里的 awaiting-user 小节 |
| `role` | 标 fill-work 时 | `normal`（默认）或 `fill-work`（临界路径等待窗口的填充活） |
| `type` | 建 task 时 | 见下方 taskType 枚举说明 |
| `output_schema` | 需约束结构化产出时（低频） | workflow 节点的产出契约 |
| `dep_pins` | 钉依赖快照时（低频） | freshness / inputs_hash 用 |
| `model` | 派发 / 完成时记录该 task 用的模型档 | `ccm task update <id> --set model=<模型id>`（如 `claude-sonnet-4-5`，无具名 flag·裸 path 即本 task）；estimate 层按档分层校准读它，缺→无 tier 校准 |

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
| `watchdog` | board 顶层 | `ccm watchdog arm / disarm` | Stop hook 会在有 `in_flight` 任务却无 `wakeup` 时提醒你 arm。 |
| `task.wip_limit` | task 级 | `ccm task add/update --wip-limit N` | 覆写 owner_wip_limit（per-owner cap） |

**board 级 ✎ 字段（走专属 noun、不经 `--set`）：**

- `baseline`——EVM 计划基线（plan 基线 SSOT），用 `ccm baseline snapshot / show / reset` 维护；缺→无 EVM baseline，形状坏→`FMT-BASELINE` warn。命令详见 command-catalog 的 baseline namespace、规则见下方 [N 节](#n-校验规则全集速查fmt--graph--biz) `FMT-BASELINE`。
- `policy`——框定本块板 master-orchestrator 自主权限的**可扩展对象**，首条键 `autonomous_account_switch` ∈ `{'allow','deny'}`（门控是否允许 orchestrator 自主换号）；**缺省 = allow**（向后兼容旧板·读不到一律解析为 allow），形状坏→`FMT-POLICY` warn。用 `ccm policy show / set` 维护（`set` 写为用户所有、非 TTY 须 `--user-authorized`）；命令详见 command-catalog 的 policy namespace、规则见下方 [N 节](#n-校验规则全集速查fmt--graph--biz) `FMT-POLICY`。
- `coordination`——多 orchestrator 协调**感知**块，让 M 个并行 orchestrator 互相看见、各自独立配速（**hook 不读**·跨板只读读侧是 `ccm peers`）。可扩展对象，字段全 optional：
  - `priority` ∈ `{'urgent','high','normal','low','trivial'}`（**板级**优先级·非板内任务排序·缺/坏 → 解析为 `normal`）——这是跨板协调的裁决主轴 + 机械 fair-share 权重源（用户声明的协调 hint·不喂引擎的板内任务调度）。**专属 flag：`ccm board update --priority <urgent|high|normal|low|trivial>`**（枚举校验在 update 端·非法值 → `exit 2`；init 时用户给的板级优先级经它落盘）。
  - `state.current`（此刻在烧什么·喂即时 fair-share）：`active_tasks`（int·数字）/ `workload`（string·人类可读）/ `burn_contribution`（number·对聚合配额% burn 的估计贡献）。
  - `state.planned`（还剩多少活·喂价值/紧迫推理）：`remaining_work`（string·人类可读）/ `cost_to_complete_pct`（number·偿付力）。
  - `inbox`（入站中介建议收件箱）：通知数组，缺失 = 空。每条通知有 `id` / `kind` / `status` / `created_at` / `expires_at` / `strength` / `summary` / `payload` / `consumed_at` / `consumed_note`；`kind` 闭集为 `pacing_throttle`、`pacing_yield`、`pacing_claim`、`pacing_switch`、`pacing_stop`、`hitl_turn`、`artifact_serialize`；`status` 是 `unconsumed → consumed|expired`。你用 `ccm coordination inbox list --unconsumed` 读取，消费后用 `ccm coordination inbox ack <id...> --note ...` 标记 consumed；低层 producer 用 `ccm coordination notify` append。每次 ccm 写盘前自动跑 `reconcileInbox`：过期未消费转 expired、同 kind 只保留最新 unconsumed、终态按 TTL/capacity GC。形状坏→`FMT-INBOX` warn（永不 hard）。

  数字字段喂机械 floor、人类可读字段喂 agentic 价值推理；**缺即降级**（`ccm peers` 把该 peer 的对应维度退 null·配速退单板·fail-safe）。形状坏→`FMT-COORD` warn（永不 hard·advisory ✎）。读侧详见 command-catalog 的 peers namespace、规则见下方 [N 节](#n-校验规则全集速查fmt--graph--biz) `FMT-COORD`。**token-blind**：本块只含 goal/priority/workload/%——绝无任何 secret。
- `owner.harness`——当前 board 所属 harness 的观察字段，取值 `claude-code | codex | cursor | unknown`。它**不是武装闸**：hook arming 仍只看 `owner.active` + `owner.session_id`；`owner.harness` 只给 `ccm peers` / 后续池中介做配额池分区。ARM 时 bootstrap 通过 `ccm board stamp-harness` 从当前进程 env 的可信 harness detect 盖写；无可信 env 时不写、不覆盖已有值。缺失或坏值都按 `unknown` 降级；`ccm peers` 会把 unknown board 放进单例池，避免跨 harness 或不明来源 board 混排。坏值→`FMT-HARNESS` warn。
- `runtime`——**hook-owned 运行时参数区**（✎ 非窄腰），装「周期 hook/script 跑起来后维护的瞬态簿记」。白名单键（均 ISO-8601 UTC）：`last_identity_remind`（周期身份提示 hook 读它判阈值）、`last_critpath_remind`（周期临界路径提示 hook 读它判阈值）、`last_account_switch`（账号切换机制写换号时刻·usage-pacing hook 读它做「检测到换号」ambient）、`stop_allow_until`（Codex Stop hook 释放闸：agent 独立确认本板可停后写一个短期未来时刻）——周期 hook / 换号写侧注入 / Stop 释放确认后经 `ccm board set-param` 写回（带锁·进程边界）。**写法收窄**：唯一写口是 `ccm board set-param <白名单 key> <value>`（least-privilege·非白名单 key / 非法值 → `exit 2`）——agent 走 `ccm` 命令改 board 天然保留它（`ccm` 字段级合并、不整盘覆写；agent 自己**永不手写 `runtime.*`**·见 `master-orchestrator-guide` 的 board-写纪律）。缺/坏 → graceful-degrade（周期提示退化为「从未提示」；Stop 释放闸退化为继续阻止停止）；形状坏→`FMT-RUNTIME` warn（永不 hard）。**token-blind**：参数区只有时间戳等簿记·绝无 secret。

> **不要把 observed 字段写进硬 waist。** 这三档的边界由 `ccm` 引擎权威定义（每字段的 tier 元数据）。

---

## B. status 八态语义 + 生命周期

### 各态语义速查

| status | 含义 | 对 readySet 的影响 | 典型下一步 |
|---|---|---|---|
| `ready` | deps 全 done，可以派发 | **在 readySet 里** | `task start` → in_flight |
| `in_flight` | 已派发、正在跑 | 不在 readySet | 等完成 → `task done` / 失败处置 |
| `blocked` | **两种来源**（见下）：① deps 门控（deps 未全 done·**系统自动**·无 `blocked_on`）② 语义阻塞（在等 user 或另一 task·**手动**·有 `blocked_on`） | 不在 readySet | ① deps 门控：**别手动改**——deps 全 done 时任意 ccm 写命令自动归回 ready；② 语义阻塞：`task unblock <id>`（清 `blocked_on`·交回 deps 门控） |
| `done` | 完成 | 解锁其他节点的 deps | 无须再动，除非上游产物变 → `stale` |
| `escalated` | sub-agent 返回 escalation（超出能力范围） | 不在 readySet | 复盘后 supersede 节点，建新 task → escalated task 设 ready |
| `failed` | 节点失败 | 不在 readySet | 重试 → `ready`，或升级处置 → `escalated` |
| `stale` | 上游产物变了、需重跑 | 不在 readySet | 重确认输入后 → `ready` |
| `uncertain` | 做了但未验（验证节点尚未派出） | 不在 readySet | 验收通过 → `done`，失败 → `failed`，重做 → `in_flight` |

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

**`--force` 越闸是逃生口，不是捷径：** 正常流程用 verb，`--force` 留给真异常态（如复活 `stale` 节点做特殊处置）。用 `--force` 跳 `in_flight` 直接 `done` 会造成无 `started_at` 的 done 节点——伪造审计轨迹，影响 timeline 与 p95 估算。

### ready ↔ blocked 由系统按 deps 自动门控

**每次 ccm 写命令落盘前，引擎自动跑一趟 `reconcileGating` 归一化**——把每个「**无 `blocked_on`**（非语义阻塞）且 status ∈ {ready, blocked}」的 task 按 deps 完成度重定：**deps 全 done → `ready`，否则 → `blocked`**。这意味着：

- **你几乎不用手动在 ready/blocked 之间搬**——`task done` 掉某上游后，它下游那些「deps 现已全 done」的节点会在同一次（或下一次任意）写命令里自动翻成 `ready`；反之 `task add T --deps <未完成>` 建出的节点会被自动落成 `blocked`（哪怕 addTask 默认 status=ready）。
- **手动 `task set-status <id> ready` 会被 deps 否决**——若该 task deps 未全 done 且无 `blocked_on`，下一趟归一化会把它打回 `blocked`。想让一个 deps 未满足的节点强行可派发，是设计味道问题（该先切依赖），不是状态问题。
- **`blocked_on` 是「语义阻塞」判别器**：有 `blocked_on`（等 `user` / 等某 task）的节点**整体豁免**自动门控——即便 deps 全 done 也不会被翻成 ready（它在等的是人 / 另一件事，不是拓扑就绪）。解除语义阻塞用 **`task unblock <id>`**（清 `blocked_on`，交回 deps 门控按完成度定 ready/blocked），不要用 `set-status`。
- **手改 board 造出的不一致态**（ready 但 deps 未全 done / blocked 无 blocked_on 但 deps 全 done）由 `BIZ-STATUS-DEPS` warn 兜（见 [N 节](#n-校验规则全集速查fmt--graph--biz)）——CLI 写路径经归一化**永不产生**这类态，看到它多半是手编辑的板。

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
| `user` | 人类操作者 | 需要人工判断 / 操作 / 授权的任务 | — |
| `master-orchestrator` | 主线 orchestrator 自己 | 调度决策本身、replan、验收整合 | — |
| `subagent` | 后台 sub-agent（`run_in_background`） | 独立可并行的实现工作 | `in_flight` 时必须有真实 `handle`（后台句柄）；future task 不预填 |
| `workflow` | workflow 脚本（fan-out + join） | 跨多个 leaf 的并行 + 聚合 | `in_flight` 时必须有真实 `handle`；future task 不预填 |
| `external` | 外部第三方（CI / GitHub issue / PR review 系统） | 等外部开发者 / CI / review 系统推进 | references 含 `kind=issue`≥1；`handle` 可记录 issue URL/number；`artifact` 留给 PR / commit / report 等外部实际产出 |

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

这个任务需要多个 leaf 并行 + 聚合产物？
  ↓ 是 → executor: workflow  （真实派发后回填 workflow handle，再转 in_flight）
  ↓ 否

→ executor: subagent  （真实派发后回填后台 handle，再转 in_flight）
```

**executor 与 handle 的关系：** `executor` 是谁来执行的计划，因此 `ready` / `blocked` future task 可先选 `subagent` 或 `workflow`，**不要预填 placeholder / phantom handle**。真实调用派发工具后，立即把其返回的真实句柄写入 task（`task update --handle <句柄>`），再转 `in_flight`；只有 `status=in_flight` 且 `executor∈{subagent,workflow}` 时，缺 handle 才触发 `BIZ-EXECUTOR-HANDLE`，因为 resume 要靠它 recon 任务是否还活着。`external` 节点靠 `reference kind=issue` 的 URL 去外部系统查；`handle` 可选地记录 issue URL / issue number / 外部 run id，方便 recon。`user` 和 `master-orchestrator` 没有后台句柄。

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
- 真实派发后把 `executor: subagent` 任务标成 `in_flight`，却不带派发工具返回的真实 `handle`——会触发 `BIZ-EXECUTOR-HANDLE` warn，resume 时也找不到后台任务。反之，future `ready` / `blocked` 任务不应为了消 warning 预填 phantom handle。
- 把 orchestrator 自己的整合工作标 `subagent`——指挥不演奏（orchestrator 协调、不亲手做单元工作），orchestrator 的工作应标 `master-orchestrator`。

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

`deps` 是 task 的「依赖边」——只有当 deps 中的 task 全部 done 之后，这个 task 才进 readySet 可以派发。

**操作命令：**

```bash
# 建 task 时一起加
ccm task add T5 --deps T1,T3

# 建好之后增减
ccm task update T5 --add-dep T2
ccm task update T5 --rm-dep T3
```

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

**`blocked_on` 是「语义阻塞」判别器：** 有 `blocked_on` 的 blocked 节点是在等**人 / 另一件事**（语义阻塞），与「deps 拓扑就绪」正交——它**豁免** deps 驱动的自动门控（`reconcileGating`），即便 deps 全 done 也不会被自动翻成 ready。无 `blocked_on` 的 blocked 节点则是纯 **deps 门控**（系统据 deps 完成度自动定 ready/blocked，见 [B 节](#ready--blocked-由系统按-deps-自动门控)）。**解除语义阻塞用 `task unblock <id>`**（清 `blocked_on`，交回 deps 门控），别手 `set-status`。

**选择表：**

| 情况 | 选 blocked_on | 备注 |
|---|---|---|
| 需要用户拍板 / 提供输入 / 审批 | `"user"` | 必须带 `decision_package`（否则 BIZ-AWAITING hard error）；解除用 `task unblock` |
| 等某个先决任务，但它不是 deps 里的静态依赖 | `"<taskid>"` | 动态阻塞；taskid 必须存在（否则 FMT-BLOCKED-ON warn）；解除用 `task unblock` |
| deps 里的 task 还没 done | 不用 block | deps 门控本身就是阻塞——**系统自动**把它落成 `blocked`（无 `blocked_on`），deps 全 done 时自动归回 `ready`，无需手动 block/set-status |

**别把 awaiting-user 决策伪装成 judgment_call。** `blocked_on:"user"` + `decision_package` 表示「用户还没拍板、agent 不能替他决定」；`judgment_call` 表示「agent 已经做过一个重要自驱判断，等用户回来知情 / 复盘 / 追认」。merge / 发布 / 不可逆 / 对外 / 授权 / 方向性决定这类 must-escalate 边界，必须走 awaiting-user 决策节点，而不是先斩后奏记成 jc。

**awaiting-user 节点的 decision_package 必须提前备好：**

`blocked_on: "user"` 的节点是给用户的「采访包」——用户点开 `/cc-master:discuss` 时靠 `decision_package` 里的内容理解上下文、做决策。**没有包 = discuss 开不起来**，所以 lint 对这类节点做 `BIZ-AWAITING` hard 校验：

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

high / critical jc 在 Stop hook 回前台时会被显眼提示——用户不必主动去查，hook 会告知。

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

**`parent` vs `deps` 正交性（重要）：** 子节点可以 `parent` 指 owner-A，同时 `deps` 指 owner-B 的某个子——两条边各表各的。拓扑就绪（deps 全 done）和所属容器（parent 指向）是两件独立的事。

---

## K. watchdog：何时 arm、wakeup 字段含义

**watchdog 解决的问题：** 后台 sub-agent / workflow 有时会静默失败——没有错误返回、任务看起来还在 `in_flight`，但实际上已经卡死或消失。主线等待时没有任何信号。watchdog 是「如果过了这么久还没回来，就来唤醒我让我主动去 recon」的安全网。

**何时 arm watchdog：**

| 情况 | 要不要 arm |
|---|---|
| 派发 sub-agent 后进入空转等待 | **arm**，fire_at 设为 p95 估算时刻 |
| 等用户回复（`blocked_on:user`） | 视情况——等待时间可预期时可 arm；长期等用户可不 arm |
| 短时间内就能确认（几分钟）| **不用 arm**，直接等 |
| 无 `in_flight` 任务 | **不用 arm**，没有静默失败风险 |

Stop hook 会在有 `in_flight` 任务却无 `wakeup` 时提醒你 arm。

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
| `cron` | Claude Code 支持 `CronCreate`（本地内存调度，不需 OAuth） | 下一项 |
| `loop` | 支持 `ScheduleWakeup` | 下一项 |
| `monitor` | 支持 `Monitor` 工具 | 下一项 |
| `shell` | 万能底层（`background-shell until 轮询`） | 永远可用的 floor |

`shell` 是 universal floor——任何环境都能用，机制最简单：

```bash
# background-shell until 轮询示例
until ccm task show T7 --json | grep '"status":"done"'; do sleep 300; done
```

**wakeup 字段含义速查：**

| 字段 | 含义 |
|---|---|
| `armed_at` | arm 时刻（ISO-8601 UTC） |
| `fire_at` | watchdog 预定触发时刻（ISO-8601 UTC·严格定宽） |
| `mechanism` | 使用的唤醒机制（cron/loop/monitor/shell） |
| `job_id` | 外部调度句柄（CronCreate 返回的 id，用于 disarm 清理） |
| `checklist` | 被唤醒后逐一检查的事项清单 |

**退役 watchdog 必须两件一起做：**

```bash
# 1. 取消外部调度任务（如果用了 cron）
# （在 Claude Code 工具层 CronDelete <job_id>）

# 2. 从 board 删 wakeup 对象
ccm watchdog disarm
```

**只做一件是错的：** 只 CronDelete 不 disarm，hook 仍以为有 watchdog armed（不再提醒），但任务也不会再 fire；只 disarm 不 CronDelete，外部调度任务还在，到点唤醒但 board 已无 wakeup 对象，徒增噪声。

**过期 wakeup 的 self-heal：** 如果 board 有 `wakeup` 但 `fire_at` 已过期（比现在早），Stop hook 会把它当「未 armed」处理，重新提醒你 arm。这是对「arm 后忘了退役」的自愈机制。

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

**footgun 3：给 parent 节点加真实的子级 deps**

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

# ✅ 正确（🔒 走具名 flag）
ccm board update --goal "新目标"

# board update 的 --set/--set-json 是板级顶层 ✎ 字段的正门（裸 path 落 board 顶层）：
ccm board update --set notes="收尾备注"
```

**footgun 5：退役 watchdog 只做一件**

```bash
# ❌ 只 disarm，外部 cron 没取消
ccm watchdog disarm    # board 的 wakeup 删了，但 cron 还在跑

# ❌ 只 CronDelete，board 没清
# （board 里还有 wakeup，hook 以为 armed、不再提醒）

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
| `FMT-OWNER` | hard | `owner` 不是对象，或 `active` 非 bool，或 `session_id` 非字符串 | 别手改 owner——它是武装闸读的；session_id 空串 `""` 合法（待显式 re-arm 认领） |
| `FMT-HARNESS` | warn | `owner.harness` 存在但不在 `{claude-code,codex,cursor,unknown}` | 不手填；ARM 时由 `ccm board stamp-harness` 从可信 harness env 写入。缺失向后兼容为 `unknown`；坏值只 warn，`ccm peers` 按 unknown 单例池降级 |
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
| `FMT-MODEL` | warn | task `model` 存在却非字符串 | `ccm task update <id> --set model=<模型id>`（如 `claude-sonnet-4-5`·裸 path 即本 task）；非 string → estimate 层 tier 分层校准降级忽略 |
| `FMT-SCHEDULING` | warn | `scheduling.wip_limit` / `owner_wip_limit`（或旧板顶层 `wip_limit`）非数字 | `ccm board update --wip-limit N --owner-wip N`（整数）；非数字 → WIP 软警告静默关闭 |
| `FMT-WATCHDOG` | warn | `watchdog.mechanism` 不在枚举内，或 `armed_at`/`fire_at` 非严格 ISO-8601 UTC | `ccm watchdog arm --mechanism <cron/loop/monitor/shell> --fire-at YYYY-MM-DDTHH:MM:SSZ`——见 [K 节](#k-watchdog何时-armwakeup-字段含义) |
| `FMT-META` | warn | `meta.template_version` 非整数，或 `meta.created_at` 非 ISO-8601 UTC | meta 由 bootstrap 写，别手改；template_version 是整数 |
| `FMT-LOG` | warn | `log` 非数组，或条目缺 `ts`/`summary`、`ts` 非 ISO、`kind` 不在枚举内 | `ccm log add "<summary>" --kind <enum>`；ts 自动盖严格 UTC，summary 非空 |
| `FMT-JUDGMENT-CALLS` | warn | `judgment_calls` 非数组，或条目 `summary` 空、`category`/`severity`/`status` 不在各枚举内、时间戳非 ISO | 用 `ccm jc add/resolve` 而非手拼——见 [H 节](#h-judgment_calljc何时建severity-怎么定) |
| `FMT-CADENCE` | warn | `cadence` 非对象，或 iteration 的 `id` 空、`status` 不在 {open,shipped}、时间非 ISO、`members` 非字符串数组 | 用 `ccm cadence update/open/ship`；deadline 严格 UTC——见 [I 节](#i-cadence-与-iteration节奏怎么定) |
| `FMT-BASELINE` | warn | `baseline` 非对象，或 `captured_at`/`t0`/`history[].reset_at` 非严格 ISO-8601 UTC、`task_estimates`/`dag_snapshot` 非对象、`bac_h` 非数字、`history` 非数组 | 用 `ccm baseline snapshot/reset` 维护、别手拼；时间严格 UTC（estimate evm 读它，格式不对则 EVM 时间轴错位） |
| `FMT-POLICY` | warn | `policy` 非对象，或 `autonomous_account_switch` 不在 `{allow, deny}` 枚举内 | 用 `ccm policy set --autonomous-account-switch=allow\|deny`（缺省解析为 allow）；值仅这两个——非法值会让 switch-account.sh 机制硬闸的开关判定失效（退化为 allow） |
| `FMT-COORD` | warn | `coordination` 非对象，或 `priority` 不在 `{urgent,high,normal,low,trivial}` 枚举，或 `state`/`state.current`/`state.planned` 非对象、数字字段（`active_tasks`/`burn_contribution`/`cost_to_complete_pct`）非数字、人类可读字段（`workload`/`remaining_work`）非字符串 | 全 optional·缺即降级（`ccm peers` 把该维度退 null）；priority 仅五挡——非法值退化为 normal。永不 hard（advisory ✎·fail-safe）——见 [A 节](#a-task-字段速查) coordination 块 |
| `FMT-INBOX` | warn | `coordination.inbox` 存在但非数组，或通知条目 id 非空唯一 / kind / status / strength / ISO 时间 / consumed_at 状态对应关系不合法 | 缺失 = 空 inbox；append 用 `ccm coordination notify`，消费用 `ccm coordination inbox ack <id...>`，不要手拼。`kind` 闭集、`status` 单调；坏形态只 warn，读取侧跳过坏条目 |
| `FMT-RUNTIME` | warn | `runtime` 非对象，或已知键（`last_identity_remind` / `last_critpath_remind` / `last_account_switch` / `stop_allow_until` 等）类型不合法（时间锚须严格 ISO-8601 UTC） | hook-owned ✎ 参数区：用 `ccm board set-param <白名单 key> <ISO>` 写（白名单 + 值校验在 verb 层）；缺/坏一律 graceful-degrade（周期 hook 退化为「从未提示」·首次必提示；Stop 释放闸退化为继续阻止停止）。未知键 silent-on-unknown。永不 hard |
| `FMT-ESTIMATE` | warn | `estimate` 不是 `{value:number, unit:string}` 对象 | `--estimate 3h`（ccm 自动解析成对象），别手拼——见 [E 节](#e-estimate-怎么估) |
| `FMT-ACCEPTANCE` | warn | `acceptance` 既非字符串也非对象，或对象 `criteria` 空、`criterion.status` 不在 {pending,met,failed} | `--accept "一句话"` 或 `--set-json acceptance={criteria:[...]}`——见 [D 节](#d-acceptance-怎么写好) |
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
| `BIZ-CADENCE-SHIPPED` | hard | iteration 标 `shipped` 但 members 未全部 done+verified（含不存在的 member） | 先把成员推到 done+verified 再 `ccm cadence ship`，或移出 members——见 [I 节](#i-cadence-与-iteration节奏怎么定) |
| `BIZ-CADENCE-MISSING-ESTIMATE` | warn | open iteration 的 member 缺有效 `estimate` | 给 member 补 `--estimate 3h` 这类估时，或移出本轮；否则 overbook / critical-path 判断会失明——见 [E 节](#e-estimate-怎么估) 与 [I 节](#i-cadence-与-iteration节奏怎么定) |
| `BIZ-CADENCE-OVERBOOKED` | warn | open iteration 的 member 估时总量超过 timebox（deadline-started_at 或 `target.ship_every`，含小幅 grace） | 拆小、移出非本轮 member、降低 WIP 后重排；不要用 shipped 掩盖超载 |
| `BIZ-CADENCE-CRITICAL-PATH-OVER` | warn | open iteration 的 member 依赖关键路径超过 timebox（含小幅 grace） | 重切临界链上的大节点，删假依赖边，或把 scope/timebox 取舍 surface 给用户 |
| `BIZ-TASK-OVERSIZED-FOR-CADENCE` | warn | 单个 iteration member 的 estimate 超过 `cadence.target.ship_every`（含小幅 grace） | 默认再切成能在一个 cadence 目标内验收的薄片；若不能切，写清理由并接受 warn |
| `BIZ-AGILE-ACCEPTANCE-MISSING` | warn | cadence member 缺清晰 `acceptance` | 给该 member 补一句 DoD 或 criteria；没有验收标准的节点不该作为可 ship 切片收口 |
| `BIZ-ESTIMATE-STALE` | warn | 实测 duration 与 estimate 明显漂移，提示下游重估 | 用新的实测反馈重估未开始下游，必要时重开 baseline / replan |
| `BIZ-STATUS-DEPS` | warn | deps 门控不一致：`ready` 但 deps 未全 done / `blocked` 无 `blocked_on` 但 deps 全 done | **CLI 写路径经 `reconcileGating` 永不产生此态**——看到它多半是手改 board；跑任意 ccm 写命令触发归一，或 `task unblock`/`set-status` 手动对齐——见 [B 节](#ready--blocked-由系统按-deps-自动门控) |
| `BIZ-DECISION-PACKAGE` | warn | `decision_package` 在但字段不全：`context_md`/`what_i_need`/`enter_cmd` 空、`ask_type` 不在枚举、decision 型 `options` 空、`inputs_hash` 非 `sha256:<64hex>` | 备齐采访包字段；decision 型必须有非空 options——见 [G 节](#g-blocked_on-怎么选) |
| `BIZ-DEV-REFS` | **hard** | `type=development` 的 task 缺 `kind=spec`≥1 或 `kind=plan`≥1 引用 | development task 加 `--ref spec:/abs/spec.md --ref plan:/abs/plan.md`（`task add`）或 `--add-ref`（`task update`）；`--force` 可越——见 [L 节](#l-referencesartifactverified-语义) |
| `BIZ-ACCEPTANCE-REQUIRED` | warn | type ∈ {development, development-demo, acceptance, e2e-integration} 但 `acceptance` 为空 | 这些 type 必须带 `--accept`——见 [D 节](#d-acceptance-怎么写好) |
| `BIZ-EXECUTOR-HANDLE` | warn | `status=in_flight` 且 `executor` ∈ {subagent, workflow}，但缺真实 `handle` | 派发工具返回句柄后 `task update --handle <后台句柄>`，再转 `in_flight`；`ready` / `blocked` future task 不预填——见 [C 节](#c-executor-五种语义--选择决策树) |
| `BIZ-EXTERNAL-ISSUE` | warn | `executor=external` 但缺 `kind=issue` 引用 | external task 加 `--ref issue:https://github.com/o/r/issues/N` 做外部追踪锚点 |
| `BIZ-EXTERNAL-ARTIFACT` | warn | `executor=external` 且 `status=done`，但 `artifact` 等于同一个 `kind=issue` tracking URL | 把 artifact 改成外部实际产出（PR / commit / release / report / CI run）；若 issue closed 但尚未验收，别标 done，先用 `uncertain` / `in_flight` / `stale` |
| `BIZ-TIME-ORDER` | warn | 时间序乱：`started_at` 早于 `created_at` / `finished_at` 早于 `started_at` / 有 finished 无 started / `in_flight` 无 started / `done` 无 finished | 用 ccm verb（`start`/`done`）按序盖戳，别手填出乱序时间 |
| `BIZ-DONE-VERIFIED` | hard | done 真语义（`status=done` ∧ `verified=true` ∧ `artifact` 非空）缺失 | `task done --verified --artifact /abs/...`;若尚未端点验收或没有产物,不要标 `done`——见 [L 节](#l-referencesartifactverified-语义) |

> **schema 版本说明：** 当前引擎期望 `schema === "cc-master/v2"`。如果你看到的 board 或别处文档写 `cc-master/v1`（旧板 / 旧叙事），以 `ccm board --help` / 引擎 board-model 为准——schema 锚点是机器读的窄腰字段，别手改。

---

> **实时真相永远以 `ccm <namespace> <cmd> --help` 为准**——本文是操作地图，`--help` 是当前领土。全量命令签名 / flag / `--json` 输出形状在 [command-catalog.md](command-catalog.md)。校验规则的权威实现在 ccm 引擎（board-model 注册表给每条规则的 level）。
