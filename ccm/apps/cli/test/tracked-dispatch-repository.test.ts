import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import {
  type AttachCapability,
  type AttachInstruction,
  BoardIdentity,
  BoardWriteAuthority,
  type CapabilityResult,
  DispatchKey,
  RuntimeHandle,
  TaskRef,
  type TrackedDispatchCapabilities,
  type TranscriptRef,
} from '@ccm/engine';
import {
  BoardAgentRegistryRepository,
  DispatchRepositoryError,
} from '../src/tracked-dispatch-repository.js';

const T0 = '2026-07-22T06:00:00Z';
const T1 = '2026-07-22T06:00:01Z';
const T2 = '2026-07-22T06:00:02Z';
const T3 = '2026-07-22T06:00:03Z';
const T4 = '2026-07-22T06:00:04Z';
const DIGEST = `sha256:${'a'.repeat(64)}`;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ccm-dispatch-repo-'));
  roots.push(root);
  const boardPath = join(root, 'run.board.json');
  const board = {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    goal: 'tracked dispatch repository',
    owner: { active: true, session_id: 'sid-owner' },
    git: { worktree: root, branch: 'test' },
    tasks: [
      {
        id: 'T-175',
        status: 'ready',
        deps: [],
        handle: 'must-not-change',
        acceptance: 'must-not-change',
        routing: { attempts: [{ id: 'attempt-existing' }] },
      },
    ],
    agents: [
      {
        id: 'agt-009',
        type: 'subagent',
        harness: 'origin',
        intent: 'legacy record remains readable',
        handle: { kind: 'task-id', value: 'legacy' },
        lifecycle: { state: 'terminal', registered_at: T0, ended_at: T0, outcome: 'done' },
        account_ref: null,
        quota_pool_ref: null,
      },
    ],
  };
  writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  const canonical = realpathSync(boardPath);
  const identity = BoardIdentity.fromCanonicalPath(canonical);
  const authority = BoardWriteAuthority.create({
    canonicalBoardPath: canonical,
    boardIdentity: identity,
    ownerSessionId: 'sid-owner',
    selectionSource: 'explicit-board',
  });
  return {
    root,
    boardPath,
    authority,
    task: TaskRef.create(identity, 'T-175'),
    read: () => JSON.parse(readFileSync(boardPath, 'utf8')),
  };
}

function prepare(
  repository: BoardAgentRegistryRepository,
  f: ReturnType<typeof fixture>,
  capabilities?: TrackedDispatchCapabilities,
) {
  return repository.prepareOrReplay({
    authority: f.authority,
    task: f.task,
    key: DispatchKey.create('dispatch-one'),
    requestDigest: DIGEST,
    harness: 'codex',
    intent: 'review patch',
    cwd: f.root,
    createdAt: T0,
    capabilities,
  });
}

test('prepare and every mutation run under the existing board lock and preserve old agents', () => {
  const f = fixture();
  const before = f.read();
  let writes = 0;
  const repository = new BoardAgentRegistryRepository({
    writeFileAtomicSync(path, data) {
      assert.equal(path, f.boardPath);
      assert.equal(existsSync(`${f.boardPath}.lock`), true, 'write must occur under board lock');
      writes += 1;
      writeFileSync(path, data, 'utf8');
    },
    launcherAlive: () => true,
  });
  const result = prepare(repository, f);
  assert.equal(result.kind, 'prepared');
  assert.equal(result.aggregate.toAgentRecord().id, 'agt-010');
  const board = f.read();
  assert.equal(board.agents[0].id, 'agt-009');
  assert.equal(board.agents[0].dispatch, undefined);
  assert.equal(board.agents[1].dispatch.phase, 'prepared');
  const beforeWithoutAgents = { ...before, agents: undefined };
  const afterWithoutAgents = { ...board, agents: undefined };
  assert.deepEqual(afterWithoutAgents, beforeWithoutAgents, 'tracked writer owns agents[] only');
  assert.equal(writes, 1);
});

test('same key and digest replay one agent; a differing digest conflicts before mutation', () => {
  const f = fixture();
  const repository = new BoardAgentRegistryRepository();
  assert.equal(prepare(repository, f).kind, 'prepared');
  const replay = prepare(repository, f);
  assert.equal(replay.kind, 'replay');
  assert.equal(replay.aggregate.toAgentRecord().id, 'agt-010');
  assert.equal(f.read().agents.length, 2);
  assert.throws(
    () =>
      repository.prepareOrReplay({
        authority: f.authority,
        task: f.task,
        key: DispatchKey.create('dispatch-one'),
        requestDigest: `sha256:${'b'.repeat(64)}`,
        harness: 'codex',
        intent: 'changed request',
        cwd: f.root,
        createdAt: T1,
      }),
    (error: unknown) =>
      error instanceof DispatchRepositoryError && error.code === 'idempotency_conflict',
  );
  assert.equal(f.read().agents.length, 2);
});

test('claim has one winner; a live launcher replays in-progress and a dead launcher reconciles', () => {
  const f = fixture();
  let alive = true;
  const repository = new BoardAgentRegistryRepository({ launcherAlive: () => alive });
  prepare(repository, f);
  const claimed = repository.claimLaunch({
    authority: f.authority,
    key: DispatchKey.create('dispatch-one'),
    requestDigest: DIGEST,
    claimToken: 'winner',
    claimedAt: T1,
    launcherPid: 9901,
  });
  assert.equal(claimed.kind, 'claimed');
  const inProgress = repository.claimLaunch({
    authority: f.authority,
    key: DispatchKey.create('dispatch-one'),
    requestDigest: DIGEST,
    claimToken: 'loser',
    claimedAt: T2,
    launcherPid: 9902,
  });
  assert.equal(inProgress.kind, 'in-progress');
  assert.equal(f.read().agents[1].dispatch.phase, 'launch-claimed');

  alive = false;
  const ambiguous = repository.claimLaunch({
    authority: f.authority,
    key: DispatchKey.create('dispatch-one'),
    requestDigest: DIGEST,
    claimToken: 'never-wins',
    claimedAt: T2,
    launcherPid: 9903,
  });
  assert.equal(ambiguous.kind, 'reconciliation-required');
  assert.equal(f.read().agents[1].dispatch.reconciliation_reason, 'ambiguous-launch');
});

test('PID handle, running lifecycle, and agent-side task link commit atomically without task writes', () => {
  const f = fixture();
  const repository = new BoardAgentRegistryRepository();
  prepare(repository, f);
  repository.claimLaunch({
    authority: f.authority,
    key: DispatchKey.create('dispatch-one'),
    requestDigest: DIGEST,
    claimToken: 'winner',
    claimedAt: T1,
    launcherPid: process.pid,
  });
  const beforeTask = structuredClone(f.read().tasks[0]);
  repository.commitStartedWorker({
    authority: f.authority,
    key: DispatchKey.create('dispatch-one'),
    requestDigest: DIGEST,
    claimToken: 'winner',
    handle: RuntimeHandle.pid(42117, T2),
    linkedAt: T2,
  });
  const board = f.read();
  const tracked = board.agents[1];
  assert.equal(tracked.lifecycle.state, 'running');
  assert.deepEqual(tracked.handle, { kind: 'pid', value: '42117' });
  assert.deepEqual(tracked.links, [{ task_id: 'T-175', linked_at: T2 }]);
  assert.deepEqual(board.tasks[0], beforeTask);
});

test('task deletion or persistence failure during bind leaves no partial running/link projection', () => {
  const f = fixture();
  let failWrite = false;
  const repository = new BoardAgentRegistryRepository({
    writeFileAtomicSync(path, data) {
      if (failWrite) throw new Error('injected write failure');
      writeFileSync(path, data, 'utf8');
    },
  });
  prepare(repository, f);
  repository.claimLaunch({
    authority: f.authority,
    key: DispatchKey.create('dispatch-one'),
    requestDigest: DIGEST,
    claimToken: 'winner',
    claimedAt: T1,
    launcherPid: process.pid,
  });
  failWrite = true;
  assert.throws(() =>
    repository.commitStartedWorker({
      authority: f.authority,
      key: DispatchKey.create('dispatch-one'),
      requestDigest: DIGEST,
      claimToken: 'winner',
      handle: RuntimeHandle.pid(42117, T2),
      linkedAt: T2,
    }),
  );
  let tracked = f.read().agents[1];
  assert.equal(tracked.dispatch.phase, 'launch-claimed');
  assert.equal(tracked.handle.kind, 'none');
  assert.equal(tracked.links, undefined);

  failWrite = false;
  const board = f.read();
  board.tasks = [];
  writeFileSync(f.boardPath, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  assert.throws(
    () =>
      repository.commitStartedWorker({
        authority: f.authority,
        key: DispatchKey.create('dispatch-one'),
        requestDigest: DIGEST,
        claimToken: 'winner',
        handle: RuntimeHandle.pid(42117, T2),
        linkedAt: T2,
      }),
    (error: unknown) =>
      error instanceof DispatchRepositoryError && error.code === 'task_reference_failure',
  );
  tracked = f.read().agents[1];
  assert.equal(tracked.dispatch.phase, 'launch-claimed');
  assert.equal(tracked.handle.kind, 'none');
});

function claimedAndBound(repository: BoardAgentRegistryRepository, f: ReturnType<typeof fixture>) {
  prepare(repository, f);
  repository.claimLaunch({
    authority: f.authority,
    key: DispatchKey.create('dispatch-one'),
    requestDigest: DIGEST,
    claimToken: 'winner',
    claimedAt: T1,
    launcherPid: process.pid,
  });
  repository.commitStartedWorker({
    authority: f.authority,
    key: DispatchKey.create('dispatch-one'),
    requestDigest: DIGEST,
    claimToken: 'winner',
    handle: RuntimeHandle.pid(42117, T2),
    linkedAt: T2,
  });
}

test('session identity enrichment is monotonic and conflicting evidence requires reconciliation', () => {
  const f = fixture();
  const repository = new BoardAgentRegistryRepository();
  claimedAndBound(repository, f);
  repository.upgradeIdentity({
    authority: f.authority,
    key: DispatchKey.create('dispatch-one'),
    requestDigest: DIGEST,
    handle: RuntimeHandle.sessionId('thread-175', 'codex-jsonl', T3),
    transcript: { status: 'supported', value: { path: join(f.root, 'rollout.jsonl') } },
    attach: {
      status: 'supported',
      value: { cwd: f.root, argv: ['codex', 'resume', 'thread-175'] },
    },
    changedAt: T3,
  });
  const enriched = f.read().agents[1];
  assert.equal(enriched.handle.kind, 'session-id');
  assert.equal(enriched.handle.value, 'thread-175');
  assert.equal(enriched.dispatch.runtime_pid, 42117);
  assert.equal(enriched.dispatch.evidence[0].kind, 'pid');
  assert.equal(enriched.dispatch.evidence[1].kind, 'session-id');

  repository.upgradeIdentity({
    authority: f.authority,
    key: DispatchKey.create('dispatch-one'),
    requestDigest: DIGEST,
    handle: RuntimeHandle.sessionId('different-thread', 'codex-jsonl', T4),
    transcript: { status: 'unavailable', reason: 'not-found' },
    attach: {
      status: 'supported',
      value: { cwd: f.root, argv: ['codex', 'resume', 'different-thread'] },
    },
    changedAt: T4,
  });
  const conflicted = f.read().agents[1];
  assert.equal(conflicted.handle.value, 'thread-175');
  assert.equal(conflicted.handle.transcript_ref, join(f.root, 'rollout.jsonl'));
  assert.equal(conflicted.dispatch.phase, 'reconciliation-required');
  assert.equal(conflicted.dispatch.reconciliation_reason, 'conflicting-session-evidence');
  assert.deepEqual(conflicted.dispatch.capabilities.identity, {
    status: 'supported',
    value: { kind: 'session-id', value: 'thread-175' },
  });
  assert.deepEqual(conflicted.dispatch.capabilities.transcript, {
    status: 'supported',
    value: { path: join(f.root, 'rollout.jsonl') },
  });
});

test('all incompatible capability transitions persist reconciliation without corrupting evidence', () => {
  const transitions: Array<{
    name: string;
    persisted: CapabilityResult<TranscriptRef>;
    observed: CapabilityResult<TranscriptRef>;
  }> = [
    {
      name: 'unsupported-to-supported',
      persisted: { status: 'unsupported', reason: 'capability-not-supported' },
      observed: { status: 'supported', value: { path: '/tmp/rollout.jsonl' } },
    },
    {
      name: 'supported-to-unsupported',
      persisted: { status: 'supported', value: { path: '/tmp/rollout.jsonl' } },
      observed: { status: 'unsupported', reason: 'capability-not-supported' },
    },
    {
      name: 'unsupported-to-unavailable',
      persisted: { status: 'unsupported', reason: 'capability-not-supported' },
      observed: { status: 'unavailable', reason: 'supported-but-not-located' },
    },
    {
      name: 'unavailable-to-unsupported',
      persisted: { status: 'unavailable', reason: 'supported-but-not-located' },
      observed: { status: 'unsupported', reason: 'capability-not-supported' },
    },
  ];

  for (const transition of transitions) {
    const f = fixture();
    const repository = new BoardAgentRegistryRepository();
    const initialTranscript: CapabilityResult<TranscriptRef> =
      transition.persisted.status === 'supported'
        ? { status: 'unavailable', reason: 'session-identity-not-yet-observed' }
        : transition.persisted;
    prepare(repository, f, {
      identity: { status: 'unavailable', reason: 'session-identity-not-yet-observed' },
      transcript: initialTranscript,
      attach: { status: 'unavailable', reason: 'session-identity-not-yet-observed' },
    });
    repository.claimLaunch({
      authority: f.authority,
      key: DispatchKey.create('dispatch-one'),
      requestDigest: DIGEST,
      claimToken: 'winner',
      claimedAt: T1,
      launcherPid: process.pid,
    });
    repository.commitStartedWorker({
      authority: f.authority,
      key: DispatchKey.create('dispatch-one'),
      requestDigest: DIGEST,
      claimToken: 'winner',
      handle: RuntimeHandle.pid(42117, T2),
      linkedAt: T2,
    });
    if (transition.persisted.status === 'supported') {
      repository.upgradeIdentity({
        authority: f.authority,
        key: DispatchKey.create('dispatch-one'),
        requestDigest: DIGEST,
        handle: RuntimeHandle.sessionId('thread-175', 'codex-jsonl', T3),
        transcript: transition.persisted,
        attach: {
          status: 'supported',
          value: { cwd: f.root, argv: ['codex', 'resume', 'thread-175'] },
        },
        changedAt: T3,
      });
    }
    const before = f.read().agents[1];
    repository.upgradeIdentity({
      authority: f.authority,
      key: DispatchKey.create('dispatch-one'),
      requestDigest: DIGEST,
      handle: RuntimeHandle.sessionId('thread-175', 'codex-jsonl', T4),
      transcript: transition.observed,
      attach: {
        status: 'supported',
        value: { cwd: f.root, argv: ['codex', 'resume', 'thread-175'] },
      },
      changedAt: T4,
    });
    const after = f.read().agents[1];
    assert.equal(after.dispatch.phase, 'reconciliation-required', transition.name);
    assert.equal(after.dispatch.reconciliation_required, true, transition.name);
    assert.equal(after.handle.value, before.handle.value, transition.name);
    assert.deepEqual(after.dispatch.capabilities, before.dispatch.capabilities, transition.name);
  }
});

test('all incompatible attach transitions persist reconciliation without overwriting evidence', () => {
  const transitions: Array<{
    name: string;
    initial: CapabilityResult<AttachCapability>;
    establish?: CapabilityResult<AttachInstruction>;
    observed: CapabilityResult<AttachInstruction>;
  }> = [
    {
      name: 'unsupported-to-supported',
      initial: { status: 'unsupported', reason: 'attach-not-supported' },
      observed: { status: 'supported', value: { cwd: '', argv: [] } },
    },
    {
      name: 'supported-to-unsupported',
      initial: { status: 'unavailable', reason: 'attach-not-yet-observed' },
      establish: { status: 'supported', value: { cwd: '', argv: [] } },
      observed: { status: 'unsupported', reason: 'attach-not-supported' },
    },
    {
      name: 'unsupported-to-unavailable',
      initial: { status: 'unsupported', reason: 'attach-not-supported' },
      observed: { status: 'unavailable', reason: 'attach-not-located' },
    },
    {
      name: 'unavailable-to-unsupported',
      initial: { status: 'unavailable', reason: 'attach-not-located' },
      observed: { status: 'unsupported', reason: 'attach-not-supported' },
    },
  ];

  for (const transition of transitions) {
    const f = fixture();
    const repository = new BoardAgentRegistryRepository();
    const command = { cwd: f.root, argv: ['codex', 'resume', 'thread-175'] };
    const materialize = (
      observation: CapabilityResult<AttachInstruction>,
    ): CapabilityResult<AttachInstruction> =>
      observation.status === 'supported' ? { status: 'supported', value: command } : observation;
    prepare(repository, f, {
      identity: { status: 'unavailable', reason: 'session-identity-not-yet-observed' },
      transcript: { status: 'unavailable', reason: 'session-transcript-not-found' },
      attach: transition.initial,
    });
    repository.claimLaunch({
      authority: f.authority,
      key: DispatchKey.create('dispatch-one'),
      requestDigest: DIGEST,
      claimToken: 'winner',
      claimedAt: T1,
      launcherPid: process.pid,
    });
    repository.commitStartedWorker({
      authority: f.authority,
      key: DispatchKey.create('dispatch-one'),
      requestDigest: DIGEST,
      claimToken: 'winner',
      handle: RuntimeHandle.pid(42117, T2),
      linkedAt: T2,
    });
    if (transition.establish) {
      repository.upgradeIdentity({
        authority: f.authority,
        key: DispatchKey.create('dispatch-one'),
        requestDigest: DIGEST,
        handle: RuntimeHandle.sessionId('thread-175', 'codex-jsonl', T3),
        transcript: { status: 'unavailable', reason: 'session-transcript-not-found' },
        attach: materialize(transition.establish),
        changedAt: T3,
      });
    }
    const before = f.read().agents[1];
    repository.upgradeIdentity({
      authority: f.authority,
      key: DispatchKey.create('dispatch-one'),
      requestDigest: DIGEST,
      handle: RuntimeHandle.sessionId('thread-175', 'codex-jsonl', T4),
      transcript: { status: 'unavailable', reason: 'session-transcript-not-found' },
      attach: materialize(transition.observed),
      changedAt: T4,
    });
    const after = f.read().agents[1];
    assert.equal(after.dispatch.phase, 'reconciliation-required', transition.name);
    assert.equal(after.dispatch.reconciliation_reason, 'conflicting-session-evidence');
    assert.deepEqual(after.dispatch.capabilities, before.dispatch.capabilities, transition.name);
    assert.deepEqual(after.handle, before.handle, transition.name);
  }
});

test('same-session conflicting supported transcript and attach values reconcile durably', () => {
  for (const capability of ['transcript', 'attach'] as const) {
    const f = fixture();
    const repository = new BoardAgentRegistryRepository();
    claimedAndBound(repository, f);
    repository.upgradeIdentity({
      authority: f.authority,
      key: DispatchKey.create('dispatch-one'),
      requestDigest: DIGEST,
      handle: RuntimeHandle.sessionId('thread-175', 'codex-jsonl', T3),
      transcript: { status: 'supported', value: { path: join(f.root, 'rollout-a.jsonl') } },
      attach: {
        status: 'supported',
        value: { cwd: f.root, argv: ['codex', 'resume', 'thread-175'] },
      },
      changedAt: T3,
    });
    const before = f.read().agents[1];
    repository.upgradeIdentity({
      authority: f.authority,
      key: DispatchKey.create('dispatch-one'),
      requestDigest: DIGEST,
      handle: RuntimeHandle.sessionId('thread-175', 'codex-jsonl', T4),
      transcript:
        capability === 'transcript'
          ? { status: 'supported', value: { path: join(f.root, 'rollout-b.jsonl') } }
          : { status: 'supported', value: { path: join(f.root, 'rollout-a.jsonl') } },
      attach:
        capability === 'attach'
          ? {
              status: 'supported',
              value: { cwd: f.root, argv: ['codex', 'resume', 'different-session'] },
            }
          : {
              status: 'supported',
              value: { cwd: f.root, argv: ['codex', 'resume', 'thread-175'] },
            },
      changedAt: T4,
    });
    const after = f.read().agents[1];
    assert.equal(after.dispatch.phase, 'reconciliation-required', capability);
    assert.equal(after.dispatch.reconciliation_reason, 'conflicting-session-evidence');
    assert.deepEqual(after.dispatch.capabilities, before.dispatch.capabilities, capability);
    assert.deepEqual(after.handle, before.handle, capability);
  }
});

test('closing and terminal commits persist sanitized facts and never mutate task lifecycle', () => {
  const f = fixture();
  const repository = new BoardAgentRegistryRepository();
  claimedAndBound(repository, f);
  const taskBefore = structuredClone(f.read().tasks[0]);
  repository.beginClosing({
    authority: f.authority,
    key: DispatchKey.create('dispatch-one'),
    requestDigest: DIGEST,
    at: T3,
    terminal: { state: 'exited', exit_code: 0, signal: null, error_code: null, reaped: true },
  });
  assert.equal(f.read().agents[1].dispatch.phase, 'closing');
  repository.commitTerminal({
    authority: f.authority,
    key: DispatchKey.create('dispatch-one'),
    requestDigest: DIGEST,
    at: T4,
    outcome: 'exited:0',
  });
  const terminal = f.read().agents[1];
  assert.equal(terminal.dispatch.phase, 'closed');
  assert.equal(terminal.lifecycle.state, 'terminal');
  assert.deepEqual(f.read().tasks[0], taskBefore);
  const persisted = JSON.stringify(terminal);
  for (const forbidden of ['provider output', 'secret-token', '--dangerous-provider-arg']) {
    assert.equal(persisted.includes(forbidden), false);
  }
});

test('conflicting terminal-time identity evidence persists reconciliation without losing terminal fact', () => {
  const f = fixture();
  const repository = new BoardAgentRegistryRepository();
  claimedAndBound(repository, f);
  repository.upgradeIdentity({
    authority: f.authority,
    key: DispatchKey.create('dispatch-one'),
    requestDigest: DIGEST,
    handle: RuntimeHandle.sessionId('thread-175', 'codex-jsonl', T3),
    transcript: { status: 'supported', value: { path: join(f.root, 'rollout-a.jsonl') } },
    attach: {
      status: 'supported',
      value: { cwd: f.root, argv: ['codex', 'resume', 'thread-175'] },
    },
    changedAt: T3,
  });
  repository.beginClosing({
    authority: f.authority,
    key: DispatchKey.create('dispatch-one'),
    requestDigest: DIGEST,
    at: T3,
    terminal: { state: 'exited', exit_code: 0, signal: null, error_code: null, reaped: true },
  });
  repository.commitTerminal({
    authority: f.authority,
    key: DispatchKey.create('dispatch-one'),
    requestDigest: DIGEST,
    at: T4,
    outcome: 'exited:0',
  });
  const terminalBeforeConflict = structuredClone(f.read().agents[1]);

  repository.upgradeIdentity({
    authority: f.authority,
    key: DispatchKey.create('dispatch-one'),
    requestDigest: DIGEST,
    handle: RuntimeHandle.sessionId('thread-175', 'codex-jsonl', T4),
    transcript: { status: 'supported', value: { path: join(f.root, 'rollout-b.jsonl') } },
    attach: {
      status: 'supported',
      value: { cwd: f.root, argv: ['codex', 'resume', 'thread-175'] },
    },
    changedAt: T4,
  });

  const reconciled = f.read().agents[1];
  assert.equal(reconciled.dispatch.phase, 'reconciliation-required');
  assert.equal(reconciled.dispatch.reconciliation_reason, 'conflicting-session-evidence');
  assert.equal(reconciled.lifecycle.state, 'terminal');
  assert.equal(reconciled.lifecycle.ended_at, terminalBeforeConflict.lifecycle.ended_at);
  assert.equal(reconciled.lifecycle.outcome, terminalBeforeConflict.lifecycle.outcome);
  assert.deepEqual(reconciled.dispatch.terminal, terminalBeforeConflict.dispatch.terminal);
  assert.equal(reconciled.handle.transcript_ref, join(f.root, 'rollout-a.jsonl'));

  const replay = prepare(repository, f);
  assert.equal(replay.kind, 'replay');
  assert.equal(replay.aggregate.toAgentRecord().lifecycle.state, 'terminal');
  assert.equal(
    repository.claimLaunch({
      authority: f.authority,
      key: DispatchKey.create('dispatch-one'),
      requestDigest: DIGEST,
      claimToken: 'must-not-revive-terminal',
      claimedAt: T4,
      launcherPid: process.pid,
    }).kind,
    'reconciliation-required',
  );
  assert.equal(f.read().agents[1].lifecycle.state, 'terminal');
});

test('startup failure closes the agent without fabricating PID or task link', () => {
  const f = fixture();
  const repository = new BoardAgentRegistryRepository();
  prepare(repository, f);
  repository.claimLaunch({
    authority: f.authority,
    key: DispatchKey.create('dispatch-one'),
    requestDigest: DIGEST,
    claimToken: 'winner',
    claimedAt: T1,
    launcherPid: process.pid,
  });
  repository.recordStartupFailure({
    authority: f.authority,
    key: DispatchKey.create('dispatch-one'),
    requestDigest: DIGEST,
    at: T2,
    terminal: {
      state: 'spawn_failed',
      exit_code: null,
      signal: null,
      error_code: 'PROVIDER_NOT_FOUND',
      reaped: true,
    },
    outcome: 'startup-failed',
  });
  const agent = f.read().agents[1];
  assert.equal(agent.lifecycle.state, 'terminal');
  assert.equal(agent.handle.kind, 'none');
  assert.equal(agent.links, undefined);
  assert.equal(agent.dispatch.runtime_pid, undefined);
});

test('explicit reconciliation mutation is durable and replay remains fail-closed', () => {
  const f = fixture();
  const repository = new BoardAgentRegistryRepository();
  claimedAndBound(repository, f);
  repository.markReconciliationRequired({
    authority: f.authority,
    key: DispatchKey.create('dispatch-one'),
    requestDigest: DIGEST,
    at: T3,
    reason: 'terminal-write-ambiguous',
  });
  const agent = f.read().agents[1];
  assert.equal(agent.lifecycle.state, 'uncertain');
  assert.equal(agent.dispatch.phase, 'reconciliation-required');
  assert.equal(prepare(repository, f).kind, 'replay');
  assert.equal(
    repository.claimLaunch({
      authority: f.authority,
      key: DispatchKey.create('dispatch-one'),
      requestDigest: DIGEST,
      claimToken: 'must-not-respawn',
      claimedAt: T4,
      launcherPid: process.pid,
    }).kind,
    'reconciliation-required',
  );
});

test('a bound worker is in-progress only while its synchronous launcher lives; lost supervisor reconciles', () => {
  const f = fixture();
  let alive = true;
  const repository = new BoardAgentRegistryRepository({ launcherAlive: () => alive });
  claimedAndBound(repository, f);
  const live = repository.claimLaunch({
    authority: f.authority,
    key: DispatchKey.create('dispatch-one'),
    requestDigest: DIGEST,
    claimToken: 'new',
    claimedAt: T3,
    launcherPid: process.pid,
  });
  assert.equal(live.kind, 'in-progress');
  alive = false;
  const lost = repository.claimLaunch({
    authority: f.authority,
    key: DispatchKey.create('dispatch-one'),
    requestDigest: DIGEST,
    claimToken: 'must-not-respawn',
    claimedAt: T4,
    launcherPid: process.pid,
  });
  assert.equal(lost.kind, 'reconciliation-required');
  assert.equal(f.read().agents[1].dispatch.reconciliation_reason, 'supervisor-lost-after-bind');
});
