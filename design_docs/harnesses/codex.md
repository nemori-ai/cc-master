# Codex Harness Facts

更新时间：2026-07-03。

## Source Hierarchy

Codex 事实按以下优先级维护：

1. 本仓对当前 Codex CLI 的 probe。
2. Codex 官方 manual。
3. paragoge Codex mechanism 文档。

本次校对使用 Codex CLI 0.142.5，并读取了 2026-07-03 获取的官方 Codex manual。

## Project Skills

Codex 项目级 skills 的目录是：

```text
.agents/skills/<skill>/SKILL.md
```

不是 `.codex/skills`。

Codex 会读取 symlinked skill folders。本仓因此以 `.claude/skills` 为 dev/meta-skill 源，用脚本生成 `.agents/skills`：

```bash
bash scripts/sync-codex-skills.sh
bash scripts/sync-codex-skills.sh --check
```

`SKILL.md` 正文不做 runtime path variable substitution。不要在 Codex skill 正文中假设 `${CODEX_SKILL_DIR}` 或类似 token。

## Plugins And Hooks

Codex plugin manifest 使用：

```text
.codex-plugin/plugin.json
```

当前官方 manual 中 hook 配置 key 是 `hooks`；`codex_hooks` 是 deprecated alias。Codex 支持 plugin-bundled hooks 被发现和执行，但 hook command 的路径语义需要谨慎处理。

本仓 2026-07-03 对 Codex CLI 0.142.5 的 probe 结论：

- plugin-bundled `SessionStart` hook 会被发现。
- hook command 如果写成绝对安装路径，可以执行。
- plugin-bundled hook 默认读取 `hooks/hooks.json`；若放在 plugin root 的 `hooks.json` 不会被默认加载。可在 `.codex-plugin/plugin.json` 显式写 `"hooks": "./hooks/hooks.json"` 消除歧义。
- plugin-bundled hook command 中写 `node "${PLUGIN_ROOT}/hooks/probe-hook.js"` 会被 Codex 解析为安装缓存中的真实绝对路径，并成功执行。实测 argv 为 `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/hooks/probe-hook.js`。
- 但同一次实测里，hook 子进程环境 **没有** `PLUGIN_ROOT` / `PLUGIN_DATA` / `CLAUDE_PLUGIN_ROOT` / `CLAUDE_PLUGIN_DATA`。这与官方文档“会设置 env var”的表述不完全一致；对当前 adapter，应把 `${PLUGIN_ROOT}` 当作 **hook command 字符串里的可解析 token**，不要让脚本运行时再读取这些 env。若脚本需要 root/data 路径，在 command 里显式传入自有变量（如 `CC_MASTER_PLUGIN_ROOT="${PLUGIN_ROOT}"`）或从脚本 `argv[1]` / `__dirname` 推导。
- hook command 写 `node "${CODEX_PLUGIN_ROOT}/hooks/probe.js"` 不会被 Codex 展开。
- hook 进程环境中没有 `CODEX_PLUGIN_ROOT`。
- hook 命令从 session cwd 运行；裸相对路径不适合作为插件内脚本路径。
- Codex 官方 hooks / plugin 文档当前写明：plugin-bundled hook command 会收到 `PLUGIN_ROOT` / `PLUGIN_DATA`，并为兼容现有 plugin hooks 设置 `CLAUDE_PLUGIN_ROOT` / `CLAUDE_PLUGIN_DATA`。实测需按上一条收窄；这与 `CODEX_PLUGIN_ROOT` 无关，后续 Codex adapter 应采用 `${PLUGIN_ROOT}` command token，而不是自造 `CODEX_*` token。
- project-local `.codex/hooks.json` 在 `--dangerously-bypass-hook-trust` 下可用于非交互 probe；正常路径仍需要 Codex hook trust review。
- `SessionStart` / `UserPromptSubmit` / `Stop` / `PreToolUse` / `PostToolUse` stdin 都是单行 JSON，字段与 Claude Code 接近但应按 Codex fixture 解析：
  - common：`session_id`、`turn_id`（除 `SessionStart`）、`transcript_path`、`cwd`、`hook_event_name`、`model`、`permission_mode`。
  - `SessionStart`：另有 `source`，例如 `startup`。
  - `UserPromptSubmit`：另有 `prompt`。
  - `Stop`：另有 `stop_hook_active`、`last_assistant_message`。
  - `PreToolUse`：另有 `tool_name`、`tool_input`、`tool_use_id`。
  - `PostToolUse`：另有 `tool_name`、`tool_input`、`tool_response`、`tool_use_id`。
- Claude-style additional context envelope 在 Codex 0.142.5 下实测有效：`{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"..."}}` 注入后，模型能看到该 context。
- 同样的 additional context envelope 在 `SessionStart` 下也实测可见；probe root：`/tmp/cc-master-sessionstart-context-probe-20260703T102402Z-236263`。
- `PostToolUse` additional context 也实测可见；probe root：`/tmp/cc-master-posttool-context-probe-20260703T102841Z-240839`。
- Claude-style block envelope 在 Codex 0.142.5 的 `PreToolUse` 下实测有效：`{"decision":"block","reason":"..."}` 会阻断 Bash，并把 reason 暴露给 agent。
- `Stop` hook 输出 `{"systemMessage":"..."}` 实测正常收束（rc 0，单次 Stop）。
- 官方 Stop docs 明确支持 `{"decision":"block","reason":"..."}`：它不会拒绝某个 tool，而是让 Codex 继续，并用 `reason` 自动生成续跑 prompt。
- 早期裸 `Stop decision:block` probe 会触发反复 Stop 重入；90s probe 中记录 43 次 Stop，最终 timeout（rc 124），`stop_hook_active` 从第二轮起为 `true`。结论不是“永远不能 block”，而是生产 Stop block 必须带显式释放机制。
- `Stop` hook 退出码 2 也会触发反复 Stop 重入；90s probe 中记录 64 次 Stop，最终 timeout（rc 124），`stop_hook_active` 从第二轮起为 `true`。
- 因此 Codex adapter 的 `Stop` hook 生产策略是：需要继续 agent 时用 `decision:block`，但必须给 agent 一个可执行释放阀；仍不要用 exit 2 模拟 Claude Code Stop。

当前 `cc-master` Codex source adapter 已落地 hook registration：

- manifest source：`plugin/src/.codex-plugin/plugin.json`
- hook registration source：`plugin/src/hooks/_hosts/codex/hooks.json`
- 已启用事件：`UserPromptSubmit`、`SessionStart`、`Stop`、`PreToolUse`、`PostToolUse`
- bootstrap core：`plugin/src/hooks/bootstrap-board/implementations/codex/bootstrap-board-core.js`
- 已用临时 local marketplace + plugin install 验证早期链路在 Codex CLI 0.142.5 下可触发 fresh bootstrap；fixture root：`/tmp/cc-master-bootstrap-probe-20260703T102023Z-233105`

bootstrap：当用户 prompt 第一行是 `/cc-master:as-master-orchestrator ...` 或 `cc-master:as-master-orchestrator ...` 时，Codex launcher 注入标准 env / normalized payload，bootstrap core 创建并 arm `$CC_MASTER_HOME`（默认 `~/.cc_master`）下的 `boards/*.board.json`。`--resume <selector>` 会选择旧 board、重盖 `owner.session_id`、`owner.active=true`，并拒绝抢占其他 live session 的 active board。`--priority` / `--wip` / `--owner-wip` / `--policy-switch` 在 fresh bootstrap 阶段 best-effort 落板。

## Runtime Init Surface

Codex adapter 当前选择 **prompt-first / hook-detected** 初始化；安装器会把 `plugin/dist/codex` 注册成一个本地 Codex marketplace/plugin，并额外把 Codex custom prompts 同步到 `${CODEX_HOME:-~/.codex}/prompts` 作为可输入入口：

```text
cc-master:as-master-orchestrator <goal> [--priority ...] [--wip N] [--owner-wip N] [--policy-switch allow|deny]
/cc-master:as-master-orchestrator <goal> [--priority ...] [--wip N] [--owner-wip N] [--policy-switch allow|deny]
cc-master:as-master-orchestrator --resume [selector]
/cc-master:as-master-orchestrator --resume [selector]

/prompts:cc-master-as-master-orchestrator <goal>
/prompts:cc-master-as-master-orchestrator --resume [selector]
```

这不是 Codex plugin-distributed slash command；host-agnostic contract 仍是 `UserPromptSubmit` hook 对第一行 prompt 的识别。Codex custom prompts 只是 user-local/deprecated prompt expansion surface，用于改善入口体验，安装来源是 per-harness release artifact 的 `prompts/` 目录，目标目录是 `${CODEX_HOME:-~/.codex}/prompts`。skills / hooks 由 Codex plugin registry 发现，commands 仍不要当成 Codex plugin manifest 支持的 command artifact。

子调研结论（2026-07-03）：

- Codex plugin local install 需通过 marketplace snapshot：根目录下 `.agents/plugins/marketplace.json`，插件 entry 的 `source.path` 相对 marketplace 根，`policy.authentication` 使用 `ON_USE` 或 `ON_INSTALL`；本仓 install/upgrade 生成持久 wrapper 并执行 `codex plugin marketplace add <root>` + `codex plugin add cc-master@cc-master`。
- 官方 manual 中 custom prompts 的目录是 `$CODEX_HOME/prompts`，只读取顶层 `.md`，调用形式是 `/prompts:<filename-without-md>`。
- `$1`-`$9`、`$ARGUMENTS`、named placeholders、`argument-hint` 等参数展开能力属于 custom prompts 文档段；Codex skills 文档没有给出 positional / named args 或 `$ARGUMENTS` 语义。
- `agents/openai.yaml default_prompt` 是 Codex app UI metadata，可作为技能启动提示，但不是带参数的 command/template surface。
- `codex exec [PROMPT]`、stdin、MCP/app-server 能传完整 prompt，适合外部 automation，不是 plugin-distributed command。

拒绝项：

- skill-first：skill 可以教用户怎么初始化，但不能保证第一轮 orchestrator turn 之前已经 arm board。
- skill args：当前没有官方参数展开契约，不能把 command args 搬到 skill invocation 上。
- app-server / SDK launcher：未来可作为外部 harness，但当前 plugin-bundled bootstrap 不需要引入额外 driver。

因此 `plugin/src/commands/*/adapters/codex/strategy.yaml` 使用 `mode: adapter_guidance`：Codex 没有命令 artifact 投影，但 command intent 由 prompt-first hook、user-local prompts、plugin skills、`ccm` CLI 或 skill-bundled scripts 覆盖。

## Stop Hook Policy

Codex adapter 不把 Stop hooks 投影成 Claude Code 的 fingerprinted hard Stop gate；Codex 的 `decision:block` 语义是“继续本轮”，不是 Claude Code 那套 exit-2 gate。官方 Stop docs 允许 block，但必须靠 board 状态释放，否则会形成 Stop re-entry。

当前 Codex `verify-board` 是 replacement continuation gate：

- dormant-until-armed：只有当前 session 的 active board 匹配时才输出。
- 输出：`decision:block`，`reason` 让 Codex 继续执行。
- 覆盖信号：空 active board、ready / uncertain 任务、仍在等用户的 blocked task、in-flight 但无 armed watchdog、最终目标 self-check。
- 释放机制：agent 独立确认可以停下后，先运行 `ccm board set-param stop_allow_until <future-ISO-UTC> --board <board>`；`runtime.stop_allow_until` 为未来 ISO timestamp 时，verify-board 对该 board 静默。
- 不实现 Claude Code 的 fingerprinted self-check sidecar gate；Codex 用显式 runtime 参数释放，不复用 Claude Code host-specific sidecar handshake。

Codex `usage-pacing` 也是 Stop replacement advisory：

- 只读 `ccm usage advise --json`。
- `hold` 静默；`throttle` / `switch` / `stop_5h` / `stop_7d` 输出 `systemMessage`。
- `switch` 只提示，不自动执行 `ccm account switch`；Codex account pool switching 当前不属于已支持面。
- 不实现 Claude Code `PostToolBatch` mid-turn sampling；Codex 还没有已验证同构事件。

Codex `identity-nudge` 保留周期提示，但输出也走 `systemMessage`：

- 只有恰好一个当前 session active board 时运行，避免写错 board runtime。
- 通过 `ccm board set-param` 写回 `runtime.last_identity_remind` / `runtime.last_critpath_remind`；写回失败就静默。
- 临界路径事实仍由 `ccm board critical-path` 和 `ccm estimate evm` 提供。

## PreToolUse Guard Policy

Codex `PreToolUse` 已实测接受 Claude-style `decision:block`。因此 `board-guard` 在 Codex 下保留硬阻断语义，但工具映射是 Codex-native：

- matcher：`Bash|apply_patch|Edit|Write|MultiEdit`
- 结构化 `Write` / `Edit` / `MultiEdit`：若 `tool_input.file_path`（或同义 path 字段）指向 `<CC_MASTER_HOME>/boards/*.board.json`，阻断。
- `Bash`：沿用“`.board.json` + 写操作符 + 非 ccm command segment”的启发式。
- `apply_patch`：扫描 patch payload，只要触碰 `.board.json` 路径即阻断。Codex 常用 `apply_patch` 写文件，不能只拦 Claude Code 的 `MultiEdit`。

## PostToolUse Lint Policy

Codex `board-lint` 保留非阻断 PostToolUse additionalContext 语义。与 Claude Code 的主要差异是工具路径：

- matcher：`Write|Edit|MultiEdit|apply_patch`
- `Write` / `Edit` / `MultiEdit`：读取 `tool_input.file_path` 或同义 path 字段。
- `apply_patch`：从 patch payload 中提取 `<CC_MASTER_HOME>/boards/*.board.json` 或 patch header 里的 board 路径，再跑 `ccm board lint --raw --json`。
- `Bash` 手改 board 不靠 PostToolUse 解析，优先由 `board-guard` 在 PreToolUse 阶段阻断；漏网场景未来另行 probe。

## Unsupported PostToolBatch

Claude Code 的 `posttool-batch` 依赖 `PostToolBatch`：它是在一批工具完成后的调度边界，用来做 WIP cap / owner WIP 软提示。Codex 当前没有已验证的同构事件。

不要用 Codex `PostToolUse` 伪装这个语义：`PostToolUse` 是逐工具事件，不知道一批工具是否结束，也无法稳定表达“下一轮不要继续 fan out”的批边界。当前 Codex adapter 保持 `posttool-batch: unsupported`，未来只有在 probe 出真正的 batch-boundary event 后再实现。

这修正了 paragoge 旧资料里对 `${CODEX_PLUGIN_ROOT}` 的不确定表达：对当前目标版本，不能依赖这个 token。可依赖的是 plugin hook command 中的 `${PLUGIN_ROOT}` 解析；运行时 env 仍需 adapter 自己注入或推导。

## Background And Parallel Execution

官方 Codex manual 在 2026-07-03 校对时，明确存在多层“后台 / 并行”能力。它们不是同一种 primitive，不能混成 Claude Code 的 `run_in_background`：

| 类别 | Codex 机制 | 当前事实 |
| --- | --- | --- |
| thread 并行 | local threads / cloud threads | 一个 thread 是一次会话；可以同时运行多个 thread。Cloud thread 在隔离的 Codex environment 中执行，适合并行或跨设备委托。 |
| Codex Cloud task | `codex cloud exec` / `codex cloud list` | CLI 可提交和列出 Cloud task；`cloud exec` 需要目标 environment ID。 |
| Codex App thread mode | Local / Worktree / Cloud | App 中 thread 可直接跑在本地项目、隔离 worktree 或 Cloud。可以显式要求创建 background thread。 |
| Worktree isolation | Codex-managed worktree | App worktree 允许同一 repo 多个独立任务并行。Automations 在 Git repo 中默认可用 dedicated background worktree。 |
| Automations | standalone / project automations | 周期性后台任务；结果进入 Triage，或无发现时自动归档。可结合 skills。 |
| Thread automations | attached heartbeat wake-up | 附着当前 thread 的定期唤醒，用于等待长命令、轮询外部源、持续 review loop 等需要保留同一对话上下文的任务。 |
| Subagents | Codex subagent workflows | CLI 和 App 当前支持；只在用户显式要求 subagents / parallel agents 时启动；Codex 负责等待并汇总结果。API / tool 会话中 multi-agent 工具可能 deferred，需要先通过 `tool_search` 发现。 |
| Background terminals | `/ps` / `/stop` | CLI slash commands 显示为 experimental background terminals；`/ps` 查看后台终端，`/stop` 停止当前 session 启动的后台终端。 |
| 非交互自动化 | `codex exec` | 适合脚本、CI、scheduler；支持 JSONL 事件输出、显式 sandbox / approval 设置。 |
| GitHub Actions | `openai/codex-action@v1` | 官方 GitHub Action 封装 Codex CLI / `codex exec`，适合 PR review、release prep、迁移等 CI/CD 任务。 |
| Programmatic server | `codex app-server` / `codex mcp-server` | app-server 提供 JSON-RPC thread / turn API；mcp-server 暴露 `codex` / `codex-reply` tools，可被 Agents SDK 编排。 |
| Remote host | Remote connections | 手机或另一台设备连接 Mac / Windows Codex App host；使用连接 host 的项目、线程、凭证、plugins、MCP、Computer Use 和本地工具。 |
| External integrations | Slack / Linear | 从外部入口创建 Codex Cloud task，并在对应线程 / issue 中回传进度或结果。 |

### Adapter Boundary

上述是 Codex 官方“能后台运行”的产品能力，不等于 cc-master 的三类后台派发 primitive 已经有 Codex 等价物：

- Claude Code `Bash run_in_background`：Codex 有 background terminals，但尚未 probe 出可由 agent / plugin 以同等方式启动、拿 handle、等完成通知的派发契约。
- Claude Code `Task/Agent run_in_background`：Codex 有 subagents。CLI / App 下这是官方能力；Codex API / tool 会话下，当前验证路径是先用 `tool_search` 暴露 `multi_agent_v1.spawn_agent` / wait / resume 等 deferred tools，再以 spawn 返回的 agent id 作为 board handle。没有真实工具或真实返回值时，不得把当前主会话伪装成 subagent handle。
- Claude Code `Workflow` tool：当前没有已验证的 Codex-native deterministic workflow runtime 等价物。
- Claude Code watchdog 链 `CronCreate` / `ScheduleWakeup` / `Monitor` / background-shell floor：Codex 官方对应能力更接近 automations / thread automations / background terminals / 外部 scheduler；不能按同名 tool primitive 投影。

因此 Codex adapter 对后台派发采用 capability-sensing 纪律：先确认当前 surface 给了什么可追踪机制，再写 board `executor` / `handle`。subagent 是可用产品能力，但 API 会话必须先 discovery deferred tools；background terminal、automation、watchdog 仍不能复制 Claude Code 指令。`master-orchestrator-guide` 的 Codex projection 只能教这些 Codex-native 入口和边界，不能把 Claude Code Workflow / `run_in_background` 当同名原语。

## Timer / Wakeup / Cron Equivalents

本仓要特别区分 Claude Code 的本地 timer primitives 和 Codex 的产品级 automation surfaces。

### 已确认不存在同级 primitive

截至 Codex CLI 0.142.5 + 2026-07-03 官方 manual：

- 官方 manual 未记录 Codex 有 `CronCreate`、`ScheduleWakeup` 或同名 wakeup tool。
- `codex --help` / `codex cloud --help` / `codex exec --help` 未暴露 cron / schedule / wakeup 子命令。
- `codex features list` 中没有稳定 cron / wakeup feature；`sleep_tool` 为 `under development false`，不能作为当前可用机制。
- CLI slash command 只有 `/ps` / `/stop` 用于 experimental background terminals 的查看 / 停止，不是定时唤醒 API。

所以：**Codex 当前没有可直接映射 Claude Code `CronCreate` / `ScheduleWakeup` 的 agent-tool primitive**。不要在 Codex adapter 中投影这两个名字，也不要假设有 `<task-notification>` 同构完成事件。

### 官方替代路径

| 场景 | Codex 替代方案 | 适配边界 |
| --- | --- | --- |
| 同一对话定期回来查状态 | **Thread automation** | 官方称为 attached heartbeat-style recurring wake-up，会保留 thread context；支持 minute-based interval、daily、weekly。最接近 cc-master watchdog，但它是 Codex App automation surface，尚未验证为 plugin / skill 可直接调用的 tool primitive。 |
| 周期性独立任务 / cron 式巡检 | **Standalone / project automation** | 官方支持 recurring schedule，custom schedule 可输入 cron syntax；每次 fresh run，结果进 Triage。适合 drift check / PR babysitting，不适合需要同一 orchestrator thread state 的 in-thread watchdog。 |
| CI / 服务器上的定时任务 | **外部 scheduler + `codex exec`** | 用 cron、CI scheduler、systemd timer 等外部调度 `codex exec`；这是最可脚本化、host-neutral 的替代路径，但它是外部编排，不是 Codex 内建 wakeup。 |
| 长命令完成检查 | **Background terminal + thread automation** | background terminal 负责长命令，thread automation 周期性回来读取 / 检查状态；需要 App / CLI 交互面实测，不能当作 cc-master runtime primitive 直接依赖。 |
| Cloud/offloaded work | **Codex Cloud task + status/list** | `codex cloud exec` 提交任务，`codex cloud list/status` 查询；适合 offload，不是定时 wakeup。定时提交仍靠 automation 或外部 scheduler。 |

对 cc-master adapter 的含义：Codex 的 watchdog 能力若要落地，应新增 Codex-native 设计，而不是复用 Claude Code 降级链。候选设计是：

1. App-only overlay：使用 thread automation 作为同 thread watchdog。
2. Portable external overlay：用外部 scheduler 调 `codex exec resume <SESSION_ID>` / `codex exec resume --last` 或专门的 status-check prompt。
3. Conservative floor：没有可验证 automation surface 时，不启用自动 wakeup，只在文档中要求用户 / 外部 scheduler 接管。

## Adapter Implications

Codex adapter 不能直接照搬 Claude Code 的 `${CLAUDE_PLUGIN_ROOT}` 模式。路径策略当前收敛为：

- plugin-bundled hook registration 使用 `hooks/hooks.json`（manifest 显式 `"hooks": "./hooks/hooks.json"`）。
- hook command 用 `${PLUGIN_ROOT}/...` 指向插件内脚本。
- 若脚本自身需要 root/data 路径，在 command 里注入自有 env，例如 `CC_MASTER_PLUGIN_ROOT="${PLUGIN_ROOT}"` / `CC_MASTER_PLUGIN_DATA="${PLUGIN_DATA}"`，不要假设子进程天然带 `PLUGIN_ROOT`。
- `CODEX_PLUGIN_ROOT` 不使用。
- `Stop` hook 不使用 `decision:block` 或 exit 2；这两种都会造成重入循环。需要阻断文件修改等硬闸时，优先放在 `PreToolUse`。

新增 `plugin/dist/codex` 前必须先补：

- `.codex-plugin/plugin.json` source / adapter strategy；
- `plugin/src/skills/<skill>/adapters/codex/strategy.yaml`；
- `plugin/src/hooks/_hosts/codex/`；
- `plugin/src/hooks/<hook>/implementations/codex/`；
- host-native validation 或 probe 脚本；
- sync check，防止 source/dist drift。
