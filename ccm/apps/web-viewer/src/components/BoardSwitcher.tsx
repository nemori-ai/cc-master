import { Check, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtElapsed } from '../format';
import type { BoardSummary, BoardsPayload, ViewModelPayload } from '../types';

interface BoardSwitcherProps {
  boards: BoardsPayload;
  viewModel: ViewModelPayload;
  onSelectBoard: (boardFilename: string) => void;
  onNotice: (message: string) => void;
}

type BoardHealthTone = 'ok' | 'stale' | 'error' | 'archived' | 'unknown';

function healthTone(board: BoardSummary): BoardHealthTone {
  if (board.active !== true) return 'archived';
  if (board.health === 'ok') return 'ok';
  if (board.health === 'stale') return 'stale';
  if (board.health === 'error') return 'error';
  return 'unknown';
}

function heartbeatText(board: BoardSummary): string | null {
  if (board.heartbeat_age_sec == null) return null;
  const text = fmtElapsed(board.heartbeat_age_sec * 1000) ?? '<1m';
  return `hb ${text} ago`;
}

/** Simplified 4-bucket counts (done incl. verified / in flight / blocked / awaiting). */
function bucketCounts(board: BoardSummary): {
  done: number;
  inFlight: number;
  blocked: number;
  awaiting: number;
} | null {
  const counts = board.status_counts;
  if (!counts && board.done_count == null) return null;
  const done = board.done_count ?? (counts?.done ?? 0) + (counts?.verified ?? 0);
  return {
    done,
    inFlight: counts?.in_flight ?? 0,
    blocked: counts?.blocked ?? 0,
    awaiting: board.awaiting_count ?? 0
  };
}

function activeSort(a: BoardSummary, b: BoardSummary): number {
  // Freshest heartbeat first; boards without a heartbeat fall back to updated_at recency.
  const ha = a.heartbeat_age_sec ?? Number.POSITIVE_INFINITY;
  const hb = b.heartbeat_age_sec ?? Number.POSITIVE_INFINITY;
  if (ha !== hb) return ha - hb;
  return updatedMs(b) - updatedMs(a);
}

function updatedMs(board: BoardSummary): number {
  const ms = board.updated_at ? Date.parse(board.updated_at) : Number.NaN;
  return Number.isNaN(ms) ? 0 : ms;
}

function BoardCard({
  board,
  current,
  highlighted,
  onPick,
  onCopy,
  optionId
}: {
  board: BoardSummary;
  current: boolean;
  highlighted: boolean;
  onPick: () => void;
  onCopy: () => void;
  optionId: string;
}) {
  const tone = healthTone(board);
  const total = board.task_count ?? 0;
  const buckets = bucketCounts(board);
  const done = buckets?.done ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const hb = heartbeatText(board);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard reach is handled by the listbox container (arrows + Enter)
    <div
      aria-selected={current}
      className="bsw-card"
      data-filename={board.filename}
      data-highlighted={highlighted || undefined}
      data-selected={current || undefined}
      id={optionId}
      onClick={onPick}
      ref={ref}
      role="option"
    >
      <div className="bsw-toprow">
        <span className="bdot" data-tone={tone} />
        <span className="bsw-state">{board.active === true ? 'active' : 'archived'}</span>
        {board.priority ? <span className={`badge prio-${board.priority}`}>{board.priority}</span> : null}
        {current ? <span className="bsw-current">current</span> : null}
        <span className="bsw-hb">{hb ?? ''}</span>
      </div>
      <div className="bsw-goal" title={board.goal || '(untitled board)'}>
        {board.goal || '(untitled board)'}
      </div>
      <div className="bsw-progressrow">
        <span className="meter">
          <i style={{ width: `${pct}%` }} />
        </span>
        <span className="bsw-pct">
          {done}/{total} · {pct}%
        </span>
        {buckets ? (
          <span className="bsw-buckets">
            {[
              buckets.inFlight ? `in flight ${buckets.inFlight}` : null,
              buckets.blocked ? `blocked ${buckets.blocked}` : null,
              buckets.awaiting ? `awaiting ${buckets.awaiting}` : null
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        ) : null}
      </div>
      <div className="bsw-metarow">
        {board.branch ? <span className="bsw-branch">{board.branch}</span> : null}
        <button
          className="bsw-copy"
          onClick={(event) => {
            event.stopPropagation();
            onCopy();
          }}
          title={`${board.filename} · ${board.id} — click to copy the filename`}
          type="button"
        >
          <Copy aria-hidden="true" size={10} strokeWidth={1.75} />
          <span className="bsw-file">{board.filename}</span>
        </button>
      </div>
    </div>
  );
}

/**
 * The current-board chip + mega dropdown board switcher: board selection outranks the
 * rest of the chrome, so the chip holds a fixed seat on the mission line (name + health
 * lamp; the board id/filename is demoted into hover + copy). Clicking it opens an
 * information-complete card list — actives first (freshest heartbeat first), archived in
 * a collapsed section — and picking a card rides the existing selectBoard smooth path.
 * Keyboard: Esc closes, arrows move, Enter switches; clicking outside closes.
 */
export function BoardSwitcher({ boards, viewModel, onSelectBoard, onNotice }: BoardSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const currentFilename = viewModel.board.filename;
  const currentBoard = boards.boards.find((board) => board.filename === currentFilename);

  const activeBoards = useMemo(
    () => boards.boards.filter((board) => board.active === true).sort(activeSort),
    [boards]
  );
  const archivedBoards = useMemo(
    () =>
      boards.boards
        .filter((board) => board.active !== true)
        .sort((a, b) => updatedMs(b) - updatedMs(a)),
    [boards]
  );
  // The keyboard row model: actives always, archived only while its section is expanded.
  const flat = useMemo(
    () => (showArchived ? [...activeBoards, ...archivedBoards] : activeBoards),
    [activeBoards, archivedBoards, showArchived]
  );

  const openPanel = useCallback(() => {
    setOpen(true);
    const currentIndex = activeBoards.findIndex((board) => board.filename === currentFilename);
    setHighlightIndex(Math.max(currentIndex, 0));
  }, [activeBoards, currentFilename]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus({ preventScroll: true });
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    // Capture phase: the xyflow canvas (d3-zoom pan-start) calls stopImmediatePropagation
    // on its own mousedown handler, which would otherwise swallow a bubble-phase listener
    // before it ever reaches document. Capturing at document fires first, ahead of that.
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [open]);

  const pick = useCallback(
    (board: BoardSummary) => {
      setOpen(false);
      onSelectBoard(board.filename);
    },
    [onSelectBoard]
  );

  const copyFilename = useCallback(
    async (board: BoardSummary) => {
      try {
        await navigator.clipboard.writeText(board.filename);
        onNotice(`Copied ${board.filename}`);
      } catch {
        onNotice(`Board file: ${board.filename}`);
      }
    },
    [onNotice]
  );

  const onPanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      // Close the panel only — never bubble into the global Esc (task-drill close).
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!flat.length) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setHighlightIndex((index) => (index + delta + flat.length) % flat.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const board = flat[highlightIndex];
      if (board) pick(board);
    }
  };

  const chipTone = currentBoard ? healthTone(currentBoard) : 'unknown';
  const chipName = (viewModel.board.goal || '').trim() || currentBoard?.goal || '(untitled board)';

  return (
    <div className="board-switcher-wrap" ref={wrapRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="board-chip"
        onClick={() => (open ? setOpen(false) : openPanel())}
        title={`${currentFilename || 'no board'} · ${viewModel.board.id || '—'} — click to switch board`}
        type="button"
      >
        <span className="bdot" data-tone={chipTone} />
        <span className="bname">{chipName}</span>
        <span className="chip-count">
          {activeBoards.length} active
        </span>
        <span aria-hidden="true" className="caret">
          <ChevronDown size={12} strokeWidth={1.75} />
        </span>
      </button>
      {open ? (
        <div
          aria-label="Switch board"
          className="board-switcher"
          onKeyDown={onPanelKeyDown}
          ref={panelRef}
          role="listbox"
          tabIndex={-1}
        >
          <div className="bsw-head">
            switch board · {boards.boards.length} board{boards.boards.length === 1 ? '' : 's'}
          </div>
          <div className="bsw-section-label">
            <span>active</span>
            <span>{activeBoards.length}</span>
          </div>
          {activeBoards.map((board, index) => (
            <BoardCard
              board={board}
              current={board.filename === currentFilename}
              highlighted={index === highlightIndex}
              key={board.filename}
              onCopy={() => copyFilename(board)}
              onPick={() => pick(board)}
              optionId={`bsw-opt-${board.id}`}
            />
          ))}
          {activeBoards.length === 0 ? <div className="bsw-empty">no active boards</div> : null}
          {archivedBoards.length ? (
            <>
              <button
                aria-expanded={showArchived}
                className="bsw-archived-toggle"
                onClick={() => setShowArchived((value) => !value)}
                type="button"
              >
                <span aria-hidden="true" className="caret">
                  {showArchived ? (
                    <ChevronDown size={11} strokeWidth={1.75} />
                  ) : (
                    <ChevronRight size={11} strokeWidth={1.75} />
                  )}
                </span>
                archived <span className="ct">{archivedBoards.length}</span>
              </button>
              {showArchived
                ? archivedBoards.map((board, index) => (
                    <BoardCard
                      board={board}
                      current={board.filename === currentFilename}
                      highlighted={activeBoards.length + index === highlightIndex}
                      key={board.filename}
                      onCopy={() => copyFilename(board)}
                      onPick={() => pick(board)}
                      optionId={`bsw-opt-${board.id}`}
                    />
                  ))
                : null}
            </>
          ) : null}
          <div className="bsw-foot">
            <Check aria-hidden="true" size={10} strokeWidth={1.75} /> enter switches · esc closes ·
            ↑↓ move
          </div>
        </div>
      ) : null}
    </div>
  );
}
