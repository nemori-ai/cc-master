# ccm 命令面机械参考（command catalog）

> 纯机械参考：命令、positional、flag、例子、`--json` 形状、exit code。状态机转移语义、字段三档纪律、`--set` 用法判断等判断型内容见 SKILL.md，本文不复述。
> 基准版本：`ccm 0.10.0`。

## 目录（TOC）

- [顶层结构](#顶层结构)
  - [Namespaces](#namespaces)
  - [Aliases](#aliases)
  - [Reserved（占位·暂未实现）](#reserved占位暂未实现)
  - [Global flags](#global-flags)
  - [Exit codes](#exit-codes)
  - [JSON 信封](#json-信封)
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
- [namespace task](#namespace-task)
  - [task add](#task-add)
  - [task show](#task-show)
  - [task list](#task-list)
  - [task update](#task-update)
  - [task start](#task-start)
  - [task done](#task-done)
  - [task block](#task-block)
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
- [namespace peers（COORD 感知·只读跨板）](#namespace-peerscoord-感知只读跨板)
  - [peers list](#peers-list)
- [namespace usage（只读 advisory）](#namespace-usage只读-advisory)
  - [usage show](#usage-show)
  - [usage advise](#usage-advise)
  - [usage task-cost](#usage-task-cost)
  - [usage burn-rate](#usage-burn-rate)
  - [usage runway](#usage-runway)
- [namespace estimate（只读 advisory）](#namespace-estimate只读-advisory)
  - [estimate show](#estimate-show)
  - [estimate forecast](#estimate-forecast)
  - [estimate evm](#estimate-evm)
  - [estimate velocity](#estimate-velocity)
  - [estimate risk](#estimate-risk)
  - [estimate cost-to-complete](#estimate-cost-to-complete)
- [namespace statusline](#namespace-statusline)
  - [statusline render](#statusline-render)
  - [statusline install](#statusline-install)
  - [statusline uninstall](#statusline-uninstall)
- [--json 输出形状](#--json-输出形状)

---

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
| `board` | 板级：查看 / 校验 / DAG 分析 / 建板 / 改配置 |
| `task` | 任务：增删改查 + 状态机（DAG 节点） |
| `log` | append-only 审计轨迹 |
| `jc` | judgment_calls 自决诚实台账 |
| `cadence` | 节奏 / iteration 收口 |
| `watchdog` | 自我唤醒 watchdog（ADR-011） |
| `baseline` | EVM 计划基线快照（estimate 引擎的 plan SSOT·board 内唯一写 noun·ADR-015） |
| `policy` | board 级 orchestrator 自主权限开关（首条 `autonomous_account_switch`·写 noun·用户所有·ADR-016） |
| `peers` | 多 orchestrator 协调**感知层**：跨板只读花名册（全体活+心跳新鲜 orchestrator 的 goal/workload/priority/liveness·COORD） |
| `usage` | 配额侧**只读 advisory**：当前号/备号 5h/7d 用量 + 双侧走廊 pacing verdict + 任务 token 成本（ADR-015） |
| `estimate` | 工作侧**只读 advisory**：双通道 MC 工期预测 / EVM / velocity / 风险（消费 OR/ML 引擎·ADR-015） |
| `account` | 换号号池机制：备号 OAuth token 录入 / 选号 / 无重启切号（vault token-blind·**switch 读 board.policy·`deny`→exit 7**·ADR-016） |

### Aliases

| alias | 等价于 |
|---|---|
| `ccm next` | `ccm board next` |
| `ccm lint` | `ccm board lint` |
| `ccm ls` | `ccm task list` |
| `ccm peers` | `ccm peers list` |

（另：`task list` / `jc list` / `log list` 自身有子命令别名 `ls`，即 `ccm task ls` / `ccm jc ls` / `ccm log ls`。）

### Global flags

所有命令通用。

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--board <path>` | | string | 指定 board 文件（最高优先） |
| `--session-id <id>` | | string | 指定 session（特权调用者注入；默认读 `$CLAUDE_CODE_SESSION_ID`） |
| `--home <dir>` | | string | 指定 cc-master home（默认 `$CC_MASTER_HOME` → `CLAUDE_PROJECT_DIR` → 向上 walk） |
| `--goal <substr>` | | string | 多 active 板时按 goal 子串消歧（**例外**：`board update` / `board init` / `cadence open` 把 `--goal` 当 payload〔设 goal〕、**不**当发现过滤器——这三个 verb 的发现忽略 `--goal`，无歧义即命中唯一/未认领板·Finding #77） |
| `--json` | | bool | 机器可读 JSON 输出（非 TTY 时默认开） |
| `--dry-run` | `-n` | bool | 预览：跑完整校验但不落盘 |
| `--force` | `-f` | bool | 越过 hard error / 非法状态转移闸（记 log） |
| `--yes` | `-y` | bool | 跳过破坏性操作的确认（非交互） |
| `--quiet` | `-q` | bool | 只出错误 |
| `--verbose` | `-v` | bool | 详细输出（诊断走 stderr） |
| `--no-color` | | bool | 禁用颜色（亦遵循 NO_COLOR / 非 TTY / TERM=dumb） |
| `--no-input` | | bool | 绝不交互提示（脚本 / agent 模式） |
| `--set <p>=<v>` | | string（可重复） | 通用设 ✎ 标量字段（仅写命令；🔒 字段不可） |
| `--set-json <p>=<j>` | | string（可重复） | 通用设 ✎ 对象/数组（仅写命令；兜长尾 + 前向兼容） |
| `--help` | `-h` | bool | 显示帮助 |
| `--version` | | bool | 显示版本 |

接受 `--set` / `--set-json` 的写命令实测为：`task add`、`task update`、`jc add`、`cadence update`、`cadence open`。`board update` 不接（只接其具名 flag）。

### Exit codes

| code | 含义 |
|---|---|
| `0` | 成功 |
| `1` | 未预期错 |
| `2` | 用法错（缺必填 arg / 未知 flag 等） |
| `3` | 校验拒绝（lint hard error / 非法状态转移 / `--set` 命中 🔒 字段） |
| `4` | 锁超时 |
| `5` | 无 active board |

### JSON 信封

- 成功：`{"ok": true, "data": <payload>}`
- 失败：`{"ok": false, "exit": <code>, "error": "<msg>", "violations": [...]}`

`data` 形状随命令而变，见 [--json 输出形状](#--json-输出形状)。

---

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
| `--goal <str>` | | string | 空串 | 初始 goal |

- 例：`ccm board init --goal "试验性编排"`
- 产物：`<home>/<YYYYMMDDThhmmssZ>-<pid>.board.json`

### board update

**写**

```
ccm board update [flags]
```

- positional：无
- flags（不接 `--set` / `--set-json`）：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--goal <str>` | | string | 重定 goal |
| `--wip-limit <str>` | | int | `scheduling.wip_limit`（并发软上限） |
| `--owner-wip <str>` | | int | `scheduling.owner_wip_limit` |
| `--branch <str>` | | string | `git.branch` |
| `--worktree <str>` | | string | `git.worktree` |
| `--priority <enum>` | | enum `urgent\|high\|normal\|low\|trivial` | `coordination.priority`（板级优先级·COORD 裁决主轴·非法值 → exit 2） |

- 例：`ccm board update --goal "v0.10.0 收尾"` · `ccm board update --wip-limit 4 --branch board-v2-redesign` · `ccm board update --priority high`
- `--priority` 写 ✎ `coordination.priority`（板级优先级·`ccm peers` 跨板花名册的裁决主轴 + 机械 fair-share 权重源；缺/坏 → 解析为 `normal`）。枚举校验在 update 端（坏值 exit 2·不静默写非法值）；它是 agent-shaped ✎ 字段（hook 不读·非窄腰·红线 2 不破）。init 时用户给的板级优先级经此落盘（命令体 bootstrap 段指导 orchestrator 捕获并记入）。
- 发现：`--goal` 在此是 payload（重定 goal），**不**当发现过滤器——所有 flag 走同一条两层匹配（精确 sid → 未认领 `session_id:""` 兜底），与 `task add` 等一致；隐式发现（无 `--board`）在 `ccm board init` 建的未认领板上对 `--goal` 与 `--wip-limit` **行为一致**（Finding #77 修复前 `--goal` 会假报 NotFound）。多 active 板时用 `--board <path>` 消歧。

### board archive

**写**（归档板·翻 `owner.active=false`·带锁·停用即休眠·显式可逆）

```
ccm board archive [flags]
```

- positional：无
- 行为：经引擎**带锁**把 `owner.active` 翻 `false`（停用即休眠·全套 hook 对它休眠）；**非破坏**——`tasks`/`log`/`goal`/`git` 全留（审计留痕·文件不删）。给 `/cc-master:stop`、`/cc-master:handoff-to-new-session` 一条**走单写者带锁管线**的归档路径，替代手编辑 board JSON 翻 active（手编辑与 Stop hook 带锁写并发会 torn-write·ADR-020）。幂等：已 `false` 再 archive 仍 `false`（无副作用）。日后可经 `ccm`/`as-master-orchestrator --resume` 复活（ADR-009）。孤儿 / rollup 检查归调用方（命令体在归档前做）。
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 结构化输出（返回归档后 board 摘要） |
| `--dry-run` | `-n` | bool | 预览：跑完整校验但不落盘（owner.active 仍 true） |

- 例：`ccm board archive` · `ccm board archive --board <path>` · `ccm board archive --dry-run`

### board set-param

**写**（hook-owned 参数区·ADR-020·least-privilege·带锁）

```
ccm board set-param <key> <value> [flags]
```

- positional：`<key>`（必填·**白名单**：当前 `last_identity_remind`、`last_critpath_remind`）、`<value>`（必填·按 key 声明类型校验）
- 作用域**收窄到 `board.runtime.<白名单 key>`**——非白名单 key / 非法值 → `exit 2`（Usage）；**绝不触碰 🔒/👁 窄腰**。
- 主要使用者是周期 hook（IDNUDGE 写 `runtime.last_identity_remind`、critpath-nudge 写 `runtime.last_critpath_remind`）经进程边界 spawn 写 ISO-8601 UTC 时间戳；agent 也可经它写参数区。走 `runWrite` 带锁管线（与所有写 verb 同口径·刷 `owner.heartbeat`）。
- flags：`--json`（结构化输出 `{ok,data:{runtime}}`）；`--dry-run` 跑完整校验不落盘。
- 值类型：`last_identity_remind` / `last_critpath_remind` 均须严格 ISO-8601 UTC（`YYYY-MM-DDTHH:MM:SSZ`），否则 `exit 2`。
- 例：`ccm board set-param last_identity_remind 2026-06-29T12:34:56Z` · `ccm board set-param last_critpath_remind 2026-06-30T08:00:00Z --board <path>`

---

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
| `--handle <str>` | | string | | | 后台句柄（subagent/workflow 必给） |
| `--deps <a,b>` | | csv | | `[]` | 依赖（逗号分隔） |
| `--parent <str>` | | string | | 缺=顶层 | 归属 owner 节点（嵌套 depth=1） |
| `--estimate <dur>` | | duration | `3h`/`90m`/`2d`/`1w` | | 估时 |
| `--ref <kind:ref>` | | string（可重复） | kind ∈ refKind 开放枚举 | | 引用 `kind:ref` |
| `--accept <str\|@file>` | | string/@file | | | 验收：一句话 DoD 或 `@file` |
| `--role <enum>` | | enum | `normal, fill-work` | `normal` | 调度角色 |
| `--justification <str>` | | string | | | 决策理由 |
| `--status <enum>` | | enum | status 枚举（见 board show data） | `ready` | 初始 status |
| `--verified` | | bool | | false | 标记已验收 |
| `--artifact <str>` | | string | | | 产物链接 |
| `--wip-limit <str>` | | int | | | 本 task WIP 覆写 |
| `--set <path=val>` | | string（可重复） | | | 通用设 ✎ 标量 |
| `--set-json <path=json>` | | string（可重复） | | | 通用设 ✎ 对象/数组 |
| `--log <str>` | | string | | | 同时追一条 log |

- 例：`ccm task add T7 --type development --deps T1 --estimate 3h` · `ccm task add EXT3 --executor external --ref issue:https://github.com/o/r/issues/9`

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
| `--set <path=val>` | | string（可重复） | | 通用设 ✎ 标量 |
| `--set-json <path=json>` | | string（可重复） | | 通用设 ✎ 对象/数组 |
| `--log <str>` | | string | | 同时追一条 log |

- 例：`ccm task update T7 --estimate 5h --add-dep T2` · `ccm task update T7 --rm-dep T2 --verified --artifact /abs/out.md`
- 注：`update` 无 `--deps`（用 `--add-dep` / `--rm-dep`）、无 `--status`（用 start / done / block / set-status）。

### task start

**写**

```
ccm task start <id> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | task id |

- 行为：→ `in_flight`·盖 `started_at`
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--log <str>` | | string | 同时追一条 log |

- 例：`ccm task start T7`

### task done

**写**

```
ccm task done <id> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<id>` | 是 | task id |

- 行为：→ `done`·盖 `finished_at`
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--artifact <str>` | | string | 产物链接（绝对路径 / URL） |
| `--verified` | | bool | 标记已端点验收 |
| `--log <str>` | | string | 同时追一条 log |

- 例：`ccm task done T7 --artifact /abs/out.md --verified`

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

## namespace jc

judgment_calls 自决诚实台账。

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
| `--set <path=val>` | | string（可重复） | | 通用设 ✎ 标量 |
| `--set-json <path=json>` | | string（可重复） | | 通用设 ✎ 对象/数组 |

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
| `--set <path=val>` | | string（可重复） | 通用设 ✎ 标量 |
| `--set-json <path=json>` | | string（可重复） | 通用设 ✎ 对象/数组 |

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
| `--set <path=val>` | | string（可重复） | 通用设 ✎ 标量 |
| `--set-json <path=json>` | | string（可重复） | 通用设 ✎ 对象/数组 |

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

## namespace watchdog

自我唤醒 watchdog（ADR-011）。

### watchdog arm

**写**

```
ccm watchdog arm --fire-at <str> --mechanism <cron|loop|monitor|shell> [flags]
```

- positional：无
- flags：

| flag | 短名 | 类型 | enum 取值 | 必填 | 含义 |
|---|---|---|---|---|---|
| `--fire-at <str>` | | ISO-8601 UTC | | 是 | 触发时刻（严格 `YYYY-MM-DDTHH:MM:SSZ`） |
| `--mechanism <enum>` | | enum | `cron, loop, monitor, shell` | 是 | 唤醒机制（降级链） |
| `--job-id <str>` | | string | | | 外部调度句柄（便于 disarm 清理） |
| `--checklist <str>` | | string | | | 唤醒后该检查什么 |

- 例：`ccm watchdog arm --fire-at 2026-06-24T12:00:00Z --mechanism cron --checklist "查后台 3 个 subagent"`

### watchdog disarm

**写**

```
ccm watchdog disarm [flags]
```

- positional：无
- 行为：退役 watchdog（删整对象·不留残骸）
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

## namespace baseline

EVM 计划基线（plan baseline·ADR-015）：从当前 tasks 的 `estimate` + `deps` 快照成 `board.baseline`（`task_estimates` + `dag_snapshot` + `bac_h`），供 estimate 引擎算 EVM / SPI。**board 内唯一写 noun**——`usage` / `estimate` 两 namespace 纯只读，baseline 刻意置于只读之外（写关卡）。

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

board 级 orchestrator 自主权限（ADR-016）：`board.policy` 是框定本块板 master-orchestrator 自主权限的可扩展对象，首条键 `autonomous_account_switch`（`allow`/`deny`）门控**是否允许 orchestrator 自主换号**。**写 noun**——`set` 改 board 状态，刻意置于只读 namespace 之外（同 baseline 定位）。policy 写**视权限为用户所有**（self-grant 防护）：非 TTY 须显式 `--user-authorized` 才能写。缺省 / 缺字段一律解析为 `allow`（向后兼容旧板）。

### policy show

**读**

```
ccm policy show [flags]
```

- positional：无
- 行为：只读当前 active board 的 `policy` + 解析后的 `effective` 有效值（缺省 `autonomous_account_switch=allow`）；无 policy 段也 exit 0
- flags：`--json`（结构化输出）
- 例：`ccm policy show` · `ccm policy show --json`

### policy set

**写**

```
ccm policy set --autonomous-account-switch=allow|deny [flags]
```

- positional：无
- 行为：设 `board.policy.autonomous_account_switch`；append 一条 `decision` 到 board.log（记 旧值→新值 + 是否 user-authorized·供审计）。**非 TTY 无 `--user-authorized` → exit 2（USAGE·授权闸）**——policy 为用户所有，agent 在非交互上下文不得自授权
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--autonomous-account-switch <v>` | | enum（必填） | `allow`（允许自主换号）\| `deny`（禁止自主换号） |
| `--user-authorized` | | bool | 非 TTY 时显式授权（破坏性授权操作·缺则 exit 2） |
| `--json` | | bool | 结构化输出 |

- 例：`ccm policy set --autonomous-account-switch=deny --user-authorized`（锁死本板自主换号）
- ⚠️ **绝不自授权**：orchestrator-agent 绝不自己加 `--user-authorized` 翻 policy（那是 self-grant·越权）——该标记只由用户给（决策纪律见 orchestrating-to-completion）。机制硬闸侧：`ccm account switch` 在覆写凭证前也读 `policy.autonomous_account_switch`、`deny` 即拒并 exit 7（纵深防御兜底·见 namespace account）

---

## namespace peers（COORD 感知·只读跨板）

多 orchestrator 协调的**感知层**（COORD）：M 个 orchestrator 并行抽同一活跃配额缸，各自孤立 pacing 会公地悲剧——感知通道让每个 orchestrator 看见全体 peer 的 goal / workload / priority / 死活，喂价值感知的**独立**自我配速（不必双向协商即可单方面合理让路 / 认领 slack；通信通道**不存在**·只读感知 + 机械 fair-share floor 收口）。**纯只读跨板**——扫 `<home>/boards/` 全体板，零写、不抢 board-lock、**不需要 active board 自身**（感知是用户级跨板·同 usage/estimate）。**token-blind**：花名册只投影 goal / priority / workload / state% / liveness——**无任何 secret / token**。

> 数据源 = **只读** `<home>/boards/` 下全部 `*.board.json` 的 `owner`（active / heartbeat / session_id）+ `goal` + ✎ `coordination` 块（priority + state.current/planned）。peers **绝不写任何板**。`coordination` 块由各 orchestrator 自己经 board 写命令 publish（决策点 / Stop / wake 时刷自身状态·写侧形态随 board 写命令面定），peers 只聚合读。

### peers list

**读**（别名 `ccm peers`）

```
ccm peers [list] [flags]
```

- positional：无
- 行为：扫 `<home>/boards/` 全体 **`owner.active:true` 且心跳新鲜**（`owner.heartbeat` 距 now `< freshness-sec`·默认 600s=10min·与 bootstrap `--resume` live 判活同口径）的板 → 聚成花名册：每 peer 一行 `goal` / `priority`（缺省解析 `normal`）/ `current`（active_tasks/workload/burn_contribution）/ `planned`（remaining_work/cost_to_complete_pct）/ liveness（heartbeat + age）。`count` = M（活+新鲜板数·喂多-orch headroom/M 防过冲）。**fail-safe**：home 不存在 / 无活板 → 空花名册（`count:0`·exit 0·退单板 pacing·不报错）；某 peer `coordination` 缺 / 字段坏 → 该维度降级（`current`/`planned` 为 `null`·`priority` 退 `normal`）·仍计入（活+新鲜即在册）
- 排序：`priority` 降序（`urgent` 先 → `trivial`）→ 心跳新→旧 → 文件名（稳定 tiebreak）
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--freshness-sec <n>` | | string | 心跳判活窗口秒（默认 600·正整数·非整数/缺则用默认） |
| `--json` | | bool | 结构化花名册（否则人类表格） |

- 例：`ccm peers` · `ccm peers --json` · `ccm peers --freshness-sec 300 --json`

---

## namespace usage（只读 advisory）

配额侧只读 advisory（ADR-015·charter ②控制 token 消耗速度 + ⑤资源下最大化效率）：当前号/备号用量 + 双侧走廊 pacing verdict + 任务 token 成本。**纯只读**——全 verb query/compute，零写、不抢 board-lock、不落状态（与 `baseline`/`policy` 这俩写 noun 相反）。诚实降级：账户信号不可得 = **exit 0 + `data.available:false`**（非 exit 1）；无 `accounts.json` registry → 天然单账号·`effective_n=1`（不报错）。诚实字段贯穿：`source`（account / registry-snapshot / observability / local-derived-approx）/ `confidence`（high/medium/low）/ `as_of` / `snapshot_stale` / `coverage_pct`。ccm 出 verdict/数据，**不替 orchestrator 决策**（真动作归 SKILL A·红线3）。

> 备号数据 = **只读** `${CC_MASTER_HOME:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/cc-master}/accounts.json` registry 的生命周期快照（每号取 `last_observed_quota`/`last_switch_out`/`switch_history[]` 里 `at` 最大那条）——usage **绝不写 registry、绝不碰 token**（registry 写/管归 ccm `account` 引擎·概念见 account-pool.md）。当前号 5h/7d 用量读 status-line sidecar（`${CC_MASTER_RATE_CACHE:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.cc-master-rate-limits.json}`·路径跟随 `CLAUDE_CONFIG_DIR`（默认 `~/.claude`）·ccm 自带的 `ccm statusline`（自动安装）写、cc-usage.sh / usage-pacing.js hook 同读·账户权威·Finding #37），缺则 `available:false` 降级。

### usage show

**读**

```
ccm usage show [flags]
```

- positional：无
- 行为：列当前号（account 权威 sidecar）+ 全备号 5h/7d `used%`/`resets_at`（备号 = registry 生命周期快照·标 `as_of`/`snapshot_stale`）；无 sidecar/registry → 优雅降级（`available:false`·exit 0）
- flags：

| flag | 短名 | 类型 | 取值 | 含义 |
|---|---|---|---|---|
| `--accounts <v>` | | enum | `all`（含备号·默认）\| `current`（仅当前号） | 列哪些账号 |
| `--effective-n <n>` | | string | 正整数 | 号池有效配额份数覆写（默认从 registry 算） |
| `--json` | | bool | | 结构化输出 |

- 例：`ccm usage show` · `ccm usage show --accounts current --json`

### usage advise

**读**

```
ccm usage advise [flags]
```

- positional：无
- 行为：双侧走廊 pacing verdict（`throttle` 临界减速 \| `accelerate` 欠用/切号加速 \| `hold` 走廊内 \| `hard_stop` 7d 硬总闸）+ 推荐 lever 类 + `switch_candidate`（号池 verdict 含切号 lever 时·选可切备号里 7d `used%` 最低的）。收口 usage-pacing 双侧走廊数学（引擎 `pacingAdvice` SSOT·ADR-010）。sidecar 缺 → `hold` + `available:false`（降级）
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--effective-n <n>` | | string | 号池有效配额份数覆写（默认从 registry 算·影响欠用判定线 + 切号触发） |
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

- 例：`ccm usage task-cost C2` · `ccm usage task-cost --group-by executor --json`

### usage burn-rate

**读**

```
ccm usage burn-rate [flags]
```

- positional：无
- 行为：当前号 5h + 7d 各算一个配额%-burn-rate（Δused%/Δtime·账户权威·`window-elapsed` = 已用% ÷ 窗口已逝小时·%/h）；读 status-line sidecar（账户权威·Finding #37），信号不可得 → `available:false`（exit 0·诚实降级·非 exit 1）。`burn_pct_per_hour` 不可算 → `null`
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
- 行为：剩余走廊空间 ÷ burn-rate → 距触顶 vs 距 reset 的小时数（偿付力 headroom）；5h 走廊上界 `90`%（临界阈）、7d 上界 `85`%（硬总闸）；`verdict` ∈ `ample`（reset 先于触顶·会先回血）\| `will-exhaust-before-reset`（触顶先于 reset·偿付力吃紧）\| `unknown`（数据不足）。信号缺 → `available:false`（exit 0·降级）
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--as-of <str>` | | ISO-8601 UTC | as-of 时刻（backtest 回放·默认 now） |
| `--json` | | bool | 结构化输出 |

- 例：`ccm usage runway` · `ccm usage runway --json`

---

## namespace estimate（只读 advisory）

工作侧只读 advisory（ADR-015·charter ④分解/规划 + ⑥按时长选档）：消费 `@ccm/engine` 的 OR/ML 算法层（双通道 Monte Carlo / EWMA 校准 / conformal 区间 / EVM+Earned Schedule / SLE / CCPM）。**纯只读**——全 verb compute、零写、不抢 board-lock。**5% 硬墙**：所有预测 `p95` = 95% 分位，**绝不算到 100%**（引擎分位口径保证·真上限是 session hard-stop）。历史语料范围由 `--scope home|this-repo|this-board`（默认 `home`·跨板多层收缩）控制。诚实降级：冷启动 / 数据不足 → 退原估值 + `low`-confidence / `no-history`。seeded 确定性：`--seed` 固定 → MC 复现（默认 42）。ccm 出区间/数据，**不替 orchestrator 决策**（红线3）。

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

- 例：`ccm estimate show C6 --json` · `ccm estimate show --scope this-repo`

### estimate forecast

**读**

```
ccm estimate forecast [flags]
```

- positional：无
- 行为：双通道 Monte Carlo——① 估算-DAG-MC（依赖结构感知·log-normal·校准估值）+ ② 吞吐-MC（#NoEstimates·不依赖估值·`coverage<50%` 时主导）→ P50/P80/P95 ETA + makespan + 敏感度三件套 **CI/CRI/SSI**；①②偏差 >20% 出 consistency warning
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

---

## namespace account

换号号池机制（ADR-016·换号 token-blind 录入 / 选号 / 无重启切号）。号池 = 用户级 registry `${CC_MASTER_HOME:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/cc-master}/accounts.json`（email→vault 非密指针 + 时间元信息·**零 token**）+ token 本体（macOS keychain / 非 mac 0600 file vault）。**token 全程活在 ccm 引擎子进程·绝不进 agent / registry / log**（vault token-blind）。换号是**无重启凭证覆写**：`switch` 续期新号 → 覆写官方共享凭证三存储 → 运行中 claude 惰性 re-read 接管（进程不重启 / board 不动）。**概念叙事**（号池模型 / 录号 why / refreshToken 硬要求 / 选号方法论 / vault 安全）见 [references/account-pool.md](references/account-pool.md)；**算法 / vault 实现 SSOT** 在 ccm 引擎 `@ccm/engine/account`；**换号决策**（何时换 / 谁拍板 / 绝不自授权）归 `orchestrating-to-completion`（不在本 skill）。

> **录号 / refresh 的唯一前提：用户当前正登录在目标号**（引擎从 keychain「Claude Code-credentials」直读当前登录号完整 blob·身份 guard 要求当前登录 email == `<email>`，否则拒）。

### account add

**写**（录入备号 token 进号池·幂等 upsert）

```
ccm account add <email> [flags]
```

- positional：`<email>`（必填·账号唯一标识）
- 行为：从 keychain「Claude Code-credentials」(`account=$USER`) 直读当前登录号完整 `claudeAiOauth` blob（含 refreshToken）→ 身份 guard（当前登录 email 须 == `<email>`）→ 校验三必需字段（accessToken `sk-ant-oat` / **refreshToken `sk-ant-ort`·非空** / expiresAt num）→ 存 vault → 写 registry entry（非密元信息·`active:true`）。非 mac 无 keychain → 降级读 `${CLAUDE_CONFIG_DIR:-~/.claude}/.credentials.json` 的 `.claudeAiOauth`
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--vault-kind <v>` | | enum | `keychain`（mac 默认）\| `file`（0600 文件 floor） |
| `--vault-file <path>` | | string | file 形态的 vault 路径（默认 `${CC_MASTER_HOME}/accounts.env`） |
| `--keychain-service <s>` | | string | keychain service 名（默认 `cc-master-oauth`） |
| `--expires <iso>` | | ISO-8601 UTC | token 到期日（file 形态非密旁存·默认 now+365d） |
| `--registry <path>` | | string | registry 文件路径（默认 `${CC_MASTER_HOME}/accounts.json`） |
| `--json` | | bool | 结构化输出（非密结果·零 token） |

- 例：`ccm account add alice@x.com` · `ccm account add bob@x.com --vault-kind file --json`
- ⚠️ refreshToken 硬要求：取不到非空 refreshToken → FAIL（绝不存残缺 blob）。只有真 `/login` 走完整 OAuth 才在 keychain 写非空 refreshToken；`claude setup-token` 结构上不产生 refreshToken（换不进·见 account-pool.md）

### account refresh

**写**（续期某备号 token·= 对同一 email 重跑 add 的安全路）

```
ccm account refresh <email> [flags]
```

- positional：`<email>`（必填）
- 行为：与 `add` 完全同路（幂等 upsert）——keychain `-U` 原地更新 / file 删旧行再 append / registry 保留首次 `token_added_at`、刷 `token_refreshed_at`/`token_expires_at`。前提同 add（用户当前登录在 `<email>`）
- flags：同 `account add`（`--vault-kind` / `--vault-file` / `--keychain-service` / `--expires` / `--registry` / `--json`）
- 例：`ccm account refresh alice@x.com`

### account delete

**写**（把备号从号池删干净·registry entry + vault token）

```
ccm account delete <email> [flags]
```

- positional：`<email>`（必填）
- 行为：从 registry entry 推断 vault 形态删对地方（token-blind·按 email 前缀删·不读值）→ 删 registry entry（删 active 号要清 active）
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--vault-kind <v>` | | enum | 推断不出时显式指定（`keychain` \| `file`） |
| `--vault-file <path>` | | string | file vault 路径 |
| `--keychain-service <s>` | | string | keychain service 名 |
| `--registry <path>` | | string | registry 文件路径 |
| `--yes` | `-y` | bool | **非 TTY 必带**——跳过破坏性删除确认（非交互上下文无 `--yes` → exit 2） |
| `--json` | | bool | 结构化输出 |

- 例：`ccm account delete bob@x.com --yes`

### account list

**读**（只读对账·绝不取 token 值）

```
ccm account list [flags]
```

- positional：无
- 行为：只读 registry 非密字段——列每个 email 的 vault 形态 / 到期日 / active / 是否过期 / 距各窗口 reset 推算。**绝不取 token**（keychain 探活只用 `find`、不带 `-w`）。空池 / 无 registry → 提示「天然单账号空池」
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--probe-keychain` | | bool | 顺带核对 keychain 项是否真在（只 `find`·不取值） |
| `--registry <path>` | | string | registry 文件路径 |
| `--json` | | bool | 结构化输出 |

- 例：`ccm account list` · `ccm account list --probe-keychain --json`

### account switch

**写**（无重启切到选定备号·**ADR-016 policy 硬闸**）

```
ccm account switch [flags]
```

- positional：无（不给 `--email` → 引擎按各号配额恢复度选最优切入号）
- 行为：**先过 board-policy 硬闸**——读目标 board 的 `policy.autonomous_account_switch`，显式 `deny` → 拒绝本次换号、**exit 7**（policy-deny·不取换号锁 / 不覆写任何凭证 / registry 原封不动）+ best-effort 往 board.log 记一条 `decision`。放行后：选号 → refreshToken 续期 → 覆写官方共享凭证三存储（原子写·全或无回滚）→ 翻 registry `active`。**fail-open/closed**：真·无 ccm 上下文（无 `--board`/`$CC_MASTER_BOARD`）→ fail-open `allow`；有明确目标板但 policy 读不到 / 歧义 → fail-closed `deny`（exit 7）
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--email <addr>` | | string | 指定切入号（别名 `--account`·旧名兼容）；不给则引擎选最优 |
| `--vault-kind <v>` | | enum | `keychain` \| `file` |
| `--vault-file <path>` | | string | file vault 路径 |
| `--keychain-service <s>` | | string | keychain service 名 |
| `--registry <path>` | | string | registry 文件路径 |
| `--now <iso>` | | ISO-8601 UTC | 选号推算的 now（确定性测试·默认真实 now） |
| `--json` | | bool | 结构化输出 |

- 例：`ccm account switch --json`（引擎选号）· `ccm account switch --email alice@x.com`
- ⚠️ **policy 硬闸是纵深防御兜底、不是许可**：`deny`→exit 7 拦在覆写之前；编排侧的「换号决策 + 绝不自授权」纪律在 `orchestrating-to-completion`（机制硬闸不替编排拍板）。全员逼顶 / 选不出号 → surface 用户（`blocked_on:"user"`），绝不盲切

---

## namespace statusline

> ccm **自带的 self-contained status line**（context 进度条 + 5h/7d 配额用量·按阈值变色）。**非 board 操作**——不读/写 board，写的是**全局** `settings.json`（跟随 `CLAUDE_CONFIG_DIR`）。`render` 是 status-line 命令本身（高频跑·读 stdin），`install`/`uninstall` 管它进/出 `settings.json`。**无感知自动安装**：首次跑任意**非**-`statusline` ccm 命令时，ccm 会幂等、静默地把 `ccm statusline` 装进 `settings.json`（marker 守·`CC_MASTER_NO_AUTOINSTALL=1` 或 `ccm statusline uninstall` 的 opt-out 标记即关）。

### statusline render

```
ccm statusline           # = 默认 verb·status-line 命令本身（settings.json 里写的就是这条）
ccm statusline render
```

- 读官方喂给 status-line 脚本的 **stdin JSON**（`context_window.used_percentage`〔0–100·首条消息前 null〕· `rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}`〔均 Optional〕· `model.display_name`），渲染**单行 ANSI** 状态行到 stdout（context 进度条 10 格 + 5h/7d 用量·绿/黄/红按阈值·缺段优雅省略），**同时**把 `rate_limits` 落用量 sidecar（`${CC_MASTER_RATE_CACHE:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.cc-master-rate-limits.json}`·账户权威 pacing 信号源）
- **铁律**：任何失败 / 缺字段一律静默 **exit 0**、绝不污染 UI（`NO_COLOR` / `--no-color` 关色·否则默认上色，非 TTY 也上）
- 阈值：context 绿<60 黄60–85 红>85 · 5h 绿<70 黄70–90 红>90 · 7d 绿<70 黄70–85 红>85
- 你**通常不手动跑这条**——它由 Claude Code 当 status line 自动调用

### statusline install

```
ccm statusline install [--json]
```

- 幂等把 `ccm statusline`（**绝对路径**·绕过 `${CLAUDE_PLUGIN_ROOT}` 在 statusLine.command 不展开的 Finding #39）写进**全局** `settings.json` 的 `statusLine`；**你原有的 `statusLine` 先备份**（单独 state 文件·不污染 settings schema），`ccm statusline uninstall` 可恢复。已是 ours → noop / 仅更新命令。**显式 install 会清除 opt-out 标记**（用户改主意）
- settings.json 坏 JSON → **绝不覆写**（避免毁配置）+ exit 1
- flags：`--json`（结构化输出 `{action, settingsPath, backedUp, command}`）

### statusline uninstall

```
ccm statusline uninstall [--json]
```

- 从备份**恢复**你原有的 `statusLine`（无备份则删该字段）+ 落 **opt-out 标记**让无感知自动安装不再覆盖回去（不跟用户较劲）
- flags：`--json`（结构化输出）

---

## --json 输出形状

通用信封：成功 `{"ok": true, "data": <below>}`，失败 `{"ok": false, "exit": N, "error": "…", "violations": []}`。以下只列 `data` 形状。

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

`data` = `null`（无 watchdog）或 watchdog 对象。

### policy show（`ccm policy show --json`）

`data` = `{ policy, effective }`——`policy` 是 board 上的原始对象（无 policy 段 → `null`），`effective` 是解析后的有效值（缺省补 `allow`）：

```json
{
  "policy": { "autonomous_account_switch": "deny" },
  "effective": { "autonomous_account_switch": "deny" }
}
```

机制硬闸 / 编排建议层读 `.data.effective.autonomous_account_switch`（钉死路径）。

### policy set（`ccm policy set --json`）

`data` = `{ policy }`（写入后的 policy 对象）：

```json
{ "policy": { "autonomous_account_switch": "deny" } }
```

### peers list（`ccm peers --json` / `ccm peers list --json`）

`data` = 花名册：`peers[]`（活+心跳新鲜 orchestrator）+ `count`（=M）+ `freshness_sec`（本次判活窗口）+ `as_of`（判活基准 ISO）：

```jsonc
{
  "peers": [
    {
      "board_file": "20260629T120000Z-12345.board.json",
      "goal": "prod incident fix",
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
  "count": 1,                               // = peers.length（M·喂 headroom/M 防过冲）
  "freshness_sec": 600,                     // 本次判活心跳窗口（--freshness-sec 覆写后回显）
  "as_of": "2026-06-29T12:00:00Z"
}
```

无活+新鲜板 → `peers:[]`、`count:0`（exit 0·fail-safe 退单板）。各 peer 数字字段坏 / 人类可读字段坏 → 该字段 `null`（降级·不污染花名册）。**无任何 secret / token 字段**（token-blind）。

### usage show（`ccm usage show --json`）

```jsonc
{
  "available": true,
  "accounts_scope": "all",
  "effective_n": 3,
  "current": {                          // status-line sidecar（账户权威）；缺则 available:false
    "source": "account", "available": true,
    "five_hour": { "used_percentage": 92, "resets_at": 1782385200 },
    "seven_day": { "used_percentage": 50, "resets_at": 1782864000 },
    "captured_at": 1782378000
  },
  "accounts": [                         // 全备号 registry 生命周期快照（active 排首）
    { "email": "a@c.com", "active": true, "switchable": true, "as_of": "2026-06-25T07:00:00Z",
      "five_hour": { "used_pct": 92, "resets_at": "2026-06-25T11:00:00Z" },
      "seven_day": { "used_pct": 50, "resets_at": "2026-07-01T00:00:00Z" },
      "snapshot_stale": false, "source": "registry-snapshot" }
  ],
  "registry_present": true,
  "as_of": "2026-06-25T09:00:00Z",
  "source": "registry-snapshot",
  "confidence": "high"
}
```

无 registry → `registry_present:false`、`accounts:[]`、`effective_n:1`（单账号优雅降级·exit 0）。

### usage advise（`ccm usage advise --json`）

```jsonc
{
  "verdict": "accelerate",              // throttle | accelerate | hold | hard_stop
  "reason": "5h 已用 92%…当前 5h 烧满是切到下一份配额的触发信号",
  "levers": ["switch_account", "continue_dispatch"],
  "hard_stop_7d": false,
  "window_5h_pct": 92, "window_7d_pct": 50,
  "effective_n": 3,
  "switch_candidate": "c@c.com",        // 可切备号里 7d used% 最低者（无切号 lever / 无备号 → null）
  "confidence": "high",
  "source": "account",                  // sidecar 缺 → "local-derived-approx" + available:false
  "as_of": "2026-06-25T09:00:00Z",
  "available": true
}
```

### usage task-cost（`ccm usage task-cost [<id>] --json`）

单任务（给 `<task-id>`）：

```jsonc
{ "task": "C2", "scope": "this-board", "found": true,
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

### usage burn-rate（`ccm usage burn-rate --json`）

```jsonc
{
  "available": true,
  "five_hour": { "used_pct": 92, "resets_at": 1782385200,
    "burn_pct_per_hour": 18.4, "method": "window-elapsed", "confidence": "low" },
  "seven_day": { "used_pct": 50, "resets_at": 1782864000,
    "burn_pct_per_hour": 3.1, "method": "window-elapsed", "confidence": "low" },
  "source": "account",                  // sidecar 缺 → "local-derived-approx" + available:false
  "as_of": "2026-06-25T09:00:00Z",
  "confidence": "low"
}
```

`method` ∈ `finite-diff`（多采样有限差分）\| `window-elapsed`（单点 ÷ 窗口已逝时长）\| `none`（不可算）；`burn_pct_per_hour` 不可算 → `null`。两窗 `used_pct` 全缺 → `available:false`。

### usage runway（`ccm usage runway --json`）

```jsonc
{
  "available": true,
  "five_hour": { "used_pct": 92, "burn_pct_per_hour": 18.4,
    "remaining_corridor_pct": 0, "hours_to_ceiling": null, "hours_to_reset": 1.94,
    "verdict": "will-exhaust-before-reset", "ceiling_pct": 90 },   // 5h 走廊上界 90
  "seven_day": { "used_pct": 50, "burn_pct_per_hour": 3.1,
    "remaining_corridor_pct": 35, "hours_to_ceiling": 11.29, "hours_to_reset": 120,
    "verdict": "ample", "ceiling_pct": 85 },                       // 7d 走廊上界 85
  "source": "account",
  "as_of": "2026-06-25T09:00:00Z",
  "confidence": "low"
}
```

`verdict` ∈ `ample`（reset 先于触顶）\| `will-exhaust-before-reset`（触顶先于 reset·偿付力吃紧）\| `unknown`（数据不足）；信号缺该窗 → `used_pct:null` + `verdict:"unknown"`。

### estimate show（`ccm estimate show [<id>] --json`）

```jsonc
{ "scope": "home", "as_of": "ISO", "history_n": 40,
  "tasks": [ {
    "id": "C6", "raw_estimate_h": 3,
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
  "criticality_index": [ {"id":"C4","criticality":0.906,"cruciality":0.713,"sensitivity":0.665} ],
  "schedule_sensitivity": [ {"id":"C4","sensitivity":0.665} ],
  "consistency": { "deviation": 0.495, "warning": true },     // ①②偏差>20% → warning
  "mode": "both", "coverage_pct": 83, "confidence": "medium", "history_n": 40,
  "scope": "home", "runs": 2000, "seed": 42, "effective_n": 1, "as_of": "ISO",
  "source": "calibrated",
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
  "criticality_index": [ {"id":"C4","criticality":0.906,"cruciality":0.713,"sensitivity":0.665} ],
  "wip_aging": [ {"id":"C5","age_hours":49.43,"status":"critical","sle_p85":5.6,"sle_p95":9.18} ],
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
    "per_task": [ { "id": "C4", "predicted_tokens": 195000, "pct_share": 2.06, "knn_confidence": "medium" } ],  // 截断前 10 个 backlog 任务
    "note": "token 为派活相对 sizing（辅助·knnPredict.predictedTokens）·配额% 才是预算账本" },
  "scope": "home", "runs": 2000, "seed": 42, "as_of": "ISO",
  "source": "calibrated",               // burn 不可得 → "local-derived-approx" + available:false
  "confidence": "medium", "available": true, "history_n": 40,
  "notes": ["per-unit %-cost = burn-rate × 历史任务工期（假设串行归因…）"] }
```

账户 burn 不可得 → `available:false`、`cost_to_complete_pct:null`、`mean_pct:null`（exit 0·降级）；`backlog:0` → cost `0%`。`token_sizing` 是辅助相对量计（非预算账本）。
