#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  HOSTS,
  REGISTRY_SCHEMA,
  SKILLS,
  providerGuidanceRuntimeManifest,
  validateProviderModelFactsRegistry,
} = require('./provider-guidance-attestation.cjs');

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

const hosts = {};
for (const host of HOSTS) {
  const skills = {};
  for (const skill of SKILLS) {
    skills[skill] = providerGuidanceRuntimeManifest(
      path.join(root, 'plugin/dist', host, 'skills', skill),
    );
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
