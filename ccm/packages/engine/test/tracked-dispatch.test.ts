import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type AttachCapability,
  type AttachInstruction,
  BoardIdentity,
  BoardWriteAuthority,
  type CapabilityResult,
  DispatchKey,
  RuntimeHandle,
  TaskRef,
  TrackedDispatch,
  type TrackedDispatchCapabilities,
  TrackedDispatchError,
} from '../dist/index.mjs';

const T0 = '2026-07-22T06:00:00Z';
const T1 = '2026-07-22T06:00:01Z';
const T2 = '2026-07-22T06:00:02Z';
const T3 = '2026-07-22T06:00:03Z';

function fixture(capabilities?: TrackedDispatchCapabilities) {
  const boardIdentity = BoardIdentity.fromCanonicalPath('/tmp/run.board.json');
  const authority = BoardWriteAuthority.create({
    canonicalBoardPath: '/tmp/run.board.json',
    boardIdentity,
    ownerSessionId: 'owner-session',
    selectionSource: 'explicit-board',
  });
  const task = TaskRef.create(boardIdentity, 'T-175');
  const aggregate = TrackedDispatch.prepare({
    agentId: 'agt-017',
    authority,
    task,
    key: DispatchKey.create('rc4-175-review-1'),
    requestDigest: `sha256:${'a'.repeat(64)}`,
    harness: 'codex',
    intent: 'review rc4 patch',
    cwd: '/tmp/worktree',
    createdAt: T0,
    capabilities,
  });
  return { aggregate, authority, boardIdentity, task };
}

function bind(aggregate: TrackedDispatch): void {
  aggregate.claimLaunch({ token: 'claim-1', claimedAt: T1, launcherPid: 9123 });
  aggregate.bindStartedWorker({
    claimToken: 'claim-1',
    handle: RuntimeHandle.pid(42117, T2),
    linkedAt: T2,
  });
}

function attachFor(sessionId: string, argv = ['codex', 'resume', sessionId]) {
  return {
    status: 'supported',
    value: { cwd: '/tmp/worktree', argv },
  } as const;
}

test('value objects reject ambiguous authority, empty keys, cross-board tasks, and fake handles', () => {
  assert.throws(() => DispatchKey.create(''), /dispatch key/u);
  assert.throws(() => DispatchKey.create('contains whitespace'), /dispatch key/u);
  assert.throws(() => BoardIdentity.fromCanonicalPath('relative.board.json'), /absolute/u);
  assert.throws(() => RuntimeHandle.pid(0, T0), /positive PID/u);
  assert.throws(() => RuntimeHandle.sessionId('', 'codex-jsonl', T0), /non-empty/u);

  const a = BoardIdentity.fromCanonicalPath('/tmp/a.board.json');
  const b = BoardIdentity.fromCanonicalPath('/tmp/b.board.json');
  const authority = BoardWriteAuthority.create({
    canonicalBoardPath: '/tmp/a.board.json',
    boardIdentity: a,
    selectionSource: 'explicit-board',
  });
  assert.throws(() => authority.assertTask(TaskRef.create(b, 'T1')), /same board/u);
});

test('prepare persists a starting agent without a handle and never persists sensitive launch input', () => {
  const { aggregate } = fixture();
  const record = aggregate.toAgentRecord();
  assert.equal(record.lifecycle.state, 'starting');
  assert.deepEqual(record.handle, { kind: 'none', value: '' });
  assert.equal(record.dispatch.phase, 'prepared');
  assert.equal(record.dispatch.task_id, 'T-175');
  assert.equal(record.dispatch.key, 'rc4-175-review-1');

  const persisted = JSON.stringify(record);
  for (const forbidden of [
    'prompt',
    'stdin',
    'argv',
    'environment',
    'provider_output',
    'sk-secret',
  ]) {
    assert.equal(persisted.includes(forbidden), false, forbidden);
  }
});

test('claim then PID bind atomically makes the agent running and links its same-board task', () => {
  const { aggregate } = fixture();
  aggregate.claimLaunch({
    token: 'claim-1',
    claimedAt: T1,
    launcherPid: 9123,
  });
  aggregate.bindStartedWorker({
    claimToken: 'claim-1',
    handle: RuntimeHandle.pid(42117, T2),
    linkedAt: T2,
  });
  const record = aggregate.toAgentRecord();
  assert.equal(record.dispatch.phase, 'bound');
  assert.equal(record.dispatch.runtime_pid, 42117);
  assert.deepEqual(record.handle, { kind: 'pid', value: '42117' });
  assert.equal(record.lifecycle.state, 'running');
  assert.deepEqual(record.links, [{ task_id: 'T-175', linked_at: T2 }]);
});

test('an explicit transcript capability is visible before launch and survives PID + terminal archive', () => {
  const transcript = '/tmp/cursor-worker.log';
  const { aggregate } = fixture({
    identity: { status: 'unsupported', reason: 'native-session-identity-not-proven' },
    transcript: { status: 'supported', value: { path: transcript } },
    attach: { status: 'unsupported', reason: 'exact-session-attach-not-proven' },
  });
  assert.deepEqual(aggregate.toAgentRecord().handle, {
    kind: 'none',
    value: '',
    transcript_ref: transcript,
  });

  bind(aggregate);
  assert.deepEqual(aggregate.toAgentRecord().handle, {
    kind: 'pid',
    value: '42117',
    transcript_ref: transcript,
  });
  aggregate.beginClosing({
    at: T3,
    terminal: { state: 'exited', exit_code: 0, signal: null, error_code: null, reaped: true },
  });
  aggregate.close({ at: T3, outcome: 'exited:0' });
  const archived = aggregate.toAgentRecord();
  assert.equal(archived.lifecycle.state, 'terminal');
  assert.equal(archived.handle.transcript_ref, transcript);
  assert.equal(archived.links?.[0]?.task_id, 'T-175');
});

test('running requires the exact claim and a real spawn PID', () => {
  const { aggregate } = fixture();
  aggregate.claimLaunch({ token: 'winner', claimedAt: T1, launcherPid: 9123 });
  assert.throws(
    () =>
      aggregate.bindStartedWorker({
        claimToken: 'loser',
        handle: RuntimeHandle.pid(42117, T2),
        linkedAt: T2,
      }),
    (error: unknown) =>
      error instanceof TrackedDispatchError && error.code === 'claim_token_conflict',
  );
  assert.equal(aggregate.toAgentRecord().lifecycle.state, 'starting');
});

test('PID to session identity is monotonic; conflicting sessions require reconciliation', () => {
  const { aggregate } = fixture();
  aggregate.claimLaunch({ token: 'claim-1', claimedAt: T1, launcherPid: 9123 });
  aggregate.bindStartedWorker({
    claimToken: 'claim-1',
    handle: RuntimeHandle.pid(42117, T2),
    linkedAt: T2,
  });
  aggregate.upgradeIdentity({
    handle: RuntimeHandle.sessionId('thr-abc', 'codex-jsonl', T3),
    transcript: { status: 'unavailable', reason: 'rollout-not-yet-visible' },
    attach: {
      status: 'supported',
      value: { cwd: '/tmp/worktree', argv: ['codex', 'resume', 'thr-abc'] },
    },
  });
  aggregate.upgradeIdentity({
    handle: RuntimeHandle.sessionId('thr-abc', 'codex-jsonl', T3),
    transcript: { status: 'unavailable', reason: 'rollout-not-yet-visible' },
    attach: {
      status: 'supported',
      value: { cwd: '/tmp/worktree', argv: ['codex', 'resume', 'thr-abc'] },
    },
  });
  assert.equal(aggregate.toAgentRecord().handle.value, 'thr-abc');
  assert.equal(
    aggregate.toAgentRecord().dispatch.evidence.filter((entry) => entry.kind === 'session-id')
      .length,
    1,
  );
  assert.throws(
    () =>
      aggregate.upgradeIdentity({
        handle: RuntimeHandle.sessionId('thr-other', 'codex-jsonl', T3),
        transcript: { status: 'unavailable', reason: 'rollout-not-yet-visible' },
        attach: { status: 'unsupported', reason: 'not-proven' },
      }),
    (error: unknown) => error instanceof TrackedDispatchError && error.code === 'evidence_conflict',
  );
  const afterConflict = aggregate.toAgentRecord();
  assert.equal(afterConflict.handle.value, 'thr-abc');
  assert.deepEqual(afterConflict.dispatch.capabilities.identity, {
    status: 'supported',
    value: { kind: 'session-id', value: 'thr-abc' },
  });
});

test('unavailable may resolve to supported and later non-observation preserves canonical evidence', () => {
  const { aggregate } = fixture();
  bind(aggregate);
  aggregate.upgradeIdentity({
    handle: RuntimeHandle.sessionId('thr-abc', 'codex-jsonl', T3),
    transcript: { status: 'supported', value: { path: '/tmp/rollout.jsonl' } },
    attach: attachFor('thr-abc'),
  });
  aggregate.upgradeIdentity({
    handle: RuntimeHandle.sessionId('thr-abc', 'codex-jsonl', T3),
    transcript: { status: 'unavailable', reason: 'later-probe-could-not-read-transcript' },
    attach: { status: 'unavailable', reason: 'later-probe-could-not-locate-attach' },
  });

  const record = aggregate.toAgentRecord();
  assert.deepEqual(record.dispatch.capabilities.transcript, {
    status: 'supported',
    value: { path: '/tmp/rollout.jsonl' },
  });
  assert.deepEqual(record.dispatch.capabilities.attach, {
    status: 'supported',
    value: { kind: 'session-resume' },
  });
  assert.deepEqual(record.handle, {
    kind: 'session-id',
    value: 'thr-abc',
    transcript_ref: '/tmp/rollout.jsonl',
  });
});

test('unsupported is incomparable with supported and unavailable capability evidence', () => {
  const transitions = [
    {
      name: 'unsupported-to-supported',
      persisted: { status: 'unsupported', reason: 'capability-not-supported' } as const,
      observed: { status: 'supported', value: { path: '/tmp/rollout.jsonl' } } as const,
    },
    {
      name: 'supported-to-unsupported',
      persisted: { status: 'supported', value: { path: '/tmp/rollout.jsonl' } } as const,
      observed: { status: 'unsupported', reason: 'capability-not-supported' } as const,
    },
    {
      name: 'unsupported-to-unavailable',
      persisted: { status: 'unsupported', reason: 'capability-not-supported' } as const,
      observed: { status: 'unavailable', reason: 'supported-but-not-located' } as const,
    },
    {
      name: 'unavailable-to-unsupported',
      persisted: { status: 'unavailable', reason: 'supported-but-not-located' } as const,
      observed: { status: 'unsupported', reason: 'capability-not-supported' } as const,
    },
  ];

  for (const transition of transitions) {
    const initialTranscript =
      transition.persisted.status === 'supported'
        ? { status: 'unavailable', reason: 'session-identity-not-yet-observed' as const }
        : transition.persisted;
    const { aggregate } = fixture({
      identity: { status: 'unavailable', reason: 'session-identity-not-yet-observed' },
      transcript: initialTranscript,
      attach: { status: 'unavailable', reason: 'session-identity-not-yet-observed' },
    });
    bind(aggregate);
    if (transition.persisted.status === 'supported') {
      aggregate.upgradeIdentity({
        handle: RuntimeHandle.sessionId('thr-abc', 'codex-jsonl', T3),
        transcript: transition.persisted,
        attach: attachFor('thr-abc'),
      });
    }
    const before = aggregate.toAgentRecord();
    assert.throws(
      () =>
        aggregate.upgradeIdentity({
          handle: RuntimeHandle.sessionId('thr-abc', 'codex-jsonl', T3),
          transcript: transition.observed,
          attach: attachFor('thr-abc'),
        }),
      (error: unknown) =>
        error instanceof TrackedDispatchError && error.code === 'evidence_conflict',
      transition.name,
    );
    assert.deepEqual(aggregate.toAgentRecord(), before, transition.name);
  }
});

test('attach evidence enforces every incompatible partial-order transition', () => {
  const transitions: Array<{
    name: string;
    initial: CapabilityResult<AttachCapability>;
    establish?: CapabilityResult<AttachInstruction>;
    observed: CapabilityResult<AttachInstruction>;
  }> = [
    {
      name: 'unsupported-to-supported',
      initial: { status: 'unsupported', reason: 'attach-not-supported' },
      observed: attachFor('thr-abc'),
    },
    {
      name: 'supported-to-unsupported',
      initial: { status: 'unavailable', reason: 'attach-not-yet-observed' },
      establish: attachFor('thr-abc'),
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
    const { aggregate } = fixture({
      identity: { status: 'unavailable', reason: 'session-identity-not-yet-observed' },
      transcript: { status: 'unavailable', reason: 'session-transcript-not-found' },
      attach: transition.initial,
    });
    bind(aggregate);
    if (transition.establish) {
      aggregate.upgradeIdentity({
        handle: RuntimeHandle.sessionId('thr-abc', 'codex-jsonl', T3),
        transcript: { status: 'unavailable', reason: 'session-transcript-not-found' },
        attach: transition.establish,
      });
    }
    const before = aggregate.toAgentRecord();
    assert.throws(
      () =>
        aggregate.upgradeIdentity({
          handle: RuntimeHandle.sessionId('thr-abc', 'codex-jsonl', T3),
          transcript: { status: 'unavailable', reason: 'session-transcript-not-found' },
          attach: transition.observed,
        }),
      (error: unknown) =>
        error instanceof TrackedDispatchError && error.code === 'evidence_conflict',
      transition.name,
    );
    assert.deepEqual(aggregate.toAgentRecord(), before, transition.name);
  }
});

test('same-session supported transcript refs and attach commands must repeat canonically', () => {
  const transcriptConflict = fixture().aggregate;
  bind(transcriptConflict);
  transcriptConflict.upgradeIdentity({
    handle: RuntimeHandle.sessionId('thr-abc', 'codex-jsonl', T3),
    transcript: { status: 'supported', value: { path: '/tmp/rollout-a.jsonl' } },
    attach: attachFor('thr-abc'),
  });
  assert.throws(
    () =>
      transcriptConflict.upgradeIdentity({
        handle: RuntimeHandle.sessionId('thr-abc', 'codex-jsonl', T3),
        transcript: { status: 'supported', value: { path: '/tmp/rollout-b.jsonl' } },
        attach: attachFor('thr-abc'),
      }),
    (error: unknown) => error instanceof TrackedDispatchError && error.code === 'evidence_conflict',
  );
  assert.equal(transcriptConflict.toAgentRecord().handle.transcript_ref, '/tmp/rollout-a.jsonl');

  const attachConflict = fixture().aggregate;
  bind(attachConflict);
  attachConflict.upgradeIdentity({
    handle: RuntimeHandle.sessionId('thr-abc', 'codex-jsonl', T3),
    transcript: { status: 'unavailable', reason: 'session-transcript-not-found' },
    attach: attachFor('thr-abc'),
  });
  assert.throws(
    () =>
      attachConflict.upgradeIdentity({
        handle: RuntimeHandle.sessionId('thr-abc', 'codex-jsonl', T3),
        transcript: { status: 'unavailable', reason: 'session-transcript-not-found' },
        attach: attachFor('thr-abc', ['codex', 'resume', 'different-session']),
      }),
    (error: unknown) => error instanceof TrackedDispatchError && error.code === 'evidence_conflict',
  );
  assert.deepEqual(attachConflict.toAgentRecord().handle, {
    kind: 'session-id',
    value: 'thr-abc',
  });
});

test('repeated same-session evidence is idempotent across supported and degraded observations', () => {
  const { aggregate } = fixture();
  aggregate.claimLaunch({ token: 'claim-1', claimedAt: T1, launcherPid: 9123 });
  aggregate.bindStartedWorker({
    claimToken: 'claim-1',
    handle: RuntimeHandle.pid(42117, T2),
    linkedAt: T2,
  });
  const observation = {
    handle: RuntimeHandle.sessionId('thr-repeat', 'codex-jsonl', T3),
    transcript: { status: 'supported', value: { path: '/tmp/repeated.jsonl' } } as const,
    attach: attachFor('thr-repeat'),
  };

  aggregate.upgradeIdentity(observation);
  aggregate.upgradeIdentity(observation);

  const record = aggregate.toAgentRecord();
  assert.equal(record.dispatch.evidence.length, 2);
  assert.equal(record.dispatch.evidence.filter((entry) => entry.kind === 'session-id').length, 1);
  assert.equal(record.handle.transcript_ref, '/tmp/repeated.jsonl');
  assert.deepEqual(record.dispatch.capabilities.transcript, observation.transcript);
  assert.deepEqual(record.dispatch.capabilities.attach, {
    status: 'supported',
    value: { kind: 'session-resume' },
  });
});

test('terminal closes only the agent and terminal-time enrichment never revives lifecycle', () => {
  const { aggregate } = fixture();
  aggregate.claimLaunch({ token: 'claim-1', claimedAt: T1, launcherPid: 9123 });
  aggregate.bindStartedWorker({
    claimToken: 'claim-1',
    handle: RuntimeHandle.pid(42117, T2),
    linkedAt: T2,
  });
  aggregate.beginClosing({
    at: T3,
    terminal: { state: 'exited', exit_code: 0, signal: null, error_code: null, reaped: true },
  });
  aggregate.close({ at: T3, outcome: 'worker exited code=0' });
  aggregate.upgradeIdentity({
    handle: RuntimeHandle.sessionId('session_late', 'kimi-stream-json', T3),
    transcript: { status: 'unavailable', reason: 'index-not-yet-visible' },
    attach: {
      status: 'supported',
      value: { cwd: '/tmp/worktree', argv: ['codex', 'resume', 'session_late'] },
    },
  });
  const record = aggregate.toAgentRecord();
  assert.equal(record.dispatch.phase, 'closed');
  assert.equal(record.lifecycle.state, 'terminal');
  assert.equal(record.handle.value, 'session_late');
  assert.equal(record.links[0]?.task_id, 'T-175');
});

test('terminal-time evidence reconciliation preserves the irreversible lifecycle fact', () => {
  const { aggregate, authority } = fixture();
  bind(aggregate);
  aggregate.upgradeIdentity({
    handle: RuntimeHandle.sessionId('thr-terminal', 'codex-jsonl', T3),
    transcript: { status: 'supported', value: { path: '/tmp/rollout-a.jsonl' } },
    attach: attachFor('thr-terminal'),
  });
  aggregate.beginClosing({
    at: T3,
    terminal: { state: 'exited', exit_code: 0, signal: null, error_code: null, reaped: true },
  });
  aggregate.close({ at: T3, outcome: 'worker exited code=0' });
  const terminal = aggregate.toAgentRecord();

  assert.throws(
    () =>
      aggregate.upgradeIdentity({
        handle: RuntimeHandle.sessionId('thr-terminal', 'codex-jsonl', T3),
        transcript: { status: 'supported', value: { path: '/tmp/rollout-b.jsonl' } },
        attach: attachFor('thr-terminal'),
      }),
    (error: unknown) => error instanceof TrackedDispatchError && error.code === 'evidence_conflict',
  );
  aggregate.requireEvidenceReconciliation({
    reason: 'conflicting-session-evidence',
    at: T3,
  });

  const reconciled = aggregate.toAgentRecord();
  assert.equal(reconciled.dispatch.phase, 'reconciliation-required');
  assert.equal(reconciled.lifecycle.state, 'terminal');
  assert.equal(reconciled.lifecycle.ended_at, terminal.lifecycle.ended_at);
  assert.equal(reconciled.lifecycle.outcome, terminal.lifecycle.outcome);
  assert.deepEqual(reconciled.dispatch.terminal, terminal.dispatch.terminal);
  assert.deepEqual(reconciled.handle, terminal.handle);
  assert.equal(
    TrackedDispatch.rehydrate(authority, reconciled).toAgentRecord().lifecycle.state,
    'terminal',
  );
});

test('ambiguous post-claim state is fail-closed and cannot be claimed or bound again', () => {
  const { aggregate } = fixture();
  aggregate.claimLaunch({ token: 'claim-1', claimedAt: T1, launcherPid: 9123 });
  aggregate.requireReconciliation({ reason: 'ambiguous-launch', at: T2 });
  assert.equal(aggregate.toAgentRecord().dispatch.phase, 'reconciliation-required');
  assert.equal(aggregate.toAgentRecord().dispatch.reconciliation_required, true);
  assert.throws(
    () => aggregate.claimLaunch({ token: 'claim-2', claimedAt: T3, launcherPid: 9124 }),
    (error: unknown) =>
      error instanceof TrackedDispatchError && error.code === 'reconciliation_required',
  );
});

test('rehydration rejects fabricated running state, missing PID evidence, and cross-task links', () => {
  const { aggregate, authority } = fixture();
  const prepared = aggregate.toAgentRecord();
  prepared.lifecycle.state = 'running';
  assert.throws(
    () => TrackedDispatch.rehydrate(authority, prepared),
    /persisted dispatch invariant/u,
  );

  const f = fixture();
  f.aggregate.claimLaunch({ token: 'claim-1', claimedAt: T1, launcherPid: 9123 });
  f.aggregate.bindStartedWorker({
    claimToken: 'claim-1',
    handle: RuntimeHandle.pid(42117, T2),
    linkedAt: T2,
  });
  const missingPid = f.aggregate.toAgentRecord();
  delete missingPid.dispatch.runtime_pid;
  assert.throws(
    () => TrackedDispatch.rehydrate(f.authority, missingPid),
    /persisted dispatch invariant/u,
  );

  const fakePid = f.aggregate.toAgentRecord();
  fakePid.dispatch.evidence[0] = { ...fakePid.dispatch.evidence[0], value: '99999' } as never;
  assert.throws(
    () => TrackedDispatch.rehydrate(f.authority, fakePid),
    /persisted dispatch invariant/u,
  );

  const wrongLink = f.aggregate.toAgentRecord();
  if (wrongLink.links) wrongLink.links[0] = { task_id: 'OTHER', linked_at: T2 };
  assert.throws(
    () => TrackedDispatch.rehydrate(f.authority, wrongLink),
    /persisted dispatch invariant/u,
  );

  f.aggregate.upgradeIdentity({
    handle: RuntimeHandle.sessionId('thr-coherent', 'codex-jsonl', T3),
    transcript: { status: 'supported', value: { path: '/tmp/coherent.jsonl' } },
    attach: attachFor('thr-coherent'),
  });
  const contradictoryCapability = f.aggregate.toAgentRecord();
  contradictoryCapability.dispatch.capabilities.transcript = {
    status: 'unavailable',
    reason: 'contradicts-persisted-transcript-ref',
  };
  assert.throws(
    () => TrackedDispatch.rehydrate(f.authority, contradictoryCapability),
    /degraded transcript capability cannot retain a transcript ref/u,
  );

  const impossibleAttachHarness = f.aggregate.toAgentRecord();
  impossibleAttachHarness.harness = 'cursor-agent';
  assert.throws(
    () => TrackedDispatch.rehydrate(f.authority, impossibleAttachHarness),
    /supported attach requires a canonical harness session-resume command/u,
  );

  const attachWithExecutablePayload = f.aggregate.toAgentRecord();
  attachWithExecutablePayload.dispatch.capabilities.attach = {
    status: 'supported',
    value: {
      kind: 'session-resume',
      cwd: '/tmp/secret-worktree',
      argv: ['codex', 'resume', 'thr-coherent', '--api-key=sk-secret-like'],
    },
  } as never;
  assert.throws(
    () => TrackedDispatch.rehydrate(f.authority, attachWithExecutablePayload),
    (error: unknown) => {
      assert.equal(String(error).includes('sk-secret-like'), false);
      return /supported attach must contain only its capability class/u.test(String(error));
    },
  );

  for (const degradedAttach of [
    { status: 'unavailable', reason: 'attach-not-located' },
    { status: 'unsupported', reason: 'attach-not-supported' },
  ] as const) {
    const canonicalSessionWithoutAttach = f.aggregate.toAgentRecord();
    canonicalSessionWithoutAttach.dispatch.capabilities.attach = degradedAttach;
    assert.throws(
      () => TrackedDispatch.rehydrate(f.authority, canonicalSessionWithoutAttach),
      /canonical session handle requires supported attach capability/u,
      degradedAttach.status,
    );
  }
});
