---
"ccm": patch
---

Four-harness worker/usage parity fixes:

- `worker run`: resolve a relative `--cwd` (e.g. `.`) against the launching process cwd — mirroring the omitted-`--cwd` default — instead of rejecting it in `validate()` before executable resolution and surfacing a confusing `executable:null` / `request_rejected` envelope (Finding #99). Fixes all four harnesses launching with a relative `--cwd`.
- cursor usage: `readCurrentUsage` now tries the `cursor-agent-cli` surface (self-contained `auth.json`) and falls back to `cursor-ide-plugin`, returning the first surface with a live signal. A bare `--harness cursor` read no longer reports `unavailable` when only the headless agent is logged in — both surfaces observe one subscription pool.
- kimi-code usage: new read-only managed `/usages` collector (`kimi-usage.ts`) that discovers the current-login token, GETs the rolling 5h + weekly windows, and parses the live protobuf-enum schema. It **never refreshes or rotates** the credential (expired token → honest degrade). kimi now reports real 5h/7d balances with zero unknowns while the token is fresh.
