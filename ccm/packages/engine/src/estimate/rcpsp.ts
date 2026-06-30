// rcpsp.ts — RCPSP list-scheduling（min-slack + LFT tiebreak·ADR-015 §2.4 / plan §7）。
//
// 资源受限项目调度（Resource-Constrained Project Scheduling）：DAG 有依赖、但同时只能跑 WIP=k 个任务
//   （并发上限·配额/注意力）。无限资源的 CPM 给临界路径，但真实 makespan 受 WIP 限制。
//   list-scheduling 串行调度生成式（PSPLIB 共识·plan §7）：每步从「ready 集」按优先规则取一个塞进
//   最早可用资源槽。优先规则 = **min-slack 主键 + LFT（最晚完成）tiebreak**（plan §7 明确：critical-ratio
//   明确劣·min-slack + LFT 是 PSPLIB 共识）。slack = LS − ES（来自 CPM）。
//
// 输出：WIP=k 下的真实 makespan + 建议派发序（dispatch order）。
//
// 红线1：node/JS only，零 npm dep。确定性：稳定 tiebreak（slack → LFT → id），无随机。

import type { BoardLike } from '../board-graph-core.js';
import { analyzeGraph } from '../board-graph-core.js';

export interface RcpspOptions {
  wip?: number; // 资源上限 k（默认 board.scheduling.wip_limit 或 ∞）
  durations?: Map<string, number>; // id → 时长（缺则用 CPM 的 nodeDuration·调用方可注入校准值）
  nowMs?: number;
}

export interface RcpspResult {
  makespan: number; // WIP=k 下的有限资源 makespan（小时）
  dispatch_order: string[]; // 建议派发序（按调度先后）
  unlimited_makespan: number; // 无限资源 CPM makespan（对比·展示 WIP 代价）
  wip: number;
  weight_source: string; // 来自 CPM 的 weight_source（measured/estimate/mixed/unit）
  scheduled: Array<{ id: string; start: number; finish: number }>;
  source: 'rcpsp-list-scheduling';
}

// rcpspSchedule(board, opts) → 串行调度生成式（serial SGS）+ min-slack/LFT 优先规则。
//   坏图（含环 / 空）→ 退化空结果（不抛）。
export function rcpspSchedule(board: BoardLike, opts: RcpspOptions = {}): RcpspResult {
  const nowMs = opts.nowMs ?? Date.now();
  const g = analyzeGraph(board);
  const { order, cycle } = g.topoSort();
  const cp = g.criticalPath({ now: nowMs });

  if (cycle || order.length === 0) {
    return {
      makespan: 0,
      dispatch_order: [],
      unlimited_makespan: 0,
      wip: opts.wip ?? Infinity,
      weight_source: cycle ? 'cycle' : cp.weight_source,
      scheduled: [],
      source: 'rcpsp-list-scheduling',
    };
  }

  const wip = opts.wip != null && opts.wip > 0 ? opts.wip : Infinity;
  // 时长：注入优先，否则 CPM schedule.dur（已含 measured/estimate/unit 降级）。
  const durOf = (id: string): number => {
    if (opts.durations?.has(id)) return Math.max(0, opts.durations.get(id) as number);
    const e = cp.schedule.get(id);
    return e ? e.dur : 1;
  };
  // slack / LFT 来自 CPM schedule（min-slack 主键·LFT tiebreak·plan §7）。
  const slackOf = (id: string): number => cp.schedule.get(id)?.float ?? 0;
  const lftOf = (id: string): number => cp.schedule.get(id)?.lf ?? Infinity;

  const preds = new Map<string, string[]>();
  for (const id of order) preds.set(id, g.predecessors(id));

  const finish = new Map<string, number>(); // id → 完成时刻
  const start = new Map<string, number>();
  const scheduled = new Set<string>();
  const dispatchOrder: string[] = [];

  // 资源槽：记录正在占用的 (freeAt) 时刻，长度 ≤ wip。
  const busy: number[] = []; // 各资源槽的释放时刻

  // 事件驱动：反复取 ready 集（preds 全 finish 且未排），按优先规则排序，塞进最早空槽。
  const total = order.length;
  let safety = total * (Number.isFinite(wip) ? 2 : 1) + total + 5;
  while (scheduled.size < total && safety-- > 0) {
    const ready = order.filter(
      (id) => !scheduled.has(id) && (preds.get(id) as string[]).every((p) => scheduled.has(p)),
    );
    if (ready.length === 0) break; // 不应发生（无环已保证），保险
    // 优先规则：min-slack（升序）→ LFT（升序）→ id（字典序·稳定）。
    ready.sort((a, b) => slackOf(a) - slackOf(b) || lftOf(a) - lftOf(b) || a.localeCompare(b));

    // 资源约束：若已满 wip，把时间推进到最早释放的槽。
    const readyTimeOf = (id: string): number => {
      let rt = 0;
      for (const p of preds.get(id) as string[]) rt = Math.max(rt, finish.get(p) ?? 0);
      return rt;
    };

    // 取优先级最高的一个排进去。
    const id = ready[0] as string;
    const rt = readyTimeOf(id);
    let startTime: number;
    if (busy.length < wip) {
      startTime = rt;
      busy.push(0); // 占一个新槽（freeAt 稍后填）
      busy[busy.length - 1] = rt + durOf(id);
    } else {
      // 满槽：找最早释放的槽，开始时间 = max(rt, 该槽释放时刻)。
      let minIdx = 0;
      for (let i = 1; i < busy.length; i++) {
        if ((busy[i] as number) < (busy[minIdx] as number)) minIdx = i;
      }
      startTime = Math.max(rt, busy[minIdx] as number);
      busy[minIdx] = startTime + durOf(id);
    }
    start.set(id, startTime);
    finish.set(id, startTime + durOf(id));
    scheduled.add(id);
    dispatchOrder.push(id);
  }

  let makespan = 0;
  const scheduledOut: Array<{ id: string; start: number; finish: number }> = [];
  for (const id of dispatchOrder) {
    const f = finish.get(id) ?? 0;
    if (f > makespan) makespan = f;
    scheduledOut.push({ id, start: start.get(id) ?? 0, finish: f });
  }

  return {
    makespan,
    dispatch_order: dispatchOrder,
    unlimited_makespan: cp.makespan ?? makespan,
    wip,
    weight_source: cp.weight_source,
    scheduled: scheduledOut,
    source: 'rcpsp-list-scheduling',
  };
}
