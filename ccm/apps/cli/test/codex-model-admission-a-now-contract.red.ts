// Opt-in RED contract test for
// design_docs/2026-07-14-codex-model-admission-a-now-contract-v1.md.
//
// The default suite deliberately excludes *.red.ts. Every implementation seam runs in a
// permission-restricted child process. The test process, not the implementation, owns spawn and
// effect observations. Run with:
//   node --import tsx --test test/codex-model-admission-a-now-contract.red.ts

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

interface ContractCase {
  name: string;
  patch: Record<string, unknown>;
  expected: Record<string, unknown>;
  invocation?: { mode: 'single' | 'sequential' | 'concurrent'; count: number };
}

interface ContractFixture {
  schema: string;
  contract: string;
  domain: Record<string, unknown>;
  base: Record<string, unknown>;
  cases: ContractCase[];
}

interface EvaluatorInput {
  domain: Record<string, unknown>;
  input: Record<string, unknown>;
}

interface MutantSpec {
  domain: string;
  killed_by: string[];
}

interface EffectCounts {
  controlled_fixture_spawns: number;
  real_provider_requests: number;
  paid_canaries: number;
  account_mutations: number;
  credential_writes: number;
  config_writes: number;
  board_writes: number;
  remote_mutations: number;
}

interface SandboxObservation {
  counts: EffectCounts;
  boundary_attempts: Array<{ kind: string; operation: string }>;
  forbidden_semantic_attempts: Array<{ action: string; counter: keyof EffectCounts }>;
  complete?: boolean;
}

interface SandboxReply {
  ok: boolean;
  result?: unknown;
  results?: unknown[];
  observation: SandboxObservation;
  spawn_authorization?: 0;
  error?: { name: string; message: string; code?: string };
}

interface WrapperReply {
  ok: boolean;
  result?: unknown;
  results?: unknown[];
  error?: { name: string; message: string; code?: string };
}

const CONTRACT_ID = 'ccm/codex-model-admission-a-now/v1';
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(HERE, 'fixtures', 'codex-model-admission-a-now-v1');
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const SANDBOX_WORKER = join(HERE, 'helpers', 'codex-model-admission-contract-sandbox.mjs');
const IMPLEMENTATION_URL = new URL('../src/codex-model-admission-a-now.js', import.meta.url).href;
const UNSAFE_MUTANT_URL = pathToFileURL(
  join(FIXTURE_ROOT, 'mutants', 'unsafe-counterfeit.mjs'),
).href;
const TYPESCRIPT_MUTANT_URL = pathToFileURL(
  join(FIXTURE_ROOT, 'mutants', 'typescript-loader-counterfeit.ts'),
).href;
const NON_QUIESCENT_INTERVAL_URL = pathToFileURL(
  join(FIXTURE_ROOT, 'mutants', 'nonquiescent-interval.ts'),
).href;
const NON_QUIESCENT_MICROTASK_URL = pathToFileURL(
  join(FIXTURE_ROOT, 'mutants', 'nonquiescent-microtask.ts'),
).href;
const FORGED_EMPTY_SENTINEL_URL = pathToFileURL(
  join(FIXTURE_ROOT, 'mutants', 'forged-empty-sentinel.ts'),
).href;
const FORGED_OBSERVATION_SENTINEL_URL = pathToFileURL(
  join(FIXTURE_ROOT, 'mutants', 'forged-observation-sentinel.ts'),
).href;
const BEFORE_EXIT_SENTINEL_URL = pathToFileURL(
  join(FIXTURE_ROOT, 'mutants', 'before-exit-sentinel.ts'),
).href;
const BEFORE_EXIT_SEMANTIC_URL = pathToFileURL(
  join(FIXTURE_ROOT, 'mutants', 'before-exit-semantic.ts'),
).href;
const SANDBOX_WALL_TIMEOUT_MS = 2_000;
const RESULT_CHANNEL_INDEX = 3;
const OBSERVER_JOURNAL_INDEX = 4;

const ZERO_EFFECT_COUNTS: EffectCounts = {
  controlled_fixture_spawns: 0,
  real_provider_requests: 0,
  paid_canaries: 0,
  account_mutations: 0,
  credential_writes: 0,
  config_writes: 0,
  board_writes: 0,
  remote_mutations: 0,
};

const AUTHORIZATION_BINDING_FIELDS = [
  'schema',
  'issuer',
  'authority_ref',
  'attempt_id',
  'run_ref',
  'idempotency_key',
  'provider',
  'operation',
  'model_id',
  'effort',
  'workspace_realpath',
  'baseline_sha256',
  'effect',
  'issued_at',
  'expires_at',
  'nonce',
] as const;

function readJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, name), 'utf8')) as Record<string, unknown>;
}

function fixture(name: string): ContractFixture {
  const value = readJson(name);
  assert.equal(value.schema, 'ccm/codex-model-admission-a-now-fixtures/v1', `${name}: schema`);
  assert.equal(value.contract, CONTRACT_ID, `${name}: contract`);
  assert.ok(Array.isArray(value.cases), `${name}: cases[]`);
  return value as unknown as ContractFixture;
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result = structuredClone(base);
  for (const [key, patchValue] of Object.entries(patch)) {
    const baseValue = result[key];
    if (
      patchValue !== null &&
      typeof patchValue === 'object' &&
      !Array.isArray(patchValue) &&
      baseValue !== null &&
      typeof baseValue === 'object' &&
      !Array.isArray(baseValue)
    ) {
      result[key] = deepMerge(
        baseValue as Record<string, unknown>,
        patchValue as Record<string, unknown>,
      );
    } else {
      result[key] = structuredClone(patchValue);
    }
  }
  return result;
}

function assertNoOracleLeakage(value: unknown, path = '$'): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) assertNoOracleLeakage(entry, `${path}[${index}]`);
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    assert.ok(
      !['expected', 'cases', 'base', 'patch', 'name'].includes(key),
      `oracle key ${key} leaked at ${path}`,
    );
    assertNoOracleLeakage(entry, `${path}.${key}`);
  }
}

function evaluatorInput(value: ContractFixture, scenario: ContractCase): EvaluatorInput {
  const result = {
    domain: structuredClone(value.domain),
    input: deepMerge(value.base, scenario.patch),
  };
  assertNoOracleLeakage(result);
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isEffectCounter(value: unknown): value is keyof EffectCounts {
  return typeof value === 'string' && Object.hasOwn(ZERO_EFFECT_COUNTS, value);
}

function channelText(output: Array<string | null> | null, index: number): string {
  const value = output?.[index];
  return typeof value === 'string' ? value : '';
}

function decodeObserverJournal(
  raw: string,
  complete: boolean,
): { observation: SandboxObservation; valid: boolean } {
  const counts = structuredClone(ZERO_EFFECT_COUNTS);
  const boundaryAttempts: SandboxObservation['boundary_attempts'] = [];
  const forbiddenSemanticAttempts: SandboxObservation['forbidden_semantic_attempts'] = [];
  let expectedSequence = 1;
  let valid = true;

  for (const line of raw.split('\n').filter((entry) => entry.length > 0)) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      valid = false;
      continue;
    }
    if (!isRecord(event) || event.sequence !== expectedSequence || typeof event.type !== 'string') {
      valid = false;
      continue;
    }
    expectedSequence += 1;

    if (
      event.type === 'boundary' &&
      typeof event.kind === 'string' &&
      typeof event.operation === 'string'
    ) {
      boundaryAttempts.push({ kind: event.kind, operation: event.operation });
      continue;
    }
    if (
      event.type === 'semantic' &&
      typeof event.action === 'string' &&
      isEffectCounter(event.counter)
    ) {
      counts[event.counter] += 1;
      forbiddenSemanticAttempts.push({ action: event.action, counter: event.counter });
      continue;
    }
    if (event.type === 'effect' && isEffectCounter(event.counter)) {
      counts[event.counter] += 1;
      continue;
    }
    valid = false;
  }

  if (!valid) {
    boundaryAttempts.push({ kind: 'observer', operation: 'journal-malformed' });
  }
  return {
    valid,
    observation: {
      counts,
      boundary_attempts: boundaryAttempts,
      forbidden_semantic_attempts: forbiddenSemanticAttempts,
      complete: complete && valid,
    },
  };
}

function decodeSingleWrapperReply(raw: string): { reply?: WrapperReply; error?: string } {
  const lines = raw.split('\n').filter((entry) => entry.length > 0);
  if (lines.length !== 1) {
    return { error: `expected exactly one wrapper result frame, received ${lines.length}` };
  }

  let value: unknown;
  try {
    value = JSON.parse(lines[0] ?? '');
  } catch {
    return { error: 'wrapper result frame is not valid JSON' };
  }
  if (!isRecord(value) || !Object.hasOwn(value, 'ok') || typeof value.ok !== 'boolean') {
    return { error: 'wrapper result frame has no boolean ok field' };
  }
  if ('observation' in value || 'spawn_authorization' in value) {
    return {
      error: 'wrapper result frame attempted to supply parent-owned authority or observation',
    };
  }

  const hasResult = Object.hasOwn(value, 'result');
  const hasResults = Object.hasOwn(value, 'results');
  if (value.ok) {
    if (hasResult === hasResults || (hasResults && !Array.isArray(value.results))) {
      return { error: 'successful wrapper frame must contain exactly one of result or results' };
    }
    const allowed = new Set(hasResult ? ['ok', 'result'] : ['ok', 'results']);
    if (!hasOnlyKeys(value, allowed)) {
      return { error: 'successful wrapper frame contains an unexpected field' };
    }
  } else {
    if (hasResult || hasResults || !isRecord(value.error)) {
      return { error: 'failed wrapper frame must contain only a structured error' };
    }
    if (!hasOnlyKeys(value, new Set(['ok', 'error']))) {
      return { error: 'failed wrapper frame contains an unexpected field' };
    }
    const error = value.error;
    if (
      !Object.hasOwn(error, 'name') ||
      !Object.hasOwn(error, 'message') ||
      typeof error.name !== 'string' ||
      typeof error.message !== 'string' ||
      !hasOnlyKeys(error, new Set(['name', 'message', 'code'])) ||
      (Object.hasOwn(error, 'code') && typeof error.code !== 'string')
    ) {
      return { error: 'failed wrapper frame error is malformed' };
    }
  }
  return { reply: value as unknown as WrapperReply };
}

function denySandbox(
  observation: SandboxObservation,
  name: string,
  code: string,
  message: string,
): SandboxReply {
  return {
    ok: false,
    spawn_authorization: 0,
    observation,
    error: { name, code, message },
  };
}

function runSandbox(
  request: Record<string, unknown>,
  options: { extraEnv?: Record<string, string> } = {},
): SandboxReply {
  const child = spawnSync(
    process.execPath,
    ['--permission', '--allow-fs-read=*', '--allow-worker', '--import', 'tsx', SANDBOX_WORKER],
    {
      cwd: join(REPO_ROOT, 'ccm', 'apps', 'cli'),
      env: {
        ...process.env,
        TSX_DISABLE_CACHE: '1',
        ...options.extraEnv,
      },
      input: JSON.stringify(request),
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
      timeout: SANDBOX_WALL_TIMEOUT_MS,
      // Linux and macOS both provide SIGKILL. A non-cooperative evaluator cannot intercept it, and
      // spawnSync returns only after the child has been synchronously reaped.
      killSignal: 'SIGKILL',
    },
  );

  const journal = decodeObserverJournal(channelText(child.output, OBSERVER_JOURNAL_INDEX), false);
  const timedOut = (child.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  if (timedOut) {
    journal.observation.boundary_attempts.push({
      kind: 'async',
      operation: 'non-quiescent:parent-wall-timeout',
    });
    return denySandbox(
      journal.observation,
      'EvaluatorNonQuiescentError',
      'CCM_EVALUATOR_NON_QUIESCENT',
      `evaluator child exceeded ${SANDBOX_WALL_TIMEOUT_MS}ms parent wall-clock bound`,
    );
  }

  if (child.error || child.signal !== null || child.status !== 0) {
    return denySandbox(
      journal.observation,
      'EvaluatorChildError',
      'CCM_EVALUATOR_CHILD_FAILED',
      `sandbox child failed: ${
        (child.error as NodeJS.ErrnoException | undefined)?.code ??
        child.signal ??
        `exit-${child.status ?? 'unknown'}`
      }`,
    );
  }

  const finalJournal = decodeObserverJournal(
    channelText(child.output, OBSERVER_JOURNAL_INDEX),
    true,
  );
  const decoded = decodeSingleWrapperReply(channelText(child.output, RESULT_CHANNEL_INDEX));
  if (!finalJournal.valid || !decoded.reply) {
    finalJournal.observation.complete = false;
    return denySandbox(
      finalJournal.observation,
      'EvaluatorProtocolError',
      'CCM_EVALUATOR_PROTOCOL_ERROR',
      decoded.error ?? 'observer journal is malformed',
    );
  }
  return { ...decoded.reply, observation: finalJournal.observation };
}

function requireSuccessfulSandbox(reply: SandboxReply): SandboxReply {
  if (reply.ok) return reply;
  const error = reply.error;
  if (error?.code === 'ERR_MODULE_NOT_FOUND') {
    throw new Error(
      'HONEST RED: expected ccm/apps/cli/src/codex-model-admission-a-now.ts is absent; do not make this green without implementing the frozen v1 contract',
      { cause: error },
    );
  }
  throw new Error(
    `sandboxed contract evaluation failed: ${error?.name ?? 'Error'}: ${error?.message ?? 'unknown'}`,
  );
}

function assertHermeticObservation(
  observation: SandboxObservation,
  expectedCounts: EffectCounts,
  label: string,
): void {
  assert.deepEqual(observation.counts, expectedCounts, `${label}: observer-owned effect counts`);
  assert.deepEqual(
    observation.boundary_attempts,
    [],
    `${label}: process-sandbox boundary attempts`,
  );
  assert.deepEqual(
    observation.forbidden_semantic_attempts,
    [],
    `${label}: forbidden semantic effect attempts`,
  );
}

function runPureScenario(
  moduleUrl: string,
  evaluator: 'evaluateW1Case' | 'evaluateReconciliationCase',
  value: EvaluatorInput,
): SandboxReply {
  return requireSuccessfulSandbox(
    runSandbox({ mode: 'evaluate', module_url: moduleUrl, evaluator, value }),
  );
}

function runAuthorityScenario(
  moduleUrl: string,
  value: EvaluatorInput,
  invocation: NonNullable<ContractCase['invocation']>,
): SandboxReply {
  return requireSuccessfulSandbox(
    runSandbox({ mode: 'authority', module_url: moduleUrl, value, invocation }),
  );
}

function runEffectScenario(
  moduleUrl: string,
  value: EvaluatorInput,
  extraEnv?: Record<string, string>,
): SandboxReply {
  return requireSuccessfulSandbox(
    runSandbox({ mode: 'effect', module_url: moduleUrl, value }, { extraEnv }),
  );
}

function authorizationPatchField(scenario: ContractCase): string | null {
  const policy = scenario.patch.policy;
  if (policy === null || typeof policy !== 'object' || Array.isArray(policy)) return null;
  const authorization = (policy as Record<string, unknown>).launch_authorization;
  if (authorization === null || typeof authorization !== 'object' || Array.isArray(authorization)) {
    return null;
  }
  const fields = Object.keys(authorization as Record<string, unknown>);
  return fields.length === 1 ? (fields[0] ?? null) : null;
}

test('contract fixtures, oracle isolation, and instrumentation calibration are self-consistent', () => {
  assert.equal(
    existsSync(
      join(REPO_ROOT, 'design_docs', '2026-07-14-codex-model-admission-a-now-contract-v1.md'),
    ),
    true,
  );

  const manifest = readJson('manifest.json');
  assert.equal(manifest.schema, 'ccm/codex-model-admission-a-now-fixture-manifest/v1');
  assert.equal(manifest.contract, CONTRACT_ID);
  const files = manifest.files as Record<string, string[]>;
  assert.deepEqual(Object.keys(files).sort(), [
    'authority.json',
    'effects.json',
    'reconciliation.json',
    'w1.json',
  ]);

  for (const [name, expectedNames] of Object.entries(files)) {
    const value = fixture(name);
    assert.deepEqual(
      value.cases.map((scenario) => scenario.name),
      expectedNames,
      `${name}: manifest case order and names`,
    );
    assert.equal(new Set(expectedNames).size, expectedNames.length, `${name}: unique case names`);
    for (const scenario of value.cases) evaluatorInput(value, scenario);
  }

  assert.throws(
    () => assertNoOracleLeakage({ nested: { expected: 'would-vacuously-pass' } }),
    /oracle key expected leaked/,
  );

  const w1 = fixture('w1.json');
  assert.deepEqual(w1.domain.authorization_binding_fields, AUTHORIZATION_BINDING_FIELDS);
  const grantCases = w1.cases.filter((scenario) => authorizationPatchField(scenario) !== null);
  assert.deepEqual(
    grantCases.map(authorizationPatchField).sort(),
    [...AUTHORIZATION_BINDING_FIELDS].sort(),
    'every grant binding is mutated exactly once',
  );
  const observedReasons = new Set(
    w1.cases.flatMap((scenario) => {
      const reasonCodes = scenario.expected.reason_codes;
      return Array.isArray(reasonCodes) ? reasonCodes : [];
    }),
  );
  assert.deepEqual(
    [...observedReasons].sort(),
    [...(w1.domain.reason_priority as string[])].sort(),
    'every frozen W1 reject reason has an executable fixture',
  );

  const effects = fixture('effects.json');
  const forbiddenActions = effects.domain.forbidden_actions as string[];
  assert.deepEqual(
    effects.cases
      .filter((scenario) => scenario.name.endsWith('-is-rejected'))
      .map((scenario) => (scenario.patch.requested_action as string) ?? null),
    forbiddenActions,
    'every forbidden semantic action has an executable rejection fixture in contract order',
  );

  const mutants = manifest.mutants as Record<string, MutantSpec>;
  assert.ok(Object.keys(mutants).length > 0, 'manifest retains named mutation obligations');
  for (const [mutantName, spec] of Object.entries(mutants)) {
    const value = fixture(spec.domain);
    assert.ok(spec.killed_by.length > 0, `${mutantName}: at least one killing fixture`);
    for (const scenarioName of spec.killed_by) {
      assert.ok(
        value.cases.some((entry) => entry.name === scenarioName),
        `${mutantName}: ${scenarioName} exists in ${spec.domain}`,
      );
    }
  }
});

test('observer-owned instruments kill the three reviewed counterfeit classes', () => {
  const typescriptReply = runSandbox({
    mode: 'evaluate',
    module_url: TYPESCRIPT_MUTANT_URL,
    evaluator: 'evaluateW1Case',
    value: { loader_probe: true },
  });
  assert.equal(
    typescriptReply.ok,
    true,
    `TypeScript evaluator must bind before restrictions arm: ${typescriptReply.error?.message ?? 'unknown error'}`,
  );
  assert.deepEqual(typescriptReply.result, { loader: 'tsx-bound-before-restrictions' });

  const w1 = fixture('w1.json');
  for (const scenario of w1.cases.filter((entry) => authorizationPatchField(entry) !== null)) {
    const reply = runPureScenario(
      UNSAFE_MUTANT_URL,
      'evaluateW1Case',
      evaluatorInput(w1, scenario),
    );
    assertHermeticObservation(
      reply.observation,
      ZERO_EFFECT_COUNTS,
      `grant mutant: ${scenario.name}`,
    );
    assert.notDeepEqual(reply.result, scenario.expected, `grant mutant killed by ${scenario.name}`);
  }

  const authority = fixture('authority.json');
  for (const scenarioName of [
    'same-process-second-invocation-does-not-spawn',
    'same-process-concurrent-invocations-spawn-at-most-once',
  ]) {
    const scenario = authority.cases.find((entry) => entry.name === scenarioName);
    assert.ok(scenario?.invocation, `${scenarioName}: invocation fixture`);
    const reply = runAuthorityScenario(
      UNSAFE_MUTANT_URL,
      evaluatorInput(authority, scenario),
      scenario.invocation,
    );
    assert.notDeepEqual(
      {
        results: reply.results,
        observation: reply.observation.counts,
      },
      scenario.expected,
      `double-use mutant killed by ${scenarioName}`,
    );
    assert.equal(reply.observation.counts.controlled_fixture_spawns, 2);
  }

  const effects = fixture('effects.json');
  const hermetic = effects.cases.find((entry) => entry.name === 'contract-evaluation-is-hermetic');
  assert.ok(hermetic, 'hermetic effect fixture');
  const marker = join(tmpdir(), `ccm-model-admission-unsafe-mutant-${process.pid}`);
  assert.equal(existsSync(marker), false, 'unsafe marker absent before calibration');
  const rawReply = runSandbox(
    {
      mode: 'effect',
      module_url: UNSAFE_MUTANT_URL,
      value: evaluatorInput(effects, hermetic),
    },
    { extraEnv: { CCM_CONTRACT_MUTANT_MARKER: marker } },
  );
  assert.equal(rawReply.ok, true, 'write-effect mutant swallowed the denial and returned normally');
  assert.deepEqual(rawReply.observation.boundary_attempts, [
    { kind: 'filesystem', operation: 'writeFileSync' },
    { kind: 'filesystem', operation: 'utimesSync' },
  ]);
  assert.deepEqual(rawReply.observation.forbidden_semantic_attempts, [
    { action: 'login', counter: 'account_mutations' },
  ]);
  assert.equal(rawReply.observation.counts.account_mutations, 1);
  assert.equal(existsSync(marker), false, 'permission boundary prevented the marker write');

  const effectProbes = [
    {
      scenario: 'real-provider-request-is-rejected',
      boundary: [{ kind: 'process', operation: 'spawnSync' }],
      semantic: [],
    },
    {
      scenario: 'remote-mutation-is-rejected',
      boundary: [{ kind: 'network', operation: 'fetch' }],
      semantic: [],
    },
    {
      scenario: 'login-is-rejected',
      boundary: [],
      semantic: [{ action: 'login', counter: 'account_mutations' }],
    },
    {
      scenario: 'import-credential-is-rejected',
      boundary: [],
      semantic: [{ action: 'import-credential', counter: 'credential_writes' }],
    },
  ];
  for (const probe of effectProbes) {
    const scenario = effects.cases.find((entry) => entry.name === probe.scenario);
    assert.ok(scenario, `${probe.scenario}: calibration fixture`);
    const reply = runSandbox({
      mode: 'effect',
      module_url: UNSAFE_MUTANT_URL,
      value: evaluatorInput(effects, scenario),
    });
    assert.equal(reply.ok, true, `${probe.scenario}: counterfeit swallowed the denial`);
    assert.deepEqual(reply.observation.boundary_attempts, probe.boundary);
    assert.deepEqual(reply.observation.forbidden_semantic_attempts, probe.semantic);
    for (const attempt of probe.semantic) {
      assert.equal(reply.observation.counts[attempt.counter as keyof EffectCounts], 1);
    }
  }
});

test('parent hard bound denies and reaps non-quiescent evaluator children', () => {
  for (const [label, moduleUrl] of [
    ['referenced interval', NON_QUIESCENT_INTERVAL_URL],
    ['recursive microtask starvation', NON_QUIESCENT_MICROTASK_URL],
  ] as const) {
    const started = performance.now();
    const reply = runSandbox({
      mode: 'evaluate',
      module_url: moduleUrl,
      evaluator: 'evaluateW1Case',
      value: {},
    });
    const elapsedMs = performance.now() - started;

    assert.equal(reply.ok, false, `${label}: typed deny`);
    assert.equal(reply.spawn_authorization, 0, `${label}: no positive spawn authority`);
    assert.equal(
      reply.observation.complete,
      false,
      `${label}: incomplete observations stay honest`,
    );
    assert.ok(
      reply.observation.boundary_attempts.some(
        (attempt) => attempt.kind === 'async' && attempt.operation.startsWith('non-quiescent:'),
      ),
      `${label}: non-quiescent boundary evidence`,
    );
    assert.equal(reply.error?.name, 'EvaluatorNonQuiescentError', `${label}: typed error name`);
    assert.equal(reply.error?.code, 'CCM_EVALUATOR_NON_QUIESCENT', `${label}: typed error code`);
    assert.ok(
      elapsedMs <= SANDBOX_WALL_TIMEOUT_MS + 1_000,
      `${label}: parent wall bound (${elapsedMs.toFixed(0)}ms)`,
    );
    assert.equal('result' in reply, false, `${label}: result cannot become authority`);
    assert.equal('results' in reply, false, `${label}: results cannot become authority`);
  }
});

test('R4 parent-owned protocol ignores evaluator stdout on timeout', () => {
  for (const [label, moduleUrl, expectedBoundary] of [
    ['empty sentinel', FORGED_EMPTY_SENTINEL_URL, null],
    [
      'forged observation sentinel',
      FORGED_OBSERVATION_SENTINEL_URL,
      { kind: 'filesystem', operation: 'writeFileSync' },
    ],
  ] as const) {
    const reply = runSandbox({
      mode: 'evaluate',
      module_url: moduleUrl,
      evaluator: 'evaluateW1Case',
      value: {},
    });
    assert.equal(reply.ok, false, `${label}: typed deny`);
    assert.equal(reply.spawn_authorization, 0, `${label}: zero authority`);
    assert.equal(reply.error?.code, 'CCM_EVALUATOR_NON_QUIESCENT', `${label}: timeout code`);
    assert.equal('result' in reply, false, `${label}: no result`);
    assert.equal('results' in reply, false, `${label}: no results`);
    if (expectedBoundary) {
      assert.ok(
        reply.observation.boundary_attempts.some(
          (attempt) =>
            attempt.kind === expectedBoundary.kind &&
            attempt.operation === expectedBoundary.operation,
        ),
        `${label}: observer journal retains the denied attempt`,
      );
    }
  }
});

test('R4 parent-owned result channel ignores a later stdout sentinel', () => {
  const reply = runSandbox({
    mode: 'evaluate',
    module_url: BEFORE_EXIT_SENTINEL_URL,
    evaluator: 'evaluateW1Case',
    value: {},
  });
  assert.equal(reply.ok, true);
  assert.deepEqual(reply.result, { status: 'actual-wrapper-result' });
  assert.equal('spawn_authorization' in reply, false);
  assertHermeticObservation(reply.observation, ZERO_EFFECT_COUNTS, 'beforeExit stdout sentinel');
});

test('R4 append-only observer journal includes a beforeExit semantic attempt', () => {
  const reply = runSandbox({
    mode: 'effect',
    module_url: BEFORE_EXIT_SEMANTIC_URL,
    value: {},
  });
  assert.equal(reply.ok, true);
  assert.deepEqual(reply.result, { status: 'returned-before-late-login' });
  assert.equal(reply.observation.counts.account_mutations, 1);
  assert.deepEqual(reply.observation.forbidden_semantic_attempts, [
    { action: 'login', counter: 'account_mutations' },
  ]);
});

test('R4 wrapper result channel faults are typed zero-authority denies', () => {
  for (const fault of ['missing-result', 'duplicate-result', 'malformed-result']) {
    const reply = runSandbox({
      mode: 'evaluate',
      module_url: TYPESCRIPT_MUTANT_URL,
      evaluator: 'evaluateW1Case',
      value: { loader_probe: true },
      protocol_fault: fault,
    });
    assert.equal(reply.ok, false, `${fault}: deny`);
    assert.equal(reply.spawn_authorization, 0, `${fault}: zero authority`);
    assert.equal(reply.error?.name, 'EvaluatorProtocolError', `${fault}: typed name`);
    assert.equal(reply.error?.code, 'CCM_EVALUATOR_PROTOCOL_ERROR', `${fault}: typed code`);
    assert.equal(reply.observation.complete, false, `${fault}: incomplete observation`);
    assert.equal('result' in reply, false, `${fault}: no result`);
    assert.equal('results' in reply, false, `${fault}: no results`);
  }
});

for (const fault of [
  'success-with-error',
  'non-string-error-code',
  'unknown-result-key',
  'success-missing-result',
  'failure-with-result',
]) {
  test(`R5 closed reply schema denies ${fault}`, () => {
    const reply = runSandbox({
      mode: 'evaluate',
      module_url: TYPESCRIPT_MUTANT_URL,
      evaluator: 'evaluateW1Case',
      value: { loader_probe: true },
      protocol_fault: fault,
    });
    assert.equal(reply.ok, false, `${fault}: deny`);
    assert.equal(reply.spawn_authorization, 0, `${fault}: zero authority`);
    assert.equal(reply.error?.name, 'EvaluatorProtocolError', `${fault}: typed name`);
    assert.equal(reply.error?.code, 'CCM_EVALUATOR_PROTOCOL_ERROR', `${fault}: typed code`);
    assert.equal(reply.observation.complete, false, `${fault}: incomplete observation`);
    assert.equal('result' in reply, false, `${fault}: no result`);
    assert.equal('results' in reply, false, `${fault}: no results`);
  });
}

test('w1.json is executable against the frozen v1 evaluator', () => {
  const value = fixture('w1.json');
  for (const scenario of value.cases) {
    const reply = runPureScenario(
      IMPLEMENTATION_URL,
      'evaluateW1Case',
      evaluatorInput(value, scenario),
    );
    assertHermeticObservation(reply.observation, ZERO_EFFECT_COUNTS, `w1.json: ${scenario.name}`);
    assert.deepEqual(reply.result, scenario.expected, `w1.json: ${scenario.name}`);
  }
});

test('authority.json consumes one private same-process spawn capability', () => {
  const value = fixture('authority.json');
  for (const scenario of value.cases) {
    assert.ok(scenario.invocation, `${scenario.name}: invocation`);
    const reply = runAuthorityScenario(
      IMPLEMENTATION_URL,
      evaluatorInput(value, scenario),
      scenario.invocation,
    );
    assert.deepEqual(
      {
        results: reply.results,
        observation: reply.observation.counts,
      },
      scenario.expected,
      `authority.json: ${scenario.name}`,
    );
    assert.deepEqual(
      reply.observation.boundary_attempts,
      [],
      `${scenario.name}: process-sandbox effects`,
    );
    assert.deepEqual(
      reply.observation.forbidden_semantic_attempts,
      [],
      `${scenario.name}: forbidden semantic effects`,
    );
  }
});

test('reconciliation.json is executable against the frozen v1 evaluator', () => {
  const value = fixture('reconciliation.json');
  for (const scenario of value.cases) {
    const reply = runPureScenario(
      IMPLEMENTATION_URL,
      'evaluateReconciliationCase',
      evaluatorInput(value, scenario),
    );
    assertHermeticObservation(
      reply.observation,
      ZERO_EFFECT_COUNTS,
      `reconciliation.json: ${scenario.name}`,
    );
    assert.deepEqual(reply.result, scenario.expected, `reconciliation.json: ${scenario.name}`);
  }
});

test('effects.json is observed at semantic and process-sandbox boundaries', () => {
  const value = fixture('effects.json');
  assert.equal('observed' in value.base, false, 'implementation input cannot self-report effects');
  for (const scenario of value.cases) {
    const reply = runEffectScenario(IMPLEMENTATION_URL, evaluatorInput(value, scenario));
    const expected = scenario.expected as {
      result: Record<string, unknown>;
      observation: EffectCounts;
    };
    assert.deepEqual(reply.result, expected.result, `effects.json: ${scenario.name}: result`);
    assertHermeticObservation(
      reply.observation,
      expected.observation,
      `effects.json: ${scenario.name}`,
    );
  }
});
