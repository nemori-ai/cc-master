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
const clone = <T>(value: T): T => structuredClone(value);

test('R1 bind rejects spawn-before-create and roster-before-spawn without mutating board', () => {
  const created = engine.nativeAttemptApply(clone(fixture.initial_board), clone(fixture.commands.create));
  assert.equal(created.ok, true, JSON.stringify(created.issues));
  const attempt = created.board.tasks[0].routing.attempts[0];
  const raw = clone(fixture.commands.bind.verified_evidence);
  raw.observed.spawn.observed_at = '2026-07-13T07:59:00Z';
  raw.observed.roster.observed_at = '2026-07-13T07:58:59Z';
  const command = {
    type: 'bind',
    task_id: fixture.commands.bind.task_id,
    attempt_id: attempt.id,
    evidence_record_ref: raw.record_id,
    verified_evidence: {
      schema: 'ccm/native-verified-evidence/v1',
      evidence_class: 'bind',
      record_ref: raw.record_id,
      record_hash: raw.record_hash,
      scope: {
        contract: attempt.schema,
        ...clone(attempt.descriptor),
        task_id: fixture.commands.bind.task_id,
        attempt_id: attempt.id,
        candidate_id: attempt.candidate_id,
        dispatch_key: attempt.dispatch.key,
        request_hash: attempt.dispatch.request_hash,
        launch_claim_id: attempt.dispatch.launch_claim_id,
        create_hash: attempt.create_hash,
      },
      producer: {
        producer_id: raw.producer.producer_id,
        channel: raw.producer.channel,
      },
      resolved_context: clone(raw.resolved_context),
      observed: {
        descriptor: clone(attempt.descriptor),
        target: raw.observed.canonical_target,
        source: 'authoritative-spawn-and-roster',
        current_lineage: clone(raw.observed.current_lineage),
        handle: raw.observed.handle,
        handle_kind: raw.observed.handle_kind,
        spawn: { ...clone(raw.observed.spawn), target: raw.observed.canonical_target },
        roster: { ...clone(raw.observed.roster), target: raw.observed.canonical_target },
      },
      payload: { durability_class: 'legacy_session_bound' },
    },
  };
  const before = clone(created.board);
  const result = engine.nativeAttemptApply(created.board, command);
  assert.equal(result.ok, false);
  assert.deepEqual(result.board, before);
});
