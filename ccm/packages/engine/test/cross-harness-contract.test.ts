import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  contractActivation,
  createRoutingEnvelope,
  routeOutcomeClass,
  routingContractAppliesToTask,
  routingContractPreflight,
  validateRoutedTaskForInFlight,
  validateRoutingEnvelope,
  validateTaskPlanning,
} from '../src/routing-contract.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures', 'cross-harness-routing');

// biome-ignore lint/suspicious/noExplicitAny: Golden JSON is deliberately mutated through several incompatible fixture shapes.
function fixture(name: string): any {
  return JSON.parse(readFileSync(join(FIX, `${name}.json`), 'utf8'));
}

function planning(): Record<string, unknown> {
  return {
    schema: 'ccm/task-planning/v1',
    assessed_at: '2026-07-10T08:00:00Z',
    assessor: 'master-orchestrator',
    dimensions: {
      reasoning: 'novel',
      uncertainty: 'medium',
      risk: 'high',
      scope: 'cross-module',
      context: 'large',
      coordination: 'single-boundary',
      reversibility: 'costly',
    },
    estimate_confidence: 'medium',
    quality: { effect_floor: 'meets-required-capabilities' },
    budget: { posture: 'ample', max_attempts: 3 },
    capabilities: {
      required: [{ id: 'structured-output' }],
      preferred: [{ id: 'live-web-research' }],
      forbidden: [{ id: 'push-remote' }],
    },
  };
}

function policy(): Record<string, unknown> {
  return {
    objective: 'balanced',
    constraints: {
      effect_floor: 'meets-required-capabilities',
      quota_unknown: 'ineligible',
      cross_harness_quota_admission: 'ample-only',
    },
    candidates: [
      {
        id: 'future-cli',
        surface: 'cli-headless',
        adapter: 'future-harness/headless-v1',
        harness: 'future-harness',
        provider: 'future-provider',
        model: 'future-model-2030',
        effort: 'ultra',
        capabilities: ['structured-output'],
        effect_floors_met: ['meets-required-capabilities'],
        permission: { profile: 'read-only', denies: ['push-remote', 'account-mutation'] },
        account_mutation: 'forbidden',
        requires: [
          'runtime-healthy',
          'capability-match',
          'effect-floor',
          'permission-compatible',
          'account-mutation-forbidden',
        ],
      },
    ],
    chains: { ample: ['future-cli'], tight: ['future-cli'] },
    fallback: {
      on: ['transport-error'],
      never_on: [
        'policy-blocked',
        'permission-blocked',
        'security-blocked',
        'workspace-mismatch',
        'task-blocked',
        'acceptance-failed',
      ],
      exhaustion: 'fail-closed',
      same_harness: 'explicit-candidate-only',
    },
  };
}

test('contract activation is additive: missing is legacy, partial is invalid, exact pair is enabled', () => {
  assert.equal(contractActivation({ meta: { template_version: 3 } }), 'legacy');
  assert.equal(
    contractActivation({
      meta: { contracts: { task_planning: 'ccm/task-planning/v1' } },
    }),
    'invalid',
  );
  assert.equal(
    contractActivation({
      meta: {
        contracts: {
          task_planning: 'ccm/task-planning/v1',
          agent_routing: 'ccm/agent-routing/v1',
          agent_routing_activated_at: '2026-07-10T08:00:00Z',
          agent_routing_grandfathered_terminal: [],
          future_contract: 'ccm/future/v1',
        },
      },
    }),
    'enabled',
  );
});

test('planning v1 preserves independent difficulty/effect/budget/capability axes', () => {
  assert.deepEqual(validateTaskPlanning(planning()), []);

  // biome-ignore lint/suspicious/noExplicitAny: this negative test deletes required nested fields dynamically.
  const collapsed = planning() as any;
  delete collapsed.dimensions.uncertainty;
  delete collapsed.quality;
  collapsed.budget.posture = 'cheap-model';
  collapsed.capabilities.preferred = [{ id: 'structured-output' }];
  const paths = validateTaskPlanning(collapsed).map((x) => x.path);
  assert.ok(paths.includes('planning.dimensions.uncertainty'));
  assert.ok(paths.includes('planning.quality.effect_floor'));
  assert.ok(paths.includes('planning.budget.posture'));
  assert.ok(paths.includes('planning.capabilities'));
});

test('routing v1 is brand-open but surface/chain/fallback authority stays mechanical', () => {
  const routing = createRoutingEnvelope(policy());
  assert.deepEqual(validateRoutingEnvelope(routing), []);

  // biome-ignore lint/suspicious/noExplicitAny: this negative test corrupts nested routing fields dynamically.
  const unsafe = structuredClone(routing) as any;
  unsafe.policy.candidates[0].model = 'auto';
  unsafe.policy.chains.tight = ['missing-candidate'];
  unsafe.policy.fallback.on = ['acceptance-failed'];
  const messages = validateRoutingEnvelope(unsafe).map((x) => `${x.path}:${x.message}`);
  assert.ok(messages.some((x) => x.includes('model')));
  assert.ok(messages.some((x) => x.includes('chains.tight')));
  assert.ok(messages.some((x) => x.includes('fallback.on')));
});

test('contract preflight leaves legacy interpretation alone but enumerates activation gaps', () => {
  const legacy = {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    tasks: [{ id: 'T1', status: 'ready', deps: [], executor: 'subagent' }],
  };
  assert.equal(contractActivation(legacy), 'legacy');
  const report = routingContractPreflight(legacy);
  assert.equal(report.ready, false);
  assert.deepEqual(
    report.tasks.map((x) => x.task_id),
    ['T1'],
  );
  assert.ok(report.tasks[0].issues.some((x) => x.path.startsWith('planning')));
  assert.ok(report.tasks[0].issues.some((x) => x.path.startsWith('routing')));
});

test('activation grandfathers historical terminal tasks but never newly-created terminal shortcuts', () => {
  const activation = {
    meta: {
      contracts: {
        task_planning: 'ccm/task-planning/v1',
        agent_routing: 'ccm/agent-routing/v1',
        agent_routing_activated_at: '2026-07-10T08:00:00Z',
        agent_routing_grandfathered_terminal: [
          { task_id: 'old', created_at: '2026-07-09T08:00:00Z' },
        ],
      },
    },
  };
  assert.equal(
    routingContractAppliesToTask(activation, {
      id: 'old',
      executor: 'subagent',
      status: 'done',
      created_at: '2026-07-09T08:00:00Z',
    }),
    false,
  );
  assert.equal(
    routingContractAppliesToTask(activation, {
      id: 'new',
      executor: 'subagent',
      status: 'done',
      created_at: '2026-07-10T09:00:00Z',
    }),
    true,
  );
  assert.equal(
    routingContractAppliesToTask(activation, {
      id: 'old',
      executor: 'subagent',
      status: 'ready',
      created_at: '2026-07-09T08:00:00Z',
    }),
    true,
    'failed/escalated/done task loses exemption as soon as it re-enters ready',
  );
  assert.equal(
    routingContractAppliesToTask(activation, {
      id: 'old',
      executor: 'subagent',
      status: 'done',
      created_at: '2026-07-10T10:00:00Z',
    }),
    true,
    'recreated task id cannot inherit an old created_at fingerprint',
  );
});

test('candidate eligibility is a set contract, not independent field presence', () => {
  const f = fixture('same-harness-cli');
  const broken = structuredClone(f.task);
  const candidate = broken.routing.policy.candidates[0];
  candidate.capabilities = [];
  candidate.permission.denies = [];
  candidate.effect_floors_met = [];
  candidate.account_mutation = 'supported';
  const messages = validateRoutedTaskForInFlight(broken).map((x) => `${x.path}:${x.message}`);
  assert.ok(messages.some((x) => x.includes('capabilities')));
  assert.ok(messages.some((x) => x.includes('effect_floors_met')));
  assert.ok(messages.some((x) => x.includes('permission.denies')));
  assert.ok(messages.some((x) => x.includes('account_mutation')));
});

test('attempt freezes selection evidence/rationale so selected projection cannot erase audit history', () => {
  const f = fixture('other-harness-cli');
  assert.deepEqual(validateRoutedTaskForInFlight(f.task), []);
  const erased = structuredClone(f.task);
  erased.routing.attempts[0].selection_snapshot.reason_codes = ['different-reason'];
  assert.ok(
    validateRoutedTaskForInFlight(erased).some(
      (entry) => entry.path === 'routing.attempts[0].selection_snapshot',
    ),
  );
});

test('in-flight routed task requires selection, a single running attempt, and matching handle', () => {
  const f = fixture('same-harness-cli');
  assert.deepEqual(validateRoutedTaskForInFlight(f.task), []);

  const missing = structuredClone(f.task);
  missing.handle = '';
  missing.routing.attempts = [];
  const paths = validateRoutedTaskForInFlight(missing).map((x) => x.path);
  assert.ok(paths.includes('routing.attempts'));
  assert.ok(paths.includes('handle'));
});

test('golden route outcomes replay same-native, same/other CLI, origin-stay, and no-route', () => {
  const cases = [
    ['same-native', 'same-native'],
    ['same-harness-cli', 'same-harness-cli'],
    ['other-harness-cli', 'other-harness-cli'],
    ['origin-stay', 'origin-stay'],
    ['no-route', 'no-route'],
  ] as const;
  for (const [name, expected] of cases) {
    const f = fixture(name);
    assert.deepEqual(validateTaskPlanning(f.task.planning), [], `${name}: planning`);
    assert.deepEqual(validateRoutingEnvelope(f.task.routing), [], `${name}: routing`);
    assert.equal(routeOutcomeClass(f.origin_harness, f.task.routing), expected, name);
  }
});
