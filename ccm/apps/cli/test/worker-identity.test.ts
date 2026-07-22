import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import {
  createWorkerIdentityTracker,
  explicitWorkerSessionIdentity,
  initialIdentityCapability,
  initialWorkerCapabilities,
  sessionCapabilities,
} from '../src/worker-identity.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('all four harnesses report truthful identity support before verified output arrives', () => {
  assert.deepEqual(initialIdentityCapability('codex'), {
    status: 'unavailable',
    reason: 'session-identity-not-yet-observed',
  });
  assert.deepEqual(initialIdentityCapability('claude-code'), {
    status: 'unavailable',
    reason: 'session-identity-not-yet-observed',
  });
  assert.deepEqual(initialIdentityCapability('kimi-code'), {
    status: 'unavailable',
    reason: 'session-identity-not-yet-observed',
  });
  const cursor = initialIdentityCapability('cursor-agent');
  assert.equal(cursor.status, 'unsupported');
  assert.ok('reason' in cursor && cursor.reason.length > 0);
});

test('Codex tracker tolerates fragmented/noisy JSONL, deduplicates, and exposes conflicts', () => {
  const tracker = createWorkerIdentityTracker('codex', ['exec', '--json', 'task']);
  assert.deepEqual(tracker.push('stdout', 'banner\n{"type":"thread.star'), []);
  assert.deepEqual(tracker.push('stdout', 'ted","thread_id":"thr_你好"}\n'), [
    { sessionId: 'thr_你好', source: 'codex-jsonl:thread.started' },
  ]);
  assert.deepEqual(
    tracker.push('stderr', '{malformed\n{"type":"thread.started","thread_id":"thr_你好"}\n'),
    [],
  );
  assert.deepEqual(tracker.push('stdout', '{"type":"thread.started","thread_id":"thr_other"}'), []);
  assert.deepEqual(tracker.finish(), [
    { sessionId: 'thr_other', source: 'codex-jsonl:thread.started' },
  ]);
});

test('Kimi tracker accepts only the proven session.resume_hint schema, including EOF without newline', () => {
  const tracker = createWorkerIdentityTracker('kimi-code', [
    '-p',
    'task',
    '--output-format',
    'stream-json',
  ]);
  assert.deepEqual(
    tracker.push(
      'stdout',
      '{"role":"assistant","content":"answer"}\n{"role":"meta","type":"session.resume_hint",',
    ),
    [],
  );
  assert.deepEqual(tracker.push('stdout', '"session_id":"session_175"}'), []);
  assert.deepEqual(tracker.finish(), [
    { sessionId: 'session_175', source: 'kimi-stream-json:session.resume_hint' },
  ]);
});

test('Claude tracker accepts only the proven structured result envelope on a declared JSON transport', () => {
  const tracker = createWorkerIdentityTracker('claude-code', [
    '--print',
    '--output-format',
    'stream-json',
    'task',
  ]);
  assert.deepEqual(tracker.push('stdout', '{"session_id":"counterfeit"}\n'), []);
  assert.deepEqual(
    tracker.push(
      'stdout',
      '{"type":"result","subtype":"success","session_id":"claude-session-175"}\n',
    ),
    [{ sessionId: 'claude-session-175', source: 'claude-json:result' }],
  );
  assert.deepEqual(tracker.finish(), []);

  const plainTextTransport = createWorkerIdentityTracker('claude-code', ['--print', 'task']);
  assert.deepEqual(
    plainTextTransport.push(
      'stdout',
      '{"type":"result","session_id":"model-could-have-printed-this"}\n',
    ),
    [],
  );
});

test('Claude explicit --session-id is safe pre-spawn identity evidence and arbitrary argv is not', () => {
  assert.deepEqual(
    explicitWorkerSessionIdentity('claude-code', [
      '--print',
      '--session-id',
      'claude-explicit-175',
      'task',
    ]),
    { sessionId: 'claude-explicit-175', source: 'claude-argv:--session-id' },
  );
  assert.equal(
    explicitWorkerSessionIdentity('claude-code', [
      '--print',
      'please repeat --session-id counterfeit',
    ]),
    null,
  );
  assert.equal(explicitWorkerSessionIdentity('codex', ['--session-id', 'not-codex-proof']), null);
});

test('Cursor never infers identity from arbitrary provider output', () => {
  const tracker = createWorkerIdentityTracker('cursor-agent');
  assert.deepEqual(
    tracker.push('stdout', '{"session_id":"counterfeit"}\nAttach with: resume counterfeit\n'),
    [],
  );
  assert.deepEqual(tracker.finish(), []);
});

test('Codex session enrichment exposes proven rollout and resume command, or typed unavailable', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-codex-identity-'));
  roots.push(root);
  const sessions = join(root, 'sessions', '2026', '07', '22');
  mkdirSync(sessions, { recursive: true });
  const transcript = join(sessions, 'rollout-2026-07-22T00-00-00-thr_175.jsonl');
  writeFileSync(transcript, '{}\n');
  const found = sessionCapabilities({
    harness: 'codex',
    sessionId: 'thr_175',
    cwd: root,
    env: { CODEX_HOME: root },
  });
  assert.deepEqual(found.transcript, { status: 'supported', value: { path: transcript } });
  assert.deepEqual(found.attach, {
    status: 'supported',
    value: { cwd: root, argv: ['codex', 'resume', 'thr_175'] },
  });
  const missing = sessionCapabilities({
    harness: 'codex',
    sessionId: 'thr_missing',
    cwd: root,
    env: { CODEX_HOME: root },
  });
  assert.deepEqual(missing.transcript, {
    status: 'unavailable',
    reason: 'session-transcript-not-found',
  });
});

test('Kimi session enrichment uses path-segment wire transcript and documented -S attach', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-kimi-identity-'));
  roots.push(root);
  const transcript = join(
    root,
    'sessions',
    'workspace-token',
    'session_175',
    'agents',
    'main',
    'wire.jsonl',
  );
  mkdirSync(join(transcript, '..'), { recursive: true });
  writeFileSync(transcript, '{}\n');
  const found = sessionCapabilities({
    harness: 'kimi-code',
    sessionId: 'session_175',
    cwd: root,
    env: { KIMI_CODE_HOME: root },
  });
  assert.deepEqual(found.transcript, { status: 'supported', value: { path: transcript } });
  assert.deepEqual(found.attach, {
    status: 'supported',
    value: { cwd: root, argv: ['kimi', '-S', 'session_175'] },
  });
});

test('Claude session enrichment reuses the existing transcript locator and exact resume contract', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-claude-identity-'));
  roots.push(root);
  const transcript = join(root, 'projects', 'fixture-slug', 'claude-session-175.jsonl');
  mkdirSync(join(transcript, '..'), { recursive: true });
  writeFileSync(transcript, '{}\n');
  const found = sessionCapabilities({
    harness: 'claude-code',
    sessionId: 'claude-session-175',
    cwd: root,
    env: { CLAUDE_CONFIG_DIR: root },
  });
  assert.deepEqual(found.transcript, { status: 'supported', value: { path: transcript } });
  assert.deepEqual(found.attach, {
    status: 'supported',
    value: { cwd: root, argv: ['claude', '--resume', 'claude-session-175'] },
  });
});

test('Cursor initial transcript evidence reuses explicit-ref/env precedence and degrades honestly', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-cursor-identity-'));
  roots.push(root);
  const explicit = join(root, 'explicit.log');
  const fromEnv = join(root, 'env.log');
  writeFileSync(explicit, 'explicit line\n');
  writeFileSync(fromEnv, 'env line\n');

  assert.deepEqual(
    initialWorkerCapabilities('cursor-agent', {
      transcriptRef: explicit,
      env: { CURSOR_TRANSCRIPT_PATH: fromEnv },
    }).transcript,
    { status: 'supported', value: { path: explicit } },
  );
  assert.deepEqual(
    initialWorkerCapabilities('cursor-agent', {
      env: { CURSOR_TRANSCRIPT_PATH: fromEnv },
    }).transcript,
    { status: 'supported', value: { path: fromEnv } },
  );
  const none = initialWorkerCapabilities('cursor-agent', { env: {} }).transcript;
  assert.equal(none.status, 'unavailable');
  assert.ok('reason' in none && none.reason.length > 0);
});
