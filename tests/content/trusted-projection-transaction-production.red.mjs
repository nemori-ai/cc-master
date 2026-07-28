import assert from 'node:assert/strict';
import test from 'node:test';

import { runScenario } from './helpers/trusted-projection/scenario-harness.mjs';

const SCENARIOS = [
  {
    name: 'legal extra artifact plus real post-publish fault must leave live unchanged',
    input: {
      host: 'claude-code',
      surface: 'host',
      mutation: 'add-legal-artifact-after-attestation',
      failpoint: 'sync-host-surface:post-publish',
      seed: 101,
    },
  },
  {
    name: 'rewrite of an existing legal artifact must be rejected before commit',
    input: {
      host: 'claude-code',
      surface: 'host',
      mutation: 'rewrite-existing-artifact-after-attestation',
      failpoint: 'none',
      seed: 102,
    },
  },
  {
    name: 'executable-mode flip must be rejected before commit',
    input: {
      host: 'claude-code',
      surface: 'host',
      mutation: 'flip-executable-bit-after-attestation',
      failpoint: 'none',
      seed: 103,
    },
  },
  {
    name: 'hardlink substitution must be rejected before commit',
    input: {
      host: 'claude-code',
      surface: 'host',
      mutation: 'replace-with-hardlink-after-attestation',
      failpoint: 'none',
      seed: 104,
    },
  },
  {
    name: 'post-publish fault must not report nonzero after changing live',
    input: {
      host: 'claude-code',
      surface: 'host',
      mutation: 'none',
      failpoint: 'sync-host-surface:post-publish',
      seed: 105,
    },
  },
  {
    name: 'source drift after current attestation must invalidate the transaction',
    input: {
      host: 'claude-code',
      surface: 'host',
      mutation: 'mutate-source-after-attestation',
      failpoint: 'none',
      seed: 106,
    },
  },
];

for (const { name, input } of SCENARIOS) {
  test(`TPT-PRODUCTION-RED: ${name}`, () => {
    const witness = runScenario(input);
    assert.equal(
      witness.contract.ok,
      true,
      JSON.stringify(
        {
          scenario_id: witness.scenario_id,
          operator: witness.operator,
          outcome: witness.outcome,
          violations: witness.contract.violations,
        },
        null,
        2,
      ),
    );
  });
}
