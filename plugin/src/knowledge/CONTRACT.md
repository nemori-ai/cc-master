# Skill knowledge source root

> Status: **K1 pilot — three modules / authored query surface**
>
> This directory is an authored maintainer source root, not runtime prose and not a distributed
> knowledge claim beyond the admitted pilot inventory.

Source layout:

```text
plugin/src/knowledge/
├── CONTRACT.md
├── portfolio.json
└── skills/master-orchestrator-guide/
    ├── skill.json
    └── modules/
        ├── verification.endpoint.json
        ├── conduct.never-play.json
        └── routing.worker-chain.json
```

K1 pilot admits **one** runtime skill (`master-orchestrator-guide`) with **three** modules and
**8–12** points bound to real canonical Markdown markers. JSON holds identity / authority /
routing / inventory metadata only — exact HOW remains in Markdown spans (no second SSOT).

Executable entry points:

```bash
node scripts/skill-knowledge.mjs check --stage K1 --json
node scripts/skill-knowledge.mjs report --json
node scripts/skill-knowledge.mjs path --from <id> --to <id> --host claude-code --json
node scripts/skill-knowledge.mjs explain <id-or-code> --json
```

Implemented capabilities (see `contract --json`): schema validation, markdown binding, canonical
source inventory attestation, derived authority freshness, graph invariants, entry-surface
binding, authored-plane hop analysis, semantic coverage over the admitted pilot inventory,
canonical graph hash, budget estimator.

K1-03 已交付 standalone Draft 2020-12 validators、source loader、canonical/span hash、budget
estimator、marker/source-map 与 inventory attestation 模块；`contract --json` 中对应 capability
为 `true`。生成物携带 source schema SHA-256 fingerprint 与三份 emitted CJS bundle 的
SHA-256（`validators/schema-manifest.json`）；`validatorsAvailable()` / `check` 在 schema
bytes 或 bundle bytes 漂移时 fail closed（不加载被篡改的 validator），并提供
`generate-validators.mjs --check` 做无副作用 CI 门。

K1-04 四 host fixture probe + frozen adapter contract 已落地：`host_portability_probe`
capability=`true`。但 `check --host` CLI 集成尚未接通，带 `--host`/`--base` 的调用与
`report --host` 一样继续 exit 10——probe 模块已交付不等于 CLI flag 已接线。

K1 typed change transaction 已交付：`change begin → validate → apply` 在 ignored candidate
workspace 冻结 scope/base/hash、验证九类 closed operation，并在 rollback-safe atomic publication
后追加 immutable ledger；`typed_change_transactions=true`。

Still declared-unavailable (exit 10): `compile`, `check --host|--base`, `report --host`.
Do not treat authored-plane `path` results as final-host H1–H4 proof.

Normative contracts:

- `design_docs/skill-knowledge-graph/specification.md`
- `design_docs/skill-knowledge-graph/schemas/knowledge-source.schema.json`
- `design_docs/skill-knowledge-graph/schemas/knowledge-change.schema.json`
- `design_docs/skill-knowledge-graph/schemas/knowledge-cli-output.schema.json`
- `design_docs/skill-knowledge-graph/cli-contract.md`
