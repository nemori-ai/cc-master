# Claude Code Hooks —— 权威参考（cc-master 视角）

> **来源**：官方文档 [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks)（`docs.claude.com/en/docs/claude-code/hooks` 301 重定向至此）+ [hooks-guide](https://code.claude.com/docs/en/hooks-guide)，2026-06-11 WebFetch 取证。
> **本文只收录官方文档明确确认的事实**；首轮 sub-agent 调研有若干幻觉/遗漏（漏了 `SubagentStop`、误判 Stop 的 additionalContext、编造了版本号/字段），已对官方文档**端点验收**后剔除——**dogfood 教训：agent 自报不可信，平台知识必须对官方端点验收**（呼应红线「gate-green ≠ passed / 只信端点验收」）。
> **用途**：给 cc-master 新增 hook 点时对标这张矩阵——核心两问：**能不能 block（在 agent loop 里做确定性保证）+ 能不能注入 context（自动通知 agent）**。
> **核实状态**：§1 能力矩阵 + §3 I/O 要点 + §4 cc-master 结论（含 H1–H7 选型）经**主线 WebFetch 官方** + **二轮 claude-code-guide 逐条对账**双重核实、零错。§2 全集矩阵的部分**次要 stdin 字段名**为二轮对账修正项（标了 `?` 的为可选/待核），落地实现某事件时以官方 [hooks.md](https://code.claude.com/docs/en/hooks) 的该事件 schema 再确认一次。

## 1. 核心结论（cc-master 关心的两类能力 × 自主 loop）

### 1.1 能在 agent loop 里 BLOCK（确定性保证）的事件

| 事件 | block 方式 | 在自主编排 loop 里触发？ | 对 cc-master 的意义 |
|---|---|---|---|
| **Stop** | `{"decision":"block"}`+`reason` 或 exit 2 | ✅ 每次 agent 想交还控制权 | 现役 goal-hook（verify-board）；完整落地/验收门 |
| **SubagentStop** | `{"decision":"block"}`+`reason` 或 exit 2 | ✅ **后台 sub-agent 完成时** | **新机会**：可拦「sub-agent 没干完就退」 |
| **PreToolUse** | `permissionDecision:"deny"` | ✅ 每个工具调用前 | 派发前 gate（如 in_flight≥wip_limit 拒派）|
| **PostToolUse** | `{"decision":"block"}`+`reason` | ✅ 每个工具成功后 | 工具后校验 |
| **PostToolBatch** | `{"decision":"block"}`+`reason` | ✅ **一批并行工具调用全解析后** | **过调度天选**：批量 fan-out 一解析就能拦/警 |
| **PreCompact** | `{"decision":"block"}`+`reason` | ✅ compaction 前 | 可拦 compaction（但**不能注入 context**）|
| **TaskCreated / TaskCompleted** | exit 2 或 `decision:block` | 仅当用 `TaskCreate`/Task 工具时 | cc-master 用自有 board 文件、Task* 工具仅非权威草稿镜像，故**不依赖**这两个 |

### 1.2 能注入 context（自动通知 agent）的事件 —— 支持 `additionalContext`

✅ **SessionStart** · Setup · **UserPromptSubmit** · **PreToolUse** · **PostToolUse** · **PostToolUseFailure** · **PostToolBatch** · **SubagentStart** · **SubagentStop** · **Stop**

> 在**自主编排 loop**（无 user prompt 的连续回合）里能自动注入通知的，是：**PostToolUse / PostToolBatch / SubagentStop / Stop**（外加 compaction 边界的 SessionStart）。这是「自动通知 agent」的真实落点——**UserPromptSubmit 只在用户发话时触发，自主 loop 里用不上**。

### 1.3 关键澄清（纠正首轮调研的错）

- **Stop 支持 additionalContext** 做**非阻断**反馈（不只是 block 时的 `reason`）——可以「不拦停、只塞一句提示」。
- **SubagentStop 真实存在**且 block+注入双全——后台任务完成自动通知主线，无需 agent 自觉轮询。
- **PostToolBatch 真实存在**——并行批量解析后触发，是侦测「一次性巨型 fan-out」的天然钩子。
- **PreCompact 不支持 additionalContext**（只能 block）——「compact 前快照并提醒」做不成「注入提醒」，只能：hook 写 sidecar（bash 可），再由 SessionStart(source=compact) reinject 读回。
- **`additionalContext` 超 10,000 字符**：Claude Code 把全文写进 session 目录的文件、只把文件路径+短预览给 agent（不是直接截断）。
- **多个 hook 对同事件都返回 additionalContext**：agent 收到全部值。

## 2. 官方事件全集矩阵（~30，均已确认存在）

> 取自官方文档表格。`additionalContext` 列=能否注入；`block` 列=阻断方式。

| 事件 | 何时触发 | block 方式 | additionalContext | 关键 stdin 字段 |
|---|---|---|---|---|
| SessionStart | 新 session / resume | ❌ | ✅ | `source`,`model`,`agent_type?`,`session_title?` |
| Setup | `--init-only` / `-p --init` / `--maintenance` | ❌ | ✅ | `trigger`(init\|maintenance) |
| UserPromptSubmit | 用户提交 prompt | `decision:block`+`reason` | ✅ | `prompt` |
| UserPromptExpansion | 用户输入的命令展开时 | `decision:block`+`reason` | ❌ | — |
| PreToolUse | 工具执行前 | `permissionDecision`(deny/allow/ask/defer) | ✅ | `tool_name`,`tool_input` |
| PermissionRequest | 权限对话框出现 | `hookSpecificOutput.decision.behavior`(allow/deny) | ❌ | `tool_name`,`tool_input`,`permission_mode` |
| PermissionDenied | auto-mode 拒了工具 | `hookSpecificOutput.retry:true`(非阻断) | ❌ | `tool_name`,`tool_input` |
| PostToolUse | 工具成功后 | `decision:block`+`reason` | ✅ | `tool_name`,`tool_input`,`tool_result` |
| PostToolUseFailure | 工具失败后 | `decision:block`+`reason` | ✅ | `tool_name`,`tool_input`,`error` |
| PostToolBatch | 一批并行工具全解析后 | `decision:block`+`reason` | ✅ | `tool_results`(array，每项含 tool_name/tool_input/tool_output/status),`batch_id` |
| Notification | Claude Code 发通知 | ❌ | ❌ | `notification_type`,`message` |
| MessageDisplay | assistant 消息文本显示时 | `hookSpecificOutput.displayContent`(只改显示不改 transcript) | ❌ | `message_text` |
| SubagentStart | sub-agent 派生时 | ❌ | ✅ | `agent_type` |
| **SubagentStop** | **sub-agent 完成时** | exit 2 或 `decision:block`+`reason` | ✅ | `agent_id`,`agent_type`,`stop_reason`,`effort` |
| TaskCreated | `TaskCreate` 建任务时 | exit 2 或 `decision:block` | ❌ | `task_id`,`task_input` |
| TaskCompleted | 任务标记完成时 | exit 2 或 `decision:block` | ❌ | `task_id` |
| **Stop** | **Claude 答完想停时** | exit 2 或 `decision:block`+`reason` | ✅（非阻断反馈） | — |
| StopFailure | turn 因 API error 结束 | ❌（输出/exit 被忽略） | ❌ | `error_type` |
| TeammateIdle | agent-team 队友将 idle | exit 2 或 `continue:false` | ❌ | — |
| ConfigChange | 配置文件 session 中变化 | `decision:block`+`reason`(policy_settings 除外) | ❌ | `config_source` |
| CwdChanged | 工作目录变化 | ❌ | ❌ | `cwd`(新，通用字段),`previous_cwd`,`changed_by_tool?` |
| FileChanged | 被监听文件变化 | ❌ | ❌ | `file_path`,`change_type`(modified/created/deleted),`timestamp` |
| WorktreeCreate | `--worktree` 建 worktree | 任意非零 exit 阻断 | ❌ | —（命令 hook 打印 path 到 stdout）|
| WorktreeRemove | session 退出/sub-agent 完成时移除 worktree | ❌ | ❌ | — |
| **PreCompact** | **context compaction 前** | `decision:block`+`reason` | ❌ | `trigger`(manual\|auto) |
| PostCompact | compaction 完成后 | ❌ | ❌ | `trigger`(manual\|auto) |
| Elicitation | MCP server 请求用户输入 | `hookSpecificOutput.action`(accept/decline/cancel) | ❌ | `server_name`,`tool_name`,`prompt`,`form_fields` |
| ElicitationResult | 用户回应 MCP elicitation | `hookSpecificOutput.action`(accept/decline/cancel)，可改 content | ❌ | `server_name`,`tool_name`,`form_values` |
| InstructionsLoaded | CLAUDE.md / `.claude/rules/*.md` 加载 | ❌ | ❌ | `file_path`,`memory_type`,`load_reason`,… |
| SessionEnd | session 终止 | ❌ | ❌ | `end_reason` |

## 3. I/O 契约要点（官方确认部分）

- **阻断有两套语义**：业务级 `{"decision":"block"}`+`reason`（Stop/SubagentStop/PostToolUse/PostToolBatch/UserPromptSubmit/PreCompact/ConfigChange）vs 权限级 `permissionDecision`(PreToolUse)/`decision.behavior`(PermissionRequest)。**要放行 = 省略 decision 或 exit 0 无 JSON。**
- **注入**：`hookSpecificOutput.additionalContext`（仅 §1.2 列出的事件）。超 10k 字符 → 落文件给路径。
- **exit 2** = 阻断错误（可阻断事件上 stderr 给 agent）；exit 0 + JSON = 正常决策；其他非零 = 非阻断错误，记日志不拦。**注意**：不可阻断的事件（`SessionStart`/`Setup`/`Notification` 等）即便 exit 2 也**不真正阻断**——只把 stderr 显示给**用户**、执行照常继续。
- **stdin 共通字段**（各事件之上）：官方含 `session_id` / `transcript_path` / `cwd` / `hook_event_name` 等指针型字段——hook **只读必要字段**，别加载整个 transcript（可能极大）。
- **完整 JSON 输出 envelope 与每事件 stdin 全 schema**：以官方 [hooks.md](https://code.claude.com/docs/en/hooks) 为准（本文只锚定 cc-master 决策所需的子集）。

## 4. cc-master 落地约束与结论

### 4.1 runtime 约束（红线 1 / [ADR-006](../../adrs/ADR-006-hooks-may-use-node-js.md)）改写什么、不改写什么

> **⚠️ 本节已按 ADR-006 修订**（取代原「纯 bash」）。hook 可用 **bash + node/JS（JS only）**——Claude Code 本身是 Node 应用，`node` 在任何能触发 hook 的环境天然在（Bedrock/Vertex/Foundry 是模型后端、非 CLI 宿主）。仍**排除** `jq` / `python` / 直接跑 TS（不随 Claude Code 保证存在）。

- ✅ **能做**：读 board（node `JSON.parse` 一行，或 bash escape-aware awk）、数 `tasks[]`/`in_flight`、读 `blocked_on`/`wip_limit`、写 sidecar、注入短 context。**用 node 做结构化 JSON 解析/计算，用 bash 做简单/高频 hook**（node 启动 ~数十 ms，per-tool PostToolUse 这类高频事件留 bash）。
- ✅ **现在能做了（ADR-006 解锁）**：**算 token usage**——node 一个 `JSON.parse` 读 JSONL usage 记录、算 5h/7d burn-rate（即 `scripts/cc-usage.sh` 那套 python 逻辑），在 `Stop`/`PostToolBatch` hook 里**确定性感知 + 注入 pacing 警告**。于是 **C2「在 loop 里确定性感知 usage」从「注定 prose/script」翻盘为「可做成 node hook」**（见 §4.2 H8）。
- ❌ **仍做不成**：调用 `jq`/`python`/直接跑 `.ts`（红线1 仍排除）；读对话语义（hook 只有 `transcript_path` 指针，不重建语义）；改权威源 board（只读 + sidecar 写）。
- ⚠️ **残留边界**：`node` 在 npm/global 安装铁定在 PATH；standalone-binary 安装可能内嵌 node 而不暴露 `node` 到 PATH——若 cc-master 要覆盖那类，node hook 需 `command -v node` 守 + bash 兜底（见 ADR-006 §3.2）。

### 4.2 Part B 的 H1–H7 按官方矩阵修正后的事件落点

| # | 需求 | 关 gap | **修正后 hook 事件** | 能力 | 红线/可行性 |
|---|---|---|---|---|---|
| H1 | 拦「done 缺 verified+artifact」就别停 | C1 board 完整性 | **Stop**（扩 verify-board，block+reason）| 确定性保证 | 需 board 加 verified/artifact 字段=动 waist（红线2）|
| H2 | 派 Task 前 in_flight≥wip_limit 拒派 | C5 过调度 | **PreToolUse**(matcher:Task, deny) | 确定性保证 | 需 wip_limit 升 hook-dependent=动 waist |
| H3 | 提示未答 `blocked_on:"user"` 决策 | C3 HITL 静默 Stop | **Stop**（block 时进 reason，或 **additionalContext** 非阻断提示）| 通知（或保证）| 纯 bash 只读，**不动 waist，最廉**✅ |
| H4 | resume 后提示未消化 stale + deps 悬挂 | C4 supersession | **SessionStart**(扩 reinject, additionalContext) | 通知 | 纯 bash 检 deps，可行 ✅ |
| H5 | 过调度后注入软警告 | C5 过调度(通知版) | **PostToolBatch**（批量 fan-out 解析后, additionalContext）/ PostToolUse | 通知 | 纯 bash 数 in_flight；**PostToolBatch 是天选**（首轮调研不知它存在）✅ |
| **H6** | **后台完成自动通知主线去 integrate+验收** | C1/C5 integrate-on-notification | **SubagentStop**（additionalContext，可叠 block）| 通知（+可保证）| 纯 bash；**首轮调研漏了此事件，实为最强新机会**✅ |
| H7 | compact 前快照 budget/plan | C2/C4 跨 compaction | **PreCompact 写 sidecar** + **SessionStart reinject 读回** | 快照+通知 | PreCompact **不能注入 context**，故走 sidecar；node 可在此快照算好的 usage |
| **H8** ⭐ | **node hook 算 usage + 注入 pacing 警告** | C2 传感器不被 loop 调 | **Stop / PostToolBatch**（node `JSON.parse` JSONL → burn-rate → additionalContext）| **确定性感知+通知** | **node/JS（ADR-006 解锁）**；把 C2 从「注定 prose/script」变成真 hook 机制——本次约束修正最大净收获 |

### 4.3 选型取向

- **确定性保证**（H1/H2）成本高（动 narrow waist=红线2，须 ADR-003+全 hook+测试同步）——先用 **Track B eval** 守行为型 gap，确有硬保证需求再上 hook。
- **自动通知**（H3/H4/H5/H6）多数纯 bash、不动 waist，是**廉价高杠杆先做项**；其中 **H6（SubagentStop）+ H5（PostToolBatch）** 是这次端点验收**新挖出**的、首轮调研漏报的真实机制。
- **C2 usage**（H8）—— **ADR-006 后翻盘**：node hook 能 `JSON.parse` JSONL 算 burn-rate，在 `Stop`/`PostToolBatch` 确定性感知 + 注入 pacing 警告。曾以为「唯一被红线1 否决、注定 prose/script」，现为本次约束修正的最大净收获。（`scripts/cc-usage.sh` 仍可作主线带外手动调用，但 in-loop 自动感知现在有 hook 路径了。）

## 5. 源

- [Hooks reference — code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks)（事件全集矩阵、block/additionalContext、I/O 契约）
- [Automate actions with hooks — hooks-guide](https://code.claude.com/docs/en/hooks-guide)（实战/最佳实践）
- 交叉验证实例：本仓 `hooks/hooks.json` + `hooks/scripts/{bootstrap-board,reinject,verify-board}.sh`
