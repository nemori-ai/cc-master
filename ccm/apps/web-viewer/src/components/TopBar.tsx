import { normalizeStatus, shortTime } from '../format';
import type { ViewModelPayload, WorkspaceData } from '../types';

export type ViewMode = 'graph' | 'board' | 'list' | 'timeline';

interface TopBarProps {
  viewModel: ViewModelPayload;
  source: WorkspaceData['source'];
  currentBoardFilename?: string;
  query: string;
  feedback: string | null;
  shareFallbackUrl: string | null;
  view: ViewMode;
  theme: 'dark' | 'light';
  onViewChange: (view: ViewMode) => void;
  onToggleTheme: () => void;
  onQueryChange: (query: string) => void;
  onReset: () => void;
  onShare: () => void;
  onExport: () => void;
  searchRef?: React.RefObject<HTMLInputElement | null>;
}

const VIEWS: Array<{ id: ViewMode; glyph: string; title: string }> = [
  { id: 'graph', glyph: '⬡', title: 'graph view — the dependency DAG' },
  { id: 'board', glyph: '▦', title: 'board view — the Kanban card board' },
  { id: 'list', glyph: '☰', title: 'list view — the status-board' },
  { id: 'timeline', glyph: '▤', title: 'timeline view — the time / gantt swimlanes' }
];

/**
 * The header instrument rail: identity nameplate + mission line + telemetry readouts
 * (view toggle / theme toggle / progress meter / board readout / branch / freshness /
 * the ONE alarm) fused with search and Share/Export/Reset actions. Board SWITCHING
 * lives solely in the left rail's boards list — up here the board is a readout, not
 * a control.
 */
export function TopBar({
  viewModel,
  source,
  currentBoardFilename,
  query,
  feedback,
  shareFallbackUrl,
  view,
  theme,
  onViewChange,
  onToggleTheme,
  onQueryChange,
  onReset,
  onShare,
  onExport,
  searchRef
}: TopBarProps) {
  const freshness = viewModel.freshness.state;
  const boardFilename = viewModel.board.filename || currentBoardFilename || '';
  const boardReadout = boardFilename.replace(/\.board\.json$/, '') || '—';

  const total = viewModel.graph.nodes.length;
  const done = viewModel.graph.nodes.filter((node) => {
    const status = normalizeStatus(String(node.status ?? ''));
    return status === 'done' || status === 'verified';
  }).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const branch = viewModel.board.git?.branch || null;
  const userGates =
    viewModel.insights?.awaiting?.count ?? viewModel.summary?.awaitingUserCount ?? 0;

  return (
    <header className="bar topbar">
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

      <div className="readouts">
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
              <span className="tg">{entry.glyph}</span>
              {entry.id}
            </button>
          ))}
        </div>

        <button
          aria-label={theme === 'light' ? 'switch to night (dark) theme' : 'switch to day (light) theme'}
          aria-pressed={theme === 'light'}
          className="themetoggle"
          onClick={onToggleTheme}
          title={theme === 'light' ? 'night theme' : 'day theme'}
          type="button"
        >
          <span aria-hidden="true" className="glyph">
            {theme === 'light' ? '☾' : '☀'}
          </span>
        </button>

        <div className="vrule" />

        <div className="readout">
          <span className="rl">progress</span>
          <span className="rv">
            {done}
            <span className="unit">/{total}</span>
            <span className="unit"> {pct}%</span>
          </span>
          <div className="meter">
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="vrule" />
        <div
          className="readout board-readout"
          title={`${viewModel.board.goal || '(untitled board)'} · ${boardFilename}`}
        >
          <span className="rl">board</span>
          <span className="rv">{boardReadout}</span>
        </div>

        {branch ? (
          <>
            <div className="vrule" />
            <div className="readout branch">
              <span className="rl">branch</span>
              <span className="rv">{branch}</span>
            </div>
          </>
        ) : null}

        <div className="vrule" />
        <div className="readout freshness" data-state={freshness}>
          <span className="rl">freshness</span>
          <span className="rv">
            <i aria-hidden="true" className="fdot" /> {shortTime(viewModel.freshness.last_read_at)}
          </span>
        </div>

        {userGates > 0 ? (
          <div className="alarm">
            <span className="dot" />
            <span className="n">{userGates}</span>
            awaiting you
          </div>
        ) : null}

        <div className="top-actions">
          <button aria-label="Share workspace URL" onClick={onShare} type="button">
            Share
          </button>
          <button aria-label="Export JSON snapshot" onClick={onExport} type="button">
            Export
          </button>
          <button onClick={onReset} type="button">
            Reset
          </button>
        </div>
      </div>

      {source === 'fixture' ? <div className="fixture-chip">Fixture fallback</div> : null}
      {feedback ? (
        <div className="top-feedback" role="status">
          <span>{feedback}</span>
          {shareFallbackUrl ? (
            <input aria-label="Workspace URL" readOnly value={shareFallbackUrl} />
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
