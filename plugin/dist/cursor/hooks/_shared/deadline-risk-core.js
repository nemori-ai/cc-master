'use strict';
// deadline-risk-core.js — 交付 DDL 风险 armed hook 的 host-neutral 核心（issue #149·契约 §5·codex triage #6）。
//
// 概念：这是 periodic-prompts hook（物理文件 identity-nudge / identity-nudge-core）的一条 **deadline-risk 周期
//   条目**——当本板 goal_contract.deadline 已 settle（state ∈ {asserted, confirmed} 且有 at）时，周期 / 变更 /
//   恢复触发地经进程边界调 `ccm estimate deadline-risk --json` 重估延期风险，band 恶化 / 恢复时注入一条带
//   fingerprint 去重节流的 ADR-018 advisory，并**直接注入后立即 self-ack** 一条 durable `deadline_risk` 通知
//   （durable 只作审计 / 跨 session 留痕，不二次投递·codex triage #6 单一投递路径）。
//
// 三 host 复用同一份核心（claude-code / codex / cursor），各自 require 本模块 → 拿 { text, strength } →
//   套本 host 的 advisory 标签 + envelope（Claude Code additionalContext / Codex systemMessage / Cursor
//   followup_message）。核心 host-neutral：只吃 config、返回文案 + 力度，不碰 envelope。
//
// 红线1：node/JS only·纯 stdlib（fs/path/child_process）+ spawnSync `ccm`（进程边界·非 import 引擎·非 python）。
// 红线2：只读窄腰 tasks[].{id,status,deps} 算 fingerprint + 读 👁 goal_contract.deadline；写只写 ✎ runtime.*
//   （经 ccm board set-param 白名单）。窄腰一字不动。
// 红线3（关键）：所有图算法 / 估算 / 风险 verdict 归 ccm 引擎——本核心 **只搬运** `ccm estimate deadline-risk`
//   的结构化响应，绝不重写 CPM / Monte Carlo / RCPSP / 分位 / 风险阈值。
// 红线4：advisory·永不 block Stop·不替主线决策（只给决策输入 + 优先级）。
// 红线5：ccm 缺 / spawn 失败 / lock timeout / 坏 JSON → 静默降级（feature 等同关闭·不报错·不 block·不伪造 verdict）。
// 红线6：dormant-until-armed 由 host 侧 harness 保证（本核心只在武装后被调）。

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RISK_BANDS = ['on_track', 'watch', 'at_risk', 'likely_late', 'overdue', 'unknown'];
const RISKY_BANDS = new Set(['watch', 'at_risk', 'likely_late', 'overdue']);
// bandRank：严格恶化序（on_track < watch < at_risk < likely_late < overdue）。unknown / 缺 → -1（不可比·
//   既非 green 也非 risk，只作「无信号」态·绝不当恢复也不当恶化的锚）。
function bandRank(band) {
  const i = RISK_BANDS.indexOf(band);
  if (band === 'unknown' || i < 0) return -1;
  return i; // on_track=0 … overdue=4
}

function parseIsoMs(s) {
  if (typeof s !== 'string' || !s) return null;
  const t = Date.parse(s.replace('Z', '+00:00'));
  return Number.isNaN(t) ? null : t;
}
function isoNow(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// readDeadlineView(board) → { settled, state, at, atMs }。hook 侧只需这四项（完整 DeadlineView SSOT 在 ccm
//   引擎 readDeadline·本核心不重算语义，只读足够判「有没有已 settle 的带 at 的 DDL」）。
function readDeadlineView(board) {
  const empty = { settled: false, state: 'pending', at: null, atMs: null };
  if (!board || typeof board !== 'object') return empty;
  const contract = board.goal_contract;
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return empty;
  const dl = contract.deadline;
  if (!dl || typeof dl !== 'object' || Array.isArray(dl)) return empty;
  const state = typeof dl.state === 'string' ? dl.state : 'pending';
  const at = typeof dl.at === 'string' ? dl.at : null;
  const atMs = at ? parseIsoMs(at) : null;
  // settled 且有 at = 有一个可用于 deadline-risk 的确定截止时刻（asserted / confirmed·none 无 at 不算）。
  const settled = (state === 'asserted' || state === 'confirmed') && atMs !== null;
  return { settled, state, at, atMs };
}

// computeRiskFingerprint(board) → risk-input 稳定摘要（string）。从窄腰 tasks[].{id,status,deps} + deadline.at
//   + deadline.rev + scheduling.wip_limit 算——**绝不**靠脆弱 shell 字符串解析猜 ccm mutation（契约 §5.2）。
//   任务按 id 排序保证稳定（board 内顺序变不算 risk-input 变）。
function computeRiskFingerprint(board) {
  const tasks = board && Array.isArray(board.tasks) ? board.tasks : [];
  const rows = [];
  for (const t of tasks) {
    if (!t || typeof t !== 'object' || typeof t.id !== 'string') continue;
    const deps = Array.isArray(t.deps) ? t.deps.filter((d) => typeof d === 'string').slice().sort() : [];
    const blocked = typeof t.blocked_on === 'string' ? t.blocked_on : '';
    rows.push(`${t.id}:${t.status || ''}:${deps.join(',')}:${blocked}`);
  }
  rows.sort();
  const contract = board && board.goal_contract;
  const dl = contract && typeof contract === 'object' ? contract.deadline : null;
  const at = dl && typeof dl === 'object' ? dl.at || '' : '';
  const rev = dl && typeof dl === 'object' && Number.isInteger(dl.rev) ? dl.rev : '';
  const sched = board && typeof board.scheduling === 'object' && board.scheduling ? board.scheduling : {};
  const wip = Number.isFinite(sched.wip_limit) ? sched.wip_limit : '';
  const ownerWip = Number.isFinite(sched.owner_wip_limit) ? sched.owner_wip_limit : '';
  return djb2(`${rows.join('|')}#dl=${at}#rev=${rev}#wip=${wip}#owip=${ownerWip}`);
}
function djb2(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// spawnCcmJson(ccmBin, args, homeDir, timeoutMs) → 解析后的 data 对象 | null（任何失败 → null·fail-safe）。
function spawnCcmJson(ccmBin, args, homeDir, timeoutMs) {
  const env = Object.assign({}, process.env, { CC_MASTER_HOME: homeDir });
  let r;
  try {
    r = spawnSync(ccmBin, args, { encoding: 'utf8', timeout: timeoutMs, env });
  } catch (_e) {
    return null;
  }
  if (!r || r.error || r.signal || r.status !== 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(typeof r.stdout === 'string' ? r.stdout : '');
  } catch (_e) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  return parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
}

// spawnCcmOk(ccmBin, args, homeDir, timeoutMs) → true ⟺ ccm exit 0（set-param / ack 用·fail-silent）。
function spawnCcmOk(ccmBin, args, homeDir, timeoutMs) {
  const env = Object.assign({}, process.env, { CC_MASTER_HOME: homeDir });
  let r;
  try {
    r = spawnSync(ccmBin, args, { encoding: 'utf8', timeout: timeoutMs, env });
  } catch (_e) {
    return false;
  }
  return !!r && !r.error && !r.signal && r.status === 0;
}

// ── 通知去重 sidecar（hook-owned·非 board·契约 §5.3）───────────────────────────────────────────────────
//   一个 sidecar 文件按 boardPath 分区：{ [boardPath]: { last_band, last_prob, last_fp, last_notified_at_ms,
//   last_top_driver } }。记「上次通知的」band / 概率 / notification fingerprint / 时刻 / top driver，让通知
//   状态机据「首次进入 / 恶化 / 概率显著下降 / top driver 变 / 长期未处理 reminder / 恢复」决定要不要（再）通知。
function readNotifState(file) {
  try {
    const o = JSON.parse(fs.readFileSync(file, 'utf8'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch (_e) {
    return {};
  }
}
function writeNotifState(file, state) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  } catch (_e) {
    /* fail-silent */
  }
}

// roundBucket(p, step) → 概率落 step 桶（notification fingerprint 用·避免微抖动改 fp 制造 spam）。null → 'na'。
function roundBucket(p, step) {
  if (typeof p !== 'number' || !Number.isFinite(p)) return 'na';
  return String(Math.round(p / step) * step);
}
function round2(n) {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// effectiveCadenceSec(base, timeRemainingSec, lastBand, minFloor) → 自适应周期（契约 §5.2 粗自适应）：随
//   time_to_ddl 减小缩短（至少每剩余 10% 检查一次），last band 已 risky 再减半，夹在 [minFloor, base]。
function effectiveCadenceSec(base, timeRemainingSec, lastBand, minFloor) {
  let c = base;
  if (Number.isFinite(timeRemainingSec) && timeRemainingSec > 0) {
    c = Math.min(base, Math.max(minFloor, timeRemainingSec * 0.1));
  }
  if (RISKY_BANDS.has(lastBand)) c = Math.max(minFloor, c / 2);
  return c;
}

// marginClause(margin) → p50/p80/p95 margin 从句（h·负=越 DDL）或 ''。
function marginClause(margin) {
  if (!margin || typeof margin !== 'object') return '';
  const f = (v) => (typeof v === 'number' ? `${v}h` : 'n/a');
  return `margin p50/p80/p95=${f(margin.p50_h)}/${f(margin.p80_h)}/${f(margin.p95_h)}`;
}

// topDriversClause(drivers) → 「先动哪里」从句或 ''。
function topDriversClause(drivers) {
  if (!Array.isArray(drivers) || !drivers.length) return '';
  const parts = drivers.slice(0, 3).map((d) => {
    if (!d || typeof d !== 'object') return '';
    const detail = typeof d.detail === 'string' && d.detail ? `·${d.detail}` : '';
    return `${d.id}(${d.reason}${detail})`;
  }).filter(Boolean);
  return parts.length ? `top drivers: ${parts.join(', ')}` : '';
}

// buildRiskText(data, changeReason) → deadline-risk advisory 正文（契约 §5.3 通知内容·imperative 给 agent）。
function buildRiskText(data, changeReason) {
  const trh = typeof data.time_remaining_hours === 'number' ? `${data.time_remaining_hours}h` : 'n/a';
  const prob = data.on_time_probability != null ? data.on_time_probability : 'unknown';
  const dis = data.channel_disagreement != null ? `·双通道分歧=${data.channel_disagreement}` : '';
  const margin = marginClause(data.margin);
  const drivers = topDriversClause(data.top_drivers);
  const lines = [
    `[交付 DDL 风险周期提示] risk band=${data.risk_band}（${changeReason}）。` +
      `DDL=${data.deadline || 'n/a'}·as-of=${data.as_of || 'n/a'}·剩余=${trh}·准时概率 P(on-time)=${prob}` +
      `（source=${data.on_time_probability_source || 'unknown'}）。`,
    `confidence=${data.confidence}·coverage=${data.coverage_pct}%·calibration=${data.calibration_status}${dis}。` +
      (margin ? `${margin}。` : ''),
  ];
  if (drivers) lines.push(`${drivers}。`);
  lines.push(
    '这是延期风险信号，不是替你决策：优先做一次**全局 DAG reconcile / replan**（比对 forecast 分位与 DDL、' +
      '看临界路径 / float / 阻塞 / 返工 / 剩余缓冲），而非继续局部推进；预计延期时以 decision_package 升级给用户，' +
      '绝不为按期静默砍验收 / 伪造完成 / 自行改 DDL。最终调度仍由你拍。',
  );
  return lines.join('\n');
}

// recoveryText(data) → band 回落的恢复通知正文（weak·好消息）。
function recoveryText(data) {
  const trh = typeof data.time_remaining_hours === 'number' ? `${data.time_remaining_hours}h` : 'n/a';
  const prob = data.on_time_probability != null ? data.on_time_probability : 'unknown';
  return (
    `[交付 DDL 风险恢复] risk band 回落到 ${data.risk_band}（准时概率 P(on-time)=${prob}·剩余=${trh}）。` +
    '延期风险已缓解——无需特定动作，继续按计划推进；这是周期性弱提示，最终调度仍由你拍。'
  );
}

// deliverDurable(cfg, kind, summary, strength, payload, nowMs) → 单一投递路径的 durable 侧（codex triage #6）：
//   `ccm coordination notify --kind deadline_risk …` 建一条审计条目 → 立即 `ccm coordination inbox ack <id>`
//   自 ack（durable 只作审计 / 跨 session 留痕·不被 coordination-inbox hook 二次投递）。全 best-effort·失败不
//   影响已发生的直接注入。
function deliverDurable(cfg, summary, strength, payload, nowMs) {
  const expires = isoNow(nowMs + 24 * 60 * 60 * 1000); // 24h 审计窗
  const notifyOut = spawnCcmJson(
    cfg.ccmBin,
    [
      'coordination', 'notify',
      '--kind', 'deadline_risk',
      '--summary', summary,
      '--strength', strength,
      '--payload', JSON.stringify(payload),
      '--expires', expires,
      '--json',
      '--home', cfg.homeDir,
      '--board', cfg.boardPath,
    ],
    cfg.homeDir,
    cfg.timeoutMs,
  );
  const id =
    notifyOut && notifyOut.notification && typeof notifyOut.notification.id === 'string'
      ? notifyOut.notification.id
      : null;
  if (!id) return; // notify 失败 → 没有可 ack 的 id（直接注入仍已发生·审计缺失可接受·fail-safe）
  // self-ack：立即消费自己刚写的条目（单一投递路径·direct inject 才是投递）。
  spawnCcmOk(
    cfg.ccmBin,
    ['coordination', 'inbox', 'ack', id, '--json', '--home', cfg.homeDir, '--board', cfg.boardPath],
    cfg.homeDir,
    cfg.timeoutMs,
  );
}

// deadlineRiskBlock(cfg) → { hasSettledDdl, block }。
//   · hasSettledDdl：本板是否有已 settle 的带 at 的 DDL（供 host 侧决定是否抑制 critpath schedule 从句·去重）。
//   · block：{ text, strength, kind:'deadline_risk' } 要注入，或 null（本回合不注入）。
//
//   cfg = { board, boardPath, homeDir, ccmBin, nowMs, timeoutMs?, cadenceSec?, reminderSec?, minRecheckSec?,
//           sidecarPath, probDropThreshold? }
function deadlineRiskBlock(cfg) {
  const board = cfg.board;
  const dl = readDeadlineView(board);
  if (!dl.settled) return { hasSettledDdl: false, block: null }; // 无已 settle 的 DDL → deadline-risk n/a

  const nowMs = cfg.nowMs;
  const timeoutMs = Number.isFinite(cfg.timeoutMs) && cfg.timeoutMs > 0 ? cfg.timeoutMs : 10000;
  const cadenceSec = Number.isFinite(cfg.cadenceSec) && cfg.cadenceSec > 0 ? cfg.cadenceSec : 2 * 60 * 60;
  const reminderSec = Number.isFinite(cfg.reminderSec) && cfg.reminderSec > 0 ? cfg.reminderSec : 6 * 60 * 60;
  const minRecheckSec =
    Number.isFinite(cfg.minRecheckSec) && cfg.minRecheckSec > 0 ? cfg.minRecheckSec : 5 * 60;
  const probDrop =
    Number.isFinite(cfg.probDropThreshold) && cfg.probDropThreshold > 0 ? cfg.probDropThreshold : 0.1;

  const rt = board && typeof board.runtime === 'object' && board.runtime ? board.runtime : {};
  const lastCheckMs = parseIsoMs(rt.last_deadline_risk_check);
  const lastFp = typeof rt.last_deadline_risk_fingerprint === 'string' ? rt.last_deadline_risk_fingerprint : '';
  const fp = computeRiskFingerprint(board);

  // sidecar：上次通知态（含 last_band·用于自适应 cadence 与状态机）。
  const notifStore = readNotifState(cfg.sidecarPath);
  const prev = notifStore[cfg.boardPath] && typeof notifStore[cfg.boardPath] === 'object'
    ? notifStore[cfg.boardPath]
    : {};
  const lastBand = typeof prev.last_band === 'string' ? prev.last_band : undefined;

  // ── 触发（有界 hybrid·契约 §5.2）：周期（自适应）OR risk-input fingerprint 变（受 minRecheck 地板节制）──
  const timeRemainingSec = dl.atMs != null ? (dl.atMs - nowMs) / 1000 : NaN;
  const effCadence = effectiveCadenceSec(cadenceSec, timeRemainingSec, lastBand, minRecheckSec);
  const cadenceDue = lastCheckMs === null || nowMs - lastCheckMs >= effCadence * 1000;
  const floorOk = lastCheckMs === null || nowMs - lastCheckMs >= minRecheckSec * 1000;
  const fingerprintChanged = lastFp !== fp;
  const due = cadenceDue || (fingerprintChanged && floorOk);
  if (!due) return { hasSettledDdl: true, block: null };

  // ── 重估：调 ccm estimate deadline-risk（红线3 只搬运·ccm 缺 / 坏 JSON → 静默降级不写回·下 Stop 重试）──
  const data = spawnCcmJson(
    cfg.ccmBin,
    ['estimate', 'deadline-risk', '--board', cfg.boardPath, '--json'],
    cfg.homeDir,
    timeoutMs,
  );
  if (!data || typeof data.risk_band !== 'string') return { hasSettledDdl: true, block: null };

  // ── 写回 runtime 簿记（cadence + fingerprint）：写成功才继续（ccm 缺 / set-param 白名单缺键 → 静默·fail-safe）──
  const checkOk = spawnCcmOk(
    cfg.ccmBin,
    ['board', 'set-param', 'last_deadline_risk_check', isoNow(nowMs), '--board', cfg.boardPath, '--home', cfg.homeDir],
    cfg.homeDir,
    timeoutMs,
  );
  if (!checkOk) return { hasSettledDdl: true, block: null }; // 写回失败 → 不注入（避免 ccm 缺时每回合 spam）
  spawnCcmOk(
    cfg.ccmBin,
    ['board', 'set-param', 'last_deadline_risk_fingerprint', fp, '--board', cfg.boardPath, '--home', cfg.homeDir],
    cfg.homeDir,
    timeoutMs,
  ); // best-effort（失败仅致下回合多一次重估·可接受）

  // ── 通知状态机（sidecar·契约 §5.3）─────────────────────────────────────────────────────────────────
  const band = data.risk_band;
  const prob = round2(data.on_time_probability);
  const topDriver = Array.isArray(data.top_drivers) && data.top_drivers[0] ? data.top_drivers[0].id : undefined;
  const notifFp = `${band}|${topDriver || ''}|${roundBucket(prob, 0.05)}|${data.deadline || ''}`;

  const lastProb = typeof prev.last_prob === 'number' ? prev.last_prob : null;
  const lastNotifiedFp = typeof prev.last_fp === 'string' ? prev.last_fp : '';
  const lastNotifiedAtMs = typeof prev.last_notified_at_ms === 'number' ? prev.last_notified_at_ms : null;
  const lastTopDriver = typeof prev.last_top_driver === 'string' ? prev.last_top_driver : undefined;

  // 更新 last_band / last_prob / last_top_driver（每次成功重估都推进·供转移检测），notification 锚（last_fp /
  //   last_notified_at_ms）只在真通知时推进（保 dedup + reminder 对齐上次「投递」）。
  function persist(patch) {
    notifStore[cfg.boardPath] = Object.assign(
      { last_band: band, last_prob: prob, last_top_driver: topDriver },
      prev.last_fp !== undefined ? { last_fp: lastNotifiedFp } : {},
      lastNotifiedAtMs !== null ? { last_notified_at_ms: lastNotifiedAtMs } : {},
      patch || {},
    );
    writeNotifState(cfg.sidecarPath, notifStore);
  }

  // unknown：既非 green 也非 risk——**绝不映射成绿 / 绝不假绿**，只更新 last_band、不通知（低置信 / 无信号静默）。
  if (band === 'unknown') {
    persist({});
    return { hasSettledDdl: true, block: null };
  }

  const riskyNow = RISKY_BANDS.has(band);
  const lastRisky = RISKY_BANDS.has(lastBand);
  const curRank = bandRank(band);
  const lastRank = bandRank(lastBand);

  const firstEntering = riskyNow && !lastRisky;
  const worsened = lastRank >= 0 && curRank > lastRank;
  const probDropped = riskyNow && lastProb !== null && prob !== null && lastProb - prob >= probDrop;
  const driverChanged =
    riskyNow && !firstEntering && !!topDriver && lastTopDriver !== undefined && topDriver !== lastTopDriver;
  const recovery = lastRisky && curRank >= 0 && curRank < lastRank; // 恢复（band 回落·含回到 on_track）
  const reminderDue = riskyNow && lastNotifiedAtMs !== null && nowMs - lastNotifiedAtMs >= reminderSec * 1000;

  let notify = firstEntering || worsened || probDropped || driverChanged || recovery || reminderDue;
  // dedup：同一 notification fingerprint 已投递过且非 reminder → 抑制（相同风险不 spam）。
  if (notify && notifFp === lastNotifiedFp && !reminderDue) notify = false;

  if (!notify) {
    persist({}); // 推进 last_band 等，但不动 notification 锚
    return { hasSettledDdl: true, block: null };
  }

  // ── 该通知：直接注入（block）+ durable self-ack（单一投递路径·codex triage #6）──────────────────────
  const isRecovery = recovery && !riskyNow;
  const text = isRecovery ? recoveryText(data) : buildRiskText(data, changeReasonOf({ firstEntering, worsened, probDropped, driverChanged, reminderDue }));
  // strength：ccm 出的 ADR-018 力度（watch=weak·at_risk/likely_late/overdue=strong）；恢复固定 weak（好消息·低 stakes）。
  const strength = isRecovery ? 'weak' : data.strength === 'strong' ? 'strong' : 'weak';

  persist({ last_fp: notifFp, last_notified_at_ms: nowMs });

  deliverDurable(
    cfg,
    `deadline-risk ${band} (P(on-time)=${prob != null ? prob : 'unknown'}, DDL ${data.deadline || 'n/a'})`,
    strength,
    {
      producer: 'deadline-risk',
      route: 'coordination-inbox',
      self_acked: true, // 审计只留痕·不二次投递（direct inject 才是投递）
      risk_band: band,
      on_time_probability: prob,
      deadline: data.deadline || null,
      fingerprint: notifFp,
    },
    nowMs,
  );

  return { hasSettledDdl: true, block: { text, strength, kind: 'deadline_risk' } };
}

// changeReasonOf(flags) → 「自上次评估发生了什么变化」的短从句（契约 §5.3 通知内容）。
function changeReasonOf(f) {
  if (f.firstEntering) return '首次进入风险';
  if (f.worsened) return 'band 恶化';
  if (f.probDropped) return '准时概率显著下降';
  if (f.driverChanged) return 'top driver 变化';
  if (f.reminderDue) return '高风险长期未处理 reminder';
  return '风险更新';
}

module.exports = {
  deadlineRiskBlock,
  readDeadlineView,
  computeRiskFingerprint,
  bandRank,
  // 导出以便测试 / host 侧复用（host 侧只需 deadlineRiskBlock + readDeadlineView）。
  _internals: { effectiveCadenceSec, buildRiskText, recoveryText, changeReasonOf, roundBucket },
};
