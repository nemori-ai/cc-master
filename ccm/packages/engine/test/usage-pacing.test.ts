// usage-pacing.test.ts — 单侧（减速）+ 换号 + 停 pacing 数学 SSOT + effective-N（ADR-024·supersede ADR-010）。
//   纯函数（信号 + registry 注入·不碰 fs）。verdict 全覆盖 + 池感知 switch/stop + 过期闸 + 降级。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectiveN, pacingAdvice, tokenExpired } from '../dist/index.mjs';

const NOW_SEC = Math.floor(Date.parse('2026-06-25T13:00:00Z') / 1000);
const FUTURE = '2030-01-01T00:00:00Z';

// 双备号 registry（都满血·无历史 → fresh 视满血 → 健康可切）。
function poolTwoFresh() {
  return {
    accounts: {
      active: { active: true, token_expires_at: FUTURE },
      b: { token_expires_at: FUTURE },
      c: { token_expires_at: FUTURE },
    },
  };
}

// ── verdict 全覆盖 ──────────────────────────────────────────────────────────────────
test('pacing: 7d critical, single account (no pool) → stop_7d (全池才停·单号即全池)', () => {
  const a = pacingAdvice(
    { five_hour: { used_percentage: 30 }, seven_day: { used_percentage: 90 } },
    { nowSec: NOW_SEC },
  );
  assert.equal(a.verdict, 'stop_7d');
  assert.equal(a.stop_dimension, '7d');
  assert.ok(a.levers.includes('pause_dispatch'));
  assert.equal(a.strength, 'strong');
});

test('pacing: 7d critical but pool has fresh backup → switch (7d 单号逼顶 → 换·非停)', () => {
  const a = pacingAdvice(
    { five_hour: { used_percentage: 30 }, seven_day: { used_percentage: 90 } },
    { nowSec: NOW_SEC, effectiveN: 3, registry: poolTwoFresh() },
  );
  assert.equal(a.verdict, 'switch');
  assert.ok(a.switch_candidate === 'b' || a.switch_candidate === 'c');
  assert.ok(a.levers.includes('switch_account'));
});

test('pacing: 5h critical, single account → stop_5h', () => {
  const a = pacingAdvice(
    { five_hour: { used_percentage: 95 }, seven_day: { used_percentage: 50 } },
    { nowSec: NOW_SEC, effectiveN: 1 },
  );
  assert.equal(a.verdict, 'stop_5h');
  assert.equal(a.stop_dimension, '5h');
});

test('pacing: 5h critical + healthy backup → switch (weak)', () => {
  const a = pacingAdvice(
    { five_hour: { used_percentage: 95 }, seven_day: { used_percentage: 40 } },
    { nowSec: NOW_SEC, effectiveN: 3, registry: poolTwoFresh() },
  );
  assert.equal(a.verdict, 'switch');
  assert.equal(a.strength, 'weak');
  assert.ok(a.switch_candidate);
});

test('pacing: 5h at warning line (82%), no healthy escape → throttle (weak)', () => {
  const a = pacingAdvice(
    { five_hour: { used_percentage: 82 }, seven_day: { used_percentage: 40 } },
    { nowSec: NOW_SEC },
  );
  assert.equal(a.verdict, 'throttle');
  assert.equal(a.strength, 'weak');
  assert.ok(a.levers.includes('downgrade_model'));
});

test('pacing: 7d at warning line (82%), no escape → throttle (strong·7d driven)', () => {
  const a = pacingAdvice(
    { five_hour: { used_percentage: 30 }, seven_day: { used_percentage: 82 } },
    { nowSec: NOW_SEC },
  );
  assert.equal(a.verdict, 'throttle');
  assert.equal(a.strength, 'strong');
});

test('pacing: within corridor (60%) → hold', () => {
  const a = pacingAdvice(
    { five_hour: { used_percentage: 60 }, seven_day: { used_percentage: 40 } },
    { nowSec: NOW_SEC },
  );
  assert.equal(a.verdict, 'hold');
});

test('pacing: 5h warning but healthy backup available → hold (换号可救·不减速)', () => {
  const a = pacingAdvice(
    { five_hour: { used_percentage: 82 }, seven_day: { used_percentage: 40 } },
    { nowSec: NOW_SEC, registry: poolTwoFresh() },
  );
  assert.equal(a.verdict, 'hold');
  assert.ok(a.switch_candidate);
});

// ── 对称 5h 硬闸闭合 switch/stop 正确性（ADR-024 §3.1 amend·集成 a9b573c）─────────────
// 备号 5h 逼顶 / 7d 健康 → select 视其 gated（对称硬闸）→ 全池 NONE_ALL_EXHAUSTED →
//   active 5h 临界时不该 switch/throttle 到这个落地即撞墙的号，而是 stop_5h（不空切）。
test('pacing: 5h critical + backup is 5h-walled/7d-healthy → stop_5h (对称硬闸·不空切到撞墙号)', () => {
  const reg = {
    accounts: {
      active: { active: true, token_expires_at: FUTURE },
      walled: {
        active: false,
        token_expires_at: FUTURE,
        last_switch_out: {
          '5h': { used_pct: 96, resets_at: FUTURE }, // 5h 逼顶（≥90 对称硬闸）
          '7d': { used_pct: 15, resets_at: FUTURE }, // 7d 健康
        },
      },
    },
  };
  const a = pacingAdvice(
    {
      five_hour: { used_percentage: 95, resets_at: NOW_SEC + 1800 },
      seven_day: { used_percentage: 40 },
    },
    { nowSec: NOW_SEC, effectiveN: 2, registry: reg },
  );
  assert.equal(a.verdict, 'stop_5h', '5h 墙备号被对称硬闸排除·全池撞墙→stop 不空切');
  assert.equal(a.switch_candidate, null);
});

// ── 砍掉 accelerate：欠用不再加速（ADR-024 反转） ──────────────────────────────────
test('pacing: underused 5h + near reset + 7d headroom → hold (NO accelerate·反转)', () => {
  const a = pacingAdvice(
    {
      five_hour: { used_percentage: 30, resets_at: NOW_SEC + 1800 },
      seven_day: { used_percentage: 40 },
      captured_at: NOW_SEC,
    },
    { nowSec: NOW_SEC, effectiveN: 3, registry: poolTwoFresh() },
  );
  assert.equal(a.verdict, 'hold', '欠用侧不再加速——砍掉 accelerate');
  assert.notEqual(a.verdict, 'switch');
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

// ── 过期窗口闸：resets_at < now ⟹ used% stale ⟹ 该窗口不可判 ──────────────────────
test('pacing: expired 5h window (resets_at<now·used%=92) → not stop_5h (stale ignored)', () => {
  const a = pacingAdvice(
    {
      five_hour: { used_percentage: 92, resets_at: NOW_SEC - 600 },
      seven_day: { used_percentage: 50, resets_at: NOW_SEC + 86400 },
    },
    { nowSec: NOW_SEC },
  );
  assert.notEqual(a.verdict, 'stop_5h', '过期 5h 不得触发 stop');
  assert.equal(a.verdict, 'hold');
  assert.equal(a.window_5h_pct, null);
  assert.equal(a.window_7d_pct, 50);
  assert.equal(a.available, true);
});

test('pacing: expired 7d window (resets_at<now·used%=90) → not stop_7d (stale ignored)', () => {
  const a = pacingAdvice(
    {
      five_hour: { used_percentage: 60, resets_at: NOW_SEC + 3600 },
      seven_day: { used_percentage: 90, resets_at: NOW_SEC - 600 },
    },
    { nowSec: NOW_SEC },
  );
  assert.notEqual(a.verdict, 'stop_7d', '过期 7d 不得触发 stop');
  assert.equal(a.window_7d_pct, null);
});

test('pacing: both windows expired → available:false (degrade)', () => {
  const a = pacingAdvice(
    {
      five_hour: { used_percentage: 92, resets_at: NOW_SEC - 600 },
      seven_day: { used_percentage: 90, resets_at: NOW_SEC - 600 },
    },
    { nowSec: NOW_SEC },
  );
  assert.equal(a.available, false);
  assert.equal(a.verdict, 'hold');
});

test('pacing: non-expired 5h 92% single account → stop_5h (gate is exact)', () => {
  const a = pacingAdvice(
    {
      five_hour: { used_percentage: 92, resets_at: NOW_SEC + 1800 },
      seven_day: { used_percentage: 50, resets_at: NOW_SEC + 86400 },
    },
    { nowSec: NOW_SEC, effectiveN: 1 },
  );
  assert.equal(a.verdict, 'stop_5h');
  assert.equal(a.window_5h_pct, 92);
  assert.equal(a.nearest_reset, NOW_SEC + 1800, 'stop 吐 nearest 5h reset 供 arm wakeup');
});

// ── effectiveN 号池计数 ─────────────────────────────────────────────────────────────
test('effectiveN: counts switchable backups (excludes active/expired/switchable:false)', () => {
  const now = Date.parse('2026-06-25T13:00:00Z');
  const accounts = {
    a: { active: true },
    b: {},
    c: { switchable: false },
    d: { token_expires_at: '2020-01-01T00:00:00Z' },
    e: { token_expires_at: '2030-01-01T00:00:00Z' },
  };
  const r = effectiveN(accounts, now);
  assert.equal(r.backups, 4);
  assert.equal(r.switchable, 2);
  assert.equal(r.effective_n, 3);
});

test('effectiveN: null/empty → single account (effective_n=1)', () => {
  assert.equal(effectiveN(null, Date.now()).effective_n, 1);
  assert.equal(effectiveN({}, Date.now()).effective_n, 1);
});

// ── tokenExpired SSOT 谓词 ───────────────────────────────────────────────────────────
test('tokenExpired: SSOT predicate (parseable & < now → expired; else not)', () => {
  const now = Date.parse('2026-06-25T13:00:00Z');
  assert.equal(tokenExpired('2020-01-01T00:00:00Z', now), true);
  assert.equal(tokenExpired(Date.parse('2020-01-01T00:00:00Z'), now), true);
  assert.equal(tokenExpired('2030-01-01T00:00:00Z', now), false);
  assert.equal(tokenExpired(null, now), false);
  assert.equal(tokenExpired(undefined, now), false);
  assert.equal(tokenExpired('not-a-date', now), false);
  assert.equal(tokenExpired('', now), false);
});

// ── invariant: window pct echo + N≥1 ───────────────────────────────────────────────
test('pacing: echoes window pct + effective_n always ≥ 1', () => {
  const a = pacingAdvice(
    { five_hour: { used_percentage: 55 }, seven_day: { used_percentage: 33 } },
    { nowSec: NOW_SEC, effectiveN: 0 },
  );
  assert.equal(a.window_5h_pct, 55);
  assert.equal(a.window_7d_pct, 33);
  assert.ok(a.effective_n >= 1);
});
