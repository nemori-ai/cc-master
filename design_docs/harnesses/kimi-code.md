# kimi-code Harness Facts

更新时间：2026-07-16。

本页是 kimi-code（Moonshot AI 官方终端 AI coding agent CLI）作为 cc-master 目标 harness 的权威事实文档，供后续 adapter 设计（plugin 投影 + ccm worker driver）直接消费。

## Source Hierarchy

kimi-code 事实按以下优先级维护：

1. 本仓对本机 kimi v0.26.0 的 probe（二进制 `/data/qiwei/.kimi-code/bin/kimi`，home `/data/qiwei/.kimi-code`）。
2. 官方文档（<https://moonshotai.github.io/kimi-code/>）+ 文档层调研报告。

证据等级标注：

- **[tested]**：本机实测，附可复现命令。含两类——① CLI/文件系统行为实测；② 对**发布二进制**做 `strings` + `grep` 的静态取证（reproducible，命令随文附），比官方文档更强。
- **[docs]**：仅官方文档 / 文档层调研，未本机验证。
- **[unresolved]**：未查清或实测受阻，含尝试记录。

本次 probe 全程用隔离 `KIMI_CODE_HOME`（`/tmp/.../kimi-fix/kimi-home`，credentials 以 symlink 指向真实 home、从不写入），真实 home 零改动（实测末尾核验：无新 session、无 `plugins/` 目录写入）。

`strings` 取证复现基线（下文所有 [tested·binary] 事实均可用此文件复现）：

```bash
strings -n 6 /data/qiwei/.kimi-code/bin/kimi > /tmp/kimi.strings.txt
grep -nF "<token>" /tmp/kimi.strings.txt
```

## Scope

本页覆盖 **kimi-code CLI**（本机 v0.26.0，npm `@moonshot-ai/kimi-code`，Node SEA 单文件二进制 ~153 MB，实测 `nodeVersion=v24.15.0`）。它既是潜在的 **plugin origin host**（主会话被初始化成 orchestrator），也是潜在的 **headless worker target**（`kimi -p` 单发驱动）。两个角色的事实在下文分别标注。

**不在本页目标范围**：kimi web UI / server / ACP 服务端的完整协议（只做入口级标注）；Moonshot API 直连（非 CLI 宿主）。

---

## 1. 产品形态与 CLI 表面 [tested]

复现：`/data/qiwei/.kimi-code/bin/kimi --help`、`kimi --version`。

- **版本**：`kimi --version` → `0.26.0`。
- **顶层 options**：
  - `-p, --prompt <prompt>` — **headless 单发**：跑一个 prompt 非交互打印响应（worker driver 命门）。
  - `--output-format <text|stream-json>` — prompt 模式输出格式（默认 text）。
  - `-S, --session [id]` — resume session（带 id 恢复该 session；不带 id 交互选）。
  - `-c, --continue` — 继续该 workDir 的上一个 session。
  - `-y, --yolo` — 自动批准所有动作。`--auto` — auto permission mode。**注意 [tested]：这两个权限 flag 均与 `-p/--prompt` 互斥**——`kimi -p '…' -y` 报 `error: Cannot combine --prompt with --yolo.`、`kimi -p '…' --auto` 报 `error: Cannot combine --prompt with --auto.`，均秒退 exit 1。`-p` headless 单发**自身即以非交互模式自动执行工具**（无需也不能叠这两个 flag，见 §10 Approval）。
  - `-m, --model <alias>` — 选模型 alias（默认 `default_model`）。
  - `--skills-dir <dir>`（可重复）— 用指定目录 skills 覆盖自动发现的用户/项目 skills。
  - `--add-dir <dir>`（可重复）— 追加 workspace 目录。`--plan` — plan mode 启动。
- **子命令**：`export`（导出 session zip）、`provider`（非交互管理 LLM provider：add/remove/list/catalog）、`acp`（Agent Client Protocol server over stdio）、`server`（本地 REST+WebSocket+web UI）、`web`（web UI daemon）、`login`（device-code 登录）、`doctor`（校验 config.toml / tui.toml）、`vis`（session 可视化）、`migrate`（从旧 kimi-cli 迁移）、`upgrade|update`。
- **未知子命令静默降级为根 help**：`kimi plugins` / `kimi skills` / `kimi usage` 等都不是真命令，直接打印根 help（exit 0）。**故不存在 `kimi plugins install` 之类的非交互插件管理命令**（见 §4）。
- **认证**：OAuth device-code（`kimi login`）；`kimi provider list` → `managed:kimi-code type=kimi models=3`，base `https://api.kimi.com/coding/v1`；凭证落 `$KIMI_CODE_HOME/credentials/kimi-code.json`（`config.toml` 里 `[providers."managed:kimi-code".oauth] storage="file" key="oauth/kimi-code"`）。本机已登录。

---

## 2. Home 布局与配置 [tested]

复现：`ls -la /data/qiwei/.kimi-code/`、`cat .../config.toml`。

`$KIMI_CODE_HOME`（默认 `~/.kimi-code`）顶层：

| 条目 | 作用 |
| --- | --- |
| `config.toml` | 主配置（agent/runtime）：`default_model`、`[providers.*]`、`[models.*]`、`[thinking]`、`[services.*]`、`[[hooks]]`、`[permission.rules]` |
| `tui.toml` | 客户端偏好（theme / notifications / `[upgrade] auto_install`） |
| `credentials/kimi-code.json` | OAuth 凭证（0600） |
| `device_id` | 设备 UUID |
| `sessions/<wd>/<sid>/` | 会话目录（见 §9） |
| `session_index.jsonl` | 全局 session 索引：每行 `{sessionId, sessionDir, workDir}` |
| `workspaces.json` | workspace 注册表：`wd_<name>_<hash>` → `{root, name, created_at, last_opened_at}` |
| `plugins/managed/<id>/` + `plugins/installed.json` | 插件托管目录 + 安装注册表（见 §4，默认不存在，装插件才建） |
| `logs/`、`telemetry/`、`updates/`、`user-history/` | 诊断 / 遥测 / 更新检查 / 输入历史 |
| `skills/`、`AGENTS.md`、`mcp.json` | 用户级 skills / 指令 / MCP（默认不存在，按需建） |

**模型 catalog（本机 config.toml）** [tested]：

| alias | model | max_context | 说明 |
| --- | --- | --- | --- |
| `kimi-code/k3` | k3 | 1,048,576 | **默认**，`support_efforts=[max]`、`default_effort=max` |
| `kimi-code/kimi-for-coding` | kimi-for-coding | 262,144 | 显示名 K2.7 Coding |
| `kimi-code/kimi-for-coding-highspeed` | kimi-for-coding-highspeed | 262,144 | K2.7 Coding Highspeed |

全部 capabilities 含 `thinking/always_thinking/image_in/video_in/tool_use`。`[thinking] enabled=true effort=max`。

**项目级配置**：`<projectRoot>/.kimi-code/local.toml`（`getWorkspaceLocalConfigPath = join(projectRoot, ".kimi-code", "local.toml")`，binary line 630643）+ `<cwd>/.kimi-code/mcp.json`。`projectRoot` = 从 workDir 向上找最近含 `.git` 的目录，无则 cwd。**⚠️ `local.toml` 不加载 `[[hooks]]`**（见 §6 实测）。

---

## 3. Skills [tested·binary + docs]

- **SKILL.md frontmatter**（binary `normalizeMetadata` 别名表，line ~634440）：`name`、`description`（目录型 skill 两者必填）、`type`（`prompt` 默认 / `inline` 同义 / `flow` 仅手动不参与模型自动触发）、`whenToUse`（接受 `when-to-use` / `when_to_use`）、`disableModelInvocation`（接受 `disable-model-invocation` / `disable_model_invocation`）、`arguments`（命名参数，字符串或数组）。
- **扫描优先级 Project > User > Extra > Built-in** [docs]：用户级 `$KIMI_CODE_HOME/skills/` + `~/.agents/skills/`；项目级 `.kimi-code/skills/` + `.agents/skills/`；config `extra_skill_dirs`；`--skills-dir` override（可重复）。
- **Body 文本替换（决定性事实）** [tested·binary]：skill/command body 由同一个 `expandSkillParameters` 渲染（line 634336–634352 / 799062）：
  - `${KIMI_SKILL_DIR}` → skill 目录、`${KIMI_SESSION_ID}` → session id，**是文本替换（`content.replaceAll`），不是 env 变量**。这回答了「`${KIMI_SKILL_DIR}` 是 env 还是文本替换」= **文本替换**，且附带一个未文档化的 `${KIMI_SESSION_ID}` token。
  - 参数占位符：`$name`（来自 `arguments`）、`$0`/`$1`…（positional）、`$ARGUMENTS[n]`、`$ARGUMENTS`（全量）。
  - **无占位符但有传参 → body 末尾追加 `\n\nARGUMENTS: <args>`**。
  - `${KIMI_PLUGIN_ROOT}` **不做文本替换**（`grep -cF '${KIMI_PLUGIN_ROOT}'` = 0）——它只是 hook/MCP 子进程 env（见 §5）。canonical/adapter skill 正文引用随 skill 分发的资源，只能用 `${KIMI_SKILL_DIR}`，不能用 `${KIMI_PLUGIN_ROOT}`。
  - body 还会被解析 ```mermaid / ```d2 flowchart（`parseMermaidFlowchart` / `parseD2Flowchart`）。
- **触发**：模型按 description/whenToUse 自动调用（除非 `disableModelInvocation` / `type:flow`）；用户 `/skill:<name>`；外部子 skill 显示为 `/<parent>.<sub>` [docs]。

---

## 4. Plugin manifest 与安装 [tested]

- **Manifest 路径**（binary line 735969）：`kimi.plugin.json`（根，主）或 `.kimi-plugin/plugin.json`（fallback）。
- **必填**：`name`。**其余字段**：`version/description/keywords/author/homepage/license`、`interface{displayName,shortDescription,longDescription,developerName,websiteURL}`、`skills[]`（`./` 路径）、`sessionStart.skill`、`skillInstructions`、`mcpServers`、`hooks[]`（同 `[[hooks]]` schema）、`commands[]`（`./` 路径指向目录或 `.md`）。
- **无 `agents` 字段** → **plugin 不能声明自定义 subagent**（见 §7）。
- **manifest 里被忽略的字段**（`UNSUPPORTED_RUNTIME_FIELDS`，binary line 735971）：`tools`、`apps`、`inject`、`configFile`、`config_file`、`bootstrap`——写了也不生效（对 Claude Code 迁移形态的静默兼容）。
- **安装是 TUI-only**：官方入口 `/plugins install <path|url>`、`/plugins marketplace <source>`（TUI slash command）。**无非交互 CLI 等价命令**（`kimi plugins` 落根 help）。marketplace 默认 `KIMI_CODE_PLUGIN_MARKETPLACE_URL`（`${CDN}/plugins/marketplace.json`）。
- **非交互安装（adapter 落地关键）** [tested]：本地插件安装 = **复制进 `$KIMI_CODE_HOME/plugins/managed/<id>/` + 在 `$KIMI_CODE_HOME/plugins/installed.json` 注册**。托管路径 binary 证实：`const managedRoot = join(kimiHomeDir, "plugins", "managed", id)`。`installed.json` schema：

  ```json
  { "version": 1, "plugins": [
    { "id": "<id>", "root": "<abs managed dir>", "source": "local-path",
      "enabled": true, "installedAt": "<ISO>", "updatedAt": "<ISO>" }
  ]}
  ```

  运行时 record 从 `root` 读 manifest 派生 `state`（ok/error）、`hooks`、`skills`、`mcpServers`（binary `recordFrom`）。**实测**：手写 managed 目录 + installed.json 后，`kimi -p` 一跑，插件的 hook 与 skill 即被发现执行（见 §6 capture）——这是 adapter/install.sh 的可脚本化安装路径。
- **命令命名空间**：plugin 命令为 `<plugin>:<command>`（单级）。子目录是否多级命名空间 [unresolved]（binary 只见 `<pluginId>:<command>` 组装，未实测多级）。

---

## 5. Plugin 子进程 env 与 cwd [tested]

plugin **hook** 子进程注入 env（binary `enabledHooks()` line 736597；capture 实证）：

| var | 值 |
| --- | --- |
| `KIMI_CODE_HOME` | home 绝对路径 |
| `KIMI_PLUGIN_ROOT` | 该插件 managed 目录绝对路径 |

- **只有这两个**——`PLUGIN_ROOT` / `CLAUDE_PLUGIN_ROOT` / `KIMI_PLUGIN_DATA` 均 **UNSET**（capture 实证 `env_PLUGIN_ROOT=<UNSET>`、`env_CLAUDE_PLUGIN_ROOT=<UNSET>`）。**kimi 不设 Claude-compat 别名**（区别于 Codex 会设 `PLUGIN_ROOT`）。
- plugin hook **cwd = 插件 managed 目录**（capture `pwd` = managed dir）；对比用户/全局 `config.toml` hook 的 cwd = session workDir（§6 GLOBAL capture 实证）。
- plugin **stdio MCP** 子进程同样注入 `KIMI_CODE_HOME` + `KIMI_PLUGIN_ROOT`（binary `withPluginMcpRuntime` line 736391），runtime name `plugin-<id>:<server>`。

**adapter 路径纪律**：插件内脚本路径用 `$KIMI_PLUGIN_ROOT`（hook command 字符串或脚本 `process.env.KIMI_PLUGIN_ROOT`）。**注意 hook command 字符串本身不会展开 `${KIMI_PLUGIN_ROOT}`**——它是子进程 env，不是 command token（与 Codex 的 `${PLUGIN_ROOT}` command-token 语义相反）。可靠形态：command 里 `node "$KIMI_PLUGIN_ROOT/hooks/x.js"`（由 shell 展开该 env），或脚本用 `__dirname` 自解析。

---

## 6. Hooks [tested]

### 配置来源与合并

- **来源**：① 全局 `$KIMI_CODE_HOME/config.toml` 的 `[[hooks]]`；② plugin manifest `hooks[]`。**合并 = UNION**（实测：同一 `UserPromptSubmit` 事件，全局 config hook 与 plugin hook **都触发**）。
- **⚠️ 项目 `.kimi-code/local.toml` 的 `[[hooks]]` 不触发**（Q5 决定性实测）——同一 fixture 里全局 config + plugin hook 都触发、local.toml 声明的五个 hook 一个都没触发。**结论：hook 只能来自全局 config.toml + plugin manifest；项目级 hook 无支持面。**
- **HookDefSchema**（binary `HookDefSchema` line ~628985）：`{ event(enum，必填), matcher?(regex 字符串), command(min1，必填), timeout?(int 1–600，默认 30) }`。只支持 command 型 hook。超时后 SIGTERM→SIGKILL。

### 事件全集 [tested·binary]（`HOOK_EVENT_TYPES`）

`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`PostToolUseFailure`、`PermissionRequest`、`PermissionResult`、`SessionStart`、`SessionEnd`、`SubagentStart`、`SubagentStop`、`Stop`、`StopFailure`、`Interrupt`、`PreCompact`、`PostCompact`、`Notification`。

比 Claude Code 多 `PostToolUseFailure` / `PermissionRequest` / `PermissionResult` / `SubagentStart` / `StopFailure` / `Interrupt` / `PostCompact`；**无 `PostToolBatch`**（`grep -c PostToolBatch` = 0）。

### stdin：snake_case JSON [tested]

boundary 转换：`toHookInputData` 对每个 key 跑 `camelToSnake`（binary line 683542）——故 stdin **全 snake_case**。实测 capture：

| 事件 | 实测 stdin |
| --- | --- |
| 公共字段 | `hook_event_name`、`session_id`（`session_<uuid>`）、`cwd`（= session workDir） |
| `UserPromptSubmit` | + `prompt`：**content-block 数组** `[{"type":"text","text":"..."}]`（非纯字符串，区别于 Claude Code） |
| `PreToolUse`/`PostToolUse` | + `tool_name`、`tool_input`（binary `triggerBlock("PreToolUse",{toolName,toolInput})`，PostToolUse 另有 `tool_response`/`tool_use_id`） |
| `Stop` | + `stop_hook_active`（实测 `false`） |

### 输出：结构化 JSON envelope [tested·binary]

hook stdout 若能 `JSON.parse` 且过 `HookJsonOutputSchema`（binary line 683390），schema =

```jsonc
{
  "message": "string?",                       // 注入 agent 的文本
  "hookSpecificOutput": {
    "message": "string?",
    "permissionDecision": "deny?",            // 仅 "deny" 触发阻断
    "permissionDecisionReason": "string?"
  }
}
```

- **上下文注入走 `message`**（top-level `message` 或 `hookSpecificOutput.message`）——**不是** Claude Code 的 `additionalContext`（`grep -c additionalContext`=0），也**不是** Codex 的 `systemMessage`。这是 hook→agent 通信的核心适配差异。
- **阻断**：`hookSpecificOutput.permissionDecision === "deny"` → `action:block` + `reason = permissionDecisionReason`（`blockDecision` 汇总，默认 reason `Blocked by <event> hook`）。
- stdout 非合法 JSON → 当作 allow，原样带 stdout/stderr（`structuredOutput$1` 返回 undefined 时 `allowResult`）。
- **退出码**：`0`=放行（可带上述结构化输出）；文档称 `2`=拒绝（stderr 为理由）、其他=fail-open [docs]——本次只实测了 exit 0 + 结构化输出路径，exit-2 deny 未单独实测 [docs]。

### 实测复现

```bash
KIMI_CODE_HOME=<隔离home> kimi -p "Reply with exactly: PING. No tools." --output-format stream-json
# 全局 config.toml [[hooks]] 与 plugin manifest hooks 均触发；project local.toml [[hooks]] 不触发
```

---

## 7. Agents / Subagents [tested·binary + docs]

- **无自定义 subagent**。manifest 无 `agents` 字段；`SubagentConfigSchema` 只含 `timeoutMs`（`Agent`/`AgentSwarm` 前后台超时，默认 2h），**不定义 subagent**。
- **内置类型**：`coder`（默认——`if (!hasSubagentType && !hasResumeId) subagent_type="coder"`）、`explore`（只读）、`plan`（规划）、`general`。Task 工具入参 `subagent_type`（snake_case），handle 的 `subagentType = profileName`。
- **Agent Swarm**（v0.12.0）= 多 subagent 前后台并行模式（共享 `SubagentConfigSchema` 超时）；仍是内置角色的并行，非用户自定义角色。
- **subagent 运行态**持久化在 `sessions/<wd>/<sid>/agents/<agentId>/wire.jsonl`（主 agent = `agents/main/`；`state.json` 的 `agents` 映射记 `{homedir,type,parentAgentId}`）。
- **AGENTS.md 指令文件** [docs+tested]：`$KIMI_CODE_HOME/AGENTS.md`、`~/.agents/AGENTS.md`、项目 `.kimi-code/AGENTS.md` 或项目根 `AGENTS.md`。实测：workDir=`/data/qiwei/repos/cc-master` 时 kimi 读取仓库根 `AGENTS.md`（log 警告 `AGENTS.md total 94.7 KB exceeds recommended 32 KB`）——**kimi 直接吃项目根 AGENTS.md，且对 >32KB 的大指令文件告警**（对 cc-master 的 94.7KB AGENTS.md 是现实约束）。

**能力缺口（adapter 最大一块）**：cc-master 依赖「自定义 subagent 角色 + 显式 dispatch handle」的编排纪律，在 kimi 上只有 coder/explore/plan 三个内置角色 + swarm，须走 Capability Card 记 `protocol-capability-gap`。

---

## 8. MCP [docs + tested·binary]

- 传输 stdio / HTTP / SSE。配置 `mcp.json`：用户级 `$KIMI_CODE_HOME/mcp.json` + 项目级 `<cwd>/.kimi-code/mcp.json`（项目覆盖用户）；另兼容读项目根 Claude 式 `.mcp.json`（`import-from-cc-codex` skill 明确「项目根 `.mcp.json` 已被 Kimi 当 Claude 兼容 MCP 读」）。
- plugin `mcpServers` 复用 MCP schema，runtime name `plugin-<id>:<server>`，env 注入 `KIMI_CODE_HOME`+`KIMI_PLUGIN_ROOT`（§5）。
- OAuth via `/mcp-config login`（TUI skill，user-invocable-only）。合并/卸载清理规则 [unresolved]（未实测）。

---

## 9. Env / 路径 / Session 布局 [tested]

- **home 解析**：`$KIMI_CODE_HOME` > `~/.kimi-code`（binary `resolveKimiHome`；`import-from-cc-codex` skill 亦述此序）。
- **session 目录**：`sessions/wd_<name>_<hash>/session_<uuid>/`，内含 `state.json`（`{createdAt,updatedAt,title,agents{<id>:{homedir,type,parentAgentId}},workDir}`）+ `agents/<agentId>/wire.jsonl`（typed JSONL transcript：`metadata`/`config.update`/…）。
- **全局 session 索引**：`$KIMI_CODE_HOME/session_index.jsonl`（每行 `{sessionId, sessionDir, workDir}`）——**worker driver 定位任一 session transcript 的入口**。
- **值得注意的 env 变量**（`strings | grep -oE 'KIMI_[A-Z_]+'`）：`KIMI_CODE_HOME`、`KIMI_PLUGIN_ROOT`、`KIMI_CODE_PLUGIN_MARKETPLACE_URL`、`KIMI_MODEL_{NAME,TEMPERATURE,TOP_P,THINKING_EFFORT}`、`KIMI_API_KEY`、`KIMI_CODE_BASE_URL`/`_ENV`、`KIMI_SHELL_PATH`、`KIMI_DISABLE_CRON`/`KIMI_CRON_CLOCK`/`KIMI_CRON_DEBUG`（内置 cron/scheduler 机制存在，但未见 agent-facing 工具面 [unresolved]）、`KIMI_SUBAGENT_TIMEOUT_MS`、`KIMI_IMAGE_MAX_EDGE_PX`。
- **skill/command 文本 token**（非 env）：`${KIMI_SKILL_DIR}`、`${KIMI_SESSION_ID}`（§3）。

---

## 10. Headless 与 Worker 可行性 [tested]

**结论：kimi-code 具备可用的 headless worker 面（`kimi -p` 单发 + stream-json + session/transcript recon），可行性高于 Codex/Cursor 的降级形态；主要缺口在 quota 信号。approval 无缺口——`-p` 单发自身即以非交互模式自动执行工具（含写文件），无需也不能加 `-y`/`--auto`（二者与 `-p` 互斥，见 §10 Approval）[tested]。**

### 单发调用

```bash
kimi -p "<prompt>" --output-format text        # exit 0；stdout = 助手回复（"• " bullet 前缀 + 按终端宽度换行）；stderr = thinking + resume hint
kimi -p "<prompt>" --output-format stream-json  # exit 0；stdout = JSONL
```

实测 exit 0、真实模型回复（本机已登录，用默认 k3）。

### stream-json 事件 schema [tested·binary + tested]

**OpenAI-message 形状 JSONL**（`PromptJsonWriter`，binary line ~933780），**非** Claude Code 的 `{type:"assistant"/"result"}`：

| line | 形状 |
| --- | --- |
| version | `{"role":"meta","type":"system.version","version":...}` |
| 助手 | `{"role":"assistant","content":"...","tool_calls":[{"type":"function","id":..,"function":{"name":..,"arguments":"<json-str>"}}]}` |
| 工具结果 | `{"role":"tool","tool_call_id":..,"content":"..."}` |
| 重试 | `{"role":"meta","type":"turn.step.retrying","failed_attempt":..,"max_attempts":..,...}` |
| resume 提示（末） | `{"role":"meta","type":"session.resume_hint","session_id":"session_<uuid>","command":"kimi -r <sid>","content":"..."}` |

实测输出：`{"role":"assistant","content":"PING"}` + resume_hint 行。

### Session / resume / recon

- 每次 `-p` 建新 session（id `session_<uuid>`），落 `session_index.jsonl`。
- **resume**：`kimi -S <sid>`（documented）；resume hint 用 `kimi -r <sid>`（`-r` 别名，实测由 hint 发出，功能未单独验证 [docs]）；`kimi -c` 继续 workDir 上一个。resume + `-p` 可做 headless 续跑。
- **transcript / recon handle**：给定 `sessionId` →（a）读 `session_index.jsonl` 定位 sessionDir → `agents/main/wire.jsonl`；或（b）`kimi export <sid> -y -o out.zip` → zip 含 `manifest.json` + `agents/*/wire.jsonl` + `state.json` + `logs/`（实测）。**这是 ccm worker driver 拿可 recon handle 的干净路径。**
- **stream-json 的 `session.resume_hint.session_id` 直接给出 handle**——worker 无需另查即可拿到 recon 键。

### Approval / 背景执行

- **`-p` headless 单发自身即以非交互模式自动执行工具（含写文件），无需也不能加显式权限 flag [tested]。** 实测 `kimi -p '在当前目录创建 probe.txt 写一行 hello'`（不加任何权限 flag）→ exit 0 且 **probe.txt 被真实创建**（headless 无 TTY 下工具调用自动执行，不阻塞、不被拒）。
- **权限 flag 互斥于 `-p` [tested]**：`-y`/`--yolo` 与 `--auto` **都不能与 `-p/--prompt` 组合**——`kimi -p '…' -y` → `error: Cannot combine --prompt with --yolo.`、`kimi -p '…' --auto` → `error: Cannot combine --prompt with --auto.`，两者均秒退 **exit 1、不产出任何文件**。故 headless worker **绝不要**给 `-p` 叠 `-y`/`--auto`（会直接失败）。`-y`/`--auto` 是**交互（TUI）模式**下的自动批准开关，不适用于 `-p` 单发。
- config `[permission.rules]`（首条命中）allowlist 仍是**可选**的额外约束层——`-p` 已自动执行工具，rules 只用于进一步收窄可执行的工具面（如需最小权限），非启用工具执行的前提。
- `BackgroundConfigSchema`（binary）：Bash 工具支持后台任务（`bashTaskTimeoutS` 默认 600s、`bashAutoBackgroundOnTimeout`、`maxRunningTasks`、`keepAliveOnExit`）；print 模式有 `printBackgroundMode: exit|drain|steer` + `printMaxTurns`——`steer` 提示 print 模式下可多轮 steer。
- **更强的编程 driver 面**（未深测 [docs]）：`kimi acp`（Agent Client Protocol over stdio）、`kimi server`（REST+WebSocket JSON-RPC）——比 `-p` 更适合结构化编排的 worker transport，值得后续 probe。

### Quota / 配额信号 [tested — 无]

**CLI 无 headless quota/usage 输出**：无 `kimi usage` 命令（落根 help）；`/usage` 是 TUI slash command；`strings` 无 CLI 侧配额结构。**worker driver 拿不到 kimi 的 5h/7d 类配额信号**——须走 `unsupported`（同 Cursor account pool / Codex 5h 退役后的诚实标注）。

---

## 11. 与 Claude Code / Codex 的兼容性 [tested·binary + docs]

- **无任何格式兼容声明**。唯一官方互操作点：内置 skill `/import-from-cc-codex`（v0.13.0，binary 内嵌全文）——**单向一次性导入**，且**明确只导** instructions（`AGENTS.md`/`CLAUDE.md`）、skills、MCP，**明确不导** hooks、plugins、plugin caches、commands、custom subagents、credentials、sessions、output styles。**不会读 `.claude-plugin/plugin.json`**。
- kimi **原生**读 `.agents/skills`、`AGENTS.md`、Claude 兼容 `.mcp.json`——`.agents/` 是跨工具趋同目录。
- 结构性差异汇总：hook 配置 TOML 而非 JSON；hook 事件集更大且无 PostToolBatch；hook 上下文注入字段是 `message`（非 `additionalContext`/`systemMessage`）；无自定义 subagent；无独立 commands 目录；plugin 子进程只有 `KIMI_*` env（无 `CLAUDE_*`/`PLUGIN_ROOT` 别名）；`${KIMI_SKILL_DIR}` 是文本替换。

---

## 12. 对 cc-master plugin adapter 的关键落点

1. **独立 `kimi.plugin.json` 投影分支（不复用 CC/Codex manifest）**——manifest 用 `skills[]`/`commands[]`/`hooks[]`/`mcpServers`/`sessionStart.skill`/`skillInstructions`；`agents` 字段无效。SAP skills 走 `skills[]`；PHIP hooks 走 manifest `hooks[]`（**不是** JSON hooks 文件，是 TOML/manifest 数组元素 `{event,matcher,command,timeout}`）。
2. **hook→agent 注入协议改写**：cc-master 的 `additionalContext`（CC）/ `systemMessage`（Codex）在 kimi 下要改写成 **`message`**；阻断改写成 `hookSpecificOutput.permissionDecision="deny"` + `permissionDecisionReason`。ADR-018 的 ambient/advisory/directive 标签仍写进 `message` 文本体。
3. **路径 token 落点**：skill 正文引用随 skill 分发资源用 `${KIMI_SKILL_DIR}`（文本替换，可靠）；hook 脚本用 `$KIMI_PLUGIN_ROOT`（子进程 env，command 里由 shell 展开或脚本 `__dirname` 自解析）——**不要**假设 `${KIMI_PLUGIN_ROOT}` 会在 command 字符串或 skill 正文里被展开。canonical 正文禁写 `${CLAUDE_*}`。
4. **hook 只从全局 config.toml + plugin manifest 加载**——bootstrap/reinject/board-guard 等必须走 plugin manifest `hooks[]`；**不能**依赖项目 `.kimi-code/local.toml` 的 `[[hooks]]`（不生效）。武装闸的 dormant-until-armed 语义可平移（红线6），但 stdin 是 snake_case、`prompt` 是数组、注入走 `message`。
5. **reinject（魂重注）缺口**：kimi 有 `PreCompact`/`PostCompact` 事件——**比 Cursor 强**（Cursor 只有观察型 preCompact）。`PostCompact` 是否能注入 `message` 进 compaction 后的 context 需 probe；若可，则 reinject 有原生落点（优于 Cursor 的 Track B 降级），这是 kimi adapter 的一个潜在优势项，应优先实测。
6. **command 投影**：无独立 commands 目录 → 落 plugin manifest `commands[]`（`<plugin>:<command>`），或 skill `/skill:<name>`；bootstrap 入口可同 Codex/Cursor 走「plugin command + UserPromptSubmit hook 识别第一行 sentinel」双通道（kimi 有 `UserPromptSubmit`，`prompt` 数组第一 block 的 text 判 sentinel）。
7. **install.sh 落点**：非交互安装 = 复制 `plugin/dist/kimi-code` 进 `$KIMI_CODE_HOME/plugins/managed/cc-master/` + 写 `plugins/installed.json` 条目（实测可用）；无需驱动 TUI `/plugins install`。
8. **能力缺口须建 Capability Card**：自定义 subagent（无）、Workflow（无已验证等价物）、PostToolBatch（无）、config account pool / quota 信号（无 CLI 面）——都记 `event-unavailable` / `protocol-capability-gap`。
9. **AGENTS.md 现实约束**：kimi 读项目根 `AGENTS.md` 且 >32KB 告警；cc-master 本仓 AGENTS.md 94.7KB 会触发告警（性能/成本提示，非致命）——作 origin host 时值得留意。

## 13. 对 ccm worker driver 的关键落点

1. **headless 调用形态 [tested]**：`kimi -p "<prompt>" --output-format stream-json [-m <alias>] [--add-dir <dir>]`；exit 0 成功。**`-p` 单发自身即以非交互模式自动执行工具（含写文件），不要叠任何权限 flag**——`-y`/`--auto` 均与 `-p` **互斥**（`kimi -p '…' -y` → `Cannot combine --prompt with --yolo.` exit 1；`kimi -p '…' --auto` → `Cannot combine --prompt with --auto.` exit 1，均不产出文件）。若要收窄可执行的工具面，用 config `[permission.rules]` allowlist（可选的额外约束层，非启用工具执行的前提）。
2. **session/transcript 路径**：`session_index.jsonl`（home 级，`{sessionId,sessionDir,workDir}`）→ `sessions/<wd>/<sid>/agents/main/wire.jsonl` + `state.json`；或 `kimi export <sid>` 出 zip。stream-json 的 `session.resume_hint.session_id` 直接给 recon 键。
3. **退出码语义**：实测 exit 0 = 成功；错误/退出码全谱未穷举 [unresolved-minor]（provider/auth 失败退出码待补 probe）。
4. **可 recon 的 handle**：`session_<uuid>` 即 handle；`kimi -S <sid> -p "..."`（或 `-c`）续跑同 session，`kimi export <sid>` 拉 transcript——**满足 worker driver 的 spawn→poll(read wire.jsonl)→resume/attach 需求**。
5. **stream-json 解析**：按 OpenAI-message JSONL（`role` 分派：`assistant`/`tool`/`meta`），**不要**套 Claude Code 的 `{type:...}` 解析器。`tool_calls[].function.arguments` 是 JSON 字符串。
6. **model 选择**：`-m kimi-code/k3`（1M ctx，默认，effort max）/ `kimi-code/kimi-for-coding`(-highspeed)（256K）；provider 由 `managed:kimi-code` OAuth 提供，`kimi provider list` 可读。
7. **quota admission 无 CLI 信号**：worker driver 对 kimi 的配额准入只能 `unknown`/`unsupported`，不得伪造窗口；与 Cursor account pool、Codex 5h 退役同类诚实标注。
8. **候选更强 transport**：`kimi acp`（ACP over stdio）/ `kimi server`（JSON-RPC）是比 `-p` 更结构化的 worker 面，若要做 attach/journal/supervisor 级别控制，应优先 probe 这两个（本轮未深入）。

---

## 14. 10 个开放问题收敛表

| # | 问题 | 结论 | 证据 |
| --- | --- | --- | --- |
| 1 | `commands` 子目录是否多级命名空间 | 单级 `<plugin>:<command>` 确认；多级未验证 | [unresolved] |
| 2 | 是否存在插件外的用户/项目命令目录 | **不存在**——命令只来自 plugin manifest `commands[]` + skill `/skill:<name>`（binary `enabledCommands()` 只遍历 plugin records；无独立 commands 扫描） | [tested·binary] |
| 3 | `KIMI_PLUGIN_ROOT` 在 commands/skills 正文渲染是否可用 | **否**——它只是 hook/MCP 子进程 env（§5），`${KIMI_PLUGIN_ROOT}` 在正文不做文本替换（count=0） | [tested·binary + tested] |
| 4 | `${KIMI_SKILL_DIR}` 是 env 还是文本替换 | **文本替换**（`content.replaceAll`），另带 `${KIMI_SESSION_ID}` | [tested·binary] |
| 5 | 项目 `.kimi-code/local.toml` `[[hooks]]` 是否生效 | **不生效**——hook 只从全局 config.toml + plugin manifest 加载（实测对照：global+plugin 触发、local.toml 不触发） | [tested] |
| 6 | plugin hooks 与用户 hooks 合并规则 | **UNION**——同事件全局 config hook 与 plugin hook 都触发 | [tested] |
| 7 | Agent Swarm 与内置 subagent 关系 | 无自定义 subagent；内置 coder(默认)/explore/plan/general；`SubagentConfigSchema` 仅 timeout；Swarm = 内置角色多并行 | [tested·binary + docs] |
| 8 | plugin `mcpServers` 合并/清理 | plugin MCP runtime name `plugin-<id>:<server>`，注入 `KIMI_CODE_HOME`+`KIMI_PLUGIN_ROOT`；合并/卸载清理规则未实测 | [tested·binary]（清理 [unresolved]）|
| 9 | `interface`/marketplace 元数据完整 schema | `interface{displayName,shortDescription,longDescription,developerName,websiteURL}`；marketplace `{plugins:[{id,source,...}]}`；icon/category 等未穷举 | [docs] |
| 10 | plugin 升级/version pinning | installed.json 带 `version`(via manifest)/`updatedAt`/`originalSource`/`github`；本地 install 复制进 managed dir 替换；marketplace 版本比对（`plugin-marketplace.ts`）；pin 语义未实测 | [tested·binary]（pin [unresolved]）|

---

## Related

- 兼容矩阵：[`compatibility-matrix.md`](compatibility-matrix.md)
- Codex 事实（prompt-first / hook token 对照）：[`codex.md`](codex.md)
- Cursor 事实（Track A/B / Capability Card 范式）：[`cursor.md`](cursor.md)
- 目录纪律与资料源：[`README.md`](README.md)
- N-host 锁步 ADR：[`../../adrs/ADR-031-n-host-capability-parity.md`](../../adrs/ADR-031-n-host-capability-parity.md)
