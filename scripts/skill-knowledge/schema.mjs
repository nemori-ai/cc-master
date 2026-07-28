/**
 * Generated standalone Draft 2020-12 validators (bundled, zero runtime npm deps).
 * Regenerate with: node scripts/skill-knowledge/generate-validators.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeSchemaManifest,
  readCommittedSchemaManifest,
  schemaFingerprint as fingerprintOf,
  schemasMatchCommittedValidators as schemasMatch,
} from './schema-fingerprint.mjs';

const require = createRequire(import.meta.url);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultValidatorsDir = path.join(moduleDir, 'validators');
const defaultRepoRoot = path.resolve(moduleDir, '../..');

let sourceValidator = null;
let changeValidator = null;
let outputValidator = null;
let loadError = null;
let loadAttempted = false;
let loadedValidatorsDir = null;
let loadedSchemaRoot = null;

/**
 * Resolve the committed validator bundle directory.
 * Production default is scripts/skill-knowledge/validators next to this module.
 * Tests may inject via options.validatorsDir or SKG_VALIDATORS_DIR (subprocess only).
 */
export function resolveValidatorsDir(validatorsDirOverride) {
  if (typeof validatorsDirOverride === 'string' && validatorsDirOverride.length > 0) {
    return path.resolve(validatorsDirOverride);
  }
  const fromEnv = process.env.SKG_VALIDATORS_DIR;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return path.resolve(fromEnv);
  }
  return defaultValidatorsDir;
}

/**
 * Resolve the repo root used for source-schema fingerprinting.
 * Production default is the cc-master repo root. Tests may inject via
 * options.repoRoot / explicit root args or SKG_SCHEMA_REPO_ROOT.
 */
export function resolveSchemaRepoRoot(rootOverride) {
  if (typeof rootOverride === 'string' && rootOverride.length > 0) {
    return path.resolve(rootOverride);
  }
  const fromEnv = process.env.SKG_SCHEMA_REPO_ROOT;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return path.resolve(fromEnv);
  }
  return defaultRepoRoot;
}

/**
 * Load standalone validators only after manifest-to-bundle integrity passes.
 * Tampered or drifted bundles must never enter the require cache.
 */
function ensureValidatorsLoaded(
  validatorsDir = resolveValidatorsDir(),
  schemaRoot = resolveSchemaRepoRoot(),
) {
  if (loadAttempted) {
    if (loadedValidatorsDir !== validatorsDir || loadedSchemaRoot !== schemaRoot) {
      return false;
    }
    return Boolean(sourceValidator && changeValidator && outputValidator);
  }
  loadAttempted = true;
  loadedValidatorsDir = validatorsDir;
  loadedSchemaRoot = schemaRoot;
  if (!schemasMatch(schemaRoot, validatorsDir)) {
    loadError = null;
    sourceValidator = null;
    changeValidator = null;
    outputValidator = null;
    return false;
  }
  try {
    sourceValidator = require(path.join(validatorsDir, 'validate-source.cjs'));
    changeValidator = require(path.join(validatorsDir, 'validate-change.cjs'));
    outputValidator = require(path.join(validatorsDir, 'validate-output.cjs'));
    return true;
  } catch (error) {
    loadError = error;
    sourceValidator = null;
    changeValidator = null;
    outputValidator = null;
    return false;
  }
}

export function schemaFingerprint(root = resolveSchemaRepoRoot()) {
  return fingerprintOf(root);
}

export function schemasMatchCommittedValidators(root = resolveSchemaRepoRoot(), options = {}) {
  return schemasMatch(root, resolveValidatorsDir(options.validatorsDir));
}

export function validatorFreshness(root = resolveSchemaRepoRoot(), options = {}) {
  const schemaRoot = resolveSchemaRepoRoot(root);
  const validatorsDir = resolveValidatorsDir(options.validatorsDir);
  let current;
  try {
    current = computeSchemaManifest(schemaRoot);
  } catch (error) {
    return {
      available: false,
      reason: 'schema-unreadable',
      loadError: error,
      committed: readCommittedSchemaManifest(validatorsDir),
      current: null,
    };
  }
  const committed = readCommittedSchemaManifest(validatorsDir);
  if (!schemasMatch(schemaRoot, validatorsDir)) {
    const hasBundles =
      committed &&
      committed.bundles &&
      typeof committed.bundles === 'object' &&
      Object.keys(committed.bundles).length > 0;
    return {
      available: false,
      reason: hasBundles || committed ? 'stale' : 'missing',
      loadError: null,
      committed,
      current,
    };
  }
  if (!ensureValidatorsLoaded(validatorsDir, schemaRoot)) {
    return {
      available: false,
      reason: loadError ? 'missing' : 'stale',
      loadError,
      committed,
      current,
    };
  }
  return { available: true, reason: null, loadError: null, committed, current };
}

export function validatorsAvailable(options = {}) {
  return validatorFreshness(resolveSchemaRepoRoot(options.repoRoot), options).available;
}

export function validatorLoadError() {
  return loadError;
}

function cloneErrors(errors) {
  return (errors ?? []).map((error) => ({
    instancePath: error.instancePath ?? '',
    schemaPath: error.schemaPath ?? '',
    keyword: error.keyword ?? '',
    message: error.message ?? 'schema validation failed',
    params: error.params ?? {},
  }));
}

/**
 * @param {unknown} document
 * @param {'source'|'change'|'output'|undefined} kindHint
 * @param {{ validatorsDir?: string, repoRoot?: string }} [options]
 */
export function validateAuthoredDocument(document, kindHint, options = {}) {
  if (!validatorsAvailable(options)) {
    const freshness = validatorFreshness(resolveSchemaRepoRoot(options.repoRoot), options);
    const message =
      freshness.reason === 'stale'
        ? 'standalone validators are stale relative to source schema bytes or emitted bundles'
        : loadError?.message ?? 'standalone validators unavailable';
    return {
      ok: false,
      errors: [
        {
          instancePath: '',
          schemaPath: '',
          keyword: freshness.reason === 'stale' ? 'stale' : 'unavailable',
          message,
          params: {
            reason: freshness.reason,
            committed_fingerprint: freshness.committed?.fingerprint ?? null,
            current_fingerprint: freshness.current?.fingerprint ?? null,
          },
        },
      ],
    };
  }

  const kind =
    kindHint ??
    (document && typeof document === 'object' && !Array.isArray(document)
      ? document.kind === 'change' ||
        document.kind === 'change_workspace' ||
        document.kind === 'change_validation'
        ? 'change'
        : document.schema === 'cc-master/skill-knowledge-cli/v1alpha1'
          ? 'output'
          : 'source'
      : 'source');

  const validate =
    kind === 'change' ? changeValidator : kind === 'output' ? outputValidator : sourceValidator;
  const ok = Boolean(validate(document));
  return { ok, errors: ok ? [] : cloneErrors(validate.errors) };
}
