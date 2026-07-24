/**
 * Candidate four-host runtime projection gate for change validate/apply.
 * Materializes an ignored runtime-candidate root (accepted ⊕ candidate overlay),
 * syncs each covered host with candidate-aware attestation, then verifies
 * (check-mode) without rewriting after sync already compiled.
 * Never touches live accepted bytes or live plugin/dist outside the ignored root.
 *
 * Sync failures never consume residual/partial dist: artifacts/budgets empty,
 * H1–H4 all ok:false + skipped. Structured sync diagnostics come from the CJS
 * API envelope — never greedy stdout/stderr JSON regex.
 */
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EXIT_CODES } from './contracts.mjs';
import { diagnostic } from './diagnostics.mjs';
import { runCompile } from './compile.mjs';
import { buildHostArtifacts, writeArtifacts } from './compile/emit.mjs';
import { PRODUCT_HOSTS, entrySurfaceToDistPath, canonicalBindingToDistPath } from './compile/paths.mjs';
import {
  countEnabledRuntimeEdges,
  verifyHopContracts,
} from './compile/surface-verifier.mjs';
import { stripCompilerOwnedOverlay } from './compile/skill-overlay.mjs';
import { estimateBudget } from './hash.mjs';
import { buildAndValidateGraph } from './graph.mjs';
import {
  projectCoverageSubgraph,
  resolveHostCoverageModes,
  resolveHostCoveragePlan,
} from './host-coverage.mjs';
import { normalizePointAnchor, inspectHtmlAnchorIds } from './host-portability/anchors.mjs';
import {
  mkdirTrustedSegmented,
  prepareTrustedRuntimeRoot,
  resolveTrustedCandidateDir,
  resolveTrustedRepoRoot,
  resolveTrustedScopeFile,
  resolveTrustedWorkspace,
  safeCleanupRuntimeRoot,
} from './path-authority.mjs';

export { resolveHostCoverageModes, resolveHostCoveragePlan, projectCoverageSubgraph };

const require = createRequire(import.meta.url);
const { projectAndPublishHostSurface } = require('./sync-host-surface.cjs');

const RUNTIME_DIR = 'runtime-candidate';
const WORKSPACE_ROOT = '.skill-knowledge/workspaces';
const PARTIAL_DIST_PREFIX = 'write-partial';
const COPY_PATHS = Object.freeze([
  'plugin/src',
  'scripts',
  'design_docs/skill-knowledge-graph',
  'ccm/apps/cli/src/provider-model-facts.json',
]);

function normalized(pathname) {
  return pathname.split(path.sep).join('/');
}

function abstainedHopReport(host, mode) {
  const gate = {
    ok: true,
    witness: { host, abstained: true, mode },
    remediation: `Host coverage is ${mode}; point hop gates are abstained.`,
  };
  return { H1: { ...gate }, H2: { ...gate }, H3: { ...gate }, H4: { ...gate } };
}

function skippedHopReport(host, mode, reason) {
  const gate = {
    ok: false,
    witness: { host, skipped: true, mode, reason },
    remediation: reason,
  };
  return { H1: { ...gate }, H2: { ...gate }, H3: { ...gate }, H4: { ...gate } };
}

function shouldCopy(src) {
  const base = path.basename(src);
  return !['node_modules', '.git', '.turbo', 'coverage', '.cache'].includes(base);
}

function copyTreeNoSymlinks(from, dest) {
  const fromStat = fs.lstatSync(from);
  if (fromStat.isSymbolicLink()) {
    throw Object.assign(new Error(`Refusing to copy symlink: ${from}`), {
      code: 'SKG-PATH-AUTHORITY-SYMLINK',
    });
  }
  if (fromStat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: false });
    for (const name of fs.readdirSync(from).sort()) {
      if (!shouldCopy(path.join(from, name))) continue;
      const child = path.join(from, name);
      try {
        if (fs.lstatSync(child).isSymbolicLink()) continue;
      } catch {
        continue;
      }
      copyTreeNoSymlinks(child, path.join(dest, name));
    }
    return;
  }
  if (fromStat.isFile()) {
    fs.copyFileSync(from, dest);
  }
}

function materializeRuntimeRoot({ repoAuthority, workspaceAuthority, scope }) {
  resolveTrustedCandidateDir(workspaceAuthority);
  // Ownership token is minted only inside prepareTrustedRuntimeRoot (process-local).
  // Never persist or re-read a token from the untrusted workspace/candidate tree.
  const runtimeAuthority = prepareTrustedRuntimeRoot(workspaceAuthority, RUNTIME_DIR);
  const runtimeRoot = runtimeAuthority.absolute;

  for (const rel of COPY_PATHS) {
    const from = path.join(repoAuthority.absolute, rel);
    if (!fs.existsSync(from)) continue;
    const fromStat = fs.lstatSync(from);
    if (fromStat.isSymbolicLink()) {
      throw Object.assign(
        new Error(`Refusing to copy symlink source into runtime-candidate: ${rel}`),
        { code: 'SKG-PATH-AUTHORITY-SYMLINK' },
      );
    }
    const dest = path.join(runtimeRoot, rel);
    mkdirTrustedSegmented(runtimeRoot, path.dirname(dest), { leafMustBeDirectory: true });
    if (fromStat.isDirectory()) {
      copyTreeNoSymlinks(from, dest);
    } else if (fromStat.isFile()) {
      fs.copyFileSync(from, dest);
    }
  }

  for (const item of scope) {
    const from = path.join(workspaceAuthority.workspaceAbsolute, 'candidate', item.path);
    if (!fs.existsSync(from)) {
      throw Object.assign(new Error(`candidate scope file missing: ${item.path}`), {
        code: 'SKG-CHANGE-CANDIDATE-MISSING',
      });
    }
    const fromStat = fs.lstatSync(from);
    if (fromStat.isSymbolicLink() || !fromStat.isFile()) {
      throw Object.assign(
        new Error(`candidate scope file must be a real file: ${item.path}`),
        { code: 'SKG-PATH-AUTHORITY-SYMLINK' },
      );
    }
    const dest = path.join(runtimeRoot, item.path);
    mkdirTrustedSegmented(runtimeRoot, path.dirname(dest), { leafMustBeDirectory: true });
    fs.copyFileSync(from, dest);
  }

  mkdirTrustedSegmented(runtimeRoot, path.join(runtimeRoot, 'plugin/dist'), {
    leafMustBeDirectory: true,
  });
  return runtimeAuthority;
}

/**
 * Project one host via the sync CJS API (structured errors, no stdout regex).
 * Uses candidate-v2 dual-manifest attestation: exact accepted_sap + trusted
 * expected-final rebuild. Marker/overlay-normalized bypasses are gone.
 */
function projectHost(runtimeRoot, host, { injectPostPublishFault = null, candidateGraphSha256 = null } = {}) {
  try {
    const published = projectAndPublishHostSurface({
      repoRoot: runtimeRoot,
      host,
      stamp: `${process.pid}-${Date.now().toString(16)}-${host}`,
      attestationMode: 'candidate-v2',
      candidateGraphSha256,
      ...(injectPostPublishFault ? { injectPostPublishFault } : {}),
      warn: () => {},
    });
    return {
      ok: true,
      status: 0,
      published,
      diagnostics: [],
      sync_envelope: {
        schema: 'cc-master/skill-knowledge-sync/v1alpha1',
        ok: true,
        host,
        attestation_mode: 'candidate-v2',
      },
    };
  } catch (error) {
    const nested = Array.isArray(error?.compile_diagnostics) ? error.compile_diagnostics : [];
    const code =
      typeof error?.code === 'string' && error.code.startsWith('SKG-')
        ? error.code
        : error?.message?.includes('digest mismatch')
          ? 'SKG-CHANGE-CANDIDATE-ATTESTATION'
          : error?.code === 'REGISTRY_V2_REQUIRED'
            ? 'REGISTRY_V2_REQUIRED'
            : 'SKG-CHANGE-CANDIDATE-RUNTIME';
    const envelope =
      error?.sync_envelope && typeof error.sync_envelope === 'object'
        ? error.sync_envelope
        : {
            schema: 'cc-master/skill-knowledge-sync/v1alpha1',
            ok: false,
            host,
            attestation_mode: 'candidate-v2',
            error_code: code,
            message: error instanceof Error ? error.message : String(error),
          };
    const promoted = nested.map((item) =>
      diagnostic({
        severity: item.severity ?? 'error',
        code: item.code ?? code,
        message: item.message ?? (error instanceof Error ? error.message : String(error)),
        location: item.location ?? `plugin/dist/${host}`,
        witness: {
          ...(item.witness ?? {}),
          host,
          candidate_runtime: true,
          sync_envelope: envelope,
          promoted_from: 'candidate_compile',
        },
        remediation:
          item.remediation ??
          'Repair candidate source/projection; sync failures never consume residual dist for H1–H4.',
        exitCode: item.exit_code ?? EXIT_CODES.projection,
      }),
    );
    return {
      ok: false,
      status: 1,
      published: null,
      diagnostics:
        promoted.length > 0
          ? promoted
          : [
              diagnostic({
                severity: 'error',
                code,
                message: error instanceof Error ? error.message : String(error),
                location: `plugin/dist/${host}`,
                witness: {
                  host,
                  candidate_runtime: true,
                  sync_envelope: envelope,
                  residual_live_dist: Boolean(envelope.residual_live_dist),
                },
                remediation:
                  'Repair candidate source/projection; sync failures never consume residual dist for H1–H4.',
                exitCode: EXIT_CODES.projection,
              }),
            ],
      sync_envelope: envelope,
      compile_body: error?.compile_body ?? null,
    };
  }
}

function publicCompileDiagnostics(hostResultBody) {
  return (hostResultBody?.diagnostics ?? []).filter((item) => item.severity === 'error');
}

function checkRouterBudgets(host, graph, artifacts, diagnostics) {
  const limits = graph.portfolio?.router_budget ?? {};
  const atlasPath = `plugin/dist/${host}/knowledge/atlas.md`;
  const atlasBudget = estimateBudget(artifacts.get(atlasPath) ?? '');
  if (
    (typeof limits.atlas_max_tokens === 'number' &&
      atlasBudget.estimated_tokens > limits.atlas_max_tokens) ||
    (typeof limits.atlas_max_lines === 'number' && atlasBudget.lines > limits.atlas_max_lines)
  ) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'SKG-BUDGET-ROUTER',
        message: `Atlas router budget exceeded for ${host}`,
        location: atlasPath,
        witness: { host, budget: atlasBudget, limits },
        remediation: 'Shrink atlas cues/links or raise router_budget with rationale.',
        exitCode: 4,
      }),
    );
  }
  for (const module of graph.modules) {
    const slug = module.id.replace(/^module:/, '');
    const routerPath = `plugin/dist/${host}/knowledge/modules/${slug}.md`;
    const budget = estimateBudget(artifacts.get(routerPath) ?? '');
    if (
      (typeof limits.module_max_tokens === 'number' &&
        budget.estimated_tokens > limits.module_max_tokens) ||
      (typeof limits.module_max_lines === 'number' && budget.lines > limits.module_max_lines)
    ) {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'SKG-BUDGET-ROUTER',
          message: `Module router budget exceeded for ${module.id} on ${host}`,
          location: routerPath,
          witness: { host, module: module.id, budget, limits },
          remediation: 'Shrink module router membership/links or raise router_budget.',
          exitCode: 4,
        }),
      );
    }
  }
  return { atlas: atlasBudget, limits };
}

function copyFileRecursiveNoFollow(from, to) {
  const stat = fs.lstatSync(from);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) {
      copyFileRecursiveNoFollow(path.join(from, name), path.join(to, name));
    }
    return;
  }
  if (stat.isFile()) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

/**
 * Materialize an independent partial final host tree from the coverage subgraph,
 * then reparse links/anchors/H1–H4/budget from that tree only.
 */
function materializePartialHostTree({ runtimeRoot, host, graph, moduleIds }) {
  const projectedGraph = projectCoverageSubgraph(graph, moduleIds, { host });
  // Candidate host dist must be a direct plugin/dist/<host>.write-* sibling
  // (trusted-host-dist contract); nest under that namespace only.
  const partialRoot = path.join(
    runtimeRoot,
    'plugin/dist',
    `${host}.${PARTIAL_DIST_PREFIX}-${process.pid.toString(16)}`,
  );
  if (fs.existsSync(partialRoot)) {
    fs.rmSync(partialRoot, { recursive: true, force: false });
  }
  mkdirTrustedSegmented(path.join(runtimeRoot, 'plugin/dist'), partialRoot, {
    leafMustBeDirectory: true,
  });

  const fullHostRoot = path.join(runtimeRoot, 'plugin/dist', host);

  // Only seed Markdown files that bind covered points (plus skill SKILL.md when needed).
  const neededDistFiles = new Set();
  for (const point of projectedGraph.points ?? []) {
    const distRel = canonicalBindingToDistPath(host, point.binding?.path);
    if (distRel) neededDistFiles.add(distRel.replace(`plugin/dist/${host}/`, ''));
  }
  for (const skill of projectedGraph.skills ?? []) {
    const skillName = skill.id.replace(/^skill:/, '');
    neededDistFiles.add(`skills/${skillName}/SKILL.md`);
  }
  for (const entry of projectedGraph.entries ?? []) {
    for (const surface of entry.surfaces ?? []) {
      if (surface.host !== host) continue;
      const distRel = entrySurfaceToDistPath(host, surface.source_file);
      if (!distRel) continue;
      neededDistFiles.add(distRel.replace(`plugin/dist/${host}/`, ''));
    }
  }

  for (const underHost of [...neededDistFiles].sort()) {
    const from = path.join(fullHostRoot, underHost);
    if (!fs.existsSync(from)) continue;
    const to = path.join(partialRoot, underHost);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (underHost.endsWith('.md') || underHost.endsWith('.markdown')) {
      const raw = fs.readFileSync(from, 'utf8');
      fs.writeFileSync(to, stripCompilerOwnedOverlay(raw));
    } else {
      fs.copyFileSync(from, to);
    }
  }

  const built = buildHostArtifacts({
    host,
    graph: projectedGraph,
    repoRoot: runtimeRoot,
    hostDistAbsolute: partialRoot,
  });
  writeArtifacts(runtimeRoot, built.artifacts, {
    candidateHostRoots: { [host]: partialRoot },
  });

  return { projectedGraph, partialRoot, built };
}

function verifyCoverageAwareHost({
  runtimeRoot,
  host,
  graph,
  mode,
  moduleIds,
  payloadRootOverride = null,
  projectedGraphOverride = null,
}) {
  const diagnostics = [];
  const projectedGraph =
    projectedGraphOverride ??
    (mode === 'partial' ? projectCoverageSubgraph(graph, moduleIds, { host }) : graph);
  const built = buildHostArtifacts({
    host,
    graph: projectedGraph,
    repoRoot: runtimeRoot,
    hostDistAbsolute: payloadRootOverride,
  });
  diagnostics.push(...built.diagnostics);

  const payloadRoot =
    payloadRootOverride ?? path.join(runtimeRoot, 'plugin/dist', host);
  const skillDirs = (projectedGraph.skills ?? []).map(
    (skill) => `skills/${skill.id.replace(/^skill:/, '')}`,
  );
  const scopedRoots = ['knowledge', ...skillDirs];
  for (const entry of projectedGraph.entries ?? []) {
    for (const surfaceSpec of entry.surfaces ?? []) {
      if (surfaceSpec.host !== host) continue;
      const distRel = entrySurfaceToDistPath(host, surfaceSpec.source_file);
      if (!distRel) continue;
      const relative = distRel.replace(`plugin/dist/${host}/`, '');
      const top = relative.split('/')[0];
      if (top && !scopedRoots.includes(top) && !scopedRoots.includes(relative)) {
        scopedRoots.push(relative.includes('/') ? relative.split('/').slice(0, 2).join('/') : relative);
      }
    }
  }

  const surface = countEnabledRuntimeEdges({
    host,
    payloadRoot,
    repoRoot: runtimeRoot,
    mode: mode === 'partial' ? 'partial' : 'canonical',
    scopedRoots,
  });
  diagnostics.push(...surface.diagnostics);

  const hops = verifyHopContracts({
    host,
    graph: projectedGraph,
    surface,
    repoRoot: runtimeRoot,
    payloadRoot,
  });
  diagnostics.push(...hops.diagnostics);

  const budgets = checkRouterBudgets(host, projectedGraph, built.artifacts, diagnostics);
  const ok = diagnostics.every((item) => item.severity !== 'error');
  return {
    host,
    ok,
    mode,
    projectedGraph,
    payloadRoot,
    artifacts: [...built.artifacts.keys()]
      .sort()
      .map((item) => ({
        path: item,
        bytes: Buffer.byteLength(built.artifacts.get(item), 'utf8'),
      })),
    enabled_edges: surface.enabled_edges,
    point_anchors: surface.point_anchors,
    hop_report: hops.hopReport,
    budgets: {
      ...budgets,
      ...hops.budgets,
    },
    executed_checks: [
      'candidate_runtime_sync',
      ...(surface.executed_checks ?? []),
      'candidate_runtime_verify',
      'enabled_by_default-only',
      ...(mode === 'partial' ? ['candidate_runtime_partial_tree'] : []),
    ],
    diagnostics,
    excluded_module_ids:
      mode === 'partial'
        ? (graph.modules ?? [])
            .map((item) => item.id)
            .filter((id) => !(moduleIds ?? []).includes(id))
        : [],
  };
}

function walkFilesetManifest(rootAbsolute, relativePrefix = '') {
  const rows = [];
  if (!fs.existsSync(rootAbsolute)) return rows;
  for (const dirent of fs.readdirSync(rootAbsolute, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const rel = relativePrefix ? `${relativePrefix}/${dirent.name}` : dirent.name;
    const absolute = path.join(rootAbsolute, dirent.name);
    if (dirent.isSymbolicLink()) {
      rows.push({ path: rel, kind: 'symlink' });
      continue;
    }
    if (dirent.isDirectory()) {
      rows.push({ path: rel, kind: 'dir' });
      rows.push(...walkFilesetManifest(absolute, rel));
      continue;
    }
    if (dirent.isFile()) {
      const bytes = fs.readFileSync(absolute);
      rows.push({
        path: rel,
        kind: 'file',
        bytes: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
  return rows;
}

/**
 * Snapshot the actual full/partial final host tree by reparsing files / Markdown.
 * Graph fields only represent observed anchors, nav links, and entry pins.
 * Authored graph may uniquely map an observed marker to a stable id; it must
 * never invent edges from endpoint co-presence. Disabled (non-emitted) edges
 * cannot appear in the final snapshot.
 * Observed compiler nav-surface point links must map to exactly one enabled
 * edge; 0 or >1 candidates fail closed (no snapshot on failure).
 *
 * @returns {{ ok: boolean, snapshot: object|null, diagnostics: object[] }}
 */
export function buildFinalSurfaceSnapshot({
  host,
  mode,
  runtimeRoot,
  payloadRoot,
}) {
  const diagnostics = [];
  const finalRootRel = path
    .relative(runtimeRoot, payloadRoot)
    .split(path.sep)
    .join('/');
  const fileset = walkFilesetManifest(payloadRoot);
  const fileset_manifest = fileset.map((item) => item.path).sort();

  const authored = buildAndValidateGraph({ repoRoot: runtimeRoot });
  const authoredGraph = authored.graph ?? {};

  const pointByAnchor = new Map();
  for (const point of authoredGraph.points ?? []) {
    pointByAnchor.set(normalizePointAnchor(point.id).html_id, point);
  }
  const edgesByEndpoints = new Map();
  for (const edge of authoredGraph.edges ?? []) {
    const key = `${edge.from}\0${edge.to}`;
    if (!edgesByEndpoints.has(key)) edgesByEndpoints.set(key, []);
    edgesByEndpoints.get(key).push(edge);
  }

  const surfacePointIds = new Set();
  const surfaceModuleIds = new Set();
  const surfaceSkillIds = new Set();
  const observedEdgeKeys = [];
  const entryPinTargets = [];

  const walkMarkdown = (absolute, relativePrefix = '') => {
    if (!fs.existsSync(absolute)) return;
    for (const dirent of fs.readdirSync(absolute, { withFileTypes: true })) {
      const rel = relativePrefix ? `${relativePrefix}/${dirent.name}` : dirent.name;
      const child = path.join(absolute, dirent.name);
      if (dirent.isSymbolicLink()) continue;
      if (dirent.isDirectory()) {
        walkMarkdown(child, rel);
        continue;
      }
      if (!dirent.isFile() || !dirent.name.endsWith('.md')) continue;
      const markdown = fs.readFileSync(child, 'utf8');
      const anchors = inspectHtmlAnchorIds(markdown).ids ?? [];
      for (const anchor of anchors) {
        const point = pointByAnchor.get(anchor);
        if (point) surfacePointIds.add(point.id);
      }
      const moduleMatch = rel.match(/^knowledge\/modules\/(.+)\.md$/);
      if (moduleMatch) surfaceModuleIds.add(`module:${moduleMatch[1]}`);
      const skillMatch = rel.match(/^skills\/([^/]+)\/SKILL\.md$/);
      if (skillMatch) surfaceSkillIds.add(`skill:${skillMatch[1]}`);

      // Only compiler-owned nav blocks — never ordinary body Markdown links.
      for (const match of markdown.matchAll(
        /<!--\s*ccm:k:nav:start\s+(point:[a-z0-9][a-z0-9.-]*)\s*-->[\s\S]*?<!--\s*ccm:k:nav:end\s*-->/g,
      )) {
        const fromId = match[1];
        const block = match[0];
        const fromPoint = (authoredGraph.points ?? []).find((item) => item.id === fromId);
        for (const link of block.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
          const target = link[1];
          const fragment = target.includes('#') ? target.slice(target.indexOf('#') + 1) : null;
          if (!fragment || !fragment.startsWith('ccm-k-point-')) continue;
          const toPoint = pointByAnchor.get(fragment);
          if (!toPoint) continue;
          surfacePointIds.add(fromId);
          surfacePointIds.add(toPoint.id);
          // Authority canonical pins are emitted into nav but are not authored edges.
          if (
            fromPoint?.authority?.role !== 'canonical' &&
            fromPoint?.authority?.canonical === toPoint.id
          ) {
            continue;
          }
          observedEdgeKeys.push({ from: fromId, to: toPoint.id });
        }
      }

      for (const match of markdown.matchAll(
        /<!--\s*ccm:k:entry-pin:start\s*-->[\s\S]*?<!--\s*ccm:k:entry-pin:end\s*-->/g,
      )) {
        const block = match[0];
        for (const link of block.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
          const target = link[1];
          const fragment = target.includes('#') ? target.slice(target.indexOf('#') + 1) : null;
          if (!fragment || !fragment.startsWith('ccm-k-point-')) continue;
          const point = pointByAnchor.get(fragment);
          if (!point) continue;
          entryPinTargets.push({
            host,
            skill: null,
            module: point.module_id,
            point: point.id,
          });
        }
      }
    }
  };
  walkMarkdown(payloadRoot);

  for (const point of authoredGraph.points ?? []) {
    if (surfacePointIds.has(point.id)) surfaceModuleIds.add(point.module_id);
  }

  const points = [...surfacePointIds]
    .map((id) => {
      const point = (authoredGraph.points ?? []).find((item) => item.id === id);
      return point
        ? { id: point.id, module_id: point.module_id }
        : { id, module_id: null };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const pointIds = new Set(points.map((item) => item.id));

  const modules = [...surfaceModuleIds]
    .sort()
    .map((id) => {
      const module = (authoredGraph.modules ?? []).find((item) => item.id === id);
      if (!module?.access) return { id, access: null };
      const primary = (module.access.primary_points ?? []).filter((pid) => pointIds.has(pid));
      return {
        id,
        access: {
          class: module.access.class ?? null,
          primary_points: [...primary].sort(),
          relevant_entries: [],
        },
      };
    });

  // Edges: only uniquely mapped observed nav links. Never invent from co-presence.
  const edges = [];
  const enabled_adjacency = {};
  const enabled_edge_ids = [];
  const seenEdgeIds = new Set();
  const reportedAmbiguous = new Set();
  for (const observed of observedEdgeKeys) {
    if (!pointIds.has(observed.from) || !pointIds.has(observed.to)) continue;
    const candidates = (edgesByEndpoints.get(`${observed.from}\0${observed.to}`) ?? []).filter(
      (edge) => edge.runtime?.enabled_by_default !== false,
    );
    if (candidates.length !== 1) {
      const ambKey = `${observed.from}\0${observed.to}`;
      if (!reportedAmbiguous.has(ambKey)) {
        reportedAmbiguous.add(ambKey);
        const candidate_edge_ids = candidates.map((edge) => edge.id).sort();
        diagnostics.push(
          diagnostic({
            severity: 'error',
            code: 'SKG-CHANGE-SNAPSHOT-EDGE-AMBIGUOUS',
            message: `Observed nav surface link ${observed.from} → ${observed.to} maps to ${candidates.length} enabled edge candidate(s); need exactly 1`,
            location: `plugin/dist/${host}`,
            witness: {
              host,
              from: observed.from,
              to: observed.to,
              candidate_edge_ids,
            },
            remediation:
              'Keep enabled authored edges unique per observed nav endpoints, or remove orphan nav links; never invent or silently drop edges.',
            exitCode: EXIT_CODES.projection,
          }),
        );
      }
      continue;
    }
    const edge = candidates[0];
    if (seenEdgeIds.has(edge.id)) continue;
    seenEdgeIds.add(edge.id);
    edges.push({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      enabled_by_default: true,
    });
    if (!enabled_adjacency[edge.from]) enabled_adjacency[edge.from] = [];
    enabled_adjacency[edge.from].push({ to: edge.to, edge_id: edge.id });
    enabled_edge_ids.push(edge.id);
  }

  if (diagnostics.length > 0) {
    return { ok: false, snapshot: null, diagnostics };
  }

  edges.sort((a, b) => a.id.localeCompare(b.id));
  for (const from of Object.keys(enabled_adjacency)) {
    enabled_adjacency[from].sort(
      (a, b) => a.edge_id.localeCompare(b.edge_id) || a.to.localeCompare(b.to),
    );
  }
  enabled_edge_ids.sort();

  const skills = (authoredGraph.skills ?? [])
    .filter(
      (skill) =>
        surfaceSkillIds.has(skill.id) ||
        (skill.modules ?? []).some((m) => surfaceModuleIds.has(m.id)),
    )
    .map((skill) => {
      const skillModules = (skill.modules ?? [])
        .map((item) => item.id)
        .filter((id) => surfaceModuleIds.has(id))
        .sort();
      return {
        id: skill.id,
        modules: skillModules,
        covered_modules_by_host: Object.fromEntries(
          PRODUCT_HOSTS.map((h) => {
            const row = (skill.host_coverage ?? []).find((item) => item.host === h);
            if (!row) return [h, null];
            if (row.state === 'partial') {
              return [
                h,
                [...(row.covered_modules ?? [])]
                  .filter((id) => skillModules.includes(id))
                  .sort(),
              ];
            }
            return [
              h,
              row.covered_modules
                ? [...row.covered_modules].filter((id) => skillModules.includes(id)).sort()
                : null,
            ];
          }),
        ),
      };
    });

  // Entries only from observed entry-pin targets on this host.
  const entriesById = new Map();
  for (const target of entryPinTargets) {
    if (!target.point || !pointIds.has(target.point)) continue;
    const matching = (authoredGraph.entries ?? []).filter((entry) =>
      (entry.surfaces ?? []).some(
        (surface) =>
          surface.host === host &&
          (surface.targets ?? []).some((item) => item.point === target.point),
      ),
    );
    if (matching.length !== 1) continue;
    const entry = matching[0];
    const row = entriesById.get(entry.id) ?? { id: entry.id, targets: [] };
    if (!row.targets.some((item) => item.point === target.point)) {
      row.targets.push({
        host,
        skill: target.skill ?? null,
        module: target.module ?? null,
        point: target.point,
      });
    }
    entriesById.set(entry.id, row);
  }
  const entries = [...entriesById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const survivingEntryIds = new Set(entries.map((item) => item.id));
  for (const module of modules) {
    if (!module.access) continue;
    const authoredModule = (authoredGraph.modules ?? []).find((item) => item.id === module.id);
    module.access.relevant_entries = (authoredModule?.access?.relevant_entries ?? []).filter((id) =>
      survivingEntryIds.has(id),
    );
  }

  return {
    ok: true,
    diagnostics: [],
    snapshot: {
      host,
      mode,
      final_root: finalRootRel,
      fileset_manifest,
      fileset,
      skills,
      modules,
      points,
      edges,
      entries,
      enabled_edge_ids: [...new Set(enabled_edge_ids)],
      enabled_adjacency,
    },
  };
}

function toWitness({
  host,
  ok,
  mode,
  compileHostResult = null,
  resultGraphSha256,
  executedChecks = null,
  hopReport = null,
  diagnostics = [],
  finalSurfaceSnapshot = null,
}) {
  if (mode === 'stub' || mode === 'unsupported') {
    return {
      host,
      ok,
      mode,
      artifacts: [],
      enabled_edges: 0,
      point_anchors: 0,
      hop_report: abstainedHopReport(host, mode),
      budgets: {},
      executed_checks: executedChecks ?? [`host_coverage_${mode}_abstention`],
      conditional_route_policy: 'abstained',
      result_graph_sha256: resultGraphSha256,
      ...(diagnostics.length ? { _diagnostics: diagnostics } : {}),
    };
  }

  const result = compileHostResult ?? {};
  const failedWithoutResult = !compileHostResult;
  return {
    host,
    ok,
    mode,
    artifacts: result.artifacts ?? [],
    enabled_edges: result.enabled_edges ?? 0,
    point_anchors: result.point_anchors ?? 0,
    hop_report:
      hopReport ??
      result.hop_report ??
      (failedWithoutResult
        ? skippedHopReport(host, mode, 'Host projection/verify did not complete.')
        : skippedHopReport(host, mode, 'Missing hop report from host verify.')),
    budgets: result.budgets ?? {},
    executed_checks: executedChecks ?? result.executed_checks ?? [],
    conditional_route_policy: 'enabled_by_default-only',
    result_graph_sha256: resultGraphSha256,
    ...(finalSurfaceSnapshot ? { final_surface_snapshot: finalSurfaceSnapshot } : {}),
    ...(diagnostics.length ? { _diagnostics: diagnostics } : {}),
  };
}

function syncFailedWitness(host, mode, resultGraphSha256, syncDiagnostics) {
  return toWitness({
    host,
    ok: false,
    mode,
    resultGraphSha256,
    executedChecks: ['candidate_runtime_sync'],
    hopReport: skippedHopReport(
      host,
      mode,
      'sync failed; residual dist is never consumed for H1–H4.',
    ),
    compileHostResult: {
      artifacts: [],
      enabled_edges: 0,
      point_anchors: 0,
      hop_report: skippedHopReport(
        host,
        mode,
        'sync failed; residual dist is never consumed for H1–H4.',
      ),
      budgets: {},
      executed_checks: ['candidate_runtime_sync'],
    },
    diagnostics: syncDiagnostics,
  });
}

/**
 * Run the four-host candidate runtime gate.
 * @returns {{ diagnostics: object[], witnesses: object[], candidate_runtime_valid: boolean, runtimeRoot: string|null }}
 */
export function validateCandidateRuntimeProjection({
  repoRoot,
  workspace,
  scope,
  candidateGraph,
  resultGraphSha256,
  /** @type {{ host?: string, injectPostPublishFault?: Function }|null} */
  testSeams = null,
}) {
  const diagnostics = [];
  const { plan, diagnostics: coverageDiagnostics } = resolveHostCoveragePlan(candidateGraph);
  diagnostics.push(...coverageDiagnostics);
  const needsProjection = PRODUCT_HOSTS.some(
    (host) => plan[host].mode === 'full' || plan[host].mode === 'partial',
  );

  let workspaceAuthority = null;
  let runtimeAuthority = null;
  try {
    const repoAuthority = resolveTrustedRepoRoot(repoRoot);
    workspaceAuthority = resolveTrustedWorkspace(repoRoot, workspace, WORKSPACE_ROOT);
    for (const item of scope) {
      resolveTrustedScopeFile(
        { absolute: workspaceAuthority.workspaceAbsolute, real: workspaceAuthority.workspaceReal },
        path.join('candidate', item.path),
      );
    }

    if (needsProjection) {
      runtimeAuthority = materializeRuntimeRoot({
        repoAuthority,
        workspaceAuthority,
        scope,
      });
    }

    const runtimeRoot = runtimeAuthority?.absolute ?? null;
    let builtGraph = null;
    if (needsProjection) {
      const built = buildAndValidateGraph({ repoRoot: runtimeRoot });
      if (!built.ok || !built.graph) {
        for (const item of built.diagnostics ?? []) {
          diagnostics.push({
            ...item,
            witness: { ...(item.witness ?? {}), candidate_runtime: true },
          });
        }
        if ((built.diagnostics ?? []).every((item) => item.severity !== 'error')) {
          diagnostics.push(
            diagnostic({
              severity: 'error',
              code: 'SKG-CHANGE-CANDIDATE-RUNTIME',
              message: 'Candidate runtime graph failed to build before host projection.',
              location: normalized(path.join(workspace, RUNTIME_DIR)),
              witness: { source_root: built.source_root ?? null },
              remediation: 'Repair candidate manifests so the runtime graph can build.',
              exitCode: EXIT_CODES.projection,
            }),
          );
        }
      } else {
        builtGraph = built.graph;
      }
    }

    const witnesses = [];
    for (const host of PRODUCT_HOSTS) {
      const hostPlan = plan[host];
      const mode = hostPlan.mode;
      if (mode === 'stub' || mode === 'unsupported') {
        witnesses.push(
          toWitness({
            host,
            ok: true,
            mode,
            resultGraphSha256,
          }),
        );
        continue;
      }

      if (!runtimeRoot || !builtGraph) {
        witnesses.push(
          toWitness({
            host,
            ok: false,
            mode,
            resultGraphSha256,
            executedChecks: ['skipped_due_to_prior_runtime_errors'],
            hopReport: skippedHopReport(
              host,
              mode,
              'Runtime graph unavailable; host projection skipped.',
            ),
          }),
        );
        continue;
      }

      const injectPostPublishFault =
        testSeams?.injectPostPublishFault &&
        (!testSeams.host || testSeams.host === host)
          ? testSeams.injectPostPublishFault
          : null;
      const projected = projectHost(runtimeRoot, host, {
        injectPostPublishFault,
        // Bind attestation to the recomputed runtime-candidate graph hash, not the
        // change-record result hash (which includes the draft and is a different plane).
        candidateGraphSha256: builtGraph.graph_hash,
      });
      if (!projected.ok) {
        diagnostics.push(...projected.diagnostics);
        const compileHost =
          (projected.sync_envelope && projected.compile_body?.host_results?.find((item) => item.host === host)) ||
          projected.compile_body?.host_results?.[0] ||
          null;
        // Prefer structured hop_report from the failed compile body over skipped stubs
        // when compile ran far enough to evaluate H1–H4 (e.g. authored hop_policy tighten).
        const hopFromCompile = compileHost?.hop_report ?? null;
        witnesses.push(
          toWitness({
            host,
            ok: false,
            mode,
            resultGraphSha256,
            executedChecks: hopFromCompile
              ? ['candidate_runtime_sync', 'candidate_runtime_compile']
              : ['candidate_runtime_sync'],
            hopReport: hopFromCompile
              ? hopFromCompile
              : skippedHopReport(
                  host,
                  mode,
                  'sync failed; residual dist is never consumed for H1–H4.',
                ),
            compileHostResult: hopFromCompile
              ? {
                  artifacts: [],
                  enabled_edges: 0,
                  point_anchors: 0,
                  hop_report: hopFromCompile,
                  budgets: {},
                  executed_checks: ['candidate_runtime_sync', 'candidate_runtime_compile'],
                }
              : {
                  artifacts: [],
                  enabled_edges: 0,
                  point_anchors: 0,
                  hop_report: skippedHopReport(
                    host,
                    mode,
                    'sync failed; residual dist is never consumed for H1–H4.',
                  ),
                  budgets: {},
                  executed_checks: ['candidate_runtime_sync'],
                },
            diagnostics: projected.diagnostics,
          }),
        );
        continue;
      }

      let verified;
      let payloadRootForSnapshot = path.join(runtimeRoot, 'plugin/dist', host);
      if (mode === 'partial') {
        const partial = materializePartialHostTree({
          runtimeRoot,
          host,
          graph: builtGraph,
          moduleIds: hostPlan.moduleIds,
        });
        diagnostics.push(...partial.built.diagnostics);
        verified = verifyCoverageAwareHost({
          runtimeRoot,
          host,
          graph: builtGraph,
          mode,
          moduleIds: hostPlan.moduleIds,
          payloadRootOverride: partial.partialRoot,
          projectedGraphOverride: partial.projectedGraph,
        });
        payloadRootForSnapshot = partial.partialRoot;
        // Prove excluded modules do not appear in the partial denominator.
        for (const excludedId of verified.excluded_module_ids ?? []) {
          const slug = excludedId.replace(/^module:/, '');
          const routerPath = path.join(
            partial.partialRoot,
            'knowledge',
            'modules',
            `${slug}.md`,
          );
          if (fs.existsSync(routerPath)) {
            diagnostics.push(
              diagnostic({
                severity: 'error',
                code: 'SKG-CHANGE-PARTIAL-LEAK',
                message: `Excluded module ${excludedId} leaked into partial final host tree`,
                location: normalized(routerPath),
                witness: { host, excluded_module: excludedId },
                remediation: 'Partial projection must omit uncovered modules from the final tree.',
                exitCode: EXIT_CODES.projection,
              }),
            );
            verified = { ...verified, ok: false };
          }
        }
      } else {
        verified = verifyCoverageAwareHost({
          runtimeRoot,
          host,
          graph: builtGraph,
          mode,
          moduleIds: hostPlan.moduleIds,
        });
        payloadRootForSnapshot = verified.payloadRoot ?? payloadRootForSnapshot;
      }

      for (const item of verified.diagnostics) {
        diagnostics.push({
          ...item,
          location: item.location ?? `plugin/dist/${host}`,
          witness: { ...(item.witness ?? {}), host, candidate_runtime: true },
        });
      }

      let checkResult = null;
      if (mode === 'full') {
        checkResult = runCompile({
          repoRoot: runtimeRoot,
          host,
          check: true,
        });
        const compileErrors = publicCompileDiagnostics(checkResult.body);
        for (const item of compileErrors) {
          diagnostics.push({
            ...item,
            location: item.location ?? `plugin/dist/${host}`,
            witness: { ...(item.witness ?? {}), host, candidate_runtime: true },
          });
        }
        if (checkResult.exitCode !== 0 && compileErrors.length === 0) {
          diagnostics.push(
            diagnostic({
              severity: 'error',
              code: 'SKG-CHANGE-CANDIDATE-RUNTIME',
              message: `Candidate compile --check failed for ${host} without structured diagnostics.`,
              location: `plugin/dist/${host}`,
              witness: {
                host,
                exit_code: checkResult.exitCode,
                body: checkResult.body ?? null,
              },
              remediation:
                'Inspect candidate runtime compile --check output and repair projection failures.',
              exitCode: checkResult.exitCode || EXIT_CODES.projection,
            }),
          );
        }
      }

      const checkHost =
        (checkResult?.body?.host_results ?? []).find((item) => item.host === host) ?? null;
      const checkOk =
        mode === 'partial' ? true : checkResult?.exitCode === 0 && Boolean(checkHost?.ok);
      const ok =
        verified.ok &&
        checkOk &&
        verified.diagnostics.every((item) => item.severity !== 'error');

      const executed = [...verified.executed_checks];
      if (mode === 'full') executed.push('candidate_runtime_compile_check');

      // Capture final-byte snapshot inside the controlled lifecycle, before finally cleanup.
      // Failed hosts must never publish a snapshot; ambiguous nav→edge mapping fail-closes.
      let finalSurfaceSnapshot = null;
      let hostOk = ok;
      let snapshotEnabledEdges = verified.enabled_edges;
      if (hostOk && fs.existsSync(payloadRootForSnapshot)) {
        if (
          typeof testSeams?.mutatePayloadBeforeSnapshot === 'function' &&
          (!testSeams.host || testSeams.host === host)
        ) {
          testSeams.mutatePayloadBeforeSnapshot({
            host,
            mode,
            runtimeRoot,
            payloadRoot: payloadRootForSnapshot,
          });
        }
        const builtSnap = buildFinalSurfaceSnapshot({
          host,
          mode,
          runtimeRoot,
          payloadRoot: payloadRootForSnapshot,
        });
        for (const item of builtSnap.diagnostics) {
          diagnostics.push({
            ...item,
            location: item.location ?? `plugin/dist/${host}`,
            witness: { ...(item.witness ?? {}), host, candidate_runtime: true },
          });
        }
        if (builtSnap.ok && builtSnap.snapshot) {
          finalSurfaceSnapshot = builtSnap.snapshot;
          snapshotEnabledEdges = builtSnap.snapshot.enabled_edge_ids.length;
          executed.push('candidate_runtime_final_surface_snapshot');
        } else {
          hostOk = false;
          finalSurfaceSnapshot = null;
        }
      }

      witnesses.push(
        toWitness({
          host,
          ok: hostOk,
          mode,
          compileHostResult: {
            artifacts: verified.artifacts,
            enabled_edges: hostOk ? snapshotEnabledEdges : verified.enabled_edges,
            point_anchors: verified.point_anchors,
            hop_report: verified.hop_report,
            budgets: verified.budgets,
            executed_checks: executed,
          },
          resultGraphSha256,
          executedChecks: executed,
          finalSurfaceSnapshot,
          diagnostics: [],
        }),
      );
    }

    const candidate_runtime_valid =
      diagnostics.every((item) => item.severity !== 'error') &&
      witnesses.length === PRODUCT_HOSTS.length &&
      witnesses.every((item) => item.ok);

    return {
      diagnostics,
      witnesses: witnesses.map(({ _diagnostics, ...item }) => item),
      candidate_runtime_valid,
      runtimeRoot: null,
    };
  } catch (error) {
    const code =
      typeof error?.code === 'string' && error.code.startsWith('SKG-')
        ? error.code
        : 'SKG-CHANGE-CANDIDATE-RUNTIME';
    const item = diagnostic({
      severity: 'error',
      code,
      message: error instanceof Error ? error.message : String(error),
      location: normalized(path.join(workspace, RUNTIME_DIR)),
      witness: {
        error: error instanceof Error ? error.message : String(error),
        ...(error?.witness ?? {}),
      },
      remediation:
        'Keep candidate runtime materialization inside the ignored workspace; refuse symlink escape on authority locate chains.',
      exitCode: EXIT_CODES.projection,
    });
    const witnesses = PRODUCT_HOSTS.map((host) => {
      const mode = plan[host]?.mode ?? 'unsupported';
      if (mode === 'stub' || mode === 'unsupported') {
        return toWitness({ host, ok: false, mode, resultGraphSha256 });
      }
      return toWitness({
        host,
        ok: false,
        mode,
        resultGraphSha256,
        executedChecks: ['skipped_due_to_authority_or_runtime_error'],
        hopReport: skippedHopReport(
          host,
          mode,
          'Authority/runtime error before host gates executed.',
        ),
      });
    });
    return {
      diagnostics: [item],
      witnesses,
      candidate_runtime_valid: false,
      runtimeRoot: runtimeAuthority?.absolute ?? null,
    };
  } finally {
    if (runtimeAuthority && workspaceAuthority) {
      try {
        safeCleanupRuntimeRoot(runtimeAuthority, workspaceAuthority);
      } catch {
        // leave for operator inspection; never throw from cleanup
      }
    }
  }
}
