#!/usr/bin/env node
'use strict';

// Regenerate plugin/src/skills/provider-guidance-runtime.json — the sanctioned entry for updating
// the provider-guidance attestation registry after an attested skill's canonical content or file
// set changes (issue #163).
//
// The registry is recomputed by projecting each (host, skill) canonical tree through the shared
// projection SSOT (project-skill.cjs) into a scratch dir and fingerprinting that fresh projection —
// NOT by reading the already-published plugin/dist tree. Reading dist created the sync↔update
// deadlock: sync refuses to publish a new dist tree until it matches the registry, so a stale
// registry kept dist stale and stale dist kept the registry stale. Projecting canonical here breaks
// the cycle: the registry is derived straight from source, then `bash scripts/sync-plugin-dist.sh`
// (assert-on, unchanged) re-projects and asserts dist == registry == canonical as the safety net.
//
// This is a faithful mechanical regeneration: the exact same planSkillProjection + applySkillProjection
// that sync asserts against produce the tree fingerprinted here. It never hand-writes dist, never
// edits a strategy contract, and never disables sync's assert.

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

// Project one skill's canonical tree for one host into a scratch dir via the shared projection SSOT,
// then fingerprint it. The scratch dir is discarded — only its manifest is recorded.
function manifestFromFreshProjection(host, skill) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), `ccm-provider-guidance-${host}-${skill}-`));
  try {
    const plan = planSkillProjection({ repoRoot: root, host, skill });
    if (plan.mode === 'planned') {
      throw new Error(`cannot attest planned skill ${host}/${skill}`);
    }
    applySkillProjection(plan, staging);
    return providerGuidanceRuntimeManifest(staging);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

const hosts = {};
for (const host of HOSTS) {
  const skills = {};
  for (const skill of SKILLS) {
    skills[skill] = manifestFromFreshProjection(host, skill);
  }
  hosts[host] = { skills };
}

fs.writeFileSync(
  target,
  `${JSON.stringify(
    {
      schema: REGISTRY_SCHEMA,
      facts_registry: factsRegistry,
      projection_as_of: projectionAsOf,
      hosts,
    },
    null,
    2,
  )}\n`,
);
