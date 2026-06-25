// handler-usage.test.ts — usage noun handler（handlers/usage.ts）契约门（ADR-015 §2.6·plan §5）。
//
// usage = 配额侧只读 advisory namespace（全 verb runRead·零写不变式）。本测试用 mkdtemp 临时 home +
//   真 leaf + 临时板/registry/sidecar，端到端验证：
//   · show     —— 无 registry → available:false 优雅降级（exit 0·非 1）；有 registry → 全备号快照 + as_of/snapshot_stale。
//   · advise   —— sidecar 缺 → hold + available:false（降级）；sidecar 在 + n>1 + 5h 临界 + 7d 余量 → accelerate + switch_candidate。
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
  mkdirSync(home, { recursive: true });
  const boardPath = join(home, '2026-06-25-usage.board.json');
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
//   captured_at 2026-06-25T09:00:00Z=1782378000·5h resets 2026-06-25T11:00:00Z=1782385200·7d 2026-07-01T00:00:00Z=1782864000。
const SIDECAR_CRITICAL = {
  five_hour: { used_percentage: 92, resets_at: 1782385200 },
  seven_day: { used_percentage: 50, resets_at: 1782864000 },
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

test('usage show --accounts current filters to active only', () => {
  const { home, boardPath } = setupHome({ accounts: REGISTRY_3 });
  const ctx = mkCtx(home, boardPath, { values: { accounts: 'current' }, flags: { json: true } });
  usageHandler.show(ctx);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.accounts.length, 1);
  assert.equal(out.data.accounts[0].active, true);
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

test('usage advise n>1 + 5h critical + 7d headroom → accelerate + switch_candidate (lowest 7d)', () => {
  const { home, boardPath } = setupHome({ accounts: REGISTRY_3, sidecar: SIDECAR_CRITICAL });
  const ctx = mkCtx(home, boardPath, { flags: { json: true } });
  const code = usageHandler.advise(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.verdict, 'accelerate');
  assert.equal(out.data.effective_n, 3);
  assert.equal(
    out.data.switch_candidate,
    'c@c.com',
    'picks switchable backup with lowest 7d used%',
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

test('usage advise --effective-n 1 override → throttle (single account, no switch)', () => {
  const { home, boardPath } = setupHome({ accounts: REGISTRY_3, sidecar: SIDECAR_CRITICAL });
  const ctx = mkCtx(home, boardPath, { values: { 'effective-n': '1' }, flags: { json: true } });
  usageHandler.advise(ctx);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.verdict, 'throttle');
  assert.equal(out.data.effective_n, 1);
  assert.equal(out.data.switch_candidate, null);
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

test('usage task-cost <id> not found returns found:false', () => {
  const { home, boardPath } = setupHome({ tasks: COST_TASKS });
  const ctx = mkCtx(home, boardPath, { positionals: ['NOPE'], flags: { json: true } });
  usageHandler.taskCost(ctx);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.found, false);
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
  assert.equal(readFileSync(boardPath, 'utf8'), before, 'board byte-identical after usage reads');
  assert.equal(
    readFileSync(join(home, 'accounts.json'), 'utf8'),
    accountsBefore,
    'registry byte-identical (read-only)',
  );
});
