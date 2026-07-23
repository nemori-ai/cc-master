#!/usr/bin/env node
/**
 * Dev-only generator for committed standalone Draft 2020-12 validators.
 * Requires a temporary npm install of ajv + ajv-formats + esbuild (not a runtime dependency).
 *
 * Usage from repo root:
 *   node scripts/skill-knowledge/generate-validators.mjs
 *   node scripts/skill-knowledge/generate-validators.mjs --check
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCHEMA_FILE_NAMES,
  VALIDATOR_BUNDLE_NAMES,
  buildCommittedManifest,
  computeSchemaManifest,
  committedManifestPath,
  readCommittedSchemaManifest,
  schemasMatchCommittedValidators,
} from './schema-fingerprint.mjs';

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const checkOnly = process.argv.includes('--check');

function fail(message, exitCode = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(exitCode);
}

/**
 * Production default: repository root that owns design_docs/skill-knowledge-graph/schemas.
 * Tests may inject an isolated schema fixture via --repo-root or SKG_SCHEMA_REPO_ROOT.
 */
function resolveSchemaRepoRoot() {
  const flagIndex = process.argv.indexOf('--repo-root');
  if (flagIndex !== -1) {
    const value = process.argv[flagIndex + 1];
    if (!value || value.startsWith('-')) {
      fail('generate-validators: --repo-root requires a path argument');
    }
    return path.resolve(value);
  }
  if (typeof process.env.SKG_SCHEMA_REPO_ROOT === 'string' && process.env.SKG_SCHEMA_REPO_ROOT.length > 0) {
    return path.resolve(process.env.SKG_SCHEMA_REPO_ROOT);
  }
  return defaultRepoRoot;
}

/**
 * Production default: scripts/skill-knowledge/validators.
 * Tests may inject an isolated copy via --validators-dir or SKG_VALIDATORS_DIR.
 */
function resolveOutDir(repoRoot) {
  const flagIndex = process.argv.indexOf('--validators-dir');
  if (flagIndex !== -1) {
    const value = process.argv[flagIndex + 1];
    if (!value || value.startsWith('-')) {
      fail('generate-validators: --validators-dir requires a path argument');
    }
    return path.resolve(value);
  }
  if (typeof process.env.SKG_VALIDATORS_DIR === 'string' && process.env.SKG_VALIDATORS_DIR.length > 0) {
    return path.resolve(process.env.SKG_VALIDATORS_DIR);
  }
  return path.join(repoRoot, 'scripts/skill-knowledge/validators');
}

const repoRoot = resolveSchemaRepoRoot();
const schemaDir = path.join(repoRoot, 'design_docs/skill-knowledge-graph/schemas');
const outDir = resolveOutDir(defaultRepoRoot);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: options.stdio ?? 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
  }
  return result;
}

function assertValidatorFilesPresent() {
  for (const name of [...VALIDATOR_BUNDLE_NAMES, 'schema-manifest.json']) {
    if (!fs.existsSync(path.join(outDir, name))) {
      return false;
    }
  }
  return true;
}

if (checkOnly) {
  // Side-effect-free: compare committed manifest to current schema + bundle bytes.
  if (!assertValidatorFilesPresent()) {
    fail(
      'generate-validators --check: missing committed validator bundle or schema-manifest.json',
    );
  }
  const committed = readCommittedSchemaManifest(outDir);
  const current = computeSchemaManifest(repoRoot);
  if (!schemasMatchCommittedValidators(repoRoot, outDir)) {
    fail(
      [
        'generate-validators --check: schema fingerprint or emitted bundle digests drifted.',
        `committed fingerprint: ${committed?.fingerprint ?? '(missing)'}`,
        `current fingerprint:    ${current.fingerprint}`,
        'Regenerate with: node scripts/skill-knowledge/generate-validators.mjs',
      ].join('\n'),
    );
  }
  process.stdout.write(
    `generate-validators --check: OK (fingerprint ${current.fingerprint})\n`,
  );
  process.exit(0);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-ajv-gen-'));
const schemaManifest = computeSchemaManifest(repoRoot);

fs.writeFileSync(path.join(workDir, 'package.json'), `${JSON.stringify({ private: true }, null, 2)}\n`);
run('npm', ['install', 'ajv@8.20.0', 'ajv-formats@3.0.1', 'esbuild@0.28.1', '--no-fund', '--no-audit'], {
  cwd: workDir,
});

const generator = `
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import addFormats from 'ajv-formats';
import * as esbuild from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const schemaDir = ${JSON.stringify(schemaDir)};
const outDir = ${JSON.stringify(outDir)};
const schemaManifest = ${JSON.stringify(schemaManifest, null, 2)};
const bundleNames = ${JSON.stringify([...VALIDATOR_BUNDLE_NAMES])};
const rawDir = path.join(process.cwd(), 'raw');
fs.mkdirSync(rawDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const schemas = [
  ['knowledge-source.schema.json', 'validate-source.cjs'],
  ['knowledge-change.schema.json', 'validate-change.cjs'],
  ['knowledge-cli-output.schema.json', 'validate-output.cjs'],
];

for (const [schemaName, outName] of schemas) {
  const schema = JSON.parse(fs.readFileSync(path.join(schemaDir, schemaName), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false, code: { source: true } });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const code = standaloneCode(ajv, validate);
  const rawPath = path.join(rawDir, outName);
  fs.writeFileSync(rawPath, code);
  const schemaSha = schemaManifest.schemas[schemaName];
  await esbuild.build({
    entryPoints: [rawPath],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(outDir, outName),
    banner: {
      js: [
        '/**',
        ' * Generated standalone Draft 2020-12 validator (bundled).',
        ' * Source: design_docs/skill-knowledge-graph/schemas/' + schemaName,
        ' * Source-schema-sha256: ' + schemaSha,
        ' * Schema-fingerprint: ' + schemaManifest.fingerprint,
        ' * Regenerate: node scripts/skill-knowledge/generate-validators.mjs',
        ' */',
      ].join('\\n'),
    },
  });
  console.log('wrote', outName);
}

// Digest exact emitted bytes after write, then record them in the committed manifest.
const bundles = {};
for (const outName of bundleNames) {
  const bytes = fs.readFileSync(path.join(outDir, outName));
  bundles[outName] = crypto.createHash('sha256').update(bytes).digest('hex');
}
const manifest = { ...schemaManifest, bundles };
fs.writeFileSync(
  path.join(outDir, 'schema-manifest.json'),
  JSON.stringify(manifest, null, 2) + '\\n',
);
console.log('wrote schema-manifest.json', manifest.fingerprint);
`;

fs.writeFileSync(path.join(workDir, 'generate.mjs'), generator);
run(process.execPath, ['generate.mjs'], { cwd: workDir });
fs.rmSync(workDir, { recursive: true, force: true });

const committed = buildCommittedManifest(repoRoot, outDir);
if (!schemasMatchCommittedValidators(repoRoot, outDir)) {
  fail('Generator finished but schema-manifest does not match current schemas/bundles');
}
if (!SCHEMA_FILE_NAMES.every((name) => committed.schemas[name])) {
  fail('Generator manifest missing schema digests');
}
if (!VALIDATOR_BUNDLE_NAMES.every((name) => committed.bundles[name])) {
  fail('Generator manifest missing emitted bundle digests');
}
if (!fs.existsSync(committedManifestPath(outDir))) {
  fail('schema-manifest.json was not written');
}

console.log('Standalone validators regenerated under scripts/skill-knowledge/validators/');
console.log(`schema fingerprint: ${committed.fingerprint}`);
