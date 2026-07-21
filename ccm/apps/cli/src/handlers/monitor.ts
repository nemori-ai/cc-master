import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  captureRuntimeEnvironment,
  durableWriteFileSync,
  formatReport,
  launchAgentsDir,
  launchdInstallCommands,
  launchdUninstallCommands,
  lintBoard,
  loadHomeBoards,
  type ServiceCommand,
  type ServiceDefinition,
  serializeLaunchdPlist,
  serializeSystemdUnit,
  systemdInstallCommands,
  systemdUninstallCommands,
  systemdUserDir,
  withLock,
} from '@ccm/engine';
import * as discover from '../discover.js';
import { MachineHarnessRegistry } from '../harnesses/registry.js';
import { readVersion } from '../help.js';
import * as io from '../io.js';
import { refreshMachineWideQuota } from '../machine-wide-quota.js';
import { createQuotaAdmissionStore } from '../quota-admission-store.js';
import { quotaFilesystemFromBoundary } from '../quota-production-effects.js';
import type { Ctx } from './_common.js';
import { type ArbiterUsageOverride, arbitrateBoardForService } from './coordination.js';
import {
  type MonitorLifecycleObserver,
  type MonitorQuotaSourceMode,
  monitorLifecycleNoopObserver,
  runMonitorSourceCycle,
} from './monitor-source-composition.js';

export { isMonitorSourcePolicyInvocation } from './monitor-source-composition.js';

const EXIT = io.EXIT;
const SERVICE_SCHEMA = 'ccm/monitor-service/v1';
const DEFAULT_INTERVAL_SEC = 45;
const SERVICE_ID = 'monitor';

interface KindedError extends Error {
  errKind?: string;
}

interface MonitorState {
  schema: string;
  id: string;
  pid: number;
  wanted: boolean;
  home: string;
  state_path: string;
  pid_path: string;
  log_path: string;
  interval_sec: number;
  quota_source_mode: MonitorQuotaSourceMode;
  server: {
    started_at: string;
    ccm_version: string;
  };
  last_tick_at: string | null;
  last_error: string | null;
  tick_count: number;
  health?: 'ok' | 'stale' | 'stopped' | 'invalid';
  stale?: boolean;
  binary_match?: boolean;
  running_ccm_version?: string | null;
  installed_ccm_version?: string;
}

interface ServicePaths {
  root: string;
  state: string;
  pid: string;
  log: string;
  lockTarget: string;
}

interface SpawnArgs {
  statePath: string;
  logPath: string;
}

interface SpawnResult {
  pid: number;
}

// Result of running one OS service-manager command (launchctl/systemctl). Injectable so Linux CI can
//   exercise both launchd and systemd activation paths deterministically without a live service manager
//   (a fake executor contract) — and so activation truth is driven by a real command result, not by
//   having written the unit file.
interface ServiceCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface TestHooks {
  now?: () => Date;
  isPidAlive?: (pid: number) => boolean;
  spawnService?: (args: SpawnArgs) => SpawnResult;
  kill?: (pid: number) => boolean;
  tick?: (ctx: Ctx, state: MonitorState) => TickResult;
  runServiceCommand?: (cmd: ServiceCommand) => ServiceCommandResult;
  runtimePlatform?: 'darwin' | 'linux';
}

let testHooks: TestHooks = {};
let lifecycleObserver = monitorLifecycleNoopObserver();

export function __setMonitorLifecycleObserver(observer: MonitorLifecycleObserver): void {
  lifecycleObserver = observer;
}

export function __setMonitorTestHooks(hooks: TestHooks): void {
  testHooks = hooks;
}

export function __resetMonitorTestHooks(): void {
  testHooks = {};
  lifecycleObserver = monitorLifecycleNoopObserver();
}

function kinded(message: string, kind: string): KindedError {
  const e = new Error(message) as KindedError;
  e.errKind = kind;
  return e;
}

function nowIso(): string {
  return (testHooks.now ? testHooks.now() : new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function ccmVersion(): string {
  return readVersion();
}

function canonicalHome(ctx: Ctx): string {
  const home = discover.resolveHome({
    homeFlag: ctx.values.home as string | undefined,
    env: ctx.env,
  });
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  try {
    return fs.realpathSync.native(home);
  } catch {
    return path.resolve(home);
  }
}

function servicePaths(home: string): ServicePaths {
  const root = path.join(home, 'services', 'monitor');
  return {
    root,
    state: path.join(root, 'state.json'),
    pid: path.join(root, 'pid'),
    log: path.join(root, 'log'),
    lockTarget: path.join(root, 'registry'),
  };
}

function ensureServiceDirs(paths: ServicePaths): void {
  fs.mkdirSync(paths.root, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(paths.root, 0o700);
  } catch {
    /* best-effort on non-POSIX filesystems */
  }
}

function parseInterval(raw: unknown): number {
  if (raw === undefined) return DEFAULT_INTERVAL_SEC;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 5 || n > 3600) {
    throw kinded('monitor --interval must be an integer between 5 and 3600 seconds', 'Usage');
  }
  return n;
}

function parseQuotaSource(
  raw: unknown,
  fallback: MonitorQuotaSourceMode = 'cached-only',
): MonitorQuotaSourceMode {
  if (raw === undefined) return fallback;
  if (raw === 'cached-only' || raw === 'machine-wide') return raw;
  throw kinded('monitor --quota-source must be cached-only or machine-wide', 'Usage');
}

function writeJson(filePath: string, value: unknown): void {
  // state.json carries wanted/liveness continuity across service restarts, so it is durable authority.
  // pid/log remain ephemeral operational files and intentionally do not pay this fsync protocol.
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  durableWriteFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readState(statePath: string): MonitorState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const s = parsed as Partial<MonitorState>;
    if (s.schema !== SERVICE_SCHEMA || s.id !== SERVICE_ID || typeof s.home !== 'string')
      return null;
    const paths = servicePaths(s.home);
    return {
      schema: SERVICE_SCHEMA,
      id: SERVICE_ID,
      pid: typeof s.pid === 'number' ? s.pid : 0,
      wanted: s.wanted === true,
      home: s.home,
      state_path: typeof s.state_path === 'string' ? s.state_path : paths.state,
      pid_path: typeof s.pid_path === 'string' ? s.pid_path : paths.pid,
      log_path: typeof s.log_path === 'string' ? s.log_path : paths.log,
      interval_sec:
        typeof s.interval_sec === 'number' && Number.isFinite(s.interval_sec)
          ? s.interval_sec
          : DEFAULT_INTERVAL_SEC,
      quota_source_mode: parseQuotaSource(s.quota_source_mode),
      server:
        s.server && typeof s.server === 'object'
          ? (s.server as MonitorState['server'])
          : { started_at: '', ccm_version: ccmVersion() },
      last_tick_at: typeof s.last_tick_at === 'string' ? s.last_tick_at : null,
      last_error: typeof s.last_error === 'string' ? s.last_error : null,
      tick_count: typeof s.tick_count === 'number' ? s.tick_count : 0,
    };
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  if (testHooks.isPidAlive) return testHooks.isPidAlive(pid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function classifyService(service: MonitorState | null): MonitorState | null {
  if (!service) return null;
  const runningVersion =
    service.server && typeof service.server.ccm_version === 'string'
      ? service.server.ccm_version
      : null;
  const installedVersion = ccmVersion();
  const running = isPidAlive(service.pid);
  return {
    ...service,
    health: running ? 'ok' : service.wanted ? 'stale' : 'stopped',
    stale: !running && service.wanted,
    binary_match: runningVersion === installedVersion,
    running_ccm_version: runningVersion,
    installed_ccm_version: installedVersion,
  };
}

function buildState(
  home: string,
  intervalSec: number,
  quotaSourceMode: MonitorQuotaSourceMode = 'cached-only',
): MonitorState {
  const paths = servicePaths(home);
  return {
    schema: SERVICE_SCHEMA,
    id: SERVICE_ID,
    pid: 0,
    wanted: true,
    home,
    state_path: paths.state,
    pid_path: paths.pid,
    log_path: paths.log,
    interval_sec: intervalSec,
    quota_source_mode: quotaSourceMode,
    server: { started_at: nowIso(), ccm_version: ccmVersion() },
    last_tick_at: null,
    last_error: null,
    tick_count: 0,
    health: 'stopped',
    stale: false,
  };
}

function spawnArgsForState(statePath: string): { command: string; args: string[] } {
  const entry = process.argv[1];
  if (entry && /\.(?:cjs|mjs|js|ts)$/.test(entry)) {
    return { command: process.execPath, args: [entry, 'monitor', 'serve', '--state', statePath] };
  }
  return { command: process.execPath, args: ['monitor', 'serve', '--state', statePath] };
}

function defaultSpawnService({ statePath, logPath }: SpawnArgs): SpawnResult {
  const { command, args } = spawnArgsForState(statePath);
  const fd = fs.openSync(logPath, 'a');
  const child = spawn(command, args, {
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env },
  });
  child.unref();
  fs.closeSync(fd);
  return { pid: child.pid || 0 };
}

function spawnService(args: SpawnArgs): SpawnResult {
  return testHooks.spawnService ? testHooks.spawnService(args) : defaultSpawnService(args);
}

function waitForRunning(statePath: string, startedAt: string): MonitorState {
  // Poll (retry) until the freshly spawned service reports healthy, then return immediately.
  //   The window is generous because a cold Node-SEA start plus the first tick can take several
  //   seconds; only genuine failure waits out the full deadline (success returns as soon as the
  //   state flips to ok). 3s was too tight for post-binary-replace restarts and produced false
  //   timeouts that then threw and were dropped.
  const deadline = Date.now() + 8000;
  let last: MonitorState | null = null;
  while (Date.now() < deadline) {
    last = readState(statePath);
    if (last && last.server.started_at === startedAt) {
      const checked = classifyService(last);
      if (checked && checked.health === 'ok') return checked;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 80);
  }
  throw kinded(
    `monitor service did not become healthy${last ? ` (pid ${last.pid})` : ''}`,
    'Validation',
  );
}

function startService(ctx: Ctx): { service: MonitorState; reused: boolean } {
  const home = canonicalHome(ctx);
  const paths = servicePaths(home);
  ensureServiceDirs(paths);
  return withLock(paths.lockTarget, () => {
    const existing = classifyService(readState(paths.state));
    const quotaSourceMode = parseQuotaSource(
      ctx.values['quota-source'],
      existing?.quota_source_mode ?? 'cached-only',
    );
    if (
      existing &&
      existing.health === 'ok' &&
      existing.binary_match !== false &&
      existing.quota_source_mode === quotaSourceMode
    ) {
      return { service: existing, reused: true };
    }
    if (existing && existing.pid > 0) stopOne(existing);
    const state = buildState(
      home,
      parseInterval(ctx.values.interval ?? existing?.interval_sec),
      quotaSourceMode,
    );
    writeJson(paths.state, state);
    fs.writeFileSync(paths.pid, '', 'utf8');
    const child = spawnService({ statePath: state.state_path, logPath: state.log_path });
    if (child.pid > 0) {
      const latest = readState(state.state_path) || state;
      writeJson(state.state_path, { ...latest, pid: child.pid });
      fs.writeFileSync(state.pid_path, `${child.pid}\n`, 'utf8');
    }
    return { service: waitForRunning(state.state_path, state.server.started_at), reused: false };
  });
}

function killPid(pid: number): boolean {
  if (testHooks.kill) return testHooks.kill(pid);
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

function stopOne(service: MonitorState | null): { stopped: boolean; service: MonitorState | null } {
  if (!service) return { stopped: false, service: null };
  const checked = classifyService(service) || service;
  if (checked.pid > 0 && checked.health === 'ok') killPid(checked.pid);
  const stopped = {
    ...checked,
    pid: 0,
    wanted: false,
    health: 'stopped' as const,
    stale: false,
  };
  writeJson(stopped.state_path, stopped);
  try {
    fs.writeFileSync(stopped.pid_path, '', 'utf8');
  } catch {
    /* best-effort */
  }
  return { stopped: true, service: stopped };
}

function output(ctx: Ctx, data: unknown, human: string): void {
  ctx.out(ctx.flags.json ? JSON.stringify(data) : human);
}

function humanLine(service: MonitorState | null): string {
  if (!service) return 'monitor: stopped';
  const status =
    service.health === 'ok' && service.binary_match === false
      ? 'stale-binary'
      : service.health || 'stopped';
  return `monitor: ${status} pid=${service.pid || 'n/a'} home=${service.home}`;
}

export function start(ctx: Ctx): number {
  const { service, reused } = startService(ctx);
  output(
    ctx,
    { ok: true, running: true, reused, service },
    `${reused ? 'reusing' : 'started'} monitor pid=${service.pid}`,
  );
  return EXIT.OK;
}

export function status(ctx: Ctx): number {
  const home = canonicalHome(ctx);
  const paths = servicePaths(home);
  ensureServiceDirs(paths);
  const service = classifyService(readState(paths.state));
  output(
    ctx,
    {
      ok: true,
      running: service?.health === 'ok',
      binary_match: service ? service.binary_match !== false : null,
      running_ccm_version: service?.running_ccm_version ?? null,
      installed_ccm_version: ccmVersion(),
      service,
    },
    humanLine(service),
  );
  return EXIT.OK;
}

export function stop(ctx: Ctx): number {
  const home = canonicalHome(ctx);
  const paths = servicePaths(home);
  ensureServiceDirs(paths);
  return withLock(paths.lockTarget, () => {
    const result = stopOne(readState(paths.state));
    output(
      ctx,
      { ok: true, stopped: result.stopped, service: result.service },
      result.stopped ? 'stopped monitor' : 'monitor: stopped',
    );
    return EXIT.OK;
  });
}

export function restart(ctx: Ctx): number {
  const home = canonicalHome(ctx);
  const paths = servicePaths(home);
  ensureServiceDirs(paths);
  let previous: MonitorState | null = null;
  withLock(paths.lockTarget, () => {
    previous = stopOne(readState(paths.state)).service;
  });
  const started = startService(ctx);
  output(
    ctx,
    { ok: true, previous, service: started.service },
    `restarted monitor pid=${started.service.pid}`,
  );
  return EXIT.OK;
}

interface TickResult {
  registry: ReturnType<MachineHarnessRegistry['toJSON']>;
  checked_boards: number;
  writes: number;
  errors: string[];
  mode?: MonitorQuotaSourceMode;
  machine_wide?: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function boardOwner(board: unknown): Record<string, unknown> {
  return isObject(board) && isObject(board.owner) ? board.owner : {};
}

function readAccountsMap(home: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(home, 'accounts.json'), 'utf8'));
    return isObject(parsed.accounts) ? (parsed.accounts as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function tickOnce(ctx: Ctx, state: MonitorState): Promise<TickResult> {
  if (testHooks.tick) return testHooks.tick(ctx, state);
  return runMonitorSourceCycle({
    observer: lifecycleObserver,
    mode: state.quota_source_mode,
    ...(state.quota_source_mode === 'machine-wide'
      ? {
          refreshMachineWide: async () => {
            if (!ctx.quotaEffects) throw new Error('quota effect boundary is required');
            if (!ctx.machineQuotaCoordination) {
              throw new Error('machine-wide quota coordination boundary is required');
            }
            if (!ctx.machineQuotaCollectors) {
              throw new Error('machine-wide quota collector boundary is required');
            }
            const store = createQuotaAdmissionStore({
              home: state.home,
              filesystem: quotaFilesystemFromBoundary(ctx.quotaEffects),
            });
            return refreshMachineWideQuota({
              home: state.home,
              env: ctx.env,
              store,
              collectors: ctx.machineQuotaCollectors,
              coordination: ctx.machineQuotaCoordination,
            });
          },
        }
      : {}),
    readCached: () => {
      const registry = MachineHarnessRegistry.sweep(ctx.env);
      const registryJson = registry.toJSON();
      const usageByHarness = new Map<string, ArbiterUsageOverride>();
      for (const descriptor of registryJson.harnesses) {
        usageByHarness.set(descriptor.id, {
          signal: null,
          quotaModel: descriptor.usageSource.quotaModel,
          pollable: false,
        });
      }
      const accountsMap = readAccountsMap(state.home);
      const boardsDir = discover.boardsDir(state.home);
      const boards = loadHomeBoards(boardsDir, {
        maxBoards: Number.POSITIVE_INFINITY,
        maxDaysAgo: Number.POSITIVE_INFINITY,
      });
      let checkedBoards = 0;
      let writes = 0;
      const errors: string[] = [];
      for (const entry of boards) {
        const owner = boardOwner(entry.board);
        if (owner.active !== true) continue;
        checkedBoards += 1;
        const boardPath = path.join(boardsDir, entry.file);
        const harness = typeof owner.harness === 'string' ? owner.harness : undefined;
        const usage =
          (harness ? usageByHarness.get(harness) : undefined) ??
          ({ signal: null, quotaModel: 'primary-secondary', pollable: false } as const);
        try {
          withLock(boardPath, () => {
            const raw = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
            const out = arbitrateBoardForService(
              raw,
              {
                ...ctx,
                values: {
                  ...ctx.values,
                  home: state.home,
                  board: boardPath,
                  ...(harness ? { harness } : {}),
                },
              },
              boardPath,
              { usage, accountsMap },
            );
            const res = lintBoard(JSON.stringify(out.board));
            if (res.errors.length > 0) {
              errors.push(`${entry.file}: ${formatReport(res)}`);
              return;
            }
            io.writeFileAtomicSync(boardPath, `${JSON.stringify(out.board, null, 2)}\n`);
            writes += out.result.appended;
          });
        } catch (e) {
          errors.push(`${entry.file}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return { registry: registryJson, checked_boards: checkedBoards, writes, errors };
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function serve(ctx: Ctx): Promise<number> {
  const statePath = ctx.values.state as string;
  let state = readState(statePath);
  if (!state) throw kinded(`invalid monitor state: ${statePath}`, 'NotFound');
  state = { ...state, pid: process.pid, wanted: true, health: 'ok', stale: false };
  writeJson(state.state_path, state);
  fs.writeFileSync(state.pid_path, `${process.pid}\n`, 'utf8');
  const iterationsRaw = ctx.values.iterations;
  const iterations =
    typeof iterationsRaw === 'string' && Number.isInteger(Number(iterationsRaw))
      ? Number(iterationsRaw)
      : null;
  let count = 0;
  while (iterations === null || count < iterations) {
    const latest = readState(state.state_path) || state;
    if (!latest.wanted) break;
    let next = latest;
    try {
      const tick = await tickOnce(ctx, latest);
      next = {
        ...latest,
        pid: process.pid,
        wanted: true,
        last_tick_at: nowIso(),
        last_error: tick.errors.length ? tick.errors.join('\n') : null,
        tick_count: latest.tick_count + 1,
      };
      ctx.out(JSON.stringify({ ok: true, tick }));
    } catch (e) {
      next = {
        ...latest,
        pid: process.pid,
        wanted: true,
        last_error: e instanceof Error ? e.message : String(e),
      };
    }
    writeJson(next.state_path, next);
    count += 1;
    if (iterations !== null && count >= iterations) break;
    await sleep(Math.max(5, next.interval_sec) * 1000);
  }
  return EXIT.OK;
}

function serviceFilePath(): string {
  const exec = process.execPath;
  return path.basename(exec).toLowerCase().startsWith('node') ? process.argv[1] || 'ccm' : exec;
}

// Where the OS service manager expects the monitor unit + how launchd names its domain/service.
//   Directories come from the central RuntimeEnvironment contract (no hardcoded HOME / ~/.config); label
//   and unit file name are derived from the cc-master home hash (identical default naming as before).
interface MonitorUnitTarget {
  kind: 'launchd' | 'systemd';
  platform: string;
  arch: string;
  label: string;
  unitName: string;
  unitPath: string;
  domainTarget: string; // launchd only: gui/<uid>; empty for systemd
}

function monitorUnitTarget(
  env: Record<string, string | undefined>,
  home: string,
): MonitorUnitTarget {
  const rt = captureRuntimeEnvironment({ env, platform: testHooks.runtimePlatform });
  const suffix = Buffer.from(home).toString('hex').slice(0, 10);
  const label = `ai.nemori.ccm.monitor.${suffix}`;
  if (rt.platform === 'darwin') {
    const unitName = `${label}.plist`;
    return {
      kind: 'launchd',
      platform: rt.platform,
      arch: rt.arch,
      label,
      unitName,
      unitPath: path.join(launchAgentsDir(rt), unitName),
      domainTarget: `gui/${process.getuid?.() ?? ''}`,
    };
  }
  const unitName = `ccm-monitor-${suffix}.service`;
  return {
    kind: 'systemd',
    platform: rt.platform,
    arch: rt.arch,
    label,
    unitName,
    unitPath: path.join(systemdUserDir(rt), unitName),
    domainTarget: '',
  };
}

// Exposed so `services reconcile` derives the exact same unit location (single source of truth).
export function monitorUnitInstalled(
  env: Record<string, string | undefined>,
  home: string,
): boolean {
  return fs.existsSync(monitorUnitTarget(env, home).unitPath);
}

function buildServiceDefinition(target: MonitorUnitTarget, paths: ServicePaths): ServiceDefinition {
  return {
    label: target.label,
    systemdUnitName: target.unitName,
    description: 'ccm monitor',
    program: {
      executable: serviceFilePath(),
      args: ['monitor', 'serve', '--state', paths.state],
    },
    workingDirectory: null,
    environment: {},
    stdoutPath: paths.log,
    stderrPath: paths.log,
    runAtLoad: true,
    keepAlive: true,
  };
}

interface ActivationStep {
  id: string;
  command: string;
  args: string[];
  code: number | null;
  ok: boolean;
  error: string | null;
}

interface ActivationOutcome {
  ok: boolean;
  kind: 'launchd' | 'systemd';
  state: 'active' | 'written-not-activated';
  steps: ActivationStep[];
}

interface DeactivationStep extends ActivationStep {
  result: 'succeeded' | 'already-absent' | 'failed';
}

interface LaunchdDeactivationOutcome {
  ok: boolean;
  kind: 'launchd';
  state: 'inactive' | 'active';
  steps: DeactivationStep[];
}

interface LaunchdUnitRemovalOutcome {
  ok: boolean;
  result: 'removed' | 'already-absent' | 'failed' | 'not-attempted';
  path: string;
  error: string | null;
}

function runServiceCommand(cmd: ServiceCommand): ServiceCommandResult {
  if (testHooks.runServiceCommand) return testHooks.runServiceCommand(cmd);
  const r = spawnSync(cmd.command, cmd.args, { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// Run an ordered command sequence; the LAST command is the status/liveness truth (launchctl print /
//   systemctl is-active). Stop at the first hard failure. launchd `bootstrap` tolerates an
//   already-bootstrapped domain. Activation is "active" only when every step (including status) passed.
function runActivation(kind: 'launchd' | 'systemd', cmds: ServiceCommand[]): ActivationOutcome {
  const steps: ActivationStep[] = [];
  let ok = true;
  for (const cmd of cmds) {
    const r = runServiceCommand(cmd);
    let stepOk = r.status === 0;
    if (
      !stepOk &&
      cmd.id === 'bootstrap' &&
      /already bootstrapped/i.test(`${r.stderr}${r.stdout}`)
    ) {
      stepOk = true;
    }
    steps.push({
      id: cmd.id,
      command: cmd.command,
      args: cmd.args,
      code: r.status,
      ok: stepOk,
      error: stepOk ? null : (r.stderr || r.stdout || `exit ${r.status}`).trim(),
    });
    if (!stepOk) {
      ok = false;
      break;
    }
  }
  return { ok, kind, state: ok ? 'active' : 'written-not-activated', steps };
}

function activateOsService(target: MonitorUnitTarget): ActivationOutcome {
  const cmds =
    target.kind === 'launchd'
      ? launchdInstallCommands({
          plistPath: target.unitPath,
          domainTarget: target.domainTarget,
          label: target.label,
        })
      : systemdInstallCommands({ unitName: target.unitName });
  return runActivation(target.kind, cmds);
}

function launchdServiceAlreadyAbsent(result: ServiceCommandResult): boolean {
  return /could not find service|no such process|service (?:is )?not loaded/i.test(
    `${result.stderr}\n${result.stdout}`,
  );
}

function deactivateLaunchdService(target: MonitorUnitTarget): LaunchdDeactivationOutcome {
  const steps = launchdUninstallCommands({
    domainTarget: target.domainTarget,
    label: target.label,
  }).map((cmd): DeactivationStep => {
    const executed = runServiceCommand(cmd);
    const result =
      executed.status === 0
        ? 'succeeded'
        : launchdServiceAlreadyAbsent(executed)
          ? 'already-absent'
          : 'failed';
    const ok = result !== 'failed';
    return {
      id: cmd.id,
      command: cmd.command,
      args: cmd.args,
      code: executed.status,
      ok,
      error: ok ? null : (executed.stderr || executed.stdout || `exit ${executed.status}`).trim(),
      result,
    };
  });
  const ok = steps.every((step) => step.ok);
  return { ok, kind: 'launchd', state: ok ? 'inactive' : 'active', steps };
}

function deactivateOsService(
  target: MonitorUnitTarget,
): ActivationOutcome | LaunchdDeactivationOutcome {
  if (target.kind === 'launchd') return deactivateLaunchdService(target);
  return runActivation('systemd', systemdUninstallCommands({ unitName: target.unitName }));
}

function removeLaunchdUnit(unitPath: string): LaunchdUnitRemovalOutcome {
  try {
    fs.rmSync(unitPath);
    return { ok: true, result: 'removed', path: unitPath, error: null };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (failure.code === 'ENOENT') {
      return { ok: true, result: 'already-absent', path: unitPath, error: null };
    }
    return {
      ok: false,
      result: 'failed',
      path: unitPath,
      error: failure.message || String(error),
    };
  }
}

export function installService(ctx: Ctx): number {
  const home = canonicalHome(ctx);
  const paths = servicePaths(home);
  ensureServiceDirs(paths);
  const existing = readState(paths.state);
  const state =
    existing ||
    buildState(
      home,
      parseInterval(ctx.values.interval),
      parseQuotaSource(ctx.values['quota-source']),
    );
  writeJson(paths.state, {
    ...state,
    wanted: true,
    quota_source_mode: parseQuotaSource(ctx.values['quota-source'], state.quota_source_mode),
  });
  const target = monitorUnitTarget(ctx.env, home);
  fs.mkdirSync(path.dirname(target.unitPath), { recursive: true });
  const def = buildServiceDefinition(target, paths);
  const content =
    target.kind === 'launchd' ? serializeLaunchdPlist(def) : serializeSystemdUnit(def);
  fs.writeFileSync(target.unitPath, content, 'utf8');
  const activation = activateOsService(target);
  const failed = activation.steps.find((step) => !step.ok);
  output(
    ctx,
    {
      ok: activation.ok,
      installed: true,
      activated: activation.ok,
      kind: target.kind,
      path: target.unitPath,
      activation,
    },
    activation.ok
      ? `installed and activated monitor ${target.kind} unit: ${target.unitPath}`
      : `installed monitor ${target.kind} unit but activation failed at ${failed?.id ?? 'status'}: ${failed?.error ?? 'unknown'}`,
  );
  // Activation truth is the OS command result, not the written file: a written-but-not-activated unit is
  //   a distinct nonzero state, never ok:true (no-silent-failure).
  return activation.ok ? EXIT.OK : EXIT.ERROR;
}

export function uninstallService(ctx: Ctx): number {
  const home = canonicalHome(ctx);
  const paths = servicePaths(home);
  const target = monitorUnitTarget(ctx.env, home);
  const deactivation = deactivateOsService(target);
  // Preserve the established systemd projection. On launchd, both OS deactivation and persistent
  // LaunchAgent removal are required before the aggregate uninstall may claim success or stop state.
  let unitRemoval: LaunchdUnitRemovalOutcome | null = null;
  let completed = target.kind !== 'launchd';
  let stopped = false;
  if (target.kind === 'launchd') {
    unitRemoval = deactivation.ok
      ? removeLaunchdUnit(target.unitPath)
      : {
          ok: false,
          result: 'not-attempted',
          path: target.unitPath,
          error: 'unit removal not attempted because launchd deactivation failed',
        };
    completed = deactivation.ok && unitRemoval.ok;
  } else {
    try {
      fs.rmSync(target.unitPath, { force: true });
    } catch {
      /* best-effort */
    }
  }
  if (completed) {
    ensureServiceDirs(paths);
    withLock(paths.lockTarget, () => {
      stopped = stopOne(readState(paths.state)).stopped;
    });
  }
  const failed = deactivation.steps.find((step) => !step.ok);
  const failurePoint =
    failed?.id ?? (unitRemoval?.result === 'failed' ? 'unit-removal' : 'deactivation');
  const failureError = failed?.error ?? unitRemoval?.error ?? 'unknown';
  output(
    ctx,
    {
      ok: completed,
      uninstalled: completed,
      stopped,
      kind: target.kind,
      path: target.unitPath,
      deactivation,
      ...(target.kind === 'launchd'
        ? { platform: target.platform, arch: target.arch, unit_removal: unitRemoval }
        : {}),
    },
    completed
      ? `uninstalled monitor ${target.kind} unit: ${target.unitPath}`
      : `failed to uninstall monitor ${target.kind} unit at ${failurePoint}: ${failureError}`,
  );
  return completed ? EXIT.OK : EXIT.ERROR;
}

export function restartOsServiceIfInstalled(ctx: Ctx): boolean {
  const home = canonicalHome(ctx);
  const target = monitorUnitTarget(ctx.env, home);
  if (!fs.existsSync(target.unitPath)) return false;
  const cmd: ServiceCommand =
    target.kind === 'launchd'
      ? {
          id: 'kickstart',
          command: 'launchctl',
          args: ['kickstart', '-k', `${target.domainTarget}/${target.label}`],
        }
      : {
          id: 'restart',
          command: 'systemctl',
          args: ['--user', 'restart', target.unitName],
        };
  return runServiceCommand(cmd).status === 0;
}
