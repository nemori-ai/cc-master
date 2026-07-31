---
point: ccm.cmd.cross-harness-facts
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.cross-harness-facts -->
## 跨 harness 主动查询目标事实

这是高频派发热路径的命令面 SSOT。顺序是**发现 → 查真实 CLI → 查统一模型角色 / 事实 / taste → 查可证 usage/quota → 可选纯排序或 shadow advice → orchestrator 显式选择 raw transport 或 tracked transport**。事实查询与 advice 都不会启动 worker；只有调用者明确执行 `worker run|dispatch` 才会启动。

### 1. 发现与目标事实

当前上下文没有 selected target 的事实时，用下面的只读命令面主动取得 envelope；不要从 origin-local
事实、同品牌登录态或模型 prior 补造目标事实。

```bash
ccm harness list --machine-wide --json
ccm worker help --harness <codex|claude-code|cursor-agent|kimi-code> --scope agent
ccm provider facts <target-provider> --json
ccm model-policy show --task <task-taxonomy> --json
ccm quota status --machine-wide --refresh --json
ccm --harness <claude-code|codex|cursor-agent|kimi-code> usage show --accounts current --json
ccm --harness <claude-code|codex|cursor-agent|kimi-code> usage advise --json
ccm quota preflight --input <json|@file|-> --json
```

- `harness list --machine-wide` 用于选择精确 execution surface；`cursor-ide-plugin` 与
  `cursor-agent-cli` 是两个 descriptor，安装、认证与资格不可互推。
- `worker help` 经与 `worker run` 相同的 resolver，读取这台机器上**实际被选中的 executable** 的 agent-command help；provider flags 以它为准。需要 executable 顶层 flags 时另跑 `--scope root`。这比把某版 CLI 参数表复制进 skill 更抗版本漂移。
- `provider facts` 的 `<target-provider>` 当前取 `claude-code | codex | cursor | kimi-code`。它返回静态、带来源与
  freshness 的模型事实，不执行 live provider probe，也不证明当前账号 entitlement 或 exact-model admission。
- `model-policy show` 为四 provider 返回同一份 `hard_facts / project_role_evidence / community_advisory` 分层 read model。它给出 task 的 `O / T1 / T2 / T3` effect floor 与候选，但 `candidate` 不等于 certified / admitted；社区 affinity 也绝不产生准入。
- `quota status --machine-wide` 默认只读所有受支持 target scope 的**本机缓存投影**；加 `--refresh` 才按需经各 harness 的 live collector best-effort 填充 observation 缓存后再读，让冷缓存即使没有 monitor daemon 也不必全是 unknown。两者 JSON 根都是 `ccm/machine-quota-status/v1`，`summary.decisions[]` 给 target-bound posture，`readings[]` 给可得的百分比与 reset 事实；unavailable / expired reading 可带 `refresh_hint`，unknown / stale / missing 必须原样保留。Claude 另投影独立的 `claude-fable-*-cli + seven_day`，不可与通用 7d 相加；Codex target 只有 `codex-cli + seven_day`；Cursor 的两个 surface 各自再分 first-party `billing_period` 与 usage-based `billing_period_usage_based`，两池不互补；Kimi Code 投影 `kimi-cli + five_hour` 与 `kimi-cli + seven_day`，collector 默认可对过期 stored OAuth 做带锁自动刷新。
- `ccm --harness <target> usage show|advise` 是选定 target 后的下钻 read；`show` 的窗口位于 `current.{five_hour,seven_day,fable_seven_day,billing_period}`、named pools 位于 `current.pools[]`，并在 data 顶层给 `agent_summary` 与 `refresh_hint`；`advise` 返回单侧 verdict。它是 advisory，不是 automatic admission。`available:false`、窗口缺失或字段 unknown 必须原样保留，不能从 binary/auth/model facts、进程 RC0 或同品牌另一 surface 推出 ample。
- 不带 `--machine-wide` 的 `quota status` 仍只回答 home-scoped owner-only quota observation/reservation store 是否存在；其中 `available:true` **不等于**某个 harness 有 ample headroom。
- 只有已经持有 authority flow 给出的 `source_key`、committed `reservation_id` 与 `checked_at` 时，才把
  它们作为 `quota preflight` 输入。必须读取其 `decision`、`automatic_spawn_limit`、
  `blocking_reasons` 与 owner receipt；缺 authority reference、`automatic_spawn_limit:0` 或任一 blocker 都
  不能授权 spawn。`preflight` 只重验已有 authority evidence，不会现场查询某个 harness 的剩余额度，也不会创建 observation/reservation；不要由 caller 自铸 live / policy / effect 结论。
- 这些命令只取得和重验事实，不代替 orchestrator 的选择、用户对一次付费调用的授权或 parent 验收。
  字段如何解释查 {{CROSS_HARNESS_TARGET_FACTS_POINTER}}。

### 2. advise 与显式 dispatch

若 task 已有 planning/routing policy 且拿到了匹配 board revision 的 frozen context，可先跑：

```bash
ccm route advise <task-id> --context <json|@file|-> --origin <origin-harness> --as-of <UTC> --json
```

它永远是 pure shadow advice：输出固定 `spawned:false`，不 reserve、不建 attempt、不写 board。no-route / unknown / stale 不是“请自行猜一个候选”，而是 fail closed；即使得到 selected candidate，也仍须由 orchestrator 显式决定是否派发。

只要无 board side effect 的原始同步 transport 时，用 `worker run`。若需要 ccm 原子跟踪真实 PID、agent-side task link、可证 session 身份和 terminal，用 `worker dispatch`：

```bash
ccm worker run --harness <codex|claude-code|cursor-agent|kimi-code> --cwd /abs/repo -- <按 worker help 组装的完整 provider argv...>
ccm worker dispatch --board /abs/run.board.json --harness <codex|claude-code|cursor-agent|kimi-code> --task <task-id> --idempotency-key <key> --intent <safe-summary> --cwd /abs/repo [--transcript /abs/worker.log] -- <完整 provider argv...>
```

两者都逐项透传 argv/stdin/cwd、同步监督 child 到 terminal，且都不会 route/fallback/选模型/切号。区别只在跟踪边界：`run` 永远不写 board；`dispatch` 只在 `agents[]` 建 tracked aggregate，绝不改 task status/handle/routing attempt/acceptance。若 board 已 opt in routing contract，`dispatch` 也不会替你调用 `task route-bind` 或生成 selection evidence；父 task 的路由、状态与验收仍走原专属 gate。

若选择 `worker run` 承载长时 worker，**后台 handle 来自 origin harness**：必须由 origin harness 的后台 terminal / Shell 机制包住它，`worker run` 自己**不会返回 running handle**。其 `ccm/worker-process-result/v1` 只是 terminal 结果，**不是 running handle**。`worker dispatch` 同样是同步 supervision，不会伪装 detach；需要外层异步时仍由 origin 机制持有后台 job，但 board 中 tracked runtime handle 来自实际 child PID / 已证 session identity，不是该外层 job。

---
<!-- ccm:k:end point:ccm.cmd.cross-harness-facts -->

## 失效类型

`environment_fact`（主体：事实方法） —— 缺跨 harness 事实查询的顺序约定与 ccm 命令的具体行为（发现、查真实 CLI、查统一模型、查可证 usage、fail-closed 降级）

主体是跨 harness 事实查询的命令面 SSOT——哪些只读命令存在、各自 envelope 证明什么不证明什么；反推诫命只是附加条款。
