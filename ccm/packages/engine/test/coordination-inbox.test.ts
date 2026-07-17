// coordination-inbox.test.ts — ADR-032 notification inbox aggregate + reconcile write gate.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as M from '../dist/index.mjs';

const NOW = '2026-07-09T12:00:00Z';
const LATER = '2026-07-09T13:00:00Z';
const EXPIRES = '2026-07-09T17:00:00Z';

function boardWithInbox(inbox?: unknown): Record<string, unknown> {
  const board: Record<string, unknown> = {
    schema: 'cc-master/v2',
    goal: 'inbox test',
    owner: { active: true, session_id: 's' },
    git: { worktree: '', branch: '' },
    tasks: [],
  };
  if (inbox !== undefined) board.coordination = { inbox };
  return board;
}

test('FIELDS/ENUMS/INVARIANTS expose coordination inbox model facts', () => {
  assert.equal(M.FIELDS.board.coordination.tier, '✎');
  assert.deepEqual(M.ENUMS.notificationKind, [
    'pacing_throttle',
    'pacing_yield',
    'pacing_claim',
    'pacing_switch',
    'pacing_stop',
    'hitl_turn',
    'artifact_serialize',
    'quota_state_change',
    'deadline_risk',
  ]);
  const inv = M.INVARIANTS.find((item: { id: string }) => item.id === 'FMT-INBOX');
  assert.ok(inv, 'FMT-INBOX must be registered');
  assert.equal(inv.level, 'warn');
});

test('NotificationInbox append creates unconsumed immutable notification', () => {
  const empty = M.NotificationInbox.fromBoard({});
  const next = empty.append(
    {
      kind: 'pacing_yield',
      summary: 'Yield to urgent peer',
      strength: 'strong',
      payload: { peer: 'A' },
      expires_at: EXPIRES,
    },
    NOW,
  );
  assert.equal(empty.toArray().length, 0, 'append must not mutate previous instance');
  const items = next.toArray();
  assert.equal(items.length, 1);
  assert.match(items[0].id, /^ntf-20260709T120000Z-/);
  assert.equal(items[0].status, 'unconsumed');
  assert.equal(items[0].created_at, NOW);
  assert.equal(items[0].consumed_at, null);
});

test('NotificationInbox ack is idempotent and only consumes unconsumed items', () => {
  let inbox = M.NotificationInbox.empty().append(
    { kind: 'pacing_stop', summary: 'Stop', expires_at: EXPIRES },
    NOW,
  );
  const id = inbox.toArray()[0].id;
  inbox = inbox.ack(id, LATER, 'Stopped dispatch');
  inbox = inbox.ack(id, LATER, 'Second ack');
  const item = inbox.toArray()[0];
  assert.equal(item.status, 'consumed');
  assert.equal(item.consumed_at, LATER);
  assert.equal(item.consumed_note, 'Stopped dispatch');
});

test('NotificationInbox reconcile expires stale unconsumed notifications', () => {
  const inbox = M.NotificationInbox.empty().append(
    {
      kind: 'pacing_throttle',
      summary: 'Throttle',
      expires_at: '2026-07-09T11:59:59Z',
    },
    NOW,
  );
  const item = inbox.reconcile(NOW).toArray()[0];
  assert.equal(item.status, 'expired');
});

test('NotificationInbox reconcile supersedes older unconsumed notification per kind', () => {
  let inbox = M.NotificationInbox.empty().append(
    { kind: 'pacing_yield', summary: 'Old yield', expires_at: EXPIRES },
    NOW,
  );
  const oldId = inbox.toArray()[0].id;
  inbox = inbox.append({ kind: 'pacing_yield', summary: 'New yield', expires_at: EXPIRES }, LATER);
  const items = inbox.reconcile(LATER).toArray();
  const old = items.find((item: { id: string }) => item.id === oldId);
  const unconsumed = items.filter((item: { status: string }) => item.status === 'unconsumed');
  assert.equal(old.status, 'expired');
  assert.equal(old.superseded_by, unconsumed[0].id);
  assert.equal(unconsumed.length, 1);
});

test('quota notifications supersede only within the same target scope', () => {
  let inbox = M.NotificationInbox.empty().append(
    {
      id: 'codex-old',
      kind: 'quota_state_change',
      summary: 'Codex old',
      payload: { scope_digest: 'scope-codex' },
      expires_at: EXPIRES,
    },
    NOW,
  );
  inbox = inbox.append(
    {
      id: 'claude',
      kind: 'quota_state_change',
      summary: 'Claude',
      payload: { scope_digest: 'scope-claude' },
      expires_at: EXPIRES,
    },
    LATER,
  );
  inbox = inbox.append(
    {
      id: 'codex-new',
      kind: 'quota_state_change',
      summary: 'Codex new',
      payload: { scope_digest: 'scope-codex' },
      expires_at: EXPIRES,
    },
    LATER,
  );
  const items = inbox.reconcile(LATER).toArray();
  assert.deepEqual(
    items
      .filter((item: { status: string }) => item.status === 'unconsumed')
      .map((item: { id: string }) => item.id)
      .sort(),
    ['claude', 'codex-new'],
  );
  assert.equal(
    items.find((item: { id: string }) => item.id === 'codex-old').superseded_by,
    'codex-new',
  );
});

test('NotificationInbox reconcile GC removes old terminal items by TTL and capacity', () => {
  const consumed = {
    ...M.NotificationInbox.empty()
      .append({ kind: 'pacing_claim', summary: 'Claim', expires_at: EXPIRES }, NOW)
      .toArray()[0],
    status: 'consumed',
    consumed_at: LATER,
    consumed_note: null,
  };
  const inbox = M.NotificationInbox.fromBoard(boardWithInbox([consumed]));
  assert.equal(inbox.reconcile('2026-07-11T13:00:00Z').toArray().length, 0);

  const terminal = ['pacing_claim', 'hitl_turn', 'artifact_serialize'].map((kind, i) => ({
    ...M.NotificationInbox.empty()
      .append(
        {
          kind,
          summary: `N${i}`,
          expires_at: EXPIRES,
        },
        `2026-07-09T12:00:0${i}Z`,
      )
      .toArray()[0],
    status: 'consumed',
    consumed_at: LATER,
    consumed_note: null,
  }));
  const capped = M.NotificationInbox.fromBoard(boardWithInbox(terminal))
    .reconcile(LATER, { capacity: 2 })
    .toArray();
  assert.equal(capped.length, 2, 'capacity trims oldest terminal notifications');
  assert.deepEqual(
    capped.map((item: { summary: string }) => item.summary),
    ['N1', 'N2'],
  );
});

test('reconcileInbox updates board.coordination.inbox without materializing missing inbox', () => {
  const missing = boardWithInbox();
  assert.deepEqual(M.reconcileInbox(missing, NOW), missing);

  const board = boardWithInbox([
    {
      id: 'n1',
      kind: 'pacing_throttle',
      status: 'unconsumed',
      created_at: NOW,
      expires_at: '2026-07-09T11:00:00Z',
      strength: 'weak',
      summary: 'Throttle',
      payload: {},
      consumed_at: null,
      consumed_note: null,
    },
  ]);
  const next = M.reconcileInbox(board, NOW);
  assert.equal(next.coordination.inbox[0].status, 'expired');
  assert.equal(board.coordination.inbox[0].status, 'unconsumed', 'input board is immutable');
});

test('FMT-INBOX warns but never hard-errors on malformed inbox', () => {
  const bad = boardWithInbox([{ id: 'x', kind: 'bad', status: 'unconsumed' }, 42]);
  const result = M.lintBoard(JSON.stringify(bad));
  assert.equal(result.errors.length, 0);
  assert.ok(result.warnings.some((w: { rule: string }) => w.rule === 'FMT-INBOX'));
});
