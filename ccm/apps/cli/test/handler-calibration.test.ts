// handler-calibration.test.ts — deadline forecast 真实 observed snapshot producer（#168.1 CAL-CAPTURE）。
// 覆盖：稳定 board ID / 同 board+as-of 幂等 / 真实 backlog / estimate deadline-risk 零 store 副作用。

import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadDeadlineSnapshots, snapshotStorePath, stableDeadlineBoardId } from '@ccm/engine';
import type { Ctx } from '../src/handlers/_common.js';
import * as calibrationHandler from '../src/handlers/calibration.js';
import * as estimateHandler from '../src/handlers/estimate.js';
import * as io from '../src/io.js';
import { run } from '../src/router.js';

const EXIT = io.EXIT;
const NOW = '2026-06-25T12:00:00Z';
const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(__dirname, '../../../packages/engine/test/fixtures/boards');

const roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

function fixture(): { home: string; boardPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'ccm-cal-capture-'));
  roots.push(root);
  const home = join(root, 'home');
  cpSync(resolve(FIX, 'home-corpus'), join(home, 'boards'), { recursive: true });

  const boardPath = join(home, 'boards', 'target.board.json');
  writeFileSync(
    boardPath,
    JSON.stringify({
      schema: 'cc-master/v2',
      meta: { template_version: 3, created_at: '2026-06-25T09:00:00Z' },
      goal: 'capture real deadline calibration observations',
      goal_contract: {
        schema: 'ccm/goal-contract/v1',
        revision: 1,
        assurance: 'confirmed',
        updated_at: '2026-06-25T10:00:00Z',
        deadline: {
          state: 'confirmed',
          at: '2026-07-15T12:00:00Z',
          precision: 'minute',
          kind: 'hard',
          rev: 1,
          updated_at: '2026-06-25T10:00:00Z',
        },
      },
      owner: { active: true, session_id: 'sid-cal' },
      git: { worktree: '/repo/capture', branch: 'main' },
      scheduling: { wip_limit: 2 },
      tasks: [
        {
          id: 'DONE',
          status: 'done',
          deps: [],
          estimate: { value: 2, unit: 'h' },
          started_at: '2026-06-25T08:00:00Z',
          finished_at: '2026-06-25T10:00:00Z',
        },
        { id: 'READY', status: 'ready', deps: ['DONE'], estimate: { value: 3, unit: 'h' } },
        {
          id: 'FLIGHT',
          status: 'in_flight',
          deps: ['DONE'],
          estimate: { value: 5, unit: 'h' },
          started_at: '2026-06-25T11:00:00Z',
        },
      ],
      log: [],
    }),
  );
  return { home, boardPath };
}

type TestCtx = Ctx & { outBuf: string[]; errBuf: string[] };
function ctxFor(home: string, boardPath: string, asOf = NOW): TestCtx {
  const outBuf: string[] = [];
  const errBuf: string[] = [];
  return {
    values: { board: boardPath, home, scope: 'home', 'as-of': asOf, seed: '42', runs: '2000' },
    positionals: [],
    flags: {
      json: true,
      dryRun: false,
      force: false,
      yes: false,
      quiet: false,
      verbose: false,
      color: false,
    },
    sid: '',
    env: { CC_MASTER_HOME: home },
    out: (text: string) => outBuf.push(text),
    err: (text: string) => errBuf.push(text),
    isTTY: true,
    outBuf,
    errBuf,
  };
}

function dataOf(ctx: TestCtx): any {
  return JSON.parse(ctx.outBuf.join('')).data;
}

test('calibration capture writes one observed snapshot with stable board id and real backlog', () => {
  const { home, boardPath } = fixture();
  const first = ctxFor(home, boardPath);
  assert.equal(calibrationHandler.capture(first), EXIT.OK);

  const firstData = dataOf(first);
  assert.equal(firstData.captured, true);
  assert.equal(firstData.duplicate, false);
  assert.equal(firstData.snapshot.board_id, stableDeadlineBoardId(boardPath));
  assert.equal(firstData.snapshot.backlog, 2, 'READY + FLIGHT are the real as-of backlog');
  assert.equal(firstData.snapshot.provenance, 'observed');
  assert.equal(firstData.snapshot.label, 'unknown');
  assert.equal(typeof firstData.snapshot.on_time_probability, 'number');
  assert.notEqual(firstData.snapshot.predicted_band, 'unknown', 'captures a real forecast verdict');

  const second = ctxFor(home, boardPath);
  assert.equal(calibrationHandler.capture(second), EXIT.OK);
  assert.equal(dataOf(second).captured, false);
  assert.equal(dataOf(second).duplicate, true);

  const later = ctxFor(home, boardPath, '2026-06-25T13:00:00Z');
  assert.equal(calibrationHandler.capture(later), EXIT.OK);
  assert.equal(dataOf(later).captured, true);

  const stored = loadDeadlineSnapshots(home);
  assert.equal(
    stored.length,
    2,
    'same board + same as-of counts once; later observation is retained',
  );
  assert.deepEqual(stored[0], firstData.snapshot);
  assert.equal(
    stored[0]?.board_id,
    stored[1]?.board_id,
    'multiple snapshots join to one board entity',
  );
  assert.notEqual(
    stored[0]?.snapshot_id,
    stored[1]?.snapshot_id,
    'distinct as-of values are distinct observations',
  );
});

test('estimate deadline-risk remains read-only and never creates the calibration store', () => {
  const { home, boardPath } = fixture();
  const before = readFileSync(boardPath, 'utf8');
  const store = snapshotStorePath(home);
  assert.equal(existsSync(store), false);

  const ctx = ctxFor(home, boardPath);
  assert.equal(estimateHandler.deadlineRisk(ctx), EXIT.OK);

  assert.equal(existsSync(store), false, 'read-only query does not start the data producer');
  assert.equal(
    readFileSync(boardPath, 'utf8'),
    before,
    'read-only query leaves board bytes unchanged',
  );
});

test('router exposes the explicit `ccm calibration capture` trigger', () => {
  const { home, boardPath } = fixture();
  const out: string[] = [];
  const err: string[] = [];
  const code = run(
    [
      'calibration',
      'capture',
      '--board',
      boardPath,
      '--home',
      home,
      '--scope',
      'home',
      '--as-of',
      NOW,
      '--seed',
      '42',
      '--json',
    ],
    {
      out: (text: string) => out.push(text),
      err: (text: string) => err.push(text),
      env: {
        HOME: home,
        CC_MASTER_HOME: home,
        CC_MASTER_NO_AUTOINSTALL: '1',
      },
    },
  );
  assert.equal(code, EXIT.OK, err.join('\n'));
  assert.equal(JSON.parse(out.join('')).data.captured, true);
  assert.equal(loadDeadlineSnapshots(home).length, 1);
});
