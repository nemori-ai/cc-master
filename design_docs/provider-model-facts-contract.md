# Provider model facts query contract v1

Status: implementation contract

## Intent and ownership

`ccm provider facts <provider> --json` is the machine-readable single source for volatile model
catalog, availability, price, benchmark, and freshness facts consumed by cc-master runtime skills.
Skills retain stable task-difficulty and tier-allocation judgment; they must not maintain a second
model catalog.

The command is read-only and performs no provider request. It returns the bundled, official-source
snapshot for exactly one provider and computes freshness at read time. Live entitlement, account
quota, and exact-model admission remain separate provider/admission facts and default to unknown.

Supported provider IDs are `claude-code`, `codex`, and `cursor`.

## Output envelope

The JSON response uses the normal `{ok:true,data}` envelope. `data` has schema
`ccm/provider-model-facts/v1` and always carries:

- `provider`, `revision`, `supported_surfaces`, and `supported_client_versions`;
- `source[]` with stable source IDs, official HTTPS URLs, and `retrieved_at`;
- `observed_at`, `valid_until`, computed `as_of`, and computed `freshness`;
- `account_scope`, `confidence`, and an explicit `unknown[]` list;
- `models[]`, whose entries bind model ID, display name, stable tier classification, source refs,
  availability scope, price/benchmark facts when known, and `supersedes[]`;
- `catalog_eligible_for_admission_check`, which is true only for a fresh structurally valid
  snapshot;
- `eligible_for_automatic_selection` and `automatic_selection_blockers[]`; the bundled catalog
  alone never proves selection eligibility while live entitlement/admission remains unknown;
- zeroed `side_effects` (`provider_requests`, `account_mutations`, `credential_writes`,
  `board_writes`).

`--as-of <RFC3339>` exists for deterministic replay. Before `observed_at` the snapshot is
`future-invalid`; after `valid_until` it is `hard-stale`. Both are ineligible even for an admission
check but remain observable with exit 0 so callers can explain the denial. A fresh catalog only
admits the next live-admission check; it does not by itself authorize dispatch.

## Fail-closed invariants

Registry validation rejects:

1. missing or non-official source provenance;
2. `observed_at > valid_until`, or an observation in the future at verification/projection time;
3. unknown source refs, duplicate model IDs, or missing account scope/confidence/unknown fields;
4. a conditional/account-local model represented as globally available;
5. a model that both appears as current and is superseded by another current entry;
6. absent/expired evidence at plugin projection time.

Projection attestation hashes final runtime payloads for `pacing-and-estimation`,
`master-orchestrator-guide`, and `using-ccm` on all three hosts. Hash integrity does not replace the
freshness validation above; both gates must pass before an affected skill tree is published.
