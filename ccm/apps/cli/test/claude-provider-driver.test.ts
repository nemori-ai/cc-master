import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CLAUDE_PROVIDER_PARSE_REASON_CODES,
  CLAUDE_PROVIDER_TERMINAL_FAILURE_CODES,
  CLAUDE_PROVIDER_VALIDATION_REASON_CODES,
  type ClaudeProviderRequest,
  compileClaudeProviderInvocation,
  invokeOfflineClaudeProvider,
  preflightClaudeProvider,
  reconcileClaudeProviderTerminal,
} from '../src/claude-provider-driver.js';
import {
  createDefaultProviderRuntime,
  ProviderProcessTreeOwnershipError,
  type ProviderRuntime,
} from '../src/provider-runtime.js';

const FIXTURE = fileURLToPath(
  new URL('./fixtures/claude-provider-driver-v1/fake-claude.sh', import.meta.url),
);
const NEGATIVE_ORACLE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('./fixtures/claude-provider-driver-v1/negative-oracle.json', import.meta.url),
    ),
    'utf8',
  ),
) as {
  schema: string;
  parse_reasons: string[];
  validation_reasons: string[];
  terminal_failures: Array<{ code: string; objective: string }>;
  effect_failures: string[];
};
const WORKSPACE = fileURLToPath(new URL('..', import.meta.url));
const NOW = '2026-07-14T12:00:00.000Z';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

function request(overrides: Partial<ClaudeProviderRequest> = {}): ClaudeProviderRequest {
  const ticket = {
    schema: 'ccm/quota-admission-ticket/v1',
    ticket_id: 'fixture-ticket',
    reservation_id: 'fixture-reservation',
    reservation_request_hash: 'sha256:fixture-reservation-request',
    reservation_expires_at: '2026-07-14T12:05:00.000Z',
    attempt_id: 'attempt_1',
    run_ref: 'run_fixture:attempt_1',
    account_id: 'fixture-account',
    pool_id: 'fixture-subscription-pool',
    identity_fingerprint: 'fixture-identity',
    aggregation_key: 'claude|fixture-identity|fixture-subscription-pool|five_hour',
    live_source_revision: 'sha256:fixture-live-source',
    runtime_sha256: 'sha256:fixture-runtime',
    launch_idempotency_key: 'fixture-launch-key',
    launch_nonce: 'fixture-launch-nonce',
    issued_at: '2026-07-14T11:59:58.000Z',
    committed_at: '2026-07-14T11:59:59.000Z',
    launch_by: '2026-07-14T12:04:00.000Z',
  };
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
        pool: {
          kind: 'subscription',
          pool_id: 'fixture-subscription-pool',
          account_id: 'fixture-account',
          identity_fingerprint: 'fixture-identity',
        },
        reservation: {
          reservation_id: 'fixture-reservation',
          request_hash: 'sha256:fixture-reservation-request',
          expires_at: '2026-07-14T12:05:00.000Z',
          aggregation_key: 'claude|fixture-identity|fixture-subscription-pool|five_hour',
          source_revision: 'sha256:fixture-live-source',
        },
        preflight: { decision: 'allow', freshness: 'fresh', spawn_count: 0 },
        ticket,
        ticket_digest: digest(ticket),
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
    attempt_id: 'attempt_1',
    runtime_sha256: 'sha256:fixture-runtime',
    launch_idempotency_key: 'fixture-launch-key',
    launch_nonce: 'fixture-launch-nonce',
    timeouts_ms: { startup: 500, idle: 500, hard: 2_000 },
    ...overrides,
  } as ClaudeProviderRequest;
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
          quota: {
            ...request().admission.quota,
            pool: { ...request().admission.quota.pool, kind: 'api', pool_id: 'api-pool' },
          },
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

test('partial canonical ticket and digest mismatch cannot reach resolve or spawn', async (t) => {
  const complete = request() as unknown as Record<string, unknown>;
  const quota = (complete.admission as Record<string, unknown>).quota as Record<string, unknown>;
  const partialTicket = {
    schema: 'ccm/quota-admission-ticket/v1',
    run_ref: 'run_fixture:attempt_1',
    account_id: 'fixture-account',
    pool_id: 'fixture-subscription-pool',
    identity_fingerprint: 'fixture-identity',
    launch_by: '2026-07-14T12:04:00.000Z',
  };
  const cases: Array<[string, ClaudeProviderRequest]> = [
    [
      'partial ticket',
      structuredClone({
        ...complete,
        admission: {
          ...(complete.admission as Record<string, unknown>),
          quota: { ...quota, ticket: partialTicket, ticket_digest: digest(partialTicket) },
        },
      }) as ClaudeProviderRequest,
    ],
    [
      'ticket digest mismatch',
      structuredClone({
        ...complete,
        admission: {
          ...(complete.admission as Record<string, unknown>),
          quota: { ...quota, ticket_digest: 'sha256:not-the-authoritative-digest' },
        },
      }) as ClaudeProviderRequest,
    ],
  ];

  for (const [name, candidate] of cases) {
    await t.test(name, async () => {
      const counters = { resolve: 0, spawn: 0 };
      const result = await invokeOfflineClaudeProvider(candidate, fixtureRuntime(counters), {
        now: NOW,
      });
      assert.equal(result.status, 'rejected', JSON.stringify(result));
      assert.equal(result.process.spawn_count, 0);
      assert.deepEqual(counters, { resolve: 0, spawn: 0 });
    });
  }
});

test('every canonical ticket field is required before executable resolution', async (t) => {
  const fields = [
    'ticket_id',
    'reservation_id',
    'reservation_request_hash',
    'reservation_expires_at',
    'attempt_id',
    'run_ref',
    'account_id',
    'pool_id',
    'identity_fingerprint',
    'aggregation_key',
    'live_source_revision',
    'runtime_sha256',
    'launch_idempotency_key',
    'launch_nonce',
    'issued_at',
    'committed_at',
    'launch_by',
  ] as const;

  for (const field of fields) {
    await t.test(field, async () => {
      const candidate = structuredClone(request()) as unknown as Record<string, unknown>;
      const quota = ((candidate.admission as Record<string, unknown>).quota ?? {}) as Record<
        string,
        unknown
      >;
      const ticket = { ...(quota.ticket as Record<string, unknown>) };
      delete ticket[field];
      quota.ticket = ticket;
      quota.ticket_digest = digest(ticket);
      const counters = { resolve: 0, spawn: 0 };
      const result = await invokeOfflineClaudeProvider(
        candidate as unknown as ClaudeProviderRequest,
        fixtureRuntime(counters),
        { now: NOW },
      );
      assert.equal(result.status, 'rejected', `${field}: ${JSON.stringify(result)}`);
      assert.deepEqual(counters, { resolve: 0, spawn: 0 }, field);
    });
  }
});

test('every committed authority binding is checked independently of ticket digest', async (t) => {
  const mutations: Array<[string, (candidate: Record<string, unknown>) => void]> = [
    [
      'reservation_id',
      (candidate) => mutateTicket(candidate, 'reservation_id', 'other-reservation'),
    ],
    [
      'reservation_request_hash',
      (candidate) => mutateTicket(candidate, 'reservation_request_hash', 'sha256:other-request'),
    ],
    [
      'reservation_expires_at',
      (candidate) => mutateTicket(candidate, 'reservation_expires_at', '2026-07-14T12:04:30.000Z'),
    ],
    ['attempt_id', (candidate) => mutateTicket(candidate, 'attempt_id', 'attempt_2')],
    ['run_ref', (candidate) => mutateTicket(candidate, 'run_ref', 'run_fixture:attempt_2')],
    ['account_id', (candidate) => mutateTicket(candidate, 'account_id', 'other-account')],
    ['pool_id', (candidate) => mutateTicket(candidate, 'pool_id', 'other-pool')],
    [
      'identity_fingerprint',
      (candidate) => mutateTicket(candidate, 'identity_fingerprint', 'other-identity'),
    ],
    ['aggregation_key', (candidate) => mutateTicket(candidate, 'aggregation_key', 'other-group')],
    [
      'live_source_revision',
      (candidate) => mutateTicket(candidate, 'live_source_revision', 'sha256:other-source'),
    ],
    [
      'runtime_sha256',
      (candidate) => mutateTicket(candidate, 'runtime_sha256', 'sha256:other-runtime'),
    ],
    [
      'launch_idempotency_key',
      (candidate) => mutateTicket(candidate, 'launch_idempotency_key', 'other-launch-key'),
    ],
    ['launch_nonce', (candidate) => mutateTicket(candidate, 'launch_nonce', 'other-launch-nonce')],
  ];

  for (const [name, mutate] of mutations) {
    await t.test(name, async () => {
      const candidate = structuredClone(request()) as unknown as Record<string, unknown>;
      mutate(candidate);
      const counters = { resolve: 0, spawn: 0 };
      const result = await invokeOfflineClaudeProvider(
        candidate as unknown as ClaudeProviderRequest,
        fixtureRuntime(counters),
        { now: NOW },
      );
      assert.equal(result.status, 'rejected', `${name}: ${JSON.stringify(result)}`);
      assert.deepEqual(counters, { resolve: 0, spawn: 0 }, name);
    });
  }
});

function mutateTicket(candidate: Record<string, unknown>, field: string, value: string): void {
  const quota = (candidate.admission as Record<string, unknown>).quota as Record<string, unknown>;
  const ticket = quota.ticket as Record<string, unknown>;
  ticket[field] = value;
  quota.ticket_digest = digest(ticket);
}

function negativeInput(reason: string): { input: unknown; now: string } {
  if (reason === 'request_not_object') return { input: null, now: NOW };
  const input = structuredClone(request()) as unknown as Record<string, unknown>;
  const admission = input.admission as Record<string, unknown>;
  const policy = admission.policy as Record<string, unknown>;
  const auth = admission.auth as Record<string, unknown>;
  const quota = admission.quota as Record<string, unknown>;
  const pool = quota.pool as Record<string, unknown>;
  const reservation = quota.reservation as Record<string, unknown>;
  const preflight = quota.preflight as Record<string, unknown>;
  const model = admission.model as Record<string, unknown>;
  const timeouts = input.timeouts_ms as Record<string, unknown>;

  switch (reason) {
    case 'request_fields_invalid':
      input.extra = true;
      break;
    case 'request_schema_invalid':
      input.schema = 'ccm/claude-provider-request/v999';
      break;
    case 'provider_invalid':
      input.provider = 'codex';
      break;
    case 'origin_harness_invalid':
      input.origin_harness = 'evil';
      break;
    case 'effort_invalid':
      input.effort = 'turbo';
      break;
    case 'permission_invalid':
      (input.permission as Record<string, unknown>).mode = 'ask';
      break;
    case 'admission_fields_invalid':
      admission.extra = true;
      break;
    case 'policy_fact_invalid':
      policy.decision = 'maybe';
      break;
    case 'auth_fact_invalid':
      auth.state = 'maybe';
      break;
    case 'quota_fact_invalid':
      quota.state = 'maybe';
      break;
    case 'quota_pool_invalid':
      pool.kind = 'shared';
      break;
    case 'quota_reservation_invalid':
      delete reservation.source_revision;
      break;
    case 'quota_preflight_invalid':
      preflight.spawn_count = 'zero';
      break;
    case 'quota_ticket_invalid':
      delete (quota.ticket as Record<string, unknown>).ticket_id;
      break;
    case 'model_fact_invalid':
      model.state = 'maybe';
      break;
    case 'timeouts_fields_invalid':
      timeouts.startup = 'fast';
      break;
    case 'clock_invalid':
      return { input, now: 'not-a-clock' };
    case 'request_id_invalid':
      input.request_id = '';
      break;
    case 'run_ref_invalid':
      input.run_ref = '';
      break;
    case 'attempt_id_invalid':
      input.attempt_id = '';
      break;
    case 'workspace_invalid':
      input.workspace = 'relative/workspace';
      break;
    case 'objective_invalid':
      input.objective = '';
      break;
    case 'model_invalid':
      input.model = 'auto';
      break;
    case 'runtime_sha256_invalid':
      input.runtime_sha256 = '';
      break;
    case 'launch_idempotency_key_invalid':
      input.launch_idempotency_key = '';
      break;
    case 'launch_nonce_invalid':
      input.launch_nonce = '';
      break;
    case 'timeouts_invalid':
      timeouts.startup = 0;
      break;
    case 'startup_exceeds_hard_timeout':
      timeouts.startup = 2_001;
      break;
    case 'policy_not_allowed':
      policy.decision = 'deny';
      break;
    case 'auth_not_authenticated':
      auth.state = 'unauthenticated';
      break;
    case 'quota_not_ample':
      quota.state = 'tight';
      break;
    case 'quota_preflight_not_allowed':
      preflight.decision = 'reject';
      break;
    case 'quota_preflight_stale':
      preflight.freshness = 'soft-stale';
      break;
    case 'quota_preflight_effect_invalid':
      preflight.spawn_count = 1;
      break;
    case 'model_not_available':
      model.state = 'unavailable';
      break;
    case 'model_mismatch':
      model.resolved = 'claude-other';
      break;
    case 'quota_pool_kind_mismatch':
      pool.kind = 'api';
      break;
    case 'quota_authority_invalid':
      pool.account_id = '';
      break;
    case 'quota_ticket_digest_mismatch':
      quota.ticket_digest = 'sha256:mismatch';
      break;
    case 'quota_ticket_time_invalid':
      mutateTicket(input, 'committed_at', '2026-07-14T11:59:57.000Z');
      break;
    case 'quota_ticket_expired':
      mutateTicket(input, 'launch_by', '2026-07-14T11:59:59.000Z');
      break;
    case 'quota_ticket_mismatch':
      mutateTicket(input, 'reservation_id', 'other-reservation');
      break;
    case 'policy_stale_or_invalid':
      policy.valid_until = '2026-07-14T11:59:59.000Z';
      break;
    case 'auth_stale_or_invalid':
      auth.valid_until = '2026-07-14T11:59:59.000Z';
      break;
    case 'quota_stale_or_invalid':
      quota.valid_until = '2026-07-14T11:59:59.000Z';
      break;
    case 'model_stale_or_invalid':
      model.valid_until = '2026-07-14T11:59:59.000Z';
      break;
    default:
      throw new Error(`negative oracle has no mutation for ${reason}`);
  }
  return { input, now: NOW };
}

test('closed runtime parsing rejects invalid origin, extras, and malformed nesting structurally', async (t) => {
  const cases: Array<[string, unknown]> = [
    ['invalid origin', { ...request(), origin_harness: 'evil' }],
    ['extra top-level field', { ...request(), caller_trusts_me: true }],
    ['malformed permission', { ...request(), permission: undefined }],
  ];
  for (const [name, candidate] of cases) {
    await t.test(name, async () => {
      const counters = { resolve: 0, spawn: 0 };
      const result = await invokeOfflineClaudeProvider(
        candidate as ClaudeProviderRequest,
        fixtureRuntime(counters),
        { now: NOW },
      );
      assert.equal(result.status, 'rejected', JSON.stringify(result));
      assert.equal(result.process.spawn_count, 0);
      assert.deepEqual(counters, { resolve: 0, spawn: 0 });
    });
  }
});

test('versioned negative oracle is exact and executes every parser and validation reason', async (t) => {
  assert.equal(NEGATIVE_ORACLE.schema, 'ccm/claude-provider-negative-oracle/v1');
  assert.deepEqual(NEGATIVE_ORACLE.parse_reasons, [...CLAUDE_PROVIDER_PARSE_REASON_CODES]);
  assert.deepEqual(NEGATIVE_ORACLE.validation_reasons, [
    ...CLAUDE_PROVIDER_VALIDATION_REASON_CODES,
  ]);

  for (const reason of [...NEGATIVE_ORACLE.parse_reasons, ...NEGATIVE_ORACLE.validation_reasons]) {
    await t.test(reason, async () => {
      const { input, now } = negativeInput(reason);
      const counters = { resolve: 0, spawn: 0 };
      const result = await invokeOfflineClaudeProvider(input, fixtureRuntime(counters), { now });
      assert.equal(result.status, 'rejected', `${reason}: ${JSON.stringify(result)}`);
      assert.ok(
        result.preflight.reason_codes.includes(reason),
        `${reason}: ${JSON.stringify(result.preflight)}`,
      );
      assert.equal(result.preflight.claim_count, 0, reason);
      assert.equal(result.process.spawn_count, 0, reason);
      assert.deepEqual(counters, { resolve: 0, spawn: 0 }, reason);
    });
  }
});

test('synchronous resolver and spawn failures are structured with exact attempt accounting', async (t) => {
  assert.deepEqual(NEGATIVE_ORACLE.effect_failures, [
    'resolve_error',
    'spawn_error',
    'provider_process_tree_ownership_unavailable',
  ]);
  await t.test('resolver throw', async () => {
    const counters = { resolve: 0, spawn: 0 };
    const runtime = fixtureRuntime(counters);
    runtime.process.resolveExecutable = () => {
      counters.resolve += 1;
      throw new Error('resolve exploded');
    };
    const result = await invokeOfflineClaudeProvider(request(), runtime, { now: NOW });
    assert.equal(result.status, 'rejected', JSON.stringify(result));
    assert.equal(result.error?.code, 'resolve_error');
    assert.equal(result.process.spawn_count, 0);
    assert.equal(result.process.reaped, false);
    assert.deepEqual(counters, { resolve: 1, spawn: 0 });
  });

  await t.test('spawn throw', async () => {
    const counters = { resolve: 0, spawn: 0 };
    const runtime = fixtureRuntime(counters);
    runtime.process.spawnProvider = () => {
      counters.spawn += 1;
      throw new Error('spawn exploded');
    };
    const result = await invokeOfflineClaudeProvider(request(), runtime, { now: NOW });
    assert.equal(result.status, 'rejected', JSON.stringify(result));
    assert.equal(result.error?.code, 'spawn_error');
    assert.equal(result.process.spawn_count, 1);
    assert.equal(result.process.reaped, false);
    assert.deepEqual(counters, { resolve: 1, spawn: 1 });
  });

  await t.test('owned-tree platform rejection', async () => {
    const counters = { resolve: 0, spawn: 0 };
    const runtime = fixtureRuntime(counters);
    runtime.process.spawnProvider = () => {
      counters.spawn += 1;
      throw new ProviderProcessTreeOwnershipError('owned tree unavailable');
    };
    const result = await invokeOfflineClaudeProvider(request(), runtime, { now: NOW });
    assert.equal(result.status, 'rejected', JSON.stringify(result));
    assert.equal(result.error?.code, 'provider_process_tree_ownership_unavailable');
    assert.equal(result.process.spawn_count, 1);
    assert.equal(result.process.reaped, false);
    assert.deepEqual(counters, { resolve: 1, spawn: 1 });
  });
});

test('all terminal evidence omissions and malformed JSON fail closed through invocation', async (t) => {
  const cases = [
    ['fixture:terminal-malformed-json', 'terminal_malformed'],
    ['fixture:actual-model-missing', 'actual_model_missing'],
    ['fixture:actual-effort-missing', 'actual_effort_missing'],
    ['fixture:actual-identity-missing', 'actual_identity_missing'],
  ] as const;
  for (const [objective, errorCode] of cases) {
    await t.test(errorCode, async () => {
      const counters = { resolve: 0, spawn: 0 };
      const result = await invokeOfflineClaudeProvider(
        request({ objective }),
        fixtureRuntime(counters),
        { now: NOW },
      );
      assert.equal(result.status, 'failed', JSON.stringify(result));
      assert.equal(result.error?.code, errorCode, JSON.stringify(result));
      assert.equal(result.process.spawn_count, 1);
      assert.equal(result.process.reaped, true);
      assert.deepEqual(counters, { resolve: 1, spawn: 1 });
    });
  }
});

test('versioned terminal oracle is exact and traverses every failure branch', async (t) => {
  assert.deepEqual(
    NEGATIVE_ORACLE.terminal_failures.map(({ code }) => code),
    [...CLAUDE_PROVIDER_TERMINAL_FAILURE_CODES],
  );
  for (const { code, objective } of NEGATIVE_ORACLE.terminal_failures) {
    await t.test(code, async () => {
      const counters = { resolve: 0, spawn: 0 };
      const result = await invokeOfflineClaudeProvider(
        request({ objective }),
        fixtureRuntime(counters),
        { now: NOW },
      );
      assert.equal(result.status, 'failed', JSON.stringify(result));
      assert.equal(result.error?.code, code, JSON.stringify(result));
      assert.equal(result.process.spawn_count, 1);
      assert.equal(result.process.reaped, true);
      assert.deepEqual(counters, { resolve: 1, spawn: 1 });
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
