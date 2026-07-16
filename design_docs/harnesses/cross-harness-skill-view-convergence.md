# Cross-harness runtime skill 统一视角与 adapter 收敛方案

> 状态：分析与迁移设计；本文件不宣称迁移已经完成  
> 日期：2026-07-16 UTC  
> 范围：`plugin/src/skills` 的 canonical slot、per-host overlay、stub 与 projection contract  
> 非范围：本轮不批量删除 slot/overlay，不改 ccm wire schema，不把 origin 不存在的原生工具伪装成可用

## 1. 问题与结论

早期 adapter 以“orchestrator 只调当前 harness 的 worker”为前提，因此把模型目录、配额窗口、worker
机制、dispatch 判断和命令入口一起按 **origin harness** 投影。cross-harness worker pool 成立后，这种
切法不再正确：运行在 Codex 的 master 也需要看见 Claude Code、Cursor Agent CLI 和 Codex 的候选事实；
运行在 Cursor 的 master 也不能只拿 Cursor 的模型与账期说明做全局选择。

但这不推出“所有 adapter slot 都删除”。需要分开两类事实：

| 类型 | 例子 | 统一后归宿 |
| --- | --- | --- |
| **selected-target / 全机资源事实** | 安装 surface、真实 agent help、模型能力/成本、认证、配额、payer/pool、admission、route/fallback | 所有 origin 共享；动态事实由 ccm 生产，canonical skill 教同一解释方法 |
| **origin-runtime 机制事实** | 当前主会话怎样 spawn native subagent、拿什么 handle、完成事件、watchdog、hook envelope、命令入口、路径 token | 继续 host-specific；只在真正执行 origin-native 动作时读取 |

因此目标不是“zero adapter”，而是：

1. **去除用 origin 隔离 target 决策信息的 slot/overlay**；
2. **把剩余 adapter 压缩成少量 origin-runtime capability references**；
3. **模型、配额和 provider CLI 易变事实不复制进三份 skill prose**，而由 ccm 的 inventory/facts/usage/quota
   输出在运行时提供；
4. 同一 task、同一 machine revision、同一 target descriptor 在三个 origin 中，target facts、freshness、
   qualification predicate/result 必须一致；origin-native availability、context/integration cost 可以产生
   **确定、带 reason code、可复算**的 route 差异，不能产生未经解释的 origin 偏好。

一句话边界：**origin 决定“我此刻用什么本地机制发起和接回”；selected target 决定“该选谁、能否选、
用什么模型和容量”。**

## 2. 当前基线

以 2026-07-16 tracked source 计：

| 项 | 数量 | 说明 |
| --- | ---: | --- |
| canonical slot token occurrence | 100 | 对 canonical 下所有 `.md`/`.json` 逐次计数 |
| per-skill unique slot 之和 | 92 | `master-orchestrator-guide=35`、`using-ccm=50`、`pacing-and-estimation=6`、`slicing-goals-into-dags=1` |
| global unique slot | 91 | `CROSS_HARNESS_TARGET_FACTS_POINTER` 被两个 skill 共用 |
| hand-written overlay 文件 | 273 | `master-orchestrator-guide` 105、`using-ccm` 150、`pacing-and-estimation` 15、`slicing-goals-into-dags` 3 |
| `unsupported_stub` payload | 14 | 2 个 workflow stub + 6 个 command-entry shim 在 Claude/Cursor 的 12 个 stub |
| `partial/SKILL.md` | 0 | 当前没有 partial fork，这是应保持的好边界 |

复现 slot 三个口径：

```bash
node - <<'NODE'
const fs = require('fs');
const path = require('path');
const root = 'plugin/src/skills';
let occurrences = 0;
let perSkillUniqueSum = 0;
const global = new Set();
for (const skill of fs.readdirSync(root).sort()) {
  const canonical = path.join(root, skill, 'canonical');
  if (!fs.existsSync(canonical)) continue;
  const perSkill = new Set();
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(md|json)$/.test(file)) {
        for (const hit of fs.readFileSync(file, 'utf8').matchAll(/\{\{[A-Z0-9_]+\}\}/g)) {
          occurrences += 1;
          perSkill.add(hit[0]);
          global.add(hit[0]);
        }
      }
    }
  })(canonical);
  perSkillUniqueSum += perSkill.size;
}
console.log({ occurrences, perSkillUniqueSum, globalUnique: global.size });
NODE
```

预期输出为 `{ occurrences: 100, perSkillUniqueSum: 92, globalUnique: 91 }`。overlay/stub 基线可由
`find plugin/src/skills -path '*/adapters/*/overlays/*.md' | wc -l` 与
`find plugin/src/skills -path '*/adapters/*/stub/SKILL.md' | wc -l` 复现。

四个有 slot 的分发 skill：

| Skill | canonical slot | 每 host overlay | 当前问题 |
| --- | ---: | ---: | --- |
| `master-orchestrator-guide` | 35 | 35 | target 选择、provider 配速与 origin-native 工具混在同一层；大量完整段落三份维护 |
| `using-ccm` | 50 | 50 | 同一个全局 CLI 被写成三份 origin 手册；board/exit/upgrade 等共同语义也被 slot 化 |
| `pacing-and-estimation` | 6 | 5 + 1 个 registry-rendered block | 只给当前 origin 的模型/窗口，不能支撑全机 worker portfolio |
| `slicing-goals-into-dags` | 1 | 1 | 一句 dispatch pointer 被 origin 化，没有业务必要 |

另有三类没有 slot 的 skill：

- `dev-as-ml-loop`、`engineering-with-craft`、`distilling-lessons-into-assets` 已是 host-neutral copy，保持。
- `authoring-workflows` 在 Claude Code 是 Workflow API 手册，在 Codex/Cursor 是 honest
  `unsupported_stub`；cross-harness worker 不会让当前 origin 凭空获得另一个 host 的 in-process Workflow
  工具，stub 暂时保留。
- `cc-master-as-master-orchestrator`、`cc-master-discuss`、`cc-master-distill`、
  `cc-master-handoff-to-new-session`、`cc-master-retro`、`cc-master-stop` 是 command-entry shim skills；
  Claude/Cursor 有 host-native command surface，故对应 shim stub 是入口适配，不是信息隔离，也应保留。

## 3. 运行时统一查询路径

canonical skill 不应维护第二份 provider CLI、model catalog 或配额快照。所有 origin 统一教以下热路径：

### 3.1 四个 ID namespace

名字相似不代表可以互换。skill 与 command catalog 必须标出参数属于下列哪个 namespace：

| Namespace | 当前值域 / 来源 | 语义 |
| --- | --- | --- |
| `origin-harness` | `claude-code \| codex \| cursor` | master 当前运行并接收 hook/command/native tool 的 harness family |
| `worker-harness` | `claude-code \| codex \| cursor-agent` | `ccm worker` raw wrapper 的 executable descriptor；这里只把 Cursor headless CLI 叫 `cursor-agent` |
| `provider-id` | `claude-code \| codex \| cursor` | model/quota/evidence provider family；Cursor IDE 与 Agent CLI 共享 provider family 不代表 surface facts 可互补 |
| `surface-id` | 由具体 schema 输出并携带 schema/provenance | 精确 execution surface；不能只凭品牌名推导 |

Cursor 的承重映射固定为：

```text
origin-harness=cursor
  -> provider-id=cursor
  -> native surface-id=cursor-ide-plugin

worker-harness=cursor-agent
  -> provider-id=cursor
  -> headless surface-id=cursor-agent-cli
```

`cursor` 不是 `ccm worker --harness` 的合法值，`cursor-agent` 也不是 origin-harness/provider-id。
machine/shadow contract 的 canonical surface 是 `cursor-ide-plugin` / `cursor-agent-cli`；当前 provider facts
registry 的 `supported_surfaces` 仍可能出现 `cursor-ide` 这个 registry-local label。后者在 schema 明确归一化前
不得被字符串猜测成 `cursor-ide-plugin`。同理，`claude-code-cli` / `codex-cli` 是 provider facts 里的
surface label；消费者必须连同 schema 读取，不能把任意 `harness` 字段当 `surface-id`。

board `routing.policy.candidates[].harness` 当前保存 provider/harness family（Cursor 写 `cursor`），
`candidate.surface` 当前只是 `host-native | cli-headless` 类别，不是精确 `surface-id`；`ccm worker` 的
`worker-harness=cursor-agent` 不直接写进这两个字段。精确 surface 必须由 candidate/evidence 的 schema-bound
引用保留，直到 routing contract 正式增加明确的 `surface_id` 字段，不能在 skill prose 中自行改 schema。

### 3.2 命令与 namespace

`--harness` 这个拼法在现有 CLI 中被复用，不能因此把值域也混成一个：

| 决策动作 | canonical 命令入口 | 接受/输出的 namespace | 诚实边界 |
| --- | --- | --- | --- |
| 看全机候选与 surface | `ccm harness list --machine-wide --json` | 无 ID 输入；输出 family 与 schema-bound `surface-id` | 读取 `surfaceInventory.surfaces[].surface_id`；不要把 legacy `surfaces[].id` 当 canonical surface |
| 看目标 CLI 的真实 agent help | `ccm worker help --harness <worker-harness> [--scope agent\|root]` | `worker-harness` | 原样返回 resolver 选中 CLI 的 help；skill 不复制易变 flags |
| 看 provider 模型事实 | `ccm provider facts <provider-id> --json` | `provider-id`；输出 schema-bound surface labels | 静态、有来源/有效期；不等于 live entitlement 或 exact-model admission |
| 看某 provider 当前用量 | `ccm usage show --harness <provider-id> --accounts current --json` | 当前 global flag 在此 command 上按 `provider-id` 解读 | `available:false` 是正常结果；Cursor 必须传 `cursor`，不是 `cursor-agent` |
| 看 quota authority store | `ccm quota status --json`；dispatch 前 `ccm quota preflight --input @file --json` | 无直接 ID flag；input refs 内的 `provider-id`/`surface-id` 必须同 target | store 可读不等于 headroom ample |
| 看三 origin 共用的 bounded cache | `ccm orchestrator context --cached-only --agent-visible ... --harness <origin-harness> --json` | `origin-harness` | shadow-only、零 probe；缺失/过期保持 unknown，不授权 dispatch |
| 做 shadow route 比较 | `ccm route advise ... --origin <origin-harness> --json` | `origin-harness`；候选保留 provider family/surface evidence | `spawned:false`；origin-relative native availability/cost 可导致有理由的差异 |
| 显式运行 CLI worker | `ccm worker run --harness <worker-harness> --cwd <absolute-workdir> -- <provider-argv...>` | `worker-harness` | 同步 child wrapper；透传的 provider argv 只从真实 help 得到 |
| 将 selection/attempt 绑定 task | `ccm task route-bind <task-id> --selection @... --attempt @...` | CLI 无 harness flag；JSON 按 routing contract 字段，不接受 worker-harness 替代 schema 字段 | 原子 projection，不 spawn；handle 只是 C1 opaque syntactic claim |

当前仍没有一条命令能诚实回答“每个 surface 的精确剩余额度”。例如 Cursor Agent CLI 可安装且已认证，
但没有公开 quota authority 时必须保持 `quota:unknown`；不能拿 Cursor IDE aggregate billing period 补它。
收敛 skill 时要把这个缺口写成 unknown，而不是为了消 slot 发明统一百分比。

### 3.3 dispatch → reconcile 最小闭环

`ccm worker run` **不是后台调度器**。它同步监管一个 session-bound provider child，直到 exited、timeout、
cancelled、failed 或 rejected，再返回 `ccm/worker-process-result/v1`（包在标准 ccm JSON envelope 内）。因此
master 要保持并行时，必须用当前 origin 的真实后台 primitive 去运行这条同步命令：Claude Code background
shell、Codex background terminal、Cursor background Shell 等。该 origin primitive 返回的 agent/session/shell
id 才是 parent 可 recon 的 accountable handle；worker terminal envelope 不是启动时 handle。

对启用了 `ccm/task-planning/v1 + ccm/agent-routing/v1` 的 `executor=subagent` task，顺序固定：

1. task 仍为 `ready`；先写完整 planning 与 routing policy，并完成 model/quota/permission qualification；
2. 调 origin-native 后台 primitive 运行 `ccm worker run ...`，拿到真实外层 handle；调用本身失败则不得
   把 task 记作在飞；
3. 用 selection + `state:"running"` attempt + 该真实 handle 调 `ccm task route-bind`。它原子写
   `routing.selected`、append attempt snapshot、投影 `task.handle` 并转 `in_flight`；contract-enabled task
   不得绕回普通 `task start`。当前 C1 writer 只校验 nonblank opaque claim，**不证明 handle live**；recon
   仍须查 origin runtime 地面真相；
4. origin handle terminal 后，读取并校验完整 worker envelope。`state:"exited" + exit_code:0` 只证明
   provider process terminal，不证明 task acceptance；timeout/cancel/failure 也不得直接伪装成 task 终态；
5. parent 在目标端点独立验 artifact、diff、tests 与 task acceptance。通过后才执行
   `ccm task done <task-id> --artifact <artifact-path-or-url> --verified`；未通过则保持非 done，记录证据并按状态机
   uncertain/failed/retry/replan。当前 raw-worker C1 没有 durable supervisor 或完整 attempt-terminal writer，
   skill 不能把 route-bind 的 running snapshot 宣称为完整生命周期账本。

host-native worker 走它自己的 native-attempt dedicated writer；不得把 raw wrapper 的 `route-bind` 当成
native invoke/bind 的替代品。

## 4. `master-orchestrator-guide` slot inventory

处置码：`U` = 上收 canonical；`S` = 拆出共享不变式，slot 只留 origin 机制；`K` = 保留
host-specific；`R` = 改成各 host 都可用的相对/逻辑指针后删 slot；`D` = 依赖相邻合同后再删。

| Slot | 处置 | 理由与目标落点 |
| --- | --- | --- |
| `BACKGROUND_DISPATCH_SUMMARY` | U | “全机 worker pool、origin 只是候选之一”是共同身份；写回 canonical `SKILL.md` |
| `BACKGROUND_DISPATCH_LENS` | S | 先选 target 的判断上收；master 只读 origin capability summary，具体 native primitive 单向下钻 `using-ccm` 操作视图 |
| `DISPATCH_REFERENCE_SUMMARY` | U | reference 的职责在三 origin 相同；写回 canonical reference 表 |
| `BACKGROUND_DISPATCH_MECHANISM_LIST` | K | Agent/spawn-agent/Task、shell handle、Workflow 可用性确实由 origin 决定 |
| `BACKGROUND_DISPATCH_EXECUTOR_MAPPING` | S | executor 与 target harness 的共同语义上收；native handle 映射留 origin reference |
| `BACKGROUND_DISPATCH_MECHANISMS` | S | “必须真实 handle、无 handle 不 in-flight”上收；工具名/完成事件留 origin reference |
| `BACKGROUND_EXTERNAL_WAIT_GUIDANCE` | S | “不在前台 busy-poll、等待必须有 predicate/timeout/handle/recon”上收；background terminal、AwaitShell、task-notification 与 scheduler 留 origin reference |
| `DATAFLOW_MICRO_SCALE_GUIDANCE` | S | 两尺度 dataflow、何时 fan-out/pipeline 的纪律上收；Claude Workflow 语法与 Codex/Cursor 替代工具留 origin reference |
| `EXECUTOR_VALUE_GUIDANCE` | S | board executor 领域语义和 cross-harness routing 上收；native 映射留 origin reference |
| `ASYNC_COMPLETION_INTEGRATION` | S | reconcile 三步共同；完成事件、poll/notification 方式留 origin reference |
| `WATCHDOG_WAKEUP_TOOL_CHAIN` | K | origin wakeup primitives 是真实负能力边界 |
| `WATCHDOG_WAKEUP_TOOL_CHAIN_INLINE` | K | 与上一项合并为同一 origin reference，删除重复的第二个 prose payload |
| `WATCHDOG_RETIRE_SCHEDULER_GUIDANCE` | K | 退役真实 scheduler 的命令依赖 origin mechanism |
| `PACING_COST_RESPONSIBILITY` | U | master 管全机资源组合，不只管当前 origin；写回 canonical 职责段 |
| `PACING_BUDGET_STEWARDSHIP` | U | 配额充足/紧张下的 WIP/档位原则对所有 origin 相同 |
| `CAPACITY_ACCOUNT_GUIDANCE` | U | 改成 selected-target/provider portfolio：Claude 可有 account pool，Codex/Cursor 禁自动换号 |
| `PACING_COMMAND_SUMMARY` | U | 统一指向 `ccm usage ... --harness <provider-id>` 与 portfolio context，不按 origin 投影 |
| `MASTER_HOST_MODEL_ALLOCATION` | U | “current host candidate set”改为“selected target candidate set”；动态 facts 来自 ccm |
| `HOST_QUOTA_DESERTION_EXAMPLE` | U | 抗合理化规则应覆盖任一 target quota，不应只显示 origin 窗口 |
| `HOST_QUOTA_RATIONALIZATION_ROW` | U | 同上；按 provider capability/freshness 判断 |
| `HOST_QUOTA_RED_FLAG` | U | 同上；unknown/stale 不能跨 target 拼接 |
| `HOST_QUOTA_DECISION_GATE` | U | gate 读取 selected-target authority；不再按 origin 生成三套判断 |
| `HOST_QUOTA_JUDGMENT_ROW` | U | 用户拍板边界是全局容量决策，不随 origin 改变 |
| `AUTHORING_WORKFLOWS_ROW` | K | 当前 origin 是否有 Workflow API 是真实能力差异 |
| `COST_DECISIONS_REFERENCE_ROW` | S | 通用容量动作上收；Claude account-pool 细节改为 target capability drilldown |
| `COMMAND_SURFACE_GUIDANCE` | K | `/cc-master:*`、`$cc-master-*`、Cursor slash command 入口不同 |
| `CCM_COMMAND_CATALOG_POINTER` | R | dist 内结构同构时统一用相对链接；先过三 host link/projection test |
| `USING_CCM_BOARD_MODEL_POINTER` | R | 同上；board 模型本身不随 origin 变化 |
| `DECISION_PACKAGE_CONSUMPTION` | S | package 协议与质量上收；用户如何进入 discuss 留 command-entry reference |
| `DISCUSS_SESSION_GUIDANCE` | K | 同 session/新 session、slash/skill invocation 不同 |
| `PLATFORM_RESUME_GUIDANCE` | K | resume/session substrate 与可附着 handle 不同 |
| `HETEROGENEOUS_REVIEW_MECHANISM` | S | “独立、异构 reviewer 的选择政策与端点验收责任”上收；实际 reviewer 调用、脚本路径与当前工具留 origin reference |
| `HANDOFF_REFERENCE_ROW` | S | cross-harness continuity/handoff 共同语义上收；host-native 入口与 resume 机制留 origin reference |
| `CROSS_HARNESS_WORKER_HELP_POINTER` | R | `ccm worker help` 对所有 origin 是同一 CLI；直接链接 `using-ccm` catalog |
| `CROSS_HARNESS_TARGET_FACTS_POINTER` | R | 三 origin 读取同一 `cross-harness-target-facts.md`；不再按 origin 生成路径正文 |

预期结果：35 个 inline slot 不再一对一对应 105 个手写段落；共同判断写回 canonical。master 只保留一份
由 host capability 生成的薄 decision summary，完整 native dispatch/completion/watchdog/entry/resume/path
操作机制只在 `using-ccm` 出现一次，不为每个句子再建 slot。

## 5. `using-ccm` slot inventory

`ccm` 是全局 CLI，同一个 origin agent 能用 `ccm usage ... --harness <provider-id>` 查询另一个 provider。
`--harness` 在别的 command 上必须服从该 command 的 namespace 表，不能沿用这个值域。因而 command catalog
的默认组织轴应是 **namespace + explicit target**，不是“我现在运行在哪个 origin”。

| Slot | 处置 | 理由与目标落点 |
| --- | --- | --- |
| `USING_CCM_DESCRIPTION` | U | 改成“任意 supported origin 使用全局 ccm”；不再把触发条件绑 Codex/Cursor/Claude |
| `USING_CCM_BOUNDARY` | U | board/worker/provider/quota 操作面共同；provider capability 由显式 target 决定 |
| `USING_CCM_POINTERS_HOST` | S | common references 上收；仅 command-entry/path 放 origin reference |
| `USING_CCM_BOARD_ARCHIVE_BEHAVIOR` | U | 带锁、非破坏、幂等语义来自 engine，与 origin 无关 |
| `USING_CCM_BOARD_GUARD_GUIDANCE` | S | “禁止手改 board”上收；具体 hook event/deny envelope 留 origin reference |
| `USING_CCM_TASK_ADD_EXAMPLE` | U | 用 `<real-worker-handle>` 的通用例子；provider-specific handle 由 origin reference 举例 |
| `USING_CCM_SESSION_ID_FLAG` | U | 统一写“host adapter 注入，缺失按发现降级”；env 名不进共同 command contract |
| `USING_CCM_EXIT_CODES` | U | exit code 是 ccm 合同，不应因 origin 改写 |
| `USING_CCM_EXECUTOR_TABLE_ROWS` | S | executor 领域语义与 target routing 上收；native tool/handle 示例留 origin reference |
| `USING_CCM_EXECUTOR_DECISION_TAIL` | S | “先派发拿 handle 再 in-flight”上收；如何 spawn 留 origin reference |
| `USING_CCM_OBSERVABILITY_SOURCE` | K | native result/notification/terminal telemetry 由 origin 决定 |
| `USING_CCM_DECISION_PACKAGE_ENTRYPOINT` | S | package 协议上收；slash/skill/thread 入口留 origin reference |
| `USING_CCM_ENTER_CMD_EXAMPLE` | K | `/discuss`、`$cc-master-discuss`、`/cc-master:discuss` 不同 |
| `USING_CCM_JC_HOOK_GUIDANCE` | K | hook 能否及何时把 judgment 注回前台由 origin 决定 |
| `USING_CCM_COORDINATION_QUOTA_MODEL_EXAMPLE` | U | canonical 同时给 target provider 的合法 quota model；不按 origin 只展示一个 |
| `CROSS_HARNESS_TARGET_FACTS_POINTER` | R | 统一相对链接/逻辑 skill pointer |
| `USING_CCM_ACCOUNT_NAMESPACE_ROW` | D | 从 origin 可用性改成 target capability matrix；需锁定 `account --harness` 的 target/policy 语义 |
| `USING_CCM_ACCOUNT_NAMESPACE` | D | Claude backend 可由任意 origin 看见，但 Codex/Cursor 自动换号永久禁止；不能继续按 origin 隐藏 |
| `USING_CCM_BOARD_POLICY_GUIDANCE` | D | policy 作用于明确 target capability，stored allow 不能给禁用 provider 创造能力 |
| `USING_CCM_POLICY_DENY_EXIT_ROW` | U | exit 7 的合同共同；例子列 target capability，而非按 origin 删除分支 |
| `USING_CCM_POLICY_NAMESPACE_ROW` | D | 同 account target-scope 依赖 |
| `USING_CCM_POLICY_NAMESPACE` | D | 同 account target-scope 依赖 |
| `USING_CCM_POLICY_JSON_EXAMPLE` | D | 统一展示 capability + effective policy；禁止 ambient-origin 推断 |
| `USING_CCM_FMT_POLICY_ROW` | U | lint 规则来自 engine；修复建议应描述 target/effective 而非 origin |
| `USING_CCM_STATUSLINE_NAMESPACE_ROW` | U | canonical capability matrix：Claude target 支持，Codex/Cursor 不支持；所有 origin 都看见 |
| `USING_CCM_STATUSLINE_NAMESPACE` | U | statusline 是 quota producer backend，不是 origin agent 的视野边界；写目标 harness 保护 |
| `USING_CCM_UPGRADE_NAMESPACE` | U | `ccm upgrade plugin` 默认枚举所有已安装 supported harness，本来就是 machine-wide |
| `USING_CCM_UPGRADE_PLUGIN_BEHAVIOR` | U | 统一说明 adapter dispatch；各 provider 的 shell-out 细节留 ccm backend/docs |
| `USING_CCM_USAGE_NAMESPACE_ROW` | U | 改成全机 provider portfolio 入口 |
| `USING_CCM_USAGE_OVERVIEW` | U | `--harness <provider-id>` + `available:false` 共同解释 |
| `USING_CCM_USAGE_SIGNAL_SOURCE` | U | 在 canonical target capability 表列各 provider source；不根据 origin 只给一行 |
| `USING_CCM_USAGE_SHOW_BEHAVIOR` | U | command 相同；输出按 target quota model 分支 |
| `USING_CCM_USAGE_SHOW_SCOPE_FLAGS` | U | `--accounts`/`effective-n` 的合法性由 target capability 解释 |
| `USING_CCM_USAGE_SHOW_JSON_EXAMPLE` | U | 用 provider-discriminated 示例或读取真实 `--json`，不投影三份 catalog |
| `USING_CCM_USAGE_ADVISE_BEHAVIOR` | U | verdict 枚举按 target provider capability，不按 origin |
| `USING_CCM_USAGE_ADVISE_SCOPE_FLAG` | U | 同上 |
| `USING_CCM_USAGE_ADVISE_EXAMPLE` | U | 同上；示例必须携带 harness/source/quota model |
| `USING_CCM_USAGE_BURN_RATE_BEHAVIOR` | U | 共同算法 + provider window table；unknown 不补齐 |
| `USING_CCM_USAGE_BURN_RATE_JSON_EXAMPLE` | U | provider-discriminated canonical example |
| `USING_CCM_USAGE_RUNWAY_BEHAVIOR` | U | 共同 runway 语义 + target window |
| `USING_CCM_USAGE_RUNWAY_JSON_EXAMPLE` | U | provider-discriminated canonical example |
| `USING_CCM_WATCHDOG_PROBLEM` | U | liveness contract 共同；不要把 watchdog 等同某个工具 |
| `USING_CCM_WATCHDOG_HOOK_REMINDER` | K | reminder event/envelope 是 origin hook 机制 |
| `USING_CCM_WATCHDOG_MECHANISM_ROWS` | K | Cron/automation/Shell/terminal 的真实可用性不同 |
| `USING_CCM_WATCHDOG_SHELL_GUIDANCE` | K | shell handle、自动回注/poll 语义不同 |
| `USING_CCM_WATCHDOG_CANCEL_GUIDANCE` | K | 取消真实 scheduler 的方法不同 |
| `USING_CCM_WATCHDOG_DISARM_WARNING` | S | “board disarm 与真实机制都要退役”上收；具体 cancel 留 origin reference |
| `USING_CCM_WATCHDOG_JOB_ID_GUIDANCE` | S | “必须是真实 accountable handle”上收；handle 类别留 origin reference |
| `USING_CCM_WAKEUP_SELF_HEAL_GUIDANCE` | S | 过期 handle 的 engine 语义上收；谁注入提醒留 origin reference |
| `USING_CCM_WATCHDOG_ARM_EXAMPLE` | K | mechanism/job-id 示例必须与 origin 真能力一致 |

50 个 slot 的目标不是搬到另一套 50-slot 模板，而是：

- common command catalog 只维护一份；
- target provider 差异由显式 `--harness`、normalized output 与 ccm capability/facts 表达；
- origin-only 操作内容集中到 `references/origin-runtime-operations.md`；master 不复制，只保留 capability summary；
- `account/statusline` 在 target-scope 合同完成前保持 `D`，不以 ambient origin 猜 capability。

## 6. `pacing-and-estimation` 与 `slicing-goals-into-dags`

| Skill / Slot | 处置 | 目标 |
| --- | --- | --- |
| `pacing-and-estimation` / `PACING_DESCRIPTION` | U | 描述改成消费全机 provider portfolio，不再写“在 Codex/Cursor 下” |
| `PACING_READ_ONLY_CAPABILITY` | U | registry profile 从三个 origin profile 收敛为一个 cross-harness portfolio contract；provider facts 仍带来源 |
| `PACING_MODEL_TIERS_REFERENCE` | U | canonical 教 `ccm provider facts <provider-id>` 的共同行为；每个 provider 的 snapshot 在 ccm registry |
| `PACING_USAGE_SIGNALS_REFERENCE` | U | canonical 解释 target-bound source/window/freshness/unknown；不按 origin 只暴露一个 quota model |
| `PACING_LEVERS_REFERENCE` | U | lever 顺序共同；Claude account pool、Codex 7d、Cursor billing period 是 target capability，不是 origin 文本 |
| `CROSS_HARNESS_ACTIVE_QUERY_POINTER` | R | 所有 host 使用同一个 `using-ccm` command catalog pointer |
| `slicing-goals-into-dags` / `SLICING_DISPATCH_POINTER` | R | canonical 直接写“交给 `master-orchestrator-guide` 选 target + origin-native mechanism” |

`pacing-and-estimation/references/cross-harness-target-facts.md` 已经接近正确边界：它按 selected target
解释 surface/model/quota/binding。迁移时扩展它作为统一解释入口，而不是再新增一个第九个分发 skill。

## 7. stub / exclusion inventory

| Payload | 当前 host | 结论 | 理由 |
| --- | --- | --- | --- |
| `authoring-workflows` unsupported stub | Codex、Cursor | 保留 | origin 没有 Claude Workflow API；cross-harness CLI worker 不提供 in-process Workflow tool |
| 六个 `cc-master-*` command-entry shim stub | Claude Code、Cursor | 保留 | 这两个 host 有自己的 command surface；stub 防止错误入口，不隐藏 worker facts |
| `master-orchestrator-guide/references/cost-decisions.md` exclusion | Codex、Cursor | 拆分后删除 exclusion | 通用容量判断应共享；Claude account switch 机制应变成 target-scoped drilldown |
| `master-orchestrator-guide/references/handoff.md` exclusion | Codex、Cursor | 拆分后删除 exclusion | continuity/handle classification 共享；host-native resume 命令留 origin reference |
| `master-orchestrator-guide/scripts/codex-review.sh` exclusion | Codex、Cursor | 保留 | runtime path/tool dependency，不是决策信息 |
| `using-ccm/references/account-pool.md` exclusion | Codex、Cursor | 暂缓 | 先拆成通用 capability/policy 与 Claude backend mechanics；禁止因共享文档扩大自动换号权限 |

## 8. 目标文件结构

不能把同一份完整 origin-runtime prose 同时投影进 `master-orchestrator-guide` 与 `using-ccm`：前者只负责
决策，后者才是 ccm 操作机制手册。两者共享 `_hosts/<origin-harness>/capabilities.yaml` 这个事实 SSOT，
但消费两个**职责不重叠的窄视图**：

| View | 消费 skill | 允许内容 | 禁止内容 |
| --- | --- | --- | --- |
| `decision-summary` | `master-orchestrator-guide` | native dispatch/completion/watchdog/entry 是否可用、负能力、稳定 reason code，以及单向“按需加载 using-ccm 操作视图”的指针 | 工具调用语法、handle 字段、cancel 命令、状态机步骤、完整 fallback 实施正文 |
| `ccm-operations` | `using-ccm` | origin tool/command、真实 handle 类型、completion/reconcile/cancel、watchdog 降级链和 ccm 状态机操作前置 | target 选择政策、模型/配额取舍、重复 master 的决策程序 |

`using-ccm` 的 canonical command catalog 继续承载共同的 `route-bind → in_flight → 独立验收 → done`
状态机；`ccm-operations` 只补齐该状态机在当前 origin 上所需的真实 launch/handle/reconcile/cancel 机制。
两者合起来才是完整操作手册，master 不复制其中任一操作步骤。

这里不新增自由文本 template language，也不把 generated artifact 写进 `canonical/`。projection 增加一个
窄、typed 的 `origin_capability_view` contract：它从 `capabilities.yaml` 读取固定 JSON-pointer 字段，交给
两个固定 renderer，在内存中分别替换两个不同 slot。renderer 产物只进入 `plugin/dist/<origin-harness>`；
源码目录不提交 renderer 输出，也不维护第二份 hand-written mechanism prose。

```text
plugin/src/skills/
  _hosts/<origin-harness>/
    capabilities.yaml                   # origin 机制事实 SSOT；claude-code | codex | cursor
  master-orchestrator-guide/canonical/
    SKILL.md                            # 全机 worker pool 身份、决策程序、统一热路径
    references/dispatch.md              # selected-target 决策 + worker wrapper 合同
    references/model-allocation.md      # provider-neutral task→tier/effort 判断
    references/origin-capability-summary.md
                                        # canonical insertion point：{{ORIGIN_DECISION_CAPABILITY_SUMMARY}}
  master-orchestrator-guide/adapters/<origin-harness>/strategy.yaml
                                        # 声明 decision-summary typed view
  using-ccm/canonical/
    SKILL.md
    references/command-catalog.md       # 一份 CLI catalog；每个参数标 ID namespace
    references/origin-runtime-operations.md
                                        # canonical insertion point：{{ORIGIN_CCM_OPERATIONS}}
  using-ccm/adapters/<origin-harness>/strategy.yaml
                                        # 声明 ccm-operations typed view
  pacing-and-estimation/canonical/
    SKILL.md
    references/cross-harness-target-facts.md
    references/model-tiers.md           # 只教 provider facts envelope，不存第二份 model catalog
    references/usage-signals.md         # 统一 target-bound quota envelope
plugin/dist/<origin-harness>/skills/master-orchestrator-guide/references/
  origin-capability-summary.md           # decision-summary generated view
plugin/dist/<origin-harness>/skills/using-ccm/references/
  origin-runtime-operations.md           # ccm-operations generated view
plugin/dist/<origin-harness>/capability-view-manifest.json
                                        # 两个 view 的 source/render attestation
```

strategy 合同显式声明 view 与 slot，不能让两个 skill 引用同一个完整 replacement 文件：

```yaml
# master-orchestrator-guide/adapters/codex/strategy.yaml
runtime_contracts:
  origin_capability_view:
    registry: ../_hosts/codex/capabilities.yaml
    view: decision-summary
    slot: "{{ORIGIN_DECISION_CAPABILITY_SUMMARY}}"
---
# using-ccm/adapters/codex/strategy.yaml
runtime_contracts:
  origin_capability_view:
    registry: ../_hosts/codex/capabilities.yaml
    view: ccm-operations
    slot: "{{ORIGIN_CCM_OPERATIONS}}"
```

两个 renderer 只消费版本化 allowlist：`decision-summary` 读取 availability/negative-capability/reason-code
字段，`ccm-operations` 读取 launch/tool/handle/completion/cancel/watchdog/hook/command-surface 字段；字段缺失就
projection fail closed。操作视图为了决定是否渲染某个操作可以同源引用必要的 availability fact；这不允许
复制 decision policy 或机制正文。每个 fragment 首行带机器可读 marker（schema、view、origin、source SHA、
renderer version、included JSON pointers、body SHA；body SHA 只计算 marker 后字节），同时汇总进
`capability-view-manifest.json`。扩展
`tests/content/capability-host-coverage.test.mjs` 时只验证这些结构化 marker/manifest、source digest、view 字段
allowlist、slot 唯一性和 dist output hash；**不解析自由 prose 中的 imperative**。固定 renderer 的 snapshot
测试负责输出形状。这样两个 view 各自 parity，同源但不复制机制正文：master 的 summary 只能单向指到
`using-ccm`，完整 handle/command/state-machine 机制只出现一次。

`plugin/src/skills/provider-guidance-runtime.json` 继续作为 rendered artifact attestation，不是 provider facts
SSOT。迁移后它应断言 cross-harness target-fact/qualification references 在三 host dist 中语义相同，只允许
上述两个 origin capability view 与入口文件不同。模型事实 SSOT 仍是 ccm 的 provider facts registry。

## 9. 分阶段迁移

### Phase 0：先钉等价性测试

- 同一 frozen task/machine revision 与同一 target descriptor 在 Claude Code、Codex、Cursor origin 下，
  provider/model/quota/freshness、unknown/blocker 和 qualification predicate/result 必须相同。
- origin-native availability、context movement 与 integration cost 可因 origin 确定地不同，因而 selected route
  也可不同；fixture 必须证明差异只来自声明字段并带稳定 reason code，不允许“当前 origin 优先”这种隐式偏好。
- 负例覆盖 stale、quota unknown、Cursor IDE/Agent CLI 交叉拼接、provider facts 过期和无真实 handle。
- 记录当前 slot/overlay 数量作为单调下降的架构指标，但不把“删得多”当产品验收。

### Phase 1：统一最高频 cross-harness 热路径

- 在 `master-orchestrator-guide` 顶层暴露 §3 的四 ID namespace 与
  inventory/help/model/usage/preflight/dispatch/route-bind/reconcile 路径。
- 删除三个 cross-harness pointer slot 和 `SLICING_DISPATCH_POINTER`，改用可验证相对链接。
- 先不碰 account/statusline/watchdog 复杂段。

### Phase 2：统一模型、配额与 route 视角

- 把 `pacing-and-estimation` 六个 host-profile slot 收敛成 selected-target portfolio contract。
- 把 `master-orchestrator-guide` 的模型/配额十个 decision slot 写回 canonical；具体 model/window 从 ccm
  当次输出读取。
- 所有 provider 输出携带 target harness/surface/source/freshness；unknown 继续 fail closed。

### Phase 3：收敛 `using-ccm` command catalog

- 先合并 board、exit code、upgrade、worker/provider/harness、usage 的共同命令语义。
- usage 文档统一使用 `--harness <provider-id>`；JSON 示例必须 provider-discriminated。
- account/policy/statusline 在 target-scope capability contract 锁定后再合并；此前不删除 `D` 项。

### Phase 4：压缩 origin-runtime adapter

- 把 dispatch/completion/watchdog/hook/entry/resume/path 的几十个细粒度 overlay 收口到
  `_hosts/<origin-harness>/capabilities.yaml` 事实结构，由 typed renderer 生成两个不重叠 view。
- `master-orchestrator-guide` 只生成 decision summary 并单向指向 `using-ccm`；完整 handle/command/state-machine
  操作只生成到 `using-ccm`。canonical 只保存两个不同 insertion slot，不保存 generated body。
- 删除已经失去引用的 overlay payload；strategy 与 payload 唯一性继续由 skill-lint 卡住。

### Phase 5：复核 stub 与 exclusions

- `authoring-workflows` 等到 Codex/Cursor 真有等价 deterministic workflow substrate 才解除 stub。
- command-entry shim stub 随 host command surface 保留。
- 将 handoff/cost/account references 拆成 shared contract 与 provider/origin mechanics 后，移除不再必要的整文件 exclusion。

## 10. Projection 与测试门

每一阶段都必须同时满足：

1. `bash scripts/skill-lint.sh`：无 unresolved slot、无未引用 overlay/stub/partial、description 路由完整；
2. `bash scripts/sync-plugin-dist.sh --host claude-code`、`--host codex`、`--host cursor` 后，
   `bash scripts/check-plugin-dist-sync.sh` 通过；
3. 三 host dist 的 cross-harness target facts / qualification core 通过等价性 fixture；origin-relative
   availability/integration cost 差异必须由声明输入与稳定 reason code 解释；不要求 selected route 或整个
   skill byte-identical；
4. host-negative grep：Codex/Cursor 不出现可执行的 Claude Workflow/CronCreate/statusline/account-switch 指令，
   Claude 不继承 Cursor Task/AwaitShell 或 Codex deferred-tool 语义；
5. `ccm worker help/run`、`provider facts`、`usage --harness`、`orchestrator context`、`route advise`、
   `quota preflight`、`task route-bind` 的命令名和 ID namespace 由 CLI contract test 验证，skill 不复制
   provider flags；
6. Cursor IDE plugin 与 Cursor Agent CLI 始终是两个 surface，任何 entitlement/quota/selector 证据不交叉；
7. `available:false`、stale、unknown、conflicting 均不能被文字 fallback 改写成 eligible；
8. provider-guidance runtime attestation 更新，并证明共同 target-fact/qualification references 的三 host hash/semantic class
   不再随 origin 无理由分叉；
9. 至少一组 behavior eval：三个 origin agent 面对同一 task 和 machine facts，必须读出相同 target facts /
   qualification；若 route 不同，必须逐项归因于 origin-native availability、context/integration cost 或显式
   policy，并仍各自只用真实 origin primitive 发起/接回；
10. raw worker 闭环 fixture 证明同步 `ccm/worker-process-result/v1` 不被误当 background handle 或 task done，
    contract-enabled subagent 只在获得真实 origin handle 后经 `route-bind` 进入 `in_flight`，独立验收后才 done；
11. capability parity gate 从 `_hosts/<origin-harness>/capabilities.yaml` 校验两个 typed view 的 marker/manifest、
    source/output hash、字段 allowlist 与 slot 唯一性；拒绝两个 skill 共用完整机制 view、per-skill shadow
    overlay 与 canonical generated artifact，不解析自由 prose imperative。

## 11. 风险与护栏

| 风险 | 护栏 |
| --- | --- |
| 过度统一，教 Codex/Cursor 调不存在的 Workflow/CronCreate | decision/operations 两个 view 都从 capability SSOT 生成；真实工具未验证即 unsupported |
| 为“统一配额视图”虚构每个 surface 的剩余额度 | ccm authority 缺失即 unknown；Cursor IDE aggregate 不补 Cursor Agent CLI |
| 共享 Claude account pool 说明后扩大换号权限 | account/policy 项延后到 explicit target contract；Codex/Cursor 自动换号永久禁止 |
| model catalog 三份变一份但仍迅速过期 | skill 只教 envelope；model IDs/benchmarks/prices 留 versioned ccm facts registry |
| 大段 canonical 常驻注入挤占 context | 顶层只留热路径与 decision summary；完整 origin operations 按需加载 `using-ccm` |
| 相对链接在某 host dist 失效 | 三 host projected-link test 在删除 path slot 前先行 |
| handoff/common continuity 被整文件 exclusion 隐藏 | 拆 shared lifecycle contract 与 origin resume entry，不整页排除 |
| 追求 slot 数下降导致第二套事实源 | capabilities.yaml 保持唯一事实源；typed renderer 只有两个固定 view，manifest 证明输入/输出，生成物只进 dist |

## 12. 完成定义

本收敛完成不是“目录里没有 overlay”，而是以下可观察结果同时成立：

- 任意 supported origin 的 master 都把本机所有可见 harness/surface 视作一个 worker portfolio；
- 模型、配额、auth、payer/pool、admission 与 fallback 按 selected target 读取，三 origin 不再各看一套世界；
- `master-orchestrator-guide` 顶层直接给出最高频 cross-harness 决策/命令路径；
- `using-ccm` 只有一份 machine-wide CLI catalog，provider 差异由显式 target 和结构化输出表达；
- `pacing-and-estimation` 消费全机 target portfolio，而不是只解释当前 origin 的 quota window；
- adapter 只保留 origin-native launch/completion/watchdog/hook/entry/path 等真实机制差异；
- unsupported stub 只对应真实 capability gap 或 command-entry mismatch，不再承担信息隔离；
- 三 host behavior eval 得到相同 target facts/qualification；route 若因 origin availability/integration cost
  不同而不同，差异可复算、有 reason code，且各自只用真实存在的 origin runtime primitives 落地。
