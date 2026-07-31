---
point: ccm.board.planning-routing
---

## 权威陈述

<!-- ccm:k:start point:ccm.board.planning-routing -->
## C.5 cross-harness planning / routing 合同

这是 **opt-in 的 board planning / ledger / activation contract**，不是自动派发器。它把「任务需要什么」和「有哪些合格执行候选」分开持久化，使换 session、换 origin harness 或 resume 后仍能重建选择依据：

| 对象 | 回答的问题 | 写口 |
|---|---|---|
| `task.planning` · `ccm/task-planning/v1` | 任务本身有多难、多险、上下文多大，质量底线、预算姿态与能力边界是什么 | `ccm task set-planning <id> --profile @/abs/planning.json` |
| `task.routing` · `ccm/agent-routing/v1` | 哪些 host-native / cli-headless candidate 合格，ample / tight 各按什么链尝试，哪些失败可 fallback | `ccm task set-routing <id> --policy @/abs/routing-policy.json` |
| `routing.selected` + `routing.attempts[]` + task `handle/status` projection | 实际选了谁、依据何在、哪个 running attempt 与 opaque handle 对应 | `ccm task route-bind <id> --selection @/abs/selection.json --attempt @/abs/attempt.json` |
| `board.meta.contracts` | 本板是否要求非 grandfathered `subagent` 都遵守上述合同 | `ccm board enable-contract [--preflight]` |

### planning：先评估任务，不先选品牌

`planning.dimensions` 七维都必填；它们描述任务，不描述当前 session 所在 harness：

| 维度 | 合法值 |
|---|---|
| `reasoning` | `routine | multi-step | novel | frontier` |
| `uncertainty` | `low | medium | high | unknown` |
| `risk` | `low | medium | high | critical` |
| `scope` | `local | multi-file | cross-module | cross-repo` |
| `context` | `small | medium | large | oversized` |
| `coordination` | `none | single-boundary | multi-boundary` |
| `reversibility` | `reversible | costly | irreversible` |

同一 profile 还必须带：严格 UTC `assessed_at`、非空 `assessor`、`estimate_confidence: low|medium|high`、`quality.effect_floor`、`budget.posture: ample|tight`、正整数 `budget.max_attempts`，以及 `capabilities.required/preferred/forbidden` 三组 capability object。新写入的模型角色 policy 中，`quality.effect_floor` 只取 `O | T1 | T2 | T3`：设计 / 规格和高风险异族 review 用 `O`，完整规格实现与常规异族 review 用 `T1`，只读研究 / grounded summarize 用 `T2`，机械确定性工作用 `T3`。`required` 至少一个；三组 id 各自唯一且不可跨组重叠。task 本身还要有正数 `estimate`。

```json
{
  "schema": "ccm/task-planning/v1",
  "assessed_at": "2026-07-16T08:00:00Z",
  "assessor": "master-orchestrator",
  "dimensions": {
    "reasoning": "multi-step",
    "uncertainty": "medium",
    "risk": "medium",
    "scope": "multi-file",
    "context": "medium",
    "coordination": "single-boundary",
    "reversibility": "reversible"
  },
  "estimate_confidence": "medium",
  "quality": { "effect_floor": "T1" },
  "budget": { "posture": "ample", "max_attempts": 2 },
  "capabilities": {
    "required": [{ "id": "repository-reasoning" }],
    "preferred": [{ "id": "structured-output" }],
    "forbidden": [{ "id": "account-mutation" }]
  }
}
```

### routing：候选是跨 harness 资源，不是 origin-local 默认值

`routing.policy` 精确承载：

- `objective`：`quality-first | balanced | cost-first`。
- `constraints`：非空 `effect_floor`；`quota_unknown` 必须是 `ineligible`；`cross_harness_quota_admission` 必须是 `ample-only`。
- `candidates[]`：每项显式给 `id`、`surface: host-native|cli-headless`、`adapter`、`harness`、`provider`、**精确** `model`（禁止 `auto`）、`effort`、`capabilities[]`、`effect_floors_met[]`、`permission{profile,denies[]}`、`account_mutation:"forbidden"`、`requires[]`。候选能力必须覆盖 planning.required、满足 effect floor，permission.denies 必须覆盖 planning.forbidden 和 `account-mutation`。
- `requires[]` 至少含 `capability-match`、`effect-floor`、`permission-compatible`、`account-mutation-forbidden`；其它机械资格（例如 runtime health）可显式追加。
- `chains.ample` / `chains.tight`：candidate id 的有序、无重复链；同 harness 也只有显式列成 candidate 才能 fallback 回去。两条链都必须保持 planning 的同一 effect floor；tight 只能在同档候选中改为价格 / quota 优先，不得用降档冒充 fallback。
- `fallback.on` 只允许机械失败：`binary-unavailable | auth-expired | model-unavailable | model-mismatch | quota-tight | rate-limited | startup-timeout | transport-error`。
- `fallback.never_on` 必须覆盖：`policy-blocked | permission-blocked | security-blocked | workspace-mismatch | task-blocked | acceptance-failed`；`exhaustion:"fail-closed"`、`same_harness:"explicit-candidate-only"` 固定 fail-closed。

`set-routing` 只生成 `mode:"cross-harness"`、`selected:null`、`attempts:[]` 的 envelope；**它不读取 provider、不选择 candidate、不 reserve、不 spawn、不 fallback**。candidate 的 `harness/provider/model/effort/surface` 是 ledger 中的计划事实，不是 ccm 对各家 CLI flags 的复制。

先用 `ccm model-policy show --task <task-taxonomy> --json` 取得四 provider 共用的角色 / 事实 / affinity 视图，再对每个候选独立取得 live admission。只把已过硬门的精确 target 写进 routing policy：

- 系统 / 架构 / spec 节点：`effect_floor: "O"`；master 独有全图判断用 `executor=master-orchestrator`，可独立交付设计 artifact 才用 O subagent。
- 实现节点：完整 spec 下用 `T1`；常规 review 也用与 producer 不同 family 的异族 `T1`。
- 安全 / 架构 / adversarial review：用异族 `O`；无 O 容量就保持 gate blocked。
- repository / web research：`T2`；纯机械提取可另切 `T3` leaf，不能原地降低研究节点的 floor。

示意链：`chains.ample=["t1-quality", "t1-cheap"]`，`chains.tight=["t1-cheap", "t1-quality"]`。两条都只引用 `effect_floors_met` 含 `T1` 且已准入的候选；quota tight 可重排，不得塞入 T2。Cursor third-party Fable / Sol 还必须有明确 payer、paid-use 与 retention 授权，否则不要写进任何 chain。

community taste 只影响合格候选的近似同分排序。最终 routing rationale 应通过现有 selection / log 记下 model-policy registry revision、task taxonomy、采用或忽略的 evidence refs 与理由；不要把 community ledger 全量复制进 board，也不要把它写进 `effect_floors_met`。

### activation 与写入顺序

**在 legacy board 上准备现有 subagent task：**

```bash
ccm task update T7 --estimate 3h
ccm task set-planning T7 --profile @/abs/planning.json
ccm task set-routing T7 --policy @/abs/routing-policy.json
ccm board enable-contract --preflight --json   # 只读；ready:true 才继续
ccm board enable-contract
```

`enable-contract` 会为现有 `done|failed|escalated` subagent 记录精确 grandfather fingerprint；它们不必伪造历史 planning/routing。若之后 retry，该新 attempt 不再豁免。activation 没有 generic setter 或 disable 旁路，先 preflight 再启用。

**已 enabled 的 board 新建 subagent task：**先建 planned task，完整准备 `estimate` / planning / routing，最后一次性把 executor 定成 `subagent`；启用后的 subagent executor 会冻结，不能靠改 executor 绕 route gate。

```bash
ccm task add T8 --type planning --estimate 2h
ccm task set-planning T8 --profile @/abs/planning.json
ccm task set-routing T8 --policy @/abs/routing-policy.json
ccm task update T8 --executor subagent
```

只有派发面已经返回非空 opaque running handle、且 selection evidence 在有效时间窗内把 candidate 的每个 `requires` predicate **恰好一次**证明为 `pass` 时，才调用 `route-bind`。它原子写 `routing.selected`、append running attempt（并冻结完整 `selection_snapshot`）、投影 task `handle`，再把 task 转为 `in_flight`；attempt 的 candidate/model/effort 必须与 selection/candidate 一致。当前合同只校验 handle 的非空 syntactic claim，不把它升级成 live provider attestation。

### 与 `ccm worker run|dispatch` 的边界

`ccm worker help/run` 是 raw surfaces：`help` 只读真实 provider help，`run` 是不写 board 的 session-bound raw wrapper；`ccm worker dispatch` 在同一同步 supervisor 外围增加 `agents[]` tracked aggregate（prepare/claim/真实 PID bind/identity enrichment/terminal/reconciliation）。这些 surface 与 routing ledger 都**没有自动接线**：不会读 policy 自动选 route、不会调用 `route-bind`、不会自动 fallback，也绝不把 process terminal 当 task acceptance。`dispatch` 的 task link 只是 agent-side join，不写 task status/handle/routing attempt/acceptance。

因此，只使用 raw wrapper 或 agent tracking 的 board 都可以保持 legacy task lifecycle；不要为了“看起来先进”把 `dispatch` 的 PID/session evidence 冒充 routing selection evidence。只有实际 routing authority 与 selection gate 独立满足时，才按上面的 activation/bind 顺序 opt in。无 `meta.contracts`、无 `planning/routing` 的历史 board/task 继续逐字保持 legacy 行为。

---

<!-- ccm:k:end point:ccm.board.planning-routing -->

## 失效类型

`environment_fact`（主体：事实方法） —— 这是 planning/routing 合同的字段表、枚举值、JSON schema 与命令写入顺序的接口转录,删掉后 agent 无法凭通用推理还原这些具体事实,只会写出撞 ccm 校验或漏字段的 profile/policy。

主体是 task-planning/agent-routing 两个 schema 的字段全集、合法值与 activation 写入顺序。
