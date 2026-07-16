import { type CSSProperties, useRef } from 'react';
import { AGENT_CHIP_STATES, agentStateLamp, agentStateRank, agentStateText } from '../agentFormat';
import {
  awaitingIds,
  CONV_MIN,
  IMPACT_HOT,
  type LaneKind,
  LIST_SECTIONS,
  partitionTasks,
  perNodeStructure,
  tasksOf,
  useSecondTick,
} from '../analytics';
import {
  DONE_STATUSES,
  fmtDuration,
  fmtElapsed,
  normalizeStatus,
  startTs,
  statusLampVar,
  statusText,
  taskDuration,
} from '../format';
import { type LocateRequest, useLocateTask } from '../locate';
import { nodeMatchesTaskFilters } from '../taskFilters';
import type { CompactAgent, CompactTask, GraphNode, ViewModelPayload } from '../types';

interface ListViewProps {
  viewModel: ViewModelPayload;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  locateRequest: LocateRequest | null;
  activeFilters: Set<string>;
  query: string;
}

interface ListRowProps {
  task: CompactTask;
  viewModel: ViewModelPayload;
  kind: LaneKind;
  gate: boolean;
  selected: boolean;
  /** Active registry agents on this row's node (server join, precomputed by ListView). */
  agents: CompactAgent[];
  onSelectTask: (taskId: string) => void;
}

function msFromDispatch(task: CompactTask): number | null {
  const ts = startTs(task);
  return ts != null ? Date.now() - ts : null;
}

function ListRow({ task, viewModel, kind, gate, selected, agents, onSelectTask }: ListRowProps) {
  const status = normalizeStatus(typeof task.status === 'string' ? task.status : '');
  const running = status === 'in_flight' && startTs(task) != null;
  useSecondTick(running);

  const insights = viewModel.insights;
  const criticalSet = new Set(viewModel.graph.critical_path ?? []);
  const structure = perNodeStructure(insights, task.id);
  const isBneck = insights?.bottleneck?.id === task.id;

  const cls = ['lvrow', `s-${status || 'unknown'}`];
  if (gate) cls.push('usergate');
  if (selected) cls.push('sel');
  const lamp = gate ? 'var(--alert)' : statusLampVar(status);

  const parts = [];
  if (gate) {
    const elStr = fmtElapsed(msFromDispatch(task));
    parts.push(
      <span className="dpart gate" key="g">
        <span className="dk">gate</span>
        {`awaiting your decision${elStr != null ? ` · ${elStr}` : ''}`}
      </span>,
    );
  }
  if (kind === 'inflight' || running) {
    if (running) {
      const clk = fmtElapsed(Date.now() - (startTs(task) as number));
      if (clk != null) {
        parts.push(
          <span className="dpart clk" key="clk">
            <span className="cglyph">◷</span>
            {`running ${clk}`}
          </span>,
        );
      }
    }
    if (typeof task.mechanism === 'string' && task.mechanism) {
      parts.push(
        <span className="dpart" key="mech">
          <span className="dk">via</span>
          {task.mechanism +
            (typeof task.handle === 'string' && task.handle ? ` · ${task.handle}` : '')}
        </span>,
      );
    }
  } else if (kind === 'blocked' && !gate) {
    const deps = viewModel.graph.upstream?.[task.id] ?? [];
    const statusById = new Map(viewModel.graph.nodes.map((node) => [node.id, node.status]));
    const blockers = deps.filter((dep) => {
      const depStatus = normalizeStatus(String(statusById.get(dep) ?? ''));
      return depStatus !== '' && !DONE_STATUSES.has(depStatus);
    });
    const showDeps = blockers.length ? blockers : deps;
    if (task.blocked_on && task.blocked_on !== 'user') {
      parts.push(
        <span className="dpart bon" key="bon">
          <span className="dk">blocked on</span>
          {String(task.blocked_on)}
        </span>,
      );
    } else if (showDeps.length) {
      parts.push(
        <span className="dpart bon" key="bon">
          <span className="dk">blocked on</span>
          {showDeps.join(', ')}
        </span>,
      );
    }
  } else if (kind === 'done') {
    const durStr = fmtDuration(taskDuration(task));
    if (durStr != null) {
      parts.push(
        <span className="dpart" key="dur">
          <span className="dk">took</span>
          {durStr}
        </span>,
      );
    }
    if (task.artifact) {
      parts.push(
        <span className="dpart art" key="art">
          <span className="dk">artifact</span>
          {typeof task.artifact === 'string' ? task.artifact : JSON.stringify(task.artifact)}
        </span>,
      );
    }
  } else if (kind === 'attn') {
    const elStr = fmtElapsed(msFromDispatch(task));
    parts.push(
      <span className="dpart bon" key="st">
        <span className="dk">status</span>
        {statusText(status) + (elStr != null ? ` · ${elStr}` : '')}
      </span>,
    );
  }

  const chips = [];
  if (criticalSet.has(task.id)) {
    chips.push(
      <span className="lchip crit" key="cr" title="on the critical path">
        ⟋ crit
      </span>,
    );
  }
  if (isBneck) {
    chips.push(
      <span className="lchip bneck" key="bn" title="bottleneck — stalling the most work">
        ⚠ bottleneck
      </span>,
    );
  }
  if (structure.impact > 0) {
    chips.push(
      <span
        className={`lchip impact${structure.impact >= IMPACT_HOT ? ' hot' : ''}`}
        key="imp"
        title={`gates ${structure.impact} downstream tasks`}
      >
        gates
        <span className="cn">{structure.impact}</span>
      </span>,
    );
  }
  if (structure.inDeg >= CONV_MIN) {
    chips.push(
      <span className="lchip conv" key="cv" title={`convergence — ${structure.inDeg} direct deps`}>
        ⋈<span className="cn">{structure.inDeg}</span>
      </span>,
    );
  }
  // Mini agent lamp group (display-only — the whole row is one button, so no nested click
  // target; selecting the row opens the task inspector where each agent is clickable).
  if (agents.length) {
    chips.push(
      <span
        className={`lchip agents${agents.some((agent) => agent.state === 'orphaned') ? ' orphaned' : ''}`}
        key="agents"
        title={agents.map((agent) => `${agent.id} · ${agentStateText(agent.state)}`).join('\n')}
      >
        {agents.slice(0, 3).map((agent) => (
          <span
            className="alamp"
            key={agent.id}
            style={{ background: agentStateLamp(agent.state) }}
          />
        ))}
        <span className="cn">{agents.length}</span>
      </span>,
    );
  }
  const selectedRoute = task.execution?.route?.selected;
  if (selectedRoute) {
    chips.push(
      <span className="lchip route" key="route" title={task.execution?.route?.outcome}>
        {selectedRoute.surface_label}
      </span>,
    );
    if (selectedRoute.model) {
      chips.push(
        <span className="lchip model" key="model">
          {selectedRoute.model}
          {selectedRoute.role_grades.length ? ` · ${selectedRoute.role_grades.join('/')}` : ''}
        </span>,
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
      <span className="lamp" style={{ background: lamp, color: lamp }} />
      <div className="body">
        <div className="line1">
          <span className="rid">{task.id}</span>
          <span className={`rtitle${title ? '' : ' empty'}`}>{title || 'untitled'}</span>
        </div>
        {parts.length ? <div className="detailline">{parts}</div> : null}
      </div>
      {chips.length ? <div className="chips">{chips}</div> : null}
    </button>
  );
}

/**
 * The status-board list view: a scannable, status-grouped column with a condensed insights
 * strip on top. Sections in fixed priority order (AWAITING YOU first), empty ones omitted,
 * unknown statuses land under NEEDS ATTENTION.
 */
function queryMatches(node: GraphNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    node.id.toLowerCase().includes(q) ||
    (node.title ?? '').toLowerCase().includes(q) ||
    (node.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
  );
}

export function ListView({
  viewModel,
  selectedTaskId,
  onSelectTask,
  locateRequest,
  activeFilters,
  query,
}: ListViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useLocateTask(containerRef, locateRequest);
  const allTasks = tasksOf(viewModel);
  const nodesById = new Map(viewModel.graph.nodes.map((node) => [node.id, node]));
  // Agent lamp groups: table lookup over the server join (node.agent_refs -> agents[]),
  // active states only, computed once per render for all rows.
  const agentsById = new Map<string, CompactAgent>(
    (viewModel.agents ?? []).map((agent) => [agent.id, agent]),
  );
  const rowAgentsFor = (taskId: string): CompactAgent[] =>
    (nodesById.get(taskId)?.agent_refs ?? [])
      .map((ref) => agentsById.get(ref))
      .filter((agent): agent is CompactAgent => !!agent && AGENT_CHIP_STATES.has(agent.state))
      .sort((a, b) => agentStateRank(a.state) - agentStateRank(b.state));
  const tasks = allTasks.filter((task) => {
    const node = nodesById.get(task.id);
    return node ? nodeMatchesTaskFilters(node, activeFilters) && queryMatches(node, query) : false;
  });
  const gateIds = awaitingIds(viewModel);
  const sections = partitionTasks(tasks, gateIds, viewModel.insights);
  const insights = viewModel.insights;

  const done = tasks.filter((task) =>
    DONE_STATUSES.has(normalizeStatus(typeof task.status === 'string' ? task.status : '')),
  ).length;
  const total = tasks.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const critLen = viewModel.graph.critical_path?.length ?? 0;
  const wip = insights?.wip?.count ?? 0;
  const userGates = gateIds.size;

  const sectionEls = LIST_SECTIONS.filter((section) => sections[section.key].length).map(
    (section) => (
      <div className={`lvsect ${section.cls}`} key={section.key}>
        <div className="shead">
          <span className="sic">{section.icon}</span>
          <span className="snm">{section.name}</span>
          <span className="scount">{sections[section.key].length}</span>
          <span className="srule" />
        </div>
        {sections[section.key].map((task) => (
          <ListRow
            agents={rowAgentsFor(task.id)}
            gate={gateIds.has(task.id)}
            key={task.id}
            kind={section.kind}
            onSelectTask={onSelectTask}
            selected={task.id === selectedTaskId}
            task={task}
            viewModel={viewModel}
          />
        ))}
      </div>
    ),
  );

  return (
    <div id="listview" ref={containerRef}>
      <div className="lvstrip">
        <div className="si grow">
          <span className="sl">objective</span>
          <span className="sv" title={viewModel.board.goal || ''}>
            {viewModel.board.goal || 'no goal set'}
          </span>
        </div>
        <div className="si">
          <span className="sl">progress</span>
          <span className="sv">
            {done}/{total} · {pct}%
          </span>
        </div>
        <div className="si">
          <span className="sl">critical path</span>
          <span className="sv">{String(critLen)}</span>
        </div>
        <div className="si">
          <span className="sl">wip</span>
          <span className="sv">{String(wip)}</span>
        </div>
        <div className={`si${userGates ? ' flag' : ''}`}>
          <span className="sl">awaiting you</span>
          <span className="sv">{String(userGates)}</span>
        </div>
      </div>
      {sectionEls.length ? (
        sectionEls
      ) : (
        <div className="lvempty">
          {allTasks.length ? 'no tasks match current filters' : 'no tasks on the board'}
        </div>
      )}
    </div>
  );
}
