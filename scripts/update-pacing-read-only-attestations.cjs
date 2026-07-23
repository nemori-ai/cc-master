#!/usr/bin/env node
'use strict';

// Regenerate plugin/src/skills/pacing-and-estimation/read-only-capability.json — the sanctioned
// entry for updating the pacing read-only attestation registry after the pacing skill's canonical
// content, file set, or rendered read-only-capability slot changes (issue #163 / K1-06).
//
// Both the rendered-body digest and the runtime-tree manifest are derived from a single fresh
// projection through the shared projection SSOT (project-skill.cjs): planSkillProjection renders the
// read-only-capability slot body, applySkillProjection materializes the tree into a scratch dir,
// shared final skill overlay is applied, and the manifest fingerprints that final tree.
// Registry bytes are published atomically only after every host succeeds.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadPacingReadOnlyRegistry } = require('./pacing-read-only-capability.cjs');
const { pacingRuntimeManifest } = require('./pacing-read-only-attestation.cjs');
const {
  applyFinalSkillOverlay,
  applySkillProjection,
  planSkillProjection,
} = require('./project-skill.cjs');

const root = path.resolve(__dirname, '..');
const target = path.join(
  root,
  'plugin/src/skills/pacing-and-estimation/read-only-capability.json',
);
const registry = loadPacingReadOnlyRegistry(target);

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

const scratchParent = path.join(root, '.tmp');
fs.mkdirSync(scratchParent, { recursive: true });
const scratchRoot = fs.mkdtempSync(path.join(scratchParent, 'ccm-pacing-read-only-'));

try {
  const next = structuredClone
    ? structuredClone(registry)
    : JSON.parse(JSON.stringify(registry));
  for (const host of Object.keys(next.hosts)) {
    const staging = fs.mkdtempSync(path.join(scratchRoot, `${host}-`));
    const plan = planSkillProjection({ repoRoot: root, host, skill: 'pacing-and-estimation' });
    applySkillProjection(plan, staging);
    applyFinalSkillOverlay({
      repoRoot: root,
      host,
      skill: 'pacing-and-estimation',
      skillTree: staging,
      stagingRoot: scratchRoot,
    });
    next.hosts[host].rendered_body_sha256 = crypto
      .createHash('sha256')
      .update(plan.pacingRenderedBody, 'utf8')
      .digest('hex');
    next.hosts[host].rendered_runtime_manifest = pacingRuntimeManifest(staging);
  }
  atomicWriteJson(target, next);
} finally {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
  try {
    fs.rmdirSync(scratchParent);
  } catch {
    // parent may be non-empty or absent
  }
}
