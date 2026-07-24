/**
 * Blocker C mutations — bridge argv / path / symlink escape fail-closed.
 *
 * External trees are digested with an in-test closed-set hash (no production helper).
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-bridge-'));
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

function listBridgeTemps(rootAbsolute) {
  const hits = [];
  const visit = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const dirent of fs.readdirSync(directory, { withFileTypes: true })) {
      if (/\.tmp-/u.test(dirent.name) || /\.bak-/u.test(dirent.name)) hits.push(dirent.name);
      const absolute = path.join(directory, dirent.name);
      if (dirent.isSymbolicLink()) continue;
      if (dirent.isDirectory()) visit(absolute);
    }
  };
  visit(rootAbsolute);
  return hits;
}

function runBridge(root, args) {
  return spawnSync(process.execPath, [BRIDGE, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function prepareStaging(root) {
  const stagingRoot = fs.mkdtempSync(
    path.join(root, 'plugin/dist', HOST, `skills.write-bridge-`),
  );
  const skillTree = path.join(stagingRoot, SKILL);
  fs.cpSync(path.join(root, `plugin/dist/${HOST}/skills/${SKILL}`), skillTree, {
    recursive: true,
  });
  // Strip to raw-ish base for overlay apply (best-effort; bridge should accept raw or matching).
  return { stagingRoot, skillTree };
}

function baseArgs(root, stagingRoot, skillTree, overrides = {}) {
  const args = [
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
  return args;
}

test('bridge rejects unknown host / unsafe skill / duplicate args (nonzero)', () => {
  const root = fixture();
  try {
    assert.equal(
      spawnSync('bash', ['scripts/sync-plugin-dist.sh', '--host', HOST, '--skills-only'], {
        cwd: root,
        encoding: 'utf8',
      }).status,
      0,
    );
    const { stagingRoot, skillTree } = prepareStaging(root);

    const unknownHost = runBridge(
      root,
      baseArgs(root, stagingRoot, skillTree, { host: 'not-a-host' }),
    );
    assert.notEqual(unknownHost.status, 0, 'unknown host must fail');

    const unsafeSkill = runBridge(
      root,
      baseArgs(root, stagingRoot, skillTree, { skill: '../etc' }),
    );
    assert.notEqual(unsafeSkill.status, 0, 'unsafe skill slug must fail');

    const unknownSkill = runBridge(
      root,
      baseArgs(root, stagingRoot, skillTree, { skill: 'no-such-skill-xyz' }),
    );
    assert.notEqual(unknownSkill.status, 0, 'unknown skill must fail');

    const dup = runBridge(root, [
      ...baseArgs(root, stagingRoot, skillTree),
      '--host',
      HOST,
    ]);
    assert.notEqual(dup.status, 0, 'duplicate args must fail');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('external / root symlink skill-tree rejected; external digest unchanged', () => {
  const root = fixture();
  try {
    assert.equal(
      spawnSync('bash', ['scripts/sync-plugin-dist.sh', '--host', HOST, '--skills-only'], {
        cwd: root,
        encoding: 'utf8',
      }).status,
      0,
    );
    const { stagingRoot } = prepareStaging(root);
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-ext-'));
    try {
      fs.writeFileSync(path.join(external, 'SKILL.md'), '# external\n');
      const before = closedSetTreeDigest(external);
      const link = path.join(stagingRoot, SKILL);
      fs.rmSync(link, { recursive: true, force: true });
      fs.symlinkSync(external, link);

      const result = runBridge(root, baseArgs(root, stagingRoot, link));
      assert.notEqual(result.status, 0, 'symlink skill-tree must fail');
      assert.equal(closedSetTreeDigest(external), before);
      assert.deepEqual(listBridgeTemps(external), []);
      assert.deepEqual(listBridgeTemps(stagingRoot), []);
    } finally {
      fs.rmSync(external, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SKILL.md leaf symlink + reference leaf symlink rejected; external unchanged', () => {
  const root = fixture();
  try {
    assert.equal(
      spawnSync('bash', ['scripts/sync-plugin-dist.sh', '--host', HOST, '--skills-only'], {
        cwd: root,
        encoding: 'utf8',
      }).status,
      0,
    );
    const { stagingRoot, skillTree } = prepareStaging(root);
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-leaf-'));
    try {
      const extFile = path.join(external, 'payload.md');
      fs.writeFileSync(extFile, 'do-not-touch\n');
      const before = closedSetTreeDigest(external);

      const skillMd = path.join(skillTree, 'SKILL.md');
      fs.rmSync(skillMd);
      fs.symlinkSync(extFile, skillMd);

      const result = runBridge(root, baseArgs(root, stagingRoot, skillTree));
      assert.notEqual(result.status, 0, 'SKILL.md leaf symlink must fail');
      assert.equal(closedSetTreeDigest(external), before);
      assert.equal(fs.readFileSync(extFile, 'utf8'), 'do-not-touch\n');

      // Restore real SKILL.md, plant reference leaf symlink.
      fs.unlinkSync(skillMd);
      fs.writeFileSync(skillMd, '# skill\n');
      const refDir = path.join(skillTree, 'references');
      fs.mkdirSync(refDir, { recursive: true });
      const refLink = path.join(refDir, 'escape.md');
      fs.symlinkSync(extFile, refLink);
      const result2 = runBridge(root, baseArgs(root, stagingRoot, skillTree));
      assert.notEqual(result2.status, 0, 'reference leaf symlink must fail');
      assert.equal(closedSetTreeDigest(external), before);
      assert.deepEqual(listBridgeTemps(external), []);
    } finally {
      fs.rmSync(external, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ancestor directory symlink inside skill tree rejected', () => {
  const root = fixture();
  try {
    assert.equal(
      spawnSync('bash', ['scripts/sync-plugin-dist.sh', '--host', HOST, '--skills-only'], {
        cwd: root,
        encoding: 'utf8',
      }).status,
      0,
    );
    const { stagingRoot, skillTree } = prepareStaging(root);
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-anc-'));
    try {
      fs.writeFileSync(path.join(external, 'x.md'), 'secret\n');
      const before = closedSetTreeDigest(external);
      const refs = path.join(skillTree, 'references');
      if (fs.existsSync(refs)) fs.rmSync(refs, { recursive: true, force: true });
      fs.symlinkSync(external, refs);
      const result = runBridge(root, baseArgs(root, stagingRoot, skillTree));
      assert.notEqual(result.status, 0, 'ancestor/dir symlink must fail');
      assert.equal(closedSetTreeDigest(external), before);
    } finally {
      fs.rmSync(external, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing --staging-root is rejected', () => {
  const root = fixture();
  try {
    assert.equal(
      spawnSync('bash', ['scripts/sync-plugin-dist.sh', '--host', HOST, '--skills-only'], {
        cwd: root,
        encoding: 'utf8',
      }).status,
      0,
    );
    const { skillTree } = prepareStaging(root);
    const result = runBridge(root, [
      '--repo-root',
      root,
      '--host',
      HOST,
      '--skill',
      SKILL,
      '--skill-tree',
      skillTree,
    ]);
    assert.notEqual(result.status, 0, 'missing staging-root must fail');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
