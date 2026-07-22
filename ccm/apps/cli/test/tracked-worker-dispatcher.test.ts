import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import {
  BoardIdentity,
  BoardWriteAuthority,
  DispatchKey,
  RuntimeHandle,
  TaskRef,
} from '@ccm/engine';
import type {
  WorkerExecutionFace,
  WorkerExecutionObserver,
} from '../src/harnesses/capability-model.js';
import {
  BoardAgentRegistryRepository,
  type TrackedDispatchRepositoryFace,
} from '../src/tracked-dispatch-repository.js';
import { dispatchTrackedWorker } from '../src/tracked-worker-dispatcher.js';
import { type WorkerHarness, workerDescriptor } from '../src/worker-descriptors.js';
import type { WorkerProcessRequest, WorkerProcessResult } from '../src/worker-process.js';

const DIGEST = `sha256:${'d'.repeat(64)}`;
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(harness: WorkerHarness = 'codex') {
  const root = mkdtempSync(join(tmpdir(), 'ccm-tracked-dispatch-'));
  roots.push(root);
  const boardPath = join(root, 'run.board.json');
  const task = {
    id: 'T-175',
    status: 'ready',
    deps: [],
    handle: 'owned-by-agent-lifecycle',
    acceptance: 'never-inferred',
    routing: { attempts: [{ id: 'attempt-must-not-change' }] },
  };
  writeFileSync(
    boardPath,
    `${JSON.stringify({
      schema: 'cc-master/v2',
      meta: { template_version: 3 },
      goal: 'tracked worker dispatch',
      owner: { active: true, session_id: 'owner-session' },
      git: { worktree: root, branch: 'test' },
      tasks: [task],
    })}\n`,
  );
  const canonical = realpathSync(boardPath);
  const identity = BoardIdentity.fromCanonicalPath(canonical);
  const descriptor = workerDescriptor(harness);
  assert.ok(descriptor);
  const authority = BoardWriteAuthority.create({
    canonicalBoardPath: canonical,
    boardIdentity: identity,
    ownerSessionId: 'owner-session',
    selectionSource: 'explicit-board',
  });
  const workerRequest: WorkerProcessRequest = {
    descriptor,
    providerArgv:
      harness === 'codex'
        ? ['exec', '--json', '--secret-provider-arg', 'PROMPT-MUST-NOT-PERSIST']
        : harness === 'kimi-code'
          ? [
              '-p',
              'PROMPT-MUST-NOT-PERSIST',
              '--output-format',
              'stream-json',
              '--secret-provider-arg',
            ]
          : harness === 'claude-code'
            ? [
                '--print',
                '--output-format',
                'stream-json',
                '--secret-provider-arg',
                'PROMPT-MUST-NOT-PERSIST',
              ]
            : ['--secret-provider-arg', 'PROMPT-MUST-NOT-PERSIST'],
    cwd: root,
    timeoutMs: 1_000,
    maxOutputBytes: 65_536,
    stdinFd: 'ignore',
    env: { HOME: root, SECRET_ENV: 'MUST-NOT-PERSIST' },
    runtime: {} as WorkerProcessRequest['runtime'],
  };
  return {
    root,
    boardPath,
    authority,
    taskRef: TaskRef.create(identity, 'T-175'),
    task,
    workerRequest,
    read: () => JSON.parse(readFileSync(boardPath, 'utf8')),
  };
}

function workerResult(
  request: WorkerProcessRequest,
  input: Partial<WorkerProcessResult> = {},
): WorkerProcessResult {
  return {
    schema: 'ccm/worker-process-result/v1',
    harness: request.descriptor.harness,
    executable: '/fake/provider',
    argv: [...request.providerArgv],
    cwd: request.cwd,
    state: 'exited',
    exit_code: 0,
    signal: null,
    stdout: 'PROVIDER-OUTPUT-MUST-NOT-PERSIST',
    stderr: '',
    stdout_bytes: 32,
    stderr_bytes: 0,
    truncated: { stdout: false, stderr: false },
    timed_out: false,
    cancelled: false,
    reaped: true,
    duration_ms: 10,
    cleanup: { temporary_resources_removed: true },
    error: null,
    ...input,
  };
}

function clock() {
  let tick = 0;
  return () => `2026-07-22T07:00:${String(tick++).padStart(2, '0')}Z`;
}

function input(f: ReturnType<typeof fixture>, harness: WorkerHarness) {
  return {
    authority: f.authority,
    task: f.taskRef,
    key: DispatchKey.create(`key-${harness}`),
    requestDigest: DIGEST,
    harness,
    intent: 'review issue 175',
    workerRequest: f.workerRequest,
  };
}

class FakeExecution implements WorkerExecutionFace {
  readonly executionModes = ['headless-cli'] as const;
  count = 0;
  constructor(
    private readonly action: (
      request: WorkerProcessRequest,
      observer?: WorkerExecutionObserver,
    ) => Promise<WorkerProcessResult>,
  ) {}
  execute(request: WorkerProcessRequest, observer?: WorkerExecutionObserver) {
    this.count += 1;
    return this.action(request, observer);
  }
}

function deps(repository: TrackedDispatchRepositoryFace, execution: WorkerExecutionFace) {
  return {
    repository,
    execution,
    now: clock(),
    claimToken: () => 'claim-175',
    launcherPid: process.pid,
  };
}

function repositoryFace(
  base: BoardAgentRegistryRepository,
  overrides: Partial<TrackedDispatchRepositoryFace> = {},
): TrackedDispatchRepositoryFace {
  return {
    prepareOrReplay: overrides.prepareOrReplay ?? base.prepareOrReplay.bind(base),
    claimLaunch: overrides.claimLaunch ?? base.claimLaunch.bind(base),
    commitStartedWorker: overrides.commitStartedWorker ?? base.commitStartedWorker.bind(base),
    upgradeIdentity: overrides.upgradeIdentity ?? base.upgradeIdentity.bind(base),
    recordStartupFailure: overrides.recordStartupFailure ?? base.recordStartupFailure.bind(base),
    beginClosing: overrides.beginClosing ?? base.beginClosing.bind(base),
    commitTerminal: overrides.commitTerminal ?? base.commitTerminal.bind(base),
    markReconciliationRequired:
      overrides.markReconciliationRequired ?? base.markReconciliationRequired.bind(base),
  };
}

type ReconciliationFallback = 'bind-observer' | 'startup-terminal' | 'terminal';

async function markerFailureScenario(path: ReconciliationFallback, markerFailures: number) {
  const f = fixture();
  const base = new BoardAgentRegistryRepository();
  let primaryWrites = 0;
  let markerWrites = 0;
  const overrides: Partial<TrackedDispatchRepositoryFace> = {};
  let execution: FakeExecution;

  if (path === 'bind-observer') {
    overrides.upgradeIdentity = () => {
      primaryWrites += 1;
      throw new Error('identity observer tracking failure');
    };
    execution = new FakeExecution(async (request, observer) => {
      observer?.onStarted?.({ pid: 43_175 });
      try {
        observer?.onStdoutText?.('{"type":"thread.started","thread_id":"thr_175"}\n');
      } catch {
        // The fake provider still exits zero after the observer reports its persistence failure.
      }
      return workerResult(request);
    });
  } else if (path === 'startup-terminal') {
    overrides.recordStartupFailure = () => {
      primaryWrites += 1;
      throw new Error('startup terminal tracking failure');
    };
    execution = new FakeExecution(async (request) => workerResult(request));
  } else {
    overrides.commitTerminal = () => {
      primaryWrites += 1;
      throw new Error('terminal tracking failure');
    };
    execution = new FakeExecution(async (request, observer) => {
      observer?.onStarted?.({ pid: 43_175 });
      return workerResult(request);
    });
  }

  const repository = repositoryFace(base, {
    ...overrides,
    markReconciliationRequired: (marker) => {
      markerWrites += 1;
      if (markerWrites <= markerFailures) {
        throw Object.assign(new Error('reconciliation marker persistence failed'), {
          code: 'tracking_write_failure',
        });
      }
      return base.markReconciliationRequired(marker);
    },
  });
  const result = await dispatchTrackedWorker(input(f, 'codex'), {
    ...deps(repository, execution),
    terminalWriteAttempts: 3,
  });
  return { f, markerWrites, primaryWrites, result };
}

test('all four harnesses launch under truthful PID tracking; only proven identities enrich', async () => {
  for (const harness of ['codex', 'claude-code', 'cursor-agent', 'kimi-code'] as const) {
    const f = fixture(harness);
    if (harness === 'claude-code') {
      const transcript = join(f.root, '.claude', 'projects', 'fixture', 'claude_175.jsonl');
      mkdirSync(join(transcript, '..'), { recursive: true });
      writeFileSync(transcript, '{}\n');
    }
    const execution = new FakeExecution(async (request, observer) => {
      observer?.onStarted?.({ pid: 43_000 + execution.count });
      if (harness === 'codex') {
        observer?.onStdoutText?.('{"type":"thread.started","thread_id":"thr_175"}\n');
      } else if (harness === 'claude-code') {
        observer?.onStdoutText?.(
          '{"type":"result","subtype":"success","session_id":"claude_175"}\n',
        );
      } else if (harness === 'kimi-code') {
        observer?.onStderrText?.(
          '{"role":"meta","type":"session.resume_hint","session_id":"session_175"}\n',
        );
      }
      return workerResult(request);
    });
    const result = await dispatchTrackedWorker(
      input(f, harness),
      deps(new BoardAgentRegistryRepository(), execution),
    );
    assert.equal(result.exitCode, 0, harness);
    assert.equal(result.trackingState, 'closed', harness);
    assert.equal(result.spawned, true, harness);
    const board = f.read();
    assert.deepEqual(board.tasks[0], f.task, harness);
    const agent = board.agents[0];
    assert.equal(agent.dispatch.evidence[0].kind, 'pid', harness);
    if (harness !== 'cursor-agent') {
      assert.equal(agent.handle.kind, 'session-id', harness);
      assert.equal(agent.dispatch.capabilities.identity.status, 'supported', harness);
      assert.equal(agent.dispatch.capabilities.attach.status, 'supported', harness);
      assert.deepEqual(
        result.tracking.attach,
        {
          status: 'supported',
          value: {
            cwd: f.root,
            argv:
              harness === 'codex'
                ? ['codex', 'resume', 'thr_175']
                : harness === 'claude-code'
                  ? ['claude', '--resume', 'claude_175']
                  : ['kimi', '-S', 'session_175'],
          },
        },
        harness,
      );
    } else {
      assert.equal(agent.handle.kind, 'pid', harness);
      assert.equal(agent.dispatch.capabilities.identity.status, 'unsupported', harness);
      assert.equal(agent.dispatch.capabilities.attach.status, 'unsupported', harness);
    }
    const persisted = readFileSync(f.boardPath, 'utf8');
    for (const forbidden of [
      'PROMPT-MUST-NOT-PERSIST',
      '--secret-provider-arg',
      'SECRET_ENV',
      'MUST-NOT-PERSIST',
      'PROVIDER-OUTPUT-MUST-NOT-PERSIST',
      '"argv"',
    ]) {
      assert.equal(persisted.includes(forbidden), false, `${harness}: ${forbidden}`);
    }
  }
});

test('same key and digest replays closed result without spawning; different digest conflicts', async () => {
  const f = fixture();
  const repository = new BoardAgentRegistryRepository();
  const execution = new FakeExecution(async (request, observer) => {
    observer?.onStarted?.({ pid: 43_175 });
    return workerResult(request);
  });
  const first = await dispatchTrackedWorker(input(f, 'codex'), deps(repository, execution));
  const replay = await dispatchTrackedWorker(input(f, 'codex'), deps(repository, execution));
  assert.equal(first.exitCode, 0);
  assert.equal(replay.replayed, true);
  assert.equal(replay.spawned, false);
  assert.equal(execution.count, 1);
  await assert.rejects(() =>
    dispatchTrackedWorker(
      { ...input(f, 'codex'), requestDigest: `sha256:${'e'.repeat(64)}` },
      deps(repository, execution),
    ),
  );
  assert.equal(execution.count, 1);
});

test('pre-spawn rejection closes as startup failure without PID or task link', async () => {
  const f = fixture();
  const execution = new FakeExecution(async (request) =>
    workerResult(request, {
      state: 'rejected',
      executable: null,
      error: { code: 'executable_unavailable', message: 'unavailable' },
      reaped: false,
    }),
  );
  const result = await dispatchTrackedWorker(
    input(f, 'codex'),
    deps(new BoardAgentRegistryRepository(), execution),
  );
  assert.equal(result.exitCode, 1);
  const agent = f.read().agents[0];
  assert.equal(agent.dispatch.phase, 'closed');
  assert.equal(agent.dispatch.runtime_pid, undefined);
  assert.equal(agent.links, undefined);
});

test('persistent startup-terminal tracking failure is durably marked for reconciliation', async () => {
  const f = fixture();
  const base = new BoardAgentRegistryRepository();
  let terminalWrites = 0;
  const repository: TrackedDispatchRepositoryFace = {
    prepareOrReplay: base.prepareOrReplay.bind(base),
    claimLaunch: base.claimLaunch.bind(base),
    commitStartedWorker: base.commitStartedWorker.bind(base),
    upgradeIdentity: base.upgradeIdentity.bind(base),
    recordStartupFailure: () => {
      terminalWrites += 1;
      throw new Error('persistent startup-terminal tracking failure');
    },
    beginClosing: base.beginClosing.bind(base),
    commitTerminal: base.commitTerminal.bind(base),
    markReconciliationRequired: base.markReconciliationRequired.bind(base),
  };
  const execution = new FakeExecution(async (request) =>
    workerResult(request, {
      state: 'rejected',
      executable: null,
      error: { code: 'executable_unavailable', message: 'unavailable' },
      reaped: false,
    }),
  );

  const result = await dispatchTrackedWorker(input(f, 'codex'), deps(repository, execution));

  assert.equal(terminalWrites, 3);
  assert.equal(result.exitCode, 1);
  assert.equal(result.trackingState, 'reconciliation-required');
  assert.match(result.trackingError?.message ?? '', /startup-terminal tracking failure/u);
  const agent = f.read().agents[0];
  assert.equal(agent.dispatch.phase, 'reconciliation-required');
  assert.equal(agent.dispatch.reconciliation_reason, 'startup-terminal-tracking-failure');
});

test('all reconciliation marker paths retry transient persistence failures to durability', async (t) => {
  for (const path of ['bind-observer', 'startup-terminal', 'terminal'] as const) {
    await t.test(path, async () => {
      const observed = await markerFailureScenario(path, 2);
      const agent = observed.f.read().agents[0];
      assert.equal(observed.markerWrites, 3);
      assert.equal(observed.primaryWrites, path === 'bind-observer' ? 1 : 3);
      assert.equal(observed.result.worker?.exit_code, 0);
      assert.equal(observed.result.exitCode, 1);
      assert.equal(observed.result.trackingState, 'reconciliation-required');
      assert.equal(observed.result.dispatch.reconciliation_required, true);
      assert.equal(agent.dispatch.phase, 'reconciliation-required');
    });
  }
});

test('exhausted reconciliation marker retries never claim false durability', async (t) => {
  const expectedPersistedPhase: Record<ReconciliationFallback, string> = {
    'bind-observer': 'bound',
    'startup-terminal': 'launch-claimed',
    terminal: 'closing',
  };
  for (const path of ['bind-observer', 'startup-terminal', 'terminal'] as const) {
    await t.test(path, async () => {
      const observed = await markerFailureScenario(path, Number.POSITIVE_INFINITY);
      const agent = observed.f.read().agents[0];
      assert.equal(observed.markerWrites, 3);
      assert.equal(observed.primaryWrites, path === 'bind-observer' ? 1 : 3);
      assert.equal(observed.result.worker?.exit_code, 0);
      assert.equal(observed.result.exitCode, 1);
      assert.equal(observed.result.trackingState, 'tracking-persistence-failed');
      assert.equal(observed.result.dispatch.reconciliation_required, false);
      assert.equal(observed.result.dispatch.phase, expectedPersistedPhase[path]);
      assert.equal(observed.result.tracking.state, agent.lifecycle.state);
      assert.equal(agent.dispatch.phase, expectedPersistedPhase[path]);
      assert.equal(agent.dispatch.reconciliation_required, false);
      assert.equal(observed.result.trackingError?.code, 'tracking_write_failure');
      assert.match(
        observed.result.trackingError?.message ?? '',
        /reconciliation marker persistence failed/u,
      );
    });
  }
});

test('transient terminal write is retried and tracking failure dominates worker exit zero', async () => {
  const f = fixture();
  let writes = 0;
  const retrying = new BoardAgentRegistryRepository({
    writeFileAtomicSync(path, data) {
      writes += 1;
      if (writes === 5) throw new Error('one terminal commit failure');
      writeFileSync(path, data);
    },
  });
  const execution = new FakeExecution(async (request, observer) => {
    observer?.onStarted?.({ pid: 43_175 });
    return workerResult(request);
  });
  const recovered = await dispatchTrackedWorker(input(f, 'codex'), deps(retrying, execution));
  assert.equal(recovered.exitCode, 0);
  assert.equal(recovered.trackingState, 'closed');
  assert.equal(writes, 6);

  const g = fixture();
  const base = new BoardAgentRegistryRepository();
  const failing: TrackedDispatchRepositoryFace = {
    prepareOrReplay: base.prepareOrReplay.bind(base),
    claimLaunch: base.claimLaunch.bind(base),
    commitStartedWorker: base.commitStartedWorker.bind(base),
    upgradeIdentity: base.upgradeIdentity.bind(base),
    recordStartupFailure: base.recordStartupFailure.bind(base),
    beginClosing: base.beginClosing.bind(base),
    commitTerminal: () => {
      throw new Error('persistent terminal tracking failure');
    },
    markReconciliationRequired: base.markReconciliationRequired.bind(base),
  };
  const failed = await dispatchTrackedWorker(input(g, 'codex'), deps(failing, execution));
  assert.equal(failed.worker?.exit_code, 0);
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.trackingState, 'reconciliation-required');
  assert.match(failed.trackingError?.message ?? '', /terminal tracking failure/u);
});

test('post-commit response loss at either terminal write is exact-replay safe', async () => {
  for (const lostWrite of [4, 5]) {
    const f = fixture('claude-code');
    let writes = 0;
    const repository = new BoardAgentRegistryRepository({
      writeFileAtomicSync(path, data) {
        writes += 1;
        writeFileSync(path, data);
        if (writes === lostWrite) throw new Error('response lost after durable write');
      },
    });
    const execution = new FakeExecution(async (request, observer) => {
      observer?.onStarted?.({ pid: 45_175 + lostWrite });
      return workerResult(request);
    });
    const completed = await dispatchTrackedWorker(
      input(f, 'claude-code'),
      deps(repository, execution),
    );
    assert.equal(completed.exitCode, 0, `lost write ${lostWrite}`);
    assert.equal(completed.trackingState, 'closed', `lost write ${lostWrite}`);
    assert.equal(f.read().agents[0].dispatch.phase, 'closed', `lost write ${lostWrite}`);
  }
});

test('bind failure causes reconciliation and cannot be mistaken for worker success', async () => {
  const f = fixture();
  let writes = 0;
  const repository = new BoardAgentRegistryRepository({
    writeFileAtomicSync(path, data) {
      writes += 1;
      if (writes === 3) throw new Error('bind write failed');
      writeFileSync(path, data);
    },
  });
  const execution = new FakeExecution(async (request, observer) => {
    try {
      observer?.onStarted?.({ pid: 43_175 });
      return workerResult(request);
    } catch {
      return workerResult(request, {
        state: 'failed',
        exit_code: null,
        error: { code: 'consumer_error', message: 'bind observer failed' },
        reaped: true,
      });
    }
  });
  const result = await dispatchTrackedWorker(input(f, 'codex'), deps(repository, execution));
  assert.equal(result.exitCode, 1);
  assert.equal(result.trackingState, 'reconciliation-required');
  const agent = f.read().agents[0];
  assert.equal(agent.handle.kind, 'none');
  assert.equal(agent.lifecycle.state, 'uncertain');
});

test('a persisted closing fact is completed on replay without respawn', async () => {
  const f = fixture();
  const repository = new BoardAgentRegistryRepository();
  const key = DispatchKey.create('key-codex');
  repository.prepareOrReplay({
    authority: f.authority,
    task: f.taskRef,
    key,
    requestDigest: DIGEST,
    harness: 'codex',
    intent: 'review issue 175',
    cwd: f.root,
    createdAt: '2026-07-22T07:10:00Z',
  });
  repository.claimLaunch({
    authority: f.authority,
    key,
    requestDigest: DIGEST,
    claimToken: 'old-claim',
    claimedAt: '2026-07-22T07:10:01Z',
    launcherPid: process.pid,
  });
  repository.commitStartedWorker({
    authority: f.authority,
    key,
    requestDigest: DIGEST,
    claimToken: 'old-claim',
    handle: RuntimeHandle.pid(44_175, '2026-07-22T07:10:02Z'),
    linkedAt: '2026-07-22T07:10:02Z',
  });
  repository.beginClosing({
    authority: f.authority,
    key,
    requestDigest: DIGEST,
    at: '2026-07-22T07:10:03Z',
    terminal: { state: 'exited', exit_code: 0, signal: null, error_code: null, reaped: true },
  });
  const execution = new FakeExecution(async () => {
    throw new Error('closing replay must not spawn');
  });
  const result = await dispatchTrackedWorker(input(f, 'codex'), deps(repository, execution));
  assert.equal(result.exitCode, 0);
  assert.equal(result.replayed, true);
  assert.equal(result.trackingState, 'closed');
  assert.equal(execution.count, 0);
});

test('closing replay retries transient terminal persistence and recovers without respawn', async () => {
  const f = fixture();
  const base = new BoardAgentRegistryRepository();
  const key = DispatchKey.create('key-codex');
  base.prepareOrReplay({
    authority: f.authority,
    task: f.taskRef,
    key,
    requestDigest: DIGEST,
    harness: 'codex',
    intent: 'review issue 175',
    cwd: f.root,
    createdAt: '2026-07-22T07:20:00Z',
  });
  base.claimLaunch({
    authority: f.authority,
    key,
    requestDigest: DIGEST,
    claimToken: 'old-claim',
    claimedAt: '2026-07-22T07:20:01Z',
    launcherPid: process.pid,
  });
  base.commitStartedWorker({
    authority: f.authority,
    key,
    requestDigest: DIGEST,
    claimToken: 'old-claim',
    handle: RuntimeHandle.pid(44_176, '2026-07-22T07:20:02Z'),
    linkedAt: '2026-07-22T07:20:02Z',
  });
  base.beginClosing({
    authority: f.authority,
    key,
    requestDigest: DIGEST,
    at: '2026-07-22T07:20:03Z',
    terminal: { state: 'exited', exit_code: 0, signal: null, error_code: null, reaped: true },
  });
  let attempts = 0;
  const repository = repositoryFace(base, {
    commitTerminal: (terminal) => {
      attempts += 1;
      if (attempts < 3) throw new Error('transient replay terminal tracking failure');
      return base.commitTerminal(terminal);
    },
  });
  const execution = new FakeExecution(async () => {
    throw new Error('closing replay must not spawn');
  });
  const result = await dispatchTrackedWorker(input(f, 'codex'), {
    ...deps(repository, execution),
    terminalWriteAttempts: 3,
  });
  assert.equal(attempts, 3);
  assert.equal(result.exitCode, 0);
  assert.equal(result.trackingState, 'closed');
  assert.equal(result.dispatch.reconciliation_required, false);
  assert.equal(execution.count, 0);
});

test('closing replay persistence exhaustion returns latest durable tracking failure receipt', async () => {
  const f = fixture();
  const base = new BoardAgentRegistryRepository();
  const key = DispatchKey.create('key-codex');
  base.prepareOrReplay({
    authority: f.authority,
    task: f.taskRef,
    key,
    requestDigest: DIGEST,
    harness: 'codex',
    intent: 'review issue 175',
    cwd: f.root,
    createdAt: '2026-07-22T07:30:00Z',
  });
  base.claimLaunch({
    authority: f.authority,
    key,
    requestDigest: DIGEST,
    claimToken: 'old-claim',
    claimedAt: '2026-07-22T07:30:01Z',
    launcherPid: process.pid,
  });
  base.commitStartedWorker({
    authority: f.authority,
    key,
    requestDigest: DIGEST,
    claimToken: 'old-claim',
    handle: RuntimeHandle.pid(44_177, '2026-07-22T07:30:02Z'),
    linkedAt: '2026-07-22T07:30:02Z',
  });
  base.beginClosing({
    authority: f.authority,
    key,
    requestDigest: DIGEST,
    at: '2026-07-22T07:30:03Z',
    terminal: { state: 'exited', exit_code: 0, signal: null, error_code: null, reaped: true },
  });
  let terminalAttempts = 0;
  let markerAttempts = 0;
  const repository = repositoryFace(base, {
    commitTerminal: () => {
      terminalAttempts += 1;
      throw new Error('persistent replay terminal tracking failure');
    },
    markReconciliationRequired: () => {
      markerAttempts += 1;
      throw Object.assign(new Error('persistent replay reconciliation persistence failure'), {
        code: 'tracking_write_failure',
      });
    },
  });
  const execution = new FakeExecution(async () => {
    throw new Error('closing replay must not spawn');
  });
  const result = await dispatchTrackedWorker(input(f, 'codex'), {
    ...deps(repository, execution),
    terminalWriteAttempts: 3,
  });
  const durable = f.read().agents[0];
  assert.equal(terminalAttempts, 3);
  assert.equal(markerAttempts, 3);
  assert.equal(result.schema, 'ccm/tracked-worker-dispatch-result/v1');
  assert.equal(result.exitCode, 1);
  assert.equal(result.replayed, true);
  assert.equal(result.spawned, false);
  assert.equal(result.worker, null);
  assert.equal(result.trackingState, 'tracking-persistence-failed');
  assert.equal(result.dispatch.phase, 'closing');
  assert.equal(result.dispatch.reconciliation_required, false);
  assert.equal(result.tracking.state, durable.lifecycle.state);
  assert.equal(durable.dispatch.phase, 'closing');
  assert.equal(durable.dispatch.reconciliation_required, false);
  assert.equal(result.trackingError?.code, 'tracking_write_failure');
  assert.equal(execution.count, 0);
});
