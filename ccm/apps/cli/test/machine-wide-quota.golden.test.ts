import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  defineHarnessModule,
  HarnessCatalog,
  harnessId,
  quotaTargetId,
  supported,
  surfaceId,
  unsupported,
} from '../src/harnesses/capability-model.js';
import { BUILT_IN_HARNESS_MODULES, builtInHarnessCatalog } from '../src/harnesses/composition.js';
import {
  findMachineQuotaReading,
  type MachineQuotaCollectorBoundary,
  type MachineQuotaStore,
  readMachineWideQuotaStatus,
  readOrRefreshMachineQuotaSurfaceReading,
} from '../src/machine-wide-quota.js';
import { usageReading } from '../src/usage-reading.js';

type Data = Record<string, unknown>;

const NOW = new Date('2026-07-22T00:00:00Z');

const EXPECTED_TARGETS = [
  ['codex', 'codex-cli', 'codex', 'seven-day-global', 'seven_day', 604_800],
  ['claude-code', 'claude-cli', 'anthropic', 'five-hour-global', 'five_hour', 18_000],
  ['claude-code', 'claude-cli', 'anthropic', 'seven-day-global', 'seven_day', 604_800],
  [
    'claude-code',
    'claude-fable-5-cli',
    'anthropic',
    'seven-day-fable-global',
    'seven_day',
    604_800,
  ],
  ['cursor', 'cursor-ide-plugin', 'cursor', 'billing-period-global', 'billing_period', 2_592_000],
  [
    'cursor',
    'cursor-ide-plugin',
    'cursor',
    'billing-period-usage-based',
    'billing_period_usage_based',
    2_592_000,
  ],
  ['cursor', 'cursor-agent-cli', 'cursor', 'billing-period-global', 'billing_period', 2_592_000],
  [
    'cursor',
    'cursor-agent-cli',
    'cursor',
    'billing-period-usage-based',
    'billing_period_usage_based',
    2_592_000,
  ],
  ['kimi-code', 'kimi-cli', 'moonshot', 'five-hour-global', 'five_hour', 18_000],
  ['kimi-code', 'kimi-cli', 'moonshot', 'seven-day-global', 'seven_day', 604_800],
] as const;

function emptyStore(): MachineQuotaStore {
  return {
    async readObservation() {
      return undefined;
    },
    async refreshObservation(_request, collect) {
      return collect();
    },
    async readAggregation() {
      return {};
    },
    async readMachineProjection() {
      return undefined;
    },
    async publishMachineProjection(projection) {
      return structuredClone(projection) as Data;
    },
  };
}

test('M0 golden: machine-wide quota preserves all ten target tuples and their public order', async () => {
  const status = await readMachineWideQuotaStatus(
    emptyStore(),
    NOW,
    builtInHarnessCatalog.machineQuota,
  );
  assert.deepEqual(
    status.readings.map((reading: Data) => {
      const target = reading.target as Data;
      const window = target.window as Data;
      return [
        target.harness_id,
        target.surface_id,
        target.provider_id,
        target.bucket_id,
        window.name,
        window.duration_sec,
      ];
    }),
    EXPECTED_TARGETS,
  );
});

test('M0 golden: machine-wide quota v1 envelope and target schema stay exact', async () => {
  const status = await readMachineWideQuotaStatus(
    emptyStore(),
    NOW,
    builtInHarnessCatalog.machineQuota,
  );
  assert.equal(status.schema, 'ccm/machine-quota-status/v1');
  assert.deepEqual(Object.keys(status).sort(), ['capacity_views', 'readings', 'schema', 'summary']);
  assert.equal(status.summary.schema, 'ccm/machine-quota-summary/v1');
  assert.deepEqual(Object.keys(status.summary).sort(), ['decisions', 'schema']);
  assert.equal(status.capacity_views.schema, 'ccm/machine-quota-capacity-views/v1');
  for (const reading of status.readings as Data[]) {
    assert.deepEqual(Object.keys(reading).sort(), [
      'observed_at',
      'refresh_hint',
      'resets_at',
      'source',
      'target',
      'used_percentage',
      'valid_until',
    ]);
    const target = reading.target as Data;
    assert.deepEqual(
      Object.keys(target).sort(),
      [
        'bucket_id',
        'harness_id',
        ...(target.pool_kind === undefined ? [] : ['pool_kind']),
        'provider_id',
        'surface_id',
        'unit',
        'window',
      ].sort(),
    );
  }
});

test('M2 quota refresh selects the exact target identity when one surface has two targets', async () => {
  const collectedTargetIds: unknown[] = [];
  const collectors: MachineQuotaCollectorBoundary = {
    collect(target) {
      collectedTargetIds.push(target.target_id);
      return { status: 'unsupported', reason: 'routing-only fixture' };
    },
  };
  await readOrRefreshMachineQuotaSurfaceReading({
    targetId: quotaTargetId('machine-wide/cursor/cursor-agent-cli/billing_period_usage_based'),
    env: {},
    store: emptyStore(),
    collectors,
    directory: builtInHarnessCatalog.machineQuota,
  });
  assert.deepEqual(collectedTargetIds, [
    'machine-wide/cursor/cursor-agent-cli/billing_period_usage_based',
  ]);
});

test('M2 anti-fork: a synthetic fifth harness appears without editing quota services', async () => {
  const synthetic = defineHarnessModule({
    id: harnessId('synthetic-fifth'),
    displayName: 'Synthetic Fifth',
    aliases: [],
    surfaces: [
      {
        id: surfaceId('synthetic-fifth-cli'),
        displayName: 'Synthetic Fifth CLI',
        kind: 'cli-headless',
      },
    ],
    capabilities: {
      'installation-discovery': unsupported('not-supported-by-ccm'),
      'session-observation': unsupported('not-supported-by-ccm'),
      'usage-observation': supported({
        source: () => ({ kind: 'app-server', pollable: false, quotaModel: 'primary-secondary' }),
        observeUsage: () => ({
          signal: null,
          source: 'unavailable',
          unavailableReason: 'synthetic anti-fork fixture has no live usage signal',
        }),
      }),
      'machine-quota': supported({
        targets: [
          {
            id: quotaTargetId('machine-wide/synthetic-fifth/synthetic-fifth-cli/seven_day'),
            surfaceId: surfaceId('synthetic-fifth-cli'),
            order: 10,
            providerId: 'synthetic',
            bucketId: 'seven-day-global',
            windowName: 'seven_day',
            durationSec: 604_800,
            collectorId: 'synthetic-collector',
            sourceSchema: 'synthetic/quota/v1',
            authSource: 'synthetic-current-login',
          },
        ],
        observeTarget: async () => ({ status: 'unknown', reason: 'fixture' }),
      }),
      'account-management': unsupported('not-supported-by-ccm'),
      'statusline-projection': unsupported('not-supported-by-ccm'),
      'plugin-projection': unsupported('not-supported-by-ccm'),
      'worker-execution': unsupported('not-supported-by-ccm'),
    },
  });
  const catalog = HarnessCatalog.create([...BUILT_IN_HARNESS_MODULES, synthetic]);

  assert.equal(catalog.machineQuota.supportFor(synthetic.id)?.support, 'supported');
  const status = await readMachineWideQuotaStatus(emptyStore(), NOW, catalog.machineQuota);

  assert.equal(status.readings.length, 11);
  assert.equal(status.readings.at(-1)?.target.harness_id, 'synthetic-fifth');
  assert.equal(status.readings.at(-1)?.target.surface_id, 'synthetic-fifth-cli');
});

test('M2 anti-fork: an unsupported synthetic harness stays inventoried without quota targets', async () => {
  const syntheticId = harnessId('synthetic-unsupported');
  const synthetic = defineHarnessModule({
    id: syntheticId,
    displayName: 'Synthetic Unsupported',
    aliases: [],
    surfaces: [
      {
        id: surfaceId('synthetic-unsupported-cli'),
        displayName: 'Synthetic Unsupported CLI',
        kind: 'cli-headless',
      },
    ],
    capabilities: {
      'installation-discovery': unsupported('not-supported-by-ccm'),
      'session-observation': unsupported('not-supported-by-ccm'),
      'usage-observation': unsupported('not-supported-by-ccm'),
      'machine-quota': unsupported('not-provided-by-harness', 'synthetic negative fixture'),
      'account-management': unsupported('not-supported-by-ccm'),
      'statusline-projection': unsupported('not-supported-by-ccm'),
      'plugin-projection': unsupported('not-supported-by-ccm'),
      'worker-execution': unsupported('not-supported-by-ccm'),
    },
  });
  const catalog = HarnessCatalog.create([...BUILT_IN_HARNESS_MODULES, synthetic]);

  assert.equal(synthetic.capabilities['machine-quota'].support, 'unsupported');
  assert.deepEqual(catalog.machineQuota.supportFor(syntheticId), {
    support: 'unsupported',
    reason: 'not-provided-by-harness',
    detail: 'synthetic negative fixture',
  });
  assert.equal(catalog.machineQuota.listTargets().length, EXPECTED_TARGETS.length);

  const status = await readMachineWideQuotaStatus(emptyStore(), NOW, catalog.machineQuota);
  assert.equal(status.readings.length, EXPECTED_TARGETS.length);
  assert.equal(
    status.readings.some((reading: Data) => (reading.target as Data).harness_id === syntheticId),
    false,
  );
});

test('Cursor Agent cached usage selects the canonical billing-period target independent of row order', () => {
  const reading = (
    windowName: 'billing_period' | 'billing_period_usage_based',
    bucketId: string,
    poolKind: 'first_party' | 'usage_based',
    usedPercentage: number,
  ): Data => ({
    target: {
      harness_id: 'cursor',
      surface_id: 'cursor-agent-cli',
      provider_id: 'cursor',
      bucket_id: bucketId,
      pool_kind: poolKind,
      unit: 'percent',
      window: { kind: 'billing-cycle', name: windowName, duration_sec: 2_592_000 },
    },
    used_percentage: usedPercentage,
    resets_at: '2026-08-01T00:00:00Z',
    observed_at: '2026-07-22T00:00:00Z',
    valid_until: '2999-01-01T00:00:00Z',
    source: { collector_id: 'cursor-agent-dashboard' },
    refresh_hint: null,
  });
  const reversedReadings = [
    reading('billing_period', 'billing-period-global', 'first_party', 37),
    reading('billing_period_usage_based', 'billing-period-usage-based', 'usage_based', 91),
  ].reverse();

  const selected = findMachineQuotaReading(
    { readings: reversedReadings },
    quotaTargetId('machine-wide/cursor/cursor-agent-cli/billing_period'),
    builtInHarnessCatalog.machineQuota,
  );
  const projected = usageReading.projectMachineCacheReading(selected);

  assert.equal(selected?.target.window.name, 'billing_period');
  assert.equal(projected?.signal?.billing_period?.used_percentage, 37);
});
