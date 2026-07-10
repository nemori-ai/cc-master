import {
  ChartGantt,
  List,
  type LucideIcon,
  PanelLeft,
  SquareKanban,
  Waypoints,
} from 'lucide-react';
import type React from 'react';

export type ViewMode = 'graph' | 'board' | 'list' | 'timeline';

const VIEWS: Array<{ id: ViewMode; Icon: LucideIcon; title: string }> = [
  { id: 'graph', Icon: Waypoints, title: 'graph view — the dependency DAG' },
  { id: 'board', Icon: SquareKanban, title: 'board view — the Kanban card board' },
  { id: 'list', Icon: List, title: 'list view — the status-board' },
  { id: 'timeline', Icon: ChartGantt, title: 'timeline view — the time / gantt swimlanes' }
];

interface StageToolbarProps {
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  query: string;
  onQueryChange: (query: string) => void;
  searchRef?: React.RefObject<HTMLInputElement | null>;
  activeFilterCount: number;
  onClearFilters: () => void;
  onToggleDrawer: () => void;
}

/**
 * ST stage toolbar (40px, first row of the center column): everything here changes WHAT
 * THE STAGE SHOWS — the four-view toggle, the active-filter echo chip (click = the left
 * rail's Clear), and search (`/` still focuses it). Stage-scoped controls live with the
 * stage, not on the global header; the drawer button (≤900px) opens the analysis rail.
 */
export function StageToolbar({
  view,
  onViewChange,
  query,
  onQueryChange,
  searchRef,
  activeFilterCount,
  onClearFilters,
  onToggleDrawer
}: StageToolbarProps) {
  return (
    <div className="stage-toolbar">
      <button
        aria-label="Open the analysis rail"
        className="drawer-btn"
        onClick={onToggleDrawer}
        title="analysis · filters · critical path"
        type="button"
      >
        <PanelLeft aria-hidden="true" size={14} strokeWidth={1.75} />
      </button>

      <div aria-label="view mode" className="viewtoggle" role="group">
        {VIEWS.map((entry) => (
          <button
            aria-pressed={view === entry.id}
            className={view === entry.id ? 'on' : ''}
            key={entry.id}
            onClick={() => onViewChange(entry.id)}
            title={entry.title}
            type="button"
          >
            <span aria-hidden="true" className="tg">
              <entry.Icon size={12} strokeWidth={1.75} />
            </span>
            <span className="vt-label">{entry.id}</span>
          </button>
        ))}
      </div>

      {activeFilterCount > 0 ? (
        <button
          className="filterecho"
          onClick={onClearFilters}
          title="filters active on the stage — click to clear them all"
          type="button"
        >
          · {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'} · clear
        </button>
      ) : null}

      <label className="search-box">
        <input
          aria-label="Search tasks"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="search id · title · tags"
          ref={searchRef}
          type="search"
          value={query}
        />
        <kbd>/</kbd>
      </label>
    </div>
  );
}
