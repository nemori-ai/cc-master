export type FreshnessState = 'live' | 'stale' | 'partial' | 'offline' | 'error';

export type StatusTone =
  | 'ready'
  | 'in-flight'
  | 'awaiting-user'
  | 'blocked'
  | 'stale'
  | 'done'
  | 'neutral';

export interface BoardSummary {
  id: string;
  filename: string;
  goal: string;
  active?: boolean;
  selected?: boolean;
  health?: 'ok' | 'stale' | 'error' | 'unknown';
  updated_at?: string;
  task_count?: number;
}

export interface BoardsPayload {
  schema?: string;
  service?: {
    home?: string;
    health?: string;
    id?: string;
  };
  boards: BoardSummary[];
  current_board_id?: string;
}

export interface GraphNode {
  id: string;
  title: string;
  status: StatusTone | string;
  type?: string;
  rank?: string;
  rank_index?: number;
  executor?: string;
  handle?: string;
  tags?: string[];
  critical?: boolean;
  selected?: boolean;
  awaiting_user?: boolean;
  stale?: boolean;
}

export interface GraphEdge {
  id?: string;
  source: string;
  target: string;
  critical?: boolean;
  selected?: boolean;
  stale?: boolean;
}

export interface GraphRank {
  id: string;
  label?: string;
  node_ids: string[];
}

export interface ViewModelPayload {
  schema?: string;
  board: {
    id: string;
    filename: string;
    goal: string;
    mtime_ms?: number;
    hash?: string;
    owner?: string;
  };
  freshness: {
    state: FreshnessState | string;
    last_read_at?: string;
    last_known_good_at?: string;
    errors?: Array<{ message: string; code?: string }>;
  };
  graph: {
    family?: 'task-dag' | string;
    nodes: GraphNode[];
    edges: GraphEdge[];
    ranks?: GraphRank[];
    critical_path?: string[];
    ready_set?: string[];
  };
  status?: {
    buckets?: Array<{ id: string; label: string; tone?: StatusTone | string; count: number }>;
    awaiting_user?: Array<{ id: string; title: string; command?: string }>;
    in_flight?: Array<{ id: string; title: string; handle?: string; age?: string }>;
    blocked?: Array<{ id: string; title: string; reason?: string }>;
    done_verified?: Array<{ id: string; title: string }>;
  };
  diagnostics?: {
    lint?: Array<{ severity: 'info' | 'warning' | 'error'; message: string }>;
    over_scheduling?: Array<{ severity: 'info' | 'warning' | 'error'; message: string }>;
    report_freshness?: 'fresh' | 'stale' | 'missing' | string;
  };
  defaults?: {
    selected_task_id?: string | null;
    focus?: string;
  };
}

export interface TaskDetailPayload {
  schema?: string;
  task: {
    id: string;
    title: string;
    status: StatusTone | string;
    type?: string;
    deps?: string[];
    parent?: string;
    blocked_on?: string | string[];
    estimate?: unknown;
    acceptance?: unknown;
    artifact?: unknown;
    verified?: boolean;
    created_at?: string;
    rank?: string;
    parents?: string[];
    children?: string[];
    executor?: string;
    handle?: string;
    tags?: string[];
    progress?: number;
    started_at?: string;
    finished_at?: string;
    elapsed?: string;
    eta?: string;
    updated_at?: string;
    decision_package?: unknown;
    summary?: string;
    next_actions?: string[];
    [key: string]: unknown;
  };
  raw_task?: Record<string, unknown>;
  dependencies?: Array<{ id: string; title: string; status?: string }>;
  dependents?: Array<{ id: string; title: string; status?: string }>;
  activity?: Array<{ at: string; text: string }>;
  board?: {
    id?: string;
    filename?: string;
  };
  error?: string;
}

export interface StatusReportPayload {
  schema?: 'ccm/status-report/v1' | string;
  artifact?: {
    freshness?: 'fresh' | 'stale' | 'missing' | string;
    generated_at?: string;
    expires_at?: string;
  };
  progress?: {
    total?: number;
    done?: number;
    in_flight?: number;
    ready?: number;
    blocked?: number;
  };
  next_actions?: {
    ready_to_dispatch?: Array<{ id: string; title: string }>;
    awaiting_user?: Array<{ id: string; title: string; command?: string }>;
    operator_attention?: Array<{ id: string; title: string; severity?: string }>;
  };
  health?: Array<{ id: string; label: string; state: string; detail?: string }>;
}

export interface WorkspaceData {
  source: 'api' | 'fixture';
  boards: BoardsPayload;
  viewModel: ViewModelPayload;
  selectedTask: TaskDetailPayload | null;
  statusReport: StatusReportPayload;
  error?: string;
}
