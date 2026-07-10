import { fmtElapsed, normalizeStatus, statusText } from '../format';
import { type TaskFilterGroup, taskFilterOptions } from '../taskFilters';
import type { ViewModelPayload } from '../types';

interface LeftRailProps {
  viewModel: ViewModelPayload;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  activeFilters: Set<string>;
  onToggleFilter: (filter: string) => void;
  onClearFilters: () => void;
}

const filterGroups: Array<{ id: TaskFilterGroup; label: string }> = [
  { id: 'status', label: 'Status' },
  { id: 'executor', label: 'Executor' },
  { id: 'type', label: 'Type' }
];

/**
 * The left analysis rail: read the analysis -> narrow the stage -> walk the critical
 * chain. Seven derived-telemetry insights (all clickable to jump-select), the filter
 * chip groups (always-visible state, echoed on the stage toolbar), and the ordered
 * critical-path list as the single unbounded list at the bottom (self-scrolling).
 * Board SWITCHING lives on the mission line's board chip — not here.
 */
export function LeftRail({
  viewModel,
  selectedTaskId,
  onSelectTask,
  activeFilters,
  onToggleFilter,
  onClearFilters
}: LeftRailProps) {
  const nodesById = new Map(viewModel.graph.nodes.map((node) => [node.id, node]));
  const criticalPath = viewModel.graph.critical_path ?? [];
  const insights = viewModel.insights ?? {};

  const idTitle = (id: string | null | undefined): string => {
    if (!id) return '';
    const node = nodesById.get(id);
    const title = (node?.title ?? '').trim();
    return title || id;
  };

  const total = viewModel.graph.nodes.length;

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
    <aside aria-label="Analysis, filters, and critical path" id="insights">
      <div className="ihead">analysis · {total} tasks</div>

      <div className="metric">
        <div className="ml">
          <span className="ic">⟋</span>critical path
        </div>
        <div className="mv mono">{criticalPath.length ? `length ${criticalPath.length}` : '—'}</div>
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
        <div className="msub">since the first task started</div>
      </div>

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
