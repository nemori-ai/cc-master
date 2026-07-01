// handler-usage.test.ts — usage noun handler（handlers/usage.ts）契约门（ADR-015 §2.6·plan §5）。
//
// usage = 配额侧只读 advisory namespace（全 verb runRead·零写不变式）。本测试用 mkdtemp 临时 home +
//   真 leaf + 临时板/registry/sidecar，端到端验证：
//   · show     —— 无 registry → available:false 优雅降级（exit 0·非 1）；有 registry → 全备号快照 + as_of/snapshot_stale。
//   · advise   —— sidecar 缺 → hold + available:false（降级）；sidecar 在 + n>1 + 5h 临界 + 7d 余量 → switch + switch_candidate。
//   · task-cost —— 单任务 token（in+out）；--group-by 聚合 + coverage_pct；无 token/shell → N/A。
//   · 诚实字段齐全（source / confidence / available / as_of / coverage_pct / snapshot_stale）。
//
// 零写不变式断言：handler 跑完后临时板内容字节不变（usage 绝不落盘）。

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { Ctx } from '../src/handlers/_common.js';
import * as usageHandler from '../src/handlers/usage.js';
import * as io from '../src/io.js';

const EXIT = io.EXIT;

let TMPDIRS: string[] = [];
function mkTmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  TMPDIRS.push(d);
  return d;
}
afterEach(() => {
  for (const d of TMPDIRS) rmSync(d, { recursive: true, force: true });
  TMPDIRS = [];
});

interface SetupOpts {
  tasks?: unknown[];
  accounts?: unknown;
  sidecar?: unknown;
}
function setupHome(opts: SetupOpts = {}): { home: string; boardPath: string; rateCache: string } {
  const root = mkTmp('ccm-usage-');
  const home = join(root, '.claude', 'cc-master');
  // board-v2 布局：board 落 <home>/boards/（accounts.json + rate-cache sidecar 仍在 home 根·全局）。
  const boardsDir = join(home, 'boards');
  mkdirSync(boardsDir, { recursive: true });
  const boardPath = join(boardsDir, '2026-06-25-usage.board.json');
  const board = {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    goal: 'usage handler test',
    owner: { active: true, session_id: 'sid-u', heartbeat: '2026-06-25T08:00:00Z' },
    git: { worktree: '/repo/wt', branch: 'feat' },
    scheduling: { wip_limit: 4 },
    tasks: opts.tasks ?? [],
    log: [],
  };
  writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  if (opts.accounts !== undefined) {
    writeFileSync(
      join(home, 'accounts.json'),
      `${JSON.stringify({ schema: 'cc-master/accounts/v1', updated_at: '2026-06-25T08:00:00Z', accounts: opts.accounts }, null, 2)}\n`,
      'utf8',
    );
  }
  // 真实 sidecar 路径（statusline-capture.js / cc-usage.sh / usage-pacing.js hook 钉死的同一路径）：
  //   ${CC_MASTER_RATE_CACHE}（账户级 .cc-master-rate-limits.json）。**非** ${home}/usage-snapshot.json（旧错路径·P4 修复）。
  const rateCache = join(home, '.cc-master-rate-limits.json');
  if (opts.sidecar !== undefined) {
    writeFileSync(rateCache, `${JSON.stringify(opts.sidecar)}\n`, 'utf8');
  }
  return { home, boardPath, rateCache };
}

type TestCtx = Ctx & { outBuf: string[]; errBuf: string[] };
function mkCtx(
  home: string,
  boardPath: string | null,
  {
    values = {},
    flags = {},
    positionals = [],
    rateCache,
  }: {
    values?: Record<string, unknown>;
    flags?: Partial<Ctx['flags']>;
    positionals?: string[];
    rateCache?: string;
  } = {},
): TestCtx {
  const outBuf: string[] = [];
  const errBuf: string[] = [];
  return {
    values: { home, ...(boardPath ? { board: boardPath } : {}), ...values },
    positionals,
    flags: {
      json: false,
      dryRun: false,
      force: false,
      yes: false,
      quiet: false,
      verbose: false,
      color: false,
      ...flags,
    },
    sid: 'sid-u',
    // CC_MASTER_RATE_CACHE 必传——否则 readUsageSidecar 会回落到真实 $HOME/.claude/.cc-master-rate-limits.json
    //   （污染/读到宿主真 sidecar）。默认指向 home 下的真实文件名（setupHome 落盘处）。
    env: {
      CC_MASTER_HOME: home,
      CC_MASTER_RATE_CACHE: rateCache ?? join(home, '.cc-master-rate-limits.json'),
    },
    out: (s: string) => outBuf.push(s),
    err: (s: string) => errBuf.push(s),
    isTTY: true,
    outBuf,
    errBuf,
  };
}

// 一个 critical 5h + 7d 余量的 registry（含 active + 2 备号·c 的 7d 最低）。
const REGISTRY_3 = {
  'a@c.com': {
    active: true,
    vault: { kind: 'keychain', service: 'x', account: 'a@c.com' },
    last_observed_quota: {
      at: '2026-06-25T07:00:00Z',
      '5h': { used_pct: 92, resets_at: '2026-06-25T11:00:00Z' },
      '7d': { used_pct: 50, resets_at: '2026-07-01T00:00:00Z' },
    },
  },
  'b@c.com': {
    active: false,
    switchable: true,
    token_expires_at: '2027-01-01T00:00:00Z',
    vault: { kind: 'keychain', service: 'x', account: 'b@c.com' },
    last_switch_out: {
      at: '2026-06-24T09:00:00Z',
      '5h': { used_pct: 10, resets_at: '2026-06-24T13:00:00Z' },
      '7d': { used_pct: 30, resets_at: '2026-07-01T00:00:00Z' },
    },
  },
  'c@c.com': {
    active: false,
    switchable: true,
    token_expires_at: '2027-01-01T00:00:00Z',
    vault: { kind: 'keychain', service: 'x', account: 'c@c.com' },
    last_switch_out: {
      at: '2026-06-24T09:00:00Z',
      '5h': { used_pct: 5, resets_at: '2026-06-24T13:00:00Z' },
      '7d': { used_pct: 12, resets_at: '2026-07-01T00:00:00Z' },
    },
  },
};
// 真实 sidecar 形态（statusline-capture.js 写）：epoch-秒 resets_at / captured_at + number used_percentage。
//   captured_at 2026-06-25T09:00:00Z=1782378000；resets_at 取**远未来**（2030/2031），让窗口对 wall-clock now
//   绝不过期——这些 case 测的是 throttle/switch 单侧 verdict 逻辑，**非过期闸**（过期闸专测见末尾 #bug1 段，
//   注入固定 nowSec + resets_at<now）。否则 fixture reset 一旦落到运行时之前，过期闸正确地把 used% 判为 stale。
const SIDECAR_CRITICAL = {
  five_hour: { used_percentage: 92, resets_at: 1893456000 }, // 2030-01-01T00:00:00Z（远未来·不过期）
  seven_day: { used_percentage: 50, resets_at: 1925078400 }, // 2031-01-01T00:00:00Z
  captured_at: 1782378000,
};

// ══ usage show ═══════════════════════════════════════════════════════════════════════════════════

test('usage show with no registry degrades gracefully (available:false, exit 0)', () => {
  const { home, boardPath } = setupHome();
  const ctx = mkCtx(home, boardPath, { flags: { json: true } });
  const code = usageHandler.show(ctx);
  assert.equal(code, EXIT.OK, 'no-registry must be exit 0 not error');
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.ok, true);
  assert.equal(out.data.registry_present, false);
  assert.equal(out.data.effective_n, 1, 'no registry → single account effective_n=1');
  assert.equal(out.data.current.available, false);
});

test('usage show with registry lists all accounts with snapshot fields', () => {
  const { home, boardPath } = setupHome({ accounts: REGISTRY_3, sidecar: SIDECAR_CRITICAL });
  const ctx = mkCtx(home, boardPath, { flags: { json: true } });
  const code = usageHandler.show(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.registry_present, true);
  assert.equal(out.data.effective_n, 3, '1 active + 2 switchable backups');
  assert.equal(out.data.accounts.length, 3);
  // active 号排首。
  assert.equal(out.data.accounts[0].active, true);
  assert.equal(out.data.accounts[0].email, 'a@c.com');
  // 诚实字段：每个账号带 source / as_of / snapshot_stale。
  for (const a of out.data.accounts) {
    assert.equal(a.source, 'registry-snapshot');
    assert.equal(typeof a.snapshot_stale, 'boolean');
    assert.ok('as_of' in a);
    assert.ok('five_hour' in a && 'seven_day' in a);
  }
});

test('usage show: registry presence does NOT light up top-level available (round7 #P3)', () => {
  // registry 存在但 sidecar 缺失（当前账户信号不可得）→ data.available 必须反映当前信号（false），
  //   **不**被备号 registry 快照单独翻 true。registry 存在性由 registry_present + accounts 独立暴露（保持不变）。
  //   旧代码：`available = current.available || (backups!=null && accounts.length>0)` → registry 在就 true（错·
  //   把陈旧备号快照当成可用的「当前」配额信号）。修后 `available = current.available` → false。
  const { home, boardPath } = setupHome({ accounts: REGISTRY_3 }); // 有 registry·无 sidecar
  const ctx = mkCtx(home, boardPath, { flags: { json: true } });
  const code = usageHandler.show(ctx);
  assert.equal(code, EXIT.OK, 'no-sidecar degrade is exit 0');
  const out = JSON.parse(ctx.outBuf.join(''));
  // ★核心：当前信号不可得 → 顶层 available false（不被 registry 快照点亮）。
  assert.equal(out.data.available, false, 'no current signal → available:false (registry 不点亮)');
  assert.equal(out.data.current.available, false, 'current signal genuinely unavailable');
  // registry-存在性信号独立保持：registry_present:true + 3 个备号仍列出。
  assert.equal(out.data.registry_present, true, 'registry_present stays an independent signal');
  assert.equal(out.data.accounts.length, 3, 'backup accounts still listed independently');
});

// ── current 窗口过期闸（codex round-4 #bug1）─────────────────────────────────────────────────────
// show 此前「sidecar 存在就 available:true」无脑放行——即便 sidecar 的 resets_at < now（窗口已 reset·used% 陈旧）。
//   修复后 show 与 advise(pacingAdvice·引擎 pctOf) 口径一致：过期窗口（resets_at<now）used% 视 stale→null，
//   available 反映「≥1 个非过期窗口有有效 used%」（两窗都过期→available:false）。
//   ★用真实 Date.now()：过期 fixture 用**过去**的 epoch（2020·恒 < now），控制组用**远未来**（2030·恒 ≥ now）。
const SIDECAR_BOTH_EXPIRED = {
  five_hour: { used_percentage: 88, resets_at: 1577836800 }, // 2020-01-01T00:00:00Z（恒过去·已过期）
  seven_day: { used_percentage: 60, resets_at: 1577836800 }, // 2020-01-01（已过期）
  captured_at: 1577836800,
};
const SIDECAR_5H_EXPIRED_7D_FRESH = {
  five_hour: { used_percentage: 88, resets_at: 1577836800 }, // 已过期 → 5h used% 视 null
  seven_day: { used_percentage: 60, resets_at: 1893456000 }, // 2030-01-01（远未来·有效）
  captured_at: 1577836800,
};
const SIDECAR_FUTURE_FRESH = {
  five_hour: { used_percentage: 80, resets_at: 1893456000 }, // 2030-01-01（远未来·有效）
  seven_day: { used_percentage: 40, resets_at: 1925078400 }, // 2031-01-01（有效）
  captured_at: 1893456000,
};

test('usage show treats expired-window sidecar as stale (both windows expired → current.available:false)', () => {
  // sidecar 存在但两窗口 resets_at 均 < now → used% 全 stale → current.available:false（不当权威发出）。
  const { home, boardPath } = setupHome({ sidecar: SIDECAR_BOTH_EXPIRED });
  const ctx = mkCtx(home, boardPath, { flags: { json: true } });
  const code = usageHandler.show(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(
    out.data.current.available,
    false,
    'both windows expired (resets_at<now) → current NOT available (stale)',
  );
  // 过期窗口 used% 投影为 null（陈旧不可判）；resets_at 原样保留供透明。
  assert.equal(out.data.current.five_hour.used_percentage, null, 'expired 5h used% nulled (stale)');
  assert.equal(out.data.current.seven_day.used_percentage, null, 'expired 7d used% nulled (stale)');
  // 无 registry → 整体 available 也 false（与 current 一致·不被陈旧 sidecar 误标可用）。
  assert.equal(out.data.available, false, 'no registry + expired sidecar → overall unavailable');
  assert.equal(out.data.confidence, 'low');
});

test('usage show with one window expired keeps the fresh one (5h expired, 7d fresh → available via 7d)', () => {
  // 5h 过期、7d 仍有效 → available:true（≥1 非过期窗口有有效 used%）；5h used% null·7d used% 保留。
  const { home, boardPath } = setupHome({ sidecar: SIDECAR_5H_EXPIRED_7D_FRESH });
  const ctx = mkCtx(home, boardPath, { flags: { json: true } });
  usageHandler.show(ctx);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(
    out.data.current.available,
    true,
    '7d window fresh → current available (≥1 non-expired window valid)',
  );
  assert.equal(out.data.current.five_hour.used_percentage, null, 'expired 5h used% nulled');
  assert.equal(out.data.current.seven_day.used_percentage, 60, 'fresh 7d used% kept');
});

test('usage show CONTROL: non-expired sidecar (future resets_at) stays available:true', () => {
  // 控制组：两窗口 resets_at 均在未来 → used% 有效 → current.available:true（口径回归·确认过期闸不误杀新鲜数据）。
  const { home, boardPath } = setupHome({ sidecar: SIDECAR_FUTURE_FRESH });
  const ctx = mkCtx(home, boardPath, { flags: { json: true } });
  usageHandler.show(ctx);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.current.available, true, 'future resets_at → fresh → available');
  assert.equal(out.data.current.five_hour.used_percentage, 80, 'fresh 5h used% kept');
  assert.equal(out.data.current.seven_day.used_percentage, 40, 'fresh 7d used% kept');
  assert.equal(out.data.confidence, 'high');
});

test('usage show expiry gate is consistent with advise/pacingAdvice (same expired sidecar → both degrade)', () => {
  // 口径一致性回归：同一份过期 sidecar——show 的 current.available 与 advise 的 available 都该 false（两路径同源 pctOf）。
  //   防 sibling 漂移（round3 给 advise 加了过期闸·round4 给 show 补齐·此断言钉死二者不再分叉）。
  const { home, boardPath } = setupHome({ sidecar: SIDECAR_BOTH_EXPIRED });
  const showCtx = mkCtx(home, boardPath, { flags: { json: true } });
  const adviseCtx = mkCtx(home, boardPath, { flags: { json: true } });
  usageHandler.show(showCtx);
  usageHandler.advise(adviseCtx);
  const showOut = JSON.parse(showCtx.outBuf.join('')).data;
  const adviseOut = JSON.parse(adviseCtx.outBuf.join('')).data;
  assert.equal(showOut.current.available, false, 'show degrades on expired sidecar');
  assert.equal(adviseOut.available, false, 'advise degrades on expired sidecar (same expiry gate)');
  assert.equal(adviseOut.source, 'local-derived-approx', 'advise marks approx when expired');
});

test('usage show --effective-n override changes effective_n (#audit: was declared but ignored)', () => {
  // registry 有 3 号 → 自动 effective_n=3；--effective-n 7 覆写应胜出（此前 show 忽略此 flag）。
  const { home, boardPath } = setupHome({ accounts: REGISTRY_3 });
  const auto = mkCtx(home, boardPath, { flags: { json: true } });
  const override = mkCtx(home, boardPath, {
    values: { 'effective-n': '7' },
    flags: { json: true },
  });
  usageHandler.show(auto);
  usageHandler.show(override);
  assert.equal(JSON.parse(auto.outBuf.join('')).data.effective_n, 3, 'auto from registry');
  assert.equal(
    JSON.parse(override.outBuf.join('')).data.effective_n,
    7,
    '--effective-n override wins (flag now consumed)',
  );
});

test('usage show --accounts current filters to active only', () => {
  const { home, boardPath } = setupHome({ accounts: REGISTRY_3 });
  const ctx = mkCtx(home, boardPath, { values: { accounts: 'current' }, flags: { json: true } });
  usageHandler.show(ctx);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.accounts.length, 1);
  assert.equal(out.data.accounts[0].active, true);
});

test('usage show honors --home over CC_MASTER_HOME (registry read from --home·P2 regression)', () => {
  // Regression（Finding bug3·P2）：registryPath used to read只 CC_MASTER_HOME, ignoring --home →
  //   multi-home/dev/test 下读错 registry·effective_n 错·选错号。修复后 --home 优先（仿 estimate.ts resolveHomeDir）。
  // 两个 home：--home 指向 3 号 registry，CC_MASTER_HOME 指向另一只有 1 号的 registry。
  const flagHome = setupHome({ accounts: REGISTRY_3 });
  const envHome = setupHome({
    accounts: { 'solo@c.com': { active: true, vault: { kind: 'keychain' } } },
  });
  const ctx = mkCtx(envHome.home, flagHome.boardPath, {
    values: { home: flagHome.home }, // --home 显式指向 3 号 registry
    flags: { json: true },
  });
  // ctx.env.CC_MASTER_HOME 仍是 envHome（1 号）——若 --home 被忽略，effective_n 会是 1、账号是 solo@c.com。
  const code = usageHandler.show(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.registry_present, true);
  assert.equal(
    out.data.effective_n,
    3,
    '--home registry has 3 accounts (NOT the 1-account CC_MASTER_HOME)',
  );
  assert.equal(out.data.accounts.length, 3);
  const emails = out.data.accounts.map((a: { email: string }) => a.email).sort();
  assert.deepEqual(emails, ['a@c.com', 'b@c.com', 'c@c.com'], 'accounts come from --home registry');
  assert.ok(!emails.includes('solo@c.com'), 'must NOT read the CC_MASTER_HOME registry');
});

test('usage advise honors --home for effective_n + switch_candidate (P2 regression)', () => {
  // advise 侧同样要认 --home（effective_n 从正确 registry 算、switch_candidate 选正确备号）。
  const flagHome = setupHome({ accounts: REGISTRY_3, sidecar: SIDECAR_CRITICAL });
  const envHome = setupHome({
    accounts: { 'solo@c.com': { active: true, vault: { kind: 'keychain' } } },
  });
  const ctx = mkCtx(envHome.home, flagHome.boardPath, {
    values: { home: flagHome.home },
    // sidecar 走 --home 下的 rate-cache（advise 读的账户信号路径独立于 registry）。
    rateCache: join(flagHome.home, '.cc-master-rate-limits.json'),
    flags: { json: true },
  });
  const code = usageHandler.advise(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(
    out.data.effective_n,
    3,
    'effective_n from --home registry (not 1-account env home)',
  );
  assert.equal(out.data.verdict, 'switch', '5h critical + healthy pool backup → switch (ADR-024)');
  assert.equal(
    out.data.switch_candidate,
    'b@c.com',
    'switch_candidate from --home registry backups (both recover past reset → email tiebreak b)',
  );
});

// ══ usage advise ═════════════════════════════════════════════════════════════════════════════════

test('usage advise with no sidecar holds + available:false (degrade, exit 0)', () => {
  const { home, boardPath } = setupHome();
  const ctx = mkCtx(home, boardPath, { flags: { json: true } });
  const code = usageHandler.advise(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.verdict, 'hold');
  assert.equal(out.data.available, false);
  assert.equal(out.data.source, 'local-derived-approx');
});

test('usage advise n>1 + 5h critical + healthy backup → switch + switch_candidate (ADR-024)', () => {
  const { home, boardPath } = setupHome({ accounts: REGISTRY_3, sidecar: SIDECAR_CRITICAL });
  const ctx = mkCtx(home, boardPath, { flags: { json: true } });
  const code = usageHandler.advise(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.verdict, 'switch', '5h critical + healthy pool → switch (非减速·非加速)');
  assert.equal(out.data.effective_n, 3);
  assert.equal(
    out.data.switch_candidate,
    'b@c.com',
    'engine select recovers past-reset backups to full → email tiebreak picks b',
  );
  assert.equal(out.data.window_5h_pct, 92);
  assert.equal(out.data.window_7d_pct, 50);
  assert.equal(out.data.available, true);
  assert.equal(out.data.source, 'account');
});

test('usage advise reads the REAL rate-cache sidecar path + normalizes epoch resets_at (P4 sidecar bug regression)', () => {
  // Regression: the handler used to read ${home}/usage-snapshot.json — a path nothing ever writes —
  //   so the account signal was永远 unavailable. The real sidecar lives at CC_MASTER_RATE_CACHE
  //   (statusline-capture.js / cc-usage.sh / usage-pacing.js hook 同一路径) with epoch-秒 resets_at/captured_at.
  const { home, boardPath, rateCache } = setupHome({
    accounts: REGISTRY_3,
    sidecar: SIDECAR_CRITICAL,
  });
  // sidecar deliberately at the real rate-cache path; the OLD wrong path must NOT exist.
  assert.equal(
    rateCache.endsWith('.cc-master-rate-limits.json'),
    true,
    'sidecar at rate-cache path',
  );
  const ctx = mkCtx(home, boardPath, { flags: { json: true } });
  const code = usageHandler.advise(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  // Account signal IS available (proves the path is now read) + epoch captured_at normalized to ISO as_of.
  assert.equal(out.data.available, true, 'account signal available (real sidecar path read)');
  assert.equal(out.data.source, 'account');
  assert.equal(out.data.window_5h_pct, 92, 'epoch-shape used_percentage read through');
  assert.equal(out.data.as_of, '2026-06-25T09:00:00Z', 'epoch captured_at normalized to ISO as_of');
});

test('usage advise with sidecar at the OLD wrong path (usage-snapshot.json) stays unavailable (degrade)', () => {
  // Belt-and-braces: a sidecar at the historical wrong path must NOT be picked up — only the
  //   rate-cache path counts. Proves the fix doesn't silently keep both readers alive.
  const { home, boardPath } = setupHome({ accounts: REGISTRY_3 });
  writeFileSync(join(home, 'usage-snapshot.json'), `${JSON.stringify(SIDECAR_CRITICAL)}\n`, 'utf8');
  const ctx = mkCtx(home, boardPath, { flags: { json: true } });
  usageHandler.advise(ctx);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.available, false, 'old wrong path is NOT read → degrade');
  assert.equal(out.data.source, 'local-derived-approx');
});

test('usage advise genuine single account + 5h critical → stop_5h (全池撞墙·无备号·ADR-024)', () => {
  // 真单账号（无备号）5h 撞墙：换不了 → 全池（池=1）撞墙 → stop_5h（短停·arm wakeup 到 5h reset）。
  const solo = { 'solo@c.com': { active: true, vault: { kind: 'keychain' } } };
  const { home, boardPath } = setupHome({ accounts: solo, sidecar: SIDECAR_CRITICAL });
  const ctx = mkCtx(home, boardPath, { flags: { json: true } });
  usageHandler.advise(ctx);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.verdict, 'stop_5h');
  assert.equal(out.data.stop_dimension, '5h');
  assert.equal(out.data.effective_n, 1);
  assert.equal(out.data.switch_candidate, null);
});

// ── 过期 token 不可作 switch_candidate（codex round-6 #bug1·sweep #2/#3）─────────────────────────────
// effectiveN 已按 token_expires_at 忽略过期备号；advise 的 switch_candidate 投影此前只看 switchable!==false，
//   可能选中一个 token 已过期的号当 candidate（指向 switch 路径用不了的号）。修复后 switch_candidate 复用
//   effectiveN 同款 tokenExpired SSOT 谓词——过期 token → 不可作 candidate。
//   ★用过去/未来的 token_expires_at（恒 < / ≥ 真实 now），不注入固定时钟（handler 用 Date.now()）。
const REGISTRY_EXPIRED_BACKUP = {
  'a@c.com': {
    active: true,
    vault: { kind: 'keychain', service: 'x', account: 'a@c.com' },
    last_observed_quota: {
      at: '2026-06-25T07:00:00Z',
      '5h': { used_pct: 92, resets_at: '2026-06-25T11:00:00Z' },
      '7d': { used_pct: 50, resets_at: '2026-07-01T00:00:00Z' },
    },
  },
  // 7d used% 最低（10·恢复最多）但 token 已过期（2020·恒过去）——绝不能被选为 candidate。
  'expired@c.com': {
    active: false,
    switchable: true,
    token_expires_at: '2020-01-01T00:00:00Z',
    vault: { kind: 'keychain', service: 'x', account: 'expired@c.com' },
    last_switch_out: {
      at: '2026-06-24T09:00:00Z',
      '5h': { used_pct: 1, resets_at: '2026-06-24T13:00:00Z' },
      '7d': { used_pct: 10, resets_at: '2026-07-01T00:00:00Z' },
    },
  },
  // 7d used% 较高（30）但 token 仍有效（2030·恒未来）——应被选为 candidate（过期者出局后唯一可切）。
  'valid@c.com': {
    active: false,
    switchable: true,
    token_expires_at: '2030-01-01T00:00:00Z',
    vault: { kind: 'keychain', service: 'x', account: 'valid@c.com' },
    last_switch_out: {
      at: '2026-06-24T09:00:00Z',
      '5h': { used_pct: 5, resets_at: '2026-06-24T13:00:00Z' },
      '7d': { used_pct: 30, resets_at: '2026-07-01T00:00:00Z' },
    },
  },
};
// 全部备号 token 已过期（恒过去）——无任何可切候选。
const REGISTRY_ALL_EXPIRED = {
  'a@c.com': {
    active: true,
    vault: { kind: 'keychain', service: 'x', account: 'a@c.com' },
    last_observed_quota: {
      at: '2026-06-25T07:00:00Z',
      '5h': { used_pct: 92, resets_at: '2026-06-25T11:00:00Z' },
      '7d': { used_pct: 50, resets_at: '2026-07-01T00:00:00Z' },
    },
  },
  'exp1@c.com': {
    active: false,
    switchable: true,
    token_expires_at: '2020-01-01T00:00:00Z',
    vault: { kind: 'keychain', service: 'x', account: 'exp1@c.com' },
    last_switch_out: {
      at: '2026-06-24T09:00:00Z',
      '5h': { used_pct: 1, resets_at: '2026-06-24T13:00:00Z' },
      '7d': { used_pct: 8, resets_at: '2026-07-01T00:00:00Z' },
    },
  },
  'exp2@c.com': {
    active: false,
    switchable: true,
    token_expires_at: '2019-06-01T00:00:00Z',
    vault: { kind: 'keychain', service: 'x', account: 'exp2@c.com' },
    last_switch_out: {
      at: '2026-06-24T09:00:00Z',
      '5h': { used_pct: 2, resets_at: '2026-06-24T13:00:00Z' },
      '7d': { used_pct: 9, resets_at: '2026-07-01T00:00:00Z' },
    },
  },
};

test('usage advise switch_candidate skips EXPIRED-token backup, picks the VALID one (#bug1)', () => {
  // expired@c.com 有最低 7d（10·本应「最优」）但 token 已过期 → 必须被跳过；valid@c.com（7d=30·有效）当选。
  const { home, boardPath } = setupHome({
    accounts: REGISTRY_EXPIRED_BACKUP,
    sidecar: SIDECAR_CRITICAL,
  });
  const ctx = mkCtx(home, boardPath, { flags: { json: true } });
  const code = usageHandler.advise(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.verdict, 'switch', 'n>1 (1 valid backup) + 5h critical → switch');
  assert.equal(
    out.data.switch_candidate,
    'valid@c.com',
    'must NOT pick lowest-7d expired backup; valid (non-expired) backup wins',
  );
  assert.notEqual(
    out.data.switch_candidate,
    'expired@c.com',
    'expired token never a switch target',
  );
  // effective_n 只数未过期备号：1 active + 1 valid backup = 2（过期号不计 switchable·引擎 SSOT 一致）。
  assert.equal(
    out.data.effective_n,
    2,
    'expired backup excluded from effective_n (effectiveN SSOT)',
  );
});

test('usage advise with ONLY expired-token backups → no switch_candidate (#bug1)', () => {
  // 纯过期备号 registry：effective_n 退 1（无可切）→ verdict throttle（单号·无切号 lever）→ switch_candidate null。
  const { home, boardPath } = setupHome({
    accounts: REGISTRY_ALL_EXPIRED,
    sidecar: SIDECAR_CRITICAL,
  });
  const ctx = mkCtx(home, boardPath, { flags: { json: true } });
  usageHandler.advise(ctx);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.effective_n, 1, 'all backups expired → effective_n collapses to 1');
  assert.equal(
    out.data.switch_candidate,
    null,
    'no non-expired backup → never recommend an expired token',
  );
});

test('usage show marks expired-token backup distinctly + carries token_expired flag (#bug1·sweep #3)', () => {
  // show 列表里过期号该标记（token_expired:true·渲染 [backup·token过期]），别让用户以为可切。
  const { home, boardPath } = setupHome({
    accounts: REGISTRY_EXPIRED_BACKUP,
    sidecar: SIDECAR_CRITICAL,
  });
  const jsonCtx = mkCtx(home, boardPath, { flags: { json: true } });
  usageHandler.show(jsonCtx);
  const out = JSON.parse(jsonCtx.outBuf.join('')).data;
  const expired = out.accounts.find((a: { email: string }) => a.email === 'expired@c.com');
  const valid = out.accounts.find((a: { email: string }) => a.email === 'valid@c.com');
  assert.equal(expired.token_expired, true, 'expired backup flagged token_expired:true');
  assert.equal(valid.token_expired, false, 'valid backup token_expired:false');
  // effective_n 数未过期备号：1 active + 1 valid = 2（过期号不计）。
  assert.equal(out.effective_n, 2, 'show effective_n excludes expired backup (effectiveN SSOT)');
  // 文本面：过期号渲染独立标签。
  const textCtx = mkCtx(home, boardPath, {});
  usageHandler.show(textCtx);
  const text = textCtx.outBuf.join('');
  assert.match(
    text,
    /\[backup·token过期\] expired@c\.com/,
    'expired backup gets distinct text tag',
  );
});

// ══ usage task-cost ══════════════════════════════════════════════════════════════════════════════

const COST_TASKS = [
  {
    id: 'T1',
    status: 'done',
    deps: [],
    type: 'development',
    executor: 'subagent',
    tier: 'mid',
    observability: { tokens: { input: 100, output: 50 } },
  },
  {
    id: 'T2',
    status: 'done',
    deps: [],
    type: 'design',
    executor: 'master-orchestrator',
    observability: { tokens: { input: 200, output: 80 } },
  },
  { id: 'T3', status: 'ready', deps: [], type: 'development', executor: 'subagent' }, // no token → N/A
];

test('usage task-cost <id> returns token total (in+out)', () => {
  const { home, boardPath } = setupHome({ tasks: COST_TASKS });
  const ctx = mkCtx(home, boardPath, { positionals: ['T1'], flags: { json: true } });
  const code = usageHandler.taskCost(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.found, true);
  assert.equal(out.data.tokens.total, 150);
  assert.equal(out.data.na, false);
  assert.equal(out.data.source, 'observability');
});

test('usage task-cost <id> with no observability → N/A (na:true, total null)', () => {
  const { home, boardPath } = setupHome({ tasks: COST_TASKS });
  const ctx = mkCtx(home, boardPath, { positionals: ['T3'], flags: { json: true } });
  usageHandler.taskCost(ctx);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.found, true);
  assert.equal(out.data.na, true, 'no token telemetry → N/A flag');
  assert.equal(out.data.tokens.total, null, 'total is null when no observability');
  assert.equal(out.data.confidence, 'low');
});

test('usage task-cost --group-by executor aggregates + coverage_pct', () => {
  const { home, boardPath } = setupHome({ tasks: COST_TASKS });
  const ctx = mkCtx(home, boardPath, { values: { 'group-by': 'executor' }, flags: { json: true } });
  usageHandler.taskCost(ctx);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.group_by, 'executor');
  const subagent = out.data.groups.find((g: { key: string }) => g.key === 'subagent');
  assert.equal(subagent.total, 150, 'T1 counts, T3 is N/A');
  assert.equal(subagent.na_count, 1, 'T3 has no token');
  // coverage: 2 of 3 tasks have token = 67%.
  assert.equal(out.data.coverage_pct, 67);
  assert.equal(out.data.total, 430);
});

test('usage task-cost --scope home aggregates cross-board observability (#audit: --scope was ignored)', () => {
  // 构造 home：current 板 1 个 done token=150；归档 corpus 板 2 个 done token=300+500=800。
  //   this-board（默认）→ 只见 current 的 150；home → 跨板见 150+800=950。证明 --scope 真改变输出。
  const { home, boardPath } = setupHome({ tasks: COST_TASKS }); // current 板（T1 token=150·T2 token=280·T3 N/A）
  // 写一块归档 corpus 板（done 任务带 observability·喂 home 语料）。
  writeFileSync(
    join(home, 'boards', '2026-06-20-corpus.board.json'),
    `${JSON.stringify({
      schema: 'cc-master/v2',
      meta: { created_at: '2026-06-20T00:00:00Z' },
      goal: 'archived corpus',
      owner: { active: false, session_id: 'sid-arch', heartbeat: '2026-06-20T00:00:00Z' },
      git: { worktree: '/repo/wt', branch: 'feat' },
      tasks: [
        {
          id: 'X1',
          status: 'done',
          type: 'development',
          executor: 'subagent',
          started_at: '2026-06-20T00:00:00Z',
          finished_at: '2026-06-20T02:00:00Z',
          observability: { tokens: { input: 200, output: 100 } }, // 300
        },
        {
          id: 'X2',
          status: 'done',
          type: 'design',
          executor: 'subagent',
          started_at: '2026-06-20T03:00:00Z',
          finished_at: '2026-06-20T05:00:00Z',
          observability: { tokens: { input: 300, output: 200 } }, // 500
        },
      ],
      log: [],
    })}\n`,
    'utf8',
  );
  const thisBoard = mkCtx(home, boardPath, {
    values: { 'group-by': 'executor', scope: 'this-board' },
    flags: { json: true },
  });
  const homeScope = mkCtx(home, boardPath, {
    values: { 'group-by': 'executor', scope: 'home' },
    flags: { json: true },
  });
  usageHandler.taskCost(thisBoard);
  usageHandler.taskCost(homeScope);
  const dTB = JSON.parse(thisBoard.outBuf.join('')).data;
  const dHome = JSON.parse(homeScope.outBuf.join('')).data;
  // this-board: T1(150)+T2(280)=430（COST_TASKS·T3 N/A）。
  assert.equal(dTB.scope, 'this-board');
  assert.equal(dTB.total, 430, 'this-board sees only current board tokens');
  // home: this-board 430 + corpus 800 = 1230（跨板聚合）。
  assert.equal(dHome.scope, 'home');
  assert.equal(dHome.total, 1230, 'home scope aggregates cross-board corpus tokens');
  assert.ok(dHome.total > dTB.total, '--scope home changes the output (flag now consumed)');
});

test('usage task-cost --scope this-repo filters corpus to same repo (#audit)', () => {
  // corpus 含同 repo + 异 repo 各一 done·this-repo 只聚同 repo。
  const { home, boardPath } = setupHome({ tasks: [] }); // current 板 git.worktree=/repo/wt
  writeFileSync(
    join(home, 'boards', '2026-06-19-corpus.board.json'),
    `${JSON.stringify({
      schema: 'cc-master/v2',
      meta: { created_at: '2026-06-19T00:00:00Z' },
      goal: 'mixed-repo corpus',
      owner: { active: false, session_id: 'sid-mix', heartbeat: '2026-06-19T00:00:00Z' },
      git: { worktree: '/repo/wt', branch: 'feat' }, // 同 repo（boardRepo 用 worktree）
      tasks: [
        {
          id: 'S1',
          status: 'done',
          type: 'development',
          executor: 'subagent',
          observability: { tokens: { input: 100, output: 100 } }, // 200·same repo
        },
      ],
      log: [],
    })}\n`,
    'utf8',
  );
  writeFileSync(
    join(home, 'boards', '2026-06-18-other.board.json'),
    `${JSON.stringify({
      schema: 'cc-master/v2',
      meta: { created_at: '2026-06-18T00:00:00Z' },
      goal: 'other-repo corpus',
      owner: { active: false, session_id: 'sid-oth', heartbeat: '2026-06-18T00:00:00Z' },
      git: { worktree: '/other/repo', branch: 'main' }, // 异 repo
      tasks: [
        {
          id: 'D1',
          status: 'done',
          type: 'development',
          executor: 'subagent',
          observability: { tokens: { input: 999, output: 1 } }, // 1000·other repo（须被 this-repo 排除）
        },
      ],
      log: [],
    })}\n`,
    'utf8',
  );
  const repoScope = mkCtx(home, boardPath, {
    values: { 'group-by': 'executor', scope: 'this-repo' },
    flags: { json: true },
  });
  const homeScope = mkCtx(home, boardPath, {
    values: { 'group-by': 'executor', scope: 'home' },
    flags: { json: true },
  });
  usageHandler.taskCost(repoScope);
  usageHandler.taskCost(homeScope);
  const dRepo = JSON.parse(repoScope.outBuf.join('')).data;
  const dHome = JSON.parse(homeScope.outBuf.join('')).data;
  assert.equal(
    dRepo.total,
    200,
    'this-repo only counts same-repo corpus (S1·excludes other-repo D1)',
  );
  assert.equal(dHome.total, 1200, 'home counts both (200+1000)');
});

test('usage task-cost <id> not found returns found:false', () => {
  const { home, boardPath } = setupHome({ tasks: COST_TASKS });
  const ctx = mkCtx(home, boardPath, { positionals: ['NOPE'], flags: { json: true } });
  usageHandler.taskCost(ctx);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.found, false);
});

// ══ usage burn-rate（配额%-burn-rate·账户权威·window-elapsed）══════════════════════════════════════
// 5h: used=60%·captured 13:00·resets 15:00 → windowStart 10:00·elapsed 3h → burn=20%/h。
//   7d: used=30%·resets 2026-07-01T13:00 → windowStart 06-24T13:00·elapsed 24h → burn=1.25%/h。
const T13 = Math.floor(Date.parse('2026-06-25T13:00:00Z') / 1000);
const T15 = Math.floor(Date.parse('2026-06-25T15:00:00Z') / 1000);
const T7D = Math.floor(Date.parse('2026-07-01T13:00:00Z') / 1000);
const SIDECAR_BURN = {
  five_hour: { used_percentage: 60, resets_at: T15 },
  seven_day: { used_percentage: 30, resets_at: T7D },
  captured_at: T13,
};

test('usage burn-rate computes window-elapsed %/h for 5h + 7d (account-authoritative)', () => {
  const { home, boardPath } = setupHome({ sidecar: SIDECAR_BURN });
  const ctx = mkCtx(home, boardPath, {
    values: { 'as-of': '2026-06-25T13:00:00Z' },
    flags: { json: true },
  });
  const code = usageHandler.burnRate(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.available, true);
  assert.equal(out.data.source, 'account');
  // 5h: 60% over 3h elapsed → 20%/h.
  assert.equal(out.data.five_hour.used_pct, 60);
  assert.equal(out.data.five_hour.burn_pct_per_hour, 20);
  assert.equal(out.data.five_hour.method, 'window-elapsed');
  // 7d: 30% over 24h elapsed → 1.25%/h.
  assert.equal(out.data.seven_day.burn_pct_per_hour, 1.25);
});

test('usage burn-rate with no sidecar → available:false (degrade, exit 0)', () => {
  const { home, boardPath } = setupHome();
  const ctx = mkCtx(home, boardPath, { flags: { json: true } });
  const code = usageHandler.burnRate(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.available, false);
  assert.equal(out.data.source, 'local-derived-approx');
  assert.equal(out.data.five_hour.burn_pct_per_hour, null);
});

// ══ usage runway（剩余走廊 ÷ burn → 距触顶 vs 距 reset）═════════════════════════════════════════════
const SIDECAR_RUNWAY_TIGHT = {
  five_hour: { used_percentage: 80, resets_at: T15 }, // 80% → burn=80/3≈26.67%/h·remaining 10·to_ceiling≈0.37h<2h
  seven_day: { used_percentage: 30, resets_at: T7D },
  captured_at: T13,
};
const SIDECAR_RUNWAY_AMPLE = {
  five_hour: { used_percentage: 20, resets_at: T15 }, // 20% → burn≈6.67%/h·remaining 70·to_ceiling≈10.5h>2h
  seven_day: { used_percentage: 10, resets_at: T7D },
  captured_at: T13,
};

test('usage runway: 5h fast burn near ceiling → will-exhaust-before-reset', () => {
  const { home, boardPath } = setupHome({ sidecar: SIDECAR_RUNWAY_TIGHT });
  const ctx = mkCtx(home, boardPath, {
    values: { 'as-of': '2026-06-25T13:00:00Z' },
    flags: { json: true },
  });
  const code = usageHandler.runway(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.available, true);
  assert.equal(out.data.five_hour.remaining_corridor_pct, 10, '90 ceiling − 80 used');
  assert.equal(out.data.five_hour.verdict, 'will-exhaust-before-reset');
  assert.equal(out.data.five_hour.ceiling_pct, 90, '5h corridor high');
  assert.equal(out.data.seven_day.ceiling_pct, 85, '7d hard-stop ceiling');
});

test('usage runway: 5h slow burn → ample (reset before ceiling)', () => {
  const { home, boardPath } = setupHome({ sidecar: SIDECAR_RUNWAY_AMPLE });
  const ctx = mkCtx(home, boardPath, {
    values: { 'as-of': '2026-06-25T13:00:00Z' },
    flags: { json: true },
  });
  usageHandler.runway(ctx);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.five_hour.remaining_corridor_pct, 70);
  assert.equal(out.data.five_hour.verdict, 'ample');
});

test('usage runway with no sidecar → available:false (degrade)', () => {
  const { home, boardPath } = setupHome();
  const ctx = mkCtx(home, boardPath, { flags: { json: true } });
  usageHandler.runway(ctx);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.available, false);
  assert.equal(out.data.five_hour.verdict, 'unknown');
});

// ══ 零写不变式（usage 纯只读·绝不落盘）═══════════════════════════════════════════════════════════

test('usage handlers never write the board (zero-write invariant)', () => {
  const { home, boardPath } = setupHome({
    tasks: COST_TASKS,
    accounts: REGISTRY_3,
    sidecar: SIDECAR_CRITICAL,
  });
  const before = readFileSync(boardPath, 'utf8');
  const accountsBefore = readFileSync(join(home, 'accounts.json'), 'utf8');
  usageHandler.show(mkCtx(home, boardPath, { flags: { json: true } }));
  usageHandler.advise(mkCtx(home, boardPath, { flags: { json: true } }));
  usageHandler.taskCost(
    mkCtx(home, boardPath, { values: { 'group-by': 'type' }, flags: { json: true } }),
  );
  usageHandler.burnRate(mkCtx(home, boardPath, { flags: { json: true } }));
  usageHandler.runway(mkCtx(home, boardPath, { flags: { json: true } }));
  assert.equal(readFileSync(boardPath, 'utf8'), before, 'board byte-identical after usage reads');
  assert.equal(
    readFileSync(join(home, 'accounts.json'), 'utf8'),
    accountsBefore,
    'registry byte-identical (read-only)',
  );
});
