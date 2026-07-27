import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  publishSealedHostTree,
  runTrustedProjectionTransaction,
} = require('../../scripts/skill-knowledge/trusted-projection/transaction.cjs');

function fixture(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-runtime-'));
  const repoRoot = path.join(root, 'repo');
  const sourceRoot = path.join(repoRoot, 'plugin/src');
  const distParent = path.join(repoRoot, 'plugin/dist');
  const live = path.join(distParent, 'claude-code');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(distParent, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'payload.txt'), 'v1\n', { mode: 0o640 });
  try {
    return body({ repoRoot, sourceRoot, distParent, live });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runProjection(options) {
  return runTrustedProjectionTransaction({
    ...options,
    host: 'claude-code',
    buildCandidate({ frozenRepoRoot, candidateRoot }) {
      const source = path.join(frozenRepoRoot, 'plugin/src/payload.txt');
      fs.copyFileSync(source, path.join(candidateRoot, 'payload.txt'));
      fs.chmodSync(
        path.join(candidateRoot, 'payload.txt'),
        fs.statSync(source).mode & 0o7777,
      );
    },
  });
}

function ownedResidues(distParent) {
  return fs
    .readdirSync(distParent)
    .filter((name) => name.includes('trusted-projection'));
}

test('TPT-RUNTIME-01: publisher refuses a caller-built bare staging claim', () => {
  assert.throws(
    () =>
      publishSealedHostTree({
        sealed: {
          verified_snapshot_attestation: { authorized_content_id: 'forged' },
        },
      }),
    (error) => error?.code === 'TPT-UNVERIFIED-COMMIT',
  );
});

test('TPT-RUNTIME-02: faults on both rename edges restore live exactly with zero residue', () =>
  fixture(({ repoRoot, sourceRoot, distParent, live }) => {
    runProjection({ repoRoot, distParent, live });
    assert.equal(fs.readFileSync(path.join(live, 'payload.txt'), 'utf8'), 'v1\n');

    for (const checkpoint of [
      'after-live-to-backup',
      'after-candidate-to-live',
    ]) {
      fs.writeFileSync(path.join(sourceRoot, 'payload.txt'), `${checkpoint}\n`, {
        mode: 0o640,
      });
      assert.throws(
        () =>
          runProjection({
            repoRoot,
            distParent,
            live,
            injectCommitFault(observed) {
              if (observed === checkpoint) {
                throw new Error(`injected ${checkpoint}`);
              }
            },
          }),
        new RegExp(`injected ${checkpoint}`, 'u'),
      );
      assert.equal(
        fs.readFileSync(path.join(live, 'payload.txt'), 'utf8'),
        'v1\n',
      );
      assert.deepEqual(ownedResidues(distParent), []);
    }
  }));

test('TPT-RUNTIME-03: post-commit cleanup fault is success plus warning', () =>
  fixture(({ repoRoot, sourceRoot, distParent, live }) => {
    runProjection({ repoRoot, distParent, live });
    fs.writeFileSync(path.join(sourceRoot, 'payload.txt'), 'v2\n', { mode: 0o640 });
    const warnings = [];
    const result = runProjection({
      repoRoot,
      distParent,
      live,
      injectPostPublishFault() {
        throw new Error('cleanup fault');
      },
      warn(message) {
        warnings.push(message);
      },
    });
    assert.equal(result.committed, true);
    assert.equal(fs.readFileSync(path.join(live, 'payload.txt'), 'utf8'), 'v2\n');
    assert.match(warnings.join('\n'), /post-commit cleanup warning/u);
    assert.deepEqual(ownedResidues(distParent), []);
  }));

test('TPT-RUNTIME-04: extra/content/mode/hardlink/source drift all abort before commit', () =>
  fixture(({ repoRoot, sourceRoot, distParent, live }) => {
    runProjection({ repoRoot, distParent, live });
    const liveBefore = fs.readFileSync(path.join(live, 'payload.txt'));
    const candidateMutations = [
      {
        name: 'extra',
        apply(staging) {
          fs.writeFileSync(path.join(staging, 'extra.txt'), 'extra\n');
        },
      },
      {
        name: 'content',
        apply(staging) {
          fs.appendFileSync(path.join(staging, 'payload.txt'), 'tamper\n');
        },
      },
      {
        name: 'mode',
        apply(staging) {
          fs.chmodSync(path.join(staging, 'payload.txt'), 0o750);
        },
      },
      {
        name: 'hardlink',
        apply(staging) {
          const target = path.join(staging, 'payload.txt');
          const backing = path.join(repoRoot, '.hardlink-backing');
          fs.copyFileSync(target, backing);
          fs.unlinkSync(target);
          fs.linkSync(backing, target);
        },
      },
    ];

    for (const mutation of candidateMutations) {
      assert.throws(
        () =>
          runProjection({
            repoRoot,
            distParent,
            live,
            injectLateFault({ stagingAbsolute }) {
              mutation.apply(stagingAbsolute);
            },
          }),
        (error) =>
          error?.code === 'TPT-UNVERIFIED-COMMIT' ||
          error?.code === 'TPT-ARTIFACT-UNSAFE',
        mutation.name,
      );
      const backing = path.join(repoRoot, '.hardlink-backing');
      if (fs.existsSync(backing)) fs.unlinkSync(backing);
      assert.deepEqual(fs.readFileSync(path.join(live, 'payload.txt')), liveBefore);
      assert.deepEqual(ownedResidues(distParent), []);
    }

    assert.throws(
      () =>
        runProjection({
          repoRoot,
          distParent,
          live,
          injectLateFault() {
            fs.appendFileSync(path.join(sourceRoot, 'payload.txt'), 'source drift\n');
          },
        }),
      (error) => error?.code === 'TPT-SOURCE-DRIFT',
    );
    assert.deepEqual(fs.readFileSync(path.join(live, 'payload.txt')), liveBefore);
    assert.deepEqual(ownedResidues(distParent), []);
  }));
