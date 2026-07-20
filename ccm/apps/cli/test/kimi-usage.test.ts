// kimi-usage.test.ts — normalize kimi-code /usages → UsageSignal (five_hour + seven_day),
// read-only credential discovery + expiry pre-check + fail-open. Schema fixture mirrors
// design_docs/2026-07-16-kimi-quota-signal-research.md §1.3 (kimi-code MIT managed-usage.ts).

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { shortLivedTokenRefreshHint } from '../src/harnesses/usage-refresh-hint.js';
import {
  describeKimiUsageRefresh,
  describeKimiUsageUnavailable,
  normalizeKimiUsagePayload,
  readKimiUsageSignal,
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

test('readKimiUsageSignal skips HTTP and returns null when the stored token is expired', () => {
  const home = mkdtempSync(join(tmpdir(), 'ccm-kimi-usage-'));
  mkdirSync(join(home, 'credentials'), { recursive: true });
  writeFileSync(
    join(home, 'credentials', 'kimi-code.json'),
    JSON.stringify({ access_token: 'jwt.header.body', expires_at: NOW - 60, token_type: 'Bearer' }),
  );
  // Expired token → no network attempt → null (fail-open, non-mutating).
  assert.equal(readKimiUsageSignal({ KIMI_CODE_HOME: home }, { nowSec: NOW }), null);
  assert.match(describeKimiUsageUnavailable({ KIMI_CODE_HOME: home }, NOW), /过期/);
});

test('describeKimiUsageUnavailable reports absent credential when none is discoverable', () => {
  assert.match(
    describeKimiUsageUnavailable({ KIMI_CODE_HOME: '/nonexistent-ccm-kimi-home' }, NOW),
    /凭证/,
  );
});

// ── actionable refresh hint (E1): expired / absent → a concrete, secret-free recovery command ────────
test('describeKimiUsageRefresh: expired token → actionable self-refresh hint (kimi -p + recheck)', () => {
  const home = mkdtempSync(join(tmpdir(), 'ccm-kimi-hint-'));
  mkdirSync(join(home, 'credentials'), { recursive: true });
  writeFileSync(
    join(home, 'credentials', 'kimi-code.json'),
    JSON.stringify({ access_token: 'jwt.header.body', expires_at: NOW - 60, token_type: 'Bearer' }),
  );
  const hint = describeKimiUsageRefresh({ KIMI_CODE_HOME: home }, NOW);
  assert.equal(hint.recoverable, true, 'expired token is user-recoverable');
  assert.match(hint.reason, /过期/);
  assert.equal(hint.command, "kimi -p 'hi'", 'kimi self-refreshes its own token on a managed call');
  assert.match(hint.remedy ?? '', /kimi -p 'hi'/);
  assert.match(
    hint.remedy ?? '',
    /ccm 只读、绝不写凭证/,
    'remedy states ccm never writes credentials',
  );
  assert.equal(hint.recheck, 'ccm usage show --harness kimi-code', 'recheck re-queries the signal');
  assert.match(hint.remedy ?? '', /ccm usage show --harness kimi-code/);
});

test('describeKimiUsageRefresh: absent credential → re-auth hint (kimi login + recheck)', () => {
  const hint = describeKimiUsageRefresh({ KIMI_CODE_HOME: '/nonexistent-ccm-kimi-home' }, NOW);
  assert.equal(hint.recoverable, true, 'absent credential is user-recoverable via login');
  assert.match(hint.reason, /凭证/);
  assert.equal(hint.command, 'kimi login');
  assert.match(hint.remedy ?? '', /kimi login/);
  assert.equal(hint.recheck, 'ccm usage show --harness kimi-code');
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
});
