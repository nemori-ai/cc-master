import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  canonicalHash,
  canonicalJson,
  computeArtifactId,
  computeContentId,
  computeTreeSha256,
} from './canonical-contract.mjs';

const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/u;
const POSIX_PLATFORMS = new Set([
  'aix',
  'darwin',
  'freebsd',
  'linux',
  'openbsd',
  'sunos',
]);

function sortPortableNames(names) {
  return [...names].sort((left, right) =>
    Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')),
  );
}

function portablePath(parent, name) {
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    CONTROL_OR_BACKSLASH.test(name)
  ) {
    throw new SnapshotOracleError('TPT-ORACLE-CONTROL-PATH', {
      parent,
      name,
    });
  }
  if (name !== name.normalize('NFC')) {
    throw new SnapshotOracleError('TPT-ORACLE-NON-NFC-PATH', {
      parent,
      name,
    });
  }
  return parent === '.' ? name : `${parent}/${name}`;
}

function logicalRootId(value) {
  const rootId = String(value ?? '');
  if (!/^[a-z][a-z0-9.-]*$/u.test(rootId)) {
    throw new SnapshotOracleError('TPT-ORACLE-ROOT-ID', { root_id: rootId });
  }
  return rootId;
}

function stableFsIdentity(stat) {
  return {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    mode: stat.mode.toString(),
    size: stat.size.toString(),
    nlink: stat.nlink.toString(),
    mtime_ns: stat.mtimeNs.toString(),
  };
}

function sameIdentity(left, right) {
  return canonicalJson(stableFsIdentity(left)) === canonicalJson(stableFsIdentity(right));
}

function entryMode(stat) {
  return Number(stat.mode & 0o7777n);
}

function entryExecutable(mode) {
  return (mode & 0o111) !== 0;
}

export function assertPortableModeSupport({
  platform = process.platform,
  noFollow = fs.constants.O_NOFOLLOW,
} = {}) {
  if (!POSIX_PLATFORMS.has(platform)) {
    throw new SnapshotOracleError('TPT-ORACLE-UNSUPPORTED-MODE-MODEL', {
      platform,
      required: 'posix-12bit',
    });
  }
  if (typeof noFollow !== 'number' || noFollow === 0) {
    throw new SnapshotOracleError('TPT-ORACLE-NOFOLLOW-UNAVAILABLE', {
      platform,
    });
  }
  return 'posix-12bit';
}

export class SnapshotOracleError extends Error {
  constructor(code, witness = {}) {
    const sanitize = (value) => {
      if (typeof value === 'string' && value !== value.normalize('NFC')) {
        return {
          unsafe_utf8_hex: Buffer.from(value, 'utf8').toString('hex'),
        };
      }
      if (Array.isArray(value)) return value.map(sanitize);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, sanitize(item)]),
        );
      }
      return value;
    };
    const sanitizedWitness = sanitize(witness);
    const stableWitness = { code, ...sanitizedWitness };
    super(`${code}: ${canonicalJson(sanitizedWitness)}`);
    this.name = 'SnapshotOracleError';
    this.code = code;
    this.witness = Object.freeze(stableWitness);
    this.witness_sha256 = canonicalHash('oracle-error', stableWitness);
  }
}

function openNoFollow(absolute, relative, directory) {
  const directoryFlag =
    directory && typeof fs.constants.O_DIRECTORY === 'number'
      ? fs.constants.O_DIRECTORY
      : 0;
  try {
    return fs.openSync(
      absolute,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | directoryFlag,
    );
  } catch (error) {
    throw new SnapshotOracleError('TPT-ORACLE-NOFOLLOW-OPEN', {
      path: relative,
      error_code: error?.code ?? 'UNKNOWN',
    });
  }
}

/**
 * Independent test-only snapshot oracle.
 *
 * Threat boundary: this mechanically detects ordinary concurrent drift by
 * no-follow fd identity, same-fd fstat before/after, path lstat after, and
 * double directory listing. It is not a defense against a hostile privileged
 * process deliberately swapping an entire directory out and back between all
 * checkpoints; production needs an isolated private workspace plus the same
 * checks.
 */
export function captureTreeSnapshot(
  rootAbsolute,
  { rootId = 'candidate', faultHook = null } = {},
) {
  assertPortableModeSupport();
  const root = path.resolve(rootAbsolute);
  const normalizedRootId = logicalRootId(rootId);
  let rootStat;
  try {
    rootStat = fs.lstatSync(root, { bigint: true });
  } catch (error) {
    throw new SnapshotOracleError('TPT-ORACLE-MISSING-ROOT', {
      root_id: normalizedRootId,
      error_code: error?.code ?? 'UNKNOWN',
    });
  }
  if (rootStat.isSymbolicLink()) {
    throw new SnapshotOracleError('TPT-ORACLE-SYMLINK', { path: '.' });
  }
  if (!rootStat.isDirectory()) {
    throw new SnapshotOracleError('TPT-ORACLE-ROOT-NOT-DIRECTORY', { path: '.' });
  }

  const entries = [];

  function visit(absolute, relative, locatedStat) {
    const stat = locatedStat ?? fs.lstatSync(absolute, { bigint: true });
    if (stat.isSymbolicLink()) {
      throw new SnapshotOracleError('TPT-ORACLE-SYMLINK', { path: relative });
    }
    const mode = entryMode(stat);

    if (stat.isFile()) {
      if (stat.nlink !== 1n) {
        throw new SnapshotOracleError('TPT-ORACLE-HARDLINK', {
          path: relative,
          link_count: stat.nlink.toString(),
        });
      }
      const fd = openNoFollow(absolute, relative, false);
      let fdBefore;
      let fdAfter;
      let bytes;
      try {
        fdBefore = fs.fstatSync(fd, { bigint: true });
        if (
          !fdBefore.isFile() ||
          fdBefore.nlink !== 1n ||
          !sameIdentity(stat, fdBefore)
        ) {
          throw new SnapshotOracleError('TPT-ORACLE-UNSTABLE-READ', {
            path: relative,
            checkpoint: 'fd-open',
          });
        }
        faultHook?.({
          checkpoint: 'FILE_FD_OPENED',
          path: relative,
          absolute,
        });
        bytes = fs.readFileSync(fd);
        fdAfter = fs.fstatSync(fd, { bigint: true });
      } finally {
        fs.closeSync(fd);
      }
      const pathAfter = fs.lstatSync(absolute, { bigint: true });
      if (
        !fdAfter.isFile() ||
        fdAfter.nlink !== 1n ||
        !pathAfter.isFile() ||
        pathAfter.isSymbolicLink() ||
        pathAfter.nlink !== 1n ||
        !sameIdentity(fdBefore, fdAfter) ||
        !sameIdentity(fdAfter, pathAfter)
      ) {
        throw new SnapshotOracleError('TPT-ORACLE-UNSTABLE-READ', {
          path: relative,
          checkpoint: 'fd-read-complete',
        });
      }
      const entry = {
        path: relative,
        kind: 'file',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        size: bytes.length,
        executable: entryExecutable(mode),
        posix_mode: mode,
      };
      entries.push(entry);
      return entry;
    }

    if (!stat.isDirectory()) {
      throw new SnapshotOracleError('TPT-ORACLE-SPECIAL', { path: relative });
    }

    const fd = openNoFollow(absolute, relative, true);
    let fdBefore;
    let fdAfter;
    let namesBefore;
    let namesAfter;
    const children = [];
    try {
      fdBefore = fs.fstatSync(fd, { bigint: true });
      if (!fdBefore.isDirectory() || !sameIdentity(stat, fdBefore)) {
        throw new SnapshotOracleError('TPT-ORACLE-UNSTABLE-DIRECTORY', {
          path: relative,
          checkpoint: 'fd-open',
        });
      }
      namesBefore = sortPortableNames(fs.readdirSync(absolute));
      faultHook?.({
        checkpoint: 'DIRECTORY_LISTED',
        path: relative,
        absolute,
      });
      for (const name of namesBefore) {
        const childRelative = portablePath(relative, name);
        children.push(visit(path.join(absolute, name), childRelative));
      }
      namesAfter = sortPortableNames(fs.readdirSync(absolute));
      fdAfter = fs.fstatSync(fd, { bigint: true });
    } finally {
      fs.closeSync(fd);
    }
    const pathAfter = fs.lstatSync(absolute, { bigint: true });
    if (
      !fdAfter.isDirectory() ||
      !pathAfter.isDirectory() ||
      pathAfter.isSymbolicLink() ||
      !sameIdentity(fdBefore, fdAfter) ||
      !sameIdentity(fdAfter, pathAfter) ||
      canonicalJson(namesBefore) !== canonicalJson(namesAfter)
    ) {
      throw new SnapshotOracleError('TPT-ORACLE-UNSTABLE-DIRECTORY', {
        path: relative,
        checkpoint: 'traversal-complete',
      });
    }

    const entry = {
      path: relative,
      kind: 'directory',
      sha256: canonicalHash(
        'directory-entry',
        children.map((child) => ({
          path: child.path,
          kind: child.kind,
          sha256: child.sha256,
          size: child.size,
          executable: child.executable,
          posix_mode: child.posix_mode,
        })),
      ),
      size: 0,
      executable: entryExecutable(mode),
      posix_mode: mode,
    };
    entries.push(entry);
    return entry;
  }

  visit(root, '.', rootStat);
  entries.sort((left, right) =>
    Buffer.compare(Buffer.from(left.path, 'utf8'), Buffer.from(right.path, 'utf8')),
  );
  const treeSha256 = computeTreeSha256(entries);
  const snapshot = {
    schema: 'cc-master/trusted-projection/artifact-snapshot/v1alpha1',
    artifact_snapshot_id: '',
    artifact_content_id: computeContentId(entries),
    root_id: normalizedRootId,
    mode_model: 'posix-12bit',
    entries,
    tree_sha256: treeSha256,
  };
  snapshot.artifact_snapshot_id = computeArtifactId('artifact-snapshot', snapshot);
  return snapshot;
}
