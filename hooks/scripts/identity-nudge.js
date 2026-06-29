#!/usr/bin/env node
// identity-nudge.js — IDNUDGE（周期身份提示 hook·设计 2026-06-29-periodic-prompt-and-board-params §5 + ADR-020）。
//
// 事件：Stop。每当主线 agent 想交还控制权时触发（每回合至多一次·与 usage-pacing / verify-board 同事件）。
//   在长会话里隔一段时间（默认 6h）轻量重申「你是 master orchestrator」并提示漂离时重温 SKILL A——补
//   reinject（SessionStart·compaction 边界整篇重注魂）够不到的盲区：**长时间无 compaction 时的缓慢漂移**。
//   它读 board 上的参数区时间戳 `runtime.last_identity_remind` 判阈值，提示后经 `ccm board set-param` 把
//   时间戳写回（带锁·进程边界·ADR-020）。**写回成功才注入**——杜绝 ccm 缺时每回合 spam。
//
// 与 reinject 的边界（互补不重叠·设计 §5.5）：reinject 在 compaction 处做全量重新接地（整篇 SKILL A
//   substrate）；IDNUDGE 在 compaction 之间的长空档做轻量周期 tick（一行 advisory）。IDNUDGE 不重注
//   substrate（那是 reinject 的活），reinject 不做周期计时（那是 IDNUDGE 的活）。
//
// 红线1 / ADR-006：node/JS only，纯 stdlib + spawnSync ccm（进程边界·ADR-014·非 import 引擎·非 python）。
// 红线2：只读 narrow-waist owner.active/session_id 判武装（harness 做）+ 读 ✎ runtime.last_identity_remind；
//   写也只写 ✎ runtime.*（经 ccm setter）——**窄腰一字不动**。
// 红线4：advisory weak·永不 block Stop·不替主线做调度（只温和提示·指挥不演奏不受影响）。
// 红线6（dormant-until-armed）：arm:'boards'·harness 武装后才读/写/注入；未武装静默。
// ship-anywhere（红线5）：ccm 缺 / spawn 失败 / lock timeout → 静默降级（feature 等同关闭·不报错不 block）。

'use strict';

const { spawnSync } = require('child_process');
const { advisory, runHook } = require('./hook-common.js');

// CCM_BIN：进程边界 spawn 的 ccm 可执行（与 usage-pacing / board-lint 同口径）。缺则用 PATH 上的 `ccm`；
//   指向不存在路径即强制走「ccm 缺→静默」降级（测试用）。
const CCM_BIN = process.env.CCM_BIN || 'ccm';
// CC_MASTER_NOW：ISO-8601 覆写「现在」（与 usage-pacing 同口径·测试注入确定性时间）。缺则 Date.now()。
const NOW_OVERRIDE = process.env.CC_MASTER_NOW || '';
// CC_MASTER_IDNUDGE_INTERVAL_SEC：周期阈值（秒）。缺/非正/非数 → 默认 6h（21600s）。
const INTERVAL_RAW = process.env.CC_MASTER_IDNUDGE_INTERVAL_SEC || '';
// ccm board set-param 子进程超时（ms）。默认 10s。CC_MASTER_IDNUDGE_TIMEOUT_MS 覆写（测试注入）。
const SETPARAM_TIMEOUT_MS = (() => {
  const n = Number(process.env.CC_MASTER_IDNUDGE_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 10000;
})();

const DEFAULT_INTERVAL_SEC = 6 * 60 * 60; // 6h

// parseIso(s) → epoch ms 或 null（容错·非法当缺失）。Z → +00:00 让 Date 正确取 UTC。
function parseIso(s) {
  if (typeof s !== 'string' || !s) return null;
  const t = Date.parse(s.replace('Z', '+00:00'));
  return Number.isNaN(t) ? null : t;
}

// isoNow(ms) → 严格 ISO-8601 UTC 秒级（YYYY-MM-DDTHH:MM:SSZ·与 mutations.stampNow / ISO_UTC_RE 同口径）。
function isoNow(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// intervalSec() → 周期阈值（秒）。空/非正/非数 → 默认 6h（先判空串：Number('')===0 的 JS footgun）。
function intervalSec() {
  if (!INTERVAL_RAW) return DEFAULT_INTERVAL_SEC;
  const n = Number(INTERVAL_RAW);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL_SEC;
}

// spawnCcmSetParam(boardPath, homeDir, key, value) → true ⟺ 写回成功（ccm exit 0）。
//   照 usage-pacing.attemptCcmSwitch 体例：spawnSync `ccm board set-param <key> <value> --board <path>
//   --home <home>`（透传 CC_MASTER_HOME 让 ccm 解析同一 home）。**fail-silent**：ENOENT（ccm 不在 PATH）/
//   spawn 抛 / 被信号杀 / 非 0 退出（lint hard / lock timeout / Usage）→ false（调用方据此不注入·本回合不提示）。
//   token-blind：参数区只有时间戳·绝无 secret（与 ADR-020 §4.2.6 同纪律）。
function spawnCcmSetParam(boardPath, homeDir, key, value) {
  const args = ['board', 'set-param', key, value, '--board', boardPath, '--home', homeDir];
  const env = Object.assign({}, process.env, { CC_MASTER_HOME: homeDir });
  let r;
  try {
    r = spawnSync(CCM_BIN, args, { encoding: 'utf8', timeout: SETPARAM_TIMEOUT_MS, env });
  } catch (_e) {
    return false; // spawn 本身抛（极少）→ 视为 ccm 不在·不注入
  }
  if (!r || r.error || r.signal) return false; // ENOENT（ccm 不在 PATH）/ 被信号杀（超时）→ 降级静默
  return r.status === 0; // exit 0 = 写回成功；非 0（lint/lock/Usage）→ 不注入
}

// 身份周期提示文案（设计 §5.4·中文·imperative 给 agent·advisory weak）。
const NUDGE_TEXT =
  '[身份周期提示] 你是一个 cc-master master orchestrator，正在把某个长程目标编排到完成。' +
  '若你已偏离编排者姿态（开始亲手实现 / 亲自 review / 空转等待 / 把 green gate 当 passed），' +
  '现在是重温 orchestrating-to-completion（SKILL A）七镜头 + 决策程序、回到指挥位的时机。' +
  '若你确在编排轨道上，无需特定动作——继续推进。';

// ── body：plumbing（stdin/home/武装/fail-silent/exit 0）由 hook-common.runHook 提供（arm:'boards'）。
//   body 只剩 IDNUDGE 独有的「读 runtime.last_identity_remind 判阈值 → 写回 → 注入」。
function body(ctx) {
  // 多/零 active 板 → 目标板歧义 → 保守不动（同 LBHOOK §确定性目标板·写回需确定性目标板路径透传 --board）。
  if (!ctx.boards || ctx.boards.length !== 1) return;
  const board = ctx.boards[0].board; // harness 已解析·无需 ccm 即可读
  const boardPath = ctx.boards[0].path;

  const nowMs = NOW_OVERRIDE ? parseIso(NOW_OVERRIDE) : Date.now();
  if (nowMs === null) return; // --now 非法 → 静默（不猜）

  const rt = board && typeof board.runtime === 'object' && board.runtime ? board.runtime : null;
  const last = rt ? rt.last_identity_remind : undefined;
  const lastMs = parseIso(last); // 缺 / 非 ISO → null → 视为「从未提示」（首次必提示·设计 §5.3）
  const due = lastMs === null || nowMs - lastMs >= intervalSec() * 1000;
  if (!due) return; // 未到阈值 → 静默

  // 先写回（写成功才注入·避免 ccm 缺时每回合 spam）：进程边界 spawn·token-blind·带锁·fail-silent。
  const ok = spawnCcmSetParam(boardPath, ctx.homeDir, 'last_identity_remind', isoNow(nowMs));
  if (!ok) return; // ccm 缺 / 失败 / lock timeout → 静默（本回合不提示·下回合再试）

  // 注入 ADR-018 advisory（weak）——身份重申 + 漂离则重温 SKILL A。
  return { additionalContext: advisory('identity-nudge', 'weak', NUDGE_TEXT) };
}

// runHook：arm:'boards'（武装 + 填 ctx.boards 在 harness·未武装静默·红线6）；preGate = STOP RE-ENTRY GUARD
//   （stop_hook_active:true → 立即静默·须先于武装——否则每次重入都重注/重写，等于 session 停不下来·与
//   usage-pacing 同）。全程 try/catch + exit 0 由 harness 保证（hook 崩绝不污染 Stop）。
runHook({
  event: 'Stop',
  arm: 'boards',
  preGate(ctx) {
    return !!(ctx.obj && ctx.obj.stop_hook_active === true);
  },
  body,
});
