import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const REPO = process.cwd();
const SERVER = path.join(
  REPO,
  'plugin/src/skills/master-orchestrator-guide/canonical/scripts/view-server.js',
);
const SNAP_EXT = ['board', 'json'].join('.');

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

async function startServer(t, snapPath) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, CC_MASTER_BOARD: snapPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    child.kill('SIGTERM');
  });
  return new URL(await onceServerUrl(child));
}

function writeJsonFile(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function snapshotDir(dir) {
  return Object.fromEntries(
    readdirSync(dir)
      .sort()
      .map((file) => [file, readFileSync(path.join(dir, file), 'utf8')]),
  );
}

test('view-server preserves decision history and rich decision packages in the read model', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ccm-view-server-decisions-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const stem = '20260708T030000Z-1';
  const snapPath = path.join(dir, `${stem}.${SNAP_EXT}`);
  const decisionPackage = {
    ask_type: 'decision',
    prepared_at: '2026-07-08T03:00:00Z',
    inputs_hash: 'sha256:abc123',
    freshness: {
      deps: ['P1'],
      checked_at: '2026-07-08T03:00:00Z',
    },
    context_md: 'P1 has finished; choose the storage shape before P2 starts.',
    question: 'Which storage shape should P2 implement?',
    what_i_need: 'Pick exactly one option id.',
    why_it_matters: 'Downstream implementation depends on this boundary.',
    enter_cmd: `/cc-master:discuss D1 --board ${stem}`,
    options: [
      {
        id: 'sidecar-index',
        label: 'Sidecar index',
        rationale: 'Keeps board narrow waist unchanged.',
        tradeoffs: ['extra generated file', 'easy rollback'],
      },
      {
        id: 'split-shards',
        label: 'Split shards',
        rationale: 'Moves large boards into multiple files.',
        tradeoffs: ['larger migration', 'more write coordination'],
      },
    ],
    recommendation: {
      option_id: 'sidecar-index',
      confidence: 'medium',
    },
  };
  writeJsonFile(snapPath, {
    schema: 'cc-master/v2',
    goal: 'decision API regression',
    owner: { active: true, session_id: 's' },
    git: { worktree: '', branch: '' },
    tasks: [
      {
        id: 'D1',
        title: 'Choose storage shape',
        status: 'blocked',
        blocked_on: 'user',
        deps: ['P1'],
        decision_package: decisionPackage,
      },
      { id: 'D2', title: 'Malformed sidecar owner', status: 'ready', deps: [] },
    ],
  });

  writeFileSync(
    path.join(dir, `${stem}--D1--20260708T030001Z.decision.md`),
    [
      '---',
      'node_id: D1',
      'ask_type: decision',
      'resolved_at: 2026-07-08T03:00:01Z',
      '---',
      '',
      '## TL;DR',
      'First discussion narrowed the choice.',
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(dir, `${stem}--D1--20260708T030002Z.decision.md`),
    [
      '---',
      'node_id: D1',
      'ask_type: decision',
      'resolved_at: 2026-07-08T03:00:02Z',
      '---',
      '',
      '## TL;DR',
      'Final answer: use sidecar-index.',
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(dir, `${stem}--D2--20260708T030003Z.decision.md`),
    [
      'not frontmatter',
      '',
      '## TL;DR',
      'Malformed sidecar still degrades to filename attribution.',
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(dir, 'other-board--D1--20260708T030004Z.decision.md'),
    '---\nnode_id: D1\nresolved_at: 2026-07-08T03:00:04Z\n---\n\n## TL;DR\nWrong board.\n',
  );
  const before = snapshotDir(dir);

  const serverUrl = await startServer(t, snapPath);

  const noToken = await fetch(new URL('/decisions.json', serverUrl.origin));
  assert.equal(noToken.status, 403);

  const post = await fetch(new URL(`/decisions.json${serverUrl.search}`, serverUrl.origin), {
    method: 'POST',
  });
  assert.equal(post.status, 405);

  const decisionsRes = await fetch(new URL(`/decisions.json${serverUrl.search}`, serverUrl.origin));
  assert.equal(decisionsRes.status, 200);
  const decisions = await decisionsRes.json();
  assert.deepEqual(decisions.map((row) => [row.node_id, row.round, row.tldr]), [
    ['D1', 1, 'First discussion narrowed the choice.'],
    ['D1', 2, 'Final answer: use sidecar-index.'],
    ['D2', 1, 'Malformed sidecar still degrades to filename attribution.'],
  ]);
  assert.deepEqual(decisions.map((row) => row.file), [
    `${stem}--D1--20260708T030001Z.decision.md`,
    `${stem}--D1--20260708T030002Z.decision.md`,
    `${stem}--D2--20260708T030003Z.decision.md`,
  ]);
  assert.equal(decisions[2].resolved_at, '');
  assert.equal(decisions[2].ask_type, '');

  const viewModelRes = await fetch(new URL(`/view-model.json${serverUrl.search}`, serverUrl.origin));
  assert.equal(viewModelRes.status, 200);
  const viewModel = await viewModelRes.json();
  assert.equal(viewModel.decisions.count, 3);
  assert.deepEqual(viewModel.decisions.countsByNode, { D1: 2, D2: 1 });
  assert.equal(viewModel.decisions.latestByNode.D1.tldr, 'Final answer: use sidecar-index.');
  assert.equal(viewModel.decisions.latestByNode.D2.tldr, 'Malformed sidecar still degrades to filename attribution.');
  assert.deepEqual(viewModel.tasks.find((task) => task.id === 'D1').decision_package, decisionPackage);

  assert.deepEqual(snapshotDir(dir), before);
});

test('view-server decisions read model degrades to empty history when no sidecars exist', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ccm-view-server-decisions-empty-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const snapPath = path.join(dir, `20260708T040000Z-1.${SNAP_EXT}`);
  writeJsonFile(snapPath, {
    schema: 'cc-master/v2',
    goal: 'empty decision history',
    owner: { active: true, session_id: 's' },
    git: { worktree: '', branch: '' },
    tasks: [{ id: 'T1', status: 'ready', deps: [] }],
  });
  const before = snapshotDir(dir);

  const serverUrl = await startServer(t, snapPath);

  const decisionsRes = await fetch(new URL(`/decisions.json${serverUrl.search}`, serverUrl.origin));
  assert.equal(decisionsRes.status, 200);
  assert.deepEqual(await decisionsRes.json(), []);

  const viewModelRes = await fetch(new URL(`/view-model.json${serverUrl.search}`, serverUrl.origin));
  assert.equal(viewModelRes.status, 200);
  const viewModel = await viewModelRes.json();
  assert.deepEqual(viewModel.decisions, {
    count: 0,
    countsByNode: {},
    latestByNode: {},
    latest: [],
  });

  assert.deepEqual(snapshotDir(dir), before);
});
