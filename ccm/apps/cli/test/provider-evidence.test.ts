import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  type CompiledInvocationAuditInput,
  canonicalJson,
  compileCodexChildEnvironment,
  createCompiledInvocationAudit,
  createProviderEvidence,
  type ProviderEvidenceInput,
  redactProviderDiagnostic,
} from '../src/provider-evidence.js';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function evidenceInput(overrides: Partial<ProviderEvidenceInput> = {}): ProviderEvidenceInput {
  return {
    kind: 'auth',
    surface: 'app-server',
    method: 'account/read',
    revision: 'sha256:protocol-revision',
    schemaVersion: 'codex-app-server-generated-schema/v2',
    payload: { account: { type: 'chatgpt' } },
    observedAt: '2026-07-13T08:01:00Z',
    validUntil: '2026-07-13T08:02:00Z',
    freshness: 'fresh',
    completeness: 'complete',
    errors: [],
    ...overrides,
  };
}

function invocationInput(
  overrides: Partial<CompiledInvocationAuditInput> = {},
): CompiledInvocationAuditInput {
  return {
    executable: '/opt/codex',
    argv: [
      '--ask-for-approval',
      'never',
      'exec',
      '--json',
      '--output-schema',
      '/tmp/schema.json',
      '--output-last-message',
      '/tmp/result.json',
      '--model',
      'gpt-explicit',
      '-c',
      'model_reasoning_effort=high',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '-C',
      '/workspace',
      '-',
    ],
    env: {
      CODEX_HOME: '/home/test/.codex',
      HOME: '/home/test',
      NO_COLOR: '1',
      PATH: '/bin',
      TMPDIR: '/tmp',
    },
    stdin: 'inspect\n',
    cwd: '/workspace',
    permission: {
      sandbox: 'read-only',
      approval: 'never',
      network: 'provider-only',
      account_mutation: 'forbidden',
      credential_write: 'forbidden',
    },
    requested: { model: 'gpt-explicit', effort: 'high', evidence_id: 'ev-request' },
    resolved: { model: 'gpt-explicit', effort: 'high', evidence_id: 'ev-resolution' },
    ...overrides,
  };
}

test('canonical JSON rejects non-JSON values instead of producing provenance collisions', () => {
  class CustomValue {
    value = 1;
  }
  const customPrototype = Object.assign(Object.create({ inherited: true }), { value: 1 });
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const invalid: Array<{ label: string; value: unknown }> = [
    { label: 'undefined', value: undefined },
    { label: 'undefined object member', value: { value: undefined } },
    { label: 'undefined array member', value: [undefined] },
    { label: 'NaN', value: Number.NaN },
    { label: 'positive infinity', value: Number.POSITIVE_INFINITY },
    { label: 'negative infinity', value: Number.NEGATIVE_INFINITY },
    { label: 'bigint', value: 1n },
    { label: 'symbol', value: Symbol('secret') },
    { label: 'function', value: () => 1 },
    { label: 'date', value: new Date('2026-07-13T08:01:00Z') },
    { label: 'class instance', value: new CustomValue() },
    { label: 'custom prototype', value: customPrototype },
    { label: 'cycle', value: cycle },
  ];

  for (const mutation of invalid)
    assert.throws(
      () => canonicalJson(mutation.value),
      /strict JSON|cyclic|cannot encode/u,
      `${mutation.label} must fail closed`,
    );

  assert.equal(canonicalJson({ collision: null }), '{"collision":null}');
  assert.throws(() => canonicalJson({ collision: Number.NaN }), /strict JSON/u);
  assert.equal(canonicalJson({}), '{}');
  assert.throws(() => canonicalJson({ omitted: undefined }), /strict JSON/u);

  const nullPrototype = Object.assign(Object.create(null), { z: 2, a: 1 });
  assert.equal(canonicalJson(nullPrototype), '{"a":1,"z":2}');
});

test('provider evidence emits the frozen full envelope and hashes redacted canonical JSON', () => {
  const payload = {
    z: 1,
    account: { email: 'person@example.com', type: 'chatgpt' },
    accessToken: 'must-not-survive',
    a: ['source-order', { password: 'must-not-survive-either' }],
  };
  const redacted = {
    a: ['source-order', { password: '[REDACTED]' }],
    accessToken: '[REDACTED]',
    account: { email: '[REDACTED_EMAIL]', type: 'chatgpt' },
    z: 1,
  };
  const evidence = createProviderEvidence(
    {
      binaryRealpath: '/opt/codex',
      binaryVersion: 'codex-cli 0.144.2',
    },
    {
      kind: 'auth',
      surface: 'app-server',
      method: 'account/read',
      revision: 'sha256:protocol-revision',
      schemaVersion: 'codex-app-server-generated-schema/v2',
      payload,
      observedAt: '2026-07-13T08:01:00Z',
      validUntil: '2026-07-13T08:02:00Z',
      freshness: 'fresh',
      completeness: 'complete',
      errors: [],
    },
  );

  assert.deepEqual(Object.keys(evidence).sort(), [
    'completeness',
    'errors',
    'evidence_id',
    'freshness',
    'kind',
    'observed_at',
    'payload_sha256',
    'redactions',
    'source',
    'valid_until',
  ]);
  assert.deepEqual(evidence.source, {
    provider: 'codex',
    surface: 'app-server',
    method: 'account/read',
    revision: 'sha256:protocol-revision',
    binary_realpath: '/opt/codex',
    binary_version: 'codex-cli 0.144.2',
    schema_version: 'codex-app-server-generated-schema/v2',
  });
  assert.deepEqual(evidence.redactions, ['credential', 'email', 'token']);
  assert.deepEqual(evidence.errors, []);
  assert.equal(evidence.payload_sha256, sha256(canonicalJson(redacted)));
  assert.equal(JSON.stringify(evidence).includes('must-not-survive'), false);

  const expectedReference = {
    schema: 'ccm/provider-evidence-reference/v1',
    source_method: 'account/read',
    source_revision: 'sha256:protocol-revision',
    payload_sha256: evidence.payload_sha256,
  };
  assert.equal(evidence.evidence_id, `ev-${sha256(canonicalJson(expectedReference))}`);
});

test('provider evidence redacts sensitive string contents and bounded errors with one category set', () => {
  const rawMessage =
    'Bearer raw-bearer Authorization: Basic raw-basic token=raw-token api_key=raw-key person@example.com';
  const redactedMessage =
    'Bearer [REDACTED] Authorization: Basic [REDACTED] token=[REDACTED] api_key=[REDACTED] [REDACTED_EMAIL]';
  const rawError =
    'password="raw password" secret=raw-secret cookie=session=raw-cookie credential=raw-credential';
  const redactedError =
    'password=[REDACTED] secret=[REDACTED] cookie=[REDACTED] credential=[REDACTED]';
  const binary = { binaryRealpath: '/opt/codex', binaryVersion: 'codex-cli 0.144.2' };

  const evidence = createProviderEvidence(
    binary,
    evidenceInput({ payload: { message: rawMessage }, errors: [rawError], freshness: 'unknown' }),
  );
  const expected = createProviderEvidence(
    binary,
    evidenceInput({
      payload: { message: redactedMessage },
      errors: [redactedError],
      freshness: 'unknown',
    }),
  );

  assert.equal(evidence.payload_sha256, expected.payload_sha256);
  assert.deepEqual(evidence.errors, [redactedError]);
  assert.deepEqual(evidence.redactions, ['credential', 'email', 'token']);
  const serialized = JSON.stringify(evidence);
  for (const secret of [
    'raw-bearer',
    'raw-basic',
    'raw-token',
    'raw-key',
    'person@example.com',
    'raw password',
    'raw-secret',
    'raw-cookie',
    'raw-credential',
  ])
    assert.equal(serialized.includes(secret), false, `serialized evidence leaked ${secret}`);

  const longError = `${'界'.repeat(400)} token=must-not-survive`;
  const bounded = createProviderEvidence(
    binary,
    evidenceInput({ errors: [longError], freshness: 'unknown' }),
  ).errors[0];
  assert.ok(bounded);
  assert.ok(Buffer.byteLength(bounded, 'utf8') <= 1_024);
  assert.equal(bounded.includes('\uFFFD'), false);
  assert.equal(bounded.includes('must-not-survive'), false);
});

test('shared provider diagnostics redact header families before evidence hashing without erasing context', () => {
  const raw = [
    'benign diagnostic context remains',
    '  AuThOrIzAtIoN \t:\t bAsIc BASIC-PIPELINE-CANARY',
    'cOoKiE \t: session=COOKIE-PIPELINE-CANARY; secondary=COOKIE-TAIL-CANARY',
    'sEt-CoOkIe:\tsession=SET-COOKIE-PIPELINE-CANARY; secondary=SET-COOKIE-TAIL-PIPELINE-CANARY',
    'benign diagnostic tail remains',
  ].join('\n');
  const redacted = [
    'benign diagnostic context remains',
    '  AuThOrIzAtIoN \t:\t bAsIc [REDACTED]',
    'cOoKiE \t: [REDACTED]',
    'sEt-CoOkIe:\t[REDACTED]',
    'benign diagnostic tail remains',
  ].join('\n');
  const canaries = [
    'BASIC-PIPELINE-CANARY',
    'COOKIE-PIPELINE-CANARY',
    'COOKIE-TAIL-CANARY',
    'SET-COOKIE-PIPELINE-CANARY',
    'SET-COOKIE-TAIL-PIPELINE-CANARY',
  ];

  assert.equal(redactProviderDiagnostic(raw), redacted);

  const binary = { binaryRealpath: '/opt/codex', binaryVersion: 'codex-cli 0.144.2' };
  const evidence = createProviderEvidence(
    binary,
    evidenceInput({ payload: { diagnostic: raw }, errors: [raw], freshness: 'unknown' }),
  );
  assert.equal(evidence.payload_sha256, sha256(canonicalJson({ diagnostic: redacted })));
  assert.notEqual(evidence.payload_sha256, sha256(canonicalJson({ diagnostic: raw })));
  assert.deepEqual(evidence.errors, [redacted]);
  assert.deepEqual(evidence.redactions, ['credential', 'token']);
  assert.match(evidence.errors[0] as string, /benign diagnostic context remains/u);
  assert.match(evidence.errors[0] as string, /benign diagnostic tail remains/u);
  for (const canary of canaries)
    assert.equal(JSON.stringify(evidence).includes(canary), false, `evidence leaked ${canary}`);
});

test('Codex child environment uses exact compiler-selected values and never inherits NO_COLOR', () => {
  const parent = {
    CODEX_HOME: '/controlled/codex-home',
    HOME: '/controlled/home',
    NO_COLOR: 'ALLOWED-KEY-SECRET-CANARY',
    PATH: '/controlled/bin:/usr/bin',
    TMPDIR: '/controlled/tmp',
  };
  const compiled = compileCodexChildEnvironment(parent);
  assert.deepEqual(compiled, {
    CODEX_HOME: '/controlled/codex-home',
    HOME: '/controlled/home',
    NO_COLOR: '1',
    PATH: '/controlled/bin:/usr/bin',
    TMPDIR: '/controlled/tmp',
  });
  assert.equal(JSON.stringify(compiled).includes(parent.NO_COLOR), false);

  assert.throws(
    () =>
      createCompiledInvocationAudit(
        invocationInput({ env: { ...compiled, NO_COLOR: parent.NO_COLOR } }),
      ),
    /NO_COLOR.*compiler-selected/u,
  );
});

test('provider evidence rejects synthetic load-bearing identity and incoherent freshness', () => {
  const binary = { binaryRealpath: '/opt/codex', binaryVersion: 'codex-cli 0.144.2' };
  const create = (
    binaryOverride: Parameters<typeof createProviderEvidence>[0],
    overrides: Partial<ProviderEvidenceInput> = {},
  ) => createProviderEvidence(binaryOverride, evidenceInput(overrides));

  assert.throws(
    () => create({ binaryRealpath: null, binaryVersion: null }),
    /absolute binary realpath/u,
  );
  assert.throws(
    () => create({ binaryRealpath: 'codex', binaryVersion: 'codex-cli 0.144.2' }),
    /absolute binary realpath/u,
  );
  assert.throws(
    () => create({ binaryRealpath: '/opt/codex', binaryVersion: '  ' }),
    /binary version/u,
  );
  assert.throws(() => create(binary, { method: '  ' }), /method and revision/u);
  assert.throws(() => create(binary, { revision: '  ' }), /method and revision/u);
  assert.throws(() => create(binary, { observedAt: '2026-07-13' }), /RFC3339/u);
  assert.throws(() => create(binary, { validUntil: 'not-a-time' }), /RFC3339/u);
  assert.throws(() => create(binary, { validUntil: '2026-07-13T08:00:59Z' }), /before observed/u);
  assert.throws(
    () => create(binary, { freshness: 'fresh', completeness: 'partial' }),
    /fresh evidence must be complete/u,
  );
  assert.throws(
    () => create(binary, { freshness: 'fresh', errors: ['probe failed'] }),
    /fresh evidence cannot contain errors/u,
  );

  const request = createProviderEvidence(
    { binaryRealpath: null, binaryVersion: null },
    evidenceInput({
      kind: 'execution',
      surface: 'cli-headless',
      method: 'ccm-provider-inspect/request',
      revision: 'ccm/codex-provider-inspect-request/v1',
      validUntil: null,
      payload: { request_id: 'opaque' },
    }),
  );
  assert.equal(request.source.binary_realpath, null);
  assert.equal(request.source.binary_version, null);
  assert.throws(
    () =>
      createProviderEvidence(
        { binaryRealpath: null, binaryVersion: 'codex-cli 0.144.2' },
        evidenceInput({ method: 'ccm-provider-inspect/request' }),
      ),
    /both be null/u,
  );

  const unresolved = createProviderEvidence(
    { binaryRealpath: null, binaryVersion: null },
    evidenceInput({
      kind: 'binary-capability',
      surface: 'cli-headless',
      method: 'ccm-provider-runtime/resolveExecutable',
      revision: 'ccm/provider-runtime-capabilities/v1',
      schemaVersion: null,
      payload: { resolved: null },
      validUntil: null,
      freshness: 'unknown',
      completeness: 'complete',
      errors: [],
    }),
  );
  assert.equal(unresolved.source.binary_realpath, null);
  for (const mutation of [
    { payload: { resolved: '/tmp/codex' } },
    { payload: { resolved: null, synthetic: true } },
    { kind: 'auth' as const },
    { surface: 'app-server' as const },
    { schemaVersion: 'synthetic/v1' },
    { freshness: 'fresh' as const },
    { completeness: 'partial' as const },
    { errors: ['binary_unavailable'] },
  ])
    assert.throws(
      () =>
        createProviderEvidence(
          { binaryRealpath: null, binaryVersion: null },
          evidenceInput({
            kind: 'binary-capability',
            surface: 'cli-headless',
            method: 'ccm-provider-runtime/resolveExecutable',
            revision: 'ccm/provider-runtime-capabilities/v1',
            schemaVersion: null,
            payload: { resolved: null },
            validUntil: null,
            freshness: 'unknown',
            completeness: 'complete',
            errors: [],
            ...mutation,
          }),
        ),
      /absolute binary realpath|fresh evidence must be complete/u,
    );
});

test('compiled invocation audit preserves replayable argv ordering without environment values', () => {
  const input = invocationInput();
  const audit = createCompiledInvocationAudit(input);

  assert.deepEqual(audit.argv, input.argv);
  assert.deepEqual(audit.env_keys, ['CODEX_HOME', 'HOME', 'NO_COLOR', 'PATH', 'TMPDIR']);
  assert.equal(JSON.stringify(audit).includes('/home/test/.codex'), false);
  assert.equal(audit.stdin_sha256, sha256('inspect\n'));
  const { invocation_sha256: actualDigest, ...body } = audit;
  assert.equal(actualDigest, sha256(canonicalJson(body)));
});

test('compiled invocation audit rejects non-replayable argv, unsafe env, and unbound identities', () => {
  const valid = invocationInput();
  const mutateArgv = (mutation: (argv: string[]) => void) => {
    const argv = [...valid.argv];
    mutation(argv);
    return invocationInput({ argv });
  };

  assert.throws(
    () => createCompiledInvocationAudit(invocationInput({ executable: 'codex' })),
    /absolute executable/u,
  );
  assert.throws(
    () => createCompiledInvocationAudit(invocationInput({ cwd: 'workspace' })),
    /absolute cwd/u,
  );
  assert.throws(
    () =>
      createCompiledInvocationAudit(
        mutateArgv((argv) => {
          argv.splice(0, 3, 'exec', '--ask-for-approval', 'never');
        }),
      ),
    /approval.*before exec/u,
  );
  assert.throws(
    () => createCompiledInvocationAudit(mutateArgv((argv) => argv.pop())),
    /prompt.*last/u,
  );
  assert.throws(
    () =>
      createCompiledInvocationAudit(
        mutateArgv((argv) => {
          argv[argv.indexOf('gpt-explicit')] = '<resolved-model>';
        }),
      ),
    /placeholder/u,
  );
  assert.throws(
    () =>
      createCompiledInvocationAudit(
        mutateArgv((argv) => {
          argv.splice(-1, 0, '--dangerously-bypass-approvals-and-sandbox');
        }),
      ),
    /forbidden invocation argument/u,
  );
  assert.throws(
    () =>
      createCompiledInvocationAudit(
        mutateArgv((argv) => {
          argv[argv.indexOf('read-only')] = 'workspace-write';
        }),
      ),
    /read-only sandbox/u,
  );
  assert.throws(
    () =>
      createCompiledInvocationAudit(
        invocationInput({
          env: { CODEX_HOME: '/home/test/.codex', HOME: '/home/test', PATH: '/bin' },
        }),
      ),
    /exact environment keys/u,
  );
  assert.throws(
    () =>
      createCompiledInvocationAudit(
        invocationInput({ env: { ...valid.env, RANDOM_CANARY: 'must-not-survive' } }),
      ),
    /exact environment keys/u,
  );
  assert.throws(
    () =>
      createCompiledInvocationAudit(
        invocationInput({
          requested: { model: 'gpt-explicit', effort: 'high', evidence_id: '' },
        }),
      ),
    /requested.*evidence_id/u,
  );
  assert.throws(
    () =>
      createCompiledInvocationAudit(
        invocationInput({
          resolved: { model: 'gpt-explicit', effort: 'high', evidence_id: 'ev-request' },
        }),
      ),
    /distinct evidence ids/u,
  );
});
