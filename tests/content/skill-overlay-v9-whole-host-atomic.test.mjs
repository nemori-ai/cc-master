/**
 * K1-06 v9 — whole-host atomic full sync + host-root integrity + Codex skills-only entry pin.
 *
 * Digests / sentinels are closed-set hashes computed in-test only (never production helpers).
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

const HOST = 'claude-code';
const CODEX = 'codex';
const ENTRY_SKILL = 'cc-master-as-master-orchestrator';
/** In-test literal fragment that must appear in Codex entry-pin final bytes. */
const CODEX_ENTRY_PIN_LITERAL = 'Knowledge entry pins for entry:master-orchestrator:';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function fixture(prefix = 'ccm-skg-v9-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

function listHostResidues(distParent) {
  if (!fs.existsSync(distParent)) return [];
  return fs
    .readdirSync(distParent)
    .filter(
      (name) =>
        /\.(write|bak)-/u.test(name) ||
        /^skills\.(write|bak)-/u.test(name) ||
        /\.(tmp|stage)-/u.test(name),
    )
    .sort();
}

function listResiduesUnder(rootAbsolute) {
  const hits = [];
  const visit = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const dirent of fs.readdirSync(directory, { withFileTypes: true })) {
      if (
        /\.(write|bak)-/u.test(dirent.name) ||
        /^skills\.(write|bak)-/u.test(dirent.name) ||
        /\.(tmp|stage)-/u.test(dirent.name)
      ) {
        hits.push(path.relative(rootAbsolute, path.join(directory, dirent.name)));
      }
      const absolute = path.join(directory, dirent.name);
      if (dirent.isSymbolicLink()) continue;
      if (dirent.isDirectory()) visit(absolute);
    }
  };
  visit(rootAbsolute);
  return hits.sort();
}

function syncFull(root, host = HOST) {
  return spawnSync('bash', ['scripts/sync-plugin-dist.sh', '--host', host], {
    cwd: root,
    encoding: 'utf8',
  });
}

function syncSkillsOnly(root, host) {
  return spawnSync('bash', ['scripts/sync-plugin-dist.sh', '--host', host, '--skills-only'], {
    cwd: root,
    encoding: 'utf8',
  });
}

function hostLive(root, host = HOST) {
  return path.join(root, 'plugin/dist', host);
}

test('v9: late graph failure keeps whole host closed-set byte-identical (no residues)', () => {
  const root = fixture('ccm-skg-v9-atomic-');
  try {
    const baseline = syncFull(root);
    assert.equal(baseline.status, 0, `${baseline.stdout}\n${baseline.stderr}`);
    const live = hostLive(root);
    assert.ok(fs.existsSync(path.join(live, 'hooks')));
    assert.ok(fs.existsSync(path.join(live, 'knowledge')));
    const before = closedSetTreeDigest(live);
    const beforeHooks = closedSetTreeDigest(path.join(live, 'hooks'));
    const beforeKnowledge = closedSetTreeDigest(path.join(live, 'knowledge'));

    fs.rmSync(path.join(root, 'plugin/src/knowledge/portfolio.json'));

    const failed = syncFull(root);
    assert.notEqual(failed.status, 0, 'full sync must fail when graph source is missing');
    assert.equal(
      closedSetTreeDigest(live),
      before,
      'live host closed-set digest must be unchanged after late compile failure',
    );
    assert.equal(closedSetTreeDigest(path.join(live, 'hooks')), beforeHooks);
    assert.equal(closedSetTreeDigest(path.join(live, 'knowledge')), beforeKnowledge);
    assert.ok(fs.existsSync(path.join(live, 'hooks')), 'hooks must not be deleted on failure');
    assert.ok(fs.existsSync(path.join(live, 'knowledge')), 'knowledge must not be deleted on failure');
    assert.deepEqual(listHostResidues(path.join(root, 'plugin/dist')), []);
    assert.deepEqual(listResiduesUnder(live), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('v9: host live symlink refuses before any write; external sentinel byte-identical', () => {
  const root = fixture('ccm-skg-v9-symlink-');
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-v9-ext-'));
  try {
    const baseline = syncFull(root);
    assert.equal(baseline.status, 0, `${baseline.stdout}\n${baseline.stderr}`);

    const live = hostLive(root);
    // Park real host tree and point live at an external sentinel tree.
    const parked = path.join(root, 'plugin/dist', `${HOST}.parked-${process.pid}`);
    fs.renameSync(live, parked);
    const sentinelPath = path.join(external, 'SENTINEL.txt');
    const sentinelBytes = 'EXTERNAL-SENTINEL-MUST-NOT-CHANGE\n';
    fs.writeFileSync(sentinelPath, sentinelBytes);
    const beforeExternal = closedSetTreeDigest(external);
    fs.symlinkSync(external, live);

    const failed = syncFull(root);
    assert.notEqual(failed.status, 0, 'host live symlink must be refused');
    assert.match(`${failed.stderr}\n${failed.stdout}`, /symlink|refuse|integrity|real directory/i);
    assert.equal(fs.lstatSync(live).isSymbolicLink(), true, 'must not unlink host symlink');
    assert.equal(fs.readFileSync(sentinelPath, 'utf8'), sentinelBytes);
    assert.equal(closedSetTreeDigest(external), beforeExternal);
    // No new files appeared under the external tree.
    assert.deepEqual(
      fs.readdirSync(external).sort(),
      ['SENTINEL.txt'],
      'external tree must gain no new entries',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('v9: publishHostTree — collision / second rename restore / cleanup warn', async () => {
  const mod = await import('../../scripts/skill-knowledge/publish-host-tree.mjs');
  assert.equal(typeof mod.publishHostTree, 'function');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-v9-pub-'));
  try {
    const distParent = path.join(root, 'plugin/dist');
    fs.mkdirSync(distParent, { recursive: true });
    const live = path.join(distParent, HOST);
    const staging = path.join(distParent, `${HOST}.write-test`);
    fs.mkdirSync(live);
    fs.writeFileSync(path.join(live, 'old.txt'), 'OLD\n');
    fs.mkdirSync(staging);
    fs.writeFileSync(path.join(staging, 'new.txt'), 'NEW\n');
    const oldDigest = closedSetTreeDigest(live);

    const stamp = 'collision';
    const backup = path.join(distParent, `${HOST}.bak-${stamp}`);
    fs.mkdirSync(backup);
    fs.writeFileSync(path.join(backup, 'x'), 'taken\n');
    assert.throws(
      () =>
        mod.publishHostTree({
          distParentAbsolute: distParent,
          liveAbsolute: live,
          stagingAbsolute: staging,
          host: HOST,
          stamp,
        }),
      /bak|collision|pre-?claim|exists/i,
    );
    assert.equal(closedSetTreeDigest(live), oldDigest);
    assert.ok(fs.existsSync(staging), 'pre-commit failure must leave staging for cleanup caller');
    assert.ok(fs.existsSync(backup), 'collision backup must not be deleted by publisher');

    // Fresh staging matching the inject stamp for second-rename failure.
    fs.rmSync(staging, { recursive: true, force: true });
    const stagingInj = path.join(distParent, `${HOST}.write-inj2`);
    fs.mkdirSync(stagingInj);
    fs.writeFileSync(path.join(stagingInj, 'new.txt'), 'NEW\n');

    let renameCount = 0;
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
        mod.publishHostTree({
          distParentAbsolute: distParent,
          liveAbsolute: live,
          stagingAbsolute: stagingInj,
          host: HOST,
          stamp: 'inj2',
          fs: failingFs,
        }),
      /injected second rename failure/,
    );
    assert.equal(closedSetTreeDigest(live), oldDigest, 'old live restored after second rename fail');
    assert.equal(fs.readFileSync(path.join(live, 'old.txt'), 'utf8'), 'OLD\n');

    fs.rmSync(path.join(distParent, `${HOST}.write-inj2`), { recursive: true, force: true });
    fs.rmSync(path.join(distParent, `${HOST}.bak-inj2`), { recursive: true, force: true });
    const staging2 = path.join(distParent, `${HOST}.write-okclean`);
    fs.mkdirSync(staging2);
    fs.writeFileSync(path.join(staging2, 'new.txt'), 'NEW\n');
    const warnings = [];
    const cleanupFailFs = {
      ...fs,
      readdirSync(target, options) {
        if (String(target).includes(`${HOST}.bak-okclean`)) {
          throw new Error('injected cleanup failure');
        }
        return fs.readdirSync(target, options);
      },
      rmdirSync(target, options) {
        if (String(target).includes(`${HOST}.bak-`)) {
          throw new Error('injected cleanup failure');
        }
        return fs.rmdirSync(target, options);
      },
      unlinkSync(target) {
        if (String(target).includes(`${HOST}.bak-`)) {
          throw new Error('injected cleanup failure');
        }
        return fs.unlinkSync(target);
      },
    };
    const result = mod.publishHostTree({
      distParentAbsolute: distParent,
      liveAbsolute: live,
      stagingAbsolute: staging2,
      host: HOST,
      stamp: 'okclean',
      fs: cleanupFailFs,
      warn: (msg) => warnings.push(String(msg)),
    });
    assert.equal(result.ok, true);
    assert.equal(result.committed, true);
    assert.equal(fs.readFileSync(path.join(live, 'new.txt'), 'utf8'), 'NEW\n');
    assert.equal(result.backupRetained, true);
    assert.ok(warnings.length > 0, 'cleanup failure must warn');
    assert.ok(fs.existsSync(path.join(distParent, `${HOST}.bak-okclean`)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('v9: publishHostTree happy path leaves no staging/backup residues', async () => {
  const mod = await import('../../scripts/skill-knowledge/publish-host-tree.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-v9-happy-'));
  try {
    const distParent = path.join(root, 'plugin/dist');
    fs.mkdirSync(distParent, { recursive: true });
    const live = path.join(distParent, HOST);
    const staging = path.join(distParent, `${HOST}.write-happy`);
    fs.mkdirSync(live);
    fs.writeFileSync(path.join(live, 'old.txt'), 'OLD\n');
    fs.mkdirSync(staging);
    fs.writeFileSync(path.join(staging, 'new.txt'), 'NEW\n');
    const result = mod.publishHostTree({
      distParentAbsolute: distParent,
      liveAbsolute: live,
      stagingAbsolute: staging,
      host: HOST,
      stamp: 'happy',
    });
    assert.equal(result.ok, true);
    assert.equal(result.committed, true);
    assert.equal(result.backupRetained, false);
    assert.equal(fs.readFileSync(path.join(live, 'new.txt'), 'utf8'), 'NEW\n');
    assert.deepEqual(listHostResidues(distParent), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('v9: Codex skills-only final bytes include entry-pin; idempotent; invalid overlay refuses publish', () => {
  const root = fixture('ccm-skg-v9-codex-pin-');
  try {
    const first = syncSkillsOnly(root, CODEX);
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const entryMd = path.join(
      root,
      `plugin/dist/${CODEX}/skills/${ENTRY_SKILL}/SKILL.md`,
    );
    assert.ok(fs.existsSync(entryMd), 'Codex entry skill must be projected');
    const firstBytes = fs.readFileSync(entryMd, 'utf8');
    assert.match(firstBytes, /ccm:k:entry-pin:start/);
    assert.match(firstBytes, new RegExp(CODEX_ENTRY_PIN_LITERAL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(firstBytes, /ccm:k:entry-pin:end/);
    const before = closedSetTreeDigest(path.join(root, `plugin/dist/${CODEX}/skills`));

    const second = syncSkillsOnly(root, CODEX);
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.equal(fs.readFileSync(entryMd, 'utf8'), firstBytes, 'entry-pin overlay must be idempotent');
    assert.equal(closedSetTreeDigest(path.join(root, `plugin/dist/${CODEX}/skills`)), before);
    assert.deepEqual(listHostResidues(path.join(root, `plugin/dist`)), []);

    // Corrupt canonical entry skill so overlay/plan fails — live must stay byte-identical.
    const canonical = path.join(
      root,
      `plugin/src/skills/${ENTRY_SKILL}/canonical/SKILL.md`,
    );
    fs.writeFileSync(
      canonical,
      `${fs.readFileSync(canonical, 'utf8')}\n<!-- ccm:k:entry-pin:start -->\nbroken\n`,
    );
    const failed = syncSkillsOnly(root, CODEX);
    assert.notEqual(failed.status, 0, 'invalid overlay must refuse publish');
    assert.equal(closedSetTreeDigest(path.join(root, `plugin/dist/${CODEX}/skills`)), before);
    assert.equal(fs.readFileSync(entryMd, 'utf8'), firstBytes);
    assert.deepEqual(
      listHostResidues(path.join(root, 'plugin/dist')).filter((n) => n.startsWith('skills.write-')),
      [],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('v9: test-only late fault seam keeps live host byte-identical', async () => {
  let projectAndPublishHostSurface;
  try {
    ({ projectAndPublishHostSurface } = await import(
      '../../scripts/skill-knowledge/sync-host-surface.mjs'
    ));
  } catch (error) {
    assert.fail(`sync-host-surface must export projectAndPublishHostSurface: ${error}`);
  }
  assert.equal(typeof projectAndPublishHostSurface, 'function');

  const root = fixture('ccm-skg-v9-seam-');
  try {
    assert.equal(syncFull(root).status, 0);
    const live = hostLive(root);
    const before = closedSetTreeDigest(live);
    const stamp = 'v9-late-fault';
    let thrown = null;
    try {
      projectAndPublishHostSurface({
        repoRoot: root,
        host: HOST,
        stamp,
        injectLateFault: () => {
          throw new Error('injected late compile/attestation fault');
        },
      });
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown, 'late fault must abort publish');
    assert.match(String(thrown.message || thrown), /injected late compile\/attestation fault/);
    assert.equal(closedSetTreeDigest(live), before);
    assert.equal(
      fs.existsSync(path.join(root, 'plugin/dist', `${HOST}.write-${stamp}`)),
      false,
      'outer catch must clean its own whole-host staging',
    );
    assert.deepEqual(
      listHostResidues(path.join(root, 'plugin/dist')).filter((n) => n.includes('.bak-')),
      [],
      'late fault before commit must leave no publisher backup',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('v9: .gitignore narrowly ignores plugin/dist/*.write-*/ only', () => {
  const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
  assert.doesNotMatch(gitignore, /^\.tmp\/\s*$/m, 'generic .tmp/ must stay absent');
  assert.match(gitignore, /plugin\/dist\/\*\.write-\*\//);

  const probeWrite = path.join(REPO_ROOT, 'plugin/dist', `claude-code.write-v9probe-${process.pid}`, 'x.txt');
  const probeBak = path.join(REPO_ROOT, 'plugin/dist', `claude-code.bak-v9probe-${process.pid}`, 'y.txt');
  fs.mkdirSync(path.dirname(probeWrite), { recursive: true });
  fs.mkdirSync(path.dirname(probeBak), { recursive: true });
  fs.writeFileSync(probeWrite, 'w\n');
  fs.writeFileSync(probeBak, 'b\n');
  try {
    const writeCheck = spawnSync('git', ['check-ignore', '-v', probeWrite], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.equal(writeCheck.status, 0, `write staging must be ignored: ${writeCheck.stderr}`);
    const bakCheck = spawnSync('git', ['check-ignore', '-v', probeBak], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.notEqual(bakCheck.status, 0, 'bak residues must remain visible (not ignored)');
  } finally {
    fs.rmSync(path.dirname(probeWrite), { recursive: true, force: true });
    fs.rmSync(path.dirname(probeBak), { recursive: true, force: true });
  }
});
