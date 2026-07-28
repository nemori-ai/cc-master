// Regression for issue #163 / K1-06: the sanctioned attestation-regen entry must converge a
// legitimate change to an attested skill's file set, where a naive `sync` alone deadlocks.
//
// Mechanism under test: update-*-attestations recompute SHA-256 registries by projecting CANONICAL
// → raw SAP → shared compiler-owned final skill overlay → fingerprint final runtime skill tree —
// never by reading checked-in plugin/dist. sync asserts the same final tree before publish.
//
// Fixture: isolated temp repo copy (skill-knowledge-isolated-repo helper) so the test never touches
// the real worktree and has enough surface for overlay + attestation.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  copyMinimalSkillKnowledgeRepo,
} from './helpers/skill-knowledge-isolated-repo.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import guidanceAttestation from '../../scripts/provider-guidance-attestation.cjs';

const ROOT = join(import.meta.dirname, '..', '..');
const HOSTS = ['claude-code', 'codex', 'cursor', 'kimi-code'];
const PROBES = [
  // Knowledge-graph-covered skills (master-orchestrator-guide) cannot gain arbitrary
  // canonical markdown without inventory/coverage updates; probe attested skills
  // outside authored graph coverage so the deadlock surfaces at attestation.
  { skill: 'using-ccm', file: 'references/zzz-regen-probe.md' },
  { skill: 'pacing-and-estimation', file: 'references/zzz-regen-probe.md' },
];
const PG_REGISTRY = 'plugin/src/skills/provider-guidance-runtime.json';
const PACE_REGISTRY = 'plugin/src/skills/pacing-and-estimation/read-only-capability.json';

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-attest-regen-'));
  copyMinimalSkillKnowledgeRepo(root);
  return root;
};

const syncSkills = (root, host) =>
  spawnSync('bash', ['scripts/sync-plugin-dist.sh', '--host', host, '--skills-only'], {
    cwd: root,
    encoding: 'utf8',
  });

const syncAll = (root, label) => {
  for (const host of HOSTS) {
    const result = syncSkills(root, host);
    assert.equal(
      result.status,
      0,
      `${label}: assert-on sync must pass for ${host}\n${result.stdout}\n${result.stderr}`,
    );
  }
};

const regen = (root) => {
  for (const script of [
    'update-provider-guidance-attestations.cjs',
    'update-pacing-read-only-attestations.cjs',
  ]) {
    const result = spawnSync('node', [`scripts/${script}`], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, `${script} must succeed\n${result.stdout}\n${result.stderr}`);
  }
};

test('regen on a clean tree is a faithful no-op (registries byte-stable)', () => {
  const root = fixture();
  try {
    const before = {
      pg: readFileSync(join(root, PG_REGISTRY), 'utf8'),
      pace: readFileSync(join(root, PACE_REGISTRY), 'utf8'),
    };
    regen(root);
    assert.equal(readFileSync(join(root, PG_REGISTRY), 'utf8'), before.pg, 'provider-guidance registry must be unchanged');
    assert.equal(readFileSync(join(root, PACE_REGISTRY), 'utf8'), before.pace, 'pacing read-only registry must be unchanged');
    syncAll(root, 'clean-tree');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sanctioned regen converges an added attested file that naive sync deadlocks on', () => {
  const root = fixture();
  try {
    syncAll(root, 'baseline');

    for (const probe of PROBES) {
      writeFileSync(
        join(root, `plugin/src/skills/${probe.skill}/canonical/${probe.file}`),
        `# regen probe\n\nsynthetic new attested file for ${probe.skill}.\n`,
      );
    }

    const naive = syncSkills(root, 'claude-code');
    assert.notEqual(naive.status, 0, 'naive sync must fail before regen (chicken-and-egg)');
    assert.match(
      `${naive.stdout}\n${naive.stderr}`,
      /file set mismatch|attestation/iu,
      'the deadlock must surface as an attestation file-set mismatch',
    );

    regen(root);
    syncAll(root, 'post-regen');

    for (const host of HOSTS) {
      for (const probe of PROBES) {
        assert.ok(
          existsSync(join(root, `plugin/dist/${host}/skills/${probe.skill}/${probe.file}`)),
          `${host}/${probe.skill}/${probe.file} must be published to dist`,
        );
      }
    }
    const pgReg = readFileSync(join(root, PG_REGISTRY), 'utf8');
    const paceReg = readFileSync(join(root, PACE_REGISTRY), 'utf8');
    assert.match(pgReg, /zzz-regen-probe\.md/u, 'provider-guidance registry must record the new attested files');
    assert.match(paceReg, /zzz-regen-probe\.md/u, 'pacing read-only registry must record the new attested file');

    // Final runtime manifest assert: registry digests match published final skill trees.
    const registry = guidanceAttestation.loadProviderGuidanceRegistry(
      join(root, PG_REGISTRY),
      root,
    );
    for (const host of HOSTS) {
      for (const skill of ['master-orchestrator-guide', 'pacing-and-estimation', 'using-ccm']) {
        guidanceAttestation.assertProviderGuidanceRuntimeTree(
          registry,
          host,
          skill,
          join(root, `plugin/dist/${host}/skills/${skill}`),
        );
      }
    }

    regen(root);
    assert.equal(readFileSync(join(root, PG_REGISTRY), 'utf8'), pgReg, 'regen must be idempotent (provider-guidance)');
    assert.equal(readFileSync(join(root, PACE_REGISTRY), 'utf8'), paceReg, 'regen must be idempotent (pacing read-only)');
    syncAll(root, 're-verify');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
