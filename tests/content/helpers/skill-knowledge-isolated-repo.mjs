import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SOURCE_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Explicit stable allowlist for skill-knowledge temp fixtures.
 * Never includes plugin/dist — project/compile inside the temp repo instead.
 */
const DEFAULT_COPY_PATHS = Object.freeze([
  'plugin/src',
  'scripts',
  'design_docs/skill-knowledge-graph',
  'ccm/apps/cli/src/provider-model-facts.json',
]);

/** Exact-only stable path (file); descendants are not allowlisted. */
const EXACT_STABLE_PATHS = Object.freeze([
  'ccm/apps/cli/src/provider-model-facts.json',
]);

/** Prefix namespaces: self + descendants under the prefix. */
const STABLE_NAMESPACE_PREFIXES = Object.freeze([
  'plugin/src',
  'scripts',
  'design_docs/skill-knowledge-graph',
]);

const SKIP_NAMES = new Set([
  'node_modules',
  '.git',
  '.turbo',
  'coverage',
  '.cache',
]);

/**
 * True when `candidate` is `root` or a descendant of `root` (lexical, after resolve).
 */
function isInsideResolvedRoot(candidateResolved, rootResolved) {
  const rel = path.relative(rootResolved, candidateResolved);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Custom / allowlist paths must stay inside the default stable namespaces.
 * @param {string} canonical
 */
function assertStableNamespace(canonical) {
  if (EXACT_STABLE_PATHS.includes(canonical)) return;
  for (const prefix of STABLE_NAMESPACE_PREFIXES) {
    if (canonical === prefix || canonical.startsWith(`${prefix}/`)) return;
  }
  throw new Error(
    `skill-knowledge isolated repo rejects copy path '${canonical}' outside stable namespaces ` +
      `(plugin/src/**, scripts/**, design_docs/skill-knowledge-graph/**, or exact provider-model-facts).`,
  );
}

/**
 * Cross-platform, segment-level canonical lexical validation for custom copy paths.
 * Runs before any filesystem access. Rejects absolute / empty / `.` / NUL / root-escaping
 * `..`, and any path that normalizes to whole `plugin` or `plugin/dist/**`.
 * Also confines the path to the default stable namespaces (v8).
 *
 * @param {unknown} rel
 * @returns {string} posix-style relative path with no trailing slash
 */
function assertAllowedCopyPath(rel) {
  if (rel == null) {
    throw new Error(
      `skill-knowledge isolated repo rejects empty/invalid copy path '${rel}'. Use stable allowlist paths such as plugin/src.`,
    );
  }
  const raw = String(rel);
  if (raw.includes('\0')) {
    throw new Error(
      `skill-knowledge isolated repo rejects NUL in copy path. Use stable allowlist paths such as plugin/src.`,
    );
  }
  if (raw === '' || raw === '.' || raw === './') {
    throw new Error(
      `skill-knowledge isolated repo rejects empty/'.' copy path. Use stable allowlist paths such as plugin/src.`,
    );
  }

  // Absolute on either platform (incl. drive-letter / UNC) fail closed before join.
  if (
    path.posix.isAbsolute(raw) ||
    path.win32.isAbsolute(raw) ||
    path.posix.isAbsolute(raw.replace(/\\/g, '/')) ||
    /^[A-Za-z]:/.test(raw) ||
    raw.startsWith('\\\\') ||
    raw.startsWith('//')
  ) {
    throw new Error(
      `skill-knowledge isolated repo rejects absolute copy path '${rel}'. Use a repo-relative stable source path.`,
    );
  }

  // Segment-level lexical canonicalize: unify separators, posix.normalize, strip trailing slash.
  const unified = raw.replace(/\\/g, '/');
  const normalized = path.posix.normalize(unified);
  const canonical = normalized.replace(/\/+$/, '');

  if (
    canonical === '' ||
    canonical === '.' ||
    canonical === '..' ||
    canonical.startsWith('../')
  ) {
    throw new Error(
      `skill-knowledge isolated repo rejects copy path '${rel}' that escapes the source root (canonical='${canonical}').`,
    );
  }

  // Any remaining empty / '.' / '..' segment after normalize is a fail-closed signal
  // (posix.normalize collapses '.' and interior '..', so leftovers mean escape or junk).
  const segments = canonical.split('/');
  if (
    segments.some((seg) => seg === '' || seg === '.' || seg === '..') ||
    segments.length === 0
  ) {
    throw new Error(
      `skill-knowledge isolated repo rejects non-canonical copy path '${rel}' (canonical='${canonical}').`,
    );
  }

  if (canonical === 'plugin') {
    throw new Error(
      `skill-knowledge isolated repo forbids copying whole 'plugin' tree (would read shared plugin/dist). Use stable allowlist paths such as plugin/src.`,
    );
  }
  if (canonical === 'plugin/dist' || canonical.startsWith('plugin/dist/')) {
    throw new Error(
      `skill-knowledge isolated repo forbids plugin/dist allowlist entry '${rel}' (canonical='${canonical}'). Project dist inside the temp repo from source instead.`,
    );
  }

  assertStableNamespace(canonical);
  return canonical;
}

/**
 * Resolve a validated relative copy path under `root` and prove containment.
 * @param {string} root
 * @param {string} canonicalRel
 * @param {'source'|'destination'} role
 */
function resolveContainedCopyTarget(root, canonicalRel, role) {
  const rootResolved = path.resolve(root);
  const candidate = path.resolve(rootResolved, ...canonicalRel.split('/'));
  if (!isInsideResolvedRoot(candidate, rootResolved)) {
    throw new Error(
      `skill-knowledge isolated repo ${role} path escapes its root: '${canonicalRel}' → ${candidate} (root=${rootResolved})`,
    );
  }
  return candidate;
}

/**
 * Establish the authority root for path-segment walks.
 *
 * Contract: if `root` itself is a symlink (or a path that realpath can resolve),
 * the helper uses `fs.realpathSync(root)` as authority. All subsequent locating
 * segments are checked with lstat beneath that real root — they must not be
 * symlinks. Callers must not treat a symlinked sourceRoot as a way to re-root
 * into plugin/dist or outside the intended tree via further aliases.
 *
 * @param {string} root
 * @param {{ role: 'source'|'destination', mustExist: boolean }} options
 * @returns {string} absolute authority root
 */
function resolveAuthorityRoot(root, { role, mustExist }) {
  const resolved = path.resolve(root);
  try {
    fs.lstatSync(resolved);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      if (mustExist) {
        throw new Error(
          `skill-knowledge isolated repo ${role} root does not exist: ${resolved}`,
        );
      }
      return resolved;
    }
    throw err;
  }
  // realpath is the single authority for a symlinked (or ordinary) existing root.
  return fs.realpathSync(resolved);
}

/**
 * Walk every existing path segment from authorityRoot to canonicalRel with lstat.
 * Rejects any symlink on the locating ancestor chain (including the copy root).
 * Does not follow symlinks; does not catch-and-retry. Must run before mkdir/cpSync.
 *
 * @param {string} authorityRoot absolute real (or unresolved-if-missing dest) root
 * @param {string} canonicalRel posix relative path
 * @param {'source'|'destination'} role
 */
function assertNoSymlinkLocatingSegments(authorityRoot, canonicalRel, role) {
  const rootResolved = path.resolve(authorityRoot);
  const segments = canonicalRel.split('/');
  let current = rootResolved;

  for (let i = 0; i < segments.length; i++) {
    const next = path.join(current, segments[i]);
    const nextResolved = path.resolve(next);
    if (!isInsideResolvedRoot(nextResolved, rootResolved)) {
      throw new Error(
        `skill-knowledge isolated repo ${role} path escapes its root: '${canonicalRel}' → ${nextResolved} (root=${rootResolved})`,
      );
    }

    let st;
    try {
      st = fs.lstatSync(next);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        // Remaining segments do not exist yet (destination mkdir will create
        // ordinary directories). Stop walking — nothing further can be an
        // existing symlink ancestor.
        return;
      }
      throw err;
    }

    if (st.isSymbolicLink()) {
      const partial = segments.slice(0, i + 1).join('/');
      throw new Error(
        `skill-knowledge isolated repo ${role} locating path segment is a symlink ` +
          `(forbidden on ancestor chain used to locate the copy root): '${partial}'`,
      );
    }

    current = next;
  }

  // Lexical guard: even without following links, the candidate relative path
  // must never be plugin/dist (defense in depth alongside namespace check).
  if (canonicalRel === 'plugin/dist' || canonicalRel.startsWith('plugin/dist/')) {
    throw new Error(
      `skill-knowledge isolated repo ${role} path resolves into plugin/dist ('${canonicalRel}').`,
    );
  }
}

/**
 * Ensure destination parent directories exist without creating/traversing symlinks.
 * Creates missing segments one at a time after lstat-proving each existing
 * ancestor is a real directory.
 *
 * @param {string} authorityRoot
 * @param {string} canonicalRel path of the copy target (file or directory)
 */
function ensureDestinationParentsNoSymlink(authorityRoot, canonicalRel) {
  const rootResolved = path.resolve(authorityRoot);
  const segments = canonicalRel.split('/');
  // Parents only — the final segment is the copy target created by cpSync.
  const parentSegments = segments.slice(0, -1);
  let current = rootResolved;

  for (let i = 0; i < parentSegments.length; i++) {
    const next = path.join(current, parentSegments[i]);
    const nextResolved = path.resolve(next);
    if (!isInsideResolvedRoot(nextResolved, rootResolved)) {
      throw new Error(
        `skill-knowledge isolated repo destination path escapes its root: '${canonicalRel}' → ${nextResolved} (root=${rootResolved})`,
      );
    }

    let st;
    try {
      st = fs.lstatSync(next);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        fs.mkdirSync(next);
        current = next;
        continue;
      }
      throw err;
    }

    if (st.isSymbolicLink()) {
      const partial = parentSegments.slice(0, i + 1).join('/');
      throw new Error(
        `skill-knowledge isolated repo destination locating path segment is a symlink ` +
          `(forbidden on ancestor chain used to locate the copy root): '${partial}'`,
      );
    }
    if (!st.isDirectory()) {
      throw new Error(
        `skill-knowledge isolated repo destination parent is not a directory: '${parentSegments.slice(0, i + 1).join('/')}'`,
      );
    }
    current = next;
  }
}

function shouldCopyPath(srcPath) {
  const base = path.basename(srcPath);
  if (SKIP_NAMES.has(base)) return false;
  return true;
}

/**
 * Copy a minimal-but-complete skill-knowledge fixture repo from an explicit
 * stable source allowlist. Preserves symlink nodes (verbatimSymlinks) and
 * skips huge/ignored dirs (node_modules/.git/…).
 *
 * Does NOT recurse into shared-HUB plugin/dist. Callers that need a runtime
 * dist baseline must project/compile inside the temp repo (see
 * projectPluginDistInRepo).
 *
 * Custom `paths` are segment-canonicalized, confined to stable namespaces, and
 * containment-checked before any filesystem access — lexical escapes into
 * plugin/dist fail closed. Locating ancestor chains on source and destination
 * are lstat-proven non-symlink before mkdir/cpSync (v8). Interior symlink
 * nodes inside a copied tree may still be preserved with verbatimSymlinks.
 *
 * @param {string} destRoot
 * @param {{ paths?: string[], sourceRoot?: string }} [options]
 */
export function copyMinimalSkillKnowledgeRepo(
  destRoot,
  { paths = DEFAULT_COPY_PATHS, sourceRoot = SOURCE_REPO } = {},
) {
  const sourceAuthority = resolveAuthorityRoot(sourceRoot, {
    role: 'source',
    mustExist: true,
  });

  fs.mkdirSync(destRoot, { recursive: true });
  const destAuthority = resolveAuthorityRoot(destRoot, {
    role: 'destination',
    mustExist: true,
  });

  for (const rel of paths) {
    const canonical = assertAllowedCopyPath(rel);

    // Source locating chain: every existing segment to the copy root must be
    // a non-symlink (lstat). Then prove lexical containment under authority.
    assertNoSymlinkLocatingSegments(sourceAuthority, canonical, 'source');
    const from = resolveContainedCopyTarget(sourceAuthority, canonical, 'source');
    if (!fs.existsSync(from)) {
      throw new Error(`skill-knowledge isolated repo missing source path: ${canonical}`);
    }
    // existsSync follows links — refuse if the copy root itself became a link
    // between the walk and now (TOCTOU-narrow; primary check is lstat above).
    if (fs.lstatSync(from).isSymbolicLink()) {
      throw new Error(
        `skill-knowledge isolated repo source locating path segment is a symlink ` +
          `(forbidden on ancestor chain used to locate the copy root): '${canonical}'`,
      );
    }

    assertNoSymlinkLocatingSegments(destAuthority, canonical, 'destination');
    const to = resolveContainedCopyTarget(destAuthority, canonical, 'destination');
    ensureDestinationParentsNoSymlink(destAuthority, canonical);

    fs.cpSync(from, to, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (src) => shouldCopyPath(src),
    });
  }
  return destRoot;
}

/**
 * Project adapter surfaces inside an isolated temp repo (never the shared HUB).
 *
 * @param {string} repoRoot
 * @param {{ host: string, skillsOnly?: boolean }} options
 */
export function projectPluginDistInRepo(repoRoot, { host, skillsOnly = false } = {}) {
  if (!host) throw new Error('projectPluginDistInRepo requires host');
  const args = ['scripts/sync-plugin-dist.sh', '--host', host];
  if (skillsOnly) args.push('--skills-only');
  const result = spawnSync('bash', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return result;
}

/**
 * Run `fn` against an isolated mkdtemp repo copy. Finally deletes only the temp
 * tree — never restores checked-in shared paths.
 *
 * `runCli` always invokes the CLI *inside* the copy (not the source-repo absolute path).
 *
 * @param {(ctx: object) => unknown} fn
 * @param {{
 *   paths?: string[],
 *   sourceRoot?: string,
 *   warmHosts?: string[],
 *   warmSkillsOnly?: boolean,
 * }} [options]
 */
export function withIsolatedSkillKnowledgeRepo(fn, options = {}) {
  const tempParent = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-iso-'));
  const repoCopy = path.join(tempParent, 'repo');
  try {
    copyMinimalSkillKnowledgeRepo(repoCopy, options);
    for (const host of options.warmHosts ?? []) {
      const warm = projectPluginDistInRepo(repoCopy, {
        host,
        skillsOnly: Boolean(options.warmSkillsOnly),
      });
      if (warm.status !== 0) {
        throw new Error(
          `warm project failed for ${host} (status=${warm.status}):\n${warm.stdout}\n${warm.stderr}`,
        );
      }
    }
    const cliPath = path.join(repoCopy, 'scripts', 'skill-knowledge.mjs');
    const runCli = (args, spawnOptions = {}) =>
      spawnSync(process.execPath, [cliPath, ...args], {
        cwd: spawnOptions.cwd ?? repoCopy,
        encoding: 'utf8',
        env: { ...process.env, ...(spawnOptions.env ?? {}) },
      });
    const result = fn({
      repoRoot: repoCopy,
      cliPath,
      runCli,
      sourceRepo: options.sourceRoot ?? SOURCE_REPO,
      projectPluginDist: (host, projectOptions = {}) =>
        projectPluginDistInRepo(repoCopy, { host, ...projectOptions }),
    });
    if (result && typeof result.then === 'function') {
      return result.finally(() => {
        fs.rmSync(tempParent, { recursive: true, force: true });
      });
    }
    fs.rmSync(tempParent, { recursive: true, force: true });
    return result;
  } catch (error) {
    fs.rmSync(tempParent, { recursive: true, force: true });
    throw error;
  }
}

export { SOURCE_REPO, DEFAULT_COPY_PATHS };
