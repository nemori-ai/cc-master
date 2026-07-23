import fs from 'node:fs';
import path from 'node:path';
import { normalizePointAnchor } from '../host-portability/anchors.mjs';
import { estimateBudget } from '../hash.mjs';
import {
  PRODUCT_HOSTS,
  atlasDistPath,
  canonicalBindingToDistPath,
  entrySurfaceToDistPath,
  moduleAnchorId,
  moduleRouterDistPath,
  posixRelative,
  skillAnchorId,
} from './paths.mjs';

const NAV_END = '<!-- ccm:k:nav:end -->';
const ENTRY_PIN_START = '<!-- ccm:k:entry-pin:start -->';
const ENTRY_PIN_END = '<!-- ccm:k:entry-pin:end -->';
const ANCHOR_LINE_RE = /^<a id="ccm-k-point-[a-z0-9-]+"><\/a>\s*$/;
const KNOWN_HOSTS = new Set(PRODUCT_HOSTS);

function stripGeneratedBlocks(text) {
  let next = text.replace(
    /<!--\s*ccm:k:nav:start(?:\s+point:[a-z0-9][a-z0-9.-]*)?\s*-->[\s\S]*?<!--\s*ccm:k:nav:end\s*-->\n*/g,
    '',
  );
  // Also strip malformed open nav comments left by older emitters (missing -->).
  next = next.replace(
    /<!--\s*ccm:k:nav:start\s+point:[a-z0-9][a-z0-9.-]*\s*\n[\s\S]*?<!--\s*ccm:k:nav:end\s*-->\n*/g,
    '',
  );
  next = next.replace(
    new RegExp(`${ENTRY_PIN_START}[\\s\\S]*?${ENTRY_PIN_END}\\n*`, 'g'),
    '',
  );
  // Strip previously injected point anchors that sit immediately before start markers.
  const lines = next.split('\n');
  const cleaned = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1] ?? '';
    if (ANCHOR_LINE_RE.test(line) && /<!--\s*ccm:k:start\s+point:/.test(nextLine)) {
      continue;
    }
    cleaned.push(line);
  }
  return cleaned.join('\n');
}

function ensureTrailingNewline(text) {
  return `${String(text).replace(/\n+$/u, '')}\n`;
}

function isInsideRoot(candidate, root) {
  const candidateResolved = path.resolve(candidate);
  const rootResolved = path.resolve(root);
  return (
    candidateResolved === rootResolved ||
    candidateResolved.startsWith(`${rootResolved}${path.sep}`)
  );
}

function tryRealpath(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

function hostDistPrefix(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  const match = normalized.match(/^(plugin\/dist\/[^/]+)(?:\/|$)/);
  return match ? match[1] : null;
}

function hostIdFromDistRelative(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  const match = normalized.match(/^plugin\/dist\/([^/]+)(?:\/|$)/);
  return match ? match[1] : null;
}

function knowledgeManagedRoot(artifactPath) {
  const normalized = artifactPath.split(path.sep).join('/');
  const match = normalized.match(/^(plugin\/dist\/[^/]+\/knowledge)(?:\/|$)/);
  return match ? match[1] : null;
}

function collectManagedRoots(artifacts) {
  const roots = new Set();
  for (const relative of artifacts.keys()) {
    const root = knowledgeManagedRoot(relative);
    if (root) roots.add(root);
  }
  return [...roots].sort();
}

function collectHostDistRoots(artifacts) {
  const roots = new Set();
  for (const relative of artifacts.keys()) {
    const root = hostDistPrefix(relative);
    if (root) roots.add(root);
  }
  return [...roots].sort();
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
 * Lexical containment under verified host dist + realpath containment under
 * repoReal (the sole trust root). Never uses hostReal as containment SSOT.
 */
function assertPathInsideTrustedHostDist(
  absolutePath,
  trust,
  { mustExist = false } = {},
) {
  const absolute = path.resolve(absolutePath);
  const hostDist = path.resolve(trust.hostDistAbsolute);
  const repoReal = trust.repoReal;
  if (!isInsideRoot(absolute, hostDist)) {
    throw new Error(
      `SKG-COMPILE-PATH-ESCAPE: path escapes host dist lexically: ${absolute} not under ${hostDist}`,
    );
  }

  const relative = path.relative(hostDist, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`SKG-COMPILE-PATH-ESCAPE: ${absolute} not under ${hostDist}`);
  }
  const parts = relative === '' ? [] : relative.split(path.sep);
  let cursor = hostDist;
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    const stat = lstatOrNull(cursor);
    if (!stat) {
      if (mustExist) {
        throw new Error(`SKG-COMPILE-PATH-MISSING: ${cursor}`);
      }
      // Remaining segments will be created inside a verified parent.
      break;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(
        `SKG-COMPILE-ANCESTOR-SYMLINK: refusing to traverse symlink ancestor ${cursor}`,
      );
    }
    const real = tryRealpath(cursor);
    // Containment SSOT is repoReal — never hostDistReal / hostReal alone.
    if (!real || !isInsideRoot(real, repoReal)) {
      throw new Error(
        `SKG-COMPILE-PATH-ESCAPE: realpath of ${cursor} escapes repo trust root ${repoReal}`,
      );
    }
  }
  return { absolute, hostDist, repoReal };
}

/**
 * Create directories under a verified base without following symlinks.
 * Each newly created segment is created with mkdir and immediately re-lstat'd.
 */
function mkdirpNoFollow(absoluteDir, trust) {
  assertPathInsideTrustedHostDist(absoluteDir, trust);
  const hostDist = path.resolve(trust.hostDistAbsolute);
  const relative = path.relative(hostDist, path.resolve(absoluteDir));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`SKG-COMPILE-PATH-ESCAPE: ${absoluteDir}`);
  }
  if (relative === '') return;
  let cursor = hostDist;
  for (const part of relative.split(path.sep)) {
    cursor = path.join(cursor, part);
    const stat = lstatOrNull(cursor);
    if (!stat) {
      fs.mkdirSync(cursor);
      const created = lstatOrNull(cursor);
      if (!created || created.isSymbolicLink() || !created.isDirectory()) {
        throw new Error(`SKG-COMPILE-MKDIR-RACE: ${cursor}`);
      }
      continue;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`SKG-COMPILE-ANCESTOR-SYMLINK: ${cursor}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`SKG-COMPILE-MKDIR-NOT-DIR: ${cursor}`);
    }
    const real = tryRealpath(cursor);
    if (!real || !isInsideRoot(real, trust.repoReal)) {
      throw new Error(`SKG-COMPILE-PATH-ESCAPE: ${cursor}`);
    }
  }
}

function writeFileAtomicNoFollow(absolutePath, contents, trust) {
  assertPathInsideTrustedHostDist(absolutePath, trust);
  mkdirpNoFollow(path.dirname(absolutePath), trust);
  const temp = `${absolutePath}.tmp-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
  assertPathInsideTrustedHostDist(temp, trust);
  const fd = fs.openSync(temp, 'w');
  try {
    fs.writeFileSync(fd, contents, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const written = fs.readFileSync(temp, 'utf8');
  if (written !== contents) {
    fs.unlinkSync(temp);
    throw new Error(`SKG-COMPILE-WRITE-VERIFY: content mismatch for ${absolutePath}`);
  }
  fs.renameSync(temp, absolutePath);
}

/**
 * Remove a path without following symlinks. Directory trees are walked with
 * lstat/readdir only; symlink nodes are unlinked as leaves.
 * Containment SSOT is the caller-supplied root (repoReal or hostDistAbsolute).
 */
function rmNoFollow(targetAbsolute, containmentRoot) {
  const absolute = path.resolve(targetAbsolute);
  const root = path.resolve(containmentRoot);
  if (!isInsideRoot(absolute, root)) {
    throw new Error(`SKG-COMPILE-RM-ESCAPE: refusing to remove ${absolute} outside ${root}`);
  }
  const stat = lstatOrNull(absolute);
  if (!stat) return;
  if (stat.isSymbolicLink() || stat.isFile()) {
    fs.unlinkSync(absolute);
    return;
  }
  if (!stat.isDirectory()) {
    fs.unlinkSync(absolute);
    return;
  }
  for (const name of fs.readdirSync(absolute)) {
    rmNoFollow(path.join(absolute, name), root);
  }
  fs.rmdirSync(absolute);
}

/**
 * Recursively enumerate files under root without following directory symlinks.
 * If the managed root itself is a symlink, returns a single symlink entry.
 */
function enumerateManagedTree(rootAbsolute) {
  const entries = [];
  const rootStat = lstatOrNull(rootAbsolute);
  if (!rootStat) return entries;
  if (rootStat.isSymbolicLink()) {
    entries.push({ path: '', kind: 'symlink', absolute: rootAbsolute });
    return entries;
  }
  if (!rootStat.isDirectory()) return entries;

  const rootReal = tryRealpath(rootAbsolute);
  if (!rootReal) return entries;

  const visit = (directory, relativePrefix) => {
    for (const dirent of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const absolute = path.join(directory, dirent.name);
      const relative = relativePrefix ? `${relativePrefix}/${dirent.name}` : dirent.name;
      if (dirent.isSymbolicLink()) {
        entries.push({ path: relative, kind: 'symlink', absolute });
        continue;
      }
      if (dirent.isDirectory()) {
        const real = tryRealpath(absolute);
        if (!real || !isInsideRoot(real, rootReal)) {
          entries.push({ path: relative, kind: 'escape', absolute });
          continue;
        }
        visit(absolute, relative);
        continue;
      }
      if (dirent.isFile()) {
        const real = tryRealpath(absolute);
        if (!real || !isInsideRoot(real, rootReal)) {
          entries.push({ path: relative, kind: 'escape', absolute });
          continue;
        }
        entries.push({ path: relative, kind: 'file', absolute });
      }
    }
  };

  visit(rootAbsolute, '');
  return entries;
}

/**
 * Replace an exact-managed knowledge tree via sibling temp directory inside the
 * verified host dist. Existing managed-root symlinks are unlinked (not followed).
 */
function replaceManagedKnowledgeTree(repoRoot, managedRootRelative, knowledgeArtifacts, trust) {
  const hostDistAbsolute = trust.hostDistAbsolute;
  const managedAbsolute = path.join(repoRoot, managedRootRelative);
  // Parent must be safe; managed root itself may be a symlink we are about to replace.
  assertPathInsideTrustedHostDist(path.dirname(managedAbsolute), trust);
  if (!isInsideRoot(managedAbsolute, hostDistAbsolute)) {
    throw new Error(
      `SKG-COMPILE-PATH-ESCAPE: managed root escapes host dist: ${managedAbsolute}`,
    );
  }

  const stamp = `${process.pid}-${Date.now().toString(16)}`;
  const tempAbsolute = path.join(hostDistAbsolute, `knowledge.write-${stamp}`);
  const backupAbsolute = path.join(hostDistAbsolute, `knowledge.bak-${stamp}`);
  assertPathInsideTrustedHostDist(tempAbsolute, trust);
  assertPathInsideTrustedHostDist(backupAbsolute, trust);

  // Fail closed if leftover temp/backup collide.
  if (lstatOrNull(tempAbsolute) || lstatOrNull(backupAbsolute)) {
    throw new Error(`SKG-COMPILE-TEMP-COLLISION: ${tempAbsolute}`);
  }

  fs.mkdirSync(tempAbsolute);
  const tempStat = lstatOrNull(tempAbsolute);
  if (!tempStat || tempStat.isSymbolicLink() || !tempStat.isDirectory()) {
    throw new Error(`SKG-COMPILE-TEMP-INVALID: ${tempAbsolute}`);
  }

  try {
    for (const [relative, contents] of [...knowledgeArtifacts.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      if (!(relative === managedRootRelative || relative.startsWith(`${managedRootRelative}/`))) {
        continue;
      }
      const relInside =
        relative === managedRootRelative ? '' : relative.slice(managedRootRelative.length + 1);
      if (!relInside) {
        // Managed root is a directory tree; never emit a file at the root path itself.
        continue;
      }
      const target = path.join(tempAbsolute, relInside);
      writeFileAtomicNoFollow(target, ensureTrailingNewline(contents), trust);
    }

    // Durability barrier before swap: fsync the temp directory inode.
    const tempFd = fs.openSync(tempAbsolute, 'r');
    try {
      fs.fsyncSync(tempFd);
    } finally {
      fs.closeSync(tempFd);
    }

    // Swap into place: unlink symlink root, or rename real directory aside.
    const existing = lstatOrNull(managedAbsolute);
    if (existing?.isSymbolicLink()) {
      fs.unlinkSync(managedAbsolute);
    } else if (existing) {
      fs.renameSync(managedAbsolute, backupAbsolute);
    }
    fs.renameSync(tempAbsolute, managedAbsolute);

    if (lstatOrNull(backupAbsolute)) {
      rmNoFollow(backupAbsolute, trust.repoReal);
    }
  } catch (error) {
    // Best-effort fail-closed cleanup of temp; never follow symlinks.
    if (lstatOrNull(tempAbsolute)) {
      try {
        rmNoFollow(tempAbsolute, trust.repoReal);
      } catch {
        // leave temp for operator inspection
      }
    }
    // If we moved the old tree aside but failed before/during final rename, try restore.
    if (!lstatOrNull(managedAbsolute) && lstatOrNull(backupAbsolute)) {
      try {
        fs.renameSync(backupAbsolute, managedAbsolute);
      } catch {
        // leave backup in place
      }
    }
    throw error;
  }
}

function pointDistPath(host, point) {
  return canonicalBindingToDistPath(host, point.binding.path);
}

function linkLine(label, fromFile, toFile, fragment) {
  const relative = posixRelative(fromFile, toFile);
  return `- [${label}](${relative}${fragment})`;
}

/**
 * Build deterministic in-memory artifacts for one host from an accepted authored graph.
 * Does not touch disk; caller writes or diffs.
 */
export function buildHostArtifacts({ host, graph, repoRoot }) {
  const artifacts = new Map();
  const diagnostics = [];
  const atlasPath = atlasDistPath(host);
  const modules = [...graph.modules].sort((a, b) => a.id.localeCompare(b.id));
  const points = [...graph.points].sort((a, b) => a.id.localeCompare(b.id));
  const pointById = new Map(points.map((point) => [point.id, point]));

  // --- atlas ---
  const atlasLines = [
    '<!-- ccm:k:generated -->',
    '# Knowledge atlas',
    '',
    'Generated runtime navigation surface. Prefer these links over prose mentions.',
    '',
    '## Critical pins',
    '',
  ];
  for (const module of modules.filter((item) => item.access?.class === 'critical')) {
    for (const primaryId of module.access.primary_points ?? []) {
      const point = pointById.get(primaryId);
      if (!point) continue;
      const target = pointDistPath(host, point);
      const anchor = normalizePointAnchor(primaryId);
      atlasLines.push(
        linkLine(point.title || primaryId, atlasPath, target, anchor.fragment),
      );
    }
  }
  atlasLines.push('', '## Modules', '');
  for (const module of modules) {
    const routerPath = moduleRouterDistPath(host, module.id);
    const fragment = `#${moduleAnchorId(module.id)}`;
    atlasLines.push(
      linkLine(module.title || module.id, atlasPath, routerPath, fragment),
    );
  }
  atlasLines.push('');
  artifacts.set(atlasPath, ensureTrailingNewline(atlasLines.join('\n')));

  // --- module routers ---
  for (const module of modules) {
    const routerPath = moduleRouterDistPath(host, module.id);
    const members = points.filter((point) => point.module_id === module.id);
    const lines = [
      '<!-- ccm:k:generated -->',
      `# ${module.title || module.id}`,
      '',
      `<a id="${moduleAnchorId(module.id)}"></a>`,
      '',
      module.intent ?? '',
      '',
      '## Member points',
      '',
    ];
    for (const point of members) {
      const target = pointDistPath(host, point);
      const anchor = normalizePointAnchor(point.id);
      const role = point.authority?.role || 'canonical';
      const label =
        role === 'canonical'
          ? point.title || point.id
          : `${role}: ${point.title || point.id}`;
      lines.push(linkLine(label, routerPath, target, anchor.fragment));
      if (role !== 'canonical' && point.authority?.canonical) {
        const canonical = pointById.get(point.authority.canonical);
        if (canonical) {
          const canonicalPath = pointDistPath(host, canonical);
          const canonicalAnchor = normalizePointAnchor(canonical.id);
          lines.push(
            linkLine(
              `canonicalize → ${canonical.title || canonical.id}`,
              routerPath,
              canonicalPath,
              canonicalAnchor.fragment,
            ),
          );
        }
      }
    }
    lines.push('', '## Back to atlas', '');
    lines.push(linkLine('Knowledge atlas', routerPath, atlasPath, ''));
    lines.push('');
    artifacts.set(routerPath, ensureTrailingNewline(lines.join('\n')));
  }

  // --- inject anchors + nav into skill markdown ---
  const filesTouched = new Map();
  for (const point of points) {
    const distRel = pointDistPath(host, point);
    if (!distRel) {
      diagnostics.push({
        severity: 'error',
        code: 'SKG-COMPILE-BINDING-PATH',
        message: `Cannot map binding path to host dist for ${point.id}`,
        location: point.binding?.path ?? point.id,
        witness: { host, point: point.id, binding: point.binding ?? null },
        remediation: 'Keep point bindings under plugin/src/skills/<skill>/canonical/.',
        exit_code: 5,
      });
      continue;
    }
    const absolute = path.join(repoRoot, distRel);
    if (!fs.existsSync(absolute)) {
      diagnostics.push({
        severity: 'error',
        code: 'SKG-COMPILE-DIST-MISSING',
        message: `Projected skill Markdown missing for ${point.id}: ${distRel}`,
        location: distRel,
        witness: { host, point: point.id },
        remediation: 'Run sync-plugin-dist for this host before compile, or restore the skill projection.',
        exit_code: 5,
      });
      continue;
    }
    if (!filesTouched.has(distRel)) {
      filesTouched.set(distRel, stripGeneratedBlocks(fs.readFileSync(absolute, 'utf8')));
    }
  }

  for (const [distRel, rawText] of filesTouched) {
    let text = rawText;
    const filePoints = points.filter((point) => pointDistPath(host, point) === distRel);
    for (const point of filePoints) {
      const anchor = normalizePointAnchor(point.id);
      const startMarker = `<!-- ccm:k:start ${point.id} -->`;
      const endMarker = `<!-- ccm:k:end ${point.id} -->`;
      if (!text.includes(startMarker) || !text.includes(endMarker)) {
        diagnostics.push({
          severity: 'error',
          code: 'SKG-COMPILE-MARKER-MISSING',
          message: `Projected Markdown missing markers for ${point.id}`,
          location: distRel,
          witness: { host, point: point.id },
          remediation: 'Restore ccm:k markers from canonical source before compile.',
          exit_code: 5,
        });
        continue;
      }
      // Anchor immediately before start marker (outside span).
      text = text.replace(
        startMarker,
        `${anchor.html}\n${startMarker}`,
      );

      const navLines = [
        `<!-- ccm:k:nav:start ${point.id} -->`,
        'Knowledge navigation:',
      ];
      navLines.push(linkLine('Knowledge atlas', distRel, atlasPath, ''));
      const moduleId = point.module_id;
      if (moduleId) {
        const routerPath = moduleRouterDistPath(host, moduleId);
        navLines.push(
          linkLine(
            `Module ${moduleId}`,
            distRel,
            routerPath,
            `#${moduleAnchorId(moduleId)}`,
          ),
        );
      }
      if (point.authority?.role !== 'canonical' && point.authority?.canonical) {
        const canonical = pointById.get(point.authority.canonical);
        if (canonical) {
          const target = pointDistPath(host, canonical);
          const targetAnchor = normalizePointAnchor(canonical.id);
          navLines.push(
            linkLine(
              `Canonical: ${canonical.title || canonical.id}`,
              distRel,
              target,
              targetAnchor.fragment,
            ),
          );
        }
      }
      const outbound = (graph.adjacency.get(point.id) ?? []).slice().sort((a, b) => {
        const byTo = a.to.localeCompare(b.to);
        if (byTo !== 0) return byTo;
        return a.edge_id.localeCompare(b.edge_id);
      });
      for (const edge of outbound) {
        const targetPoint = pointById.get(edge.to);
        if (!targetPoint) continue;
        const target = pointDistPath(host, targetPoint);
        const targetAnchor = normalizePointAnchor(targetPoint.id);
        navLines.push(
          linkLine(
            `${edge.type}: ${targetPoint.title || targetPoint.id}`,
            distRel,
            target,
            targetAnchor.fragment,
          ),
        );
      }
      navLines.push(NAV_END);
      const navBlock = `${navLines.join('\n')}\n`;
      text = text.replace(
        new RegExp(`${endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n*`),
        `${endMarker}\n${navBlock}`,
      );
    }
    artifacts.set(distRel, ensureTrailingNewline(text));
  }

  // --- entry pins on projected entry surfaces ---
  for (const entry of graph.entries ?? []) {
    for (const surface of entry.surfaces ?? []) {
      if (surface.host !== host) continue;
      const distRel = entrySurfaceToDistPath(host, surface.source_file);
      if (!distRel) {
        diagnostics.push({
          severity: 'error',
          code: 'SKG-COMPILE-ENTRY-SURFACE',
          message: `Cannot map entry surface to host dist for ${entry.id}`,
          location: surface.source_file,
          witness: { host, entry: entry.id, source_file: surface.source_file },
          remediation: 'Use command adapter body.md or skill canonical/SKILL.md entry surfaces.',
          exit_code: 5,
        });
        continue;
      }
      const absolute = path.join(repoRoot, distRel);
      if (!fs.existsSync(absolute)) {
        diagnostics.push({
          severity: 'error',
          code: 'SKG-COMPILE-ENTRY-MISSING',
          message: `Projected entry surface missing: ${distRel}`,
          location: distRel,
          witness: { host, entry: entry.id },
          remediation: 'Project commands/skills for this host before compile.',
          exit_code: 5,
        });
        continue;
      }
      let text = stripGeneratedBlocks(fs.readFileSync(absolute, 'utf8'));
      const pinLines = [ENTRY_PIN_START, `Knowledge entry pins for ${entry.id}:`];
      for (const target of surface.targets ?? []) {
        const point = pointById.get(target.point);
        if (!point) continue;
        const targetPath = pointDistPath(host, point);
        const anchor = normalizePointAnchor(point.id);
        pinLines.push(linkLine(point.title || point.id, distRel, targetPath, anchor.fragment));
      }
      // Pin relevant critical/primary points and their module routers for H3/H4.
      for (const module of modules) {
        if (!(module.access?.relevant_entries ?? []).includes(entry.id)) continue;
        const routerPath = moduleRouterDistPath(host, module.id);
        pinLines.push(
          linkLine(
            `Module ${module.id}`,
            distRel,
            routerPath,
            `#${moduleAnchorId(module.id)}`,
          ),
        );
        for (const primaryId of module.access.primary_points ?? []) {
          if ((surface.targets ?? []).some((item) => item.point === primaryId)) continue;
          const point = pointById.get(primaryId);
          if (!point) continue;
          // Critical must be ≤1 hop: direct pin. Primary may also be direct for deterministic ≤2.
          if (module.access?.class === 'critical' || module.access?.class === 'primary') {
            const targetPath = pointDistPath(host, point);
            const anchor = normalizePointAnchor(point.id);
            pinLines.push(
              linkLine(
                `${module.access.class}: ${point.title || point.id}`,
                distRel,
                targetPath,
                anchor.fragment,
              ),
            );
          }
        }
      }
      pinLines.push(ENTRY_PIN_END);
      text = `${ensureTrailingNewline(text)}${pinLines.join('\n')}`;
      artifacts.set(distRel, ensureTrailingNewline(text));
    }
  }

  // Skill-level anchor on SKILL.md for C9 skill pattern completeness.
  const skill = graph.skills[0];
  if (skill) {
    const skillPath = `plugin/dist/${host}/skills/${skill.id.replace(/^skill:/, '')}/SKILL.md`;
    if (artifacts.has(skillPath) || fs.existsSync(path.join(repoRoot, skillPath))) {
      let text = artifacts.get(skillPath);
      if (!text) text = stripGeneratedBlocks(fs.readFileSync(path.join(repoRoot, skillPath), 'utf8'));
      const skillAnchor = `<a id="${skillAnchorId(skill.id)}"></a>`;
      if (!text.includes(skillAnchor)) {
        text = `${skillAnchor}\n${text}`;
      }
      artifacts.set(skillPath, ensureTrailingNewline(text));
    }
  }

  const budgetReport = {
    atlas: estimateBudget(artifacts.get(atlasPath) ?? ''),
    modules: Object.fromEntries(
      modules.map((module) => {
        const routerPath = moduleRouterDistPath(host, module.id);
        return [module.id, estimateBudget(artifacts.get(routerPath) ?? '')];
      }),
    ),
  };

  return { artifacts, diagnostics, budgetReport };
}

export function writeArtifacts(repoRoot, artifacts) {
  const written = [];
  const sorted = [...artifacts.entries()].sort(([left], [right]) => left.localeCompare(right));

  // 1) Preflight every host dist root from repo trust root (lstat ancestors, never follow).
  const trustByHost = new Map();
  for (const hostDistRelative of collectHostDistRoots(artifacts)) {
    const host = hostIdFromDistRelative(hostDistRelative);
    if (!host) {
      throw new Error(`SKG-COMPILE-PATH-UNSCOPED: ${hostDistRelative}`);
    }
    const trust = resolveTrustedHostDist(repoRoot, host);
    trustByHost.set(host, trust);
  }

  // 2) Preflight managed knowledge roots + every expected artifact ancestor.
  // Knowledge leaves may currently sit behind a managed-root/modules symlink; those
  // are replaced via sibling temp and must not be traversed here.
  for (const managedRoot of collectManagedRoots(artifacts)) {
    const host = hostIdFromDistRelative(managedRoot);
    const trust = trustByHost.get(host);
    if (!trust) {
      throw new Error(`SKG-COMPILE-MANAGED-HOST: missing trust for ${managedRoot}`);
    }
    const managedAbsolute = path.join(repoRoot, managedRoot);
    assertPathInsideTrustedHostDist(path.dirname(managedAbsolute), trust);
    const managedStat = lstatOrNull(managedAbsolute);
    if (managedStat && !managedStat.isSymbolicLink() && !managedStat.isDirectory()) {
      throw new Error(`SKG-COMPILE-MANAGED-NOT-DIR: ${managedAbsolute}`);
    }
  }
  for (const [relative] of sorted) {
    if (knowledgeManagedRoot(relative)) continue;
    const host = hostIdFromDistRelative(relative);
    if (!host) {
      throw new Error(`SKG-COMPILE-PATH-UNSCOPED: ${relative}`);
    }
    const trust = trustByHost.get(host);
    const absolute = path.join(repoRoot, relative);
    assertPathInsideTrustedHostDist(path.dirname(absolute), trust);
  }

  // 3) Exact-managed knowledge trees: sibling temp → verify → safe rename replace.
  for (const managedRoot of collectManagedRoots(artifacts)) {
    const host = hostIdFromDistRelative(managedRoot);
    const trust = trustByHost.get(host);
    replaceManagedKnowledgeTree(repoRoot, managedRoot, artifacts, trust);
    for (const [relative, contents] of sorted) {
      if (relative === managedRoot || relative.startsWith(`${managedRoot}/`)) {
        written.push({
          path: relative,
          bytes: Buffer.byteLength(ensureTrailingNewline(contents), 'utf8'),
        });
      }
    }
  }

  // 4) Non-knowledge expected artifacts (entry pins, skill nav): ancestor preflight + no-follow write.
  for (const [relative, contents] of sorted) {
    if (knowledgeManagedRoot(relative)) continue;
    const host = hostIdFromDistRelative(relative);
    const trust = trustByHost.get(host);
    const absolute = path.join(repoRoot, relative);
    assertPathInsideTrustedHostDist(path.dirname(absolute), trust);
    // If the leaf itself is a symlink, unlink the node before writing (never follow).
    const leafStat = lstatOrNull(absolute);
    if (leafStat?.isSymbolicLink()) {
      fs.unlinkSync(absolute);
    }
    writeFileAtomicNoFollow(absolute, ensureTrailingNewline(contents), trust);
    written.push({
      path: relative,
      bytes: Buffer.byteLength(ensureTrailingNewline(contents), 'utf8'),
    });
  }

  return written.sort((left, right) => left.path.localeCompare(right.path));
}

export function diffArtifacts(repoRoot, artifacts) {
  const drift = [];
  for (const [relative, contents] of [...artifacts.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const absolute = path.join(repoRoot, relative);
    const stat = lstatOrNull(absolute);
    if (!stat) {
      drift.push({ path: relative, kind: 'missing' });
      continue;
    }
    if (stat.isSymbolicLink()) {
      drift.push({ path: relative, kind: 'extra', entry_kind: 'symlink' });
      continue;
    }
    const existing = fs.readFileSync(absolute, 'utf8');
    if (existing !== ensureTrailingNewline(contents)) {
      drift.push({ path: relative, kind: 'changed' });
    }
  }

  for (const managedRoot of collectManagedRoots(artifacts)) {
    const managedAbsolute = path.join(repoRoot, managedRoot);
    const expected = new Set(
      [...artifacts.keys()]
        .filter((item) => item === managedRoot || item.startsWith(`${managedRoot}/`))
        .map((item) => (item === managedRoot ? '' : item.slice(managedRoot.length + 1))),
    );
    for (const entry of enumerateManagedTree(managedAbsolute)) {
      const fullPath = entry.path ? `${managedRoot}/${entry.path}` : managedRoot;
      if (entry.kind === 'symlink' || entry.kind === 'escape') {
        drift.push({ path: fullPath, kind: 'extra', entry_kind: entry.kind });
        continue;
      }
      if (entry.kind === 'file' && !expected.has(entry.path)) {
        drift.push({ path: fullPath, kind: 'extra' });
      }
    }
  }

  return drift;
}

export { NAV_END, ENTRY_PIN_START, ENTRY_PIN_END };
