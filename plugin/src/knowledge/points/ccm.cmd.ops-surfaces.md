---
point: ccm.cmd.ops-surfaces
---

## 权威陈述

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

## 失效类型

`environment_fact`（主体：事实方法） —— 删了这条，agent 不知道 web-viewer/monitor/status-report 的命令参数（如 --port 0 会系统分配、--quota-source 的取值等）。

status-report/web-viewer/monitor/services/runtime 的 artifact 路径、service state 与 exit code 是本实现的运维接口事实。
