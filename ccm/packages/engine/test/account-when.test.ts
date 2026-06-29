// account-when.test.ts — @ccm/engine·LOADBAL §3.2 换号 WHEN 触发判定契约门。
//   钉住三触发各自 + OR + forced 绕过滞回 + ③ 失衡阈值「非 1% 而 15%」+ min_switch_interval 滞回挡频繁切 +
//   evaluateSwitch 接 predict（active 只信权威·无 live → 不 forced）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { account } from '../dist/index.mjs';

const SCHEMA = 'cc-master/accounts/v1';
const NOW = '2026-06-25T13:00:00Z';
const NOW_SEC = Math.floor(Date.parse(NOW) / 1000);
const FAR = '2026-07-15T00:00:00Z';

function vault(email: string) {
  return { kind: 'keychain', service: 's', account: email };
}

// ── ① 5h 水位 forced ─────────────────────────────────────────────────────────────
test('shouldSwitch: ① 5h watermark ≥ threshold → forced switch', () => {
  const d = account.shouldSwitch(
    { activeFiveHourPct: 90, activeSevenDayPct: 20, nowSec: NOW_SEC },
    { fiveHourWatermark: 85 },
  );
  assert.equal(d.shouldSwitch, true);
  assert.equal(d.forced, true);
  assert.ok(d.triggers.includes('five_hour_watermark'));
});

test('shouldSwitch: ① runway will-exhaust → forced (even below 5h watermark)', () => {
  const d = account.shouldSwitch({
    activeFiveHourPct: 50,
    activeSevenDayPct: 20,
    runwayWillExhaust: true,
    nowSec: NOW_SEC,
  });
  assert.equal(d.shouldSwitch, true);
  assert.equal(d.forced, true);
  assert.ok(d.triggers.includes('five_hour_watermark'));
});

// ── ② 7d 水位 forced（安全）──────────────────────────────────────────────────────
test('shouldSwitch: ② 7d watermark ≥ threshold → forced switch (safety)', () => {
  const d = account.shouldSwitch(
    { activeFiveHourPct: 20, activeSevenDayPct: 88, nowSec: NOW_SEC },
    { sevenDayWatermark: 85 },
  );
  assert.equal(d.shouldSwitch, true);
  assert.equal(d.forced, true);
  assert.ok(d.triggers.includes('seven_day_watermark'));
});

// ── ③ 7d 失衡（proactive·gain ≥ 阈值·anchor = 池最优）────────────────────────────────
test('shouldSwitch: ③ 7d imbalance gain ≥ threshold → proactive switch (not forced)', () => {
  const d = account.shouldSwitch(
    {
      activeFiveHourPct: 40,
      activeSevenDayPct: 50,
      poolSevenDayPcts: [70, 50, 30], // 最优 = 30
      lastSwitchAtSec: NOW_SEC - 7200, // 2h 前·过滞回
      nowSec: NOW_SEC,
    },
    { imbalanceThreshold: 15, minSwitchIntervalSec: 1800 },
  );
  assert.equal(d.shouldSwitch, true);
  assert.equal(d.forced, false);
  assert.ok(d.triggers.includes('seven_day_imbalance'));
  assert.equal(d.poolBestSevenDay, 30);
  assert.equal(d.imbalanceGain, 20); // 50 − 30
  assert.equal(d.poolMedianSevenDay, 50);
});

test('shouldSwitch: ③ imbalance below threshold → no switch', () => {
  const d = account.shouldSwitch(
    {
      activeFiveHourPct: 40,
      activeSevenDayPct: 40,
      poolSevenDayPcts: [30],
      lastSwitchAtSec: NOW_SEC - 7200,
      nowSec: NOW_SEC,
    },
    { imbalanceThreshold: 15 },
  );
  assert.equal(d.shouldSwitch, false);
  assert.equal(d.imbalanceGain, 10);
});

test('shouldSwitch: ③ does NOT trigger on 1% imbalance (threshold is 15%, not 1%)', () => {
  const d = account.shouldSwitch(
    {
      activeFiveHourPct: 40,
      activeSevenDayPct: 31,
      poolSevenDayPcts: [30], // gain 1%
      lastSwitchAtSec: NOW_SEC - 7200,
      nowSec: NOW_SEC,
    },
    { imbalanceThreshold: 15 },
  );
  assert.equal(d.shouldSwitch, false);
  assert.equal(d.imbalanceGain, 1);
});

// ── ③ min_switch_interval 滞回挡频繁切 ──────────────────────────────────────────────
test('shouldSwitch: ③ imbalance hits but recent switch → hysteresis blocks it', () => {
  const d = account.shouldSwitch(
    {
      activeFiveHourPct: 40,
      activeSevenDayPct: 50,
      poolSevenDayPcts: [30], // gain 20 ≥ 15
      lastSwitchAtSec: NOW_SEC - 600, // 仅 10min 前 < 30min 滞回
      nowSec: NOW_SEC,
    },
    { imbalanceThreshold: 15, minSwitchIntervalSec: 1800 },
  );
  assert.equal(d.shouldSwitch, false);
  assert.equal(d.hysteresisBlocked, true);
  assert.ok(!d.triggers.includes('seven_day_imbalance'));
});

test('shouldSwitch: ③ imbalance fires once hysteresis interval elapsed', () => {
  const d = account.shouldSwitch(
    {
      activeFiveHourPct: 40,
      activeSevenDayPct: 50,
      poolSevenDayPcts: [30],
      lastSwitchAtSec: NOW_SEC - 3600, // 1h 前 ≥ 30min
      nowSec: NOW_SEC,
    },
    { imbalanceThreshold: 15, minSwitchIntervalSec: 1800 },
  );
  assert.equal(d.shouldSwitch, true);
  assert.equal(d.hysteresisBlocked, false);
});

// ── forced 绕过滞回（wall 在即·刚切过也得切）───────────────────────────────────────
test('shouldSwitch: forced trigger bypasses hysteresis (recent switch still switches)', () => {
  const d = account.shouldSwitch(
    {
      activeFiveHourPct: 92, // forced ①
      activeSevenDayPct: 50,
      poolSevenDayPcts: [30], // gain 20
      lastSwitchAtSec: NOW_SEC - 60, // 刚切过 1min
      nowSec: NOW_SEC,
    },
    { fiveHourWatermark: 85, imbalanceThreshold: 15, minSwitchIntervalSec: 1800 },
  );
  assert.equal(d.shouldSwitch, true);
  assert.equal(d.forced, true);
  assert.equal(d.hysteresisBlocked, false);
  assert.ok(d.triggers.includes('five_hour_watermark'));
  assert.ok(d.triggers.includes('seven_day_imbalance')); // forced 下 ③ 也不被滞回挡
});

// ── OR：多触发并存 ─────────────────────────────────────────────────────────────────
test('shouldSwitch: OR — 5h + 7d watermarks + imbalance all fire', () => {
  const d = account.shouldSwitch(
    {
      activeFiveHourPct: 90,
      activeSevenDayPct: 88,
      poolSevenDayPcts: [30],
      lastSwitchAtSec: NOW_SEC - 7200,
      nowSec: NOW_SEC,
    },
    { fiveHourWatermark: 85, sevenDayWatermark: 85, imbalanceThreshold: 15 },
  );
  assert.equal(d.triggers.length, 3);
  assert.ok(d.triggers.includes('five_hour_watermark'));
  assert.ok(d.triggers.includes('seven_day_watermark'));
  assert.ok(d.triggers.includes('seven_day_imbalance'));
});

// ── 边界：active 信号不可判 / 无候选 → 不切 ──────────────────────────────────────────
test('shouldSwitch: null active signals → no forced triggers', () => {
  const d = account.shouldSwitch({
    activeFiveHourPct: null,
    activeSevenDayPct: null,
    poolSevenDayPcts: [10],
    nowSec: NOW_SEC,
  });
  assert.equal(d.shouldSwitch, false);
  assert.equal(d.imbalanceGain, null);
});

test('shouldSwitch: empty pool → ③ cannot evaluate (no anchor)', () => {
  const d = account.shouldSwitch({
    activeFiveHourPct: 40,
    activeSevenDayPct: 70,
    poolSevenDayPcts: [],
    lastSwitchAtSec: NOW_SEC - 7200,
    nowSec: NOW_SEC,
  });
  assert.equal(d.shouldSwitch, false);
  assert.equal(d.poolBestSevenDay, null);
});

// ── evaluateSwitch：接 predict（active 只信权威）──────────────────────────────────────
test('evaluateSwitch: active live signal drives forced 7d watermark', () => {
  const reg = {
    schema: SCHEMA,
    accounts: {
      'active@x.com': {
        vault: vault('active@x.com'),
        active: true,
        last_switch_out: {
          '5h': { used_pct: 10, resets_at: FAR },
          '7d': { used_pct: 10, resets_at: FAR },
        },
      },
      'backup@x.com': {
        vault: vault('backup@x.com'),
        active: false,
        last_switch_out: {
          '5h': { used_pct: 20, resets_at: FAR },
          '7d': { used_pct: 20, resets_at: FAR },
        },
      },
    },
  };
  const d = account.evaluateSwitch(reg, {
    now: NOW,
    nowSec: NOW_SEC,
    live: { sevenDayPct: 88 }, // active 号 API 权威 → forced ②
    sevenDayWatermark: 85,
  });
  assert.equal(d.shouldSwitch, true);
  assert.ok(d.triggers.includes('seven_day_watermark'));
  assert.equal(d.activeEmail, 'active@x.com');
  assert.equal(d.poolCandidates, 1);
  assert.equal(d.activeAuthoritative, true);
});

test('evaluateSwitch: no live signal → active not authoritative → forced suppressed (no acting on stale)', () => {
  const reg = {
    schema: SCHEMA,
    accounts: {
      'active@x.com': {
        vault: vault('active@x.com'),
        active: true,
        // 陈旧切出快照 7d 88——若误用会 forced 切，但它非权威 → 必须压抑。
        last_switch_out: {
          '5h': { used_pct: 88, resets_at: FAR },
          '7d': { used_pct: 88, resets_at: FAR },
        },
      },
      'backup@x.com': {
        vault: vault('backup@x.com'),
        active: false,
        last_switch_out: {
          '5h': { used_pct: 10, resets_at: FAR },
          '7d': { used_pct: 10, resets_at: FAR },
        },
      },
    },
  };
  const d = account.evaluateSwitch(reg, { now: NOW, nowSec: NOW_SEC, sevenDayWatermark: 85 });
  assert.equal(d.activeAuthoritative, false);
  assert.equal(d.forced, false);
  assert.equal(d.shouldSwitch, false); // 不拿陈旧预测催 forced 切号
});
