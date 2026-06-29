// account-select-loadbal.test.ts — @ccm/engine·LOADBAL §3.1 扩 select 契约门。
//   钉住两扩项**默认关闭、不破现有契约**，开启后：① reset-proximity 加分排序（烧快回血、留慢回血·叠加 score、
//   不进 exhaustion floor、过 reset / 超 horizon 不加分）；② reserve-floor 硬约束（留 ≥N 满血储备、无非储备则让位、
//   不破 7d 硬闸）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { account } from '../dist/index.mjs';

const SCHEMA = 'cc-master/accounts/v1';
const NOW = '2026-06-25T13:00:00Z';
const R_1H = '2026-06-25T14:00:00Z'; // 1h 后 reset（近·易逝）
const R_20H = '2026-06-26T09:00:00Z'; // 20h 后 reset（horizon 内·远端）
const R_30H = '2026-06-26T19:00:00Z'; // 30h 后 reset（超 24h horizon）
const PAST = '2026-06-25T10:00:00Z'; // reset 已过
const FAR = '2026-07-15T00:00:00Z'; // 远期 7d reset（让 earliestReset = 5h reset）

function reg(accounts: Record<string, unknown>) {
  return { schema: SCHEMA, accounts };
}
function vault(email: string) {
  return { kind: 'keychain', service: 's', account: email };
}
// 用量号：5h/7d 各 used_pct·5h reset 可调（proximity 用）·7d reset 远（不抢 earliestReset）。
function used(email: string, pct: number, reset5h: string) {
  return {
    vault: vault(email),
    active: false,
    last_switch_out: {
      '5h': { used_pct: pct, resets_at: reset5h },
      '7d': { used_pct: pct, resets_at: FAR },
    },
  };
}

// ── 默认关闭：行为与现有 select 一致（高 base 分 / 满血优先）─────────────────────────
test('LOADBAL knobs OFF by default → reset-proximity has no effect (higher base wins)', () => {
  // A：base 70（used 30）近 reset；B：base 80（used 20）远 reset。默认 proximity=0 → B（高 base）赢。
  const r = account.selectAccount(reg({ A: used('A', 30, R_1H), B: used('B', 20, R_20H) }), NOW);
  assert.equal(r.selected, 'B');
  assert.equal(r.candidates.find((c) => c.email === 'A')?.resetProximityBonus, 0);
});

test('LOADBAL knobs OFF by default → fresh beats partially-used (reserve-floor inert)', () => {
  const r = account.selectAccount(
    reg({ fresh: { vault: vault('fresh'), active: false }, u: used('u', 50, FAR) }),
    NOW,
  );
  assert.equal(r.selected, 'fresh');
});

// ── ① reset-proximity：近 reset 加分翻盘（烧快回血的）────────────────────────────────
test('reset-proximity ON → near-reset account wins despite lower base score', () => {
  // A base 70 + 近 reset 大加分；B base 80 + 远端小加分。weight 30 → A 反超。
  const r = account.selectAccount(reg({ A: used('A', 30, R_1H), B: used('B', 20, R_20H) }), NOW, {
    resetProximityWeight: 30,
    resetProximityHorizonH: 24,
  });
  assert.equal(r.selected, 'A');
  const a = r.candidates.find((c) => c.email === 'A');
  const b = r.candidates.find((c) => c.email === 'B');
  assert.ok((a?.resetProximityBonus ?? 0) > (b?.resetProximityBonus ?? 0));
  assert.ok((a?.resetProximityBonus ?? 0) > 25); // ~28.75
});

test('reset-proximity bonus stacks into score but NOT into exhaustion floor', () => {
  const r = account.selectAccount(reg({ a: used('a', 50, R_1H) }), NOW, {
    resetProximityWeight: 30,
    resetProximityHorizonH: 24,
  });
  const c = r.candidates.find((x) => x.email === 'a');
  assert.ok((c?.resetProximityBonus ?? 0) > 0);
  assert.equal(c?.scoreForExhaustionFloor, 50); // 配额分（base·不含 proximity）
  assert.ok((c?.score ?? 0) > 50); // score 含 proximity 加分
});

test('reset-proximity: past reset (already recovered) → no bonus', () => {
  // 5h reset 已过 → 已回血、headroom 不再易逝 → 0 加分。
  const r = account.selectAccount(reg({ a: used('a', 50, PAST) }), NOW, {
    resetProximityWeight: 30,
  });
  assert.equal(r.candidates.find((c) => c.email === 'a')?.resetProximityBonus, 0);
});

test('reset-proximity: reset beyond horizon → no bonus', () => {
  // 5h reset 30h 后（超 24h horizon）→ 不急 → 0 加分。
  const r = account.selectAccount(reg({ a: used('a', 50, R_30H) }), NOW, {
    resetProximityWeight: 30,
    resetProximityHorizonH: 24,
  });
  assert.equal(r.candidates.find((c) => c.email === 'a')?.resetProximityBonus, 0);
});

// ── ② reserve-floor：留满血储备 ─────────────────────────────────────────────────────
test('reserve-floor=1 → preserve the lone full-blood reserve, switch into non-reserve', () => {
  const r = account.selectAccount(
    reg({ fresh: { vault: vault('fresh'), active: false }, u: used('u', 50, FAR) }),
    NOW,
    { reserveFloor: 1 },
  );
  assert.equal(r.selected, 'u'); // 满血 fresh 留作储备 → 切非储备 u
  const fresh = r.candidates.find((c) => c.email === 'fresh');
  assert.equal(fresh?.isReserve, true);
  assert.equal(fresh?.reserveHeld, true);
  assert.ok(r.warnings.some((w) => /reserve-floor/.test(w)));
});

test('reserve-floor=1 with 2 reserves → free to pick best reserve (floor not breached)', () => {
  const r = account.selectAccount(
    reg({
      'a-fresh': { vault: vault('a-fresh'), active: false },
      'b-fresh': { vault: vault('b-fresh'), active: false },
    }),
    NOW,
    { reserveFloor: 1 },
  );
  assert.equal(r.selected, 'a-fresh'); // 2 储备 > floor 1 → 自由选最优（tiebreak email 升序）
  assert.ok(!r.warnings.some((w) => /reserve-floor/.test(w)));
});

test('reserve-floor floor yields when no non-reserve candidate (must switch somewhere)', () => {
  const r = account.selectAccount(
    reg({ onlyFresh: { vault: vault('onlyFresh'), active: false } }),
    NOW,
    { reserveFloor: 1 },
  );
  assert.equal(r.selected, 'onlyFresh'); // 无非储备可退 → floor 让位
  assert.ok(!r.warnings.some((w) => /reserve-floor/.test(w)));
});

test('reserve-floor=2 with 2 reserves + 1 non-reserve → pick non-reserve to keep 2 reserves', () => {
  const r = account.selectAccount(
    reg({
      fa: { vault: vault('fa'), active: false },
      fb: { vault: vault('fb'), active: false },
      u: used('u', 50, FAR),
    }),
    NOW,
    { reserveFloor: 2 },
  );
  assert.equal(r.selected, 'u');
});

test('reserve-floor + proximity do NOT bypass 7d hard gate (all gated → ALL_EXHAUSTED)', () => {
  const gated = (e: string) => ({
    vault: vault(e),
    active: false,
    last_switch_out: {
      '5h': { used_pct: 0, resets_at: R_1H },
      '7d': { used_pct: 90, resets_at: FAR },
    },
  });
  const r = account.selectAccount(reg({ a: gated('a'), b: gated('b') }), NOW, {
    reserveFloor: 1,
    resetProximityWeight: 30,
  });
  assert.equal(r.reason, 'NONE_ALL_EXHAUSTED');
  assert.ok(r.candidates.every((c) => c.gated));
});
