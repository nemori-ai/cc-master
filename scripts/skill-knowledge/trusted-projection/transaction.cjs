'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SEALED_RECORDS = new WeakSet();
const MODE_MASK = 0o7777;

class TrustedProjectionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TrustedProjectionError';
    this.code = code;
    this.transaction_id = details.transaction_id ?? null;
    this.state = details.state ?? null;
    this.checkpoint = details.checkpoint ?? null;
    this.witness = details.witness ?? null;
    this.remediation =
      details.remediation ?? 'Start a new trusted projection transaction.';
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function lexicalByteCompare(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function assertSafeRelative(relative) {
  if (
    relative !== relative.normalize('NFC') ||
    relative.includes('\0') ||
    /[\u0001-\u001f\u007f]/u.test(relative)
  ) {
    throw new TrustedProjectionError(
      'TPT-ARTIFACT-UNSAFE',
      `unsafe or non-NFC projection path: ${JSON.stringify(relative)}`,
    );
  }
  for (const segment of relative.split('/')) {
    if (!segment || segment === '.' || segment === '..') {
      throw new TrustedProjectionError(
        'TPT-ARTIFACT-UNSAFE',
        `unsafe projection path segment: ${JSON.stringify(relative)}`,
      );
    }
  }
}

function readStableFile(absolute, located) {
  if (!Number.isInteger(fs.constants.O_NOFOLLOW)) {
    throw new TrustedProjectionError(
      'TPT-ARTIFACT-UNSAFE',
      'O_NOFOLLOW is unavailable; trusted projection fails closed',
    );
  }
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n) {
      throw new TrustedProjectionError(
        'TPT-ARTIFACT-UNSAFE',
        `projection input is not an alias-free regular file: ${absolute}`,
      );
    }
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd, { bigint: true });
    const pathAfter = fs.lstatSync(absolute, { bigint: true });
    for (const stat of [before, after, pathAfter]) {
      if (
        !stat.isFile() ||
        stat.nlink !== 1n ||
        stat.dev !== located.dev ||
        stat.ino !== located.ino ||
        stat.size !== located.size ||
        (stat.mode & BigInt(MODE_MASK)) !==
          (located.mode & BigInt(MODE_MASK)) ||
        stat.mtimeNs !== located.mtimeNs
      ) {
        throw new TrustedProjectionError(
          'TPT-ORACLE-UNSTABLE-FILE',
          `projection file changed while being observed: ${absolute}`,
        );
      }
    }
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

function scanTree(rootAbsolute, rootId) {
  const root = path.resolve(rootAbsolute);
  const rootStat = fs.lstatSync(root, { bigint: true });
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new TrustedProjectionError(
      'TPT-ARTIFACT-UNSAFE',
      `trusted projection root must be a real directory: ${root}`,
    );
  }
  const entries = [];

  function visit(absolute, relative) {
    const before = fs.lstatSync(absolute, { bigint: true });
    if (before.isSymbolicLink() || !before.isDirectory()) {
      throw new TrustedProjectionError(
        'TPT-ARTIFACT-UNSAFE',
        `projection directory is not real: ${absolute}`,
      );
    }
    const first = fs.readdirSync(absolute).sort(lexicalByteCompare);
    for (const name of first) {
      const childRelative = relative ? `${relative}/${name}` : name;
      assertSafeRelative(childRelative);
      const child = path.join(absolute, name);
      const located = fs.lstatSync(child, { bigint: true });
      if (located.isSymbolicLink()) {
        throw new TrustedProjectionError(
          'TPT-ARTIFACT-UNSAFE',
          `symlink is forbidden in trusted projection: ${childRelative}`,
        );
      }
      if (located.isDirectory()) {
        entries.push({
          path: childRelative,
          kind: 'directory',
          sha256: '',
          size: 0,
          executable: Boolean(Number(located.mode & 0o111n)),
          posix_mode: Number(located.mode & BigInt(MODE_MASK)),
        });
        visit(child, childRelative);
      } else if (located.isFile()) {
        if (located.nlink !== 1n) {
          throw new TrustedProjectionError(
            'TPT-ARTIFACT-UNSAFE',
            `hardlink is forbidden in trusted projection: ${childRelative}`,
          );
        }
        const bytes = readStableFile(child, located);
        entries.push({
          path: childRelative,
          kind: 'file',
          sha256: sha256(bytes),
          size: bytes.length,
          executable: Boolean(Number(located.mode & 0o111n)),
          posix_mode: Number(located.mode & BigInt(MODE_MASK)),
        });
      } else {
        throw new TrustedProjectionError(
          'TPT-ARTIFACT-UNSAFE',
          `special file is forbidden in trusted projection: ${childRelative}`,
        );
      }
    }
    const second = fs.readdirSync(absolute).sort(lexicalByteCompare);
    const after = fs.lstatSync(absolute, { bigint: true });
    if (
      stableJson(first) !== stableJson(second) ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.mtimeNs !== before.mtimeNs
    ) {
      throw new TrustedProjectionError(
        'TPT-ORACLE-UNSTABLE-DIRECTORY',
        `projection directory changed while being observed: ${absolute}`,
      );
    }
  }

  visit(root, '');
  entries.sort((left, right) => lexicalByteCompare(left.path, right.path));
  const directoryPaths = entries
    .filter(({ kind }) => kind === 'directory')
    .map(({ path: relative }) => relative)
    .sort((left, right) => right.split('/').length - left.split('/').length);
  for (const directoryPath of directoryPaths) {
    const prefix = `${directoryPath}/`;
    const directChildren = entries
      .filter(({ path: entryPath }) => {
        if (!entryPath.startsWith(prefix)) return false;
        return !entryPath.slice(prefix.length).includes('/');
      })
      .map(({ path: entryPath, kind, sha256: digest, size, executable, posix_mode }) => ({
        path: entryPath,
        kind,
        sha256: digest,
        size,
        executable,
        posix_mode,
      }));
    entries.find(({ path: entryPath }) => entryPath === directoryPath).sha256 = sha256(
      stableJson(directChildren),
    );
  }
  const treeSha256 = sha256(stableJson(entries));
  return Object.freeze({
    schema: 'cc-master/trusted-projection/internal-snapshot/v1',
    root_id: rootId,
    artifact_content_id: `tpt:content:${treeSha256}`,
    tree_sha256: treeSha256,
    entries: Object.freeze(entries.map((entry) => Object.freeze(entry))),
  });
}

function assertSnapshotEqual(expected, actual, code, message) {
  if (
    expected.tree_sha256 !== actual.tree_sha256 ||
    stableJson(expected.entries) !== stableJson(actual.entries)
  ) {
    throw new TrustedProjectionError(code, message, {
      witness: {
        expected_sha256: expected.tree_sha256,
        actual_sha256: actual.tree_sha256,
      },
    });
  }
}

function copyTreeFromSnapshot(sourceRoot, destinationRoot, expected) {
  fs.mkdirSync(destinationRoot, { recursive: true });
  for (const entry of expected.entries) {
    const destination = path.join(destinationRoot, ...entry.path.split('/'));
    if (entry.kind === 'directory') {
      fs.mkdirSync(destination);
      fs.chmodSync(destination, entry.posix_mode);
      continue;
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const source = path.join(sourceRoot, ...entry.path.split('/'));
    const located = fs.lstatSync(source, { bigint: true });
    const bytes = readStableFile(source, located);
    const fd = fs.openSync(
      destination,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
      entry.posix_mode,
    );
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.chmodSync(destination, entry.posix_mode);
  }
  const sourceAfter = scanTree(sourceRoot, `${expected.root_id}-copy-source-after`);
  assertSnapshotEqual(
    expected,
    sourceAfter,
    'TPT-SOURCE-DRIFT',
    'source changed while the frozen copy was made',
  );
  const copied = scanTree(destinationRoot, `${expected.root_id}-frozen-copy`);
  assertSnapshotEqual(
    expected,
    copied,
    'TPT-SOURCE-DRIFT',
    'frozen copy does not exactly match its source snapshot',
  );
}

function removeTreeNoFollow(target, containmentRoot) {
  const absolute = path.resolve(target);
  const root = path.resolve(containmentRoot);
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`refusing to remove outside transaction root: ${absolute}`);
  }
  const stat = lstatOrNull(absolute);
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fs.unlinkSync(absolute);
    return;
  }
  for (const name of fs.readdirSync(absolute)) {
    removeTreeNoFollow(path.join(absolute, name), root);
  }
  fs.rmdirSync(absolute);
}

function fsyncDirectory(absolute) {
  const fd = fs.openSync(absolute, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function writeJournal(lockRoot, journal) {
  const temporary = path.join(lockRoot, 'journal.next.json');
  const target = path.join(lockRoot, 'journal.json');
  const fd = fs.openSync(
    temporary,
    fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_WRONLY,
    0o600,
  );
  try {
    fs.writeFileSync(fd, `${JSON.stringify(journal, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, target);
  fsyncDirectory(lockRoot);
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function recoverStaleLock({ lockRoot, distParent, live, backup, host }) {
  const journalPath = path.join(lockRoot, 'journal.json');
  if (!fs.existsSync(journalPath)) {
    removeTreeNoFollow(lockRoot, distParent);
    return;
  }
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  if (processIsAlive(journal.pid)) {
    throw new TrustedProjectionError(
      'TPT-TRANSACTION-BUSY',
      `trusted projection transaction already owns ${host}`,
      { transaction_id: journal.transaction_id, state: journal.state },
    );
  }
  const backupStat = lstatOrNull(backup);
  const liveStat = lstatOrNull(live);
  if (!liveStat && backupStat) {
    fs.renameSync(backup, live);
    fsyncDirectory(distParent);
  } else if (backupStat && liveStat) {
    const liveSnapshot = scanTree(live, 'recovery-live');
    if (liveSnapshot.tree_sha256 === journal.candidate_tree_sha256) {
      removeTreeNoFollow(backup, distParent);
    } else if (liveSnapshot.tree_sha256 === journal.live_before_tree_sha256) {
      removeTreeNoFollow(backup, distParent);
    } else {
      throw new TrustedProjectionError(
        'TPT-RECOVERY-REQUIRED',
        `cannot deterministically recover stale ${host} projection transaction`,
        { transaction_id: journal.transaction_id, state: journal.state },
      );
    }
  }
  removeTreeNoFollow(lockRoot, distParent);
}

function acquireHostLock({ distParent, live, host, transactionId }) {
  const lockRoot = path.join(distParent, `.${host}.trusted-projection.lock`);
  const backup = path.join(distParent, `.${host}.trusted-projection.backup`);
  try {
    fs.mkdirSync(lockRoot, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    recoverStaleLock({ lockRoot, distParent, live, backup, host });
    fs.mkdirSync(lockRoot, { mode: 0o700 });
  }
  try {
    // A retained backup with no lock is a previous committed transaction's
    // post-commit cleanup warning. Retry that cleanup under the newly acquired
    // host lock; if live is absent, restore instead of guessing that commit won.
    if (lstatOrNull(backup)) {
      if (lstatOrNull(live)) removeTreeNoFollow(backup, distParent);
      else fs.renameSync(backup, live);
      fsyncDirectory(distParent);
    }
    writeJournal(lockRoot, {
      schema: 'cc-master/trusted-projection/journal/v1',
      transaction_id: transactionId,
      pid: process.pid,
      host,
      state: 'LOCKED',
      live_before_tree_sha256: null,
      candidate_tree_sha256: null,
    });
  } catch (error) {
    if (lstatOrNull(lockRoot)) removeTreeNoFollow(lockRoot, distParent);
    throw error;
  }
  return { lockRoot, backup };
}

function freezeSupportTree(repoRoot, frozenRepoRoot, relative) {
  const source = path.join(repoRoot, ...relative.split('/'));
  if (!lstatOrNull(source)) return;
  const snapshot = scanTree(source, `support:${relative}`);
  const destination = path.join(frozenRepoRoot, ...relative.split('/'));
  copyTreeFromSnapshot(source, destination, snapshot);
}

function createSealedRecord({
  transactionId,
  sourceSnapshot,
  planSnapshot,
  candidateSnapshot,
  candidateRoot,
  originalSourceRoot,
}) {
  const record = Object.freeze({
    transaction_id: transactionId,
    source_snapshot: sourceSnapshot,
    projection_plan: Object.freeze({
      schema: 'cc-master/trusted-projection/internal-plan/v1',
      expected_snapshot: planSnapshot,
      projection_plan_id: `tpt:plan:${sha256(
        stableJson({
          transaction_id: transactionId,
          source_content_id: sourceSnapshot.artifact_content_id,
          expected_content_id: planSnapshot.artifact_content_id,
        }),
      )}`,
    }),
    verified_snapshot: candidateSnapshot,
    verified_snapshot_attestation: Object.freeze({
      schema: 'cc-master/trusted-projection/internal-attestation/v1',
      transaction_id: transactionId,
      authorized_content_id: candidateSnapshot.artifact_content_id,
      sealed_content_id: candidateSnapshot.artifact_content_id,
      source_content_id: sourceSnapshot.artifact_content_id,
      projection_plan_content_id: planSnapshot.artifact_content_id,
    }),
    candidate_root: candidateRoot,
    original_source_root: originalSourceRoot,
  });
  SEALED_RECORDS.add(record);
  return record;
}

function publishSealedHostTree({
  sealed,
  distParent,
  live,
  backup,
  lockRoot,
  injectCommitFault,
  warn,
}) {
  if (!SEALED_RECORDS.has(sealed)) {
    throw new TrustedProjectionError(
      'TPT-UNVERIFIED-COMMIT',
      'publisher requires an in-process sealed verified snapshot attestation',
    );
  }
  const transactionId = sealed.transaction_id;
  const currentSource = scanTree(sealed.original_source_root, 'source-commit-prepare');
  assertSnapshotEqual(
    sealed.source_snapshot,
    currentSource,
    'TPT-SOURCE-DRIFT',
    'source changed after freeze and before commit prepare',
  );
  const currentCandidate = scanTree(sealed.candidate_root, 'candidate-commit-prepare');
  assertSnapshotEqual(
    sealed.verified_snapshot,
    currentCandidate,
    'TPT-UNVERIFIED-COMMIT',
    'sealed candidate changed before commit',
  );
  assertSnapshotEqual(
    sealed.projection_plan.expected_snapshot,
    currentCandidate,
    'TPT-PLAN-DRIFT',
    'candidate does not exactly match the independently frozen projection plan',
  );

  const liveBefore = lstatOrNull(live) ? scanTree(live, 'live-before') : null;
  if (lstatOrNull(backup)) {
    throw new TrustedProjectionError(
      'TPT-COMMIT-PREPARE',
      `trusted projection backup is already owned: ${backup}`,
    );
  }
  fsyncDirectory(sealed.candidate_root);
  const journal = {
    schema: 'cc-master/trusted-projection/journal/v1',
    transaction_id: transactionId,
    pid: process.pid,
    state: 'COMMIT_PREPARED',
    live_before_tree_sha256: liveBefore?.tree_sha256 ?? null,
    candidate_tree_sha256: currentCandidate.tree_sha256,
  };
  writeJournal(lockRoot, journal);

  let liveMoved = false;
  try {
    journal.state = 'COMMITTING';
    writeJournal(lockRoot, journal);
    if (liveBefore) {
      fs.renameSync(live, backup);
      liveMoved = true;
    }
    if (typeof injectCommitFault === 'function') {
      injectCommitFault('after-live-to-backup');
    }
    fs.renameSync(sealed.candidate_root, live);
    if (typeof injectCommitFault === 'function') {
      injectCommitFault('after-candidate-to-live');
    }
    const liveAfter = scanTree(live, 'live-after');
    assertSnapshotEqual(
      sealed.verified_snapshot,
      liveAfter,
      'TPT-OUTCOME-CONTRADICTION',
      'published live tree does not equal sealed content',
    );
    fsyncDirectory(distParent);
    journal.state = 'COMMITTED';
    writeJournal(lockRoot, journal);

    let backupRetained = false;
    if (liveMoved && lstatOrNull(backup)) {
      try {
        removeTreeNoFollow(backup, distParent);
      } catch (error) {
        backupRetained = true;
        warn(
          `trusted projection committed; backup cleanup retained for recovery: ${error.message}`,
        );
      }
    }
    return {
      ok: true,
      committed: true,
      backupRetained,
      recoveryRef: backupRetained ? backup : null,
      transaction_id: transactionId,
      committedContentId: liveAfter.artifact_content_id,
    };
  } catch (error) {
    const liveNow = lstatOrNull(live);
    if (liveNow) removeTreeNoFollow(live, distParent);
    if (lstatOrNull(backup)) fs.renameSync(backup, live);
    const restored = liveBefore
      ? scanTree(live, 'live-restored')
      : lstatOrNull(live)
        ? null
        : { tree_sha256: null, entries: [] };
    const restoredExact =
      liveBefore === null
        ? restored?.tree_sha256 === null
        : restored &&
          restored.tree_sha256 === liveBefore.tree_sha256 &&
          stableJson(restored.entries) === stableJson(liveBefore.entries);
    fsyncDirectory(distParent);
    if (!restoredExact) {
      journal.state = 'RECOVERY_REQUIRED';
      writeJournal(lockRoot, journal);
      throw new TrustedProjectionError(
        'TPT-RECOVERY-REQUIRED',
        `trusted projection could not prove rollback for ${path.basename(live)}`,
        { transaction_id: transactionId, state: 'RECOVERY_REQUIRED' },
      );
    }
    throw error;
  }
}

function runTrustedProjectionTransaction({
  repoRoot,
  host,
  distParent,
  live,
  buildCandidate,
  injectLateFault,
  injectPostPublishFault,
  injectCommitFault,
  warn = console.warn,
}) {
  const sourceRoot = path.join(repoRoot, 'plugin/src');
  const sourceSnapshot = scanTree(sourceRoot, 'plugin-src');
  const transactionId = `tpt:tx:${sha256(
    stableJson({
      host,
      source_content_id: sourceSnapshot.artifact_content_id,
    }),
  )}`;
  const { lockRoot, backup } = acquireHostLock({
    distParent,
    live,
    host,
    transactionId,
  });
  let committed = false;
  let recoveryRequired = false;
  try {
    const frozenRepoRoot = path.join(lockRoot, 'scratch-repo');
    copyTreeFromSnapshot(
      sourceRoot,
      path.join(frozenRepoRoot, 'plugin/src'),
      sourceSnapshot,
    );
    for (const relative of [
      'scripts',
      'design_docs/skill-knowledge-graph',
      'ccm/apps/cli/src',
    ]) {
      freezeSupportTree(repoRoot, frozenRepoRoot, relative);
    }
    fs.mkdirSync(path.join(frozenRepoRoot, 'plugin/dist'), { recursive: true });

    const planRoot = path.join(
      frozenRepoRoot,
      'plugin/dist',
      `${host}.write-trusted-plan`,
    );
    fs.mkdirSync(planRoot);
    buildCandidate({ frozenRepoRoot, candidateRoot: planRoot, purpose: 'plan' });
    const planSnapshot = scanTree(planRoot, 'trusted-plan');

    const candidateRoot = path.join(
      frozenRepoRoot,
      'plugin/dist',
      `${host}.write-trusted-candidate`,
    );
    fs.mkdirSync(candidateRoot);
    buildCandidate({
      frozenRepoRoot,
      candidateRoot,
      purpose: 'candidate',
    });
    const candidateSnapshot = scanTree(candidateRoot, 'candidate');
    assertSnapshotEqual(
      planSnapshot,
      candidateSnapshot,
      'TPT-PLAN-DRIFT',
      'candidate differs from the independently frozen trusted projection plan',
    );
    const sourceAtVerify = scanTree(sourceRoot, 'source-verify');
    assertSnapshotEqual(
      sourceSnapshot,
      sourceAtVerify,
      'TPT-SOURCE-DRIFT',
      'source changed after freeze and before verification',
    );
    const sealed = createSealedRecord({
      transactionId,
      sourceSnapshot,
      planSnapshot,
      candidateSnapshot,
      candidateRoot,
      originalSourceRoot: sourceRoot,
    });

    if (typeof injectLateFault === 'function') {
      injectLateFault({
        distParentAbsolute: path.resolve(distParent),
        liveAbsolute: path.resolve(live),
        stagingAbsolute: path.resolve(candidateRoot),
        backupAbsolute: path.resolve(backup),
        stamp: transactionId.slice(-16),
      });
    }

    const published = publishSealedHostTree({
      sealed,
      distParent,
      live,
      backup,
      lockRoot,
      injectCommitFault,
      warn,
    });
    committed = true;
    if (typeof injectPostPublishFault === 'function') {
      try {
        injectPostPublishFault({
          distParentAbsolute: path.resolve(distParent),
          liveAbsolute: path.resolve(live),
          stagingAbsolute: path.resolve(candidateRoot),
          backupAbsolute: path.resolve(backup),
          stamp: transactionId.slice(-16),
          published,
        });
      } catch (error) {
        warn(
          `trusted projection post-commit cleanup warning (commit remains successful): ${error.message}`,
        );
      }
    }
    return published;
  } catch (error) {
    recoveryRequired = error?.code === 'TPT-RECOVERY-REQUIRED';
    throw error;
  } finally {
    if (!recoveryRequired) {
      if (!committed && lstatOrNull(backup) && !lstatOrNull(live)) {
        fs.renameSync(backup, live);
        fsyncDirectory(distParent);
      }
      if (lstatOrNull(lockRoot)) {
        removeTreeNoFollow(lockRoot, distParent);
      }
      if (!committed && lstatOrNull(backup)) {
        removeTreeNoFollow(backup, distParent);
      }
    }
  }
}

module.exports = {
  TrustedProjectionError,
  publishSealedHostTree,
  runTrustedProjectionTransaction,
  scanTree,
};
