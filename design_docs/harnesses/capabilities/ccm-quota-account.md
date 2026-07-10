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
| codex | partial | `readCodexUsageSignal`; account NotImplemented; statusline unsupported | codex.ts adapter |
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
