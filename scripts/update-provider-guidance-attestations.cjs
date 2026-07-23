#!/usr/bin/env node
'use strict';

// Regenerate plugin/src/skills/provider-guidance-runtime.json — the sanctioned entry for updating
// the provider-guidance attestation registry after an attested skill's canonical content or file
// set changes (issue #163 / K1-06).
//
// Pipeline (must stay lockstep with sync staging):
//   1. Project canonical → raw SAP scratch via project-skill.cjs
//   2. Apply shared compiler-owned final skill overlay (nav/anchors)
//   3. Fingerprint the final runtime skill tree
//   4. Atomically publish registry (temp + fsync + rename) only after ALL hosts succeed
//
// Never read checked-in plugin/dist. Never fingerprint raw SAP alone. The v1 single-manifest
// schema is preserved; its semantic target is final compiled runtime skills.
//
// After regenerating, `bash scripts/sync-plugin-dist.sh` (assert-on) re-projects, overlays, and
// asserts dist == registry == final runtime as the safety net.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  HOSTS,
  REGISTRY_SCHEMA,
  SKILLS,
  providerGuidanceRuntimeManifest,
  validateProviderModelFactsRegistry,
} = require('./provider-guidance-attestation.cjs');
const {
  applyFinalSkillOverlay,
  applySkillProjection,
  planSkillProjection,
} = require('./project-skill.cjs');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'plugin/src/skills/provider-guidance-runtime.json');
const factsRegistry = 'ccm/apps/cli/src/provider-model-facts.json';
const facts = JSON.parse(fs.readFileSync(path.join(root, factsRegistry), 'utf8'));
const projectionAsOf = Object.values(facts.providers)
  .map((provider) => provider.observed_at)
  .sort()
  .at(-1);

validateProviderModelFactsRegistry(
  facts,
  projectionAsOf,
);

function atomicWriteJson(targetPath, value) {
  const dir = path.dirname(targetPath);
  const temp = path.join(
    dir,
    `${path.basename(targetPath)}.tmp-${process.pid}-${Math.random().toString(16).slice(2, 8)}`,
  );
  const payload = `${JSON.stringify(value, null, 2)}\n`;
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
    throw new Error(`registry write verify failed for ${targetPath}`);
  }
  fs.renameSync(temp, targetPath);
  const dirFd = fs.openSync(dir, 'r');
  try {
    fs.fsyncSync(dirFd);
  } finally {
    fs.closeSync(dirFd);
  }
}

// Controlled scratch root under the repo (not an opaque os.tmpdir alone).
const scratchParent = path.join(root, '.tmp');
fs.mkdirSync(scratchParent, { recursive: true });
const scratchRoot = fs.mkdtempSync(path.join(scratchParent, 'ccm-provider-guidance-'));

function manifestFromFreshFinalProjection(host, skill) {
  const staging = fs.mkdtempSync(path.join(scratchRoot, `${host}-${skill}-`));
  const plan = planSkillProjection({ repoRoot: root, host, skill });
  if (plan.mode === 'planned') {
    throw new Error(`cannot attest planned skill ${host}/${skill}`);
  }
  applySkillProjection(plan, staging);
  applyFinalSkillOverlay({
    repoRoot: root,
    host,
    skill,
    skillTree: staging,
    stagingRoot: scratchRoot,
  });
  return providerGuidanceRuntimeManifest(staging);
}

try {
  const hosts = {};
  for (const host of HOSTS) {
    const skills = {};
    for (const skill of SKILLS) {
      skills[skill] = manifestFromFreshFinalProjection(host, skill);
    }
    hosts[host] = { skills };
  }

  // Only after ALL host/skill projections succeed: atomic registry publish.
  atomicWriteJson(target, {
    schema: REGISTRY_SCHEMA,
    facts_registry: factsRegistry,
    projection_as_of: projectionAsOf,
    hosts,
  });
} finally {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
  try {
    fs.rmdirSync(scratchParent);
  } catch {
    // parent may be non-empty or absent
  }
}
