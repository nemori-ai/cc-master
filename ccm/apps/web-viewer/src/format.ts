import type { CompactTask, StatusTone } from './types';

// ---- 8-status lamp palette (one CSS token per board status enum value) -----------------
// The bucket mapping (statusTone) is kept for grouping; lamps use the full-resolution
// per-status token so no colour information collapses (spec §4).

export const STATUS_ORDER = [
  'ready',
  'in_flight',
  'blocked',
  'done',
  'verified',
  'uncertain',
  'escalated',
  'failed',
  'stale'
] as const;

const STATUS_VAR: Record<string, string> = {
  ready: '--ready',
  in_flight: '--inflight',
  'in-flight': '--inflight',
  blocked: '--blocked',
  done: '--done',
  verified: '--done',
  uncertain: '--uncertain',
  escalated: '--escalated',
  failed: '--failed',
  stale: '--stale'
};

const STATUS_TEXT: Record<string, string> = {
  ready: 'ready',
  in_flight: 'in flight',
  'in-flight': 'in flight',
  blocked: 'blocked',
  done: 'done',
  verified: 'verified',
  uncertain: 'uncertain',
  escalated: 'escalated',
  failed: 'failed',
  stale: 'stale',
  'awaiting-user': 'awaiting user'
};

export function normalizeStatus(status: string | undefined): string {
  return (status ?? '').trim().toLowerCase().replaceAll('-', '_');
}

/** CSS var reference for a status lamp — resolves through the active theme's token set. */
export function statusLampVar(status: string | undefined): string {
  return `var(${STATUS_VAR[normalizeStatus(status)] ?? '--blocked'})`;
}

export function statusText(status: string | undefined): string {
  const normalized = normalizeStatus(status);
  return STATUS_TEXT[normalized] ?? (status || 'unknown');
}

// Minimap SVG rects don't resolve oklch()/CSS-var fills — concrete hex per status, keyed on
// the active theme (`--mm-*` discipline from the legacy viewer).
const MINIMAP_HEX: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    ready: '#4aa3ff',
    in_flight: '#f5a524',
    blocked: '#7b8494',
    done: '#2fbf8f',
    verified: '#2fbf8f',
    uncertain: '#e86fa6',
    escalated: '#a06bff',
    failed: '#e5484d',
    stale: '#c9a227'
  },
  light: {
    ready: '#2f6fd6',
    in_flight: '#b9740a',
    blocked: '#6b7585',
    done: '#1f8c63',
    verified: '#1f8c63',
    uncertain: '#c23a78',
    escalated: '#7a36c9',
    failed: '#c5303a',
    stale: '#9a7510'
  }
};

export function minimapColor(status: string | undefined, theme: 'dark' | 'light'): string {
  const map = MINIMAP_HEX[theme] ?? MINIMAP_HEX.dark;
  return map[normalizeStatus(status)] ?? map.blocked ?? '#7b8494';
}

// ---- bucket mapping (grouping semantics only — NOT the lamp palette) --------------------

export function statusTone(status: string | undefined): StatusTone {
  const normalized = status?.toLowerCase().replaceAll('_', '-');
  if (normalized === 'ready') return 'ready';
  if (normalized === 'in-flight' || normalized === 'running') return 'in-flight';
  if (normalized === 'awaiting-user' || normalized === 'user-blocked') return 'awaiting-user';
  if (normalized === 'blocked') return 'blocked';
  if (
    normalized === 'stale' ||
    normalized === 'error' ||
    normalized === 'stale-error' ||
    normalized === 'failed' ||
    normalized === 'uncertain' ||
    normalized === 'escalated'
  )
    return 'stale';
  if (normalized === 'done' || normalized === 'verified' || normalized === 'done-verified')
    return 'done';
  return 'neutral';
}

export function statusLabel(status: string | undefined): string {
  const tone = statusTone(status);
  switch (tone) {
    case 'ready':
      return 'Ready';
    case 'in-flight':
      return 'In Flight';
    case 'awaiting-user':
      return 'Awaiting User';
    case 'blocked':
      return 'Blocked';
    case 'stale':
      return 'Stale / Error';
    case 'done':
      return 'Done';
    case 'neutral':
      return status ?? 'Unknown';
  }
}

export function shortTime(value: string | undefined): string {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---- lenient time parsing + duration derivation (legacy-viewer semantics) ---------------
// A timestamp may be a full ISO, a date-prefixed log line, or a short clock string. Legacy
// boards (revived via --resume) may carry dispatched_at/completed_at — read-fallbacks below.

export function parseTs(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const iso = value.match(
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/
  );
  if (iso) {
    const ms = Date.parse(iso[0]);
    if (!Number.isNaN(ms)) return ms;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return ms;
  }
  const short = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (short) {
    const date = new Date();
    date.setHours(Number(short[1]), Number(short[2]), short[3] ? Number(short[3]) : 0, 0);
    return date.getTime();
  }
  return null;
}

export function startTs(task: CompactTask | null | undefined): number | null {
  if (!task) return null;
  return parseTs(task.started_at ?? task.dispatched_at);
}

export function endTs(task: CompactTask | null | undefined): number | null {
  if (!task) return null;
  return parseTs(task.finished_at ?? task.completed_at);
}

export function createTs(task: CompactTask | null | undefined): number | null {
  if (!task) return null;
  return parseTs(task.created_at);
}

export function startStr(task: CompactTask | null | undefined): string | null {
  if (!task) return null;
  const value = task.started_at ?? task.dispatched_at;
  return typeof value === 'string' ? value : null;
}

export function endStr(task: CompactTask | null | undefined): string | null {
  if (!task) return null;
  const value = task.finished_at ?? task.completed_at;
  return typeof value === 'string' ? value : null;
}

export const DONE_STATUSES = new Set(['done', 'verified']);

/** Compact duration formatter — returns null (never "null") when unknown/nonsensical. */
export function fmtElapsed(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs < 24) return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return hrs % 24 ? `${days}d ${hrs % 24}h` : `${days}d`;
}

interface TaskLogEntry {
  ts?: string;
  [key: string]: unknown;
}

function logSpan(task: CompactTask): { first: number; last: number } | null {
  const logs = Array.isArray(task.log) ? (task.log as Array<string | TaskLogEntry>) : [];
  const stamps: number[] = [];
  for (const line of logs) {
    let raw = '';
    if (typeof line === 'string') raw = line;
    else if (line && typeof line === 'object' && typeof line.ts === 'string') raw = line.ts;
    const ts = parseTs(raw);
    if (ts != null) stamps.push(ts);
  }
  if (!stamps.length) return null;
  return { first: Math.min(...stamps), last: Math.max(...stamps) };
}

export interface TaskDurationResult {
  ms: number;
  running: boolean;
}

export function taskDuration(task: CompactTask | null | undefined): TaskDurationResult | null {
  if (!task) return null;
  const status = normalizeStatus(typeof task.status === 'string' ? task.status : '');
  const disp = startTs(task);
  if (status === 'in_flight') {
    if (disp == null) return null;
    const ms = Date.now() - disp;
    return ms >= 0 ? { ms, running: true } : null;
  }
  if (DONE_STATUSES.has(status)) {
    const comp = endTs(task);
    if (comp != null && disp != null && comp >= disp) {
      return { ms: comp - disp, running: false };
    }
    const span = logSpan(task);
    if (span) {
      if (disp != null && span.last >= disp) return { ms: span.last - disp, running: false };
      if (span.last > span.first) return { ms: span.last - span.first, running: false };
    }
    if (comp != null && disp != null) {
      const ms = comp - disp;
      if (ms >= 0) return { ms, running: false };
    }
    return null;
  }
  if (disp != null) {
    const ms = Date.now() - disp;
    if (ms >= 0) return { ms, running: true };
  }
  return null;
}

export function fmtDuration(duration: TaskDurationResult | null): string | null {
  if (!duration) return null;
  const text = fmtElapsed(duration.ms);
  if (text == null) return null;
  return duration.running ? `running ${text}` : text;
}

export function localTime(iso: unknown): string | null {
  const ms = parseTs(typeof iso === 'string' ? iso : '');
  if (ms == null) return typeof iso === 'string' && iso.trim() ? iso.trim() : null;
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(iso);
  }
}

// ---- estimate rendering (presentation-level unit conversion) ----------------------------
// Mirrors the engine's durationHours unit table (h/m/d/w + long forms; d=24h, w=168h).
// This is display math only — scheduling semantics stay on the server.
const ESTIMATE_UNIT_HOURS: Record<string, number> = {
  h: 1,
  hour: 1,
  hours: 1,
  m: 1 / 60,
  min: 1 / 60,
  minute: 1 / 60,
  minutes: 1 / 60,
  d: 24,
  day: 24,
  days: 24,
  w: 168,
  week: 168,
  weeks: 168
};

/** {value, unit} or "3h ..." string -> hours (>0), else null (unknown unit degrades). */
export function estimateHours(estimate: unknown): number | null {
  if (typeof estimate === 'string') {
    const m = estimate.trim().match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\b/);
    if (!m) return null;
    const n = Number(m[1]);
    const mult = ESTIMATE_UNIT_HOURS[(m[2] ?? '').toLowerCase()];
    return Number.isFinite(n) && n > 0 && mult ? n * mult : null;
  }
  if (!estimate || typeof estimate !== 'object' || Array.isArray(estimate)) return null;
  const record = estimate as { value?: unknown; unit?: unknown };
  if (typeof record.value !== 'number' || !Number.isFinite(record.value) || record.value <= 0) {
    return null;
  }
  const unit = typeof record.unit === 'string' ? record.unit.trim().toLowerCase() : '';
  const mult = ESTIMATE_UNIT_HOURS[unit];
  return mult ? record.value * mult : null;
}

/** Raw estimate -> "2 d (≈48h)" / "90 m (≈1.5h)" / raw text when the unit is unknown. */
export function fmtEstimate(estimate: unknown): string | null {
  let raw: string | null = null;
  if (typeof estimate === 'string' && estimate.trim()) raw = estimate.trim();
  else if (estimate && typeof estimate === 'object' && !Array.isArray(estimate)) {
    const record = estimate as { value?: unknown; unit?: unknown };
    if (typeof record.value === 'number' && Number.isFinite(record.value)) {
      raw = typeof record.unit === 'string' && record.unit ? `${record.value} ${record.unit}` : String(record.value);
    } else {
      return null;
    }
  }
  if (raw == null) return null;
  const hours = estimateHours(estimate);
  if (hours == null) return raw;
  const rounded = Math.round(hours * 10) / 10;
  // Skip the echo when the estimate already reads as plain hours ("6 h" -> "6h").
  if (/^\s*\d+(?:\.\d+)?\s*h(?:ours?)?\s*$/i.test(raw)) return raw;
  return `${raw} (≈${rounded}h)`;
}

/** KV-row value renderer: absent/empty -> "Not recorded", objects -> JSON. */
export function recorded(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Not recorded';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

// ---- watchdog rendering ------------------------------------------------------------------
export interface WatchdogReadout {
  mechanism: string;
  text: string;
  expired: boolean;
}

/**
 * Watchdog {mechanism, fire_at} -> countdown readout. Future fire_at counts down; a past
 * fire_at flips to an expired/stale hint (the watchdog should have fired already).
 */
export function watchdogReadout(watchdog: unknown, nowMs = Date.now()): WatchdogReadout | null {
  if (!watchdog || typeof watchdog !== 'object' || Array.isArray(watchdog)) return null;
  const record = watchdog as { mechanism?: unknown; fire_at?: unknown };
  const mechanism = typeof record.mechanism === 'string' && record.mechanism ? record.mechanism : 'unknown';
  const fireMs = parseTs(typeof record.fire_at === 'string' ? record.fire_at : '');
  if (fireMs == null) {
    return { mechanism, text: `${mechanism} · no fire_at`, expired: false };
  }
  if (fireMs >= nowMs) {
    const inText = fmtElapsed(fireMs - nowMs) ?? '<1m';
    return { mechanism, text: `${mechanism} · fires in ${inText}`, expired: false };
  }
  const agoText = fmtElapsed(nowMs - fireMs) ?? '<1m';
  return { mechanism, text: `${mechanism} · fire_at passed ${agoText} ago`, expired: true };
}
