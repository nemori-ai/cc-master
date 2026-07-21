// codex-rate-limits.ts — Codex app-server `account/rateLimits/read` adapter.
//
// Codex exposes current account quota through its JSON-RPC app-server over stdio. Keep this adapter
// stdlib-only and isolated so `usage` can consume the same UsageSignal shape as Claude Code's
// status-line sidecar without binding the rest of ccm to Codex internals.

import { MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads';
import type { UsagePoolSignal, UsageSignal, WindowSignal } from '@ccm/engine';

const DEFAULT_TIMEOUT_MS = 10_000;

interface RateLimitWindow {
  usedPercent?: unknown;
  windowDurationMins?: unknown;
  resetsAt?: unknown;
}

interface RateLimitBucket {
  limitId?: unknown;
  limitName?: unknown;
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
}

interface RateLimitsReadResult {
  rateLimits?: RateLimitBucket | null;
  rateLimitsByLimitId?: Record<string, RateLimitBucket | null> | null;
}

export interface CodexUsageSignal {
  signal: UsageSignal;
  source: 'codex-app-server';
}

export function readCodexUsageSignal(
  env: Record<string, string | undefined>,
): CodexUsageSignal | null {
  const codexBin = env.CCM_CODEX_BIN || env.CODEX_BIN || 'codex';
  const timeoutMs = parseTimeout(env.CCM_CODEX_APP_SERVER_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS;
  const sab = new SharedArrayBuffer(4);
  const flag = new Int32Array(sab);
  const { port1, port2 } = new MessageChannel();
  let worker: Worker | null = null;
  try {
    worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        codexBin,
        env,
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
    return normalizeCodexRateLimits(msg.result);
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
(async () => {
const { spawn } = await import('node:child_process');
const { workerData } = await import('node:worker_threads');

const flag = new Int32Array(workerData.sab);
const port = workerData.port;
let done = false;
let buffer = '';

function finish(payload) {
  if (done) return;
  done = true;
  try { port.postMessage(payload); } catch {}
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
  try { child.stdin.end(); } catch {}
  try { child.kill(); } catch {}
}

function write(msg) {
  try { child.stdin.write(JSON.stringify(msg) + '\\n'); } catch { finish({ ok: false }); }
}

const child = spawn(workerData.codexBin, ['app-server', '--stdio'], {
  env: { ...process.env, ...workerData.env },
  stdio: ['pipe', 'pipe', 'ignore'],
});

const timer = setTimeout(() => finish({ ok: false }), workerData.timeoutMs);
child.once('error', () => finish({ ok: false }));
child.once('exit', () => finish({ ok: false }));
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let nl = buffer.indexOf('\\n');
  while (nl !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line) handleLine(line);
    nl = buffer.indexOf('\\n');
  }
});

function handleLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === 0) {
    write({ method: 'initialized', params: {} });
    write({ id: 6, method: 'account/rateLimits/read', params: {} });
    return;
  }
  if (msg.id === 6) {
    clearTimeout(timer);
    finish(msg.error ? { ok: false } : { ok: true, result: msg.result });
  }
}

write({
  id: 0,
  method: 'initialize',
  params: {
    clientInfo: {
      name: 'cc-master',
      title: 'cc-master',
      version: '0.1.0',
    },
  },
});
})();
`;

export function normalizeCodexRateLimits(result: unknown): CodexUsageSignal | null {
  const obj = isRecord(result) ? (result as RateLimitsReadResult) : null;
  if (!obj) return null;
  const legacyBucket = isRecord(obj.rateLimits) ? (obj.rateLimits as RateLimitBucket) : null;
  const namedBuckets = isRecord(obj.rateLimitsByLimitId)
    ? Object.entries(obj.rateLimitsByLimitId)
        .filter((entry): entry is [string, RateLimitBucket] => isRecord(entry[1]))
        .map(([id, bucket]) => ({ id, bucket }))
    : [];
  const compatibilityBucket =
    legacyBucket ??
    namedBuckets.find((entry) => entry.id === 'codex')?.bucket ??
    namedBuckets[0]?.bucket;
  if (!compatibilityBucket) return null;

  const windows = [compatibilityBucket.primary, compatibilityBucket.secondary].filter(
    isRecord,
  ) as RateLimitWindow[];
  const fiveHour = pickWindow(windows, 300);
  const sevenDay = pickWindow(windows, 10080);
  const pools = namedBuckets.flatMap(({ id, bucket }) => normalizeNamedPool(id, bucket));
  if (!fiveHour && !sevenDay && pools.length === 0) return null;

  return {
    source: 'codex-app-server',
    signal: {
      five_hour: fiveHour ?? { used_percentage: null, resets_at: null },
      seven_day: sevenDay ?? { used_percentage: null, resets_at: null },
      pools,
      captured_at: Math.floor(Date.now() / 1000),
    },
  };
}

function normalizeNamedPool(id: string, bucket: RateLimitBucket): UsagePoolSignal[] {
  const windows = [bucket.primary, bucket.secondary].filter(isRecord) as RateLimitWindow[];
  // Codex hard pacing is seven-day-only. Preserve one independent named entry per model limit id,
  // preferring its 7d window and falling back to 5h only when that is all the provider returned.
  const window = pickWindow(windows, 10_080) ?? pickWindow(windows, 300);
  if (typeof window?.used_percentage !== 'number') return [];
  const providerId =
    typeof bucket.limitId === 'string' && bucket.limitId.trim() ? bucket.limitId.trim() : id;
  const label =
    typeof bucket.limitName === 'string' && bucket.limitName.trim()
      ? bucket.limitName.trim()
      : providerId;
  return [
    {
      id: providerId,
      label,
      kind: 'first_party',
      used_percentage: window.used_percentage,
      resets_at: window.resets_at ?? null,
    },
  ];
}

function pickWindow(windows: RateLimitWindow[], mins: number): WindowSignal | null {
  const found = windows.find((w) => w.windowDurationMins === mins);
  if (!found) return null;
  const used = typeof found.usedPercent === 'number' ? found.usedPercent : null;
  const resetsAt = typeof found.resetsAt === 'number' ? found.resetsAt : null;
  return { used_percentage: used, resets_at: resetsAt };
}

function parseTimeout(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}
