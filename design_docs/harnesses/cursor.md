# Cursor Harness Facts

更新时间：2026-07-10。

## Source Hierarchy

Cursor 事实按以下优先级维护：

1. Cursor 官方文档（2026-07-09 抓取）：[Hooks](https://cursor.com/docs/hooks)、[Skills](https://cursor.com/docs/skills)、[Plugins reference](https://cursor.com/docs/reference/plugins)、[Rules](https://cursor.com/docs/rules)、[Third-party hooks](https://cursor.com/docs/reference/third-party-hooks)。
2. 本仓对 Cursor IDE Agent 的实测结论（**probe 完成 2026-07-09，Cursor 3.10.20**——见 §Probe Results）。
3. 本仓对 Claude Code / Codex adapter 的对照推导（`claude-code.md`、`codex.md`、`compatibility-matrix.md`）。
4. paragoge 旧资料：**未覆盖 Cursor**；不得从 paragoge 复制 Cursor 机制。

证据等级标注：

- **【官方】**：官方文档明确记载。
- **【本仓】**：已合并的 source / tests / 生成产物所证明的当前实现。
- **【推导】**：从 Claude/Codex 对照 + 官方文档推导，待 probe 验证。
- **【待实测】**：官方未写清或社区报告与文档不一致。

实现状态以当前 tracked source / tests 为准；早期 sketch 只在标明
**superseded snapshot** 时保留。probe 结论与文档存在差异时，以指定版本的实测为准。

## Scope

本页只覆盖 **Cursor IDE Agent**（本机 Composer / Agent Chat / Cmd+K Agent 操作）。

**不在本页目标范围内**（另档 / 缺口表标注）：

- **Cursor Cloud Agents**（cursor.com/agents）：官方明确多个 hook 无等价触发点（`sessionStart`/`sessionEnd`、`beforeSubmitPrompt`、`stop`、Tab hooks、部分 MCP hooks 等）。
- Cursor Tab 补全专用 hooks（`beforeTabFileRead`/`afterTabFileEdit`）。
- Cursor SDK / Cloud Agents API（`@cursor/sdk`、`CURSOR_API_KEY`）——编排 dispatch 的 CI/外部面，不是 IDE Agent runtime。
- Cursor Agent CLI / headless one-shot worker **调用契约**——它是 cross-harness 调用面，不等于本页的 IDE plugin / hook adapter。本页只在 §Env / Detection 记录 ccm 对 `cursor-agent` binary presence 的本机只读 descriptor；这不定义 invocation / auth / quota / cancel / result contract。

## Plugin Shape

Cursor plugin 目录结构【官方】：

```text
my-plugin/
├── .cursor-plugin/
│   └── plugin.json          # 必填：name（kebab-case）
├── rules/                   # .mdc 规则
├── skills/<skill>/SKILL.md
├── agents/*.md
├── commands/*.md
├── hooks/hooks.json
├── mcp.json
├── scripts/
└── README.md
```

多插件仓库根目录可有 `.cursor-plugin/marketplace.json`。

**本地测试路径**【官方】：`~/.cursor/plugins/local/<plugin-name>/`（不是 `plugins/cache/`）。

**分发渠道**【官方】：cursor.com/marketplace 审核发布；Teams/Enterprise 可配 team marketplace；`workspaceOpen` hook 可返回 `pluginPaths[]` 动态加载。

**本仓当前投影产物**【本仓】：

```text
plugin/dist/cursor/
  .cursor-plugin/plugin.json
  commands/
  hooks/hooks.json
  hooks/_hosts/cursor/launcher.js
  hooks/<hook>/implementations/cursor/
  skills/
  rules/
```

当前源码落点【本仓】：

```text
plugin/src/
  .cursor-plugin/
  skills/<skill>/adapters/cursor/strategy.yaml
  hooks/_hosts/cursor/hooks.json
  hooks/<hook>/implementations/cursor/
  commands/<cmd>/adapters/cursor/strategy.yaml
  rules/cursor/
```

## Skills

### 发现路径【官方】

| 位置 | 作用域 |
| --- | --- |
| `.cursor/skills/<name>/SKILL.md` | 项目 |
| `.agents/skills/<name>/SKILL.md` | 项目（同义） |
| `~/.cursor/skills/` | 用户全局 |
| `~/.agents/skills/` | 用户全局 |
| `.claude/skills/` | **兼容加载**（Claude Code skill 目录） |
| `.codex/skills/` | **兼容加载** |
| 嵌套 monorepo 子目录 `.cursor/skills/` | 自动 scope 到子树 |
| `~/.cursor/skills-cursor/` | Cursor 内置，**禁止用户写入** |

发现机制：启动时扫描 → Settings → Customize → Skills；agent 按 `description` 路由；也可 `/skill-name` 或 `@skill-name` 显式调用。

### Frontmatter【官方】

```yaml
---
name: my-skill          # 必须与目录名一致，kebab-case，≤64 字符
description: ...        # 路由触发器，≤1024 字符
paths: "**/*.tsx"       # 可选，glob scope
disable-model-invocation: true  # 仅 /slash 显式调用
---
```

可选子目录：`scripts/`、`references/`、`assets/`。

### Path token【官方 + 推导】

- **【官方】** Cursor skills 文档**未记载** `${CURSOR_PLUGIN_ROOT}`、`${CURSOR_SKILL_DIR}` 或类似 runtime path variable substitution。
- **【推导】** canonical skill 正文不得写 `${CLAUDE_*}`；Cursor adapter 应同 Codex 纪律：相对路径、install-time rewrite、或 `references/` 渐进披露。
- **【待实测】** plugin 内 skill 引用 `scripts/` 时，相对路径解析基准（plugin 根 vs cwd）。

### cc-master 当前适配【本仓】

- 八个方法论 / 操作型分发 skill 均有 Cursor strategy：其中七个走 canonical `copy` + slot/overlay，`authoring-workflows` 为 `unsupported_stub`（无 Workflow 等价物，见 §Dispatch）。
- Cursor 的 `/as-master-orchestrator`、`/discuss`、`/distill`、`/handoff-to-new-session`、`/retro`、`/cc-master-stop` 已以 `host_native` `commands/*.md` 投影；对应 `cc-master-*` 入口 skill 是兼容 stub，不计入上述八个方法论 skill。
- dev meta-skills（`.claude/skills/`）：Cursor **兼容发现** `.claude/skills/`，本仓 dev skill 在 Cursor 内可直接被 agent 加载，**不必**单独 sync 到 `.cursor/skills/`（除非要随 plugin 分发）。

## Rules / AGENTS.md

### Project Rules【官方】

路径：`.cursor/rules/*.mdc`。

```yaml
---
description: ...
alwaysApply: true|false
globs: "**/*.ts"
---
```

类型：Always Apply / 智能应用 / 文件匹配 / 手动 `@rule`。

### AGENTS.md【官方】

项目根或子目录 `AGENTS.md`：纯 markdown，无 frontmatter；子目录可覆盖父目录。

### 与 cc-master reinject 的关系【推导 — 硬缺口】

| 机制 | 行为 | 与 reinject 关系 |
| --- | --- | --- |
| `AGENTS.md` / Rules `alwaysApply` | 会话级静态常驻指令 | **不是** compaction 边界动态重注 |
| `sessionStart.additional_context` | 文档声称注入初始 system context【官方】 | **D4 已关闭为已知 bug**：当前不到达模型，不可作 reinject 依赖 |
| `preCompact` | 仅 `user_message` 通知【官方】 | **不能**注入 agent 上下文 |
| Claude `SessionStart` matcher `compact` → reinject | 每次 compaction 全文重注 SKILL A | **无 1:1 等价** |

结论：Cursor 上 **不能假设** cc-master 的 SessionStart reinject 纪律可原样平移。D3/D4 已证明无 compact 后重触发且 `additional_context` 不可靠；当前 Track B 实现为精简 `alwaysApply` rule + 静默 `preCompact` observe，这是已接受的能力降级，不是 1:1 reinject。

本仓 `AGENTS.md` / `CLAUDE.md = @AGENTS.md` 可直接作为 Cursor 项目导航 SSOT【推导】。

## Commands

### Plugin commands【官方】

- 路径：`commands/*.md`（`.md`/`.mdc`/`.txt`）。
- Frontmatter：`name`、`description`。
- 调用：Agent chat 中 `/command-name`。
- **【官方】** 无 documented `plugin:` namespace（Claude Code 的 `cc-master:as-master-orchestrator` 形态需 adapter 改写）。

### Bootstrap 入口【本仓】

cc-master 的 Cursor bootstrap contract 已落成双通道：

1. **Plugin command**：`/as-master-orchestrator <goal>`（`commands/as-master-orchestrator.md` 投影）。
2. **`beforeSubmitPrompt` hook**：检测 prompt 首行 sentinel / command 形态，`continue: false` 可拦截。

`host_native` command 提供 IDE 入口，hook 执行实际 sentinel / fresh-resume ARM 契约；两者均在 source/dist 中提交。

### Skill invocation args【官方】

Skills **无** positional/named args 文档；带参入口应走 command body 解释或 `ccm` CLI【推导】。

## Hooks

### 配置位置与优先级【官方】

| 层级 | 路径 |
| --- | --- |
| Enterprise | 系统级 `hooks.json` |
| Team | Dashboard 云分发 |
| **Project** | **`.cursor/hooks.json`** |
| User | `~/.cursor/hooks.json` |
| Claude 兼容 | `.claude/settings.json` / `~/.claude/settings.json` |

优先级（高→低）：Enterprise → Team → Project → User → Claude local → Claude project → Claude user。

需开启：**Settings → Include third-party Plugins, Skills, and other configs**（Claude hooks 兼容亦依赖）。

### Schema【官方】

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [{ "command": ".cursor/hooks/init.sh" }],
    "preToolUse": [{
      "command": ".cursor/hooks/guard.sh",
      "matcher": "Shell|Write",
      "timeout": 30,
      "failClosed": true
    }],
    "stop": [{
      "command": ".cursor/hooks/verify.sh",
      "loop_limit": 10
    }]
  }
}
```

Per-hook 字段：`command`（必填）、`type`: `"command"`|`"prompt"`、`timeout`、`failClosed`、`loop_limit`（`stop`/`subagentStop`）、`matcher`（**JS 正则**，非 POSIX）。

### Agent 类事件【官方】

`sessionStart`、`sessionEnd`、`preToolUse`、`postToolUse`、`postToolUseFailure`、`subagentStart`、`subagentStop`、`beforeShellExecution`、`afterShellExecution`、`beforeMCPExecution`、`afterMCPExecution`、`beforeReadFile`、`afterFileEdit`、`beforeSubmitPrompt`、`preCompact`、`stop`、`afterAgentResponse`、`afterAgentThought`。

**不存在**：`PostToolBatch`（cc-master 依赖的批量工具边界事件）。

### stdin 公共字段（Agent hooks）【官方】

```json
{
  "conversation_id": "string",
  "generation_id": "string",
  "model": "string",
  "hook_event_name": "string",
  "cursor_version": "string",
  "workspace_roots": ["<path>"],
  "user_email": "string | null",
  "transcript_path": "string | null"
}
```

`sessionStart` 另有 `session_id`（与 `conversation_id` 相同）【官方】。

`subagentStart`/`subagentStop` 另有 `parent_conversation_id`【官方】。

### 退出码与阻断【官方】

- `0`：成功，读 stdout JSON。
- `2`：阻断（等同 deny）。
- 其他非零：**fail-open**（除非 `failClosed: true`）。

### 关键输出语义【官方】

| 事件 | 输出字段 | 语义 |
| --- | --- | --- |
| `preToolUse` | `permission`, `updated_input`, `user_message`, `agent_message` | allow/deny/ask |
| `postToolUse` | `additional_context` | 注入后续 agent 上下文；D5 在 Cursor 3.10.20 实测 PASS |
| `beforeShellExecution` | `permission` | Shell 专用 allow/deny/ask |
| `stop` / `subagentStop` | `followup_message` | **自动续跑**下一条 user message；受 `loop_limit` 约束（默认 5） |
| `sessionStart` | `env`, `additional_context` | `env` 传给同 session 后续 hook（D11 PASS，跨重开 / subagent 有 caveat）；`additional_context` 当前有 D4 已知 bug |
| `beforeSubmitPrompt` | `continue`, `user_message` | `continue: false` 拦截提交 |
| `preCompact` | `user_message` only | **观察型**，不能注入 agent 上下文 |

### 与 Claude Code 工具名映射【官方 — third-party hooks】

| Claude Code | Cursor |
| --- | --- |
| `Bash` | `Shell` |
| `Edit` | `Write` |
| `Glob` / `WebFetch` / `WebSearch` | **无等价** |

### Third-party hooks（Claude Code 兼容）【官方】

Cursor 可加载 `.claude/settings.json` 中的 Claude Code hooks（需设置开关）。Claude `Stop` 的 `decision:block` + `reason` 会被映射为 `followup_message`。

**纪律**：可作快速对照验证，**不能**当作正式 Cursor adapter——正式 adapter 必须原生 `hooks.json` + Cursor 事件语义。

### Hook runtime【本仓 + probe】

- cc-master 红线 1：hooks 只用 bash + node/JS。
- D2 在 Cursor 3.10.20 确认 hook 子进程 PATH 可用 `node`；本仓仍不依赖官方示例里的 jq/python。
- D1 确认绝对路径可用、local plugin hook cwd 为 plugin 安装根。production `hooks.json` 从 plugin cwd 以相对路径调 `launcher.js`，launcher 用 `__dirname` 解析根并注入 `CC_MASTER_PLUGIN_ROOT`；不假设 Cursor 会展开 `${PLUGIN_ROOT}`。

## Env / Detection

### Hook 进程保证的环境变量【官方】

| 变量 | 说明 |
| --- | --- |
| `CURSOR_PROJECT_DIR` | Workspace 根 |
| `CURSOR_VERSION` | Cursor 版本 |
| `CURSOR_USER_EMAIL` | 登录用户邮箱（若已登录） |
| `CURSOR_TRANSCRIPT_PATH` | 会话 transcript 路径（若启用） |
| `CURSOR_CODE_REMOTE` | 远程 workspace 时为 `"true"` |
| `CLAUDE_PROJECT_DIR` | **兼容别名** = project dir |

`sessionStart` 返回的 `env` 对象 → 同 session 后续 hook 可见【官方】。D11 验证该路径可用，但 chat 关闭重开、IDE 重启、subagent 继承仍有 caveat；因此只作 convenience，不作武装 SSOT。

### Session 身份【官方 + 推导】

- Hook JSON：`conversation_id`（稳定跨多轮）；`sessionStart` 上 `session_id` = `conversation_id`。
- D7 在同一 Agent chat 内 18/18 fixtures 确认 `conversation_id == session_id`；cc-master board `owner.session_id` 以该 stdin identity 对齐。
- 关闭重开同一 chat 未单独重测；这不改变当前约束：hook 武装依赖 stdin identity，不依赖注入 env 的跨重启持久性。

### Agent 普通 shell 探测【probe】

D8 在 Cursor 3.10.20 确认普通 Agent Shell 暴露 `CURSOR_AGENT=1`、`CURSOR_CONVERSATION_ID`等，因此 `ccm harness current` 可自动识别 Cursor。Hook child env 反而不含 `CURSOR_*`；hook 仍从 stdin `conversation_id` / `session_id` 取武装键。

### 当前 ccm `cursor` adapter【本仓】

```ts
// ccm/apps/cli/src/harnesses/cursor.ts（摘要）
detect(env) => !!(
  env.CURSOR_AGENT ||
  env.CURSOR_PROJECT_DIR ||
  env.CURSOR_VERSION ||
  env.CURSOR_CONVERSATION_ID
)

session(env) => ({
  id: env.CURSOR_CONVERSATION_ID || env.CURSOR_AGENT || '',
  source: env.CURSOR_CONVERSATION_ID ? 'env:CURSOR_CONVERSATION_ID' :
    env.CURSOR_AGENT ? 'env:CURSOR_AGENT' : 'none',
})
```

能力诚实标注（当前）：

| Capability | 当前 |
| --- | --- |
| `accountPool` | `unsupported` — Cursor 无 Claude OAuth 号池 |
| `externalStatusline` | `unsupported` — IDE statusline ≠ Claude statusLine schema |
| `pluginDistribution` | `supported` — local plugin 位于 `~/.cursor/plugins/local/cc-master`；`ccm upgrade plugin --harness cursor` 从已安装的本地包刷新 |
| `readCurrentUsage` | `dashboard-api` — `GetCurrentPeriodUsage` 投影为 `UsageSignal.billing_period`；不伪造 5h/7d |

`ccm harness list` 的安装探测另将同品牌切成两个独立 descriptor【本仓】：

| Surface | 本地发现契约 | 不做的推断 |
| --- | --- | --- |
| `cursor-ide-plugin` / `ide-plugin` | 继续沿用 `cursor` executable、Cursor config dir 或 cc-master local plugin dir；同时保持顶层 harness `installed` 语义，供 plugin install/upgrade 消费 | 不由 `cursor-agent` 存在推出 IDE / plugin 已安装 |
| `cursor-agent` / `cli-headless` | 只探可执行 `cursor-agent` binary（或 `CCM_CURSOR_AGENT_BIN` / `CURSOR_AGENT_BIN`），报 binary name + PATH 命中绝对路径；symlink 合法，非可执行文件不算 | auth / quota = `unknown` + `not-probed`；account mutation = `forbidden`；autoswitch / plugin distribution = `unsupported` |

这条 inventory 路径只读 PATH / 本地目录，不调 Cursor provider、不读写 credential、不 login/logout/switch。手工 auth 是用户管理的外部事实，inventory 不把它伪报成已知。

## Dispatch Primitives

| cc-master 机制 | Cursor IDE Agent 等价 | 备注 |
| --- | --- | --- |
| Background shell | Shell tool + `block_until_ms: 0` + `notify_on_output` | 【官方】agent 工具模型 |
| Sub-agent | **Task tool** + `subagentStart`/`subagentStop` hooks | 类型：`generalPurpose`、`explore`、`shell` 等 |
| Custom subagent | `.cursor/agents/*.md` | 自定义 system prompt + description 路由 |
| **Workflow** (dynamic-workflow) | **❌ 无等价** | `authoring-workflows` → `unsupported_stub` |
| CronCreate / ScheduleWakeup | `/loop` skill（sleep 循环） | 本地 session；非 durable cron |
| Automations | `/automate` + Dashboard | 外部触发（GitHub/Slack/schedule） |
| Cursor SDK | `Agent.create` / `Agent.prompt` | CI/外部编排；respects hooks 但不管理 hooks |
| agent-teams / 云 routines | cc-master 已排除 | Cursor Automations 是不同产品面 |

## Dual-track delivery（ADR-031）

Cursor 接入拆成两条轨；**契约 SSOT** 已落盘，**Phase C 实现已落地**（plugin v0.17.0+）。

| Track | 范围 | 推进范式 | 契约落点 |
| --- | --- | --- | --- |
| **A** | 可 SAP/PHIP 1:1 的 surface | SDD → TDD → `implementations/cursor/` | hook `CONTRACT.md` + `adapters/cursor/strategy.yaml` |
| **B** | 不可 1:1 的能力 | 业务意图 → 声明式替代 → fixture 锁等价类 | [`capabilities/`](capabilities/README.md) Capability Cards |

### Track A — 可直接 SAP/PHIP（`hooks.yaml` 已标 `implemented*`）

| Surface | Cursor 落点 | 模式 |
| --- | --- | --- |
| Skills（除 authoring-workflows） | `adapters/cursor/strategy.yaml` → `copy` + slot | SAP |
| Commands（as-master-orchestrator 等） | `host_native` → `commands/*.md` | SAP |
| board-guard | `preToolUse` matcher `Shell\|Write` | PHIP |
| board-lint | `postToolUse` matcher `Write` | PHIP |
| bootstrap-board | `beforeSubmitPrompt` + command | PHIP |
| identity-nudge（stop 侧） | `stop` advisory | PHIP |
| Manifest | `.cursor-plugin/plugin.json` | host-native |

历史实现顺序为 bootstrap → guard → lint → verify-board；这些 Phase C 节点均已落地（见 §Adapter Delivery Record）。

### Track B — 需求级替代（Capability Cards）

| Capability | 业务意图 | Cursor 替代 | kind | Card |
| --- | --- | --- | --- | --- |
| role-substrate-reinject | compaction 后恢复编排者角色 + 列板 | alwaysApply 精简 rule + preCompact observe；排除 D4 失效的 `sessionStart.additional_context` | `protocol-capability-gap` | [role-substrate-reinject.md](capabilities/role-substrate-reinject.md) |
| stop-continuation-gate | Stop 时不得静默放弃未完成工作 | `followup_message` + FUSE + `stop_allow_until` | `protocol-capability-gap` | [stop-continuation-gate.md](capabilities/stop-continuation-gate.md) |
| post-tool-batch-gate | 并行 fan-out 后批量闸 | 省略；guard + stop 降级 | `event-unavailable` | [post-tool-batch-gate.md](capabilities/post-tool-batch-gate.md) |
| workflow-authoring | dynamic-workflow | `unsupported_stub` + Task/shell | `event-unavailable` | [workflow-authoring.md](capabilities/workflow-authoring.md) |
| usage-pacing-midflight | 中途配额采样 | Stop-only（同 Codex） | `event-unavailable` + gap | [usage-pacing-midflight.md](capabilities/usage-pacing-midflight.md) |
| path-token-resolution | 插件内脚本路径 | launcher + `CC_MASTER_PLUGIN_ROOT` | `protocol-capability-gap` | [path-token-resolution.md](capabilities/path-token-resolution.md) |
| ccm-quota-account | 配额 / 号池 / statusline | billing-period 配额已实现；号池 / statusline / autoswitch 仍 unsupported | `protocol-capability-gap` | [ccm-quota-account.md](capabilities/ccm-quota-account.md) |

生成视图：[`../../capability-parity-matrix.md`](../../capability-parity-matrix.md) · hook 矩阵：[`../../hook-parity-matrix.md`](../../hook-parity-matrix.md)（含 **cursor** 列）。

### N-host 对齐机制（已落盘）

- [ADR-031](../../adrs/ADR-031-n-host-capability-parity.md) — 升 ADR-028 双端锁步为 N-host（Accepted）。
- `plugin/src/hooks/_manifest/hooks.yaml` — 各 hook `host_coverage.cursor`。
- `plugin/src/commands/_manifest/commands.yaml` — 各 command `host_coverage.cursor`。
- `tests/content/capability-host-coverage.test.mjs` — 三 host 均有 strategy 占位。
- `scripts/gen-capability-parity-matrix.sh` — 接入 `run-tests.sh`。

## cc-master Hook 事件映射表

来源：`plugin/src/hooks/_manifest/hooks.yaml` + Claude/Codex 实现对照。

| cc-master hook | `hooks.yaml` stage | Cursor 事件 | 输出改写 | 风险 |
| --- | --- | --- | --- | --- |
| `bootstrap-board` | user-prompt-submit | `beforeSubmitPrompt` (+ command) | 成功 ARM → `{ continue: true, user_message }`；拒 arm → `{ continue: false, user_message }` | sentinel + ccm 硬前置（ADR-021） |
| `reinject` | session-start | `preCompact` + alwaysApply rule | 静默 observe + 常驻 rule | **硬缺口**：无 compaction 全文重注，不用 D4 失效的 `sessionStart.additional_context` |
| `board-lint` | post-tool-use | `postToolUse` matcher `Write` | `additional_context` | Edit→Write；D5 已验证注入到模型 |
| `board-guard` | pre-tool-use | `preToolUse` matcher `Shell\|Write` | `permission: deny` / exit 2 | Bash→Shell |
| `verify-board` | stop | `stop` | **`followup_message`** 替代 `decision:block` | 续跑语义 + `loop_limit` + FUSE 释放阀 |
| `usage-pacing` | stop-and-post-tool-batch | `stop` only | `followup_message` advisory | 无 PostToolBatch 采样段；仅 billing-period provider |
| `identity-nudge` | stop | `stop` | **`followup_message`**（周期 advisory） | 周期写 `runtime.*` 经 ccm 不变；续跑副作用靠冷却节流 |
| `posttool-batch` | post-tool-batch | **无等价** | — | WIP cap 无 batch 边界；需 debounce/省略 |
| `hook-common` | shared-helper | `_hosts/cursor/launcher.js` | — | launcher 已归一化 payload/envelope；manifest 的共享 `hook-common` capability 仍独立标 `planned` |

### `hooks.yaml` `host_coverage.cursor`（已落地）

| hook | cursor 覆盖 |
| --- | --- |
| bootstrap-board | `implemented-fresh-resume` |
| verify-board | `implemented-followup` |
| board-guard | `implemented-deny` |
| board-lint | `implemented-lint` |
| reinject | `implemented-track-b` |
| usage-pacing | `implemented-stop-advisory` |
| identity-nudge | `implemented-stop-advisory` |
| coordination-inbox | `implemented-stop-advisory` |
| posttool-batch | `unsupported` |
| hook-common | `planned` |

## Hard Gaps（摘要 — 详见 Capability Cards）

Track B 缺口已迁入 [`capabilities/`](capabilities/README.md)；下列为速览：

当前 adapter 已发布；下列是已接受的 Track B 差异或仍需补齐的真实 gap，不是“未开工”清单：

1. **Compaction 魂重注（reinject）** — D3/D4 已确认 `sessionStart` 不在 compact 后重触发且 `additional_context` 存在已知 bug。当前替代是精简 `alwaysApply` rule + 静默 `preCompact` observe；它不等价于 Claude 的全文重注。

2. **PostToolBatch** — 不存在。`posttool-batch`（并行 fan-out 后批量 gate）和 `usage-pacing` 的 PostToolBatch 采样段需：debounced `postToolUse`、仅 `stop` 侧 advisory、或省略。

3. **Stop gate 语义** — Claude `decision:block` / exit 2 = 硬阻止结束；Cursor `stop` = `followup_message` 自动续跑（默认 `loop_limit=5`）。verify-board continuation gate 需对齐 Codex 侧经验：续跑须有 FUSE / `runtime.stop_allow_until` 释放阀，避免无限 loop。

4. **Workflow** — 无 Claude dynamic-workflow 等价物；`authoring-workflows` skill 已投影为 `unsupported_stub`（同 Codex）。

5. **Path token** — 无 `${CURSOR_PLUGIN_ROOT}` / `${CURSOR_SKILL_DIR}` 文档；canonical 禁止 `${CLAUDE_*}`。D1 已验证当前 production 解法：hook command 相对 plugin cwd，launcher 用 `__dirname` 并注入 `CC_MASTER_PLUGIN_ROOT`；仍不声称 Cursor 展开 `${PLUGIN_ROOT}`。

6. **Usage / statusline / account pool** — Cursor dashboard `billing_period` 配额已接入 `ccm usage show/advise`；Claude 式外部 statusline、号池与 autoswitch 仍 `unsupported`，且不可把账期伪装成 5h/7d 滚动窗。

7. **Hook 上下文注入可靠性** — 两个事件不能混为一谈：D5 实测 `postToolUse.additional_context` PASS；D4 仍是 `sessionStart.additional_context` 已知 bug。

8. **Cloud Agents** — 非本页 scope；若未来支持，bootstrap/stop/reinject 主路径在 Cloud 上不可用（官方明确缺失 `sessionStart`/`stop`/`beforeSubmitPrompt`）。

## Cloud Agents 能力子集（非目标，仅标注）

官方记载 Cloud agent VM 在 prompt 提交后才 provision，以下 hook **无等价触发点**：

- `sessionStart` / `sessionEnd`
- `beforeSubmitPrompt`
- `stop`
- Tab hooks
- 部分 MCP hooks

仍可用：`preToolUse`/`postToolUse`、shell/file hooks、`subagent*`、`preCompact` 等。

## Probe Catalog（历史问题集）

下表保留 Phase 0 当时的 D1–D12 问题，用于重测新 Cursor 版本；**当前结论以下文 §Probe Results 为准**，不得再把已关闭项写成 adapter 开工前置。Phase 0 工具位于 [`plugin/src/hooks/_hosts/cursor/probes/`](../../plugin/src/hooks/_hosts/cursor/probes/README.md)。

| ID | 问题 | 影响面 |
| --- | --- | --- |
| D1 | Plugin hook `command` 路径：相对 plugin 根？cwd？有无 root token？ | hook registration |
| D2 | Hook 子进程是否保证 `node` 在 PATH | 红线 1 |
| D3 | `sessionStart` 在 compaction 后是否触发 | reinject redesign |
| D4 | `sessionStart.additional_context` 是否到达模型 | reinject / bootstrap |
| D5 | `postToolUse.additional_context` 是否到达模型 | board-lint advisory |
| D6 | `stop.followup_message` + `loop_limit` 与 verify-board FUSE 交互 | stop gate |
| D7 | `conversation_id` 跨 chat 关闭重开 / resume 稳定性 | board `owner.session_id` |
| D8 | 普通 Agent shell（非 hook）是否暴露 `CURSOR_*` | `ccm harness current` |
| D9 | `~/.cursor/plugins/local/` 安装后 hooks/skills/commands 是否全部生效 | install |
| D10 | Third-party Claude hooks 与原生 `hooks.json` 优先级冲突行为 | 迁移策略 |
| D11 | `sessionStart.env` 注入的 `CURSOR_CONVERSATION_ID` 是否被后续 hook 和 subagent 继承 | ccm session + arming |
| D12 | Enterprise 策略是否禁用 local plugins / third-party hooks | ship-anywhere |

### 怎么跑（最短路径）

```bash
# 1) 项目级 hooks（先跑这个）
bash plugin/src/hooks/_hosts/cursor/probes/setup-project-probe.sh
# → 用 Cursor 打开打印出的 probe_root，按 notes/HOW_TO_RUN.md 聊几句

# 2) 本地 plugin 安装面（D9）
bash plugin/src/hooks/_hosts/cursor/probes/setup-local-plugin-probe.sh
# → 在 Cursor Customize 里启用 local plugin，再聊几句
```

填 [`MANUAL_CHECKLIST.md`](../../plugin/src/hooks/_hosts/cursor/probes/MANUAL_CHECKLIST.md)，结果回写下面 **§Probe Results**（`current probe > official docs`）。

## Probe Results

> Status: **complete enough for Phase B** — 2026-07-09. Mix of live dogfood (Cursor **3.10.20**) + official docs + Cursor forum (staff-confirmed bugs).  
> Fixture samples (redacted): [`plugin/src/hooks/_hosts/cursor/probes/fixtures/samples/`](../../plugin/src/hooks/_hosts/cursor/probes/fixtures/samples/).  
> 回写纪律：`current probe > official docs`；docs/forum 结论标来源；未测勿冒充 live PASS。

| ID | Result | Cursor version | Evidence / notes |
| --- | --- | --- | --- |
| D1 | **PASS** (absolute) | 3.10.20 | Project `.cursor/hooks.json` with **absolute** `node …/probe-hook.js` works. Local plugin hooks also work when command embeds absolute plugin path. Hook `cwd` for local plugin = plugin install dir (`~/.cursor/plugins/local/cc-master-hook-probe`). **Token form** (`${PLUGIN_ROOT}` literal) not yet proven — keep absolute / launcher-injected `CC_MASTER_PLUGIN_ROOT` as default. |
| D2 | **PASS** | 3.10.20 | Hook child runs `/opt/homebrew/.../node` v26; `node` on PATH. Red line 1 OK on this host. |
| D3 | **FAIL (gap)** | docs+forum | Official: `sessionStart` = “new composer conversation”; `preCompact` is observational only (cannot inject). Forum [158873](https://forum.cursor.com/t/sessionstart-hook-should-fire-after-compact/158873): users report **no** `sessionStart` after `preCompact`; staff note prior `additional_context` may *survive* compaction as retained first-user-message content, which is **not** a re-fire. **Design:** do not depend on post-compact reinject via `sessionStart`; use alwaysApply rule + `preCompact` observe (Track B card). |
| D4 | **FAIL (known bug)** | docs+forum | Docs claim `sessionStart.additional_context` → initial system context. Forum [158452](https://forum.cursor.com/t/sessionstart-hook-additional-context-is-never-injected-into-agents-initial-system-context/158452): Cursor staff (Dean Rie) confirmed bug — dropped due to composer-handle timing; **`env` works, `additional_context` does not**; no workaround. Contrast: our live **D5 PASS** on 3.10.20 for `postToolUse.additional_context`. **Design:** reinject must not rely on `sessionStart.additional_context`. |
| D5 | **PASS** | 3.10.20 | `postToolUse` `{"additional_context":…}` reached the model as a system reminder (`[cc-master cursor probe] postToolUse: additional_context mode`). Samples: `fixtures/samples/postToolUse.sample.json`. |
| D6 | **PASS (docs)** | official | [Hooks docs](https://cursor.com/docs/hooks.md): `stop` may return `followup_message` → auto-submit as next user message; stdin `loop_count` (starts 0); `loop_limit` default **5**, set `null` to uncap. Same for `subagentStop`. **Design:** verify-board = `followup_message` + app-level FUSE/`stop_allow_until` + respect `loop_count`/`loop_limit` (Codex-shaped release valve). Live followup hijack deferred; contract is sufficient to implement. |
| D7 | **PASS** | 3.10.20 | Within one Agent chat: 18/18 fixtures share the same `conversation_id` == `session_id` (`0f51217b-…`), matching `CURSOR_CONVERSATION_ID` in Agent Shell and the transcript path. Treat as stable arming key for board `owner.session_id` (same role as Claude `session_id`). Close/reopen of the *same* chat not separately re-probed; accepted as stable per Cursor conversation identity + this evidence. |
| D8 | **PASS** | 3.10.20 | Agent Shell exposes `CURSOR_AGENT=1`, `CURSOR_CONVERSATION_ID`, `CURSOR_WORKSPACE_LABEL`, etc. **Hook child env does not** include `CURSOR_*` — use stdin JSON (`conversation_id` / `session_id`) for arming, not hook `process.env`. |
| D9 | **PASS** | 3.10.20 | `setup-local-plugin-probe.sh` → `~/.cursor/plugins/local/cc-master-hook-probe`; pre/postToolUse fixtures written under plugin probe dir **without** manual Customize click (auto-picked up). |
| D10 | **PASS** (combine) | 3.10.20 | Logs show Claude user hooks loaded + project hooks + external `~/.orca/agent-hooks` `beforeShellExecution` all run. Treat as **union**, not exclusive override. |
| D11 | **PASS w/ caveats** | docs+forum | Docs: `sessionStart.env` → “available to all subsequent hook executions” in that session. Staff: `env` path works (unlike `additional_context`). Forum caveats: may **not** survive chat close/reopen or Cursor restart; **subagents may not inherit**. **Design:** optional convenience only; arming SSOT remains stdin `conversation_id` (D7/D8), not injected env. |
| D12 | **N/A** | 3.10.20 | No enterprise hooks config (`No enterprise hooks configuration found`). |

**Payload facts (for launcher design):**

- Events confirmed: `preToolUse`, `postToolUse` (matcher `Shell|Write|Read` — tool names are exactly `Shell` / `Write` / `Read`).
- Common stdin fields: `conversation_id`, `session_id`, `generation_id`, `hook_event_name`, `cursor_version`, `workspace_roots`, `transcript_path`, `tool_name`, `tool_input`, `tool_use_id` (+ `tool_output`/`duration` on post).
- **Phase B/C 历史准入结论：** D1+D2+D5+D6+D7+D8+D9 已足够解锁 adapter；实现现已落地。Track B 继续把 D3/D4 视为确定 gap（alwaysApply + preCompact observe，不依赖 sessionStart context reinject）。

**Cleanup note:** live project `.cursor/hooks.json` removed after capture. Local probe plugin may still be at `~/.cursor/plugins/local/cc-master-hook-probe` — remove with `rm -rf` when done.

## Adapter Delivery Record

以下保留 Cursor adapter 的历史交付顺序：Phase 0 probe → Phase B scaffold → Phase C P0 hooks → 投影 / ccm / install。除 Phase 5 两个真实验收 gap 外，这不是 future sketch。

### Phase 0 — Probe

- [x] Probe 脚本 + 清单：`plugin/src/hooks/_hosts/cursor/probes/`
- [x] 执行 §Probe Catalog D1–D12 → 回写本页 §Probe Results（live + docs/forum）

### Phase 1 — plugin source

| 路径 | 内容 | Status |
| --- | --- | --- |
| `plugin/src/.cursor-plugin/plugin.json` | manifest | **done** |
| `plugin/src/hooks/_hosts/cursor/hooks.json` | 事件注册 | **done** (P0) |
| `plugin/src/hooks/_hosts/cursor/launcher.js` | payload 归一化 + session-state board discovery | **done** (Phase C) |
| `plugin/src/hooks/<hook>/implementations/cursor/` | P0 cores | **done** Phase C: bootstrap / board-guard / board-lint / verify-board |
| `plugin/src/skills/_hosts/cursor/capabilities.yaml` | path token、dispatch、hooks、billing-period quota | **done** |
| `plugin/src/skills/<skill>/adapters/cursor/strategy.yaml` | 八个分发 skill + overlays | **done**：七个 `copy`，`authoring-workflows` 为 `unsupported_stub` |
| `plugin/src/commands/<cmd>/adapters/cursor/strategy.yaml` | host-native command projection | **done**：全部 `mode: host_native` |
| `plugin/src/hooks/_manifest/hooks.yaml` | cursor P0 → `implemented*` | **updated** Phase C |

### Phase C — P0 hook bodies (2026-07-09)

- [x] `bootstrap-board` — beforeSubmitPrompt sentinel + ccm init/arm + session-state (`harness: cursor`)
- [x] `board-guard` — preToolUse deny on Write/Shell hand-edits (`permission: deny`)
- [x] `board-lint` — postToolUse Write → ccm lint → `additional_context`
- [x] `verify-board` — stop → `followup_message` + FUSE=5 + `stop_allow_until`
- [x] launcher: home default `.cc_master`, plugin root `../../..`, session-state discovery
- [x] Track B reinject (alwaysApply rule; not sessionStart.additional_context)
- [x] usage-pacing / identity-nudge Cursor cores（billing_period pacing；stop-path nudge）

### Phase 2 — 投影与打包

- [x] 扩展 `scripts/sync-plugin-dist.sh --host cursor` 全量投影（manifest + commands + skills + rules + hooks + launcher）。
- [x] 扩展 `scripts/package-plugin.sh`：`cc-master-plugin-cursor-<tag>.zip`（含 `rules/`；`--all-hosts` 含 cursor）。
- [x] Release asset 命名对齐 ADR-022 per-harness zip（`plugin-release.yml` 注释 + Validate Cursor packaged adapter 步）。
- [x] `check-plugin-dist-sync.sh` 含 cursor regenerate。

### Phase 3 — ccm

- [x] `ccm/apps/cli/src/harnesses/cursor.ts` — `HarnessAdapter` 实现（local plugin root + dashboard usage）。
- [x] `ccm/apps/cli/src/harnesses/registry.ts` — 注册 `cursorAdapter`。
- [x] Cursor `billing_period` usage：`cursor-usage` + pacing verdict `hold|throttle|stop_billing_period`（无 `switch`）。
- [x] `ccm harness list/current` 分开展示 Cursor IDE plugin 与 `cursor-agent` headless 安装态；registry / render 测试覆盖 only-agent / only-IDE / both / neither / symlink / non-executable。

### Phase 4 — install

- [x] `install.sh`：`--harness cursor`、`install_plugin_cursor`、local plugin 路径 `~/.cursor/plugins/local/cc-master`。
- [x] README / README_zh Cursor 安装段（`--harness cursor`、ccm 硬前置、billing_period 说明）。

### Phase 5 — 测试与 dogfood

- [ ] P0 hooks parity fixture（若双端 implemented）：`tests/hooks/test_parity-fixtures.sh`。
- [ ] 最小 dogfood：bootstrap → arm → guard/lint → stop gate（真 Cursor IDE session）。

### P0 hook 优先级

1. `bootstrap-board` — arm 入口
2. `board-guard` — 写板窄腰保护
3. `board-lint` — PostToolUse lint
4. `verify-board` — stop continuation gate（followup_message 改写）
5. `reinject` — partial（接受 gap，先 alwaysApply 精简 rule）
6. `usage-pacing` / `identity-nudge` — stop-only 降级
7. `posttool-batch` — `unsupported`

## Related

- 兼容矩阵：[`compatibility-matrix.md`](compatibility-matrix.md)
- Capability Cards：[`capabilities/README.md`](capabilities/README.md)
- Capability 矩阵：[`../../capability-parity-matrix.md`](../../capability-parity-matrix.md)
- Hook 矩阵：[`../../hook-parity-matrix.md`](../../hook-parity-matrix.md)
- ccm 耦合审计：[`ccm-host-coupling-audit.md`](ccm-host-coupling-audit.md) §Cursor
- 架构纪律：[`../../.claude/skills/harness-plugin-architecture/SKILL.md`](../../.claude/skills/harness-plugin-architecture/SKILL.md)
- N-host 锁步 ADR：[`../../adrs/ADR-031-n-host-capability-parity.md`](../../adrs/ADR-031-n-host-capability-parity.md)
- Hook 双端 ADR：[`../../adrs/ADR-028-hook-parity-contract-and-normalization.md`](../../adrs/ADR-028-hook-parity-contract-and-normalization.md)
- Claude Code hooks 研究：[`../research/claude-code-hooks-reference.md`](../research/claude-code-hooks-reference.md)
