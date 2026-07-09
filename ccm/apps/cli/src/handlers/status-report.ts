import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  analyzeGraph,
  type CriticalPathResult,
  lintBoard,
  taskTrulyDone,
  withLock,
} from '@ccm/engine';
import * as discover from '../discover.js';
import { readVersion } from '../help.js';
import * as io from '../io.js';
import type { Ctx } from './_common.js';

const EXIT = io.EXIT;
const REPORT_SCHEMA = 'ccm/status-report/v1';
const DEFAULT_MAX_AGE_SECONDS = 30;

interface KindedError extends Error {
  errKind?: string;
  kind?: string;
}

interface BoardRecord {
  goal?: unknown;
  owner?: unknown;
  git?: unknown;
  scheduling?: unknown;
  tasks?: unknown;
  judgment_calls?: unknown;
}

interface TaskRecord {
  id?: unknown;
  title?: unknown;
  status?: unknown;
  deps?: unknown;
  parent?: unknown;
  blocked_on?: unknown;
  executor?: unknown;
  handle?: unknown;
  artifact?: unknown;
  estimate?: unknown;
  started_at?: unknown;
  dispatched_at?: unknown;
  finished_at?: unknown;
  verified?: unknown;
  decision_package?: unknown;
}

interface ResolvedInput {
  home: string;
  boardPath: string;
  boardFile: string;
  boardStem: string;
  raw: string;
  board: BoardRecord;
  stat: fs.Stats;
}

interface ComputeOpts {
  maxAgeSeconds?: number;
  asOf?: string;
  now?: Date;
}

interface ArtifactMeta {
  path: string;
  created_at: string;
  expires_at: string;
  freshness: 'fresh' | 'stale' | 'rendered';
  input_hash: string;
  board_hash: string;
  board_mtime_ms: number;
  board_size: number;
  topology_hash: string;
  advisory_hash: string;
  producer: { ccm_version: string };
}

interface ReportEnvelope {
  schema: typeof REPORT_SCHEMA;
  ok: true;
  report: Record<string, unknown>;
  artifact: ArtifactMeta;
}

function kinded(message: string, kind: string): KindedError {
  const e = new Error(message) as KindedError;
  e.errKind = kind;
  e.kind = kind;
  return e;
}

function sha(value: string | Buffer): string {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
    .join(',')}}`;
}

function isoNoMs(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function parseSeconds(raw: unknown, fallback: number): number {
  if (raw == null || raw === '') return fallback;
  const s = String(raw).trim();
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/i.exec(s);
  if (!m) {
    throw kinded(
      `无法解析 max-age ${JSON.stringify(raw)}——格式须为 <数字><单位>，单位 ∈ {s,m,h,d}`,
      'Usage',
    );
  }
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) throw kinded('max-age 必须为正数', 'Usage');
  const unit = (m[2] || 's').toLowerCase();
  const factor = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return Math.max(1, Math.round(value * factor));
}

function sleepMs(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function statusOf(t: TaskRecord): string {
  return typeof t.status === 'string' ? t.status : '';
}

function blockedOn(t: TaskRecord): string {
  return typeof t.blocked_on === 'string' ? t.blocked_on : '';
}

function taskId(t: TaskRecord): string {
  return typeof t.id === 'string' ? t.id : '';
}

function taskView(t: TaskRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: taskId(t),
    title: typeof t.title === 'string' ? t.title : '',
    status: statusOf(t),
  };
  for (const k of [
    'deps',
    'parent',
    'blocked_on',
    'executor',
    'handle',
    'artifact',
    'estimate',
    'started_at',
    'dispatched_at',
    'finished_at',
    'verified',
    'decision_package',
  ]) {
    const v = (t as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function tasksOf(board: BoardRecord): TaskRecord[] {
  return Array.isArray(board.tasks) ? (board.tasks as TaskRecord[]) : [];
}

function reportPath(home: string, boardStem: string): string {
  return path.join(home, 'reports', 'status-report', 'boards', `${boardStem}.status-report.json`);
}

function artifactLockTarget(home: string): string {
  return path.join(home, 'reports', 'status-report', 'cache');
}

function splitBoardStem(file: string): string {
  return file.endsWith('.board.json') ? file.slice(0, -'.board.json'.length) : file;
}

function resolveInput(ctx: Ctx): ResolvedInput {
  const home = discover.resolveHome({
    homeFlag: ctx.values.home as string | undefined,
    env: ctx.env,
  });
  const resolved = discover.resolveBoard({
    boardFlag: ctx.values.board as string | undefined,
    sid: ctx.sid,
    homeFlag: home,
    goalSubstr: ctx.values.goal as string | undefined,
    env: { ...ctx.env, CC_MASTER_HOME: home },
  });
  return readResolvedInput(home, resolved.boardPath);
}

function readResolvedInput(home: string, boardPath: string): ResolvedInput {
  const abs = path.resolve(boardPath);
  const raw = fs.readFileSync(abs, 'utf8');
  const board = JSON.parse(raw) as BoardRecord;
  const stat = fs.statSync(abs);
  const boardFile = path.basename(abs);
  return {
    home,
    boardPath: abs,
    boardFile,
    boardStem: splitBoardStem(boardFile),
    raw,
    board,
    stat,
  };
}

function topologyHash(board: BoardRecord): string {
  const tasks = tasksOf(board).map((t) => ({
    id: t.id ?? null,
    status: t.status ?? null,
    deps: Array.isArray(t.deps) ? t.deps : [],
    parent: t.parent ?? null,
    blocked_on: t.blocked_on ?? null,
    estimate: t.estimate ?? null,
    started_at: t.started_at ?? null,
    dispatched_at: t.dispatched_at ?? null,
    finished_at: t.finished_at ?? null,
    verified: t.verified ?? null,
    artifact: t.artifact ?? null,
  }));
  return sha(stableJson({ scheduling: board.scheduling ?? null, tasks }));
}

function advisoryHash(): string {
  return sha(stableJson({ usage: null, estimate: null }));
}

function criticalPathView(cp: CriticalPathResult): Record<string, unknown> {
  return {
    task_ids: Array.isArray(cp.chain) ? cp.chain : [],
    makespan: typeof cp.makespan === 'number' ? { value: cp.makespan, unit: 'h' } : null,
    weight_source: cp.weight_source || 'unavailable',
  };
}

function computeReport(input: ResolvedInput, opts: ComputeOpts = {}): ReportEnvelope {
  const now = opts.now || (opts.asOf ? new Date(opts.asOf) : new Date());
  if (!Number.isFinite(now.getTime())) throw kinded(`invalid --as-of ${opts.asOf}`, 'Usage');
  const createdAt = isoNoMs(now);
  const maxAge = opts.maxAgeSeconds || DEFAULT_MAX_AGE_SECONDS;
  const expiresAt = isoNoMs(new Date(now.getTime() + maxAge * 1000));
  const boardHash = sha(input.raw);
  const topoHash = topologyHash(input.board);
  const advHash = advisoryHash();
  const inputHash = sha(
    stableJson({
      schema: REPORT_SCHEMA,
      board_hash: boardHash,
      topology_hash: topoHash,
      advisory_hash: advHash,
      max_age_seconds: maxAge,
      ccm_version_major_contract: 1,
    }),
  );

  const tasks = tasksOf(input.board);
  const byId = new Map(tasks.map((t) => [taskId(t), t]));
  const graph = analyzeGraph(input.board as Parameters<typeof analyzeGraph>[0]);
  const readyIds = graph.readySet();
  const readySet = new Set(readyIds);
  const lint = lintBoard(input.raw);
  const cp = graph.criticalPath({ now: now.getTime() });

  const groups = {
    blocked_on_user: tasks.filter((t) => statusOf(t) === 'blocked' && blockedOn(t) === 'user'),
    in_flight: tasks.filter((t) => statusOf(t) === 'in_flight'),
    blocked_on_task: tasks.filter((t) => statusOf(t) === 'blocked' && blockedOn(t) !== 'user'),
    ready: readyIds.map((id) => byId.get(id)).filter(Boolean) as TaskRecord[],
    done: tasks.filter((t) => statusOf(t) === 'done'),
    attention: tasks.filter((t) =>
      ['failed', 'stale', 'escalated', 'uncertain'].includes(statusOf(t)),
    ),
  };

  const summary = {
    total: tasks.length,
    done: groups.done.length,
    verified_done: tasks.filter((t) => taskTrulyDone(t as never)).length,
    in_flight: groups.in_flight.length,
    ready: readySet.size,
    blocked_on_user: groups.blocked_on_user.length,
    blocked_on_task: groups.blocked_on_task.length,
    attention: groups.attention.length,
  };

  const wipLimit =
    input.board.scheduling &&
    typeof input.board.scheduling === 'object' &&
    typeof (input.board.scheduling as { wip_limit?: unknown }).wip_limit === 'number'
      ? ((input.board.scheduling as { wip_limit: number }).wip_limit as number)
      : null;
  const overSchedulingState =
    wipLimit == null ? 'unknown' : groups.in_flight.length > wipLimit ? 'over' : 'ok';

  const awaitingUser = groups.blocked_on_user.map(taskView);
  const hardLint = lint.errors.length > 0;
  const risks: Array<Record<string, unknown>> = [];
  if (hardLint) risks.push({ kind: 'lint', severity: 'high', count: lint.errors.length });
  if (overSchedulingState === 'over')
    risks.push({
      kind: 'over_scheduling',
      severity: 'medium',
      in_flight: groups.in_flight.length,
      wip_limit: wipLimit,
    });
  if (groups.attention.length > 0)
    risks.push({ kind: 'attention_tasks', severity: 'medium', count: groups.attention.length });

  const report = {
    board: {
      path: input.boardPath,
      file: input.boardFile,
      goal: typeof input.board.goal === 'string' ? input.board.goal : '',
      owner: input.board.owner && typeof input.board.owner === 'object' ? input.board.owner : {},
      git: input.board.git && typeof input.board.git === 'object' ? input.board.git : {},
    },
    summary,
    groups: Object.fromEntries(
      Object.entries(groups).map(([k, v]) => [k, v.map((t) => taskView(t))]),
    ),
    critical_path: criticalPathView(cp),
    decisions: {
      awaiting_user: awaitingUser,
      judgment_calls_pending_review: [],
    },
    risks,
    next_actions: {
      ready_to_dispatch: groups.ready.map(taskView),
      awaiting_user: awaitingUser,
      recommended_operator_actions: [
        ...(awaitingUser.length ? ['answer_user_decisions'] : []),
        ...(groups.ready.length ? ['dispatch_ready_tasks'] : []),
        ...(hardLint ? ['run_ccm_board_lint'] : []),
      ],
    },
    health: {
      lint: { ok: !hardLint, violations: [...lint.errors, ...lint.warnings] },
      over_scheduling: {
        in_flight: groups.in_flight.length,
        wip_limit: wipLimit,
        state: overSchedulingState,
      },
      usage: { available: false, verdict: null, source: 'not-collected-v1' },
    },
  };

  return {
    schema: REPORT_SCHEMA,
    ok: true,
    report,
    artifact: {
      path: reportPath(input.home, input.boardStem),
      created_at: createdAt,
      expires_at: expiresAt,
      freshness: 'fresh',
      input_hash: inputHash,
      board_hash: boardHash,
      board_mtime_ms: input.stat.mtimeMs,
      board_size: input.stat.size,
      topology_hash: topoHash,
      advisory_hash: advHash,
      producer: { ccm_version: readVersion() },
    },
  };
}

function readArtifact(filePath: string): ReportEnvelope | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ReportEnvelope;
    if (!parsed || parsed.schema !== REPORT_SCHEMA || parsed.ok !== true) return null;
    if (!parsed.artifact || parsed.artifact.path !== filePath) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isFresh(existing: ReportEnvelope | null, computed: ReportEnvelope, now: Date): boolean {
  if (!existing) return false;
  return (
    existing.artifact.board_hash === computed.artifact.board_hash &&
    existing.artifact.input_hash === computed.artifact.input_hash &&
    Date.parse(existing.artifact.expires_at) >= now.getTime()
  );
}

function writeArtifact(
  input: ResolvedInput,
  opts: ComputeOpts & { force?: boolean } = {},
): ReportEnvelope {
  const maxAge = opts.maxAgeSeconds || DEFAULT_MAX_AGE_SECONDS;
  const now = opts.now || (opts.asOf ? new Date(opts.asOf) : new Date());
  const computed = computeReport(input, { ...opts, now, maxAgeSeconds: maxAge });
  fs.mkdirSync(path.dirname(computed.artifact.path), { recursive: true, mode: 0o700 });
  return withLock(artifactLockTarget(input.home), () => {
    const existing = readArtifact(computed.artifact.path);
    if (!opts.force && isFresh(existing, computed, now)) return existing as ReportEnvelope;
    io.writeFileAtomicSync(computed.artifact.path, `${JSON.stringify(computed, null, 2)}\n`);
    return computed;
  });
}

export function writeReportForBoard(args: {
  home: string;
  boardPath: string;
  maxAgeSeconds?: number;
  refresh?: boolean;
  asOf?: string;
}): ReportEnvelope {
  const input = readResolvedInput(args.home, args.boardPath);
  return writeArtifact(input, {
    maxAgeSeconds: args.maxAgeSeconds,
    force: args.refresh,
    asOf: args.asOf,
  });
}

function renderHuman(env: ReportEnvelope): string {
  const report = env.report as Record<string, any>;
  const board = report.board || {};
  const s = report.summary || {};
  const cp = report.critical_path || {};
  const actions = report.next_actions || {};
  const lines: string[] = [];
  lines.push(`status report: ${board.goal || board.file || '(no goal)'}`);
  lines.push(
    `progress: done=${s.verified_done}/${s.total} in_flight=${s.in_flight} ready=${s.ready} blocked_user=${s.blocked_on_user} blocked_task=${s.blocked_on_task} attention=${s.attention}`,
  );
  const cpIds = Array.isArray(cp.task_ids) ? cp.task_ids : [];
  const ms = cp.makespan && typeof cp.makespan.value === 'number' ? `${cp.makespan.value}h` : 'n/a';
  lines.push(
    `critical_path: ${cpIds.length ? cpIds.join(' -> ') : '(none)'} (${ms}, ${cp.weight_source || 'n/a'})`,
  );
  const ready = Array.isArray(actions.ready_to_dispatch) ? actions.ready_to_dispatch : [];
  const awaiting = Array.isArray(actions.awaiting_user) ? actions.awaiting_user : [];
  if (awaiting.length) lines.push(`awaiting_user: ${awaiting.map((t: any) => t.id).join(', ')}`);
  if (ready.length) lines.push(`ready_to_dispatch: ${ready.map((t: any) => t.id).join(', ')}`);
  lines.push(
    `artifact: ${env.artifact.path} freshness=${env.artifact.freshness} expires_at=${env.artifact.expires_at}`,
  );
  return lines.join('\n');
}

function maxAgeFromCtx(ctx: Ctx): number {
  return parseSeconds(ctx.values['max-age'], DEFAULT_MAX_AGE_SECONDS);
}

function asOfFromCtx(ctx: Ctx): string | undefined {
  return typeof ctx.values['as-of'] === 'string' ? (ctx.values['as-of'] as string) : undefined;
}

export function render(ctx: Ctx): number {
  const input = resolveInput(ctx);
  const env = computeReport(input, { maxAgeSeconds: maxAgeFromCtx(ctx), asOf: asOfFromCtx(ctx) });
  env.artifact.freshness = 'rendered';
  ctx.out(ctx.flags.json ? JSON.stringify(env) : renderHuman(env));
  return EXIT.OK;
}

export function write(ctx: Ctx): number {
  const input = resolveInput(ctx);
  const env = writeArtifact(input, {
    maxAgeSeconds: maxAgeFromCtx(ctx),
    asOf: asOfFromCtx(ctx),
    force: ctx.flags.force,
  });
  ctx.out(ctx.flags.json ? JSON.stringify(env) : `wrote ${env.artifact.path}`);
  return EXIT.OK;
}

export function show(ctx: Ctx): number {
  const input = resolveInput(ctx);
  const env = writeArtifact(input, {
    maxAgeSeconds: maxAgeFromCtx(ctx),
    asOf: asOfFromCtx(ctx),
    force: ctx.values.refresh === true,
  });
  ctx.out(ctx.flags.json ? JSON.stringify(env) : renderHuman(env));
  return EXIT.OK;
}

export function watch(ctx: Ctx): number {
  const intervalSeconds = parseSeconds(ctx.values.interval, DEFAULT_MAX_AGE_SECONDS);
  const iterationsRaw = ctx.values.iterations;
  let iterations = Infinity;
  if (iterationsRaw != null && iterationsRaw !== '') {
    const parsed = Math.floor(Number(iterationsRaw));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw kinded('--iterations must be a positive integer', 'Usage');
    }
    iterations = parsed;
  }
  if (!Number.isFinite(iterations) && ctx.values['no-input'] === true) {
    throw kinded('status-report watch --no-input requires --iterations <n>', 'Usage');
  }
  let count = 0;
  while (count < iterations) {
    const input = resolveInput(ctx);
    const env = writeArtifact(input, {
      maxAgeSeconds: maxAgeFromCtx(ctx),
      asOf: asOfFromCtx(ctx),
      force: ctx.flags.force,
    });
    count += 1;
    if (ctx.flags.json)
      ctx.out(JSON.stringify({ ok: true, iteration: count, artifact: env.artifact }));
    else ctx.out(`status-report watch: wrote ${env.artifact.path} (${count})`);
    if (count < iterations) sleepMs(intervalSeconds * 1000);
  }
  return EXIT.OK;
}
