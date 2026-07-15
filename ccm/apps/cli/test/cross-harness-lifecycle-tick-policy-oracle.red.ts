// Constraint-parity promotion oracle for the C3 monitor lifecycle slice.
// It is deliberately outside the default *.test.ts suite. Run from ccm/apps/cli:
//   CCM_XH_C3_LIFECYCLE_FIXTURE_ONLY=1 node --import tsx --test test/cross-harness-lifecycle-tick-policy-oracle.red.ts
//   CCM_XH_C3_LIFECYCLE_TARGET_ROOT=/path/to/main node --import tsx --test test/cross-harness-lifecycle-tick-policy-oracle.red.ts

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

type Harness = 'claude-code' | 'codex' | 'cursor';

interface Registration {
  event: string;
  matcher: string;
  command: string;
}

interface EffectEvent {
  invoked_as: string;
  argv: string[];
  schema: string;
  allowed: boolean;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(HERE, 'fixtures', 'cross-harness-lifecycle-tick-policy-v1');
const CONTRACT_ROOT = resolve(HERE, '..', '..', '..', '..');
const TARGET_ROOT = resolve(process.env.CCM_XH_C3_LIFECYCLE_TARGET_ROOT || CONTRACT_ROOT);
const FIXTURE_ONLY = process.env.CCM_XH_C3_LIFECYCLE_FIXTURE_ONLY === '1';
const SENTINEL = join(FIXTURE_ROOT, 'ccm-effect-sentinel.mjs');
const TEMP_ROOTS: string[] = [];

function makeTemp(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `ccm-xh-c3-oracle-${label}-`));
  TEMP_ROOTS.push(root);
  return root;
}

after(() => {
  for (const root of TEMP_ROOTS) rmSync(root, { recursive: true, force: true });
});

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function hostManifest(harness: Harness): string {
  return join(TARGET_ROOT, 'plugin', 'src', 'hooks', '_hosts', harness, 'hooks.json');
}

function distRoot(harness: Harness): string {
  return join(TARGET_ROOT, 'plugin', 'dist', harness);
}

function registrations(harness: Harness): Registration[] {
  const manifest = readJson<{ hooks: Record<string, unknown[]> }>(hostManifest(harness));
  const found: Registration[] = [];
  for (const [event, groups] of Object.entries(manifest.hooks)) {
    for (const groupValue of groups) {
      const group = groupValue as { matcher?: string; command?: string; hooks?: unknown[] };
      if (typeof group.command === 'string') {
        found.push({ event, matcher: group.matcher || '', command: group.command });
      }
      for (const hookValue of group.hooks || []) {
        const hook = hookValue as { command?: string };
        if (typeof hook.command === 'string') {
          found.push({ event, matcher: group.matcher || '', command: hook.command });
        }
      }
    }
  }
  return found;
}

function makeLifecycleBox(label: string) {
  const root = makeTemp(label);
  const home = join(root, '.cc_master');
  const bin = join(root, 'bin');
  const log = join(root, 'effects.jsonl');
  mkdirSync(join(home, 'boards'), { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(log, '');
  for (const command of [
    'ccm',
    'claude',
    'codex',
    'curl',
    'cursor',
    'cursor-agent',
    'launchctl',
    'security',
    'systemctl',
    'wget',
  ]) {
    const target = join(bin, command);
    copyFileSync(SENTINEL, target);
    chmodSync(target, 0o755);
  }
  const nodeDir = dirname(process.execPath);
  return {
    root,
    home,
    bin,
    log,
    env: {
      PATH: `${bin}:${nodeDir}:/usr/bin:/bin`,
      HOME: join(root, 'empty-user-home'),
      CLAUDE_CONFIG_DIR: join(root, 'empty-claude-config'),
      CLAUDE_PROJECT_DIR: join(root, 'project'),
      CC_MASTER_HOME: home,
      CCM_BIN: join(bin, 'ccm'),
      CCM_XH_C3_EFFECT_LOG: log,
      CC_MASTER_HOOK_DIAGNOSTIC: '0',
      CC_MASTER_HOOK_DIAGNOSTIC_UNSAFE_RAW: '0',
    } as NodeJS.ProcessEnv,
  };
}

function registrationSchema(registration: Registration): string {
  if (registration.command.includes('bootstrap-board')) return 'arm';
  if (registration.command.includes('orchestrator-context')) return 'orchestrator-context';
  if (registration.command.includes('reinject')) return 'reinject';
  throw new Error(`no ccm argv schema for lifecycle entry: ${registration.command}`);
}

function boardValue(sessionId: string, active = true): Record<string, unknown> {
  return {
    schema: 'cc-master-board/v2',
    goal: 'manifest reachability fixture',
    owner: { active, session_id: sessionId, heartbeat: '2026-07-15T00:00:00Z' },
    git: { repo: '', branch: '', base: '' },
    tasks: [],
    log: [],
  };
}

function seedBoard(home: string, name: string, sessionId: string, active = true): string {
  const path = join(home, 'boards', name);
  writeFileSync(path, `${JSON.stringify(boardValue(sessionId, active), null, 2)}\n`);
  return path;
}

function resolvedCommand(harness: Harness, command: string, dataRoot: string): string {
  const pathToken = (name: string) => `${String.fromCharCode(36)}{${name}}`;
  return command
    .replaceAll(pathToken('CLAUDE_PLUGIN_ROOT'), distRoot(harness))
    .replaceAll(pathToken('PLUGIN_ROOT'), distRoot(harness))
    .replaceAll(pathToken('PLUGIN_DATA'), dataRoot);
}

function runRegistration(
  harness: Harness,
  registration: Registration,
  payload: Record<string, unknown>,
  box: ReturnType<typeof makeLifecycleBox>,
): void {
  const command = resolvedCommand(harness, registration.command, join(box.root, 'plugin-data'));
  const result = spawnSync('/bin/sh', ['-c', command], {
    cwd: harness === 'cursor' ? distRoot(harness) : TARGET_ROOT,
    env: {
      ...box.env,
      CC_MASTER_PLUGIN_ROOT: distRoot(harness),
      CC_MASTER_HARNESS: harness,
      CCM_XH_C3_ALLOWED_CCM_SCHEMA: registrationSchema(registration),
      CCM_XH_C3_EVENT: registration.event,
      CCM_XH_C3_HARNESS: harness,
    },
    input: `${JSON.stringify(payload)}\n`,
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(
    result.status,
    0,
    `${harness}:${registration.event}:${basename(registration.command)} failed: ${result.error || result.signal || result.stderr}`,
  );
}

function effectEvents(log: string): EffectEvent[] {
  const text = readFileSync(log, 'utf8').trim();
  return text ? text.split('\n').map((line) => JSON.parse(line) as EffectEvent) : [];
}

function assertLifecycleEffectsClosed(label: string, log: string): void {
  const forbidden = effectEvents(log).filter((event) => event.invoked_as !== 'ccm' || !event.allowed);
  assert.deepEqual(forbidden, [], `${label}: manifest entry crossed a forbidden effect boundary`);
}

function assertArmed(home: string, sessionId: string, diagnostic: string): void {
  const files = readdirSync(join(home, 'boards')).filter((file) => file.endsWith('.board.json'));
  assert.ok(
    files.length > 0,
    `ARM manifest entry did not create or retain a board; effects=${diagnostic}`,
  );
  const armed = files
    .map((file) => readJson<Record<string, any>>(join(home, 'boards', file)))
    .filter((board) => board.owner?.active === true && board.owner?.session_id === sessionId);
  assert.equal(armed.length, 1, `expected one board armed to ${sessionId}`);
}

function runManifestArm(harness: Harness, mode: 'fresh' | 'resume'): void {
  const entries = registrations(harness).filter((entry) =>
    entry.command.includes('bootstrap-board'),
  );
  assert.equal(entries.length, 1, `${harness}: manifest must expose exactly one ARM entry`);
  const box = makeLifecycleBox(`${harness}-arm-${mode}`);
  const sid = `${harness}-${mode}-session`;
  if (mode === 'resume') seedBoard(box.home, 'resume-fixture.board.json', 'old-session', false);
  const request =
    mode === 'resume'
      ? '--resume resume-fixture --force-takeover'
      : 'manifest reachability fixture';
  const prompt =
    harness === 'codex'
      ? `$cc-master:cc-master-as-master-orchestrator ${request}`
      : harness === 'cursor'
        ? `/as-master-orchestrator ${request}`
        : `/cc-master:as-master-orchestrator ${request}`;
  runRegistration(
    harness,
    entries[0]!,
    harness === 'cursor'
      ? { conversation_id: sid, hook_event_name: entries[0]!.event, prompt }
      : { session_id: sid, hook_event_name: entries[0]!.event, prompt },
    box,
  );
  assertArmed(box.home, sid, readFileSync(box.log, 'utf8'));
  assertLifecycleEffectsClosed(`${harness}:${mode}`, box.log);
}

function runManifestLifecycle(harness: Harness): void {
  const box = makeLifecycleBox(`${harness}-lifecycle`);
  const sid = `${harness}-lifecycle-session`;
  seedBoard(box.home, 'active.board.json', sid, true);
  const entries = registrations(harness);

  if (harness !== 'cursor') {
    const sessionEntries = entries.filter((entry) => entry.event === 'SessionStart');
    assert.equal(sessionEntries.length, 2, `${harness}: registered SessionStart entries`);
    for (const entry of sessionEntries) {
      const modes = entry.matcher.split('|').filter(Boolean);
      assert.ok(modes.length > 0, `${harness}: SessionStart matcher must declare modes`);
      for (const source of modes) {
        runRegistration(
          harness,
          entry,
          { session_id: sid, hook_event_name: entry.event, source },
          box,
        );
      }
    }
  } else {
    assert.equal(
      entries.some((entry) => entry.event === 'sessionStart'),
      false,
      'Cursor must not counterfeit unavailable dynamic SessionStart',
    );
    const substitutes = entries.filter(
      (entry) =>
        (entry.event === 'postToolUse' && entry.command.includes('orchestrator-context')) ||
        (entry.event === 'preCompact' && entry.command.includes('reinject')),
    );
    assert.deepEqual(
      substitutes.map((entry) => entry.event).sort(),
      ['postToolUse', 'preCompact'],
      'Cursor manifest must declare both Track-B lifecycle substitutes',
    );
    for (const entry of substitutes) {
      runRegistration(
        harness,
        entry,
        {
          conversation_id: sid,
          session_id: sid,
          hook_event_name: entry.event,
          tool_name: entry.event === 'postToolUse' ? 'Read' : undefined,
        },
        box,
      );
    }
  }
  assertLifecycleEffectsClosed(`${harness}:lifecycle`, box.log);
}

function assertCcmCounterfeitRejected(
  label: string,
  schema: string,
  harness: Harness,
  argv: string[],
): EffectEvent {
  const box = makeLifecycleBox(`ccm-counterfeit-${label}`);
  const result = spawnSync(join(box.bin, 'ccm'), argv, {
    env: {
      ...box.env,
      CCM_XH_C3_ALLOWED_CCM_SCHEMA: schema,
      CCM_XH_C3_EVENT: 'counterfeit-calibration',
      CCM_XH_C3_HARNESS: harness,
    },
    encoding: 'utf8',
    timeout: 5_000,
  });
  assert.equal(
    result.status,
    95,
    `${label}: counterfeit ccm argv was not rejected by the default-deny sentinel: ${result.stderr}`,
  );
  const events = effectEvents(box.log);
  assert.equal(events.length, 1, `${label}: expected exactly one ccm attempt`);
  assert.equal(events[0]!.allowed, false, `${label}: sentinel logged counterfeit as allowed`);
  return events[0]!;
}

function makeTickState(label: string) {
  const root = makeTemp(`tick-${label}`);
  const home = join(root, 'home');
  const service = join(home, 'services', 'monitor');
  const boards = join(home, 'boards');
  const state = join(service, 'state.json');
  mkdirSync(service, { recursive: true });
  mkdirSync(boards, { recursive: true });
  seedBoard(home, 'active.board.json', 'oracle-session', true);
  writeFileSync(
    state,
    `${JSON.stringify(
      {
        schema: 'ccm/monitor-service/v1',
        id: 'monitor',
        pid: 0,
        wanted: true,
        home,
        state_path: state,
        pid_path: join(service, 'pid'),
        log_path: join(service, 'log'),
        interval_sec: 45,
        server: { started_at: '2026-07-15T00:00:00Z', ccm_version: 'oracle' },
        last_tick_at: null,
        last_error: null,
        tick_count: 0,
      },
      null,
      2,
    )}\n`,
  );
  const deniedRoot = makeTemp(`denied-${label}`);
  const credential = join(deniedRoot, 'credentials.sqlite');
  const serviceWanted = join(service, 'undeclared-service-state.json');
  writeFileSync(credential, 'not-a-real-credential-db');
  return { root, home, service, boards, state, credential, serviceWanted };
}

function tsdownExecutable(): string {
  const candidates = [
    process.env.CCM_XH_C3_TSDOWN,
    join(TARGET_ROOT, 'ccm', 'node_modules', '.bin', 'tsdown'),
    join(CONTRACT_ROOT, 'ccm', 'node_modules', '.bin', 'tsdown'),
  ].filter((value): value is string => Boolean(value));
  const found = candidates.find((candidate) => existsSync(candidate));
  assert.ok(found, 'exact production materialization requires the target checkout tsdown executable');
  return found;
}

function materializeProductionModules(
  label: string,
  monitorModule: string,
  bundleRoot: string,
): { monitor: string; sourcePolicy: string } {
  const tsdown = tsdownExecutable();
  const monitor = spawnSync(
    tsdown,
    [
      monitorModule,
      '--no-config',
      '--format',
      'esm',
      '--out-dir',
      bundleRoot,
      '--platform',
      'node',
      '--logLevel',
      'error',
      '--unbundle',
    ],
    { cwd: join(TARGET_ROOT, 'ccm', 'apps', 'cli'), encoding: 'utf8', timeout: 15_000 },
  );
  assert.equal(
    monitor.status,
    0,
    `${label}: could not materialize exact production monitor source graph: ${monitor.stderr}`,
  );
  const executableMonitor = join(bundleRoot, 'monitor.mjs');
  assert.ok(existsSync(executableMonitor), `${label}: production monitor bundle missing`);

  const engineRoot = join(bundleRoot, 'node_modules', '@ccm', 'engine');
  const engineOut = join(engineRoot, 'dist');
  mkdirSync(engineOut, { recursive: true });
  const engine = spawnSync(
    tsdown,
    [
      join(TARGET_ROOT, 'ccm', 'packages', 'engine', 'src', 'index.ts'),
      '--no-config',
      '--format',
      'esm',
      '--out-dir',
      engineOut,
      '--platform',
      'node',
      '--logLevel',
      'error',
    ],
    {
      cwd: join(TARGET_ROOT, 'ccm', 'packages', 'engine'),
      encoding: 'utf8',
      timeout: 15_000,
    },
  );
  assert.equal(
    engine.status,
    0,
    `${label}: could not materialize exact target @ccm/engine source: ${engine.stderr}`,
  );
  assert.ok(existsSync(join(engineOut, 'index.mjs')), `${label}: exact target engine bundle missing`);
  writeFileSync(
    join(engineRoot, 'package.json'),
    `${JSON.stringify({ name: '@ccm/engine', type: 'module', exports: { '.': './dist/index.mjs' } })}\n`,
  );

  return {
    monitor: executableMonitor,
    sourcePolicy: join(bundleRoot, 'monitor-source-composition.mjs'),
  };
}

function runTickProbe(
  label: string,
  monitorModule: string,
  counterfeit?: string,
): ReturnType<typeof spawnSync> {
  const box = makeTickState(label);
  const preload = join(FIXTURE_ROOT, 'sandbox-preload.mjs');
  const probe = join(FIXTURE_ROOT, 'tick-probe.mjs');
  let executableModule = monitorModule;
  let sourcePolicyModule = join(FIXTURE_ROOT, 'known-good-source-policy.mjs');
  if (monitorModule.endsWith('.ts')) {
    const bundleRoot = join(box.root, 'bundle');
    const materialized = materializeProductionModules(label, monitorModule, bundleRoot);
    executableModule = materialized.monitor;
    sourcePolicyModule = materialized.sourcePolicy;
  }
  return spawnSync(
    process.execPath,
    [
      '--permission',
      `--allow-fs-read=${CONTRACT_ROOT}`,
      `--allow-fs-read=${CONTRACT_ROOT.toUpperCase()}`,
      `--allow-fs-read=${TARGET_ROOT}`,
      `--allow-fs-read=${TARGET_ROOT.toUpperCase()}`,
      `--allow-fs-read=${box.root}`,
      `--allow-fs-write=${box.service}`,
      `--allow-fs-write=${box.boards}`,
      '--import',
      preload,
      probe,
    ],
    {
      cwd: join(CONTRACT_ROOT, 'ccm', 'apps', 'cli'),
      env: {
        PATH: dirname(process.execPath),
        HOME: join(dirname(box.root), 'permission-denied-home'),
        CC_MASTER_HOME: box.home,
        CCM_XH_C3_MONITOR_MODULE: executableModule,
        CCM_XH_C3_SOURCE_POLICY_MODULE: sourcePolicyModule,
        CCM_XH_C3_STATE_PATH: box.state,
        CCM_XH_C3_COUNTERFEIT: counterfeit || '',
        CCM_XH_C3_FORBIDDEN_CREDENTIAL_PATH: box.credential,
        CCM_XH_C3_FORBIDDEN_SERVICE_PATH: box.serviceWanted,
      },
      encoding: 'utf8',
      timeout: 15_000,
    },
  );
}

function assertProbeGreen(label: string, result: ReturnType<typeof spawnSync>): void {
  assert.equal(
    result.status,
    0,
    `${label}: expected green probe, got ${result.error || result.signal || result.stderr}`,
  );
  assert.match(String(result.stdout || ''), /"policy\.commit:cached-only","cache\.read"/);
}

function assertProbeRejected(
  label: string,
  result: ReturnType<typeof spawnSync>,
  evidence: RegExp,
): void {
  assert.notEqual(result.status, 0, `${label}: counterfeit escaped the lifecycle oracle`);
  assert.match(
    `${result.stdout || ''}\n${result.stderr || ''}`,
    evidence,
    `${label}: failed for an unrelated reason instead of the expected constraint`,
  );
}

test('three-host ARM and lifecycle cases are discovered and executed from host manifests', () => {
  for (const harness of ['claude-code', 'codex', 'cursor'] as const) {
    const pluginManifest = readJson<{ hooks?: string }>(
      join(
        TARGET_ROOT,
        'plugin',
        'src',
        `.${harness === 'claude-code' ? 'claude' : harness}-plugin`,
        'plugin.json',
      ),
    );
    if (harness !== 'claude-code') assert.equal(pluginManifest.hooks, './hooks/hooks.json');
    assert.ok(existsSync(hostManifest(harness)), `${harness}: source hooks manifest missing`);
    runManifestArm(harness, 'fresh');
    runManifestArm(harness, 'resume');
    runManifestLifecycle(harness);
  }
});

test('ccm effects are default-deny with complete per-event argv schemas', () => {
  const board = join(makeTemp('ccm-counterfeit-board'), 'counterfeit.board.json');
  const cases: Array<[string, string, Harness, string[]]> = [
    ['board-init-monitor', 'arm', 'claude-code', ['board', 'init', '--monitor', '--json', '--no-input']],
    [
      'capability-option-suffix',
      'arm',
      'codex',
      ['board', 'init', '--capabilities', '--json', '--no-input', '--monitor'],
    ],
    [
      'goal-check-option-suffix',
      'reinject',
      'claude-code',
      ['goal', 'check', '--board', board, '--json', '--no-input', '--provider'],
    ],
    [
      'context-option-suffix',
      'orchestrator-context',
      'cursor',
      [
        'orchestrator',
        'context',
        '--cached-only',
        '--agent-visible',
        '--as-of',
        '2026-07-15T00:00:00Z',
        '--harness',
        'cursor',
        '--board',
        board,
        '--json',
        '--service',
      ],
    ],
    ['unknown-command-prefix', 'arm', 'codex', ['worker', 'status', '--json']],
  ];
  const denied = cases.map(([label, schema, harness, argv]) =>
    assertCcmCounterfeitRejected(label, schema, harness, argv),
  );
  assert.equal(denied.every((event) => event.allowed === false), true);
});

test('known-good public monitor tick consumes source policy in the same tick', () => {
  assertProbeGreen(
    'known-good',
    runTickProbe('known-good', join(FIXTURE_ROOT, 'known-good-monitor.mjs')),
  );
});

test('composition present but unused by the public tick is rejected', () => {
  assertProbeRejected(
    'unused-composition',
    runTickProbe('unused-composition', join(FIXTURE_ROOT, 'unused-composition-monitor.mjs')),
    /same-tick-consumption/,
  );
});

test('directly injected trace cannot counterfeit a source-policy composition invocation', () => {
  assertProbeRejected(
    'direct-trace',
    runTickProbe('direct-trace', join(FIXTURE_ROOT, 'direct-trace-monitor.mjs')),
    /AUTHENTIC_SOURCE_POLICY_REQUIRED[\s\S]*real source-policy composition invocation/,
  );
});

const EFFECT_COUNTERFEITS = {
  worker: /ERR_ACCESS_DENIED[\s\S]*WorkerThreads|WorkerThreads[\s\S]*ERR_ACCESS_DENIED/,
  fetch: /CLOSED_EFFECT_SANDBOX: fetch denied/,
  'fs-credential-read':
    /ERR_ACCESS_DENIED[\s\S]*FileSystemRead|FileSystemRead[\s\S]*ERR_ACCESS_DENIED/,
  'sqlite-credential-read': /CLOSED_EFFECT_SANDBOX: SQLite credential read denied/,
  'node-absolute-spawn':
    /ERR_ACCESS_DENIED[\s\S]*ChildProcess|ChildProcess[\s\S]*ERR_ACCESS_DENIED/,
  'direct-service-state': /CLOSED_EFFECT_SANDBOX: undeclared service state mutation denied/,
  'unknown-effect': /CLOSED_EFFECT_SANDBOX: unknown effect unregisteredEffect denied/,
} as const;

for (const [kind, evidence] of Object.entries(EFFECT_COUNTERFEITS)) {
  test(`closed effect sandbox rejects ${kind}`, () => {
    assertProbeRejected(
      kind,
      runTickProbe(kind, join(FIXTURE_ROOT, 'effect-counterfeit-monitor.mjs'), kind),
      evidence,
    );
  });
}

test('latest production public tick consumes source policy through the closed observer', {
  skip: FIXTURE_ONLY ? 'fixture-only calibration mode' : false,
}, () => {
  const production = join(TARGET_ROOT, 'ccm', 'apps', 'cli', 'src', 'handlers', 'monitor.ts');
  const result = runTickProbe('production', production);
  assert.equal(
    result.status,
    0,
    `HONEST RED [production-same-tick]: ${result.error || result.signal || result.stderr}`,
  );
  assert.match(String(result.stdout || ''), /"policy\.commit:cached-only","cache\.read"/);
});
