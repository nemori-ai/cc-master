import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  allocatePool,
  buildPeerRoster,
  ENUMS,
  effectiveN,
  isISOUTC,
  loadHomeBoards,
  type NewNotification,
  type Notification,
  NotificationInbox,
  type NotificationKind,
  type NotificationStrength,
  POOL_ARBITER_POLICY,
  type PoolAllocation,
  type PoolAllocationRow,
  type PoolPressureBand,
  type QuotaModel,
  shouldAppendAllocationNotification,
  type UsageSignal,
} from '@ccm/engine';
import * as discover from '../discover.js';
import { resolveHarnessAdapter } from '../harnesses/registry.js';
import * as mutations from '../mutations.js';
import { type BoardArg, type Ctx, runRead, runWrite } from './_common.js';

interface KindedError extends Error {
  errKind?: string;
}

function usage(message: string): never {
  const e = new Error(message) as KindedError;
  e.errKind = 'Usage';
  throw e;
}

function stampNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function readRegistry(
  env: Record<string, string | undefined>,
  homeFlag?: string,
): Record<string, unknown> | null {
  const home = discover.resolveHome({ homeFlag, env });
  try {
    const obj = JSON.parse(fs.readFileSync(path.join(home, 'accounts.json'), 'utf8'));
    const accounts =
      obj && typeof obj === 'object' ? (obj as { accounts?: unknown }).accounts : null;
    if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) return null;
    return accounts as Record<string, unknown>;
  } catch {
    return null;
  }
}

function nowIso(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function addSeconds(iso: string, sec: number): string {
  return new Date(Date.parse(iso) + sec * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function boardOwner(board: BoardArg): Record<string, unknown> {
  return isObject(board.owner) ? board.owner : {};
}

function boardHarness(board: BoardArg): string | undefined {
  const h = boardOwner(board).harness;
  return typeof h === 'string' && h !== 'unknown' ? h : undefined;
}

function latestArbiterBand(items: Notification[]): PoolPressureBand | null {
  let latest: Notification | null = null;
  let latestMs = -Infinity;
  for (const item of items) {
    if (item.payload?.producer !== 'coordination-arbiter') continue;
    const ms = Date.parse(item.created_at);
    if (Number.isFinite(ms) && ms >= latestMs) {
      latest = item;
      latestMs = ms;
    }
  }
  const band = latest?.payload?.pressure_band;
  return band === 'healthy' || band === 'warn' || band === 'critical' || band === 'exhausted'
    ? band
    : null;
}

function rawInbox(board: BoardArg): unknown[] {
  const coordination = isObject(board.coordination) ? board.coordination : null;
  return coordination && Array.isArray(coordination.inbox) ? coordination.inbox : [];
}

function validIdSet(board: BoardArg): Set<string> {
  return new Set(
    NotificationInbox.fromBoard(board)
      .toArray()
      .map((item) => item.id),
  );
}

function invalidInboxEntries(board: BoardArg): unknown[] {
  const ids = validIdSet(board);
  const seen = new Set<string>();
  return rawInbox(board).filter((item) => {
    if (!isObject(item) || typeof item.id !== 'string') return true;
    if (!ids.has(item.id)) return true;
    if (seen.has(item.id)) return true;
    seen.add(item.id);
    return false;
  });
}

function setInbox(board: BoardArg, items: Notification[]): void {
  if (!isObject(board.coordination)) board.coordination = {};
  (board.coordination as Record<string, unknown>).inbox = [
    ...items,
    ...structuredClone(invalidInboxEntries(board)),
  ];
}

function parsePayload(raw: unknown): Record<string, unknown> {
  if (raw === undefined) return {};
  if (typeof raw !== 'string') usage('--payload 须是 JSON object 字符串');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    usage(`--payload 不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
  }
  if (!isObject(parsed)) usage('--payload 须解析为 JSON object');
  return parsed;
}

function asKind(v: unknown): NotificationKind {
  if (typeof v === 'string' && (ENUMS.notificationKind as readonly string[]).includes(v)) {
    return v as NotificationKind;
  }
  usage(`--kind 必须是：${ENUMS.notificationKind.join(', ')}`);
}

function asStrength(v: unknown): NotificationStrength {
  if (v === undefined) return 'strong';
  if (v === 'weak' || v === 'strong') return v;
  usage('--strength 必须是 weak 或 strong');
}

function renderList(items: Notification[], ctx: Ctx): string {
  if (ctx.flags.json)
    return JSON.stringify({ ok: true, data: { inbox: items, count: items.length } });
  const lines = [`coordination inbox（${items.length}）`];
  for (const n of items) {
    lines.push(`  ${n.id} [${n.status}] ${n.kind} ${n.strength}: ${n.summary}`);
  }
  if (items.length === 0) lines.push('  （空）');
  return `${lines.join('\n')}\n`;
}

export function inbox(ctx: Ctx): number {
  const action = ctx.positionals[0];
  if (action === 'list') return inboxList(ctx);
  if (action === 'ack') return inboxAck(ctx);
  usage('coordination inbox 需要子命令：list 或 ack');
}

function inboxList(ctx: Ctx): number {
  return runRead(ctx, {
    render: (board, c) => {
      let items = NotificationInbox.fromBoard(board).toArray();
      if (c.values.unconsumed) items = items.filter((item) => item.status === 'unconsumed');
      return renderList(items, c);
    },
  });
}

function inboxAck(ctx: Ctx): number {
  const ids = ctx.positionals.slice(1).filter(Boolean);
  if (ids.length === 0) usage('coordination inbox ack 需要至少一个通知 id');
  return runWrite(ctx, {
    mutate: (board) => {
      const b = structuredClone(board) as BoardArg;
      let inbox = NotificationInbox.fromBoard(b);
      for (const id of ids) {
        if (!inbox.has(id)) usage(`notification not found: ${id}`);
        inbox = inbox.ack(id, stampNow(), ctx.values.note as string | undefined);
      }
      setInbox(b, inbox.toArray());
      return mutations.touch(b);
    },
    render: (next, c) => {
      const items = NotificationInbox.fromBoard(next)
        .toArray()
        .filter((item) => ids.includes(item.id));
      if (c.flags.json) return JSON.stringify({ ok: true, data: { acked: items } });
      return `coordination inbox ack OK: ${ids.join(', ')}\n`;
    },
  });
}

export function notify(ctx: Ctx): number {
  return runWrite(ctx, {
    mutate: (board) => {
      const b = structuredClone(board) as BoardArg;
      const now = stampNow();
      const expires = ctx.values.expires;
      if (typeof expires !== 'string' || !isISOUTC(expires)) {
        usage('--expires 须是严格 ISO-8601 UTC');
      }
      if (typeof ctx.values.summary !== 'string' || ctx.values.summary === '') {
        usage('--summary 须是非空字符串');
      }
      const input: NewNotification = {
        kind: asKind(ctx.values.kind),
        summary: ctx.values.summary,
        strength: asStrength(ctx.values.strength),
        payload: parsePayload(ctx.values.payload),
        expires_at: expires,
      };
      const inbox = NotificationInbox.fromBoard(b).append(input, now);
      setInbox(b, inbox.toArray());
      return mutations.touch(b);
    },
    render: (next, c) => {
      const all = NotificationInbox.fromBoard(next).toArray();
      const item = all[all.length - 1] ?? null;
      if (c.flags.json) return JSON.stringify({ ok: true, data: { notification: item } });
      return item ? `coordination notify OK: ${item.id}\n` : 'coordination notify OK\n';
    },
  });
}

export function arbitrate(ctx: Ctx): number {
  let resolvedBoardPath = '';
  let result: ArbitrateResult | null = null;
  return runWrite(ctx, {
    resolve: (c) => {
      const resolved = discover.resolveBoard({
        boardFlag: c.values && (c.values.board as string),
        sid: c.sid,
        homeFlag: c.values && (c.values.home as string),
        goalSubstr: c.values && (c.values.goal as string),
        env: c.env,
      });
      resolvedBoardPath = resolved.boardPath;
      return resolved;
    },
    render: (_next, c) => {
      const data = result ?? {
        mode: 'pool-arbiter',
        appended: 0,
        append_reason: 'no-result',
        notification: null,
        own_row: null,
        allocation: null,
        unconsumed: [],
      };
      if (c.flags.json) return JSON.stringify({ ok: true, data });
      return renderArbitrate(data as ArbitrateResult);
    },
    mutate: (board, c) => {
      const out = arbitrateMutate(structuredClone(board) as BoardArg, c, resolvedBoardPath);
      result = out.result;
      return out.board;
    },
  });
}

interface ArbitrateResult {
  mode: string;
  appended: number;
  append_reason: string;
  notification: Notification | null;
  own_row: PoolAllocationRow | null;
  allocation: PoolAllocation | null;
  unconsumed: Notification[];
}

export interface ArbiterUsageOverride {
  signal: UsageSignal | null | undefined;
  quotaModel: QuotaModel | undefined;
  pollable: boolean;
}

export interface ArbitrateBoardOptions {
  usage?: ArbiterUsageOverride;
  accountsMap?: Record<string, unknown> | null;
}

export function arbitrateBoardForService(
  board: BoardArg,
  ctx: Ctx,
  boardPath: string,
  opts: ArbitrateBoardOptions = {},
): { board: BoardArg; result: ArbitrateResult } {
  return arbitrateMutate(board, ctx, boardPath, opts);
}

function arbitrateMutate(
  board: BoardArg,
  ctx: Ctx,
  boardPath: string,
  opts: ArbitrateBoardOptions = {},
): { board: BoardArg; result: ArbitrateResult } {
  const b = mutations.touch(board);
  const now = nowIso();
  const nowMs = Date.parse(now);
  const homeFlag = ctx.values.home as string | undefined;
  const selfFile = path.basename(boardPath);
  const selfSession = boardOwner(b).session_id;
  const harnessFlag = boardHarness(b) ?? (ctx.values.harness as string | undefined);
  const adapter = resolveHarnessAdapter({ env: ctx.env, harnessFlag });
  const usage = opts.usage ?? {
    signal: adapter.readCurrentUsage(ctx.env).signal,
    ...adapter.usageSource(ctx.env),
  };
  const accountsMap =
    opts.accountsMap === undefined ? readRegistry(ctx.env, homeFlag) : opts.accountsMap;

  let boards: Array<{ file: string; board: unknown }> = [];
  try {
    const home = discover.resolveHome({ homeFlag, env: ctx.env });
    boards = loadHomeBoards(discover.boardsDir(home), { maxDaysAgo: Number.POSITIVE_INFINITY });
  } catch {
    boards = [];
  }
  let replacedSelf = false;
  // Match self by basename, or by non-empty session_id only.
  // Empty session_id ("") is a valid unclaimed/degraded ARM marker and must NOT
  // collapse every empty-sid peer into the current board (would erase the pool).
  boards = boards.map((entry) => {
    const owner = isObject(entry.board) ? (entry.board as { owner?: unknown }).owner : null;
    const sid = isObject(owner) ? owner.session_id : undefined;
    const sameFile = entry.file === selfFile;
    const sameSid =
      typeof selfSession === 'string' &&
      selfSession !== '' &&
      typeof sid === 'string' &&
      sid === selfSession;
    if (sameFile || sameSid) {
      replacedSelf = true;
      return { file: selfFile, board: b };
    }
    return entry;
  });
  if (!replacedSelf) boards.push({ file: selfFile, board: b });

  const existing = NotificationInbox.fromBoard(b).reconcile(now).toArray();
  const roster = buildPeerRoster(boards, { nowMs });
  const ownPeer = roster.peers.find(
    (peer) =>
      peer.board_file === selfFile ||
      (typeof selfSession === 'string' && selfSession !== '' && peer.session_id === selfSession),
  );
  const ownPool = roster.pools.find((pool) =>
    ownPeer ? pool.peers.some((peer) => peer.board_file === ownPeer.board_file) : false,
  );
  const poolPeers = ownPool?.peers ?? (ownPeer ? [ownPeer] : []);
  const allocation = allocatePool(usage.signal, poolPeers, {
    nowSec: Math.floor(nowMs / 1000),
    quotaModel: usage.quotaModel,
    pollable: usage.pollable,
    effectiveN: accountsMap ? effectiveN(accountsMap as never, nowMs).effective_n : 1,
    registry: accountsMap ? ({ accounts: accountsMap } as never) : null,
    previousBand: latestArbiterBand(existing),
  });
  const ownRow =
    ownPeer && allocation.rows.find((row) => row.peer.board_file === ownPeer.board_file)
      ? (allocation.rows.find((row) => row.peer.board_file === ownPeer.board_file) ?? null)
      : (allocation.rows[0] ?? null);
  const decision = ownRow
    ? shouldAppendAllocationNotification(ownRow, allocation, existing, nowMs)
    : { append: false, reason: 'no-notification' as const, latest_id: null };

  let inbox = NotificationInbox.fromBoard({ coordination: { inbox: existing } });
  let notification: Notification | null = null;
  if (ownRow && ownRow.notification_kind && decision.append) {
    inbox = inbox.append(makeNotification(ownRow, allocation, now), now).reconcile(now);
    const nextItems = inbox.toArray();
    notification = nextItems[nextItems.length - 1] ?? null;
  }
  setInbox(b, inbox.toArray());
  const unconsumed = inbox.unconsumed();
  const result = {
    mode: allocation.mode,
    appended: notification ? 1 : 0,
    append_reason: decision.reason,
    notification,
    own_row: ownRow,
    allocation,
    unconsumed,
  } satisfies ArbitrateResult;
  return { board: b, result };
}

function makeNotification(
  row: PoolAllocationRow,
  allocation: PoolAllocation,
  now: string,
): NewNotification {
  return {
    kind: row.notification_kind as NotificationKind,
    summary: summaryForRow(row),
    strength: row.strength,
    expires_at: addSeconds(now, POOL_ARBITER_POLICY.notificationTtlSec),
    payload: {
      producer: 'coordination-arbiter',
      dedup_key: row.dedup_key,
      pressure_band: allocation.pressure.band,
      roster_signature: allocation.roster_signature,
      target_headroom_pct: row.target_headroom_pct,
      delta_headroom_pct: row.delta_headroom_pct,
      peer_count: allocation.peer_count,
      quota_model: allocation.pressure.quota_model,
      base_verdict: allocation.base_advice.verdict,
      reason: row.reason,
      own: row.peer,
    },
  };
}

function summaryForRow(row: PoolAllocationRow): string {
  if (row.kind === 'pacing_yield') return `池中介建议让路：${row.reason}`;
  if (row.kind === 'pacing_claim') return `池中介建议认领 slack：${row.reason}`;
  if (row.kind === 'pacing_switch') return `池中介建议切换配额：${row.reason}`;
  if (row.kind === 'pacing_stop') return `池中介建议暂停：${row.reason}`;
  return `池中介建议减速：${row.reason}`;
}

function renderArbitrate(data: ArbitrateResult): string {
  const row = data.own_row;
  const lines = [
    `coordination arbitrate: ${data.appended ? 'appended' : 'no-op'}（mode=${data.mode}·reason=${data.append_reason}）`,
  ];
  if (row) {
    lines.push(
      `  own: ${row.kind} target=${row.target_headroom_pct}% delta=${row.delta_headroom_pct}% strength=${row.strength}`,
    );
    lines.push(`  reason: ${row.reason}`);
  }
  if (data.notification) lines.push(`  notification: ${data.notification.id}`);
  lines.push(`  unconsumed=${data.unconsumed.length}`);
  return `${lines.join('\n')}\n`;
}
