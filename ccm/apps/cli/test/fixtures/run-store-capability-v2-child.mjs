import fs, { existsSync, lstatSync, readFileSync, statSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { executeViaRunStoreCapabilityV2 } from './run-store-capability-v2-adapter.mjs';
import {
  identityFromStatV2,
  oracleErrorV2,
  sha256V2,
} from './run-store-capability-v2-contract.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const productionModule = join(here, '..', '..', 'src', 'run-store-capability-v2.ts');

const durabilityEvidence = {
  writes: 0,
  fileSyncs: 0,
  directorySyncs: 0,
  writesByIdentity: new Map(),
  fileSyncsByIdentity: new Map(),
  directorySyncsByIdentity: new Map(),
};
const originalWriteFileSync = fs.writeFileSync;
const originalWriteSync = fs.writeSync;
const originalFsyncSync = fs.fsyncSync;
const originalFstatSync = fs.fstatSync;
const originalLstatSync = fs.lstatSync;

function objectIdentity(stat) {
  return `${String(stat.dev)}:${String(stat.ino)}`;
}

function bump(map, identity) {
  map.set(identity, (map.get(identity) ?? 0) + 1);
}

function identityForWriteTarget(target) {
  try {
    return objectIdentity(
      typeof target === 'number' ? originalFstatSync(target) : originalLstatSync(target),
    );
  } catch {
    return null;
  }
}

function count(map, identity) {
  return identity === null ? 0 : (map.get(identity) ?? 0);
}

fs.writeFileSync = (...args) => {
  const result = originalWriteFileSync(...args);
  durabilityEvidence.writes += 1;
  const identity = identityForWriteTarget(args[0]);
  if (identity !== null) bump(durabilityEvidence.writesByIdentity, identity);
  return result;
};
fs.writeSync = (...args) => {
  const result = originalWriteSync(...args);
  durabilityEvidence.writes += 1;
  const identity = identityForWriteTarget(args[0]);
  if (identity !== null) bump(durabilityEvidence.writesByIdentity, identity);
  return result;
};
fs.fsyncSync = (fd) => {
  const stat = originalFstatSync(fd);
  const result = originalFsyncSync(fd);
  const identity = objectIdentity(stat);
  if (stat.isDirectory()) {
    durabilityEvidence.directorySyncs += 1;
    bump(durabilityEvidence.directorySyncsByIdentity, identity);
  } else {
    durabilityEvidence.fileSyncs += 1;
    bump(durabilityEvidence.fileSyncsByIdentity, identity);
  }
  return result;
};
syncBuiltinESMExports();

function identityAt(path) {
  try {
    return objectIdentity(originalLstatSync(path));
  } catch {
    return null;
  }
}

function observeDurability(operation) {
  const target = join(...operation.segments);
  const targetIdentity = identityAt(target);
  const parentDirectoryIdentity = identityAt(dirname(target));
  return {
    writes: durabilityEvidence.writes,
    fileSyncs: durabilityEvidence.fileSyncs,
    directorySyncs: durabilityEvidence.directorySyncs,
    targetIdentity,
    parentDirectoryIdentity,
    targetWrites: count(durabilityEvidence.writesByIdentity, targetIdentity),
    targetFileSyncs: count(durabilityEvidence.fileSyncsByIdentity, targetIdentity),
    parentDirectorySyncs: count(
      durabilityEvidence.directorySyncsByIdentity,
      parentDirectoryIdentity,
    ),
  };
}

let fixtureConsumers;

async function consumers() {
  fixtureConsumers ??= await import('./run-store-capability-v2-consumers.mjs');
  return fixtureConsumers;
}

function sendAndDisconnect(message) {
  if (typeof process.send !== 'function') return;
  process.send(message, () => process.disconnect());
}

async function productionConsumer() {
  if (!existsSync(productionModule)) {
    throw oracleErrorV2(
      'RUN_STORE_CAPABILITY_PRODUCTION_MISSING',
      'production RunStoreCapability v2 consumer is absent on latest main',
    );
  }
  const implementation = await import(pathToFileURL(productionModule).href);
  if (typeof implementation.consumeRunStoreCapabilityV2 !== 'function') {
    throw oracleErrorV2(
      'RUN_STORE_CAPABILITY_PRODUCTION_MISSING',
      'production module does not export consumeRunStoreCapabilityV2',
    );
  }
  return implementation.consumeRunStoreCapabilityV2;
}

async function consumerFor(mode) {
  const fixtures = await consumers();
  if (mode === 'known-good') return fixtures.consumeKnownGoodRunStoreCapabilityV2;
  if (mode === 'forged-result') return fixtures.consumeForgedResultCounterfeitV2;
  if (mode === 'forged-before-revision') {
    return fixtures.consumeForgedBeforeRevisionCounterfeitV2;
  }
  if (mode === 'forged-append-receipt') {
    return fixtures.consumeForgedAppendReceiptCounterfeitV2;
  }
  if (mode === 'no-write-synced-receipt') {
    return fixtures.consumeNoWriteSyncedReceiptCounterfeitV2;
  }
  if (mode === 'wrong-target-sync') {
    return fixtures.consumeWrongTargetSyncCounterfeitV2;
  }
  if (mode === 'post-publication-failure') {
    return fixtures.consumePostPublicationFailureCounterfeitV2;
  }
  if (mode === 'partial-append') return fixtures.consumePartialAppendCounterfeitV2;
  if (mode === 'wrong-append-prefix') {
    return fixtures.consumeWrongAppendPrefixCounterfeitV2;
  }
  if (mode === 'missing-durability') return fixtures.consumeMissingDurabilityCounterfeitV2;
  if (mode === 'unsafe-durability') return fixtures.consumeUnsafeDurabilityCounterfeitV2;
  if (mode === 'production') return productionConsumer();
  throw oracleErrorV2('RUN_STORE_ORACLE_MODE', `unsupported mode: ${mode}`);
}

function observeMutation(operation, execution) {
  if (execution.outcome !== 'committed' && execution.outcome !== 'already-committed') return;
  let bytes;
  try {
    bytes = readFileSync(join(...operation.segments));
  } catch (error) {
    throw oracleErrorV2(
      'RUN_STORE_COMMITTED_OBSERVATION',
      `committed target cannot be read: ${error.message}`,
      { effect: 'unknown', retry: 'reconcile-first' },
    );
  }
  const stat = lstatSync(join(...operation.segments));
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) {
    throw oracleErrorV2('RUN_STORE_COMMITTED_OBSERVATION', 'committed target is not a 0600 file', {
      effect: 'unknown',
      retry: 'reconcile-first',
    });
  }
  if (operation.kind === 'append-ccmj-frame-cas') {
    const frame = Buffer.from(operation.frame_base64, 'base64');
    const prefix = bytes.subarray(0, operation.expected_byte_length);
    const prefixRevision = prefix.length === 0 ? 'absent' : sha256V2(prefix);
    if (
      bytes.length !== operation.expected_byte_length + frame.length ||
      !bytes.subarray(-frame.length).equals(frame) ||
      prefixRevision !== operation.expected_revision
    ) {
      throw oracleErrorV2(
        'RUN_STORE_COMMITTED_OBSERVATION',
        'committed append does not bind the actual prefix revision and complete frame',
        { effect: 'unknown', retry: 'reconcile-first' },
      );
    }
  } else {
    const desired = Buffer.from(operation.bytes_base64, 'base64');
    if (!bytes.equals(desired)) {
      throw oracleErrorV2(
        'RUN_STORE_COMMITTED_OBSERVATION',
        'committed target bytes do not match the requested bytes',
        { effect: 'unknown', retry: 'reconcile-first' },
      );
    }
  }
  if (bytes.length !== execution.byte_length || sha256V2(bytes) !== execution.after_revision) {
    throw oracleErrorV2(
      'RUN_STORE_COMMITTED_OBSERVATION',
      'committed target does not match the receipt revision and length',
      { effect: 'unknown', retry: 'reconcile-first' },
    );
  }
}

const mode = process.env.CCM_RUN_STORE_V2_CONSUMER_MODE;
if (typeof process.send === 'function') {
  process.send({ type: 'run-store-v2-ready', cwd_identity: identityFromStatV2(statSync('.')) });
}

process.on('message', async (message) => {
  if (message?.type !== 'execute-operations') return;
  try {
    const cwdStat = statSync('.');
    const outcome =
      mode === 'adapter-bypass'
        ? (await consumers()).executeBypassCounterfeitV2({
            env: process.env,
            cwdStat,
            operations: message.operations,
          })
        : await executeViaRunStoreCapabilityV2({
            consume: await consumerFor(mode),
            env: process.env,
            cwdStat,
            rawOperations: message.operations,
            observeDurability,
            observeMutation,
          });
    sendAndDisconnect({ type: 'run-store-v2-result', ...outcome });
    process.exitCode = 0;
  } catch (error) {
    sendAndDisconnect({
      type: 'run-store-v2-error',
      error: {
        schema: 'ccm/run-store-error/v2',
        code: error?.code ?? 'RUN_STORE_ORACLE_UNTYPED',
        authority_id: error?.authority_id ?? null,
        operation_id: error?.operation_id ?? null,
        effect: error?.effect ?? 'none',
        retry: error?.retry ?? (error?.effect === 'unknown' ? 'reconcile-first' : 'never'),
        message: error instanceof Error ? error.message : String(error),
      },
    });
    process.exitCode = 1;
  }
});
