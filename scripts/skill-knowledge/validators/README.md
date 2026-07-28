# Standalone Draft 2020-12 validators

Bundled Ajv validators for clean-clone checks without runtime `npm install`.

| File | Schema |
|---|---|
| `validate-source.cjs` | `knowledge-source.schema.json` |
| `validate-change.cjs` | `knowledge-change.schema.json` |
| `validate-output.cjs` | `knowledge-cli-output.schema.json` |
| `schema-manifest.json` | SHA-256 digests of the three source schemas + combined fingerprint + SHA-256 of each emitted `*.cjs` bundle |

`schema-manifest.json` is the freshness gate: `validatorsAvailable()` / `check` re-hash the
current schema files and the three emitted bundles, and refuse to treat validators as
available when either side drifts. Bundle digests are written only after the exact CJS
bytes are on disk. Each generated `*.cjs` banner also records its source-schema SHA-256
and the combined fingerprint for human inspection.

Regenerate after schema edits:

```bash
node scripts/skill-knowledge/generate-validators.mjs
```

CI / preflight drift check (side-effect-free; nonzero exit on drift):

```bash
node scripts/skill-knowledge/generate-validators.mjs --check
```

Do not hand-edit these files.
