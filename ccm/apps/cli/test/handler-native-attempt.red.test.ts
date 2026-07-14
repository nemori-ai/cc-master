import assert from 'node:assert/strict';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalJson, canonicalSha256Digest } from '@ccm/engine';
import * as io from '../src/io.js';
import { verifyProductionNativeEvidence } from '../src/native-attempt-evidence-verifier.js';
import { REGISTRY } from '../src/registry.js';
import { run } from '../src/router.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(
  HERE,
  '..',
  '..',
  '..',
  'packages',
  'engine',
  'test',
  'fixtures',
  'native-attempt',
  'codex-api-tool-v1.json',
);
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as any;
const EXIT = io.EXIT;
const PLANNED_VERBS = [
  'native-attempt-create',
  'native-attempt-bind',
  'native-attempt-cancel',
  'native-attempt-terminal',
  'native-attempt-reconcile',
] as const;
const TMP: string[] = [];
const AUTH_BY_BOARD = new Map<string, PrivateEvidenceHarness>();
const TEST_PRODUCER = {
  producer_id: 'producer:fixture-ccm-owner-ledger',
  channel: 'ccm-private-adapter/v1',
  registration_ref: 'private-producer-registration:fixture-ccm-owner-ledger',
};
const TEST_PUBLIC_KEY_SPKI_BASE64 = 'MCowBQYDK2VwAyEAXTZkXHsB1rueJ/NMogh6+47lNPsO99E6t9oeBrZ1570=';
const TEST_PRIVATE_KEY_PKCS8_BASE64 =
  'MC4CAQAwBQYDK2VwBCIEIHFY/VRFI436flUO+7PW7tKXhxZhTsySt/IGubIUYL2g';

afterEach(() => {
  for (const path of TMP.splice(0)) rmSync(path, { recursive: true, force: true });
  AUTH_BY_BOARD.clear();
});

function clone<T>(value: T): T {
  return structuredClone(value);
}

function canonicalSignedRecord(record: any): any {
  if (record.schema !== 'ccm/native-evidence-record/v1') {
    // The frozen bind vectors predate the generic record envelope. Keep their exact
    // independently signed canonical form while sending them through the same verifier.
    return {
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
  }
  return {
    schema: record.schema,
    record_id: record.record_id,
    evidence_class: record.evidence_class,
    producer: {
      producer_id: record.producer.producer_id,
      channel: record.producer.channel,
      registration_ref: record.producer.registration_ref,
    },
    create_link: record.create_link,
    expected: record.expected,
    observed: record.observed,
    asserted_record_hash: record.asserted_record_hash,
    payload: record.payload,
  };
}

function canonicalRecordHash(record: any): string {
  return canonicalSha256Digest(canonicalSignedRecord(record));
}

function authFailure(code: string): any {
  return { ok: false, issues: [{ code }] };
}

class PrivateEvidenceHarness {
  readonly trace: string[] = [];
  readonly records = new Map<string, any>();
  readonly registrations = new Map<string, any>();
  readonly claims = new Map<string, string>();
  readonly reservations = new Map<string, any>();
  readonly consumed = new Map<string, string>();
  readonly rollbacks: Array<{ transaction_id: string; reason: string }> = [];
  readonly commits: Array<{
    transaction_id: string;
    board_path: string;
    board_content_hash: string;
  }> = [];
  authenticateBindCalls = 0;
  stageCalls = 0;
  failWrite = false;
  failAfterReservationCode: string | null = null;
  private nextTransaction = 1;
  createAdmission: any;
  controlAuthority: any;

  constructor() {
    for (const [ref, registration] of Object.entries(
      fixture.private_evidence.producer_registrations,
    )) {
      const copy = clone(registration) as any;
      copy.trust_scope = {
        ...copy.trust_scope,
        contract: fixture.contract,
        harness: 'codex',
        adapter: 'codex/api-tool-multi-agent-v1',
        surface: fixture.commands.create.attempt.surface,
      };
      this.registrations.set(ref, copy);
    }
    const publicKeyBytes = Buffer.from(TEST_PUBLIC_KEY_SPKI_BASE64, 'base64');
    this.registrations.set(TEST_PRODUCER.registration_ref, {
      schema: 'ccm/native-evidence-producer/codex-api-tool/v1',
      ...TEST_PRODUCER,
      public_key_id: 'ed25519:fixture-ccm-owner-ledger',
      public_key_spki_base64: TEST_PUBLIC_KEY_SPKI_BASE64,
      public_key_fingerprint: `sha256:${createHash('sha256').update(publicKeyBytes).digest('hex')}`,
      revoked: false,
      trust_scope: {
        contract: fixture.contract,
        origin: 'codex',
        harness: 'codex',
        adapter: 'codex/api-tool-multi-agent-v1',
        surface: fixture.commands.create.attempt.surface,
        transport: fixture.commands.create.attempt.transport,
        origin_session_ref: fixture.lineage.origin_session_ref,
      },
    });
    for (const [ref, entry] of Object.entries(fixture.private_evidence.owner_store.records)) {
      this.installOwnerEntry(ref, clone(entry));
    }
    for (const [claim, recordHash] of Object.entries(fixture.private_evidence.launch_claims)) {
      if (recordHash) this.claims.set(claim, String(recordHash));
    }
    this.createAdmission = clone(fixture.commands.create.admission_snapshot);
    this.controlAuthority = clone(fixture.commands.cancel.authority_snapshot);
  }

  installVector(vector: any): void {
    this.installOwnerEntry(vector.record_ref, clone(vector.owner_store_entry), vector.issue);
    if (vector.claim_prebound_record_hash) {
      this.claims.set(
        vector.owner_store_entry.record.create_link.launch_claim_id,
        vector.claim_prebound_record_hash,
      );
    }
  }

  private installOwnerEntry(recordRef: string, sourceEntry: any, issue?: string): void {
    const base = clone(
      fixture.private_evidence.owner_store.records['evidence:fixture-bind-001'].record,
    );
    const incoming = clone(sourceEntry.record ?? {});
    const incomingObserved = incoming.observed ?? {};
    const entry = {
      provenance: clone(sourceEntry.provenance),
      fact_resolution: clone(sourceEntry.fact_resolution),
      record: {
        schema: 'ccm/native-handle-evidence-record/codex-api-tool/v1',
        record_id: recordRef,
        record_hash: '',
        producer: { ...TEST_PRODUCER, signature: '' },
        create_link: {
          task_id: incoming.create_link?.task_id ?? base.create_link.task_id,
          attempt_id: incoming.create_link?.attempt_id ?? base.create_link.attempt_id,
          candidate_id: incoming.create_link?.candidate_id ?? base.create_link.candidate_id,
          dispatch_key:
            issue === 'NATIVE-EVIDENCE-CREATE-LINK-MISMATCH'
              ? incoming.create_link?.dispatch_key
              : fixture.commands.create.attempt.dispatch.key,
          input_hash: fixture.commands.create.attempt.dispatch.input_hash,
          request_hash: incoming.create_link?.request_hash ?? base.create_link.request_hash,
          launch_claim_id:
            incoming.create_link?.launch_claim_id ?? base.create_link.launch_claim_id,
          reservation_id: fixture.commands.create.launch_authority.reservation.reservation_id,
          ticket_digest: fixture.commands.create.launch_authority.ticket_digest,
          launch_identity_digest:
            fixture.commands.create.launch_authority.canonical_identity_digest,
        },
        expected: {
          transport: incoming.expected?.transport ?? base.expected.transport,
          parent_target: incoming.expected?.parent_target ?? base.expected.parent_target,
          child_target: incoming.expected?.child_target ?? base.expected.child_target,
        },
        observed: {
          handle_kind: incomingObserved.handle_kind ?? base.observed.handle_kind,
          handle: incomingObserved.handle ?? base.observed.handle,
          canonical_target: incomingObserved.canonical_target ?? base.observed.canonical_target,
          spawn: clone(incomingObserved.spawn ?? base.observed.spawn),
          roster: clone(incomingObserved.roster ?? base.observed.roster),
          current_lineage: clone(incomingObserved.current_lineage ?? base.observed.current_lineage),
        },
      },
    };
    const record = entry.record as any;
    if (Object.hasOwn(incoming, 'verified_by_ccm')) {
      record.verified_by_ccm = incoming.verified_by_ccm;
    }
    if (issue === 'NATIVE-HANDLE-MISSING') record.observed.handle = '';
    if (issue === 'NATIVE-HANDLE-UNATTESTED') {
      record.observed.roster.owner_record_ref = '';
    }
    if (issue === 'NATIVE-EVIDENCE-REGISTRATION-UNKNOWN') {
      record.producer.registration_ref = 'private-producer-registration:unknown';
    }
    if (issue === 'NATIVE-EVIDENCE-TRUST-SCOPE-MISMATCH') {
      this.registrations.get(TEST_PRODUCER.registration_ref).trust_scope.origin_session_ref =
        'session-ref:other-origin';
    }
    this.records.set(recordRef, entry);
    this.resignRecord(recordRef);
    if (issue === 'NATIVE-EVIDENCE-SIGNATURE-INVALID') {
      record.producer.signature = `ed25519:${Buffer.alloc(64, 7).toString('base64')}`;
    }
    if (issue === 'NATIVE-EVIDENCE-CANONICAL-HASH-MISMATCH') {
      record.record_hash =
        'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    }
  }

  installNonHandle(evidence: any, createHash: string): void {
    const evidenceClass = evidence.evidence_record_ref ? 'terminal' : 'reconcile';
    const recordRef = evidence.evidence_record_ref ?? evidence.record_id;
    const bindRecord = this.records.get('evidence:fixture-bind-001')?.record;
    assert.ok(bindRecord, 'authoritative bind owner record missing');
    const authoritativeTarget = bindRecord.observed.canonical_target;
    const targetRequired =
      evidenceClass === 'terminal' ||
      evidence.classification === 'running' ||
      evidence.classification === 'terminal';
    const observed: any = {
      descriptor: {
        origin: 'codex',
        harness: 'codex',
        adapter: 'codex/api-tool-multi-agent-v1',
        surface: fixture.commands.create.attempt.surface,
        transport: fixture.commands.create.attempt.transport,
      },
      target: targetRequired ? authoritativeTarget : null,
      source: evidenceClass === 'terminal' ? evidence.source : evidence.producer_channel,
      current_lineage: clone(evidence.current_lineage ?? bindRecord.observed.current_lineage),
    };
    if (evidence.classification === 'running') {
      observed.handle = bindRecord.observed.handle;
      observed.handle_kind = bindRecord.observed.handle_kind;
      observed.spawn = { ...clone(bindRecord.observed.spawn), target: authoritativeTarget };
      observed.roster = {
        ...clone(bindRecord.observed.roster),
        target: authoritativeTarget,
        observed_at: evidence.observed_at,
      };
    }
    let payload: any;
    if (evidenceClass === 'terminal') {
      const {
        evidence_record_ref: _ref,
        evidence_hash: _hash,
        source: _source,
        ...terminal
      } = evidence;
      payload = terminal;
    } else {
      const {
        record_id: _id,
        record_hash: _hash,
        producer_channel: _channel,
        current_lineage: _lineage,
        ...reconcile
      } = evidence;
      payload = reconcile;
    }
    const record = {
      schema: 'ccm/native-evidence-record/v1',
      record_id: recordRef,
      evidence_class: evidenceClass,
      record_hash: '',
      producer: { ...TEST_PRODUCER, signature: '' },
      create_link: {
        task_id: fixture.commands.create.task_id,
        attempt_id: fixture.commands.create.attempt.id,
        candidate_id: fixture.commands.create.attempt.candidate_id,
        dispatch_key: fixture.commands.create.attempt.dispatch.key,
        input_hash: fixture.commands.create.attempt.dispatch.input_hash,
        request_hash: fixture.commands.create.attempt.dispatch.request_hash,
        launch_claim_id: fixture.commands.create.attempt.dispatch.launch_claim_id,
        reservation_id: fixture.commands.create.launch_authority.reservation.reservation_id,
        ticket_digest: fixture.commands.create.launch_authority.ticket_digest,
        launch_identity_digest: fixture.commands.create.launch_authority.canonical_identity_digest,
        create_hash: createHash,
      },
      expected: {
        contract: fixture.contract,
        descriptor: clone(observed.descriptor),
        child_target: fixture.lineage.expected_child_target,
      },
      observed,
      // Preserve the producer's immutable source assertion inside the signed record. It is
      // intentionally not projected into payload, but makes a conflicting source replay hash-drift.
      asserted_record_hash: evidence.evidence_hash ?? evidence.record_hash,
      payload,
    };
    this.records.set(recordRef, {
      provenance: {
        store: 'ccm-owner-evidence/v1',
        owner_home_ref: fixture.private_evidence.configured_owner_home_ref,
        visibility: 'owner-only',
        record_ref: recordRef,
      },
      fact_resolution: {
        account: 'current',
        permission_profile: 'compatible',
        permission_denies: 'compatible',
      },
      record,
    });
    this.resignRecord(recordRef);
  }

  resignRecord(recordRef: string): void {
    const record = this.records.get(recordRef)?.record;
    assert.ok(record, `cannot sign missing owner record ${recordRef}`);
    record.record_hash = canonicalRecordHash(record);
    const privateKey = createPrivateKey({
      key: Buffer.from(TEST_PRIVATE_KEY_PKCS8_BASE64, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
    record.producer.signature = `ed25519:${sign(
      null,
      Buffer.from(record.record_hash),
      privateKey,
    ).toString('base64')}`;
  }

  stageAndVerify = (input: any): any => {
    this.stageCalls += 1;
    const evidenceClass = input?.evidence_class;
    if (evidenceClass === 'bind') this.authenticateBindCalls += 1;
    const recordRef = input?.record_ref;
    const expected = input?.expected;
    const authenticated = verifyProductionNativeEvidence({
      evidence_class: evidenceClass,
      record_ref: recordRef,
      expected,
      store: {
        ownerHomeRef: fixture.private_evidence.configured_owner_home_ref,
        resolveRecord: (ref) => this.records.get(ref),
        resolveRegistration: (ref) => this.registrations.get(ref),
        resolveLaunchClaim: (claimId) =>
          this.claims.get(claimId) === expected.launch_identity_digest
            ? {
                schema: 'ccm/native-launch-claim/v1',
                claim_id: claimId,
                canonical_identity_digest: expected.launch_identity_digest,
                ticket_digest: expected.ticket_digest,
                reservation_id: expected.reservation_id,
              }
            : undefined,
      },
    });
    this.trace.splice(0, this.trace.length, ...authenticated.trace);
    if (!authenticated.ok) return authenticated;
    const verifiedEvidence = authenticated.verified_evidence;
    const recordHash = verifiedEvidence.record_hash;
    const identity = canonicalJson({
      evidence_class: evidenceClass,
      record_ref: recordRef,
      record_hash: recordHash,
      scope: verifiedEvidence.scope,
    });
    const consumeKey = `${evidenceClass}:${recordRef}`;
    const consumedIdentity = this.consumed.get(consumeKey);
    if (consumedIdentity && consumedIdentity !== identity) {
      return authFailure(
        evidenceClass === 'reconcile'
          ? 'NATIVE-RECONCILE-CONFLICT'
          : evidenceClass === 'terminal'
            ? 'NATIVE-ATTEMPT-REPLAY-CONFLICT'
            : 'NATIVE-EVIDENCE-CLAIM-REUSED',
      );
    }
    const transactionId = `evidence-tx-${this.nextTransaction++}`;
    this.reservations.set(transactionId, {
      consumeKey,
      identity,
      claim: undefined,
      recordHash,
      verifiedEvidence,
    });
    this.trace.push('stage');
    if (this.failAfterReservationCode) {
      return {
        ok: false,
        transaction_id: transactionId,
        issues: [{ code: this.failAfterReservationCode }],
      };
    }
    return { ok: true, transaction_id: transactionId, verified_evidence: verifiedEvidence };
  };

  commit = (input: any): void => {
    const reservation = this.reservations.get(input.transaction_id);
    assert.ok(reservation, `unknown evidence transaction ${input.transaction_id}`);
    assert.match(input.board_content_hash, /^sha256:[a-f0-9]{64}$/);
    const persisted = readFileSync(input.board_path, 'utf8');
    assert.equal(
      `sha256:${createHash('sha256').update(persisted).digest('hex')}`,
      input.board_content_hash,
      'evidence commit must name the durable board bytes',
    );
    this.trace.push('commit');
    if (reservation.kind === 'launch') {
      this.claims.set(reservation.claim, reservation.identity);
    } else {
      this.consumed.set(reservation.consumeKey, reservation.identity);
    }
    this.reservations.delete(input.transaction_id);
    this.commits.push(clone(input));
  };

  rollback = (input: any): void => {
    assert.ok(this.reservations.has(input.transaction_id));
    this.trace.push('rollback');
    this.reservations.delete(input.transaction_id);
    this.rollbacks.push(clone(input));
  };

  resolveCreateAdmission = (): any => {
    this.trace.length = 0;
    this.trace.push('create-admission');
    return clone(this.createAdmission);
  };

  stageCreate = (input: any): any => {
    this.trace.length = 0;
    this.trace.push('create-admission');
    const template =
      input.attempt?.id === fixture.commands.create_second_after_orphan_audit.attempt.id
        ? fixture.commands.create_second_after_orphan_audit
        : fixture.commands.create;
    const authority = clone(template.launch_authority);
    const claim = String(authority.claim_id);
    const identity = String(authority.canonical_identity_digest);
    const existing = this.claims.get(claim);
    if (existing && existing !== identity) {
      return authFailure('NATIVE-LAUNCH-CLAIM-REUSED');
    }
    const transactionId = `launch-tx-${this.nextTransaction++}`;
    this.reservations.set(transactionId, {
      kind: 'launch',
      claim,
      identity,
      admissionSnapshot: clone(
        template === fixture.commands.create ? this.createAdmission : template.admission_snapshot,
      ),
      launchAuthority: authority,
    });
    return {
      ok: true,
      transaction_id: transactionId,
      admission_snapshot: clone(
        template === fixture.commands.create ? this.createAdmission : template.admission_snapshot,
      ),
      launch_authority: authority,
    };
  };

  resolveControlAuthority = (): any => {
    this.trace.length = 0;
    this.trace.push('control-authority');
    return clone(this.controlAuthority);
  };
}

function boardFile(): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), 'ccm-native-attempt-red-'));
  TMP.push(root);
  const path = join(root, 'native.board.json');
  writeFileSync(path, `${JSON.stringify(fixture.initial_board, null, 2)}\n`);
  AUTH_BY_BOARD.set(path, new PrivateEvidenceHarness());
  return { root, path };
}

function readBoard(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function task(path: string): any {
  return readBoard(path).tasks.find((entry: any) => entry.id === 'T-native-v1');
}

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(path: string, argv: string[]): CliResult {
  const out: string[] = [];
  const err: string[] = [];
  const auth = AUTH_BY_BOARD.get(path);
  assert.ok(auth, `missing private evidence harness for ${path}`);
  const result = run(argv.concat(['--board', path, '--json']), {
    out: (value: string) => out.push(value),
    err: (value: string) => err.push(value),
    env: {
      CC_MASTER_HARNESS: 'codex',
      CODEX_SESSION_ID: 'session-ref:fixture-origin',
      CLAUDE_CONFIG_DIR: dirname(path),
    },
    nativeAttemptPrivateEvidence: {
      schema: 'ccm/native-private-evidence-authentication/v1',
      channel: 'ccm-private-adapter/v1',
      stageAndVerify: auth.stageAndVerify,
      commit: auth.commit,
      rollback: auth.rollback,
    },
    nativeAttemptAdmission: {
      stageCreate: auth.stageCreate,
      commit: auth.commit,
      rollback: auth.rollback,
      resolveControl: auth.resolveControlAuthority,
    },
    writeFileAtomicSync: (boardPath: string, content: string) => {
      auth.trace.push('write');
      if (auth.failWrite) {
        const error = new Error(
          'injected native attempt board write failure',
        ) as NodeJS.ErrnoException;
        error.code = 'EIO';
        throw error;
      }
      io.writeFileAtomicSync(boardPath, content);
    },
  } as any);
  assert.equal(typeof result, 'number', 'native-attempt fixture endpoints must remain synchronous');
  return { code: result as number, stdout: out.join('\n'), stderr: err.join('\n') };
}

function argsFor(command: any): string[] {
  switch (command.type) {
    case 'create':
      return [
        'task',
        'native-attempt-create',
        command.task_id,
        '--selection',
        JSON.stringify(command.selection_snapshot),
        '--attempt',
        JSON.stringify(command.attempt),
        '--replay-intent',
        command.replay_intent,
      ];
    case 'bind':
      return [
        'task',
        'native-attempt-bind',
        command.task_id,
        '--attempt-id',
        command.attempt_id,
        '--evidence-record-ref',
        command.evidence_record_ref ?? 'evidence:missing',
      ];
    case 'cancel': {
      const args = [
        'task',
        'native-attempt-cancel',
        command.task_id,
        '--attempt-id',
        command.attempt_id,
        '--request',
        JSON.stringify(command.request),
      ];
      if (command.acknowledgement_terminal_class) {
        args.push('--acknowledgement-terminal-class', command.acknowledgement_terminal_class);
      }
      return args;
    }
    case 'terminal': {
      const args = [
        'task',
        'native-attempt-terminal',
        command.task_id,
        '--attempt-id',
        command.attempt_id,
        '--evidence-record-ref',
        command.evidence.evidence_record_ref,
      ];
      if (command.requested_task_status)
        args.push('--requested-task-status', command.requested_task_status);
      return args;
    }
    case 'reconcile':
      return [
        'task',
        'native-attempt-reconcile',
        command.task_id,
        '--attempt-id',
        command.attempt_id,
        '--evidence-record-ref',
        command.evidence.record_id,
      ];
    case 'route-bind':
      return [
        'task',
        'route-bind',
        command.task_id,
        '--selection',
        JSON.stringify(fixture.selection_snapshot),
        '--attempt',
        JSON.stringify({
          ...command.attempt,
          started_at: '2026-07-13T08:00:01Z',
          requested: { model: 'host-default', effort: 'medium' },
        }),
      ];
    default:
      throw new Error(`unknown command type ${command.type}`);
  }
}

function runOperation(path: string, command: any): CliResult {
  const auth = AUTH_BY_BOARD.get(path);
  assert.ok(auth);
  if (command.type === 'create') auth.createAdmission = clone(command.admission_snapshot);
  if (command.type === 'cancel') auth.controlAuthority = clone(command.authority_snapshot);
  if (command.type === 'terminal' || command.type === 'reconcile') {
    const attempt = task(path)?.routing?.attempts?.find(
      (entry: any) => entry.id === command.attempt_id,
    );
    assert.match(attempt?.create_hash, /^sha256:[a-f0-9]{64}$/);
    auth.installNonHandle(command.evidence, attempt.create_hash);
  }
  return runCli(path, argsFor(command));
}

function installCommandEvidence(path: string, command: any): any {
  const auth = AUTH_BY_BOARD.get(path);
  assert.ok(auth);
  const attempt = task(path)?.routing?.attempts?.find(
    (entry: any) => entry.id === command.attempt_id,
  );
  assert.match(attempt?.create_hash, /^sha256:[a-f0-9]{64}$/);
  auth.installNonHandle(command.evidence, attempt.create_hash);
  return auth.records.get(command.evidence.evidence_record_ref ?? command.evidence.record_id);
}

function assertOk(result: CliResult, label: string): void {
  assert.equal(result.code, EXIT.OK, `${label}: ${result.stderr || result.stdout}`);
}

function consumedSnapshot(auth: PrivateEvidenceHarness): string {
  return canonicalJson({
    claims: [...auth.claims.entries()].sort(),
    consumed: [...auth.consumed.entries()].sort(),
  });
}

function assertTransactionOrder(auth: PrivateEvidenceHarness, label: string): void {
  const stage = auth.trace.lastIndexOf('stage');
  const write = auth.trace.lastIndexOf('write');
  const commit = auth.trace.lastIndexOf('commit');
  assert.ok(stage >= 0, `${label}: stage missing`);
  assert.ok(write > stage, `${label}: write must follow stage`);
  assert.ok(commit > write, `${label}: commit must follow durable write`);
  assert.equal(auth.reservations.size, 0, `${label}: reservation leaked`);
}

function applyCheckpoint(path: string, name: string): void {
  if (name === 'initial') return;
  assertOk(runOperation(path, fixture.commands.create), `${name}: create setup`);
  if (name === 'created') return;
  if (name === 'starting-uncertain') {
    assertOk(runOperation(path, fixture.commands.reconcile_uncertain), `${name}: uncertain setup`);
    return;
  }
  assertOk(runOperation(path, fixture.commands.bind), `${name}: bind setup`);
  if (name === 'running') return;
  if (name === 'cancelled-requested') {
    assertOk(runOperation(path, fixture.commands.cancel), `${name}: cancel setup`);
    return;
  }
  if (name === 'terminal') {
    assertOk(runOperation(path, fixture.commands.terminal), `${name}: terminal setup`);
    return;
  }
  assertOk(runOperation(path, fixture.commands.reconcile_uncertain), `${name}: uncertain setup`);
  if (name === 'uncertain') return;
  if (name === 'orphaned') {
    assertOk(runOperation(path, fixture.commands.reconcile_orphaned), `${name}: orphan setup`);
    return;
  }
  throw new Error(`unknown checkpoint ${name}`);
}

function setJsonPointer(target: any, mutation: any): void {
  if (mutation.op === 'none') return;
  const parts = String(mutation.path).split('/').slice(1);
  const key = parts.pop();
  assert.ok(key);
  let parent = target;
  for (const part of parts) parent = parent[part];
  if (mutation.op === 'remove') {
    delete parent[key];
  } else {
    parent[key] = clone(mutation.value);
  }
}

interface RouterSchemaMutation {
  name: string;
  mutate: (value: any) => void;
}

const ROUTER_CREATE_SCHEMA_MUTATIONS: RouterSchemaMutation[] = [
  { name: 'attempt id', mutate: (value) => (value.id = '') },
  { name: 'ordinal', mutate: (value) => (value.ordinal = 999) },
  { name: 'created_at', mutate: (value) => (value.created_at = 'not-a-time') },
  { name: 'dispatch object', mutate: (value) => (value.dispatch = {}) },
  { name: 'dispatch key', mutate: (value) => (value.dispatch.key = '') },
  { name: 'request hash', mutate: (value) => (value.dispatch.request_hash = 'sha256:x') },
  { name: 'launch claim id', mutate: (value) => (value.dispatch.launch_claim_id = '') },
  {
    name: 'claim owner session ref',
    mutate: (value) => (value.dispatch.claim_owner_session_ref = ''),
  },
  { name: 'lineage', mutate: (value) => (value.lineage = {}) },
  { name: 'baseline commit', mutate: (value) => (value.lineage.baseline_commit = 'x') },
  { name: 'selection snapshot', mutate: (value) => (value.selection_snapshot = {}) },
  { name: 'handle binding', mutate: (value) => (value.handle_binding = {}) },
  { name: 'cancel', mutate: (value) => (value.cancel = {}) },
  { name: 'terminal', mutate: (value) => (value.terminal = {}) },
  { name: 'reconciliation', mutate: (value) => (value.reconciliation = [{}]) },
];

const ROUTER_CANCEL_SCHEMA_MUTATIONS: RouterSchemaMutation[] = [
  {
    name: 'request object',
    mutate: (value) => {
      for (const key of Object.keys(value)) delete value[key];
    },
  },
  { name: 'request id', mutate: (value) => (value.id = '') },
  { name: 'request hash', mutate: (value) => (value.request_hash = 'sha256:x') },
  { name: 'requested_at', mutate: (value) => (value.requested_at = 'not-a-time') },
  {
    name: 'requested by session ref',
    mutate: (value) => (value.requested_by_session_ref = ''),
  },
  { name: 'control', mutate: (value) => (value.control = 'interrupt-current-turn') },
  { name: 'reason code', mutate: (value) => (value.reason_code = '') },
  { name: 'unknown field', mutate: (value) => (value.caller_verified = true) },
];

test('CLI registers dedicated verbs without promoting the synthetic Codex probe', () => {
  for (const verb of PLANNED_VERBS) {
    assert.ok(REGISTRY.task?.[verb], `${verb} must cross the real router after implementation`);
  }
});

test('registry-only counterfeit verbs fail at the real router and write no board bytes', () => {
  const { path } = boardFile();
  const before = readFileSync(path, 'utf8');
  const taskRegistry = REGISTRY.task as any;
  const previous = new Map<string, unknown>();
  try {
    for (const verb of PLANNED_VERBS) {
      previous.set(verb, taskRegistry[verb]);
      taskRegistry[verb] = {
        summary: 'counterfeit registry-only native attempt verb',
        read: false,
        positionals: [{ name: 'id', required: true }],
        options: {},
        examples: [],
        handler: `task.${verb.replaceAll('-', '_')}`,
      };
      const result = runCli(path, ['task', verb, 'T-native-v1']);
      assert.equal(result.code, EXIT.ERROR, `${verb} registry-only counterfeit must fail`);
      assert.match(result.stderr, /handler .* is not a function/);
      assert.equal(readFileSync(path, 'utf8'), before, `${verb} registry-only path wrote board`);
    }
  } finally {
    for (const verb of PLANNED_VERBS) {
      const old = previous.get(verb);
      if (old === undefined) delete taskRegistry[verb];
      else taskRegistry[verb] = old;
    }
  }
});

test('create/bind/cancel/terminal CLI handlers execute and exact replay is a no-op', () => {
  const { path } = boardFile();
  const created = runOperation(path, fixture.commands.create);
  assertOk(created, 'create');
  assert.equal(task(path).status, 'ready');
  assert.equal(task(path).handle ?? null, null);
  assert.equal(task(path).routing.attempts[0].state, 'starting');
  assert.deepEqual(task(path).routing.attempts[0].selection_snapshot, fixture.selection_snapshot);

  const beforeCreateReplay = readFileSync(path, 'utf8');
  const createReplay = runOperation(path, fixture.commands.create);
  assertOk(createReplay, 'create exact replay');
  assert.match(createReplay.stdout, /"launch_allowed"\s*:\s*false/);
  assert.equal(readFileSync(path, 'utf8'), beforeCreateReplay);

  const bound = runOperation(path, fixture.commands.bind);
  assertOk(bound, 'bind');
  const auth = AUTH_BY_BOARD.get(path);
  assert.ok(auth);
  assert.equal(auth.authenticateBindCalls, 1);
  assertTransactionOrder(auth, 'bind');
  for (const check of [
    'expected-attempt-context',
    'owner-store-provenance',
    'canonical-hash',
    'producer-registration',
    'producer-key-integrity',
    'signature',
    'producer-trust-scope',
    'one-shot-claim',
  ]) {
    assert.ok(auth.trace.includes(check), `positive bind skipped ${check}`);
  }
  assert.equal(
    auth.claims.get(fixture.commands.create.attempt.dispatch.launch_claim_id),
    fixture.commands.create.launch_authority.canonical_identity_digest,
  );
  assert.equal(task(path).status, 'in_flight');
  assert.equal(task(path).handle, 'agent-fixture-001');
  const beforeBindReplay = readFileSync(path, 'utf8');
  assertOk(runOperation(path, fixture.commands.bind), 'bind exact replay');
  assert.equal(auth.authenticateBindCalls, 2, 'exact replay must re-authenticate the same record');
  assert.ok(auth.trace.includes('one-shot-claim'));
  assert.equal(readFileSync(path, 'utf8'), beforeBindReplay);

  const cancel = runOperation(path, fixture.commands.cancel);
  assertOk(cancel, 'cancel');
  assert.match(cancel.stdout, /"host_control_effects"\s*:\s*1/);
  const beforeCancelReplay = readFileSync(path, 'utf8');
  const cancelReplay = runOperation(path, fixture.commands.cancel);
  assertOk(cancelReplay, 'cancel exact replay');
  assert.match(cancelReplay.stdout, /"host_control_effects"\s*:\s*0/);
  assert.equal(readFileSync(path, 'utf8'), beforeCancelReplay);

  assertOk(runOperation(path, fixture.commands.terminal), 'terminal');
  assertTransactionOrder(auth, 'terminal');
  assert.equal(task(path).status, 'uncertain');
  assert.equal(task(path).handle ?? null, null);
  assert.notEqual(task(path).status, 'done');
  assert.notEqual(task(path).verified, true);
  const beforeTerminalReplay = readFileSync(path, 'utf8');
  assertOk(runOperation(path, fixture.commands.terminal), 'terminal exact replay');
  assert.equal(readFileSync(path, 'utf8'), beforeTerminalReplay);
});

test('real bind exact replay remains a committed no-op after terminal progression', () => {
  const { path } = boardFile();
  applyCheckpoint(path, 'terminal');
  const auth = AUTH_BY_BOARD.get(path);
  assert.ok(auth);
  const beforeBytes = readFileSync(path, 'utf8');
  const beforeConsumption = consumedSnapshot(auth);
  const commitsBefore = auth.commits.length;
  const rollbacksBefore = auth.rollbacks.length;

  const replay = runOperation(path, fixture.commands.bind);

  assertOk(replay, 'post-terminal bind exact replay');
  assert.match(replay.stdout, /"bound"\s*:\s*false/);
  assert.equal(readFileSync(path, 'utf8'), beforeBytes, 'bind replay rewrote terminal history');
  assert.equal(consumedSnapshot(auth), beforeConsumption, 'bind replay changed claim identity');
  assert.equal(auth.commits.length, commitsBefore + 1, 'authenticated replay was not committed');
  assert.equal(auth.rollbacks.length, rollbacksBefore, 'authenticated replay rolled back');
  assertTransactionOrder(auth, 'post-terminal bind exact replay');
});

test('real create and cancel authority reject foreign current lineage before launch or control', () => {
  const lineageDrifts: Array<[string, (lineage: any) => void]> = [
    ['origin session', (lineage) => (lineage.origin_session_ref = 'session-ref:foreign')],
    ['workspace', (lineage) => (lineage.workspace_ref = 'workspace-ref:foreign')],
    ['worktree', (lineage) => (lineage.worktree_ref = 'worktree-ref:foreign')],
    [
      'baseline',
      (lineage) => (lineage.baseline_commit = '9999999999999999999999999999999999999999'),
    ],
  ];

  for (const [name, mutate] of lineageDrifts) {
    const { path } = boardFile();
    const command = clone(fixture.commands.create);
    mutate(command.admission_snapshot.current_lineage);
    const before = readFileSync(path, 'utf8');
    const result = runOperation(path, command);
    assert.equal(result.code, EXIT.VALIDATION, `create/${name}: ${result.stderr}`);
    assert.match(result.stderr, /NATIVE-LINEAGE-MISMATCH/, `create/${name}`);
    assert.doesNotMatch(result.stdout, /"launch_allowed"\s*:\s*true/, `create/${name}`);
    assert.equal(readFileSync(path, 'utf8'), before, `create/${name}: board bytes changed`);
  }

  for (const [name, mutate] of lineageDrifts) {
    const { path } = boardFile();
    applyCheckpoint(path, 'running');
    const command = clone(fixture.commands.cancel);
    mutate(command.authority_snapshot.current_lineage);
    const before = readFileSync(path, 'utf8');
    const result = runOperation(path, command);
    assert.equal(result.code, EXIT.VALIDATION, `cancel/${name}: ${result.stderr}`);
    assert.match(result.stderr, /NATIVE-LINEAGE-MISMATCH/, `cancel/${name}`);
    assert.doesNotMatch(result.stdout, /"host_control_effects"/, `cancel/${name}`);
    assert.equal(readFileSync(path, 'utf8'), before, `cancel/${name}: board bytes changed`);
  }

  const unrelated = boardFile();
  applyCheckpoint(unrelated.path, 'running');
  const request = clone(fixture.commands.cancel);
  request.request.requested_by_session_ref = 'session-ref:unrelated-requester';
  const before = readFileSync(unrelated.path, 'utf8');
  const result = runOperation(unrelated.path, request);
  assert.equal(result.code, EXIT.VALIDATION, `cancel/unrelated requester: ${result.stderr}`);
  assert.match(result.stderr, /NATIVE-LINEAGE-MISMATCH/);
  assert.doesNotMatch(result.stdout, /"host_control_effects"/);
  assert.equal(readFileSync(unrelated.path, 'utf8'), before);
});

test('real create router rejects every frozen record boundary with force and no board write', () => {
  for (const row of ROUTER_CREATE_SCHEMA_MUTATIONS) {
    const { path } = boardFile();
    const auth = AUTH_BY_BOARD.get(path);
    assert.ok(auth);
    const command = clone(fixture.commands.create);
    row.mutate(command.attempt);
    if (row.name === 'selection snapshot') {
      command.selection_snapshot = clone(command.attempt.selection_snapshot);
    }
    auth.createAdmission = clone(command.admission_snapshot);
    const before = readFileSync(path, 'utf8');
    const result = runCli(path, [...argsFor(command), '--force']);
    assert.equal(result.code, EXIT.VALIDATION, `${row.name}: ${result.stderr || result.stdout}`);
    assert.doesNotMatch(result.stdout, /"launch_allowed"\s*:\s*true/, row.name);
    assert.equal(readFileSync(path, 'utf8'), before, `${row.name}: board bytes changed`);
  }
});

test('real cancel router rejects every frozen request boundary with force and no effect', () => {
  for (const row of ROUTER_CANCEL_SCHEMA_MUTATIONS) {
    const { path } = boardFile();
    applyCheckpoint(path, 'running');
    const command = clone(fixture.commands.cancel);
    row.mutate(command.request);
    const before = readFileSync(path, 'utf8');
    const result = runCli(path, [...argsFor(command), '--force']);
    assert.equal(result.code, EXIT.VALIDATION, `${row.name}: ${result.stderr || result.stdout}`);
    assert.doesNotMatch(result.stdout, /"host_control_effects"\s*:\s*1/, row.name);
    assert.equal(readFileSync(path, 'utf8'), before, `${row.name}: board bytes changed`);
  }
});

test('real router hard lint rejects a corrupt normalized producer binding even with force', () => {
  const { path } = boardFile();
  applyCheckpoint(path, 'running');
  const corrupt = readBoard(path);
  corrupt.tasks[0].routing.attempts[0].handle_binding.producer_id = '';
  writeFileSync(path, `${JSON.stringify(corrupt, null, 2)}\n`);
  const before = readFileSync(path, 'utf8');
  const result = runCli(path, [...argsFor(fixture.commands.cancel), '--force']);
  assert.equal(result.code, EXIT.VALIDATION, result.stderr || result.stdout);
  assert.match(result.stderr, /NATIVE-ATTEMPT-PROJECTION-MISMATCH|BIZ-NATIVE-ATTEMPT-PROJECTION/);
  assert.doesNotMatch(result.stdout, /"host_control_effects"\s*:\s*1/);
  assert.equal(readFileSync(path, 'utf8'), before);
});

test('real router rejects shape-valid starting lifecycle counterfeits before bind or interrupt', () => {
  const donors = [
    { name: 'cancel', checkpoint: 'cancelled-requested', field: 'cancel' },
    { name: 'handle binding', checkpoint: 'running', field: 'handle_binding' },
    { name: 'terminal', checkpoint: 'terminal', field: 'terminal' },
  ] as const;

  for (const row of donors) {
    const donor = boardFile();
    applyCheckpoint(donor.path, row.checkpoint);
    const validRecord = clone(task(donor.path).routing.attempts[0][row.field]);

    const target = boardFile();
    applyCheckpoint(target.path, 'created');
    const corrupt = readBoard(target.path);
    corrupt.tasks[0].routing.attempts[0][row.field] = validRecord;
    writeFileSync(target.path, `${JSON.stringify(corrupt, null, 2)}\n`);
    const before = readFileSync(target.path, 'utf8');

    const bind = runCli(target.path, [...argsFor(fixture.commands.bind), '--force']);
    assert.equal(bind.code, EXIT.VALIDATION, `${row.name}: ${bind.stderr || bind.stdout}`);
    assert.match(
      bind.stderr,
      /NATIVE-ATTEMPT-PROJECTION-MISMATCH|BIZ-NATIVE-ATTEMPT-PROJECTION/,
      row.name,
    );
    assert.equal(readFileSync(target.path, 'utf8'), before, `${row.name}: bind changed bytes`);

    if (row.field === 'cancel') {
      const interrupt = runCli(target.path, [...argsFor(fixture.commands.cancel), '--force']);
      assert.equal(
        interrupt.code,
        EXIT.VALIDATION,
        `preloaded cancel: ${interrupt.stderr || interrupt.stdout}`,
      );
      assert.doesNotMatch(interrupt.stdout, /"host_control_effects"\s*:\s*[01]/);
      assert.equal(readFileSync(target.path, 'utf8'), before, 'preloaded cancel changed bytes');
    }
  }

  const clean = boardFile();
  applyCheckpoint(clean.path, 'running');
  const firstRealCancel = runOperation(clean.path, fixture.commands.cancel);
  assertOk(firstRealCancel, 'first real cancel after a valid bind');
  assert.match(firstRealCancel.stdout, /"host_control_effects"\s*:\s*1/);
});

test('real router rejects synthetic or mismatched reconciliation history before mutation', () => {
  const donor = boardFile();
  applyCheckpoint(donor.path, 'orphaned');
  const validAudit = clone(task(donor.path).routing.attempts[0].orphan_audit);

  const synthetic = boardFile();
  applyCheckpoint(synthetic.path, 'created');
  const syntheticBoard = readBoard(synthetic.path);
  const syntheticAttempt = syntheticBoard.tasks[0].routing.attempts[0];
  syntheticAttempt.state = 'orphaned';
  syntheticAttempt.orphan_audit = validAudit;
  syntheticAttempt.reconciliation = [
    { classification: 'uncertain' },
    { classification: 'orphaned' },
  ];
  syntheticBoard.tasks[0].status = 'ready';
  delete syntheticBoard.tasks[0].handle;
  writeFileSync(synthetic.path, `${JSON.stringify(syntheticBoard, null, 2)}\n`);
  const beforeSynthetic = readFileSync(synthetic.path, 'utf8');

  const secondCreate = runCli(synthetic.path, [
    ...argsFor(fixture.commands.create_second_after_orphan_audit),
    '--force',
  ]);

  assert.equal(secondCreate.code, EXIT.VALIDATION, secondCreate.stderr || secondCreate.stdout);
  assert.match(
    secondCreate.stderr,
    /NATIVE-ATTEMPT-PROJECTION-MISMATCH|BIZ-NATIVE-ATTEMPT-PROJECTION/,
  );
  assert.doesNotMatch(secondCreate.stdout, /"launch_allowed"\s*:\s*true/);
  assert.equal(readFileSync(synthetic.path, 'utf8'), beforeSynthetic);

  const mutations: Array<[string, (record: any) => void]> = [
    ['missing evidence ref', (record) => delete record.evidence_record_ref],
    ['mismatched private source', (record) => (record.observed.source = 'caller-supplied')],
    [
      'mismatched lineage',
      (record) => (record.observed.current_lineage.worktree_ref = 'worktree-ref:forged'),
    ],
    [
      'mismatched orphan audit',
      (record) => (record.orphan_audit.audit_ref = 'owner-evidence://forged-audit'),
    ],
  ];
  for (const [name, mutate] of mutations) {
    const target = boardFile();
    applyCheckpoint(target.path, 'orphaned');
    const corrupt = readBoard(target.path);
    mutate(corrupt.tasks[0].routing.attempts[0].reconciliation.at(-1));
    writeFileSync(target.path, `${JSON.stringify(corrupt, null, 2)}\n`);
    const before = readFileSync(target.path, 'utf8');

    const result = runCli(target.path, [
      ...argsFor(fixture.commands.create_second_after_orphan_audit),
      '--force',
    ]);

    assert.equal(result.code, EXIT.VALIDATION, `${name}: ${result.stderr || result.stdout}`);
    assert.match(
      result.stderr,
      /NATIVE-ATTEMPT-PROJECTION-MISMATCH|BIZ-NATIVE-ATTEMPT-PROJECTION/,
      name,
    );
    assert.doesNotMatch(result.stdout, /"launch_allowed"\s*:\s*true/, name);
    assert.equal(readFileSync(target.path, 'utf8'), before, `${name}: board bytes changed`);
  }

  const reordered = boardFile();
  applyCheckpoint(reordered.path, 'orphaned');
  const reorderedBoard = readBoard(reordered.path);
  reorderedBoard.tasks[0].routing.attempts[0].reconciliation.reverse();
  writeFileSync(reordered.path, `${JSON.stringify(reorderedBoard, null, 2)}\n`);
  const beforeReordered = readFileSync(reordered.path, 'utf8');
  const reorderedResult = runCli(reordered.path, [
    ...argsFor(fixture.commands.create_second_after_orphan_audit),
    '--force',
  ]);
  assert.equal(reorderedResult.code, EXIT.VALIDATION, reorderedResult.stderr);
  assert.doesNotMatch(reorderedResult.stdout, /"launch_allowed"\s*:\s*true/);
  assert.equal(readFileSync(reordered.path, 'utf8'), beforeReordered);
});

test('bind, terminal, and reconcile cross one owner-record authentication stack', () => {
  for (const row of [
    { label: 'bind', checkpoint: 'created', command: fixture.commands.bind },
    { label: 'terminal', checkpoint: 'running', command: fixture.commands.terminal },
    {
      label: 'reconcile-running',
      checkpoint: 'uncertain',
      command: fixture.commands.reconcile_running,
    },
  ]) {
    const { path } = boardFile();
    applyCheckpoint(path, row.checkpoint);
    const auth = AUTH_BY_BOARD.get(path);
    assert.ok(auth);
    assertOk(runOperation(path, row.command), row.label);
    for (const check of [
      'expected-attempt-context',
      'owner-store-resolve',
      'evidence-class',
      'owner-store-provenance',
      'canonical-hash',
      'producer-registration',
      'producer-key-integrity',
      'signature',
      'producer-trust-scope',
      'content-linkage',
      'account-lineage',
      'permission-profile',
      'permission-denies',
    ]) {
      assert.ok(auth.trace.includes(check), `${row.label}: skipped ${check}`);
    }
    assertTransactionOrder(auth, row.label);
  }
});

test('terminal and reconcile reject signed owner-record authentication failures atomically', () => {
  const cases: Array<{
    id: string;
    issue: string;
    check: string;
    mutate: (auth: PrivateEvidenceHarness, entry: any) => void;
  }> = [
    {
      id: 'provenance',
      issue: 'NATIVE-EVIDENCE-OWNER-STORE-PROVENANCE',
      check: 'owner-store-provenance',
      mutate: (_auth: PrivateEvidenceHarness, entry: any) => {
        entry.provenance.store = 'workspace-staged-evidence/v1';
      },
    },
    {
      id: 'canonical-hash',
      issue: 'NATIVE-EVIDENCE-CANONICAL-HASH-MISMATCH',
      check: 'canonical-hash',
      mutate: (_auth: PrivateEvidenceHarness, entry: any) => {
        entry.record.payload.observed_at = '2026-07-13T09:09:09Z';
      },
    },
    {
      id: 'signature',
      issue: 'NATIVE-EVIDENCE-SIGNATURE-INVALID',
      check: 'signature',
      mutate: (_auth: PrivateEvidenceHarness, entry: any) => {
        entry.record.producer.signature = `ed25519:${Buffer.alloc(64, 7).toString('base64')}`;
      },
    },
    {
      id: 'registration',
      issue: 'NATIVE-EVIDENCE-REGISTRATION-UNKNOWN',
      check: 'producer-registration',
      mutate: (auth: PrivateEvidenceHarness) => {
        auth.registrations.delete(TEST_PRODUCER.registration_ref);
      },
    },
    {
      id: 'trust-scope',
      issue: 'NATIVE-EVIDENCE-TRUST-SCOPE-MISMATCH',
      check: 'producer-trust-scope',
      mutate: (auth: PrivateEvidenceHarness) => {
        auth.registrations.get(TEST_PRODUCER.registration_ref).trust_scope.surface =
          'workspace-json';
      },
    },
    {
      id: 'create-link',
      issue: 'NATIVE-EVIDENCE-CREATE-LINK-MISMATCH',
      check: 'content-linkage',
      mutate: (auth: PrivateEvidenceHarness, entry: any) => {
        entry.record.create_link.create_hash = `sha256:${'e'.repeat(64)}`;
        auth.resignRecord(entry.record.record_id);
      },
    },
    {
      id: 'descriptor-scope',
      issue: 'NATIVE-EVIDENCE-TRUST-SCOPE-MISMATCH',
      check: 'content-linkage',
      mutate: (auth: PrivateEvidenceHarness, entry: any) => {
        entry.record.expected.descriptor.adapter = 'codex/forged-adapter';
        auth.resignRecord(entry.record.record_id);
      },
    },
    {
      id: 'lineage',
      issue: 'NATIVE-LINEAGE-MISMATCH',
      check: 'content-linkage',
      mutate: (auth: PrivateEvidenceHarness, entry: any) => {
        entry.record.observed.current_lineage.worktree_ref = 'worktree-ref:forged';
        auth.resignRecord(entry.record.record_id);
      },
    },
    {
      id: 'target',
      issue: 'NATIVE-EXPECTED-CHILD-MISMATCH',
      check: 'content-linkage',
      mutate: (auth: PrivateEvidenceHarness, entry: any) => {
        entry.record.observed.target = '/root/fixture-parent/forged-worker';
        auth.resignRecord(entry.record.record_id);
      },
    },
    {
      id: 'evidence-class',
      issue: 'NATIVE-EVIDENCE-CLASS-UNSUPPORTED',
      check: 'evidence-class',
      mutate: (auth: PrivateEvidenceHarness, entry: any) => {
        entry.record.evidence_class = 'bind';
        auth.resignRecord(entry.record.record_id);
      },
    },
  ];
  for (const field of [
    'task_id',
    'attempt_id',
    'candidate_id',
    'dispatch_key',
    'request_hash',
    'launch_claim_id',
    'create_hash',
  ]) {
    cases.push({
      id: `create-link-${field}`,
      issue: 'NATIVE-EVIDENCE-CREATE-LINK-MISMATCH',
      check: 'content-linkage',
      mutate: (auth, entry) => {
        entry.record.create_link[field] = field.endsWith('hash')
          ? `sha256:${'9'.repeat(64)}`
          : `forged-${field}`;
        auth.resignRecord(entry.record.record_id);
      },
    });
  }
  for (const field of ['origin', 'harness', 'adapter', 'surface', 'transport']) {
    cases.push({
      id: `descriptor-${field}`,
      issue: 'NATIVE-EVIDENCE-TRUST-SCOPE-MISMATCH',
      check: 'content-linkage',
      mutate: (auth, entry) => {
        entry.record.expected.descriptor[field] = `forged-${field}`;
        entry.record.observed.descriptor[field] = `forged-${field}`;
        auth.resignRecord(entry.record.record_id);
      },
    });
  }
  cases.push(
    {
      id: 'immutable-record-id',
      issue: 'NATIVE-EVIDENCE-OWNER-STORE-PROVENANCE',
      check: 'owner-store-provenance',
      mutate: (auth, entry) => {
        entry.record.record_id = `${entry.record.record_id}-forged`;
        auth.resignRecord(entry.provenance.record_ref);
      },
    },
    {
      id: 'immutable-provenance-ref',
      issue: 'NATIVE-EVIDENCE-OWNER-STORE-PROVENANCE',
      check: 'owner-store-provenance',
      mutate: (_auth, entry) => {
        entry.provenance.record_ref = `${entry.provenance.record_ref}-forged`;
      },
    },
  );
  for (const evidenceRow of [
    { label: 'terminal', checkpoint: 'running', command: fixture.commands.terminal },
    {
      label: 'reconcile',
      checkpoint: 'uncertain',
      command: fixture.commands.reconcile_running,
    },
  ]) {
    for (const authCase of cases) {
      const { path } = boardFile();
      applyCheckpoint(path, evidenceRow.checkpoint);
      const auth = AUTH_BY_BOARD.get(path);
      assert.ok(auth);
      const entry = installCommandEvidence(path, evidenceRow.command);
      authCase.mutate(auth, entry);
      const before = readFileSync(path, 'utf8');
      const consumedBefore = consumedSnapshot(auth);
      const rollbackCount = auth.rollbacks.length;

      const result = runCli(path, argsFor(evidenceRow.command));

      const label = `${evidenceRow.label}-${authCase.id}`;
      assert.equal(result.code, EXIT.VALIDATION, `${label}: ${result.stderr}`);
      assert.match(result.stderr, new RegExp(authCase.issue), label);
      assert.ok(auth.trace.includes(authCase.check), `${label}: skipped ${authCase.check}`);
      assert.equal(readFileSync(path, 'utf8'), before, `${label}: board changed`);
      assert.equal(consumedSnapshot(auth), consumedBefore, `${label}: evidence consumed`);
      assert.equal(auth.reservations.size, 0, `${label}: reservation leaked`);
      assert.equal(
        auth.rollbacks.length,
        rollbackCount,
        `${label}: pre-reservation failure emitted a phantom rollback`,
      );
    }
  }
});

test('exact evidence replay preserves the committed consumption identity for every class', () => {
  for (const row of [
    { label: 'bind', checkpoint: 'created', command: fixture.commands.bind },
    { label: 'terminal', checkpoint: 'running', command: fixture.commands.terminal },
    {
      label: 'reconcile',
      checkpoint: 'running',
      command: fixture.commands.reconcile_uncertain,
    },
  ]) {
    const { path } = boardFile();
    applyCheckpoint(path, row.checkpoint);
    const auth = AUTH_BY_BOARD.get(path);
    assert.ok(auth);
    assertOk(runOperation(path, row.command), `${row.label}: first`);
    const consumed = consumedSnapshot(auth);
    const beforeReplay = readFileSync(path, 'utf8');
    const commits = auth.commits.length;

    assertOk(runOperation(path, row.command), `${row.label}: replay`);

    assert.equal(readFileSync(path, 'utf8'), beforeReplay, `${row.label}: replay changed bytes`);
    assert.equal(consumedSnapshot(auth), consumed, `${row.label}: consumption identity drifted`);
    assert.equal(
      auth.commits.length,
      commits + 1,
      `${row.label}: replay did not commit transaction`,
    );
    assertTransactionOrder(auth, `${row.label}: replay`);
  }
});

test('immutable create replay survives bind, terminal, orphan, and reconcile lifecycle writes', () => {
  for (const checkpoint of ['created', 'running', 'uncertain', 'terminal', 'orphaned'] as const) {
    const { path } = boardFile();
    applyCheckpoint(path, checkpoint);
    const beforeReplay = readFileSync(path, 'utf8');

    const replay = runOperation(path, fixture.commands.create);

    assertOk(replay, `${checkpoint}: exact create replay`);
    assert.match(replay.stdout, /"launch_allowed"\s*:\s*false/);
    assert.equal(readFileSync(path, 'utf8'), beforeReplay, `${checkpoint}: replay changed bytes`);

    const conflicting = clone(fixture.commands.create);
    conflicting.attempt.dispatch.request_hash = `sha256:${'f'.repeat(64)}`;
    const conflict = runOperation(path, conflicting);
    assert.equal(conflict.code, EXIT.VALIDATION, `${checkpoint}: ${conflict.stderr}`);
    assert.match(conflict.stderr, /NATIVE-ATTEMPT-REPLAY-CONFLICT/);
    assert.equal(readFileSync(path, 'utf8'), beforeReplay, `${checkpoint}: conflict wrote board`);
  }
});

test('evidence stage failure rolls back its reservation for bind/terminal/reconcile', () => {
  for (const row of [
    { label: 'bind', checkpoint: 'created', command: fixture.commands.bind },
    { label: 'terminal', checkpoint: 'running', command: fixture.commands.terminal },
    { label: 'reconcile', checkpoint: 'running', command: fixture.commands.reconcile_uncertain },
  ]) {
    const { path } = boardFile();
    applyCheckpoint(path, row.checkpoint);
    const auth = AUTH_BY_BOARD.get(path);
    assert.ok(auth);
    auth.failAfterReservationCode = 'NATIVE-EVIDENCE-INJECTED-AUTH-FAILURE';
    const before = readFileSync(path, 'utf8');
    const consumedBefore = consumedSnapshot(auth);

    const result = runOperation(path, row.command);

    assert.equal(result.code, EXIT.VALIDATION, `${row.label}: ${result.stderr}`);
    assert.match(result.stderr, /NATIVE-EVIDENCE-INJECTED-AUTH-FAILURE/);
    assert.equal(readFileSync(path, 'utf8'), before, `${row.label}: board changed`);
    assert.equal(consumedSnapshot(auth), consumedBefore, `${row.label}: evidence consumed`);
    assert.equal(auth.reservations.size, 0, `${row.label}: reservation leaked`);
    assert.equal(auth.rollbacks.at(-1)?.reason, 'write-pipeline-error');
  }
});

test('engine conflict after successful evidence stage consumes nothing for every evidence class', () => {
  for (const row of [
    { label: 'bind', checkpoint: 'starting-uncertain', command: fixture.commands.bind },
    { label: 'terminal', checkpoint: 'created', command: fixture.commands.terminal },
    { label: 'reconcile', checkpoint: 'created', command: fixture.commands.reconcile_running },
  ]) {
    const { path } = boardFile();
    applyCheckpoint(path, row.checkpoint);
    const auth = AUTH_BY_BOARD.get(path);
    assert.ok(auth);
    if (row.command.type !== 'bind') installCommandEvidence(path, row.command);
    const before = readFileSync(path, 'utf8');
    const consumedBefore = consumedSnapshot(auth);

    const result = runOperation(path, row.command);

    assert.equal(result.code, EXIT.VALIDATION, `${row.label}: ${result.stderr}`);
    assert.match(result.stderr, /NATIVE-(ATTEMPT-STATE-CONFLICT|RECONCILE-CONFLICT)/);
    assert.equal(readFileSync(path, 'utf8'), before, `${row.label}: board changed`);
    assert.equal(consumedSnapshot(auth), consumedBefore, `${row.label}: evidence consumed`);
    assert.equal(auth.reservations.size, 0, `${row.label}: reservation leaked`);
    assert.equal(auth.rollbacks.at(-1)?.reason, 'write-pipeline-error');
  }
});

test('hard lint rejects and rolls back staged evidence even with --force', () => {
  for (const row of [
    { label: 'bind', checkpoint: 'created', command: fixture.commands.bind },
    { label: 'terminal', checkpoint: 'running', command: fixture.commands.terminal },
    { label: 'reconcile', checkpoint: 'running', command: fixture.commands.reconcile_uncertain },
  ]) {
    const { path } = boardFile();
    applyCheckpoint(path, row.checkpoint);
    const invalid = readBoard(path);
    invalid.goal = 42;
    writeFileSync(path, `${JSON.stringify(invalid, null, 2)}\n`);
    const auth = AUTH_BY_BOARD.get(path);
    assert.ok(auth);
    if (row.command.type !== 'bind') installCommandEvidence(path, row.command);
    const before = readFileSync(path, 'utf8');
    const consumedBefore = consumedSnapshot(auth);

    const result = runCli(path, [...argsFor(row.command), '--force']);

    assert.equal(result.code, EXIT.VALIDATION, `${row.label}: ${result.stderr}`);
    assert.match(result.stderr, /FMT-GOAL/);
    assert.equal(readFileSync(path, 'utf8'), before, `${row.label}: board changed`);
    assert.equal(consumedSnapshot(auth), consumedBefore, `${row.label}: evidence consumed`);
    assert.equal(auth.reservations.size, 0, `${row.label}: reservation leaked`);
    assert.equal(auth.rollbacks.at(-1)?.reason, 'lint');
  }
});

test('real-router EIO rolls back staged evidence and exact retry succeeds', () => {
  for (const row of [
    { label: 'bind', checkpoint: 'created', command: fixture.commands.bind },
    { label: 'terminal', checkpoint: 'running', command: fixture.commands.terminal },
    { label: 'reconcile', checkpoint: 'running', command: fixture.commands.reconcile_uncertain },
  ]) {
    const { path } = boardFile();
    applyCheckpoint(path, row.checkpoint);
    const auth = AUTH_BY_BOARD.get(path);
    assert.ok(auth);
    const before = readFileSync(path, 'utf8');
    const consumedBefore = consumedSnapshot(auth);
    auth.failWrite = true;

    const failed = runOperation(path, row.command);

    assert.equal(failed.code, EXIT.ERROR, `${row.label}: ${failed.stderr}`);
    assert.match(failed.stderr, /injected native attempt board write failure/);
    assert.equal(readFileSync(path, 'utf8'), before, `${row.label}: board changed on EIO`);
    assert.equal(consumedSnapshot(auth), consumedBefore, `${row.label}: evidence consumed on EIO`);
    assert.equal(auth.reservations.size, 0, `${row.label}: reservation leaked`);
    assert.equal(auth.rollbacks.at(-1)?.reason, 'write-pipeline-error');

    auth.failWrite = false;
    assertOk(runOperation(path, row.command), `${row.label}: retry`);
    assertTransactionOrder(auth, `${row.label}: retry`);
  }
});

test('dry-run validates then rolls back evidence without board write or consumption', () => {
  for (const row of [
    { label: 'bind', checkpoint: 'created', command: fixture.commands.bind },
    { label: 'terminal', checkpoint: 'running', command: fixture.commands.terminal },
    { label: 'reconcile', checkpoint: 'running', command: fixture.commands.reconcile_uncertain },
  ]) {
    const { path } = boardFile();
    applyCheckpoint(path, row.checkpoint);
    const auth = AUTH_BY_BOARD.get(path);
    assert.ok(auth);
    if (row.command.type !== 'bind') installCommandEvidence(path, row.command);
    const before = readFileSync(path, 'utf8');
    const consumedBefore = consumedSnapshot(auth);

    const result = runCli(path, [...argsFor(row.command), '--dry-run']);

    assert.equal(result.code, EXIT.OK, `${row.label}: ${result.stderr}`);
    assert.equal(readFileSync(path, 'utf8'), before, `${row.label}: board changed`);
    assert.equal(consumedSnapshot(auth), consumedBefore, `${row.label}: evidence consumed`);
    assert.equal(auth.reservations.size, 0, `${row.label}: reservation leaked`);
    assert.equal(auth.rollbacks.at(-1)?.reason, 'dry-run');
    assert.equal(auth.trace.includes('write'), false, `${row.label}: dry-run reached writer`);
  }
});

test('reconcile CLI handler owns uncertain/running/terminal/orphaned task projection', () => {
  const recovered = boardFile();
  applyCheckpoint(recovered.path, 'running');
  assertOk(
    runOperation(recovered.path, fixture.commands.reconcile_uncertain),
    'reconcile uncertain',
  );
  assert.equal(task(recovered.path).status, 'uncertain');
  assert.equal(task(recovered.path).handle ?? null, null);
  assertOk(runOperation(recovered.path, fixture.commands.reconcile_running), 'reconcile running');
  assert.equal(task(recovered.path).status, 'in_flight');
  assert.equal(task(recovered.path).handle, 'agent-fixture-001');
  const beforeRunningReplay = readFileSync(recovered.path, 'utf8');
  assertOk(
    runOperation(recovered.path, fixture.commands.reconcile_running),
    'reconcile running exact replay',
  );
  assert.equal(readFileSync(recovered.path, 'utf8'), beforeRunningReplay);

  const terminal = boardFile();
  applyCheckpoint(terminal.path, 'uncertain');
  assertOk(runOperation(terminal.path, fixture.commands.reconcile_terminal), 'reconcile terminal');
  assert.equal(task(terminal.path).status, 'uncertain');
  assert.notEqual(task(terminal.path).status, 'done');
  const beforeTerminalReplay = readFileSync(terminal.path, 'utf8');
  assertOk(
    runOperation(terminal.path, fixture.commands.reconcile_terminal),
    'reconcile terminal exact replay',
  );
  assert.equal(readFileSync(terminal.path, 'utf8'), beforeTerminalReplay);

  const orphaned = boardFile();
  applyCheckpoint(orphaned.path, 'uncertain');
  assertOk(runOperation(orphaned.path, fixture.commands.reconcile_orphaned), 'reconcile orphaned');
  assert.equal(task(orphaned.path).status, 'ready');
  assert.equal(task(orphaned.path).handle ?? null, null);
  const beforeReplay = readFileSync(orphaned.path, 'utf8');
  assertOk(runOperation(orphaned.path, fixture.commands.reconcile_orphaned), 'orphan exact replay');
  assert.equal(readFileSync(orphaned.path, 'utf8'), beforeReplay);
  assertOk(
    runOperation(orphaned.path, fixture.commands.create_second_after_orphan_audit),
    'explicit create after fenced orphan audit',
  );
  assert.equal(task(orphaned.path).routing.attempts.length, 2);
});

test('trusted orphan audit commits while ordinary dependency gating projects blocked', () => {
  const { path } = boardFile();
  applyCheckpoint(path, 'uncertain');
  const board = readBoard(path);
  board.tasks.unshift({
    id: 'T-native-upstream',
    status: 'ready',
    deps: [],
    executor: 'user',
  });
  board.tasks.find((entry: any) => entry.id === 'T-native-v1').deps = ['T-native-upstream'];
  writeFileSync(path, `${JSON.stringify(board, null, 2)}\n`);

  const auth = AUTH_BY_BOARD.get(path);
  assert.ok(auth);
  const consumedBefore = consumedSnapshot(auth);
  const commitsBefore = auth.commits.length;
  const rollbacksBefore = auth.rollbacks.length;
  const result = runOperation(path, fixture.commands.reconcile_orphaned);

  assertOk(result, 'orphan audit with unsatisfied dependency');
  assert.equal(task(path).routing.attempts[0].state, 'orphaned');
  assert.equal(task(path).status, 'blocked');
  assert.equal(task(path).handle ?? null, null);
  assert.notEqual(consumedSnapshot(auth), consumedBefore, 'orphan evidence was not consumed');
  assert.equal(auth.commits.length, commitsBefore + 1, 'orphan evidence was not committed');
  assert.equal(auth.rollbacks.length, rollbacksBefore, 'orphan evidence was rolled back');
  assertTransactionOrder(auth, 'orphan audit with unsatisfied dependency');

  const beforeReplay = readFileSync(path, 'utf8');
  assertOk(runOperation(path, fixture.commands.reconcile_orphaned), 'blocked orphan exact replay');
  assert.equal(readFileSync(path, 'utf8'), beforeReplay, 'blocked orphan replay changed bytes');
});

test('trusted reconcile-uncertain permits structurally complete lineage drift only', () => {
  const { path } = boardFile();
  applyCheckpoint(path, 'running');
  const command = clone(fixture.commands.reconcile_uncertain);
  command.evidence.current_lineage.worktree_ref = 'worktree-ref:observed-drift';
  command.evidence.current_lineage.account_fingerprint_ref = 'account-ref:observed-drift';

  assertOk(runOperation(path, command), 'trusted uncertain lineage drift');

  assert.equal(task(path).status, 'uncertain');
  assert.equal(task(path).routing.attempts[0].state, 'uncertain');
  assert.equal(
    task(path).routing.attempts[0].reconciliation.at(-1).observed.current_lineage.worktree_ref,
    'worktree-ref:observed-drift',
  );
});

test('legacy route-bind cannot bypass an opted-in native handle gate', () => {
  const { path } = boardFile();
  const before = readFileSync(path, 'utf8');
  const result = runOperation(path, fixture.commands.route_bind_bypass);
  assert.equal(result.code, EXIT.VALIDATION);
  assert.match(result.stderr, /NATIVE-ROUTE-BIND-BYPASS/);
  assert.equal(readFileSync(path, 'utf8'), before);
});

test('every generic status/handle writer is rejected across native-active states with and without --force', () => {
  const writers = [
    ['start', ['task', 'start', 'T-native-v1']],
    ['done', ['task', 'done', 'T-native-v1', '--artifact', 'artifact://premature', '--verified']],
    ['set-status', ['task', 'set-status', 'T-native-v1', 'ready']],
    ['block', ['task', 'block', 'T-native-v1', '--on', 'dependency']],
    ['unblock', ['task', 'unblock', 'T-native-v1']],
    ['route-bind', argsFor(fixture.commands.route_bind_bypass)],
    ['update-handle', ['task', 'update', 'T-native-v1', '--handle', 'agent-counterfeit']],
    ['update-set-handle', ['task', 'update', 'T-native-v1', '--set', 'handle=agent-counterfeit']],
    [
      'update-set-json-handle',
      ['task', 'update', 'T-native-v1', '--set-json', 'handle="agent-counterfeit"'],
    ],
  ] as const;
  for (const checkpoint of ['created', 'running', 'uncertain'] as const) {
    for (const forced of [false, true]) {
      for (const row of writers) {
        const { path } = boardFile();
        applyCheckpoint(path, checkpoint);
        const before = readFileSync(path, 'utf8');
        const args = forced ? [...row[1], '--force'] : [...row[1]];
        const result = runCli(path, args);
        const label = `${checkpoint}/${forced ? 'force' : 'plain'}/${row[0]}`;
        assert.equal(result.code, EXIT.VALIDATION, `${label}: ${result.stderr}`);
        assert.match(result.stderr, /NATIVE-(DEDICATED-WRITER-REQUIRED|ROUTE-BIND-BYPASS)/, label);
        assert.equal(readFileSync(path, 'utf8'), before, `${label}: wrote board bytes`);
      }
    }
  }
});

test('generic-state target scope uses semantic task IDs, never colliding positional values', () => {
  const { path } = boardFile();
  const board = readBoard(path);
  const nativeTask = task(path);
  nativeTask.id = 'failed';
  const other = clone(nativeTask);
  other.id = 'T-other';
  other.executor = 'master-orchestrator';
  delete other.planning;
  delete other.routing;
  board.tasks = [nativeTask, other];
  writeFileSync(path, `${JSON.stringify(board, null, 2)}\n`);

  const create = clone(fixture.commands.create);
  create.task_id = 'failed';
  assertOk(runOperation(path, create), 'native task named like a status token');
  assertOk(runCli(path, ['task', 'start', 'T-other']), 'start unrelated task');

  const result = runCli(path, ['task', 'set-status', 'T-other', 'failed']);

  assertOk(result, 'status positional must not become a second task target');
  assert.equal(readBoard(path).tasks.find((entry: any) => entry.id === 'T-other').status, 'failed');
  assert.equal(readBoard(path).tasks.find((entry: any) => entry.id === 'failed').status, 'ready');
});

test('ordinary done invariants are available only after authenticated terminal evidence', () => {
  for (const row of [
    { label: 'artifact-only', args: ['--artifact', 'artifact://fixture-incomplete'] },
    { label: 'verified-only', args: ['--verified'] },
  ]) {
    const negative = boardFile();
    applyCheckpoint(negative.path, 'terminal');
    const before = readFileSync(negative.path, 'utf8');
    const result = runCli(negative.path, ['task', 'done', 'T-native-v1', ...row.args]);
    assert.equal(result.code, EXIT.VALIDATION, `${row.label}: ${result.stderr}`);
    assert.equal(readFileSync(negative.path, 'utf8'), before, `${row.label}: board changed`);
  }

  const { path } = boardFile();
  applyCheckpoint(path, 'terminal');
  const result = runCli(path, [
    'task',
    'done',
    'T-native-v1',
    '--artifact',
    'artifact://fixture-accepted',
    '--verified',
  ]);
  assertOk(result, 'terminal -> done');
  assert.equal(task(path).status, 'done');
  assert.equal(task(path).verified, true);
  assert.equal(task(path).artifact, 'artifact://fixture-accepted');
});

test('every CLI mutation reports its issue code and leaves board bytes unchanged', () => {
  for (const row of fixture.negative_cases.filter(
    (entry: any) => fixture.commands[entry.command].type !== 'bind',
  )) {
    const { path } = boardFile();
    applyCheckpoint(path, row.checkpoint);
    const before = readFileSync(path, 'utf8');
    const command = clone(fixture.commands[row.command]);
    setJsonPointer(command, row.mutation);
    const result = runOperation(path, command);
    assert.equal(result.code, EXIT.VALIDATION, `${row.id}: ${result.stderr || result.stdout}`);
    assert.match(result.stderr, new RegExp(row.issue), row.id);
    assert.equal(readFileSync(path, 'utf8'), before, `${row.id}: partial board write`);
  }
});

test('bind crosses private authentication and rejects every signed trust vector atomically', () => {
  for (const vector of fixture.private_evidence.authentication_negative_vectors) {
    const { path } = boardFile();
    applyCheckpoint(path, 'created');
    const auth = AUTH_BY_BOARD.get(path);
    assert.ok(auth);
    auth.installVector(vector);
    const before = readFileSync(path, 'utf8');
    const command = {
      ...clone(fixture.commands.bind),
      evidence_record_ref: vector.record_ref,
    };
    const result = runOperation(path, command);
    assert.equal(result.code, EXIT.VALIDATION, `${vector.id}: ${result.stderr || result.stdout}`);
    assert.match(result.stderr, new RegExp(vector.issue), vector.id);
    assert.ok(auth.trace.includes(vector.expected.authentication_check), vector.id);
    assert.equal(readFileSync(path, 'utf8'), before, `${vector.id}: partial board write`);
  }
});

test('signed bind content negatives cross private authentication linkage checks', () => {
  const vectors = fixture.private_evidence.bind_content_negative_vectors;
  for (const vector of vectors) {
    const { path } = boardFile();
    applyCheckpoint(path, 'created');
    const auth = AUTH_BY_BOARD.get(path);
    assert.ok(auth);
    auth.installVector(vector);
    const before = readFileSync(path, 'utf8');
    const result = runOperation(path, {
      ...clone(fixture.commands.bind),
      evidence_record_ref: vector.record_ref,
    });
    assert.equal(result.code, EXIT.VALIDATION, `${vector.id}: ${result.stderr || result.stdout}`);
    assert.match(result.stderr, new RegExp(vector.issue), vector.id);
    assert.ok(auth.trace.includes(vector.expected.authentication_check), vector.id);
    assert.equal(readFileSync(path, 'utf8'), before, `${vector.id}: partial board write`);
  }

  const missing = boardFile();
  applyCheckpoint(missing.path, 'created');
  const before = readFileSync(missing.path, 'utf8');
  const result = runOperation(missing.path, {
    ...clone(fixture.commands.bind),
    evidence_record_ref: 'evidence:fixture-missing',
  });
  assert.equal(result.code, EXIT.VALIDATION);
  assert.match(result.stderr, /NATIVE-EVIDENCE-RECORD-MISSING/);
  assert.equal(readFileSync(missing.path, 'utf8'), before);
});

test('create and signed bind account/permission gates fail closed at real endpoints', () => {
  for (const row of fixture.endpoint_negative_cases.filter(
    (entry: any) => entry.endpoint === 'create',
  )) {
    const { path } = boardFile();
    const command = clone(fixture.commands.create);
    setJsonPointer(command, row.mutation);
    const before = readFileSync(path, 'utf8');
    const result = runOperation(path, command);
    assert.equal(result.code, EXIT.VALIDATION, `${row.id}: ${result.stderr || result.stdout}`);
    assert.match(result.stderr, new RegExp(row.issue), row.id);
    const auth = AUTH_BY_BOARD.get(path);
    assert.ok(auth?.trace.includes('create-admission'), `${row.id}: admission path skipped`);
    assert.equal(readFileSync(path, 'utf8'), before, `${row.id}: partial board write`);
  }

  for (const vector of fixture.private_evidence.bind_lineage_negative_vectors) {
    const { path } = boardFile();
    applyCheckpoint(path, 'created');
    const auth = AUTH_BY_BOARD.get(path);
    assert.ok(auth);
    auth.installVector(vector);
    const before = readFileSync(path, 'utf8');
    const command = {
      ...clone(fixture.commands.bind),
      evidence_record_ref: vector.record_ref,
    };
    const result = runOperation(path, command);
    assert.equal(result.code, EXIT.VALIDATION, `${vector.id}: ${result.stderr || result.stdout}`);
    assert.match(result.stderr, new RegExp(vector.issue), vector.id);
    assert.ok(auth.trace.includes(vector.expected.authentication_check), vector.id);
    assert.equal(readFileSync(path, 'utf8'), before, `${vector.id}: partial board write`);
  }
});
