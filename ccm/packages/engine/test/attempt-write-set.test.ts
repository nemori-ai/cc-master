import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as writeSetEngine from '../dist/index.mjs';
import {
  ATTEMPT_WRITE_SET,
  ATTEMPT_WRITE_SET_REQUEST,
  compileAttemptWriteSet,
  MANAGED_WRITE_PROFILES,
  permissionSnapshotSatisfies,
  REQUIRED_ATTEMPT_DENIES,
  UNDECLARED_PATH_DENY,
  WORKTREE_WRITE_LEASE,
  type WriteSetPlan,
  type WriteSetRequest,
} from '../dist/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(join(HERE, 'fixtures', 'attempt-write-set', 'linked-worktree-v1.json'), 'utf8'),
  // biome-ignore lint/suspicious/noExplicitAny: executable contract fixture is intentionally untyped input.
) as any;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function baseRequest(): WriteSetRequest {
  return clone(FIXTURE.base_request) as WriteSetRequest;
}

// biome-ignore lint/suspicious/noExplicitAny: JSON-pointer mutation applies frozen fixture rows.
function setPointer(target: any, mutation: any): void {
  const parts = String(mutation.path).split('/').slice(1);
  const key = parts.pop();
  let parent = target;
  for (const part of parts) parent = parent[part];
  if (mutation.op === 'add' && key === '-') {
    parent.push(clone(mutation.value));
  } else if (mutation.op === 'remove') {
    delete parent[key];
  } else {
    parent[key] = clone(mutation.value);
  }
}

function issueCodes(plan: WriteSetPlan): string[] {
  return plan.issues.map((entry) => entry.code);
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, `mutable plan node: ${JSON.stringify(value)}`);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

test('fixture freezes lease/request/plan shapes and unique negative cases', () => {
  assert.equal(FIXTURE.schema, 'ccm/attempt-write-set-fixture/v1');
  assert.equal(FIXTURE.contract, ATTEMPT_WRITE_SET);
  assert.equal(FIXTURE.base_request.schema, ATTEMPT_WRITE_SET_REQUEST);
  assert.equal(FIXTURE.base_request.lease.schema, WORKTREE_WRITE_LEASE);
  assert.equal(
    new Set(FIXTURE.negative_cases.map((row: { id: string }) => row.id)).size,
    FIXTURE.negative_cases.length,
  );
});

test('managed profiles have one effective native profile and the complete immutable deny floor', () => {
  for (const id of FIXTURE.positive_profiles) {
    const profile = MANAGED_WRITE_PROFILES[id];
    assert.ok(profile, `missing ${id}`);
    assert.equal(profile.effective_profile, 'workspace-write');
    assert.equal(profile.runtime_status, 'fixture-only');
    for (const deny of REQUIRED_ATTEMPT_DENIES)
      assert.ok(profile.denies.includes(deny), `${id}: ${deny}`);
  }
});

test('exported deny/profile views cannot weaken the internal closed deny floor at runtime', () => {
  const required = REQUIRED_ATTEMPT_DENIES as unknown as string[];
  const profiles = MANAGED_WRITE_PROFILES as unknown as Record<string, Record<string, unknown>>;
  const codex = profiles['codex-managed-workspace'];
  assert.ok(codex);
  assert.throws(() => required.pop(), TypeError);
  assert.throws(() => (codex.denies as string[]).pop(), TypeError);
  assert.throws(() => {
    codex.adapter = 'attacker/weakened';
  }, TypeError);
  assert.throws(() => {
    profiles['codex-managed-workspace'] = {};
  }, TypeError);

  for (const profile of FIXTURE.positive_profiles) {
    const request = baseRequest();
    request.profile = profile;
    const plan = compileAttemptWriteSet(request);
    assert.equal(plan.ok, true, `${profile}: ${JSON.stringify(plan.issues)}`);
    assert.deepEqual(
      plan.permission_snapshot.denies,
      [...REQUIRED_ATTEMPT_DENIES, UNDECLARED_PATH_DENY],
      `${profile}: runtime mutation changed the compiled deny floor`,
    );
  }
});

test('compiled authorization plans are deeply immutable and isolated at runtime', () => {
  const request = baseRequest();
  const plan = compileAttemptWriteSet(request);
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  assert.equal(Object.isFrozen(request), false, 'compiler must not freeze caller input');
  assert.equal(
    Object.isFrozen(request.lease),
    false,
    'compiler must not freeze nested caller input',
  );
  const before = clone(plan);
  const mutable = plan as unknown as {
    authorized: Array<Record<string, unknown>>;
    profile_plan: {
      denies: string[];
      writable_roots: string[];
    };
    permission_snapshot: {
      denies: string[];
      writable_roots: string[];
    };
    issues: Array<Record<string, unknown>>;
  };
  const mutableRoot = plan as unknown as { profile_plan: Record<string, unknown> };

  assertDeepFrozen(plan);
  assert.throws(() => mutable.profile_plan.denies.pop(), TypeError);
  assert.throws(() => mutable.permission_snapshot.denies.splice(0), TypeError);
  assert.throws(() => {
    mutable.permission_snapshot.denies[0] = 'attacker-weakened';
  }, TypeError);
  assert.throws(
    () =>
      mutable.authorized.push({
        path: '/repo/.git',
        mode: 'read-write',
        scope: 'tree',
        reason: 'declared-artifact-root',
      }),
    TypeError,
  );
  assert.throws(() => mutable.profile_plan.writable_roots.push('/repo/.git'), TypeError);
  assert.throws(() => mutable.permission_snapshot.writable_roots.push('/repo/.git'), TypeError);
  assert.throws(() => {
    mutable.authorized[0]!.path = '/repo/.git';
  }, TypeError);
  assert.throws(() => {
    mutableRoot.profile_plan = {};
  }, TypeError);
  assert.throws(() => mutable.issues.push({ code: 'attacker' }), TypeError);
  assert.deepEqual(plan, before, 'mutation attempts changed the compiled plan');

  const fresh = compileAttemptWriteSet(baseRequest());
  assert.notStrictEqual(fresh, plan);
  assert.deepEqual(fresh, before, 'one plan mutation attempt contaminated a later compilation');

  const refused = compileAttemptWriteSet(null);
  assertDeepFrozen(refused);
  const refusedMutable = refused as unknown as {
    profile_plan: { denies: string[] };
    issues: Array<Record<string, unknown>>;
  };
  assert.throws(() => refusedMutable.profile_plan.denies.pop(), TypeError);
  assert.throws(() => refusedMutable.issues.push({ code: 'attacker' }), TypeError);
});

test('read-only preparation rejects every structural negative before returning probe roots', () => {
  const prepare = (writeSetEngine as Record<string, unknown>).prepareAttemptWriteSetProbe;
  assert.equal(
    typeof prepare,
    'function',
    'engine must expose a pure structural gate before filesystem writability probes',
  );

  const rows: Array<{ id: string; mutate: (request: WriteSetRequest) => void; issue: string }> = [
    {
      id: 'main-worktree',
      mutate: (request) => {
        request.git_layout.kind = 'main-worktree';
      },
      issue: 'WRITESET-WORKTREE-NOT-ISOLATED',
    },
    {
      id: 'undeclared-artifact',
      mutate: (request) => {
        request.declared_artifact_roots[0]!.path = '/repo/undeclared';
      },
      issue: 'WRITESET-ARTIFACT-OUTSIDE-LEASE',
    },
    {
      id: 'artifact-symlink',
      mutate: (request) => {
        request.declared_artifact_roots[0]!.resolution = 'symlink';
      },
      issue: 'WRITESET-ARTIFACT-ROOT-SYMLINK',
    },
  ];
  for (const row of rows) {
    const request = baseRequest();
    request.writability = [];
    row.mutate(request);
    const preparation = (
      prepare as (input: unknown) => {
        ok: boolean;
        probe_roots: string[];
        issues: Array<{ code: string }>;
      }
    )(request);
    assert.equal(preparation.ok, false, `${row.id}: unexpectedly probe-ready`);
    assert.deepEqual(preparation.probe_roots, [], `${row.id}: leaked probe roots`);
    assert.ok(
      preparation.issues.some((entry) => entry.code === row.issue),
      `${row.id}: ${JSON.stringify(preparation.issues)}`,
    );
  }
});

test('resolved isolated linked worktree compiles the minimal roots and is never launch-ready by itself', () => {
  const request = baseRequest();
  const before = clone(request);
  const plan = compileAttemptWriteSet(request);
  assert.deepEqual(request, before, 'compiler mutated its input');
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  assert.equal(plan.launch_ready, false);
  assert.equal(plan.integration_status, 'preflight-only-dispatcher-missing');
  assert.deepEqual(plan.authorized, FIXTURE.expected_authorized);
  assert.equal(
    plan.authorized.some((root) => root.path === '/repo/.git'),
    false,
    'common .git root must not be granted',
  );
  assert.deepEqual(
    plan.profile_plan.writable_roots,
    plan.authorized.filter((root) => root.mode === 'read-write').map((root) => root.path),
  );
  assert.equal(
    permissionSnapshotSatisfies(
      plan.permission_snapshot,
      FIXTURE.native_attempt_candidate_permission,
    ),
    true,
  );
});

test('Codex and Claude managed mappings compile identical roots without weakening denies', () => {
  const serialized = new Set<string>();
  for (const profile of FIXTURE.positive_profiles) {
    const request = baseRequest();
    request.profile = profile;
    const plan = compileAttemptWriteSet(request);
    assert.equal(plan.ok, true, `${profile}: ${JSON.stringify(plan.issues)}`);
    serialized.add(JSON.stringify(plan.authorized));
    assert.equal(plan.permission_snapshot.profile, 'workspace-write');
    for (const deny of [...REQUIRED_ATTEMPT_DENIES, UNDECLARED_PATH_DENY]) {
      assert.ok(plan.permission_snapshot.denies.includes(deny), `${profile}: ${deny}`);
    }
  }
  assert.equal(serialized.size, 1);
});

test('equal, child, and ancestor artifact overlap with common Git metadata fail closed', () => {
  for (const artifactPath of ['/repo/.git', '/repo/.git/hooks', '/repo']) {
    const request = baseRequest();
    request.lease.artifact_write_roots = [artifactPath];
    request.declared_artifact_roots = [
      { path: artifactPath, mode: 'read-write', resolution: 'resolved' },
    ];
    request.writability = [
      ...request.writability.filter((fact) => fact.path !== '/repo/design_docs/plans'),
      { path: artifactPath, writable: true },
    ];
    const plan = compileAttemptWriteSet(request);
    assert.equal(plan.ok, false, `${artifactPath}: unexpectedly accepted`);
    assert.deepEqual(plan.authorized, [], `${artifactPath}: leaked authorization`);
    assert.ok(
      issueCodes(plan).includes('WRITESET-ARTIFACT-GIT-METADATA'),
      `${artifactPath}: ${JSON.stringify(plan.issues)}`,
    );
    if (artifactPath === '/repo') {
      assert.deepEqual(
        plan.issues
          .filter((entry) => entry.code === 'WRITESET-ARTIFACT-GIT-METADATA')
          .map((entry) => entry.path)
          .sort(),
        ['declared_artifact_roots[0].path', 'lease.artifact_write_roots[0]'],
        'common Git ancestor must be rejected independently at lease and declared-root boundaries',
      );
    }
  }
});

test('worktree ancestor cannot authorize sibling worktrees through either boundary guard', () => {
  const request = baseRequest();
  const boundary = '/repo/.worktrees';
  request.lease.artifact_write_roots = [boundary];
  request.declared_artifact_roots = [
    { path: boundary, mode: 'read-write', resolution: 'resolved' },
  ];
  request.writability = [
    ...request.writability.filter((fact) => fact.path !== '/repo/design_docs/plans'),
    { path: boundary, writable: true },
  ];
  request.requested_writes = ['/repo/.worktrees/sibling-worktree/file'];

  const plan = compileAttemptWriteSet(request);
  assert.equal(plan.ok, false, JSON.stringify(plan.issues));
  assert.deepEqual(plan.authorized, []);
  assert.deepEqual(
    plan.issues
      .filter((entry) => entry.code === 'WRITESET-ARTIFACT-WORKTREE-BOUNDARY')
      .map((entry) => entry.path)
      .sort(),
    ['declared_artifact_roots[0].path', 'lease.artifact_write_roots[0]'],
    'lease and declared-root guards must each reject the sibling-worktree widening',
  );
});

test('duplicate, nested, and read/write-conflicting lease grants fail closed', () => {
  const rows: Array<{ id: string; mutate: (request: WriteSetRequest) => void }> = [
    {
      id: 'duplicate-write-grant',
      mutate: (request) => {
        request.lease.artifact_write_roots.push(request.lease.artifact_write_roots[0]!);
      },
    },
    {
      id: 'nested-write-grant',
      mutate: (request) => {
        request.lease.artifact_write_roots.push('/repo/design_docs');
      },
    },
    {
      id: 'read-write-conflict',
      mutate: (request) => {
        request.lease.artifact_read_roots = ['/repo/design_docs/plans/input'];
      },
    },
  ];
  for (const row of rows) {
    const request = baseRequest();
    row.mutate(request);
    const plan = compileAttemptWriteSet(request);
    assert.equal(plan.ok, false, `${row.id}: unexpectedly accepted`);
    assert.deepEqual(plan.authorized, [], `${row.id}: leaked authorization`);
    assert.ok(issueCodes(plan).includes('WRITESET-LEASE'), JSON.stringify(plan.issues));
  }
});

test('every frozen negative fails closed, returns no usable roots, and preserves input', () => {
  for (const row of FIXTURE.negative_cases) {
    const request = baseRequest();
    setPointer(request, row.mutation);
    const before = clone(request);
    const plan = compileAttemptWriteSet(request);
    assert.deepEqual(request, before, `${row.id}: input changed`);
    assert.equal(plan.ok, false, `${row.id}: unexpectedly accepted`);
    assert.equal(plan.launch_ready, false, `${row.id}: launch-ready`);
    assert.deepEqual(plan.authorized, [], `${row.id}: refused plan leaked usable roots`);
    assert.ok(issueCodes(plan).includes(row.issue), `${row.id}: ${JSON.stringify(plan.issues)}`);
  }
});

test('bad top-level shapes fail with WRITESET-SHAPE and no authorization', () => {
  for (const bad of [null, undefined, 42, [], {}, { schema: 'other' }]) {
    const plan = compileAttemptWriteSet(bad);
    assert.equal(plan.ok, false);
    assert.deepEqual(plan.authorized, []);
    assert.ok(issueCodes(plan).includes('WRITESET-SHAPE'));
  }
});
