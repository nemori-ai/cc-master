// demo.mjs — 端到端演示：真实 board + 合成 DDL → 完整 §4.3 输出（验全链路 + 给报告举例）。
//
// 跑：node design_docs/spike-deadline-risk/demo.mjs
// 用最大真实板做 as-of 回放：从 home 语料（leave-this-board-out·防泄漏）派生校准，设不同宽紧 DDL，
//   打印 computeDeadlineRisk 的完整 §4.3 verdict。演示 on_track / at_risk / overdue / unknown 四态。

import { loadAllBoards, extractDoneRecords, deriveCalibration, buildMcParamsSpike, backlogCountAsOf, corpusAsOf, isDoneAsOf } from './board-io.mjs';
import { computeDeadlineRisk } from './deadline-risk.mjs';
import * as os from 'node:os';
import * as path from 'node:path';

const BOARDS_DIR = path.join(os.homedir(), '.cc_master', 'boards');
const all = loadAllBoards(BOARDS_DIR);

// 选一块大真实板做 target；as-of 定在其任务约完成一半处。
const target = all.map((x) => x.board).filter((b) => Array.isArray(b.tasks) && b.tasks.length >= 60)
  .sort((a, b) => b.tasks.length - a.tasks.length)[0];
const targetFile = all.find((x) => x.board === target)?.file;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ts = (v) => (typeof v === 'string' && ISO.test(v) ? Date.parse(v) : null);
const fins = target.tasks.map((t) => ts(t.finished_at)).filter((x) => x != null).sort((a, b) => a - b);
const starts = target.tasks.map((t) => ts(t.started_at)).filter((x) => x != null).sort((a, b) => a - b);
const asOfMs = fins[Math.floor(fins.length * 0.5)]; // as-of = 完成一半时刻
const finalFinish = fins[fins.length - 1];

// home 语料（leave-this-board-out·防泄漏）+ as-of 截断。
let corpus = [];
for (const x of all) if (x.file !== targetFile) corpus.push(...extractDoneRecords(x.board, x.file));
corpus = corpusAsOf(corpus, asOfMs);
const calib = deriveCalibration(corpus);
const params = buildMcParamsSpike(target, calib, asOfMs);
const backlog = backlogCountAsOf(target, asOfMs);
const wip = target.scheduling?.wip_limit ?? 8;
const coveredActive = target.tasks.filter((t) => !isDoneAsOf(t, asOfMs));
const withEst = coveredActive.filter((t) => t.estimate && typeof t.estimate === 'object').length;
const coveragePct = coveredActive.length ? Math.round((withEst / coveredActive.length) * 100) : 100;

console.log(`# demo — 真实板 ${targetFile}`);
console.log(`tasks=${target.tasks.length} backlog(as-of)=${backlog} wip=${wip} coverage=${coveragePct}% history_n=${corpus.length}`);
console.log(`as-of=${new Date(asOfMs).toISOString()} 真实最终完成=${new Date(finalFinish).toISOString()}`);
console.log(`spike 校准: kappa=${calib.kappa.toFixed(2)} cv=${calib.cv.toFixed(2)} medianActual=${calib.medianActual.toFixed(1)}h\n`);

// 用 precedence p50 量级参照设宽紧 DDL（演示各 band）。
const remHoursGuess = Math.max(1, (finalFinish - asOfMs) / 3600000);
const scenarios = [
  ['宽松 DDL（真实完成 ×3·预期 on_track/watch）', asOfMs + remHoursGuess * 3 * 3600000, 'confirmed'],
  ['中等 DDL（真实完成 ×1·预期 watch/at_risk）', asOfMs + remHoursGuess * 1.0 * 3600000, 'confirmed'],
  ['紧 DDL（真实完成 ×0.3·预期 likely_late）', asOfMs + remHoursGuess * 0.3 * 3600000, 'confirmed'],
  ['已过期 DDL（as-of 前·预期 overdue）', asOfMs - 3600000, 'confirmed'],
  ['无 DDL（pending·预期 unknown 不假绿）', null, 'pending'],
];

for (const [label, ddlMs, state] of scenarios) {
  const r = computeDeadlineRisk(target, {
    deadlineAtMs: ddlMs, deadlineState: state, asOfMs, records: corpus, calibParams: params,
    backlog, wip, runs: 2000, seed: 42, effectiveN: 1, scope: 'home', historyN: corpus.length, coveragePct,
    statusMap: new Map(),
  });
  console.log(`## ${label}`);
  console.log(`  risk_band=${r.risk_band} strength=${r.strength} on_time_probability=${r.on_time_probability} (src=${r.on_time_probability_source})`);
  console.log(`  time_remaining_h=${r.time_remaining_hours} confidence=${r.confidence} calibration_status=${r.calibration_status}`);
  if (r.channels.precedence_only) console.log(`  precedence(乐观下界) P=${r.channels.precedence_only.on_time_probability} makespan p50/p80/p95=${r.channels.precedence_only.makespan_p50_h}/${r.channels.precedence_only.makespan_p80_h}/${r.channels.precedence_only.makespan_p95_h}h`);
  if (r.channels.resource_aware) console.log(`  rcpsp(verdict) P=${r.channels.resource_aware.on_time_probability} makespan p50/p80/p95=${r.channels.resource_aware.makespan_p50_h}/${r.channels.resource_aware.makespan_p80_h}/${r.channels.resource_aware.makespan_p95_h}h wip=${r.channels.resource_aware.wip}`);
  if (r.channels.throughput_reference) console.log(`  throughput(参考·非verdict) P_heur=${r.channels.throughput_reference.on_time_probability_heuristic} days p50/p80/p95=${r.channels.throughput_reference.days_p50}/${r.channels.throughput_reference.days_p80}/${r.channels.throughput_reference.days_p95}`);
  console.log(`  channel_disagreement=${r.channel_disagreement}`);
  if (r.top_drivers.length) console.log(`  top_drivers=${r.top_drivers.slice(0, 3).map((d) => `${d.id}(${d.reason})`).join(', ')}`);
  console.log(`  notes: ${r.notes.join(' | ')}`);
  console.log();
}

// 打印一份完整 JSON（中等场景）作 schema 举例。
const full = computeDeadlineRisk(target, {
  deadlineAtMs: asOfMs + remHoursGuess * 3600000, deadlineState: 'confirmed', asOfMs, records: corpus, calibParams: params,
  backlog, wip, runs: 2000, seed: 42, effectiveN: 1, scope: 'home', historyN: corpus.length, coveragePct, statusMap: new Map(),
});
console.log('## 完整 §4.3 JSON（中等 DDL 场景·schema 举例）');
console.log(JSON.stringify(full, null, 2));
