import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { canonicalJson, canonicalSha256Digest, sha256Hex } from '@ccm/engine';
import type {
  NativeAttemptAdmissionBoundary,
  NativeAttemptPrivateEvidenceBoundary,
} from './handlers/_common.js';
import { verifyProductionNativeEvidence } from './native-attempt-evidence-verifier.js';

type Json = Record<string, any>;
type TransactionKind = 'launch' | 'evidence';

interface Options {
  home: string;
  now?: () => Date;
}

interface ProjectionLocator {
  kind: TransactionKind;
  task_id: string;
  attempt_id: string;
  dispatch_key?: string;
  evidence_class?: string;
  record_ref?: string;
  record_hash?: string;
}

interface StagedTransaction {
  kind: TransactionKind;
  identity: string;
  payload: Json;
  currentPath: string;
  boardPath: string;
  locator: ProjectionLocator;
  lockPath?: string;
  lockFd?: number;
  replay: boolean;
}

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const CURRENT_SCHEMA = 'ccm/native-owner-current/v2';
const STAGE_SCHEMA = 'ccm/native-owner-stage/v2';
const PROJECTION_SCHEMA = 'ccm/native-owner-board-projection/v1';
const CURRENT_FIELDS = [
  'schema',
  'kind',
  'identity',
  'payload_schema',
  'payload',
  'board_path',
  'board_content_hash',
  'projection',
  'projection_hash',
  'committed_at',
  'record_hash',
] as const;
const STAGE_FIELDS = [
  'schema',
  'kind',
  'owner_pid',
  'identity',
  'payload',
  'board_path',
  'locator',
] as const;

function object(value: unknown): Json | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function exact(value: Json | undefined, fields: readonly string[]): value is Json {
  if (!value) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function fail(code: string): { ok: false; issues: Array<{ code: string }> } {
  return { ok: false, issues: [{ code }] };
}

function key(value: string): string {
  return sha256Hex(value);
}

function canonicalBoardPath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

function processIsAlive(pid: unknown): boolean {
  if (!Number.isSafeInteger(pid) || Number(pid) <= 0) return true;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function readOwnerJson(path: string): Json | undefined {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) return undefined;
    return object(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return undefined;
  }
}

function ownerFileIsInvalid(path: string): boolean {
  return existsSync(path) && readOwnerJson(path) === undefined;
}

function durableWriteNew(path: string, value: Json): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    const directoryFd = openSync(dirname(path), 'r');
    try {
      fsyncSync(directoryFd);
    } finally {
      closeSync(directoryFd);
    }
  } catch {
    // The no-replace owner file is already durable on filesystems without directory fsync.
  }
}

function boardProjection(boardPath: string, locator: ProjectionLocator): Json | undefined {
  let board: Json | undefined;
  try {
    board = object(JSON.parse(readFileSync(boardPath, 'utf8')));
  } catch {
    return undefined;
  }
  const task = Array.isArray(board?.tasks)
    ? board.tasks.find((entry: Json) => entry?.id === locator.task_id)
    : undefined;
  const attempt = Array.isArray(task?.routing?.attempts)
    ? task.routing.attempts.find((entry: Json) => entry?.id === locator.attempt_id)
    : undefined;
  if (!attempt || !nonempty(attempt.create_hash) || !object(attempt.create_snapshot))
    return undefined;

  if (locator.kind === 'launch') {
    if (attempt.dispatch?.key !== locator.dispatch_key) return undefined;
    return {
      schema: PROJECTION_SCHEMA,
      kind: 'launch',
      task_id: locator.task_id,
      attempt_id: locator.attempt_id,
      create_hash: attempt.create_hash,
      value: structuredClone(attempt.create_snapshot),
    };
  }

  let value: Json | undefined;
  if (locator.evidence_class === 'bind') {
    value = object(attempt.handle_binding);
  } else if (locator.evidence_class === 'terminal') {
    value = object(attempt.terminal);
  } else if (locator.evidence_class === 'reconcile' && Array.isArray(attempt.reconciliation)) {
    value = attempt.reconciliation.find(
      (entry: Json) =>
        entry?.evidence_record_ref === locator.record_ref &&
        entry?.evidence_hash === locator.record_hash,
    );
  }
  if (
    !value ||
    value.evidence_record_ref !== locator.record_ref ||
    value.evidence_hash !== locator.record_hash
  ) {
    return undefined;
  }
  return {
    schema: PROJECTION_SCHEMA,
    kind: 'evidence',
    evidence_class: locator.evidence_class,
    task_id: locator.task_id,
    attempt_id: locator.attempt_id,
    create_hash: attempt.create_hash,
    record_ref: locator.record_ref,
    record_hash: locator.record_hash,
    value: structuredClone(value),
  };
}

function currentUnsigned(record: Json): Json {
  const { record_hash: _recordHash, ...unsigned } = record;
  return unsigned;
}

function validCurrent(
  record: Json | undefined,
  transaction: Pick<StagedTransaction, 'kind' | 'identity' | 'payload' | 'boardPath' | 'locator'>,
): boolean {
  if (
    !exact(record, CURRENT_FIELDS) ||
    record.schema !== CURRENT_SCHEMA ||
    record.kind !== transaction.kind ||
    record.identity !== transaction.identity ||
    record.payload_schema !== transaction.payload.schema ||
    !same(record.payload, transaction.payload) ||
    record.board_path !== transaction.boardPath ||
    !SHA256_RE.test(String(record.board_content_hash)) ||
    !nonempty(record.committed_at) ||
    !SHA256_RE.test(String(record.projection_hash)) ||
    !SHA256_RE.test(String(record.record_hash)) ||
    canonicalSha256Digest(record.projection) !== record.projection_hash ||
    canonicalSha256Digest(currentUnsigned(record)) !== record.record_hash
  ) {
    return false;
  }
  const projection = boardProjection(transaction.boardPath, transaction.locator);
  return !!projection && same(projection, record.projection);
}

function validStage(
  record: Json | undefined,
  transaction: Pick<StagedTransaction, 'kind' | 'identity' | 'payload' | 'boardPath' | 'locator'>,
): boolean {
  return Boolean(
    exact(record, STAGE_FIELDS) &&
      record.schema === STAGE_SCHEMA &&
      record.kind === transaction.kind &&
      record.identity === transaction.identity &&
      same(record.payload, transaction.payload) &&
      record.board_path === transaction.boardPath &&
      same(record.locator, transaction.locator),
  );
}

export function createProductionNativeAttemptBoundaries(options: Options): {
  admission: NativeAttemptAdmissionBoundary;
  evidence: NativeAttemptPrivateEvidenceBoundary;
} {
  const root = join(options.home, 'native-attempt', 'v1');
  const now = options.now ?? (() => new Date());
  const transactions = new Map<string, StagedTransaction>();

  const stageTransaction = (input: {
    kind: TransactionKind;
    currentPath: string;
    identity: string;
    payload: Json;
    boardPath: string;
    locator: ProjectionLocator;
    recoveryAllowed: boolean;
  }): string | undefined => {
    const boardPath = canonicalBoardPath(input.boardPath);
    if (!boardPath) return undefined;
    const transaction: StagedTransaction = {
      kind: input.kind,
      currentPath: input.currentPath,
      identity: input.identity,
      payload: structuredClone(input.payload),
      boardPath,
      locator: structuredClone(input.locator),
      replay: false,
    };
    const lockPath = join(dirname(input.currentPath), 'stage.lock');
    const existing = readOwnerJson(input.currentPath);
    if (existing) {
      if (!validCurrent(existing, transaction)) return undefined;
      const staged = readOwnerJson(lockPath);
      if (staged) {
        if (!validStage(staged, transaction) || processIsAlive(staged.owner_pid)) return undefined;
        transaction.lockPath = lockPath;
      } else if (ownerFileIsInvalid(lockPath)) {
        return undefined;
      }
      transaction.replay = true;
      const transactionId = `${input.kind}-tx-${randomUUID()}`;
      transactions.set(transactionId, transaction);
      return transactionId;
    }
    if (ownerFileIsInvalid(input.currentPath)) return undefined;

    mkdirSync(dirname(input.currentPath), { recursive: true, mode: 0o700 });
    let lockFd: number;
    try {
      lockFd = openSync(lockPath, 'wx', 0o600);
    } catch {
      const staged = readOwnerJson(lockPath);
      if (
        !input.recoveryAllowed ||
        !validStage(staged, transaction) ||
        processIsAlive(staged?.owner_pid) ||
        !boardProjection(boardPath, input.locator)
      ) {
        return undefined;
      }
      transaction.lockPath = lockPath;
      const transactionId = `${input.kind}-tx-${randomUUID()}`;
      transactions.set(transactionId, transaction);
      return transactionId;
    }

    const preexistingProjection = boardProjection(boardPath, input.locator);
    if (preexistingProjection) {
      closeSync(lockFd);
      try {
        unlinkSync(lockPath);
      } catch {
        // No owner authority was granted.
      }
      return undefined;
    }
    const stage = {
      schema: STAGE_SCHEMA,
      kind: input.kind,
      owner_pid: process.pid,
      identity: input.identity,
      payload: structuredClone(input.payload),
      board_path: boardPath,
      locator: structuredClone(input.locator),
    };
    try {
      writeFileSync(lockFd, `${JSON.stringify(stage, null, 2)}\n`);
      fsyncSync(lockFd);
    } catch {
      try {
        closeSync(lockFd);
      } catch {
        // Cleanup below is authoritative.
      }
      try {
        unlinkSync(lockPath);
      } catch {
        // A failed stage never grants authority.
      }
      return undefined;
    }
    transaction.lockPath = lockPath;
    transaction.lockFd = lockFd;
    const transactionId = `${input.kind}-tx-${randomUUID()}`;
    transactions.set(transactionId, transaction);
    return transactionId;
  };

  const releaseStage = (transaction: StagedTransaction): void => {
    if (transaction.lockFd !== undefined) {
      try {
        closeSync(transaction.lockFd);
      } catch {
        // Best effort after a completed synchronous transaction.
      }
    }
    if (transaction.lockPath) {
      try {
        unlinkSync(transaction.lockPath);
      } catch {
        // A missing lock is harmless after a successful commit or explicit rollback.
      }
    }
  };

  const commit = (input: {
    transaction_id: string;
    board_path: string;
    board_content_hash: string;
  }): void => {
    const transaction = transactions.get(input.transaction_id);
    if (!transaction) throw new Error('NATIVE-AUTHORITY-TRANSACTION-MISSING');
    const boardPath = canonicalBoardPath(input.board_path);
    if (!boardPath || boardPath !== transaction.boardPath) {
      throw new Error('NATIVE-AUTHORITY-BOARD-PATH-MISMATCH');
    }
    const boardBytes = readFileSync(boardPath);
    const actualBoardHash = `sha256:${createHash('sha256').update(boardBytes).digest('hex')}`;
    if (actualBoardHash !== input.board_content_hash) {
      throw new Error('NATIVE-AUTHORITY-BOARD-HASH-MISMATCH');
    }
    const projection = boardProjection(boardPath, transaction.locator);
    if (!projection) throw new Error('NATIVE-AUTHORITY-BOARD-PROJECTION-MISMATCH');

    if (transaction.replay) {
      if (!validCurrent(readOwnerJson(transaction.currentPath), transaction)) {
        throw new Error('NATIVE-AUTHORITY-CURRENT-MISMATCH');
      }
    } else {
      const unsigned = {
        schema: CURRENT_SCHEMA,
        kind: transaction.kind,
        identity: transaction.identity,
        payload_schema: transaction.payload.schema,
        payload: structuredClone(transaction.payload),
        board_path: boardPath,
        board_content_hash: input.board_content_hash,
        projection: structuredClone(projection),
        projection_hash: canonicalSha256Digest(projection),
        committed_at: now().toISOString(),
      };
      durableWriteNew(transaction.currentPath, {
        ...unsigned,
        record_hash: canonicalSha256Digest(unsigned),
      });
    }
    transactions.delete(input.transaction_id);
    releaseStage(transaction);
  };

  const rollback = (input: { transaction_id: string; reason: string }): void => {
    const transaction = transactions.get(input.transaction_id);
    if (!transaction) return;
    transactions.delete(input.transaction_id);
    releaseStage(transaction);
  };

  const stageCreate: NativeAttemptAdmissionBoundary['stageCreate'] = (input) => {
    const dispatchKey = input.attempt?.dispatch?.key;
    if (!nonempty(dispatchKey)) return fail('NATIVE-LAUNCH-AUTHORITY-MISSING');
    const recordPath = join(root, 'admissions', `${key(dispatchKey)}.json`);
    const record = readOwnerJson(recordPath);
    const authority = object(record?.launch_authority);
    const reservation = object(authority?.reservation);
    const ticket = object(authority?.ticket);
    if (
      record?.schema !== 'ccm/native-launch-authority-record/v1' ||
      record.provenance?.store !== 'ccm-owner-native-attempt/v1' ||
      record.provenance?.visibility !== 'owner-only' ||
      record.provenance?.owner_home_ref !== options.home ||
      record.task_id !== input.task_id ||
      record.dispatch_key !== dispatchKey ||
      authority?.schema !== 'ccm/native-launch-authority/v1' ||
      authority.claim_id !== input.attempt.dispatch?.launch_claim_id ||
      reservation?.state !== 'committed' ||
      reservation.attempt_id !== input.attempt.id ||
      reservation.candidate_id !== input.attempt.candidate_id ||
      ticket?.schema !== 'ccm/quota-admission-ticket/v1' ||
      ticket.attempt_id !== input.attempt.id ||
      ticket.reservation_id !== reservation.reservation_id ||
      ticket.reservation_request_hash !== reservation.request_hash ||
      ticket.reservation_expires_at !== reservation.expires_at ||
      ticket.run_ref !== input.attempt.dispatch?.run_ref ||
      ticket.launch_idempotency_key !== dispatchKey ||
      ticket.launch_nonce !== input.attempt.dispatch?.launch_claim_id ||
      authority.ticket_digest !== canonicalSha256Digest(ticket) ||
      reservation.ticket_digest !== authority.ticket_digest ||
      !SHA256_RE.test(String(authority.canonical_identity_digest)) ||
      Date.parse(String(ticket.launch_by)) <= now().getTime() ||
      Date.parse(String(reservation.expires_at)) <= now().getTime() ||
      !object(record.admission_snapshot)
    ) {
      return fail('NATIVE-LAUNCH-AUTHORITY-INVALID');
    }
    const payload = {
      schema: 'ccm/native-launch-claim/v1',
      claim_id: authority.claim_id,
      canonical_identity_digest: authority.canonical_identity_digest,
      ticket_digest: authority.ticket_digest,
      reservation_id: reservation.reservation_id,
    };
    const identity = canonicalJson({
      claim_id: payload.claim_id,
      canonical_identity_digest: payload.canonical_identity_digest,
      ticket_digest: payload.ticket_digest,
      reservation_id: payload.reservation_id,
    });
    const existingAttempt = object(input.existing_attempt);
    const frozenIncoming = object(existingAttempt?.create_snapshot?.attempt);
    const replayAttempt = frozenIncoming ? structuredClone(frozenIncoming) : undefined;
    if (replayAttempt) {
      delete replayAttempt.descriptor;
      delete replayAttempt.launch_authority;
    }
    const transactionId = stageTransaction({
      kind: 'launch',
      currentPath: join(root, 'claims', key(String(authority.claim_id)), 'current.json'),
      identity,
      payload,
      boardPath: input.board_path,
      locator: {
        kind: 'launch',
        task_id: input.task_id,
        attempt_id: input.attempt.id,
        dispatch_key: dispatchKey,
      },
      recoveryAllowed: Boolean(
        existingAttempt &&
          existingAttempt.id === input.attempt.id &&
          existingAttempt.dispatch?.key === dispatchKey &&
          same(replayAttempt, input.attempt) &&
          same(existingAttempt.create_snapshot?.selection_snapshot, input.selection_snapshot) &&
          same(existingAttempt.launch_authority, authority),
      ),
    });
    if (!transactionId) return fail('NATIVE-LAUNCH-CLAIM-REUSED');
    return {
      ok: true,
      transaction_id: transactionId,
      admission_snapshot: structuredClone(record.admission_snapshot),
      launch_authority: structuredClone(authority),
    };
  };

  const resolveControl: NativeAttemptAdmissionBoundary['resolveControl'] = (input) => {
    const record = readOwnerJson(join(root, 'controls', `${key(input.attempt_id)}.json`));
    if (
      record?.schema !== 'ccm/native-control-authority/v1' ||
      record.task_id !== input.task_id ||
      record.attempt_id !== input.attempt_id ||
      !object(record.authority_snapshot)
    ) {
      throw Object.assign(new Error('NATIVE-CONTROL-AUTHORITY-UNAVAILABLE'), {
        errKind: 'Validation',
      });
    }
    return structuredClone(record.authority_snapshot);
  };

  const stageAndVerify: NativeAttemptPrivateEvidenceBoundary['stageAndVerify'] = (input) => {
    const boardPath = canonicalBoardPath(input.board_path);
    if (!boardPath) return fail('NATIVE-EVIDENCE-AUTHENTICATION-FAILED');
    const expected = input.expected;
    const claimPayload = {
      schema: 'ccm/native-launch-claim/v1',
      claim_id: expected.launch_claim_id,
      canonical_identity_digest: expected.launch_identity_digest,
      ticket_digest: expected.ticket_digest,
      reservation_id: expected.reservation_id,
    };
    const claimIdentity = canonicalJson({
      claim_id: claimPayload.claim_id,
      canonical_identity_digest: claimPayload.canonical_identity_digest,
      ticket_digest: claimPayload.ticket_digest,
      reservation_id: claimPayload.reservation_id,
    });
    const verification = verifyProductionNativeEvidence({
      evidence_class: input.evidence_class,
      record_ref: input.record_ref,
      expected,
      store: {
        ownerHomeRef: options.home,
        resolveRecord: (recordRef) =>
          readOwnerJson(join(root, 'evidence', 'records', `${key(recordRef)}.json`)),
        resolveRegistration: (registrationRef) =>
          readOwnerJson(join(root, 'evidence', 'registrations', `${key(registrationRef)}.json`)),
        resolveLaunchClaim: (claimId) => {
          if (claimId !== expected.launch_claim_id) return undefined;
          const transaction = {
            kind: 'launch' as const,
            identity: claimIdentity,
            payload: claimPayload,
            boardPath,
            locator: {
              kind: 'launch' as const,
              task_id: expected.task_id,
              attempt_id: expected.attempt_id,
              dispatch_key: expected.dispatch_key,
            },
          };
          const current = readOwnerJson(join(root, 'claims', key(claimId), 'current.json'));
          return validCurrent(current, transaction) ? structuredClone(claimPayload) : undefined;
        },
      },
    });
    if (!verification.ok) return verification;
    const evidence = verification.verified_evidence;
    const payload = {
      schema: 'ccm/native-evidence-consumption/v1',
      evidence_class: input.evidence_class,
      record_ref: input.record_ref,
      record_hash: evidence.record_hash,
    };
    const identity = canonicalJson({
      evidence_class: input.evidence_class,
      record_ref: input.record_ref,
      record_hash: evidence.record_hash,
      scope: evidence.scope,
    });
    const transactionId = stageTransaction({
      kind: 'evidence',
      currentPath: join(
        root,
        'evidence',
        'consumptions',
        key(`${input.evidence_class}\0${input.record_ref}`),
        'current.json',
      ),
      identity,
      payload,
      boardPath,
      locator: {
        kind: 'evidence',
        evidence_class: input.evidence_class,
        task_id: expected.task_id,
        attempt_id: expected.attempt_id,
        record_ref: input.record_ref,
        record_hash: evidence.record_hash,
      },
      recoveryAllowed: Boolean(
        input.existing_evidence?.record_ref === input.record_ref &&
          input.existing_evidence?.record_hash === evidence.record_hash,
      ),
    });
    if (!transactionId) return fail('NATIVE-EVIDENCE-CLAIM-REUSED');
    return { ok: true, transaction_id: transactionId, verified_evidence: evidence };
  };

  return {
    admission: { stageCreate, commit, rollback, resolveControl },
    evidence: {
      schema: 'ccm/native-private-evidence-authentication/v1',
      channel: 'ccm-private-adapter/v1',
      stageAndVerify,
      commit,
      rollback,
    },
  };
}
