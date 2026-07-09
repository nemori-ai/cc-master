import { fixtureBoards, fixtureStatusReport, fixtureTask, fixtureViewModel } from './fixtures';
import type {
  BoardsPayload,
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

export async function loadWorkspace(
  boardFilename?: string,
  signal?: AbortSignal,
  preferredTaskId?: string | null
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

    return {
      source: 'fixture',
      boards: fixtureBoards,
      viewModel: fixtureViewModel,
      selectedTask: fixtureTask,
      statusReport: fixtureStatusReport,
      error: error instanceof Error ? error.message : 'API unavailable'
    };
  }
}
