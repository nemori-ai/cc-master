import assert from 'node:assert/strict';
import { type ChildProcess, fork } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  authorityEnvironmentV2,
  bytesBase64,
  createAuthorityEnvelopeV2,
  createCcmjFrame,
  identityFromStatV2,
  operationDigestV2,
  QUALIFIED_PLATFORMS_V2,
  sha256V2,
  validateCapabilityV2,
  validateExecutionV2,
  validateOperationV2,
  validateTraceV2,
} from './fixtures/run-store-capability-v2-contract.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const childFixture = join(here, 'fixtures', 'run-store-capability-v2-child.mjs');
const require = createRequire(import.meta.url);
const childTsxImport = pathToFileURL(require.resolve('tsx')).href;
const runProductionRed = process.env.CCM_RUN_STORE_CAPABILITY_V2_RED === '1';
const posix = process.platform === 'linux' || process.platform === 'darwin';

type Phase = 'claim-transaction' | 'supervisor-runtime' | 'manager-control' | 'inventory-audit';
type ScenarioMode =
  | 'known-good'
  | 'production'
  | 'forged-result'
  | 'forged-before-revision'
  | 'forged-append-receipt'
  | 'no-write-synced-receipt'
  | 'wrong-target-sync'
  | 'pre-sync-final-unsynced-write'
  | 'post-publication-failure'
  | 'partial-append'
  | 'wrong-append-prefix'
  | 'missing-durability'
  | 'unsafe-durability'
  | 'adapter-bypass';
type ScenarioOutcome = {
  mode: ScenarioMode;
  message: Record<string, unknown>;
  childExitCode: number | null;
  authority: Record<string, unknown>;
  operations: Array<Record<string, unknown>>;
  pinnedStore: string;
  decoyStore: string;
  cleanup(): void;
};

function waitForMessage(
  child: ChildProcess,
  predicate: (message: unknown) => boolean,
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for child IPC after ${timeoutMs}ms`));
    }, timeoutMs);
    const onMessage = (message: unknown) => {
      if (!predicate(message)) return;
      cleanup();
      resolve(message as Record<string, unknown>);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`child exited before expected IPC (code=${code}, signal=${signal})`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
    };
    child.on('message', onMessage);
    child.on('exit', onExit);
  });
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => child.once('exit', () => resolve()));
}

function supervisorGrant() {
  return {
    phase: 'supervisor-runtime' as const,
    run_id: 'run-a',
    attempt_id: 'attempt-a',
    supervisor_instance_id: 'supervisor-a',
  };
}

function baseOperation(
  operationId: string,
  kind: string,
  segments: string[],
  phase: Phase = 'supervisor-runtime',
) {
  return {
    schema: 'ccm/run-store-operation/v2',
    operation_id: operationId,
    phase,
    kind,
    segments,
  };
}

function readOperation(operationId: string, segments: string[]) {
  return { ...baseOperation(operationId, 'read-file', segments), max_bytes: 65_536 };
}

function listOperation(operationId: string, segments: string[]) {
  return {
    ...baseOperation(operationId, 'list-directory', segments),
    max_entries: 32,
    max_name_bytes: 128,
  };
}

function createOperation(operationId: string, segments: string[], bytes: Buffer) {
  return {
    ...baseOperation(operationId, 'create-file-no-replace', segments),
    bytes_base64: bytesBase64(bytes),
    directory_mode: '0700',
    file_mode: '0600',
    durability: 'file-and-directory-synced-v1',
  };
}

function replaceOperation(
  operationId: string,
  segments: string[],
  expectedRevision: string,
  bytes: Buffer,
) {
  return {
    ...baseOperation(operationId, 'replace-file-cas', segments),
    expected_revision: expectedRevision,
    bytes_base64: bytesBase64(bytes),
    directory_mode: '0700',
    file_mode: '0600',
    durability: 'file-and-directory-synced-v1',
  };
}

function appendOperation(operationId: string, frame: Buffer) {
  return {
    ...baseOperation(operationId, 'append-ccmj-frame-cas', ['by-run', 'run-a', 'journal.ccmj']),
    expected_revision: 'absent',
    expected_byte_length: 0,
    frame_base64: bytesBase64(frame),
    max_file_bytes: 67_108_864,
    directory_mode: '0700',
    file_mode: '0600',
    durability: 'file-and-directory-synced-v1',
  };
}

async function runScenario(
  mode: ScenarioMode,
  operations: Array<Record<string, unknown>>,
  prepare?: (store: string, outside: string) => void,
): Promise<ScenarioOutcome> {
  const root = mkdtempSync(join(tmpdir(), `ccm-run-store-v2-${mode}-`));
  const storageLocator = join(root, 'store');
  const pinnedStore = join(root, 'store.pinned');
  const decoyStore = join(root, 'store');
  const outside = join(root, 'outside');
  const lexicalHome = join(root, 'public-home');
  let child: ChildProcess | undefined;

  mkdirSync(storageLocator, { mode: 0o700 });
  mkdirSync(outside, { mode: 0o700 });
  prepare?.(storageLocator, outside);
  const authority = createAuthorityEnvelopeV2({
    lexicalHome,
    storageLocator,
    identity: identityFromStatV2(statSync(storageLocator)),
    grant: supervisorGrant(),
  });

  try {
    child = fork(childFixture, [], {
      cwd: storageLocator,
      detached: true,
      env: {
        ...process.env,
        ...authorityEnvironmentV2(authority),
        CCM_RUN_STORE_V2_CONSUMER_MODE: mode,
      },
      execArgv: ['--import', childTsxImport],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    await waitForMessage(
      child,
      (message) => (message as { type?: string })?.type === 'run-store-v2-ready',
    );

    renameSync(storageLocator, pinnedStore);
    mkdirSync(decoyStore, { mode: 0o700 });
    assert.notDeepEqual(identityFromStatV2(statSync(decoyStore)), authority.root_identity);

    child.send?.({ type: 'execute-operations', operations });
    const message = await waitForMessage(child, (candidate) => {
      const type = (candidate as { type?: string })?.type;
      return type === 'run-store-v2-result' || type === 'run-store-v2-error';
    });
    await waitForExit(child);
    return {
      mode,
      message,
      childExitCode: child.exitCode,
      authority,
      operations,
      pinnedStore,
      decoyStore,
      cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
  } catch (error) {
    if (child && child.exitCode === null) child.kill('SIGKILL');
    if (child) await waitForExit(child);
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function assertScenarioError(outcome: ScenarioOutcome, code: string): void {
  assert.equal(outcome.message.type, 'run-store-v2-error');
  const error = outcome.message.error as Record<string, unknown>;
  assert.equal(error.schema, 'ccm/run-store-error/v2');
  assert.equal(error.code, code);
}

function assertBoundError(
  outcome: ScenarioOutcome,
  operationId: string,
  effect: 'none' | 'unknown',
  retry: 'safe-same-operation' | 'reconcile-first' | 'never',
): void {
  const error = outcome.message.error as Record<string, unknown>;
  assert.equal(error.authority_id, outcome.authority.authority_id);
  assert.equal(error.operation_id, operationId);
  assert.equal(error.effect, effect);
  assert.equal(error.retry, retry);
}

test('contract qualification is limited to Linux and macOS', () => {
  assert.deepEqual(QUALIFIED_PLATFORMS_V2, ['darwin', 'linux']);
});

test('V1 write-only capability is rejected as underpowered rather than widened in place', () => {
  assert.throws(
    () =>
      validateCapabilityV2(
        {
          schema: 'ccm/supervisor-cwd-storage-capability/v1',
          authority_id: `sha256:${'a'.repeat(64)}`,
          assurance: 'kernel-cwd-object-v1',
          execute() {},
        },
        `sha256:${'a'.repeat(64)}`,
        'supervisor-runtime',
      ),
    { code: 'RUN_STORE_CAPABILITY_VERSION' },
  );
});

test('operation grammar rejects absolute, parent traversal, undeclared rename/remove and extra keys', () => {
  const grant = supervisorGrant();
  assert.throws(() => validateOperationV2(readOperation('absolute', ['/tmp']), grant), {
    code: 'RUN_STORE_PATH_INVALID',
  });
  assert.throws(() => validateOperationV2(readOperation('parent', ['..', 'secret']), grant), {
    code: 'RUN_STORE_PATH_INVALID',
  });
  for (const kind of ['rename-entry', 'remove-entry']) {
    assert.throws(
      () =>
        validateOperationV2(
          {
            ...baseOperation(kind, kind, ['by-run', 'run-a']),
            destination_segments: ['elsewhere'],
          },
          grant,
        ),
      { code: 'RUN_STORE_OPERATION_UNKNOWN' },
    );
  }
  assert.throws(
    () =>
      validateOperationV2(
        { ...readOperation('extra', ['by-run', 'run-a', 'request.json']), locator: '/tmp' },
        grant,
      ),
    { code: 'RUN_STORE_OPERATION_SHAPE' },
  );
});

test('phase allowlist rejects an audit grant attempting a supervisor write', () => {
  assert.throws(
    () =>
      validateOperationV2(
        createOperation(
          'audit-write',
          ['by-run', 'run-a', 'lease', 'hello.json'],
          Buffer.from('x'),
        ),
        { phase: 'inventory-audit' },
      ),
    { code: 'RUN_STORE_PHASE_FORBIDDEN' },
  );
});

test('known-good fixture executes only the five real-consumer operations on the pinned cwd object', {
  skip: !posix,
}, async () => {
  const hello = Buffer.from('{"schema":"hello"}\n', 'utf8');
  const lease1 = Buffer.from('{"heartbeat_seq":1}\n', 'utf8');
  const lease2 = Buffer.from('{"heartbeat_seq":2}\n', 'utf8');
  const frame = createCcmjFrame(Buffer.from('{"seq":1}', 'utf8'));
  const operations = [
    createOperation('create-hello', ['by-run', 'run-a', 'lease', 'hello.json'], hello),
    readOperation('read-hello', ['by-run', 'run-a', 'lease', 'hello.json']),
    replaceOperation(
      'create-lease',
      ['by-run', 'run-a', 'lease', 'supervisor.json'],
      'absent',
      lease1,
    ),
    replaceOperation(
      'advance-lease',
      ['by-run', 'run-a', 'lease', 'supervisor.json'],
      sha256V2(lease1),
      lease2,
    ),
    appendOperation('append-journal', frame),
    listOperation('list-inbox', ['by-run', 'run-a', 'control', 'inbox']),
  ];
  const outcome = await runScenario('known-good', operations);
  try {
    assert.equal(outcome.message.type, 'run-store-v2-result');
    const executions = outcome.message.executions as Array<Record<string, unknown>>;
    assert.equal(executions.length, operations.length);
    for (let index = 0; index < operations.length; index++) {
      validateExecutionV2(
        executions[index],
        String(outcome.authority.authority_id),
        operations[index],
      );
    }
    validateTraceV2(outcome.message.trace, {
      authorityId: String(outcome.authority.authority_id),
      consumerInvocations: 1,
      capabilityInvocations: operations.length,
      operationDigests: operations.map(operationDigestV2),
    });
    assert.equal(outcome.childExitCode, 0);
    assert.equal(
      readFileSync(join(outcome.pinnedStore, 'by-run', 'run-a', 'lease', 'hello.json'), 'utf8'),
      hello.toString('utf8'),
    );
    assert.equal(
      readFileSync(
        join(outcome.pinnedStore, 'by-run', 'run-a', 'lease', 'supervisor.json'),
        'utf8',
      ),
      lease2.toString('utf8'),
    );
    assert.deepEqual(
      readFileSync(join(outcome.pinnedStore, 'by-run', 'run-a', 'journal.ccmj')),
      frame,
    );
    assert.equal(existsSync(join(outcome.decoyStore, 'by-run')), false);
  } finally {
    outcome.cleanup();
  }
});

test('real symlink component escape is rejected before reading outside the cwd store', {
  skip: !posix,
}, async () => {
  const operation = readOperation('symlink-read', ['by-run', 'run-a', 'lease', 'outside.json']);
  const outcome = await runScenario('known-good', [operation], (store, outside) => {
    mkdirSync(join(store, 'by-run', 'run-a'), { recursive: true, mode: 0o700 });
    writeFileSync(join(outside, 'outside.json'), 'secret', { mode: 0o600 });
    symlinkSync(outside, join(store, 'by-run', 'run-a', 'lease'));
  });
  try {
    assertScenarioError(outcome, 'RUN_STORE_PATH_SYMLINK');
    assert.equal(
      readFileSync(join(dirname(outcome.pinnedStore), 'outside', 'outside.json'), 'utf8'),
      'secret',
    );
  } finally {
    outcome.cleanup();
  }
});

test('no-replace collision and stale CAS both fail with effect none', {
  skip: !posix,
}, async () => {
  const bytes = Buffer.from('immutable');
  const create = createOperation('same-create', ['by-run', 'run-a', 'lease', 'hello.json'], bytes);
  const collision = await runScenario('known-good', [create, create]);
  try {
    assertScenarioError(collision, 'RUN_STORE_NO_REPLACE');
    assertBoundError(collision, 'same-create', 'none', 'never');
    assert.equal(
      readFileSync(join(collision.pinnedStore, 'by-run', 'run-a', 'lease', 'hello.json'), 'utf8'),
      'immutable',
    );
  } finally {
    collision.cleanup();
  }

  const stale = replaceOperation(
    'stale-cas',
    ['by-run', 'run-a', 'lease', 'supervisor.json'],
    `sha256:${'c'.repeat(64)}`,
    Buffer.from('new lease'),
  );
  const conflict = await runScenario('known-good', [stale]);
  try {
    assertScenarioError(conflict, 'RUN_STORE_REVISION_CONFLICT');
    assertBoundError(conflict, 'stale-cas', 'none', 'never');
    assert.equal(
      existsSync(join(conflict.pinnedStore, 'by-run', 'run-a', 'lease', 'supervisor.json')),
      false,
    );
  } finally {
    conflict.cleanup();
  }
});

test('forged read result is rejected by payload length and digest validation', {
  skip: !posix,
}, async () => {
  const operation = readOperation('forged-read', ['by-run', 'run-a', 'lease', 'hello.json']);
  const outcome = await runScenario('forged-result', [operation]);
  try {
    assertScenarioError(outcome, 'RUN_STORE_RESULT_FORGED');
  } finally {
    outcome.cleanup();
  }
});

test('forged replace before revision is rejected', { skip: !posix }, async () => {
  const operation = replaceOperation(
    'forged-before',
    ['by-run', 'run-a', 'lease', 'supervisor.json'],
    'absent',
    Buffer.from('lease'),
  );
  const outcome = await runScenario('forged-before-revision', [operation]);
  try {
    assertScenarioError(outcome, 'RUN_STORE_RESULT_FORGED');
    assertBoundError(outcome, 'forged-before', 'unknown', 'reconcile-first');
  } finally {
    outcome.cleanup();
  }
});

test('forged append revision and byte length are rejected', { skip: !posix }, async () => {
  const operation = appendOperation(
    'forged-append',
    createCcmjFrame(Buffer.from('{"seq":1}', 'utf8')),
  );
  const outcome = await runScenario('forged-append-receipt', [operation]);
  try {
    assertScenarioError(outcome, 'RUN_STORE_RESULT_FORGED');
    assertBoundError(outcome, 'forged-append', 'unknown', 'reconcile-first');
  } finally {
    outcome.cleanup();
  }

  const expectedPrefix = createCcmjFrame(Buffer.from('{"seq":0}', 'utf8'));
  const actualPrefix = createCcmjFrame(Buffer.from('{"seq":9}', 'utf8'));
  assert.equal(actualPrefix.length, expectedPrefix.length);
  const frame = createCcmjFrame(Buffer.from('{"seq":1}', 'utf8'));
  const wrongPrefix = await runScenario(
    'wrong-append-prefix',
    [
      {
        ...appendOperation('wrong-append-prefix', frame),
        expected_revision: sha256V2(expectedPrefix),
        expected_byte_length: expectedPrefix.length,
      },
    ],
    (store) => {
      mkdirSync(join(store, 'by-run', 'run-a'), { recursive: true, mode: 0o700 });
      writeFileSync(join(store, 'by-run', 'run-a', 'journal.ccmj'), actualPrefix, { mode: 0o600 });
    },
  );
  try {
    assertScenarioError(wrongPrefix, 'RUN_STORE_COMMITTED_OBSERVATION');
    assertBoundError(wrongPrefix, 'wrong-append-prefix', 'unknown', 'reconcile-first');
  } finally {
    wrongPrefix.cleanup();
  }
});

test('a synced receipt without observed write and sync calls is rejected', {
  skip: !posix,
}, async () => {
  const operation = createOperation(
    'no-write',
    ['by-run', 'run-a', 'lease', 'hello.json'],
    Buffer.from('never-written'),
  );
  const outcome = await runScenario('no-write-synced-receipt', [operation]);
  try {
    assertScenarioError(outcome, 'RUN_STORE_RECEIPT_DURABILITY');
    assertBoundError(outcome, 'no-write', 'unknown', 'reconcile-first');
    assert.equal(existsSync(join(outcome.pinnedStore, 'by-run')), false);
  } finally {
    outcome.cleanup();
  }

  const wrongTarget = await runScenario('wrong-target-sync', [
    createOperation(
      'wrong-target-sync',
      ['by-run', 'run-a', 'lease', 'hello.json'],
      Buffer.from('target-was-not-synced'),
    ),
  ]);
  try {
    assertScenarioError(wrongTarget, 'RUN_STORE_RECEIPT_DURABILITY');
    assertBoundError(wrongTarget, 'wrong-target-sync', 'unknown', 'reconcile-first');
  } finally {
    wrongTarget.cleanup();
  }

  const oldBytes = Buffer.from('old-bytes-synced-before-final-write');
  const finalBytes = Buffer.from('final-bytes-written-without-later-sync');
  const preSync = await runScenario(
    'pre-sync-final-unsynced-write',
    [
      replaceOperation(
        'pre-sync-final-unsynced-write',
        ['by-run', 'run-a', 'lease', 'supervisor.json'],
        sha256V2(oldBytes),
        finalBytes,
      ),
    ],
    (store) => {
      const parent = join(store, 'by-run', 'run-a', 'lease');
      mkdirSync(parent, { recursive: true, mode: 0o700 });
      writeFileSync(join(parent, 'supervisor.json'), oldBytes, { mode: 0o600 });
    },
  );
  try {
    assertScenarioError(preSync, 'RUN_STORE_RECEIPT_DURABILITY');
    assertBoundError(preSync, 'pre-sync-final-unsynced-write', 'unknown', 'reconcile-first');
    assert.deepEqual(
      readFileSync(join(preSync.pinnedStore, 'by-run', 'run-a', 'lease', 'supervisor.json')),
      finalBytes,
    );
  } finally {
    preSync.cleanup();
  }
});

test('post-publication failure is bound and conservatively requires reconciliation', {
  skip: !posix,
}, async () => {
  const operation = createOperation(
    'post-publication',
    ['by-run', 'run-a', 'lease', 'hello.json'],
    Buffer.from('published-before-error'),
  );
  const outcome = await runScenario('post-publication-failure', [operation]);
  try {
    assertScenarioError(outcome, 'RUN_STORE_FALSE_SAFE');
    assertBoundError(outcome, 'post-publication', 'unknown', 'reconcile-first');
    assert.equal(
      readFileSync(join(outcome.pinnedStore, 'by-run', 'run-a', 'lease', 'hello.json'), 'utf8'),
      'published-before-error',
    );
  } finally {
    outcome.cleanup();
  }
});

test('partial CCMJ append cannot satisfy the committed observation', { skip: !posix }, async () => {
  const frame = createCcmjFrame(Buffer.from('{"seq":1}', 'utf8'));
  const operation = appendOperation('partial-append', frame);
  const outcome = await runScenario('partial-append', [operation]);
  try {
    assertScenarioError(outcome, 'RUN_STORE_RECEIPT_DURABILITY');
    assertBoundError(outcome, 'partial-append', 'unknown', 'reconcile-first');
    assert.throws(
      () =>
        assert.deepEqual(
          readFileSync(join(outcome.pinnedStore, 'by-run', 'run-a', 'journal.ccmj')),
          frame,
        ),
      { name: 'AssertionError' },
    );
  } finally {
    outcome.cleanup();
  }
});

for (const mode of ['missing-durability', 'unsafe-durability'] as const) {
  test(`${mode} receipt is rejected`, { skip: !posix }, async () => {
    const operation = createOperation(
      mode,
      ['by-run', 'run-a', 'lease', 'hello.json'],
      Buffer.from('hello'),
    );
    const outcome = await runScenario(mode, [operation]);
    try {
      assertScenarioError(outcome, 'RUN_STORE_RECEIPT_DURABILITY');
    } finally {
      outcome.cleanup();
    }
  });
}

test('adapter bypass is rejected even when bytes land in the pinned cwd object', {
  skip: !posix,
}, async () => {
  const operation = createOperation(
    'bypass',
    ['by-run', 'run-a', 'lease', 'hello.json'],
    Buffer.from('hello'),
  );
  const outcome = await runScenario('adapter-bypass', [operation]);
  try {
    assert.equal(outcome.message.type, 'run-store-v2-result');
    assert.throws(
      () =>
        validateTraceV2(outcome.message.trace, {
          authorityId: String(outcome.authority.authority_id),
          consumerInvocations: 1,
          capabilityInvocations: 1,
          operationDigests: [operationDigestV2(operation)],
        }),
      { code: 'RUN_STORE_CAPABILITY_BYPASS' },
    );
  } finally {
    outcome.cleanup();
  }
});

test('OPT-IN HONEST RED: production V2 consumer is absent until GREEN implementation', {
  skip: !runProductionRed || !posix,
}, async () => {
  const hello = Buffer.from('{"schema":"hello"}\n', 'utf8');
  const lease1 = Buffer.from('{"heartbeat_seq":1}\n', 'utf8');
  const lease2 = Buffer.from('{"heartbeat_seq":2}\n', 'utf8');
  const frame = createCcmjFrame(Buffer.from('{"seq":1}', 'utf8'));
  const operations = [
    createOperation('production-create', ['by-run', 'run-a', 'lease', 'hello.json'], hello),
    readOperation('production-read', ['by-run', 'run-a', 'lease', 'hello.json']),
    replaceOperation(
      'production-create-lease',
      ['by-run', 'run-a', 'lease', 'supervisor.json'],
      'absent',
      lease1,
    ),
    replaceOperation(
      'production-advance-lease',
      ['by-run', 'run-a', 'lease', 'supervisor.json'],
      sha256V2(lease1),
      lease2,
    ),
    appendOperation('production-append', frame),
    listOperation('production-list', ['by-run', 'run-a', 'control', 'inbox']),
  ];
  const outcome = await runScenario('production', operations);
  try {
    if (outcome.message.type === 'run-store-v2-error') {
      const error = outcome.message.error as Record<string, unknown>;
      const typed = new Error(String(error.message)) as Error & { code: string };
      typed.code = String(error.code);
      throw typed;
    }
    assert.equal(outcome.message.type, 'run-store-v2-result');
    const executions = outcome.message.executions as Array<Record<string, unknown>>;
    assert.equal(executions.length, operations.length);
    for (let index = 0; index < operations.length; index++) {
      validateExecutionV2(
        executions[index],
        String(outcome.authority.authority_id),
        operations[index],
      );
    }
    validateTraceV2(outcome.message.trace, {
      authorityId: String(outcome.authority.authority_id),
      consumerInvocations: 1,
      capabilityInvocations: operations.length,
      operationDigests: operations.map(operationDigestV2),
    });
    assert.equal(
      readFileSync(join(outcome.pinnedStore, 'by-run', 'run-a', 'lease', 'hello.json'), 'utf8'),
      hello.toString('utf8'),
    );
    assert.equal(
      readFileSync(
        join(outcome.pinnedStore, 'by-run', 'run-a', 'lease', 'supervisor.json'),
        'utf8',
      ),
      lease2.toString('utf8'),
    );
    assert.deepEqual(
      readFileSync(join(outcome.pinnedStore, 'by-run', 'run-a', 'journal.ccmj')),
      frame,
    );
  } finally {
    outcome.cleanup();
  }

  const crossRun = await runScenario('production', [
    readOperation('production-cross-run', ['by-run', 'run-b', 'request.json']),
  ]);
  try {
    assertScenarioError(crossRun, 'RUN_STORE_PATH_FORBIDDEN');
    assertBoundError(crossRun, 'production-cross-run', 'none', 'never');
  } finally {
    crossRun.cleanup();
  }

  const wrongPhaseOperation = {
    ...readOperation('production-wrong-phase', ['by-run', 'run-a', 'request.json']),
    phase: 'inventory-audit',
  };
  const wrongPhase = await runScenario('production', [wrongPhaseOperation]);
  try {
    assertScenarioError(wrongPhase, 'RUN_STORE_PHASE_FORBIDDEN');
    assertBoundError(wrongPhase, 'production-wrong-phase', 'none', 'never');
  } finally {
    wrongPhase.cleanup();
  }

  const stale = await runScenario('production', [
    replaceOperation(
      'production-stale-cas',
      ['by-run', 'run-a', 'lease', 'supervisor.json'],
      `sha256:${'d'.repeat(64)}`,
      Buffer.from('stale'),
    ),
  ]);
  try {
    assertScenarioError(stale, 'RUN_STORE_REVISION_CONFLICT');
    assertBoundError(stale, 'production-stale-cas', 'none', 'never');
  } finally {
    stale.cleanup();
  }

  const symlink = await runScenario(
    'production',
    [readOperation('production-symlink', ['by-run', 'run-a', 'lease', 'outside.json'])],
    (store, outside) => {
      mkdirSync(join(store, 'by-run', 'run-a'), { recursive: true, mode: 0o700 });
      writeFileSync(join(outside, 'outside.json'), 'secret', { mode: 0o600 });
      symlinkSync(outside, join(store, 'by-run', 'run-a', 'lease'));
    },
  );
  try {
    assertScenarioError(symlink, 'RUN_STORE_PATH_SYMLINK');
    assertBoundError(symlink, 'production-symlink', 'none', 'never');
  } finally {
    symlink.cleanup();
  }
});
