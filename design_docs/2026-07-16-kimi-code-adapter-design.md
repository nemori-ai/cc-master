# kimi-code Harness Adapter 设计文档（全拓展点）

状态：设计（plan）。日期：2026-07-16。分支：`feat/kimi-code-harness`。

> **实施后勘误（2026-07-21）**：本文是立项时快照；其中“无 CLI 配额信号”仍是 Kimi CLI
> 本身的事实，但“不存在 ccm quota 读面”已被后续实现取代。当前 `kimi-usages-api` collector
> 可读 current-login 滚动 5h/7d，并可带锁刷新过期 stored OAuth；account pool、external
> statusline 与非阻断 Stop pacing hook 仍 unsupported。当前状态以 Capability Cards、
> [`harnesses/kimi-code.md`](harnesses/kimi-code.md) 与实现为准，本文旧 gap 表只作设计沿革。

本文是 kimi-code（Moonshot AI 官方终端 AI coding agent CLI，本机 v0.26.0）作为 cc-master **第四 host**（`claude-code / codex / cursor / kimi-code`）的完整适配设计，作为下游实现任务 **K3（SAP skills+commands 投影）/ K4（PHIP hooks 投影）/ K5（ccm harness/worker/enum）/ K6（端到端实测+收口）/ K8B（模型档位落点）** 的 plan。每节的实施边界切到「拿到即可动手」。

**事实基座**：[`design_docs/harnesses/kimi-code.md`](harnesses/kimi-code.md)（K1 实测——本文所有 kimi 事实以它为准，§12/§13 是本文的任务书种子）。相关先例：[`design_docs/harnesses/compatibility-matrix.md`](harnesses/compatibility-matrix.md)、Cursor 双轨范式 [`adrs/ADR-031-n-host-capability-parity.md`](../adrs/ADR-031-n-host-capability-parity.md)、hook CONTRACT [`adrs/ADR-028`](../adrs/ADR-028-hook-parity-contract-and-normalization.md)、注入标签 [`adrs/ADR-018`](../adrs/ADR-018-hook-agent-message-protocol.md)。

**一句话结论**：kimi-code 与 **Cursor 结构最像**（受限 host：无自定义 subagent 角色、无 Workflow、无 PostToolBatch、无 CLI 配额信号），但在**三处比 Cursor 强**——① 有 documented 文本 token `${KIMI_SKILL_DIR}`；② 有原生 plugin `commands[]`（namespaced `cc-master:<command>`）；③ 有 `PostCompact` 事件（reinject 可能有原生落点，待 probe）。因此 kimi adapter = **以 Cursor adapter 为蓝本 + 三处 Track A 升级 + kimi 专属注入 envelope 改写**。

---

## 0. Track A / Track B / gap 三分总览

按 ADR-031 双轨：**Track A** = SAP/PHIP 1:1 直投影；**Track B** = 有能力缺口、须 Capability Card 声明替代；**gap** = 无等价物、显式声明（不硬造 wrapper 逼平，用户已确认此口径）。

| 拓展点 | 分轨 | kimi 落地形态 | 依据（kimi-code.md） |
| --- | --- | --- | --- |
| 分发 skills（7 个 copy） | **A** | canonical + `${KIMI_SKILL_DIR}` 文本 token；slot overlays 起于 cursor | §3 skills、§12.1/§12.3 |
| `authoring-workflows` skill | **gap** | `unsupported_stub`（无 Workflow 等价物） | §7、§12.8 |
| commands（6 个） | **A** | manifest `commands[]` host_native（`cc-master:<command>`） | §4、§12.6、§14 Q2 |
| bootstrap 入口 | **A** | host_native command + UserPromptSubmit hook 双通道（首行 sentinel） | §12.6 |
| hook: bootstrap-board | **A** | UserPromptSubmit（manifest `hooks[]`） | §6、§12.4 |
| hook: board-guard / board-lint | **A** | PreToolUse / PostToolUse（matcher `Bash\|Write\|Edit`） | §6 事件全集 |
| hook: verify-board / usage-pacing / identity-nudge / coordination-inbox | **A/B** | Stop（continuation 语义待 probe；默认 advisory `message`） | §6、§10 approval |
| hook: orchestrator-context | **A/B** | SessionStart（+ 无 PostToolBatch delta） | §6、§12 |
| hook: reinject（魂重注） | **A?/B** | **PostCompact probe 决定**：可注入→原生 Track A；否则 `sessionStart.skill`/AGENTS 静态 Track B | §12.5、§14 待 probe |
| hook: posttool-batch | **gap** | `unsupported`（无 PostToolBatch 事件） | §6、§12.8 |
| 注入 envelope | **B** | `message` / `hookSpecificOutput.permissionDecision="deny"`（非 `additionalContext`/`systemMessage`） | §6、§11、§12.2 |
| 自定义 subagent 角色 | **gap** | 无——仅内置 coder/explore/plan/general + swarm（Capability Card `protocol-capability-gap`） | §7、§12.8 |
| ccm worker（`kimi -p`） | **A** | `kimi -p --output-format stream-json` raw 会话绑定 wrapper（4th harness） | §13、cross-harness-session-bound-worker |
| ccm quota / usage 信号 | **gap** | `unsupported`——无 CLI 配额面，`readCurrentUsage` 返 `signal:null` | §10 Quota、§13.7 |
| ccm account pool / switch | **gap** | `NotImplemented`（号池绑 Claude OAuth） | §7、ccm-quota-account |
| path token（skill 正文） | **A** | `${KIMI_SKILL_DIR}` 文本替换（比 Cursor null token 强） | §3、§14 Q4 |

---

## 1. 总策略

### 1.1 kimi-code 作第四 host 的定位

- **单 id `kimi-code`**（origin + headless worker 同一 id，同 codex；**不做** cursor 那种 `cursor` / `cursor-agent` 的 IDE/CLI 双 id 拆分——kimi 就是一个 `kimi` 二进制既作 origin plugin 面又作 `kimi -p` worker 面）。origin plugin 与 headless worker 仍是**独立 bounded context**：installed / auth / model / quota 不跨 surface 推导（compatibility-matrix 已立此纪律），但 harness id 字符串统一为 `kimi-code`。
- **能力边界内最大适配**：能 1:1 投影的走 Track A；无等价物按 Capability Card 显式声明为 gap（用户已确认——**不硬造 wrapper 逼平**）。
- **蓝本 = Cursor adapter**：`plugin/src/hooks/_hosts/cursor/`（launcher.js + cores + envelope）、`plugin/src/skills/_hosts/cursor/capabilities.yaml`、cursor 命令 host_native 模式，是 kimi 最近的可复制先例。差异集中在**注入 envelope**（`message` vs `additional_context`）、**hook 注册形态**（manifest 内联 `hooks[]` 数组 vs 独立 `hooks.json`）、**tool 名**（kimi 用 `Bash`，非 cursor 的 `Shell`）、**武装键**（kimi `session_id`，非 cursor `conversation_id`）。

### 1.2 「新 host 的 walking skeleton」比「新 feature」大——KNOWN_HOSTS 全或无约束

**关键约束（先读，决定整个实施节奏）**：`tests/content/capability-host-coverage.test.mjs:7` 有 `const KNOWN_HOSTS = ['claude-code', 'codex', 'cursor'];`。一旦把 `kimi-code` 加进这个数组，测试立即要求：

1. **每个** required command 都有 `adapters/kimi-code/strategy.yaml`；
2. **每个**分发 runtime skill 都有 `adapters/kimi-code/strategy.yaml`；
3. `hooks.yaml` 里**每个** hook 都有 `host_coverage.kimi-code`；
4. `plugin/src/skills/_hosts/kimi-code/capabilities.yaml` 存在。

且另有三处**独立的 `assertExactKeys` 硬闸**（比 KNOWN_HOSTS 更早触发，只要往对应 registry 加 kimi-code 就必须同步加 host 常量，否则 `sync-plugin-dist.sh` 直接抛错）：

- `scripts/provider-guidance-attestation.cjs:10` `HOSTS = ['claude-code','codex','cursor']` + registry `plugin/src/skills/provider-guidance-runtime.json` 的 `hosts:`；
- `scripts/pacing-read-only-capability.cjs:17-19` `HOST_PROFILES`（每个 skill 的 pacing registry `hosts:`）；
- `sync-plugin-dist.sh:53` 的 full-adapter host allowlist（链式字符串比较，非数组）。

**推论**：新 host 的 walking skeleton **必然是整张 adapter 矩阵一次成立**——skills（8）+ commands（6）+ hooks（11）+ manifest 全部有 kimi-code 条目（多数取**最廉价的合法形态**：copy / unsupported_stub / host_native / host_coverage 声明 + 最小 core），且 `sync --host kimi-code` 端到端成功、`dist/kimi-code` 落盘，才能翻 `KNOWN_HOSTS` 绿。增强项（PostCompact reinject、配额配速、rich worker driver、account）排在其后。

### 1.3 walking skeleton 定义（一句话）

> **装上 kimi-code plugin 后，用户敲 `cc-master:as-master-orchestrator <goal>` 能经 UserPromptSubmit bootstrap hook 建板+武装、SKILL A 经 skills 面被 model 触发内化身份、board-guard/board-lint/verify-board 最小 hook 链在武装后生效——即「装上能用」的最小 origin 编排闭环。** reinject 原生落点（PostCompact）、配额配速、rich worker driver、account 均为增量。

约束（用户已定）：**先让 skeleton 成立，增强排后；PostCompact probe 设计成 K4 的第一个动作而非阻塞前置**（skeleton 不依赖 reinject 原生落点，reinject 先走 Track B 静态 substrate，probe 通过后再升级为原生 core）。

---

## 2. SAP（8 个分发 skill）

分发 skill 源在 `plugin/src/skills/<skill>/canonical/` + `adapters/<host>/strategy.yaml`。投影引擎 `sync-plugin-dist.sh:375-500`：读 `mode`（默认 copy）+ `slot_replacements`（`{{TOKEN}}` → overlay 文件）+ `runtime_contracts`（provider_guidance / pacing 两道 attestation）。

### 2.1 逐 skill strategy 选型

| skill | kimi mode | 理由 | slot 数（对齐 codex） |
| --- | --- | --- | --- |
| `master-orchestrator-guide` | **copy** | 主线编排决策 harness-neutral；dispatch/watchdog 走 slot（kimi≈cursor） | 24 slots |
| `using-ccm` | **copy** | ccm 操作面 harness-neutral；account/statusline/watchdog/executor 走 slot | 45 slot refs |
| `pacing-and-estimation` | **copy** | 消费只读 advisory；kimi 无配额信号 → pacing overlay 声明 unsupported | 3 slots |
| `slicing-goals-into-dags` | **copy** | 方法论 harness-neutral | 1 slot |
| `dev-as-ml-loop` | **copy** | 执行循环形状 harness-neutral | 0 |
| `engineering-with-craft` | **copy** | 工程手艺 harness-neutral | 0 |
| `distilling-lessons-into-assets` | **copy** | 资产路由 harness-neutral | 0 |
| `authoring-workflows` | **unsupported_stub** | **kimi 无 Workflow 等价物**（同 codex/cursor）；stub 保留路由 description + gap 边界 | — |

**优先 canonical + slot（红线：partial 是战术勤奋、战略偷懒）**：7 个 copy skill 全部走 canonical + slot，**不新建 `partial/SKILL.md`**。仅 `authoring-workflows` 走 `unsupported_stub`（须写 `mode: unsupported_stub` + `source: adapters/kimi-code/stub/`，并删除任何未引用 payload——skill-lint check(9) 拒绝 stale payload）。stub 的 `description` 必须保留中文路由语言 + `Do NOT use` + gap 边界（skill-lint 会扫 adapter stub description）。

**overlay 起点**：kimi ≈ cursor（受限 host），故 kimi overlay **拷 cursor overlay 为起点**再改 kimi 专属差异：
- **tool 名 = `Bash`**（kimi 后台任务用 Bash 工具，非 cursor 的 `Shell`）——凡 overlay 提「用 Shell 工具派发」改回「用 Bash 工具」。
- **subagent = 内置角色**（coder/explore/plan/general + Agent Swarm，`subagent_type` 入参）——比 cursor Task 更受限（无自定义角色），overlay 的 executor 表要标「仅内置角色，记 host 返回的 agent id 作 handle」。
- **watchdog = background-shell floor**（kimi 有 `KIMI_DISABLE_CRON`/`KIMI_CRON_*` env 但**无 agent-facing cron 工具面** [unresolved]）——同 cursor：降级链只到 `background_shell_until`，**不教** CronCreate/ScheduleWakeup/Monitor。
- **provider/quota overlay 声明 unsupported**（kimi 无 CLI 配额信号——见 §6 ccm quota gap）。

### 2.2 path token 映射规则（deliverable）

投影引擎**只 rewrite `{{UPPER_SNAKE}}` slot**（`sync-plugin-dist.sh:115-124,262-272`，未解析残留即 fail-closed 抛错），**从不碰 `${...}` runtime token**。kimi 的 token 事实（kimi-code.md §3/§5/§14）：

- `${KIMI_SKILL_DIR}` / `${KIMI_SESSION_ID}` = **文本替换**（`content.replaceAll`，可靠）——skill 正文引用**随 skill 分发的自有资源**用 `${KIMI_SKILL_DIR}/...`。
- `${KIMI_PLUGIN_ROOT}` 在正文**不做文本替换**（grep count=0）——它只是 hook/MCP 子进程 env。**正文禁写它**。
- canonical 正文**禁写 `${CLAUDE_*}`**（受众纪律：host-neutral）。

**映射规则**（K3 落地）：

1. **canonical 现状是干净的**：canonical skill body 里 `${CLAUDE_SKILL_DIR}` = 0 处；`${CLAUDE_PLUGIN_ROOT}` 仅出现在 `master-orchestrator-guide/canonical/references/cost-decisions.md`（4 行、13 处），而该文件**已被 codex/cursor `exclude_canonical` 排除**。故 kimi **照样 `exclude_canonical: [references/cost-decisions.md, references/handoff.md, scripts/codex-review.sh]`**（与 codex 一致），投影后 kimi dist skills 里**零 `${CLAUDE_*}` token**——不需要主动 rewrite。
2. **未来若 kimi skill 正文需引用自有 bundled 资源**：由 kimi adapter overlay 写 `${KIMI_SKILL_DIR}/...`（kimi 文本替换），**不用** `${KIMI_PLUGIN_ROOT}`，**不用**裸相对路径。
3. **跨 skill 引用**保持裸 skill 名（不带 `/`，合法）——kimi 无 plugin-root 正文 token，不能用 `${CLAUDE_PLUGIN_ROOT}/skills/X/...` 那种形态（会成死链），故跨 skill 只提名字（skill-lint check(4) Finding #50 对此仍适用，`${KIMI_SKILL_DIR}` 不匹配其 `${CLAUDE_*}` 正则，天然不误报）。

### 2.3 `skills/_hosts/kimi-code/` base 该有什么

对齐 `skills/_hosts/cursor/`：
- `AGENTS.md`（~1KB）——kimi skill host base，记 kimi skill 发现路径（`$KIMI_CODE_HOME/skills/`、`~/.agents/skills/`、`.kimi-code/skills/`、`.agents/skills/`）、`${KIMI_SKILL_DIR}` 文本替换事实、SKILL.md frontmatter 别名表（`whenToUse`/`disableModelInvocation`/`type`/`arguments`）、投影规则（不 copy claude-only 指导、无端能力用 unsupported_stub、禁造 `${KIMI_PLUGIN_ROOT}` 正文 token）。
- `capabilities.yaml`——kimi host 能力矩阵（**直接以 cursor 的 capabilities.yaml 为模板**），关键差异字段：`path_tokens.skill_dir: "${KIMI_SKILL_DIR}"`（有！区别于 cursor 的 null）；`background_dispatch.subagent`（内置角色、`subagent_type` 入参、无自定义）；`background_dispatch.workflow.available: false`；`command_surface.status: host_native_commands_md`（namespaced `cc-master:<command>`）；`hooks`（见 §3）；`quota_signal.status: unsupported`（无 CLI 面）；`account_switch.status: unsupported`；`watchdog_wakeup: degrade_to_shell_floor`。

---

## 3. PHIP（hooks）

hooks 源结构：`_manifest/`（hooks.yaml + injection-contracts.yaml + lifecycle-stages.yaml）+ `_hosts/<host>/`（注册 + launcher）+ `<hook>/implementations/<host>/`（meta.yaml + core.js）+ `<hook>/CONTRACT.md`（host-neutral 业务 SSOT）+ `_shared/`（共享 helper）。

### 3.1 kimi.plugin.json `hooks[]` 投影形态（最大结构差异）

kimi hook 注册 = manifest **内联 `hooks[]` 数组**（`{event, matcher?, command, timeout?}`，kimi-code.md §4/§6 HookDefSchema），**不是**独立 `hooks.json` 文件（区别于 codex/cursor 的 `"hooks": "./hooks/hooks.json"`）。事件枚举必填、matcher 是 regex 字符串、command min1、timeout 1–600 默认 30。

**command 字符串纪律**（kimi-code.md §5）：kimi hook 子进程 env 只有 `KIMI_CODE_HOME` + `KIMI_PLUGIN_ROOT`（无 `PLUGIN_ROOT`/`CLAUDE_*` 别名），cwd = 插件 managed 目录。**hook command 字符串本身不展开 `${KIMI_PLUGIN_ROOT}`**（它是子进程 env，非 command token，与 codex `${PLUGIN_ROOT}` 语义相反）。可靠形态两选一：

```jsonc
// 形态 A（推荐，显式 env，由执行 command 的 shell 展开 $KIMI_PLUGIN_ROOT）：
{ "event": "UserPromptSubmit",
  "command": "node \"$KIMI_PLUGIN_ROOT/hooks/_hosts/kimi-code/launcher.js\" --event UserPromptSubmit --core \"$KIMI_PLUGIN_ROOT/hooks/bootstrap-board/implementations/kimi-code/bootstrap-board-core.js\"",
  "timeout": 30 }
// 形态 B（cwd=managed dir，相对路径 + launcher __dirname 自解析，同 cursor）：
{ "event": "UserPromptSubmit",
  "command": "node \"./hooks/_hosts/kimi-code/launcher.js\" --event UserPromptSubmit --core \"./hooks/bootstrap-board/implementations/kimi-code/bootstrap-board-core.js\"" }
```

**推荐形态 A**（`$KIMI_PLUGIN_ROOT` 是 kimi 对 plugin hook 的 documented 保证；launcher 再以 `KIMI_PLUGIN_ROOT` env 或 `__dirname` 兜底）。**投影生成**：`sync-plugin-dist.sh` 的 kimi 分支读 `_hosts/kimi-code/hooks.fragment.json`（该 `hooks[]` 数组片段）并**内联进 `kimi.plugin.json` 的 `hooks` 字段**（这是唯一新增的 manifest 合成逻辑；skills/commands 仍是路径字符串）。

### 3.2 逐 hook 事件映射与落地

以 `hooks.yaml` 实际清单为准（11 项）。kimi 事件全集含 `UserPromptSubmit / PreToolUse / PostToolUse / PostToolUseFailure / PermissionRequest / PermissionResult / SessionStart / SessionEnd / SubagentStart / SubagentStop / Stop / StopFailure / Interrupt / PreCompact / PostCompact / Notification`，**无 PostToolBatch**。

| hook | kimi 事件 | matcher | 注入 envelope | 武装 | walking skeleton? | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| bootstrap-board | `UserPromptSubmit` | — | `message`（fresh/resume 上下文） | 唯一豁免（ARM 本身） | **是** | 首行 sentinel/prefix 识别，snake_case `prompt` **数组**取 `[0].text` |
| board-guard | `PreToolUse` | `Bash\|Write\|Edit\|MultiEdit` | `permissionDecision="deny"` + reason | `arm:'custom'` | **是** | 拦直接改 board 文件；kimi 无 apply_patch（用 Write/Edit），比 codex 判定简单 |
| board-lint | `PostToolUse` | `Write\|Edit\|MultiEdit` | `message`（advisory） | `arm:'custom'` | **是** | 编辑 board 后经 `ccm board lint` 出软提示 |
| verify-board | `Stop` | — | `message`（默认 advisory；probe 后可 deny-block） | `arm:'custom'` | **是** | 见 §3.4 Stop continuation |
| reinject | `PostCompact`（probe）/ `SessionStart` | — | `message`（动态板列表） | `arm:'boards'` | Track B 先行 | **K4 第一个动作 probe**，见 §3.5 |
| orchestrator-context | `SessionStart` | — | `message`（cached ccm 上下文） | `arm:'boards'` | 否（增量） | 无 PostToolBatch delta 段 |
| usage-pacing | `Stop` | — | `message`（仅在有配额信号时；kimi 无 → 恒静默/降级） | `arm:'boards'` | 否（降级） | kimi 无 CLI 配额 → 基本静默 |
| coordination-inbox | `Stop` | — | `message` | `arm:'boards'` | 否（增量） | 多 orchestrator 协调，复用 `_shared/coordination-inbox-delivery.js` |
| identity-nudge | `Stop` | — | `message`（周期身份/临界路径提示） | `arm:'custom'` | 否（增量） | 经 `ccm board set-param` 写 `runtime.last_identity_remind`/`last_critpath_remind` |
| posttool-batch | **unsupported** | — | — | — | 否（gap） | 无 PostToolBatch 事件（Capability Card `event-unavailable`） |
| hook-common | shared-helper | — | — | — | — | `host_coverage.kimi-code: planned`（kimi launcher 自带 normalize，同 cursor 不强依赖 runHook） |

### 3.3 `_hosts/kimi-code/launcher.js` + stdin 适配 + envelope 改写

**以 `_hosts/cursor/launcher.js` 为蓝本**，kimi 专属改动：

1. **event 名映射**（kimi 事件是 PascalCase）：`UserPromptSubmit→user-prompt-submit`、`SessionStart→session-start`、`PreToolUse→pre-tool-use`、`PostToolUse→post-tool-use`、`Stop→stop`、`PostCompact→post-compact`、`PreCompact→pre-compact` 等（launcher 的 `eventName()` camel/pascal→kebab 已能自动降格，只需补 explicit 表）。
2. **stdin 已是 snake_case**（`toHookInputData` 的 `camelToSnake`）——比 cursor 省一层，直接读 `hook_event_name` / `session_id`（`session_<uuid>`）/ `cwd`。
3. **`prompt` 是 content-block 数组** `[{type:"text",text:"..."}]`（区别于 CC 纯字符串）：normalize 时取 `raw.prompt?.[0]?.text`（或 join 所有 text block），落 `normalized.prompt.text`。
4. **武装键 = `session_id`**（非 cursor `conversation_id`）：`discoverActiveBoard(home, session_id)`，session-state（`<home>/sessions/<sid>.json`）→ board-scan（`owner.active` + `owner.session_id`）。**只读窄腰**（红线2）。
5. **注入 envelope 改写**（核心适配点，kimi-code.md §6/§12.2）——core 返回 `{kind, context/message}`，launcher 映射到 kimi：
   - `kind: context/system` → `{"message": "<text>"}`（top-level）或 `{"hookSpecificOutput":{"message":"<text>"}}`（**非** CC `additionalContext`、**非** codex `systemMessage`）。
   - `kind: block/deny` → `{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"<reason>"}}`。
   - `kind: silent/allow` → 空 stdout（exit 0）。
   - ADR-018 的 `<ambient>/<advisory strength=…>/<directive source=…>` 标签**写进 `message` 文本体**（reinject 除外——substrate exemption）。
6. **plugin root**：`process.env.KIMI_PLUGIN_ROOT`（kimi 注入）优先，否则 `path.resolve(__dirname, '..','..','..')`。
7. **cc-master home ≠ kimi home**：`CC_MASTER_HOME` 优先，否则 `$HOME/.cc_master`——**与 `KIMI_CODE_HOME` 无关**（kimi home 只放 kimi 自己的东西；board 在 cc-master home）。
8. 注入 `CC_MASTER_HARNESS=kimi-code` + `CC_MASTER_PLUGIN_ROOT` + `CC_MASTER_HOME` + `CC_MASTER_BOARD*` 给 core（`_shared/contract.md` 归一化 env）。
9. **fail-open**：core 缺失/崩溃/异常静默放行，绝不卡死 agent（同 cursor launcher）。

### 3.4 逐 hook core：多数直接复用 codex core

cores 读的是**归一化 payload**（launcher 已转），envelope 差异全在 launcher，**core 与 codex 高度同构**。落地策略：`implementations/kimi-code/*-core.js` **以 codex core 为起点拷贝**（bootstrap-board-core.js 537 行、reinject-core.js 153 行、verify-board-core.js 299 行、board-guard-core.js 592 行、board-lint / usage-pacing / identity-nudge / coordination-inbox / orchestrator-context 同理），去掉 codex 专属分支（apply_patch lexer、`stop_allow_until` 若 kimi Stop 语义不同、multi_agent tool_search hint），保留武装判定 + ccm 进程边界调用 + `{kind,message}` 返回。共享逻辑仍 `require('../../_shared/...')`（coordination-inbox-delivery / orchestrator-context-core / machine-quota-status）。

**Stop continuation 语义（probe 项）**：codex 的 verify-board 用 `decision:block` 让 Stop 续跑 + `runtime.stop_allow_until` 释放阀。kimi Stop-block 是否续跑 [未实测]——K4 probe：`hookSpecificOutput.permissionDecision="deny"` 在 `Stop` 事件是「阻断停止 = 续跑」还是「纯阻断」？
- **probe 通过（Stop-deny 续跑）** → verify-board 走 deny-block 硬门（同 codex，带 `runtime.stop_allow_until` 释放阀，防无限重入）。
- **probe 不通过** → verify-board 降级为 Stop `message` advisory 硬提示（同 cursor followup 精神，非阻断），Capability Card 记 `protocol-capability-gap`。walking skeleton 先用 advisory 形态（不阻塞 skeleton）。

### 3.5 reinject（魂重注）—— K4 第一个动作 probe，两分支

kimi 有 `PreCompact` + `PostCompact`（比 cursor 只有 observe 型 preCompact 强）。**probe（K4 首动作，非阻塞前置）**：`PostCompact` hook 的 `message` 能否注入 compaction 后的 agent context？（外加：`SessionStart` 是否在 compaction 后 re-fire？）

- **分支 1：PostCompact 可注入 `message`** → reinject core 挂 `PostCompact`（+ `SessionStart` 双挂 startup/resume），动态列本 session active board + goal + 空板硬停 + stale/escalated 节点——**原生 Track A**，优于 cursor 的静态 alwaysApply。这是 kimi adapter 的潜在优势项。
- **分支 2：PostCompact 不能注入且 SessionStart 不 re-fire** → Track B 分层替代（同 cursor 精神）：① reinject core 在 PostCompact 静默 no-op；② 静态 role substrate 走 **`sessionStart.skill`**（见 §5.2 论證）+ 项目根/`.kimi-code` `AGENTS.md` 指针；Capability Card `role-substrate-reinject.md` 加 kimi-code 行 `protocol-capability-gap`。

**walking skeleton 不依赖分支 1**：skeleton 期 reinject 先落 Track B 静态形态（`sessionStart.skill` 挂一个 slim 身份 substrate skill），probe 通过后 K4 再把它升级为 PostCompact 原生 core。

### 3.6 CONTRACT.md 增补 + PARITY anchors + 归一化桥接

- 每个多端 `implemented*` hook 的 `CONTRACT.md`（bootstrap-board / verify-board / usage-pacing / coordination-inbox / identity-nudge / reinject / orchestrator-context / board-lint / board-guard）**加 kimi-code**：要么在 required host 里补等价实现，要么在「降级行为」节声明 kimi 分叉（三分类学 `event-unavailable`/`protocol-capability-gap`/`host-convention-divergence`）。
- **PARITY anchors**：walking skeleton 期，把 kimi-code **暂不列入** `required_hosts`（同 cursor Track B 处理——避免逼平未验证语义），改在 Capability Card 声明等价类；能力验证后再纳入 anchors。凡纳入 anchors 的 rule，kimi core 里须能 grep 到 `// PARITY: rule-<id>` 结构锚点。
- **归一化桥接（ctx.normalized，ADR-028）**：kimi launcher 的 `normalize()` 产出即 `_shared/contract.md` 的归一化 payload；`hook-common.js` 的 `normalizePayload`/`ctx.normalized`（parity fixture 收敛单点）加 `harness:'kimi-code'` 分支（把 kimi snake_case + `prompt` 数组归一到同一 `ctx.normalized`）。行为级 parity fixture（`tests/hooks/test_parity-fixtures.sh`）用同一份 host-neutral stdin 跑 kimi core，断言判定落同一等价类。

---

## 4. commands

### 4.1 manifest `commands[]` host_native（Track A，优于 codex）

kimi 有原生 plugin `commands[]`（manifest 字段，指向 `./commands/*.md` 或目录），命令面 `<plugin>:<command>` = `cc-master:as-master-orchestrator` 等（namespaced 单级，kimi-code.md §4/§14 Q2）。因此 6 个 command 全部 **`host_native`**（同 cursor，优于 codex 的 `adapter_guidance`）：

- `commands/_hosts/kimi-code/strategy.yaml`：`native_surface: "plugin-commands-plus-UserPromptSubmit"`、`required_mode: host_native`、`output_extension: ".md"`。
- 每个 command `<cmd>/adapters/kimi-code/strategy.yaml`：`mode: host_native`、`projection.source: body.md`、`target: commands/<cmd>.md`。body.md **以 cursor body.md 为起点**改 kimi 专属（tool 名 `Bash`、武装键 `session_id`）。
- **命名冲突**：kimi 命令 namespaced `cc-master:<command>`，`cc-master:stop` 天然不撞任何内置 `/stop`（namespaced），**无需** cursor 那样 rename 为 `cc-master-stop`——但为跨 host 一致，保留源目录名 `stop`，投影 `commands/stop.md`（frontmatter `name: stop`，命令面呈现 `cc-master:stop`）。
- **capability-host-coverage 测试**：line 74-76 只硬断言 cursor mode==host_native；kimi 只需 `adapters/kimi-code/strategy.yaml` 存在（line 62 循环）。设 host_native 满足且更强。

### 4.2 bootstrap 入口 sentinel 双通道

同 codex/cursor：**host_native command + UserPromptSubmit hook 首行 sentinel 识别**双通道。
- 通道 1：用户敲 `cc-master:as-master-orchestrator <goal> [flags]`（native command）→ body.md 注入初始化指导（含 `<!-- cc-master:bootstrap:v1 -->` sentinel + `<!-- cc-master:args: $ARGUMENTS -->`）。kimi body 参数用 `$ARGUMENTS`（kimi-code.md §3：无占位符+传参时 body 末尾追加 `ARGUMENTS: <args>`，或用 `$ARGUMENTS` 显式占位）。
- 通道 2：`bootstrap-board-core.js`（UserPromptSubmit hook）读 `prompt` **数组第一 block 的 text**，判首行是否以 bootstrap prefix 开头（`cc-master:as-master-orchestrator` / `cc-master:cc-master-as-master-orchestrator` / 兼容 `$cc-master...` 写法），命中即建板+武装（fresh/resume）。板选定/所有权/武装全在 hook，command body 只读注入 context 判 mode。
- **sentinel 只在首行独立成行触发**（Finding #16），内联提及不触发。

---

## 5. manifest / 打包

### 5.1 `kimi.plugin.json` 内容设计

```jsonc
{
  "name": "cc-master",                    // 必填；kebab/alnum，cc-master 合法
  "version": "0.20.1",                    // 跟随 plugin 线版本
  "description": "Turn a kimi-code session into a long-horizon master orchestrator through the cc-master adapter.",
  "skills": "./skills/",
  "commands": "./commands/",
  "hooks": [ /* 内联数组，见 §3.1，由 sync 从 _hosts/kimi-code/hooks.fragment.json 合成 */ ],
  "sessionStart": { "skill": "cc-master-role-substrate" },  // reinject 锚（见 §5.2 论證）
  "skillInstructions": "…",               // 可选：全局 skill 使用提示
  "author": { "name": "cc-master contributors" },
  "license": "PolyForm-Noncommercial-1.0.0",
  "interface": {
    "displayName": "cc-master",
    "shortDescription": "Long-horizon master orchestrator adapter",
    "longDescription": "cc-master provides skills, commands, and harness hooks for long-horizon orchestration.",
    "developerName": "cc-master contributors",
    "websiteURL": "…"
  }
}
```

- **忽略字段**（kimi-code.md §4 `UNSUPPORTED_RUNTIME_FIELDS`）：`tools/apps/inject/config_file/bootstrap` 写了也不生效——**不要写**。
- **无 `agents` 字段** → plugin 不能声明自定义 subagent（Capability Card gap）。
- **name 正则**：kimi 只 documented「必填」，无明确 regex；`cc-master`（kebab）安全。

### 5.2 `sessionStart.skill` 是否用于 reinject 锚定——论證

**结论：作为 reinject 的 Track B 静态 substrate 锚是合适的、但不是动态 reinject 的完整等价。**

- `sessionStart.skill` 命名一个 session 启动时调用的 skill——可用来在每次 session start **静态 re-prime 身份**（一个 slim「你是 master orchestrator」substrate skill，类比 cursor 的 alwaysApply rule）。
- **局限**：① 它是**静态 skill 内容**，无法注入动态板列表 / 空板硬停 / stale 节点（那些要 hook `message`）；② 是否在 **compaction 后 re-fire** 未知（cursor D3 同类问题，待 probe）。
- **落地判断**：
  - walking skeleton：`sessionStart.skill` = `cc-master-role-substrate`（新建的 slim substrate skill，仅身份 + 红线摘要 + 空板硬停指针，`disableModelInvocation` 可选），作 Track B 静态托底。
  - 若 §3.5 probe 分支 1 成立（PostCompact 可注入）：动态 reinject 走 PostCompact hook core，`sessionStart.skill` 退为「首次 session 身份 priming」的补充锚（两者不冲突，layered）。
  - 若分支 2：`sessionStart.skill` 是主 substrate 通道（+ AGENTS.md 指针）。
- 与 KNOWN_HOSTS 全或无无关（manifest 字段，不影响测试矩阵）。

### 5.3 `plugin/dist/kimi-code/` 目录结构

```
plugin/dist/kimi-code/
├── kimi.plugin.json          ← 根 manifest（primary；由 sync 从 .kimi-plugin/plugin.json 投影+改名+内联 hooks[]）
├── skills/<skill>/…          ← SAP 投影（copy + slot resolved）
├── commands/<cmd>.md         ← host_native 命令体
├── hooks/
│   ├── _hosts/kimi-code/launcher.js
│   ├── _shared/*.js
│   └── <hook>/implementations/kimi-code/*-core.js
├── docs/ agents/ bin/        ← package 通用目录
```

（注：kimi manifest 是**根文件** `kimi.plugin.json`，不是 `.kimi-plugin/` 目录——与三个 `.{host}-plugin/` 约定不同，sync/package 需特判，见 §5.4/§9。）

### 5.4 `sync-plugin-dist.sh` 改动清单（K3 owns）

1. **line 53** full-adapter host allowlist：链式加 `&& [ "${HOST}" != "kimi-code" ]`。
2. **lines 65-77** `manifest_dirs` 分支：加 kimi-code 分支——源 `plugin/src/.kimi-plugin/plugin.json` → dist **根 `kimi.plugin.json`**（改名 + 合成内联 `hooks[]`）。这是唯一 manifest 合成新逻辑。
3. **hooks 投影**（lines 513-553）：kimi 分支——copy `_hosts/kimi-code/launcher.js` + `_shared/*.js` + `<hook>/implementations/kimi-code/*`（layout 同 codex/cursor：`dist/kimi-code/hooks/<hook>/implementations/kimi-code/`），并把 `_hosts/kimi-code/hooks.fragment.json` 的 `hooks[]` 内联进 manifest（步骤 2）。**kimi 不产 `hooks.json` 文件**。
4. `scripts/check-plugin-dist-sync.sh`：**line 27 后**加 `bash scripts/sync-plugin-dist.sh --host kimi-code`（**整合期加**——须 K3+K4 都落地、`sync --host kimi-code` 端到端成功后）。
5. `scripts/provider-guidance-attestation.cjs:10` `HOSTS` 加 `'kimi-code'` + `plugin/src/skills/provider-guidance-runtime.json` `hosts:` 加 kimi-code 块（**同一原子改**，否则 assertExactKeys 抛）。
6. `scripts/pacing-read-only-capability.cjs:17-19` `HOST_PROFILES` 加 kimi-code profile（honest `unsupported`/`unknown`）+ 每个 skill 的 pacing registry `hosts:` 加 kimi-code 键。

### 5.5 install.sh 非交互安装（K3 owns，install/release）

kimi 非交互安装 = **复制 `plugin/dist/kimi-code` 树 → `$KIMI_CODE_HOME/plugins/managed/cc-master/` + 写 `$KIMI_CODE_HOME/plugins/installed.json`**（实测可用，无需 TUI `/plugins install`、无需 bin，最像 cursor 的纯文件系统复制）。installed.json schema（kimi-code.md §4）：

```json
{ "version": 1, "plugins": [
  { "id": "cc-master", "root": "<abs managed dir>", "source": "local-path",
    "enabled": true, "installedAt": "<ISO>", "updatedAt": "<ISO>" } ]}
```

install.sh 文件级改动（来自 install/release 勘查，行号约值）：
- `normalize_harness()` **lines 809-815**：加 `kimi|kimi-code|kimicode) → kimi-code`。
- **lines 818-849**：加 `kimi_bin`（env override `CCM_KIMI_BIN`/PATH `kimi`）+ `kimi_config_dir`（`$KIMI_CODE_HOME` 否则 `$HOME/.kimi-code`）。
- `is_harness_installed()` **851-874**：加 `kimi-code)` 臂（`kimi` on PATH 或 `~/.kimi-code` 存在）。
- `harness_supports_plugin_distribution()` **876-878**：OR 加 `kimi-code`。
- `detect_installed_harnesses()` **880-884** + `log_harness_inventory()` **901-907**：加 kimi-code 行。
- `validatePlugin()` manifest map **401-406**：加 `'kimi-code': 'kimi.plugin.json'`。
- 新函数 `install_plugin_kimi_code()`：`transactional_publish "plugin:kimi-code"` → managed dir，写/merge `installed.json`，校验 `kimi.plugin.json`。
- `transactional_publish` 注释 **line 230** 加 `plugin:kimi-code`。
- `unpack_plugin_for_harness()` 校验 case **1243-1255** + 主 dispatch case **1264-1280**：加 `kimi-code)` 臂。asset 名 **line 1228** `cc-master-plugin-kimi-code-<tag>.zip` 自动成立。
- `resolve_plugin_tag` local-source glob **1115-1121**：加 `kimi-code-*` 前缀识别。
- 错误/提示 copy **1221, 1287**：加 kimi-code。

---

## 6. ccm 侧（K5 任务书）

ccm 有**四个独立 harness 维度**（无中央单表，各有 registry/enum）——这是 K5 最重要的认知：

| 维度 | 概念 | 今值 | SSOT |
| --- | --- | --- | --- |
| A. Harness registry（安装清单） | `ccm harness list` | codex/cursor/claude-code | `apps/cli/src/harnesses/registry.ts:16` |
| B. Worker driver（raw CLI 透传） | `ccm worker help/run --harness` | codex/claude-code/cursor-agent | `apps/cli/src/worker-descriptors.ts` |
| C. board `owner.harness` enum | 字段 + `FMT-HARNESS` | claude-code/codex/cursor/unknown | `packages/engine/src/board-model.ts:62` |
| C′. board `agents[].harness` enum | agent registry | codex/claude-code/cursor-agent/origin | `board-model.ts:89` |
| D. Candidate provider driver | preflight/parse/reconcile | claude+cursor(文件)/codex(内联) | `apps/cli/src/*-provider-driver.ts` |

**决策：单 id `kimi-code`**（origin+worker 同 id，同 codex；不拆 `kimi-code`/`kimi-agent`）——`owner.harness`、`agents[].harness`、worker、registry 全用 `kimi-code`。

### 6.1 K5 MVP 文件清单（raw worker + board legality，无 rich driver/quota）

**A. Harness registry**
1. **新建** `apps/cli/src/harnesses/kimi-code.ts`：export `kimiCodeAdapter: HarnessAdapter`（模仿 `codex.ts` 最简形态）。`HarnessAdapter` 接口（`types.ts:190-207`）实现：`detect(env)`（kimi env：`KIMI_CODE_HOME` 存在 / bin 探测）、`inspectInstallation`（binary probe `CCM_KIMI_BIN||'kimi'` + home probe `~/.kimi-code`）、`session`、`sessionStoreRoots`（`$KIMI_CODE_HOME/sessions`）、`usageSource`（placeholder，pollable:false）、`readCurrentUsage`（**`signal:null, source:'unavailable', unavailableReason:'kimi-code exposes no CLI quota signal'`**）、`accountSwitchPreflight`（unsupported）、`upgradePlugin`、`capability` 三元组（`accountPool:{supported:false}`、`externalStatusline:{supported:false}`、`pluginDistribution:{supported:true}`）。
2. `apps/cli/src/harnesses/registry.ts:16` `KNOWN_ADAPTERS` 加 `kimiCodeAdapter`（位置按 detect 优先级——放 cursor 之后、claude-code fallback 之前）。若加新 capability 子对象，扩 `deepFreezeDescriptor`（line 145）。

**B. Worker driver**
3. `apps/cli/src/worker-descriptors.ts`：`WorkerHarness`/`WorkerExecutableKey`/`WORKER_HARNESSES` 加 `'kimi-code'`；`DESCRIPTORS['kimi-code'] = { harness:'kimi-code', executableKey:'kimi', defaultAgentHelpPrefix: [] }`（`kimi -p` 是顶层，无子命令前缀）。
4. `apps/cli/src/provider-runtime.ts:124` `resolveExecutable` if-chain 加 `kimi` key（env `CCM_KIMI_BIN` → PATH `kimi`）。
5. `apps/cli/src/worker-process.ts:136` `childEnvironment` allow-list 加 `KIMI_CODE_HOME`。
6. `apps/cli/src/registry.ts:78` `worker help` 硬编码 `harness` enum 加 `'kimi-code'`（+ run 示例 109-113 可选）。
   - **worker help 自动可用**：一旦 3+5 完成，`ccm worker help --harness kimi-code` 自动跑 `kimi --help`（`defaultAgentHelpPrefix=[]`，`--scope root`/`agent` 同值）。
   - **worker run 形态**：`ccm worker run --harness kimi-code -- -p "<prompt>" --output-format stream-json`（raw 透传；exit 0 成功；stdout OpenAI-message JSONL）。session recon：`session_index.jsonl` → `sessions/<wd>/<sid>/agents/main/wire.jsonl` 或 `kimi export <sid>`；stream-json 的 `session.resume_hint.session_id` 直接给 recon 键。

**C. board enum + lint**（`@ccm/engine`）
7. `packages/engine/src/board-model.ts`：`ENUMS.harness`（line 62）加 `'kimi-code'`；`ENUMS.agentHarness`（line 89）加 `'kimi-code'`；prose 串 lines 213/220 + `FMT-HARNESS` summary line 760 更新。
8. `packages/engine/src/board-lint-core.ts:219`：`FMT-HARNESS` 消息串更新（enum 由 `isEnumMember` 自动读，仅串要改）。
9. `apps/cli/src/registry.ts` 的 `agent create --harness` 自动从 `ENUMS.agentHarness` 派生（无需单独改）；但 `worker help` enum 独立硬编码（见 6）。

**H. 测试**（会红，须更新）
10. `apps/cli/test/{harness-registry,handler-harness,worker-raw-passthrough}.test.ts`、`packages/engine/test/{board-model-harness,board-lint-agents}.test.ts`、`apps/web-viewer/test/cross-harness-ui.test.ts`——已知 harness 集 / enum 成员断言。

**I. using-ccm 锁步**（§6 抗漂移，K5 owns canonical references）
11. `plugin/src/skills/using-ccm/canonical/references/command-catalog.md`：worker help/run + cross-harness + provider + quota 段的 `--harness <…>` 枚举串加 kimi-code（lines ~311/315-316/350/362/375、provider 323、quota 326、harness list/current 169-171/228-229、worker 197/357-384）。
12. `plugin/src/skills/using-ccm/canonical/references/board-model-guide.md`：`owner.harness` enum（lines 108/126）+ `agents[].harness`（127）加 kimi-code。
13. `plugin/src/skills/using-ccm/canonical/SKILL.md`：worker prose（若列 harness 名）。

### 6.2 K5 follow-up（能力落地后增量，非 MVP）

- **D. rich provider driver**（`apps/cli/src/kimi-provider-driver.ts` 仿 `cursor-provider-driver.ts`：解析 stream-json OpenAI-message JSONL、reconcile、admission）——MVP 用 raw `worker run` 透传即可，rich driver 排后。
- **quota collector（已接入）**：`machine-wide-quota.ts:60` `TARGETS` 已追加 kimi-code 的 `five_hour` + `seven_day` 两条；统一 collector 经 `readCurrentUsage` 只读 `kimi-usages-api` quota face。token 过期/无信号仍诚实降级 `unknown`，不刷新凭证、不伪造窗口。
- **provider model facts**：`provider-model-facts.ts` + `.json` + `model-policy.ts:377` 加 kimi-code provider 块（models k3/kimi-for-coding[-highspeed]）——K8B 模型档位落点（见 §6.3）。
- **session scanner**：`agent-probe.ts` `SESSION_SCANNERS` 若 kimi transcript 布局需专属扫描器再加（`sessionStoreRoots` 已给根）。
- **web viewer**：`apps/web-viewer/src/agentFormat.ts:83` + `types.ts:272` 加 kimi-code badge（cosmetic）。

### 6.3 K8B 模型档位落点（只需指引）

kimi model catalog（kimi-code.md §2）：`kimi-code/k3`（1M ctx，effort max，默认）/ `kimi-code/kimi-for-coding`（256K）/ `kimi-code/kimi-for-coding-highspeed`（256K）。四档模型档（O/T1/T2/T3）映射落点：
- ccm 侧 `apps/cli/src/provider-model-facts.json` 加 kimi-code provider 块（三个 alias + ctx + effort），`model-policy.ts:377` host 列加 kimi-code。
- worker 派发选档：`ccm worker run --harness kimi-code -- -p "…" -m kimi-code/k3`（`-m` 选 alias）。
- skill 侧：`pacing-and-estimation` 的 model-tiers reference 若列 host 专属档，加 kimi-code 行（K3 skill 工作内，但档位数据待 K8B）。
- **不阻塞 walking skeleton**（skeleton 用默认 k3）。

---

## 7. Capability Cards 清单（K4/K5 落地）

每张卡加 kimi-code 行（`| kimi-code | status | mechanism | notes |`）+「降级行为」fenced yaml 声明分叉（矩阵脚本解析）。新增/改动：

| Card | kimi-code 分轨 | INTENT | 验收等价类（kimi） | kimi 替代 / gap |
| --- | --- | --- | --- | --- |
| `post-tool-batch-gate` | **gap** `event-unavailable` | batch 边界 WIP/pacing | WIP 降级为 board-guard + Stop pacing，无静默丢安全 | 无 PostToolBatch → 省 batch hook；WIP 靠 board-guard + verify-board Stop 门 |
| `workflow-authoring` | **gap** `event-unavailable` | 确定性编排脚本 | 无 Workflow → `authoring-workflows` unsupported_stub | 替代：Bash 后台 / 内置 subagent / `/loop`（若环境有） |
| `role-substrate-reinject` | **A?/B** `protocol-capability-gap`（待 probe） | compaction 后角色重注 | 身份+板列表+空板硬停+stale 节点重现（等价类，措辞可异） | probe 分支 1→PostCompact 原生；分支 2→`sessionStart.skill`+AGENTS 静态 |
| `ccm-quota-account` | **partial** `protocol-capability-gap` | 只读配额 + 号池 | `ccm usage advise` 由 `kimi-usages-api` 返回 5h/7d 真信号；`ccm account *` NotImplemented | 只读配额已实现；号池仍 unsupported |
| `usage-pacing-midflight` | **gap** `event-unavailable` | mid-flight 配速采样 | Kimi 已有 5h/7d 真信号，但无可用 PostToolBatch/Stop advisory 投递通道 | 无 mid-flight hook channel；配额信号本身已可读 |
| `cross-harness-session-bound-worker` | **A** `current`（4th harness） | 跨进程边界 raw wrapper | 同 3-harness A/D/H 决策路径 + `kimi -p` 会话绑定 raw argv | `ccm worker run --harness kimi-code`（raw 透传，MVP） |
| `path-token-resolution` | **A/B**（kimi 有 token，优于 cursor） | plugin/skill 路径解析 | skill 正文 `${KIMI_SKILL_DIR}` 文本替换生效 | hook command `$KIMI_PLUGIN_ROOT` env；正文禁 `${KIMI_PLUGIN_ROOT}` |
| `machine-wide-quota-notification` | **supported target** | 全机配额通知 | `kimi-cli` 的 five_hour/seven_day machine-wide target 已接入 | `kimi-usages-api` current-login collector；Kimi origin 投递通道另行跟踪 |
| （新增建议）`custom-subagent-role` 或并入现有 dispatch 卡 | **gap** `protocol-capability-gap` | 自定义 subagent 角色分工 | 仅内置 coder/explore/plan/general + swarm；记 host 返回 agent id 作 handle | manifest 无 `agents` 字段 → 无自定义角色 |

**用户要的五张核心卡**（subagent / workflow / posttool-batch / quota / account）：
- **subagent**：并入 dispatch 或新建卡——`protocol-capability-gap`（内置角色 only）。
- **workflow**：`workflow-authoring` 加 kimi-code `event-unavailable`。
- **posttool-batch**：`post-tool-batch-gate` 加 kimi-code `event-unavailable`。
- **quota**：`ccm-quota-account` 保留 kimi-code 号池 `protocol-capability-gap`；`machine-wide-quota-notification` 已接入 `kimi-cli` five_hour/seven_day target。
- **account**：`ccm-quota-account` 的 `ccm-account-pool` 规则 `affected_hosts` 加 kimi-code。

---

## 8. 测试与门

### 8.1 content tests

- `tests/content/capability-host-coverage.test.mjs:7` `KNOWN_HOSTS` 加 `'kimi-code'`——**整合期最后翻**（全矩阵到位后）。翻后强制：全 command/skill 有 `adapters/kimi-code/strategy.yaml`、全 hook 有 `host_coverage.kimi-code`、`_hosts/kimi-code/capabilities.yaml` 存在。
- `tests/content/hook-injection-contracts.test.mjs`：PARITY anchors 检查——kimi-code walking skeleton 期**不入 required_hosts**（Track B，Capability Card 承接），能力验证后再纳入并补 `// PARITY:` 锚点。

### 8.2 parity / attestation / lint

- `hooks.yaml` 每 hook 加 `host_coverage.kimi-code`（K4）。
- parity 矩阵生成脚本（`gen-hook-parity-matrix` / `gen-capability-parity-matrix` / `check-hook-parity-touch.sh` / `qualify-macos-live.sh`）3-host 列加 kimi-code（K4 owns hook/capability parity 部分）。
- `provider-guidance-attestation.cjs` + `pacing-read-only-capability.cjs` 的 host 常量 + 各 registry（K3，§5.4-5/6）。
- `skill-lint.sh`：host 是 `readdirSync(adaptersDir)` 动态发现（line 278），kimi-code adapter 自动纳入扫描；path-token check（line 495）硬编码 `${CLAUDE_*}`，`${KIMI_SKILL_DIR}` 不匹配其正则，**不误报**——无需改 skill-lint。
- `check-plugin-dist-sync.sh` 加 `--host kimi-code`（§5.4）；三道门（`run-tests.sh` 全绿 + dist-sync 无 diff + `claude plugin validate plugin/dist/claude-code` 仍只验 CC 产物）。

### 8.3 K6 端到端冒烟脚本设计（用户已授权放开 kimi 配额 + `--auto`）

新建 `examples/`（或 `tests/e2e/`）冒烟脚本，真实 managed 安装 + `kimi -p` 驱动 + hook stdin dump 断言：

1. **真实 managed 安装**：跑 `install.sh --harness kimi-code`（或直接 `plugin/dist/kimi-code` → `$KIMI_CODE_HOME/plugins/managed/cc-master/` + 写 `installed.json`），用**隔离 `KIMI_CODE_HOME`**（credentials symlink 指真 home、从不写），真实 home 零改动核验（同 K1 probe 纪律）。
2. **hook stdin dump 断言**：launcher `--echo-normalized`（同 cursor launcher 的 echo 模式）dump 归一化 payload，断言：`harness=kimi-code`、`event` 映射对、`session_id` 提取对、`prompt` 数组→text 对、武装板发现对。
3. **`kimi -p` 驱动闭环**：`KIMI_CODE_HOME=<iso> kimi -p "cc-master:as-master-orchestrator <goal>" --output-format stream-json --auto` → 断言 bootstrap hook 建板（home `boards/` 出现 `*.board.json`、`owner.active:true`、`owner.harness=kimi-code`、`owner.session_id=session_<uuid>`）。
4. **hook 链断言**：模拟 PreToolUse（改 board 文件）→ board-guard deny；PostToolUse → board-lint message；Stop → verify-board message/deny。
5. **worker driver 断言**：`ccm worker help --harness kimi-code` 出 `kimi --help`；`ccm worker run --harness kimi-code -- -p "PING" --output-format stream-json` exit 0 + stdout JSONL `{"role":"assistant","content":"PING"}` + resume_hint。
6. **reinject probe**（K4 首动作，可独立跑）：PostCompact hook 注入 `message` 后，dump compaction 后 context 验其是否含 substrate——决定 §3.5 分支。

---

## 9. README×2 / CHANGELOG / release（K6/K7 收口）

- `README.md` + `README_zh.md`：安装段加 kimi-code（`install.sh --harness kimi-code`）、harness 列表加 kimi-code、诚实标注 gap（无自定义 subagent / 无 Workflow / 无 PostToolBatch / 无 CLI 配额信号）。**两份同步改**（readme-steward 纪律）。
- `CHANGELOG.md` `## [Unreleased]`：加 `feat: kimi-code harness adapter (4th host)` 条目。
- **release（向前兼容——本轮只 merge 不发版）**：
  - `scripts/package-plugin.sh`：`package_one` host allowlist（lines 128-131）+ include-dirs 分支（141-149，kimi manifest 是**根文件** `kimi.plugin.json` 非 `.{host}-plugin/` 目录——需 include-file 特判把 `kimi.plugin.json` 纳入 zip）+ 校验分支（162-171）+ `--all-hosts` 加 `package_one kimi-code`（206-212）+ usage copy（90/95/130）。
  - `.github/workflows/plugin-release.yml`：无 matrix，`--all-hosts`（line 52）自动覆盖；加一个「Validate kimi-code packaged adapter」step（89 行后，解压断言 `kimi.plugin.json` + skills/ + hooks/）；upload/attach glob `dist/cc-master-plugin-*.zip` 已 wildcard，无需改。**这些是纯增量，向前兼容**（不影响现有三 host asset）。

---

## 10. 实施顺序与边界表（K3/K4/K5 并行同一 worktree）

**三任务并行在同一 worktree（`/data/qiwei/repos/cc-master-wt/kimi`），必须无同文件冲突。** 下表把每个文件/目录集映射到唯一 owner。

### 10.1 文件级分工（无冲突分区）

| owner | 独占目录/文件集 |
| --- | --- |
| **K3**（SAP skills + commands + 投影/打包/安装工程） | `plugin/src/skills/*/adapters/kimi-code/`、`plugin/src/skills/_hosts/kimi-code/`、`plugin/src/commands/*/adapters/kimi-code/`、`plugin/src/commands/_hosts/kimi-code/strategy.yaml`、`plugin/src/.kimi-plugin/plugin.json`（manifest 骨架，不含 hooks[]——hooks fragment 由 K4 供、sync 合成）、**`scripts/sync-plugin-dist.sh`**（skills/commands/manifest 分支 + 消费 K4 的 hooks fragment）、`scripts/check-plugin-dist-sync.sh`、`scripts/package-plugin.sh`、`install.sh`、`.github/workflows/plugin-release.yml`、`scripts/provider-guidance-attestation.cjs` + `plugin/src/skills/provider-guidance-runtime.json`、`scripts/pacing-read-only-capability.cjs` + 各 skill pacing registry、新 substrate skill `plugin/src/skills/cc-master-role-substrate/`（若 §5.2 需要）、README×2、CHANGELOG |
| **K4**（PHIP hooks + Capability Cards） | `plugin/src/hooks/_hosts/kimi-code/`（launcher.js + hooks.fragment.json + strategy.yaml + probes/）、`plugin/src/hooks/*/implementations/kimi-code/`、`plugin/src/hooks/*/CONTRACT.md`（kimi-code 增补）、`plugin/src/hooks/_manifest/hooks.yaml`（host_coverage.kimi-code）、`plugin/src/hooks/hook-common.js`（ctx.normalized kimi 分支）、`design_docs/harnesses/capabilities/*.md`（kimi-code 行）、parity gen 脚本（`gen-hook-parity-matrix`/`gen-capability-parity-matrix`/`check-hook-parity-touch.sh`/`qualify-macos-live.sh` 的 kimi-code 列）、reinject probe 脚本 |
| **K5**（ccm 引擎/CLI） | `ccm/**` 全部、`plugin/src/skills/using-ccm/canonical/references/{command-catalog,board-model-guide}.md`（harness enum 锁步）、`plugin/src/skills/using-ccm/canonical/SKILL.md`（worker prose 锁步） |

**唯一跨界耦合点（须约定接口，非同文件编辑）**：
- **hooks fragment 契约**：K4 产 `plugin/src/hooks/_hosts/kimi-code/hooks.fragment.json`（`hooks[]` 数组），K3 的 sync 读它内联进 manifest。二者**不同文件**（K4 写 fragment，K3 写 sync 消费逻辑）——约定 fragment schema（`{event,matcher?,command,timeout?}[]`）后即可并行。
- **using-ccm 双侧**：K3 建 `adapters/kimi-code/`（SAP 投影，新目录），K5 改 `canonical/references/*`（ccm 锁步，既有文件）——**不同文件，无冲突**。

### 10.2 同步点（sequencing）

并行窗口内三任务各自落地 kimi-code 条目（`KNOWN_HOSTS` 仍 3 host，`assertExactKeys` 门要求 K3 的 attestation host 常量 + registry + 全 8 skill 是**一次原子改**）。整合期（K6 或 join step）**依赖 K3+K4 都完成**：

1. K3+K4 完成 → 跑 `bash scripts/sync-plugin-dist.sh --host kimi-code`（首次端到端成功，需 skills+commands+manifest+hooks 全就位）。
2. commit `plugin/dist/kimi-code`（生成物同 commit）。
3. `check-plugin-dist-sync.sh` 加 `--host kimi-code` 行。
4. **翻 `KNOWN_HOSTS`** 加 kimi-code（全矩阵到位后）。
5. K5 完成后跑 `ccm` 测试 + `ccm worker help/run --harness kimi-code` 实测。
6. K6 端到端冒烟（§8.3）+ README/CHANGELOG。
7. 端点跑全套 `bash run-tests.sh`（`ALL TESTS PASSED`）+ dist-sync 无 diff + `claude plugin validate plugin/dist/claude-code`。

### 10.3 各任务验收

- **K3**：`sync --host kimi-code`（skills+commands+manifest 段）无未解 slot 抛错；8 skill + 6 command 有 kimi-code adapter；provider-guidance + pacing attestation 绿；install.sh `--harness kimi-code` 走通 managed 安装 + installed.json；package-plugin.sh 产 `cc-master-plugin-kimi-code-*.zip`。
- **K4**：`_hosts/kimi-code/launcher.js` 归一化对（`--echo-normalized` fixture）；11 hook host_coverage 声明齐；核心链 core（bootstrap/board-guard/board-lint/verify-board）行为级 parity fixture 落等价类；CONTRACT.md kimi-code 分叉声明齐；reinject probe 结论落 §3.5 分支 + Capability Card；`check-hook-parity-touch` 绿。
- **K5**：`ccm harness list` 含 kimi-code；`ccm worker help --harness kimi-code` 出 `kimi --help`；`ccm worker run --harness kimi-code -- -p …` exit 0；board `owner.harness=kimi-code` 过 lint（FMT-HARNESS 不报）；ccm 测试绿；using-ccm 两 reference 锁步。

### 10.4 显式 follow-up 清单（12h 外，非 MVP）

1. reinject PostCompact 原生 core 升级（若 probe 分支 1 成立）。
2. Stop-continuation 硬门（若 probe 通过，verify-board 从 advisory 升 deny-block）。
3. ccm rich provider driver（`kimi-provider-driver.ts`：stream-json 解析 + reconcile + admission）。
4. K8B 模型档位数据（provider-model-facts kimi-code 块 + model-policy host 列 + pacing model-tiers 行）。
5. ~~kimi 配额面若出现 → `machine-wide-quota.ts` TARGETS + `readCurrentUsage` 真信号。~~ 已完成：`kimi-usages-api` + five_hour/seven_day TARGETS 已接入。
6. `kimi acp` / `kimi server` 更强 worker transport（attach/journal/supervisor 级）probe。
7. web-viewer kimi-code badge（cosmetic）。
8. AGENTS.md 94.7KB >32KB 告警（kimi 作 origin 读项目根 AGENTS.md 会告警）——性能/成本提示，非致命，观察项。

---

## 附录：最大适配风险 + probe 清单

**最大风险 = reinject（魂重注）在 compaction 后能否原生注入。** kimi 的 `PostCompact` 注入能力 [unresolved]——若 PostCompact 不能注入 `message` 且 SessionStart 不 re-fire，master-orchestrator 角色 substrate 在 compaction 后无法动态重注（同 Cursor 硬缺口），kimi 降为 Track B `sessionStart.skill` + AGENTS 静态 substrate（丢动态板列表 / 空板硬停 / stale 节点）。这是 make-or-break，故设计成 **K4 第一个动作 probe**（不阻塞 walking skeleton——skeleton 先落 Track B 静态形态）。

**次要风险**：Stop-hook continuation 语义（verify-board 能否机制性硬门「指挥不早停」，还是只 advisory）；kimi 日级发布节奏（v0.26.0，机制易变，adapter 须对齐实测版本）。

**probe 清单（K4/K6）**：
1. **PostCompact `message` 注入**（决定 reinject 分轨，K4 首动作）。
2. **SessionStart compaction 后 re-fire**（reinject 备选通道）。
3. **Stop `permissionDecision="deny"` 是否续跑**（决定 verify-board 硬门 vs advisory）。
4. **`sessionStart.skill` 触发时机**（首 session only 还是每 session start）。
5. **manifest 内联 `hooks[]` vs `hooks` 文件路径**（确认 kimi 只吃内联数组）。
6. **worker exit 码全谱**（provider/auth 失败码，K6 worker 断言用）。
