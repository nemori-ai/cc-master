# ccm-quota-account

## Intent（host-neutral）

`ccm` exposes **read-only quota/pacing advisories** and **account pool operations** tied to the
host's subscription OAuth model. Orchestrator consumes via SKILL H; hooks read sidecar signals;
account switch is policy-gated on board.

## Acceptance（可测等价类）

1. `ccm usage advise` returns verdict only when host quota provider is available.
2. `ccm account *` mutating commands fail with explicit NotImplemented on unsupported hosts.
3. `ccm harness current` correctly identifies host when detection env is present.
4. `ccm statusline install/uninstall` remains Claude Code-only until another host documents an
   equivalent external statusline surface; alternate quota providers do not imply that surface.

## Host mechanisms

| host | status | mechanism | notes |
| --- | --- | --- | --- |
| claude-code | implemented | statusline sidecar, account vault/keychain, plugin upgrade via claude CLI | ccm-host-coupling-audit |
| codex | partial; read-only provider candidate implemented, usage migration pending | `ccm provider inspect codex` preserves multi-bucket provenance and uses 7d-only hard ceiling + rolling-24h advisory; current `readCodexUsageSignal` migration remains pending; account NotImplemented; statusline unsupported | codex.ts adapter + Codex provider contract v1 |
| cursor | partial | `readCursorUsageSignal` → dashboard `GetCurrentPeriodUsage` → `UsageSignal.billing_period` (~30d); local-plugin upgrade implemented; account pool / statusline / autoswitch unsupported | `cursor-usage.ts` + `harnesses/cursor.ts` |

## Declared divergence

```yaml
- rule: ccm-external-statusline
  kind: protocol-capability-gap
  affected_hosts: [codex, cursor]
  reason: Claude Code settings.json statusLine schema has no verified equivalent on Codex/Cursor IDE.
  compensating_mechanism: ccm statusline install/uninstall returns unsupported; usage reads alternate provider or unavailable.
  tracked_by: ccm-host-coupling-audit.md §Status Line

- rule: ccm-account-pool
  kind: protocol-capability-gap
  affected_hosts: [codex, cursor]
  reason: Account capture/switch binds Claude OAuth stores.
  compensating_mechanism: account handlers return NotImplemented under non-claude-code harness.
  tracked_by: ccm/apps/cli/src/harnesses/codex.ts, ccm/apps/cli/src/harnesses/cursor.ts
```

## Linked surfaces

- `ccm/apps/cli/src/harnesses/*`
- Skills: `using-ccm`, `pacing-and-estimation`
- Capability: usage-pacing-midflight

## Probe deps

Closed 2026-07-09: D8 (Agent Shell detection), D9 (local plugin), D11 (session env caveats).
Remaining divergence is structural: Cursor has no ccm account pool or Claude-style external statusline.

## Codex contract target（2026-07-13）

[`../../2026-07-13-codex-candidate-provider-driver-contract-v1.md`](../../2026-07-13-codex-candidate-provider-driver-contract-v1.md)
冻结并由 `ccm provider inspect codex` 实现了 provider qualification boundary。Codex 的历史/意外 5h 字段不参与 eligibility、
pacing、fallback 或 wakeup；现有 7d hard ceiling 保持，rolling-24h burn 只 advisory。multi-bucket
identity/provenance 不可折叠。quota unknown/tight/hard-stale 均不可 automatic eligible。

这不是 `ccm usage` current implementation 的完成声明。Codex/Cursor account mutation 与自动切号仍为
unsupported，合同要求 login/logout/switch/auth-write/credential mutation 全部为零。
