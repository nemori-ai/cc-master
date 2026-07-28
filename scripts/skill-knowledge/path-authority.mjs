/**
 * Realpath / lstat path authority for change workspaces and candidate runtimes.
 * Refuse any symlink on a locate chain; require real paths strictly inside a
 * real allowed root. Lexical containment alone is not authority.
 *
 * Directory creation is segment-safe: each hop is lstat'd before mkdir; a
 * symlink anywhere on the chain aborts before any write.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

export function isInsideRealRoot(candidateReal, rootReal) {
  const candidate = path.resolve(candidateReal);
  const root = path.resolve(rootReal);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function authorityError(code, message, witness = {}) {
  const error = new Error(message);
  error.code = code;
  error.witness = witness;
  return error;
}

/**
 * Walk every path segment from `rootAbsolute` to `targetAbsolute` with lstat.
 * Refuse missing hops (unless allowMissingLeaf), symlinks, and non-directories
 * for intermediate segments.
 */
export function assertLocateChainNoSymlinks(rootAbsolute, targetAbsolute, {
  allowMissingLeaf = false,
  leafMustBeFile = false,
  leafMustBeDirectory = false,
} = {}) {
  const root = path.resolve(rootAbsolute);
  const target = path.resolve(targetAbsolute);
  const relative = path.relative(root, target);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw authorityError('SKG-PATH-AUTHORITY-ESCAPE', `Path escapes authority root: ${target}`, {
      root,
      target,
    });
  }
  const segments = relative.split(path.sep).filter(Boolean);
  let cursor = root;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === '.' || segment === '..') {
      throw authorityError('SKG-PATH-AUTHORITY-ESCAPE', `Path escapes authority root: ${target}`, {
        root,
        target,
        segment,
      });
    }
    cursor = path.join(cursor, segment);
    const isLeaf = index === segments.length - 1;
    const stat = lstatOrNull(cursor);
    if (!stat) {
      if (isLeaf && allowMissingLeaf) return { absolute: cursor, real: null, missing: true };
      throw authorityError('SKG-PATH-AUTHORITY-MISSING', `Authority path missing: ${cursor}`, {
        root,
        target: cursor,
      });
    }
    if (stat.isSymbolicLink()) {
      throw authorityError(
        'SKG-PATH-AUTHORITY-SYMLINK',
        `Refusing symlink on authority locate chain: ${cursor}`,
        { root, target: cursor },
      );
    }
    if (!isLeaf) {
      if (!stat.isDirectory()) {
        throw authorityError(
          'SKG-PATH-AUTHORITY-NOT-DIR',
          `Authority ancestor must be a real directory: ${cursor}`,
          { root, target: cursor },
        );
      }
      continue;
    }
    if (leafMustBeFile && !stat.isFile()) {
      throw authorityError(
        'SKG-PATH-AUTHORITY-NOT-FILE',
        `Authority leaf must be a real file: ${cursor}`,
        { root, target: cursor },
      );
    }
    if (leafMustBeDirectory && !stat.isDirectory()) {
      throw authorityError(
        'SKG-PATH-AUTHORITY-NOT-DIR',
        `Authority leaf must be a real directory: ${cursor}`,
        { root, target: cursor },
      );
    }
  }
  const real = tryRealpath(cursor);
  if (!real) {
    throw authorityError('SKG-PATH-AUTHORITY-REALPATH', `Cannot realpath authority path: ${cursor}`, {
      root,
      target: cursor,
    });
  }
  const rootReal = tryRealpath(root);
  if (!rootReal || !isInsideRealRoot(real, rootReal)) {
    throw authorityError(
      'SKG-PATH-AUTHORITY-ESCAPE',
      `Real path escapes authority root: ${real}`,
      { root, rootReal, target: cursor, real },
    );
  }
  return { absolute: cursor, real, missing: false };
}

/**
 * Create `targetAbsolute` under `rootAbsolute` one segment at a time.
 * Any existing symlink on the chain refuses before further mkdir/write.
 * Missing intermediate directories are created as real directories (mkdir, not recursive).
 */
export function mkdirTrustedSegmented(rootAbsolute, targetAbsolute, {
  leafMustBeDirectory = true,
} = {}) {
  const root = path.resolve(rootAbsolute);
  const target = path.resolve(targetAbsolute);
  const relative = path.relative(root, target);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw authorityError('SKG-PATH-AUTHORITY-ESCAPE', `Path escapes authority root: ${target}`, {
      root,
      target,
    });
  }
  const rootStat = lstatOrNull(root);
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw authorityError(
      'SKG-PATH-AUTHORITY-NOT-DIR',
      `Authority root must be a real directory: ${root}`,
      { root },
    );
  }
  const segments = relative.split(path.sep).filter(Boolean);
  let cursor = root;
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw authorityError('SKG-PATH-AUTHORITY-ESCAPE', `Path escapes authority root: ${target}`, {
        root,
        target,
        segment,
      });
    }
    cursor = path.join(cursor, segment);
    const stat = lstatOrNull(cursor);
    if (!stat) {
      fs.mkdirSync(cursor);
      const created = lstatOrNull(cursor);
      if (!created || created.isSymbolicLink() || !created.isDirectory()) {
        throw authorityError(
          'SKG-PATH-AUTHORITY-NOT-DIR',
          `Failed to create real directory segment: ${cursor}`,
          { root, target: cursor },
        );
      }
      continue;
    }
    if (stat.isSymbolicLink()) {
      throw authorityError(
        'SKG-PATH-AUTHORITY-SYMLINK',
        `Refusing symlink on authority create chain: ${cursor}`,
        { root, target: cursor },
      );
    }
    if (!stat.isDirectory()) {
      throw authorityError(
        'SKG-PATH-AUTHORITY-NOT-DIR',
        `Authority create ancestor must be a real directory: ${cursor}`,
        { root, target: cursor },
      );
    }
  }
  if (leafMustBeDirectory) {
    return assertLocateChainNoSymlinks(root, target, { leafMustBeDirectory: true });
  }
  return assertLocateChainNoSymlinks(root, target, { allowMissingLeaf: false });
}

export function resolveTrustedRepoRoot(repoRoot) {
  const absolute = path.resolve(repoRoot);
  const stat = lstatOrNull(absolute);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    throw authorityError(
      'SKG-PATH-AUTHORITY-REPO',
      `Repository root must be a real directory without symlink leaf: ${absolute}`,
      { repoRoot: absolute },
    );
  }
  const real = tryRealpath(absolute);
  if (!real) {
    throw authorityError('SKG-PATH-AUTHORITY-REPO', `Cannot realpath repository root: ${absolute}`, {
      repoRoot: absolute,
    });
  }
  return { absolute, real };
}

/**
 * Workspace must live under `<repo>/.skill-knowledge/workspaces/<id>` with no
 * symlink on the locate chain from the repo root.
 */
export function resolveTrustedWorkspace(repoRoot, workspace, workspaceRootRelative) {
  const repo = resolveTrustedRepoRoot(repoRoot);
  const allowedRootAbsolute = path.join(repo.absolute, workspaceRootRelative);
  assertLocateChainNoSymlinks(repo.absolute, allowedRootAbsolute, {
    allowMissingLeaf: false,
    leafMustBeDirectory: true,
  });
  const workspaceAbsolute = path.resolve(workspace);
  assertLocateChainNoSymlinks(repo.absolute, workspaceAbsolute, {
    allowMissingLeaf: false,
    leafMustBeDirectory: true,
  });
  const workspaceReal = tryRealpath(workspaceAbsolute);
  const allowedReal = tryRealpath(allowedRootAbsolute);
  if (!workspaceReal || !allowedReal || !isInsideRealRoot(workspaceReal, allowedReal)) {
    throw authorityError(
      'SKG-PATH-AUTHORITY-WORKSPACE',
      `Workspace realpath must stay under ignored workspace root: ${workspaceAbsolute}`,
      { workspace: workspaceAbsolute, workspaceReal, allowedReal },
    );
  }
  return {
    repo,
    workspaceAbsolute,
    workspaceReal,
    allowedRootAbsolute,
    allowedRootReal: allowedReal,
  };
}

/**
 * Ensure `.skill-knowledge/workspaces` exists as a real in-repo directory tree.
 * Refuses if any segment on the chain is a symlink — never mkdir through a link
 * that would create directories outside the repository.
 */
export function ensureTrustedWorkspacesRoot(repoRoot, workspaceRootRelative) {
  const repo = resolveTrustedRepoRoot(repoRoot);
  const target = path.join(repo.absolute, workspaceRootRelative);
  return mkdirTrustedSegmented(repo.absolute, target, { leafMustBeDirectory: true });
}

export function resolveTrustedCandidateDir(workspaceAuthority) {
  const candidateAbsolute = path.join(workspaceAuthority.workspaceAbsolute, 'candidate');
  assertLocateChainNoSymlinks(workspaceAuthority.workspaceAbsolute, candidateAbsolute, {
    allowMissingLeaf: false,
    leafMustBeDirectory: true,
  });
  return {
    absolute: candidateAbsolute,
    real: tryRealpath(candidateAbsolute),
  };
}

export function resolveTrustedScopeFile(repoAuthority, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) {
    throw authorityError('SKG-PATH-AUTHORITY-SCOPE', 'Scope path must be repository-relative', {
      path: relativePath ?? null,
    });
  }
  const absolute = path.resolve(repoAuthority.absolute, relativePath);
  assertLocateChainNoSymlinks(repoAuthority.absolute, absolute, {
    allowMissingLeaf: false,
    leafMustBeFile: true,
  });
  return { absolute, relative: relativePath.split(path.sep).join('/'), real: tryRealpath(absolute) };
}

const OWNERSHIP_MARKER = '.skg-runtime-ownership';

function ownershipMarkerPath(runtimeAbsolute) {
  return path.join(runtimeAbsolute, OWNERSHIP_MARKER);
}

/**
 * Prepare a runtime-candidate directory.
 *
 * Pre-existing runtime roots are refused unless they carry an unforgeable
 * ownership marker issued by this process for the same workspace+nonce.
 * Unknown content is never deleted.
 */
export function prepareTrustedRuntimeRoot(
  workspaceAuthority,
  runtimeDirName = 'runtime-candidate',
  { ownershipToken = null } = {},
) {
  const runtimeAbsolute = path.join(workspaceAuthority.workspaceAbsolute, runtimeDirName);
  const existing = lstatOrNull(runtimeAbsolute);
  if (existing) {
    if (existing.isSymbolicLink()) {
      throw authorityError(
        'SKG-PATH-AUTHORITY-SYMLINK',
        `Refusing to materialize through symlink runtime root: ${runtimeAbsolute}`,
        { runtime: runtimeAbsolute },
      );
    }
    if (!existing.isDirectory()) {
      throw authorityError(
        'SKG-PATH-AUTHORITY-NOT-DIR',
        `Runtime root exists and is not a directory: ${runtimeAbsolute}`,
        { runtime: runtimeAbsolute },
      );
    }
    const existingReal = tryRealpath(runtimeAbsolute);
    if (!existingReal || !isInsideRealRoot(existingReal, workspaceAuthority.workspaceReal)) {
      throw authorityError(
        'SKG-PATH-AUTHORITY-ESCAPE',
        `Existing runtime root escapes workspace: ${runtimeAbsolute}`,
        { runtime: runtimeAbsolute, existingReal },
      );
    }
    const markerPath = ownershipMarkerPath(runtimeAbsolute);
    const markerStat = lstatOrNull(markerPath);
    if (
      !ownershipToken ||
      !markerStat ||
      markerStat.isSymbolicLink() ||
      !markerStat.isFile()
    ) {
      throw authorityError(
        'SKG-PATH-AUTHORITY-RUNTIME-EXISTS',
        `Refusing to reuse pre-existing runtime root without matching ownership marker: ${runtimeAbsolute}`,
        { runtime: runtimeAbsolute },
      );
    }
    const marker = fs.readFileSync(markerPath, 'utf8').trim();
    if (marker !== ownershipToken) {
      throw authorityError(
        'SKG-PATH-AUTHORITY-RUNTIME-EXISTS',
        `Refusing to reuse runtime root with foreign ownership marker: ${runtimeAbsolute}`,
        { runtime: runtimeAbsolute },
      );
    }
    // Owned by this session: remove only after marker match, then recreate.
    fs.rmSync(runtimeAbsolute, { recursive: true, force: false });
  }

  mkdirTrustedSegmented(workspaceAuthority.workspaceAbsolute, runtimeAbsolute, {
    leafMustBeDirectory: true,
  });
  const token =
    ownershipToken ||
    `skg-runtime:${process.pid}:${Date.now().toString(16)}:${crypto.randomBytes(16).toString('hex')}`;
  fs.writeFileSync(ownershipMarkerPath(runtimeAbsolute), `${token}\n`, { flag: 'wx' });
  const created = assertLocateChainNoSymlinks(workspaceAuthority.workspaceAbsolute, runtimeAbsolute, {
    leafMustBeDirectory: true,
  });
  return {
    absolute: created.absolute,
    real: created.real,
    createdByCaller: true,
    ownershipToken: token,
  };
}

/**
 * Re-authenticate a path immediately before open/rename publication.
 * Returns fresh absolute+real authority or throws.
 */
export function assertPublicationAuthority({
  repoRoot,
  workspace,
  workspaceRootRelative,
  candidateRelativePaths = [],
  acceptedTargets = [],
  ledgerTarget = null,
  requireRecoveryAbsent = false,
}) {
  const workspaceAuthority = resolveTrustedWorkspace(repoRoot, workspace, workspaceRootRelative);
  const candidate = resolveTrustedCandidateDir(workspaceAuthority);
  const scope = [];
  for (const relative of candidateRelativePaths) {
    scope.push(
      resolveTrustedScopeFile(
        { absolute: workspaceAuthority.workspaceAbsolute, real: workspaceAuthority.workspaceReal },
        path.join('candidate', relative),
      ),
    );
  }
  const accepted = [];
  for (const relative of acceptedTargets) {
    accepted.push(resolveTrustedScopeFile(workspaceAuthority.repo, relative));
  }
  if (requireRecoveryAbsent) {
    const recoveryAbsolute = path.join(workspaceAuthority.workspaceAbsolute, 'recovery');
    const recoveryStat = lstatOrNull(recoveryAbsolute);
    if (recoveryStat) {
      throw authorityError(
        'SKG-PATH-AUTHORITY-RECOVERY-EXISTS',
        `Refusing publication while workspace/recovery already exists: ${recoveryAbsolute}`,
        { recovery: recoveryAbsolute },
      );
    }
  }
  let ledger = null;
  if (ledgerTarget) {
    const absolute = path.resolve(repoRoot, ledgerTarget);
    // Ledger may be missing before first publish; require ancestors real and leaf either
    // missing or a real file inside repo. The ledger parent directory (changes/) may also
    // be missing on the first publish — require its parent (knowledge/) instead.
    const parent = path.dirname(absolute);
    const parentStat = lstatOrNull(parent);
    if (!parentStat) {
      const grandparent = path.dirname(parent);
      assertLocateChainNoSymlinks(workspaceAuthority.repo.absolute, grandparent, {
        leafMustBeDirectory: true,
      });
      ledger = { absolute, real: null, missing: true, parentMissing: true };
    } else {
      assertLocateChainNoSymlinks(workspaceAuthority.repo.absolute, parent, {
        leafMustBeDirectory: true,
      });
      const leaf = lstatOrNull(absolute);
      if (leaf) {
        if (leaf.isSymbolicLink() || !leaf.isFile()) {
          throw authorityError(
            'SKG-PATH-AUTHORITY-NOT-FILE',
            `Ledger target must be a real file: ${absolute}`,
            { target: absolute },
          );
        }
        ledger = assertLocateChainNoSymlinks(workspaceAuthority.repo.absolute, absolute, {
          leafMustBeFile: true,
        });
      } else {
        ledger = { absolute, real: null, missing: true };
      }
    }
  }
  return { workspaceAuthority, candidate, scope, accepted, ledger };
}

/**
 * Prepare a unique recovery bundle directory under workspace/recovery.
 * Pre-existing recovery/ trees are refuse-closed (never deleted).
 * Only directories created by this call (ownership marker) may later be cleaned.
 */
export function prepareTrustedRecoveryBundle(workspaceAuthority, bundleLeafName) {
  const recoveryParent = path.join(workspaceAuthority.workspaceAbsolute, 'recovery');
  const existingParent = lstatOrNull(recoveryParent);
  if (existingParent) {
    throw authorityError(
      'SKG-PATH-AUTHORITY-RECOVERY-EXISTS',
      `Refusing to reuse pre-existing recovery directory: ${recoveryParent}`,
      { recovery: recoveryParent },
    );
  }
  mkdirTrustedSegmented(workspaceAuthority.workspaceAbsolute, recoveryParent, {
    leafMustBeDirectory: true,
  });
  const bundleAbsolute = path.join(recoveryParent, bundleLeafName);
  mkdirTrustedSegmented(workspaceAuthority.workspaceAbsolute, bundleAbsolute, {
    leafMustBeDirectory: true,
  });
  const token = `skg-recovery:${process.pid}:${Date.now().toString(16)}:${crypto.randomBytes(16).toString('hex')}`;
  const markerPath = path.join(bundleAbsolute, OWNERSHIP_MARKER);
  fs.writeFileSync(markerPath, `${token}\n`, { flag: 'wx' });
  const created = assertLocateChainNoSymlinks(workspaceAuthority.workspaceAbsolute, bundleAbsolute, {
    leafMustBeDirectory: true,
  });
  return {
    absolute: created.absolute,
    real: created.real,
    createdByCaller: true,
    ownershipToken: token,
    parentAbsolute: recoveryParent,
  };
}

/**
 * Cleanup only a recovery bundle this call created and re-verified.
 * Never delete pre-existing or foreign recovery content.
 */
export function safeCleanupRecoveryBundle(recoveryAuthority, workspaceAuthority) {
  if (!recoveryAuthority?.createdByCaller || !recoveryAuthority.absolute) {
    return { cleaned: false };
  }
  const target = recoveryAuthority.absolute;
  const stat = lstatOrNull(target);
  if (!stat) return { cleaned: false };
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw authorityError(
      'SKG-PATH-AUTHORITY-RECOVERY-EXISTS',
      `Refusing cleanup of non-owned recovery bundle: ${target}`,
      { recovery: target },
    );
  }
  const real = tryRealpath(target);
  if (!real || !isInsideRealRoot(real, workspaceAuthority.workspaceReal)) {
    throw authorityError(
      'SKG-PATH-AUTHORITY-ESCAPE',
      `Refusing recovery cleanup outside trusted workspace: ${target}`,
      { recovery: target, real },
    );
  }
  const markerPath = ownershipMarkerPath(target);
  const markerStat = lstatOrNull(markerPath);
  if (!markerStat || markerStat.isSymbolicLink() || !markerStat.isFile()) {
    throw authorityError(
      'SKG-PATH-AUTHORITY-RECOVERY-EXISTS',
      `Refusing recovery cleanup without ownership marker: ${target}`,
      { recovery: target },
    );
  }
  const marker = fs.readFileSync(markerPath, 'utf8').trim();
  if (marker !== recoveryAuthority.ownershipToken) {
    throw authorityError(
      'SKG-PATH-AUTHORITY-RECOVERY-EXISTS',
      `Refusing recovery cleanup of foreign ownership marker: ${target}`,
      { recovery: target },
    );
  }
  fs.rmSync(target, { recursive: true, force: false });
  const parent = recoveryAuthority.parentAbsolute;
  if (parent) {
    const parentStat = lstatOrNull(parent);
    if (parentStat && parentStat.isDirectory() && !parentStat.isSymbolicLink()) {
      const remaining = fs.readdirSync(parent);
      if (remaining.length === 0) {
        fs.rmdirSync(parent);
      }
    }
  }
  return { cleaned: true };
}

/**
 * Cleanup only a runtime root this call created and re-verified as a plain
 * directory inside the trusted workspace with matching ownership marker.
 * Never follow symlinks; never rm an unknown path.
 */
export function safeCleanupRuntimeRoot(runtimeAuthority, workspaceAuthority) {
  if (!runtimeAuthority?.createdByCaller || !runtimeAuthority.absolute) return { cleaned: false };
  const target = runtimeAuthority.absolute;
  const stat = lstatOrNull(target);
  if (!stat) return { cleaned: false };
  if (stat.isSymbolicLink()) {
    throw authorityError(
      'SKG-PATH-AUTHORITY-SYMLINK',
      `Refusing cleanup of symlink runtime root: ${target}`,
      { runtime: target },
    );
  }
  if (!stat.isDirectory()) {
    throw authorityError(
      'SKG-PATH-AUTHORITY-NOT-DIR',
      `Refusing cleanup of non-directory runtime root: ${target}`,
      { runtime: target },
    );
  }
  const real = tryRealpath(target);
  if (!real || !isInsideRealRoot(real, workspaceAuthority.workspaceReal)) {
    throw authorityError(
      'SKG-PATH-AUTHORITY-ESCAPE',
      `Refusing cleanup outside trusted workspace: ${target}`,
      { runtime: target, real, workspaceReal: workspaceAuthority.workspaceReal },
    );
  }
  if (runtimeAuthority.ownershipToken) {
    const markerPath = ownershipMarkerPath(target);
    const markerStat = lstatOrNull(markerPath);
    if (!markerStat || markerStat.isSymbolicLink() || !markerStat.isFile()) {
      throw authorityError(
        'SKG-PATH-AUTHORITY-RUNTIME-EXISTS',
        `Refusing cleanup without ownership marker: ${target}`,
        { runtime: target },
      );
    }
    const marker = fs.readFileSync(markerPath, 'utf8').trim();
    if (marker !== runtimeAuthority.ownershipToken) {
      throw authorityError(
        'SKG-PATH-AUTHORITY-RUNTIME-EXISTS',
        `Refusing cleanup of foreign ownership marker: ${target}`,
        { runtime: target },
      );
    }
  }
  fs.rmSync(target, { recursive: true, force: false });
  return { cleaned: true };
}
