import type { CSSProperties } from 'react';
import { type TimelineRow, awaitingIds, buildTimeline, isNotStarted, useSecondTick } from '../analytics';
import {
  DONE_STATUSES,
  fmtDuration,
  fmtElapsed,
  normalizeStatus,
  startTs,
  statusLampVar,
  statusText,
  taskDuration
} from '../format';
import type { ViewModelPayload } from '../types';

interface TimelineViewProps {
  viewModel: ViewModelPayload;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}

interface TimelineLaneProps {
  row: TimelineRow;
  viewModel: ViewModelPayload;
  gate: boolean;
  lo: number;
  total: number;
  mode: 'time' | 'topo';
  selected: boolean;
  onSelectTask: (taskId: string) => void;
  ticks: Array<{ f: number; lab: string }>;
}

function TimelineLane({
  row,
  viewModel,
  gate,
  lo,
  total,
  mode,
  selected,
  onSelectTask,
  ticks
}: TimelineLaneProps) {
  const task = row.task;
  const status = normalizeStatus(typeof task.status === 'string' ? task.status : '');
  const running = status === 'in_flight' && startTs(task) != null;
  useSecondTick(running);

  const criticalSet = new Set(viewModel.graph.critical_path ?? []);
  const isBneck = viewModel.insights?.bottleneck?.id === task.id;
  const notStarted = isNotStarted(task) && !gate;
  const lamp = gate ? 'var(--alert)' : statusLampVar(status);

  let start = row.start;
  let end = row.end;
  let pip = row.pip;
  if (mode === 'time' && running) {
    end = Date.now();
    if (end <= start) {
      end = start;
      pip = true;
    }
  }
  const leftF = (start - lo) / total;
  const widthF = pip ? 0 : (end - start) / total;
  const leftPct = Math.max(0, Math.min(100, leftF * 100));
  const widthPct = Math.max(0, Math.min(100 - leftPct, widthF * 100));

  const laneCls = ['tllane', `s-${status || 'unknown'}`];
  if (gate) laneCls.push('usergate');
  if (notStarted) laneCls.push('notstarted');
  if (selected) laneCls.push('sel');

  const barCls = ['tlbar'];
  if (pip) barCls.push('pip');
  if (notStarted) barCls.push('notstarted');
  else {
    if (criticalSet.has(task.id)) barCls.push('crit');
    if (isBneck) barCls.push('bneck');
  }
  if (gate) barCls.push('usergate');
  if (running) barCls.push('running');
  if (selected) barCls.push('sel');

  let blabel = null;
  if (!pip) {
    if (running) {
      const clk = fmtElapsed(Date.now() - (startTs(task) as number));
      if (clk != null) {
        blabel = (
          <span className="blabel">
            <span className="cglyph">◷</span>
            {clk}
          </span>
        );
      }
    } else if (DONE_STATUSES.has(status)) {
      const durStr = fmtDuration(taskDuration(task));
      blabel = <span className="blabel">{durStr != null ? durStr : task.id}</span>;
    }
    if (blabel == null) blabel = <span className="blabel">{task.id}</span>;
  }

  const title = (typeof task.title === 'string' ? task.title : '').trim();
  const barTitle = `${task.id}${title ? ` · ${title}` : ''} · ${statusText(status)}${
    mode === 'time' && !pip ? ` · ${fmtElapsed(end - start) || ''}` : ''
  }`;

  const barStyle: CSSProperties = pip
    ? ({ left: `${leftPct}%`, '--lamp': lamp } as CSSProperties)
    : ({ left: `${leftPct}%`, width: `${widthPct}%`, '--lamp': lamp } as CSSProperties);

  return (
    <div className={laneCls.join(' ')} style={{ '--lamp': lamp } as CSSProperties}>
      <button
        className="tllabel"
        onClick={() => onSelectTask(task.id)}
        style={{ '--lamp': lamp } as CSSProperties}
        type="button"
      >
        <span className="lamp" style={{ background: lamp, color: lamp }} />
        <span className="lid">{task.id}</span>
        <span className={`ltt${title ? '' : ' empty'}`}>{title || 'untitled'}</span>
      </button>
      <div className="tltrack">
        <div className="tlgrid">
          {ticks.map((tick) => (
            <i key={tick.f} style={{ left: `${tick.f * 100}%` }} />
          ))}
        </div>
        <button
          className={barCls.join(' ')}
          onClick={(event) => {
            event.stopPropagation();
            onSelectTask(task.id);
          }}
          style={barStyle}
          title={barTitle}
          type="button"
        >
          {pip ? null : <span className="cap" />}
          {blabel}
        </button>
      </div>
    </div>
  );
}

/**
 * The gantt swimlane view: one bar per task on a shared x-scale so overlap reads as
 * parallelism. REAL-TIME axis when the board carries enough parseable start anchors (and a
 * version-gated time schema); TOPOLOGICAL depth axis (server rank) otherwise.
 */
export function TimelineView({ viewModel, selectedTaskId, onSelectTask }: TimelineViewProps) {
  const timeline = buildTimeline(viewModel);
  const anyRunning = timeline.rows.some((row) => row.running && startTs(row.task) != null);
  useSecondTick(anyRunning && timeline.mode === 'time');

  if (!timeline.rows.length) {
    return (
      <div id="timelineview">
        <div className="tlempty">no tasks on the board</div>
      </div>
    );
  }

  const gateIds = awaitingIds(viewModel);
  const now = Date.now();
  const TICKS = 5;
  const ticks: Array<{ f: number; lab: string }> = [];
  for (let i = 0; i < TICKS; i++) {
    const f = i / (TICKS - 1);
    const at = timeline.lo + timeline.total * f;
    const lab =
      timeline.mode === 'time'
        ? i === 0
          ? 'start'
          : `+${fmtElapsed(at - timeline.lo) || '0'}`
        : `depth ${Math.round(at)}`;
    ticks.push({ f, lab });
  }

  let nowEl = null;
  if (
    timeline.mode === 'time' &&
    anyRunning &&
    now >= timeline.lo &&
    now <= timeline.lo + timeline.total
  ) {
    const f = (now - timeline.lo) / timeline.total;
    nowEl = (
      <div className="tlnowlayer">
        <div className="tlnow" style={{ left: `${f * 100}%` }} />
      </div>
    );
  }

  return (
    <div id="timelineview">
      <div className="tlaxis">
        <div className="axhead">
          <span className="axl">timeline</span>
          <span className="axmode">{timeline.mode === 'time' ? 'time' : 'depth'}</span>
        </div>
        <div className="axscale">
          {ticks.map((tick) => (
            <span className="axtick" key={tick.f} style={{ left: `${tick.f * 100}%` }}>
              {tick.lab}
            </span>
          ))}
        </div>
      </div>
      <div className="tllanes" style={{ position: 'relative' }}>
        {nowEl}
        {timeline.rows.map((row) => (
          <TimelineLane
            gate={gateIds.has(row.task.id)}
            key={row.task.id}
            lo={timeline.lo}
            mode={timeline.mode}
            onSelectTask={onSelectTask}
            row={row}
            selected={row.task.id === selectedTaskId}
            ticks={ticks}
            total={timeline.total}
            viewModel={viewModel}
          />
        ))}
      </div>
      <div className="tlfoot">
        <span className="fk">
          <span className="spinebar" />
          critical chain
        </span>
        {timeline.mode === 'time' ? (
          <span className="fk">
            <span className="nowbar" />
            now · live
          </span>
        ) : null}
        <span className="fk">
          {timeline.mode === 'time'
            ? 'axis · real time (start → finish)'
            : timeline.versionGated
              ? 'axis · topological depth (no timestamps — structural fallback)'
              : 'axis · topological depth (legacy board, no time schema — structural fallback)'}
        </span>
      </div>
    </div>
  );
}
