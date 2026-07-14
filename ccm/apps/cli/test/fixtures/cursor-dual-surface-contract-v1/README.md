# Cursor dual-surface contract fixtures

These fixtures freeze `ccm/cursor-dual-surface-contract/v1`. They contain synthetic evidence only:
no real Cursor process, account, credential, quota endpoint, or model request is used.

The catalog is split by contract boundary:

- `scenarios.json` — 18 independent axis combinations with per-axis provenance, including the
  dedicated IDE-quota-ample/Agent-auth-unknown boundary;
- `provenance-mutants.json` — surface-targeted stale, missing, cross-surface, future, and inverted
  evidence for both IDE origin and Agent worker roles;
- `lifecycle.json` — executable migration and consumer-first rollback snapshots, plus empty,
  partial, and complete strict-fact rollback cases.

Default CLI tests validate reachability, role separation, mutation adequacy, Track A/B evidence
anchors, lifecycle invariants, negative capabilities, and exact coverage:

```bash
pnpm --dir ccm/apps/cli exec node --import tsx --test test/cursor-dual-surface-contract.test.ts
```

The future pure evaluator is an explicit opt-in RED gate:

```bash
CCM_CURSOR_DUAL_SURFACE_CONTRACT_RED=1 \
  pnpm --dir ccm/apps/cli exec node --import tsx --test test/cursor-dual-surface-contract.test.ts
```

Until `cursor-surfaces.ts` exports `evaluateCursorDualSurfaceContract`, the second command must fail
at the missing evaluator assertion. Once that seam exists, the same opt-in gate also requires
`migrateCursorDualSurfaceLifecycle` and `rollbackCursorDualSurfaceLifecycle` to satisfy the frozen
migration/rollback fixtures. The test-local oracles exist only to prove the fixtures kill counterfeit
implementations; they are not production exports. A parse error, missing fixture, real provider call,
or credential write is not an acceptable RED.
