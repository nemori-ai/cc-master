---
point: ccm.cmd.misc-ns
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.misc-ns -->
## namespace statusline

{{USING_CCM_STATUSLINE_NAMESPACE}}

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

{{USING_CCM_UPGRADE_NAMESPACE}}
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
- 行为：{{USING_CCM_UPGRADE_PLUGIN_BEHAVIOR}}
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

## 失效类型

`environment_fact`（主体：事实方法） —— 缺 ccm 二进制对 statusline、attempt、harness、upgrade 四个 namespace 的具体实现事实

attempt/harness/upgrade 三个 namespace 的探测语义、surface descriptor 与版本解析规则都是本机本项目的事实。
