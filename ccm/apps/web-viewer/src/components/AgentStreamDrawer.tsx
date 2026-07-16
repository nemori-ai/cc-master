import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { harnessBadge } from '../agentFormat';
import { loadAgentStream } from '../api';
import {
  EMPTY_WINDOW,
  mergeBackward,
  mergeForward,
  resetToTail,
  type StreamWindow,
} from '../streamWindow';
import type { AgentStreamPayload, StreamEvent } from '../types';

const POLL_MS = 1500;
const BOTTOM_THRESHOLD = 48; // px from bottom counted as "pinned to live"
const TOP_THRESHOLD = 200; // px from top triggers an older-history fetch
// Backward pages may legally carry zero events while the cursor still progresses (windows full
// of server-dropped line types, oversized-line skips). Auto-follow up to this many consecutive
// empty pages per fetch, then pause auto-triggering and hand control back to the button.
const MAX_EMPTY_BACK_HOPS = 10;
// Consecutive forward-poll transport failures before the loop stops and surfaces a retry state.
const MAX_POLL_FAILURES = 4;

interface AgentStreamDrawerProps {
  agentId: string;
  intent?: string;
  boardFilename?: string;
  onClose: () => void;
}

// One event row. Memoized + keyed by the stable server id so appends/prepends never re-render the
// rest of the list. `content-visibility:auto` keeps off-screen rows out of layout/paint — the
// windowing strategy with zero new dependencies and no manual scroll math.
const StreamRow = memo(function StreamRow({ event }: { event: StreamEvent }) {
  const time = event.ts ? event.ts.replace('T', ' ').replace('Z', '') : '';
  return (
    <div className="stream-row" data-kind={event.kind}>
      <div className="stream-row-head">
        <span className="stream-kind">{event.kind}</span>
        <span className="stream-title">{event.title}</span>
        {time ? <span className="stream-ts mono">{time}</span> : null}
        {event.truncated ? <span className="stream-trunc">truncated</span> : null}
      </div>
      {event.text ? <pre className="stream-text">{event.text}</pre> : null}
      {event.detail ? (
        <details className="stream-detail">
          <summary>detail</summary>
          <pre className="stream-text mono">{event.detail}</pre>
        </details>
      ) : null}
    </div>
  );
});

/**
 * Agent live-stream drawer — an independent overlay that slides in from the right and renders a
 * server-normalized transcript tail. Zero client-side parsing: every event comes shaped from
 * `/agent-stream.json`. Performance: polls only while open (1.5s, byte-cursor incremental),
 * caps memory to a sliding window, evicts off the side away from travel, batches each poll into
 * one state write, memoizes rows, and windows the DOM via content-visibility. Two modes:
 * `following` (pinned to bottom, forward-polls, auto-scrolls) and history browsing (scroll up to
 * page older; a peek poll counts new events without disturbing the viewport). Backward paging
 * triggers three ways — the explicit button, scrolling near the top, and an auto-fill pass when
 * the window is shorter than the viewport — and auto-follows empty-but-progressing pages up to a
 * hop cap before yielding control back to the button.
 */
export function AgentStreamDrawer({
  agentId,
  intent,
  boardFilename,
  onClose,
}: AgentStreamDrawerProps) {
  const [win, setWin] = useState<StreamWindow>(EMPTY_WINDOW);
  const [source, setSource] = useState<AgentStreamPayload['source'] | null>(null);
  const [live, setLive] = useState(false);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [following, setFollowing] = useState(true);
  const [pendingBelow, setPendingBelow] = useState(0);
  const [ready, setReady] = useState(false);
  // Bumping remounts the whole load cycle: manual retry after a dead poll loop, and the
  // client-side rotation reaction (source inode changed under the same path).
  const [reloadNonce, setReloadNonce] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const winRef = useRef(win);
  winRef.current = win;
  const followingRef = useRef(following);
  followingRef.current = following;
  const loadingOlderRef = useRef(loadingOlder);
  loadingOlderRef.current = loadingOlder;
  // Set before a backward prepend so the layout effect can restore the viewport anchor.
  const prependAnchor = useRef<{ prevHeight: number; prevTop: number } | null>(null);
  // File identity from the last accepted page. A changed inode means the path now names a
  // different file (truncate-then-regrow rotation the server's size check cannot see) — every
  // held offset is garbage, so the whole window reloads.
  const sourceInoRef = useRef<number | null>(null);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Returns true (and schedules a full reload) when the page reveals a different file identity.
  const detectRotation = useCallback((page: AgentStreamPayload): boolean => {
    const ino = page.source.ino;
    if (typeof ino !== 'number') return false;
    if (sourceInoRef.current !== null && sourceInoRef.current !== ino) {
      setReloadNonce((n) => n + 1);
      return true;
    }
    sourceInoRef.current = ino;
    return false;
  }, []);

  // Initial / agent-change / retry / rotation load: fresh tail, pinned to live.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reloadNonce` is the re-run trigger (manual retry / rotation), not an input read by the effect body.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setReady(false);
    setInitialError(null);
    setPollError(null);
    setWin(EMPTY_WINDOW);
    setFollowing(true);
    setPendingBelow(0);
    sourceInoRef.current = null;
    loadAgentStream(agentId, { boardFilename, cursor: 'tail' }, controller.signal)
      .then((page) => {
        if (cancelled) return;
        sourceInoRef.current = typeof page.source.ino === 'number' ? page.source.ino : null;
        setSource(page.source);
        setLive(page.live.active);
        setWin(resetToTail(page));
        setReady(true);
      })
      .catch((error) => {
        if (cancelled || controller.signal.aborted) return;
        setInitialError(error instanceof Error ? error.message : 'stream unavailable');
        setReady(true);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [agentId, boardFilename, reloadNonce]);

  // Pin to bottom after the first successful tail render.
  useLayoutEffect(() => {
    if (ready && followingRef.current && !initialError) scrollToBottom();
  }, [ready, initialError, scrollToBottom]);

  // Forward poll loop — runs while open. When following, merges + auto-scrolls; when browsing
  // history, peeks the new-event count without merging events (viewport never jumps). Empty
  // pages must still adopt cursor.next in BOTH modes — a window full of server-dropped noise
  // lines progresses the cursor with zero events, and dropping that progress stalls the live
  // follow forever. Consecutive transport failures stop the loop after a few tries (manual
  // retry) instead of hammering a dead server silently.
  useEffect(() => {
    if (!ready || initialError || pollError) return;
    let stopped = false;
    let failures = 0;
    let timer: number | undefined;
    const tick = async () => {
      if (stopped) return;
      const w = winRef.current;
      try {
        const page = await loadAgentStream(agentId, {
          boardFilename,
          cursor: String(w.cursorNext),
        });
        if (stopped) return;
        failures = 0;
        if (detectRotation(page)) return; // identity changed — reload effect takes over
        setSource(page.source);
        setLive(page.live.active);
        if (page.reset) {
          // Server-detected truncation/rotation — re-tail from scratch.
          setWin(resetToTail(page));
          if (followingRef.current) requestAnimationFrame(scrollToBottom);
        } else if (followingRef.current) {
          setWin((cur) => mergeForward(cur, page));
          if (page.events.length) requestAnimationFrame(scrollToBottom);
        } else if (page.events.length) {
          setPendingBelow(page.events.length);
        } else {
          // Empty-but-progressing page while browsing history: absorb the cursor advance
          // (no visual change) so the poll does not rescan the same noise window each tick.
          setWin((cur) => mergeForward(cur, page));
        }
      } catch (error) {
        failures += 1;
        if (failures >= MAX_POLL_FAILURES && !stopped) {
          setPollError(error instanceof Error ? error.message : 'stream polling failed');
          return; // stop the loop — the retry button re-arms it
        }
      } finally {
        if (!stopped && failures < MAX_POLL_FAILURES) {
          timer = window.setTimeout(tick, POLL_MS);
        }
      }
    };
    timer = window.setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [ready, initialError, pollError, agentId, boardFilename, scrollToBottom, detectRotation]);

  // Restore the viewport anchor after an older-history prepend so the content the user was
  // reading stays put (record scrollHeight before, correct scrollTop by the delta after).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `win` is the trigger, not an input — the anchor must be re-applied after every window commit (prepends change scrollHeight).
  useLayoutEffect(() => {
    const anchor = prependAnchor.current;
    const el = scrollRef.current;
    if (anchor && el) {
      el.scrollTop = anchor.prevTop + (el.scrollHeight - anchor.prevHeight);
      prependAnchor.current = null;
    }
  }, [win]);

  // After a run of MAX_EMPTY_BACK_HOPS consecutive empty (but progressing) pages, stop
  // auto-triggering (scroll / viewport fill) and wait for an explicit button click — so a long
  // dropped-only stretch can't turn into an unbounded request storm behind the user's back.
  const autoBackPausedRef = useRef(false);

  // Page older history. Backward pages may be empty while the cursor still progresses (windows
  // full of dropped line types / oversized-line skips) — keep following the cursor until events
  // arrive, the head is reached, or the hop cap trips. `manual` (button click) clears the pause.
  const fetchOlder = useCallback(
    async (manual = false) => {
      if (loadingOlderRef.current) return;
      if (manual) autoBackPausedRef.current = false;
      else if (autoBackPausedRef.current) return;
      let w = winRef.current;
      if (w.atStart) return;
      loadingOlderRef.current = true;
      setLoadingOlder(true);
      const el = scrollRef.current;
      try {
        for (let hop = 0; hop < MAX_EMPTY_BACK_HOPS; hop++) {
          const page = await loadAgentStream(agentId, {
            boardFilename,
            before: String(w.cursorPrev),
          });
          if (detectRotation(page)) return; // identity changed — reload effect takes over
          const merged = mergeBackward(w, page);
          // Server contract: prev strictly decreases. Guard anyway — a stalled cursor must
          // never spin this loop.
          const progressed = merged.atStart || merged.cursorPrev < w.cursorPrev;
          if (page.events.length && el) {
            prependAnchor.current = { prevHeight: el.scrollHeight, prevTop: el.scrollTop };
          }
          // Functional merge so a concurrently-landed forward poll commit is never clobbered
          // (mergeBackward dedups by id, so re-applying the page to a newer window is safe);
          // the local `w` copy only drives this loop's next-hop anchor.
          w = merged;
          setWin((cur) => mergeBackward(cur, page));
          if (page.events.length > 0 || merged.atStart || !progressed) return;
        }
        autoBackPausedRef.current = true;
      } catch {
        /* transient — the top sentinel stays, next scroll retries */
      } finally {
        loadingOlderRef.current = false;
        setLoadingOlder(false);
      }
    },
    [agentId, boardFilename, detectRotation],
  );

  // Auto-fill: when the held window is shorter than the viewport (no scrollbar -> scroll events
  // can never fire) and history remains, keep paging back until the pane fills, the head is
  // reached, or the auto-pause trips. This also covers a tail that landed on a sparse region.
  useEffect(() => {
    if (!ready || initialError || loadingOlder) return;
    if (win.atStart || autoBackPausedRef.current) return;
    const el = scrollRef.current;
    if (el && el.scrollHeight <= el.clientHeight + 1) void fetchOlder();
  }, [ready, initialError, loadingOlder, win, fetchOlder]);

  const jumpToLatest = useCallback(() => {
    setFollowing(true);
    setPendingBelow(0);
    // Re-tail so the window is the true latest even after long history browsing — a fresh tail
    // is the identity anchor too (adopt its inode instead of diffing against the stale one).
    loadAgentStream(agentId, { boardFilename, cursor: 'tail' })
      .then((page) => {
        sourceInoRef.current = typeof page.source.ino === 'number' ? page.source.ino : null;
        setSource(page.source);
        setLive(page.live.active);
        setWin(resetToTail(page));
        requestAnimationFrame(scrollToBottom);
      })
      .catch(() => {
        /* keep current frame; the poll loop will recover */
      });
  }, [agentId, boardFilename, scrollToBottom]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const pinned = distanceFromBottom <= BOTTOM_THRESHOLD;
    if (pinned && !followingRef.current) {
      // With the newest events evicted (deep history browsing), silently resuming the live
      // append would splice a gap into the timeline — only the explicit jump-to-latest button
      // (which re-tails from scratch) may resume following.
      if (!winRef.current.omittedBottom) {
        setFollowing(true);
        setPendingBelow(0);
      }
    } else if (!pinned && followingRef.current) {
      setFollowing(false);
    }
    if (el.scrollTop <= TOP_THRESHOLD && !winRef.current.atStart) {
      void fetchOlder();
    }
  }, [fetchOlder]);

  const noSource = source?.kind === 'none';

  return (
    <>
      <button
        aria-label="Close the agent stream"
        className="stream-scrim"
        onClick={onClose}
        type="button"
      />
      <aside aria-label="Agent live stream" className="stream-drawer">
        <header className="stream-head">
          <span className={`stream-lamp${live ? ' live' : ''}`} title={live ? 'live' : 'idle'} />
          <div className="stream-htext">
            <div className="stream-htitle">{intent || agentId}</div>
            <div className="stream-hmeta">
              <span className="stream-hid mono">{agentId}</span>
              {source?.harness ? (
                <span className="stream-harness mono">{harnessBadge(source.harness)}</span>
              ) : null}
              <span className="stream-livetext">{live ? 'live' : 'idle'}</span>
            </div>
          </div>
          <button className="stream-close" onClick={onClose} title="Close (Esc)" type="button">
            ✕
          </button>
        </header>

        {source?.path ? (
          <div className="stream-source mono" title={source.path}>
            {source.path}
          </div>
        ) : null}

        {pollError ? (
          <div className="stream-errbar" role="status">
            <span>live polling stopped — {pollError}</span>
            <button
              className="stream-retry"
              onClick={() => setReloadNonce((n) => n + 1)}
              type="button"
            >
              retry
            </button>
          </div>
        ) : null}

        <div className="stream-body" onScroll={onScroll} ref={scrollRef}>
          {initialError ? (
            <div className="stream-empty">stream unavailable — {initialError}</div>
          ) : noSource ? (
            <div className="stream-empty">
              no live stream · {source?.reason ?? 'this agent exposes no transcript source'}
            </div>
          ) : !ready ? (
            <div className="stream-empty">loading stream…</div>
          ) : win.events.length === 0 ? (
            <div className="stream-empty">
              {win.atStart ? (
                'no events yet — waiting for the agent to write'
              ) : (
                <button
                  className="stream-more"
                  disabled={loadingOlder}
                  onClick={() => void fetchOlder(true)}
                  type="button"
                >
                  {loadingOlder ? 'loading earlier…' : 'nothing here yet — ↑ load earlier'}
                </button>
              )}
            </div>
          ) : (
            <>
              {win.atStart ? (
                <div className="stream-edge">· start of transcript ·</div>
              ) : (
                <button
                  className="stream-more"
                  disabled={loadingOlder}
                  onClick={() => void fetchOlder(true)}
                  type="button"
                >
                  {loadingOlder ? 'loading earlier…' : '↑ load earlier'}
                </button>
              )}
              {win.events.map((event) => (
                <StreamRow event={event} key={event.id} />
              ))}
              {win.omittedBottom ? (
                <button className="stream-more" onClick={jumpToLatest} type="button">
                  newer events below — jump to latest ↓
                </button>
              ) : null}
            </>
          )}
        </div>

        {!following && !noSource && !initialError ? (
          <button className="stream-jump" onClick={jumpToLatest} type="button">
            {pendingBelow > 0
              ? `${pendingBelow} new event${pendingBelow > 1 ? 's' : ''} ↓`
              : 'jump to latest ↓'}
          </button>
        ) : null}
      </aside>
    </>
  );
}
