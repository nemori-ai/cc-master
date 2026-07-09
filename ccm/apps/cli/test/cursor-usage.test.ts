// cursor-usage.test.ts — normalize Cursor GetCurrentPeriodUsage → UsageSignal.billing_period (TDD).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { normalizeCursorPeriodUsage } from '../src/cursor-usage.js';

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
