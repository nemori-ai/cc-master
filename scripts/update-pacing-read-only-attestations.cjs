#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  loadPacingReadOnlyRegistry,
  renderPacingReadOnlyCapability,
} = require('./pacing-read-only-capability.cjs');
const { pacingRuntimeManifest } = require('./pacing-read-only-attestation.cjs');

const root = path.resolve(__dirname, '..');
const target = path.join(
  root,
  'plugin/src/skills/pacing-and-estimation/read-only-capability.json',
);
const registry = loadPacingReadOnlyRegistry(target);

for (const host of Object.keys(registry.hosts)) {
  const body = renderPacingReadOnlyCapability(registry, host);
  registry.hosts[host].rendered_body_sha256 = crypto
    .createHash('sha256')
    .update(body, 'utf8')
    .digest('hex');
  registry.hosts[host].rendered_runtime_manifest = pacingRuntimeManifest(
    path.join(root, 'plugin/dist', host, 'skills/pacing-and-estimation'),
  );
}

fs.writeFileSync(target, `${JSON.stringify(registry, null, 2)}\n`);
