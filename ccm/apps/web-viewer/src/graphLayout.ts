import type { GraphEdge, GraphNode, GraphRank, ViewModelPayload } from './types';

export type GraphOrientation = 'vertical' | 'horizontal';
export type ManualNodePositions = Record<string, { x: number; y: number }>;

export interface PositionedNode extends GraphNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoutedEdge extends GraphEdge {
  id: string;
  path: string;
  midX: number;
  midY: number;
}

export interface GraphLayout {
  width: number;
  height: number;
  ranks: GraphRank[];
  nodes: PositionedNode[];
  edges: RoutedEdge[];
}

const nodeWidth = 164;
const nodeHeight = 38;
const rankGap = 92;
const laneGap = 54;
const padding = 54;

function ranksFromPayload(viewModel: ViewModelPayload): GraphRank[] {
  if (viewModel.graph.ranks?.length) {
    return viewModel.graph.ranks;
  }

  const groups = new Map<string, string[]>();
  for (const node of viewModel.graph.nodes) {
    const rankId = node.rank ?? `R${node.rank_index ?? 0}`;
    const ids = groups.get(rankId) ?? [];
    ids.push(node.id);
    groups.set(rankId, ids);
  }

  return [...groups.entries()].map(([id, nodeIds]) => ({
    id,
    label: id,
    node_ids: nodeIds
  }));
}

export function layoutGraph(
  viewModel: ViewModelPayload,
  orientation: GraphOrientation,
  focusNodeId: string | null,
  manualPositions: ManualNodePositions = {}
): GraphLayout {
  const nodesById = new Map(viewModel.graph.nodes.map((node) => [node.id, node]));
  const ranks = ranksFromPayload(viewModel);
  const maxLaneCount = Math.max(...ranks.map((rank) => rank.node_ids.length), 1);
  const nodes: PositionedNode[] = [];

  for (const [rankIndex, rank] of ranks.entries()) {
    const count = Math.max(rank.node_ids.length, 1);
    for (const [laneIndex, nodeId] of rank.node_ids.entries()) {
      const node = nodesById.get(nodeId);
      if (!node) {
        continue;
      }

      const centeredLane = laneIndex - (count - 1) / 2;
      const normalizedLane = centeredLane + (maxLaneCount - 1) / 2;
      const primary = padding + rankIndex * rankGap;
      const secondary = padding + normalizedLane * (nodeWidth + laneGap);

      const selected = node.id === focusNodeId || node.selected;
      const manual = manualPositions[node.id];
      nodes.push({
        ...node,
        selected,
        width: nodeWidth,
        height: nodeHeight,
        x: manual?.x ?? (orientation === 'horizontal' ? primary : secondary),
        y: manual?.y ?? (orientation === 'horizontal' ? secondary : primary)
      });
    }
  }

  const positionedById = new Map(nodes.map((node) => [node.id, node]));
  const edges: RoutedEdge[] = viewModel.graph.edges.flatMap((edge, index) => {
    const source = positionedById.get(edge.source);
    const target = positionedById.get(edge.target);
    if (!source || !target) {
      return [];
    }

    const startX =
      orientation === 'horizontal' ? source.x + source.width : source.x + source.width / 2;
    const startY =
      orientation === 'horizontal' ? source.y + source.height / 2 : source.y + source.height;
    const endX = orientation === 'horizontal' ? target.x : target.x + target.width / 2;
    const endY = orientation === 'horizontal' ? target.y + target.height / 2 : target.y;
    const midX = orientation === 'horizontal' ? (startX + endX) / 2 : startX;
    const midY = orientation === 'horizontal' ? startY : (startY + endY) / 2;
    const path =
      orientation === 'horizontal'
        ? `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`
        : `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;

    return [
      {
        ...edge,
        id: edge.id ?? `${edge.source}-${edge.target}-${index}`,
        path,
        midX,
        midY
      }
    ];
  });

  const baseGraphWidth =
    orientation === 'horizontal'
      ? padding * 2 + Math.max(ranks.length - 1, 0) * rankGap + nodeWidth
      : padding * 2 + maxLaneCount * nodeWidth + Math.max(maxLaneCount - 1, 0) * laneGap;
  const baseGraphHeight =
    orientation === 'horizontal'
      ? padding * 2 + maxLaneCount * nodeHeight + Math.max(maxLaneCount - 1, 0) * laneGap
      : padding * 2 + Math.max(ranks.length - 1, 0) * rankGap + nodeHeight;
  const graphWidth = Math.max(
    baseGraphWidth,
    ...nodes.map((node) => node.x + node.width + padding)
  );
  const graphHeight = Math.max(
    baseGraphHeight,
    ...nodes.map((node) => node.y + node.height + padding)
  );

  return {
    width: graphWidth,
    height: graphHeight,
    ranks,
    nodes,
    edges
  };
}
