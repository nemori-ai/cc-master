// account-predict.test.ts — @ccm/engine·LOADBAL §2 inactive 号用量预测契约门。
//   钉住：inactive「冻结→归零」(复用 recoveredWindow) + active 号 API 权威不预测 + 激活自愈（ground truth 覆盖预测）
//   + fresh/observed 降级 + predictPoolUsage 的 switchable 分类与 active 权威匹配。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { account } from '../dist/index.mjs';

const SCHEMA = 'cc-master/accounts/v1';
const NOW = '2026-06-25T13:00:00Z';
const FUTURE = '2026-06-25T18:00:00Z'; // reset 未到
const PAST = '2026-06-25T10:00:00Z'; // reset 已过
const EXPIRED = '2026-06-20T13:00:00Z';

function vault(email: string) {
  return { kind: 'keychain', service: 's', account: email };
}

// ── inactive 预测：冻结在切出 used_pct（reset 未到）──────────────────────────────────
test('predictAccountUsage: inactive frozen at switch-out used_pct before reset', () => {
  const p = account.predictAccountUsage(
    {
      active: false,
      last_switch_out: {
        '5h': { used_pct: 40, resets_at: FUTURE },
        '7d': { used_pct: 30, resets_at: FUTURE },
      },
    },
    { now: NOW },
  );
  assert.equal(p.fiveHour.usedPct, 40);
  assert.equal(p.sevenDay.usedPct, 30);
  assert.equal(p.fiveHour.authoritative, false);
  assert.equal(p.fiveHour.source, 'switch-out-frozen');
  assert.equal(p.active, false);
});

// ── inactive 预测：到 resets_at 归零（reset 已过 → 满血 0）─────────────────────────────
test('predictAccountUsage: inactive recovers to 0 after reset (freeze→zero)', () => {
  const p = account.predictAccountUsage(
    {
      active: false,
      last_switch_out: {
        '5h': { used_pct: 80, resets_at: PAST },
        '7d': { used_pct: 50, resets_at: FUTURE },
      },
    },
    { now: NOW },
  );
  assert.equal(p.fiveHour.usedPct, 0); // 5h reset 已过 → 归零
  assert.equal(p.sevenDay.usedPct, 50); // 7d reset 未到 → 冻结
});

// ── 无历史 → fresh（视满血 0）───────────────────────────────────────────────────────
test('predictAccountUsage: no history → fresh (used 0)', () => {
  const p = account.predictAccountUsage({ active: false }, { now: NOW });
  assert.equal(p.fiveHour.usedPct, 0);
  assert.equal(p.sevenDay.usedPct, 0);
  assert.equal(p.fiveHour.source, 'fresh');
});

// ── last_observed_quota 弱信号 fallback（无切出快照时）──────────────────────────────
test('predictAccountUsage: observed-frozen fallback when no switch-out snapshot', () => {
  const p = account.predictAccountUsage(
    {
      active: false,
      last_observed_quota: {
        '5h': { used_pct: 25, resets_at: FUTURE },
        '7d': { used_pct: 15, resets_at: FUTURE },
      },
    },
    { now: NOW },
  );
  assert.equal(p.fiveHour.usedPct, 25);
  assert.equal(p.fiveHour.source, 'observed-frozen');
});

// ── active + live → API 权威，不预测（覆盖陈旧快照）────────────────────────────────
test('predictAccountUsage: active + live signal → authoritative, overrides stale snapshot', () => {
  const p = account.predictAccountUsage(
    {
      active: true,
      // 陈旧切出快照（若预测会用它）——但 live 信号应覆盖。
      last_switch_out: {
        '5h': { used_pct: 40, resets_at: FUTURE },
        '7d': { used_pct: 30, resets_at: FUTURE },
      },
    },
    {
      now: NOW,
      live: { fiveHourPct: 55, sevenDayPct: 62, fiveHourResetsAt: FUTURE },
    },
  );
  assert.equal(p.fiveHour.usedPct, 55); // 权威 live·非陈旧 40
  assert.equal(p.sevenDay.usedPct, 62);
  assert.equal(p.fiveHour.authoritative, true);
  assert.equal(p.fiveHour.source, 'account-live');
  assert.equal(p.fiveHour.resetsAt, FUTURE);
});

// ── 关键自愈：inactive 预测 → 激活后 ground truth 覆盖 ────────────────────────────────
test('predictAccountUsage: self-heal — inactive prediction replaced by ground truth on activation', () => {
  const snapshot = {
    last_switch_out: {
      '5h': { used_pct: 40, resets_at: FUTURE },
      '7d': { used_pct: 30, resets_at: FUTURE },
    },
  };
  // inactive 期：用冻结预测（40/30）。
  const pInactive = account.predictAccountUsage({ active: false, ...snapshot }, { now: NOW });
  assert.equal(pInactive.sevenDay.usedPct, 30);
  assert.equal(pInactive.sevenDay.authoritative, false);
  // 真切回（active）+ 拿到 API 权威 75 → 立刻纠偏，不再用陈旧 30。
  const pActive = account.predictAccountUsage(
    { active: true, ...snapshot },
    { now: NOW, live: { sevenDayPct: 75 } },
  );
  assert.equal(pActive.sevenDay.usedPct, 75);
  assert.equal(pActive.sevenDay.authoritative, true);
});

// ── active 但无 live → 保守降级回预测（不假装权威）─────────────────────────────────
test('predictAccountUsage: active without live → degrades to prediction (not authoritative)', () => {
  const p = account.predictAccountUsage(
    {
      active: true,
      last_switch_out: {
        '5h': { used_pct: 40, resets_at: FUTURE },
        '7d': { used_pct: 30, resets_at: FUTURE },
      },
    },
    { now: NOW },
  );
  assert.equal(p.fiveHour.authoritative, false);
  assert.equal(p.fiveHour.usedPct, 40);
});

// ── live 部分（仅 5h）→ 5h 权威、7d 降级回预测 ────────────────────────────────────
test('predictAccountUsage: partial live (only 5h) → 5h authoritative, 7d predicted', () => {
  const p = account.predictAccountUsage(
    {
      active: true,
      last_switch_out: {
        '5h': { used_pct: 40, resets_at: FUTURE },
        '7d': { used_pct: 30, resets_at: FUTURE },
      },
    },
    { now: NOW, live: { fiveHourPct: 88 } },
  );
  assert.equal(p.fiveHour.usedPct, 88);
  assert.equal(p.fiveHour.authoritative, true);
  assert.equal(p.sevenDay.usedPct, 30); // 无 live 7d → 预测
  assert.equal(p.sevenDay.authoritative, false);
});

// ── predictPoolUsage：switchable 分类 + active 用 live ───────────────────────────────
test('predictPoolUsage: switchable classification + active uses live signal', () => {
  const reg = {
    schema: SCHEMA,
    accounts: {
      'active@x.com': {
        vault: vault('active@x.com'),
        active: true,
        last_switch_out: {
          '5h': { used_pct: 10, resets_at: FUTURE },
          '7d': { used_pct: 10, resets_at: FUTURE },
        },
      },
      'backup@x.com': {
        vault: vault('backup@x.com'),
        active: false,
        last_switch_out: {
          '5h': { used_pct: 20, resets_at: FUTURE },
          '7d': { used_pct: 25, resets_at: FUTURE },
        },
      },
      'broken@x.com': { vault: vault('broken@x.com'), active: false, switchable: false },
      'expired@x.com': { vault: vault('expired@x.com'), active: false, token_expires_at: EXPIRED },
    },
  };
  const preds = account.predictPoolUsage(reg, { now: NOW, live: { sevenDayPct: 70 } });
  const byEmail = Object.fromEntries(preds.map((p: { email: string }) => [p.email, p]));

  // active 号用 live 70（非陈旧 10）。
  assert.equal(byEmail['active@x.com'].sevenDay.usedPct, 70);
  assert.equal(byEmail['active@x.com'].sevenDay.authoritative, true);
  assert.equal(byEmail['active@x.com'].switchable, false); // active 自身不可切入

  // backup：预测 + 可切入。
  assert.equal(byEmail['backup@x.com'].switchable, true);
  assert.equal(byEmail['backup@x.com'].sevenDay.usedPct, 25);

  // switchable:false / expired → 不可切入。
  assert.equal(byEmail['broken@x.com'].switchable, false);
  assert.equal(byEmail['expired@x.com'].switchable, false);
  assert.equal(byEmail['expired@x.com'].expired, true);
});

// ── predictPoolUsage：liveByEmail 显式覆盖（优先于按 active 匹配的 live）────────────────
test('predictPoolUsage: liveByEmail explicitly overrides per-account prediction', () => {
  const reg = {
    schema: SCHEMA,
    accounts: {
      'a@x.com': {
        vault: vault('a@x.com'),
        active: false,
        last_switch_out: {
          '5h': { used_pct: 20, resets_at: FUTURE },
          '7d': { used_pct: 20, resets_at: FUTURE },
        },
      },
    },
  };
  const preds = account.predictPoolUsage(reg, {
    now: NOW,
    liveByEmail: { 'a@x.com': { sevenDayPct: 99 } },
  });
  assert.equal(preds[0].sevenDay.usedPct, 99);
  assert.equal(preds[0].sevenDay.authoritative, true);
});
