/**
 * K1-06 amendment v3 Blocker 1 — repo→staging containment + safe read.
 *
 * Independent closed-set digests only; never trusts production helpers as oracle.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { copyMinimalSkillKnowledgeRepo } from './helpers/skill-knowledge-isolated-repo.mjs';

const BRIDGE = 'scripts/skill-knowledge/apply-final-skill-overlay.mjs';
const HOST = 'claude-code';
const SKILL = 'master-orchestrator-guide';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-v3-contain-'));
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

function syncSkills(root) {
  return spawnSync('bash', ['scripts/sync-plugin-dist.sh', '--host', HOST, '--skills-only'], {
    cwd: root,
    encoding: 'utf8',
  });
}

function runBridge(root, args) {
  return spawnSync(process.execPath, [BRIDGE, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function prepareInRepoStaging(root) {
  const stagingRoot = fs.mkdtempSync(
    path.join(root, 'plugin/dist', HOST, `skills.write-v3-`),
  );
  const skillTree = path.join(stagingRoot, SKILL);
  fs.cpSync(path.join(root, `plugin/dist/${HOST}/skills/${SKILL}`), skillTree, {
    recursive: true,
  });
  return { stagingRoot, skillTree };
}

function baseArgs(root, stagingRoot, skillTree, overrides = {}) {
  return [
    '--repo-root',
    overrides.repoRoot ?? root,
    '--host',
    overrides.host ?? HOST,
    '--skill',
    overrides.skill ?? SKILL,
    '--staging-root',
    overrides.stagingRoot ?? stagingRoot,
    '--skill-tree',
    overrides.skillTree ?? skillTree,
  ];
}

test('v3: staging outside real repoRoot is rejected; external + live + registry unchanged', () => {
  const root = fixture();
  try {
    assert.equal(syncSkills(root).status, 0);
    const liveDigest = closedSetTreeDigest(path.join(root, `plugin/dist/${HOST}/skills`));
    const registryPath = path.join(root, 'plugin/src/skills/provider-guidance-runtime.json');
    const registryBefore = fs.readFileSync(registryPath);

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-outside-staging-'));
    try {
      const skillTree = path.join(outside, SKILL);
      fs.cpSync(path.join(root, `plugin/dist/${HOST}/skills/${SKILL}`), skillTree, {
        recursive: true,
      });
      const outsideBefore = closedSetTreeDigest(outside);
      const result = runBridge(root, baseArgs(root, outside, skillTree));
      assert.notEqual(result.status, 0, 'repo-external staging must fail');
      assert.match(`${result.stderr}\n${result.stdout}`, /staging|contain|repo|namespace/i);
      assert.equal(closedSetTreeDigest(outside), outsideBefore);
      assert.equal(
        closedSetTreeDigest(path.join(root, `plugin/dist/${HOST}/skills`)),
        liveDigest,
      );
      assert.deepEqual(fs.readFileSync(registryPath), registryBefore);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('v3: staging ancestor symlink under repo is rejected; external bytes unchanged', () => {
  const root = fixture();
  try {
    assert.equal(syncSkills(root).status, 0);
    const liveDigest = closedSetTreeDigest(path.join(root, `plugin/dist/${HOST}/skills`));

    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-anc-stage-'));
    try {
      fs.writeFileSync(path.join(external, 'secret.txt'), 'do-not-touch\n');

      // Make .tmp itself a symlink ancestor; staging name still looks controlled.
      const tmpLink = path.join(root, '.tmp');
      fs.symlinkSync(external, tmpLink);
      const stagingRoot = fs.mkdtempSync(path.join(tmpLink, 'ccm-provider-guidance-'));
      const skillTree = path.join(stagingRoot, SKILL);
      fs.mkdirSync(skillTree, { recursive: true });
      fs.writeFileSync(path.join(skillTree, 'SKILL.md'), '# decoy\n');
      const before = closedSetTreeDigest(external);

      const result = runBridge(root, baseArgs(root, stagingRoot, skillTree));
      assert.notEqual(result.status, 0, 'staging ancestor symlink must fail');
      assert.match(`${result.stderr}\n${result.stdout}`, /symlink|ancestor|staging/i);
      assert.equal(closedSetTreeDigest(external), before);
      assert.equal(fs.readFileSync(path.join(external, 'secret.txt'), 'utf8'), 'do-not-touch\n');
      assert.equal(
        closedSetTreeDigest(path.join(root, `plugin/dist/${HOST}/skills`)),
        liveDigest,
      );
    } finally {
      fs.rmSync(external, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('v3: uncontrolled in-repo .tmp staging namespace is rejected', () => {
  const root = fixture();
  try {
    assert.equal(syncSkills(root).status, 0);
    const liveDigest = closedSetTreeDigest(path.join(root, `plugin/dist/${HOST}/skills`));
    const rogueParent = path.join(root, '.tmp');
    fs.mkdirSync(rogueParent, { recursive: true });
    const rogue = fs.mkdtempSync(path.join(rogueParent, 'rogue-scratch-'));
    const skillTree = path.join(rogue, SKILL);
    fs.cpSync(path.join(root, `plugin/dist/${HOST}/skills/${SKILL}`), skillTree, {
      recursive: true,
    });
    const result = runBridge(root, baseArgs(root, rogue, skillTree));
    assert.notEqual(result.status, 0, 'unknown .tmp namespace must fail');
    assert.equal(
      closedSetTreeDigest(path.join(root, `plugin/dist/${HOST}/skills`)),
      liveDigest,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('v3: leaf replacement with symlink is refused by no-follow read (external unchanged)', () => {
  const root = fixture();
  try {
    assert.equal(syncSkills(root).status, 0);
    const { stagingRoot, skillTree } = prepareInRepoStaging(root);
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-leaf-repl-'));
    try {
      const extFile = path.join(external, 'payload.md');
      fs.writeFileSync(extFile, 'leaf-replacement-secret\n');
      const before = closedSetTreeDigest(external);

      // Import production read helper if exported; otherwise exercise via bridge after planting
      // a TOCTOU-style leaf symlink that a path-based readFileSync would follow.
      const skillMd = path.join(skillTree, 'SKILL.md');
      fs.rmSync(skillMd);
      fs.symlinkSync(extFile, skillMd);

      const result = runBridge(root, baseArgs(root, stagingRoot, skillTree));
      assert.notEqual(result.status, 0, 'leaf symlink must fail closed');
      assert.equal(closedSetTreeDigest(external), before);
      assert.equal(fs.readFileSync(extFile, 'utf8'), 'leaf-replacement-secret\n');
      assert.equal(fs.lstatSync(skillMd).isSymbolicLink(), true);
    } finally {
      fs.rmSync(external, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('v3: readFileNoFollowExported uses O_NOFOLLOW path (unit)', async () => {
  const root = fixture();
  try {
    const mod = await import('../../scripts/skill-knowledge/compile/skill-overlay.mjs');
    assert.equal(
      typeof mod.readFileNoFollowContained,
      'function',
      'production must export safe no-follow reader',
    );
    const file = path.join(root, 'safe-read.txt');
    fs.writeFileSync(file, 'ok-bytes\n');
    assert.equal(mod.readFileNoFollowContained(file, root), 'ok-bytes\n');

    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-nofollow-'));
    try {
      const target = path.join(external, 'x.txt');
      fs.writeFileSync(target, 'secret\n');
      const link = path.join(root, 'safe-read-link.txt');
      fs.symlinkSync(target, link);
      assert.throws(
        () => mod.readFileNoFollowContained(link, root),
        (error) => error?.code === 'SKG-OVERLAY-LEAF-SYMLINK' || /NOFOLLOW|symlink/i.test(String(error)),
      );
      assert.equal(fs.readFileSync(target, 'utf8'), 'secret\n');
    } finally {
      fs.rmSync(external, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
