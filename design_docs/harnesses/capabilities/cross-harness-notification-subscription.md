# cross-harness-notification-subscription

> Track B specification target. This card owns only the cross-surface capability intent,
> acceptance, and per-host status. Hook-local command and failure rules live in the affected PHIP
> CONTRACT files named below.

## Canonical authority map

<!-- XH-C3-CAPABILITY-AUTHORITY:BEGIN -->
```json
{
  "schema": "cc-master/xh-c3-capability-authority/v1",
  "capability_id": "cross-harness-notification-subscription",
  "track": "B",
  "owns": [
    "cross-surface-intent",
    "cross-surface-acceptance",
    "per-host-capability-status"
  ],
  "required_hosts": ["claude-code", "codex", "cursor"],
  "affected_hooks": [
    "plugin/src/hooks/bootstrap-board/CONTRACT.md",
    "plugin/src/hooks/coordination-inbox/CONTRACT.md"
  ],
  "derived_documents": [
    "design_docs/2026-07-15-cross-harness-notification-subscription-transport-contract-v1.md"
  ]
}
```
<!-- XH-C3-CAPABILITY-AUTHORITY:END -->

## Intent（host-neutral）

让 Claude Code、Codex、Cursor 中已武装的 master-orchestrator session 只接收绑定到其精确
board、origin、session identity、ccm-issued epoch 与 capability 的通知。注册失败、旧 epoch、错配
identity/epoch 和不完整 provenance 全部 fail closed，不回退到别的 active session 或未绑定 inbox。

## Acceptance（可测等价类）

1. 三个 host 都在 ARM commit 后按 `bootstrap-board` 的 canonical registration rules 注册同一能力；
   registration failure 不撤销 ARM、不改变 owner，也不产生弱化 selector 的 fallback。
2. 三个 host 都按 `coordination-inbox` 的 canonical resolution/list rules，用当前 host session identity
   与 ccm-issued epoch 做精确读取；missing、stale、expired 或 mismatch 时静默且不发起未绑定读取。
3. 只有符合 `coordination-inbox` canonical seven-field delivery provenance contract 的 item 才进入
   host-native context envelope；字段不完整、为空或 identity 不匹配时只抑制该 item。
4. inbox hook 保持只读：只允许 canonical current resolution 与 bounded list 两类 ccm 调用；ack、写入、
   provider/network、credential、account 与 monitor/service effect 都不属于这个 hook。
5. 该 capability 的 host status 只由下表声明；hook manifest 的 `host_coverage` 表示 hook 整体可用性，
   不能替代或提升本能力状态。

## Host mechanisms

| host | status | mechanism | notes |
| --- | --- | --- | --- |
| claude-code | target | UserPromptSubmit bootstrap registration + Stop exact subscription resolution/read | contract-first; runtime pending |
| codex | target | launcher-normalized bootstrap registration + Stop system-message exact resolution/read | contract-first; runtime pending |
| cursor | target | beforeSubmitPrompt bootstrap registration + stop followup-message exact resolution/read | contract-first; runtime pending |

## Declared divergence

```yaml
[]
```

## Linked canonical surfaces

- Bootstrap registration and registration-failure authority:
  [`bootstrap-board/CONTRACT.md`](../../../plugin/src/hooks/bootstrap-board/CONTRACT.md)
  (`rule-bootstrap-subscription-register`, `rule-bootstrap-subscription-registration-response`,
  `rule-bootstrap-subscription-registration-failure`).
- Exact current/bounded-list, fail-closed, provenance, and read-only authority:
  [`coordination-inbox/CONTRACT.md`](../../../plugin/src/hooks/coordination-inbox/CONTRACT.md)
  (`rule-coordination-inbox-current-subscription`, `rule-coordination-inbox-bounded-list`,
  `rule-coordination-inbox-subscription-fail-closed`,
  `rule-coordination-inbox-delivery-provenance`, `rule-coordination-inbox-read-only`).
- Non-normative map:
  [`2026-07-15-cross-harness-notification-subscription-transport-contract-v1.md`](../../2026-07-15-cross-harness-notification-subscription-transport-contract-v1.md).

## Current truth

当前 production hooks 还没有兑现本 Track B target；在 executable implementation 与独立端点证据落地前，
三个 host 均保持 `target`，不得从 hook 整体已安装/已运行推导为本能力 `implemented*`。
