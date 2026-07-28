/**
 * Host coverage aggregation and coverage-aware subgraph projection.
 *
 * Overall host mode is full only when every skill coverage row for that host is
 * full (no stub/unsupported mix). Partial hosts compile/verify only the union of
 * full-skill modules + partial covered_modules. Stub/unsupported skills never
 * enter the point/edge/entry/hop/budget denominator.
 *
 * covered_modules that are unknown or owned by another skill are diagnosed and
 * rejected (fail closed) — never silently skipped into the surviving set.
 */
import { PRODUCT_HOSTS } from './compile/paths.mjs';
import { EXIT_CODES } from './contracts.mjs';
import { diagnostic } from './diagnostics.mjs';

function skillRecords(candidateGraph) {
  return (candidateGraph.skills ?? []).map((item) => item.data ?? item);
}

function moduleIdsForSkill(skill) {
  return new Set((skill.modules ?? []).map((item) => item.id));
}

/**
 * @returns {{ plan: Record<string, { mode: string, moduleIds: string[], skillIds: string[], rows: object[] }>, diagnostics: object[] }}
 */
export function resolveHostCoveragePlan(candidateGraph) {
  const skills = skillRecords(candidateGraph);
  const plan = Object.create(null);
  const diagnostics = [];
  for (const host of PRODUCT_HOSTS) {
    const rows = skills.flatMap((skill) =>
      (skill.host_coverage ?? [])
        .filter((row) => row.host === host)
        .map((row) => ({ skillId: skill.id, skill, ...row })),
    );
    if (rows.length === 0) {
      plan[host] = { mode: 'unsupported', moduleIds: [], skillIds: [], rows };
      continue;
    }
    const contributing = rows.filter((row) => row.state === 'full' || row.state === 'partial');
    const abstaining = rows.filter((row) => row.state === 'stub' || row.state === 'unsupported');
    if (contributing.length === 0) {
      const mode = rows.every((row) => row.state === 'unsupported') ? 'unsupported' : 'stub';
      plan[host] = { mode, moduleIds: [], skillIds: [], rows };
      continue;
    }
    const moduleIds = new Set();
    for (const row of contributing) {
      if (row.state === 'full') {
        for (const id of moduleIdsForSkill(row.skill)) moduleIds.add(id);
      } else {
        for (const id of row.covered_modules ?? []) {
          if (!moduleIdsForSkill(row.skill).has(id)) {
            diagnostics.push(
              diagnostic({
                severity: 'error',
                code: 'SKG-HOST-COVERAGE-MODULE-OWNERSHIP',
                message: `covered_modules entry ${id} is not owned by skill ${row.skillId} for host ${host}`,
                location: `skill/${row.skillId}/host_coverage/${host}`,
                witness: {
                  host,
                  skill: row.skillId,
                  module: id,
                  owned_modules: [...moduleIdsForSkill(row.skill)].sort(),
                },
                remediation:
                  'covered_modules may only list modules owned by the declaring skill; remove cross-skill or unknown ids.',
                exitCode: EXIT_CODES.source_contract,
              }),
            );
            continue;
          }
          moduleIds.add(id);
        }
      }
    }
    const allFullNoAbstain =
      contributing.every((row) => row.state === 'full') && abstaining.length === 0;
    plan[host] = {
      mode: allFullNoAbstain ? 'full' : 'partial',
      moduleIds: [...moduleIds].sort(),
      skillIds: [...new Set(contributing.map((row) => row.skillId))].sort(),
      rows,
    };
  }
  return { plan, diagnostics };
}

/** Back-compat helper used by unit tests: host → mode only. */
export function resolveHostCoverageModes(candidateGraph) {
  const { plan } = resolveHostCoveragePlan(candidateGraph);
  const modes = Object.create(null);
  for (const host of PRODUCT_HOSTS) modes[host] = plan[host].mode;
  return modes;
}

function pruneEntrySurfaces(entry, allowedModules, pointIds, hostFilter) {
  const surfaces = [];
  for (const surface of entry.surfaces ?? []) {
    if (hostFilter && surface.host !== hostFilter) continue;
    const targets = (surface.targets ?? []).filter(
      (target) =>
        (target.module && allowedModules.has(target.module)) ||
        (target.point && pointIds.has(target.point)),
    );
    if (targets.length === 0) continue;
    surfaces.push({ ...surface, targets });
  }
  if (surfaces.length === 0) return null;
  return { ...entry, surfaces };
}

/**
 * Project a built compile graph down to the modules allowed for one host.
 * Rebuilds adjacency with the same enabled_by_default filter as graph.mjs.
 * Trims skill module refs, entry surfaces/targets (current host only when
 * `host` is provided), and access membership so excluded IDs cannot appear
 * in the partial denominator.
 */
export function projectCoverageSubgraph(graph, moduleIds, { host = null } = {}) {
  const allowed = new Set(moduleIds ?? []);
  const points = (graph.points ?? []).filter((item) => allowed.has(item.module_id));
  const pointIds = new Set(points.map((item) => item.id));
  const edges = (graph.edges ?? []).filter(
    (item) => pointIds.has(item.from) && pointIds.has(item.to),
  );
  const skills = (graph.skills ?? [])
    .map((skill) => {
      const skillModules = (skill.modules ?? []).filter((ref) => allowed.has(ref.id));
      if (skillModules.length === 0) return null;
      return {
        ...skill,
        modules: skillModules,
        entry_modules: (skill.entry_modules ?? []).filter((id) => allowed.has(id)),
      };
    })
    .filter(Boolean);
  const entries = (graph.entries ?? [])
    .map((entry) => pruneEntrySurfaces(entry, allowed, pointIds, host))
    .filter(Boolean);
  const survivingEntryIds = new Set(entries.map((item) => item.id));

  const modules = (graph.modules ?? [])
    .filter((item) => allowed.has(item.id))
    .map((module) => {
      const primary = (module.access?.primary_points ?? []).filter((id) => {
        const point = points.find((item) => item.id === id);
        return point && allowed.has(point.module_id);
      });
      const relevant = (module.access?.relevant_entries ?? []).filter((id) =>
        survivingEntryIds.has(id),
      );
      return {
        ...module,
        access: module.access
          ? {
              ...module.access,
              primary_points: primary,
              relevant_entries: relevant,
            }
          : module.access,
      };
    });

  const adjacency = new Map();
  for (const pointId of pointIds) adjacency.set(pointId, []);
  for (const edge of edges) {
    if (edge.runtime?.enabled_by_default === false) continue;
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push({
      to: edge.to,
      edge_id: edge.id,
      type: edge.type,
    });
  }
  for (const [from, list] of adjacency) {
    list.sort((left, right) => {
      const byTo = left.to.localeCompare(right.to);
      if (byTo !== 0) return byTo;
      return left.edge_id.localeCompare(right.edge_id);
    });
    adjacency.set(from, list);
  }

  const span_hashes = Object.fromEntries(
    Object.entries(graph.span_hashes ?? {}).filter(([id]) => pointIds.has(id)),
  );
  const spans = (graph.spans ?? []).filter((item) => pointIds.has(item.point_id));

  return {
    ...graph,
    skills,
    modules,
    points,
    edges,
    entries,
    span_hashes,
    spans,
    adjacency,
    counts: {
      ...(graph.counts ?? {}),
      skill: skills.length,
      module: modules.length,
      point: points.length,
      edge: edges.length,
      entry: entries.length,
    },
  };
}
