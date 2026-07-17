// latency-bench.mjs — 性能预算实测（契约 §6.3·风险 top1）。
//
// 量：2000 trials × 三通道在真实规模图上跑多久 + trials/规模的降档曲线。hook 以 10s timeout 调 endpoint，
//   须远低于·留 headroom。用真实 board 图结构（真实边密度）+ 合成放大图（压力）双测。
//
// 跑：node design_docs/spike-deadline-risk/latency-bench.mjs

import { precedenceOnlyMc, rcpspInTrialMc, rcpspInTrialMcNaive, throughputMc } from './channels.mjs';
import { loadAllBoards, buildMcParamsSpike, deriveCalibration, extractDoneRecords, backlogCountAsOf } from './board-io.mjs';
import { Sfc32 } from './prng.mjs';
import * as os from 'node:os';
import * as path from 'node:path';

const BOARDS_DIR = path.join(os.homedir(), '.cc_master', 'boards');

function timeit(fn, reps = 3) {
  // warmup
  fn();
  let best = Infinity;
  for (let i = 0; i < reps; i++) { const t0 = process.hrtime.bigint(); fn(); const t1 = process.hrtime.bigint(); best = Math.min(best, Number(t1 - t0) / 1e6); }
  return best; // ms (best-of-reps·减 GC 噪声)
}

// 合成放大图（链 + 分叉·边密度 ~1.5/node）。
function synthBoard(n, seed = 1, wip = 8) {
  const g = new Sfc32(seed);
  const tasks = [];
  for (let i = 0; i < n; i++) {
    const deps = [];
    const k = i === 0 ? 0 : 1 + g.nextInt(Math.min(2, i));
    const cand = []; for (let j = Math.max(0, i - 12); j < i; j++) cand.push(j);
    for (let d = 0; d < k && cand.length; d++) { const pick = g.nextInt(cand.length); deps.push(`T${cand[pick]}`); cand.splice(pick, 1); }
    tasks.push({ id: `T${i}`, status: 'ready', deps, estimate: { value: 1 + g.nextInt(8), unit: 'h' } });
  }
  return { tasks, scheduling: { wip_limit: wip } };
}

function paramsUnitCv(board, mean = 4, cv = 0.6) {
  const p = new Map();
  for (const t of board.tasks) if (!isDone(t)) p.set(t.id, { meanHours: mean, cv }); else p.set(t.id, { meanHours: 0, cv });
  return p;
}
function isDone(t) { return t.status === 'done'; }
function edgeCount(board) { let e = 0; for (const t of board.tasks) e += Array.isArray(t.deps) ? t.deps.length : 0; return e; }
function activeCount(board) { return board.tasks.filter((t) => !isDone(t)).length; }

const RUNS = 2000;
console.log(`# latency-bench (node ${process.version}, ${os.cpus().length} cores, best-of-3, runs=${RUNS} unless noted)\n`);

// ── A. 真实 board 图（真实边密度·全任务当 active·params 用全局 cv）──
console.log('## A. 真实 board 图（全任务视为 backlog·mean=4h cv=0.6·wip=board 值）');
console.log('| board | tasks | edges | wip | precedence | rcpsp(heap) | rcpsp(naive) | throughput |');
console.log('|---|---|---|---|---|---|---|---|');
const boards = loadAllBoards(BOARDS_DIR).map((x) => x.board).filter((b) => Array.isArray(b.tasks) && b.tasks.length >= 15);
boards.sort((a, b) => b.tasks.length - a.tasks.length);
const allRecords = [];
for (const b of loadAllBoards(BOARDS_DIR)) allRecords.push(...extractDoneRecords(b.board, b.file));
for (const b of boards.slice(0, 10)) {
  // 把所有任务当 active（最坏情况·全 backlog）：clone 并置 ready。
  const clone = { tasks: b.tasks.map((t) => ({ ...t, status: 'ready', started_at: undefined, finished_at: undefined })), scheduling: b.scheduling };
  const n = clone.tasks.length;
  const wip = b.scheduling?.wip_limit ?? 8;
  const p = paramsUnitCv(clone, 4, 0.6);
  const recs = allRecords;
  const backlog = n;
  const tPre = timeit(() => precedenceOnlyMc(clone, p, { seed: 42, runs: RUNS }));
  const tRc = timeit(() => rcpspInTrialMc(clone, p, { seed: 42, runs: RUNS, wip }));
  const tNa = n <= 300 ? timeit(() => rcpspInTrialMcNaive(clone, p, { seed: 42, runs: RUNS, wip }), 1) : NaN;
  const tTh = timeit(() => throughputMc(backlog, recs, { seed: 42, runs: RUNS }));
  const id = (b.goal || b.meta?.created_at || 'board').toString().slice(0, 16).replace(/\n/g, ' ');
  console.log(`| ${id} | ${n} | ${edgeCount(clone)} | ${wip} | ${tPre.toFixed(1)}ms | ${tRc.toFixed(1)}ms | ${Number.isFinite(tNa) ? tNa.toFixed(1) + 'ms' : 'skip'} | ${tTh.toFixed(2)}ms |`);
}

// ── B. 合成放大图（压力·N 到 2000）──
console.log('\n## B. 合成放大图（边密度 ~1.5/node·wip=8·mean=4h cv=0.6）');
console.log('| N tasks | edges | precedence | rcpsp(heap) | rcpsp(naive) | throughput |');
console.log('|---|---|---|---|---|---|');
for (const n of [50, 100, 200, 300, 500, 1000, 2000]) {
  const b = synthBoard(n, 7, 8);
  const p = paramsUnitCv(b, 4, 0.6);
  const tPre = timeit(() => precedenceOnlyMc(b, p, { seed: 42, runs: RUNS }));
  const tRc = timeit(() => rcpspInTrialMc(b, p, { seed: 42, runs: RUNS, wip: 8 }));
  const tNa = n <= 500 ? timeit(() => rcpspInTrialMcNaive(b, p, { seed: 42, runs: RUNS, wip: 8 }), 1) : NaN;
  const tTh = timeit(() => throughputMc(n, allRecords, { seed: 42, runs: RUNS }));
  console.log(`| ${n} | ${edgeCount(b)} | ${tPre.toFixed(1)}ms | ${tRc.toFixed(1)}ms | ${Number.isFinite(tNa) ? tNa.toFixed(0) + 'ms' : 'skip'} | ${tTh.toFixed(2)}ms |`);
}

// ── C. trials 降档曲线（固定大图 N=300·rcpsp heap·找 <budget 的 runs）──
console.log('\n## C. trials 降档曲线（N=300 合成图·rcpsp heap·wip=8）');
console.log('| runs | rcpsp(heap) ms | precedence ms |');
console.log('|---|---|---|');
{
  const b = synthBoard(300, 7, 8);
  const p = paramsUnitCv(b, 4, 0.6);
  for (const runs of [250, 500, 1000, 2000, 4000]) {
    const tRc = timeit(() => rcpspInTrialMc(b, p, { seed: 42, runs, wip: 8 }));
    const tPre = timeit(() => precedenceOnlyMc(b, p, { seed: 42, runs }));
    console.log(`| ${runs} | ${tRc.toFixed(1)} | ${tPre.toFixed(1)} |`);
  }
}

// ── D. 全 endpoint 估算（precedence + throughput + rcpsp 三通道一次·N=283 最大真实板）──
console.log('\n## D. 全 endpoint 三通道合计（最大真实板规模·N≈283·runs=2000）');
{
  const b = synthBoard(283, 7, 16);
  const p = paramsUnitCv(b, 4, 0.6);
  const tAll = timeit(() => {
    precedenceOnlyMc(b, p, { seed: 42, runs: RUNS });
    throughputMc(283, allRecords, { seed: 42, runs: RUNS });
    rcpspInTrialMc(b, p, { seed: 42, runs: RUNS, wip: 16 });
  });
  const tAC = timeit(() => {
    precedenceOnlyMc(b, p, { seed: 42, runs: RUNS });
    throughputMc(283, allRecords, { seed: 42, runs: RUNS });
  });
  console.log(`A(precedence)+C(throughput) 合计: ${tAC.toFixed(1)}ms`);
  console.log(`A+B(rcpsp)+C 三通道合计:        ${tAll.toFixed(1)}ms`);
  console.log(`hook 10s timeout headroom: ${(10000 / tAll).toFixed(0)}× (三通道) / ${(10000 / tAC).toFixed(0)}× (A+C)`);
}
