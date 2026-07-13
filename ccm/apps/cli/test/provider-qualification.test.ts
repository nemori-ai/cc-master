import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  redactProviderDiagnostic,
  sha256Bytes,
  sha256Canonical,
} from '../src/provider-evidence.js';
import {
  assertCodexQualificationDispatcher,
  assertCodexQualificationFinalization,
  CODEX_QUALIFICATION_OUTCOME_REVISION,
  CODEX_QUALIFICATION_PHASE_REGISTRY,
  finalizeCodexQualificationFailure,
} from '../src/provider-qualification.js';

const TEST_QUALIFICATION_PHASES = [
  'version',
  'root-help',
  'exec-help',
  'app-server-help',
  'app-server-schema',
  'exec-parse-only',
] as const;

const BINARY = {
  binaryRealpath: '/controlled/bin/codex',
  binaryVersion: '0.test',
} as const;

function nonzeroWithDiagnostics(
  phase: (typeof TEST_QUALIFICATION_PHASES)[number],
  stdout: string,
  stderr: string,
  exitCode = 42,
) {
  return finalizeCodexQualificationFailure({
    phase,
    binary: phase === 'version' ? { ...BINARY, binaryVersion: null } : BINARY,
    observedAt: '2026-07-13T08:01:00Z',
    outcome: {
      kind: 'nonzero',
      exitCode,
      signal: null,
      stdout,
      stderr,
    },
  });
}

function nonzero(phase: (typeof TEST_QUALIFICATION_PHASES)[number], exitCode = 42) {
  return nonzeroWithDiagnostics(phase, 'controlled stdout', 'controlled stderr', exitCode);
}

function timeout(
  phase: (typeof TEST_QUALIFICATION_PHASES)[number],
  terminationSignal: 'SIGKILL' | 'SIGTERM' = 'SIGKILL',
) {
  return finalizeCodexQualificationFailure({
    phase,
    binary: phase === 'version' ? { ...BINARY, binaryVersion: null } : BINARY,
    observedAt: '2026-07-13T08:01:00Z',
    outcome: {
      kind: 'supervisor-error',
      code: 'hard_timeout',
      operation: phase,
      stream: undefined,
      observedBytes: undefined,
      limitBytes: undefined,
      termination: { exitCode: null, signal: terminationSignal, reaped: true },
      reapTimedOut: false,
    },
  });
}

test('production qualification registry is exact-equal to the independently enumerated phase set', () => {
  assert.deepEqual(
    CODEX_QUALIFICATION_PHASE_REGISTRY.map((phase) => phase.id),
    TEST_QUALIFICATION_PHASES,
  );
  assertCodexQualificationDispatcher(
    Object.fromEntries(TEST_QUALIFICATION_PHASES.map((phase) => [phase, async () => undefined])),
  );

  assert.throws(
    () =>
      assertCodexQualificationDispatcher({
        ...Object.fromEntries(
          TEST_QUALIFICATION_PHASES.map((phase) => [phase, async () => undefined]),
        ),
        'unregistered-phase': async () => undefined,
      }),
    /qualification dispatcher.*exact/u,
  );
});

test('phase x outcome matrix finalizes canonical evidence and facet-correct predicates', () => {
  for (const phase of TEST_QUALIFICATION_PHASES) {
    for (const result of [nonzero(phase), timeout(phase)]) {
      assertCodexQualificationFinalization(result);
      assert.equal(result.evidence.kind, 'binary-capability');
      assert.equal(result.evidence.source.method, `codex-qualification/${phase}`);
      assert.equal(result.evidence.source.revision, CODEX_QUALIFICATION_OUTCOME_REVISION);
      assert.equal(result.evidence.source.schema_version, CODEX_QUALIFICATION_OUTCOME_REVISION);
      assert.equal(result.evidence.freshness, 'unknown');
      assert.equal(result.evidence.completeness, 'complete');
      assert.ok(result.evidence.errors.length > 0);
      assert.deepEqual(result.passed, {
        'binary-available': true,
        'behavioral-capability-proven': false,
      });
      assert.deepEqual(result.bindings, {
        'binary-available': [result.evidence.evidence_id],
        'behavioral-capability-proven': [result.evidence.evidence_id],
      });
      assert.equal(
        result.failedReasons['behavioral-capability-proven'],
        'binary_capability_unproven',
      );
    }
  }
});

test('qualification evidence ids are value-bound across phase, outcome, and termination facts', () => {
  assert.notEqual(
    nonzero('version', 42).evidence.evidence_id,
    nonzero('version', 43).evidence.evidence_id,
  );
  assert.notEqual(
    nonzero('version').evidence.evidence_id,
    nonzero('root-help').evidence.evidence_id,
  );
  assert.notEqual(
    timeout('version', 'SIGKILL').evidence.evidence_id,
    timeout('version', 'SIGTERM').evidence.evidence_id,
  );
  assert.notEqual(nonzero('version').evidence.evidence_id, timeout('version').evidence.evidence_id);

  const redactedStdout =
    'benign stdout context remains\nAuthorization: Basic [REDACTED]\nbenign stdout tail remains';
  const redactedStderr =
    'benign stderr context remains\nAuthorization: Basic [REDACTED]\nbenign stderr tail remains';
  const secretA = nonzeroWithDiagnostics(
    'root-help',
    redactedStdout.replace('[REDACTED]', 'BASIC-QUALIFICATION-SECRET-A'),
    redactedStderr.replace('[REDACTED]', 'BASIC-QUALIFICATION-ERROR-A'),
  );
  const secretB = nonzeroWithDiagnostics(
    'root-help',
    redactedStdout.replace('[REDACTED]', 'BASIC-QUALIFICATION-SECRET-B-MUCH-LONGER'),
    redactedStderr.replace('[REDACTED]', 'BASIC-QUALIFICATION-ERROR-B-MUCH-LONGER'),
  );
  const expectedPayload = {
    schema: CODEX_QUALIFICATION_OUTCOME_REVISION,
    phase: 'root-help',
    attempted: true,
    outcome: 'nonzero',
    process: {
      exit_code: 42,
      signal: null,
      termination: null,
      reap_timed_out: false,
    },
    diagnostics: {
      stdout: {
        bytes: Buffer.byteLength(redactedStdout, 'utf8'),
        sha256: sha256Bytes(redactedStdout),
        excerpt: redactedStdout,
      },
      stderr: {
        bytes: Buffer.byteLength(redactedStderr, 'utf8'),
        sha256: sha256Bytes(redactedStderr),
        excerpt: redactedStderr,
      },
    },
  };

  assert.equal(secretA.evidence.payload_sha256, sha256Canonical(expectedPayload));
  assert.equal(secretB.evidence.payload_sha256, secretA.evidence.payload_sha256);
  assert.equal(secretB.evidence.evidence_id, secretA.evidence.evidence_id);
  assert.deepEqual(secretB.evidence.errors, secretA.evidence.errors);
  assert.match(secretA.evidence.errors[0] ?? '', /benign stderr context remains/u);
  assert.match(secretA.evidence.errors[0] ?? '', /benign stderr tail remains/u);
  assert.deepEqual(secretA.evidence.redactions, ['credential']);
  const retainedEvidence = JSON.stringify([secretA.evidence, secretB.evidence]);
  for (const rawCanary of [
    'BASIC-QUALIFICATION-SECRET-A',
    'BASIC-QUALIFICATION-ERROR-A',
    'BASIC-QUALIFICATION-SECRET-B-MUCH-LONGER',
    'BASIC-QUALIFICATION-ERROR-B-MUCH-LONGER',
  ]) {
    assert.doesNotMatch(retainedEvidence, new RegExp(rawCanary, 'u'));
  }
});

test('qualification redacts nonzero diagnostics before applying the retained byte bound', () => {
  const sizedCanary = (prefix: string, bytes: number) => {
    assert.ok(Buffer.byteLength(prefix, 'utf8') <= bytes);
    return `${prefix}${'x'.repeat(bytes - Buffer.byteLength(prefix, 'utf8'))}`;
  };
  const shortBasic = sizedCanary('BASIC-8!', 8);
  const longBasic = sizedCanary('BASIC-960-CANARY-', 960);
  const shortCredential = sizedCanary('CRED-8!!', 8);
  const longCredential = sizedCanary('CREDENTIAL-960-CANARY-', 960);
  const stdout = (credential: string) =>
    [
      'BENIGN-STDOUT-PREFIX-SHOULD-SURVIVE',
      `credential=${credential}`,
      'BENIGN-STDOUT-TAIL-SHOULD-SURVIVE',
    ].join('\n');
  const stderr = (basic: string) =>
    [
      'BENIGN-STDERR-PREFIX-SHOULD-SURVIVE',
      `Authorization: Basic ${basic}`,
      'BENIGN-STDERR-TAIL-SHOULD-SURVIVE',
    ].join('\n');
  const shortStdout = stdout(shortCredential);
  const longStdout = stdout(longCredential);
  const shortStderr = stderr(shortBasic);
  const longStderr = stderr(longBasic);

  assert.ok(Buffer.byteLength(shortStderr, 'utf8') < 1_024);
  assert.ok(Buffer.byteLength(longStderr, 'utf8') > 1_024);
  assert.equal(redactProviderDiagnostic(shortStdout), redactProviderDiagnostic(longStdout));
  assert.equal(redactProviderDiagnostic(shortStderr), redactProviderDiagnostic(longStderr));

  const short = nonzeroWithDiagnostics('root-help', shortStdout, shortStderr);
  const long = nonzeroWithDiagnostics('root-help', longStdout, longStderr);

  assert.deepEqual(long.evidence.errors, short.evidence.errors);
  assert.equal(long.evidence.payload_sha256, short.evidence.payload_sha256);
  assert.equal(long.evidence.evidence_id, short.evidence.evidence_id);
  assert.deepEqual(short.evidence.redactions, ['credential']);
  for (const retainedError of [...short.evidence.errors, ...long.evidence.errors]) {
    assert.match(retainedError, /BENIGN-STDERR-PREFIX-SHOULD-SURVIVE/u);
    assert.match(retainedError, /BENIGN-STDERR-TAIL-SHOULD-SURVIVE/u);
  }
  const retained = JSON.stringify([short.evidence, long.evidence]);
  for (const rawCanary of [shortBasic, longBasic, shortCredential, longCredential])
    assert.equal(retained.includes(rawCanary), false, `retained evidence leaked ${rawCanary}`);
});

test('qualification finalization rejects skipped ids, not-evaluated rollback, wrong facets, and drift', () => {
  const finalized = nonzero('exec-help');
  for (const mutate of [
    (value: typeof finalized) => {
      value.bindings['behavioral-capability-proven'] = [];
    },
    (value: typeof finalized) => {
      delete value.passed['behavioral-capability-proven'];
    },
    (value: typeof finalized) => {
      value.bindings['behavioral-capability-proven'] = ['ev-request-facet'];
    },
    (value: typeof finalized) => {
      value.evidence.payload_sha256 = '0'.repeat(64);
    },
  ]) {
    const counterfeit = structuredClone(finalized);
    mutate(counterfeit);
    assert.throws(() => assertCodexQualificationFinalization(counterfeit));
  }
});
