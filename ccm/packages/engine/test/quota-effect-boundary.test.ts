import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createQuotaEffectBoundary as createQuotaEffectBoundaryFromBarrel } from '../dist/index.mjs';
import {
  ACCOUNT_MUTATION_CAPABILITIES,
  createQuotaEffectBoundary,
  FORBIDDEN_QUOTA_EFFECT_CAPABILITIES,
  QUOTA_PRODUCTION_EFFECT_ALLOWLIST,
  QUOTA_TEST_EFFECT_ALLOWLIST,
  QuotaEffectError,
} from '../src/quota-effect-boundary.ts';

const PRODUCTION_ALLOWLIST = [
  'auth.observe',
  'quota.observe',
  'filesystem.quota.open',
  'filesystem.quota.read_file',
  'filesystem.quota.read_directory',
  'filesystem.quota.stat',
  'filesystem.quota.lstat',
  'filesystem.quota.make_directory',
  'filesystem.quota.rename',
  'filesystem.quota.unlink',
  'filesystem.quota.lock',
  'pinned.route.read',
  'pinned.runtime.read',
  'pinned.supervisor.read',
] as const;

const TEST_ONLY_ALLOWLIST = ['test.clock.now', 'test.random.id', 'test.trace.record'] as const;

function errorCode(run: () => unknown): string {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof QuotaEffectError);
  return caught.code;
}

test('quota effect policy is an exact frozen allowlist with test-only additions', () => {
  assert.equal(typeof createQuotaEffectBoundaryFromBarrel, 'function');
  assert.deepEqual(
    createQuotaEffectBoundaryFromBarrel({ allow: [], handlers: {} }).declaredCapabilities,
    [],
  );
  assert.deepEqual(QUOTA_PRODUCTION_EFFECT_ALLOWLIST, PRODUCTION_ALLOWLIST);
  assert.deepEqual(QUOTA_TEST_EFFECT_ALLOWLIST, [...PRODUCTION_ALLOWLIST, ...TEST_ONLY_ALLOWLIST]);
  assert.equal(Object.isFrozen(QUOTA_PRODUCTION_EFFECT_ALLOWLIST), true);
  assert.equal(Object.isFrozen(QUOTA_TEST_EFFECT_ALLOWLIST), true);
  assert.equal(Object.isFrozen(FORBIDDEN_QUOTA_EFFECT_CAPABILITIES), true);
  assert.equal(Object.isFrozen(ACCOUNT_MUTATION_CAPABILITIES), true);
});

test('boundary copies and freezes declarations and handlers before executing distinct observations', () => {
  const calls = { auth: 0, quota: 0 };
  const allow: string[] = ['auth.observe', 'quota.observe'];
  const handlers: Record<string, (input: Readonly<Record<string, unknown>>) => unknown> = {
    'auth.observe': (input) => {
      calls.auth += 1;
      return { kind: 'auth', surface: input.surface };
    },
    'quota.observe': (input) => {
      calls.quota += 1;
      return { kind: 'quota', source: input.source };
    },
  };
  const boundary = createQuotaEffectBoundary({ allow, handlers });

  allow.push('filesystem.quota.open');
  handlers['auth.observe'] = () => ({ kind: 'counterfeit' });

  assert.equal(Object.isFrozen(boundary), true);
  assert.equal(Object.isFrozen(boundary.declaredCapabilities), true);
  assert.deepEqual(boundary.declaredCapabilities, ['auth.observe', 'quota.observe']);
  assert.deepEqual(boundary.execute('auth.observe', { surface: 'codex' }), {
    kind: 'auth',
    surface: 'codex',
  });
  assert.deepEqual(boundary.execute('quota.observe', { source: 'weekly' }), {
    kind: 'quota',
    source: 'weekly',
  });
  assert.deepEqual(calls, { auth: 1, quota: 1 });
  assert.equal(
    errorCode(() => boundary.execute('filesystem.quota.open', {})),
    'QUOTA_CAPABILITY_UNDECLARED',
  );
});

test('allowed-but-unbound, undeclared, unknown, and forbidden capabilities fail before a handler runs', () => {
  let handlerCalls = 0;
  const boundary = createQuotaEffectBoundary({
    allow: ['auth.observe', 'quota.observe'],
    handlers: {
      'auth.observe': () => {
        handlerCalls += 1;
        return { authenticated: true };
      },
    },
  });

  assert.equal(
    errorCode(() => boundary.execute('quota.observe', {})),
    'QUOTA_CAPABILITY_UNAVAILABLE',
  );
  assert.equal(
    errorCode(() => boundary.execute('filesystem.quota.read_file', {})),
    'QUOTA_CAPABILITY_UNDECLARED',
  );
  assert.equal(
    errorCode(() => boundary.execute('future.magic', {})),
    'QUOTA_EFFECT_FORBIDDEN',
  );
  assert.equal(
    errorCode(() => boundary.execute('process.spawn', {})),
    'QUOTA_EFFECT_FORBIDDEN',
  );
  assert.equal(
    errorCode(() => boundary.assertCapabilities(['auth.observe', 'quota.observe'])),
    'QUOTA_CAPABILITY_UNAVAILABLE',
  );
  assert.equal(
    errorCode(() => boundary.assertCapabilities(['auth.observe', 'filesystem.quota.stat'])),
    'QUOTA_CAPABILITY_UNDECLARED',
  );
  assert.equal(handlerCalls, 0);
});

test('test operations require the test profile and remain explicitly declared', () => {
  assert.equal(
    errorCode(() =>
      createQuotaEffectBoundary({
        profile: 'counterfeit' as 'production',
        allow: [],
        handlers: {},
      }),
    ),
    'QUOTA_EFFECT_FORBIDDEN',
  );
  assert.equal(
    errorCode(() =>
      createQuotaEffectBoundary({
        profile: 'production',
        allow: ['test.clock.now'],
        handlers: { 'test.clock.now': () => 1_700_000_000_000 },
      }),
    ),
    'QUOTA_EFFECT_FORBIDDEN',
  );

  const boundary = createQuotaEffectBoundary({
    profile: 'test',
    allow: ['test.clock.now'],
    handlers: { 'test.clock.now': () => 1_700_000_000_000 },
  });
  assert.equal(boundary.execute('test.clock.now', {}), 1_700_000_000_000);
  assert.equal(
    errorCode(() => boundary.execute('test.random.id', {})),
    'QUOTA_CAPABILITY_UNDECLARED',
  );
});

test('quota filesystem capabilities are rooted and cannot be relabelled board, repo, or credential writes', () => {
  const calls: string[] = [];
  const boundary = createQuotaEffectBoundary({
    allow: ['filesystem.quota.open', 'filesystem.quota.rename'],
    quotaRoot: '/test-owned/home/quota/v1',
    handlers: {
      'filesystem.quota.open': (input) => {
        calls.push(String(input.path));
        return 'opened';
      },
      'filesystem.quota.rename': (input) => {
        calls.push(`${String(input.from)} -> ${String(input.to)}`);
        return 'renamed';
      },
    },
  });

  assert.equal(
    boundary.execute('filesystem.quota.open', {
      path: '/test-owned/home/quota/v1/observations/current.json',
      flags: 'r',
    }),
    'opened',
  );
  assert.equal(
    boundary.execute('filesystem.quota.rename', {
      from: '/test-owned/home/quota/v1/observations/.current.tmp-1',
      to: '/test-owned/home/quota/v1/observations/current.json',
    }),
    'renamed',
  );

  for (const path of [
    '/test-owned/home/boards/live.board.json',
    '/test-owned/repo/.git/config',
    '/test-owned/.codex/auth.json',
    '/test-owned/home/quota/v1-counterfeit/file',
  ]) {
    assert.equal(
      errorCode(() => boundary.execute('filesystem.quota.open', { path, flags: 'w' })),
      'QUOTA_EFFECT_FORBIDDEN',
    );
  }
  assert.equal(
    errorCode(() =>
      boundary.execute('filesystem.quota.rename', {
        from: '/test-owned/home/quota/v1/observations/current.json',
        to: '/test-owned/repo/stolen.json',
      }),
    ),
    'QUOTA_EFFECT_FORBIDDEN',
  );
  assert.equal(calls.length, 2);
});

test('every direct-effect escape class and account mutation is denied with zero executable calls', () => {
  const boundary = createQuotaEffectBoundary({ allow: [], handlers: {} });
  const escapeClasses = [
    'process.spawn',
    'network.connect',
    'network.socket',
    'network.dns',
    'network.http',
    'provider.invoke',
    'provider.spawn',
    'model.invoke',
    'keychain.read',
    'keychain.write',
    'keychain.delete',
    'board.write',
    'task.done',
    'repo.write',
    'runtime.activate',
  ] as const;

  for (const capability of escapeClasses) {
    assert.ok(FORBIDDEN_QUOTA_EFFECT_CAPABILITIES.includes(capability));
    assert.equal(
      errorCode(() => boundary.execute(capability, {})),
      'QUOTA_EFFECT_FORBIDDEN',
    );
  }
  for (const capability of ACCOUNT_MUTATION_CAPABILITIES) {
    assert.equal(
      errorCode(() => boundary.execute(capability, {})),
      'ACCOUNT_MUTATION_FORBIDDEN',
    );
  }
});

test('forbidden or unknown counterfeit handlers are rejected with every effect spy still zero', () => {
  let calls = 0;
  const counterfeit = () => {
    calls += 1;
  };
  for (const capability of [...FORBIDDEN_QUOTA_EFFECT_CAPABILITIES, 'future.magic']) {
    const expected = ACCOUNT_MUTATION_CAPABILITIES.includes(
      capability as (typeof ACCOUNT_MUTATION_CAPABILITIES)[number],
    )
      ? 'ACCOUNT_MUTATION_FORBIDDEN'
      : 'QUOTA_EFFECT_FORBIDDEN';
    assert.equal(
      errorCode(() =>
        createQuotaEffectBoundary({
          allow: [capability],
          handlers: { [capability]: counterfeit },
        }),
      ),
      expected,
    );
  }
  assert.equal(calls, 0);
});
