import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent
} from 'react';
import {
  layoutGraph,
  type GraphLayout,
  type GraphOrientation,
  type ManualNodePositions,
  type PositionedNode
} from '../graphLayout';
import { statusLabel, statusTone } from '../format';
import { nodeMatchesTaskFilters } from '../taskFilters';
import type { GraphNode, ViewModelPayload } from '../types';

interface DagWorkspaceProps {
  viewModel: ViewModelPayload;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  activeFilters: Set<string>;
  query: string;
  zoom: number;
  orientation: GraphOrientation;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomChange: (zoom: number) => void;
  onReset: () => void;
  resetKey: number;
}

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Bounds = { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };

const defaultPan: Point = { x: 28, y: 24 };
const minimapWidth = 168;
const minimapHeight = 112;
const minimapPadding = 84;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function nodeMatchesFilters(node: GraphNode, activeFilters: Set<string>, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery =
    normalizedQuery.length === 0 ||
    node.id.toLowerCase().includes(normalizedQuery) ||
    node.title.toLowerCase().includes(normalizedQuery) ||
    (node.tags?.some((tag) => tag.toLowerCase().includes(normalizedQuery)) ?? false);

  if (!matchesQuery) {
    return false;
  }

  return nodeMatchesTaskFilters(node, activeFilters);
}

function layoutBounds(layout: GraphLayout): Bounds {
  const minNodeX = Math.min(0, ...layout.nodes.map((node) => node.x));
  const minNodeY = Math.min(0, ...layout.nodes.map((node) => node.y));
  const maxNodeX = Math.max(layout.width, ...layout.nodes.map((node) => node.x + node.width));
  const maxNodeY = Math.max(layout.height, ...layout.nodes.map((node) => node.y + node.height));
  const minX = minNodeX - minimapPadding;
  const minY = minNodeY - minimapPadding;
  const maxX = maxNodeX + minimapPadding;
  const maxY = maxNodeY + minimapPadding;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function useElementSize(ref: RefObject<HTMLDivElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const updateSize = () => {
      setSize({
        width: element.clientWidth,
        height: element.clientHeight
      });
    };

    updateSize();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

function focusPan(
  layout: GraphLayout,
  viewportSize: Size,
  zoom: number,
  selectedTaskId: string | null,
  visibleNodeIds: Set<string>
): Point {
  if (viewportSize.width <= 0 || viewportSize.height <= 0 || layout.nodes.length === 0) {
    return defaultPan;
  }

  const selectedNode = selectedTaskId
    ? layout.nodes.find((node) => node.id === selectedTaskId)
    : undefined;
  const firstVisibleNode = layout.nodes.find((node) => visibleNodeIds.has(node.id));
  const focusNode = selectedNode ?? firstVisibleNode ?? layout.nodes[0];
  if (!focusNode) {
    return defaultPan;
  }

  return {
    x: Math.round(viewportSize.width / 2 - (focusNode.x + focusNode.width / 2) * zoom),
    y: Math.round(viewportSize.height / 2 - (focusNode.y + focusNode.height / 2) * zoom)
  };
}

function Minimap({
  layout,
  pan,
  zoom,
  viewportSize,
  selectedTaskId,
  visibleNodeIds
}: {
  layout: GraphLayout;
  pan: Point;
  zoom: number;
  viewportSize: Size;
  selectedTaskId: string | null;
  visibleNodeIds: Set<string>;
}) {
  const bounds = layoutBounds(layout);
  const scale = Math.min(minimapWidth / bounds.width, minimapHeight / bounds.height);
  const toMinimapX = (value: number) => (value - bounds.minX) * scale;
  const toMinimapY = (value: number) => (value - bounds.minY) * scale;
  const visibleLeft = -pan.x / zoom;
  const visibleTop = -pan.y / zoom;
  const visibleRight = visibleLeft + viewportSize.width / zoom;
  const visibleBottom = visibleTop + viewportSize.height / zoom;
  const viewportLeft = clamp(toMinimapX(visibleLeft), 0, minimapWidth);
  const viewportTop = clamp(toMinimapY(visibleTop), 0, minimapHeight);
  const viewportRight = clamp(toMinimapX(visibleRight), 0, minimapWidth);
  const viewportBottom = clamp(toMinimapY(visibleBottom), 0, minimapHeight);
  const viewportWidth = Math.max(4, viewportRight - viewportLeft);
  const viewportHeight = Math.max(4, viewportBottom - viewportTop);

  return (
    <div className="minimap" aria-hidden="true">
      <svg viewBox={`0 0 ${minimapWidth} ${minimapHeight}`}>
        <rect className="minimap-bg" x="0" y="0" width={minimapWidth} height={minimapHeight} rx="6" />
        {layout.edges.map((edge) => (
          <path
            className="minimap-edge"
            d={edge.path}
            key={edge.id}
            transform={`translate(${-bounds.minX * scale} ${-bounds.minY * scale}) scale(${scale})`}
          />
        ))}
        {layout.nodes.map((node) => (
          <rect
            className="minimap-node"
            data-critical={node.critical}
            data-filtered={!visibleNodeIds.has(node.id)}
            data-selected={node.id === selectedTaskId}
            data-tone={statusTone(node.status)}
            height={Math.max(3, node.height * scale)}
            key={node.id}
            rx="1.5"
            width={Math.max(5, node.width * scale)}
            x={toMinimapX(node.x)}
            y={toMinimapY(node.y)}
          />
        ))}
        {viewportSize.width > 0 && viewportSize.height > 0 ? (
          <rect
            className="minimap-viewport"
            height={viewportHeight}
            width={viewportWidth}
            x={viewportLeft}
            y={viewportTop}
            rx="2"
          />
        ) : null}
      </svg>
    </div>
  );
}

export function DagWorkspace({
  viewModel,
  selectedTaskId,
  onSelectTask,
  activeFilters,
  query,
  zoom,
  orientation,
  onZoomIn,
  onZoomOut,
  onZoomChange,
  onReset,
  resetKey
}: DagWorkspaceProps) {
  const [manualPositions, setManualPositions] = useState<ManualNodePositions>({});
  const [pan, setPan] = useState<Point>(defaultPan);
  const [isPanning, setIsPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewportSize = useElementSize(viewportRef);
  const autoPanKeyRef = useRef<string | null>(null);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const panDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    setManualPositions({});
    setPan(defaultPan);
  }, [resetKey, viewModel.board.filename]);

  const layout = useMemo(
    () => layoutGraph(viewModel, orientation, selectedTaskId, manualPositions),
    [manualPositions, orientation, selectedTaskId, viewModel]
  );
  const visibleNodeIds = new Set(
    layout.nodes
      .filter((node) => nodeMatchesFilters(node, activeFilters, query))
      .map((node) => node.id)
  );
  const visibleEdges = layout.edges.filter(
    (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
  );
  const autoPanKey = `${viewModel.board.filename}:${orientation}:${resetKey}:${selectedTaskId ?? ''}`;

  useEffect(() => {
    if (autoPanKeyRef.current === autoPanKey || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return;
    }
    autoPanKeyRef.current = autoPanKey;
    setPan(focusPan(layout, viewportSize, zoom, selectedTaskId, visibleNodeIds));
  }, [autoPanKey, layout, selectedTaskId, viewportSize, visibleNodeIds, zoom]);

  const clearManualPositions = () => {
    setManualPositions({});
  };

  const handleFit = () => {
    clearManualPositions();
    setPan(focusPan(layout, viewportSize, 1, selectedTaskId, visibleNodeIds));
    onReset();
  };

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, node: PositionedNode) => {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: node.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: node.x,
      startY: node.y,
      moved: false
    };
  };

  const updateDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.stopPropagation();
    const dx = (event.clientX - drag.startClientX) / zoom;
    const dy = (event.clientY - drag.startClientY) / zoom;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      drag.moved = true;
      event.preventDefault();
    }
    setManualPositions((current) => ({
      ...current,
      [drag.id]: {
        x: drag.startX + dx,
        y: drag.startY + dy
      }
    }));
  };

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.stopPropagation();
    if (drag.moved) {
      suppressClickRef.current = true;
      event.preventDefault();
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  const handleNodeClick = (event: ReactMouseEvent<HTMLButtonElement>, nodeId: string) => {
    if (suppressClickRef.current) {
      event.preventDefault();
      return;
    }
    onSelectTask(nodeId);
  };

  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.graph-node, .minimap')) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    panDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
      moved: false
    };
    setIsPanning(true);
  };

  const updatePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      drag.moved = true;
      event.preventDefault();
    }
    setPan({
      x: drag.startPanX + dx,
      y: drag.startPanY + dy
    });
  };

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panDragRef.current = null;
    setIsPanning(false);
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const viewportX = event.clientX - rect.left;
    const viewportY = event.clientY - rect.top;
    const graphX = (viewportX - pan.x) / zoom;
    const graphY = (viewportY - pan.y) / zoom;
    const nextZoom = clamp(zoom * (1 - event.deltaY * 0.001), 0.7, 1.4);
    if (nextZoom === zoom) {
      return;
    }

    onZoomChange(nextZoom);
    setPan({
      x: Math.round(viewportX - graphX * nextZoom),
      y: Math.round(viewportY - graphY * nextZoom)
    });
  };

  return (
    <main className="dag-workspace" aria-label="Task DAG workspace">
      <div className="dag-toolbar">
        <div>
          <h1>Task DAG</h1>
          <div className="legend" aria-label="Status legend">
            {['critical', 'selected', 'ready', 'in-flight', 'awaiting-user', 'blocked', 'stale', 'done'].map(
              (item) => (
                <span key={item} data-tone={item}>
                  <i aria-hidden="true" />
                  {item}
                </span>
              )
            )}
          </div>
        </div>
        <div className="zoom-controls" aria-label="DAG controls">
          <button type="button" onClick={handleFit}>
            Fit
          </button>
          <button type="button" onClick={onZoomOut} aria-label="Zoom out">
            -
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={onZoomIn} aria-label="Zoom in">
            +
          </button>
        </div>
      </div>

      {viewModel.freshness.errors?.length ? (
        <div className="stale-banner" role="status">
          Last-known-good graph is still visible. {viewModel.freshness.errors[0]?.message}
        </div>
      ) : null}

      <div
        className="graph-viewport"
        data-orientation={orientation}
        data-panning={isPanning}
        onPointerCancel={endPan}
        onPointerDown={startPan}
        onPointerMove={updatePan}
        onPointerUp={endPan}
        onWheel={handleWheel}
        ref={viewportRef}
      >
        <div
          className="graph-canvas"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
          }}
        >
          <div className="rank-layer" aria-hidden="true">
            {layout.ranks.map((rank, index) => (
              <span
                key={rank.id}
                style={
                  orientation === 'horizontal'
                    ? { left: 54 + index * 92, top: 18 }
                    : { left: 18, top: 54 + index * 92 }
                }
              >
                {rank.label ?? rank.id}
              </span>
            ))}
          </div>

          <svg
            className="edge-layer"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            aria-hidden="true"
          >
            {visibleEdges.map((edge) => (
              <path
                d={edge.path}
                data-critical={edge.critical}
                data-selected={edge.source === selectedTaskId || edge.target === selectedTaskId}
                key={edge.id}
              />
            ))}
          </svg>

          <div className="node-layer">
            {layout.nodes.map((node) => {
              const visible = visibleNodeIds.has(node.id);
              return (
                <button
                  aria-label={`${node.title}, ${statusLabel(node.status)}`}
                  className="graph-node"
                  data-critical={node.critical}
                  data-filtered={!visible}
                  data-selected={node.id === selectedTaskId}
                  data-tone={statusTone(node.status)}
                  key={node.id}
                  onClick={(event) => handleNodeClick(event, node.id)}
                  onPointerCancel={endDrag}
                  onPointerDown={(event) => startDrag(event, node)}
                  onPointerMove={updateDrag}
                  onPointerUp={endDrag}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: node.width,
                    height: node.height
                  }}
                  title={node.title}
                  type="button"
                >
                  <span>{node.title}</span>
                  <i aria-hidden="true">{node.awaiting_user || node.stale ? '!' : 'ok'}</i>
                </button>
              );
            })}
          </div>
        </div>
        <Minimap
          layout={layout}
          pan={pan}
          selectedTaskId={selectedTaskId}
          viewportSize={viewportSize}
          visibleNodeIds={visibleNodeIds}
          zoom={zoom}
        />
      </div>
    </main>
  );
}
