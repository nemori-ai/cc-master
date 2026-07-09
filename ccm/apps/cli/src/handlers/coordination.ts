import {
  ENUMS,
  isISOUTC,
  type NewNotification,
  type Notification,
  NotificationInbox,
  type NotificationKind,
  type NotificationStrength,
} from '@ccm/engine';
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
  return runWrite(ctx, {
    mutate: (board) => mutations.touch(structuredClone(board) as BoardArg),
    render: (next, c) => {
      const unconsumed = NotificationInbox.fromBoard(next).unconsumed();
      const data = {
        mode: 'p2-stub',
        appended: 0,
        unconsumed,
        todo: 'P4 will replace this deterministic no-op with pool-aware allocation.',
      };
      if (c.flags.json) return JSON.stringify({ ok: true, data });
      return `coordination arbitrate: P2 stub no-op（unconsumed=${unconsumed.length}; P4 will add pool-aware allocation）\n`;
    },
  });
}
