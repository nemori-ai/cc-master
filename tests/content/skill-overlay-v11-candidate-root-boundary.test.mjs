/**
 * K1-06 v11 — runCompile candidate root must be a direct controlled sibling of
 * plugin/dist (lexical dirname + realpath parent + segment lstat chain).
 *
 * Proves via internal runCompile entry, not by calling
 * resolveTrustedCandidateHostDist alone.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
const FINGERPRINT = 'V11-CANDIDATE-FINGERPRINT-MUST-NOT-LEAK';
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

function fixture(prefix = 'ccm-skg-v11-') {
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
  fs.writeFileSync(
    skillMd,
    `${raw}\n<!-- ccm:k:nav:start ${FINGERPRINT}\n${FINGERPRINT} broken open\n`,
  );
}

function closedSetTreeDigest(rootAbsolute) {
  const rows = [];
  const visit = (directory, relativePrefix) => {
    if (!fs.existsSync(directory)) return;
    for (const dirent of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const absolute = path.join(directory, dirent.name);
      const relative = relativePrefix ? `${relativePrefix}/${dirent.name}` : dirent.name;
      if (dirent.isSymbolicLink()) {
        rows.push(`symlink:${relative}->${fs.readlinkSync(absolute)}`);
        continue;
      }
      if (dirent.isDirectory()) {
        rows.push(`dir:${relative}`);
        visit(absolute, relative);
        continue;
      }
      if (dirent.isFile()) {
        rows.push(`file:${relative}:${fs.readFileSync(absolute).toString('hex')}`);
      }
    }
  };
  visit(rootAbsolute, '');
  return crypto.createHash('sha256').update(rows.join('\n'), 'utf8').digest('hex');
}

function assertCandidateGate(result, label) {
  assert.notEqual(result.exitCode, 0, `${label}: must fail closed`);
  assert.notEqual(result.body?.ok, true, `${label}: must not return ok true`);
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

test('v11: nested direct-name candidate under plugin/dist/uncontrolled fails before read', () => {
  const root = fixture('ccm-skg-v11-nested-');
  try {
    assert.equal(syncFull(root).status, 0);
    const liveHost = path.join(root, 'plugin/dist', HOST);
    const liveBefore = closedSetTreeDigest(liveHost);

    const nestedParent = path.join(root, 'plugin/dist', 'uncontrolled');
    fs.mkdirSync(nestedParent, { recursive: true });
    const candidate = path.join(nestedParent, `${HOST}.write-nested`);
    fs.cpSync(liveHost, candidate, { recursive: true });
    plantMalformedFingerprint(candidate);

    const result = runCompile({
      repoRoot: root,
      host: HOST,
      candidateHostRoot: candidate,
      check: false,
    });
    assertCandidateGate(result, 'runCompile nested direct-name');
    assert.equal(
      closedSetTreeDigest(liveHost),
      liveBefore,
      'live host bytes must stay unchanged on nested refusal',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('v11: repo-internal symlink ancestor / cross-surface fails; target bytes unchanged', () => {
  const root = fixture('ccm-skg-v11-alias-');
  try {
    assert.equal(syncFull(root).status, 0);
    const liveHost = path.join(root, 'plugin/dist', HOST);
    const liveBefore = closedSetTreeDigest(liveHost);

    const crossSurface = path.join(root, 'plugin', 'cross-surface-target');
    fs.mkdirSync(crossSurface, { recursive: true });
    const alias = path.join(root, 'plugin/dist', 'alias');
    fs.symlinkSync(crossSurface, alias);

    const candidate = path.join(alias, `${HOST}.write-cross-surface`);
    fs.cpSync(liveHost, candidate, { recursive: true });
    plantMalformedFingerprint(candidate);
    // Remove knowledge so a successful compile would recreate atlas outside dist.
    const candKnowledge = path.join(candidate, 'knowledge');
    if (fs.existsSync(candKnowledge)) {
      fs.rmSync(candKnowledge, { recursive: true, force: true });
    }

    const targetRoot = path.join(crossSurface, `${HOST}.write-cross-surface`);
    const targetBefore = closedSetTreeDigest(targetRoot);
    const atlasPath = path.join(targetRoot, 'knowledge', 'atlas.md');
    assert.equal(fs.existsSync(atlasPath), false, 'precondition: no atlas outside dist');

    const result = runCompile({
      repoRoot: root,
      host: HOST,
      candidateHostRoot: candidate,
      check: false,
    });
    assertCandidateGate(result, 'runCompile symlink-ancestor cross-surface');
    assert.equal(fs.existsSync(atlasPath), false, 'must not write knowledge/atlas.md outside dist');
    assert.equal(
      closedSetTreeDigest(targetRoot),
      targetBefore,
      'cross-surface target bytes must stay unchanged',
    );
    assert.equal(
      closedSetTreeDigest(liveHost),
      liveBefore,
      'live host bytes must stay unchanged on symlink-ancestor refusal',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('v11: legal direct sibling plugin/dist/<host>.write-<stamp> still passes', () => {
  const root = fixture('ccm-skg-v11-ok-');
  try {
    assert.equal(syncFull(root).status, 0);
    const liveHost = path.join(root, 'plugin/dist', HOST);
    const stamp = `v11-ok-${process.pid}-${Date.now()}`;
    const candidate = path.join(root, 'plugin/dist', `${HOST}.write-${stamp}`);
    fs.cpSync(liveHost, candidate, { recursive: true });

    const result = runCompile({
      repoRoot: root,
      host: HOST,
      candidateHostRoot: candidate,
      check: false,
    });
    assert.equal(result.exitCode, 0, JSON.stringify(result.body?.diagnostics ?? result.body));
    assert.equal(result.body?.ok, true);
    assert.ok(fs.existsSync(path.join(candidate, 'knowledge', 'atlas.md')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
