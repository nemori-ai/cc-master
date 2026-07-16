import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMPTY_WINDOW,
  mergeBackward,
  mergeForward,
  offsetOfEvent,
  resetToTail,
  STREAM_WINDOW_CAP,
  type StreamWindow,
} from '../src/streamWindow';
import type { AgentStreamPayload, StreamEvent } from '../src/types';
import { readWorkspaceUrlState, writeWorkspaceUrlState } from '../src/workspaceUrlState';

function ev(offset: number, idx = 0): StreamEvent {
  return { id: `${offset}.${idx}`, kind: 'assistant', title: 'assistant', text: `e${offset}` };
}

function page(
  events: StreamEvent[],
  cursor: { next: number; prev: number; at_start: boolean },
  extra: Partial<AgentStreamPayload> = {},
): AgentStreamPayload {
  return {
    agent_id: 'a',
    mode: 'tail',
    source: { kind: 'transcript', harness: 'claude-code', size: 10_000 },
    live: { active: true, as_of: 'now' },
    cursor,
    events,
    reset: false,
    ...extra,
  };
}

test('offsetOfEvent decodes the line byte offset from the stable id', () => {
  assert.equal(offsetOfEvent(ev(4210, 2)), 4210);
  assert.equal(offsetOfEvent({ ...ev(0), id: 'garbage' }), 0);
});

test('resetToTail seeds a window and flags omittedTop when not at the head', () => {
  const w = resetToTail(page([ev(100), ev(200)], { next: 300, prev: 100, at_start: false }));
  assert.deepEqual(
    w.events.map((e) => e.id),
    ['100.0', '200.0'],
  );
  assert.equal(w.cursorNext, 300);
  assert.equal(w.cursorPrev, 100);
  assert.equal(w.atStart, false);
  assert.equal(w.omittedTop, true);
  assert.equal(w.omittedBottom, false);

  const head = resetToTail(page([ev(0)], { next: 50, prev: 0, at_start: true }));
  assert.equal(head.omittedTop, false);
  assert.equal(head.atStart, true);
});

test('mergeForward appends, dedups by id, and advances the forward cursor', () => {
  const w0 = resetToTail(page([ev(100), ev(200)], { next: 300, prev: 100, at_start: true }));
  const w1 = mergeForward(w0, page([ev(200), ev(300)], { next: 400, prev: 300, at_start: false }));
  // ev(200) already held -> not duplicated; ev(300) appended.
  assert.deepEqual(
    w1.events.map((e) => e.id),
    ['100.0', '200.0', '300.0'],
  );
  assert.equal(w1.cursorNext, 400);
  assert.equal(w1.cursorPrev, 100); // prev unchanged while under cap
});

test('mergeBackward prepends older events, dedups, and retreats the backward cursor', () => {
  const w0 = resetToTail(page([ev(300), ev(400)], { next: 500, prev: 300, at_start: false }));
  const w1 = mergeBackward(
    w0,
    page([ev(100), ev(200), ev(300)], { next: 300, prev: 100, at_start: true }),
  );
  // ev(300) already held -> not duplicated; 100/200 prepended in order.
  assert.deepEqual(
    w1.events.map((e) => e.id),
    ['100.0', '200.0', '300.0', '400.0'],
  );
  assert.equal(w1.cursorPrev, 100);
  assert.equal(w1.atStart, true);
  assert.equal(w1.cursorNext, 500); // forward frontier untouched by backward paging
});

test('mergeForward evicts the oldest past the cap and re-anchors cursorPrev/omittedTop', () => {
  let w: StreamWindow = EMPTY_WINDOW;
  const first = Array.from({ length: STREAM_WINDOW_CAP }, (_v, i) => ev(i + 1));
  w = resetToTail(page(first, { next: STREAM_WINDOW_CAP + 1, prev: 1, at_start: true }));
  assert.equal(w.events.length, STREAM_WINDOW_CAP);

  const more = [ev(STREAM_WINDOW_CAP + 1), ev(STREAM_WINDOW_CAP + 2)];
  w = mergeForward(w, page(more, { next: STREAM_WINDOW_CAP + 3, prev: 1, at_start: true }));
  assert.equal(w.events.length, STREAM_WINDOW_CAP, 'window stays capped');
  assert.equal(w.omittedTop, true, 'older events evicted from the top');
  assert.equal(w.atStart, false, 'no longer at the head once the top is evicted');
  // earliest retained is now offset 3 (two evicted from the front of 1..CAP+2).
  assert.equal(w.cursorPrev, 3);
  assert.equal(w.events[0]?.id, '3.0');
});

test('mergeBackward evicts the newest past the cap and flags omittedBottom', () => {
  const held = Array.from({ length: STREAM_WINDOW_CAP }, (_v, i) => ev(1000 + i));
  const w0 = resetToTail(page(held, { next: 99_999, prev: 1000, at_start: false }));
  const older = [ev(10), ev(20)];
  const w1 = mergeBackward(w0, page(older, { next: 1000, prev: 10, at_start: true }));
  assert.equal(w1.events.length, STREAM_WINDOW_CAP);
  assert.equal(w1.omittedBottom, true);
  assert.equal(w1.events[0]?.id, '10.0', 'older events kept at the top');
});

test('stream URL flag round-trips only alongside an agent selection', () => {
  const withAgent = readWorkspaceUrlState('http://x/?agent=agt-1&stream=1');
  assert.equal(withAgent.agent, 'agt-1');
  assert.equal(withAgent.stream, true);

  // stream=1 without an agent is meaningless -> false.
  assert.equal(readWorkspaceUrlState('http://x/?stream=1').stream, false);

  const written = writeWorkspaceUrlState('http://x/', {
    task: null,
    agent: 'agt-1',
    stream: true,
    filters: new Set(),
  });
  assert.match(written, /agent=agt-1/);
  assert.match(written, /stream=1/);

  // clearing the agent drops the stream flag from the URL.
  const cleared = writeWorkspaceUrlState('http://x/?agent=agt-1&stream=1', {
    task: null,
    agent: null,
    stream: true,
    filters: new Set(),
  });
  assert.doesNotMatch(cleared, /stream=1/);
  assert.doesNotMatch(cleared, /agent=/);
});
