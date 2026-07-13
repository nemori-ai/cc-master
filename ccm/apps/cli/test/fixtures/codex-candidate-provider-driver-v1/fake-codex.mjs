#!/usr/bin/env node

// Controlled Codex fixture transport. The test runner replaces the one placeholder below with a
// per-run, in-memory-generated control payload before writing this file as the `codex` executable.
// No fixture catalog path, scenario id, expected result, or trace path is exposed to the CLI
// handler. Provider replies and execution output are therefore the handler's only proof channel.

import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync, writeSync } from 'node:fs';

const control = JSON.parse(
  Buffer.from('__CCM_CODEX_CONTRACT_CONTROL_BASE64__', 'base64').toString('utf8'),
);
const { fixture, proof_nonce: proofNonce, run_token: runToken, trace_path: tracePath } = control;
const argv = process.argv.slice(2);
const qualificationControl = fixture.probe.binary.qualification_control ?? {};

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}

function digest(value) {
  const bytes = typeof value === 'string' ? value : JSON.stringify(canonical(value));
  return createHash('sha256').update(bytes).digest('hex');
}

function record(kind, detail = {}) {
  appendFileSync(
    tracePath,
    `${JSON.stringify({
      schema: 'ccm/codex-fixture-trace/v2',
      run_token: runToken,
      kind,
      argv,
      env_keys: Object.keys(process.env).sort(),
      ...detail,
    })}\n`,
    'utf8',
  );
}

function valueAfter(flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function beforeQualificationProbe(phase) {
  const delay = Number(qualificationControl.delay_ms_by_phase?.[phase] ?? 0);
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  if (qualificationControl.hang_phase !== phase) return;
  process.on('SIGTERM', () => {
    record('signal', { signal: 'SIGTERM', phase });
    if (!qualificationControl.ignore_sigterm) process.exit(143);
  });
  await new Promise(() => setInterval(() => {}, 1000));
}

function finishQualificationProbe(phase) {
  if (qualificationControl.exit_phase === phase) {
    process.exit(Number(qualificationControl.exit_code ?? 42));
  }
}

function hasCompleteBehavioralContract() {
  const required = [
    'exec',
    'exec-jsonl',
    'output-schema',
    'output-last-message',
    'explicit-model',
    'explicit-effort',
    'sandbox-read-only',
    'approval-never',
    'ephemeral',
    'explicit-cwd',
    'app-server-account-read',
    'app-server-model-list',
    'app-server-rate-limits-read',
  ];
  return required.every((capability) =>
    fixture.probe.binary.behavioral_capabilities.includes(capability),
  );
}

function writeGeneratedSchemas(outDir) {
  mkdirSync(outDir, { recursive: true });
  const methods = hasCompleteBehavioralContract()
    ? ['initialize', 'account/read', 'model/list', 'account/rateLimits/read']
    : ['initialize'];
  const clientRequest = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'ClientRequest',
    oneOf: methods.map((method) => ({
      type: 'object',
      required: ['id', 'method', 'params'],
      properties: { method: { const: method } },
    })),
  };
  writeFileSync(`${outDir}/ClientRequest.json`, `${JSON.stringify(clientRequest)}\n`, 'utf8');
  if (hasCompleteBehavioralContract()) {
    const execJsonl = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'CodexExecJsonlEvent',
      'x-ccm-capability-contract': 'ccm/codex-exec-jsonl-capability/v1',
      'x-ccm-identity-event-type': 'ccm.fixture.provider_metadata',
      oneOf: [
        'thread.started',
        'turn.started',
        'item.started',
        'item.updated',
        'item.completed',
        'turn.completed',
        'turn.failed',
        'error',
        'ccm.fixture.provider_metadata',
      ].map((type) => ({
        type: 'object',
        required:
          type === 'ccm.fixture.provider_metadata'
            ? ['type', 'schema', 'model', 'effort']
            : ['type'],
        properties: { type: { const: type } },
      })),
    };
    writeFileSync(
      `${outDir}/codex_exec_jsonl.schema.json`,
      `${JSON.stringify(execJsonl)}\n`,
      'utf8',
    );
  }
  return { methods, complete: hasCompleteBehavioralContract() };
}

function sendResponse(request, result) {
  const response = { id: request.id, result };
  record('app-server-response', {
    method: request.method,
    correlation_id: String(request.id),
    payload_sha256: digest(result),
    proof_nonce: result?.fixtureProof ?? null,
  });
  writeSync(1, `${JSON.stringify(response)}\n`);
}

function sendError(request, code, message) {
  const error = { code, message };
  record('app-server-response', {
    method: request?.method ?? null,
    correlation_id: request?.id === undefined ? null : String(request.id),
    payload_sha256: digest(error),
    proof_nonce: null,
    error: true,
  });
  writeSync(1, `${JSON.stringify({ id: request?.id ?? null, error })}\n`);
}

const childEnvAllowlist = ['CODEX_HOME', 'HOME', 'NO_COLOR', 'PATH', 'TMPDIR'];
const actualEnvKeys = Object.keys(process.env).sort();
const unexpectedEnv = actualEnvKeys.filter((key) => !childEnvAllowlist.includes(key));
const missingEnv = childEnvAllowlist.filter((key) => !actualEnvKeys.includes(key));
if (unexpectedEnv.length > 0 || missingEnv.length > 0) {
  record('forbidden-env', { unexpected: unexpectedEnv, missing: missingEnv });
  writeSync(
    2,
    `fake-codex: child env must equal allowlist; unexpected=${unexpectedEnv.join(',')} missing=${missingEnv.join(',')}\n`,
  );
  process.exit(92);
}

if (argv.some((token) => ['login', 'logout', 'switch'].includes(token))) {
  record('account-mutation', { forbidden: true });
  writeSync(2, 'fake-codex: account mutation command forbidden by fixture contract\n');
  process.exit(91);
}

if (argv.includes('--version') || argv.includes('-V')) {
  record('version', { proof_nonce: proofNonce, version: fixture.probe.binary.version });
  await beforeQualificationProbe('version');
  if (!fixture.probe.binary.available) process.exit(127);
  writeSync(1, `${fixture.probe.binary.version}\n`);
  finishQualificationProbe('version');
  process.exit(0);
}

if (argv.length === 1 && argv[0] === '--help') {
  record('root-help', { proof_nonce: proofNonce });
  await beforeQualificationProbe('root-help');
  writeSync(
    1,
    'Codex CLI\nCommands:\n  exec\n  app-server\nOptions:\n  -s, --sandbox <SANDBOX_MODE>\n  -C, --cd <DIR>\n  -a, --ask-for-approval <APPROVAL_POLICY>\n          Possible values: untrusted, on-request, never\n',
  );
  finishQualificationProbe('root-help');
  process.exit(0);
}

const execIndex = argv.indexOf('exec');
if (execIndex >= 0 && argv.includes('--help')) {
  const parseProbe = argv.includes('--output-schema') && argv.includes('--output-last-message');
  const phase = parseProbe ? 'exec-parse-only' : 'exec-help';
  record(parseProbe ? 'exec-parse-probe' : 'exec-help', { proof_nonce: proofNonce });
  await beforeQualificationProbe(phase);
  writeSync(
    1,
    'Run Codex non-interactively\nUsage: codex exec [OPTIONS] [PROMPT]\nOptions:\n  --json\n  --output-schema <FILE>\n  --output-last-message <FILE>\n  --model <MODEL>\n  -c, --config <key=value>\n  --sandbox <SANDBOX_MODE> [read-only]\n  --ephemeral\n  -C, --cd <DIR>\n',
  );
  finishQualificationProbe(phase);
  process.exit(0);
}

if (argv[0] === 'app-server' && argv[1] === '--help') {
  record('app-server-help', { proof_nonce: proofNonce });
  await beforeQualificationProbe('app-server-help');
  writeSync(
    1,
    'Run the app server or related tooling\nUsage: codex app-server [OPTIONS] [COMMAND]\nCommands:\n  generate-json-schema\nOptions:\n  --listen <URL> [default: stdio://]\n  --stdio\n',
  );
  finishQualificationProbe('app-server-help');
  process.exit(0);
}

if (argv[0] === 'app-server' && argv[1] === 'generate-json-schema') {
  record('app-server-schema', { proof_nonce: proofNonce, probe_started: true });
  await beforeQualificationProbe('app-server-schema');
  const outDir = valueAfter('--out');
  if (!outDir) process.exit(64);
  const generated = writeGeneratedSchemas(outDir);
  record('app-server-schema', {
    proof_nonce: proofNonce,
    methods_sha256: digest(generated.methods),
    exec_jsonl_contract: generated.complete,
  });
  finishQualificationProbe('app-server-schema');
  process.exit(0);
}

if (argv[0] === 'app-server') {
  record('app-server-spawn');
  let pending = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    pending += chunk;
    while (pending.includes('\n')) {
      const newline = pending.indexOf('\n');
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (!line) continue;
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        sendError(null, -32700, 'fixture parse error');
        continue;
      }
      record('app-server-request', {
        method: request.method,
        correlation_id: request.id === undefined ? null : String(request.id),
        request_sha256: digest(request),
      });
      if (request.method === 'initialized') continue;
      if (request.method === 'initialize') {
        sendResponse(request, {
          codexHome: process.env.CODEX_HOME,
          platformFamily: 'unix',
          platformOs: 'linux',
          userAgent: 'ccm-codex-contract-fixture/v1',
          fixtureProof: proofNonce,
        });
      } else if (request.method === 'account/read') {
        const auth = fixture.probe.auth;
        sendResponse(request, {
          account:
            auth.state === 'authenticated'
              ? {
                  type: 'chatgpt',
                  accountId: auth.account_id,
                  planType: auth.plan_type,
                }
              : null,
          authState: auth.state,
          requiresOpenaiAuth: true,
          observedAt: auth.observed_at,
          expiresAt: auth.valid_until,
          fixtureProof: proofNonce,
        });
      } else if (request.method === 'model/list') {
        const entitlement = fixture.probe.entitlement;
        sendResponse(request, {
          data: entitlement.models,
          nextCursor: null,
          observedAt: entitlement.observed_at,
          expiresAt: entitlement.valid_until,
          fixtureProof: proofNonce,
        });
      } else if (request.method === 'account/rateLimits/read') {
        const quota = fixture.probe.quota;
        sendResponse(request, {
          ...quota.payload,
          observedAt: quota.observed_at,
          expiresAt: quota.valid_until,
          sevenDayHistory: quota.seven_day_history,
          fixtureProof: proofNonce,
        });
      } else {
        sendError(request, -32601, `fixture method not found: ${request.method}`);
      }
    }
  });
  process.stdin.on('end', () => process.exit(0));
  process.on('SIGTERM', () => {
    record('signal', { signal: 'SIGTERM', phase: 'app-server' });
    process.exit(143);
  });
  process.on('SIGINT', () => {
    record('signal', { signal: 'SIGINT', phase: 'app-server' });
    process.exit(130);
  });
} else if (execIndex >= 0) {
  record('exec-spawn', {
    cwd: process.cwd(),
    permission: {
      sandbox: valueAfter('--sandbox'),
      approval: valueAfter('--ask-for-approval'),
    },
    model: valueAfter('--model'),
    effort: argv.find((token) => token.startsWith('model_reasoning_effort=')) ?? null,
  });

  const writeEvent = (event) => {
    if (event && typeof event === 'object' && typeof event.fixture_raw_hex === 'string') {
      const bytes = Buffer.from(event.fixture_raw_hex, 'hex');
      record('exec-jsonl', {
        event_type: 'fixture.raw-bytes',
        payload_sha256: digest(bytes.toString('hex')),
        proof_nonce: null,
      });
      writeSync(1, bytes);
      writeSync(1, '\n');
      return;
    }
    const line = typeof event === 'string' ? event : JSON.stringify(event);
    record('exec-jsonl', {
      event_type: typeof event === 'string' ? null : event.type,
      payload_sha256: digest(event),
      proof_nonce: typeof event === 'object' ? (event.proof_nonce ?? null) : null,
    });
    writeSync(1, `${line}\n`);
  };
  const preludeCount = Number(fixture.execution.prelude_event_count ?? 0);
  for (const event of fixture.execution.jsonl.slice(0, preludeCount)) writeEvent(event);

  const finish = () => {
    if (fixture.execution.stderr) {
      const prefix = String(fixture.execution.stderr.prefix ?? '');
      const bytes = Number(fixture.execution.stderr.bytes ?? Buffer.byteLength(prefix, 'utf8'));
      const padding = Math.max(0, bytes - Buffer.byteLength(prefix, 'utf8'));
      writeSync(2, `${prefix}${'x'.repeat(padding)}`);
    }
    for (const event of fixture.execution.jsonl.slice(preludeCount)) writeEvent(event);
    if (fixture.execution.stdout_padding_bytes > 0) {
      writeSync(1, 'x'.repeat(fixture.execution.stdout_padding_bytes));
    }
    const outputPath = valueAfter('--output-last-message') || valueAfter('-o');
    if (outputPath) {
      const output = fixture.execution.structured_output;
      const bytes = typeof output === 'string' ? output : `${JSON.stringify(output)}\n`;
      writeFileSync(outputPath, bytes, 'utf8');
      record('exec-result', {
        payload_sha256: digest(output),
        proof_nonce:
          output !== null && typeof output === 'object' ? (output.provider_proof ?? null) : null,
      });
    }
    process.exit(fixture.execution.exit_code ?? 0);
  };

  process.on('SIGTERM', () => {
    record('signal', { signal: 'SIGTERM', phase: 'exec' });
    if (!fixture.execution.ignore_sigterm) process.exit(143);
  });
  process.on('SIGINT', () => {
    record('signal', { signal: 'SIGINT', phase: 'exec' });
    process.exit(130);
  });

  if (fixture.execution.hang_ms > 0) setTimeout(finish, fixture.execution.hang_ms);
  else finish();
} else {
  record('unknown');
  writeSync(2, `fake-codex: unsupported argv ${JSON.stringify(argv)}\n`);
  process.exit(64);
}
