/**
 * Skills-surface orchestration for sync-plugin-dist.
 *
 * Owns: staging create → SAP project → final overlay → skills-scoped entry pins
 * → attestation assert → publishSkillsTree. Outer catch cleans ONLY this
 * orchestration's staging. Backup create / restore / post-commit cleanup belong
 * solely to publishSkillsTree.
 *
 * `stamp` is an explicit internal parameter (tests inject deterministic values).
 * Optional `beforePublish` is a dev-test-only seam planted between initial
 * collision check and publish — production sync never passes it.
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
    parsed = JSON.parse(String(result.stdout || '').trim().split('\n').filter(Boolean).at(-1));
  } catch {
    throw new Error(`skills-scoped entry pins returned non-JSON for ${host}: ${result.stdout}`);
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
  const root = path.resolve(repoRoot);
  const stamp = assertSafeStamp(stampInput);
  // Integrity before any mkdir: refuse live host symlink / symlink ancestors.
  assertHostDistPathIntegrity(root, host);
  const src = path.join(root, 'plugin/src');
  const hostDist = path.join(root, 'plugin/dist', host);
  const skillsSrc = path.join(src, 'skills');
  const liveAbsolute = path.join(hostDist, 'skills');
  const stagingAbsolute = path.join(hostDist, `skills.write-${stamp}`);
  const backupAbsolute = path.join(hostDist, `skills.bak-${stamp}`);

  requireDir(skillsSrc);
  fs.mkdirSync(hostDist, { recursive: true });

  // Initial collision check (before staging create).
  if (lstatOrNull(stagingAbsolute) || lstatOrNull(backupAbsolute)) {
    throw new Error(`skills staging/backup collision under ${hostDist}`);
  }
  fs.mkdirSync(stagingAbsolute);
  const stagingStat = lstatOrNull(stagingAbsolute);
  if (!stagingStat || stagingStat.isSymbolicLink() || !stagingStat.isDirectory()) {
    throw new Error(`invalid skills staging directory ${stagingAbsolute}`);
  }

  try {
    for (const skill of fs.readdirSync(skillsSrc).sort()) {
      if (skill.startsWith('_')) continue;
      if (!fs.statSync(path.join(skillsSrc, skill)).isDirectory()) continue;
      const plan = planSkillProjection({ repoRoot: root, host, skill });
      if (plan.mode === 'planned') {
        // Phase B: cursor (and future hosts) may declare planned until overlays exist.
        continue;
      }
      const projectionTarget = path.join(stagingAbsolute, skill);
      applySkillProjection(plan, projectionTarget);
      applyFinalSkillOverlay({
        repoRoot: root,
        host,
        skill,
        skillTree: projectionTarget,
        stagingRoot: stagingAbsolute,
      });
      if (plan.providerGuidanceContract) {
        const registry = loadProviderGuidanceRegistry(
          plan.providerGuidanceRegistryPath,
          root,
        );
        assertProviderGuidanceRuntimeTree(
          registry,
          plan.providerGuidanceContract.host,
          plan.providerGuidanceContract.skill,
          projectionTarget,
        );
      }
      if (plan.readOnlyContract) {
        assertPacingRenderedArtifact(
          plan.pacingRegistry,
          plan.readOnlyContract.host,
          plan.pacingRenderedBody,
        );
        assertPacingRuntimeTree(plan.pacingRegistry, plan.readOnlyContract.host, projectionTarget);
      }
    }

    // Skills-scoped host entry pins (Codex skill_entry). Command entries stay full-host-only.
    applySkillsScopedEntryPinsBridge({
      repoRoot: root,
      host,
      stagingRoot: stagingAbsolute,
      skillsTree: stagingAbsolute,
    });

    // Dev-test-only seam: runs after initial check + staging fill, before publish.
    // Production sync must not pass beforePublish.
    if (typeof beforePublish === 'function') {
      beforePublish({
        hostDistAbsolute: path.resolve(hostDist),
        liveAbsolute: path.resolve(liveAbsolute),
        stagingAbsolute: path.resolve(stagingAbsolute),
        backupAbsolute: path.resolve(backupAbsolute),
        stamp,
      });
    }

    return publishSkillsTree({
      hostDistAbsolute: path.resolve(hostDist),
      liveAbsolute: path.resolve(liveAbsolute),
      stagingAbsolute: path.resolve(stagingAbsolute),
      stamp,
      warn,
    });
  } catch (error) {
    // Outer catch owns ONLY staging it created. Never remove unknown/collision backups —
    // publishSkillsTree uniquely owns backup create/restore/post-commit cleanup.
    if (lstatOrNull(stagingAbsolute)) {
      try {
        rmNoFollow(stagingAbsolute, path.resolve(hostDist));
      } catch {
        // leave staging for operator inspection
      }
    }
    throw error;
  }
}

module.exports = {
  assertSafeStamp,
  projectAndPublishSkillsSurface,
};
