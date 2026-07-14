// Explicit promotion contract for design_docs/2026-07-13-cross-harness-quota-admission-contract.md.
// The historical .red.ts filename intentionally stays outside the default test glob; both tracked
// commands below are release gates for the bounded local runtime:
//   CCM_QUOTA_ADMISSION_FIXTURES_ONLY=1 node --import tsx test/quota-admission-contract.red.ts
//   node --import tsx test/quota-admission-contract.red.ts

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  watch,
  writeFileSync,
} from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { QuotaEffectBoundary } from '@ccm/engine';
import { run } from '../src/router.js';

interface ContractCase extends Record<string, unknown> {
  name: string;
  spec_ids: string[];
  input: Record<string, unknown>;
  expected: unknown;
}

interface ContractFixture extends Record<string, unknown> {
  schema: string;
  cases: ContractCase[];
}

interface QuotaEngineContract {
  evaluateQuotaObservation: (input: Readonly<Record<string, unknown>>) => unknown;
  deriveQuotaHeadroom: (input: Readonly<Record<string, unknown>>) => unknown;
  deriveRolling24h: (input: Readonly<Record<string, unknown>>) => unknown;
  evaluateQuotaReservationTransition: (input: Readonly<Record<string, unknown>>) => unknown;
  evaluateLiveQuotaAdmission: (input: Readonly<Record<string, unknown>>) => unknown;
  evaluateQuotaOrphanAudit: (input: Readonly<Record<string, unknown>>) => unknown;
  evaluateQuotaLifecycleEffect: (input: Readonly<Record<string, unknown>>) => unknown;
  classifyQuotaError: (input: Readonly<Record<string, unknown>>) => unknown;
}

interface QuotaAdmissionStore {
  refreshObservation: (
    request: Readonly<Record<string, unknown>>,
    collect: () => Promise<Record<string, unknown>>,
  ) => unknown | Promise<unknown>;
  publishObservation: (request: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>;
  readObservation: (sourceKey: string) => unknown | Promise<unknown>;
  reserve: (request: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>;
  commitReservation: (request: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>;
  preflight: (request: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>;
  inspectAggregation: (aggregationKey: string) => unknown | Promise<unknown>;
}

interface QuotaAdmissionStoreModule {
  createQuotaAdmissionStore: (options: {
    home: string;
    filesystem?: Record<PropertyKey, unknown>;
    now?: () => Date;
  }) => QuotaAdmissionStore;
}

interface FilesystemTraceEvent {
  op: string;
  path?: string;
  from?: string;
  to?: string;
  flags?: string | number;
  mode?: number;
  kind?: 'file' | 'directory';
  code?: string;
}

// Directory fsync fault codes the durability matrix injects. EINVAL/ENOTSUP are honest
// "this filesystem does not support directory fsync" outcomes a compliant store may downgrade;
// EACCES/EPERM are hard permission failures a store must surface, never silently swallow.
type DirectorySyncFaultCode = 'EINVAL' | 'ENOTSUP' | 'EACCES' | 'EPERM';

interface DirectorySyncOutcome {
  result?: unknown;
  rejectedCode?: string;
}

interface DirectorySyncBoundary {
  name: string;
  result_field: string;
  relative_directory: string;
}

interface TreeEntry {
  path: string;
  type: 'directory' | 'file' | 'symlink' | 'other';
  mode: number;
  size: string;
  mtime_ns: string;
  ctime_ns: string;
  sha256?: string;
  target?: string;
}

interface ConcurrentWorkerPayload {
  operation: 'refresh' | 'reserve';
  request?: Record<string, unknown>;
  sourceKey?: string;
  observation?: Record<string, unknown>;
  collectorDir?: string;
  workerId?: number;
}

interface ReachabilityContractInput {
  manifestRefs: string[];
  fixtureRefs: string[];
  executionDomainRefs: string[];
  runnerRefs: string[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(HERE, 'fixtures', 'quota-admission-contract-v1');
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const SPEC_PATH = join(
  REPO_ROOT,
  'design_docs',
  '2026-07-13-cross-harness-quota-admission-contract.md',
);
const WORKER_PATH = join(FIXTURE_ROOT, 'reservation-worker.ts');
const FIXTURES_ONLY = process.env.CCM_QUOTA_ADMISSION_FIXTURES_ONLY === '1';
const FILES = [
  'admission.json',
  'concurrency.json',
  'derivation.json',
  'errors.json',
  'lifecycle-effects.json',
  'observation.json',
  'orphan.json',
  'reservation.json',
  'rolling24h.json',
  'store.json',
] as const;
const REQUIRED_COVERAGE = [
  '5h-poison',
  'account-mutation-matrix',
  'atomic-fault-visibility',
  'atomic-reservation-snapshot',
  'atomic-store',
  'auth-not-quota',
  'concurrent',
  'crash-recovery',
  'credential-scope',
  'directory-fsync-matrix',
  'duplicate',
  'expired',
  'fresh',
  'hard-stale',
  'lock-owner-unknown',
  'multi-bucket-atomic',
  'observation-conflict',
  'orphan',
  'provider-neutral',
  'same-key-10-way',
  'single-flight',
  'tight',
  'unknown',
] as const;
const ENGINE_DOMAIN_FILES = [
  'observation.json',
  'derivation.json',
  'rolling24h.json',
  'reservation.json',
  'admission.json',
  'orphan.json',
  'lifecycle-effects.json',
  'errors.json',
] as const;
const STORE_CASE_HANDLERS = new Map<string, () => Promise<void>>();
const MUTATION_EFFECTS = [
  'account_login',
  'account_logout',
  'account_switch',
  'session_switch',
  'credential_import',
  'credential_copy',
  'credential_write',
  'auth_write',
] as const;
const SOURCE_ROOTS = [
  join(REPO_ROOT, 'ccm', 'packages', 'engine', 'src'),
  join(REPO_ROOT, 'ccm', 'apps', 'cli', 'src'),
] as const;
const RETIRED_COUNTERFEIT_SEAM = join(
  REPO_ROOT,
  'ccm',
  'apps',
  'cli',
  'src',
  'quota-admission-contract.ts',
);
const TMP: string[] = [];

function assertExactReachability(input: ReachabilityContractInput): void {
  const planes = Object.entries(input) as Array<[keyof ReachabilityContractInput, string[]]>;
  const violations: string[] = [];
  for (const [name, refs] of planes) {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const ref of refs) {
      if (seen.has(ref)) duplicates.add(ref);
      seen.add(ref);
    }
    if (duplicates.size > 0) {
      violations.push(`${name} duplicates: ${[...duplicates].sort().join(', ')}`);
    }
  }

  const manifest = new Set(input.manifestRefs);
  for (const [name, refs] of planes) {
    if (name === 'manifestRefs') continue;
    const candidate = new Set(refs);
    const missing = [...manifest].filter((ref) => !candidate.has(ref)).sort();
    const extra = [...candidate].filter((ref) => !manifest.has(ref)).sort();
    if (missing.length > 0) violations.push(`${name} missing: ${missing.join(', ')}`);
    if (extra.length > 0) violations.push(`${name} extra: ${extra.join(', ')}`);
  }

  if (violations.length > 0) {
    throw new Error(`quota fixture reachability violation:\n- ${violations.join('\n- ')}`);
  }
}

afterEach(() => {
  for (const root of TMP) rmSync(root, { recursive: true, force: true });
  TMP.length = 0;
});

function tempHome(prefix: string): { root: string; home: string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  TMP.push(root);
  return { root, home };
}

function storeReservationRequest(request: Record<string, unknown>): Record<string, unknown> {
  const id = String(request.id ?? 'fixture-reservation');
  const requestedExpiry = Date.parse(String(request.expires_at ?? ''));
  return {
    ...request,
    schema: 'ccm/quota-reservation-request/v1',
    key: request.key ?? `key:${id}`,
    hash: request.hash ?? `hash:${id}`,
    state: request.state ?? 'held',
    checked_at: request.checked_at ?? new Date().toISOString(),
    expires_at:
      Number.isFinite(requestedExpiry) && requestedExpiry > Date.now()
        ? request.expires_at
        : new Date(Date.now() + 60_000).toISOString(),
    source_revision: request.source_revision ?? 'sha256:fixture-live-r1',
    attempt_id: request.attempt_id ?? `attempt:${id}`,
    candidate_id: request.candidate_id ?? 'fixture-candidate',
    account_id: request.account_id ?? 'fixture-account',
    pool_id: request.pool_id ?? 'fixture-pool',
    identity_fingerprint: request.identity_fingerprint ?? 'sha256:fixture-identity',
  };
}

async function seedReservationAuthority(
  home: string,
  request: Record<string, unknown>,
): Promise<void> {
  const module = await storeModule();
  const aggregationKeys = Array.isArray(request.aggregation_keys)
    ? request.aggregation_keys.map(String).sort()
    : [String(request.aggregation_key)];
  const capacities =
    typeof request.capacity_pct === 'number'
      ? {}
      : record(request.capacity_pct, 'reservation authority capacity');
  const capacityFor = (key: string): number =>
    typeof request.capacity_pct === 'number' ? request.capacity_pct : Number(capacities[key]);
  const accountId = String(request.account_id ?? 'fixture-account');
  const poolId = String(request.pool_id ?? 'fixture-pool');
  const identityFingerprint = String(request.identity_fingerprint ?? 'sha256:fixture-identity');
  const sourceRevision = String(request.source_revision ?? 'sha256:fixture-live-r1');
  const sourceKey = `fixture:${createHash('sha256')
    .update(`${sourceRevision}\0${accountId}\0${poolId}\0${aggregationKeys.join('\0')}`)
    .digest('hex')}`;
  await module.createQuotaAdmissionStore({ home }).publishObservation({
    source_key: sourceKey,
    observation: {
      schema: 'ccm/quota-authority-observation/v1',
      provider: 'codex',
      provider_rule_revision: 'ccm/codex-7d-pacing/v1',
      source_revision: sourceRevision,
      observed_at: new Date(Date.now() - 1_000).toISOString(),
      valid_until: new Date(Date.now() + 300_000).toISOString(),
      source_profile: {
        schema: 'ccm/quota-source-profile/v1',
        revision: 'ccm/test-quota-source/v1',
        fresh_ttl_sec: 60,
        hard_ttl_sec: 300,
        max_clock_skew_sec: 5,
      },
      account_id: accountId,
      pool_id: poolId,
      identity_fingerprint: identityFingerprint,
      hard_window: { name: 'seven_day', duration_sec: 604_800 },
      policy: {
        decision: 'allow',
        revision: 'ccm/codex-7d-pacing/v1',
        hard_ceiling_used_pct: 85,
      },
      effects: { decision: 'allow', effect: 'read-only' },
      buckets: aggregationKeys.map((aggregationKey) => ({
        id: `seven-day:${aggregationKey}`,
        window: 'seven_day',
        duration_sec: 604_800,
        freshness: 'fresh',
        used_pct: 85 - capacityFor(aggregationKey),
        safety_margin_pct: 0,
        projected_p80_pct: 0,
        aggregation_key: aggregationKey,
      })),
    },
  });
}

function storeCase(
  file: 'store.json' | 'concurrency.json',
  name: string,
  title: string,
  handler: () => Promise<void>,
): void {
  const ref = `${file}:${name}`;
  assert.equal(STORE_CASE_HANDLERS.has(ref), false, `duplicate store case registration: ${ref}`);
  STORE_CASE_HANDLERS.set(ref, handler);
  if (!FIXTURES_ONLY) test(title, handler);
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function snapshotTree(root: string): TreeEntry[] {
  if (!existsSync(root)) return [];
  const entries: TreeEntry[] = [];
  const visit = (path: string): void => {
    const stat = lstatSync(path, { bigint: true });
    const entry: TreeEntry = {
      path: relative(root, path) || '.',
      type: stat.isDirectory()
        ? 'directory'
        : stat.isFile()
          ? 'file'
          : stat.isSymbolicLink()
            ? 'symlink'
            : 'other',
      mode: Number(stat.mode & 0o777n),
      size: stat.size.toString(),
      mtime_ns: stat.mtimeNs.toString(),
      ctime_ns: stat.ctimeNs.toString(),
    };
    if (stat.isFile()) entry.sha256 = sha256(readFileSync(path));
    if (stat.isSymbolicLink()) entry.target = readlinkSync(path);
    entries.push(entry);
    if (!stat.isDirectory()) return;
    for (const child of readdirSync(path).sort()) visit(join(path, child));
  };
  visit(root);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function watchTree(root: string): { events: string[]; close: () => void } {
  const events: string[] = [];
  const directories = snapshotTree(root)
    .filter((entry) => entry.type === 'directory')
    .map((entry) => (entry.path === '.' ? root : join(root, entry.path)));
  const watchers = directories.map((directory) =>
    watch(directory, { persistent: false }, (event, filename) => {
      events.push(`${relative(root, directory) || '.'}:${event}:${String(filename ?? '')}`);
    }),
  );
  return {
    events,
    close: () => {
      for (const watcher of watchers) watcher.close();
    },
  };
}

async function flushWatchEvents(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
}

function observedFilesystem(
  options: {
    failBeforeRename?: boolean;
    failRenameTo?: string;
    directorySyncSupported?: boolean;
    directorySyncErrorCode?: DirectorySyncFaultCode;
    directorySyncErrorPath?: string;
    beforeRename?: (from: string, to: string) => void | Promise<void>;
  } = {},
): { filesystem: Record<PropertyKey, unknown>; trace: FilesystemTraceEvent[] } {
  const trace: FilesystemTraceEvent[] = [];
  const filesystem = new Proxy(fsPromises as unknown as Record<PropertyKey, unknown>, {
    get(target, property): unknown {
      if (property === 'open') {
        return async (path: string, flags: string | number, mode?: number) => {
          const handle = await fsPromises.open(path, flags, mode);
          const kind = (await handle.stat()).isDirectory() ? 'directory' : 'file';
          trace.push({ op: 'open', path, flags, mode, kind });
          return new Proxy(handle, {
            get(fileHandle, handleProperty): unknown {
              if (handleProperty === 'writeFile') {
                return async (...args: Parameters<typeof fileHandle.writeFile>) => {
                  await fileHandle.writeFile(...args);
                  trace.push({ op: 'write-complete', path, kind });
                };
              }
              if (handleProperty === 'write' || handleProperty === 'writev') {
                return async (...args: unknown[]) => {
                  const result = await Reflect.apply(
                    fileHandle[handleProperty].bind(fileHandle),
                    fileHandle,
                    args,
                  );
                  trace.push({ op: 'handle-write-complete', path, kind });
                  return result;
                };
              }
              if (handleProperty === 'truncate') {
                return async (...args: Parameters<typeof fileHandle.truncate>) => {
                  await fileHandle.truncate(...args);
                  trace.push({ op: 'handle-truncate-complete', path, kind });
                };
              }
              if (handleProperty === 'sync') {
                return async () => {
                  const op =
                    kind === 'directory' ? 'directory-fsync-attempt' : 'file-fsync-attempt';
                  trace.push({ op, path, kind });
                  try {
                    if (
                      kind === 'directory' &&
                      options.directorySyncErrorCode &&
                      (options.directorySyncErrorPath === undefined ||
                        options.directorySyncErrorPath === path)
                    ) {
                      // Inject the raw errno only; whether it is a soft "unsupported" downgrade or
                      // a hard failure is the store's classification, never the instrument's.
                      const error = new Error(
                        `injected directory fsync fault ${options.directorySyncErrorCode}`,
                      ) as NodeJS.ErrnoException;
                      error.code = options.directorySyncErrorCode;
                      throw error;
                    }
                    if (!(kind === 'directory' && options.directorySyncSupported)) {
                      await fileHandle.sync();
                    }
                  } catch (cause) {
                    const code = (cause as NodeJS.ErrnoException).code;
                    trace.push({
                      op: kind === 'directory' ? 'directory-fsync-error' : 'file-fsync-error',
                      path,
                      kind,
                      code,
                    });
                    throw cause;
                  }
                  trace.push({
                    op: kind === 'directory' ? 'directory-fsync-complete' : 'file-fsync-complete',
                    path,
                    kind,
                  });
                };
              }
              const value = Reflect.get(fileHandle, handleProperty, fileHandle) as unknown;
              return typeof value === 'function' ? value.bind(fileHandle) : value;
            },
          });
        };
      }
      if (property === 'rename') {
        return async (from: string, to: string) => {
          trace.push({ op: 'atomic-rename-attempt', from, to });
          await options.beforeRename?.(from, to);
          if (options.failBeforeRename || options.failRenameTo === to) {
            const error = new Error('injected rename failure') as NodeJS.ErrnoException;
            error.code = 'EIO';
            throw error;
          }
          await fsPromises.rename(from, to);
          trace.push({ op: 'atomic-rename-complete', from, to });
        };
      }
      if (property === 'writeFile') {
        return async (...args: Parameters<typeof fsPromises.writeFile>) => {
          await fsPromises.writeFile(...args);
          trace.push({ op: 'write-file-complete', path: String(args[0]) });
        };
      }
      if (property === 'appendFile') {
        return async (...args: Parameters<typeof fsPromises.appendFile>) => {
          await fsPromises.appendFile(...args);
          trace.push({ op: 'append-file-complete', path: String(args[0]) });
        };
      }
      if (property === 'truncate') {
        return async (...args: Parameters<typeof fsPromises.truncate>) => {
          await fsPromises.truncate(...args);
          trace.push({ op: 'truncate-file-complete', path: String(args[0]) });
        };
      }
      if (property === 'copyFile') {
        return async (...args: Parameters<typeof fsPromises.copyFile>) => {
          await fsPromises.copyFile(...args);
          trace.push({ op: 'copy-file-complete', from: String(args[0]), to: String(args[1]) });
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { filesystem, trace };
}

function assertAtomicPublishTrace(trace: FilesystemTraceEvent[], finalPath: string): void {
  const directFinal = trace.find(
    (entry) =>
      (entry.path === finalPath &&
        [
          'write-complete',
          'handle-write-complete',
          'handle-truncate-complete',
          'write-file-complete',
          'append-file-complete',
          'truncate-file-complete',
        ].includes(entry.op)) ||
      (entry.to === finalPath && entry.op === 'copy-file-complete') ||
      (entry.path === finalPath && entry.op === 'open' && String(entry.flags).includes('w')),
  );
  assert.equal(directFinal, undefined, 'final path must never be opened for truncate/write');

  const tempOpenIndex = trace.findIndex(
    (entry) =>
      entry.op === 'open' &&
      entry.kind === 'file' &&
      entry.path !== finalPath &&
      dirname(String(entry.path)) === dirname(finalPath) &&
      String(entry.flags).includes('w') &&
      String(entry.flags).includes('x') &&
      entry.mode === 0o600,
  );
  assert.ok(tempOpenIndex >= 0, 'same-directory unique temp must be opened wx+0600');
  const tempPath = String(trace[tempOpenIndex]?.path);
  const writeIndex = trace.findIndex(
    (entry, index) =>
      index > tempOpenIndex && entry.op === 'write-complete' && entry.path === tempPath,
  );
  const fileSyncIndex = trace.findIndex(
    (entry, index) =>
      index > writeIndex && entry.op === 'file-fsync-complete' && entry.path === tempPath,
  );
  const renameIndex = trace.findIndex(
    (entry, index) =>
      index > fileSyncIndex &&
      entry.op === 'atomic-rename-complete' &&
      entry.from === tempPath &&
      entry.to === finalPath,
  );
  const directorySyncIndex = trace.findIndex(
    (entry, index) =>
      index > renameIndex &&
      entry.op === 'directory-fsync-attempt' &&
      entry.path === dirname(finalPath),
  );
  assert.ok(writeIndex > tempOpenIndex, 'temp write must complete after exclusive open');
  assert.ok(fileSyncIndex > writeIndex, 'temp file fsync must complete before rename');
  assert.ok(renameIndex > fileSyncIndex, 'atomic rename must follow durable temp file');
  assert.ok(
    directorySyncIndex > renameIndex,
    'parent directory fsync must be attempted after rename',
  );
}

function assertDirectorySyncOutcome(
  expected: Record<string, unknown>,
  injectedCode: DirectorySyncFaultCode | undefined,
  outcome: DirectorySyncOutcome,
  context: string,
): void {
  const softCodes = expected.directory_sync_soft_unsupported_codes as DirectorySyncFaultCode[];
  const hardCodes = expected.directory_sync_hard_failure_codes as DirectorySyncFaultCode[];
  if (injectedCode === undefined) {
    assert.equal(outcome.rejectedCode, undefined, `${context}: supported sync must resolve`);
    assert.equal(
      outcome.result,
      expected.directory_sync_supported_result,
      `${context}: supported sync must report durable`,
    );
    return;
  }
  if (softCodes.includes(injectedCode)) {
    assert.equal(
      outcome.rejectedCode,
      undefined,
      `${context}: must resolve as unsupported, not reject`,
    );
    assert.equal(
      outcome.result,
      expected.directory_sync_soft_unsupported_result,
      `${context}: honest unsupported result`,
    );
    return;
  }
  if (hardCodes.includes(injectedCode)) {
    assert.equal(outcome.result, undefined, `${context}: hard directory-sync failure must reject`);
    assert.equal(outcome.rejectedCode, injectedCode, `${context}: surfaced errno`);
    return;
  }
  assert.fail(`${context}: unknown directory-sync errno ${injectedCode}`);
}

// Reservation events are immutable no-replace linearization evidence: each event file is created
// exactly once with an exclusive wx+0600 open, written, file-fsynced, then its parent directory
// fsync is attempted. Unlike observation/snapshot publish there is no rename — the event never
// replaces or truncates an existing file. This oracle rejects the no-replace and truncation
// counterfeits and the missing-fsync degradation.
function assertDurableEventTrace(trace: FilesystemTraceEvent[], eventPath: string): void {
  const truncated = trace.find(
    (entry) =>
      entry.path === eventPath &&
      ['handle-truncate-complete', 'truncate-file-complete'].includes(entry.op),
  );
  assert.equal(truncated, undefined, 'durable event must never be truncated');
  const nonExclusiveOpen = trace.find(
    (entry) =>
      entry.op === 'open' &&
      entry.path === eventPath &&
      String(entry.flags).includes('w') &&
      !String(entry.flags).includes('x'),
  );
  assert.equal(
    nonExclusiveOpen,
    undefined,
    'durable event must be created no-replace (wx), never opened for overwrite',
  );
  const replaced = trace.find(
    (entry) =>
      entry.to === eventPath && ['atomic-rename-complete', 'copy-file-complete'].includes(entry.op),
  );
  assert.equal(replaced, undefined, 'durable event must never be replaced by rename or copy');
  const openIndex = trace.findIndex(
    (entry) =>
      entry.op === 'open' &&
      entry.kind === 'file' &&
      entry.path === eventPath &&
      String(entry.flags).includes('w') &&
      String(entry.flags).includes('x') &&
      entry.mode === 0o600,
  );
  assert.ok(openIndex >= 0, 'durable event must be opened wx + 0600');
  const writeIndex = trace.findIndex(
    (entry, index) =>
      index > openIndex &&
      entry.path === eventPath &&
      ['write-complete', 'handle-write-complete'].includes(entry.op),
  );
  assert.ok(writeIndex > openIndex, 'durable event write must complete after exclusive open');
  const fileSyncIndex = trace.findIndex(
    (entry, index) =>
      index > writeIndex && entry.op === 'file-fsync-complete' && entry.path === eventPath,
  );
  assert.ok(
    fileSyncIndex > writeIndex,
    'durable event file fsync must complete before the event is authoritative',
  );
  const directorySyncIndex = trace.findIndex(
    (entry, index) =>
      index > fileSyncIndex &&
      entry.op === 'directory-fsync-attempt' &&
      entry.path === dirname(eventPath),
  );
  assert.ok(
    directorySyncIndex > fileSyncIndex,
    'durable event parent directory fsync must be attempted after file fsync',
  );
}

function reservationPath(home: string, aggregationKey: string): string {
  return join(home, 'quota', 'v1', 'reservations', sha256(aggregationKey));
}

function reservationAuthoritySnapshot(home: string, aggregationKey: string): TreeEntry[] {
  const root = reservationPath(home, aggregationKey);
  return snapshotTree(root).filter(
    (entry) =>
      entry.path === 'snapshot.json' || entry.path.startsWith('events/') || entry.path === 'events',
  );
}

function readJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, name), 'utf8')) as Record<string, unknown>;
}

function fixture(name: string): ContractFixture {
  const value = readJson(name);
  assert.equal(typeof value.schema, 'string', `${name}: schema`);
  assert.ok(Array.isArray(value.cases), `${name}: cases[]`);
  return value as ContractFixture;
}

function fixtureCase(name: string, caseName: string): ContractCase {
  const scenario = fixture(name).cases.find((entry) => entry.name === caseName);
  assert.ok(scenario, `${name}:${caseName}`);
  return scenario;
}

function record(value: unknown, location: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), location);
  return value as Record<string, unknown>;
}

function assertNoOracleKeys(value: unknown, location: string): void {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertNoOracleKeys(entry, `${location}[${index}]`);
    }
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    assert.doesNotMatch(key, /expected|oracle|answer/i, `${location}.${key}: oracle-like key`);
    assertNoOracleKeys(entry, `${location}.${key}`);
  }
}

function cloneAndFreeze(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const cloned = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  const freeze = (entry: unknown): void => {
    if (entry === null || typeof entry !== 'object' || Object.isFrozen(entry)) return;
    Object.freeze(entry);
    for (const child of Object.values(entry as Record<string, unknown>)) freeze(child);
  };
  freeze(cloned);
  return cloned;
}

async function engineContract(): Promise<QuotaEngineContract> {
  const engineUrl = new URL('../../../packages/engine/src/index.js', import.meta.url).href;
  let candidate: Record<string, unknown>;
  try {
    candidate = (await import(engineUrl)) as Record<string, unknown>;
  } catch (cause) {
    throw new Error('HONEST RED [engine]: @ccm/engine quota-admission seam is absent', { cause });
  }
  const exports: Array<keyof QuotaEngineContract> = [
    'evaluateQuotaObservation',
    'deriveQuotaHeadroom',
    'deriveRolling24h',
    'evaluateQuotaReservationTransition',
    'evaluateLiveQuotaAdmission',
    'evaluateQuotaOrphanAudit',
    'evaluateQuotaLifecycleEffect',
    'classifyQuotaError',
  ];
  for (const name of exports) {
    if (typeof candidate[name] !== 'function') {
      throw new Error(`HONEST RED [engine]: @ccm/engine public export ${name} is absent`);
    }
  }
  return candidate as unknown as QuotaEngineContract;
}

async function storeModule(): Promise<QuotaAdmissionStoreModule> {
  const storeUrl = new URL('../src/quota-admission-store.js', import.meta.url).href;
  let candidate: Record<string, unknown>;
  try {
    candidate = (await import(storeUrl)) as Record<string, unknown>;
  } catch (cause) {
    throw new Error('HONEST RED [store]: ccm/apps/cli/src/quota-admission-store.ts is absent', {
      cause,
    });
  }
  if (typeof candidate.createQuotaAdmissionStore !== 'function') {
    throw new Error('HONEST RED [store]: createQuotaAdmissionStore export is absent');
  }
  return candidate as unknown as QuotaAdmissionStoreModule;
}

async function cli(
  args: string[],
  home: string,
  env: Record<string, string | undefined> = {},
  quotaEffects?: QuotaEffectBoundary,
): Promise<{ code: number; stdout: string; stderr: string; json: Record<string, unknown> }> {
  const effects =
    quotaEffects ??
    (
      (await import('../src/quota-production-effects.js')) as {
        createProductionQuotaEffectBoundary(options: { home: string }): QuotaEffectBoundary;
      }
    ).createProductionQuotaEffectBoundary({ home });
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(['--home', home, ...args], {
    out: (line: string) => stdout.push(line),
    err: (line: string) => stderr.push(line),
    env: { HOME: dirname(home), CC_MASTER_HOME: home, CC_MASTER_NO_AUTOINSTALL: '1', ...env },
    quotaEffects: effects,
  });
  const output = stdout.join('');
  let json: Record<string, unknown> = {};
  if (output.trim()) {
    try {
      json = JSON.parse(output) as Record<string, unknown>;
    } catch {
      json = {};
    }
  }
  return { code, stdout: output, stderr: stderr.join(''), json };
}

function assertNoFixtureCoupling(): void {
  const caseNames = FILES.flatMap((name) => fixture(name).cases.map((entry) => entry.name));
  const sourceFiles = (root: string): string[] =>
    readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
    });
  for (const path of SOURCE_ROOTS.flatMap(sourceFiles)) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /quota-admission-contract-v1|test[\\/]fixtures/);
    for (const caseName of caseNames) {
      assert.equal(
        source.includes(caseName),
        false,
        `${path}: hard-coded fixture case ${caseName}`,
      );
    }
  }
}

test('credential-scope instrument catches create/delete/rename/content/metadata/symlink mutations', async () => {
  const mutationNames = ['create', 'delete', 'rename', 'content', 'mode', 'metadata', 'symlink'];
  for (const mutation of mutationNames) {
    const { root } = tempHome(`ccm-quota-detector-${mutation}-`);
    const configRoot = join(root, 'fake-config');
    const sessions = join(configRoot, 'sessions');
    mkdirSync(sessions, { recursive: true, mode: 0o700 });
    const auth = join(configRoot, 'auth.json');
    const session = join(sessions, 'active.json');
    const targetA = join(configRoot, 'target-a');
    const targetB = join(configRoot, 'target-b');
    const link = join(configRoot, 'current');
    writeFileSync(auth, '{"safe_fixture":"auth"}\n', { mode: 0o600 });
    writeFileSync(session, '{"safe_fixture":"session"}\n', { mode: 0o600 });
    writeFileSync(targetA, 'a\n', { mode: 0o600 });
    writeFileSync(targetB, 'b\n', { mode: 0o600 });
    symlinkSync('target-a', link);
    const before = snapshotTree(configRoot);
    const watcher = watchTree(configRoot);
    try {
      await flushWatchEvents();
      if (mutation === 'create') writeFileSync(join(configRoot, 'credentials.json'), '{}\n');
      if (mutation === 'delete') unlinkSync(session);
      if (mutation === 'rename') renameSync(auth, join(configRoot, 'auth-renamed.json'));
      if (mutation === 'content') writeFileSync(auth, '{"safe_fixture":"changed"}\n');
      if (mutation === 'mode') chmodSync(auth, 0o640);
      if (mutation === 'metadata') utimesSync(auth, new Date(1_700_000_000_000), new Date());
      if (mutation === 'symlink') {
        unlinkSync(link);
        symlinkSync('target-b', link);
      }
      await flushWatchEvents();
      assert.notDeepEqual(
        snapshotTree(configRoot),
        before,
        `${mutation}: recursive snapshot detects`,
      );
      assert.ok(
        watcher.events.length > 0,
        `${mutation}: filesystem watcher detects transient effect`,
      );
    } finally {
      watcher.close();
    }
  }
});

test('atomic trace instrument rejects direct-write/truncate/append/copy/missing-fsync counterfeits and accepts the durable protocol only', () => {
  const finalPath = '/safe/quota/current.json';
  const tempPath = '/safe/quota/.current.json.tmp-1';
  // Every direct mutation of the final path is a counterfeit: it can expose a half-written
  // revision to a concurrent reader instead of an atomic old-or-new replace.
  const directFinalCounterfeits: FilesystemTraceEvent[][] = [
    // direct truncating open + write
    [
      { op: 'open', path: finalPath, flags: 'w', mode: 0o600, kind: 'file' },
      { op: 'write-complete', path: finalPath, kind: 'file' },
    ],
    // in-place read-write handle overwrite
    [
      { op: 'open', path: finalPath, flags: 'r+', mode: 0o600, kind: 'file' },
      { op: 'handle-write-complete', path: finalPath, kind: 'file' },
    ],
    // truncate() the final path in place
    [{ op: 'truncate-file-complete', path: finalPath }],
    // append to the final path in place
    [{ op: 'append-file-complete', path: finalPath }],
    // copy directly onto the final path (non-atomic overwrite)
    [{ op: 'copy-file-complete', from: '/safe/quota/source.json', to: finalPath }],
  ];
  for (const counterfeit of directFinalCounterfeits) {
    assert.throws(() => assertAtomicPublishTrace(counterfeit, finalPath), /truncate\/write/);
  }
  // Missing file fsync before rename: the temp file may not be durable when it becomes authority.
  assert.throws(
    () =>
      assertAtomicPublishTrace(
        [
          { op: 'open', path: tempPath, flags: 'wx', mode: 0o600, kind: 'file' },
          { op: 'write-complete', path: tempPath, kind: 'file' },
          { op: 'atomic-rename-complete', from: tempPath, to: finalPath },
          { op: 'directory-fsync-attempt', path: dirname(finalPath), kind: 'directory' },
        ],
        finalPath,
      ),
    /file fsync/,
  );
  // Missing directory fsync after rename: the rename itself may not survive a crash.
  assert.throws(
    () =>
      assertAtomicPublishTrace(
        [
          { op: 'open', path: tempPath, flags: 'wx', mode: 0o600, kind: 'file' },
          { op: 'write-complete', path: tempPath, kind: 'file' },
          { op: 'file-fsync-complete', path: tempPath, kind: 'file' },
          { op: 'atomic-rename-complete', from: tempPath, to: finalPath },
        ],
        finalPath,
      ),
    /parent directory fsync/,
  );
  assert.doesNotThrow(() =>
    assertAtomicPublishTrace(
      [
        { op: 'open', path: tempPath, flags: 'wx', mode: 0o600, kind: 'file' },
        { op: 'write-complete', path: tempPath, kind: 'file' },
        { op: 'file-fsync-complete', path: tempPath, kind: 'file' },
        { op: 'atomic-rename-complete', from: tempPath, to: finalPath },
        { op: 'directory-fsync-attempt', path: dirname(finalPath), kind: 'directory' },
      ],
      finalPath,
    ),
  );

  const expected = record(
    fixtureCase('store.json', 'atomic-owner-only-observation-publish').expected,
    'directory sync matrix calibration',
  );
  assert.doesNotThrow(() =>
    assertDirectorySyncOutcome(
      expected,
      undefined,
      { result: expected.directory_sync_supported_result },
      'supported',
    ),
  );
  for (const code of expected.directory_sync_soft_unsupported_codes as DirectorySyncFaultCode[]) {
    assert.doesNotThrow(() =>
      assertDirectorySyncOutcome(
        expected,
        code,
        { result: expected.directory_sync_soft_unsupported_result },
        `soft ${code}`,
      ),
    );
    assert.throws(
      () => assertDirectorySyncOutcome(expected, code, { rejectedCode: code }, `soft ${code}`),
      /must resolve as unsupported/,
    );
  }
  for (const code of expected.directory_sync_hard_failure_codes as DirectorySyncFaultCode[]) {
    assert.doesNotThrow(() =>
      assertDirectorySyncOutcome(expected, code, { rejectedCode: code }, `hard ${code}`),
    );
    for (const swallowed of expected.directory_sync as unknown[]) {
      assert.throws(
        () => assertDirectorySyncOutcome(expected, code, { result: swallowed }, `hard ${code}`),
        /must reject/,
      );
    }
  }
});

test('reachability instrument rejects dead-row, alias, duplicate, handler-only, and fixture-only counterfeits', () => {
  const alpha = 'store.json:alpha';
  const beta = 'store.json:beta';
  const gamma = 'store.json:gamma';
  const valid: ReachabilityContractInput = {
    manifestRefs: [alpha, beta],
    fixtureRefs: [alpha, beta],
    executionDomainRefs: [alpha, beta],
    runnerRefs: [alpha, beta],
  };
  assert.doesNotThrow(() => assertExactReachability(valid));

  const counterfeits: Array<{ name: string; input: ReachabilityContractInput }> = [
    {
      name: 'dead-row',
      input: {
        ...valid,
        manifestRefs: [...valid.manifestRefs, gamma],
        fixtureRefs: [...valid.fixtureRefs, gamma],
      },
    },
    {
      name: 'alias',
      input: {
        ...valid,
        runnerRefs: [`${alpha}-alias`, beta],
      },
    },
    {
      name: 'duplicate',
      input: {
        ...valid,
        manifestRefs: [...valid.manifestRefs, alpha],
      },
    },
    {
      name: 'handler-only',
      input: {
        ...valid,
        runnerRefs: [...valid.runnerRefs, gamma],
      },
    },
    {
      name: 'fixture-only',
      input: {
        ...valid,
        fixtureRefs: [...valid.fixtureRefs, gamma],
      },
    },
  ];
  for (const counterfeit of counterfeits) {
    assert.throws(
      () => assertExactReachability(counterfeit.input),
      /reachability/i,
      `${counterfeit.name} must be rejected`,
    );
  }
});

test('durable event trace instrument rejects truncation/no-replace counterfeits and accepts the immutable protocol only', () => {
  const eventPath = '/safe/quota/reservations/agg-sha/events/0001-evt.json';
  const eventDir = dirname(eventPath);
  // no-replace counterfeit: a non-exclusive open would clobber an existing immutable event.
  assert.throws(
    () =>
      assertDurableEventTrace(
        [
          { op: 'open', path: eventPath, flags: 'w', mode: 0o600, kind: 'file' },
          { op: 'write-complete', path: eventPath, kind: 'file' },
          { op: 'file-fsync-complete', path: eventPath, kind: 'file' },
          { op: 'directory-fsync-attempt', path: eventDir, kind: 'directory' },
        ],
        eventPath,
      ),
    /no-replace/,
  );
  // truncation counterfeit: an event is immutable and must never be truncated in place.
  assert.throws(
    () =>
      assertDurableEventTrace(
        [
          { op: 'open', path: eventPath, flags: 'wx', mode: 0o600, kind: 'file' },
          { op: 'truncate-file-complete', path: eventPath },
          { op: 'write-complete', path: eventPath, kind: 'file' },
          { op: 'file-fsync-complete', path: eventPath, kind: 'file' },
          { op: 'directory-fsync-attempt', path: eventDir, kind: 'directory' },
        ],
        eventPath,
      ),
    /truncated/,
  );
  // missing file fsync before the event becomes authority.
  assert.throws(
    () =>
      assertDurableEventTrace(
        [
          { op: 'open', path: eventPath, flags: 'wx', mode: 0o600, kind: 'file' },
          { op: 'write-complete', path: eventPath, kind: 'file' },
          { op: 'directory-fsync-attempt', path: eventDir, kind: 'directory' },
        ],
        eventPath,
      ),
    /file fsync/,
  );
  const validPrefix: FilesystemTraceEvent[] = [
    { op: 'open', path: eventPath, flags: 'wx', mode: 0o600, kind: 'file' },
    { op: 'write-complete', path: eventPath, kind: 'file' },
    { op: 'file-fsync-complete', path: eventPath, kind: 'file' },
    { op: 'directory-fsync-attempt', path: eventDir, kind: 'directory' },
  ];
  for (const replacement of [
    {
      op: 'atomic-rename-complete',
      from: '/safe/quota/reservations/agg-sha/events/replacement.tmp',
      to: eventPath,
    },
    {
      op: 'copy-file-complete',
      from: '/safe/quota/reservations/agg-sha/events/replacement.json',
      to: eventPath,
    },
  ] satisfies FilesystemTraceEvent[]) {
    assert.throws(
      () => assertDurableEventTrace([...validPrefix, replacement], eventPath),
      /never be replaced/,
    );
  }
  assert.throws(
    () => assertDurableEventTrace(validPrefix.slice(0, -1), eventPath),
    /parent directory fsync/,
  );
  assert.doesNotThrow(() => assertDurableEventTrace(validPrefix, eventPath));
});

test('quota v1 spec, fixtures, seam manifest, and coverage are structurally complete', () => {
  assert.equal(existsSync(SPEC_PATH), true, 'versioned contract exists');
  assert.equal(existsSync(WORKER_PATH), true, '10-way worker probe exists');
  assert.equal(existsSync(RETIRED_COUNTERFEIT_SEAM), false, 'generic evaluator seam stays retired');
  const spec = readFileSync(SPEC_PATH, 'utf8');
  assert.match(spec, /af41af29c9e7af008dfcd58279723dc2cc8ad3e0/);
  assert.match(spec, /node --import tsx test\/quota-admission-contract\.red\.ts/);
  assert.doesNotMatch(spec, /--test test\/quota-admission-contract\.red\.ts/);

  const manifest = readJson('manifest.json');
  assert.equal(manifest.schema, 'ccm/quota-admission-contract-fixtures/v1');
  assert.equal(
    manifest.contract,
    'design_docs/2026-07-13-cross-harness-quota-admission-contract.md',
  );
  assert.deepEqual(manifest.implementation_seams, {
    engine: 'ccm/packages/engine/src/quota-admission.ts via @ccm/engine barrel',
    cli: 'ccm/apps/cli/src/router.ts -> registry quota noun -> handlers/quota.ts',
    store:
      'ccm/apps/cli/src/quota-admission-store.ts#createQuotaAdmissionStore({home,filesystem?})',
    effects:
      '@ccm/engine#createQuotaEffectBoundary -> router RunOpts.quotaEffects -> Ctx.quotaEffects',
  });

  const executionDomains = record(manifest.execution_domains, 'manifest.execution_domains');
  assert.deepEqual(executionDomains.engine_whole_files, [...ENGINE_DOMAIN_FILES]);
  const storeRows = record(executionDomains.store_exact_rows, 'store exact rows');
  const manifestStoreRefs = Object.entries(storeRows)
    .flatMap(([file, names]) => (names as string[]).map((name) => `${file}:${name}`))
    .sort();
  assert.deepEqual(
    [...STORE_CASE_HANDLERS.keys()].sort(),
    manifestStoreRefs,
    'every store/concurrency fixture row is registered as a real store test',
  );

  const files = manifest.files as Record<string, string[]>;
  assert.deepEqual(Object.keys(files).sort(), [...FILES]);
  const availableCases = new Set<string>();
  for (const [name, expectedNames] of Object.entries(files)) {
    const value = fixture(name);
    const actualNames = value.cases.map((entry) => entry.name);
    assert.deepEqual(actualNames, expectedNames, `${name}: manifest order and names`);
    assert.equal(new Set(actualNames).size, actualNames.length, `${name}: unique names`);
    assert.ok(value.cases.length > 1, `${name}: non-vacuous case set`);
    assert.ok(
      new Set(value.cases.map((entry) => JSON.stringify(entry.expected))).size > 1,
      `${name}: outputs vary`,
    );
    for (const scenario of value.cases) {
      assert.ok(scenario.spec_ids.length > 0, `${name}:${scenario.name}: spec_ids`);
      assertNoOracleKeys(scenario.input, `${name}:${scenario.name}.input`);
      for (const specId of scenario.spec_ids) {
        assert.match(specId, /^QA-[A-Z0-9]+-\d{3}$/);
        assert.ok(spec.includes(`**${specId}**`), `${name}:${scenario.name}:${specId}`);
      }
      const ref = `${name}:${scenario.name}`;
      assert.equal(availableCases.has(ref), false, `${ref}: globally unique`);
      availableCases.add(ref);
    }
  }

  const refsForFiles = (names: readonly string[]): string[] =>
    names.flatMap((name) => fixture(name).cases.map((scenario) => `${name}:${scenario.name}`));
  const manifestRefs = Object.entries(files).flatMap(([name, cases]) =>
    cases.map((caseName) => `${name}:${caseName}`),
  );
  const fixtureRefs = refsForFiles(FILES);
  const executionDomainRefs = [
    ...refsForFiles(executionDomains.engine_whole_files as string[]),
    ...manifestStoreRefs,
  ];
  const runnerRefs = [...refsForFiles(ENGINE_DOMAIN_FILES), ...STORE_CASE_HANDLERS.keys()];
  assertExactReachability({
    manifestRefs,
    fixtureRefs,
    executionDomainRefs,
    runnerRefs,
  });

  const coverage = manifest.required_coverage as Record<string, string>;
  assert.deepEqual(Object.keys(coverage).sort(), [...REQUIRED_COVERAGE]);
  for (const [name, ref] of Object.entries(coverage)) {
    assert.ok(availableCases.has(ref), `${name}: existing fixture ref`);
  }

  const concurrency = fixture('concurrency.json');
  assert.doesNotMatch(JSON.stringify(concurrency), /linearization_order/);
  const sameKey = fixtureCase('concurrency.json', 'ten-same-key-single-reservation');
  assert.equal(sameKey.input.concurrent_callers, 10);
  assert.equal(record(sameKey.expected, 'same-key expected').created_count, 1);

  const mutationCases = fixture('lifecycle-effects.json').cases.filter((entry) =>
    ['codex', 'cursor'].includes(String(entry.input.provider)),
  );
  const actualMatrix = mutationCases
    .map((entry) => `${entry.input.provider}:${entry.input.requested_effect}`)
    .sort();
  const expectedMatrix = ['codex', 'cursor']
    .flatMap((provider) => MUTATION_EFFECTS.map((effect) => `${provider}:${effect}`))
    .sort();
  assert.deepEqual(actualMatrix, expectedMatrix, 'complete Codex/Cursor mutation matrix');
  for (const scenario of mutationCases) {
    assert.equal(record(scenario.expected, scenario.name).effect_count, 0);
  }

  for (const name of [
    'authenticated-without-quota-spawn-zero',
    'observation-conflict-spawn-zero',
  ]) {
    assert.equal(record(fixtureCase('admission.json', name).expected, name).spawn_count, 0);
  }
  assert.equal(
    fixtureCase('admission.json', 'provider-neutral-ample').input.provider,
    'future-provider',
  );
  assertNoFixtureCoupling();

  const atomicExpected = record(
    fixtureCase('store.json', 'atomic-owner-only-observation-publish').expected,
    'atomic expected',
  );
  assert.deepEqual(atomicExpected.required_protocol, [
    'same-directory-temp-open-wx-0600',
    'temp-write-complete',
    'temp-file-fsync-complete',
    'atomic-rename-complete',
    'directory-fsync-attempt',
  ]);
});

if (!FIXTURES_ONLY) {
  const engineDomains: Array<{
    file: string;
    evaluator: keyof QuotaEngineContract;
  }> = ENGINE_DOMAIN_FILES.map((file) => ({
    file,
    evaluator: {
      'observation.json': 'evaluateQuotaObservation',
      'derivation.json': 'deriveQuotaHeadroom',
      'rolling24h.json': 'deriveRolling24h',
      'reservation.json': 'evaluateQuotaReservationTransition',
      'admission.json': 'evaluateLiveQuotaAdmission',
      'orphan.json': 'evaluateQuotaOrphanAudit',
      'lifecycle-effects.json': 'evaluateQuotaLifecycleEffect',
      'errors.json': 'classifyQuotaError',
    }[file] as keyof QuotaEngineContract,
  }));

  for (const domain of engineDomains) {
    test(`[engine] ${domain.file} matches the public provider-neutral contract`, async () => {
      const engine = await engineContract();
      const evaluate = engine[domain.evaluator];
      for (const scenario of fixture(domain.file).cases) {
        assert.deepEqual(
          evaluate(cloneAndFreeze(scenario.input)),
          scenario.expected,
          `${domain.file}:${scenario.name}`,
        );
      }
    });
  }

  test('[engine] generated arithmetic and permutation probes reject finite fixture lookup', async () => {
    const engine = await engineContract();
    for (let index = 0; index < 17; index += 1) {
      const ceiling = 88 + (index % 3);
      const used = 7 + index;
      const active = (index * 5) % 6;
      const margin = index % 4;
      const p80 = 1 + (index % 5);
      const id = `generated-${index.toString(16)}`;
      const output = record(
        engine.deriveQuotaHeadroom({
          policy: { revision: `generated-policy-${index}`, hard_ceiling_used_pct: ceiling },
          buckets: [
            {
              id,
              freshness: 'fresh',
              used_pct: used,
              active_reserved_pct: active,
              projected_p80_pct: p80,
              safety_margin_pct: margin,
            },
          ],
        }),
        `generated derivation ${index}`,
      );
      const bucket = record((output.per_bucket as unknown[])[0], `generated bucket ${index}`);
      const headroom = ceiling - used - active - margin;
      assert.equal(bucket.id, id);
      assert.equal(bucket.reservable_headroom_pct, headroom);
      assert.equal(bucket.remaining_after_p80_pct, headroom - p80);
      assert.equal(output.state, 'ample');
    }

    const buckets = [
      {
        id: 'permutation-z',
        freshness: 'fresh',
        used_pct: 13,
        active_reserved_pct: 2,
        projected_p80_pct: 4,
        safety_margin_pct: 1,
      },
      {
        id: 'permutation-a',
        freshness: 'fresh',
        used_pct: 19,
        active_reserved_pct: 1,
        projected_p80_pct: 3,
        safety_margin_pct: 2,
      },
    ];
    const policy = { revision: 'generated-permutation', hard_ceiling_used_pct: 91 };
    const first = record(engine.deriveQuotaHeadroom({ policy, buckets }), 'permutation first');
    const second = record(
      engine.deriveQuotaHeadroom({ policy, buckets: [...buckets].reverse() }),
      'permutation second',
    );
    const byId = (value: Record<string, unknown>): Record<string, unknown> =>
      Object.fromEntries(
        (value.per_bucket as unknown[]).map((entry) => {
          const item = record(entry, 'permutation bucket');
          return [String(item.id), item];
        }),
      );
    assert.deepEqual(byId(first), byId(second));
  });
}

storeCase(
  'store.json',
  'ten-refresh-callers-single-flight',
  '[store] 10 simultaneous refresh callers share one collector and one revision',
  async () => {
    await storeModule();
    const { root, home } = tempHome('ccm-quota-single-flight-');
    const scenario = fixtureCase('store.json', 'ten-refresh-callers-single-flight');
    const input = scenario.input;
    const collectorDir = join(root, 'collector-calls');
    const results = await runConcurrentWorkers(
      home,
      Array.from({ length: Number(input.concurrent_callers) }, (_, workerId) => ({
        operation: 'refresh',
        sourceKey: String(input.source_key),
        observation: {
          ...(input.observation as Record<string, unknown>),
          observed_at: new Date(Date.now() - 1_000).toISOString(),
          valid_until: new Date(Date.now() + 300_000).toISOString(),
          source_profile: {
            schema: 'ccm/quota-source-profile/v1',
            revision: 'ccm/test-quota-source/v1',
            fresh_ttl_sec: 60,
            hard_ttl_sec: 300,
            max_clock_skew_sec: 5,
          },
        },
        collectorDir,
        workerId,
      })),
    );
    const revisions = new Set(
      results.map((entry) => String(record(entry, 'refresh result').revision)),
    );
    assert.equal(results.length, 10);
    assert.equal(revisions.size, 1);
    const snapshotRefs = new Set(
      results.map((entry) => String(record(entry, 'refresh result').snapshot_ref)),
    );
    assert.equal(snapshotRefs.size, 1);
    assert.equal(statSync([...snapshotRefs][0] as string).mode & 0o777, 0o600);
    assert.equal(
      readdirSync(collectorDir).length,
      1,
      '10 isolated store instances for one home+source must execute exactly one collector',
    );
  },
);

storeCase(
  'store.json',
  'atomic-owner-only-observation-publish',
  '[store] atomic publish proves fsync/rename visibility and portable directory durability',
  async () => {
    const module = await storeModule();
    const { home } = tempHome('ccm-quota-atomic-');
    const scenario = fixtureCase('store.json', 'atomic-owner-only-observation-publish');
    const sourceKey = String(scenario.input.source_key);
    const [firstObservation, secondObservation] = scenario.input.revisions as Record<
      string,
      unknown
    >[];
    assert.ok(firstObservation && secondObservation, 'two atomic revisions');
    const expected = record(scenario.expected, 'atomic expected');
    const firstIo = observedFilesystem();
    const first = record(
      await module
        .createQuotaAdmissionStore({ home, filesystem: firstIo.filesystem })
        .publishObservation({ source_key: sourceKey, observation: firstObservation }),
      'first publish result',
    );
    const snapshotRef = String(first.snapshot_ref);
    assert.ok(snapshotRef.startsWith(join(home, 'quota', 'v1', 'observations')));
    assert.equal(statSync(snapshotRef).mode & 0o777, 0o600);
    const nominalDirectoryError = firstIo.trace.find(
      (entry) => entry.op === 'directory-fsync-error',
    )?.code as DirectorySyncFaultCode | undefined;
    assertDirectorySyncOutcome(
      expected,
      nominalDirectoryError,
      { result: first.directory_sync },
      'nominal observation publish',
    );
    assertAtomicPublishTrace(firstIo.trace, snapshotRef);

    const failedIo = observedFilesystem({ failBeforeRename: true });
    await assert.rejects(
      async () =>
        module
          .createQuotaAdmissionStore({ home, filesystem: failedIo.filesystem })
          .publishObservation({ source_key: sourceKey, observation: secondObservation }),
      /rename|EIO/i,
    );
    assert.equal(
      JSON.parse(readFileSync(snapshotRef, 'utf8')).revision,
      expected.rename_fault_visible_revision,
    );
    const failedFileSync = failedIo.trace.findIndex((entry) => entry.op === 'file-fsync-complete');
    const failedRename = failedIo.trace.findIndex((entry) => entry.op === 'atomic-rename-attempt');
    assert.ok(failedFileSync >= 0, 'rename fault follows a completed temp file fsync');
    assert.ok(
      failedRename > failedFileSync,
      'rename fault is injected only after durable temp file',
    );

    let boundaryRevision: unknown = null;
    const visibilityIo = observedFilesystem({
      directorySyncErrorCode: 'EINVAL',
      beforeRename: (_from, to) => {
        if (to === snapshotRef) {
          boundaryRevision = JSON.parse(readFileSync(snapshotRef, 'utf8')).revision;
        }
      },
    });
    const last = record(
      await module
        .createQuotaAdmissionStore({ home, filesystem: visibilityIo.filesystem })
        .publishObservation({ source_key: sourceKey, observation: secondObservation }),
      'second publish result',
    );
    assert.equal(boundaryRevision, expected.rename_boundary_visible_revision);
    assert.equal(last.directory_sync, 'unsupported');
    assertAtomicPublishTrace(visibilityIo.trace, snapshotRef);
    assert.equal(JSON.parse(readFileSync(snapshotRef, 'utf8')).revision, expected.visible_revision);
    writeFileSync(`${snapshotRef}.crash.tmp`, '{"truncated":', { mode: 0o600 });
    const reopened = module.createQuotaAdmissionStore({ home });
    const observed = record(await reopened.readObservation(sourceKey), 'reopened observation');
    assert.equal(observed.revision, expected.visible_revision);

    // Directory-fsync durability matrix. A compliant platform may honestly report that its
    // filesystem does not support directory fsync (EINVAL/ENOTSUP) and still publish durably via
    // the atomic rename; a hard permission failure (EACCES/EPERM) must be surfaced, never silently
    // downgraded to "unsupported"/"durable". Both sides are driven from the fixture code lists, so
    // there is no literal per-code special case in the oracle.
    const softCodes = expected.directory_sync_soft_unsupported_codes as DirectorySyncFaultCode[];
    const hardCodes = expected.directory_sync_hard_failure_codes as DirectorySyncFaultCode[];
    assert.ok(softCodes.length > 0 && hardCodes.length > 0, 'durability matrix codes are present');
    const supportedHome = tempHome('ccm-quota-dirfsync-supported-').home;
    const supportedIo = observedFilesystem({ directorySyncSupported: true });
    const supportedResult = record(
      await module
        .createQuotaAdmissionStore({ home: supportedHome, filesystem: supportedIo.filesystem })
        .publishObservation({ source_key: sourceKey, observation: firstObservation }),
      'supported directory fsync publish',
    );
    assertDirectorySyncOutcome(
      expected,
      undefined,
      { result: supportedResult.directory_sync },
      'supported observation publish',
    );
    assertAtomicPublishTrace(supportedIo.trace, String(supportedResult.snapshot_ref));
    const seedRevision = async (matrixHome: string): Promise<string> => {
      const seedIo = observedFilesystem();
      const seeded = record(
        await module
          .createQuotaAdmissionStore({ home: matrixHome, filesystem: seedIo.filesystem })
          .publishObservation({ source_key: sourceKey, observation: firstObservation }),
        'durability matrix seed',
      );
      return String(seeded.snapshot_ref);
    };
    for (const softCode of softCodes) {
      const softHome = tempHome(`ccm-quota-dirfsync-soft-${softCode.toLowerCase()}-`).home;
      const softRef = await seedRevision(softHome);
      const softIo = observedFilesystem({ directorySyncErrorCode: softCode });
      const softResult = record(
        await module
          .createQuotaAdmissionStore({ home: softHome, filesystem: softIo.filesystem })
          .publishObservation({ source_key: sourceKey, observation: secondObservation }),
        `soft ${softCode} publish`,
      );
      assert.equal(
        softResult.directory_sync,
        'unsupported',
        `${softCode}: honest unsupported downgrade must not reject a compliant filesystem`,
      );
      assertAtomicPublishTrace(softIo.trace, softRef);
      assert.equal(
        JSON.parse(readFileSync(softRef, 'utf8')).revision,
        expected.visible_revision,
        `${softCode}: atomic rename still publishes the complete new revision`,
      );
    }
    for (const hardCode of hardCodes) {
      const hardHome = tempHome(`ccm-quota-dirfsync-hard-${hardCode.toLowerCase()}-`).home;
      const hardRef = await seedRevision(hardHome);
      const hardIo = observedFilesystem({ directorySyncErrorCode: hardCode });
      await assert.rejects(
        async () =>
          module
            .createQuotaAdmissionStore({ home: hardHome, filesystem: hardIo.filesystem })
            .publishObservation({ source_key: sourceKey, observation: secondObservation }),
        new RegExp(hardCode),
        `${hardCode}: hard failure must be surfaced, never silently downgraded`,
      );
      assert.ok(
        hardIo.trace.some((entry) => entry.op === 'directory-fsync-attempt'),
        `${hardCode}: directory fsync must actually be attempted before it can fail hard`,
      );
      assert.equal(
        expected.directory_sync_hard_failure_publish_rejected,
        true,
        `${hardCode}: contract requires the hard-failure publish to reject`,
      );
      // The rename precedes the directory fsync, so the atomic new revision is on disk and fully
      // parseable; the store still fails the publish to report the durability fault honestly.
      assert.equal(
        JSON.parse(readFileSync(hardRef, 'utf8')).revision,
        expected.visible_revision,
        `${hardCode}: reader still sees a complete revision, not a half-written file`,
      );
    }
  },
);

storeCase(
  'store.json',
  'event-durable-snapshot-missing-recovers',
  '[store] durable events replay after snapshot loss and conflict/gap fail closed',
  async () => {
    const module = await storeModule();
    const { home } = tempHome('ccm-quota-recovery-');
    const scenario = fixtureCase('store.json', 'event-durable-snapshot-missing-recovers');
    const aggregationKey = String(scenario.input.aggregation_key);
    const request: Record<string, unknown> = storeReservationRequest({
      ...(scenario.input.request as Record<string, unknown>),
      aggregation_key: aggregationKey,
      capacity_pct: scenario.input.capacity_pct,
    });
    await seedReservationAuthority(home, request);
    const first = record(
      await module.createQuotaAdmissionStore({ home }).reserve(request),
      'first reservation',
    );
    const snapshotRef = String(first.snapshot_ref);
    const eventRef = String(first.event_ref);
    assert.equal(existsSync(eventRef), true, 'event is durable before simulated crash');
    assert.equal(statSync(eventRef).mode & 0o777, 0o600);
    unlinkSync(snapshotRef);
    writeFileSync(`${snapshotRef}.crash.tmp`, '{"partial":', { mode: 0o600 });
    const recovered = record(
      await module.createQuotaAdmissionStore({ home }).inspectAggregation(aggregationKey),
      'recovered aggregation',
    );
    const expected = record(scenario.expected, 'recovery expected');
    assert.equal(recovered.active_reserved_pct, expected.active_reserved_pct);
    assert.equal(recovered.durable_event_count, expected.durable_event_count);
    assert.equal(recovered.replayed_event_count, expected.replayed_event_count);
    assert.equal(recovered.snapshot_rebuilt, true);
    assert.equal(recovered.release_count, 0);
    assert.equal(recovered.spawn_count, 0);

    const seedConflict = async (suffix: string) => {
      const seededHome = tempHome(`ccm-quota-event-${suffix}-`).home;
      const seededRequest = {
        ...request,
        id: `${String(request.id)}-${suffix}`,
        key: `${String(request.key)}-${suffix}`,
        hash: `${String(request.hash)}-${suffix}`,
      };
      await seedReservationAuthority(seededHome, seededRequest);
      const seeded = record(
        await module.createQuotaAdmissionStore({ home: seededHome }).reserve(seededRequest),
        `${suffix} seeded reservation`,
      );
      return { seededHome, seeded };
    };

    const conflict = await seedConflict('conflict');
    const conflictEventRef = String(conflict.seeded.event_ref);
    const conflictSnapshotRef = String(conflict.seeded.snapshot_ref);
    const conflictName = basename(conflictEventRef);
    const sequence = conflictName.match(/^(\d+)-/)?.[1];
    assert.ok(sequence, 'event filename carries a zero-padded sequence');
    const conflictEvent = JSON.parse(readFileSync(conflictEventRef, 'utf8')) as Record<
      string,
      unknown
    >;
    conflictEvent.reservation_id = 'conflicting-reservation';
    writeFileSync(
      join(dirname(conflictEventRef), `${sequence}-conflicting-event.json`),
      JSON.stringify(conflictEvent),
      {
        mode: 0o600,
      },
    );
    unlinkSync(conflictSnapshotRef);
    await assert.rejects(
      async () =>
        module
          .createQuotaAdmissionStore({ home: conflict.seededHome })
          .inspectAggregation(aggregationKey),
      /RESERVATION_STORE_CONFLICT/,
    );

    const gap = await seedConflict('gap');
    const gapEventRef = String(gap.seeded.event_ref);
    const gapSnapshotRef = String(gap.seeded.snapshot_ref);
    const gapName = basename(gapEventRef);
    const gapSequence = gapName.match(/^(\d+)-/)?.[1];
    assert.ok(gapSequence, 'event filename carries a sequence for gap probe');
    const skippedSequence = String(Number(gapSequence) + 1).padStart(gapSequence.length, '0');
    renameSync(
      gapEventRef,
      join(dirname(gapEventRef), gapName.replace(gapSequence, skippedSequence)),
    );
    unlinkSync(gapSnapshotRef);
    await assert.rejects(
      async () =>
        module
          .createQuotaAdmissionStore({ home: gap.seededHome })
          .inspectAggregation(aggregationKey),
      /RESERVATION_STORE_CONFLICT/,
    );

    const corruptionProbes = scenario.input.authoritative_event_corruption_probes as Record<
      string,
      unknown
    >[];
    assert.ok(corruptionProbes.length > 0, 'authoritative event corruption probes');
    for (const probe of corruptionProbes) {
      const kind = String(probe.kind);
      const corrupted = await seedConflict(`corrupt-${kind}`);
      const corruptedEventRef = String(corrupted.seeded.event_ref);
      const corruptedSnapshotRef = String(corrupted.seeded.snapshot_ref);
      writeFileSync(corruptedEventRef, String(probe.contents), { mode: 0o600 });
      unlinkSync(corruptedSnapshotRef);
      const authorityAfterCorruption = reservationAuthoritySnapshot(
        corrupted.seededHome,
        aggregationKey,
      );
      const conflictPattern = new RegExp(String(expected.authoritative_event_corruption_error));
      await assert.rejects(
        async () =>
          module
            .createQuotaAdmissionStore({ home: corrupted.seededHome })
            .inspectAggregation(aggregationKey),
        conflictPattern,
        `${kind}: corrupted authoritative event must fail closed on recovery`,
      );
      await assert.rejects(
        async () =>
          module.createQuotaAdmissionStore({ home: corrupted.seededHome }).reserve({
            ...request,
            id: `${String(request.id)}-after-${kind}`,
            key: `${String(request.key)}-after-${kind}`,
            hash: `${String(request.hash)}-after-${kind}`,
          }),
        conflictPattern,
        `${kind}: corrupted authoritative event must reject new reservation authority`,
      );
      assert.deepEqual(
        reservationAuthoritySnapshot(corrupted.seededHome, aggregationKey),
        authorityAfterCorruption,
        `${kind}: recovery may not append hold/release events or rebuild a valid snapshot`,
      );
      assert.equal(expected.corruption_new_reservation_count, 0);
      assert.equal(expected.release_count, 0);
      assert.equal(expected.spawn_count, 0);
    }
  },
);

storeCase(
  'store.json',
  'atomic-owner-only-reservation-snapshot-publish',
  '[store] reservation event/snapshot use portable durability and replay after rename failure',
  async () => {
    const module = await storeModule();
    const scenario = fixtureCase('store.json', 'atomic-owner-only-reservation-snapshot-publish');
    const aggregationKey = String(scenario.input.aggregation_key);
    const request = storeReservationRequest({
      ...(scenario.input.request as Record<string, unknown>),
      aggregation_key: aggregationKey,
      capacity_pct: scenario.input.capacity_pct,
    });
    const expected = record(scenario.expected, 'atomic reservation snapshot expected');

    const { home } = tempHome('ccm-quota-atomic-reservation-');
    await seedReservationAuthority(home, request);
    const durableIo = observedFilesystem();
    const reserved = record(
      await module
        .createQuotaAdmissionStore({ home, filesystem: durableIo.filesystem })
        .reserve(request),
      'atomic reservation result',
    );
    const snapshotRef = String(reserved.snapshot_ref);
    assert.equal(statSync(snapshotRef).mode & 0o777, 0o600);
    assert.equal(statSync(String(reserved.event_ref)).mode & 0o777, 0o600);
    const boundaries = expected.directory_sync_boundaries as DirectorySyncBoundary[];
    assert.ok(boundaries.length > 0, 'reservation durability boundaries are fixture-driven');
    for (const boundary of boundaries) {
      const boundaryPath = join(reservationPath(home, aggregationKey), boundary.relative_directory);
      const nominalDirectoryError = durableIo.trace.find(
        (entry) => entry.op === 'directory-fsync-error' && entry.path === boundaryPath,
      )?.code as DirectorySyncFaultCode | undefined;
      assertDirectorySyncOutcome(
        expected,
        nominalDirectoryError,
        { result: reserved[boundary.result_field] },
        `nominal reservation ${boundary.name} publish`,
      );
    }
    assertAtomicPublishTrace(durableIo.trace, snapshotRef);
    // The reservation event is immutable no-replace log durability, not an atomic-replace snapshot.
    assertDurableEventTrace(durableIo.trace, String(reserved.event_ref));

    const softCodes = expected.directory_sync_soft_unsupported_codes as DirectorySyncFaultCode[];
    const hardCodes = expected.directory_sync_hard_failure_codes as DirectorySyncFaultCode[];
    assert.ok(softCodes.length > 0 && hardCodes.length > 0, 'reservation durability codes');
    const supportedHome = tempHome('ccm-quota-reservation-dirfsync-supported-').home;
    await seedReservationAuthority(supportedHome, request);
    const supportedIo = observedFilesystem({ directorySyncSupported: true });
    const supportedResult = record(
      await module
        .createQuotaAdmissionStore({ home: supportedHome, filesystem: supportedIo.filesystem })
        .reserve(request),
      'supported reservation directory fsync',
    );
    for (const boundary of boundaries) {
      assertDirectorySyncOutcome(
        expected,
        undefined,
        { result: supportedResult[boundary.result_field] },
        `supported reservation ${boundary.name} publish`,
      );
    }
    assertDurableEventTrace(supportedIo.trace, String(supportedResult.event_ref));
    assertAtomicPublishTrace(supportedIo.trace, String(supportedResult.snapshot_ref));
    for (const boundary of boundaries) {
      for (const softCode of softCodes) {
        const softHome = tempHome(
          `ccm-quota-reservation-${boundary.name}-soft-${softCode.toLowerCase()}-`,
        ).home;
        const softBoundaryPath = join(
          reservationPath(softHome, aggregationKey),
          boundary.relative_directory,
        );
        const softIo = observedFilesystem({
          directorySyncErrorCode: softCode,
          directorySyncErrorPath: softBoundaryPath,
        });
        await seedReservationAuthority(softHome, request);
        const softResult = record(
          await module
            .createQuotaAdmissionStore({ home: softHome, filesystem: softIo.filesystem })
            .reserve(request),
          `${boundary.name} soft ${softCode} reservation`,
        );
        assertDirectorySyncOutcome(
          expected,
          softCode,
          { result: softResult[boundary.result_field] },
          `${boundary.name} soft ${softCode}`,
        );
        assertDurableEventTrace(softIo.trace, String(softResult.event_ref));
        assertAtomicPublishTrace(softIo.trace, String(softResult.snapshot_ref));
      }

      for (const hardCode of hardCodes) {
        const hardHome = tempHome(
          `ccm-quota-reservation-${boundary.name}-hard-${hardCode.toLowerCase()}-`,
        ).home;
        const hardBoundaryPath = join(
          reservationPath(hardHome, aggregationKey),
          boundary.relative_directory,
        );
        const hardIo = observedFilesystem({
          directorySyncErrorCode: hardCode,
          directorySyncErrorPath: hardBoundaryPath,
        });
        await seedReservationAuthority(hardHome, request);
        let rejectedCode: string | undefined;
        await assert.rejects(
          async () =>
            module
              .createQuotaAdmissionStore({ home: hardHome, filesystem: hardIo.filesystem })
              .reserve(request),
          (cause: unknown) => {
            const error = cause as NodeJS.ErrnoException;
            rejectedCode =
              error.code === hardCode || error.message.includes(hardCode) ? hardCode : error.code;
            return rejectedCode === hardCode;
          },
          `${boundary.name} ${hardCode}: hard failure must surface`,
        );
        assertDirectorySyncOutcome(
          expected,
          hardCode,
          { rejectedCode },
          `${boundary.name} hard ${hardCode}`,
        );
        assert.ok(
          hardIo.trace.some(
            (entry) => entry.op === 'directory-fsync-attempt' && entry.path === hardBoundaryPath,
          ),
          `${boundary.name} ${hardCode}: target directory fsync was attempted`,
        );
        assert.equal(
          expected.directory_sync_hard_failure_publish_rejected,
          true,
          `${boundary.name} ${hardCode}: hard publish rejects`,
        );
      }
    }

    const failedHome = tempHome('ccm-quota-atomic-reservation-fault-').home;
    await seedReservationAuthority(failedHome, request);
    const failedSnapshotRef = join(reservationPath(failedHome, aggregationKey), 'snapshot.json');
    const failedIo = observedFilesystem({ failRenameTo: failedSnapshotRef });
    await assert.rejects(
      async () =>
        module
          .createQuotaAdmissionStore({ home: failedHome, filesystem: failedIo.filesystem })
          .reserve(request),
      /rename|EIO/i,
    );
    const replayed = record(
      await module
        .createQuotaAdmissionStore({ home: failedHome })
        .inspectAggregation(aggregationKey),
      'reservation snapshot rename recovery',
    );
    assert.equal(replayed.active_reserved_pct, expected.active_reserved_pct);
    assert.equal(replayed.durable_event_count, expected.durable_event_count);
    assert.equal(replayed.replayed_event_count, expected.rename_fault_replayed_event_count);
    assert.equal(replayed.snapshot_rebuilt, expected.rename_fault_snapshot_rebuilt);
    assert.equal(replayed.release_count, expected.release_count);
    assert.equal(replayed.spawn_count, expected.spawn_count);
  },
);

storeCase(
  'concurrency.json',
  'ten-same-key-single-reservation',
  '[store] real 10-way same-key concurrency creates one reservation/event',
  async () => {
    await storeModule();
    const { home } = tempHome('ccm-quota-same-key-');
    const scenario = fixtureCase('concurrency.json', 'ten-same-key-single-reservation');
    const input = scenario.input;
    const request = storeReservationRequest({
      ...(input.request as Record<string, unknown>),
      aggregation_key: (input.aggregation_keys as string[])[0],
      capacity_pct: record(input.capacity_pct, 'same-key capacity')[
        (input.aggregation_keys as string[])[0] as string
      ],
    });
    const provisionalIds = input.provisional_reservation_ids as string[];
    await seedReservationAuthority(home, request);
    const results = await runWorkers(
      home,
      provisionalIds.map((id) => ({ ...request, id })),
    );
    const values = results.map((entry) => record(entry, 'same-key worker result'));
    const created = values.filter((entry) => entry.action === 'created');
    const reused = values.filter((entry) => entry.action === 'idempotent-existing');
    assert.equal(created.length, 1);
    assert.equal(reused.length, 9);
    assert.equal(new Set(values.map((entry) => entry.reservation_id)).size, 1);
    assert.equal(new Set(values.map((entry) => entry.event_ref)).size, 1);
    const module = await storeModule();
    const inspected = record(
      await module
        .createQuotaAdmissionStore({ home })
        .inspectAggregation(String(request.aggregation_key)),
      'same-key inspected',
    );
    assert.equal(inspected.durable_event_count, 1);
    assert.equal(inspected.active_reserved_pct, 3);
  },
);

storeCase(
  'concurrency.json',
  'ten-contenders-no-oversubscription',
  '[store] real 10-way distinct-key concurrency never oversubscribes capacity',
  async () => {
    await storeModule();
    const { home } = tempHome('ccm-quota-capacity-');
    const scenario = fixtureCase('concurrency.json', 'ten-contenders-no-oversubscription');
    const aggregationKey = String((scenario.input.aggregation_keys as string[])[0]);
    const capacity = record(scenario.input.capacity_pct, 'capacity fixture')[aggregationKey];
    const requests = (scenario.input.contenders as Record<string, unknown>[]).map((entry) => ({
      ...entry,
      aggregation_key: aggregationKey,
      capacity_pct: capacity,
      state: 'held',
      checked_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }));
    await seedReservationAuthority(
      home,
      storeReservationRequest(requests[0] as Record<string, unknown>),
    );
    const values = (await runWorkers(home, requests)).map((entry) =>
      record(entry, 'capacity worker result'),
    );
    assert.equal(values.filter((entry) => entry.action === 'created').length, 3);
    assert.equal(
      values.filter((entry) => entry.error === 'RESERVATION_CAPACITY_CONFLICT').length,
      7,
    );
    const module = await storeModule();
    const inspected = record(
      await module.createQuotaAdmissionStore({ home }).inspectAggregation(aggregationKey),
      'capacity inspected',
    );
    assert.equal(inspected.active_reserved_pct, 9);
    assert.equal(inspected.oversubscribed, false);
  },
);

storeCase(
  'concurrency.json',
  'multi-bucket-all-or-nothing',
  '[store] multi-bucket reservation writes no authority when one bucket cannot fit',
  async () => {
    const module = await storeModule();
    const { home } = tempHome('ccm-quota-multi-bucket-');
    const scenario = fixtureCase('concurrency.json', 'multi-bucket-all-or-nothing');
    const [bucketA, bucketB] = scenario.input.aggregation_keys as string[];
    assert.ok(bucketA && bucketB, 'two aggregation keys');
    const capacity = record(scenario.input.capacity_pct, 'multi-bucket capacity');
    const existing = record(scenario.input.existing_pct, 'multi-bucket existing');
    const store = module.createQuotaAdmissionStore({ home });
    await seedReservationAuthority(
      home,
      storeReservationRequest({
        ...(scenario.input.request as Record<string, unknown>),
        aggregation_keys: [bucketA, bucketB],
        capacity_pct: capacity,
        state: 'held',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    const seed = record(
      await store.reserve(
        storeReservationRequest({
          aggregation_key: bucketB,
          capacity_pct: capacity[bucketB],
          id: 'multi-seed-b',
          key: 'multi-seed-b-key',
          hash: 'multi-seed-b-hash',
          amount_pct: existing[bucketB],
          state: 'held',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      ),
      'multi-bucket seed',
    );
    assert.equal(seed.action, 'created');
    const beforeA = reservationAuthoritySnapshot(home, bucketA);
    const beforeB = reservationAuthoritySnapshot(home, bucketB);
    const result = record(
      await store.reserve(
        storeReservationRequest({
          ...(scenario.input.request as Record<string, unknown>),
          aggregation_keys: [bucketA, bucketB],
          capacity_pct: capacity,
          state: 'held',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      ),
      'multi-bucket rejection',
    );
    assert.equal(result.error, 'RESERVATION_CAPACITY_CONFLICT');
    assert.deepEqual(reservationAuthoritySnapshot(home, bucketA), beforeA);
    assert.deepEqual(reservationAuthoritySnapshot(home, bucketB), beforeB);
    assert.equal(record(scenario.expected, 'multi expected').spawn_count, 0);
  },
);

storeCase(
  'concurrency.json',
  'lock-owner-unknown-no-write',
  '[store] unknown lock owner fails closed without reservation authority writes',
  async () => {
    const module = await storeModule();
    const { home } = tempHome('ccm-quota-lock-owner-');
    const scenario = fixtureCase('concurrency.json', 'lock-owner-unknown-no-write');
    const aggregationKey = String((scenario.input.aggregation_keys as string[])[0]);
    const reservationRoot = reservationPath(home, aggregationKey);
    mkdirSync(reservationRoot, { recursive: true, mode: 0o700 });
    const lockRef = join(reservationRoot, 'lock');
    writeFileSync(
      lockRef,
      `${JSON.stringify({
        schema: 'ccm/quota-lock/v1',
        ...(scenario.input.lock as Record<string, unknown>),
        acquired_at: '2026-07-13T07:00:00Z',
      })}\n`,
      { mode: 0o600 },
    );
    const before = snapshotTree(reservationRoot);
    const request = scenario.input.request as Record<string, unknown>;
    const result = record(
      await module.createQuotaAdmissionStore({ home }).reserve(
        storeReservationRequest({
          ...request,
          key: 'unknown-lock-key',
          hash: 'unknown-lock-hash',
          aggregation_key: aggregationKey,
          capacity_pct: 10,
          state: 'held',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      ),
      'unknown lock result',
    );
    assert.equal(result.error, 'QUOTA_LOCK_BUSY');
    assert.equal(result.spawn_count, 0);
    assert.deepEqual(snapshotTree(reservationRoot), before);
    assert.equal(statSync(lockRef).mode & 0o777, 0o600);
  },
);

if (!FIXTURES_ONLY) {
  test('[cli] existing router reaches quota status/preflight/reserve/audit handlers', async () => {
    const { home } = tempHome('ccm-quota-cli-');
    const status = await cli(['quota', 'status', '--json'], home);
    assert.equal(
      status.code,
      0,
      `HONEST RED [cli]: quota status registry/handler/store seam is absent: ${status.stderr}`,
    );
    assert.equal(record(status.json.data, 'quota status data').schema, 'ccm/quota-status/v1');

    const missingAuthority = await cli(
      [
        'quota',
        'preflight',
        '--input',
        JSON.stringify({
          source_key: 'missing',
          reservation_id: 'missing',
          checked_at: '2026-07-13T08:00:25Z',
        }),
        '--json',
      ],
      home,
    );
    assert.equal(
      missingAuthority.code,
      0,
      `HONEST RED [cli preflight]: ${missingAuthority.stderr}`,
    );
    assert.equal(record(missingAuthority.json.data, 'preflight data').decision, 'reject');
    assert.equal(record(missingAuthority.json.data, 'preflight data').automatic_spawn_limit, 0);

    const authorityStore = (await storeModule()).createQuotaAdmissionStore({ home });
    const authorityAggregation = 'codex|cli-account|cli-pool|seven_day';
    await authorityStore.publishObservation({
      source_key: 'cli-codex-current',
      observation: {
        schema: 'ccm/quota-authority-observation/v1',
        provider: 'codex',
        provider_rule_revision: 'ccm/codex-7d-pacing/v1',
        source_revision: 'sha256:cli-live-r1',
        observed_at: new Date(Date.now() - 1_000).toISOString(),
        valid_until: new Date(Date.now() + 300_000).toISOString(),
        source_profile: {
          schema: 'ccm/quota-source-profile/v1',
          revision: 'ccm/test-quota-source/v1',
          fresh_ttl_sec: 60,
          hard_ttl_sec: 300,
          max_clock_skew_sec: 5,
        },
        account_id: 'cli-account',
        pool_id: 'cli-pool',
        identity_fingerprint: 'sha256:cli-identity',
        hard_window: { name: 'seven_day', duration_sec: 604_800 },
        policy: {
          decision: 'allow',
          revision: 'ccm/codex-7d-pacing/v1',
          hard_ceiling_used_pct: 85,
        },
        effects: { decision: 'allow', effect: 'read-only' },
        buckets: [
          {
            id: 'retired-five-hour',
            window: 'five_hour',
            duration_sec: 18_000,
            freshness: 'fresh',
            used_pct: 100,
            aggregation_key: 'codex|cli-account|cli-pool|five_hour',
          },
          {
            id: 'seven-day',
            window: 'seven_day',
            duration_sec: 604_800,
            freshness: 'fresh',
            used_pct: 20,
            safety_margin_pct: 5,
            projected_p80_pct: 4,
            aggregation_key: authorityAggregation,
          },
        ],
        rolling24h: { advisory: 'throttle-risk', hard_gate_effect: 'none' },
      },
    });
    const authorityReservation = record(
      await authorityStore.reserve(
        storeReservationRequest({
          aggregation_key: authorityAggregation,
          capacity_pct: 60,
          id: 'qres-cli-authority',
          key: 'cli-authority-idempotency',
          hash: 'sha256:cli-authority-request',
          amount_pct: 4,
          expires_at: '2099-07-14T01:00:00Z',
          source_revision: 'sha256:cli-live-r1',
          attempt_id: 'attempt-cli-authority',
          candidate_id: 'codex-cli-worker',
          account_id: 'cli-account',
          pool_id: 'cli-pool',
          identity_fingerprint: 'sha256:cli-identity',
        }),
      ),
      'CLI authority reservation',
    );
    const committed = record(
      await authorityStore.commitReservation({
        reservation_id: 'qres-cli-authority',
        checked_at: new Date().toISOString(),
        ticket: {
          schema: 'ccm/quota-admission-ticket/v1',
          ticket_id: 'ticket-cli-authority',
          reservation_id: 'qres-cli-authority',
          reservation_request_hash: authorityReservation.request_hash,
          reservation_expires_at: '2099-07-14T01:00:00Z',
          attempt_id: 'attempt-cli-authority',
          run_ref: 'run-cli-authority',
          account_id: 'cli-account',
          pool_id: 'cli-pool',
          identity_fingerprint: 'sha256:cli-identity',
          aggregation_key: authorityAggregation,
          live_source_revision: 'sha256:cli-live-r1',
          runtime_sha256: 'sha256:cli-runtime',
          launch_idempotency_key: 'launch-cli-authority',
          launch_nonce: 'nonce-cli-authority',
          issued_at: new Date().toISOString(),
          launch_by: '2099-07-14T01:00:00Z',
        },
      }),
      'CLI authority commit',
    );
    assert.equal(committed.action, 'committed');
    const authorityPreflight = await cli(
      [
        'quota',
        'preflight',
        '--input',
        JSON.stringify({
          source_key: 'cli-codex-current',
          reservation_id: 'qres-cli-authority',
          checked_at: new Date().toISOString(),
          policy: { decision: 'deny' },
          live: { state: 'exhausted', freshness: 'hard-stale' },
        }),
        '--json',
      ],
      home,
    );
    const authorityData = record(authorityPreflight.json.data, 'CLI authority preflight');
    assert.equal(authorityData.decision, 'launch-claim-allowed');
    assert.equal(authorityData.automatic_spawn_limit, 1);
    assert.equal(authorityData.hard_window, 'seven_day');
    assert.deepEqual(authorityData.ignored_windows, ['five_hour']);
    assert.deepEqual(authorityData.advisories, ['throttle-risk']);

    const reserveExpiresAt = new Date(Date.now() + 60_000).toISOString();
    const reserveInput = storeReservationRequest({
      aggregation_key: 'cli-reservation-key',
      capacity_pct: 10,
      id: 'qres-cli',
      key: 'cli-idempotency-key',
      hash: 'cli-request-hash',
      amount_pct: 4,
      state: 'held',
      expires_at: reserveExpiresAt,
    });
    await seedReservationAuthority(home, reserveInput);
    const reserved = await cli(
      ['quota', 'reserve', '--input', JSON.stringify(reserveInput), '--json'],
      home,
    );
    assert.equal(reserved.code, 0, `HONEST RED [cli reserve]: ${reserved.stderr}`);
    assert.equal(record(reserved.json.data, 'reserve data').action, 'created');
    const auditInput = {
      reservation_id: 'qres-cli',
      now: new Date(Date.now() + 120_000).toISOString(),
      launch_evidence: { store_locked: true, claim: 'absent', process_identity: 'proven-absent' },
    };
    const audited = await cli(
      ['quota', 'audit', '--input', JSON.stringify(auditInput), '--json'],
      home,
    );
    assert.equal(audited.code, 0, `HONEST RED [cli audit]: ${audited.stderr}`);
    assert.equal(record(audited.json.data, 'audit data').state, 'expired');
  });

  test('[cli] load-bearing admission fixtures execute through the production registry and store', async (t) => {
    await t.test('authenticated-without-quota-spawn-zero', async () => {
      const scenario = fixtureCase('admission.json', 'authenticated-without-quota-spawn-zero');
      const { home } = tempHome('ccm-quota-cli-auth-without-quota-');
      const result = await cli(
        [
          'quota',
          'preflight',
          '--input',
          JSON.stringify({
            source_key: 'missing-authenticated-quota',
            reservation_id: 'missing-authenticated-quota',
            checked_at: new Date().toISOString(),
            auth_state: scenario.input.auth_state,
          }),
          '--json',
        ],
        home,
      );
      assert.equal(result.code, 0, result.stderr);
      const data = record(result.json.data, scenario.name);
      assert.equal(data.decision, 'reject');
      assert.equal(data.automatic_spawn_limit, 0);
      assert.deepEqual(
        data.blocking_reasons,
        record(scenario.expected, scenario.name).blocking_reasons,
      );
      assert.equal(data.spawn_count, 0);
    });

    await t.test('observation-conflict-spawn-zero', async () => {
      const scenario = fixtureCase('admission.json', 'observation-conflict-spawn-zero');
      const { home } = tempHome('ccm-quota-cli-observation-conflict-');
      const nowMs = Date.now();
      const store = (await storeModule()).createQuotaAdmissionStore({ home });
      await store.publishObservation({
        source_key: 'conflicted-source',
        observation: {
          schema: 'ccm/quota-authority-observation/v1',
          observation_status: 'conflict',
          provider: 'codex',
          provider_rule_revision: 'ccm/codex-7d-pacing/v1',
          source_revision: 'sha256:conflicted-source',
          observed_at: new Date(nowMs - 1_000).toISOString(),
          valid_until: new Date(nowMs + 300_000).toISOString(),
          source_profile: {
            schema: 'ccm/quota-source-profile/v1',
            revision: 'ccm/test-quota-source/v1',
            fresh_ttl_sec: 60,
            hard_ttl_sec: 300,
            max_clock_skew_sec: 5,
          },
          account_id: 'identity-A',
          pool_id: 'pool-A',
          identity_fingerprint: 'sha256:identity-A',
          hard_window: { name: 'seven_day', duration_sec: 604_800 },
          policy: {
            decision: 'allow',
            revision: 'ccm/codex-7d-pacing/v1',
            hard_ceiling_used_pct: 85,
          },
          effects: { decision: 'allow', effect: 'read-only' },
          buckets: [],
        },
      });
      const result = await cli(
        [
          'quota',
          'preflight',
          '--input',
          JSON.stringify({
            source_key: 'conflicted-source',
            reservation_id: 'missing-conflicted-reservation',
            checked_at: new Date(nowMs).toISOString(),
          }),
          '--json',
        ],
        home,
      );
      assert.equal(result.code, 0, result.stderr);
      const data = record(result.json.data, scenario.name);
      assert.equal(data.decision, 'reject');
      assert.equal(data.automatic_spawn_limit, 0);
      assert.deepEqual(
        data.blocking_reasons,
        record(scenario.expected, scenario.name).blocking_reasons,
      );
      assert.equal(data.spawn_count, 0);
    });

    await t.test('provider-neutral-ample', async () => {
      const scenario = fixtureCase('admission.json', 'provider-neutral-ample');
      const { home } = tempHome('ccm-quota-cli-provider-neutral-');
      const nowMs = Date.now();
      const checkedAt = new Date(nowMs).toISOString();
      const expiresAt = new Date(nowMs + 120_000).toISOString();
      const aggregationKey = 'future-provider|identity-F|pool-F|thirty_day';
      const store = (await storeModule()).createQuotaAdmissionStore({ home });
      await store.publishObservation({
        source_key: 'future-provider-current',
        observation: {
          schema: 'ccm/quota-authority-observation/v1',
          provider: scenario.input.provider,
          provider_rule_revision: 'future-provider/thirty-day/v1',
          source_revision: 'live-future-r2',
          observed_at: new Date(nowMs - 1_000).toISOString(),
          valid_until: new Date(nowMs + 300_000).toISOString(),
          source_profile: {
            schema: 'ccm/quota-source-profile/v1',
            revision: 'ccm/test-quota-source/v1',
            fresh_ttl_sec: 60,
            hard_ttl_sec: 300,
            max_clock_skew_sec: 5,
          },
          account_id: 'identity-F',
          pool_id: 'pool-F',
          identity_fingerprint: 'sha256:identity-F',
          hard_window: scenario.input.provider_window_rule,
          policy: {
            decision: 'allow',
            revision: 'future-provider/thirty-day/v1',
            hard_ceiling_used_pct: 85,
          },
          effects: { decision: 'allow', effect: 'read-only' },
          buckets: [
            {
              id: 'future-thirty-day',
              window: 'thirty_day',
              duration_sec: 2_592_000,
              freshness: 'fresh',
              used_pct: 65,
              safety_margin_pct: 0,
              projected_p80_pct: 0,
              aggregation_key: aggregationKey,
            },
          ],
        },
      });
      const held = record(
        await store.reserve(
          storeReservationRequest({
            source_key: 'future-provider-current',
            aggregation_key: aggregationKey,
            capacity_pct: 20,
            amount_pct: 4,
            id: 'qres-future',
            key: 'key-future',
            checked_at: checkedAt,
            expires_at: expiresAt,
            source_revision: 'live-future-r2',
            attempt_id: 'attempt-future',
            account_id: 'identity-F',
            pool_id: 'pool-F',
            identity_fingerprint: 'sha256:identity-F',
          }),
        ),
        'provider-neutral hold',
      );
      assert.equal(held.action, 'created');
      const committed = record(
        await store.commitReservation({
          reservation_id: 'qres-future',
          checked_at: checkedAt,
          ticket: {
            schema: 'ccm/quota-admission-ticket/v1',
            ticket_id: 'ticket-future',
            reservation_id: 'qres-future',
            reservation_request_hash: held.request_hash,
            reservation_expires_at: expiresAt,
            attempt_id: 'attempt-future',
            run_ref: 'run-future',
            account_id: 'identity-F',
            pool_id: 'pool-F',
            identity_fingerprint: 'sha256:identity-F',
            aggregation_key: aggregationKey,
            live_source_revision: 'live-future-r2',
            runtime_sha256: 'sha256:future-runtime',
            launch_idempotency_key: 'launch-future',
            launch_nonce: 'nonce-future',
            issued_at: checkedAt,
            launch_by: new Date(nowMs + 60_000).toISOString(),
          },
        }),
        'provider-neutral commit',
      );
      assert.equal(committed.action, 'committed');
      const result = await cli(
        [
          'quota',
          'preflight',
          '--input',
          JSON.stringify({
            source_key: 'future-provider-current',
            reservation_id: 'qres-future',
            checked_at: checkedAt,
          }),
          '--json',
        ],
        home,
      );
      assert.equal(result.code, 0, result.stderr);
      const data = record(result.json.data, scenario.name);
      assert.equal(data.decision, 'launch-claim-allowed');
      assert.equal(data.automatic_spawn_limit, 1);
      assert.deepEqual(data.blocking_reasons, []);
      assert.equal(data.spawn_count, 0);
      assert.equal(data.hard_window, 'thirty_day');
    });
  });

  test('[cli] complete Codex/Cursor mutation matrix leaves entire watched config scopes unchanged', async () => {
    const { createQuotaEffectBoundary } = await import('@ccm/engine');
    const observationCalls = { auth: 0, quota: 0, trace: 0 };
    const quotaEffects = createQuotaEffectBoundary({
      profile: 'test',
      allow: ['auth.observe', 'quota.observe', 'test.trace.record'],
      handlers: {
        'auth.observe': (input) => {
          observationCalls.auth += 1;
          return input;
        },
        'quota.observe': (input) => {
          observationCalls.quota += 1;
          return input;
        },
        'test.trace.record': () => {
          observationCalls.trace += 1;
        },
      },
    });
    const { root, home } = tempHome('ccm-quota-mutation-');
    const codexHome = join(root, '.codex');
    const cursorHome = join(root, '.cursor');
    for (const [provider, configRoot] of [
      ['codex', codexHome],
      ['cursor', cursorHome],
    ] as const) {
      mkdirSync(join(configRoot, 'sessions'), { recursive: true, mode: 0o700 });
      mkdirSync(join(configRoot, 'accounts'), { recursive: true, mode: 0o700 });
      writeFileSync(join(configRoot, 'auth.json'), `{"safe_fixture":"${provider}-auth"}\n`, {
        mode: 0o600,
      });
      writeFileSync(
        join(configRoot, 'sessions', 'active.json'),
        `{"safe_fixture":"${provider}-session"}\n`,
        { mode: 0o600 },
      );
      writeFileSync(
        join(configRoot, 'accounts', 'pool.json'),
        `{"safe_fixture":"${provider}-account"}\n`,
        { mode: 0o600 },
      );
      writeFileSync(join(configRoot, 'credentials.json'), `${provider}-fake-non-secret\n`, {
        mode: 0o600,
      });
      symlinkSync('auth.json', join(configRoot, 'current-auth'));
    }
    const beforeCodex = snapshotTree(codexHome);
    const beforeCursor = snapshotTree(cursorHome);
    const codexWatcher = watchTree(codexHome);
    const cursorWatcher = watchTree(cursorHome);
    const mutationCases = fixture('lifecycle-effects.json').cases.filter((entry) =>
      ['codex', 'cursor'].includes(String(entry.input.provider)),
    );
    try {
      for (const scenario of mutationCases) {
        const result = await cli(
          ['quota', 'preflight', '--input', JSON.stringify(scenario.input), '--json'],
          home,
          { CODEX_HOME: codexHome, CURSOR_CONFIG_DIR: cursorHome },
          quotaEffects,
        );
        assert.equal(
          result.code,
          0,
          `HONEST RED [cli mutation:${scenario.name}]: ${result.stderr}`,
        );
        assert.deepEqual(record(result.json.data, `${scenario.name} data`), scenario.expected);
        await flushWatchEvents();
        assert.deepEqual(snapshotTree(codexHome), beforeCodex, `${scenario.name}: Codex tree`);
        assert.deepEqual(snapshotTree(cursorHome), beforeCursor, `${scenario.name}: Cursor tree`);
        assert.deepEqual(codexWatcher.events, [], `${scenario.name}: Codex mutation events`);
        assert.deepEqual(cursorWatcher.events, [], `${scenario.name}: Cursor mutation events`);
      }
    } finally {
      codexWatcher.close();
      cursorWatcher.close();
    }
    assert.deepEqual(
      observationCalls,
      { auth: 0, quota: 0, trace: 0 },
      'account-mutation denial cannot borrow auth/quota observation or test trace authority',
    );
  });
}

async function runWorkers(home: string, requests: Record<string, unknown>[]): Promise<unknown[]> {
  return runConcurrentWorkers(
    home,
    requests.map((request) => ({
      operation: 'reserve',
      request: storeReservationRequest(request),
    })),
  );
}

async function runConcurrentWorkers(
  home: string,
  payloads: ConcurrentWorkerPayload[],
): Promise<unknown[]> {
  assert.ok(payloads.length >= 10, 'concurrency oracle requires at least 10 workers');
  const readyBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const startBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const ready = new Int32Array(readyBuffer);
  const start = new Int32Array(startBuffer);
  const workers = payloads.map(
    (payload) =>
      new Worker(WORKER_PATH, {
        execArgv: ['--import', 'tsx'],
        workerData: { home, ...payload, ready: readyBuffer, start: startBuffer },
      }),
  );
  const outcomes = workers.map(
    (worker, index) =>
      new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`worker ${index} timed out`)), 15_000);
        worker.once('message', (message: unknown) => {
          clearTimeout(timer);
          const envelope = record(message, `worker ${index} envelope`);
          if (envelope.ok === true) resolve(envelope.result);
          else reject(new Error(String(envelope.error)));
        });
        worker.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      }),
  );
  const deadline = Date.now() + 10_000;
  while (Atomics.load(ready, 0) < workers.length) {
    if (Date.now() > deadline) throw new Error('workers did not reach simultaneous-start barrier');
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  Atomics.store(start, 0, 1);
  Atomics.notify(start, 0, workers.length);
  try {
    return await Promise.all(outcomes);
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
}
