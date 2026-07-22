import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CAPABILITY_KEYS,
  type CapabilityPortfolioDraft,
  defineHarnessModule,
  HarnessCatalog,
  type HarnessModule,
  harnessId,
  type MachineQuotaFaceDraft,
  quotaTargetId,
  RUNTIME_OUTCOMES,
  SUPPORT_STATES,
  supported,
  surfaceId,
  type UsageObservationFace,
  unsupported,
} from '../src/harnesses/capability-model.js';
import { BUILT_IN_HARNESS_MODULES, builtInHarnessCatalog } from '../src/harnesses/composition.js';

const FIXTURE_USAGE_OBSERVATION: UsageObservationFace = {
  source: () => ({ kind: 'app-server', pollable: false, quotaModel: 'primary-secondary' }),
  observeUsage: () => ({
    signal: null,
    source: 'unavailable',
    unavailableReason: 'fixture usage is unavailable',
  }),
};

function portfolio(
  quota: CapabilityPortfolioDraft['machine-quota'] = unsupported('not-provided-by-harness'),
  usage: CapabilityPortfolioDraft['usage-observation'] = quota.support === 'supported'
    ? supported(FIXTURE_USAGE_OBSERVATION)
    : unsupported('not-provided-by-harness'),
): CapabilityPortfolioDraft {
  return {
    'installation-discovery': supported({
      detect: () => false,
      discoverInstallation: () => ({
        id: harnessId('fixture'),
        displayName: 'Fixture',
        installed: false,
        active: false,
        reason: null,
        cli: { name: 'fixture', path: null, available: false },
        configPaths: [],
        surfaces: [],
        capabilities: {
          accountPool: { supported: false },
          externalStatusline: { supported: false },
          pluginDistribution: { supported: false },
        },
      }),
    }),
    'session-observation': supported({
      observeSession: () => ({ id: '', source: 'none' }),
      sessionStoreRoots: () => [],
    }),
    'usage-observation': usage,
    'machine-quota': quota,
    'account-management': unsupported('not-provided-by-harness'),
    'statusline-projection': unsupported('not-provided-by-harness'),
    'plugin-projection': unsupported('not-provided-by-harness'),
    'worker-execution': unsupported('not-supported-by-ccm'),
  };
}

function quotaFace(
  ...targets: Array<{ id: string; surface: string; order: number }>
): MachineQuotaFaceDraft {
  return {
    targets: targets.map((target) => ({
      id: quotaTargetId(target.id),
      surfaceId: surfaceId(target.surface),
      order: target.order,
      providerId: 'fixture-provider',
      bucketId: `bucket-${target.order}`,
      windowName: target.order === 1 ? 'five_hour' : 'seven_day',
      durationSec: target.order === 1 ? 18_000 : 604_800,
      collectorId: 'fixture-collector',
      sourceSchema: 'fixture/quota/v1',
      authSource: 'fixture-current-login',
    })),
    observeTarget: async () => ({ status: 'unknown', reason: 'fixture' }),
  };
}

function module(
  input: { id?: string; surface?: string; quota?: MachineQuotaFaceDraft } = {},
): HarnessModule {
  const id = input.id ?? 'fixture';
  const surface = input.surface ?? `${id}-cli`;
  return defineHarnessModule({
    id: harnessId(id),
    displayName: id,
    aliases: [id],
    surfaces: [{ id: surfaceId(surface), displayName: surface, kind: 'cli-headless' }],
    capabilities: portfolio(
      input.quota ? supported(input.quota) : unsupported('not-provided-by-harness'),
    ),
  });
}

test('M0 protocol vocabulary stays closed while harness and surface identities stay open', () => {
  assert.deepEqual(CAPABILITY_KEYS, [
    'installation-discovery',
    'session-observation',
    'usage-observation',
    'machine-quota',
    'account-management',
    'statusline-projection',
    'plugin-projection',
    'worker-execution',
  ]);
  assert.deepEqual(SUPPORT_STATES, ['supported', 'unsupported']);
  assert.deepEqual(RUNTIME_OUTCOMES, ['ok', 'runtime-unavailable', 'unknown', 'failed']);
  assert.equal(harnessId('synthetic-fifth'), 'synthetic-fifth');
  assert.equal(surfaceId('synthetic-fifth-cli'), 'synthetic-fifth-cli');
});

test('HarnessModule is deeply immutable and seals target ownership from the module', () => {
  const fixture = module({
    quota: quotaFace({ id: 'fixture:five-hour', surface: 'fixture-cli', order: 1 }),
  });
  assert.equal(Object.isFrozen(fixture), true);
  assert.equal(Object.isFrozen(fixture.surfaces), true);
  assert.equal(Object.isFrozen(fixture.capabilities), true);
  const binding = fixture.capabilities['machine-quota'];
  assert.equal(binding.support, 'supported');
  assert.equal(Object.isFrozen(binding), true);
  if (binding.support === 'supported') {
    assert.equal(binding.implementation.targets[0]?.harnessId, fixture.id);
    assert.equal(Object.isFrozen(binding.implementation.targets), true);
  }
});

test('HarnessCatalog fails fast on duplicate harness, surface, and quota target identities', () => {
  const first = module({
    id: 'first',
    surface: 'shared-cli',
    quota: quotaFace({ id: 'shared-target', surface: 'shared-cli', order: 1 }),
  });
  assert.throws(() => HarnessCatalog.create([first, first]), /duplicate harness id/i);
  assert.throws(
    () => HarnessCatalog.create([first, module({ id: 'second', surface: 'shared-cli' })]),
    /duplicate surface id/i,
  );
  assert.throws(
    () =>
      HarnessCatalog.create([
        first,
        module({
          id: 'second',
          surface: 'second-cli',
          quota: quotaFace({ id: 'shared-target', surface: 'second-cli', order: 2 }),
        }),
      ]),
    /duplicate quota target id/i,
  );
});

test('HarnessModule rejects incomplete and invalid capability declarations', () => {
  const base = {
    id: harnessId('invalid'),
    displayName: 'Invalid',
    aliases: ['invalid'],
    surfaces: [
      { id: surfaceId('invalid-cli'), displayName: 'Invalid', kind: 'cli-headless' as const },
    ],
  };
  const missing = { ...portfolio() } as Record<string, unknown>;
  delete missing['plugin-projection'];
  assert.throws(
    () => defineHarnessModule({ ...base, capabilities: missing as CapabilityPortfolioDraft }),
    /missing capability declaration.*plugin-projection/i,
  );
  const supportedWithoutImplementation = {
    ...portfolio(),
    'usage-observation': { support: 'supported' },
  } as unknown as CapabilityPortfolioDraft;
  assert.throws(
    () => defineHarnessModule({ ...base, capabilities: supportedWithoutImplementation }),
    /supported capability.*implementation/i,
  );
  const unsupportedWithImplementation = {
    ...portfolio(),
    'usage-observation': {
      support: 'unsupported',
      reason: 'not-provided-by-harness',
      implementation: {},
    },
  } as unknown as CapabilityPortfolioDraft;
  assert.throws(
    () => defineHarnessModule({ ...base, capabilities: unsupportedWithImplementation }),
    /unsupported capability.*implementation/i,
  );
});

test('HarnessModule rejects supported machine quota without supported usage observation', () => {
  assert.throws(
    () =>
      defineHarnessModule({
        id: harnessId('quota-without-usage'),
        displayName: 'Quota without usage',
        aliases: [],
        surfaces: [
          {
            id: surfaceId('quota-without-usage-cli'),
            displayName: 'Quota without usage CLI',
            kind: 'cli-headless',
          },
        ],
        capabilities: portfolio(
          supported(
            quotaFace({
              id: 'quota-without-usage:five-hour',
              surface: 'quota-without-usage-cli',
              order: 1,
            }),
          ),
          unsupported('not-provided-by-harness'),
        ),
      }),
    /supported machine-quota.*requires supported usage-observation/i,
  );
});

test('HarnessModule rejects a supported machine quota with an empty target catalog', () => {
  assert.throws(
    () =>
      defineHarnessModule({
        id: harnessId('empty-quota'),
        displayName: 'Empty quota',
        aliases: [],
        surfaces: [
          {
            id: surfaceId('empty-quota-cli'),
            displayName: 'Empty quota CLI',
            kind: 'cli-headless',
          },
        ],
        capabilities: portfolio(supported(quotaFace())),
      }),
    /supported machine-quota.*non-empty target catalog/i,
  );
});

test('quota targets may share a surface but may not reference a foreign surface', () => {
  const sameSurface = module({
    quota: quotaFace(
      { id: 'fixture:five-hour', surface: 'fixture-cli', order: 1 },
      { id: 'fixture:seven-day', surface: 'fixture-cli', order: 2 },
    ),
  });
  const catalog = HarnessCatalog.create([sameSurface]);
  assert.deepEqual(
    catalog.machineQuota.listTargets().map((target) => target.id),
    ['fixture:five-hour', 'fixture:seven-day'],
  );
  assert.throws(
    () =>
      module({
        quota: quotaFace({ id: 'foreign', surface: 'other-cli', order: 1 }),
      }),
    /quota target.*foreign surface/i,
  );
});

test('typed directories publish only supported faces and never expose a generic capability lookup', () => {
  const fixture = module({
    quota: quotaFace({ id: 'fixture:five-hour', surface: 'fixture-cli', order: 1 }),
  });
  const catalog = HarnessCatalog.create([fixture]);
  assert.equal(
    catalog.machineQuota.observerFor(quotaTargetId('fixture:five-hour')) !== undefined,
    true,
  );
  assert.equal(catalog.usage.observerFor(surfaceId('fixture-cli')) !== undefined, true);
  assert.deepEqual(catalog.worker.candidatesFor('headless-cli'), []);
  assert.equal(Object.isFrozen(catalog.installation.list()), true);
  assert.equal(Object.isFrozen(catalog.machineQuota.listTargets()), true);
  assert.equal(Object.isFrozen(catalog.worker.candidatesFor('headless-cli')), true);
  assert.equal('getCapability' in catalog, false);
  assert.equal('resolve' in catalog, false);
});

test('M1 static composition root registers four complete immutable modules exactly once', () => {
  assert.deepEqual(
    BUILT_IN_HARNESS_MODULES.map((module) => module.id),
    ['codex', 'cursor', 'kimi-code', 'claude-code'],
  );
  assert.ok(BUILT_IN_HARNESS_MODULES.every((module) => Object.isFrozen(module)));
  assert.deepEqual(
    builtInHarnessCatalog.installation.list().map((binding) => binding.harnessId),
    ['codex', 'cursor', 'kimi-code', 'claude-code'],
  );
});

test('M1 support declarations preserve the characterized capability matrix', () => {
  const expected = {
    codex: ['unsupported', 'unsupported', 'supported'],
    cursor: ['unsupported', 'unsupported', 'supported'],
    'kimi-code': ['unsupported', 'unsupported', 'supported'],
    'claude-code': ['supported', 'supported', 'supported'],
  } as const;
  for (const module of BUILT_IN_HARNESS_MODULES) {
    assert.deepEqual(
      [
        module.capabilities['account-management'].support,
        module.capabilities['statusline-projection'].support,
        module.capabilities['plugin-projection'].support,
      ],
      expected[module.id as keyof typeof expected],
    );
    assert.equal(module.capabilities['installation-discovery'].support, 'supported');
    assert.equal(module.capabilities['session-observation'].support, 'supported');
    assert.equal(module.capabilities['usage-observation'].support, 'supported');
    assert.equal(module.capabilities['machine-quota'].support, 'supported');
    assert.equal(module.capabilities['worker-execution'].support, 'supported');
  }
  assert.deepEqual(
    builtInHarnessCatalog.worker.candidatesFor('headless-cli').map((binding) => binding.harnessId),
    ['codex', 'cursor', 'kimi-code', 'claude-code'],
  );
  assert.equal(
    builtInHarnessCatalog.worker.forHarness('cursor-agent', 'headless-cli')?.harnessId,
    'cursor',
  );
});

test('M1 machine quota directory is derived from module-owned targets in explicit v1 order', () => {
  assert.deepEqual(
    builtInHarnessCatalog.machineQuota
      .listTargets()
      .map((target) => [
        target.id,
        target.harnessId,
        target.surfaceId,
        target.windowName,
        target.order,
      ]),
    [
      ['machine-wide/codex/codex-cli/seven_day', 'codex', 'codex-cli', 'seven_day', 0],
      [
        'machine-wide/claude-code/claude-cli/five_hour',
        'claude-code',
        'claude-cli',
        'five_hour',
        1,
      ],
      [
        'machine-wide/claude-code/claude-cli/seven_day',
        'claude-code',
        'claude-cli',
        'seven_day',
        2,
      ],
      [
        'machine-wide/claude-code/claude-fable-5-cli/seven_day',
        'claude-code',
        'claude-fable-5-cli',
        'seven_day',
        3,
      ],
      [
        'machine-wide/cursor/cursor-ide-plugin/billing_period',
        'cursor',
        'cursor-ide-plugin',
        'billing_period',
        4,
      ],
      [
        'machine-wide/cursor/cursor-ide-plugin/billing_period_usage_based',
        'cursor',
        'cursor-ide-plugin',
        'billing_period_usage_based',
        5,
      ],
      [
        'machine-wide/cursor/cursor-agent-cli/billing_period',
        'cursor',
        'cursor-agent-cli',
        'billing_period',
        6,
      ],
      [
        'machine-wide/cursor/cursor-agent-cli/billing_period_usage_based',
        'cursor',
        'cursor-agent-cli',
        'billing_period_usage_based',
        7,
      ],
      ['machine-wide/kimi-code/kimi-cli/five_hour', 'kimi-code', 'kimi-cli', 'five_hour', 8],
      ['machine-wide/kimi-code/kimi-cli/seven_day', 'kimi-code', 'kimi-cli', 'seven_day', 9],
    ],
  );
});
