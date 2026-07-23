/**
 * K1-06 amendment v3 Blocker 2 — whole skills swap commit boundary.
 *
 * Uses injectable fs adapter / safe fixtures — no fragile permission tricks.
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

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-v3-swap-'));
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

function listSwapResidues(hostDist) {
  return fs
    .readdirSync(hostDist)
    .filter((name) => /^skills\.(write|bak)-/u.test(name))
    .sort();
}

test('v3: live skills symlink is refused before write; never unlinked; digest unchanged', () => {
  const root = fixture();
  try {
    assert.equal(
      spawnSync('bash', ['scripts/sync-plugin-dist.sh', '--host', HOST, '--skills-only'], {
        cwd: root,
        encoding: 'utf8',
      }).status,
      0,
    );
    const hostDist = path.join(root, `plugin/dist/${HOST}`);
    const live = path.join(hostDist, 'skills');
    const before = closedSetTreeDigest(live);
    const parked = path.join(hostDist, `skills.parked-${process.pid}`);
    fs.renameSync(live, parked);
    fs.symlinkSync(parked, live);

    const sync = spawnSync(
      'bash',
      ['scripts/sync-plugin-dist.sh', '--host', HOST, '--skills-only'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.notEqual(sync.status, 0, 'symlink live skills must be refused');
    assert.equal(fs.lstatSync(live).isSymbolicLink(), true, 'must not unlink live symlink');
    assert.equal(closedSetTreeDigest(parked), before);
    assert.match(`${sync.stderr}\n${sync.stdout}`, /symlink|real directory|refuse/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('v3: publishSkillsTree export — backup collision / second rename fail / cleanup warn', async () => {
  const mod = await import('../../scripts/skill-knowledge/publish-skills-tree.mjs');
  assert.equal(typeof mod.publishSkillsTree, 'function');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-v3-pub-'));
  try {
    const hostDist = path.join(root, 'dist-host');
    fs.mkdirSync(hostDist);
    const live = path.join(hostDist, 'skills');
    const staging = path.join(hostDist, 'skills.write-test');
    fs.mkdirSync(live);
    fs.writeFileSync(path.join(live, 'old.txt'), 'OLD\n');
    fs.mkdirSync(staging);
    fs.writeFileSync(path.join(staging, 'new.txt'), 'NEW\n');
    const oldDigest = closedSetTreeDigest(live);

    // Pre-claim backup name → must fail pre-commit with old byte-exact.
    const stamp = 'collision';
    const backup = path.join(hostDist, `skills.bak-${stamp}`);
    fs.mkdirSync(backup);
    fs.writeFileSync(path.join(backup, 'x'), 'taken\n');
    assert.throws(
      () =>
        mod.publishSkillsTree({
          hostDistAbsolute: hostDist,
          liveAbsolute: live,
          stagingAbsolute: staging,
          stamp,
        }),
      /bak|collision|pre-?claim|exists/i,
    );
    assert.equal(closedSetTreeDigest(live), oldDigest);
    assert.ok(fs.existsSync(staging), 'pre-commit failure must leave staging for cleanup caller');

    // Fresh staging after collision fixture cleanup.
    fs.rmSync(backup, { recursive: true, force: true });
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging);
    fs.writeFileSync(path.join(staging, 'new.txt'), 'NEW\n');

    // Injectable: second rename (staging→live) fails → restore old, nonzero semantics via throw.
    let renameCount = 0;
    const warnings = [];
    const failingFs = {
      ...fs,
      renameSync(from, to) {
        renameCount += 1;
        if (renameCount === 2) {
          throw new Error('injected second rename failure');
        }
        return fs.renameSync(from, to);
      },
    };
    assert.throws(
      () =>
        mod.publishSkillsTree({
          hostDistAbsolute: hostDist,
          liveAbsolute: live,
          stagingAbsolute: staging,
          stamp: 'inj2',
          fs: failingFs,
          warn: (msg) => warnings.push(String(msg)),
        }),
      /injected second rename failure/,
    );
    assert.equal(closedSetTreeDigest(live), oldDigest, 'old live restored after second rename fail');
    assert.equal(fs.readFileSync(path.join(live, 'old.txt'), 'utf8'), 'OLD\n');

    // Happy path then injectable cleanup failure → committed success + recoverable backup + warn.
    fs.rmSync(path.join(hostDist, 'skills.write-inj2'), { recursive: true, force: true });
    fs.rmSync(path.join(hostDist, 'skills.bak-inj2'), { recursive: true, force: true });
    const staging2 = path.join(hostDist, 'skills.write-ok');
    fs.mkdirSync(staging2);
    fs.writeFileSync(path.join(staging2, 'new.txt'), 'NEW\n');
    warnings.length = 0;
    let rmCalls = 0;
    const cleanupFailFs = {
      ...fs,
      readdirSync(target, options) {
        if (String(target).includes('skills.bak-okclean')) {
          throw new Error('injected cleanup failure');
        }
        return fs.readdirSync(target, options);
      },
      rmSync(target, options) {
        rmCalls += 1;
        if (String(target).includes('skills.bak-')) {
          throw new Error('injected cleanup failure');
        }
        return fs.rmSync(target, options);
      },
      rmdirSync(target, options) {
        if (String(target).includes('skills.bak-')) {
          throw new Error('injected cleanup failure');
        }
        return fs.rmdirSync(target, options);
      },
    };
    // Also wrap unlink used by recursive cleanup if publish uses custom rmNoFollow.
    const result = mod.publishSkillsTree({
      hostDistAbsolute: hostDist,
      liveAbsolute: live,
      stagingAbsolute: staging2,
      stamp: 'okclean',
      fs: cleanupFailFs,
      warn: (msg) => warnings.push(String(msg)),
    });
    assert.equal(result.ok, true);
    assert.equal(result.committed, true);
    assert.equal(fs.readFileSync(path.join(live, 'new.txt'), 'utf8'), 'NEW\n');
    assert.equal(fs.existsSync(path.join(live, 'old.txt')), false);
    if (result.backupRetained) {
      assert.ok(warnings.length > 0, 'cleanup failure must warn');
      assert.ok(
        fs.existsSync(path.join(hostDist, 'skills.bak-okclean')),
        'recoverable backup must remain',
      );
      assert.equal(
        fs.readFileSync(path.join(hostDist, 'skills.bak-okclean', 'old.txt'), 'utf8'),
        'OLD\n',
      );
    } else {
      // Alternative allowed by contract: true rollback + nonzero — not chosen here.
      assert.fail('expected commit-boundary success with backupRetained on cleanup failure');
    }
    assert.equal(rmCalls >= 0, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('v3: normal skills-only sync leaves no write/bak residues', () => {
  const root = fixture();
  try {
    const sync = spawnSync(
      'bash',
      ['scripts/sync-plugin-dist.sh', '--host', HOST, '--skills-only'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(sync.status, 0, `${sync.stdout}\n${sync.stderr}`);
    const hostDist = path.join(root, `plugin/dist/${HOST}`);
    assert.deepEqual(listSwapResidues(hostDist), []);
    assert.ok(fs.statSync(path.join(hostDist, 'skills')).isDirectory());
    assert.equal(fs.lstatSync(path.join(hostDist, 'skills')).isSymbolicLink(), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('v4: sync orchestration catch leaves collision backup byte-exact; cleans staging only', async () => {
  const { projectAndPublishSkillsSurface } = await import(
    '../../scripts/skill-knowledge/sync-skills-surface.mjs'
  );
  assert.equal(typeof projectAndPublishSkillsSurface, 'function');

  const root = fixture();
  try {
    // Establish live skills via real sync so old live has real content.
    assert.equal(
      spawnSync('bash', ['scripts/sync-plugin-dist.sh', '--host', HOST, '--skills-only'], {
        cwd: root,
        encoding: 'utf8',
      }).status,
      0,
    );
    const hostDist = path.join(root, `plugin/dist/${HOST}`);
    const live = path.join(hostDist, 'skills');
    const oldLiveDigest = closedSetTreeDigest(live);
    const stamp = 'v4-collision-seam';
    const backup = path.join(hostDist, `skills.bak-${stamp}`);
    const collisionMarker = path.join(backup, 'collision-owned.txt');
    const collisionBytes = 'collision-owner-payload\n';

    let beforePublishSawPaths = null;
    let thrown = null;
    try {
      projectAndPublishSkillsSurface({
        repoRoot: root,
        host: HOST,
        stamp,
        beforePublish({ backupAbsolute, stagingAbsolute, liveAbsolute }) {
          beforePublishSawPaths = {
            backupAbsolute,
            stagingAbsolute,
            liveAbsolute,
          };
          // Plant same-name backup AFTER initial check, BEFORE publish (TOCTOU seam).
          fs.mkdirSync(backupAbsolute, { recursive: true });
          fs.writeFileSync(collisionMarker, collisionBytes);
        },
      });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown, 'publish must fail on backup name collision');
    assert.match(String(thrown.message || thrown), /bak|collision|pre-?claim|exists/i);
    assert.ok(beforePublishSawPaths, 'beforePublish seam must run on real orchestration path');
    assert.equal(beforePublishSawPaths.backupAbsolute, backup);
    assert.equal(beforePublishSawPaths.liveAbsolute, path.resolve(live));

    // Collision backup must remain byte-exact — outer catch must NOT remove it.
    assert.ok(fs.existsSync(backup), 'wrapper catch must not delete unknown/collision backup');
    assert.equal(fs.readFileSync(collisionMarker, 'utf8'), collisionBytes);
    assert.equal(closedSetTreeDigest(live), oldLiveDigest, 'old live must stay byte-exact');
    assert.equal(fs.readFileSync(path.join(live, 'master-orchestrator-guide', 'SKILL.md'), 'utf8').length > 0, true);

    // Staging created by this orchestration must be cleaned by the wrapper catch.
    assert.equal(
      fs.existsSync(path.join(hostDist, `skills.write-${stamp}`)),
      false,
      'wrapper catch must clean its own staging',
    );
    assert.deepEqual(
      listSwapResidues(hostDist).filter((name) => name.startsWith('skills.write-')),
      [],
    );
    // Only the planted collision backup residue is expected.
    assert.deepEqual(listSwapResidues(hostDist), [`skills.bak-${stamp}`]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
