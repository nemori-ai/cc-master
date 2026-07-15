import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  bytesBase64,
  canonicalJsonV2,
  createListExecutionV2,
  createMutationReceiptV2,
  createReadExecutionV2,
  decodeAndValidateAuthorityV2,
  operationDigestV2,
  oracleErrorV2,
  sha256V2,
  validateOperationV2,
} from './run-store-capability-v2-contract.mjs';

function syncPath(path) {
  const flags =
    constants.O_RDONLY |
    (constants.O_DIRECTORY && lstatSync(path).isDirectory() ? constants.O_DIRECTORY : 0);
  const fd = openSync(path, flags);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function assertDirectory(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw oracleErrorV2('RUN_STORE_PATH_SYMLINK', `symlink: ${path}`);
  if (!stat.isDirectory()) throw oracleErrorV2('RUN_STORE_PATH_TYPE', `not a directory: ${path}`);
}

function ensureParent(segments) {
  let current = '.';
  for (const segment of segments.slice(0, -1)) {
    const next = join(current, segment);
    try {
      assertDirectory(next);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      mkdirSync(next, { mode: 0o700 });
      assertDirectory(next);
      syncPath(current);
    }
    current = next;
  }
  return current;
}

function inspectExisting(segments) {
  let current = '.';
  for (let index = 0; index < segments.length; index++) {
    current = join(current, segments[index]);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw oracleErrorV2('RUN_STORE_PATH_SYMLINK', `symlink: ${current}`);
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw oracleErrorV2('RUN_STORE_PATH_TYPE', `not a directory: ${current}`);
    }
  }
  return lstatSync(current);
}

function readRegular(segments, maxBytes) {
  const stat = inspectExisting(segments);
  if (stat === null) return null;
  if (!stat.isFile()) throw oracleErrorV2('RUN_STORE_PATH_TYPE', 'target is not a regular file');
  if (stat.size > maxBytes) throw oracleErrorV2('RUN_STORE_READ_BOUND', 'file exceeds max_bytes');
  const path = join(...segments);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    if (!fstatSync(fd).isFile()) throw oracleErrorV2('RUN_STORE_PATH_TYPE', 'target changed type');
    const bytes = readFileSync(fd);
    if (bytes.length > maxBytes)
      throw oracleErrorV2('RUN_STORE_READ_BOUND', 'file exceeds max_bytes');
    return bytes;
  } finally {
    closeSync(fd);
  }
}

function listDirectory(authorityId, operation) {
  const stat = inspectExisting(operation.segments);
  if (stat === null) {
    const execution = createListExecutionV2(authorityId, operation, []);
    return { ...execution, outcome: 'missing' };
  }
  if (!stat.isDirectory())
    throw oracleErrorV2('RUN_STORE_PATH_TYPE', 'list target is not a directory');
  const path = join(...operation.segments);
  const names = readdirSync(path);
  if (names.length > operation.max_entries) {
    throw oracleErrorV2('RUN_STORE_LIST_BOUND', 'directory exceeds max_entries');
  }
  const entries = names.map((name) => {
    if (Buffer.byteLength(name) > operation.max_name_bytes) {
      throw oracleErrorV2('RUN_STORE_LIST_BOUND', 'entry exceeds max_name_bytes');
    }
    const entryStat = lstatSync(join(path, name));
    if (entryStat.isSymbolicLink()) {
      throw oracleErrorV2('RUN_STORE_PATH_SYMLINK', `symlink entry: ${name}`);
    }
    if (!entryStat.isFile() && !entryStat.isDirectory()) {
      throw oracleErrorV2('RUN_STORE_PATH_TYPE', `unsupported entry type: ${name}`);
    }
    return {
      name,
      type: entryStat.isDirectory() ? 'directory' : 'file',
      byte_length: entryStat.isFile() ? entryStat.size : 0,
    };
  });
  return createListExecutionV2(authorityId, operation, entries);
}

function writeAtomic(path, bytes) {
  const parent = dirname(path);
  const temp = join(parent, `.${path.split('/').at(-1)}.${process.pid}.${randomUUID()}.tmp`);
  let published = false;
  try {
    const fd = openSync(temp, 'wx', 0o600);
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
    published = true;
    syncPath(parent);
  } finally {
    if (!published && existsSync(temp)) {
      rmSync(temp, { force: true });
      syncPath(parent);
    }
  }
}

function createNoReplace(authorityId, operation) {
  const parent = ensureParent(operation.segments);
  const path = join(...operation.segments);
  const bytes = Buffer.from(operation.bytes_base64, 'base64');
  let fd;
  try {
    fd = openSync(path, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw oracleErrorV2('RUN_STORE_NO_REPLACE', 'target already exists', {
        effect: 'none',
      });
    }
    throw error;
  }
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  syncPath(parent);
  return createMutationReceiptV2(authorityId, operation, {
    beforeRevision: 'absent',
    afterRevision: sha256V2(bytes),
    byteLength: bytes.length,
  });
}

function replaceCas(authorityId, operation) {
  ensureParent(operation.segments);
  const path = join(...operation.segments);
  const current = readRegular(operation.segments, 16_777_216);
  const beforeRevision = current === null ? 'absent' : sha256V2(current);
  const desired = Buffer.from(operation.bytes_base64, 'base64');
  const desiredRevision = sha256V2(desired);
  if (beforeRevision === desiredRevision) {
    return createMutationReceiptV2(authorityId, operation, {
      outcome: 'already-committed',
      beforeRevision,
      afterRevision: desiredRevision,
      byteLength: desired.length,
    });
  }
  if (beforeRevision !== operation.expected_revision) {
    throw oracleErrorV2('RUN_STORE_REVISION_CONFLICT', 'replace revision conflict', {
      effect: 'none',
    });
  }
  writeAtomic(path, desired);
  return createMutationReceiptV2(authorityId, operation, {
    beforeRevision,
    afterRevision: desiredRevision,
    byteLength: desired.length,
  });
}

function assertCompleteJournal(bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const newline = bytes.indexOf(0x0a, offset);
    if (newline < 0) throw oracleErrorV2('RUN_STORE_TORN_TAIL', 'journal header is torn');
    const header = bytes.subarray(offset, newline).toString('ascii');
    const match = /^CCMJ\/1 ([a-f0-9]{8}) ([a-f0-9]{64})$/u.exec(header);
    if (!match) throw oracleErrorV2('RUN_STORE_TORN_TAIL', 'journal header is invalid');
    const payloadLength = Number.parseInt(match[1], 16);
    const end = newline + 1 + payloadLength;
    if (end >= bytes.length || bytes[end] !== 0x0a) {
      throw oracleErrorV2('RUN_STORE_TORN_TAIL', 'journal payload is torn');
    }
    const payload = bytes.subarray(newline + 1, end);
    if (sha256V2(payload).slice('sha256:'.length) !== match[2]) {
      throw oracleErrorV2('RUN_STORE_TORN_TAIL', 'journal payload digest is invalid');
    }
    offset = end + 1;
  }
}

function appendFrameCas(authorityId, operation) {
  ensureParent(operation.segments);
  const path = join(...operation.segments);
  const current = readRegular(operation.segments, operation.max_file_bytes) ?? Buffer.alloc(0);
  assertCompleteJournal(current);
  const frame = Buffer.from(operation.frame_base64, 'base64');
  const beforeRevision = current.length === 0 ? 'absent' : sha256V2(current);
  if (
    current.length === operation.expected_byte_length + frame.length &&
    current.subarray(-frame.length).equals(frame)
  ) {
    const prefix = current.subarray(0, operation.expected_byte_length);
    const prefixRevision = prefix.length === 0 ? 'absent' : sha256V2(prefix);
    if (prefixRevision === operation.expected_revision) {
      return createMutationReceiptV2(authorityId, operation, {
        outcome: 'already-committed',
        beforeRevision: prefixRevision,
        afterRevision: sha256V2(current),
        byteLength: current.length,
      });
    }
  }
  if (
    current.length !== operation.expected_byte_length ||
    beforeRevision !== operation.expected_revision
  ) {
    throw oracleErrorV2('RUN_STORE_REVISION_CONFLICT', 'append prefix conflict', {
      effect: 'none',
    });
  }
  const desired = Buffer.concat([current, frame]);
  writeAtomic(path, desired);
  return createMutationReceiptV2(authorityId, operation, {
    beforeRevision,
    afterRevision: sha256V2(desired),
    byteLength: desired.length,
  });
}

function capability(authority, execute) {
  return {
    schema: 'ccm/run-store-capability/v2',
    authority_id: authority.authority_id,
    assurance: 'kernel-cwd-object-v1',
    phase: authority.grant.phase,
    execute,
  };
}

export function consumeKnownGoodRunStoreCapabilityV2({ env, cwdStat }) {
  const authority = decodeAndValidateAuthorityV2({ env, cwdStat });
  return capability(authority, (rawOperation) => {
    const operation = validateOperationV2(rawOperation, authority.grant);
    if (operation.kind === 'read-file') {
      return createReadExecutionV2(
        authority.authority_id,
        operation,
        readRegular(operation.segments, operation.max_bytes),
      );
    }
    if (operation.kind === 'list-directory') {
      return listDirectory(authority.authority_id, operation);
    }
    if (operation.kind === 'create-file-no-replace') {
      return createNoReplace(authority.authority_id, operation);
    }
    if (operation.kind === 'replace-file-cas') {
      return replaceCas(authority.authority_id, operation);
    }
    return appendFrameCas(authority.authority_id, operation);
  });
}

export function consumeForgedResultCounterfeitV2({ env, cwdStat }) {
  const authority = decodeAndValidateAuthorityV2({ env, cwdStat });
  return capability(authority, (rawOperation) => {
    const operation = validateOperationV2(rawOperation, authority.grant);
    return {
      ...createReadExecutionV2(authority.authority_id, operation, Buffer.from('forged')),
      byte_length: 999,
    };
  });
}

export function consumeForgedBeforeRevisionCounterfeitV2({ env, cwdStat }) {
  const authority = decodeAndValidateAuthorityV2({ env, cwdStat });
  return capability(authority, (rawOperation) => {
    const operation = validateOperationV2(rawOperation, authority.grant);
    const desired = Buffer.from(operation.bytes_base64, 'base64');
    return createMutationReceiptV2(authority.authority_id, operation, {
      beforeRevision: `sha256:${'b'.repeat(64)}`,
      afterRevision: sha256V2(desired),
      byteLength: desired.length,
    });
  });
}

export function consumeForgedAppendReceiptCounterfeitV2({ env, cwdStat }) {
  const authority = decodeAndValidateAuthorityV2({ env, cwdStat });
  return capability(authority, (rawOperation) => {
    const operation = validateOperationV2(rawOperation, authority.grant);
    return createMutationReceiptV2(authority.authority_id, operation, {
      beforeRevision: operation.expected_revision,
      afterRevision: `sha256:${'c'.repeat(64)}`,
      byteLength: 1,
    });
  });
}

export function consumeNoWriteSyncedReceiptCounterfeitV2({ env, cwdStat }) {
  const authority = decodeAndValidateAuthorityV2({ env, cwdStat });
  return capability(authority, (rawOperation) => {
    const operation = validateOperationV2(rawOperation, authority.grant);
    const desired = Buffer.from(operation.bytes_base64, 'base64');
    return createMutationReceiptV2(authority.authority_id, operation, {
      beforeRevision: 'absent',
      afterRevision: sha256V2(desired),
      byteLength: desired.length,
    });
  });
}

export function consumeWrongTargetSyncCounterfeitV2({ env, cwdStat }) {
  const authority = decodeAndValidateAuthorityV2({ env, cwdStat });
  return capability(authority, (rawOperation) => {
    const operation = validateOperationV2(rawOperation, authority.grant);
    const desired = Buffer.from(operation.bytes_base64, 'base64');
    const parent = ensureParent(operation.segments);
    writeFileSync(join(...operation.segments), desired, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(parent, 'unrelated-sync-target'), 'x', { flag: 'w', mode: 0o600 });
    syncPath(join(parent, 'unrelated-sync-target'));
    syncPath(parent);
    return createMutationReceiptV2(authority.authority_id, operation, {
      beforeRevision: 'absent',
      afterRevision: sha256V2(desired),
      byteLength: desired.length,
    });
  });
}

export function consumePreSyncThenFinalWriteCounterfeitV2({ env, cwdStat }) {
  const authority = decodeAndValidateAuthorityV2({ env, cwdStat });
  return capability(authority, (rawOperation) => {
    const operation = validateOperationV2(rawOperation, authority.grant);
    const path = join(...operation.segments);
    const parent = dirname(path);
    const current = readRegular(operation.segments, 16_777_216);
    const beforeRevision = current === null ? 'absent' : sha256V2(current);
    if (beforeRevision !== operation.expected_revision) {
      throw oracleErrorV2('RUN_STORE_REVISION_CONFLICT', 'counterfeit pre-sync revision conflict', {
        effect: 'none',
      });
    }

    // Sync the exact current target and exact parent while the target still contains old bytes.
    // The final write deliberately has no later target-file or parent-directory sync.
    syncPath(path);
    syncPath(parent);
    const desired = Buffer.from(operation.bytes_base64, 'base64');
    writeFileSync(path, desired, { flag: 'w', mode: 0o600 });
    return createMutationReceiptV2(authority.authority_id, operation, {
      beforeRevision,
      afterRevision: sha256V2(desired),
      byteLength: desired.length,
    });
  });
}

export function consumePostPublicationFailureCounterfeitV2({ env, cwdStat }) {
  const authority = decodeAndValidateAuthorityV2({ env, cwdStat });
  return capability(authority, (rawOperation) => {
    const operation = validateOperationV2(rawOperation, authority.grant);
    ensureParent(operation.segments);
    writeFileSync(join(...operation.segments), Buffer.from(operation.bytes_base64, 'base64'), {
      flag: 'w',
      mode: 0o600,
    });
    throw oracleErrorV2(
      'RUN_STORE_FALSE_SAFE',
      'counterfeit failure after target publication started',
      { effect: 'none', retry: 'never' },
    );
  });
}

export function consumeWrongAppendPrefixCounterfeitV2({ env, cwdStat }) {
  const authority = decodeAndValidateAuthorityV2({ env, cwdStat });
  return capability(authority, (rawOperation) => {
    const operation = validateOperationV2(rawOperation, authority.grant);
    const current = readRegular(operation.segments, operation.max_file_bytes) ?? Buffer.alloc(0);
    const frame = Buffer.from(operation.frame_base64, 'base64');
    const desired = Buffer.concat([current, frame]);
    writeAtomic(join(...operation.segments), desired);
    return createMutationReceiptV2(authority.authority_id, operation, {
      beforeRevision: operation.expected_revision,
      afterRevision: sha256V2(desired),
      byteLength: desired.length,
    });
  });
}

export function consumePartialAppendCounterfeitV2({ env, cwdStat }) {
  const authority = decodeAndValidateAuthorityV2({ env, cwdStat });
  return capability(authority, (rawOperation) => {
    const operation = validateOperationV2(rawOperation, authority.grant);
    const frame = Buffer.from(operation.frame_base64, 'base64');
    ensureParent(operation.segments);
    writeFileSync(join(...operation.segments), frame.subarray(0, Math.floor(frame.length / 2)), {
      flag: 'w',
      mode: 0o600,
    });
    return createMutationReceiptV2(authority.authority_id, operation, {
      beforeRevision: 'absent',
      afterRevision: sha256V2(frame),
      byteLength: frame.length,
    });
  });
}

export function consumeMissingDurabilityCounterfeitV2({ env, cwdStat }) {
  const authority = decodeAndValidateAuthorityV2({ env, cwdStat });
  return capability(authority, (rawOperation) => {
    const operation = validateOperationV2(rawOperation, authority.grant);
    const bytes = Buffer.from(operation.bytes_base64, 'base64');
    const { durability: _durability, ...receipt } = createMutationReceiptV2(
      authority.authority_id,
      operation,
      {
        beforeRevision: 'absent',
        afterRevision: sha256V2(bytes),
        byteLength: bytes.length,
      },
    );
    return receipt;
  });
}

export function consumeUnsafeDurabilityCounterfeitV2({ env, cwdStat }) {
  const authority = decodeAndValidateAuthorityV2({ env, cwdStat });
  return capability(authority, (rawOperation) => {
    const operation = validateOperationV2(rawOperation, authority.grant);
    const bytes = Buffer.from(operation.bytes_base64, 'base64');
    const receipt = createMutationReceiptV2(authority.authority_id, operation, {
      beforeRevision: 'absent',
      afterRevision: sha256V2(bytes),
      byteLength: bytes.length,
    });
    return { ...receipt, durability: { ...receipt.durability, directory: 'not-synced' } };
  });
}

export function executeBypassCounterfeitV2({ env, cwdStat, operations }) {
  const authority = decodeAndValidateAuthorityV2({ env, cwdStat });
  const executions = operations.map((rawOperation) => {
    const operation = validateOperationV2(rawOperation, authority.grant);
    const bytes = Buffer.from(operation.bytes_base64, 'base64');
    ensureParent(operation.segments);
    writeFileSync(join(...operation.segments), bytes, { flag: 'wx', mode: 0o600 });
    return createMutationReceiptV2(authority.authority_id, operation, {
      beforeRevision: 'absent',
      afterRevision: sha256V2(bytes),
      byteLength: bytes.length,
    });
  });
  return {
    executions,
    trace: {
      schema: 'ccm/run-store-oracle-trace/v2',
      authority_id: authority.authority_id,
      consumer_invocations: 0,
      capability_invocations: 0,
      operation_digests: operations.map(operationDigestV2),
    },
  };
}

export function debugCanonicalV2(value) {
  return canonicalJsonV2(value);
}

export function debugBytesV2(value) {
  return bytesBase64(value);
}
