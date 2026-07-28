/**
 * Isolation contract for skill-knowledge temp-repo fixtures (K1-06 v7/v8).
 *
 * Correct architecture: helper constructs temp repos only from an explicit,
 * stable, semantically owned source/fixture allowlist. It must NEVER recurse
 * into shared-HUB plugin/dist (live / staging / backup / tmp). Dist baselines
 * are projected inside the temp repo from source — never snapshotted from the
 * shared live tree.
 *
 * Codex counter-examples that invalidate basename filtering of a recursive
 * `plugin/` copy:
 *   A) publisher live→backup→staging→live renames make allowed live
 *      skills/knowledge briefly absent → ENOENT mid-copy
 *   B) a global basename filter silently drops stable semantic sources such as
 *      plugin/src/knowledge/stable.tmp-7-acde
 *
 * v7: custom `paths` must be segment-canonicalized before any filesystem access.
 * Lexical escapes (`plugin/src/../dist`, `./plugin/dist`, `..` out of root,
 * absolute / NUL / empty) fail closed — never copy a planted dist sentinel.
 *
 * v8: locating ancestor chain (sourceRoot → allowlisted copy root, and
 * destRoot → copy destination) must be proven non-symlink via lstat on every
 * existing segment before mkdir/cpSync. Interior tree symlinks may still be
 * preserved with verbatimSymlinks. Custom paths are confined to the default
 * stable namespaces. sourceRoot may itself be a symlink: the helper takes its
 * realpath as authority root (documented below) and then applies the no-symlink
 * walk beneath that authority.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_COPY_PATHS,
  copyMinimalSkillKnowledgeRepo,
} from './helpers/skill-knowledge-isolated-repo.mjs';

function plantMinimalHub(hub) {
  fs.mkdirSync(path.join(hub, 'plugin/src/knowledge'), { recursive: true });
  fs.mkdirSync(path.join(hub, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(hub, 'design_docs/skill-knowledge-graph'), { recursive: true });
  fs.mkdirSync(path.join(hub, 'ccm/apps/cli/src'), { recursive: true });
  fs.writeFileSync(path.join(hub, 'plugin/src/knowledge/graph.yaml'), 'stable-source\n');
  fs.writeFileSync(path.join(hub, 'scripts/sentinel.txt'), 'scripts-ok\n');
  fs.writeFileSync(
    path.join(hub, 'design_docs/skill-knowledge-graph/README.md'),
    'schemas-ok\n',
  );
  fs.writeFileSync(
    path.join(hub, 'ccm/apps/cli/src/provider-model-facts.json'),
    '{}\n',
  );
}

function plantDistSentinel(hub) {
  fs.mkdirSync(path.join(hub, 'plugin/dist/claude-code'), { recursive: true });
  fs.writeFileSync(
    path.join(hub, 'plugin/dist/claude-code/SENTINEL'),
    'must-not-copy\n',
  );
}

function assertDistSentinelAbsent(dest) {
  assert.equal(fs.existsSync(path.join(dest, 'plugin/dist')), false);
  assert.equal(fs.existsSync(path.join(dest, 'plugin/dist/claude-code/SENTINEL')), false);
  assert.equal(fs.existsSync(path.join(dest, 'dist')), false);
  assert.equal(fs.existsSync(path.join(dest, 'dist/claude-code/SENTINEL')), false);
}

test('DEFAULT_COPY_PATHS is an explicit stable allowlist without plugin/dist', () => {
  assert.ok(DEFAULT_COPY_PATHS.includes('plugin/src'), 'must include plugin/src');
  assert.ok(DEFAULT_COPY_PATHS.includes('scripts'), 'must include scripts');
  assert.equal(
    DEFAULT_COPY_PATHS.some((entry) => entry === 'plugin' || entry === 'plugin/dist' || entry.startsWith('plugin/dist/')),
    false,
    'must not include whole plugin tree or plugin/dist',
  );
});

test('A: helper succeeds when shared plugin/dist is absent, replaced, or mid-swap churn', () => {
  const hub = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-hub-absent-'));
  const destAbsent = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-iso-absent-'));
  const destChurn = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-iso-churn-'));
  try {
    plantMinimalHub(hub);
    // Legitimate tmp-like semantic source under plugin/src (counter-example B seed).
    fs.writeFileSync(
      path.join(hub, 'plugin/src/knowledge/stable.tmp-7-acde'),
      'tmp-like-stable\n',
    );

    // Dist absent entirely — helper must not require or touch it.
    assert.equal(fs.existsSync(path.join(hub, 'plugin/dist')), false);
    assert.doesNotThrow(() =>
      copyMinimalSkillKnowledgeRepo(destAbsent, { sourceRoot: hub }),
    );
    assert.equal(fs.existsSync(path.join(destAbsent, 'plugin/dist')), false);
    assert.equal(
      fs.readFileSync(path.join(destAbsent, 'plugin/src/knowledge/graph.yaml'), 'utf8'),
      'stable-source\n',
    );

    // Dist present with live + volatile staging; then replace live mid-flight style
    // (skills/knowledge directories renamed away) before a second copy.
    const hostDist = path.join(hub, 'plugin/dist/claude-code');
    fs.mkdirSync(path.join(hostDist, 'skills/demo'), { recursive: true });
    fs.mkdirSync(path.join(hostDist, 'knowledge'), { recursive: true });
    fs.writeFileSync(path.join(hostDist, 'skills/demo/SKILL.md'), 'live-skill\n');
    fs.writeFileSync(path.join(hostDist, 'knowledge/stable-1.md'), 'live-knowledge\n');
    fs.mkdirSync(path.join(hostDist, 'skills.write-planted-aaa'));
    fs.mkdirSync(path.join(hostDist, 'knowledge.bak-planted-bbb'));
    fs.writeFileSync(path.join(hostDist, 'knowledge/stable-1.md.tmp-1-dead'), 'staging-tmp\n');

    // Simulate publisher live→backup rename: live knowledge/skills disappear.
    fs.renameSync(path.join(hostDist, 'knowledge'), path.join(hostDist, 'knowledge.bak-swap'));
    fs.renameSync(path.join(hostDist, 'skills'), path.join(hostDist, 'skills.bak-swap'));

    assert.doesNotThrow(() =>
      copyMinimalSkillKnowledgeRepo(destChurn, { sourceRoot: hub }),
    );
    // Must not snapshot shared dist (neither live nor staging/backup).
    assert.equal(fs.existsSync(path.join(destChurn, 'plugin/dist')), false);
    assert.equal(
      fs.readFileSync(path.join(destChurn, 'plugin/src/knowledge/graph.yaml'), 'utf8'),
      'stable-source\n',
    );
    assert.equal(
      fs.readFileSync(path.join(destChurn, 'plugin/src/knowledge/stable.tmp-7-acde'), 'utf8'),
      'tmp-like-stable\n',
    );
  } finally {
    fs.rmSync(hub, { recursive: true, force: true });
    fs.rmSync(destAbsent, { recursive: true, force: true });
    fs.rmSync(destChurn, { recursive: true, force: true });
  }
});

test('B: tmp-like basename under plugin/src is copied (no global basename filter)', () => {
  const hub = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-hub-tmplikesrc-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-iso-tmplikesrc-'));
  try {
    plantMinimalHub(hub);
    const stableTmpLike = 'stable.tmp-7-acde';
    fs.writeFileSync(
      path.join(hub, 'plugin/src/knowledge', stableTmpLike),
      'must-copy\n',
    );
    // Also plant a dist volatile leaf that must never be consulted.
    fs.mkdirSync(path.join(hub, 'plugin/dist/claude-code/knowledge'), { recursive: true });
    fs.writeFileSync(
      path.join(hub, 'plugin/dist/claude-code/knowledge/atlas.md.tmp-99-ffff'),
      'must-not-read\n',
    );

    copyMinimalSkillKnowledgeRepo(dest, { sourceRoot: hub });

    assert.equal(
      fs.readFileSync(path.join(dest, 'plugin/src/knowledge', stableTmpLike), 'utf8'),
      'must-copy\n',
      'stable semantic source with tmp-like basename must be copied',
    );
    assert.equal(fs.existsSync(path.join(dest, 'plugin/dist')), false);
  } finally {
    fs.rmSync(hub, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('helper rejects whole-plugin / plugin/dist path overrides that would reintroduce HUB dist reads', () => {
  const hub = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-hub-reject-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-iso-reject-'));
  try {
    plantMinimalHub(hub);
    plantDistSentinel(hub);
    for (const bad of ['plugin', 'plugin/dist', 'plugin/dist/claude-code']) {
      assert.throws(
        () => copyMinimalSkillKnowledgeRepo(dest, { sourceRoot: hub, paths: [bad] }),
        /plugin\/dist|allowlist|stable source|forbid|escape|invalid/i,
        `paths override ${bad} must be rejected`,
      );
      assertDistSentinelAbsent(dest);
    }
  } finally {
    fs.rmSync(hub, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('v7: lexical traversal / absolute / escape custom paths fail closed before FS (sentinel uncopied)', () => {
  const hub = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-hub-lex-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-iso-lex-'));
  try {
    plantMinimalHub(hub);
    plantDistSentinel(hub);

    const traversalAndForbidden = [
      'plugin/src/../dist',
      './plugin/dist',
      'plugin//dist',
      'plugin/dist/',
      'plugin\\dist',
      'plugin/src\\..\\dist',
      'plugin/src/../../plugin/dist',
      'plugin/src/../dist/claude-code',
      'plugin/./dist',
    ];
    for (const bad of traversalAndForbidden) {
      assert.throws(
        () => copyMinimalSkillKnowledgeRepo(dest, { sourceRoot: hub, paths: [bad] }),
        /plugin\/dist|forbid|escape|invalid|absolute|NUL|empty|canonical/i,
        `lexical bypass ${JSON.stringify(bad)} must be rejected`,
      );
      assertDistSentinelAbsent(dest);
    }

    const absoluteAndEmpty = [
      '',
      '.',
      './',
      path.join(hub, 'plugin/dist'),
      '/tmp/outside-skill-knowledge-dist',
      'plugin/src/../../../etc/passwd',
      'plugin/src/../../..',
      'foo\0bar',
    ];
    for (const bad of absoluteAndEmpty) {
      assert.throws(
        () => copyMinimalSkillKnowledgeRepo(dest, { sourceRoot: hub, paths: [bad] }),
        /plugin\/dist|forbid|escape|invalid|absolute|NUL|empty|canonical|\.\./i,
        `absolute/empty/escape ${JSON.stringify(bad)} must be rejected`,
      );
      assertDistSentinelAbsent(dest);
    }
  } finally {
    fs.rmSync(hub, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('v7: explicit stable subpath plugin/src/knowledge/stable.tmp-7-acde still copies', () => {
  const hub = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-hub-stable-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-iso-stable-'));
  try {
    plantMinimalHub(hub);
    plantDistSentinel(hub);
    const rel = 'plugin/src/knowledge/stable.tmp-7-acde';
    fs.writeFileSync(path.join(hub, rel), 'stable-explicit\n');

    assert.doesNotThrow(() =>
      copyMinimalSkillKnowledgeRepo(dest, { sourceRoot: hub, paths: [rel] }),
    );
    assert.equal(fs.readFileSync(path.join(dest, rel), 'utf8'), 'stable-explicit\n');
    assertDistSentinelAbsent(dest);
  } finally {
    fs.rmSync(hub, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('v8: source alias → plugin/dist fails closed before copy (sentinel uncopied)', () => {
  const hub = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-hub-alias-dist-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-iso-alias-dist-'));
  try {
    plantMinimalHub(hub);
    plantDistSentinel(hub);
    fs.symlinkSync(
      path.join(hub, 'plugin/dist'),
      path.join(hub, 'plugin/stable-source-alias'),
    );

    assert.throws(
      () =>
        copyMinimalSkillKnowledgeRepo(dest, {
          sourceRoot: hub,
          paths: ['plugin/stable-source-alias/claude-code/SENTINEL'],
        }),
      /symlink|stable namespace|plugin\/dist|forbid|allowlist/i,
      'source alias into plugin/dist must fail closed',
    );
    assertDistSentinelAbsent(dest);
    assert.equal(
      fs.existsSync(path.join(dest, 'plugin/stable-source-alias')),
      false,
      'alias tree must not appear in destination',
    );
  } finally {
    fs.rmSync(hub, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('v8: source alias → outside root fails closed (external bytes unchanged)', () => {
  const hub = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-hub-alias-out-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-outside-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-iso-alias-out-'));
  try {
    plantMinimalHub(hub);
    fs.writeFileSync(path.join(outside, 'OUTSIDE'), 'external-byte\n');
    fs.mkdirSync(path.join(hub, 'plugin'), { recursive: true });
    fs.symlinkSync(outside, path.join(hub, 'plugin/escape-alias'));

    assert.throws(
      () =>
        copyMinimalSkillKnowledgeRepo(dest, {
          sourceRoot: hub,
          paths: ['plugin/escape-alias/OUTSIDE'],
        }),
      /symlink|stable namespace|escape|forbid|allowlist/i,
    );
    assert.equal(fs.readFileSync(path.join(outside, 'OUTSIDE'), 'utf8'), 'external-byte\n');
    assert.equal(fs.existsSync(path.join(dest, 'plugin/escape-alias')), false);
  } finally {
    fs.rmSync(hub, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('v8: plugin/src locating ancestor that is a symlink to dist fails closed', () => {
  const hub = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-hub-src-alias-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-iso-src-alias-'));
  try {
    // Minimal hub without real plugin/src — replace with symlink to dist.
    fs.mkdirSync(path.join(hub, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(hub, 'design_docs/skill-knowledge-graph'), { recursive: true });
    fs.mkdirSync(path.join(hub, 'ccm/apps/cli/src'), { recursive: true });
    fs.writeFileSync(path.join(hub, 'scripts/sentinel.txt'), 'scripts-ok\n');
    fs.writeFileSync(
      path.join(hub, 'design_docs/skill-knowledge-graph/README.md'),
      'schemas-ok\n',
    );
    fs.writeFileSync(path.join(hub, 'ccm/apps/cli/src/provider-model-facts.json'), '{}\n');
    plantDistSentinel(hub);
    fs.mkdirSync(path.join(hub, 'plugin'), { recursive: true });
    fs.symlinkSync(path.join(hub, 'plugin/dist'), path.join(hub, 'plugin/src'));

    assert.throws(
      () =>
        copyMinimalSkillKnowledgeRepo(dest, {
          sourceRoot: hub,
          paths: ['plugin/src'],
        }),
      /symlink/i,
      'allowlisted plugin/src that is itself a symlink must fail closed',
    );
    assertDistSentinelAbsent(dest);
  } finally {
    fs.rmSync(hub, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('v8: destination plugin parent symlink must not write outside destRoot', () => {
  const hub = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-hub-dest-sym-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-iso-dest-sym-'));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-dest-ext-'));
  try {
    plantMinimalHub(hub);
    plantDistSentinel(hub);
    fs.writeFileSync(path.join(external, 'MARKER'), 'untouched\n');
    const beforeListing = fs.readdirSync(external).sort();

    // Destination locating ancestor: dest/plugin → external directory.
    fs.symlinkSync(external, path.join(dest, 'plugin'));

    assert.throws(
      () => copyMinimalSkillKnowledgeRepo(dest, { sourceRoot: hub }),
      /symlink|destination|escape/i,
      'destination parent symlink must fail before mkdir/copy',
    );

    assert.equal(fs.readFileSync(path.join(external, 'MARKER'), 'utf8'), 'untouched\n');
    assert.deepEqual(fs.readdirSync(external).sort(), beforeListing);
    assert.equal(fs.existsSync(path.join(external, 'src')), false);
    assertDistSentinelAbsent(dest);
  } finally {
    fs.rmSync(hub, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('v8: interior symlink under plugin/src is preserved (verbatim), locating chain clean', () => {
  const hub = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-hub-interior-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-iso-interior-'));
  try {
    plantMinimalHub(hub);
    const target = path.join(hub, 'plugin/src/knowledge/graph.yaml');
    const link = path.join(hub, 'plugin/src/knowledge/graph-alias.yaml');
    fs.symlinkSync('graph.yaml', link);

    copyMinimalSkillKnowledgeRepo(dest, { sourceRoot: hub });

    const destLink = path.join(dest, 'plugin/src/knowledge/graph-alias.yaml');
    assert.equal(fs.lstatSync(destLink).isSymbolicLink(), true);
    assert.equal(fs.readlinkSync(destLink), 'graph.yaml');
    assert.equal(
      fs.readFileSync(path.join(dest, 'plugin/src/knowledge/graph.yaml'), 'utf8'),
      'stable-source\n',
    );
  } finally {
    fs.rmSync(hub, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('v8: sourceRoot itself may be a symlink — realpath is authority, segments beneath must be clean', () => {
  const hub = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-hub-root-auth-'));
  const aliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-alias-root-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-iso-root-auth-'));
  // aliasRoot is a temp dir; replace with a symlink to hub for the contract.
  fs.rmSync(aliasRoot, { recursive: true, force: true });
  try {
    plantMinimalHub(hub);
    fs.symlinkSync(hub, aliasRoot);

    // Contract: sourceRoot symlink is accepted; authority = realpath(sourceRoot).
    // Default allowlist copy must succeed when locating segments under the real hub
    // are ordinary directories/files (no symlink ancestors).
    assert.doesNotThrow(() =>
      copyMinimalSkillKnowledgeRepo(dest, { sourceRoot: aliasRoot }),
    );
    assert.equal(
      fs.readFileSync(path.join(dest, 'plugin/src/knowledge/graph.yaml'), 'utf8'),
      'stable-source\n',
    );
  } finally {
    fs.rmSync(hub, { recursive: true, force: true });
    fs.rmSync(aliasRoot, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});
