import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createQuotaEffectBoundary } from '@ccm/engine';
import { runProduction } from '../src/production-run.js';
import { createQuotaAdmissionStore } from '../src/quota-admission-store.js';
import { REGISTRY, type Registry } from '../src/registry.js';
import { type RouterComposition, run, runWithComposition } from '../src/router.js';
import { COUNTERFEIT_API_ROWS } from './fixtures/quota-effect-hard-deny-v1/counterfeits.js';
import { SOURCE_MUTATION_PROBES } from './fixtures/quota-effect-hard-deny-v1/source-mutations.js';
import { GUARD_IMPLEMENTATION_ROWS } from './support/quota-effect-guard-implementation.js';
import {
  assertExactEffectRegistry,
  auditDeclaredQuotaSources,
  auditModuleGraph,
  findDirectEffectViolations,
  type QuotaEffectHardDenyRegistry,
} from './support/quota-effect-source-guard.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const REGISTRY_PATH = join(HERE, 'fixtures', 'quota-effect-hard-deny-v1', 'registry.json');
const CONTROLLED_HANDLER_PATH = join(
  HERE,
  'fixtures',
  'quota-effect-hard-deny-v1',
  'roots',
  'controlled-quota-handler.ts',
);
const EFFECT_REGISTRY = JSON.parse(
  readFileSync(REGISTRY_PATH, 'utf8'),
) as QuotaEffectHardDenyRegistry;
assertExactEffectRegistry(EFFECT_REGISTRY, GUARD_IMPLEMENTATION_ROWS, COUNTERFEIT_API_ROWS);
const DECLARED_SOURCE_AUDIT = auditDeclaredQuotaSources(
  REPO_ROOT,
  EFFECT_REGISTRY,
  GUARD_IMPLEMENTATION_ROWS,
);
const [{ createControlledQuotaHandler }, { controlledQuotaTrace, resetControlledQuotaTrace }] =
  await Promise.all([
    import('./fixtures/quota-effect-hard-deny-v1/roots/controlled-quota-handler.js'),
    import('./fixtures/quota-effect-hard-deny-v1/roots/controlled-quota-helper.js'),
  ]);

const CONTROLLED_REGISTRY: Registry = {
  quota: {
    controlled: {
      summary: 'test-owned quota boundary route',
      read: true,
      positionals: [],
      options: {
        capability: { type: 'string', required: true },
      },
      examples: [],
      handler: 'quota.controlled',
    },
  },
};

let routerSideEffectCalls = 0;

interface EffectInstruments {
  readonly handlers: Readonly<Record<string, () => void>>;
  readonly snapshot: () => Readonly<Record<string, number>>;
}

function createEffectInstruments(): EffectInstruments {
  const calls = Object.fromEntries(
    EFFECT_REGISTRY.effect_classes.map((effectClass) => [effectClass, 0]),
  ) as Record<string, number>;
  const handlers = Object.freeze(
    Object.fromEntries(
      EFFECT_REGISTRY.effect_classes.map((effectClass) => [
        effectClass,
        () => {
          calls[effectClass] = (calls[effectClass] ?? 0) + 1;
        },
      ]),
    ) as Record<string, () => void>,
  );
  return Object.freeze({
    handlers,
    snapshot: () => Object.freeze({ ...calls }),
  });
}

function assertNoEffectCalls(instruments: EffectInstruments): void {
  const calls = instruments.snapshot();
  assert.deepEqual(Object.keys(calls).sort(), [...EFFECT_REGISTRY.effect_classes].sort());
  assert.equal(
    new Set(Object.values(instruments.handlers)).size,
    EFFECT_REGISTRY.effect_classes.length,
    'each effect class must have an independent callback instrument',
  );
  for (const effectClass of EFFECT_REGISTRY.effect_classes) {
    assert.equal(calls[effectClass], 0, `unexpected ${effectClass} effect before controlled work`);
  }
}

function createControlledComposition(
  instruments: EffectInstruments,
  beforeControlledWork?: string,
): RouterComposition {
  return {
    registry: CONTROLLED_REGISTRY,
    aliases: {},
    nounAliases: {},
    defaultVerbs: {},
    handlers: {
      quota: createControlledQuotaHandler({
        effects: instruments.handlers,
        beforeControlledWork,
      }),
    },
    autoInstallStatusline: () => {
      routerSideEffectCalls += 1;
    },
  };
}

function routeControlled(
  capability: string,
  quotaEffects?: ReturnType<typeof createQuotaEffectBoundary>,
  beforeControlledWork?: string,
): { code: number; out: string[]; err: string[]; instruments: EffectInstruments } {
  const out: string[] = [];
  const err: string[] = [];
  const instruments = createEffectInstruments();
  const result = runWithComposition(
    ['quota', 'controlled', '--capability', capability],
    {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      env: {},
      quotaEffects,
    },
    createControlledComposition(instruments, beforeControlledWork),
  );
  assert.equal(typeof result, 'number');
  return { code: result as number, out, err, instruments };
}

test('versioned registry, implementation guards, and counterfeit APIs are exact and live', () => {
  for (const counterfeitRow of COUNTERFEIT_API_ROWS) {
    for (const probe of counterfeitRow.probes) {
      const violations = findDirectEffectViolations(
        probe.source,
        `counterfeit:${counterfeitRow.apiId}:${probe.id}`,
        GUARD_IMPLEMENTATION_ROWS,
      );
      assert.ok(
        violations.some((violation) => violation.apiId === counterfeitRow.apiId),
        `${counterfeitRow.apiId}/${probe.id} did not reach its implementation guard`,
      );
    }
  }
});

test('every declared ambient effect class has a default-suite direct source mutation kill', () => {
  const mutationClasses = SOURCE_MUTATION_PROBES.map((probe) => probe.effectClass);
  assert.equal(new Set(mutationClasses).size, mutationClasses.length);
  assert.deepEqual([...mutationClasses].sort(), [...EFFECT_REGISTRY.effect_classes].sort());

  const controlledSource = readFileSync(CONTROLLED_HANDLER_PATH, 'utf8');
  const insertionPoint = 'controlled(ctx: Ctx): number {';
  assert.match(controlledSource, new RegExp(insertionPoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const probe of SOURCE_MUTATION_PROBES) {
    const mutatedSource = controlledSource.replace(
      insertionPoint,
      `${insertionPoint}\n      if (false) { ${probe.source}; }`,
    );
    const violations = findDirectEffectViolations(
      mutatedSource,
      `controlled-source-mutation:${probe.effectClass}`,
      GUARD_IMPLEMENTATION_ROWS,
      'test',
    );
    assert.ok(
      violations.some((violation) => violation.effectClass === probe.effectClass),
      `ordinary focused source audit did not kill direct ${probe.effectClass} mutation`,
    );
    if (probe.effectClass === 'ambient-filesystem-io') {
      const productionViolations = findDirectEffectViolations(
        mutatedSource,
        `production-source-mutation:${probe.effectClass}`,
        GUARD_IMPLEMENTATION_ROWS,
        'production',
      );
      assert.equal(
        productionViolations.some((violation) => violation.effectClass === probe.effectClass),
        false,
        'test-only ambient filesystem deny must not outlaw the future production quota store port',
      );
    }
  }
});

test('controlled composition instruments are independently observable in the default suite', () => {
  for (const effectClass of EFFECT_REGISTRY.effect_classes) {
    resetControlledQuotaTrace();
    const calibrated = routeControlled(
      'future.magic',
      createQuotaEffectBoundary({ allow: [], handlers: {} }),
      effectClass,
    );
    assert.equal(calibrated.code, 1);
    assert.match(calibrated.err.join('\n'), /QUOTA_EFFECT_FORBIDDEN/);
    assert.deepEqual(controlledQuotaTrace(), { boundaryResultsConsumed: 0 });
    const calls = calibrated.instruments.snapshot();
    for (const candidate of EFFECT_REGISTRY.effect_classes) {
      assert.equal(
        calls[candidate],
        candidate === effectClass ? 1 : 0,
        `${effectClass} calibration must only reach its own composition instrument`,
      );
    }
    assert.equal(routerSideEffectCalls, 0);
  }
});

test('declared production/test roots are exact and every reachable module is transitively guarded', () => {
  const audit = DECLARED_SOURCE_AUDIT;
  assert.ok(audit.reachable.some((path) => path.endsWith('quota-effect-boundary.ts')));
  assert.ok(audit.reachable.some((path) => path.endsWith('controlled-quota-handler.ts')));
  assert.ok(
    audit.reachableByKind.production.some((path) => path.endsWith('quota-effect-boundary.ts')),
  );
  assert.ok(
    audit.reachableByKind.test.some((path) => path.endsWith('controlled-quota-handler.ts')),
  );
  assert.equal(
    audit.reachableByKind.production.some((path) => path.endsWith('controlled-quota-handler.ts')),
    false,
  );
  assert.equal(
    audit.reachableByKind.test.some((path) => path.endsWith('quota-effect-boundary.ts')),
    false,
  );
  assert.deepEqual(audit.honestAbsent, []);
  assert.equal(Object.hasOwn(REGISTRY, 'quota'), true, 'required quota handler must be current');

  const transitiveRoot = join(
    HERE,
    'fixtures',
    'quota-effect-hard-deny-v1',
    'calibration',
    'transitive-root.ts',
  );
  assert.throws(
    () => auditModuleGraph(REPO_ROOT, [transitiveRoot], GUARD_IMPLEMENTATION_ROWS),
    /transitive-helper\.ts:\d+: direct network-http escape/,
  );
  const dynamicRoot = join(
    HERE,
    'fixtures',
    'quota-effect-hard-deny-v1',
    'calibration',
    'dynamic-root.ts',
  );
  assert.throws(
    () => auditModuleGraph(REPO_ROOT, [dynamicRoot], GUARD_IMPLEMENTATION_ROWS),
    /dynamic-root\.ts:\d+: dynamic module specifier is not literal/,
  );

  const requiredMissing = structuredClone(EFFECT_REGISTRY);
  const absentRoot = requiredMissing.source_roots.find((root) => root.id === 'cli-quota-handler');
  assert.ok(absentRoot);
  absentRoot.path = absentRoot.path.replace('quota.ts', 'quota-missing.ts');
  assert.throws(
    () => auditDeclaredQuotaSources(REPO_ROOT, requiredMissing, GUARD_IMPLEMENTATION_ROWS),
    /required quota source root is missing:.*handlers\/quota-missing\.ts/,
  );
});

test('production/test source kinds cannot be swapped or satisfied through the opposite closure', () => {
  const invalidRootKind = structuredClone(EFFECT_REGISTRY);
  (invalidRootKind.source_roots[0] as { kind: string }).kind = 'fixture';
  assert.throws(
    () => auditDeclaredQuotaSources(REPO_ROOT, invalidRootKind, GUARD_IMPLEMENTATION_ROWS),
    /unknown quota source root kind: fixture/,
  );

  const invalidDomainKind = structuredClone(EFFECT_REGISTRY);
  (invalidDomainKind.source_domains[0] as { kind: string }).kind = 'fixture';
  assert.throws(
    () => auditDeclaredQuotaSources(REPO_ROOT, invalidDomainKind, GUARD_IMPLEMENTATION_ROWS),
    /unknown quota source domain kind: fixture/,
  );

  const swappedKinds = structuredClone(EFFECT_REGISTRY);
  const productionRoot = swappedKinds.source_roots.find(
    (root) => root.id === 'engine-effect-boundary',
  );
  const testRoot = swappedKinds.source_roots.find((root) => root.id === 'controlled-quota-handler');
  assert.ok(productionRoot);
  assert.ok(testRoot);
  productionRoot.kind = 'test';
  testRoot.kind = 'production';
  assert.throws(
    () => auditDeclaredQuotaSources(REPO_ROOT, swappedKinds, GUARD_IMPLEMENTATION_ROWS),
    /quota source root kind mismatch/,
  );

  const crossKindFixture = (
    productionRootPath: string,
    productionPattern: string,
    testRootPath: string,
    testPattern: string,
  ): QuotaEffectHardDenyRegistry => ({
    ...structuredClone(EFFECT_REGISTRY),
    source_roots: [
      {
        id: 'synthetic-production-root',
        kind: 'production',
        path: productionRootPath,
        state: 'required',
      },
      {
        id: 'synthetic-test-root',
        kind: 'test',
        path: testRootPath,
        state: 'required',
      },
    ],
    source_domains: [
      {
        kind: 'production',
        directory:
          'ccm/apps/cli/test/fixtures/quota-effect-hard-deny-v1/kind-calibration/production',
        file_pattern: productionPattern,
      },
      {
        kind: 'test',
        directory: 'ccm/apps/cli/test/fixtures/quota-effect-hard-deny-v1/kind-calibration/test',
        file_pattern: testPattern,
      },
    ],
  });

  assert.throws(
    () =>
      auditDeclaredQuotaSources(
        REPO_ROOT,
        crossKindFixture(
          'ccm/apps/cli/test/fixtures/quota-effect-hard-deny-v1/kind-calibration/production/root.ts',
          '^(?:root|domain-only)\\.ts$',
          'ccm/apps/cli/test/fixtures/quota-effect-hard-deny-v1/kind-calibration/test/reaches-production.ts',
          '^reaches-production\\.ts$',
        ),
        GUARD_IMPLEMENTATION_ROWS,
      ),
    /production quota source domain file .* is reachable only from test roots|test quota source closure reaches production domain file/,
  );

  assert.throws(
    () =>
      auditDeclaredQuotaSources(
        REPO_ROOT,
        crossKindFixture(
          'ccm/apps/cli/test/fixtures/quota-effect-hard-deny-v1/kind-calibration/production/reaches-test.ts',
          '^reaches-test\\.ts$',
          'ccm/apps/cli/test/fixtures/quota-effect-hard-deny-v1/kind-calibration/test/root.ts',
          '^(?:root|domain-only)\\.ts$',
        ),
        GUARD_IMPLEMENTATION_ROWS,
      ),
    /test quota source domain file .* is reachable only from production roots|production quota source closure reaches test domain file/,
  );
});

test('production quota status requires and consumes its injected filesystem boundary', async (t) => {
  const configDir = mkdtempSync(join(tmpdir(), 'ccm-quota-default-'));
  t.after(() => rmSync(configDir, { recursive: true, force: true }));
  const quotaHome = join(configDir, 'home');
  const out: string[] = [];
  const err: string[] = [];
  const missing = await run(['--home', quotaHome, 'quota', 'status', '--json'], {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    env: {
      CLAUDE_CONFIG_DIR: configDir,
      CCM_BIN: join(dirname(tmpdir()), 'ccm-quota-installed', 'ccm'),
    },
  });
  assert.equal(missing, 1);
  assert.match(err.join('\n'), /QUOTA_CAPABILITY_UNAVAILABLE/);
  assert.equal(out.length, 0);

  let statCalls = 0;
  const allowedOut: string[] = [];
  const allowedErr: string[] = [];
  const result = await run(['--home', quotaHome, 'quota', 'status', '--json'], {
    out: (line) => allowedOut.push(line),
    err: (line) => allowedErr.push(line),
    env: {
      CLAUDE_CONFIG_DIR: configDir,
      CCM_BIN: join(dirname(tmpdir()), 'ccm-quota-installed', 'ccm'),
    },
    quotaEffects: createQuotaEffectBoundary({
      allow: ['filesystem.quota.stat'],
      quotaRoot: join(quotaHome, 'quota', 'v1'),
      handlers: {
        'filesystem.quota.stat': () => {
          statCalls += 1;
          const error = new Error('absent') as NodeJS.ErrnoException;
          error.code = 'ENOENT';
          throw error;
        },
      },
    }),
  });
  assert.equal(result, 0);
  assert.equal(allowedErr.length, 0);
  assert.equal(statCalls > 0, true, 'status must consume filesystem.quota.stat result');
  assert.deepEqual(JSON.parse(allowedOut.join('')), {
    ok: true,
    data: { schema: 'ccm/quota-status/v1', available: false },
  });
  const productionOut: string[] = [];
  const productionErr: string[] = [];
  const productionResult = await runProduction(['--home', quotaHome, 'quota', 'status', '--json'], {
    out: (line) => productionOut.push(line),
    err: (line) => productionErr.push(line),
    env: { HOME: configDir, CC_MASTER_NO_AUTOINSTALL: '1' },
  });
  assert.equal(productionResult, 0);
  assert.deepEqual(productionErr, []);
  assert.deepEqual(JSON.parse(productionOut.join('')), {
    ok: true,
    data: { schema: 'ccm/quota-status/v1', available: false },
  });
  assert.equal(Object.hasOwn(REGISTRY, 'quota'), true);
  assert.equal(
    existsSync(join(configDir, 'settings.json')),
    false,
    'quota composition must not borrow unrelated statusline filesystem authority',
  );
});

test('production quota reserve cannot mutate files through an undeclared boundary', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-quota-production-mutation-kill-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const quotaHome = join(root, 'home');
  const nowMs = Date.now();
  const aggregationKey = 'codex|identity-A|pool-A|seven_day';
  await createQuotaAdmissionStore({ home: quotaHome }).publishObservation({
    source_key: 'codex-current',
    observation: {
      schema: 'ccm/quota-authority-observation/v1',
      provider: 'codex',
      provider_rule_revision: 'ccm/codex-7d-pacing/v1',
      source_revision: 'sha256:live-r2',
      observed_at: new Date(nowMs - 1_000).toISOString(),
      valid_until: new Date(nowMs + 300_000).toISOString(),
      source_profile: {
        schema: 'ccm/quota-source-profile/v1',
        revision: 'ccm/test-quota-source/v1',
        fresh_ttl_sec: 60,
        hard_ttl_sec: 300,
        max_clock_skew_sec: 5,
      },
      account_id: 'identity-A',
      pool_id: 'pool-A',
      identity_fingerprint: 'sha256:identity-A',
      hard_window: { name: 'seven_day', duration_sec: 604_800 },
      policy: {
        decision: 'allow',
        revision: 'ccm/codex-7d-pacing/v1',
        hard_ceiling_used_pct: 85,
      },
      effects: { decision: 'allow', effect: 'read-only' },
      buckets: [
        {
          id: 'seven-day',
          window: 'seven_day',
          duration_sec: 604_800,
          freshness: 'fresh',
          used_pct: 65,
          safety_margin_pct: 0,
          projected_p80_pct: 0,
          aggregation_key: aggregationKey,
        },
      ],
    },
  });
  const reservationRoot = join(quotaHome, 'quota', 'v1', 'reservations');
  const reservationKeyRoot = join(quotaHome, 'quota', 'v1', 'reservation-keys');
  assert.equal(existsSync(reservationRoot), false);
  assert.equal(existsSync(reservationKeyRoot), false);
  const reserveArgs = [
    '--home',
    quotaHome,
    'quota',
    'reserve',
    '--input',
    JSON.stringify({
      schema: 'ccm/quota-reservation-request/v1',
      source_key: 'codex-current',
      aggregation_key: aggregationKey,
      capacity_pct: 20,
      id: 'qres-effect-kill',
      key: 'attempt-effect-kill',
      hash: 'caller-hash-ignored',
      amount_pct: 4,
      state: 'held',
      checked_at: new Date(nowMs).toISOString(),
      expires_at: new Date(nowMs + 60_000).toISOString(),
      source_revision: 'sha256:live-r2',
      attempt_id: 'attempt-effect-kill',
      candidate_id: 'codex-cli-worker',
      account_id: 'identity-A',
      pool_id: 'pool-A',
      identity_fingerprint: 'sha256:identity-A',
    }),
    '--json',
  ];
  const partialOut: string[] = [];
  const partialErr: string[] = [];
  const partial = await run(reserveArgs, {
    out: (line) => partialOut.push(line),
    err: (line) => partialErr.push(line),
    env: {},
    quotaEffects: createQuotaEffectBoundary({
      allow: ['filesystem.quota.make_directory'],
      quotaRoot: join(quotaHome, 'quota', 'v1'),
      handlers: {
        'filesystem.quota.make_directory': (input) =>
          fsPromises.mkdir(
            String(input.path),
            input.options as Parameters<typeof fsPromises.mkdir>[1],
          ),
      },
    }),
  });
  assert.equal(partial, 1);
  assert.match(partialErr.join('\n'), /QUOTA_CAPABILITY_UNDECLARED/);
  assert.equal(partialOut.length, 0);
  assert.equal(existsSync(reservationKeyRoot), false);
  assert.equal(existsSync(reservationRoot), false);
  const out: string[] = [];
  const err: string[] = [];
  const result = await run(reserveArgs, {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    env: {},
    quotaEffects: createQuotaEffectBoundary({
      allow: [],
      quotaRoot: join(quotaHome, 'quota', 'v1'),
      handlers: {},
    }),
  });
  assert.equal(result, 1);
  assert.match(err.join('\n'), /QUOTA_CAPABILITY_UNDECLARED/);
  assert.equal(out.length, 0);
  assert.equal(existsSync(reservationRoot), false);
});

test('router-to-controlled-handler fails closed and the allowed path consumes the boundary', () => {
  routerSideEffectCalls = 0;

  resetControlledQuotaTrace();
  const missing = routeControlled('quota.observe');
  assert.equal(missing.code, 1);
  assert.match(missing.err.join('\n'), /QUOTA_CAPABILITY_UNAVAILABLE/);
  assert.deepEqual(controlledQuotaTrace(), { boundaryResultsConsumed: 0 });
  assertNoEffectCalls(missing.instruments);
  assert.equal(routerSideEffectCalls, 0);

  for (const capability of ['future.magic', 'process.spawn']) {
    resetControlledQuotaTrace();
    const denied = routeControlled(
      capability,
      createQuotaEffectBoundary({ allow: [], handlers: {} }),
    );
    assert.equal(denied.code, 1);
    assert.match(denied.err.join('\n'), /QUOTA_EFFECT_FORBIDDEN/);
    assert.deepEqual(controlledQuotaTrace(), { boundaryResultsConsumed: 0 });
    assertNoEffectCalls(denied.instruments);
    assert.equal(routerSideEffectCalls, 0);
  }

  resetControlledQuotaTrace();
  const undeclared = routeControlled(
    'quota.observe',
    createQuotaEffectBoundary({
      allow: ['auth.observe'],
      handlers: { 'auth.observe': () => ({ authenticated: true }) },
    }),
  );
  assert.equal(undeclared.code, 1);
  assert.match(undeclared.err.join('\n'), /QUOTA_CAPABILITY_UNDECLARED/);
  assert.deepEqual(controlledQuotaTrace(), { boundaryResultsConsumed: 0 });
  assertNoEffectCalls(undeclared.instruments);
  assert.equal(routerSideEffectCalls, 0);

  resetControlledQuotaTrace();
  const unbound = routeControlled(
    'quota.observe',
    createQuotaEffectBoundary({ allow: ['quota.observe'], handlers: {} }),
  );
  assert.equal(unbound.code, 1);
  assert.match(unbound.err.join('\n'), /QUOTA_CAPABILITY_UNAVAILABLE/);
  assert.deepEqual(controlledQuotaTrace(), { boundaryResultsConsumed: 0 });
  assertNoEffectCalls(unbound.instruments);
  assert.equal(routerSideEffectCalls, 0);

  let boundaryCalls = 0;
  resetControlledQuotaTrace();
  const allowed = routeControlled(
    'quota.observe',
    createQuotaEffectBoundary({
      allow: ['quota.observe'],
      handlers: {
        'quota.observe': (input) => {
          boundaryCalls += 1;
          return { kind: 'quota-observation', source: input.source };
        },
      },
    }),
  );
  assert.equal(allowed.code, 0);
  assert.equal(boundaryCalls, 1, 'allowed quota.observe must cross the boundary exactly once');
  assert.deepEqual(controlledQuotaTrace(), { boundaryResultsConsumed: 1 });
  assert.deepEqual(JSON.parse(allowed.out.join('\n')), {
    ok: true,
    data: { kind: 'quota-observation', source: 'controlled-router-fixture' },
  });
  assertNoEffectCalls(allowed.instruments);
  assert.equal(routerSideEffectCalls, 0);
});
