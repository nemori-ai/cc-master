'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SHA256 = /^[0-9a-f]{64}$/u;
const RUNTIME_MANIFEST_SCHEMA = 'cc-master.pacing-runtime-manifest.v1';
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function fail(message) {
  throw new Error(`pacing read-only attestation: ${message}`);
}

function expectedPacingRenderedDigest(registry, host) {
  const digest = registry?.hosts?.[host]?.rendered_body_sha256;
  if (typeof digest !== 'string' || !SHA256.test(digest)) {
    fail(`hosts.${host}.rendered_body_sha256 must be a lowercase SHA-256 digest`);
  }
  return digest;
}

function pacingRenderedArtifactDigest(text) {
  if (typeof text !== 'string') fail('rendered artifact must be a string');
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
}

function assertExactKeys(value, expected, label) {
  assertRecord(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label} keys must be exactly ${wanted.join(', ')}; got ${actual.join(', ')}`);
  }
}

function assertRuntimePath(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    fail(`${label} must be a normalized relative POSIX path`);
  }
}

function expectedPacingRuntimeManifest(registry, host) {
  const manifest = registry?.hosts?.[host]?.rendered_runtime_manifest;
  assertExactKeys(manifest, ['schema', 'files'], `hosts.${host}.rendered_runtime_manifest`);
  if (manifest.schema !== RUNTIME_MANIFEST_SCHEMA) {
    fail(
      `hosts.${host}.rendered_runtime_manifest.schema must be ${RUNTIME_MANIFEST_SCHEMA}`,
    );
  }
  assertRecord(manifest.files, `hosts.${host}.rendered_runtime_manifest.files`);
  const entries = Object.entries(manifest.files).sort(([left], [right]) => compareText(left, right));
  if (entries.length === 0) {
    fail(`hosts.${host}.rendered_runtime_manifest.files must not be empty`);
  }
  for (const [runtimePath, digest] of entries) {
    assertRuntimePath(runtimePath, `hosts.${host}.rendered_runtime_manifest.files path`);
    if (typeof digest !== 'string' || !SHA256.test(digest)) {
      fail(
        `hosts.${host}.rendered_runtime_manifest.files.${runtimePath} must be a lowercase SHA-256 digest`,
      );
    }
  }
  return {
    schema: RUNTIME_MANIFEST_SCHEMA,
    files: Object.fromEntries(entries),
  };
}

function pacingRuntimeManifest(root) {
  if (typeof root !== 'string' || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    fail('runtime tree root must be an existing directory');
  }
  const files = {};
  const visit = (directory, relativeDirectory = '') => {
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const runtimePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      assertRuntimePath(runtimePath, 'runtime tree path');
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath, runtimePath);
      } else if (entry.isFile()) {
        files[runtimePath] = crypto
          .createHash('sha256')
          .update(fs.readFileSync(absolutePath))
          .digest('hex');
      } else {
        fail(`runtime tree path ${runtimePath} must be a regular file or directory`);
      }
    }
  };
  visit(root);
  return {
    schema: RUNTIME_MANIFEST_SCHEMA,
    files,
  };
}

function assertPacingRenderedArtifact(registry, host, text) {
  const expected = expectedPacingRenderedDigest(registry, host);
  const actual = pacingRenderedArtifactDigest(text);
  if (actual !== expected) {
    fail(`rendered artifact digest mismatch for ${host}: expected ${expected}, got ${actual}`);
  }
  return text;
}

function assertPacingRuntimeTree(registry, host, root) {
  const expected = expectedPacingRuntimeManifest(registry, host);
  const actual = pacingRuntimeManifest(root);
  const expectedPaths = Object.keys(expected.files);
  const actualPaths = Object.keys(actual.files);
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    const missing = expectedPaths.filter((runtimePath) => !Object.hasOwn(actual.files, runtimePath));
    const unexpected = actualPaths.filter(
      (runtimePath) => !Object.hasOwn(expected.files, runtimePath),
    );
    fail(
      `runtime manifest file set mismatch for ${host}: missing ${JSON.stringify(missing)}, unexpected ${JSON.stringify(unexpected)}`,
    );
  }
  for (const runtimePath of expectedPaths) {
    if (actual.files[runtimePath] !== expected.files[runtimePath]) {
      fail(
        `runtime manifest digest mismatch for ${host}:${runtimePath}: expected ${expected.files[runtimePath]}, got ${actual.files[runtimePath]}`,
      );
    }
  }
  return actual;
}

module.exports = {
  RUNTIME_MANIFEST_SCHEMA,
  assertPacingRenderedArtifact,
  assertPacingRuntimeTree,
  expectedPacingRenderedDigest,
  expectedPacingRuntimeManifest,
  pacingRenderedArtifactDigest,
  pacingRuntimeManifest,
};
