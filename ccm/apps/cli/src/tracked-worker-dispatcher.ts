import {
  type AttachInstruction,
  type BoardWriteAuthority,
  type CapabilityResult,
  type DispatchKey,
  RuntimeHandle,
  type TaskRef,
  type TrackedAgentRecord,
  type TranscriptRef,
  type WorkerTerminalFact,
} from '@ccm/engine';
import type { WorkerExecutionFace } from './harnesses/capability-model.js';
import type { TrackedDispatchRepositoryFace } from './tracked-dispatch-repository.js';
import type { WorkerHarness } from './worker-descriptors.js';
import {
  createWorkerIdentityTracker,
  explicitWorkerSessionIdentity,
  initialWorkerCapabilities,
  type SessionIdentityObservation,
  sessionCapabilities,
} from './worker-identity.js';
import type { WorkerProcessRequest, WorkerProcessResult } from './worker-process.js';

export const TRACKED_WORKER_DISPATCH_RESULT_SCHEMA =
  'ccm/tracked-worker-dispatch-result/v1' as const;

export interface TrackedWorkerDispatchInput {
  authority: BoardWriteAuthority;
  task: TaskRef;
  key: DispatchKey;
  requestDigest: string;
  harness: WorkerHarness;
  intent: string;
  workerRequest: WorkerProcessRequest;
  transcriptRef?: string | null;
}

export interface TrackedWorkerDispatchDependencies {
  repository: TrackedDispatchRepositoryFace;
  execution: WorkerExecutionFace;
  now: () => string;
  claimToken: () => string;
  launcherPid: number;
  terminalWriteAttempts?: number;
}

export interface TrackedWorkerDispatchResult {
  schema: typeof TRACKED_WORKER_DISPATCH_RESULT_SCHEMA;
  dispatch: {
    key: string;
    agent_id: string;
    task_id: string;
    phase: string;
    idempotent_replay: boolean;
    reconciliation_required: boolean;
  };
  tracking: {
    state: TrackedAgentRecord['lifecycle']['state'];
    primary_handle: { kind: string; value: string };
    runtime_pid: number | null;
    transcript: CapabilityResult<TranscriptRef>;
    attach: CapabilityResult<AttachInstruction>;
    degradations: string[];
  };
  agentId: string;
  trackingState: string;
  replayed: boolean;
  spawned: boolean;
  worker: WorkerProcessResult | null;
  trackingError: { code: string; message: string } | null;
  exitCode: number;
}

function recordOf(aggregate: { toAgentRecord(): TrackedAgentRecord }): TrackedAgentRecord {
  return aggregate.toAgentRecord();
}

function terminalFact(result: WorkerProcessResult): WorkerTerminalFact {
  return {
    state: result.state,
    exit_code: result.exit_code,
    signal: result.signal,
    error_code: result.error?.code ?? null,
    reaped: result.reaped,
  };
}

function outcomeOf(fact: WorkerTerminalFact): string {
  if (fact.state === 'exited') return `exited:${String(fact.exit_code)}`;
  if (fact.signal) return `${fact.state}:signal:${fact.signal}`;
  return `${fact.state}:${fact.error_code ?? 'unknown'}`;
}

function validExitCode(value: number | null): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 255
    ? Number(value)
    : null;
}

function workerExitCode(result: WorkerProcessResult): number {
  if (result.state !== 'exited' || result.signal !== null) return 1;
  return validExitCode(result.exit_code) ?? 1;
}

function terminalReplayExit(record: TrackedAgentRecord): number {
  const terminal = record.dispatch.terminal;
  if (!terminal || terminal.state !== 'exited' || terminal.signal !== null) return 1;
  return validExitCode(terminal.exit_code) ?? 1;
}

function trackingFailure(error: unknown): { code: string; message: string } {
  const candidate = error as { code?: unknown; message?: unknown };
  return {
    code: typeof candidate?.code === 'string' ? candidate.code : 'tracking_failure',
    message: typeof candidate?.message === 'string' ? candidate.message : String(error),
  };
}

async function retry<T>(attempts: number, action: () => T): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return action();
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

async function reconciliationFallback(input: {
  request: TrackedWorkerDispatchInput;
  deps: TrackedWorkerDispatchDependencies;
  latestRecord: TrackedAgentRecord;
  reason: string;
  cause: unknown;
}): Promise<{
  record: TrackedAgentRecord;
  trackingState: 'reconciliation-required' | 'tracking-persistence-failed';
  trackingError: { code: string; message: string };
}> {
  try {
    const aggregate = await retry(input.deps.terminalWriteAttempts ?? 3, () =>
      input.deps.repository.markReconciliationRequired({
        authority: input.request.authority,
        key: input.request.key,
        requestDigest: input.request.requestDigest,
        at: input.deps.now(),
        reason: input.reason,
      }),
    );
    return {
      record: recordOf(aggregate),
      trackingState: 'reconciliation-required',
      trackingError: trackingFailure(input.cause),
    };
  } catch (markerError) {
    return {
      record: input.latestRecord,
      trackingState: 'tracking-persistence-failed',
      trackingError: trackingFailure(markerError),
    };
  }
}

function trackingReceipt(
  record: TrackedAgentRecord,
  input: TrackedWorkerDispatchInput,
): TrackedWorkerDispatchResult['tracking'] {
  const persistedAttach = record.dispatch.capabilities.attach;
  const attach: CapabilityResult<AttachInstruction> =
    record.handle.kind === 'session-id'
      ? sessionCapabilities({
          harness: input.harness,
          sessionId: record.handle.value,
          cwd: input.workerRequest.cwd,
          env: input.workerRequest.env,
          transcriptRef: input.transcriptRef,
        }).attach
      : persistedAttach.status === 'supported'
        ? { status: 'unavailable', reason: 'session-identity-not-observed' }
        : persistedAttach;
  const degradations: string[] = [];
  for (const [name, capability] of Object.entries({
    identity: record.dispatch.capabilities.identity,
    transcript: record.dispatch.capabilities.transcript,
    attach,
  })) {
    if (capability.status !== 'supported') {
      degradations.push(`${name}:${capability.status}:${capability.reason}`);
    }
  }
  return {
    state: record.lifecycle.state,
    primary_handle: { kind: record.handle.kind, value: record.handle.value },
    runtime_pid: record.dispatch.runtime_pid ?? null,
    transcript: record.dispatch.capabilities.transcript,
    attach,
    degradations,
  };
}

function result(
  record: TrackedAgentRecord,
  request: TrackedWorkerDispatchInput,
  input: Omit<TrackedWorkerDispatchResult, 'schema' | 'dispatch' | 'tracking'>,
): TrackedWorkerDispatchResult {
  return {
    schema: TRACKED_WORKER_DISPATCH_RESULT_SCHEMA,
    dispatch: {
      key: record.dispatch.key,
      agent_id: record.id,
      task_id: record.dispatch.task_id,
      phase: record.dispatch.phase,
      idempotent_replay: input.replayed,
      reconciliation_required: record.dispatch.reconciliation_required,
    },
    tracking: trackingReceipt(record, request),
    ...input,
  };
}

export async function dispatchTrackedWorker(
  input: TrackedWorkerDispatchInput,
  deps: TrackedWorkerDispatchDependencies,
): Promise<TrackedWorkerDispatchResult> {
  const prepared = deps.repository.prepareOrReplay({
    authority: input.authority,
    task: input.task,
    key: input.key,
    requestDigest: input.requestDigest,
    harness: input.harness,
    intent: input.intent,
    cwd: input.workerRequest.cwd,
    createdAt: deps.now(),
    capabilities: initialWorkerCapabilities(input.harness, {
      transcriptRef: input.transcriptRef,
      env: input.workerRequest.env,
    }),
  });
  const wasReplay = prepared.kind === 'replay';
  let preparedRecord = recordOf(prepared.aggregate);

  if (preparedRecord.dispatch.phase === 'closed') {
    return result(preparedRecord, input, {
      agentId: preparedRecord.id,
      trackingState: 'closed',
      replayed: true,
      spawned: false,
      worker: null,
      trackingError: null,
      exitCode: terminalReplayExit(preparedRecord),
    });
  }
  if (preparedRecord.dispatch.phase === 'closing') {
    const fact = preparedRecord.dispatch.terminal;
    if (!fact) throw new Error('closing tracked dispatch is missing terminal fact');
    try {
      const closed = await retry(deps.terminalWriteAttempts ?? 3, () =>
        deps.repository.commitTerminal({
          authority: input.authority,
          key: input.key,
          requestDigest: input.requestDigest,
          at: deps.now(),
          outcome: outcomeOf(fact),
        }),
      );
      preparedRecord = recordOf(closed);
      return result(preparedRecord, input, {
        agentId: preparedRecord.id,
        trackingState: 'closed',
        replayed: true,
        spawned: false,
        worker: null,
        trackingError: null,
        exitCode: terminalReplayExit(preparedRecord),
      });
    } catch (error) {
      const fallback = await reconciliationFallback({
        request: input,
        deps,
        latestRecord: preparedRecord,
        reason: 'terminal-tracking-failure',
        cause: error,
      });
      return result(fallback.record, input, {
        agentId: fallback.record.id,
        trackingState: fallback.trackingState,
        replayed: true,
        spawned: false,
        worker: null,
        trackingError: fallback.trackingError,
        exitCode: 1,
      });
    }
  }

  const claim = deps.repository.claimLaunch({
    authority: input.authority,
    key: input.key,
    requestDigest: input.requestDigest,
    claimToken: deps.claimToken(),
    claimedAt: deps.now(),
    launcherPid: deps.launcherPid,
  });
  const claimedRecord = recordOf(claim.aggregate);
  if (claim.kind !== 'claimed') {
    const state = claimedRecord.dispatch.phase;
    return result(claimedRecord, input, {
      agentId: claimedRecord.id,
      trackingState: state,
      replayed: true,
      spawned: false,
      worker: null,
      trackingError:
        state === 'reconciliation-required'
          ? {
              code: 'reconciliation_required',
              message: claimedRecord.dispatch.reconciliation_reason ?? 'reconciliation required',
            }
          : null,
      exitCode: state === 'reconciliation-required' ? 1 : 0,
    });
  }

  const tracker = createWorkerIdentityTracker(input.harness, input.workerRequest.providerArgv);
  const explicitSession = explicitWorkerSessionIdentity(
    input.harness,
    input.workerRequest.providerArgv,
  );
  const claimToken = claimedRecord.dispatch.claim?.token;
  if (!claimToken) throw new Error('claimed dispatch is missing its claim token');
  let startObserved = false;
  let bound = false;
  let latestSession: SessionIdentityObservation | null = null;
  let callbackTrackingError: unknown = null;
  let latestPersistedRecord = claimedRecord;

  const persistIdentity = (observation: SessionIdentityObservation): void => {
    latestSession = observation;
    const capabilities = sessionCapabilities({
      harness: input.harness,
      sessionId: observation.sessionId,
      cwd: input.workerRequest.cwd,
      env: input.workerRequest.env,
      transcriptRef: input.transcriptRef,
    });
    const aggregate = deps.repository.upgradeIdentity({
      authority: input.authority,
      key: input.key,
      requestDigest: input.requestDigest,
      handle: RuntimeHandle.sessionId(observation.sessionId, observation.source, deps.now()),
      transcript: capabilities.transcript,
      attach: capabilities.attach,
      changedAt: deps.now(),
    });
    latestPersistedRecord = recordOf(aggregate);
    if (latestPersistedRecord.dispatch.phase === 'reconciliation-required') {
      throw new Error('conflicting session identity requires reconciliation');
    }
  };
  const guarded = (action: () => void): void => {
    try {
      action();
    } catch (error) {
      callbackTrackingError = error;
      throw error;
    }
  };

  const worker = await deps.execution.execute(input.workerRequest, {
    onStarted(started) {
      startObserved = true;
      guarded(() => {
        const aggregate = deps.repository.commitStartedWorker({
          authority: input.authority,
          key: input.key,
          requestDigest: input.requestDigest,
          claimToken,
          handle: RuntimeHandle.pid(started.pid, deps.now()),
          linkedAt: deps.now(),
        });
        latestPersistedRecord = recordOf(aggregate);
        bound = true;
        if (explicitSession) persistIdentity(explicitSession);
      });
    },
    onStdoutText(text) {
      guarded(() => tracker.push('stdout', text).forEach(persistIdentity));
    },
    onStderrText(text) {
      guarded(() => tracker.push('stderr', text).forEach(persistIdentity));
    },
  });

  if (!callbackTrackingError) {
    try {
      tracker.finish().forEach(persistIdentity);
      if (latestSession) persistIdentity(latestSession);
    } catch (error) {
      callbackTrackingError = error;
    }
  }

  if (callbackTrackingError || (startObserved && !bound)) {
    const cause =
      callbackTrackingError ?? new Error('spawned worker PID could not be atomically bound');
    const fallback = await reconciliationFallback({
      request: input,
      deps,
      latestRecord: latestPersistedRecord,
      reason: bound ? 'tracking-observer-failure' : 'pid-bind-failure',
      cause,
    });
    return result(fallback.record, input, {
      agentId: fallback.record.id,
      trackingState: fallback.trackingState,
      replayed: wasReplay,
      spawned: startObserved,
      worker,
      trackingError: fallback.trackingError,
      exitCode: 1,
    });
  }

  const fact = terminalFact(worker);
  if (!startObserved) {
    try {
      const terminal = await retry(deps.terminalWriteAttempts ?? 3, () =>
        deps.repository.recordStartupFailure({
          authority: input.authority,
          key: input.key,
          requestDigest: input.requestDigest,
          at: deps.now(),
          terminal: fact,
          outcome: outcomeOf(fact),
        }),
      );
      const terminalRecord = recordOf(terminal);
      return result(terminalRecord, input, {
        agentId: terminalRecord.id,
        trackingState: 'closed',
        replayed: wasReplay,
        spawned: false,
        worker,
        trackingError: null,
        exitCode: workerExitCode(worker),
      });
    } catch (error) {
      const fallback = await reconciliationFallback({
        request: input,
        deps,
        latestRecord: latestPersistedRecord,
        reason: 'startup-terminal-tracking-failure',
        cause: error,
      });
      return result(fallback.record, input, {
        agentId: fallback.record.id,
        trackingState: fallback.trackingState,
        replayed: wasReplay,
        spawned: false,
        worker,
        trackingError: fallback.trackingError,
        exitCode: 1,
      });
    }
  }

  try {
    const closing = await retry(deps.terminalWriteAttempts ?? 3, () =>
      deps.repository.beginClosing({
        authority: input.authority,
        key: input.key,
        requestDigest: input.requestDigest,
        at: deps.now(),
        terminal: fact,
      }),
    );
    latestPersistedRecord = recordOf(closing);
    const closed = await retry(deps.terminalWriteAttempts ?? 3, () =>
      deps.repository.commitTerminal({
        authority: input.authority,
        key: input.key,
        requestDigest: input.requestDigest,
        at: deps.now(),
        outcome: outcomeOf(fact),
      }),
    );
    const closedRecord = recordOf(closed);
    return result(closedRecord, input, {
      agentId: closedRecord.id,
      trackingState: 'closed',
      replayed: wasReplay,
      spawned: true,
      worker,
      trackingError: null,
      exitCode: workerExitCode(worker),
    });
  } catch (error) {
    const fallback = await reconciliationFallback({
      request: input,
      deps,
      latestRecord: latestPersistedRecord,
      reason: 'terminal-tracking-failure',
      cause: error,
    });
    return result(fallback.record, input, {
      agentId: fallback.record.id,
      trackingState: fallback.trackingState,
      replayed: wasReplay,
      spawned: true,
      worker,
      trackingError: fallback.trackingError,
      exitCode: 1,
    });
  }
}
