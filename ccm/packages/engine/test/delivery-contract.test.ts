import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  analyzeGraph,
  canonicalJson,
  dependencyQualified,
  lintBoard,
  reconcileGating,
  targetDelivered,
  validateDeliveryContracts,
} from '../dist/index.mjs';

function candidateFingerprint(
  taskId: string,
  finishedAt: string,
  artifact: unknown,
  subject: Record<string, unknown>,
): string {
  return `sha256:${createHash('sha256')
    .update(
      canonicalJson({
        task_id: taskId,
        bound_finished_at: finishedAt,
        bound_artifact: artifact,
        subject,
      }),
    )
    .digest('hex')}`;
}

const baseBoard = (tasks: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => ({
  schema: 'cc-master/v2',
  goal: 'delivery truth',
  owner: { active: true, session_id: 's' },
  git: { worktree: '/repo', branch: 'topic' },
  tasks,
  ...extra,
});

const done = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  status: 'done',
  deps: [],
  verified: true,
  artifact: `/artifacts/${id}.json`,
  finished_at: '2026-07-14T01:00:00Z',
  ...extra,
});

const target = {
  kind: 'git-ref',
  repository: { source: 'board.git.worktree' },
  ref: 'refs/remotes/origin/main',
  snapshot: { oid: 'a'.repeat(40), observed_at: '2026-07-14T01:01:00Z' },
};

const candidateSubject = { kind: 'git-commit', commit_oid: 'c'.repeat(40) };
const candidate = {
  fingerprint: candidateFingerprint(
    'U',
    '2026-07-14T01:00:00Z',
    '/artifacts/U.json',
    candidateSubject,
  ),
  bound_finished_at: '2026-07-14T01:00:00Z',
  bound_artifact: '/artifacts/U.json',
  subject: candidateSubject,
};

const deliveredObservation = {
  id: 'D-exact',
  target: 'main',
  candidate_fingerprint: candidate.fingerprint,
  target_snapshot: { oid: target.snapshot.oid },
  outcome: 'delivered',
  proof: {
    method: 'git-commit-contained',
    candidate_commit: candidate.subject.commit_oid,
    target_oid: target.snapshot.oid,
  },
  checked_at: '2026-07-14T01:02:00Z',
};

function declaredBoard(
  requirement: Record<string, unknown> | undefined,
  upstream: Record<string, unknown> = done('U', {
    delivery: {
      schema: 'ccm/task-delivery/v1',
      candidate,
      observations: [deliveredObservation],
    },
  }),
) {
  const downstream: Record<string, unknown> = { id: 'D', status: 'blocked', deps: ['U'] };
  if (requirement) downstream.dependency_requirements = { U: requirement };
  return baseBoard([upstream, downstream], {
    delivery_contract: {
      schema: 'ccm/delivery-contract/v1',
      mode: 'declared',
      targets: { main: target },
    },
  });
}

test('legacy boards and undeclared declared-mode edges preserve dependencySatisfied exactly', () => {
  const bareDone = { id: 'U', status: 'done', deps: [] };
  const legacy = baseBoard([bareDone, { id: 'D', status: 'ready', deps: ['U'] }]);
  assert.deepEqual(dependencyQualified(legacy, 'D', 'U'), {
    state: 'qualified',
    basis: 'legacy',
    qualified_by: 'legacy',
    candidate_complete: false,
    reasons: [],
  });
  assert.deepEqual(analyzeGraph(legacy).readySet(), ['D']);

  const declared = declaredBoard(undefined, bareDone);
  declared.tasks[1].status = 'ready';
  assert.equal(dependencyQualified(declared, 'D', 'U').state, 'qualified');
  assert.equal(dependencyQualified(declared, 'D', 'U').basis, 'legacy');
  assert.deepEqual(analyzeGraph(declared).readySet(), ['D']);
});

test('explicit candidate requirement requires true-done and review APPROVE', () => {
  const bareDone = { id: 'U', status: 'done', deps: [] };
  assert.equal(
    dependencyQualified(declaredBoard({ level: 'candidate' }, bareDone), 'D', 'U').state,
    'unqualified',
  );

  const rejected = done('U', {
    dependency_gate: { kind: 'review', required_verdict: 'APPROVE' },
    review_verdict: 'REQUEST-CHANGES',
  });
  const rejectResult = dependencyQualified(
    declaredBoard({ level: 'candidate' }, rejected),
    'D',
    'U',
  );
  assert.equal(rejectResult.state, 'unqualified');
  assert.equal(rejectResult.reasons[0]?.code, 'DELIVERY_REVIEW_REJECTED');

  const approved = { ...rejected, review_verdict: 'APPROVE' };
  assert.equal(
    dependencyQualified(declaredBoard({ level: 'candidate' }, approved), 'D', 'U').state,
    'qualified',
  );
});

test('delivered requirement distinguishes delivered, negative, target drift, and missing object facts', () => {
  const board = declaredBoard({ level: 'delivered', target: 'main' });
  const exact = dependencyQualified(board, 'D', 'U');
  assert.equal(exact.state, 'qualified');
  assert.equal(exact.basis, 'delivery');
  assert.equal(exact.target_delivered, true);

  const negative = structuredClone(board);
  negative.tasks[0].delivery.observations.push({
    ...deliveredObservation,
    id: 'D-negative',
    outcome: 'not-delivered',
    checked_at: '2026-07-14T01:03:00Z',
  });
  const notDelivered = targetDelivered(negative, negative.tasks[0], 'main');
  assert.equal(notDelivered.state, 'unqualified');
  assert.equal(notDelivered.reasons[0]?.code, 'DELIVERY_COMMIT_NOT_CONTAINED');

  const drift = dependencyQualified(board, 'D', 'U', {
    targets: { main: { state: 'drift', resolved_snapshot: { oid: 'd'.repeat(40) } } },
  });
  assert.equal(drift.state, 'unknown');
  assert.equal(drift.reasons[0]?.code, 'DELIVERY_TARGET_REF_DRIFT');

  const missing = dependencyQualified(board, 'D', 'U', {
    targets: { main: { state: 'unknown', reason: 'DELIVERY_CANDIDATE_OBJECT_UNAVAILABLE' } },
  });
  assert.equal(missing.state, 'unknown');
  assert.equal(missing.reasons[0]?.code, 'DELIVERY_CANDIDATE_OBJECT_UNAVAILABLE');
});

test('strict preview fails closed on missing requirement without mutating or enabling strict mode', () => {
  const board = declaredBoard(undefined);
  const before = JSON.stringify(board);
  const result = dependencyQualified(board, 'D', 'U', { strict_preview: true });
  assert.equal(result.state, 'unknown');
  assert.equal(result.reasons[0]?.code, 'DEPENDENCY_REQUIREMENT_MISSING');
  assert.equal(JSON.stringify(board), before);
  assert.equal(board.delivery_contract.mode, 'declared');
});

test('waiver is user-authorized, exact-edge scoped, expiring, and never delivered', () => {
  const waiver = {
    level: 'delivered',
    target: 'main',
    waiver_record: {
      id: 'W1',
      authorized_by: 'user',
      authorized_at: '2026-07-14T01:00:00Z',
      reason: 'manual receiver acceptance',
      expires_at: '2026-07-15T01:00:00Z',
      target: 'main',
      downstream: 'D',
      dependency: 'U',
    },
  };
  const board = declaredBoard(waiver, done('U'));
  const live = dependencyQualified(board, 'D', 'U', { now: '2026-07-14T12:00:00Z' });
  assert.equal(live.state, 'qualified');
  assert.equal(live.basis, 'waiver');
  assert.equal(live.qualified_by, 'waiver');
  assert.equal(live.target_delivered, false);

  const expired = dependencyQualified(board, 'D', 'U', { now: '2026-07-16T00:00:00Z' });
  assert.equal(expired.state, 'unqualified');
  assert.equal(expired.reasons[0]?.code, 'DELIVERY_WAIVER_EXPIRED');

  const wrongScope = structuredClone(board);
  wrongScope.tasks[1].dependency_requirements.U.waiver_record.downstream = 'OTHER';
  assert.equal(dependencyQualified(wrongScope, 'D', 'U').reasons[0]?.code, 'DELIVERY_WAIVER_SCOPE');

  const wrongAuthority = structuredClone(board);
  wrongAuthority.tasks[1].dependency_requirements.U.waiver_record.authorized_by = 'agent';
  assert.equal(
    dependencyQualified(wrongAuthority, 'D', 'U').reasons[0]?.code,
    'DELIVERY_WAIVER_AUTHORITY',
  );
});

test('graph and reconcile share the evaluator for stranded and delivered fixtures', () => {
  const stranded = declaredBoard({ level: 'delivered', target: 'main' }, done('U'));
  assert.deepEqual(analyzeGraph(stranded).readySet(), []);
  assert.equal(reconcileGating(stranded).tasks[1].status, 'blocked');

  const delivered = declaredBoard({ level: 'delivered', target: 'main' });
  assert.deepEqual(
    analyzeGraph({
      ...delivered,
      tasks: [delivered.tasks[0], { ...delivered.tasks[1], status: 'ready' }],
    }).readySet(),
    ['D'],
  );
  assert.equal(reconcileGating(delivered).tasks[1].status, 'ready');
});

test('native/supervisor stranded fixtures and exact/contract-only/hardened scopes stay distinct', () => {
  const deliveryFor = (id: string, proof: Record<string, unknown> | null) => {
    const subject = {
      kind: 'git-commit',
      commit_oid: id.charCodeAt(0).toString(16).padStart(2, '0').repeat(20),
    };
    const boundCandidate = {
      fingerprint: candidateFingerprint(
        id,
        '2026-07-14T01:00:00Z',
        `/artifacts/${id}.json`,
        subject,
      ),
      bound_finished_at: '2026-07-14T01:00:00Z',
      bound_artifact: `/artifacts/${id}.json`,
      subject,
    };
    return {
      schema: 'ccm/task-delivery/v1',
      candidate: boundCandidate,
      observations: proof
        ? [
            {
              id: `${id}-main`,
              target: 'main',
              candidate_fingerprint: boundCandidate.fingerprint,
              target_snapshot: { oid: target.snapshot.oid },
              outcome: 'delivered',
              proof,
              checked_at: '2026-07-14T01:02:00Z',
            },
          ]
        : [],
    };
  };
  const exactDelivery = deliveryFor('E', {
    method: 'git-commit-contained',
    candidate_commit: '45'.repeat(20),
    target_oid: target.snapshot.oid,
  });
  const hardenedDelivery = deliveryFor('H', {
    method: 'reviewed-reconciliation-contained',
    integration_commit: 'f'.repeat(40),
    reviewed_base_oid: 'e'.repeat(40),
    target_oid: target.snapshot.oid,
    attestation_digest: `sha256:${'d'.repeat(64)}`,
    attestation_ref: '/abs/review-attestation.json',
  });
  const board = baseBoard(
    [
      done('NATIVE'),
      done('SUPERVISOR'),
      done('E', { delivery: exactDelivery }),
      done('C', { delivery: deliveryFor('C', null) }),
      done('H', { delivery: hardenedDelivery }),
      {
        id: 'DN',
        status: 'ready',
        deps: ['NATIVE'],
        dependency_requirements: { NATIVE: { level: 'delivered', target: 'main' } },
      },
      {
        id: 'DS',
        status: 'ready',
        deps: ['SUPERVISOR'],
        dependency_requirements: { SUPERVISOR: { level: 'delivered', target: 'main' } },
      },
      {
        id: 'DE',
        status: 'ready',
        deps: ['E'],
        dependency_requirements: { E: { level: 'delivered', target: 'main' } },
      },
      {
        id: 'DC',
        status: 'ready',
        deps: ['C'],
        dependency_requirements: { C: { level: 'candidate' } },
      },
      {
        id: 'DH',
        status: 'ready',
        deps: ['H'],
        dependency_requirements: { H: { level: 'delivered', target: 'main' } },
      },
      {
        id: 'DX',
        status: 'ready',
        deps: ['E'],
        dependency_requirements: { E: { level: 'delivered', target: 'release' } },
      },
    ],
    {
      delivery_contract: {
        schema: 'ccm/delivery-contract/v1',
        mode: 'declared',
        targets: {
          main: target,
          release: {
            ...target,
            ref: 'refs/remotes/origin/release',
            snapshot: { oid: '9'.repeat(40), observed_at: '2026-07-14T01:01:00Z' },
          },
        },
      },
    },
  );

  assert.deepEqual(analyzeGraph(board).readySet(), ['DE', 'DC', 'DH']);
  assert.equal(dependencyQualified(board, 'DN', 'NATIVE').state, 'unknown');
  assert.equal(dependencyQualified(board, 'DS', 'SUPERVISOR').state, 'unknown');
  assert.equal(dependencyQualified(board, 'DE', 'E').qualified_by, 'delivery');
  assert.equal(dependencyQualified(board, 'DC', 'C').qualified_by, 'candidate');
  assert.equal(dependencyQualified(board, 'DH', 'H').qualified_by, 'delivery');
  assert.equal(dependencyQualified(board, 'DX', 'E').state, 'unknown');
  assert.deepEqual(
    reconcileGating(board)
      .tasks.slice(5)
      .map((task) => task.status),
    ['blocked', 'blocked', 'ready', 'ready', 'ready', 'blocked'],
  );

  const relativeAttestation = structuredClone(board);
  relativeAttestation.tasks[4].delivery.observations[0].proof.attestation_ref = 'review.json';
  assert.ok(
    validateDeliveryContracts(relativeAttestation).some(
      (diagnostic) => diagnostic.code === 'FMT-TASK-DELIVERY',
    ),
    'review evidence must retain a stable absolute local attestation reference',
  );
});

test('contract validation rejects malformed, strict persistence, stale keys, and size caps without hidden DAG semantics', () => {
  const malformed = declaredBoard({ level: 'delivered', target: 'missing' });
  malformed.delivery_contract.mode = 'strict';
  malformed.tasks[1].dependency_requirements.STALE = { level: 'candidate' };
  const diagnostics = validateDeliveryContracts(malformed);
  const codes = new Set(diagnostics.map((d) => d.code));
  assert.ok(codes.has('FMT-DELIVERY-CONTRACT'));
  assert.ok(codes.has('BIZ-DEPENDENCY-REQUIREMENT'));
  const lint = lintBoard(JSON.stringify(malformed));
  assert.ok(lint.errors.some((entry) => entry.rule === 'FMT-DELIVERY-CONTRACT'));
  assert.ok(lint.warnings.some((entry) => entry.rule === 'BIZ-DEPENDENCY-REQUIREMENT'));

  const tooManyTargets = declaredBoard({ level: 'candidate' });
  tooManyTargets.delivery_contract.targets = Object.fromEntries(
    Array.from({ length: 65 }, (_, i) => [`t${i}`, target]),
  );
  assert.ok(validateDeliveryContracts(tooManyTargets).some((d) => d.code === 'DELIVERY_SIZE_CAP'));
  assert.ok(
    lintBoard(JSON.stringify(tooManyTargets)).errors.some(
      (entry) => entry.rule === 'DELIVERY_SIZE_CAP',
    ),
  );

  const tooManyObservations = declaredBoard({ level: 'delivered', target: 'main' });
  tooManyObservations.tasks[0].delivery.observations = Array.from({ length: 129 }, (_, index) => ({
    ...deliveredObservation,
    id: `obs-${index}`,
  }));
  assert.ok(
    validateDeliveryContracts(tooManyObservations).some((d) => d.code === 'DELIVERY_SIZE_CAP'),
  );

  const tooManyRequirements = declaredBoard({ level: 'candidate' });
  tooManyRequirements.tasks[1].dependency_requirements = Object.fromEntries(
    Array.from({ length: 257 }, (_, index) => [`edge-${index}`, { level: 'candidate' }]),
  );
  assert.ok(
    validateDeliveryContracts(tooManyRequirements).some((d) => d.code === 'DELIVERY_SIZE_CAP'),
  );

  const cycle = declaredBoard({ level: 'candidate' });
  cycle.tasks[0].deps = ['D'];
  assert.ok(
    analyzeGraph(cycle).cycle(),
    'delivery metadata does not create or hide dependency cycles',
  );

  const counterfeit = declaredBoard({ level: 'delivered', target: 'main', qualified: true });
  counterfeit.tasks[0].delivery.observations[0].proof.candidate_commit = 'd'.repeat(40);
  const counterfeitLint = lintBoard(JSON.stringify(counterfeit));
  assert.ok(
    counterfeitLint.errors.filter((entry) => entry.rule === 'FMT-TASK-DELIVERY').length > 0,
    'a delivered observation cannot sever immutable candidate/target bindings',
  );
  assert.ok(
    counterfeitLint.errors.some((entry) => entry.rule === 'FMT-DEPENDENCY-REQUIREMENTS'),
    'qualification remains derived rather than a persisted boolean',
  );

  const impact = declaredBoard({ level: 'delivered', target: 'main' }, done('U'));
  impact.tasks[1].status = 'ready';
  const impactLint = lintBoard(JSON.stringify(impact));
  assert.ok(impactLint.warnings.some((entry) => entry.rule === 'BIZ-DELIVERY-PROOF'));
  assert.ok(impactLint.warnings.some((entry) => entry.rule === 'BIZ-DELIVERY-IMPACT'));
});

test('contract validation recomputes the candidate fingerprint from its immutable binding', () => {
  const board = declaredBoard({ level: 'delivered', target: 'main' });
  board.tasks[0].delivery.candidate.fingerprint = `sha256:${'f'.repeat(64)}`;
  board.tasks[0].delivery.observations[0].candidate_fingerprint = `sha256:${'f'.repeat(64)}`;
  const diagnostics = validateDeliveryContracts(board);
  assert.ok(
    diagnostics.some((entry) => entry.code === 'BIZ-DELIVERY-CANDIDATE-BINDING'),
    'shape-valid but counterfeit candidate fingerprints must be rejected',
  );
});
