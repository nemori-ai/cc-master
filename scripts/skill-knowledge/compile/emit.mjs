import fs from 'node:fs';
import path from 'node:path';
import { normalizePointAnchor } from '../host-portability/anchors.mjs';
import { estimateBudget } from '../hash.mjs';
import {
  atlasDistPath,
  canonicalBindingToDistPath,
  entrySurfaceToDistPath,
  moduleAnchorId,
  moduleRouterDistPath,
  posixRelative,
} from './paths.mjs';
import {
  applyEntryPinOverlay,
  applyPointOverlaysToSkillMarkdown,
  applySkillLevelAnchor,
  ensureTrailingNewline,
  inspectCompilerOwnedOverlay,
  stripCompilerOwnedOverlay,
} from './skill-overlay.mjs';
import {
  assertSafeCompileHostId,
  isInsideRoot,
  lstatOrNull,
  resolveTrustedCandidateHostDist,
  resolveTrustedHostDist,
  tryRealpath,
} from './trusted-host-dist.mjs';

export {
  assertSafeCompileHostId,
  resolveTrustedCandidateHostDist,
  resolveTrustedHostDist,
};

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
 * Map a logical distRel (plugin/dist/<host>/...) to a physical absolute path.
 * When trust.hostDistAbsolute differs from the conventional live root, rewrite.
 */
export function resolveLogicalDistAbsolute(repoRoot, distRel, trust) {
  const host = hostIdFromDistRelative(distRel);
  if (!host) {
    throw new Error(`SKG-COMPILE-PATH-UNSCOPED: ${distRel}`);
  }
  if (!trust || trust.host !== host) {
    throw new Error(`SKG-COMPILE-TRUST-HOST-MISMATCH: ${distRel}`);
  }
  const prefix = `plugin/dist/${host}`;
  const normalized = String(distRel).split(path.sep).join('/');
  if (normalized !== prefix && !normalized.startsWith(`${prefix}/`)) {
    throw new Error(`SKG-COMPILE-PATH-UNSCOPED: ${distRel}`);
  }
  const underHost = normalized === prefix ? '' : normalized.slice(prefix.length + 1);
  return underHost
    ? path.join(trust.hostDistAbsolute, ...underHost.split('/'))
    : trust.hostDistAbsolute;
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
 *
 * Logical managedRootRelative stays `plugin/dist/<host>/knowledge`; physical
 * location is derived from trust.hostDistAbsolute (live or candidate staging).
 */
function replaceManagedKnowledgeTree(repoRoot, managedRootRelative, knowledgeArtifacts, trust) {
  const hostDistAbsolute = trust.hostDistAbsolute;
  const managedAbsolute = resolveLogicalDistAbsolute(repoRoot, managedRootRelative, trust);
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
 *
 * Optional `hostDistAbsolute` (candidate staging root) remaps physical reads while
 * logical artifact keys stay `plugin/dist/<host>/...` for link calculation.
 */
export function buildHostArtifacts({ host, graph, repoRoot, hostDistAbsolute = null }) {
  const artifacts = new Map();
  const diagnostics = [];
  const atlasPath = atlasDistPath(host);
  const modules = [...graph.modules].sort((a, b) => a.id.localeCompare(b.id));
  const points = [...graph.points].sort((a, b) => a.id.localeCompare(b.id));
  const pointById = new Map(points.map((point) => [point.id, point]));

  const trust = hostDistAbsolute
    ? {
        host,
        hostDistAbsolute: path.resolve(hostDistAbsolute),
      }
    : {
        host,
        hostDistAbsolute: path.join(path.resolve(repoRoot), 'plugin/dist', host),
      };

  const physicalFor = (distRel) => resolveLogicalDistAbsolute(repoRoot, distRel, trust);

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
    const absolute = physicalFor(distRel);
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
      // Keep existing bytes intact for strict plan-match (never lenient pre-strip).
      filesTouched.set(distRel, fs.readFileSync(absolute, 'utf8'));
    }
  }

  for (const [distRel, rawText] of filesTouched) {
    const filePoints = points.filter((point) => pointDistPath(host, point) === distRel);
    const skillName = distRel.match(
      new RegExp(`^plugin/dist/${host}/skills/([^/]+)/`),
    )?.[1];
    const skillId =
      skillName &&
      distRel === `plugin/dist/${host}/skills/${skillName}/SKILL.md` &&
      (graph.skills ?? []).some((item) => item.id === `skill:${skillName}`)
        ? `skill:${skillName}`
        : null;
    try {
      // Strict: existing overlays must equal current plan; raw staging may receive a fresh plan.
      inspectCompilerOwnedOverlay(rawText);
      artifacts.set(
        distRel,
        applyPointOverlaysToSkillMarkdown({
          text: rawText,
          host,
          graph,
          distRel,
          pointsForFile: filePoints,
          skillId,
        }),
      );
    } catch (error) {
      const code = error?.code;
      diagnostics.push({
        severity: 'error',
        code:
          code === 'SKG-OVERLAY-MARKER-MISSING'
            ? 'SKG-COMPILE-MARKER-MISSING'
            : code === 'SKG-OVERLAY-UNKNOWN-NAV' ||
                code === 'SKG-OVERLAY-PLAN-MISMATCH' ||
                code === 'SKG-OVERLAY-MALFORMED'
              ? 'SKG-COMPILE-SKILL-OVERLAY'
              : 'SKG-COMPILE-SKILL-OVERLAY',
        message: error instanceof Error ? error.message : String(error),
        location: distRel,
        witness: {
          host,
          error: error instanceof Error ? error.message : String(error),
          overlay_code: code ?? null,
        },
        remediation:
          'Refuse silent strip: restore raw SAP or exact current-plan overlays before compile.',
        exit_code: 5,
      });
    }
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
      const absolute = physicalFor(distRel);
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
      try {
        artifacts.set(
          distRel,
          applyEntryPinOverlay({
            text: fs.readFileSync(absolute, 'utf8'),
            host,
            entry,
            graph,
            distRel,
          }),
        );
      } catch (error) {
        diagnostics.push({
          severity: 'error',
          code: 'SKG-COMPILE-ENTRY-OVERLAY',
          message: error instanceof Error ? error.message : String(error),
          location: distRel,
          witness: { host, entry: entry.id },
          remediation: 'Fix malformed compiler-owned entry-pin overlays before compile.',
          exit_code: 5,
        });
      }
    }
  }

  // Skill-level anchor on SKILL.md for C9 skill pattern completeness.
  // When the skill file was already materialized above with skillId, skip.
  const skill = graph.skills[0];
  if (skill) {
    const skillPath = `plugin/dist/${host}/skills/${skill.id.replace(/^skill:/, '')}/SKILL.md`;
    if (!artifacts.has(skillPath) && fs.existsSync(physicalFor(skillPath))) {
      try {
        const raw = fs.readFileSync(physicalFor(skillPath), 'utf8');
        inspectCompilerOwnedOverlay(raw);
        const base = stripCompilerOwnedOverlay(raw);
        artifacts.set(skillPath, applySkillLevelAnchor({ text: base, skillId: skill.id }));
      } catch (error) {
        diagnostics.push({
          severity: 'error',
          code: 'SKG-COMPILE-SKILL-OVERLAY',
          message: error instanceof Error ? error.message : String(error),
          location: skillPath,
          witness: { host, skill: skill.id },
          remediation: 'Fix malformed compiler-owned skill overlays before compile.',
          exit_code: 5,
        });
      }
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

/**
 * Write compiled artifacts.
 *
 * Optional `candidateHostRoots`: map host id → absolute candidate host root
 * (whole-host staging). When set, physical writes go there; logical keys stay
 * `plugin/dist/<host>/...`. Public CLI omits this (live root only).
 *
 * Candidate roots must already have been entry-validated by runCompile via
 * resolveTrustedCandidateHostDist; this late path only re-asserts by calling
 * that same helper (single validator owner).
 */
export function writeArtifacts(repoRoot, artifacts, { candidateHostRoots = null } = {}) {
  const written = [];
  const sorted = [...artifacts.entries()].sort(([left], [right]) => left.localeCompare(right));

  // 1) Preflight every host dist root from repo trust root (lstat ancestors, never follow).
  const trustByHost = new Map();
  for (const hostDistRelative of collectHostDistRoots(artifacts)) {
    const host = hostIdFromDistRelative(hostDistRelative);
    if (!host) {
      throw new Error(`SKG-COMPILE-PATH-UNSCOPED: ${hostDistRelative}`);
    }
    const candidate = candidateHostRoots?.[host] ?? null;
    const trust = candidate
      ? resolveTrustedCandidateHostDist(repoRoot, host, candidate)
      : resolveTrustedHostDist(repoRoot, host);
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
    const managedAbsolute = resolveLogicalDistAbsolute(repoRoot, managedRoot, trust);
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
    const absolute = resolveLogicalDistAbsolute(repoRoot, relative, trust);
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
    const absolute = resolveLogicalDistAbsolute(repoRoot, relative, trust);
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

export function diffArtifacts(repoRoot, artifacts, { candidateHostRoots = null } = {}) {
  const drift = [];
  const trustByHost = new Map();
  for (const hostDistRelative of collectHostDistRoots(artifacts)) {
    const host = hostIdFromDistRelative(hostDistRelative);
    if (!host) continue;
    const candidate = candidateHostRoots?.[host] ?? null;
    trustByHost.set(
      host,
      candidate
        ? resolveTrustedCandidateHostDist(repoRoot, host, candidate)
        : resolveTrustedHostDist(repoRoot, host),
    );
  }

  for (const [relative, contents] of [...artifacts.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const host = hostIdFromDistRelative(relative);
    const trust = trustByHost.get(host);
    const absolute = trust
      ? resolveLogicalDistAbsolute(repoRoot, relative, trust)
      : path.join(repoRoot, relative);
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
    const host = hostIdFromDistRelative(managedRoot);
    const trust = trustByHost.get(host);
    const managedAbsolute = trust
      ? resolveLogicalDistAbsolute(repoRoot, managedRoot, trust)
      : path.join(repoRoot, managedRoot);
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

export {
  ENTRY_PIN_END,
  ENTRY_PIN_START,
  NAV_END,
} from './skill-overlay.mjs';
