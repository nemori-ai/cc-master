import { normalizeStatus, shortTime } from '../format';
import type { ViewModelPayload, WorkspaceData } from '../types';

interface StatusStripProps {
  viewModel: ViewModelPayload;
  source: WorkspaceData['source'];
}

/**
 * H2 status strip (34px): pure board-level readouts, zero controls — progress meter,
 * work in flight vs wip limit (amber when over), freshness (upgrades red in place when
 * stale, in step with the global stale banner), git branch, and the fixture-source chip
 * at the tail. Lowercase labels + mono values keep the readout language.
 */
export function StatusStrip({ viewModel, source }: StatusStripProps) {
  const total = viewModel.graph.nodes.length;
  const done = viewModel.graph.nodes.filter((node) => {
    const status = normalizeStatus(String(node.status ?? ''));
    return status === 'done' || status === 'verified';
  }).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const wip = viewModel.insights?.wip ?? { count: 0, limit: null, over: false };
  const freshness = viewModel.freshness.state;
  const branch = viewModel.board.git?.branch || null;

  return (
    <div className="statusstrip">
      <div className="readout progress">
        <span className="rl">progress</span>
        <div className="meter">
          <i style={{ width: `${pct}%` }} />
        </div>
        <span className="rv">
          {done}
          <span className="unit">/{total}</span>
          <span className="unit"> {pct}%</span>
        </span>
      </div>

      <div className="vrule" />
      <div className="readout wip" data-over={wip.over ? 'true' : undefined}>
        <span className="rl">in flight</span>
        <span className="rv">
          {wip.count}
          {wip.limit != null ? <span className="unit">/{wip.limit}</span> : null}
          {wip.over ? <span className="over">⚠ over</span> : null}
        </span>
      </div>

      <div className="vrule" />
      <div className="readout freshness" data-state={freshness}>
        <span className="rl">freshness</span>
        <span className="rv">
          <i aria-hidden="true" className="fdot" /> {shortTime(viewModel.freshness.last_read_at)}
        </span>
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

      <div className="spacer" />
      {source === 'fixture' ? <div className="fixture-chip">Fixture fallback</div> : null}
    </div>
  );
}
