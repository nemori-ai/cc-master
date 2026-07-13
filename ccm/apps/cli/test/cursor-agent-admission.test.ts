import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  type CursorAgentAdmission,
  type CursorAgentAdmissionEffects,
  type CursorAgentAdmissionRequest,
  type CursorAgentProcessResult,
  cursorAgentAdmissionMatchesRequest,
  evaluateCursorAgentAdmission,
  probeCursorAgentAdmission,
} from '../src/harnesses/cursor-agent-admission.js';

interface DogfoodFixture {
  processCases: Array<{
    name: string;
    request: CursorAgentAdmissionRequest;
    process: CursorAgentProcessResult;
    expected: {
      sandbox: CursorAgentAdmission['sandbox'];
      result_schema: CursorAgentAdmission['result_schema'];
      task_acceptance: CursorAgentAdmission['task_acceptance'];
      terminated: boolean;
      exit_code: number | null;
      schedulable: boolean;
    };
  }>;
  admissionCases: Array<{
    name: string;
    override: Partial<CursorAgentAdmission> & {
      binary?: Partial<CursorAgentAdmission['binary']>;
      authentication?: Partial<CursorAgentAdmission['authentication']>;
      quota?: Partial<CursorAgentAdmission['quota']>;
      transport?: Partial<CursorAgentAdmission['transport']>;
    };
    expected: boolean;
  }>;
}

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/cursor-agent-admission/dogfood.json', import.meta.url), 'utf8'),
) as DogfoodFixture;

const AVAILABLE_BINARY = {
  name: 'cursor-agent',
  path: '/fixture/bin/cursor-agent',
  available: true,
} as const;
const AVAILABLE_AUTH = { state: 'available', source: 'dogfood-fixture' } as const;
const AVAILABLE_QUOTA = { state: 'available', source: 'dogfood-fixture' } as const;

test('Cursor Agent dogfood process fixtures classify transport evidence without real effects', () => {
  for (const dogfood of fixture.processCases) {
    const invocations: Array<{ command: string; args: readonly string[] }> = [];
    const effects: CursorAgentAdmissionEffects = {
      runProcess(invocation) {
        invocations.push({ command: invocation.command, args: invocation.args });
        return dogfood.process;
      },
    };

    const admission = probeCursorAgentAdmission(
      {
        binary: AVAILABLE_BINARY,
        authentication: AVAILABLE_AUTH,
        quota: AVAILABLE_QUOTA,
        request: dogfood.request,
        prompt: 'fixture-only admission probe; do not access network or credentials',
      },
      effects,
    );

    assert.equal(invocations.length, 1, dogfood.name);
    assert.equal(invocations[0]?.command, AVAILABLE_BINARY.path, dogfood.name);
    assert.ok(invocations[0]?.args.includes('--output-format'), dogfood.name);
    assert.ok(invocations[0]?.args.includes('json'), dogfood.name);
    assert.equal(invocations[0]?.args.includes('--force'), false, dogfood.name);
    assert.equal(invocations[0]?.args.includes('--yolo'), false, dogfood.name);
    assert.equal(invocations[0]?.args.includes('login'), false, dogfood.name);
    assert.equal(invocations[0]?.args.includes('logout'), false, dogfood.name);
    assert.equal(admission.authentication.state, 'available', dogfood.name);
    assert.equal(admission.quota.state, 'available', dogfood.name);
    assert.equal(admission.sandbox, dogfood.expected.sandbox, dogfood.name);
    assert.equal(admission.result_schema, dogfood.expected.result_schema, dogfood.name);
    assert.equal(admission.task_acceptance, dogfood.expected.task_acceptance, dogfood.name);
    assert.equal(admission.transport.terminated, dogfood.expected.terminated, dogfood.name);
    assert.equal(admission.transport.exit_code, dogfood.expected.exit_code, dogfood.name);
    assert.equal(admission.schedulable, dogfood.expected.schedulable, dogfood.name);
  }
});

test('RC0 records transport termination only and cannot imply acceptance', () => {
  const empty = fixture.processCases.find((entry) => entry.name === 'rc0-empty-plan-result');
  assert.ok(empty);
  const admission = probeCursorAgentAdmission(
    {
      binary: AVAILABLE_BINARY,
      authentication: AVAILABLE_AUTH,
      quota: AVAILABLE_QUOTA,
      request: empty.request,
      prompt: 'fixture-only',
    },
    { runProcess: () => empty.process },
  );

  assert.equal(admission.transport.terminated, true);
  assert.equal(admission.transport.exit_code, 0);
  assert.equal(admission.result_schema, 'invalid-empty');
  assert.equal(admission.task_acceptance, 'unknown');
  assert.equal(admission.schedulable, false);
});

test('sandbox pre-exec failure remains independent from binary and authentication', () => {
  const preExec = fixture.processCases.find(
    (entry) => entry.name === 'apparmor-pre-exec-sandbox-unavailable',
  );
  assert.ok(preExec);
  const admission = probeCursorAgentAdmission(
    {
      binary: AVAILABLE_BINARY,
      authentication: AVAILABLE_AUTH,
      quota: AVAILABLE_QUOTA,
      request: preExec.request,
      prompt: 'fixture-only',
    },
    { runProcess: () => preExec.process },
  );

  assert.equal(admission.binary.available, true);
  assert.equal(admission.authentication.state, 'available');
  assert.equal(admission.sandbox, 'unavailable');
  assert.equal(admission.blockers.includes('authentication.unavailable'), false);
  assert.equal(admission.blockers.includes('sandbox.unavailable'), true);
});

test('unknown or unavailable preflight facts fail closed before any process effect', () => {
  const cases = [
    {
      name: 'binary unavailable',
      binary: { ...AVAILABLE_BINARY, path: null, available: false },
      authentication: AVAILABLE_AUTH,
      quota: AVAILABLE_QUOTA,
    },
    {
      name: 'authentication unknown',
      binary: AVAILABLE_BINARY,
      authentication: { state: 'unknown', source: 'dogfood-fixture' } as const,
      quota: AVAILABLE_QUOTA,
    },
    {
      name: 'quota unavailable',
      binary: AVAILABLE_BINARY,
      authentication: AVAILABLE_AUTH,
      quota: { state: 'unavailable', source: 'dogfood-fixture' } as const,
    },
  ];

  for (const preflight of cases) {
    let effectCalls = 0;
    const admission = probeCursorAgentAdmission(
      {
        binary: preflight.binary,
        authentication: preflight.authentication,
        quota: preflight.quota,
        request: { mode: 'ask', sandbox: 'required' },
        prompt: 'fixture-only',
      },
      {
        runProcess() {
          effectCalls += 1;
          throw new Error('process effect must not run for failed preflight');
        },
      },
    );

    assert.equal(effectCalls, 0, preflight.name);
    assert.equal(admission.schedulable, false, preflight.name);
    assert.equal(admission.transport.terminated, false, preflight.name);
  }
});

test('admission is the conjunction of every capability required by the requested mode', () => {
  const request: CursorAgentAdmissionRequest = { mode: 'ask', sandbox: 'required' };
  const baseline = evaluateCursorAgentAdmission({
    request,
    binary: AVAILABLE_BINARY,
    authentication: AVAILABLE_AUTH,
    quota: AVAILABLE_QUOTA,
    sandbox: 'supported',
    result_schema: 'valid',
    task_acceptance: 'accepted',
    transport: { terminated: true, exit_code: 0, signal: null },
  });

  for (const matrixCase of fixture.admissionCases) {
    const admission = evaluateCursorAgentAdmission({
      ...baseline,
      ...matrixCase.override,
      request,
      binary: { ...baseline.binary, ...matrixCase.override.binary },
      authentication: { ...baseline.authentication, ...matrixCase.override.authentication },
      quota: { ...baseline.quota, ...matrixCase.override.quota },
      transport: { ...baseline.transport, ...matrixCase.override.transport },
    });
    assert.equal(admission.schedulable, matrixCase.expected, matrixCase.name);
  }
});

test('mode-scoped evidence cannot be generalized across ask, plan, or sandbox profiles', () => {
  const ask = evaluateCursorAgentAdmission({
    request: { mode: 'ask', sandbox: 'not-requested' },
    binary: AVAILABLE_BINARY,
    authentication: AVAILABLE_AUTH,
    quota: AVAILABLE_QUOTA,
    sandbox: 'not-requested',
    result_schema: 'valid',
    task_acceptance: 'accepted',
    transport: { terminated: true, exit_code: 0, signal: null },
  });

  assert.equal(ask.schedulable, true);
  assert.equal(
    cursorAgentAdmissionMatchesRequest(ask, { mode: 'plan', sandbox: 'not-requested' }),
    false,
  );
  assert.equal(
    cursorAgentAdmissionMatchesRequest(ask, { mode: 'ask', sandbox: 'required' }),
    false,
  );
});
