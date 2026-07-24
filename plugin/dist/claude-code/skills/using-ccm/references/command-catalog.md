# ccm 命令面机械参考（command catalog）

> 纯机械参考：命令、positional、flag、例子、`--json` 形状、exit code。状态机转移语义、字段三档纪律、`--set` 用法判断等判断型内容见 SKILL.md，本文不复述。
> 基准版本：`ccm 0.22.0` stable runtime supply chain。

## 目录（TOC）

- [顶层结构](#顶层结构)
  - [Namespaces](#namespaces)
  - [Aliases](#aliases)
  - [Reserved（占位·暂未实现）](#reserved占位暂未实现)
  - [Global flags](#global-flags)
  - [Exit codes](#exit-codes)
  - [JSON 信封](#json-信封)
- [跨 harness 主动查询目标事实](#跨-harness-主动查询目标事实)
- [namespace worker（raw transport + tracked dispatch）](#namespace-workerraw-transport--tracked-dispatch)
  - [worker help](#worker-help)
  - [worker run](#worker-run)
  - [worker dispatch](#worker-dispatch)
- [namespace model-policy（统一模型角色与排序 advisory）](#namespace-model-policy统一模型角色与排序-advisory)
  - [model-policy show](#model-policy-show)
  - [model-policy advise](#model-policy-advise)
- [namespace orchestrator（cached context）](#namespace-orchestratorcached-context)
  - [orchestrator context](#orchestrator-context)
- [namespace route（shadow advisory）](#namespace-routeshadow-advisory)
  - [route advise](#route-advise)
- [namespace quota（live admission authority）](#namespace-quotalive-admission-authority)
  - [quota status](#quota-status)
  - [quota refresh](#quota-refresh)
  - [quota preflight](#quota-preflight)
  - [quota reserve](#quota-reserve)
  - [quota audit](#quota-audit)
- [namespace board](#namespace-board)
  - [board show](#board-show)
  - [board lint](#board-lint)
  - [board graph](#board-graph)
  - [board critical-path](#board-critical-path)
  - [board next](#board-next)
  - [board init](#board-init)
  - [board update](#board-update)
  - [board archive](#board-archive)
  - [board set-param](#board-set-param)
  - [board stamp-harness](#board-stamp-harness)
  - [board enable-contract](#board-enable-contract)
- [namespace goal](#namespace-goal)
  - [goal set](#goal-set)
  - [goal confirm](#goal-confirm)
  - [goal amend](#goal-amend)
  - [goal show](#goal-show)
  - [goal check](#goal-check)
  - [goal deadline set|confirm|confirm-none|amend|show](#goal-deadline)
- [namespace capability](#namespace-capability)
  - [capability check](#capability-check)
  - [capability list](#capability-list)
  - [capability negotiate](#capability-negotiate)
- [namespace target](#namespace-target)
  - [target set](#target-set)
  - [target show](#target-show)
  - [target refresh](#target-refresh)
- [namespace delivery](#namespace-delivery)
  - [delivery check](#delivery-check)
  - [delivery audit](#delivery-audit)
- [namespace dependency](#namespace-dependency)
  - [dependency require](#dependency-require)
  - [dependency default](#dependency-default)
  - [dependency explain](#dependency-explain)
  - [dependency waive](#dependency-waive)
- [namespace task](#namespace-task)
  - [task add](#task-add)
  - [task show](#task-show)
  - [task list](#task-list)
  - [task update](#task-update)
  - [task set-planning](#task-set-planning)
  - [task set-routing](#task-set-routing)
  - [task route-bind](#task-route-bind)
  - [task native-attempt-create](#task-native-attempt-create)
  - [task native-attempt-bind](#task-native-attempt-bind)
  - [task native-attempt-cancel](#task-native-attempt-cancel)
  - [task native-attempt-terminal](#task-native-attempt-terminal)
  - [task native-attempt-reconcile](#task-native-attempt-reconcile)
  - [task start](#task-start)
  - [task done](#task-done)
  - [task retry](#task-retry)
  - [task attest-delivery](#task-attest-delivery)
  - [task block](#task-block)
  - [task unblock](#task-unblock)
  - [task set-status](#task-set-status)
  - [task rm](#task-rm)
- [namespace log](#namespace-log)
  - [log add](#log-add)
  - [log list](#log-list)
- [namespace jc](#namespace-jc)
  - [jc add](#jc-add)
  - [jc list](#jc-list)
  - [jc show](#jc-show)
  - [jc resolve](#jc-resolve)
- [namespace cadence](#namespace-cadence)
  - [cadence update](#cadence-update)
  - [cadence open](#cadence-open)
  - [cadence ship](#cadence-ship)
  - [cadence status](#cadence-status)
- [namespace watchdog](#namespace-watchdog)
  - [watchdog arm](#watchdog-arm)
  - [watchdog disarm](#watchdog-disarm)
  - [watchdog status](#watchdog-status)
- [namespace baseline](#namespace-baseline)
  - [baseline snapshot](#baseline-snapshot)
  - [baseline show](#baseline-show)
  - [baseline reset](#baseline-reset)
- [namespace policy](#namespace-policy)
  - [policy show](#policy-show)
  - [policy set](#policy-set)
- [namespace agent（Agent Registry·登记/探测/读取）](#namespace-agentagent-registry登记探测读取)
  - [agent create](#agent-create)
  - [agent bind](#agent-bind)
  - [agent link](#agent-link)
  - [agent terminal](#agent-terminal)
  - [agent probe](#agent-probe)
  - [agent list](#agent-list)
  - [agent show](#agent-show)
- [namespace peers（协调感知·只读跨板）](#namespace-peers协调感知只读跨板)
  - [peers list](#peers-list)
- [namespace coordination（通知收件箱）](#namespace-coordination通知收件箱)
  - [coordination inbox](#coordination-inbox)
  - [coordination subscription](#coordination-subscription)
  - [coordination notify](#coordination-notify)
  - [coordination arbitrate](#coordination-arbitrate)
- [namespace usage（只读 advisory）](#namespace-usage只读-advisory)
  - [usage show](#usage-show)
  - [usage advise](#usage-advise)
  - [usage task-cost](#usage-task-cost)
  - [usage burn-rate](#usage-burn-rate)
  - [usage runway](#usage-runway)
- [namespace status-report](#namespace-status-report)
  - [status-report render](#status-report-render)
  - [status-report write](#status-report-write)
  - [status-report show](#status-report-show)
  - [status-report watch](#status-report-watch)
- [namespace web-viewer](#namespace-web-viewer)
  - [web-viewer start](#web-viewer-start)
  - [web-viewer open](#web-viewer-open)
  - [web-viewer status](#web-viewer-status)
  - [web-viewer stop](#web-viewer-stop)
  - [web-viewer restart](#web-viewer-restart)
  - [web-viewer serve](#web-viewer-serve)
- [namespace monitor](#namespace-monitor)
  - [monitor start](#monitor-start)
  - [monitor stop](#monitor-stop)
  - [monitor status](#monitor-status)
  - [monitor restart](#monitor-restart)
  - [monitor serve](#monitor-serve)
  - [monitor install-service](#monitor-install-service)
  - [monitor uninstall-service](#monitor-uninstall-service)
- [namespace services](#namespace-services)
  - [services reconcile](#services-reconcile)
- [namespace runtime](#namespace-runtime)
  - [runtime stage](#runtime-stage)
  - [runtime activate](#runtime-activate)
  - [runtime resolve](#runtime-resolve)
  - [runtime invoke](#runtime-invoke)
  - [runtime doctor](#runtime-doctor)
  - [runtime rollback](#runtime-rollback)
- [namespace estimate（只读 advisory）](#namespace-estimate只读-advisory)
  - [estimate show](#estimate-show)
  - [estimate forecast](#estimate-forecast)
  - [estimate evm](#estimate-evm)
  - [estimate velocity](#estimate-velocity)
  - [estimate risk](#estimate-risk)
  - [estimate cost-to-complete](#estimate-cost-to-complete)
  - [estimate deadline-risk](#estimate-deadline-risk)
- [namespace calibration（显式写校准语料）](#namespace-calibration显式写校准语料)
  - [calibration capture](#calibration-capture)
- [namespace account](#namespace-account)
  - [account add](#account-add)
  - [account refresh](#account-refresh)
  - [account delete](#account-delete)
  - [account list](#account-list)
  - [account switch](#account-switch)
- [namespace statusline](#namespace-statusline)
  - [statusline render](#statusline-render)
  - [statusline install](#statusline-install)
  - [statusline uninstall](#statusline-uninstall)
- [namespace harness](#namespace-harness)
  - [harness list](#harness-list)
  - [harness current](#harness-current)
- [namespace attempt](#namespace-attempt)
  - [attempt write-set](#attempt-write-set)
- [namespace upgrade](#namespace-upgrade)
  - [upgrade all](#upgrade-all)
  - [upgrade ccm](#upgrade-ccm)
  - [upgrade plugin](#upgrade-plugin)
- [--json 输出形状](#--json-输出形状)

---

<a id="ccm-k-point-ccm-cmd-overview"></a>
<!-- ccm:k:start point:ccm.cmd.overview -->
## 顶层结构

`ccm` = cc-master board 命令行，数据模型 SSOT 的唯一写入关卡。

调用形态：

```
ccm <namespace> <command> [args] [flags]
ccm <alias> [args] [flags]
```

### Namespaces

| ns | 职责 |
|---|---|
| `worker` | 查看真实 agent-command help；`run` 是无 board 副作用的同步 raw transport，`dispatch` 是只写 `agents[]` 的同步 tracked transport |
| `provider` | 模型事实 snapshot 查询与 provider candidate 检查；facts 零 live probe，inspect 另走准入门 |
| `model-policy` | 四 provider 共用的模型角色 / provider 事实 / 社区 affinity 分层视图，以及对已 qualification 候选的纯排序 advisory |
| `orchestrator` | 从显式本地 cache 构造 frozen orchestrator context；cached-only、零 live probe |
| `route` | 对 frozen task + context 给纯 shadow route advice；永远 `spawned:false`、不写 board |
| `quota` | provider-neutral live quota admission：owner-only observation/reservation store、payer+pool capacity reservation 与 audit；Codex 只认 7d hard window |
| `board` | 板级：查看 / 校验 / DAG 分析 / 建板 / 改配置 |
| `goal` | Goal Contract 生命周期：首次转写、用户确认、修订、读取、完整性校验 |
| `capability` | 独立发版消费者的稳定能力握手（只读） |
| `target` | declared delivery target：本地解析 / 显示 / 刷新冻结 snapshot；不 fetch |
| `delivery` | candidate 对 target 的 delivered 三态检查 + ephemeral strict dry-run audit |
| `dependency` | downstream/dependency edge 的 requirement / explain / user-authorized waiver |
| `task` | 任务：增删改查 + 状态机（DAG 节点）+ opt-in planning/routing dedicated writers |
| `log` | append-only 审计轨迹 |
| `jc` | judgment_calls 自驱决策记录 |
| `cadence` | 节奏 / iteration 收口 |
| `watchdog` | 自我唤醒 watchdog |
| `baseline` | EVM 计划基线快照（estimate 引擎的 plan SSOT·board 内唯一写 noun） |
| `policy` | board 级自主权限开关；`autonomous_account_switch` 用户所有、绝不自授权 |
| `agent` | Agent Registry：board ✎ `agents[]` 运行时 agent 登记簿——登记 / 交 handle 证据 / 关联 task / 收口 / 活性探测 / 只读花名册；**登记 / 探测 / 读取 noun，无任何 spawn/route/dispatch 语义**（dispatch 归 `worker`） |
| `peers` | 多 orchestrator 协调**感知层**：跨板只读花名册（全体活+心跳新鲜 orchestrator 的 goal/workload/priority/liveness） |
| `coordination` | 多 orchestrator 协调**入站通知面**：读/消费 `coordination.inbox`，低层 append 通知，运行 deterministic pool arbiter |
| `usage` | selected-target 配额只读 advisory：统一 current window、verdict、burn/runway 与 task token 成本；全机发现先用 `quota status --machine-wide` |
| `status-report` | 生成式 board 状态报告：`ccm/status-report/v1` JSON / artifact；只读 board，artifact 写 `<home>/reports/status-report/` |
| `web-viewer` | 本地只读 board web viewer lifecycle：open/start/status/stop/restart；home-scoped service，127.0.0.1 + token |
| `monitor` | 可选本地 monitor daemon：连续扫 harness usage / active boards，复用 pool arbiter 边沿写 `coordination.inbox` |
| `services` | home 常驻服务 reconcile：ccm 二进制替换后按 wanted 语义重启 monitor / web-viewer |
| `runtime` | cross-harness worker runtime 的 immutable image supply chain：stage / activate / assurance-tiered resolve+invoke / doctor / rollback（非 board 操作） |
| `estimate` | 工作侧**只读 advisory**：双通道 MC 工期预测 / EVM / velocity / 风险（消费 OR/ML 引擎） |
| `account` | 换号号池机制：备号 OAuth token 录入 / 选号 / 无重启切号（vault token-blind；`switch` 受 board.policy `autonomous_account_switch` 门控）。 |
| `statusline` | self-contained status line：渲染单行状态行（ctx/5h/7d）+ 装/卸 `settings.json`（非 board 操作；`install`/`uninstall` 写全局 Claude Code hooks）。 |
| `harness` | 本机 supported harness inventory：探测安装状态 / 当前选择 / install-upgrade 能力矩阵 |
| `attempt` | cross-harness managed worker 的本地 write-set 预检：安全解析隔离 worktree + lease，编译最小授权根；当前不启动 worker |
| `upgrade` | 自升级：把 **ccm 二进制 + cc-master 插件**升到各自发布线最新（非 board 操作·见 [namespace upgrade](#namespace-upgrade)） |

### Aliases

| alias | 等价于 |
|---|---|
| `ccm next` | `ccm board next` |
| `ccm lint` | `ccm board lint` |
| `ccm ls` | `ccm task list` |
| `ccm peers` | `ccm peers list` |
| `ccm viewer <verb>` | `ccm web-viewer <verb>`（namespace 级别名，覆盖全部 web-viewer 子命令：start/open/status/stop/restart/serve；裸敲 `ccm viewer` 行为同裸敲 `ccm web-viewer`） |

（另：`task list` / `jc list` / `log list` 自身有子命令别名 `ls`，即 `ccm task ls` / `ccm jc ls` / `ccm log ls`。）

### Global flags

所有命令通用。

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--board <path>` | | string | 指定 board 文件（最高优先） |
| `--session-id <id>` | | string | 指定 session（特权调用者注入；默认读 `$CLAUDE_CODE_SESSION_ID`） |
| `--home <dir>` | | string | 指定 cc-master home（默认 `$CC_MASTER_HOME` → `$HOME/.cc_master`；board 在 `<home>/boards/`） |
| `--goal <substr>` | | string | 多 active 板时按 goal 子串消歧（**例外**：`board update` / `board init` / `cadence open` 把 `--goal` 当 payload〔设 goal〕、**不**当发现过滤器——这三个 verb 的发现忽略 `--goal`，无歧义即命中唯一/未认领板） |
| `--json` | | bool | 机器可读 JSON 输出（非 TTY 时默认开） |
| `--dry-run` | `-n` | bool | 预览：跑完整校验但不落盘 |
| `--force` | `-f` | bool | 越过 hard error / 非法状态转移闸（记 log） |
| `--yes` | `-y` | bool | 跳过破坏性操作的确认（非交互） |
| `--quiet` | `-q` | bool | 只出错误 |
| `--verbose` | `-v` | bool | 详细输出（诊断走 stderr） |
| `--no-color` | | bool | 禁用颜色（亦遵循 NO_COLOR / 非 TTY / TERM=dumb） |
| `--no-input` | | bool | 绝不交互提示（脚本 / agent 模式） |
| `--set <p>=<v>` | | string（可重复） | 通用设 ✎ 标量字段（仅写命令；🔒 字段不可；scoping 见下） |
| `--set-json <p>=<j>` | | string（可重复） | 通用设 ✎ 对象/数组（仅写命令；兜长尾 + 前向兼容；scoping 见下） |
| `--help` | `-h` | bool | 显示帮助 |
| `--version` | | bool | 显示版本 |

接受 `--set` / `--set-json` 的写命令实测为：`task add`、`task update`、`board update`、`jc add`、`cadence update`、`cadence open`。

**专属写口例外**：board `delivery_contract` 与 task `delivery` / `dependency_requirements` 虽属 ✎ flexible tier，仍被 generic setter 保留区拦截（含 root replacement 与任意 nested path，exit 3）。它们只能分别经 `target set|refresh`、`task attest-delivery`、`dependency require|default|waive` 写入，避免绕过 proof、binding、edge scope 与 waiver authorization。

**`--set`/`--set-json` 的 scoping 语义（裸 path 落哪里由命令语境决定）**：

- **`task add <id>` / `task update <id>`**：裸 path（如 `--set 'decision_package=…'`）作用于**该 task**——与 `--title` 等具名 flag 一致的直觉。显式 `tasks[<其它id>].field` 前缀仍作用于指定 task（跨 task 逃生口）。task 🔒 字段（`id`/`status`/`deps`/`parent`）裸写同样被拒（exit 3），不会静默落 board 顶层。
- **`board update`**：裸 path 落 **board 顶层**（板级 ✎ flexible 字段的正门；🔒 `schema`/`goal`/`owner`/`git`/`tasks` 被拒）；`tasks[<id>].field` 前缀也可用、作用于该 task。
- **`jc add` / `cadence update` / `cadence open`**：裸 path 落 board 顶层（无 task 语境）；`tasks[<id>].field` 前缀作用于该 task。

写入后非 `--json` 输出会逐条回显实际写入的逻辑 path（如 `set tasks[T7].decision_package`）——落点与你预期不符时一眼可见。

### Exit codes

| code | 含义 |
|---|---|
| `0` | 成功 |
| `1` | 未预期错 |
| `2` | 用法错（缺必填 arg / 未知 flag 等） |
| `3` | 校验拒绝（lint hard error / 非法状态转移 / `--set` 命中 🔒 字段） |
| `4` | 锁超时 |
| `5` | 无 active board |
| `7` | 授权拒绝——`account switch` 被目标板 `autonomous_account_switch:deny` 拦下，或 `dependency waive` 缺显式 `--user-authorized` |

### JSON 信封

- 成功：`{"ok": true, "data": <payload>}`
- 失败：`{"ok": false, "exit": <code>, "error": "<msg>", "violations": [...]}`

`data` 形状随命令而变，见 [--json 输出形状](#--json-输出形状)。

---

<!-- ccm:k:end point:ccm.cmd.overview -->
<!-- ccm:k:nav:start point:ccm.cmd.overview -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:ccm.commands.core](../../../knowledge/modules/ccm.commands.core.md#ccm-k-module-ccm-commands-core)
- [next: namespace board 命令面](./command-catalog.md#ccm-k-point-ccm-cmd-board)
- [routes_to: namespace task 命令面](./command-catalog.md#ccm-k-point-ccm-cmd-task)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-ccm-cmd-cross-harness-facts"></a>
<!-- ccm:k:start point:ccm.cmd.cross-harness-facts -->
## 跨 harness 主动查询目标事实

这是 `master-orchestrator-guide` 高频派发热路径的命令面 SSOT。顺序是**发现 → 查真实 CLI → 查统一模型角色 / 事实 / taste → 查可证 usage/quota → 可选纯排序或 shadow advice → orchestrator 显式选择 raw transport 或 tracked transport**。事实查询与 advice 都不会启动 worker；只有调用者明确执行 `worker run|dispatch` 才会启动。

### 1. 发现与目标事实

当前上下文没有 selected target 的事实时，用下面的只读命令面主动取得 envelope；不要从 origin-local
事实、同品牌登录态或模型 prior 补造目标事实。

```bash
ccm harness list --machine-wide --json
ccm worker help --harness <codex|claude-code|cursor-agent|kimi-code> --scope agent
ccm provider facts <target-provider> --json
ccm model-policy show --task <task-taxonomy> --json
ccm quota status --machine-wide --refresh --json
ccm --harness <claude-code|codex|cursor-agent|kimi-code> usage show --accounts current --json
ccm --harness <claude-code|codex|cursor-agent|kimi-code> usage advise --json
ccm quota preflight --input <json|@file|-> --json
```

- `harness list --machine-wide` 用于选择精确 execution surface；`cursor-ide-plugin` 与
  `cursor-agent-cli` 是两个 descriptor，安装、认证与资格不可互推。
- `worker help` 经与 `worker run` 相同的 resolver，读取这台机器上**实际被选中的 executable** 的 agent-command help；provider flags 以它为准。需要 executable 顶层 flags 时另跑 `--scope root`。这比把某版 CLI 参数表复制进 skill 更抗版本漂移。
- `provider facts` 的 `<target-provider>` 当前取 `claude-code | codex | cursor | kimi-code`。它返回静态、带来源与
  freshness 的模型事实，不执行 live provider probe，也不证明当前账号 entitlement 或 exact-model admission。
- `model-policy show` 为四 provider 返回同一份 `hard_facts / project_role_evidence / community_advisory` 分层 read model。它给出 task 的 `O / T1 / T2 / T3` effect floor 与候选，但 `candidate` 不等于 certified / admitted；社区 affinity 也绝不产生准入。
- `quota status --machine-wide` 默认只读所有受支持 target scope 的**本机缓存投影**；加 `--refresh` 才按需经各 harness 的 live collector best-effort 填充 observation 缓存后再读，让冷缓存即使没有 monitor daemon 也不必全是 unknown。两者 JSON 根都是 `ccm/machine-quota-status/v1`，`summary.decisions[]` 给 target-bound posture，`readings[]` 给可得的百分比与 reset 事实；unavailable / expired reading 可带 `refresh_hint`，unknown / stale / missing 必须原样保留。Claude 另投影独立的 `claude-fable-*-cli + seven_day`，不可与通用 7d 相加；Codex target 只有 `codex-cli + seven_day`；Cursor 的两个 surface 各自再分 first-party `billing_period` 与 usage-based `billing_period_usage_based`，两池不互补；Kimi Code 投影 `kimi-cli + five_hour` 与 `kimi-cli + seven_day`，collector 默认可对过期 stored OAuth 做带锁自动刷新。
- `ccm --harness <target> usage show|advise` 是选定 target 后的下钻 read；`show` 的窗口位于 `current.{five_hour,seven_day,fable_seven_day,billing_period}`、named pools 位于 `current.pools[]`，并在 data 顶层给 `agent_summary` 与 `refresh_hint`；`advise` 返回单侧 verdict。它是 advisory，不是 automatic admission。`available:false`、窗口缺失或字段 unknown 必须原样保留，不能从 binary/auth/model facts、进程 RC0 或同品牌另一 surface 推出 ample。
- 不带 `--machine-wide` 的 `quota status` 仍只回答 home-scoped owner-only quota observation/reservation store 是否存在；其中 `available:true` **不等于**某个 harness 有 ample headroom。
- 只有已经持有 authority flow 给出的 `source_key`、committed `reservation_id` 与 `checked_at` 时，才把
  它们作为 `quota preflight` 输入。必须读取其 `decision`、`automatic_spawn_limit`、
  `blocking_reasons` 与 owner receipt；缺 authority reference、`automatic_spawn_limit:0` 或任一 blocker 都
  不能授权 spawn。`preflight` 只重验已有 authority evidence，不会现场查询某个 harness 的剩余额度，也不会创建 observation/reservation；不要由 caller 自铸 live / policy / effect 结论。
- 这些命令只取得和重验事实，不代替 orchestrator 的选择、用户对一次付费调用的授权或 parent 验收。
  字段如何解释查 [pacing-and-estimation 目标事实口径](${CLAUDE_PLUGIN_ROOT}/skills/pacing-and-estimation/references/cross-harness-target-facts.md)；是否派发归
  `master-orchestrator-guide`。

### 2. advise 与显式 dispatch

若 task 已有 planning/routing policy 且拿到了匹配 board revision 的 frozen context，可先跑：

```bash
ccm route advise <task-id> --context <json|@file|-> --origin <origin-harness> --as-of <UTC> --json
```

它永远是 pure shadow advice：输出固定 `spawned:false`，不 reserve、不建 attempt、不写 board。no-route / unknown / stale 不是“请自行猜一个候选”，而是 fail closed；即使得到 selected candidate，也仍须由 orchestrator 显式决定是否派发。

只要无 board side effect 的原始同步 transport 时，用 `worker run`。若需要 ccm 原子跟踪真实 PID、agent-side task link、可证 session 身份和 terminal，用 `worker dispatch`：

```bash
ccm worker run --harness <codex|claude-code|cursor-agent|kimi-code> --cwd /abs/repo -- <按 worker help 组装的完整 provider argv...>
ccm worker dispatch --board /abs/run.board.json --harness <codex|claude-code|cursor-agent|kimi-code> --task <task-id> --idempotency-key <key> --intent <safe-summary> --cwd /abs/repo [--transcript /abs/worker.log] -- <完整 provider argv...>
```

两者都逐项透传 argv/stdin/cwd、同步监督 child 到 terminal，且都不会 route/fallback/选模型/切号。区别只在跟踪边界：`run` 永远不写 board；`dispatch` 只在 `agents[]` 建 tracked aggregate，绝不改 task status/handle/routing attempt/acceptance。若 board 已 opt in routing contract，`dispatch` 也不会替你调用 `task route-bind` 或生成 selection evidence；父 task 的路由、状态与验收仍走原专属 gate。

若选择 `worker run` 承载长时 worker，**后台 handle 来自 origin harness**：必须由 origin harness 的后台 terminal / Shell 机制包住它，`worker run` 自己**不会返回 running handle**。其 `ccm/worker-process-result/v1` 只是 terminal 结果，**不是 running handle**。`worker dispatch` 同样是同步 supervision，不会伪装 detach；需要外层异步时仍由 origin 机制持有后台 job，但 board 中 tracked runtime handle 来自实际 child PID / 已证 session identity，不是该外层 job。

---

<!-- ccm:k:end point:ccm.cmd.cross-harness-facts -->
<!-- ccm:k:nav:start point:ccm.cmd.cross-harness-facts -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:ccm.commands.extended](../../../knowledge/modules/ccm.commands.extended.md#ccm-k-module-ccm-commands-extended)
- [routes_to: namespace usage](./command-catalog.md#ccm-k-point-ccm-cmd-usage)
- [next: worker/provider/model-policy/orchestrator/route/quota](./command-catalog.md#ccm-k-point-ccm-cmd-worker-quota)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-ccm-cmd-worker-quota"></a>
<!-- ccm:k:start point:ccm.cmd.worker-quota -->
## namespace worker（raw transport + tracked dispatch）

### worker help

```text
ccm worker help --harness <codex|claude-code|cursor-agent|kimi-code> [--scope <agent|root>]
```

resolver 使用与 `run` 相同的 executable resolution，显示最终选中的本机真实 agent command 的真实 help；
这才是 agent 组装 provider argv 的当下入口。`--scope` 的 `agent` 是默认值，显示 descriptor 定义的
agent command help；`root` 显示该 executable 的 root/global help，供调用者确认必须放在 agent 子命令
之前的全局 flags。`ccm worker run --help` 只显示 ccm 自己的 wrapper help，不转发 provider help。`worker help` 把真实
child stdout / stderr 原样写回相应 stream，并对 provider exit 作 mirror；它的固定 timeout 为 10000 ms、
stdout 上限 536870912 bytes、stderr 上限 536870912 bytes。unknown harness 在进入 provider resolver 前作为 usage error 拒绝。

### worker run

```text
ccm worker run --harness <codex|claude-code|cursor-agent|kimi-code> [--cwd <path>] [--timeout-ms <n>] [--max-output-bytes <n>] -- <provider argv...>
```

- `--` 是 ccm lifecycle options 与 provider argv 的硬边界；其后必须是调用者组装的**完整 provider argv**，
  ccm 逐项原样转发，绝不自动拼接任何 command prefix。Codex 调用者需要按真实 help 自己包含 `exec`，并把
  root/global flags 放在 provider 要求的位置。ccm 不解析、补写或规范化 provider 的 model、effort、
  permission、sandbox、prompt 或 output flags。
- **写文件 / 改代码的 worker 必须由你在 provider argv 里显式放开沙箱 / 审批闸。** harness CLI headless 默认常把 worker 关进只读沙箱或审批闸（如 `codex exec` 默认只读），你不放开它就只拿到一个改不动盘的 worker；ccm 只逐项透传、绝不替你注入任何沙箱或审批 flag（见上一条），所以放开与否只由你组装 argv 时定。先跑 `worker help` 核对本机版本，再照它组装。各 harness 放开写入的标志：
  - **codex**（`--harness codex`）：`codex exec` 默认 `--sandbox read-only`，写不了盘。放开写入传 `--sandbox workspace-write`（可写 cwd/workspace；另需可写目录用 `--add-dir <绝对目录>` 扩展）；要连审批一起全放开传 `--sandbox danger-full-access` 或 `--dangerously-bypass-approvals-and-sandbox`（危险，仅在外层已隔离时用）。
  - **cursor-agent**（`--harness cursor-agent`）：headless 用 `-p/--print`（本身能用 write/shell 工具，但命令受审批闸）。传 `-f/--force`（等价 `--yolo`）自动放行命令（除非被显式拒），才让它真正写盘；若 sandbox 模式开着再传 `--sandbox disabled` 关掉。别传 `--mode plan` / `--mode ask`（都是只读）。
  - **claude-code**（`--harness claude-code`）：没有只读沙箱，但有权限闸——headless `-p/--print` 下写类工具默认被权限检查挡。放开写入传 `--permission-mode acceptEdits`（接受文件编辑），或全绕过传 `--dangerously-skip-permissions`。
  - **kimi-code**（`--harness kimi-code`）：`-p/--prompt '<...>'` 单发本身即以非交互模式自动执行工具（含写文件），无需额外放开标志。**绝不**给 `-p` 叠 `-y/--yolo` 或 `--auto`——两者与 `-p` 互斥、会直接 exit 1 失败、不产出任何文件。
- stdin 无条件原样转发给 child。`--cwd` 必须是 absolute、existing directory（绝对、存在的目录），缺省为
  `process.cwd()`；结果里的 cwd 是解析后的真实路径。
- `--timeout-ms` 允许 50..7200000（最长 2 小时），`run` 默认 600000；`worker help` 使用固定 10000 timeout。默认给真实 agent 派发足够跑完的预算，省略时不会在两分钟处误杀长任务。
  `--max-output-bytes` 允许 256..536870912，默认 536870912，并分别约束 stdout 与 stderr（stderr 另有独立上限 536870912）。上限足够容纳大输出（如 codex 的 blueprint/state，或其动辄几十 MB 的 stderr 诊断流），不会在 1 MiB / 32 MiB 处截断并 kill 长任务。
- `run` 是无 `--json` 分叉的显式例外：它始终把 ccm 通用成功信封写到 stdout，其中 `data.schema` 固定为
  `ccm/worker-process-result/v1`。承重字段完整固定为 `schema`、`harness`、`state`、`executable`、`argv`、
  `cwd`、`stdout`、`stderr`、`stdout_bytes`、`stderr_bytes`、`truncated`、`timed_out`、`cancelled`、
  `signal`、`exit_code`、`reaped`、`duration_ms`、`cleanup`、`error`；`state` 只取 `exited`、
  `timed_out`、`cancelled`、`failed`、`rejected`。它只报告 process terminal；ccm 不解析 provider terminal，
  也不判断任务是否成功。
- provider 非零退出仍返回上述 envelope；当 `state:exited` 且 exit code 为 0..255 时，wrapper 以同一 exit
  code 结束。SIGHUP / SIGINT / SIGTERM 分别 mirror 为 129 / 130 / 143；其它 signal、timeout、rejection
  或内部 failure 返回 1。origin signal 触发的 cancel 同样 mirror 对应 signal exit。
- `run` 的 unknown harness 会进入 handler 并返回同一 schema 的 structured rejected envelope
  （`state:rejected`）；`help` 的 unknown harness 则是 usage error。两者有意不同，确保调用者对每次 run
  都只消费一种 terminal 合同。
- ccm 不自动 route、fallback、切换账号、登录或选择模型；调用方依据真实 help 显式给出 provider argv。
  provider 仍可能通过继承的环境与 `HOME`/XDG 路径读写自己的状态，因此 raw wrapper 不提供 safe、
  read-only、credential-zero-write 或 automatic-eligibility 声明。
- 命令同步等待 child terminal，并管理 timeout、cancel、输出上限与自己创建的 process tree；它不跨
  parent exit、handoff 或 ccm update 存活。launcher 关闭后若留下一个短命的 owned helper（cursor-agent 曾见），会给它一个宽裕的 reap 窗口自然退出并保留完整 transcript。Cursor 若只剩已识别的持久 service tree——已解析版本目录下精确的 `node index.js worker-server`，可带 Cursor 为它启动且严格绑定当前 home npm cache 的 `typescript-language-server --stdio` 服务链——则把这些 provider service 排除出本次 request ownership；worker-server 缺席、进程枚举失败、空快照、混有任一其它成员或任一非上述签名的存活树都继续 fail-closed（TERM→KILL + `owned_tree_survived`）。该 reap 窗口默认 5000 ms，可用环境变量 `CCM_WORKER_REAP_TIMEOUT_MS`（100..60000）在慢机器上放宽。
- 要把它用于长时后台 worker，必须由 origin harness 的后台 terminal / Shell 机制包住本命令；可 recon handle 是该 origin 机制返回的 job/session/process handle。最终 `ccm/worker-process-result/v1` 是 terminal 结果，不是 running handle，也不能倒推出 provider task acceptance。

### worker dispatch

```text
ccm worker dispatch [--board <path>] --harness <codex|claude-code|cursor-agent|kimi-code> --task <task-id> --idempotency-key <key> --intent <safe-summary> [--cwd <path>] [--timeout-ms <n>] [--max-output-bytes <n>] [--transcript <absolute-path>] -- <provider argv...>
```

- `dispatch` 复用 `run` 的 provider resolver、argv/stdin/cwd 透传、超时/输出上限和 owned process-tree supervisor，但**不是 detach**：命令同步监督到 terminal 才返回。要让 shell 调用本身后台化，仍由 origin harness 的后台 terminal/Shell 机制承载；ccm 不伪造 durable job。
- `--task` 必须指向所选 board 的现有 task；它只产生 `agents[].links[]`，**绝不**改 task 的 `status`、`handle`、`routing.attempts` 或 `acceptance`。`--intent` 会持久化，必须是安全、非敏感摘要。
- `--idempotency-key` 必填。首次调用在 board lock 内 `prepare` 再唯一 `claim`；同 key + 同 request digest 精确 replay，不再 spawn；同 key + 不同 digest 硬冲突。digest 只覆盖非敏感结构：harness/task/canonical cwd/timeout/output ceiling/stdin mode/provider argv 数量；prompt、argv 内容、stdin 与 environment 既不落 board，也不哈希进可持久的 digest。业务幂等语义完全由调用方显式 key 承担；换了语义请求就必须换 key。
- `--transcript` 可显式登记一个已存在、可读的绝对 transcript 路径；它是有意 board-visible 的只读 stream 证据，也进入 request digest。显式路径优先于 Cursor 的 `CURSOR_TRANSCRIPT_PATH`；两者都复用 agent viewer 既有的 transcript locator，Cursor 以 `raw` 事件 tail。两者都没有或不可读时，Cursor roster/detail 与 task join 仍完整保留，stream 诚实返回 `source.kind="none"`，不伪造 transcript。
- 状态机是 `prepared → launch-claimed → bound → closing → closed`，异常分支为 `reconciliation-required`。spawn 后只接受运行时返回的真实正 PID；PID evidence、`lifecycle:running` 与 agent-side task link 在同一次 board lock mutation 内落盘。任何“running 但无真实 PID evidence”的记录都会被 aggregate 拒绝。
- claim 已成功但 PID 尚未绑定时 launcher 崩溃，下一次 replay 只会落 `reconciliation-required / ambiguous-launch`，**绝不自动重发**。PID bind 写失败时 supervisor 会取消并 reap 自己拥有的完整 process tree；live terminal 与已持久化 `closing` replay 的 terminal tracking 都走同一套有界重试 + durable reconciliation fallback，仍失败则 tracking failure 胜过 worker exit 0，且 receipt 只声称最新真正落盘的 phase/reconciliation 状态。
- 四个 harness 都保证 PID tracking。只在现有实证允许时单调升级身份：Codex 仅在调用方声明 `--json` transport 时从 JSONL `thread.started.thread_id` 升 `session-id`，可定位 `rollout-*-<sid>.jsonl`，attach 为 `codex resume <sid>`；Kimi 仅在 `--output-format stream-json` 时从 `session.resume_hint.session_id` 升级，可定位 `sessions/.../<sid>/agents/main/wire.jsonl`，attach 为 `kimi -S <sid>`；Claude Code 可从显式 `--session-id` 立即取得身份，或仅在 `--output-format json|stream-json` 时从严格的 `type=result / session_id` 信封取得身份，再定位 `projects/.../<sid>.jsonl`，attach 为 `claude --resume <sid>`。它们都不从任意模型文本猜 session id。Exact attach 的 cwd/argv 只在本次 CLI receipt 与聚合校验期间短暂存在；board 只保存 typed `{kind:"session-resume"}` 能力类，不保存 argv。Cursor native identity / SQLite transcript / exact attach 仍为未证实能力；外部 transcript 路径只提供 raw stream，不伪造 Cursor session identity。`unavailable` 明确表示「能力受支持，但本次尚未观察/定位到值」，绝不用空串冒充。
- capability evidence 使用偏序而非总序：只有 `unavailable ≤ supported(同一 canonical value)`；`supported → unavailable` 保留已落盘 canonical value，重复同值幂等。`unsupported` 是「能力不支持」的负声明，与 `unavailable` / `supported` 都不可比；`unsupported ↔ unavailable`、`unsupported ↔ supported` 一律 `evidence_conflict` 并由 repository 持久化 `reconciliation-required`，不覆盖旧证据。同 session 的不同 transcript 绝对路径或不同 canonical attach cwd/argv 同样冲突；attach 原文完成比较后立即丢弃，仍不落 board。相同 degraded status 的 reason 只是诊断文本，不是证据身份，重复时保留首个 durable reason。
- board 只持久化安全生命周期事实：key/digest/phase、PID/session evidence、typed capability、terminal exit/signal/error code/reaped。它不持久化 prompt、stdin、secret、environment、完整 provider argv 或 provider output。命令仍以 `ccm/tracked-worker-dispatch-result/v1` 返回本次 worker terminal envelope；exact replay 不可能重放未持久化的 provider output。
- agent `closed/terminal` 只说明 worker 进程生命周期收口，**不等于 task done，也不证明 parent acceptance**。消费者验收 result/artifact 后，才可经 task 自己的专属命令推进。

---

## namespace provider（facts + candidate inspect）

### provider facts

**读；零 live probe**

```
ccm provider facts <provider> [--as-of <UTC>] [--json]
```

- `<provider>`：`claude-code | codex | cursor | kimi-code`。
- 行为：返回 `ccm/provider-model-facts/v1` snapshot，必带 `source`、`observed_at`、`valid_until`、`account_scope`、`confidence`、`unknown`、`models`、`freshness`、`catalog_eligible_for_admission_check`、`eligible_for_automatic_selection` 与 `automatic_selection_blockers`。它不访问 provider、不证明 live entitlement / quota / exact admission，所以静态 snapshot 的 automatic-selection eligibility 保持 false。
- Cursor 的每个 `models[]` 条目另带 `quota_pool:"first_party"|"usage_based"`，用于把 model route 绑定到对应独立池；该静态映射仍不证明 live entitlement 或 headroom。
- `--as-of`：冻结 freshness 求值时间；缺省当前 UTC。`future-invalid` / `hard-stale` 仍 exit 0 可解释，但连 admission check 都不准入；fresh 只允许进入下一道 live admission。
- 例：`ccm provider facts codex --json` · `ccm provider facts cursor --as-of 2026-07-15T12:00:00Z --json`。

### provider inspect

`ccm provider inspect codex --request @request.json --json` 是独立的 candidate inspection / gated execution 面；不要拿 facts snapshot 冒充它的 live admission。

---

## namespace model-policy（统一模型角色与排序 advisory）

### model-policy show

```text
ccm model-policy show --task <task-taxonomy> [--as-of <UTC>] [--json]
```

- `--task` 必填，取项目 registry 中的稳定 taxonomy，例如 `architecture-design`、`implementation-from-spec`、`routine-heterogeneous-review`、`repository-code-research`、`mechanical-deterministic-work`。
- 输出 `ccm/model-policy-read-model/v1`。`hard_facts` 是官方 provider snapshot，`project_role_evidence` 是项目角色候选 / blockers，`community_advisory` 是带 provenance、TTL、confidence、contradictions 与 freshness 的 taste ledger；三层不可互相补证。
- O 候选、T1/T2/T3 候选只是跨 provider 候选发现。`eligible_for_automatic_selection:false` 会一直保持，直到调用者另行取得精确 target 的 role certification 与 live admission；本命令零 provider probe、零 board 写入。
- Cursor first-party 与 third-party-model route 分开。第三方 Fable / Sol 路线因 payer / paid-use 未明确而列入 `excluded_automatic_routes`，不得静默进入 first-party fallback。

### model-policy advise

```text
ccm model-policy advise --input <json|@file|-> [--as-of <UTC>] [--json]
```

输入是 `ccm/model-policy-advice-request/v1`：调用者必须为每个 candidate 提供已认证 role grades、exact selector / live admission / quota / permission / workspace / paid-use / retention 硬门、归一化的 cost / quota-headroom / latency / context-fit / integration 分数，以及可选 community affinity envelope。

输出 `ccm/model-policy-advice/v1`，机械顺序固定为：effect floor 与 target 硬门 → 按 posture 加权基础分 → 只在基础分等价带内应用有上限且会衰减的 community tie-break。stale、mixed、unknown 或无 evidence refs 的 affinity 归零；hard deny 进入 `rejected[].reason_codes`。命令只排序输入，不现场 qualification、不选择 CLI flags、不 reserve、不 spawn、不写 board。

`--role`、`--taxonomy`、`--require` 不是该命令的 flag；不要把资格条件临时拼成 CLI 参数。先构造上述 request schema，再通过 `--input` 提交；实时语法以 `ccm model-policy advise --help` 为准。

---

## namespace orchestrator（cached context）

### orchestrator context

```bash
ccm orchestrator context --cached-only [--agent-visible] [--snapshot <json|@file|->] --as-of <UTC> \
  --harness <origin> [--board <path>] [--json]
```

只读显式 cache，绝不 live probe。`--cached-only`、`--as-of`、`--harness` 必填；snapshot
缺失/坏 JSON 时 exit 0，返回 `available:false`、`freshness.state:"unknown"` 和 warning，绝不
隐式刷新。board revision 由当前 board canonical content 的 SHA-256 导出，不是手填字段。
这里的 canonical 是递归 key-sort 后的 parsed JSON；只改 key 顺序不改 revision。所有时间须为
可精确 round-trip 的 canonical UTC，非法日期/闰日不会被 runtime 归一化后放行。公开 context
只投影 allowlist 字段，递归 secret/private-shaped key 及高信号 credential/token-shaped value
都会被无回显拒绝；普通 token budget / credential unavailable 文案不误伤。输出确定性限制在
4096 UTF-8 bytes 内，并用 `truncation` 显式报告缩短/省略数量。

加 `--agent-visible` 时，ccm 进一步把 raw context 与当前板上最多 12 个合约化 `ready`
task 的 pure-shadow route advice 合成 `ccm/origin-context-delivery/v1`。完整 `content` 是
`<ambient source="orchestrator-context">`，仍受 4096 UTF-8 bytes 硬上限；资格 `ref`、路径、
任意 warning 文本、model/provider 私有信息均不进入投影。delivery 明示 `shadow_only:true`、
`dispatch_enabled:false`，只供 Claude Code / Codex / Cursor origin adapter 注入上下文；它不
reserve、不 spawn、不写 attempt/board。三路只允许 `origin_harness` 与 same/other 描述标签差异，
同 harness CLI 仍为 `cli-headless`。

## namespace route（shadow advisory）

### route advise

```bash
ccm route advise <task-id> --context <json|@file|-> --origin <harness> --as-of <UTC> \
  [--board <path>] [--json]
```

只读 planned task 与 `ccm/orchestrator-context/v1`，沿该 task 明示的 ample/tight chain 给建议。
context origin 必须等于 `--origin`；`available:false`、unknown/stale/revision mismatch 均 fail closed
为 no-route。advice 会按自己的 `--as-of` 重算 freshness，旧的 fresh context 过期后不能 replay。
同 harness CLI 保持 `cli-headless`，不会折叠为 native；品牌/crossness 不参与排序。该命令不
reserve、不 spawn、不建 attempt、不写 board。

---

## namespace quota（live admission authority）

这组命令是 cross-harness dispatch 的 provider-neutral 本地 quota authority seam。它不登录、登出、切号、
复制或写入 Codex/Cursor credential，也不直接调用 provider/model 或启动 worker。每个 provider rule 明示
承重 window；Codex 的 5h window 已退役，只有 Codex rule 会过滤 5h 并以同 payer+pool 的 fresh 7d
observation 作 hard gate。rolling 24h 只给风险 advisory，不把 ample 硬改成 deny。

### quota status

```bash
ccm quota status [--machine-wide] [--refresh] [--home <dir>] [--json]
ccm quota status --machine-wide --refresh --json
```

不带 `--machine-wide` 时读取 owner-only quota store。空 store 也 exit 0，并在通用成功信封的 `data` 中诚实返回
`{schema:"ccm/quota-status/v1",available:false}`；missing 绝不折算成 ample，`available:true` 也只证明 store 可读。

带 `--machine-wide` 时默认读取所有受支持 target scope 的本机**缓存**投影，exit 0，并直接返回根 schema
`ccm/machine-quota-status/v1`（不套通用 `{ok,data}` 信封）。默认不调用 provider collector；加 `--refresh`
则先通过同一组 per-harness live collector 对每个 target 作 best-effort 采集、填充 observation 缓存，再返回同一
status schema，所以冷缓存无需 monitor daemon 也不会永久全 unknown。该 flag 会初始化 home salt 并写 observation
缓存，不是纯缓存读取；单个 target 采集/持久化失败不伪造成功事实，仍以 unknown/error posture 诚实返回。用
`summary.decisions[]` 的精确 `target.harness_id + target.surface_id + target.window` 绑定候选。`state`、
`freshness`、`reason_codes[]` 与 `fanout_covered` 都是承重事实；unknown / stale / missing 不能解释为 ample。
`readings[]` 在 unavailable / expired 时可带 `refresh_hint.{reason,recoverable,command,remedy,recheck,agent_authorized,authorization}`；只有 `agent_authorized:true` 才表示 agent 可按边界执行 command。Claude 另投影独立的 `claude-fable-*-cli + seven_day`；Codex 只投影 `codex-cli + seven_day`；Cursor 每个 surface 都分别投影 first-party `billing_period` 与 usage-based `billing_period_usage_based`，两池不互补，任一 surface 的信号也不能补齐另一条；Kimi Code 投影
`kimi-cli + five_hour` 与 `kimi-cli + seven_day`，由 `kimi-usages-api` 读取当前登录态，过期 stored OAuth 可先带锁自动刷新。

### quota refresh

```bash
ccm quota refresh --machine-wide [--home <dir>] [--json]
```

这是显式的 machine-wide **live producer**：刷新所有受支持 target、发布本机投影并把 posture edge fan-out
给已订阅 session；缺 `--machine-wide` 是用法错误。它会调用 provider collector 并写本机 quota / notification
状态，因而不属于普通只读巡检热路径。默认先用 `quota status --machine-wide` 读缓存；只有调用方明确需要刷新、
接受其 provider 与写入副作用时才运行本命令。JSON 根是 `ccm/machine-quota-refresh/v1`，同样不套通用信封。

### quota preflight

```bash
ccm quota preflight --input <json|@file|-> [--json]
```

admission 输入只接受 `source_key`、`reservation_id`、`checked_at` 这类 authority reference；命令从
owner-only observation/reservation store 读取 policy、effect、provider-rule hard-window buckets、source revision、committed
ticket digest 与 run lineage 后重验，caller 自给的 `live` / `policy` / `effect` 结论不产生授权。
unknown / empty / tight / hard-stale / observation conflict / identity conflict / invalid commit 均返回
`automatic_spawn_limit:0`。带 `requested_effect` 的 lifecycle deny 仍是零副作用纯机械判定；
Codex/Cursor 的 account/session/credential/auth mutation request 固定 deny，effect count 为 0。
它不以 harness id 主动抓取剩余额度、不创建 authority observation/reservation；没有既存 authority refs 就没有可重验的 allow。

### quota reserve

```bash
ccm quota reserve --input <json|@file|-> [--home <dir>] [--json]
```

请求必须是闭合 `ccm/quota-reservation-request/v1`，带明确 `checked_at`，amount 为 positive finite，且只能创建 `held`；
caller 不能自铸 `committed`，也不能自铸 capacity/headroom/request hash。命令从 owner-only observation
authority 重验 source/account/pool/identity 与 hard-window buckets，并按 source profile 的 fresh/hard TTL、
`observed_at`、`valid_until`、reset 与 clock skew 在每次读取时重算 freshness；持久化的 `freshness:"fresh"`
不能授权过期 evidence。caller 给出的 capacity 必须与锁内推导
完全一致，否则 typed deny。Codex policy/provider-rule revision 必须是受支持的 7d pairing，所有承重百分比
严格落在 finite `0..100`；未知 revision、越界 ceiling/usage/margin/amount 都在 hold 前 fail closed。request
hash 由 store 对完整承重 binding canonical 计算；idempotency key 由 machine-scope lock + durable index 统一
寻址，同 canonical hash 即使换 provisional ID 也复用原 receipt，变更 aggregation/attempt/candidate/source/
account/pool/identity 即冲突；reservation ID 在本机 authority scope 全局唯一。multi-bucket 先发布 recoverable
transaction coordinator，只有 committed
journal 才让所有 legs 同时成为 authority；lookup、audit、expiry、release 也以该 journal 为唯一 authority，
projection 只可重建，crash/retry 不暴露 split state，任一不 fit 时全部写入 0。`held -> committed` 是
supervisor/runtime composition 的内部 transition：写入
ticket digest 与 attempt/run/account/pool/identity/aggregation/source/expiry lineage，不由 public reserve
输入控制。该命令只保留本地容量，不声称 provider 已预留或退款。

### quota audit

```bash
ccm quota audit --input <json|@file|-> [--home <dir>] [--json]
```

用 launch/process evidence 审计 reservation。只有 store locked/readable、claim absent、process identity
proven-absent 且 TTL 已到才能把 held 判为 expired；`committed` 即使 claim absent 或墙钟已过也只能
orphan-audit 并继续计入容量。terminal/finalization proof 必须用闭合 schema 绑定 reservation ID/request hash、
attempt、run、ticket digest、连续 terminal journal revision、proven-dead process identity 与 cleanup/evidence
retention；任意非空对象、partial/mismatch/conflict proof 都不能释放容量。manager/session 消失、mtime 或
PID-not-found 单独都不能释放。managed
lock owner 记录 boot ID、process-start identity 与 nonce；只有平台证据可证明 stale 时才 journaled
recovery，不可证明就保持 `QUOTA_LOCK_BUSY`。multi-key transition 由 coordinator 一次发布全部 legs；
`expired|released` 是单调 terminal，重试不得新增 event、复活 reservation 或重新占用容量；single-key
transition 在 event durable、snapshot publish 前 crash 时，terminal retry 会先从 event authority 修复 stale
projection 再返回。

---

<!-- ccm:k:end point:ccm.cmd.worker-quota -->
<!-- ccm:k:nav:start point:ccm.cmd.worker-quota -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:ccm.commands.extended](../../../knowledge/modules/ccm.commands.extended.md#ccm-k-module-ccm-commands-extended)
- [next: capability/target/delivery/dependency](./command-catalog.md#ccm-k-point-ccm-cmd-capability-deps)
- [routes_to: namespace usage](./command-catalog.md#ccm-k-point-ccm-cmd-usage)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-ccm-cmd-board"></a>
<!-- ccm:k:start point:ccm.cmd.board -->
## namespace board

板级：查看 / 校验 / DAG 分析 / 建板 / 改配置。

### board show

**读**

```
ccm board show [flags]
```

- positional：无
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | JSON 输出（返回摘要，见 [--json 输出形状](#--json-输出形状)） |

- 例：`ccm board show` · `ccm board show --json`

### board lint

**读**（有 hard error → exit 3）

```
ccm board lint [flags]
```

- positional：无
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 以 JSON 出 violations（否则人类报告） |
| `--raw` | | bool | 直读 `--board` 指定文件的原始字节喂 lint（绕过 discover 的 JSON 预校验——坏 JSON 也能 lint 成 FMT-JSON 错而非 exit 5；hook 用·须配 `--board`） |

- 例：`ccm lint` · `ccm board lint --json` · `ccm board lint --board <path> --raw --json`

### board graph

**读**

```
ccm board graph [flags]
```

- positional：无
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 结构化输出（否则人类树视图） |

- 例：`ccm board graph` · `ccm board graph --json`

### board critical-path

**读**

```
ccm board critical-path [flags]
```

- positional：无
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 结构化输出 |

- 例：`ccm board critical-path` · `ccm board critical-path --json`

### board next

**读**（别名 `ccm next`）

```
ccm board next [flags]
```

- positional：无
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 结构化输出（否则人类表格） |

- 例：`ccm next` · `ccm board next --json`

### board init

**写**

```
ccm board init [flags]
```

- positional：无
- flags：

| flag | 短名 | 类型 | default | 含义 |
|---|---|---|---|---|
| `--goal <str>` | | string | 空串 | 显式给值时同时建立 `assurance:asserted` 的 r1 Goal Contract；省略时建立空 goal + `assurance:pending` skeleton |
| `--github-issue <url>` | | URL | | 仅写 `board.source.kind=github_issue` / `board.source.url` 作为需求证据；绝不把 URL 复制成 goal |
| `--json` | | bool | | 返回 board 摘要；真实写入含 `data.board_path`，并声明 `data.capabilities` |
| `--dry-run` | `-n` | bool | false | 跑完整建板校验但不落盘；仍声明 capability，但输出不含 `data.board_path` |
| `--capabilities` | | bool | false | 只读返回 init 能力列表；不解析路径、不加锁、不建目录，供独立发版的 plugin 写前握手 |

- 例：`ccm board init`（master-orchestrator fresh 形态）· `ccm board init --goal "已转写的明确目标"`（显式 asserted）· `ccm board init --github-issue https://github.com/o/r/issues/9`
- 产物：`<home>/<YYYYMMDDThhmmssZ>-<pid>.board.json`
- 结构化路径合同：真实 `--json` 输出含绝对 `data.board_path` 和
  `data.capabilities:["board-init/structured-board-path-v1","goal-contract/v1"]`。用 `--capabilities --json` 做写前握手；
  旧 ccm 会在参数解析阶段拒绝该 flag，不会触发 init resolver。`--dry-run --json` 仍声明
  同一 capability，但**省略 `data.board_path`**，因为没有产物被写出；它自身也是零写。
- 注意：`--github-issue` 是 board source，不会创建 synthetic task 或 authoritative goal；orchestrator 读取 issue、按 Goal Framing Test 转写并 `ccm goal set`，check 通过后再拆真实 DAG。

### board update

**写**

```
ccm board update [flags]
```

- positional：无
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--goal <str>` | | string | 仅 legacy board 可重定 goal；已有 `goal_contract` 时拒绝，须改用 `ccm goal amend` |
| `--wip-limit <str>` | | int | `scheduling.wip_limit`（并发软上限） |
| `--owner-wip <str>` | | int | `scheduling.owner_wip_limit` |
| `--branch <str>` | | string | `git.branch` |
| `--worktree <str>` | | string | `git.worktree` |
| `--priority <enum>` | | enum `urgent\|high\|normal\|low\|trivial` | `coordination.priority`（板级优先级·跨板协调裁决主轴·非法值 → exit 2） |
| `--set <path=val>` | | string（可重复） | 设**板级顶层** ✎ 标量（裸 path 落 board 顶层；🔒 `schema`/`goal`/`owner`/`git`/`tasks` 被拒 exit 3；`tasks[<id>].path` 作用于该 task） |
| `--set-json <path=json>` | | string（可重复） | 设**板级顶层** ✎ 对象/数组（scoping 同上） |

- 例：`ccm board update --wip-limit 4 --branch feature-x` · `ccm board update --priority high` · `ccm board update --set notes="收尾备注"` · legacy-only：`ccm board update --goal "收尾冲刺"`
- `--priority` 写 ✎ `coordination.priority`（板级优先级·`ccm peers` 跨板花名册的裁决主轴 + 机械 fair-share 权重源；缺/坏 → 解析为 `normal`）。枚举校验在 update 端（坏值 exit 2·不静默写非法值）；它是 agent-shaped ✎ 字段（hook 不读·非窄腰）。init 时用户给的板级优先级经此落盘（命令体 bootstrap 段指导 orchestrator 捕获并记入）。
- 发现：`--goal` 在此是 legacy payload，**不**当发现过滤器；已有 Goal Contract 时 writer 在持锁校验内拒绝静默改写。所有 flag 走同一条两层匹配（精确 sid → 未认领 `session_id:""` 兜底），多 active 板时用 `--board <path>` 消歧。

### board archive

**写**（归档板·翻 `owner.active=false`·带锁·停用即休眠·显式可逆）

```
ccm board archive [flags]
```

- positional：无
- 行为：经引擎**带锁**把 `owner.active` 翻 `false`（停用即休眠·全套 hook 对它休眠）；**非破坏**——`tasks`/`log`/`goal`/`git` 全留（审计留痕·文件不删）。给 `/cc-master:stop`、`/cc-master:handoff-to-new-session` 一条**走单写者带锁管线**的归档路径，替代手编辑 board JSON 翻 active（手编辑与 Stop hook 带锁写并发会 torn-write）。幂等：已 `false` 再 archive 仍 `false`（无副作用）。日后可经 `ccm`/`as-master-orchestrator --resume` 复活。孤儿 / rollup 检查归调用方（命令体在归档前做）。
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 结构化输出（返回归档后 board 摘要） |
| `--dry-run` | `-n` | bool | 预览：跑完整校验但不落盘（owner.active 仍 true） |

- 例：`ccm board archive` · `ccm board archive --board <path>` · `ccm board archive --dry-run`

### board set-param

**写**（hook-owned 参数区·least-privilege·带锁）

```
ccm board set-param <key> <value> [flags]
```

- positional：`<key>`（必填·**白名单**：当前 `last_identity_remind`、`last_critpath_remind`、`last_goal_remind`、`last_account_switch`、`stop_allow_until`、`last_deadline_risk_check`、`last_deadline_risk_fingerprint`）、`<value>`（必填·按 key 声明类型校验）
- 作用域**收窄到 `board.runtime.<白名单 key>`**——非白名单 key / 非法值 / 字符串键传空值 → `exit 2`（Usage）；**绝不触碰 🔒/👁 窄腰**。
- 主要使用者是周期 hook（身份提示 hook 写 `runtime.last_identity_remind`、临界路径提示 hook 写 `runtime.last_critpath_remind`、Goal Contract 对齐 hook 写 `runtime.last_goal_remind`、交付 DDL 风险 hook 写 `runtime.last_deadline_risk_check` + `runtime.last_deadline_risk_fingerprint`）+ 账号切换机制写 `runtime.last_account_switch`（换号时刻·usage-pacing hook 读它做「检测到换号」ambient）+ Codex Stop hook 释放闸（agent 独立确认可停后写短期未来 `runtime.stop_allow_until`，Stop hook 在该时刻前放行）经进程边界 spawn 写；agent 也可经它写参数区。走 `runWrite` 带锁管线（与所有写 verb 同口径·刷 `owner.heartbeat`）。
- flags：`--json`（结构化输出 `{ok,data:{runtime}}`）；`--dry-run` 跑完整校验不落盘。
- 值类型：`last_identity_remind` / `last_critpath_remind` / `last_goal_remind` / `last_account_switch` / `stop_allow_until` / `last_deadline_risk_check` 均须严格 ISO-8601 UTC（`YYYY-MM-DDTHH:MM:SSZ`）；`last_deadline_risk_fingerprint` 须非空字符串（risk-input 摘要指纹·非时间戳）；否则 `exit 2`。
- 例：`ccm board set-param last_identity_remind 2026-06-29T12:34:56Z` · `ccm board set-param last_account_switch 2026-06-30T08:00:00Z --board <path>` · `ccm board set-param last_deadline_risk_check 2026-07-16T09:00:00Z --board <path>` · `ccm board set-param last_deadline_risk_fingerprint "at_risk|critpath|band3" --board <path>`

### board stamp-harness

**写**（ARM-time harness stamp·带锁·可信 detect guard）

```
ccm board stamp-harness [flags]
```

- positional：无
- 行为：从当前进程 env 的已知 harness `detect(env)` 派生可信 harness id，写 `owner.harness`。只在 `claude-code` / `codex` / `cursor` / `kimi-code` 的真实 env 命中时写；无可信 env 时 no-op，**不**用历史兼容默认（无 env → Claude Code）覆盖既有值。
- 作用域：只写 `owner.harness`（观察字段，非武装闸）。hook arming 仍只看 `owner.active` + `owner.session_id`。
- flags：`--json`（结构化输出 `{ok,data:{stamped,trusted_harness,owner:{harness}}}`）；`--dry-run` 跑完整校验不落盘。
- 例：`ccm board stamp-harness --board <path> --json`

### board enable-contract

**预检（只读）/ 写入成对 activation marker**

```text
ccm board enable-contract [--preflight] [--json]
```

- `--preflight`：只读返回 `ccm/routing-contract-preflight/v1`，列 `activation`、`ready`、每个非 grandfathered `subagent` 的 planning/routing/estimate gaps，以及可 grandfather 的历史 terminal task；不写 board。
- 不带 `--preflight`：只有 report 无 task gaps 时，原子写 `meta.contracts.task_planning:"ccm/task-planning/v1"`、`agent_routing:"ccm/agent-routing/v1"`、严格 UTC `agent_routing_activated_at` 与 terminal fingerprint 数组。部分 activation 永远不落盘。
- 历史 `done|failed|escalated` subagent 按 `task_id + created_at` 精确 grandfather；它们之后 retry 会进入新 attempt，不再豁免。
- 两个 marker 都缺是合法 legacy；本命令没有 disable verb。generic `--set-json meta...`、祖先替换与 `--force` 不能绕 dedicated writer / preflight。
- activation 本身不读取 provider、不 route、不 spawn、不 reserve，也不让同步 `ccm worker run` 自动回填 board。
- 例：`ccm board enable-contract --preflight --json` · `ccm board enable-contract`

---

<!-- ccm:k:end point:ccm.cmd.board -->
<!-- ccm:k:nav:start point:ccm.cmd.board -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:ccm.commands.core](../../../knowledge/modules/ccm.commands.core.md#ccm-k-module-ccm-commands-core)
- [routes_to: task 字段三档速查](./board-model-guide.md#ccm-k-point-ccm-board-task-fields)
- [next: namespace goal 命令面](./command-catalog.md#ccm-k-point-ccm-cmd-goal)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-ccm-cmd-goal"></a>
<!-- ccm:k:start point:ccm.cmd.goal -->
## namespace goal

Goal Contract 是 `board.goal` 的 revisioned 写入面。raw request / issue 只作证据；agent 先澄清转写，再通过本 namespace 持久化。`--brief-file` 的输入必须是 ≤1 MiB、有效 UTF-8、非 symlink 的普通文件；ccm 把它复制到 `<home>/goals/<board-stem>/rNNNN.goal.md`，以 `0600` 权限保存，并在 `board.goal_contract.brief` 记录 home-relative ref + SHA-256。revision 文件 immutable，不覆盖旧版。

### goal set

**写**：首次把 pending skeleton / legacy board 转成 r1 Goal Contract。

```bash
ccm goal set --summary "<normalized goal>" --assurance <pending|asserted> [--brief-file /abs/goal.md]
```

- `--summary`、`--assurance` 必填；已有非 skeleton contract 时拒绝，改用 `goal amend`。
- `asserted` 表示 agent 按安全默认补齐且 Goal Framing Test 通过；不是伪造用户确认。
- 例：`ccm goal set --board /abs/x.board.json --summary "交付一份通过验收的 draft PR，不合并" --assurance asserted --brief-file /tmp/goal.md`

### goal confirm

**写**：把当前 revision 的 assurance 升到 `confirmed`，revision 不变。

```bash
ccm goal confirm --user-authorized
```

- `--user-authorized` 必填且只代表当前对话已有真实用户确认；agent 绝不自授权。

### goal amend

**写**：需求语义变化时创建下一 revision，并 append 审计 log；旧 Brief 保留不覆盖。

```bash
ccm goal amend --summary "<new normalized goal>" --reason "<semantic delta>" \
  --assurance <pending|asserted> [--brief-file /abs/new-goal.md]
```

- `--summary`、`--reason`、`--assurance` 必填。新 revision 不继承旧 Brief 指针；仍需完整长背景时显式给新版 `--brief-file`。

### goal show

**只读**：显示 summary、contract 与受管 Brief 绝对路径；legacy board 的 contract 显示为 legacy/null。

```bash
ccm goal show [--json]
```

### goal check

**只读**：校验 contract 形状、Brief containment / 普通文件 / 存在性 / SHA-256。

```bash
ccm goal check [--json]
```

- verdict：`ok`（goal settled **且**交付 DDL settled，integrity valid）、`pending`（goal 还须澄清/确认）、`deadline_pending`（goal 已 settle 但交付 DDL 未 settle——键缺失或仍 pending）、`legacy`（旧板，无 contract）、`malformed`、`missing_brief`、`hash_mismatch`。
- `malformed|missing_brief|hash_mismatch` exit 3；`ok|pending|deadline_pending|legacy` exit 0。exit 0 不代表可以执行——`pending`/`deadline_pending` 都门控派发，调用方必须读取 verdict。
- `--json` 输出附 `deadline` 子块（`{present, state, at, precision, kind, rev, settled}`）供 agent / viewer 读。

### goal deadline

交付 DDL（delivery deadline）生命周期：把「整块 board / 当前 Goal Contract revision 最终交付」的时间承诺落在 `goal_contract.deadline`（单一 SSOT，随 goal revision 走）。三级命令走子动作 positional：`ccm goal deadline <set|confirm|confirm-none|amend|show>`。DDL 与 `cadence.iterations[].deadline`（单个 iteration 的局部 timebox）、ETA（`ccm estimate forecast` 的预测）、task timeout / watchdog 严格区分——它只表达整块交付承诺。

deadline 有自己的四态 settledness 状态机（`pending|asserted|confirmed|none`，与 goal `assurance` 正交），每次写盘 `rev` 单调 +1 并 append 一条 `board.log` decision（revision/reason/timestamp 三件套）。deadline 的任何写**绝不 bump `goal_contract.revision`**（延长/改期不是目标 scope 变更）。

```bash
# set：设候选/断言截止期（fresh framing 或 legacy 首次；state → asserted 或 pending）
ccm goal deadline set --at <ISO-8601-UTC> [--precision minute|day] [--kind hard|soft] \
  [--provenance-raw "<原始表达>"] [--source goal-evidence|cli-flag|user-reply] \
  [--tz-input <IANA tz>] [--assurance asserted|pending] [--json]

# confirm：把当前 pending/asserted 候选升为 confirmed（要 --user-authorized·agent 绝不自授权）
ccm goal deadline confirm --user-authorized [--json]

# confirm-none：用户明确确认「本目标无 DDL」（state → none·要 --user-authorized）
ccm goal deadline confirm-none --user-authorized [--json]

# amend：变更已存在截止期（延长/改期/改精度·要 --reason + --user-authorized·produces confirmed）
ccm goal deadline amend --at <ISO-8601-UTC> --reason "<why>" --user-authorized \
  [--precision minute|day] [--kind hard|soft] [--tz-input <IANA tz>] [--json]

# show：只读当前 deadline 子对象 + 剩余时间
ccm goal deadline show [--json]
```

- **`--at` 只收严格 ISO-8601 UTC**（`YYYY-MM-DDTHH:MM:SSZ`）；用户给本地时刻（如「北京时间 8/1 下午5点」）由 **agent 换算成 UTC** 后传入，原始表达存 `--provenance-raw`、假定时区存 `--tz-input`。ccm 不做时区换算 / 自然语言解析（语义归 agent）。
- **`--precision day`**：只给日期（可传裸 `YYYY-MM-DD` 或完整 ISO）→ 落当日 UTC **末刻 `23:59:59Z`**（「当日交付」而非「当日 00:00」）；`--precision day` 时**必须带 `--tz-input`**（date-only 无时区证据不可落板）。
- **`--assurance`（仅 set）**：`asserted`（默认）只用于**显式 `--ddl` 或用户输入文本里的无歧义绝对时刻**；推断 / 相对（「周五前」）/ 歧义一律用 `pending`（识别到候选但未 settle）。
- **`--kind`（set/amend）**：`hard`（默认·硬承诺——超期升级为**须向用户报告裁决**的 directive）或 `soft`（软目标——超期只 **advisory nudge**，提示但不阻断、可继续推进）。`set` 缺省 `hard`；`amend` / 再次 `set` 缺省**沿用既有 `kind`，绝不 silent 把 `soft` 翻成 `hard`**——要换软硬档必须显式传 `--kind`。非法值 fail-loud（exit 2）。
- **`confirm` / `confirm-none` / `amend` 强制 `--user-authorized`**（缺失 → exit 3·mirrors goal confirm）；`amend` 额外强制 `--reason`。`set` 已 confirmed / none 后拒绝（指向 amend）。
- **绕路封堵**：deadline 只能经这些 verb 写；`ccm board update` 无 deadline arg、`ccm board set-param` 白名单只含 `runtime.*`、`--set goal_contract.*` 被拒——都指向专属 verb。
- exit：0 成功·2 用法错（非 ISO / precision=day 缺 tz-input / amend 缺 reason）·3 校验拒绝（confirm 缺 --user-authorized / set 已 confirmed / 写后 FMT-DEADLINE）。

<!-- ccm:k:end point:ccm.cmd.goal -->
<!-- ccm:k:nav:start point:ccm.cmd.goal -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:ccm.commands.core](../../../knowledge/modules/ccm.commands.core.md#ccm-k-module-ccm-commands-core)
- [next: namespace task 命令面](./command-catalog.md#ccm-k-point-ccm-cmd-task)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-ccm-cmd-capability-deps"></a>
<!-- ccm:k:start point:ccm.cmd.capability-deps -->
## namespace capability

### capability check

**只读、零写**：检查当前独立发版的 ccm 是否兑现指定稳定 capability。

```bash
ccm capability check <capability-id> [--json]
```

- 当前稳定 id：`board-init/structured-board-path-v1`、`goal-contract/v1`、`goal-deadline/v1`。
- 支持时 exit 0 + `supported:true`；未知/不支持时 exit 3。plugin bootstrap 用它/等价 init capability envelope 做写前握手。

### capability list

**只读、零写**：声明本 ccm 兑现的**全部** capability + 版本，作跨版本斜错协商的基础清单。

```bash
ccm capability list [--json]
```

- `--json` 输出结构化清单：`{ "schema": "ccm/capability-manifest/v1", "ccm_version": "<本 ccm 版本>", "capabilities": [ { "id", "name", "version" } ] }`。
- 当前 capabilities（append-only·顺序稳定）：`board-init/structured-board-path-v1`、`goal-contract/v1`、`goal-deadline/v1`。
- 新 plugin 遇旧 ccm 时枚举它做降级判断：想用的 id 不在清单里 → 关掉对应功能或提示用户「升级 ccm 到兑现该 id 的版本」。

### capability negotiate

**只读、零写**：consumer 声明可接受的 capability id 集，engine 返回双方交集里版本最高的一项，或 exit 3 明确拒绝。

```bash
ccm capability negotiate <capability-family> --accept <capability-id> [--accept <capability-id>...] [--json]
```

- `<capability-family>`：能力族名（如 `goal-deadline`）。
- `--accept`：可重复；每项为完整 id（如 `goal-deadline/v1`）或同族版本后缀（如 `v1`）。
- 成功时 `--json` 输出：`{ "schema": "ccm/capability-negotiation/v1", "family", "capability", "version", "negotiated": true }`。
- 无兼容版本时 exit 3，错误信息列出 consumer 接受集与本 ccm 声明集。
- 与 `check` 互补：`check` 断言单个 id；`negotiate` 供 consumer 前向声明多版本（含未来 vN）后由 engine 选定实际兑现项。plugin `deadline-risk` 周期条目经此协商 `goal-deadline` 后再调 `ccm estimate deadline-risk`。

## namespace target

declared-mode v1 的接收端目标。所有 Git 解析只读本地 object database，固定
`GIT_NO_LAZY_FETCH=1` / 禁交互；不 fetch、不起 daemon。CLI registry 只有两级 noun+verb，故设计里的
`delivery target <verb>` 落成等义的 `target <verb>`。

### target set

**写**：`ccm target set <target-id> --kind git-ref --ref <ref> [--repository <local-worktree>]`
或 `ccm target set <target-id> --kind artifact-set --namespace file:/abs/manifest.json`。
本地解析后写 `delivery_contract.mode=declared` 与冻结 snapshot；缺 `--repository` 时用
`board.git.worktree`。支持全局 `--dry-run`。

### target show

**读**：`ccm target show <target-id> [--json]`。同时返回声明、冻结 snapshot 与当前本地
`current|drift|unknown` fact；missing object 是 unknown，不隐式联网补齐。

### target refresh

**写**：`ccm target refresh <target-id> [--dry-run] [--json]`。本地重解 snapshot；ref drift 后旧
observation 不再授权。exact/artifact proof 可按新 snapshot 重验；即使某次刷新记录 negative/unknown，后续刷新仍从
保留的原始 proof method 重试并可恢复为 delivered。reviewed reconciliation 必须重新提供 fresh review binding。

## namespace delivery

### delivery check

**读**：`ccm delivery check <task-id> <target-id> [--json]`。返回 `qualified|unqualified|unknown`、
`candidate_complete`、`target_delivered`、`qualified_by` 与稳定 diagnostic codes。blocked/unknown 是可读事实，
exit 0；命令本身坏输入/坏契约才非零。

### delivery audit

**读**：`ccm delivery audit --strict-dry-run [--json]`。把本次未声明 edge 临时视为 unknown，列全 edge
qualification。它不写板，也不把 `delivery_contract.mode` 改成 strict；declared-mode v1 没有 strict-default 写口。

## namespace dependency

### dependency require

**写**：`ccm dependency require <downstream-id> <dependency-id> --level candidate|delivered
[--target <target-id>] [--dry-run] [--json]`。只写 exact 既有 `deps[]` edge；`delivered` 必须给已声明 target，
`candidate` 不得带 target。

### dependency default

**写**：`ccm dependency default <downstream-id> --level candidate|delivered [--target <target-id>]`。
写该 downstream 的 `*` fallback；exact key 优先。它不创建或改写 `deps[]`。

### dependency explain

**读**：`ccm dependency explain <downstream-id> <dependency-id> [--strict-dry-run] [--json]`。解释派生
qualification 与 diagnostic codes；不持久化布尔。显式 edge 一律先要求上游 true-done，review
`REQUEST-CHANGES` / 缺 APPROVE 优先 fail closed。

### dependency waive

**写**：`ccm dependency waive <downstream-id> <dependency-id> --target <target-id> --reason <text>
--expires-at <UTC> --user-authorized [--dry-run] [--json]`。只接受已存在的 exact delivered requirement；waiver
精确绑定 downstream/dependency/target、过期即失效。缺 `--user-authorized` → exit 7。成功资格输出
`qualified_by:"waiver"` 且 `target_delivered:false`，绝不伪造交付事实。`--set-json` 不能替代本命令写 waiver。

---

<!-- ccm:k:end point:ccm.cmd.capability-deps -->
<!-- ccm:k:nav:start point:ccm.cmd.capability-deps -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:ccm.commands.extended](../../../knowledge/modules/ccm.commands.extended.md#ccm-k-module-ccm-commands-extended)
- [next: peers/coordination](./command-catalog.md#ccm-k-point-ccm-cmd-peers-coord)
- [routes_to: status 是状态机不是赋值字段](../SKILL.md#ccm-k-point-ccm-status-state-machine)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-ccm-cmd-task"></a>
<!-- ccm:k:start point:ccm.cmd.task -->
## namespace task

任务：增删改查 + 状态机（DAG 节点）。

### task add

**写**

```
ccm task add <id> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | task id（非空唯一） |

- flags：

| flag | 短名 | 类型 | enum 取值 | default | 含义 |
|---|---|---|---|---|---|
| `--title <str>` | | string | | `""` | 卡片标题 |
| `--description <str>` | | string | | | 详细描述 |
| `--type <enum>` | | enum（开放·未知值 warn） | `design, planning, development, development-demo, acceptance, e2e-integration, doc-alignment, pr` | | 任务类型 |
| `--executor <enum>` | | enum | `user, master-orchestrator, subagent, workflow, external` | | 执行者类型 |
| `--handle <str>` | | string | | | 真实后台句柄（`in_flight` subagent/workflow 必须有；`ready`/`blocked` future task 不预填；external 可记录 issue URL/number/run id） |
| `--deps <a,b>` | | csv | | `[]` | 依赖（逗号分隔） |
| `--parent <str>` | | string | | 缺=顶层 | 归属 owner 节点（嵌套 depth=1） |
| `--estimate <dur>` | | duration | `3h`/`90m`/`2d`/`1w` | | 估时 |
| `--ref <kind:ref>` | | string（可重复） | kind ∈ refKind 开放枚举 | | 引用 `kind:ref` |
| `--accept <str\|@file>` | | string/@file | | | 验收：一句话 DoD 或 `@file` |
| `--role <enum>` | | enum | `normal, fill-work` | `normal` | 调度角色 |
| `--review-gate <enum>` | | enum | `APPROVE` | | 声明显式 review 依赖门；只有 APPROVE 满足下游 deps |
| `--justification <str>` | | string | | | 决策理由 |
| `--status <enum>` | | enum | status 枚举（见 board show data） | `ready` | 初始 status |
| `--verified` | | bool | | false | 标记已验收 |
| `--artifact <str>` | | string | | | 产物链接 |
| `--wip-limit <str>` | | int | | | 本 task WIP 覆写 |
| `--set <path=val>` | | string（可重复） | | | 设**本 task** 的 ✎ 标量（裸 path 作用于本 task；`tasks[<id>].path` 可写其它 task） |
| `--set-json <path=json>` | | string（可重复） | | | 设**本 task** 的 ✎ 对象/数组（scoping 同上） |
| `--log <str>` | | string | | | 同时追一条 log |

- 例：`ccm task add T7 --type development --deps T1 --estimate 3h` · `ccm task add R1 --type review --review-gate APPROVE` · `ccm task add EXT3 --executor external --ref issue:https://github.com/o/r/issues/9 --handle o/r#9`
- external issue closed 但未端点验收：`ccm task set-status EXT3 uncertain`；验收外部 PR 后才：`ccm task done EXT3 --verified --artifact https://github.com/o/r/pull/12`

### task show

**读**

```
ccm task show <id> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | task id |

- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 完整 task JSON（否则人类卡片） |

- 例：`ccm task show T7` · `ccm task show T7 --json`

### task list

**读**（别名 `ccm ls` / `ccm task ls`）

```
ccm task list [flags]
```

- positional：无
- flags：

| flag | 短名 | 类型 | enum 取值 | 含义 |
|---|---|---|---|---|
| `--status <enum>` | | enum（可重复） | status 枚举 | 只列某 status |
| `--executor <enum>` | | enum | executor 枚举 | 只列某 executor |
| `--type <enum>` | | enum | taskType 枚举 | 只列某 type |
| `--parent <str>` | | string | | 只列某 owner 的子节点 |
| `--json` | | bool | | JSON 数组 |

- 例：`ccm task ls --status ready` · `ccm task ls --executor subagent --json`

### task update

**写**

```
ccm task update <id> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | task id |

- flags：

| flag | 短名 | 类型 | enum 取值 | 含义 |
|---|---|---|---|---|
| `--title <str>` | | string | | 卡片标题 |
| `--description <str>` | | string | | 详细描述 |
| `--type <enum>` | | enum（开放·未知值 warn） | taskType 枚举 | 任务类型 |
| `--executor <enum>` | | enum | executor 枚举 | 执行者类型 |
| `--handle <str>` | | string | | 后台句柄 |
| `--estimate <dur>` | | duration | `3h`/`90m`/`2d`/`1w` | 估时 |
| `--role <enum>` | | enum | `normal, fill-work` | 调度角色 |
| `--review-gate <enum>` | | enum | `APPROVE` | 声明显式 review 依赖门；只有 APPROVE 满足下游 deps |
| `--justification <str>` | | string | | 决策理由 |
| `--artifact <str>` | | string | | 产物链接 |
| `--verified` | | bool | | 标记已验收 |
| `--wip-limit <str>` | | int | | 本 task WIP 覆写 |
| `--accept <str\|@file>` | | string/@file | | 验收：一句话 DoD 或 `@file` |
| `--add-dep <a,b>` | | csv（可重复） | | 增依赖 |
| `--rm-dep <a,b>` | | csv（可重复） | | 删依赖 |
| `--add-ref <kind:ref>` | | string（可重复） | | 增引用 `kind:ref` |
| `--rm-ref <a,b>` | | csv（可重复） | | 删引用（按 ref） |
| `--parent <str>` | | string | | 改归属（`""`=升为顶层） |
| `--set <path=val>` | | string（可重复） | | 设**本 task** 的 ✎ 标量（裸 path 作用于本 task；`tasks[<id>].path` 可写其它 task） |
| `--set-json <path=json>` | | string（可重复） | | 设**本 task** 的 ✎ 对象/数组（scoping 同上） |
| `--log <str>` | | string | | 同时追一条 log |

- 例：`ccm task update T7 --estimate 5h --add-dep T2` · `ccm task update T7 --rm-dep T2 --verified --artifact /abs/out.md`
- **给 task 挂 `decision_package`（正例）**：`ccm task update T7 --set-json 'decision_package={"version":1,"ask_type":"decision","context_md":"…","what_i_need":"…","options":[…],"inputs_hash":"sha256:…","enter_cmd":"/cc-master:discuss T7"}'`——裸 path 直接落在 T7 上（无须再写 `tasks[T7].` 前缀）；成功输出回显 `set tasks[T7].decision_package` 供核对落点。
- 注：`update` 无 `--deps`（用 `--add-dep` / `--rm-dep`）、无 `--status`（用 start / done / block / set-status）；裸 `--set status=…` 会被 🔒 守门拒（exit 3），不会静默落 board 顶层。
- **`--artifact` 提前诊断（issue #57 问题2）**：若目标 task 已是 `status:done` 且 `verified` 非 `true`，单独设
  `--artifact`（不带 `--verified`）必然无法满足 done 真语义（`BIZ-DONE-VERIFIED`）——handler 层提前给一个更
  直达的 `Usage` 错误（**exit 2**，不是 exit 3），指路"同时加 `--verified` 或改用 `task done --verified
  --artifact`"。这是体验性提前诊断（lint 仍是唯一校验权威），不是新增校验规则——同时给 `--verified` 或目标
  不是"已 done 且未 verified"时不触发，正常交给 lint 判。

### task set-planning

**写（dedicated whole-object writer；不派发）**

```text
ccm task set-planning <id> --profile <json|@file|-> [--json]
```

- `--profile` 必填：`ccm/task-planning/v1` JSON 字面量、`@/absolute/file.json` 或 stdin `-`。
- writer 一次替换完整 `task.planning`，并在落盘前校验七维任务画像、estimate confidence、quality effect floor、budget posture/max attempts 与 required/preferred/forbidden capability sets；精确字段见 board-model-guide §C.5。
- 这是 route-independent task profile；命令不选 harness/provider/model、不 spawn。generic `task update --set-json planning=...` 与 `--force` 都不能替代它。
- 例：`ccm task set-planning T7 --profile @/abs/planning.json`

### task set-routing

**写（dedicated policy writer；不 selection / 不 spawn）**

```text
ccm task set-routing <id> --policy <json|@file|-> [--json]
```

- `--policy` 必填：provider-neutral policy JSON，含 `objective`、`constraints`、`candidates[]`、`chains.ample/tight` 与 `fallback`；精确字段与闭合 fallback classes 见 board-model-guide §C.5。
- writer 包装成 `ccm/agent-routing/v1` + `mode:"cross-harness"` + `selected:null` + `attempts:[]`，并与已有 planning 做 capability/effect/permission 交叉校验。
- 一旦已有 selection 或 attempt history，policy 不可替换；`attempts[]` append-only。generic setter / `--force` 不能覆盖。
- 命令不读取 provider、不选择 candidate、不 reserve、不 spawn、不 fallback。
- 例：`ccm task set-routing T7 --policy @/abs/routing-policy.json`

### task route-bind

**写（原子 selection + running attempt ledger projection；不 spawn）**

```text
ccm task route-bind <id> --selection <json|@file|-> --attempt <json|@file|-> [--json]
```

- 仅适用于 `executor=subagent` 且已有 routing policy 的 `ready`（或迁移中的 legacy `in_flight`）task。opt-in native-attempt board 改走 `native-attempt-bind`，不能由本 verb 绕过。
- `--selection` 必须引用 policy candidate 与 `ample|tight` chain，带 strict-UTC freshness window、每个 candidate `requires` predicate 恰好一次 `pass` 的 qualification results 和非空 reason codes。
- `--attempt` 必须是 `state:"running"`、candidate 与 selection 一致、带 strict-UTC `started_at` 和非空 opaque `handle`；requested model/effort 若存在必须等于 candidate。writer 自动冻结完整 `selection_snapshot`。
- 成功时原子写 `routing.selected`、append attempt、投影 task `handle`、把 task 置 `in_flight` 并在从 ready 转入时盖 `started_at`。重复 attempt id 或第二个 running attempt 拒绝。
- opaque handle 当前只是 syntactic claim，不是 live provider attestation。本命令不启动 worker；显式同步 `ccm worker run` 也不会自动调用它。generic start/handle setter/`--force` 不能替代 route-bind gate。
- 例：`ccm task route-bind T7 --selection @/abs/selection.json --attempt @/abs/attempt.json`

### task native-attempt-create

**写（精确 Codex native-attempt ledger contract；不调用 host tool）**

```
ccm task native-attempt-create <id> --selection <json> --attempt <json> --replay-intent <enum> [flags]
```

当前 native invoke runtime 为 `unsupported`：四 host strategy 都不投影 invoke artifact。此命令只在 opt-in board 上，从 `$CC_MASTER_HOME/native-attempt/v1/` 的 owner-only production store 读取已提交且未过期的 reservation/ticket，核对 canonical launch identity，原子 stage 唯一 claim、冻结 immutable create snapshot、持久提交 board 后再 commit claim。`launch_allowed:true` 只属于该精确 identity/claim；命令本身不 spawn，当前也没有 host adapter 消费它。

| flag | 类型 | 必填 | enum 取值 | 含义 |
|---|---|---|---|---|
| `--selection <json>` | JSON input | 是 | | 完整 qualified selection snapshot（`@/abs/file.json`、`-` 或 JSON 字面量） |
| `--attempt <json>` | JSON input | 是 | | `starting` native attempt + immutable dispatch/lineage/request snapshot |
| `--replay-intent <enum>` | enum | 是 | `accept-no-launch`, `require-new-launch` | 精确重放如何处理已存在 create；重放永不再次授权 launch |
| `--json` | bool | | | 输出 operation result JSON |

- 例：`ccm task native-attempt-create T7 --selection @/abs/selection.json --attempt @/abs/attempt.json --replay-intent accept-no-launch`
- 精确重放返回既有 attempt、`launch_allowed:false`；同 dispatch key 的冲突 request 一律拒绝。latest attempt 为 `starting|running|uncertain` 时禁止再 create。
- production 路径不接受测试注入的 admission/evidence resolver 冒充 owner 事实。若进程在 board 落盘后、claim commit 前崩溃，只在 stage owner 已消失且 board 已含完全相同 attempt/authority 时回收同一 durable stage；owner 仍存活、缺投影或 identity 漂移时保留现场并 fail-closed。

### task native-attempt-bind

**写（owner-only evidence transaction）**

```
ccm task native-attempt-bind <id> --attempt-id <str> --evidence-record-ref <str> [flags]
```

| flag | 类型 | 必填 | 含义 |
|---|---|---|---|
| `--attempt-id <str>` | string | 是 | 要从 `starting` 绑定到 `running` 的 native attempt id |
| `--evidence-record-ref <str>` | string | 是 | ccm owner-only evidence record ref；不接受 raw response / 调用方自证 JSON |
| `--json` | bool | | 输出 operation result JSON |

- 例：`ccm task native-attempt-bind T7 --attempt-id attempt-1 --evidence-record-ref evidence:bind-1`
- writer 在锁内 stage + verify evidence，应用 engine projection 并持久提交 board 后才 commit consume；engine/lint/conflict/write 失败会 rollback，record/claim 不消费。
- 若进程恰在 board 落盘后、evidence consumption commit 前崩溃，精确重放只凭 board 上相同 evidence ref/hash 恢复同一 stage；不同 record/hash 不能借 stale lock 继续。
- 只有认证 spawn handle 与同 handle 的 authoritative live roster observation 才能投影 `running`；create 时的 `expected_child_target` 从来不是 observation。

### task native-attempt-cancel

**写（记录控制请求；ack 不是 terminal）**

```
ccm task native-attempt-cancel <id> --attempt-id <str> --request <json> [flags]
```

| flag | 类型 | 必填 | 含义 |
|---|---|---|---|
| `--attempt-id <str>` | string | 是 | 当前 `running` native attempt id |
| `--request <json>` | JSON input | 是 | immutable cancel request（`@/abs/file.json`、`-` 或 JSON 字面量） |
| `--acknowledgement-terminal-class <str>` | string | | 负向契约入口；任何用 control acknowledgement 伪造 terminal 的请求都会被拒 |
| `--json` | bool | | 输出 operation result JSON |

- 例：`ccm task native-attempt-cancel T7 --attempt-id attempt-1 --request @/abs/cancel.json`
- request 必须是完整的 `{id,request_hash,requested_at,requested_by_session_ref,control,reason_code}`；`request_hash` 是 `sha256:<64hex>`，时间是 UTC 秒精度，且本 surface 唯一合法的 `control` 是 `"interrupt-agent"`。
- 首次 exact request 记录一个 host-control effect，精确重放为零 effect；acknowledgement 不改变 `running`，后续 terminal 必须另有认证 evidence。

### task native-attempt-terminal

**写（owner-only terminal evidence transaction；不直接 done）**

```
ccm task native-attempt-terminal <id> --attempt-id <str> --evidence-record-ref <str> [flags]
```

| flag | 类型 | 必填 | 含义 |
|---|---|---|---|
| `--attempt-id <str>` | string | 是 | `running|uncertain` native attempt id |
| `--evidence-record-ref <str>` | string | 是 | ccm owner-only terminal evidence record ref |
| `--requested-task-status <str>` | string | | 负向契约入口；请求 terminal 直接写 `done` 会被拒 |
| `--json` | bool | | 输出 operation result JSON |

- 例：`ccm task native-attempt-terminal T7 --attempt-id attempt-1 --evidence-record-ref evidence:terminal-1`
- stage/verify → engine apply → durable board commit → evidence consume；任一失败 rollback 且不消费。成功只记录 immutable terminal、清 handle 并把 task 投影到 `uncertain`；父层独立验收后仍须普通 `task done --verified --artifact`。

### task native-attempt-reconcile

**写（owner-only repair/classification evidence transaction）**

```
ccm task native-attempt-reconcile <id> --attempt-id <str> --evidence-record-ref <str> [flags]
```

| flag | 类型 | 必填 | 含义 |
|---|---|---|---|
| `--attempt-id <str>` | string | 是 | 要 reconcile 的 native attempt id |
| `--evidence-record-ref <str>` | string | 是 | ccm owner-only reconcile evidence record ref |
| `--json` | bool | | 输出 operation result JSON |

- 例：`ccm task native-attempt-reconcile T7 --attempt-id attempt-1 --evidence-record-ref evidence:reconcile-1`
- 只接受认证 evidence 驱动 `uncertain`、same-handle `running`、`terminal` 或完成 fenced orphan audit 后的 `orphaned` projection；调用方不能自选 status/handle。`orphaned` 清 handle 后仍走普通 deps gating，依赖未满足时落 `blocked`，不会绕过依赖门控。
- exact replay 是 no-op；conflicting evidence 拒绝。stage/verify 后仅在 durable board commit 成功时消费，所有失败 rollback/no-consumption。

> **五个 verb 的共同硬边界：**它们是 ledger writer，不是 runtime spawn wrapper。native-active projection 也不能被 generic status/handle writer、legacy `route-bind` 或 `--force` 构造/修复；硬 lint `BIZ-NATIVE-ATTEMPT-PROJECTION` 捕获 projection mismatch。

### task start

**写**

```
ccm task start <id> [<id2> <id3> ...] [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | task id（**可给多个**，空格分隔——批量起跑，见下方"批量语义"） |

- 行为：→ `in_flight`·盖 `started_at`
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--log <str>` | | string | 同时追一条 log（批量只追一条，summary 含全部 id） |

- 例：`ccm task start T7` · `ccm task start T7 T8 T9`（批量起跑）

### task done

**写**

```
ccm task done <id> [<id2> <id3> ...] [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | task id（**可给多个**，空格分隔——批量完成，见下方"批量语义"） |

- 行为：→ `done`·盖 `finished_at`;写入关卡要求同时带 `--verified` 与非空 `--artifact`,否则 `BIZ-DONE-VERIFIED` hard gate 拒绝落盘(exit 3)
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--artifact <str>` | | string | 产物链接（绝对路径 / URL；批量时对每个 id 一视同仁） |
| `--verified` | | bool | 标记已端点验收（批量时对每个 id 一视同仁） |
| `--review-verdict <enum>` | | enum | `APPROVE, REQUEST-CHANGES`；只用于已声明 `--review-gate APPROVE` 的 task。当前 attempt 的 APPROVE 开门，REQUEST-CHANGES/缺失不开门 |
| `--log <str>` | | string | 同时追一条 log（批量只追一条，summary 含全部 id） |

- 例：`ccm task done T7 --artifact /abs/out.md --verified` · `ccm task done R1 --artifact /abs/review.md --verified --review-verdict REQUEST-CHANGES`（审查执行完成但不开门）· `ccm task done T7 T8 T9 --artifact /abs/out.md --verified`（批量）
- review task 的 `status=done` / `verified=true` 表示 review 工作和报告已完成；审批结论单独写在当前 attempt 的 `review_verdict`。只有精确 `APPROVE` 满足显式 review gate；未声明 gate 却传 `--review-verdict` 会以 exit 3 拒绝且不落盘。`stale|failed|escalated → ready` 开新 attempt 时清旧 verdict；本次 `task done` 不带 `--review-verdict` 也会显式保持 current verdict 缺失，不复用上轮批准。

### task retry

**写**

```
ccm task retry <id> [<id2> <id3> ...] [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | task id（**可给多个**，空格分隔——批量开启新 attempt） |

- 行为：仅允许 `stale` / `failed` / `escalated` → `ready`。每个 task 的旧 `started_at` / `finished_at` / `artifact` / `verified` / `review_verdict` / `delivery` 连同来源 status 先以 `ccm/task-retry/v1` 结构归档到 append-only log，再清空当前 attempt 的 `started_at` / `finished_at` / `artifact` / `review_verdict` / `delivery` 并把 `verified` 设为布尔 `false`。归档与复位同一次持锁写入，不能只成功一半。随后写入关卡按同一依赖资格 evaluator 归一：只有 deps 全满足（declared edge `qualified` / legacy edge satisfied）的 task 最终落 `ready`，否则落 `blocked`。human 与 JSON 输出都逐项回显这个 reconcile 后的最终态（批量可同时出现 `blocked` / `ready`）。
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--log <str>` | | string | 在自动归档 log 之外再追一条说明（批量只追一条，summary 含全部 id） |

- 例：`ccm task retry T7` · `ccm task retry T7 T8 T9 --log "上游契约已更新"`
- 非上述三态会报非法转移（exit 3），`--force` 也不会扩大 retry 的来源集合；若 `done` 需要重做，先合法转为 `stale`，再 `retry`。
- 合法的通用 `ccm task set-status <id> ready` 也共享同一归档 + reset，避免旧路径遗留旧证据；面向重跑意图仍优先使用具名 `retry`。

### task attest-delivery

**写**：为当前 true-done attempt 建 candidate binding，并用本地 proof 写一条 target observation。proof 不成立时
exit 3，且在进入写关卡前就拒绝，`--force` 不能把失败 proof 变成交付。

```bash
ccm task attest-delivery <id> --target <target-id> \
  --method git-commit-contained --candidate-commit <commit-or-ref>

ccm task attest-delivery <id> --target <target-id> \
  --method reviewed-reconciliation-contained --candidate-commit <oid> \
  --integration-commit <oid> --attestation /abs/review.json

ccm task attest-delivery <id> --target <target-id> \
  --method artifact-digest-contained --logical-name <name> --artifact-version <immutable-version> \
  --artifact-ref <immutable-ref> --artifact-digest sha256:<64hex>
```

- exact Git：candidate commit 必须本地存在且被冻结 target OID exact containment。
- reviewed reconciliation：integration commit 必须 contained；本地 attestation（≤1 MiB）须 APPROVE，并精确绑定
  candidate fingerprint、target/target OID、integration commit 与 reviewed base。proof 持久化 attestation 的绝对路径与
  exact-byte digest；每次资格求值都会重新读取并复核，文件缺失、内容改变或 binding 漂移均为 unknown/fail-closed。
- artifact：冻结 manifest（≤1 MiB / ≤4096 entries）须含 exact logical-name/version/ref/digest 条目。
- branch/worktree 只定位 repository，不是 proof。命令不 fetch、不调用 provider/harness。
- generic `--set` / `--set-json` 不能写 `delivery`；candidate fingerprint 必须由本命令按当前 attempt 证据重算。

**批量语义（`task start` / `task done` / `task retry` 共用）**：`runWrite` 的写入
关卡是"mutate → 对整块 next 板跑一次 `lintBoard` → 有 hard error 就整体拒绝、不落盘"。逐条独立调用
`ccm task done <id>`（N 次独立进程 = N 次独立 mutate+lint+write）时，只要 board 上**还有其它任务**违反某条
hard 规则（哪怕与本次改的 id 无关），每一次单独调用都会因为**全局其它任务的存量违规**被拒——这正是"批量
45 个 id 只 1 个生效"的死结根因。批量调用（一次传入多个 id）把 N 次独立调用坍缩成**一次**调用：内部对每个
id 依次 `transition` + 覆写字段，但只跑**一次** `lintBoard` + **一次**落盘——只要这一批 id 本身在这次操作
后都变得合规、且 board 上没有**第三方**（不在这批里的）存量违规，就能一次性全部落盘。

- **all-or-nothing**：批量里任意一个 id 转移非法（如仍是 `ready` 没 `start` 就 `done`）或不存在，整批**都不
  落盘**（包括批量里其它本来合法的 id）——没有"部分提交"，`runWrite` 从来没有这个概念。
- **`--force`**：对 start/done 整批统一生效（既有全局语义），越过非法转移 + lint hard error；不支持"这批里第 3 个不
  force、其它 force"这种细粒度控制。
- **`--json` 输出形状**：`data` 从「单任务对象」统一为**数组**（长度恒等于传入 id 数，**含单 id 调用**——
  单 id 时 `data` 是长度为 1 的数组，这是本次改动唯一的向后不兼容点）。
- 若 board 上还有本批之外的第三方违规 task，批量 verb 不解决那个更大的问题——那仍需 `--force` 或把那些 id
  也纳入本次批量调用。

### task block

**写**

```
ccm task block <id> --on <str> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | task id |

- 行为：→ `blocked`·设 `blocked_on`
- flags：

| flag | 短名 | 类型 | 必填 | 含义 |
|---|---|---|---|---|
| `--on <str>` | | string | 是 | 阻塞源：`user` 或某 task id |
| `--decision <str\|@file>` | | string/@file/`-` | `--on user` 时必给 | decision_package |
| `--log <str>` | | string | | 同时追一条 log |

- 例：`ccm task block T7 --on T2` · `ccm task block T9 --on user --decision @/abs/decision.json`

### task unblock

**写**

```
ccm task unblock <id> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | task id |

- 行为：清除 `blocked_on`（+ 附属 `decision_package`）语义阻塞标记，**不直接定 status**——交回写入关卡的 `reconcileGating` 按 deps 满足度归一（deps 全满足→`ready`，否则→`blocked`）。这是 `task block` 的解除侧、也是「不该手 `set-status` 解 deps 阻塞」的正解。
- flags：

| flag | 短名 | 类型 | 必填 | 含义 |
|---|---|---|---|---|
| `--log <str>` | | string | | 同时追一条 log |

- 例：`ccm task unblock T7`

### task set-status

**写**

```
ccm task set-status <id> <status> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | task id |
| `<status>` | 是 | 目标 status |

- flags：仅 global flags（如 `--force` 越非法转移闸、`--log`）
- 例：`ccm task set-status T7 escalated` · `ccm task set-status T7 done --force`
- 补充：合法的 `stale` / `failed` / `escalated` → `ready` 会共享 `task retry` 的证据归档与 attempt reset；表达重跑意图时优先用具名 `task retry`。

### task rm

**写**（破坏性·非 TTY 须 `--yes`）

```
ccm task rm <id> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | task id |

- flags：仅 global flags（破坏性确认用 `--yes`）
- 例：`ccm task rm T7 --yes`

---

<!-- ccm:k:end point:ccm.cmd.task -->
<!-- ccm:k:nav:start point:ccm.cmd.task -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:ccm.commands.core](../../../knowledge/modules/ccm.commands.core.md#ccm-k-module-ccm-commands-core)
- [next: namespace log 命令面](./command-catalog.md#ccm-k-point-ccm-cmd-log)
- [routes_to: status 是状态机不是赋值字段](../SKILL.md#ccm-k-point-ccm-status-state-machine)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-ccm-cmd-log"></a>
<!-- ccm:k:start point:ccm.cmd.log -->
## namespace log

append-only 审计轨迹。

### log add

**写**（只增不改不删）

```
ccm log add <summary> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<summary>` | 是 | 一句话摘要 |

- flags：

| flag | 短名 | 类型 | enum 取值 | 含义 |
|---|---|---|---|---|
| `--kind <enum>` | | enum | `dispatch, recon, verify, finding, decision, replan, handoff, note` | log 类别 |
| `--task <str>` | | string | | 关联的 task id |
| `--detail <str>` | | string | | 详情（长文） |
| `--ref <a,b>` | | csv（可重复） | | 关联引用 |

- 例：`ccm log add "派发 T7 给 subagent" --kind dispatch --task T7` · `ccm log add "改用方案 B" --kind decision --detail "理由:..."`

### log list

**读**（别名 `ls`）

```
ccm log list [flags]
```

- positional：无
- flags：

| flag | 短名 | 类型 | enum 取值 | 含义 |
|---|---|---|---|---|
| `--kind <enum>` | | enum | logKind 枚举 | 只列某类 |
| `--task <str>` | | string | | 只列关联某 task 的 |
| `--json` | | bool | | JSON 数组 |

- 例：`ccm log list --task T7` · `ccm log list --kind decision --json`

---

<!-- ccm:k:end point:ccm.cmd.log -->
<!-- ccm:k:nav:start point:ccm.cmd.log -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:ccm.commands.core](../../../knowledge/modules/ccm.commands.core.md#ccm-k-module-ccm-commands-core)
- [next: --json 输出形状](./command-catalog.md#ccm-k-point-ccm-cmd-json-shape)
- [routes_to: namespace task 命令面](./command-catalog.md#ccm-k-point-ccm-cmd-task)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-ccm-cmd-jc"></a>
<!-- ccm:k:start point:ccm.cmd.jc -->
## namespace jc

judgment_calls 自驱决策记录。

### jc add

**写**

```
ccm jc add <summary> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<summary>` | 是 | 一句话摘要 |

- flags：

| flag | 短名 | 类型 | enum 取值 | 含义 |
|---|---|---|---|---|
| `--category <enum>` | | enum | `architecture, drift, spec-impl-misalignment, other` | 自决类别 |
| `--severity <enum>` | | enum | `low, medium, high, critical` | 严重度 |
| `--decision <str>` | | string | | 做了什么决定 |
| `--rationale <str>` | | string | | 为什么这么决 |
| `--impact <str>` | | string | | 影响面 / 反转代价 |
| `--refs <a,b>` | | csv（可重复） | | 佐证引用 |
| `--task-ref <str>` | | string | | 关联 task |
| `--set <path=val>` | | string（可重复） | | 通用设 ✎ 标量（裸 path 落 board 顶层；`tasks[<id>].path` 作用于该 task） |
| `--set-json <path=json>` | | string（可重复） | | 通用设 ✎ 对象/数组（scoping 同左） |

- 例：`ccm jc add "选 ICU MessageFormat" --category architecture --severity high`
- 产物：新建 id 形如 `J1`、初始 `status: pending_review`、盖 `raised_at`。

### jc list

**读**（别名 `ls`）

```
ccm jc list [flags]
```

- positional：无
- flags：

| flag | 短名 | 类型 | enum 取值 | 含义 |
|---|---|---|---|---|
| `--status <enum>` | | enum | `pending_review, upheld, overturned` | 只列某 status |
| `--severity <enum>` | | enum | `low, medium, high, critical` | 只列某 severity |
| `--json` | | bool | | JSON 数组 |

- 例：`ccm jc list --status pending_review` · `ccm jc list --severity critical --json`

### jc show

**读**

```
ccm jc show <id> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | jc id |

- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 完整 jc JSON |

- 例：`ccm jc show J1`

### jc resolve

**写**

```
ccm jc resolve <id> --status <upheld|overturned> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | jc id |

- flags：

| flag | 短名 | 类型 | enum 取值 | 必填 | 含义 |
|---|---|---|---|---|---|
| `--status <enum>` | | enum | `upheld`（维持）/ `overturned`（推翻） | 是 | 裁决结果 |
| `--note <str>` | | string | | | 裁决理由（存 `resolution_note`） |

- 例：`ccm jc resolve J1 --status upheld --note "事后看是对的"`

---

<!-- ccm:k:end point:ccm.cmd.jc -->
<!-- ccm:k:nav:start point:ccm.cmd.jc -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:ccm.commands.scheduling](../../../knowledge/modules/ccm.commands.scheduling.md#ccm-k-module-ccm-commands-scheduling)
- [next: namespace cadence](./command-catalog.md#ccm-k-point-ccm-cmd-cadence)
- [routes_to: status 是状态机不是赋值字段](../SKILL.md#ccm-k-point-ccm-status-state-machine)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-ccm-cmd-cadence"></a>
<!-- ccm:k:start point:ccm.cmd.cadence -->
## namespace cadence

节奏 / iteration 收口。

### cadence update

**写**

```
ccm cadence update [flags]
```

- positional：无
- flags（设 / 改节奏配置 target = `{ship_every, min_unit}`）：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--ship-every <dur>` | | duration | `target.ship_every`（如 `3h`） |
| `--min-unit <str>` | | string | `target.min_unit`（如 `"1 PR"`） |
| `--set <path=val>` | | string（可重复） | 通用设 ✎ 标量（裸 path 落 board 顶层；`tasks[<id>].path` 作用于该 task） |
| `--set-json <path=json>` | | string（可重复） | 通用设 ✎ 对象/数组（scoping 同左） |

- 例：`ccm cadence update --ship-every 3h --min-unit "1 PR"`

### cadence open

**写**

```
ccm cadence open <iter-id> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<iter-id>` | 是 | iteration id |

- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--goal <str>` | | string | 本 iteration 目标 |
| `--deadline <str>` | | ISO-8601 UTC | 截止时刻（严格 `YYYY-MM-DDTHH:MM:SSZ`） |
| `--members <a,b>` | | csv | 纳入本 iteration 的 task |
| `--set <path=val>` | | string（可重复） | 通用设 ✎ 标量（裸 path 落 board 顶层；`tasks[<id>].path` 作用于该 task） |
| `--set-json <path=json>` | | string（可重复） | 通用设 ✎ 对象/数组（scoping 同左） |

- 例：`ccm cadence open I1 --goal "ship 框架+翻译切片" --deadline 2026-06-05T14:00:00Z --members T0,T1`

### cadence ship

**写**

```
ccm cadence ship <iter-id> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<iter-id>` | 是 | iteration id |

- 行为：收口一个 iteration（成员须全 `done`+`verified`）
- flags：仅 global flags
- 例：`ccm cadence ship I1`

### cadence status

**读**

```
ccm cadence status [flags]
```

- positional：无
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 结构化输出 |

- 例：`ccm cadence status`

---

<!-- ccm:k:end point:ccm.cmd.cadence -->
<!-- ccm:k:nav:start point:ccm.cmd.cadence -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:ccm.commands.scheduling](../../../knowledge/modules/ccm.commands.scheduling.md#ccm-k-module-ccm-commands-scheduling)
- [next: namespace watchdog](./command-catalog.md#ccm-k-point-ccm-cmd-watchdog)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-ccm-cmd-watchdog"></a>
<!-- ccm:k:start point:ccm.cmd.watchdog -->
## namespace watchdog

自我唤醒 watchdog。

### watchdog arm

**写**

```
ccm watchdog arm --fire-at <str> --mechanism <cron|loop|monitor|shell> --job-id <str> [flags]
```

- positional：无
- flags：

| flag | 短名 | 类型 | enum 取值 | 必填 | 含义 |
|---|---|---|---|---|---|
| `--fire-at <str>` | | ISO-8601 UTC | | 是 | 触发时刻（严格 `YYYY-MM-DDTHH:MM:SSZ`） |
| `--mechanism <enum>` | | enum | `cron, loop, monitor, shell` | 是 | 唤醒机制（降级链） |
| `--job-id <str>` | | nonblank string | | 是 | 真实外部调度句柄；用于追踪、recon 与退役，所有 mechanism 都必填 |
| `--checklist <str>` | | string | | | 唤醒后该检查什么 |

- 例：`ccm watchdog arm --fire-at 2026-06-24T12:00:00Z --mechanism cron --job-id cron-abc --checklist "查后台 3 个 subagent"`
- 原子性：缺 `--job-id` → usage error；值为空白 → validation error；两种都不改 board，`--force` 不能越过。

### watchdog disarm

**写**

```
ccm watchdog disarm [flags]
```

- positional：无
- 行为：退役 watchdog（删除 canonical `watchdog` 与 legacy `wakeup` 整字段，结果为 ABSENT，不留 `null` / 空对象）
- flags：仅 global flags
- 例：`ccm watchdog disarm`

### watchdog status

**读**

```
ccm watchdog status [flags]
```

- positional：无
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 结构化输出 |

- 例：`ccm watchdog status`

---

<!-- ccm:k:end point:ccm.cmd.watchdog -->
<!-- ccm:k:nav:start point:ccm.cmd.watchdog -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:ccm.commands.scheduling](../../../knowledge/modules/ccm.commands.scheduling.md#ccm-k-module-ccm-commands-scheduling)
- [next: namespace agent](./command-catalog.md#ccm-k-point-ccm-cmd-agent)
- [routes_to: status 是状态机不是赋值字段](../SKILL.md#ccm-k-point-ccm-status-state-machine)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-ccm-cmd-baseline"></a>
<!-- ccm:k:start point:ccm.cmd.baseline -->
## namespace baseline

EVM 计划基线（plan baseline）：从当前 tasks 的 `estimate` + `deps` 快照成 `board.baseline`（`task_estimates` + `dag_snapshot` + `bac_h`），供 estimate 引擎算 EVM / SPI。**board 内唯一写 noun**——`usage` / `estimate` 两 namespace 纯只读，baseline 刻意置于只读之外（写关卡）。

### baseline snapshot

**写**

```
ccm baseline snapshot [flags]
```

- positional：无
- 行为：从当前 tasks 快照 `board.baseline`；**已存在则 exit 3（VALIDATION）**——用全局 `--force` 覆盖，或 `baseline reset` 移旧入 history
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--t0 <str>` | | ISO-8601 UTC | EVM 零时刻（严格 `YYYY-MM-DDTHH:MM:SSZ`；默认 now） |
| `--note <str>` | | string | 快照说明 |
| `--force` | `-f` | bool（全局） | 已有 baseline 时覆盖（否则 exit 3） |
| `--dry-run` | `-n` | bool | 试跑不落盘 |
| `--json` | | bool | 结构化输出 |

- 例：`ccm baseline snapshot --t0 2026-06-25T08:00:00Z --note "sprint 1 start"`

### baseline show

**读**

```
ccm baseline show [flags]
```

- positional：无
- 行为：只读当前 `board.baseline`；无 baseline 也 exit 0（`has_baseline:false`）
- flags：`--json`（结构化输出）
- 例：`ccm baseline show --json`

### baseline reset

**写**

```
ccm baseline reset [flags]
```

- positional：无
- 行为：re-baseline——旧 baseline 进 `history[]`（只增不删）+ 建新快照；**非 TTY 须 `--yes`**（破坏性）
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--t0 <str>` | | ISO-8601 UTC | 新基线 EVM 零时刻（默认 now） |
| `--note <str>` | | string | 重新 baseline 理由 |
| `--yes` | `-y` | bool | 非 TTY 确认（破坏性操作） |
| `--json` | | bool | 结构化输出 |

- 例：`ccm baseline reset --note "mid-sprint re-estimate" --yes`

---

## namespace policy

`board.policy.autonomous_account_switch` 是用户所有的 `allow | deny` 权限闸。`ccm policy show --json` 只读原值与 effective；`ccm policy set --autonomous-account-switch=allow|deny --user-authorized` 写入并记审计。agent 绝不自行添加 `--user-authorized`，也不把缺省 `allow` 当成应当换号的指令。

### policy show

`ccm policy show [--json]` 只读 stored policy 与 effective 值。

### policy set

`ccm policy set --autonomous-account-switch <allow|deny> --user-authorized [--json]`

`--autonomous-account-switch` 必填；非 TTY 必须由用户明确授权 `--user-authorized`。host overlay
仍可把账号切换能力收窄为永久 unsupported；policy 字段存在不等于该 host 能执行 mutation。

---

<!-- ccm:k:end point:ccm.cmd.baseline -->
<!-- ccm:k:nav:start point:ccm.cmd.baseline -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:ccm.commands.scheduling](../../../knowledge/modules/ccm.commands.scheduling.md#ccm-k-module-ccm-commands-scheduling)
- [routes_to: namespace watchdog](./command-catalog.md#ccm-k-point-ccm-cmd-watchdog)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-ccm-cmd-agent"></a>
<!-- ccm:k:start point:ccm.cmd.agent -->
## namespace agent（Agent Registry·登记/探测/读取）

运行时 agent 登记簿：凡派发皆登记——sub-agent / 后台 shell / workflow / 跨 harness CLI worker 全进本板 ✎ `agents[]` 花名册。**它是登记 / 探测 / 读取 noun**：九个 verb（create / bind / amend / link / terminal / probe / list / show / rm）不含任何 spawn / route / dispatch 语义（不起进程、不选路、不派活；dispatch 命令面归 `worker`）。其中 create / bind / terminal / probe 走生命周期状态机，`amend`（补正 handle 域）与 `rm`（删登记）是**登记簿事后修正**——不经状态机、不做状态转移。agent = 实际跑起来的运行时实例（runtime 层），与 task 的 `executor`（planning 层的计划执行者类型）分层不合并——概念与字段取值见 [board-model-guide.md §C.6](board-model-guide.md#c6-agents运行时-agent-登记簿)。

agent 生命周期状态机（写 verb 强制·同态重入幂等）：

```
starting  → running, uncertain, orphaned, terminal
running   → terminal, uncertain, orphaned
uncertain → running, terminal, orphaned
orphaned  → running, terminal
terminal  → （唯一终态·probe 永不复活）
```

本 namespace 专属 exit code 语义：`3` = 无 handle 证据 / 非法状态转移 / `link` 目标 task 不存在；`5` = agent id 不存在（**注意**：与 `task show` 的 `data:null` + exit 0 不同，`agent show` 查不到 id 直接 exit 5）。

### agent create

**写**

```
ccm agent create --type <t> --harness <h> --intent <str> [flags]
```

- positional：无
- 行为：往本板 `agents[]` append 一条登记（`lifecycle.state=starting`·`handle.kind=none`），agent id 自动生成（`agt-NNN` 递增零填充）；`account_ref` / `quota_pool_ref` 预留 `null`（只存 ref 不存数值）。返回 `agent_id`
- flags：

| flag | 短名 | 类型 | enum 取值 | 必填 | 含义 |
|---|---|---|---|---|---|
| `--type <enum>` | | enum | `cli-worker, subagent, background-shell, workflow` | 是 | agent 类型 |
| `--harness <enum>` | | enum | `codex, claude-code, cursor-agent, kimi-code, origin` | 是 | agent 所在的 runtime / transcript 语义分区。`origin` 只用于不需要具体 host transcript parser 的本 orchestrator 本地机制；要流式观察 native subagent 时按下方 host-specific 配方登记具体 harness。 |
| `--intent <str>` | | string | | 是 | 一句话：派它去干什么 |
| `--model <str>` | | string | | | 已知才填的模型（unknown 保真·缺则不填） |
| `--cwd <str>` | | string | | | agent 工作目录 |
| `--json` | | bool | | | 结构化输出（`{agent_id, agent}`） |

- 例：`ccm agent create --type cli-worker --harness codex --intent "review repo diff"` · `ccm agent create --board /abs/x.board.json --type background-shell --harness origin --intent "跑回归测试" --json`

### agent bind

**写**

```
ccm agent bind <id> --handle <kind:value> [flags]
```

- positional：`<id>`（必填）
- 行为：交真实 handle 证据，`starting→running`（`uncertain→running` / `orphaned→running` 复活、`running→running` 幂等重绑也合法——新 handle 即证据）。**无证据拒绝（exit 3）**：`kind` 必须 ∈ `session-id|pid|task-id` 且 value 非空——无真实 handle 不算 running。`terminal` 态 bind → 非法转移（exit 3·终态不复活）
- flags：

| flag | 短名 | 类型 | 必填 | 含义 |
|---|---|---|---|---|
| `--handle <kind:value>` | | string | 是 | handle 证据，`kind ∈ session-id\|pid\|task-id`，value 非空 |
| `--attach-cmd <str>` | | string | | 一键接入命令。**必须自包含**：登记的是「复制到任意 shell 都能跑」的完整命令——凡执行位置敏感的，把 `cd <工作目录> && ` 一并写进去（claude-code 是典型：`claude --resume <sid>` 必须在原 cwd 执行，session 按项目目录归档，写成 `cd /abs/worktree && claude --resume <sid>`） |
| `--transcript <str>` | | string | | transcript 路径引用（绝不内嵌内容） |
| `--json` | | bool | | 结构化输出 |

- 例：`ccm agent bind agt-001 --handle session-id:0197-abc --attach-cmd "cd /abs/worktree && codex resume 0197-abc"` · `ccm agent bind agt-002 --handle pid:48213`

**codex worker 登记配方（sid 运行时才生成·两步 bind 升级到位）**：codex 没有 claude-code 那样的 `--session-id` 预设——sid 在 worker 启动后才存在。别用凑合 handle 顶替，照这个顺序登记：

1. **派发**：`codex exec --json "<prompt>" > /abs/worker.log 2>&1 &`——`--json` 让 codex 把事件以 JSONL 打到 stdout，重定向落成日志文件。
2. **立即 bind 兜底证据**：`ccm agent bind <id> --handle pid:<pid> --transcript /abs/worker.log`——pid 立刻可探测、日志立刻可看（纯文本 fallback）。
3. **起跑后升级 bind**：日志**首行 `thread.started` 事件的 `thread_id` 就是 sid**（`head -1 /abs/worker.log` 即可提取；它与 rollout 文件名里的 sid 一致。旧版 codex 若输出的是 `session_meta` 形状，则取其 `payload.session_id`）。拿到就升级：`ccm agent bind <id> --handle session-id:<sid> --attach-cmd "cd /abs/cwd && codex resume <sid>"`——探测随之升级为会话文件 mtime（rollout 落盘于 `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<sid>.jsonl`），attach / 流定位升级为精确 rollout 源。
4. **反模式**：`codex exec resume --last` 不可作 attach 命令——它接「最近一个 session」，并行多 worker 时会接错人；shell 后台任务 id 也不是可探测的 handle（登记成 `task-id:<shell任务id>` 会让 probe 无从探测、流定位不到 rollout 文件）。精确 resume 永远是 `codex resume <sid>`。

**Claude Code in-session subagent 登记配方（Task tool 派生）**：为让 viewer 选择 Claude transcript parser，创建登记时用具体 `--harness claude-code`，handle 用 Task 返回的 `task-id:<agentId>`，并把 master 的父 session JSONL 绝对路径作为定位锚：

```bash
ccm agent create --type subagent --harness claude-code --intent "<任务摘要>"
ccm agent bind <id> --handle task-id:<agentId> --transcript <父-session.jsonl>
```

viewer 由 `<父-session.jsonl>` 派生 `<父-session-去.jsonl>/subagents/agent-<agentId>.jsonl`，并按 Claude Code JSONL 解析。**父 transcript 只作定位锚**：子文件尚未落盘时返回无源，绝不把 master 的事件冒充成子 agent；文件出现后下一轮轮询自动命中。反模式：把 agentId 登成 `session-id`、漏 `--transcript`、或直接把父 transcript 当子 transcript。

### agent amend

**写**（只改 handle 域·非状态转移）

```
ccm agent amend <id> [--handle <kind:value>] [--attach-cmd "..."] [--transcript <path>] [flags]
```

- positional：`<id>`（必填）
- 行为：事后补正已登记 agent 的 **handle 域三件套**——`handle`（kind:value）/ `attach_cmd` / `transcript_ref`，至少给一项，否则 usage 报错。**任何生命周期状态都能 amend，含 `terminal`**——因为它不是状态转移、不交证据、不复活：**绝不**触碰 `lifecycle.state` / `probe` / `links` / `intent`（要改状态仍走 `bind` / `terminal` 等既有 verb）。`--handle` 复用 `bind` 的同一套校验（`kind ∈ session-id\|pid\|task-id` 且 value 非空，坏 handle 不入登记簿）。agent id 不存在 → exit 5
- flags：

| flag | 短名 | 类型 | 必填 | 含义 |
|---|---|---|---|---|
| `--handle <kind:value>` | | string | | 补正 handle 证据（校验同 `bind`） |
| `--attach-cmd <str>` | | string | | 补正一键接入命令（同 `bind`：执行位置敏感的连 `cd` 一起写自包含） |
| `--transcript <str>` | | string | | 补正 transcript 路径引用 |
| `--json` | | bool | | 结构化输出（`{agent}`） |

- 为什么存在：坏 handle 常在 agent 已 `terminal` 后才被发现，此时 `bind` 被状态机拒（终态冻结），唯一出路曾是重复 `create` 一条新登记——**同一个真实 worker 在 roster 撕成两行**。`amend` 就是补正而不撕裂的出口。
- **心智锚**：登记后发现 handle 不完美（sid 拼错、attach 命令漏了 `cd`、transcript 路径写错），**用 `amend` 补正，绝不重复 `create` 登记**——一个真实 worker 两行 roster 是撕裂，会让花名册、viewer 与 resume 后的自己都数错在跑的 agent。
- 例：`ccm agent amend agt-001 --attach-cmd "cd /abs/worktree && codex resume 0197-abc"` · `ccm agent amend agt-002 --handle session-id:0197-fixed --transcript /abs/worker.log`

### agent link

**写**

```
ccm agent link <id> --task <task-id> [flags]
```

- positional：`<id>`（必填）
- 行为：建 agent↔task 关联，**join 存 agent 侧 `links[]`**（`{task_id, linked_at}`·非 `task.routing.attempts[]`——冻结 routing envelope 与 native-attempt dedicated writer 都不允许通用写，agent 侧 links 保持冻结合同零触碰）。**幂等**：已有指向同一 task 的 link 不重复追加（`--json` 回 `idempotent:true`）。目标 task 必须存在于本板，否则 exit 3
- flags：`--task <task-id>`（必填）· `--json`
- 例：`ccm agent link agt-001 --task T7`

### agent terminal

**写**

```
ccm agent terminal <id> --outcome <str> [flags]
```

- positional：`<id>`（必填）
- 行为：`starting/running/uncertain/orphaned → terminal`，盖 `ended_at` + 登记 `outcome`（`starting→terminal` = **启动失败收口**——spawn 失败、无 handle 可 bind 的 agent 也要能收口，别留永久僵尸；`terminal→terminal` 幂等）。**terminal ≠ task done**——本命令绝不碰 task status，父层仍须独立验收后走 `task done --verified --artifact`
- flags：`--outcome <str>`（必填·收口结论一句话）· `--json`
- 例：`ccm agent terminal agt-001 --outcome "review approved, 3 findings filed"`
- **收口是「凡派发皆登记」的对称后半段**：一个 agent 的产出被收割 / 端点验收掉（成功收工，非只 spawn 失败）后就 `terminal` 它——漏了它 agent 永停 `running`、堆成僵尸污染 recon 的 in_flight/phantom 判定。`ccm agent probe` **只判死活、永不 →terminal**，替不了这一步。批量收口：`ccm agent terminal <id>` 每次一个 id，多个 agent 就顺序 bash 背靠背跑（各自抢一次 board 锁·天然串行·零 race），别 `&` 后台并行 ccm 写。

### agent probe

**写**（仅写 `agents[]` 段）

```
ccm agent probe [<id>] [flags]
```

- positional：`<id>`（可选；缺省探测本板全体 agent）
- 行为：活性探测 + reconcile。**只写 agent 自己的 `probe` / `lifecycle` 字段，绝不碰 `task.handle` / attempt 投影**。探测手段按 handle 分级：
  - `pid` → 进程存活判定（进程在 / 存在但无权限 → `alive`；kill-0 确定进程不存在 → `gone`）；
  - `session-id` → 按 harness 的会话落盘根扫描会话文件 mtime（codex 默认 `~/.codex/sessions/**`·递归扫描 + 文件名精确匹配；claude-code 默认 `~/.claude/projects/*/<sid>.jsonl`·定向寻址；`origin` 等无会话落盘的 harness → `method=none`、`observed=unknown`）；
  - `task-id` 或 `type=subagent` → `handle.transcript_ref` 路径 mtime；无 ref → `unknown`；
  - 其余 / 无句柄 → `method=none`、`observed=unknown`（**保真**：拿不到就 unknown，绝不用相邻字段推导补齐）。
  - mtime 类观测（session-file / transcript）：mtime 在 freshness 窗内 → `alive`，在但陈旧 → `silent`；**文件不存在分两种**——上一次**同方法**观测到过 `alive`/`silent` 且本次**完整**扫描确认缺失 → `gone`（「曾在而消失」= 真死亡证据·seen-before 判死），**从未见过 → `unknown`** 不判死（启动竞态下 session 文件可能尚未落盘）；扫描不完整（目录预算耗尽 / 读取失败）不作判死证据、一律 `unknown`。
  - reconcile 双向、以观测为准、按证据强度分级：active 态（`starting/running/uncertain`）按 `gone→orphaned`、`silent→uncertain`、`alive→running`、`unknown→不变`；**`orphaned` 只被 mtime 类方法的 `alive` 复活为 `running`**（session/transcript 按 sid / 路径寻址、身份强）——`pid` 的 `alive` **不**复活 orphaned（kill-0 不验进程身份：pid 复用、存在但无权限都会产生假 alive；`uncertain` + pid `alive` 仍可回 `running`）；`terminal` 是唯一终态，probe 记录观测但永不复活。
  - reconcile 提议的转移在写盘前再过一道引擎状态机闸：不合法则该 agent 保持原态，并记入 `--json` 输出的 `reconcile_rejected`（人类输出以 `!` 行标注）
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--freshness-sec <n>` | | string | mtime 判活窗口秒（默认 300·须正数——非法值 exit 2 拒绝进入写路径，不带病判活） |
| `--json` | | bool | 结构化输出（`{probed, reconcile_rejected}`） |

- 例：`ccm agent probe agt-001` · `ccm agent probe --board /abs/x.board.json --json`

### agent list

**读**

```
ccm agent list [flags]
```

- positional：无
- 行为：只读花名册：全体 agent + 按 `lifecycle.state` 分桶计数；每行含 state / harness / type / intent / 已关联 task。**附带 stale-running advisory**：凡 active-state（非 `terminal`）agent 的 linked task **全部已 `done`**，就列为「疑似产出已收割却漏收口」候选（json 落 `stale_candidates:[{id,links}]`·human 输出末尾一条 advisory 行指名候选）。**纯只读提示、绝不自动 terminal**——收口终态判断归 orchestrator，复核后自己 `ccm agent terminal <id>`。保守判据：链非空 + 每条 link 都指向存在且 `done` 的 task 才入选（任一 link 指向不存在 / 未 done 的 task → 不提示）
- flags：`--json`（`{count, buckets, agents, stale_candidates}`）
- 例：`ccm agent list` · `ccm agent list --board /abs/x.board.json --json`

### agent show

**读**

```
ccm agent show <id> [flags]
```

- positional：`<id>`（必填；不存在 → exit 5，**不是** `data:null`）
- 行为：单 agent 钻取：record + attach 命令 + transcript 路径 + probe 观测与新鲜度 + links
- flags：`--json`（`{agent}`）
- 例：`ccm agent show agt-001 --json`

### agent rm

**写**（破坏性·删登记·非状态转移）

```
ccm agent rm <id> [--yes] [flags]
```

- positional：`<id>`（必填）
- 行为：从本板 `agents[]` 删除整条 agent 记录（该 agent 侧的 `links[]` 随记录一并消失）——重复登记 / 误登记的撕裂行的**清除**出口（与 `amend` 互补：`amend` 补正保留的那条，`rm` 删多出来的那条）。**不经状态机**（删除 ≠ 状态转移），仍走带锁 + lint 写入关卡。破坏性，语义对齐 `task rm`：**非 TTY 须 `--yes`**，否则 refuse（exit 2）；agent id 不存在 → exit 5
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--yes` | `-y` | bool | 非交互环境确认（破坏性操作·不加则 exit 2 拒绝） |
| `--json` | | bool | 结构化输出（`{removed}`；支持 `--dry-run` 预演） |

- 例：`ccm agent rm agt-003 --yes` · `ccm agent rm agt-003 --dry-run`

---

<!-- ccm:k:end point:ccm.cmd.agent -->
<!-- ccm:k:nav:start point:ccm.cmd.agent -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:ccm.commands.scheduling](../../../knowledge/modules/ccm.commands.scheduling.md#ccm-k-module-ccm-commands-scheduling)
- [next: namespace baseline](./command-catalog.md#ccm-k-point-ccm-cmd-baseline)
- [routes_to: namespace watchdog](./command-catalog.md#ccm-k-point-ccm-cmd-watchdog)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-ccm-cmd-peers-coord"></a>
<!-- ccm:k:start point:ccm.cmd.peers-coord -->
## namespace peers（协调感知·只读跨板）

多 orchestrator 协调的**感知层**：M 个 orchestrator 并行抽同一活跃配额缸，各自孤立 pacing 会公地悲剧——感知通道让每个 orchestrator 看见全体 peer 的 goal / workload / priority / 死活，喂价值感知的**独立**自我配速（不必双向协商即可单方面合理让路 / 认领 slack；通信通道**不存在**·只读感知 + 机械 fair-share floor 收口）。**纯只读跨板**——扫 `<home>/boards/` 全体板，零写、不抢 board-lock、**不需要 active board 自身**（感知是用户级跨板·同 usage/estimate）。**token-blind**：花名册只投影 goal / priority / workload / state% / liveness——**无任何 secret / token**。

> 数据源 = **只读** `<home>/boards/` 下全部 `*.board.json` 的 `owner`（active / heartbeat / session_id / harness）+ `goal` + ✎ `coordination` 块（priority + state.current/planned）。peers **绝不写任何板**。`coordination` 块由各 orchestrator 自己经 board 写命令 publish（决策点 / Stop / wake 时刷自身状态·写侧形态随 board 写命令面定），peers 只聚合读。

### peers list

**读**（别名 `ccm peers`）

```
ccm peers [list] [flags]
```

- positional：无
- 行为：扫 `<home>/boards/` 全体 **`owner.active:true` 且心跳新鲜**（`owner.heartbeat` 距 now `< freshness-sec`·默认 600s=10min·与 bootstrap `--resume` live 判活同口径）的板 → 聚成花名册：每 peer 一行 `goal` / `harness` / `priority`（缺省解析 `normal`）/ `current`（active_tasks/workload/burn_contribution）/ `planned`（remaining_work/cost_to_complete_pct）/ liveness（heartbeat + age）。`count` = M（活+新鲜板数·喂多-orch headroom/M 防过冲）。同时按 `owner.harness` 生成 `pools[]`：同 harness 才在同一竞争池；缺失或坏值降为 `unknown`，且每块 unknown board 单独成池，避免不明来源互相混排。**fail-safe**：home 不存在 / 无活板 → 空花名册（`count:0`·exit 0·退单板 pacing·不报错）；某 peer `coordination` 缺 / 字段坏 → 该维度降级（`current`/`planned` 为 `null`·`priority` 退 `normal`）·仍计入（活+新鲜即在册）
- 排序：`priority` 降序（`urgent` 先 → `trivial`）→ 心跳新→旧 → 文件名（稳定 tiebreak）
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--freshness-sec <n>` | | string | 心跳判活窗口秒（默认 600·正整数·非整数/缺则用默认） |
| `--json` | | bool | 结构化花名册（否则人类表格） |

- 例：`ccm peers` · `ccm peers --json` · `ccm peers --freshness-sec 300 --json`

---

## namespace coordination（通知收件箱）

多 orchestrator 协调的**入站通知面**：中介 / producer 把需要 agent 拍板或显式消费的建议写入本板 ✎ `coordination.inbox`，agent 读完并执行后用 `ack` 标记 consumed。写路径全走 `runWrite`：锁 → mutate → `reconcileGating` + `reconcileInbox` → lint → 原子写；过期、同 kind supersede、终态 GC 都在写关卡自动处理。`arbitrate` 已接入 deterministic pool arbiter：读取同 harness 池的活+新鲜 peer、把 usage pressure 归一成 PoolPressure，按 priority-weighted fair-share 只把**本板 own row**写入本板 inbox（从不写 peer board）。

通知 `kind` 闭集：`pacing_throttle` / `pacing_yield` / `pacing_claim` / `pacing_switch` / `pacing_stop` / `hitl_turn` / `artifact_serialize` / `quota_state_change` / `deadline_risk`（交付 DDL 风险 durable 审计条目·deadline-risk hook 直接注入 advisory 后立即 self-ack 一条）。

### coordination inbox

**读 / 写**（一个 verb 承载 `list|ack` 子动作）

```
ccm coordination inbox list [flags]
ccm coordination inbox ack <id...> [flags]
```

- positional：`list|ack`（必填）；`ack` 后跟一个或多个通知 id。
- 行为：
  - `list`：读取当前板 `coordination.inbox`；缺失 = 空 inbox；`--unconsumed` 只列未消费通知。
  - `ack`：把给定 id 从 `unconsumed` 标记为 `consumed`，写 `consumed_at`，可选写 `consumed_note`；已 consumed/expired 的 id 幂等 no-op；未知 id → exit 2。
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--unconsumed` | | bool | `list` 时只列 status=unconsumed |
| `--current-subscription` | | bool | `list` 时只按当前 session-bound subscription 精确读取；不匹配返回空 |
| `--origin <host>` | | enum | `claude-code|codex|cursor|kimi-code`；与 session / epoch 一起绑定 |
| `--session-epoch <id>` | | string | 可选当前订阅 epoch；旧 epoch fail closed |
| `--capability <id>` | | string | 精确订阅读固定为 `coordination-inbox` |
| `--note <str>` | | string | `ack` 时记录 consumed_note |
| `--json` | | bool | 结构化输出 |

- 例：`ccm coordination inbox list --unconsumed --json` · `ccm coordination inbox ack ntf-20260709T120000Z-a1b2 --note "已降档并暂停 fill-work"`

`--current-subscription` 还要求全局 `--session-id` 与可解析的精确 board；缺 `origin` / session / capability、
identity 不匹配或 epoch 已旧都返回空，不降级成宽读。

### coordination subscription

**写注册表 / 读当前精确订阅**

```
ccm coordination subscription register --origin <host> --session-id <sid> --capability coordination-inbox [flags]
ccm coordination subscription current --origin <host> --session-id <sid> --capability coordination-inbox [flags]
```

- positional：`register|current`（必填）。
- `--origin` 必填，取 `claude-code|codex|cursor|kimi-code`；`--session-id` 是全局必填 flag；
  `--capability` 当前只接受 `coordination-inbox`。board 仍按全局 `--board` / session / home 发现规则精确解析。
- `register` 对同一 `board_path + origin + capability + session_id` 幂等；新 scope 由 ccm 签发 opaque
  `subscription_id` 与 `session_epoch`。`current` 只读同一精确 identity，不创建 fallback。
- 例：`ccm coordination subscription register --origin kimi-code --session-id SID --capability coordination-inbox --board /abs/x.board.json --json --no-input`

### coordination notify

**写**（低层 append）

```
ccm coordination notify --kind <kind> --summary <str> --expires <iso> [flags]
```

- positional：无
- 行为：append 一条 `unconsumed` 通知到当前板 `coordination.inbox`。写关卡随后自动执行：过期通知转 `expired`；同一 kind 只保留最新 unconsumed，旧 unconsumed 标 `expired` 并写 `superseded_by`；终态通知按 TTL / capacity GC。此命令是低层机制面，通常由 producer / Tier2 流程调用；普通 agent 消费通知用 `inbox list|ack`。
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--kind <kind>` | | enum（必填） | 通知类型，取值见本节开头 kind 闭集 |
| `--summary <str>` | | string（必填） | 人类可读摘要 |
| `--strength <weak|strong>` | | enum | 标签协议里的 advisory strength（默认 `strong`） |
| `--payload <json>` | | JSON object string | 结构化 payload（默认 `{}`） |
| `--expires <iso>` | | ISO-8601 UTC（必填） | `expires_at`，过期后写关卡标 `expired` |
| `--json` | | bool | 结构化输出 |

- 例：`ccm coordination notify --kind pacing_yield --summary "为高优 peer 让路" --strength strong --payload '{"peer":"A"}' --expires 2026-07-09T17:00:00Z`

### coordination arbitrate

**写**（deterministic pool arbiter）

```
ccm coordination arbitrate [flags]
```

- positional：无
- 行为：运行 pool-aware allocation。流程：解析当前 board → 扫 `<home>/boards/` 的活+心跳新鲜 peer → 按 `owner.harness` 分池（只看当前板所在池）→ 读取当前 harness 的 usage signal / quota model / pollable → 归一为 `PoolPressure` → 按 priority-weighted fair-share 算每个 peer 的 row（`pacing_yield` / `pacing_claim` / `pacing_throttle` / `pacing_switch` / `pacing_stop` / `hold`）→ 只把当前 board 的 row 在命中边沿条件时 append 到**本板** `coordination.inbox`。M==1 时退化为 `ccm usage advise` 的单板 verdict 行为。边沿去重：同内容 dedup、不足冷却不刷屏；只有 band 跨越 / roster 变 / 本行目标份额 delta 超阈值 / kind 变化才追加。通知 payload 带 `producer:"coordination-arbiter"`、`dedup_key`、`pressure_band`、`roster_signature`、`target_headroom_pct`、`delta_headroom_pct`、`base_verdict` 和 own peer 摘要。
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 结构化输出（含 `mode` / `appended` / `append_reason` / `own_row` / `allocation` / `notification` / `unconsumed`） |

- 例：`ccm coordination arbitrate --json`

---

<!-- ccm:k:end point:ccm.cmd.peers-coord -->
<!-- ccm:k:nav:start point:ccm.cmd.peers-coord -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:ccm.commands.extended](../../../knowledge/modules/ccm.commands.extended.md#ccm-k-module-ccm-commands-extended)
- [next: namespace usage](./command-catalog.md#ccm-k-point-ccm-cmd-usage)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-ccm-cmd-usage"></a>
<!-- ccm:k:start point:ccm.cmd.usage -->
## namespace usage（只读 advisory）

`usage` 用全局 `--harness <target>` 下钻一个 selected target 的当前登录态；它不是 machine-wide inventory。
要一次看本机所有受支持 quota target，先用 `quota status --machine-wide`。全部 usage verb 纯 query / compute，
不写 board、不切账号、不调 WIP、不启动 worker；信号不可得时 exit 0 + `available:false`。输出携带 source、
confidence、as-of / freshness 等诚实字段，编排动作归 `master-orchestrator-guide`。

> 信号按 target 绑定：Claude Code `claude-cli` 读当前 5h + 7d，`claude-fable-*-cli` 另有不可相加的独立 7d；Codex `codex-cli` 只把当前 7d 作为
> hard pacing（实现若仍暴露 5h，只留作 ignored provenance）；Cursor `cursor-ide-plugin` 与
> `cursor-agent-cli` 各读自己的 current-login `billing_period` 与 named pools，不能跨 surface 或跨池互补；Kimi `kimi-cli` 读取当前登录态 5h + 7d，过期 stored OAuth 可先带锁自动刷新。Claude 的账号 registry snapshot
> 只是历史弱信号；Codex / Cursor / Kimi 自动换号永久禁止。任一 source 缺失都保持 `available:false`。

### usage show

**读**

```
ccm usage show [flags]
```

- positional：无
- 行为：读取 `--harness` 选中的 target 当前登录态；data 顶层 `available` 只回答当前 signal 是否可用，缺信号时
  `available:false`、exit 0。统一窗口形状在 `current.five_hour`、`current.seven_day`、
  `current.fable_seven_day`、`current.billing_period`；named pools 在 `current.pools[]`，不适用或不可得的窗口为
  `null` / 空数组。data 顶层 `agent_summary` 用一句 plain-language 给出状态 + 可执行动作，结构化动作仍看同层
  `refresh_hint`；**不存在 `data.five_hour` 等顶层窗口**。`accounts[]` 是本机 registry snapshot，不把
  `available` 点亮，也不能替代 target-local quota。
- flags：

| flag | 短名 | 类型 | 取值 | 含义 |
|---|---|---|---|---|
| `--accounts <v>` | | enum | `all`（默认）\| `current` | 列全部 registry snapshot 或只列当前号 |
| `--effective-n <n>` | | string | 正整数 | 覆写 advisory 的有效配额份数；不改变 provider 登录态，也不授权换号 |
| `--json` | | bool | | 结构化输出 |

- 例：`ccm usage show` · `ccm usage show --accounts current --json`

### usage advise

**读**

```
ccm usage advise [flags]
```

- positional：无
- 行为：读取 `--harness` 选中的 target current signal，返回单侧 `verdict`、`strength`、`levers[]`、
  `nearest_reset`、各窗口百分比与 `available`。缺信号时 `hold + available:false`。这是 advisory，不执行
  WIP、模型、账号或 dispatch 动作；Codex 只把 7d 当 hard pacing 维度，任何 5h 字段只作 ignored
  provenance；Codex、Cursor 与 Kimi 都禁止自动换号。Cursor 的 IDE / Agent quota 仍须在 machine-wide target 中分开绑定。
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--effective-n <n>` | | string | 覆写 advisory 的有效配额份数；不改变 provider 登录态，也不授权换号 |
| `--json` | | bool | 结构化输出 |

- 例：`ccm usage advise` · `ccm usage advise --effective-n 3 --json`

### usage task-cost

**读**

```
ccm usage task-cost [<task-id>] [flags]
```

- positional：`<task-id>`（可选·给则单任务模式，不给则聚合模式）
- 行为：读 board `observability.tokens`（input+output）算任务 token 成本；无 token / shell 任务 → `N/A`（`na:true`·诚实标）。聚合模式按 `--group-by` 维度合计 + `coverage_pct`（有 token 任务占比）
- flags：

| flag | 短名 | 类型 | 取值 | 含义 |
|---|---|---|---|---|
| `--group-by <v>` | | enum | `task`（默认）\| `executor` \| `type` \| `tier` | 聚合维度（无 task-id 时） |
| `--scope <v>` | | enum | `home` \| `this-repo` \| `this-board`（默认本板 observability） | 历史语料范围 |
| `--json` | | bool | | 结构化输出 |

- 例：`ccm usage task-cost T2` · `ccm usage task-cost --group-by executor --json`

### usage burn-rate

**读**

```
ccm usage burn-rate [flags]
```

- positional：无
- 行为：当前实现只投影 `five_hour` 与 `seven_day` 的窗口已逝 burn（`used% / elapsed-hours`）；信号不可得
  时相应窗口为 null / low confidence，全部缺失则 `available:false`、exit 0。Codex 只消费 `seven_day`，
  任何 5h 结果必须忽略。**当前实现尚未投影 `billing_period` burn-rate**，因此 Cursor target 会诚实降级，
  不得用空的 5h / 7d 结果伪造账期 burn。
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--as-of <str>` | | ISO-8601 UTC | as-of 时刻（backtest 回放·影响窗口已逝时间·默认 now） |
| `--json` | | bool | 结构化输出 |

- 例：`ccm usage burn-rate` · `ccm usage burn-rate --json`

### usage runway

**读**

```
ccm usage runway [flags]
```

- positional：无
- 行为：复用 burn-rate，只对 `five_hour`（90% corridor）与 `seven_day`（85% corridor）计算
  `ample | will-exhaust-before-reset | unknown`。Codex 只消费 `seven_day`。**当前实现尚未投影
  `billing_period` runway**，Cursor target 返回 unavailable / unknown；不要把它解释成 ample。
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--as-of <str>` | | ISO-8601 UTC | as-of 时刻（backtest 回放·默认 now） |
| `--json` | | bool | 结构化输出 |

- 例：`ccm usage runway` · `ccm usage runway --json`

---

<!-- ccm:k:end point:ccm.cmd.usage -->
<!-- ccm:k:nav:start point:ccm.cmd.usage -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:ccm.commands.extended](../../../knowledge/modules/ccm.commands.extended.md#ccm-k-module-ccm-commands-extended)
- [next: status-report/web-viewer/monitor/services/runtime](./command-catalog.md#ccm-k-point-ccm-cmd-ops-surfaces)
- [routes_to: namespace task 命令面](./command-catalog.md#ccm-k-point-ccm-cmd-task)
- [routes_to: status 是状态机不是赋值字段](../SKILL.md#ccm-k-point-ccm-status-state-machine)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-ccm-cmd-ops-surfaces"></a>
<!-- ccm:k:start point:ccm.cmd.ops-surfaces -->
## namespace status-report

生成式 board 状态报告。`render` 纯 stdout 计算；`write` / `show` / `watch` 只写 derived report artifact 到 `<home>/reports/status-report/boards/<board-file-stem>.status-report.json`，**不写 board JSON**。JSON schema 是 `ccm/status-report/v1`；freshness 由 board hash / topology hash / advisory hash / input hash / TTL 判定。报告 `delivery` 块列 mode 与每条 dep edge 的同源 qualification；readySet 使用注入本地 target drift/missing-object facts 的同一 evaluator。web viewer 的 Status module 读同一报告路径，DAG view-model 的 dep edge 也携带 qualification，不另造第二套交付模型。

### status-report render

**读**

```
ccm status-report render [flags]
```

- positional：无
- 行为：读取目标 board，计算报告并输出到 stdout；不写 artifact，不抢 board lock，不写 board。
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--as-of <str>` | | ISO-8601 UTC | as-of 时刻（默认 now） |
| `--max-age <dur>` | | duration | artifact TTL 计算参数（默认 `30s`；支持 `s/m/h/d`） |
| `--json` | | bool | 输出完整 `ccm/status-report/v1` envelope；否则输出人类摘要 |

- 例：`ccm status-report render --json` · `ccm status-report render --board <path>`

### status-report write

**写 report artifact，不写 board**

```
ccm status-report write [flags]
```

- positional：无
- 行为：复用 fresh artifact；缺失 / 过期 / `--force` 时重新计算并原子写 report artifact。
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--as-of <str>` | | ISO-8601 UTC | as-of 时刻（默认 now） |
| `--max-age <dur>` | | duration | artifact TTL（默认 `30s`；支持 `s/m/h/d`） |
| `--json` | | bool | 输出完整 envelope（否则只回显 artifact path） |

- 例：`ccm status-report write` · `ccm status-report write --json`

### status-report show

**读 / 按需写 report artifact，不写 board**

```
ccm status-report show [flags]
```

- positional：无
- 行为：用户入口；fresh artifact 直接读，缺失 / 过期 / `--refresh` 时刷新后显示。
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--refresh` | | bool | 忽略现有 artifact，强制刷新 |
| `--as-of <str>` | | ISO-8601 UTC | as-of 时刻（默认 now） |
| `--max-age <dur>` | | duration | artifact TTL（默认 `30s`；支持 `s/m/h/d`） |
| `--json` | | bool | 输出完整 envelope（否则输出人类摘要） |

- 例：`ccm status-report show` · `ccm status-report show --json --refresh`

### status-report watch

**前台循环写 report artifact，不写 board**

```
ccm status-report watch [flags]
```

- positional：无
- 行为：v1 是前台周期循环；每 tick 调用与 `write` 相同的 artifact 写路径。脚本 / 测试 / 一次性刷新用 `--iterations 1` 做有界 tick；没有 `--iterations` 时持续运行。
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--interval <dur>` | | duration | 刷新间隔（默认 `30s`；支持 `s/m/h/d`） |
| `--iterations <n>` | | string | 迭代次数；缺省持续运行 |
| `--as-of <str>` | | ISO-8601 UTC | as-of 时刻（默认 now） |
| `--max-age <dur>` | | duration | artifact TTL（默认 `30s`；支持 `s/m/h/d`） |
| `--json` | | bool | 每 tick 输出 artifact metadata JSON |

- 例：`ccm status-report watch --interval 30s` · `ccm status-report watch --iterations 1 --json`

---

## namespace web-viewer

本地只读 board web viewer lifecycle（别名 `ccm viewer` ≡ `ccm web-viewer`，覆盖全部子命令）。service scope 是 cc-master home，默认扫描 `<home>/boards/`；`--board` / `--goal` 只设置初始 selection，不创建 per-board service。viewer 只读、绑定 `127.0.0.1`、token-gated；状态文件在 `<home>/services/web-viewer/`，不写 board。`start` / `restart` 默认 `--port 0`（系统分配随机 ephemeral 端口，安装/升级后 reconcile 重启同样走随机端口，不写死固定值）；仅显式 `--port <n>` 才固定监听。`start` / `status` 会检查 running service 的 `server.ccm_version` 是否等于当前安装的 `ccm --version`；不匹配时 `start` 强制重启，`status --json` 暴露 `binary_match:false`。web-viewer 前端资产随 ccm 二进制内联打包，首次 `start` / `services reconcile` 会物化到 `<home>/services/web-viewer/app-dist/<ccm_version>/`；升级后 wanted 服务自动收口，**不**自动打开浏览器（用 `open` 或复制 URL）。

### web-viewer start

**写 service state，不写 board**

```
ccm web-viewer start [flags]
```

- positional：无
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--host <str>` | | string | 监听地址（v1 只允许 `127.0.0.1`） |
| `--port <n>` | | int | 监听端口（默认 `0` = 系统分配；固定端口冲突则失败） |
| `--reuse` | | bool | 复用同 home 的健康 service（默认行为） |
| `--no-open` | | bool | 只启动 / 复用，不尝试打开浏览器 |
| `--board <path>` | | string | 全局 flag：只用于初始 board selection |
| `--goal <substr>` | | string | 全局 flag：只用于初始 board selection |
| `--json` | | bool | 结构化输出（含一次性 `open_url`） |

- 例：`ccm web-viewer start` · `ccm web-viewer start --goal "Ship" --json`

### web-viewer open

**写 service state，不写 board**

```
ccm web-viewer open [id] [flags]
```

- positional：`[id]`（可选 service id）
- 行为：打开当前 home 的 viewer；默认无健康 service 时 start-then-open，CI / 无 GUI 时打印 URL。
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--no-start` | | bool | 只打开已有健康 service；不存在则不启动 |
| `--board <path>` | | string | 全局 flag：只用于初始 board selection |
| `--goal <substr>` | | string | 全局 flag：只用于初始 board selection |
| `--json` | | bool | 结构化输出（含一次性 `open_url`） |

- 例：`ccm web-viewer open` · `ccm web-viewer open --board <path>` · `ccm web-viewer open --no-start --json`

### web-viewer status

**读**

```
ccm web-viewer status [id] [flags]
```

- positional：`[id]`（可选 service id）
- 行为：显示 running / stale / stopped、pid、home、当前 selection 与脱敏 URL；不暴露 raw token。`--json` 顶层回显 `binary_match`、`running_ccm_version`、`installed_ccm_version`，用于判断服务是否还握着旧 ccm 二进制。
- flags：`--json`
- 例：`ccm web-viewer status` · `ccm web-viewer status --json`

### web-viewer stop

**写 service state，不写 board**

```
ccm web-viewer stop [id] [flags]
```

- positional：`[id]`（可选 service id）
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--all` | | bool | 停止 / 清理当前 home 下全部 viewer state |
| `--json` | | bool | 结构化输出 |

- 例：`ccm web-viewer stop` · `ccm web-viewer stop --all --json`

### web-viewer restart

**写 service state，不写 board**

```
ccm web-viewer restart [id] [flags]
```

- positional：`[id]`（可选 service id）
- 行为：停旧启新，生成新 token；`--board` / `--goal` 只影响新实例初始 selection。
- flags：`--host <str>`、`--port <n>`、`--board <path>`、`--goal <substr>`、`--json`
- 例：`ccm web-viewer restart` · `ccm web-viewer restart --board <path> --json`

### web-viewer serve

**内部 daemon target**

```
ccm web-viewer serve --state <path>
```

由 `start` 派生调用；用户通常不直接调用。

---

## namespace monitor

可选本地 monitor daemon。它是 out-of-process 连续传感层：周期性扫本机 supported harness registry，按 harness usageSource 读取 usage signal（Claude Code 读 statusline sidecar，Cursor/Codex 走 pollable source），再对 `<home>/boards/` 的 active boards 复用 `coordination arbitrate` 同一套 pool-aware arbiter / inbox API。monitor 只写 board 的 `coordination.inbox` 与自身 service state；**不**往 agent context 注入文本，不替 agent 决策。缺席时 hook 路径仍可工作。

service state 落在 `<home>/services/monitor/`：`state.json` / `pid` / `log`。`start` / `status` 会检查 running daemon 的 `server.ccm_version` 是否等于当前安装的 `ccm --version`；不匹配时 `start` 强制重启，`status --json` 暴露 `binary_match:false`。

### monitor start

**写 service state，不写 board**

```
ccm monitor start [flags]
```

- positional：无
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--interval <sec>` | | int | tick 间隔秒（默认 `45`，范围 `5..3600`） |
| `--quota-source <mode>` | | enum | `cached-only`（默认）\|`machine-wide`；后者须显式 opt-in live producer |
| `--json` | | bool | 结构化输出 |

- 例：`ccm monitor start` · `ccm monitor start --interval 30 --json`

### monitor stop

**写 service state，不写 board**

```
ccm monitor stop [flags]
```

- positional：无
- 行为：停止 daemon 并把 monitor `wanted:false`。后续 `ccm services reconcile --after-binary-replace` 不会把它重新拉起。
- flags：`--json`
- 例：`ccm monitor stop --json`

### monitor status

**读**

```
ccm monitor status [flags]
```

- positional：无
- 行为：显示 running / stale / stopped、pid、home、last_tick、last_error。`--json` 顶层回显 `binary_match`、`running_ccm_version`、`installed_ccm_version`。
- flags：`--json`
- 例：`ccm monitor status` · `ccm monitor status --json`

### monitor restart

**写 service state，不写 board**

```
ccm monitor restart [flags]
```

- positional：无
- flags：`--interval <sec>`、`--quota-source <cached-only|machine-wide>`（缺省保留现有 mode）、`--json`
- 例：`ccm monitor restart --json`

### monitor serve

**内部 daemon target**

```
ccm monitor serve --state <path>
```

由 `start` / OS service 派生调用。用户通常不直接调用。前台运行 tick loop；测试/调试可用 `--iterations <n>` 做有界 tick。

### monitor install-service

**写用户级 OS service 文件，不写 board**

```
ccm monitor install-service [flags]
```

- 行为：在 macOS 写 LaunchAgent，在 Linux 写 `systemd --user` unit，并把 monitor state 标为 `wanted:true`。不依赖 PM2。
- flags：`--interval <sec>`、`--quota-source <cached-only|machine-wide>`（默认 `cached-only`，持久化到 service）、`--json`
- 例：`ccm monitor install-service --json`

### monitor uninstall-service

**写 service state，不写 board**

```
ccm monitor uninstall-service [flags]
```

- 行为：Linux 保持既有 `systemd --user` 卸载流程。macOS 先用结构化 `launchctl bootout` 停用 LaunchAgent，再删除 plist；只有停用与删除都成功后才停止 monitor 并返回 `ok:true` / `uninstalled:true`。识别到 service `already-absent` 是幂等停用成功，但仍须把残留 plist 删除（或确认本就不存在）。真实 `bootout` 失败时返回非零、`deactivation.state:"active"`，保留 plist；`bootout` 成功但 plist 删除失败时，`deactivation.state:"inactive"` 仍保持真实，同时聚合结果返回非零、`ok:false` / `uninstalled:false` / `stopped:false`。`--json` 的 macOS 结果带三态 `deactivation.steps[].result`（`succeeded` / `already-absent` / `failed`）与 `unit_removal` 证据；不得把任一失败当成已卸载。
- flags：`--json`
- 例：`ccm monitor uninstall-service --json`

---

## namespace services

home 常驻服务 reconcile。它覆盖 `monitor` 与 `web-viewer`，用于 `ccm` 二进制被 `install.sh` 或 `ccm upgrade ccm` 替换后，把仍在跑或显式 wanted 的服务重启到新二进制。wanted 语义避免空白机升级后被动开服务：monitor wanted = 正在跑 / OS service 已装 / state.`wanted:true`；web-viewer wanted = 正在跑 / state.`wanted:true`。

### services reconcile

**写 service state，不写 board**

```
ccm services reconcile [flags]
```

- positional：无
- 行为：扫描 `<home>/services/{monitor,web-viewer}/`；只重启 wanted 服务。未 wanted 的 service state 只报告 `skip`，不会自动 start。`--after-binary-replace` 是安装/升级路径的显式标记，语义同样是 best-effort reconcile。web-viewer 重启前会把内联 frontend 资产物化到 `<home>/services/web-viewer/app-dist/<ccm_version>/`，重启后探活 `/_ccm/health` 与 `/`（非 503）；监听端口默认 `0`（系统分配随机 ephemeral，不写死）。**不**自动打开浏览器。
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--after-binary-replace` | | bool | 标记调用来自 ccm 二进制安装/替换后 |
| `--json` | | bool | 结构化输出 |

- 例：`ccm services reconcile --after-binary-replace` · `ccm services reconcile --after-binary-replace --json`

---

## namespace runtime

ccm-owned cross-harness worker runtime 的 immutable supply chain。它只管理已给出的 official ccm
artifact，不下载 release、不派 provider、不写 board、不造中央 daemon。默认 root 是
`<home>/runtimes/ccm/v1`；`current/previous` 由同一 append-only activation commit 原子表达。

当前首版支持 Linux/macOS POSIX backend。Windows 公共合同不依赖 symlink，但真实 ACL /
Authenticode / locked SEA backend gate 尚未通过，相关写 verb fail closed（`exit 3`）。

### runtime stage

**写 immutable image store；不 activation**

```text
ccm runtime stage <artifact> --provenance <file> [--json]
```

- `--provenance`（required）：`ccm/runtime-provenance/v1` JSON，包含 official repository、release
  tag、platform asset 和 SHA-256。
- 校验 non-symlink regular file、owner/security、permission、platform asset、pinned-fd hash 与
  provenance identity；成功返回 `transaction_id`、`sha256`、`image_path`、`image_ref`、
  normalized `provenance`、`reused`。
- 相同 bytes 的不同 tag/asset 不能静默复用；校验失败 `exit 3`，activation 数不增加。
- `--dry-run` 不适用于本写 verb，显式 `exit 2`；要只读解释旧安装布局，使用
  `runtime doctor --installed-path <binary> --dry-run`。

### runtime activate

**写 append-only activation commit**

```text
ccm runtime activate <transaction-id> [--json]
```

- 锁内重验 staged event、READY、exact image hash、manifest/provenance digest 与 identity。
- 成功返回 `sequence`、`transaction_id`、`current`、`previous`、`operation:"activate"`、
  `activation_path`。同一已完成 transaction 重试幂等返回原 commit。
- `CCM_RUNTIME_ACTIVATION_DISABLE=1`、aborted transaction 或坏 artifact → `exit 3`；锁冲突 →
  `exit 4`。不会覆盖或杀死已启动 image。
- `--dry-run` 不适用于本写 verb，显式 `exit 2`。

### runtime resolve

**读**

```text
ccm runtime resolve [--json]
```

返回当前 `sequence`、`transaction_id`、`sha256`、`image_path` / `image_ref`、
`activation_path` 和 `invoke_assurance`。其中 Linux 报
`exact-fd-v1/local-sha256-provenance/resistant`，Darwin 报
`path-attested-v1/local-sha256-provenance/residual`；不要把 Darwin pathname 当 exact-object。
每次读取都重验最新 commit 与 image；最新 commit 损坏时 fail closed，不静默退旧版本。无
current → `exit 5`。

### runtime invoke

**按平台声明的 assurance 启动 current image；不写 board**

```text
ccm runtime invoke [--require-assurance exact-object] -- <runtime-argv...>
```

selector 重验并固定 image fd。Linux 由 build-attested `linux-exact-fd-v1` launcher 对该 fd
直接执行；Darwin 由 build-attested `darwin-path-attested-v1` launcher 在最后一个 native handoff
内重验 pathname fd 与 pinned fd 的 vnode identity/revision、SHA-256 和权限后立即 pathname
`execve`。Darwin 内核仍会在检查后重解析 pathname，因此同 UID replacement race 是公开 residual，
不是 resistant。需要 exact-object 的调用方必须传 `--require-assurance exact-object`；Darwin 会在
创建 child 前以 `RUNTIME_INVOKE_ASSURANCE`、`exit 3` fail closed，不静默降级。两端都不把
`/dev/fd` / `/proc/self/fd` 当 executable path；后续 activation / rollback 不 hot-reload 该
invocation。launcher/backend 在 payload 执行前失败返回结构化 `RUNTIME_INVOKE_*`；成功后 handler
只透传 child exit code。该 verb 不提供 JSON envelope；`--dry-run` 显式 `exit 2`，不会启动 child。

### runtime doctor

**默认只读；`--repair` 写 append-only recovery event**

```text
ccm runtime doctor [--installed-path <legacy-binary>] [--repair] [--json]
```

- `--installed-path`：只解释现有 in-place file 的迁移计划；`mutates_source:false`、
  `preserves_home:true`，不会移动旧 binary。
- 无 `--repair`：报告 backend、current、transaction/activation 数、prepared/crash gap 和 stale lock。
  正常 staged transaction 不算 incomplete。
- `--repair`：已证 dead 的 stale installer lock 才可回收；随后重新拿 activation lock，把
  prepared-no-commit 追加为 `aborted`，把 commit-published-event-missing 追加为 `recovered`。
  live/unknown lock owner → `exit 4`，不修改 journal。
- `--dry-run` 可与默认只读 doctor / `--installed-path` 同用且不会初始化 runtime layout；
  `--repair --dry-run` 为避免伪预览显式 `exit 2`。

### runtime rollback

**写 append-only activation commit**

```text
ccm runtime rollback [--json]
```

重验 previous 后追加 `operation:"rollback"` 的新 commit：旧 previous 成为新 current，旧 current
成为新 previous。无 previous → `exit 5`；activation disable → `exit 3`。只影响新 invocation，
不删除 home/image/transaction，也不杀旧 run。
`--dry-run` 不适用于本写 verb，显式 `exit 2`。

---

<!-- ccm:k:end point:ccm.cmd.ops-surfaces -->
<!-- ccm:k:nav:start point:ccm.cmd.ops-surfaces -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:ccm.commands.extended](../../../knowledge/modules/ccm.commands.extended.md#ccm-k-module-ccm-commands-extended)
- [next: namespace estimate](./command-catalog.md#ccm-k-point-ccm-cmd-estimate)
- [routes_to: namespace usage](./command-catalog.md#ccm-k-point-ccm-cmd-usage)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-ccm-cmd-estimate"></a>
<!-- ccm:k:start point:ccm.cmd.estimate -->
## namespace estimate（只读 advisory）

工作侧只读 advisory（分解/规划 + 按时长选档）：消费 ccm 引擎的 OR/ML 算法层（双通道 Monte Carlo / EWMA 校准 / conformal 区间 / EVM+Earned Schedule / SLE / CCPM）。**纯只读**——全 verb compute、零写、不抢 board-lock。**5% 硬墙**：所有预测 `p95` = 95% 分位，**绝不算到 100%**（引擎分位口径保证·真上限是 session hard-stop）。历史语料范围由 `--scope home|this-repo|this-board`（默认 `home`·跨板多层收缩）控制。诚实降级：冷启动 / 数据不足 → 退原估值 + `low`-confidence / `no-history`。seeded 确定性：`--seed` 固定 → MC 复现（默认 42）。ccm 出区间/数据，**不替 orchestrator 决策**。

### estimate show

**读**

```
ccm estimate show [<task-id>] [flags]
```

- positional：`<task-id>`（可选·给则单任务，不给则全部 active 任务）
- 行为：每任务 raw estimate + EWMA 分层校准乘子覆写（`calibrated_h = raw × multiplier`·同 repo+type+executor+tier 多层收缩）+ conformal 区间（Mondrian 分组·快速瞥）。缺估值/无语料 → `no-history`（退原值）
- flags：

| flag | 短名 | 类型 | 取值 | 含义 |
|---|---|---|---|---|
| `--scope <v>` | | enum | `home`（默认）\| `this-repo` \| `this-board` | 历史语料范围 |
| `--as-of <str>` | | ISO-8601 UTC | | as-of 时刻（backtest 回放·默认 now） |
| `--json` | | bool | | 结构化输出 |

- 例：`ccm estimate show T6 --json` · `ccm estimate show --scope this-repo`

### estimate forecast

**读**

```
ccm estimate forecast [flags]
```

- positional：无
- 行为：双通道 Monte Carlo——① 估算-DAG-MC（依赖结构感知·log-normal·校准估值）+ ② 吞吐-MC（#NoEstimates·不依赖估值·`coverage<50%` 时主导）→ P50/P80/P95 ETA + makespan + 敏感度三件套 **CI/CRI/SSI**；①②偏差 >20% 出 consistency warning。板有 asserted/confirmed 交付 DDL 时**附 `deadline_risk` 摘要块**（相对 DDL 的 margin/风险 band·复用 `estimate deadline-risk` verdict·不重算）；无 DDL → `null`（不假绿）
- flags：

| flag | 短名 | 类型 | 取值 | 含义 |
|---|---|---|---|---|
| `--mode <v>` | | enum | `estimate` \| `throughput` \| `both`（默认） | 通道（coverage<50% 吞吐主导） |
| `--scope <v>` | | enum | `home`（默认）\| `this-repo` \| `this-board` | 历史语料范围 |
| `--as-of <str>` | | ISO-8601 UTC | | as-of 时刻（backtest·默认 now） |
| `--effective-n <n>` | | string | 正整数（默认 1） | 号池有效配额份数：N 路并行配额 → **吞吐通道② 天数 ÷N**（资源型加速）。估算-DAG 通道① 是临界路径 makespan、**不受 N 缩短**（已假设无界并行·见输出 `notes`）。回显 `effective_n` |
| `--runs <n>` | | string | | MC trials（默认 2000） |
| `--seed <n>` | | string | | PRNG 种子（复现·默认 42） |
| `--json` | | bool | | 结构化输出 |

- 例：`ccm estimate forecast --json` · `ccm estimate forecast --mode both --runs 5000 --seed 42 --json` · `ccm estimate forecast --effective-n 3 --json`

### estimate evm

**读**

```
ccm estimate evm [flags]
```

- positional：无
- 行为：EVM（PV/EV/AC → CPI/EAC/ETC/VAC）+ **Earned Schedule**（SPI(t)=ES/AT·SV(t)·IEAC(t)·全程保判别力·修 SPI($) 末期失灵）。消费 `board.baseline`——**无 baseline 降级 warn**（`has_baseline:false`·exit 0·先 `ccm baseline snapshot`）
- flags：

| flag | 短名 | 类型 | 取值 | 含义 |
|---|---|---|---|---|
| `--as-of <str>` | | ISO-8601 UTC | | as-of 时刻（默认 now） |
| `--ac-source <v>` | | enum | `duration`（实测小时·默认）\| `token`（遥测） | AC 口径 |
| `--json` | | bool | | 结构化输出 |

- 例：`ccm estimate evm --json` · `ccm estimate evm --ac-source token --as-of 2026-06-25T12:00:00Z`

### estimate velocity

**读**

```
ccm estimate velocity [flags]
```

- positional：无
- 行为：历史吞吐（tasks/day）+ backlog 清空 ETA（P50/P80/P95）+ **SLE**（cycle-time 服务水平期望 P50/P85/P95·Kanban Guide 2020）
- flags：

| flag | 短名 | 类型 | 取值 | 含义 |
|---|---|---|---|---|
| `--scope <v>` | | enum | `home`（默认）\| `this-repo` \| `this-board` | 历史语料范围 |
| `--window <n>` | | string | | 滑窗天数：只取 `finished_at` 落在最近 n 天的 done 语料喂 SLE/吞吐/velocity。**缺省（不传）→ 不过滤全语料**（`window_days` 回显 `null`）；传 n → 过滤 |
| `--as-of <str>` | | ISO-8601 UTC | | as-of 时刻（默认 now） |
| `--json` | | bool | | 结构化输出 |

- 例：`ccm estimate velocity --json` · `ccm estimate velocity --window 14`

### estimate risk

**读**

```
ccm estimate risk [flags]
```

- positional：无
- 行为：综合风险——敏感度 **CI/CRI/SSI**（MC 高临界节点）+ **WIP-aging SLE**（在飞任务 age > SLE_P85 → `at_risk`·> P95 → `critical`）+ **CCPM buffer_health**（项目缓冲绿/黄/红区）
- flags：

| flag | 短名 | 类型 | 取值 | 含义 |
|---|---|---|---|---|
| `--scope <v>` | | enum | `home`（默认）\| `this-repo` \| `this-board` | 历史语料范围 |
| `--seed <n>` | | string | | PRNG 种子（复现·默认 42） |
| `--runs <n>` | | string | | MC trials（默认 2000） |
| `--as-of <str>` | | ISO-8601 UTC | | as-of 时刻（默认 now） |
| `--json` | | bool | | 结构化输出 |

- 例：`ccm estimate risk --json` · `ccm estimate risk --scope this-repo`

### estimate cost-to-complete

**读**

```
ccm estimate cost-to-complete [flags]
```

- positional：无
- 行为：清空剩余 backlog 的总**配额%** P50/P80/P95（剩余工作 × 每单位配额%增量·throughput 式 MC·偿付力账本）——每单位 %-增量 = 账户权威 burn-rate（%/h）× 历史任务实测工期（duration-grounded·串行归因假设）；外加 **token 辅助 sizing**（`knnPredict` 预测各 backlog 任务 token·**辅助相对量计·非预算账本**，只把总% 按相对重量切到各任务）。账户 burn 不可得 → `available:false` + `cost_to_complete_pct:null`（exit 0·降级·非 exit 1）；`backlog:0` → cost `0%`。p95 = 5% 硬墙（引擎分位口径·绝不 100%）
- flags：

| flag | 短名 | 类型 | 取值 | 含义 |
|---|---|---|---|---|
| `--scope <v>` | | enum | `home`（默认·跨板多层收缩）\| `this-repo` \| `this-board` | 历史语料范围 |
| `--as-of <str>` | | ISO-8601 UTC | | as-of 时刻（backtest 回放·默认 now） |
| `--runs <n>` | | string | | MC trials（默认 2000） |
| `--seed <n>` | | string | | PRNG 种子（复现·默认 42） |
| `--json` | | bool | | 结构化输出 |

- 例：`ccm estimate cost-to-complete` · `ccm estimate cost-to-complete --scope this-repo --seed 42 --json`

### estimate deadline-risk

**读**

```
ccm estimate deadline-risk [flags]
```

- positional：无
- 行为：交付 DDL（`goal_contract.deadline`）风险 verdict——三通道 Monte Carlo 出**准时概率** `on_time_probability` + 分位 margin + 六态 `risk_band` + top drivers。三通道各司其职：**RCPSP-in-trial**（真调度当前 DAG + 吃 `scheduling.wip_limit` 资源竞争）是**唯一 verdict 源**，`on_time_probability` 只从它来；**precedence-only**（无资源闸）只作显式标注的乐观下界（喂 `forecast`/`margin` + 双通道分歧信号）；**throughput** 降为 heuristic 参考（`channels.throughput_reference`·`kind:"heuristic-reference"`）**绝不映射 verdict**。诚实降级（**绝不假绿**）：无 DDL（state ∈ `pending`/`none`/键缺失）/ 图含环 / 无有效预测 / coverage·history 太弱 / 双通道严重分歧（`> 0.25`）/ RCPSP 不可用 → `risk_band:"unknown"` + `on_time_probability:null`（**绝不退 throughput 冒充 resource-aware**）；`now ≥ DDL` 且未完成 → `overdue`（strong）。band 阈值为 **explicitly uncalibrated 保守起点**（`calibration_status:"uncalibrated-conservative"`·on_track ≥ 0.90 / at_risk < 0.65 / likely_late < 0.40·待 labeled 语料校准）。纯只读零写，hook 只搬运结果、绝不重算
- flags：

| flag | 短名 | 类型 | 取值 | 含义 |
|---|---|---|---|---|
| `--scope <v>` | | enum | `home`（默认·跨板多层收缩）\| `this-repo` \| `this-board` | 历史语料范围 |
| `--as-of <str>` | | ISO-8601 UTC | | as-of 时刻（backtest 回放·默认 now） |
| `--runs <n>` | | string | | MC trials（默认 2000·latency 降档阶梯埋好防极端大图） |
| `--seed <n>` | | string | | PRNG 种子（复现·默认 42） |
| `--effective-n <n>` | | string | | 号池有效配额份数覆写（**只缩 throughput 参考·非 verdict**） |
| `--json` | | bool | | 结构化输出 |

- 例：`ccm estimate deadline-risk --json` · `ccm estimate deadline-risk --scope this-board --seed 42 --json`

---

<!-- ccm:k:end point:ccm.cmd.estimate -->
<!-- ccm:k:nav:start point:ccm.cmd.estimate -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:ccm.commands.extended](../../../knowledge/modules/ccm.commands.extended.md#ccm-k-module-ccm-commands-extended)
- [next: namespace calibration](./command-catalog.md#ccm-k-point-ccm-cmd-calibration)
- [routes_to: namespace usage](./command-catalog.md#ccm-k-point-ccm-cmd-usage)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-ccm-cmd-calibration"></a>
<!-- ccm:k:start point:ccm.cmd.calibration -->
## namespace calibration（显式写校准语料）

### calibration capture

**写 home-level calibration store；只读 board**

```
ccm calibration capture [flags]
```

- positional：无
- 行为：复用 `estimate deadline-risk` 的同一预测计算路径，将捕获时的真实 backlog、预测 band / probability、coverage / confidence、WIP 与未回填 label 一起追加到 `<home>/calibration/deadline-snapshots.jsonl`。board 本身只读、不改窄腰字段。
- 稳定身份：`board_id` 是 canonical board 文件路径的 SHA-256 身份；同一 board 在不同采集时刻保持同一 `board_id`，避免用可变 goal / session 当实体键。
- 幂等：`snapshot_id = <board_id>@<captured_at_ms>`；同 board + 同 `--as-of` 重放不重复计数（`captured:false, duplicate:true`），不同 `--as-of` 是该 board 的新观察。无 deadline 时跳过落盘。
- 边界：本命令只采预测侧 observed snapshot；label 回填与 calibration flip 不在此命令内。`ccm estimate deadline-risk` 仍是纯只读、绝不创建 store。
- flags：

| flag | 短名 | 类型 | 取值 | 含义 |
|---|---|---|---|---|
| `--scope <v>` | | enum | `home`（默认）\| `this-repo` \| `this-board` | 历史语料范围（与 deadline-risk 同口径） |
| `--as-of <str>` | | ISO-8601 UTC | | 采集时刻；同 board+as-of 是幂等键（默认 now） |
| `--runs <n>` | | string | | MC trials（默认 2000） |
| `--seed <n>` | | string | | PRNG 种子（默认 42） |
| `--effective-n <n>` | | string | | 只缩 throughput 参考，不改 RCPSP verdict |
| `--json` | | bool | | 输出 `{captured,duplicate,dry_run,skipped_reason,store_path,snapshot}` |

- 例：`ccm calibration capture --json` · `ccm calibration capture --scope this-board --as-of 2026-07-20T12:00:00Z --json`

---

<!-- ccm:k:end point:ccm.cmd.calibration -->
<!-- ccm:k:nav:start point:ccm.cmd.calibration -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:ccm.commands.extended](../../../knowledge/modules/ccm.commands.extended.md#ccm-k-module-ccm-commands-extended)
- [next: statusline/attempt/harness/upgrade](./command-catalog.md#ccm-k-point-ccm-cmd-misc-ns)
- [routes_to: namespace usage](./command-catalog.md#ccm-k-point-ccm-cmd-usage)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-ccm-cmd-account"></a>
<!-- ccm:k:start point:ccm.cmd.account -->
## namespace account

换号号池机制（换号 token-blind 录入 / 选号 / 无重启切号）。号池 = 用户级 registry `${CC_MASTER_HOME:-$HOME/.cc_master}/accounts.json`（email→vault 非密指针 + 时间元信息·**零 token**）+ token 本体（macOS keychain / 非 mac 0600 file vault）。**token 全程活在 ccm 引擎子进程·绝不进 agent / registry / log**（vault token-blind）。换号是**无重启凭证覆写**：`switch` 续期新号 → 覆写官方共享凭证三存储 → 运行中 claude 惰性 re-read 接管（进程不重启 / board 不动）。概念叙事见 [references/account-pool.md](references/account-pool.md)；**换号决策**归 `master-orchestrator-guide`。

`account add/refresh/delete/list/switch` 是 Claude Code credential backend 的操作面；录号 / refresh 的前提是用户当前正登录在目标号。`switch` 先过 board-policy 硬闸，`deny` → exit 7，放行后选号、续期、覆写官方共享凭证并翻 registry `active`。

下面是 ccm 的精确 CLI grammar；host overlay 决定这些 verb 是可执行能力还是显式 `NotImplemented`。
当前只有 Claude Code 支持账号池 mutation，其他 host 不得因命令存在而推断支持。

### account add

`ccm account add <email> [--vault-kind keychain|file] [--vault-file <path>] [--keychain-service <name>] [--expires <iso>] [--registry <path>] [--json]`

### account refresh

`ccm account refresh <email> [--vault-kind keychain|file] [--vault-file <path>] [--keychain-service <name>] [--expires <iso>] [--registry <path>] [--json]`

### account delete

`ccm account delete <email> [--vault-kind keychain|file] [--vault-file <path>] [--keychain-service <name>] [--registry <path>] [--yes] [--json]`

破坏性；非 TTY 必须 `--yes`。

### account list

`ccm account list [--probe-keychain] [--registry <path>] [--json]`

`--probe-keychain` 只探活条目存在性，不读取 token 值。

### account switch

`ccm account switch [--email <email>|--account <email>] [--vault-kind keychain|file] [--vault-file <path>] [--keychain-service <name>] [--registry <path>] [--now <iso>] [--json]`

`--account` 是 `--email` 的旧别名；两者都跳过自动选号。所有 JSON / log / registry 输出保持 token-blind。

---

<!-- ccm:k:end point:ccm.cmd.account -->
<!-- ccm:k:nav:start point:ccm.cmd.account -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:ccm.account-pool](../../../knowledge/modules/ccm.account-pool.md#ccm-k-module-ccm-account-pool)
- [routes_to: 号池模型（指针 vs token）](./account-pool.md#ccm-k-point-ccm-account-pool-model)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-ccm-cmd-misc-ns"></a>
<!-- ccm:k:start point:ccm.cmd.misc-ns -->
## namespace statusline

> ccm **自带的 self-contained status line**（context 进度条 + 5h/7d 配额用量·按阈值变色）。这是 **Claude Code 专有安装面**：`install`/`uninstall` 写全局 `settings.json.statusLine.command`（跟随 `CLAUDE_CONFIG_DIR`），`render` 是 status-line 命令本身（高频跑·读 stdin）。**无感知自动安装**：Claude Code host 首次跑任意**非**-`statusline` ccm 命令时，ccm 会幂等、静默地把 `ccm statusline` 装进 `settings.json`。

- `ccm statusline` / `ccm statusline render`：读官方喂给 status-line 脚本的 stdin JSON，渲染单行 ANSI 状态行，同时把 `rate_limits` 落用量 sidecar。
- `ccm statusline install`：幂等写全局 `settings.json.statusLine.command`，先备份用户原有 `statusLine`。
- `ccm statusline uninstall`：从备份恢复原有 `statusLine`，并落 opt-out 标记。

---

## namespace attempt

> cross-harness managed worker 的独立本地 write-set preflight。它从 `ccm/worktree-write-lease/v1` 和本机文件系统重新解析 linked-worktree 的 `.git` gitfile、per-worktree gitdir、commondir/backlink，先只读拒绝无效 layout / lease / artifact，再只对 engine 批准的精确 roots 用真实临时文件探针验证写权限；调用方不能注入预制 facts。成功也固定返回 `launch_ready:false`，因为 trusted lease store、provider driver 权限映射和 **preflight-before-only-spawn** 的生产 dispatcher seam 尚未接入。

### attempt write-set

```bash
ccm attempt write-set \
  --lease @lease.json \
  --profile codex-managed-workspace \
  --artifact-root /absolute/declared/report/root \
  --json
```

- `--lease` 必填：JSON 字面量、`@file` 或 `-`；schema 必须是 `ccm/worktree-write-lease/v1`。当前 public CLI 只能做诊断性 preflight，caller-supplied lease **不等于** manager-trusted lease。
- `--profile` 必填：`codex-managed-workspace` 或 `claude-managed-workspace`。两者当前是 executable fixture mapping，统一编译为 `workspace-write` + 显式 roots，且硬拒 account mutation、credential read、network、push、PR、merge、release 与 undeclared path。
- `--artifact-root` / `--artifact-root-ro` 可重复；每一项都必须已由 lease 显式声明，并且不得是 symlink、逃逸或 Git metadata。
- 只接受 isolated linked worktree；main worktree、缺失/只读的 gitdir、symlink/escape、未声明 artifact 一律 exit `3`，且拒绝结果不返回任何可用 root。
- Git 授权只覆盖 worktree content、per-worktree gitdir、common objects/refs/logs；**绝不授权整个 common `.git`**。

成功 JSON 的 `data` 是 `ccm/attempt-write-set/v1`；`ok:true` 表示 preflight facts 成立，不表示 worker 已可启动。生产 dispatcher 接线完成前，`integration_status` 固定为 `preflight-only-dispatcher-missing`、`launch_ready:false`。

## namespace harness

> 本机 supported harness inventory。它回答三个不同问题：① 当前命令选择的是哪个 harness（`--harness` > `CC_MASTER_HARNESS` / 旧 host env > 自动探测 > 兼容默认）；② 这台机器上安装了哪些 ccm 已知 harness，以及它们是否支持 plugin 分发、statusline config、account pool；③ 同一品牌下哪个 execution surface 真的存在。install / upgrade 类命令应消费顶层 harness `installed`（plugin 目标语义），worker routing 才消费 `surfaces[]`；两者不可互推。

### harness list

```
ccm harness list [--json] [--machine-wide]
```

- 读所有 ccm 已知 harness 的本机安装探测结果。Claude Code 通过 `claude` CLI / Claude config dir 探测；Codex 通过 `codex` CLI / `CODEX_HOME` 或默认 config dir 探测；Cursor 分开报 `cursor-ide-plugin` (`ide-plugin`) 和 `cursor-agent` (`cli-headless`)；Kimi 通过 `kimi` CLI / `KIMI_CODE_HOME` 或默认 `~/.kimi-code` 探测。
- 顶层 harness 输出包含：`installed`、`active`、CLI 路径、config 路径、`accountPool` / `externalStatusline` / `pluginDistribution` 能力。`installed[]` 保持 plugin-target 语义：只有 `cursor-agent` 时不把 Cursor IDE 报成 installed、也不触发 IDE plugin upgrade；文本相应显式写 `plugin-target=installed|missing`，不以裸 `Cursor missing` 掩掉已安装的 headless surface。
- `surfaces[]` 是独立 descriptor：`id`、`kind`、`installed`、`available`、`binary{name,path,available}`、`configPaths`、`facts`、`admission`、`capabilities`。顶层 `installedSurfaces[]` 列已安装 surface id。`cursor-agent` 仅以可执行 binary presence 翻真（支持 `CCM_CURSOR_AGENT_BIN` / `CURSOR_AGENT_BIN`）；symlink 报 PATH 命中的入口绝对路径，非可执行文件不算。
- `cursor-agent.admission` 用 `ccm/cursor-agent-admission/v1` 独立报告 `binary.available`、`authentication.state`、`quota.state`、`sandbox`、`result_schema`、`task_acceptance`、transport termination、`schedulable` 与 blockers。inventory 未选择 mode、也不跑 provider process，所以 request 与后五项保持 unknown、必为 blocked；binary true 或 RC0 都不能推出 accepted / completed。admission evidence 只对精确 ask/plan/agent + sandbox profile 有效，任一必需项 unknown / unavailable / invalid / rejected 都不可 schedulable。
- `harnesses[].surfaces` 只读本地文件系统 / PATH，不发 provider call、不读写 credential、不 login/logout/switch。因此 Cursor surface 的 `facts.authentication` / `facts.quota` 诚实报 `state:"unknown", source:"not-probed"`；`accountMutation=forbidden`、`accountAutoswitch=unsupported`，headless `pluginDistribution=unsupported`。用户曾手工 auth 不改变这一层 presence-only inventory 声明，也不触发 Cursor/Codex 自动换号。
- 加 `--machine-wide` 时输出机器级 registry snapshot：遍历所有已知 adapter（不只当前 selected harness），保留同一份 `surfaces[]` / `installedSurfaces[]`，并为每个 harness 附上 `sessionStoreRoots`、`usageSource`（`kind` / `pollable` / `quotaModel`）和 `accountPoolLocation`；Claude Code 的 account pool 当前指向 `<CC_MASTER_HOME>/accounts.json`，Codex / Cursor / Kimi 为 `null`。
- `--machine-wide --json` 另带严格准入用的 `surfaceInventory`（`ccm/machine-surface-inventory/v1`）：Cursor IDE plugin 与 `agent|cursor-agent` headless CLI 是两个独立 descriptor；只做 `--version` / `--help` / `status --help` / `status --format json` 的只读探测，不转发 API key、不触发登录/换号/模型请求。它可以读取并净化 auth 状态，但 model、quota 等 unknown 必须保真，任一准入必需事实 unknown 都令 `eligibility.automatic=false`。Cursor Agent 的 supported-version contract 是经实测冻结的精确 allowlist，未知版本 fail closed；collector 时间窗必须覆盖当前 as-of 且 TTL 有界。`surfaceInventory` 的 UTF-8 JSON 硬上限为 4096 bytes；开放字符串发生有界投影时回显 `truncation.{applied,max_bytes,fields,fields_omitted}`，受影响 surface automatic ineligible，并保留 account/credential mutation 等负能力事实。
- flags：`--json`（结构化输出） · `--machine-wide`（机器级 registry snapshot）
- 例：`ccm harness list` · `ccm harness list --json` · `ccm harness list --machine-wide --json`

### harness current

```
ccm harness current [--json]
ccm --harness codex harness current [--json]
```

- 显示当前 selected harness 及其安装 / surface 探测。显式 `--harness` 可用于检查某个目标 harness 的能力，而不改变全局环境。
- flags：`--json`（结构化输出）

---

## namespace upgrade

> 让本机装了 ccm 的用户用 CLI 直接升级**两件解耦的发布物**：① **ccm 二进制**（per-OS Node SEA·随 GitHub `ccm-v*` 线发布）；② **cc-master 插件**（zip·随 GitHub 裸 `v*` 线发布，Claude Code 经 `claude plugin` marketplace 托管）。**非 board 操作**——不读/写 board，纯进程级动作。三 verb：`all` / `ccm` / `plugin`。
>
> **版本解析（关键坑·与 `install.sh` 同款）**：GitHub `/releases/latest` **不分前缀**——故走 `/releases` 列表 + tag 前缀过滤 + semver 排序取最新：ccm 线滤 `ccm-v*`、plugin 线滤裸 `v*` **且排除 `ccm-v*`**。某线暂无 release → 优雅报错（exit 1·不崩）。可选 `GITHUB_TOKEN`/`GH_TOKEN` 避匿名限流。
>
> **`--dry-run`（全局 flag）**：只查「当前 vs 最新」并打印计划、不真升。

### upgrade all

**写**（默认 verb：裸 `ccm upgrade` ≡ `ccm upgrade all`）

```
ccm upgrade [--json] [--harness <id>] [--all-harnesses]
ccm upgrade all [--json] [--harness <id>] [--all-harnesses]
```

- positional：无
- 行为：先升 ccm 二进制、再升插件（互不依赖·一个失败不挡另一个）；退出码取「先失败者」（都成才 `0`）。插件阶段**默认**枚举本机已安装且支持 plugin 分发的 harness 并逐个升级；`--harness` 收窄为单目标（与 `--all-harnesses` 互斥；后者现为默认行为的兼容别名）
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 结构化输出 |
| `--harness <id>` | | string | 插件升级阶段只升指定 harness（不影响 ccm 二进制自升级） |
| `--all-harnesses` | | bool | 兼容别名：插件升级默认即升本机已安装 harness；与 `--harness` 互斥 |

- 例：`ccm upgrade` · `ccm upgrade --dry-run` · `ccm upgrade --harness cursor --dry-run`

### upgrade ccm

**写**（SEA 二进制原子自替换）

```
ccm upgrade ccm [--to <ccm-v*tag>] [--json]
```

- positional：无
- 行为：探当前 SEA 自身路径（`process.execPath`）→ 下载新 `ccm-<plat>` 到同目录临时文件 → `chmod +x` → 验新二进制 `--version` 能跑 → 原子 `rename` 覆盖自身路径（macOS/Linux 运行中进程持旧 inode·覆盖安全）。成功后 best-effort 跑 `ccm services reconcile --after-binary-replace`（wanted monitor/web-viewer 停旧起新；web-viewer 物化 frontend 资产并用系统分配随机端口，不自动 open 浏览器）。**非 SEA**（node 脚本形态：dev / 全局 npm install）→ 拒绝自替换 + 清晰报错（exit 1）。未显式 `--to` 且本地核版本 ≥ 线上最新 tag 核版本 → 视为已最新、跳过（避免意外降级；ccm 二进制内部版本号与 `ccm-v*` 发布线**已解耦**，比较仅作参考门）
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--to <tag>` | | string | 指定 `ccm-v*` tag（默认线上最新·如 `ccm-v0.1.0`） |
| `--json` | | bool | 结构化输出 |

- 例：`ccm upgrade ccm` · `ccm upgrade ccm --to ccm-v0.1.0 --dry-run`

### upgrade plugin

**写**（harness-specific plugin manager）

```
ccm upgrade plugin [--to <v*tag>] [--json] [--harness <id>] [--all-harnesses]
```

- positional：无
- 行为：默认枚举本机已安装且支持 `pluginDistribution` 的 harness，并逐个执行各自 adapter 升级。Claude Code adapter shell out `claude plugin marketplace update cc-master`（best-effort）+ `claude plugin update cc-master@cc-master`。需要只升 Claude Code 时传 `--harness claude-code`；`--all-harnesses` 现为默认行为的兼容别名（与 `--harness` 互斥）。**`--to` 仅信息性**——Claude Code 的 plugin update 只能升到 marketplace 当前指向版本。
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--to <tag>` | | string | 期望的 `v*` tag（**信息性**·实际升到 marketplace 最新） |
| `--harness <id>` | | string | 只升指定 harness（与 `--all-harnesses` 互斥） |
| `--all-harnesses` | | bool | 兼容别名：默认即枚举本机已安装 harness；与 `--harness` 互斥 |
| `--json` | | bool | 结构化输出 |

- 例：`ccm upgrade plugin` · `ccm upgrade plugin --dry-run` · `ccm upgrade plugin --harness cursor --dry-run --json` · `ccm upgrade plugin --all-harnesses --dry-run --json`

---

<!-- ccm:k:end point:ccm.cmd.misc-ns -->
<!-- ccm:k:nav:start point:ccm.cmd.misc-ns -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:ccm.commands.extended](../../../knowledge/modules/ccm.commands.extended.md#ccm-k-module-ccm-commands-extended)
- [routes_to: namespace usage](./command-catalog.md#ccm-k-point-ccm-cmd-usage)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-ccm-cmd-json-shape"></a>
<!-- ccm:k:start point:ccm.cmd.json-shape -->
## --json 输出形状

通用信封：成功 `{"ok": true, "data": <below>}`，失败 `{"ok": false, "exit": N, "error": "…", "violations": []}`。以下只列 `data` 形状。

### quota status / preflight / reserve / audit

- 普通 `quota status` 的 `data` 至少含 `{schema:"ccm/quota-status/v1",available:boolean}`。
- `quota status --machine-wide` 是通用信封的明确例外：JSON 根为
  `{schema:"ccm/machine-quota-status/v1",summary:{schema:"ccm/machine-quota-summary/v1",decisions:[...]},readings:[...],capacity_views:{schema,known_capacities,unresolved_scope_digests,unresolved_capacity_units}}`。
  `decisions[]` 至少含 `scope_digest`、`target.{harness_id,surface_id,provider_id,window}`、
  `quota_scope_digest`、`state`、`freshness`、`reason_codes[]`、`source`、`decision_revision`、
  `observation_revision`、`fanout_covered`；`readings[]` 至少含 target、`used_percentage`、`resets_at`、
  `observed_at`、`valid_until` 与 `source`，unavailable / expired 时另带可选 `refresh_hint`。unknown target 仍保留，通常表现为
  `state:"unknown"`、`freshness:"unknown"`、`reason_codes:["QUOTA_SIGNAL_UNKNOWN"]` 与空 reading，而非 ample。

  ```jsonc
  { "target": { "harness_id": "cursor", "surface_id": "cursor-agent-cli",
      "bucket_id": "billing-period-usage-based", "pool_kind": "usage_based",
      "window": { "name": "billing_period_usage_based", "kind": "billing-cycle", "duration_sec": 2592000 } },
    "used_percentage": null, "resets_at": null, "observed_at": null, "valid_until": null,
    "source": { "collector_id": "cursor-agent-dashboard",
      "source_schema": "cursor/GetCurrentPeriodUsage/v1", "auth_source": "cursor-agent-current-login" },
    "refresh_hint": {
      "reason": "cursor/... quota 信号不可用", "recoverable": true,
      "command": "ccm quota status --machine-wide --refresh --json",
      "remedy": "运行 command 后重查；仍不可用则保持 unknown 并 surface 用户。",
      "recheck": "ccm quota status --machine-wide --json", "agent_authorized": true,
      "authorization": "仅授权一次只读 quota 重采集；不授权任何凭证 mutation。"
    } }
  ```

  Cursor 每个 surface 有 `billing-period-global / first_party` 与
  `billing-period-usage-based / usage_based` 两个独立 bucket；同一 pool 可经 collector 证据跨 surface 相关，
  但 first-party 与 usage-based 的 `quota_scope_digest` 永不因同一登录态而折成一个可互补容量。

  `capacity_views` 的精确对象形状：

  ```json
  {
    "schema": "ccm/machine-quota-capacity-views/v1",
    "known_capacities": [
      {
        "quota_scope_digest": "sha256:collector-proven-pool",
        "capacity_units": 1,
        "scope_digests": ["sha256:surface-a", "sha256:surface-b"]
      }
    ],
    "unresolved_scope_digests": ["sha256:surface-c"],
    "unresolved_capacity_units": null
  }
  ```

  `known_capacities[]` 只把 collector 证明拥有相同非空 `quota_scope_digest` 的 scopes 折成一个
  `capacity_units:1`；缺 correlation evidence 的 scope 留在 `unresolved_scope_digests[]`，且
  `unresolved_capacity_units` 必须为 `null`，不得假设它们是可相加的独立容量。完整 CLI status 始终返回这个对象；
  收窄的 hook / session 注入边界可以省略 `capacity_views`，该省略既不改变 CLI 合同，也不证明任何独立容量，
  需要容量视图时重新查询 `ccm quota status --machine-wide --json`。
- `quota refresh --machine-wide` 也不套通用信封；JSON 根为 `ccm/machine-quota-refresh/v1`，描述 scopes、
  deltas、deliveries、fan-out 与 checkpoint 结果。
- `quota preflight` 的 `data` 是从 authority store 重验后得到的 mechanical decision；caller 结论不进入
  authority。承重 gate 不成立时显式含 `automatic_spawn_limit:0` 与 `blocking_reasons[]`。
- `quota reserve` 的成功 `data` 含 `action:"created"`、`reservation_id`、store-derived `request_hash`、`event_ref`、
  `snapshot_ref`、event/snapshot 各自的 directory-sync receipt；同 key 幂等返回
  `action:"idempotent-existing"` 与原 receipt。
- `quota audit` 的 `data` 是 reservation transition。只有已到 TTL 的 `held` +
  confirmed-unlaunched evidence 才为 `state:"expired"`；`committed` 或 unknown evidence 返回
  `state:"orphaned"`，容量仍 counted。multi-key 的 capacity-changing transition 由 coordinator 一次发布
  全部 legs；`expired|released` 是单调 terminal，重试只返回既有 receipt，不新增 event、不复活或重占容量。

### target / delivery / dependency

- `target set`：`{target_id,target,dry_run}`；`target show`：`{target_id,target,fact}`；`target refresh`：
  `{target_id,target,revalidations,dry_run}`。
- `delivery check` 与 `dependency explain` 的 `data` 是同一 qualification 形状：

```json
{
  "state": "qualified",
  "basis": "delivery",
  "candidate_complete": true,
  "target_delivered": true,
  "target_id": "main",
  "observation_id": "D-...",
  "qualified_by": "delivery",
  "reasons": []
}
```

`state` 固定为 `qualified|unqualified|unknown`；`qualified_by` 只在 qualified 时出现。waiver 的
`qualified_by` 是 `waiver`，但 `target_delivered` 固定 false。
- `delivery audit`：`{strict_preview:true,persisted_mode:"legacy|declared",edges:[{downstream,dependency,qualification}]}`。
- `dependency require/default`：`{downstream,dependency,requirement,dry_run}`；`dependency waive`：
  `{waiver,qualification,dry_run}`。
- `task attest-delivery`：`{task_id,target_id,qualification,dry_run}`。

### board next（`ccm board next --json` / `ccm next --json`）

`data` = id 字符串数组：

```json
["T1", "T2"]
```

无 ready 任务时为 `[]`。

### board graph（`ccm board graph --json`）

```json
{
  "topoOrder": ["T1", "T2"],
  "cycle": null,
  "readySet": [],
  "criticalPath": { "chain": ["T1", "T2"], "makespan": null, "weight_source": "mixed" },
  "parallelism": { "T1": 2, "Tinf": 2, "parallelism": 1 },
  "impact": {
    "T1": { "count": 1, "descendants": ["T2"] },
    "T2": { "count": 0, "descendants": [] }
  },
  "rollup": { "owners": {}, "inconsistencies": [] },
  "nesting": { "depth1": [], "parentCycles": [] }
}
```

### board critical-path（`ccm board critical-path --json`）

`data` = graph 的 criticalPath 子对象：

```json
{ "chain": ["T1", "T2"], "makespan": null, "weight_source": "mixed" }
```

### task list（`ccm task list --json` / `ccm ls --json`）

`data` = task 摘要数组，每项：

```json
{ "id": "T1", "status": "in_flight", "type": "development", "executor": "subagent", "title": "build framework" }
```

`executor` 缺时为 `null`。

### task show（`ccm task show <id> --json`）

`data` = 该 task 的实际存在字段（稀疏——只含已设字段）：

```json
{
  "id": "T1",
  "status": "ready",
  "deps": [],
  "title": "build framework",
  "type": "development",
  "executor": "subagent",
  "handle": "sub-1",
  "estimate": { "value": 3, "unit": "h" },
  "created_at": "2026-06-25T07:07:07Z",
  "started_at": "2026-06-25T07:07:11Z"
}
```

id 不存在时 `data` = `null`，exit 0。

### board show（`ccm board show --json`）

`data` = 摘要（非整板 JSON）：

```json
{
  "goal": "catalog probe demo",
  "owner": { "active": true, "session_id": "", "heartbeat": "2026-06-25T07:07:46Z" },
  "taskCount": 2,
  "statusCounts": { "ready": 2 },
  "lint": { "ok": true, "errors": 0, "warnings": 3 }
}
```

### board init（`ccm board init --json`）

真实写入的 `data` 是 board 摘要，并额外携带实际产物路径与命令级 capability：

```json
{
  "capabilities": ["board-init/structured-board-path-v1", "goal-contract/v1"],
  "board_path": "/abs/home/boards/<generated-board-name>",
  "goal": "catalog probe demo",
  "owner": { "active": true, "session_id": "", "heartbeat": "2026-07-13T12:00:00Z" },
  "taskCount": 0,
  "statusCounts": {},
  "lint": null
}
```

示例里的 `board_path` 代表实际绝对 board artifact 路径。`ccm board init --dry-run --json`
的 `data.capabilities` 相同，但输出**不含 `data.board_path`**：dry-run 没有写出可命名的
artifact。消费者应先用 `ccm board init --capabilities --json` 做兼容性握手；该只读端点返回
`{"ok":true,"data":{"capabilities":["board-init/structured-board-path-v1","goal-contract/v1"]}}`，不解析或创建任何路径。
不得从人读 stdout 抓路径，也不得把 dry-run 当成已创建。

### board enable-contract / task planning-routing writers

- `ccm board enable-contract --preflight --json` 的 `data`：

```json
{
  "schema": "ccm/routing-contract-preflight/v1",
  "activation": "legacy",
  "ready": false,
  "tasks": [{ "task_id": "T7", "issues": [{ "code": "PLANNING-SHAPE", "path": "planning", "message": "must be an object" }] }],
  "grandfathered_terminal_task_ids": []
}
```

`activation` 只取 `legacy|enabled|invalid`。`ready:true` 才能执行写形态；写形态成功的 `data` 是 activation 后 board 摘要。
- `task set-planning --json`、`task set-routing --json`、`task route-bind --json` 的 `data` 都是写后完整 task JSON。前两者分别出现 `planning` 与初始 routing envelope；`route-bind` 还出现 `routing.selected`、append 后 `routing.attempts[]`、task `handle` 与 `status:"in_flight"`。这些 JSON 只证明 ledger 写入成功，不证明 provider spawn / liveness / parent acceptance。

### board lint（`ccm board lint --json` / `ccm lint --json`）

```json
{
  "ok": true,
  "violations": [
    { "rule": "BIZ-DEV-REFS", "level": "warn", "message": "…", "task": "T1" }
  ],
  "report": "cc-master board lint: PASS（…）\n\n[warn] …"
}
```

外层信封 `ok` 恒 true；lint 是否净看 `data.ok`（及进程 exit code，hard error 时 exit=3）。

### jc list（`ccm jc list --json`）

`data` = 数组，每项：

```json
{ "id": "J1", "status": "pending_review", "severity": "high", "category": "architecture", "summary": "test decision" }
```

### jc show（`ccm jc show <id> --json`）

`data` = 单条 jc（稀疏）：

```json
{
  "id": "J1",
  "summary": "test decision",
  "status": "pending_review",
  "category": "architecture",
  "decision": "chose A",
  "severity": "high",
  "raised_at": "2026-06-25T07:08:19Z"
}
```

### cadence status（`ccm cadence status --json`）

`data` = `{}`（无 cadence 配置时空对象；有则 `{ target, iterations… }`）。

### watchdog status（`ccm watchdog status --json`）

`data` = `null`（无 watchdog）或 watchdog 对象。对象保留原有字段，并追加派生 `health`：

```json
{
  "fire_at": "2026-06-24T12:00:00Z",
  "mechanism": "cron",
  "job_id": "cron-abc",
  "health": { "armed": true, "code": "armed" }
}
```

存量对象缺失 / 空白 `job_id` 时，`health.armed=false`、`code="missing-accountable-handle"`；
`fire_at` 已过期时 `code="expired"`。两者都附 `action`：先 `ccm watchdog disarm`，创建真实
wakeup，再带 `--job-id <handle>` 重新 arm。legacy `wakeup` 对象也按同一规则返回和诊断；读状态不改 board。

### policy show / set

`ccm policy show --json` 的 `data` 包含 `{policy,effective}`；`ccm policy set ... --json` 返回写入后的 policy。决策层只读 `.data.effective.autonomous_account_switch`，agent 不自授权。

```json
{ "policy": { "autonomous_account_switch": "deny" }, "effective": { "autonomous_account_switch": "deny" } }
```

### peers list（`ccm peers --json` / `ccm peers list --json`）

`data` = 花名册：`peers[]`（活+心跳新鲜 orchestrator 扁平视图）+ `pools[]`（按 harness 分区后的竞争池）+ `count`（=M）+ `freshness_sec`（本次判活窗口）+ `as_of`（判活基准 ISO）：

```jsonc
{
  "peers": [
    {
      "board_file": "20260629T120000Z-12345.board.json",
      "goal": "prod incident fix",
      "harness": "claude-code",              // owner.harness·缺/坏 → "unknown"
      "priority": "urgent",                 // coordination.priority·缺/坏 → "normal"
      "session_id": "s1",                   // owner.session_id（"" = 未认领活板）
      "heartbeat": "2026-06-29T11:59:00Z",
      "heartbeat_age_sec": 60,
      "current": {                          // coordination.state.current·缺 → null
        "active_tasks": 1, "workload": "hotfix", "burn_contribution": 9 },
      "planned": {                          // coordination.state.planned·缺 → null
        "remaining_work": "verify+deploy", "cost_to_complete_pct": 4 }
    }
  ],
  "pools": [
    {
      "pool_id": "claude-code",              // known harness 同池；unknown 为 "unknown:<board_file>"
      "harness": "claude-code",
      "count": 1,
      "peers": [ /* 同上 PeerEntry */ ]
    }
  ],
  "count": 1,                               // = peers.length（M·喂 headroom/M 防过冲）
  "freshness_sec": 600,                     // 本次判活心跳窗口（--freshness-sec 覆写后回显）
  "as_of": "2026-06-29T12:00:00Z"
}
```

无活+新鲜板 → `peers:[]`、`pools:[]`、`count:0`（exit 0·fail-safe 退单板）。各 peer 数字字段坏 / 人类可读字段坏 → 该字段 `null`（降级·不污染花名册）。缺失 / 非法 `owner.harness` → `harness:"unknown"` 且进入 `unknown:<board_file>` 单例池。**无任何 secret / token 字段**（token-blind）。

### coordination inbox list（`ccm coordination inbox list --json`）

`data` = `{ inbox, count }`；`--unconsumed` 后 `inbox` 只含未消费通知：

```jsonc
{
  "inbox": [
    {
      "id": "ntf-20260709T120000Z-a1b2",
      "kind": "pacing_yield",
      "status": "unconsumed",
      "created_at": "2026-07-09T12:00:00Z",
      "expires_at": "2026-07-09T17:00:00Z",
      "strength": "strong",
      "summary": "为高优 peer 让路",
      "payload": { "peer": "A" },
      "consumed_at": null,
      "consumed_note": null
    }
  ],
  "count": 1
}
```

### coordination inbox ack（`ccm coordination inbox ack <id...> --json`）

`data` = `{ acked }`，只回显本次 id 对应的通知对象；未知 id → exit 2：

```jsonc
{
  "acked": [
    {
      "id": "ntf-20260709T120000Z-a1b2",
      "kind": "pacing_yield",
      "status": "consumed",
      "created_at": "2026-07-09T12:00:00Z",
      "expires_at": "2026-07-09T17:00:00Z",
      "strength": "strong",
      "summary": "为高优 peer 让路",
      "payload": { "peer": "A" },
      "consumed_at": "2026-07-09T12:05:00Z",
      "consumed_note": "已降档并暂停 fill-work"
    }
  ]
}
```

### coordination notify（`ccm coordination notify --json`）

`data` = `{ notification }`，即 append 后的新通知对象。同 kind 已有旧 `unconsumed` 时，写关卡会把旧条目标 `expired` 并写 `superseded_by`，新条目仍为当前唯一未消费通知。

```jsonc
{
  "notification": {
    "id": "ntf-20260709T120000Z-a1b2",
    "kind": "pacing_yield",
    "status": "unconsumed",
    "created_at": "2026-07-09T12:00:00Z",
    "expires_at": "2026-07-09T17:00:00Z",
    "strength": "strong",
    "summary": "为高优 peer 让路",
    "payload": { "peer": "A" },
    "consumed_at": null,
    "consumed_note": null
  }
}
```

### coordination arbitrate（`ccm coordination arbitrate --json`）

`data` = 本板 own row + 全池 allocation 摘要 + 本次 append 结果：

```jsonc
{
  "mode": "pool",                         // "single-board" | "pool"
  "appended": 1,                           // 本次是否新写 inbox 通知
  "append_reason": "first",                // first | edge | dedup | cooldown | no-notification
  "notification": { "id": "ntf-...", "kind": "pacing_yield", "...": "..." },
  "own_row": {
    "kind": "pacing_yield",
    "notification_kind": "pacing_yield",
    "strength": "weak",
    "target_headroom_pct": 3,
    "delta_headroom_pct": -9,
    "reason": "池压力 warn，本板 burn≈12% 高于加权目标 3%…",
    "peer": { "board_file": "20260709T120000Z-a.board.json", "priority": "normal", "weight": 2 }
  },
  "allocation": {
    "pressure": { "headroom_pct": 15, "quota_model": "rolling-5h-7d", "band": "warn" },
    "base_advice": { "verdict": "throttle", "...": "..." },
    "rows": [ /* own row + sibling rows；只用于解释，不写 sibling board */ ],
    "roster_signature": "…",
    "peer_count": 2
  },
  "unconsumed": [ /* 当前本板未消费通知 */ ]
}
```

### usage show（`ccm --harness <target> usage show --json`）

```jsonc
{ "ok": true, "data": {
  "available": true, "accounts_scope": "current", "effective_n": 1,
  "agent_summary": "codex: available · 7d=18% codex=18% codex_bengalfox=0%",
  "current": {
    "source": "<adapter-source>", "available": true,
    "five_hour": null,
    "seven_day": { "used_percentage": 18, "resets_at": 1784505600 },
    "fable_seven_day": null, "billing_period": null,
    "pools": [
      { "id": "codex", "label": "Codex default", "kind": "first_party",
        "used_percentage": 18, "resets_at": 1784505600 },
      { "id": "codex_bengalfox", "label": "Codex secondary model", "kind": "first_party",
        "used_percentage": 0, "resets_at": 1784505600 }
    ],
    "captured_at": 1784200000
  },
  "accounts": [], "registry_present": false,
  "as_of": "2026-07-16T11:06:40Z", "source": "<adapter-source>", "confidence": "high",
  "refresh_hint": null
} }
```

窗口键始终位于 `data.current`；不适用 / 不可得为 `null`。`data.current.pools[]` 是可选 named-pools 扩展，
其条目含 `{id,label,kind,used_percentage,resets_at}`；Cursor 分别保留 total / Auto / API / spend-limit，Codex
分别保留 `rateLimitsByLimitId` 的模型池。兼容字段 `current.billing_period` 与 5h / 7d 字段不删除、不改语义；
Codex 即使 source 暂时暴露 `five_hour`，决策层也必须忽略它，只用 7d。不存在 `data.five_hour`、
`used_percent` / `remaining_percent` 等顶层窗口合同。`accounts[]` 只记录 registry snapshot。

`data.agent_summary` 始终是一句可独立消费的 plain-language 状态 + 动作；naive agent 应先读它，结构化判断再读
`data.current.*` 与 `data.refresh_hint`。信号可用时 `data.refresh_hint` 为 `null`；信号不可用
（`available:false`）且成因是某 harness 的短命 token
过期时，它带一个 `{reason, recoverable, command, remedy, recheck}`
对象（另含 `agent_authorized` / `authorization`）：`recoverable:true` 且 `agent_authorized:true` 时 `command` 是
让该 harness 自行刷新 token 的 agent 可执行命令、`remedy` 是「运行它 →
重跑 recheck」的完整人读步骤、`recheck` 是重新查询 usage 的命令；不可自恢复（网络 / 401 / API 变更）时
`recoverable:false` 且 `command` / `remedy` 为 `null`。Kimi collector 是窄例外：默认可在相邻锁内重读并刷新
Kimi 自己存储的 OAuth，再原子发布旋转后的 token pair；若自动刷新失败，仍返回 `kimi -p 'hi'` 的既有
harness-native hint。其他 provider 保持提示式恢复；任何路径都不把 token 放进输出。

`agent_summary` 的三类承重文案形状：available 为
`<harness>: available · 5h=<pct> 7d=<pct> ...`；已授权自恢复为
``<harness>: UNAVAILABLE (<reason>) · 你被授权运行 `<command>` 刷新后重查 · 见 refresh_hint``；网络 / API
等 opaque 故障为 `<harness>: UNAVAILABLE (<reason>) · 等待或 surface 用户 · 不可自刷 · 见 refresh_hint`。

### usage advise（`ccm usage advise --json`）

```jsonc
{ "ok": true, "data": {
  "verdict": "hold", "reason": "...", "levers": [], "strength": "weak",
  "stop_dimension": null, "nearest_reset": null,
  "window_5h_pct": null, "window_7d_pct": 18, "window_billing_period_pct": null,
  "billing_period_resets_at": null, "effective_n": 1, "switch_candidate": null,
  "confidence": "high", "source": "<adapter-source>",
  "as_of": "2026-07-16T11:06:40Z", "available": true, "refresh_hint": null
} }
```

`available:false` 时保持 `verdict:"hold"` 与低置信来源，不能解释成 ample。Claude Code 可能产生
`switch` / `stop_5h` / `stop_7d`；Codex 的有效 hard pacing 只包含 7d，Cursor 的有效 hard pacing 只包含
各自 target 的 billing period。任何 `switch_candidate` 都只是候选事实；Codex、Cursor 与 Kimi 不得自动换号。

`data.refresh_hint` 与 `usage show` 同形同义：`available:true` 时为 `null`，`available:false` 且为某
harness 短命 token 过期时带 `{reason, recoverable, command, remedy, recheck}`（`recoverable:true` 表示可按
`command` → `recheck` 手动恢复）。它是「该怎么恢复」的提示，不是「配额耗尽该停」的 `stop_*` verdict——别混淆。

### usage task-cost（`ccm usage task-cost [<id>] --json`）

单任务（给 `<task-id>`）：

```jsonc
{ "task": "T2", "scope": "this-board", "found": true,
  "tokens": { "input": 156000, "output": 39000, "total": 195000 },
  "na": false, "source": "observability", "confidence": "high" }
```

无 observability / shell → `na:true`、`tokens.total:null`；不存在 → `found:false`。

聚合（`--group-by`）：

```jsonc
{ "group_by": "executor", "scope": "this-board",
  "groups": [ { "key": "subagent", "total": 504700, "n": 7, "na_count": 3 } ],
  "total": 569500, "coverage_pct": 56, "history_n": 3,
  "source": "observability", "confidence": "medium" }
```

`--scope`（默认 `this-board`）切语料范围：`this-board` 读本板全 tasks 的 observability（含非 done → 标 N/A）；`home` / `this-repo` 跨板聚归档 done 任务的 token（`this-repo` 过滤同 repo）。回显 `scope`。

### usage burn-rate（`ccm --harness <target> usage burn-rate --json`）

```jsonc
{ "ok": true, "data": {
  "available": true,
  "five_hour": { "used_pct": 42, "resets_at": 1784217600,
    "burn_pct_per_hour": 8.4, "method": "window-elapsed", "confidence": "medium",
    "source": "<adapter-source>", "unavailable_reason": null, "harness": "<label>" },
  "seven_day": { "used_pct": 50, "resets_at": 1784764800,
    "burn_pct_per_hour": 3.1, "method": "window-elapsed", "confidence": "medium",
    "source": "<adapter-source>", "unavailable_reason": null, "harness": "<label>" },
  "source": "<adapter-source>", "as_of": "2026-07-16T11:06:40Z", "confidence": "medium",
  "refresh_hint": null
} }
```

Codex 只读 `seven_day`；Cursor billing-period 尚未进入该输出，故会返回 `available:false`，不能据此声称账期 ample。
`data.refresh_hint` 与 `usage show` 同形（`available:false` 且短命 token 过期时带
`{reason, recoverable, command, remedy, recheck}`，否则 `null`）。

### usage runway（`ccm --harness <target> usage runway --json`）

```jsonc
{ "ok": true, "data": {
  "available": true,
  "five_hour": { "used_pct": 42, "burn_pct_per_hour": 8.4,
    "remaining_corridor_pct": 48, "hours_to_ceiling": 5.71, "hours_to_reset": 4,
    "verdict": "will-exhaust-before-reset", "ceiling_pct": 90 },
  "seven_day": { "used_pct": 50, "burn_pct_per_hour": 3.1,
    "remaining_corridor_pct": 35, "hours_to_ceiling": 11.29, "hours_to_reset": 120,
    "verdict": "will-exhaust-before-reset", "ceiling_pct": 85 },
  "source": "<adapter-source>", "as_of": "2026-07-16T11:06:40Z", "confidence": "medium",
  "refresh_hint": null
} }
```

窗口不可得时对应 verdict 为 `unknown`；全部不可得时 `available:false`。Codex 忽略 5h；Cursor billing-period
尚未进入该输出，不能用 `unknown` 反推 ample。`data.refresh_hint` 与 `usage show` 同形（`available:false` 且短命
token 过期时带 `{reason, recoverable, command, remedy, recheck}`，否则 `null`）。

### estimate show（`ccm estimate show [<id>] --json`）

```jsonc
{ "scope": "home", "as_of": "ISO", "history_n": 40,
  "tasks": [ {
    "id": "T6", "raw_estimate_h": 3,
    "calibration": { "multiplier": 1.287, "source": "calibrated", "level": "type", "history_n": 23 },
    "calibrated_h": 3.86,
    "interval": { "p50": 4.83, "p80": 5.96, "p95": 10.04 },   // 5% 硬墙·单调
    "confidence": "high", "coverage_basis": "mondrian-group", "source": "calibrated"
  } ] }
```

### estimate forecast（`ccm estimate forecast --json`）

```jsonc
{ "forecast": { "p50": "ISO", "p80": "ISO", "p95": "ISO" },   // ETA·p95 = 5% 硬墙
  "makespan": { "p50": {"value":16.16,"unit":"h"}, "p80": {...}, "p95": {...} },  // throughput-only mode → null
  "throughput_days": { "p50": 4, "p80": 4, "p95": 5 },
  "criticality_index": [ {"id":"T4","criticality":0.906,"cruciality":0.713,"sensitivity":0.665} ],
  "schedule_sensitivity": [ {"id":"T4","sensitivity":0.665} ],
  "consistency": { "deviation": 0.495, "warning": true },     // ①②偏差>20% → warning
  "mode": "both", "coverage_pct": 83, "confidence": "medium", "history_n": 40,
  "scope": "home", "runs": 2000, "seed": 42, "effective_n": 1, "as_of": "ISO",
  "source": "calibrated",
  "deadline_risk": {                                          // 板有 asserted/confirmed DDL 时附·否则 null（不假绿）
    "deadline": "ISO", "deadline_state": "confirmed",
    "time_remaining_hours": 356.5, "risk_band": "at_risk", "strength": "strong",
    "on_time_probability": 0.62,
    "margin": { "p50_h": 40, "p80_h": 12.5, "p95_h": -6, "basis": "precedence-only-optimistic" } },
  //   ↑ 相对 DDL 的 margin/风险摘要（复用 `estimate deadline-risk` verdict·不重算）·margin 负=越过 DDL·
  //     无 DDL / state=none|pending → null；完整 verdict/通道/top_drivers 见 `estimate deadline-risk`
  "notes": ["1 tasks unit-time fallback…"] }   // --effective-n N>1 → throughput_days ÷N + note（通道① makespan 不变）
```

### estimate evm（`ccm estimate evm --json`）

```jsonc
{ "has_baseline": true, "baseline_captured_at": "ISO", "as_of": "ISO",
  "pv": {"value":29,"unit":"h"}, "ev": {"value":10,"unit":"h"},
  "ac": {"value":13.5,"unit":"h","source":"duration","coverage_pct":100},
  "spi": 0.345, "cpi": 0.741,
  "spi_t": 0.086, "sv_t": -69.5, "es_hours": 6.5, "at_hours": 76,   // Earned Schedule
  "eac": {"value":39.15,"unit":"h"}, "ieac_t": {"value":888.62,"unit":"h"},
  "etc": {...}, "bac": {"value":29,"unit":"h"}, "vac": {"value":-10.15,"unit":"h"},
  "confidence": "high", "warnings": [], "source": "evm-earned-schedule" }
```

无 baseline → `has_baseline:false` + `warnings:[…]`（exit 0·先 `baseline snapshot`）。

### estimate velocity（`ccm estimate velocity --json`）

```jsonc
{ "scope": "home", "window_days": null,
  "velocity_tasks_per_day": 0.6, "backlog": 6,
  "eta_days": { "p50": 4, "p80": 4, "p95": 5 },
  "sle": { "p50": 2.58, "p85": 5.6, "p95": 9.18, "unit": "h", "confidence": "high", "history_n": 40 },
  "history_n": 40, "confidence": "high", "source": "observability", "as_of": "ISO" }
// 注：`window_days` 回显**实际生效**的滑窗——不传 `--window` → `null`（不过滤）；`--window 14` → `14`（只取近 14 天 done）。
```

### estimate risk（`ccm estimate risk --json`）

```jsonc
{ "scope": "home",
  "criticality_index": [ {"id":"T4","criticality":0.906,"cruciality":0.713,"sensitivity":0.665} ],
  "wip_aging": [ {"id":"T5","age_hours":49.43,"status":"critical","sle_p85":5.6,"sle_p95":9.18} ],
  "ccpm": { "buffer_size_h": 1.97, "chain_mean_total_h": 16.61, "zone": "green",
            "buffer_health": 0.333, "chain_progress_pct": 0.333 },
  "sle": { "p85": 5.6, "p95": 9.18, "confidence": "high" },
  "history_n": 40, "confidence": "medium", "source": "calibrated",
  "as_of": "ISO", "seed": 42, "runs": 2000 }
```

### estimate cost-to-complete（`ccm estimate cost-to-complete --json`）

```jsonc
{ "cost_to_complete_pct": { "p50": 12.4, "p80": 18.9, "p95": 27.3 },  // 配额%·p95 = 5% 硬墙·burn 不可得 → null
  "mean_pct": 13.7, "backlog": 6,
  "burn_pct_per_hour": 18.4, "burn_used_pct": 92, "burn_method": "window-elapsed",
  "per_unit_samples": 23,
  "token_sizing": {                     // **辅助·非预算账本**（配额% 才是账本）
    "total_predicted_tokens": 1170000,
    "per_task": [ { "id": "T4", "predicted_tokens": 195000, "pct_share": 2.06, "knn_confidence": "medium" } ],  // 截断前 10 个 backlog 任务
    "note": "token 为派活相对 sizing（辅助·knnPredict.predictedTokens）·配额% 才是预算账本" },
  "scope": "home", "runs": 2000, "seed": 42, "as_of": "ISO",
  "source": "calibrated",               // burn 不可得 → "local-derived-approx" + available:false
  "confidence": "medium", "available": true, "history_n": 40,
  "notes": ["per-unit %-cost = burn-rate × 历史任务工期（假设串行归因…）"] }
```

账户 burn 不可得 → `available:false`、`cost_to_complete_pct:null`、`mean_pct:null`（exit 0·降级）；`backlog:0` → cost `0%`。`token_sizing` 是辅助相对量计（非预算账本）。

### estimate deadline-risk（`ccm estimate deadline-risk --json`）

```jsonc
{ "deadline": "2026-08-01T09:00:00Z",         // goal_contract.deadline.at（state∈asserted/confirmed 时·否则 null）
  "deadline_state": "confirmed",               // pending | asserted | confirmed | none
  "as_of": "ISO", "time_remaining_hours": 356.5,  // (deadline − as_of)/3600000·无已确认/断言 DDL → null
  "on_time_probability": 0.82,                 // P(finish ≤ DDL)·**只来自 RCPSP-in-trial**·unknown → null
  "on_time_probability_source": "rcpsp-in-trial",  // 恒 "rcpsp-in-trial" | "unknown"（throughput 永不做源）
  "forecast": { "p50":"ISO","p80":"ISO","p95":"ISO", "basis":"precedence-only-optimistic" },  // 乐观下界口径·null=不可算
  "margin":   { "p50_h":40.0,"p80_h":12.5,"p95_h":-6.0, "basis":"precedence-only-optimistic" },  // DDL − forecast_pX·负=越过
  "risk_band": "watch",                        // on_track | watch | at_risk | likely_late | overdue | unknown
  "strength": "weak",                          // 注入力度·watch/on_track/unknown=weak·at_risk/likely_late/overdue=strong
  "channels": {
    "precedence_only": { "role":"optimistic-bound", "on_time_probability":0.90,
                         "makespan_p50_h":120.0,"makespan_p80_h":160.0,"makespan_p95_h":210.0 },  // 无资源闸·乐观下界·null=含环/空
    "resource_aware":  { "on_time_probability":0.70, "source":"rcpsp-in-trial", "wip":16, "runs":2000,
                         "makespan_p50_h":140.0,"makespan_p80_h":180.0,"makespan_p95_h":220.0 },  // verdict 源·RCPSP 不可用 → null
    "throughput_reference": { "kind":"heuristic-reference", "note":"历史吞吐采样·非 DAG 资源调度·不作 verdict",
                              "on_time_probability_heuristic":0.55, "days_p50":15.0,"days_p80":20.0,"days_p95":27.0,
                              "confidence":"high" } },  // **绝不映射 on_track**·仅旁证·null=无吞吐历史
  "channel_disagreement": 0.20,                // |P_precedence − P_rcpsp|·> 0.25 → 禁无条件 on_track（降 watch）·null=不可算
  "coverage_pct": 60, "confidence": "high",    // low coverage/history → confidence 降级 → on_track 降 unknown（不假绿）
  "history_n": 42, "scope": "home",
  "calibration_status": "uncalibrated-conservative",  // 阈值未经经验校准·保守起点（诚实·恒此值）
  "top_drivers": [                             // 先动哪里·reason ∈ critical | sensitive | blocked
    { "id":"T4", "criticality":0.906, "sensitivity":0.718, "reason":"critical" },
    { "id":"T9", "reason":"blocked", "detail":"blocked_on:user" } ],
  "runs": 2000, "rcpsp_runs": 2000,            // rcpsp_runs < runs = latency 降档；0 = RCPSP 被禁用（→ unknown）
  "seed": 42, "source": "calibrated",          // history_n>0 → "calibrated" 否则 "estimate"
  "notes": ["…诚实降级从句…"] }
```

诚实降级（**绝不假绿**）：无 DDL / 含环 / 无估值 / 低置信 / 双通道分歧 > 0.25 / RCPSP 不可用 → `risk_band:"unknown"` + `on_time_probability:null`（**绝不退 throughput 冒充 resource-aware**）；`now ≥ DDL` 且未完成 → `overdue`（strong）。`on_time_probability_source` 恒为 `rcpsp-in-trial` 或 `unknown`——throughput 通道永不做 verdict 源。band 阈值 `uncalibrated-conservative`（未经经验校准的保守起点）。
<!-- ccm:k:end point:ccm.cmd.json-shape -->
<!-- ccm:k:nav:start point:ccm.cmd.json-shape -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:ccm.commands.core](../../../knowledge/modules/ccm.commands.core.md#ccm-k-module-ccm-commands-core)
- [routes_to: namespace task 命令面](./command-catalog.md#ccm-k-point-ccm-cmd-task)
<!-- ccm:k:nav:end -->
