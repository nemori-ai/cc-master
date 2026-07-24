# Skill knowledge source root

> Status: **K2 — eight runtime skills / full portfolio inventory + four-host compile**
>
> This directory is an authored maintainer source root, not runtime prose. Inventory claims
> must match `portfolio.json` + per-skill shards; do not cite the old three-module pilot as live truth.

Source layout:

```text
plugin/src/knowledge/
├── CONTRACT.md
├── portfolio.json
└── skills/
    ├── master-orchestrator-guide/
    ├── authoring-workflows/
    ├── engineering-with-craft/
    ├── using-ccm/
    ├── dev-as-ml-loop/
    ├── slicing-goals-into-dags/
    ├── pacing-and-estimation/
    └── distilling-lessons-into-assets/
```

K2 admits **all eight** runtime skills under `portfolio.skills`, with module/point shards bound to
real canonical Markdown markers. JSON holds identity / authority / routing / inventory metadata
only — exact HOW remains in Markdown spans (no second SSOT). Host honesty stays in each skill's
`host_coverage` (including workflow stubs and using-ccm / master-orchestrator partial hosts).

Executable entry points:

```bash
node scripts/skill-knowledge.mjs check --stage K2 --json
node scripts/skill-knowledge.mjs compile --json
node scripts/skill-knowledge.mjs compile --check --json
node scripts/skill-knowledge.mjs change begin --op <op> --scope <path...> --base <git-ref> --json
node scripts/skill-knowledge.mjs change validate <workspace> --json
node scripts/skill-knowledge.mjs change apply <workspace> --json
node scripts/skill-knowledge.mjs report --json
node scripts/skill-knowledge.mjs path --from <id> --to <id> --host claude-code --json
node scripts/skill-knowledge.mjs explain <id-or-code> --json
```

Implemented capabilities (see `contract --json`): schema validation, markdown binding, canonical
source inventory attestation, derived authority freshness, graph invariants, entry-surface
binding, authored-plane hop analysis, semantic coverage over the admitted portfolio inventory,
canonical graph hash, budget estimator, four-host fixture probe, **runtime projection**
(`compile` + final surface verifier; `runtime_projection=true`), and **typed change transactions**
(`change begin → validate → apply`; `typed_change_transactions=true`).

Standalone Draft 2020-12 validators、source loader、canonical/span hash、budget estimator、
marker/source-map 与 inventory attestation 模块已交付；`contract --json` 中对应 capability
为 `true`。生成物携带 source schema SHA-256 fingerprint 与三份 emitted CJS bundle 的
SHA-256（`validators/schema-manifest.json`）；`validatorsAvailable()` / `check` 在 schema
bytes 或 bundle bytes 漂移时 fail closed（不加载被篡改的 validator），并提供
`generate-validators.mjs --check` 做无副作用 CI 门。

四 host fixture probe + frozen adapter contract 已落地：`host_portability_probe`
capability=`true`。但 `check --host` CLI 集成尚未接通，带 `--host`/`--base` 的调用与
`report --host` 一样继续 exit 10——probe 模块已交付不等于 CLI flag 已接线。

四 host `compile` + final surface verifier 已落地：`runtime_projection=true`。`compile`
从本目录 portfolio source 经现有 SAP 投影写入 `plugin/dist/<host>/knowledge/` 与 skill nav/anchors，
并只把真实可解析相对 link/anchor 计为 runtime 边；H1–H4 与 budget 带 witness/remediation。

Typed change transaction 已交付：`change begin → validate → apply` 在 ignored candidate
workspace 冻结 scope/base/hash、验证九类 closed operation，并在 rollback-safe atomic publication
后追加 immutable ledger；`typed_change_transactions=true`。

Still declared-unavailable (exit 10): `check --host|--base`, `report --host`.
Authored-plane `path` remains distinct from final-host H1–H4 proof (use `compile` for the latter).

Normative contracts:

- `design_docs/skill-knowledge-graph/specification.md`
- `design_docs/skill-knowledge-graph/schemas/knowledge-source.schema.json`
- `design_docs/skill-knowledge-graph/schemas/knowledge-change.schema.json`
- `design_docs/skill-knowledge-graph/schemas/knowledge-cli-output.schema.json`
- `design_docs/skill-knowledge-graph/cli-contract.md`
