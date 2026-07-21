# ADR-037 — Adapter-derived harness capability protocol

> Status: **Proposed**
> Date: 2026-07-20
> Scope: `ccm/apps/cli/src/harnesses/` adapter/registry composition; harness-aware consumers in
>   `machine-wide-quota.ts`, `usage-reading.ts`, `router.ts`, `handlers/*`, and future worker/runtime
>   consumers. This ADR defines the protocol and migration only; it does not change implementation,
>   credentials, account state, or provider processes.
> Source: rc3 issue #188; rc2 dogfood found that kimi-code was absent from machine-wide quota after
>   its adapter usage reader had already landed because `machine-wide-quota.ts` kept an independent
>   `TARGETS` list.

---

## 1. Context

`ccm` already has the beginning of a harness adapter layer. `harnesses/registry.ts` owns the known
adapter set, and each `HarnessAdapter` owns detection, installation inspection, session lookup,
usage reading, account-pool facts, and plugin upgrade behavior. `usage-reading.ts` has further
converged all usage consumers on one domain service. The default machine-wide collector in
`router.ts` is a useful successful sample: it resolves a harness adapter and reads the requested
surface through `UsageReading` rather than calling brand-specific collectors itself.

The target inventory did not converge with the collector. `machine-wide-quota.ts` still defines a
second exhaustive `TARGETS` array containing harness ids, surface ids, provider ids, quota windows,
collector ids, schemas, auth-source labels, and the adapter that should collect each row. That array
must be updated whenever a harness or quota surface changes. Kimi-code implemented its adapter usage
reader once, but did not become a machine-wide target until a second edit was made in `TARGETS`.
The resulting omission was silent: the adapter and direct usage commands worked while machine-wide
consumers behaved as if the harness had no quota surface.

The same structural risk appears wherever a consumer maintains a parallel exhaustive harness set:

- static `--harness` enum arrays in the command registry;
- coordination origin allowlists;
- worker harness/descriptor tables;
- provider/model catalogs that sometimes use harness ids as keys;
- boolean capability fields plus optional methods whose absence may mean either unsupported,
  unimplemented, or simply forgotten.

Not every brand-name list is wrong. A provider protocol may intentionally be a closed domain, a
model-policy table may own product policy rather than adapter facts, and detection order is
behavioral. The defect is narrower: **after a consumer has adopted a harness capability family, it
must not keep its own exhaustive harness inventory or reconstruct adapter-owned facts.** Otherwise
“add one harness” remains N edits with no mechanical proof that all consumers saw it.

ADR-031 solves a neighboring but different problem. Its Capability Cards are developer-facing,
host-neutral intent and acceptance records across plugin hooks, commands, skills, and ccm. They do
not provide a typed runtime composition mechanism inside ccm. This ADR does not replace those cards
or hook CONTRACTs; it gives ccm consumers an adapter-derived runtime capability surface that a Card
may reference as one host mechanism.

## 2. Decision

### 2.1 One registered adapter inventory; no consumer-owned harness inventory

We choose the compiled `harnesses/registry.ts` adapter registry as the only exhaustive inventory of
ccm-supported harnesses. Adding a harness requires:

1. implementing one adapter module;
2. declaring that adapter's state for every published capability protocol; and
3. registering the adapter once, with explicit detection precedence.

Every migrated consumer enumerates registry bindings, never harness ids:

```ts
knownHarnessAdapters()
  .flatMap((adapter) =>
    supportedCapability(adapter, 'ccm/harness-capability/machine-quota/v1'),
  )
  .flatMap(({ adapter, capability }) => capability.targets.map((target) => ({ adapter, target })));
```

The exact helper names are implementation detail. The invariant is not: once a consumer adopts a
capability protocol, adding a registered adapter with `supported` for that protocol makes the
consumer see it without editing the consumer. An `unsupported` declaration makes the adapter
intentionally absent from execution while remaining visible and explainable in inventory output.

Registration order is used only for ambient detection precedence. Capability enumeration uses a
deterministic sort (`adapter id`, then capability-owned item id) so output and cache identity do not
change when detection precedence changes.

### 2.2 Compose small versioned capability protocols, not a god-interface

`HarnessAdapter` will carry a capability declaration map composed from independent, versioned
protocols. The map is an exhaustive declaration ledger, not one interface whose every consumer must
understand.

Conceptually:

```ts
interface HarnessCapabilityProtocols {
  'ccm/harness-capability/usage-reading/v1': UsageReadingCapability;
  'ccm/harness-capability/machine-quota/v1': MachineQuotaCapability;
  'ccm/harness-capability/plugin-distribution/v1': PluginDistributionCapability;
  'ccm/harness-capability/account-pool/v1': AccountPoolCapability;
  'ccm/harness-capability/external-statusline/v1': ExternalStatuslineCapability;
  // Later, only after its own contract: 'ccm/harness-capability/worker-runtime/v1', etc.
}

type CapabilityDeclaration<K extends keyof HarnessCapabilityProtocols> =
  | { state: 'supported'; contract: K; implementation: HarnessCapabilityProtocols[K] }
  | {
      state: 'unsupported';
      contract: K;
      reason_code: string;
      reason: string;
      tracked_by?: string;
    };

type HarnessCapabilityDeclarations = {
  [K in keyof HarnessCapabilityProtocols]: CapabilityDeclaration<K>;
};
```

Each protocol lives in its own module, owns its payload type and validator, and can evolve by a new
versioned id. A consumer queries one protocol id and receives only that typed payload. It does not
depend on unrelated plugin, account, quota, session, or worker methods. Adding a new published
protocol deliberately requires every registered adapter to declare `supported` or `unsupported`,
but does not require unrelated consumers to change.

The adapter's small identity/detection core remains separate from capabilities: canonical id,
display name, aliases, detection probe, detection precedence, and lightweight installation
inspection. Existing methods may remain as compatibility shims during migration, but the final
consumer path goes through capability bindings.

### 2.3 Unsupported is explicit; unavailable is runtime

Every published capability protocol has exactly one declaration per registered adapter. Missing
keys, optional callbacks, empty supported payloads, and bare booleans are invalid.

- `unsupported` means the adapter does not implement this versioned contract. It carries a stable
  `reason_code`, a human-readable reason, and optionally a tracking issue. “Planned” remains delivery
  metadata; at runtime it is `unsupported` until the acceptance contract is implemented.
- `supported` means the adapter implements the protocol's acceptance contract. The implementation
  may still report runtime `unavailable` / `unknown` because the binary is absent, the surface is not
  installed, the user is logged out, a sidecar is stale, or a live probe failed.

This distinction prevents an uninstalled supported harness from being mislabeled unsupported, and
prevents an omitted adapter method from silently looking like a legitimate runtime outage. Partial
support is not a third generic state: either split the capability into smaller protocols or publish
a new contract version with precise acceptance. ADR-031's documented divergence taxonomy remains
the product-level record when mechanisms are non-1:1.

No capability declaration or probe may contain, return, refresh, rotate, or mutate credentials.
Capability inventory is secret-free; existing usage readers remain observe-only.

### 2.4 Adapter owns facts and mechanisms; consumer owns policy

Capability payloads contain only facts and mechanisms specific to one harness:

- canonical surface identity and aliases;
- source/schema/auth-source labels safe for public projections;
- supported quota windows and how a canonical surface is read;
- installation/availability probing needed by that capability;
- plugin distribution, account-pool, session-store, or worker invocation mechanisms when their
  respective protocols exist.

Consumers retain cross-harness product semantics:

- quota posture math, thresholds, aggregation, persistence, fan-out, and notification policy;
- routing/model preference and effect-floor policy;
- board state transitions and worker lifecycle rules;
- presentation, filtering, and user authorization.

An adapter must not smuggle cross-harness ranking or pacing policy into a capability payload. A
consumer must not re-encode a harness's surface names, quota windows, collector source, alias
normalization, or support state. This is the boundary that keeps composition from becoming a god
object in the adapter or a second adapter in the consumer.

### 2.5 First protocol slice: `ccm/harness-capability/machine-quota/v1`

The first migration proves the shape on the failure that triggered this ADR. Each adapter declares
`ccm/harness-capability/machine-quota/v1` as either explicit `unsupported` or supported with a
non-empty target catalog.
A target group owns stable, secret-free metadata:

```ts
interface MachineQuotaCapability {
  targets: readonly {
    id: string;                 // stable within this adapter
    surface_id: string;         // canonical UsageReading surface
    provider_id: string;
    collector: {
      id: string;
      source_schema: string;
      auth_source: string;
    };
    windows: readonly {
      name: 'five_hour' | 'seven_day' | 'billing_period';
      kind: 'rolling' | 'billing-cycle';
      duration_sec: number;
      bucket_id: string;
    }[];
  }[];
}
```

The owning adapter binding supplies `harness_id`; therefore the current
`default_collector_harness` field disappears. Each `(adapter, target, window)` expands to one
machine-wide target and preserves the existing external target shape and source-key identity.
Collection continues through the single `UsageReading.readSurface` domain service. Surface alias
normalization and runtime availability belong to the adapter's
`ccm/harness-capability/usage-reading/v1` implementation; the router must not retain the
Cursor-specific `cursor-agent-cli` / `cursor-agent` condition.

The quota protocol depends on `ccm/harness-capability/usage-reading/v1`. Registry validation rejects
a supported quota target whose adapter does not support surface usage reading, whose canonical
surface cannot be resolved, whose target/window ids collide, or whose supported target/window lists
are empty. Posture computation, authority validation, cache layout, capacity aggregation, and
notifications remain in the machine-wide quota domain and are unchanged.

### 2.6 Query API and composition rules

The registry exposes capability-oriented queries in addition to adapter resolution:

- enumerate all declarations for a protocol, including unsupported reasons;
- enumerate supported bindings as `(adapter identity, typed implementation)`;
- resolve one adapter + protocol without importing a brand module;
- validate ids, aliases, detection precedence, declaration completeness, contract versions, and
  capability-specific payload invariants at composition time.

Consumers must not import `claude-code.ts`, `codex.ts`, `cursor.ts`, or `kimi-code.ts` directly.
Brand switches are allowed inside the owning adapter implementation. After a capability family is
migrated, a consumer-side exhaustive brand switch/list is a contract violation unless it is an
explicitly allowlisted protocol vocabulary, compatibility parser, or product-policy domain with a
recorded reason.

The current `genericAdapter(id)` remains a compatibility fallback for an explicitly requested
unknown host. It is not added to the known registry and declares all published capabilities
unsupported; it cannot appear as a machine-wide target.

### 2.7 Relationship to ADR-031 Capability Cards

The two layers remain separate and linked:

- ADR-031 Capability Card: host-neutral user-visible intent, acceptance equivalence classes,
  declared divergence, and affected plugin/ccm surfaces.
- This ADR's protocol: typed ccm runtime declaration and implementation binding for one capability
  family.

Runtime ids use a ccm namespace (for example `ccm/harness-capability/machine-quota/v1`) and are not
silently treated as Card ids. When a Card depends on a ccm mechanism, it links that protocol id in
its host-mechanism table. The Card remains the Track B design gate; the runtime declaration proves
only that ccm wired the stated mechanism.

## 3. Consequences

### 3.1 Positive

- A fifth harness is implemented and registered once; every capability-oriented consumer either
  receives its supported binding automatically or reports its explicit unsupported reason.
- The kimi-code/TARGETS omission class becomes mechanically testable rather than review-dependent.
- Small capability protocols let quota, plugin distribution, account pool, usage, and future worker
  runtime evolve independently without widening a god-interface.
- Static unsupported, runtime unavailable, and product-level declared divergence become distinct
  concepts instead of overloading absent methods or booleans.
- Adapter-specific facts have one owner while quota/routing/board policy remains centralized in its
  domain service.

### 3.2 Negative

- Introducing a new published capability family touches every registered adapter because silence is
  forbidden; most adapters may initially add an explicit unsupported declaration.
- Versioned protocol ids, validators, builders, and query APIs add ceremony compared with optional
  TypeScript methods.
- Migration temporarily carries legacy adapter methods and new capability declarations in parallel;
  characterization and deletion gates are required to stop the bridge becoming permanent.
- Capability modules must avoid circular imports between registry, `UsageReading`, and consumers.

### 3.3 Neutral

- Registering a new adapter once remains necessary; “automatic” means no downstream consumer
  inventory edits, not dynamic third-party code loading.
- Explicit unsupported does not make a host capable. It makes the gap visible and stable.
- Public command/output schemas, quota source keys, ordering, cache paths, and posture behavior do
  not change in the first migration.
- This ADR does not implement #175 worker auto-registration. A future worker capability may use this
  protocol, while board agent creation/binding and lifecycle observability remain a separate
  decision and implementation.

## 4. Alternatives Considered

### 4.1 Keep expanding one `HarnessAdapter` interface with optional methods

Rejected. Optional methods encode “unsupported,” “not migrated,” and “forgotten” identically. A
single interface also couples every consumer to unrelated capabilities and trends toward a
god-interface as worker, quota, plugin, account, and session mechanisms accumulate.

### 4.2 Keep one central capability table keyed by harness id

Rejected. Moving `TARGETS` to another central file without deriving it from adapters preserves the
same parallel fork. Adding a harness still requires the adapter edit plus a table edit, and omission
still looks like legitimate absence.

### 4.3 Put metadata in adapters but keep behavior in consumer brand switches

Rejected. This removes one duplicated list but retains a second adapter implementation in every
consumer. Router's unified collector and `UsageReading` already demonstrate the better single-read
strategy.

### 4.4 Use a free-form string capability array

Rejected. A list such as `['quota', 'plugin']` can advertise presence but cannot type the mechanism,
validate required metadata, distinguish unsupported from unavailable, or version acceptance. It
would be a label registry, not a protocol.

### 4.5 Discover adapters dynamically from installed harness plugins

Rejected for v1. Dynamic loading adds trust, packaging, compatibility, and supply-chain boundaries
unrelated to the observed drift. The compiled registry is sufficient to achieve one registration
and adapter-derived consumers. Out-of-tree adapters require a separate security and lifecycle ADR.

## 5. Migration Path

### 5.1 Characterize before moving ownership

Freeze the current seven machine-wide target rows, source keys, public target/source fields,
ordering, cached/live behavior, and per-surface availability/error semantics in characterization
tests. The migration must be behavior-preserving before any protocol expansion.

### 5.2 Add protocol composition alongside legacy fields

Add capability envelope/types, per-protocol validators, adapter builder, and registry query APIs.
Teach all four registered adapters to declare every initial protocol explicitly. During this bridge,
legacy methods delegate to the new capability implementation or vice versa; there must be one
behavior body, not two copies.

Composition tests must fail on:

- missing or duplicate capability declarations;
- duplicate adapter ids/aliases or ambiguous detection precedence;
- `supported` with empty/invalid payload;
- `unsupported` without stable code and reason;
- quota targets that do not resolve through the same adapter's usage-reading capability.

### 5.3 Replace `TARGETS` with adapter-derived quota bindings

Move quota target facts into the four adapters'
`ccm/harness-capability/machine-quota/v1` declarations. Replace every `TARGETS` traversal in live
refresh, cached reads, safe readings, decision projection, surface-specific refresh, and
notification mapping with one derived immutable catalog. Inject that catalog into pure/domain
functions where practical so tests can compose a synthetic registry.

Change the router collector to consume the target's owning adapter binding and call
`UsageReading.readSurface`. Remove `default_collector_harness` and the Cursor surface alias branch
from the consumer. Preserve current external ids and output schemas.

The endpoint acceptance test registers a synthetic fifth adapter with one quota surface and proves,
without editing machine-wide code, that cached status, live refresh, and safe readings all contain
its target. A paired synthetic adapter declaring unsupported must appear in capability inventory but
produce no quota target.

### 5.4 Migrate existing capability consumers by family

After the quota slice is stable, migrate in thin independent slices:

1. `ccm/harness-capability/usage-reading/v1` and current usage-source/surface readers;
2. `ccm/harness-capability/plugin-distribution/v1` and `ccm upgrade`;
3. `ccm/harness-capability/account-pool/v1` and account preflight/location consumers;
4. `ccm/harness-capability/external-statusline/v1` and harness inventory rendering;
5. registry `--harness` enums and coordination-origin validation where their intended domain is
   exactly “registered harnesses”;
6. worker descriptors only after a separate `ccm/harness-capability/worker-runtime/v1` contract
   states invocation, structured result, cancellation, and lifecycle acceptance.

Provider/model policy tables, protocol enums, and compatibility parsers are audited, not blindly
moved. If they remain local, they must state why their domain is intentionally not the adapter
inventory and, where they reference harness ids, have a mechanical referential-integrity check.

### 5.5 Delete bridges and add anti-fork gates

Once all consumers of a family use registry queries, remove the corresponding legacy adapter fields
and compatibility projection. Add:

- a source guard forbidding new exhaustive known-harness lists in migrated consumer areas, with a
  small reviewed allowlist;
- a test that all published capability families have one explicit declaration per adapter;
- mutation/fixture tests showing a synthetic adapter flows through each generic consumer;
- `ccm harness list --json` coverage for supported/unsupported reasons if the public exposure item
  below is approved.

The source guard should target the architectural pattern, not ban every brand literal: brand names
inside adapter implementations, compatibility parsing, fixtures, and declared product policy remain
valid.

## 6. Open Decisions Requiring Sign-off

1. **rc3 cutoff.** Recommendation: make `ccm/harness-capability/machine-quota/v1` plus the
   protocol/guard the required #188 deliverable; migrate existing plugin/account/statusline fields
   if time permits; leave worker runtime to #175 or a follow-up contract. A broader “remove every
   harness-name list in rc3” scope risks conflating adapter facts with provider/model policy.
2. **Public inventory schema.** Recommendation: expose versioned capability states and stable reason
   codes additively in `ccm harness list --json`, while keeping implementation functions private.
   This is user-visible schema growth and needs owner approval before implementation.
3. **Capability module layout.** Recommendation: `harnesses/capabilities/<protocol>.ts` plus a small
   composition/query module, not one large `types.ts`. The ADR fixes the separation and behavior,
   but the exact filenames can remain an implementation-plan choice unless maintainers want them
   contractual.

## 7. Related

- [ADR-031](ADR-031-n-host-capability-parity.md) — N-host parity and Track B Capability Cards.
- [ADR-028](ADR-028-hook-parity-contract-and-normalization.md) — per-hook host-neutral contracts.
- [ADR-014](ADR-014-cli-decoupling-as-independent-product.md) — ccm process boundary and product
  separation.
- [`design_docs/plans/rc3-scope.md`](../design_docs/plans/rc3-scope.md) — rc3 line B and issue #188.
- [`ccm/apps/cli/src/harnesses/types.ts`](../ccm/apps/cli/src/harnesses/types.ts) — current monolithic
  adapter interface and capability booleans.
- [`ccm/apps/cli/src/harnesses/registry.ts`](../ccm/apps/cli/src/harnesses/registry.ts) — current known
  adapter inventory and detection order.
- [`ccm/apps/cli/src/machine-wide-quota.ts`](../ccm/apps/cli/src/machine-wide-quota.ts) — current
  parallel `TARGETS` inventory.
- [`ccm/apps/cli/src/router.ts`](../ccm/apps/cli/src/router.ts) — existing unified machine-wide
  collector through `UsageReading`.
- [`ccm/apps/cli/src/usage-reading.ts`](../ccm/apps/cli/src/usage-reading.ts) — current single usage
  read strategy.

## 8. References

- `harness-plugin-architecture` project skill, especially `references/n-host-capability-parity.md`.
- Issue #188 acceptance statement in `design_docs/plans/rc3-scope.md`.
