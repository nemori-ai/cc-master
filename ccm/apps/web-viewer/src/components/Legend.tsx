import { STATUS_ORDER, statusLampVar, statusText } from '../format';

interface LegendProps {
  counts: Record<string, number>;
  total: number;
  activeStatusFilters: Set<string>;
  onToggleStatus: (status: string) => void;
}

/**
 * The canvas-corner status legend — one lamp row per board status (8-lamp resolution),
 * zero-count rows dimmed, plus the critical-spine key. Rows toggle the matching status
 * filter (merged interaction surface with the left-rail chips — one truth, two views).
 */
export function Legend({ counts, total, activeStatusFilters, onToggleStatus }: LegendProps) {
  return (
    <div className="legend">
      <div className="lhead">
        <span>status</span>
        <span className="total">{total} tasks</span>
      </div>
      <div className="grid">
        {STATUS_ORDER.map((status) => {
          const n = counts[status] ?? 0;
          const lamp = statusLampVar(status);
          const filterKey = `status:${status.replaceAll('_', '-')}`;
          return (
            <button
              className={`row${n ? ' live' : ''}`}
              data-active={activeStatusFilters.has(filterKey)}
              key={status}
              onClick={() => onToggleStatus(filterKey)}
              title={`toggle ${statusText(status)} filter`}
              type="button"
            >
              <span className="lamp" style={{ background: lamp, color: lamp }} />
              <span className="nm">{statusText(status)}</span>
              <span className="ct">{n ? n : '·'}</span>
            </button>
          );
        })}
      </div>
      <div className="spine-key">
        <span className="bar" />
        <span className="nm">critical path</span>
      </div>
    </div>
  );
}
