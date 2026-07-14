import { createHash, createPublicKey, verify } from 'node:crypto';
import { canonicalJson, canonicalSha256Digest } from '@ccm/engine';
import type {
  NativeAttemptEvidenceClass,
  NativeAttemptVerifiedEvidence,
} from './handlers/_common.js';

type Json = Record<string, any>;

export interface NativeEvidenceVerificationStore {
  ownerHomeRef: string;
  resolveRecord: (recordRef: string) => Json | undefined;
  resolveRegistration: (registrationRef: string) => Json | undefined;
  resolveLaunchClaim: (claimId: string) => Json | undefined;
}

export type NativeEvidenceVerificationResult =
  | { ok: true; verified_evidence: NativeAttemptVerifiedEvidence; trace: string[] }
  | { ok: false; issues: Array<{ code: string }>; trace: string[] };

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const HANDLE_SCHEMA = 'ccm/native-handle-evidence-record/codex-api-tool/v1';
const GENERIC_SCHEMA = 'ccm/native-evidence-record/v1';
const PRODUCER_SCHEMA = 'ccm/native-evidence-producer/codex-api-tool/v1';
const REGISTRATION_FIELDS = [
  'schema',
  'producer_id',
  'channel',
  'registration_ref',
  'public_key_id',
  'public_key_spki_base64',
  'public_key_fingerprint',
  'revoked',
  'trust_scope',
] as const;
const TRUST_SCOPE_FIELDS = [
  'contract',
  'origin',
  'harness',
  'adapter',
  'surface',
  'transport',
  'origin_session_ref',
] as const;

const HANDLE_RECORD_FIELDS = [
  'schema',
  'record_id',
  'record_hash',
  'producer',
  'create_link',
  'expected',
  'observed',
] as const;
const GENERIC_RECORD_FIELDS = [
  'schema',
  'record_id',
  'evidence_class',
  'record_hash',
  'producer',
  'create_link',
  'expected',
  'observed',
  'asserted_record_hash',
  'payload',
] as const;
const PRODUCER_FIELDS = ['producer_id', 'channel', 'registration_ref', 'signature'] as const;
const HANDLE_LINK_FIELDS = [
  'task_id',
  'attempt_id',
  'candidate_id',
  'dispatch_key',
  'input_hash',
  'request_hash',
  'launch_claim_id',
  'reservation_id',
  'ticket_digest',
  'launch_identity_digest',
] as const;
const GENERIC_LINK_FIELDS = [...HANDLE_LINK_FIELDS, 'create_hash'] as const;
const HANDLE_EXPECTED_FIELDS = ['transport', 'parent_target', 'child_target'] as const;
const GENERIC_EXPECTED_FIELDS = ['contract', 'descriptor', 'child_target'] as const;
const HANDLE_OBSERVED_FIELDS = [
  'handle_kind',
  'handle',
  'canonical_target',
  'spawn',
  'roster',
  'current_lineage',
] as const;
const SPAWN_FIELDS = ['owner_record_ref', 'raw_evidence_hash', 'observed_at'] as const;
const ROSTER_FIELDS = [
  'owner_record_ref',
  'raw_evidence_hash',
  'observed_at',
  'handle',
  'state',
] as const;
const DESCRIPTOR_FIELDS = ['origin', 'harness', 'adapter', 'surface', 'transport'] as const;
const LINEAGE_FIELDS = [
  'origin_session_ref',
  'parent_target',
  'expected_child_target',
  'account_fingerprint_ref',
  'workspace_ref',
  'worktree_ref',
  'baseline_commit',
  'permission',
] as const;
const PERMISSION_FIELDS = ['snapshot_ref', 'profile', 'denies'] as const;
const CLAIM_FIELDS = [
  'schema',
  'claim_id',
  'canonical_identity_digest',
  'ticket_digest',
  'reservation_id',
] as const;
const EXPECTED_FIELDS = [
  'contract',
  'origin',
  'harness',
  'adapter',
  'surface',
  'transport',
  'task_id',
  'attempt_id',
  'candidate_id',
  'dispatch_key',
  'input_hash',
  'request_hash',
  'launch_claim_id',
  'reservation_id',
  'ticket_digest',
  'launch_identity_digest',
  'create_hash',
  'lineage',
] as const;

function object(value: unknown): Json | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function exact(value: Json | undefined, fields: readonly string[]): value is Json {
  if (!value) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function fail(code: string, trace: string[]): NativeEvidenceVerificationResult {
  return { ok: false, issues: [{ code }], trace };
}

function containsCallerCertification(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCallerCertification);
  const row = object(value);
  if (!row) return false;
  if (
    Object.keys(row).some((key) =>
      ['verified_by_ccm', 'ccm_verified', 'caller_verified_by_ccm'].includes(key),
    )
  ) {
    return true;
  }
  return Object.values(row).some(containsCallerCertification);
}

function canonicalSignedRecord(record: Json): Json | undefined {
  if (record.schema === HANDLE_SCHEMA) {
    if (
      !exact(record, HANDLE_RECORD_FIELDS) ||
      !exact(object(record.producer), PRODUCER_FIELDS) ||
      !exact(object(record.create_link), HANDLE_LINK_FIELDS) ||
      !exact(object(record.expected), HANDLE_EXPECTED_FIELDS) ||
      !exact(object(record.observed), HANDLE_OBSERVED_FIELDS) ||
      !exact(object(record.observed?.spawn), SPAWN_FIELDS) ||
      !exact(object(record.observed?.roster), ROSTER_FIELDS)
    ) {
      return undefined;
    }
    return {
      schema: record.schema,
      record_id: record.record_id,
      producer: {
        producer_id: record.producer.producer_id,
        channel: record.producer.channel,
        registration_ref: record.producer.registration_ref,
      },
      create_link: record.create_link,
      expected: record.expected,
      observed: record.observed,
    };
  }
  if (
    record.schema !== GENERIC_SCHEMA ||
    !exact(record, GENERIC_RECORD_FIELDS) ||
    !exact(object(record.producer), PRODUCER_FIELDS) ||
    !exact(object(record.create_link), GENERIC_LINK_FIELDS) ||
    !exact(object(record.expected), GENERIC_EXPECTED_FIELDS)
  ) {
    return undefined;
  }
  const descriptor = object(record.expected?.descriptor);
  const observedDescriptor = object(record.observed?.descriptor);
  if (!exact(descriptor, DESCRIPTOR_FIELDS) || !exact(observedDescriptor, DESCRIPTOR_FIELDS)) {
    return undefined;
  }
  return {
    schema: record.schema,
    record_id: record.record_id,
    evidence_class: record.evidence_class,
    producer: {
      producer_id: record.producer.producer_id,
      channel: record.producer.channel,
      registration_ref: record.producer.registration_ref,
    },
    create_link: record.create_link,
    expected: record.expected,
    observed: record.observed,
    asserted_record_hash: record.asserted_record_hash,
    payload: record.payload,
  };
}

function expectedDescriptor(expected: Json): Json {
  return {
    origin: expected.origin,
    harness: expected.harness,
    adapter: expected.adapter,
    surface: expected.surface,
    transport: expected.transport,
  };
}

function contextIsComplete(expected: Json): boolean {
  const lineage = object(expected.lineage);
  const permission = object(lineage?.permission);
  return (
    exact(expected, EXPECTED_FIELDS) &&
    Object.entries(expected).every(([key, value]) => key === 'lineage' || nonempty(value)) &&
    exact(lineage, LINEAGE_FIELDS) &&
    LINEAGE_FIELDS.every((field) => field === 'permission' || nonempty(lineage[field])) &&
    exact(permission, PERMISSION_FIELDS) &&
    nonempty(permission.snapshot_ref) &&
    nonempty(permission.profile) &&
    Array.isArray(permission.denies) &&
    permission.denies.every(nonempty)
  );
}

function currentLineageValid(
  current: Json | undefined,
  expected: Json,
  permitsDrift: boolean,
): boolean {
  const permission = object(current?.permission);
  if (!exact(current, LINEAGE_FIELDS) || !exact(permission, PERMISSION_FIELDS)) return false;
  for (const field of LINEAGE_FIELDS) {
    if (field === 'permission') continue;
    if (
      !nonempty(current[field]) ||
      (field !== 'account_fingerprint_ref' &&
        !permitsDrift &&
        current[field] !== expected.lineage[field])
    ) {
      return false;
    }
  }
  return (
    nonempty(permission.snapshot_ref) &&
    nonempty(permission.profile) &&
    Array.isArray(permission.denies) &&
    permission.denies.every(nonempty)
  );
}

export function verifyProductionNativeEvidence(input: {
  evidence_class: NativeAttemptEvidenceClass;
  record_ref: string;
  expected: Json;
  store: NativeEvidenceVerificationStore;
}): NativeEvidenceVerificationResult {
  const trace: string[] = [];
  const { evidence_class: evidenceClass, record_ref: recordRef, expected, store } = input;

  trace.push('expected-attempt-context');
  if (!contextIsComplete(expected)) {
    return fail('NATIVE-EVIDENCE-CREATE-LINK-MISMATCH', trace);
  }
  trace.push('owner-store-resolve');
  const entry = store.resolveRecord(recordRef);
  const record = object(entry?.record);
  if (!entry || !record) return fail('NATIVE-EVIDENCE-RECORD-MISSING', trace);

  trace.push('caller-verification-field');
  if (containsCallerCertification(record)) {
    return fail('NATIVE-EVIDENCE-CALLER-VERIFICATION-FORBIDDEN', trace);
  }

  trace.push('owner-store-provenance');
  if (
    entry.provenance?.store !== 'ccm-owner-evidence/v1' ||
    entry.provenance?.visibility !== 'owner-only' ||
    entry.provenance?.owner_home_ref !== store.ownerHomeRef ||
    entry.provenance?.record_ref !== recordRef ||
    record.record_id !== recordRef
  ) {
    return fail('NATIVE-EVIDENCE-OWNER-STORE-PROVENANCE', trace);
  }

  trace.push('evidence-class');
  const recordClass = record.schema === HANDLE_SCHEMA ? 'bind' : record.evidence_class;
  if (recordClass !== evidenceClass) {
    return fail('NATIVE-EVIDENCE-CLASS-UNSUPPORTED', trace);
  }

  trace.push('canonical-hash');
  const canonicalRecord = canonicalSignedRecord(record);
  if (!canonicalRecord || canonicalSha256Digest(canonicalRecord) !== record.record_hash) {
    return fail('NATIVE-EVIDENCE-CANONICAL-HASH-MISMATCH', trace);
  }

  const producer = object(record.producer) as Json;
  trace.push('producer-registration');
  const registration = nonempty(producer.registration_ref)
    ? store.resolveRegistration(producer.registration_ref)
    : undefined;
  if (
    !exact(registration, REGISTRATION_FIELDS) ||
    !exact(object(registration.trust_scope), TRUST_SCOPE_FIELDS) ||
    registration?.schema !== PRODUCER_SCHEMA ||
    registration.registration_ref !== producer.registration_ref ||
    registration.producer_id !== producer.producer_id ||
    registration.channel !== producer.channel ||
    registration.channel !== 'ccm-private-adapter/v1' ||
    registration.revoked !== false
  ) {
    return fail('NATIVE-EVIDENCE-REGISTRATION-UNKNOWN', trace);
  }

  trace.push('producer-key-integrity');
  let publicKeyBytes: Buffer;
  try {
    publicKeyBytes = Buffer.from(String(registration.public_key_spki_base64), 'base64');
  } catch {
    return fail('NATIVE-EVIDENCE-REGISTRATION-UNKNOWN', trace);
  }
  const expectedKeyId = `ed25519:${String(registration.producer_id).replace(/^producer:/, '')}`;
  if (
    registration.public_key_id !== expectedKeyId ||
    registration.public_key_fingerprint !==
      `sha256:${createHash('sha256').update(publicKeyBytes).digest('hex')}`
  ) {
    return fail('NATIVE-EVIDENCE-REGISTRATION-UNKNOWN', trace);
  }

  trace.push('signature');
  try {
    if (
      !String(producer.signature).startsWith('ed25519:') ||
      !verify(
        null,
        Buffer.from(String(record.record_hash)),
        createPublicKey({ key: publicKeyBytes, format: 'der', type: 'spki' }),
        Buffer.from(String(producer.signature).replace(/^ed25519:/, ''), 'base64'),
      )
    ) {
      return fail('NATIVE-EVIDENCE-SIGNATURE-INVALID', trace);
    }
  } catch {
    return fail('NATIVE-EVIDENCE-SIGNATURE-INVALID', trace);
  }

  trace.push('producer-trust-scope');
  const scope = registration.trust_scope;
  if (
    scope?.contract !== expected.contract ||
    scope?.origin !== expected.origin ||
    scope?.harness !== expected.harness ||
    scope?.adapter !== expected.adapter ||
    scope?.surface !== expected.surface ||
    scope?.transport !== expected.transport ||
    scope?.origin_session_ref !== expected.lineage.origin_session_ref
  ) {
    return fail('NATIVE-EVIDENCE-TRUST-SCOPE-MISMATCH', trace);
  }

  trace.push('content-linkage');
  const link = record.create_link;
  if (
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
    (record.schema === GENERIC_SCHEMA && link.create_hash !== expected.create_hash)
  ) {
    return fail('NATIVE-EVIDENCE-CREATE-LINK-MISMATCH', trace);
  }
  if (record.schema === HANDLE_SCHEMA) {
    if (record.expected.transport !== expected.transport) {
      return fail('NATIVE-EVIDENCE-TRUST-SCOPE-MISMATCH', trace);
    }
    if (record.expected.parent_target !== expected.lineage.parent_target) {
      return fail('NATIVE-LINEAGE-MISMATCH', trace);
    }
    if (record.expected.child_target !== expected.lineage.expected_child_target) {
      return fail('NATIVE-EXPECTED-CHILD-MISMATCH', trace);
    }
  } else if (
    record.expected.contract !== expected.contract ||
    !same(record.expected.descriptor, expectedDescriptor(expected)) ||
    !same(record.observed?.descriptor, record.expected.descriptor)
  ) {
    return fail('NATIVE-EVIDENCE-TRUST-SCOPE-MISMATCH', trace);
  } else if (record.expected.child_target !== expected.lineage.expected_child_target) {
    return fail('NATIVE-EXPECTED-CHILD-MISMATCH', trace);
  }

  const permitsDrift =
    evidenceClass === 'reconcile' && record.payload?.classification === 'uncertain';
  const currentLineage = object(record.observed?.current_lineage);
  if (!currentLineage || !currentLineageValid(currentLineage, expected, permitsDrift)) {
    return fail('NATIVE-LINEAGE-MISMATCH', trace);
  }
  trace.push('account-lineage');
  if (entry.fact_resolution?.account === 'unknown') {
    return fail('NATIVE-ACCOUNT-FINGERPRINT-UNKNOWN', trace);
  }
  if (entry.fact_resolution?.account !== 'current') {
    return fail('NATIVE-ACCOUNT-FINGERPRINT-MISMATCH', trace);
  }
  if (
    !permitsDrift &&
    currentLineage.account_fingerprint_ref !== expected.lineage.account_fingerprint_ref
  ) {
    return fail('NATIVE-ACCOUNT-FINGERPRINT-MISMATCH', trace);
  }

  if (evidenceClass === 'bind') {
    trace.push('handle-content');
    if (!nonempty(record.observed?.handle)) return fail('NATIVE-HANDLE-MISSING', trace);
    if (
      record.observed.handle === expected.lineage.origin_session_ref ||
      record.observed.handle === expected.lineage.parent_target ||
      record.observed.handle === expected.task_id
    ) {
      return fail('NATIVE-HANDLE-PARENT-SESSION', trace);
    }
    if (
      !nonempty(record.observed.handle_kind) ||
      !nonempty(record.observed.spawn?.owner_record_ref) ||
      !SHA256_RE.test(String(record.observed.spawn?.raw_evidence_hash)) ||
      !nonempty(record.observed.spawn?.observed_at) ||
      !nonempty(record.observed.roster?.owner_record_ref) ||
      !SHA256_RE.test(String(record.observed.roster?.raw_evidence_hash)) ||
      !nonempty(record.observed.roster?.observed_at) ||
      record.observed.roster?.handle !== record.observed.handle ||
      record.observed.roster?.state !== 'running'
    ) {
      return fail('NATIVE-HANDLE-UNATTESTED', trace);
    }
    if (record.observed.canonical_target !== expected.lineage.expected_child_target) {
      return fail('NATIVE-EXPECTED-CHILD-MISMATCH', trace);
    }
  } else {
    const targetRequired =
      evidenceClass === 'terminal' ||
      record.payload?.classification === 'running' ||
      record.payload?.classification === 'terminal';
    if (
      (targetRequired && record.observed?.target !== expected.lineage.expected_child_target) ||
      (!targetRequired && record.observed?.target !== null)
    ) {
      return fail('NATIVE-EXPECTED-CHILD-MISMATCH', trace);
    }
    if (
      evidenceClass === 'reconcile' &&
      record.payload?.classification === 'running' &&
      (!nonempty(record.observed?.handle) ||
        record.observed?.spawn?.target !== record.observed.target ||
        record.observed?.roster?.target !== record.observed.target ||
        record.observed?.roster?.handle !== record.observed.handle)
    ) {
      return fail('NATIVE-HANDLE-UNATTESTED', trace);
    }
  }

  trace.push('permission-profile');
  if (entry.fact_resolution?.permission_profile !== 'compatible') {
    return fail('NATIVE-PERMISSION-PROFILE-INCOMPATIBLE', trace);
  }
  trace.push('permission-denies');
  if (entry.fact_resolution?.permission_denies !== 'compatible') {
    return fail('NATIVE-PERMISSION-DENY-INCOMPATIBLE', trace);
  }

  trace.push('one-shot-claim');
  const claim = store.resolveLaunchClaim(expected.launch_claim_id);
  if (
    !exact(claim, CLAIM_FIELDS) ||
    claim.schema !== 'ccm/native-launch-claim/v1' ||
    claim.claim_id !== expected.launch_claim_id ||
    claim.canonical_identity_digest !== expected.launch_identity_digest ||
    claim.ticket_digest !== expected.ticket_digest ||
    claim.reservation_id !== expected.reservation_id
  ) {
    return fail('NATIVE-EVIDENCE-CLAIM-REUSED', trace);
  }

  let observed: Json;
  let payload: Json;
  if (evidenceClass === 'bind') {
    observed = {
      descriptor: expectedDescriptor(expected),
      target: record.observed.canonical_target,
      source: 'authoritative-spawn-and-roster',
      current_lineage: structuredClone(record.observed.current_lineage),
      handle: record.observed.handle,
      handle_kind: record.observed.handle_kind,
      spawn: {
        ...structuredClone(record.observed.spawn),
        target: record.observed.canonical_target,
      },
      roster: {
        ...structuredClone(record.observed.roster),
        target: record.observed.canonical_target,
      },
    };
    payload = { durability_class: 'legacy_session_bound' };
  } else {
    observed = structuredClone(record.observed);
    payload = structuredClone(record.payload);
  }
  return {
    ok: true,
    trace,
    verified_evidence: {
      schema: 'ccm/native-verified-evidence/v1',
      evidence_class: evidenceClass,
      record_ref: recordRef,
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
    },
  };
}
