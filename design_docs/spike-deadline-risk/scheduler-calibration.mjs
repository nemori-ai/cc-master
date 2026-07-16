// scheduler-calibration.mjs — 校准诚实性 §(b)：合成图集验「调度器正确性」（**≠ 经验校准**）。
//
// codex 异构审查修正②：无真实 DDL+交付结果 labeled 语料 → 经验 Brier/reliability 不可行。本脚本在**受控
//   合成世界**（生成模型与 MC 假设同族：log-normal 时长 + RCPSP 资源模型）里验两件事：
//     (b1) **调度器机器正确性**——当估值无偏时，RCPSP-in-trial 出的 on_time_probability 是否 well-calibrated
//          （coverage/PIT：把 DDL 设成 model 的 p_q 分位·nominal=q·经验 coverage 应≈q）。
//     (b2) **估值偏差如何劣化校准**——估值有偏/带噪时 coverage 偏离多少（隔离「机器」与「估值质量」）。
//     (b3) **band 阈值的 false-negative ↔ alert-fatigue 权衡**——扫阈值给设计取舍数据。
//
// ⚠ 这**不是**经验校准：真实世界还叠加 wall-clock 失真（data-inventory 实测 median 4×）+ 真实估值偏差，
//   只有 labeled snapshot 语料能量化（见报告 §follow-up 采集方案）。此处只证「机器在其假设下自洽」。
//
// 跑：node design_docs/spike-deadline-risk/scheduler-calibration.mjs

import { Sfc32 } from './prng.mjs';
import { sampleTaskDuration } from './sampling.mjs';
import { rcpspInTrialMc } from './channels.mjs';

// ── 合成项目生成 ──
function genProject(seed) {
  const g = new Sfc32(seed);
  const n = 20 + g.nextInt(50); // 20-70 任务
  const wip = 2 + g.nextInt(6);  // 2-7
  const tasks = [];
  const trueMean = new Map();
  for (let i = 0; i < n; i++) {
    const deps = [];
    const k = i === 0 ? 0 : g.nextInt(3);
    const cand = []; for (let j = Math.max(0, i - 10); j < i; j++) cand.push(j);
    for (let d = 0; d < k && cand.length; d++) { const pick = g.nextInt(cand.length); deps.push(`T${cand[pick]}`); cand.splice(pick, 1); }
    tasks.push({ id: `T${i}`, status: 'ready', deps });
    trueMean.set(`T${i}`, 0.5 + g.next() * 12); // 真实均值 0.5-12.5h
  }
  return { board: { tasks, scheduling: { wip_limit: wip } }, trueMean, wip, n, g };
}

// 真实一次交付（actual makespan）：用真实均值 + 真实 cv 抽一次时长 → RCPSP with wip（确定性单实现）。
function actualMakespan(proj, cvTrue, seed) {
  const g = new Sfc32(seed);
  const durMap = new Map();
  for (const [id, m] of proj.trueMean) durMap.set(id, { meanHours: sampleTaskDuration(() => g.next(), m, cvTrue), cv: 0.00001 });
  const rc = rcpspInTrialMc(proj.board, durMap, { seed: 1, runs: 1, wip: proj.wip });
  return rc.makespan.p50;
}

// model params：估值 = 真实均值 × noise（bias/noise 可调）+ model cv。
function modelParams(proj, { biasMult = 1, estNoiseCv = 0, modelCv = 0.6 }, seed) {
  const g = new Sfc32(seed);
  const p = new Map();
  for (const [id, m] of proj.trueMean) {
    const est = estNoiseCv > 0 ? sampleTaskDuration(() => g.next(), m * biasMult, estNoiseCv) : m * biasMult;
    p.set(id, { meanHours: est > 0 ? est : 0.1, cv: modelCv });
  }
  return p;
}

const K = 500;        // 项目数
const MC_RUNS = 800;  // 每项目 MC trials
const CV_TRUE = 0.6;  // 真实时长离散度
const Q_GRID = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95];

// coverageTest(scenario) → { coverage[q], brier[q], brierAll }。
function coverageTest(scenario, label) {
  const cov = new Map(Q_GRID.map((q) => [q, { hit: 0, n: 0 }]));
  let brierSum = 0, brierN = 0;
  for (let k = 0; k < K; k++) {
    const proj = genProject(1000 + k);
    const mp = modelParams(proj, scenario, 7000 + k);
    // model 预测分布（RCPSP-in-trial MC）。
    const pred = rcpspInTrialMc(proj.board, mp, { seed: 42, runs: MC_RUNS, wip: proj.wip });
    if (!Number.isFinite(pred.makespan.p50)) continue;
    const sorted = pred.makespanSamplesSorted;
    const qAt = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
    // 真实交付（独立 seed·不给 model 看）。
    const actual = actualMakespan(proj, CV_TRUE, 30000 + k);
    for (const q of Q_GRID) {
      const ddl = qAt(q);           // DDL = model 的 p_q 分位 → nominal on-time = q
      const y = actual <= ddl ? 1 : 0;
      const c = cov.get(q); c.n++; c.hit += y;
      brierSum += (q - y) * (q - y); brierN++;
    }
  }
  const coverage = Q_GRID.map((q) => { const c = cov.get(q); return { q, emp: c.n ? c.hit / c.n : NaN, n: c.n }; });
  return { label, coverage, brier: brierN ? brierSum / brierN : NaN };
}

console.log(`# scheduler-calibration — 合成图集调度器正确性（K=${K} 项目·MC=${MC_RUNS}·cv_true=${CV_TRUE}）\n`);
console.log('⚠ 受控合成世界·验「机器在其假设下自洽」·**非**经验校准（真实世界叠加 wall-clock 失真 + 真实估值偏差）。\n');

console.log('## (b1)(b2) coverage/PIT：nominal 分位 q vs 经验 coverage（越贴近对角线越 well-calibrated）');
const scenarios = [
  ['oracle（估值=真实均值·隔离 MC 机器）', { biasMult: 1, estNoiseCv: 0, modelCv: CV_TRUE }],
  ['realistic-noise（估值带噪 cv=0.5·model cv=0.6）', { biasMult: 1, estNoiseCv: 0.5, modelCv: 0.6 }],
  ['biased-optimistic（估值系统性低估 ×0.7）', { biasMult: 0.7, estNoiseCv: 0.4, modelCv: 0.6 }],
];
const results = scenarios.map(([lab, sc]) => coverageTest(sc, lab));
// 表：行 = 场景·列 = q。
let header = '| 场景 | ' + Q_GRID.map((q) => `p${Math.round(q * 100)}`).join(' | ') + ' | Brier |';
let sep = '|---|' + Q_GRID.map(() => '---|').join('') + '---|';
console.log(header); console.log(sep);
for (const r of results) {
  const cells = r.coverage.map((c) => (Number.isFinite(c.emp) ? c.emp.toFixed(2) : 'n/a')).join(' | ');
  console.log(`| ${r.label} | ${cells} | ${r.brier.toFixed(3)} |`);
}
console.log('\n（理想：每列经验 coverage ≈ 列标 nominal。oracle 行贴对角线 = MC 机器正确；biased 行系统性偏低 = 低估估值把准时概率吹高·real-world 隐患）\n');

// ── (b3) band 阈值 false-negative ↔ alert-fatigue（realistic 场景·DDL 政策产生 pOnTime 谱）──
// 关键：DDL 须在项目间产生**多样**的 on-time 概率（否则阈值无从区分）。用 DDL = model_p50 × U（U∈[0.6,1.8]
//   uniform·模拟宽紧不一的真实承诺）→ pOnTime 铺满 [~0,~1]。actual late = actual > DDL。
// alert 规则：pOnTime < τ → 升级 at_risk+（警报）。FN=延期却没警报；alert-fatigue=健康却警报。
console.log('## (b3) band 阈值 false-negative ↔ alert-fatigue（realistic-noise·DDL=model_p50×U[0.6,1.8]）');
console.log('| 升级阈值τ (pOnTime<τ→at_risk+) | P(漏报延期) FN | P(健康被警报) alert-fatigue | 取舍 |');
console.log('|---|---|---|---|');
{
  const rows = [];
  const gU = new Sfc32(999);
  for (let k = 0; k < K; k++) {
    const proj = genProject(1000 + k);
    const mp = modelParams(proj, { biasMult: 1, estNoiseCv: 0.5, modelCv: 0.6 }, 7000 + k);
    const pred = rcpspInTrialMc(proj.board, mp, { seed: 42, runs: MC_RUNS, wip: proj.wip });
    if (!Number.isFinite(pred.makespan.p50)) continue;
    const sorted = pred.makespanSamplesSorted;
    const p50 = sorted[Math.floor(0.5 * (sorted.length - 1))];
    const U = 0.6 + gU.next() * 1.2; // [0.6, 1.8]
    const ddl = p50 * U;
    let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= ddl) lo = m + 1; else hi = m; }
    const pOnTime = lo / sorted.length;
    const actual = actualMakespan(proj, CV_TRUE, 30000 + k);
    rows.push({ pOnTime, late: actual > ddl });
  }
  const lateN = rows.filter((r) => r.late).length;
  const healthyN = rows.length - lateN;
  for (const tau of [0.95, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4]) {
    const fn = rows.filter((r) => r.late && r.pOnTime >= tau).length / (lateN || 1);
    const af = rows.filter((r) => !r.late && r.pOnTime < tau).length / (healthyN || 1);
    const label = tau >= 0.9 ? '很敏感·漏报少·误警多' : tau <= 0.5 ? '很钝·误警少·漏报多' : '中庸';
    console.log(`| ${tau} | ${(fn * 100).toFixed(0)}% | ${(af * 100).toFixed(0)}% | ${label} |`);
  }
  console.log(`\n（样本：延期 ${lateN} / 健康 ${healthyN}·DDL 宽紧混合 → pOnTime 铺满谱。τ = 升级 at_risk+ 的准时概率下限）`);
  console.log('结论：FN↓↔alert-fatigue↑ 的经典权衡。延期代价（临近才暴露不可交付）>> 一次多余 advisory 代价，且 v1 是');
  console.log('advisory 不 block → **保守起点偏敏感**：at_risk 门 0.6-0.7 一带（漏报可控·误警可接受）。真实定标待 labeled 语料。\n');
}
