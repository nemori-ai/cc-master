---
"ccm": minor
---

feat(model-policy): add Kimi K3 and Kimi K2.7 Code as worker-target model candidates

- Provider facts: new `kimi-code` provider in `provider-model-facts.json` with two
  models — `kimi-k3` (frontier, 1M context, official benchmarks/model card not yet
  published) and `kimi-k2.7-code` (balanced, open-weight, forced-thinking, strong
  tool-use, 256K context). Both carry `benchmarks: null` on purpose: K3 has zero
  official benchmarks and K2.7's numbers are vendor self-selected sets that are not
  comparable to the cross-vendor `swe_bench_pro_pct` / `terminal_bench_2_1_pct`
  columns other providers use.
- Provider whitelist + OFFICIAL_HOSTS gain `kimi-code` and Moonshot official hosts
  (`platform.kimi.ai`, `kimi.com`, `www.kimi.com`) so `ccm provider facts kimi-code`
  and `ccm model-policy show` expose the new snapshot.
- Role candidates: `kimi-code-cli:kimi-k3` → `["T1","T2"]` (low confidence: benchmarks
  unpublished, carries an extra `official-benchmarks-unpublished` blocker) and
  `kimi-code-cli:kimi-k2.7-code` → `["T1","T2","T3"]` (medium confidence). Neither is
  an O candidate — conservative effect floor until benchmarks/certification arrive.
- Community advisory: one bounded-tie-break-only Kimi K2.7 implementation-from-spec
  signal with honest limitations (vendor-self-benchmark context, single community
  review, coding below frontier on standard comparators).

This only wires Kimi as a worker-target model provider into model-policy; it does not
touch the origin-harness (`ORIGINS`) axis or the worker/harness enums.
