import * as fs from 'node:fs';
import {
  type AttachInstruction,
  type BoardWriteAuthority,
  type CapabilityResult,
  type DispatchKey,
  formatReport,
  isAgentId,
  lintBoard,
  type RuntimeHandle,
  type TaskRef,
  type TrackedAgentRecord,
  TrackedDispatch,
  type TrackedDispatchCapabilities,
  TrackedDispatchError,
  type TranscriptRef,
  type WorkerTerminalFact,
} from '@ccm/engine';
import * as io from './io.js';

export type DispatchRepositoryErrorCode =
  | 'authority_failure'
  | 'task_reference_failure'
  | 'idempotency_conflict'
  | 'dispatch_corrupt'
  | 'board_validation_failure'
  | 'tracking_write_failure';

export class DispatchRepositoryError extends Error {
  readonly code: DispatchRepositoryErrorCode;
  readonly errKind: 'Validation' | 'NotFound';

  constructor(
    code: DispatchRepositoryErrorCode,
    message: string,
    options: { cause?: unknown; errKind?: 'Validation' | 'NotFound' } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'DispatchRepositoryError';
    this.code = code;
    this.errKind = options.errKind ?? 'Validation';
  }
}

type Board = Record<string, unknown>;
type Agent = Record<string, unknown>;

export type PrepareDispatchResult =
  | { kind: 'prepared'; aggregate: TrackedDispatch }
  | { kind: 'replay'; aggregate: TrackedDispatch };

export type ClaimDispatchResult =
  | { kind: 'claimed'; aggregate: TrackedDispatch }
  | { kind: 'in-progress'; aggregate: TrackedDispatch }
  | { kind: 'replay'; aggregate: TrackedDispatch }
  | { kind: 'reconciliation-required'; aggregate: TrackedDispatch };

interface RepositoryOptions {
  writeFileAtomicSync?: (path: string, data: string) => void;
  launcherAlive?: (pid: number) => boolean;
}

interface MutationResult<T> {
  value: T;
  changed: boolean;
  changedAt?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function agentsOf(board: Board): Agent[] {
  return Array.isArray(board.agents)
    ? board.agents.filter((entry): entry is Agent => isObject(entry))
    : [];
}

function genAgentId(board: Board): string {
  let max = 0;
  for (const agent of agentsOf(board)) {
    const match = typeof agent.id === 'string' ? /^agt-(\d+)$/u.exec(agent.id) : null;
    if (match) max = Math.max(max, Number(match[1]));
  }
  const id = `agt-${String(max + 1).padStart(3, '0')}`;
  if (!isAgentId(id)) {
    throw new DispatchRepositoryError('dispatch_corrupt', 'generated agent id is invalid');
  }
  return id;
}

function defaultLauncherAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function taskExists(board: Board, taskId: string): boolean {
  return (
    Array.isArray(board.tasks) && board.tasks.some((task) => isObject(task) && task.id === taskId)
  );
}

function taskBytes(board: Board): string {
  return JSON.stringify(board.tasks);
}

function dispatchOf(agent: Agent): Record<string, unknown> | null {
  return isObject(agent.dispatch) ? agent.dispatch : null;
}

function trackedRecord(agent: Agent): TrackedAgentRecord {
  return agent as unknown as TrackedAgentRecord;
}

function terminalMatches(record: TrackedAgentRecord, terminal: WorkerTerminalFact): boolean {
  const persisted = record.dispatch.terminal;
  return (
    !!persisted &&
    persisted.state === terminal.state &&
    persisted.exit_code === terminal.exit_code &&
    persisted.signal === terminal.signal &&
    persisted.error_code === terminal.error_code &&
    persisted.reaped === terminal.reaped
  );
}

export class BoardAgentRegistryRepository {
  private readonly writeFileAtomicSync: (path: string, data: string) => void;
  private readonly launcherAlive: (pid: number) => boolean;

  constructor(options: RepositoryOptions = {}) {
    this.writeFileAtomicSync = options.writeFileAtomicSync ?? io.writeFileAtomicSync;
    this.launcherAlive = options.launcherAlive ?? defaultLauncherAlive;
  }

  private transact<T>(
    authority: BoardWriteAuthority,
    mutate: (board: Board) => MutationResult<T>,
  ): T {
    return io.withBoardLock(authority.canonicalBoardPath, () => {
      let board: Board;
      try {
        const parsed = JSON.parse(fs.readFileSync(authority.canonicalBoardPath, 'utf8')) as unknown;
        if (!isObject(parsed)) throw new Error('board JSON root is not an object');
        board = parsed;
      } catch (cause) {
        throw new DispatchRepositoryError(
          'authority_failure',
          `tracked dispatch cannot read its canonical board: ${authority.canonicalBoardPath}`,
          { cause, errKind: 'NotFound' },
        );
      }

      if (
        authority.selectionSource === 'active-board-resolution' &&
        authority.ownerSessionId !== undefined &&
        (!isObject(board.owner) || board.owner.session_id !== authority.ownerSessionId)
      ) {
        throw new DispatchRepositoryError(
          'authority_failure',
          'active-board authority changed owner session after selection',
          { errKind: 'NotFound' },
        );
      }

      const tasksBefore = taskBytes(board);
      const result = mutate(board);
      if (!result.changed) return result.value;
      if (taskBytes(board) !== tasksBefore) {
        throw new DispatchRepositoryError(
          'tracking_write_failure',
          'tracked dispatch repository attempted to mutate task-owned projection',
        );
      }
      const lint = lintBoard(JSON.stringify(board));
      if (lint.errors.length > 0) {
        throw new DispatchRepositoryError(
          'board_validation_failure',
          `tracked dispatch mutation failed board lint:\n${formatReport(lint)}`,
        );
      }
      try {
        this.writeFileAtomicSync(
          authority.canonicalBoardPath,
          `${JSON.stringify(board, null, 2)}\n`,
        );
      } catch (cause) {
        throw new DispatchRepositoryError(
          'tracking_write_failure',
          'tracked dispatch board persistence failed',
          { cause },
        );
      }
      return result.value;
    });
  }

  private find(
    board: Board,
    authority: BoardWriteAuthority,
    key: DispatchKey,
    requestDigest: string,
  ): TrackedDispatch | null {
    const matches = agentsOf(board).filter((agent) => dispatchOf(agent)?.key === key.value);
    if (matches.length > 1) {
      throw new DispatchRepositoryError(
        'dispatch_corrupt',
        `dispatch key ${key.value} is registered more than once`,
      );
    }
    const match = matches[0];
    if (!match) return null;
    const dispatch = dispatchOf(match);
    if (dispatch?.request_digest !== requestDigest) {
      throw new DispatchRepositoryError(
        'idempotency_conflict',
        `dispatch key ${key.value} already belongs to a different request digest`,
      );
    }
    try {
      return TrackedDispatch.rehydrate(authority, trackedRecord(match));
    } catch (cause) {
      throw new DispatchRepositoryError(
        'dispatch_corrupt',
        `dispatch key ${key.value} has invalid persisted metadata`,
        { cause },
      );
    }
  }

  private replace(board: Board, record: TrackedAgentRecord): void {
    const agents: unknown[] = Array.isArray(board.agents) ? board.agents : [];
    board.agents = agents;
    const index = agents.findIndex((entry) => isObject(entry) && entry.id === record.id);
    if (index < 0) {
      throw new DispatchRepositoryError(
        'dispatch_corrupt',
        `tracked agent ${record.id} disappeared during mutation`,
      );
    }
    agents[index] = record;
  }

  prepareOrReplay(input: {
    authority: BoardWriteAuthority;
    task: TaskRef;
    key: DispatchKey;
    requestDigest: string;
    harness: string;
    intent: string;
    cwd: string;
    createdAt: string;
    capabilities?: TrackedDispatchCapabilities;
  }): PrepareDispatchResult {
    input.authority.assertTask(input.task);
    return this.transact<PrepareDispatchResult>(input.authority, (board) => {
      if (!taskExists(board, input.task.taskId)) {
        throw new DispatchRepositoryError(
          'task_reference_failure',
          `dispatch target task ${input.task.taskId} does not exist on the authoritative board`,
        );
      }
      const existing = this.find(board, input.authority, input.key, input.requestDigest);
      if (existing) return { value: { kind: 'replay', aggregate: existing }, changed: false };
      const aggregate = TrackedDispatch.prepare({
        agentId: genAgentId(board),
        authority: input.authority,
        task: input.task,
        key: input.key,
        requestDigest: input.requestDigest,
        harness: input.harness,
        intent: input.intent,
        cwd: input.cwd,
        createdAt: input.createdAt,
        capabilities: input.capabilities,
      });
      const agents: unknown[] = Array.isArray(board.agents) ? board.agents : [];
      agents.push(aggregate.toAgentRecord());
      board.agents = agents;
      return {
        value: { kind: 'prepared', aggregate },
        changed: true,
        changedAt: input.createdAt,
      };
    });
  }

  claimLaunch(input: {
    authority: BoardWriteAuthority;
    key: DispatchKey;
    requestDigest: string;
    claimToken: string;
    claimedAt: string;
    launcherPid: number;
  }): ClaimDispatchResult {
    return this.transact<ClaimDispatchResult>(input.authority, (board) => {
      const aggregate = this.find(board, input.authority, input.key, input.requestDigest);
      if (!aggregate) {
        throw new DispatchRepositoryError(
          'dispatch_corrupt',
          `dispatch key ${input.key.value} was not prepared`,
        );
      }
      const record = aggregate.toAgentRecord();
      switch (record.dispatch.phase) {
        case 'prepared':
          aggregate.claimLaunch({
            token: input.claimToken,
            claimedAt: input.claimedAt,
            launcherPid: input.launcherPid,
          });
          this.replace(board, aggregate.toAgentRecord());
          return {
            value: { kind: 'claimed', aggregate },
            changed: true,
            changedAt: input.claimedAt,
          };
        case 'launch-claimed': {
          const launcherPid = record.dispatch.claim?.launcher_pid;
          if (typeof launcherPid === 'number' && this.launcherAlive(launcherPid)) {
            return { value: { kind: 'in-progress', aggregate }, changed: false };
          }
          aggregate.requireReconciliation({ reason: 'ambiguous-launch', at: input.claimedAt });
          this.replace(board, aggregate.toAgentRecord());
          return {
            value: { kind: 'reconciliation-required', aggregate },
            changed: true,
            changedAt: input.claimedAt,
          };
        }
        case 'bound': {
          const launcherPid = record.dispatch.claim?.launcher_pid;
          if (typeof launcherPid === 'number' && this.launcherAlive(launcherPid)) {
            return { value: { kind: 'in-progress', aggregate }, changed: false };
          }
          aggregate.requireReconciliation({
            reason: 'supervisor-lost-after-bind',
            at: input.claimedAt,
          });
          this.replace(board, aggregate.toAgentRecord());
          return {
            value: { kind: 'reconciliation-required', aggregate },
            changed: true,
            changedAt: input.claimedAt,
          };
        }
        case 'reconciliation-required':
          return { value: { kind: 'reconciliation-required', aggregate }, changed: false };
        default:
          return { value: { kind: 'replay', aggregate }, changed: false };
      }
    });
  }

  commitStartedWorker(input: {
    authority: BoardWriteAuthority;
    key: DispatchKey;
    requestDigest: string;
    claimToken: string;
    handle: RuntimeHandle;
    linkedAt: string;
  }): TrackedDispatch {
    return this.transact(input.authority, (board) => {
      const aggregate = this.find(board, input.authority, input.key, input.requestDigest);
      if (!aggregate) {
        throw new DispatchRepositoryError(
          'dispatch_corrupt',
          `dispatch key ${input.key.value} disappeared before PID bind`,
        );
      }
      if (!taskExists(board, aggregate.task.taskId)) {
        throw new DispatchRepositoryError(
          'task_reference_failure',
          `dispatch target task ${aggregate.task.taskId} disappeared before PID bind`,
        );
      }
      aggregate.bindStartedWorker({
        claimToken: input.claimToken,
        handle: input.handle,
        linkedAt: input.linkedAt,
      });
      this.replace(board, aggregate.toAgentRecord());
      return { value: aggregate, changed: true, changedAt: input.linkedAt };
    });
  }

  upgradeIdentity(input: {
    authority: BoardWriteAuthority;
    key: DispatchKey;
    requestDigest: string;
    handle: RuntimeHandle;
    transcript: CapabilityResult<TranscriptRef>;
    attach: CapabilityResult<AttachInstruction>;
    changedAt: string;
  }): TrackedDispatch {
    return this.transact(input.authority, (board) => {
      const aggregate = this.find(board, input.authority, input.key, input.requestDigest);
      if (!aggregate) {
        throw new DispatchRepositoryError(
          'dispatch_corrupt',
          `dispatch key ${input.key.value} disappeared before identity enrichment`,
        );
      }
      try {
        aggregate.upgradeIdentity({
          handle: input.handle,
          transcript: input.transcript,
          attach: input.attach,
        });
      } catch (cause) {
        if (!(cause instanceof TrackedDispatchError) || cause.code !== 'evidence_conflict') {
          throw cause;
        }
        aggregate.requireEvidenceReconciliation({
          reason: 'conflicting-session-evidence',
          at: input.changedAt,
        });
      }
      this.replace(board, aggregate.toAgentRecord());
      return { value: aggregate, changed: true, changedAt: input.changedAt };
    });
  }

  recordStartupFailure(input: {
    authority: BoardWriteAuthority;
    key: DispatchKey;
    requestDigest: string;
    at: string;
    terminal: WorkerTerminalFact;
    outcome: string;
  }): TrackedDispatch {
    return this.transact(input.authority, (board) => {
      const aggregate = this.find(board, input.authority, input.key, input.requestDigest);
      if (!aggregate) {
        throw new DispatchRepositoryError(
          'dispatch_corrupt',
          `dispatch key ${input.key.value} disappeared before startup terminal`,
        );
      }
      const existing = aggregate.toAgentRecord();
      if (
        existing.dispatch.phase === 'closed' &&
        existing.lifecycle.outcome === input.outcome &&
        terminalMatches(existing, input.terminal)
      ) {
        return { value: aggregate, changed: false };
      }
      aggregate.recordStartupFailure({
        at: input.at,
        terminal: input.terminal,
        outcome: input.outcome,
      });
      this.replace(board, aggregate.toAgentRecord());
      return { value: aggregate, changed: true, changedAt: input.at };
    });
  }

  beginClosing(input: {
    authority: BoardWriteAuthority;
    key: DispatchKey;
    requestDigest: string;
    at: string;
    terminal: WorkerTerminalFact;
  }): TrackedDispatch {
    return this.transact(input.authority, (board) => {
      const aggregate = this.find(board, input.authority, input.key, input.requestDigest);
      if (!aggregate) {
        throw new DispatchRepositoryError(
          'dispatch_corrupt',
          `dispatch key ${input.key.value} disappeared before terminal observation`,
        );
      }
      const existing = aggregate.toAgentRecord();
      if (
        (existing.dispatch.phase === 'closing' || existing.dispatch.phase === 'closed') &&
        terminalMatches(existing, input.terminal)
      ) {
        return { value: aggregate, changed: false };
      }
      aggregate.beginClosing({ at: input.at, terminal: input.terminal });
      this.replace(board, aggregate.toAgentRecord());
      return { value: aggregate, changed: true, changedAt: input.at };
    });
  }

  commitTerminal(input: {
    authority: BoardWriteAuthority;
    key: DispatchKey;
    requestDigest: string;
    at: string;
    outcome: string;
  }): TrackedDispatch {
    return this.transact(input.authority, (board) => {
      const aggregate = this.find(board, input.authority, input.key, input.requestDigest);
      if (!aggregate) {
        throw new DispatchRepositoryError(
          'dispatch_corrupt',
          `dispatch key ${input.key.value} disappeared before terminal commit`,
        );
      }
      const existing = aggregate.toAgentRecord();
      if (existing.dispatch.phase === 'closed' && existing.lifecycle.outcome === input.outcome) {
        return { value: aggregate, changed: false };
      }
      aggregate.close({ at: input.at, outcome: input.outcome });
      this.replace(board, aggregate.toAgentRecord());
      return { value: aggregate, changed: true, changedAt: input.at };
    });
  }

  markReconciliationRequired(input: {
    authority: BoardWriteAuthority;
    key: DispatchKey;
    requestDigest: string;
    at: string;
    reason: string;
  }): TrackedDispatch {
    return this.transact(input.authority, (board) => {
      const aggregate = this.find(board, input.authority, input.key, input.requestDigest);
      if (!aggregate) {
        throw new DispatchRepositoryError(
          'dispatch_corrupt',
          `dispatch key ${input.key.value} disappeared before reconciliation marker`,
        );
      }
      const existing = aggregate.toAgentRecord();
      if (
        existing.dispatch.phase === 'reconciliation-required' &&
        existing.dispatch.reconciliation_reason === input.reason
      ) {
        return { value: aggregate, changed: false };
      }
      aggregate.requireReconciliation({ reason: input.reason, at: input.at });
      this.replace(board, aggregate.toAgentRecord());
      return { value: aggregate, changed: true, changedAt: input.at };
    });
  }
}

export type TrackedDispatchRepositoryFace = Pick<
  BoardAgentRegistryRepository,
  | 'prepareOrReplay'
  | 'claimLaunch'
  | 'commitStartedWorker'
  | 'upgradeIdentity'
  | 'recordStartupFailure'
  | 'beginClosing'
  | 'commitTerminal'
  | 'markReconciliationRequired'
>;
