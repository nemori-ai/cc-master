import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as engineExports from '../dist/index.mjs';

// biome-ignore lint/suspicious/noExplicitAny: This oracle deliberately mutates untyped, not-yet-implemented contract JSON.
type FixtureJson = any;

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(HERE, 'fixtures', 'native-attempt', 'codex-api-tool-v1.json');
const PROBE_PATH = join(HERE, 'fixtures', 'native-attempt', 'codex-api-tool-feature-probe-v1.json');
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as FixtureJson;
const probeFixture = JSON.parse(readFileSync(PROBE_PATH, 'utf8')) as FixtureJson;
const engine = engineExports as unknown as Record<string, unknown>;

interface ApplyResult {
  ok: boolean;
  board: FixtureJson;
  result?: Record<string, FixtureJson>;
  issues?: Array<{ code: string; path?: string; message?: string }>;
}

interface NativeAttemptApi {
  nativeAttemptApply: (board: FixtureJson, command: FixtureJson) => ApplyResult;
  nativeAttemptFeatureDecision: (input: FixtureJson) => Record<string, FixtureJson>;
  validateNativeAttemptProjection: (board: FixtureJson) => Array<{ code: string }>;
  validateNativeAttemptMutation: (
    before: FixtureJson | null,
    after: FixtureJson,
    writerKind?: string,
    targetedTaskIds?: readonly string[],
  ) => Array<{ code: string }>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(row[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalSignedRecord(record: FixtureJson): FixtureJson {
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

function canonicalRecordHash(record: FixtureJson): string {
  return `sha256:${createHash('sha256')
    .update(stableJson(canonicalSignedRecord(record)))
    .digest('hex')}`;
}

function signatureValid(record: FixtureJson, publicKeySpkiBase64: string): boolean {
  const publicKey = createPublicKey({
    key: Buffer.from(publicKeySpkiBase64, 'base64'),
    format: 'der',
    type: 'spki',
  });
  return verify(
    null,
    Buffer.from(record.record_hash),
    publicKey,
    Buffer.from(record.producer.signature.replace(/^ed25519:/, ''), 'base64'),
  );
}

function task(board: FixtureJson): FixtureJson {
  return board.tasks.find((entry: FixtureJson) => entry.id === 'T-native-v1');
}

function attempt(board: FixtureJson, id = 'attempt-native-fixture-001'): FixtureJson {
  return task(board).routing.attempts.find((entry: FixtureJson) => entry.id === id);
}

function evidenceScope(board: FixtureJson, command: FixtureJson): FixtureJson {
  const current = attempt(board, command.attempt_id);
  return {
    contract: 'ccm/native-attempt/v1',
    ...clone(current.descriptor),
    task_id: command.task_id,
    attempt_id: current.id,
    candidate_id: current.candidate_id,
    dispatch_key: current.dispatch.key,
    request_hash: current.dispatch.request_hash,
    launch_claim_id: current.dispatch.launch_claim_id,
    create_hash: current.create_hash,
  };
}

function verifiedCommand(board: FixtureJson, input: FixtureJson): FixtureJson {
  const command = clone(input);
  if (!['bind', 'terminal', 'reconcile'].includes(command.type)) return command;
  const current = attempt(board, command.attempt_id);
  const descriptor = clone(current.descriptor);
  const target = current.lineage.expected_child_target;
  if (command.type === 'bind') {
    const raw = command.verified_evidence;
    if (!raw) return command;
    command.verified_evidence = {
      schema: 'ccm/native-verified-evidence/v1',
      evidence_class: 'bind',
      record_ref: raw.record_id,
      record_hash: raw.record_hash,
      scope: {
        ...evidenceScope(board, command),
        task_id: raw.create_link?.task_id,
        attempt_id: raw.create_link?.attempt_id,
        candidate_id: raw.create_link?.candidate_id,
        dispatch_key: raw.create_link?.dispatch_key,
        request_hash: raw.create_link?.request_hash,
        launch_claim_id: raw.create_link?.launch_claim_id,
      },
      producer: {
        producer_id: raw.producer?.producer_id,
        channel: raw.producer?.channel,
      },
      resolved_context: clone(raw.resolved_context),
      observed: {
        descriptor,
        target: raw.observed?.canonical_target,
        source: 'signed-owner-spawn-roster',
        current_lineage: clone(raw.observed?.current_lineage),
        handle: raw.observed?.handle,
        handle_kind: raw.observed?.handle_kind,
        spawn: raw.observed?.spawn
          ? { ...clone(raw.observed.spawn), target: raw.observed.canonical_target }
          : raw.observed?.spawn,
        roster: raw.observed?.roster
          ? { ...clone(raw.observed.roster), target: raw.observed.canonical_target }
          : raw.observed?.roster,
      },
      payload: {
        durability_class: 'legacy_session_bound',
      },
    };
    return command;
  }

  const raw = command.evidence;
  if (!raw) return command;
  if (command.type === 'terminal') {
    command.verified_evidence = {
      schema: 'ccm/native-verified-evidence/v1',
      evidence_class: 'terminal',
      record_ref: raw.evidence_record_ref,
      record_hash: raw.evidence_hash,
      scope: evidenceScope(board, command),
      producer: {
        producer_id: 'producer:fixture-codex-origin-adapter',
        channel: 'ccm-private-adapter/v1',
      },
      resolved_context: {
        account: 'current',
        permission_profile: 'compatible',
        permission_denies: 'compatible',
      },
      observed: {
        descriptor,
        target,
        source: raw.source,
        current_lineage: clone(current.lineage),
      },
      payload: {
        class: raw.class,
        observed_at: raw.observed_at,
        result_ref: raw.result_ref,
        artifact_refs: clone(raw.artifact_refs),
      },
    };
    command.evidence_record_ref = raw.evidence_record_ref;
    delete command.evidence;
    return command;
  }

  const { record_id, record_hash, producer_channel, current_lineage, ...payload } = raw;
  const live = raw.classification === 'running';
  const terminalObservation = raw.classification === 'terminal';
  command.verified_evidence = {
    schema: 'ccm/native-verified-evidence/v1',
    evidence_class: 'reconcile',
    record_ref: record_id,
    record_hash,
    scope: evidenceScope(board, command),
    producer: {
      producer_id: 'producer:fixture-codex-origin-adapter',
      channel: 'ccm-private-adapter/v1',
    },
    resolved_context: {
      account: 'current',
      permission_profile: 'compatible',
      permission_denies: 'compatible',
    },
    observed: {
      descriptor,
      target: live || terminalObservation ? target : null,
      source: producer_channel,
      current_lineage: clone(current_lineage),
      ...(live
        ? {
            handle: raw.handle,
            handle_kind: current.handle_binding?.handle_kind,
            spawn: { target, observed_at: current.started_at },
            roster: {
              target,
              handle: raw.handle,
              state: 'running',
              observed_at: raw.observed_at,
            },
          }
        : {}),
    },
    payload,
  };
  command.evidence_record_ref = record_id;
  delete command.evidence;
  return command;
}

function applyOk(api: NativeAttemptApi, board: FixtureJson, command: FixtureJson): ApplyResult {
  const inputBefore = clone(board);
  const outcome = api.nativeAttemptApply(board, verifiedCommand(board, command));
  assert.deepEqual(board, inputBefore, 'engine endpoint must never mutate its input board');
  assert.equal(outcome.ok, true, JSON.stringify(outcome.issues ?? []));
  assert.ok(outcome.board, 'successful endpoint result must return the projected board');
  return outcome;
}

function checkpoint(api: NativeAttemptApi, name: string): FixtureJson {
  let board = clone(fixture.initial_board);
  if (name === 'initial') return board;
  board = applyOk(api, board, fixture.commands.create).board;
  if (name === 'created') return board;
  board = applyOk(api, board, fixture.commands.bind).board;
  if (name === 'running') return board;
  if (name === 'cancelled-requested') {
    return applyOk(api, board, fixture.commands.cancel).board;
  }
  if (name === 'terminal') return applyOk(api, board, fixture.commands.terminal).board;
  board = applyOk(api, board, fixture.commands.reconcile_uncertain).board;
  if (name === 'uncertain') return board;
  if (name === 'orphaned') {
    return applyOk(api, board, fixture.commands.reconcile_orphaned).board;
  }
  throw new Error(`unknown checkpoint ${name}`);
}

function setJsonPointer(target: FixtureJson, mutation: FixtureJson): void {
  if (mutation.op === 'none') return;
  const parts = String(mutation.path)
    .split('/')
    .slice(1)
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  const key = parts.pop();
  assert.ok(key, `mutation path must identify a field: ${mutation.path}`);
  let parent = target;
  for (const part of parts) {
    assert.ok(parent && typeof parent === 'object', `mutation path not found: ${mutation.path}`);
    parent = parent[part];
  }
  if (mutation.op === 'remove') {
    assert.ok(Object.hasOwn(parent, key), `remove path not found: ${mutation.path}`);
    delete parent[key];
    return;
  }
  assert.ok(mutation.op === 'add' || mutation.op === 'replace', `unknown op ${mutation.op}`);
  if (mutation.op === 'replace') {
    assert.ok(Object.hasOwn(parent, key), `replace path not found: ${mutation.path}`);
  }
  parent[key] = clone(mutation.value);
}

interface SchemaMutation {
  name: string;
  mutate: (value: FixtureJson) => void;
}

const CREATE_SCHEMA_MUTATIONS: SchemaMutation[] = [
  { name: 'schema', mutate: (value) => (value.schema = 'ccm/native-attempt/forged') },
  { name: 'attempt id', mutate: (value) => (value.id = '') },
  { name: 'ordinal', mutate: (value) => (value.ordinal = 999) },
  { name: 'candidate id', mutate: (value) => (value.candidate_id = '') },
  { name: 'surface', mutate: (value) => (value.surface = '') },
  { name: 'transport', mutate: (value) => (value.transport = '') },
  { name: 'state', mutate: (value) => (value.state = 'running') },
  { name: 'created_at syntax', mutate: (value) => (value.created_at = 'not-a-time') },
  { name: 'created_at calendar', mutate: (value) => (value.created_at = '2026-02-30T08:00:00Z') },
  { name: 'dispatch object', mutate: (value) => (value.dispatch = {}) },
  { name: 'dispatch key', mutate: (value) => (value.dispatch.key = '') },
  { name: 'dispatch request hash', mutate: (value) => (value.dispatch.request_hash = 'sha256:x') },
  { name: 'launch claim id', mutate: (value) => (value.dispatch.launch_claim_id = '') },
  {
    name: 'claim owner session ref',
    mutate: (value) => (value.dispatch.claim_owner_session_ref = ''),
  },
  {
    name: 'claim owner lineage link',
    mutate: (value) => (value.dispatch.claim_owner_session_ref = 'session-ref:forged'),
  },
  { name: 'lineage object', mutate: (value) => (value.lineage = {}) },
  { name: 'baseline commit', mutate: (value) => (value.lineage.baseline_commit = 'x') },
  {
    name: 'permission snapshot ref',
    mutate: (value) => (value.lineage.permission.snapshot_ref = ''),
  },
  {
    name: 'permission profile',
    mutate: (value) => (value.lineage.permission.profile = 'unknown'),
  },
  { name: 'permission denies', mutate: (value) => (value.lineage.permission.denies = ['']) },
  { name: 'selection object', mutate: (value) => (value.selection_snapshot = {}) },
  {
    name: 'selection selected_at',
    mutate: (value) => (value.selection_snapshot.selected_at = '2026-07-13T08:00:00.000Z'),
  },
  {
    name: 'selection evidence',
    mutate: (value) => (value.selection_snapshot.evidence = []),
  },
  {
    name: 'selection reason codes',
    mutate: (value) => (value.selection_snapshot.reason_codes = ['']),
  },
  { name: 'initial handle binding', mutate: (value) => (value.handle_binding = {}) },
  { name: 'initial cancel', mutate: (value) => (value.cancel = {}) },
  { name: 'initial terminal', mutate: (value) => (value.terminal = {}) },
  { name: 'initial reconciliation', mutate: (value) => (value.reconciliation = [{}]) },
];

const CANCEL_SCHEMA_MUTATIONS: SchemaMutation[] = [
  {
    name: 'request object',
    mutate: (value) => {
      for (const key of Object.keys(value)) delete value[key];
    },
  },
  { name: 'request id', mutate: (value) => (value.id = '') },
  { name: 'request hash', mutate: (value) => (value.request_hash = 'sha256:x') },
  { name: 'requested_at syntax', mutate: (value) => (value.requested_at = 'not-a-time') },
  {
    name: 'requested_at calendar',
    mutate: (value) => (value.requested_at = '2026-02-30T08:00:00Z'),
  },
  {
    name: 'requested by session ref',
    mutate: (value) => (value.requested_by_session_ref = ''),
  },
  { name: 'control', mutate: (value) => (value.control = 'interrupt-current-turn') },
  { name: 'reason code', mutate: (value) => (value.reason_code = '') },
  { name: 'unknown field', mutate: (value) => (value.caller_verified = true) },
];

const HANDLE_BINDING_SCHEMA_MUTATIONS: SchemaMutation[] = [
  { name: 'evidence record ref', mutate: (value) => (value.evidence_record_ref = '') },
  { name: 'evidence hash', mutate: (value) => (value.evidence_hash = 'sha256:x') },
  { name: 'producer id', mutate: (value) => (value.producer_id = '') },
  { name: 'handle kind', mutate: (value) => (value.handle_kind = '') },
  { name: 'handle', mutate: (value) => (value.handle = '') },
  { name: 'bound_at', mutate: (value) => (value.bound_at = 'not-a-time') },
  { name: 'durability class', mutate: (value) => (value.durability_class = 'durable') },
  { name: 'unknown field', mutate: (value) => (value.raw_response = {}) },
];

function refreezeCreateIdentity(board: FixtureJson, mutate: (value: FixtureJson) => void): void {
  const current = attempt(board);
  mutate(current);
  mutate(current.create_snapshot.attempt);
  current.create_snapshot.selection_snapshot = clone(
    current.create_snapshot.attempt.selection_snapshot,
  );
  current.create_hash = `sha256:${createHash('sha256')
    .update(stableJson(current.create_snapshot))
    .digest('hex')}`;
}

function assertHardProjection(api: NativeAttemptApi, board: FixtureJson, label: string): void {
  assert.ok(
    api
      .validateNativeAttemptProjection(board)
      .some((issue) => issue.code === 'NATIVE-ATTEMPT-PROJECTION-MISMATCH'),
    label,
  );
  const linted = (engineExports.lintBoard as (text: string) => { errors: Array<{ rule: string }> })(
    JSON.stringify(board),
  );
  assert.ok(
    linted.errors.some((entry) => entry.rule === 'BIZ-NATIVE-ATTEMPT-PROJECTION'),
    `${label}: hard board lint rule`,
  );
}

function engineApi(value: Record<string, unknown>): NativeAttemptApi {
  assert.equal(value.NATIVE_ATTEMPT_CONTRACT, 'ccm/native-attempt/v1');
  assert.equal(
    value.NATIVE_HANDLE_EVIDENCE_RECORD_CODEX_API_TOOL,
    'ccm/native-handle-evidence-record/codex-api-tool/v1',
  );
  assert.equal(
    value.NATIVE_ATTEMPT_FEATURE_PROBE_CODEX_API_TOOL,
    'ccm/native-attempt-feature-probe/codex-api-tool/v1',
  );
  assert.equal(typeof value.nativeAttemptApply, 'function');
  assert.equal(typeof value.nativeAttemptFeatureDecision, 'function');
  assert.equal(typeof value.validateNativeAttemptProjection, 'function');
  assert.equal(typeof value.validateNativeAttemptMutation, 'function');
  return value as unknown as NativeAttemptApi;
}

function assertCreateAndReplays(api: NativeAttemptApi): void {
  const first = applyOk(api, clone(fixture.initial_board), fixture.commands.create);
  assert.equal(first.result?.created, true);
  assert.equal(first.result?.launch_allowed, true);
  assert.equal(task(first.board).status, fixture.expected.create.task_status);
  assert.equal(task(first.board).handle ?? null, null);
  assert.equal(task(first.board).routing.attempts.length, 1);
  assert.equal(attempt(first.board).state, 'starting');
  assert.deepEqual(task(first.board).routing.selected, fixture.selection_snapshot);
  assert.deepEqual(attempt(first.board).selection_snapshot, fixture.selection_snapshot);
  assert.deepEqual(attempt(first.board).descriptor, {
    origin: 'codex',
    harness: 'codex',
    adapter: 'codex/api-tool-multi-agent-v1',
    surface: 'host-native',
    transport: 'codex-api-tool-multi-agent',
  });
  assert.match(attempt(first.board).create_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    attempt(first.board).create_hash,
    `sha256:${createHash('sha256')
      .update(stableJson(attempt(first.board).create_snapshot))
      .digest('hex')}`,
  );
  assert.deepEqual(
    attempt(first.board).create_snapshot.attempt.descriptor,
    attempt(first.board).descriptor,
  );

  const replay = applyOk(api, first.board, fixture.commands.create);
  assert.equal(replay.result?.created, false);
  assert.equal(replay.result?.launch_allowed, false);
  assert.equal(replay.result?.attempt_id, fixture.expected.create_exact_replay.same_attempt_id);
  assert.deepEqual(replay.board, first.board, 'exact create replay must be a board no-op');
}

function assertBindCancelTerminal(api: NativeAttemptApi): void {
  const created = checkpoint(api, 'created');
  const bound = applyOk(api, created, fixture.commands.bind);
  assert.equal(task(bound.board).status, 'in_flight');
  assert.equal(task(bound.board).handle, 'agent-fixture-001');
  assert.equal(attempt(bound.board).state, 'running');
  assert.equal(
    attempt(bound.board).handle_binding.evidence_record_ref,
    'evidence:fixture-bind-001',
  );
  assert.equal(attempt(bound.board).handle_binding.durability_class, 'legacy_session_bound');
  const bindReplay = applyOk(api, bound.board, fixture.commands.bind);
  assert.deepEqual(bindReplay.board, bound.board, 'exact bind replay must be a board no-op');

  const cancelled = applyOk(api, bound.board, fixture.commands.cancel);
  assert.equal(cancelled.result?.host_control_effects, 1);
  assert.equal(attempt(cancelled.board).state, 'running');
  assert.equal(task(cancelled.board).status, 'in_flight');
  const cancelReplay = applyOk(api, cancelled.board, fixture.commands.cancel);
  assert.equal(cancelReplay.result?.host_control_effects, 0);
  assert.deepEqual(
    cancelReplay.board,
    cancelled.board,
    'exact cancel replay must be a board no-op',
  );

  const terminal = applyOk(api, cancelled.board, fixture.commands.terminal);
  assert.equal(attempt(terminal.board).state, 'terminal');
  assert.equal(task(terminal.board).status, 'uncertain');
  assert.equal(task(terminal.board).handle ?? null, null);
  assert.notEqual(task(terminal.board).status, 'done');
  assert.notEqual(task(terminal.board).verified, true);
  const terminalReplay = applyOk(api, terminal.board, fixture.commands.terminal);
  assert.deepEqual(
    terminalReplay.board,
    terminal.board,
    'exact terminal replay must be a board no-op',
  );
}

function assertReconcile(api: NativeAttemptApi): void {
  const created = checkpoint(api, 'created');
  const startingUnknown = applyOk(api, created, fixture.commands.reconcile_uncertain);
  assert.equal(attempt(startingUnknown.board).state, 'uncertain');
  assert.equal(task(startingUnknown.board).status, 'uncertain');
  assert.equal(task(startingUnknown.board).handle ?? null, null);
  const startingReplay = applyOk(api, startingUnknown.board, fixture.commands.reconcile_uncertain);
  assert.deepEqual(startingReplay.board, startingUnknown.board);

  const running = checkpoint(api, 'running');
  const uncertain = applyOk(api, running, fixture.commands.reconcile_uncertain);
  const recovered = applyOk(api, uncertain.board, fixture.commands.reconcile_running);
  assert.equal(attempt(recovered.board).state, 'running');
  assert.equal(task(recovered.board).status, 'in_flight');
  assert.equal(task(recovered.board).handle, 'agent-fixture-001');
  const recoveredReplay = applyOk(api, recovered.board, fixture.commands.reconcile_running);
  assert.deepEqual(
    recoveredReplay.board,
    recovered.board,
    'exact running reconcile replay is a no-op',
  );

  const reconciledTerminal = applyOk(api, uncertain.board, fixture.commands.reconcile_terminal);
  assert.equal(attempt(reconciledTerminal.board).state, 'terminal');
  assert.equal(task(reconciledTerminal.board).status, 'uncertain');
  assert.equal(task(reconciledTerminal.board).handle ?? null, null);
  assert.notEqual(task(reconciledTerminal.board).status, 'done');
  const terminalReplay = applyOk(
    api,
    reconciledTerminal.board,
    fixture.commands.reconcile_terminal,
  );
  assert.deepEqual(
    terminalReplay.board,
    reconciledTerminal.board,
    'exact terminal reconcile replay is a no-op',
  );

  const orphaned = applyOk(api, uncertain.board, fixture.commands.reconcile_orphaned);
  assert.equal(attempt(orphaned.board).state, 'orphaned');
  assert.equal(task(orphaned.board).status, 'ready');
  assert.equal(task(orphaned.board).handle ?? null, null);
  assert.equal(attempt(orphaned.board).orphan_audit.worktree_authority, 'fenced');
  const orphanReplay = applyOk(api, orphaned.board, fixture.commands.reconcile_orphaned);
  assert.deepEqual(orphanReplay.board, orphaned.board);
  const second = applyOk(api, orphaned.board, fixture.commands.create_second_after_orphan_audit);
  assert.equal(task(second.board).routing.attempts.length, 2);
  assert.equal(attempt(second.board, 'attempt-native-fixture-002').state, 'starting');
  assert.equal(second.result?.launch_allowed, true, 'only a later explicit create grants launch');
}

function assertNegativeCases(api: NativeAttemptApi): void {
  for (const row of [...fixture.negative_cases, ...fixture.endpoint_negative_cases]) {
    const board = checkpoint(api, row.checkpoint);
    const command = clone(fixture.commands[row.command]);
    setJsonPointer(row.mutation.target === 'board' ? board : command, row.mutation);
    const before = clone(board);
    const outcome = api.nativeAttemptApply(board, verifiedCommand(board, command));
    assert.deepEqual(board, before, `${row.id}: input board mutated on failure`);
    assert.equal(outcome.ok, false, `${row.id}: counterfeit success`);
    const issueCodes = new Set(outcome.issues?.map((issue) => issue.code) ?? []);
    const expectedIssue =
      {
        'bind-without-evidence-record': 'NATIVE-EVIDENCE-ENVELOPE-REQUIRED',
        'bind-wrong-create-link': 'NATIVE-EVIDENCE-SCOPE-MISMATCH',
      }[row.id] ?? row.issue;
    assert.ok(
      issueCodes.has(expectedIssue),
      `${row.id}: expected ${expectedIssue}, got ${JSON.stringify(outcome.issues ?? [])}`,
    );
    assert.deepEqual(outcome.board, before, `${row.id}: rejected operation partially wrote board`);
  }
}

test('fixture is self-contained, selection/candidate coherent, and private evidence is signed', () => {
  assert.equal(fixture.schema, 'ccm/native-attempt-fixture/v1');
  assert.equal(fixture.contract, 'ccm/native-attempt/v1');
  assert.equal(fixture.capability_intent.runtime_status, 'unsupported');
  assert.deepEqual(
    new Set(fixture.capability_intent.required_operations),
    new Set(['create', 'bind', 'cancel', 'terminal', 'reconcile']),
  );
  assert.equal(fixture.commands.cancel.request.control, 'interrupt-agent');

  const baseTask = task(fixture.initial_board);
  const selected = fixture.selection_snapshot;
  const create = fixture.commands.create;
  const candidate = baseTask.routing.policy.candidates.find(
    (entry: FixtureJson) => entry.id === selected.candidate_id,
  );
  assert.ok(candidate, 'selected candidate must exist in the self-contained policy');
  assert.ok(baseTask.routing.policy.chains[selected.chain].includes(selected.candidate_id));
  assert.equal(create.attempt.candidate_id, selected.candidate_id);
  assert.deepEqual(create.selection_snapshot, selected);
  assert.deepEqual(create.attempt.selection_snapshot, selected);
  assert.equal(create.attempt.lineage.expected_child_target, fixture.lineage.expected_child_target);
  assert.equal(JSON.stringify(fixture).includes('selection_ref'), false);

  const positiveEntry =
    fixture.private_evidence.owner_store.records[fixture.commands.bind.evidence_record_ref];
  const record = positiveEntry.record;
  const signed = canonicalSignedRecord(record);
  const hash = canonicalRecordHash(record);
  assert.equal(record.record_hash, hash);
  assert.deepEqual(positiveEntry.provenance, {
    store: 'ccm-owner-evidence/v1',
    owner_home_ref: fixture.private_evidence.configured_owner_home_ref,
    visibility: 'owner-only',
    record_ref: record.record_id,
  });
  assert.deepEqual(
    fixture.private_evidence.producer_registrations[record.producer.registration_ref],
    fixture.trusted_producer,
  );
  assert.equal(fixture.private_evidence.launch_claims[record.create_link.launch_claim_id], null);
  assert.equal(
    `sha256:${createHash('sha256')
      .update(Buffer.from(fixture.trusted_producer.public_key_spki_base64, 'base64'))
      .digest('hex')}`,
    fixture.trusted_producer.public_key_fingerprint,
  );
  assert.deepEqual(signed.producer, {
    producer_id: fixture.trusted_producer.producer_id,
    channel: fixture.trusted_producer.channel,
    registration_ref: fixture.trusted_producer.registration_ref,
  });
  assert.equal(signatureValid(record, fixture.trusted_producer.public_key_spki_base64), true);
  assert.equal(record.create_link.launch_claim_id, create.attempt.dispatch.launch_claim_id);
  assert.deepEqual(record.observed.current_lineage, create.attempt.lineage);
  assert.equal(record.observed.roster.handle, record.observed.handle);
  assert.equal(record.expected.child_target, create.attempt.lineage.expected_child_target);
  assert.equal(record.observed.canonical_target, create.attempt.lineage.expected_child_target);

  assert.deepEqual(fixture.commands.bind.verified_evidence, {
    ...signed,
    record_hash: record.record_hash,
    resolved_context: positiveEntry.fact_resolution,
  });
  assert.equal(Object.hasOwn(record, 'verified_by_ccm'), false);

  const issues = [
    ...fixture.negative_cases,
    ...fixture.endpoint_negative_cases,
    ...fixture.private_evidence.authentication_negative_vectors,
  ].map((entry: FixtureJson) => entry.issue);
  for (const required of [
    'NATIVE-HANDLE-MISSING',
    'NATIVE-HANDLE-UNATTESTED',
    'NATIVE-HANDLE-PARENT-SESSION',
    'NATIVE-LINEAGE-MISMATCH',
    'NATIVE-EXPECTED-CHILD-MISMATCH',
    'NATIVE-EVIDENCE-RECORD-MISSING',
    'NATIVE-EVIDENCE-OWNER-STORE-PROVENANCE',
    'NATIVE-EVIDENCE-CANONICAL-HASH-MISMATCH',
    'NATIVE-EVIDENCE-SIGNATURE-INVALID',
    'NATIVE-EVIDENCE-REGISTRATION-UNKNOWN',
    'NATIVE-EVIDENCE-TRUST-SCOPE-MISMATCH',
    'NATIVE-EVIDENCE-CLAIM-REUSED',
    'NATIVE-EVIDENCE-CALLER-VERIFICATION-FORBIDDEN',
    'NATIVE-EVIDENCE-UNTRUSTED-PRODUCER',
    'NATIVE-EVIDENCE-CREATE-LINK-MISMATCH',
    'NATIVE-ACCOUNT-FINGERPRINT-UNKNOWN',
    'NATIVE-ACCOUNT-FINGERPRINT-MISMATCH',
    'NATIVE-PERMISSION-PROFILE-INCOMPATIBLE',
    'NATIVE-PERMISSION-DENY-INCOMPATIBLE',
    'NATIVE-ATTEMPT-REPLAY-CONFLICT',
    'NATIVE-ATTEMPT-ACTIVE',
    'NATIVE-LAUNCH-REPLAY-DENIED',
    'NATIVE-TERMINAL-DIRECT-DONE',
    'NATIVE-CANCEL-UNCONFIRMED',
    'NATIVE-HANDOFF-UNSUPPORTED',
    'NATIVE-ROUTE-BIND-BYPASS',
    'NATIVE-ORPHAN-AUDIT-INCOMPLETE',
    'NATIVE-RECONCILE-CONFLICT',
  ]) {
    assert.ok(issues.includes(required), `missing executable negative ${required}`);
  }

  assert.deepEqual(
    fixture.endpoint_negative_cases.map((row: FixtureJson) => row.id),
    [
      'create-account-fingerprint-drift',
      'create-account-fingerprint-unknown',
      'create-permission-profile-incompatible',
      'create-permission-deny-incompatible',
      'bind-account-fingerprint-drift',
      'bind-account-fingerprint-unknown',
      'bind-permission-profile-incompatible',
      'bind-permission-deny-incompatible',
    ],
  );
});

test('private evidence vectors are independent precomputed cryptographic cases', () => {
  const vectors = fixture.private_evidence.authentication_negative_vectors;
  assert.deepEqual(
    vectors.map((row: FixtureJson) => row.id),
    [
      'bind-owner-store-provenance',
      'bind-bad-signature',
      'bind-bad-canonical-hash',
      'bind-unknown-registration',
      'bind-wrong-trust-scope',
      'bind-reused-claim',
      'bind-caller-verified-by-ccm',
    ],
  );
  const recordIds = new Set<string>();
  const recordHashes = new Set<string>();
  for (const vector of vectors) {
    const record = vector.owner_store_entry.record;
    assert.equal(vector.owner_store_entry.provenance.record_ref, record.record_id, vector.id);
    assert.equal(recordIds.has(record.record_id), false, `${vector.id}: reused record_id`);
    recordIds.add(record.record_id);
    assert.equal(recordHashes.has(record.record_hash), false, `${vector.id}: reused record_hash`);
    recordHashes.add(record.record_hash);
    assert.equal(
      canonicalRecordHash(record) === record.record_hash,
      vector.expected.canonical_hash_valid,
      `${vector.id}: canonical hash expectation drifted`,
    );
    assert.equal(
      signatureValid(record, vector.signer_public_key_spki_base64),
      vector.expected.signature_valid,
      `${vector.id}: signature expectation drifted`,
    );
  }

  const byId = Object.fromEntries(vectors.map((row: FixtureJson) => [row.id, row]));
  assert.notEqual(
    byId['bind-owner-store-provenance'].owner_store_entry.provenance.store,
    fixture.private_evidence.owner_store.schema,
  );
  assert.equal(byId['bind-bad-signature'].expected.canonical_hash_valid, true);
  assert.equal(byId['bind-bad-signature'].expected.signature_valid, false);
  assert.equal(byId['bind-bad-canonical-hash'].expected.canonical_hash_valid, false);
  assert.equal(byId['bind-bad-canonical-hash'].expected.signature_valid, true);
  assert.equal(
    Object.hasOwn(
      fixture.private_evidence.producer_registrations,
      byId['bind-unknown-registration'].owner_store_entry.record.producer.registration_ref,
    ),
    false,
  );
  const wrongScopeRegistration =
    fixture.private_evidence.producer_registrations[
      byId['bind-wrong-trust-scope'].owner_store_entry.record.producer.registration_ref
    ];
  assert.ok(wrongScopeRegistration);
  assert.notEqual(
    wrongScopeRegistration.trust_scope.origin_session_ref,
    fixture.commands.create.attempt.lineage.origin_session_ref,
  );
  assert.notEqual(
    byId['bind-reused-claim'].claim_prebound_record_hash,
    byId['bind-reused-claim'].owner_store_entry.record.record_hash,
  );
  assert.equal(
    Object.hasOwn(byId['bind-caller-verified-by-ccm'].owner_store_entry.record, 'verified_by_ccm'),
    true,
  );

  const bindVectors = [
    ...fixture.private_evidence.bind_lineage_negative_vectors,
    ...fixture.private_evidence.bind_content_negative_vectors,
  ];
  assert.equal(bindVectors.length, 10);
  for (const vector of bindVectors) {
    const record = vector.owner_store_entry.record;
    assert.equal(vector.owner_store_entry.provenance.record_ref, record.record_id, vector.id);
    assert.equal(recordIds.has(record.record_id), false, `${vector.id}: reused record_id`);
    recordIds.add(record.record_id);
    assert.equal(recordHashes.has(record.record_hash), false, `${vector.id}: reused record_hash`);
    recordHashes.add(record.record_hash);
    assert.equal(canonicalRecordHash(record), record.record_hash, vector.id);
    assert.equal(signatureValid(record, vector.signer_public_key_spki_base64), true, vector.id);
  }
});

test('feature detector fixture is replayable but makes no live-provider claim', () => {
  assert.equal(probeFixture.schema, 'ccm/native-attempt-feature-probe/codex-api-tool/v1');
  assert.equal(probeFixture.fixture_kind, 'sanitized-contract-template');
  assert.equal(probeFixture.capture_status, 'not-live-probe-evidence');
  assert.equal(probeFixture.version_is_capability_evidence, false);
  assert.equal(probeFixture.raw_evidence_stored, false);
  assert.deepEqual(
    new Set(probeFixture.required_operations),
    new Set(['spawn', 'list', 'wait', 'interrupt']),
  );
  assert.equal(probeFixture.cases[0].expected.runtime_status, 'unsupported');
  assert.equal(probeFixture.cases[0].expected.promotion_eligible, false);
});

test('engine endpoints ship while the checked-in synthetic probe remains unsupported', () => {
  const api = engineApi(engine);
  assert.deepEqual(
    api.nativeAttemptFeatureDecision(clone(probeFixture.cases[0].input)),
    probeFixture.cases[0].expected,
  );
});

test('counterfeit no-op validators and fixture lookup cannot satisfy the engine oracle', () => {
  const counterfeit = {
    NATIVE_ATTEMPT_CONTRACT: 'ccm/native-attempt/v1',
    NATIVE_HANDLE_EVIDENCE_RECORD_CODEX_API_TOOL:
      'ccm/native-handle-evidence-record/codex-api-tool/v1',
    NATIVE_ATTEMPT_FEATURE_PROBE_CODEX_API_TOOL:
      'ccm/native-attempt-feature-probe/codex-api-tool/v1',
    validateNativeAttempt: () => [],
    validateNativeHandleBinding: () => [],
    nativeAttemptFeatureDecision: () => clone(probeFixture.cases[0].expected),
    nativeAttemptApply: (board: FixtureJson, command: FixtureJson): ApplyResult => ({
      ok: true,
      board: clone(board),
      result: clone(fixture.expected[command.type] ?? {}),
    }),
  };
  assert.throws(
    () => assertCreateAndReplays(engineApi(counterfeit)),
    /attempts|selected|counterfeit|Expected values to be strictly equal/,
  );
});

test('feature detector endpoint evaluates every frozen probe case', () => {
  const api = engineApi(engine);
  for (const row of probeFixture.cases) {
    assert.deepEqual(api.nativeAttemptFeatureDecision(clone(row.input)), row.expected, row.id);
  }
});

test('create and exact replay cross the engine operation endpoint', () => {
  assertCreateAndReplays(engineApi(engine));
});

test('bind/cancel/terminal and exact replay mutate observable board state', () => {
  assertBindCancelTerminal(engineApi(engine));
});

test('exact bind replay remains a no-op after terminal lifecycle progression', () => {
  const api = engineApi(engine);
  const terminal = checkpoint(api, 'terminal');
  const before = clone(terminal);
  const replay = api.nativeAttemptApply(terminal, verifiedCommand(terminal, fixture.commands.bind));

  assert.equal(replay.ok, true, JSON.stringify(replay.issues ?? []));
  assert.equal(replay.result?.bound, false);
  assert.equal(replay.result?.attempt_id, fixture.commands.bind.attempt_id);
  assert.deepEqual(replay.board, before, 'post-terminal bind replay must not rewrite history');
  assert.deepEqual(terminal, before, 'post-terminal bind replay must not mutate its input');
});

test('create validates every frozen record boundary before append or launch permission', () => {
  const api = engineApi(engine);
  for (const row of CREATE_SCHEMA_MUTATIONS) {
    const board = clone(fixture.initial_board);
    const before = clone(board);
    const command = clone(fixture.commands.create);
    row.mutate(command.attempt);
    if (row.name.startsWith('selection ')) {
      command.selection_snapshot = clone(command.attempt.selection_snapshot);
    }
    const outcome = api.nativeAttemptApply(board, command);
    assert.equal(outcome.ok, false, row.name);
    assert.equal(outcome.result?.launch_allowed, undefined, row.name);
    assert.deepEqual(outcome.board, before, `${row.name}: rejected create returned changed board`);
    assert.deepEqual(board, before, `${row.name}: rejected create mutated input board`);
  }

  const orphaned = checkpoint(api, 'orphaned');
  const wrongNextOrdinal = clone(fixture.commands.create_second_after_orphan_audit);
  wrongNextOrdinal.attempt.ordinal = 999;
  const before = clone(orphaned);
  const outcome = api.nativeAttemptApply(orphaned, wrongNextOrdinal);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.result?.launch_allowed, undefined);
  assert.deepEqual(outcome.board, before);
  assert.deepEqual(orphaned, before);
});

test('cancel validates its exact immutable request before returning any host-control effect', () => {
  const api = engineApi(engine);
  for (const row of CANCEL_SCHEMA_MUTATIONS) {
    const board = checkpoint(api, 'running');
    const before = clone(board);
    const command = clone(fixture.commands.cancel);
    row.mutate(command.request);
    const outcome = api.nativeAttemptApply(board, command);
    assert.equal(outcome.ok, false, row.name);
    assert.equal(outcome.result?.host_control_effects, undefined, row.name);
    assert.deepEqual(outcome.board, before, `${row.name}: rejected cancel returned changed board`);
    assert.deepEqual(board, before, `${row.name}: rejected cancel mutated input board`);
  }
});

test('hard projection lint revalidates frozen create, cancel, and normalized binding records', () => {
  const api = engineApi(engine);
  for (const row of CREATE_SCHEMA_MUTATIONS) {
    const board = checkpoint(api, 'created');
    refreezeCreateIdentity(board, row.mutate);
    assertHardProjection(api, board, `stored create ${row.name}`);
  }

  for (const row of CANCEL_SCHEMA_MUTATIONS) {
    const board = checkpoint(api, 'cancelled-requested');
    row.mutate(attempt(board).cancel);
    assertHardProjection(api, board, `stored cancel ${row.name}`);
  }

  for (const row of HANDLE_BINDING_SCHEMA_MUTATIONS) {
    const board = checkpoint(api, 'running');
    row.mutate(attempt(board).handle_binding);
    assertHardProjection(api, board, `stored binding ${row.name}`);
  }
});

test('starting rejects shape-valid lifecycle records before bind or host control', () => {
  const api = engineApi(engine);
  const validRecords = [
    {
      name: 'cancel',
      install: (board: FixtureJson) => {
        attempt(board).cancel = clone(attempt(checkpoint(api, 'cancelled-requested')).cancel);
      },
    },
    {
      name: 'handle binding',
      install: (board: FixtureJson) => {
        attempt(board).handle_binding = clone(attempt(checkpoint(api, 'running')).handle_binding);
      },
    },
    {
      name: 'terminal',
      install: (board: FixtureJson) => {
        attempt(board).terminal = clone(attempt(checkpoint(api, 'terminal')).terminal);
      },
    },
  ];

  for (const row of validRecords) {
    const board = checkpoint(api, 'created');
    row.install(board);
    const before = clone(board);
    assertHardProjection(api, board, `starting with shape-valid ${row.name}`);

    const bind = api.nativeAttemptApply(board, verifiedCommand(board, fixture.commands.bind));
    assert.equal(bind.ok, false, `${row.name}: bind must fail before transition`);
    assert.ok(
      bind.issues?.some((issue) => issue.code === 'NATIVE-ATTEMPT-PROJECTION-MISMATCH'),
      `${row.name}: bind must report the hard projection failure`,
    );
    assert.deepEqual(bind.board, before, `${row.name}: rejected bind returned changed board`);
    assert.deepEqual(board, before, `${row.name}: rejected bind mutated input board`);
  }

  const preloadedCancel = checkpoint(api, 'created');
  attempt(preloadedCancel).cancel = clone(attempt(checkpoint(api, 'cancelled-requested')).cancel);
  const beforeCancel = clone(preloadedCancel);
  const counterfeitReplay = api.nativeAttemptApply(preloadedCancel, fixture.commands.cancel);
  assert.equal(counterfeitReplay.ok, false);
  assert.equal(counterfeitReplay.result?.host_control_effects, undefined);
  assert.deepEqual(counterfeitReplay.board, beforeCancel);
  assert.deepEqual(preloadedCancel, beforeCancel);

  const running = checkpoint(api, 'running');
  const firstRealCancel = applyOk(api, running, fixture.commands.cancel);
  assert.equal(firstRealCancel.result?.host_control_effects, 1);
});

test('stored reconciliation is complete, ordered, and value-bound before a later launch', () => {
  const api = engineApi(engine);
  const uncertain = checkpoint(api, 'uncertain');
  const recovered = applyOk(api, uncertain, fixture.commands.reconcile_running).board;
  const reconciledTerminal = applyOk(api, uncertain, fixture.commands.reconcile_terminal).board;
  const orphaned = checkpoint(api, 'orphaned');
  const records = {
    uncertain,
    running: recovered,
    terminal: reconciledTerminal,
    orphaned,
  };
  const requiredPaths: Record<string, string[]> = {
    uncertain: [
      '/classification',
      '/evidence_record_ref',
      '/evidence_hash',
      '/observed_at',
      '/reason_code',
      '/observed',
      '/observed/descriptor',
      '/observed/target',
      '/observed/source',
      '/observed/current_lineage',
    ],
    running: [
      '/classification',
      '/evidence_record_ref',
      '/evidence_hash',
      '/observed_at',
      '/same_handle_evidence_record_ref',
      '/handle',
      '/observed',
      '/observed/descriptor',
      '/observed/target',
      '/observed/source',
      '/observed/current_lineage',
      '/observed/handle',
      '/observed/handle_kind',
      '/observed/spawn',
      '/observed/spawn/target',
      '/observed/spawn/observed_at',
      '/observed/roster',
      '/observed/roster/target',
      '/observed/roster/handle',
      '/observed/roster/state',
      '/observed/roster/observed_at',
    ],
    terminal: [
      '/classification',
      '/evidence_record_ref',
      '/evidence_hash',
      '/observed_at',
      '/terminal',
      '/terminal/class',
      '/terminal/result_ref',
      '/terminal/artifact_refs',
      '/terminal/evidence_hash',
      '/observed',
      '/observed/descriptor',
      '/observed/target',
      '/observed/source',
      '/observed/current_lineage',
    ],
    orphaned: [
      '/classification',
      '/evidence_record_ref',
      '/evidence_hash',
      '/observed_at',
      '/orphan_audit',
      '/orphan_audit/origin_session_status',
      '/orphan_audit/handle_status',
      '/orphan_audit/worktree_authority',
      '/orphan_audit/account_authority',
      '/orphan_audit/audit_ref',
      '/orphan_audit/audit_hash',
      '/observed',
      '/observed/descriptor',
      '/observed/target',
      '/observed/source',
      '/observed/current_lineage',
    ],
  };

  for (const [classification, board] of Object.entries(records)) {
    for (const path of requiredPaths[classification] ?? []) {
      const mutated = clone(board);
      const record = attempt(mutated).reconciliation.at(-1);
      setJsonPointer(record, { op: 'remove', path });
      assertHardProjection(api, mutated, `${classification}: required ${path}`);
    }
  }

  const linkageMutations: Array<[string, FixtureJson, (record: FixtureJson) => void]> = [
    [
      'descriptor',
      orphaned,
      (record) => (record.observed.descriptor.adapter = 'codex/forged-adapter'),
    ],
    [
      'restored lineage',
      orphaned,
      (record) => (record.observed.current_lineage.worktree_ref = 'worktree-ref:forged'),
    ],
    ['private source', orphaned, (record) => (record.observed.source = 'caller-supplied')],
    ['observation target', reconciledTerminal, (record) => (record.observed.target = null)],
    [
      'running binding ref',
      recovered,
      (record) => (record.same_handle_evidence_record_ref = 'evidence:forged-bind'),
    ],
    ['running payload handle', recovered, (record) => (record.handle = 'agent-forged')],
    ['running observed handle', recovered, (record) => (record.observed.handle = 'agent-forged')],
    [
      'running observation time',
      recovered,
      (record) => (record.observed.roster.observed_at = '2026-07-13T08:00:41Z'),
    ],
    [
      'terminal projection',
      reconciledTerminal,
      (record) => (record.terminal.result_ref = 'artifact-ref:forged'),
    ],
    [
      'orphan fence projection',
      orphaned,
      (record) => (record.orphan_audit.audit_ref = 'owner-evidence://forged-audit'),
    ],
  ];
  for (const [name, board, mutate] of linkageMutations) {
    const mutated = clone(board);
    mutate(attempt(mutated).reconciliation.at(-1));
    assertHardProjection(api, mutated, `reconciliation ${name}`);
  }

  const duplicateEvidenceRef = clone(recovered);
  attempt(duplicateEvidenceRef).reconciliation[1].evidence_record_ref =
    attempt(duplicateEvidenceRef).reconciliation[0].evidence_record_ref;
  assertHardProjection(api, duplicateEvidenceRef, 'reconciliation evidence ref must be unique');

  const duplicateEvidenceHash = clone(recovered);
  attempt(duplicateEvidenceHash).reconciliation[1].evidence_hash =
    attempt(duplicateEvidenceHash).reconciliation[0].evidence_hash;
  assertHardProjection(api, duplicateEvidenceHash, 'reconciliation evidence hash must be unique');

  const nonMonotonic = clone(recovered);
  attempt(nonMonotonic).reconciliation[1].observed_at =
    attempt(nonMonotonic).reconciliation[0].observed_at;
  attempt(nonMonotonic).reconciliation[1].observed.roster.observed_at =
    attempt(nonMonotonic).reconciliation[0].observed_at;
  assertHardProjection(api, nonMonotonic, 'reconciliation observation time must increase');

  const reordered = clone(recovered);
  attempt(reordered).reconciliation.reverse();
  assertHardProjection(api, reordered, 'reconciliation records cannot be reordered');

  const synthetic = checkpoint(api, 'created');
  const syntheticAttempt = attempt(synthetic);
  const validAudit = clone(attempt(orphaned).orphan_audit);
  syntheticAttempt.state = 'orphaned';
  syntheticAttempt.orphan_audit = validAudit;
  syntheticAttempt.reconciliation = [
    { classification: 'uncertain' },
    { classification: 'orphaned' },
  ];
  task(synthetic).status = 'ready';
  delete task(synthetic).handle;
  assertHardProjection(api, synthetic, 'classification-only history with plausible orphan audit');
  const before = clone(synthetic);
  const second = api.nativeAttemptApply(
    synthetic,
    fixture.commands.create_second_after_orphan_audit,
  );
  assert.equal(second.ok, false);
  assert.notEqual(second.result?.launch_allowed, true);
  assert.deepEqual(second.board, before);
  assert.deepEqual(synthetic, before);
});

test('valid native no-handle projections do not emit the legacy executor-handle warning', () => {
  const api = engineApi(engine);
  const lint = engineExports.lintBoard as (text: string) => {
    errors: Array<{ rule: string }>;
    warnings: Array<{ rule: string }>;
  };
  for (const state of ['created', 'uncertain', 'terminal', 'orphaned']) {
    const board = checkpoint(api, state);
    const result = lint(JSON.stringify(board));
    assert.equal(
      result.warnings.some((entry) => entry.rule === 'BIZ-EXECUTOR-HANDLE'),
      false,
      state,
    );
  }

  const nonNative = clone(fixture.initial_board);
  task(nonNative).status = 'in_flight';
  const legacy = lint(JSON.stringify(nonNative));
  assert.equal(
    legacy.warnings.some((entry) => entry.rule === 'BIZ-EXECUTOR-HANDLE'),
    true,
    'non-native subagent tasks retain the warning',
  );
});

test('dedicated reconcile covers uncertain/running/terminal/orphaned projections', () => {
  assertReconcile(engineApi(engine));
});

test('fenced orphan projection composes with dependency gating without weakening projection lint', () => {
  const api = engineApi(engine);
  const uncertain = checkpoint(api, 'uncertain');
  uncertain.tasks.unshift({
    id: 'T-native-upstream',
    status: 'ready',
    deps: [],
    executor: 'user',
  });
  task(uncertain).deps = ['T-native-upstream'];

  const orphaned = applyOk(api, uncertain, fixture.commands.reconcile_orphaned);
  const reconcileGating = engineExports.reconcileGating as (board: FixtureJson) => FixtureJson;
  const gated = reconcileGating(orphaned.board);
  assert.equal(task(gated).status, 'blocked', 'unsatisfied deps must remain authoritative');
  assert.deepEqual(
    api.validateNativeAttemptProjection(gated),
    [],
    'dependency-derived blocked must be a valid fenced-orphan projection',
  );

  const falselyBlocked = clone(gated);
  const upstream = falselyBlocked.tasks.find(
    (entry: FixtureJson) => entry.id === 'T-native-upstream',
  );
  upstream.status = 'done';
  upstream.verified = true;
  upstream.artifact = 'artifact://trusted-upstream';
  assertHardProjection(
    api,
    falselyBlocked,
    'orphaned must not accept blocked when ordinary dependency gating resolves ready',
  );
});

test('every mutation returns its issue code with failure atomicity', () => {
  assertNegativeCases(engineApi(engine));
});

test('immutable create identity replays after every lifecycle advance and rejects same-hash drift', () => {
  const api = engineApi(engine);
  const checkpointNames = [
    'created',
    'running',
    'cancelled-requested',
    'terminal',
    'uncertain',
    'orphaned',
  ];
  for (const name of checkpointNames) {
    const board = checkpoint(api, name);
    const replay = applyOk(api, board, fixture.commands.create);
    assert.equal(replay.result?.created, false, name);
    assert.equal(replay.result?.launch_allowed, false, name);
    assert.deepEqual(
      replay.board,
      board,
      `${name}: replay must ignore mutable lifecycle projection`,
    );

    const drift = clone(fixture.commands.create);
    drift.attempt.lineage.baseline_commit = '3333333333333333333333333333333333333333';
    const conflict = api.nativeAttemptApply(board, drift);
    assert.equal(conflict.ok, false, name);
    assert.ok(
      conflict.issues?.some((issue) => issue.code === 'NATIVE-ATTEMPT-REPLAY-CONFLICT'),
      name,
    );
    assert.deepEqual(conflict.board, board, `${name}: conflicting replay must be failure-atomic`);
  }

  const orphaned = checkpoint(api, 'orphaned');
  const second = applyOk(api, orphaned, fixture.commands.create_second_after_orphan_audit).board;
  const afterSecond = applyOk(api, second, fixture.commands.create);
  assert.deepEqual(
    afterSecond.board,
    second,
    'old exact create remains replayable after later append',
  );

  const reconciledRunning = applyOk(
    api,
    checkpoint(api, 'uncertain'),
    fixture.commands.reconcile_running,
  ).board;
  const replayAfterReconcile = applyOk(api, reconciledRunning, fixture.commands.create);
  assert.deepEqual(replayAfterReconcile.board, reconciledRunning);

  const reconciledTerminal = applyOk(
    api,
    checkpoint(api, 'uncertain'),
    fixture.commands.reconcile_terminal,
  ).board;
  const replayAfterReconciledTerminal = applyOk(api, reconciledTerminal, fixture.commands.create);
  assert.deepEqual(replayAfterReconciledTerminal.board, reconciledTerminal);
});

test('create hash is canonical UTF-8 SHA-256 and hard lint recomputes it in the browser IIFE', () => {
  const api = engineApi(engine);
  const unicodeCreate = clone(fixture.commands.create);
  unicodeCreate.attempt.lineage.origin_session_ref = 'session-ref:原点-🚀';
  unicodeCreate.attempt.dispatch.claim_owner_session_ref = 'session-ref:原点-🚀';
  unicodeCreate.admission_snapshot.current_lineage.origin_session_ref = 'session-ref:原点-🚀';
  const created = applyOk(api, clone(fixture.initial_board), unicodeCreate).board;
  const current = attempt(created);
  assert.equal(
    current.create_hash,
    `sha256:${createHash('sha256').update(stableJson(current.create_snapshot)).digest('hex')}`,
  );

  const tampered = clone(created);
  const originalHash = attempt(tampered).create_hash as string;
  attempt(tampered).create_hash = `sha256:${originalHash
    .slice(7)
    .replace(/^./, (hex: string) => (hex === '0' ? '1' : '0'))}`;
  assert.match(attempt(tampered).create_hash, /^sha256:[0-9a-f]{64}$/);
  assert.ok(
    api
      .validateNativeAttemptProjection(tampered)
      .some((issue) => issue.code === 'NATIVE-ATTEMPT-PROJECTION-MISMATCH'),
  );
  const nodeLint = (
    engineExports.lintBoard as (text: string) => { errors: Array<{ rule: string }> }
  )(JSON.stringify(tampered));
  assert.ok(nodeLint.errors.some((entry) => entry.rule === 'BIZ-NATIVE-ATTEMPT-PROJECTION'));

  const iife = readFileSync(join(HERE, '..', 'dist', 'index.iife.js'), 'utf8');
  const context = vm.createContext({ __nativeBoard: JSON.stringify(tampered) });
  vm.runInContext(iife, context, { filename: 'index.iife.js' });
  const browserRules = JSON.parse(
    vm.runInContext(
      'JSON.stringify(globalThis.__ccmEngine.lintBoard(__nativeBoard).errors.map((e) => e.rule))',
      context,
    ),
  );
  assert.ok(browserRules.includes('BIZ-NATIVE-ATTEMPT-PROJECTION'));
});

test('descriptor and permission admission are closed, ordered, and deny-set based', () => {
  const api = engineApi(engine);
  const stricter = clone(fixture.commands.create);
  stricter.admission_snapshot.permission.effective_profile = 'read-only';
  stricter.admission_snapshot.permission.required_denies.reverse();
  stricter.admission_snapshot.permission.effective_denies = [
    'filesystem-outside-worktree',
    ...stricter.admission_snapshot.permission.required_denies.slice().reverse(),
  ];
  assert.equal(applyOk(api, clone(fixture.initial_board), stricter).ok, true);

  const missingDeny = clone(fixture.commands.create);
  missingDeny.admission_snapshot.permission.effective_denies = ['account-mutation'];
  const missing = api.nativeAttemptApply(clone(fixture.initial_board), missingDeny);
  assert.equal(missing.ok, false);
  assert.ok(missing.issues?.some((issue) => issue.code === 'NATIVE-PERMISSION-DENY-INCOMPATIBLE'));

  const weaker = clone(fixture.commands.create);
  weaker.admission_snapshot.permission.effective_profile = 'danger-full-access';
  const weak = api.nativeAttemptApply(clone(fixture.initial_board), weaker);
  assert.equal(weak.ok, false);
  assert.ok(weak.issues?.some((issue) => issue.code === 'NATIVE-PERMISSION-PROFILE-INCOMPATIBLE'));

  const foreign = clone(fixture.initial_board);
  task(foreign).routing.policy.candidates[0].adapter = 'claude/agent-tool-v1';
  const unsupported = api.nativeAttemptApply(foreign, clone(fixture.commands.create));
  assert.equal(unsupported.ok, false);
  assert.ok(unsupported.issues?.some((issue) => issue.code === 'NATIVE-DESCRIPTOR-UNSUPPORTED'));

  const createMutations = [
    (_board: FixtureJson, command: FixtureJson) => {
      command.attempt.candidate_id = 'foreign-native';
      command.attempt.selection_snapshot.candidate_id = 'foreign-native';
      command.selection_snapshot.candidate_id = 'foreign-native';
    },
    (_board: FixtureJson, command: FixtureJson) => {
      command.attempt.surface = 'background-shell';
    },
    (_board: FixtureJson, command: FixtureJson) => {
      command.attempt.transport = 'codex-cli';
    },
    (board: FixtureJson) => {
      task(board).routing.policy.candidates[0].harness = 'claude-code';
    },
    (board: FixtureJson) => {
      task(board).routing.policy.candidates[0].adapter = 'claude/agent-tool-v1';
    },
    (board: FixtureJson) => {
      task(board).routing.policy.candidates[0].surface = 'background-shell';
    },
  ];
  for (const [index, mutate] of createMutations.entries()) {
    const board = clone(fixture.initial_board);
    const command = clone(fixture.commands.create);
    mutate(board, command);
    const rejected = api.nativeAttemptApply(board, command);
    assert.equal(rejected.ok, false, `create descriptor mutation ${index}`);
    assert.ok(
      rejected.issues?.some((issue) => issue.code === 'NATIVE-DESCRIPTOR-UNSUPPORTED'),
      `create descriptor mutation ${index}`,
    );
  }

  const created = checkpoint(api, 'created');
  for (const field of ['origin', 'harness', 'adapter', 'surface', 'transport']) {
    const tampered = clone(created);
    attempt(tampered).descriptor[field] = `forged-${field}`;
    assert.ok(
      api.validateNativeAttemptProjection(tampered).length > 0,
      `stored descriptor field ${field}`,
    );
  }
  const candidateTamper = clone(created);
  attempt(candidateTamper).candidate_id = 'foreign-native';
  assert.ok(api.validateNativeAttemptProjection(candidateTamper).length > 0);

  const coherentForeign = clone(fixture.initial_board);
  const foreignCandidate = task(coherentForeign).routing.policy.candidates[0];
  foreignCandidate.id = 'claude-native';
  foreignCandidate.harness = 'claude-code';
  foreignCandidate.adapter = 'claude/agent-tool-v1';
  foreignCandidate.surface = 'host-native';
  task(coherentForeign).routing.policy.chains.ample = ['claude-native'];
  const foreignCommand = clone(fixture.commands.create);
  foreignCommand.selection_snapshot.candidate_id = 'claude-native';
  foreignCommand.attempt.candidate_id = 'claude-native';
  foreignCommand.attempt.transport = 'claude-agent-tool';
  foreignCommand.attempt.selection_snapshot.candidate_id = 'claude-native';
  const inherited = api.nativeAttemptApply(coherentForeign, foreignCommand);
  assert.equal(inherited.ok, false);
  assert.ok(inherited.issues?.some((issue) => issue.code === 'NATIVE-DESCRIPTOR-UNSUPPORTED'));
});

test('create and cancel authority are bound to the immutable current lineage', () => {
  const api = engineApi(engine);
  const lineageDrifts: Array<[string, (lineage: FixtureJson) => void]> = [
    ['origin session', (lineage) => (lineage.origin_session_ref = 'session-ref:foreign')],
    ['workspace', (lineage) => (lineage.workspace_ref = 'workspace-ref:foreign')],
    ['worktree', (lineage) => (lineage.worktree_ref = 'worktree-ref:foreign')],
    [
      'baseline',
      (lineage) => (lineage.baseline_commit = '9999999999999999999999999999999999999999'),
    ],
  ];

  for (const [name, mutate] of lineageDrifts) {
    const board = clone(fixture.initial_board);
    const before = clone(board);
    const command = clone(fixture.commands.create);
    mutate(command.admission_snapshot.current_lineage);
    const outcome = api.nativeAttemptApply(board, command);
    assert.equal(outcome.ok, false, `create/${name}`);
    assert.equal(outcome.result?.launch_allowed, undefined, `create/${name}`);
    assert.ok(
      outcome.issues?.some((issue) => issue.code === 'NATIVE-LINEAGE-MISMATCH'),
      `create/${name}: ${JSON.stringify(outcome.issues ?? [])}`,
    );
    assert.deepEqual(outcome.board, before, `create/${name}: partial write`);
    assert.deepEqual(board, before, `create/${name}: input mutation`);
  }

  const missingCurrent = clone(fixture.commands.create);
  delete missingCurrent.admission_snapshot.current_lineage;
  const missing = api.nativeAttemptApply(clone(fixture.initial_board), missingCurrent);
  assert.equal(missing.ok, false, 'create/missing current lineage');
  assert.ok(missing.issues?.some((issue) => issue.code === 'NATIVE-LINEAGE-MISMATCH'));

  for (const [name, mutate] of lineageDrifts) {
    const board = checkpoint(api, 'running');
    const before = clone(board);
    const command = clone(fixture.commands.cancel);
    mutate(command.authority_snapshot.current_lineage);
    const outcome = api.nativeAttemptApply(board, command);
    assert.equal(outcome.ok, false, `cancel/${name}`);
    assert.equal(outcome.result?.host_control_effects, undefined, `cancel/${name}`);
    assert.ok(
      outcome.issues?.some((issue) => issue.code === 'NATIVE-LINEAGE-MISMATCH'),
      `cancel/${name}: ${JSON.stringify(outcome.issues ?? [])}`,
    );
    assert.deepEqual(outcome.board, before, `cancel/${name}: partial write`);
    assert.deepEqual(board, before, `cancel/${name}: input mutation`);
  }

  const unrelatedRequesterBoard = checkpoint(api, 'running');
  const unrelatedRequester = clone(fixture.commands.cancel);
  unrelatedRequester.request.requested_by_session_ref = 'session-ref:unrelated-requester';
  const requesterOutcome = api.nativeAttemptApply(unrelatedRequesterBoard, unrelatedRequester);
  assert.equal(requesterOutcome.ok, false, 'cancel/unrelated requester');
  assert.equal(requesterOutcome.result?.host_control_effects, undefined);
  assert.ok(
    requesterOutcome.issues?.some((issue) => issue.code === 'NATIVE-LINEAGE-MISMATCH'),
    JSON.stringify(requesterOutcome.issues ?? []),
  );
});

test('verified evidence envelope rejects raw/forged scope and requires authoritative live target', () => {
  const api = engineApi(engine);
  const created = checkpoint(api, 'created');
  const raw = api.nativeAttemptApply(created, clone(fixture.commands.bind));
  assert.equal(raw.ok, false);
  assert.ok(raw.issues?.some((issue) => issue.code === 'NATIVE-EVIDENCE-ENVELOPE-REQUIRED'));

  const forgedScope = verifiedCommand(created, fixture.commands.bind);
  forgedScope.verified_evidence.scope.harness = 'claude-code';
  const scopeResult = api.nativeAttemptApply(created, forgedScope);
  assert.equal(scopeResult.ok, false);
  assert.ok(scopeResult.issues?.some((issue) => issue.code === 'NATIVE-EVIDENCE-SCOPE-MISMATCH'));

  const fallback = verifiedCommand(created, fixture.commands.bind);
  delete fallback.verified_evidence.observed.spawn.target;
  const fallbackResult = api.nativeAttemptApply(created, fallback);
  assert.equal(fallbackResult.ok, false);
  assert.ok(fallbackResult.issues?.some((issue) => issue.code === 'NATIVE-HANDLE-UNATTESTED'));

  const stricter = verifiedCommand(created, fixture.commands.bind);
  stricter.verified_evidence.observed.current_lineage.permission.profile = 'read-only';
  stricter.verified_evidence.observed.current_lineage.permission.denies.push('network');
  assert.equal(api.nativeAttemptApply(created, stricter).ok, true);

  const running = checkpoint(api, 'running');
  const badTerminal = verifiedCommand(running, fixture.commands.terminal);
  badTerminal.verified_evidence.payload.class = 'caller-claimed-success';
  const terminalResult = api.nativeAttemptApply(running, badTerminal);
  assert.equal(terminalResult.ok, false);
  assert.ok(
    terminalResult.issues?.some((issue) => issue.code === 'NATIVE-TERMINAL-EVIDENCE-INVALID'),
  );

  for (const field of ['origin', 'harness', 'adapter', 'surface', 'transport']) {
    const forgedDescriptor = verifiedCommand(created, fixture.commands.bind);
    forgedDescriptor.verified_evidence.observed.descriptor[field] = `forged-${field}`;
    const rejected = api.nativeAttemptApply(created, forgedDescriptor);
    assert.equal(rejected.ok, false, field);
    assert.ok(
      rejected.issues?.some((issue) => issue.code === 'NATIVE-DESCRIPTOR-UNSUPPORTED'),
      field,
    );
  }
});

test('each evidence transition applies its explicit lineage policy', () => {
  const api = engineApi(engine);
  const uncertain = checkpoint(api, 'uncertain');
  const cases = [
    {
      name: 'bind',
      board: checkpoint(api, 'created'),
      command: fixture.commands.bind,
    },
    {
      name: 'terminal',
      board: checkpoint(api, 'running'),
      command: fixture.commands.terminal,
    },
    {
      name: 'reconcile-running',
      board: uncertain,
      command: fixture.commands.reconcile_running,
    },
    {
      name: 'reconcile-terminal',
      board: uncertain,
      command: fixture.commands.reconcile_terminal,
    },
  ];

  for (const row of cases) {
    const stricter = verifiedCommand(row.board, row.command);
    stricter.verified_evidence.observed.current_lineage.permission.profile = 'read-only';
    stricter.verified_evidence.observed.current_lineage.permission.denies.push('network');
    assert.equal(api.nativeAttemptApply(row.board, stricter).ok, true, `${row.name}: stricter`);

    const drift = verifiedCommand(row.board, row.command);
    drift.verified_evidence.observed.current_lineage.workspace_ref = 'workspace-ref:foreign';
    const rejected = api.nativeAttemptApply(row.board, drift);
    assert.equal(rejected.ok, false, `${row.name}: drift`);
    assert.ok(
      rejected.issues?.some((issue) => issue.code === 'NATIVE-LINEAGE-MISMATCH'),
      `${row.name}: drift`,
    );
  }

  const structurallyCompleteDrift = verifiedCommand(
    checkpoint(api, 'running'),
    fixture.commands.reconcile_uncertain,
  );
  structurallyCompleteDrift.verified_evidence.observed.current_lineage.workspace_ref =
    'workspace-ref:drifted';
  structurallyCompleteDrift.verified_evidence.observed.current_lineage.baseline_commit =
    '4444444444444444444444444444444444444444';
  assert.equal(
    api.nativeAttemptApply(checkpoint(api, 'running'), structurallyCompleteDrift).ok,
    true,
    'uncertain may classify complete lineage drift without restoring authority',
  );

  const arbitrary = verifiedCommand(
    checkpoint(api, 'running'),
    fixture.commands.reconcile_uncertain,
  );
  arbitrary.verified_evidence.observed.current_lineage = { arbitrary: 'caller object' };
  const arbitraryResult = api.nativeAttemptApply(checkpoint(api, 'running'), arbitrary);
  assert.equal(arbitraryResult.ok, false);
  assert.ok(arbitraryResult.issues?.some((issue) => issue.code === 'NATIVE-LINEAGE-MISMATCH'));

  const stricterOrphan = verifiedCommand(uncertain, fixture.commands.reconcile_orphaned);
  stricterOrphan.verified_evidence.observed.current_lineage.permission.profile = 'read-only';
  stricterOrphan.verified_evidence.observed.current_lineage.permission.denies.push('network');
  assert.equal(api.nativeAttemptApply(uncertain, stricterOrphan).ok, true);

  const driftedOrphan = verifiedCommand(uncertain, fixture.commands.reconcile_orphaned);
  driftedOrphan.verified_evidence.observed.current_lineage.account_fingerprint_ref =
    'account-ref:foreign';
  const orphanRejected = api.nativeAttemptApply(uncertain, driftedOrphan);
  assert.equal(orphanRejected.ok, false);
  assert.ok(orphanRejected.issues?.some((issue) => issue.code === 'NATIVE-LINEAGE-MISMATCH'));
});

test('every evidence class rechecks immutable envelope scope, descriptor, target, and lineage', () => {
  const api = engineApi(engine);
  const rows = [
    { name: 'bind', board: checkpoint(api, 'created'), command: fixture.commands.bind },
    { name: 'terminal', board: checkpoint(api, 'running'), command: fixture.commands.terminal },
    {
      name: 'reconcile',
      board: checkpoint(api, 'running'),
      command: fixture.commands.reconcile_uncertain,
    },
  ];
  const scopeFields = [
    'contract',
    'origin',
    'harness',
    'adapter',
    'surface',
    'transport',
    'task_id',
    'attempt_id',
    'candidate_id',
    'dispatch_key',
    'request_hash',
    'launch_claim_id',
    'create_hash',
  ];
  for (const row of rows) {
    const reject = (
      label: string,
      mutate: (command: FixtureJson) => void,
      expectedCode: string,
    ) => {
      const command = verifiedCommand(row.board, row.command);
      mutate(command);
      const result = api.nativeAttemptApply(row.board, command);
      assert.equal(result.ok, false, `${row.name}/${label}`);
      assert.ok(
        result.issues?.some((issue) => issue.code === expectedCode),
        `${row.name}/${label}: ${JSON.stringify(result.issues ?? [])}`,
      );
      assert.deepEqual(result.board, row.board, `${row.name}/${label}: partial write`);
    };

    reject(
      'class',
      (command) => {
        command.verified_evidence.evidence_class =
          command.verified_evidence.evidence_class === 'bind' ? 'terminal' : 'bind';
      },
      'NATIVE-EVIDENCE-SCOPE-MISMATCH',
    );
    reject(
      'record-ref',
      (command) => {
        command.evidence_record_ref = `${command.evidence_record_ref}-forged`;
      },
      'NATIVE-EVIDENCE-SCOPE-MISMATCH',
    );
    reject(
      'record-hash',
      (command) => {
        command.verified_evidence.record_hash = 'sha256:not-a-hash';
      },
      'NATIVE-EVIDENCE-SCOPE-MISMATCH',
    );
    for (const field of scopeFields) {
      reject(
        `scope-${field}`,
        (command) => {
          command.verified_evidence.scope[field] = `forged-${field}`;
        },
        'NATIVE-EVIDENCE-SCOPE-MISMATCH',
      );
    }
    for (const field of ['origin', 'harness', 'adapter', 'surface', 'transport']) {
      reject(
        `descriptor-${field}`,
        (command) => {
          command.verified_evidence.observed.descriptor[field] = `forged-${field}`;
        },
        'NATIVE-DESCRIPTOR-UNSUPPORTED',
      );
    }
    reject(
      'target',
      (command) => {
        command.verified_evidence.observed.target = '/root/forged-target';
      },
      row.name === 'reconcile'
        ? 'NATIVE-EVIDENCE-SCOPE-MISMATCH'
        : 'NATIVE-EXPECTED-CHILD-MISMATCH',
    );
    reject(
      'lineage',
      (command) => {
        command.verified_evidence.observed.current_lineage = { forged: true };
      },
      'NATIVE-LINEAGE-MISMATCH',
    );
  }
});

test('shared projection/mutation guard is hard, force-independent input for every state writer', () => {
  const api = engineApi(engine);
  const activeBoards = [
    ['starting', checkpoint(api, 'created')],
    ['running', checkpoint(api, 'running')],
    ['uncertain', checkpoint(api, 'uncertain')],
  ] as const;
  for (const [state, before] of activeBoards) {
    for (const field of ['status', 'handle']) {
      const after = clone(before);
      task(after)[field] = field === 'status' ? 'failed' : 'caller-handle';
      assert.ok(
        api
          .validateNativeAttemptMutation(before, after, 'generic', ['T-native-v1'])
          .some((issue) => issue.code === 'NATIVE-DEDICATED-WRITER-REQUIRED'),
        `${state}: ${field}`,
      );
    }
    assert.ok(
      api
        .validateNativeAttemptMutation(before, before, 'generic-state', ['T-native-v1'])
        .some((issue) => issue.code === 'NATIVE-DEDICATED-WRITER-REQUIRED'),
      `${state}: targeted intent`,
    );

    const withUnrelated = clone(before);
    withUnrelated.tasks.push({
      id: 'T-unrelated',
      status: 'ready',
      deps: [],
      executor: 'subagent',
    });
    assert.deepEqual(
      api.validateNativeAttemptMutation(withUnrelated, withUnrelated, 'generic-state', [
        'T-unrelated',
      ]),
      [],
      `${state}: a generic-state writer aimed at another task must remain usable`,
    );
  }

  const created = checkpoint(api, 'created');
  const badStarting = clone(created);
  task(badStarting).status = 'uncertain';
  const linted = (engineExports.lintBoard as (text: string) => { errors: Array<{ rule: string }> })(
    JSON.stringify(badStarting),
  );
  assert.ok(linted.errors.some((entry) => entry.rule === 'BIZ-NATIVE-ATTEMPT-PROJECTION'));

  const blocked = clone(created);
  task(blocked).blocked_on = 'user';
  assert.ok(
    api
      .validateNativeAttemptMutation(created, blocked, 'generic')
      .some((issue) => issue.code === 'NATIVE-DEDICATED-WRITER-REQUIRED'),
  );
  const removed = clone(created);
  removed.tasks = [];
  assert.ok(
    api
      .validateNativeAttemptMutation(created, removed, 'generic')
      .some((issue) => issue.code === 'NATIVE-DEDICATED-WRITER-REQUIRED'),
  );

  const terminal = checkpoint(api, 'terminal');
  const premature = clone(terminal);
  task(premature).status = 'done';
  assert.ok(api.validateNativeAttemptProjection(premature).length > 0);
  const accepted = clone(terminal);
  Object.assign(task(accepted), { status: 'done', verified: true, artifact: '/tmp/native-result' });
  assert.deepEqual(api.validateNativeAttemptProjection(accepted), []);

  const trueDoneNegatives: Array<[string, (board: FixtureJson) => void]> = [
    ['verified absent', (board) => delete task(board).verified],
    ['verified false', (board) => (task(board).verified = false)],
    ['artifact absent', (board) => delete task(board).artifact],
    ['artifact empty', (board) => (task(board).artifact = '')],
    ['terminal class', (board) => (attempt(board).terminal.class = 'caller-success')],
    ['terminal observed_at', (board) => (attempt(board).terminal.observed_at = 'yesterday')],
    ['terminal result_ref', (board) => (attempt(board).terminal.result_ref = '')],
    ['terminal artifact_refs', (board) => (attempt(board).terminal.artifact_refs = [''])],
    ['terminal evidence_record_ref', (board) => (attempt(board).terminal.evidence_record_ref = '')],
    ['terminal evidence_hash', (board) => (attempt(board).terminal.evidence_hash = 'sha256:nope')],
  ];
  for (const [name, mutate] of trueDoneNegatives) {
    const negative = clone(accepted);
    mutate(negative);
    assert.ok(api.validateNativeAttemptProjection(negative).length > 0, name);
  }
  for (const status of ['failed', 'ready']) {
    const parentChoice = clone(terminal);
    task(parentChoice).status = status;
    assert.deepEqual(api.validateNativeAttemptProjection(parentChoice), [], status);
  }
});
