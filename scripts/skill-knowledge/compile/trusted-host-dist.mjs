/**
 * Single owner for compile host-dist trust resolution.
 *
 * Used at runCompile entry (before any candidate read/overlay) and re-asserted
 * by emit write/diff. Keep this module free of emit/compile imports to avoid cycles.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PRODUCT_HOSTS } from './paths.mjs';

const KNOWN_HOSTS = new Set(PRODUCT_HOSTS);

export function isInsideRoot(candidate, root) {
  const candidateResolved = path.resolve(candidate);
  const rootResolved = path.resolve(root);
  return (
    candidateResolved === rootResolved ||
    candidateResolved.startsWith(`${rootResolved}${path.sep}`)
  );
}

export function tryRealpath(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

export function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

/**
 * Validate host id against the frozen C9 set. Rejects traversal / dot / dotdot.
 * Never treats the host string as a filesystem path segment beyond a single name.
 */
export function assertSafeCompileHostId(host) {
  const value = String(host ?? '');
  if (
    value.length === 0 ||
    value === '.' ||
    value === '..' ||
    value.includes('\0') ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('..')
  ) {
    throw new Error(`SKG-COMPILE-HOST-TRAVERSAL: refusing host id ${JSON.stringify(host)}`);
  }
  if (!KNOWN_HOSTS.has(value)) {
    throw new Error(`SKG-COMPILE-HOST-UNKNOWN: host is outside the frozen C9 set: ${value}`);
  }
  return value;
}

/**
 * Resolve plugin/dist/<host> under repoRoot with repo realpath as the sole trust root.
 *
 * Check order (fail closed on first violation):
 *   1. repoRoot realpath (trust root)
 *   2. lstat plugin
 *   3. lstat plugin/dist
 *   4. lstat plugin/dist/<known-host>
 *   5. hostDist realpath must stay inside repo realpath
 *
 * Never uses hostDist realpath itself as the containment SSOT.
 */
export function resolveTrustedHostDist(repoRoot, host) {
  const safeHost = assertSafeCompileHostId(host);
  const repoAbsolute = path.resolve(repoRoot);
  const repoReal = tryRealpath(repoAbsolute);
  if (!repoReal) {
    throw new Error(`SKG-COMPILE-REPO-REALPATH: cannot realpath repo root ${repoAbsolute}`);
  }

  const segments = ['plugin', 'dist', safeHost];
  let cursor = repoAbsolute;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    const stat = lstatOrNull(cursor);
    if (!stat) {
      throw new Error(`SKG-COMPILE-ANCESTOR-MISSING: ${cursor}`);
    }
    if (stat.isSymbolicLink()) {
      throw new Error(
        `SKG-COMPILE-ANCESTOR-SYMLINK: refusing to traverse symlink ancestor ${cursor}`,
      );
    }
    if (!stat.isDirectory()) {
      throw new Error(`SKG-COMPILE-ANCESTOR-NOT-DIR: ${cursor}`);
    }
  }

  const hostDistReal = tryRealpath(cursor);
  if (!hostDistReal) {
    throw new Error(`SKG-COMPILE-HOST-DIST-REALPATH: ${cursor}`);
  }
  if (!isInsideRoot(hostDistReal, repoReal)) {
    throw new Error(
      `SKG-COMPILE-HOST-DIST-OUTSIDE-REPO: host dist realpath ${hostDistReal} escapes repo ${repoReal}`,
    );
  }

  return {
    host: safeHost,
    repoAbsolute,
    repoReal,
    hostDistAbsolute: cursor,
    hostDistReal,
  };
}

/**
 * Resolve a controlled candidate host root (whole-host staging) for compile writes/reads.
 *
 * Candidate must be a real directory at plugin/dist/<host>.write-<stamp> under repo:
 *   1. lexical dirname(candidate) === lexical plugin/dist (direct sibling only)
 *   2. locate chain plugin/dist → candidate: per-segment lstat; refuse intermediate
 *      symlink / missing / non-dir / multi-segment namespace-like bypass
 *   3. candidate itself is a real directory (not a symlink)
 *   4. dirname(realpath(candidate)) === realpath(plugin/dist)
 *
 * Public CLI never uses this; sync orchestration passes it so compile targets
 * staging before live publish.
 *
 * This is the sole validator owner — call at runCompile entry before any candidate
 * path concat / exists / lstat / read / loader / overlay / verifier; emit may only
 * re-assert via this same helper.
 */
export function resolveTrustedCandidateHostDist(repoRoot, host, candidateHostAbsolute) {
  const safeHost = assertSafeCompileHostId(host);
  const repoAbsolute = path.resolve(repoRoot);
  const repoReal = tryRealpath(repoAbsolute);
  if (!repoReal) {
    throw new Error(`SKG-COMPILE-REPO-REALPATH: cannot realpath repo root ${repoAbsolute}`);
  }

  // Validate repo → plugin → dist (no host live yet — candidate is sibling).
  let cursor = repoAbsolute;
  for (const segment of ['plugin', 'dist']) {
    cursor = path.join(cursor, segment);
    const stat = lstatOrNull(cursor);
    if (!stat) {
      throw new Error(`SKG-COMPILE-ANCESTOR-MISSING: ${cursor}`);
    }
    if (stat.isSymbolicLink()) {
      throw new Error(
        `SKG-COMPILE-ANCESTOR-SYMLINK: refusing to traverse symlink ancestor ${cursor}`,
      );
    }
    if (!stat.isDirectory()) {
      throw new Error(`SKG-COMPILE-ANCESTOR-NOT-DIR: ${cursor}`);
    }
  }
  const distAbsolute = cursor;
  const distReal = tryRealpath(distAbsolute);
  if (!distReal || !isInsideRoot(distReal, repoReal)) {
    throw new Error(`SKG-COMPILE-DIST-OUTSIDE-REPO: ${distAbsolute}`);
  }

  const candidate = path.resolve(candidateHostAbsolute);
  // Direct sibling only: lexical parent must be exactly plugin/dist (not nested).
  if (path.dirname(candidate) !== distAbsolute) {
    throw new Error(
      `SKG-COMPILE-CANDIDATE-ESCAPE: candidate ${candidate} escapes plugin/dist`,
    );
  }
  const base = path.basename(candidate);
  if (
    !base.startsWith(`${safeHost}.write-`) ||
    base.includes('/') ||
    base.includes('\\') ||
    base === '.' ||
    base === '..'
  ) {
    throw new Error(
      `SKG-COMPILE-CANDIDATE-NAMESPACE: candidate must be ${safeHost}.write-*: ${candidate}`,
    );
  }

  // Locate chain from plugin/dist → candidate: exactly one segment, lstat each hop.
  const relative = path.relative(distAbsolute, candidate);
  const segments = relative.split(path.sep).filter(Boolean);
  if (
    segments.length !== 1 ||
    segments[0] !== base ||
    relative.startsWith(`..${path.sep}`) ||
    relative === '..' ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `SKG-COMPILE-CANDIDATE-ESCAPE: candidate ${candidate} escapes plugin/dist`,
    );
  }
  let locateCursor = distAbsolute;
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new Error(
        `SKG-COMPILE-CANDIDATE-ESCAPE: candidate ${candidate} escapes plugin/dist`,
      );
    }
    locateCursor = path.join(locateCursor, segment);
    const hopStat = lstatOrNull(locateCursor);
    if (!hopStat) {
      throw new Error(`SKG-COMPILE-ANCESTOR-MISSING: ${locateCursor}`);
    }
    if (hopStat.isSymbolicLink()) {
      throw new Error(
        `SKG-COMPILE-ANCESTOR-SYMLINK: refusing to traverse symlink ancestor ${locateCursor}`,
      );
    }
    if (!hopStat.isDirectory()) {
      throw new Error(`SKG-COMPILE-ANCESTOR-NOT-DIR: ${locateCursor}`);
    }
  }

  const candidateStat = lstatOrNull(candidate);
  if (!candidateStat || candidateStat.isSymbolicLink() || !candidateStat.isDirectory()) {
    throw new Error(
      `SKG-COMPILE-CANDIDATE-INVALID: candidate must be a real directory: ${candidate}`,
    );
  }
  const candidateReal = tryRealpath(candidate);
  if (!candidateReal || !isInsideRoot(candidateReal, repoReal)) {
    throw new Error(
      `SKG-COMPILE-CANDIDATE-OUTSIDE-REPO: ${candidate} realpath escapes repo`,
    );
  }
  // Realpath parent of candidate must be exactly dist realpath (no alias/cross-surface).
  if (path.dirname(candidateReal) !== distReal) {
    throw new Error(
      `SKG-COMPILE-CANDIDATE-ESCAPE: candidate ${candidate} escapes plugin/dist`,
    );
  }

  return {
    host: safeHost,
    repoAbsolute,
    repoReal,
    hostDistAbsolute: candidate,
    hostDistReal: candidateReal,
    candidate: true,
  };
}
