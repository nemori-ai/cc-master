// board-io.mjs — 只读 board 加载 + done 语料抽取 + spike 版校准（meanHours/cv 派生）。
//
// ⚠ spike 简化声明：真引擎的 buildMcParams 走多层收缩校准（calibrate/dispersionCv·repo+type+executor+tier
//   分层 EWMA + conformal）。本文件用**全局单层校准**（全局 ratio 中位数 κ + 全局 log-残差 cv）——足够做
//   通道对比与校准回测的相对结论，但 D3B 落 endpoint 时**必须换回引擎的 calibrate/dispersionCv**（此处不重写
//   那套多层收缩·spike 只验通道结构与 on-time 概率骨架）。simplification 在报告 §诚实局限 显式标注。
//
// extractDoneRecords / boardRepo 从 history-loader.ts 移植（口径一致）。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { estimateHours } from './graph.mjs';

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
function parseTs(v) {
  if (typeof v !== 'string' || !ISO_UTC_RE.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

export function boardRepo(board) {
  const git = (board && typeof board.git === 'object' ? board.git : {}) || {};
  if (typeof git.remote === 'string' && git.remote) return git.remote;
  if (typeof git.root === 'string' && git.root) return git.root;
  if (typeof git.worktree === 'string' && git.worktree) return git.worktree;
  return typeof board.goal === 'string' ? board.goal.slice(0, 24) : 'unknown';
}

// extractDoneRecords(board, boardFile) → 该板全部 done 任务的扁平记录（纯函数）。
export function extractDoneRecords(board, boardFile = '') {
  const b = board;
  if (!b || typeof b !== 'object' || !Array.isArray(b.tasks)) return [];
  const repo = boardRepo(b);
  const out = [];
  for (const t of b.tasks) {
    if (!t || typeof t !== 'object' || t.status !== 'done') continue;
    const est = estimateHours(t.estimate);
    const started = parseTs(t.started_at);
    const finished = parseTs(t.finished_at);
    const actual = started != null && finished != null && finished > started ? (finished - started) / 3600000 : null;
    const ratio = est != null && actual != null && est > 0 ? actual / est : null;
    out.push({
      boardFile, repo, taskId: typeof t.id === 'string' ? t.id : '',
      type: typeof t.type === 'string' ? t.type : '',
      estimateHours: est, actualHours: actual, ratio, finishedAtMs: finished,
    });
  }
  return out;
}

// loadAllBoards(boardsDir) → [{ file, board }]（只读·坏 JSON 跳过·绝不写）。
export function loadAllBoards(boardsDir) {
  let files = [];
  try { files = fs.readdirSync(boardsDir).filter((f) => f.endsWith('.board.json')); } catch { return []; }
  const out = [];
  for (const f of files) {
    try { out.push({ file: f, board: JSON.parse(fs.readFileSync(path.join(boardsDir, f), 'utf8')) }); } catch { /* skip */ }
  }
  return out;
}

function median(xs) {
  const a = xs.filter((x) => Number.isFinite(x)).slice().sort((p, q) => p - q);
  if (a.length === 0) return NaN;
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

// deriveCalibration(records) → { kappa, cv, medianActual, n }（全局单层·spike 版）。
//   kappa = median(actual/estimate)（系统性估值偏差修正）；cv 来自 log(actual/(est×kappa)) 残差散度。
export function deriveCalibration(records) {
  const ratios = records.map((r) => r.ratio).filter((x) => Number.isFinite(x) && x > 0);
  const actuals = records.map((r) => r.actualHours).filter((x) => Number.isFinite(x) && x > 0);
  const kappa = ratios.length >= 3 ? median(ratios) : 1;
  const medianActual = actuals.length ? median(actuals) : 1;
  // log-残差 cv：校准后 actual 相对 (est×kappa) 的对数残差标准差 → cv = sqrt(exp(s²)-1)。
  const logres = [];
  for (const r of records) {
    if (Number.isFinite(r.actualHours) && r.actualHours > 0 && Number.isFinite(r.estimateHours) && r.estimateHours > 0) {
      logres.push(Math.log(r.actualHours / (r.estimateHours * kappa)));
    }
  }
  let cv = 0.4;
  if (logres.length >= 4) {
    const m = logres.reduce((a, b) => a + b, 0) / logres.length;
    const s2 = logres.reduce((a, b) => a + (b - m) * (b - m), 0) / (logres.length - 1);
    cv = Math.sqrt(Math.max(0, Math.exp(s2) - 1));
    if (!Number.isFinite(cv) || cv <= 0) cv = 0.4;
    cv = Math.min(cv, 2.0); // 上限守（防极端长尾把 cv 拉爆）
  }
  return { kappa, cv, medianActual, n: records.length };
}

// buildMcParamsSpike(board, calib, nowMs) → Map<id,{meanHours,cv}>（as-of 截断·spike 单层校准）。
//   done-as-of → mean=0（不占工期）；未完成 → est×kappa 或 medianActual 兜底；cv 全局。
export function buildMcParamsSpike(board, calib, nowMs) {
  const params = new Map();
  const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
  for (const t of tasks) {
    const id = typeof t.id === 'string' ? t.id : '';
    if (!id) continue;
    if (isDoneAsOf(t, nowMs)) { params.set(id, { meanHours: 0, cv: calib.cv }); continue; }
    const raw = estimateHours(t.estimate);
    const mean = raw != null ? raw * calib.kappa : calib.medianActual;
    params.set(id, { meanHours: mean > 0 ? mean : 1, cv: calib.cv > 0 ? calib.cv : 0.4 });
  }
  return params;
}

// isDoneAsOf(task, nowMs) → as-of 时刻是否已完成（backtest 截断·从 estimate.ts 移植口径）。
export function isDoneAsOf(t, nowMs) {
  if (t.status !== 'done') return false;
  const f = typeof t.finished_at === 'string' ? Date.parse(t.finished_at) : NaN;
  if (!Number.isFinite(f)) return true;
  return f <= nowMs;
}

// backlogCountAsOf(board, nowMs) → 未完成任务数（throughput backlog·as-of 截断）。
export function backlogCountAsOf(board, nowMs) {
  const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
  return tasks.filter((t) => !isDoneAsOf(t, nowMs)).length;
}

// corpusAsOf(records, nowMs) → 丢 finishedAtMs > nowMs 的记录（backtest 不泄漏未来）。
export function corpusAsOf(records, nowMs) {
  return records.filter((r) => r.finishedAtMs == null || r.finishedAtMs <= nowMs);
}

export { median };
