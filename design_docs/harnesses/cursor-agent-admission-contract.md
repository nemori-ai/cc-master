# Cursor Agent headless admission contract

> 状态：**partial**——`ccm/cursor-agent-admission/v1` schema、纯 admission evaluator、可注入 process boundary、inventory 的 unprobed fail-closed snapshot 与 fixture tests 已实现；真实 auth/quota collector、production process driver、reservation 与 dispatcher 接线仍是 target。
> 日期：2026-07-13 UTC
> 证据：Linux Cursor Agent dogfood 证明 sandbox/AppArmor pre-exec failure、RC0 empty stdout 与 valid ask JSON 是三个彼此独立的 transport 结果；macOS 仍待独立 qualification，不继承 Linux sandbox 结论。

## 1. Scope 与 ownership

本合同只覆盖 `cursor-agent` / `cli-headless` execution surface 的 mode-specific transport admission。Cursor IDE plugin 仍由 [`cursor.md`](cursor.md) 描述，顶层 `cursor.installed` 仍只代表 IDE/plugin distribution target；headless binary 不得把它翻真。

schema 与 evaluator 的实现 SSOT 是 [`cursor-agent-admission.ts`](../../ccm/apps/cli/src/harnesses/cursor-agent-admission.ts) 及 [`types.ts`](../../ccm/apps/cli/src/harnesses/types.ts)。本页冻结字段语义与 failure boundary；更广的 route、quota reservation、supervisor 和 true-done 仍以 [`cross-harness-orchestration-capability-model.md`](../cross-harness-orchestration-capability-model.md) 为能力完整性 SSOT。

## 2. Record schema

```json
{
  "schema": "ccm/cursor-agent-admission/v1",
  "request": { "mode": "ask|plan|agent", "sandbox": "required|not-requested" },
  "binary": { "name": "cursor-agent", "path": "/absolute/path|null", "available": true },
  "authentication": { "state": "available|unavailable|unknown", "source": "..." },
  "quota": { "state": "available|unavailable|unknown", "source": "..." },
  "sandbox": "supported|unavailable|not-requested|unknown",
  "result_schema": "valid|invalid-empty|invalid-shape|unknown",
  "task_acceptance": "accepted|rejected|unknown",
  "transport": { "terminated": true, "exit_code": 0, "signal": null },
  "schedulable": false,
  "blockers": ["quota.unknown"]
}
```

Inventory 尚未选择 request mode 时 `request:null`，并保持 authentication/quota/sandbox/result/acceptance 为 unknown、`schedulable:false`。`binary.available` 可以独立为 true；它不改变任何其他字段。

## 3. Admission invariants

对 record 自己声明的 request profile，`schedulable` 是以下条件的合取：

```text
binary.available
AND authentication.state == available
AND quota.state == available
AND sandbox matches the requested profile
AND result_schema == valid
AND task_acceptance == accepted
AND transport.terminated without signal/nonzero exit
```

- 任一 required capability 为 `unknown` 或 failed state（unavailable / invalid-* / rejected）即 fail closed。
- `cursorAgentAdmissionMatchesRequest` 要求 mode 与 sandbox profile 都精确相同；ask evidence 不得复用于 plan，sandbox-required evidence 不得复用于 non-sandbox request，反之亦然。
- sandbox pre-exec failure 只写 `sandbox:unavailable`；不得把已知 true 的 binary/auth 改成 unavailable。
- 一份 sandbox-unavailable record 不能直接放行；另一个明确授权、独立执行的 `ask + not-requested` record 可以单独 admission。

## 4. Terminal result 与 true-done 边界

RC0 只证明 process transport terminated。以下情况都不得 accepted：

- RC0 + blank stdout → `result_schema:invalid-empty`；
- RC0 + JSON parse failure 或非 terminal result shape → `result_schema:invalid-shape`；
- valid terminal error envelope → `result_schema:valid` + `task_acceptance:rejected`；
- 没有显式 terminal envelope → `task_acceptance:unknown`。

当前 valid success core 要求 `type:"result"`、`subtype:"success"`、`is_error:false`、string `result` 与非空 `session_id`，并与 RC0 同时出现，才得到 `task_acceptance:accepted`。这里的 accepted 只表示 provider transport 显式接受并终止该请求，**不表示父 task 完成**；diff、artifact、tests 与 acceptance 仍由父层独立验收。

## 5. Effect boundary 与 fixture policy

`probeCursorAgentAdmission` 不 import `child_process`、credential/keychain 或 network API；调用方必须注入唯一的 `runProcess(invocation)` effect。authentication 与 quota 是调用方提供的独立事实，probe 不读取 credential、不执行 login/logout/switch，也不实现 Cursor/Codex account mutation 或 autoswitch。

默认 machine inventory 不注入 process effect，因此只生成 unprobed blocked snapshot。fixture tests 注入内存 runner，覆盖 AppArmor pre-exec、RC0-empty、RC0-invalid、valid ask JSON 和逐能力 unknown/failed matrix；不会启动真实 binary、读取真实账号或访问真实网络。证据入口：[`cursor-agent-admission.test.ts`](../../ccm/apps/cli/test/cursor-agent-admission.test.ts) 与 [`dogfood.json`](../../ccm/apps/cli/test/fixtures/cursor-agent-admission/dogfood.json)。

## 6. Remaining target work

- production provider driver 与 immutable runtime/supervisor 接线；
- read-only auth fact、quota pool/freshness/reservation 的独立 collectors；
- macOS binary/auth/quota/sandbox/result live qualification；
- requested-vs-resolved model、permission profile、cancel/resume 与 terminal artifact coverage；
- dispatcher 在 spawn 前消费同一 admission 结果，且 acceptance failure 不触发越权 fallback。
