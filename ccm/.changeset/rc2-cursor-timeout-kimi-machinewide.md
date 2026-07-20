---
"ccm": patch
---

rc2: cursor headless reliability, 2h worker timeout, and kimi machine-wide quota

- **cursor worker reap**: a successful `ccm worker run --harness cursor-agent` no longer fails with `owned_tree_survived`. cursor-agent's launcher exits leaving its packaged `worker-server` node service (and the exact TypeScript language-service chain it starts, bound to the caller's npm cache) in the process group; these are now recognized as request-independent and reaped as benign. Classification binds to the exact `args` command line, not ps(1)'s `comm` (Node 24 reports `MainThread`). A real task, unrelated helper, mixed tree, lookalike outside the bound install/home roots, or unavailable inspection stays fail-closed (`owned_tree_survived`).
- **cursor version admission**: `2026.07.16-899851b` is admitted (added to the frozen `SUPPORTED_CURSOR_AGENT_VERSIONS` / `binary_version` contract alongside the prior version); quota admission no longer blocks with `headless.binary-unsupported`.
- **worker timeout ceiling**: `--timeout-ms` maximum raised from 1_800_000 (30 min) to 7_200_000 (2 h) so long agent dispatches are not hard-killed at 30 min; `run` default stays 600_000. CLI help, registry, catalog, and content contracts locked in step.
- **kimi machine-wide quota**: `kimi-code` (`kimi-cli` surface, 5h + 7d windows) is now a machine-wide quota target, so `ccm quota status --machine-wide` observes kimi through the same unified per-harness UsageReading strategy — no per-harness collector branch. With a fresh login it reports `healthy`; an expired token degrades honestly to `unknown` (`QUOTA_SIGNAL_UNKNOWN`, never a fabricated window). Closes the silent omission where a quota-capable harness was absent from the machine-wide aggregation.
