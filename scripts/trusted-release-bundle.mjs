#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const RELEASE_INPUT_SCHEMA = 'cc-master/trusted-release-input/v1alpha1';
export const RELEASE_ATTESTATION_SCHEMA = 'cc-master/release-package-attestation/v1alpha1';
export const HOSTS = Object.freeze(['claude-code', 'codex', 'cursor', 'kimi-code']);
export const REQUIRED_RELEASE_DOCS = Object.freeze([
  'LICENSE',
  'LICENSING.md',
  'TRADEMARKS.md',
]);

const FORBIDDEN_SEGMENTS = new Set([
  '.design',
  'evals',
  'knowledge',
  'node_modules',
  'plugin',
  'src',
]);

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalHash(domain, body) {
  return crypto.createHash('sha256')
    .update(`cc-master/trusted-projection/${domain}/v1alpha1\0`, 'utf8')
    .update(canonicalJson(body), 'utf8')
    .digest('hex');
}

export function computeArtifactId(kind, idField, prefix, artifact) {
  const body = Object.fromEntries(
    Object.entries(artifact).filter(([key]) => key !== idField),
  );
  return `tpt:${prefix}:${canonicalHash(kind, body)}`;
}

function assertArtifactId(kind, idField, prefix, artifact, label) {
  const expected = computeArtifactId(kind, idField, prefix, artifact);
  if (artifact?.[idField] !== expected) {
    fail('TPT-ATTESTATION-STALE', `${label} canonical ID mismatch`);
  }
}

function utf8Order(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function validateRelativePath(relative) {
  if (relative === '.') return;
  if (
    typeof relative !== 'string'
    || relative.length === 0
    || relative.startsWith('/')
    || relative.includes('\\')
    || relative.normalize('NFC') !== relative
    || /[\u0000-\u001f\u007f]/u.test(relative)
  ) {
    fail('TPT-ARTIFACT-UNSAFE', `invalid artifact path ${JSON.stringify(relative)}`);
  }
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      fail('TPT-ARTIFACT-UNSAFE', `invalid artifact path segment in ${relative}`);
    }
  }
}

function assertNoReleaseMetaPath(relative) {
  const segments = relative === '.' ? [] : relative.split('/');
  if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) {
    fail('TPT-PLAN-DRIFT', `repo-only knowledge/meta path is forbidden: ${relative}`);
  }
  if (segments.some((segment) => segment === 'strategy.yaml' || segment === 'CONTRACT.md')) {
    fail('TPT-PLAN-DRIFT', `repo-only strategy/contract path is forbidden: ${relative}`);
  }
}

function fileEntry(absolute, relative, stat) {
  if (!stat.isFile() || stat.nlink !== 1) {
    fail('TPT-ARTIFACT-UNSAFE', `${relative} is not an alias-free regular file`);
  }
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  const fd = fs.openSync(absolute, flags);
  try {
    const before = fs.fstatSync(fd);
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    const located = fs.lstatSync(absolute);
    for (const field of ['dev', 'ino', 'nlink', 'size', 'mode', 'mtimeMs']) {
      if (before[field] !== after[field] || after[field] !== located[field]) {
        fail('TPT-ORACLE-UNSTABLE-FILE', `${relative} changed during scan`);
      }
    }
    const posixMode = stat.mode & 0o7777;
    return {
      path: relative,
      kind: 'file',
      sha256: sha256(bytes),
      size: bytes.length,
      executable: Boolean(posixMode & 0o111),
      posix_mode: posixMode,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function directoryHash(relative, entries) {
  const prefix = relative === '.' ? '' : `${relative}/`;
  const children = entries
    .filter((entry) => {
      if (!entry.path.startsWith(prefix) || entry.path === relative) return false;
      return !entry.path.slice(prefix.length).includes('/');
    })
    .sort((left, right) => utf8Order(left.path, right.path))
    .map((entry) => [
      entry.path.slice(prefix.length),
      entry.kind,
      entry.sha256,
      entry.size,
      entry.executable,
      entry.posix_mode,
    ]);
  return canonicalHash('directory-entry', children.map(([
    childPath,
    kind,
    childSha256,
    size,
    executable,
    posixMode,
  ]) => ({
    path: relative === '.' ? childPath : `${relative}/${childPath}`,
    kind,
    sha256: childSha256,
    size,
    executable,
    posix_mode: posixMode,
  })));
}

export function scanTree(root, rootId) {
  if (!/^[a-z][a-z0-9.-]*$/u.test(rootId)) {
    fail('TPT-ARTIFACT-UNSAFE', `invalid logical root id ${rootId}`);
  }
  if (typeof fs.constants.O_NOFOLLOW !== 'number' || fs.constants.O_NOFOLLOW === 0) {
    fail('TPT-ARTIFACT-UNSAFE', 'O_NOFOLLOW is required by the posix-12bit identity model');
  }
  const absoluteRoot = path.resolve(root);
  const initial = fs.lstatSync(absoluteRoot);
  if (!initial.isDirectory() || initial.isSymbolicLink()) {
    fail('TPT-ARTIFACT-UNSAFE', `snapshot root is not a real directory: ${rootId}`);
  }
  const entries = [];
  const directories = [];

  function visit(absolute, relative) {
    validateRelativePath(relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      fail('TPT-ARTIFACT-UNSAFE', `symlink rejected: ${relative}`);
    }
    if (stat.isFile()) {
      entries.push(fileEntry(absolute, relative, stat));
      return;
    }
    if (!stat.isDirectory()) {
      fail('TPT-ARTIFACT-UNSAFE', `special filesystem object rejected: ${relative}`);
    }
    const directoryFlags = fs.constants.O_RDONLY
      | fs.constants.O_NOFOLLOW
      | (fs.constants.O_DIRECTORY ?? 0);
    const fd = fs.openSync(absolute, directoryFlags);
    let before;
    let after;
    let namesBefore;
    let namesAfter;
    try {
      before = fs.fstatSync(fd);
      if (!before.isDirectory() || before.dev !== stat.dev || before.ino !== stat.ino) {
        fail('TPT-ORACLE-UNSTABLE-DIRECTORY', `${relative} changed before traversal`);
      }
      namesBefore = fs.readdirSync(absolute).sort(utf8Order);
      for (const name of namesBefore) {
        validateRelativePath(relative === '.' ? name : `${relative}/${name}`);
        visit(path.join(absolute, name), relative === '.' ? name : `${relative}/${name}`);
      }
      namesAfter = fs.readdirSync(absolute).sort(utf8Order);
      after = fs.fstatSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const located = fs.lstatSync(absolute);
    if (
      JSON.stringify(namesBefore) !== JSON.stringify(namesAfter)
      || !after.isDirectory()
      || located.isSymbolicLink()
      || !located.isDirectory()
      || before.dev !== after.dev
      || before.ino !== after.ino
      || after.dev !== located.dev
      || after.ino !== located.ino
      || before.mode !== after.mode
      || after.mode !== located.mode
      || before.mtimeMs !== after.mtimeMs
      || after.mtimeMs !== located.mtimeMs
    ) {
      fail('TPT-ORACLE-UNSTABLE-DIRECTORY', `${relative} changed during scan`);
    }
    directories.push({
      path: relative,
      kind: 'directory',
      sha256: '',
      size: 0,
      executable: Boolean((stat.mode & 0o7777) & 0o111),
      posix_mode: stat.mode & 0o7777,
    });
  }

  visit(absoluteRoot, '.');
  entries.push(...directories);
  for (const entry of entries.filter(({ kind }) => kind === 'directory')) {
    entry.sha256 = directoryHash(entry.path, entries);
  }
  entries.sort((left, right) => utf8Order(left.path, right.path));
  const treeSha256 = canonicalHash('artifact-tree', { entries });
  const artifactContentId = `tpt:content:${treeSha256}`;
  const snapshot = {
    schema: 'cc-master/trusted-projection/artifact-snapshot/v1alpha1',
    artifact_snapshot_id: '',
    artifact_content_id: artifactContentId,
    root_id: rootId,
    mode_model: 'posix-12bit',
    entries,
    tree_sha256: treeSha256,
  };
  const { artifact_snapshot_id: ignored, ...snapshotBody } = snapshot;
  snapshot.artifact_snapshot_id =
    `tpt:observation:${canonicalHash('artifact-snapshot', snapshotBody)}`;
  return snapshot;
}

function assertExactSnapshot(actual, expected, label) {
  if (
    actual.artifact_snapshot_id !== expected.artifact_snapshot_id
    || actual.artifact_content_id !== expected.artifact_content_id
    || actual.tree_sha256 !== expected.tree_sha256
    || JSON.stringify(actual.entries) !== JSON.stringify(expected.entries)
  ) {
    fail('TPT-SOURCE-DRIFT', `${label} no longer matches its frozen snapshot`);
  }
}

function assertHostInput(hostInput, transactionId) {
  const {
    host,
    snapshot,
    verified_snapshot_attestation: attestation,
    publish_receipt: receipt,
    bundle_projection_plan: plan,
  } = hostInput;
  if (!HOSTS.includes(host)) fail('TPT-PLAN-DRIFT', `unsupported host ${host}`);
  assertArtifactId(
    'verified-snapshot-attestation',
    'verified_snapshot_attestation_id',
    'verify',
    attestation,
    `${host} verification attestation`,
  );
  assertArtifactId(
    'projection-plan',
    'projection_plan_id',
    'plan',
    plan,
    `${host} bundle plan`,
  );
  assertArtifactId(
    'publish-receipt',
    'publish_receipt_id',
    'publish',
    receipt,
    `${host} publish receipt`,
  );
  if (
    attestation?.transaction_id !== transactionId
    || plan?.transaction_id !== transactionId
    || receipt?.transaction_id !== transactionId
  ) {
    fail('TPT-ATTESTATION-STALE', `${host} has a split transaction chain`);
  }
  if (
    attestation.candidate_snapshot_id !== snapshot.artifact_snapshot_id
    || attestation.authorized_content_id !== snapshot.artifact_content_id
    || attestation.sealed_content_id !== snapshot.artifact_content_id
  ) {
    fail('TPT-ATTESTATION-STALE', `${host} attestation does not authorize the frozen snapshot`);
  }
  if (
    !Array.isArray(attestation.checks)
    || attestation.checks.length === 0
    || attestation.checks.some((check) => check?.ok !== true)
  ) {
    fail('TPT-ATTESTATION-STALE', `${host} attestation contains no complete passing proof`);
  }
  if (
    receipt.outcome !== 'committed'
    || receipt.verified_snapshot_attestation_id !== attestation.verified_snapshot_attestation_id
    || receipt.live_after_snapshot_id !== snapshot.artifact_snapshot_id
    || receipt.committed_content_id !== snapshot.artifact_content_id
  ) {
    fail('TPT-ATTESTATION-STALE', `${host} receipt is not committed from the attested snapshot`);
  }
  if (
    plan.surface !== 'release_bundle'
    || plan.host !== host
    || plan.input_kind !== 'committed_artifact'
    || plan.input_snapshot_id !== snapshot.artifact_snapshot_id
    || plan.input_content_id !== snapshot.artifact_content_id
    || plan.upstream_publish_receipt_id !== receipt.publish_receipt_id
    || !Array.isArray(plan.expected_entries)
  ) {
    fail('TPT-PLAN-DRIFT', `${host} bundle plan is not frozen over its committed snapshot`);
  }
  const plannedPaths = new Set(plan.expected_entries.map((entry) => entry.path));
  for (const document of REQUIRED_RELEASE_DOCS) {
    if (!plannedPaths.has(`cc-master/${document}`)) {
      fail('TPT-PLAN-DRIFT', `${host} bundle plan omits required release document ${document}`);
    }
  }
}

function entryIdentity(entry) {
  return JSON.stringify([
    entry.kind,
    entry.sha256,
    entry.size,
    entry.executable,
    entry.posix_mode,
  ]);
}

function copyPlannedTree(hostInput, docs, stageRoot) {
  const expected = hostInput.bundle_projection_plan.expected_entries;
  const seen = new Set();
  for (const entry of expected) {
    validateRelativePath(entry.path);
    assertNoReleaseMetaPath(entry.path);
    if (seen.has(entry.path)) fail('TPT-PLAN-DRIFT', `duplicate planned path ${entry.path}`);
    seen.add(entry.path);
  }
  const ordered = [...expected].sort((left, right) => utf8Order(left.path, right.path));
  if (JSON.stringify(expected) !== JSON.stringify(ordered)) {
    fail('TPT-PLAN-DRIFT', `${hostInput.host} expected entries are not byte-order sorted`);
  }
  const byHost = new Map(hostInput.snapshot.entries.map((entry) => [entry.path, entry]));
  const byDocs = new Map(docs.snapshot.entries.map((entry) => [entry.path, entry]));

  for (const entry of expected.filter(({ kind }) => kind === 'directory')) {
    const target = entry.path === '.' ? stageRoot : path.join(stageRoot, entry.path);
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  }
  for (const entry of expected.filter(({ kind }) => kind === 'file')) {
    if (!entry.path.startsWith('cc-master/')) {
      fail('TPT-PLAN-DRIFT', `bundle member must be rooted at cc-master/: ${entry.path}`);
    }
    const relative = entry.path.slice('cc-master/'.length);
    const candidates = [
      [hostInput.snapshot_root, byHost.get(relative)],
      [docs.snapshot_root, byDocs.get(relative)],
    ].filter(([, candidate]) => candidate?.kind === 'file' && entryIdentity(candidate) === entryIdentity(entry));
    if (candidates.length !== 1) {
      fail('TPT-PLAN-DRIFT', `${entry.path} is not uniquely derived from frozen host/docs inputs`);
    }
    const [sourceRoot] = candidates[0];
    const source = path.join(sourceRoot, relative);
    const target = path.join(stageRoot, entry.path);
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, entry.posix_mode);
  }
  for (const entry of expected.filter(({ kind }) => kind === 'directory').reverse()) {
    const target = entry.path === '.' ? stageRoot : path.join(stageRoot, entry.path);
    fs.chmodSync(target, entry.posix_mode);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) {
    fail(
      'TPT-RELEASE-DRIFT',
      `${command} failed: ${result.error?.message ?? result.stderr?.trim() ?? `exit ${result.status}`}`,
    );
  }
  return result.stdout;
}

export function auditArchiveMembers(archive) {
  const names = run('unzip', ['-Z1', archive]).split(/\r?\n/u).filter(Boolean);
  const seen = new Set();
  for (const name of names) {
    const normalized = name.endsWith('/') ? name.slice(0, -1) : name;
    validateRelativePath(normalized);
    assertNoReleaseMetaPath(normalized);
    if (seen.has(normalized)) fail('TPT-RELEASE-DRIFT', `duplicate archive member ${normalized}`);
    seen.add(normalized);
  }
  const modeLines = run('zipinfo', ['-l', archive])
    .split(/\r?\n/u)
    .filter((line) => /^[-dlcbps]/u.test(line));
  if (modeLines.length !== names.length) {
    fail('TPT-RELEASE-DRIFT', 'cannot attest every archive member mode');
  }
  for (let index = 0; index < names.length; index += 1) {
    const kind = modeLines[index][0];
    if (kind !== '-' && kind !== 'd') {
      fail('TPT-ARTIFACT-UNSAFE', `unsafe archive member kind ${kind}: ${names[index]}`);
    }
    if ((kind === 'd') !== names[index].endsWith('/')) {
      fail('TPT-RELEASE-DRIFT', `archive member kind/path mismatch: ${names[index]}`);
    }
  }
  return names;
}

function expectedArchiveNames(entries) {
  return entries
    .filter(({ path: relative }) => relative !== '.')
    .map((entry) => entry.kind === 'directory' ? `${entry.path}/` : entry.path);
}

function buildOne(hostInput, docs, transactionRoot, releaseRoot, tag) {
  const stage = path.join(transactionRoot, `stage-${hostInput.host}`);
  fs.mkdirSync(stage, { mode: 0o700 });
  copyPlannedTree(hostInput, docs, stage);
  const sealed = scanTree(stage, `sealed-release-${hostInput.host}`);
  const expected = hostInput.bundle_projection_plan.expected_entries;
  if (JSON.stringify(sealed.entries) !== JSON.stringify(expected)) {
    fail('TPT-PLAN-DRIFT', `${hostInput.host} private staging does not exactly match bundle plan`);
  }

  const filename = `cc-master-plugin-${hostInput.host}-${tag}.zip`;
  const archive = path.join(releaseRoot, filename);
  const plannedArchiveNames = expectedArchiveNames(expected);
  run('zip', ['-q', '-X', archive, '-@'], {
    cwd: stage,
    input: `${plannedArchiveNames.join('\n')}\n`,
  });
  const names = auditArchiveMembers(archive);
  if (JSON.stringify(names) !== JSON.stringify(plannedArchiveNames)) {
    fail('TPT-RELEASE-DRIFT', `${hostInput.host} archive member set/order differs from bundle plan`);
  }
  const extract = path.join(transactionRoot, `extract-${hostInput.host}`);
  fs.mkdirSync(extract, { mode: 0o700 });
  run('unzip', ['-q', archive, '-d', extract]);
  fs.chmodSync(extract, expected.find(({ path: relative }) => relative === '.').posix_mode);
  const extracted = scanTree(extract, `extracted-release-${hostInput.host}`);
  if (JSON.stringify(extracted.entries) !== JSON.stringify(expected)) {
    const mismatch = expected.find((entry, index) =>
      JSON.stringify(entry) !== JSON.stringify(extracted.entries[index]));
    fail(
      'TPT-RELEASE-DRIFT',
      `${hostInput.host} extracted bytes/modes differ from bundle plan at `
      + `${JSON.stringify(mismatch?.path ?? '<entry-count>')}`,
    );
  }
  const archiveSha256 = sha256(fs.readFileSync(archive));
  const releaseBundleAttestation = {
    schema: 'cc-master/trusted-projection/release-bundle-attestation/v1alpha1',
    transaction_id: hostInput.verified_snapshot_attestation.transaction_id,
    release_bundle_attestation_id: '',
    publish_receipt_id: hostInput.publish_receipt.publish_receipt_id,
    bundle_projection_plan_id: hostInput.bundle_projection_plan.projection_plan_id,
    archive_sha256: archiveSha256,
    archive_format: 'zip',
    extracted_snapshot_id: extracted.artifact_snapshot_id,
    extracted_content_id: extracted.artifact_content_id,
    checks: [
      {
        invariant: 'P2',
        code: 'TPT-ARTIFACT-SAFE',
        ok: true,
        witness_sha256: sealed.tree_sha256,
      },
      {
        invariant: 'P7',
        code: 'TPT-RELEASE-EXACT',
        ok: true,
        witness_sha256: extracted.tree_sha256,
      },
    ],
  };
  releaseBundleAttestation.release_bundle_attestation_id = computeArtifactId(
    'release-bundle-attestation',
    'release_bundle_attestation_id',
    'release',
    releaseBundleAttestation,
  );
  return {
    host: hostInput.host,
    filename,
    archive_sha256: archiveSha256,
    source_snapshot_id: hostInput.snapshot.artifact_snapshot_id,
    source_content_id: hostInput.snapshot.artifact_content_id,
    source_tree_sha256: hostInput.snapshot.tree_sha256,
    verified_snapshot_attestation_id:
      hostInput.verified_snapshot_attestation.verified_snapshot_attestation_id,
    publish_receipt_id: hostInput.publish_receipt.publish_receipt_id,
    bundle_projection_plan_id: hostInput.bundle_projection_plan.projection_plan_id,
    bundle_tree_sha256: sealed.tree_sha256,
    extracted_snapshot_id: extracted.artifact_snapshot_id,
    extracted_content_id: extracted.artifact_content_id,
    release_bundle_attestation: releaseBundleAttestation,
  };
}

function validateReleaseInput(manifest) {
  if (manifest?.schema !== RELEASE_INPUT_SCHEMA) {
    fail('TPT-PLAN-DRIFT', `unsupported release input schema ${manifest?.schema}`);
  }
  if (!/^[A-Za-z0-9._+-]+$/u.test(manifest.tag)) {
    fail('TPT-PLAN-DRIFT', 'tag is not safe for an artifact name');
  }
  if (!/^[0-9a-f]{40}$/u.test(manifest.commit) || typeof manifest.version !== 'string') {
    fail('TPT-ATTESTATION-STALE', 'release commit/version is not frozen');
  }
  if (manifest.tag !== `v${manifest.version}`) {
    fail('TPT-ATTESTATION-STALE', 'release tag and version do not identify the same version');
  }
  if (!Array.isArray(manifest.hosts) || manifest.hosts.length !== HOSTS.length) {
    fail('TPT-PLAN-DRIFT', 'release requires exactly four host inputs');
  }
  const suppliedHosts = manifest.hosts.map(({ host }) => host).sort(utf8Order);
  if (JSON.stringify(suppliedHosts) !== JSON.stringify([...HOSTS].sort(utf8Order))) {
    fail('TPT-PLAN-DRIFT', 'release host set is not exact');
  }
}

export function buildReleaseBundle(manifest, outputDirectory) {
  validateReleaseInput(manifest);
  const outputRoot = path.resolve(outputDirectory);
  fs.mkdirSync(outputRoot, { recursive: true });
  const transactionRoot = fs.mkdtempSync(path.join(outputRoot, '.release-tmp-'));
  fs.chmodSync(transactionRoot, 0o700);
  const releaseRoot = path.join(transactionRoot, 'release');
  fs.mkdirSync(releaseRoot, { mode: 0o700 });
  const finalRelease = path.join(outputRoot, `cc-master-plugin-${manifest.tag}`);
  try {
    const docsActual = scanTree(manifest.docs.snapshot_root, manifest.docs.snapshot.root_id);
    assertExactSnapshot(docsActual, manifest.docs.snapshot, 'docs');
    for (const entry of docsActual.entries) assertNoReleaseMetaPath(entry.path);

    for (const hostInput of manifest.hosts) {
      assertHostInput(hostInput, manifest.transaction_id);
      const actual = scanTree(hostInput.snapshot_root, hostInput.snapshot.root_id);
      assertExactSnapshot(actual, hostInput.snapshot, `${hostInput.host} host`);
    }

    const hostRecords = HOSTS.map((host) => buildOne(
      manifest.hosts.find((input) => input.host === host),
      manifest.docs,
      transactionRoot,
      releaseRoot,
      manifest.tag,
    ));
    assertExactSnapshot(
      scanTree(manifest.docs.snapshot_root, manifest.docs.snapshot.root_id),
      manifest.docs.snapshot,
      'docs at commit prepare',
    );
    for (const hostInput of manifest.hosts) {
      assertExactSnapshot(
        scanTree(hostInput.snapshot_root, hostInput.snapshot.root_id),
        hostInput.snapshot,
        `${hostInput.host} host at commit prepare`,
      );
    }
    const checksums = hostRecords
      .map(({ archive_sha256, filename }) => `${archive_sha256}  ${filename}`)
      .join('\n') + '\n';
    fs.writeFileSync(path.join(releaseRoot, 'SHA256SUMS'), checksums, { mode: 0o600 });
    const releaseAttestation = {
      schema: RELEASE_ATTESTATION_SCHEMA,
      transaction_id: manifest.transaction_id,
      tag: manifest.tag,
      commit: manifest.commit,
      version: manifest.version,
      docs: {
        snapshot_id: manifest.docs.snapshot.artifact_snapshot_id,
        content_id: manifest.docs.snapshot.artifact_content_id,
        tree_sha256: manifest.docs.snapshot.tree_sha256,
      },
      hosts: hostRecords,
      checksum_manifest_sha256: sha256(Buffer.from(checksums)),
    };
    releaseAttestation.release_attestation_id =
      `tpt:release-package:${sha256(Buffer.from(JSON.stringify(releaseAttestation)))}`;
    fs.writeFileSync(
      path.join(releaseRoot, 'release-attestation.json'),
      `${JSON.stringify(releaseAttestation, null, 2)}\n`,
      { mode: 0o600 },
    );
    if (fs.existsSync(finalRelease)) {
      fail('TPT-OUTCOME-CONTRADICTION', `refusing to replace existing release ${manifest.tag}`);
    }
    fs.renameSync(releaseRoot, finalRelease);
    return { release_dir: finalRelease, hosts: hostRecords, release_attestation: releaseAttestation };
  } finally {
    fs.rmSync(transactionRoot, { recursive: true, force: true });
  }
}

function usage() {
  process.stderr.write(
    'usage: node scripts/trusted-release-bundle.mjs build --manifest FILE --out-dir DIR\n',
  );
}

function materializeSnapshotLocator(locator, manifestRoot, destination, label) {
  if (
    !locator
    || locator.kind !== 'zip'
    || typeof locator.path !== 'string'
    || !/^[a-f0-9]{64}$/u.test(locator.sha256 ?? '')
    || Object.keys(locator).sort().join(',') !== 'kind,path,sha256'
  ) {
    fail(
      'TPT-ATTESTATION-STALE',
      `${label} requires an immutable mode-preserving zip snapshot locator`,
    );
  }
  const archive = path.resolve(manifestRoot, locator.path);
  const bytes = fs.readFileSync(archive);
  if (sha256(bytes) !== locator.sha256) {
    fail('TPT-SOURCE-DRIFT', `${label} snapshot archive digest changed`);
  }
  fs.mkdirSync(destination, { recursive: true });
  const extracted = spawnSync('unzip', ['-q', archive, '-d', destination], {
    encoding: 'utf8',
  });
  if (extracted.status !== 0) {
    fail(
      'TPT-ARTIFACT-UNSAFE',
      `${label} snapshot archive extraction failed: ${extracted.stderr || extracted.stdout}`,
    );
  }
  return destination;
}

function main(argv) {
  if (argv[0] !== 'build') {
    usage();
    return 2;
  }
  let manifestPath = '';
  let outDir = '';
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === '--manifest') manifestPath = argv[++index] ?? '';
    else if (argv[index] === '--out-dir') outDir = argv[++index] ?? '';
    else {
      usage();
      return 2;
    }
  }
  if (!manifestPath || !outDir) {
    usage();
    return 2;
  }
  const absoluteManifest = path.resolve(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(absoluteManifest, 'utf8'));
  const manifestRoot = path.dirname(absoluteManifest);
  fs.mkdirSync(path.resolve(outDir), { recursive: true });
  const materialized = fs.mkdtempSync(path.join(path.resolve(outDir), '.release-input-'));
  try {
    if (Object.hasOwn(manifest.docs ?? {}, 'snapshot_root')) {
      fail('TPT-ATTESTATION-STALE', 'raw docs snapshot_root transport is forbidden');
    }
    manifest.docs.snapshot_root = materializeSnapshotLocator(
      manifest.docs.snapshot_locator,
      manifestRoot,
      path.join(materialized, 'docs'),
      'docs',
    );
    for (const host of manifest.hosts) {
      if (Object.hasOwn(host, 'snapshot_root')) {
        fail('TPT-ATTESTATION-STALE', `raw ${host.host} snapshot_root transport is forbidden`);
      }
      host.snapshot_root = materializeSnapshotLocator(
        host.snapshot_locator,
        manifestRoot,
        path.join(materialized, host.host),
        host.host,
      );
    }
    const result = buildReleaseBundle(manifest, outDir);
    for (const { filename } of result.hosts) {
      process.stdout.write(`${path.join(result.release_dir, filename)}\n`);
    }
    process.stdout.write(`${path.join(result.release_dir, 'SHA256SUMS')}\n`);
    process.stdout.write(`${path.join(result.release_dir, 'release-attestation.json')}\n`);
  } finally {
    fs.rmSync(materialized, { recursive: true, force: true });
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
