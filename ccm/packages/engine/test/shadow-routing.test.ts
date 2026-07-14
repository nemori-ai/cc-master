import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  adviseShadowRoute,
  buildCachedOrchestratorContext,
  buildOriginContextContent,
  validateMachineContextCache,
} from '../dist/index.mjs';

const AS_OF = '2026-07-13T03:05:00Z';

interface SecretConformanceVector {
  id: string;
  value: string;
  private: boolean;
}

const SECRET_CONFORMANCE = JSON.parse(
  readFileSync(
    new URL('../../../../tests/fixtures/orchestrator-context-secret-vectors.json', import.meta.url),
    'utf8',
  ),
) as { schema: string; families: Record<string, SecretConformanceVector[]> };

const SECRET_CONFORMANCE_VECTORS = Object.entries(SECRET_CONFORMANCE.families).flatMap(
  ([family, vectors]) => vectors.map((vector) => ({ family, ...vector })),
);

interface MutableContextEnvelope extends Record<string, unknown> {
  freshness: Record<string, unknown>;
}

interface SecretInjectableEnvelope extends Record<string, unknown> {
  warnings: string[];
  candidates: Array<{
    reason?: string;
    qualifications: Array<{ ref?: string }>;
  }>;
}

interface CursorContextFixture {
  id: string;
  installed: [boolean, boolean];
  auth: [
    'authenticated' | 'unauthenticated' | 'unknown',
    'authenticated' | 'unauthenticated' | 'unknown',
  ];
  eligible: [boolean, boolean];
  blockers: [string[], string[]];
}

const CURSOR_CONTEXT_FIXTURES = JSON.parse(
  readFileSync(
    new URL('../../../../tests/fixtures/cursor-cached-context-v1.json', import.meta.url),
    'utf8',
  ),
) as {
  states: CursorContextFixture[];
  invalid: Array<{ id: string; mutation: string; value: unknown }>;
};

function cursorSurfaces(fixture: CursorContextFixture): Record<string, unknown> {
  const [ideInstalled, agentInstalled] = fixture.installed;
  const [ideAuth, agentAuth] = fixture.auth;
  const [ideEligible, agentEligible] = fixture.eligible;
  return {
    schema: 'ccm/cursor-surface-context/v1',
    state: fixture.id,
    surfaces: [
      {
        surface_id: 'cursor-ide-plugin',
        harness: 'cursor',
        surface: 'host-native',
        role: 'master-origin',
        installed: ideInstalled,
        auth_state: ideAuth,
        role_eligible: ideEligible,
        blocker_codes: fixture.blockers[0],
        provenance: {
          installed: 'cursor-ide/plugin-install-probe/v1',
          authentication: null,
          role_eligibility: ideEligible
            ? [
                'cursor-ide/plugin-host-qualification/v1',
                'cursor-ide/origin-session-attestation/v1',
              ]
            : [],
        },
      },
      {
        surface_id: 'cursor-agent-cli',
        harness: 'cursor',
        surface: 'cli-headless',
        role: 'worker-target',
        installed: agentInstalled,
        auth_state: agentAuth,
        role_eligible: agentEligible,
        blocker_codes: fixture.blockers[1],
        provenance: {
          installed: 'cursor-agent/version-help-probe/v1',
          authentication: agentAuth === 'unknown' ? null : 'cursor-agent/status-json/v1',
          role_eligibility: agentEligible
            ? [
                'cursor-agent/status-json/v1',
                'cursor-agent/model-entitlement-collector/v1',
                'cursor-agent/quota-collector/v1',
                'cursor-agent/sandbox-runtime-qualification/v1',
                'cursor-agent/transport-qualification/v1',
                'ccm/supervisor-process-tree-qualification/v1',
              ]
            : agentInstalled
              ? ['cursor-agent/quota-collector/v1']
              : [],
        },
      },
    ],
  };
}

function candidate(
  id: string,
  surface: 'host-native' | 'cli-headless',
  harness = 'codex',
): Record<string, unknown> {
  return {
    id,
    surface,
    adapter: `${harness}/${surface}-v1`,
    harness,
    provider: harness === 'codex' ? 'openai' : harness,
    model: surface === 'host-native' ? 'host-default' : 'gpt-future',
    effort: 'high',
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
  };
}

// biome-ignore lint/suspicious/noExplicitAny: fixture is deliberately traversed as dynamic board JSON.
function task(order = ['codex-native', 'codex-cli']): Record<string, any> {
  const candidates = [
    candidate('codex-native', 'host-native'),
    candidate('codex-cli', 'cli-headless'),
  ];
  return {
    id: 'T-shadow',
    status: 'ready',
    executor: 'subagent',
    estimate: { value: 1, unit: 'h' },
    planning: {
      schema: 'ccm/task-planning/v1',
      assessed_at: '2026-07-13T03:00:00Z',
      assessor: 'master-orchestrator',
      dimensions: {
        reasoning: 'multi-step',
        uncertainty: 'low',
        risk: 'medium',
        scope: 'multi-file',
        context: 'medium',
        coordination: 'none',
        reversibility: 'reversible',
      },
      estimate_confidence: 'high',
      quality: { effect_floor: 'meets-required-capabilities' },
      budget: { posture: 'ample', max_attempts: 2 },
      capabilities: {
        required: [{ id: 'structured-output' }],
        preferred: [],
        forbidden: [{ id: 'push-remote' }],
      },
    },
    routing: {
      schema: 'ccm/agent-routing/v1',
      mode: 'cross-harness',
      policy: {
        objective: 'balanced',
        constraints: {
          effect_floor: 'meets-required-capabilities',
          quota_unknown: 'ineligible',
          cross_harness_quota_admission: 'ample-only',
        },
        candidates,
        chains: { ample: order, tight: order },
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
      },
      selected: null,
      attempts: [],
    },
  };
}

function fact(
  candidateId: string,
  surface: 'host-native' | 'cli-headless',
  availability: 'available' | 'unavailable' | 'unknown' = 'available',
  harness = 'codex',
): Record<string, unknown> {
  return {
    candidate_id: candidateId,
    harness,
    surface,
    availability,
    quota: 'ample',
    auth: 'authenticated',
    model: 'available',
    runtime:
      availability === 'available'
        ? 'healthy'
        : availability === 'unknown'
          ? 'unknown'
          : 'unhealthy',
    qualifications: [
      {
        predicate: 'runtime-healthy',
        status:
          availability === 'available' ? 'pass' : availability === 'unknown' ? 'unknown' : 'fail',
        ref: `cache://runtime/${candidateId}`,
      },
    ],
  };
}

function threeOriginTask(
  order = ['claude-native', 'codex-native', 'cursor-native', 'codex-cli'],
): Record<string, unknown> {
  const value = task(order);
  value.routing.policy.candidates = [
    candidate('claude-native', 'host-native', 'claude-code'),
    candidate('codex-native', 'host-native', 'codex'),
    candidate('cursor-native', 'host-native', 'cursor'),
    candidate('codex-cli', 'cli-headless', 'codex'),
  ];
  return value;
}

function cache(
  facts: Record<string, unknown>[],
  cursorSurfaceContext?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    schema: 'ccm/machine-context-cache/v1',
    revision: 'machine-r17',
    board_revision: 'board-r8',
    observed_at: '2026-07-13T03:00:00Z',
    valid_until: '2026-07-13T03:10:00Z',
    candidates: facts,
    ...(cursorSurfaceContext ? { cursor_surfaces: cursorSurfaceContext } : {}),
    warnings: [],
  };
}

function context(facts: Record<string, unknown>[], originHarness = 'codex') {
  return buildCachedOrchestratorContext({
    originHarness,
    boardRevision: 'board-r8',
    snapshot: cache(facts),
    asOf: AS_OF,
  });
}

function activatedBoard(tasks: Record<string, unknown>[]) {
  return {
    schema: 'cc-master/v2',
    meta: {
      contracts: {
        task_planning: 'ccm/task-planning/v1',
        agent_routing: 'ccm/agent-routing/v1',
        agent_routing_activated_at: '2026-07-13T03:00:00Z',
        agent_routing_grandfathered_terminal: [],
      },
    },
    tasks,
  };
}

test('origin content is bounded, redacted, and common-CLI equivalent across three origins', () => {
  const board = activatedBoard([task()]);
  const facts = [
    fact('codex-native', 'host-native', 'unavailable'),
    fact('codex-cli', 'cli-headless'),
  ];
  const deliveries = ['claude-code', 'codex', 'cursor'].map((originHarness) =>
    buildOriginContextContent({
      board,
      context: context(facts, originHarness),
      originHarness,
      boardRevision: 'board-r8',
      asOf: AS_OF,
    }),
  );
  for (const delivery of deliveries) {
    assert.equal(Buffer.byteLength(delivery.content, 'utf8') <= 4096, true);
    assert.match(delivery.content, /^<ambient source="orchestrator-context">/);
    assert.doesNotMatch(delivery.content, /cache:\/\/|credential|token|\/home\//i);
    assert.equal(delivery.payload.dispatch_enabled, false);
    assert.equal(delivery.payload.shadow_only, true);
    assert.equal(delivery.payload.routes[0]?.selected?.candidate_id, 'codex-cli');
    assert.equal(delivery.payload.routes[0]?.selected?.surface, 'cli-headless');
  }
  const normalize = (payload: (typeof deliveries)[number]['payload']) => ({
    ...payload,
    origin_harness: '<origin>',
    routes: payload.routes.map((route) => ({
      ...route,
      outcome: route.outcome.replace(
        /^(?:same-native|same-harness-cli|other-harness-cli)$/,
        '<origin-relative>',
      ),
    })),
  });
  assert.deepEqual(normalize(deliveries[0].payload), normalize(deliveries[1].payload));
  assert.deepEqual(normalize(deliveries[1].payload), normalize(deliveries[2].payload));
});

test('Cursor cached inventory exposes exactly four independent states across three origins', () => {
  const board = activatedBoard([]);
  for (const fixture of CURSOR_CONTEXT_FIXTURES.states) {
    const deliveries = ['claude-code', 'codex', 'cursor'].map((originHarness) => {
      const projectedContext = buildCachedOrchestratorContext({
        originHarness,
        boardRevision: 'board-r8',
        snapshot: cache([], cursorSurfaces(fixture)),
        asOf: AS_OF,
      });
      return buildOriginContextContent({
        board,
        context: projectedContext,
        originHarness,
        boardRevision: 'board-r8',
        asOf: AS_OF,
      });
    });
    for (const delivery of deliveries) {
      assert.equal(delivery.payload.cursor_surfaces?.state, fixture.id);
      assert.deepEqual(
        delivery.payload.cursor_surfaces?.surfaces.map((surface) => ({
          surface_id: surface.surface_id,
          surface: surface.surface,
          installed: surface.installed,
          auth_state: surface.auth_state,
          role_eligible: surface.role_eligible,
          installed_source: surface.provenance.installed,
        })),
        [
          {
            surface_id: 'cursor-ide-plugin',
            surface: 'host-native',
            installed: fixture.installed[0],
            auth_state: fixture.auth[0],
            role_eligible: fixture.eligible[0],
            installed_source: 'cursor-ide/plugin-install-probe/v1',
          },
          {
            surface_id: 'cursor-agent-cli',
            surface: 'cli-headless',
            installed: fixture.installed[1],
            auth_state: fixture.auth[1],
            role_eligible: fixture.eligible[1],
            installed_source: 'cursor-agent/version-help-probe/v1',
          },
        ],
      );
      assert.equal(delivery.payload.dispatch_enabled, false);
    }
    const normalize = (delivery: (typeof deliveries)[number]) => ({
      ...delivery.payload,
      origin_harness: '<origin>',
    });
    assert.deepEqual(normalize(deliveries[0]), normalize(deliveries[1]));
    assert.deepEqual(normalize(deliveries[1]), normalize(deliveries[2]));
  }
});

test('Cursor cached inventory rejects cross-surface inference and counterfeit provenance', () => {
  const neither = CURSOR_CONTEXT_FIXTURES.states.find((entry) => entry.id === 'neither');
  assert.ok(neither);
  for (const invalid of CURSOR_CONTEXT_FIXTURES.invalid) {
    const value = cursorSurfaces(neither);
    const surfaces = value.surfaces as Array<Record<string, unknown>>;
    if (invalid.mutation === 'state') value.state = invalid.value;
    if (invalid.mutation === 'agent-installed-source') {
      (surfaces[1].provenance as Record<string, unknown>).installed = invalid.value;
    }
    if (invalid.mutation === 'agent-auth') surfaces[1].auth_state = invalid.value;
    if (invalid.mutation === 'agent-eligible') surfaces[1].role_eligible = invalid.value;
    if (invalid.mutation === 'agent-surface-id') surfaces[1].surface_id = invalid.value;
    const issues = validateMachineContextCache(cache([], value));
    assert.ok(issues.length > 0, invalid.id);
  }
});

test('origin equivalence preserves shared policy truth while selecting each origin-local native', () => {
  const origins = ['claude-code', 'codex', 'cursor'];
  const expectedNative = ['claude-native', 'codex-native', 'cursor-native'];
  const board = activatedBoard([threeOriginTask()]);
  const facts = [
    fact('claude-native', 'host-native', 'available', 'claude-code'),
    fact('codex-native', 'host-native', 'available', 'codex'),
    fact('cursor-native', 'host-native', 'available', 'cursor'),
    fact('codex-cli', 'cli-headless', 'available', 'codex'),
  ];
  const deliveries = origins.map((originHarness) =>
    buildOriginContextContent({
      board,
      context: context(facts, originHarness),
      originHarness,
      boardRevision: 'board-r8',
      asOf: AS_OF,
    }),
  );

  deliveries.forEach((delivery, index) => {
    assert.equal(delivery.payload.routes[0]?.selected?.candidate_id, expectedNative[index]);
    assert.equal(delivery.payload.routes[0]?.selected?.surface, 'host-native');
    assert.equal(delivery.payload.routes[0]?.outcome, 'same-native');
    assert.deepEqual(delivery.payload.routes[0]?.reason_codes, ['shadow-first-eligible']);
    assert.deepEqual(delivery.payload.candidates, deliveries[0]?.payload.candidates);
  });

  const normalized = deliveries.map(({ payload }) => ({
    ...payload,
    origin_harness: '<origin>',
    routes: payload.routes.map((route) => ({
      ...route,
      outcome: route.selected?.surface === 'host-native' ? '<origin-native>' : route.outcome,
      selected:
        route.selected?.surface === 'host-native'
          ? { candidate_id: '<origin-native>', harness: '<origin>', surface: 'host-native' }
          : route.selected,
    })),
  }));
  assert.deepEqual(normalized[0], normalized[1]);
  assert.deepEqual(normalized[1], normalized[2]);

  const advices = origins.map((originHarness) =>
    adviseShadowRoute({
      task: threeOriginTask(),
      context: context(facts, originHarness),
      originHarness,
      boardRevision: 'board-r8',
      asOf: AS_OF,
    }),
  );
  const normalizeEvaluations = (advice: (typeof advices)[number]) =>
    advice.evaluations.map((evaluation) => ({
      candidate_id: evaluation.candidate_id,
      harness: evaluation.harness,
      surface: evaluation.surface,
      base_reason_codes: evaluation.reason_codes.filter(
        (reason) => reason !== 'host-native-origin-mismatch' && reason !== 'candidate-eligible',
      ),
      qualification_results: evaluation.qualification_results,
    }));
  advices.forEach((advice, originIndex) => {
    assert.equal(advice.selected?.candidate_id, expectedNative[originIndex]);
    assert.deepEqual(normalizeEvaluations(advice), normalizeEvaluations(advices[0]));
    for (const evaluation of advice.evaluations) {
      if (evaluation.surface === 'cli-headless') {
        assert.equal(evaluation.eligible, true);
        assert.deepEqual(evaluation.reason_codes, ['candidate-eligible']);
      } else if (evaluation.harness === origins[originIndex]) {
        assert.equal(evaluation.eligible, true);
        assert.deepEqual(evaluation.reason_codes, ['candidate-eligible']);
      } else {
        assert.equal(evaluation.eligible, false);
        assert.deepEqual(evaluation.reason_codes, ['host-native-origin-mismatch']);
      }
    }
  });
});

test('origin equivalence covers rejected native, same/other CLI, origin-stay, and no-route', () => {
  const origins = ['claude-code', 'codex', 'cursor'];
  const cases = [
    {
      name: 'rejected-native-to-cli',
      task: threeOriginTask(),
      facts: [
        fact('claude-native', 'host-native', 'unavailable', 'claude-code'),
        fact('codex-native', 'host-native', 'unavailable', 'codex'),
        fact('cursor-native', 'host-native', 'unavailable', 'cursor'),
        fact('codex-cli', 'cli-headless', 'available', 'codex'),
      ],
      selected: 'codex-cli',
      outcomes: ['other-harness-cli', 'same-harness-cli', 'other-harness-cli'],
    },
    {
      name: 'origin-stay',
      task: threeOriginTask(['codex-cli', 'claude-native', 'codex-native', 'cursor-native']),
      facts: [
        fact('claude-native', 'host-native', 'available', 'claude-code'),
        fact('codex-native', 'host-native', 'available', 'codex'),
        fact('cursor-native', 'host-native', 'available', 'cursor'),
        fact('codex-cli', 'cli-headless', 'unavailable', 'codex'),
      ],
      selected: '<origin-native>',
      outcomes: ['origin-stay', 'origin-stay', 'origin-stay'],
    },
    {
      name: 'no-route',
      task: threeOriginTask(),
      facts: [
        fact('claude-native', 'host-native', 'unavailable', 'claude-code'),
        fact('codex-native', 'host-native', 'unavailable', 'codex'),
        fact('cursor-native', 'host-native', 'unavailable', 'cursor'),
        fact('codex-cli', 'cli-headless', 'unavailable', 'codex'),
      ],
      selected: null,
      outcomes: ['no-route', 'no-route', 'no-route'],
    },
  ];

  for (const fixture of cases) {
    const board = activatedBoard([fixture.task]);
    origins.forEach((originHarness, index) => {
      const delivery = buildOriginContextContent({
        board,
        context: context(fixture.facts, originHarness),
        originHarness,
        boardRevision: 'board-r8',
        asOf: AS_OF,
      });
      const route = delivery.payload.routes[0];
      assert.equal(route?.outcome, fixture.outcomes[index], fixture.name);
      if (fixture.selected === '<origin-native>') {
        assert.equal(route?.selected?.harness, originHarness, fixture.name);
        assert.equal(route?.selected?.surface, 'host-native', fixture.name);
      } else {
        assert.equal(route?.selected?.candidate_id ?? null, fixture.selected, fixture.name);
      }
    });
  }
});

test('origin content bounds ready route summaries without partial load-bearing truncation', () => {
  const tasks = Array.from({ length: 40 }, (_, index) => ({
    ...task(),
    id: `T-${String(index).padStart(2, '0')}`,
  }));
  const delivery = buildOriginContextContent({
    board: activatedBoard(tasks),
    context: context([
      fact('codex-native', 'host-native', 'unavailable'),
      fact('codex-cli', 'cli-headless'),
    ]),
    originHarness: 'codex',
    boardRevision: 'board-r8',
    asOf: AS_OF,
  });
  assert.equal(delivery.payload.routes.length <= 12, true);
  assert.equal(delivery.payload.truncation.omitted_routes >= 28, true);
  assert.equal(Buffer.byteLength(delivery.content, 'utf8') <= 4096, true);
});

test('machine cache validates opaque revisions, exact candidate facts, and unknown as data', () => {
  assert.deepEqual(
    validateMachineContextCache(cache([fact('codex-native', 'host-native', 'unknown')])),
    [],
  );

  // biome-ignore lint/suspicious/noExplicitAny: negative fixture is deliberately corrupted in-place.
  const broken = cache([fact('codex-native', 'host-native')]) as any;
  broken.candidates.push(structuredClone(broken.candidates[0]));
  broken.candidates[0].qualifications.push({ predicate: 'runtime-healthy', status: 'pass' });
  const paths = validateMachineContextCache(broken).map((entry) => entry.path);
  assert.ok(paths.includes('snapshot.candidates'));
  assert.ok(paths.includes('snapshot.candidates[0].qualifications'));

  // biome-ignore lint/suspicious/noExplicitAny: negative fixture is deliberately corrupted in-place.
  const collapsed = cache([fact('codex-native', 'host-native')]) as any;
  delete collapsed.candidates[0].auth;
  delete collapsed.candidates[0].model;
  delete collapsed.candidates[0].runtime;
  const collapsedPaths = validateMachineContextCache(collapsed).map((entry) => entry.path);
  assert.ok(collapsedPaths.includes('snapshot.candidates[0].auth'));
  assert.ok(collapsedPaths.includes('snapshot.candidates[0].model'));
  assert.ok(collapsedPaths.includes('snapshot.candidates[0].runtime'));
});

test('cached context preserves frozen revisions, freshness, and unknown without probing', () => {
  const result = context([
    fact('codex-native', 'host-native', 'unknown'),
    fact('codex-cli', 'cli-headless'),
  ]);
  assert.equal(result.schema, 'ccm/orchestrator-context/v1');
  assert.equal(result.cached_only, true);
  assert.equal(result.revisions.machine, 'machine-r17');
  assert.equal(result.revisions.board, 'board-r8');
  assert.equal(result.freshness.state, 'fresh');
  assert.equal(result.candidates[0].availability, 'unknown');
});

test('shadow advice replays same-native, same-harness CLI, other-harness CLI, origin-stay, and no-route', () => {
  const nativeFirst = context([
    fact('codex-native', 'host-native'),
    fact('codex-cli', 'cli-headless'),
  ]);
  const sameNative = adviseShadowRoute({
    task: task(),
    context: nativeFirst,
    originHarness: 'codex',
    boardRevision: 'board-r8',
    asOf: AS_OF,
  });
  assert.equal(sameNative.outcome, 'same-native');
  assert.equal(sameNative.selected?.candidate_id, 'codex-native');

  const cliOnly = context([
    fact('codex-native', 'host-native', 'unavailable'),
    fact('codex-cli', 'cli-headless'),
  ]);
  const sameCli = adviseShadowRoute({
    task: task(),
    context: cliOnly,
    originHarness: 'codex',
    boardRevision: 'board-r8',
    asOf: AS_OF,
  });
  assert.equal(sameCli.outcome, 'same-harness-cli');
  assert.equal(
    sameCli.selected?.surface,
    'cli-headless',
    'same-harness CLI never folds into native',
  );

  const cursorContext = context(
    [fact('codex-native', 'host-native', 'unavailable'), fact('codex-cli', 'cli-headless')],
    'cursor',
  );
  const otherCli = adviseShadowRoute({
    task: task(),
    context: cursorContext,
    originHarness: 'cursor',
    boardRevision: 'board-r8',
    asOf: AS_OF,
  });
  assert.equal(otherCli.outcome, 'other-harness-cli');
  assert.equal(otherCli.selected?.candidate_id, sameCli.selected?.candidate_id);
  assert.deepEqual(
    otherCli.evaluations.map((entry) => [entry.candidate_id, entry.eligible]),
    sameCli.evaluations.map((entry) => [entry.candidate_id, entry.eligible]),
    'origin brand changes the descriptive outcome, not eligibility or ordering',
  );

  assert.throws(
    () =>
      adviseShadowRoute({
        task: task(),
        context: cliOnly,
        originHarness: 'cursor',
        boardRevision: 'board-r8',
        asOf: AS_OF,
      }),
    /origin/i,
    'a context frozen for one origin cannot be relabeled by route advice',
  );

  const originStayContext = context([
    fact('codex-cli', 'cli-headless', 'unavailable'),
    fact('codex-native', 'host-native'),
  ]);
  const originStay = adviseShadowRoute({
    task: task(['codex-cli', 'codex-native']),
    context: originStayContext,
    originHarness: 'codex',
    boardRevision: 'board-r8',
    asOf: AS_OF,
  });
  assert.equal(originStay.outcome, 'origin-stay');
  assert.ok(originStay.reason_codes.includes('origin-stay-cli-ineligible'));

  const noRoute = adviseShadowRoute({
    task: task(),
    context: context([
      fact('codex-native', 'host-native', 'unknown'),
      fact('codex-cli', 'cli-headless', 'unknown'),
    ]),
    originHarness: 'codex',
    boardRevision: 'board-r8',
    asOf: AS_OF,
  });
  assert.equal(noRoute.eligible, false);
  assert.equal(noRoute.selected, null);
  assert.equal(noRoute.outcome, 'no-route');
  assert.equal(noRoute.spawned, false);
});

test('stale or revision-mismatched context fails closed and keeps the cause visible', () => {
  const stale = buildCachedOrchestratorContext({
    originHarness: 'codex',
    boardRevision: 'board-r8',
    snapshot: cache([fact('codex-native', 'host-native')]),
    asOf: '2026-07-13T03:11:00Z',
  });
  const staleAdvice = adviseShadowRoute({
    task: task(),
    context: stale,
    originHarness: 'codex',
    boardRevision: 'board-r8',
    asOf: '2026-07-13T03:11:00Z',
  });
  assert.equal(staleAdvice.eligible, false);
  assert.ok(staleAdvice.warnings.includes('machine-context-stale'));

  const mismatch = adviseShadowRoute({
    task: task(),
    context: context([fact('codex-native', 'host-native')]),
    originHarness: 'codex',
    boardRevision: 'board-r9',
    asOf: AS_OF,
  });
  assert.equal(mismatch.eligible, false);
  assert.ok(mismatch.warnings.includes('board-revision-mismatch'));

  const notYetObserved = buildCachedOrchestratorContext({
    originHarness: 'codex',
    boardRevision: 'board-r8',
    snapshot: cache([fact('codex-native', 'host-native')]),
    asOf: '2026-07-13T02:59:59Z',
  });
  assert.equal(notYetObserved.freshness.state, 'unknown');
  assert.ok(notYetObserved.warnings.includes('machine-context-not-yet-observed'));

  const replayedAfterExpiry = adviseShadowRoute({
    task: task(),
    context: context([fact('codex-native', 'host-native')]),
    originHarness: 'codex',
    boardRevision: 'board-r8',
    asOf: '2026-07-13T04:00:00Z',
  });
  assert.equal(replayedAfterExpiry.eligible, false);
  assert.equal(replayedAfterExpiry.outcome, 'no-route');
  assert.ok(replayedAfterExpiry.warnings.includes('machine-context-stale'));

  const unavailable = structuredClone(context([fact('codex-native', 'host-native')]));
  unavailable.available = false;
  const unavailableAdvice = adviseShadowRoute({
    task: task(),
    context: unavailable,
    originHarness: 'codex',
    boardRevision: 'board-r8',
    asOf: AS_OF,
  });
  assert.equal(unavailableAdvice.eligible, false);
  assert.ok(unavailableAdvice.evaluations[0]?.reason_codes.includes('context-unavailable'));
});

test('public freshness envelope is complete, ordered, and state-coherent', () => {
  const baseline = context([fact('codex-native', 'host-native')]);
  for (const mutate of [
    (value: MutableContextEnvelope) => delete value.freshness.as_of,
    (value: MutableContextEnvelope) => {
      value.freshness.as_of = 'not-a-time';
    },
    (value: MutableContextEnvelope) => {
      value.freshness.observed_at = '2026-07-13T03:12:00Z';
    },
    (value: MutableContextEnvelope) => {
      value.freshness.state = 'fresh';
      value.freshness.as_of = '2026-07-13T04:00:00Z';
    },
  ]) {
    const corrupted = structuredClone(baseline) as unknown as MutableContextEnvelope;
    mutate(corrupted);
    assert.throws(
      () =>
        adviseShadowRoute({
          task: task(),
          context: corrupted,
          originHarness: 'codex',
          boardRevision: 'board-r8',
          asOf: AS_OF,
        }),
      /invalid shadow route input/,
    );
  }
});

test('impossible calendar UTC values fail closed at context-build and route-advice boundaries', () => {
  const impossible = '2026-02-31T03:05:00Z';
  const marchCache = cache([fact('codex-native', 'host-native')]);
  marchCache.observed_at = '2026-03-01T00:00:00Z';
  marchCache.valid_until = '2026-03-10T00:00:00Z';

  assert.throws(
    () =>
      buildCachedOrchestratorContext({
        originHarness: 'codex',
        boardRevision: 'board-r8',
        snapshot: marchCache,
        asOf: impossible,
      }),
    /strict ISO|invalid cached machine context/i,
  );

  const invalidLeapDay = structuredClone(marchCache);
  invalidLeapDay.observed_at = '2025-02-29T00:00:00Z';
  assert.throws(
    () =>
      buildCachedOrchestratorContext({
        originHarness: 'codex',
        boardRevision: 'board-r8',
        snapshot: invalidLeapDay,
        asOf: '2026-03-03T03:05:00Z',
      }),
    /strict ISO|invalid cached machine context/i,
  );

  const validLeapDay = structuredClone(marchCache);
  validLeapDay.observed_at = '2024-02-29T00:00:00Z';
  validLeapDay.valid_until = '2024-03-01T00:00:00Z';
  const leapContext = buildCachedOrchestratorContext({
    originHarness: 'codex',
    boardRevision: 'board-r8',
    snapshot: validLeapDay,
    asOf: '2024-02-29T12:00:00Z',
  });
  assert.equal(leapContext.freshness.state, 'fresh');

  const impossibleObservation = structuredClone(marchCache);
  impossibleObservation.observed_at = impossible;
  assert.throws(
    () =>
      buildCachedOrchestratorContext({
        originHarness: 'codex',
        boardRevision: 'board-r8',
        snapshot: impossibleObservation,
        asOf: '2026-03-03T03:05:00Z',
      }),
    /strict ISO|invalid cached machine context/i,
  );

  const valid = context([fact('codex-native', 'host-native')]);
  assert.throws(
    () =>
      adviseShadowRoute({
        task: task(),
        context: valid,
        originHarness: 'codex',
        boardRevision: 'board-r8',
        asOf: impossible,
      }),
    /strict ISO|invalid shadow route input/i,
  );

  const impossiblePublicContext = structuredClone(valid) as unknown as MutableContextEnvelope;
  impossiblePublicContext.freshness.observed_at = '2026-03-01T00:00:00Z';
  impossiblePublicContext.freshness.valid_until = '2026-03-10T00:00:00Z';
  impossiblePublicContext.freshness.as_of = impossible;
  impossiblePublicContext.freshness.state = 'fresh';
  assert.throws(
    () =>
      adviseShadowRoute({
        task: task(),
        context: impossiblePublicContext,
        originHarness: 'codex',
        boardRevision: 'board-r8',
        asOf: '2026-03-03T03:05:00Z',
      }),
    /strict ISO|invalid shadow route input/i,
  );
});

test('all CLI-headless candidates require ample quota, including same-harness CLI', () => {
  const tightFacts = [
    fact('codex-native', 'host-native', 'unavailable'),
    { ...fact('codex-cli', 'cli-headless'), quota: 'tight' },
  ];
  const advice = adviseShadowRoute({
    task: task(),
    context: context(tightFacts),
    originHarness: 'codex',
    boardRevision: 'board-r8',
    asOf: AS_OF,
  });
  assert.equal(advice.eligible, false);
  assert.ok(
    advice.evaluations
      .find((entry) => entry.candidate_id === 'codex-cli')
      ?.reason_codes.includes('cli-quota-not-ample'),
  );
});

test('route advice deeply rejects corrupted context candidates instead of trusting the envelope', () => {
  const corrupted = structuredClone(context([fact('codex-native', 'host-native')]));
  // biome-ignore lint/suspicious/noExplicitAny: negative fixture is deliberately corrupted in-place.
  (corrupted.candidates[0] as any).auth = 'definitely-authenticated';
  assert.throws(
    () =>
      adviseShadowRoute({
        task: task(),
        context: corrupted,
        originHarness: 'codex',
        boardRevision: 'board-r8',
        asOf: AS_OF,
      }),
    /invalid shadow route input/,
  );
});

test('public context rejects recursive secret-bearing fields and never echoes sentinel values', () => {
  const sentinel = 'SECRET-MUST-NOT-ENTER-PROMPT';
  const secretFields = [
    ['credential', sentinel],
    ['token', sentinel],
    ['argv', [sentinel]],
    ['env', { SECRET: sentinel }],
    ['raw_private_response', { body: sentinel }],
    ['transcript', sentinel],
    ['balance', sentinel],
  ] as const;
  for (const [key, value] of secretFields) {
    const secretFact = fact('codex-native', 'host-native');
    (secretFact as Record<string, unknown>)[key] = value;
    assert.throws(
      () => context([secretFact]),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /forbidden|secret/i);
        assert.doesNotMatch(error.message, new RegExp(sentinel));
        return true;
      },
    );
  }

  const nested = fact('codex-native', 'host-native');
  const qualifications = nested.qualifications as Array<Record<string, unknown>>;
  qualifications[0]!.raw_response = sentinel;
  assert.throws(() => context([nested]), /forbidden|secret/i);

  const benignExtra = fact('codex-native', 'host-native');
  benignExtra.future_extension = { harmless: true };
  const projected = context([benignExtra]);
  assert.equal('future_extension' in projected.candidates[0]!, false);
  assert.doesNotMatch(JSON.stringify(projected), new RegExp(sentinel));

  const secretValues = [
    'sk-ant-api03-FAKE-SENTINEL-NOT-A-REAL-SECRET',
    'ghp_FAKE_SENTINEL_NOT_A_REAL_SECRET',
    'Bearer FAKE0123456789TOKEN',
    'eyJmYWtlIjoidGVzdCJ9.eyJzdWIiOiJmYWtlIn0.FAKE_SIGNATURE_12345',
    'api_key=FAKE0123456789TOKEN',
    'credential: FAKE0123456789TOKEN',
  ];
  for (const secretValue of secretValues) {
    const secretCache = cache([fact('codex-native', 'host-native')]);
    secretCache.warnings = [secretValue];
    const secretCandidate = (secretCache.candidates as Array<Record<string, unknown>>)[0]!;
    secretCandidate.reason = secretValue;
    const secretQualifications = secretCandidate.qualifications as Array<Record<string, unknown>>;
    secretQualifications[0]!.ref = secretValue;
    assert.throws(
      () =>
        buildCachedOrchestratorContext({
          originHarness: 'codex',
          boardRevision: 'board-r8',
          snapshot: secretCache,
          asOf: AS_OF,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /forbidden|secret/i);
        assert.equal(error.message.includes(secretValue), false);
        return true;
      },
    );
  }

  const alphabeticHighSignalValues = [
    'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX',
    'Bearer ABCDEFGHIJKLMNOPQRSTUVWX',
    ...['!', '?', ')', ':'].map((suffix) => `Bearer ABCDEFGHIJKLMNOPQRSTUVWX${suffix}`),
  ];
  const cacheLocations: Array<{
    name: string;
    inject: (snapshot: SecretInjectableEnvelope, secretValue: string) => void;
  }> = [
    {
      name: 'warning',
      inject: (snapshot, secretValue) => {
        snapshot.warnings = [secretValue];
      },
    },
    {
      name: 'candidate reason',
      inject: (snapshot, secretValue) => {
        snapshot.candidates[0].reason = secretValue;
      },
    },
    {
      name: 'qualification ref',
      inject: (snapshot, secretValue) => {
        snapshot.candidates[0].qualifications[0].ref = secretValue;
      },
    },
  ];
  for (const secretValue of alphabeticHighSignalValues) {
    for (const location of cacheLocations) {
      const secretCache = cache([
        fact('codex-native', 'host-native'),
      ]) as unknown as SecretInjectableEnvelope;
      location.inject(secretCache, secretValue);
      assert.throws(
        () =>
          buildCachedOrchestratorContext({
            originHarness: 'codex',
            boardRevision: 'board-r8',
            snapshot: secretCache,
            asOf: AS_OF,
          }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /forbidden|secret/i, location.name);
          assert.equal(error.message.includes(secretValue), false, location.name);
          return true;
        },
      );
    }
  }

  const publicWithSecret = context([fact('codex-native', 'host-native')]);
  publicWithSecret.warnings = [secretValues[1]!];
  assert.throws(
    () =>
      adviseShadowRoute({
        task: task(),
        context: publicWithSecret,
        originHarness: 'codex',
        boardRevision: 'board-r8',
        asOf: AS_OF,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /forbidden|secret/i);
      assert.equal(error.message.includes(secretValues[1]!), false);
      return true;
    },
  );

  for (const secretValue of alphabeticHighSignalValues) {
    for (const location of cacheLocations) {
      const publicContext = context([
        fact('codex-native', 'host-native'),
      ]) as unknown as SecretInjectableEnvelope;
      location.inject(publicContext, secretValue);
      assert.throws(
        () =>
          adviseShadowRoute({
            task: task(),
            context: publicContext,
            originHarness: 'codex',
            boardRevision: 'board-r8',
            asOf: AS_OF,
          }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /forbidden|secret/i, location.name);
          assert.equal(error.message.includes(secretValue), false, location.name);
          return true;
        },
      );
    }
  }

  const benignCache = cache([fact('codex-native', 'host-native')]);
  benignCache.warnings = [
    'token budget is tight',
    'Bearer authentication is unavailable',
    'api key is not configured',
    'credential access is forbidden',
    'credential: unavailable',
    'api_key=REDACTED',
    'Bearer REDACTED',
    'Bearer authentication is unavailable!',
    'Bearer authentication: unavailable',
    'Bearer auth: unavailable',
    'task-sketch remains pending',
    'docs describe the sk-token-format placeholder',
    'sk-short',
    'Bearer status',
    'Bearer status: unavailable',
  ];
  const benignCandidate = (benignCache.candidates as Array<Record<string, unknown>>)[0]!;
  const benignQualifications = benignCandidate.qualifications as Array<Record<string, unknown>>;
  benignQualifications[0]!.ref = 'docs://credential-and-token-policy';
  const benignProjection = buildCachedOrchestratorContext({
    originHarness: 'codex',
    boardRevision: 'board-r8',
    snapshot: benignCache,
    asOf: AS_OF,
  });
  assert.equal(benignProjection.warnings.length, benignCache.warnings.length);
  assert.equal(
    benignProjection.candidates[0]?.qualifications[0]?.ref,
    'docs://credential-and-token-policy',
  );
  assert.doesNotThrow(() =>
    adviseShadowRoute({
      task: task(),
      context: benignProjection,
      originHarness: 'codex',
      boardRevision: 'board-r8',
      asOf: AS_OF,
    }),
  );
});

test('private-value language follows the shared producer/consumer conformance vectors', () => {
  assert.equal(SECRET_CONFORMANCE.schema, 'ccm/orchestrator-context-secret-conformance/v2');
  assert.deepEqual(Object.keys(SECRET_CONFORMANCE.families).sort(), [
    'assignment',
    'bearer',
    'github',
    'jwt',
    'sk',
  ]);
  assert.ok(SECRET_CONFORMANCE.families.sk?.some((vector) => vector.id === 'underscore-prefixed'));
  assert.ok(
    SECRET_CONFORMANCE.families.assignment?.some(
      (vector) => vector.value === 'api_key:redacted' && vector.private === false,
    ),
  );

  for (const vector of SECRET_CONFORMANCE_VECTORS) {
    const endpointSafe = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(vector.value);
    const testContext = () => {
      if (endpointSafe) return context([fact(vector.value, 'cli-headless')]);
      const vectorCache = cache([fact('codex-cli', 'cli-headless')]);
      vectorCache.warnings = [vector.value];
      return buildCachedOrchestratorContext({
        originHarness: 'codex',
        boardRevision: 'board-r8',
        snapshot: vectorCache,
        asOf: AS_OF,
      });
    };
    if (vector.private) {
      assert.throws(testContext, (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /forbidden|secret/i, `${vector.family}/${vector.id}`);
        assert.equal(error.message.includes(vector.value), false, `${vector.family}/${vector.id}`);
        return true;
      });
      continue;
    }

    const publicContext = testContext();
    if (!endpointSafe) {
      assert.deepEqual(publicContext.warnings, [vector.value], `${vector.family}/${vector.id}`);
      continue;
    }
    const delivery = buildOriginContextContent({
      board: activatedBoard([]),
      context: publicContext,
      originHarness: 'codex',
      boardRevision: 'board-r8',
      asOf: AS_OF,
    });
    assert.equal(
      delivery.payload.candidates[0]?.candidate_id,
      vector.value,
      `${vector.family}/${vector.id}`,
    );
    assert.match(delivery.content, new RegExp(vector.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('producer and shared consumer mechanically declare the same private-value language', () => {
  const extract = (source: string, name: string) => {
    const start = `// BEGIN ${name}`;
    const end = `// END ${name}`;
    const from = source.indexOf(start);
    const to = source.indexOf(end);
    assert.notEqual(from, -1, `missing ${start}`);
    assert.notEqual(to, -1, `missing ${end}`);
    return source.slice(from + start.length, to).trim();
  };
  const producer = readFileSync(new URL('../src/shadow-routing.ts', import.meta.url), 'utf8');
  const consumer = readFileSync(
    new URL(
      '../../../../plugin/src/hooks/_shared/orchestrator-context-private-value.js',
      import.meta.url,
    ),
    'utf8',
  );
  assert.equal(
    extract(producer, 'ORIGIN_PRIVATE_VALUE_LANGUAGE'),
    extract(consumer, 'ORIGIN_PRIVATE_VALUE_LANGUAGE'),
  );
  assert.equal(
    extract(producer, 'ORIGIN_PRIVATE_VALUE_ALGORITHM'),
    extract(consumer, 'ORIGIN_PRIVATE_VALUE_ALGORITHM'),
  );
});

test('runtime-healthy qualification preserves fail/unknown/missing and rejects contradictions', () => {
  const failed = fact('codex-native', 'host-native');
  failed.runtime = 'unhealthy';
  failed.qualifications = [
    { predicate: 'runtime-healthy', status: 'fail', ref: 'cache://runtime/fail' },
  ];
  const failedAdvice = adviseShadowRoute({
    task: task(),
    context: context([failed]),
    originHarness: 'codex',
    boardRevision: 'board-r8',
    asOf: AS_OF,
  });
  assert.equal(failedAdvice.eligible, false);
  assert.equal(failedAdvice.evaluations[0]?.qualification_results[0]?.status, 'fail');

  const unknown = fact('codex-native', 'host-native');
  unknown.runtime = 'unknown';
  unknown.qualifications = [
    { predicate: 'runtime-healthy', status: 'unknown', ref: 'cache://runtime/unknown' },
  ];
  const unknownAdvice = adviseShadowRoute({
    task: task(),
    context: context([unknown]),
    originHarness: 'codex',
    boardRevision: 'board-r8',
    asOf: AS_OF,
  });
  assert.equal(unknownAdvice.eligible, false);
  assert.equal(unknownAdvice.evaluations[0]?.qualification_results[0]?.status, 'unknown');

  const missing = fact('codex-native', 'host-native');
  missing.qualifications = [];
  const missingAdvice = adviseShadowRoute({
    task: task(),
    context: context([missing]),
    originHarness: 'codex',
    boardRevision: 'board-r8',
    asOf: AS_OF,
  });
  assert.equal(missingAdvice.eligible, false);
  assert.equal(missingAdvice.evaluations[0]?.qualification_results[0]?.status, 'unknown');

  const contradiction = fact('codex-native', 'host-native');
  contradiction.qualifications = [
    { predicate: 'runtime-healthy', status: 'fail', ref: 'cache://runtime/contradiction' },
  ];
  assert.throws(() => context([contradiction]), /runtime-healthy|contradict/i);
});

test('public context is deterministically bounded to 4096 bytes with explicit truncation metadata', () => {
  const small = context([fact('codex-native', 'host-native')]);
  assert.ok(Buffer.byteLength(JSON.stringify(small), 'utf8') <= 4096);
  assert.equal(small.truncation.applied, false);

  const atLimitCache = cache([fact('codex-native', 'host-native')]);
  atLimitCache.warnings = Array.from(
    { length: 13 },
    (_, index) => `${String(index).padStart(2, '0')}-${'x'.repeat(251)}`,
  );
  const atLimitFact = (atLimitCache.candidates as Array<Record<string, unknown>>)[0]!;
  const atLimitQualification = (atLimitFact.qualifications as Array<Record<string, unknown>>)[0]!;
  const buildAtLimit = () =>
    buildCachedOrchestratorContext({
      originHarness: 'codex',
      boardRevision: 'board-r8',
      snapshot: structuredClone(atLimitCache),
      asOf: AS_OF,
    });
  const initialSize = Buffer.byteLength(JSON.stringify(buildAtLimit()), 'utf8');
  const exactPadding = 4096 - initialSize;
  assert.ok(exactPadding > 0 && exactPadding < 128);
  atLimitQualification.ref = `${String(atLimitQualification.ref)}${'r'.repeat(exactPadding)}`;
  const exact = buildAtLimit();
  assert.equal(Buffer.byteLength(JSON.stringify(exact), 'utf8'), 4096);
  assert.equal(exact.truncation.applied, false);

  atLimitQualification.ref = `${String(atLimitQualification.ref)}r`;
  const oneByteOver = buildAtLimit();
  assert.ok(Buffer.byteLength(JSON.stringify(oneByteOver), 'utf8') <= 4096);
  assert.equal(oneByteOver.truncation.applied, true);
  assert.equal(oneByteOver.truncation.omitted_warnings, 1);
  assert.equal(oneByteOver.revisions.board, 'board-r8');
  assert.equal(oneByteOver.freshness.state, 'fresh');

  const oversizedCache = cache([fact('codex-native', 'host-native')]);
  oversizedCache.warnings = [
    'W'.repeat(5000),
    ...Array.from({ length: 64 }, (_, i) => `warning-${i}-${'x'.repeat(240)}`),
  ];
  const build = () =>
    buildCachedOrchestratorContext({
      originHarness: 'codex',
      boardRevision: 'board-r8',
      snapshot: structuredClone(oversizedCache),
      asOf: AS_OF,
    });
  const first = build();
  const second = build();
  assert.deepEqual(first, second);
  assert.ok(Buffer.byteLength(JSON.stringify(first), 'utf8') <= 4096);
  assert.equal(first.truncation.applied, true);
  assert.ok(first.truncation.omitted_warnings > 0);
  assert.ok(first.truncation.shortened_fields > 0);
  assert.equal(first.revisions.board, 'board-r8');
  assert.equal(first.revisions.machine, 'machine-r17');
  assert.equal(first.freshness.state, 'fresh');
  assert.equal(first.candidates[0]?.availability, 'available');
});
