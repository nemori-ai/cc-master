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
  /** Board-switcher card summary (additive; absent on older servers). */
  status_counts?: Record<string, number>;
  done_count?: number;
  awaiting_count?: number;
  priority?: string;
  heartbeat_age_sec?: number | null;
  branch?: string;
  created_at?: string;
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
  route_outcome?: string;
  harness?: string;
  surface?: string;
  surface_label?: string;
  model?: string;
  role_grades?: string[];
  /** Server-joined agent ids working this node (reverse of agents[].links). Table-look-up
   * into `ViewModelPayload.agents` for the compact record — the frontend never derives it. */
  agent_refs?: string[];
}

export interface MissionReadModel {
  kind: 'goal-contract' | 'legacy';
  summary: string;
  assurance?: string;
  revision?: number;
  updated_at?: string;
  brief?: { present: boolean; ref?: string };
  pending: boolean;
}

export interface PlanningReadModel {
  assessed_at?: string;
  assessor?: string;
  dimensions: Record<string, string>;
  estimate_confidence?: string;
  quality: { effect_floor?: string };
  budget: { posture?: string; max_attempts?: number };
  capabilities: { required: string[]; preferred: string[]; forbidden: string[] };
}

export interface RouteCandidateReadModel {
  id: string;
  adapter?: string;
  harness: string;
  provider?: string;
  surface: string;
  surface_label: string;
  model?: string;
  effort?: string;
  capabilities: string[];
  role_grades: string[];
  permission?: { profile?: string; denies: string[] };
  candidate_id?: string;
  chain?: string;
  selected_at?: string;
}

export interface ExecutionReadModel {
  state: 'legacy' | 'planned' | 'routed' | 'partial' | string;
  planning?: PlanningReadModel;
  route?: {
    outcome: string;
    objective?: string;
    candidates: RouteCandidateReadModel[];
    selected: RouteCandidateReadModel | null;
    chains: { ample: string[]; tight: string[] };
    fallback: {
      on: string[];
      never_on: string[];
      exhaustion?: string;
      same_harness?: string;
    };
    reason_codes: string[];
  };
  attempts: Array<{
    id: string;
    candidate_id?: string;
    state?: string;
    /** Server-passed agent registry ref (agents[].id) that ran this attempt, when the board
     * writer recorded one — table look-up into `ViewModelPayload.agents`, never derived. */
    agent_ref?: string;
    started_at?: string;
    terminal_at?: string;
    terminal_class?: string;
  }>;
}

export interface GraphEdge {
  id?: string;
  source: string;
  target: string;
  type?: 'dep' | 'parent' | string;
  critical?: boolean;
  selected?: boolean;
  stale?: boolean;
}

export interface GraphRank {
  id: string;
  label?: string;
  node_ids: string[];
}

/** Compact task rows carried on the view-model (server `compactTask` whitelist). */
export interface CompactTask {
  id: string;
  title?: string;
  status?: string;
  deps?: string[];
  parent?: string;
  type?: string;
  executor?: string;
  handle?: string;
  mechanism?: string;
  blocked_on?: string | string[];
  estimate?: unknown;
  artifact?: unknown;
  verified?: boolean;
  created_at?: string;
  started_at?: string;
  finished_at?: string;
  updated_at?: string;
  /** legacy read-fallback aliases (archived boards revived via --resume) */
  dispatched_at?: string;
  completed_at?: string;
  log?: unknown[];
  acceptance?: unknown;
  justification?: string;
  dep_pins?: Record<string, unknown>;
  hitl_rounds?: number;
  notes?: string;
  tags?: string[];
  role?: string;
  references?: unknown;
  watchdog?: WatchdogInfo;
  decision_package?: unknown;
  execution?: ExecutionReadModel;
  [key: string]: unknown;
}

/** One judgment-call ledger entry (board_extras.judgment_calls passthrough). */
export interface JudgmentCall {
  id?: string;
  ts?: string;
  category?: 'architecture' | 'drift' | 'spec-impl-misalignment' | 'other' | string;
  severity?: 'low' | 'medium' | 'high' | 'critical' | string;
  status?: 'pending_review' | 'upheld' | 'overturned' | string;
  summary?: string;
  detail?: string;
  [key: string]: unknown;
}

/** One cadence iteration (board_extras.cadence.iterations passthrough). */
export interface CadenceIteration {
  id?: string;
  status?: 'open' | 'shipped' | string;
  started_at?: string;
  deadline?: string;
  shipped_at?: string;
  goal?: string;
  members?: string[];
  [key: string]: unknown;
}

export interface CadencePayload {
  target?: { ship_every?: string; [key: string]: unknown };
  iterations?: CadenceIteration[];
  [key: string]: unknown;
}

/** Self-wakeup watchdog (board level via board_extras, task level on compact tasks). */
export interface WatchdogInfo {
  armed_at?: string;
  fire_at?: string;
  mechanism?: 'cron' | 'loop' | 'monitor' | 'shell' | string;
  job_id?: string;
  checklist?: unknown;
  [key: string]: unknown;
}

/** One coordination inbox notification (kind ∈ notificationKind enum, open at read time). */
export interface InboxNotification {
  kind?: string;
  ts?: string;
  from?: string;
  note?: string;
  [key: string]: unknown;
}

export interface CoordinationPayload {
  priority?: 'urgent' | 'high' | 'normal' | 'low' | 'trivial' | string;
  state?: {
    current?: { active_tasks?: number; workload?: string; burn_contribution?: number };
    planned?: { remaining_work?: string; cost_to_complete_pct?: number };
  };
  inbox?: InboxNotification[];
  [key: string]: unknown;
}

/**
 * Board-model blind-spot blocks (`view-model.board_extras`, additive passthrough).
 * Every key is optional: a field missing on the board means the key is absent here.
 */
export interface BoardExtrasPayload {
  judgment_calls?: JudgmentCall[];
  cadence?: CadencePayload;
  watchdog?: WatchdogInfo;
  policy?: { autonomous_account_switch?: 'allow' | 'deny' | string; [key: string]: unknown };
  coordination?: CoordinationPayload;
}

// ---- Agent Registry read-model (server-joined; frontend renders + table-looks-up only) ----

/** Probe evidence passed through verbatim (unknown-faithful; `as_of` is the freshness anchor). */
export interface AgentProbe {
  observed?: string; // alive | silent | gone | unknown
  as_of?: string | null;
  method?: string; // pid | session-file-mtime | transcript-mtime | none
  last_probe_at?: string | null;
}

/** Compact agent projection on the view-model top-level `agents[]` (server `compactAgent`). */
export interface CompactAgent {
  id: string;
  type?: string; // cli-worker | subagent | background-shell | workflow
  harness?: string; // codex | claude-code | cursor-agent | origin
  model?: string; // omitted when never captured — render unknown / —, never derive
  intent?: string;
  state: string; // starting | running | uncertain | terminal | orphaned
  handle_kind?: string; // session-id | pid | task-id | none
  has_attach_cmd?: boolean;
  has_transcript?: boolean;
  registered_at?: string; // elapsed anchor
  ended_at?: string | null;
  probe?: AgentProbe | null;
  links?: string[]; // linked task ids
}

/** Macro roster aggregates + the derived "ready but unclaimed" list (server `buildAgentInsights`). */
export interface AgentInsights {
  total: number;
  active: number;
  running: number;
  by_state: Record<string, number>;
  by_harness: Record<string, number>;
  oldest_in_flight: { id: string; registered_at?: string; elapsed_ms: number } | null;
  unclaimed_ready: Array<{ id: string; title: string }>;
}

/** One linked-task row on `/agent.json` (server join of agents[].links -> tasks). */
export interface AgentLinkedTask {
  task_id: string;
  linked_at?: string;
  title?: string | null;
  status?: string | null;
  exists?: boolean;
}

/** `/agent.json` single-agent drill-down payload. */
export interface AgentDetailPayload {
  schema?: string;
  board?: { id?: string; filename?: string };
  agent: Record<string, unknown>; // full record verbatim
  compact?: CompactAgent;
  linked_tasks?: AgentLinkedTask[];
  probe?: AgentProbe | null;
  error?: string;
}

// ---- Agent live stream (server-normalized transcript tail; frontend renders, never parses) --

export type StreamEventKind =
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'tool'
  | 'tool_result'
  | 'system'
  | 'raw';

/** One normalized stream event from `/agent-stream.json` (server `buildAgentStream`). */
export interface StreamEvent {
  id: string; // stable key (`${lineByteOffset}.${blockIndex}`) — dedup + React key across pages
  kind: StreamEventKind;
  title: string;
  text: string;
  detail?: string;
  ts?: string;
  truncated?: boolean;
}

/** `/agent-stream.json` incremental-tail payload. Source info is nested so the cursor protocol
 *  can outlive the "file" concept (a future run-store journal is the same shape). */
export interface AgentStreamPayload {
  schema?: string;
  agent_id: string;
  mode: 'tail' | 'forward' | 'backward' | 'none';
  source: {
    kind: 'transcript' | 'none';
    harness: string;
    path?: string;
    size?: number;
    mtime?: string;
    /** File identity (inode) — the client compares across pages to detect rotation. */
    ino?: number;
    reason?: string;
  };
  live: { active: boolean; as_of: string };
  cursor: { next: number; prev: number; at_start: boolean };
  events: StreamEvent[];
  reset: boolean;
  error?: string;
}

/** One same-home peer board row from `/peers.json` (read-only roster). */
export interface PeerSummary {
  board_file: string;
  goal: string;
  harness?: string;
  priority: string;
  active?: boolean;
  health?: string;
  heartbeat?: string | null;
  heartbeat_age_sec?: number | null;
  current?: {
    active_tasks?: number | null;
    workload?: string | null;
    burn_contribution?: number | null;
  } | null;
  planned?: { remaining_work?: string | null; cost_to_complete_pct?: number | null } | null;
}

export interface PeersPayload {
  schema?: string;
  available: boolean;
  current?: { file: string; path?: string } | null;
  count: number;
  peers: PeerSummary[];
  inbox?: InboxNotification[];
  roster?: { count?: number; freshness_sec?: number; as_of?: string };
  error?: string;
}

/** Structured acceptance criterion (acceptance object form, `criteria[]`). */
export interface AcceptanceCriterion {
  desc?: string;
  kind?: 'test' | 'metric' | 'manual' | 'review' | string;
  check?: string;
  target?: unknown;
  measured?: unknown;
  status?: 'pending' | 'met' | 'failed' | string;
  [key: string]: unknown;
}

/** Server-derived analytics readouts (`view-model.insights`, additive block). */
export interface InsightsPayload {
  impact?: { id: string | null; count: number };
  convergence?: { id: string | null; in_deg: number };
  bottleneck?: {
    id: string;
    impact: number;
    status: string;
    since?: string | null;
    elapsed_ms?: number | null;
  } | null;
  wip?: { count: number; limit: number | null; over: boolean };
  awaiting?: { count: number; oldest_gate_elapsed_ms: number | null };
  age_ms?: number | null;
  per_node?: Record<string, { impact: number; in_deg: number }>;
}

/** Decision-package schema (pinned; every field optional at read time). */
export interface DecisionPackageOption {
  id?: string | number;
  label?: string;
  rationale?: string;
  tradeoffs?: string;
}

export interface DecisionPackage {
  prepared_at?: string;
  inputs_hash?: string;
  freshness?: 'fresh' | 'stale' | string;
  ask_type?: 'decision' | 'advice' | 'solution' | string;
  context_md?: string;
  question?: string;
  what_i_need?: string;
  why_it_matters?: string;
  options?: DecisionPackageOption[];
  enter_cmd?: string;
}

/** One discuss-sidecar row from `/decisions.json` (pinned shape). */
export interface DecisionEntry {
  node_id: string;
  file: string;
  resolved_at: string;
  ask_type: string;
  round: number;
  tldr: string;
}

export interface ViewModelPayload {
  schema?: string;
  mission?: MissionReadModel;
  rev?: {
    boardHash?: string;
    topologyHash?: string;
    mtimeMs?: number;
    size?: number;
    generatedAt?: string;
  };
  board: {
    id: string;
    filename: string;
    goal: string;
    mtime_ms?: number;
    hash?: string;
    owner?: unknown;
    git?: { branch?: string; worktree?: string } | null;
    meta?: { template_version?: number; [key: string]: unknown } | null;
  };
  freshness: {
    state: FreshnessState | string;
    last_read_at?: string;
    last_known_good_at?: string;
    errors?: Array<{ message: string; code?: string }>;
  };
  summary?: {
    statusCounts?: Record<string, number>;
    readySet?: string[];
    criticalPath?: {
      chain?: string[];
      makespan?: number | null;
      weight_source?: string;
    };
    awaitingUserCount?: number;
    verifiedDone?: number;
  };
  insights?: InsightsPayload;
  board_extras?: BoardExtrasPayload;
  /** Agent Registry compact roster (additive; absent on older servers). */
  agents?: CompactAgent[];
  agent_insights?: AgentInsights;
  tasks?: CompactTask[];
  graph: {
    family?: 'task-dag' | string;
    nodes: GraphNode[];
    edges: GraphEdge[];
    ranks?: GraphRank[];
    critical_path?: string[];
    ready_set?: string[];
    upstream?: Record<string, string[]>;
    downstream?: Record<string, string[]>;
    parents?: Record<string, string | null>;
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
    justification?: string;
    dep_pins?: Record<string, unknown>;
    hitl_rounds?: number;
    notes?: string;
    role?: string;
    references?: unknown;
    watchdog?: WatchdogInfo;
    execution?: ExecutionReadModel;
    summary?: string;
    next_actions?: string[];
    [key: string]: unknown;
  };
  dependencies?: Array<{ id: string; title: string; status?: string }>;
  dependents?: Array<{ id: string; title: string; status?: string }>;
  activity?: Array<{ at: string; text: string }>;
  board?: {
    id?: string;
    filename?: string;
  };
  error?: string;
}

/** One risk row from the full status-report body. */
export interface StatusReportRisk {
  kind?: string;
  severity?: string;
  count?: number;
  in_flight?: number;
  wip_limit?: number | null;
  [key: string]: unknown;
}

/**
 * The full report body as `/status-report.json` actually nests it (`payload.report`).
 * The flat fields on StatusReportPayload below remain for fixture/older shapes; the UI
 * reads the nested body first and falls back to the flat fields.
 */
export interface StatusReportBody {
  board?: { path?: string; file?: string; goal?: string; [key: string]: unknown };
  summary?: {
    total?: number;
    done?: number;
    verified_done?: number;
    in_flight?: number;
    ready?: number;
    blocked_on_user?: number;
    blocked_on_task?: number;
    attention?: number;
  };
  risks?: StatusReportRisk[];
  next_actions?: {
    ready_to_dispatch?: Array<{ id?: string; title?: string; [key: string]: unknown }>;
    awaiting_user?: Array<{ id?: string; title?: string; [key: string]: unknown }>;
    recommended_operator_actions?: string[];
  };
  health?: {
    lint?: { ok?: boolean; violations?: unknown[] };
    over_scheduling?: { in_flight?: number; wip_limit?: number | null; state?: string };
    usage?: { available?: boolean; verdict?: unknown; source?: string };
  };
  [key: string]: unknown;
}

export interface StatusReportPayload {
  schema?: 'ccm/status-report/v1' | string;
  ok?: boolean;
  report?: StatusReportBody;
  risks?: StatusReportRisk[];
  error?: string;
  artifact?: {
    freshness?: 'fresh' | 'stale' | 'missing' | string;
    generated_at?: string;
    /** The real ccm artifact stamps `created_at` (generated_at is the fixture-era alias). */
    created_at?: string;
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
  /**
   * True when this frame is a client-side last-known-good patch: the server reported a
   * board read error (torn write) and the previous good frame is shown with freshness
   * forced to stale. Disables the boardHash short-circuit so recovery re-renders.
   */
  clientStale?: boolean;
}
