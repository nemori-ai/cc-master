import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMAS } from './contracts.mjs';

export const SCHEMA_FINGERPRINT_ALGORITHM =
  'cc-master/skill-knowledge-schema-fingerprint/v1';

export const SCHEMA_FILE_NAMES = Object.freeze([
  'knowledge-source.schema.json',
  'knowledge-change.schema.json',
  'knowledge-cli-output.schema.json',
]);

export const VALIDATOR_BUNDLE_NAMES = Object.freeze([
  'validate-source.cjs',
  'validate-change.cjs',
  'validate-output.cjs',
]);

const SCHEMA_RELATIVE_PATHS = Object.freeze([
  SCHEMAS.source,
  SCHEMAS.change,
  SCHEMAS.output,
]);

export function schemaAbsolutePaths(repoRoot) {
  return SCHEMA_RELATIVE_PATHS.map((relative) => path.join(repoRoot, relative));
}

export function sha256File(absolutePath) {
  const bytes = fs.readFileSync(absolutePath);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * Deterministic fingerprint over exact source schema bytes.
 * Map keys are basename; values are lowercase hex SHA-256 of file bytes.
 * Combined fingerprint hashes the canonical JSON of that map.
 */
export function computeSchemaManifest(repoRoot) {
  const schemas = {};
  for (let index = 0; index < SCHEMA_FILE_NAMES.length; index += 1) {
    const name = SCHEMA_FILE_NAMES[index];
    const absolute = path.join(repoRoot, SCHEMA_RELATIVE_PATHS[index]);
    schemas[name] = sha256File(absolute);
  }
  const canonical = JSON.stringify({
    algorithm: SCHEMA_FINGERPRINT_ALGORITHM,
    schemas,
  });
  return {
    algorithm: SCHEMA_FINGERPRINT_ALGORITHM,
    schemas,
    fingerprint: crypto.createHash('sha256').update(canonical, 'utf8').digest('hex'),
  };
}

/**
 * SHA-256 digests of the three emitted standalone validator bundles.
 * Digests are over exact on-disk bytes after generation.
 */
export function computeBundleDigests(validatorsDir) {
  const bundles = {};
  for (const name of VALIDATOR_BUNDLE_NAMES) {
    const absolute = path.join(validatorsDir, name);
    if (!fs.existsSync(absolute)) {
      bundles[name] = null;
      continue;
    }
    bundles[name] = sha256File(absolute);
  }
  return bundles;
}

/**
 * Full committed manifest: schema fingerprints + emitted bundle digests.
 * Call only after the three CJS bundles exist with their final bytes.
 */
export function buildCommittedManifest(repoRoot, validatorsDir) {
  return {
    ...computeSchemaManifest(repoRoot),
    bundles: computeBundleDigests(validatorsDir),
  };
}

export function schemaFingerprint(repoRoot) {
  return computeSchemaManifest(repoRoot).fingerprint;
}

export function committedManifestPath(validatorsDir) {
  return path.join(validatorsDir, 'schema-manifest.json');
}

export function readCommittedSchemaManifest(validatorsDir) {
  const manifestPath = committedManifestPath(validatorsDir);
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * True only when committed manifest matches current schema fingerprints
 * and current emitted validator-bundle bytes.
 */
export function schemasMatchCommittedValidators(repoRoot, validatorsDir) {
  const committed = readCommittedSchemaManifest(validatorsDir);
  if (!committed || typeof committed.fingerprint !== 'string') return false;
  if (committed.algorithm !== SCHEMA_FINGERPRINT_ALGORITHM) return false;
  const current = computeSchemaManifest(repoRoot);
  if (committed.fingerprint !== current.fingerprint) return false;
  for (const name of SCHEMA_FILE_NAMES) {
    if (committed.schemas?.[name] !== current.schemas[name]) return false;
  }
  const currentBundles = computeBundleDigests(validatorsDir);
  for (const name of VALIDATOR_BUNDLE_NAMES) {
    const expected = committed.bundles?.[name];
    const actual = currentBundles[name];
    if (typeof expected !== 'string' || expected.length !== 64) return false;
    if (typeof actual !== 'string' || actual !== expected) return false;
  }
  return true;
}
