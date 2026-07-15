# Capability INTENT Cards

更新时间：2026-07-09。

本目录承载 **跨 surface 的 host-neutral 能力意图**——当一项用户需求同时涉及 hooks、commands、
skills 和/或 ccm，且各 host 机制不能 1:1 平移时，用 Capability Card 登记意图、验收等价类、
各 host 机制与声明式降级。

## 与 hook CONTRACT 的分工

| 文档 | 粒度 | 示例 |
| --- | --- | --- |
| `plugin/src/hooks/<hook>/CONTRACT.md` | 单个 hook 的业务规则 SSOT | verify-board FUSE、board-guard deny 表 |
| `capabilities/<id>.md` | 跨 cutting 的用户可见能力 | compaction 后角色重注、Workflow 创作、配额配速 |

一张 Capability Card 可链接多个 hook CONTRACT 规则与 command/skill adapter。

## 证据优先级

同 [`../AGENTS.md`](../AGENTS.md)：current probe > official docs > 本仓研究 > paragoge。

## 降级分类学（与 ADR-028 / ADR-031 一致）

- `event-unavailable` — 该 host 无等价触发点。
- `protocol-capability-gap` — 有触发点但协议语义不同；须写 `compensating_mechanism`。
- `host-convention-divergence` — 实现漂移；须 `tracked_by`；不可作为永久终态。

## 生成物

`bash scripts/gen-capability-parity-matrix.sh` →
[`../../capability-parity-matrix.md`](../../capability-parity-matrix.md)（只读聚合视图）。

`bash scripts/gen-capability-parity-matrix.sh --check` 接入 `run-tests.sh`。

## 卡片索引

| ID | 文件 | Track | Cursor 状态 |
| --- | --- | --- | --- |
| role-substrate-reinject | [role-substrate-reinject.md](role-substrate-reinject.md) | B | `protocol-capability-gap` — 分层替代 |
| stop-continuation-gate | [stop-continuation-gate.md](stop-continuation-gate.md) | B | `protocol-capability-gap` — followup_message + FUSE |
| post-tool-batch-gate | [post-tool-batch-gate.md](post-tool-batch-gate.md) | B | `event-unavailable` |
| workflow-authoring | [workflow-authoring.md](workflow-authoring.md) | B | `event-unavailable` — unsupported_stub |
| usage-pacing-midflight | [usage-pacing-midflight.md](usage-pacing-midflight.md) | B | `event-unavailable` + gap |
| path-token-resolution | [path-token-resolution.md](path-token-resolution.md) | A/B | `protocol-capability-gap` |
| ccm-quota-account | [ccm-quota-account.md](ccm-quota-account.md) | B | `protocol-capability-gap` — unsupported |
| cross-harness-cached-context | [cross-harness-cached-context.md](cross-harness-cached-context.md) | A/B | `protocol-capability-gap` — postToolUse dynamic substitute |
| cross-harness-notification-subscription | [cross-harness-notification-subscription.md](cross-harness-notification-subscription.md) | B | `implemented-track-b` — exact session/epoch contract |
| cross-harness-session-bound-worker | [cross-harness-session-bound-worker.md](cross-harness-session-bound-worker.md) | B | `current-partial` — global ccm process boundary |
| goal-contract-lifecycle | [goal-contract-lifecycle.md](goal-contract-lifecycle.md) | B | `protocol-capability-gap` — alwaysApply + PreCompact + completion gate |

## 维护纪律

1. 改一项跨 host 能力意图 → 先改 Capability Card，再改 hook CONTRACT / command strategy / skill adapter。
2. 每个「降级行为」 fenced yaml 块会被矩阵脚本解析；格式与 hook CONTRACT 相同。
3. Cursor probe 完成后在卡片内新增 **Probe results** 小节，回写机制选型。
4. 实现 Cursor adapter 前，相关卡片的 `acceptance` 须可被 parity fixture 表达。

## Related

- [ADR-031](../../adrs/ADR-031-n-host-capability-parity.md)（Accepted）
- [cursor.md](../cursor.md) — Track A/B 总表
- [compatibility-matrix.md](../compatibility-matrix.md)
