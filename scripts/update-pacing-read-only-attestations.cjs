#!/usr/bin/env node
'use strict';

// Regenerate plugin/src/skills/pacing-and-estimation/read-only-capability.json — the sanctioned
// entry for updating the pacing read-only attestation registry after the pacing skill's canonical
// content, file set, or rendered read-only-capability slot changes (issue #163).
//
// Both the rendered-body digest and the runtime-tree manifest are derived from a single fresh
// projection through the shared projection SSOT (project-skill.cjs): planSkillProjection renders the
// read-only-capability slot body, applySkillProjection materializes the tree into a scratch dir, and
// the manifest fingerprints that tree — the very body it embeds. This replaces the old path of
// reading the already-published plugin/dist tree, which deadlocked against sync (sync refuses to
// publish a tree that does not match the registry, so stale dist and stale registry pinned each
// other). Projecting canonical breaks the cycle; `bash scripts/sync-plugin-dist.sh` (assert-on,
// unchanged) then re-asserts dist == registry == canonical as the safety net.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPacingReadOnlyRegistry } = require('./pacing-read-only-capability.cjs');
const { pacingRuntimeManifest } = require('./pacing-read-only-attestation.cjs');
const {
  applySkillProjection,
  planSkillProjection,
} = require('./project-skill.cjs');

const root = path.resolve(__dirname, '..');
const target = path.join(
  root,
  'plugin/src/skills/pacing-and-estimation/read-only-capability.json',
);
const registry = loadPacingReadOnlyRegistry(target);

for (const host of Object.keys(registry.hosts)) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), `ccm-pacing-read-only-${host}-`));
  try {
    const plan = planSkillProjection({ repoRoot: root, host, skill: 'pacing-and-estimation' });
    applySkillProjection(plan, staging);
    registry.hosts[host].rendered_body_sha256 = crypto
      .createHash('sha256')
      .update(plan.pacingRenderedBody, 'utf8')
      .digest('hex');
    registry.hosts[host].rendered_runtime_manifest = pacingRuntimeManifest(staging);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

fs.writeFileSync(target, `${JSON.stringify(registry, null, 2)}\n`);
