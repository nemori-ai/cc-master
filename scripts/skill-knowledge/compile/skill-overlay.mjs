/**
 * Compiler-owned skill / entry overlay helper.
 *
 * Pure, deterministic strip + apply / expected-bytes builders shared by:
 * - full host compile (emit.mjs)
 * - provider-guidance updater (final runtime skill tree fingerprint)
 * - sync staging (assert-before-publish)
 * - cross-harness identity tests (two-layer fail-closed)
 *
 * Never reverse-engineer overlays from checked-in dist. Never silently swallow
 * malformed / extra / duplicate / plan-mismatched compiler-owned markers.
 * Graph unavailable/invalid is always a hard error (never success+skipped).
 */

import fs from 'node:fs';
import path from 'node:path';
import { normalizePointAnchor } from '../host-portability/anchors.mjs';
import {
  atlasDistPath,
  canonicalBindingToDistPath,
  entrySurfaceToDistPath,
  moduleAnchorId,
  moduleRouterDistPath,
  posixRelative,
  PRODUCT_HOSTS,
  skillAnchorId,
} from './paths.mjs';

export const NAV_END = '<!-- ccm:k:nav:end -->';
export const ENTRY_PIN_START = '<!-- ccm:k:entry-pin:start -->';
export const ENTRY_PIN_END = '<!-- ccm:k:entry-pin:end -->';
export const PRODUCT_HOST_SET = new Set(PRODUCT_HOSTS);

const POINT_ANCHOR_LINE_RE = /^<a id="(ccm-k-point-[a-z0-9-]+)"><\/a>\s*$/;
const SKILL_ANCHOR_LINE_RE = /^<a id="(ccm-k-skill-[a-z0-9-]+)"><\/a>\s*$/;
const NAV_START_RE =
  /<!--\s*ccm:k:nav:start(?:\s+(point:[a-z0-9][a-z0-9.-]*))?\s*-->/g;
const NAV_BLOCK_RE =
  /<!--\s*ccm:k:nav:start(?:\s+(point:[a-z0-9][a-z0-9.-]*))?\s*-->[\s\S]*?<!--\s*ccm:k:nav:end\s*-->\n*/g;
const MALFORMED_NAV_OPEN_RE =
  /<!--\s*ccm:k:nav:start\s+point:[a-z0-9][a-z0-9.-]*\s*\n/;
const ENTRY_PIN_BLOCK_RE = new RegExp(
  `${ENTRY_PIN_START}[\\s\\S]*?${ENTRY_PIN_END}\\n*`,
  'g',
);
const SAFE_SKILL_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Relative-to-repo controlled staging namespaces (posix). */
export const CONTROLLED_STAGING_REL_RES = Object.freeze([
  /^plugin\/dist\/[a-z0-9-]+\/skills\.write-[^/]+$/,
  // Whole-host staging sibling under plugin/dist (K1-06 v9).
  /^plugin\/dist\/[a-z0-9-]+\.write-[^/]+$/,
  /^\.tmp\/ccm-provider-guidance-[^/]+$/,
  /^\.tmp\/ccm-pacing-read-only-[^/]+$/,
]);

export class SkillOverlayError extends Error {
  constructor(code, message, witness = {}) {
    super(`${code}: ${message}`);
    this.name = 'SkillOverlayError';
    this.code = code;
    this.witness = witness;
  }
}

export function ensureTrailingNewline(text) {
  return `${String(text).replace(/\n+$/u, '')}\n`;
}

function linkLine(label, fromFile, toFile, fragment) {
  const relative = posixRelative(fromFile, toFile);
  return `- [${label}](${relative}${fragment})`;
}

function pointDistPath(host, point) {
  return canonicalBindingToDistPath(host, point.binding.path);
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

function tryRealpath(target) {
  try {
    return fs.realpathSync(target);
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

/**
 * Inspect compiler-owned overlay markers. Does not mutate text.
 * Fail-closed callers treat any issue as hard error (no silent swallow).
 */
export function inspectCompilerOwnedOverlay(text) {
  const source = String(text ?? '');
  const issues = [];

  if (MALFORMED_NAV_OPEN_RE.test(source)) {
    issues.push({
      kind: 'malformed_nav_open',
      message: 'malformed ccm:k:nav:start comment (missing -->)',
    });
  }

  const navStarts = [...source.matchAll(NAV_START_RE)];
  const navEnds = [...source.matchAll(/<!--\s*ccm:k:nav:end\s*-->/g)];
  const navBlocks = [...source.matchAll(NAV_BLOCK_RE)];
  if (navStarts.length !== navBlocks.length || navEnds.length !== navBlocks.length) {
    issues.push({
      kind: 'malformed_nav_pair',
      message: 'nav start/end markers are unpaired or nested incorrectly',
      witness: {
        starts: navStarts.length,
        ends: navEnds.length,
        blocks: navBlocks.length,
      },
    });
  }

  const navPoints = [];
  for (const match of navBlocks) {
    const pointId = match[1] ?? null;
    navPoints.push(pointId);
  }
  const seenNav = new Set();
  for (const pointId of navPoints) {
    const key = pointId ?? '(anonymous)';
    if (seenNav.has(key)) {
      issues.push({
        kind: 'duplicate_nav',
        message: `duplicate ccm:k:nav block for ${key}`,
        witness: { point: pointId },
      });
    }
    seenNav.add(key);
  }

  const entryStarts = [
    ...source.matchAll(/<!--\s*ccm:k:entry-pin:start\s*-->/g),
  ];
  const entryEnds = [...source.matchAll(/<!--\s*ccm:k:entry-pin:end\s*-->/g)];
  const entryBlocks = [...source.matchAll(ENTRY_PIN_BLOCK_RE)];
  if (
    entryStarts.length !== entryBlocks.length ||
    entryEnds.length !== entryBlocks.length
  ) {
    issues.push({
      kind: 'malformed_entry_pin_pair',
      message: 'entry-pin start/end markers are unpaired or nested incorrectly',
      witness: {
        starts: entryStarts.length,
        ends: entryEnds.length,
        blocks: entryBlocks.length,
      },
    });
  }
  if (entryBlocks.length > 1) {
    issues.push({
      kind: 'duplicate_entry_pin',
      message: 'duplicate ccm:k:entry-pin blocks',
      witness: { count: entryBlocks.length },
    });
  }

  const lines = source.split('\n');
  let skillAnchorCount = 0;
  let pointAnchorCount = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const skillMatch = line.match(SKILL_ANCHOR_LINE_RE);
    if (skillMatch) {
      skillAnchorCount += 1;
      if (index !== 0) {
        issues.push({
          kind: 'extra_skill_anchor',
          message: 'ccm-k-skill anchor must be the first line when present',
          witness: { line: index + 1 },
        });
      }
    }
    const pointMatch = line.match(POINT_ANCHOR_LINE_RE);
    if (pointMatch) {
      pointAnchorCount += 1;
      const nextLine = lines[index + 1] ?? '';
      const startMatch = nextLine.match(/<!--\s*ccm:k:start\s+(point:[a-z0-9][a-z0-9.-]*)\s*-->/);
      if (!startMatch) {
        issues.push({
          kind: 'extra_point_anchor',
          message: 'point anchor is not immediately before a ccm:k:start marker',
          witness: { line: index + 1 },
        });
      } else {
        const expected = normalizePointAnchor(startMatch[1]);
        if (pointMatch[1] !== expected.html_id) {
          issues.push({
            kind: 'point_anchor_id_mismatch',
            message: `point anchor id ${pointMatch[1]} does not match start ${startMatch[1]}`,
            witness: { line: index + 1, anchor: pointMatch[1], point: startMatch[1] },
          });
        }
      }
    }
  }
  if (skillAnchorCount > 1) {
    issues.push({
      kind: 'duplicate_skill_anchor',
      message: 'duplicate ccm-k-skill anchors',
      witness: { count: skillAnchorCount },
    });
  }

  let remainder = source.replace(NAV_BLOCK_RE, '').replace(ENTRY_PIN_BLOCK_RE, '');
  if (/ccm:k:nav:/.test(remainder) || /ccm:k:entry-pin:/.test(remainder)) {
    issues.push({
      kind: 'extra_overlay_token',
      message: 'leftover ccm:k nav/entry-pin tokens after stripping well-formed blocks',
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    nav_blocks: navBlocks.length,
    entry_pin_blocks: entryBlocks.length,
    skill_anchors: skillAnchorCount,
    point_anchors: pointAnchorCount,
    has_overlay:
      navBlocks.length > 0 ||
      entryBlocks.length > 0 ||
      skillAnchorCount > 0 ||
      pointAnchorCount > 0,
    nav_point_ids: navPoints.filter(Boolean),
  };
}

/**
 * Strip compiler-owned overlays. Always fail-closed on malformed / extra / duplicate markers.
 */
export function stripCompilerOwnedOverlay(text) {
  const source = String(text ?? '');
  const inspection = inspectCompilerOwnedOverlay(source);
  if (!inspection.ok) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-MALFORMED',
      inspection.issues.map((item) => item.message).join('; '),
      { issues: inspection.issues },
    );
  }

  let next = source.replace(NAV_BLOCK_RE, '');
  next = next.replace(ENTRY_PIN_BLOCK_RE, '');

  const lines = next.split('\n');
  const cleaned = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1] ?? '';
    if (POINT_ANCHOR_LINE_RE.test(line) && /<!--\s*ccm:k:start\s+point:/.test(nextLine)) {
      continue;
    }
    if (index === 0 && SKILL_ANCHOR_LINE_RE.test(line)) {
      continue;
    }
    cleaned.push(line);
  }
  return cleaned.join('\n');
}

export function buildPointNavBlock({ point, host, graph, fromFile }) {
  const atlasPath = atlasDistPath(host);
  const pointById = new Map((graph.points ?? []).map((item) => [item.id, item]));
  const navLines = [
    `<!-- ccm:k:nav:start ${point.id} -->`,
    'Knowledge navigation:',
  ];
  navLines.push(linkLine('Knowledge atlas', fromFile, atlasPath, ''));
  const moduleId = point.module_id;
  if (moduleId) {
    const routerPath = moduleRouterDistPath(host, moduleId);
    navLines.push(
      linkLine(`Module ${moduleId}`, fromFile, routerPath, `#${moduleAnchorId(moduleId)}`),
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
          fromFile,
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
        fromFile,
        target,
        targetAnchor.fragment,
      ),
    );
  }
  navLines.push(NAV_END);
  return `${navLines.join('\n')}\n`;
}

function rebuildPointOverlaysFromBase({
  baseText,
  host,
  graph,
  distRel,
  pointsForFile,
  skillId = null,
}) {
  let next = baseText;
  const filePoints = [...pointsForFile].sort((a, b) => a.id.localeCompare(b.id));
  for (const point of filePoints) {
    const anchor = normalizePointAnchor(point.id);
    const startMarker = `<!-- ccm:k:start ${point.id} -->`;
    const endMarker = `<!-- ccm:k:end ${point.id} -->`;
    if (!next.includes(startMarker) || !next.includes(endMarker)) {
      throw new SkillOverlayError(
        'SKG-OVERLAY-MARKER-MISSING',
        `Projected Markdown missing markers for ${point.id}`,
        { host, point: point.id, distRel },
      );
    }
    next = next.replace(startMarker, `${anchor.html}\n${startMarker}`);
    const navBlock = buildPointNavBlock({ point, host, graph, fromFile: distRel });
    next = next.replace(
      new RegExp(`${endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n*`),
      `${endMarker}\n${navBlock}`,
    );
  }
  if (skillId) {
    next = applySkillLevelAnchor({ text: next, skillId });
  }
  return ensureTrailingNewline(next);
}

/**
 * Apply point anchors + nav (+ optional skill anchor) with strict plan matching.
 * Raw staging (no overlay markers) may receive a fresh plan. Existing overlays
 * must already equal the current plan; otherwise hard-fail (never silent strip).
 */
export function applyPointOverlaysToSkillMarkdown({
  text,
  host,
  graph,
  distRel,
  pointsForFile,
  skillId = null,
}) {
  const source = ensureTrailingNewline(text);
  const inspection = inspectCompilerOwnedOverlay(source);
  if (!inspection.ok) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-MALFORMED',
      inspection.issues.map((item) => item.message).join('; '),
      { issues: inspection.issues, host, distRel },
    );
  }

  const allowed = new Set([...pointsForFile].map((point) => point.id));
  for (const pointId of inspection.nav_point_ids) {
    if (!allowed.has(pointId)) {
      throw new SkillOverlayError(
        'SKG-OVERLAY-UNKNOWN-NAV',
        `nav block for ${pointId} is not in the current allowed point set`,
        { host, distRel, point: pointId, allowed: [...allowed].sort() },
      );
    }
  }

  const base = stripCompilerOwnedOverlay(source);
  const expected = rebuildPointOverlaysFromBase({
    baseText: base,
    host,
    graph,
    distRel,
    pointsForFile,
    skillId,
  });

  if (inspection.has_overlay && source !== expected) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-PLAN-MISMATCH',
      `existing compiler-owned overlay does not equal current plan for ${distRel}`,
      { host, distRel },
    );
  }
  return expected;
}

export function buildEntryPinBlock({ host, entry, graph, distRel }) {
  const pointById = new Map((graph.points ?? []).map((item) => [item.id, item]));
  const modules = [...(graph.modules ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  const surface = (entry.surfaces ?? []).find((item) => item.host === host);
  if (!surface) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-ENTRY-SURFACE',
      `No entry surface for ${entry.id} on ${host}`,
      { entry: entry.id, host },
    );
  }
  const pinLines = [ENTRY_PIN_START, `Knowledge entry pins for ${entry.id}:`];
  for (const target of surface.targets ?? []) {
    const point = pointById.get(target.point);
    if (!point) continue;
    const targetPath = pointDistPath(host, point);
    const anchor = normalizePointAnchor(point.id);
    pinLines.push(linkLine(point.title || point.id, distRel, targetPath, anchor.fragment));
  }
  for (const module of modules) {
    if (!(module.access?.relevant_entries ?? []).includes(entry.id)) continue;
    const routerPath = moduleRouterDistPath(host, module.id);
    pinLines.push(
      linkLine(`Module ${module.id}`, distRel, routerPath, `#${moduleAnchorId(module.id)}`),
    );
    for (const primaryId of module.access.primary_points ?? []) {
      if ((surface.targets ?? []).some((item) => item.point === primaryId)) continue;
      const point = pointById.get(primaryId);
      if (!point) continue;
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
  return `${pinLines.join('\n')}\n`;
}

export function applyEntryPinOverlay({ text, host, entry, graph, distRel }) {
  const source = ensureTrailingNewline(text);
  const inspection = inspectCompilerOwnedOverlay(source);
  if (!inspection.ok) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-MALFORMED',
      inspection.issues.map((item) => item.message).join('; '),
      { issues: inspection.issues, host, distRel },
    );
  }
  const base = stripCompilerOwnedOverlay(source);
  const pinBlock = buildEntryPinBlock({ host, entry, graph, distRel });
  const expected = ensureTrailingNewline(`${ensureTrailingNewline(base)}${pinBlock.trimEnd()}\n`);
  if (inspection.has_overlay && source !== expected) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-PLAN-MISMATCH',
      `existing entry-pin overlay does not equal current plan for ${distRel}`,
      { host, distRel, entry: entry.id },
    );
  }
  return expected;
}

export function applySkillLevelAnchor({ text, skillId }) {
  const skillAnchor = `<a id="${skillAnchorId(skillId)}"></a>`;
  let next = String(text ?? '');
  const lines = next.split('\n');
  if (lines.length > 0 && SKILL_ANCHOR_LINE_RE.test(lines[0])) {
    lines.shift();
    next = lines.join('\n');
  }
  if (!next.includes(skillAnchor)) {
    next = `${skillAnchor}\n${next}`;
  }
  return ensureTrailingNewline(next);
}

export function buildExpectedSkillFileBytes({
  rawText,
  host,
  graph,
  distRel,
  skillId = null,
}) {
  const points = (graph.points ?? []).filter(
    (point) => pointDistPath(host, point) === distRel,
  );
  return applyPointOverlaysToSkillMarkdown({
    text: rawText,
    host,
    graph,
    distRel,
    pointsForFile: points,
    skillId:
      skillId &&
      distRel === `plugin/dist/${host}/skills/${skillId.replace(/^skill:/, '')}/SKILL.md`
        ? skillId
        : null,
  });
}

export function buildExpectedEntrySurfaceBytes({
  rawText,
  host,
  graph,
  sourceFile,
}) {
  const distRel = entrySurfaceToDistPath(host, sourceFile);
  if (!distRel) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-ENTRY-PATH',
      `Cannot map entry surface ${sourceFile} for ${host}`,
      { host, sourceFile },
    );
  }
  const entry = (graph.entries ?? []).find((item) =>
    (item.surfaces ?? []).some(
      (surface) => surface.host === host && surface.source_file === sourceFile,
    ),
  );
  if (!entry) {
    return ensureTrailingNewline(stripCompilerOwnedOverlay(rawText));
  }
  return applyEntryPinOverlay({
    text: rawText,
    host,
    entry,
    graph,
    distRel,
  });
}

export function assertSafeSkillSlug(skillName) {
  const value = String(skillName ?? '');
  if (!SAFE_SKILL_SLUG_RE.test(value)) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-SKILL-UNSAFE',
      `refusing unsafe skill slug ${JSON.stringify(skillName)}`,
      { skill: skillName },
    );
  }
  return value;
}

export function assertSafeOverlayHost(host) {
  const value = String(host ?? '');
  if (!PRODUCT_HOST_SET.has(value)) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-HOST-UNKNOWN',
      `host is outside the frozen C9 set: ${value}`,
      { host: value, allowed: [...PRODUCT_HOST_SET].sort() },
    );
  }
  return value;
}

/**
 * Open flags: prefer O_EXCL|O_NOFOLLOW when available; fall back to O_EXCL alone.
 */
function openWriteFlags() {
  const { O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW } = fs.constants;
  let flags = O_WRONLY | O_CREAT | O_EXCL;
  if (typeof O_NOFOLLOW === 'number') flags |= O_NOFOLLOW;
  return flags;
}

function openReadFlagsNoFollow() {
  const { O_RDONLY, O_NOFOLLOW } = fs.constants;
  if (typeof O_NOFOLLOW !== 'number') {
    throw new SkillOverlayError(
      'SKG-OVERLAY-NOFOLLOW-UNAVAILABLE',
      'O_NOFOLLOW is unavailable on this platform; refusing unsafe path-based read',
    );
  }
  return O_RDONLY | O_NOFOLLOW;
}

/**
 * Safe regular-file read: open(O_RDONLY|O_NOFOLLOW) → fstat regular → read fd → close.
 * Never lstat-then-readFileSync(path) (TOCTOU / symlink follow).
 */
export function readFileNoFollowContained(absolutePath, containmentRoot = null) {
  const absolute = path.resolve(absolutePath);
  if (containmentRoot) {
    const root = path.resolve(containmentRoot);
    if (!isInsideRoot(absolute, root)) {
      throw new SkillOverlayError(
        'SKG-OVERLAY-READ-ESCAPE',
        `refusing read outside containment root: ${absolute}`,
        { absolute, root },
      );
    }
  }
  const before = lstatOrNull(absolute);
  if (before?.isSymbolicLink()) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-LEAF-SYMLINK',
      `refusing to read through leaf symlink: ${absolute}`,
      { absolute },
    );
  }
  let fd;
  try {
    fd = fs.openSync(absolute, openReadFlagsNoFollow());
  } catch (error) {
    if (error && (error.code === 'ELOOP' || /symbolic link/i.test(String(error.message)))) {
      throw new SkillOverlayError(
        'SKG-OVERLAY-LEAF-SYMLINK',
        `O_NOFOLLOW refused symlink leaf: ${absolute}`,
        { absolute, cause: String(error.message) },
      );
    }
    throw error;
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) {
      throw new SkillOverlayError(
        'SKG-OVERLAY-LEAF-NOT-FILE',
        `refusing non-regular leaf read: ${absolute}`,
        { absolute },
      );
    }
    const bytes = fs.readFileSync(fd, 'utf8');
    const after = lstatOrNull(absolute);
    if (
      before &&
      after &&
      (before.ino !== after.ino || before.dev !== after.dev || after.isSymbolicLink())
    ) {
      throw new SkillOverlayError(
        'SKG-OVERLAY-READ-IDENTITY',
        `leaf identity changed during read: ${absolute}`,
        { absolute },
      );
    }
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

export function isControlledStagingRel(relPosix) {
  const rel = String(relPosix ?? '').replace(/\\/g, '/');
  return CONTROLLED_STAGING_REL_RES.some((pattern) => pattern.test(rel));
}

/**
 * Layered containment: real stagingRoot strictly inside real repoRoot under a
 * controlled staging namespace; every repo→staging ancestor is a real dir (no symlink);
 * skillTree realpath contained in staging; leaves checked separately.
 */
export function assertControlledStagingContainment({
  repoRootAbsolute,
  stagingRootAbsolute,
  skillTreeAbsolute = null,
}) {
  const repoAbsolute = path.resolve(repoRootAbsolute);
  const stagingAbsolute = path.resolve(stagingRootAbsolute);

  const repoStat = lstatOrNull(repoAbsolute);
  if (!repoStat || repoStat.isSymbolicLink() || !repoStat.isDirectory()) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-REPO-INVALID',
      `repo-root must be a real directory (no symlink): ${repoAbsolute}`,
      { repoRoot: repoAbsolute },
    );
  }
  const repoReal = tryRealpath(repoAbsolute);
  if (!repoReal) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-REPO-REALPATH',
      `repo-root realpath unavailable: ${repoAbsolute}`,
    );
  }

  const stagingStat = lstatOrNull(stagingAbsolute);
  if (!stagingStat || stagingStat.isSymbolicLink() || !stagingStat.isDirectory()) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-STAGING-INVALID',
      `staging-root must be a real directory (no symlink): ${stagingAbsolute}`,
      { stagingRoot: stagingAbsolute },
    );
  }
  const stagingReal = tryRealpath(stagingAbsolute);
  if (!stagingReal) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-STAGING-REALPATH',
      `staging-root realpath unavailable: ${stagingAbsolute}`,
    );
  }
  if (!isInsideRoot(stagingReal, repoReal)) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-STAGING-OUTSIDE-REPO',
      `staging-root realpath must be inside repo-root: ${stagingReal}`,
      { stagingReal, repoReal },
    );
  }

  const relPosix = path.relative(repoReal, stagingReal).split(path.sep).join('/');
  if (!isControlledStagingRel(relPosix)) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-STAGING-NAMESPACE',
      `staging-root is outside controlled staging namespaces: ${relPosix}`,
      {
        rel: relPosix,
        allowed: [
          'plugin/dist/<host>/skills.write-*',
          'plugin/dist/<host>.write-*',
          '.tmp/ccm-provider-guidance-*',
          '.tmp/ccm-pacing-read-only-*',
        ],
      },
    );
  }

  // Walk every ancestor from repo → staging with lstat (no symlink).
  const relParts = path.relative(repoAbsolute, stagingAbsolute).split(path.sep).filter(Boolean);
  let cursor = repoAbsolute;
  for (const part of relParts) {
    cursor = path.join(cursor, part);
    const st = lstatOrNull(cursor);
    if (!st || st.isSymbolicLink()) {
      throw new SkillOverlayError(
        'SKG-OVERLAY-ANCESTOR-SYMLINK',
        `refusing symlink ancestor on repo→staging path: ${cursor}`,
        { ancestor: cursor },
      );
    }
    if (!st.isDirectory()) {
      throw new SkillOverlayError(
        'SKG-OVERLAY-ANCESTOR-NOT-DIR',
        `ancestor is not a directory: ${cursor}`,
        { ancestor: cursor },
      );
    }
  }

  if (skillTreeAbsolute) {
    assertSkillTreeNoSymlinks(skillTreeAbsolute, stagingAbsolute);
  }

  return {
    repoAbsolute,
    repoReal,
    stagingAbsolute,
    stagingReal,
    relPosix,
  };
}

export function writeFileAtomicNoFollowContained(absolutePath, contents, containmentRoot) {
  const absolute = path.resolve(absolutePath);
  const root = path.resolve(containmentRoot);
  if (!isInsideRoot(absolute, root)) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-WRITE-ESCAPE',
      `refusing write outside staging root: ${absolute}`,
      { absolute, root },
    );
  }
  const parent = path.dirname(absolute);
  const parentStat = lstatOrNull(parent);
  if (!parentStat || parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-PARENT-INVALID',
      `parent is not a real directory: ${parent}`,
      { parent },
    );
  }
  const leafStat = lstatOrNull(absolute);
  if (leafStat?.isSymbolicLink()) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-LEAF-SYMLINK',
      `refusing to write through leaf symlink: ${absolute}`,
      { absolute },
    );
  }
  if (leafStat && !leafStat.isFile()) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-LEAF-NOT-FILE',
      `refusing non-regular leaf: ${absolute}`,
      { absolute },
    );
  }

  const temp = `${absolute}.tmp-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
  if (!isInsideRoot(temp, root)) {
    throw new SkillOverlayError('SKG-OVERLAY-TEMP-ESCAPE', `temp escapes root: ${temp}`);
  }
  let fd;
  try {
    fd = fs.openSync(temp, openWriteFlags(), 0o644);
    fs.writeFileSync(fd, contents, 'utf8');
    fs.fsyncSync(fd);
  } catch (error) {
    try {
      if (lstatOrNull(temp)) fs.unlinkSync(temp);
    } catch {
      // ignore cleanup
    }
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  const written = readFileNoFollowContained(temp, root);
  if (written !== contents) {
    fs.unlinkSync(temp);
    throw new SkillOverlayError(
      'SKG-OVERLAY-WRITE-VERIFY',
      `content mismatch after write for ${absolute}`,
    );
  }
  fs.renameSync(temp, absolute);
  const dirFd = fs.openSync(parent, 'r');
  try {
    fs.fsyncSync(dirFd);
  } finally {
    fs.closeSync(dirFd);
  }
}

/**
 * Walk skill tree with lstat only; reject any symlink / non-dir / non-regular leaf.
 */
export function assertSkillTreeNoSymlinks(skillTreeAbsolute, stagingRootAbsolute) {
  const tree = path.resolve(skillTreeAbsolute);
  const staging = path.resolve(stagingRootAbsolute);
  if (!isInsideRoot(tree, staging)) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-TREE-ESCAPE',
      `skill tree escapes staging root: ${tree}`,
      { tree, staging },
    );
  }
  const treeStat = lstatOrNull(tree);
  if (!treeStat || treeStat.isSymbolicLink() || !treeStat.isDirectory()) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-TREE-INVALID',
      `skill tree must be a real directory (no symlink): ${tree}`,
      { tree },
    );
  }
  const treeReal = tryRealpath(tree);
  const stagingReal = tryRealpath(staging);
  if (!treeReal || !stagingReal || !isInsideRoot(treeReal, stagingReal)) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-TREE-REALPATH',
      `skill tree realpath escapes staging: ${tree}`,
      { tree, staging },
    );
  }

  const visit = (directory) => {
    for (const dirent of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, dirent.name);
      if (dirent.isSymbolicLink()) {
        throw new SkillOverlayError(
          'SKG-OVERLAY-SYMLINK',
          `refusing symlink in skill tree: ${absolute}`,
          { absolute },
        );
      }
      if (dirent.isDirectory()) {
        const stat = lstatOrNull(absolute);
        if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
          throw new SkillOverlayError(
            'SKG-OVERLAY-DIR-INVALID',
            `invalid directory node: ${absolute}`,
          );
        }
        const real = tryRealpath(absolute);
        if (!real || !isInsideRoot(real, stagingReal)) {
          throw new SkillOverlayError(
            'SKG-OVERLAY-DIR-ESCAPE',
            `directory realpath escapes staging: ${absolute}`,
          );
        }
        visit(absolute);
        continue;
      }
      if (dirent.isFile()) {
        const stat = lstatOrNull(absolute);
        if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
          throw new SkillOverlayError(
            'SKG-OVERLAY-LEAF-INVALID',
            `non-regular leaf: ${absolute}`,
          );
        }
        continue;
      }
      throw new SkillOverlayError(
        'SKG-OVERLAY-NODE-TYPE',
        `unsupported filesystem node: ${absolute}`,
      );
    }
  };
  visit(tree);
}

/**
 * Apply compiler-owned skill overlays to an on-disk skill tree (staging or scratch).
 * When stagingRootAbsolute is provided, enforces no-follow containment + atomic writes.
 */
export function applyFinalSkillOverlaysToTree({
  repoRoot,
  host,
  graph,
  skillTreeAbsolute,
  skillName,
  stagingRootAbsolute = null,
}) {
  const safeHost = assertSafeOverlayHost(host);
  const safeSkill = assertSafeSkillSlug(skillName);
  if (stagingRootAbsolute) {
    assertControlledStagingContainment({
      repoRootAbsolute: repoRoot,
      stagingRootAbsolute,
      skillTreeAbsolute,
    });
  }

  const skillId = `skill:${safeSkill}`;
  const points = (graph.points ?? []).filter((point) => {
    const distRel = pointDistPath(safeHost, point);
    return distRel && distRel.startsWith(`plugin/dist/${safeHost}/skills/${safeSkill}/`);
  });
  const byDistRel = new Map();
  for (const point of points) {
    const distRel = pointDistPath(safeHost, point);
    if (!byDistRel.has(distRel)) byDistRel.set(distRel, []);
    byDistRel.get(distRel).push(point);
  }

  const skillInGraph = (graph.skills ?? []).some((item) => item.id === skillId);
  if (points.length === 0 && !skillInGraph) {
    // Deterministic no-op: validated graph, known canonical skill slug with no authored coverage.
    return {
      host: safeHost,
      skill: safeSkill,
      overlaid_files: [],
      noop: 'no-authored-coverage',
    };
  }

  for (const [distRel, filePoints] of [...byDistRel.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const relativeInside = distRel.slice(`plugin/dist/${safeHost}/skills/${safeSkill}/`.length);
    const absolute = path.join(skillTreeAbsolute, relativeInside);
    if (stagingRootAbsolute) {
      const leaf = lstatOrNull(absolute);
      if (!leaf || leaf.isSymbolicLink() || !leaf.isFile()) {
        throw new SkillOverlayError(
          'SKG-OVERLAY-DIST-MISSING',
          `Projected skill Markdown missing or not a regular file: ${absolute}`,
          { host: safeHost, skill: safeSkill, distRel },
        );
      }
    } else if (!fs.existsSync(absolute)) {
      throw new SkillOverlayError(
        'SKG-OVERLAY-DIST-MISSING',
        `Projected skill Markdown missing for overlay: ${absolute}`,
        { host: safeHost, skill: safeSkill, distRel },
      );
    }
    const raw = stagingRootAbsolute
      ? readFileNoFollowContained(absolute, stagingRootAbsolute)
      : fs.readFileSync(absolute, 'utf8');
    const finalBytes = applyPointOverlaysToSkillMarkdown({
      text: raw,
      host: safeHost,
      graph,
      distRel,
      pointsForFile: filePoints,
      skillId: relativeInside === 'SKILL.md' && skillInGraph ? skillId : null,
    });
    if (stagingRootAbsolute) {
      writeFileAtomicNoFollowContained(absolute, finalBytes, stagingRootAbsolute);
    } else {
      fs.writeFileSync(absolute, finalBytes);
    }
  }

  const skillMd = path.join(skillTreeAbsolute, 'SKILL.md');
  if (skillInGraph && (stagingRootAbsolute ? lstatOrNull(skillMd)?.isFile() : fs.existsSync(skillMd))) {
    if (stagingRootAbsolute && lstatOrNull(skillMd)?.isSymbolicLink()) {
      throw new SkillOverlayError(
        'SKG-OVERLAY-LEAF-SYMLINK',
        `refusing SKILL.md symlink: ${skillMd}`,
      );
    }
    // If SKILL.md was already handled via point bindings, re-read and ensure skill anchor only.
    if (![...byDistRel.keys()].some((item) => item.endsWith(`/${safeSkill}/SKILL.md`))) {
      const raw = stagingRootAbsolute
        ? readFileNoFollowContained(skillMd, stagingRootAbsolute)
        : fs.readFileSync(skillMd, 'utf8');
      const finalBytes = applySkillLevelAnchor({ text: raw, skillId });
      if (stagingRootAbsolute) {
        writeFileAtomicNoFollowContained(skillMd, finalBytes, stagingRootAbsolute);
      } else {
        fs.writeFileSync(skillMd, finalBytes);
      }
    }
  }

  return {
    host: safeHost,
    skill: safeSkill,
    overlaid_files: [...byDistRel.keys()].sort(),
  };
}

/**
 * Apply host entry-pin overlays whose projected targets live under skills/.
 * Used by --skills-only so Codex skill_entry pins land without full compile.
 * Command entry surfaces (Claude/Cursor/Kimi) are intentionally skipped here.
 */
export function applySkillsScopedEntryPins({
  repoRoot,
  host,
  graph,
  skillsTreeAbsolute,
  stagingRootAbsolute = null,
}) {
  const safeHost = assertSafeOverlayHost(host);
  if (stagingRootAbsolute) {
    assertControlledStagingContainment({
      repoRootAbsolute: repoRoot,
      stagingRootAbsolute,
      skillTreeAbsolute: skillsTreeAbsolute,
    });
  }

  const applied = [];
  for (const entry of graph.entries ?? []) {
    for (const surface of entry.surfaces ?? []) {
      if (surface.host !== safeHost) continue;
      const distRel = entrySurfaceToDistPath(safeHost, surface.source_file);
      if (!distRel) continue;
      const skillsPrefix = `plugin/dist/${safeHost}/skills/`;
      if (!distRel.startsWith(skillsPrefix)) continue;
      const relativeInside = distRel.slice(skillsPrefix.length);
      const absolute = path.join(skillsTreeAbsolute, relativeInside);
      if (stagingRootAbsolute) {
        const leaf = lstatOrNull(absolute);
        if (!leaf || leaf.isSymbolicLink() || !leaf.isFile()) {
          throw new SkillOverlayError(
            'SKG-OVERLAY-ENTRY-MISSING',
            `skills-scoped entry surface missing or not a regular file: ${absolute}`,
            { host: safeHost, entry: entry.id, distRel },
          );
        }
      } else if (!fs.existsSync(absolute)) {
        throw new SkillOverlayError(
          'SKG-OVERLAY-ENTRY-MISSING',
          `skills-scoped entry surface missing: ${absolute}`,
          { host: safeHost, entry: entry.id, distRel },
        );
      }
      const raw = stagingRootAbsolute
        ? readFileNoFollowContained(absolute, stagingRootAbsolute)
        : fs.readFileSync(absolute, 'utf8');
      const finalBytes = applyEntryPinOverlay({
        text: raw,
        host: safeHost,
        entry,
        graph,
        distRel,
      });
      if (stagingRootAbsolute) {
        writeFileAtomicNoFollowContained(absolute, finalBytes, stagingRootAbsolute);
      } else {
        fs.writeFileSync(absolute, finalBytes);
      }
      applied.push(distRel);
    }
  }
  return { host: safeHost, entry_pin_files: applied.sort() };
}

/**
 * Load graph + overlay one skill tree. Used by CJS sync/updater bridges.
 * Graph unavailable/invalid → hard throw (never success+skipped).
 * No authored coverage for a known skill on a validated graph → deterministic noop.
 */
export async function applyFinalSkillOverlaysForSkill({
  repoRoot,
  host,
  skillTreeAbsolute,
  skillName,
  stagingRootAbsolute = null,
  sourceRoot = 'plugin/src/knowledge',
}) {
  const safeHost = assertSafeOverlayHost(host);
  const safeSkill = assertSafeSkillSlug(skillName);
  const canonical = path.join(
    repoRoot,
    'plugin/src/skills',
    safeSkill,
    'canonical',
  );
  const canonicalStat = lstatOrNull(canonical);
  if (!canonicalStat || canonicalStat.isSymbolicLink() || !canonicalStat.isDirectory()) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-SKILL-UNKNOWN',
      `skill canonical source missing or not a real directory: ${canonical}`,
      { skill: safeSkill },
    );
  }

  const { buildAndValidateGraph } = await import('../graph.mjs');
  const built = buildAndValidateGraph({ repoRoot, sourceRoot });
  if (!built.graph || !built.ok) {
    throw new SkillOverlayError(
      'SKG-OVERLAY-GRAPH-UNAVAILABLE',
      'Cannot apply final skill overlays because the authored graph failed validation.',
      {
        diagnostics: (built.diagnostics ?? []).map((item) => item.code),
      },
    );
  }
  return applyFinalSkillOverlaysToTree({
    repoRoot,
    host: safeHost,
    graph: built.graph,
    skillTreeAbsolute,
    skillName: safeSkill,
    stagingRootAbsolute,
  });
}
