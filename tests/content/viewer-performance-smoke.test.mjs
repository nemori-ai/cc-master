import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLargeBoard, fixtureText } from '../../examples/viewer-performance/generate-large-board.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(ROOT, 'examples/viewer-performance/large-board.board.json');
const ENGINE_IIFE = join(
  ROOT,
  'plugin/src/skills/master-orchestrator-guide/canonical/scripts/vendor/ccm-engine.iife.js',
);
const SERVER = join(
  ROOT,
  'plugin/src/skills/master-orchestrator-guide/canonical/scripts/view-server.js',
);

const LIMITS_MS = {
  parse: 1_000,
  engineLoad: 1_500,
  lint: 2_000,
  graphAnalyze: 1_000,
  graphQueries: 1_500,
  boardJsonFetch: 2_000,
  viewModelFetch: 2_500,
  statusOnlyViewModelFetch: 2_500,
};

function timed(metrics, name, fn) {
  const started = performance.now();
  const value = fn();
  metrics[name] = Number((performance.now() - started).toFixed(3));
  return value;
}

async function timedAsync(metrics, name, fn) {
  const started = performance.now();
  const value = await fn();
  metrics[name] = Number((performance.now() - started).toFixed(3));
  return value;
}

function loadEngine() {
  const ctx = vm.createContext({});
  vm.runInContext('var globalThis = this;', ctx);
  vm.runInContext(readFileSync(ENGINE_IIFE, 'utf8'), ctx, { filename: 'ccm-engine.iife.js' });
  const engine = vm.runInContext(
    '(typeof __ccmEngine !== "undefined") ? __ccmEngine : (globalThis.__ccmEngine || null)',
    ctx,
  );
  assert.ok(engine && typeof engine.analyzeGraph === 'function', 'IIFE exposes analyzeGraph');
  assert.ok(typeof engine.lintBoard === 'function', 'IIFE exposes lintBoard');
  return engine;
}

function onceServerUrl(child) {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const timer = setTimeout(() => reject(new Error(`server did not print URL; stderr=${err}`)), 5_000);
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

function assertMetricUnder(metrics, name) {
  assert.ok(
    metrics[name] < LIMITS_MS[name],
    `${name} took ${metrics[name]}ms, expected < ${LIMITS_MS[name]}ms`,
  );
}

test('viewer performance fixture is generator-reproducible and exercises engine graph paths', () => {
  const metrics = {};
  const text = readFileSync(FIXTURE, 'utf8');
  assert.equal(text, fixtureText(), 'large-board fixture must stay in sync with generator');

  const board = timed(metrics, 'parse', () => JSON.parse(text));
  assert.equal(board.schema, 'cc-master/v2');
  assert.equal(board.tasks.length, 224);
  assert.ok(board.tasks.length >= 200, 'fixture has 200+ tasks');
  assert.ok(board.tasks.filter((task) => task.blocked_on === 'user' && task.decision_package).length >= 6);
  assert.ok(board.tasks.some((task) => task.parent), 'fixture includes nested owner/child nodes');

  const engine = timed(metrics, 'engineLoad', () => loadEngine());
  const lint = timed(metrics, 'lint', () => engine.lintBoard(text));
  assert.equal(lint.errors.length, 0, `fixture must have zero hard lint errors: ${JSON.stringify(lint.errors)}`);
  assert.equal(lint.warnings.length, 0, `fixture should be warning-clean for baseline clarity: ${JSON.stringify(lint.warnings)}`);

  const graph = timed(metrics, 'graphAnalyze', () => engine.analyzeGraph(board));
  timed(metrics, 'graphQueries', () => {
    const topo = graph.topoSort();
    assert.equal(topo.cycle, null);
    assert.equal(topo.order.length, board.tasks.length);
    assert.ok(graph.readySet().length >= 4);
    assert.equal(graph.wipStats().userGates, 6);
    assert.ok(graph.children('E06').length >= 10);
    assert.equal(graph.parentOf('E06.01'), 'E06');
    assert.ok(graph.longestPath().length > 10);
    assert.ok(graph.criticalPath({ now: Date.parse('2026-07-08T12:00:00Z') }).chain.length > 10);
    assert.ok(graph.parallelism().parallelism > 1);
  });

  for (const name of ['parse', 'engineLoad', 'lint', 'graphAnalyze', 'graphQueries']) {
    assertMetricUnder(metrics, name);
  }
  console.log(`# viewer-performance baseline ${JSON.stringify(metrics)}`);
});

test('viewer performance fixture is served through read-only board and view-model paths', async (t) => {
  const metrics = {};
  const dir = mkdtempSync(join(tmpdir(), 'ccm-viewer-performance-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const boardPath = join(dir, 'large-board.board.json');
  const board = createLargeBoard();
  writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`);

  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, CC_MASTER_BOARD: boardPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGTERM'));

  const url = await onceServerUrl(child);
  const parsed = new URL(url);

  const served = await timedAsync(metrics, 'boardJsonFetch', async () => {
    const res = await fetch(new URL(`/board.json${parsed.search}`, parsed.origin));
    assert.equal(res.status, 200);
    return res.json();
  });

  assert.equal(served.schema, 'cc-master/v2');
  assert.equal(served.tasks.length, 224);
  assertMetricUnder(metrics, 'boardJsonFetch');

  const viewModel = await timedAsync(metrics, 'viewModelFetch', async () => {
    const res = await fetch(new URL(`/view-model.json${parsed.search}`, parsed.origin));
    assert.equal(res.status, 200);
    return res.json();
  });
  assert.equal(viewModel.tasks.length, 224);
  assert.equal(viewModel.graph.nodeCount, 224);
  assert.equal(viewModel.rev.boardHash.startsWith('sha256:'), true);
  assert.equal(viewModel.rev.topologyHash.startsWith('sha256:'), true);
  assertMetricUnder(metrics, 'viewModelFetch');

  const statusOnlyBoard = JSON.parse(JSON.stringify(board));
  statusOnlyBoard.tasks[0].status = 'stale';
  statusOnlyBoard.tasks[0].reason = 'status-only topology contract probe';
  statusOnlyBoard.log.push({
    ts: '2026-07-08T12:30:00Z',
    kind: 'note',
    summary: 'Status-only update for viewer no-relayout smoke contract.',
  });
  writeFileSync(boardPath, `${JSON.stringify(statusOnlyBoard, null, 2)}\n`);

  const statusOnlyViewModel = await timedAsync(metrics, 'statusOnlyViewModelFetch', async () => {
    const res = await fetch(new URL(`/view-model.json${parsed.search}`, parsed.origin));
    assert.equal(res.status, 200);
    return res.json();
  });
  assert.notEqual(statusOnlyViewModel.rev.boardHash, viewModel.rev.boardHash, 'status/log-only update changes board hash');
  assert.equal(
    statusOnlyViewModel.rev.topologyHash,
    viewModel.rev.topologyHash,
    'status/log-only update keeps topology hash stable for no-relayout front-end contract',
  );
  assert.equal(statusOnlyViewModel.tasks.length, 224);
  assertMetricUnder(metrics, 'statusOnlyViewModelFetch');
  console.log(`# viewer-performance server baseline ${JSON.stringify(metrics)}`);
});
