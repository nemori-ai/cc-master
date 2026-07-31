---
point: ccm.cmd.board
---

## 权威陈述

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

## 失效类型

`environment_fact`（主体：事实方法） —— 缺 ccm 二进制对 board namespace（show、lint、graph 等八个子命令）的具体实现事实

board namespace 的 verb、flag、set-param 白名单键与 enable-contract 写入语义都是本项目 CLI 的具体接口事实，删掉就只能靠猜命令行。
