/**
 * Pure candidate analysis for graph-first compositions.
 * Does not import graph.mjs (avoids circular dependency with admission projection).
 *
 * Metrics are computed from the live graph + inventory Markdown + adapter capability.
 * Authored composition.host_coverage / hop_policy maxima are inputs to gates, never
 * echoed as if they were observed witness values.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { diagnostic } from './diagnostics.mjs';
import { HARDENING_CONTRACT } from './contracts.mjs';
import { estimateBudget, sha256Hex, stableSerialize } from './hash.mjs';
import {
  buildExpectedProjectionTopology,
  evaluateDirectedPointHopGates,
} from './compile/surface-verifier.mjs';

const require = createRequire(import.meta.url);
const { planSkillProjection } = require('../project-skill.cjs');

const PRODUCT_HOSTS = HARDENING_CONTRACT.C9.hosts;
const ADMISSION_DEFAULTS = HARDENING_CONTRACT.C6.candidate_admission;

/** Closed-set metric keys persisted under analysis.witness (plus narrative keys). */
export const WITNESS_METRIC_KEYS = Object.freeze([
  'candidate_modules',
  'candidate_points',
  'trigger_job_coherence',
  'internal_cohesion',
  'external_cut_coupling',
  'overlap_signature',
  'ssot_closure',
  'budgets',
  'host_portability',
  'hop',
  'graph_metrics',
  'admission_gates',
]);

export const WITNESS_NARRATIVE_KEYS = Object.freeze(['reason', 'composition_id']);

export const WITNESS_ALLOWED_KEYS = Object.freeze([
  ...WITNESS_NARRATIVE_KEYS,
  ...WITNESS_METRIC_KEYS,
]);

export function consumeModuleRefs(composition) {
  const raw = composition?.consumes?.modules ?? [];
  return raw.map((item) => {
    if (typeof item === 'string') {
      return { id: item, manifest: null };
    }
    return { id: item.id, manifest: item.manifest ?? null };
  });
}

export function consumeModuleIds(composition) {
  return consumeModuleRefs(composition)
    .map((item) => item.id)
    .sort();
}

export function loadAnalysisDocument(repoRoot, analysisId) {
  const analysesRoot = path.join(repoRoot, 'plugin/src/knowledge/analyses');
  if (!fs.existsSync(analysesRoot)) return null;
  for (const name of fs.readdirSync(analysesRoot).sort()) {
    if (!name.endsWith('.json')) continue;
    const absolute = path.join(analysesRoot, name);
    const doc = JSON.parse(fs.readFileSync(absolute, 'utf8'));
    if (doc.id === analysisId) return { doc, path: absolute };
  }
  return null;
}

export function loadCompositionDocument(repoRoot, compositionId) {
  const root = path.join(repoRoot, 'plugin/src/knowledge/compositions');
  if (!fs.existsSync(root)) return null;
  for (const name of fs.readdirSync(root).sort()) {
    if (!name.endsWith('.json')) continue;
    const absolute = path.join(root, name);
    const doc = JSON.parse(fs.readFileSync(absolute, 'utf8'));
    if (doc.id === compositionId || doc.skill_id === compositionId) {
      return { doc, path: absolute };
    }
  }
  return null;
}

function sameIdSet(left, right) {
  const a = [...new Set(left ?? [])].sort();
  const b = [...new Set(right ?? [])].sort();
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function deriveVerdict(scoresheet, metricGatesOk) {
  if (!metricGatesOk) return 'reject';
  const d1 = scoresheet?.D1?.score;
  const d2 = scoresheet?.D2?.score;
  const probeA = scoresheet?.D3?.probe_a;
  const probeB = scoresheet?.D3?.probe_b;
  if (d2 === 0) return 'decompose';
  if (d1 === 1 && d2 === 1 && probeA === 'strong' && probeB === 'weak') {
    return 'reference';
  }
  if (d1 === 1 && d2 === 1 && (probeA === 'strong' || probeB === 'strong')) {
    return 'admit';
  }
  return 'reject';
}

function hostRank(state) {
  if (state === 'full') return 3;
  if (state === 'partial') return 2;
  if (state === 'stub') return 1;
  return 0; // unsupported / missing
}

function worseHostState(left, right) {
  return hostRank(left) <= hostRank(right) ? left : right;
}

/**
 * Map real SAP planner result to a coverage capability class.
 * Uses read-only planSkillProjection (slot replacements / mode / contracts).
 * Planner throw (missing strategy, missing slot replacement, bad contract) → unsupported.
 */
export function projectionCapabilityForHost(repoRoot, composition, host) {
  const skillName = composition?.name;
  if (!repoRoot || !skillName || typeof skillName !== 'string') {
    return { state: 'unsupported', planner_ok: false, error: 'missing composition.name' };
  }
  try {
    const plan = planSkillProjection({ repoRoot, host, skill: skillName });
    if (plan.mode === 'unsupported_stub' || plan.mode === 'planned') {
      return { state: 'unsupported', planner_ok: true, error: null, mode: plan.mode };
    }
    if (plan.mode === 'partial_overlay') {
      return { state: 'partial', planner_ok: true, error: null, mode: plan.mode };
    }
    if (plan.mode === 'copy') {
      return { state: 'full', planner_ok: true, error: null, mode: plan.mode };
    }
    return {
      state: 'unsupported',
      planner_ok: true,
      error: `unrecognized projection mode ${plan.mode}`,
      mode: plan.mode,
    };
  } catch (error) {
    return {
      state: 'unsupported',
      planner_ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveAdmissionPolicy(portfolio) {
  const authored = portfolio?.candidate_admission ?? {};
  return {
    inventory_max_utf8_bytes:
      authored.inventory_max_utf8_bytes ?? ADMISSION_DEFAULTS.inventory_max_utf8_bytes,
    inventory_max_lines: authored.inventory_max_lines ?? ADMISSION_DEFAULTS.inventory_max_lines,
    inventory_max_tokens: authored.inventory_max_tokens ?? ADMISSION_DEFAULTS.inventory_max_tokens,
    min_internal_cohesion:
      authored.min_internal_cohesion ?? ADMISSION_DEFAULTS.min_internal_cohesion,
    max_external_edge_count:
      authored.max_external_edge_count ?? ADMISSION_DEFAULTS.max_external_edge_count,
    external_edge_policy: {
      allowed_types: [
        ...(authored.external_edge_policy?.allowed_types ??
          ADMISSION_DEFAULTS.external_edge_policy.allowed_types),
      ].sort(),
    },
    max_overlap_shared_modules:
      authored.max_overlap_shared_modules ?? ADMISSION_DEFAULTS.max_overlap_shared_modules,
    require_ssot_closure:
      authored.require_ssot_closure ?? ADMISSION_DEFAULTS.require_ssot_closure,
    require_four_host_denominator:
      authored.require_four_host_denominator ??
      ADMISSION_DEFAULTS.require_four_host_denominator,
    reject_all_hosts_unsupported:
      authored.reject_all_hosts_unsupported ??
      ADMISSION_DEFAULTS.reject_all_hosts_unsupported,
    require_declared_projection:
      authored.require_declared_projection ?? ADMISSION_DEFAULTS.require_declared_projection,
    hop_gate: authored.hop_gate ?? ADMISSION_DEFAULTS.hop_gate,
  };
}

function bfsDistance(adjacency, from, to) {
  if (from === to) return 0;
  const queue = [[from, 0]];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const [node, distance] = queue.shift();
    for (const next of adjacency.get(node) ?? []) {
      if (seen.has(next)) continue;
      if (next === to) return distance + 1;
      seen.add(next);
      queue.push([next, distance + 1]);
    }
  }
  return Number.POSITIVE_INFINITY;
}

function buildAdjacency(pointIds, edges, { undirected = false } = {}) {
  const adjacency = new Map([...pointIds].map((id) => [id, []]));
  for (const edge of edges) {
    if (!pointIds.has(edge.from) || !pointIds.has(edge.to)) continue;
    if (edge.runtime?.enabled_by_default === false) continue;
    adjacency.get(edge.from).push(edge.to);
    if (undirected) adjacency.get(edge.to).push(edge.from);
  }
  return adjacency;
}

function computeHopWitness({
  modules,
  points,
  edges,
  composition,
  hopPolicy,
  graph,
  host_portability,
  host_planner,
}) {
  const pointIds = new Set(points.map((point) => point.id));
  const moduleIds = new Set(modules.map((module) => module.id));
  const directed = buildAdjacency(pointIds, edges, { undirected: false });
  const undirected = buildAdjacency(pointIds, edges, { undirected: true });
  const ids = [...pointIds].sort();

  let authoredDirectedDiameter = 0;
  const authoredDirectedUnreachable = [];
  for (const from of ids) {
    for (const to of ids) {
      if (from === to) continue;
      const distance = bfsDistance(directed, from, to);
      if (!Number.isFinite(distance)) {
        authoredDirectedUnreachable.push({ from, to });
      } else if (distance > authoredDirectedDiameter) {
        authoredDirectedDiameter = distance;
      }
    }
  }

  const entryRoots = [];
  for (const moduleId of composition?.entry_modules ?? []) {
    const module = modules.find((item) => item.id === moduleId);
    for (const pointId of module?.access?.primary_points ?? []) {
      if (pointIds.has(pointId)) entryRoots.push(pointId);
    }
  }
  const uniqueRoots = [...new Set(entryRoots)].sort();

  let maxUndirectedEntryDistance = 0;
  const undirectedUnreachable = [];
  for (const pointId of ids) {
    let best = Number.POSITIVE_INFINITY;
    for (const root of uniqueRoots) {
      best = Math.min(best, bfsDistance(undirected, root, pointId));
    }
    if (!Number.isFinite(best)) {
      undirectedUnreachable.push(pointId);
    } else if (best > maxUndirectedEntryDistance) {
      maxUndirectedEntryDistance = best;
    }
  }

  // Directed projected topology (atlas/module structural arcs + authored edges).
  // Undirected metrics remain observational only — they do not admit.
  const hostReports = {};
  let projectionOk = true;
  let worstDiameter = 0;
  let worstScc = 1;
  for (const host of PRODUCT_HOSTS) {
    const declared = host_portability?.[host] ?? 'unsupported';
    const planner = host_planner?.[host];
    if (declared === 'unsupported') {
      hostReports[host] = { covered: false, skipped: true };
      continue;
    }
    let pointFilter = pointIds;
    let moduleFilter = moduleIds;
    if (declared === 'partial') {
      const coveredModules = new Set(
        (composition?.host_coverage ?? [])
          .find((row) => row.host === host)
          ?.covered_modules ?? [],
      );
      moduleFilter = new Set([...moduleIds].filter((id) => coveredModules.has(id)));
      pointFilter = new Set(
        points.filter((point) => moduleFilter.has(point.module_id)).map((point) => point.id),
      );
    }
    const topology = buildExpectedProjectionTopology({
      graph,
      pointIdFilter: pointFilter,
      moduleIdFilter: moduleFilter,
    });
    const gates = evaluateDirectedPointHopGates({
      adjacency: topology.adjacency,
      pointNodes: topology.pointNodes,
      hopPolicy,
    });
    hostReports[host] = {
      covered: true,
      planner_ok: planner?.planner_ok === true,
      scc_count: gates.scc_count,
      diameter: gates.diameter,
      h1_ok: gates.h1Ok,
      h2_ok: gates.h2Ok,
      unreachable: gates.unreachablePair,
    };
    if (!gates.h1Ok || !gates.h2Ok) projectionOk = false;
    if (gates.scc_count > worstScc) worstScc = gates.scc_count;
    if (gates.diameter != null && gates.diameter > worstDiameter) {
      worstDiameter = gates.diameter;
    }
    if (gates.diameter_unreachable) {
      worstDiameter = null;
      projectionOk = false;
    }
  }

  const entryPrimaryMax = hopPolicy?.critical_any_point_to_primary_max ?? null;
  const pointDiameterMax = hopPolicy?.point_diameter_max ?? null;

  return {
    protocol: 'directed_projection_topology',
    entry_roots: uniqueRoots,
    // Authored-only directed (observational — often unreachable without projection arcs).
    authored_directed_diameter:
      authoredDirectedUnreachable.length > 0 ? null : authoredDirectedDiameter,
    authored_directed_unreachable_pair_count: authoredDirectedUnreachable.length,
    authored_directed_unreachable_sample: authoredDirectedUnreachable.slice(0, 8),
    // Projected directed (admission).
    projected_scc_count: worstScc,
    projected_directed_diameter: worstDiameter,
    projected_hosts: hostReports,
    projected_ok: projectionOk,
    // Undirected observational only.
    undirected_entry_distance_max:
      undirectedUnreachable.length > 0 ? null : maxUndirectedEntryDistance,
    undirected_unreachable_from_entry_primary: undirectedUnreachable,
    // Legacy aliases kept for witness shape stability during K3-00.
    directed_diameter: worstDiameter,
    directed_unreachable_pair_count: authoredDirectedUnreachable.length,
    directed_unreachable_sample: authoredDirectedUnreachable.slice(0, 8),
    policy: {
      point_diameter_max: pointDiameterMax,
      entry_discovery_max: hopPolicy?.entry_discovery_max ?? null,
      critical_any_point_to_primary_max: entryPrimaryMax,
    },
  };
}

function readInventoryBudgets(repoRoot, composition) {
  const files = [];
  const missing = [];
  let combined = '';
  for (const entry of composition?.canonical_source_inventory ?? []) {
    const relative = entry.path;
    const absolute = path.join(repoRoot, relative);
    if (!fs.existsSync(absolute)) {
      missing.push(relative);
      continue;
    }
    const text = fs.readFileSync(absolute, 'utf8');
    const budget = estimateBudget(text);
    files.push({ path: relative, ...budget });
    combined += text.endsWith('\n') ? text : `${text}\n`;
  }
  const total = estimateBudget(combined);
  return { files, missing, total };
}

/**
 * Analyze metrics against an already-built graph IR.
 * @param {{ graph: object, moduleIds: string[], composition: object|null, repoRoot?: string }} args
 */
export function computeCandidateMetrics({ graph, moduleIds, composition, repoRoot = null }) {
  const policy = resolveAdmissionPolicy(graph.portfolio);
  const moduleIdSet = new Set(moduleIds);
  const modules = (graph.modules ?? []).filter((module) => moduleIdSet.has(module.id));
  const points = (graph.points ?? []).filter((point) => moduleIdSet.has(point.module_id));
  const pointIds = points.map((point) => point.id).sort();
  const pointIdSet = new Set(pointIds);
  const candidateEdges = (graph.edges ?? []).filter(
    (edge) => pointIdSet.has(edge.from) || pointIdSet.has(edge.to) || moduleIdSet.has(edge.module_id),
  );

  // External edges whose type is on the allowlist express cross-skill navigation
  // or contrast, not content dependency: they are counted separately and do not
  // consume the cut-coupling budget. Every other external type still counts.
  const navExternalTypes = new Set(policy?.external_edge_policy?.allowed_types ?? []);
  let internalEdgeCount = 0;
  let externalEdgeCount = 0;
  let externalNavEdgeCount = 0;
  for (const edge of graph.edges ?? []) {
    const both = pointIdSet.has(edge.from) && pointIdSet.has(edge.to);
    if (both) internalEdgeCount += 1;
    else if (pointIdSet.has(edge.from) || pointIdSet.has(edge.to) || moduleIdSet.has(edge.module_id)) {
      externalEdgeCount += 1;
      if (navExternalTypes.has(edge.type)) externalNavEdgeCount += 1;
    }
  }
  const externalCutCoupling = externalEdgeCount - externalNavEdgeCount;

  const inventoryPointIds = new Set(
    (composition?.canonical_source_inventory ?? []).flatMap((entry) => entry.point_ids ?? []),
  );
  let ssotClosure = true;
  for (const pointId of inventoryPointIds) {
    if (!pointIdSet.has(pointId)) {
      ssotClosure = false;
      break;
    }
  }

  const entryModules = composition?.entry_modules ?? [];
  const triggerJobCoherence = entryModules.every((id) => moduleIdSet.has(id));
  // Single-node (or empty) candidate graphs are vacuously cohesive; multi-point
  // candidates use internal_edges / points (policy thresholds come from schema).
  const internalCohesion =
    points.length < 2 ? 1 : internalEdgeCount / Math.max(points.length, 1);

  const overlapSignature = {};
  for (const other of graph.compositions ?? []) {
    if (!composition || other.id === composition.id) continue;
    if (other.lifecycle?.state !== 'accepted') continue;
    const otherIds = consumeModuleIds(other);
    const shared = otherIds.filter((id) => moduleIdSet.has(id));
    if (shared.length > 0) overlapSignature[other.id] = shared;
  }

  const declaredCoverage = Object.fromEntries(
    (composition?.host_coverage ?? []).map((row) => [row.host, row.state]),
  );
  const hostPortability = {};
  const hostPlanner = {};
  for (const host of PRODUCT_HOSTS) {
    const declared = declaredCoverage[host] ?? 'unsupported';
    const capability =
      repoRoot && composition
        ? projectionCapabilityForHost(repoRoot, composition, host)
        : { state: 'unsupported', planner_ok: false, error: 'missing repoRoot' };
    hostPlanner[host] = {
      declared,
      capability: capability.state,
      planner_ok: capability.planner_ok === true,
      error: capability.error ?? null,
    };
    hostPortability[host] = worseHostState(declared, capability.state);
  }

  const inventory = repoRoot
    ? readInventoryBudgets(repoRoot, composition)
    : { files: [], missing: ['<repoRoot missing>'], total: estimateBudget('') };
  const hop = computeHopWitness({
    modules,
    points,
    edges: candidateEdges,
    composition,
    hopPolicy: graph.portfolio?.hop_policy,
    graph,
    host_portability: hostPortability,
    host_planner: hostPlanner,
  });

  const budgets = {
    hop: {
      observed: {
        protocol: hop.protocol,
        projected_ok: hop.projected_ok,
        projected_scc_count: hop.projected_scc_count,
        projected_directed_diameter: hop.projected_directed_diameter,
        undirected_entry_distance_max: hop.undirected_entry_distance_max,
        directed_diameter: hop.directed_diameter,
        directed_unreachable_pair_count: hop.directed_unreachable_pair_count,
        undirected_unreachable_count: hop.undirected_unreachable_from_entry_primary.length,
      },
      policy: hop.policy,
    },
    read: {
      inventory_files: (composition?.canonical_source_inventory ?? []).length,
      missing_files: inventory.missing,
      files: inventory.files,
      utf8_bytes: inventory.total.utf8_bytes,
      estimated_lines: inventory.total.lines,
      policy_max_lines: policy.inventory_max_lines,
      policy_max_utf8_bytes: policy.inventory_max_utf8_bytes,
      within_read_budget:
        inventory.missing.length === 0 &&
        inventory.total.lines <= policy.inventory_max_lines &&
        inventory.total.utf8_bytes <= policy.inventory_max_utf8_bytes,
    },
    token: {
      estimated_tokens: inventory.total.estimated_tokens,
      policy_max_tokens: policy.inventory_max_tokens,
      within_token_budget:
        inventory.missing.length === 0 &&
        inventory.total.estimated_tokens <= policy.inventory_max_tokens,
    },
  };

  const graph_metrics = {
    module_count: modules.length,
    point_count: points.length,
    internal_edge_count: internalEdgeCount,
    external_edge_count: externalEdgeCount,
    external_nav_edge_count: externalNavEdgeCount,
  };

  const witness_metrics = {
    candidate_modules: [...moduleIds].sort(),
    candidate_points: pointIds,
    trigger_job_coherence: triggerJobCoherence,
    internal_cohesion: Number(internalCohesion.toFixed(6)),
    external_cut_coupling: externalCutCoupling,
    overlap_signature: overlapSignature,
    ssot_closure: ssotClosure,
    budgets,
    host_portability: hostPortability,
    hop,
  };

  const gates = evaluateAdmissionGates({
    graph_metrics,
    witness_metrics,
    policy,
    moduleIds,
    host_planner: hostPlanner,
  });

  return { graph_metrics, witness_metrics, admission_gates: gates, policy };
}

export function evaluateAdmissionGates({
  graph_metrics,
  witness_metrics,
  policy,
  moduleIds,
  host_planner = null,
}) {
  const hosts = witness_metrics.host_portability ?? {};
  const hostStates = PRODUCT_HOSTS.map((host) => hosts[host] ?? 'unsupported');
  const allUnsupported = hostStates.every((state) => state === 'unsupported');
  const fourHostPresent = PRODUCT_HOSTS.every((host) => Object.hasOwn(hosts, host));

  const hop = witness_metrics.hop ?? {};
  const hopOk =
    policy.hop_gate === 'directed_projection_topology'
      ? hop.projected_ok === true &&
        typeof hop.projected_scc_count === 'number' &&
        hop.projected_scc_count === 1 &&
        typeof hop.projected_directed_diameter === 'number' &&
        typeof hop.policy?.point_diameter_max === 'number' &&
        hop.projected_directed_diameter <= hop.policy.point_diameter_max
      : false;

  const overlapSignature = witness_metrics.overlap_signature ?? {};
  const overlapCounts = Object.values(overlapSignature).map((shared) =>
    Array.isArray(shared) ? shared.length : Number.POSITIVE_INFINITY,
  );
  const maxShared = overlapCounts.length === 0 ? 0 : Math.max(...overlapCounts);
  const overlapWithinBudget =
    typeof policy.max_overlap_shared_modules === 'number' &&
    Number.isFinite(maxShared) &&
    maxShared <= policy.max_overlap_shared_modules;

  let declaredProjectionOk = true;
  if (policy.require_declared_projection) {
    for (const host of PRODUCT_HOSTS) {
      const row = host_planner?.[host];
      const declared = row?.declared ?? 'unsupported';
      const effective = hosts[host] ?? 'unsupported';
      if (declared === 'full' || declared === 'partial') {
        if (row && row.planner_ok !== true) {
          declaredProjectionOk = false;
          break;
        }
        if (hostRank(effective) < hostRank(declared)) {
          declaredProjectionOk = false;
          break;
        }
      }
    }
  }

  const gates = {
    module_count_matches_candidate:
      graph_metrics.module_count === moduleIds.length && graph_metrics.module_count > 0,
    point_count_positive: graph_metrics.point_count > 0,
    trigger_job_coherence: witness_metrics.trigger_job_coherence === true,
    ssot_closure: policy.require_ssot_closure ? witness_metrics.ssot_closure === true : true,
    internal_cohesion:
      typeof witness_metrics.internal_cohesion === 'number' &&
      witness_metrics.internal_cohesion >= policy.min_internal_cohesion,
    external_cut:
      typeof policy.max_external_edge_count === 'number'
        ? witness_metrics.external_cut_coupling <= policy.max_external_edge_count
        : true,
    overlap_within_budget: overlapWithinBudget,
    hop: hopOk,
    read_budget: witness_metrics.budgets?.read?.within_read_budget === true,
    token_budget: witness_metrics.budgets?.token?.within_token_budget === true,
    four_host_denominator: policy.require_four_host_denominator ? fourHostPresent : true,
    host_portability:
      (policy.reject_all_hosts_unsupported ? !allUnsupported : true) && declaredProjectionOk,
  };

  return {
    ...gates,
    ok: Object.values(gates).every(Boolean),
  };
}

function metricWitnessForPersistence(witness_metrics, graph_metrics, admission_gates) {
  return {
    candidate_modules: witness_metrics.candidate_modules,
    candidate_points: witness_metrics.candidate_points,
    trigger_job_coherence: witness_metrics.trigger_job_coherence,
    internal_cohesion: witness_metrics.internal_cohesion,
    external_cut_coupling: witness_metrics.external_cut_coupling,
    overlap_signature: witness_metrics.overlap_signature,
    ssot_closure: witness_metrics.ssot_closure,
    budgets: witness_metrics.budgets,
    host_portability: witness_metrics.host_portability,
    hop: witness_metrics.hop,
    graph_metrics,
    admission_gates: {
      ok: admission_gates.ok,
      module_count_matches_candidate: admission_gates.module_count_matches_candidate,
      point_count_positive: admission_gates.point_count_positive,
      trigger_job_coherence: admission_gates.trigger_job_coherence,
      ssot_closure: admission_gates.ssot_closure,
      internal_cohesion: admission_gates.internal_cohesion,
      external_cut: admission_gates.external_cut,
      overlap_within_budget: admission_gates.overlap_within_budget,
      hop: admission_gates.hop,
      read_budget: admission_gates.read_budget,
      token_budget: admission_gates.token_budget,
      four_host_denominator: admission_gates.four_host_denominator,
      host_portability: admission_gates.host_portability,
    },
  };
}

/**
 * Build the deterministic machine-derived half of an authored candidate analysis.
 * Human curation remains explicit in `scoresheet`; graph metrics, budgets, host
 * portability, gates, and verdict are always recomputed from the live graph.
 */
export function createCandidateAnalysisDocument({
  repoRoot,
  graph,
  composition,
  scoresheet,
  reason,
  lifecycle = null,
  admission,
}) {
  const moduleIds = consumeModuleIds(composition);
  const { graph_metrics, witness_metrics, admission_gates } = computeCandidateMetrics({
    graph,
    moduleIds,
    composition,
    repoRoot,
  });
  const verdict = deriveVerdict(scoresheet, admission_gates.ok === true);
  return {
    schema_version: composition.schema_version,
    kind: 'candidate_analysis',
    id: composition.analysis_ref,
    skill_id: composition.skill_id,
    composition_id: composition.id,
    candidate_modules: moduleIds,
    scoresheet,
    graph_metrics,
    verdict,
    witness: {
      reason:
        reason ??
        'D1/D2/D3 与实时图指标、预算、host portability 闸共同导出候选 verdict。',
      composition_id: composition.id,
      ...metricWitnessForPersistence(witness_metrics, graph_metrics, admission_gates),
    },
    lifecycle: lifecycle ?? composition.lifecycle,
    admission,
  };
}

/**
 * Analyze against an already-built graph IR (modules/points/edges/compositions populated).
 */
export function analyzeAgainstGraph({
  repoRoot,
  graph,
  skillId,
  moduleIds,
  analysisId = null,
  compositionId = null,
  composition = null,
  authoredAnalysis = null,
}) {
  const diagnostics = [];
  const fail = (code, message, witness = {}, remediation = '') => {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code,
        message,
        location: analysisId ?? compositionId ?? 'candidate_analysis',
        witness,
        remediation,
        exitCode: 4,
      }),
    );
  };

  const resolvedComposition =
    composition ||
    (compositionId &&
      (graph.compositions ?? []).find((item) => item.id === compositionId)) ||
    (graph.compositions ?? []).find((item) => item.skill_id === skillId) ||
    null;

  const resolvedAnalysisId =
    analysisId ||
    resolvedComposition?.analysis_ref ||
    `analysis:candidate.${skillId.replace(/^skill:/, '')}`;

  const authored =
    authoredAnalysis || loadAnalysisDocument(repoRoot, resolvedAnalysisId);
  if (!authored) {
    fail(
      'SKG-ANALYSIS-MISSING',
      `Candidate analysis is required and missing: ${resolvedAnalysisId}`,
      { analysis_id: resolvedAnalysisId, skill_id: skillId },
      'Author a candidate_analysis with Counterfactual evidence_refs before admit/materialize.',
    );
    return {
      ok: false,
      skill_id: skillId,
      candidate_modules: [...moduleIds].sort(),
      scoresheet: {
        D1: {
          score: 0,
          audience_plane: 'repository-governance',
          evidence: 'analysis missing',
        },
        D2: {
          score: 0,
          bounded_context: 'analysis missing',
          evidence: 'analysis missing',
        },
        D3: {
          probe_a: 'weak',
          probe_b: 'weak',
          evidence: 'analysis missing — Counterfactual probes default weak (fail closed)',
          evidence_refs: [],
        },
      },
      verdict: 'reject',
      derived_verdict: 'reject',
      witness: { reason: 'analysis-missing' },
      graph_metrics: {},
      diagnostics,
    };
  }

  const analysis = authored.doc ?? authored;
  if (analysis.skill_id !== skillId) {
    fail(
      'SKG-ANALYSIS-IDENTITY-MISMATCH',
      `Analysis skill_id does not match composition candidate: ${analysis.skill_id} !== ${skillId}`,
      { analysis_skill_id: analysis.skill_id, expected_skill_id: skillId },
      'Bind analysis.skill_id to the composition skill_id.',
    );
  }
  if (
    compositionId &&
    analysis.composition_id &&
    analysis.composition_id !== compositionId
  ) {
    fail(
      'SKG-ANALYSIS-IDENTITY-MISMATCH',
      `Analysis composition_id does not match composition: ${analysis.composition_id}`,
      {
        analysis_composition_id: analysis.composition_id,
        composition_id: compositionId,
      },
      'Bind analysis.composition_id to the composition id.',
    );
  }
  if (!sameIdSet(analysis.candidate_modules, moduleIds)) {
    fail(
      'SKG-ANALYSIS-MODULE-MISMATCH',
      'Analysis candidate_modules must equal composition consumes module set.',
      {
        analysis_modules: [...(analysis.candidate_modules ?? [])].sort(),
        composition_modules: [...moduleIds].sort(),
      },
      'Keep analysis.candidate_modules lockstep with composition.consumes.modules[].id.',
    );
  }

  const scoresheet = analysis.scoresheet;
  if (
    scoresheet?.D1?.score === 1 &&
    scoresheet?.D1?.audience_plane !== 'runtime-user'
  ) {
    fail(
      'SKG-ANALYSIS-AUDIENCE-PLANE',
      'D1=1 requires the explicit runtime-user audience plane.',
      {
        score: scoresheet?.D1?.score ?? null,
        audience_plane: scoresheet?.D1?.audience_plane ?? null,
      },
      'Classify repository-governance knowledge outside the runtime skill portfolio.',
    );
  }
  if (
    scoresheet?.D2?.score === 1 &&
    String(scoresheet?.D2?.bounded_context ?? '').trim().length === 0
  ) {
    fail(
      'SKG-ANALYSIS-BOUNDED-CONTEXT',
      'D2=1 requires an explicit non-empty bounded_context.',
      { score: scoresheet?.D2?.score ?? null },
      'Name the one cognitive job owned by this composition candidate.',
    );
  }
  const evidenceRefs = scoresheet?.D3?.evidence_refs ?? [];
  const rationale = String(scoresheet?.D3?.evidence ?? '').trim();
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0 || rationale.length === 0) {
    fail(
      'SKG-ANALYSIS-COUNTERFACTUAL-EVIDENCE',
      'Counterfactual Probe A/B requires non-empty evidence and evidence_refs.',
      { evidence_refs: evidenceRefs, evidence: rationale },
      'Record human Counterfactual evidence_refs and rationale; never invent strong probes.',
    );
  }

  const { graph_metrics, witness_metrics, admission_gates } = computeCandidateMetrics({
    graph,
    moduleIds,
    composition: resolvedComposition,
    repoRoot,
  });

  const derivedMetricWitness = metricWitnessForPersistence(
    witness_metrics,
    graph_metrics,
    admission_gates,
  );
  if (stableSerialize(analysis.graph_metrics ?? null) !== stableSerialize(graph_metrics)) {
    fail(
      'SKG-ANALYSIS-METRICS-MISMATCH',
      'Persisted analysis.graph_metrics must equal recomputed graph metrics.',
      {
        stored: analysis.graph_metrics ?? null,
        derived: graph_metrics,
      },
      'Re-run analysis and persist the derived graph_metrics; do not hand-forge counts.',
    );
  }

  const storedWitness = analysis.witness ?? {};
  const extraKeys = Object.keys(storedWitness).filter(
    (key) => !WITNESS_ALLOWED_KEYS.includes(key),
  );
  if (extraKeys.length > 0) {
    fail(
      'SKG-ANALYSIS-WITNESS-EXTRA',
      'Persisted analysis.witness contains keys outside the closed witness set.',
      { extra_keys: extraKeys.sort(), allowed: [...WITNESS_ALLOWED_KEYS] },
      'Remove fabricated witness fields (e.g. untrusted_payload); only persist the closed metric set.',
    );
  }

  const storedMetricWitness = Object.fromEntries(
    WITNESS_METRIC_KEYS.map((key) => [key, storedWitness[key] ?? null]),
  );
  if (stableSerialize(storedMetricWitness) !== stableSerialize(derivedMetricWitness)) {
    fail(
      'SKG-ANALYSIS-WITNESS-MISMATCH',
      'Persisted analysis.witness metrics must equal recomputed witness metrics.',
      {
        stored: storedMetricWitness,
        derived: derivedMetricWitness,
      },
      'Persist the derived witness metrics/gates; forged witness values are rejected.',
    );
  }

  const metricGatesOk = diagnostics.length === 0 && admission_gates.ok === true;
  const derivedVerdict = deriveVerdict(scoresheet, metricGatesOk);
  const storedVerdict = analysis.verdict;
  if (storedVerdict !== derivedVerdict) {
    fail(
      'SKG-ANALYSIS-VERDICT-MISMATCH',
      `Stored analysis verdict must equal derived verdict (${storedVerdict} !== ${derivedVerdict}).`,
      {
        stored_verdict: storedVerdict,
        derived_verdict: derivedVerdict,
        scoresheet,
        graph_metrics,
        admission_gates,
      },
      'Do not hand-edit verdict; re-derive from scoresheet + admission gates and persist the match.',
    );
  }

  const compositionHash = resolvedComposition
    ? sha256Hex(stableSerialize(resolvedComposition))
    : null;

  const witness = {
    reason:
      analysis.witness?.reason ??
      'derived-from-graph-metrics-and-authored-counterfactual',
    composition_id: resolvedComposition?.id ?? compositionId ?? null,
    composition_hash: compositionHash,
    analysis_id: analysis.id,
    analysis_ref: resolvedAnalysisId,
    skill_id: skillId,
    ...derivedMetricWitness,
    counterfactual: {
      audience_plane: scoresheet.D1.audience_plane,
      bounded_context: scoresheet.D2.bounded_context,
      probe_a: scoresheet.D3.probe_a,
      probe_b: scoresheet.D3.probe_b,
      rationale,
      evidence_refs: [...evidenceRefs],
    },
  };

  const ok = diagnostics.length === 0;
  return {
    ok,
    skill_id: skillId,
    candidate_modules: [...moduleIds].sort(),
    scoresheet,
    verdict: ok ? derivedVerdict : 'reject',
    derived_verdict: derivedVerdict,
    stored_verdict: storedVerdict,
    witness,
    graph_metrics,
    admission_gates,
    diagnostics,
  };
}

export function compositionToSkillView(composition) {
  return {
    schema_version: composition.schema_version,
    kind: 'skill',
    id: composition.skill_id,
    name: composition.name,
    package_root: composition.package_root,
    intent: composition.intent,
    modules: consumeModuleRefs(composition),
    entry_modules: composition.entry_modules,
    canonical_source_inventory: composition.canonical_source_inventory,
    host_coverage: composition.host_coverage,
    lifecycle: composition.lifecycle,
    admission: composition.admission,
    _composition_id: composition.id,
    _analysis_ref: composition.analysis_ref,
    _from_composition: true,
  };
}
