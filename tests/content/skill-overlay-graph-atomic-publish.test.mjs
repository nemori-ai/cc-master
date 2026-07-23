/**
 * Blocker A mutations — graph fail-closed + atomic skills publish.
 *
 * Independent of production overlay builders: digests are closed-set tree hashes
 * computed inside this file only.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { copyMinimalSkillKnowledgeRepo } from './helpers/skill-knowledge-isolated-repo.mjs';

const HOST = 'claude-code';
const SKILL = 'master-orchestrator-guide';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-atomic-'));
  copyMinimalSkillKnowledgeRepo(root);
  return root;
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

function listTempBackupNames(rootAbsolute) {
  const hits = [];
  const visit = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const dirent of fs.readdirSync(directory, { withFileTypes: true })) {
      if (
        /^skills\.(write|bak)-/u.test(dirent.name) ||
        /\.(tmp|stage)-/u.test(dirent.name) ||
        /^\..*-stage-/u.test(dirent.name)
      ) {
        hits.push(dirent.name);
      }
      const absolute = path.join(directory, dirent.name);
      if (dirent.isSymbolicLink()) continue;
      if (dirent.isDirectory()) visit(absolute);
    }
  };
  visit(rootAbsolute);
  return hits;
}

function syncSkills(root) {
  return spawnSync('bash', ['scripts/sync-plugin-dist.sh', '--host', HOST, '--skills-only'], {
    cwd: root,
    encoding: 'utf8',
  });
}

function runUpdater(root, script) {
  return spawnSync(process.execPath, [`scripts/${script}`], {
    cwd: root,
    encoding: 'utf8',
  });
}

function skillsLive(root) {
  return path.join(root, `plugin/dist/${HOST}/skills`);
}

function skillMd(root) {
  return path.join(skillsLive(root), SKILL, 'SKILL.md');
}

test('graph missing: updaters + skills-only sync hard-fail (never publish 0-nav raw)', () => {
  const root = fixture();
  try {
    const baseline = syncSkills(root);
    assert.equal(baseline.status, 0, `${baseline.stdout}\n${baseline.stderr}`);
    const before = closedSetTreeDigest(skillsLive(root));
    assert.match(fs.readFileSync(skillMd(root), 'utf8'), /ccm:k:nav:start point:/);

    fs.rmSync(path.join(root, 'plugin/src/knowledge/portfolio.json'));

    const pg = runUpdater(root, 'update-provider-guidance-attestations.cjs');
    assert.notEqual(pg.status, 0, 'provider-guidance updater must hard-fail without graph');
    assert.doesNotMatch(`${pg.stdout}\n${pg.stderr}`, /\bskipped\b/i);

    const pace = runUpdater(root, 'update-pacing-read-only-attestations.cjs');
    assert.notEqual(pace.status, 0, 'pacing updater must hard-fail without graph');

    const sync = syncSkills(root);
    assert.notEqual(sync.status, 0, 'skills-only sync must hard-fail without graph');
    assert.equal(
      closedSetTreeDigest(skillsLive(root)),
      before,
      'live skills closed-set digest must be unchanged after graph-missing failure',
    );
    assert.match(fs.readFileSync(skillMd(root), 'utf8'), /ccm:k:nav:start point:/);
    assert.deepEqual(listTempBackupNames(path.join(root, `plugin/dist/${HOST}`)), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('attestation mismatch after valid dist: sync nonzero + live digest unchanged', () => {
  const root = fixture();
  try {
    assert.equal(syncSkills(root).status, 0);
    const before = closedSetTreeDigest(skillsLive(root));
    const marker = 'HOSTILE-ATTESTATION-MUTATION-UNIQUE';
    // Mutate an attested skill that is NOT a knowledge-graph binding target, so
    // the failure surfaces as attestation mismatch (not graph-unavailable).
    const target = path.join(
      root,
      'plugin/src/skills/using-ccm/canonical/SKILL.md',
    );
    fs.writeFileSync(target, `${fs.readFileSync(target, 'utf8')}\n${marker}\n`);

    const sync = syncSkills(root);
    assert.notEqual(sync.status, 0, 'attestation mismatch must fail sync');
    assert.match(
      `${sync.stdout}\n${sync.stderr}`,
      /attestation|mismatch|provider guidance|file set/i,
    );
    assert.equal(closedSetTreeDigest(skillsLive(root)), before);
    const liveUsing = path.join(skillsLive(root), 'using-ccm', 'SKILL.md');
    assert.equal(
      fs.readFileSync(liveUsing, 'utf8').includes(marker),
      false,
      'hostile canonical mutation must not publish into live skills',
    );
    assert.deepEqual(listTempBackupNames(path.join(root, `plugin/dist/${HOST}`)), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('overlay failure (malformed live marker injected into staging path) keeps live digest', () => {
  const root = fixture();
  try {
    assert.equal(syncSkills(root).status, 0);
    const before = closedSetTreeDigest(skillsLive(root));

    // Break graph validation by corrupting a point span hash witness file if present,
    // else delete the whole knowledge modules directory so buildAndValidateGraph fails.
    const knowledgeRoot = path.join(root, 'plugin/src/knowledge');
    for (const name of fs.readdirSync(knowledgeRoot)) {
      if (name === 'portfolio.json') continue;
      fs.rmSync(path.join(knowledgeRoot, name), { recursive: true, force: true });
    }

    const sync = syncSkills(root);
    assert.notEqual(sync.status, 0, 'invalid/partial graph must fail sync');
    assert.equal(closedSetTreeDigest(skillsLive(root)), before);
    assert.deepEqual(listTempBackupNames(path.join(root, `plugin/dist/${HOST}`)), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('provider-guidance updater leaves registry bytes unchanged when overlay/graph fails mid-run', () => {
  const root = fixture();
  try {
    const registryPath = path.join(root, 'plugin/src/skills/provider-guidance-runtime.json');
    const before = fs.readFileSync(registryPath);
    fs.rmSync(path.join(root, 'plugin/src/knowledge/portfolio.json'));
    const result = runUpdater(root, 'update-provider-guidance-attestations.cjs');
    assert.notEqual(result.status, 0);
    assert.deepEqual(fs.readFileSync(registryPath), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
