import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const REPO = process.cwd();
const SERVER = path.join(
  REPO,
  'plugin/src/skills/master-orchestrator-guide/canonical/scripts/view-server.js',
);

function onceServerUrl(child) {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const timer = setTimeout(() => reject(new Error(`server did not print URL; stderr=${err}`)), 5000);
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
      const m = out.match(/cc-master board view: (http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    child.stderr.on('data', (chunk) => {
      err += String(chunk);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited before URL; code=${code}; stderr=${err}`));
    });
  });
}

async function startServer(t, board, extraEnv = {}) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ...extraEnv, CC_MASTER_BOARD: board },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    child.kill('SIGTERM');
  });
  return new URL(await onceServerUrl(child));
}

function writeBoard(file, board) {
  writeFileSync(file, `${JSON.stringify(board, null, 2)}\n`);
}

function isoSeconds(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function boardFixture(goal, owner, tasks, extra = {}) {
  return {
    schema: 'cc-master/v2',
    goal,
    owner,
    git: { worktree: '/repo', branch: goal.toLowerCase().replaceAll(' ', '-') },
    tasks,
    ...extra,
  };
}

test('view-server exposes token-gated multiboard summaries and marks current board', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'ccm-view-server-multiboard-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const boardsDir = path.join(home, 'boards');
  mkdirSync(boardsDir, { recursive: true });

  const current = path.join(boardsDir, '20260708T010000Z-1.board.json');
  const peer = path.join(boardsDir, '20260708T010100Z-2.board.json');
  const inactive = path.join(boardsDir, '20260708T010200Z-3.board.json');
  const now = Date.now();
  const currentHeartbeat = isoSeconds(now - 1000);
  const peerHeartbeat = isoSeconds(now - 5000);
  const inactiveHeartbeat = isoSeconds(now - 10000);

  writeBoard(current, boardFixture(
    'Current Goal',
    { active: true, session_id: 'current-session', heartbeat: currentHeartbeat },
    [
      { id: 'A', status: 'done', deps: [] },
      { id: 'B', status: 'in_flight', deps: ['A'] },
      { id: 'C', status: 'blocked', deps: ['B'], blocked_on: 'user' },
    ],
    {
      coordination: {
        priority: 'high',
        state: {
          current: { active_tasks: 2, workload: 'viewer service slice', burn_contribution: 3 },
          planned: { remaining_work: 'frontend wiring', cost_to_complete_pct: 8 },
        },
      },
    },
  ));
  writeBoard(peer, boardFixture(
    'Peer Goal',
    { active: true, session_id: 'peer-session', heartbeat: peerHeartbeat },
    [
      { id: 'P1', status: 'ready', deps: [] },
      { id: 'P2', status: 'in_flight', deps: ['P1'] },
    ],
    {
      coordination: {
        priority: 'urgent',
        state: {
          current: { active_tasks: 1, workload: 'parallel peer' },
          planned: { remaining_work: 'one task', cost_to_complete_pct: 5 },
        },
      },
    },
  ));
  writeFileSync(
    path.join(boardsDir, '20260708T010100Z-2--P1--20260708T010101Z.decision.md'),
    '---\nnode_id: P1\nask_type: unblock\nresolved_at: 2026-07-08T01:01:01Z\n---\n\n## TL;DR\nPeer decision only.\n',
  );
  writeBoard(inactive, boardFixture(
    'Inactive Goal',
    { active: false, session_id: 'old-session', heartbeat: inactiveHeartbeat },
    [{ id: 'I1', status: 'ready', deps: [] }],
  ));

  const serverUrl = await startServer(t, current, { CC_MASTER_HOME: home });

  const noToken = await fetch(new URL('/boards.json', serverUrl.origin));
  assert.equal(noToken.status, 403);

  const post = await fetch(new URL(`/boards.json${serverUrl.search}`, serverUrl.origin), {
    method: 'POST',
  });
  assert.equal(post.status, 405);

  const boardsRes = await fetch(new URL(`/boards.json${serverUrl.search}`, serverUrl.origin));
  assert.equal(boardsRes.status, 200);
  assert.match(boardsRes.headers.get('etag') || '', /^"boards-[a-f0-9]{32}"$/);
  const boards = await boardsRes.json();
  assert.equal(boards.available, true);
  assert.equal(boards.count, 3);
  assert.equal(boards.current.file, path.basename(current));
  assert.deepEqual(boards.boards.map((b) => b.file), [
    path.basename(inactive),
    path.basename(peer),
    path.basename(current),
  ]);

  const currentRow = boards.boards.find((b) => b.current);
  assert.equal(currentRow.file, path.basename(current));
  assert.equal(currentRow.goal, 'Current Goal');
  assert.equal(currentRow.active, true);
  assert.equal(currentRow.owner.session_id, 'current-session');
  assert.equal(currentRow.owner.heartbeat, currentHeartbeat);
  assert.equal(typeof currentRow.owner.heartbeat_age_sec, 'number');
  assert.equal(typeof currentRow.owner.heartbeat_fresh, 'boolean');
  assert.equal(currentRow.git.worktree, '/repo');
  assert.equal(currentRow.git.branch, 'current-goal');
  assert.deepEqual(currentRow.tasks.status_counts, { done: 1, in_flight: 1, blocked: 1 });
  assert.equal(currentRow.tasks.total, 3);
  assert.equal(currentRow.tasks.open, 2);
  assert.equal(currentRow.tasks.done, 1);
  assert.equal(currentRow.tasks.summary, '3 tasks; done=1, in_flight=1, blocked=1');
  assert.match(currentRow.rev.boardHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(typeof currentRow.rev.mtimeMs, 'number');
  assert.equal(typeof currentRow.rev.size, 'number');

  const peersRes = await fetch(new URL(`/peers.json${serverUrl.search}`, serverUrl.origin));
  assert.equal(peersRes.status, 200);
  assert.match(peersRes.headers.get('etag') || '', /^"peers-[a-f0-9]{32}"$/);
  const peers = await peersRes.json();
  assert.equal(peers.available, true);
  assert.equal(peers.freshness_sec, 600);
  assert.equal(peers.count, 2);
  assert.deepEqual(peers.peers.map((p) => p.board_file), [path.basename(peer), path.basename(current)]);
  assert.equal(peers.peers[0].priority, 'urgent');
  assert.equal(peers.peers[0].current.workload, 'parallel peer');
  assert.equal(peers.peers[0].current.active_tasks, 1);
  assert.equal(peers.peers[0].planned.remaining_work, 'one task');
  assert.equal(peers.peers[0].planned.cost_to_complete_pct, 5);

  const peerQuery = new URLSearchParams(serverUrl.search);
  peerQuery.set('board', path.basename(peer));

  const selectedBoardRes = await fetch(new URL(`/board.json?${peerQuery}`, serverUrl.origin));
  assert.equal(selectedBoardRes.status, 200);
  const selectedBoard = await selectedBoardRes.json();
  assert.equal(selectedBoard.goal, 'Peer Goal');
  assert.deepEqual(selectedBoard.tasks.map((task) => task.id), ['P1', 'P2']);

  const selectedModelRes = await fetch(new URL(`/view-model.json?${peerQuery}`, serverUrl.origin));
  assert.equal(selectedModelRes.status, 200);
  const selectedModel = await selectedModelRes.json();
  assert.equal(selectedModel.board.goal, 'Peer Goal');
  assert.equal(selectedModel.board.source, peer);
  assert.deepEqual(selectedModel.tasks.map((task) => task.id), ['P1', 'P2']);

  const selectedDecisionsRes = await fetch(new URL(`/decisions.json?${peerQuery}`, serverUrl.origin));
  assert.equal(selectedDecisionsRes.status, 200);
  assert.deepEqual((await selectedDecisionsRes.json()).map((decision) => decision.node_id), ['P1']);

  const traversal = new URLSearchParams(serverUrl.search);
  traversal.set('board', '../20260708T010100Z-2.board.json');
  const badBoardRes = await fetch(new URL(`/board.json?${traversal}`, serverUrl.origin));
  assert.equal(badBoardRes.status, 404);
});

test('view-server multiboard routes degrade gracefully for empty home and unavailable peers engine', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'ccm-view-server-empty-home-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const boardDir = path.join(root, 'current-board');
  const emptyHome = path.join(root, 'empty-home');
  mkdirSync(boardDir, { recursive: true });
  mkdirSync(emptyHome, { recursive: true });
  const current = path.join(boardDir, '20260708T020000Z-1.board.json');
  writeBoard(current, boardFixture(
    'Outside Home',
    { active: true, session_id: 'outside', heartbeat: isoSeconds(Date.now() - 1000) },
    [{ id: 'O1', status: 'ready', deps: [] }],
  ));

  const serverUrl = await startServer(t, current, {
    CC_MASTER_HOME: emptyHome,
    CC_MASTER_VIEW_DISABLE_ENGINE: '1',
  });

  const boardsRes = await fetch(new URL(`/boards.json${serverUrl.search}`, serverUrl.origin));
  assert.equal(boardsRes.status, 200);
  const boards = await boardsRes.json();
  assert.equal(boards.available, true);
  assert.equal(boards.count, 0);
  assert.deepEqual(boards.boards, []);
  assert.equal(boards.current.file, path.basename(current));
  assert.equal(boards.current.in_list, false);

  const peersNoToken = await fetch(new URL('/peers.json', serverUrl.origin));
  assert.equal(peersNoToken.status, 403);

  const peersPost = await fetch(new URL(`/peers.json${serverUrl.search}`, serverUrl.origin), {
    method: 'POST',
  });
  assert.equal(peersPost.status, 405);

  const peersRes = await fetch(new URL(`/peers.json${serverUrl.search}`, serverUrl.origin));
  assert.equal(peersRes.status, 200);
  const peers = await peersRes.json();
  assert.equal(peers.available, false);
  assert.equal(peers.count, 0);
  assert.deepEqual(peers.peers, []);
  assert.match(peers.error, /disabled|unavailable|engine/i);
});
