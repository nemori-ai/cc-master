import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

function r2Create(): { board: Json; command: Json } {
  const board = clone(fixture.initial_board);
  const command = clone(fixture.commands.create);
  const attempt = command.attempt;
  const authority = command.launch_authority;
  const ticket = authority.ticket;

  attempt.dispatch.key = ticket.launch_idempotency_key;
  attempt.dispatch.run_ref = 'ccm-run:v1:native-fixture-001';
  attempt.dispatch.launch_claim_id = ticket.launch_nonce;
  ticket.run_ref = attempt.dispatch.run_ref;
  ticket.launch_idempotency_key = attempt.dispatch.key;
  ticket.launch_nonce = attempt.dispatch.launch_claim_id;
  authority.claim_id = attempt.dispatch.launch_claim_id;
  authority.canonical_identity.dispatch = {
    run_ref: attempt.dispatch.run_ref,
    idempotency_key: attempt.dispatch.key,
    launch_nonce: attempt.dispatch.launch_claim_id,
    claim_id: attempt.dispatch.launch_claim_id,
  };
  authority.ticket_digest = digest(ticket);
  authority.reservation.ticket_digest = authority.ticket_digest;
  authority.canonical_identity_digest = digest(authority.canonical_identity);
  return { board, command };
}

function redigest(command: Json): void {
  command.launch_authority.ticket_digest = digest(command.launch_authority.ticket);
  command.launch_authority.reservation.ticket_digest = command.launch_authority.ticket_digest;
}

test('R2 canonical launch identity admits one exact run/idempotency/nonce/claim tuple', () => {
  const value = r2Create();
  const result = engine.nativeAttemptApply(value.board, value.command);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.result?.launch_allowed, true);
});

test('R2 coherently re-digested ticket substitutions cannot cross native dispatch identity', () => {
  const cases: Array<[string, (command: Json) => void]> = [
    ['run_ref', (command) => (command.launch_authority.ticket.run_ref = 'ccm-run:v1:other')],
    [
      'launch_idempotency_key',
      (command) =>
        (command.launch_authority.ticket.launch_idempotency_key =
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    ],
    [
      'launch_nonce',
      (command) => (command.launch_authority.ticket.launch_nonce = 'launch-nonce:other'),
    ],
  ];
  for (const [label, mutate] of cases) {
    const value = r2Create();
    mutate(value.command);
    redigest(value.command);
    const before = clone(value.board);
    const result = engine.nativeAttemptApply(value.board, value.command);
    assert.equal(result.ok, false, `${label} substitution must fail closed`);
    assert.deepEqual(result.board, before, `${label} substitution mutated board`);
  }
});

test('R2 attempt/ticket/claim combinations cannot be replayed across identities', () => {
  const cases: Array<[string, (command: Json) => void]> = [
    ['attempt run', (command) => (command.attempt.dispatch.run_ref = 'ccm-run:v1:other')],
    [
      'attempt idempotency key',
      (command) =>
        (command.attempt.dispatch.key =
          'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
    ],
    [
      'native claim',
      (command) => (command.attempt.dispatch.launch_claim_id = 'launch-claim:other'),
    ],
    ['authority claim', (command) => (command.launch_authority.claim_id = 'launch-claim:other')],
  ];
  for (const [label, mutate] of cases) {
    const value = r2Create();
    mutate(value.command);
    redigest(value.command);
    const before = clone(value.board);
    const result = engine.nativeAttemptApply(value.board, value.command);
    assert.equal(result.ok, false, `${label} replay combination must fail closed`);
    assert.deepEqual(result.board, before, `${label} replay combination mutated board`);
  }
});
