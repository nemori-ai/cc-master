// cursor-usage.ts — Cursor dashboard GetCurrentPeriodUsage → UsageSignal.billing_period.
//
// Cursor Pro/Team/Ultra expose a ~30d billing-cycle quota (not Claude/Codex 5h/7d rolling
// windows). Auth: CCM_CURSOR_ACCESS_TOKEN, or read cursorAuth/accessToken from state.vscdb
// via node:sqlite DatabaseSync. HTTP is sync-bridged with Worker + Atomics (same pattern as
// codex-rate-limits.ts). Fail-open: any error → null. Zero npm deps.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads';
import type { UsageSignal } from '@ccm/engine';

// Lazy-load node:sqlite — a top-level import emits ExperimentalWarning on every ccm
// invocation (including --version / --json), which breaks e2e stderr/JSON contracts.
const nodeRequire = createRequire(import.meta.url);

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_API_BASE = 'https://api2.cursor.sh';
const USAGE_PATH = '/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
const ACCESS_TOKEN_KEY = 'cursorAuth/accessToken';

export interface CursorUsageSignal {
  signal: UsageSignal;
  source: 'cursor-dashboard' | 'cursor-agent-dashboard';
  auth_source: 'cursor-ide-current-login' | 'cursor-agent-current-login';
  quota_scope_fingerprint: string | null;
  cycle_start_ms: number | null;
  cycle_end_ms: number | null;
}

export type CursorUsageSurface = 'cursor-ide-plugin' | 'cursor-agent-cli';

export function normalizeCursorPeriodUsage(
  raw: unknown,
  opts?: {
    capturedAtSec?: number;
    surface?: CursorUsageSurface;
    quotaScopeFingerprint?: string | null;
  },
): CursorUsageSignal | null {
  if (!isRecord(raw)) return null;
  const plan = isRecord(raw.planUsage) ? raw.planUsage : null;
  if (!plan) return null;

  const usedPct = resolveUsedPercent(plan);
  if (usedPct === null) return null;

  const cycleStartMs = parseMs(raw.billingCycleStart);
  const cycleEndMs = parseMs(raw.billingCycleEnd);
  const resetsAt =
    cycleEndMs !== null && Number.isFinite(cycleEndMs) ? Math.floor(cycleEndMs / 1000) : null;

  const capturedAt =
    typeof opts?.capturedAtSec === 'number' && Number.isFinite(opts.capturedAtSec)
      ? Math.floor(opts.capturedAtSec)
      : Math.floor(Date.now() / 1000);

  return {
    source: opts?.surface === 'cursor-agent-cli' ? 'cursor-agent-dashboard' : 'cursor-dashboard',
    auth_source:
      opts?.surface === 'cursor-agent-cli'
        ? 'cursor-agent-current-login'
        : 'cursor-ide-current-login',
    quota_scope_fingerprint: opts?.quotaScopeFingerprint ?? null,
    cycle_start_ms: cycleStartMs,
    cycle_end_ms: cycleEndMs,
    signal: {
      five_hour: null,
      seven_day: null,
      billing_period: {
        used_percentage: usedPct,
        resets_at: resetsAt,
      },
      captured_at: capturedAt,
    },
  };
}

export function readCursorUsageSignal(
  env: Record<string, string | undefined>,
  surface: CursorUsageSurface = 'cursor-ide-plugin',
): CursorUsageSignal | null {
  const token = resolveCursorAccessToken(env, surface);
  if (!token) return null;

  const timeoutMs = parseTimeout(env.CCM_CURSOR_USAGE_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS;
  const apiBase = (env.CCM_CURSOR_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
  const sab = new SharedArrayBuffer(4);
  const flag = new Int32Array(sab);
  const { port1, port2 } = new MessageChannel();
  let worker: Worker | null = null;
  try {
    worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        url: `${apiBase}${USAGE_PATH}`,
        token,
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
    return normalizeCursorPeriodUsage(msg.result, {
      surface,
      quotaScopeFingerprint: quotaScopeFingerprint(token),
    });
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
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + workerData.token,
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
      },
      body: '{}',
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

function resolveUsedPercent(plan: Record<string, unknown>): number | null {
  if (typeof plan.totalPercentUsed === 'number' && Number.isFinite(plan.totalPercentUsed)) {
    return plan.totalPercentUsed;
  }
  if (typeof plan.apiPercentUsed === 'number' && Number.isFinite(plan.apiPercentUsed)) {
    return plan.apiPercentUsed;
  }
  const spend = plan.includedSpend;
  const limit = plan.limit;
  if (
    typeof spend === 'number' &&
    Number.isFinite(spend) &&
    typeof limit === 'number' &&
    Number.isFinite(limit) &&
    limit > 0
  ) {
    return (spend / limit) * 100;
  }
  return null;
}

function resolveCursorAccessToken(
  env: Record<string, string | undefined>,
  surface: CursorUsageSurface,
): string | null {
  if (surface === 'cursor-agent-cli') {
    const fromEnv = env.CCM_CURSOR_AGENT_ACCESS_TOKEN?.trim();
    if (fromEnv) return fromEnv;
    const authPath = resolveCursorAgentAuthPath(env);
    return authPath ? readAccessTokenFromJson(authPath) : null;
  }
  const fromEnv = (env.CCM_CURSOR_IDE_ACCESS_TOKEN || env.CCM_CURSOR_ACCESS_TOKEN)?.trim();
  if (fromEnv) return fromEnv;
  const dbPath = resolveStateDbPath(env);
  if (!dbPath) return null;
  return readAccessTokenFromStateDb(dbPath);
}

/** Safe discovery probe: reports availability and surface provenance without returning a secret. */
export function inspectCursorCredential(
  env: Record<string, string | undefined>,
  surface: CursorUsageSurface,
): { available: boolean; auth_source: CursorUsageSignal['auth_source'] } {
  return {
    available: resolveCursorAccessToken(env, surface) !== null,
    auth_source:
      surface === 'cursor-agent-cli' ? 'cursor-agent-current-login' : 'cursor-ide-current-login',
  };
}

function resolveCursorAgentAuthPath(env: Record<string, string | undefined>): string | null {
  if (env.CCM_CURSOR_AGENT_AUTH_FILE) {
    const explicit = path.resolve(env.CCM_CURSOR_AGENT_AUTH_FILE);
    return fs.existsSync(explicit) ? explicit : null;
  }
  const home = env.HOME || env.USERPROFILE || os.homedir();
  let candidate: string;
  if (process.platform === 'darwin') {
    candidate = path.join(home, '.cursor', 'auth.json');
  } else if (process.platform === 'win32') {
    const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidate = path.join(appData, 'Cursor', 'auth.json');
  } else {
    const xdgConfig = env.XDG_CONFIG_HOME || path.join(home, '.config');
    candidate = path.join(xdgConfig, 'cursor', 'auth.json');
  }
  return fs.existsSync(candidate) ? candidate : null;
}

function readAccessTokenFromJson(authPath: string): string | null {
  try {
    const stat = fs.statSync(authPath);
    if (!stat.isFile() || stat.size > 1024 * 1024) return null;
    const value: unknown = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    if (!isRecord(value)) return null;
    const token = value.accessToken;
    return typeof token === 'string' && token.trim() ? token.trim() : null;
  } catch {
    return null;
  }
}

function quotaScopeFingerprint(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!isRecord(payload) || typeof payload.sub !== 'string' || !payload.sub.trim()) return null;
    return `sha256:${createHash('sha256').update(payload.sub).digest('hex')}`;
  } catch {
    return null;
  }
}

function resolveStateDbPath(env: Record<string, string | undefined>): string | null {
  if (env.CCM_CURSOR_STATE_DB) {
    const p = path.resolve(env.CCM_CURSOR_STATE_DB);
    return fs.existsSync(p) ? p : null;
  }
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const candidates: string[] = [];
  if (process.platform === 'darwin') {
    candidates.push(
      path.join(
        home,
        'Library',
        'Application Support',
        'Cursor',
        'User',
        'globalStorage',
        'state.vscdb',
      ),
    );
  } else if (process.platform === 'win32') {
    const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidates.push(path.join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb'));
  } else {
    candidates.push(
      path.join(home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
      path.join(home, '.config', 'Cursor Nightly', 'User', 'globalStorage', 'state.vscdb'),
    );
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function readAccessTokenFromStateDb(dbPath: string): string | null {
  try {
    // node:sqlite DatabaseSync (Node 22.5+); fail-open if unavailable.
    const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db
        .prepare('SELECT value FROM ItemTable WHERE key = ? LIMIT 1')
        .get(ACCESS_TOKEN_KEY) as { value?: unknown } | undefined;
      const v = row?.value;
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    } finally {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
  } catch {
    return null;
  }
}

function parseMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
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
