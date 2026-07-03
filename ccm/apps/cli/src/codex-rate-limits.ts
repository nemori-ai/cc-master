// codex-rate-limits.ts — Codex app-server `account/rateLimits/read` adapter.
//
// Codex exposes current account quota through its JSON-RPC app-server over stdio. Keep this adapter
// stdlib-only and isolated so `usage` can consume the same UsageSignal shape as Claude Code's
// status-line sidecar without binding the rest of ccm to Codex internals.

import { MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads';
import type { UsageSignal, WindowSignal } from '@ccm/engine';

const DEFAULT_TIMEOUT_MS = 10_000;

interface RateLimitWindow {
  usedPercent?: unknown;
  windowDurationMins?: unknown;
  resetsAt?: unknown;
}

interface RateLimitBucket {
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
}

interface RateLimitsReadResult {
  rateLimits?: RateLimitBucket | null;
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

const WORKER_SOURCE = String.raw`
const { spawn } = require('node:child_process');
const { workerData } = require('node:worker_threads');

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
  try { child.stdin.write(JSON.stringify(msg) + '\n'); } catch { finish({ ok: false }); }
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
  let nl = buffer.indexOf('\n');
  while (nl !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line) handleLine(line);
    nl = buffer.indexOf('\n');
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
`;

function normalizeCodexRateLimits(result: unknown): CodexUsageSignal | null {
  const obj = isRecord(result) ? (result as RateLimitsReadResult) : null;
  const bucket = obj && isRecord(obj.rateLimits) ? (obj.rateLimits as RateLimitBucket) : null;
  if (!bucket) return null;

  const windows = [bucket.primary, bucket.secondary].filter(isRecord) as RateLimitWindow[];
  const fiveHour = pickWindow(windows, 300);
  const sevenDay = pickWindow(windows, 10080);
  if (!fiveHour && !sevenDay) return null;

  return {
    source: 'codex-app-server',
    signal: {
      five_hour: fiveHour ?? { used_percentage: null, resets_at: null },
      seven_day: sevenDay ?? { used_percentage: null, resets_at: null },
      captured_at: Math.floor(Date.now() / 1000),
    },
  };
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
