'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REGISTRY_SCHEMA = 'cc-master.provider-guidance-runtime.v1';
const MANIFEST_SCHEMA = 'cc-master.provider-guidance-runtime-manifest.v1';
const FACTS_SCHEMA = 'ccm/provider-model-facts-registry/v1';
const HOSTS = ['claude-code', 'codex', 'cursor'];
const SKILLS = ['master-orchestrator-guide', 'pacing-and-estimation', 'using-ccm'];
const SHA256 = /^[0-9a-f]{64}$/u;
const OFFICIAL_HOSTS = new Set(['anthropic.com', 'www.anthropic.com', 'openai.com', 'cursor.com']);
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function fail(message) {
  throw new Error(`provider guidance attestation: ${message}`);
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
      if (
        availability.state === 'conditional' &&
        availability.account_scope === 'global'
      ) {
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
  ) fail(`${label} must be a normalized relative POSIX path`);
}

function providerGuidanceRuntimeManifest(root) {
  if (typeof root !== 'string' || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    fail('runtime tree root must be an existing directory');
  }
  const files = {};
  const visit = (directory, relativeDirectory = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => compareText(a.name, b.name))) {
      const runtimePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      assertRuntimePath(runtimePath, 'runtime tree path');
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath, runtimePath);
      else if (entry.isFile()) {
        files[runtimePath] = crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
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

function loadProviderGuidanceRegistry(
  registryPath,
  repoRoot = process.cwd(),
  verificationAsOf = new Date().toISOString(),
) {
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (error) {
    fail(`cannot read ${registryPath}: ${error.message}`);
  }
  assertExactKeys(
    registry,
    ['schema', 'facts_registry', 'projection_as_of', 'hosts'],
    'registry',
  );
  if (registry.schema !== REGISTRY_SCHEMA) fail(`registry.schema must be ${REGISTRY_SCHEMA}`);
  const projectionAsOf = instant(registry.projection_as_of, 'projection_as_of');
  const verificationAsOfMs = instant(verificationAsOf, 'verification_as_of');
  if (projectionAsOf > verificationAsOfMs) fail('projection_as_of is in the future');
  const factsPath = path.resolve(repoRoot, nonempty(registry.facts_registry, 'facts_registry'));
  if (!fs.existsSync(factsPath)) fail(`missing facts registry ${factsPath}`);
  validateProviderModelFactsRegistry(
    JSON.parse(fs.readFileSync(factsPath, 'utf8')),
    verificationAsOf,
  );
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

function assertProviderGuidanceRuntimeTree(registry, host, skill, root) {
  if (!HOSTS.includes(host)) fail(`unsupported host ${host}`);
  if (!SKILLS.includes(skill)) fail(`unsupported skill ${skill}`);
  const expected = validateManifest(
    registry?.hosts?.[host]?.skills?.[skill],
    `hosts.${host}.skills.${skill}`,
  );
  const actual = providerGuidanceRuntimeManifest(root);
  const expectedPaths = Object.keys(expected.files);
  const actualPaths = Object.keys(actual.files);
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    const missing = expectedPaths.filter((runtimePath) => !Object.hasOwn(actual.files, runtimePath));
    const unexpected = actualPaths.filter((runtimePath) => !Object.hasOwn(expected.files, runtimePath));
    fail(`${host}/${skill} file set mismatch: missing ${JSON.stringify(missing)}, unexpected ${JSON.stringify(unexpected)}`);
  }
  for (const runtimePath of expectedPaths) {
    if (actual.files[runtimePath] !== expected.files[runtimePath]) {
      fail(`${host}/${skill}:${runtimePath} digest mismatch`);
    }
  }
  return actual;
}

module.exports = {
  HOSTS,
  MANIFEST_SCHEMA,
  REGISTRY_SCHEMA,
  SKILLS,
  assertProviderGuidanceRuntimeTree,
  loadProviderGuidanceRegistry,
  providerGuidanceRuntimeManifest,
  validateProviderModelFactsRegistry,
};
