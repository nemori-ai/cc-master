# machine-wide-quota-notification

> Track B contract frozen；production RED。Card 只拥有跨 surface intent/status；quota observation 与
> derivation 仍由既有 quota admission contract 拥有，单 hook 规则由 linked CONTRACT 拥有。

## Intent（host-neutral）

让任一已武装的 Claude Code、Codex 或 Cursor master-orchestrator 根据本机完整 worker pool 感知每个
target surface/provider/payer/pool/bucket 的 quota decision。SessionStart/resume 提供 bounded cached summary；
运行中只有 tight/exhausted/stale/unknown/recovery/reset decision edge 经既有 durable coordination inbox
fan-out。origin hook 零 provider/network/credential probe。

## Acceptance（可测等价类）

1. Codex、Claude Code、Cursor Agent 任一 target edge 都 fan-out 到三个 origin 的 current exact
   subscriptions；host envelope 可不同，target scope、decision/delta revision 与七字段 provenance 相同。
2. `healthy|tight|exhausted|stale|unknown` 与
   `entered_tight|entered_exhausted|became_stale|became_unknown|recovered|reset` 是闭集；same decision revision
   不重复，多个 provider 不因 notification kind 相同而互相 supersede。
3. Hook 只读 ccm cached projection/current inbox；live producer 仅是显式
   `quota refresh --machine-wide` 或显式 `monitor --quota-source machine-wide`。monitor default 保持
   cached-only/no-autostart，mode 在现有 service state 中持久恢复。
4. Codex 5h 不改变 decision、edge、throttle/stop/reset/wakeup；只有 7d hard ceiling 与 rolling-24h
   advisory。Cursor IDE 与 Cursor Agent CLI 不互相推导 quota。
5. Agent-visible summary/delta 不含 raw account、identity fingerprint、credential/path/token、精确余额或
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

Subscription/inbox/context transport spine 已存在；machine-wide cached aggregation、edge projector、fan-out、
显式 CLI refresh、monitor quota-source persistence 与 hook migration 尚未实现。只有 executable RED 晋升前，
不得把 origin-local `usage advise` 描述成 machine-wide。
