import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { runProduction } from '../src/production-run.js';

const roots: string[] = [];
after(() =>
  roots.splice(0).forEach((root) => {
    rmSync(root, { recursive: true, force: true });
  }),
);
const clone = <T>(value: T): T => structuredClone(value);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

function fixture(): any {
  return JSON.parse(
    readFileSync(
      join(
        dirname(new URL(import.meta.url).pathname),
        '../../../packages/engine/test/fixtures/native-attempt/codex-api-tool-v1.json',
      ),
      'utf8',
    ),
  );
}

function invoke(
  boardPath: string,
  home: string,
  command: any,
  extra: Record<string, unknown> = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const code = runProduction(
    [
      'task',
      'native-attempt-create',
      command.task_id,
      '--selection',
      JSON.stringify(command.selection_snapshot),
      '--attempt',
      JSON.stringify(command.attempt),
      '--replay-intent',
      command.replay_intent,
      '--board',
      boardPath,
      '--home',
      home,
      '--json',
    ],
    {
      out: (value: string) => out.push(value),
      err: (value: string) => err.push(value),
      env: {
        CC_MASTER_HOME: home,
        CC_MASTER_HARNESS: 'codex',
        CODEX_SESSION_ID: 'session-ref:fixture-origin',
        CC_MASTER_STATUSLINE_AUTO_INSTALL: '0',
      },
      ...extra,
    } as any,
  );
  assert.equal(typeof code, 'number');
  return { code, out, err };
}

function bind(boardPath: string, home: string, command: any) {
  const out: string[] = [];
  const err: string[] = [];
  const code = runProduction(
    [
      'task',
      'native-attempt-bind',
      command.task_id,
      '--attempt-id',
      command.attempt_id,
      '--evidence-record-ref',
      command.evidence_record_ref,
      '--board',
      boardPath,
      '--home',
      home,
      '--json',
    ],
    {
      out: (value: string) => out.push(value),
      err: (value: string) => err.push(value),
      env: {
        CC_MASTER_HOME: home,
        CC_MASTER_HARNESS: 'codex',
        CODEX_SESSION_ID: 'session-ref:fixture-origin',
        CC_MASTER_STATUSLINE_AUTO_INSTALL: '0',
      },
    } as any,
  );
  assert.equal(typeof code, 'number');
  return { code, out, err };
}

function installBindEvidence(home: string, boardPath: string, value: any): void {
  const board = JSON.parse(readFileSync(boardPath, 'utf8'));
  const attempt = board.tasks[0].routing.attempts[0];
  const recordRef = value.commands.bind.evidence_record_ref;
  const registrationRef = 'private-producer-registration:production-offline-fixture';
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyBytes = publicKey.export({ format: 'der', type: 'spki' });
  const registration = {
    schema: 'ccm/native-evidence-producer/codex-api-tool/v1',
    producer_id: 'producer:production-offline-fixture',
    channel: 'ccm-private-adapter/v1',
    registration_ref: registrationRef,
    public_key_id: 'ed25519:production-offline-fixture',
    public_key_spki_base64: publicKeyBytes.toString('base64'),
    public_key_fingerprint: `sha256:${createHash('sha256').update(publicKeyBytes).digest('hex')}`,
    revoked: false,
    trust_scope: {
      contract: attempt.schema,
      origin: attempt.descriptor.origin,
      harness: attempt.descriptor.harness,
      adapter: attempt.descriptor.adapter,
      surface: attempt.descriptor.surface,
      transport: attempt.descriptor.transport,
      origin_session_ref: attempt.lineage.origin_session_ref,
    },
  };
  const record: any = {
    schema: 'ccm/native-handle-evidence-record/codex-api-tool/v1',
    record_id: recordRef,
    record_hash: '',
    producer: {
      producer_id: registration.producer_id,
      channel: registration.channel,
      registration_ref: registrationRef,
      signature: '',
    },
    create_link: {
      task_id: value.commands.bind.task_id,
      attempt_id: attempt.id,
      candidate_id: attempt.candidate_id,
      dispatch_key: attempt.dispatch.key,
      input_hash: attempt.dispatch.input_hash,
      request_hash: attempt.dispatch.request_hash,
      launch_claim_id: attempt.dispatch.launch_claim_id,
      reservation_id: attempt.launch_authority.reservation.reservation_id,
      ticket_digest: attempt.launch_authority.ticket_digest,
      launch_identity_digest: attempt.launch_authority.canonical_identity_digest,
    },
    expected: {
      transport: attempt.descriptor.transport,
      parent_target: attempt.lineage.parent_target,
      child_target: attempt.lineage.expected_child_target,
    },
    observed: clone(value.commands.bind.verified_evidence.observed),
  };
  const signed = {
    schema: record.schema,
    record_id: record.record_id,
    producer: {
      producer_id: record.producer.producer_id,
      channel: record.producer.channel,
      registration_ref: record.producer.registration_ref,
    },
    create_link: record.create_link,
    expected: record.expected,
    observed: record.observed,
  };
  record.record_hash = sha(signed);
  record.producer.signature = `ed25519:${sign(
    null,
    Buffer.from(record.record_hash),
    privateKey,
  ).toString('base64')}`;

  const registrationPath = join(
    home,
    'native-attempt',
    'v1',
    'evidence',
    'registrations',
    `${createHash('sha256').update(registrationRef).digest('hex')}.json`,
  );
  const recordPath = join(
    home,
    'native-attempt',
    'v1',
    'evidence',
    'records',
    `${createHash('sha256').update(recordRef).digest('hex')}.json`,
  );
  mkdirSync(dirname(registrationPath), { recursive: true, mode: 0o700 });
  mkdirSync(dirname(recordPath), { recursive: true, mode: 0o700 });
  writeFileSync(registrationPath, `${JSON.stringify(registration, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(
    recordPath,
    `${JSON.stringify(
      {
        provenance: {
          store: 'ccm-owner-evidence/v1',
          visibility: 'owner-only',
          owner_home_ref: home,
          record_ref: recordRef,
        },
        fact_resolution: {
          account: 'current',
          permission_profile: 'compatible',
          permission_denies: 'compatible',
        },
        record,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
}

function installAdmission(home: string, command: any): string {
  const admissionDir = join(home, 'native-attempt', 'v1', 'admissions');
  mkdirSync(admissionDir, { recursive: true, mode: 0o700 });
  const path = join(
    admissionDir,
    `${createHash('sha256').update(command.attempt.dispatch.key).digest('hex')}.json`,
  );
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        schema: 'ccm/native-launch-authority-record/v1',
        provenance: {
          store: 'ccm-owner-native-attempt/v1',
          visibility: 'owner-only',
          owner_home_ref: home,
        },
        task_id: command.task_id,
        dispatch_key: command.attempt.dispatch.key,
        admission_snapshot: command.admission_snapshot,
        launch_authority: command.launch_authority,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  return path;
}

function strandOwnerCommit(
  kind: 'launch' | 'evidence',
  currentPath: string,
  ownerPid = 2_147_483_647,
): string {
  const current = JSON.parse(readFileSync(currentPath, 'utf8'));
  const payload =
    kind === 'launch'
      ? {
          schema: current.schema,
          claim_id: current.claim_id,
          canonical_identity_digest: current.canonical_identity_digest,
          ticket_digest: current.ticket_digest,
          reservation_id: current.reservation_id,
        }
      : {
          schema: current.schema,
          evidence_class: current.evidence_class,
          record_ref: current.record_ref,
          record_hash: current.record_hash,
        };
  const lockPath = join(dirname(currentPath), 'stage.lock');
  writeFileSync(
    lockPath,
    `${JSON.stringify(
      {
        schema: 'ccm/native-owner-stage/v1',
        kind,
        owner_pid: ownerPid,
        identity: current.identity,
        payload,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  unlinkSync(currentPath);
  return lockPath;
}

test('R1 runProduction composes owner launch authority without a RunOpts resolver', () => {
  const value = fixture();
  const root = mkdtempSync(join(tmpdir(), 'ccm-native-production-r1-'));
  roots.push(root);
  const home = join(root, 'home');
  const boardPath = join(root, 'native.board.json');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(boardPath, `${JSON.stringify(value.initial_board, null, 2)}\n`);

  const command = clone(value.commands.create);
  command.attempt.dispatch.input_hash =
    'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  installAdmission(home, command);

  const before = readFileSync(boardPath, 'utf8');
  const result = invoke(boardPath, home, command);
  assert.equal(result.code, 0, result.err.join('\n'));
  assert.notEqual(readFileSync(boardPath, 'utf8'), before);

  installBindEvidence(home, boardPath, value);
  const bound = bind(boardPath, home, value.commands.bind);
  assert.equal(bound.code, 0, bound.err.join('\n'));
  const projected = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.equal(projected.tasks[0].status, 'in_flight');
  assert.equal(projected.tasks[0].routing.attempts[0].handle, 'agent-fixture-001');
});

test('R1 expired ticket and replayed claim fail closed before board or claim mutation', () => {
  for (const variant of ['expired', 'claim-replayed'] as const) {
    const value = fixture();
    const root = mkdtempSync(join(tmpdir(), `ccm-native-production-${variant}-r1-`));
    roots.push(root);
    const home = join(root, 'home');
    const boardPath = join(root, 'native.board.json');
    mkdirSync(home, { recursive: true, mode: 0o700 });
    writeFileSync(boardPath, `${JSON.stringify(value.initial_board, null, 2)}\n`);
    const command = clone(value.commands.create);
    if (variant === 'expired') {
      command.launch_authority.ticket.launch_by = '2000-01-01T00:00:00Z';
      command.launch_authority.ticket_digest = sha(command.launch_authority.ticket);
      command.launch_authority.reservation.ticket_digest = command.launch_authority.ticket_digest;
    }
    installAdmission(home, command);
    if (variant === 'claim-replayed') {
      const claimPath = join(
        home,
        'native-attempt',
        'v1',
        'claims',
        createHash('sha256').update(command.attempt.dispatch.launch_claim_id).digest('hex'),
        'current.json',
      );
      mkdirSync(dirname(claimPath), { recursive: true, mode: 0o700 });
      writeFileSync(claimPath, `${JSON.stringify({ identity: 'forged-prior-claim' }, null, 2)}\n`, {
        mode: 0o600,
      });
    }
    const beforeBoard = readFileSync(boardPath, 'utf8');
    const claimRoot = join(home, 'native-attempt', 'v1', 'claims');
    const beforeClaim = existsSync(claimRoot)
      ? readFileSync(
          join(
            claimRoot,
            createHash('sha256').update(command.attempt.dispatch.launch_claim_id).digest('hex'),
            'current.json',
          ),
          'utf8',
        )
      : null;
    const result = invoke(boardPath, home, command);
    assert.notEqual(result.code, 0, variant);
    assert.equal(readFileSync(boardPath, 'utf8'), beforeBoard, `${variant}: board changed`);
    const currentClaimPath = join(
      claimRoot,
      createHash('sha256').update(command.attempt.dispatch.launch_claim_id).digest('hex'),
      'current.json',
    );
    assert.equal(
      existsSync(currentClaimPath) ? readFileSync(currentClaimPath, 'utf8') : null,
      beforeClaim,
      `${variant}: claim changed`,
    );
  }
});

test('R1 runProduction never treats an injected resolver as production evidence', () => {
  const value = fixture();
  const root = mkdtempSync(join(tmpdir(), 'ccm-native-production-injection-r1-'));
  roots.push(root);
  const home = join(root, 'home');
  const boardPath = join(root, 'native.board.json');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(boardPath, `${JSON.stringify(value.initial_board, null, 2)}\n`);
  const command = clone(value.commands.create);
  const before = readFileSync(boardPath, 'utf8');
  const result = invoke(boardPath, home, command, {
    nativeAttemptAdmission: {
      resolveCreate: () => clone(command.admission_snapshot),
      resolveControl: () => clone(value.commands.cancel.authority_snapshot),
    },
  });
  assert.notEqual(result.code, 0);
  assert.equal(readFileSync(boardPath, 'utf8'), before);
});

test('R1 recovers post-board owner commits only from the matching durable projection', () => {
  const value = fixture();
  const root = mkdtempSync(join(tmpdir(), 'ccm-native-production-recovery-r1-'));
  roots.push(root);
  const home = join(root, 'home');
  const boardPath = join(root, 'native.board.json');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(boardPath, `${JSON.stringify(value.initial_board, null, 2)}\n`);
  const command = clone(value.commands.create);
  installAdmission(home, command);

  const created = invoke(boardPath, home, command);
  assert.equal(created.code, 0, created.err.join('\n'));
  const claimPath = join(
    home,
    'native-attempt',
    'v1',
    'claims',
    createHash('sha256').update(command.attempt.dispatch.launch_claim_id).digest('hex'),
    'current.json',
  );
  const claimLock = strandOwnerCommit('launch', claimPath);
  const createReplay = invoke(boardPath, home, command);
  assert.equal(createReplay.code, 0, createReplay.err.join('\n'));
  assert.match(createReplay.out.join('\n'), /"launch_allowed"\s*:\s*false/);
  assert.equal(existsSync(claimPath), true);
  assert.equal(existsSync(claimLock), false);

  installBindEvidence(home, boardPath, value);
  const bound = bind(boardPath, home, value.commands.bind);
  assert.equal(bound.code, 0, bound.err.join('\n'));
  const consumptionPath = join(
    home,
    'native-attempt',
    'v1',
    'evidence',
    'consumptions',
    createHash('sha256').update(`bind\0${value.commands.bind.evidence_record_ref}`).digest('hex'),
    'current.json',
  );
  const consumptionLock = strandOwnerCommit('evidence', consumptionPath);
  const bindReplay = bind(boardPath, home, value.commands.bind);
  assert.equal(bindReplay.code, 0, bindReplay.err.join('\n'));
  assert.match(bindReplay.out.join('\n'), /"bound"\s*:\s*false/);
  assert.equal(existsSync(consumptionPath), true);
  assert.equal(existsSync(consumptionLock), false);
});

test('R1 never reclaims a stranded launch stage without matching board evidence', () => {
  const value = fixture();
  const root = mkdtempSync(join(tmpdir(), 'ccm-native-production-hostile-stage-r1-'));
  roots.push(root);
  const home = join(root, 'home');
  const boardPath = join(root, 'native.board.json');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(boardPath, `${JSON.stringify(value.initial_board, null, 2)}\n`);
  const command = clone(value.commands.create);
  installAdmission(home, command);

  const claimDir = join(
    home,
    'native-attempt',
    'v1',
    'claims',
    createHash('sha256').update(command.attempt.dispatch.launch_claim_id).digest('hex'),
  );
  mkdirSync(claimDir, { recursive: true, mode: 0o700 });
  const lockPath = join(claimDir, 'stage.lock');
  writeFileSync(
    lockPath,
    `${JSON.stringify(
      {
        schema: 'ccm/native-owner-stage/v1',
        kind: 'launch',
        owner_pid: 2_147_483_647,
        identity: 'attacker-controlled-stage',
        payload: {},
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  const beforeBoard = readFileSync(boardPath, 'utf8');
  const beforeStage = readFileSync(lockPath, 'utf8');
  const result = invoke(boardPath, home, command);
  assert.notEqual(result.code, 0);
  assert.equal(readFileSync(boardPath, 'utf8'), beforeBoard);
  assert.equal(readFileSync(lockPath, 'utf8'), beforeStage);
});

test('R1 never reclaims a matching stage while its owner process is still alive', () => {
  const value = fixture();
  const root = mkdtempSync(join(tmpdir(), 'ccm-native-production-live-stage-r1-'));
  roots.push(root);
  const home = join(root, 'home');
  const boardPath = join(root, 'native.board.json');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(boardPath, `${JSON.stringify(value.initial_board, null, 2)}\n`);
  const command = clone(value.commands.create);
  installAdmission(home, command);
  const created = invoke(boardPath, home, command);
  assert.equal(created.code, 0, created.err.join('\n'));

  const claimPath = join(
    home,
    'native-attempt',
    'v1',
    'claims',
    createHash('sha256').update(command.attempt.dispatch.launch_claim_id).digest('hex'),
    'current.json',
  );
  const lockPath = strandOwnerCommit('launch', claimPath, process.pid);
  const beforeBoard = readFileSync(boardPath, 'utf8');
  const beforeStage = readFileSync(lockPath, 'utf8');
  const result = invoke(boardPath, home, command);
  assert.notEqual(result.code, 0);
  assert.equal(readFileSync(boardPath, 'utf8'), beforeBoard);
  assert.equal(readFileSync(lockPath, 'utf8'), beforeStage);
  assert.equal(existsSync(claimPath), false);
});
