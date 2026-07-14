import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  type ClaudeProviderRequest,
  compileClaudeProviderInvocation,
  invokeOfflineClaudeProvider,
  preflightClaudeProvider,
  reconcileClaudeProviderTerminal,
} from '../src/claude-provider-driver.js';
import { createDefaultProviderRuntime, type ProviderRuntime } from '../src/provider-runtime.js';

const FIXTURE = fileURLToPath(
  new URL('./fixtures/claude-provider-driver-v1/fake-claude.sh', import.meta.url),
);
const WORKSPACE = fileURLToPath(new URL('..', import.meta.url));
const NOW = '2026-07-14T12:00:00.000Z';

function request(overrides: Partial<ClaudeProviderRequest> = {}): ClaudeProviderRequest {
  return {
    schema: 'ccm/claude-provider-request/v1',
    request_id: 'fixture-request',
    run_ref: 'run_fixture:attempt_1',
    origin_harness: 'claude-code',
    provider: 'claude',
    workspace: WORKSPACE,
    objective: 'fixture:success',
    model: 'claude-fixture-exact',
    effort: 'high',
    permission: {
      mode: 'dontAsk',
      account_mutation: 'forbidden',
      credential_write: 'forbidden',
      remote_mutation: 'forbidden',
    },
    admission: {
      policy: { decision: 'allow', observed_at: NOW, valid_until: '2026-07-14T12:05:00.000Z' },
      auth: {
        state: 'authenticated',
        observed_at: NOW,
        valid_until: '2026-07-14T12:05:00.000Z',
      },
      quota: {
        state: 'ample',
        pool: { kind: 'subscription', pool_id: 'fixture-subscription-pool' },
        preflight: { decision: 'allow', freshness: 'fresh', spawn_count: 0 },
        ticket: {
          schema: 'ccm/quota-admission-ticket/v1',
          run_ref: 'run_fixture:attempt_1',
          account_id: 'fixture-account',
          pool_id: 'fixture-subscription-pool',
          identity_fingerprint: 'fixture-identity',
          launch_by: '2026-07-14T12:04:00.000Z',
        },
        observed_at: NOW,
        valid_until: '2026-07-14T12:05:00.000Z',
      },
      model: {
        state: 'available',
        requested: 'claude-fixture-exact',
        resolved: 'claude-fixture-exact',
        observed_at: NOW,
        valid_until: '2026-07-14T12:05:00.000Z',
      },
    },
    timeouts_ms: { startup: 500, idle: 500, hard: 2_000 },
    ...overrides,
  };
}

function fixtureRuntime(counters: { resolve: number; spawn: number }): ProviderRuntime {
  const base = createDefaultProviderRuntime({ PATH: process.env.PATH });
  return {
    ...base,
    process: {
      resolveExecutable(provider) {
        counters.resolve += 1;
        assert.equal(provider, 'claude');
        return '/bin/bash';
      },
      spawnProvider(spec) {
        counters.spawn += 1;
        return base.process.spawnProvider({
          ...spec,
          executable: '/bin/bash',
          argv: [FIXTURE, ...spec.argv],
        });
      },
    },
  };
}

test('same-origin and other-origin selection share one Claude CLI candidate without identity collapse', () => {
  const same = preflightClaudeProvider(request(), NOW);
  const other = preflightClaudeProvider(request({ origin_harness: 'codex' }), NOW);

  assert.equal(same.decision, 'allow');
  assert.deepEqual(same.selection, {
    origin_harness: 'claude-code',
    provider_harness: 'claude-code',
    relation: 'same-origin',
    surface: 'cli-headless',
  });
  assert.equal(other.decision, 'allow');
  assert.deepEqual(other.selection, {
    origin_harness: 'codex',
    provider_harness: 'claude-code',
    relation: 'other-origin',
    surface: 'cli-headless',
  });
});

test('compile is deterministic, stdin-based, permission-bounded, and secret-free', () => {
  const compiled = compileClaudeProviderInvocation(request(), NOW);

  assert.deepEqual(compiled.argv, [
    '-p',
    'Treat stdin as the complete worker envelope and return only the requested JSON result.',
    '--model',
    'claude-fixture-exact',
    '--effort',
    'high',
    '--permission-mode',
    'dontAsk',
    '--output-format',
    'json',
  ]);
  assert.equal(compiled.cwd, WORKSPACE);
  assert.equal(JSON.parse(compiled.stdin).run_ref, 'run_fixture:attempt_1');
  assert.deepEqual(compiled.env, {
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    NO_COLOR: '1',
  });
  assert.equal(compiled.constraints.account_mutation, 'forbidden');
  assert.equal(compiled.constraints.credential_write, 'forbidden');
  assert.equal(compiled.constraints.remote_mutation, 'forbidden');
});

test('unknown, stale, mismatch, and deny admissions have zero process effect', async (t) => {
  const cases: Array<[string, ClaudeProviderRequest]> = [
    [
      'auth unknown',
      request({
        admission: {
          ...request().admission,
          auth: { ...request().admission.auth, state: 'unknown' },
        },
      }),
    ],
    [
      'quota unknown',
      request({
        admission: {
          ...request().admission,
          quota: { ...request().admission.quota, state: 'unknown' },
        },
      }),
    ],
    [
      'model unknown',
      request({
        admission: {
          ...request().admission,
          model: { ...request().admission.model, state: 'unknown' },
        },
      }),
    ],
    [
      'policy unknown',
      request({
        admission: {
          ...request().admission,
          policy: { ...request().admission.policy, decision: 'unknown' },
        },
      }),
    ],
    [
      'policy deny',
      request({
        admission: {
          ...request().admission,
          policy: { ...request().admission.policy, decision: 'deny' },
        },
      }),
    ],
    [
      'quota stale',
      request({
        admission: {
          ...request().admission,
          quota: { ...request().admission.quota, valid_until: '2026-07-14T11:59:59.000Z' },
        },
      }),
    ],
    [
      'auth stale',
      request({
        admission: {
          ...request().admission,
          auth: { ...request().admission.auth, valid_until: '2026-07-14T11:59:59.000Z' },
        },
      }),
    ],
    [
      'model stale',
      request({
        admission: {
          ...request().admission,
          model: { ...request().admission.model, valid_until: '2026-07-14T11:59:59.000Z' },
        },
      }),
    ],
    [
      'policy stale',
      request({
        admission: {
          ...request().admission,
          policy: { ...request().admission.policy, valid_until: '2026-07-14T11:59:59.000Z' },
        },
      }),
    ],
    [
      'model mismatch',
      request({
        admission: {
          ...request().admission,
          model: { ...request().admission.model, resolved: 'claude-other' },
        },
      }),
    ],
    [
      'pool mismatch',
      request({
        admission: {
          ...request().admission,
          quota: { ...request().admission.quota, pool: { kind: 'api', pool_id: 'api-pool' } },
        },
      }),
    ],
    [
      'quota ticket run_ref mismatch',
      request({
        admission: {
          ...request().admission,
          quota: {
            ...request().admission.quota,
            ticket: { ...request().admission.quota.ticket, run_ref: 'run_other:attempt_9' },
          },
        },
      }),
    ],
    [
      'quota preflight deny',
      request({
        admission: {
          ...request().admission,
          quota: {
            ...request().admission.quota,
            preflight: { decision: 'reject', freshness: 'fresh', spawn_count: 0 },
          },
        },
      }),
    ],
  ];

  for (const [name, candidate] of cases) {
    await t.test(name, async () => {
      const counters = { resolve: 0, spawn: 0 };
      const result = await invokeOfflineClaudeProvider(candidate, fixtureRuntime(counters), {
        now: NOW,
      });
      assert.equal(result.status, 'rejected');
      assert.equal(result.process.spawn_count, 0);
      assert.deepEqual(counters, { resolve: 0, spawn: 0 });
    });
  }
});

test('controlled success is terminal evidence but never task completion', async () => {
  const counters = { resolve: 0, spawn: 0 };
  const result = await invokeOfflineClaudeProvider(request(), fixtureRuntime(counters), {
    now: NOW,
  });

  assert.equal(result.status, 'succeeded', JSON.stringify(result));
  assert.deepEqual(counters, { resolve: 1, spawn: 1 });
  assert.equal(result.run_ref, 'run_fixture:attempt_1');
  assert.equal(result.terminal.kind, 'provider_terminal');
  assert.deepEqual(result.actual_identity, {
    model: 'claude-fixture-exact',
    effort: 'high',
    identity_fingerprint: 'fixture-identity',
  });
  assert.equal(result.reconciliation.attempt_state, 'terminal');
  assert.equal(result.reconciliation.task_state, 'unproven');
  assert.equal(result.reconciliation.needs_independent_acceptance, true);
  assert.deepEqual(result.side_effects, {
    account_mutations: 0,
    credential_writes: 0,
    provider_requests: 0,
    remote_mutations: 0,
  });
});

test('reconciliation is a pure run_ref echo and cannot promote task completion', () => {
  assert.deepEqual(reconcileClaudeProviderTerminal('run_fixture:attempt_7'), {
    schema: 'ccm/claude-provider-reconciliation/v1',
    run_ref: 'run_fixture:attempt_7',
    attempt_state: 'terminal',
    task_state: 'unproven',
    needs_independent_acceptance: true,
  });
});

test('controlled provider error is a structured terminal result with its run_ref', async () => {
  const counters = { resolve: 0, spawn: 0 };
  const result = await invokeOfflineClaudeProvider(
    request({ objective: 'fixture:error' }),
    fixtureRuntime(counters),
    { now: NOW },
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.run_ref, 'run_fixture:attempt_1');
  assert.equal(result.error?.code, 'provider_failed', JSON.stringify(result));
  assert.deepEqual(result.error?.messages, ['controlled fixture failure']);
  assert.equal(result.reconciliation.task_state, 'unproven');
});

test('actual-model mismatch fails closed after the controlled process terminal', async () => {
  const counters = { resolve: 0, spawn: 0 };
  const result = await invokeOfflineClaudeProvider(
    request({ objective: 'fixture:model-mismatch' }),
    fixtureRuntime(counters),
    { now: NOW },
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.error?.code, 'actual_model_mismatch', JSON.stringify(result));
  assert.deepEqual(result.actual_models, ['claude-other-fixture']);
  assert.equal(result.reconciliation.task_state, 'unproven');
});

test('actual-effort mismatch fails closed after the controlled process terminal', async () => {
  const counters = { resolve: 0, spawn: 0 };
  const result = await invokeOfflineClaudeProvider(
    request({ objective: 'fixture:effort-mismatch' }),
    fixtureRuntime(counters),
    { now: NOW },
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.error?.code, 'actual_effort_mismatch', JSON.stringify(result));
  assert.equal(result.reconciliation.task_state, 'unproven');
});

test('actual identity mismatch fails closed after the controlled process terminal', async () => {
  const counters = { resolve: 0, spawn: 0 };
  const result = await invokeOfflineClaudeProvider(
    request({ objective: 'fixture:identity-mismatch' }),
    fixtureRuntime(counters),
    { now: NOW },
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.error?.code, 'actual_identity_mismatch', JSON.stringify(result));
  assert.equal(result.actual_identity, null);
  assert.equal(result.reconciliation.task_state, 'unproven');
});

test('malformed structured output fails closed after an otherwise successful terminal', async () => {
  const counters = { resolve: 0, spawn: 0 };
  const result = await invokeOfflineClaudeProvider(
    request({ objective: 'fixture:output-malformed' }),
    fixtureRuntime(counters),
    { now: NOW },
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.error?.code, 'structured_output_malformed', JSON.stringify(result));
  assert.equal(result.output, null);
  assert.equal(result.reconciliation.task_state, 'unproven');
});

test('terminal without a provider session identity fails closed', async () => {
  const counters = { resolve: 0, spawn: 0 };
  const result = await invokeOfflineClaudeProvider(
    request({ objective: 'fixture:terminal-missing-session' }),
    fixtureRuntime(counters),
    { now: NOW },
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.error?.code, 'terminal_invalid', JSON.stringify(result));
  assert.equal(result.output, null);
  assert.equal(result.reconciliation.task_state, 'unproven');
});

test('provider timeout is structured, reaped, and reconciled without claiming task done', async () => {
  const counters = { resolve: 0, spawn: 0 };
  const result = await invokeOfflineClaudeProvider(
    request({ objective: 'fixture:hang', timeouts_ms: { startup: 100, idle: 100, hard: 1_000 } }),
    fixtureRuntime(counters),
    { now: NOW },
  );

  assert.equal(result.status, 'timed_out', JSON.stringify(result));
  assert.equal(result.error?.code, 'idle_timeout');
  assert.equal(result.process.reaped, true);
  assert.equal(result.reconciliation.task_state, 'unproven');
});

test('cancellation is structured, reaped, and reconciled without claiming task done', async () => {
  const counters = { resolve: 0, spawn: 0 };
  const abort = new AbortController();
  const pending = invokeOfflineClaudeProvider(
    request({ objective: 'fixture:hang' }),
    fixtureRuntime(counters),
    { now: NOW, signal: abort.signal },
  );
  setTimeout(() => abort.abort(new Error('controlled cancel')), 100);
  const result = await pending;

  assert.equal(result.status, 'cancelled', JSON.stringify(result));
  assert.equal(result.error?.code, 'cancelled');
  assert.equal(result.process.reaped, true);
  assert.equal(result.run_ref, 'run_fixture:attempt_1');
  assert.equal(result.reconciliation.attempt_state, 'terminal');
  assert.equal(result.reconciliation.task_state, 'unproven');
});

test('provider runtime network authority remains unavailable to the driver', () => {
  const runtime = createDefaultProviderRuntime({});
  assert.throws(() => runtime.network.request('anthropic/request'), /network capability is denied/);
});
