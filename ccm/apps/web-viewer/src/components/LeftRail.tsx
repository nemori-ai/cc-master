import { useState } from 'react';
import { fmtElapsed, normalizeStatus, statusText } from '../format';
import { type TaskFilterGroup, taskFilterOptions } from '../taskFilters';
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

const filterGroups: Array<{ id: TaskFilterGroup; label: string }> = [
  { id: 'status', label: 'Status' },
  { id: 'executor', label: 'Executor' },
  { id: 'type', label: 'Type' }
];

/**
 * The left analysis rail: the derived-telemetry readout column (seven insights, all
 * clickable to jump-select) followed by the boards list, filter chips, and the ordered
 * critical-path list.
 */
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
  const insights = viewModel.insights ?? {};
  const visibleBoards = boards.boards.filter(
    (board) => boardStateFilter === 'all' || boardState(board) === boardStateFilter
  );
  const boardCounts = {
    all: boards.boards.length,
    active: boards.boards.filter((board) => boardState(board) === 'active').length,
    archived: boards.boards.filter((board) => boardState(board) === 'archived').length
  } satisfies Record<BoardStateFilter, number>;

  const idTitle = (id: string | null | undefined): string => {
    if (!id) return '';
    const node = nodesById.get(id);
    const title = (node?.title ?? '').trim();
    return title || id;
  };

  const total = viewModel.graph.nodes.length;
  const done = viewModel.graph.nodes.filter((node) => {
    const status = normalizeStatus(String(node.status ?? ''));
    return status === 'done' || status === 'verified';
  }).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const impact = insights.impact ?? { id: null, count: 0 };
  const convergence = insights.convergence ?? { id: null, in_deg: 0 };
  const bottleneck = insights.bottleneck ?? null;
  const wip = insights.wip ?? { count: 0, limit: null, over: false };
  const awaiting = insights.awaiting ?? { count: 0, oldest_gate_elapsed_ms: null };
  const makespan = viewModel.summary?.criticalPath?.makespan ?? null;
  const oldestGate = fmtElapsed(awaiting.oldest_gate_elapsed_ms);
  const age = fmtElapsed(insights.age_ms ?? null);

  const pill = (id: string) => (
    <button className="pill-id" onClick={() => onSelectTask(id)} title={idTitle(id)} type="button">
      {id}
    </button>
  );

  return (
    <aside aria-label="Analysis, boards, filters, and critical path" id="insights">
      <div className="ihead">analysis · {total} tasks</div>

      <div className="metric">
        <div className="ml">
          <span className="ic">⟋</span>critical path
        </div>
        <div className="mv mono">
          {criticalPath.length ? `length ${criticalPath.length}` : '—'}
        </div>
        <div className="msub">
          {makespan != null
            ? `makespan ${fmtElapsed(makespan) ?? makespan} · longest dependency chain`
            : 'longest dependency chain'}
        </div>
      </div>

      <div className="metric">
        <div className="ml">
          <span className="ic">◈</span>highest impact
        </div>
        {impact.id && impact.count > 0 ? (
          <div className="mv">
            {pill(impact.id)} {idTitle(impact.id)}
          </div>
        ) : (
          <div className="mv dim">no node gates others</div>
        )}
        {impact.count > 0 ? <div className="msub">gates {impact.count} downstream tasks</div> : null}
      </div>

      <div className="metric">
        <div className="ml">
          <span className="ic">⋈</span>top convergence
        </div>
        {convergence.id ? (
          <div className="mv">
            {pill(convergence.id)} {idTitle(convergence.id)}
          </div>
        ) : (
          <div className="mv dim">no multi-dep join</div>
        )}
        {convergence.id ? (
          <div className="msub">{convergence.in_deg} dependencies aggregate here</div>
        ) : null}
      </div>

      <div className="metric flag">
        <div className="ml">
          <span className="ic">⚠</span>bottleneck
        </div>
        {bottleneck?.id ? (
          <div className="mv">
            {pill(bottleneck.id)} {idTitle(bottleneck.id)}
          </div>
        ) : (
          <div className="mv dim">none — nothing stalling</div>
        )}
        {bottleneck?.id ? (
          <div className="msub">
            {statusText(bottleneck.status)}
            {bottleneck.impact > 0 ? ` · gates ${bottleneck.impact}` : ''}
            {fmtElapsed(bottleneck.elapsed_ms ?? null) != null
              ? ` · ${fmtElapsed(bottleneck.elapsed_ms ?? null)}`
              : ''}
          </div>
        ) : null}
      </div>

      <div className={`metric${wip.over ? ' warnwip' : ''}`}>
        <div className="ml">
          <span className="ic">≡</span>work in flight
        </div>
        <div className="mv mono">
          {wip.count}
          {wip.limit != null ? ` / ${wip.limit}` : ''}
          {wip.over ? '  ⚠ over' : ''}
        </div>
        <div className="msub">
          {wip.limit != null ? 'in_flight vs wip_limit' : 'in_flight (no wip_limit set)'}
        </div>
      </div>

      <div className={`metric${awaiting.count ? ' flag' : ''}`}>
        <div className="ml">
          <span className="ic">◴</span>awaiting user
        </div>
        <div className="mv mono">{String(awaiting.count)}</div>
        <div className="msub">
          {awaiting.count && oldestGate != null
            ? `oldest gate ${oldestGate} waiting`
            : 'human decisions pending'}
        </div>
      </div>

      <div className="metric">
        <div className="ml">
          <span className="ic">◷</span>orchestration age
        </div>
        <div className="mv mono">{age ?? '—'}</div>
        <div className="msub">
          {done}/{total} done · {pct}%
        </div>
      </div>

      <section className="rail-section">
        <div className="rail-heading">
          <h2>boards</h2>
          <span>
            {visibleBoards.length}/{boards.boards.length}
          </span>
        </div>
        <div aria-label="Board state filter" className="board-state-tabs">
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
          {visibleBoards.length === 0 ? (
            <p className="rail-empty">No {boardStateFilter} boards</p>
          ) : null}
        </div>
      </section>

      <section className="rail-section">
        <div className="rail-heading">
          <h2>filters ({activeFilters.size})</h2>
          <button onClick={onClearFilters} type="button">
            Clear
          </button>
        </div>
        <div className="filter-group">
          <div className="filter-group-heading">
            <span>Path</span>
          </div>
          <div aria-label="Critical path filter" className="filter-chips">
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
              <div aria-label={`${group.label} task filters`} className="filter-chips">
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
          <h2>critical path</h2>
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
