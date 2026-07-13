import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { parseSystemdUnit } from '@ccm/engine';
import * as monitor from '../src/handlers/monitor.js';
import { readVersion } from '../src/help.js';
import * as io from '../src/io.js';
import { run } from '../src/router.js';

const EXIT = io.EXIT;
const BRACED_HOME = `\${HOME}`;

let TMPDIRS: string[] = [];

afterEach(() => {
  monitor.__resetMonitorTestHooks();
  for (const d of TMPDIRS) rmSync(d, { recursive: true, force: true });
  TMPDIRS = [];
});

function mkHome(): string {
  const root = mkdtempSync(join(tmpdir(), 'ccm-monitor-'));
  TMPDIRS.push(root);
  const home = join(root, '.cc_master');
  mkdirSync(join(home, 'boards'), { recursive: true });
  return home;
}

function invoke(args: string[], home: string): { code: number; stdout: string; stderr: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(args, {
    env: { HOME: join(home, '..'), CC_MASTER_HOME: home },
    out: (s: string) => out.push(s),
    err: (s: string) => err.push(s),
  });
  assert.equal(typeof code, 'number', 'monitor lifecycle commands are sync except serve');
  return { code: code as number, stdout: out.join('\n'), stderr: err.join('\n') };
}

function json(stdout: string): any {
  return JSON.parse(stdout);
}

test('monitor start/status exposes binary_match and reuses healthy current-binary service', () => {
  const home = mkHome();
  let spawnCount = 0;
  monitor.__setMonitorTestHooks({
    now: () => new Date('2026-07-09T10:00:00Z'),
    spawnService: ({ statePath }) => {
      spawnCount += 1;
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      writeFileSync(statePath, `${JSON.stringify({ ...state, pid: 1234 }, null, 2)}\n`, 'utf8');
      return { pid: 1234 };
    },
    isPidAlive: (pid) => pid === 1234,
  });

  const first = invoke(['monitor', 'start', '--json'], home);
  assert.equal(first.code, EXIT.OK, first.stderr);
  assert.equal(json(first.stdout).reused, false);
  assert.equal(json(first.stdout).service.wanted, true);
  assert.equal(json(first.stdout).service.binary_match, true);
  assert.equal(spawnCount, 1);

  const second = invoke(['monitor', 'start', '--json'], home);
  assert.equal(second.code, EXIT.OK, second.stderr);
  assert.equal(json(second.stdout).reused, true);
  assert.equal(spawnCount, 1);

  const status = invoke(['monitor', 'status', '--json'], home);
  assert.equal(status.code, EXIT.OK);
  assert.equal(json(status.stdout).binary_match, true);
  assert.equal(json(status.stdout).running_ccm_version, readVersion());
});

test('monitor start forces restart when running service has stale ccm binary', () => {
  const home = mkHome();
  let pid = 2001;
  let spawnCount = 0;
  monitor.__setMonitorTestHooks({
    now: () => new Date('2026-07-09T10:00:00Z'),
    spawnService: ({ statePath }) => {
      spawnCount += 1;
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      writeFileSync(statePath, `${JSON.stringify({ ...state, pid }, null, 2)}\n`, 'utf8');
      return { pid };
    },
    isPidAlive: (candidate) => candidate === pid || candidate === 2001,
    kill: () => true,
  });

  const first = invoke(['monitor', 'start', '--json'], home);
  const statePath = json(first.stdout).service.state_path;
  const stale = JSON.parse(readFileSync(statePath, 'utf8'));
  writeFileSync(
    statePath,
    `${JSON.stringify({ ...stale, server: { ...stale.server, ccm_version: '0.0.1' } }, null, 2)}\n`,
    'utf8',
  );

  const status = invoke(['monitor', 'status', '--json'], home);
  assert.equal(json(status.stdout).binary_match, false);

  pid = 2002;
  const restarted = invoke(['monitor', 'start', '--json'], home);
  assert.equal(restarted.code, EXIT.OK, restarted.stderr);
  assert.equal(json(restarted.stdout).reused, false);
  assert.equal(json(restarted.stdout).service.pid, 2002);
  assert.equal(json(restarted.stdout).service.binary_match, true);
  assert.equal(spawnCount, 2);
});

test('monitor serve runs bounded ticks and records tick state without touching real home', async () => {
  const home = mkHome();
  const statePath = join(home, 'services', 'monitor', 'state.json');
  mkdirSync(join(home, 'services', 'monitor'), { recursive: true });
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        schema: 'ccm/monitor-service/v1',
        id: 'monitor',
        pid: 0,
        wanted: true,
        home,
        state_path: statePath,
        pid_path: join(home, 'services', 'monitor', 'pid'),
        log_path: join(home, 'services', 'monitor', 'log'),
        interval_sec: 5,
        server: { started_at: '2026-07-09T10:00:00Z', ccm_version: readVersion() },
        last_tick_at: null,
        last_error: null,
        tick_count: 0,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  monitor.__setMonitorTestHooks({
    now: () => new Date('2026-07-09T10:00:01Z'),
    tick: () => ({
      registry: {
        schema: 'ccm/machine-harness-registry/v1',
        installed: [],
        installedSurfaces: [],
        harnesses: [],
        pools: [],
      },
      checked_boards: 0,
      writes: 0,
      errors: [],
    }),
  });

  const out: string[] = [];
  const code = await monitor.serve({
    values: { state: statePath, iterations: '1' },
    positionals: [],
    flags: {
      json: false,
      dryRun: false,
      force: false,
      yes: false,
      quiet: false,
      verbose: false,
      color: false,
    },
    sid: '',
    env: { CC_MASTER_HOME: home },
    out: (s) => out.push(s),
    err: () => {},
  });
  assert.equal(code, EXIT.OK);
  assert.equal(out.length, 1);
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(state.pid, process.pid);
  assert.equal(state.tick_count, 1);
  assert.equal(state.last_error, null);
  assert.equal(statSync(statePath).mode & 0o777, 0o600, 'durable service state is owner-only');
});

function mkHomeUnder(dirName: string): string {
  const root = mkdtempSync(join(tmpdir(), 'ccm-monitor-'));
  TMPDIRS.push(root);
  const home = join(root, dirName, '.cc_master');
  mkdirSync(join(home, 'boards'), { recursive: true });
  return home;
}

test('monitor install-service: activation truth from executor result → ok:true only when all steps pass', () => {
  const home = mkHome();
  const seen: string[] = [];
  monitor.__setMonitorTestHooks({
    runServiceCommand: (cmd) => {
      seen.push(cmd.id);
      return { status: 0, stdout: 'active', stderr: '' };
    },
  });
  const r = invoke(['monitor', 'install-service', '--json'], home);
  assert.equal(r.code, EXIT.OK, r.stderr);
  const j = json(r.stdout);
  assert.equal(j.ok, true);
  assert.equal(j.installed, true);
  assert.equal(j.activated, true);
  assert.equal(j.kind, 'systemd');
  assert.equal(j.activation.state, 'active');
  // On Linux the systemd sequence runs daemon-reload → enable → is-active (status truth is the last step).
  assert.deepEqual(seen, ['daemon-reload', 'enable', 'status']);
  const unit = readFileSync(j.path, 'utf8');
  assert.match(unit, /ExecStart=/);
  assert.match(unit, /StandardOutput=append:/);
});

test('monitor install-service: is-active failure → nonzero exit + activated:false, no false success', () => {
  const home = mkHome();
  monitor.__setMonitorTestHooks({
    runServiceCommand: (cmd) => {
      // daemon-reload + enable succeed, but the unit did not actually come up.
      if (cmd.id === 'status') return { status: 3, stdout: 'inactive', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  const r = invoke(['monitor', 'install-service', '--json'], home);
  assert.notEqual(r.code, EXIT.OK, 'written-but-not-activated must be a nonzero result');
  const j = json(r.stdout);
  assert.equal(j.ok, false);
  assert.equal(j.installed, true, 'the unit file was still written');
  assert.equal(j.activated, false);
  assert.equal(j.activation.state, 'written-not-activated');
  const statusStep = j.activation.steps.find((s: { id: string }) => s.id === 'status');
  assert.equal(statusStep.ok, false);
  // The unit file exists on disk even though activation failed.
  assert.match(readFileSync(j.path, 'utf8'), /\[Service\]/);
});

test('monitor install-service: first-step (daemon-reload) failure fails loudly and stops early', () => {
  const home = mkHome();
  const seen: string[] = [];
  monitor.__setMonitorTestHooks({
    runServiceCommand: (cmd) => {
      seen.push(cmd.id);
      if (cmd.id === 'daemon-reload') return { status: 1, stdout: '', stderr: 'no user bus' };
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  const r = invoke(['monitor', 'install-service', '--json'], home);
  assert.notEqual(r.code, EXIT.OK);
  const j = json(r.stdout);
  assert.equal(j.activated, false);
  assert.deepEqual(seen, ['daemon-reload'], 'stops at the first hard failure');
  assert.match(j.activation.steps[0].error, /no user bus/);
});

test('monitor install-service: spaces and a braced HOME variable stay literal in ExecStart', () => {
  const home = mkHomeUnder(`${BRACED_HOME} Project α`);
  monitor.__setMonitorTestHooks({
    runServiceCommand: () => ({ status: 0, stdout: 'active', stderr: '' }),
  });
  const r = invoke(['monitor', 'install-service', '--json'], home);
  assert.equal(r.code, EXIT.OK, r.stderr);
  const j = json(r.stdout);
  const unit = readFileSync(j.path, 'utf8');
  const execStart = unit.split('\n').find((line) => line.startsWith('ExecStart='));
  assert.match(execStart ?? '', /\$\$\{HOME\}/, 'systemd grammar requires $$ for literal $');
  assert.doesNotMatch(
    execStart ?? '',
    /(^|[^$])\$\{HOME\}/,
    'no active braced HOME variable may remain',
  );
  const parsed = parseSystemdUnit(unit);
  // The --state argument (a path with a space) must survive as a single atomic argv token.
  const stateIdx = parsed.argv.indexOf('--state');
  assert.ok(stateIdx >= 0);
  const statePath = parsed.argv[stateIdx + 1] ?? '';
  assert.match(statePath, /\$\{HOME\} Project α/);
  assert.match(statePath, /state\.json$/);
  assert.equal(parsed.stdoutPath, join(home, 'services', 'monitor', 'log'));
});

test('monitor install-service → uninstall-service deactivates via structured commands', () => {
  const home = mkHome();
  const ids: string[] = [];
  monitor.__setMonitorTestHooks({
    runServiceCommand: (cmd) => {
      ids.push(cmd.id);
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  invoke(['monitor', 'install-service', '--json'], home);
  const r = invoke(['monitor', 'uninstall-service', '--json'], home);
  assert.equal(r.code, EXIT.OK, r.stderr);
  const j = json(r.stdout);
  assert.equal(j.uninstalled, true);
  assert.equal(j.deactivation.kind, 'systemd');
  assert.ok(ids.includes('disable'));
});
