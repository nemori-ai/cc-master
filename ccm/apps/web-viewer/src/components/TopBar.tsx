import type { BoardsPayload, ViewModelPayload, WorkspaceData } from '../types';
import { shortTime } from '../format';

interface TopBarProps {
  boards: BoardsPayload;
  viewModel: ViewModelPayload;
  source: WorkspaceData['source'];
  currentBoardFilename?: string;
  query: string;
  feedback: string | null;
  shareFallbackUrl: string | null;
  onQueryChange: (query: string) => void;
  onReset: () => void;
  onSelectBoard: (boardFilename: string) => void;
  onShare: () => void;
  onExport: () => void;
}

function boardLabel(goal: string | undefined): string {
  const trimmed = (goal ?? '').trim();
  if (!trimmed) return '(untitled board)';
  return trimmed.length > 20 ? `${trimmed.slice(0, 20)}...` : trimmed;
}

export function TopBar({
  boards,
  viewModel,
  source,
  currentBoardFilename,
  query,
  feedback,
  shareFallbackUrl,
  onQueryChange,
  onReset,
  onSelectBoard,
  onShare,
  onExport
}: TopBarProps) {
  const selectedBoard =
    boards.boards.find((board) => board.filename === currentBoardFilename) ??
    boards.boards.find((board) => board.id === viewModel.board.id) ??
    boards.boards[0];
  const freshness = viewModel.freshness.state;

  return (
    <header className="topbar">
      <div className="brand" aria-label="ccm web-viewer">
        <span className="brand-mark">ccm</span>
        <span>web-viewer</span>
      </div>
      <div className="local-state" aria-label="service scope">
        <span aria-hidden="true">lock</span>
        <span>Local only / Read-only</span>
      </div>
      <label className="board-select">
        <span>Board</span>
        <select
          value={selectedBoard?.filename ?? ''}
          aria-label="Board"
          onChange={(event) => onSelectBoard(event.target.value)}
        >
          {boards.boards.map((board) => (
            <option key={board.filename} value={board.filename}>
              {boardLabel(board.goal)}
            </option>
          ))}
        </select>
      </label>
      <label className="search-box">
        <span className="search-icon" aria-hidden="true">
          search
        </span>
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search tasks by id, name, tags..."
          type="search"
        />
        <kbd>/</kbd>
      </label>
      <div className="freshness" data-state={freshness}>
        <span>Data freshness</span>
        <strong>{shortTime(viewModel.freshness.last_read_at)}</strong>
        <i aria-hidden="true" />
      </div>
      <div className="top-actions">
        <button type="button" aria-label="Share workspace URL" onClick={onShare}>
          Share
        </button>
        <button type="button" aria-label="Export JSON snapshot" onClick={onExport}>
          Export
        </button>
        <button type="button" onClick={onReset}>
          Reset Layout
        </button>
      </div>
      {source === 'fixture' ? <div className="fixture-chip">Fixture fallback</div> : null}
      {feedback ? (
        <div className="top-feedback" role="status">
          <span>{feedback}</span>
          {shareFallbackUrl ? <input readOnly aria-label="Workspace URL" value={shareFallbackUrl} /> : null}
        </div>
      ) : null}
    </header>
  );
}
