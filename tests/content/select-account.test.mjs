// select-account.test.mjs — A2 T2：选号调度算法的 node 测试。
//
// 覆盖（设计稿 §B + 任务卡要求）：
//   过 reset 满血 / 未过 reset 保守（不插值）/ 7d 硬闸排除 / 无历史新号优先 /
//   临到期降权 / 全员逼顶 NONE_ALL_EXHAUSTED / source 降信任 / active 跳过 / token 过期跳过 /
//   resets_at tiebreak / 空 registry。
// 全部注入固定 now（绝不用真实时间·测试可复现）。
//
// teeth：把 select-account.js 的「7d 硬闸」分支注释掉 → 「7d 硬闸排除」断言应 FAIL。
//   （手工验证步骤见任务报告；本测试在硬闸生效时断言「7d 逼顶号不被选中且 gated」。）
//
// 接进 run-tests.sh 的 node 段（它 `find tests -name '*.test.mjs'`）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const MOD = join(ROOT, 'skills/account-management/scripts/select-account.js');
const { selectAccount, recoveredWindow, tokenExpired } = require(MOD);
const { SCHEMA } = require(join(ROOT, 'skills/account-management/scripts/accounts-lib.js'));

// 固定 now（所有测试共用，保证可复现）。2026-06-17T12:00:00Z。
const NOW = '2026-06-17T12:00:00Z';

// 工厂：构造一个含若干号的 registry（每个测试拿独立副本）。
function reg(accounts) {
  return { schema: SCHEMA, updated_at: NOW, accounts };
}

// 一个「窗口快照」工厂。
function win(used_pct, resets_at, source) {
  const w = { used_pct, resets_at };
  if (source !== undefined) w.source = source;
  return w;
}

// 一个标准 entry（非 active、有切出快照）。
function entry({ active = false, lso = null, expires = '2027-06-17T10:00:00Z' } = {}) {
  return {
    vault: { kind: 'keychain', service: 'cc-master-oauth', account: 'x' },
    token_expires_at: expires,
    active,
    last_switch_out: lso,
  };
}

// ── recoveredWindow：单窗口恢复度二值版（§B.2，不插值）─────────────────────────────────────────────
test('recoveredWindow: 过 reset → 满血 used=0', () => {
  // resets_at 早于 now → 已过 reset。
  const r = recoveredWindow(win(90, '2026-06-17T11:00:00Z', 'account'), NOW);
  assert.equal(r.usedPct, 0);
});

test('recoveredWindow: 未过 reset → 保守用原 used_pct（不插值，不假设线性恢复）', () => {
  // resets_at 晚于 now → 未过 reset。账户口径无 burn → 保守仍是切出时 used_pct。
  const r = recoveredWindow(win(90, '2026-06-17T13:00:00Z', 'account'), NOW);
  assert.equal(r.usedPct, 90); // 绝不插值成 < 90（否则就是假设了恢复）。
});

test('recoveredWindow: resets_at 非严格 ISO（不可比）→ 保守按未过 reset 处理', () => {
  const r = recoveredWindow(win(70, '2026-06-17T13:00Z', 'account'), NOW); // 缺秒。
  assert.equal(r.usedPct, 70); // 不可比 → 保守不当满血。
});

// ── 过 reset 满血：两号都过 reset，used_pct 高者 reset 后也满血、靠别的区分 ──────────────────────────
test('过 reset 满血：切出时用量高但已过 reset 的号 = 满血、被正常纳入候选', () => {
  const r = reg({
    'a@x.com': entry({
      lso: {
        at: '2026-06-17T09:00:00Z',
        '5h': win(95, '2026-06-17T10:00:00Z', 'account'), // 已过 reset → 满血。
        '7d': win(60, '2026-06-23T10:00:00Z', 'account'), // 未过 reset → 用 60。
      },
    }),
  });
  const res = selectAccount(r, NOW);
  assert.equal(res.reason, 'SELECTED');
  assert.equal(res.selected, 'a@x.com');
  const cand = res.candidates.find((c) => c.email === 'a@x.com');
  assert.equal(cand.p5, 0); // 5h 已过 reset → 0。
  assert.equal(cand.p7, 60); // 7d 未过 reset → 保守 60。
});

// ── 未过 reset 保守：两号都未过 reset，比切出时 used_pct（低者优）──────────────────────────────────
test('未过 reset 保守：都未过 reset 时按切出 used_pct 比，低用量者优', () => {
  const r = reg({
    'low@x.com': entry({
      lso: {
        at: '2026-06-17T09:00:00Z',
        '5h': win(30, '2026-06-17T14:00:00Z', 'account'),
        '7d': win(30, '2026-06-24T09:00:00Z', 'account'),
      },
    }),
    'high@x.com': entry({
      lso: {
        at: '2026-06-17T09:00:00Z',
        '5h': win(70, '2026-06-17T14:00:00Z', 'account'),
        '7d': win(70, '2026-06-24T09:00:00Z', 'account'),
      },
    }),
  });
  const res = selectAccount(r, NOW);
  assert.equal(res.selected, 'low@x.com'); // 用量低者剩余多 → 评分高。
});

// ── 7d 硬闸排除（teeth 锚点）──────────────────────────────────────────────────────────────────────
test('7d 硬闸排除：7d 估算 used ≥85% 的号被 gated，不被选中（teeth：注释硬闸→此断言 FAIL）', () => {
  const r = reg({
    'gated@x.com': entry({
      lso: {
        at: '2026-06-17T09:00:00Z',
        '5h': win(0, '2026-06-17T10:00:00Z', 'account'), // 5h 满血（过 reset）。
        '7d': win(90, '2026-06-24T09:00:00Z', 'account'), // 7d 未过 reset → 90 ≥ 85 硬闸。
      },
    }),
    'ok@x.com': entry({
      lso: {
        at: '2026-06-17T09:00:00Z',
        '5h': win(50, '2026-06-17T14:00:00Z', 'account'),
        '7d': win(50, '2026-06-24T09:00:00Z', 'account'),
      },
    }),
  });
  const res = selectAccount(r, NOW);
  // 即便 gated@x.com 的 5h 满血，7d 90% 硬闸 → 不该被选；选未逼顶的 ok@x.com。
  assert.equal(res.selected, 'ok@x.com');
  const g = res.candidates.find((c) => c.email === 'gated@x.com');
  assert.equal(g.gated, true); // teeth：硬闸被注释掉 → gated 会是 false，这条 FAIL。
});

// ── 无历史新号优先 ────────────────────────────────────────────────────────────────────────────────
test('无历史新号优先：last_switch_out==null 视满血，最优先于一个已部分消耗的号', () => {
  const r = reg({
    'fresh@x.com': entry({ lso: null }), // 无历史 → 视满血。
    'used@x.com': entry({
      lso: {
        at: '2026-06-17T09:00:00Z',
        '5h': win(40, '2026-06-17T14:00:00Z', 'account'),
        '7d': win(40, '2026-06-24T09:00:00Z', 'account'),
      },
    }),
  });
  const res = selectAccount(r, NOW);
  assert.equal(res.selected, 'fresh@x.com');
  const f = res.candidates.find((c) => c.email === 'fresh@x.com');
  assert.equal(f.fresh, true);
  assert.equal(f.avail5h, 100);
  assert.equal(f.avail7d, 100);
});

// ── last_observed_quota 弱信号兜底（优化①）────────────────────────────────────────────────────────
// 一个 entry 工厂：无 last_switch_out，但带 last_observed_quota（录号那刻 cc-usage 快照）。
function entryObserved({ loq = null, expires = '2027-06-17T10:00:00Z' } = {}) {
  return {
    vault: { kind: 'keychain', service: 'cc-master-oauth', account: 'x' },
    token_expires_at: expires,
    active: false,
    last_switch_out: null,            // 关键：从未由本工具切出。
    last_observed_quota: loq,
  };
}

test('last_observed_quota 兜底：无 last_switch_out 但有 observed quota → 用它当恢复依据（弱信号·observedFallback 标注）', () => {
  const r = reg({
    // observed quota 显示已用 50%、未过 reset → 保守 used 50 → 评分有限（且再打弱信号折扣）。
    'observed@x.com': entryObserved({
      loq: {
        at: '2026-06-17T09:00:00Z',
        '5h': win(50, '2026-06-17T14:00:00Z', 'account'),
        '7d': win(50, '2026-06-24T09:00:00Z', 'account'),
      },
    }),
  });
  const res = selectAccount(r, NOW);
  assert.equal(res.reason, 'SELECTED');
  assert.equal(res.selected, 'observed@x.com');
  const c = res.candidates.find((x) => x.email === 'observed@x.com');
  assert.equal(c.observedFallback, true);   // 标注它走了弱信号兜底分支。
  assert.equal(c.fresh, false);             // 不是「满血新号」——用了 observed quota 的真实用量。
  assert.equal(c.p5, 50);                   // 未过 reset → 保守 50（不当满血）。
  assert.ok(c.trust < 1.0);                 // 弱信号折扣 → trust 被拉低。
  assert.ok(res.warnings.some((w) => w.includes('observed@x.com') && w.includes('last_observed_quota')));
});

test('last_observed_quota 弱信号 < 真·满血新号：纯 fresh 号（无任何快照）反超 observed 号（即便 observed 用量也低）', () => {
  const r = reg({
    'fresh@x.com': entry({ lso: null }),    // 既无 last_switch_out 也无 observed → 视满血（分上界）。
    'observed@x.com': entryObserved({
      // observed 用量也很低（5h/7d 各 used 10），但弱信号折扣（×0.7）后仍 < 满血。
      loq: {
        at: '2026-06-17T09:00:00Z',
        '5h': win(10, '2026-06-17T14:00:00Z', 'account'),
        '7d': win(10, '2026-06-24T09:00:00Z', 'account'),
      },
    }),
  });
  const res = selectAccount(r, NOW);
  // fresh 满血分 = 100；observed avail 90/90 → 0.4*90+0.6*90=90，再 ×0.7=63 < 100 → fresh 胜。
  assert.equal(res.selected, 'fresh@x.com');
});

test('last_observed_quota 仍受 7d 硬闸约束：observed 显示 7d 逼顶 → gated、不被复活', () => {
  const r = reg({
    'gatedObs@x.com': entryObserved({
      loq: {
        at: '2026-06-17T09:00:00Z',
        '5h': win(0, '2026-06-17T10:00:00Z', 'account'),  // 5h 满血（过 reset）。
        '7d': win(92, '2026-06-24T09:00:00Z', 'account'), // 7d 92 ≥ 85 硬闸。
      },
    }),
    'ok@x.com': entry({
      lso: {
        at: '2026-06-17T09:00:00Z',
        '5h': win(40, '2026-06-17T14:00:00Z', 'account'),
        '7d': win(40, '2026-06-24T09:00:00Z', 'account'),
      },
    }),
  });
  const res = selectAccount(r, NOW);
  assert.equal(res.selected, 'ok@x.com');   // 折扣不复活被 7d 硬闸的 observed 号。
  const g = res.candidates.find((x) => x.email === 'gatedObs@x.com');
  assert.equal(g.gated, true);
});

test('last_observed_quota 兜底 < 真·last_switch_out：同用量下，有真切出快照的号胜过仅有 observed 的号', () => {
  const r = reg({
    'switchout@x.com': entry({
      lso: {                                // 真切出快照（高信任·trust 1.0）。
        at: '2026-06-17T09:00:00Z',
        '5h': win(30, '2026-06-17T14:00:00Z', 'account'),
        '7d': win(30, '2026-06-24T09:00:00Z', 'account'),
      },
    }),
    'observed@x.com': entryObserved({
      loq: {                                // 同用量的 observed 快照（弱信号·×0.7）。
        at: '2026-06-17T09:00:00Z',
        '5h': win(30, '2026-06-17T14:00:00Z', 'account'),
        '7d': win(30, '2026-06-24T09:00:00Z', 'account'),
      },
    }),
  });
  const res = selectAccount(r, NOW);
  // 用量全同，但 observed 走了弱信号折扣（×0.7）→ switchout 评分更高被选。
  assert.equal(res.selected, 'switchout@x.com');
});

// ── 临到期降权 ────────────────────────────────────────────────────────────────────────────────────
test('临到期降权：满血但 token 临近到期的号，被一个稍逊但不临到期的号反超', () => {
  const r = reg({
    'expiring@x.com': entry({
      lso: null, // 满血基准分 = W5*100+W7*100 = 100。
      expires: '2026-06-25T00:00:00Z', // 距 now 约 7.5 天 ≤ 14 天预警 → 减 40 分 → 60。
    }),
    'healthy@x.com': entry({
      // 稍逊但不临到期：5h/7d 各 used 20 → avail 80 → 评分 0.4*80+0.6*80 = 80。
      lso: {
        at: '2026-06-17T09:00:00Z',
        '5h': win(20, '2026-06-17T14:00:00Z', 'account'),
        '7d': win(20, '2026-06-24T09:00:00Z', 'account'),
      },
      expires: '2027-06-17T10:00:00Z',
    }),
  });
  const res = selectAccount(r, NOW);
  assert.equal(res.selected, 'healthy@x.com'); // 临到期号降权后（60）< healthy（80）。
  const e = res.candidates.find((c) => c.email === 'expiring@x.com');
  assert.equal(e.expiringSoon, true);
  assert.ok(res.warnings.some((w) => w.includes('expiring@x.com') && w.includes('到期')));
});

// ── 全员逼顶 NONE_ALL_EXHAUSTED ───────────────────────────────────────────────────────────────────
test('全员逼顶：所有备号 7d 都逼顶 → NONE_ALL_EXHAUSTED（surface 用户）', () => {
  const r = reg({
    'a@x.com': entry({
      lso: {
        at: '2026-06-17T09:00:00Z',
        '5h': win(0, '2026-06-17T10:00:00Z', 'account'),
        '7d': win(95, '2026-06-24T09:00:00Z', 'account'), // 7d 逼顶。
      },
    }),
    'b@x.com': entry({
      lso: {
        at: '2026-06-17T09:00:00Z',
        '5h': win(0, '2026-06-17T10:00:00Z', 'account'),
        '7d': win(88, '2026-06-24T09:00:00Z', 'account'), // 7d 逼顶。
      },
    }),
  });
  const res = selectAccount(r, NOW);
  assert.equal(res.selected, null);
  assert.equal(res.reason, 'NONE_ALL_EXHAUSTED');
  assert.ok(res.warnings.some((w) => w.includes('逼顶')));
});

// ── source 降信任 ─────────────────────────────────────────────────────────────────────────────────
test('source 降信任：local-derived-approx 来源号评分被折扣，被同样用量但 account 权威来源的号反超', () => {
  const r = reg({
    'approx@x.com': entry({
      lso: {
        at: '2026-06-17T09:00:00Z',
        '5h': win(30, '2026-06-17T14:00:00Z', 'local-derived-approx'),
        '7d': win(30, '2026-06-24T09:00:00Z', 'local-derived-approx'),
      },
    }),
    'authoritative@x.com': entry({
      lso: {
        at: '2026-06-17T09:00:00Z',
        '5h': win(30, '2026-06-17T14:00:00Z', 'account'),
        '7d': win(30, '2026-06-24T09:00:00Z', 'account'),
      },
    }),
  });
  const res = selectAccount(r, NOW);
  // 两号 raw 用量相同，但 approx 来源打了信任折扣（×0.85）→ authoritative 评分更高被选。
  assert.equal(res.selected, 'authoritative@x.com');
  const ap = res.candidates.find((c) => c.email === 'approx@x.com');
  assert.ok(ap.trust < 1.0);
  assert.ok(res.warnings.some((w) => w.includes('approx@x.com') && w.includes('local-derived-approx')));
});

// ── active 跳过 ───────────────────────────────────────────────────────────────────────────────────
test('active 跳过：当前 active 号不作切换目标', () => {
  const r = reg({
    'current@x.com': entry({ active: true, lso: null }), // active：跳过。
    'backup@x.com': entry({
      lso: {
        at: '2026-06-17T09:00:00Z',
        '5h': win(50, '2026-06-17T14:00:00Z', 'account'),
        '7d': win(50, '2026-06-24T09:00:00Z', 'account'),
      },
    }),
  });
  const res = selectAccount(r, NOW);
  assert.equal(res.selected, 'backup@x.com'); // 绝不选 active 的 current。
  const cur = res.candidates.find((c) => c.email === 'current@x.com');
  assert.equal(cur.active, true);
  assert.equal(cur.excludedReason, 'active');
});

test('active 跳过：只有一个 active 号（无备号）→ NONE_NO_CANDIDATES', () => {
  const r = reg({ 'only@x.com': entry({ active: true, lso: null }) });
  const res = selectAccount(r, NOW);
  assert.equal(res.selected, null);
  assert.equal(res.reason, 'NONE_NO_CANDIDATES');
});

// ── token 过期跳过 ────────────────────────────────────────────────────────────────────────────────
test('token 过期跳过：token_expires_at < now 的号被排除（切进去认证失败）', () => {
  const r = reg({
    'expired@x.com': entry({ lso: null, expires: '2026-06-10T00:00:00Z' }), // 已过期（< now）。
    'valid@x.com': entry({
      lso: {
        at: '2026-06-17T09:00:00Z',
        '5h': win(60, '2026-06-17T14:00:00Z', 'account'),
        '7d': win(60, '2026-06-24T09:00:00Z', 'account'),
      },
      expires: '2027-06-17T10:00:00Z',
    }),
  });
  const res = selectAccount(r, NOW);
  assert.equal(res.selected, 'valid@x.com'); // 绝不选已过期的 expired（即便它无历史本会最优先）。
  const ex = res.candidates.find((c) => c.email === 'expired@x.com');
  assert.equal(ex.expired, true);
  assert.equal(ex.excludedReason, 'expired');
});

test('tokenExpired: 缺 / 非严格 ISO 的 token_expires_at → 保守当未过期（不误杀）', () => {
  assert.equal(tokenExpired({ token_expires_at: undefined }, NOW), false);
  assert.equal(tokenExpired({ token_expires_at: '2026-06-17T13:00Z' }, NOW), false); // 缺秒 → 不可比。
});

// ── resets_at tiebreak ────────────────────────────────────────────────────────────────────────────
test('resets_at tiebreak：评分相同时 reset 更早者优（更快彻底满血）', () => {
  const r = reg({
    'soon@x.com': entry({
      lso: {
        at: '2026-06-17T09:00:00Z',
        '5h': win(50, '2026-06-17T13:00:00Z', 'account'), // reset 更早。
        '7d': win(50, '2026-06-20T09:00:00Z', 'account'),
      },
    }),
    'later@x.com': entry({
      lso: {
        at: '2026-06-17T09:00:00Z',
        '5h': win(50, '2026-06-17T18:00:00Z', 'account'), // reset 更晚。
        '7d': win(50, '2026-06-24T09:00:00Z', 'account'),
      },
    }),
  });
  const res = selectAccount(r, NOW);
  // 两号 used_pct 全同 → 评分相同 → tiebreak 取 earliestReset 更早的 soon@x.com。
  assert.equal(res.selected, 'soon@x.com');
});

// ── 空 registry / 边界 ────────────────────────────────────────────────────────────────────────────
test('空 registry：accounts {} → NONE_EMPTY_REGISTRY', () => {
  const res = selectAccount(reg({}), NOW);
  assert.equal(res.selected, null);
  assert.equal(res.reason, 'NONE_EMPTY_REGISTRY');
});

test('非对象 reg → 当空池降级（不抛）', () => {
  const res = selectAccount(null, NOW);
  assert.equal(res.selected, null);
  assert.equal(res.reason, 'NONE_EMPTY_REGISTRY');
});

test('候选排名：candidates 含被排除项（active/expired）并标注，selected 是评分最高的可选号', () => {
  const r = reg({
    'active@x.com': entry({ active: true, lso: null }),
    'expired@x.com': entry({ lso: null, expires: '2026-06-10T00:00:00Z' }),
    'best@x.com': entry({ lso: null }), // 满血。
  });
  const res = selectAccount(r, NOW);
  assert.equal(res.selected, 'best@x.com');
  // candidates 把三号都列出（含排除项），best 排第一。
  assert.equal(res.candidates[0].email, 'best@x.com');
  assert.ok(res.candidates.some((c) => c.email === 'active@x.com' && c.active));
  assert.ok(res.candidates.some((c) => c.email === 'expired@x.com' && c.expired));
});
