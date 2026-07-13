// Filesystem fact resolver for the managed-attempt write-set compiler.
//
// This is a standalone preflight. It does not read credentials, contact providers, mutate accounts,
// or launch a worker. The production dispatcher must eventually supply a trusted lease and consume
// the resulting plan immediately before spawn.

import {
  closeSync,
  constants,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  ATTEMPT_WRITE_SET_REQUEST,
  type DeclaredArtifactRoot,
  type GitLayoutFacts,
  type ManagedWriteProfileId,
  type PathResolution,
  prepareAttemptWriteSetProbe,
  type WorktreeWriteLease,
  type WritabilityFact,
  type WriteSetRequest,
} from '@ccm/engine';

let probeSequence = 0;

function unknownLayout(resolution: PathResolution): GitLayoutFacts {
  return { kind: 'unknown', resolution };
}

function safeRealDirectory(candidate: string): { resolution: PathResolution; path?: string } {
  const lexical = resolve(candidate);
  try {
    const stat = lstatSync(lexical);
    if (stat.isSymbolicLink()) return { resolution: 'symlink' };
    if (!stat.isDirectory()) return { resolution: 'not-a-worktree' };
    const real = realpathSync(lexical);
    if (real !== lexical) return { resolution: 'escape' };
    return { resolution: 'resolved', path: real };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { resolution: code === 'ENOENT' ? 'missing' : 'escape' };
  }
}

function safeRealFile(candidate: string): { resolution: PathResolution; path?: string } {
  const lexical = resolve(candidate);
  try {
    const stat = lstatSync(lexical);
    if (stat.isSymbolicLink()) return { resolution: 'symlink' };
    if (!stat.isFile()) return { resolution: 'not-a-worktree' };
    const real = realpathSync(lexical);
    if (real !== lexical) return { resolution: 'escape' };
    return { resolution: 'resolved', path: real };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { resolution: code === 'ENOENT' ? 'missing' : 'escape' };
  }
}

function onePathLine(file: string): string | null {
  try {
    const text = readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop();
    if (lines.length !== 1 || !lines[0]?.trim()) return null;
    return lines[0].trim();
  } catch {
    return null;
  }
}

function isDirectChild(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return (
    rel !== '' &&
    !rel.startsWith('..') &&
    !isAbsolute(rel) &&
    !rel.includes('/') &&
    !rel.includes('\\')
  );
}

function commonMarkersResolved(commonDir: string): boolean {
  return (
    safeRealFile(join(commonDir, 'HEAD')).resolution === 'resolved' &&
    safeRealDirectory(join(commonDir, 'objects')).resolution === 'resolved' &&
    safeRealDirectory(join(commonDir, 'refs')).resolution === 'resolved' &&
    safeRealDirectory(join(commonDir, 'logs')).resolution === 'resolved'
  );
}

export function resolveWorktreeGitLayout(worktreeRoot: string): GitLayoutFacts {
  if (!isAbsolute(worktreeRoot)) return unknownLayout('escape');
  const worktree = safeRealDirectory(worktreeRoot);
  if (worktree.resolution !== 'resolved' || !worktree.path)
    return unknownLayout(worktree.resolution);
  const dotGit = join(worktree.path, '.git');
  let dotStat: ReturnType<typeof lstatSync>;
  try {
    dotStat = lstatSync(dotGit);
  } catch (error) {
    return unknownLayout((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'escape');
  }
  if (dotStat.isSymbolicLink()) return unknownLayout('symlink');

  if (dotStat.isDirectory()) {
    const common = safeRealDirectory(dotGit);
    if (common.resolution !== 'resolved' || !common.path) return unknownLayout(common.resolution);
    if (!commonMarkersResolved(common.path)) return unknownLayout('not-a-worktree');
    return {
      kind: 'main-worktree',
      resolution: 'resolved',
      dot_git_file: dotGit,
      git_dir: common.path,
      common_dir: common.path,
      objects_dir: join(common.path, 'objects'),
      refs_dir: join(common.path, 'refs'),
      logs_dir: join(common.path, 'logs'),
    };
  }
  if (!dotStat.isFile()) return unknownLayout('not-a-worktree');
  const dotFile = safeRealFile(dotGit);
  if (dotFile.resolution !== 'resolved' || !dotFile.path) return unknownLayout(dotFile.resolution);
  const gitfileLine = onePathLine(dotFile.path);
  const match = /^gitdir:\s+(.+)$/.exec(gitfileLine ?? '');
  if (!match?.[1]) return unknownLayout('not-a-worktree');

  const gitDirLexical = resolve(worktree.path, match[1]);
  const gitDir = safeRealDirectory(gitDirLexical);
  if (gitDir.resolution !== 'resolved' || !gitDir.path) return unknownLayout(gitDir.resolution);
  if (
    safeRealFile(join(gitDir.path, 'HEAD')).resolution !== 'resolved' ||
    safeRealFile(join(gitDir.path, 'commondir')).resolution !== 'resolved' ||
    safeRealFile(join(gitDir.path, 'gitdir')).resolution !== 'resolved'
  ) {
    return unknownLayout('not-a-worktree');
  }

  const commonLine = onePathLine(join(gitDir.path, 'commondir'));
  if (!commonLine) return unknownLayout('not-a-worktree');
  const common = safeRealDirectory(resolve(gitDir.path, commonLine));
  if (common.resolution !== 'resolved' || !common.path) return unknownLayout(common.resolution);
  if (!isDirectChild(join(common.path, 'worktrees'), gitDir.path)) return unknownLayout('escape');
  if (!commonMarkersResolved(common.path)) return unknownLayout('not-a-worktree');

  const backlinkLine = onePathLine(join(gitDir.path, 'gitdir'));
  if (!backlinkLine || resolve(gitDir.path, backlinkLine) !== dotGit)
    return unknownLayout('escape');

  return {
    kind: 'linked-worktree',
    resolution: 'resolved',
    dot_git_file: dotGit,
    git_dir: gitDir.path,
    common_dir: common.path,
    objects_dir: join(common.path, 'objects'),
    refs_dir: join(common.path, 'refs'),
    logs_dir: join(common.path, 'logs'),
  };
}

function resolveArtifactRoot(
  candidate: string,
  mode: DeclaredArtifactRoot['mode'],
): DeclaredArtifactRoot {
  if (!isAbsolute(candidate)) {
    return {
      path: resolve(candidate),
      mode,
      purpose: mode === 'read-write' ? 'worker-report' : 'worker-input',
      resolution: 'escape',
    };
  }
  const result = safeRealDirectory(candidate);
  return {
    path: resolve(candidate),
    mode,
    purpose: mode === 'read-write' ? 'worker-report' : 'worker-input',
    resolution:
      result.resolution === 'not-a-worktree'
        ? 'missing'
        : (result.resolution as DeclaredArtifactRoot['resolution']),
  };
}

export interface WriteProbeOperations {
  open: (candidate: string, flags: number, mode: number) => number;
  close: (fd: number) => void;
  unlink: (candidate: string) => void;
}

const DEFAULT_WRITE_PROBE_OPERATIONS: WriteProbeOperations = {
  open: openSync,
  close: closeSync,
  unlink: unlinkSync,
};

export function defaultProbeWritable(
  directory: string,
  operations: WriteProbeOperations = DEFAULT_WRITE_PROBE_OPERATIONS,
): boolean {
  const candidate = join(directory, `.ccm-write-probe-${process.pid}-${probeSequence++}`);
  let fd: number | null = null;
  let owned = false;
  try {
    fd = operations.open(
      candidate,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    owned = true;
    operations.close(fd);
    fd = null;
    operations.unlink(candidate);
    owned = false;
    return true;
  } catch {
    if (fd !== null) {
      try {
        operations.close(fd);
      } catch {}
    }
    if (owned) {
      try {
        operations.unlink(candidate);
      } catch {}
    }
    return false;
  }
}

function writabilityFacts(
  roots: readonly string[],
  probeWritable: (directory: string) => boolean,
): WritabilityFact[] {
  return [...new Set(roots)].map((root) => ({ path: root, writable: probeWritable(root) }));
}

export interface WriteSetProbeDependencies {
  probeWritable?: (directory: string) => boolean;
}

export function buildWriteSetRequest(
  {
    lease,
    profile,
    artifactRootsRw = [],
    artifactRootsRo = [],
  }: {
    lease: WorktreeWriteLease;
    profile: ManagedWriteProfileId | string;
    artifactRootsRw?: string[];
    artifactRootsRo?: string[];
  },
  dependencies?: WriteSetProbeDependencies,
): WriteSetRequest {
  const gitLayout = resolveWorktreeGitLayout(lease.worktree_root);
  const declaredArtifactRoots = [
    ...artifactRootsRw.map((root) => resolveArtifactRoot(root, 'read-write')),
    ...artifactRootsRo.map((root) => resolveArtifactRoot(root, 'read-only')),
  ];
  const request: WriteSetRequest = {
    schema: ATTEMPT_WRITE_SET_REQUEST,
    profile,
    lease,
    git_layout: gitLayout,
    declared_artifact_roots: declaredArtifactRoots,
    writability: [],
  };
  const preparation = prepareAttemptWriteSetProbe(request);
  if (!preparation.ok) return request;
  const probeWritable = dependencies?.probeWritable ?? defaultProbeWritable;
  return {
    ...request,
    writability: writabilityFacts(preparation.probe_roots, probeWritable),
  };
}
