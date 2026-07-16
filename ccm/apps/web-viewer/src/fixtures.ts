import type {
  BoardExtrasPayload,
  BoardsPayload,
  CompactAgent,
  CompactTask,
  GraphEdge,
  PeersPayload,
  StatusReportPayload,
  TaskDetailPayload,
  ViewModelPayload,
} from './types';

const now = '2026-07-08T12:24:18Z';

export const fixtureBoards: BoardsPayload = {
  schema: 'ccm/web-viewer-boards/v1',
  service: {
    home: '~/.cc_master',
    health: 'ok',
    id: 'wv_fixture',
  },
  current_board_id: 'release-2025-05-16',
  boards: [
    {
      id: 'release-2025-05-16',
      filename: 'release-2025-05-16.board.json',
      goal: 'Ship release train with verified infra handoff',
      active: true,
      selected: true,
      health: 'ok',
      task_count: 20,
      updated_at: now,
      status_counts: { done: 7, verified: 2, in_flight: 4, ready: 3, blocked: 3, failed: 1 },
      done_count: 9,
      awaiting_count: 2,
      priority: 'high',
      heartbeat_age_sec: 42,
      branch: 'release/train-0516',
      created_at: '2026-07-08T08:00:00Z',
    },
    {
      id: 'infra-migration',
      filename: 'infra-migration.board.json',
      goal: 'Migrate deployment graph to new account pool',
      active: true,
      health: 'stale',
      task_count: 28,
      status_counts: { done: 12, in_flight: 2, ready: 6, blocked: 8 },
      done_count: 12,
      awaiting_count: 1,
      priority: 'normal',
      heartbeat_age_sec: 60 * 42,
      branch: 'feat/account-pool',
    },
    {
      id: 'data-pipeline-v2',
      filename: 'data-pipeline-v2.board.json',
      goal: 'Reconcile pipeline status reports',
      health: 'ok',
      task_count: 34,
      status_counts: { done: 30, verified: 4 },
      done_count: 34,
      awaiting_count: 0,
      priority: 'low',
      updated_at: '2026-07-06T18:04:00Z',
    },
    {
      id: 'incident-2407',
      filename: 'incident-2407.board.json',
      goal: 'Close incident remediation tasks',
      health: 'error',
      task_count: 11,
      status_counts: { done: 8, failed: 2, stale: 1 },
      done_count: 8,
      awaiting_count: 0,
      updated_at: '2026-07-02T09:30:00Z',
    },
  ],
};

// ---- fixture tasks: full 8-status coverage + awaiting-user (pure + combined) + nesting ---
// Deterministic fake data: every visual state the viewer renders is present — one task per
// board status, a decision_package on both gate shapes, and an owner with three children.

const fixtureTasks: CompactTask[] = [
  {
    id: 'root',
    title: 'Release train kickoff',
    status: 'done',
    verified: true,
    created_at: '2026-07-08T08:00:00Z',
    started_at: '2026-07-08T08:05:00Z',
    finished_at: '2026-07-08T08:20:00Z',
    artifact: 'design_docs/release-plan.md',
  },
  {
    id: 'fetch-inputs',
    title: 'Fetch release inputs',
    status: 'done',
    verified: true,
    deps: ['root'],
    created_at: '2026-07-08T08:00:00Z',
    started_at: '2026-07-08T08:20:00Z',
    finished_at: '2026-07-08T08:50:00Z',
    artifact: 'inputs/manifest.json',
  },
  {
    id: 'fetch-config',
    title: 'Fetch environment config',
    status: 'ready',
    deps: ['root'],
    created_at: '2026-07-08T08:00:00Z',
  },
  {
    id: 'load-credentials',
    title: 'Load deploy credentials',
    status: 'done',
    verified: true,
    deps: ['root'],
    created_at: '2026-07-08T08:00:00Z',
    started_at: '2026-07-08T08:20:00Z',
    finished_at: '2026-07-08T08:40:00Z',
    artifact: 'vault://release/creds',
  },
  {
    id: 'validate-inputs',
    title: 'Validate release inputs',
    status: 'done',
    verified: true,
    deps: ['fetch-inputs'],
    created_at: '2026-07-08T08:00:00Z',
    started_at: '2026-07-08T08:50:00Z',
    finished_at: '2026-07-08T09:10:00Z',
    artifact: 'reports/input-validation.md',
  },
  {
    id: 'user-approval',
    title: 'Approve credential plan',
    status: 'blocked',
    blocked_on: 'user',
    deps: ['load-credentials'],
    created_at: '2026-07-08T08:00:00Z',
    started_at: '2026-07-08T09:00:00Z',
    hitl_rounds: 2,
    decision_package: {
      prepared_at: '2026-07-08T10:24:00Z',
      inputs_hash: 'sha256:fixture-dp',
      freshness: 'fresh',
      ask_type: 'decision',
      question: 'Which credential rotation window should the release use?',
      context_md:
        'Two rotation windows are viable.\n\n- Window A: tonight 02:00-03:00 UTC (low traffic)\n- Window B: tomorrow 14:00-15:00 UTC (on-call coverage)\n\nBoth satisfy the compliance deadline.',
      what_i_need: 'Pick a rotation window so deploy-infra can schedule the cutover.',
      why_it_matters: 'The wrong window risks a cutover with no on-call coverage.',
      options: [
        {
          id: 'A',
          label: 'Tonight 02:00 UTC',
          rationale: 'Lowest traffic, fastest unblock.',
          tradeoffs: 'No on-call coverage if rollback is needed.',
        },
        {
          id: 'B',
          label: 'Tomorrow 14:00 UTC',
          rationale: 'Full on-call coverage.',
          tradeoffs: 'Delays the critical path by ~12h.',
        },
      ],
      enter_cmd: 'claude /cc-master:discuss user-approval',
    },
  },
  {
    id: 'policy-check',
    title: 'Policy advisory check',
    status: 'stale',
    deps: ['fetch-config'],
    created_at: '2026-07-08T08:00:00Z',
    started_at: '2026-07-08T09:15:00Z',
    // fire_at in the past: demonstrates the expired/stale watchdog readout
    watchdog: { mechanism: 'cron', fire_at: '2026-07-08T11:00:00Z', job_id: 'wd-policy' },
  },
  {
    id: 'plan-execution',
    title: 'Plan execution graph',
    status: 'done',
    verified: true,
    deps: ['validate-inputs'],
    created_at: '2026-07-08T08:00:00Z',
    started_at: '2026-07-08T09:10:00Z',
    finished_at: '2026-07-08T09:40:00Z',
    artifact: 'plans/execution-graph.json',
  },
  {
    id: 'escalate-vendor',
    title: 'Escalate vendor advisory',
    status: 'escalated',
    deps: ['policy-check'],
    created_at: '2026-07-08T08:00:00Z',
    started_at: '2026-07-08T09:30:00Z',
  },
  {
    id: 'deploy-infra',
    title: 'Deploy infra cutover',
    status: 'in_flight',
    deps: ['plan-execution', 'user-approval'],
    type: 'run',
    executor: 'runner',
    handle: 'run_9a3d2b1e',
    tags: ['infra', 'deploy', 'terraform'],
    created_at: '2026-07-08T08:00:00Z',
    started_at: '2026-07-08T10:05:00Z',
    justification: 'The cutover gates every downstream verification lane; it must land first.',
    dep_pins: { 'plan-execution': 'sha256:plan-v3' },
    hitl_rounds: 1,
    notes: 'Terraform apply is in the second of three stages.',
    estimate: { value: 90, unit: 'm' },
    acceptance: {
      criteria: [
        { desc: 'terraform apply exits 0 on all three stages', kind: 'test', status: 'met' },
        { desc: 'p99 cutover latency below 400ms', kind: 'metric', target: '400ms', status: 'pending' },
        { desc: 'second reviewer signs off the runbook diff', kind: 'review', status: 'failed' }
      ]
    },
    execution: {
      state: 'routed',
      planning: {
        assessed_at: '2026-07-08T09:55:00Z',
        assessor: 'master',
        dimensions: {
          reasoning: 'multi-step',
          uncertainty: 'medium',
          risk: 'high',
          scope: 'cross-module',
          context: 'large',
          coordination: 'multi-boundary',
          reversibility: 'costly'
        },
        estimate_confidence: 'high',
        quality: { effect_floor: 'T1' },
        budget: { posture: 'ample', max_attempts: 3 },
        capabilities: {
          required: ['terraform-review'],
          preferred: ['architecture'],
          forbidden: ['account-mutation']
        }
      },
      route: {
        outcome: 'other-harness-cli',
        objective: 'balanced',
        candidates: [],
        selected: {
          id: 'codex-cli',
          candidate_id: 'codex-cli',
          harness: 'codex',
          provider: 'openai',
          surface: 'cli-headless',
          surface_label: 'Codex CLI',
          model: 'gpt-5.6-sol',
          capabilities: ['terraform-review'],
          role_grades: ['T1'],
          chain: 'ample'
        },
        chains: { ample: ['codex-cli', 'cursor-agent'], tight: ['cursor-agent'] },
        fallback: {
          on: ['quota-tight'],
          never_on: ['permission-blocked'],
          exhaustion: 'fail-closed',
          same_harness: 'explicit-candidate-only'
        },
        reason_codes: ['quality-floor-met', 'quota-healthy']
      },
      attempts: [
        {
          id: 'attempt-1',
          candidate_id: 'codex-cli',
          state: 'running',
          agent_ref: 'agt-001',
          started_at: '2026-07-08T10:05:00Z'
        }
      ]
    }
  },
  {
    id: 'secrets-sync',
    title: 'Sync deploy secrets',
    status: 'failed',
    deps: ['plan-execution'],
    created_at: '2026-07-08T08:00:00Z',
    started_at: '2026-07-08T09:50:00Z',
  },
  {
    id: 'retry-upload',
    title: 'Retry artifact upload',
    status: 'uncertain',
    deps: ['secrets-sync'],
    created_at: '2026-07-08T08:00:00Z',
    started_at: '2026-07-08T10:10:00Z',
  },
  {
    id: 'migration',
    title: 'Data migration wave',
    status: 'in_flight',
    deps: ['deploy-infra'],
    created_at: '2026-07-08T08:00:00Z',
    started_at: '2026-07-08T10:40:00Z',
  },
  {
    id: 'mig-a',
    title: 'Migrate accounts shard',
    status: 'done',
    verified: true,
    parent: 'migration',
    created_at: '2026-07-08T08:00:00Z',
    started_at: '2026-07-08T10:45:00Z',
    finished_at: '2026-07-08T11:05:00Z',
    artifact: 'migrations/accounts.log',
  },
  {
    id: 'mig-b',
    title: 'Migrate ledgers shard',
    status: 'in_flight',
    parent: 'migration',
    deps: ['mig-a'],
    created_at: '2026-07-08T08:00:00Z',
    started_at: '2026-07-08T11:10:00Z',
  },
  {
    id: 'mig-c',
    title: 'Migrate archives shard',
    status: 'ready',
    parent: 'migration',
    created_at: '2026-07-08T08:00:00Z',
  },
  {
    id: 'run-jobs',
    title: 'Run verification jobs',
    status: 'in_flight',
    blocked_on: 'user',
    deps: ['deploy-infra'],
    created_at: '2026-07-08T08:00:00Z',
    started_at: '2026-07-08T10:50:00Z',
    estimate: { value: 2, unit: 'd' },
    // fire_at far in the future: demonstrates the live countdown readout
    watchdog: { mechanism: 'shell', fire_at: '2027-06-30T00:00:00Z' },
    decision_package: {
      prepared_at: '2026-07-08T11:50:00Z',
      inputs_hash: 'sha256:fixture-dp2',
      freshness: 'stale',
      ask_type: 'advice',
      question: 'Job shard 7 is flaky — keep retrying or skip it?',
      context_md: 'Shard 7 failed twice on a network timeout; all other shards are green.',
      what_i_need: 'Advice on whether shard 7 blocks the release evidence.',
      why_it_matters: 'Skipping trims 40m off the critical path but weakens coverage.',
      options: [],
      enter_cmd: 'claude /cc-master:discuss run-jobs',
    },
  },
  {
    id: 'verify-results',
    title: 'Verify launch evidence',
    status: 'blocked',
    deps: ['run-jobs', 'migration'],
    created_at: '2026-07-08T08:00:00Z',
  },
  {
    id: 'post-migration',
    title: 'Post-migration reconciliation',
    status: 'blocked',
    deps: ['mig-b'],
    created_at: '2026-07-08T08:00:00Z',
  },
  {
    id: 'publish-report',
    title: 'Publish release report',
    status: 'ready',
    deps: ['verify-results'],
    created_at: '2026-07-08T08:00:00Z',
  },
];

const CRITICAL_PATH = [
  'root',
  'fetch-inputs',
  'validate-inputs',
  'plan-execution',
  'deploy-infra',
  'run-jobs',
  'verify-results',
  'publish-report',
];

const RANK_BY_ID: Record<string, number> = {
  root: 0,
  'fetch-inputs': 1,
  'fetch-config': 1,
  'load-credentials': 1,
  'validate-inputs': 2,
  'user-approval': 2,
  'policy-check': 2,
  'plan-execution': 3,
  'escalate-vendor': 3,
  'deploy-infra': 4,
  'secrets-sync': 4,
  migration: 5,
  'run-jobs': 5,
  'retry-upload': 5,
  'verify-results': 6,
  'publish-report': 7,
  'mig-a': 0,
  'mig-b': 1,
  'mig-c': 0,
  'post-migration': 2,
};

const PER_NODE: Record<string, { impact: number; in_deg: number }> = {
  root: { impact: 15, in_deg: 0 },
  'fetch-inputs': { impact: 9, in_deg: 1 },
  'fetch-config': { impact: 2, in_deg: 1 },
  'load-credentials': { impact: 6, in_deg: 1 },
  'validate-inputs': { impact: 8, in_deg: 1 },
  'user-approval': { impact: 5, in_deg: 1 },
  'policy-check': { impact: 1, in_deg: 1 },
  'plan-execution': { impact: 7, in_deg: 1 },
  'escalate-vendor': { impact: 0, in_deg: 1 },
  'deploy-infra': { impact: 4, in_deg: 2 },
  'secrets-sync': { impact: 1, in_deg: 1 },
  'retry-upload': { impact: 0, in_deg: 1 },
  migration: { impact: 2, in_deg: 1 },
  'run-jobs': { impact: 2, in_deg: 1 },
  'verify-results': { impact: 1, in_deg: 2 },
  'publish-report': { impact: 0, in_deg: 1 },
  'mig-a': { impact: 2, in_deg: 0 },
  'mig-b': { impact: 1, in_deg: 1 },
  'mig-c': { impact: 0, in_deg: 0 },
  'post-migration': { impact: 0, in_deg: 1 },
};

// Direct-adjacency derivation over the fixture tasks (edge lists + upstream/downstream maps
// + parents) — fixture construction only, no transitive computation.
function deriveGraph(tasks: CompactTask[]) {
  const ids = new Set(tasks.map((task) => task.id));
  const criticalEdges = new Set<string>();
  for (let i = 1; i < CRITICAL_PATH.length; i++) {
    criticalEdges.add(`${CRITICAL_PATH[i - 1]}->${CRITICAL_PATH[i]}`);
  }
  const edges: GraphEdge[] = [];
  const upstream: Record<string, string[]> = {};
  const downstream: Record<string, string[]> = {};
  const parents: Record<string, string | null> = {};
  for (const task of tasks) {
    upstream[task.id] = [];
    downstream[task.id] = downstream[task.id] ?? [];
    parents[task.id] = typeof task.parent === 'string' && ids.has(task.parent) ? task.parent : null;
  }
  for (const task of tasks) {
    for (const dep of task.deps ?? []) {
      if (!ids.has(dep)) continue;
      (upstream[task.id] = upstream[task.id] ?? []).push(dep);
      (downstream[dep] = downstream[dep] ?? []).push(task.id);
      edges.push({
        id: `${dep}->${task.id}`,
        source: dep,
        target: task.id,
        type: 'dep',
        critical: criticalEdges.has(`${dep}->${task.id}`),
      });
    }
    if (parents[task.id]) {
      edges.push({
        id: `${parents[task.id]}->${task.id}`,
        source: parents[task.id] as string,
        target: task.id,
        type: 'parent',
      });
    }
  }
  return { edges, upstream, downstream, parents };
}

const derived = deriveGraph(fixtureTasks);

const ranksGrouped = new Map<number, string[]>();
for (const task of fixtureTasks) {
  const rank = RANK_BY_ID[task.id] ?? 0;
  const group = ranksGrouped.get(rank) ?? [];
  group.push(task.id);
  ranksGrouped.set(rank, group);
}

const AWAITING = new Set(['user-approval', 'run-jobs']);

// ---- board-model blind-spot demo data (board_extras passthrough) -------------------------
// jc x3 covers all three statuses; cadence has one open + one shipped iteration; the board
// watchdog counts down (far-future fire_at); coordination carries priority + inbox kinds.
const fixtureBoardExtras: BoardExtrasPayload = {
  judgment_calls: [
    {
      id: 'jc-1',
      ts: '2026-07-08T09:20:00Z',
      category: 'architecture',
      severity: 'high',
      status: 'pending_review',
      summary: 'Split the cutover into three stages instead of a single apply.',
    },
    {
      id: 'jc-2',
      ts: '2026-07-08T10:10:00Z',
      category: 'drift',
      severity: 'medium',
      status: 'upheld',
      summary: 'Kept the legacy dispatched_at alias readable for archived boards.',
    },
    {
      id: 'jc-3',
      ts: '2026-07-08T11:05:00Z',
      category: 'other',
      severity: 'low',
      status: 'overturned',
      summary: 'Dropped the speculative artifact cache after review.',
    },
  ],
  cadence: {
    target: { ship_every: '24h' },
    iterations: [
      {
        id: 'it-2',
        status: 'open',
        started_at: '2026-07-08T08:00:00Z',
        deadline: '2026-07-09T08:00:00Z',
        goal: 'Ship the cutover wave end to end',
        members: ['deploy-infra', 'migration', 'run-jobs'],
      },
      {
        id: 'it-1',
        status: 'shipped',
        started_at: '2026-07-07T08:00:00Z',
        shipped_at: '2026-07-08T07:40:00Z',
        members: ['root', 'fetch-inputs'],
      },
    ],
  },
  watchdog: {
    armed_at: '2026-07-08T11:00:00Z',
    fire_at: '2027-06-30T12:00:00Z',
    mechanism: 'cron',
    job_id: 'wd-board',
  },
  policy: { autonomous_account_switch: 'allow' },
  coordination: {
    priority: 'high',
    state: {
      current: { active_tasks: 4, workload: 'release cutover wave', burn_contribution: 22 },
      planned: { remaining_work: '6 tasks to verified done', cost_to_complete_pct: 35 },
    },
    inbox: [
      {
        kind: 'pacing_throttle',
        ts: '2026-07-08T11:30:00Z',
        from: 'infra-migration',
        note: 'peer claimed shared 5h headroom — throttle non-critical dispatch',
      },
      { kind: 'hitl_turn', ts: '2026-07-08T11:55:00Z', from: 'operator' },
    ],
  },
};

export const fixturePeers: PeersPayload = {
  schema: 'ccm/web-viewer-peers/v1',
  available: true,
  current: { file: 'release-2025-05-16.board.json' },
  count: 2,
  peers: [
    {
      board_file: 'infra-migration.board.json',
      goal: 'Migrate deployment graph to new account pool',
      harness: 'claude-code',
      priority: 'urgent',
      active: true,
      health: 'ok',
      heartbeat: '2026-07-08T12:23:48Z',
      heartbeat_age_sec: 30,
      current: { active_tasks: 2, workload: 'terraform account pool', burn_contribution: 18 },
      planned: { remaining_work: '3 tasks', cost_to_complete_pct: 22 },
    },
    {
      board_file: 'data-pipeline-v2.board.json',
      goal: 'Reconcile pipeline status reports',
      harness: 'codex',
      priority: 'normal',
      active: true,
      health: 'ok',
      heartbeat: '2026-07-08T12:22:18Z',
      heartbeat_age_sec: 120,
      current: null,
      planned: null,
    },
  ],
  inbox: fixtureBoardExtras.coordination?.inbox ?? [],
  roster: { count: 3, freshness_sec: 600, as_of: now },
};

// ---- Agent Registry demo roster (compact projection + node join, offline fallback) -------
const fixtureAgents: CompactAgent[] = [
  {
    id: 'agt-001',
    type: 'cli-worker',
    harness: 'codex',
    model: 'gpt-5.6-luna',
    intent: 'drive the infra cutover to green apply',
    state: 'running',
    handle_kind: 'session-id',
    has_attach_cmd: true,
    has_transcript: true,
    registered_at: '2026-07-08T10:05:00Z',
    ended_at: null,
    probe: { observed: 'alive', as_of: '2026-07-08T12:23:40Z', method: 'session-file-mtime' },
    links: ['deploy-infra'],
  },
  {
    id: 'agt-002',
    type: 'subagent',
    harness: 'claude-code',
    model: 'opus-4.8',
    intent: 'migrate ledger shards and reconcile counts',
    state: 'running',
    handle_kind: 'task-id',
    has_attach_cmd: false,
    has_transcript: true,
    registered_at: '2026-07-08T11:40:00Z',
    ended_at: null,
    probe: { observed: 'silent', as_of: '2026-07-08T12:10:00Z', method: 'transcript-mtime' },
    links: ['migration', 'mig-b'],
  },
  {
    id: 'agt-003',
    type: 'background-shell',
    harness: 'origin',
    // model intentionally absent — unknown-faithful (renders —, never derived).
    intent: 'watchdog poll on shard b',
    state: 'uncertain',
    handle_kind: 'pid',
    has_attach_cmd: false,
    has_transcript: false,
    registered_at: '2026-07-08T12:05:00Z',
    ended_at: null,
    probe: { observed: 'unknown', as_of: '2026-07-08T12:15:00Z', method: 'none' },
    links: ['mig-b'],
  },
  {
    id: 'agt-004',
    type: 'cli-worker',
    harness: 'codex',
    model: 'gpt-5.6-luna',
    intent: 'fetch pipeline inputs',
    state: 'terminal',
    handle_kind: 'session-id',
    has_attach_cmd: true,
    has_transcript: true,
    registered_at: '2026-07-08T08:10:00Z',
    ended_at: '2026-07-08T08:52:00Z',
    probe: { observed: 'gone', as_of: '2026-07-08T08:52:00Z', method: 'session-file-mtime' },
    links: ['fetch-inputs'],
  },
];

const fixtureAgentRefs = new Map<string, string[]>();
for (const agent of fixtureAgents) {
  for (const taskId of agent.links ?? []) {
    const arr = fixtureAgentRefs.get(taskId) ?? [];
    arr.push(agent.id);
    fixtureAgentRefs.set(taskId, arr);
  }
}

export const fixtureViewModel: ViewModelPayload = {
  schema: 'ccm/web-viewer-view-model/v1',
  mission: {
    kind: 'goal-contract',
    summary: 'Ship release train with verified infra handoff',
    assurance: 'confirmed',
    revision: 4,
    updated_at: '2026-07-08T12:00:00Z',
    brief: { present: true, ref: 'design_docs/release-plan.md' },
    pending: false
  },
  rev: {
    boardHash: 'sha256:fixture-board',
    topologyHash: 'sha256:fixture-topology',
    mtimeMs: 1_783_512_062_000,
    generatedAt: now,
  },
  board: {
    id: 'release-2025-05-16',
    filename: 'release-2025-05-16.board.json',
    goal: 'Ship release train with verified infra handoff',
    mtime_ms: 1_783_512_062_000,
    hash: 'sha256:fixture',
    git: { branch: 'release/train-0516' },
    meta: { template_version: 3 },
  },
  freshness: {
    state: 'live',
    last_read_at: now,
    last_known_good_at: now,
    errors: [],
  },
  summary: {
    readySet: ['fetch-config', 'mig-c'],
    criticalPath: {
      chain: CRITICAL_PATH,
      makespan: 19_800_000,
      weight_source: 'estimates',
    },
    awaitingUserCount: 2,
    verifiedDone: 6,
  },
  insights: {
    impact: { id: 'root', count: 15 },
    convergence: { id: 'deploy-infra', in_deg: 2 },
    bottleneck: {
      id: 'deploy-infra',
      impact: 4,
      status: 'in_flight',
      since: '2026-07-08T10:05:00Z',
      elapsed_ms: 8_358_000,
    },
    wip: { count: 4, limit: 3, over: true },
    awaiting: { count: 2, oldest_gate_elapsed_ms: 12_258_000 },
    age_ms: 15_558_000,
    per_node: PER_NODE,
  },
  board_extras: fixtureBoardExtras,
  agents: fixtureAgents,
  agent_insights: {
    total: 4,
    active: 3,
    running: 2,
    by_state: { running: 2, uncertain: 1, terminal: 1 },
    by_harness: { codex: 1, 'claude-code': 1, origin: 1 },
    oldest_in_flight: {
      id: 'agt-001',
      registered_at: '2026-07-08T10:05:00Z',
      elapsed_ms: 8_358_000,
    },
    unclaimed_ready: [
      { id: 'fetch-config', title: 'Fetch launch config' },
      { id: 'mig-c', title: 'Migrate shard c' },
    ],
  },
  tasks: fixtureTasks,
  graph: {
    family: 'task-dag',
    critical_path: CRITICAL_PATH,
    ready_set: ['fetch-config', 'mig-c'],
    ranks: [...ranksGrouped.entries()]
      .sort(([a], [b]) => a - b)
      .map(([rank, nodeIds]) => ({ id: `R${rank}`, label: `R${rank}`, node_ids: nodeIds })),
    nodes: fixtureTasks.map((task) => {
      const selectedRoute = task.execution?.route?.selected;
      return {
        id: task.id,
        title: task.title ?? task.id,
        status: task.status ?? 'ready',
        type: task.type ?? 'task',
        rank: `R${RANK_BY_ID[task.id] ?? 0}`,
        rank_index: RANK_BY_ID[task.id] ?? 0,
        executor: task.executor,
        handle: task.handle,
        tags: task.tags,
        critical: CRITICAL_PATH.includes(task.id),
        selected: task.id === 'deploy-infra',
        awaiting_user: AWAITING.has(task.id),
        stale: ['failed', 'uncertain', 'escalated'].includes(task.status ?? ''),
        route_outcome: task.execution?.route?.outcome,
        harness: selectedRoute?.harness,
        surface: selectedRoute?.surface,
        surface_label: selectedRoute?.surface_label,
        model: selectedRoute?.model,
        role_grades: selectedRoute?.role_grades,
        agent_refs: fixtureAgentRefs.get(task.id) ?? []
      };
    }),
    edges: derived.edges,
    upstream: derived.upstream,
    downstream: derived.downstream,
    parents: derived.parents,
  },
  status: {
    buckets: [
      { id: 'ready', label: 'Ready', tone: 'ready', count: 3 },
      { id: 'in-flight', label: 'In Flight', tone: 'in-flight', count: 3 },
      { id: 'awaiting-user', label: 'Awaiting User', tone: 'awaiting-user', count: 2 },
      { id: 'blocked', label: 'Blocked', tone: 'blocked', count: 2 },
      { id: 'stale', label: 'Stale / Error', tone: 'stale', count: 4 },
      { id: 'done', label: 'Done / Verified', tone: 'done', count: 6 },
    ],
    awaiting_user: [
      {
        id: 'user-approval',
        title: 'Approve credential plan',
        command: 'ccm task show user-approval',
      },
      { id: 'run-jobs', title: 'Run verification jobs', command: 'ccm task show run-jobs' },
    ],
    in_flight: [
      { id: 'deploy-infra', title: 'Deploy infra cutover', handle: 'run_9a3d2b1e', age: '18m' },
      { id: 'migration', title: 'Data migration wave', age: '12m' },
      { id: 'mig-b', title: 'Migrate ledgers shard', age: '8m' },
    ],
    blocked: [{ id: 'verify-results', title: 'Verify launch evidence', reason: 'run-jobs' }],
  },
  diagnostics: {
    lint: [{ severity: 'warning', message: '2 warnings' }],
    over_scheduling: [{ severity: 'warning', message: 'wip 4 exceeds wip_limit 3' }],
    report_freshness: 'fresh',
  },
  defaults: {
    selected_task_id: 'deploy-infra',
    focus: 'critical_path_or_ready',
  },
};

export const fixtureTask: TaskDetailPayload = {
  schema: 'ccm/web-viewer-task/v1',
  task: {
    id: 'deploy-infra',
    title: 'Deploy infra cutover',
    status: 'in_flight',
    type: 'run',
    rank: 'R4',
    deps: ['plan-execution', 'user-approval'],
    parents: ['plan-execution', 'user-approval'],
    children: ['migration', 'run-jobs'],
    executor: 'runner',
    handle: 'run_9a3d2b1e',
    tags: ['infra', 'deploy', 'terraform'],
    progress: 62,
    created_at: '2026-07-08T08:00:00Z',
    started_at: '2026-07-08T10:05:00Z',
    updated_at: '18s ago',
    justification: 'The cutover gates every downstream verification lane; it must land first.',
    dep_pins: { 'plan-execution': 'sha256:plan-v3' },
    hitl_rounds: 1,
    notes: 'Terraform apply is in the second of three stages.',
    estimate: { value: 90, unit: 'm' },
    acceptance: {
      criteria: [
        { desc: 'terraform apply exits 0 on all three stages', kind: 'test', status: 'met' },
        {
          desc: 'p99 cutover latency below 400ms',
          kind: 'metric',
          target: '400ms',
          status: 'pending',
        },
        { desc: 'second reviewer signs off the runbook diff', kind: 'review', status: 'failed' },
      ],
    },
    execution: fixtureTasks.find((task) => task.id === 'deploy-infra')?.execution,
    summary: 'Provisioning is active. The critical path remains clear while policy-check is stale.',
    next_actions: ['Monitor run progress', 'Review plan output', 'Proceed to run-jobs on success'],
  },
  dependencies: [
    { id: 'plan-execution', title: 'Plan execution graph', status: 'done' },
    { id: 'user-approval', title: 'Approve credential plan', status: 'blocked' },
  ],
  dependents: [
    { id: 'migration', title: 'Data migration wave', status: 'in_flight' },
    { id: 'run-jobs', title: 'Run verification jobs', status: 'in_flight' },
  ],
  activity: [
    { at: '10:05:00', text: 'Run started by ccm service' },
    { at: '10:31:20', text: 'Terraform plan uploaded' },
    { at: '11:42:53', text: 'Awaiting final apply result' },
  ],
};

export const fixtureStatusReport: StatusReportPayload = {
  schema: 'ccm/status-report/v1',
  artifact: {
    freshness: 'fresh',
    generated_at: now,
    expires_at: '2026-07-08T12:26:18Z',
  },
  progress: {
    total: 20,
    done: 6,
    in_flight: 4,
    ready: 3,
    blocked: 4,
  },
  next_actions: {
    ready_to_dispatch: [
      { id: 'fetch-config', title: 'Fetch environment config' },
      { id: 'mig-c', title: 'Migrate archives shard' },
    ],
    awaiting_user: [
      {
        id: 'user-approval',
        title: 'Approve credential plan',
        command: 'ccm task show user-approval',
      },
    ],
    operator_attention: [
      { id: 'policy-check', title: 'Policy advisory stale', severity: 'warning' },
    ],
  },
  risks: [
    { kind: 'over_scheduling', severity: 'medium', in_flight: 4, wip_limit: 3 },
    { kind: 'attention_tasks', severity: 'medium', count: 4 },
  ],
  health: [
    { id: 'lint', label: 'Board lint', state: 'warning', detail: '2 warnings' },
    { id: 'usage', label: 'Usage verdict', state: 'ok', detail: 'within pacing corridor' },
    { id: 'freshness', label: 'Report freshness', state: 'fresh', detail: '18s ago' },
  ],
};
