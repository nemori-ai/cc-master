# machine-wide-quota-notification

> Track B R2 signal contract frozen；ccm runtime candidate GREEN。Card 只拥有跨 surface intent/status；quota observation 与
> derivation 仍由既有 quota admission contract 拥有，单 hook 规则由 linked CONTRACT 拥有。

## Intent（host-neutral）

让任一已武装的 Claude Code、Codex 或 Cursor master-orchestrator 根据本机完整 worker pool 感知每个
target surface 从其当前 authenticated login 只读采集的 provider quota signal。quota 属于跨 session 共享的
provider account/subscription/pool；session 只负责采集与订阅投递。posture 复用既有 provider pacing policy，
不依赖 identity/payer/pool 才可用，也不是 task admission。SessionStart/resume 提供 bounded cached summary；
运行中只有 entered-tight/entered-exhausted/became-unknown/recovery/reset decision edge 经既有 durable coordination inbox
fan-out。origin hook 零 provider/network/credential probe。

## Acceptance（可测等价类）

1. Codex、Claude Code、Cursor IDE、Cursor Agent 任一 target edge 都 fan-out 到三个 origin 的 current exact
   subscriptions；host envelope 可不同，target scope、decision/delta revision 与七字段 provenance 相同。
2. `healthy|tight|exhausted|unknown` 与
   `entered_tight|entered_exhausted|became_unknown|recovered|reset` 是闭集；stale signal 投影为 explicit unknown；same decision revision
   不重复，多个 provider 不因 notification kind 相同而互相 supersede。
3. Hook 只读 ccm cached projection/current inbox；machine-wide notification refresh/fan-out 入口仅是显式
   `quota refresh --machine-wide` 或显式 `monitor --quota-source machine-wide`。monitor default 保持
   cached-only/no-autostart，mode 在现有 service state 中持久恢复；既有 admission/supervisor collectors 不受此入口闭集影响。
4. Codex 5h 不进入 decision、edge、notification/reset/wakeup/account-switch；只有 7d hard ceiling 与 rolling-24h
   advisory。Codex/Cursor 自动切号禁止。
5. Posture scope 只硬需 harness/surface/provider/window；identity/payer/pool 可选 diagnostics 缺失不阻塞。
   Cursor IDE 与 Cursor Agent 都必须有真实 billing-period collector，允许共享 dashboard backend，但
   collector/auth-source provenance 必须按 surface 区分。collector-proven 相同 `quota_scope_digest` 表示共享容量，
   不得叠加；digest 缺失也不得假定独立容量。
6. Cursor Agent current-login signal 的正式查询面是
   `usage show --harness cursor-agent --accounts current --json` 与
   `usage advise --harness cursor-agent --json`：前者暴露 `current.billing_period.{used_percentage,resets_at}`，
   后者暴露 `window_billing_period_pct`、`billing_period_resets_at` 与 `as_of`；healthy/hold 时 reset 仍须保留。
7. Agent-visible summary/delta 不含 raw account、identity fingerprint、credential/path/token、精确余额或
   provider raw response；未安装/未认证/unsupported 只能 unknown。

## Host mechanisms

| host | status | mechanism | notes |
| --- | --- | --- | --- |
| claude-code | contract-red | SessionStart cached summary + Stop coordination inbox | PostToolBatch 可更早 surface cached delta，但不是 producer |
| codex | contract-red | SessionStart cached summary + Stop coordination inbox | no fake batch event；7d-only |
| cursor | contract-red | verified postToolUse cached summary + Stop coordination inbox | SessionStart dynamic context gap沿用 cached-context Track B |

## Declared divergence

```yaml
- rule: machine-wide-quota-codex-midturn
  kind: event-unavailable
  affected_hosts: [codex]
  reason: Codex 没有 verified PostToolBatch-equivalent event。
  compensating_mechanism: decision edge 进入 durable coordination inbox，并在 Stop 或下次 SessionStart 投递。
  tracked_by: plugin/src/hooks/coordination-inbox/CONTRACT.md

- rule: machine-wide-quota-cursor-start
  kind: protocol-capability-gap
  affected_hosts: [cursor]
  reason: Cursor sessionStart.additional_context 是已确认 drop bug。
  compensating_mechanism: 使用 verified postToolUse.additional_context 投递 cached summary；decision edge 使用 durable inbox。
  tracked_by: plugin/src/hooks/orchestrator-context/CONTRACT.md
```

## Linked canonical surfaces

- ccm projection/fan-out contract:
  [`2026-07-16-machine-wide-quota-notification-contract-v1.md`](../../2026-07-16-machine-wide-quota-notification-contract-v1.md)
- quota truth/derivation:
  [`2026-07-13-cross-harness-quota-admission-contract.md`](../../2026-07-13-cross-harness-quota-admission-contract.md)
- hooks: [`coordination-inbox`](../../../plugin/src/hooks/coordination-inbox/CONTRACT.md),
  [`orchestrator-context`](../../../plugin/src/hooks/orchestrator-context/CONTRACT.md),
  [`usage-pacing`](../../../plugin/src/hooks/usage-pacing/CONTRACT.md)

## Current truth

Subscription/inbox/context transport spine 已存在；ccm runtime candidate 已实现 Cursor IDE/Agent 各自 current-login
dashboard collector、machine-wide cached aggregation、non-additive capacity view、edge projector、fan-out、显式 CLI
refresh/status、Cursor Agent `usage show/advise` 与 monitor quota-source persistence，并由真实双凭据 HTTP probe验收。
Plugin hook migration/三 origin adapter projection 仍由独立交付线完成；在其 GREEN 前不得把 origin hook 描述成
已具备 machine-wide 通知能力。
