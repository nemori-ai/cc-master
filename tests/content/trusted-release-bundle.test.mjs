import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  auditArchiveMembers,
  buildReleaseBundle,
  computeArtifactId,
  scanTree,
} from '../../scripts/trusted-release-bundle.mjs';
import { validateJsonSchema } from './helpers/trusted-projection/json-schema-validator.mjs';

const HOSTS = ['claude-code', 'codex', 'cursor', 'kimi-code'];
const TX_SCHEMA = JSON.parse(fs.readFileSync(path.resolve(
  import.meta.dirname,
  '../../design_docs/skill-knowledge-graph/schemas/trusted-projection-transaction.schema.json',
), 'utf8'));

function writeFile(root, relative, body, mode = 0o644) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, { mode });
}

function fixtureManifest(root, transactionId = 'tpt:tx:release-0001') {
  const docsRoot = path.join(root, 'docs');
  writeFile(docsRoot, 'README.md', 'frozen docs\n');
  writeFile(docsRoot, 'LICENSE', 'frozen license\n');
  writeFile(docsRoot, 'LICENSING.md', 'frozen licensing guide\n');
  writeFile(docsRoot, 'TRADEMARKS.md', 'frozen trademark policy\n');
  const docsSnapshot = scanTree(docsRoot, 'docs-frozen');

  const hosts = HOSTS.map((host) => {
    const snapshotRoot = path.join(root, 'snapshots', host);
    writeFile(snapshotRoot, `skills/${host}/SKILL.md`, `${host}\n`);
    writeFile(snapshotRoot, 'bin/run.sh', '#!/bin/sh\nexit 0\n', 0o755);
    const snapshot = scanTree(snapshotRoot, `host-${host}`);
    const expectedRoot = path.join(root, 'expected', host, 'cc-master');
    fs.cpSync(snapshotRoot, expectedRoot, { recursive: true });
    fs.cpSync(docsRoot, expectedRoot, { recursive: true });
    const expected = scanTree(path.dirname(expectedRoot), `bundle-${host}`);
    fs.rmSync(path.join(root, 'expected', host), { recursive: true, force: true });
    const attestation = {
      schema: 'cc-master/trusted-projection/verified-snapshot-attestation/v1alpha1',
      transaction_id: transactionId,
      verified_snapshot_attestation_id: '',
      candidate_snapshot_id: snapshot.artifact_snapshot_id,
      authorized_content_id: snapshot.artifact_content_id,
      sealed_content_id: snapshot.artifact_content_id,
      checks: [{
        invariant: 'P4',
        code: 'TPT-VERIFIED',
        ok: true,
        witness_sha256: snapshot.tree_sha256,
      }],
    };
    attestation.verified_snapshot_attestation_id = computeArtifactId(
      'verified-snapshot-attestation',
      'verified_snapshot_attestation_id',
      'verify',
      attestation,
    );
    const receipt = {
      transaction_id: transactionId,
      publish_receipt_id: '',
      verified_snapshot_attestation_id: attestation.verified_snapshot_attestation_id,
      outcome: 'committed',
      live_after_snapshot_id: snapshot.artifact_snapshot_id,
      committed_content_id: snapshot.artifact_content_id,
    };
    receipt.publish_receipt_id = computeArtifactId(
      'publish-receipt',
      'publish_receipt_id',
      'publish',
      receipt,
    );
    const plan = {
      schema: 'cc-master/trusted-projection/projection-plan/v1alpha1',
      transaction_id: transactionId,
      projection_plan_id: '',
      host,
      surface: 'release_bundle',
      input_kind: 'committed_artifact',
      input_snapshot_id: snapshot.artifact_snapshot_id,
      input_content_id: snapshot.artifact_content_id,
      upstream_publish_receipt_id: receipt.publish_receipt_id,
      expected_entries: expected.entries,
    };
    plan.projection_plan_id = computeArtifactId(
      'projection-plan',
      'projection_plan_id',
      'plan',
      plan,
    );
    return {
      host,
      snapshot_root: snapshotRoot,
      snapshot,
      verified_snapshot_attestation: attestation,
      bundle_projection_plan: plan,
      publish_receipt: receipt,
    };
  });

  return {
    schema: 'cc-master/trusted-release-input/v1alpha1',
    transaction_id: transactionId,
    tag: 'v9.9.9-test',
    commit: '0123456789abcdef0123456789abcdef01234567',
    version: '9.9.9-test',
    docs: {
      snapshot_root: docsRoot,
      snapshot: docsSnapshot,
    },
    hosts,
  };
}

test('builds and audits one exact four-host release directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-release-test-'));
  try {
    const manifest = fixtureManifest(root);
    const out = path.join(root, 'out');
    const result = buildReleaseBundle(manifest, out);

    assert.equal(result.hosts.length, 4);
    assert.ok(fs.existsSync(path.join(result.release_dir, 'SHA256SUMS')));
    assert.ok(fs.existsSync(path.join(result.release_dir, 'release-attestation.json')));
    const checksums = fs.readFileSync(path.join(result.release_dir, 'SHA256SUMS'), 'utf8');
    const releaseAttestation = JSON.parse(
      fs.readFileSync(path.join(result.release_dir, 'release-attestation.json'), 'utf8'),
    );
    assert.equal(releaseAttestation.tag, manifest.tag);
    assert.equal(releaseAttestation.commit, manifest.commit);
    assert.equal(releaseAttestation.version, manifest.version);
    assert.equal(releaseAttestation.docs.snapshot_id, manifest.docs.snapshot.artifact_snapshot_id);
    for (const host of HOSTS) {
      const filename = `cc-master-plugin-${host}-${manifest.tag}.zip`;
      const archive = path.join(result.release_dir, filename);
      assert.ok(fs.existsSync(archive));
      const digest = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
      assert.match(checksums, new RegExp(`^${digest}  ${filename}$`, 'mu'));
      const hostAttestation = releaseAttestation.hosts.find((entry) => entry.host === host);
      assert.equal(hostAttestation.archive_sha256, digest);
      assert.match(
        hostAttestation.release_bundle_attestation.release_bundle_attestation_id,
        /^tpt:release:[a-f0-9]{64}$/u,
      );
      assert.deepEqual(
        validateJsonSchema(
          TX_SCHEMA,
          hostAttestation.release_bundle_attestation,
          'releaseBundleAttestation',
        ),
        { ok: true, errors: [] },
      );
    }
    assert.equal(
      fs.readdirSync(out).filter((name) => name.startsWith('.release-tmp-')).length,
      0,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('source drift fails closed and preserves the previous good release', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-release-drift-'));
  try {
    const manifest = fixtureManifest(root);
    const out = path.join(root, 'out');
    const first = buildReleaseBundle(manifest, out);
    const marker = path.join(first.release_dir, 'preserved.marker');
    fs.writeFileSync(marker, 'old-good\n');

    fs.appendFileSync(path.join(manifest.hosts[0].snapshot_root, 'bin/run.sh'), '# drift\n');
    assert.throws(
      () => buildReleaseBundle(manifest, out),
      /TPT-(?:SOURCE-DRIFT|PLAN-DRIFT)/,
    );
    assert.equal(fs.readFileSync(marker, 'utf8'), 'old-good\n');
    assert.equal(
      fs.readdirSync(out).filter((name) => name.startsWith('.release-tmp-')).length,
      0,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('manifest-only shell adapter emits exactly the sealed upload set', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-release-shell-'));
  try {
    const manifest = fixtureManifest(root);
    for (const host of manifest.hosts) {
      host.snapshot_root = path.relative(root, host.snapshot_root);
    }
    manifest.docs.snapshot_root = path.relative(root, manifest.docs.snapshot_root);
    const manifestPath = path.join(root, 'release-input.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const result = spawnSync(
      'bash',
      ['scripts/package-plugin.sh', '--manifest', manifestPath, '--out-dir', path.join(root, 'out')],
      { cwd: path.resolve(import.meta.dirname, '../..'), encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    const outputs = result.stdout.trim().split('\n');
    assert.equal(outputs.length, 6);
    assert.ok(outputs.every((output) => fs.existsSync(output)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('filesystem aliases and unsafe archive members fail closed', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-release-attacks-'));
  try {
    const symlinkRoot = path.join(root, 'symlink');
    writeFile(symlinkRoot, 'real', 'bytes\n');
    fs.symlinkSync('real', path.join(symlinkRoot, 'alias'));
    assert.throws(() => scanTree(symlinkRoot, 'symlink'), /TPT-ARTIFACT-UNSAFE/);

    const hardlinkRoot = path.join(root, 'hardlink');
    writeFile(hardlinkRoot, 'real', 'bytes\n');
    fs.linkSync(path.join(hardlinkRoot, 'real'), path.join(hardlinkRoot, 'alias'));
    assert.throws(() => scanTree(hardlinkRoot, 'hardlink'), /TPT-ARTIFACT-UNSAFE/);

    const controlRoot = path.join(root, 'control');
    writeFile(controlRoot, 'line\nbreak', 'bytes\n');
    assert.throws(() => scanTree(controlRoot, 'control'), /TPT-ARTIFACT-UNSAFE/);

    const specialRoot = path.join(root, 'special');
    fs.mkdirSync(specialRoot);
    const fifo = spawnSync('mkfifo', [path.join(specialRoot, 'pipe')], { encoding: 'utf8' });
    if (fifo.status === 0) {
      assert.throws(() => scanTree(specialRoot, 'special'), /TPT-ARTIFACT-UNSAFE/);
    }

    const python = spawnSync('python3', ['--version'], { encoding: 'utf8' });
    if (python.status !== 0) {
      context.skip('python3 is unavailable for hostile ZIP fixture generation');
      return;
    }
    const attacks = [
      ['traversal.zip', '../escape', 0o100644],
      ['symlink.zip', 'cc-master/link', 0o120777],
      ['invalid-mode.zip', 'cc-master/file', 0],
    ];
    for (const [filename, member, mode] of attacks) {
      const archive = path.join(root, filename);
      const result = spawnSync('python3', ['-c', `
import sys, zipfile
archive, member, mode = sys.argv[1], sys.argv[2], int(sys.argv[3])
with zipfile.ZipFile(archive, "w") as z:
    info = zipfile.ZipInfo(member)
    info.create_system = 3
    info.external_attr = mode << 16
    z.writestr(info, b"x")
`, archive, member, String(mode)], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.throws(() => auditArchiveMembers(archive), /TPT-(?:ARTIFACT-UNSAFE|RELEASE-DRIFT)/);
    }

    const duplicate = path.join(root, 'duplicate.zip');
    const duplicateResult = spawnSync('python3', ['-c', `
import sys, warnings, zipfile
warnings.simplefilter("ignore")
with zipfile.ZipFile(sys.argv[1], "w") as z:
    z.writestr("cc-master/file", b"one")
    z.writestr("cc-master/file", b"two")
`, duplicate], { encoding: 'utf8' });
    assert.equal(duplicateResult.status, 0, duplicateResult.stderr);
    assert.throws(() => auditArchiveMembers(duplicate), /duplicate archive member/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
