---
'@ccm/engine': minor
'ccm': minor
---

Add a provider-neutral live quota admission engine, owner-only crash-durable observation and
reservation store, strict held-to-committed ticket/run lineage, recoverable multi-key transaction
coordination, payer+pool concurrency control, and `quota status/preflight/reserve/audit` CLI surface.
Preflight derives authority from stored observation, policy, effect, reservation, and committed
ticket facts rather than caller conclusions. Codex admission treats only the seven-day window as a
hard quota signal; rolling 24-hour velocity remains advisory and account or credential mutation
stays forbidden. Reserve capacity and canonical request digests are store-derived; reservation IDs
are authority-scope unique. Multi-key journals own lookup and every capacity-changing transition,
while terminal audit retries remain monotonic and cannot reoccupy released capacity. Machine-scope
idempotency-key locks and durable indexes prevent cross-aggregation duplicate holds, Codex policy and
percentage domains fail closed before admission, source coordinates are validated symmetrically, and
single-key terminal retries repair event-durable snapshot projections.
