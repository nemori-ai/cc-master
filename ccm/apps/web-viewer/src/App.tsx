import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadDecisions, loadPeers, loadTaskDetail, loadWorkspace } from './api';
import { fixturePeers } from './fixtures';
import { BoardView } from './components/BoardView';
import { DagWorkspace } from './components/DagWorkspace';
import { InspectorRail } from './components/InspectorRail';
import { LeftRail } from './components/LeftRail';
import { ListView } from './components/ListView';
import { TimelineView } from './components/TimelineView';
import { TopBar, type ViewMode } from './components/TopBar';
import type { GraphOrientation } from './graphLayout';
import type { DecisionEntry, PeersPayload, TaskDetailPayload, WorkspaceData } from './types';

const VIEW_KEY = 'ccm-view';
const THEME_KEY = 'ccm-theme';

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

function initialView(): ViewMode {
  try {
    const value = localStorage.getItem(VIEW_KEY);
    return value === 'list' || value === 'board' || value === 'timeline' || value === 'graph'
      ? value
      : 'graph';
  } catch {
    return 'graph';
  }
}

function initialTheme(): 'dark' | 'light' {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* storage unavailable */
  }
  try {
    if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  } catch {
    /* matchMedia unavailable */
  }
  return 'dark';
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
  const [selectedBoardFilename, setSelectedBoardFilename] = useState<string | undefined>(() =>
    boardFromUrl()
  );
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskDetailPayload | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [view, setView] = useState<ViewMode>(() => initialView());
  const [theme, setTheme] = useState<'dark' | 'light'>(() => initialTheme());
  const [decisions, setDecisions] = useState<DecisionEntry[]>([]);
  const [peers, setPeers] = useState<PeersPayload | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [layoutResetKey, setLayoutResetKey] = useState(0);
  const [boardSwitching, setBoardSwitching] = useState(false);
  const [topNotice, setTopNotice] = useState<string | null>(null);
  const [shareFallbackUrl, setShareFallbackUrl] = useState<string | null>(null);
  const workspaceRef = useRef<WorkspaceData | null>(null);
  const selectedTaskIdRef = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const isLandscapeTrace = useMediaQuery('(max-width: 900px) and (orientation: landscape)');
  const orientation: GraphOrientation = isLandscapeTrace ? 'horizontal' : 'vertical';

  // Theme attribute lives on the document root so the CSS [data-theme] token sets flip.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  const setViewPersist = useCallback((value: ViewMode) => {
    setView(value);
    try {
      localStorage.setItem(VIEW_KEY, value);
    } catch {
      /* storage unavailable */
    }
  }, []);

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
    // The loading splash only ever gates the FIRST frame. Any later fetch (background
    // poll or a board switch) keeps the current frame mounted — the shell must never
    // unmount/remount on a switch (that reads as a full-page refresh).
    const hasFrame = workspaceRef.current !== null;
    if (!hasFrame) {
      setLoading(true);
    }
    loadWorkspace(
      selectedBoardFilename,
      controller.signal,
      selectedTaskIdRef.current,
      workspaceRef.current
    )
      .then((data) => {
        const previous = workspaceRef.current;
        // rev.boardHash short-circuit: identical board bytes on a background poll -> skip
        // the expensive view-model/task/selection cascade (no re-render churn on an idle
        // board). Never short-circuit across a client-stale (last-known-good) frame — the
        // stale banner has to appear when the board tears and clear when it recovers, same
        // hash or not. The hash only covers the SELECTED board's bytes: the boards roster
        // (another board added/archived) and the status report (TTL refresh) move
        // independently, so commit those cheap payloads even on a hash hit — with a JSON
        // equality guard so an idle poll still causes zero re-renders.
        if (
          hasFrame &&
          previous &&
          previous.source === data.source &&
          !previous.clientStale &&
          !data.clientStale &&
          previous.viewModel.rev?.boardHash &&
          previous.viewModel.rev.boardHash === data.viewModel.rev?.boardHash &&
          previous.viewModel.board.filename === data.viewModel.board.filename
        ) {
          const boardsChanged = JSON.stringify(previous.boards) !== JSON.stringify(data.boards);
          const reportChanged =
            JSON.stringify(previous.statusReport) !== JSON.stringify(data.statusReport);
          if (boardsChanged || reportChanged) {
            // Keep viewModel/selectedTask references from the previous frame so the graph
            // and inspector see stable props; only the light payloads swap.
            setWorkspace({
              ...previous,
              boards: boardsChanged ? data.boards : previous.boards,
              statusReport: reportChanged ? data.statusReport : previous.statusReport
            });
          }
          return;
        }
        // Board switch lands here with the OLD frame still on screen (last-known-good):
        // swap data + selection in one batch, drop the old board's sidecar rows, and
        // re-fit the layout for the new topology.
        const boardChanged =
          previous !== null &&
          previous.viewModel.board.filename !== data.viewModel.board.filename;
        const preferredTaskId = boardChanged ? null : selectedTaskIdRef.current;
        const nextSelectedTaskId =
          preferredTaskId && data.viewModel.graph.nodes.some((node) => node.id === preferredTaskId)
            ? preferredTaskId
            : (data.viewModel.defaults?.selected_task_id ?? data.viewModel.graph.nodes[0]?.id ?? null);
        setWorkspace(data);
        setSelectedTask(data.selectedTask);
        setSelectedTaskId(nextSelectedTaskId);
        if (boardChanged) {
          setDecisions([]);
          setPeers(null);
          setLayoutResetKey((value) => value + 1);
        }
        setBoardSwitching(false);
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

  // Discuss-history poll — same 2s cadence as the board (sidecar files can change without
  // the board bytes changing), fail-silent (loadDecisions never throws; an old server or a
  // torn write just keeps the last good list).
  useEffect(() => {
    if (!workspace || workspace.source === 'fixture') return;
    const controller = new AbortController();
    loadDecisions(workspace.viewModel.board.filename, controller.signal).then((rows) => {
      if (!controller.signal.aborted) setDecisions(rows);
    });
    return () => controller.abort();
  }, [refreshNonce, workspace]);

  // Peer-roster poll — same 2s cadence (other boards' heartbeats move without this board's
  // bytes changing), fail-silent: null keeps the last good roster; the fixture fallback
  // renders the deterministic fixture roster so the block is demoable offline.
  useEffect(() => {
    if (!workspace) return;
    if (workspace.source === 'fixture') {
      setPeers(fixturePeers);
      return;
    }
    const controller = new AbortController();
    loadPeers(workspace.viewModel.board.filename, controller.signal).then((payload) => {
      if (!controller.signal.aborted && payload) setPeers(payload);
    });
    return () => controller.abort();
  }, [refreshNonce, workspace]);

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
      const node = workspace.viewModel.graph.nodes.find(
        (candidate) => candidate.id === selectedTaskId
      );
      const compact = workspace.viewModel.tasks?.find((task) => task.id === selectedTaskId);
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
                ...(compact ?? {}),
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
            taskErrorPayload(
              selectedTaskId,
              error instanceof Error ? error.message : 'Task detail unavailable'
            )
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

  // Transient toast: readouts stay, notices fade — auto-dismiss unless it is carrying
  // the visible share-URL fallback input.
  useEffect(() => {
    if (!topNotice || shareFallbackUrl) return;
    const timer = window.setTimeout(() => setTopNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [topNotice, shareFallbackUrl]);

  // Keyboard reach: Esc closes the detail rail, `/` focuses search.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedTaskId(null);
        return;
      }
      if (event.key === '/') {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const currentBoardFilename = workspace?.viewModel.board.filename ?? selectedBoardFilename;

  // Board switch keeps the previous frame mounted (last-known-good) and lets the load
  // effect swap in the new board's data when it arrives — no workspace teardown, no
  // loading-shell flash. The sweep indicator on the stage covers the in-between.
  const selectBoard = useCallback((boardFilename: string) => {
    if (boardFilename === workspaceRef.current?.viewModel.board.filename) {
      return;
    }
    setBoardInUrl(boardFilename);
    setSelectedBoardFilename(boardFilename);
    setBoardSwitching(true);
    setTopNotice(`Switched to ${boardFilename}`);
    setShareFallbackUrl(null);
  }, []);

  const resetWorkspace = useCallback(() => {
    if (!workspace) {
      return;
    }
    setQuery('');
    setActiveFilters(new Set());
    setLayoutResetKey((value) => value + 1);
    setSelectedTaskId(
      workspace.viewModel.defaults?.selected_task_id ?? workspace.viewModel.graph.nodes[0]?.id ?? null
    );
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

  const selectedDecisions = useMemo(() => {
    if (!displayedTask) return [];
    return decisions.filter((entry) => entry.node_id === displayedTask.task.id);
  }, [decisions, displayedTask]);

  // Gate only on the workspace itself — an EMPTY board (zero tasks -> no selectable task)
  // must still render the shell with the canvas/inspector empty states, never a stuck
  // loading screen.
  if (loading || !workspace) {
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

  const staleErrors = workspace.viewModel.freshness.errors ?? [];
  const isStale = workspace.viewModel.freshness.state !== 'live' || staleErrors.length > 0;

  return (
    <div className="app-shell">
      <TopBar
        currentBoardFilename={currentBoardFilename}
        feedback={topNotice}
        onExport={exportSnapshot}
        onQueryChange={setQuery}
        onReset={resetWorkspace}
        onShare={shareWorkspace}
        onToggleTheme={() => setTheme((value) => (value === 'light' ? 'dark' : 'light'))}
        onViewChange={setViewPersist}
        query={query}
        searchRef={searchRef}
        shareFallbackUrl={shareFallbackUrl}
        source={workspace.source}
        theme={theme}
        view={view}
        viewModel={workspace.viewModel}
      />

      {workspace.error ? (
        <div className="api-banner" role="status">
          API unavailable: {workspace.error}. Rendering deterministic fixture fallback.
        </div>
      ) : null}
      {!workspace.error && isStale ? (
        <div className="api-banner stale-banner" role="status">
          Board read is stale — showing the last known good frame.
          {staleErrors.length ? ` ${staleErrors[0]?.message ?? ''}` : ''}
        </div>
      ) : null}

      <div
        aria-busy={boardSwitching || undefined}
        className="workspace-grid"
        data-board-switching={boardSwitching ? 'true' : undefined}
        data-orientation={orientation}
      >
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
        {view === 'graph' ? (
          <DagWorkspace
            activeFilters={activeFilters}
            onSelectTask={setSelectedTaskId}
            onToggleFilter={toggleFilter}
            orientation={orientation}
            query={query}
            resetKey={layoutResetKey}
            selectedTaskId={selectedTaskId}
            theme={theme}
            viewModel={workspace.viewModel}
          />
        ) : null}
        {view === 'board' ? (
          <BoardView
            onSelectTask={setSelectedTaskId}
            selectedTaskId={selectedTaskId}
            viewModel={workspace.viewModel}
          />
        ) : null}
        {view === 'list' ? (
          <ListView
            onSelectTask={setSelectedTaskId}
            selectedTaskId={selectedTaskId}
            viewModel={workspace.viewModel}
          />
        ) : null}
        {view === 'timeline' ? (
          <TimelineView
            onSelectTask={setSelectedTaskId}
            selectedTaskId={selectedTaskId}
            viewModel={workspace.viewModel}
          />
        ) : null}
        {displayedTask ? (
          <InspectorRail
            decisions={selectedDecisions}
            onClose={() => setSelectedTaskId(null)}
            onSelectTask={setSelectedTaskId}
            peers={peers}
            statusReport={workspace.statusReport}
            task={displayedTask}
            taskLoading={taskLoading}
            viewModel={workspace.viewModel}
          />
        ) : (
          <aside aria-label="Selected task detail" className="dpanel-wrap" id="detail">
            <div className="dpanel">
              <div className="dsect">
                <div className="dim-note">no tasks on this board — nothing to inspect yet</div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
