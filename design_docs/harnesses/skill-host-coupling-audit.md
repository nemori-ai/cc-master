# Runtime Skill Host-Coupling Audit

更新时间：2026-07-10（保留 2026-07-03 baseline，新增 Cursor 已发布 adapter 增量）。

本盘点覆盖 `plugin/src/skills/*/canonical` 的 runtime skill 正文与 references。目标是找出写死 Claude Code harness 的指导，并给出后续 adapter 化时应抽出的模块 / 变量 / overlay 面。

## 分类标准

| 类别 | 含义 | 处理方式 |
| --- | --- | --- |
| `host-capability` | 语义可跨 host 复用，但具体工具 / 事件 / API 不同 | 抽成 host capability 表，由 adapter 注入工具名、可用性、降级链 |
| `path-token` | 正文依赖 `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_SKILL_DIR}` 等 Claude token | canonical 用中性 slot，adapter rewrite 成 host-native 路径 |
| `adapter-overlay` | 整段只对 Claude Code 成立 | 从 canonical 下沉到 `adapters/claude-code` overlay，Codex 提供另一段或标 unsupported |
| `domain-core` | master-orchestrator 方法论本身，不依赖 harness | 留在 canonical |
| `ccm-host-binding` | ccm 当前实现绑定 Claude config、statusline、凭证 / marketplace | 保留为当前 product fact，但新增 host adapter 前要拆成 ccm host backend |

## 总览（2026-07-03 baseline，现补齐八个分发 skill）

| Skill | Host coupling level | 主要原因 | 建议 |
| --- | --- | --- | --- |
| `authoring-workflows` | High | 整个 skill 是 Claude Code dynamic workflow API 手册 | 作为 Claude Code 专属 capability；canonical 只保留“何时需要确定性多 agent 编排”的抽象，API reference 下沉 overlay |
| `master-orchestrator-guide` | High | dispatch、watchdog、hook、commands、Codex 二审脚本、path token | 抽出 `background-dispatch`、`watchdog-wakeup`、`hook-feedback`、`second-reviewer`、`command-surface` capabilities |
| `using-ccm` | High | session env、Claude config home、statusline stdin、Claude OAuth/keychain、Claude marketplace | 将 ccm command catalog 拆出 host binding 章节；Codex adapter 前需要 `ccm host` backend 设计 |
| `pacing-and-estimation` | Medium | 5h/7d 订阅窗口、Claude model tiers、statusline sidecar | 抽出 quota-signal provider 和 model-tier provider |
| `slicing-goals-into-dags` | Low | 主要是 DAG 方法论 | 留 canonical；少量 “派 subagent” 用 executor capability 词汇替代 |
| `dev-as-ml-loop` | Low | 主要是执行侧 loop 方法论 | 留 canonical；若提到 subagent 仅作为 actor，改成 worker/leaf agent 抽象 |
| `engineering-with-craft` | Low | 工程方法论 | 留 canonical |
| `distilling-lessons-into-assets` | Low | 经验→资产路由方法论，本身不绑 host | 留 canonical；只由 command/dispatch adapter 解释宿主入口 |

> 本表的“分发 skill”指 A/B/D/E/F/G/H/I 八个方法论 / 操作 skill。
> `cc-master-as-master-orchestrator` / `cc-master-discuss` 等 command-entry shim skills 是 host
> command surface 兼容层，不计入这八个 portfolio 槽位。

## Cursor Adapter Delta（2026-07-10 当前态）

2026-07-03 baseline 里的“建议抽出 / Codex adapter 前”是历史设计输入，不再代表
Cursor 尚未实现。当前 tracked source 显示：

| Skill | Cursor strategy | 当前 host delta |
| --- | --- | --- |
| `master-orchestrator-guide` | `copy` + slots/overlays | Task/Shell dispatch、shell-floor watchdog、host-native commands、billing-period quota；排除 Claude account/handoff/codex-review 资产 |
| `authoring-workflows` | `unsupported_stub` | 无 Cursor Workflow API；明确降级到 Task / background Shell |
| `using-ccm` | `copy` + exclusions/slots | 排除 Claude account-pool reference；Cursor account switch 明确 unsupported |
| `pacing-and-estimation` | `copy` + overlays | 只读 dashboard `billing_period`；无 5h/7d / switch / statusline |
| `slicing-goals-into-dags` | `copy` + dispatch pointer | leaf execution 映射 Cursor Task/Shell，不假设 Workflow |
| `dev-as-ml-loop` | `copy` | host-neutral |
| `engineering-with-craft` | `copy` | host-neutral |
| `distilling-lessons-into-assets` | `copy` | host-neutral |

Cursor command surface 另行管理：六个 command strategy 均为 `host_native`，对应
`cc-master-*` shim skills 为 `unsupported_stub`，防止把 Claude namespace / skill invocation
误当 Cursor 入口。

当前剩余的真实 skill-level gap 是：`authoring-workflows` 无等价原语；Cursor
reinject 是 alwaysApply + preCompact 的 Track B 降级；配额无 account pool / 5h / 7d。
这些差异已在 strategy / overlays / Capability Cards 中显式表达，不是 `planned`
placeholder。

## Capability Surface 建议

新增 host adapter 前，至少定义这些 capability：

```yaml
host: claude-code
capabilities:
  background_dispatch:
    subagent:
      available: true
      launch: "Agent tool with run_in_background"
      handle_name: "agentId"
      completion_event: "task-notification"
    workflow:
      available: true
      launch: "Workflow tool"
      handle_name: "task ID"
      completion_event: "task-notification"
    shell:
      available: true
      launch: "Bash with run_in_background"
      handle_name: "shell handle"
  watchdog_wakeup:
    chain: ["CronCreate", "ScheduleWakeup", "Monitor", "background-shell until"]
  hooks:
    goal_guard: "Stop/verify-board"
    board_guard: "PreToolUse/board-guard"
    pacing: "Stop + PostToolBatch/usage-pacing"
  path_tokens:
    plugin_root: "${CLAUDE_PLUGIN_ROOT}"
    skill_dir: "${CLAUDE_SKILL_DIR}"
    plugin_data: "${CLAUDE_PLUGIN_DATA}"
  quota_signal:
    source: "Claude Code statusLine stdin -> ccm sidecar"
  account_switch:
    backend: "Claude Code OAuth credential stores"
```

Codex 的同表不能从 Claude Code 复制。当前已验证事实是：Codex project skills 在 `.agents/skills`，`SKILL.md` 无路径替换，Codex CLI 0.142.5 hook 环境没有 `CODEX_PLUGIN_ROOT`。

## 逐 Skill 盘点

### authoring-workflows

主要文件：

- `plugin/src/skills/authoring-workflows/canonical/SKILL.md`
- `plugin/src/skills/authoring-workflows/canonical/references/api-reference.md`
- `plugin/src/skills/authoring-workflows/canonical/references/mechanism.md`
- `plugin/src/skills/authoring-workflows/canonical/references/patterns.md`
- `plugin/src/skills/authoring-workflows/canonical/assets/examples/*.js`
- `plugin/src/skills/authoring-workflows/canonical/assets/templates/*.js`

Claude Code 专有点：

- `Workflow` 工具、`agent()` / `parallel()` / `pipeline()` / `phase()` / `log()` / `workflow()` API。
- workflow 后台执行返回 task ID，并通过 `<task-notification>` 唤醒主线。
- workflow resume、determinism 禁令、并发上限、脚本大小、budget 等契约。
- examples/templates 全部是 Claude Code dynamic workflow JS。

建议：

- 不要把这套 API 放进跨 host canonical 教程。
- 将 `authoring-workflows` 在多 host 语义上拆为两层：
  - host-neutral：什么时候需要 deterministic multi-agent orchestration、parallel-vs-pipeline 的抽象判断。
  - Claude Code overlay：具体 Workflow API、JS runtime、examples/templates。
- Codex adapter 若没有等价 workflow runtime，应把该 skill 标为 unsupported 或改写为 Codex 可用的 orchestration pattern，而不是保留 Claude Code API。

### master-orchestrator-guide

主要文件：

- `plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md`
- `references/dispatch.md`
- `references/async-hitl.md`
- `references/resume-verify.md`
- `references/cost-decisions.md`
- `references/board.md`
- `references/handoff.md`

Claude Code 专有点：

- 后台派发机制写死为 sub-agent `run_in_background`、Workflow 工具、Bash 后台 shell。
- 完成通知写死为 `<task-notification>`。
- watchdog 降级链写死 `CronCreate` / `ScheduleWakeup` / `Monitor` / background shell。
- hook 行为写死 Stop hook / goal-hook / board-guard / usage-pacing 等 Claude Code hook model。
- command surface 写死 `/cc-master:*` slash command。
- 第二验收者脚本写死 `${CLAUDE_SKILL_DIR}/scripts/codex-review.sh`，并假设当前 host 能从 skill dir 执行随 skill 分发脚本。
- 多处跨 skill 引用写死 `${CLAUDE_PLUGIN_ROOT}/skills/...`。

建议：

- 保留 canonical 的角色纪律、DAG、HITL、端点验收、配速决策这些 `domain-core`。
- 将以下段落抽成 host capability slot：
  - `{{BACKGROUND_DISPATCH_MECHANISMS}}`
  - `{{COMPLETION_NOTIFICATION_CONTRACT}}`
  - `{{WATCHDOG_WAKEUP_CHAIN}}`
  - `{{HOOK_FEEDBACK_CONTRACT}}`
  - `{{COMMAND_SURFACE}}`
  - `{{SECOND_REVIEWER_COMMAND}}`
  - `{{DISTRIBUTED_RESOURCE_PATHS}}`
- Claude Code adapter 将 slot 展开为当前文字；Codex adapter 只能在实测后填入等价机制。
- 对 `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_SKILL_DIR}` 改成中性 resource references，由 adapter rewrite。

### using-ccm

主要文件：

- `plugin/src/skills/using-ccm/canonical/SKILL.md`
- `references/command-catalog.md`
- `references/board-model-guide.md`
- `references/account-pool.md`

Claude Code / ccm host binding：

- global flag `--session-id` 默认读 `$CLAUDE_CODE_SESSION_ID`。
- `--home` 默认链含 `CLAUDE_PROJECT_DIR`。
- usage 信号来自 Claude Code status line stdin，经 `ccm statusline` 落 sidecar。
- statusline install 写 Claude Code 全局 `settings.json`，并提到 `${CLAUDE_PLUGIN_ROOT}` 在 `statusLine.command` 里不展开。
- account pool 直接绑定 Claude Code OAuth credential stores：macOS keychain `Claude Code-credentials`、`.claude.json`、`.credentials.json`、`claudeAiOauth`、`claude setup-token`、`claude login`。
- upgrade plugin shell out `claude plugin marketplace update` / `claude plugin update`。
- board executor 解释使用 `subagent` / `workflow`，但这部分可以视为 cc-master board enum，需要 host capability 解释其真实实现。

建议：

- `board` 命令与字段语义大多可留 canonical。
- 将 command catalog 拆出 host-bound namespaces：
  - `statusline`
  - `account`
  - `upgrade plugin`
  - env discovery defaults
- ccm 引擎需要 host backend 概念，例如 `ccm host claude-code` / `ccm host codex`，由 backend 提供：
  - session id env name
  - config dir
  - quota signal provider
  - credential vault / switch implementation
  - plugin upgrade command
- Codex adapter 没有等价订阅 5h/7d/statusline 信号前，usage/account 相关内容应降级为 unsupported / unavailable，而不是继续写 Claude Code 机制。

### pacing-and-estimation

主要文件：

- `plugin/src/skills/pacing-and-estimation/canonical/SKILL.md`
- `references/usage-signals.md`
- `references/model-tiers.md`
- `references/pacing-levers.md`

Host coupling：

- `usage-signals.md` 的 5h/7d 订阅窗口和 statusline sidecar 是 Claude Code / Claude subscription 口径。
- `model-tiers.md` 是 Claude model tier mapping。
- 主线固定模型的理由提到 Claude Code prompt cache 和 subagent 模型选择。
- pacing lever `switch` 依赖 Claude account pool。

建议：

- 抽出两个 provider：
  - `quota_signal_provider`：Claude Code = statusline sidecar；Codex = 待调研。
  - `model_tier_provider`：Claude Code = Anthropic Claude tiers；Codex = OpenAI model tier mapping。
- canonical 保留“按容量走廊配速、临界链用强模型、float 用廉价模型”的方法论。
- 所有具体 model ID / price / 5h/7d 阈值 / account-switch lever 进入 host overlay 或 provider docs。

### slicing-goals-into-dags

主要文件：

- `plugin/src/skills/slicing-goals-into-dags/canonical/SKILL.md`
- `references/worked-example.md`

Host coupling：

- 基本无。若出现 `subagent`，通常是 executor 角色而非 Claude Code API。

建议：

- 留 canonical。
- 若下一阶段要更纯，术语可改为 `leaf worker`，再由 adapter 映射到 Claude Code sub-agent / Codex equivalent。

### dev-as-ml-loop

主要文件：

- `plugin/src/skills/dev-as-ml-loop/canonical/SKILL.md`

Host coupling：

- 基本无。它教执行侧迭代收敛，不绑定工具。

建议：

- 留 canonical。
- 派发 prompt 中若要提示 executor 使用该 skill，由 adapter 决定 host 是否支持 skill invocation。

### engineering-with-craft

主要文件：

- `plugin/src/skills/engineering-with-craft/canonical/SKILL.md`
- `references/ddd.md`
- `references/oop.md`
- `references/sdd.md`
- `references/tdd.md`

Host coupling：

- 基本无。工程方法论可跨 host。

建议：

- 留 canonical。

## 优先级

1. **先拆 `authoring-workflows`**：它是最强 Claude Code API 绑定，不适合作为多 host canonical 原样分发。
2. **再拆 `master-orchestrator-guide` 的 dispatch / watchdog / hook / command surface**：这些是 master-orchestrator 行为的核心，不拆会让 Codex adapter 继承错误工具。
3. **同步拆 `using-ccm` 的 statusline/account/upgrade host backend**：否则 ccm 在 Codex host 下会把 Claude credential 和 config 假设带过去。
4. **最后拆 `pacing-and-estimation` providers**：在 Codex 没有明确 quota/model tier provider 前，先标 unsupported 比硬套 Claude 机制更诚实。

## Subagent Follow-up Audit — 2026-07-03

只读 subagent 盘点补充了更细的复核项。以下不是已验证 failure，而是下一轮 skill/projection cleanup 要逐项 grep 和确认的锚点：

- `authoring-workflows`：canonical 与 references 仍以 Claude Code `Workflow` API 为中心；Codex 当前保持 unsupported stub 是正确的，但长期要把 host-neutral “何时需要确定性多 agent 编排”与 Claude Workflow API 手册拆开。
- `using-ccm`：重点复核 `references/command-catalog.md` 和 `references/account-pool.md` 是否仍把 `$CLAUDE_CODE_SESSION_ID`、`CLAUDE_CONFIG_DIR`、Claude Code statusline、Claude OAuth/keychain、`claude plugin update` 等内容投进 Codex dist。portable board 命令可共享；`account` / `statusline` / `upgrade plugin` 必须走 host backend overlay。
- `pacing-and-estimation`：重点复核 `references/usage-signals.md`、`model-tiers.md`、`pacing-levers.md`。Claude subscription 5h/7d sidecar、Anthropic model tiers、account switch lever 都应是 provider overlay；Codex dist 只能保留已验证的 Codex usage source 和模型/配额边界。
- `slicing-goals-into-dags`：若正文出现 `subagent`，优先改成 `leaf worker` / `executor` 这种 host-neutral 词，再由 adapter 映射到 host primitive。
- `dev-as-ml-loop` 与 `engineering-with-craft`：未发现需要拆的 host-dependent 点，保持 canonical。

新增 adapter cleanup 时，先跑：

```bash
rg -n 'CLAUDE|Claude Code|Workflow|task-notification|statusLine|claude plugin|claudeAiOauth|CronCreate|ScheduleWakeup|sub-agent|subagent' plugin/dist/codex/skills
```

命中不一定都违规；但每一处都必须属于以下之一：Codex stub 明确说明 unsupported、host-neutral 反例、或 Codex overlay 中已经解释了替代边界。否则就是 Claude 机制泄漏到 Codex runtime prompt。

## Projection 落地建议

下一阶段可以先扩展 SAP strategy，而不急着发明复杂 template engine：

```yaml
projection:
  source: canonical/
  target: skills/master-orchestrator-guide/
  copy: true
rewrites:
  path_tokens:
    "{{PLUGIN_ROOT}}": "${CLAUDE_PLUGIN_ROOT}"
    "{{SKILL_DIR}}": "${CLAUDE_SKILL_DIR}"
overlays:
  - source: adapters/claude-code/overlays/dispatch-capabilities.md
    target: references/dispatch-capabilities.md
patches:
  - file: references/dispatch.md
    replace:
      "{{BACKGROUND_DISPATCH_MECHANISMS}}": "@references/dispatch-capabilities.md"
unsupported: []
```

Codex strategy 可以先显式列 `unsupported`，比 no-op copy 更安全：

```yaml
unsupported:
  - capability: dynamic_workflow
    reason: "No verified Codex equivalent of Claude Code Workflow tool yet."
  - capability: plugin_root_path_token
    reason: "Codex CLI 0.142.5 does not expand CODEX_PLUGIN_ROOT."
```
