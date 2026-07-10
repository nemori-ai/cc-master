import { Download, Moon, MoreHorizontal, Share2, Sun } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { startTs } from '../format';
import type { BoardsPayload, CompactTask, ViewModelPayload } from '../types';
import { BoardSwitcher } from './BoardSwitcher';

interface MissionLineProps {
  viewModel: ViewModelPayload;
  boards: BoardsPayload;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onShare: () => void;
  onExport: () => void;
  onLocateTask: (taskId: string) => void;
  onSelectBoard: (boardFilename: string) => void;
  onNotice: (message: string) => void;
}

/**
 * H1 mission line (44px): identity anchor -> objective (the page's ONE title-grade text)
 * -> current-board chip + mega switcher (board selection outranks everything else) ->
 * the ONE alarm in its fenced permanent slot (grey "clear" state at zero — the eye learns
 * the position; "nothing awaits me" is itself the answer) -> Share/Export function pair
 * -> theme toggle alone at the far end. vrules fence alarm / functions / settings apart.
 */
export function MissionLine({
  viewModel,
  boards,
  theme,
  onToggleTheme,
  onShare,
  onExport,
  onLocateTask,
  onSelectBoard,
  onNotice
}: MissionLineProps) {
  const userGates =
    viewModel.insights?.awaiting?.count ?? viewModel.summary?.awaitingUserCount ?? 0;

  // The alarm is a jump control: awaiting-user gates ordered oldest-dispatch first, so
  // the first click lands on the longest-waiting decision; further clicks cycle.
  const awaitingList = useMemo(() => {
    const gates = viewModel.graph.nodes.filter((node) => node.awaiting_user === true);
    const byId = new Map((viewModel.tasks ?? []).map((task) => [task.id, task]));
    return gates
      .map((node) => ({
        id: node.id,
        ts: startTs((byId.get(node.id) ?? { id: node.id }) as CompactTask)
      }))
      .sort((a, b) => (a.ts ?? Number.POSITIVE_INFINITY) - (b.ts ?? Number.POSITIVE_INFINITY))
      .map((entry) => entry.id);
  }, [viewModel]);
  const alarmCycleRef = useRef(0);
  const onAlarmClick = () => {
    if (!awaitingList.length) return;
    const index = alarmCycleRef.current % awaitingList.length;
    alarmCycleRef.current = index + 1;
    const target = awaitingList[index];
    if (target) onLocateTask(target);
  };

  // Narrow-viewport overflow menu (Share / Export / theme fold in ≤900px portrait).
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!overflowOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(event.target as Node)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [overflowOpen]);

  return (
    <header className="missionline">
      <div className="ident">
        <span className="beacon" />
        <div className="mark-wrap">
          <span className="mark">cc-master</span>
          <span className="sub">mission control</span>
        </div>
      </div>

      <div className="goalwrap">
        <span className="label">objective</span>
        <span className="goal" title={viewModel.board.goal}>
          {viewModel.board.goal || 'no goal set'}
        </span>
      </div>

      <BoardSwitcher
        boards={boards}
        onNotice={onNotice}
        onSelectBoard={onSelectBoard}
        viewModel={viewModel}
      />

      <div className="vrule" />

      {userGates > 0 ? (
        <button
          aria-label={`${userGates} decision${userGates === 1 ? '' : 's'} awaiting you — click to locate the oldest gate${userGates > 1 ? ', click again for the next' : ''}`}
          className="alarm"
          onClick={onAlarmClick}
          title={
            userGates > 1
              ? 'locate the oldest awaiting gate — click again to cycle'
              : 'locate the awaiting gate'
          }
          type="button"
        >
          <span className="dot" />
          <span className="n">{userGates}</span>
          awaiting you
        </button>
      ) : (
        <span className="alarm clear" title="no decisions awaiting you">
          <span className="dot" />
          clear
        </span>
      )}

      <div className="vrule desktop-only" />

      <div className="top-actions desktop-only">
        <button
          aria-label="Share workspace URL"
          onClick={onShare}
          title="share — copy the workspace URL"
          type="button"
        >
          <Share2 aria-hidden="true" size={14} strokeWidth={1.75} />
        </button>
        <button
          aria-label="Export JSON snapshot"
          onClick={onExport}
          title="export — download a JSON snapshot"
          type="button"
        >
          <Download aria-hidden="true" size={14} strokeWidth={1.75} />
        </button>
      </div>

      <div className="vrule desktop-only" />

      <button
        aria-label={
          theme === 'light' ? 'switch to night (dark) theme' : 'switch to day (light) theme'
        }
        aria-pressed={theme === 'light'}
        className="themetoggle desktop-only"
        onClick={onToggleTheme}
        title={theme === 'light' ? 'night theme' : 'day theme'}
        type="button"
      >
        <span aria-hidden="true" className="glyph">
          {theme === 'light' ? (
            <Moon size={14} strokeWidth={1.75} />
          ) : (
            <Sun size={14} strokeWidth={1.75} />
          )}
        </span>
      </button>

      <div className="overflow-wrap" ref={overflowRef}>
        <button
          aria-expanded={overflowOpen}
          aria-label="More actions"
          className="overflow-btn"
          onClick={() => setOverflowOpen((value) => !value)}
          type="button"
        >
          <MoreHorizontal aria-hidden="true" size={15} strokeWidth={1.75} />
        </button>
        {overflowOpen ? (
          <div className="overflow-menu">
            <button
              onClick={() => {
                setOverflowOpen(false);
                onShare();
              }}
              type="button"
            >
              <Share2 aria-hidden="true" size={13} strokeWidth={1.75} /> share
            </button>
            <button
              onClick={() => {
                setOverflowOpen(false);
                onExport();
              }}
              type="button"
            >
              <Download aria-hidden="true" size={13} strokeWidth={1.75} /> export
            </button>
            <button
              onClick={() => {
                setOverflowOpen(false);
                onToggleTheme();
              }}
              type="button"
            >
              {theme === 'light' ? (
                <Moon aria-hidden="true" size={13} strokeWidth={1.75} />
              ) : (
                <Sun aria-hidden="true" size={13} strokeWidth={1.75} />
              )}{' '}
              {theme === 'light' ? 'night theme' : 'day theme'}
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
