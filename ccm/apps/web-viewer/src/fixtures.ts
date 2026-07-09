import type { BoardsPayload, StatusReportPayload, TaskDetailPayload, ViewModelPayload } from './types';

const now = '2026-07-08T12:24:18Z';

export const fixtureBoards: BoardsPayload = {
  schema: 'ccm/web-viewer-boards/v1',
  service: {
    home: '~/.cc_master',
    health: 'ok',
    id: 'wv_fixture'
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
      task_count: 53,
      updated_at: now
    },
    {
      id: 'infra-migration',
      filename: 'infra-migration.board.json',
      goal: 'Migrate deployment graph to new account pool',
      active: true,
      health: 'stale',
      task_count: 28
    },
    {
      id: 'data-pipeline-v2',
      filename: 'data-pipeline-v2.board.json',
      goal: 'Reconcile pipeline status reports',
      health: 'ok',
      task_count: 34
    },
    {
      id: 'incident-2407',
      filename: 'incident-2407.board.json',
      goal: 'Close incident remediation tasks',
      health: 'error',
      task_count: 11
    }
  ]
};

export const fixtureViewModel: ViewModelPayload = {
  schema: 'ccm/web-viewer-view-model/v1',
  board: {
    id: 'release-2025-05-16',
    filename: 'release-2025-05-16.board.json',
    goal: 'Ship release train with verified infra handoff',
    mtime_ms: 1_783_512_062_000,
    hash: 'sha256:fixture'
  },
  freshness: {
    state: 'live',
    last_read_at: now,
    last_known_good_at: now,
    errors: []
  },
  graph: {
    family: 'task-dag',
    critical_path: [
      'root',
      'fetch-inputs',
      'validate-inputs',
      'plan-execution',
      'deploy-infra',
      'run-jobs',
      'aggregate-results',
      'verify-results',
      'publish-report',
      'notify-user',
      'archive-artifacts',
      'close'
    ],
    ready_set: ['fetch-config', 'load-credentials', 'quality-gate'],
    ranks: [
      { id: 'R0', label: 'R0', node_ids: ['root'] },
      { id: 'R1', label: 'R1', node_ids: ['fetch-config', 'fetch-inputs', 'load-credentials'] },
      { id: 'R2', label: 'R2', node_ids: ['schema-check', 'validate-inputs', 'user-approval'] },
      { id: 'R3', label: 'R3', node_ids: ['plan-execution', 'resolve-deps', 'generate-plan'] },
      { id: 'R4', label: 'R4', node_ids: ['provision-infra', 'deploy-infra', 'secrets-sync', 'policy-check'] },
      { id: 'R5', label: 'R5', node_ids: ['pre-checks', 'run-jobs', 'monitor-jobs'] },
      { id: 'R6', label: 'R6', node_ids: ['aggregate-results'] },
      { id: 'R7', label: 'R7', node_ids: ['quality-gate', 'verify-results', 'manual-review'] },
      { id: 'R8', label: 'R8', node_ids: ['publish-report', 'notify-user'] },
      { id: 'R9', label: 'R9', node_ids: ['archive-artifacts', 'close'] }
    ],
    nodes: [
      { id: 'root', title: 'root', status: 'done', rank: 'R0', critical: true },
      { id: 'fetch-config', title: 'fetch-config', status: 'ready', rank: 'R1' },
      { id: 'fetch-inputs', title: 'fetch-inputs', status: 'done', rank: 'R1', critical: true },
      { id: 'load-credentials', title: 'load-credentials', status: 'ready', rank: 'R1' },
      { id: 'schema-check', title: 'schema-check', status: 'ready', rank: 'R2' },
      { id: 'validate-inputs', title: 'validate-inputs', status: 'done', rank: 'R2', critical: true },
      { id: 'user-approval', title: 'user-approval', status: 'awaiting-user', rank: 'R2', awaiting_user: true },
      { id: 'plan-execution', title: 'plan-execution', status: 'done', rank: 'R3', critical: true },
      { id: 'resolve-deps', title: 'resolve-deps', status: 'ready', rank: 'R3' },
      { id: 'generate-plan', title: 'generate-plan', status: 'ready', rank: 'R3' },
      { id: 'provision-infra', title: 'provision-infra', status: 'ready', rank: 'R4' },
      {
        id: 'deploy-infra',
        title: 'deploy-infra',
        status: 'in-flight',
        rank: 'R4',
        executor: 'runner',
        handle: 'run_9a3d2b1e',
        tags: ['infra', 'deploy', 'terraform'],
        critical: true,
        selected: true
      },
      { id: 'secrets-sync', title: 'secrets-sync', status: 'ready', rank: 'R4' },
      { id: 'policy-check', title: 'policy-check', status: 'stale', rank: 'R4', stale: true },
      { id: 'pre-checks', title: 'pre-checks', status: 'ready', rank: 'R5' },
      { id: 'run-jobs', title: 'run-jobs', status: 'in-flight', rank: 'R5', critical: true },
      { id: 'monitor-jobs', title: 'monitor-jobs', status: 'in-flight', rank: 'R5' },
      { id: 'aggregate-results', title: 'aggregate-results', status: 'done', rank: 'R6', critical: true },
      { id: 'quality-gate', title: 'quality-gate', status: 'ready', rank: 'R7' },
      { id: 'verify-results', title: 'verify-results', status: 'done', rank: 'R7', critical: true },
      { id: 'manual-review', title: 'manual-review', status: 'awaiting-user', rank: 'R7', awaiting_user: true },
      { id: 'publish-report', title: 'publish-report', status: 'stale', rank: 'R8', stale: true, critical: true },
      { id: 'notify-user', title: 'notify-user', status: 'ready', rank: 'R8', critical: true },
      { id: 'archive-artifacts', title: 'archive-artifacts', status: 'ready', rank: 'R9', critical: true },
      { id: 'close', title: 'close', status: 'ready', rank: 'R9', critical: true }
    ],
    edges: ([
      ['root', 'fetch-config'],
      ['root', 'fetch-inputs'],
      ['root', 'load-credentials'],
      ['fetch-config', 'schema-check'],
      ['fetch-inputs', 'validate-inputs'],
      ['load-credentials', 'user-approval'],
      ['validate-inputs', 'plan-execution'],
      ['validate-inputs', 'resolve-deps'],
      ['user-approval', 'generate-plan'],
      ['plan-execution', 'provision-infra'],
      ['plan-execution', 'deploy-infra'],
      ['resolve-deps', 'deploy-infra'],
      ['generate-plan', 'secrets-sync'],
      ['generate-plan', 'policy-check'],
      ['deploy-infra', 'run-jobs'],
      ['provision-infra', 'pre-checks'],
      ['secrets-sync', 'monitor-jobs'],
      ['run-jobs', 'aggregate-results'],
      ['monitor-jobs', 'aggregate-results'],
      ['quality-gate', 'verify-results'],
      ['aggregate-results', 'verify-results'],
      ['manual-review', 'verify-results'],
      ['verify-results', 'publish-report'],
      ['verify-results', 'notify-user'],
      ['notify-user', 'archive-artifacts'],
      ['archive-artifacts', 'close']
    ] satisfies Array<[string, string]>).map(([source, target]) => ({
      source,
      target,
      critical: [
        'root>fetch-inputs',
        'fetch-inputs>validate-inputs',
        'validate-inputs>plan-execution',
        'plan-execution>deploy-infra',
        'deploy-infra>run-jobs',
        'run-jobs>aggregate-results',
        'aggregate-results>verify-results',
        'verify-results>publish-report',
        'verify-results>notify-user',
        'notify-user>archive-artifacts',
        'archive-artifacts>close'
      ].includes(`${source}>${target}`)
    }))
  },
  status: {
    buckets: [
      { id: 'ready', label: 'Ready', tone: 'ready', count: 14 },
      { id: 'in-flight', label: 'In Flight', tone: 'in-flight', count: 5 },
      { id: 'awaiting-user', label: 'Awaiting User', tone: 'awaiting-user', count: 3 },
      { id: 'blocked', label: 'Blocked', tone: 'blocked', count: 3 },
      { id: 'stale', label: 'Stale / Error', tone: 'stale', count: 2 },
      { id: 'done', label: 'Done / Verified', tone: 'done', count: 27 }
    ],
    awaiting_user: [
      { id: 'user-approval', title: 'Approve credential plan', command: 'ccm task show user-approval' },
      { id: 'manual-review', title: 'Review launch evidence', command: 'ccm task show manual-review' }
    ],
    in_flight: [
      { id: 'deploy-infra', title: 'deploy-infra', handle: 'run_9a3d2b1e', age: '18m' },
      { id: 'run-jobs', title: 'run-jobs', handle: 'run_0cf55ad2', age: '12m' }
    ],
    blocked: [{ id: 'policy-check', title: 'policy-check', reason: 'stale policy advisory' }]
  },
  diagnostics: {
    lint: [{ severity: 'warning', message: '2 warnings' }],
    over_scheduling: [],
    report_freshness: 'fresh'
  },
  defaults: {
    selected_task_id: 'deploy-infra',
    focus: 'critical_path_or_ready'
  }
};

export const fixtureTask: TaskDetailPayload = {
  schema: 'ccm/web-viewer-task/v1',
  task: {
    id: 'deploy-infra',
    title: 'deploy-infra',
    status: 'in-flight',
    type: 'run',
    rank: 'R4',
    parents: ['plan-execution', 'resolve-deps'],
    children: ['run-jobs', 'monitor-jobs'],
    executor: 'runner',
    handle: 'run_9a3d2b1e',
    tags: ['infra', 'deploy', 'terraform'],
    progress: 62,
    started_at: '2025-05-16 09:24:11',
    elapsed: '00:18:42',
    eta: '-00:11:40',
    updated_at: '18s ago',
    summary: 'Provisioning is active. The critical path remains clear while policy-check is stale.',
    next_actions: ['Monitor run progress', 'Review plan output', 'Proceed to run-jobs on success']
  },
  dependencies: [
    { id: 'plan-execution', title: 'plan-execution', status: 'done' },
    { id: 'resolve-deps', title: 'resolve-deps', status: 'ready' }
  ],
  dependents: [
    { id: 'run-jobs', title: 'run-jobs', status: 'in-flight' },
    { id: 'monitor-jobs', title: 'monitor-jobs', status: 'in-flight' }
  ],
  activity: [
    { at: '09:24:11', text: 'Run started by ccm service' },
    { at: '09:31:20', text: 'Terraform plan uploaded' },
    { at: '09:42:53', text: 'Awaiting final apply result' }
  ]
};

export const fixtureStatusReport: StatusReportPayload = {
  schema: 'ccm/status-report/v1',
  artifact: {
    freshness: 'fresh',
    generated_at: now,
    expires_at: '2026-07-08T12:26:18Z'
  },
  progress: {
    total: 53,
    done: 27,
    in_flight: 5,
    ready: 14,
    blocked: 3
  },
  next_actions: {
    ready_to_dispatch: [
      { id: 'fetch-config', title: 'fetch-config' },
      { id: 'load-credentials', title: 'load-credentials' }
    ],
    awaiting_user: [
      { id: 'user-approval', title: 'Approve credential plan', command: 'ccm task show user-approval' }
    ],
    operator_attention: [{ id: 'policy-check', title: 'Policy advisory stale', severity: 'warning' }]
  },
  health: [
    { id: 'lint', label: 'Board lint', state: 'warning', detail: '2 warnings' },
    { id: 'usage', label: 'Usage verdict', state: 'ok', detail: 'within pacing corridor' },
    { id: 'freshness', label: 'Report freshness', state: 'fresh', detail: '18s ago' }
  ]
};
