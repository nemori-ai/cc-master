/**
 * Atomic whole-directory publish for plugin/dist/<host>/skills.
 *
 * Commit boundary = successful rename(staging → live).
 * After that point, backup cleanup failure must NOT present the new tree as a
 * failed publish: warn + success while retaining a recoverable backup.
 *
 * Injectable `fs` / `warn` keep failure modes unit-testable without permission tricks.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function lstatOrNull(fsApi, target) {
  try {
    return fsApi.lstatSync(target);
  } catch {
    return null;
  }
}

function isInsideRoot(candidate, root) {
  const candidateResolved = path.resolve(candidate);
  const rootResolved = path.resolve(root);
  return (
    candidateResolved === rootResolved ||
    candidateResolved.startsWith(`${rootResolved}${path.sep}`)
  );
}

function rmNoFollow(fsApi, targetAbsolute, containmentRoot) {
  const absolute = path.resolve(targetAbsolute);
  const root = path.resolve(containmentRoot);
  if (!isInsideRoot(absolute, root)) {
    throw new Error(`refusing to remove ${absolute} outside ${root}`);
  }
  const stat = lstatOrNull(fsApi, absolute);
  if (!stat) return;
  if (stat.isSymbolicLink() || stat.isFile()) {
    fsApi.unlinkSync(absolute);
    return;
  }
  if (!stat.isDirectory()) {
    fsApi.unlinkSync(absolute);
    return;
  }
  for (const name of fsApi.readdirSync(absolute)) {
    rmNoFollow(fsApi, path.join(absolute, name), root);
  }
  fsApi.rmdirSync(absolute);
}

/**
 * Publish a fully prepared skills staging tree onto live via backup+rename.
 *
 * @returns {{ ok: true, committed: true, backupRetained: boolean, backupAbsolute?: string }}
 */
function publishSkillsTree({
  hostDistAbsolute,
  liveAbsolute,
  stagingAbsolute,
  stamp,
  fs: fsApi = fs,
  warn = console.warn,
}) {
  if (!stamp || /[\\/]/.test(String(stamp))) {
    throw new Error(`invalid skills publish stamp: ${JSON.stringify(stamp)}`);
  }
  const hostDist = path.resolve(hostDistAbsolute);
  const live = path.resolve(liveAbsolute);
  const staging = path.resolve(stagingAbsolute);
  const backup = path.join(hostDist, `skills.bak-${stamp}`);

  if (!isInsideRoot(live, hostDist) || path.basename(live) !== 'skills') {
    throw new Error(`live skills path must be <hostDist>/skills: ${live}`);
  }
  if (!isInsideRoot(staging, hostDist) || !path.basename(staging).startsWith('skills.write-')) {
    throw new Error(`staging must be <hostDist>/skills.write-*: ${staging}`);
  }
  if (!isInsideRoot(backup, hostDist)) {
    throw new Error(`backup escapes host dist: ${backup}`);
  }

  const stagingStat = lstatOrNull(fsApi, staging);
  if (!stagingStat || stagingStat.isSymbolicLink() || !stagingStat.isDirectory()) {
    throw new Error(`skills staging must be a real directory: ${staging}`);
  }

  const liveStat = lstatOrNull(fsApi, live);
  if (liveStat) {
    if (liveStat.isSymbolicLink() || !liveStat.isDirectory()) {
      throw new Error(
        `refusing live skills that is not a real directory (symlink/non-dir never unlinked): ${live}`,
      );
    }
  }

  // Pre-claim backup name before any rename (collision = pre-commit abort).
  if (lstatOrNull(fsApi, backup)) {
    throw new Error(`skills backup name collision (pre-claim failed): ${backup}`);
  }

  const stagingFd = fsApi.openSync(staging, 'r');
  try {
    fsApi.fsyncSync(stagingFd);
  } finally {
    fsApi.closeSync(stagingFd);
  }

  let committed = false;
  try {
    if (liveStat) {
      fsApi.renameSync(live, backup);
    }
    fsApi.renameSync(staging, live);
    committed = true;
  } catch (error) {
    // Pre-commit or mid-swap failure: restore old live when possible.
    if (!lstatOrNull(fsApi, live) && lstatOrNull(fsApi, backup)) {
      try {
        fsApi.renameSync(backup, live);
      } catch {
        // leave backup for operator recovery
      }
    }
    throw error;
  }

  // COMMIT BOUNDARY: staging→live succeeded. Cleanup failure must not undo success.
  if (lstatOrNull(fsApi, backup)) {
    try {
      rmNoFollow(fsApi, backup, hostDist);
      return { ok: true, committed: true, backupRetained: false };
    } catch (cleanupError) {
      const message =
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      warn(
        `skills backup cleanup failed after commit; retaining recoverable backup at ${backup}: ${message}`,
      );
      return {
        ok: true,
        committed: true,
        backupRetained: true,
        backupAbsolute: backup,
      };
    }
  }

  return { ok: true, committed, backupRetained: false };
}

module.exports = { publishSkillsTree };
