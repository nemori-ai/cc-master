import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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

function assertHardeningHeaders(headers) {
  const csp = headers.get('content-security-policy') || '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self' 'nonce-[A-Za-z0-9_-]+'/);
  assert.match(csp, /style-src 'self' 'nonce-[A-Za-z0-9_-]+'/);
  assert.match(csp, /style-src-attr 'unsafe-inline'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(/script-src[^;]*unsafe-inline/.test(csp), false);
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  assert.equal(headers.get('cache-control'), 'no-store');
  assert.equal(headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(headers.get('x-frame-options'), 'DENY');
}

test('view-server hardens responses and gates private JSON behind per-launch token', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ccm-view-server-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const board = path.join(dir, '20260706T000000Z-1.board.json');
  writeFileSync(board, JSON.stringify({
    schema: 'cc-master/v2',
    goal: 'local view hardening',
    owner: { active: true, session_id: 's' },
    git: { worktree: '', branch: '' },
    tasks: [{ id: 'T1', status: 'ready', deps: [] }],
  }));
  writeFileSync(
    path.join(dir, '20260706T000000Z-1--T1--20260706T000001Z.decision.md'),
    '---\nnode_id: T1\nask_type: unblock\nresolved_at: 2026-07-06T00:00:01Z\n---\n\n## TL;DR\nProceed.\n',
  );

  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, CC_MASTER_BOARD: board },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    child.kill('SIGTERM');
  });

  const url = await onceServerUrl(child);
  const parsed = new URL(url);
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.ok(parsed.searchParams.get('token'));

  const html = await fetch(url);
  assert.equal(html.status, 200);
  assertHardeningHeaders(html.headers);
  const htmlText = await html.text();
  assert.match(htmlText, /<style nonce="[A-Za-z0-9_-]+">/);
  assert.match(htmlText, /<script type="importmap" nonce="[A-Za-z0-9_-]+">/);
  assert.match(htmlText, /<script type="module" nonce="[A-Za-z0-9_-]+">/);
  assert.match(htmlText, /fetch\(serverUrl\('\/board\.json'\)/);
  assert.match(htmlText, /fetch\(serverUrl\('\/decisions\.json'\)/);

  const rootNoToken = await fetch(`${parsed.origin}/`);
  assert.equal(rootNoToken.status, 403);
  assertHardeningHeaders(rootNoToken.headers);

  const boardNoToken = await fetch(`${parsed.origin}/board.json`);
  assert.equal(boardNoToken.status, 403);
  assertHardeningHeaders(boardNoToken.headers);

  const badToken = await fetch(`${parsed.origin}/board.json?token=wrong`);
  assert.equal(badToken.status, 403);
  assertHardeningHeaders(badToken.headers);

  const boardWithToken = await fetch(new URL(`/board.json${parsed.search}`, parsed.origin));
  assert.equal(boardWithToken.status, 200);
  assertHardeningHeaders(boardWithToken.headers);
  assert.match(boardWithToken.headers.get('etag') || '', /^"board-[a-f0-9]{32}"$/);
  const boardEtag = boardWithToken.headers.get('etag');
  assert.deepEqual((await boardWithToken.json()).tasks.map((task) => task.id), ['T1']);

  const boardNotModified = await fetch(new URL(`/board.json${parsed.search}`, parsed.origin), {
    headers: { 'If-None-Match': boardEtag },
  });
  assert.equal(boardNotModified.status, 304);
  assertHardeningHeaders(boardNotModified.headers);

  const viewModelNoToken = await fetch(`${parsed.origin}/view-model.json`);
  assert.equal(viewModelNoToken.status, 403);
  assertHardeningHeaders(viewModelNoToken.headers);

  const viewModelPost = await fetch(new URL(`/view-model.json${parsed.search}`, parsed.origin), {
    method: 'POST',
  });
  assert.equal(viewModelPost.status, 405);
  assertHardeningHeaders(viewModelPost.headers);

  const viewModelWithToken = await fetch(new URL(`/view-model.json${parsed.search}`, parsed.origin));
  assert.equal(viewModelWithToken.status, 200);
  assertHardeningHeaders(viewModelWithToken.headers);
  assert.match(viewModelWithToken.headers.get('etag') || '', /^"view-model-[a-f0-9]{32}"$/);
  const viewModel = await viewModelWithToken.json();
  assert.equal(viewModel.rev.boardHash.startsWith('sha256:'), true);
  assert.equal(viewModel.rev.topologyHash.startsWith('sha256:'), true);
  assert.equal(typeof viewModel.rev.mtimeMs, 'number');
  assert.equal(typeof viewModel.rev.size, 'number');
  assert.equal(typeof viewModel.rev.generatedAt, 'string');
  assert.equal(viewModel.board.schema, 'cc-master/v2');
  assert.equal(viewModel.board.goal, 'local view hardening');
  assert.equal(viewModel.board.source, board);
  assert.deepEqual(viewModel.summary.statusCounts.ready, 1);
  assert.deepEqual(viewModel.summary.readySet, ['T1']);
  assert.deepEqual(viewModel.summary.criticalPath.chain, ['T1']);
  assert.equal(typeof viewModel.summary.lint.errors, 'number');
  assert.equal(typeof viewModel.summary.lint.warnings, 'number');
  assert.equal(viewModel.summary.awaitingUserCount, 0);
  assert.deepEqual(viewModel.tasks.map((task) => task.id), ['T1']);
  assert.equal(viewModel.graph.nodeCount, 1);
  assert.equal(viewModel.graph.edgeCount, 0);
  assert.deepEqual(viewModel.graph.topoOrder, ['T1']);
  assert.equal(viewModel.decisions.count, 1);
  assert.deepEqual(viewModel.decisions.countsByNode, { T1: 1 });
  assert.equal(viewModel.decisions.latestByNode.T1.tldr, 'Proceed.');
  assert.equal(viewModel.diagnostics.engineLoaded, true);
  assert.equal(typeof viewModel.diagnostics.timingsMs.total, 'number');

  const viewModelNotModified = await fetch(new URL(`/view-model.json${parsed.search}`, parsed.origin), {
    headers: { 'If-None-Match': viewModelWithToken.headers.get('etag') },
  });
  assert.equal(viewModelNotModified.status, 304);
  assertHardeningHeaders(viewModelNotModified.headers);

  const decisionsWithToken = await fetch(new URL(`/decisions.json${parsed.search}`, parsed.origin));
  assert.equal(decisionsWithToken.status, 200);
  assertHardeningHeaders(decisionsWithToken.headers);
  assert.deepEqual((await decisionsWithToken.json()).map((decision) => decision.node_id), ['T1']);

  const vendor = await fetch(`${parsed.origin}/vendor/xyflow-style.css`);
  assert.equal(vendor.status, 200);
  assertHardeningHeaders(vendor.headers);

  const traversal = await fetch(`${parsed.origin}/vendor/..%2Fview-server.js`);
  assert.equal(traversal.status, 404);
  assertHardeningHeaders(traversal.headers);
});
