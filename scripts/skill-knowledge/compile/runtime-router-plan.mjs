import {
  canonicalBindingToDistPath,
  moduleAnchorId,
  skillAnchorId,
} from './paths.mjs';

const ATLAS_SKILL_ID = 'skill:master-orchestrator-guide';

function placementPoint(module, graph) {
  const pointById = new Map((graph.points ?? []).map((point) => [point.id, point]));
  for (const pointId of module.access?.primary_points ?? []) {
    const point = pointById.get(pointId);
    if (point?.module_id === module.id) return point;
  }
  return (graph.points ?? [])
    .filter((point) => point.module_id === module.id)
    .sort((left, right) => left.id.localeCompare(right.id))[0] ?? null;
}

/**
 * Deterministic placement of the existing atlas/module router topology onto
 * accepted runtime skill Markdown. Placement is projection evidence only:
 * graph membership and authority remain owned by accepted compositions.
 */
export function buildRuntimeRouterPlan({ host, graph }) {
  const atlas = {
    path: `plugin/dist/${host}/skills/master-orchestrator-guide/SKILL.md`,
    fragment: `#${skillAnchorId(ATLAS_SKILL_ID)}`,
  };
  const modules = new Map();
  for (const module of [...(graph.modules ?? [])].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const point = placementPoint(module, graph);
    const placementPath =
      point && canonicalBindingToDistPath(host, point.binding?.path);
    if (!placementPath) continue;
    modules.set(module.id, {
      path: placementPath,
      fragment: `#${moduleAnchorId(module.id)}`,
      point_id: point.id,
    });
  }
  return { atlas, modules };
}
