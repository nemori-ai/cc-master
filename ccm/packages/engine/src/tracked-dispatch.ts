import { ISO_UTC_RE } from './board-model.js';
import { canonicalJson } from './canonical-json.js';

export const TRACKED_DISPATCH_METADATA_SCHEMA = 'ccm/tracked-dispatch-metadata/v1' as const;

export type DispatchPhase =
  | 'prepared'
  | 'launch-claimed'
  | 'bound'
  | 'closing'
  | 'closed'
  | 'reconciliation-required';

export type CapabilityResult<T> =
  | { status: 'supported'; value: T }
  | { status: 'unsupported'; reason: string }
  | { status: 'unavailable'; reason: string };

export interface TranscriptRef {
  path: string;
}

export interface AttachInstruction {
  cwd: string;
  argv: string[];
}

// Persist only the capability class. Exact attach argv is an ephemeral CLI receipt assembled from
// the already-persisted harness/session/cwd; launch or attach argv never belongs in the board.
export interface AttachCapability {
  kind: 'session-resume';
}

export interface WorkerTerminalFact {
  state: string;
  exit_code: number | null;
  signal: string | null;
  error_code: string | null;
  reaped: boolean;
}

export type RuntimeHandleRecord =
  | { kind: 'pid'; value: string; source: 'spawn'; captured_at: string }
  | {
      kind: 'session-id';
      value: string;
      source: string;
      captured_at: string;
    }
  | {
      kind: 'task-id';
      value: string;
      source: 'origin-harness';
      captured_at: string;
    };

export interface TrackedDispatchMetadata {
  schema: typeof TRACKED_DISPATCH_METADATA_SCHEMA;
  key: string;
  request_digest: string;
  phase: DispatchPhase;
  task_id: string;
  runtime_pid?: number;
  claim?: {
    token: string;
    claimed_at: string;
    launcher_pid: number;
  };
  evidence: RuntimeHandleRecord[];
  capabilities: {
    identity: CapabilityResult<{ kind: 'session-id'; value: string }>;
    transcript: CapabilityResult<TranscriptRef>;
    attach: CapabilityResult<AttachCapability>;
  };
  terminal?: WorkerTerminalFact & { observed_at: string };
  reconciliation_required: boolean;
  reconciliation_reason?: string;
}

export type TrackedDispatchCapabilities = TrackedDispatchMetadata['capabilities'];

export interface TrackedAgentRecord {
  id: string;
  type: 'cli-worker';
  harness: string;
  intent: string;
  launch: { created_at: string; cwd: string };
  handle: {
    kind: 'none' | 'pid' | 'session-id' | 'task-id';
    value: string;
    transcript_ref?: string;
  };
  lifecycle: {
    state: 'starting' | 'running' | 'uncertain' | 'terminal' | 'orphaned';
    registered_at: string;
    ended_at: string | null;
    outcome: string | null;
  };
  links?: Array<{ task_id: string; linked_at: string }>;
  account_ref: string | null;
  quota_pool_ref: string | null;
  dispatch: TrackedDispatchMetadata;
}

export type TrackedDispatchErrorCode =
  | 'invalid_value'
  | 'cross_board_task'
  | 'invalid_phase'
  | 'claim_token_conflict'
  | 'evidence_conflict'
  | 'reconciliation_required';

export class TrackedDispatchError extends Error {
  readonly code: TrackedDispatchErrorCode;

  constructor(code: TrackedDispatchErrorCode, message: string) {
    super(message);
    this.name = 'TrackedDispatchError';
    this.code = code;
  }
}

function invalid(message: string): never {
  throw new TrackedDispatchError('invalid_value', message);
}

function nonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') invalid(`${label} must be non-empty`);
  return value.trim();
}

function instant(value: string): string {
  if (typeof value !== 'string' || !ISO_UTC_RE.test(value)) {
    invalid(`instant must be strict ISO-8601 UTC: ${JSON.stringify(value)}`);
  }
  return value;
}

function positivePid(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) invalid('runtime handle requires a positive PID');
  return value;
}

function absolutePath(value: string, label: string): string {
  const path = nonEmpty(value, label);
  if (!(path.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(path))) {
    invalid(`${label} must be an absolute path`);
  }
  return path;
}

function capability<T>(value: CapabilityResult<T>, label: string): CapabilityResult<T> {
  if (value.status === 'supported') return { status: 'supported', value: value.value };
  return { status: value.status, reason: nonEmpty(value.reason, `${label} reason`) };
}

function evidenceConflict(label: string, persisted: unknown, observed: unknown): never {
  throw new TrackedDispatchError(
    'evidence_conflict',
    `conflicting ${label} capability evidence: ${canonicalJson(persisted)} != ${canonicalJson(observed)}`,
  );
}

function mergeCapabilityEvidence<T>(
  persisted: CapabilityResult<T>,
  observed: CapabilityResult<T>,
  label: string,
): CapabilityResult<T> {
  const validObservation = capability(observed, label);
  if (persisted.status === validObservation.status) {
    if (
      persisted.status === 'supported' &&
      validObservation.status === 'supported' &&
      canonicalJson(persisted.value) !== canonicalJson(validObservation.value)
    ) {
      evidenceConflict(label, persisted, validObservation);
    }
    return persisted;
  }

  // unavailable means this capability is supported but its value was not observed/located. It is
  // therefore comparable only with supported evidence: a value may resolve the absence, while a
  // later failed lookup cannot erase an already durable value. unsupported is a contradictory
  // negative capability claim and is deliberately incomparable with either state.
  if (persisted.status === 'unavailable' && validObservation.status === 'supported') {
    return validObservation;
  }
  if (persisted.status === 'supported' && validObservation.status === 'unavailable') {
    return persisted;
  }
  evidenceConflict(label, persisted, validObservation);
}

function attachInstruction(value: AttachInstruction, label: string): AttachInstruction {
  const cwd = absolutePath(value?.cwd, `${label} cwd`);
  if (!Array.isArray(value?.argv) || value.argv.length === 0) {
    invalid(`${label} argv must be a non-empty string array`);
  }
  const argv = value.argv.map((argument, index) => {
    if (typeof argument !== 'string' || argument.length === 0) {
      invalid(`${label} argv[${index}] must be a non-empty string`);
    }
    return argument;
  });
  return { cwd, argv };
}

export function sessionAttachInstruction(input: {
  harness: string;
  sessionId: string;
  cwd: string;
}): AttachInstruction | null {
  if (input.harness === 'codex') {
    return { cwd: input.cwd, argv: ['codex', 'resume', input.sessionId] };
  }
  if (input.harness === 'kimi-code') {
    return { cwd: input.cwd, argv: ['kimi', '-S', input.sessionId] };
  }
  if (input.harness === 'claude-code') {
    return { cwd: input.cwd, argv: ['claude', '--resume', input.sessionId] };
  }
  return null;
}

export class BoardIdentity {
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
    Object.freeze(this);
  }

  static fromCanonicalPath(value: string): BoardIdentity {
    return new BoardIdentity(absolutePath(value, 'canonical board path'));
  }

  equals(other: BoardIdentity): boolean {
    return other instanceof BoardIdentity && other.value === this.value;
  }
}

export class DispatchKey {
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
    Object.freeze(this);
  }

  static create(value: string): DispatchKey {
    const normalized = nonEmpty(value, 'dispatch key');
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(normalized)) {
      invalid('dispatch key must be 1..128 non-whitespace identifier characters');
    }
    return new DispatchKey(normalized);
  }
}

export class TaskRef {
  readonly boardIdentity: BoardIdentity;
  readonly taskId: string;

  private constructor(boardIdentity: BoardIdentity, taskId: string) {
    this.boardIdentity = boardIdentity;
    this.taskId = taskId;
    Object.freeze(this);
  }

  static create(boardIdentity: BoardIdentity, taskId: string): TaskRef {
    if (!(boardIdentity instanceof BoardIdentity)) invalid('task ref requires a board identity');
    return new TaskRef(boardIdentity, nonEmpty(taskId, 'task id'));
  }
}

export class BoardWriteAuthority {
  readonly canonicalBoardPath: string;
  readonly boardIdentity: BoardIdentity;
  readonly ownerSessionId?: string;
  readonly selectionSource: 'explicit-board' | 'active-board-resolution';

  private constructor(input: {
    canonicalBoardPath: string;
    boardIdentity: BoardIdentity;
    ownerSessionId?: string;
    selectionSource: 'explicit-board' | 'active-board-resolution';
  }) {
    this.canonicalBoardPath = input.canonicalBoardPath;
    this.boardIdentity = input.boardIdentity;
    this.ownerSessionId = input.ownerSessionId;
    this.selectionSource = input.selectionSource;
    Object.freeze(this);
  }

  static create(input: {
    canonicalBoardPath: string;
    boardIdentity: BoardIdentity;
    ownerSessionId?: string;
    selectionSource: 'explicit-board' | 'active-board-resolution';
  }): BoardWriteAuthority {
    const canonicalBoardPath = absolutePath(input.canonicalBoardPath, 'canonical board path');
    if (!(input.boardIdentity instanceof BoardIdentity))
      invalid('authority requires board identity');
    if (input.boardIdentity.value !== canonicalBoardPath) {
      invalid('authority board identity must equal its canonical board path');
    }
    if (!['explicit-board', 'active-board-resolution'].includes(input.selectionSource)) {
      invalid('authority selection source is unsupported');
    }
    const ownerSessionId =
      input.ownerSessionId === undefined
        ? undefined
        : nonEmpty(input.ownerSessionId, 'owner session id');
    return new BoardWriteAuthority({
      canonicalBoardPath,
      boardIdentity: input.boardIdentity,
      ownerSessionId,
      selectionSource: input.selectionSource,
    });
  }

  assertTask(task: TaskRef): void {
    if (!(task instanceof TaskRef) || !this.boardIdentity.equals(task.boardIdentity)) {
      throw new TrackedDispatchError(
        'cross_board_task',
        'dispatch authority and task ref must belong to the same board',
      );
    }
  }
}

export class RuntimeHandle {
  readonly record: RuntimeHandleRecord;

  private constructor(record: RuntimeHandleRecord) {
    this.record = Object.freeze({ ...record });
    Object.freeze(this);
  }

  static pid(value: number, capturedAt: string): RuntimeHandle {
    return new RuntimeHandle({
      kind: 'pid',
      value: String(positivePid(value)),
      source: 'spawn',
      captured_at: instant(capturedAt),
    });
  }

  static sessionId(value: string, source: string, capturedAt: string): RuntimeHandle {
    return new RuntimeHandle({
      kind: 'session-id',
      value: nonEmpty(value, 'session-id handle'),
      source: nonEmpty(source, 'session-id evidence source'),
      captured_at: instant(capturedAt),
    });
  }

  static taskId(value: string, capturedAt: string): RuntimeHandle {
    return new RuntimeHandle({
      kind: 'task-id',
      value: nonEmpty(value, 'task-id handle'),
      source: 'origin-harness',
      captured_at: instant(capturedAt),
    });
  }
}

function cloneRecord(record: TrackedAgentRecord): TrackedAgentRecord {
  return JSON.parse(JSON.stringify(record)) as TrackedAgentRecord;
}

function assertDigest(value: string): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) invalid('request digest must be sha256:<64 hex>');
  return value;
}

function phaseError(phase: DispatchPhase, operation: string): never {
  if (phase === 'reconciliation-required') {
    throw new TrackedDispatchError(
      'reconciliation_required',
      `${operation} is forbidden while reconciliation is required`,
    );
  }
  throw new TrackedDispatchError('invalid_phase', `${operation} is invalid in phase ${phase}`);
}

function persistedInvariant(condition: boolean, message: string): asserts condition {
  if (!condition) invalid(`persisted dispatch invariant: ${message}`);
}

function assertPersistedDispatch(record: TrackedAgentRecord): void {
  const dispatch = record.dispatch;
  const phases: DispatchPhase[] = [
    'prepared',
    'launch-claimed',
    'bound',
    'closing',
    'closed',
    'reconciliation-required',
  ];
  persistedInvariant(phases.includes(dispatch.phase), 'phase must be recognized');
  persistedInvariant(Array.isArray(dispatch.evidence), 'evidence must be an array');
  persistedInvariant(
    typeof dispatch.reconciliation_required === 'boolean',
    'reconciliation flag must be boolean',
  );
  const needsClaim = dispatch.phase !== 'prepared';
  if (needsClaim) {
    persistedInvariant(!!dispatch.claim, 'post-prepare state requires launch claim');
    persistedInvariant(
      typeof dispatch.claim?.token === 'string' && dispatch.claim.token.trim() !== '',
      'claim token must be non-empty',
    );
    persistedInvariant(
      typeof dispatch.claim?.claimed_at === 'string' && ISO_UTC_RE.test(dispatch.claim.claimed_at),
      'claim time must be strict UTC',
    );
    persistedInvariant(
      Number.isSafeInteger(dispatch.claim?.launcher_pid) &&
        Number(dispatch.claim?.launcher_pid) > 0,
      'claim launcher PID must be positive',
    );
  }

  const pidEvidence = dispatch.evidence.filter((entry) => entry.kind === 'pid');
  const sessionEvidence = dispatch.evidence.filter((entry) => entry.kind === 'session-id');
  persistedInvariant(pidEvidence.length <= 1, 'PID evidence must be unique');
  persistedInvariant(sessionEvidence.length <= 1, 'session evidence must be unique');
  for (const evidence of dispatch.evidence) {
    persistedInvariant(
      evidence.kind === 'pid' || evidence.kind === 'session-id' || evidence.kind === 'task-id',
      'evidence kind must be recognized',
    );
    persistedInvariant(
      typeof evidence.value === 'string' && evidence.value.trim() !== '',
      'evidence value must be non-empty',
    );
    persistedInvariant(
      (evidence.kind === 'pid' && evidence.source === 'spawn') ||
        (evidence.kind === 'task-id' && evidence.source === 'origin-harness') ||
        (evidence.kind === 'session-id' &&
          typeof evidence.source === 'string' &&
          evidence.source.trim() !== ''),
      'evidence source must match its kind',
    );
    persistedInvariant(ISO_UTC_RE.test(evidence.captured_at), 'evidence time must be strict UTC');
  }

  const capabilities = dispatch.capabilities;
  persistedInvariant(
    !!capabilities && typeof capabilities === 'object',
    'capabilities must be an object',
  );
  for (const name of ['identity', 'transcript', 'attach'] as const) {
    const current = capabilities[name];
    persistedInvariant(
      !!current &&
        (current.status === 'supported' ||
          current.status === 'unsupported' ||
          current.status === 'unavailable'),
      `${name} capability status must be typed`,
    );
    if (current.status !== 'supported') {
      persistedInvariant(
        typeof current.reason === 'string' && current.reason.trim() !== '',
        `${name} capability degradation requires a reason`,
      );
    }
  }
  if (capabilities.identity.status === 'supported') {
    persistedInvariant(
      capabilities.identity.value?.kind === 'session-id' &&
        typeof capabilities.identity.value.value === 'string' &&
        capabilities.identity.value.value.trim() !== '',
      'supported identity must contain a session id',
    );
    persistedInvariant(
      record.handle.kind === 'session-id' &&
        record.handle.value === capabilities.identity.value.value &&
        sessionEvidence.length === 1 &&
        sessionEvidence[0]?.value === capabilities.identity.value.value,
      'supported identity must match the session handle and evidence',
    );
  } else {
    persistedInvariant(
      record.handle.kind !== 'session-id',
      'session handle requires supported identity capability',
    );
  }
  if (capabilities.transcript.status === 'supported') {
    persistedInvariant(
      typeof capabilities.transcript.value?.path === 'string' &&
        (capabilities.transcript.value.path.startsWith('/') ||
          /^[A-Za-z]:[\\/]/u.test(capabilities.transcript.value.path)),
      'supported transcript must contain an absolute path',
    );
    persistedInvariant(
      record.handle.transcript_ref === capabilities.transcript.value.path,
      'supported transcript must match the runtime handle transcript ref',
    );
  } else {
    persistedInvariant(
      record.handle.transcript_ref === undefined,
      'degraded transcript capability cannot retain a transcript ref',
    );
  }
  if (capabilities.attach.status === 'supported') {
    persistedInvariant(
      !!capabilities.attach.value &&
        typeof capabilities.attach.value === 'object' &&
        !Array.isArray(capabilities.attach.value) &&
        Object.keys(capabilities.attach.value).length === 1 &&
        capabilities.attach.value.kind === 'session-resume',
      'supported attach must contain only its capability class',
    );
    persistedInvariant(
      record.handle.kind === 'session-id',
      'supported attach requires a session handle',
    );
    persistedInvariant(
      sessionAttachInstruction({
        harness: record.harness,
        sessionId: record.handle.value,
        cwd: record.launch.cwd,
      }) !== null,
      'supported attach requires a canonical harness session-resume command',
    );
  }
  if (
    record.handle.kind === 'session-id' &&
    sessionAttachInstruction({
      harness: record.harness,
      sessionId: record.handle.value,
      cwd: record.launch.cwd,
    }) !== null
  ) {
    persistedInvariant(
      capabilities.attach.status === 'supported',
      'canonical session handle requires supported attach capability',
    );
  }

  const hasRuntimePid = dispatch.runtime_pid !== undefined;
  if (hasRuntimePid) {
    persistedInvariant(
      Number.isSafeInteger(dispatch.runtime_pid) && Number(dispatch.runtime_pid) > 0,
      'runtime PID must be positive',
    );
    persistedInvariant(
      pidEvidence.length === 1 &&
        pidEvidence[0]?.source === 'spawn' &&
        pidEvidence[0].value === String(dispatch.runtime_pid),
      'runtime PID must match exact spawn evidence',
    );
    persistedInvariant(
      Array.isArray(record.links) &&
        record.links.length === 1 &&
        record.links[0]?.task_id === dispatch.task_id &&
        ISO_UTC_RE.test(record.links[0].linked_at),
      'bound runtime must have exactly one same-task link',
    );
    if (record.handle.kind === 'pid') {
      persistedInvariant(
        record.handle.value === String(dispatch.runtime_pid),
        'PID handle must match runtime PID',
      );
    } else {
      persistedInvariant(
        record.handle.kind === 'session-id',
        'bound handle must be PID or session',
      );
      persistedInvariant(
        sessionEvidence.length === 1 && sessionEvidence[0]?.value === record.handle.value,
        'session handle must match monotonic session evidence',
      );
      persistedInvariant(
        capabilities.identity.status === 'supported' &&
          capabilities.identity.value.value === record.handle.value,
        'session handle must match supported identity capability',
      );
    }
  } else {
    persistedInvariant(pidEvidence.length === 0, 'unbound state cannot contain PID evidence');
    persistedInvariant(
      record.handle.kind === 'none' && record.handle.value === '',
      'unbound handle must be none',
    );
    persistedInvariant(record.links === undefined, 'unbound state cannot link a task');
  }

  switch (dispatch.phase) {
    case 'prepared':
      persistedInvariant(!dispatch.claim, 'prepared state cannot have a claim');
      persistedInvariant(!hasRuntimePid, 'prepared state cannot have runtime PID');
      persistedInvariant(
        record.lifecycle.state === 'starting',
        'prepared lifecycle must be starting',
      );
      break;
    case 'launch-claimed':
      persistedInvariant(!hasRuntimePid, 'launch-claimed state cannot have runtime PID');
      persistedInvariant(
        record.lifecycle.state === 'starting',
        'launch-claimed lifecycle must be starting',
      );
      break;
    case 'bound':
      persistedInvariant(hasRuntimePid, 'bound state requires runtime PID');
      persistedInvariant(record.lifecycle.state === 'running', 'bound lifecycle must be running');
      break;
    case 'closing':
      persistedInvariant(hasRuntimePid, 'closing state requires runtime PID');
      persistedInvariant(
        record.lifecycle.state === 'running',
        'closing lifecycle must remain running',
      );
      persistedInvariant(!!dispatch.terminal, 'closing state requires terminal observation');
      break;
    case 'closed':
      persistedInvariant(
        record.lifecycle.state === 'terminal',
        'closed lifecycle must be terminal',
      );
      persistedInvariant(!!dispatch.terminal, 'closed state requires terminal observation');
      persistedInvariant(
        typeof record.lifecycle.ended_at === 'string' && ISO_UTC_RE.test(record.lifecycle.ended_at),
        'closed lifecycle requires ended_at',
      );
      break;
    case 'reconciliation-required':
      persistedInvariant(
        dispatch.reconciliation_required,
        'reconciliation phase requires true flag',
      );
      persistedInvariant(
        typeof dispatch.reconciliation_reason === 'string' &&
          dispatch.reconciliation_reason.trim() !== '',
        'reconciliation phase requires reason',
      );
      persistedInvariant(
        record.lifecycle.state === 'uncertain' || record.lifecycle.state === 'terminal',
        'reconciliation lifecycle must be uncertain or preserve terminal',
      );
      if (record.lifecycle.state === 'terminal') {
        persistedInvariant(
          !!dispatch.terminal,
          'terminal reconciliation requires terminal observation',
        );
        persistedInvariant(
          typeof record.lifecycle.ended_at === 'string' &&
            ISO_UTC_RE.test(record.lifecycle.ended_at),
          'terminal reconciliation requires ended_at',
        );
        persistedInvariant(
          typeof record.lifecycle.outcome === 'string' && record.lifecycle.outcome.trim() !== '',
          'terminal reconciliation requires outcome',
        );
      }
      break;
  }
  if (dispatch.phase !== 'reconciliation-required') {
    persistedInvariant(
      !dispatch.reconciliation_required,
      'ordinary phase cannot require reconciliation',
    );
  }
}

export class TrackedDispatch {
  readonly authority: BoardWriteAuthority;
  readonly task: TaskRef;
  private readonly agent: TrackedAgentRecord;

  private constructor(authority: BoardWriteAuthority, task: TaskRef, agent: TrackedAgentRecord) {
    authority.assertTask(task);
    this.authority = authority;
    this.task = task;
    this.agent = agent;
  }

  static prepare(input: {
    agentId: string;
    authority: BoardWriteAuthority;
    task: TaskRef;
    key: DispatchKey;
    requestDigest: string;
    harness: string;
    intent: string;
    cwd: string;
    createdAt: string;
    capabilities?: TrackedDispatchCapabilities;
  }): TrackedDispatch {
    input.authority.assertTask(input.task);
    const createdAt = instant(input.createdAt);
    const capabilities = input.capabilities
      ? (JSON.parse(JSON.stringify(input.capabilities)) as TrackedDispatchCapabilities)
      : {
          identity: { status: 'unavailable', reason: 'session-identity-not-yet-observed' } as const,
          transcript: {
            status: 'unavailable',
            reason: 'session-identity-not-yet-observed',
          } as const,
          attach: { status: 'unavailable', reason: 'session-identity-not-yet-observed' } as const,
        };
    const initialTranscriptRef =
      capabilities.transcript.status === 'supported'
        ? absolutePath(capabilities.transcript.value.path, 'transcript path')
        : undefined;
    if (capabilities.transcript.status === 'supported') {
      capabilities.transcript = {
        status: 'supported',
        value: { path: initialTranscriptRef as string },
      };
    }
    const agent: TrackedAgentRecord = {
      id: nonEmpty(input.agentId, 'agent id'),
      type: 'cli-worker',
      harness: nonEmpty(input.harness, 'harness'),
      intent: nonEmpty(input.intent, 'intent'),
      launch: { created_at: createdAt, cwd: absolutePath(input.cwd, 'worker cwd') },
      handle: {
        kind: 'none',
        value: '',
        ...(initialTranscriptRef ? { transcript_ref: initialTranscriptRef } : {}),
      },
      lifecycle: {
        state: 'starting',
        registered_at: createdAt,
        ended_at: null,
        outcome: null,
      },
      account_ref: null,
      quota_pool_ref: null,
      dispatch: {
        schema: TRACKED_DISPATCH_METADATA_SCHEMA,
        key: input.key.value,
        request_digest: assertDigest(input.requestDigest),
        phase: 'prepared',
        task_id: input.task.taskId,
        evidence: [],
        capabilities,
        reconciliation_required: false,
      },
    };
    assertPersistedDispatch(agent);
    return new TrackedDispatch(input.authority, input.task, agent);
  }

  static rehydrate(authority: BoardWriteAuthority, record: TrackedAgentRecord): TrackedDispatch {
    if (record?.dispatch?.schema !== TRACKED_DISPATCH_METADATA_SCHEMA) {
      invalid('agent does not contain tracked dispatch v1 metadata');
    }
    DispatchKey.create(record.dispatch.key);
    assertDigest(record.dispatch.request_digest);
    assertPersistedDispatch(record);
    const task = TaskRef.create(authority.boardIdentity, record.dispatch.task_id);
    return new TrackedDispatch(authority, task, cloneRecord(record));
  }

  claimLaunch(input: { token: string; claimedAt: string; launcherPid: number }): void {
    if (this.agent.dispatch.phase !== 'prepared') {
      phaseError(this.agent.dispatch.phase, 'claim launch');
    }
    this.agent.dispatch.claim = {
      token: nonEmpty(input.token, 'claim token'),
      claimed_at: instant(input.claimedAt),
      launcher_pid: positivePid(input.launcherPid),
    };
    this.agent.dispatch.phase = 'launch-claimed';
  }

  bindStartedWorker(input: { claimToken: string; handle: RuntimeHandle; linkedAt: string }): void {
    if (this.agent.dispatch.phase !== 'launch-claimed') {
      phaseError(this.agent.dispatch.phase, 'bind started worker');
    }
    if (this.agent.dispatch.claim?.token !== input.claimToken) {
      throw new TrackedDispatchError(
        'claim_token_conflict',
        'claim token does not own this launch',
      );
    }
    if (!(input.handle instanceof RuntimeHandle) || input.handle.record.kind !== 'pid') {
      invalid('initial running evidence must be a real spawn PID handle');
    }
    const pid = Number(input.handle.record.value);
    positivePid(pid);
    const linkedAt = instant(input.linkedAt);
    const transcript = this.agent.dispatch.capabilities.transcript;
    this.agent.handle = {
      kind: 'pid',
      value: String(pid),
      ...(transcript.status === 'supported' ? { transcript_ref: transcript.value.path } : {}),
    };
    this.agent.lifecycle.state = 'running';
    this.agent.links = [{ task_id: this.task.taskId, linked_at: linkedAt }];
    this.agent.dispatch.runtime_pid = pid;
    this.agent.dispatch.evidence.push({ ...input.handle.record });
    this.agent.dispatch.phase = 'bound';
  }

  upgradeIdentity(input: {
    handle: RuntimeHandle;
    transcript: CapabilityResult<TranscriptRef>;
    attach: CapabilityResult<AttachInstruction>;
  }): void {
    const phase = this.agent.dispatch.phase;
    if (phase !== 'bound' && phase !== 'closing' && phase !== 'closed') {
      phaseError(phase, 'upgrade identity');
    }
    if (!(input.handle instanceof RuntimeHandle) || input.handle.record.kind !== 'session-id') {
      invalid('identity upgrade requires session-id evidence');
    }
    const existing = this.agent.dispatch.evidence.find((entry) => entry.kind === 'session-id');
    if (existing && existing.value !== input.handle.record.value) {
      throw new TrackedDispatchError(
        'evidence_conflict',
        `conflicting session identity evidence: ${existing.value} != ${input.handle.record.value}`,
      );
    }
    const sessionId = input.handle.record.value;
    const transcriptObservation: CapabilityResult<TranscriptRef> =
      input.transcript.status === 'supported'
        ? {
            status: 'supported',
            value: {
              path: absolutePath(input.transcript.value.path, 'transcript path'),
            },
          }
        : input.transcript;
    const attachObservation: CapabilityResult<AttachCapability> =
      input.attach.status === 'supported'
        ? (() => {
            const observed = attachInstruction(input.attach.value, 'attach instruction');
            const expected = sessionAttachInstruction({
              harness: this.agent.harness,
              sessionId,
              cwd: this.agent.launch.cwd,
            });
            if (!expected || canonicalJson(observed) !== canonicalJson(expected)) {
              evidenceConflict('attach', expected, observed);
            }
            return { status: 'supported', value: { kind: 'session-resume' } } as const;
          })()
        : input.attach;
    const identity = mergeCapabilityEvidence<{ kind: 'session-id'; value: string }>(
      this.agent.dispatch.capabilities.identity,
      { status: 'supported', value: { kind: 'session-id', value: sessionId } },
      'identity',
    );
    const transcript = mergeCapabilityEvidence(
      this.agent.dispatch.capabilities.transcript,
      transcriptObservation,
      'transcript',
    );
    const attach = mergeCapabilityEvidence(
      this.agent.dispatch.capabilities.attach,
      attachObservation,
      'attach',
    );
    if (!existing) this.agent.dispatch.evidence.push({ ...input.handle.record });
    this.agent.handle = {
      kind: 'session-id',
      value: sessionId,
      ...(transcript.status === 'supported' ? { transcript_ref: transcript.value.path } : {}),
    };
    this.agent.dispatch.capabilities.identity = identity;
    this.agent.dispatch.capabilities.transcript = transcript;
    this.agent.dispatch.capabilities.attach = attach;
    assertPersistedDispatch(this.agent);
  }

  recordStartupFailure(input: { at: string; terminal: WorkerTerminalFact; outcome: string }): void {
    if (this.agent.dispatch.phase !== 'launch-claimed') {
      phaseError(this.agent.dispatch.phase, 'record startup failure');
    }
    const at = instant(input.at);
    this.agent.dispatch.terminal = { ...input.terminal, observed_at: at };
    this.agent.dispatch.phase = 'closed';
    this.agent.lifecycle.state = 'terminal';
    this.agent.lifecycle.ended_at = at;
    this.agent.lifecycle.outcome = nonEmpty(input.outcome, 'startup failure outcome');
  }

  beginClosing(input: { at: string; terminal: WorkerTerminalFact }): void {
    if (this.agent.dispatch.phase !== 'bound') {
      phaseError(this.agent.dispatch.phase, 'begin closing');
    }
    this.agent.dispatch.terminal = { ...input.terminal, observed_at: instant(input.at) };
    this.agent.dispatch.phase = 'closing';
  }

  close(input: { at: string; outcome: string }): void {
    if (this.agent.dispatch.phase !== 'closing') {
      phaseError(this.agent.dispatch.phase, 'close');
    }
    const at = instant(input.at);
    this.agent.dispatch.phase = 'closed';
    this.agent.lifecycle.state = 'terminal';
    this.agent.lifecycle.ended_at = at;
    this.agent.lifecycle.outcome = nonEmpty(input.outcome, 'terminal outcome');
  }

  requireReconciliation(input: { reason: string; at: string }): void {
    if (this.agent.dispatch.phase === 'closed') {
      phaseError(this.agent.dispatch.phase, 'require reconciliation');
    }
    this.enterReconciliation(input);
  }

  requireEvidenceReconciliation(input: { reason: string; at: string }): void {
    const phase = this.agent.dispatch.phase;
    if (phase !== 'bound' && phase !== 'closing' && phase !== 'closed') {
      phaseError(phase, 'reconcile conflicting evidence');
    }
    this.enterReconciliation(input);
  }

  private enterReconciliation(input: { reason: string; at: string }): void {
    instant(input.at);
    const lifecycleWasTerminal = this.agent.lifecycle.state === 'terminal';
    this.agent.dispatch.phase = 'reconciliation-required';
    this.agent.dispatch.reconciliation_required = true;
    this.agent.dispatch.reconciliation_reason = nonEmpty(input.reason, 'reconciliation reason');
    if (!lifecycleWasTerminal) this.agent.lifecycle.state = 'uncertain';
  }

  toAgentRecord(): TrackedAgentRecord {
    return cloneRecord(this.agent);
  }
}
