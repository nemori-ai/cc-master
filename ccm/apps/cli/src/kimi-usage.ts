// kimi-usage.ts — kimi-code managed /usages → UsageSignal (five_hour + seven_day rolling windows).
//
// kimi-code serves a rolling 5h + weekly quota from `GET {base}/usages` (Authorization: Bearer
// <OAuth access_token>, Accept: application/json). Auth: CCM_KIMI_ACCESS_TOKEN, or the stored
// access_token in $KIMI_CODE_HOME/credentials/kimi-code.json. HTTP is sync-bridged with Worker +
// Atomics (same pattern as cursor-usage.ts / codex-rate-limits.ts). An expired stored credential is
// refreshed under a cross-process advisory lock, re-read inside the lock, and atomically replaced.
// Fail-open: any error → null, with no token material emitted. Zero npm deps.
//
// Response schema + field aliases per the same research doc §1.3 (kimi-code MIT source
// packages/oauth/src/managed-usage.ts `parseManagedUsagePayload`, deliberately lenient).

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads';
import type { UsageSignal, WindowSignal } from '@ccm/engine';
import type { UsageRefreshHint } from './harnesses/types.js';
import {
  type ShortLivedTokenState,
  shortLivedTokenRefreshHint,
} from './harnesses/usage-refresh-hint.js';

const DEFAULT_TIMEOUT_MS = 8_000; // kimi managed-usage.ts default AbortController timeout.
const DEFAULT_API_BASE = 'https://api.kimi.com/coding/v1';
const DEFAULT_OAUTH_HOST = 'https://auth.kimi.com';
const USAGE_PATH = '/usages';
const OAUTH_TOKEN_PATH = '/api/oauth/token';
const OAUTH_CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098';
const LOCK_RETRY_MIN_MS = 15;
const LOCK_RETRY_JITTER_MS = 10;
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

export interface KimiRefreshOptions {
  nowSec?: number;
  timeoutMs?: number;
  http?: KimiHttpTransport;
}

export interface KimiHttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

export type KimiHttpTransport = (request: KimiHttpRequest, timeoutMs: number) => unknown | null;

interface KimiCredentialSnapshot {
  value: Record<string, unknown>;
  token: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  mode: number;
}

interface CredentialLockHandle {
  path: string;
  owner: string;
}

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
  opts?: { nowSec?: number; http?: KimiHttpTransport },
): KimiUsageSignal | null {
  const fixtureRaw = env.CCM_KIMI_USAGE_FIXTURE_JSON;
  if (fixtureRaw) {
    try {
      return normalizeKimiUsagePayload(JSON.parse(fixtureRaw), { nowSec: opts?.nowSec });
    } catch {
      return null;
    }
  }
  const timeoutMs = parseTimeout(env.CCM_KIMI_USAGE_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS;
  let tokenState = resolveKimiToken(env, opts?.nowSec);
  if (tokenState.kind === 'expired' && kimiAutoRefreshEnabled(env.CCM_KIMI_AUTO_REFRESH)) {
    tokenState = refreshKimiToken(env, {
      nowSec: opts?.nowSec,
      timeoutMs,
      http: opts?.http,
    });
  }
  if (tokenState.kind !== 'ok') return null; // expired / absent → skip doomed HTTP, degrade cleanly.

  const apiBase = (env.CCM_KIMI_API_BASE || env.KIMI_CODE_BASE_URL || DEFAULT_API_BASE).replace(
    /\/+$/,
    '',
  );
  const result = (opts?.http ?? fetchJsonSync)(
    {
      url: `${apiBase}${USAGE_PATH}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenState.token}`,
        Accept: 'application/json',
      },
    },
    timeoutMs,
  );
  return result === null ? null : normalizeKimiUsagePayload(result, { nowSec: opts?.nowSec });
}

/**
 * Refresh an expired stored credential under an adjacent O_EXCL lock. The credential is always
 * re-read after lock acquisition, so a concurrent winner turns this call into a no-op. Every
 * failure returns an honest token state without modifying the credential or exposing token bytes.
 */
export function refreshKimiToken(
  env: Record<string, string | undefined>,
  opts: KimiRefreshOptions = {},
): KimiTokenState {
  const nowSec = normalizedNowSec(opts.nowSec);
  const credentialPath = resolveKimiCredentialsPath(env);
  if (!credentialPath) return { kind: 'absent' };
  const timeoutMs =
    opts.timeoutMs ?? parseTimeout(env.CCM_KIMI_USAGE_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS;
  let lock: CredentialLockHandle | null = null;
  try {
    lock = acquireCredentialLock(credentialPath, timeoutMs + 1000);
    if (!lock) return resolveKimiToken(env, nowSec);

    const snapshot = readKimiCredentials(credentialPath);
    const state = kimiCredentialState(snapshot, nowSec);
    if (state.kind !== 'expired' || !snapshot?.refreshToken) return state;

    const refreshed = requestKimiTokenRefresh(
      env,
      snapshot.refreshToken,
      timeoutMs,
      opts.http ?? fetchJsonSync,
    );
    if (!refreshed) return state;

    // A non-ccm Kimi process does not necessarily honor our advisory lock. Re-read once more before
    // publishing: never overwrite a credential that changed while the HTTP request was in flight.
    const latest = readKimiCredentials(credentialPath);
    const latestState = kimiCredentialState(latest, nowSec);
    if (!latest) return latestState;
    if (latest.token !== snapshot.token || latest.refreshToken !== snapshot.refreshToken) {
      return latestState;
    }

    const nextValue: Record<string, unknown> = {
      ...latest.value,
      access_token: refreshed.accessToken,
      refresh_token: refreshed.refreshToken,
      expires_in: refreshed.expiresIn,
      expires_at: nowSec + refreshed.expiresIn,
    };
    if (refreshed.scope !== null) nextValue.scope = refreshed.scope;
    if (refreshed.tokenType !== null) nextValue.token_type = refreshed.tokenType;
    atomicWriteKimiCredentials(credentialPath, nextValue, latest.mode);
    return { kind: 'ok', token: refreshed.accessToken };
  } catch {
    return resolveKimiToken(env, nowSec);
  } finally {
    releaseCredentialLock(lock);
  }
}

interface RefreshedKimiCredential {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string | null;
  tokenType: string | null;
}

function requestKimiTokenRefresh(
  env: Record<string, string | undefined>,
  refreshToken: string,
  timeoutMs: number,
  http: KimiHttpTransport,
): RefreshedKimiCredential | null {
  const oauthHost = (env.KIMI_CODE_OAUTH_HOST || env.KIMI_OAUTH_HOST || DEFAULT_OAUTH_HOST).replace(
    /\/+$/,
    '',
  );
  const body = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }).toString();
  const raw = http(
    {
      url: `${oauthHost}${OAUTH_TOKEN_PATH}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    },
    timeoutMs,
  );
  if (!isRecord(raw)) return null;
  const accessToken = nonEmptyString(raw.access_token);
  const rotatedRefreshToken = nonEmptyString(raw.refresh_token);
  const expiresInRaw = finiteNumber(raw.expires_in);
  const expiresIn = expiresInRaw === null ? 0 : Math.floor(expiresInRaw);
  if (!accessToken || !rotatedRefreshToken || expiresIn <= 0) return null;
  return {
    accessToken,
    refreshToken: rotatedRefreshToken,
    expiresIn,
    scope: optionalString(raw.scope),
    tokenType: optionalString(raw.token_type),
  };
}

// Recovery semantics come from the stored credential state, not the transient result of an automatic
// refresh attempt. A failed optimization must preserve kimi's existing self-refresh path; a successful
// refresh returns a signal before this hint is needed.
const KIMI_RECOVERY = {
  harnessLabel: 'kimi-code',
  recheckHarness: 'kimi-code',
  reasons: {
    expired: 'kimi-code access_token 已过期——自动刷新未成功，仍可由 kimi 自行刷新',
    absent: '无 kimi-code 凭证（$KIMI_CODE_HOME/credentials/kimi-code.json 缺失或无 access_token）',
    opaque: 'kimi-code /usages 读取失败（网络 / 401 / API 变更）',
  },
  refreshCommand: "kimi -p 'hi'",
  reauthCommand: 'kimi login',
} as const;

function kimiTokenStateToRecovery(kind: KimiTokenState['kind']): ShortLivedTokenState {
  if (kind === 'expired') return 'expired';
  if (kind === 'absent') return 'absent';
  return 'opaque'; // token was 'ok' but the read still failed → non-credential (network / 401 / API).
}

/**
 * Actionable, secret-free recovery hint derived from the stored credential's original state. Automatic
 * refresh is only an optimization: if it fails, an expired credential remains expired and retains its
 * existing harness-native recovery command.
 */
export function describeKimiUsageRefresh(
  env: Record<string, string | undefined>,
  nowSec?: number,
): UsageRefreshHint {
  const state = resolveKimiToken(env, nowSec);
  return shortLivedTokenRefreshHint(kimiTokenStateToRecovery(state.kind), KIMI_RECOVERY);
}

/** Honest, secret-free reason for why the kimi usage signal is unavailable (adapter-facing). */
export function describeKimiUsageUnavailable(
  env: Record<string, string | undefined>,
  nowSec?: number,
): string {
  return describeKimiUsageRefresh(env, nowSec).reason;
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
      method: workerData.request.method,
      headers: workerData.request.headers,
      body: workerData.request.body,
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

function fetchJsonSync(request: KimiHttpRequest, timeoutMs: number): unknown | null {
  const sab = new SharedArrayBuffer(4);
  const flag = new Int32Array(sab);
  const { port1, port2 } = new MessageChannel();
  let worker: Worker | null = null;
  try {
    worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { url: request.url, request, timeoutMs, sab, port: port2 },
      transferList: [port2],
    });
    Atomics.wait(flag, 0, 0, timeoutMs + 1000);
    const msg = receiveMessageOnPort(port1)?.message as
      | { ok?: boolean; result?: unknown }
      | undefined;
    return msg?.ok ? msg.result : null;
  } catch {
    return null;
  } finally {
    try {
      worker?.terminate();
    } catch {
      /* worker already stopped */
    }
    port1.close();
  }
}

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

// ── credential discovery + serialized refresh. ────────────────────────────────────────────────────
function resolveKimiToken(
  env: Record<string, string | undefined>,
  nowSec?: number,
): KimiTokenState {
  const now = normalizedNowSec(nowSec);
  const fromEnv = env.CCM_KIMI_ACCESS_TOKEN?.trim();
  if (fromEnv) return { kind: 'ok', token: fromEnv };

  const credPath = resolveKimiCredentialsPath(env);
  if (!credPath) return { kind: 'absent' };
  return kimiCredentialState(readKimiCredentials(credPath), now);
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

function readKimiCredentials(credPath: string): KimiCredentialSnapshot | null {
  try {
    const stat = fs.statSync(credPath);
    if (!stat.isFile() || stat.size > 1024 * 1024) return null;
    const value: unknown = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    if (!isRecord(value)) return null;
    return {
      value,
      token: nonEmptyString(value.access_token),
      refreshToken: nonEmptyString(value.refresh_token),
      expiresAt: finiteNumber(value.expires_at),
      mode: stat.mode & 0o777,
    };
  } catch {
    return null;
  }
}

function kimiCredentialState(
  credential: KimiCredentialSnapshot | null,
  nowSec: number,
): KimiTokenState {
  if (!credential?.token) return { kind: 'absent' };
  if (credential.expiresAt !== null && credential.expiresAt <= nowSec) {
    return { kind: 'expired', expiresAt: credential.expiresAt };
  }
  return { kind: 'ok', token: credential.token };
}

function normalizedNowSec(nowSec?: number): number {
  return typeof nowSec === 'number' && Number.isFinite(nowSec)
    ? Math.floor(nowSec)
    : Math.floor(Date.now() / 1000);
}

function kimiAutoRefreshEnabled(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  return !['0', 'false', 'off', 'no'].includes(raw.trim().toLowerCase());
}

function acquireCredentialLock(
  credentialPath: string,
  timeoutMs: number,
): CredentialLockHandle | null {
  const lockPath = `${credentialPath}.ccm-refresh.lock`;
  const owner = `${process.pid}:${randomUUID()}`;
  const startedAt = Date.now();
  const staleMs = Math.max(30_000, timeoutMs * 3);
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify({ owner, pid: process.pid, created_at: Date.now() }));
        fs.fsyncSync(fd);
      } catch (error) {
        try {
          fs.closeSync(fd);
        } catch {
          // Preserve the lock initialization failure.
        }
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // The failed owner may already have lost the path; never expose lock contents.
        }
        throw error;
      }
      fs.closeSync(fd);
      return { path: lockPath, owner };
    } catch (error) {
      const errno = error as NodeJS.ErrnoException;
      if (errno.code !== 'EEXIST') throw error;
      if (reclaimStaleCredentialLock(lockPath, staleMs)) continue;
      if (Date.now() - startedAt >= timeoutMs) return null;
      sleepSync(LOCK_RETRY_MIN_MS + Math.floor(Math.random() * LOCK_RETRY_JITTER_MS));
    }
  }
}

function reclaimStaleCredentialLock(lockPath: string, staleMs: number): boolean {
  try {
    const observedRaw = fs.readFileSync(lockPath, 'utf8');
    const observed = JSON.parse(observedRaw) as { pid?: unknown };
    const stat = fs.statSync(lockPath);
    let stale = false;
    if (Number.isInteger(observed.pid) && (observed.pid as number) > 0) {
      try {
        process.kill(observed.pid as number, 0);
      } catch (error) {
        stale = (error as NodeJS.ErrnoException).code === 'ESRCH';
      }
    } else {
      stale = Date.now() - stat.mtimeMs > staleMs;
    }
    if (!stale || fs.readFileSync(lockPath, 'utf8') !== observedRaw) return false;
    fs.unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

function releaseCredentialLock(lock: CredentialLockHandle | null): void {
  if (!lock) return;
  try {
    const current = JSON.parse(fs.readFileSync(lock.path, 'utf8')) as { owner?: unknown };
    if (current.owner === lock.owner) fs.unlinkSync(lock.path);
  } catch {
    // Already removed or replaced: never unlink a lock whose ownership cannot be proven.
  }
}

function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      // Last-resort fallback for runtimes without SharedArrayBuffer.
    }
  }
}

function atomicWriteKimiCredentials(
  credentialPath: string,
  value: Record<string, unknown>,
  originalMode: number,
): void {
  const directory = path.dirname(credentialPath);
  const tempPath = path.join(
    directory,
    `.${path.basename(credentialPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let fd: number | null = null;
  let published = false;
  try {
    fd = fs.openSync(tempPath, 'wx', 0o600);
    fs.fchmodSync(fd, originalMode);
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tempPath, credentialPath);
    published = true;
    syncDirectoryBestEffort(directory);
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Preserve the original write failure.
      }
    }
    if (!published) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Temp file may not have been created or may already be gone.
      }
    }
  }
}

function syncDirectoryBestEffort(directory: string): void {
  let fd: number | null = null;
  try {
    fd = fs.openSync(directory, 'r');
    fs.fsyncSync(fd);
  } catch {
    // Some supported hosts do not permit directory fsync; file fsync + rename still prevents tears.
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Directory sync is best-effort on hosts that do not support it.
      }
    }
  }
}

function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = nonEmptyString(source[key]);
    if (v) return v;
  }
  return null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
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
