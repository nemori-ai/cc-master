// agent-probe.test.ts — Agent Registry S2 探测适配器（agent-probe.ts）契约门。
//   证：按 handle 类型分级探测、mtime freshness → alive/silent/gone、拿不到 = unknown（保真·不推导）、
//   以及 reconcileAgentState 的观测降级语义。会话根目录经 env 覆写注入临时 home。

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { probeAgent, reconcileAgentState } from '../src/agent-probe.js';

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

const NOW = Date.parse('2026-07-16T12:00:00Z');

// ── pid ────────────────────────────────────────────────────────────────────────────────────────
test('pid probe: injected alive/gone/unknown', () => {
  const alive = probeAgent(
    { handleKind: 'pid', handleValue: '123' },
    { pidProbe: () => 'alive', nowMs: NOW },
  );
  assert.deepEqual(alive, { method: 'pid', observed: 'alive' });
  const gone = probeAgent(
    { handleKind: 'pid', handleValue: '123' },
    { pidProbe: () => 'gone', nowMs: NOW },
  );
  assert.deepEqual(gone, { method: 'pid', observed: 'gone' });
});

test('pid probe: non-numeric handle → unknown (never guesses)', () => {
  const r = probeAgent({ handleKind: 'pid', handleValue: 'notapid' }, { nowMs: NOW });
  assert.deepEqual(r, { method: 'pid', observed: 'unknown' });
});

test('pid probe: real live process is alive, killed process is gone', async () => {
  const { spawn } = await import('node:child_process');
  const child = spawn('sleep', ['30'], { detached: true });
  const pid = child.pid as number;
  const alive = probeAgent({ handleKind: 'pid', handleValue: String(pid) }, { nowMs: NOW });
  assert.equal(alive.observed, 'alive');
  process.kill(pid, 'SIGKILL');
  await new Promise((r) => setTimeout(r, 150));
  const gone = probeAgent({ handleKind: 'pid', handleValue: String(pid) }, { nowMs: NOW });
  assert.equal(gone.observed, 'gone');
});

// ── codex session-id ─────────────────────────────────────────────────────────────────────────────
function mkCodexSession(home: string, sid: string, mtimeMs: number): void {
  const dir = join(home, '.codex', 'sessions', '2026', '07', '16');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `rollout-2026-07-16T12-00-00-${sid}.jsonl`);
  writeFileSync(f, '{}\n');
  utimesSync(f, mtimeMs / 1000, mtimeMs / 1000);
}

test('codex session-id: fresh mtime → alive, stale → silent, missing → gone', () => {
  const home = mkTmp('ccm-probe-cx-');
  mkCodexSession(home, 'sid-fresh', NOW - 60_000); // 1min old
  const fresh = probeAgent(
    { harness: 'codex', handleKind: 'session-id', handleValue: 'sid-fresh' },
    { home, nowMs: NOW },
  );
  assert.deepEqual(fresh, { method: 'session-file-mtime', observed: 'alive' });

  mkCodexSession(home, 'sid-stale', NOW - 3600_000); // 1h old > 300s
  const stale = probeAgent(
    { harness: 'codex', handleKind: 'session-id', handleValue: 'sid-stale' },
    { home, nowMs: NOW },
  );
  assert.equal(stale.observed, 'silent');

  const missing = probeAgent(
    { harness: 'codex', handleKind: 'session-id', handleValue: 'sid-nope' },
    { home, nowMs: NOW },
  );
  assert.equal(missing.observed, 'gone');
});

test('codex session-id: CODEX_HOME env overrides home root', () => {
  const codexHome = mkTmp('ccm-probe-cxenv-');
  const dir = join(codexHome, 'sessions', '2026');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `rollout-x-envsid.jsonl`);
  writeFileSync(f, '{}\n');
  utimesSync(f, (NOW - 30_000) / 1000, (NOW - 30_000) / 1000);
  const r = probeAgent(
    { harness: 'codex', handleKind: 'session-id', handleValue: 'envsid' },
    { env: { CODEX_HOME: codexHome }, nowMs: NOW },
  );
  assert.deepEqual(r, { method: 'session-file-mtime', observed: 'alive' });
});

// ── claude-code session-id ─────────────────────────────────────────────────────────────────────────
test('claude-code session-id: ~/.claude/projects/<slug>/<sid>.jsonl mtime', () => {
  const home = mkTmp('ccm-probe-cc-');
  const dir = join(home, '.claude', 'projects', '-abs-repo-slug');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'ccsid-1.jsonl');
  writeFileSync(f, '{}\n');
  utimesSync(f, (NOW - 30_000) / 1000, (NOW - 30_000) / 1000);
  const r = probeAgent(
    { harness: 'claude-code', handleKind: 'session-id', handleValue: 'ccsid-1' },
    { home, nowMs: NOW },
  );
  assert.deepEqual(r, { method: 'session-file-mtime', observed: 'alive' });
  const missing = probeAgent(
    { harness: 'claude-code', handleKind: 'session-id', handleValue: 'nope' },
    { home, nowMs: NOW },
  );
  assert.equal(missing.observed, 'gone');
});

test('session-id on unknown harness → method none, observed unknown (no path guessing)', () => {
  const r = probeAgent(
    { harness: 'cursor-agent', handleKind: 'session-id', handleValue: 'x' },
    { nowMs: NOW },
  );
  assert.deepEqual(r, { method: 'none', observed: 'unknown' });
});

// ── task-id / subagent transcript ──────────────────────────────────────────────────────────────────
test('task-id/subagent: transcript path present → mtime; absent → unknown', () => {
  const home = mkTmp('ccm-probe-tr-');
  const f = join(home, 'transcript.jsonl');
  writeFileSync(f, '{}\n');
  utimesSync(f, (NOW - 30_000) / 1000, (NOW - 30_000) / 1000);
  const r = probeAgent(
    { type: 'subagent', handleKind: 'task-id', handleValue: 'T1', transcriptRef: f },
    { nowMs: NOW },
  );
  assert.deepEqual(r, { method: 'transcript-mtime', observed: 'alive' });
  const noRef = probeAgent(
    { type: 'subagent', handleKind: 'task-id', handleValue: 'T1' },
    { nowMs: NOW },
  );
  assert.deepEqual(noRef, { method: 'none', observed: 'unknown' });
  const missingRef = probeAgent(
    { type: 'subagent', handleKind: 'task-id', transcriptRef: join(home, 'gone.jsonl') },
    { nowMs: NOW },
  );
  assert.equal(missingRef.observed, 'gone');
});

test('no handle → method none, observed unknown', () => {
  assert.deepEqual(probeAgent({ handleKind: 'none' }, { nowMs: NOW }), {
    method: 'none',
    observed: 'unknown',
  });
});

// ── reconcileAgentState ───────────────────────────────────────────────────────────────────────────
test('reconcileAgentState: active states downgrade on observation', () => {
  assert.equal(reconcileAgentState('running', 'gone'), 'orphaned');
  assert.equal(reconcileAgentState('running', 'silent'), 'uncertain');
  assert.equal(reconcileAgentState('running', 'alive'), 'running');
  assert.equal(reconcileAgentState('running', 'unknown'), 'running'); // 保真·不改
  assert.equal(reconcileAgentState('uncertain', 'alive'), 'running'); // 复活
  assert.equal(reconcileAgentState('uncertain', 'gone'), 'orphaned');
  assert.equal(reconcileAgentState('starting', 'alive'), 'running');
});

test('reconcileAgentState: terminal and orphaned are not auto-resurrected', () => {
  assert.equal(reconcileAgentState('terminal', 'alive'), 'terminal');
  assert.equal(reconcileAgentState('orphaned', 'alive'), 'orphaned');
});
