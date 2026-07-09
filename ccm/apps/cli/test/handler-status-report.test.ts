import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import * as io from '../src/io.js';
import { run } from '../src/router.js';

const EXIT = io.EXIT;
const SID = 'status-report-session';
let TMPDIRS: string[] = [];

afterEach(() => {
  for (const d of TMPDIRS) rmSync(d, { recursive: true, force: true });
  TMPDIRS = [];
});

function mkHome(): string {
  const root = mkdtempSync(join(tmpdir(), 'ccm-status-report-'));
  TMPDIRS.push(root);
  const home = join(root, '.cc_master');
  mkdirSync(join(home, 'boards'), { recursive: true });
  return home;
}

function seedBoard(home: string): string {
  const boardPath = join(home, 'boards', '20260708T120000Z-1.board.json');
  const board = {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    goal: 'Ship status report',
    owner: { active: true, session_id: SID, heartbeat: '2026-07-08T12:00:00Z' },
    git: { worktree: '/repo', branch: 'feat/status-report' },
    scheduling: { wip_limit: 1 },
    tasks: [
      {
        id: 'T1',
        title: 'Done task',
        status: 'done',
        verified: true,
        artifact: 'tests',
        estimate: { value: 1, unit: 'h' },
      },
      {
        id: 'T2',
        title: 'Running task',
        status: 'in_flight',
        deps: ['T1'],
        executor: 'codex',
        handle: 'worker-1',
        estimate: { value: 2, unit: 'h' },
      },
      {
        id: 'T3',
        title: 'Needs user',
        status: 'blocked',
        blocked_on: 'user',
        decision_package: { enter_cmd: '/cc-master:discuss T3' },
      },
      {
        id: 'T4',
        title: 'Ready task',
        status: 'ready',
        deps: ['T1'],
        estimate: { value: 1, unit: 'h' },
      },
    ],
    log: [],
  };
  writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  return boardPath;
}

function invoke(args: string[], home: string): { code: number; stdout: string; stderr: string } {
  const outBuf: string[] = [];
  const errBuf: string[] = [];
  const code = run(args, {
    env: {
      HOME: join(home, '..'),
      CC_MASTER_HOME: home,
      CC_MASTER_HARNESS: 'claude-code',
      CLAUDE_CODE_SESSION_ID: SID,
    },
    out: (s: string) => outBuf.push(s),
    err: (s: string) => errBuf.push(s),
  });
  assert.equal(typeof code, 'number');
  return { code: code as number, stdout: outBuf.join('\n'), stderr: errBuf.join('\n') };
}

function json(stdout: string): any {
  return JSON.parse(stdout);
}

function artifactPath(home: string): string {
  return join(home, 'reports', 'status-report', 'boards', '20260708T120000Z-1.status-report.json');
}

test('render emits ccm/status-report/v1 and writes no artifact or board bytes', () => {
  const home = mkHome();
  const boardPath = seedBoard(home);
  const before = readFileSync(boardPath, 'utf8');

  const r = invoke(['status-report', 'render', '--json', '--as-of', '2026-07-08T12:01:02Z'], home);
  assert.equal(r.code, EXIT.OK, r.stderr);
  assert.equal(readFileSync(boardPath, 'utf8'), before, 'render leaves board byte-identical');
  assert.equal(existsSync(artifactPath(home)), false, 'render does not write report artifact');
  const env = json(r.stdout);
  assert.equal(env.schema, 'ccm/status-report/v1');
  assert.equal(env.artifact.freshness, 'rendered');
  assert.equal(env.report.summary.total, 4);
  assert.equal(env.report.summary.verified_done, 1);
  assert.equal(env.report.next_actions.ready_to_dispatch[0].id, 'T4');
  assert.equal(env.report.decisions.awaiting_user[0].id, 'T3');
});

test('write/show/watch write report artifacts without mutating board JSON', () => {
  const home = mkHome();
  const boardPath = seedBoard(home);
  const before = readFileSync(boardPath, 'utf8');

  const written = invoke(['status-report', 'write', '--json'], home);
  assert.equal(written.code, EXIT.OK, written.stderr);
  assert.equal(readFileSync(boardPath, 'utf8'), before, 'write leaves board byte-identical');
  assert.ok(existsSync(artifactPath(home)));
  const first = json(written.stdout);
  assert.equal(first.artifact.path, artifactPath(home));
  assert.equal(first.artifact.freshness, 'fresh');

  const shown = invoke(['status-report', 'show', '--json'], home);
  assert.equal(shown.code, EXIT.OK, shown.stderr);
  assert.equal(json(shown.stdout).artifact.input_hash, first.artifact.input_hash);
  assert.equal(readFileSync(boardPath, 'utf8'), before, 'show leaves board byte-identical');

  const watched = invoke(['status-report', 'watch', '--iterations', '1', '--json'], home);
  assert.equal(watched.code, EXIT.OK, watched.stderr);
  assert.equal(json(watched.stdout).artifact.path, artifactPath(home));
  assert.equal(readFileSync(boardPath, 'utf8'), before, 'watch tick leaves board byte-identical');
});

test('show refreshes stale artifacts when board hash changes', () => {
  const home = mkHome();
  const boardPath = seedBoard(home);
  const first = invoke(['status-report', 'write', '--json'], home);
  assert.equal(first.code, EXIT.OK, first.stderr);
  const firstHash = json(first.stdout).artifact.board_hash;

  const board = JSON.parse(readFileSync(boardPath, 'utf8'));
  board.tasks.push({ id: 'T5', title: 'New ready task', status: 'ready' });
  writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`, 'utf8');

  const shown = invoke(['status-report', 'show', '--json'], home);
  assert.equal(shown.code, EXIT.OK, shown.stderr);
  const env = json(shown.stdout);
  assert.notEqual(env.artifact.board_hash, firstHash);
  assert.equal(env.report.summary.total, 5);
});
