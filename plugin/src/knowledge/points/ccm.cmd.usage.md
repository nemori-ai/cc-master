---
point: ccm.cmd.usage
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.usage -->
## namespace usage（只读 advisory）

`usage` 用全局 `--harness <target>` 下钻一个 selected target 的当前登录态；它不是 machine-wide inventory。
要一次看本机所有受支持 quota target，先用 `quota status --machine-wide`。全部 usage verb 纯 query / compute，
不写 board、不切账号、不调 WIP、不启动 worker；信号不可得时 exit 0 + `available:false`。输出携带 source、
confidence、as-of / freshness 等诚实字段。

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

## 失效类型

`environment_fact`（主体：事实方法） —— 缺 ccm usage namespace 的具体命令、flag、输出形状，模型按旧或部分信息敲命令会踩 exit 0 + available:false 或输出形状猜错

usage 各 verb 的 target 绑定、窗口字段位置与降级取值是本项目的读接口事实。
