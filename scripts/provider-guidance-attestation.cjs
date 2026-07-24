'use strict';

/**
 * Provider-guidance runtime attestation.
 *
 * Owns: v2 registry schema, stable tree manifests, accepted_sap / accepted_final
 * exact compare, candidate sidecar evidence verification (recomputed commitments).
 *
 * Does NOT own compiler-owned overlay grammar. Overlay inspect/apply lives only in
 * scripts/skill-knowledge/compile/skill-overlay.mjs (reached via ESM bridges).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REGISTRY_SCHEMA_V1 = 'cc-master.provider-guidance-runtime.v1';
const REGISTRY_SCHEMA = 'cc-master.provider-guidance-runtime.v2';
const MANIFEST_SCHEMA = 'cc-master.provider-guidance-runtime-manifest.v1';
const SKILL_ENTRY_SCHEMA = 'cc-master.provider-guidance-runtime-skill.v2';
const CANDIDATE_SIDECAR_SCHEMA = 'cc-master.provider-guidance-candidate-attestation.v1';
const FACTS_SCHEMA = 'ccm/provider-model-facts-registry/v1';
const HOSTS = ['claude-code', 'codex', 'cursor', 'kimi-code'];
const SKILLS = ['master-orchestrator-guide', 'pacing-and-estimation', 'using-ccm'];
const SHA256 = /^[0-9a-f]{64}$/u;
const COMPILER_CONTRACT = 'cc-master/skill-overlay+sap-project/v1';
const SIDECAR_REQUIRED_KEYS = Object.freeze([
  'schema',
  'host',
  'skill',
  'accepted_registry_sha256',
  'accepted_sap_manifest_sha256',
  'candidate_graph_sha256',
  'raw_sap_manifest_sha256',
  'expected_final_manifest_sha256',
  'compiler_contract',
]);
const OFFICIAL_HOSTS = new Set([
  'anthropic.com',
  'www.anthropic.com',
  'openai.com',
  'cursor.com',
  'platform.kimi.ai',
  'www.kimi.com',
]);
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function fail(message, code = 'SKG-PROVIDER-GUIDANCE') {
  const error = new Error(`provider guidance attestation: ${message}`);
  error.code = code;
  throw error;
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function nonempty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be non-empty`);
  return value;
}

function strings(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    fail(`${label} must be a string array`);
  }
  return value;
}

function instant(value, label) {
  const text = nonempty(value, label);
  if (!text.endsWith('Z') || !Number.isFinite(Date.parse(text))) fail(`${label} must be UTC RFC3339`);
  return Date.parse(text);
}

function assertExactKeys(value, expected, label) {
  record(value, label);
  const actual = Object.keys(value).sort(compareText);
  const wanted = [...expected].sort(compareText);
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label} keys must be exactly ${wanted.join(', ')}; got ${actual.join(', ')}`);
  }
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validateProviderModelFactsRegistry(value, asOf) {
  const registry = record(value, 'facts registry');
  if (registry.schema !== FACTS_SCHEMA) fail(`facts registry schema must be ${FACTS_SCHEMA}`);
  nonempty(registry.revision, 'facts registry revision');
  const providers = record(registry.providers, 'facts registry providers');
  const asOfMs = instant(asOf, 'projection_as_of');
  assertExactKeys(providers, HOSTS, 'facts registry providers');

  for (const provider of HOSTS) {
    const snapshot = record(providers[provider], `facts providers.${provider}`);
    if (snapshot.schema !== 'ccm/provider-model-facts/v1') fail(`${provider} facts schema is invalid`);
    if (snapshot.provider !== provider) fail(`${provider} facts provider id is invalid`);
    nonempty(snapshot.account_scope, `${provider}.account_scope`);
    nonempty(snapshot.confidence, `${provider}.confidence`);
    strings(snapshot.unknown, `${provider}.unknown`);
    const observedAt = instant(snapshot.observed_at, `${provider}.observed_at`);
    const validUntil = instant(snapshot.valid_until, `${provider}.valid_until`);
    if (observedAt > validUntil) fail(`${provider} facts are expired`);
    if (asOfMs < observedAt) fail(`${provider} observation is in the future`);
    if (asOfMs > validUntil) fail(`${provider} facts are stale or expired`);

    if (!Array.isArray(snapshot.source) || snapshot.source.length === 0) {
      fail(`${provider}.source must contain official provenance`);
    }
    const sourceIds = [];
    for (const [index, rawSource] of snapshot.source.entries()) {
      const source = record(rawSource, `${provider}.source[${index}]`);
      const id = nonempty(source.id, `${provider}.source[${index}].id`);
      let url;
      try {
        url = new URL(nonempty(source.url, `${provider}.source[${index}].url`));
      } catch {
        fail(`${provider}.source[${index}].url is invalid`);
      }
      if (url.protocol !== 'https:' || !OFFICIAL_HOSTS.has(url.hostname)) {
        fail(`${provider}.source[${index}] is not an official HTTPS source`);
      }
      if (instant(source.retrieved_at, `${provider}.source[${index}].retrieved_at`) > observedAt) {
        fail(`${provider}.source[${index}] was retrieved after observation`);
      }
      sourceIds.push(id);
    }
    if (new Set(sourceIds).size !== sourceIds.length) fail(`${provider}.source IDs contain duplicates`);

    if (!Array.isArray(snapshot.models) || snapshot.models.length === 0) {
      fail(`${provider}.models must be non-empty`);
    }
    const modelIds = [];
    const superseded = new Set();
    for (const [index, rawModel] of snapshot.models.entries()) {
      const model = record(rawModel, `${provider}.models[${index}]`);
      const modelId = nonempty(model.model_id, `${provider}.models[${index}].model_id`);
      const availability = record(model.availability, `${provider}.models[${index}].availability`);
      if (availability.state === 'conditional' && availability.account_scope === 'global') {
        fail(`${provider}.models[${index}] conditional availability requires account_scope`);
      }
      const refs = strings(model.source_refs, `${provider}.models[${index}].source_refs`);
      if (refs.length === 0 || refs.some((id) => !sourceIds.includes(id))) {
        fail(`${provider}.models[${index}].source_refs is invalid`);
      }
      for (const id of strings(model.supersedes, `${provider}.models[${index}].supersedes`)) {
        superseded.add(id);
      }
      modelIds.push(modelId);
    }
    if (new Set(modelIds).size !== modelIds.length) fail(`${provider}.model IDs contain duplicates`);
    const supersededCurrent = modelIds.find((id) => superseded.has(id));
    if (supersededCurrent) fail(`${provider} contains superseded current model ${supersededCurrent}`);
  }
  return registry;
}

function assertRuntimePath(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    fail(`${label} must be a normalized relative POSIX path`);
  }
}

function providerGuidanceRuntimeManifest(root) {
  if (typeof root !== 'string' || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    fail('runtime tree root must be an existing directory');
  }
  const files = {};
  const visit = (directory, relativeDirectory = '') => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => compareText(a.name, b.name))) {
      const runtimePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      assertRuntimePath(runtimePath, 'runtime tree path');
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail(`runtime tree path ${runtimePath} must not be a symlink`);
      if (entry.isDirectory()) visit(absolutePath, runtimePath);
      else if (entry.isFile()) {
        files[runtimePath] = sha256Hex(fs.readFileSync(absolutePath));
      } else fail(`runtime tree path ${runtimePath} must be a regular file or directory`);
    }
  };
  visit(root);
  return { schema: MANIFEST_SCHEMA, files };
}

function validateManifest(value, label) {
  assertExactKeys(value, ['schema', 'files'], label);
  if (value.schema !== MANIFEST_SCHEMA) fail(`${label}.schema must be ${MANIFEST_SCHEMA}`);
  record(value.files, `${label}.files`);
  const entries = Object.entries(value.files).sort(([a], [b]) => compareText(a, b));
  if (entries.length === 0) fail(`${label}.files must not be empty`);
  for (const [runtimePath, digest] of entries) {
    assertRuntimePath(runtimePath, `${label}.files path`);
    if (typeof digest !== 'string' || !SHA256.test(digest)) {
      fail(`${label}.files.${runtimePath} must be a lowercase SHA-256 digest`);
    }
  }
  return { schema: MANIFEST_SCHEMA, files: Object.fromEntries(entries) };
}

function validateSkillEntry(value, label) {
  assertExactKeys(value, ['accepted_sap', 'accepted_final'], label);
  return {
    accepted_sap: validateManifest(value.accepted_sap, `${label}.accepted_sap`),
    accepted_final: validateManifest(value.accepted_final, `${label}.accepted_final`),
  };
}

function manifestSha256(manifest) {
  const normalized = validateManifest(manifest, 'manifest');
  return sha256Hex(Buffer.from(JSON.stringify(normalized), 'utf8'));
}

function assertManifestsExactEqual(actual, expected, label) {
  const left = validateManifest(actual, `${label}.actual`);
  const right = validateManifest(expected, `${label}.expected`);
  const leftPaths = Object.keys(left.files);
  const rightPaths = Object.keys(right.files);
  if (JSON.stringify(leftPaths) !== JSON.stringify(rightPaths)) {
    const missing = rightPaths.filter((runtimePath) => !Object.hasOwn(left.files, runtimePath));
    const unexpected = leftPaths.filter((runtimePath) => !Object.hasOwn(right.files, runtimePath));
    fail(
      `${label} file set mismatch: missing ${JSON.stringify(missing)}, unexpected ${JSON.stringify(unexpected)}`,
    );
  }
  for (const runtimePath of rightPaths) {
    if (left.files[runtimePath] !== right.files[runtimePath]) {
      fail(`${label}:${runtimePath} digest mismatch`);
    }
  }
  return left;
}

function registryBytesSha256(registryPath) {
  return sha256Hex(fs.readFileSync(registryPath));
}

function loadRawRegistryJson(registryPath) {
  try {
    return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (error) {
    fail(`cannot read ${registryPath}: ${error.message}`);
  }
}

/**
 * Load and validate the committed provider-guidance registry.
 * Product paths require v2. Pass allowV1ForMigration:true only for the audited migrator.
 */
function loadProviderGuidanceRegistry(
  registryPath,
  repoRoot = process.cwd(),
  verificationAsOf = new Date().toISOString(),
  options = {},
) {
  const registry = loadRawRegistryJson(registryPath);
  if (registry.schema === REGISTRY_SCHEMA_V1) {
    if (!options.allowV1ForMigration) {
      fail(
        `registry.schema is ${REGISTRY_SCHEMA_V1}; product paths require ${REGISTRY_SCHEMA}`,
        'REGISTRY_V2_REQUIRED',
      );
    }
    assertExactKeys(registry, ['schema', 'facts_registry', 'projection_as_of', 'hosts'], 'registry');
    const projectionAsOf = instant(registry.projection_as_of, 'projection_as_of');
    const verificationAsOfMs = instant(verificationAsOf, 'verification_as_of');
    if (projectionAsOf > verificationAsOfMs) fail('projection_as_of is in the future');
    const factsPath = path.resolve(repoRoot, nonempty(registry.facts_registry, 'facts_registry'));
    if (!fs.existsSync(factsPath)) fail(`missing facts registry ${factsPath}`);
    validateProviderModelFactsRegistry(JSON.parse(fs.readFileSync(factsPath, 'utf8')), verificationAsOf);
    assertExactKeys(registry.hosts, HOSTS, 'hosts');
    for (const host of HOSTS) {
      assertExactKeys(registry.hosts[host], ['skills'], `hosts.${host}`);
      assertExactKeys(registry.hosts[host].skills, SKILLS, `hosts.${host}.skills`);
      for (const skill of SKILLS) {
        validateManifest(registry.hosts[host].skills[skill], `hosts.${host}.skills.${skill}`);
      }
    }
    return registry;
  }

  assertExactKeys(registry, ['schema', 'facts_registry', 'projection_as_of', 'hosts'], 'registry');
  if (registry.schema !== REGISTRY_SCHEMA) {
    fail(`registry.schema must be ${REGISTRY_SCHEMA}`, 'REGISTRY_V2_REQUIRED');
  }
  const projectionAsOf = instant(registry.projection_as_of, 'projection_as_of');
  const verificationAsOfMs = instant(verificationAsOf, 'verification_as_of');
  if (projectionAsOf > verificationAsOfMs) fail('projection_as_of is in the future');
  const factsPath = path.resolve(repoRoot, nonempty(registry.facts_registry, 'facts_registry'));
  if (!fs.existsSync(factsPath)) fail(`missing facts registry ${factsPath}`);
  validateProviderModelFactsRegistry(JSON.parse(fs.readFileSync(factsPath, 'utf8')), verificationAsOf);
  assertExactKeys(registry.hosts, HOSTS, 'hosts');
  for (const host of HOSTS) {
    assertExactKeys(registry.hosts[host], ['skills'], `hosts.${host}`);
    assertExactKeys(registry.hosts[host].skills, SKILLS, `hosts.${host}.skills`);
    for (const skill of SKILLS) {
      validateSkillEntry(registry.hosts[host].skills[skill], `hosts.${host}.skills.${skill}`);
    }
  }
  return registry;
}

function skillEntry(registry, host, skill) {
  if (!HOSTS.includes(host)) fail(`unsupported host ${host}`);
  if (!SKILLS.includes(skill)) fail(`unsupported skill ${skill}`);
  return validateSkillEntry(
    registry?.hosts?.[host]?.skills?.[skill],
    `hosts.${host}.skills.${skill}`,
  );
}

function assertProviderGuidanceAcceptedSap(registry, host, skill, root) {
  const entry = skillEntry(registry, host, skill);
  const actual = providerGuidanceRuntimeManifest(root);
  return assertManifestsExactEqual(actual, entry.accepted_sap, `${host}/${skill} accepted_sap`);
}

function assertProviderGuidanceAcceptedFinal(registry, host, skill, root) {
  const entry = skillEntry(registry, host, skill);
  const actual = providerGuidanceRuntimeManifest(root);
  return assertManifestsExactEqual(actual, entry.accepted_final, `${host}/${skill} accepted_final`);
}

/** Accepted sync path: final projected skill tree must exact-match accepted_final. */
function assertProviderGuidanceRuntimeTree(registry, host, skill, root) {
  return assertProviderGuidanceAcceptedFinal(registry, host, skill, root);
}

function inspectSkillTreeOverlayViaBridge(repoRoot, treeRoot, { assertClean = false } = {}) {
  const script = path.join(repoRoot, 'scripts/skill-knowledge/inspect-skill-tree-overlay.mjs');
  const args = [script, '--root', treeRoot];
  if (assertClean) args.push('--assert-clean');
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  let parsed;
  try {
    const { parseStructuredJsonStdout } = require('./skill-knowledge/json-framing.cjs');
    parsed = parseStructuredJsonStdout(result.stdout, {
      label: 'overlay inspect bridge',
    });
  } catch (error) {
    fail(
      `overlay inspect bridge returned non-JSON (status=${result.status}): ${error.message}; ${result.stderr || result.stdout}`,
    );
  }
  if (result.status !== 0 || !parsed?.ok) {
    fail(
      parsed?.message ||
        `overlay inspect failed for ${treeRoot}: ${result.stderr || result.stdout || `exit ${result.status}`}`,
      parsed?.code || 'SKG-OVERLAY-RAW-SAP-POLLUTED',
    );
  }
  return parsed;
}

function assertRawSapTreeClean(repoRoot, treeRoot) {
  return inspectSkillTreeOverlayViaBridge(repoRoot, treeRoot, { assertClean: true });
}

function buildCandidateAttestationSidecar({
  host,
  skill,
  acceptedRegistrySha256,
  acceptedSapManifestSha256,
  candidateGraphSha256,
  rawSapManifestSha256,
  expectedFinalManifestSha256,
  compilerContract = COMPILER_CONTRACT,
}) {
  if (!HOSTS.includes(host)) fail(`unsupported host ${host}`);
  if (!SKILLS.includes(skill)) fail(`unsupported skill ${skill}`);
  for (const [label, digest] of [
    ['accepted_registry_sha256', acceptedRegistrySha256],
    ['accepted_sap_manifest_sha256', acceptedSapManifestSha256],
    ['candidate_graph_sha256', candidateGraphSha256],
    ['raw_sap_manifest_sha256', rawSapManifestSha256],
    ['expected_final_manifest_sha256', expectedFinalManifestSha256],
  ]) {
    if (typeof digest !== 'string' || !SHA256.test(digest)) {
      fail(`${label} must be lowercase SHA-256`);
    }
  }
  if (compilerContract !== COMPILER_CONTRACT) {
    fail(`compiler_contract must be ${COMPILER_CONTRACT}`);
  }
  return {
    schema: CANDIDATE_SIDECAR_SCHEMA,
    host,
    skill,
    accepted_registry_sha256: acceptedRegistrySha256,
    accepted_sap_manifest_sha256: acceptedSapManifestSha256,
    candidate_graph_sha256: candidateGraphSha256,
    raw_sap_manifest_sha256: rawSapManifestSha256,
    expected_final_manifest_sha256: expectedFinalManifestSha256,
    compiler_contract: compilerContract,
  };
}

/**
 * Sidecar is evidence only. Verifier recomputes every commitment and rejects
 * missing/extra fields, host/skill replay, registry drift, and digest mismatch.
 */
function verifyCandidateAttestationSidecar(sidecar, expected) {
  assertExactKeys(sidecar, SIDECAR_REQUIRED_KEYS, 'candidate attestation sidecar');
  if (sidecar.schema !== CANDIDATE_SIDECAR_SCHEMA) {
    fail(`sidecar.schema must be ${CANDIDATE_SIDECAR_SCHEMA}`);
  }
  const wanted = buildCandidateAttestationSidecar(expected);
  for (const key of SIDECAR_REQUIRED_KEYS) {
    if (sidecar[key] !== wanted[key]) {
      fail(`sidecar.${key} commitment mismatch (recomputed verifier disagrees)`);
    }
  }
  return wanted;
}

function atomicWriteJson(targetPath, value) {
  const dir = path.dirname(targetPath);
  const temp = path.join(
    dir,
    `${path.basename(targetPath)}.tmp-${process.pid}-${Math.random().toString(16).slice(2, 8)}`,
  );
  const payload = canonicalJson(value);
  const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o644);
  try {
    fs.writeFileSync(fd, payload, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const readback = fs.readFileSync(temp, 'utf8');
  if (readback !== payload) {
    fs.unlinkSync(temp);
    fail(`registry write verify failed for ${targetPath}`);
  }
  fs.renameSync(temp, targetPath);
  const dirFd = fs.openSync(dir, 'r');
  try {
    fs.fsyncSync(dirFd);
  } finally {
    fs.closeSync(dirFd);
  }
}

module.exports = {
  CANDIDATE_SIDECAR_SCHEMA,
  COMPILER_CONTRACT,
  HOSTS,
  MANIFEST_SCHEMA,
  REGISTRY_SCHEMA,
  REGISTRY_SCHEMA_V1,
  SKILL_ENTRY_SCHEMA,
  SKILLS,
  assertManifestsExactEqual,
  assertProviderGuidanceAcceptedFinal,
  assertProviderGuidanceAcceptedSap,
  assertProviderGuidanceRuntimeTree,
  assertRawSapTreeClean,
  atomicWriteJson,
  buildCandidateAttestationSidecar,
  loadProviderGuidanceRegistry,
  manifestSha256,
  providerGuidanceRuntimeManifest,
  registryBytesSha256,
  validateManifest,
  validateProviderModelFactsRegistry,
  validateSkillEntry,
  verifyCandidateAttestationSidecar,
};
