import { useCallback, useEffect, useRef, useState } from 'react';
import { loadTaskDetail, loadWorkspace } from './api';
import { DagWorkspace } from './components/DagWorkspace';
import { InspectorRail } from './components/InspectorRail';
import { LeftRail } from './components/LeftRail';
import { TopBar } from './components/TopBar';
import type { GraphOrientation } from './graphLayout';
import type { TaskDetailPayload, WorkspaceData } from './types';

function boardFromUrl(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return new URL(window.location.href).searchParams.get('board') ?? undefined;
}

function setBoardInUrl(boardFilename: string | undefined): void {
  if (typeof window === 'undefined') {
    return;
  }
  const url = new URL(window.location.href);
  if (boardFilename) {
    url.searchParams.set('board', boardFilename);
  } else {
    url.searchParams.delete('board');
  }
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function taskErrorPayload(taskId: string, message: string): TaskDetailPayload {
  return {
    schema: 'ccm/web-viewer-task/v1',
    error: message,
    task: {
      id: taskId,
      title: taskId,
      status: 'stale',
      summary: message,
      next_actions: ['Reload the viewer or choose another task']
    },
    dependencies: [],
    dependents: [],
    activity: []
  };
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedBoardFilename, setSelectedBoardFilename] = useState<string | undefined>(() => boardFromUrl());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskDetailPayload | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(() => new Set(['critical']));
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState(1);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [layoutResetKey, setLayoutResetKey] = useState(0);
  const [topNotice, setTopNotice] = useState<string | null>(null);
  const [shareFallbackUrl, setShareFallbackUrl] = useState<string | null>(null);
  const workspaceRef = useRef<WorkspaceData | null>(null);
  const selectedTaskIdRef = useRef<string | null>(null);
  const isLandscapeTrace = useMediaQuery('(max-width: 900px) and (orientation: landscape)');
  const orientation: GraphOrientation = isLandscapeTrace ? 'horizontal' : 'vertical';

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId;
  }, [selectedTaskId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setRefreshNonce((value) => value + 1);
    }, 2000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const backgroundRefresh = refreshNonce > 0 && workspaceRef.current !== null;
    if (!backgroundRefresh) {
      setLoading(true);
    }
    loadWorkspace(selectedBoardFilename, controller.signal, selectedTaskIdRef.current)
      .then((data) => {
        const preferredTaskId = selectedTaskIdRef.current;
        const nextSelectedTaskId =
          preferredTaskId && data.viewModel.graph.nodes.some((node) => node.id === preferredTaskId)
            ? preferredTaskId
            : data.viewModel.defaults?.selected_task_id ?? data.viewModel.graph.nodes[0]?.id ?? null;
        setWorkspace(data);
        setSelectedTask(data.selectedTask);
        setSelectedTaskId(nextSelectedTaskId);
        if (!selectedBoardFilename && data.viewModel.board.filename) {
          setBoardInUrl(data.viewModel.board.filename);
          setSelectedBoardFilename(data.viewModel.board.filename);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [refreshNonce, selectedBoardFilename]);

  useEffect(() => {
    if (!workspace || !selectedTaskId) {
      setSelectedTask(null);
      return;
    }

    if (workspace.selectedTask?.task.id === selectedTaskId) {
      setSelectedTask(workspace.selectedTask);
      return;
    }

    if (workspace.source === 'fixture') {
      const node = workspace.viewModel.graph.nodes.find((candidate) => candidate.id === selectedTaskId);
      setSelectedTask(
        node
          ? {
              schema: 'ccm/web-viewer-task/v1',
              task: {
                id: node.id,
                title: node.title,
                status: node.status,
                type: node.type,
                rank: node.rank,
                executor: node.executor,
                handle: node.handle,
                tags: node.tags,
                summary: 'Fixture fallback does not include full task detail for this node.',
                next_actions: []
              },
              dependencies: [],
              dependents: [],
              activity: []
            }
          : null
      );
      return;
    }

    const controller = new AbortController();
    setTaskLoading(true);
    loadTaskDetail(selectedTaskId, workspace.viewModel.board.filename, controller.signal)
      .then(setSelectedTask)
      .catch((error) => {
        if (!controller.signal.aborted) {
          setSelectedTask(
            taskErrorPayload(selectedTaskId, error instanceof Error ? error.message : 'Task detail unavailable')
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setTaskLoading(false);
        }
      });
    return () => controller.abort();
  }, [selectedTaskId, workspace]);

  const currentBoardFilename = workspace?.viewModel.board.filename ?? selectedBoardFilename;

  const selectBoard = useCallback((boardFilename: string) => {
    setBoardInUrl(boardFilename);
    setSelectedBoardFilename(boardFilename);
    setWorkspace(null);
    setSelectedTask(null);
    setSelectedTaskId(null);
    setZoom(1);
    setLayoutResetKey((value) => value + 1);
    setTopNotice(`Switched to ${boardFilename}`);
    setShareFallbackUrl(null);
  }, []);

  const resetWorkspace = useCallback(() => {
    if (!workspace) {
      return;
    }
    setZoom(1);
    setQuery('');
    setActiveFilters(new Set(['critical']));
    setLayoutResetKey((value) => value + 1);
    setSelectedTaskId(workspace.viewModel.defaults?.selected_task_id ?? workspace.viewModel.graph.nodes[0]?.id ?? null);
    setTopNotice('Layout reset');
  }, [workspace]);

  const shareWorkspace = useCallback(async () => {
    const url = window.location.href;
    setShareFallbackUrl(null);
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        setTopNotice('Workspace URL copied');
        return;
      } catch {
        /* Fall through to visible copy field. */
      }
    }
    setTopNotice('Copy this workspace URL');
    setShareFallbackUrl(url);
  }, []);

  const exportSnapshot = useCallback(() => {
    if (!workspace) {
      return;
    }
    const generatedAt = new Date().toISOString();
    const snapshot = {
      schema: 'ccm/web-viewer-export/v1',
      generated_at: generatedAt,
      source: workspace.source,
      boards: workspace.boards,
      viewModel: workspace.viewModel,
      statusReport: workspace.statusReport,
      selectedTask: selectedTask ?? workspace.selectedTask
    };
    const blob = new Blob([`${JSON.stringify(snapshot, null, 2)}\n`], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = `ccm-web-viewer-${workspace.viewModel.board.filename.replace(/\.board\.json$/, '')}-${generatedAt.replaceAll(':', '-')}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
    setTopNotice('JSON snapshot downloaded');
    setShareFallbackUrl(null);
  }, [selectedTask, workspace]);

  const displayedTask = selectedTask ?? workspace?.selectedTask ?? null;

  if (loading || !workspace || !displayedTask) {
    return (
      <div className="loading-shell">
        <span>ccm</span>
        <p>Loading board workspace...</p>
      </div>
    );
  }

  const toggleFilter = (filter: string) => {
    setActiveFilters((current) => {
      const next = new Set(current);
      if (next.has(filter)) {
        next.delete(filter);
      } else {
        next.add(filter);
      }
      return next;
    });
  };

  return (
    <div className="app-shell">
      <TopBar
        boards={workspace.boards}
        currentBoardFilename={currentBoardFilename}
        feedback={topNotice}
        onExport={exportSnapshot}
        onQueryChange={setQuery}
        onReset={resetWorkspace}
        onSelectBoard={selectBoard}
        onShare={shareWorkspace}
        query={query}
        shareFallbackUrl={shareFallbackUrl}
        source={workspace.source}
        viewModel={workspace.viewModel}
      />

      {workspace.error ? (
        <div className="api-banner" role="status">
          API unavailable: {workspace.error}. Rendering deterministic fixture fallback.
        </div>
      ) : null}

      <div className="workspace-grid">
        <LeftRail
          activeFilters={activeFilters}
          boards={workspace.boards}
          onClearFilters={() => setActiveFilters(new Set())}
          onSelectBoard={selectBoard}
          onSelectTask={setSelectedTaskId}
          onToggleFilter={toggleFilter}
          selectedTaskId={selectedTaskId}
          viewModel={workspace.viewModel}
        />
        <DagWorkspace
          activeFilters={activeFilters}
          onReset={() => setZoom(1)}
          onSelectTask={setSelectedTaskId}
          onZoomChange={setZoom}
          onZoomIn={() => setZoom((value) => Math.min(value + 0.1, 1.4))}
          onZoomOut={() => setZoom((value) => Math.max(value - 0.1, 0.7))}
          orientation={orientation}
          query={query}
          resetKey={layoutResetKey}
          selectedTaskId={selectedTaskId}
          viewModel={workspace.viewModel}
          zoom={zoom}
        />
        <InspectorRail
          onClose={() => setSelectedTaskId(null)}
          statusReport={workspace.statusReport}
          task={displayedTask}
          taskLoading={taskLoading}
          viewModel={workspace.viewModel}
        />
      </div>
    </div>
  );
}
