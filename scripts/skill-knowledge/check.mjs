import fs from 'node:fs';
import path from 'node:path';
import {
  CAPABILITIES,
  CHANGE_SCHEMA_VERSION,
  CONTRACT_VERSION,
  DEFAULT_SOURCE_ROOT,
  OUTPUT_SCHEMA,
  SCHEMAS,
  SOURCE_SCHEMA_VERSION,
} from './contracts.mjs';
import { diagnostic, outputDiagnostic, selectExitCode } from './diagnostics.mjs';
import {
  validateAuthoredDocument,
  validatorFreshness,
  validatorsAvailable,
} from './schema.mjs';

const SOURCE_KINDS = new Set(['portfolio', 'skill', 'module']);
const STAGES = new Set(['K0', 'K1', 'K2', 'K3']);
const ID_PATTERNS = Object.freeze({
  portfolio: /^portfolio:[a-z0-9][a-z0-9.-]*$/,
  skill: /^skill:[a-z0-9][a-z0-9.-]*$/,
  module: /^module:[a-z0-9][a-z0-9.-]*$/,
  change: /^change:[0-9]{8}\.[a-z0-9][a-z0-9.-]*$/,
});

function walkJsonFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(target);
    }
  };
  visit(root);
  return files;
}

function displayPath(repoRoot, target) {
  const relative = path.relative(repoRoot, target);
  if (relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..') {
    return relative.split(path.sep).join('/');
  }
  return path.resolve(target);
}

function validateSchemaAssets(repoRoot, diagnostics) {
  for (const schemaPath of [SCHEMAS.source, SCHEMAS.change, SCHEMAS.output]) {
    const absolute = path.join(repoRoot, schemaPath);
    if (!fs.existsSync(absolute)) {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'SKG-CONTRACT-SCHEMA-MISSING',
          message: `Normative schema is missing: ${schemaPath}`,
          location: schemaPath,
          witness: { schema: schemaPath },
          remediation: 'Restore the tracked schema before checking authored knowledge.',
          exitCode: 3,
        }),
      );
      continue;
    }
    try {
      JSON.parse(fs.readFileSync(absolute, 'utf8'));
    } catch (error) {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'SKG-CONTRACT-SCHEMA-PARSE',
          message: `Normative schema is not valid JSON: ${schemaPath}`,
          location: schemaPath,
          witness: { schema: schemaPath, parse_error: error.message },
          remediation: 'Repair the schema JSON before checking authored knowledge.',
          exitCode: 3,
        }),
      );
    }
  }
}

function validateEnvelope(document, location, diagnostics) {
  if (document === null || Array.isArray(document) || typeof document !== 'object') {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'SKG-SOURCE-ENVELOPE',
        message: 'Authored knowledge document must be a JSON object.',
        location,
        witness: { actual_type: Array.isArray(document) ? 'array' : typeof document },
        remediation: 'Use a portfolio, skill, module, or change object from the normative schema.',
        exitCode: 3,
      }),
    );
    return null;
  }

  const expectedVersion =
    document.kind === 'change' ? CHANGE_SCHEMA_VERSION : SOURCE_SCHEMA_VERSION;
  const idField = document.kind === 'change' ? 'change_id' : 'id';
  const errors = [];
  if (![...SOURCE_KINDS, 'change'].includes(document.kind)) errors.push('kind');
  if (document.schema_version !== expectedVersion) errors.push('schema_version');
  if (
    typeof document[idField] !== 'string' ||
    !ID_PATTERNS[document.kind]?.test(document[idField])
  ) {
    errors.push(idField);
  }

  if (errors.length > 0) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'SKG-SOURCE-ENVELOPE',
        message: `Authored knowledge envelope is missing or has invalid fields: ${errors.join(', ')}`,
        location,
        witness: {
          invalid_fields: errors,
          kind: document.kind ?? null,
          schema_version: document.schema_version ?? null,
        },
        remediation: 'Match the kind, schema_version, and top-level identity contract.',
        exitCode: 3,
      }),
    );
    return null;
  }
  return { id: document[idField], kind: document.kind };
}

export function runCheck({ repoRoot, source = DEFAULT_SOURCE_ROOT, stage = 'K0' }) {
  if (!STAGES.has(stage)) {
    return {
      exitCode: 2,
      body: {
        schema: OUTPUT_SCHEMA,
        ok: false,
        command: 'check',
        result_kind: 'diagnostic',
        contract_version: CONTRACT_VERSION,
        diagnostics: [
          outputDiagnostic(
            diagnostic({
              severity: 'error',
              code: 'SKG-USAGE',
              message: `Unknown rollout stage: ${stage}`,
              location: 'argv',
              witness: { stage, allowed: [...STAGES] },
              remediation: 'Use one of K0, K1, K2, or K3.',
              exitCode: 2,
            }),
          ),
        ],
      },
    };
  }

  const sourceAbsolute = path.isAbsolute(source) ? source : path.join(repoRoot, source);
  const sourceRoot = displayPath(repoRoot, sourceAbsolute);
  const diagnostics = [];
  validateSchemaAssets(repoRoot, diagnostics);

  if (!fs.existsSync(sourceAbsolute) || !fs.statSync(sourceAbsolute).isDirectory()) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'SKG-SOURCE-ROOT-MISSING',
        message: `Knowledge source root is missing or not a directory: ${sourceRoot}`,
        location: sourceRoot,
        witness: { source_root: sourceRoot },
        remediation: 'Create the source root contract or pass --source <directory>.',
        exitCode: 3,
      }),
    );
  }

  const counts = { portfolio: 0, skill: 0, module: 0, change: 0 };
  const identities = new Map();
  let documents = 0;
  const files =
    fs.existsSync(sourceAbsolute) && fs.statSync(sourceAbsolute).isDirectory()
      ? walkJsonFiles(sourceAbsolute)
      : [];

  for (const file of files) {
    const location = displayPath(repoRoot, file);
    let document;
    try {
      document = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'SKG-SOURCE-JSON-PARSE',
          message: `Authored knowledge file is not valid JSON: ${location}`,
          location,
          witness: { parse_error: error.message },
          remediation: 'Repair the file as valid JSON before rerunning the check.',
          exitCode: 3,
        }),
      );
      continue;
    }

    const envelope = validateEnvelope(document, location, diagnostics);
    if (!envelope) continue;

    if (stage !== 'K0' && validatorsAvailable()) {
      const schemaResult = validateAuthoredDocument(
        document,
        envelope.kind === 'change' ? 'change' : 'source',
      );
      if (!schemaResult.ok) {
        diagnostics.push(
          diagnostic({
            severity: 'error',
            code: 'SKG-SCHEMA-INVALID',
            message: `Authored knowledge failed Draft 2020-12 schema validation: ${location}`,
            location,
            witness: {
              kind: envelope.kind,
              errors: schemaResult.errors.slice(0, 8),
              stage,
            },
            remediation:
              'Align the document with the normative knowledge schema; envelope checks are not full validation.',
            exitCode: 3,
          }),
        );
      }
    }

    documents += 1;
    counts[envelope.kind] += 1;
    const locations = identities.get(envelope.id) ?? [];
    locations.push(location);
    identities.set(envelope.id, locations);
  }

  if (documents === 0) {
    diagnostics.push(
      diagnostic({
        severity: stage === 'K0' ? 'debt' : 'error',
        code: 'SKG-COVERAGE-EMPTY',
        message:
          stage === 'K0'
            ? 'K0 source root has no authored knowledge inventory yet.'
            : `${stage} requires a non-empty authored knowledge inventory.`,
        location: sourceRoot,
        witness: { documents: 0, stage },
        remediation:
          stage === 'K0'
            ? 'Start the admitted K1 pilot; do not create an empty portfolio that claims coverage.'
            : 'Add an admitted portfolio/skill/module pilot before enforcing this rollout stage.',
        exitCode: stage === 'K0' ? 0 : 4,
      }),
    );
  }

  // Capability is executable only while committed standalone validators match source schema
  // bytes. K0 stays envelope-only but still reports debt when validators are missing/stale.
  // K1+ always fails loud (even with an empty inventory) so drift cannot silent-pass.
  // SKG_SCHEMA_REPO_ROOT lets integrity probes inject an isolated schema fixture without
  // mutating checked-in design_docs schemas (production leaves the env unset).
  const freshnessRoot =
    typeof process.env.SKG_SCHEMA_REPO_ROOT === 'string' && process.env.SKG_SCHEMA_REPO_ROOT.length > 0
      ? path.resolve(process.env.SKG_SCHEMA_REPO_ROOT)
      : repoRoot;
  const freshness = validatorFreshness(freshnessRoot);
  if (!freshness.available) {
    const stale = freshness.reason === 'stale';
    diagnostics.push(
      diagnostic({
        severity: stage === 'K0' ? 'debt' : 'error',
        code: stale ? 'SKG-SCHEMA-VALIDATOR-STALE' : 'SKG-SCHEMA-VALIDATOR-UNAVAILABLE',
        message: stale
          ? 'Committed standalone validators are stale relative to source schema bytes.'
          : stage === 'K0'
            ? 'Full JSON Schema instance validation is declared but not executable in K0.'
            : `${stage} cannot pass until the committed standalone schema validator is implemented.`,
        location: SCHEMAS.source,
        witness: {
          full_json_schema_validation: false,
          envelope_validation: true,
          stage,
          reason: freshness.reason,
          committed_fingerprint: freshness.committed?.fingerprint ?? null,
          current_fingerprint: freshness.current?.fingerprint ?? null,
        },
        remediation: stale
          ? 'Regenerate validators with node scripts/skill-knowledge/generate-validators.mjs and commit schema-manifest.json.'
          : 'Generate and commit the standalone Draft 2020-12 validator; do not equate envelope checks with schema validation.',
        exitCode: stage === 'K0' ? 0 : 10,
      }),
    );
  }

  for (const [id, locations] of [...identities.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (locations.length < 2) continue;
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'SKG-ID-DUPLICATE',
        message: `Global knowledge identity is declared more than once: ${id}`,
        location: locations[0],
        witness: { id, locations },
        remediation: 'Keep one active owner or use a typed split/merge/authority relationship.',
        exitCode: 4,
      }),
    );
  }

  const exitCode = selectExitCode(diagnostics);
  const publicDiagnostics = diagnostics.map(outputDiagnostic);
  const summary = {
    documents,
    ...counts,
    errors: publicDiagnostics.filter((item) => item.severity === 'error').length,
    debts: publicDiagnostics.filter((item) => item.severity === 'debt').length,
  };

  return {
    exitCode,
    body: {
      schema: OUTPUT_SCHEMA,
      ok: exitCode === 0,
      command: 'check',
      result_kind: 'check',
      contract_version: CONTRACT_VERSION,
      stage,
      source_root: sourceRoot,
      summary,
      capabilities: { ...CAPABILITIES },
      diagnostics: publicDiagnostics,
    },
  };
}
