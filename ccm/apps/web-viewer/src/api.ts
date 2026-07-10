import { fixtureBoards, fixtureStatusReport, fixtureTask, fixtureViewModel } from './fixtures';
import type {
  BoardsPayload,
  DecisionEntry,
  PeersPayload,
  StatusReportPayload,
  TaskDetailPayload,
  ViewModelPayload,
  WorkspaceData
} from './types';

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
    signal
  });

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }

  return (await response.json()) as T;
}

function withParams(path: string, params: Record<string, string | undefined>): string {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return `${url.pathname}${url.search}`;
}

function selectedTaskIdFor(viewModel: ViewModelPayload, preferredTaskId?: string | null): string | null {
  if (preferredTaskId && viewModel.graph.nodes.some((node) => node.id === preferredTaskId)) {
    return preferredTaskId;
  }
  return viewModel.defaults?.selected_task_id ?? viewModel.graph.nodes[0]?.id ?? null;
}

export async function loadTaskDetail(
  taskId: string,
  boardFilename?: string,
  signal?: AbortSignal
): Promise<TaskDetailPayload> {
  return getJson<TaskDetailPayload>(
    withParams('/task.json', { task: taskId, board: boardFilename }),
    signal
  );
}

/**
 * Discuss-history sidecars for the selected board. Fail-silent by contract (mirrors the
 * legacy viewer's client tolerance): 404 / network error / non-array body all collapse to
 * [] so an older server or a torn write never disturbs the board render.
 */
export async function loadDecisions(
  boardFilename?: string,
  signal?: AbortSignal
): Promise<DecisionEntry[]> {
  try {
    const data = await getJson<unknown>(
      withParams('/decisions.json', { board: boardFilename }),
      signal
    );
    return Array.isArray(data) ? (data as DecisionEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * Same-home peer roster + coordination inbox summary. Fail-silent by contract: an older
 * server (stub shape), a 404, or a network error all collapse to null so the peers block
 * simply stays absent — never disturbs the board render.
 */
export async function loadPeers(
  boardFilename?: string,
  signal?: AbortSignal
): Promise<PeersPayload | null> {
  try {
    const data = await getJson<unknown>(withParams('/peers.json', { board: boardFilename }), signal);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const payload = data as PeersPayload;
    return {
      ...payload,
      available: payload.available === true,
      count: typeof payload.count === 'number' ? payload.count : 0,
      peers: Array.isArray(payload.peers) ? payload.peers : []
    };
  } catch {
    return null;
  }
}

/**
 * The server answers a torn/unreadable board with 200 + `{schema, error}` (no graph) so the
 * client can hold its last-known-good frame instead of flashing to the fixture fallback.
 */
class BoardReadError extends Error {}

function lastKnownGoodFrame(previous: WorkspaceData, message: string): WorkspaceData {
  return {
    ...previous,
    clientStale: true,
    viewModel: {
      ...previous.viewModel,
      freshness: {
        ...previous.viewModel.freshness,
        state: 'stale',
        errors: [{ message }]
      }
    }
  };
}

export async function loadWorkspace(
  boardFilename?: string,
  signal?: AbortSignal,
  preferredTaskId?: string | null,
  previous?: WorkspaceData | null
): Promise<WorkspaceData> {
  try {
    const boards = await getJson<BoardsPayload>(
      withParams('/boards.json', { board: boardFilename }),
      signal
    );
    const resolvedBoardFilename =
      boardFilename ??
      boards.boards.find((board) => board.selected)?.filename ??
      boards.boards[0]?.filename;
    const [viewModel, statusReport] = await Promise.all([
      getJson<ViewModelPayload>(
        withParams('/view-model.json', { board: resolvedBoardFilename }),
        signal
      ),
      getJson<StatusReportPayload>(
        withParams('/status-report.json', { board: resolvedBoardFilename }),
        signal
      )
    ]);

    // Torn-write tolerance: a 200 + error payload (no graph) means the board bytes are
    // momentarily unreadable — keep the last known good frame, surface a stale banner.
    const errorPayload = viewModel as Partial<ViewModelPayload> & { error?: string };
    if (errorPayload.error && !errorPayload.graph) {
      throw new BoardReadError(String(errorPayload.error));
    }

    const selectedTaskId = selectedTaskIdFor(viewModel, preferredTaskId);
    const selectedTask = selectedTaskId
      ? await loadTaskDetail(selectedTaskId, viewModel.board.filename, signal)
      : null;

    return {
      source: 'api',
      boards,
      viewModel,
      selectedTask,
      statusReport
    };
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'API unavailable';
    // Board read error with a previous good frame -> last-known-good, never fixture flash.
    if (error instanceof BoardReadError && previous && previous.source === 'api') {
      return lastKnownGoodFrame(previous, message);
    }

    return {
      source: 'fixture',
      boards: fixtureBoards,
      viewModel: fixtureViewModel,
      selectedTask: fixtureTask,
      statusReport: fixtureStatusReport,
      error: message
    };
  }
}
