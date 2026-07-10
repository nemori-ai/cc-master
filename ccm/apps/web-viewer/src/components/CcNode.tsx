import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { fmtElapsed, statusLampVar, statusText } from '../format';
import { CONV_MIN, IMPACT_HOT, useSecondTick } from '../analytics';

export interface CcNodeData extends Record<string, unknown> {
  id: string;
  title: string;
  status: string;
  crit: boolean;
  userGate: boolean;
  bottleneck: boolean;
  impact: number;
  inDeg: number;
  dispatchedAt: number | null;
  lineage: 'self' | 'anc' | 'desc' | 'child' | null;
  enter: boolean;
  order: number;
  isOwner: boolean;
  collapsed: boolean;
  ownerChildCount: number;
  ownerDone: number;
  childOf: string | null;
  dimmed: boolean;
  horizontal: boolean;
  onToggleCollapse: (id: string) => void;
}

export type CcFlowNode = Node<CcNodeData, 'cc'>;

/** The instrument tile — lamp row, id, title, structural chips, gate flag, crit spine. */
export function CcNode({ data }: NodeProps<CcFlowNode>) {
  const cls = ['cc-node', `s-${data.status || 'unknown'}`];
  if (data.crit) cls.push('crit');
  if (data.userGate) cls.push('usergate');
  if (data.bottleneck) cls.push('bottleneck');
  if (data.enter) cls.push('enter');
  if (data.lineage) cls.push(`lin-${data.lineage}`);
  if (data.isOwner) cls.push('owner');
  if (data.collapsed) cls.push('collapsed');
  if (data.childOf) cls.push('child');
  if (data.dimmed) cls.push('dimmed');
  const lamp = data.userGate ? 'var(--alert)' : statusLampVar(data.status);
  const label = statusText(data.status);
  const title = (data.title || '').trim();

  // Live running clock: in_flight tiles tick once per second off the dispatch anchor.
  const running = data.status === 'in_flight' && data.dispatchedAt != null;
  useSecondTick(running);
  let clockStr: string | null = null;
  if (running && data.dispatchedAt != null) {
    clockStr = fmtElapsed(Date.now() - data.dispatchedAt);
  }

  const chips = [];
  if (data.isOwner && data.ownerChildCount > 0) {
    const allDone = data.ownerDone >= data.ownerChildCount;
    chips.push(
      <span
        className={`chip rollup${allDone ? ' done' : ''}`}
        key="rollup"
        title={`${data.ownerDone} of ${data.ownerChildCount} subtasks done${data.collapsed ? ' · collapsed' : ''}`}
      >
        {data.collapsed ? '▸ ' : '▾ '}subtasks
        <span className="cn">
          {data.ownerDone}/{data.ownerChildCount}
        </span>
      </span>
    );
  }
  if (data.impact > 0) {
    chips.push(
      <span className={`chip impact${data.impact >= IMPACT_HOT ? ' hot' : ''}`} key="imp">
        gates
        <span className="cn">{data.impact}</span>
      </span>
    );
  }
  if (data.inDeg >= CONV_MIN) {
    chips.push(
      <span className="chip conv" key="cv" title="convergence join">
        ⋈ in
        <span className="cn">{data.inDeg}</span>
      </span>
    );
  }
  if (clockStr) {
    chips.push(
      <span className="chip dur" key="dur" title={`running ${clockStr} since dispatch`}>
        <span className="cglyph">◷</span>
        <span className="cn">{clockStr}</span>
      </span>
    );
  }

  const style = { '--lamp': lamp, '--i': data.order || 0 } as CSSProperties;

  return (
    <div className={cls.join(' ')} style={style}>
      <Handle position={data.horizontal ? Position.Left : Position.Top} type="target" />
      {data.bottleneck ? <span className="bneck">⚠ bottleneck</span> : null}
      <div className="lamprow">
        {data.isOwner && data.ownerChildCount > 0 ? (
          <button
            className="ocaret"
            onClick={(event) => {
              event.stopPropagation();
              data.onToggleCollapse(data.id);
            }}
            title={`${data.collapsed ? 'expand' : 'collapse'} — ${data.ownerChildCount} subtasks`}
            type="button"
          >
            {data.collapsed ? '▸' : '▾'}
          </button>
        ) : null}
        <span className="lamp" style={{ background: lamp, color: lamp }} />
        <span className="stat" style={{ color: lamp }}>
          {label}
        </span>
        <span className="tid">{data.id}</span>
      </div>
      <div className={`title${title ? '' : ' empty'}`} title={title || 'untitled'}>
        {title || 'untitled'}
      </div>
      {chips.length ? <div className="meta">{chips}</div> : null}
      {data.userGate ? (
        <div className="gateflag" title="paused — waiting on your decision">
          <span className="gpause">
            <i />
            <i />
          </span>
          awaiting you
        </div>
      ) : null}
      <Handle position={data.horizontal ? Position.Right : Position.Bottom} type="source" />
    </div>
  );
}
