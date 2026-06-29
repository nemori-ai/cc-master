// account-select.test.ts — @ccm/engine·account 选号算法（Phase 1 移植）契约门。
//   钉住打分数学（W5=0.4/W7=0.6）+ 7d 硬闸 + 临到期降权 + source/observed 信任折扣 + 二值恢复 +
//   NONE_ALL_EXHAUSTED vs NONE_NO_CANDIDATES 区分 + switchable/expired/active 排除 + 全员逼顶地板用「到期降权之前」分 + tiebreak。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { account } from '../dist/index.mjs';

const SCHEMA = 'cc-master/accounts/v1';
const NOW = '2026-06-25T13:00:00Z';
const FUTURE = '2026-06-25T18:00:00Z'; // reset 未到（now 之前）
const PAST = '2026-06-25T10:00:00Z'; // reset 已过（now 之后）
const FAR = '2027-06-25T13:00:00Z'; // token 远期不到期
const SOON = '2026-06-30T13:00:00Z'; // 5 天后到期（≤14 天预警）
const EXPIRED = '2026-06-20T13:00:00Z'; // token 已过期

function reg(accounts: Record<string, unknown>) {
  return { schema: SCHEMA, accounts };
}
function vault(email: string) {
  return { kind: 'keychain', service: 's', account: email };
}

// ── recoveredWindow（二值恢复·不插值）────────────────────────────────────────────
test('recoveredWindow: past reset → fully recovered (used 0)', () => {
  assert.equal(account.recoveredWindow({ used_pct: 40, resets_at: PAST }, NOW).usedPct, 0);
});
test('recoveredWindow: before reset → conservative original used_pct', () => {
  assert.equal(account.recoveredWindow({ used_pct: 40, resets_at: FUTURE }, NOW).usedPct, 40);
});
test('recoveredWindow: missing used_pct → conservative 100 (worst)', () => {
  assert.equal(account.recoveredWindow({}, NOW).usedPct, 100);
});
test('recoveredWindow: non-strict resets_at → cannot judge → conservative (before reset)', () => {
  assert.equal(account.recoveredWindow({ used_pct: 40, resets_at: 'bad' }, NOW).usedPct, 40);
});

// ── accountScore（W5/W7 + 7d 硬闸 + trust）────────────────────────────────────────
test('accountScore: W5*avail5h + W7*avail7d', () => {
  const s = account.accountScore(
    {
      last_switch_out: {
        '5h': { used_pct: 20, resets_at: FUTURE },
        '7d': { used_pct: 10, resets_at: FUTURE },
      },
    },
    NOW,
  );
  // avail5h=80, avail7d=90 → 0.4*80 + 0.6*90 = 86.
  assert.equal(s.score, 86);
  assert.equal(s.gated, false);
  assert.equal(s.trust, 1);
});
test('accountScore: 7d ≥ 85% hard gate → gated, score = SCORE_UNUSABLE', () => {
  const s = account.accountScore(
    {
      last_switch_out: {
        '5h': { used_pct: 0, resets_at: FUTURE },
        '7d': { used_pct: 90, resets_at: FUTURE },
      },
    },
    NOW,
  );
  assert.equal(s.gated, true);
  assert.equal(s.score, -1);
});
test('accountScore: local-derived-approx source discounts trust to 0.85', () => {
  const s = account.accountScore(
    {
      last_switch_out: {
        '5h': { used_pct: 20, resets_at: FUTURE, source: 'local-derived-approx' },
        '7d': { used_pct: 10, resets_at: FUTURE, source: 'account' },
      },
    },
    NOW,
  );
  assert.equal(s.trust, 0.85);
  assert.ok(Math.abs(s.score - 86 * 0.85) < 1e-9);
});

// ── selectAccount：空池 / 新号满血 / 排除 ─────────────────────────────────────────
test('selectAccount: empty registry → NONE_EMPTY_REGISTRY', () => {
  assert.equal(account.selectAccount(reg({}), NOW).reason, 'NONE_EMPTY_REGISTRY');
});

test('selectAccount: a fresh account (no history) is full-score and selected', () => {
  const r = account.selectAccount(
    reg({ 'a@x.com': { vault: vault('a@x.com'), active: false } }),
    NOW,
  );
  assert.equal(r.reason, 'SELECTED');
  assert.equal(r.selected, 'a@x.com');
  const top = r.candidates.find((c) => c.email === 'a@x.com');
  assert.equal(top?.fresh, true);
  assert.equal(top?.score, 100); // W5*100 + W7*100
});

test('selectAccount: fresh beats a partially-used account', () => {
  const r = account.selectAccount(
    reg({
      fresh: { vault: vault('fresh'), active: false },
      used: {
        vault: vault('used'),
        active: false,
        last_switch_out: {
          '5h': { used_pct: 50, resets_at: FUTURE },
          '7d': { used_pct: 50, resets_at: FUTURE },
        },
      },
    }),
    NOW,
  );
  assert.equal(r.selected, 'fresh');
});

test('selectAccount: active account is excluded; only-active pool → NONE_NO_CANDIDATES', () => {
  const r = account.selectAccount(
    reg({ 'a@x.com': { vault: vault('a@x.com'), active: true } }),
    NOW,
  );
  assert.equal(r.reason, 'NONE_NO_CANDIDATES');
  assert.equal(r.candidates.find((c) => c.email === 'a@x.com')?.active, true);
});

test('selectAccount: switchable:false excluded + warning; only backup → NONE_NO_CANDIDATES', () => {
  const r = account.selectAccount(
    reg({ 'a@x.com': { vault: vault('a@x.com'), active: false, switchable: false } }),
    NOW,
  );
  assert.equal(r.reason, 'NONE_NO_CANDIDATES');
  assert.ok(r.warnings.some((w) => /switchable:false/.test(w)));
  assert.equal(r.candidates.find((c) => c.email === 'a@x.com')?.notSwitchable, true);
});

test('selectAccount: expired token excluded (strict-ISO); only backup → NONE_NO_CANDIDATES', () => {
  const r = account.selectAccount(
    reg({ 'a@x.com': { vault: vault('a@x.com'), active: false, token_expires_at: EXPIRED } }),
    NOW,
  );
  assert.equal(r.reason, 'NONE_NO_CANDIDATES');
  assert.equal(r.candidates.find((c) => c.email === 'a@x.com')?.expired, true);
});

// ── reason 区分：ALL_EXHAUSTED（纯逼顶）vs NO_CANDIDATES（混合）────────────────────
test('selectAccount: all non-active backups 7d-gated → NONE_ALL_EXHAUSTED (exit-3 semantics)', () => {
  const gated = (e: string) => ({
    vault: vault(e),
    active: false,
    last_switch_out: {
      '5h': { used_pct: 0, resets_at: FUTURE },
      '7d': { used_pct: 90, resets_at: FUTURE },
    },
  });
  const r = account.selectAccount(
    reg({ 'a@x.com': gated('a@x.com'), 'b@x.com': gated('b@x.com') }),
    NOW,
  );
  assert.equal(r.reason, 'NONE_ALL_EXHAUSTED');
  assert.ok(r.candidates.every((c) => c.gated));
});

test('selectAccount: mixed (gated + expired) → NONE_NO_CANDIDATES (fixable, not just wait-reset)', () => {
  const r = account.selectAccount(
    reg({
      gated: {
        vault: vault('gated'),
        active: false,
        last_switch_out: {
          '5h': { used_pct: 0, resets_at: FUTURE },
          '7d': { used_pct: 90, resets_at: FUTURE },
        },
      },
      exp: { vault: vault('exp'), active: false, token_expires_at: EXPIRED },
    }),
    NOW,
  );
  assert.equal(r.reason, 'NONE_NO_CANDIDATES');
});

// ── observed_quota 弱信号兜底（折扣 0.7 + 告警）──────────────────────────────────
test('selectAccount: last_observed_quota fallback is discounted (0.7) + warned', () => {
  const r = account.selectAccount(
    reg({
      a: {
        vault: vault('a'),
        active: false,
        last_observed_quota: {
          '5h': { used_pct: 20, resets_at: FUTURE },
          '7d': { used_pct: 10, resets_at: FUTURE },
        },
      },
    }),
    NOW,
  );
  assert.equal(r.selected, 'a');
  const c = r.candidates.find((x) => x.email === 'a');
  assert.equal(c?.observedFallback, true);
  assert.ok(Math.abs((c?.score ?? 0) - 86 * 0.7) < 1e-9); // raw 86 * OBSERVED_QUOTA_TRUST
  assert.ok(r.warnings.some((w) => /last_observed_quota/.test(w)));
});

// ── 临近到期降权（-40）+ 不与「配额逼顶」混淆（codex round#2）───────────────────
test('selectAccount: near-expiry account is penalized (-40) + warned, still selectable', () => {
  const r = account.selectAccount(
    reg({ a: { vault: vault('a'), active: false, token_expires_at: SOON } }),
    NOW,
  );
  assert.equal(r.selected, 'a');
  const c = r.candidates.find((x) => x.email === 'a');
  assert.equal(c?.score, 100 - 40); // freshFull(100) - EXPIRY_PENALTY(40)
  assert.equal(c?.expiringSoon, true);
  assert.ok(r.warnings.some((w) => /天后到期/.test(w)));
});

test('selectAccount: healthy-quota-but-near-expiry is NOT misreported as ALL_EXHAUSTED', () => {
  // 配额 70/70 → 配额分 30；临近到期 → finalScore 30-40 = -10（负），但地板判用「降权前」的 30 > 0。
  const r = account.selectAccount(
    reg({
      a: {
        vault: vault('a'),
        active: false,
        token_expires_at: SOON,
        last_switch_out: {
          '5h': { used_pct: 70, resets_at: FUTURE },
          '7d': { used_pct: 70, resets_at: FUTURE },
        },
      },
    }),
    NOW,
  );
  assert.equal(r.reason, 'SELECTED', 'near-expiry only降权·不该误判全员逼顶 exit-3');
  const c = r.candidates.find((x) => x.email === 'a');
  assert.equal(c?.score, 30 - 40); // 配额分 30 − 罚 40
  assert.equal(c?.scoreForExhaustionFloor, 30); // 地板用「到期降权之前」的配额分
});

// ── tiebreak：分相同则 earliestReset 更早者优 ─────────────────────────────────────
test('selectAccount: equal scores → earlier earliestReset wins (tiebreak)', () => {
  const mk = (e: string, r5: string) => ({
    vault: vault(e),
    active: false,
    last_switch_out: {
      '5h': { used_pct: 50, resets_at: r5 },
      '7d': { used_pct: 50, resets_at: '2026-07-01T00:00:00Z' },
    },
  });
  const r = account.selectAccount(
    reg({
      later: mk('later', '2026-06-25T15:00:00Z'),
      earlier: mk('earlier', '2026-06-25T14:00:00Z'),
    }),
    NOW,
  );
  assert.equal(r.selected, 'earlier');
});

// ── 细粒度谓词 ────────────────────────────────────────────────────────────────────
test('tokenExpired: strict-ISO lexicographic; missing/non-strict → not expired (conservative)', () => {
  assert.equal(account.tokenExpired({ token_expires_at: EXPIRED }, NOW), true);
  assert.equal(account.tokenExpired({ token_expires_at: FAR }, NOW), false);
  assert.equal(account.tokenExpired({}, NOW), false);
  assert.equal(account.tokenExpired({ token_expires_at: '2026-06-20' }, NOW), false); // 非严格 → 不误排
});

test('daysUntil / isStrictIso helpers', () => {
  assert.equal(account.isStrictIso(NOW), true);
  assert.equal(account.isStrictIso('2026-06-25'), false);
  assert.equal(Math.round(account.daysUntil(SOON, NOW) ?? -1), 5);
  assert.equal(account.daysUntil('bad', NOW), null);
});

// ── envNum（env 覆写读取机制·module-load 固化外的可测点）──────────────────────────
test('envNum: reads env number, coerces, falls back on missing/bad', () => {
  const prev = process.env.CCM_TEST_NUM;
  try {
    delete process.env.CCM_TEST_NUM;
    assert.equal(account.envNum('CCM_TEST_NUM', 7), 7); // 缺 → 默认
    process.env.CCM_TEST_NUM = '42';
    assert.equal(account.envNum('CCM_TEST_NUM', 7), 42); // 有效 → 用之
    process.env.CCM_TEST_NUM = 'notanum';
    assert.equal(account.envNum('CCM_TEST_NUM', 7), 7); // 坏 → fail-safe 默认
  } finally {
    if (prev === undefined) delete process.env.CCM_TEST_NUM;
    else process.env.CCM_TEST_NUM = prev;
  }
});
