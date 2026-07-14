import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  copyFileSync,
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
import { canonicalSha256Digest } from '@ccm/engine';
import { runProduction } from '../src/production-run.js';

const roots: string[] = [];
after(() =>
  roots.splice(0).forEach((root) => {
    rmSync(root, { recursive: true, force: true });
  }),
);
const clone = <T>(value: T): T => structuredClone(value);

function sha(value: unknown): string {
  return canonicalSha256Digest(value);
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

function installBindEvidence(
  home: string,
  boardPath: string,
  value: any,
  mutate?: (state: { record: any; registration: any; entry: any }) => void,
): { recordPath: string; registrationPath: string; recordRef: string } {
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
  const entry = {
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
  };
  mutate?.({ record, registration, entry });
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
  writeFileSync(recordPath, `${JSON.stringify(entry, null, 2)}\n`, { mode: 0o600 });
  return { recordPath, registrationPath, recordRef };
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
  const projection = current.projection;
  const locator =
    kind === 'launch'
      ? {
          kind,
          task_id: projection.task_id,
          attempt_id: projection.attempt_id,
          dispatch_key: projection.value.attempt.dispatch.key,
        }
      : {
          kind,
          evidence_class: projection.evidence_class,
          task_id: projection.task_id,
          attempt_id: projection.attempt_id,
          record_ref: projection.record_ref,
          record_hash: projection.record_hash,
        };
  const lockPath = join(dirname(currentPath), 'stage.lock');
  writeFileSync(
    lockPath,
    `${JSON.stringify(
      {
        schema: 'ccm/native-owner-stage/v2',
        kind,
        owner_pid: ownerPid,
        identity: current.identity,
        payload: current.payload,
        board_path: current.board_path,
        locator,
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

test('R2 committed launch claim replay requires the exact durable board path and projection', () => {
  for (const variant of ['rolled-back-board', 'copied-path', 'current-hash-drift'] as const) {
    const value = fixture();
    const root = mkdtempSync(join(tmpdir(), `ccm-native-production-r2-${variant}-`));
    roots.push(root);
    const home = join(root, 'home');
    const boardPath = join(root, 'native.board.json');
    mkdirSync(home, { recursive: true, mode: 0o700 });
    const initialBytes = `${JSON.stringify(value.initial_board, null, 2)}\n`;
    writeFileSync(boardPath, initialBytes);
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
    let replayPath = boardPath;
    if (variant === 'rolled-back-board') {
      writeFileSync(boardPath, initialBytes);
    } else if (variant === 'copied-path') {
      replayPath = join(root, 'copied.board.json');
      copyFileSync(boardPath, replayPath);
    } else {
      const current = JSON.parse(readFileSync(claimPath, 'utf8'));
      current.board_content_hash =
        'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
      writeFileSync(claimPath, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
    }
    const beforeBoard = readFileSync(replayPath, 'utf8');
    const beforeClaim = readFileSync(claimPath, 'utf8');
    const replay = invoke(replayPath, home, command);
    assert.notEqual(replay.code, 0, `${variant}: replay must fail closed`);
    assert.equal(readFileSync(replayPath, 'utf8'), beforeBoard, `${variant}: board changed`);
    assert.equal(readFileSync(claimPath, 'utf8'), beforeClaim, `${variant}: claim changed`);
  }
});

test('R2 committed evidence replay requires the exact durable board path and projection', () => {
  for (const variant of ['rolled-back-board', 'copied-path', 'current-hash-drift'] as const) {
    const value = fixture();
    const root = mkdtempSync(join(tmpdir(), `ccm-native-evidence-r2-${variant}-`));
    roots.push(root);
    const home = join(root, 'home');
    const boardPath = join(root, 'native.board.json');
    mkdirSync(home, { recursive: true, mode: 0o700 });
    writeFileSync(boardPath, `${JSON.stringify(value.initial_board, null, 2)}\n`);
    const command = clone(value.commands.create);
    installAdmission(home, command);
    const created = invoke(boardPath, home, command);
    assert.equal(created.code, 0, created.err.join('\n'));
    installBindEvidence(home, boardPath, value);
    const preBindBytes = readFileSync(boardPath, 'utf8');
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
    let replayPath = boardPath;
    if (variant === 'rolled-back-board') {
      writeFileSync(boardPath, preBindBytes);
    } else if (variant === 'copied-path') {
      replayPath = join(root, 'copied.board.json');
      copyFileSync(boardPath, replayPath);
    } else {
      const current = JSON.parse(readFileSync(consumptionPath, 'utf8'));
      current.board_content_hash =
        'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
      writeFileSync(consumptionPath, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
    }
    const beforeBoard = readFileSync(replayPath, 'utf8');
    const beforeConsumption = readFileSync(consumptionPath, 'utf8');
    const replay = bind(replayPath, home, value.commands.bind);
    assert.notEqual(replay.code, 0, `${variant}: replay must fail closed`);
    assert.equal(readFileSync(replayPath, 'utf8'), beforeBoard, `${variant}: board changed`);
    assert.equal(
      readFileSync(consumptionPath, 'utf8'),
      beforeConsumption,
      `${variant}: consumption changed`,
    );
  }
});

test('R2 default runProduction executes the complete production evidence verifier', () => {
  const cases: Array<{
    id: string;
    issue: string;
    mutate: (state: { record: any; registration: any; entry: any }) => void;
    afterInstall?: (state: {
      recordPath: string;
      registrationPath: string;
      home: string;
      command: any;
    }) => void;
  }> = [
    {
      id: 'caller-verification',
      issue: 'NATIVE-EVIDENCE-CALLER-VERIFICATION-FORBIDDEN',
      mutate: ({ record }) => (record.verified_by_ccm = true),
    },
    {
      id: 'unsigned-extra-field',
      issue: 'NATIVE-EVIDENCE-CANONICAL-HASH-MISMATCH',
      mutate: ({ record }) => (record.unsigned_extra = 'not-covered-by-the-frozen-schema'),
    },
    {
      id: 'registration-schema',
      issue: 'NATIVE-EVIDENCE-REGISTRATION-UNKNOWN',
      mutate: ({ registration }) => (registration.schema = 'ccm/forged-registration/v1'),
    },
    {
      id: 'registration-key-id',
      issue: 'NATIVE-EVIDENCE-REGISTRATION-UNKNOWN',
      mutate: ({ registration }) => (registration.public_key_id = 'ed25519:other-key'),
    },
    {
      id: 'registration-revoked',
      issue: 'NATIVE-EVIDENCE-REGISTRATION-UNKNOWN',
      mutate: ({ registration }) => (registration.revoked = true),
    },
    {
      id: 'registration-extra-field',
      issue: 'NATIVE-EVIDENCE-REGISTRATION-UNKNOWN',
      mutate: ({ registration }) => (registration.caller_extension = true),
    },
    {
      id: 'registration-unknown',
      issue: 'NATIVE-EVIDENCE-REGISTRATION-UNKNOWN',
      mutate: ({ record }) =>
        (record.producer.registration_ref = 'private-producer-registration:missing'),
    },
    {
      id: 'signature',
      issue: 'NATIVE-EVIDENCE-SIGNATURE-INVALID',
      mutate: () => undefined,
      afterInstall: ({ recordPath }) => {
        const entry = JSON.parse(readFileSync(recordPath, 'utf8'));
        entry.record.producer.signature = `ed25519:${Buffer.alloc(64, 7).toString('base64')}`;
        writeFileSync(recordPath, `${JSON.stringify(entry, null, 2)}\n`, { mode: 0o600 });
      },
    },
    {
      id: 'trust-scope',
      issue: 'NATIVE-EVIDENCE-TRUST-SCOPE-MISMATCH',
      mutate: ({ registration }) =>
        (registration.trust_scope.origin_session_ref = 'session-ref:other-origin'),
    },
    {
      id: 'expected-child',
      issue: 'NATIVE-EXPECTED-CHILD-MISMATCH',
      mutate: ({ record }) => (record.expected.child_target = '/root/fixture-parent/other-child'),
    },
    {
      id: 'expected-transport',
      issue: 'NATIVE-EVIDENCE-TRUST-SCOPE-MISMATCH',
      mutate: ({ record }) => (record.expected.transport = 'forged-transport'),
    },
    {
      id: 'raw-spawn-provenance',
      issue: 'NATIVE-HANDLE-UNATTESTED',
      mutate: ({ record }) => (record.observed.spawn.owner_record_ref = ''),
    },
    {
      id: 'raw-roster-hash',
      issue: 'NATIVE-HANDLE-UNATTESTED',
      mutate: ({ record }) => (record.observed.roster.raw_evidence_hash = 'not-a-digest'),
    },
    {
      id: 'handle-missing',
      issue: 'NATIVE-HANDLE-MISSING',
      mutate: ({ record }) => (record.observed.handle = ''),
    },
    {
      id: 'create-link-input',
      issue: 'NATIVE-EVIDENCE-CREATE-LINK-MISMATCH',
      mutate: ({ record }) => (record.create_link.input_hash = `sha256:${'a'.repeat(64)}`),
    },
    {
      id: 'create-link-reservation',
      issue: 'NATIVE-EVIDENCE-CREATE-LINK-MISMATCH',
      mutate: ({ record }) => (record.create_link.reservation_id = 'qres-forged'),
    },
    {
      id: 'create-link-ticket',
      issue: 'NATIVE-EVIDENCE-CREATE-LINK-MISMATCH',
      mutate: ({ record }) => (record.create_link.ticket_digest = `sha256:${'b'.repeat(64)}`),
    },
    {
      id: 'create-link-identity',
      issue: 'NATIVE-EVIDENCE-CREATE-LINK-MISMATCH',
      mutate: ({ record }) =>
        (record.create_link.launch_identity_digest = `sha256:${'c'.repeat(64)}`),
    },
    {
      id: 'lineage',
      issue: 'NATIVE-LINEAGE-MISMATCH',
      mutate: ({ record }) => (record.observed.current_lineage.worktree_ref = 'worktree-ref:other'),
    },
    {
      id: 'account-unknown',
      issue: 'NATIVE-ACCOUNT-FINGERPRINT-UNKNOWN',
      mutate: ({ entry }) => (entry.fact_resolution.account = 'unknown'),
    },
    {
      id: 'account-drift',
      issue: 'NATIVE-ACCOUNT-FINGERPRINT-MISMATCH',
      mutate: ({ entry }) => (entry.fact_resolution.account = 'drifted'),
    },
    {
      id: 'permission-profile',
      issue: 'NATIVE-PERMISSION-PROFILE-INCOMPATIBLE',
      mutate: ({ entry }) => (entry.fact_resolution.permission_profile = 'incompatible'),
    },
    {
      id: 'permission-denies',
      issue: 'NATIVE-PERMISSION-DENY-INCOMPATIBLE',
      mutate: ({ entry }) => (entry.fact_resolution.permission_denies = 'incompatible'),
    },
    {
      id: 'launch-claim',
      issue: 'NATIVE-EVIDENCE-CLAIM-REUSED',
      mutate: () => undefined,
      afterInstall: ({ home, command }) =>
        unlinkSync(
          join(
            home,
            'native-attempt',
            'v1',
            'claims',
            createHash('sha256').update(command.attempt.dispatch.launch_claim_id).digest('hex'),
            'current.json',
          ),
        ),
    },
    {
      id: 'owner-store-provenance',
      issue: 'NATIVE-EVIDENCE-OWNER-STORE-PROVENANCE',
      mutate: ({ entry }) => (entry.provenance.store = 'workspace-staged-evidence/v1'),
    },
  ];

  for (const row of cases) {
    const value = fixture();
    const root = mkdtempSync(join(tmpdir(), `ccm-native-verifier-r2-${row.id}-`));
    roots.push(root);
    const home = join(root, 'home');
    const boardPath = join(root, 'native.board.json');
    mkdirSync(home, { recursive: true, mode: 0o700 });
    writeFileSync(boardPath, `${JSON.stringify(value.initial_board, null, 2)}\n`);
    const command = clone(value.commands.create);
    installAdmission(home, command);
    const created = invoke(boardPath, home, command);
    assert.equal(created.code, 0, created.err.join('\n'));
    const installed = installBindEvidence(home, boardPath, value, row.mutate);
    row.afterInstall?.({ ...installed, home, command });

    const beforeBoard = readFileSync(boardPath, 'utf8');
    const consumptionRoot = join(home, 'native-attempt', 'v1', 'evidence', 'consumptions');
    const result = bind(boardPath, home, value.commands.bind);
    assert.notEqual(result.code, 0, `${row.id}: verifier accepted the mutation`);
    assert.match(result.err.join('\n'), new RegExp(row.issue), `${row.id}: wrong issue`);
    assert.equal(readFileSync(boardPath, 'utf8'), beforeBoard, `${row.id}: board changed`);
    assert.equal(existsSync(consumptionRoot), false, `${row.id}: consumption was staged`);
  }
});
