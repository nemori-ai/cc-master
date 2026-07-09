# ccm-quota-account

## Intent（host-neutral）

`ccm` exposes **read-only quota/pacing advisories** and **account pool operations** tied to the
host's subscription OAuth model. Orchestrator consumes via SKILL H; hooks read sidecar signals;
account switch is policy-gated on board.

## Acceptance（可测等价类）

1. `ccm usage advise` returns verdict only when host quota provider is available.
2. `ccm account *` mutating commands fail with explicit NotImplemented on unsupported hosts.
3. `ccm harness current` correctly identifies host when detection env is present.
4. `ccm statusline` install/render remains Claude Code-only until another host documents
   equivalent.

## Host mechanisms

| host | status | mechanism | notes |
| --- | --- | --- | --- |
| claude-code | implemented | statusline sidecar, account vault/keychain, plugin upgrade via claude CLI | ccm-host-coupling-audit |
| codex | partial | `readCodexUsageSignal`; account NotImplemented; statusline unsupported | codex.ts adapter |
| cursor | planned | **All unsupported/unavailable** until probe finds signal + plugin upgrade path | cursor.md §ccm |

## Declared divergence

```yaml
- rule: ccm-external-statusline
  kind: protocol-capability-gap
  affected_hosts: [codex, cursor]
  reason: Claude Code settings.json statusLine schema has no verified equivalent on Codex/Cursor IDE.
  compensating_mechanism: ccm statusline returns unsupported; usage reads alternate provider or unavailable.
  tracked_by: ccm-host-coupling-audit.md §Status Line

- rule: ccm-account-pool
  kind: protocol-capability-gap
  affected_hosts: [codex, cursor]
  reason: Account capture/switch binds Claude OAuth stores.
  compensating_mechanism: account handlers return NotImplemented under non-claude-code harness.
  tracked_by: ccm/apps/cli/src/harnesses/codex.ts, future cursor.ts

- rule: ccm-plugin-upgrade
  kind: protocol-capability-gap
  affected_hosts: [cursor]
  reason: Cursor plugin install path (local vs marketplace) and upgrade CLI not verified.
  compensating_mechanism: upgradePlugin skipped or manual reinstall documented until cursor.ts backend exists.
  tracked_by: cursor.md D9, ccm-host-coupling-audit.md §Cursor Expected Coupling

- rule: ccm-harness-detect-in-agent-shell
  kind: protocol-capability-gap
  affected_hosts: [cursor]
  reason: CURSOR_* env in non-hook agent shell unverified — auto detect may fail outside hooks.
  compensating_mechanism: CC_MASTER_HARNESS=cursor explicit flag; sessionStart hook injects CURSOR_CONVERSATION_ID.
  tracked_by: cursor.md D8, D11
```

## Linked surfaces

- `ccm/apps/cli/src/harnesses/*`
- Skills: `using-ccm`, `pacing-and-estimation`
- Capability: usage-pacing-midflight

## Probe deps

cursor.md Dogfood Backlog: **D8**, **D9**, **D11**
