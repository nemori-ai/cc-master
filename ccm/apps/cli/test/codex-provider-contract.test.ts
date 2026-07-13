import assert from 'node:assert/strict';
import { type ChildProcess, type SpawnOptions, spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as io from '../src/io.js';
import { CODEX_QUALIFICATION_OUTCOME_REVISION } from '../src/provider-qualification.js';

const CONTRACT = 'ccm/codex-candidate-provider-driver/v1';
const RESULT_SCHEMA = 'ccm/codex-provider-inspection/v1';
const RUN_RED = process.env.CCM_CODEX_PROVIDER_CONTRACT_RED === '1';
const FIXTURE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'codex-candidate-provider-driver-v1',
);
const CATALOG_PATH = join(FIXTURE_ROOT, 'scenarios.json');
const FAKE_CODEX_TEMPLATE_PATH = join(FIXTURE_ROOT, 'fake-codex.mjs');
const AUTHORITY_COUNTERFEIT_PATH = join(FIXTURE_ROOT, 'authority-counterfeit.mjs');
const OUTPUT_SCHEMA_PATH = join(FIXTURE_ROOT, 'structured-output.schema.json');
const CONTROL_PLACEHOLDER = '__CCM_CODEX_CONTRACT_CONTROL_BASE64__';
const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as FixtureCatalog;
const TMP: string[] = [];

const PREDICATE_IDS = [
  'binary-available',
  'behavioral-capability-proven',
  'auth-fresh',
  'entitlement-fresh',
  'registry-allowed',
  'model-exact',
  'effort-exact',
  'quota-7d-ample',
  'permission-read-only',
  'approval-never',
  'account-mutation-forbidden',
  'credential-write-forbidden',
] as const;

const CHILD_ENV_ALLOWLIST = ['CODEX_HOME', 'HOME', 'NO_COLOR', 'PATH', 'TMPDIR'] as const;
const DIAGNOSTIC_CANARIES = [
  'BASIC-NORMALIZED-CANARY',
  'COOKIE-NORMALIZED-CANARY',
  'COOKIE-TAIL-NORMALIZED-CANARY',
  'SET-COOKIE-NORMALIZED-CANARY',
  'SET-COOKIE-TAIL-NORMALIZED-CANARY',
] as const;
const DIAGNOSTIC_RAW_TEXT = [
  'benign normalized diagnostic remains',
  '  aUtHoRiZaTiOn \t:\t bAsIc BASIC-NORMALIZED-CANARY',
  'cOoKiE \t: session=COOKIE-NORMALIZED-CANARY; secondary=COOKIE-TAIL-NORMALIZED-CANARY',
  'sEt-CoOkIe:\tsession=SET-COOKIE-NORMALIZED-CANARY; secondary=SET-COOKIE-TAIL-NORMALIZED-CANARY',
].join('\n');
const DIAGNOSTIC_REDACTED_TEXT = [
  'benign normalized diagnostic remains',
  '  aUtHoRiZaTiOn \t:\t bAsIc [REDACTED]',
  'cOoKiE \t: [REDACTED]',
  'sEt-CoOkIe:\t[REDACTED]',
].join('\n');
const NO_COLOR_PARENT_CANARY = 'ALLOWED-KEY-SECRET-NO-COLOR';
const IDENTITY_METADATA_FAILURE_IDS = new Set([
  'CXD-013',
  'CXD-050',
  'CXD-051',
  'CXD-052',
  'CXD-053',
  'CXD-054',
]);

const EVIDENCE_ID_SCHEMA = 'ccm/provider-evidence-reference/v1';
const BUCKET_ID_SCHEMA = 'ccm/codex-quota-bucket-reference/v1';
const ROLLING_DERIVATION_SCHEMA = 'ccm/codex-rolling-24h-derivation/v1';
const PROVIDER_RUNTIME_SCHEMA = 'ccm/provider-runtime-capabilities/v1';
const require = createRequire(import.meta.url);
const capabilitySpawn = spawn;

interface FixtureCatalog {
  schema: string;
  contract: string;
  result_schema: string;
  planned_endpoint: string[];
  defaults: FixtureState;
  scenarios: FixtureScenario[];
}

interface FixtureState {
  request: Record<string, any>;
  probe: Record<string, any>;
  execution: Record<string, any>;
}

interface FixtureScenario {
  id: string;
  title: string;
  overrides: Record<string, any>;
  expect: {
    automatic_eligible: boolean;
    status: string;
    error_code: string | null;
    execution_attempted: boolean;
    required_spawn_kinds: string[];
    credential_writes: number;
    account_mutations: number;
    five_hour_effect?: string;
    rolling_24h?: string;
    credential_sentinel_unchanged?: boolean;
    stdout_truncated?: boolean;
    stderr_truncated?: boolean;
    actual_retained?: boolean;
    error_phase?: string;
    error_detail?: string;
    error_reason?: string;
    elapsed_lt_ms?: number;
    expected_process_phases?: string[];
  };
}

const TEST_QUALIFICATION_PHASES = [
  'version',
  'root-help',
  'exec-help',
  'app-server-help',
  'app-server-schema',
  'exec-parse-only',
] as const;

const qualificationTimeoutScenarios: FixtureScenario[] = TEST_QUALIFICATION_PHASES.map(
  (phase, index) => ({
    id: `CXD-QTO-${phase}`,
    title: `controlled timeout finalizes attempted ${phase} evidence`,
    overrides: {
      request: { timeouts_ms: { startup: 200, idle: 1000, hard: 5000 } },
      probe: {
        binary: { qualification_control: { hang_phase: phase, ignore_sigterm: false } },
      },
    },
    expect: {
      automatic_eligible: false,
      status: 'rejected',
      error_code: 'startup_timeout',
      error_phase: phase,
      elapsed_lt_ms: 1000,
      execution_attempted: false,
      required_spawn_kinds: [],
      expected_process_phases: TEST_QUALIFICATION_PHASES.slice(0, index + 1),
      credential_writes: 0,
      account_mutations: 0,
    },
  }),
);

interface TraceRecord {
  schema: string;
  run_token: string;
  kind: string;
  argv: string[];
  env_keys: string[];
  method?: string | null;
  correlation_id?: string | null;
  payload_sha256?: string;
  proof_nonce?: string | null;
  event_type?: string | null;
  signal?: string;
  phase?: string;
  [key: string]: unknown;
}

afterEach(() => {
  for (const path of TMP.splice(0)) rmSync(path, { recursive: true, force: true });
});

function isPlainObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactPredicateShape(data: Record<string, any>): void {
  const predicates = data.candidate.predicates as Record<string, any>[];
  assert.deepEqual(predicates.map((predicate) => predicate.id).sort(), [...PREDICATE_IDS].sort());
  for (const predicate of predicates) {
    assert.deepEqual(
      Object.keys(predicate).sort(),
      ['evidence_ids', 'id', 'passed', 'reason_code'],
      `${predicate.id} must expose only the frozen predicate keys`,
    );
    assert.equal(typeof predicate.passed, 'boolean');
    assert.equal(typeof predicate.reason_code, 'string');
    assert.ok(predicate.reason_code.length > 0, `${predicate.id} needs a deterministic reason`);
    assert.ok(Array.isArray(predicate.evidence_ids));
    for (const evidenceId of predicate.evidence_ids) {
      assert.ok(
        data.evidence.some((entry: Record<string, any>) => entry.evidence_id === evidenceId),
        `${predicate.id} references missing evidence ${evidenceId}`,
      );
    }
  }
}

function merge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) return structuredClone(override) as T;
  const result = structuredClone(base) as Record<string, any>;
  for (const [key, value] of Object.entries(override)) {
    result[key] =
      isPlainObject(value) && isPlainObject(result[key])
        ? merge(result[key], value)
        : structuredClone(value);
  }
  return result as T;
}

function materialize(scenario: FixtureScenario): FixtureState {
  return merge(catalog.defaults, scenario.overrides);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  const bytes = typeof value === 'string' ? value : JSON.stringify(canonical(value));
  return createHash('sha256').update(bytes).digest('hex');
}

function readTrace(path: string): TraceRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TraceRecord);
}

function snapshotTree(root: string): string {
  const records: Record<string, unknown>[] = [];
  const visit = (path: string, relativePath: string) => {
    const stat = lstatSync(path);
    const mode = stat.mode & 0o7777;
    if (stat.isDirectory()) {
      records.push({ path: relativePath, type: 'dir', mode });
      for (const child of readdirSync(path).sort())
        visit(join(path, child), join(relativePath, child));
    } else if (stat.isSymbolicLink()) {
      records.push({ path: relativePath, type: 'symlink', mode, target: readlinkSync(path) });
    } else {
      records.push({
        path: relativePath,
        type: 'file',
        mode,
        bytes: stat.size,
        sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      });
    }
  };
  visit(root, '.');
  return digest(records);
}

function writeSentinel(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${value}\n`, 'utf8');
  chmodSync(path, 0o444);
}

function writeForbiddenTool(path: string, tracePath: string): void {
  const source = `#!/usr/bin/env node\nimport { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(
    tracePath,
  )}, JSON.stringify({tool: process.argv[1], argv: process.argv.slice(2)}) + '\\n');\nprocess.exit(93);\n`;
  writeFileSync(path, source, 'utf8');
  chmodSync(path, 0o755);
}

function injectDynamicProof(state: FixtureState, proofNonce: string): FixtureState {
  const result = structuredClone(state);
  result.execution.jsonl = result.execution.jsonl.map((event: unknown) => {
    if (!isPlainObject(event) || event.type !== 'ccm.fixture.provider_metadata') return event;
    return { ...event, proof_nonce: proofNonce };
  });
  if (isPlainObject(result.execution.structured_output)) {
    result.execution.structured_output.provider_proof = proofNonce;
  }
  return result;
}

function writeControlledCodex(
  binaryPath: string,
  state: FixtureState,
  proofNonce: string,
  runToken: string,
  tracePath: string,
): void {
  const template = readFileSync(FAKE_CODEX_TEMPLATE_PATH, 'utf8');
  assert.equal(template.split(CONTROL_PLACEHOLDER).length, 2, 'fake template has one control slot');
  const providerFixture = {
    probe: {
      binary: state.probe.binary,
      auth: state.probe.auth,
      entitlement: state.probe.entitlement,
      quota: state.probe.quota,
    },
    execution: state.execution,
  };
  const control = Buffer.from(
    JSON.stringify({
      fixture: providerFixture,
      proof_nonce: proofNonce,
      run_token: runToken,
      trace_path: tracePath,
    }),
  ).toString('base64');
  writeFileSync(binaryPath, template.replace(CONTROL_PLACEHOLDER, control), 'utf8');
  chmodSync(binaryPath, 0o755);
}

function assertExactChildEnvKeys(keys: readonly string[]): void {
  assert.deepEqual(
    [...keys].sort(),
    [...CHILD_ENV_ALLOWLIST],
    'child env is not the frozen allowlist',
  );
}

function assertExactChildEnvironment(
  actual: Record<string, string>,
  expected: Record<string, string>,
): void {
  assertExactChildEnvKeys(Object.keys(actual));
  assert.deepEqual(actual, expected, 'provider child env values drifted');
}

interface AuthorityAttempt {
  authority: 'network' | 'process';
  api: string;
}

interface HostAuthorityGuard {
  attempts: AuthorityAttempt[];
  webSocketSurface: 'native-patched' | 'absent-deny-stub';
  restore: () => void;
}

function installHostAuthorityGuard(): HostAuthorityGuard {
  const attempts: AuthorityAttempt[] = [];
  const restorers: Array<() => void> = [];
  const patch = (
    module: Record<string, any>,
    key: string,
    authority: AuthorityAttempt['authority'],
    api: string,
  ) => {
    const original = module[key];
    assert.equal(typeof original, 'function', `authority guard cannot patch unavailable ${api}`);
    module[key] = function deniedAuthority(..._args: unknown[]) {
      attempts.push({ authority, api });
      throw new Error(`provider host ${authority} authority denied: ${api}`);
    };
    restorers.push(() => {
      module[key] = original;
    });
  };

  const childProcess = require('node:child_process') as Record<string, any>;
  for (const key of [
    'spawn',
    'spawnSync',
    'exec',
    'execSync',
    'execFile',
    'execFileSync',
    'fork',
  ]) {
    patch(childProcess, key, 'process', `child_process.${key}`);
  }
  const cluster = require('node:cluster') as Record<string, any>;
  patch(cluster, 'fork', 'process', 'cluster.fork');
  const workers = require('node:worker_threads') as Record<string, any>;
  patch(workers, 'Worker', 'process', 'worker_threads.Worker');

  const networkModules: Array<[string, string, string[]]> = [
    ['node:net', 'net', ['connect', 'createConnection']],
    ['node:http', 'http', ['request', 'get']],
    ['node:https', 'https', ['request', 'get']],
    ['node:tls', 'tls', ['connect']],
    ['node:dgram', 'dgram', ['createSocket']],
    ['node:dns', 'dns', ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny']],
  ];
  for (const [moduleName, apiPrefix, keys] of networkModules) {
    const module = require(moduleName) as Record<string, any>;
    for (const key of keys) patch(module, key, 'network', `${apiPrefix}.${key}`);
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: unknown, _init?: unknown) => {
    attempts.push({ authority: 'network', api: 'globalThis.fetch' });
    throw new Error('provider host network authority denied: globalThis.fetch');
  }) as typeof fetch;
  restorers.push(() => {
    globalThis.fetch = originalFetch;
  });
  const globalWithWebSocket = globalThis as unknown as Record<string, any>;
  const originalWebSocket = globalWithWebSocket.WebSocket;
  const hadOwnWebSocket = Object.hasOwn(globalWithWebSocket, 'WebSocket');
  const webSocketSurface =
    typeof originalWebSocket === 'function' ? 'native-patched' : 'absent-deny-stub';
  globalWithWebSocket.WebSocket = function DeniedWebSocket() {
    attempts.push({ authority: 'network', api: 'globalThis.WebSocket' });
    throw new Error('provider host network authority denied: globalThis.WebSocket');
  };
  restorers.push(() => {
    if (hadOwnWebSocket) globalWithWebSocket.WebSocket = originalWebSocket;
    else delete globalWithWebSocket.WebSocket;
  });
  syncBuiltinESMExports();

  return {
    attempts,
    webSocketSurface,
    restore: () => {
      for (const restore of restorers.reverse()) restore();
      syncBuiltinESMExports();
    },
  };
}

interface ProviderSpawnSpec {
  executable: string;
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  stdio?: SpawnOptions['stdio'];
}

interface ControlledOwnedChild {
  child: ChildProcess;
  tree: {
    schema: 'ccm/provider-owned-process-tree/v1';
    kind: 'posix-process-group';
    groupId: number;
    signal: (signal: NodeJS.Signals) => boolean;
    isAlive: () => boolean;
  };
}

function qualificationPhase(argv: string[]): string {
  if (argv.length === 1 && argv[0] === '--version') return 'version';
  if (argv.length === 1 && argv[0] === '--help') return 'root-help';
  if (argv[0] === 'app-server' && argv[1] === 'generate-json-schema') return 'app-server-schema';
  if (argv[0] === 'app-server' && argv.includes('--help')) return 'app-server-help';
  if (argv.includes('exec') && argv.includes('--help'))
    return argv.includes('--output-schema') ? 'exec-parse-only' : 'exec-help';
  if (argv[0] === 'app-server') return 'app-server';
  return 'exec';
}

interface ControlledProviderRuntime {
  schema: string;
  process: {
    resolveExecutable: (provider: string) => string | null;
    spawnProvider: (spec: ProviderSpawnSpec) => ControlledOwnedChild;
  };
  network: { request: (operation: string) => never };
  processCalls: ProviderSpawnSpec[];
  networkCalls: string[];
}

function createControlledProviderRuntime(
  binaryPath: string,
  expectedChildEnv: Record<string, string>,
): ControlledProviderRuntime {
  const processCalls: ProviderSpawnSpec[] = [];
  const networkCalls: string[] = [];
  return {
    schema: PROVIDER_RUNTIME_SCHEMA,
    process: {
      resolveExecutable: (provider) => (provider === 'codex' ? binaryPath : null),
      spawnProvider: (spec) => {
        assert.equal(
          spec.executable,
          binaryPath,
          'provider capability may spawn only resolved Codex',
        );
        assertExactChildEnvironment(spec.env, expectedChildEnv);
        processCalls.push(structuredClone(spec));
        const child = capabilitySpawn(spec.executable, spec.argv, {
          cwd: spec.cwd,
          env: spec.env,
          stdio: spec.stdio ?? ['pipe', 'pipe', 'pipe'],
          detached: true,
        });
        assert.ok(Number.isSafeInteger(child.pid) && Number(child.pid) > 0);
        const groupId = Number(child.pid);
        const signalGroup = (signal: NodeJS.Signals | 0): boolean => {
          try {
            process.kill(-groupId, signal);
            return true;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
            throw error;
          }
        };
        return {
          child,
          tree: {
            schema: 'ccm/provider-owned-process-tree/v1',
            kind: 'posix-process-group',
            groupId,
            signal: (signal) => signalGroup(signal),
            isAlive: () => signalGroup(0),
          },
        };
      },
    },
    network: {
      request: (operation) => {
        networkCalls.push(operation);
        throw new Error(`provider host network authority denied: ${operation}`);
      },
    },
    processCalls,
    networkCalls,
  };
}

function evidenceByMethod(data: Record<string, any>, method: string): Record<string, any> {
  const found = data.evidence.find((entry: Record<string, any>) => entry.source?.method === method);
  assert.ok(found, `missing normalized evidence for ${method}`);
  return found;
}

function evidenceId(method: string, revision: string, payloadSha256: string): string {
  return `ev-${digest({
    schema: EVIDENCE_ID_SCHEMA,
    source_method: method,
    source_revision: revision,
    payload_sha256: payloadSha256,
  })}`;
}

function assertAttemptedQualificationFailureBinding(
  data: Record<string, any>,
  phase: string,
  outcome: 'nonzero' | 'timeout',
): void {
  const evidence = evidenceByMethod(data, `codex-qualification/${phase}`);
  assert.equal(evidence.kind, 'binary-capability');
  assert.equal(evidence.source.revision, CODEX_QUALIFICATION_OUTCOME_REVISION);
  assert.equal(evidence.source.schema_version, CODEX_QUALIFICATION_OUTCOME_REVISION);
  assert.equal(evidence.freshness, 'unknown');
  assert.equal(evidence.completeness, 'complete');
  assert.ok(evidence.errors.some((error: string) => error.includes(`outcome=${outcome}`)));
  assert.equal(
    evidence.evidence_id,
    evidenceId(evidence.source.method, evidence.source.revision, evidence.payload_sha256),
  );

  const byPredicate = new Map(
    data.candidate.predicates.map((predicate: Record<string, any>) => [predicate.id, predicate]),
  );
  assert.deepEqual(byPredicate.get('binary-available'), {
    id: 'binary-available',
    passed: true,
    reason_code: 'predicate_passed',
    evidence_ids: [evidence.evidence_id],
  });
  assert.deepEqual(byPredicate.get('behavioral-capability-proven'), {
    id: 'behavioral-capability-proven',
    passed: false,
    reason_code: 'binary_capability_unproven',
    evidence_ids: [evidence.evidence_id],
  });
  for (const predicateId of [
    'auth-fresh',
    'entitlement-fresh',
    'registry-allowed',
    'model-exact',
    'effort-exact',
    'quota-7d-ample',
  ]) {
    assert.deepEqual(byPredicate.get(predicateId), {
      id: predicateId,
      passed: false,
      reason_code: 'not_evaluated',
      evidence_ids: [],
    });
  }

  const skipFinalize = structuredClone(data);
  skipFinalize.evidence = skipFinalize.evidence.filter(
    (entry: Record<string, any>) => entry.evidence_id !== evidence.evidence_id,
  );
  assert.throws(() => assertExactPredicateShape(skipFinalize), /references missing evidence/u);

  const clearIds = structuredClone(data);
  const clearPredicate = clearIds.candidate.predicates.find(
    (predicate: Record<string, any>) => predicate.id === 'behavioral-capability-proven',
  );
  clearPredicate.reason_code = 'not_evaluated';
  clearPredicate.evidence_ids = [];
  assert.throws(
    () => assertAttemptedQualificationFailureBinding(clearIds, phase, outcome),
    /Expected values to be strictly deep-equal/u,
  );

  const wrongFacet = structuredClone(data);
  wrongFacet.candidate.predicates.find(
    (predicate: Record<string, any>) => predicate.id === 'behavioral-capability-proven',
  ).evidence_ids = [evidenceByMethod(wrongFacet, 'ccm-provider-inspect/request').evidence_id];
  assert.throws(
    () => assertAttemptedQualificationFailureBinding(wrongFacet, phase, outcome),
    /Expected values to be strictly deep-equal/u,
  );
}

function assertExactEligiblePredicateBindings(data: Record<string, any>): void {
  assert.equal(data.candidate.automatic_eligible, true);
  const byId = new Map(
    data.evidence.map((entry: Record<string, any>) => [entry.evidence_id, entry]),
  );
  const capability = evidenceByMethod(data, 'codex-capability/assess').evidence_id;
  const request = evidenceByMethod(data, 'ccm-provider-inspect/request').evidence_id;
  const entitlement = evidenceByMethod(data, 'model/list').evidence_id;
  const registry = evidenceByMethod(data, 'ccm-model-registry/read').evidence_id;
  const expected: Record<string, string[]> = {
    'binary-available': [capability],
    'behavioral-capability-proven': [capability],
    'auth-fresh': [evidenceByMethod(data, 'account/read').evidence_id],
    'entitlement-fresh': [entitlement],
    'registry-allowed': [registry],
    'model-exact': [entitlement],
    'effort-exact': [entitlement, registry],
    'quota-7d-ample': [evidenceByMethod(data, 'account/rateLimits/read').evidence_id],
    'permission-read-only': [request],
    'approval-never': [request],
    'account-mutation-forbidden': [request],
    'credential-write-forbidden': [request],
  };
  const allowed: Record<string, string[]> = {
    'binary-available': ['binary-capability|codex-capability/assess'],
    'behavioral-capability-proven': ['binary-capability|codex-capability/assess'],
    'auth-fresh': ['auth|account/read'],
    'entitlement-fresh': ['entitlement|model/list'],
    'registry-allowed': ['model-catalog|ccm-model-registry/read'],
    'model-exact': ['entitlement|model/list'],
    'effort-exact': ['entitlement|model/list', 'model-catalog|ccm-model-registry/read'],
    'quota-7d-ample': ['quota|account/rateLimits/read'],
    'permission-read-only': ['execution|ccm-provider-inspect/request'],
    'approval-never': ['execution|ccm-provider-inspect/request'],
    'account-mutation-forbidden': ['execution|ccm-provider-inspect/request'],
    'credential-write-forbidden': ['execution|ccm-provider-inspect/request'],
  };
  for (const predicate of data.candidate.predicates as Record<string, any>[]) {
    assert.equal(predicate.passed, true);
    assert.equal(predicate.reason_code, 'predicate_passed');
    assert.deepEqual(predicate.evidence_ids, expected[predicate.id]);
    const facets = (predicate.evidence_ids as string[]).map((id: string) => {
      const entry = byId.get(id) as Record<string, any> | undefined;
      assert.ok(entry, `unbound predicate evidence: ${predicate.id}/${id}`);
      assert.equal(
        entry.evidence_id,
        evidenceId(entry.source.method, entry.source.revision, entry.payload_sha256),
      );
      return `${entry.kind}|${entry.source.method}`;
    });
    assert.deepEqual(facets, allowed[predicate.id]);
  }
}

function expectedAppServerPayload(
  method: 'account/read' | 'model/list' | 'account/rateLimits/read',
  state: FixtureState,
  proofNonce: string,
): Record<string, any> {
  if (method === 'account/read') {
    const auth = state.probe.auth;
    return {
      account:
        auth.state === 'authenticated'
          ? { type: 'chatgpt', accountId: auth.account_id, planType: auth.plan_type }
          : null,
      authState: auth.state,
      requiresOpenaiAuth: true,
      observedAt: auth.observed_at,
      expiresAt: auth.valid_until,
      fixtureProof: proofNonce,
    };
  }
  if (method === 'model/list') {
    const entitlement = state.probe.entitlement;
    return {
      data: entitlement.models,
      nextCursor: null,
      observedAt: entitlement.observed_at,
      expiresAt: entitlement.valid_until,
      fixtureProof: proofNonce,
    };
  }
  const quota = state.probe.quota;
  return {
    ...quota.payload,
    observedAt: quota.observed_at,
    expiresAt: quota.valid_until,
    sevenDayHistory: quota.seven_day_history,
    fixtureProof: proofNonce,
  };
}

function expectedClientRequestSchema(): Record<string, any> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'ClientRequest',
    oneOf: ['initialize', 'account/read', 'model/list', 'account/rateLimits/read'].map(
      (method) => ({
        type: 'object',
        required: ['id', 'method', 'params'],
        properties: { method: { const: method } },
      }),
    ),
  };
}

function expectedAppServerRevision(): string {
  return `sha256:${digest(expectedClientRequestSchema())}`;
}

function normalizedBinaryVersion(state: FixtureState): string {
  return String(state.probe.binary.version).replace(/^codex-cli\s+/u, '');
}

function expectedRedactedPayload(value: unknown, categories: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((child) => expectedRedactedPayload(child, categories));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      const normalized = key.replaceAll(/[-_]/gu, '').toLowerCase();
      const kind = normalized.includes('email')
        ? 'email'
        : normalized.includes('token') ||
            normalized.includes('authorization') ||
            normalized.includes('cookie') ||
            normalized.includes('apikey')
          ? 'token'
          : normalized.includes('password') ||
              normalized.includes('secret') ||
              (normalized.includes('credential') && !normalized.endsWith('credentialid'))
            ? 'credential'
            : null;
      if (!kind) return [key, expectedRedactedPayload(child, categories)];
      categories.add(kind);
      return [key, kind === 'email' ? '[REDACTED_EMAIL]' : '[REDACTED]'];
    }),
  );
}

function expectedEvidence(
  method: string,
  revision: string,
  payload: unknown,
  envelope: Record<string, any>,
  source: {
    kind?: string;
    surface?: string;
    binaryRealpath?: string | null;
    binaryVersion?: string | null;
    schemaVersion?: string | null;
  } = {},
): Record<string, any> {
  const categories = new Set<string>();
  const payloadSha256 = digest(expectedRedactedPayload(payload, categories));
  return {
    evidence_id: evidenceId(method, revision, payloadSha256),
    kind: source.kind ?? 'execution',
    source: {
      provider: 'codex',
      surface: source.surface ?? 'cli-headless',
      method,
      revision,
      binary_realpath: source.binaryRealpath ?? null,
      binary_version: source.binaryVersion ?? null,
      schema_version: source.schemaVersion ?? null,
    },
    payload_sha256: payloadSha256,
    observed_at: envelope.observed_at,
    valid_until: envelope.valid_until,
    freshness: envelope.freshness,
    completeness: envelope.completeness,
    redactions: [...categories].sort(),
    errors: [],
  };
}

function assertEvidenceBinding(actual: Record<string, any>, expected: Record<string, any>): void {
  assert.equal(actual.evidence_id, expected.evidence_id, `${expected.source.method} id drifted`);
  assert.equal(actual.kind, expected.kind, `${expected.source.method} kind drifted`);
  assert.deepEqual(actual.source, expected.source, `${expected.source.method} revision drifted`);
  assert.equal(
    actual.payload_sha256,
    expected.payload_sha256,
    `${expected.source.method} payload digest drifted`,
  );
  for (const key of ['observed_at', 'valid_until', 'freshness', 'completeness']) {
    assert.equal(actual[key], expected[key], `${expected.source.method} ${key} drifted`);
  }
  assert.deepEqual(actual.redactions, expected.redactions);
  assert.deepEqual(actual.errors, expected.errors);
}

function pointerEscape(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function bucketId(sourceEvidenceId: string, sourceRevision: string, sourcePath: string): string {
  return `bucket-${digest({
    schema: BUCKET_ID_SCHEMA,
    source_evidence_id: sourceEvidenceId,
    source_revision: sourceRevision,
    source_path: sourcePath,
  })}`;
}

function expectedQuotaBuckets(
  state: FixtureState,
  quotaEvidence: Record<string, any>,
): Record<string, any>[] {
  const rows: Array<{ schema: string; path: string; row: Record<string, any> }> = [];
  rows.push({
    schema: 'legacy-rateLimits',
    path: '/rateLimits',
    row: state.probe.quota.payload.rateLimits,
  });
  for (const [limitId, row] of Object.entries(
    state.probe.quota.payload.rateLimitsByLimitId as Record<string, Record<string, any>>,
  )) {
    rows.push({
      schema: 'rateLimitsByLimitId',
      path: `/rateLimitsByLimitId/${pointerEscape(limitId)}`,
      row,
    });
  }
  const buckets: Record<string, any>[] = [];
  for (const { schema, path, row } of rows) {
    for (const role of ['primary', 'secondary'] as const) {
      const window = row[role];
      if (!window) continue;
      const sourcePath = `${path}/${role}`;
      buckets.push({
        bucket_id: bucketId(quotaEvidence.evidence_id, quotaEvidence.source.revision, sourcePath),
        provider_limit_id: row.limitId ?? 'legacy-single',
        limit_name: row.limitName ?? null,
        credential_id: row.credentialId ?? 'unknown',
        account_id: row.accountId ?? 'unknown',
        payer_id: row.payerId ?? 'unknown',
        pool_id: row.poolId ?? 'unknown',
        shared_scope: row.sharedScope ?? 'unknown',
        unit: row.unit ?? 'unknown',
        window: {
          duration_minutes: window.windowDurationMins ?? null,
          used_percent: window.usedPercent ?? null,
          resets_at:
            typeof window.resetsAt === 'number'
              ? new Date(window.resetsAt * 1000).toISOString()
              : null,
        },
        rate_limit_reached_type: row.rateLimitReachedType ?? null,
        observed_at: state.probe.quota.observed_at,
        valid_until: state.probe.quota.valid_until,
        freshness: state.probe.quota.freshness,
        source_method: 'account/rateLimits/read',
        source_schema: schema,
        source_evidence_id: quotaEvidence.evidence_id,
        source_payload_sha256: quotaEvidence.payload_sha256,
        source_revision: quotaEvidence.source.revision,
        source_path: sourcePath,
      });
    }
  }
  return buckets.sort((left, right) => left.source_path.localeCompare(right.source_path));
}

function expectedRolling24(
  state: FixtureState,
  quotaEvidence: Record<string, any>,
): Record<string, any> {
  const common = {
    advisory_only: true,
    source_evidence_ids: [quotaEvidence.evidence_id],
    source_payload_sha256: quotaEvidence.payload_sha256,
    source_revision: quotaEvidence.source.revision,
  };
  if (state.probe.quota.freshness !== 'fresh') {
    const unavailable = {
      status: 'unavailable',
      ...common,
      delta_percent_points: null,
      elapsed_hours: null,
      daily_budget_percent_points: null,
      burn_ratio: null,
      coverage: null,
      confidence: 'unavailable',
    };
    return {
      ...unavailable,
      derivation_sha256: digest({
        schema: ROLLING_DERIVATION_SCHEMA,
        algorithm: 'codex-seven-day-snapshot-delta/v1',
        source: common,
        history: state.probe.quota.seven_day_history,
        output: unavailable,
      }),
    };
  }
  const history = state.probe.quota.seven_day_history;
  const elapsedHours =
    (Date.parse(history[1].observed_at) - Date.parse(history[0].observed_at)) / 3_600_000;
  const delta = history[1].used_percent - history[0].used_percent;
  const dailyBudget = 100 / 7;
  const available = {
    status: 'available',
    ...common,
    delta_percent_points: delta,
    elapsed_hours: elapsedHours,
    daily_budget_percent_points: dailyBudget,
    burn_ratio: delta / (elapsedHours / 24) / dailyBudget,
    coverage: 1,
    confidence: 'high',
  };
  return {
    ...available,
    derivation_sha256: digest({
      schema: ROLLING_DERIVATION_SCHEMA,
      algorithm: 'codex-seven-day-snapshot-delta/v1',
      source: common,
      history,
      output: available,
    }),
  };
}

function expectedResolutionPayload(
  request: Record<string, any>,
  resolved: Record<string, any>,
  entitlementEvidence: Record<string, any>,
  registryEvidence: Record<string, any>,
): Record<string, any> {
  return {
    schema: 'ccm/codex-model-resolution-intersection/v1',
    requested: { model: request.model, effort: request.effort },
    resolved,
    catalog: {
      evidence_id: entitlementEvidence.evidence_id,
      payload_sha256: entitlementEvidence.payload_sha256,
      revision: entitlementEvidence.source.revision,
    },
    registry: {
      evidence_id: registryEvidence.evidence_id,
      payload_sha256: registryEvidence.payload_sha256,
      revision: registryEvidence.source.revision,
    },
  };
}

function assertProviderDerivationProof(
  data: Record<string, any>,
  trace: TraceRecord[],
  scenario: FixtureScenario,
  state: FixtureState,
  proofNonce: string,
  registryDocument: Record<string, any>,
): void {
  const kinds = trace.map((record) => record.kind);
  for (const kind of scenario.expect.required_spawn_kinds) {
    assert.ok(kinds.includes(kind), `${scenario.id} did not execute fixture path ${kind}`);
  }

  if (scenario.expect.required_spawn_kinds.includes('app-server-spawn')) {
    const requests = trace.filter((record) => record.kind === 'app-server-request');
    const responses = trace.filter((record) => record.kind === 'app-server-response');
    for (const method of ['initialize', 'account/read', 'model/list', 'account/rateLimits/read']) {
      const request = requests.find((record) => record.method === method);
      assert.ok(request, `missing real app-server JSON-RPC request ${method}`);
      assert.ok(request.correlation_id, `${method} must carry a correlation id`);
      const response = responses.find(
        (record) => record.method === method && record.correlation_id === request.correlation_id,
      );
      assert.ok(response, `missing correlated app-server response ${method}`);
      assert.equal(response.proof_nonce, proofNonce, `${method} did not return the hidden proof`);
      if (method !== 'initialize') {
        const expectedPayload = expectedAppServerPayload(
          method as 'account/read' | 'model/list' | 'account/rateLimits/read',
          state,
          proofNonce,
        );
        assert.equal(
          response.payload_sha256,
          digest(expectedPayload),
          `${method} trace is not bound to the emitted source payload`,
        );
        const normalized = evidenceByMethod(data, method);
        assert.equal(normalized.payload_sha256, response.payload_sha256);
        assert.ok(normalized.evidence_id, `${method} evidence id is required`);
      }
    }

    const registryEvidence = evidenceByMethod(data, 'ccm-model-registry/read');
    assert.equal(registryEvidence.payload_sha256, digest(registryDocument));
  }

  const execSpawn = trace.find((record) => record.kind === 'exec-spawn');
  if (scenario.expect.execution_attempted) {
    assert.ok(execSpawn, `${scenario.id} superficial qualification cannot replace fake exec`);
    const argv = execSpawn.argv;
    assert.deepEqual(argv.slice(0, 3), ['--ask-for-approval', 'never', 'exec']);
    assert.equal(argv.at(-1), '-', 'stdin prompt marker must be the final argument');
    assert.ok(argv.includes('--json'));
    assert.ok(argv.includes('--output-schema'));
    assert.ok(argv.includes('--output-last-message') || argv.includes('-o'));
    assert.ok(argv.includes('--model'));
    assert.ok(argv.includes('--sandbox'));
    assert.ok(argv.includes('read-only'));
    assert.ok(argv.includes('--ask-for-approval'));
    assert.ok(argv.includes('never'));
    assert.ok(argv.includes('--ephemeral'));
    assert.ok(argv.includes('-C') || argv.includes('--cd'));
    assert.ok(!argv.some((token) => ['login', 'logout', 'switch'].includes(token)));
    assert.deepEqual(
      data.execution.invocation.argv,
      argv,
      'invocation audit must replay spawn argv',
    );
    assert.deepEqual(data.execution.invocation.env_keys, [...CHILD_ENV_ALLOWLIST].sort());
    assert.equal(data.execution.invocation.cwd, data.execution.invocation.argv.at(-2));

    if (scenario.expect.status === 'timed_out' || scenario.expect.status === 'cancelled') {
      assert.ok(
        trace.some((record) => record.kind === 'signal' && record.phase === 'exec'),
        `${scenario.id} timeout/cancel must be observed at the spawned child`,
      );
    }

    const metadata = trace.find(
      (record) =>
        record.kind === 'exec-jsonl' && record.event_type === 'ccm.fixture.provider_metadata',
    );
    if (metadata && scenario.expect.actual_retained !== false) {
      assert.equal(metadata.proof_nonce, proofNonce);
      assert.ok(data.identity.actual, 'provider metadata must produce actual identity evidence');
      const expectedActual = state.execution.jsonl.find(
        (event: unknown) => isPlainObject(event) && event.type === 'ccm.fixture.provider_metadata',
      );
      assert.ok(isPlainObject(expectedActual));
      assert.equal(data.identity.actual.model, expectedActual.model ?? null);
      assert.equal(data.identity.actual.effort, expectedActual.effort ?? null);
      const actualEvidence = data.evidence.find(
        (entry: Record<string, any>) => entry.evidence_id === data.identity.actual.evidence_id,
      );
      assert.ok(actualEvidence, 'actual identity evidence id must resolve');
      assert.equal(actualEvidence.source.method, 'ccm.fixture.provider_metadata');
      assert.equal(actualEvidence.payload_sha256, metadata.payload_sha256);
    } else {
      assert.equal(
        data.identity.actual,
        null,
        'actual identity cannot be copied without stream evidence',
      );
    }

    if (scenario.expect.status === 'succeeded') {
      assert.equal(data.result.output.provider_proof, proofNonce);
      const resultTrace = trace.find((record) => record.kind === 'exec-result');
      assert.ok(resultTrace, 'structured result must come from the spawned child');
      assert.equal(resultTrace.proof_nonce, proofNonce);
    }
  }

  assert.ok(!kinds.includes('account-mutation'), `${scenario.id} invoked account mutation`);
  assert.ok(!kinds.includes('forbidden-env'), `${scenario.id} leaked forbidden env to child`);
  for (const record of trace) {
    assert.equal(record.schema, 'ccm/codex-fixture-trace/v2');
    assertExactChildEnvKeys(record.env_keys);
  }

  if (
    scenario.expect.required_spawn_kinds.length === 0 &&
    !scenario.expect.expected_process_phases
  ) {
    assert.deepEqual(trace, [], `${scenario.id} must reject before spawning Codex`);
  }

  const quotaEvidence = data.evidence?.find(
    (entry: Record<string, any>) => entry.source?.method === 'account/rateLimits/read',
  );
  if (quotaEvidence) {
    assert.equal(quotaEvidence.freshness, state.probe.quota.freshness);
  }
}

function assertQuotaShape(
  data: Record<string, any>,
  state: FixtureState,
  quotaEvidence: Record<string, any>,
): void {
  assert.equal(data.quota.admission_7d, state.probe.quota.admission_7d);
  assert.equal(data.quota.five_hour_effect, 'ignored');
  assert.deepEqual(
    [...(data.quota.buckets as Record<string, any>[])].sort((left, right) =>
      left.source_path.localeCompare(right.source_path),
    ),
    expectedQuotaBuckets(state, quotaEvidence),
    'quota buckets must be a canonical projection of exact source rows/windows',
  );
  assert.deepEqual(
    data.quota.rolling_24h,
    expectedRolling24(state, quotaEvidence),
    'rolling-24h values and references must share one canonical derivation',
  );
}

function assertCanonicalProvenance(
  data: Record<string, any>,
  state: FixtureState,
  request: Record<string, any>,
  proofNonce: string,
  registryDocument: Record<string, any>,
  binaryPath: string,
): void {
  const appServerRevision = expectedAppServerRevision();
  const binaryVersion = normalizedBinaryVersion(state);
  const appServerSource = {
    surface: 'app-server',
    binaryRealpath: binaryPath,
    binaryVersion,
    schemaVersion: 'https://json-schema.org/draft/2020-12/schema',
  };
  const rawSources = [
    {
      kind: 'auth',
      method: 'account/read',
      revision: appServerRevision,
      payload: expectedAppServerPayload('account/read', state, proofNonce),
      envelope: state.probe.auth,
      source: appServerSource,
    },
    {
      kind: 'entitlement',
      method: 'model/list',
      revision: appServerRevision,
      payload: expectedAppServerPayload('model/list', state, proofNonce),
      envelope: state.probe.entitlement,
      source: appServerSource,
    },
    {
      kind: 'quota',
      method: 'account/rateLimits/read',
      revision: appServerRevision,
      payload: expectedAppServerPayload('account/rateLimits/read', state, proofNonce),
      envelope: state.probe.quota,
      source: appServerSource,
    },
    {
      kind: 'model-catalog',
      method: 'ccm-model-registry/read',
      revision: state.probe.registry.version,
      payload: registryDocument,
      envelope: state.probe.registry,
      source: {
        surface: 'cli-headless',
        binaryRealpath: binaryPath,
        binaryVersion,
        schemaVersion: state.probe.registry.schema,
      },
    },
  ];
  const expectedByMethod = new Map<string, Record<string, any>>();
  for (const source of rawSources) {
    const expected = expectedEvidence(
      source.method,
      source.revision,
      source.payload,
      source.envelope,
      { kind: source.kind, ...source.source },
    );
    assertEvidenceBinding(evidenceByMethod(data, source.method), expected);
    expectedByMethod.set(source.method, expected);
  }

  const quotaEvidence = expectedByMethod.get('account/rateLimits/read') as Record<string, any>;
  assertQuotaShape(data, state, quotaEvidence);

  assertRequestedEvidence(data, request);

  if (!data.identity.resolved) return;

  const entitlementEvidence = expectedByMethod.get('model/list') as Record<string, any>;
  const registryEvidence = expectedByMethod.get('ccm-model-registry/read') as Record<string, any>;
  const resolutionPayload = expectedResolutionPayload(
    request,
    state.execution.resolved,
    entitlementEvidence,
    registryEvidence,
  );
  const resolutionEvidence = expectedEvidence(
    'ccm-provider-model-resolution/intersection',
    resolutionPayload.schema,
    resolutionPayload,
    {
      observed_at: '2026-07-13T08:01:00Z',
      valid_until:
        Date.parse(entitlementEvidence.valid_until) < Date.parse(registryEvidence.valid_until)
          ? entitlementEvidence.valid_until
          : registryEvidence.valid_until,
      freshness: 'fresh',
      completeness: 'complete',
    },
    {
      kind: 'model-catalog',
      surface: 'cli-headless',
      binaryRealpath: binaryPath,
      binaryVersion,
      schemaVersion: resolutionPayload.schema,
    },
  );
  const actualResolutionEvidence = data.evidence.find(
    (entry: Record<string, any>) => entry.evidence_id === data.identity.resolved.evidence_id,
  );
  assert.ok(actualResolutionEvidence, 'resolved evidence must resolve');
  assertEvidenceBinding(actualResolutionEvidence, resolutionEvidence);
  assert.deepEqual(
    { model: data.identity.resolved.model, effort: data.identity.resolved.effort },
    { model: state.execution.resolved.model, effort: state.execution.resolved.effort },
    'resolved identity model/effort must equal the catalog/registry intersection',
  );

  if (!data.execution.attempted) return;

  const identityEvent = state.execution.jsonl.find(
    (event: unknown) => isPlainObject(event) && event.type === 'ccm.fixture.provider_metadata',
  );
  if (isPlainObject(identityEvent) && data.identity.actual) {
    const actualEvidence = expectedEvidence(
      'ccm.fixture.provider_metadata',
      String(identityEvent.schema),
      identityEvent,
      {
        observed_at: '2026-07-13T08:01:00Z',
        valid_until: null,
        freshness: 'fresh',
        completeness: 'complete',
      },
      {
        kind: 'execution',
        surface: 'cli-headless',
        binaryRealpath: binaryPath,
        binaryVersion,
        schemaVersion: identityEvent.schema,
      },
    );
    const retained = data.evidence.find(
      (entry: Record<string, any>) => entry.evidence_id === data.identity.actual.evidence_id,
    );
    assert.ok(retained, 'actual evidence must resolve');
    assertEvidenceBinding(retained, actualEvidence);
    assert.deepEqual(
      { model: data.identity.actual.model, effort: data.identity.actual.effort },
      { model: identityEvent.model ?? null, effort: identityEvent.effort ?? null },
      'actual identity model/effort must come from the verified provider event',
    );
  }
}

function assertRequestedEvidence(data: Record<string, any>, request: Record<string, any>): void {
  const expected = expectedEvidence(
    'ccm-provider-inspect/request',
    request.schema,
    request,
    {
      observed_at: '2026-07-13T08:01:00Z',
      valid_until: null,
      freshness: 'fresh',
      completeness: 'complete',
    },
    { kind: 'execution', schemaVersion: request.schema },
  );
  assert.deepEqual(
    { model: data.identity.requested.model, effort: data.identity.requested.effort },
    { model: request.model, effort: request.effort },
  );
  const retained = data.evidence.find(
    (entry: Record<string, any>) => entry.evidence_id === data.identity.requested.evidence_id,
  );
  assert.ok(retained, 'requested evidence must resolve even when probing is rejected');
  assertEvidenceBinding(retained, expected);
}

function buildCalibrationEnvelope(
  state: FixtureState,
  request: Record<string, any>,
  proofNonce: string,
  registryDocument: Record<string, any>,
): Record<string, any> {
  const binarySource = {
    binaryRealpath: '/fixture/codex',
    binaryVersion: normalizedBinaryVersion(state),
  };
  const appServerRevision = expectedAppServerRevision();
  const appServerSource = {
    ...binarySource,
    surface: 'app-server',
    schemaVersion: 'https://json-schema.org/draft/2020-12/schema',
  };
  const authEvidence = expectedEvidence(
    'account/read',
    appServerRevision,
    expectedAppServerPayload('account/read', state, proofNonce),
    state.probe.auth,
    { kind: 'auth', ...appServerSource },
  );
  const entitlementEvidence = expectedEvidence(
    'model/list',
    appServerRevision,
    expectedAppServerPayload('model/list', state, proofNonce),
    state.probe.entitlement,
    { kind: 'entitlement', ...appServerSource },
  );
  const quotaEvidence = expectedEvidence(
    'account/rateLimits/read',
    appServerRevision,
    expectedAppServerPayload('account/rateLimits/read', state, proofNonce),
    state.probe.quota,
    { kind: 'quota', ...appServerSource },
  );
  const registryEvidence = expectedEvidence(
    'ccm-model-registry/read',
    state.probe.registry.version,
    registryDocument,
    state.probe.registry,
    {
      kind: 'model-catalog',
      surface: 'cli-headless',
      ...binarySource,
      schemaVersion: state.probe.registry.schema,
    },
  );
  const requestEvidence = expectedEvidence(
    'ccm-provider-inspect/request',
    request.schema,
    request,
    {
      observed_at: '2026-07-13T08:01:00Z',
      valid_until: null,
      freshness: 'fresh',
      completeness: 'complete',
    },
    {
      kind: 'execution',
      surface: 'cli-headless',
      binaryRealpath: null,
      binaryVersion: null,
      schemaVersion: request.schema,
    },
  );
  const resolutionPayload = expectedResolutionPayload(
    request,
    state.execution.resolved,
    entitlementEvidence,
    registryEvidence,
  );
  const resolutionEvidence = expectedEvidence(
    'ccm-provider-model-resolution/intersection',
    resolutionPayload.schema,
    resolutionPayload,
    {
      observed_at: '2026-07-13T08:01:00Z',
      valid_until: entitlementEvidence.valid_until,
      freshness: 'fresh',
      completeness: 'complete',
    },
    {
      kind: 'model-catalog',
      surface: 'cli-headless',
      ...binarySource,
      schemaVersion: resolutionPayload.schema,
    },
  );
  const identityEvent = state.execution.jsonl.find(
    (event: unknown) => isPlainObject(event) && event.type === 'ccm.fixture.provider_metadata',
  ) as Record<string, any>;
  const actualEvidence = expectedEvidence(
    'ccm.fixture.provider_metadata',
    identityEvent.schema,
    identityEvent,
    {
      observed_at: '2026-07-13T08:01:00Z',
      valid_until: null,
      freshness: 'fresh',
      completeness: 'complete',
    },
    {
      kind: 'execution',
      surface: 'cli-headless',
      ...binarySource,
      schemaVersion: identityEvent.schema,
    },
  );
  return {
    execution: { attempted: true },
    quota: {
      admission_7d: state.probe.quota.admission_7d,
      five_hour_effect: 'ignored',
      buckets: expectedQuotaBuckets(state, quotaEvidence),
      rolling_24h: expectedRolling24(state, quotaEvidence),
    },
    identity: {
      requested: {
        model: request.model,
        effort: request.effort,
        evidence_id: requestEvidence.evidence_id,
      },
      resolved: {
        ...state.execution.resolved,
        evidence_id: resolutionEvidence.evidence_id,
      },
      actual: {
        model: identityEvent.model,
        effort: identityEvent.effort,
        evidence_id: actualEvidence.evidence_id,
      },
    },
    evidence: [
      authEvidence,
      entitlementEvidence,
      quotaEvidence,
      registryEvidence,
      requestEvidence,
      resolutionEvidence,
      actualEvidence,
    ],
  };
}

function runProvenanceMutationCalibration(): void {
  const scenario = catalog.scenarios.find((entry) => entry.id === 'CXD-007') as FixtureScenario;
  const proofNonce = 'nonempty-calibration-proof';
  const state = injectDynamicProof(materialize(scenario), proofNonce);
  const request = {
    ...state.request,
    request_id: 'calibration-request',
    workspace: '/fixture/workspace',
    output_schema: JSON.parse(readFileSync(OUTPUT_SCHEMA_PATH, 'utf8')),
  };
  const registryDocument = structuredClone(state.probe.registry);
  const valid = buildCalibrationEnvelope(state, request, proofNonce, registryDocument);
  assertCanonicalProvenance(valid, state, request, proofNonce, registryDocument, '/fixture/codex');

  const mutations: Array<[string, (value: Record<string, any>) => void]> = [
    ['opaque bucket identity', (value) => (value.quota.buckets[0].credential_id = 'cred-wrong')],
    ['bucket usage', (value) => (value.quota.buckets[1].window.used_percent = 37)],
    [
      'bucket reset',
      (value) => (value.quota.buckets[2].window.resets_at = '2099-01-01T00:00:00.000Z'),
    ],
    [
      'bucket source evidence',
      (value) => (value.quota.buckets[0].source_evidence_id = value.evidence[0].evidence_id),
    ],
    ['bucket source revision', (value) => (value.quota.buckets[0].source_revision = 'rev-wrong')],
    ['rolling value', (value) => (value.quota.rolling_24h.delta_percent_points = 999)],
    [
      'rolling evidence reference',
      (value) => (value.quota.rolling_24h.source_evidence_ids = [value.evidence[0].evidence_id]),
    ],
    [
      'requested payload binding',
      (value) => {
        const entry = value.evidence.find(
          (candidate: Record<string, any>) =>
            candidate.evidence_id === value.identity.requested.evidence_id,
        );
        entry.payload_sha256 = 'a'.repeat(64);
      },
    ],
    [
      'resolved catalog/registry binding',
      (value) => {
        const entry = value.evidence.find(
          (candidate: Record<string, any>) =>
            candidate.evidence_id === value.identity.resolved.evidence_id,
        );
        entry.source.revision = 'ccm/codex-model-resolution-intersection/wrong';
      },
    ],
    [
      'requested model value',
      (value) => (value.identity.requested.model = 'gpt-contract-counterfeit'),
    ],
    ['requested effort value', (value) => (value.identity.requested.effort = 'low')],
    [
      'resolved model value',
      (value) => (value.identity.resolved.model = 'gpt-contract-counterfeit'),
    ],
    ['resolved effort value', (value) => (value.identity.resolved.effort = 'medium')],
    ['actual model value', (value) => (value.identity.actual.model = 'gpt-contract-counterfeit')],
    ['actual effort value', (value) => (value.identity.actual.effort = 'medium')],
    [
      'actual event evidence binding',
      (value) => {
        const entry = value.evidence.find(
          (candidate: Record<string, any>) =>
            candidate.evidence_id === value.identity.actual.evidence_id,
        );
        entry.payload_sha256 = 'a'.repeat(64);
      },
    ],
  ];
  for (const [label, mutate] of mutations) {
    const corrupted = structuredClone(valid);
    mutate(corrupted);
    assert.throws(
      () =>
        assertCanonicalProvenance(
          corrupted,
          state,
          request,
          proofNonce,
          registryDocument,
          '/fixture/codex',
        ),
      `${label} corruption must be rejected`,
    );
  }
}

async function runAuthorityEscapeCalibration(): Promise<void> {
  const expectedEnv = Object.fromEntries(CHILD_ENV_ALLOWLIST.map((key) => [key, `safe-${key}`]));
  for (const key of CHILD_ENV_ALLOWLIST) {
    const substitutedEnv = { ...expectedEnv, [key]: `counterfeit-${key}` };
    assert.throws(
      () => assertExactChildEnvironment(substitutedEnv, expectedEnv),
      /env values drifted/,
      `${key} value substitution must be rejected`,
    );
  }
  const randomSuffix = randomBytes(8).toString('hex');
  for (const key of [
    'OPENAI_API_KEY',
    'HTTPS_PROXY',
    'SSH_AUTH_SOCK',
    'NODE_OPTIONS',
    `UNLISTED_SECRET_${randomSuffix}`,
    `UNLISTED_PROXY_${randomSuffix}`,
    `UNLISTED_SOCKET_${randomSuffix}`,
    `UNLISTED_TOOL_${randomSuffix}`,
  ]) {
    assert.throws(
      () =>
        assertExactChildEnvironment(
          { ...expectedEnv, [key]: `canary-${randomSuffix}` },
          expectedEnv,
        ),
      /frozen allowlist/,
      `${key} must not survive the exact child environment closure`,
    );
  }

  const guard = installHostAuthorityGuard();
  try {
    const counterfeit = (await import(
      `${pathToFileURL(AUTHORITY_COUNTERFEIT_PATH).href}?calibration=${randomUUID()}`
    )) as { attemptAuthorityEscape: (api: string) => void };
    assert.match(
      guard.webSocketSurface,
      /^(native-patched|absent-deny-stub)$/,
      'WebSocket coverage branch must be explicit and audited',
    );
    const expectedAttempts: AuthorityAttempt[] = [
      { authority: 'network', api: 'net.connect' },
      { authority: 'network', api: 'net.createConnection' },
      { authority: 'network', api: 'dns.lookup' },
      { authority: 'network', api: 'dns.resolve' },
      { authority: 'network', api: 'dns.resolve4' },
      { authority: 'network', api: 'dns.resolve6' },
      { authority: 'network', api: 'dns.resolveAny' },
      { authority: 'network', api: 'http.request' },
      { authority: 'network', api: 'http.get' },
      { authority: 'network', api: 'https.request' },
      { authority: 'network', api: 'https.get' },
      { authority: 'network', api: 'tls.connect' },
      { authority: 'network', api: 'dgram.createSocket' },
      { authority: 'network', api: 'globalThis.fetch' },
      { authority: 'network', api: 'globalThis.WebSocket' },
      { authority: 'process', api: 'child_process.spawn' },
      { authority: 'process', api: 'child_process.spawnSync' },
      { authority: 'process', api: 'child_process.exec' },
      { authority: 'process', api: 'child_process.execSync' },
      { authority: 'process', api: 'child_process.execFile' },
      { authority: 'process', api: 'child_process.execFileSync' },
      { authority: 'process', api: 'child_process.fork' },
      { authority: 'process', api: 'worker_threads.Worker' },
      { authority: 'process', api: 'cluster.fork' },
    ];
    for (const expected of expectedAttempts) {
      const before = guard.attempts.length;
      assert.throws(
        () => counterfeit.attemptAuthorityEscape(expected.api),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(
            error.message,
            `provider host ${expected.authority} authority denied: ${expected.api}`,
          );
          return true;
        },
        `${expected.api} must be synchronously denied by its own guard`,
      );
      assert.deepEqual(
        guard.attempts.slice(before),
        [expected],
        `${expected.api} must produce its exact authority record`,
      );
    }
    assert.deepEqual(guard.attempts, expectedAttempts);
  } finally {
    guard.restore();
  }
}

test('request correlation and all three timeout phases reject invalid values before runtime access', {
  timeout: 10_000,
}, async () => {
  const { inspect } = await import('../src/handlers/provider.js');
  const baseRequest = {
    ...structuredClone(catalog.defaults.request),
    request_id: 'request-validation-fixture',
    workspace: '/fixture/workspace',
    output_schema: JSON.parse(readFileSync(OUTPUT_SCHEMA_PATH, 'utf8')),
  };
  const cases: Array<{
    label: string;
    field: string;
    reason: string;
    mutate: (request: Record<string, any>) => void;
  }> = [
    {
      label: 'missing request_id',
      field: 'request_id',
      reason: 'required_nonempty_string',
      mutate: (request) => delete request.request_id,
    },
    {
      label: 'empty request_id',
      field: 'request_id',
      reason: 'required_nonempty_string',
      mutate: (request) => (request.request_id = ''),
    },
    {
      label: 'blank request_id',
      field: 'request_id',
      reason: 'required_nonempty_string',
      mutate: (request) => (request.request_id = '   '),
    },
    {
      label: 'missing timeouts object',
      field: 'timeouts_ms',
      reason: 'required_object',
      mutate: (request) => delete request.timeouts_ms,
    },
  ];
  for (const phase of ['startup', 'idle', 'hard'] as const) {
    cases.push(
      {
        label: `missing ${phase} timeout`,
        field: `timeouts_ms.${phase}`,
        reason: 'required_positive_bounded_integer',
        mutate: (request) => delete request.timeouts_ms[phase],
      },
      {
        label: `zero ${phase} timeout`,
        field: `timeouts_ms.${phase}`,
        reason: 'required_positive_bounded_integer',
        mutate: (request) => (request.timeouts_ms[phase] = 0),
      },
      {
        label: `negative ${phase} timeout`,
        field: `timeouts_ms.${phase}`,
        reason: 'required_positive_bounded_integer',
        mutate: (request) => (request.timeouts_ms[phase] = -1),
      },
      {
        label: `out-of-range ${phase} timeout`,
        field: `timeouts_ms.${phase}`,
        reason: 'required_positive_bounded_integer',
        mutate: (request) => (request.timeouts_ms[phase] = 600_001),
      },
    );
  }

  for (const invalid of cases) {
    const request = structuredClone(baseRequest);
    invalid.mutate(request);
    const calls = { resolve: 0, spawn: 0, network: 0 };
    const providerRuntime = {
      schema: PROVIDER_RUNTIME_SCHEMA,
      process: {
        resolveExecutable: () => {
          calls.resolve += 1;
          return null;
        },
        spawnProvider: () => {
          calls.spawn += 1;
          throw new Error('invalid request reached spawnProvider');
        },
      },
      network: {
        request: () => {
          calls.network += 1;
          throw new Error('invalid request reached network authority');
        },
      },
    };
    const out: string[] = [];
    const err: string[] = [];
    const code = await inspect({
      out: (value: string) => out.push(value),
      err: (value: string) => err.push(value),
      env: { NO_COLOR: '1' },
      values: { request: JSON.stringify(request) },
      positionals: ['codex'],
      providerRuntime,
    } as unknown as Parameters<typeof inspect>[0]);
    assert.equal(code, io.EXIT.OK, `${invalid.label}: ${err.join('')}`);
    assert.equal(out.length, 1, `${invalid.label} must emit one structured rejection`);
    const envelope = JSON.parse(out[0] as string);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.result.status, 'rejected');
    assert.deepEqual(
      envelope.data.error,
      { code: 'request_schema_invalid', field: invalid.field, reason: invalid.reason },
      invalid.label,
    );
    assertExactPredicateShape(envelope.data);
    assert.deepEqual(calls, { resolve: 0, spawn: 0, network: 0 }, invalid.label);
  }
});

test('fixture catalog freezes the versioned contract and required failure coverage', () => {
  assert.equal(catalog.schema, 'ccm/codex-candidate-provider-driver-fixture-catalog/v1');
  assert.equal(catalog.contract, CONTRACT);
  assert.equal(catalog.result_schema, RESULT_SCHEMA);
  assert.deepEqual(catalog.planned_endpoint, ['provider', 'inspect', 'codex']);
  assert.equal(catalog.scenarios.length, 54);

  const ids = catalog.scenarios.map((scenario) => scenario.id);
  assert.equal(new Set(ids).size, ids.length, 'fixture ids must be unique');
  assert.deepEqual(
    ids,
    Array.from({ length: 54 }, (_, index) => `CXD-${String(index + 1).padStart(3, '0')}`),
  );

  const errorCodes = new Set(catalog.scenarios.map((scenario) => scenario.expect.error_code));
  for (const required of [
    'binary_unavailable',
    'auth_unknown',
    'model_auto_forbidden',
    'quota_unknown',
    'quota_tight',
    'quota_hard_stale',
    'quota_7d_exhausted',
    'model_mismatch',
    'effort_mismatch',
    'structured_output_malformed',
    'stream_malformed',
    'hard_timeout',
    'cancelled',
    'actual_model_missing',
    'actual_effort_missing',
    'account_mutation_forbidden',
    'binary_capability_unproven',
    'model_unavailable',
    'entitlement_unknown',
    'registry_hard_stale',
    'registry_unknown',
    'terminal_missing',
    'terminal_duplicate',
    'provider_failed',
    'startup_timeout',
    'idle_timeout',
  ]) {
    assert.ok(errorCodes.has(required), `missing fixture error ${required}`);
  }
});

test('fixture admission laws are seven-day-only and rolling twenty-four-hour is advisory', () => {
  const byId = new Map(catalog.scenarios.map((scenario) => [scenario.id, scenario]));
  const fiveHourIgnored = byId.get('CXD-007') as FixtureScenario;
  const state = materialize(fiveHourIgnored);
  const bucket = state.probe.quota.payload.rateLimitsByLimitId['codex-fixture'];
  assert.equal(bucket.primary.windowDurationMins, 300);
  assert.equal(bucket.primary.usedPercent, 99);
  assert.equal(bucket.secondary.windowDurationMins, 10080);
  assert.equal(bucket.secondary.usedPercent, 40);
  assert.equal(fiveHourIgnored.expect.five_hour_effect, 'ignored');
  assert.equal(fiveHourIgnored.expect.automatic_eligible, true);

  const overrun = byId.get('CXD-027') as FixtureScenario;
  assert.equal(overrun.expect.automatic_eligible, true);
  assert.equal(overrun.expect.status, 'succeeded');
  assert.equal(overrun.expect.rolling_24h, 'advisory-only');

  for (const id of ['CXD-004', 'CXD-005', 'CXD-006', 'CXD-008']) {
    const scenario = byId.get(id) as FixtureScenario;
    assert.equal(scenario.expect.automatic_eligible, false, `${id} must be ineligible`);
    assert.equal(scenario.expect.execution_attempted, false, `${id} must not invoke a model`);
  }
});

test('auth, model catalog, quota, and registry freshness remain independent load-bearing facts', () => {
  const byId = new Map(catalog.scenarios.map((scenario) => [scenario.id, scenario]));
  const checks = [
    ['CXD-020', 'auth'],
    ['CXD-021', 'entitlement'],
    ['CXD-006', 'quota'],
    ['CXD-022', 'registry'],
    ['CXD-023', 'registry'],
  ] as const;
  for (const [id, facet] of checks) {
    const scenario = byId.get(id) as FixtureScenario;
    const state = materialize(scenario);
    assert.notEqual(state.probe[facet].freshness, 'fresh', `${id} must vary ${facet}`);
    for (const other of ['auth', 'entitlement', 'quota', 'registry']) {
      if (other !== facet)
        assert.equal(state.probe[other].freshness, 'fresh', `${id} leaked to ${other}`);
    }
    assert.equal(scenario.expect.automatic_eligible, false);
  }
  for (const facet of ['auth', 'entitlement', 'quota'] as const) {
    assert.ok(catalog.defaults.probe[facet].revision, `${facet} source revision is required`);
  }
  assert.ok(catalog.defaults.probe.registry.version, 'registry version is its source revision');
});

test('fixtures freeze non-collapsed quota provenance and three-way identity reconciliation', () => {
  const quota = catalog.defaults.probe.quota.payload;
  for (const row of [quota.rateLimits, ...Object.values(quota.rateLimitsByLimitId)] as any[]) {
    for (const field of [
      'limitId',
      'credentialId',
      'accountId',
      'payerId',
      'poolId',
      'sharedScope',
      'unit',
    ]) {
      assert.ok(row[field], `quota row missing ${field}`);
    }
  }
  const byId = new Map(catalog.scenarios.map((scenario) => [scenario.id, scenario]));
  assert.equal(byId.get('CXD-009')?.expect.error_code, 'model_mismatch');
  assert.equal(byId.get('CXD-024')?.expect.error_code, 'effort_mismatch');
  assert.equal(byId.get('CXD-013')?.expect.error_code, 'actual_model_missing');
  assert.equal(byId.get('CXD-025')?.expect.error_code, 'actual_effort_missing');
  for (const id of IDENTITY_METADATA_FAILURE_IDS) {
    const scenario = byId.get(id);
    assert.ok(scenario, `${id} identity failure fixture is required`);
    assert.equal(scenario.expect.error_code, 'actual_model_missing');
  }
});

test('provenance oracle rejects independently corrupted nonempty source bindings', () => {
  runProvenanceMutationCalibration();
});

test('provider authority boundary rejects unknown env and direct process/network escapes', async () => {
  await runAuthorityEscapeCalibration();
});

test('counterfeit fixture lookup plus superficial spawns cannot satisfy runtime proof', () => {
  const scenario = catalog.scenarios.find((entry) => entry.id === 'CXD-007') as FixtureScenario;
  const state = materialize(scenario);
  const counterfeitTrace = scenario.expect.required_spawn_kinds.map((kind) => ({
    schema: 'ccm/codex-fixture-trace/v2',
    run_token: 'counterfeit',
    kind,
    argv: kind === 'exec-spawn' ? ['exec'] : [],
    env_keys: [],
  })) as TraceRecord[];
  assert.throws(
    () =>
      assertProviderDerivationProof(
        { evidence: [], identity: { actual: null }, result: { output: null } },
        counterfeitTrace,
        scenario,
        state,
        'hidden-proof-not-observed',
        state.probe.registry,
      ),
    /missing real app-server JSON-RPC request/,
  );
});

test('controlled fake exposes dynamic proof only through provider protocol and execution output', () => {
  const scenario = catalog.scenarios.find((entry) => entry.id === 'CXD-007') as FixtureScenario;
  const proofNonce = randomBytes(24).toString('hex');
  const runToken = randomBytes(16).toString('hex');
  const state = injectDynamicProof(materialize(scenario), proofNonce);
  const root = mkdtempSync(join(tmpdir(), `ccm-codex-fake-${randomBytes(6).toString('hex')}-`));
  TMP.push(root);
  const binaryPath = join(root, 'codex');
  const tracePath = join(root, 'trace.jsonl');
  const resultPath = join(root, 'result.json');
  const schemaPath = join(root, 'schema.json');
  writeFileSync(schemaPath, readFileSync(OUTPUT_SCHEMA_PATH));
  writeControlledCodex(binaryPath, state, proofNonce, runToken, tracePath);
  const childEnv = {
    PATH: process.env.PATH || '/usr/bin:/bin',
    HOME: root,
    CODEX_HOME: join(root, 'codex-home'),
    TMPDIR: root,
    NO_COLOR: '1',
  };

  const appServer = spawnSync(binaryPath, ['app-server'], {
    env: childEnv,
    encoding: 'utf8',
    input: [
      { id: 1, method: 'initialize', params: {} },
      { method: 'initialized', params: {} },
      { id: 2, method: 'account/read', params: {} },
      { id: 3, method: 'model/list', params: {} },
      { id: 4, method: 'account/rateLimits/read', params: {} },
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n')
      .concat('\n'),
  });
  assert.equal(appServer.status, 0, appServer.stderr);
  const appReplies = appServer.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(appReplies.length, 4);
  assert.ok(appReplies.every((reply) => reply.result.fixtureProof === proofNonce));

  const execution = spawnSync(
    binaryPath,
    [
      '--ask-for-approval',
      'never',
      'exec',
      '--json',
      '--output-schema',
      schemaPath,
      '--output-last-message',
      resultPath,
      '--model',
      'gpt-contract-fixture',
      '-c',
      'model_reasoning_effort=high',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '-C',
      root,
      '-',
    ],
    { env: childEnv, encoding: 'utf8', input: 'inspect\n' },
  );
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(JSON.parse(readFileSync(resultPath, 'utf8')).provider_proof, proofNonce);
  assert.ok(execution.stdout.includes(proofNonce));
  assert.ok(!JSON.stringify(catalog).includes(proofNonce));

  const trace = readTrace(tracePath);
  assert.equal(trace.filter((record) => record.kind === 'app-server-request').length, 5);
  assert.ok(
    trace.some((record) => record.kind === 'exec-jsonl' && record.proof_nonce === proofNonce),
  );
});

test('parser and supervisor failure fixtures require the controlled execution path', () => {
  for (const id of [
    'CXD-009',
    'CXD-010',
    'CXD-011',
    'CXD-012',
    'CXD-013',
    'CXD-015',
    'CXD-024',
    'CXD-025',
    'CXD-026',
    'CXD-028',
    'CXD-029',
    'CXD-030',
    'CXD-031',
    'CXD-032',
    'CXD-033',
    'CXD-034',
    'CXD-035',
    'CXD-036',
    'CXD-037',
    'CXD-038',
    'CXD-048',
    'CXD-050',
    'CXD-051',
    'CXD-052',
    'CXD-053',
    'CXD-054',
  ]) {
    const scenario = catalog.scenarios.find((entry) => entry.id === id) as FixtureScenario;
    assert.equal(scenario.expect.execution_attempted, true, `${id} must attempt fake exec`);
    assert.ok(
      scenario.expect.required_spawn_kinds.includes('exec-spawn'),
      `${id} must prove spawn`,
    );
  }
  const versionOnly = catalog.scenarios.find((entry) => entry.id === 'CXD-016') as FixtureScenario;
  const state = materialize(versionOnly);
  assert.ok(state.probe.binary.version);
  assert.equal(versionOnly.expect.automatic_eligible, false);
  assert.equal(versionOnly.expect.error_code, 'binary_capability_unproven');
});

for (const scenario of [...catalog.scenarios, ...qualificationTimeoutScenarios]) {
  test(`opt-in RED ${scenario.id}: ${scenario.title}`, {
    skip: !RUN_RED,
    timeout: 15000,
  }, async () => {
    const rawState = materialize(scenario);
    const proofNonce = randomBytes(24).toString('hex');
    const runToken = randomBytes(16).toString('hex');
    const state = injectDynamicProof(rawState, proofNonce);
    const root = mkdtempSync(
      join(tmpdir(), `ccm-codex-contract-${randomBytes(6).toString('hex')}-`),
    );
    TMP.push(root);
    const binDir = join(root, 'bin');
    const workspace = join(root, 'workspace');
    const codexHome = join(root, 'codex-home');
    const ccmHome = join(root, 'ccm-home');
    const claudeHome = join(root, 'claude-home');
    const cursorConfig = join(root, 'cursor-config');
    const cursorAgentHome = join(root, 'cursor-agent-home');
    const neutralHome = join(root, 'neutral-home');
    const runTmp = join(root, 'run-tmp');
    const tracePath = join(root, 'provider-trace.jsonl');
    const remoteTracePath = join(root, 'forbidden-external-process.jsonl');
    const requestPath = join(root, 'request.json');
    const registryPath = join(ccmHome, 'registries', 'codex-model-registry.json');

    for (const path of [
      binDir,
      workspace,
      codexHome,
      ccmHome,
      claudeHome,
      cursorConfig,
      cursorAgentHome,
      neutralHome,
      runTmp,
    ]) {
      mkdirSync(path, { recursive: true });
    }

    writeSentinel(join(workspace, 'source.txt'), 'immutable-workspace');
    writeSentinel(join(ccmHome, 'boards', 'immutable.board.json'), '{"immutable":true}');
    writeSentinel(join(codexHome, 'auth.json'), '{"fixture":"immutable-codex-auth"}');
    writeSentinel(join(codexHome, 'config.toml'), 'model = "do-not-mutate"');
    writeSentinel(join(cursorConfig, 'auth.json'), '{"fixture":"immutable-cursor-config"}');
    writeSentinel(
      join(cursorAgentHome, 'credentials.json'),
      '{"fixture":"immutable-cursor-agent"}',
    );
    writeSentinel(join(claudeHome, 'credentials.json'), '{"fixture":"immutable-claude"}');
    writeSentinel(join(neutralHome, '.profile'), 'immutable-home');

    const registryDocument = structuredClone(state.probe.registry);
    mkdirSync(dirname(registryPath), { recursive: true });
    writeFileSync(
      registryPath,
      `${JSON.stringify(canonical(registryDocument), null, 2)}\n`,
      'utf8',
    );
    chmodSync(registryPath, 0o444);

    for (const tool of ['git', 'gh', 'curl', 'wget', 'ssh', 'scp']) {
      writeForbiddenTool(join(binDir, tool), remoteTracePath);
    }
    const controlledBinaryPath = join(binDir, 'codex');
    if (state.probe.binary.available) {
      writeControlledCodex(controlledBinaryPath, state, proofNonce, runToken, tracePath);
    }

    const requestId = randomUUID();
    const request: Record<string, any> = {
      ...state.request,
      request_id: requestId,
      workspace,
      output_schema:
        state.request.output_schema ?? JSON.parse(readFileSync(OUTPUT_SCHEMA_PATH, 'utf8')),
    };
    writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`, 'utf8');

    const protectedRoots = [
      workspace,
      ccmHome,
      codexHome,
      cursorConfig,
      cursorAgentHome,
      claudeHome,
      neutralHome,
    ];
    const protectedBefore = new Map(protectedRoots.map((path) => [path, snapshotTree(path)]));
    const processEnvBefore = digest(
      Object.entries(process.env).sort(([left], [right]) => left.localeCompare(right)),
    );
    const randomSecretKey = `UNLISTED_HARNESS_SECRET_${randomBytes(8).toString('hex')}`;
    const randomSecretValue = `secret-${randomBytes(24).toString('hex')}`;
    const secretValues = [
      'forbidden-gh-token',
      'forbidden-anthropic-token',
      'forbidden-cursor-token',
      'forbidden-aws-secret',
      'forbidden-claude-oauth',
      'forbidden-openai-token',
      'forbidden-npm-token',
      'forbidden-aws-session-token',
      'forbidden-ssh-agent-socket',
      randomSecretValue,
    ];
    const env: Record<string, string | undefined> = {
      PATH: `${binDir}:${process.env.PATH || '/usr/bin:/bin'}`,
      HOME: neutralHome,
      TMPDIR: runTmp,
      CODEX_HOME: codexHome,
      CC_MASTER_HOME: ccmHome,
      CLAUDE_CONFIG_DIR: claudeHome,
      CURSOR_CONFIG_DIR: cursorConfig,
      CURSOR_AGENT_HOME: cursorAgentHome,
      CCM_CODEX_MODEL_REGISTRY_PATH: registryPath,
      CCM_CODEX_PROVIDER_NOW: '2026-07-13T08:01:00Z',
      CCM_CODEX_PROVIDER_TEST_CANCEL_AFTER_MS:
        state.execution.fixture_control.cancel_after_ms === null
          ? undefined
          : String(state.execution.fixture_control.cancel_after_ms),
      NO_COLOR: scenario.id === 'CXD-049' ? NO_COLOR_PARENT_CANARY : '1',
      HTTP_PROXY: 'http://proxy-canary.invalid:7777',
      HTTPS_PROXY: 'http://proxy-canary.invalid:7777',
      ALL_PROXY: 'socks5://proxy-canary.invalid:7777',
      NO_PROXY: '',
      GH_TOKEN: secretValues[0],
      ANTHROPIC_API_KEY: secretValues[1],
      CURSOR_API_KEY: secretValues[2],
      AWS_SECRET_ACCESS_KEY: secretValues[3],
      CLAUDE_CODE_OAUTH_TOKEN: secretValues[4],
      OPENAI_API_KEY: secretValues[5],
      NPM_TOKEN: secretValues[6],
      AWS_SESSION_TOKEN: secretValues[7],
      SSH_AUTH_SOCK: secretValues[8],
      NODE_OPTIONS: '--inspect=127.0.0.1:0',
      BASH_ENV: join(root, 'must-not-be-read'),
      DOCKER_HOST: 'tcp://socket-canary.invalid:2375',
      [randomSecretKey]: randomSecretValue,
    };
    assert.equal(env.CCM_CODEX_FIXTURE_CATALOG, undefined);
    assert.equal(env.CCM_CODEX_FIXTURE_SCENARIO, undefined);
    assert.equal(env.CCM_CODEX_FIXTURE_TRACE, undefined);
    assert.ok(!JSON.stringify(env).includes(scenario.id));
    assert.ok(!JSON.stringify(request).includes(scenario.id));

    const out: string[] = [];
    const err: string[] = [];
    const hostAuthority = installHostAuthorityGuard();
    const expectedChildEnv = {
      CODEX_HOME: codexHome,
      HOME: neutralHome,
      NO_COLOR: '1',
      PATH: env.PATH as string,
      TMPDIR: runTmp,
    };
    const providerRuntime = createControlledProviderRuntime(controlledBinaryPath, expectedChildEnv);
    let code: number;
    let externalBound: NodeJS.Timeout | null = null;
    const inspectStartedAt = Date.now();
    try {
      const router = await import(`../src/router.js?codex-provider-contract=${runToken}`);
      const inspection = Promise.resolve(
        router.run([...catalog.planned_endpoint, '--request', `@${requestPath}`, '--json'], {
          out: (value: string) => out.push(value),
          err: (value: string) => err.push(value),
          env,
          providerRuntime,
        } as unknown as Parameters<typeof router.run>[1]),
      );
      code = scenario.expect.elapsed_lt_ms
        ? await Promise.race([
            inspection,
            new Promise<never>((_, reject) => {
              externalBound = setTimeout(
                () => reject(new Error(`${scenario.id} exceeded external bound`)),
                scenario.expect.elapsed_lt_ms,
              );
            }),
          ])
        : await inspection;
    } finally {
      if (externalBound) clearTimeout(externalBound);
      hostAuthority.restore();
    }
    const inspectElapsedMs = Date.now() - inspectStartedAt;

    assert.equal(
      code,
      io.EXIT.OK,
      `${scenario.id} RED: future engine/CLI endpoint is absent or failed; stderr=${err.join('')}`,
    );
    assert.equal(out.length, 1, `${scenario.id} must emit exactly one JSON envelope`);
    const envelope = JSON.parse(out[0] as string);
    assert.equal(envelope.ok, true);
    const data = envelope.data;
    assert.equal(data.schema, RESULT_SCHEMA);
    assert.equal(data.contract, CONTRACT);
    assert.equal(data.request_id, requestId);
    assert.equal(data.provider, 'codex');
    assert.equal(
      data.candidate.automatic_eligible,
      scenario.expect.automatic_eligible,
      `${scenario.id}: ${JSON.stringify(data.error)}`,
    );
    assert.equal(data.result.status, scenario.expect.status);
    assert.equal(data.error?.code ?? null, scenario.expect.error_code);
    if (scenario.expect.error_phase) assert.equal(data.error?.phase, scenario.expect.error_phase);
    if (scenario.expect.error_detail)
      assert.equal(data.error?.detail, scenario.expect.error_detail);
    if (scenario.expect.error_reason)
      assert.equal(data.error?.reason, scenario.expect.error_reason);
    if (scenario.expect.elapsed_lt_ms)
      assert.ok(inspectElapsedMs < scenario.expect.elapsed_lt_ms, `${scenario.id} external bound`);
    assert.equal(data.execution.attempted, scenario.expect.execution_attempted);
    const timedOutPhase = !scenario.expect.execution_attempted
      ? null
      : scenario.expect.error_code === 'startup_timeout'
        ? 'startup'
        : scenario.expect.error_code === 'idle_timeout'
          ? 'idle'
          : scenario.expect.error_code === 'hard_timeout'
            ? 'hard'
            : null;
    const expectedTerminalCount =
      !scenario.expect.execution_attempted ||
      scenario.id === 'CXD-034' ||
      scenario.id === 'CXD-037' ||
      timedOutPhase ||
      scenario.expect.status === 'cancelled'
        ? 0
        : state.execution.jsonl.filter(
            (event: unknown) =>
              isPlainObject(event) && ['turn.completed', 'turn.failed'].includes(event.type),
          ).length;
    assert.equal(data.execution.terminal_count, expectedTerminalCount);
    assert.equal(data.execution.timeout_phase, timedOutPhase);
    assert.equal(data.execution.cancel_observed, scenario.expect.status === 'cancelled');
    if (IDENTITY_METADATA_FAILURE_IDS.has(scenario.id)) {
      assert.equal(
        data.identity.actual,
        null,
        `${scenario.id} must not retain invalid actual identity`,
      );
      assert.deepEqual(
        { model: data.identity.requested.model, effort: data.identity.requested.effort },
        { model: request.model, effort: request.effort },
        `${scenario.id} requested identity must remain request-bound`,
      );
      assert.deepEqual(
        { model: data.identity.resolved.model, effort: data.identity.resolved.effort },
        state.execution.resolved,
        `${scenario.id} resolved identity must remain intersection-bound`,
      );
      assert.equal(
        data.evidence.some(
          (entry: Record<string, any>) => entry.source?.method === 'ccm.fixture.provider_metadata',
        ),
        false,
        `${scenario.id} invalid metadata must not become verified evidence`,
      );
      assert.equal(
        JSON.stringify(data).includes('undefined'),
        false,
        `${scenario.id} must not stringify missing identity metadata`,
      );
    }
    if (scenario.expect.stdout_truncated) {
      assert.equal(data.execution.stdout.truncated, true);
      assert.ok(data.execution.stdout.bytes_seen > data.execution.stdout.limit_bytes);
      assert.ok(data.execution.stdout.limit_bytes > 0);
    }
    if (scenario.expect.stderr_truncated) {
      assert.equal(data.execution.stderr.truncated, true);
      assert.ok(
        Buffer.byteLength(data.execution.stderr.excerpt, 'utf8') <=
          data.execution.stderr.limit_bytes,
      );
      assert.ok(!data.execution.stderr.excerpt.includes('fixture-super-secret-token'));
      assert.ok(!data.execution.stderr.excerpt.includes('fixture@example.com'));
    }
    if (scenario.id === 'CXD-048') {
      const serializedData = JSON.stringify(data);
      const leakedFamilies = DIAGNOSTIC_CANARIES.filter((canary) =>
        serializedData.includes(canary),
      );
      assert.deepEqual(leakedFamilies, [], 'normalized result retained diagnostic canaries');
      assert.equal(data.error.message, DIAGNOSTIC_REDACTED_TEXT);
      assert.equal(data.execution.stderr.excerpt, DIAGNOSTIC_REDACTED_TEXT);
      assert.match(data.error.message, /benign normalized diagnostic remains/u);
      assert.match(data.execution.stderr.excerpt, /benign normalized diagnostic remains/u);
      for (const entry of data.evidence as Record<string, any>[]) {
        const serializedErrors = JSON.stringify(entry.errors);
        for (const canary of DIAGNOSTIC_CANARIES)
          assert.equal(
            serializedErrors.includes(canary),
            false,
            `${entry.source.method} evidence errors leaked ${canary}`,
          );
      }
      const diagnosticEvidence = evidenceByMethod(data, 'codex-exec/unknown-event');
      assert.equal(
        diagnosticEvidence.payload_sha256,
        digest({
          type: 'fixture.diagnostic',
          schema: 'ccm/codex-diagnostic-fixture/v1',
          message: DIAGNOSTIC_REDACTED_TEXT,
        }),
        'diagnostic evidence digest must bind the redacted payload',
      );
      assert.notEqual(
        diagnosticEvidence.payload_sha256,
        digest({
          type: 'fixture.diagnostic',
          schema: 'ccm/codex-diagnostic-fixture/v1',
          message: DIAGNOSTIC_RAW_TEXT,
        }),
        'diagnostic evidence digest retained the raw payload',
      );
    }
    assert.equal(data.side_effects.board_writes, 0);
    assert.equal(data.side_effects.remote_mutations, 0);
    assert.equal(data.side_effects.account_mutations, scenario.expect.account_mutations);
    assert.equal(data.side_effects.credential_writes, scenario.expect.credential_writes);

    assert.ok(Array.isArray(data.evidence));
    assertRequestedEvidence(data, request);
    const predicates = data.candidate.predicates as Record<string, any>[];
    assertExactPredicateShape(data);
    for (const predicate of predicates)
      if (predicate.passed)
        assert.ok(predicate.evidence_ids.length > 0, `${predicate.id} pass needs evidence`);
    if (scenario.expect.automatic_eligible) {
      assert.ok(predicates.every((predicate) => predicate.passed));
    } else {
      assert.ok(predicates.some((predicate) => !predicate.passed));
      assert.ok(
        data.candidate.reason_codes.includes(scenario.expect.error_code),
        'candidate rejection reason must remain explicit',
      );
    }
    if (scenario.id >= 'CXD-040' && scenario.id <= 'CXD-045') {
      assertAttemptedQualificationFailureBinding(data, String(data.error.detail), 'nonzero');
    }
    if (scenario.id === 'CXD-046' || scenario.id === 'CXD-047') {
      assertAttemptedQualificationFailureBinding(data, String(data.error.phase), 'timeout');
    }
    if (scenario.id.startsWith('CXD-QTO-')) {
      assertAttemptedQualificationFailureBinding(data, String(data.error.phase), 'timeout');
    }
    if (scenario.id === 'CXD-007') {
      assertExactEligiblePredicateBindings(data);
      const unbound = structuredClone(data);
      unbound.candidate.predicates.find(
        (predicate: Record<string, any>) => predicate.id === 'behavioral-capability-proven',
      ).evidence_ids = [`ev-${'0'.repeat(64)}`];
      assert.throws(() => assertExactEligiblePredicateBindings(unbound));
      const wrongFacet = structuredClone(data);
      wrongFacet.candidate.predicates.find(
        (predicate: Record<string, any>) => predicate.id === 'behavioral-capability-proven',
      ).evidence_ids = [evidenceByMethod(wrongFacet, 'ccm-provider-inspect/request').evidence_id];
      assert.throws(() => assertExactEligiblePredicateBindings(wrongFacet));
    }

    const trace = readTrace(tracePath);
    assertProviderDerivationProof(data, trace, scenario, state, proofNonce, registryDocument);
    if (scenario.expect.required_spawn_kinds.includes('app-server-spawn')) {
      assertCanonicalProvenance(
        data,
        state,
        request,
        proofNonce,
        registryDocument,
        controlledBinaryPath,
      );
    }

    if (scenario.expect.execution_attempted && data.identity.actual) {
      assert.equal(
        new Set([
          data.identity.requested.evidence_id,
          data.identity.resolved.evidence_id,
          data.identity.actual.evidence_id,
        ]).size,
        3,
        'requested/resolved/actual evidence ids must remain immutable and distinct',
      );
    }

    assert.deepEqual(hostAuthority.attempts, [], `${scenario.id} bypassed provider capabilities`);
    assert.deepEqual(providerRuntime.networkCalls, [], `${scenario.id} requested host network`);
    const expectedProcessPhases = scenario.expect.expected_process_phases;
    if (expectedProcessPhases) {
      assert.deepEqual(
        providerRuntime.processCalls.map((call) => qualificationPhase(call.argv)),
        expectedProcessPhases,
      );
    } else {
      assert.equal(
        providerRuntime.processCalls.length,
        scenario.expect.required_spawn_kinds.length,
        `${scenario.id} must route every provider process through the injected capability`,
      );
    }
    if (scenario.id === 'CXD-049') {
      assert.ok(providerRuntime.processCalls.length > 0);
      assert.ok(
        providerRuntime.processCalls.every((call) => call.env.NO_COLOR === '1'),
        'every provider child must receive the deterministic NO_COLOR value',
      );
      assert.equal(JSON.stringify(data).includes(NO_COLOR_PARENT_CANARY), false);
    }
    assert.ok(!existsSync(remoteTracePath), `${scenario.id} invoked forbidden external tool`);
    for (const path of protectedRoots) {
      assert.equal(snapshotTree(path), protectedBefore.get(path), `${scenario.id} mutated ${path}`);
    }
    assert.equal(
      digest(Object.entries(process.env).sort(([left], [right]) => left.localeCompare(right))),
      processEnvBefore,
      `${scenario.id} mutated the parent environment`,
    );
    const serialized = `${out.join('')}\n${err.join('')}`;
    for (const secret of secretValues)
      assert.ok(!serialized.includes(secret), 'secret leaked to output');
    assert.ok(!serialized.includes(randomSecretKey), 'random secret key leaked to output');
  });
}
