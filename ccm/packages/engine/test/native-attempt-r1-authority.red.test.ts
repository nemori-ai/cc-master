import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as engine from '../dist/index.mjs';

type Json = Record<string, any>;

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures/native-attempt/codex-api-tool-v1.json'),
    'utf8',
  ),
) as Json;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function digest(value: unknown): string {
  return engine.canonicalSha256Digest(value);
}

function authority(command: Json): Json {
  const attempt = command.attempt;
  const lineage = attempt.lineage;
  const inputHash = 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  attempt.dispatch.input_hash = inputHash;
  const ticket = {
    schema: 'ccm/quota-admission-ticket/v1',
    ticket_id: 'ticket-native-fixture-001',
    reservation_id: 'qres-native-fixture-001',
    reservation_request_hash:
      'sha256:3333333333333333333333333333333333333333333333333333333333333333',
    reservation_expires_at: '2099-07-13T08:05:00Z',
    attempt_id: attempt.id,
    run_ref: attempt.dispatch.run_ref,
    account_id: 'account-native-fixture',
    pool_id: 'pool-native-fixture',
    identity_fingerprint: 'sha256:4444444444444444444444444444444444444444444444444444444444444444',
    aggregation_key: 'sha256:5555555555555555555555555555555555555555555555555555555555555555',
    live_source_revision: 'sha256:6666666666666666666666666666666666666666666666666666666666666666',
    runtime_sha256: 'sha256:7777777777777777777777777777777777777777777777777777777777777777',
    launch_idempotency_key: attempt.dispatch.key,
    launch_nonce: attempt.dispatch.launch_claim_id,
    issued_at: '2026-07-13T07:59:58Z',
    committed_at: '2026-07-13T07:59:59Z',
    launch_by: '2099-07-13T08:04:00Z',
  };
  const ticketDigest = digest(ticket);
  const canonicalIdentity = {
    schema: 'ccm/canonical-launch-identity/v1',
    origin: { harness: 'codex', session_ref: lineage.origin_session_ref },
    target: {
      harness: 'codex',
      adapter: 'codex/api-tool-multi-agent-v1',
      surface: attempt.surface,
      transport: attempt.transport,
      candidate_id: attempt.candidate_id,
    },
    provider: { id: 'openai', model: 'host-default', effort: 'medium' },
    account: {
      fingerprint_ref: lineage.account_fingerprint_ref,
      account_id: ticket.account_id,
      pool_id: ticket.pool_id,
      identity_fingerprint: ticket.identity_fingerprint,
    },
    workspace: {
      workspace_ref: lineage.workspace_ref,
      worktree_ref: lineage.worktree_ref,
      baseline_commit: lineage.baseline_commit,
    },
    permission: clone(lineage.permission),
    input: { digest: inputHash },
    request: { digest: attempt.dispatch.request_hash },
    dispatch: {
      run_ref: attempt.dispatch.run_ref,
      idempotency_key: attempt.dispatch.key,
      launch_nonce: attempt.dispatch.launch_claim_id,
      claim_id: attempt.dispatch.launch_claim_id,
    },
    runtime: {
      image_sha256: ticket.runtime_sha256,
      selector: { kind: 'exact', model_id: 'host-default', effort: 'medium' },
    },
  };
  return {
    schema: 'ccm/native-launch-authority/v1',
    claim_id: attempt.dispatch.launch_claim_id,
    canonical_identity: canonicalIdentity,
    canonical_identity_digest: digest(canonicalIdentity),
    reservation: {
      schema: 'ccm/quota-reservation/v1',
      reservation_id: ticket.reservation_id,
      request_hash: ticket.reservation_request_hash,
      state: 'committed',
      expires_at: ticket.reservation_expires_at,
      attempt_id: ticket.attempt_id,
      candidate_id: attempt.candidate_id,
      account_id: ticket.account_id,
      pool_id: ticket.pool_id,
      identity_fingerprint: ticket.identity_fingerprint,
      ticket_digest: ticketDigest,
    },
    ticket,
    ticket_digest: ticketDigest,
  };
}

function validCreate(): { board: Json; command: Json } {
  const board = clone(fixture.initial_board);
  const command = clone(fixture.commands.create);
  command.launch_authority = authority(command);
  return { board, command };
}

test('R1 launch authority is mandatory and one canonical identity gates launch_allowed', () => {
  const valid = validCreate();
  const accepted = engine.nativeAttemptApply(valid.board, valid.command);
  assert.equal(accepted.ok, true, JSON.stringify(accepted.issues));
  assert.equal(accepted.result?.launch_allowed, true);

  const missing = validCreate();
  delete missing.command.launch_authority;
  const missingBefore = clone(missing.board);
  const missingResult = engine.nativeAttemptApply(missing.board, missing.command);
  assert.equal(missingResult.ok, false, 'missing committed authority must not launch');
  assert.deepEqual(missingResult.board, missingBefore);

  const held = validCreate();
  held.command.launch_authority.reservation.state = 'held';
  const heldResult = engine.nativeAttemptApply(held.board, held.command);
  assert.equal(heldResult.ok, false, 'held reservation must not launch');
  assert.deepEqual(heldResult.board, held.board);
});

test('R1 canonical identity rejects provider/model/effort/runtime/workspace/worktree substitutions', () => {
  const cases: Array<[string, (board: Json, command: Json) => void]> = [
    ['provider', (board) => (board.tasks[0].routing.policy.candidates[0].provider = 'forged')],
    ['model', (board) => (board.tasks[0].routing.policy.candidates[0].model = 'forged-model')],
    ['effort', (board) => (board.tasks[0].routing.policy.candidates[0].effort = 'high')],
    [
      'runtime',
      (_board, command) =>
        (command.launch_authority.ticket.runtime_sha256 =
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    ],
    [
      'selector',
      (_board, command) =>
        (command.launch_authority.canonical_identity.runtime.selector.model_id = 'forged-model'),
    ],
    [
      'workspace',
      (_board, command) => (command.attempt.lineage.workspace_ref = 'workspace-ref:forged'),
    ],
    [
      'worktree',
      (_board, command) => (command.attempt.lineage.worktree_ref = 'worktree-ref:forged'),
    ],
    [
      'account',
      (_board, command) => (command.attempt.lineage.account_fingerprint_ref = 'account-ref:forged'),
    ],
    [
      'permission',
      (_board, command) => command.attempt.lineage.permission.denies.push('forged-deny'),
    ],
    [
      'input digest',
      (_board, command) =>
        (command.attempt.dispatch.input_hash =
          'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
    ],
    [
      'request digest',
      (_board, command) =>
        (command.attempt.dispatch.request_hash =
          'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'),
    ],
  ];
  for (const [label, mutate] of cases) {
    const value = validCreate();
    mutate(value.board, value.command);
    const before = clone(value.board);
    const result = engine.nativeAttemptApply(value.board, value.command);
    assert.equal(result.ok, false, `${label} substitution must fail closed`);
    assert.deepEqual(result.board, before, `${label} substitution mutated board`);
  }
});

test('R1 hard projection binds current launch authority to the immutable create snapshot', () => {
  const value = validCreate();
  const accepted = engine.nativeAttemptApply(value.board, value.command);
  assert.equal(accepted.ok, true, JSON.stringify(accepted.issues));
  const attempt = accepted.board.tasks[0].routing.attempts[0];
  attempt.launch_authority.ticket.ticket_id = 'ticket-native-fixture-forged';
  attempt.launch_authority.ticket_digest = digest(attempt.launch_authority.ticket);
  attempt.launch_authority.reservation.ticket_digest = attempt.launch_authority.ticket_digest;

  const issues = engine.validateNativeAttemptProjection(accepted.board);
  assert.equal(
    issues.some((issue: Json) => issue.code === 'NATIVE-ATTEMPT-PROJECTION-MISMATCH'),
    true,
    JSON.stringify(issues),
  );
});
