import * as fs from 'node:fs';
import * as path from 'node:path';

export type DurableFileSyncDisposition = 'supported' | 'hard-fail' | 'not-attempted';
export type DurableDirectorySyncDisposition =
  | 'supported'
  | 'unsupported'
  | 'hard-fail'
  | 'not-attempted';

export type DurableWriteCheckpoint =
  | 'temp-opened'
  | 'data-written'
  | 'file-synced'
  | 'renamed'
  | 'directory-synced';

export type DurableWriteStage =
  | 'temp-directory'
  | 'temp-open'
  | 'temp-permissions'
  | 'write'
  | 'file-sync'
  | 'file-close'
  | 'rename'
  | 'directory-open'
  | 'directory-sync'
  | 'directory-close';

export interface DurableWriteOutcome {
  path: string;
  committed: boolean;
  file_sync: DurableFileSyncDisposition;
  directory_sync: DurableDirectorySyncDisposition;
}

export interface DurableWriteFilesystem {
  mkdtempSync(prefix: string): string;
  chmodSync(filePath: string, mode: number): void;
  openSync(filePath: string, flags: string, mode?: number): number;
  fchmodSync(fd: number, mode: number): void;
  writeFileSync(fd: number, data: string): void;
  fsyncSync(fd: number): void;
  closeSync(fd: number): void;
  renameSync(from: string, to: string): void;
  unlinkSync(filePath: string): void;
  rmdirSync(filePath: string): void;
}

export interface DurableWriteOptions {
  filesystem?: DurableWriteFilesystem;
  fault?: (point: DurableWriteCheckpoint) => void;
}

const DIRECTORY_SYNC_UNSUPPORTED = new Set(['EINVAL', 'ENOTSUP']);

const NODE_FILESYSTEM: DurableWriteFilesystem = {
  mkdtempSync: (prefix) => fs.mkdtempSync(prefix),
  chmodSync: (filePath, mode) => fs.chmodSync(filePath, mode),
  openSync: (filePath, flags, mode) => fs.openSync(filePath, flags, mode),
  fchmodSync: (fd, mode) => fs.fchmodSync(fd, mode),
  writeFileSync: (fd, data) => fs.writeFileSync(fd, data, 'utf8'),
  fsyncSync: (fd) => fs.fsyncSync(fd),
  closeSync: (fd) => fs.closeSync(fd),
  renameSync: (from, to) => fs.renameSync(from, to),
  unlinkSync: (filePath) => fs.unlinkSync(filePath),
  rmdirSync: (filePath) => fs.rmdirSync(filePath),
};

function errnoCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export function directorySyncUnsupported(error: unknown): boolean {
  const code = errnoCode(error);
  return code !== undefined && DIRECTORY_SYNC_UNSUPPORTED.has(code);
}

export class DurableWriteError extends Error {
  readonly code: string | undefined;
  readonly stage: DurableWriteStage;
  readonly outcome: DurableWriteOutcome;

  constructor(
    pathName: string,
    stage: DurableWriteStage,
    outcome: DurableWriteOutcome,
    cause: unknown,
  ) {
    const code = errnoCode(cause);
    super(`durable write failed at ${stage}${code ? ` (${code})` : ''}: ${pathName}`, { cause });
    this.name = 'DurableWriteError';
    this.code = code;
    this.stage = stage;
    this.outcome = { ...outcome };
  }
}

function hardFailureOutcome(
  current: DurableWriteOutcome,
  stage: DurableWriteStage,
): DurableWriteOutcome {
  const next = { ...current };
  if (stage === 'file-sync') next.file_sync = 'hard-fail';
  if (stage === 'directory-open' || stage === 'directory-sync' || stage === 'directory-close') {
    next.directory_sync = 'hard-fail';
  }
  return next;
}

/**
 * Publish one owner-only file with a POSIX crash-consistency protocol.
 *
 * The final pathname is the sole authority. A crash may leave a target-adjacent 0700 temp
 * directory containing a 0600 file, but readers never consult it. File fsync is mandatory;
 * only EINVAL/ENOTSUP from directory fsync is an observable soft-unsupported result. Every
 * other permission/I/O failure is surfaced as DurableWriteError, including failures after rename.
 */
export function durableWriteFileSync(
  filePath: string,
  data: string,
  options: DurableWriteOptions = {},
): DurableWriteOutcome {
  const filesystem = options.filesystem || NODE_FILESYSTEM;
  const parent = path.dirname(filePath);
  const prefix = path.join(parent, `.${path.basename(filePath)}.ccm-tmp-`);
  let stage: DurableWriteStage = 'temp-directory';
  let tempDir = '';
  let tempFile = '';
  let fileFd: number | null = null;
  let directoryFd: number | null = null;
  let outcome: DurableWriteOutcome = {
    path: filePath,
    committed: false,
    file_sync: 'not-attempted',
    directory_sync: 'not-attempted',
  };

  try {
    tempDir = filesystem.mkdtempSync(prefix);
    filesystem.chmodSync(tempDir, 0o700);
    tempFile = path.join(tempDir, 'publish.tmp');

    stage = 'temp-open';
    fileFd = filesystem.openSync(tempFile, 'wx', 0o600);
    stage = 'temp-permissions';
    filesystem.fchmodSync(fileFd, 0o600);
    options.fault?.('temp-opened');

    stage = 'write';
    filesystem.writeFileSync(fileFd, data);
    options.fault?.('data-written');

    stage = 'file-sync';
    filesystem.fsyncSync(fileFd);
    outcome = { ...outcome, file_sync: 'supported' };
    options.fault?.('file-synced');

    stage = 'file-close';
    filesystem.closeSync(fileFd);
    fileFd = null;

    stage = 'rename';
    filesystem.renameSync(tempFile, filePath);
    tempFile = '';
    outcome = { ...outcome, committed: true };
    options.fault?.('renamed');

    stage = 'directory-open';
    directoryFd = filesystem.openSync(parent, 'r');
    let directorySyncError: unknown = null;
    stage = 'directory-sync';
    try {
      filesystem.fsyncSync(directoryFd);
    } catch (error) {
      directorySyncError = error;
    }

    stage = 'directory-close';
    filesystem.closeSync(directoryFd);
    directoryFd = null;

    if (directorySyncError) {
      if (!directorySyncUnsupported(directorySyncError)) {
        stage = 'directory-sync';
        throw directorySyncError;
      }
      outcome = { ...outcome, directory_sync: 'unsupported' };
    } else {
      outcome = { ...outcome, directory_sync: 'supported' };
    }
    options.fault?.('directory-synced');
    return outcome;
  } catch (error) {
    if (fileFd !== null) {
      try {
        filesystem.closeSync(fileFd);
      } catch {
        // Preserve the load-bearing failure. The non-authoritative residue remains recoverable.
      }
      fileFd = null;
    }
    if (directoryFd !== null) {
      try {
        filesystem.closeSync(directoryFd);
      } catch {
        // Preserve the load-bearing failure.
      }
      directoryFd = null;
    }
    outcome = hardFailureOutcome(outcome, stage);
    throw new DurableWriteError(filePath, stage, outcome, error);
  } finally {
    if (tempFile) {
      try {
        filesystem.unlinkSync(tempFile);
      } catch {
        // A residue is never authority; a later recovery pass may remove it.
      }
    }
    if (tempDir) {
      try {
        filesystem.rmdirSync(tempDir);
      } catch {
        // A residue is never authority; do not mask the publish result.
      }
    }
  }
}
