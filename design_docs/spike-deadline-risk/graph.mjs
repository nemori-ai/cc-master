// graph.mjs — DAG 图分析核心（topo / CPM / 邻接）。
//
// 从 ccm/packages/engine/src/board-graph-core.ts + board-lint-core.ts(buildGraph/findCycle) 移植出
// spike 需要的最小子集（拓扑序·CPM ES/EF/LS/LF/float·临界链·前驱表·nodeDuration 降级链·wip 计数）。
// 算法逻辑、降级链、weight_source 判定、forward/backward pass、float 公式逐字保持（零行为变化）。
//
// D3B 移植回引擎时**不需搬这个文件**——引擎已有 board-graph-core.ts；此文件只为 spike 自包含。

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const DONE = 'done';

function parseTs(v) {
  if (typeof v !== 'string' || !ISO_UTC_RE.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

// estimateHours(estimate) → 估点折算小时（>0）或 null。支持 h/m/d/w（大小写不敏感）。
export function estimateHours(estimate) {
  if (!estimate || typeof estimate !== 'object') return null;
  const value = estimate.value;
  const unit = String(estimate.unit || '').toLowerCase();
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  if (/^(h|hour|hours)$/.test(unit)) return value;
  if (/^(m|min|mins|minute|minutes)$/.test(unit)) return value / 60;
  if (/^(d|day|days)$/.test(unit)) return value * 24;
  if (/^(w|week|weeks)$/.test(unit)) return value * 24 * 7;
  return null; // 未知单位 → 降级 unit
}

// nodeDuration(task, nowMs) → { dur, source }。降级链 measured → estimate → unit（=1）。
export function nodeDuration(task, nowMs) {
  if (task && typeof task === 'object') {
    const started = parseTs(task.started_at);
    const finished = parseTs(task.finished_at);
    if (started != null && finished != null && finished > started) {
      return { dur: (finished - started) / 3600000, source: 'measured' };
    }
    if (started != null && task.status === 'in_flight') {
      const el = nowMs - started;
      if (el > 0) return { dur: el / 3600000, source: 'measured' };
    }
    const est = estimateHours(task.estimate);
    if (est != null) return { dur: est, source: 'estimate' };
  }
  return { dur: 1, source: 'unit' };
}

// findCycle(adj) → 环上的 id 列表或 null。adj: Map<id, id[]>（出边）。DFS 三色。
function findCycle(adj) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  const parent = new Map();
  for (const id of adj.keys()) color.set(id, WHITE);
  let cycle = null;
  const stack = [];
  for (const start of adj.keys()) {
    if (color.get(start) !== WHITE) continue;
    // 迭代式 DFS（防大图爆栈）
    stack.push({ id: start, i: 0 });
    color.set(start, GRAY);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const outs = adj.get(top.id) || [];
      if (top.i < outs.length) {
        const nxt = outs[top.i++];
        if (!adj.has(nxt)) continue;
        const cn = color.get(nxt);
        if (cn === WHITE) {
          color.set(nxt, GRAY);
          parent.set(nxt, top.id);
          stack.push({ id: nxt, i: 0 });
        } else if (cn === GRAY) {
          // 找到回边 → 重建环
          const c = [nxt];
          let cur = top.id;
          while (cur !== nxt && cur != null) { c.push(cur); cur = parent.get(cur); }
          c.reverse();
          cycle = c;
          return cycle;
        }
      } else {
        color.set(top.id, BLACK);
        stack.pop();
      }
    }
  }
  return null;
}

// buildGraph(tasks) → { ids, taskById, upstream, downstream }。upstream=deps（前驱），downstream=反向。
//   dangling deps（指向不存在任务）与自环丢弃（不入图）——与 board-lint-core.buildGraph 同口径。
function buildGraph(tasks) {
  const ids = new Set();
  const taskById = new Map();
  for (const t of tasks) {
    if (t && typeof t === 'object' && typeof t.id === 'string' && t.id) {
      ids.add(t.id);
      taskById.set(t.id, t);
    }
  }
  const upstream = new Map();
  const downstream = new Map();
  for (const id of ids) { upstream.set(id, []); downstream.set(id, []); }
  for (const id of ids) {
    const t = taskById.get(id);
    const deps = Array.isArray(t.deps) ? t.deps : [];
    for (const d of deps) {
      if (typeof d !== 'string' || d === id || !ids.has(d)) continue; // 自环/dangling 丢弃
      upstream.get(id).push(d);
      downstream.get(d).push(id);
    }
  }
  return { ids, taskById, upstream, downstream };
}

// analyzeGraph(board) → 图句柄（spike 子集：topoSort / predecessors / criticalPath / wipStats）。
export function analyzeGraph(board) {
  const tasks = board && typeof board === 'object' && Array.isArray(board.tasks) ? board.tasks : [];
  const g = buildGraph(tasks);
  const { ids, taskById, upstream, downstream } = g;

  const statusOf = (id) => { const t = taskById.get(id); return t ? t.status : undefined; };

  function topoSort() {
    const cyc = findCycle(upstream);
    const indeg = new Map();
    for (const id of ids) indeg.set(id, upstream.get(id).length);
    const queue = [];
    for (const id of ids) if (indeg.get(id) === 0) queue.push(id);
    queue.sort();
    const order = [];
    while (queue.length) {
      const n = queue.shift();
      order.push(n);
      const next = [];
      for (const m of downstream.get(n)) {
        indeg.set(m, indeg.get(m) - 1);
        if (indeg.get(m) === 0) next.push(m);
      }
      next.sort();
      for (const m of next) queue.push(m);
    }
    return { order, cycle: cyc };
  }

  function predecessors(id) {
    return ids.has(id) ? upstream.get(id).slice() : [];
  }

  function wipStats() {
    const counts = {};
    let inFlight = 0, blocked = 0;
    for (const id of ids) {
      const s = statusOf(id);
      counts[s] = (counts[s] || 0) + 1;
      if (s === 'in_flight') inFlight++;
      if (s === 'blocked') blocked++;
    }
    return { in_flight: inFlight, blocked, counts };
  }

  // criticalPath(opts) → CPM。weight_source 诚实性：mixed/unit 不报 makespan 小时数（伪精确）。
  function criticalPath(opts) {
    const nowMs = opts && Number.isFinite(opts.now) ? opts.now : Date.now();
    const cyc = findCycle(upstream);
    if (cyc) return { chain: [], schedule: new Map(), makespan: null, weight_source: 'cycle', cycle: cyc };

    const order = topoSort().order;
    const dur = new Map();
    let nMeasured = 0, nEstimate = 0, nUnit = 0;
    for (const id of ids) {
      const { dur: d, source } = nodeDuration(taskById.get(id), nowMs);
      dur.set(id, d);
      if (source === 'measured') nMeasured++;
      else if (source === 'estimate') nEstimate++;
      else nUnit++;
    }
    const kinds = (nMeasured > 0 ? 1 : 0) + (nEstimate > 0 ? 1 : 0) + (nUnit > 0 ? 1 : 0);
    let weight_source = 'unit';
    if (kinds > 1) weight_source = 'mixed';
    else if (nMeasured > 0) weight_source = 'measured';
    else if (nEstimate > 0) weight_source = 'estimate';

    const es = new Map(), ef = new Map();
    for (const id of order) {
      let e = 0;
      for (const d of upstream.get(id)) e = Math.max(e, ef.get(d) || 0);
      es.set(id, e);
      ef.set(id, e + dur.get(id));
    }
    let makespan = 0;
    for (const id of ids) makespan = Math.max(makespan, ef.get(id) || 0);

    const lf = new Map(), ls = new Map();
    const revOrder = order.slice().reverse();
    for (const id of revOrder) {
      const downs = downstream.get(id);
      let l = makespan;
      if (downs.length) { l = Infinity; for (const m of downs) l = Math.min(l, ls.get(m)); }
      lf.set(id, l);
      ls.set(id, l - dur.get(id));
    }

    const schedule = new Map();
    for (const id of ids) {
      const downs = downstream.get(id);
      let ff = makespan - (ef.get(id) || 0);
      if (downs.length) { ff = Infinity; for (const m of downs) ff = Math.min(ff, (es.get(m) || 0) - (ef.get(id) || 0)); }
      schedule.set(id, {
        es: es.get(id) || 0, ef: ef.get(id) || 0, ls: ls.get(id) || 0, lf: lf.get(id) || 0,
        float: (ls.get(id) || 0) - (es.get(id) || 0), free_float: ff, dur: dur.get(id),
      });
    }

    const EPS = 1e-9;
    let endId = null, endEf = -Infinity;
    for (const id of ids) { const e = ef.get(id) || 0; if (e > endEf) { endEf = e; endId = id; } }
    const chain = [];
    let cur = endId;
    const guard = new Set();
    while (cur != null && !guard.has(cur)) {
      guard.add(cur);
      chain.push(cur);
      const myEs = es.get(cur) || 0;
      let pick = null;
      for (const d of upstream.get(cur)) { if (Math.abs((ef.get(d) || 0) - myEs) < EPS) { pick = d; break; } }
      cur = pick;
    }
    chain.reverse();

    return {
      chain, schedule,
      makespan: weight_source === 'measured' || weight_source === 'estimate' ? makespan : null,
      weight_source,
    };
  }

  return { ids, taskById, upstream, downstream, topoSort, predecessors, wipStats, criticalPath };
}
