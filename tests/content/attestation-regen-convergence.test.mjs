// Regression for issue #163: the sanctioned attestation-regen entry must converge a legitimate
// change to an attested skill's file set, where a naive `sync` alone deadlocks.
//
// Mechanism under test: the update-*-attestations scripts recompute the SHA-256 registries by
// projecting the CANONICAL source through the shared projection SSOT (project-skill.cjs), not by
// reading the already-published plugin/dist tree. Because sync refuses to publish an attested tree
// until it matches the registry, reading dist to regenerate the registry can never move a changed
// attested skill forward (stale dist ⇄ stale registry). Projecting canonical dissolves that cycle;
// the assert-on sync then independently re-proves dist == registry == canonical.
//
// The fixture is an isolated temp repo (plugin/src/skills + facts + the attestation scripts) so the
// test never touches the real worktree and needs no git.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');
const HOSTS = ['claude-code', 'codex', 'cursor', 'kimi-code'];
const PROBES = [
  // provider-guidance-only attested skill:
  { skill: 'master-orchestrator-guide', file: 'references/zzz-regen-probe.md' },
  // dual-attested (provider-guidance + pacing read-only) skill: exercises both registries at once:
  { skill: 'pacing-and-estimation', file: 'references/zzz-regen-probe.md' },
];
const SCRIPTS = [
  'sync-plugin-dist.sh',
  'project-skill.cjs',
  'pacing-read-only-capability.cjs',
  'pacing-read-only-attestation.cjs',
  'provider-guidance-attestation.cjs',
  'update-provider-guidance-attestations.cjs',
  'update-pacing-read-only-attestations.cjs',
];
const PG_REGISTRY = 'plugin/src/skills/provider-guidance-runtime.json';
const PACE_REGISTRY = 'plugin/src/skills/pacing-and-estimation/read-only-capability.json';

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-attest-regen-'));
  mkdirSync(join(root, 'plugin/src'), { recursive: true });
  mkdirSync(join(root, 'ccm/apps/cli/src'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(join(ROOT, 'plugin/src/skills'), join(root, 'plugin/src/skills'), { recursive: true });
  cpSync(
    join(ROOT, 'ccm/apps/cli/src/provider-model-facts.json'),
    join(root, 'ccm/apps/cli/src/provider-model-facts.json'),
  );
  for (const script of SCRIPTS) cpSync(join(ROOT, 'scripts', script), join(root, 'scripts', script));
  return root;
};

const syncSkills = (root, host) =>
  spawnSync('bash', ['scripts/sync-plugin-dist.sh', '--host', host, '--skills-only'], {
    cwd: root,
    encoding: 'utf8',
  });

// Assert-on sync for every host — the untouched safety net. Passing proves dist == registry.
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

// The sanctioned regen: recompute both registries straight from canonical projection.
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
    // And the committed registries must still assert clean against a fresh projection.
    syncAll(root, 'clean-tree');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sanctioned regen converges an added attested file that naive sync deadlocks on', () => {
  const root = fixture();
  try {
    // Baseline: the copied registries already assert clean.
    syncAll(root, 'baseline');

    // Legitimately add a new attested canonical file to two attested skills.
    for (const probe of PROBES) {
      writeFileSync(
        join(root, `plugin/src/skills/${probe.skill}/canonical/${probe.file}`),
        `# regen probe\n\nsynthetic new attested file for ${probe.skill}.\n`,
      );
    }

    // Reproduce the deadlock: naive sync alone must reject the new tree (registry has no such file).
    const naive = syncSkills(root, 'claude-code');
    assert.notEqual(naive.status, 0, 'naive sync must fail before regen (chicken-and-egg)');
    assert.match(
      `${naive.stdout}\n${naive.stderr}`,
      /file set mismatch|attestation/iu,
      'the deadlock must surface as an attestation file-set mismatch',
    );

    // Sanctioned regen from canonical, then assert-on sync for every host must now pass.
    regen(root);
    syncAll(root, 'post-regen');

    // Convergence: every host's dist carries the new files; both registries record their digests.
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

    // Idempotence: a second regen reaches the same fixed point (no drift).
    regen(root);
    assert.equal(readFileSync(join(root, PG_REGISTRY), 'utf8'), pgReg, 'regen must be idempotent (provider-guidance)');
    assert.equal(readFileSync(join(root, PACE_REGISTRY), 'utf8'), paceReg, 'regen must be idempotent (pacing read-only)');
    syncAll(root, 're-verify');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
