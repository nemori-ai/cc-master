import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import {
  projectMachineWideQuotaNotifications as projectProductionNotifications,
  projectMachineQuotaPosture as projectProductionPosture,
} from '../src/machine-wide-quota-notification.js';
// @ts-expect-error Executable fixture modules intentionally remain plain ESM next to their JSON manifest.
import { counterfeits } from './fixtures/machine-wide-quota-notification-v1/counterfeits.mjs';
// @ts-expect-error Executable fixture modules intentionally remain plain ESM next to their JSON manifest.
import { knownGood } from './fixtures/machine-wide-quota-notification-v1/known-good.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures', 'machine-wide-quota-notification-v1');
const manifest = JSON.parse(readFileSync(join(fixtureDir, 'manifest.json'), 'utf8'));
const runProduction = process.env.CCM_MACHINE_WIDE_QUOTA_RED === '1';

interface Implementation {
  projectPosture(signal: Record<string, any>, input?: Record<string, any>): any;
  projectNotifications(input: Record<string, any>): any;
  aggregateCapacityViews(decisions: Record<string, any>[]): any;
  runCycle(input: Record<string, any>): Promise<any>;
}

const subscriptions = manifest.origins.map((origin: string) => ({
  subscription_id: `sub-${origin}`,
  board_id: `board-${origin}-primary`,
  session_id: `session-${origin}`,
  session_epoch: `epoch-${origin}`,
  authoritative_epoch: `epoch-${origin}`,
  origin,
  capability: 'coordination-inbox',
  state: 'current',
  valid: true,
}));

subscriptions.push({
  subscription_id: 'sub-codex-second-board',
  board_id: 'board-codex-secondary',
  session_id: 'session-codex-second-board',
  session_epoch: 'epoch-codex-second-board',
  authoritative_epoch: 'epoch-codex-second-board',
  origin: 'codex',
  capability: 'coordination-inbox',
  state: 'current',
  valid: true,
});

const expectedCurrentSubscriptions = 4;

const rejectedSubscriptions = [
  {
    ...subscriptions[0],
    subscription_id: 'sub-stale',
    session_epoch: 'epoch-stale',
    authoritative_epoch: 'epoch-current',
  },
  { ...subscriptions[1], subscription_id: 'sub-invalid', valid: false },
  { ...subscriptions[2], subscription_id: 'sub-wrong-capability', capability: 'other' },
];

function assertSafe(value: unknown) {
  const text = JSON.stringify(value);
  assert.doesNotMatch(
    text,
    /sk-secret|credential|raw_account|account_id|identity_fingerprint|"payer_scope"|"pool_id"|provider_response|access_token|refresh_token/i,
  );
}

function memoryEffects(failSubscriptionOnce: string | null = null) {
  const checkpoints = new Map<string, any>();
  const items = new Map<string, any>();
  const attempts: Array<{ subscription_id: string; id: string }> = [];
  let pendingFailure = failSubscriptionOnce;
  return {
    checkpoints,
    items,
    attempts,
    checkpoint: {
      read: async (scopeDigest: string) => checkpoints.get(scopeDigest) ?? null,
      publish: async (scopeDigest: string, decision: any) => {
        checkpoints.set(scopeDigest, structuredClone(decision));
      },
    },
    inbox: {
      put: async (notification: any) => {
        attempts.push({
          subscription_id: notification.destination.subscription_id,
          id: notification.id,
        });
        if (pendingFailure === notification.destination.subscription_id) {
          pendingFailure = null;
          throw new Error('INJECTED_PARTIAL_INBOX_FAILURE');
        }
        const prior = items.get(notification.id);
        if (prior)
          assert.deepEqual(prior, notification, 'same deterministic id must be an exact no-op');
        else items.set(notification.id, structuredClone(notification));
      },
    },
  };
}

async function exercise(implementation: Implementation) {
  const signals = manifest.signals as Record<string, any>[];
  const healthy = signals.map((signal) =>
    implementation.projectPosture(signal, { state: 'healthy' }),
  );
  const tight = signals.map((signal) => implementation.projectPosture(signal, { state: 'tight' }));

  for (const decision of healthy) {
    assert.match(decision.scope_digest, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(Object.keys(decision.target).sort(), [
      'harness_id',
      'provider_id',
      'surface_id',
      'window',
    ]);
    assert.equal(decision.freshness, 'fresh');
    assertSafe(decision);
  }

  const cursorIde = healthy[2];
  const cursorAgent = healthy[3];
  assert.notEqual(
    cursorIde.scope_digest,
    cursorAgent.scope_digest,
    'Cursor IDE/Agent are distinct surfaces',
  );
  assert.equal(cursorIde.target.window.name, 'billing_period');
  assert.equal(cursorAgent.target.window.name, 'billing_period');
  assert.equal(cursorIde.source.collector_id, 'cursor-dashboard');
  assert.equal(cursorAgent.source.collector_id, 'cursor-agent-dashboard');
  assert.equal(cursorIde.source.source_schema, 'cursor/GetCurrentPeriodUsage/v1');
  assert.equal(cursorAgent.source.source_schema, 'cursor/GetCurrentPeriodUsage/v1');
  assert.equal(cursorIde.source.auth_source, 'cursor-ide-current-login');
  assert.equal(cursorAgent.source.auth_source, 'cursor-agent-current-login');
  assert.notEqual(cursorIde.source.auth_source, cursorAgent.source.auth_source);
  assert.equal(
    cursorIde.quota_scope_digest,
    cursorAgent.quota_scope_digest,
    'collector-proven shared Cursor subscription is one quota pool across surfaces',
  );
  assert.ok(
    !('identity_scope_digest' in cursorIde.target) &&
      !('payer_scope' in cursorIde.target) &&
      !('pool_scope_digest' in cursorIde.target),
    'identity/payer/pool are not posture gates',
  );
  const noOptionalScope = implementation.projectPosture(
    { ...signals[0], quota_scope_digest: undefined },
    { state: 'healthy' },
  );
  assert.equal(noOptionalScope.state, 'healthy');
  assert.equal(noOptionalScope.quota_scope_digest, null);
  assert.equal(
    noOptionalScope.scope_digest,
    healthy[0].scope_digest,
    'missing optional correlation evidence does not change or block the surface posture',
  );

  const sharedCapacity = implementation.aggregateCapacityViews([cursorIde, cursorAgent]);
  assert.equal(sharedCapacity.schema, 'ccm/machine-quota-capacity-views/v1');
  assert.equal(sharedCapacity.known_capacities.length, 1);
  assert.equal(sharedCapacity.known_capacities[0].quota_scope_digest, cursorIde.quota_scope_digest);
  assert.equal(sharedCapacity.known_capacities[0].capacity_units, 1);
  assert.deepEqual(
    sharedCapacity.known_capacities[0].scope_digests,
    [cursorAgent.scope_digest, cursorIde.scope_digest].sort(),
  );
  assert.deepEqual(sharedCapacity.unresolved_scope_digests, []);
  assert.equal(sharedCapacity.unresolved_capacity_units, null);

  const nullScopeViews = signals
    .slice(2, 4)
    .map((signal) =>
      implementation.projectPosture({ ...signal, quota_scope_digest: null }, { state: 'healthy' }),
    );
  const unresolvedCapacity = implementation.aggregateCapacityViews(nullScopeViews);
  assert.equal(
    unresolvedCapacity.known_capacities.length,
    0,
    'missing correlation evidence never proves independent additive capacities',
  );
  assert.deepEqual(
    unresolvedCapacity.unresolved_scope_digests,
    nullScopeViews.map((decision) => decision.scope_digest).sort(),
  );
  assert.equal(unresolvedCapacity.unresolved_capacity_units, null);

  for (let index = 0; index < tight.length; index += 1) {
    const out = implementation.projectNotifications({
      previous: [healthy[index]],
      decisions: [tight[index]],
      subscriptions: [...subscriptions, ...rejectedSubscriptions],
    });
    assert.equal(
      out.notifications.length,
      expectedCurrentSubscriptions,
      'fan-out reaches every exact current board/session subscription',
    );
    assert.deepEqual(
      [...new Set(out.notifications.map((item: any) => item.destination.origin))].sort(),
      [...manifest.origins].sort(),
    );
    const codexDestinations = out.notifications.filter(
      (item: any) => item.destination.origin === 'codex',
    );
    assert.equal(codexDestinations.length, 2);
    assert.equal(new Set(codexDestinations.map((item: any) => item.destination.board_id)).size, 2);
    assert.equal(
      new Set(codexDestinations.map((item: any) => item.destination.session_id)).size,
      2,
    );
    assert.equal(
      new Set(out.notifications.map((item: any) => item.payload.delta_revision)).size,
      1,
    );
    assert.ok(out.notifications.every((item: any) => item.payload.edge === 'entered_tight'));
    assert.ok(
      out.notifications.every(
        (item: any) =>
          item.payload.source.collector_id === tight[index].source.collector_id &&
          item.payload.source.source_schema === tight[index].source.source_schema &&
          item.payload.source.auth_source === tight[index].source.auth_source,
      ),
      'every delta retains the exact collector, schema, and auth-source provenance',
    );
    assertSafe(out);
  }

  const codexSignal = signals[0]!;
  const states = [
    ['exhausted', 'entered_exhausted'],
    ['unknown', 'became_unknown'],
  ];
  for (const [state, edge] of states) {
    const out = implementation.projectNotifications({
      previous: [implementation.projectPosture(codexSignal, { state: 'healthy' })],
      decisions: [implementation.projectPosture(codexSignal, { state })],
      subscriptions,
    });
    assert.equal(out.notifications.length, expectedCurrentSubscriptions);
    assert.ok(out.notifications.every((item: any) => item.payload.edge === edge));
  }
  const staleSignal = implementation.projectPosture(codexSignal, {
    state: 'unknown',
    freshness: 'hard-stale',
    reason_codes: ['QUOTA_SIGNAL_STALE'],
  });
  const staleOut = implementation.projectNotifications({
    previous: [implementation.projectPosture(codexSignal, { state: 'healthy' })],
    decisions: [staleSignal],
    subscriptions,
  });
  assert.equal(staleOut.notifications.length, expectedCurrentSubscriptions);
  assert.ok(
    staleOut.notifications.every(
      (item: any) =>
        item.payload.edge === 'became_unknown' &&
        item.payload.freshness === 'hard-stale' &&
        item.payload.reason_codes.includes('QUOTA_SIGNAL_STALE'),
    ),
    'stale signal becomes explicit unknown posture',
  );
  const recovery = implementation.projectNotifications({
    previous: [implementation.projectPosture(codexSignal, { state: 'tight' })],
    decisions: [implementation.projectPosture(codexSignal, { state: 'healthy' })],
    subscriptions,
  });
  assert.equal(recovery.notifications.length, expectedCurrentSubscriptions);
  assert.ok(
    recovery.notifications.every(
      (item: any) => item.payload.edge === 'recovered' && item.strength === 'weak',
    ),
  );
  const reset = implementation.projectNotifications({
    previous: [
      implementation.projectPosture(codexSignal, { state: 'exhausted', reset_marker: 'r1' }),
    ],
    decisions: [
      implementation.projectPosture(codexSignal, { state: 'healthy', reset_marker: 'r2' }),
    ],
    subscriptions,
  });
  assert.equal(reset.notifications.length, expectedCurrentSubscriptions);
  assert.ok(reset.notifications.every((item: any) => item.payload.edge === 'reset'));

  const initialHealthyWithMarker = implementation.projectNotifications({
    previous: [],
    decisions: [
      implementation.projectPosture(codexSignal, { state: 'healthy', reset_marker: 'initial-r1' }),
    ],
    subscriptions,
  });
  assert.equal(
    initialHealthyWithMarker.notifications.length,
    0,
    'initial healthy only establishes baseline',
  );
  const initialTightWithMarker = implementation.projectNotifications({
    previous: [],
    decisions: [
      implementation.projectPosture(codexSignal, { state: 'tight', reset_marker: 'initial-r1' }),
    ],
    subscriptions,
  });
  assert.equal(initialTightWithMarker.notifications.length, expectedCurrentSubscriptions);
  assert.ok(
    initialTightWithMarker.notifications.every(
      (item: any) => item.payload.edge === 'entered_tight' && item.payload.previous_state === null,
    ),
    'an initial reset marker does not counterfeit a reset edge',
  );

  const unchanged = implementation.projectPosture(codexSignal, { state: 'healthy' });
  const reobserved = { ...unchanged, observation_revision: `sha256:${'f'.repeat(64)}` };
  assert.equal(
    implementation.projectNotifications({
      previous: [unchanged],
      decisions: [reobserved],
      subscriptions,
    }).notifications.length,
    0,
  );
  assert.equal(
    implementation.projectNotifications({
      previous: [unchanged],
      decisions: [unchanged],
      subscriptions,
      legacy_five_hour_pct: 100,
      legacy_switch: true,
    }).notifications.length,
    0,
    'Codex 5h/switch cannot enter notification/reset/wakeup/account switching',
  );

  const two = implementation.projectNotifications({
    previous: healthy.slice(0, 2),
    decisions: tight.slice(0, 2),
    subscriptions,
  });
  assert.equal(
    two.notifications.length,
    8,
    'same kind retains both provider scopes and both Codex sessions',
  );
  assert.equal(new Set(two.notifications.map((item: any) => item.payload.scope_digest)).size, 2);
  assert.equal(
    new Set(two.notifications.map((item: any) => item.id)).size,
    two.notifications.length,
  );

  const effects = memoryEffects('sub-codex');
  await assert.rejects(
    implementation.runCycle({
      decisions: [tight[0]],
      subscriptions: [...subscriptions, ...rejectedSubscriptions],
      checkpoint: effects.checkpoint,
      inbox: effects.inbox,
    }),
    /INJECTED_PARTIAL_INBOX_FAILURE/,
  );
  assert.equal(effects.checkpoints.size, 0, 'partial write cannot advance checkpoint');
  await implementation.runCycle({
    decisions: [tight[0]],
    subscriptions: [...subscriptions, ...rejectedSubscriptions],
    checkpoint: effects.checkpoint,
    inbox: effects.inbox,
  });
  assert.equal(
    effects.items.size,
    expectedCurrentSubscriptions,
    'retry delivers every current destination exactly once',
  );
  assert.equal(
    effects.checkpoints.get(tight[0].scope_digest).decision_revision,
    tight[0].decision_revision,
  );
  assert.ok(
    [...effects.items.values()].every((item) =>
      subscriptions.some(
        (subscription: { subscription_id: string }) =>
          subscription.subscription_id === item.destination.subscription_id,
      ),
    ),
  );
  const retried = effects.attempts.filter((item) => item.subscription_id === 'sub-claude-code');
  assert.equal(retried.length, 2);
  assert.equal(retried[0]!.id, retried[1]!.id, 'retry id is stable');
}

test('fixture oracle accepts R2 machine-wide signal posture and crash-safe fan-out', async () => {
  await exercise(knownGood);
});

test('fixture oracle kills bounded R2 counterfeit classes', async () => {
  for (const id of manifest.counterfeits as string[]) {
    const counterfeit = (counterfeits as Record<string, Implementation>)[id];
    assert.ok(counterfeit, id);
    await assert.rejects(() => exercise(counterfeit));
  }
});

test('production projector delta retains collector/schema/auth provenance directly', () => {
  const signal = manifest.signals[3];
  const healthy = projectProductionPosture(signal, { state: 'healthy' });
  const tight = projectProductionPosture(signal, { state: 'tight' });
  const out = projectProductionNotifications({
    previous: [healthy],
    decisions: [tight],
    subscriptions: [subscriptions[0]],
  });
  assert.equal(out.deltas.length, 1);
  assert.deepEqual(out.deltas[0]?.source, {
    collector_id: 'cursor-agent-dashboard',
    source_schema: 'cursor/GetCurrentPeriodUsage/v1',
    auth_source: 'cursor-agent-current-login',
  });
  assert.deepEqual(out.notifications[0]?.payload.source, out.deltas[0]?.source);

  const legacyStale = projectProductionPosture(signal, { state: 'stale' } as any);
  const staleOut = projectProductionNotifications({
    previous: [healthy],
    decisions: [legacyStale],
    subscriptions: [subscriptions[0]],
  });
  assert.equal(legacyStale.state, 'unknown');
  assert.equal(legacyStale.freshness, 'hard-stale');
  assert.deepEqual(legacyStale.reason_codes, ['QUOTA_HARD_STALE']);
  assert.equal(staleOut.deltas[0]?.edge, 'became_unknown');
});

const CURSOR_USAGE_PATH = '/aiserver.v1.DashboardService/GetCurrentPeriodUsage';

async function startCursorDashboardProbe(
  root: string,
  options: { agentUsedPercentage?: number } = {},
) {
  const logPath = join(root, 'cursor-dashboard-requests.ndjson');
  const ideToken = 'fixture-ide-token';
  const agentToken = 'fixture-agent-token';
  const cycleEndMs = Date.now() + 2_592_000_000;
  writeFileSync(logPath, '');
  const worker = new Worker(
    String.raw`
      const { appendFileSync } = require('node:fs');
      const { createServer } = require('node:http');
      const { parentPort, workerData } = require('node:worker_threads');
      const server = createServer((request, response) => {
        const authorization = request.headers.authorization || '';
        appendFileSync(
          workerData.logPath,
          JSON.stringify({ method: request.method, path: request.url, authorization }) + '\n',
        );
        request.resume();
        if (request.url !== workerData.usagePath || request.method !== 'POST') {
          response.writeHead(404).end();
          return;
        }
        const used =
          authorization === 'Bearer ' + workerData.ideToken
            ? 20
            : authorization === 'Bearer ' + workerData.agentToken
              ? workerData.agentUsedPercentage
              : null;
        if (used === null) {
          response.writeHead(401).end();
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            billingCycleStart: String(Date.now() - 86_400_000),
            billingCycleEnd: String(workerData.cycleEndMs),
            planUsage: { totalPercentUsed: used },
          }),
        );
      });
      server.listen(0, '127.0.0.1', () => {
        parentPort.postMessage({ port: server.address().port });
      });
      parentPort.on('message', (message) => {
        if (message === 'close') server.close(() => parentPort.postMessage({ closed: true }));
      });
    `,
    {
      eval: true,
      workerData: {
        logPath,
        ideToken,
        agentToken,
        agentUsedPercentage: options.agentUsedPercentage ?? 95,
        cycleEndMs,
        usagePath: CURSOR_USAGE_PATH,
      },
    },
  );
  const port = await new Promise<number>((resolve, reject) => {
    worker.once('error', reject);
    worker.once('message', (message: { port?: number }) => {
      if (typeof message.port === 'number') resolve(message.port);
      else reject(new Error('cursor dashboard probe did not report a port'));
    });
  });
  return {
    agentToken,
    apiBase: `http://127.0.0.1:${port}`,
    billingPeriodResetsAt: Math.floor(cycleEndMs / 1000),
    ideToken,
    logPath,
    close: async () => {
      worker.postMessage('close');
      await worker.terminate();
    },
  };
}

test('production refresh discovers Cursor IDE and Cursor Agent auth independently and calls GetCurrentPeriodUsage', {
  skip: !runProduction,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-machine-quota-cursor-live-'));
  const home = join(root, '.cc_master');
  const binDir = join(root, 'bin');
  const cursorBin = join(binDir, 'cursor');
  const cursorAgentBin = join(binDir, 'cursor-agent');
  const cursorAgentAuth = join(root, 'cursor-agent-auth.json');
  mkdirSync(binDir, { recursive: true });
  for (const binary of [cursorBin, cursorAgentBin]) {
    writeFileSync(binary, '#!/bin/sh\nexit 0\n');
    chmodSync(binary, 0o755);
  }
  const dashboard = await startCursorDashboardProbe(root);
  writeFileSync(cursorAgentAuth, JSON.stringify({ accessToken: dashboard.agentToken }));
  try {
    const { createProductionQuotaEffectBoundary } = await import(
      '../src/quota-production-effects.js'
    );
    const { run } = await import('../src/router.js');
    const env = {
      HOME: root,
      PATH: binDir,
      CC_MASTER_HOME: home,
      CCM_CURSOR_API_BASE: dashboard.apiBase,
      CCM_CURSOR_BIN: cursorBin,
      CCM_CURSOR_AGENT_BIN: cursorAgentBin,
      CCM_CURSOR_AGENT_AUTH_FILE: cursorAgentAuth,
      CCM_CURSOR_IDE_ACCESS_TOKEN: dashboard.ideToken,
      CCM_CURSOR_USAGE_TIMEOUT_MS: '2000',
    };
    const invoke = async (argv: string[]) => {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const code = await run(argv, {
        out: (line: string) => stdout.push(line),
        err: (line: string) => stderr.push(line),
        env,
        quotaEffects: createProductionQuotaEffectBoundary({ home }),
      } as any);
      return { code, stdout, stderr };
    };

    const refresh = await invoke(['quota', 'refresh', '--machine-wide', '--json']);
    assert.equal(refresh.code, 0, refresh.stderr.join('\n'));
    const status = await invoke(['quota', 'status', '--machine-wide', '--json']);
    assert.equal(status.code, 0, status.stderr.join('\n'));
    const payload = JSON.parse(status.stdout.at(-1) || '{}');
    const decisions = payload.summary?.decisions;
    assert.ok(Array.isArray(decisions), 'production status must expose cached surface decisions');
    const cursorIde = decisions.find(
      (decision: any) => decision.target?.surface_id === 'cursor-ide-plugin',
    );
    const cursorAgent = decisions.find(
      (decision: any) => decision.target?.surface_id === 'cursor-agent-cli',
    );
    assert.ok(cursorIde, 'Cursor IDE surface decision is missing');
    assert.ok(cursorAgent, 'Cursor Agent surface decision is missing');
    assert.equal(cursorIde.state, 'healthy');
    assert.equal(cursorAgent.state, 'exhausted');
    assert.deepEqual(cursorIde.source, {
      collector_id: 'cursor-dashboard',
      source_schema: 'cursor/GetCurrentPeriodUsage/v1',
      auth_source: 'cursor-ide-current-login',
    });
    assert.deepEqual(cursorAgent.source, {
      collector_id: 'cursor-agent-dashboard',
      source_schema: 'cursor/GetCurrentPeriodUsage/v1',
      auth_source: 'cursor-agent-current-login',
    });
    assertSafe(payload);

    const requests = readFileSync(dashboard.logPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(requests.length, 2, 'both Cursor surfaces must perform a live dashboard read');
    assert.ok(
      requests.every((request) => request.method === 'POST' && request.path === CURSOR_USAGE_PATH),
    );
    assert.deepEqual(
      requests.map((request) => request.authorization).sort(),
      [`Bearer ${dashboard.agentToken}`, `Bearer ${dashboard.ideToken}`].sort(),
      'Cursor Agent must not reuse the IDE credential or merely relabel its provenance',
    );
  } finally {
    await dashboard.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('production usage show/advise expose Cursor Agent current-login billing period and retain healthy reset', {
  skip: !runProduction,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-machine-quota-cursor-agent-usage-'));
  const home = join(root, '.cc_master');
  const binDir = join(root, 'bin');
  const cursorAgentBin = join(binDir, 'cursor-agent');
  const cursorAgentAuth = join(root, 'cursor-agent-auth.json');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(cursorAgentBin, '#!/bin/sh\nexit 0\n');
  chmodSync(cursorAgentBin, 0o755);
  const dashboard = await startCursorDashboardProbe(root, { agentUsedPercentage: 42 });
  writeFileSync(cursorAgentAuth, JSON.stringify({ accessToken: dashboard.agentToken }));
  try {
    const { run } = await import('../src/router.js');
    const env = {
      HOME: root,
      PATH: binDir,
      CC_MASTER_HOME: home,
      CCM_CURSOR_API_BASE: dashboard.apiBase,
      CCM_CURSOR_AGENT_BIN: cursorAgentBin,
      CCM_CURSOR_AGENT_AUTH_FILE: cursorAgentAuth,
      CCM_CURSOR_ACCESS_TOKEN: dashboard.ideToken,
      CCM_CURSOR_USAGE_TIMEOUT_MS: '2000',
    };
    const invoke = async (argv: string[]) => {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const code = await run(argv, {
        out: (line: string) => stdout.push(line),
        err: (line: string) => stderr.push(line),
        env,
      } as any);
      return { code, stdout, stderr };
    };

    // Invoke both public commands before asserting. A missing runtime must therefore fail on the
    // returned availability/field contract, never on command setup or an import-only probe.
    const showResult = await invoke([
      'usage',
      'show',
      '--harness',
      'cursor-agent',
      '--accounts',
      'current',
      '--json',
    ]);
    const adviseResult = await invoke(['usage', 'advise', '--harness', 'cursor-agent', '--json']);
    assert.equal(showResult.code, 0, showResult.stderr.join('\n'));
    assert.equal(adviseResult.code, 0, adviseResult.stderr.join('\n'));

    const showData = JSON.parse(showResult.stdout.at(-1) || '{}').data;
    const adviseData = JSON.parse(adviseResult.stdout.at(-1) || '{}').data;
    assert.equal(
      showData?.available,
      true,
      'Cursor Agent auth-file collector must make usage show available',
    );
    assert.equal(showData.current?.available, true);
    assert.deepEqual(showData.current?.billing_period, {
      used_percentage: 42,
      resets_at: dashboard.billingPeriodResetsAt,
    });
    assert.equal(showData.current?.source, 'cursor-agent-dashboard');
    assert.ok(Number.isFinite(Date.parse(showData.as_of)), 'show must retain observation as_of');

    assert.equal(adviseData?.available, true);
    assert.equal(adviseData.verdict, 'hold', '42% is a healthy/non-stop billing-period posture');
    assert.equal(adviseData.window_billing_period_pct, 42);
    assert.equal(
      adviseData.billing_period_resets_at,
      dashboard.billingPeriodResetsAt,
      'healthy/hold must not discard billing-cycle reset provenance',
    );
    assert.ok(
      Number.isFinite(Date.parse(adviseData.as_of)),
      'advise must retain observation as_of',
    );

    const requests = readFileSync(dashboard.logPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(
      requests.length,
      1,
      'show fills the machine TTL cache once and advise reuses the same observation',
    );
    assert.ok(
      requests.every(
        (request) =>
          request.method === 'POST' &&
          request.path === CURSOR_USAGE_PATH &&
          request.authorization === `Bearer ${dashboard.agentToken}`,
      ),
      'Cursor Agent query commands must use Agent auth-file data, never the simultaneously present IDE token',
    );
  } finally {
    await dashboard.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function productionBoundary() {
  const decision = knownGood.projectPosture(manifest.signals[0], { state: 'tight' });
  const effects = memoryEffects('sub-codex');
  const counters = { cached_reads: 0, live_reads: 0, account_switches: 0 };
  return {
    decision,
    effects,
    counters,
    boundary: {
      readPostures: async ({ refresh }: { refresh: boolean }) => {
        if (refresh) counters.live_reads += 1;
        else counters.cached_reads += 1;
        return [decision];
      },
      listSubscriptions: async () => [...subscriptions, ...rejectedSubscriptions],
      readCheckpoint: effects.checkpoint.read,
      publishCheckpoint: effects.checkpoint.publish,
      putInbox: effects.inbox.put,
      switchAccount: async () => {
        counters.account_switches += 1;
        throw new Error('ACCOUNT_SWITCH_FORBIDDEN');
      },
    },
  };
}

async function runCli(argv: string[], boundary: any, env: Record<string, string | undefined> = {}) {
  const { run } = await import('../src/router.js');
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(argv, {
    out: (line: string) => stdout.push(line),
    err: (line: string) => stderr.push(line),
    env,
    quotaEffects: {} as any,
    machineWideQuotaNotifications: boundary,
  } as any);
  return { code, stdout, stderr };
}

test('production quota status is zero-effect through the real registry/handler seam', {
  skip: !runProduction,
}, async () => {
  const production = productionBoundary();
  const result = await runCli(['quota', 'status', '--machine-wide', '--json'], production.boundary);
  assert.equal(result.code, 0, result.stderr.join('\n'));
  assert.equal(production.counters.cached_reads, 1);
  assert.equal(production.counters.live_reads, 0);
  assert.equal(production.effects.items.size, 0);
  assert.equal(production.effects.checkpoints.size, 0);
  assert.equal(JSON.parse(result.stdout.at(-1) || '{}').schema, 'ccm/machine-quota-status/v1');
});

test('production explicit refresh retries partial fan-out without checkpoint loss', {
  skip: !runProduction,
}, async () => {
  const production = productionBoundary();
  const implicit = await runCli(['quota', 'refresh', '--json'], production.boundary);
  assert.equal(implicit.code, 2, 'refresh without --machine-wide is a usage error');
  assert.equal(production.counters.live_reads, 0);

  const first = await runCli(['quota', 'refresh', '--machine-wide', '--json'], production.boundary);
  assert.notEqual(first.code, 0, 'injected partial inbox failure must be observable');
  assert.equal(production.effects.checkpoints.size, 0, 'checkpoint cannot run ahead of fan-out');
  const second = await runCli(
    ['quota', 'refresh', '--machine-wide', '--json'],
    production.boundary,
  );
  assert.equal(second.code, 0, second.stderr.join('\n'));
  assert.equal(production.counters.live_reads, 2);
  assert.equal(production.effects.items.size, expectedCurrentSubscriptions);
  assert.equal(production.effects.checkpoints.size, 1);
  assert.equal(production.counters.account_switches, 0);
  const retried = production.effects.attempts.filter(
    (item) => item.subscription_id === 'sub-claude-code',
  );
  assert.equal(retried.length, 2);
  assert.equal(retried[0]!.id, retried[1]!.id);
});

test('production monitor keeps cached-only default and persists explicit source mode', {
  skip: !runProduction,
}, async () => {
  const { __resetMonitorTestHooks, __setMonitorTestHooks } = await import(
    '../src/handlers/monitor.js'
  );
  const root = mkdtempSync(join(tmpdir(), 'ccm-machine-quota-monitor-'));
  const env = { HOME: join(root, 'user'), XDG_CONFIG_HOME: join(root, 'xdg') };
  const production = productionBoundary();
  __setMonitorTestHooks({
    runtimePlatform: 'linux',
    runServiceCommand: () => ({ status: 0, stdout: '', stderr: '' }),
    isPidAlive: () => false,
  });
  try {
    const cachedHome = join(root, 'cached-home');
    const cached = await runCli(
      ['monitor', 'install-service', '--home', cachedHome, '--json'],
      production.boundary,
      env,
    );
    assert.equal(cached.code, 0, cached.stderr.join('\n'));
    const cachedStatus = await runCli(
      ['monitor', 'status', '--home', cachedHome, '--json'],
      production.boundary,
      env,
    );
    assert.equal(
      JSON.parse(cachedStatus.stdout.at(-1) || '{}').service.quota_source_mode,
      'cached-only',
    );
    assert.equal(
      production.counters.live_reads,
      0,
      'install/default cannot autostart live quota refresh',
    );

    const liveHome = join(root, 'live-home');
    const live = await runCli(
      [
        'monitor',
        'install-service',
        '--quota-source',
        'machine-wide',
        '--home',
        liveHome,
        '--json',
      ],
      production.boundary,
      env,
    );
    assert.equal(live.code, 0, live.stderr.join('\n'));
    const liveStatus = await runCli(
      ['monitor', 'status', '--home', liveHome, '--json'],
      production.boundary,
      env,
    );
    assert.equal(
      JSON.parse(liveStatus.stdout.at(-1) || '{}').service.quota_source_mode,
      'machine-wide',
    );
    assert.equal(
      production.counters.live_reads,
      0,
      'install persists mode but does not itself collect',
    );
  } finally {
    __resetMonitorTestHooks();
    rmSync(root, { recursive: true, force: true });
  }
});
