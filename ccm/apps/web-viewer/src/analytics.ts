// Presentation-level derivations ONLY. Scheduling semantics (transitive closures, longest
// chains, impact counts, bottleneck picks) come from the SERVER view-model (`insights`,
// `graph.critical_path`, `rank_index`) — this module never rebuilds a second scheduling
// engine (ADR-029 §2.6). What lives here: lane partitions/sort orders for the board/list
// views, the timeline axis-mode pick + bar spans, and a single-source reachability walk over
// the server-provided adjacency used purely for the selection-lineage visual highlight.
import { useEffect, useState } from 'react';
import { DONE_STATUSES, createTs, normalizeStatus, startTs, taskDuration } from './format';
import type { CompactTask, InsightsPayload, ViewModelPayload } from './types';

export const IMPACT_HOT = 3; // gates >= 3 downstream -> high-leverage chip goes hot
export const CONV_MIN = 2; // in-degree >= 2 -> a convergence join

export const NEEDS_ATTN = new Set(['stale', 'failed', 'escalated', 'uncertain']);

export interface NodeStructure {
  impact: number;
  inDeg: number;
}

export function perNodeStructure(
  insights: InsightsPayload | undefined,
  id: string
): NodeStructure {
  const entry = insights?.per_node?.[id];
  return { impact: entry?.impact ?? 0, inDeg: entry?.in_deg ?? 0 };
}

export function awaitingIds(viewModel: ViewModelPayload): Set<string> {
  return new Set(
    viewModel.graph.nodes.filter((node) => node.awaiting_user === true).map((node) => node.id)
  );
}

export function tasksOf(viewModel: ViewModelPayload): CompactTask[] {
  return Array.isArray(viewModel.tasks) ? viewModel.tasks : [];
}

// ---- lane / section partition (board + list views) --------------------------------------
// Fixed orders; empty lanes omitted at render time; every task lands in exactly ONE lane and
// unknown statuses surface under NEEDS ATTENTION (never vanish).

export type LaneKind = 'gate' | 'ready' | 'inflight' | 'blocked' | 'done' | 'attn';

export interface LaneDescriptor {
  key: LaneKey;
  cls: string;
  icon: string;
  name: string;
  kind: LaneKind;
}

export const BOARD_LANES: LaneDescriptor[] = [
  { key: 'gate', cls: 'gate', icon: '⏸', name: 'awaiting you', kind: 'gate' },
  { key: 'ready', cls: '', icon: '◷', name: 'ready', kind: 'ready' },
  { key: 'in_flight', cls: '', icon: '▶', name: 'in flight', kind: 'inflight' },
  { key: 'blocked', cls: '', icon: '⛔', name: 'blocked', kind: 'blocked' },
  { key: 'done', cls: '', icon: '✓', name: 'done · verified', kind: 'done' },
  { key: 'attn', cls: '', icon: '⚠', name: 'needs attention', kind: 'attn' }
];

export const LIST_SECTIONS: LaneDescriptor[] = [
  { key: 'gate', cls: 'gate', icon: '⏸', name: 'awaiting you', kind: 'gate' },
  { key: 'in_flight', cls: '', icon: '▶', name: 'in flight', kind: 'inflight' },
  { key: 'blocked', cls: '', icon: '⛔', name: 'blocked', kind: 'blocked' },
  { key: 'ready', cls: '', icon: '◷', name: 'ready', kind: 'ready' },
  { key: 'done', cls: '', icon: '✓', name: 'done / verified', kind: 'done' },
  { key: 'attn', cls: '', icon: '⚠', name: 'needs attention', kind: 'attn' }
];

export interface TaskLanes {
  gate: CompactTask[];
  ready: CompactTask[];
  in_flight: CompactTask[];
  blocked: CompactTask[];
  done: CompactTask[];
  attn: CompactTask[];
}

export type LaneKey = keyof TaskLanes;

export function partitionTasks(
  tasks: CompactTask[],
  gateIds: Set<string>,
  insights: InsightsPayload | undefined
): TaskLanes {
  const lanes: TaskLanes = {
    gate: [],
    ready: [],
    in_flight: [],
    blocked: [],
    done: [],
    attn: []
  };
  for (const task of tasks) {
    if (gateIds.has(task.id)) {
      lanes.gate.push(task);
      continue;
    }
    const status = normalizeStatus(typeof task.status === 'string' ? task.status : '');
    if (status === 'ready') lanes.ready.push(task);
    else if (status === 'in_flight') lanes.in_flight.push(task);
    else if (status === 'blocked') lanes.blocked.push(task);
    else if (DONE_STATUSES.has(status)) lanes.done.push(task);
    else lanes.attn.push(task); // NEEDS_ATTN + unknown statuses surface, never vanish
  }
  const byImpact = (a: CompactTask, b: CompactTask) =>
    perNodeStructure(insights, b.id).impact - perNodeStructure(insights, a.id).impact ||
    String(a.id).localeCompare(String(b.id));
  for (const key of Object.keys(lanes) as LaneKey[]) lanes[key].sort(byImpact);
  return lanes;
}

// ---- timeline axis selection + bar spans -------------------------------------------------
// REAL-TIME axis only on a version-gated board (meta.template_version) with enough parseable
// anchors; otherwise the TOPOLOGICAL depth axis. Depth is read straight off the server's
// longest-path rank (`rank_index`) — never recomputed client-side.

const TIME_SCHEMA_MIN_VERSION = 1;

export function templateVersion(viewModel: ViewModelPayload): number {
  const version = viewModel.board.meta?.template_version;
  return typeof version === 'number' && Number.isFinite(version) ? version : 0;
}

export function isNotStarted(task: CompactTask): boolean {
  const status = normalizeStatus(typeof task.status === 'string' ? task.status : '');
  return startTs(task) == null && (status === 'ready' || status === 'blocked');
}

export interface TimelineRow {
  task: CompactTask;
  start: number;
  end: number;
  pip: boolean;
  running: boolean;
}

export interface TimelineModel {
  mode: 'time' | 'topo';
  versionGated: boolean;
  rows: TimelineRow[];
  lo: number;
  total: number;
}

export function buildTimeline(viewModel: ViewModelPayload): TimelineModel {
  const tasks = tasksOf(viewModel);
  const insights = viewModel.insights;
  const criticalSet = new Set(viewModel.graph.critical_path ?? []);
  const now = Date.now();
  const versionGated = templateVersion(viewModel) >= TIME_SCHEMA_MIN_VERSION;

  const anchors: number[] = [];
  for (const task of tasks) {
    const anchor = startTs(task) ?? createTs(task);
    if (anchor != null) anchors.push(anchor);
  }
  let mode: 'time' | 'topo' = 'topo';
  if (versionGated && anchors.length >= 2 && anchors.length >= Math.ceil(tasks.length / 2)) {
    const span = Math.max(...anchors) - Math.min(...anchors);
    if (span > 0) mode = 'time';
  }

  const rankIndexById = new Map(
    viewModel.graph.nodes.map((node) => [node.id, node.rank_index ?? 0])
  );

  const rows: TimelineRow[] = [];
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  if (mode === 'time') {
    for (const task of tasks) {
      const status = normalizeStatus(typeof task.status === 'string' ? task.status : '');
      const disp = startTs(task);
      let start = disp != null ? disp : createTs(task);
      let end: number | null = null;
      let pip = false;
      let running = false;
      const dur = taskDuration(task);
      if (status === 'in_flight' && disp != null) {
        end = now;
        running = true;
      } else if (DONE_STATUSES.has(status) && dur && disp != null) {
        end = disp + dur.ms;
      } else if (disp != null && dur && dur.ms > 0) {
        end = disp + dur.ms;
        running = !!dur.running;
      }
      if (start == null) {
        start = now;
        end = now;
        pip = true;
      } else if (disp == null) {
        end = start;
        pip = true;
      } else if (end == null || end <= start) {
        end = start;
        pip = true;
      }
      rows.push({ task, start, end, pip, running });
      lo = Math.min(lo, start);
      hi = Math.max(hi, end);
    }
  } else {
    for (const task of tasks) {
      const depth = (rankIndexById.get(task.id) ?? 0) + 1;
      const status = normalizeStatus(typeof task.status === 'string' ? task.status : '');
      rows.push({ task, start: depth - 1, end: depth, pip: false, running: status === 'in_flight' });
      lo = Math.min(lo, depth - 1);
      hi = Math.max(hi, depth);
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0;
    hi = 1;
  }
  let total = hi - lo;
  if (total <= 0) total = 1;

  rows.sort(
    (a, b) =>
      a.start - b.start ||
      (criticalSet.has(b.task.id) ? 1 : 0) - (criticalSet.has(a.task.id) ? 1 : 0) ||
      perNodeStructure(insights, b.task.id).impact - perNodeStructure(insights, a.task.id).impact ||
      String(a.task.id).localeCompare(String(b.task.id))
  );

  return { mode, versionGated, rows, lo, total };
}

// ---- selection lineage (visual highlight only) -------------------------------------------
// Single-source reachability over the SERVER-provided adjacency maps. This powers the
// dim-non-lineage focus effect on selection; it does not feed any scheduling readout.

function reach(adjacency: Record<string, string[]> | undefined, from: string): Set<string> {
  const acc = new Set<string>();
  if (!adjacency) return acc;
  const stack = [...(adjacency[from] ?? [])];
  while (stack.length) {
    const next = stack.pop() as string;
    if (acc.has(next) || next === from) continue;
    acc.add(next);
    for (const child of adjacency[next] ?? []) {
      if (!acc.has(child)) stack.push(child);
    }
  }
  return acc;
}

export interface LineageSets {
  ancestors: Set<string>;
  descendants: Set<string>;
  children: Set<string>;
}

export function lineageFor(viewModel: ViewModelPayload, selected: string | null): LineageSets {
  if (!selected) {
    return { ancestors: new Set(), descendants: new Set(), children: new Set() };
  }
  const parents = viewModel.graph.parents ?? {};
  const children = new Set(
    Object.entries(parents)
      .filter(([, owner]) => owner === selected)
      .map(([id]) => id)
  );
  return {
    ancestors: reach(viewModel.graph.upstream, selected),
    descendants: reach(viewModel.graph.downstream, selected),
    children
  };
}

// ---- a 1-second ticker so live clocks read as live ---------------------------------------
// The 2s poll refreshes data; a running clock should visibly advance between polls. This
// hook re-renders the subscribing component once per second without re-fetching anything.
export function useSecondTick(active: boolean): void {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => force((n) => (n + 1) & 0xffff), 1000);
    return () => clearInterval(interval);
  }, [active]);
}
