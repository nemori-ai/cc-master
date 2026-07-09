import { useState } from 'react';
import { taskFilterOptions, type TaskFilterGroup } from '../taskFilters';
import type { BoardSummary, BoardsPayload, ViewModelPayload } from '../types';

type BoardStateFilter = 'all' | 'active' | 'archived';

interface LeftRailProps {
  boards: BoardsPayload;
  viewModel: ViewModelPayload;
  selectedTaskId: string | null;
  onSelectBoard: (boardFilename: string) => void;
  onSelectTask: (taskId: string) => void;
  activeFilters: Set<string>;
  onToggleFilter: (filter: string) => void;
  onClearFilters: () => void;
}

function boardLabel(goal: string | undefined): string {
  const trimmed = (goal ?? '').trim();
  if (!trimmed) return '(untitled board)';
  return trimmed.length > 20 ? `${trimmed.slice(0, 20)}...` : trimmed;
}

function boardState(board: BoardSummary): Exclude<BoardStateFilter, 'all'> {
  return board.active === true ? 'active' : 'archived';
}

function boardMatchesState(board: BoardSummary, filter: BoardStateFilter): boolean {
  return filter === 'all' || boardState(board) === filter;
}

const filterGroups: Array<{ id: TaskFilterGroup; label: string }> = [
  { id: 'status', label: 'Status' },
  { id: 'executor', label: 'Executor' },
  { id: 'type', label: 'Type' }
];

export function LeftRail({
  boards,
  viewModel,
  selectedTaskId,
  onSelectBoard,
  onSelectTask,
  activeFilters,
  onToggleFilter,
  onClearFilters
}: LeftRailProps) {
  const [boardStateFilter, setBoardStateFilter] = useState<BoardStateFilter>('all');
  const nodesById = new Map(viewModel.graph.nodes.map((node) => [node.id, node]));
  const criticalPath = viewModel.graph.critical_path ?? [];
  const visibleBoards = boards.boards.filter((board) => boardMatchesState(board, boardStateFilter));
  const taskFilterCount = activeFilters.size;
  const boardCounts = {
    all: boards.boards.length,
    active: boards.boards.filter((board) => boardState(board) === 'active').length,
    archived: boards.boards.filter((board) => boardState(board) === 'archived').length
  } satisfies Record<BoardStateFilter, number>;

  return (
    <aside className="left-rail" aria-label="Boards, filters, and critical path">
      <section className="rail-section">
        <div className="rail-heading">
          <h2>Boards</h2>
          <span>
            {visibleBoards.length}/{boards.boards.length}
          </span>
        </div>
        <div className="board-state-tabs" aria-label="Board state filter">
          {(['all', 'active', 'archived'] satisfies BoardStateFilter[]).map((filter) => (
            <button
              aria-pressed={boardStateFilter === filter}
              data-active={boardStateFilter === filter}
              key={filter}
              onClick={() => setBoardStateFilter(filter)}
              type="button"
            >
              <span>{filter}</span>
              <small>{boardCounts[filter]}</small>
            </button>
          ))}
        </div>
        <div className="board-list">
          {visibleBoards.map((board) => (
            <button
              className="board-row"
              data-selected={board.id === viewModel.board.id}
              key={board.id}
              onClick={() => onSelectBoard(board.filename)}
              title={`${board.goal || '(untitled board)'} (${board.id})`}
              type="button"
            >
              <span>{boardLabel(board.goal)}</span>
              <small>
                {board.id} · {boardState(board)} · {board.health ?? 'unknown'}
              </small>
            </button>
          ))}
          {visibleBoards.length === 0 ? <p className="rail-empty">No {boardStateFilter} boards</p> : null}
        </div>
      </section>

      <section className="rail-section">
        <div className="rail-heading">
          <h2>Filters ({taskFilterCount})</h2>
          <button type="button" onClick={onClearFilters}>
            Clear
          </button>
        </div>
        <div className="filter-group">
          <div className="filter-group-heading">
            <span>Path</span>
          </div>
          <div className="filter-chips" aria-label="Critical path filter">
            <button
              className="filter-chip"
              data-active={activeFilters.has('critical')}
              onClick={() => onToggleFilter('critical')}
              type="button"
            >
              <span>Critical path</span>
              <small>{criticalPath.length}</small>
            </button>
          </div>
        </div>

        {filterGroups.map((group) => {
          const options = taskFilterOptions(viewModel.graph.nodes, group.id);
          return (
            <div className="filter-group" key={group.id}>
              <div className="filter-group-heading">
                <span>{group.label}</span>
                <small>{options.length}</small>
              </div>
              <div className="filter-chips" aria-label={`${group.label} task filters`}>
                {options.map((option) => (
                  <button
                    className="filter-chip"
                    data-active={activeFilters.has(option.key)}
                    key={option.key}
                    onClick={() => onToggleFilter(option.key)}
                    title={`${group.label}: ${option.label}`}
                    type="button"
                  >
                    <span>{option.label}</span>
                    <small>{option.count}</small>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section className="rail-section critical-section">
        <div className="rail-heading">
          <h2>Critical Path</h2>
          <span>{criticalPath.length}</span>
        </div>
        <ol className="critical-list">
          {criticalPath.map((nodeId, index) => {
            const node = nodesById.get(nodeId);
            return (
              <li key={nodeId}>
                <button
                  data-selected={nodeId === selectedTaskId}
                  onClick={() => onSelectTask(nodeId)}
                  type="button"
                >
                  <span>{index + 1}</span>
                  <strong>{node?.title ?? nodeId}</strong>
                  <small>{node?.rank ?? ''}</small>
                </button>
              </li>
            );
          })}
        </ol>
      </section>
    </aside>
  );
}
