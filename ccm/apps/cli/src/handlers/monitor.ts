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
  type QuotaModel,
  type ServiceCommand,
  type ServiceDefinition,
  serializeLaunchdPlist,
  serializeSystemdUnit,
  systemdInstallCommands,
  systemdUninstallCommands,
  systemdUserDir,
  type UsageSignal,
  withLock,
} from '@ccm/engine';
import * as discover from '../discover.js';
import { MachineHarnessRegistry, resolveHarnessAdapter } from '../harnesses/registry.js';
import type { HarnessDescriptor } from '../harnesses/types.js';
import { readVersion } from '../help.js';
import * as io from '../io.js';
import type { Ctx } from './_common.js';
import { type ArbiterUsageOverride, arbitrateBoardForService } from './coordination.js';

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
}

let testHooks: TestHooks = {};

export function __setMonitorTestHooks(hooks: TestHooks): void {
  testHooks = hooks;
}

export function __resetMonitorTestHooks(): void {
  testHooks = {};
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

function buildState(home: string, intervalSec: number): MonitorState {
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
  const deadline = Date.now() + 3000;
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
    if (existing && existing.health === 'ok' && existing.binary_match !== false) {
      return { service: existing, reused: true };
    }
    if (existing && existing.pid > 0) stopOne(existing);
    const state = buildState(home, parseInterval(ctx.values.interval));
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

function usageForHarness(
  descriptor: HarnessDescriptor,
  env: Record<string, string | undefined>,
): ArbiterUsageOverride {
  const adapter = resolveHarnessAdapter({ env, harnessFlag: descriptor.id });
  const reading = adapter.readCurrentUsage(env);
  const source = descriptor.usageSource;
  return {
    signal: reading.signal as UsageSignal | null,
    quotaModel: source.quotaModel as QuotaModel,
    pollable: source.pollable,
  };
}

function tickOnce(ctx: Ctx, state: MonitorState): TickResult {
  if (testHooks.tick) return testHooks.tick(ctx, state);
  const registry = MachineHarnessRegistry.sweep(ctx.env);
  const registryJson = registry.toJSON();
  const usageByHarness = new Map<string, ArbiterUsageOverride>();
  for (const descriptor of registry.installed()) {
    usageByHarness.set(descriptor.id, usageForHarness(descriptor, ctx.env));
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
    const usage = harness ? usageByHarness.get(harness) : undefined;
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
      const tick = tickOnce(ctx, latest);
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
  label: string;
  unitName: string;
  unitPath: string;
  domainTarget: string; // launchd only: gui/<uid>; empty for systemd
}

function monitorUnitTarget(
  env: Record<string, string | undefined>,
  home: string,
): MonitorUnitTarget {
  const rt = captureRuntimeEnvironment({ env });
  const suffix = Buffer.from(home).toString('hex').slice(0, 10);
  const label = `ai.nemori.ccm.monitor.${suffix}`;
  if (rt.platform === 'darwin') {
    const unitName = `${label}.plist`;
    return {
      kind: 'launchd',
      label,
      unitName,
      unitPath: path.join(launchAgentsDir(rt), unitName),
      domainTarget: `gui/${process.getuid?.() ?? ''}`,
    };
  }
  const unitName = `ccm-monitor-${suffix}.service`;
  return {
    kind: 'systemd',
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

function deactivateOsService(target: MonitorUnitTarget): ActivationOutcome {
  const cmds =
    target.kind === 'launchd'
      ? launchdUninstallCommands({ domainTarget: target.domainTarget, label: target.label })
      : systemdUninstallCommands({ unitName: target.unitName });
  return runActivation(target.kind, cmds);
}

export function installService(ctx: Ctx): number {
  const home = canonicalHome(ctx);
  const paths = servicePaths(home);
  ensureServiceDirs(paths);
  const state = readState(paths.state) || buildState(home, parseInterval(ctx.values.interval));
  writeJson(paths.state, { ...state, wanted: true });
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
  try {
    fs.rmSync(target.unitPath, { force: true });
  } catch {
    /* best-effort */
  }
  ensureServiceDirs(paths);
  let stopped = false;
  withLock(paths.lockTarget, () => {
    stopped = stopOne(readState(paths.state)).stopped;
  });
  output(
    ctx,
    {
      ok: true,
      uninstalled: true,
      stopped,
      kind: target.kind,
      path: target.unitPath,
      deactivation,
    },
    `uninstalled monitor ${target.kind} unit: ${target.unitPath}`,
  );
  return EXIT.OK;
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
