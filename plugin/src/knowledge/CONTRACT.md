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
binding, authored-plane hop analysis, canonical graph hash, budget estimator.

Still declared-unavailable (exit 10): `compile`, `change`, `check --host|--base`, `report --host`.
Do not treat authored-plane `path` results as final-host H1–H4 proof.

Normative contracts:

- `design_docs/skill-knowledge-graph/specification.md`
- `design_docs/skill-knowledge-graph/schemas/knowledge-source.schema.json`
- `design_docs/skill-knowledge-graph/schemas/knowledge-change.schema.json`
- `design_docs/skill-knowledge-graph/schemas/knowledge-cli-output.schema.json`
- `design_docs/skill-knowledge-graph/cli-contract.md`
