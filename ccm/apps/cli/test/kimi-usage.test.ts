// kimi-usage.test.ts — normalize kimi-code /usages → UsageSignal (five_hour + seven_day),
// credential discovery + concurrency-safe refresh + fail-open. Schema fixture mirrors
// design_docs/2026-07-16-kimi-quota-signal-research.md §1.3 (kimi-code MIT managed-usage.ts).

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { shortLivedTokenRefreshHint } from '../src/harnesses/usage-refresh-hint.js';
import {
  describeKimiUsageRefresh,
  describeKimiUsageUnavailable,
  type KimiHttpRequest,
  type KimiHttpTransport,
  normalizeKimiUsagePayload,
  readKimiUsageSignal,
  refreshKimiToken,
} from '../src/kimi-usage.js';

const NOW = 1_784_000_000; // deterministic reference for relative-reset math.

// Representative /usages payload (research §1.3): weekly summary + 5h rolling window + booster wallet.
const SAMPLE = {
  usage: { name: 'Weekly limit', used: 400, limit: 1000, resetAt: '2026-07-25T00:00:00Z' },
  limits: [
    { detail: { used: 30, limit: 100, name: '5h' }, window: { duration: 300, timeUnit: 'MINUTE' } },
    { detail: { used: 2, limit: 50 }, window: { duration: 24, timeUnit: 'HOUR' } },
  ],
  boosterWallet: { balance: { type: 'BOOSTER', amount: '20000000000', amountLeft: '10000000000' } },
};

test('normalizeKimiUsagePayload maps weekly summary → seven_day and 300-MINUTE window → five_hour', () => {
  const out = normalizeKimiUsagePayload(SAMPLE, { capturedAtSec: NOW, nowSec: NOW });
  assert.ok(out);
  assert.equal(out.source, 'kimi-usages-api');
  assert.equal(out.signal.billing_period, null);
  assert.equal(out.signal.captured_at, NOW);
  // weekly: 400/1000 → 40%
  assert.equal(out.signal.seven_day?.used_percentage, 40);
  assert.equal(
    out.signal.seven_day?.resets_at,
    Math.floor(Date.parse('2026-07-25T00:00:00Z') / 1000),
  );
  // 5h window: 30/100 → 30%
  assert.equal(out.signal.five_hour?.used_percentage, 30);
});

test('normalizeKimiUsagePayload matches the live protobuf-enum timeUnit + flat limit shape', () => {
  // Real /usages shape (probed): summary {limit,used,remaining,resetTime}; limits[] flat (no nested
  // detail) with enum-prefixed timeUnit "TIME_UNIT_MINUTE".
  const out = normalizeKimiUsagePayload(
    {
      usage: { limit: 1000, used: 60, remaining: 940, resetTime: '2026-07-24T00:00:00Z' },
      limits: [
        {
          limit: 200,
          used: 50,
          remaining: 150,
          resetTime: '2026-07-20T08:00:00Z',
          window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
        },
      ],
    },
    { nowSec: NOW },
  );
  assert.ok(out);
  assert.equal(out.signal.seven_day?.used_percentage, 6);
  // 5h window: 50/200 → 25% (enum-prefixed timeUnit + flat shape must still resolve).
  assert.equal(out.signal.five_hour?.used_percentage, 25);
  assert.equal(
    out.signal.five_hour?.resets_at,
    Math.floor(Date.parse('2026-07-20T08:00:00Z') / 1000),
  );
});

test('normalizeKimiUsagePayload supports remaining→used and reset_in relative seconds', () => {
  const out = normalizeKimiUsagePayload(
    {
      usage: { limit: 200, remaining: 50, reset_in: 3600 },
      limits: [],
    },
    { nowSec: NOW },
  );
  assert.ok(out);
  // used = limit - remaining = 150 → 75%
  assert.equal(out.signal.seven_day?.used_percentage, 75);
  assert.equal(out.signal.seven_day?.resets_at, NOW + 3600);
  assert.equal(out.signal.five_hour, null);
});

test('normalizeKimiUsagePayload returns null for empty / windowless / malformed payloads', () => {
  assert.equal(normalizeKimiUsagePayload(null), null);
  assert.equal(normalizeKimiUsagePayload({}), null);
  assert.equal(normalizeKimiUsagePayload({ usage: {}, limits: [] }), null);
  // limit=0 is not a usable percentage base.
  assert.equal(normalizeKimiUsagePayload({ usage: { used: 1, limit: 0 } }), null);
});

test('expired credential refreshes once, persists the rotated pair, then reads usage', () => {
  const mock = createMockKimiHttp();
  const fixture = createCredentialFixture(NOW - 60);
  const reading = readKimiUsageSignal(kimiFixtureEnv(fixture.path, mock.origin), {
    nowSec: NOW,
    http: mock.http,
  });

  assert.ok(reading);
  assert.equal(reading.signal.seven_day?.used_percentage, 40);
  assert.equal(reading.signal.five_hour?.used_percentage, 30);

  const persisted = readCredentialFixture(fixture.path);
  assert.equal(
    persisted.access_token !== fixture.accessToken,
    true,
    'the access token is rotated without exposing either value',
  );
  assert.equal(
    persisted.refresh_token !== fixture.refreshToken,
    true,
    'the refresh token is rotated without exposing either value',
  );
  assert.equal(persisted.expires_in, 900);
  assert.equal(persisted.expires_at, NOW + 900);
  assert.equal(persisted.scope, 'kimi-code');
  assert.equal(persisted.token_type, 'Bearer');

  const state = readMockState(mock.statePath);
  assert.equal(state.refresh_requests, 1);
  assert.equal(state.usage_requests, 1);
  assert.equal(state.refresh_form_valid, true);
  assert.equal(state.usage_auth_valid, true);
});

test('lock owner re-reads a credential made fresh by another session and skips refresh', () => {
  const mock = createMockKimiHttp();
  const fixture = createCredentialFixture(NOW - 60);
  writeCredentialFixture(fixture.path, NOW + 900);

  const state = refreshKimiToken(kimiFixtureEnv(fixture.path, mock.origin), {
    nowSec: NOW,
    http: mock.http,
  });
  assert.equal(state.kind, 'ok');
  const requests = readMockState(mock.statePath);
  assert.equal(requests.refresh_requests, 0, 'fresh lock-time reread must not POST refresh');
  assert.equal(requests.usage_requests, 0);
});

test('two concurrent readers serialize refresh: one POST, second uses lock-time reread', async () => {
  const mock = createMockKimiHttp({ refreshDelayMs: 250 });
  const fixture = createCredentialFixture(NOW - 60);
  const env = kimiFixtureEnv(fixture.path, mock.origin);
  const startAtMs = Date.now() + 500;

  await Promise.all([
    runKimiChild('read', env, NOW, startAtMs, mock),
    runKimiChild('read', env, NOW, startAtMs, mock),
  ]);

  const state = readMockState(mock.statePath);
  assert.equal(state.refresh_requests, 1, 'only the lock winner may rotate the refresh token');
  assert.equal(state.usage_requests, 2, 'both readers consume the fresh access token');
  assert.equal(state.refresh_form_valid, true);
  assert.equal(state.usage_auth_valid, true);
});

test('refresh writeback uses atomic rename, preserves 0600, and leaves no temp or lock', () => {
  const mock = createMockKimiHttp();
  const fixture = createCredentialFixture(NOW - 60);
  const before = statSync(fixture.path);

  const state = refreshKimiToken(kimiFixtureEnv(fixture.path, mock.origin), {
    nowSec: NOW,
    http: mock.http,
  });
  assert.equal(state.kind, 'ok');

  const after = statSync(fixture.path);
  assert.equal(
    after.ino !== before.ino,
    true,
    'rename publishes a new inode instead of in-place write',
  );
  assert.equal(after.mode & 0o777, 0o600, 'credential permissions survive replacement');
  assert.doesNotThrow(() => readCredentialFixture(fixture.path));
  assert.deepEqual(
    readdirSync(fixture.dir).filter((name) => name !== basename(fixture.path)),
    [],
    'temp and advisory lock are cleaned after publication',
  );
});

test('refresh failure preserves the expired-token recovery hint and credential bytes', () => {
  const mock = createMockKimiHttp({ failRefresh: true });
  const fixture = createCredentialFixture(NOW - 60);
  const env = kimiFixtureEnv(fixture.path, mock.origin);
  const before = readFileSync(fixture.path);

  assert.equal(readKimiUsageSignal(env, { nowSec: NOW, http: mock.http }), null);
  assert.equal(
    readFileSync(fixture.path).equals(before),
    true,
    'failed refresh must not rewrite credential bytes',
  );
  const hint = describeKimiUsageRefresh(env, NOW);
  assert.equal(hint.command, "kimi -p 'hi'");
  assert.equal(hint.recoverable, true);
  assert.equal(
    hint.agent_authorized,
    true,
    'stored credential is still expired and self-refreshable',
  );
  assert.match(hint.reason, /过期/);

  const state = readMockState(mock.statePath);
  assert.equal(state.refresh_requests, 1);
  assert.equal(state.usage_requests, 0);
  assert.deepEqual(
    readdirSync(fixture.dir).filter((name) => name !== basename(fixture.path)),
    [],
  );
});

test('CCM_KIMI_AUTO_REFRESH=0 restores the old read-only expired-token behavior', () => {
  const mock = createMockKimiHttp();
  const fixture = createCredentialFixture(NOW - 60);
  const env = kimiFixtureEnv(fixture.path, mock.origin, { CCM_KIMI_AUTO_REFRESH: '0' });
  const before = readFileSync(fixture.path);

  assert.equal(readKimiUsageSignal(env, { nowSec: NOW, http: mock.http }), null);
  assert.equal(readFileSync(fixture.path).equals(before), true);
  const state = readMockState(mock.statePath);
  assert.equal(state.refresh_requests, 0);
  assert.equal(state.usage_requests, 0);
});

test('describeKimiUsageUnavailable reports absent credential when none is discoverable', () => {
  const missingCredential = join(mkdtempSync(join(tmpdir(), 'ccm-kimi-absent-')), 'missing.json');
  assert.match(
    describeKimiUsageUnavailable({ CCM_KIMI_CREDENTIALS_FILE: missingCredential }, NOW),
    /凭证/,
  );
});

// ── actionable refresh hint (E1): expired / absent → a concrete, secret-free recovery command ────────
test('describeKimiUsageRefresh: absent credential → re-auth hint (kimi login + recheck)', () => {
  const missingCredential = join(mkdtempSync(join(tmpdir(), 'ccm-kimi-absent-')), 'missing.json');
  const hint = describeKimiUsageRefresh({ CCM_KIMI_CREDENTIALS_FILE: missingCredential }, NOW);
  assert.equal(hint.recoverable, true, 'absent credential is user-recoverable via login');
  assert.match(hint.reason, /凭证/);
  assert.equal(hint.command, 'kimi login');
  assert.match(hint.remedy ?? '', /kimi login/);
  assert.equal(hint.recheck, 'ccm usage show --harness kimi-code');
  // Absent credential = interactive login, NOT an agent-autonomous self-refresh → not authorized,
  // but the never-touch-credentials red line still holds in the prose.
  assert.equal(hint.agent_authorized, false, 'interactive login is not agent-authorized');
  assert.match(hint.authorization, /你不要自行登录/);
  assert.match(hint.authorization, /绝不被授权直接[^。]*凭证/, 'red line preserved for absent');
});

// ── generalization proof: the builder is harness-agnostic (any short-lived-token harness reuses it) ──
test('shortLivedTokenRefreshHint is generic — a second harness reuses the same structure', () => {
  const recovery = {
    harnessLabel: 'acme-code',
    recheckHarness: 'acme-code',
    reasons: { expired: 'acme token 过期', absent: '无 acme 凭证', opaque: 'acme 读取失败' },
    refreshCommand: 'acme refresh',
    reauthCommand: 'acme login',
  };
  const expired = shortLivedTokenRefreshHint('expired', recovery);
  assert.equal(expired.recoverable, true);
  assert.equal(expired.command, 'acme refresh');
  assert.equal(expired.recheck, 'ccm usage show --harness acme-code');
  const absent = shortLivedTokenRefreshHint('absent', recovery);
  assert.equal(absent.command, 'acme login');
  // opaque (network / 401 / API change) is NOT user-fixable → no command / remedy.
  const opaque = shortLivedTokenRefreshHint('opaque', recovery);
  assert.equal(opaque.recoverable, false);
  assert.equal(opaque.command, null);
  assert.equal(opaque.remedy, null);
  assert.match(opaque.reason, /读取失败/);

  // Authorization skeleton is generic (parameterized by harness name, not hardcoded to kimi):
  //   expired = agent-authorized self-refresh; absent/opaque = not agent-authorized. Every branch
  //   restates the never-touch-credentials red line.
  assert.equal(expired.agent_authorized, true, 'expired self-refresh authorized for any harness');
  assert.match(expired.authorization, /acme refresh/, 'authorization names this harness command');
  assert.match(
    expired.authorization,
    /acme-code/,
    'authorization worded by harness name, not kimi',
  );
  assert.doesNotMatch(expired.authorization, /kimi/, 'generic skeleton never hardcodes kimi');
  assert.match(expired.authorization, /此授权仅限这次普通调用触发的自刷/);
  assert.equal(absent.agent_authorized, false, 'absent (login) is not agent-authorized');
  assert.equal(opaque.agent_authorized, false, 'opaque failure is not agent-authorized');
  for (const h of [expired, absent, opaque]) {
    assert.match(h.authorization, /绝不被授权直接[^。]*凭证/, 'red line preserved in every branch');
  }
});

interface CredentialFixture {
  dir: string;
  path: string;
  accessToken: string;
  refreshToken: string;
}

interface MockState {
  refresh_requests: number;
  usage_requests: number;
  refresh_form_valid: boolean;
  usage_auth_valid: boolean;
}

interface MockHttp {
  origin: string;
  statePath: string;
  options: MockHttpOptions;
  http: KimiHttpTransport;
}

interface MockHttpOptions {
  failRefresh?: boolean;
  refreshDelayMs?: number;
}

const KIMI_CHILD_SOURCE = [
  "import { randomBytes } from 'node:crypto';",
  "import { appendFileSync } from 'node:fs';",
  'const moduleUrl = process.argv[1];',
  'const operation = process.argv[2];',
  'const env = JSON.parse(process.argv[3]);',
  'const nowSec = Number(process.argv[4]);',
  'const startAtMs = Number(process.argv[5]);',
  'const mock = JSON.parse(process.argv[6]);',
  "const record = (kind, valid) => appendFileSync(mock.statePath, JSON.stringify({ kind, valid }) + '\\n');",
  'const http = (request) => {',
  '  const requestUrl = new URL(request.url);',
  "  if (request.method === 'POST' && requestUrl.pathname === '/api/oauth/token') {",
  "    const form = new URLSearchParams(request.body || '');",
  "    const valid = request.headers['Content-Type'] === 'application/x-www-form-urlencoded' && form.get('client_id') === '17e5f671-d194-4dfb-9706-5516cb48c098' && form.get('grant_type') === 'refresh_token' && Boolean(form.get('refresh_token'));",
  "    record('refresh', valid);",
  '    if (mock.options.refreshDelayMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, mock.options.refreshDelayMs);',
  '    if (mock.options.failRefresh) return null;',
  "    return { access_token: 'fixture-access-' + randomBytes(32).toString('base64url'), refresh_token: 'fixture-refresh-' + randomBytes(32).toString('base64url'), expires_in: 900, scope: 'kimi-code', token_type: 'Bearer' };",
  '  }',
  "  if (request.method === 'GET' && requestUrl.pathname === '/usages') {",
  "    record('usage', typeof request.headers.Authorization === 'string' && request.headers.Authorization.startsWith('Bearer '));",
  "    return { usage: { used: 400, limit: 1000, resetAt: '2026-07-25T00:00:00Z' }, limits: [{ detail: { used: 30, limit: 100 }, window: { duration: 300, timeUnit: 'MINUTE' } }] };",
  '  }',
  '  return null;',
  '};',
  'const waitMs = startAtMs - Date.now();',
  'if (waitMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);',
  'try {',
  '  const mod = await import(moduleUrl);',
  "  const result = operation === 'refresh'",
  '    ? mod.refreshKimiToken(env, { nowSec, http })',
  '    : mod.readKimiUsageSignal(env, { nowSec, http });',
  "  process.exitCode = operation === 'refresh' ? (result.kind === 'ok' ? 0 : 1) : (result ? 0 : 1);",
  '} catch {',
  '  process.exitCode = 2;',
  '}',
].join('\n');

function createCredentialFixture(expiresAt: number): CredentialFixture {
  const dir = mkdtempSync(join(tmpdir(), 'ccm-kimi-refresh-'));
  const credentialPath = join(dir, 'kimi-code.json');
  const tokens = writeCredentialFixture(credentialPath, expiresAt);
  return { dir, path: credentialPath, ...tokens };
}

function writeCredentialFixture(
  credentialPath: string,
  expiresAt: number,
): { accessToken: string; refreshToken: string } {
  const accessToken = randomBytes(32).toString('base64url');
  const refreshToken = randomBytes(32).toString('base64url');
  writeFileSync(
    credentialPath,
    JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      expires_in: 900,
      scope: 'kimi-code',
      token_type: 'Bearer',
    }),
    { mode: 0o600 },
  );
  chmodSync(credentialPath, 0o600);
  return { accessToken, refreshToken };
}

function readCredentialFixture(credentialPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(credentialPath, 'utf8')) as Record<string, unknown>;
}

function kimiFixtureEnv(
  credentialPath: string,
  origin: string,
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    CCM_KIMI_CREDENTIALS_FILE: credentialPath,
    CCM_KIMI_API_BASE: origin,
    KIMI_CODE_OAUTH_HOST: origin,
    CCM_KIMI_USAGE_TIMEOUT_MS: '3000',
    ...overrides,
  };
}

function createMockKimiHttp(options: MockHttpOptions = {}): MockHttp {
  const stateDir = mkdtempSync(join(tmpdir(), 'ccm-kimi-http-'));
  const statePath = join(stateDir, 'state.json');
  writeFileSync(statePath, '');
  const mock: MockHttp = {
    origin: 'https://mock.kimi.invalid',
    statePath,
    options,
    http: () => null,
  };
  mock.http = (request) => mockKimiHttpRequest(mock, request);
  return mock;
}

function mockKimiHttpRequest(mock: MockHttp, request: KimiHttpRequest): unknown | null {
  const requestUrl = new URL(request.url);
  if (request.method === 'POST' && requestUrl.pathname === '/api/oauth/token') {
    const form = new URLSearchParams(request.body ?? '');
    recordMockRequest(
      mock.statePath,
      'refresh',
      request.headers['Content-Type'] === 'application/x-www-form-urlencoded' &&
        form.get('client_id') === '17e5f671-d194-4dfb-9706-5516cb48c098' &&
        form.get('grant_type') === 'refresh_token' &&
        Boolean(form.get('refresh_token')),
    );
    if (mock.options.refreshDelayMs) sleepTestSync(mock.options.refreshDelayMs);
    if (mock.options.failRefresh) return null;
    return {
      access_token: `fixture-access-${randomBytes(32).toString('base64url')}`,
      refresh_token: `fixture-refresh-${randomBytes(32).toString('base64url')}`,
      expires_in: 900,
      scope: 'kimi-code',
      token_type: 'Bearer',
    };
  }
  if (request.method === 'GET' && requestUrl.pathname === '/usages') {
    recordMockRequest(
      mock.statePath,
      'usage',
      typeof request.headers.Authorization === 'string' &&
        request.headers.Authorization.startsWith('Bearer '),
    );
    return SAMPLE;
  }
  return null;
}

function recordMockRequest(statePath: string, kind: 'refresh' | 'usage', valid: boolean): void {
  appendFileSync(statePath, `${JSON.stringify({ kind, valid })}\n`);
}

function sleepTestSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readMockState(statePath: string): MockState {
  const state: MockState = {
    refresh_requests: 0,
    usage_requests: 0,
    refresh_form_valid: true,
    usage_auth_valid: true,
  };
  for (const line of readFileSync(statePath, 'utf8').split('\n')) {
    if (!line) continue;
    const event = JSON.parse(line) as { kind?: unknown; valid?: unknown };
    if (event.kind === 'refresh') {
      state.refresh_requests += 1;
      state.refresh_form_valid = state.refresh_form_valid && event.valid === true;
    }
    if (event.kind === 'usage') {
      state.usage_requests += 1;
      state.usage_auth_valid = state.usage_auth_valid && event.valid === true;
    }
  }
  return state;
}

async function runKimiChild(
  operation: 'read' | 'refresh',
  env: Record<string, string | undefined>,
  nowSec: number,
  startAtMs: number,
  mock: MockHttp,
): Promise<void> {
  const moduleUrl = new URL('../src/kimi-usage.ts', import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      KIMI_CHILD_SOURCE,
      moduleUrl,
      operation,
      JSON.stringify(env),
      String(nowSec),
      String(startAtMs),
      JSON.stringify({ statePath: mock.statePath, options: mock.options }),
    ],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdoutBytes = 0;
  let stderrBytes = 0;
  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBytes += chunk.length;
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrBytes += chunk.length;
  });
  const code = await new Promise<number | null>((resolveExit) => {
    child.once('exit', resolveExit);
  });
  assert.equal(stdoutBytes, 0, 'Kimi refresh/read child must emit no stdout');
  assert.equal(stderrBytes, 0, 'Kimi refresh/read child must emit no stderr');
  assert.equal(code, 0, 'Kimi refresh/read child must succeed');
}
