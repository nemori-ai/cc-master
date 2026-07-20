// handlers/estimate.ts — estimate noun handler（show / forecast / evm / velocity / risk·ADR-015 §2·plan §5/§7）。
//
// estimate = 工作侧只读 advisory namespace（charter ④分解/规划 + ⑥按时长选档·消费 usage 融合）。消费
//   `@ccm/engine` 的 OR/ML 算法层（**只 import 不重写算法**·plan §2 不变式 3）：
//   · show      → runRead：estimate 字段 + EWMA 校准覆写 + conformal 区间（快速瞥）。
//   · forecast  → runRead：双通道 MC（估算-DAG ① + 吞吐 ②）→ P50/P80/P95 ETA + makespan + CI/CRI/SSI + consistency。
//   · evm       → runRead：EVM + Earned Schedule（消费 board.baseline·无 baseline 降级 warn）。
//   · velocity  → runRead：历史吞吐 + SLE（cycle-time P85/P95）。
//   · risk      → runRead：CI/CRI/SSI + WIP-aging SLE + CCPM buffer_health。
//
// 硬不变式（plan §2 不变式 1）：**estimate 纯只读** = compute，零写、不抢 board-lock、不落状态。全 runRead。
//
// 5% 硬墙（plan §2 行 26）：所有预测 p95 = 95% 分位，**绝不算到 100%**——这由引擎 conformal/MC 的分位
//   口径保证（p95 永远是 0.95 分位·见 conformal.ts/mc-scheduler.ts），handler 只透传不取 max/不补 1.0。
//
// 诚实降级（plan §2 行 26）：冷启动 / 数据不足 → 退原估值 + 标 low-confidence / no-history；
//   source 枚举 account / local-derived-approx / registry-snapshot / observability。历史语料范围由
//   --scope home|this-repo|this-board 控制（默认 home·跨板多层收缩）。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib。
// 红线3：estimate 出数据/区间，**不替 orchestrator 决策**（真动作归 SKILL A·plan §2 不变式 2）。
// 武装闸豁免：纯 handler 模块（无 hook 入口）。
// home 解析收口到 discover.resolveHome（SSOT）后，本文件不再直接用 os/path（故已撤其 import）。

import {
  type Baseline,
  boardRepo,
  calibrate,
  calibratedEstimate,
  computeDeadlineRisk,
  computeEvm,
  conformalInterval,
  cycleTimeSle,
  type DeadlineRiskResult,
  type DoneRecord,
  dispersionCv,
  dualChannelConsistency,
  estimateDagMonteCarlo,
  estimateHours,
  extractDoneRecords,
  feverStatus,
  knnPredict,
  loadCorpus,
  type NodeMcParam,
  pctCostToCompleteMonteCarlo,
  type QueryCase,
  readDeadline,
  sizeProjectBuffer,
  throughputMonteCarlo,
  tokenWeightedShares,
  WINDOW_5H_SEC,
  wipAging,
} from '@ccm/engine';
import * as discover from '../discover.js';
import { type BoardArg, type Ctx, runRead } from './_common.js';
import { accountBurnRate } from './usage.js';

// resolveHomeDir(env, homeFlag) → cc-master home **根**（统一全局口径·收口到 discover.resolveHome SSOT：
//   --home > $CC_MASTER_HOME > $HOME/.cc_master；不再 per-repo CLAUDE_PROJECT_DIR）。跨板只读语料用。
function resolveHomeDir(env: Record<string, string | undefined>, homeFlag?: string): string {
  return discover.resolveHome({ homeFlag, env });
}

// corpusAsOf(records, nowMs) → backtest 截断历史语料：丢掉 finishedAtMs > nowMs 的记录（round5 sweep #1）。
//   校准 / conformal / SLE 的历史先验**不能看见 as-of 之后才完成的记录**（否则 backtest 泄漏未来·
//   `--as-of <过去>` 时算出的校准乘子用到了它本不该知道的数据）。无 finishedAtMs 锚的记录保守保留
//   （无法证明它在 as-of 之后·同 isDoneAsOf「无锚→保守」哲学；velocity 的 --window 另有更严的丢锚口径）。
//   as-of=now（默认）时所有真实记录 finishedAtMs ≤ now → 不丢任何 → 行为不变。
function corpusAsOf(records: DoneRecord[], nowMs: number): DoneRecord[] {
  return records.filter((r) => r.finishedAtMs == null || r.finishedAtMs <= nowMs);
}

// loadScopedCorpus(board, ctx, nowMs) → 按 --scope 取历史语料（plan §4/行 69）+ as-of backtest 截断。
//   home（默认·全 home 跨板）/ this-repo（同 repo 过滤）/ this-board（仅当前板 done）。
//   home 不存在 / 冷启动 → 空数组（下游降级 no-history）。所有 scope 的语料都过 corpusAsOf（backtest 一致）。
//   ★as-of 锚定（round7 #P2·round5 sweep #1 的 sibling）：loadCorpus 的 recency cutoff（loadHomeBoards 默认 90 天·
//   `DEFAULT_MAX_DAYS_AGO`）必须锚到 **nowMs（= as-of 时刻）** 而非引擎内部的 `Date.now()`——否则 `--as-of <过去>`
//   时一块「板时戳距今天 >90 天、但在 as-of 当时仍在 recency 窗口内」的旧板会被 loadHomeBoards 提前丢弃（corpusAsOf
//   还没来得及按 as-of 相对过滤就已经没了它）→ backtest 用了空的/有偏的语料。传 { nowMs } 让 board 级 recency 与
//   record 级 corpusAsOf 同锚到 as-of；as-of=now（默认）时 nowMs≈Date.now() → 行为不变（无 --as-of 正常路径不动）。
//   注：show/forecast/velocity/risk 四个 verb 都走本函数取语料（evm 不读语料），故此处单点修复对它们一致生效（穷尽 sweep）。
function loadScopedCorpus(
  board: BoardArg,
  ctx: Ctx,
  nowMs: number,
): { records: DoneRecord[]; scope: string } {
  const scope = (ctx.values.scope as string) || 'home';
  const homeDir = resolveHomeDir(ctx.env, ctx.values.home as string);

  if (scope === 'this-board') {
    // 仅当前板 done——extractDoneRecords 同口径（纯函数·零 fs·直接喂当前 board 对象）。
    return { records: corpusAsOf(extractDoneRecords(board), nowMs), scope };
  }

  let records: DoneRecord[] = [];
  try {
    // board 集中在 <home>/boards/——跨板语料从那里读（loadCorpus 是 layout-agnostic·读给定目录）。
    records = loadCorpus(discover.boardsDir(homeDir), { nowMs });
  } catch {
    records = [];
  }
  if (scope === 'this-repo') {
    const repo = boardRepo(board);
    records = records.filter((r) => r.repo === repo);
  }
  return { records: corpusAsOf(records, nowMs), scope };
}

// windowFilter(records, windowDays, nowMs) → 按 --window <n> 天滑窗过滤 done 语料（codex round-3 #bug2）。
//   只留完成时刻落在 [nowMs - n*86400000, nowMs] 内的 done 记录（按 finishedAtMs·缺锚的丢弃·无法判定窗口归属）。
//   windowDays 缺省（undefined）→ 不过滤（沿用现状·spec「无 window 不过滤」）。≤0 / 非数 → 不过滤（保守）。
function windowFilter(
  records: DoneRecord[],
  windowDays: number | null,
  nowMs: number,
): DoneRecord[] {
  if (windowDays == null || !Number.isFinite(windowDays) || windowDays <= 0) return records;
  const cutoff = nowMs - windowDays * 86400000;
  return records.filter(
    (r) => r.finishedAtMs != null && r.finishedAtMs >= cutoff && r.finishedAtMs <= nowMs,
  );
}

// windowDaysFlag(ctx) → --window <n> 显式天数或 null（缺省·不过滤）。intFlag 走整数解析。
function windowDaysFlag(ctx: Ctx): number | null {
  const v = ctx.values.window;
  if (v == null || (typeof v === 'string' && v === '')) return null; // 未传 → 不过滤
  return intFlag(v, Number.NaN);
}

// nowMsOf(ctx) → --as-of（ISO）解析为 ms 或 Date.now()（backtest 用·plan §12.2）。
function nowMsOf(ctx: Ctx): number {
  const asOf = ctx.values['as-of'];
  if (typeof asOf === 'string' && asOf) {
    const ms = Date.parse(asOf);
    if (Number.isFinite(ms)) return ms;
  }
  return Date.now();
}

// asOfISO(ms) → 严格 ISO-8601 UTC（去毫秒）。
function asOfISO(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// isDoneAsOf(task, nowMs) → 该任务在 as-of 时刻是否「已完成」（backtest 截断·与 EVM EV/AC〔bug2〕、
//   velocity windowFilter 同口径·round5 sweep #1）。status==='done' **且**（finished_at 缺失 → 保守计为已完成、
//   保原降级语义；或 finished_at ≤ nowMs）。一个「现在 done 但 finished_at > as-of」的任务在 as-of 当时
//   其实尚未完成——backtest 里它仍应被当作 backlog（占工期、不计 coverage 的 done 分母）。
//   as-of=now（默认）时所有 done 任务 finished_at ≤ now → 退化为「status==='done'」，行为不变。
function isDoneAsOf(t: Record<string, unknown>, nowMs: number): boolean {
  if (t.status !== 'done') return false;
  const f = typeof t.finished_at === 'string' ? Date.parse(t.finished_at) : Number.NaN;
  if (!Number.isFinite(f)) return true; // 无 finished_at 锚 → 保守计为已完成（保原降级语义）
  return f <= nowMs;
}

// nonDoneTasks(board, nowMs) → 未完成任务数（forecast/risk 的 backlog·throughput 通道用·as-of 截断）。
function backlogCount(board: BoardArg, nowMs: number): number {
  const tasks = Array.isArray(board?.tasks) ? (board.tasks as Array<Record<string, unknown>>) : [];
  return tasks.filter((t) => !isDoneAsOf(t, nowMs)).length;
}

// coveragePct(board, nowMs) → 未完成任务里有 estimate 字段的占比（plan「coverage<50% ②主导」·as-of 截断）。
function estimateCoverage(board: BoardArg, nowMs: number): number {
  const tasks = Array.isArray(board?.tasks) ? (board.tasks as Array<Record<string, unknown>>) : [];
  const active = tasks.filter((t) => !isDoneAsOf(t, nowMs));
  if (active.length === 0) return 100;
  const withEst = active.filter((t) => estimateHours(t.estimate as never) != null).length;
  return Math.round((withEst / active.length) * 100);
}

// buildMcParams(board, records, nowMs) → 每节点 {meanHours, cv}（校准估值 + 离散度·喂 estimateDagMonteCarlo）。
//   流程（per task）：raw estimate → calibrate（同 repo+type+executor+tier 多层收缩）× → calibratedEstimate；
//     缺估值 → 兜底 mean=1（unit 降级·MC 入口 defaultMeanHours 也兜）；cv 来自 dispersionCv。
function buildMcParams(
  board: BoardArg,
  records: DoneRecord[],
  nowMs: number,
): Map<string, NodeMcParam> {
  const params = new Map<string, NodeMcParam>();
  const tasks = Array.isArray(board?.tasks) ? (board.tasks as Array<Record<string, unknown>>) : [];
  const repo = boardRepo(board);
  for (const t of tasks) {
    const id = typeof t.id === 'string' ? t.id : '';
    if (!id) continue;
    // as-of 时刻已完成的任务对 forecast 不占工期（mean=0）。backtest 截断（round5 sweep #1）：
    //   用 isDoneAsOf（finished_at ≤ nowMs）而非裸 status==='done'——否则 --as-of <过去> 时一个
    //   done-after-as-of 的任务被错当 mean=0（虚报已完成、缩短 makespan），与 EVM/velocity 口径分裂。
    if (isDoneAsOf(t, nowMs)) {
      params.set(id, { meanHours: 0, cv: 0.4 });
      continue;
    }
    const query = {
      repo,
      type: typeof t.type === 'string' ? t.type : '',
      executor: typeof t.executor === 'string' ? t.executor : '',
      tier: typeof t.tier === 'string' ? t.tier : '',
    };
    const rawHours = estimateHours(t.estimate as never);
    const cal = calibrate(records, query, { nowMs });
    const calibrated = calibratedEstimate(rawHours, cal);
    const cv = dispersionCv(records, query, { nowMs });
    params.set(id, { meanHours: calibrated ?? 1, cv: cv > 0 ? cv : 0.4 });
  }
  return params;
}

// ── estimate show ──────────────────────────────────────────────────────────────
//   单/全任务：estimate 字段 + EWMA 校准覆写 + conformal 区间（快速瞥）。
export function show(ctx: Ctx): number {
  return runRead(ctx, {
    render: (board, c) => {
      const b = board as BoardArg;
      const nowMs = nowMsOf(c);
      const { records, scope } = loadScopedCorpus(b, c, nowMs);
      const repo = boardRepo(b);
      const taskId = c.positionals[0];
      const tasks = Array.isArray(b?.tasks) ? (b.tasks as Array<Record<string, unknown>>) : [];
      // target 选择（无 task id 时）：用 isDoneAsOf 而非裸 status !== 'done'（round6 bug2·backtest 一致）——
      //   否则 --as-of <过去> 时一个「现在 done 但 finished_at > as-of」的任务（as-of 当时本是 backlog）被错隐藏、
      //   show 返回空/欠计 target，与 forecast/EVM/velocity 的 isDoneAsOf 口径分裂。as-of=now → 退化为 status!=='done'。
      const targets = taskId
        ? tasks.filter((t) => t.id === taskId)
        : tasks.filter((t) => !isDoneAsOf(t, nowMs));

      const rows = targets.map((t) => {
        const id = typeof t.id === 'string' ? t.id : '';
        const query = {
          repo,
          type: typeof t.type === 'string' ? t.type : '',
          executor: typeof t.executor === 'string' ? t.executor : '',
          tier: typeof t.tier === 'string' ? t.tier : '',
        };
        const rawHours = estimateHours(t.estimate as never);
        const cal = calibrate(records, query, { nowMs });
        const calibrated = calibratedEstimate(rawHours, cal);
        // conformal 区间喂 **rawHours**，不喂 calibrated（#bug-A·避免乐观因子被乘两次）：
        //   conformal 残差是历史 actual/raw_estimate 比率（≈乐观因子·见 conformal.ts relativeResiduals），
        //   对入参乘该比率分位得区间。raw×ratio_p50 = 已校准区间（p50 自然 ≈ calibrated point·乐观因子作用一次）；
        //   喂 calibrated 会把乐观因子乘第二次（raw×mult×ratio·区间整体偏高）。点估值仍报 calibrated（point）。
        //   守卫用 rawHours != null（与原 `point != null` 等价：rawHours 缺 → calibrated/point 必为 null·无估值→无区间）。
        const conf =
          rawHours != null
            ? conformalInterval(rawHours, records, {
                group: { type: query.type, executor: query.executor },
              })
            : null;
        return {
          id,
          raw_estimate_h: rawHours,
          calibration: {
            multiplier: round3(cal.multiplier),
            source: cal.source,
            level: cal.level,
            history_n: cal.history_n,
          },
          calibrated_h: calibrated != null ? round2(calibrated) : null,
          interval: conf
            ? { p50: round2(conf.p50), p80: round2(conf.p80), p95: round2(conf.p95) }
            : null,
          confidence: conf ? conf.confidence : 'low',
          coverage_basis: conf ? conf.coverage_basis : 'no-history',
          source: rawHours != null ? (cal.history_n > 0 ? 'calibrated' : 'estimate') : 'no-history',
        };
      });

      const data = { scope, as_of: asOfISO(nowMs), history_n: records.length, tasks: rows };
      if (c.flags.json) return JSON.stringify({ ok: true, data });
      if (rows.length === 0) return `estimate show: 无目标任务（scope=${scope}）\n`;
      const lines = [`estimate show（scope=${scope}·history_n=${records.length}）`];
      for (const r of rows) {
        const iv = r.interval
          ? `[p50=${r.interval.p50} p80=${r.interval.p80} p95=${r.interval.p95}]h`
          : '(无估值→no-history)';
        lines.push(
          `  ${r.id}: raw=${fmtH(r.raw_estimate_h)} ×${r.calibration.multiplier}(${r.calibration.source})=${fmtH(r.calibrated_h)} ${iv}·conf=${r.confidence}`,
        );
      }
      return `${lines.join('\n')}\n`;
    },
  });
}

// ── estimate forecast ──────────────────────────────────────────────────────────────
//   双通道 MC：估算-DAG-MC ①（依赖结构·log-normal·校准估值）+ 吞吐-MC ②（#NoEstimates·不依赖估值）
//   → P50/P80/P95 ETA + makespan + CI/CRI/SSI；①②偏差>20% 出 consistency warning。
//   --mode estimate|throughput|both（默认 both·coverage<50% ②主导）·--runs·--seed·--as-of·--effective-n。
export function forecast(ctx: Ctx): number {
  return runRead(ctx, {
    render: (board, c) => {
      const b = board as BoardArg;
      const nowMs = nowMsOf(c);
      const { records, scope } = loadScopedCorpus(b, c, nowMs);
      const mode = (c.values.mode as string) || 'both';
      const runs = intFlag(c.values.runs, 2000);
      const seed = intFlag(c.values.seed, 42);
      // --effective-n：号池有效配额份数（默认 1·floor 1·仿 usage advise 读法·#bug3）。
      const effectiveN = effectiveNFlag(c.values['effective-n']);
      const coverage = estimateCoverage(b, nowMs);
      const backlog = backlogCount(b, nowMs);

      const notes: string[] = [];
      const params = buildMcParams(b, records, nowMs);
      // unit-fallback note：缺估值的活动任务数。
      const missingEst = [...params.entries()].filter(([, p]) => p.meanHours === 1).length;
      if (missingEst > 0)
        notes.push(`${missingEst} tasks unit-time fallback（缺估值或校准退 1.0·plan 行 26）`);
      if (coverage < 50)
        notes.push(`estimate coverage ${coverage}%<50%——吞吐通道②主导（#NoEstimates）`);

      const runEstimate = mode === 'estimate' || mode === 'both';
      const runThroughput = mode === 'throughput' || mode === 'both';

      const est = runEstimate ? estimateDagMonteCarlo(b, params, { seed, runs, nowMs }) : null;
      const thrRaw = runThroughput
        ? throughputMonteCarlo(backlog, records, { seed, runs, nowMs })
        : null;
      // --effective-n threading（#bug3）：N 份可序列消费配额 → N 路并行清 backlog → 吞吐通道天数 ≈ days/N。
      //   只缩吞吐通道②（资源型加速·effectiveN 是配额并行度）；估算-DAG 通道① 是临界路径 makespan（已假设无界
      //   并行·forward-pass 无资源闸），N 不缩它（critical-path bound·改它需动引擎签名·本次不碰·诚实标 note）。
      const thr =
        thrRaw && effectiveN > 1
          ? {
              ...thrRaw,
              days: {
                p50: thrRaw.days.p50 / effectiveN,
                p80: thrRaw.days.p80 / effectiveN,
                p95: thrRaw.days.p95 / effectiveN,
              },
              mean: thrRaw.mean / effectiveN,
            }
          : thrRaw;
      if (effectiveN > 1 && thr != null && Number.isFinite(thr.days.p50))
        notes.push(
          `effective_n=${effectiveN}——吞吐通道②天数按 ${effectiveN} 路并行配额缩放（÷${effectiveN}）；估算-DAG 通道①为临界路径 makespan、不受 N 缩短`,
        );

      const consistency =
        est && thr && Number.isFinite(est.makespan.p50) && Number.isFinite(thr.days.p50)
          ? dualChannelConsistency(est, thr)
          : null;
      if (consistency?.warning) notes.push(consistency.note);

      // 主 makespan/forecast：用吞吐天数折算的条件——① 显式 --mode throughput（用户点名只走吞吐通道·
      //   est 必为 null），或 ② coverage<50% 吞吐主导（#NoEstimates）。两情形都须 thr 有限。
      //   修（round5 bug1）：原 `coverage < 50 && ...` 漏了 `mode === 'throughput'`——当 --mode throughput
      //   且 coverage≥50% 时 est=null（mode 不算 DAG 通道）但 useThroughputPrimary=false（coverage≥50）→
      //   forecastEta 落 `if (est...)` 分支(est 为 null)→ 返 forecast:null（显式 throughput 模式对正常估值板失效）。
      const useThroughputPrimary =
        (mode === 'throughput' || coverage < 50) && thr != null && Number.isFinite(thr.days.p50);
      const forecastEta = (() => {
        if (useThroughputPrimary && thr) {
          return {
            p50: addDaysISO(nowMs, thr.days.p50),
            p80: addDaysISO(nowMs, thr.days.p80),
            p95: addDaysISO(nowMs, thr.days.p95),
          };
        }
        if (est && Number.isFinite(est.makespan.p50)) {
          return {
            p50: addHoursISO(nowMs, est.makespan.p50),
            p80: addHoursISO(nowMs, est.makespan.p80),
            p95: addHoursISO(nowMs, est.makespan.p95), // 5% 硬墙（引擎口径·绝不 100%）
          };
        }
        return null;
      })();

      const confidence: 'high' | 'medium' | 'low' =
        records.length >= 10 ? 'medium' : records.length > 0 ? 'low' : 'low';

      // DDL margin/risk 摘要（issue #149·D6）：板有 asserted/confirmed DDL 时附相对 DDL 的 margin + risk band
      //   （复用 deadline-risk 单一 SSOT·不重算·红线3）。无 DDL → null（诚实 n/a·不假绿·不为无 DDL 板白跑 MC）。
      const ddlRisk = deadlineRiskSummary(b, c);

      const data = {
        forecast: forecastEta,
        makespan: est
          ? {
              p50: { value: round2(est.makespan.p50), unit: 'h' },
              p80: { value: round2(est.makespan.p80), unit: 'h' },
              p95: { value: round2(est.makespan.p95), unit: 'h' },
            }
          : null,
        throughput_days: thr
          ? { p50: round2(thr.days.p50), p80: round2(thr.days.p80), p95: round2(thr.days.p95) }
          : null,
        criticality_index: est ? est.criticality_index.slice(0, 10).map(roundSens) : [],
        schedule_sensitivity: est
          ? est.criticality_index
              .slice()
              .sort((a, b) => b.sensitivity - a.sensitivity)
              .slice(0, 10)
              .map((s) => ({ id: s.id, sensitivity: round3(s.sensitivity) }))
          : [],
        consistency: consistency
          ? { deviation: round3(consistency.deviation), warning: consistency.warning }
          : null,
        mode,
        coverage_pct: coverage,
        confidence,
        history_n: records.length,
        scope,
        runs,
        seed,
        effective_n: effectiveN,
        as_of: asOfISO(nowMs),
        source: records.length > 0 ? 'calibrated' : 'estimate',
        // deadline_risk：相对交付 DDL 的 margin/风险摘要（null = 无已确认/断言 DDL·issue #149·D6）。
        deadline_risk: ddlRisk,
        notes,
      };

      if (c.flags.json) return JSON.stringify({ ok: true, data });
      const lines = [
        `estimate forecast（mode=${mode}·scope=${scope}·runs=${runs}·seed=${seed}·coverage=${coverage}%）`,
      ];
      if (data.forecast)
        lines.push(
          `  ETA: p50=${data.forecast.p50} p80=${data.forecast.p80} p95=${data.forecast.p95}（5% 硬墙）`,
        );
      else lines.push('  ETA: 无法预测（冷启动 / 含环 / 无估值且无吞吐历史）');
      if (data.makespan)
        lines.push(
          `  makespan: p50=${data.makespan.p50.value}h p80=${data.makespan.p80.value}h p95=${data.makespan.p95.value}h`,
        );
      if (data.throughput_days)
        lines.push(
          `  throughput days: p50=${data.throughput_days.p50} p80=${data.throughput_days.p80} p95=${data.throughput_days.p95}`,
        );
      if (data.criticality_index.length)
        lines.push(
          `  top criticality: ${data.criticality_index
            .slice(0, 3)
            .map((s) => `${s.id}=${s.criticality}`)
            .join(', ')}`,
        );
      if (data.consistency?.warning)
        lines.push(`  ⚠ consistency: deviation=${data.consistency.deviation}`);
      if (ddlRisk) {
        const m = ddlRisk.margin as { p50_h: number; p80_h: number; p95_h: number } | null;
        lines.push(
          `  DDL: ${ddlRisk.deadline}（${ddlRisk.deadline_state}）·remaining=${ddlRisk.time_remaining_hours != null ? `${ddlRisk.time_remaining_hours}h` : 'N/A'}·risk=${ddlRisk.risk_band}(${ddlRisk.strength})·P(on-time)=${ddlRisk.on_time_probability ?? 'unknown'}`,
        );
        if (m)
          lines.push(
            `  DDL margin: p50=${fmtMargin(m.p50_h)} p80=${fmtMargin(m.p80_h)} p95=${fmtMargin(m.p95_h)}（负=越过 DDL·基准 ${(ddlRisk.margin as { basis?: string })?.basis ?? 'n/a'}）`,
          );
      }
      for (const n of notes) lines.push(`  note: ${n}`);
      return `${lines.join('\n')}\n`;
    },
  });
}

// ── estimate evm ──────────────────────────────────────────────────────────────
//   EVM + Earned Schedule（消费 board.baseline·无 baseline 降级 warn）。--as-of·--ac-source duration|token。
export function evm(ctx: Ctx): number {
  return runRead(ctx, {
    render: (board, c) => {
      const b = board as BoardArg;
      const nowMs = nowMsOf(c);
      const acSource = (c.values['ac-source'] as 'duration' | 'token') || 'duration';
      const baseline = (b && typeof b === 'object' ? b.baseline : null) as Baseline | null;
      const result = computeEvm(b, baseline, { asOfMs: nowMs, acSource });

      if (c.flags.json) return JSON.stringify({ ok: true, data: result });
      if (!result.has_baseline) {
        return `estimate evm: ${result.warnings.join('; ') || '无 baseline——先 ccm baseline snapshot'}\n`;
      }
      const lines = [
        `estimate evm（as_of=${result.as_of}·ac_source=${result.ac.source}·confidence=${result.confidence}）`,
        `  PV=${result.pv.value}h EV=${result.ev.value}h AC=${result.ac.value}${result.ac.unit}(cov ${result.ac.coverage_pct}%) BAC=${result.bac.value}h`,
        `  SPI($)=${fmtNum(result.spi)} CPI=${fmtNum(result.cpi)} SPI(t)=${fmtNum(result.spi_t)} SV(t)=${fmtNum(result.sv_t)}h`,
        `  EAC=${result.eac ? `${result.eac.value}${result.eac.unit}` : 'N/A'} ETC=${result.etc ? `${result.etc.value}${result.etc.unit}` : 'N/A'} VAC=${result.vac ? `${result.vac.value}${result.vac.unit}` : 'N/A'}`,
      ];
      for (const w of result.warnings) lines.push(`  warn: ${w}`);
      return `${lines.join('\n')}\n`;
    },
  });
}

// ── estimate velocity ──────────────────────────────────────────────────────────────
//   历史吞吐 + burn-down/burn-up（P50/P80）+ SLE（cycle-time P85/P95·Kanban Guide 2020）。--scope·--window·--json。
export function velocity(ctx: Ctx): number {
  return runRead(ctx, {
    render: (board, c) => {
      const b = board as BoardArg;
      const nowMs = nowMsOf(c);
      const { records: allRecords, scope } = loadScopedCorpus(b, c, nowMs);
      // --window <n>：按天滑窗过滤语料后再喂三处计算（SLE / throughput / tasksPerDay）·#bug2。
      //   缺省（无 --window）→ 不过滤（沿用现状·history_n 不变）。
      const windowDays = windowDaysFlag(c);
      const records = windowFilter(allRecords, windowDays, nowMs);
      const sle = cycleTimeSle(records);
      const backlog = backlogCount(b, nowMs); // as-of 截断（round5 sweep #1·同 forecast/EVM 口径）
      const thr = throughputMonteCarlo(backlog, records, { nowMs });

      // 历史天吞吐：done 任务 / 跨越的天数（粗·诚实标 history_n）。
      const finished = records
        .filter((r) => r.finishedAtMs != null)
        .map((r) => r.finishedAtMs as number);
      const spanDays =
        finished.length >= 2 ? (Math.max(...finished) - Math.min(...finished)) / 86400000 : 0;
      const tasksPerDay = spanDays > 0 ? round2(finished.length / spanDays) : null;

      const data = {
        scope,
        // window_days：实际生效的滑窗（--window 显式值；缺省 null = 不过滤·全语料）。
        window_days: windowDays,
        velocity_tasks_per_day: tasksPerDay,
        backlog,
        eta_days: Number.isFinite(thr.days.p50)
          ? { p50: round2(thr.days.p50), p80: round2(thr.days.p80), p95: round2(thr.days.p95) }
          : null,
        sle: {
          p50: round2(sle.p50),
          p85: round2(sle.p85),
          p95: round2(sle.p95),
          unit: 'h',
          confidence: sle.confidence,
          history_n: sle.history_n,
        },
        history_n: records.length,
        confidence: sle.confidence,
        source: records.length > 0 ? 'observability' : 'no-history',
        as_of: asOfISO(nowMs),
      };
      if (c.flags.json) return JSON.stringify({ ok: true, data });
      const lines = [
        `estimate velocity（scope=${scope}·history_n=${records.length}·confidence=${sle.confidence}）`,
        `  velocity: ${tasksPerDay ?? 'N/A'} tasks/day·backlog=${backlog}`,
        `  SLE cycle-time: p50=${fmtH(round2(sle.p50))} p85=${fmtH(round2(sle.p85))} p95=${fmtH(round2(sle.p95))}`,
      ];
      if (data.eta_days)
        lines.push(
          `  backlog ETA(days): p50=${data.eta_days.p50} p80=${data.eta_days.p80} p95=${data.eta_days.p95}`,
        );
      return `${lines.join('\n')}\n`;
    },
  });
}

// ── estimate risk ──────────────────────────────────────────────────────────────
//   综合风险：CI/CRI/SSI（MC 敏感度）+ WIP-aging SLE（age>P85 at_risk·>P95 critical）+ CCPM buffer_health。
export function risk(ctx: Ctx): number {
  return runRead(ctx, {
    render: (board, c) => {
      const b = board as BoardArg;
      const nowMs = nowMsOf(c);
      const { records, scope } = loadScopedCorpus(b, c, nowMs);
      const seed = intFlag(c.values.seed, 42);
      const runs = intFlag(c.values.runs, 2000);

      // MC 敏感度（CI/CRI/SSI）。
      const params = buildMcParams(b, records, nowMs);
      const est = estimateDagMonteCarlo(b, params, { seed, runs, nowMs });
      const topSensitivity = est.criticality_index
        .filter((s) => s.criticality > 0)
        .slice(0, 10)
        .map((s) => ({
          id: s.id,
          criticality: round3(s.criticality),
          cruciality: round3(s.cruciality),
          sensitivity: round3(s.sensitivity),
        }));

      // WIP-aging 联动 SLE。
      const sle = cycleTimeSle(records);
      const aging = wipAging(b, sle, nowMs)
        .filter((a) => a.status !== 'ok')
        .map((a) => ({
          id: a.id,
          age_hours: a.age_hours,
          status: a.status,
          sle_p85: a.sle_p85,
          sle_p95: a.sle_p95,
        }));

      // CCPM buffer_health（临界链 σ 来自 MC 参数·消耗 = done 任务超出 baseline 的部分·粗估）。
      const chainTasks = est.criticality_index
        .filter((s) => s.criticality >= 0.5)
        .map((s) => {
          const p = params.get(s.id);
          const mean = p ? p.meanHours : 1;
          const cv = p ? p.cv : 0.4;
          return { id: s.id, mean, sigma: mean * cv };
        });
      const buffer = sizeProjectBuffer({ chainTasks });
      // chainProgress：临界链节点里 done 的比例（as-of 截断·round5 sweep #1·同 buildMcParams 口径）。
      const tasks = Array.isArray(b?.tasks) ? (b.tasks as Array<Record<string, unknown>>) : [];
      const doneSet = new Set(tasks.filter((t) => isDoneAsOf(t, nowMs)).map((t) => t.id as string));
      const chainIds = est.criticality_index.filter((s) => s.criticality >= 0.5).map((s) => s.id);
      const chainProgress =
        chainIds.length > 0 ? chainIds.filter((id) => doneSet.has(id)).length / chainIds.length : 0;
      // bufferConsumed：粗用 chainProgress 触发（无实测超支数据时退 0·诚实）。
      const fever = feverStatus({
        bufferSize: buffer.buffer_size,
        bufferConsumed: 0,
        chainProgress,
      });

      const data = {
        scope,
        criticality_index: topSensitivity,
        wip_aging: aging,
        ccpm: {
          buffer_size_h: round2(buffer.buffer_size),
          chain_mean_total_h: round2(buffer.chain_mean_total),
          zone: fever.zone,
          buffer_health: fever.buffer_health,
          chain_progress_pct: fever.chain_progress_pct,
        },
        sle: { p85: round2(sle.p85), p95: round2(sle.p95), confidence: sle.confidence },
        history_n: records.length,
        confidence: records.length >= 4 ? 'medium' : 'low',
        source: records.length > 0 ? 'calibrated' : 'estimate',
        as_of: asOfISO(nowMs),
        seed,
        runs,
      };

      if (c.flags.json) return JSON.stringify({ ok: true, data });
      const lines = [`estimate risk（scope=${scope}·history_n=${records.length}）`];
      if (topSensitivity.length)
        lines.push(
          `  top risk nodes: ${topSensitivity
            .slice(0, 3)
            .map((s) => `${s.id}(CI=${s.criticality},SSI=${s.sensitivity})`)
            .join(', ')}`,
        );
      else lines.push('  敏感度: 无（冷启动 / 含环 / 单节点）');
      if (aging.length)
        lines.push(
          `  WIP-aging: ${aging.map((a) => `${a.id}=${a.status}(${a.age_hours}h)`).join(', ')}`,
        );
      else lines.push('  WIP-aging: 无超龄在飞任务（或无 SLE 基准）');
      lines.push(
        `  CCPM buffer: ${fever.zone}·health=${fever.buffer_health}·size=${round2(buffer.buffer_size)}h`,
      );
      return `${lines.join('\n')}\n`;
    },
  });
}

// ── estimate deadline-risk ──────────────────────────────────────────────────────────────
//   交付 DDL 风险 verdict（issue #149·契约 §4.3）：读 goal_contract.deadline → 三通道 MC
//   （precedence 乐观下界 + RCPSP-in-trial 唯一 verdict 源 + throughput heuristic 参考·绝不做 verdict）→
//   on_time_probability（**只来自 RCPSP-in-trial**）/ 分位 margin / 六态 risk band / top drivers / 诚实降级。
//   hook 只搬运不重算（红线3）。无 DDL / 含环 / 无估值 / 低置信 / 严重分歧 / RCPSP 不可用 → risk_band unknown（绝不假绿）。
//   --scope·--as-of·--runs（默认 2000）·--seed（默认 42·确定性可复现）·--effective-n。runRead 纯只读零写。
// deadlineRiskResult(b, c) → 完整 DeadlineRiskResult（契约 §4.3）。**单一计算路径 SSOT**：
//   `deadline-risk` endpoint 与 `forecast` 的 DDL 摘要块共用它（复用 computeDeadlineRisk·不重算·红线3）。
//   读 goal_contract.deadline（readDeadline）→ buildMcParams → 三通道 MC → verdict。无 DDL/含环/低置信 → unknown。
export interface DeadlineRiskObservation {
  result: DeadlineRiskResult;
  backlog: number;
  capturedAtMs: number;
}

export function deadlineRiskObservation(b: BoardArg, c: Ctx): DeadlineRiskObservation {
  const nowMs = nowMsOf(c);
  const { records, scope } = loadScopedCorpus(b, c, nowMs);
  const runs = intFlag(c.values.runs, 2000);
  const seed = intFlag(c.values.seed, 42);
  const effectiveN = effectiveNFlag(c.values['effective-n']);
  const coverage = estimateCoverage(b, nowMs);
  const backlog = backlogCount(b, nowMs);
  const wip = wipLimitOf(b);
  const params = buildMcParams(b, records, nowMs);

  const dl = readDeadline(b);
  // statusMap（top_drivers 的 blocked 类·id → {status, blocked_on}）。
  const tasks = Array.isArray(b?.tasks) ? (b.tasks as Array<Record<string, unknown>>) : [];
  const statusMap = new Map<string, { status?: string; blocked_on?: string }>();
  for (const t of tasks) {
    const id = typeof t.id === 'string' ? t.id : '';
    if (!id) continue;
    statusMap.set(id, {
      status: typeof t.status === 'string' ? t.status : undefined,
      blocked_on: typeof t.blocked_on === 'string' ? t.blocked_on : undefined,
    });
  }

  // latency 降档阶梯（契约 latency 预算·D3A：RCPSP 线性于 trials·线性于 N）。埋好防极端大图、别真限时
  //   （无 wall-clock 计时）：按 DAG 规模 × trials 保守乘积估降 rcpsp runs 2000→1000→500→disabled(unknown)。
  const nodeCount = tasks.length;
  const ladder = pickRcpspRuns(nodeCount, runs);

  const data = computeDeadlineRisk(b, {
    deadlineAtMs: dl.at_ms,
    deadlineState: dl.state,
    deadlineKind: dl.kind,
    asOfMs: nowMs,
    records,
    calibParams: params,
    backlog,
    wip,
    runs,
    seed,
    effectiveN,
    scope,
    historyN: records.length,
    coveragePct: coverage,
    statusMap,
    rcpspRuns: ladder.rcpspRuns,
    rcpspDisabled: ladder.rcpspDisabled,
  });
  if (ladder.rcpspRuns != null && ladder.rcpspRuns < runs && !ladder.rcpspDisabled)
    data.notes.push(
      `RCPSP-in-trial 按图规模降档 trials ${runs}→${ladder.rcpspRuns}（latency 预算·线性于 trials·别真限时）`,
    );
  return { result: data, backlog, capturedAtMs: nowMs };
}

function deadlineRiskResult(b: BoardArg, c: Ctx): DeadlineRiskResult {
  return deadlineRiskObservation(b, c).result;
}

// deadlineRiskSummary(b, c) → forecast 内嵌的 DDL margin/risk 摘要块（board 有 asserted/confirmed DDL 时）。
//   复用 deadlineRiskResult（同 endpoint 单一 SSOT·margin/band 与 `estimate deadline-risk` 逐字段一致）。
//   无已 settle 且带 at 的 DDL（pending / none / 键缺失）→ null（不显示·诚实 n/a·避免为无 DDL 板白跑 MC）。
function deadlineRiskSummary(b: BoardArg, c: Ctx): Record<string, unknown> | null {
  const dl = readDeadline(b);
  if (!dl.settled || dl.at_ms == null) return null; // pending/none/缺失 → 不附摘要（n/a）
  const dr = deadlineRiskResult(b, c);
  return {
    deadline: dr.deadline,
    deadline_state: dr.deadline_state,
    time_remaining_hours: dr.time_remaining_hours,
    risk_band: dr.risk_band,
    strength: dr.strength,
    on_time_probability: dr.on_time_probability,
    margin: dr.margin,
    confidence: dr.confidence,
    coverage_pct: dr.coverage_pct,
    calibration_status: dr.calibration_status,
  };
}

export function deadlineRisk(ctx: Ctx): number {
  return runRead(ctx, {
    render: (board, c) => {
      const b = board as BoardArg;
      const data = deadlineRiskResult(b, c);
      const scope = data.scope;
      const runs = data.runs;
      const seed = data.seed;
      const coverage = data.coverage_pct;

      if (c.flags.json) return JSON.stringify({ ok: true, data });
      const lines = [
        `estimate deadline-risk（scope=${scope}·runs=${runs}·seed=${seed}·coverage=${coverage}%）`,
        `  deadline=${data.deadline ?? 'N/A'}（state=${data.deadline_state}）·time_remaining=${data.time_remaining_hours != null ? `${data.time_remaining_hours}h` : 'N/A'}`,
        `  risk_band=${data.risk_band}·strength=${data.strength}·on_time_probability=${data.on_time_probability ?? 'unknown'}（src=${data.on_time_probability_source}）`,
        `  calibration=${data.calibration_status}·confidence=${data.confidence}·coverage=${data.coverage_pct}%·history_n=${data.history_n}`,
      ];
      if (data.channels.resource_aware)
        lines.push(
          `  rcpsp(verdict): P=${data.channels.resource_aware.on_time_probability}·makespan p50/p80/p95=${data.channels.resource_aware.makespan_p50_h}/${data.channels.resource_aware.makespan_p80_h}/${data.channels.resource_aware.makespan_p95_h}h·wip=${data.channels.resource_aware.wip ?? '∞'}`,
        );
      if (data.channels.precedence_only)
        lines.push(
          `  precedence(乐观下界): P=${data.channels.precedence_only.on_time_probability}·makespan p50/p80/p95=${data.channels.precedence_only.makespan_p50_h}/${data.channels.precedence_only.makespan_p80_h}/${data.channels.precedence_only.makespan_p95_h}h`,
        );
      if (data.channel_disagreement != null)
        lines.push(`  channel_disagreement=${data.channel_disagreement}`);
      if (data.top_drivers.length)
        lines.push(
          `  top_drivers: ${data.top_drivers
            .slice(0, 3)
            .map((d) => `${d.id}(${d.reason})`)
            .join(', ')}`,
        );
      for (const n of data.notes) lines.push(`  note: ${n}`);
      return `${lines.join('\n')}\n`;
    },
  });
}

// wipLimitOf(board) → scheduling.wip_limit（RCPSP 资源约束·缺/≤0 → ∞ 无资源闸）。
function wipLimitOf(board: BoardArg): number {
  const s =
    board && typeof board === 'object' ? (board as Record<string, unknown>).scheduling : null;
  const w =
    s && typeof s === 'object' && !Array.isArray(s)
      ? (s as Record<string, unknown>).wip_limit
      : null;
  return typeof w === 'number' && w > 0 ? w : Number.POSITIVE_INFINITY;
}

// pickRcpspRuns(nodeCount, runs) → RCPSP latency 降档阶梯（别真限时·按 DAG 规模 × trials 保守乘积估）。
//   D3A 实测：283 节点·2000 trials ≈ 450ms（10s hook budget 下 19× headroom）·latency 线性于 nodeCount·trials。
//   乘积 proxy（nodeCount × trials）：≤6M full → ≤12M 半 → ≤24M 四分之一 → >24M disabled（unknown·**绝不退 throughput**）。
//   现实板（≤数百节点）永远落 full；仅极端大图（数千节点）才降档——埋好、不真限时。
function pickRcpspRuns(
  nodeCount: number,
  runs: number,
): { rcpspRuns: number | null; rcpspDisabled: boolean } {
  const product = Math.max(0, nodeCount) * Math.max(1, runs);
  if (product <= 6_000_000) return { rcpspRuns: runs, rcpspDisabled: false };
  if (product <= 12_000_000)
    return { rcpspRuns: Math.max(1, Math.floor(runs / 2)), rcpspDisabled: false };
  if (product <= 24_000_000)
    return { rcpspRuns: Math.max(1, Math.floor(runs / 4)), rcpspDisabled: false };
  return { rcpspRuns: 0, rcpspDisabled: true };
}

// ── estimate cost-to-complete ──────────────────────────────────────────────────────────────
//   %-cost-to-complete（偿付力维·plan §4）：剩余 backlog × 每单位工作的配额% 增量（throughput 式 MC·复用
//   pctCostToCompleteMonteCarlo）→ 清空剩余工作的总配额% P50/P80/P95。**配额% 是权威预算账本**（plan §1.2）。
//   每单位 %-增量 = 账户权威 burn-rate（%/h·window-elapsed）× 历史任务工期（duration-grounded·串行归因假设）。
//   token 辅助 sizing（plan §4·接通 knnPredict.predictedTokens）：对每个 backlog 任务预测 token 作「派活多重」
//   相对量计——**辅助·非账本**，只用来把总% 按相对重量切到各任务（tokenWeightedShares）。
//   诚实降级：账户 burn 不可得 → available:false + cost null（非 exit 1）。--scope·--as-of·--runs·--seed。
export function costToComplete(ctx: Ctx): number {
  return runRead(ctx, {
    render: (board, c) => {
      const b = board as BoardArg;
      const nowMs = nowMsOf(c);
      const nowSec = Math.floor(nowMs / 1000);
      const { records, scope } = loadScopedCorpus(b, c, nowMs);
      const runs = intFlag(c.values.runs, 2000);
      const seed = intFlag(c.values.seed, 42);
      const backlog = backlogCount(b, nowMs); // as-of 截断（同 forecast/EVM 口径）
      const repo = boardRepo(b);

      // ── 账户权威 burn-rate（%/h·5h 窗口·复用 usage.accountBurnRate SSOT）──
      const burnView = accountBurnRate(
        c.env,
        nowSec,
        WINDOW_5H_SEC,
        'five_hour',
        c.values.harness as string | undefined,
      );
      const burn = burnView.burn_pct_per_hour;

      const notes: string[] = [];

      // ── per-unit %-增量池：burn × 历史任务工期（duration-grounded·throughput 式·plan §4）──
      const perUnitPct =
        burn != null
          ? records
              .filter((r) => r.actualHours != null && (r.actualHours as number) > 0)
              .map((r) => burn * (r.actualHours as number))
          : [];
      const mc = pctCostToCompleteMonteCarlo(backlog, perUnitPct, { seed, runs });

      if (burn == null)
        notes.push(
          `账户 burn-rate 不可用（${burnView.harness}: ${burnView.unavailable_reason || '当前 harness 未提供可用账户用量信号'}）——%-cost 无法折算·available:false 降级`,
        );
      else
        notes.push(
          'per-unit %-cost = burn-rate × 历史任务工期（假设串行归因·并行执行时偏高·advisory·plan §1.2）',
        );
      if (backlog === 0) notes.push('无 backlog（全部完成 / as-of 截断后）→ cost-to-complete 0%');
      if (burn != null && perUnitPct.length === 0 && backlog > 0)
        notes.push('无含实测工期的历史语料 → %-cost 池空·无法 MC（冷启动降级）');

      // ── token 辅助 sizing（knnPredict.predictedTokens·相对量计·非账本·plan §4）──
      const tasks = Array.isArray(b?.tasks) ? (b.tasks as Array<Record<string, unknown>>) : [];
      const backlogTasks = tasks.filter((t) => !isDoneAsOf(t, nowMs));
      const tokenRows = backlogTasks.map((t) => {
        const query: QueryCase = {
          repo,
          type: typeof t.type === 'string' ? t.type : '',
          executor: typeof t.executor === 'string' ? t.executor : '',
          tier: typeof t.tier === 'string' ? t.tier : '',
          model: typeof t.model === 'string' ? t.model : '',
          depsCount: Array.isArray(t.deps) ? t.deps.length : 0,
          estimateHours: estimateHours(t.estimate as never),
        };
        const knn = knnPredict(query, records, { nowMs });
        return {
          id: typeof t.id === 'string' ? t.id : '',
          predicted_tokens: knn.predictedTokens != null ? Math.round(knn.predictedTokens) : null,
          knn_confidence: knn.confidence,
        };
      });
      const tokenCovered = tokenRows.filter((r) => r.predicted_tokens != null);
      const totalPredictedTokens =
        tokenCovered.length > 0
          ? tokenCovered.reduce((s, r) => s + (r.predicted_tokens as number), 0)
          : null;
      // 把 MC 均值总% 按 token 相对权重切到各 backlog 任务（token=辅助权重·重活分得多）。
      const meanPct = Number.isFinite(mc.mean) ? mc.mean : null;
      const weights = tokenRows.map((r) => r.predicted_tokens ?? 0);
      const perTaskShares = meanPct != null ? tokenWeightedShares(weights, meanPct) : [];
      const perTaskPctShare = tokenRows.slice(0, 10).map((r, i) => ({
        id: r.id,
        predicted_tokens: r.predicted_tokens,
        pct_share: perTaskShares[i] != null ? round2(perTaskShares[i] as number) : null,
        knn_confidence: r.knn_confidence,
      }));
      if (totalPredictedTokens == null && backlog > 0)
        notes.push(
          '无可预测 token 的历史邻居 → token 辅助 sizing 不可得（仅 %-账本可用·诚实降级）',
        );

      const available = burn != null;
      const confidence: 'high' | 'medium' | 'low' = burn == null ? 'low' : mc.confidence;

      const data = {
        cost_to_complete_pct: Number.isFinite(mc.pct.p50)
          ? { p50: round2(mc.pct.p50), p80: round2(mc.pct.p80), p95: round2(mc.pct.p95) }
          : null,
        mean_pct: meanPct != null ? round2(meanPct) : null,
        backlog,
        burn_pct_per_hour: burn,
        burn_used_pct: burnView.used_pct,
        burn_method: burnView.method,
        per_unit_samples: mc.per_unit_samples,
        // token 辅助 sizing（**辅助·非预算账本**·plan §1.2/§4）。
        token_sizing: {
          total_predicted_tokens: totalPredictedTokens,
          per_task: perTaskPctShare,
          note: 'token 为派活相对 sizing（辅助·knnPredict.predictedTokens）·配额% 才是预算账本',
        },
        scope,
        runs,
        seed,
        as_of: asOfISO(nowMs),
        source:
          burn == null ? 'local-derived-approx' : records.length > 0 ? 'calibrated' : 'account',
        confidence,
        available,
        history_n: records.length,
        notes,
      };

      if (c.flags.json) return JSON.stringify({ ok: true, data });
      const lines = [
        `estimate cost-to-complete（scope=${scope}·backlog=${backlog}·confidence=${confidence}）`,
      ];
      if (data.cost_to_complete_pct)
        lines.push(
          `  配额% to complete: p50=${data.cost_to_complete_pct.p50}% p80=${data.cost_to_complete_pct.p80}% p95=${data.cost_to_complete_pct.p95}%（5% 硬墙）`,
        );
      else lines.push('  配额% to complete: N/A（账户 burn 不可用 / 无历史工期语料 / backlog=0）');
      lines.push(
        `  burn-rate: ${burn != null ? `${burn}%/h（used=${fmtPct2(burnView.used_pct)}·${burnView.method}）` : 'N/A（账户信号不可用）'}`,
      );
      lines.push(
        `  token sizing（辅助）: total≈${totalPredictedTokens ?? 'N/A'} tok（knnPredict·相对量计·非账本）`,
      );
      for (const n of notes) lines.push(`  note: ${n}`);
      return `${lines.join('\n')}\n`;
    },
  });
}

function fmtPct2(p: number | null | undefined): string {
  return typeof p === 'number' ? `${p}%` : 'N/A';
}

// ── helpers ──────────────────────────────────────────────────────────────────
function round2(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : x;
}
function round3(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x;
}
function roundSens(s: {
  id: string;
  criticality: number;
  cruciality: number;
  sensitivity: number;
}): {
  id: string;
  criticality: number;
  cruciality: number;
  sensitivity: number;
} {
  return {
    id: s.id,
    criticality: round3(s.criticality),
    cruciality: round3(s.cruciality),
    sensitivity: round3(s.sensitivity),
  };
}
function intFlag(v: unknown, dflt: number): number {
  if (typeof v === 'string' && v && Number.isFinite(Number(v))) return Math.floor(Number(v));
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
  return dflt;
}
// effectiveNFlag(v) → --effective-n 解析为整数（floor 1·仿 usage advise·缺/坏 → 1）。
function effectiveNFlag(v: unknown): number {
  const n = intFlag(v, 1);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
function fmtH(h: number | null | undefined): string {
  return typeof h === 'number' && Number.isFinite(h) ? `${h}h` : 'N/A';
}
// fmtMargin(h) → 带符号的余量小时（+ = DDL 前完成·− = 越过 DDL·issue #149·D6 人读）。
function fmtMargin(h: number | null | undefined): string {
  if (typeof h !== 'number' || !Number.isFinite(h)) return 'N/A';
  return `${h >= 0 ? '+' : ''}${h}h`;
}
function fmtNum(x: number | null | undefined): string {
  return typeof x === 'number' && Number.isFinite(x) ? String(x) : 'N/A';
}
function addHoursISO(nowMs: number, hours: number): string {
  return asOfISO(nowMs + hours * 3600000);
}
function addDaysISO(nowMs: number, days: number): string {
  return asOfISO(nowMs + days * 86400000);
}
