/**
 * K1-06 v10 — runCompile entry must trust-check candidateHostRoot before any
 * candidate path concat / exists / lstat / read / loader / overlay / verifier.
 *
 * Proves via internal compile entry (runCompile + compile-candidate-host.mjs),
 * not by calling resolveTrustedCandidateHostDist alone.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { copyMinimalSkillKnowledgeRepo } from './helpers/skill-knowledge-isolated-repo.mjs';
import { runCompile } from '../../scripts/skill-knowledge/compile.mjs';

const HOST = 'claude-code';
const SKILL = 'master-orchestrator-guide';
const FINGERPRINT = 'V10-CANDIDATE-FINGERPRINT-MUST-NOT-LEAK';
const COMPILE_CANDIDATE = 'scripts/skill-knowledge/compile-candidate-host.mjs';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const CANDIDATE_CODES = new Set([
  'SKG-COMPILE-CANDIDATE-ESCAPE',
  'SKG-COMPILE-CANDIDATE-NAMESPACE',
  'SKG-COMPILE-CANDIDATE-INVALID',
  'SKG-COMPILE-CANDIDATE-OUTSIDE-REPO',
  'SKG-COMPILE-ANCESTOR-SYMLINK',
  'SKG-COMPILE-ANCESTOR-MISSING',
  'SKG-COMPILE-ANCESTOR-NOT-DIR',
  'SKG-COMPILE-DIST-OUTSIDE-REPO',
  'SKG-COMPILE-REPO-REALPATH',
]);

function fixture(prefix = 'ccm-skg-v10-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  copyMinimalSkillKnowledgeRepo(root);
  return root;
}

function syncFull(root, host = HOST) {
  return spawnSync('bash', ['scripts/sync-plugin-dist.sh', '--host', host], {
    cwd: root,
    encoding: 'utf8',
  });
}

function plantMalformedFingerprint(candidateRoot) {
  const skillMd = path.join(candidateRoot, 'skills', SKILL, 'SKILL.md');
  assert.ok(fs.existsSync(skillMd), `expected skill markdown at ${skillMd}`);
  const raw = fs.readFileSync(skillMd, 'utf8');
  // Unclosed nav open → SKG-OVERLAY-MALFORMED → SKG-COMPILE-SKILL-OVERLAY if read.
  fs.writeFileSync(
    skillMd,
    `${raw}\n<!-- ccm:k:nav:start ${FINGERPRINT}\n${FINGERPRINT} broken open\n`,
  );
}

function assertCandidateGate(result, label) {
  assert.notEqual(result.exitCode, 0, `${label}: must fail closed`);
  const diagnostics = result.body?.diagnostics ?? [];
  const codes = diagnostics.map((item) => item.code);
  const blob = JSON.stringify(result.body ?? {});
  assert.ok(
    codes.some((code) => CANDIDATE_CODES.has(code)),
    `${label}: expected candidate trust diagnostic, got ${codes.join(',') || '(none)'}`,
  );
  assert.ok(
    !codes.includes('SKG-COMPILE-SKILL-OVERLAY'),
    `${label}: must not surface SKG-COMPILE-SKILL-OVERLAY before candidate trust`,
  );
  assert.ok(
    !blob.includes(FINGERPRINT),
    `${label}: candidate fingerprint must not leak into diagnostics (content was read too early)`,
  );
}

function spawnCompileCandidate(repoRoot, host, candidateRoot) {
  return spawnSync(
    process.execPath,
    [
      COMPILE_CANDIDATE,
      '--repo-root',
      repoRoot,
      '--host',
      host,
      '--candidate-root',
      candidateRoot,
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
}

test('v10: external sibling candidate fails with CANDIDATE-* before overlay read (runCompile)', () => {
  const root = fixture('ccm-skg-v10-escape-');
  const park = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-v10-park-'));
  try {
    assert.equal(syncFull(root).status, 0);
    // Sibling of the isolated repo (outside repoRoot), named like a controlled candidate.
    const candidate = path.join(
      path.dirname(root),
      `${HOST}.write-escape-${process.pid}-${Date.now()}`,
    );
    fs.cpSync(path.join(root, 'plugin/dist', HOST), candidate, { recursive: true });
    plantMalformedFingerprint(candidate);

    const result = runCompile({
      repoRoot: root,
      host: HOST,
      candidateHostRoot: candidate,
      check: false,
    });
    assertCandidateGate(result, 'runCompile external sibling');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(park, { recursive: true, force: true });
    for (const name of fs.readdirSync(path.dirname(root))) {
      if (name.startsWith(`${HOST}.write-escape-`)) {
        fs.rmSync(path.join(path.dirname(root), name), { recursive: true, force: true });
      }
    }
  }
});

test('v10: namespace similar-prefix candidate fails before overlay read (compile-candidate-host)', () => {
  const root = fixture('ccm-skg-v10-ns-');
  try {
    assert.equal(syncFull(root).status, 0);
    // Inside plugin/dist but wrong namespace: similar prefix to `${HOST}.write-`
    // without the required `<host>.write-` controlled sibling naming.
    const candidate = path.join(
      root,
      'plugin/dist',
      `${HOST}-extra.write-ns-${process.pid}`,
    );
    fs.cpSync(path.join(root, 'plugin/dist', HOST), candidate, { recursive: true });
    plantMalformedFingerprint(candidate);

    const spawned = spawnCompileCandidate(root, HOST, candidate);
    assert.notEqual(spawned.status, 0, spawned.stderr || spawned.stdout);
    let body;
    try {
      body = JSON.parse(spawned.stdout.trim().split('\n').at(-1));
    } catch {
      body = { diagnostics: [], raw: spawned.stdout };
    }
    assertCandidateGate({ exitCode: spawned.status ?? 1, body }, 'compile-candidate-host namespace');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('v10: symlink-alias candidate fails before overlay read (runCompile)', () => {
  const root = fixture('ccm-skg-v10-symlink-');
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-v10-alias-'));
  try {
    assert.equal(syncFull(root).status, 0);
    fs.cpSync(path.join(root, 'plugin/dist', HOST), external, { recursive: true });
    plantMalformedFingerprint(external);

    const candidate = path.join(
      root,
      'plugin/dist',
      `${HOST}.write-alias-${process.pid}`,
    );
    fs.symlinkSync(external, candidate);

    const result = runCompile({
      repoRoot: root,
      host: HOST,
      candidateHostRoot: candidate,
      check: false,
    });
    assertCandidateGate(result, 'runCompile symlink alias');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('v10: controlled <host>.write-<stamp> candidate still passes full sync', () => {
  const root = fixture('ccm-skg-v10-ok-');
  try {
    const first = syncFull(root);
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const second = syncFull(root);
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.ok(fs.existsSync(path.join(root, 'plugin/dist', HOST, 'knowledge', 'atlas.md')));
    assert.ok(
      fs.existsSync(path.join(root, 'plugin/dist', HOST, 'skills', SKILL, 'SKILL.md')),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
