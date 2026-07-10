import dagre from '@dagrejs/dagre';
import type { GraphRank, ViewModelPayload } from './types';

export type GraphOrientation = 'vertical' | 'horizontal';

// Instrument-tile dims (legacy viewer): the node box dagre lays out.
export const NODE_W = 200;
export const NODE_H = 92;

// Legacy dagre parameters — also the band grid the rank snap reproduces.
export const NODESEP = 48;
export const RANKSEP = 80;
export const LAYOUT_MARGIN = 28;

// Rank-band padding: along the rank axis (from the member bbox) and across it
// (how far the swimlane extends beyond the graph bbox on the cross axis).
export const BAND_PAD = 16;
export const BAND_CROSS_PAD = 44;

export interface VisibleGraph {
  /** task ids visible after collapsing (children of collapsed owners hidden) */
  visibleIds: Set<string>;
  /** hidden child ids */
  hidden: Set<string>;
  /** rerouted, deduped dep-edge pairs [source, target] over the visible set */
  edgePairs: Array<[string, string]>;
  /** map a (possibly hidden) id up to its visible stand-in (its owner when folded) */
  reroute: (id: string) => string;
}

/**
 * Visible-set + edge reroute for owner collapse (legacy nested-DAG semantics): a collapsed
 * owner's children are hidden and their cross-group dependency edges reroute to/from the
 * owner so the DAG stays connected. With no nesting this is a no-op.
 */
export function computeVisibleGraph(
  viewModel: ViewModelPayload,
  collapsed: Set<string>,
): VisibleGraph {
  const parents = viewModel.graph.parents ?? {};
  const ids = new Set(viewModel.graph.nodes.map((node) => node.id));
  const owners = new Set(
    Object.values(parents).filter((owner): owner is string => !!owner && ids.has(owner)),
  );

  const hidden = new Set<string>();
  for (const id of ids) {
    const owner = parents[id];
    if (owner && collapsed.has(owner) && owners.has(owner)) hidden.add(id);
  }
  const reroute = (id: string): string => {
    if (!hidden.has(id)) return id;
    const owner = parents[id];
    return owner && !hidden.has(owner) ? owner : id; // owners are depth-1, always visible
  };
  const visibleIds = new Set([...ids].filter((id) => !hidden.has(id)));

  const pairSeen = new Set<string>();
  const edgePairs: Array<[string, string]> = [];
  for (const edge of viewModel.graph.edges) {
    if (edge.type === 'parent') continue; // containment is rendered by nesting, not an arrow
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    const source = reroute(edge.source);
    const target = reroute(edge.target);
    if (source === target || !visibleIds.has(source) || !visibleIds.has(target)) continue;
    const key = `${source}\u0000${target}`;
    if (pairSeen.has(key)) continue;
    pairSeen.add(key);
    edgePairs.push([source, target]);
  }

  return { visibleIds, hidden, edgePairs, reroute };
}

/** One rank swimlane's geometry (flow coordinates) + its visible members. */
export interface RankBand {
  /** server rank id (`R0`..`Rn`) */
  id: string;
  label: string;
  /** server rank index (position in `graph.ranks`) */
  index: number;
  /** visible member node ids (hidden collapsed children excluded) */
  nodeIds: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphLayout {
  positions: Map<string, { x: number; y: number }>;
  bands: RankBand[];
  /**
   * true when dagre's own ranking matched the server ranks verbatim (no correction);
   * false when the server-rank fallback row snap had to be applied.
   */
  rankConsistent: boolean;
}

const EPS = 0.5;

/**
 * Double-decker layout (spec §3.2, scheme A): the server view-model `graph.ranks`
 * (longest-path layering) is the stage SSOT — the client never re-derives ranks.
 *
 * 1. dagre runs normally over the visible set (legacy parameters: nodesep 48 /
 *    ranksep 80 / margin 28, 200x92 tiles; `rankdir` follows orientation). Each dep
 *    edge carries `minlen = serverRank(target) - serverRank(source)` so dagre's
 *    network-simplex ranking is steered onto the server layering (any zero-slack
 *    solution then reproduces it exactly), keeping dagre's organic crossing
 *    minimization / coordinate assignment intact.
 * 2. The result is asserted against the server ranks: every visible member of a rank
 *    must share one rank-axis coordinate and rank rows must be strictly monotonic.
 * 3. On mismatch (possible when collapse-reroute bends an edge backwards) positions
 *    are corrected: rank axis snaps to uniform server-rank rows, in-row axis keeps
 *    dagre's ordering/coordinates with a min-gap sweep so tiles never overlap.
 *
 * Also emits per-rank swimlane bounding boxes (band geometry) for the background
 * band layer.
 */
export function layoutGraph(
  visibleIds: Set<string>,
  edgePairs: Array<[string, string]>,
  orientation: GraphOrientation,
  ranks?: GraphRank[],
): GraphLayout {
  const horizontal = orientation === 'horizontal';

  // Server rank index per visible node (SSOT; array order == ascending rank).
  const rankIndexById = new Map<string, number>();
  const rankList = Array.isArray(ranks) ? ranks : [];
  rankList.forEach((rank, index) => {
    for (const id of rank.node_ids ?? []) {
      if (visibleIds.has(id)) rankIndexById.set(id, index);
    }
  });
  const ranksKnown = rankList.length > 0 && [...visibleIds].every((id) => rankIndexById.has(id));

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: horizontal ? 'LR' : 'TB',
    nodesep: NODESEP,
    ranksep: RANKSEP,
    marginx: LAYOUT_MARGIN,
    marginy: LAYOUT_MARGIN,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of visibleIds) g.setNode(id, { width: NODE_W, height: NODE_H });
  for (const [source, target] of edgePairs) {
    if (source === target || !visibleIds.has(source) || !visibleIds.has(target)) continue;
    const sRank = rankIndexById.get(source);
    const tRank = rankIndexById.get(target);
    const minlen =
      ranksKnown && sRank !== undefined && tRank !== undefined ? Math.max(1, tRank - sRank) : 1;
    g.setEdge(source, target, { minlen });
  }
  dagre.layout(g);

  const positions = new Map<string, { x: number; y: number }>();
  for (const id of visibleIds) {
    const node = g.node(id);
    if (node) positions.set(id, { x: node.x - NODE_W / 2, y: node.y - NODE_H / 2 });
  }

  // Group visible nodes by server rank (fallback: bucket dagre's own rank axis).
  const primaryOf = (pos: { x: number; y: number }) => (horizontal ? pos.x : pos.y);
  const secondaryOf = (pos: { x: number; y: number }) => (horizontal ? pos.y : pos.x);
  const rowExtent = horizontal ? NODE_W : NODE_H;
  const secExtent = horizontal ? NODE_H : NODE_W;

  let groups: Array<{ id: string; label: string; index: number; nodeIds: string[] }>;
  let rankConsistent = true;

  if (ranksKnown) {
    groups = rankList
      .map((rank, index) => ({
        id: rank.id || `R${index}`,
        label: rank.label || rank.id || `R${index}`,
        index,
        nodeIds: (rank.node_ids ?? []).filter((id) => visibleIds.has(id)),
      }))
      .filter((group) => group.nodeIds.length > 0);

    // Assert dagre's layering equals the server ranks (spec §3.2 scheme A).
    let prevPrimary = Number.NEGATIVE_INFINITY;
    outer: for (const group of groups) {
      const firstId = group.nodeIds[0];
      const first = firstId ? positions.get(firstId) : undefined;
      if (!first) {
        rankConsistent = false;
        break;
      }
      const rowPrimary = primaryOf(first);
      for (const id of group.nodeIds) {
        const pos = positions.get(id);
        if (!pos || Math.abs(primaryOf(pos) - rowPrimary) > EPS) {
          rankConsistent = false;
          break outer;
        }
      }
      if (rowPrimary <= prevPrimary + EPS) {
        rankConsistent = false;
        break;
      }
      prevPrimary = rowPrimary;
    }

    if (!rankConsistent) {
      // Correction: snap the rank axis to uniform server-rank rows; keep dagre's
      // in-row coordinates, sweeping a minimum gap so tiles never overlap.
      groups.forEach((group, row) => {
        const rowPrimary = LAYOUT_MARGIN + row * (rowExtent + RANKSEP);
        const members = [...group.nodeIds].sort((a, b) => {
          const pa = positions.get(a);
          const pb = positions.get(b);
          const diff = (pa ? secondaryOf(pa) : 0) - (pb ? secondaryOf(pb) : 0);
          return diff !== 0 ? diff : a.localeCompare(b);
        });
        let cursor = Number.NEGATIVE_INFINITY;
        for (const id of members) {
          const pos = positions.get(id) ?? { x: LAYOUT_MARGIN, y: LAYOUT_MARGIN };
          const sec = Math.max(secondaryOf(pos), cursor);
          cursor = sec + secExtent + NODESEP;
          positions.set(id, horizontal ? { x: rowPrimary, y: sec } : { x: sec, y: rowPrimary });
        }
      });
    }
  } else {
    // No server ranks (older server / fixtures without ranks): bucket dagre's own
    // rank-axis coordinates so bands still render coherently.
    const buckets = new Map<number, string[]>();
    for (const id of visibleIds) {
      const pos = positions.get(id);
      if (!pos) continue;
      const key = Math.round(primaryOf(pos) * 2) / 2;
      const bucket = buckets.get(key) ?? [];
      bucket.push(id);
      buckets.set(key, bucket);
    }
    groups = [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, nodeIds], index) => ({
        id: `R${index}`,
        label: `R${index}`,
        index,
        nodeIds: nodeIds.sort(),
      }));
  }

  // Band geometry: rank-axis span from the member bbox (+pad), cross-axis span from
  // the whole-graph bbox (+pad) so every lane reads as a full-width/height stripe.
  let crossMin = Number.POSITIVE_INFINITY;
  let crossMax = Number.NEGATIVE_INFINITY;
  for (const pos of positions.values()) {
    const sec = secondaryOf(pos);
    if (sec < crossMin) crossMin = sec;
    if (sec + secExtent > crossMax) crossMax = sec + secExtent;
  }
  const bands: RankBand[] = [];
  if (Number.isFinite(crossMin) && Number.isFinite(crossMax)) {
    const crossStart = crossMin - BAND_CROSS_PAD;
    const crossSize = crossMax - crossMin + BAND_CROSS_PAD * 2;
    for (const group of groups) {
      let pMin = Number.POSITIVE_INFINITY;
      let pMax = Number.NEGATIVE_INFINITY;
      for (const id of group.nodeIds) {
        const pos = positions.get(id);
        if (!pos) continue;
        const p = primaryOf(pos);
        if (p < pMin) pMin = p;
        if (p + rowExtent > pMax) pMax = p + rowExtent;
      }
      if (!Number.isFinite(pMin)) continue;
      const pStart = pMin - BAND_PAD;
      const pSize = pMax - pMin + BAND_PAD * 2;
      bands.push({
        id: group.id,
        label: group.label,
        index: group.index,
        nodeIds: group.nodeIds,
        x: horizontal ? pStart : crossStart,
        y: horizontal ? crossStart : pStart,
        width: horizontal ? pSize : crossSize,
        height: horizontal ? crossSize : pSize,
      });
    }
  }

  return { positions, bands, rankConsistent };
}
