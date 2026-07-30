---
point: ccm.cmd.overview
---

## 权威陈述

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
{{USING_CCM_POLICY_NAMESPACE_ROW}}
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
| `account` | {{USING_CCM_ACCOUNT_NAMESPACE_ROW}} |
| `statusline` | {{USING_CCM_STATUSLINE_NAMESPACE_ROW}} |
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
{{USING_CCM_POLICY_DENY_EXIT_ROW}}

### JSON 信封

- 成功：`{"ok": true, "data": <payload>}`
- 失败：`{"ok": false, "exit": <code>, "error": "<msg>", "violations": [...]}`

`data` 形状随命令而变，见 [--json 输出形状](#--json-输出形状)。

---

<!-- ccm:k:end point:ccm.cmd.overview -->
