import { spawn, spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import {
  analyzeGraph,
  buildPeerRoster,
  type DeliveryFacts,
  type DurableWriteCheckpoint,
  dependencyQualified,
  durableWriteFileSync,
  isAwaitingUser,
  loadHomeBoards,
  routeOutcomeClass,
  STATUS_ENUM,
  taskTrulyDone,
  withLock,
} from '@ccm/engine';
import { resolveDeliveryFacts } from '../delivery-proof.js';
import * as discover from '../discover.js';
import { readVersion } from '../help.js';
import * as io from '../io.js';
import { ensureWebViewerAppDist, resolveAppDistDir } from '../web-viewer-app-dist.js';
import type { Ctx } from './_common.js';
import { writeReportForBoard } from './status-report.js';

const EXIT = io.EXIT;
const SERVICE_SCHEMA = 'ccm/web-viewer-service/v1';
const HEALTH_SCHEMA = 'ccm/web-viewer-health/v1';
const BOARDS_SCHEMA = 'ccm/web-viewer-boards/v1';
const VIEW_MODEL_SCHEMA = 'ccm/web-viewer-view-model/v1';
const TASK_DETAIL_SCHEMA = 'ccm/web-viewer-task/v1';
const PEERS_SCHEMA = 'ccm/web-viewer-peers/v1';
const DEFAULT_HOST = '127.0.0.1';
/** 0 = OS-assigned ephemeral port (never hardcode a fixed listener port on install/start/restart). */
const DEFAULT_LISTEN_PORT = 0;
const REDACTED_TOKEN = '<redacted>';

type JsonRecord = Record<string, unknown>;

interface KindedError extends Error {
  errKind?: string;
  kind?: string;
}

interface BoardSelection {
  board_path: string;
  goal: string;
}

interface ServiceState {
  schema: string;
  id: string;
  pid: number;
  wanted?: boolean;
  state_path: string;
  token_file: string;
  token_sha256: string;
  home: string;
  initial_board_path: string | null;
  current_selection: BoardSelection | null;
  scope: {
    home: string;
    session_id: string;
  };
  host: string;
  port: number;
  base_url: string;
  url: string;
  server: {
    started_at: string;
    ccm_version: string;
  };
  log_path: string;
  stale?: boolean;
  health?: 'ok' | 'stale' | 'stopped' | 'invalid';
  binary_match?: boolean;
  running_ccm_version?: string | null;
  installed_ccm_version?: string;
}

interface InvalidServiceState {
  state_path: string;
  health: 'invalid';
  stale: true;
  error: string;
}

type ServiceView = ServiceState | InvalidServiceState;

interface ServicePaths {
  root: string;
  instances: string;
  tokens: string;
  logs: string;
  lockTarget: string;
}

interface HealthResult {
  ok: boolean;
  body?: Record<string, unknown>;
  error?: string;
}

interface SpawnArgs {
  statePath: string;
  token: string;
  service: ServiceState;
}

interface SpawnResult {
  pid: number;
}

interface OpenResult {
  opened: boolean;
  reason?: string;
}

interface TestHooks {
  now?: () => Date;
  randomToken?: () => string;
  isPidAlive?: (pid: number) => boolean;
  healthCheck?: (service: ServiceState, token: string | null) => HealthResult;
  spawnService?: (args: SpawnArgs) => SpawnResult;
  openUrl?: (url: string) => OpenResult;
  shutdown?: (service: ServiceState, token: string | null) => boolean;
  durableWriteFault?: (point: DurableWriteCheckpoint) => void;
}

let testHooks: TestHooks = {};

export function __setWebViewerTestHooks(hooks: TestHooks): void {
  testHooks = hooks;
}

export function __resetWebViewerTestHooks(): void {
  testHooks = {};
}

function kinded(message: string, kind: string): KindedError {
  const e = new Error(message) as KindedError;
  e.errKind = kind;
  e.kind = kind;
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
  return path.resolve(home);
}

function serviceId(home: string): string {
  const hash = crypto.createHash('sha256').update(home).digest('hex').slice(0, 8);
  return `wv_${hash}`;
}

function servicePaths(home: string): ServicePaths {
  const root = path.join(home, 'services', 'web-viewer');
  return {
    root,
    instances: path.join(root, 'instances'),
    tokens: path.join(root, 'tokens'),
    logs: path.join(root, 'logs'),
    lockTarget: path.join(root, 'registry'),
  };
}

function ensureServiceDirs(paths: ServicePaths): void {
  fs.mkdirSync(paths.root, { recursive: true, mode: 0o700 });
  fs.mkdirSync(paths.instances, { recursive: true, mode: 0o700 });
  fs.mkdirSync(paths.tokens, { recursive: true, mode: 0o700 });
  fs.mkdirSync(paths.logs, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(paths.root, 0o700);
    fs.chmodSync(paths.tokens, 0o700);
  } catch {
    /* best-effort on non-POSIX filesystems */
  }
}

function statePathFor(home: string, id = serviceId(home)): string {
  return path.join(servicePaths(home).instances, `${id}.json`);
}

function tokenPathFor(home: string, id = serviceId(home)): string {
  return path.join(servicePaths(home).tokens, `${id}.token`);
}

function logPathFor(home: string, id = serviceId(home)): string {
  return path.join(servicePaths(home).logs, `${id}.log`);
}

function tokenSha(token: string): string {
  return `sha256:${crypto.createHash('sha256').update(token).digest('hex')}`;
}

function randomToken(): string {
  if (testHooks.randomToken) return testHooks.randomToken();
  return crypto.randomBytes(32).toString('base64url');
}

function selectionQuery(selection: BoardSelection | null | undefined): string {
  return selection ? `&board=${encodeURIComponent(path.basename(selection.board_path))}` : '';
}

function redactedUrl(baseUrl: string, selection?: BoardSelection | null): string {
  return `${baseUrl}/?token=${REDACTED_TOKEN}${selectionQuery(selection)}`;
}

function openUrl(baseUrl: string, token: string, selection?: BoardSelection | null): string {
  return `${baseUrl}/?token=${encodeURIComponent(token)}${selectionQuery(selection)}`;
}

function parsePort(raw: unknown): number {
  if (raw === undefined) return DEFAULT_LISTEN_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw kinded(`invalid --port ${JSON.stringify(raw)} (must be 0..65535)`, 'Usage');
  }
  return n;
}

function parseHost(raw: unknown): string {
  const host = typeof raw === 'string' && raw ? raw : DEFAULT_HOST;
  if (host !== DEFAULT_HOST) {
    throw kinded('web-viewer only binds 127.0.0.1; refusing non-localhost host', 'Validation');
  }
  return host;
}

function negatedFlag(ctx: Ctx, name: string): boolean {
  return ctx.values[`no-${name}`] === true || ctx.values[name] === false;
}

function containmentRoot(home: string): string {
  return path.resolve(discover.boardsDir(home));
}

function containedInBoards(home: string, candidate: string): boolean {
  const root = containmentRoot(home);
  const resolved = path.resolve(candidate);
  return resolved !== root && resolved.startsWith(`${root}${path.sep}`);
}

function readBoardGoal(boardPath: string): string {
  try {
    const board = JSON.parse(fs.readFileSync(boardPath, 'utf8')) as { goal?: unknown };
    return typeof board.goal === 'string' ? board.goal : '';
  } catch {
    return '';
  }
}

function hasSelectionRequest(ctx: Ctx): boolean {
  return (
    typeof ctx.values.board === 'string' ||
    typeof ctx.values.goal === 'string' ||
    typeof ctx.env.CC_MASTER_BOARD === 'string'
  );
}

function resolveInitialSelection(ctx: Ctx, home: string): BoardSelection | null {
  if (!hasSelectionRequest(ctx)) return null;

  const resolved = discover.resolveBoard({
    boardFlag: ctx.values.board as string | undefined,
    sid: ctx.sid,
    homeFlag: home,
    goalSubstr: ctx.values.goal as string | undefined,
    env: { ...ctx.env, CC_MASTER_HOME: home },
  });
  const boardPath = path.resolve(resolved.boardPath);
  if (!containedInBoards(home, boardPath)) {
    throw kinded(
      `initial board is outside selected home boards directory: ${boardPath}`,
      'NotFound',
    );
  }
  const board = resolved.board as { goal?: unknown };
  return {
    board_path: boardPath,
    goal: typeof board.goal === 'string' ? board.goal : readBoardGoal(boardPath),
  };
}

function buildState({
  home,
  host,
  port,
  token,
  selection,
  sid,
}: {
  home: string;
  host: string;
  port: number;
  token: string;
  selection: BoardSelection | null;
  sid: string;
}): ServiceState {
  const id = serviceId(home);
  const baseUrl = `http://${host}:${port}`;
  return {
    schema: SERVICE_SCHEMA,
    id,
    pid: 0,
    wanted: true,
    state_path: statePathFor(home, id),
    token_file: tokenPathFor(home, id),
    token_sha256: tokenSha(token),
    home,
    initial_board_path: selection ? selection.board_path : null,
    current_selection: selection,
    scope: { home, session_id: sid || '' },
    host,
    port,
    base_url: baseUrl,
    url: redactedUrl(baseUrl, selection),
    server: { started_at: nowIso(), ccm_version: ccmVersion() },
    log_path: logPathFor(home, id),
    stale: false,
    health: 'stopped',
  };
}

function writeJson(filePath: string, value: unknown): void {
  // Instance JSON is authoritative across start/reuse/serve; token bytes remain isolated in writeToken.
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  durableWriteFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    fault: testHooks.durableWriteFault,
  });
}

function writeToken(filePath: string, token: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, token, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* best-effort */
  }
}

function readToken(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return null;
  }
}

function readState(filePath: string): ServiceState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const s = parsed as Partial<ServiceState>;
    if (s.schema !== SERVICE_SCHEMA || typeof s.id !== 'string' || typeof s.home !== 'string') {
      return null;
    }
    return {
      ...s,
      pid: typeof s.pid === 'number' ? s.pid : 0,
      wanted: s.wanted === true,
      port: typeof s.port === 'number' ? s.port : 0,
      state_path: typeof s.state_path === 'string' ? s.state_path : filePath,
      token_file: typeof s.token_file === 'string' ? s.token_file : '',
      token_sha256: typeof s.token_sha256 === 'string' ? s.token_sha256 : '',
      host: typeof s.host === 'string' ? s.host : DEFAULT_HOST,
      base_url: typeof s.base_url === 'string' ? s.base_url : '',
      url: typeof s.url === 'string' ? s.url : '',
      log_path: typeof s.log_path === 'string' ? s.log_path : '',
      initial_board_path: typeof s.initial_board_path === 'string' ? s.initial_board_path : null,
      current_selection:
        s.current_selection && typeof s.current_selection === 'object'
          ? (s.current_selection as BoardSelection)
          : null,
      scope:
        s.scope && typeof s.scope === 'object'
          ? (s.scope as ServiceState['scope'])
          : { home: s.home, session_id: '' },
      server:
        s.server && typeof s.server === 'object'
          ? (s.server as ServiceState['server'])
          : { started_at: '', ccm_version: ccmVersion() },
    } as ServiceState;
  } catch {
    return null;
  }
}

function allStatePaths(home: string): string[] {
  const dir = servicePaths(home).instances;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(dir, name))
    .sort();
}

function statePathFromCtx(ctx: Ctx, home: string): string {
  const id = ctx.positionals[0] || serviceId(home);
  if (!/^wv_[a-z0-9]+$/i.test(id)) {
    throw kinded(`invalid web-viewer service id: ${id}`, 'Usage');
  }
  return statePathFor(home, id);
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

function nodeEvalCommand(): string {
  const exec = process.execPath || '';
  const base = path.basename(exec).toLowerCase();
  if (base === 'node' || base === 'node.exe') return exec;
  return process.env.CCM_NODE_BIN || 'node';
}

function defaultHealthCheck(service: ServiceState, token: string | null): HealthResult {
  if (!token || !service.base_url) return { ok: false, error: 'missing token or base_url' };
  const script = `
    const http = require('node:http');
    const url = process.argv[1];
    const token = process.argv[2];
    const req = http.get(url, { headers: { Authorization: 'Bearer ' + token }, timeout: 700 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) process.exit(2);
        process.stdout.write(body);
      });
    });
    req.on('timeout', () => { req.destroy(); process.exit(3); });
    req.on('error', () => process.exit(4));
  `;
  const r = spawnSync(nodeEvalCommand(), ['-e', script, `${service.base_url}/_ccm/health`, token], {
    encoding: 'utf8',
    timeout: 1200,
  });
  if (r.status !== 0) return { ok: false, error: r.stderr || `health exited ${r.status}` };
  try {
    return { ok: true, body: JSON.parse(r.stdout) };
  } catch {
    return { ok: false, error: 'bad health JSON' };
  }
}

function healthCheck(service: ServiceState, token: string | null): HealthResult {
  if (testHooks.healthCheck) return testHooks.healthCheck(service, token);
  return defaultHealthCheck(service, token);
}

function classifyService(service: ServiceState | null): ServiceState | null {
  if (!service) return null;
  const token = readToken(service.token_file);
  const installedVersion = ccmVersion();
  const runningVersion =
    service.server && typeof service.server.ccm_version === 'string'
      ? service.server.ccm_version
      : null;
  const binaryMatch = runningVersion === installedVersion;
  let stale = true;
  if (isPidAlive(service.pid)) {
    const health = healthCheck(service, token);
    const body = health.body || {};
    stale = !(
      health.ok &&
      body.schema === HEALTH_SCHEMA &&
      body.id === service.id &&
      body.pid === service.pid &&
      body.started_at === service.server.started_at
    );
  }
  const baseUrl = service.base_url || `http://${service.host || DEFAULT_HOST}:${service.port || 0}`;
  return {
    ...service,
    base_url: baseUrl,
    url: redactedUrl(baseUrl, service.current_selection),
    stale,
    health: stale ? 'stale' : 'ok',
    binary_match: binaryMatch,
    running_ccm_version: runningVersion,
    installed_ccm_version: installedVersion,
  };
}

function serviceForOutput(service: ServiceState | null): ServiceState | null {
  if (!service) return null;
  const baseUrl = service.base_url || `http://${service.host || DEFAULT_HOST}:${service.port || 0}`;
  return {
    ...service,
    base_url: baseUrl,
    url: redactedUrl(baseUrl, service.current_selection),
  };
}

function updateServiceSelection(service: ServiceState, selection: BoardSelection): ServiceState {
  const baseUrl = service.base_url || `http://${service.host || DEFAULT_HOST}:${service.port || 0}`;
  const next = {
    ...service,
    current_selection: selection,
    base_url: baseUrl,
    url: redactedUrl(baseUrl, selection),
  };
  writeJson(service.state_path, next);
  return next;
}

function invalidServiceForOutput(statePath: string): InvalidServiceState {
  return {
    state_path: statePath,
    health: 'invalid',
    stale: true,
    error: 'invalid web-viewer state file',
  };
}

function cleanupState(service: ServiceState | null): void {
  if (!service) return;
  for (const p of [service.state_path, service.token_file]) {
    if (!p) continue;
    try {
      fs.rmSync(p, { force: true });
    } catch {
      /* best-effort */
    }
  }
}

function spawnArgsForState(statePath: string): { command: string; args: string[] } {
  const entry = process.argv[1];
  if (entry && /\.(?:cjs|mjs|js|ts)$/.test(entry)) {
    return {
      command: process.execPath,
      args: [entry, 'web-viewer', 'serve', '--state', statePath],
    };
  }
  return { command: process.execPath, args: ['web-viewer', 'serve', '--state', statePath] };
}

function defaultSpawnService({ statePath }: SpawnArgs): SpawnResult {
  const { command, args } = spawnArgsForState(statePath);
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();
  return { pid: child.pid || 0 };
}

function spawnService(args: SpawnArgs): SpawnResult {
  return testHooks.spawnService ? testHooks.spawnService(args) : defaultSpawnService(args);
}

function waitForHealthyService(statePath: string, startedAt: string): ServiceState {
  const deadline = Date.now() + 5000;
  let last: ServiceState | null = null;
  while (Date.now() < deadline) {
    last = readState(statePath);
    if (last && last.server.started_at === startedAt) {
      const checked = classifyService(last);
      if (checked && checked.health === 'ok') return checked;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 80);
  }
  throw kinded(
    `web-viewer service did not become healthy${last ? ` (pid ${last.pid})` : ''}`,
    'Validation',
  );
}

function startService(ctx: Ctx): { service: ServiceState; token: string; reused: boolean } {
  const home = canonicalHome(ctx);
  const paths = servicePaths(home);
  ensureServiceDirs(paths);
  ensureWebViewerAppDist(home);
  return withLock(paths.lockTarget, () => {
    const existing = classifyService(readState(statePathFromCtx(ctx, home)));
    if (existing && existing.health === 'ok' && existing.binary_match !== false) {
      const selection = resolveInitialSelection(ctx, home);
      const service = selection ? updateServiceSelection(existing, selection) : existing;
      const token = readToken(existing.token_file) || '';
      return { service, token, reused: true };
    }
    if (existing) cleanupState(existing);

    const host = parseHost(ctx.values.host);
    const port = parsePort(ctx.values.port);
    const selection = resolveInitialSelection(ctx, home);
    const token = randomToken();
    const state = buildState({ home, host, port, token, selection, sid: ctx.sid });
    writeToken(state.token_file, token);
    writeJson(state.state_path, state);
    const child = spawnService({ statePath: state.state_path, token, service: state });
    if (child.pid > 0) {
      const latest = readState(state.state_path) || state;
      writeJson(state.state_path, { ...latest, pid: child.pid });
    }
    const healthy = waitForHealthyService(state.state_path, state.server.started_at);
    return { service: healthy, token, reused: false };
  });
}

function output(ctx: Ctx, data: unknown, human: string): void {
  ctx.out(ctx.flags.json ? JSON.stringify(data) : human);
}

function humanServiceLine(prefix: string, service: ServiceView | null): string {
  if (!service) return `${prefix}: stopped`;
  if (service.health === 'invalid') return `${prefix}: invalid ${service.state_path}`;
  const status = service.stale
    ? 'stale'
    : 'binary_match' in service && service.binary_match === false
      ? 'stale-binary'
      : 'running';
  return `${prefix}: ${status} ${service.id} ${service.url} home=${service.home}`;
}

export function start(ctx: Ctx): number {
  const { service, token, reused } = startService(ctx);
  const includeOpen = !negatedFlag(ctx, 'open');
  output(
    ctx,
    {
      ok: true,
      service: serviceForOutput(service),
      reused,
      ...(includeOpen
        ? { open_url: openUrl(service.base_url, token, service.current_selection) }
        : {}),
    },
    `${reused ? 'reusing' : 'started'} ${service.id}: ${openUrl(
      service.base_url,
      token,
      service.current_selection,
    )}`,
  );
  return EXIT.OK;
}

function defaultOpenUrl(url: string): OpenResult {
  if (process.env.CI === 'true' || process.env.CI === '1') {
    return { opened: false, reason: 'CI environment' };
  }
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return { opened: true };
  } catch (e) {
    return { opened: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

function openBrowser(url: string): OpenResult {
  return testHooks.openUrl ? testHooks.openUrl(url) : defaultOpenUrl(url);
}

export function open(ctx: Ctx): number {
  const home = canonicalHome(ctx);
  ensureServiceDirs(servicePaths(home));
  let service = classifyService(readState(statePathFromCtx(ctx, home)));
  let token = service ? readToken(service.token_file) || '' : '';
  if (
    ((!service || service.health !== 'ok') && !negatedFlag(ctx, 'start')) ||
    (service?.health === 'ok' && hasSelectionRequest(ctx))
  ) {
    const started = startService(ctx);
    service = started.service;
    token = started.token;
  }
  if (!service || service.health !== 'ok') {
    output(ctx, { ok: true, service: null, opened: false }, 'web-viewer: stopped');
    return EXIT.OK;
  }
  const url = openUrl(service.base_url, token, service.current_selection);
  const opened = openBrowser(url);
  output(
    ctx,
    {
      ok: true,
      service: serviceForOutput(service),
      opened: opened.opened,
      ...(opened.reason ? { open_error: opened.reason } : {}),
      open_url: url,
    },
    opened.opened ? `opened ${url}` : `open manually: ${url}`,
  );
  return EXIT.OK;
}

export function status(ctx: Ctx): number {
  const home = canonicalHome(ctx);
  ensureServiceDirs(servicePaths(home));
  const statePath = statePathFromCtx(ctx, home);
  const raw = readState(statePath);
  const service = raw ? serviceForOutput(classifyService(raw)) : null;
  const serviceView =
    !service && fs.existsSync(statePath) ? invalidServiceForOutput(statePath) : service;
  output(
    ctx,
    {
      ok: true,
      running: !!service && service.health === 'ok',
      binary_match: service ? service.binary_match !== false : null,
      running_ccm_version: service ? (service.running_ccm_version ?? null) : null,
      installed_ccm_version: ccmVersion(),
      service: serviceView,
    },
    humanServiceLine('web-viewer', serviceView),
  );
  return EXIT.OK;
}

function defaultShutdown(service: ServiceState, token: string | null): boolean {
  if (!token || !service.base_url) return false;
  const script = `
    const http = require('node:http');
    const url = new URL('/_ccm/shutdown', process.argv[1]);
    const token = process.argv[2];
    const req = http.request(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, timeout: 700 }, (res) => {
      res.resume();
      res.on('end', () => process.exit(res.statusCode === 200 ? 0 : 2));
    });
    req.on('timeout', () => { req.destroy(); process.exit(3); });
    req.on('error', () => process.exit(4));
    req.end();
  `;
  const r = spawnSync(nodeEvalCommand(), ['-e', script, service.base_url, token], {
    timeout: 1200,
  });
  if (r.status === 0) return true;
  try {
    process.kill(service.pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

function stopOne(service: ServiceState | null): { stopped: boolean; service: ServiceState | null } {
  if (!service) return { stopped: false, service: null };
  const checked = classifyService(service);
  const token = readToken(service.token_file);
  if (checked && checked.health === 'ok') {
    if (testHooks.shutdown) testHooks.shutdown(checked, token);
    else defaultShutdown(checked, token);
  }
  cleanupState(service);
  return { stopped: true, service: serviceForOutput(checked || service) };
}

export function stop(ctx: Ctx): number {
  const home = canonicalHome(ctx);
  const paths = servicePaths(home);
  ensureServiceDirs(paths);
  return withLock(paths.lockTarget, () => {
    if (ctx.values.all === true) {
      const stopped = allStatePaths(home).map((p) => stopOne(readState(p)));
      output(
        ctx,
        {
          ok: true,
          stopped: stopped.some((r) => r.stopped),
          services: stopped.map((r) => r.service),
        },
        `stopped ${stopped.filter((r) => r.stopped).length} web-viewer service(s)`,
      );
      return EXIT.OK;
    }
    const result = stopOne(readState(statePathFromCtx(ctx, home)));
    output(
      ctx,
      { ok: true, stopped: result.stopped, service: result.service },
      result.stopped ? `stopped ${result.service?.id || 'web-viewer'}` : 'web-viewer: stopped',
    );
    return EXIT.OK;
  });
}

export function restart(ctx: Ctx): number {
  const home = canonicalHome(ctx);
  const paths = servicePaths(home);
  ensureServiceDirs(paths);
  let previous: ServiceState | null = null;
  withLock(paths.lockTarget, () => {
    const existing = readState(statePathFromCtx(ctx, home));
    previous = stopOne(existing).service;
  });
  const started = startService(ctx);
  output(
    ctx,
    {
      ok: true,
      previous: serviceForOutput(previous),
      service: serviceForOutput(started.service),
      open_url: openUrl(started.service.base_url, started.token, started.service.current_selection),
    },
    `restarted ${started.service.id}: ${openUrl(
      started.service.base_url,
      started.token,
      started.service.current_selection,
    )}`,
  );
  return EXIT.OK;
}

function tokenFromRequest(req: http.IncomingMessage, url: URL): string {
  const bearer = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (bearer && bearer[1]) return bearer[1];
  const query = url.searchParams.get('token');
  if (query) return query;
  const cookie = String(req.headers.cookie || '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('ccm_web_viewer_token='));
  return cookie ? decodeURIComponent(cookie.slice('ccm_web_viewer_token='.length)) : '';
}

function sendJson(res: http.ServerResponse, statusCode: number, value: unknown): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}

function safeHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Cache-Control': 'no-store',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...extra,
  };
}

function appDistDir(home?: string): string | null {
  return resolveAppDistDir(home);
}

export function ensureAppDistForHome(home: string): void {
  ensureWebViewerAppDist(home);
}

function defaultIndexProbe(service: ServiceState, token: string | null): HealthResult {
  if (!token || !service.base_url) return { ok: false, error: 'missing token or base_url' };
  const script = `
    const http = require('node:http');
    const url = process.argv[1];
    const req = http.get(url, { timeout: 900 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          process.stderr.write(String(res.statusCode));
          process.exit(2);
        }
        if (String(res.headers['content-type'] || '').includes('application/json') && body.includes('dist is missing')) {
          process.exit(3);
        }
        process.stdout.write(body.slice(0, 64));
      });
    });
    req.on('timeout', () => { req.destroy(); process.exit(4); });
    req.on('error', () => process.exit(5));
  `;
  const url = `${service.base_url}/?token=${encodeURIComponent(token)}`;
  const r = spawnSync(nodeEvalCommand(), ['-e', script, url], {
    encoding: 'utf8',
    timeout: 1500,
  });
  if (r.status !== 0) {
    return { ok: false, error: r.stderr || `index probe exited ${r.status}` };
  }
  return { ok: true };
}

export function probeRunningServiceHealth(home: string, id?: string): HealthResult {
  const statePath = statePathFor(home, id || serviceId(home));
  const service = classifyService(readState(statePath));
  if (!service || service.health !== 'ok') {
    return { ok: false, error: 'service not healthy' };
  }
  const token = readToken(service.token_file);
  const health = healthCheck(service, token);
  if (!health.ok) return health;
  if (testHooks.healthCheck) return health;
  return defaultIndexProbe(service, token);
}

export function mimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.woff2') return 'font/woff2';
  if (ext === '.woff') return 'font/woff';
  return 'application/octet-stream';
}

function resolveStaticAsset(distDir: string, urlPathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    return null;
  }
  if (decoded.includes('\\')) return null;
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  if (rel === 'index.html') return path.join(distDir, 'index.html');
  const parts = rel.split('/');
  if (parts[0] !== 'assets' || parts.some((part) => !part || part === '.' || part === '..')) {
    return null;
  }
  const resolved = path.resolve(distDir, rel);
  const root = path.resolve(distDir);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

function sendStaticFile(
  res: http.ServerResponse,
  filePath: string,
  token?: string,
  isIndex = false,
): void {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  const headers = safeHeaders({
    'Content-Type': mimeType(filePath),
    ...(isIndex
      ? {
          'Content-Security-Policy':
            "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          ...(token
            ? {
                'Set-Cookie': `ccm_web_viewer_token=${encodeURIComponent(
                  token,
                )}; HttpOnly; SameSite=Lax`,
              }
            : {}),
        }
      : {}),
  });
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

function boardIdFromFilename(filename: string): string {
  return filename.replace(/\.board\.json$/, '');
}

function listBoards(home: string, current: string | null): unknown[] {
  const dir = discover.boardsDir(home);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.board.json'))
    .sort()
    .map((file) => {
      const boardPath = path.join(dir, file);
      let stat: fs.Stats | null = null;
      let board: JsonRecord = {};
      try {
        stat = fs.statSync(boardPath);
        const parsed = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
        board =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as JsonRecord)
            : {};
      } catch {
        /* keep malformed boards selectable but marked unhealthy */
      }
      const selected = current ? path.resolve(current) === path.resolve(boardPath) : false;
      const tasks = tasksOf(board);
      // Board-switcher card summary (additive): the mega dropdown renders a complete
      // per-board identity card (progress / status buckets / priority / heartbeat age /
      // branch) without a second round-trip — this loop already parses every board.
      const owner =
        board.owner && typeof board.owner === 'object' && !Array.isArray(board.owner)
          ? (board.owner as JsonRecord)
          : null;
      const coordination =
        board.coordination &&
        typeof board.coordination === 'object' &&
        !Array.isArray(board.coordination)
          ? (board.coordination as JsonRecord)
          : null;
      const git =
        board.git && typeof board.git === 'object' && !Array.isArray(board.git)
          ? (board.git as JsonRecord)
          : null;
      const statusCounts = countStatuses(tasks);
      const doneCount = tasks.filter((task) => {
        const status = statusOf(task);
        return status === 'done' || status === 'verified';
      }).length;
      const awaitingCount = tasks.filter((task) => isAwaitingUser(task as never)).length;
      const heartbeatMs = owner ? parseTsLoose(owner.heartbeat) : null;
      return {
        id: boardIdFromFilename(file),
        filename: file,
        selected,
        active: owner ? owner.active === true : undefined,
        health: Object.keys(board).length ? 'ok' : 'error',
        updated_at: stat ? stat.mtime.toISOString() : undefined,
        task_count: tasks.length,
        status_counts: statusCounts,
        done_count: doneCount,
        awaiting_count: awaitingCount,
        priority:
          coordination && typeof coordination.priority === 'string'
            ? coordination.priority
            : undefined,
        heartbeat_age_sec:
          heartbeatMs != null
            ? Math.max(0, Math.round((Date.now() - heartbeatMs) / 1000))
            : undefined,
        branch: git && typeof git.branch === 'string' ? git.branch : undefined,
        created_at: typeof board.created_at === 'string' ? board.created_at : undefined,
        file,
        path: boardPath,
        current: selected,
        goal: typeof board.goal === 'string' ? board.goal : readBoardGoal(boardPath),
      };
    });
}

function resolveHttpBoard(home: string, current: string | null, url: URL): string | null {
  const requested = url.searchParams.get('board') || url.searchParams.get('board_file');
  if (!requested) return current;
  if (!/^[^/\\]+\.board\.json$/.test(requested)) return null;
  const boardPath = path.resolve(discover.boardsDir(home), requested);
  if (!containedInBoards(home, boardPath)) return null;
  try {
    return fs.statSync(boardPath).isFile() ? boardPath : null;
  } catch {
    return null;
  }
}

function parseMaxAgeParam(url: URL): number {
  const raw = url.searchParams.get('max_age') || url.searchParams.get('max-age') || '30s';
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/i.exec(raw.trim());
  if (!m) throw kinded(`invalid max_age ${JSON.stringify(raw)}`, 'Usage');
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) throw kinded('max_age must be positive', 'Usage');
  const unit = (m[2] || 's').toLowerCase();
  const factor = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return Math.max(1, Math.round(value * factor));
}

function latestRuntimeState(fallback: ServiceState): ServiceState {
  return readState(fallback.state_path) || fallback;
}

function sha256Hex(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function readBoardSnapshot(boardPath: string): {
  raw: string;
  board: JsonRecord;
  stat: fs.Stats;
} {
  const raw = fs.readFileSync(boardPath, 'utf8');
  const parsed = JSON.parse(raw);
  const board =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonRecord) : {};
  return { raw, board, stat: fs.statSync(boardPath) };
}

function tasksOf(board: JsonRecord): JsonRecord[] {
  return Array.isArray(board.tasks)
    ? board.tasks.filter(
        (task): task is JsonRecord => !!task && typeof task === 'object' && !Array.isArray(task),
      )
    : [];
}

function taskId(task: JsonRecord): string {
  return typeof task.id === 'string' ? task.id : '';
}

function statusOf(task: JsonRecord): string {
  return typeof task.status === 'string' ? task.status : '';
}

function recordOf(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

function surfaceLabel(harness: string, surface: string): string {
  const labels: Record<string, string> = {
    'cursor:host-native': 'Cursor IDE',
    'cursor:cli-headless': 'Cursor Agent',
    'codex:host-native': 'Codex native',
    'codex:cli-headless': 'Codex CLI',
    'claude-code:host-native': 'Claude Code native',
    'claude-code:cli-headless': 'Claude Code CLI',
  };
  return labels[`${harness}:${surface}`] ?? 'Unknown surface';
}

function capabilityIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item : recordOf(item)?.id))
    .filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function candidateProjection(value: unknown): JsonRecord | null {
  const candidate = recordOf(value);
  if (!candidate || typeof candidate.id !== 'string') return null;
  const harness = typeof candidate.harness === 'string' ? candidate.harness : 'unknown';
  const surface = typeof candidate.surface === 'string' ? candidate.surface : 'unknown';
  const effectFloors = stringList(candidate.effect_floors_met);
  const permission = recordOf(candidate.permission);
  return {
    id: candidate.id,
    ...(typeof candidate.adapter === 'string' ? { adapter: candidate.adapter } : {}),
    harness,
    ...(typeof candidate.provider === 'string' ? { provider: candidate.provider } : {}),
    surface,
    surface_label: surfaceLabel(harness, surface),
    ...(typeof candidate.model === 'string' ? { model: candidate.model } : {}),
    ...(typeof candidate.effort === 'string' ? { effort: candidate.effort } : {}),
    capabilities: capabilityIds(candidate.capabilities),
    role_grades: effectFloors.filter((floor) => ['O', 'T1', 'T2', 'T3'].includes(floor)),
    ...(permission
      ? {
          permission: {
            ...(typeof permission.profile === 'string' ? { profile: permission.profile } : {}),
            denies: stringList(permission.denies),
          },
        }
      : {}),
  };
}

function planningProjection(value: unknown): JsonRecord | null {
  const planning = recordOf(value);
  if (!planning) return null;
  const dimensions = recordOf(planning.dimensions);
  const quality = recordOf(planning.quality);
  const budget = recordOf(planning.budget);
  const capabilities = recordOf(planning.capabilities);
  return {
    ...(typeof planning.assessed_at === 'string' ? { assessed_at: planning.assessed_at } : {}),
    ...(typeof planning.assessor === 'string' ? { assessor: planning.assessor } : {}),
    dimensions: dimensions
      ? Object.fromEntries(
          Object.entries(dimensions).filter(([, item]) => typeof item === 'string'),
        )
      : {},
    ...(typeof planning.estimate_confidence === 'string'
      ? { estimate_confidence: planning.estimate_confidence }
      : {}),
    quality: {
      ...(typeof quality?.effect_floor === 'string' ? { effect_floor: quality.effect_floor } : {}),
    },
    budget: {
      ...(typeof budget?.posture === 'string' ? { posture: budget.posture } : {}),
      ...(typeof budget?.max_attempts === 'number' ? { max_attempts: budget.max_attempts } : {}),
    },
    capabilities: {
      required: capabilityIds(capabilities?.required),
      preferred: capabilityIds(capabilities?.preferred),
      forbidden: capabilityIds(capabilities?.forbidden),
    },
  };
}

function executionProjection(task: JsonRecord, originHarness: string): JsonRecord | null {
  const planning = planningProjection(task.planning);
  const routing = recordOf(task.routing);
  if (!planning && !routing) return null;

  const policy = recordOf(routing?.policy);
  const candidates = (Array.isArray(policy?.candidates) ? policy.candidates : [])
    .map(candidateProjection)
    .filter((candidate): candidate is JsonRecord => !!candidate);
  const byId = new Map(candidates.map((candidate) => [String(candidate.id), candidate]));
  const selected = recordOf(routing?.selected);
  const selectedId = typeof selected?.candidate_id === 'string' ? selected.candidate_id : '';
  const selectedCandidate = selectedId ? byId.get(selectedId) : undefined;
  const chains = recordOf(policy?.chains);
  const fallback = recordOf(policy?.fallback);
  const attempts = (Array.isArray(routing?.attempts) ? routing.attempts : [])
    .map((value) => {
      const attempt = recordOf(value);
      if (!attempt || typeof attempt.id !== 'string') return null;
      const terminal = recordOf(attempt.terminal);
      const out: JsonRecord = { id: attempt.id };
      for (const key of ['candidate_id', 'state']) {
        if (typeof attempt[key] === 'string') out[key] = attempt[key];
      }
      const startedAt =
        typeof attempt.created_at === 'string'
          ? attempt.created_at
          : typeof attempt.started_at === 'string'
            ? attempt.started_at
            : undefined;
      const terminalAt =
        typeof terminal?.observed_at === 'string'
          ? terminal.observed_at
          : typeof attempt.finished_at === 'string'
            ? attempt.finished_at
            : typeof attempt.failed_at === 'string'
              ? attempt.failed_at
              : undefined;
      const terminalClass =
        typeof terminal?.class === 'string'
          ? terminal.class
          : typeof attempt.failure_class === 'string'
            ? attempt.failure_class
            : undefined;
      if (startedAt) out.started_at = startedAt;
      if (terminalAt) out.terminal_at = terminalAt;
      if (terminalClass) out.terminal_class = terminalClass;
      return out;
    })
    .filter((attempt): attempt is JsonRecord => !!attempt);

  const route = routing
    ? {
        outcome: routeOutcomeClass(originHarness, routing),
        ...(typeof policy?.objective === 'string' ? { objective: policy.objective } : {}),
        candidates,
        selected: selectedCandidate
          ? {
              ...selectedCandidate,
              candidate_id: selectedId,
              ...(typeof selected?.chain === 'string' ? { chain: selected.chain } : {}),
              ...(typeof selected?.selected_at === 'string'
                ? { selected_at: selected.selected_at }
                : {}),
            }
          : null,
        chains: {
          ample: stringList(chains?.ample),
          tight: stringList(chains?.tight),
        },
        fallback: {
          on: stringList(fallback?.on),
          never_on: stringList(fallback?.never_on),
          ...(typeof fallback?.exhaustion === 'string'
            ? { exhaustion: fallback.exhaustion }
            : {}),
          ...(typeof fallback?.same_harness === 'string'
            ? { same_harness: fallback.same_harness }
            : {}),
        },
        reason_codes: stringList(selected?.reason_codes),
      }
    : null;

  return {
    state: routing ? (planning ? 'routed' : 'partial') : 'planned',
    ...(planning ? { planning } : {}),
    ...(route ? { route } : {}),
    attempts,
  };
}

function missionProjection(board: JsonRecord): JsonRecord {
  const goal = typeof board.goal === 'string' ? board.goal : '';
  const contract = recordOf(board.goal_contract);
  if (!contract || contract.schema !== 'ccm/goal-contract/v1') {
    return { kind: 'legacy', summary: goal, pending: false };
  }
  const brief = recordOf(contract.brief);
  const assurance = typeof contract.assurance === 'string' ? contract.assurance : 'pending';
  return {
    kind: 'goal-contract',
    summary: goal,
    assurance,
    ...(typeof contract.revision === 'number' ? { revision: contract.revision } : {}),
    ...(typeof contract.updated_at === 'string' ? { updated_at: contract.updated_at } : {}),
    brief: {
      present: typeof brief?.ref === 'string',
      ...(typeof brief?.ref === 'string' ? { ref: brief.ref } : {}),
    },
    pending: assurance === 'pending',
  };
}

function compactTask(task: JsonRecord, originHarness = 'unknown'): JsonRecord | null {
  const id = taskId(task);
  if (!id) return null;
  const out: JsonRecord = {};
  for (const key of [
    'id',
    'title',
    'status',
    'deps',
    'parent',
    'type',
    'executor',
    'blocked_on',
    'estimate',
    'artifact',
    'verified',
    'created_at',
    'started_at',
    'finished_at',
    'updated_at',
    'acceptance',
    'justification',
    'dep_pins',
    'hitl_rounds',
    'notes',
    'tags',
    'role',
    'references',
    'watchdog',
  ]) {
    if (task[key] !== undefined) out[key] = task[key];
  }
  if (task.decision_package !== undefined) {
    out.decision_package =
      task.decision_package && typeof task.decision_package === 'object'
        ? task.decision_package
        : true;
  }
  const execution = executionProjection(task, originHarness);
  if (execution) out.execution = execution;
  return out;
}

function countStatuses(tasks: JsonRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const status of STATUS_ENUM) out[status] = 0;
  for (const task of tasks) {
    const status = statusOf(task);
    if (status) out[status] = (out[status] || 0) + 1;
  }
  return out;
}

function topologyHashFor(board: JsonRecord): string {
  const topology = tasksOf(board)
    .map((task) => ({
      id: taskId(task),
      deps: Array.isArray(task.deps)
        ? task.deps
            .filter((dep): dep is string => typeof dep === 'string')
            .slice()
            .sort()
        : [],
      parent: typeof task.parent === 'string' ? task.parent : '',
    }))
    .filter((task) => task.id)
    .sort((a, b) => a.id.localeCompare(b.id));
  return sha256Hex(JSON.stringify(topology));
}

function mapArrayValues(map: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!map || typeof (map as { forEach?: unknown }).forEach !== 'function') return out;
  (map as Map<string, unknown>).forEach((value, key) => {
    out[key] = Array.isArray(value) ? value.slice() : value;
  });
  return out;
}

interface ViewerEdge {
  id: string;
  source: string;
  target: string;
  from: string;
  to: string;
  type: 'dep' | 'parent';
  critical?: boolean;
  qualification?: ReturnType<typeof dependencyQualified>;
}

interface RankInfo {
  rankById: Map<string, number>;
  ranks: Array<{ id: string; label: string; node_ids: string[] }>;
}

function graphEdges(
  board: JsonRecord,
  tasks: JsonRecord[],
  criticalPath: string[] = [],
  deliveryFacts: DeliveryFacts = {},
): ViewerEdge[] {
  const criticalEdges = new Set<string>();
  for (let i = 1; i < criticalPath.length; i++) {
    criticalEdges.add(`${criticalPath[i - 1]}->${criticalPath[i]}`);
  }
  const edges: ViewerEdge[] = [];
  for (const task of tasks) {
    const id = taskId(task);
    if (!id) continue;
    if (Array.isArray(task.deps)) {
      for (const dep of task.deps) {
        if (typeof dep === 'string' && dep) {
          const edgeId = `${dep}->${id}`;
          edges.push({
            id: edgeId,
            source: dep,
            target: id,
            from: dep,
            to: id,
            type: 'dep',
            critical: criticalEdges.has(edgeId),
            qualification: dependencyQualified(board, id, dep, deliveryFacts),
          });
        }
      }
    }
    if (typeof task.parent === 'string' && task.parent) {
      const edgeId = `${task.parent}->${id}`;
      edges.push({
        id: edgeId,
        source: task.parent,
        target: id,
        from: task.parent,
        to: id,
        type: 'parent',
        critical: criticalEdges.has(edgeId),
      });
    }
  }
  return edges;
}

function rankTasks(
  tasks: JsonRecord[],
  topoOrder: string[],
  upstream: Map<string, unknown>,
): RankInfo {
  const taskOrder = new Map(tasks.map((task, index) => [taskId(task), index]));
  const ids = topoOrder.length
    ? topoOrder
    : tasks
        .map(taskId)
        .filter((id): id is string => !!id)
        .sort((a, b) => a.localeCompare(b));
  const rankById = new Map<string, number>();
  for (const id of ids) {
    const deps = Array.isArray(upstream.get(id))
      ? (upstream.get(id) as unknown[]).filter((dep): dep is string => typeof dep === 'string')
      : [];
    const rank = deps.length ? 1 + Math.max(...deps.map((dep) => rankById.get(dep) ?? 0)) : 0;
    rankById.set(id, rank);
  }
  const grouped = new Map<number, string[]>();
  for (const id of tasks.map(taskId).filter((value): value is string => !!value)) {
    const rank = rankById.get(id) ?? 0;
    const group = grouped.get(rank) ?? [];
    group.push(id);
    grouped.set(rank, group);
  }
  const ranks = [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rank, nodeIds]) => ({
      id: `R${rank}`,
      label: `R${rank}`,
      node_ids: nodeIds.sort((a, b) => (taskOrder.get(a) ?? 0) - (taskOrder.get(b) ?? 0)),
    }));
  return { rankById, ranks };
}

function taskTitle(task: JsonRecord): string {
  const id = taskId(task);
  return typeof task.title === 'string' && task.title ? task.title : id;
}

function statusBucketId(task: JsonRecord): string {
  const status = statusOf(task);
  if (isAwaitingUser(task as never)) return 'awaiting-user';
  if (status === 'in_flight') return 'in-flight';
  if (status === 'done' && taskTrulyDone(task as never)) return 'done';
  if (status === 'blocked') return 'blocked';
  if (status === 'failed' || status === 'uncertain' || status === 'escalated') return 'stale';
  if (status === 'ready') return 'ready';
  return status || 'unknown';
}

function statusBuckets(tasks: JsonRecord[]): Array<{
  id: string;
  label: string;
  tone: string;
  count: number;
}> {
  const defs = [
    ['ready', 'Ready', 'ready'],
    ['in-flight', 'In Flight', 'in-flight'],
    ['awaiting-user', 'Awaiting User', 'awaiting-user'],
    ['blocked', 'Blocked', 'blocked'],
    ['stale', 'Stale / Error', 'stale'],
    ['done', 'Done / Verified', 'done'],
  ] as const;
  const counts = new Map<string, number>();
  for (const task of tasks)
    counts.set(statusBucketId(task), (counts.get(statusBucketId(task)) || 0) + 1);
  return defs.map(([id, label, tone]) => ({
    id,
    label,
    tone,
    count: counts.get(id) || 0,
  }));
}

// Lenient timestamp parse (mirrors the legacy viewer's parseTs): full/partial ISO at the
// start of the string wins; bare date accepted; anything else -> null. Legacy boards may
// carry dispatched_at/completed_at instead of started_at/finished_at — callers fall back.
function parseTsLoose(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const iso = value.match(
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/,
  );
  if (iso) {
    const ms = Date.parse(iso[0]);
    if (!Number.isNaN(ms)) return ms;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
}

function taskStartTs(task: JsonRecord): number | null {
  return parseTsLoose(task.started_at) ?? parseTsLoose(task.dispatched_at);
}

const STALLING_STATUSES = new Set(['in_flight', 'blocked']);

/**
 * Server-side derived analytics (ADR-029: the client must not rebuild a second scheduling
 * engine — transitive closures / longest chains live HERE). Additive `insights` block on the
 * view-model; every field is a plain readout the UI renders verbatim.
 */
function buildInsights(
  board: JsonRecord,
  tasks: JsonRecord[],
  graph: ReturnType<typeof analyzeGraph>,
): JsonRecord {
  const now = Date.now();
  const ids = tasks.map(taskId).filter(Boolean);
  const upstream = graph.upstream as Map<string, string[]>;
  const perNode: Record<string, { impact: number; in_deg: number }> = {};
  for (const id of ids) {
    perNode[id] = {
      impact: graph.descendants(id).size,
      in_deg: Array.isArray(upstream.get(id)) ? (upstream.get(id) as string[]).length : 0,
    };
  }

  // highest downstream impact
  let impactNode: string | null = null;
  let impactMax = -1;
  for (const id of ids) {
    const v = perNode[id]?.impact ?? 0;
    if (v > impactMax) {
      impactMax = v;
      impactNode = id;
    }
  }

  // top convergence (max in-degree, ties broken by impact)
  let convNode: string | null = null;
  let convMax = -1;
  for (const id of ids) {
    const v = perNode[id]?.in_deg ?? 0;
    if (v > convMax) {
      convMax = v;
      convNode = id;
    } else if (
      v === convMax &&
      convNode != null &&
      (perNode[id]?.impact ?? 0) > (perNode[convNode]?.impact ?? 0)
    ) {
      convNode = id;
    }
  }

  // bottleneck: stalling (in_flight/blocked) node with the highest impact; tie-break by
  // elapsed-since-start; if the top-impact staller gates nothing, prefer the longest-running
  // in_flight node (a slow node IS the bottleneck even with low fan-out).
  let bneck: string | null = null;
  let bneckImpact = -1;
  let bneckElapsed = -1;
  let longestInflight: string | null = null;
  let longestMs = -1;
  for (const task of tasks) {
    const id = taskId(task);
    if (!id || !STALLING_STATUSES.has(statusOf(task))) continue;
    const imp = perNode[id]?.impact ?? 0;
    const ts = taskStartTs(task);
    const el = ts != null ? now - ts : -1;
    if (statusOf(task) === 'in_flight' && el > longestMs) {
      longestMs = el;
      longestInflight = id;
    }
    if (imp > bneckImpact || (imp === bneckImpact && el > bneckElapsed)) {
      bneck = id;
      bneckImpact = imp;
      bneckElapsed = el;
    }
  }
  if (bneck != null && bneckImpact <= 0 && longestInflight != null) bneck = longestInflight;
  const bneckTask = bneck ? tasks.find((task) => taskId(task) === bneck) : undefined;

  // WIP vs wip_limit (v2 boards keep it under scheduling; legacy at the top level)
  const wip = tasks.filter((task) => statusOf(task) === 'in_flight').length;
  const scheduling =
    board.scheduling && typeof board.scheduling === 'object'
      ? (board.scheduling as JsonRecord)
      : {};
  const rawLimit = scheduling.wip_limit ?? board.wip_limit;
  const wipLimit = typeof rawLimit === 'number' && Number.isFinite(rawLimit) ? rawLimit : null;

  // awaiting-user gates + oldest gate age
  const gates = tasks.filter((task) => isAwaitingUser(task as never));
  let earliestGate = Number.POSITIVE_INFINITY;
  for (const task of gates) {
    const ts = taskStartTs(task);
    if (ts != null && ts < earliestGate) earliestGate = ts;
  }

  // orchestration age: earliest task start, else owner.heartbeat
  let earliest = Number.POSITIVE_INFINITY;
  for (const task of tasks) {
    const ts = taskStartTs(task);
    if (ts != null && ts < earliest) earliest = ts;
  }
  if (earliest === Number.POSITIVE_INFINITY && board.owner && typeof board.owner === 'object') {
    const hb = parseTsLoose((board.owner as JsonRecord).heartbeat);
    if (hb != null) earliest = hb;
  }

  return {
    impact: { id: impactMax > 0 ? impactNode : null, count: Math.max(impactMax, 0) },
    convergence: { id: convMax >= 2 ? convNode : null, in_deg: Math.max(convMax, 0) },
    bottleneck: bneck
      ? {
          id: bneck,
          impact: perNode[bneck]?.impact ?? 0,
          status: bneckTask ? statusOf(bneckTask) : '',
          since:
            bneckTask && typeof (bneckTask.started_at ?? bneckTask.dispatched_at) === 'string'
              ? ((bneckTask.started_at ?? bneckTask.dispatched_at) as string)
              : null,
          elapsed_ms:
            bneckTask && taskStartTs(bneckTask) != null
              ? now - (taskStartTs(bneckTask) as number)
              : null,
        }
      : null,
    wip: { count: wip, limit: wipLimit, over: wipLimit != null && wip > wipLimit },
    awaiting: {
      count: gates.length,
      oldest_gate_elapsed_ms: earliestGate === Number.POSITIVE_INFINITY ? null : now - earliestGate,
    },
    age_ms: earliest === Number.POSITIVE_INFINITY ? null : now - earliest,
    per_node: perNode,
  };
}

// ---- /decisions.json — discuss sidecar scan (ported from the legacy view-server) --------
// Read-only, single directory level, no symlink follow-out. Any individual file that fails
// to read/parse is skipped; a missing home or zero sidecars yields [] — graceful, never 500.

function parseFlatYaml(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    let val = line.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function parseFrontmatter(text: string): Record<string, string> {
  const stripped = text.replace(/^﻿/, '');
  const m = stripped.match(/^[ \t]*\r?\n?---[ \t]*\r?\n([\s\S]*?)(?:\r?\n---[ \t]*(?:\r?\n|$)|$)/);
  if (m?.[1] != null) return parseFlatYaml(m[1]);
  const m2 = stripped.match(/^---[ \t]*\r?\n([\s\S]*?)(?:\r?\n---[ \t]*(?:\r?\n|$)|$)/);
  if (m2?.[1] != null) return parseFlatYaml(m2[1]);
  return {};
}

function extractTldr(text: string): string {
  let inSection = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^#{1,6}\s/.test(line)) {
      inSection = /^#{1,6}\s*TL;?\s*DR\b/i.test(line);
      continue;
    }
    if (inSection && line) {
      return line.length > 200 ? line.slice(0, 200) : line;
    }
  }
  return '';
}

function decisionNodeIdFromFilename(file: string): string {
  const base = file.replace(/\.decision\.md$/i, '');
  const parts = base.split('--');
  if (parts.length >= 3) return parts[parts.length - 2] ?? '';
  return '';
}

function decisionStampFromFilename(file: string): string {
  const base = file.replace(/\.decision\.md$/i, '');
  const parts = base.split('--');
  if (parts.length >= 3) return parts[parts.length - 1] ?? '';
  return '';
}

interface DecisionRow {
  node_id: string;
  file: string;
  resolved_at: string;
  ask_type: string;
  round: number;
  tldr: string;
}

function collectDecisions(boardPath: string): DecisionRow[] {
  const boardHome = path.dirname(boardPath);
  // Cross-board bleed guard: sidecars are named `<board-stem>--<node-id>--<stamp>.decision.md`,
  // so only files starting with THIS board's stem prefix belong here. A shared home can hold
  // several boards; without this gate another board's same-named node would skew the counts.
  const stemPrefix = `${path.basename(boardPath).replace(/\.board\.json$/i, '')}--`;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(boardHome, { withFileTypes: true });
  } catch {
    return [];
  }
  const rows: Array<Omit<DecisionRow, 'round'> & { round?: number; _stamp: string }> = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const file = ent.name;
    if (!/\.decision\.md$/i.test(file)) continue;
    if (!file.startsWith(stemPrefix)) continue;
    const full = path.join(boardHome, file);
    let text: string;
    try {
      const st = fs.lstatSync(full);
      if (!st.isFile()) continue;
      text = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    let fm: Record<string, string>;
    try {
      fm = parseFrontmatter(text);
    } catch {
      continue;
    }
    const nodeId = (fm.node_id && String(fm.node_id).trim()) || decisionNodeIdFromFilename(file);
    if (!nodeId) continue;
    rows.push({
      node_id: nodeId,
      file,
      resolved_at: fm.resolved_at ? String(fm.resolved_at) : '',
      ask_type: fm.ask_type ? String(fm.ask_type) : '',
      tldr: extractTldr(text),
      _stamp: decisionStampFromFilename(file) || (fm.resolved_at ? String(fm.resolved_at) : ''),
    });
  }

  const byNode = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = byNode.get(row.node_id) ?? [];
    group.push(row);
    byNode.set(row.node_id, group);
  }
  for (const group of byNode.values()) {
    group.sort((a, b) =>
      a._stamp < b._stamp
        ? -1
        : a._stamp > b._stamp
          ? 1
          : a.file < b.file
            ? -1
            : a.file > b.file
              ? 1
              : 0,
    );
    group.forEach((row, index) => {
      row.round = index + 1;
    });
  }

  rows.sort((a, b) =>
    a.node_id < b.node_id ? -1 : a.node_id > b.node_id ? 1 : (a.round ?? 0) - (b.round ?? 0),
  );

  return rows.map((row) => ({
    node_id: row.node_id,
    file: row.file,
    resolved_at: row.resolved_at,
    ask_type: row.ask_type,
    round: row.round ?? 1,
    tldr: row.tldr,
  }));
}

// ---- board_extras — additive passthrough of board-model blind-spot blocks --------------
// Stage-2 additive block: judgment_calls / cadence / watchdog (board level) / policy /
// coordination are carried verbatim for the UI to render. Semantics stay server/engine
// side — this is passthrough only. A field missing on the board -> the key is absent
// (never null, never an error); nothing present -> no `board_extras` key at all.
function buildBoardExtras(board: JsonRecord): JsonRecord | null {
  const out: JsonRecord = {};
  if (Array.isArray(board.judgment_calls)) {
    out.judgment_calls = board.judgment_calls.filter(
      (entry) => !!entry && typeof entry === 'object' && !Array.isArray(entry),
    );
  }
  for (const key of ['cadence', 'watchdog', 'policy', 'coordination'] as const) {
    const value = board[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

// ---- /peers.json — same-home peer roster (engine buildPeerRoster, `ccm peers` source) ---
// Read-only cross-board awareness: every OTHER active + heartbeat-fresh board in the same
// home, plus the current board's coordination.inbox as a notification summary. Fail-safe
// throughout: unreadable home -> empty roster; torn board JSON is skipped by
// loadHomeBoards; a missing current selection just yields current:null.
function buildPeersPayload(home: string, currentBoardPath: string | null): JsonRecord {
  let boards: Array<{ file: string; board: unknown }> = [];
  try {
    boards = loadHomeBoards(discover.boardsDir(home), { maxDaysAgo: Number.POSITIVE_INFINITY });
  } catch {
    boards = [];
  }
  const roster = buildPeerRoster(boards);
  const currentFile = currentBoardPath ? path.basename(currentBoardPath) : null;
  const peers = roster.peers
    .filter((peer) => peer.board_file !== currentFile)
    .map((peer) => ({
      board_file: peer.board_file,
      goal: peer.goal,
      harness: peer.harness,
      priority: peer.priority,
      active: true,
      health: 'ok',
      heartbeat: peer.heartbeat,
      heartbeat_age_sec: peer.heartbeat_age_sec,
      current: peer.current,
      planned: peer.planned,
    }));

  // Inbox summary: the CURRENT board's coordination.inbox notifications (object entries
  // passed through verbatim; anything else dropped — silent-on-unknown).
  let inbox: unknown[] = [];
  if (currentBoardPath) {
    try {
      const parsed = JSON.parse(fs.readFileSync(currentBoardPath, 'utf8'));
      const coordination =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as JsonRecord).coordination
          : null;
      const rawInbox =
        coordination && typeof coordination === 'object' && !Array.isArray(coordination)
          ? (coordination as JsonRecord).inbox
          : null;
      if (Array.isArray(rawInbox)) {
        inbox = rawInbox.filter(
          (entry) => !!entry && typeof entry === 'object' && !Array.isArray(entry),
        );
      }
    } catch {
      inbox = [];
    }
  }

  return {
    schema: PEERS_SCHEMA,
    available: true,
    current: currentFile ? { file: currentFile, path: currentBoardPath } : null,
    count: peers.length,
    peers,
    inbox,
    roster: {
      count: roster.count,
      freshness_sec: roster.freshness_sec,
      as_of: roster.as_of,
    },
  };
}

function buildViewModel(home: string, boardPath: string): JsonRecord {
  const snapshot = readBoardSnapshot(boardPath);
  const board = snapshot.board;
  const tasks = tasksOf(board);
  const deliveryFacts = resolveDeliveryFacts(board, { now: nowIso() });
  const graph = analyzeGraph(board as Parameters<typeof analyzeGraph>[0], { deliveryFacts });
  const topo = graph.topoSort();
  const cp = graph.criticalPath({ now: Date.now() });
  const criticalPath = Array.isArray(cp.chain) ? cp.chain : [];
  const ids = tasks.map(taskId).filter(Boolean);
  const owner = recordOf(board.owner);
  const originHarness = typeof owner?.harness === 'string' ? owner.harness : 'unknown';
  const parents: Record<string, string | null> = {};
  for (const id of ids) parents[id] = graph.parentOf(id);
  const compactTasks = tasks
    .map((task) => compactTask(task, originHarness))
    .filter((t): t is JsonRecord => !!t);
  const ranks = rankTasks(tasks, topo.order, graph.upstream as Map<string, unknown>);
  const readySet = graph.readySet();
  const edges = graphEdges(board, tasks, criticalPath, deliveryFacts);
  const statusCounts = countStatuses(tasks);
  const selectedTaskId =
    criticalPath[criticalPath.length - 1] || readySet[0] || compactTasks[0]?.id || null;
  const filename = path.basename(boardPath);
  const readAt = nowIso();
  const insights = buildInsights(board, tasks, graph);
  const boardExtras = buildBoardExtras(board);
  const wipInsight = insights.wip as { count: number; limit: number | null; over: boolean };
  const nodeTasks = compactTasks.map((task) => {
    const id = taskId(task);
    const rankIndex = ranks.rankById.get(id) ?? 0;
    const execution = recordOf(task.execution);
    const route = recordOf(execution?.route);
    const selected = recordOf(route?.selected);
    return {
      id,
      title: taskTitle(task),
      status: statusOf(task),
      type: typeof task.type === 'string' ? task.type : 'task',
      rank: `R${rankIndex}`,
      rank_index: rankIndex,
      executor: typeof task.executor === 'string' ? task.executor : undefined,
      handle: typeof task.handle === 'string' ? task.handle : undefined,
      critical: criticalPath.includes(id),
      selected: id === selectedTaskId,
      awaiting_user: isAwaitingUser(task as never),
      stale: ['failed', 'uncertain', 'escalated'].includes(statusOf(task)),
      ...(typeof route?.outcome === 'string' ? { route_outcome: route.outcome } : {}),
      ...(typeof selected?.harness === 'string' ? { harness: selected.harness } : {}),
      ...(typeof selected?.surface === 'string' ? { surface: selected.surface } : {}),
      ...(typeof selected?.surface_label === 'string'
        ? { surface_label: selected.surface_label }
        : {}),
      ...(typeof selected?.model === 'string' ? { model: selected.model } : {}),
      ...(Array.isArray(selected?.role_grades) ? { role_grades: selected.role_grades } : {}),
    };
  });
  return {
    schema: VIEW_MODEL_SCHEMA,
    mission: missionProjection(board),
    rev: {
      boardHash: `sha256:${sha256Hex(snapshot.raw)}`,
      topologyHash: `sha256:${topologyHashFor(board)}`,
      mtimeMs: snapshot.stat.mtimeMs,
      size: snapshot.stat.size,
      generatedAt: nowIso(),
    },
    board: {
      id: boardIdFromFilename(filename),
      filename,
      mtime_ms: snapshot.stat.mtimeMs,
      hash: `sha256:${sha256Hex(snapshot.raw)}`,
      schema: typeof board.schema === 'string' ? board.schema : 'cc-master/v2',
      goal: typeof board.goal === 'string' ? board.goal : '',
      source: boardPath,
      file: filename,
      home,
      owner: board.owner && typeof board.owner === 'object' ? board.owner : null,
      git: board.git && typeof board.git === 'object' ? board.git : null,
      meta: board.meta && typeof board.meta === 'object' ? board.meta : null,
    },
    freshness: {
      state: 'live',
      last_read_at: readAt,
      last_known_good_at: readAt,
      errors: [],
    },
    summary: {
      statusCounts,
      readySet,
      criticalPath: {
        chain: criticalPath,
        makespan: typeof cp.makespan === 'number' ? cp.makespan : null,
        weight_source: cp.weight_source || 'unavailable',
        ...(Array.isArray(cp.cycle) ? { cycle: cp.cycle } : {}),
      },
      awaitingUserCount: tasks.filter((task) => isAwaitingUser(task as never)).length,
      verifiedDone: tasks.filter((task) => taskTrulyDone(task as never)).length,
    },
    delivery: {
      mode:
        board.delivery_contract && typeof board.delivery_contract === 'object'
          ? (board.delivery_contract as JsonRecord).mode
          : 'legacy',
      edges: edges
        .filter((edge) => edge.type === 'dep')
        .map((edge) => ({
          downstream: edge.target,
          dependency: edge.source,
          qualification: edge.qualification,
        })),
    },
    insights,
    ...(boardExtras ? { board_extras: boardExtras } : {}),
    tasks: compactTasks,
    graph: {
      family: 'task-dag',
      nodes: nodeTasks,
      nodeCount: compactTasks.length,
      edgeCount: edges.length,
      edges,
      ranks: ranks.ranks,
      critical_path: criticalPath,
      ready_set: readySet,
      topoOrder: topo.order,
      cycle: topo.cycle,
      upstream: mapArrayValues(graph.upstream),
      downstream: mapArrayValues(graph.downstream),
      parents,
    },
    critical_path: criticalPath,
    ready_set: readySet,
    status: {
      buckets: statusBuckets(tasks),
      awaiting_user: tasks
        .filter((task) => isAwaitingUser(task as never))
        .map((task) => ({ id: taskId(task), title: taskTitle(task) })),
      in_flight: tasks
        .filter((task) => statusOf(task) === 'in_flight')
        .map((task) => ({
          id: taskId(task),
          title: taskTitle(task),
          handle: typeof task.handle === 'string' ? task.handle : undefined,
        })),
      blocked: tasks
        .filter((task) => statusOf(task) === 'blocked')
        .map((task) => ({
          id: taskId(task),
          title: taskTitle(task),
          reason: typeof task.blocked_on === 'string' ? task.blocked_on : undefined,
        })),
      done_verified: tasks
        .filter((task) => taskTrulyDone(task as never))
        .map((task) => ({ id: taskId(task), title: taskTitle(task) })),
    },
    diagnostics: {
      lint: topo.cycle
        ? [{ severity: 'error', message: `dependency cycle: ${topo.cycle.join(' -> ')}` }]
        : [],
      over_scheduling: wipInsight.over
        ? [
            {
              severity: 'warning',
              message: `wip ${wipInsight.count} exceeds wip_limit ${wipInsight.limit}`,
            },
          ]
        : [],
      report_freshness: 'unknown',
    },
    defaults: {
      selected_task_id: selectedTaskId,
      focus: 'critical_path_or_ready',
    },
  };
}

function taskRef(task: JsonRecord | undefined): JsonRecord | null {
  if (!task) return null;
  const id = taskId(task);
  if (!id) return null;
  return {
    id,
    title: taskTitle(task),
    status: statusOf(task),
  };
}

function logEntryText(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return String(entry ?? '');
  const record = entry as JsonRecord;
  for (const key of ['summary', 'message', 'text', 'note', 'kind']) {
    if (typeof record[key] === 'string' && record[key]) return record[key] as string;
  }
  return JSON.stringify(record);
}

function logEntryTime(entry: unknown): string {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return '';
  const record = entry as JsonRecord;
  for (const key of ['ts', 'at', 'time', 'created_at']) {
    if (typeof record[key] === 'string') return record[key] as string;
  }
  return '';
}

function logMentionsTask(entry: unknown, taskIdValue: string): boolean {
  if (typeof entry === 'string') return entry.includes(taskIdValue);
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const record = entry as JsonRecord;
  for (const key of ['task', 'task_id', 'id']) {
    if (record[key] === taskIdValue) return true;
  }
  return logEntryText(entry).includes(taskIdValue);
}

function taskActivity(board: JsonRecord, task: JsonRecord): Array<{ at: string; text: string }> {
  const id = taskId(task);
  const activity: Array<{ at: string; text: string }> = [];
  if (typeof task.started_at === 'string') {
    activity.push({ at: task.started_at, text: 'Task started' });
  }
  if (typeof task.updated_at === 'string') {
    activity.push({ at: task.updated_at, text: 'Task updated' });
  }
  if (typeof task.finished_at === 'string') {
    activity.push({ at: task.finished_at, text: 'Task finished' });
  }
  const log = Array.isArray(board.log) ? board.log : [];
  for (const entry of log) {
    if (!logMentionsTask(entry, id)) continue;
    const text = logEntryText(entry);
    if (text) activity.push({ at: logEntryTime(entry), text });
  }
  return activity;
}

function buildTaskDetail(boardPath: string, taskIdValue: string): JsonRecord | null {
  const snapshot = readBoardSnapshot(boardPath);
  const board = snapshot.board;
  const tasks = tasksOf(board);
  const deliveryFacts = resolveDeliveryFacts(board, { now: nowIso() });
  const graph = analyzeGraph(board as Parameters<typeof analyzeGraph>[0], { deliveryFacts });
  const byId = new Map(tasks.map((task) => [taskId(task), task]));
  const task = byId.get(taskIdValue);
  if (!task) return null;
  const parents = graph.predecessors(taskIdValue);
  const children = graph.successors(taskIdValue);
  const owner = recordOf(board.owner);
  const originHarness = typeof owner?.harness === 'string' ? owner.harness : 'unknown';
  const compact = compactTask(task, originHarness) || { id: taskIdValue };
  const filename = path.basename(boardPath);
  return {
    schema: TASK_DETAIL_SCHEMA,
    board: {
      id: boardIdFromFilename(filename),
      filename,
    },
    task: {
      ...compact,
      id: taskIdValue,
      title: taskTitle(task),
      status: statusOf(task),
      type: typeof task.type === 'string' ? task.type : 'task',
      parents,
      children,
      executor: typeof task.executor === 'string' ? task.executor : undefined,
      handle: typeof task.handle === 'string' ? task.handle : undefined,
      started_at: typeof task.started_at === 'string' ? task.started_at : undefined,
      updated_at: typeof task.updated_at === 'string' ? task.updated_at : undefined,
      summary:
        typeof task.summary === 'string'
          ? task.summary
          : `${taskTitle(task)} is ${statusOf(task) || 'unknown'}.`,
      next_actions:
        statusOf(task) === 'ready'
          ? ['Ready to dispatch']
          : isAwaitingUser(task as never)
            ? ['Resolve user-blocked decision']
            : [],
    },
    dependencies: parents
      .map((id) => taskRef(byId.get(id)))
      .filter((ref): ref is JsonRecord => !!ref),
    dependents: children
      .map((id) => taskRef(byId.get(id)))
      .filter((ref): ref is JsonRecord => !!ref),
    activity: taskActivity(board, task),
  };
}

function _viewerShellHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ccm web viewer - MISSION CONTROL</title>
  <style>
    :root {
      color-scheme: dark;
      --ground: oklch(0.145 0.012 255);
      --panel: oklch(0.185 0.014 255);
      --panel-hi: oklch(0.225 0.016 255);
      --grid: oklch(0.255 0.012 255);
      --hair: oklch(0.30 0.012 255);
      --hair-soft: oklch(0.26 0.010 255);
      --ink: oklch(0.93 0.008 255);
      --ink-dim: oklch(0.66 0.013 255);
      --ink-faint: oklch(0.50 0.013 255);
      --edge: oklch(0.46 0.018 252);
      --done: oklch(0.74 0.135 162);
      --inflight: oklch(0.79 0.150 74);
      --blocked: oklch(0.56 0.022 250);
      --ready: oklch(0.70 0.115 244);
      --failed: oklch(0.63 0.190 26);
      --spine: oklch(0.80 0.160 70);
      --alert: oklch(0.80 0.150 66);
      --inset: oklch(0.16 0.012 255 / 0.66);
      --chip-bg: oklch(0.26 0.012 255 / 0.72);
      --shadow: oklch(0.10 0.01 255);
      font-family: Archivo, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body {
      background:
        radial-gradient(circle at 50% 0%, oklch(0.20 0.016 255), transparent 34rem),
        linear-gradient(90deg, transparent 31px, var(--grid) 32px),
        linear-gradient(180deg, transparent 31px, var(--grid) 32px),
        var(--ground);
      background-size: auto, 32px 32px, 32px 32px, auto;
      color: var(--ink);
      overflow: hidden;
    }
    .ccm-web-viewer { min-height: 100%; display: grid; grid-template-rows: 54px 1fr; }
    .bar {
      display: flex;
      align-items: stretch;
      border-bottom: 1px solid var(--hair);
      background: linear-gradient(180deg, var(--panel-hi), var(--panel));
      box-shadow: 0 1px 0 oklch(0.12 0.01 255 / 0.6);
    }
    .ident {
      width: 284px;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 18px;
      border-right: 1px solid var(--hair-soft);
    }
    .beacon {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--done);
      box-shadow: 0 0 10px oklch(0.74 0.135 162 / 0.7);
    }
    .mark { font-weight: 800; font-size: 13px; letter-spacing: 0; text-transform: uppercase; }
    .sub { margin-top: 3px; font: 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--ink-faint); text-transform: uppercase; letter-spacing: 0; }
    .goalwrap { min-width: 0; flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 0 22px; }
    .label { font: 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--ink-faint); text-transform: uppercase; }
    #goal { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; font-weight: 700; }
    .mode {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 18px;
      border-left: 1px solid var(--hair-soft);
      font: 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: var(--ink-dim);
      text-transform: uppercase;
    }
    .shell {
      min-height: 0;
      display: grid;
      grid-template-columns: 284px minmax(0, 1fr) 340px;
      grid-template-rows: 128px minmax(0, 1fr);
    }
    aside, .insights, .detail {
      background: oklch(0.17 0.012 255 / 0.92);
      border-color: var(--hair);
    }
    aside {
      grid-row: 1 / 3;
      border-right: 1px solid var(--hair);
      padding: 16px;
      overflow: auto;
    }
    .insights {
      grid-column: 2 / 4;
      border-bottom: 1px solid var(--hair);
      display: grid;
      grid-template-columns: repeat(7, minmax(92px, 1fr));
      gap: 1px;
      padding: 14px;
    }
    .metric {
      min-width: 0;
      background: linear-gradient(180deg, var(--panel), var(--inset));
      border: 1px solid var(--hair-soft);
      border-radius: 7px;
      padding: 11px 12px;
    }
    .metric strong { display: block; font-size: 25px; line-height: 1; }
    .metric span { display: block; margin-top: 7px; color: var(--ink-faint); font: 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; text-transform: uppercase; }
    .viewer {
      min-width: 0;
      min-height: 0;
      position: relative;
      overflow: auto;
      padding: 26px;
    }
    .dag-canvas {
      position: relative;
      min-width: 720px;
      min-height: 540px;
      border: 1px solid var(--hair-soft);
      border-radius: 7px;
      background:
        radial-gradient(circle at 50% 22%, oklch(0.22 0.016 255 / 0.72), transparent 24rem),
        linear-gradient(90deg, transparent 23px, oklch(0.255 0.012 255 / 0.72) 24px),
        linear-gradient(180deg, transparent 23px, oklch(0.255 0.012 255 / 0.72) 24px),
        oklch(0.135 0.012 255);
      background-size: auto, 24px 24px, 24px 24px, auto;
      box-shadow: inset 0 1px 0 oklch(0.30 0.012 255 / 0.35);
    }
    #edges { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
    .edge { stroke: var(--edge); stroke-width: 2; fill: none; opacity: 0.86; }
    .edge.spine { stroke: var(--spine); stroke-width: 3; opacity: 1; }
    .node {
      position: absolute;
      width: 178px;
      min-height: 88px;
      border: 1px solid var(--hair);
      border-left: 4px solid var(--ready);
      border-radius: 7px;
      background: linear-gradient(180deg, var(--panel-hi), var(--panel));
      box-shadow: 0 8px 22px oklch(0.10 0.01 255 / 0.45);
      padding: 10px 11px;
      cursor: pointer;
    }
    .node.done { border-left-color: var(--done); }
    .node.in_flight { border-left-color: var(--inflight); }
    .node.blocked { border-left-color: var(--blocked); }
    .node.failed, .node.stale, .node.uncertain, .node.escalated { border-left-color: var(--failed); }
    .node.selected { outline: 2px solid var(--spine); outline-offset: 2px; }
    .nid { font: 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--ink-faint); }
    .ntitle { margin-top: 6px; font-weight: 700; font-size: 14px; line-height: 1.22; }
    .nmeta { margin-top: 10px; display: flex; gap: 6px; flex-wrap: wrap; }
    .chip { border: 1px solid var(--hair-soft); border-radius: 4px; padding: 3px 6px; background: var(--chip-bg); color: var(--ink-dim); font: 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .side-title { margin: 0 0 11px; color: var(--ink-faint); font: 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; text-transform: uppercase; }
    .boardselect { display: grid; gap: 8px; }
    .boardbtn {
      width: 100%;
      text-align: left;
      color: var(--ink);
      background: var(--inset);
      border: 1px solid var(--hair-soft);
      border-radius: 7px;
      padding: 10px;
      cursor: pointer;
    }
    .boardbtn.current { border-color: var(--spine); }
    .bfile { margin-top: 5px; color: var(--ink-faint); font: 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
    .detail {
      border-left: 1px solid var(--hair);
      padding: 18px;
      overflow: auto;
    }
    .detail h2 { margin: 0 0 8px; font-size: 18px; }
    .detail pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      padding: 10px;
      border: 1px solid var(--hair-soft);
      border-radius: 7px;
      background: var(--inset);
      color: var(--ink-dim);
      font: 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .empty { color: var(--ink-faint); padding: 18px; }
    @media (max-width: 980px) {
      body { overflow: auto; }
      .ccm-web-viewer { min-height: 100vh; }
      .bar { height: auto; min-height: 54px; }
      .ident { width: auto; }
      .mode { display: none; }
      .shell { grid-template-columns: 1fr; grid-template-rows: auto auto minmax(420px, 1fr) auto; }
      aside, .insights, .detail, .viewer { grid-column: auto; grid-row: auto; }
      aside { border-right: 0; border-bottom: 1px solid var(--hair); }
      .insights { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <div class="ccm-web-viewer">
    <header class="bar">
      <div class="ident"><span class="beacon"></span><div><div class="mark">MISSION CONTROL</div><div class="sub">ccm web viewer</div></div></div>
      <div class="goalwrap"><div class="label">board goal</div><div id="goal">loading board...</div></div>
      <div class="mode">read only - DAG viewer</div>
    </header>
    <main class="shell">
      <aside><h2 class="side-title">active boards</h2><div id="boards" class="boardselect"></div></aside>
      <section id="insights" class="insights"></section>
      <section class="viewer"><div class="dag-canvas"><svg id="edges"></svg><div id="nodes"></div></div></section>
      <section id="detail" class="detail"><h2>Board telemetry</h2><p class="empty">Select a node to inspect task detail.</p></section>
    </main>
  </div>
  <script>
    const params = new URLSearchParams(location.search);
    let current = params.get('board') || '';
    let selected = '';
    let model = null;
    function text(value) { return value == null || value === '' ? 'n/a' : String(value); }
    function esc(value) {
      return text(value).replace(/[&<>"']/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
      });
    }
    function statusClass(status) { return String(status || 'ready').replace(/[^a-z0-9_-]/gi, '_'); }
    function metric(label, value) {
      return '<div class="metric"><strong>' + esc(value) + '</strong><span>' + esc(label) + '</span></div>';
    }
    function api(path) {
      const sep = path.indexOf('?') === -1 ? '?' : '&';
      return current ? path + sep + 'board=' + encodeURIComponent(current) : path;
    }
    async function loadBoards() {
      const payload = await fetch('/boards.json', { cache: 'no-store' }).then(function (r) { return r.json(); });
      const host = document.getElementById('boards');
      host.innerHTML = '';
      const boards = Array.isArray(payload.boards) ? payload.boards : [];
      boards.forEach(function (board) {
        if (!current && board.current) current = board.file;
        const btn = document.createElement('button');
        btn.className = 'boardbtn' + (board.current || board.file === current ? ' current' : '');
        btn.innerHTML = '<strong>' + esc(board.goal || '(untitled board)') + '</strong><div class="bfile">' + esc(board.file) + '</div>';
        btn.addEventListener('click', function () {
          current = board.file;
          selected = '';
          loadAll();
        });
        host.appendChild(btn);
      });
      if (!boards.length) host.innerHTML = '<div class="empty">No board files found.</div>';
    }
    async function loadAll() {
      const vm = await fetch(api('/view-model.json'), { cache: 'no-store' }).then(function (r) { return r.json(); });
      model = vm;
      document.getElementById('goal').textContent = vm.board && vm.board.goal ? vm.board.goal : 'No selected board';
      renderInsights(vm);
      renderDag(vm);
      renderDetail();
      loadStatus();
    }
    async function loadStatus() {
      try {
        const env = await fetch(api('/status-report.json?max_age=30s'), { cache: 'no-store' }).then(function (r) { return r.json(); });
        const detail = document.getElementById('detail');
        if (!selected && env && env.ok && env.report) {
          const cp = env.report.critical_path || {};
          detail.innerHTML = '<h2>Board telemetry</h2><pre>' +
            esc('status-report: ccm/status-report/v1\\ncritical path: ' + ((cp.task_ids || []).join(' -> ') || 'none') +
            '\\nreport freshness: ' + (env.artifact && env.artifact.freshness || 'n/a')) + '</pre>';
        }
      } catch (_e) {}
    }
    function renderInsights(vm) {
      const counts = vm.summary && vm.summary.statusCounts ? vm.summary.statusCounts : {};
      const ready = vm.summary && Array.isArray(vm.summary.readySet) ? vm.summary.readySet.length : 0;
      const cp = vm.summary && vm.summary.criticalPath ? vm.summary.criticalPath : {};
      document.getElementById('insights').innerHTML =
        metric('total', vm.graph ? vm.graph.nodeCount : 0) +
        metric('done', counts.done || 0) +
        metric('in flight', counts.in_flight || 0) +
        metric('ready', ready) +
        metric('awaiting user', vm.summary ? vm.summary.awaitingUserCount : 0) +
        metric('critical nodes', Array.isArray(cp.chain) ? cp.chain.length : 0) +
        metric('weight source', cp.weight_source || 'n/a');
    }
    function depthFor(id, upstream, memo) {
      if (memo[id] != null) return memo[id];
      const deps = Array.isArray(upstream[id]) ? upstream[id] : [];
      if (!deps.length) return memo[id] = 0;
      return memo[id] = 1 + Math.max.apply(Math, deps.map(function (dep) { return depthFor(dep, upstream, memo); }));
    }
    function renderDag(vm) {
      const tasks = Array.isArray(vm.tasks) ? vm.tasks : [];
      const upstream = vm.graph && vm.graph.upstream ? vm.graph.upstream : {};
      const memo = {};
      const byDepth = {};
      tasks.forEach(function (task) {
        const d = depthFor(task.id, upstream, memo);
        if (!byDepth[d]) byDepth[d] = [];
        byDepth[d].push(task);
      });
      const pos = {};
      const nodes = [];
      Object.keys(byDepth).sort(function (a, b) { return Number(a) - Number(b); }).forEach(function (depth) {
        byDepth[depth].sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); }).forEach(function (task, row) {
          const x = 42 + Number(depth) * 240;
          const y = 38 + row * 126;
          pos[task.id] = { x: x, y: y };
          nodes.push('<button class="node ' + statusClass(task.status) + (selected === task.id ? ' selected' : '') +
            '" data-id="' + esc(task.id) + '" style="left:' + x + 'px;top:' + y + 'px">' +
            '<div class="nid">' + esc(task.id) + '</div><div class="ntitle">' + esc(task.title || task.id) +
            '</div><div class="nmeta"><span class="chip">' + esc(task.status || 'unknown') + '</span><span class="chip">' +
            esc((Array.isArray(task.deps) ? task.deps.length : 0) + ' deps') + '</span></div></button>');
        });
      });
      document.getElementById('nodes').innerHTML = nodes.join('') || '<div class="empty">No tasks in this board.</div>';
      document.querySelectorAll('.node').forEach(function (node) {
        node.addEventListener('click', function () {
          selected = node.getAttribute('data-id') || '';
          renderDag(model);
          renderDetail();
        });
      });
      const cp = vm.summary && vm.summary.criticalPath && Array.isArray(vm.summary.criticalPath.chain) ? vm.summary.criticalPath.chain : [];
      const cpEdges = new Set();
      for (let i = 1; i < cp.length; i++) cpEdges.add(cp[i - 1] + '->' + cp[i]);
      const paths = (vm.graph && Array.isArray(vm.graph.edges) ? vm.graph.edges : []).filter(function (e) { return e.type === 'dep'; }).map(function (e) {
        const a = pos[e.from];
        const b = pos[e.to];
        if (!a || !b) return '';
        const x1 = a.x + 178;
        const y1 = a.y + 44;
        const x2 = b.x;
        const y2 = b.y + 44;
        const mx = x1 + Math.max(42, (x2 - x1) / 2);
        const cls = cpEdges.has(e.from + '->' + e.to) ? 'edge spine' : 'edge';
        return '<path class="' + cls + '" d="M ' + x1 + ' ' + y1 + ' C ' + mx + ' ' + y1 + ', ' + mx + ' ' + y2 + ', ' + x2 + ' ' + y2 + '"></path>';
      });
      document.getElementById('edges').innerHTML = paths.join('');
    }
    function renderDetail() {
      if (!model || !selected) return;
      const task = (model.tasks || []).find(function (t) { return t.id === selected; });
      if (!task) return;
      document.getElementById('detail').innerHTML = '<h2>' + esc(task.title || task.id) + '</h2><pre>' + esc(JSON.stringify(task, null, 2)) + '</pre>';
    }
    loadBoards().then(loadAll).catch(function (e) {
      document.getElementById('goal').textContent = 'viewer data unavailable';
      document.getElementById('detail').innerHTML = '<h2>Viewer error</h2><pre>' + esc(e && e.message ? e.message : e) + '</pre>';
    });
  </script>
</body>
</html>`;
}

export function serve(ctx: Ctx): Promise<number> {
  const statePath = ctx.values.state as string;
  const state = readState(statePath);
  if (!state) throw kinded(`invalid web-viewer state: ${statePath}`, 'NotFound');
  const token = readToken(state.token_file);
  if (!token) throw kinded(`missing web-viewer token file: ${state.token_file}`, 'NotFound');

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://${state.host}:${state.port || 0}`);
      const auth = tokenFromRequest(req, url);
      if (auth !== token) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
      }
      if (req.method !== 'GET' && !(req.method === 'POST' && url.pathname === '/_ccm/shutdown')) {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
      }
      if (url.pathname === '/_ccm/health') {
        sendJson(res, 200, {
          schema: HEALTH_SCHEMA,
          id: state.id,
          pid: process.pid,
          started_at: state.server.started_at,
          ccm_version: state.server.ccm_version,
        });
        return;
      }
      if (url.pathname === '/_ccm/shutdown' && req.method === 'POST') {
        sendJson(res, 200, { ok: true });
        server.close(() => resolve(EXIT.OK));
        return;
      }
      if (url.pathname === '/boards.json') {
        const runtimeState = latestRuntimeState(state);
        const hasBoardParam = url.searchParams.has('board') || url.searchParams.has('board_file');
        const requestedBoardPath = hasBoardParam
          ? resolveHttpBoard(
              runtimeState.home,
              runtimeState.current_selection?.board_path || null,
              url,
            )
          : runtimeState.current_selection?.board_path || null;
        if (hasBoardParam && !requestedBoardPath) {
          sendJson(res, 404, { schema: BOARDS_SCHEMA, error: 'board not found' });
          return;
        }
        const boards = listBoards(runtimeState.home, requestedBoardPath);
        const selected = boards.find(
          (board): board is JsonRecord =>
            !!board &&
            typeof board === 'object' &&
            !Array.isArray(board) &&
            (board as JsonRecord).selected === true,
        );
        sendJson(res, 200, {
          schema: BOARDS_SCHEMA,
          service: {
            home: runtimeState.home,
            health: runtimeState.health || 'ok',
            id: runtimeState.id,
          },
          current_board_id: typeof selected?.id === 'string' ? selected.id : undefined,
          home: runtimeState.home,
          boards_dir: discover.boardsDir(runtimeState.home),
          boards,
        });
        return;
      }
      if (url.pathname === '/board.json') {
        const runtimeState = latestRuntimeState(state);
        const boardPath = resolveHttpBoard(
          runtimeState.home,
          runtimeState.current_selection?.board_path || null,
          url,
        );
        if (!boardPath) {
          sendJson(res, 404, { error: 'board not found' });
          return;
        }
        try {
          sendJson(res, 200, JSON.parse(fs.readFileSync(boardPath, 'utf8')));
        } catch (e) {
          sendJson(res, 200, { error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }
      if (url.pathname === '/view-model.json') {
        const runtimeState = latestRuntimeState(state);
        const boardPath = resolveHttpBoard(
          runtimeState.home,
          runtimeState.current_selection?.board_path || null,
          url,
        );
        if (!boardPath) {
          sendJson(res, 404, { schema: VIEW_MODEL_SCHEMA, error: 'board not found' });
          return;
        }
        try {
          sendJson(res, 200, buildViewModel(runtimeState.home, boardPath));
        } catch (e) {
          sendJson(res, 200, {
            schema: VIEW_MODEL_SCHEMA,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
      if (url.pathname === '/task.json') {
        const runtimeState = latestRuntimeState(state);
        const boardPath = resolveHttpBoard(
          runtimeState.home,
          runtimeState.current_selection?.board_path || null,
          url,
        );
        if (!boardPath) {
          sendJson(res, 404, { schema: TASK_DETAIL_SCHEMA, error: 'board not found' });
          return;
        }
        const requestedTask = url.searchParams.get('task') || url.searchParams.get('id');
        if (!requestedTask) {
          sendJson(res, 400, { schema: TASK_DETAIL_SCHEMA, error: 'missing task parameter' });
          return;
        }
        try {
          const detail = buildTaskDetail(boardPath, requestedTask);
          if (!detail) {
            sendJson(res, 404, { schema: TASK_DETAIL_SCHEMA, error: 'task not found' });
            return;
          }
          sendJson(res, 200, detail);
        } catch (e) {
          sendJson(res, 200, {
            schema: TASK_DETAIL_SCHEMA,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
      if (url.pathname === '/decisions.json') {
        const runtimeState = latestRuntimeState(state);
        const boardPath = resolveHttpBoard(
          runtimeState.home,
          runtimeState.current_selection?.board_path || null,
          url,
        );
        if (!boardPath) {
          sendJson(res, 404, { error: 'board not found' });
          return;
        }
        let payload: DecisionRow[];
        try {
          payload = collectDecisions(boardPath);
        } catch {
          payload = []; // defensive: any unexpected failure degrades to empty, not 500.
        }
        sendJson(res, 200, payload);
        return;
      }
      if (url.pathname === '/peers.json') {
        const runtimeState = latestRuntimeState(state);
        const hasBoardParam = url.searchParams.has('board') || url.searchParams.has('board_file');
        const currentBoardPath = hasBoardParam
          ? resolveHttpBoard(
              runtimeState.home,
              runtimeState.current_selection?.board_path || null,
              url,
            )
          : runtimeState.current_selection?.board_path || null;
        try {
          sendJson(res, 200, buildPeersPayload(runtimeState.home, currentBoardPath));
        } catch (e) {
          // Defensive: any unexpected failure degrades to an empty roster, never a 500.
          sendJson(res, 200, {
            schema: PEERS_SCHEMA,
            available: false,
            current: null,
            count: 0,
            peers: [],
            inbox: [],
            error: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
      if (url.pathname === '/status-report.json') {
        const runtimeState = latestRuntimeState(state);
        const boardPath = resolveHttpBoard(
          runtimeState.home,
          runtimeState.current_selection?.board_path || null,
          url,
        );
        if (!boardPath) {
          sendJson(res, 404, {
            schema: 'ccm/status-report/v1',
            ok: false,
            error: 'board not found',
          });
          return;
        }
        try {
          sendJson(
            res,
            200,
            writeReportForBoard({
              home: runtimeState.home,
              boardPath,
              maxAgeSeconds: parseMaxAgeParam(url),
              refresh: url.searchParams.get('refresh') === '1',
            }),
          );
        } catch (e) {
          sendJson(res, 200, {
            schema: 'ccm/status-report/v1',
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }
      if (url.pathname === '/' || url.pathname.startsWith('/assets/')) {
        const distDir = appDistDir(state.home);
        if (!distDir) {
          sendJson(res, 503, {
            error:
              'web-viewer app dist is missing; ccm package may be corrupt or built without web-viewer assets',
          });
          return;
        }
        const assetPath = resolveStaticAsset(distDir, url.pathname);
        if (!assetPath) {
          sendJson(res, 404, { error: 'not found' });
          return;
        }
        sendStaticFile(res, assetPath, token, url.pathname === '/');
        return;
      }
      sendJson(res, 404, { error: 'not found' });
    });
    server.on('error', (e) => {
      ctx.err(`web-viewer serve error: ${e instanceof Error ? e.message : String(e)}`);
      resolve(EXIT.ERROR);
    });
    server.listen(state.port, state.host, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : state.port;
      const baseUrl = `http://${state.host}:${port}`;
      const next = {
        ...state,
        pid: process.pid,
        port,
        base_url: baseUrl,
        url: redactedUrl(baseUrl),
        health: 'ok',
        stale: false,
      };
      writeJson(state.state_path, next);
      ctx.out(JSON.stringify({ ok: true }));
    });
  });
}
