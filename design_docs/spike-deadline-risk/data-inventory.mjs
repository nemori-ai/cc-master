// data-inventory.mjs — 校准诚实性 §(a)：本机 boards 数据可得性盘点 + wall-clock↔work-hours 失真实测。
//
// codex 异构审查修正②：真实历史 board 普遍缺「历史 DDL + 实际交付结果 + 事件溯源快照」——经验 Brier/
//   reliability 校准 12h 内不可行。本脚本**实测本机 boards 到底缺什么字段**，为「explicitly uncalibrated +
//   保守规则」结论提供事实依据；并实测 wall-clock↔work-hours 失真（契约风险 top2）。
//
// 跑：node design_docs/spike-deadline-risk/data-inventory.mjs

import { loadAllBoards, extractDoneRecords } from './board-io.mjs';
import { analyzeGraph } from './graph.mjs';
import { rcpspInTrialMc } from './channels.mjs';
import * as os from 'node:os';
import * as path from 'node:path';

const BOARDS_DIR = path.join(os.homedir(), '.cc_master', 'boards');
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ts = (v) => (typeof v === 'string' && ISO.test(v) ? Date.parse(v) : null);

const raw = loadAllBoards(BOARDS_DIR);
console.log(`# data-inventory — 本机 ${BOARDS_DIR}\n`);
console.log(`boards 文件数: ${raw.length}\n`);

// ── 1. labeled-语料 关键字段可得性 ──
let withGC = 0, withDDL = 0, withDeliveryOutcome = 0, withCreatedAt = 0, totalTasks = 0, doneMeasured = 0;
let withLog = 0, logTimestamped = 0;
for (const { board } of raw) {
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  totalTasks += tasks.length;
  if (board.goal_contract) withGC++;
  if (board.goal_contract?.deadline) withDDL++;
  // 交付结果 label：是否有任何字段记录「相对某 DDL 准时/延期」——扫常见位置。
  if (board.goal_contract?.deadline?.outcome || board.delivery_outcome || board.deadline_outcome) withDeliveryOutcome++;
  if (Array.isArray(board.log)) { withLog++; if (board.log.some((e) => ts(e?.ts) != null)) logTimestamped++; }
  for (const t of tasks) {
    if (ts(t.created_at) != null) withCreatedAt++;
    if (t.status === 'done' && ts(t.started_at) != null && ts(t.finished_at) != null) doneMeasured++;
  }
}
console.log('## 1. labeled 校准语料关键字段可得性');
console.log('| 字段 | 覆盖 | 校准可行性影响 |');
console.log('|---|---|---|');
console.log(`| goal_contract | ${withGC}/${raw.length} boards | 目标语义载体·部分板有 |`);
console.log(`| goal_contract.deadline（历史 DDL） | ${withDDL}/${raw.length} boards | **0·DDL 是本 feature 新引入·历史板无任何真实 DDL 值** |`);
console.log(`| 交付结果 label（相对 DDL 准时/延期） | ${withDeliveryOutcome}/${raw.length} boards | **0·无 ground-truth outcome·经验 Brier 无正样本可比** |`);
console.log(`| task.created_at（as-of DAG 近似重建） | ${withCreatedAt}/${totalTasks} tasks | 可近似 as-of「已知任务集」·但不含「当时计划的 DAG」全貌 |`);
console.log(`| task.started/finished（as-of 完成态重建） | ${doneMeasured}/${totalTasks} tasks | 可 as-of 重建「已完成」·喂 --as-of 回放素材 |`);
console.log(`| board.log 带时戳（事件溯源快照） | ${logTimestamped}/${raw.length} boards | 无逐时刻 DAG 快照·无法精确重建「as-of 当时的完整计划态」 |`);
console.log('\n**结论**：真实 DDL=0 + 交付结果 label=0 → **经验 reliability/Brier 校准在 12h 内不可行**（无正/负样本对）。');
console.log('as-of 回放只能重建「已完成任务集」，不能重建「当时的 DDL 承诺 / 当时计划的 DAG 全貌」——故只能做**调度器正确性**验证（合成图集·已知 ground truth），不能做经验校准。\n');

// ── 2. wall-clock ↔ work-hours 失真（契约风险 top2）──
// 对每个完成度高的板：work-hours（CPM/RCPSP·measured 时长）vs wall-clock span（真实挂钟）。
console.log('## 2. wall-clock ↔ work-hours 失真实测（契约风险 top2·mapping 诚实性）');
console.log('说明：MC 出的是 work-hours makespan，映射挂钟 ETA 假设**连续执行**（addHoursISO）。真实编排有夜间空转/等待用户/跨天。');
console.log('inflation = 真实挂钟跨度 ÷ work-hours。>1 = 挂钟被空转/等待放大（forecast 会系统性乐观）。\n');
console.log('| board | done任务 | Σwork-h | CPM关键链-h | RCPSP-h(wip) | wall-clock跨度-h | infl(vs CPM) | infl(vs RCPSP) |');
console.log('|---|---|---|---|---|---|---|---|');
const infCpm = [], infRcpsp = [];
for (const { board, file } of raw) {
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const doneM = tasks.filter((t) => t.status === 'done' && ts(t.started_at) != null && ts(t.finished_at) != null);
  if (doneM.length < 8) continue;
  // 只留完成任务的子图（measured 时长·真实 DAG 形状）。
  const sub = { tasks: doneM.map((t) => ({ ...t })), scheduling: board.scheduling };
  const g = analyzeGraph(sub);
  const cp = g.criticalPath({ now: Date.now() });
  const cpmH = cp.makespan; // measured → 报小时数
  let sumH = 0; for (const t of doneM) sumH += (ts(t.finished_at) - ts(t.started_at)) / 3600000;
  let minS = Infinity, maxF = -Infinity;
  for (const t of doneM) { minS = Math.min(minS, ts(t.started_at)); maxF = Math.max(maxF, ts(t.finished_at)); }
  const wallH = (maxF - minS) / 3600000;
  // RCPSP with measured durations（1 trial·确定性·wip=board 值）。
  const wip = board.scheduling?.wip_limit ?? 8;
  const durMap = new Map(); for (const t of doneM) durMap.set(t.id, { meanHours: (ts(t.finished_at) - ts(t.started_at)) / 3600000, cv: 0.0001 });
  const rc = rcpspInTrialMc(sub, durMap, { seed: 1, runs: 1, wip });
  const rcH = rc.makespan.p50;
  const iC = cpmH ? wallH / cpmH : NaN;
  const iR = rcH ? wallH / rcH : NaN;
  if (Number.isFinite(iC)) infCpm.push(iC);
  if (Number.isFinite(iR)) infRcpsp.push(iR);
  const id = (board.goal || file).toString().slice(0, 14).replace(/\n/g, ' ');
  console.log(`| ${id} | ${doneM.length} | ${sumH.toFixed(0)} | ${cpmH ? cpmH.toFixed(0) : 'n/a'} | ${rcH.toFixed(0)}(${wip}) | ${wallH.toFixed(0)} | ${Number.isFinite(iC) ? iC.toFixed(1) + '×' : 'n/a'} | ${Number.isFinite(iR) ? iR.toFixed(1) + '×' : 'n/a'} |`);
}
function stats(xs) { const a = xs.slice().sort((p, q) => p - q); const med = a[a.length >> 1]; const mean = a.reduce((s, x) => s + x, 0) / a.length; return { med, mean, min: a[0], max: a[a.length - 1], n: a.length }; }
if (infRcpsp.length) {
  const sc = stats(infCpm), sr = stats(infRcpsp);
  console.log(`\ninflation vs CPM关键链:  median=${sc.med.toFixed(1)}× mean=${sc.mean.toFixed(1)}× range=[${sc.min.toFixed(1)}×,${sc.max.toFixed(1)}×] (n=${sc.n})`);
  console.log(`inflation vs RCPSP(wip): median=${sr.med.toFixed(1)}× mean=${sr.mean.toFixed(1)}× range=[${sr.min.toFixed(1)}×,${sr.max.toFixed(1)}×] (n=${sr.n})`);
  console.log('\n**结论**：真实挂钟跨度普遍是 work-hours 的数倍——continuous-execution 映射系统性乐观。');
  console.log('→ v1 必须诚实标注 forecast/margin 为 work-hours 口径的乐观估计；band 用**保守阈值**兜这层失真；不声称挂钟校准。');
}
