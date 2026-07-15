# goal-contract-lifecycle

## Intent（host-neutral）

Master orchestrator 把 raw request 当需求证据而非权威 goal；在切 DAG 前澄清并转写
normalized goal，按风险分级确认，复杂背景持久化为可校验 Goal Brief。Fresh、resume、
compaction、派发、amendment 和完成时始终对齐当前 revision。

## Acceptance（可测等价类）

1. Fresh bootstrap 不把命令参数、prompt 或 issue URL 逐字写入 `board.goal`。
2. Entry surface 在切 DAG 前完成 framing，并以 `ccm goal set|confirm` 持久化。
3. 实质歧义停在 pending `decision_package`；清晰低风险请求可 asserted。
4. Resume/compaction 先 check 当前 contract 并按需读取当前 Brief。
5. Goal amendment 生成新 revision，旧 Brief 不被覆盖，现有任务被语义重审。
6. 最终完成同时满足 task acceptance 与当前 Goal Contract。
7. Hook 只做 lifecycle/integrity 守卫，不声称能判断自然语言语义漂移。

## Host mechanisms

| host | status | mechanism | notes |
| --- | --- | --- | --- |
| claude-code | implemented | command + `SessionStart`/`PreCompact`/`Stop` hooks + canonical skills + `ccm goal` | `$ARGUMENTS` 只作 raw request；bootstrap 建 pending skeleton |
| codex | implemented | entry skill + session_start/pre_compact/turn_complete hooks + `ccm goal` | bootstrap shim 不再把解析参数传入 `--goal` |
| cursor | implemented-track-b | command + alwaysApply rule + PreCompact silent no-op + afterAgentResponse gate + `ccm goal` | 分层替代 Claude Code 的动态完整重注 |

## Declared divergence

```yaml
- rule: goal-contract-dynamic-reinject-on-compaction
  kind: protocol-capability-gap
  affected_hosts: [cursor]
  reason: >
    Cursor 无 Claude Code SessionStart(compact) 等价的动态完整重注事件。
  compensating_mechanism: >
    Fresh/resume command 先 framing/check；alwaysApply orchestrator rule 常驻 Goal Contract
    决策协议；PreCompact 当前为 silent no-op，靠 AlwaysApply 常驻规则补偿；afterAgentResponse verify-board 在完成前检查
    完整性与 pending 状态。
  tracked_by: design_docs/harnesses/cursor.md
```

## Equivalence fixtures

1. `raw-copy-rejected`：输入含冗长原文；三 host fresh board 的 `goal` 为空、contract pending。
2. `resume-current-revision`：r2+Brief board resume；动态或补偿机制均提示先 check/read r2。
3. `pending-no-execution`：pending board 不被当成可直接切/派发的 settled goal。
4. `integrity-before-done`：Brief missing/hash mismatch 时不得宣布完成。
5. `amendment-not-overwrite`：r1/r2 Brief 均存在，当前 board 指 r2。

## Linked surfaces

- Command: `as-master-orchestrator`
- Skills: `master-orchestrator-guide`、`using-ccm`、`slicing-goals-into-dags`
- Hooks: [`bootstrap-board`](../../../plugin/src/hooks/bootstrap-board/CONTRACT.md)、
  [`reinject`](../../../plugin/src/hooks/reinject/CONTRACT.md)、
  [`identity-nudge`](../../../plugin/src/hooks/identity-nudge/CONTRACT.md)、
  [`verify-board`](../../../plugin/src/hooks/verify-board/CONTRACT.md)
- ccm: `goal set|confirm|amend|show|check`
- Spec: [`Goal Contract 规范`](../../2026-07-15-goal-contract-lifecycle-spec.md)
- Decision: [`ADR-035`](../../../adrs/ADR-035-goal-contract-lifecycle.md)
