// handler-policy.test.ts — P1·policy noun handler（handlers/policy.ts）契约门。
//
// policy handler 照 baseline 范式：
//   · show（runRead + 读 board.policy + effective 有效值）
//   · set（runWrite + 写 board.policy.autonomous_account_switch + log 追加）
//
// 本测试用 mkdtemp 临时 home + 真 leaf + 临时板，端到端验证：
//   · show 无 policy → effective allow；有 deny → 显示 deny。
//   · set deny（TTY 或 --user-authorized）→ 落盘 + board.log 有条目。
//   · set 非 TTY 无 --user-authorized → throw errKind='Usage'。
//   · set 无效值 → registry 层拒绝（未在此测，由 router 枚举校验处理）。

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { Ctx } from '../src/handlers/_common.js';
import * as policyHandler from '../src/handlers/policy.js';
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

function mkBoardHome({ policy, tasks = [] }: { policy?: unknown; tasks?: unknown[] } = {}): string {
  const root = mkTmp('ccm-hpl-');
  const home = join(root, '.claude', 'cc-master');
  mkdirSync(home, { recursive: true });
  const boardPath = join(home, '2026-06-25-policy.board.json');
  const board: Record<string, unknown> = {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    goal: 'policy handler test',
    owner: { active: true, session_id: 'sid-pl', heartbeat: '2026-06-25T08:00:00Z' },
    git: { worktree: '', branch: '' },
    scheduling: { wip_limit: 4 },
    tasks,
    log: [],
  };
  if (policy !== undefined) board.policy = policy;
  writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  return boardPath;
}

type TestCtx = Ctx & { outBuf: string[]; errBuf: string[] };
function mkCtx(
  boardPath: string | null,
  {
    values = {},
    flags = {},
    positionals = [],
    isTTY = true,
  }: {
    values?: Record<string, unknown>;
    flags?: Partial<Ctx['flags']>;
    positionals?: string[];
    isTTY?: boolean;
  } = {},
): TestCtx {
  const outBuf: string[] = [];
  const errBuf: string[] = [];
  return {
    values: { ...(boardPath ? { board: boardPath } : {}), ...values },
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
    sid: 'sid-pl',
    env: {},
    out: (s: string) => outBuf.push(s),
    err: (s: string) => errBuf.push(s),
    isTTY,
    outBuf,
    errBuf,
  };
}

// ══ policy show ══════════════════════════════════════════════════════════════════════════════════

test('policy show with no policy returns effective autonomous_account_switch=allow', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath);
  const code = policyHandler.show(ctx);
  assert.equal(code, EXIT.OK);
  const out = ctx.outBuf.join('');
  assert.ok(out.includes('allow'), 'must show allow as effective default');
});

test('policy show with deny policy returns effective autonomous_account_switch=deny', () => {
  const boardPath = mkBoardHome({ policy: { autonomous_account_switch: 'deny' } });
  const ctx = mkCtx(boardPath);
  const code = policyHandler.show(ctx);
  assert.equal(code, EXIT.OK);
  const out = ctx.outBuf.join('');
  assert.ok(out.includes('deny'), 'must show deny from board policy');
});

test('policy show --json returns ok:true with policy and effective', () => {
  const boardPath = mkBoardHome({ policy: { autonomous_account_switch: 'deny' } });
  const ctx = mkCtx(boardPath, { flags: { json: true } });
  const code = policyHandler.show(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.ok, true);
  assert.ok(out.data, 'must have data');
  assert.equal(out.data.effective.autonomous_account_switch, 'deny');
});

test('policy show --json with no policy returns effective allow', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, { flags: { json: true } });
  const code = policyHandler.show(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.ok, true);
  assert.equal(out.data.policy, null);
  assert.equal(out.data.effective.autonomous_account_switch, 'allow');
});

// ══ policy set ═══════════════════════════════════════════════════════════════════════════════════

test('policy set deny (TTY) writes to disk and adds log entry', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, {
    values: { 'autonomous-account-switch': 'deny' },
    isTTY: true,
  });
  const code = policyHandler.set(ctx);
  assert.equal(code, EXIT.OK);
  const board = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.ok(board.policy, 'policy must be written');
  assert.equal(board.policy.autonomous_account_switch, 'deny');
  // Check log entry
  assert.ok(Array.isArray(board.log) && board.log.length > 0, 'log must have entry');
  const logEntry = board.log[board.log.length - 1];
  assert.ok(logEntry.summary.includes('deny'), 'log entry mentions deny');
  assert.ok(logEntry.kind === 'decision', 'log entry kind is decision');
});

test('policy set allow with --user-authorized (non-TTY) writes to disk', () => {
  const boardPath = mkBoardHome({ policy: { autonomous_account_switch: 'deny' } });
  const ctx = mkCtx(boardPath, {
    values: { 'autonomous-account-switch': 'allow', 'user-authorized': true },
    isTTY: false,
  });
  const code = policyHandler.set(ctx);
  assert.equal(code, EXIT.OK);
  const board = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(board.policy.autonomous_account_switch, 'allow');
});

test('policy set non-TTY without --user-authorized throws errKind=Usage', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, {
    values: { 'autonomous-account-switch': 'deny' },
    isTTY: false,
  });
  assert.throws(
    () => policyHandler.set(ctx),
    (e: Error & { errKind?: string }) => {
      assert.equal(e.errKind, 'Usage');
      return true;
    },
  );
});

test('policy set --json renders structured JSON', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, {
    values: { 'autonomous-account-switch': 'deny' },
    flags: { json: true },
    isTTY: true,
  });
  const code = policyHandler.set(ctx);
  assert.equal(code, EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.ok, true);
  assert.ok(out.data, 'must have data');
  assert.equal(out.data.policy.autonomous_account_switch, 'deny');
});

test('policy set human render contains OK message', () => {
  const boardPath = mkBoardHome();
  const ctx = mkCtx(boardPath, {
    values: { 'autonomous-account-switch': 'allow' },
    isTTY: true,
  });
  policyHandler.set(ctx);
  assert.ok(ctx.outBuf.join('').includes('OK'), 'human render must contain OK');
});

test('policy set refreshes owner.heartbeat (round5 bug3)', () => {
  // policy.set 走 inline mutate（直接写 b.policy/b.log）·不经会自动 touch 的 mutations.* helper——
  //   修复前 heartbeat 停摆（watchdog 误判 owner 失联）。修复：显式 mutations.touch → heartbeat 刷成 now。
  const boardPath = mkBoardHome(); // fixture heartbeat = 2026-06-25T08:00:00Z
  const before = JSON.parse(readFileSync(boardPath, 'utf8'));
  const beforeHb = before.owner.heartbeat;
  const ctx = mkCtx(boardPath, {
    values: { 'autonomous-account-switch': 'deny' },
    isTTY: true,
  });
  assert.equal(policyHandler.set(ctx), EXIT.OK);
  const after = JSON.parse(readFileSync(boardPath, 'utf8'));
  const afterHb = after.owner.heartbeat;
  // ★核心：heartbeat 被刷新（严格晚于写前值），且 owner 其它字段不被破坏。
  assert.ok(
    Date.parse(afterHb) > Date.parse(beforeHb),
    `heartbeat ${afterHb} must be refreshed > ${beforeHb}`,
  );
  assert.match(afterHb, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'heartbeat is ISO-8601 UTC sec');
  assert.equal(after.owner.session_id, before.owner.session_id, 'session_id preserved');
  assert.equal(after.owner.active, before.owner.active, 'active preserved');
  // 自授权闸 + board.log 审计不变（log 仍有新条目）。
  assert.ok(after.log.length > before.log.length, 'board.log still appended (audit unchanged)');
});
