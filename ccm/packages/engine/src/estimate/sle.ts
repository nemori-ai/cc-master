// sle.ts — Service Level Expectation + WIP-aging（Kanban Guide 2020·ADR-015 §2.4 / plan §3/§7）。
//
// SLE：从历史 cycle-time（任务起跑→完成耗时）的经验分位（P85/P95）得「一个任务多久内能完成」的服务
//   水平期望。比单点估值更诚实——是数据驱动的「通常 X% 的任务在 N 小时内完成」。
//
// WIP-aging：把在飞（in_flight）任务的 age（now − started）与 SLE 分位比对——
//   age > SLE_P85 → at_risk；age > SLE_P95 → critical（plan §3「WIP-aging 联动 SLE」）。
//   这是 flow 健康的早警：一个任务在系统里待太久（远超历史同类的 P85/P95）八成卡住了（接 plateau→restart）。
//
// 红线1：node/JS only，零 npm dep。确定性：纯分位 + 算术。

import type { TaskLike } from '../board-model.js';
import { ISO_UTC_RE } from '../board-model.js';
import type { DoneRecord } from '../usage/history-loader.js';
import { empiricalQuantile } from './conformal.js';

function parseTs(v: unknown): number | null {
  if (typeof v !== 'string' || !ISO_UTC_RE.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

export interface Sle {
  p50: number; // cycle-time 中位（小时）
  p85: number; // SLE 主分位（小时）
  p95: number; // SLE 上分位（小时·5% 硬墙口径）
  history_n: number;
  confidence: 'high' | 'medium' | 'low';
}

// cycleTimeSle(records) → 历史 cycle-time（actualHours）的 SLE 分位。无样本 → 全 NaN + low。
export function cycleTimeSle(records: DoneRecord[]): Sle {
  const cts = records.map((r) => r.actualHours).filter((x): x is number => x != null && x > 0);
  const arr = Float64Array.from(cts);
  arr.sort();
  const n = arr.length;
  const confidence: 'high' | 'medium' | 'low' = n >= 10 ? 'high' : n >= 4 ? 'medium' : 'low';
  return {
    p50: empiricalQuantile(arr, 0.5),
    p85: empiricalQuantile(arr, 0.85),
    p95: empiricalQuantile(arr, 0.95),
    history_n: n,
    confidence,
  };
}

export type AgingStatus = 'ok' | 'at_risk' | 'critical';
export interface AgingEntry {
  id: string;
  age_hours: number;
  status: AgingStatus;
  sle_p85: number;
  sle_p95: number;
}

// wipAging(board, sle, nowMs) → 在飞任务的 aging 评估（age vs SLE 分位）。
//   只看 status==='in_flight' 且有 started_at 的任务。SLE 分位为 NaN（无历史）→ 全 ok（无基准不报警·诚实）。
export function wipAging(board: { tasks?: unknown }, sle: Sle, nowMs: number): AgingEntry[] {
  const tasks: TaskLike[] = Array.isArray(board.tasks) ? (board.tasks as TaskLike[]) : [];
  const out: AgingEntry[] = [];
  const hasP85 = Number.isFinite(sle.p85);
  const hasP95 = Number.isFinite(sle.p95);
  for (const t of tasks) {
    if (t.status !== 'in_flight') continue;
    const s = parseTs(t.started_at);
    if (s == null) continue;
    const age = (nowMs - s) / 3600000;
    if (age <= 0) continue;
    let status: AgingStatus = 'ok';
    if (hasP95 && age > sle.p95) status = 'critical';
    else if (hasP85 && age > sle.p85) status = 'at_risk';
    out.push({
      id: typeof t.id === 'string' ? t.id : '',
      age_hours: Math.round(age * 100) / 100,
      status,
      sle_p85: hasP85 ? Math.round(sle.p85 * 100) / 100 : NaN,
      sle_p95: hasP95 ? Math.round(sle.p95 * 100) / 100 : NaN,
    });
  }
  // 最危的排前面。
  const rank = { critical: 0, at_risk: 1, ok: 2 };
  out.sort((a, b) => rank[a.status] - rank[b.status] || b.age_hours - a.age_hours);
  return out;
}
