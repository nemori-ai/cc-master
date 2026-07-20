// kimi-usage.ts — kimi-code managed /usages → UsageSignal (five_hour + seven_day rolling windows).
//
// kimi-code serves a rolling 5h + weekly quota from `GET {base}/usages` (Authorization: Bearer
// <OAuth access_token>, Accept: application/json). Auth: CCM_KIMI_ACCESS_TOKEN, or the stored
// access_token in $KIMI_CODE_HOME/credentials/kimi-code.json. HTTP is sync-bridged with Worker +
// Atomics (same pattern as cursor-usage.ts / codex-rate-limits.ts). Fail-open: any error → null.
// Zero npm deps.
//
// Read-only credential discipline (design_docs/2026-07-16-kimi-quota-signal-research.md §6.2): this
// collector NEVER refreshes or rotates the stored token. kimi's access_token is short-lived and is
// only refreshed by kimi itself during an active session; when the stored token is expired we skip
// the doomed HTTP and degrade to `unknown` (honest, non-mutating) rather than refreshing it.
//
// Response schema + field aliases per the same research doc §1.3 (kimi-code MIT source
// packages/oauth/src/managed-usage.ts `parseManagedUsagePayload`, deliberately lenient).

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads';
import type { UsageSignal, WindowSignal } from '@ccm/engine';

const DEFAULT_TIMEOUT_MS = 8_000; // kimi managed-usage.ts default AbortController timeout.
const DEFAULT_API_BASE = 'https://api.kimi.com/coding/v1';
const USAGE_PATH = '/usages';
const FIVE_HOUR_MINUTES = 300; // kimi's 5h rolling window = 300 MINUTE (research §1.3 fixture).

export type KimiUsageSource = 'kimi-usages-api';

export interface KimiUsageSignal {
  signal: UsageSignal;
  source: KimiUsageSource;
  auth_source: 'kimi-code-current-login';
}

/** Token discovery result — lets the adapter emit an honest `unavailable` reason without a secret. */
export type KimiTokenState =
  | { kind: 'ok'; token: string }
  | { kind: 'expired'; expiresAt: number }
  | { kind: 'absent' };

export function normalizeKimiUsagePayload(
  raw: unknown,
  opts?: { capturedAtSec?: number; nowSec?: number },
): KimiUsageSignal | null {
  if (!isRecord(raw)) return null;
  const nowSec =
    typeof opts?.nowSec === 'number' && Number.isFinite(opts.nowSec)
      ? Math.floor(opts.nowSec)
      : Math.floor(Date.now() / 1000);

  const sevenDay = parseWeeklySummary(isRecord(raw.usage) ? raw.usage : null, nowSec);
  const fiveHour = parseFiveHourWindow(Array.isArray(raw.limits) ? raw.limits : [], nowSec);

  // At least one usable window; otherwise the read carries no quota signal.
  if (!sevenDay && !fiveHour) return null;

  const capturedAt =
    typeof opts?.capturedAtSec === 'number' && Number.isFinite(opts.capturedAtSec)
      ? Math.floor(opts.capturedAtSec)
      : nowSec;

  return {
    source: 'kimi-usages-api',
    auth_source: 'kimi-code-current-login',
    signal: {
      five_hour: fiveHour,
      seven_day: sevenDay,
      billing_period: null,
      captured_at: capturedAt,
    },
  };
}

export function readKimiUsageSignal(
  env: Record<string, string | undefined>,
  opts?: { nowSec?: number },
): KimiUsageSignal | null {
  const tokenState = resolveKimiToken(env, opts?.nowSec);
  if (tokenState.kind !== 'ok') return null; // expired / absent → skip doomed HTTP, degrade cleanly.

  const timeoutMs = parseTimeout(env.CCM_KIMI_USAGE_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS;
  const apiBase = (env.CCM_KIMI_API_BASE || env.KIMI_CODE_BASE_URL || DEFAULT_API_BASE).replace(
    /\/+$/,
    '',
  );
  const sab = new SharedArrayBuffer(4);
  const flag = new Int32Array(sab);
  const { port1, port2 } = new MessageChannel();
  let worker: Worker | null = null;
  try {
    worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        url: `${apiBase}${USAGE_PATH}`,
        token: tokenState.token,
        timeoutMs,
        sab,
        port: port2,
      },
      transferList: [port2],
    });
    Atomics.wait(flag, 0, 0, timeoutMs + 1000);
    const msg = receiveMessageOnPort(port1)?.message as
      | { ok?: boolean; result?: unknown }
      | undefined;
    if (!msg?.ok) return null;
    return normalizeKimiUsagePayload(msg.result, { nowSec: opts?.nowSec });
  } catch {
    return null;
  } finally {
    try {
      worker?.terminate();
    } catch {
      /* ignore */
    }
    port1.close();
  }
}

/** Honest, secret-free reason for why the kimi usage signal is unavailable (adapter-facing). */
export function describeKimiUsageUnavailable(
  env: Record<string, string | undefined>,
  nowSec?: number,
): string {
  const state = resolveKimiToken(env, nowSec);
  switch (state.kind) {
    case 'expired':
      return 'kimi-code access_token 已过期——仅在活跃 kimi session 期间新鲜（collector 只读不刷新凭证）';
    case 'absent':
      return '无 kimi-code 凭证（$KIMI_CODE_HOME/credentials/kimi-code.json 缺失或无 access_token）';
    default:
      return 'kimi-code /usages 读取失败（网络 / 401 / API 变更）';
  }
}

const WORKER_SOURCE = `
const { workerData } = require('node:worker_threads');

const flag = new Int32Array(workerData.sab);
const port = workerData.port;
let done = false;

function finish(payload) {
  if (done) return;
  done = true;
  try { port.postMessage(payload); } catch {}
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
}

const timer = setTimeout(() => finish({ ok: false }), workerData.timeoutMs);

(async () => {
  try {
    const res = await fetch(workerData.url, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + workerData.token,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(workerData.timeoutMs),
    });
    clearTimeout(timer);
    if (!res.ok) {
      finish({ ok: false });
      return;
    }
    const result = await res.json();
    finish({ ok: true, result });
  } catch {
    clearTimeout(timer);
    finish({ ok: false });
  }
})();
`;

// ── weekly ("Weekly limit") summary → seven_day WindowSignal. ──────────────────────────────────────
function parseWeeklySummary(
  summary: Record<string, unknown> | null,
  nowSec: number,
): WindowSignal | null {
  if (!summary) return null;
  const usedPct = usedPercentOf(summary);
  if (usedPct === null) return null;
  return {
    used_percentage: usedPct,
    resets_at: resolveResetEpoch(summary, nowSec),
  };
}

// ── limits[] → the 5h rolling window → five_hour WindowSignal. ──────────────────────────────────────
function parseFiveHourWindow(limits: unknown[], nowSec: number): WindowSignal | null {
  for (const item of limits) {
    if (!isRecord(item)) continue;
    const window = isRecord(item.window) ? item.window : null;
    if (windowMinutes(window) !== FIVE_HOUR_MINUTES) continue;
    // `detail` holds used/limit; some payloads flatten those onto the item itself (research §1.3).
    const detail = isRecord(item.detail) ? item.detail : item;
    const usedPct = usedPercentOf(detail);
    if (usedPct === null) continue;
    return {
      used_percentage: usedPct,
      resets_at: resolveResetEpoch(detail, nowSec) ?? resolveResetEpoch(item, nowSec),
    };
  }
  return null;
}

// used_percentage from {used,limit} or {remaining,limit}; clamped to 0-100.
function usedPercentOf(source: Record<string, unknown>): number | null {
  const limit = finiteNumber(source.limit);
  if (limit === null || limit <= 0) return null;
  let used = finiteNumber(source.used);
  if (used === null) {
    const remaining = finiteNumber(source.remaining);
    if (remaining === null) return null;
    used = limit - remaining;
  }
  const pct = (used / limit) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.min(100, Math.max(0, pct));
}

// Reset epoch seconds from ISO reset timestamp aliases, or now + relative seconds aliases.
function resolveResetEpoch(source: Record<string, unknown>, nowSec: number): number | null {
  const isoRaw = firstString(source, ['resetAt', 'reset_at', 'reset_time', 'resetTime']) ?? null;
  if (isoRaw) {
    const ms = Date.parse(isoRaw);
    if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  }
  const relSec = firstNumber(source, ['reset_in', 'resetIn', 'ttl']);
  if (relSec !== null) return nowSec + Math.floor(relSec);
  return null;
}

function windowMinutes(window: Record<string, unknown> | null): number | null {
  if (!window) return null;
  const duration = finiteNumber(window.duration);
  if (duration === null) return null;
  // Live /usages returns protobuf-enum timeUnit ("TIME_UNIT_MINUTE"); the research fixture used the
  // bare form ("MINUTE"). Normalize by stripping the enum prefix so both spellings match.
  const unit = String(window.timeUnit ?? '')
    .toUpperCase()
    .replace(/^TIME_UNIT_/, '');
  if (unit === 'MINUTE') return duration;
  if (unit === 'HOUR') return duration * 60;
  if (unit === 'DAY') return duration * 60 * 24;
  return null;
}

// ── credential discovery (read-only; expiry pre-check skips a doomed HTTP round trip). ──────────────
function resolveKimiToken(
  env: Record<string, string | undefined>,
  nowSec?: number,
): KimiTokenState {
  const now = typeof nowSec === 'number' && Number.isFinite(nowSec) ? nowSec : Date.now() / 1000;
  const fromEnv = env.CCM_KIMI_ACCESS_TOKEN?.trim();
  if (fromEnv) return { kind: 'ok', token: fromEnv };

  const credPath = resolveKimiCredentialsPath(env);
  if (!credPath) return { kind: 'absent' };
  const parsed = readKimiCredentials(credPath);
  if (!parsed?.token) return { kind: 'absent' };
  if (typeof parsed.expiresAt === 'number' && parsed.expiresAt <= now) {
    return { kind: 'expired', expiresAt: parsed.expiresAt };
  }
  return { kind: 'ok', token: parsed.token };
}

function resolveKimiCredentialsPath(env: Record<string, string | undefined>): string | null {
  if (env.CCM_KIMI_CREDENTIALS_FILE) {
    const explicit = path.resolve(env.CCM_KIMI_CREDENTIALS_FILE);
    return fs.existsSync(explicit) ? explicit : null;
  }
  const candidate = path.join(kimiHome(env), 'credentials', 'kimi-code.json');
  return fs.existsSync(candidate) ? candidate : null;
}

function kimiHome(env: Record<string, string | undefined>): string {
  if (env.KIMI_CODE_HOME) return path.resolve(env.KIMI_CODE_HOME);
  return path.join(env.HOME || env.USERPROFILE || os.homedir(), '.kimi-code');
}

function readKimiCredentials(
  credPath: string,
): { token: string | null; expiresAt: number | null } | null {
  try {
    const stat = fs.statSync(credPath);
    if (!stat.isFile() || stat.size > 1024 * 1024) return null;
    const value: unknown = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    if (!isRecord(value)) return null;
    const token =
      typeof value.access_token === 'string' && value.access_token.trim()
        ? value.access_token.trim()
        : null;
    const expiresAt = finiteNumber(value.expires_at);
    return { token, expiresAt };
  } catch {
    return null;
  }
}

function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = source[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function firstNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const v = finiteNumber(source[key]);
    if (v !== null) return v;
  }
  return null;
}

function finiteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseTimeout(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}
