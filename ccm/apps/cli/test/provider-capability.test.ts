import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assessCodexCapability,
  CODEX_READ_ONLY_ARGV_TEMPLATE,
  type CodexCapabilityInput,
} from '../src/provider-capability.js';

const REAL_VERSION = 'codex-cli 0.144.2\n';
const REAL_ROOT_HELP = `Codex CLI

Usage: codex [OPTIONS] <COMMAND> [ARGS]

Commands:
  exec            Run Codex non-interactively
  app-server      [experimental] Run the app server or related tooling

Options:
  -a, --ask-for-approval <APPROVAL_POLICY>
          Possible values:
          - untrusted
          - on-request
          - never
`;
const REAL_EXEC_HELP = `Run Codex non-interactively

Usage: codex exec [OPTIONS] [PROMPT]

Options:
  -c, --config <key=value>
          Override a configuration value
  -m, --model <MODEL>
          Model the agent should use
  -s, --sandbox <SANDBOX_MODE>
          [possible values: read-only, workspace-write, danger-full-access]
  -C, --cd <DIR>
          Tell the agent to use the specified directory as its working root
      --ephemeral
          Run without persisting session files to disk
      --output-schema <FILE>
          Path to a JSON Schema file
      --json
          Print events to stdout as JSONL
  -o, --output-last-message <FILE>
          Write the last message
`;
const REAL_APP_SERVER_HELP = `[experimental] Run the app server or related tooling

Usage: codex app-server [OPTIONS] [COMMAND]

Commands:
  generate-json-schema  Generate JSON Schema for the app server protocol

Options:
      --listen <URL>
          Supported values: stdio://, unix://, ws://IP:PORT
          [default: stdio://]
      --stdio
          Equivalent to --listen stdio://
`;

function probe(stdout: string, exitCode = 0) {
  return { exitCode, signal: null, stdout, stderr: '' };
}

function clientRequestSchema(
  methods = ['initialize', 'account/read', 'model/list', 'account/rateLimits/read'],
) {
  return JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'ClientRequest',
    oneOf: methods.map((method) => ({
      type: 'object',
      required: ['id', 'method', 'params'],
      properties: { method: { const: method } },
    })),
  });
}

function execJsonlSchema(options: { identity?: boolean; events?: string[] } = {}) {
  const identity = options.identity ?? true;
  const identityType = 'provider.metadata';
  const events = options.events ?? [
    'thread.started',
    'turn.started',
    'item.started',
    'item.updated',
    'item.completed',
    'turn.completed',
    'turn.failed',
    'error',
    ...(identity ? [identityType] : []),
  ];
  return JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'CodexExecJsonlEvent',
    'x-ccm-capability-contract': 'ccm/codex-exec-jsonl-capability/v1',
    ...(identity ? { 'x-ccm-identity-event-type': identityType } : {}),
    oneOf: events.map((type) => ({
      type: 'object',
      required: type === identityType ? ['type', 'schema', 'model', 'effort'] : ['type'],
      properties: { type: { const: type } },
    })),
  });
}

function input(schemaBundle: Record<string, string>): CodexCapabilityInput {
  return {
    version: probe(REAL_VERSION),
    rootHelp: probe(REAL_ROOT_HELP),
    execHelp: probe(REAL_EXEC_HELP),
    appServerHelp: probe(REAL_APP_SERVER_HELP),
    schemaBundle,
  };
}

test('real Codex 0.144.2 help and ClientRequest remain unsupported without exec JSONL contract', () => {
  const result = assessCodexCapability(input({ 'ClientRequest.json': clientRequestSchema() }));

  assert.equal(result.supported, false);
  assert.equal(result.reason_code, 'missing_exec_jsonl_contract');
  assert.equal(result.binary_version, '0.144.2');
  assert.deepEqual(result.app_server_methods, [
    'initialize',
    'account/read',
    'model/list',
    'account/rateLimits/read',
  ]);
  assert.deepEqual(result.invocation?.argv_template, CODEX_READ_ONLY_ARGV_TEMPLATE);
});

test('future explicit schema bundle can prove the complete capability without a version allowlist', () => {
  const candidate = input({
    'ClientRequest.json': clientRequestSchema(),
    'codex_exec_jsonl.schema.json': execJsonlSchema(),
  });
  candidate.version = probe('codex-cli 9.7.3-beta.1\n');

  const result = assessCodexCapability(candidate);

  assert.equal(result.supported, true);
  assert.equal(result.reason_code, null);
  assert.equal(result.binary_version, '9.7.3-beta.1');
  assert.equal(result.exec_jsonl_contract.contract_id, 'ccm/codex-exec-jsonl-capability/v1');
  assert.equal(result.exec_jsonl_contract.identity_event_type, 'provider.metadata');
  assert.ok(result.exec_jsonl_contract.event_types.includes('error'));
  assert.equal(result.invocation?.approval_before_exec, true);
  assert.equal(result.invocation?.prompt_last, true);
});

test('binary version is opaque provenance rather than a semantic-version eligibility gate', () => {
  const candidate = input({
    'ClientRequest.json': clientRequestSchema(),
    'codex_exec_jsonl.schema.json': execJsonlSchema(),
  });
  candidate.version = probe('codex-cli fixture-v1\n');

  const result = assessCodexCapability(candidate);

  assert.equal(result.supported, true);
  assert.equal(result.binary_version, 'fixture-v1');
});

test('nonzero version or help probes can never bind capability evidence', () => {
  const phases = {
    version: 'version_probe_failed',
    rootHelp: 'root_help_probe_failed',
    execHelp: 'exec_help_probe_failed',
    appServerHelp: 'app_server_help_probe_failed',
  } as const;
  for (const [phase, reason] of Object.entries(phases) as Array<
    [keyof typeof phases, (typeof phases)[keyof typeof phases]]
  >) {
    const candidate = input({
      'ClientRequest.json': clientRequestSchema(),
      'codex_exec_jsonl.schema.json': execJsonlSchema(),
    });
    candidate[phase] = probe(candidate[phase].stdout, 42);

    const result = assessCodexCapability(candidate);

    assert.equal(result.supported, false, phase);
    assert.equal(result.reason_code, reason, phase);
  }
});

test('approval must be proven at root scope so canonical argv places it before exec', () => {
  const candidate = input({
    'ClientRequest.json': clientRequestSchema(),
    'codex_exec_jsonl.schema.json': execJsonlSchema(),
  });
  candidate.rootHelp = probe(REAL_ROOT_HELP.replace(/\nOptions:[\s\S]*$/u, '\n'));
  candidate.execHelp = probe(
    `${REAL_EXEC_HELP}\n      --ask-for-approval <APPROVAL_POLICY> [never]\n`,
  );

  const result = assessCodexCapability(candidate);

  assert.equal(result.supported, false);
  assert.equal(result.reason_code, 'root_help_missing_approval_never');
});

test('ClientRequest must explicitly expose every selected read-only method', () => {
  const result = assessCodexCapability(
    input({
      'ClientRequest.json': clientRequestSchema(['initialize', 'account/read', 'model/list']),
      'codex_exec_jsonl.schema.json': execJsonlSchema(),
    }),
  );

  assert.equal(result.supported, false);
  assert.equal(result.reason_code, 'client_request_method_missing');
  assert.equal(result.detail, 'account/rateLimits/read');
});

test('schema inputs are byte bounded before JSON parsing', () => {
  const result = assessCodexCapability(
    input({
      'ClientRequest.json': ' '.repeat(2 * 1024 * 1024 + 1),
      'codex_exec_jsonl.schema.json': execJsonlSchema(),
    }),
  );

  assert.equal(result.supported, false);
  assert.equal(result.reason_code, 'client_request_schema_too_large');
});

test('identity marker must resolve to an event requiring model and effort', () => {
  const result = assessCodexCapability(
    input({
      'ClientRequest.json': clientRequestSchema(),
      'codex_exec_jsonl.schema.json': execJsonlSchema({ identity: false }),
    }),
  );

  assert.equal(result.supported, false);
  assert.equal(result.reason_code, 'exec_jsonl_identity_event_missing');
});
