// handler-coordination.test.ts — ADR-032 coordination inbox CLI handlers.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { Ctx } from '../src/handlers/_common.js';
import * as coordinationHandler from '../src/handlers/coordination.js';
import * as io from '../src/io.js';
import { run } from '../src/router.js';

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

function mkBoard({ inbox }: { inbox?: unknown[] } = {}): string {
  const root = mkTmp('ccm-hcoord-');
  mkdirSync(root, { recursive: true });
  const boardPath = join(root, '2026-07-09-coordination.board.json');
  const board: Record<string, unknown> = {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    goal: 'coordination handler test',
    owner: { active: true, session_id: 'sid-coord', heartbeat: '2026-07-09T08:00:00Z' },
    git: { worktree: '', branch: '' },
    tasks: [],
    log: [],
  };
  if (inbox !== undefined) board.coordination = { inbox };
  writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  return boardPath;
}

const ISO = (offsetSec: number): string =>
  new Date(Date.now() + offsetSec * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

function mkCoordinationHome(): {
  home: string;
  boardA: string;
  boardB: string;
  rateCache: string;
} {
  const root = mkTmp('ccm-hcoord-pool-');
  const home = join(root, '.cc_master');
  mkdirSync(join(home, 'boards'), { recursive: true });
  const boardA = join(home, 'boards', '2026-07-09-a.board.json');
  const boardB = join(home, 'boards', '2026-07-09-b.board.json');
  const base = {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    git: { worktree: '', branch: '' },
    tasks: [],
    log: [],
  };
  writeFileSync(
    boardA,
    `${JSON.stringify(
      {
        ...base,
        goal: 'normal over-burning board',
        owner: {
          active: true,
          session_id: 'sid-a',
          heartbeat: ISO(-20),
          harness: 'claude-code',
        },
        coordination: {
          priority: 'normal',
          state: { current: { active_tasks: 1, burn_contribution: 12 } },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  writeFileSync(
    boardB,
    `${JSON.stringify(
      {
        ...base,
        goal: 'urgent under-served board',
        owner: {
          active: true,
          session_id: 'sid-b',
          heartbeat: ISO(-20),
          harness: 'claude-code',
        },
        coordination: {
          priority: 'urgent',
          state: { current: { active_tasks: 1, burn_contribution: 3 } },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  const rateCache = join(home, '.cc-master-rate-limits.json');
  writeFileSync(
    rateCache,
    `${JSON.stringify({
      five_hour: { used_percentage: 85, resets_at: Math.floor(Date.now() / 1000) + 1800 },
      seven_day: { used_percentage: 30, resets_at: Math.floor(Date.now() / 1000) + 86400 },
      captured_at: Math.floor(Date.now() / 1000),
    })}\n`,
    'utf8',
  );
  return { home, boardA, boardB, rateCache };
}

type TestCtx = Ctx & { outBuf: string[]; errBuf: string[] };
function mkCtx(
  boardPath: string,
  {
    values = {},
    flags = {},
    positionals = [],
  }: {
    values?: Record<string, unknown>;
    flags?: Partial<Ctx['flags']>;
    positionals?: string[];
  } = {},
): TestCtx {
  const outBuf: string[] = [];
  const errBuf: string[] = [];
  return {
    values: { board: boardPath, ...values },
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
    sid: 'sid-coord',
    env: {},
    out: (s: string) => outBuf.push(s),
    err: (s: string) => errBuf.push(s),
    isTTY: true,
    outBuf,
    errBuf,
  };
}

function readBoard(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('coordination notify appends, list reads, ack consumes', () => {
  const boardPath = mkBoard();
  const notify = mkCtx(boardPath, {
    values: {
      kind: 'pacing_yield',
      summary: 'Yield to urgent peer',
      strength: 'strong',
      payload: '{"peer":"urgent-board"}',
      expires: '2099-01-01T00:00:00Z',
    },
    flags: { json: true },
  });
  assert.equal(coordinationHandler.notify(notify), EXIT.OK);
  const notifyOut = JSON.parse(notify.outBuf.join(''));
  const id = notifyOut.data.notification.id;
  assert.match(id, /^ntf-/);

  const list = mkCtx(boardPath, {
    positionals: ['list'],
    values: { unconsumed: true },
    flags: { json: true },
  });
  assert.equal(coordinationHandler.inbox(list), EXIT.OK);
  const listed = JSON.parse(list.outBuf.join(''));
  assert.equal(listed.data.count, 1);
  assert.equal(listed.data.inbox[0].id, id);
  assert.equal(listed.data.inbox[0].status, 'unconsumed');

  const ack = mkCtx(boardPath, {
    positionals: ['ack', id],
    values: { note: 'Accepted yield' },
    flags: { json: true },
  });
  assert.equal(coordinationHandler.inbox(ack), EXIT.OK);
  const after = readBoard(boardPath);
  const item = (after.coordination as { inbox: Array<Record<string, unknown>> }).inbox[0] as Record<
    string,
    unknown
  >;
  assert.equal(item.status, 'consumed');
  assert.equal(item.consumed_note, 'Accepted yield');
});

test('coordination inbox ack unknown id throws Usage', () => {
  const boardPath = mkBoard();
  const ctx = mkCtx(boardPath, { positionals: ['ack', 'missing-id'] });
  assert.throws(
    () => coordinationHandler.inbox(ctx),
    (e: Error & { errKind?: string }) => {
      assert.equal(e.errKind, 'Usage');
      assert.match(e.message, /notification not found/);
      return true;
    },
  );
});

test('coordination subscription is credential-free, idempotent for one session, and rotates epoch on handoff', () => {
  const boardPath = mkBoard();
  const home = mkTmp('ccm-hcoord-subscription-');
  const register = (sessionId: string): Record<string, unknown> => {
    const ctx = mkCtx(boardPath, {
      positionals: ['register'],
      values: {
        home,
        origin: 'codex',
        'session-id': sessionId,
        capability: 'coordination-inbox',
      },
      flags: { json: true },
    });
    assert.equal(coordinationHandler.subscription(ctx), EXIT.OK);
    return JSON.parse(ctx.outBuf.join('')).data.subscription as Record<string, unknown>;
  };

  const first = register('sid-one');
  const replay = register('sid-one');
  assert.deepEqual(replay, first, 'the same ARM replay must not rotate subscription identity');
  assert.equal(first.state, 'current');
  assert.equal(first.origin, 'codex');
  assert.equal(first.capability, 'coordination-inbox');

  const next = register('sid-two');
  assert.notEqual(next.subscription_id, first.subscription_id);
  assert.notEqual(next.session_epoch, first.session_epoch);

  const stale = mkCtx(boardPath, {
    positionals: ['current'],
    values: {
      home,
      origin: 'codex',
      'session-id': 'sid-one',
      capability: 'coordination-inbox',
    },
    flags: { json: true },
  });
  assert.equal(coordinationHandler.subscription(stale), EXIT.OK);
  assert.equal(JSON.parse(stale.outBuf.join('')).data.subscription, null);

  const store = join(home, 'coordination', 'subscriptions.json');
  assert.equal(statSync(store).mode & 0o777, 0o600, 'subscription state must be owner-only');
});

test('coordination subscription refuses to replace a corrupt durable store', () => {
  const boardPath = mkBoard();
  const home = mkTmp('ccm-hcoord-subscription-corrupt-');
  const store = join(home, 'coordination', 'subscriptions.json');
  mkdirSync(join(home, 'coordination'), { recursive: true });
  writeFileSync(store, '{not-json\n');
  const register = mkCtx(boardPath, {
    positionals: ['register'],
    values: {
      home,
      origin: 'codex',
      'session-id': 'sid-corrupt',
      capability: 'coordination-inbox',
    },
    flags: { json: true },
  });
  assert.throws(
    () => coordinationHandler.subscription(register),
    /subscription store is invalid; refusing to overwrite/,
  );
  assert.equal(readFileSync(store, 'utf8'), '{not-json\n');
});

test('real CLI router registers and queries the exact current subscription', async () => {
  const boardPath = mkBoard();
  const home = mkTmp('ccm-hcoord-router-');
  const env = {
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, 'claude'),
    CC_MASTER_NO_AUTOINSTALL: '1',
    PATH: process.env.PATH,
  };
  const invoke = async (argv: string[]): Promise<Record<string, any>> => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(argv, {
      env,
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    });
    assert.equal(code, EXIT.OK, err.join('\n'));
    assert.deepEqual(err, []);
    return JSON.parse(out.join('')) as Record<string, any>;
  };
  const common = [
    '--board',
    boardPath,
    '--home',
    home,
    '--origin',
    'claude-code',
    '--session-id',
    'sid-router',
    '--capability',
    'coordination-inbox',
    '--json',
    '--no-input',
  ];
  const registered = await invoke(['coordination', 'subscription', 'register', ...common]);
  const current = await invoke(['coordination', 'subscription', 'current', ...common]);
  assert.deepEqual(current.data.subscription, registered.data.subscription);
});

test('bounded inbox list requires exact current session epoch, adds cached provenance, and never auto-acks', () => {
  const boardPath = mkBoard();
  const home = mkTmp('ccm-hcoord-bounded-');
  const notify = mkCtx(boardPath, {
    values: {
      kind: 'pacing_throttle',
      summary: 'Use cached pacing fact',
      expires: '2099-01-01T00:00:00Z',
    },
    flags: { json: true },
  });
  assert.equal(coordinationHandler.notify(notify), EXIT.OK);

  const register = mkCtx(boardPath, {
    positionals: ['register'],
    values: {
      home,
      origin: 'cursor',
      'session-id': 'sid-current',
      capability: 'coordination-inbox',
    },
    flags: { json: true },
  });
  assert.equal(coordinationHandler.subscription(register), EXIT.OK);
  const subscription = JSON.parse(register.outBuf.join('')).data.subscription;

  const list = (epoch: string): TestCtx =>
    mkCtx(boardPath, {
      positionals: ['list'],
      values: {
        home,
        unconsumed: true,
        'current-subscription': true,
        origin: 'cursor',
        'session-id': 'sid-current',
        'session-epoch': epoch,
        capability: 'coordination-inbox',
      },
      flags: { json: true },
    });

  const current = list(subscription.session_epoch);
  assert.equal(coordinationHandler.inbox(current), EXIT.OK);
  const data = JSON.parse(current.outBuf.join('')).data;
  assert.equal(data.count, 1);
  assert.deepEqual(data.subscription, {
    subscription_id: subscription.subscription_id,
    session_id: 'sid-current',
    session_epoch: subscription.session_epoch,
    origin: 'cursor',
    capability: 'coordination-inbox',
  });
  assert.deepEqual(data.inbox[0].delivery_provenance, {
    ...data.subscription,
    source_policy_revision: 'ccm/cached-board-inbox/v1',
    consent_provenance_ref: 'ccm://coordination/subscriptions/cached-only',
  });
  assert.equal(
    (readBoard(boardPath).coordination as { inbox: Array<{ status: string }> }).inbox[0]?.status,
    'unconsumed',
    'listing is observation only; only an explicit ack may consume',
  );

  const stale = list('epoch-stale');
  assert.equal(coordinationHandler.inbox(stale), EXIT.OK);
  assert.deepEqual(JSON.parse(stale.outBuf.join('')).data, {
    subscription: null,
    inbox: [],
    count: 0,
  });
});

test('coordination notify supersedes older unconsumed notification of same kind through write gate', () => {
  const boardPath = mkBoard();
  for (const summary of ['Old yield', 'New yield']) {
    const ctx = mkCtx(boardPath, {
      values: {
        kind: 'pacing_yield',
        summary,
        expires: '2099-01-01T00:00:00Z',
      },
    });
    assert.equal(coordinationHandler.notify(ctx), EXIT.OK);
  }
  const board = readBoard(boardPath);
  const inbox = (board.coordination as { inbox: Array<Record<string, unknown>> }).inbox;
  const unconsumed = inbox.filter((item) => item.status === 'unconsumed');
  const expired = inbox.filter((item) => item.status === 'expired');
  assert.equal(unconsumed.length, 1);
  assert.equal((unconsumed[0] as Record<string, unknown>).summary, 'New yield');
  assert.equal(expired.length, 1);
  assert.equal((expired[0] as Record<string, unknown>).summary, 'Old yield');
});

test('coordination arbitrate appends only own pool-aware inbox notification', () => {
  const { home, boardA, boardB, rateCache } = mkCoordinationHome();
  const peerBefore = readBoard(boardB);
  const ctx = mkCtx(boardA, {
    values: { home },
    flags: { json: true },
  });
  ctx.sid = 'sid-a';
  ctx.env = {
    HOME: home,
    CC_MASTER_HOME: home,
    CC_MASTER_RATE_CACHE: rateCache,
    CC_MASTER_HOST: 'claude-code',
  };
  assert.equal(coordinationHandler.arbitrate(ctx), EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.mode, 'pool');
  assert.equal(out.data.appended, 1);
  assert.equal(out.data.own_row.kind, 'pacing_yield');
  assert.equal(out.data.own_row.target_headroom_pct, 3);
  assert.equal(out.data.allocation.rows.length, 2);
  assert.ok(
    out.data.allocation.rows.some(
      (row: { peer: { board_file: string }; kind: string }) =>
        row.peer.board_file === '2026-07-09-b.board.json' && row.kind === 'pacing_claim',
    ),
    'sibling row complements own yield with claim',
  );

  const after = readBoard(boardA);
  const inbox = (after.coordination as { inbox: Array<Record<string, unknown>> }).inbox;
  assert.equal(inbox.length, 1);
  const item = inbox[0] as Record<string, unknown>;
  const payload = item.payload as Record<string, unknown>;
  assert.equal(item.kind, 'pacing_yield');
  assert.equal(payload.producer, 'coordination-arbiter');
  assert.equal((payload.own as Record<string, unknown>).board_file, '2026-07-09-a.board.json');
  assert.deepEqual(readBoard(boardB), peerBefore, 'arbitrate must not write peer boards');
});

test('coordination arbitrate dedups unchanged own notification', () => {
  const { home, boardA, rateCache } = mkCoordinationHome();
  const ctx = mkCtx(boardA, {
    values: { home },
    flags: { json: true },
  });
  ctx.sid = 'sid-a';
  ctx.env = {
    HOME: home,
    CC_MASTER_HOME: home,
    CC_MASTER_RATE_CACHE: rateCache,
    CC_MASTER_HOST: 'claude-code',
  };
  assert.equal(coordinationHandler.arbitrate(ctx), EXIT.OK);
  const again = mkCtx(boardA, {
    values: { home },
    flags: { json: true },
  });
  again.sid = 'sid-a';
  again.env = ctx.env;
  assert.equal(coordinationHandler.arbitrate(again), EXIT.OK);
  const out = JSON.parse(again.outBuf.join(''));
  assert.equal(out.data.appended, 0);
  assert.equal(out.data.append_reason, 'dedup');
  const inbox =
    ((readBoard(boardA).coordination as Record<string, unknown>).inbox as unknown[]) ?? [];
  assert.equal(
    inbox.filter((item) => (item as Record<string, unknown>).status === 'unconsumed').length,
    1,
  );
});

test('coordination arbitrate keeps empty-session peers distinct in the same pool', () => {
  const { home, boardA, boardB, rateCache } = mkCoordinationHome();
  for (const boardPath of [boardA, boardB]) {
    const board = readBoard(boardPath);
    const owner = board.owner as Record<string, unknown>;
    owner.session_id = '';
    writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  }
  const ctx = mkCtx(boardA, {
    values: { home },
    flags: { json: true },
  });
  ctx.sid = '';
  ctx.env = {
    HOME: home,
    CC_MASTER_HOME: home,
    CC_MASTER_RATE_CACHE: rateCache,
    CC_MASTER_HOST: 'claude-code',
  };
  assert.equal(coordinationHandler.arbitrate(ctx), EXIT.OK);
  const out = JSON.parse(ctx.outBuf.join(''));
  assert.equal(out.data.allocation.peer_count, 2);
  assert.equal(out.data.allocation.rows.length, 2);
  const files = out.data.allocation.rows.map(
    (row: { peer: { board_file: string } }) => row.peer.board_file,
  );
  assert.deepEqual(files.sort(), ['2026-07-09-a.board.json', '2026-07-09-b.board.json']);
});
