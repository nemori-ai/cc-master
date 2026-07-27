/**
 * Skills is a request scope, not an independently publishable live subtree.
 * Until a durable verified-full-base receipt is available, every skills request
 * expands to the full-host trusted transaction. This preserves the shared host
 * lock, re-verifies the complete host snapshot, and prevents knowledge/strategy
 * changes from being smuggled through a narrower legacy publisher.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  assertPacingRenderedArtifact,
  assertPacingRuntimeTree,
} = require('../pacing-read-only-attestation.cjs');
const {
  assertProviderGuidanceRuntimeTree,
  loadProviderGuidanceRegistry,
} = require('../provider-guidance-attestation.cjs');
const {
  applyFinalSkillOverlay,
  applySkillProjection,
  planSkillProjection,
  requireDir,
} = require('../project-skill.cjs');
const { publishSkillsTree } = require('./publish-skills-tree.cjs');
const { assertHostDistPathIntegrity } = require('./sync-host-surface.cjs');

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

function rmNoFollow(targetAbsolute, containmentRoot) {
  const absolute = path.resolve(targetAbsolute);
  const root = path.resolve(containmentRoot);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error(`refusing to remove ${absolute} outside ${root}`);
  }
  const stat = lstatOrNull(absolute);
  if (!stat) return;
  if (stat.isSymbolicLink() || stat.isFile()) {
    fs.unlinkSync(absolute);
    return;
  }
  if (!stat.isDirectory()) {
    fs.unlinkSync(absolute);
    return;
  }
  for (const name of fs.readdirSync(absolute)) {
    rmNoFollow(path.join(absolute, name), root);
  }
  fs.rmdirSync(absolute);
}

function assertSafeStamp(stamp) {
  if (!stamp || /[\\/]/.test(String(stamp))) {
    throw new Error(`invalid skills publish stamp: ${JSON.stringify(stamp)}`);
  }
  return String(stamp);
}

function applySkillsScopedEntryPinsBridge({ repoRoot, host, stagingRoot, skillsTree }) {
  const script = path.join(repoRoot, 'scripts/skill-knowledge/apply-final-skill-overlay.mjs');
  const result = spawnSync(
    process.execPath,
    [
      script,
      '--repo-root',
      repoRoot,
      '--host',
      host,
      '--entry-pins-only',
      '--staging-root',
      stagingRoot,
      '--skills-tree',
      skillsTree,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(
      `skills-scoped entry pins failed for ${host}: ${result.stderr || result.stdout || `exit ${result.status}`}`,
    );
  }
  let parsed;
  try {
    const { parseStructuredJsonStdout } = require('./json-framing.cjs');
    parsed = parseStructuredJsonStdout(result.stdout, {
      label: `skills-scoped entry pins (${host})`,
    });
  } catch (error) {
    throw new Error(
      `skills-scoped entry pins returned non-JSON for ${host}: ${error.message}; stdout=${result.stdout}`,
    );
  }
  if (!parsed || parsed.ok !== true) {
    throw new Error(`skills-scoped entry pins refused for ${host}: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

/**
 * Project + attest + atomically publish skills for one host dist.
 */
function projectAndPublishSkillsSurface({
  repoRoot,
  host,
  stamp: stampInput,
  beforePublish,
  warn = (message) => console.warn(`sync-plugin-dist: ${message}`),
}) {
  assertSafeStamp(stampInput);
  if (typeof beforePublish === 'function') {
    throw new Error(
      'skills-only legacy beforePublish seam is unsupported; the request expands to full-host trusted publish',
    );
  }
  const { projectAndPublishHostSurface } = require('./sync-host-surface.cjs');
  return projectAndPublishHostSurface({
    repoRoot,
    host,
    stamp: stampInput,
    warn: (message) => warn(`skills scope expanded to verified full-host snapshot: ${message}`),
  });
}

module.exports = {
  assertSafeStamp,
  projectAndPublishSkillsSurface,
};
