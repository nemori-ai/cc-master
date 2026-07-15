import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

export const QUALIFIED_PLATFORMS_V2 = Object.freeze(['darwin', 'linux']);

const AUTHORITY_KEYS = [
  'active_same_uid_selection_race',
  'authority_id',
  'bound_io_assurance',
  'grant',
  'issued_at',
  'lexical_home',
  'root_identity',
  'schema',
  'scope',
  'selection_assurance',
  'storage_locator',
];
const IDENTITY_KEYS = ['device', 'inode', 'mode', 'platform', 'type', 'uid'];
const CAPABILITY_KEYS = ['assurance', 'authority_id', 'execute', 'phase', 'schema'];
const BASE_KEYS = ['kind', 'operation_id', 'phase', 'schema', 'segments'];
const OPERATION_KEYS = {
  'read-file': [...BASE_KEYS, 'max_bytes'].sort(),
  'list-directory': [...BASE_KEYS, 'max_entries', 'max_name_bytes'].sort(),
  'create-file-no-replace': [
    ...BASE_KEYS,
    'bytes_base64',
    'directory_mode',
    'durability',
    'file_mode',
  ].sort(),
  'replace-file-cas': [
    ...BASE_KEYS,
    'bytes_base64',
    'directory_mode',
    'durability',
    'expected_revision',
    'file_mode',
  ].sort(),
  'append-ccmj-frame-cas': [
    ...BASE_KEYS,
    'directory_mode',
    'durability',
    'expected_byte_length',
    'expected_revision',
    'file_mode',
    'frame_base64',
    'max_file_bytes',
  ].sort(),
};
const READ_RESULT_KEYS = [
  'authority_id',
  'byte_length',
  'bytes_base64',
  'content_digest',
  'kind',
  'operation_digest',
  'operation_id',
  'outcome',
  'revision',
  'schema',
];
const LIST_RESULT_KEYS = [
  'authority_id',
  'entries',
  'entries_digest',
  'entry_count',
  'kind',
  'operation_digest',
  'operation_id',
  'outcome',
  'schema',
];
const ENTRY_KEYS = ['byte_length', 'name', 'type'];
const RECEIPT_KEYS = [
  'after_revision',
  'authority_id',
  'before_revision',
  'byte_length',
  'durability',
  'kind',
  'operation_digest',
  'operation_id',
  'outcome',
  'schema',
];
const DURABILITY_KEYS = ['directory', 'file', 'schema'];
const TRACE_KEYS = [
  'authority_id',
  'capability_invocations',
  'consumer_invocations',
  'operation_digests',
  'schema',
];
const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export function oracleErrorV2(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

export function bindRunStoreErrorV2(
  error,
  authorityId,
  operation,
  {
    effect: defaultEffect = 'none',
    retry: defaultRetry = 'never',
    code: defaultCode,
    overrideClassification = false,
  } = {},
) {
  const effect =
    !overrideClassification && (error?.effect === 'none' || error?.effect === 'unknown')
      ? error.effect
      : defaultEffect;
  const retry =
    !overrideClassification &&
    ['safe-same-operation', 'reconcile-first', 'never'].includes(error?.retry)
      ? error.retry
      : effect === 'unknown'
        ? 'reconcile-first'
        : defaultRetry;
  return oracleErrorV2(
    error?.code ?? defaultCode ?? 'RUN_STORE_ORACLE_UNTYPED',
    error instanceof Error ? error.message : String(error),
    {
      authority_id: authorityId ?? null,
      operation_id:
        operation && typeof operation.operation_id === 'string' ? operation.operation_id : null,
      effect,
      retry,
    },
  );
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

export function canonicalJsonV2(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256V2(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function bytesBase64(value) {
  return Buffer.from(value).toString('base64');
}

function exactKeys(value, expected, code, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw oracleErrorV2(code, `${label} must be an object`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) {
    throw oracleErrorV2(code, `${label} must not contain symbol keys`);
  }
  const actual = [...keys].sort();
  if (canonicalJsonV2(actual) !== canonicalJsonV2(expected)) {
    throw oracleErrorV2(code, `${label} keys mismatch: ${actual.join(',')}`);
  }
}

function canonicalBase64(value, maxBytes, code, label) {
  if (typeof value !== 'string') throw oracleErrorV2(code, `${label} must be base64`);
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || bytes.length > maxBytes) {
    throw oracleErrorV2(code, `${label} must be canonical base64 within ${maxBytes} bytes`);
  }
  return bytes;
}

function safeInteger(value, min, max, code, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw oracleErrorV2(code, `${label} is outside ${min}..${max}`);
  }
}

export function identityFromStatV2(stat, platform = process.platform) {
  return {
    platform,
    device: String(stat.dev),
    inode: String(stat.ino),
    uid: String(stat.uid),
    mode: (stat.mode & 0o777).toString(8).padStart(4, '0'),
    type: stat.isDirectory() ? 'directory' : 'other',
  };
}

function grantKeys(phase) {
  if (phase === 'claim-transaction') {
    return ['attempt_id', 'idempotency_digest', 'phase', 'run_id'];
  }
  if (phase === 'supervisor-runtime') {
    return ['attempt_id', 'phase', 'run_id', 'supervisor_instance_id'];
  }
  if (phase === 'manager-control') return ['manager_id', 'phase', 'run_id'];
  if (phase === 'inventory-audit') return ['phase'];
  throw oracleErrorV2('RUN_STORE_GRANT_PHASE', `unsupported grant phase: ${phase}`);
}

export function validateGrantV2(grant) {
  const phase = grant?.phase;
  exactKeys(grant, grantKeys(phase), 'RUN_STORE_GRANT_SHAPE', 'grant');
  for (const [key, value] of Object.entries(grant)) {
    if (key === 'phase') continue;
    if (key === 'idempotency_digest') {
      if (!DIGEST_RE.test(value)) {
        throw oracleErrorV2('RUN_STORE_GRANT_IDENTITY', 'invalid idempotency digest');
      }
    } else if (!IDENTIFIER_RE.test(value)) {
      throw oracleErrorV2('RUN_STORE_GRANT_IDENTITY', `invalid grant identifier ${key}`);
    }
  }
  return grant;
}

export function createAuthorityEnvelopeV2({
  lexicalHome,
  storageLocator,
  identity,
  grant,
  issuedAt = '2026-07-15T00:00:00.000Z',
}) {
  const unsigned = {
    schema: 'ccm/run-store-cwd-authority/v2',
    lexical_home: lexicalHome,
    storage_locator: storageLocator,
    scope: 'runs/v1',
    selection_assurance: 'spawn-cwd-attested-v1',
    active_same_uid_selection_race: 'residual',
    bound_io_assurance: 'kernel-cwd-object-v1',
    root_identity: identity,
    grant: validateGrantV2(grant),
    issued_at: issuedAt,
  };
  return { ...unsigned, authority_id: sha256V2(canonicalJsonV2(unsigned)) };
}

export function authorityEnvironmentV2(authority) {
  return {
    CCM_RUN_STORE_CWD_AUTHORITY_V2: Buffer.from(canonicalJsonV2(authority)).toString('base64url'),
  };
}

function validateAuthorityShape(authority, canonicalBytes) {
  exactKeys(authority, AUTHORITY_KEYS, 'RUN_STORE_AUTHORITY_ENVELOPE', 'authority');
  exactKeys(
    authority.root_identity,
    IDENTITY_KEYS,
    'RUN_STORE_AUTHORITY_ENVELOPE',
    'root_identity',
  );
  validateGrantV2(authority.grant);
  if (canonicalJsonV2(authority) !== canonicalBytes) {
    throw oracleErrorV2('RUN_STORE_AUTHORITY_CANONICAL', 'authority JSON is not canonical');
  }
  if (
    authority.schema !== 'ccm/run-store-cwd-authority/v2' ||
    authority.scope !== 'runs/v1' ||
    authority.selection_assurance !== 'spawn-cwd-attested-v1' ||
    authority.active_same_uid_selection_race !== 'residual' ||
    authority.bound_io_assurance !== 'kernel-cwd-object-v1' ||
    !isAbsolute(authority.lexical_home) ||
    !isAbsolute(authority.storage_locator) ||
    !DIGEST_RE.test(authority.authority_id)
  ) {
    throw oracleErrorV2('RUN_STORE_AUTHORITY_ENVELOPE', 'unsupported authority envelope');
  }
  if (new Date(authority.issued_at).toISOString() !== authority.issued_at) {
    throw oracleErrorV2('RUN_STORE_AUTHORITY_ENVELOPE', 'issued_at must be canonical UTC');
  }
  const { authority_id: authorityId, ...unsigned } = authority;
  if (authorityId !== sha256V2(canonicalJsonV2(unsigned))) {
    throw oracleErrorV2('RUN_STORE_AUTHORITY_DIGEST', 'authority digest mismatch');
  }
}

export function decodeAndValidateAuthorityV2({ env, cwdStat }) {
  const encoded = env.CCM_RUN_STORE_CWD_AUTHORITY_V2;
  if (!encoded) throw oracleErrorV2('RUN_STORE_AUTHORITY_MISSING', 'authority is required');
  let bytes;
  let authority;
  try {
    const decoded = Buffer.from(encoded, 'base64url');
    if (decoded.toString('base64url') !== encoded) throw new Error('non-canonical base64url');
    bytes = decoded.toString('utf8');
    authority = JSON.parse(bytes);
  } catch (error) {
    throw oracleErrorV2(
      'RUN_STORE_AUTHORITY_ENVELOPE',
      `authority decode failed: ${error.message}`,
    );
  }
  validateAuthorityShape(authority, bytes);
  const actual = identityFromStatV2(cwdStat);
  const expected = authority.root_identity;
  if (!QUALIFIED_PLATFORMS_V2.includes(actual.platform) || expected.platform !== actual.platform) {
    throw oracleErrorV2('RUN_STORE_AUTHORITY_PLATFORM', 'cwd platform is not contract-qualified');
  }
  if (
    expected.device !== actual.device ||
    expected.inode !== actual.inode ||
    expected.uid !== actual.uid ||
    expected.mode !== actual.mode ||
    expected.type !== 'directory' ||
    actual.type !== 'directory'
  ) {
    throw oracleErrorV2('RUN_STORE_AUTHORITY_CWD_IDENTITY', 'cwd identity mismatch');
  }
  if (actual.mode !== '0700') {
    throw oracleErrorV2('RUN_STORE_AUTHORITY_CWD_MODE', 'cwd mode must be 0700');
  }
  if (typeof process.getuid === 'function' && actual.uid !== String(process.getuid())) {
    throw oracleErrorV2('RUN_STORE_AUTHORITY_CWD_UID', 'cwd must be owned by the current uid');
  }
  return authority;
}

function validateSegments(segments) {
  if (!Array.isArray(segments) || segments.length < 1 || segments.length > 8) {
    throw oracleErrorV2('RUN_STORE_PATH_INVALID', 'segments must contain 1..8 entries');
  }
  let bytes = 0;
  for (const segment of segments) {
    if (typeof segment !== 'string' || !SEGMENT_RE.test(segment) || segment.startsWith('.')) {
      throw oracleErrorV2('RUN_STORE_PATH_INVALID', `unsafe path segment: ${String(segment)}`);
    }
    bytes += Buffer.byteLength(segment);
  }
  if (bytes > 1024) throw oracleErrorV2('RUN_STORE_PATH_INVALID', 'segments exceed 1024 bytes');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function pathAllowed(operation, grant) {
  const path = operation.segments.join('/');
  const run = grant.run_id;
  if (grant.phase === 'supervisor-runtime') {
    const root = `by-run/${run}`;
    if (operation.kind === 'list-directory') return path === `${root}/control/inbox`;
    if (operation.kind === 'replace-file-cas') return path === `${root}/lease/supervisor.json`;
    if (operation.kind === 'append-ccmj-frame-cas') return path === `${root}/journal.ccmj`;
    if (operation.kind === 'create-file-no-replace') {
      return (
        path === `${root}/lease/hello.json` ||
        path === `${root}/launch/0003-hello-confirmed.json` ||
        path === `${root}/artifacts/result.json` ||
        new RegExp(
          `^${escapeRegExp(root)}/control/outbox/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\\.json$`,
          'u',
        ).test(path)
      );
    }
    return (
      path === `${root}/request.json` ||
      path === `${root}/journal.ccmj` ||
      path.startsWith(`${root}/launch/`) ||
      path.startsWith(`${root}/lease/`) ||
      path.startsWith(`${root}/control/inbox/`)
    );
  }
  if (grant.phase === 'manager-control') {
    const root = `by-run/${run}`;
    if (operation.kind === 'replace-file-cas') {
      return path === `${root}/lease/managers/${grant.manager_id}.json`;
    }
    if (operation.kind === 'create-file-no-replace') {
      return new RegExp(
        `^${escapeRegExp(root)}/control/inbox/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\\.json$`,
        'u',
      ).test(path);
    }
    if (operation.kind === 'read-file') {
      return (
        path === `${root}/request.json` ||
        path === `${root}/journal.ccmj` ||
        path.startsWith(`${root}/launch/`) ||
        path.startsWith(`${root}/lease/`) ||
        path.startsWith(`${root}/control/`)
      );
    }
    return false;
  }
  if (grant.phase === 'claim-transaction') {
    const root = `by-run/${run}`;
    const claim = `idempotency/${grant.idempotency_digest.slice('sha256:'.length)}.json`;
    if (operation.kind === 'read-file') {
      return (
        path === claim || path === `${root}/request.json` || path.startsWith(`${root}/launch/`)
      );
    }
    if (operation.kind === 'create-file-no-replace') {
      return (
        path === claim ||
        path === `${root}/request.json` ||
        path === `${root}/launch/0001-prepared.json` ||
        path === `${root}/launch/0002-claimed.json` ||
        path === `${root}/launch/receipt.json` ||
        path === `${root}/launch/failure.json`
      );
    }
    return false;
  }
  if (grant.phase === 'inventory-audit') {
    if (operation.kind === 'list-directory') return path === 'idempotency' || path === 'by-run';
    return (
      operation.kind === 'read-file' &&
      (/^idempotency\/[a-f0-9]{64}\.json$/u.test(path) ||
        /^by-run\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/(request\.json|journal\.ccmj|lease\/(hello|supervisor)\.json)$/u.test(
          path,
        ))
    );
  }
  return false;
}

function validateCcmjFrame(frame) {
  const newline = frame.indexOf(0x0a);
  if (newline < 0) throw oracleErrorV2('RUN_STORE_FRAME_INVALID', 'CCMJ header is missing');
  const header = frame.subarray(0, newline).toString('ascii');
  const match = /^CCMJ\/1 ([a-f0-9]{8}) ([a-f0-9]{64})$/u.exec(header);
  if (!match || frame.at(-1) !== 0x0a) {
    throw oracleErrorV2('RUN_STORE_FRAME_INVALID', 'CCMJ frame syntax is invalid');
  }
  const payload = frame.subarray(newline + 1, -1);
  if (payload.length > 1_048_576 || Number.parseInt(match[1], 16) !== payload.length) {
    throw oracleErrorV2('RUN_STORE_FRAME_INVALID', 'CCMJ payload length mismatch');
  }
  if (sha256V2(payload).slice('sha256:'.length) !== match[2]) {
    throw oracleErrorV2('RUN_STORE_FRAME_INVALID', 'CCMJ payload digest mismatch');
  }
}

export function validateOperationV2(operation, grant) {
  const validatedGrant = validateGrantV2(grant);
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    throw oracleErrorV2('RUN_STORE_OPERATION_SHAPE', 'operation must be an object');
  }
  const expectedKeys = OPERATION_KEYS[operation.kind];
  if (!expectedKeys) {
    throw oracleErrorV2('RUN_STORE_OPERATION_UNKNOWN', `unknown operation: ${operation.kind}`);
  }
  exactKeys(operation, expectedKeys, 'RUN_STORE_OPERATION_SHAPE', 'operation');
  if (
    operation.schema !== 'ccm/run-store-operation/v2' ||
    !IDENTIFIER_RE.test(operation.operation_id)
  ) {
    throw oracleErrorV2('RUN_STORE_OPERATION_SHAPE', 'operation identity is invalid');
  }
  validateSegments(operation.segments);
  if (operation.phase !== validatedGrant.phase) {
    throw oracleErrorV2('RUN_STORE_PHASE_FORBIDDEN', 'operation phase does not match grant');
  }
  if (!pathAllowed(operation, validatedGrant)) {
    throw oracleErrorV2('RUN_STORE_PATH_FORBIDDEN', 'operation path is outside the phase grant');
  }
  if (operation.kind === 'read-file') {
    safeInteger(operation.max_bytes, 1, 67_108_864, 'RUN_STORE_BOUND_INVALID', 'max_bytes');
  } else if (operation.kind === 'list-directory') {
    safeInteger(operation.max_entries, 1, 4096, 'RUN_STORE_BOUND_INVALID', 'max_entries');
    safeInteger(operation.max_name_bytes, 1, 255, 'RUN_STORE_BOUND_INVALID', 'max_name_bytes');
  } else {
    if (
      operation.directory_mode !== '0700' ||
      operation.file_mode !== '0600' ||
      operation.durability !== 'file-and-directory-synced-v1'
    ) {
      throw oracleErrorV2('RUN_STORE_MUTATION_CONTRACT', 'mutation mode or durability is invalid');
    }
    if (operation.kind === 'create-file-no-replace') {
      canonicalBase64(
        operation.bytes_base64,
        16_777_216,
        'RUN_STORE_BOUND_INVALID',
        'bytes_base64',
      );
    } else if (operation.kind === 'replace-file-cas') {
      if (
        operation.expected_revision !== 'absent' &&
        !DIGEST_RE.test(operation.expected_revision)
      ) {
        throw oracleErrorV2('RUN_STORE_REVISION_INVALID', 'expected revision is invalid');
      }
      canonicalBase64(
        operation.bytes_base64,
        16_777_216,
        'RUN_STORE_BOUND_INVALID',
        'bytes_base64',
      );
    } else {
      if (
        operation.expected_revision !== 'absent' &&
        !DIGEST_RE.test(operation.expected_revision)
      ) {
        throw oracleErrorV2('RUN_STORE_REVISION_INVALID', 'expected revision is invalid');
      }
      safeInteger(
        operation.expected_byte_length,
        0,
        67_108_864,
        'RUN_STORE_BOUND_INVALID',
        'expected_byte_length',
      );
      safeInteger(
        operation.max_file_bytes,
        1,
        67_108_864,
        'RUN_STORE_BOUND_INVALID',
        'max_file_bytes',
      );
      const frame = canonicalBase64(
        operation.frame_base64,
        1_048_700,
        'RUN_STORE_FRAME_INVALID',
        'frame_base64',
      );
      validateCcmjFrame(frame);
      if (operation.expected_byte_length + frame.length > operation.max_file_bytes) {
        throw oracleErrorV2('RUN_STORE_BOUND_INVALID', 'append exceeds max_file_bytes');
      }
    }
  }
  return operation;
}

export function operationDigestV2(operation) {
  return sha256V2(canonicalJsonV2(operation));
}

export function validateCapabilityV2(capability, authorityId, phase) {
  if (capability?.schema === 'ccm/supervisor-cwd-storage-capability/v1') {
    throw oracleErrorV2('RUN_STORE_CAPABILITY_VERSION', 'V1 write-only capability is underpowered');
  }
  exactKeys(capability, CAPABILITY_KEYS, 'RUN_STORE_CAPABILITY_SHAPE', 'capability');
  if (
    capability.schema !== 'ccm/run-store-capability/v2' ||
    capability.authority_id !== authorityId ||
    capability.assurance !== 'kernel-cwd-object-v1' ||
    capability.phase !== phase ||
    typeof capability.execute !== 'function'
  ) {
    throw oracleErrorV2('RUN_STORE_CAPABILITY_SHAPE', 'capability contract mismatch');
  }
  return capability;
}

function validateExecutionIdentity(execution, authorityId, operation) {
  if (
    execution.authority_id !== authorityId ||
    execution.operation_id !== operation.operation_id ||
    execution.operation_digest !== operationDigestV2(operation) ||
    execution.kind !== operation.kind
  ) {
    throw oracleErrorV2('RUN_STORE_RESULT_FORGED', 'execution is not bound to authority/operation');
  }
}

export function createReadExecutionV2(authorityId, operation, bytes) {
  if (bytes === null) {
    return {
      schema: 'ccm/run-store-read-result/v2',
      authority_id: authorityId,
      operation_id: operation.operation_id,
      operation_digest: operationDigestV2(operation),
      kind: operation.kind,
      outcome: 'missing',
      bytes_base64: null,
      byte_length: 0,
      content_digest: null,
      revision: null,
    };
  }
  return {
    schema: 'ccm/run-store-read-result/v2',
    authority_id: authorityId,
    operation_id: operation.operation_id,
    operation_digest: operationDigestV2(operation),
    kind: operation.kind,
    outcome: 'found',
    bytes_base64: bytesBase64(bytes),
    byte_length: bytes.length,
    content_digest: sha256V2(bytes),
    revision: sha256V2(bytes),
  };
}

export function createListExecutionV2(authorityId, operation, entries) {
  const sorted = [...entries].sort((left, right) =>
    Buffer.from(left.name).compare(Buffer.from(right.name)),
  );
  return {
    schema: 'ccm/run-store-list-result/v2',
    authority_id: authorityId,
    operation_id: operation.operation_id,
    operation_digest: operationDigestV2(operation),
    kind: operation.kind,
    outcome: 'found',
    entries: sorted,
    entry_count: sorted.length,
    entries_digest: sha256V2(canonicalJsonV2(sorted)),
  };
}

export function createMutationReceiptV2(
  authorityId,
  operation,
  { outcome = 'committed', beforeRevision, afterRevision, byteLength },
) {
  return {
    schema: 'ccm/run-store-mutation-receipt/v2',
    authority_id: authorityId,
    operation_id: operation.operation_id,
    operation_digest: operationDigestV2(operation),
    kind: operation.kind,
    outcome,
    before_revision: beforeRevision,
    after_revision: afterRevision,
    byte_length: byteLength,
    durability: {
      schema: 'ccm/run-store-durability-proof/v1',
      file: 'synced',
      directory: 'synced',
    },
  };
}

export function validateExecutionV2(execution, authorityId, operation) {
  if (operation.kind === 'read-file') {
    exactKeys(execution, READ_RESULT_KEYS, 'RUN_STORE_RESULT_SHAPE', 'read result');
    validateExecutionIdentity(execution, authorityId, operation);
    if (execution.schema !== 'ccm/run-store-read-result/v2') {
      throw oracleErrorV2('RUN_STORE_RESULT_SHAPE', 'read result schema mismatch');
    }
    if (execution.outcome === 'missing') {
      if (
        execution.bytes_base64 !== null ||
        execution.byte_length !== 0 ||
        execution.content_digest !== null ||
        execution.revision !== null
      ) {
        throw oracleErrorV2('RUN_STORE_RESULT_FORGED', 'missing read payload is inconsistent');
      }
    } else if (execution.outcome === 'found') {
      const bytes = canonicalBase64(
        execution.bytes_base64,
        operation.max_bytes,
        'RUN_STORE_RESULT_FORGED',
        'read bytes',
      );
      if (
        execution.byte_length !== bytes.length ||
        execution.content_digest !== sha256V2(bytes) ||
        execution.revision !== sha256V2(bytes)
      ) {
        throw oracleErrorV2('RUN_STORE_RESULT_FORGED', 'read payload digest/length mismatch');
      }
    } else {
      throw oracleErrorV2('RUN_STORE_RESULT_SHAPE', 'read outcome is invalid');
    }
    return execution;
  }
  if (operation.kind === 'list-directory') {
    exactKeys(execution, LIST_RESULT_KEYS, 'RUN_STORE_RESULT_SHAPE', 'list result');
    validateExecutionIdentity(execution, authorityId, operation);
    if (
      execution.schema !== 'ccm/run-store-list-result/v2' ||
      !['found', 'missing'].includes(execution.outcome) ||
      !Array.isArray(execution.entries) ||
      execution.entries.length > operation.max_entries ||
      execution.entry_count !== execution.entries.length
    ) {
      throw oracleErrorV2('RUN_STORE_RESULT_FORGED', 'list result shape/count mismatch');
    }
    let previous = null;
    for (const entry of execution.entries) {
      exactKeys(entry, ENTRY_KEYS, 'RUN_STORE_RESULT_FORGED', 'list entry');
      if (
        !SEGMENT_RE.test(entry.name) ||
        Buffer.byteLength(entry.name) > operation.max_name_bytes ||
        !['file', 'directory'].includes(entry.type) ||
        !Number.isSafeInteger(entry.byte_length) ||
        entry.byte_length < 0 ||
        (previous !== null && Buffer.from(previous).compare(Buffer.from(entry.name)) >= 0)
      ) {
        throw oracleErrorV2('RUN_STORE_RESULT_FORGED', 'list entry is invalid or unsorted');
      }
      previous = entry.name;
    }
    if (execution.entries_digest !== sha256V2(canonicalJsonV2(execution.entries))) {
      throw oracleErrorV2('RUN_STORE_RESULT_FORGED', 'list entries digest mismatch');
    }
    if (execution.outcome === 'missing' && execution.entries.length !== 0) {
      throw oracleErrorV2('RUN_STORE_RESULT_FORGED', 'missing list must be empty');
    }
    return execution;
  }
  if (!execution || typeof execution !== 'object' || !('durability' in execution)) {
    throw oracleErrorV2('RUN_STORE_RECEIPT_DURABILITY', 'mutation receipt lacks durability proof');
  }
  exactKeys(execution, RECEIPT_KEYS, 'RUN_STORE_RECEIPT_SHAPE', 'mutation receipt');
  validateExecutionIdentity(execution, authorityId, operation);
  exactKeys(
    execution.durability,
    DURABILITY_KEYS,
    'RUN_STORE_RECEIPT_DURABILITY',
    'durability proof',
  );
  if (
    execution.schema !== 'ccm/run-store-mutation-receipt/v2' ||
    !['committed', 'already-committed'].includes(execution.outcome) ||
    (execution.before_revision !== 'absent' && !DIGEST_RE.test(execution.before_revision)) ||
    !DIGEST_RE.test(execution.after_revision) ||
    !Number.isSafeInteger(execution.byte_length) ||
    execution.byte_length < 0 ||
    execution.durability.schema !== 'ccm/run-store-durability-proof/v1' ||
    execution.durability.file !== 'synced' ||
    execution.durability.directory !== 'synced'
  ) {
    throw oracleErrorV2('RUN_STORE_RECEIPT_DURABILITY', 'mutation receipt is unsafe or forged');
  }
  if (operation.kind === 'create-file-no-replace') {
    const desired = Buffer.from(operation.bytes_base64, 'base64');
    if (
      execution.outcome !== 'committed' ||
      execution.before_revision !== 'absent' ||
      execution.after_revision !== sha256V2(desired) ||
      execution.byte_length !== desired.length
    ) {
      throw oracleErrorV2(
        'RUN_STORE_RESULT_FORGED',
        'mutation receipt does not bind desired bytes',
      );
    }
  } else if (operation.kind === 'replace-file-cas') {
    const desired = Buffer.from(operation.bytes_base64, 'base64');
    const desiredRevision = sha256V2(desired);
    const expectedBefore =
      execution.outcome === 'already-committed' ? desiredRevision : operation.expected_revision;
    if (
      execution.before_revision !== expectedBefore ||
      execution.after_revision !== desiredRevision ||
      execution.byte_length !== desired.length
    ) {
      throw oracleErrorV2(
        'RUN_STORE_RESULT_FORGED',
        'replace receipt does not bind expected and desired revisions',
      );
    }
  } else {
    const frame = Buffer.from(operation.frame_base64, 'base64');
    if (
      execution.before_revision !== operation.expected_revision ||
      execution.byte_length !== operation.expected_byte_length + frame.length ||
      execution.after_revision === execution.before_revision
    ) {
      throw oracleErrorV2(
        'RUN_STORE_RESULT_FORGED',
        'append receipt does not bind expected prefix and complete frame length',
      );
    }
  }
  return execution;
}

export function validateTraceV2(trace, expected) {
  exactKeys(trace, TRACE_KEYS, 'RUN_STORE_CAPABILITY_BYPASS', 'trace');
  if (
    trace.schema !== 'ccm/run-store-oracle-trace/v2' ||
    trace.authority_id !== expected.authorityId ||
    trace.consumer_invocations !== expected.consumerInvocations ||
    trace.capability_invocations !== expected.capabilityInvocations ||
    canonicalJsonV2(trace.operation_digests) !== canonicalJsonV2(expected.operationDigests)
  ) {
    throw oracleErrorV2('RUN_STORE_CAPABILITY_BYPASS', 'consumer/capability trace mismatch');
  }
  return trace;
}

export function createCcmjFrame(payload) {
  const bytes = Buffer.from(payload);
  const length = bytes.length.toString(16).padStart(8, '0');
  const digest = sha256V2(bytes).slice('sha256:'.length);
  return Buffer.concat([
    Buffer.from(`CCMJ/1 ${length} ${digest}\n`, 'ascii'),
    bytes,
    Buffer.from('\n'),
  ]);
}
