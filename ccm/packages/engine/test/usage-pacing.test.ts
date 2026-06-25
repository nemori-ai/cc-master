// usage-pacing.test.ts — 双侧走廊 pacing 数学 SSOT + effective-N（usage 层·ADR-010/ADR-015）。
//   纯函数（信号注入·不碰 fs）。property/invariant + 四 verdict 覆盖 + 降级。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectiveN, pacingAdvice } from '../dist/index.mjs';

const NOW_SEC = Math.floor(Date.parse('2026-06-25T13:00:00Z') / 1000);

// ── 四个 verdict 全覆盖 ─────────────────────────────────────────────────────────────
test('pacing: 7d hard total gate → hard_stop (highest priority)', () => {
  // 7d ≥ 85% → hard_stop，即便 5h 还很闲。
  const a = pacingAdvice(
    { five_hour: { used_percentage: 30 }, seven_day: { used_percentage: 90 } },
    { nowSec: NOW_SEC },
  );
  assert.equal(a.verdict, 'hard_stop');
  assert.equal(a.hard_stop_7d, true);
  assert.ok(a.levers.includes('pause_dispatch'));
});

test('pacing: 5h above corridor high (90%) + single account → throttle', () => {
  const a = pacingAdvice(
    { five_hour: { used_percentage: 95 }, seven_day: { used_percentage: 50 } },
    { nowSec: NOW_SEC, effectiveN: 1 },
  );
  assert.equal(a.verdict, 'throttle');
  assert.ok(a.levers.includes('downgrade_model'));
});

test('pacing: 5h high but multi-account + 7d headroom → accelerate (switch signal)', () => {
  const a = pacingAdvice(
    { five_hour: { used_percentage: 95 }, seven_day: { used_percentage: 40 } },
    { nowSec: NOW_SEC, effectiveN: 3 },
  );
  assert.equal(a.verdict, 'accelerate');
  assert.ok(a.levers.includes('switch_account'));
});

test('pacing: underuse + near reset + 7d headroom + fresh → accelerate', () => {
  const a = pacingAdvice(
    {
      five_hour: { used_percentage: 30, resets_at: NOW_SEC + 1800 }, // 30min to reset
      seven_day: { used_percentage: 40 },
      captured_at: NOW_SEC, // fresh
    },
    { nowSec: NOW_SEC, effectiveN: 1 },
  );
  assert.equal(a.verdict, 'accelerate');
  assert.ok(
    a.levers.includes('increase_parallelism') || a.levers.includes('upgrade_model_critical_path'),
  );
});

test('pacing: within corridor (80%) → hold', () => {
  const a = pacingAdvice(
    { five_hour: { used_percentage: 80 }, seven_day: { used_percentage: 40 } },
    { nowSec: NOW_SEC },
  );
  assert.equal(a.verdict, 'hold');
});

// ── 欠用侧多闸 AND：缺一即不加速（保守）─────────────────────────────────────────────
test('pacing: underuse but stale sidecar → not accelerate (freshness gate)', () => {
  const a = pacingAdvice(
    {
      five_hour: { used_percentage: 30, resets_at: NOW_SEC + 1800 },
      seven_day: { used_percentage: 40 },
      captured_at: NOW_SEC - 3600, // 1h stale > 15min
    },
    { nowSec: NOW_SEC },
  );
  assert.notEqual(a.verdict, 'accelerate');
});

test('pacing: underuse but no near-reset → not accelerate', () => {
  const a = pacingAdvice(
    {
      five_hour: { used_percentage: 30, resets_at: NOW_SEC + 18000 }, // 5h away
      seven_day: { used_percentage: 40 },
      captured_at: NOW_SEC,
    },
    { nowSec: NOW_SEC },
  );
  assert.notEqual(a.verdict, 'accelerate');
});

test('pacing: underuse but 7d missing → not accelerate (conservative)', () => {
  const a = pacingAdvice(
    { five_hour: { used_percentage: 30, resets_at: NOW_SEC + 1800 }, captured_at: NOW_SEC },
    { nowSec: NOW_SEC },
  );
  // 7d 缺失 → 不开闸（保守·总闸未知不加速）。
  assert.notEqual(a.verdict, 'accelerate');
});

// ── 降级 / 可用性 ───────────────────────────────────────────────────────────────────
test('pacing: no account signal → available=false, hold verdict', () => {
  const a = pacingAdvice({}, { nowSec: NOW_SEC });
  assert.equal(a.available, false);
  assert.equal(a.verdict, 'hold');
});

test('pacing: only 7d signal with headroom → available, hold', () => {
  const a = pacingAdvice({ seven_day: { used_percentage: 40 } }, { nowSec: NOW_SEC });
  assert.equal(a.available, true);
  assert.equal(a.verdict, 'hold');
});

// ── 过期窗口闸（#bug1·codex round-3）：resets_at < now ⟹ used% stale ⟹ 该窗口不可判 ──────────────
test('pacing: expired 5h window (resets_at<now·used%=92) → not throttle (stale used% ignored)', () => {
  // 陈旧 sidecar 跨了 reset：5h used%=92（超走廊上界）但 resets_at 已过 → used% stale → 该窗口不参与 verdict。
  //   7d 有余量且未过期 → 只剩 7d 信号可判 → hold（绝不据过期 5h 误判 throttle）。
  const a = pacingAdvice(
    {
      five_hour: { used_percentage: 92, resets_at: NOW_SEC - 600 }, // 10min 前已 reset → 过期
      seven_day: { used_percentage: 50, resets_at: NOW_SEC + 86400 },
    },
    { nowSec: NOW_SEC },
  );
  assert.notEqual(a.verdict, 'throttle', '过期 5h 窗口不得触发 throttle');
  assert.equal(a.verdict, 'hold');
  assert.equal(a.window_5h_pct, null, '过期窗口 used% 判为不可用（null）');
  assert.equal(a.window_7d_pct, 50, '未过期 7d 窗口仍可判');
  assert.equal(a.available, true, '仍有 7d 可判 → available');
});

test('pacing: expired 7d window (resets_at<now·used%=90) → not hard_stop (stale used% ignored)', () => {
  // 7d used%=90（达硬总闸）但 resets_at 已过 → stale → 不可判 → 不得 hard_stop。
  //   5h 未过期且在走廊内 → hold。
  const a = pacingAdvice(
    {
      five_hour: { used_percentage: 80, resets_at: NOW_SEC + 3600 },
      seven_day: { used_percentage: 90, resets_at: NOW_SEC - 600 }, // 已过期
    },
    { nowSec: NOW_SEC },
  );
  assert.notEqual(a.verdict, 'hard_stop', '过期 7d 窗口不得触发 hard_stop');
  assert.equal(a.hard_stop_7d, false);
  assert.equal(a.window_7d_pct, null, '过期 7d used% 判为不可用');
});

test('pacing: both windows expired → available:false (degrade·same as no-signal)', () => {
  const a = pacingAdvice(
    {
      five_hour: { used_percentage: 92, resets_at: NOW_SEC - 600 },
      seven_day: { used_percentage: 90, resets_at: NOW_SEC - 600 },
    },
    { nowSec: NOW_SEC },
  );
  assert.equal(a.available, false, '两窗都过期 → 无可判信号 → available:false（同无信号降级）');
  assert.equal(a.verdict, 'hold');
});

test('pacing: non-expired window with resets_at in future is judged normally (gate is exact)', () => {
  // 对照：5h resets_at 在未来 → 不过期 → 92% 正常触发 throttle（证明闸只 null 掉真过期的，不误伤）。
  const a = pacingAdvice(
    {
      five_hour: { used_percentage: 92, resets_at: NOW_SEC + 1800 },
      seven_day: { used_percentage: 50, resets_at: NOW_SEC + 86400 },
    },
    { nowSec: NOW_SEC, effectiveN: 1 },
  );
  assert.equal(a.verdict, 'throttle', '未过期 5h 92% 正常 throttle');
  assert.equal(a.window_5h_pct, 92);
});

// ── effective-N 缩放欠用判定线 ──────────────────────────────────────────────────────
test('pacing: effectiveN raises underuse ceiling (50% underuse only with N≥2)', () => {
  const sig = {
    five_hour: { used_percentage: 80, resets_at: NOW_SEC + 1800 },
    seven_day: { used_percentage: 40 },
    captured_at: NOW_SEC,
  };
  // N=1: ceil=70 → 80% not underused → hold.
  const n1 = pacingAdvice(sig, { nowSec: NOW_SEC, effectiveN: 1 });
  assert.notEqual(n1.verdict, 'accelerate');
  // N=2: ceil=min(95,140)=95 → 80% < 95 → underused → accelerate.
  const n2 = pacingAdvice(sig, { nowSec: NOW_SEC, effectiveN: 2 });
  assert.equal(n2.verdict, 'accelerate');
});

// ── effectiveN 号池计数 ─────────────────────────────────────────────────────────────
test('effectiveN: counts switchable backups (excludes active/expired/switchable:false)', () => {
  const now = Date.parse('2026-06-25T13:00:00Z');
  const accounts = {
    a: { active: true }, // 当前在用 → 不算备号
    b: {}, // 可切
    c: { switchable: false }, // 显式残缺 → 计 backups 不计 switchable
    d: { token_expires_at: '2020-01-01T00:00:00Z' }, // 过期 → 计 backups 不计 switchable
    e: { token_expires_at: '2030-01-01T00:00:00Z' }, // 未过期 → 可切
  };
  const r = effectiveN(accounts, now);
  assert.equal(r.backups, 4);
  assert.equal(r.switchable, 2); // b + e
  assert.equal(r.effective_n, 3); // switchable + 1
});

test('effectiveN: null/empty → single account (effective_n=1)', () => {
  assert.equal(effectiveN(null, Date.now()).effective_n, 1);
  assert.equal(effectiveN({}, Date.now()).effective_n, 1);
});

// ── invariant: window pct echo + N≥1 ───────────────────────────────────────────────
test('pacing: echoes window pct + effective_n always ≥ 1', () => {
  const a = pacingAdvice(
    { five_hour: { used_percentage: 55 }, seven_day: { used_percentage: 33 } },
    { nowSec: NOW_SEC, effectiveN: 0 },
  );
  assert.equal(a.window_5h_pct, 55);
  assert.equal(a.window_7d_pct, 33);
  assert.ok(a.effective_n >= 1, 'effective_n floored at 1 even for bad input');
});
