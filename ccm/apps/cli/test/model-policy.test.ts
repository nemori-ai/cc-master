import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run } from '../src/router.js';

const AS_OF = '2026-07-16T12:00:00Z';

function invoke(args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(args, {
    out: (value) => out.push(value),
    err: (value) => err.push(value),
    env: { HOME: '/tmp', PATH: '/usr/bin:/bin', CC_MASTER_NO_AUTOINSTALL: '1' },
  });
  return { code, err, value: JSON.parse(out.at(-1) || '{}') };
}

function candidate(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const [surface, model] = id.split(':');
  const provider =
    surface === 'claude-code-cli' ? 'claude-code' : surface === 'codex-cli' ? 'codex' : 'cursor';
  return {
    id,
    provider,
    surface,
    model,
    qualification: {
      schema: 'ccm/model-policy-live-qualification/v1',
      candidate_id: id,
      provider,
      surface,
      model,
      status: 'qualified',
      certified_role_grades: ['O'],
      evidence_refs: ['qualification://live/test'],
      revision: 'qualification-r1',
      observed_at: '2026-07-16T00:00:00Z',
      valid_until: '2026-07-17T00:00:00Z',
    },
    admission: {
      schema: 'ccm/model-policy-live-admission/v1',
      candidate_id: id,
      provider,
      surface,
      model,
      status: 'admitted',
      evidence_refs: ['admission://live/test'],
      revision: 'admission-r1',
      observed_at: '2026-07-16T00:00:00Z',
      valid_until: '2026-07-17T00:00:00Z',
    },
    hard_gate: {
      exact_selector: true,
      quota_state: 'ample',
      policy_compatible: true,
      security_compatible: true,
      permission_compatible: true,
      workspace_compatible: true,
      task_unblocked: true,
      acceptance_satisfied: true,
      paid_use_authorized: true,
      retention_compatible: true,
    },
    metrics: {
      cost_score: 0.8,
      quota_headroom: 0.8,
      latency_score: 0.8,
      context_fit: 0.8,
      integration_score: 0.8,
    },
    community_affinity: {
      registry_revision: '2026-07-16.1',
      evidence_refs: [],
    },
    ...overrides,
  };
}

test('model-policy show exposes one cross-provider role/facts/taste read model', () => {
  const result = invoke([
    'model-policy',
    'show',
    '--task',
    'architecture-design',
    '--as-of',
    AS_OF,
    '--json',
  ]);
  assert.equal(result.code, 0, result.err.join('\n'));
  const data = result.value.data;
  assert.equal(data.schema, 'ccm/model-policy-read-model/v1');
  assert.equal(data.task.task_taxonomy, 'architecture-design');
  assert.equal(data.task.required_role_grade, 'O');
  assert.deepEqual(Object.keys(data.layers).sort(), [
    'community_advisory',
    'hard_facts',
    'project_role_evidence',
  ]);
  const oCandidates = data.layers.project_role_evidence.candidates
    .filter((item: { candidate_role_grades: string[] }) => item.candidate_role_grades.includes('O'))
    .map(
      (item: { provider: string; model_id: string; surface: string }) =>
        `${item.provider}:${item.surface}:${item.model_id}`,
    );
  assert.deepEqual(oCandidates.sort(), [
    'claude-code:claude-code-cli:claude-fable-5',
    'codex:codex-cli:gpt-5.6-sol',
    'cursor:cursor-agent-cli:cursor-grok-4-5',
  ]);
  assert.equal(data.ordering.effect_floor_gate, 'hard');
  assert.equal(data.ordering.community_affinity.mode, 'bounded-tie-break-only');
  assert.ok(data.layers.community_advisory.entries.length > 0);
  for (const entry of data.layers.community_advisory.entries) {
    for (const field of ['source', 'observed_at', 'valid_until', 'confidence', 'contradictions']) {
      assert.ok(Object.hasOwn(entry, field), `missing affinity ${field}`);
    }
  }
  assert.ok(
    data.layers.project_role_evidence.excluded_automatic_routes.some(
      (item: { provider: string; model_id: string; reason_code: string }) =>
        item.provider === 'cursor' &&
        item.model_id === 'claude-fable-5' &&
        item.reason_code === 'cursor-third-party-paid-route-requires-explicit-authorization',
    ),
  );
});

test('model-policy advise hard-gates role/admission and only lets fresh taste break a base equivalence band', () => {
  const request = {
    schema: 'ccm/model-policy-advice-request/v1',
    task_taxonomy: 'architecture-design',
    required_role_grade: 'O',
    posture: 'ample',
    candidates: [
      candidate('codex-cli:gpt-5.6-sol', {
        metrics: {
          cost_score: 0.88,
          quota_headroom: 0.88,
          latency_score: 0.88,
          context_fit: 0.88,
          integration_score: 0.88,
        },
      }),
      candidate('claude-code-cli:claude-fable-5', {
        metrics: {
          cost_score: 0.8,
          quota_headroom: 0.8,
          latency_score: 0.8,
          context_fit: 0.8,
          integration_score: 0.8,
        },
        community_affinity: {
          registry_revision: '2026-07-16.1',
          evidence_refs: ['coderabbit-2026-07-fable-architecture'],
        },
      }),
      candidate('cursor-agent-cli:cursor-grok-4-5', {
        metrics: {
          cost_score: 0.79,
          quota_headroom: 0.79,
          latency_score: 0.79,
          context_fit: 0.79,
          integration_score: 0.79,
        },
      }),
      candidate('cursor-agent-cli:cursor-composer-2-5', {
        qualification: {
          schema: 'ccm/model-policy-live-qualification/v1',
          candidate_id: 'cursor-agent-cli:cursor-composer-2-5',
          provider: 'cursor',
          surface: 'cursor-agent-cli',
          model: 'cursor-composer-2-5',
          status: 'qualified',
          certified_role_grades: ['T1'],
          evidence_refs: ['qualification://live/test'],
          revision: 'qualification-r1',
          observed_at: '2026-07-16T00:00:00Z',
          valid_until: '2026-07-17T00:00:00Z',
        },
        hard_gate: {
          exact_selector: true,
          quota_state: 'unknown',
          policy_compatible: true,
          security_compatible: true,
          permission_compatible: true,
          workspace_compatible: true,
          task_unblocked: true,
          acceptance_satisfied: true,
          paid_use_authorized: true,
          retention_compatible: true,
        },
      }),
    ],
  };
  const result = invoke([
    'model-policy',
    'advise',
    '--input',
    JSON.stringify(request),
    '--as-of',
    AS_OF,
    '--json',
  ]);
  assert.equal(result.code, 0, result.err.join('\n'));
  const data = result.value.data;
  assert.equal(data.schema, 'ccm/model-policy-advice/v1');
  assert.deepEqual(
    data.ranked.map((item: { id: string }) => item.id),
    ['codex-cli:gpt-5.6-sol', 'claude-code-cli:claude-fable-5', 'cursor-agent-cli:cursor-grok-4-5'],
  );
  assert.equal(data.ranked[0].community_tie_break_applied, false);
  assert.equal(data.ranked[1].community_tie_break_applied, true);
  assert.ok(Math.abs(data.ranked[1].community_delta) <= data.policy.max_affinity_delta);
  assert.deepEqual(
    data.rejected.map((item: { id: string }) => item.id),
    ['cursor-agent-cli:cursor-composer-2-5'],
  );
  assert.ok(
    data.rejected
      .find((item: { id: string }) => item.id === 'cursor-agent-cli:cursor-composer-2-5')
      .reason_codes.includes('effect-floor-not-met'),
  );
  assert.ok(
    data.rejected
      .find((item: { id: string }) => item.id === 'cursor-agent-cli:cursor-composer-2-5')
      .reason_codes.includes('quota-not-ample'),
  );
  assert.deepEqual(data.side_effects, {
    provider_requests: 0,
    account_mutations: 0,
    credential_writes: 0,
    board_writes: 0,
  });
});

test('stale, contradictory and very weak community taste is neutral', async () => {
  const lateAsOf = '2026-09-08T12:00:00Z';
  const liveOnLateDate = {
    schema: 'ccm/model-policy-live-qualification/v1',
    candidate_id: 'claude-code-cli:claude-fable-5',
    provider: 'claude-code',
    surface: 'claude-code-cli',
    model: 'claude-fable-5',
    status: 'qualified',
    certified_role_grades: ['O'],
    evidence_refs: ['qualification://live/test'],
    revision: 'qualification-r1',
    observed_at: '2026-09-08T00:00:00Z',
    valid_until: '2026-09-09T00:00:00Z',
  };
  const request = {
    schema: 'ccm/model-policy-advice-request/v1',
    task_taxonomy: 'architecture-design',
    required_role_grade: 'O',
    posture: 'tight',
    candidates: [
      candidate('claude-code-cli:claude-fable-5', {
        qualification: liveOnLateDate,
        admission: {
          schema: 'ccm/model-policy-live-admission/v1',
          candidate_id: 'claude-code-cli:claude-fable-5',
          provider: 'claude-code',
          surface: 'claude-code-cli',
          model: 'claude-fable-5',
          status: 'admitted',
          evidence_refs: ['admission://live/test'],
          revision: 'admission-r1',
          observed_at: '2026-09-08T00:00:00Z',
          valid_until: '2026-09-09T00:00:00Z',
        },
        community_affinity: {
          registry_revision: '2026-07-16.1',
          evidence_refs: ['coderabbit-2026-07-fable-architecture'],
        },
      }),
    ],
  };
  const result = invoke([
    'model-policy',
    'advise',
    '--input',
    JSON.stringify(request),
    '--as-of',
    lateAsOf,
    '--json',
  ]);
  assert.equal(result.code, 0, result.err.join('\n'));
  assert.equal(result.value.data.ranked[0].community_affinity.state, 'stale');
  assert.equal(result.value.data.ranked[0].community_delta, 0);

  const policyModule = await import('../src/model-policy.js');
  const affinity = policyModule.TASK_AFFINITY_REGISTRY.entries.find(
    (entry) => entry.evidence_id === 'coderabbit-2026-07-fable-architecture',
  );
  assert.ok(affinity);
  const original = structuredClone(affinity);
  try {
    affinity.contradictions = ['reviewer-counterexample'];
    const contradictory = invoke([
      'model-policy',
      'advise',
      '--input',
      JSON.stringify({
        schema: 'ccm/model-policy-advice-request/v1',
        task_taxonomy: 'architecture-design',
        required_role_grade: 'O',
        posture: 'tight',
        candidates: [
          candidate('claude-code-cli:claude-fable-5', {
            community_affinity: {
              registry_revision: '2026-07-16.1',
              evidence_refs: ['coderabbit-2026-07-fable-architecture'],
            },
          }),
        ],
      }),
      '--as-of',
      AS_OF,
      '--json',
    ]);
    assert.equal(contradictory.code, 0, contradictory.err.join('\n'));
    assert.equal(contradictory.value.data.ranked[0].community_affinity.state, 'contradictory');
    assert.equal(contradictory.value.data.ranked[0].community_delta, 0);

    affinity.contradictions = [];
    affinity.confidence = 0.1;
    const weak = invoke([
      'model-policy',
      'advise',
      '--input',
      JSON.stringify({
        schema: 'ccm/model-policy-advice-request/v1',
        task_taxonomy: 'architecture-design',
        required_role_grade: 'O',
        posture: 'tight',
        candidates: [
          candidate('claude-code-cli:claude-fable-5', {
            community_affinity: {
              registry_revision: '2026-07-16.1',
              evidence_refs: ['coderabbit-2026-07-fable-architecture'],
            },
          }),
        ],
      }),
      '--as-of',
      AS_OF,
      '--json',
    ]);
    assert.equal(weak.code, 0, weak.err.join('\n'));
    assert.equal(weak.value.data.ranked[0].community_affinity.state, 'weak');
    assert.equal(weak.value.data.ranked[0].community_delta, 0);
  } finally {
    Object.assign(affinity, original);
  }
});

test('advice rejects untracked or target-mismatched candidates and string boolean gates', () => {
  const hostile: Array<[string, Record<string, unknown>, RegExp]> = [
    [
      'untracked BYOK/API route',
      candidate('cursor-agent-cli:claude-fable-5'),
      /tracked model candidate/u,
    ],
    [
      'tracked id with mismatched model',
      candidate('codex-cli:gpt-5.6-sol', { model: 'gpt-5.6-terra' }),
      /must match tracked candidate/u,
    ],
    [
      'qualification bound to another candidate',
      candidate('codex-cli:gpt-5.6-sol', {
        qualification: {
          schema: 'ccm/model-policy-live-qualification/v1',
          candidate_id: 'claude-code-cli:claude-fable-5',
          provider: 'claude-code',
          surface: 'claude-code-cli',
          model: 'claude-fable-5',
          status: 'qualified',
          certified_role_grades: ['O'],
          evidence_refs: ['qualification://forged'],
          revision: 'qualification-r1',
          observed_at: '2026-07-16T00:00:00Z',
          valid_until: '2026-07-17T00:00:00Z',
        },
      }),
      /qualification target must match tracked candidate/u,
    ],
    [
      'truthy string gate',
      candidate('codex-cli:gpt-5.6-sol', {
        hard_gate: {
          exact_selector: 'true',
          quota_state: 'ample',
          policy_compatible: true,
          security_compatible: true,
          permission_compatible: true,
          workspace_compatible: true,
          task_unblocked: true,
          acceptance_satisfied: true,
          paid_use_authorized: true,
          retention_compatible: true,
        },
      }),
      /exact_selector must be a boolean/u,
    ],
    [
      'missing acceptance gate',
      (() => {
        const value = candidate('codex-cli:gpt-5.6-sol') as any;
        delete value.hard_gate.acceptance_satisfied;
        return value;
      })(),
      /hard_gate keys must be exactly/u,
    ],
    [
      'truthy string acceptance gate',
      candidate('codex-cli:gpt-5.6-sol', {
        hard_gate: {
          exact_selector: true,
          quota_state: 'ample',
          policy_compatible: true,
          security_compatible: true,
          permission_compatible: true,
          workspace_compatible: true,
          task_unblocked: true,
          acceptance_satisfied: 'true',
          paid_use_authorized: true,
          retention_compatible: true,
        },
      }),
      /acceptance_satisfied must be a boolean/u,
    ],
    [
      'extra hard gate key',
      candidate('codex-cli:gpt-5.6-sol', {
        hard_gate: {
          exact_selector: true,
          quota_state: 'ample',
          policy_compatible: true,
          security_compatible: true,
          permission_compatible: true,
          workspace_compatible: true,
          task_unblocked: true,
          acceptance_satisfied: true,
          paid_use_authorized: true,
          retention_compatible: true,
          caller_override: true,
        },
      }),
      /hard_gate keys must be exactly/u,
    ],
    [
      'admission bound to another candidate',
      candidate('codex-cli:gpt-5.6-sol', {
        admission: {
          schema: 'ccm/model-policy-live-admission/v1',
          candidate_id: 'claude-code-cli:claude-fable-5',
          provider: 'claude-code',
          surface: 'claude-code-cli',
          model: 'claude-fable-5',
          status: 'admitted',
          evidence_refs: ['admission://forged'],
          revision: 'admission-r1',
          observed_at: '2026-07-16T00:00:00Z',
          valid_until: '2026-07-17T00:00:00Z',
        },
      }),
      /admission target must match tracked candidate/u,
    ],
    [
      'extra schema key',
      { ...candidate('codex-cli:gpt-5.6-sol'), payer: 'caller-invented' },
      /keys must be exactly/u,
    ],
  ];
  for (const [label, hostileCandidate, pattern] of hostile) {
    const result = invoke([
      'model-policy',
      'advise',
      '--input',
      JSON.stringify({
        schema: 'ccm/model-policy-advice-request/v1',
        task_taxonomy: 'architecture-design',
        required_role_grade: 'O',
        posture: 'ample',
        candidates: [hostileCandidate],
      }),
      '--as-of',
      AS_OF,
      '--json',
    ]);
    assert.equal(result.code, 1, label);
    assert.match(result.err.join('\n'), pattern, label);
  }
});

test('advice derives taste only from exact current tracked evidence and rejects invented refs', () => {
  const baseRequest = {
    schema: 'ccm/model-policy-advice-request/v1',
    task_taxonomy: 'architecture-design',
    required_role_grade: 'O',
    posture: 'ample',
  };
  for (const [label, communityAffinity, pattern] of [
    [
      'invented evidence',
      { registry_revision: '2026-07-16.1', evidence_refs: ['community:invented'] },
      /unknown community affinity evidence/u,
    ],
    [
      'wrong task evidence',
      {
        registry_revision: '2026-07-16.1',
        evidence_refs: ['coderabbit-2026-07-sol-implementation'],
      },
      /does not bind request task and candidate/u,
    ],
    [
      'stale registry revision',
      {
        registry_revision: '2026-07-15.1',
        evidence_refs: ['coderabbit-2026-07-fable-architecture'],
      },
      /registry_revision must equal tracked revision/u,
    ],
  ] as const) {
    const result = invoke([
      'model-policy',
      'advise',
      '--input',
      JSON.stringify({
        ...baseRequest,
        candidates: [
          candidate('claude-code-cli:claude-fable-5', {
            community_affinity: communityAffinity,
          }),
        ],
      }),
      '--as-of',
      AS_OF,
      '--json',
    ]);
    assert.equal(result.code, 1, label);
    assert.match(result.err.join('\n'), pattern, label);
  }
});

test('policy/security/permission/workspace/task/acceptance gates are never-on rejections', () => {
  const hardGate = (blocked: string) => ({
    exact_selector: true,
    quota_state: 'ample',
    policy_compatible: blocked !== 'policy',
    security_compatible: blocked !== 'security',
    permission_compatible: blocked !== 'permission',
    workspace_compatible: blocked !== 'workspace',
    task_unblocked: blocked !== 'task',
    acceptance_satisfied: blocked !== 'acceptance',
    paid_use_authorized: true,
    retention_compatible: true,
  });
  for (const [blocked, reason] of [
    ['policy', 'policy-blocked'],
    ['security', 'security-blocked'],
    ['permission', 'permission-blocked'],
    ['workspace', 'workspace-mismatch'],
    ['task', 'task-blocked'],
    ['acceptance', 'acceptance-failed'],
  ] as const) {
    const result = invoke([
      'model-policy',
      'advise',
      '--input',
      JSON.stringify({
        schema: 'ccm/model-policy-advice-request/v1',
        task_taxonomy: 'architecture-design',
        required_role_grade: 'O',
        posture: 'ample',
        candidates: [candidate('codex-cli:gpt-5.6-sol', { hard_gate: hardGate(blocked) })],
      }),
      '--as-of',
      AS_OF,
      '--json',
    ]);
    assert.equal(result.code, 0, `${blocked}: ${result.err.join('\n')}`);
    assert.equal(result.value.data.ranked.length, 0, blocked);
    assert.ok(result.value.data.rejected[0].reason_codes.includes(reason), blocked);
    assert.deepEqual(result.value.data.policy.never_on, [
      'policy-blocked',
      'permission-blocked',
      'security-blocked',
      'workspace-mismatch',
      'task-blocked',
      'acceptance-failed',
    ]);
  }
});

test('advice cannot lower the tracked task role through a caller-supplied effect floor', () => {
  const request = {
    schema: 'ccm/model-policy-advice-request/v1',
    task_taxonomy: 'architecture-design',
    required_role_grade: 'T1',
    posture: 'tight',
    candidates: [],
  };
  const result = invoke([
    'model-policy',
    'advise',
    '--input',
    JSON.stringify(request),
    '--as-of',
    AS_OF,
    '--json',
  ]);
  assert.equal(result.code, 1);
  assert.match(result.err.join('\n'), /must match task policy architecture-design:O/u);
});
