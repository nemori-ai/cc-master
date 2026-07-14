import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  type AuthorityResult,
  type CodexModelAdmissionSupervisorInput,
  type CodexModelAdmissionSupervisorResult,
  type CodexPreinvokeChallenge,
  type CodexRunAttachChallenge,
  type CompiledCodexInvocation,
  createAuthorityHarness,
  createCodexModelAdmissionSupervisor,
  evaluateCodexAdmissionV1,
} from '../src/codex-model-admission-a-now.js';

interface Fixture {
  domain: { now: string };
  base: Record<string, unknown>;
}

function fixture(): Fixture {
  return JSON.parse(
    readFileSync(
      fileURLToPath(new URL('./fixtures/codex-model-admission-a-now-v1/w1.json', import.meta.url)),
      'utf8',
    ),
  ) as Fixture;
}

function record(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function controlledCut(): Record<string, unknown> {
  const cut = structuredClone(fixture().base);
  Object.assign(record(cut.request), {
    launch_mode: 'fixture',
    provider_target: 'controlled-fixture',
  });
  record(cut.policy).launch_authorization = null;
  return cut;
}

function requestFor(cut: Record<string, unknown>): Record<string, unknown> {
  const identity = record(cut.identity);
  const request = record(cut.request);
  const workspace = record(cut.workspace);
  const policy = record(cut.policy);
  return {
    schema: 'ccm/codex-model-admission-request/v1',
    attempt_id: identity.attempt_id,
    run_ref: identity.run_ref,
    idempotency_key: identity.idempotency_key,
    provider: 'codex',
    operation: 'inspect',
    selector: {
      kind: 'exact',
      model_id: request.model_id,
      effort: request.effort,
    },
    workspace: {
      root_realpath: workspace.root_realpath,
      baseline_sha256: workspace.baseline_sha256,
      effect: 'read-only',
      approval: 'never',
      network: 'provider-only',
    },
    launch: {
      mode: request.launch_mode,
      provider_target: request.provider_target,
      authorization: policy.launch_authorization,
    },
  };
}

function unchangedRecheck(challenge: Readonly<CodexPreinvokeChallenge>): Record<string, unknown> {
  const value = record(challenge);
  return {
    schema: 'ccm/codex-model-admission-preinvoke-confirmation/v1',
    status: 'unchanged',
    binding: structuredClone(value.expected_binding),
  };
}

function expectedInvocation(cut: Record<string, unknown>): CompiledCodexInvocation {
  const identity = record(cut.identity);
  const request = record(cut.request);
  const binary = record(cut.binary);
  const auth = record(cut.auth);
  const quota = record(cut.quota_7d);
  const policy = record(cut.policy);
  const workspace = record(cut.workspace);
  const reservation = record(cut.reservation);
  return {
    schema: 'ccm/codex-provider-compiled-invocation/v1',
    provider_target: request.provider_target as 'controlled-fixture' | 'real-codex',
    executable: String(binary.path),
    argv: [
      '--ask-for-approval',
      'never',
      'exec',
      '--json',
      '--model',
      String(request.model_id),
      '-c',
      `model_reasoning_effort=${String(request.effort)}`,
      '--sandbox',
      'read-only',
      '--ephemeral',
      '-C',
      String(workspace.root_realpath),
      '-',
    ],
    cwd: String(workspace.root_realpath),
    env: {},
    permission: {
      effect: 'read-only',
      sandbox: 'read-only',
      approval: 'never',
      network: 'provider-only',
      account_mutation: 'forbidden',
      credential_write: 'forbidden',
      write_set: [],
    },
    binding: {
      attempt_id: identity.attempt_id,
      run_ref: identity.run_ref,
      idempotency_key: identity.idempotency_key,
      supervisor_instance_id: identity.supervisor_instance_id,
      collection_epoch: identity.collection_epoch,
      model_id: request.model_id,
      effort: request.effort,
      workspace_realpath: workspace.root_realpath,
      baseline_sha256: workspace.baseline_sha256,
      authorization: policy.launch_authorization,
      auth: {
        account_id: auth.account_id,
        credential_id: auth.credential_id,
        valid_until: auth.valid_until,
      },
      quota_7d: {
        account_id: quota.account_id,
        pool_id: quota.pool_id,
        valid_until: quota.valid_until,
      },
      reservation: {
        account_id: reservation.account_id,
        pool_id: reservation.pool_id,
        valid_until: reservation.valid_until,
      },
      policy: {
        cross_harness: policy.cross_harness,
        effect: policy.effect,
        approval: policy.approval,
        account_mutation: policy.account_mutation,
        credential_write: policy.credential_write,
      },
    },
  };
}

function startedHandle(): Record<string, unknown> {
  return {
    schema: 'ccm/provider-started-handle/v1',
    handle_ref: 'controlled-fixture://r2-started',
    provider_target: 'controlled-fixture',
  };
}

function attachedHandle(challenge: Readonly<CodexRunAttachChallenge>): Record<string, unknown> {
  return {
    schema: 'ccm/provider-attached-handle/v1',
    handle_ref: 'controlled-fixture://r3-attached',
    attempt_id: challenge.attempt_id,
    run_ref: challenge.run_ref,
    idempotency_key: challenge.idempotency_key,
    provider_target: challenge.provider_target,
    compiled_invocation: structuredClone(challenge.compiled_invocation),
  };
}

function authorityInputFor(cut: Record<string, unknown>): Record<string, unknown> {
  const identity = record(cut.identity);
  const request = record(cut.request);
  return {
    attempt_id: identity.attempt_id,
    run_ref: identity.run_ref,
    idempotency_key: identity.idempotency_key,
    supervisor_instance_id: identity.supervisor_instance_id,
    provider_target: request.provider_target,
    decision: {
      verdict: 'admit',
      origin: 'same-call-stack',
      supervisor_instance_id: identity.supervisor_instance_id,
      collection_epoch: identity.collection_epoch,
    },
    durable_control: {
      home_claim: 'absent',
      invoke_intent: 'absent',
      started_handle: 'absent',
    },
    compiled_invocation: expectedInvocation(cut),
  };
}

test('reconciliation cannot create done before spawn or from failed provider terminal', async () => {
  const cut = controlledCut();
  const supervisor = createCodexModelAdmissionSupervisor(
    {
      request: requestFor(cut),
      now: fixture().domain.now,
      timeoutsMs: { collect: 100, preinvoke: 100 },
    } as never,
    {
      collectEvaluationCut: async () => cut,
      preinvokeRecheck: async (challenge: Readonly<CodexPreinvokeChallenge>) =>
        unchangedRecheck(challenge),
      spawnControlledFixture: async () => startedHandle(),
      spawnRealCodex: async () => startedHandle(),
    },
  );
  const observation = {
    actual: {
      source: 'provider-event-channel',
      model_id: 'gpt-contract-fixture',
      effort: 'high',
    },
    providerTerminal: 'failed',
    parentVerified: true,
  };

  const beforeRun = await supervisor.reconcile(observation);
  assert.equal(beforeRun.task_done, false);
  assert.notEqual(beforeRun.attempt_outcome, 'terminal');

  await supervisor.run();
  const afterFailedTerminal = await supervisor.reconcile(observation);
  assert.deepEqual(afterFailedTerminal, {
    attempt_outcome: 'failed',
    reason: 'provider_terminal_failed',
    task_done: false,
    parent_verification_required: true,
  });
});

test('normalized request is sealed into exact compiled spawn argv and permissions', async () => {
  const cut = controlledCut();
  const request = requestFor(cut);
  let observedInvocation: unknown;
  const supervisor = createCodexModelAdmissionSupervisor(
    { request, now: fixture().domain.now, timeoutsMs: { collect: 100, preinvoke: 100 } },
    {
      collectEvaluationCut: async () => cut,
      preinvokeRecheck: async (challenge: Readonly<CodexPreinvokeChallenge>) =>
        unchangedRecheck(challenge),
      spawnControlledFixture: async (invocation: Readonly<CompiledCodexInvocation>) => {
        observedInvocation = invocation;
        return startedHandle();
      },
      spawnRealCodex: async () => startedHandle(),
    },
  );

  const result = await supervisor.run();

  assert.equal(result.launch.action, 'spawn');
  assert.deepEqual(observedInvocation, expectedInvocation(cut));
});

test('request and cut identity mismatch rejects before preinvoke or spawn', async () => {
  const cut = controlledCut();
  const request = requestFor(cut);
  record(request.selector).model_id = 'marketing-release-label';
  record(request.workspace).root_realpath = '/worktrees/other';
  let preinvokes = 0;
  let spawns = 0;
  const supervisor = createCodexModelAdmissionSupervisor(
    { request, now: fixture().domain.now, timeoutsMs: { collect: 100, preinvoke: 100 } } as never,
    {
      collectEvaluationCut: async () => cut,
      preinvokeRecheck: async (challenge) => {
        preinvokes += 1;
        return unchangedRecheck(challenge);
      },
      spawnControlledFixture: async () => {
        spawns += 1;
        return startedHandle();
      },
      spawnRealCodex: async () => startedHandle(),
    },
  );

  const result = await supervisor.run();

  assert.equal(result.decision.verdict, 'reject');
  assert.deepEqual(result.decision.reason_codes, ['request_cut_mismatch']);
  assert.equal(preinvokes, 0);
  assert.equal(spawns, 0);
});

test('missing runtime remains a truthful stable reject across repeated invocation', async () => {
  const cut = structuredClone(fixture().base);
  const harness = createAuthorityHarness(
    {
      attempt_id: 'attempt-1',
      run_ref: 'ccm-run:v1:run-1',
      idempotency_key: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      supervisor_instance_id: 'supervisor-1',
      provider_target: 'real-codex',
      decision: {
        verdict: 'admit',
        origin: 'same-call-stack',
        supervisor_instance_id: 'supervisor-1',
        collection_epoch: 'epoch-1',
      },
      durable_control: {
        home_claim: 'absent',
        invoke_intent: 'absent',
        started_handle: 'absent',
      },
      compiled_invocation: expectedInvocation(cut),
    },
    {},
  );

  const first = await harness.invoke();
  const second = await harness.invoke();

  assert.deepEqual(first, {
    action: 'reject',
    spawn_count_delta: 0,
    state: 'rejected',
    reason: 'provider_runtime_unavailable',
  });
  assert.deepEqual(second, first);
});

test('authority reason priority is owner-frozen and ignores caller reorder attempts', () => {
  const cut = controlledCut();
  record(cut.policy).cross_harness = 'deny';
  record(cut.resolution).resolved_model_id = 'different-model';
  const maliciousOrder = ['model_exact_mismatch', 'policy_denied'];

  const decision = (
    evaluateCodexAdmissionV1 as unknown as (
      cut: unknown,
      now: string,
      callerPriority: string[],
    ) => { reason_codes: string[] }
  )(cut, fixture().domain.now, maliciousOrder);

  assert.deepEqual(decision.reason_codes, ['policy_denied']);
});

test('collector, materialization and preinvoke faults normalize to zero-authority terminals', async () => {
  const cut = controlledCut();
  const request = requestFor(cut);
  const make = (overrides: Record<string, unknown>) =>
    createCodexModelAdmissionSupervisor(
      { request, now: fixture().domain.now, timeoutsMs: { collect: 20, preinvoke: 20 } } as never,
      {
        collectEvaluationCut: async () => cut,
        preinvokeRecheck: async (challenge: Readonly<CodexPreinvokeChallenge>) =>
          unchangedRecheck(challenge),
        spawnControlledFixture: async () => startedHandle(),
        spawnRealCodex: async () => startedHandle(),
        ...overrides,
      } as never,
    );

  const collectorThrow = await make({
    collectEvaluationCut: async () => {
      throw new Error('secret-bearing collector diagnostic must not escape');
    },
  }).run();
  assert.deepEqual(collectorThrow.launch, {
    action: 'reject',
    spawn_count_delta: 0,
    state: 'rejected',
    reason: 'collector_failed',
  });

  const cyclic = controlledCut();
  cyclic.self = cyclic;
  const cloneFault = await make({ collectEvaluationCut: async () => cyclic }).run();
  assert.equal(cloneFault.launch.reason, 'cut_materialization_failed');

  const recheckFault = await make({
    preinvokeRecheck: async () => {
      throw new Error('recheck failed');
    },
  }).run();
  assert.equal(recheckFault.launch.reason, 'preinvoke_failed');

  const malformed = await make({ preinvokeRecheck: async () => ({ status: 'unchanged' }) }).run();
  assert.equal(malformed.launch.reason, 'preinvoke_invalid');
});

test('changed preinvoke reasons are typed and sensitive diagnostics stay bounded and redacted', async () => {
  const sensitive = 'Bearer secret-token should never cross the boundary';
  const overlong = `workspace changed ${'x'.repeat(4_096)}`;
  for (const reason of [sensitive, overlong]) {
    const cut = controlledCut();
    let spawns = 0;
    const supervisor = createCodexModelAdmissionSupervisor(
      {
        request: requestFor(cut),
        now: fixture().domain.now,
        timeoutsMs: { collect: 100, preinvoke: 100 },
      },
      {
        collectEvaluationCut: async () => cut,
        preinvokeRecheck: async () => ({
          schema: 'ccm/codex-model-admission-preinvoke-confirmation/v1',
          status: 'changed',
          reason,
        }),
        spawnControlledFixture: async () => {
          spawns += 1;
          return startedHandle();
        },
        spawnRealCodex: async () => startedHandle(),
      },
    );

    const result = await supervisor.run();
    const serialized = JSON.stringify(result.launch);
    assert.equal(result.launch.reason, 'preinvoke_authority_changed');
    assert.deepEqual(result.launch.diagnostic_evidence, {
      schema: 'ccm/bounded-redacted-diagnostic/v1',
      code: 'preinvoke_authority_changed',
      category: 'unspecified',
      redacted: true,
    });
    assert.equal(serialized.includes(reason), false);
    assert.ok(serialized.length < 512);
    assert.equal(spawns, 0);
  }
});

test('collector timeout normalizes instead of leaving an unresolved run promise', {
  timeout: 250,
}, async () => {
  const cut = controlledCut();
  const request = requestFor(cut);
  const supervisor = createCodexModelAdmissionSupervisor(
    { request, now: fixture().domain.now, timeoutsMs: { collect: 20, preinvoke: 20 } } as never,
    {
      collectEvaluationCut: async () => await new Promise(() => {}),
      preinvokeRecheck: async (challenge) => unchangedRecheck(challenge),
      spawnControlledFixture: async () => startedHandle(),
      spawnRealCodex: async () => startedHandle(),
    },
  );

  const result = await supervisor.run();
  assert.equal(result.launch.reason, 'collector_timeout');
  assert.equal(result.launch.spawn_count_delta, 0);
});

test('preinvoke confirmation must preserve every load-bearing compiled binding', async () => {
  const mutations: Array<[string, (binding: Record<string, unknown>) => void]> = [
    [
      'model',
      (binding) => (record(record(binding.compiled_invocation).binding).model_id = 'other'),
    ],
    ['effort', (binding) => (record(record(binding.compiled_invocation).binding).effort = 'low')],
    ['workspace', (binding) => (record(binding.compiled_invocation).cwd = '/tmp/other')],
    [
      'baseline',
      (binding) =>
        (record(record(binding.compiled_invocation).binding).baseline_sha256 =
          `sha256:${'3'.repeat(64)}`),
    ],
    [
      'permission',
      (binding) => (record(record(binding.compiled_invocation).permission).effect = 'write'),
    ],
    [
      'write-set',
      (binding) =>
        ((record(record(binding.compiled_invocation).permission).write_set as unknown[]) = [
          '/tmp/escape',
        ]),
    ],
    [
      'auth',
      (binding) =>
        (record(record(record(binding.compiled_invocation).binding).auth).account_id = 'other'),
    ],
    [
      'quota',
      (binding) =>
        (record(record(record(binding.compiled_invocation).binding).quota_7d).pool_id = 'other'),
    ],
    [
      'policy',
      (binding) =>
        (record(record(record(binding.compiled_invocation).binding).policy).cross_harness = 'deny'),
    ],
  ];

  for (const [name, mutate] of mutations) {
    const cut = controlledCut();
    let spawns = 0;
    const supervisor = createCodexModelAdmissionSupervisor(
      {
        request: requestFor(cut),
        now: fixture().domain.now,
        timeoutsMs: { collect: 100, preinvoke: 100 },
      },
      {
        collectEvaluationCut: async () => cut,
        preinvokeRecheck: async (challenge) => {
          const binding = structuredClone(challenge.expected_binding) as Record<string, unknown>;
          mutate(binding);
          return {
            schema: 'ccm/codex-model-admission-preinvoke-confirmation/v1',
            status: 'unchanged',
            binding,
          };
        },
        spawnControlledFixture: async () => {
          spawns += 1;
          return startedHandle();
        },
        spawnRealCodex: async () => startedHandle(),
      },
    );

    const result = await supervisor.run();
    assert.equal(result.launch.reason, 'preinvoke_invalid', name);
    assert.equal(spawns, 0, name);
  }
});

test('malformed and mismatched requests never reach recheck or spawn', async () => {
  const cases: Array<[string, (request: Record<string, unknown>) => void, string]> = [
    ['selector-kind', (request) => (record(request.selector).kind = 'auto'), 'request_invalid'],
    ['attempt', (request) => (request.attempt_id = 'attempt-other'), 'request_cut_mismatch'],
    [
      'fixture-auth',
      (request) => (record(request.launch).authorization = { authority_ref: 'forged' }),
      'request_invalid',
    ],
    ['extra-field', (request) => (request.env = { TOKEN: 'smuggled' }), 'request_invalid'],
  ];
  for (const [name, mutate, expected] of cases) {
    const cut = controlledCut();
    const request = requestFor(cut);
    mutate(request);
    let preinvokes = 0;
    let spawns = 0;
    const supervisor = createCodexModelAdmissionSupervisor(
      { request, now: fixture().domain.now, timeoutsMs: { collect: 100, preinvoke: 100 } },
      {
        collectEvaluationCut: async () => cut,
        preinvokeRecheck: async (challenge) => {
          preinvokes += 1;
          return unchangedRecheck(challenge);
        },
        spawnControlledFixture: async () => {
          spawns += 1;
          return startedHandle();
        },
        spawnRealCodex: async () => startedHandle(),
      },
    );
    const result = await supervisor.run();
    assert.equal(result.launch.reason, expected, name);
    assert.equal(preinvokes, 0, name);
    assert.equal(spawns, 0, name);
  }
});

test('spawn faults and invalid handles become stable no-retry terminals', async () => {
  const cases: Array<[string, () => Promise<unknown>, { action: string; reason: string }]> = [
    [
      'typed-pre-spawn-reject',
      async () => {
        throw Object.assign(new Error('denied'), {
          code: 'provider_spawn_rejected_before_attempt',
        });
      },
      { action: 'reject', reason: 'provider_spawn_rejected_before_attempt' },
    ],
    [
      'ambiguous-throw',
      async () => {
        throw new Error('outcome unknown');
      },
      { action: 'uncertain', reason: 'invoke_outcome_ambiguous_no_auto_retry' },
    ],
    [
      'invalid-handle',
      async () => ({ handle_ref: 'missing-schema' }),
      { action: 'uncertain', reason: 'provider_started_handle_invalid' },
    ],
  ];
  for (const [name, spawn, expected] of cases) {
    const cut = controlledCut();
    let calls = 0;
    const harness = createAuthorityHarness(authorityInputFor(cut), {
      spawnControlledFixture: async () => {
        calls += 1;
        return spawn();
      },
    });
    const first = await harness.invoke();
    const second = await harness.invoke();
    assert.equal(first.action, expected.action, name);
    assert.equal(first.reason, expected.reason, name);
    assert.deepEqual(second, first, name);
    assert.equal(calls, 1, name);
  }
});

test('spawn and attach ports cannot synchronously reenter before the authority latch is published', {
  timeout: 1_000,
}, async (t) => {
  await t.test('spawn port', async () => {
    const cut = controlledCut();
    let calls = 0;
    let nested: Promise<AuthorityResult> | null = null;
    let harness!: ReturnType<typeof createAuthorityHarness>;
    harness = createAuthorityHarness(authorityInputFor(cut), {
      spawnControlledFixture: async () => {
        calls += 1;
        if (calls === 1) {
          nested = harness.invoke();
          await nested;
        }
        return startedHandle();
      },
    });

    const outerPromise = harness.invoke();
    const nestedPromise = nested as Promise<AuthorityResult> | null;
    assert.ok(nestedPromise, 'spawn port must synchronously reenter invoke()');
    const [outer, reentrant] = await Promise.all([outerPromise, nestedPromise]);
    const repeated = await harness.invoke();

    assert.equal(calls, 1);
    assert.deepEqual(reentrant, {
      action: 'reuse',
      spawn_count_delta: 0,
      state: 'invoking',
      reason: 'authority_effect_in_progress',
    });
    assert.deepEqual(outer, {
      action: 'spawn',
      spawn_count_delta: 1,
      state: 'invoking',
      reason: 'same_process_live_admit',
    });
    assert.deepEqual(repeated, {
      action: 'reuse',
      spawn_count_delta: 0,
      state: 'started',
      reason: 'launch_capability_already_used',
    });
    assert.equal(harness.hasVerifiedStartedHandle(), true);
  });

  await t.test('attach port', async () => {
    const cut = controlledCut();
    const input = authorityInputFor(cut);
    input.durable_control = {
      home_claim: 'same-key-same-request',
      invoke_intent: 'durable',
      started_handle: 'present',
    };
    let calls = 0;
    let nested: Promise<AuthorityResult> | null = null;
    let harness!: ReturnType<typeof createAuthorityHarness>;
    harness = createAuthorityHarness(input, {
      attachOriginalRun: async (challenge) => {
        calls += 1;
        if (calls === 1) {
          nested = harness.invoke();
          await nested;
        }
        return attachedHandle(challenge);
      },
    });

    const outerPromise = harness.invoke();
    const nestedPromise = nested as Promise<AuthorityResult> | null;
    assert.ok(nestedPromise, 'attach port must synchronously reenter invoke()');
    const [outer, reentrant] = await Promise.all([outerPromise, nestedPromise]);
    const repeated = await harness.invoke();

    assert.equal(calls, 1);
    assert.deepEqual(reentrant, {
      action: 'reuse',
      spawn_count_delta: 0,
      state: 'invoking',
      reason: 'authority_effect_in_progress',
    });
    assert.deepEqual(outer, {
      action: 'reuse',
      spawn_count_delta: 0,
      state: 'started',
      reason: 'original_run_adopted',
    });
    assert.deepEqual(repeated, outer);
    assert.equal(harness.hasVerifiedStartedHandle(), true);
  });

  await t.test('attach port getter', async () => {
    const cut = controlledCut();
    const input = authorityInputFor(cut);
    input.durable_control = {
      home_claim: 'same-key-same-request',
      invoke_intent: 'durable',
      started_handle: 'present',
    };
    let getterCalls = 0;
    let attachCalls = 0;
    let nested: Promise<AuthorityResult> | null = null;
    let harness!: ReturnType<typeof createAuthorityHarness>;
    const runtimePort: Parameters<typeof createAuthorityHarness>[1] = {};
    Object.defineProperty(runtimePort, 'attachOriginalRun', {
      enumerable: true,
      get() {
        getterCalls += 1;
        if (getterCalls === 1) nested = harness.invoke();
        return async (challenge: Readonly<CodexRunAttachChallenge>) => {
          attachCalls += 1;
          return attachedHandle(challenge);
        };
      },
    });
    harness = createAuthorityHarness(input, runtimePort);

    const outerPromise = harness.invoke();
    const nestedPromise = nested as Promise<AuthorityResult> | null;
    assert.ok(nestedPromise, 'attach port getter must synchronously reenter invoke()');
    const [outer, reentrant] = await Promise.all([outerPromise, nestedPromise]);
    const repeated = await harness.invoke();

    assert.equal(getterCalls, 1);
    assert.equal(attachCalls, 1);
    assert.deepEqual(reentrant, {
      action: 'reuse',
      spawn_count_delta: 0,
      state: 'invoking',
      reason: 'authority_effect_in_progress',
    });
    assert.deepEqual(outer, {
      action: 'reuse',
      spawn_count_delta: 0,
      state: 'started',
      reason: 'original_run_adopted',
    });
    assert.deepEqual(repeated, outer);
    assert.equal(harness.hasVerifiedStartedHandle(), true);
  });

  await t.test('attach port getter fault', async () => {
    const cut = controlledCut();
    const input = authorityInputFor(cut);
    input.durable_control = {
      home_claim: 'same-key-same-request',
      invoke_intent: 'durable',
      started_handle: 'present',
    };
    let getterCalls = 0;
    let spawns = 0;
    const runtimePort: Parameters<typeof createAuthorityHarness>[1] = {
      spawnControlledFixture: async () => {
        spawns += 1;
        return startedHandle();
      },
    };
    Object.defineProperty(runtimePort, 'attachOriginalRun', {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error('attach port getter failed');
      },
    });
    const harness = createAuthorityHarness(input, runtimePort);

    const first = await harness.invoke();
    const repeated = await harness.invoke();

    assert.equal(getterCalls, 1);
    assert.equal(spawns, 0);
    assert.deepEqual(first, {
      action: 'reject',
      spawn_count_delta: 0,
      state: 'rejected',
      reason: 'authority_internal_invariant',
    });
    assert.deepEqual(repeated, first);
    assert.equal(harness.hasVerifiedStartedHandle(), false);
  });
});

test('caller-shaped durable sentinel cannot authorize reuse or reconciliation', async () => {
  const cut = controlledCut();
  let spawns = 0;
  const supervisor = createCodexModelAdmissionSupervisor(
    {
      request: requestFor(cut),
      now: fixture().domain.now,
      timeoutsMs: { collect: 100, preinvoke: 100 },
      durableControl: {
        home_claim: 'same-key-same-request',
        invoke_intent: 'durable',
        started_handle: 'present',
      },
    },
    {
      collectEvaluationCut: async () => cut,
      preinvokeRecheck: unchangedRecheck,
      spawnControlledFixture: async () => {
        spawns += 1;
        return startedHandle();
      },
      spawnRealCodex: async () => startedHandle(),
    },
  );

  const result = await supervisor.run();
  const reconciliation = await supervisor.reconcile({
    actual: {
      source: 'provider-event-channel',
      model_id: 'gpt-contract-fixture',
      effort: 'high',
    },
    providerTerminal: 'succeeded',
    parentVerified: true,
  });
  assert.deepEqual(result.launch, {
    action: 'uncertain',
    spawn_count_delta: 0,
    state: 'uncertain',
    reason: 'original_run_attach_required',
  });
  assert.equal(spawns, 0);
  assert.equal(reconciliation.reason, 'provider_not_started');
  assert.equal(reconciliation.task_done, false);
});

test('provided noncanonical durable control is typed fail-closed before spawn or reconciliation', async (t) => {
  const cases: Array<[string, unknown]> = [
    [
      'review-started-handle-expired',
      {
        home_claim: 'same-key-same-request',
        invoke_intent: 'durable',
        started_handle: 'expired',
      },
    ],
    [
      'review-missing-started-handle',
      { home_claim: 'same-key-same-request', invoke_intent: 'durable' },
    ],
    [
      'review-unknown-home-claim',
      { home_claim: 'unknown', invoke_intent: 'absent', started_handle: 'absent' },
    ],
    ['review-empty-record', {}],
    ['provided-undefined', undefined],
    ['provided-null', null],
    ['provided-primitive', 'absent'],
    ['provided-array', ['absent', 'absent', 'absent']],
    [
      'fresh-record-extra-key',
      {
        home_claim: 'absent',
        invoke_intent: 'absent',
        started_handle: 'absent',
        caller_claim: true,
      },
    ],
    ['wrong-field-type', { home_claim: 'absent', invoke_intent: 'absent', started_handle: false }],
    [
      'unknown-invoke-intent',
      { home_claim: 'absent', invoke_intent: 'unknown', started_handle: 'absent' },
    ],
    [
      'partial-absent-present-cross',
      { home_claim: 'absent', invoke_intent: 'durable', started_handle: 'present' },
    ],
    [
      'partial-durable-unknown-without-home-claim',
      { invoke_intent: 'durable', started_handle: 'unknown' },
    ],
    [
      'conflicting-durable-started-record',
      {
        home_claim: 'same-key-different-request',
        invoke_intent: 'durable',
        started_handle: 'present',
      },
    ],
  ];

  for (const [name, durableControl] of cases) {
    await t.test(name, async () => {
      const cut = controlledCut();
      let attaches = 0;
      let spawns = 0;
      const supervisor = createCodexModelAdmissionSupervisor(
        {
          request: requestFor(cut),
          now: fixture().domain.now,
          timeoutsMs: { collect: 100, preinvoke: 100 },
          durableControl,
        },
        {
          collectEvaluationCut: async () => cut,
          preinvokeRecheck: unchangedRecheck,
          attachOriginalRun: async () => {
            attaches += 1;
            throw new Error('invalid durable control must not attach');
          },
          spawnControlledFixture: async () => {
            spawns += 1;
            return startedHandle();
          },
          spawnRealCodex: async () => startedHandle(),
        },
      );

      const result = await supervisor.run();
      const reconciliation = await supervisor.reconcile({
        actual: {
          source: 'provider-event-channel',
          model_id: 'gpt-contract-fixture',
          effort: 'high',
        },
        providerTerminal: 'succeeded',
        parentVerified: true,
      });

      assert.deepEqual(
        { launch: result.launch, attaches, spawns, reconciliation },
        {
          launch: {
            action: 'reject',
            spawn_count_delta: 0,
            state: 'rejected',
            reason: 'durable_control_invalid',
          },
          attaches: 0,
          spawns: 0,
          reconciliation: {
            attempt_outcome: 'uncertain',
            reason: 'provider_not_started',
            task_done: false,
            parent_verification_required: true,
          },
        },
        name,
      );
    });
  }
});

test('run binds supplied-invalid durable control before collect and preinvoke callbacks can mutate aliases', async (t) => {
  const fresh = () => ({
    home_claim: 'absent',
    invoke_intent: 'absent',
    started_handle: 'absent',
  });
  const cases: Array<[string, unknown, (input: CodexModelAdmissionSupervisorInput) => void]> = [
    ['supplied-undefined-delete-property', undefined, (input) => delete input.durableControl],
    [
      'unknown-nested-object-to-fresh',
      { home_claim: 'unknown', invoke_intent: 'absent', started_handle: 'absent' },
      (input) => Object.assign(record(input.durableControl), fresh()),
    ],
    [
      'partial-replace-property',
      { home_claim: 'same-key-same-request', invoke_intent: 'durable' },
      (input) => {
        input.durableControl = fresh();
      },
    ],
    [
      'conflicting-nested-object-to-fresh',
      {
        home_claim: 'same-key-different-request',
        invoke_intent: 'durable',
        started_handle: 'present',
      },
      (input) => Object.assign(record(input.durableControl), fresh()),
    ],
  ];

  for (const phase of ['collect', 'preinvoke'] as const) {
    for (const [name, durableControl, mutate] of cases) {
      await t.test(`${phase}-${name}`, async () => {
        const cut = controlledCut();
        const initialDurableControl = structuredClone(durableControl);
        const input: CodexModelAdmissionSupervisorInput = {
          request: requestFor(cut),
          now: fixture().domain.now,
          timeoutsMs: { collect: 100, preinvoke: 100 },
          durableControl: initialDurableControl,
        };
        let mutationCalls = 0;
        let attaches = 0;
        let spawns = 0;
        const mutateOnce = () => {
          mutationCalls += 1;
          mutate(input);
        };
        const supervisor = createCodexModelAdmissionSupervisor(input, {
          collectEvaluationCut: async () => {
            if (phase === 'collect') mutateOnce();
            return cut;
          },
          preinvokeRecheck: async (challenge) => {
            if (phase === 'preinvoke') mutateOnce();
            return unchangedRecheck(challenge);
          },
          attachOriginalRun: async () => {
            attaches += 1;
            throw new Error('bound supplied-invalid state must not attach');
          },
          spawnControlledFixture: async () => {
            spawns += 1;
            return startedHandle();
          },
          spawnRealCodex: async () => startedHandle(),
        });

        const result = await supervisor.run();
        const reconciliation = await supervisor.reconcile({
          actual: {
            source: 'provider-event-channel',
            model_id: 'gpt-contract-fixture',
            effort: 'high',
          },
          providerTerminal: 'succeeded',
          parentVerified: true,
        });

        assert.deepEqual(
          { launch: result.launch, mutationCalls, attaches, spawns, reconciliation },
          {
            launch: {
              action: 'reject',
              spawn_count_delta: 0,
              state: 'rejected',
              reason: 'durable_control_invalid',
            },
            mutationCalls: 1,
            attaches: 0,
            spawns: 0,
            reconciliation: {
              attempt_outcome: 'uncertain',
              reason: 'provider_not_started',
              task_done: false,
              parent_verification_required: true,
            },
          },
          `${phase}-${name}`,
        );
      });
    }
  }
});

test('durable-control binding failures are stable typed invalid results', async (t) => {
  const cases: Array<[string, () => CodexModelAdmissionSupervisorInput]> = [
    [
      'property-read-throws',
      () => {
        const cut = controlledCut();
        const input = {
          request: requestFor(cut),
          now: fixture().domain.now,
          timeoutsMs: { collect: 100, preinvoke: 100 },
        } as CodexModelAdmissionSupervisorInput;
        Object.defineProperty(input, 'durableControl', {
          enumerable: true,
          get() {
            throw new Error('durable control getter failed');
          },
        });
        return input;
      },
    ],
    [
      'nested-materialization-throws',
      () => {
        const cut = controlledCut();
        return {
          request: requestFor(cut),
          now: fixture().domain.now,
          timeoutsMs: { collect: 100, preinvoke: 100 },
          durableControl: new Proxy(
            {},
            {
              ownKeys() {
                throw new Error('durable control ownKeys failed');
              },
            },
          ),
        };
      },
    ],
  ];

  for (const [name, makeInput] of cases) {
    await t.test(name, async () => {
      const cut = controlledCut();
      let attaches = 0;
      let spawns = 0;
      const supervisor = createCodexModelAdmissionSupervisor(makeInput(), {
        collectEvaluationCut: async () => cut,
        preinvokeRecheck: unchangedRecheck,
        attachOriginalRun: async () => {
          attaches += 1;
          throw new Error('binding failure must not attach');
        },
        spawnControlledFixture: async () => {
          spawns += 1;
          return startedHandle();
        },
        spawnRealCodex: async () => startedHandle(),
      });

      const result = await supervisor.run();
      const reconciliation = await supervisor.reconcile({
        actual: {
          source: 'provider-event-channel',
          model_id: 'gpt-contract-fixture',
          effort: 'high',
        },
        providerTerminal: 'succeeded',
        parentVerified: true,
      });

      assert.equal(result.launch.reason, 'durable_control_invalid');
      assert.equal(result.launch.spawn_count_delta, 0);
      assert.equal(attaches, 0);
      assert.equal(spawns, 0);
      assert.equal(reconciliation.reason, 'provider_not_started');
      assert.equal(reconciliation.task_done, false);
    });
  }
});

test('durable-control binding latch rejects synchronous run reentry without a second read or authority', async (t) => {
  for (const bindingOutcome of ['supplied-invalid', 'getter-fault'] as const) {
    await t.test(bindingOutcome, async () => {
      const cut = controlledCut();
      const request = requestFor(cut);
      const input = {
        now: fixture().domain.now,
        timeoutsMs: { collect: 100, preinvoke: 100 },
      } as CodexModelAdmissionSupervisorInput;
      let bindingActive = false;
      let getterCalls = 0;
      let requestReadsDuringBinding = 0;
      let collections = 0;
      let preinvokes = 0;
      let attaches = 0;
      let spawns = 0;
      let nestedRun: Promise<CodexModelAdmissionSupervisorResult> | null = null;
      let supervisor!: ReturnType<typeof createCodexModelAdmissionSupervisor>;

      Object.defineProperty(input, 'request', {
        enumerable: true,
        get() {
          if (bindingActive) requestReadsDuringBinding += 1;
          return request;
        },
      });
      Object.defineProperty(input, 'durableControl', {
        enumerable: true,
        get() {
          getterCalls += 1;
          if (getterCalls === 1) {
            bindingActive = true;
            try {
              nestedRun = supervisor.run();
            } finally {
              bindingActive = false;
            }
            if (bindingOutcome === 'getter-fault') {
              throw new Error('durable control getter failed after reentry');
            }
            return undefined;
          }
          return {
            home_claim: 'absent',
            invoke_intent: 'absent',
            started_handle: 'absent',
          };
        },
      });

      supervisor = createCodexModelAdmissionSupervisor(input, {
        collectEvaluationCut: async () => {
          collections += 1;
          return cut;
        },
        preinvokeRecheck: async (challenge) => {
          preinvokes += 1;
          return unchangedRecheck(challenge);
        },
        attachOriginalRun: async () => {
          attaches += 1;
          throw new Error('binding reentry must not attach');
        },
        spawnControlledFixture: async () => {
          spawns += 1;
          return startedHandle();
        },
        spawnRealCodex: async () => {
          throw new Error('binding reentry test must not reach the real provider port');
        },
      });

      const outerRun = supervisor.run();
      const nestedPromise = nestedRun as Promise<CodexModelAdmissionSupervisorResult> | null;
      assert.ok(nestedPromise, 'the first property read must synchronously reenter run()');
      const [outer, nested] = await Promise.all([outerRun, nestedPromise]);
      const reconciliation = await supervisor.reconcile({
        actual: {
          source: 'provider-event-channel',
          model_id: 'gpt-contract-fixture',
          effort: 'high',
        },
        providerTerminal: 'succeeded',
        parentVerified: true,
      });

      assert.deepEqual(
        {
          getterCalls,
          requestReadsDuringBinding,
          collections,
          preinvokes,
          attaches,
          spawns,
          outer: outer.launch,
          nested: nested.launch,
          reconciliation,
        },
        {
          getterCalls: 1,
          requestReadsDuringBinding: 0,
          collections: 1,
          preinvokes: 1,
          attaches: 0,
          spawns: 0,
          outer: {
            action: 'reject',
            spawn_count_delta: 0,
            state: 'rejected',
            reason: 'durable_control_invalid',
          },
          nested: {
            action: 'reject',
            spawn_count_delta: 0,
            state: 'rejected',
            reason: 'durable_control_invalid',
          },
          reconciliation: {
            attempt_outcome: 'uncertain',
            reason: 'provider_not_started',
            task_done: false,
            parent_verification_required: true,
          },
        },
      );
    });
  }
});

test('a successfully bound durable-control accessor is reused by repeated concurrent runs', async () => {
  const cut = controlledCut();
  const input = {
    request: requestFor(cut),
    now: fixture().domain.now,
    timeoutsMs: { collect: 100, preinvoke: 100 },
  } as CodexModelAdmissionSupervisorInput;
  let getterCalls = 0;
  let collections = 0;
  let spawns = 0;
  Object.defineProperty(input, 'durableControl', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return {
        home_claim: 'absent',
        invoke_intent: 'absent',
        started_handle: 'absent',
      };
    },
  });

  const supervisor = createCodexModelAdmissionSupervisor(input, {
    collectEvaluationCut: async () => {
      collections += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return cut;
    },
    preinvokeRecheck: unchangedRecheck,
    spawnControlledFixture: async () => {
      spawns += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return startedHandle();
    },
    spawnRealCodex: async () => {
      throw new Error('bound accessor test must not reach the real provider port');
    },
  });

  const [first, second] = await Promise.all([supervisor.run(), supervisor.run()]);
  const third = await supervisor.run();

  assert.equal(getterCalls, 1);
  assert.equal(collections, 1);
  assert.equal(spawns, 1);
  assert.equal(first.launch.action, 'spawn');
  assert.equal(second.launch.action, 'reuse');
  assert.equal(third.launch.action, 'reuse');
  assert.equal(third.launch.reason, 'launch_capability_already_used');
});

test('durable attach requires an exact private handle before reuse and reconciliation', async () => {
  const mutations: Array<
    [
      string,
      ((handle: Record<string, unknown>) => void) | null,
      'original_run_adopted' | 'original_run_attach_unverified',
    ]
  > = [
    ['exact', null, 'original_run_adopted'],
    [
      'attempt',
      (handle) => (handle.attempt_id = 'attempt-forged'),
      'original_run_attach_unverified',
    ],
    ['run', (handle) => (handle.run_ref = 'run://forged'), 'original_run_attach_unverified'],
    ['key', (handle) => (handle.idempotency_key = 'key-forged'), 'original_run_attach_unverified'],
    [
      'target',
      (handle) => (handle.provider_target = 'real-codex'),
      'original_run_attach_unverified',
    ],
    [
      'invocation',
      (handle) => {
        record(record(handle.compiled_invocation).binding).model_id = 'model-forged';
      },
      'original_run_attach_unverified',
    ],
    ['extra-field', (handle) => (handle.caller_claim = true), 'original_run_attach_unverified'],
  ];

  for (const [name, mutate, expectedReason] of mutations) {
    const cut = controlledCut();
    let attaches = 0;
    let spawns = 0;
    const supervisor = createCodexModelAdmissionSupervisor(
      {
        request: requestFor(cut),
        now: fixture().domain.now,
        timeoutsMs: { collect: 100, preinvoke: 100 },
        durableControl: {
          home_claim: 'same-key-same-request',
          invoke_intent: 'durable',
          started_handle: 'present',
        },
      },
      {
        collectEvaluationCut: async () => cut,
        preinvokeRecheck: unchangedRecheck,
        attachOriginalRun: async (challenge) => {
          attaches += 1;
          const identity = record(cut.identity);
          assert.deepEqual(
            challenge,
            {
              schema: 'ccm/provider-run-attach-challenge/v1',
              attempt_id: identity.attempt_id,
              run_ref: identity.run_ref,
              idempotency_key: identity.idempotency_key,
              provider_target: 'controlled-fixture',
              compiled_invocation: expectedInvocation(cut),
            },
            name,
          );
          const handle = attachedHandle(challenge);
          mutate?.(handle);
          return handle;
        },
        spawnControlledFixture: async () => {
          spawns += 1;
          return startedHandle();
        },
        spawnRealCodex: async () => startedHandle(),
      },
    );

    const result = await supervisor.run();
    const reconciliation = await supervisor.reconcile({
      actual: {
        source: 'provider-event-channel',
        model_id: 'gpt-contract-fixture',
        effort: 'high',
      },
      providerTerminal: 'succeeded',
      parentVerified: true,
    });
    assert.equal(attaches, 1, name);
    assert.equal(spawns, 0, name);
    assert.equal(result.launch.reason, expectedReason, name);
    assert.equal(result.launch.action, mutate ? 'uncertain' : 'reuse', name);
    assert.equal(reconciliation.task_done, !mutate, name);
    assert.equal(
      reconciliation.reason,
      mutate ? 'provider_not_started' : 'actual_identity_exact',
      name,
    );
  }
});

test('reconciliation is gated by verified start and terminal event consistency', async () => {
  const cut = controlledCut();
  const supervisor = createCodexModelAdmissionSupervisor(
    {
      request: requestFor(cut),
      now: fixture().domain.now,
      timeoutsMs: { collect: 100, preinvoke: 100 },
    },
    {
      collectEvaluationCut: async () => cut,
      preinvokeRecheck: unchangedRecheck,
      spawnControlledFixture: async () => startedHandle(),
      spawnRealCodex: async () => startedHandle(),
    },
  );
  const actual = {
    source: 'provider-event-channel',
    model_id: 'gpt-contract-fixture',
    effort: 'high',
  };
  assert.equal(
    (await supervisor.reconcile({ actual, providerTerminal: 'succeeded', parentVerified: true }))
      .reason,
    'provider_not_started',
  );
  await supervisor.run();
  const first = await supervisor.reconcile({
    actual,
    providerTerminal: 'succeeded',
    parentVerified: false,
  });
  const accepted = await supervisor.reconcile({
    actual,
    providerTerminal: 'succeeded',
    parentVerified: true,
  });
  const conflict = await supervisor.reconcile({
    actual,
    providerTerminal: 'failed',
    parentVerified: true,
  });
  assert.equal(first.task_done, false);
  assert.equal(accepted.task_done, true);
  assert.equal(conflict.reason, 'provider_terminal_conflict');
  assert.equal(conflict.task_done, false);
});

test('preinvoke timeout settles with zero authority and never spawns', {
  timeout: 250,
}, async () => {
  const cut = controlledCut();
  let spawns = 0;
  const supervisor = createCodexModelAdmissionSupervisor(
    {
      request: requestFor(cut),
      now: fixture().domain.now,
      timeoutsMs: { collect: 20, preinvoke: 20 },
    },
    {
      collectEvaluationCut: async () => cut,
      preinvokeRecheck: async () => await new Promise(() => {}),
      spawnControlledFixture: async () => {
        spawns += 1;
        return startedHandle();
      },
      spawnRealCodex: async () => startedHandle(),
    },
  );
  const result = await supervisor.run();
  assert.equal(result.launch.reason, 'preinvoke_timeout');
  assert.equal(result.launch.spawn_count_delta, 0);
  assert.equal(spawns, 0);
});
