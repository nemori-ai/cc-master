import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
// Import through the package entry: this is the production reachability proof, not a source-only
// unit seam.
import { type CodexPreinvokeChallenge, createCodexModelAdmissionSupervisor } from '../src/index.js';

interface Fixture {
  domain: { now: string };
  base: Record<string, unknown>;
}

function fixture(): Fixture {
  const path = fileURLToPath(
    new URL('./fixtures/codex-model-admission-a-now-v1/w1.json', import.meta.url),
  );
  return JSON.parse(readFileSync(path, 'utf8')) as Fixture;
}

function object(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function controlledFixtureCut(value: Fixture): Record<string, unknown> {
  const cut = structuredClone(value.base);
  const request = object(cut.request);
  const policy = object(cut.policy);
  request.launch_mode = 'fixture';
  request.provider_target = 'controlled-fixture';
  policy.launch_authorization = null;
  return cut;
}

function requestFor(cut: Record<string, unknown>): Record<string, unknown> {
  const identity = object(cut.identity);
  const request = object(cut.request);
  const workspace = object(cut.workspace);
  const policy = object(cut.policy);
  return {
    schema: 'ccm/codex-model-admission-request/v1',
    attempt_id: identity.attempt_id,
    run_ref: identity.run_ref,
    idempotency_key: identity.idempotency_key,
    provider: 'codex',
    operation: 'inspect',
    selector: { kind: 'exact', model_id: request.model_id, effort: request.effort },
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

function unchanged(challenge: Readonly<CodexPreinvokeChallenge>): Record<string, unknown> {
  return {
    schema: 'ccm/codex-model-admission-preinvoke-confirmation/v1',
    status: 'unchanged',
    binding: structuredClone(challenge.expected_binding),
  };
}

function started(target: 'controlled-fixture' | 'real-codex' = 'controlled-fixture') {
  return {
    schema: 'ccm/provider-started-handle/v1',
    handle_ref: `${target}://supervisor-test`,
    provider_target: target,
  };
}

function inputFor(cut: Record<string, unknown>, now: string, ...durableControl: [] | [unknown]) {
  return {
    request: requestFor(cut),
    now,
    timeoutsMs: { collect: 100, preinvoke: 100 },
    ...(durableControl.length === 1 ? { durableControl: durableControl[0] } : {}),
  };
}

test('production supervisor keeps live collection, W1 and one-shot launch in one call stack', async () => {
  const value = fixture();
  const cut = controlledFixtureCut(value);
  let collections = 0;
  let controlledSpawns = 0;
  let realProviderRequests = 0;

  const supervisor = createCodexModelAdmissionSupervisor(inputFor(cut, value.domain.now), {
    collectEvaluationCut: async () => {
      collections += 1;
      return cut;
    },
    preinvokeRecheck: unchanged,
    spawnControlledFixture: async () => {
      controlledSpawns += 1;
      return started();
    },
    spawnRealCodex: async () => {
      realProviderRequests += 1;
      return started('real-codex');
    },
  });

  const first = await supervisor.run();
  const second = await supervisor.run();
  const reconciliation = await supervisor.reconcile({
    actual: {
      source: 'provider-event-channel',
      model_id: 'gpt-contract-fixture',
      effort: 'high',
    },
    providerTerminal: 'succeeded',
    parentVerified: false,
  });

  assert.equal(collections, 1);
  assert.equal(controlledSpawns, 1);
  assert.equal(realProviderRequests, 0);
  assert.equal(first.decision.verdict, 'admit');
  assert.deepEqual(first.launch, {
    action: 'spawn',
    spawn_count_delta: 1,
    state: 'invoking',
    reason: 'same_process_live_admit',
  });
  assert.deepEqual(second.launch, {
    action: 'reuse',
    spawn_count_delta: 0,
    state: 'started',
    reason: 'launch_capability_already_used',
  });
  assert.deepEqual(reconciliation, {
    attempt_outcome: 'terminal',
    reason: 'actual_identity_exact',
    task_done: false,
    parent_verification_required: true,
  });
});

test('production supervisor preserves explicitly supplied canonical all-absent fresh authority', async () => {
  const value = fixture();
  const cut = controlledFixtureCut(value);
  let spawns = 0;
  const supervisor = createCodexModelAdmissionSupervisor(
    inputFor(cut, value.domain.now, {
      home_claim: 'absent',
      invoke_intent: 'absent',
      started_handle: 'absent',
    }),
    {
      collectEvaluationCut: async () => cut,
      preinvokeRecheck: unchanged,
      spawnControlledFixture: async () => {
        spawns += 1;
        return started();
      },
      spawnRealCodex: async () => started('real-codex'),
    },
  );

  const result = await supervisor.run();
  assert.equal(spawns, 1);
  assert.deepEqual(result.launch, {
    action: 'spawn',
    spawn_count_delta: 1,
    state: 'invoking',
    reason: 'same_process_live_admit',
  });
});

test('production supervisor treats persistent evidence as audit-only and never launches', async () => {
  const value = fixture();
  const cut = controlledFixtureCut(value);
  object(cut.auth).source = 'cache';
  object(cut.provenance).persistent_evidence_used = true;
  let spawns = 0;
  const supervisor = createCodexModelAdmissionSupervisor(inputFor(cut, value.domain.now), {
    collectEvaluationCut: async () => cut,
    preinvokeRecheck: unchanged,
    spawnControlledFixture: async () => {
      spawns += 1;
      return started();
    },
    spawnRealCodex: async () => {
      spawns += 1;
      return started('real-codex');
    },
  });

  const result = await supervisor.run();
  assert.equal(spawns, 0);
  assert.deepEqual(result.decision.reason_codes, ['persistent_only_evidence']);
  assert.equal(result.launch.reason, 'persistent_only_evidence');
});

test('strict automatic real-Codex mode is denied before any runtime request', async () => {
  const value = fixture();
  const cut = structuredClone(value.base);
  object(cut.request).launch_mode = 'automatic';
  object(cut.request).provider_target = 'real-codex';
  object(cut.policy).launch_authorization = null;
  let realProviderRequests = 0;
  const supervisor = createCodexModelAdmissionSupervisor(inputFor(cut, value.domain.now), {
    collectEvaluationCut: async () => cut,
    preinvokeRecheck: unchanged,
    spawnControlledFixture: async () => started(),
    spawnRealCodex: async () => {
      realProviderRequests += 1;
      return started('real-codex');
    },
  });

  const result = await supervisor.run();
  assert.equal(realProviderRequests, 0);
  assert.deepEqual(result.decision.reason_codes, ['automatic_live_spawn_disabled_strict']);
});

test('concurrent supervisor calls share collection and one private launch capability', async () => {
  const value = fixture();
  const cut = controlledFixtureCut(value);
  let collections = 0;
  let spawns = 0;
  const supervisor = createCodexModelAdmissionSupervisor(inputFor(cut, value.domain.now), {
    collectEvaluationCut: async () => {
      collections += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return cut;
    },
    preinvokeRecheck: unchanged,
    spawnControlledFixture: async () => {
      spawns += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return started();
    },
    spawnRealCodex: async () => started('real-codex'),
  });

  const [first, second] = await Promise.all([supervisor.run(), supervisor.run()]);
  assert.equal(collections, 1);
  assert.equal(spawns, 1);
  assert.equal(first.launch.action, 'spawn');
  assert.equal(second.launch.action, 'reuse');
});

test('changed preinvoke authority rejects without creating a phantom attempt', async () => {
  const value = fixture();
  const cut = controlledFixtureCut(value);
  let spawns = 0;
  const supervisor = createCodexModelAdmissionSupervisor(inputFor(cut, value.domain.now), {
    collectEvaluationCut: async () => cut,
    preinvokeRecheck: async () => ({
      schema: 'ccm/codex-model-admission-preinvoke-confirmation/v1',
      status: 'changed',
      reason: 'workspace_baseline_changed',
    }),
    spawnControlledFixture: async () => {
      spawns += 1;
      return started();
    },
    spawnRealCodex: async () => started('real-codex'),
  });

  const result = await supervisor.run();
  assert.equal(spawns, 0);
  assert.equal(result.launch.reason, 'preinvoke_authority_changed');
  assert.deepEqual(result.launch.diagnostic_evidence, {
    schema: 'ccm/bounded-redacted-diagnostic/v1',
    code: 'preinvoke_authority_changed',
    category: 'workspace-baseline',
    redacted: true,
  });
});

test('unsupported-model discovery failure is fail-closed with no phantom attempt', async () => {
  const value = fixture();
  const cut = controlledFixtureCut(value);
  Object.assign(object(cut.discovery), {
    completeness: 'unknown',
    freshness: 'unknown',
    model_id: null,
    provider_status: 400,
  });
  let spawns = 0;
  const supervisor = createCodexModelAdmissionSupervisor(inputFor(cut, value.domain.now), {
    collectEvaluationCut: async () => cut,
    preinvokeRecheck: unchanged,
    spawnControlledFixture: async () => {
      spawns += 1;
      return started();
    },
    spawnRealCodex: async () => started('real-codex'),
  });

  const result = await supervisor.run();
  assert.equal(spawns, 0);
  assert.deepEqual(result.decision.reason_codes, ['catalog_stale']);
});

test('durable duplicate without a verified private attach handle remains uncertain', async () => {
  const value = fixture();
  const cut = controlledFixtureCut(value);
  let spawns = 0;
  const supervisor = createCodexModelAdmissionSupervisor(
    inputFor(cut, value.domain.now, {
      home_claim: 'same-key-same-request',
      invoke_intent: 'durable',
      started_handle: 'present',
    }),
    {
      collectEvaluationCut: async () => cut,
      preinvokeRecheck: unchanged,
      spawnControlledFixture: async () => {
        spawns += 1;
        return started();
      },
      spawnRealCodex: async () => started('real-codex'),
    },
  );

  const result = await supervisor.run();
  assert.equal(spawns, 0);
  assert.deepEqual(result.launch, {
    action: 'uncertain',
    spawn_count_delta: 0,
    state: 'uncertain',
    reason: 'original_run_attach_required',
  });
});
