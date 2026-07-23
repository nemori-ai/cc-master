/**
 * Atomic whole-host publish for plugin/dist/<host>.
 *
 * Commit boundary = successful rename(staging → live).
 * After that point, backup cleanup failure must NOT present the new tree as a
 * failed publish: warn + success while retaining a recoverable backup.
 *
 * Staging / backup are siblings under plugin/dist:
 *   <host>.write-<stamp>  /  <host>.bak-<stamp>
 *
 * Injectable `fs` / `warn` keep failure modes unit-testable.
 * Backup lifecycle belongs solely to this publisher — outer orchestration must
 * never delete unknown/collision backups.
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

function assertSafeHostId(host) {
  const value = String(host ?? '');
  if (
    !value ||
    value === '.' ||
    value === '..' ||
    value.includes('\0') ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('..')
  ) {
    throw new Error(`invalid host id for publish: ${JSON.stringify(host)}`);
  }
  return value;
}

/**
 * Publish a fully prepared whole-host staging tree onto live via backup+rename.
 *
 * @returns {{ ok: true, committed: true, backupRetained: boolean, backupAbsolute?: string }}
 */
function publishHostTree({
  distParentAbsolute,
  liveAbsolute,
  stagingAbsolute,
  host: hostInput,
  stamp,
  fs: fsApi = fs,
  warn = console.warn,
}) {
  if (!stamp || /[\\/]/.test(String(stamp))) {
    throw new Error(`invalid host publish stamp: ${JSON.stringify(stamp)}`);
  }
  const host = assertSafeHostId(hostInput);
  const distParent = path.resolve(distParentAbsolute);
  const live = path.resolve(liveAbsolute);
  const staging = path.resolve(stagingAbsolute);
  const backup = path.join(distParent, `${host}.bak-${stamp}`);

  if (!isInsideRoot(live, distParent) || path.basename(live) !== host) {
    throw new Error(`live host path must be <distParent>/${host}: ${live}`);
  }
  if (
    !isInsideRoot(staging, distParent) ||
    path.basename(staging) !== `${host}.write-${stamp}`
  ) {
    throw new Error(
      `staging must be <distParent>/${host}.write-${stamp}: ${staging}`,
    );
  }
  if (!isInsideRoot(backup, distParent)) {
    throw new Error(`backup escapes dist parent: ${backup}`);
  }

  const stagingStat = lstatOrNull(fsApi, staging);
  if (!stagingStat || stagingStat.isSymbolicLink() || !stagingStat.isDirectory()) {
    throw new Error(`host staging must be a real directory: ${staging}`);
  }

  const liveStat = lstatOrNull(fsApi, live);
  if (liveStat) {
    if (liveStat.isSymbolicLink() || !liveStat.isDirectory()) {
      throw new Error(
        `refusing live host that is not a real directory (symlink/non-dir never unlinked): ${live}`,
      );
    }
  }

  // Pre-claim backup name before any rename (collision = pre-commit abort).
  if (lstatOrNull(fsApi, backup)) {
    throw new Error(`host backup name collision (pre-claim failed): ${backup}`);
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
      rmNoFollow(fsApi, backup, distParent);
      return { ok: true, committed: true, backupRetained: false };
    } catch (cleanupError) {
      const message =
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      warn(
        `host backup cleanup failed after commit; retaining recoverable backup at ${backup}: ${message}`,
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

module.exports = { publishHostTree, assertSafeHostId };
