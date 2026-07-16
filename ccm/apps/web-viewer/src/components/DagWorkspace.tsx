import type { Edge, NodeChange } from '@xyflow/react';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  ViewportPortal,
} from '@xyflow/react';
import { RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lineageFor, perNodeStructure, tasksOf } from '../analytics';
import { minimapColor, normalizeStatus, startTs } from '../format';
import { type LocateRequest, prefersReducedMotion } from '../locate';
import {
  computeVisibleGraph,
  type GraphOrientation,
  layoutGraph,
  NODE_H,
  NODE_W,
  type RankBand,
} from '../graphLayout';
import { nodeMatchesTaskFilters } from '../taskFilters';
import type { CompactTask, ViewModelPayload } from '../types';
import { type CcFlowNode, CcNode, type CcNodeData } from './CcNode';
import { Legend } from './Legend';

export type { GraphOrientation } from '../graphLayout';

interface DagWorkspaceProps {
  viewModel: ViewModelPayload;
  orientation: GraphOrientation;
  query: string;
  activeFilters: Set<string>;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string | null) => void;
  onToggleFilter: (filter: string) => void;
  resetKey: number;
  theme: 'dark' | 'light';
  locateRequest: LocateRequest | null;
  onResetLayout: () => void;
}

const nodeTypes = { cc: CcNode };

/**
 * Rank swimlane background layer (spec §3.2 point 3): one faint alternating stripe
 * per server rank behind the tiles, with an `R<n> · done/total` telemetry label.
 * Rendered inside the xyflow viewport (flow coordinates) so it pans/zooms with the
 * graph; z-index below tiles + pointer-events none keep it purely ambient.
 */
function RankBandLayer({
  bands,
  horizontal,
  doneCounts,
}: {
  bands: RankBand[];
  horizontal: boolean;
  doneCounts: Map<string, number>;
}) {
  if (bands.length === 0) return null;
  return (
    <ViewportPortal>
      {bands.map((band, index) => (
        <div
          className={`rankband${index % 2 === 1 ? ' alt' : ''}${horizontal ? ' horizontal' : ''}`}
          data-band-id={band.id}
          data-band-x={Math.round(band.x)}
          data-band-y={Math.round(band.y)}
          data-band-w={Math.round(band.width)}
          data-band-h={Math.round(band.height)}
          key={band.id}
          style={{
            transform: `translate(${band.x}px, ${band.y}px)`,
            width: band.width,
            height: band.height,
          }}
        >
          <span className="rblabel">
            {band.label}
            <span className="rbcount">
              {' '}
              · {doneCounts.get(band.id) ?? 0}/{band.nodeIds.length} done
            </span>
          </span>
        </div>
      ))}
    </ViewportPortal>
  );
}

function queryMatches(
  node: { id: string; title: string; tags?: string[] },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (node.id.toLowerCase().includes(q)) return true;
  if ((node.title || '').toLowerCase().includes(q)) return true;
  return (node.tags ?? []).some((tag) => tag.toLowerCase().includes(q));
}

function DagCanvas({
  viewModel,
  orientation,
  query,
  activeFilters,
  selectedTaskId,
  onSelectTask,
  onToggleFilter,
  resetKey,
  theme,
  locateRequest,
  onResetLayout,
}: DagWorkspaceProps) {
  const rf = useReactFlow();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [dragNonce, setDragNonce] = useState(0);
  const [zoomPct, setZoomPct] = useState(100);
  const posRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const bandsRef = useRef<RankBand[]>([]);
  const topoKeyRef = useRef('');
  const firstPaintRef = useRef(true);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Topology-change discipline: the server's rev.topologyHash (deps + parent edges) is the
  // structural signature. Status-only polls reuse dagre positions and never refit; only a
  // topology / collapse / orientation / reset change re-lays-out + refits (padding 0.16).
  const topoKey = `${
    viewModel.rev?.topologyHash ?? viewModel.graph.nodes.map((node) => node.id).join(',')
  }|${[...collapsed].sort().join(',')}|${orientation}|${resetKey}`;

  const visible = useMemo(() => computeVisibleGraph(viewModel, collapsed), [viewModel, collapsed]);

  if (topoKeyRef.current !== topoKey) {
    const layout = layoutGraph(
      visible.visibleIds,
      visible.edgePairs,
      orientation,
      viewModel.graph.ranks,
    );
    posRef.current = layout.positions;
    bandsRef.current = layout.bands;
    topoKeyRef.current = topoKey;
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        // Auto refit (topology change / reset layout / board switch) caps at 150% so a
        // 2-node board doesn't blow up to fill the canvas; manual zoom still reaches 200%.
        rf.fitView({ padding: 0.16, maxZoom: 1.5 });
      } catch {
        /* canvas not measured yet — the next topology change refits */
      }
    }, 30);
    return () => clearTimeout(timer);
  }, [topoKey, rf]);

  // Click-to-locate (graph): pan/zoom so the clicked node sits centered in the canvas.
  // Keyed solely on the locate nonce — poll-driven re-renders and topology refits never
  // re-trigger it, and a view-switch remount doesn't replay the last click (mount guard).
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const locateMountRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires per user click only (nonce); graph state is read through refs
  useEffect(() => {
    if (!locateMountRef.current) {
      locateMountRef.current = true;
      return;
    }
    if (!locateRequest) return;
    const graph = visibleRef.current;
    const targetId = graph.visibleIds.has(locateRequest.taskId)
      ? locateRequest.taskId
      : graph.reroute(locateRequest.taskId);
    const position = posRef.current.get(targetId);
    if (!position) return;
    rf.setCenter(position.x + NODE_W / 2, position.y + NODE_H / 2, {
      // Same 150% ceiling as the auto-fit paths, floor stays 0.85 so a locate never lands
      // too zoomed-out to read the tile.
      zoom: Math.min(Math.max(rf.getZoom(), 0.85), 1.5),
      duration: prefersReducedMotion() ? 0 : 420,
    });
  }, [locateRequest, rf]);

  const filtersActive = activeFilters.size > 0 || query.trim() !== '';

  const built = useMemo(() => {
    const entrance = firstPaintRef.current && viewModel.graph.nodes.length <= 150;
    const insights = viewModel.insights;
    const criticalSet = new Set(viewModel.graph.critical_path ?? []);
    const parents = viewModel.graph.parents ?? {};
    const idSet = new Set(viewModel.graph.nodes.map((node) => node.id));
    const owners = new Set(
      Object.values(parents).filter((owner): owner is string => !!owner && idSet.has(owner)),
    );
    const tasksById = new Map<string, CompactTask>(
      tasksOf(viewModel).map((task) => [task.id, task]),
    );
    const statusById = new Map(viewModel.graph.nodes.map((node) => [node.id, node.status]));
    const lineage = lineageFor(viewModel, selectedTaskId);
    const bottleneckId = insights?.bottleneck?.id ?? null;
    const kidSet =
      selectedTaskId && owners.has(selectedTaskId) ? lineage.children : new Set<string>();

    const visibleNodes = viewModel.graph.nodes.filter((node) => visible.visibleIds.has(node.id));
    const nodes: CcFlowNode[] = visibleNodes.map((node, index) => {
      const task = tasksById.get(node.id);
      const status = normalizeStatus(String(node.status ?? ''));
      const userGate = node.awaiting_user === true;
      const position = posRef.current.get(node.id) ?? { x: 0, y: 0 };
      let lineageMark: CcNodeData['lineage'] = null;
      if (selectedTaskId) {
        if (node.id === selectedTaskId) lineageMark = 'self';
        else if (lineage.ancestors.has(node.id)) lineageMark = 'anc';
        else if (lineage.descendants.has(node.id)) lineageMark = 'desc';
        else if (kidSet.has(node.id)) lineageMark = 'child';
      }
      const isOwner = owners.has(node.id);
      const childIds = isOwner
        ? Object.entries(parents)
            .filter(([, owner]) => owner === node.id)
            .map(([id]) => id)
        : [];
      const childDone = childIds.filter((id) => {
        const childStatus = normalizeStatus(String(statusById.get(id) ?? ''));
        return childStatus === 'done' || childStatus === 'verified';
      }).length;
      const childOf = parents[node.id] ?? null;
      const structure = perNodeStructure(insights, node.id);
      const dimmed =
        filtersActive &&
        !(nodeMatchesTaskFilters(node, activeFilters) && queryMatches(node, query));
      return {
        id: node.id,
        type: 'cc' as const,
        position,
        width: NODE_W,
        height: NODE_H,
        selected: node.id === selectedTaskId,
        data: {
          id: node.id,
          title: node.title,
          status,
          crit: criticalSet.has(node.id) || node.critical === true,
          userGate,
          bottleneck: bottleneckId === node.id,
          impact: structure.impact,
          inDeg: structure.inDeg,
          dispatchedAt: status === 'in_flight' && task ? startTs(task) : null,
          lineage: lineageMark,
          enter: entrance,
          order: index,
          isOwner,
          collapsed: isOwner && collapsed.has(node.id),
          ownerChildCount: childIds.length,
          ownerDone: childDone,
          childOf: childOf && visible.visibleIds.has(childOf) ? childOf : null,
          dimmed,
          horizontal: orientation === 'horizontal',
          routeOutcome: node.route_outcome ?? null,
          routeLabel: node.surface_label ?? null,
          modelLabel: node.model
            ? `${node.model}${node.role_grades?.length ? ` · ${node.role_grades.join('/')}` : ''}`
            : null,
          onToggleCollapse: toggleCollapse,
        },
      };
    });

    // Lineage edge set: edges fully inside the dependency chain to/from the selection
    // (rerouted ids so a collapsed owner's lineage still reads).
    const linNodes = new Set<string>();
    if (selectedTaskId) {
      linNodes.add(visible.reroute(selectedTaskId));
      for (const id of lineage.ancestors) linNodes.add(visible.reroute(id));
      for (const id of lineage.descendants) linNodes.add(visible.reroute(id));
    }

    const edges: Edge[] = visible.edgePairs.map(([source, target]) => {
      const onCrit = criticalSet.has(source) && criticalSet.has(target);
      let onLin = false;
      if (selectedTaskId && linNodes.has(source) && linNodes.has(target)) {
        const sAnc = source === selectedTaskId || lineage.ancestors.has(source);
        const tAnc = target === selectedTaskId || lineage.ancestors.has(target);
        const sDesc = source === selectedTaskId || lineage.descendants.has(source);
        const tDesc = target === selectedTaskId || lineage.descendants.has(target);
        onLin = (sAnc && tAnc) || (sDesc && tDesc);
      }
      return {
        id: `${source}->${target}`,
        source,
        target,
        type: 'smoothstep',
        className: onLin ? 'edge-lin' : undefined,
        animated: onCrit || onLin,
        style: onLin
          ? { stroke: 'var(--ready)', strokeWidth: 2.2 }
          : onCrit
            ? { stroke: 'var(--spine)', strokeWidth: 2.4 }
            : { stroke: 'var(--edge)', strokeWidth: 1.3, opacity: 0.75 },
      };
    });

    return { nodes, edges };
    // dragNonce re-derives node positions after a manual drag is persisted into posRef;
    // resetKey does the same after `onResetLayout` re-lays-out posRef via the topoKey
    // mismatch above — without it this memo stays cached on the pre-reset (dragged)
    // positions since neither is otherwise read inside the callback body.
  }, [
    viewModel,
    visible,
    selectedTaskId,
    activeFilters,
    query,
    collapsed,
    orientation,
    toggleCollapse,
    filtersActive,
    dragNonce,
    resetKey,
  ]);

  useEffect(() => {
    firstPaintRef.current = false;
  }, []);

  const [nodes, setNodes] = useState<CcFlowNode[]>(built.nodes);
  useEffect(() => {
    setNodes(built.nodes);
  }, [built.nodes]);

  const onNodesChange = useCallback((changes: NodeChange<CcFlowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const onNodeDragStop = useCallback((_event: unknown, node: CcFlowNode) => {
    // Manual position survives status-only polls until the next topology change.
    posRef.current.set(node.id, node.position);
    setDragNonce((value) => value + 1);
  }, []);

  // Per-band done tallies for the `R<n> · x/y done` label; recomputed on every poll
  // (status-only changes move the tally without touching band geometry).
  // biome-ignore lint/correctness/useExhaustiveDependencies: topoKey re-reads bandsRef after re-layout
  const bandDoneCounts = useMemo(() => {
    const statusById = new Map(viewModel.graph.nodes.map((node) => [node.id, node.status]));
    const counts = new Map<string, number>();
    for (const band of bandsRef.current) {
      let done = 0;
      for (const id of band.nodeIds) {
        const status = normalizeStatus(String(statusById.get(id) ?? ''));
        if (status === 'done' || status === 'verified') done += 1;
      }
      counts.set(band.id, done);
    }
    return counts;
  }, [viewModel, topoKey]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const node of viewModel.graph.nodes) {
      const status = normalizeStatus(String(node.status ?? ''));
      counts[status] = (counts[status] ?? 0) + 1;
    }
    return counts;
  }, [viewModel]);

  const activeStatusFilters = useMemo(
    () => new Set([...activeFilters].filter((filter) => filter.startsWith('status:'))),
    [activeFilters],
  );

  const nodeCount = viewModel.graph.nodes.length;
  // Dense-graph degradation (spec §3.2 point 7): >150 nodes turns off sustained
  // animations (gatehalo / gateflag pulse / orbit arc) — the in_flight lamp breath stays.
  const calm = nodeCount > 150;

  return (
    <div
      className={`dag-stage${selectedTaskId ? ' has-selection' : ''}${calm ? ' calm' : ''}`}
      id="flow"
    >
      <ReactFlow
        edges={built.edges}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.16, maxZoom: 1.5 }}
        minZoom={0.1}
        nodeTypes={nodeTypes}
        nodes={nodes}
        nodesConnectable={false}
        nodesDraggable
        onMove={(_event, viewport) => setZoomPct(Math.round(viewport.zoom * 100))}
        onNodeClick={(_event, node) => onSelectTask(node.id)}
        onNodeDragStop={onNodeDragStop}
        onNodesChange={onNodesChange}
        onPaneClick={() => onSelectTask(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--grid)" gap={22} size={1} variant={BackgroundVariant.Dots} />
        <RankBandLayer
          bands={bandsRef.current}
          doneCounts={bandDoneCounts}
          horizontal={orientation === 'horizontal'}
        />
        <Panel className="zoomreadout" position="top-left">
          <span className="zl">zoom</span>
          <span className="zv">{zoomPct}%</span>
        </Panel>
        <Controls position="top-right" showInteractive={false}>
          <ControlButton
            aria-label="Reset layout"
            className="ctl-reset-layout"
            onClick={onResetLayout}
            title="reset layout — clear manual node positions and refit"
          >
            <RotateCcw aria-hidden="true" strokeWidth={2} />
          </ControlButton>
        </Controls>
        {nodeCount > 10 ? (
          <MiniMap
            bgColor={theme === 'light' ? '#eef0f5' : '#13151c'}
            key={`mm-${theme}`}
            maskColor={theme === 'light' ? 'rgba(120, 126, 140, 0.30)' : 'rgba(14, 16, 22, 0.74)'}
            nodeBorderRadius={3}
            nodeColor={(node) => {
              const data = node.data as CcNodeData;
              // Filter/search canvas sync: non-matching (dimmed) tiles fade here too.
              if (data.dimmed) return theme === 'light' ? '#dfe3ea' : '#1c1f28';
              return minimapColor(String(data.status), theme);
            }}
            nodeStrokeColor={(node) =>
              (node.data as CcNodeData).dimmed
                ? theme === 'light'
                  ? '#e6e9ef'
                  : '#181b23'
                : theme === 'light'
                  ? '#b6bcc8'
                  : '#3a3f4d'
            }
            nodeStrokeWidth={3}
            pannable
            zoomable
          />
        ) : null}
      </ReactFlow>
      <Legend
        activeStatusFilters={activeStatusFilters}
        counts={statusCounts}
        onToggleStatus={onToggleFilter}
        total={nodeCount}
      />
      {nodeCount === 0 ? <div className="err">no tasks on the board</div> : null}
    </div>
  );
}

export function DagWorkspace(props: DagWorkspaceProps) {
  return (
    <ReactFlowProvider>
      <DagCanvas {...props} />
    </ReactFlowProvider>
  );
}
