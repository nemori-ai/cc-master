# 模型分配与容量动作

先从 `pacing-and-estimation` 的 `references/model-tiers.md` 读取当前 host 已证明可用的模型事实、相对成本、容量 provenance 与不确定性；然后在这里作编排决定。未被证明可用的模型不进入候选集。

## 先判任务，再分模型

同时看三轴：**复杂性**（问题结构有多难）、**不确定性 / 风险**（错了代价多大）、**duration**（会占用多久）。duration 是成本与排期信号，不是智力需求信号：

- 长机械任务优先拆小、切薄；降低 WIP，把非临界部分推迟或放到有真实 handle 的 background，而不是仅因耗时长就升档。
- 短而不可逆的裁决可以使用强档；临界路径只提高失败代价，不自动决定型号。
- cadence 出现 `oversized` / `overbooked` 时，先重切与重新放置工作，再决定是否升档。

为高风险裁决选择当前可用的强模型，为可机械验收的任务选择满足契约的低成本模型；具体型号必须来自当前 host 的已证明候选集。

## Cursor 双 surface 分配

每次分配先记录目标 surface，不要因两者同属 Cursor 而共享模型事实：

- **`cursor-ide-plugin` / IDE 原生 Task**：IDE 的模型 entitlement、catalog、selector 与任务能力映射当前是 `unknown`。没有 IDE-local 证据时 fail closed：不强制精确模型、不从 CLI catalog 推断可用性，也不声称完成了跨 family 复核。
- **`cursor-agent-cli` / headless worker**：先运行 `ccm provider facts cursor --json`；只有 snapshot `freshness:"fresh"`、`catalog_eligible_for_admission_check:true`，候选又绑定 fresh first-party catalog、subscription pool、live entitlement 与 exact admission 时才可派发。静态 snapshot 的 `eligible_for_automatic_selection:false` 是正常的 fail-closed 边界，不能自行翻成 true。`pacing-and-estimation/references/model-tiers.md` 给出读取边界，不证明某个 family 适合某类任务。未有独立 benchmark 或验收证据时，不做任务能力映射。记录 external `run_ref` 而不是 IDE Task id。

准入事实不完整时停止该 worker 路线的分配并重新读取合同。自动换号永久禁止；真实 paid canary 仍须用户对该次调用给出新的明确批准。

## 容量收紧时按顺序决策

读取 `pacing-and-estimation` 给出的 verdict、`strength`、`nearest_reset`、WIP / high-float burn 影响和可用 wakeup handle 后，按下面的 owner-side 顺序行动：

1. 先降低能机械验收的非临界 leaf 档位，不降低高错误代价的裁决与端点验收档位。
2. 再降低 WIP，把 high-float 工作推迟到 reset 之后；可外部化的非临界工作只有拿到真实 background handle 才移出前台。
3. 硬停 verdict 出现时停止派新节点；让在飞任务到安全点并验收其产物。
4. 存在真实 wakeup handle 时按 `nearest_reset` arm watchdog；没有 handle 就明确记录“不可自动唤醒”。
5. 若目标仍要求越过当前容量边界，把范围 / 期限 / 继续消耗的选择立即 surface 给用户；不要替用户跨硬总闸。

Cursor 与 Codex 自动换号永久禁止；任何模型选择都不得以 API、BYOK、on-demand 或未证明的容量作 fallback。
