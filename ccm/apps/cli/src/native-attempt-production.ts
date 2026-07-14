import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { dirname, join } from 'node:path';
import { canonicalJson } from '@ccm/engine';
import type {
  NativeAttemptAdmissionBoundary,
  NativeAttemptEvidenceClass,
  NativeAttemptPrivateEvidenceBoundary,
  NativeAttemptVerifiedEvidence,
} from './handlers/_common.js';

type Json = Record<string, any>;

interface Options {
  home: string;
  now?: () => Date;
}

interface StagedTransaction {
  kind: 'launch' | 'evidence';
  identity: string;
  currentPath: string;
  lockPath?: string;
  lockFd?: number;
  payload: Json;
  replay: boolean;
}

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function object(value: unknown): Json | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function fail(code: string): { ok: false; issues: Array<{ code: string }> } {
  return { ok: false, issues: [{ code }] };
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
    // Darwin/filesystems may not support directory fsync. The no-replace owner record remains safe.
  }
}

function canonicalSignedRecord(record: Json): Json {
  if (record.schema === 'ccm/native-handle-evidence-record/codex-api-tool/v1') {
    return {
      schema: record.schema,
      record_id: record.record_id,
      producer: {
        producer_id: record.producer?.producer_id,
        channel: record.producer?.channel,
        registration_ref: record.producer?.registration_ref,
      },
      create_link: record.create_link,
      expected: record.expected,
      observed: record.observed,
    };
  }
  return {
    schema: record.schema,
    record_id: record.record_id,
    evidence_class: record.evidence_class,
    producer: {
      producer_id: record.producer?.producer_id,
      channel: record.producer?.channel,
      registration_ref: record.producer?.registration_ref,
    },
    create_link: record.create_link,
    expected: record.expected,
    observed: record.observed,
    asserted_record_hash: record.asserted_record_hash,
    payload: record.payload,
  };
}

export function createProductionNativeAttemptBoundaries(options: Options): {
  admission: NativeAttemptAdmissionBoundary;
  evidence: NativeAttemptPrivateEvidenceBoundary;
} {
  const root = join(options.home, 'native-attempt', 'v1');
  const now = options.now ?? (() => new Date());
  const transactions = new Map<string, StagedTransaction>();

  const stageTransaction = (
    kind: StagedTransaction['kind'],
    currentPath: string,
    identity: string,
    payload: Json,
    recoveryAllowed: boolean,
  ): string | undefined => {
    const lockPath = join(dirname(currentPath), 'stage.lock');
    const existing = readOwnerJson(currentPath);
    if (existing) {
      if (
        existing.identity !== identity ||
        Object.entries(payload).some(([key, value]) => !same(existing[key], value))
      ) {
        return undefined;
      }
      const staged = readOwnerJson(lockPath);
      const recoverableLock =
        staged?.schema === 'ccm/native-owner-stage/v1' &&
        staged.kind === kind &&
        staged.identity === identity &&
        same(staged.payload, payload);
      const transactionId = `${kind}-tx-${randomUUID()}`;
      transactions.set(transactionId, {
        kind,
        currentPath,
        lockPath: recoverableLock ? lockPath : undefined,
        identity,
        payload,
        replay: true,
      });
      return transactionId;
    }
    mkdirSync(dirname(currentPath), { recursive: true, mode: 0o700 });
    let lockFd: number;
    try {
      lockFd = openSync(lockPath, 'wx', 0o600);
    } catch {
      const staged = readOwnerJson(lockPath);
      if (
        !recoveryAllowed ||
        staged?.schema !== 'ccm/native-owner-stage/v1' ||
        staged.kind !== kind ||
        staged.identity !== identity ||
        !same(staged.payload, payload) ||
        processIsAlive(staged.owner_pid)
      ) {
        return undefined;
      }
      const transactionId = `${kind}-tx-${randomUUID()}`;
      transactions.set(transactionId, {
        kind,
        currentPath,
        lockPath,
        identity,
        payload,
        replay: false,
      });
      return transactionId;
    }
    try {
      writeFileSync(
        lockFd,
        `${JSON.stringify(
          {
            schema: 'ccm/native-owner-stage/v1',
            kind,
            owner_pid: process.pid,
            identity,
            payload,
          },
          null,
          2,
        )}\n`,
      );
      fsyncSync(lockFd);
    } catch {
      try {
        closeSync(lockFd);
      } catch {
        // The cleanup below remains authoritative.
      }
      try {
        unlinkSync(lockPath);
      } catch {
        // A failed stage never grants authority.
      }
      return undefined;
    }
    const transactionId = `${kind}-tx-${randomUUID()}`;
    transactions.set(transactionId, {
      kind,
      currentPath,
      lockPath,
      lockFd,
      identity,
      payload,
      replay: false,
    });
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
        // A missing lock is harmless; an unknown owner is never reclaimed during stage.
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
    const boardBytes = readFileSync(input.board_path);
    const actualBoardHash = `sha256:${createHash('sha256').update(boardBytes).digest('hex')}`;
    if (actualBoardHash !== input.board_content_hash) {
      throw new Error('NATIVE-AUTHORITY-BOARD-HASH-MISMATCH');
    }
    try {
      if (!transaction.replay) {
        durableWriteNew(transaction.currentPath, {
          ...transaction.payload,
          identity: transaction.identity,
          board_path: input.board_path,
          board_content_hash: input.board_content_hash,
          committed_at: now().toISOString(),
        });
      }
      transactions.delete(input.transaction_id);
    } finally {
      releaseStage(transaction);
    }
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
    const recordPath = join(root, 'admissions', `${hash(dispatchKey)}.json`);
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
      authority.ticket_digest !== digest(ticket) ||
      reservation.ticket_digest !== authority.ticket_digest ||
      !SHA256_RE.test(String(authority.canonical_identity_digest)) ||
      Date.parse(String(ticket.launch_by)) <= now().getTime() ||
      Date.parse(String(reservation.expires_at)) <= now().getTime() ||
      !object(record.admission_snapshot)
    ) {
      return fail('NATIVE-LAUNCH-AUTHORITY-INVALID');
    }
    const claimPath = join(root, 'claims', hash(String(authority.claim_id)), 'current.json');
    const identity = canonicalJson({
      claim_id: authority.claim_id,
      canonical_identity_digest: authority.canonical_identity_digest,
      ticket_digest: authority.ticket_digest,
      reservation_id: reservation.reservation_id,
    });
    const existingAttempt = object(input.existing_attempt);
    const frozenIncoming = object(existingAttempt?.create_snapshot?.attempt);
    const replayAttempt = frozenIncoming ? structuredClone(frozenIncoming) : undefined;
    if (replayAttempt) {
      delete replayAttempt.descriptor;
      delete replayAttempt.launch_authority;
    }
    const recoveryAllowed = Boolean(
      existingAttempt &&
        existingAttempt.id === input.attempt.id &&
        existingAttempt.dispatch?.key === dispatchKey &&
        same(replayAttempt, input.attempt) &&
        same(existingAttempt.create_snapshot?.selection_snapshot, input.selection_snapshot) &&
        same(existingAttempt.launch_authority, authority),
    );
    const transactionId = stageTransaction(
      'launch',
      claimPath,
      identity,
      {
        schema: 'ccm/native-launch-claim/v1',
        claim_id: authority.claim_id,
        canonical_identity_digest: authority.canonical_identity_digest,
        ticket_digest: authority.ticket_digest,
        reservation_id: reservation.reservation_id,
      },
      recoveryAllowed,
    );
    if (!transactionId) return fail('NATIVE-LAUNCH-CLAIM-REUSED');
    return {
      ok: true,
      transaction_id: transactionId,
      admission_snapshot: structuredClone(record.admission_snapshot),
      launch_authority: structuredClone(authority),
    };
  };

  const resolveControl: NativeAttemptAdmissionBoundary['resolveControl'] = (input) => {
    const path = join(root, 'controls', `${hash(input.attempt_id)}.json`);
    const record = readOwnerJson(path);
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
    const recordPath = join(root, 'evidence', 'records', `${hash(input.record_ref)}.json`);
    const entry = readOwnerJson(recordPath);
    const record = object(entry?.record);
    const producer = object(record?.producer);
    const registrationRef = producer?.registration_ref;
    const registration = nonempty(registrationRef)
      ? readOwnerJson(join(root, 'evidence', 'registrations', `${hash(registrationRef)}.json`))
      : undefined;
    const expected = input.expected;
    const link = object(record?.create_link);
    if (!entry || !record || !producer || !registration || !link) {
      return fail('NATIVE-EVIDENCE-AUTHENTICATION-FAILED');
    }
    if (
      entry.provenance?.store !== 'ccm-owner-evidence/v1' ||
      entry.provenance?.visibility !== 'owner-only' ||
      entry.provenance?.owner_home_ref !== options.home ||
      entry.provenance?.record_ref !== input.record_ref ||
      record.record_id !== input.record_ref ||
      !nonempty(record.record_hash) ||
      canonicalSignedRecord(record) === undefined ||
      digest(canonicalSignedRecord(record)) !== record.record_hash ||
      registration.producer_id !== producer.producer_id ||
      registration.channel !== 'ccm-private-adapter/v1' ||
      registration.registration_ref !== registrationRef ||
      registration.revoked !== false ||
      registration?.trust_scope?.contract !== expected.contract ||
      registration?.trust_scope?.origin !== expected.origin ||
      registration?.trust_scope?.harness !== expected.harness ||
      registration?.trust_scope?.adapter !== expected.adapter ||
      registration?.trust_scope?.surface !== expected.surface ||
      registration?.trust_scope?.transport !== expected.transport ||
      registration?.trust_scope?.origin_session_ref !== expected.lineage?.origin_session_ref ||
      link.task_id !== expected.task_id ||
      link.attempt_id !== expected.attempt_id ||
      link.candidate_id !== expected.candidate_id ||
      link.dispatch_key !== expected.dispatch_key ||
      link.input_hash !== expected.input_hash ||
      link.request_hash !== expected.request_hash ||
      link.launch_claim_id !== expected.launch_claim_id ||
      link.reservation_id !== expected.reservation_id ||
      link.ticket_digest !== expected.ticket_digest ||
      link.launch_identity_digest !== expected.launch_identity_digest ||
      (record.schema === 'ccm/native-evidence-record/v1' &&
        link.create_hash !== expected.create_hash)
    ) {
      return fail('NATIVE-EVIDENCE-AUTHENTICATION-FAILED');
    }
    try {
      const keyBytes = Buffer.from(String(registration.public_key_spki_base64), 'base64');
      if (
        registration.public_key_fingerprint !==
          `sha256:${createHash('sha256').update(keyBytes).digest('hex')}` ||
        !verify(
          null,
          Buffer.from(String(record.record_hash)),
          createPublicKey({ key: keyBytes, format: 'der', type: 'spki' }),
          Buffer.from(String(producer.signature).replace(/^ed25519:/, ''), 'base64'),
        )
      ) {
        return fail('NATIVE-EVIDENCE-SIGNATURE-INVALID');
      }
    } catch {
      return fail('NATIVE-EVIDENCE-SIGNATURE-INVALID');
    }
    if (input.evidence_class === 'bind') {
      const claim = readOwnerJson(
        join(root, 'claims', hash(expected.launch_claim_id), 'current.json'),
      );
      if (
        claim?.canonical_identity_digest !== expected.launch_identity_digest ||
        claim?.ticket_digest !== expected.ticket_digest ||
        claim?.reservation_id !== expected.reservation_id
      ) {
        return fail('NATIVE-EVIDENCE-CLAIM-REUSED');
      }
    }
    const recordClass =
      record.schema === 'ccm/native-handle-evidence-record/codex-api-tool/v1'
        ? 'bind'
        : record.evidence_class;
    if (recordClass !== input.evidence_class) return fail('NATIVE-EVIDENCE-CLASS-UNSUPPORTED');
    let observed: Json;
    let payload: Json;
    if (input.evidence_class === 'bind') {
      observed = {
        descriptor: {
          origin: expected.origin,
          harness: expected.harness,
          adapter: expected.adapter,
          surface: expected.surface,
          transport: expected.transport,
        },
        target: record.observed?.canonical_target,
        source: 'authoritative-spawn-and-roster',
        current_lineage: structuredClone(record.observed?.current_lineage),
        handle: record.observed?.handle,
        handle_kind: record.observed?.handle_kind,
        spawn: {
          ...structuredClone(record.observed?.spawn),
          target: record.observed?.canonical_target,
        },
        roster: {
          ...structuredClone(record.observed?.roster),
          target: record.observed?.canonical_target,
        },
      };
      payload = { durability_class: 'legacy_session_bound' };
    } else {
      observed = structuredClone(record.observed);
      payload = structuredClone(record.payload);
    }
    const verifiedEvidence: NativeAttemptVerifiedEvidence = {
      schema: 'ccm/native-verified-evidence/v1',
      evidence_class: input.evidence_class as NativeAttemptEvidenceClass,
      record_ref: input.record_ref,
      record_hash: record.record_hash,
      producer: {
        producer_id: producer.producer_id,
        channel: producer.channel,
        registration_ref: producer.registration_ref,
      },
      resolved_context: structuredClone(entry.fact_resolution),
      scope: {
        contract: expected.contract,
        origin: expected.origin,
        harness: expected.harness,
        adapter: expected.adapter,
        surface: expected.surface,
        transport: expected.transport,
        task_id: expected.task_id,
        attempt_id: expected.attempt_id,
        candidate_id: expected.candidate_id,
        dispatch_key: expected.dispatch_key,
        input_hash: expected.input_hash,
        request_hash: expected.request_hash,
        launch_claim_id: expected.launch_claim_id,
        reservation_id: expected.reservation_id,
        ticket_digest: expected.ticket_digest,
        launch_identity_digest: expected.launch_identity_digest,
        create_hash: expected.create_hash,
      },
      observed: observed as NativeAttemptVerifiedEvidence['observed'],
      payload,
    };
    const identity = canonicalJson({
      evidence_class: input.evidence_class,
      record_ref: input.record_ref,
      record_hash: record.record_hash,
      scope: verifiedEvidence.scope,
    });
    const currentPath = join(
      root,
      'evidence',
      'consumptions',
      hash(`${input.evidence_class}\0${input.record_ref}`),
      'current.json',
    );
    const transactionId = stageTransaction(
      'evidence',
      currentPath,
      identity,
      {
        schema: 'ccm/native-evidence-consumption/v1',
        evidence_class: input.evidence_class,
        record_ref: input.record_ref,
        record_hash: record.record_hash,
      },
      Boolean(
        input.existing_evidence?.record_ref === input.record_ref &&
          input.existing_evidence?.record_hash === record.record_hash,
      ),
    );
    if (!transactionId) return fail('NATIVE-EVIDENCE-CLAIM-REUSED');
    return { ok: true, transaction_id: transactionId, verified_evidence: verifiedEvidence };
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
