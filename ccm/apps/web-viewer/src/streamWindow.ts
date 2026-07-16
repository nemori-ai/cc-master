import type { AgentStreamPayload, StreamEvent } from './types';

// Sliding in-memory window over the agent transcript. The server tails/pages by byte-offset
// cursor; the client keeps at most STREAM_WINDOW_CAP events and evicts from the side away from
// the direction of travel (append newer -> evict oldest from the top; prepend older -> evict
// newest from the bottom). Eviction is signalled by omittedTop / omittedBottom so the drawer can
// render a "more above/below" placeholder. All merges dedup by the stable event id
// (`${lineByteOffset}.${blockIndex}`), so overlapping pages never double-render or tear.

export const STREAM_WINDOW_CAP = 900;

export interface StreamWindow {
  events: StreamEvent[];
  cursorNext: number; // forward frontier (a prior cursor.next) — where live/forward polling resumes
  cursorPrev: number; // earliest held line offset (a prior cursor.prev) — where backward paging resumes
  atStart: boolean; // reached file head (nothing older to page)
  omittedTop: boolean; // older events evicted from memory (paging back can re-pull)
  omittedBottom: boolean; // newer events evicted from memory (jump-to-latest re-tails)
}

export const EMPTY_WINDOW: StreamWindow = {
  events: [],
  cursorNext: 0,
  cursorPrev: 0,
  atStart: true,
  omittedTop: false,
  omittedBottom: false,
};

/** Line byte offset encoded in an event id (`${offset}.${idx}`) — the backward-paging anchor. */
export function offsetOfEvent(event: StreamEvent): number {
  const n = Number(event.id.split('.')[0]);
  return Number.isFinite(n) ? n : 0;
}

/**
 * File-identity rotation check: a page whose `source.ino` differs from the last accepted one
 * means the same path now names a different file — every held byte offset (and every event id
 * derived from one) is garbage, so the caller must drop the window and re-tail from scratch.
 * Absent inode info (either side) is never treated as rotation.
 */
export function sourceRotated(lastIno: number | null, page: AgentStreamPayload): boolean {
  const ino = page.source.ino;
  if (typeof ino !== 'number' || lastIno === null) return false;
  return ino !== lastIno;
}

/** Fresh window from a tail (or reset) page — replaces whatever was held. */
export function resetToTail(page: AgentStreamPayload): StreamWindow {
  return {
    events: page.events.slice(),
    cursorNext: page.cursor.next,
    cursorPrev: page.cursor.prev,
    atStart: page.cursor.at_start,
    omittedTop: !page.cursor.at_start,
    omittedBottom: false,
  };
}

// Eviction is line-group aware: one transcript line can yield several events sharing the same
// byte-offset prefix (`${lineStart}.0/.1/.2`). Cutting inside such a group would tear a turn
// apart AND break the cursorPrev "line start" anchor semantics — so both evictors move the cut
// to a group boundary (evicting slightly more than the raw cap overflow when needed).

/** Index of the first event at or after `from` that starts a new line group. */
function groupStartAtOrAfter(events: StreamEvent[], from: number): number {
  let cut = from;
  while (cut > 0 && cut < events.length) {
    const here = events[cut];
    const prev = events[cut - 1];
    if (!here || !prev || offsetOfEvent(here) !== offsetOfEvent(prev)) break;
    cut++;
  }
  return cut;
}

/** Index just past the last event before `until` that ends a line group. */
function groupEndAtOrBefore(events: StreamEvent[], until: number): number {
  let cut = until;
  while (cut > 0 && cut < events.length) {
    const here = events[cut];
    const prev = events[cut - 1];
    if (!here || !prev || offsetOfEvent(here) !== offsetOfEvent(prev)) break;
    cut--;
  }
  return cut;
}

/** Merge a forward (newer) page: append, dedup, evict oldest whole line groups past the cap. */
export function mergeForward(win: StreamWindow, page: AgentStreamPayload): StreamWindow {
  const held = new Set(win.events.map((e) => e.id));
  const fresh = page.events.filter((e) => !held.has(e.id));
  let events = fresh.length ? [...win.events, ...fresh] : win.events;
  let omittedTop = win.omittedTop;
  let cursorPrev = win.cursorPrev;
  let atStart = win.atStart;
  if (events.length > STREAM_WINDOW_CAP) {
    const cut = groupStartAtOrAfter(events, events.length - STREAM_WINDOW_CAP);
    if (cut > 0 && cut < events.length) {
      events = events.slice(cut);
      omittedTop = true;
      atStart = false;
      const first = events[0];
      if (first) cursorPrev = offsetOfEvent(first);
    }
  }
  return {
    events,
    cursorNext: page.cursor.next,
    cursorPrev,
    atStart,
    omittedTop,
    omittedBottom: win.omittedBottom,
  };
}

/** Merge a backward (older) page: prepend, dedup, evict newest whole line groups past the cap. */
export function mergeBackward(win: StreamWindow, page: AgentStreamPayload): StreamWindow {
  const held = new Set(win.events.map((e) => e.id));
  const fresh = page.events.filter((e) => !held.has(e.id));
  let events = fresh.length ? [...fresh, ...win.events] : win.events;
  let omittedBottom = win.omittedBottom;
  if (events.length > STREAM_WINDOW_CAP) {
    const cut = groupEndAtOrBefore(events, STREAM_WINDOW_CAP);
    if (cut > 0 && cut < events.length) {
      events = events.slice(0, cut);
      omittedBottom = true;
    }
  }
  return {
    events,
    cursorNext: win.cursorNext,
    cursorPrev: page.cursor.prev,
    atStart: page.cursor.at_start,
    omittedTop: win.omittedTop,
    omittedBottom,
  };
}
