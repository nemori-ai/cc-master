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
- [namespace peers（协调感知·只读跨板）](#namespace-peers协调感知只读跨板)
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
- [namespace harness](#namespace-harness)
  - [harness list](#harness-list)
  - [harness current](#harness-current)
- [namespace upgrade](#namespace-upgrade)
  - [upgrade all](#upgrade-all)
  - [upgrade ccm](#upgrade-ccm)
  - [upgrade plugin](#upgrade-plugin)
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
| `jc` | judgment_calls 自驱决策记录 |
| `cadence` | 节奏 / iteration 收口 |
| `watchdog` | 自我唤醒 watchdog |
| `baseline` | EVM 计划基线快照（estimate 引擎的 plan SSOT·board 内唯一写 noun） |
| `policy` | board 级 orchestrator 自主权限开关（首条 `autonomous_account_switch`·写 noun·用户所有） |
| `peers` | 多 orchestrator 协调**感知层**：跨板只读花名册（全体活+心跳新鲜 orchestrator 的 goal/workload/priority/liveness） |
| `usage` | 配额侧**只读 advisory**：当前号/备号 5h/7d 用量 + 单侧走廊 pacing verdict（hold/throttle/switch/stop_5h/stop_7d）+ 任务 token 成本 |
| `estimate` | 工作侧**只读 advisory**：双通道 MC 工期预测 / EVM / velocity / 风险（消费 OR/ML 引擎） |
| `account` | {{USING_CCM_ACCOUNT_NAMESPACE_ROW}} |
| `statusline` | {{USING_CCM_STATUSLINE_NAMESPACE_ROW}} |
| `harness` | 本机 supported harness inventory：探测安装状态 / 当前选择 / install-upgrade 能力矩阵 |
| `upgrade` | 自升级：把 **ccm 二进制 + cc-master 插件**升到各自发布线最新（非 board 操作·见 [namespace upgrade](#namespace-upgrade)） |

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
| `--session-id <id>` | | string | {{USING_CCM_SESSION_ID_FLAG}} |
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
| `7` | policy-deny——`account switch` 的自主换号被目标板 `policy.autonomous_account_switch:deny` 拦下（机制硬闸，见 [account-pool.md](./account-pool.md)） |

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
| `--github-issue <url>` | | URL | | 以 GitHub issue URL 作为 board 需求来源，写 `board.source.kind=github_issue` / `board.source.url`；若未给 `--goal`，goal 派生为 `GitHub issue: <url>` |

- 例：`ccm board init --goal "试验性编排"` · `ccm board init --github-issue https://github.com/o/r/issues/9`
- 产物：`<home>/<YYYYMMDDThhmmssZ>-<pid>.board.json`
- 注意：`--github-issue` 是 board source，不会创建 synthetic task；orchestrator 读取 issue 后再拆真实 DAG。

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
| `--priority <enum>` | | enum `urgent\|high\|normal\|low\|trivial` | `coordination.priority`（板级优先级·跨板协调裁决主轴·非法值 → exit 2） |

- 例：`ccm board update --goal "收尾冲刺"` · `ccm board update --wip-limit 4 --branch feature-x` · `ccm board update --priority high`
- `--priority` 写 ✎ `coordination.priority`（板级优先级·`ccm peers` 跨板花名册的裁决主轴 + 机械 fair-share 权重源；缺/坏 → 解析为 `normal`）。枚举校验在 update 端（坏值 exit 2·不静默写非法值）；它是 agent-shaped ✎ 字段（hook 不读·非窄腰）。init 时用户给的板级优先级经此落盘（命令体 bootstrap 段指导 orchestrator 捕获并记入）。
- 发现：`--goal` 在此是 payload（重定 goal），**不**当发现过滤器——所有 flag 走同一条两层匹配（精确 sid → 未认领 `session_id:""` 兜底），与 `task add` 等一致；隐式发现（无 `--board`）在 `ccm board init` 建的未认领板上对 `--goal` 与 `--wip-limit` **行为一致**。多 active 板时用 `--board <path>` 消歧。

### board archive

**写**（归档板·翻 `owner.active=false`·带锁·停用即休眠·显式可逆）

```
ccm board archive [flags]
```

- positional：无
- 行为：{{USING_CCM_BOARD_ARCHIVE_BEHAVIOR}}
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

- positional：`<key>`（必填·**白名单**：当前 `last_identity_remind`、`last_critpath_remind`、`last_account_switch`、`stop_allow_until`）、`<value>`（必填·按 key 声明类型校验）
- 作用域**收窄到 `board.runtime.<白名单 key>`**——非白名单 key / 非法值 → `exit 2`（Usage）；**绝不触碰 🔒/👁 窄腰**。
- 主要使用者是周期 hook（身份提示 hook 写 `runtime.last_identity_remind`、临界路径提示 hook 写 `runtime.last_critpath_remind`）+ 账号切换机制写 `runtime.last_account_switch`（换号时刻·usage-pacing hook 读它做「检测到换号」ambient）+ Codex Stop hook 释放闸（agent 独立确认可停后写短期未来 `runtime.stop_allow_until`，Stop hook 在该时刻前放行）经进程边界 spawn 写 ISO-8601 UTC 时间戳；agent 也可经它写参数区。走 `runWrite` 带锁管线（与所有写 verb 同口径·刷 `owner.heartbeat`）。
- flags：`--json`（结构化输出 `{ok,data:{runtime}}`）；`--dry-run` 跑完整校验不落盘。
- 值类型：`last_identity_remind` / `last_critpath_remind` / `last_account_switch` / `stop_allow_until` 均须严格 ISO-8601 UTC（`YYYY-MM-DDTHH:MM:SSZ`），否则 `exit 2`。
- 例：`ccm board set-param last_identity_remind 2026-06-29T12:34:56Z` · `ccm board set-param last_account_switch 2026-06-30T08:00:00Z --board <path>` · `ccm board set-param stop_allow_until 2026-07-03T15:30:00Z --board <path>`

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
| `--handle <str>` | | string | | | 后台句柄（subagent/workflow 必给；external 可记录 issue URL/number/run id） |
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

- 例：`ccm task add T7 --type development --deps T1 --estimate 3h` · `ccm task add EXT3 --executor external --ref issue:https://github.com/o/r/issues/9 --handle o/r#9`
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
- **`--artifact` 提前诊断（issue #57 问题2）**：若目标 task 已是 `status:done` 且 `verified` 非 `true`，单独设
  `--artifact`（不带 `--verified`）必然无法满足 done 真语义（`BIZ-DONE-VERIFIED`）——handler 层提前给一个更
  直达的 `Usage` 错误（**exit 2**，不是 exit 3），指路"同时加 `--verified` 或改用 `task done --verified
  --artifact`"。这是体验性提前诊断（lint 仍是唯一校验权威），不是新增校验规则——同时给 `--verified` 或目标
  不是"已 done 且未 verified"时不触发，正常交给 lint 判。

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
| `--log <str>` | | string | 同时追一条 log（批量只追一条，summary 含全部 id） |

- 例：`ccm task done T7 --artifact /abs/out.md --verified` · `ccm task done T7 T8 T9 --artifact /abs/out.md --verified`（批量）

**批量语义（`task start` / `task done` 共用·issue #57 问题3 方案3·根治批量回填死结）**：`runWrite` 的写入
关卡是"mutate → 对整块 next 板跑一次 `lintBoard` → 有 hard error 就整体拒绝、不落盘"。逐条独立调用
`ccm task done <id>`（N 次独立进程 = N 次独立 mutate+lint+write）时，只要 board 上**还有其它任务**违反某条
hard 规则（哪怕与本次改的 id 无关），每一次单独调用都会因为**全局其它任务的存量违规**被拒——这正是"批量
45 个 id 只 1 个生效"的死结根因。批量调用（一次传入多个 id）把 N 次独立调用坍缩成**一次**调用：内部对每个
id 依次 `transition` + 覆写字段，但只跑**一次** `lintBoard` + **一次**落盘——只要这一批 id 本身在这次操作
后都变得合规、且 board 上没有**第三方**（不在这批里的）存量违规，就能一次性全部落盘。

- **all-or-nothing**：批量里任意一个 id 转移非法（如仍是 `ready` 没 `start` 就 `done`）或不存在，整批**都不
  落盘**（包括批量里其它本来合法的 id）——没有"部分提交"，`runWrite` 从来没有这个概念。
- **`--force`**：对整批统一生效（既有全局语义），越过非法转移 + lint hard error；不支持"这批里第 3 个不
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

- 行为：清除 `blocked_on`（+ 附属 `decision_package`）语义阻塞标记，**不直接定 status**——交回写入关卡的 `reconcileGating` 按 deps 完成度归一（deps 全 done→`ready`，否则→`blocked`）。这是 `task block` 的解除侧、也是「不该手 `set-status` 解 deps 阻塞」的正解。
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

自我唤醒 watchdog。

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

board 级 orchestrator 自主权限：`board.policy` 是框定本块板 master-orchestrator 自主权限的可扩展对象，首条键 `autonomous_account_switch`（`allow`/`deny`）门控**是否允许 orchestrator 自主换号**。**写 noun**——`set` 改 board 状态，刻意置于只读 namespace 之外（同 baseline 定位）。policy 写**视权限为用户所有**（self-grant 防护）：非 TTY 须显式 `--user-authorized` 才能写。缺省 / 缺字段一律解析为 `allow`（向后兼容旧板）。

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
- ⚠️ **绝不自授权**：orchestrator-agent 绝不自己加 `--user-authorized` 翻 policy（那是 self-grant·越权）——该标记只由用户给（决策纪律见 master-orchestrator-guide）。机制硬闸侧：账号切换命令在覆写凭证前也读 `policy.autonomous_account_switch`、`deny` 即拒并 exit 7（纵深防御兜底·见 namespace account）

---

## namespace peers（协调感知·只读跨板）

多 orchestrator 协调的**感知层**：M 个 orchestrator 并行抽同一活跃配额缸，各自孤立 pacing 会公地悲剧——感知通道让每个 orchestrator 看见全体 peer 的 goal / workload / priority / 死活，喂价值感知的**独立**自我配速（不必双向协商即可单方面合理让路 / 认领 slack；通信通道**不存在**·只读感知 + 机械 fair-share floor 收口）。**纯只读跨板**——扫 `<home>/boards/` 全体板，零写、不抢 board-lock、**不需要 active board 自身**（感知是用户级跨板·同 usage/estimate）。**token-blind**：花名册只投影 goal / priority / workload / state% / liveness——**无任何 secret / token**。

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

配额侧只读 advisory（控制 token 消耗速度 + 资源下最大化效率）：当前号/备号用量 + 单侧走廊 pacing verdict（hold/throttle/switch/stop_5h/stop_7d）+ 任务 token 成本。**纯只读**——全 verb query/compute，零写、不抢 board-lock、不落状态（与 `baseline`/`policy` 这俩写 noun 相反）。诚实降级：账户信号不可得 = **exit 0 + `data.available:false`**（非 exit 1）；无 `accounts.json` registry → 天然单账号·`effective_n=1`（不报错）。诚实字段贯穿：`source`（account / registry-snapshot / observability / local-derived-approx）/ `confidence`（high/medium/low）/ `as_of` / `snapshot_stale` / `coverage_pct`。ccm 出 verdict/数据，**不替 orchestrator 决策**（真动作归 `master-orchestrator-guide`）。

{{USING_CCM_USAGE_SIGNAL_SOURCE}}

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
- 行为：**单侧走廊 pacing verdict（5 值 enum）**：`hold`（走廊内·静默）\| `throttle`（5h 临界减速）\| `switch`（5h 临界 + n>1 + 7d 有余量 → 切到下一份配额）\| `stop_5h`（5h 本窗口烧穿·无可切备号 / 7d 亦吃紧 → 引导 arm watchdog 守到 `nearest_reset` 回血）\| `stop_7d`（7d 跨窗口不可逆硬总闸 → 暂停 dispatch + surface 用户）。附 `strength`（标签强度 weak\|strong·ccm 出、消费方直接用）+ 推荐 lever 类 + `stop_dimension`（哪个窗口驱动了 stop_*）+ `nearest_reset`（stop_* 时该窗 reset 时刻·引导 arm wakeup）+ `switch_candidate`（`switch` verdict 时·选可切备号里 7d `used%` 最低的）+ `pool`（号池粗粒度 { backups, switchable }）。收口 usage-pacing 走廊数学（引擎 `pacingAdvice` 为准）。sidecar 缺 → `hold` + `available:false`（降级）
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

- 例：`ccm usage task-cost T2` · `ccm usage task-cost --group-by executor --json`

### usage burn-rate

**读**

```
ccm usage burn-rate [flags]
```

- positional：无
- 行为：{{USING_CCM_USAGE_BURN_RATE_BEHAVIOR}}
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

{{USING_CCM_ACCOUNT_NAMESPACE}}

---

## namespace statusline

{{USING_CCM_STATUSLINE_NAMESPACE}}

---

## namespace harness

> 本机 supported harness inventory。它回答两个不同问题：① 当前命令选择的是哪个 harness（`--harness` > `CC_MASTER_HARNESS` / 旧 host env > 自动探测 > 兼容默认）；② 这台机器上安装了哪些 ccm 已知 harness，以及它们是否支持 plugin 分发、statusline config、account pool。install / upgrade 类命令应消费这里的 inventory，而不是各自猜 `claude` / `codex` 是否存在。

### harness list

```
ccm harness list [--json]
```

- 读所有 ccm 已知 harness 的安装探测结果。Claude Code 通过 `claude` CLI / Claude config dir 探测；Codex 通过 `codex` CLI / `CODEX_HOME` 或默认 config dir 探测。
- 输出包含：`installed`、`active`、CLI 路径、config 路径、`accountPool` / `externalStatusline` / `pluginDistribution` 能力。
- flags：`--json`（结构化输出）

### harness current

```
ccm harness current [--json]
ccm --harness codex harness current [--json]
```

- 显示当前 selected harness 及其安装探测。显式 `--harness` 可用于检查某个目标 harness 的能力，而不改变全局环境。
- flags：`--json`（结构化输出）

---

## namespace upgrade

{{USING_CCM_UPGRADE_NAMESPACE}}
>
> **版本解析（关键坑·与 `install.sh` 同款）**：GitHub `/releases/latest` **不分前缀**——故走 `/releases` 列表 + tag 前缀过滤 + semver 排序取最新：ccm 线滤 `ccm-v*`、plugin 线滤裸 `v*` **且排除 `ccm-v*`**。某线暂无 release → 优雅报错（exit 1·不崩）。可选 `GITHUB_TOKEN`/`GH_TOKEN` 避匿名限流。
>
> **`--dry-run`（全局 flag）**：只查「当前 vs 最新」并打印计划、不真升。

### upgrade all

**写**（默认 verb：裸 `ccm upgrade` ≡ `ccm upgrade all`）

```
ccm upgrade [--json] [--all-harnesses]
ccm upgrade all [--json] [--all-harnesses]
```

- positional：无
- 行为：先升 ccm 二进制、再升插件（互不依赖·一个失败不挡另一个）；退出码取「先失败者」（都成才 `0`）
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 结构化输出 |
| `--all-harnesses` | | bool | 插件升级阶段枚举本机已安装的 ccm-supported harness 并逐个分发（不影响 ccm 二进制自升级） |

- 例：`ccm upgrade` · `ccm upgrade --dry-run` · `ccm upgrade --all-harnesses --dry-run`

### upgrade ccm

**写**（SEA 二进制原子自替换）

```
ccm upgrade ccm [--to <ccm-v*tag>] [--json]
```

- positional：无
- 行为：探当前 SEA 自身路径（`process.execPath`）→ 下载新 `ccm-<plat>` 到同目录临时文件 → `chmod +x` → 验新二进制 `--version` 能跑 → 原子 `rename` 覆盖自身路径（macOS/Linux 运行中进程持旧 inode·覆盖安全）。**非 SEA**（node 脚本形态：dev / 全局 npm install）→ 拒绝自替换 + 清晰报错（exit 1）。未显式 `--to` 且本地核版本 ≥ 线上最新 tag 核版本 → 视为已最新、跳过（避免意外降级；ccm 二进制内部版本号与 `ccm-v*` 发布线**已解耦**，比较仅作参考门）
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--to <tag>` | | string | 指定 `ccm-v*` tag（默认线上最新·如 `ccm-v0.1.0`） |
| `--json` | | bool | 结构化输出 |

- 例：`ccm upgrade ccm` · `ccm upgrade ccm --to ccm-v0.1.0 --dry-run`

### upgrade plugin

**写**（harness-specific plugin manager）

```
ccm upgrade plugin [--to <v*tag>] [--json] [--all-harnesses]
```

- positional：无
- 行为：{{USING_CCM_UPGRADE_PLUGIN_BEHAVIOR}}
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--to <tag>` | | string | 期望的 `v*` tag（**信息性**·实际升到 marketplace 最新） |
| `--all-harnesses` | | bool | 枚举本机已安装的 ccm-supported harness；支持 plugin 分发的执行升级，不支持的 skipped |
| `--json` | | bool | 结构化输出 |

- 例：`ccm upgrade plugin` · `ccm upgrade plugin --dry-run` · `ccm upgrade plugin --all-harnesses --dry-run --json`

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
  "verdict": "switch",                  // hold | throttle | switch | stop_5h | stop_7d（单侧 enum）
  "strength": "weak",                   // 标签强度 weak|strong（ccm 出·消费方直接用·throttle/stop_* → strong·switch → weak）
  "reason": "5h 已用 92%…当前 5h 烧满是切到下一份配额的触发信号",
  "levers": ["switch_account", "continue_dispatch"],
  "stop_dimension": null,               // "5h" | "7d" | null（哪个窗口驱动了 stop_*·非 stop_* → null）
  "nearest_reset": null,                // stop_* 时该窗 reset 时刻 ISO-8601（引导 arm wakeup 等 reset）·非 stop_* → null
  "window_5h_pct": 92, "window_7d_pct": 20,
  "effective_n": 3,
  "switch_candidate": "c@c.com",        // switch verdict 时选可切备号里 7d used% 最低者（非 switch / 无备号 → null）
  "pool": { "backups": 2, "switchable": 2 },  // 号池粗粒度事实（非 active 号数 / 其中 token 未过期可切入数）
  "confidence": "high",
  "source": "account",                  // sidecar 缺 → "local-derived-approx" + available:false
  "as_of": "2026-06-25T09:00:00Z",
  "available": true
}
```

verdict 语义（消费方映射）：`hold` 走廊内静默；`throttle` 5h 临界减速（降模型档 / 降 WIP / defer）；`switch` 5h 临界 + n>1 + 7d 有余量 → 切到下一份配额（usage-pacing hook 机械换号·消费方只调配速）；`stop_5h` 5h 本窗口烧穿 → arm watchdog 守到 `nearest_reset` 回血；`stop_7d` 7d 跨窗口硬总闸 → 暂停 dispatch + `blocked_on:"user"` surface 用户。

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
