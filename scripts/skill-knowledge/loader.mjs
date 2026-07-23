import fs from 'node:fs';
import path from 'node:path';
import { diagnostic } from './diagnostics.mjs';
import { compareCodePoint } from './hash.mjs';
import { validateAuthoredDocument, validatorsAvailable } from './schema.mjs';

function walkJsonFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      compareCodePoint(a.name, b.name),
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

function kindHintForDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return 'source';
  if (
    document.kind === 'change' ||
    document.kind === 'change_workspace' ||
    document.kind === 'change_validation'
  ) {
    return 'change';
  }
  return 'source';
}

/**
 * Load authored knowledge JSON into an IR-friendly structure with deterministic diagnostics.
 */
export function loadKnowledgeSource({ repoRoot, sourceRoot }) {
  const absolute = path.isAbsolute(sourceRoot) ? sourceRoot : path.join(repoRoot, sourceRoot);
  const diagnostics = [];
  const documents = [];

  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'SKG-SOURCE-ROOT-MISSING',
        message: `Knowledge source root is missing or not a directory: ${displayPath(repoRoot, absolute)}`,
        location: displayPath(repoRoot, absolute),
        witness: { source_root: displayPath(repoRoot, absolute) },
        remediation: 'Create the source root contract or pass --source <directory>.',
        exitCode: 3,
      }),
    );
    return { ok: false, source_root: displayPath(repoRoot, absolute), documents, diagnostics };
  }

  if (!validatorsAvailable()) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'SKG-SCHEMA-VALIDATOR-UNAVAILABLE',
        message: 'Committed standalone Draft 2020-12 validators are missing or failed to load.',
        location: 'scripts/skill-knowledge/validators',
        witness: { full_json_schema_validation: false },
        remediation:
          'Regenerate and commit validators with node scripts/skill-knowledge/generate-validators.mjs.',
        exitCode: 10,
      }),
    );
  }

  for (const file of walkJsonFiles(absolute)) {
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

    const hint = kindHintForDocument(document);
    const schemaResult = validatorsAvailable()
      ? validateAuthoredDocument(document, hint)
      : { ok: false, errors: [] };

    if (validatorsAvailable() && !schemaResult.ok) {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'SKG-SCHEMA-INVALID',
          message: `Authored knowledge failed Draft 2020-12 schema validation: ${location}`,
          location,
          witness: {
            kind: document?.kind ?? null,
            errors: schemaResult.errors.slice(0, 8),
          },
          remediation: 'Align the document with the normative knowledge schema before continuing.',
          exitCode: 3,
        }),
      );
    }

    documents.push({
      path: location,
      kind: typeof document?.kind === 'string' ? document.kind : null,
      id:
        typeof document?.id === 'string'
          ? document.id
          : typeof document?.change_id === 'string'
            ? document.change_id
            : null,
      data: document,
      schema_ok: validatorsAvailable() ? schemaResult.ok : false,
    });
  }

  documents.sort((left, right) => compareCodePoint(left.path, right.path));
  const ok = diagnostics.every((item) => item.severity !== 'error');
  return {
    ok,
    source_root: displayPath(repoRoot, absolute),
    documents,
    diagnostics,
  };
}
