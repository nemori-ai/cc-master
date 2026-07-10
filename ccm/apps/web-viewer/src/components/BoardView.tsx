import { type CSSProperties, useRef } from 'react';
import {
  BOARD_LANES,
  CONV_MIN,
  IMPACT_HOT,
  type LaneKind,
  awaitingIds,
  partitionTasks,
  perNodeStructure,
  tasksOf,
  useSecondTick
} from '../analytics';
import {
  DONE_STATUSES,
  fmtDuration,
  fmtElapsed,
  normalizeStatus,
  startTs,
  statusLampVar,
  taskDuration
} from '../format';
import { type LocateRequest, useLocateTask } from '../locate';
import type { CompactTask, ViewModelPayload } from '../types';

interface BoardViewProps {
  viewModel: ViewModelPayload;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  locateRequest: LocateRequest | null;
}

interface BoardCardProps {
  task: CompactTask;
  viewModel: ViewModelPayload;
  kind: LaneKind;
  gate: boolean;
  selected: boolean;
  onSelectTask: (taskId: string) => void;
}

function BoardCard({ task, viewModel, kind, gate, selected, onSelectTask }: BoardCardProps) {
  const status = normalizeStatus(typeof task.status === 'string' ? task.status : '');
  const running = status === 'in_flight' && startTs(task) != null;
  useSecondTick(running);

  const insights = viewModel.insights;
  const criticalSet = new Set(viewModel.graph.critical_path ?? []);
  const structure = perNodeStructure(insights, task.id);
  const isBneck = insights?.bottleneck?.id === task.id;
  const cls = ['bvcard', `s-${status || 'unknown'}`];
  if (gate) cls.push('usergate');
  if (criticalSet.has(task.id)) cls.push('crit');
  if (isBneck) cls.push('bneck');
  if (selected) cls.push('sel');
  const lamp = gate ? 'var(--alert)' : statusLampVar(status);

  const chips = [];
  if (structure.impact > 0) {
    chips.push(
      <span
        className={`bchip impact${structure.impact >= IMPACT_HOT ? ' hot' : ''}`}
        key="imp"
        title={`gates ${structure.impact} downstream tasks`}
      >
        gates
        <span className="cn">{structure.impact}</span>
      </span>
    );
  }
  if (structure.inDeg >= CONV_MIN) {
    chips.push(
      <span className="bchip conv" key="cv" title={`convergence — ${structure.inDeg} direct deps`}>
        ⋈<span className="cn">{structure.inDeg}</span>
      </span>
    );
  }
  if (criticalSet.has(task.id)) {
    chips.push(
      <span className="bchip crit" key="cr" title="on the critical path">
        ⟋ crit
      </span>
    );
  }
  if (isBneck) {
    chips.push(
      <span className="bchip bneck" key="bn" title="bottleneck — stalling the most work">
        ⚠ bottleneck
      </span>
    );
  }

  let detail = null;
  if (gate) {
    detail = (
      <div className="cdetail gate">
        <span className="gpause">
          <i />
          <i />
        </span>
        <span className="dv">awaiting you</span>
      </div>
    );
  } else if (kind === 'inflight' && running) {
    const clk = fmtElapsed(Date.now() - (startTs(task) as number));
    if (clk != null) {
      detail = (
        <div className="cdetail clk">
          <span className="cglyph">◷</span>
          <span className="dv">{clk}</span>
        </div>
      );
    }
  } else if (kind === 'done') {
    const durStr = fmtDuration(taskDuration(task));
    if (durStr != null) {
      detail = (
        <div className="cdetail took">
          <span className="dk">took</span>
          <span className="dv">{durStr}</span>
        </div>
      );
    }
  } else if (kind === 'blocked') {
    let on: string | null = null;
    if (task.blocked_on && task.blocked_on !== 'user') {
      on = String(task.blocked_on);
    } else {
      const deps = viewModel.graph.upstream?.[task.id] ?? [];
      const statusById = new Map(viewModel.graph.nodes.map((node) => [node.id, node.status]));
      const blockers = deps.filter((dep) => {
        const depStatus = normalizeStatus(String(statusById.get(dep) ?? ''));
        return depStatus !== '' && !DONE_STATUSES.has(depStatus);
      });
      const showDeps = blockers.length ? blockers : deps;
      if (showDeps.length) on = showDeps.join(', ');
    }
    if (on != null) {
      detail = (
        <div className="cdetail bon">
          <span className="dk">⛔</span>
          <span className="dv">{on}</span>
        </div>
      );
    }
  }

  const title = (typeof task.title === 'string' ? task.title : '').trim();
  return (
    <button
      className={cls.join(' ')}
      data-task-id={task.id}
      onClick={() => onSelectTask(task.id)}
      style={{ '--lamp': lamp } as CSSProperties}
      type="button"
    >
      <div className="cardtop">
        <span className="lamp" style={{ background: lamp, color: lamp }} />
        <span className="cid">{task.id}</span>
      </div>
      <div className={`ctitle${title ? '' : ' empty'}`}>{title || 'untitled'}</div>
      {chips.length ? <div className="cchips">{chips}</div> : null}
      {detail}
    </button>
  );
}

/**
 * The Kanban card board — workflow stages become lanes, tasks become compact cards. Lanes
 * in fixed order (AWAITING YOU → READY → IN FLIGHT → BLOCKED → DONE → NEEDS ATTENTION),
 * empty lanes omitted, each task in exactly one lane, cards sorted by downstream impact.
 */
export function BoardView({ viewModel, selectedTaskId, onSelectTask, locateRequest }: BoardViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useLocateTask(containerRef, locateRequest);
  const tasks = tasksOf(viewModel);
  const gateIds = awaitingIds(viewModel);
  const lanes = partitionTasks(tasks, gateIds, viewModel.insights);

  const laneEls = BOARD_LANES.filter((lane) => lanes[lane.key].length).map((lane) => (
    <div className={`bvlane ${lane.cls}`} key={lane.key}>
      <div className="lanehead">
        <span className="lic">{lane.icon}</span>
        <span className="lnm">{lane.name}</span>
        <span className="lct">{lanes[lane.key].length}</span>
      </div>
      <div className="lanebody">
        {lanes[lane.key].map((task) => (
          <BoardCard
            gate={gateIds.has(task.id)}
            key={task.id}
            kind={lane.kind}
            onSelectTask={onSelectTask}
            selected={task.id === selectedTaskId}
            task={task}
            viewModel={viewModel}
          />
        ))}
      </div>
    </div>
  ));

  return (
    <div id="boardview" ref={containerRef}>
      {laneEls.length ? (
        <div className="bvlanes">{laneEls}</div>
      ) : (
        <div className="bvempty">no tasks on the board</div>
      )}
    </div>
  );
}
