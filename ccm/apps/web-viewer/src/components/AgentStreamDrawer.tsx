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
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [following, setFollowing] = useState(true);
  const [pendingBelow, setPendingBelow] = useState(0);
  const [ready, setReady] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const winRef = useRef(win);
  winRef.current = win;
  const followingRef = useRef(following);
  followingRef.current = following;
  const loadingOlderRef = useRef(loadingOlder);
  loadingOlderRef.current = loadingOlder;
  // Set before a backward prepend so the layout effect can restore the viewport anchor.
  const prependAnchor = useRef<{ prevHeight: number; prevTop: number } | null>(null);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Initial / agent-change load: fresh tail, pinned to live.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setReady(false);
    setInitialError(null);
    setWin(EMPTY_WINDOW);
    setFollowing(true);
    setPendingBelow(0);
    loadAgentStream(agentId, { boardFilename, cursor: 'tail' }, controller.signal)
      .then((page) => {
        if (cancelled) return;
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
  }, [agentId, boardFilename]);

  // Pin to bottom after the first successful tail render.
  useLayoutEffect(() => {
    if (ready && followingRef.current && !initialError) scrollToBottom();
  }, [ready, initialError, scrollToBottom]);

  // Forward poll loop — runs while open. When following, merges + auto-scrolls; when browsing
  // history, only peeks the new-event count (no merge, so the viewport never jumps).
  useEffect(() => {
    if (!ready || initialError) return;
    let stopped = false;
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
        setSource(page.source);
        setLive(page.live.active);
        if (page.reset) {
          // File truncated/rotated — re-tail from scratch.
          setWin(resetToTail(page));
          if (followingRef.current) requestAnimationFrame(scrollToBottom);
        } else if (followingRef.current) {
          if (page.events.length) {
            setWin((cur) => mergeForward(cur, page));
            requestAnimationFrame(scrollToBottom);
          }
        } else if (page.events.length) {
          setPendingBelow(page.events.length);
        }
      } catch {
        /* transient poll failure — keep the last frame, try again next tick */
      } finally {
        if (!stopped) timer = window.setTimeout(tick, POLL_MS);
      }
    };
    timer = window.setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [ready, initialError, agentId, boardFilename, scrollToBottom]);

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
          const merged = mergeBackward(w, page);
          // Server contract: prev strictly decreases. Guard anyway — a stalled cursor must
          // never spin this loop.
          const progressed = merged.atStart || merged.cursorPrev < w.cursorPrev;
          if (page.events.length && el) {
            prependAnchor.current = { prevHeight: el.scrollHeight, prevTop: el.scrollTop };
          }
          winRef.current = merged;
          w = merged;
          setWin(merged);
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
    [agentId, boardFilename],
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
    // Re-tail so the window is the true latest even after long history browsing.
    loadAgentStream(agentId, { boardFilename, cursor: 'tail' })
      .then((page) => {
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
      setFollowing(true);
      setPendingBelow(0);
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
