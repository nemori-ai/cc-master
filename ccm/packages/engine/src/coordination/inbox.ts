import { isEnumMember, isISOUTC } from '../board-model.js';

export type NotificationKind =
  | 'pacing_throttle'
  | 'pacing_yield'
  | 'pacing_claim'
  | 'pacing_switch'
  | 'pacing_stop'
  | 'hitl_turn'
  | 'artifact_serialize';

export type NotificationStatus = 'unconsumed' | 'consumed' | 'expired';
export type NotificationStrength = 'weak' | 'strong';

export interface Notification {
  id: string;
  kind: NotificationKind;
  status: NotificationStatus;
  created_at: string;
  expires_at: string;
  strength: NotificationStrength;
  summary: string;
  payload: Record<string, unknown>;
  consumed_at: string | null;
  consumed_note: string | null;
  superseded_by?: string;
}

export interface NewNotification {
  id?: string;
  kind: NotificationKind;
  summary: string;
  strength?: NotificationStrength;
  payload?: Record<string, unknown>;
  expires_at: string;
}

export interface InboxPolicy {
  terminalTtlMs?: number;
  capacity?: number;
}

const STATUS = new Set<NotificationStatus>(['unconsumed', 'consumed', 'expired']);
const STRENGTH = new Set<NotificationStrength>(['weak', 'strong']);
const DEFAULT_TERMINAL_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CAPACITY = 50;

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function cloneNotification(n: Notification): Notification {
  return structuredClone(n);
}

function parseMs(v: string): number {
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

function compactIso(iso: string): string {
  return iso.replace(/[-:]/g, '').replace('Z', 'Z');
}

function hashBase36(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 6).padStart(4, '0');
}

function makeId(now: string, seed: string): string {
  return `ntf-${compactIso(now)}-${hashBase36(seed)}`;
}

function asNotification(v: unknown): Notification | null {
  if (!isObject(v)) return null;
  if (typeof v.id !== 'string' || v.id === '') return null;
  if (!isEnumMember('notificationKind', v.kind)) return null;
  if (!STATUS.has(v.status as NotificationStatus)) return null;
  if (!isISOUTC(v.created_at) || !isISOUTC(v.expires_at)) return null;
  if (!STRENGTH.has(v.strength as NotificationStrength)) return null;
  if (typeof v.summary !== 'string' || v.summary === '') return null;
  if (!isObject(v.payload)) return null;
  if (v.status === 'consumed') {
    if (!isISOUTC(v.consumed_at)) return null;
  } else if (v.consumed_at !== null && v.consumed_at !== undefined) {
    return null;
  }
  if (
    v.consumed_note !== null &&
    v.consumed_note !== undefined &&
    typeof v.consumed_note !== 'string'
  ) {
    return null;
  }
  if (v.superseded_by !== undefined && typeof v.superseded_by !== 'string') return null;
  return {
    id: v.id,
    kind: v.kind as NotificationKind,
    status: v.status as NotificationStatus,
    created_at: v.created_at as string,
    expires_at: v.expires_at as string,
    strength: v.strength as NotificationStrength,
    summary: v.summary,
    payload: structuredClone(v.payload),
    consumed_at: v.status === 'consumed' ? (v.consumed_at as string) : null,
    consumed_note: typeof v.consumed_note === 'string' ? v.consumed_note : null,
    ...(typeof v.superseded_by === 'string' ? { superseded_by: v.superseded_by } : {}),
  };
}

function boardInboxArray(board: unknown): unknown[] | null {
  if (!isObject(board)) return null;
  const coordination = board.coordination;
  if (!isObject(coordination)) return null;
  return Array.isArray(coordination.inbox) ? coordination.inbox : null;
}

export class NotificationInbox {
  private constructor(private readonly items: readonly Notification[]) {}

  static empty(): NotificationInbox {
    return new NotificationInbox([]);
  }

  static fromBoard(board: unknown): NotificationInbox {
    const raw = boardInboxArray(board);
    if (!raw) return NotificationInbox.empty();
    const seen = new Set<string>();
    const items: Notification[] = [];
    for (const item of raw) {
      const n = asNotification(item);
      if (!n || seen.has(n.id)) continue;
      seen.add(n.id);
      items.push(n);
    }
    return new NotificationInbox(items);
  }

  toArray(): Notification[] {
    return this.items.map(cloneNotification);
  }

  append(n: NewNotification, now: string): NotificationInbox {
    if (!isISOUTC(now)) throw new Error(`now must be ISO-8601 UTC: ${JSON.stringify(now)}`);
    if (!isISOUTC(n.expires_at)) {
      throw new Error(`expires_at must be ISO-8601 UTC: ${JSON.stringify(n.expires_at)}`);
    }
    if (!isEnumMember('notificationKind', n.kind)) {
      throw new Error(`invalid notification kind: ${JSON.stringify(n.kind)}`);
    }
    if (typeof n.summary !== 'string' || n.summary === '')
      throw new Error('summary must be non-empty');
    const strength = n.strength ?? 'strong';
    if (!STRENGTH.has(strength)) throw new Error(`invalid strength: ${JSON.stringify(strength)}`);
    const payload = n.payload && isObject(n.payload) ? structuredClone(n.payload) : {};
    const used = new Set(this.items.map((item) => item.id));
    const seed = `${now}|${n.kind}|${n.summary}|${this.items.length}`;
    let id = n.id && n.id !== '' ? n.id : makeId(now, seed);
    let i = 2;
    while (used.has(id)) {
      id = `${makeId(now, seed)}-${i}`;
      i += 1;
    }
    return new NotificationInbox([
      ...this.toArray(),
      {
        id,
        kind: n.kind,
        status: 'unconsumed',
        created_at: now,
        expires_at: n.expires_at,
        strength,
        summary: n.summary,
        payload,
        consumed_at: null,
        consumed_note: null,
      },
    ]);
  }

  ack(id: string, now: string, note?: string): NotificationInbox {
    if (!isISOUTC(now)) throw new Error(`now must be ISO-8601 UTC: ${JSON.stringify(now)}`);
    const items = this.items.map((item) => {
      if (item.id !== id || item.status !== 'unconsumed') return cloneNotification(item);
      return {
        ...cloneNotification(item),
        status: 'consumed' as const,
        consumed_at: now,
        consumed_note: typeof note === 'string' && note !== '' ? note : null,
      };
    });
    return new NotificationInbox(items);
  }

  reconcile(now: string, opts: InboxPolicy = {}): NotificationInbox {
    if (!isISOUTC(now)) throw new Error(`now must be ISO-8601 UTC: ${JSON.stringify(now)}`);
    const nowMs = parseMs(now);
    const terminalTtlMs = opts.terminalTtlMs ?? DEFAULT_TERMINAL_TTL_MS;
    const capacity = opts.capacity ?? DEFAULT_CAPACITY;
    const items = this.toArray();

    for (const item of items) {
      if (item.status === 'unconsumed' && parseMs(item.expires_at) < nowMs) {
        item.status = 'expired';
        item.consumed_at = null;
        item.consumed_note = null;
      }
    }

    const newestByKind = new Map<NotificationKind, Notification>();
    for (const item of items) {
      if (item.status !== 'unconsumed') continue;
      const prev = newestByKind.get(item.kind);
      if (!prev || compareNewest(item, prev) >= 0) newestByKind.set(item.kind, item);
    }
    for (const item of items) {
      if (item.status !== 'unconsumed') continue;
      const newest = newestByKind.get(item.kind);
      if (newest && newest.id !== item.id) {
        item.status = 'expired';
        item.superseded_by = newest.id;
        item.consumed_at = null;
        item.consumed_note = null;
      }
    }

    let kept = items.filter((item) => !isTerminalExpired(item, nowMs, terminalTtlMs));
    if (Number.isFinite(capacity) && capacity >= 0 && kept.length > capacity) {
      const terminalsOldest = kept
        .filter((item) => item.status !== 'unconsumed')
        .sort((a, b) => parseMs(a.created_at) - parseMs(b.created_at) || a.id.localeCompare(b.id));
      const drop = new Set<string>();
      for (const item of terminalsOldest) {
        if (kept.length - drop.size <= capacity) break;
        drop.add(item.id);
      }
      kept = kept.filter((item) => !drop.has(item.id));
    }
    return new NotificationInbox(kept);
  }

  unconsumed(): Notification[] {
    return this.items.filter((item) => item.status === 'unconsumed').map(cloneNotification);
  }

  unconsumedCount(): number {
    return this.items.filter((item) => item.status === 'unconsumed').length;
  }

  has(id: string): boolean {
    return this.items.some((item) => item.id === id);
  }
}

function compareNewest(a: Notification, b: Notification): number {
  const delta = parseMs(a.created_at) - parseMs(b.created_at);
  if (delta !== 0) return delta;
  return 0;
}

function isTerminalExpired(item: Notification, nowMs: number, ttlMs: number): boolean {
  if (item.status === 'unconsumed') return false;
  const anchor = item.status === 'consumed' ? item.consumed_at : item.expires_at;
  if (!anchor) return false;
  return nowMs - parseMs(anchor) > ttlMs;
}

export function reconcileInbox<T>(board: T, now: string, policy?: InboxPolicy): T {
  if (!isObject(board)) return board;
  const coordination = board.coordination;
  if (!isObject(coordination) || !Array.isArray(coordination.inbox)) return board;
  const next = structuredClone(board) as Record<string, unknown>;
  const nextCoordination = next.coordination as Record<string, unknown>;
  const raw = coordination.inbox;
  const seen = new Set<string>();
  const invalid = raw.filter((item) => {
    const n = asNotification(item);
    if (!n) return true;
    if (seen.has(n.id)) return true;
    seen.add(n.id);
    return false;
  });
  const reconciled = NotificationInbox.fromBoard(board).reconcile(now, policy).toArray();
  nextCoordination.inbox = [...reconciled, ...structuredClone(invalid)];
  return next as T;
}
