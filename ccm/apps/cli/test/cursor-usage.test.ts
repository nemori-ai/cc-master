// cursor-usage.test.ts — normalize Cursor GetCurrentPeriodUsage → UsageSignal.billing_period (TDD).

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { UsageSignal } from '@ccm/engine';
import {
  type CursorUsageSignal,
  classifyCursorBillingQuota,
  inspectCursorCredential,
  normalizeCursorPeriodUsage,
  readCursorAgentQuotaFact,
} from '../src/cursor-usage.js';

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/cursor-get-current-period-usage.json',
);

test('normalizeCursorPeriodUsage maps totalPercentUsed + billingCycleEnd into billing_period only', () => {
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const out = normalizeCursorPeriodUsage(raw, { capturedAtSec: 1_700_000_000 });
  assert.ok(out);
  assert.equal(out.signal.five_hour, null);
  assert.equal(out.signal.seven_day, null);
  assert.ok(out.signal.billing_period);
  assert.equal(out.signal.billing_period?.used_percentage, 5.208);
  // billingCycleEnd 1706745600000 ms → 1706745600 sec
  assert.equal(out.signal.billing_period?.resets_at, 1_706_745_600);
  assert.equal(out.signal.captured_at, 1_700_000_000);
  assert.equal(out.source, 'cursor-dashboard');
  assert.equal(out.cycle_start_ms, 1_704_067_200_000);
  assert.equal(out.cycle_end_ms, 1_706_745_600_000);
});

test('normalizeCursorPeriodUsage preserves all first-party and usage-based named pools', () => {
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const out = normalizeCursorPeriodUsage(raw, { capturedAtSec: 1_700_000_000 });
  assert.ok(out);
  assert.deepEqual(out.signal.pools, [
    {
      id: 'cursor-total',
      label: 'Cursor total',
      kind: 'first_party',
      used_percentage: 5.208,
      resets_at: 1_706_745_600,
    },
    {
      id: 'cursor-auto',
      label: 'Cursor Auto',
      kind: 'first_party',
      used_percentage: 5.455,
      resets_at: 1_706_745_600,
    },
    {
      id: 'cursor-api',
      label: 'Cursor API / usage-based',
      kind: 'usage_based',
      used_percentage: 4.309,
      resets_at: 1_706_745_600,
    },
    {
      id: 'cursor-spend-limit',
      label: 'Cursor pay-as-you-go spend limit (user)',
      kind: 'usage_based',
      used_percentage: 0,
      resets_at: 1_706_745_600,
    },
  ]);
  assert.equal(
    out.signal.billing_period?.used_percentage,
    5.208,
    'legacy billing_period remains the compatible totalPercentUsed view',
  );
});

test('normalizeCursorPeriodUsage returns null for empty / malformed payloads', () => {
  assert.equal(normalizeCursorPeriodUsage(null), null);
  assert.equal(normalizeCursorPeriodUsage({}), null);
  assert.equal(normalizeCursorPeriodUsage({ planUsage: {} }), null);
});

test('normalizeCursorPeriodUsage falls back to apiPercentUsed when totalPercentUsed missing', () => {
  const out = normalizeCursorPeriodUsage({
    billingCycleStart: '1704067200000',
    billingCycleEnd: '1706745600000',
    planUsage: { apiPercentUsed: 42.5, limit: 100, remaining: 50 },
  });
  assert.ok(out);
  assert.equal(out.signal.billing_period?.used_percentage, 42.5);
});

test('normalizeCursorPeriodUsage derives percent from spend when percent fields missing', () => {
  const out = normalizeCursorPeriodUsage({
    billingCycleStart: '1704067200000',
    billingCycleEnd: '1706745600000',
    planUsage: { includedSpend: 2500, limit: 10000, remaining: 7500 },
  });
  assert.ok(out);
  assert.equal(out.signal.billing_period?.used_percentage, 25);
});

test('Cursor Agent discovers its own file credential without inheriting Cursor IDE state', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-cursor-agent-auth-'));
  const config = join(root, 'xdg');
  const agentAuth = join(config, 'cursor', 'auth.json');
  const ideDb = join(root, 'ide', 'state.vscdb');
  mkdirSync(join(config, 'cursor'), { recursive: true });
  mkdirSync(join(root, 'ide'), { recursive: true });
  writeFileSync(agentAuth, JSON.stringify({ accessToken: 'agent-access-secret' }));
  writeFileSync(ideDb, 'not-a-sqlite-db');

  const env = {
    HOME: root,
    XDG_CONFIG_HOME: config,
    CCM_CURSOR_STATE_DB: ideDb,
  };
  assert.deepEqual(inspectCursorCredential(env, 'cursor-agent-cli'), {
    available: true,
    auth_source: 'cursor-agent-current-login',
  });
  assert.deepEqual(inspectCursorCredential(env, 'cursor-ide-plugin'), {
    available: false,
    auth_source: 'cursor-ide-current-login',
  });
});

const NOW_SEC = 1_782_900_000;
const FUTURE_RESET = NOW_SEC + 1_000_000;

function billingSignal(usedPct: number): UsageSignal {
  return {
    five_hour: null,
    seven_day: null,
    billing_period: { used_percentage: usedPct, resets_at: FUTURE_RESET },
    captured_at: NOW_SEC,
  };
}

function cursorReading(usedPct: number, fingerprint: string | null): CursorUsageSignal {
  return {
    signal: billingSignal(usedPct),
    source: 'cursor-agent-dashboard',
    auth_source: 'cursor-agent-current-login',
    quota_scope_fingerprint: fingerprint,
    cycle_start_ms: null,
    cycle_end_ms: FUTURE_RESET * 1000,
  };
}

test('classifyCursorBillingQuota maps billing-period used% via the pacing SSOT thresholds', () => {
  // hold (<80% warn line) → ample · throttle (≥80%) → tight · stop_billing_period (≥85%) → exhausted.
  assert.equal(classifyCursorBillingQuota(billingSignal(22.5), NOW_SEC), 'ample');
  assert.equal(classifyCursorBillingQuota(billingSignal(79.9), NOW_SEC), 'ample');
  assert.equal(classifyCursorBillingQuota(billingSignal(80), NOW_SEC), 'tight');
  assert.equal(classifyCursorBillingQuota(billingSignal(84.9), NOW_SEC), 'tight');
  assert.equal(classifyCursorBillingQuota(billingSignal(85), NOW_SEC), 'exhausted');
  assert.equal(classifyCursorBillingQuota(billingSignal(100), NOW_SEC), 'exhausted');
});

test('classifyCursorBillingQuota returns unknown when the signal is absent / unreadable', () => {
  assert.equal(classifyCursorBillingQuota(null, NOW_SEC), 'unknown');
  assert.equal(
    classifyCursorBillingQuota(
      { five_hour: null, seven_day: null, billing_period: null, captured_at: NOW_SEC },
      NOW_SEC,
    ),
    'unknown',
  );
  // Stale window (reset already past) → unreadable → unknown, never a stale healthy reading.
  assert.equal(
    classifyCursorBillingQuota(
      {
        five_hour: null,
        seven_day: null,
        billing_period: { used_percentage: 10, resets_at: NOW_SEC - 10 },
        captured_at: NOW_SEC,
      },
      NOW_SEC,
    ),
    'unknown',
  );
});

test('readCursorAgentQuotaFact classifies an injected billing-period reading and echoes provenance', () => {
  const ample = readCursorAgentQuotaFact(
    {},
    { nowSec: NOW_SEC, readSignal: () => cursorReading(22.5, 'sha256:abc') },
  );
  assert.deepEqual(ample, {
    state: 'ample',
    used_percentage: 22.5,
    resets_at: FUTURE_RESET,
    quota_scope_fingerprint: 'sha256:abc',
    source: 'cursor-agent-dashboard',
  });

  const exhausted = readCursorAgentQuotaFact(
    {},
    { nowSec: NOW_SEC, readSignal: () => cursorReading(92, 'sha256:abc') },
  );
  assert.equal(exhausted.state, 'exhausted');
  assert.equal(exhausted.used_percentage, 92);
});

test('readCursorAgentQuotaFact fails open to unknown when the dashboard read is unavailable', () => {
  const fact = readCursorAgentQuotaFact({}, { nowSec: NOW_SEC, readSignal: () => null });
  assert.deepEqual(fact, {
    state: 'unknown',
    used_percentage: null,
    resets_at: null,
    quota_scope_fingerprint: null,
    source: 'cursor-agent:quota-unavailable',
  });
});

test('Cursor IDE and Cursor Agent explicit credential overrides remain surface-scoped', () => {
  const isolatedHome = mkdtempSync(join(tmpdir(), 'ccm-cursor-auth-scope-'));
  const env = {
    HOME: isolatedHome,
    XDG_CONFIG_HOME: join(isolatedHome, '.config'),
    CCM_CURSOR_ACCESS_TOKEN: 'ide-access-secret',
    CCM_CURSOR_AGENT_ACCESS_TOKEN: 'agent-access-secret',
  };
  assert.equal(inspectCursorCredential(env, 'cursor-ide-plugin').available, true);
  assert.equal(inspectCursorCredential(env, 'cursor-agent-cli').available, true);

  assert.equal(
    inspectCursorCredential(
      {
        HOME: isolatedHome,
        XDG_CONFIG_HOME: join(isolatedHome, '.config'),
        CCM_CURSOR_AGENT_ACCESS_TOKEN: 'agent-only',
      },
      'cursor-ide-plugin',
    ).available,
    false,
  );
  assert.equal(
    inspectCursorCredential(
      {
        HOME: isolatedHome,
        XDG_CONFIG_HOME: join(isolatedHome, '.config'),
        CCM_CURSOR_ACCESS_TOKEN: 'ide-only',
      },
      'cursor-agent-cli',
    ).available,
    false,
  );
});
