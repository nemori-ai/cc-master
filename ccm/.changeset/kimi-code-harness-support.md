---
"ccm": minor
"@ccm/engine": minor
---

feat: add kimi-code (Moonshot AI Kimi Code CLI) as a 4th supported harness (MVP)

- Harness registry: new `kimiCodeAdapter` (`ccm harness list` now reports `kimi-code`,
  detects `kimi` binary / `$KIMI_CODE_HOME`; account pool + external statusline unsupported,
  plugin distribution supported via managed-dir install).
- Worker driver: `ccm worker help/run --harness kimi-code` passes argv straight through to the
  `kimi` executable (`kimi -p ... --output-format stream-json`); adds `KIMI_CODE_HOME` to the
  worker child env allow-list and a `kimi` executable-resolution branch (`CCM_KIMI_BIN`/`KIMI_BIN`/PATH).
- Board model (`@ccm/engine`): `owner.harness` and `agents[].harness` enums gain `kimi-code`;
  `FMT-HARNESS` / `FMT-AGENTS` messages updated accordingly.
- Usage stays intentionally unavailable for this MVP: `readCurrentUsage` returns
  `signal: null, source: 'unavailable'` (no CLI quota signal). A read-only `/coding/v1/usages`
  collector is a documented follow-up — it must never refresh/rotate the stored credential.
