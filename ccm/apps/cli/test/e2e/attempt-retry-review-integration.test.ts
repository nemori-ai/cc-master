import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, '..', '..');
const BIN = join(PKG_ROOT, 'bin', 'ccm.cjs');
const DIST = join(PKG_ROOT, 'dist', 'index.cjs');
const SID = 'attempt-retry-review-integration';

before(() => {
  if (!existsSync(DIST)) {
    execFileSync('pnpm', ['build'], { cwd: PKG_ROOT, stdio: 'inherit' });
  }
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

function seed(tasks: unknown[]): { home: string; boardPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'ccm-attempt-review-'));
  roots.push(root);
  const home = join(root, '.cc_master');
  const boardsDir = join(home, 'boards');
  mkdirSync(boardsDir, { recursive: true });
  const boardPath = join(boardsDir, '2026-07-13-integration.board.json');
  writeFileSync(
    boardPath,
    `${JSON.stringify(
      {
        schema: 'cc-master/v2',
        meta: { template_version: 3 },
        goal: 'attempt retry and review gate integration',
        owner: { active: true, session_id: SID, heartbeat: '2026-07-13T00:00:00Z' },
        git: { worktree: '', branch: '' },
        scheduling: { wip_limit: 8 },
        tasks,
        log: [],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return { home, boardPath };
}

function run(home: string, args: string[]) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CC_MASTER_HOME: home,
    CC_MASTER_HARNESS: 'claude-code',
    CLAUDE_CODE_SESSION_ID: SID,
  };
  delete env.CC_MASTER_BOARD;
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CODEX_HOME;
  delete env.CODEX_SESSION_ID;
  delete env.CODEX_THREAD_ID;
  const result = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function readBoard(boardPath: string): Record<string, any> {
  return JSON.parse(readFileSync(boardPath, 'utf8'));
}

function task(board: Record<string, any>, id: string): Record<string, any> {
  return board.tasks.find((entry: Record<string, any>) => entry.id === id);
}

function archivedRetryDetails(board: Record<string, any>, id: string): Record<string, any>[] {
  return board.log
    .filter((entry: Record<string, any>) => entry.task === id && entry.kind === 'replan')
    .map((entry: Record<string, any>) => JSON.parse(entry.detail))
    .filter((detail: Record<string, any>) => detail.schema === 'ccm/task-retry/v1');
}

test('old APPROVE is archived before reset and only a new-attempt APPROVE unlocks downstream', () => {
  const { home, boardPath } = seed([
    {
      id: 'REVIEW',
      status: 'stale',
      deps: [],
      dependency_gate: { kind: 'review', required_verdict: 'APPROVE' },
      review_verdict: 'APPROVE',
      started_at: '2026-07-12T10:00:00Z',
      finished_at: '2026-07-12T11:00:00Z',
      artifact: '/abs/review-v1.md',
      verified: true,
    },
    { id: 'DOWNSTREAM', status: 'blocked', deps: ['REVIEW'] },
  ]);

  const retried = run(home, ['task', 'retry', 'REVIEW']);
  assert.equal(retried.status, 0, retried.stderr);
  let board = readBoard(boardPath);
  assert.equal(task(board, 'REVIEW').status, 'ready');
  assert.equal(Object.hasOwn(task(board, 'REVIEW'), 'review_verdict'), false);
  assert.equal(task(board, 'REVIEW').artifact, undefined);
  assert.equal(task(board, 'REVIEW').verified, false);
  assert.equal(task(board, 'DOWNSTREAM').status, 'blocked');

  const archived = archivedRetryDetails(board, 'REVIEW');
  assert.equal(archived.length, 1);
  const archivedAttempt = archived[0];
  assert.ok(archivedAttempt);
  assert.deepEqual(archivedAttempt.prior_evidence, {
    started_at: '2026-07-12T10:00:00Z',
    finished_at: '2026-07-12T11:00:00Z',
    artifact: '/abs/review-v1.md',
    verified: true,
    review_verdict: 'APPROVE',
  });

  const repeated = run(home, ['task', 'retry', 'REVIEW']);
  assert.equal(repeated.status, 3, repeated.stderr);
  board = readBoard(boardPath);
  assert.equal(archivedRetryDetails(board, 'REVIEW').length, 1, 'failed repeat adds no archive');

  assert.equal(run(home, ['task', 'start', 'REVIEW']).status, 0);
  const noVerdict = run(home, [
    'task',
    'done',
    'REVIEW',
    '--verified',
    '--artifact',
    '/abs/review-v2.md',
  ]);
  assert.equal(noVerdict.status, 0, noVerdict.stderr);
  board = readBoard(boardPath);
  assert.equal(Object.hasOwn(task(board, 'REVIEW'), 'review_verdict'), false);
  assert.equal(task(board, 'DOWNSTREAM').status, 'blocked');

  const requestChanges = run(home, [
    'task',
    'done',
    'REVIEW',
    '--verified',
    '--artifact',
    '/abs/review-v2.md',
    '--review-verdict',
    'REQUEST-CHANGES',
  ]);
  assert.equal(requestChanges.status, 0, requestChanges.stderr);
  board = readBoard(boardPath);
  assert.equal(task(board, 'REVIEW').review_verdict, 'REQUEST-CHANGES');
  assert.equal(task(board, 'DOWNSTREAM').status, 'blocked');

  const approved = run(home, [
    'task',
    'done',
    'REVIEW',
    '--verified',
    '--artifact',
    '/abs/review-v2.md',
    '--review-verdict',
    'APPROVE',
  ]);
  assert.equal(approved.status, 0, approved.stderr);
  board = readBoard(boardPath);
  assert.equal(task(board, 'REVIEW').review_verdict, 'APPROVE');
  assert.equal(task(board, 'DOWNSTREAM').status, 'ready');
});

test('batch retry archives each verdict, preserves legacy deps, and rolls back an invalid mixed batch', () => {
  const review = (id: string) => ({
    id,
    status: 'stale',
    deps: [],
    dependency_gate: { kind: 'review', required_verdict: 'APPROVE' },
    review_verdict: 'APPROVE',
    artifact: `/abs/${id}.md`,
    verified: true,
  });
  const { home, boardPath } = seed([
    review('R1'),
    review('R2'),
    { id: 'BOTH', status: 'blocked', deps: ['R1', 'R2'] },
    { id: 'LEGACY', status: 'done', deps: [], artifact: '/abs/legacy.md', verified: true },
    { id: 'LEGACY-DOWNSTREAM', status: 'blocked', deps: ['LEGACY'] },
    review('ROLLBACK'),
    { id: 'NOT-RETRYABLE', status: 'ready', deps: [] },
  ]);

  const valid = run(home, ['task', 'retry', 'R1', 'R2']);
  assert.equal(valid.status, 0, valid.stderr);
  let board = readBoard(boardPath);
  for (const id of ['R1', 'R2']) {
    assert.equal(Object.hasOwn(task(board, id), 'review_verdict'), false);
    assert.equal(archivedRetryDetails(board, id).at(0)?.prior_evidence?.review_verdict, 'APPROVE');
  }
  assert.equal(task(board, 'BOTH').status, 'blocked');
  assert.equal(task(board, 'LEGACY-DOWNSTREAM').status, 'ready');

  const beforeInvalid = readFileSync(boardPath, 'utf8');
  const invalid = run(home, ['task', 'retry', 'ROLLBACK', 'NOT-RETRYABLE']);
  assert.equal(invalid.status, 3, invalid.stderr);
  assert.equal(
    readFileSync(boardPath, 'utf8'),
    beforeInvalid,
    'mixed invalid batch is byte-stable',
  );
  board = readBoard(boardPath);
  assert.equal(task(board, 'ROLLBACK').review_verdict, 'APPROVE');
  assert.equal(archivedRetryDetails(board, 'ROLLBACK').length, 0);
});
