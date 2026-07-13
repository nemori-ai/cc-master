# Codex candidate/provider/driver v1 fixtures

These fixtures belong to the contract
`ccm/codex-candidate-provider-driver/v1`. They do not describe a current live driver and never use
real credentials or a provider model request.

- `scenarios.json` is the test-owned versioned catalog. `defaults` plus each scenario's `overrides`
  produce a complete fake-provider observation, but neither its path nor a scenario id is passed to
  the endpoint.
- `fake-codex.mjs` is a controlled executable template. The test creates a fresh executable with an
  embedded provider state, trace target, and random proof nonce. The nonce is available to the
  handler only by issuing correlated app-server requests and parsing JSONL/structured output.
- `authority-counterfeit.mjs` is loaded dynamically only after the host authority guard. It directly
  invokes every claimed Node network/process escape with pre-I/O-invalid arguments; the test requires
  a synchronous denial and an exact authority record for each entry point.
- `structured-output.schema.json` is the schema handed to the fake headless invocation.

Default tests validate catalog invariants only. The runtime RED suite is enabled with:

```bash
CCM_CODEX_PROVIDER_CONTRACT_RED=1 pnpm --dir ccm/apps/cli exec node --import tsx --test --test-isolation=none test/codex-provider-contract.test.ts
```

The RED suite must call `router.run(["provider", "inspect", "codex", ...])`. It verifies individual
JSON-RPC methods/correlation ids, response and execution payload digests, canonical evidence ids and
source revisions, requested/resolved/actual identity evidence, and complete quota provenance. Default
calibrations independently corrupt non-empty bucket, rolling-24h, and identity bindings and prove
that the same seam oracle rejects every mutation. A separate counterfeit test proves that a fixture
lookup plus superficial version/help/app-server/exec spawns cannot satisfy the proof.

The runner externally snapshots the workspace, board/home, Codex, Cursor, Claude, and neutral home
trees. It passes a narrow provider-runtime capability port through the real router seam: only that
port can resolve/spawn the controlled Codex binary, while its host network port is deny-only. A host
guard loaded before the future handler denies and records direct Node net/socket, DNS, HTTP, HTTPS,
TLS, datagram, fetch, WebSocket, child-process, Worker, and cluster escapes. The default counterfeit
calibration independently enumerates every patched entry point, so removing one guard leaves a safe
native-validation/tripwire failure instead of the required exact denial and makes the test RED. Every
child spawn must use the exact five-key, exact-value environment closure; named and randomized
secret, proxy, socket, shell, and tool canaries are injected into the parent input and must disappear.
The endpoint's own `side_effects` counters are telemetry, not proof. The only other handler-visible
test controls are a deterministic clock, cancellation timer, and real-shaped read-only registry
snapshot; none may be forwarded to the fake provider child.

The synthetic `ccm.fixture.provider_metadata` event exists only to exercise requested/resolved/actual
reconciliation. It is not a claim that a released Codex CLI emits that event or any equivalent
actual-model field.
