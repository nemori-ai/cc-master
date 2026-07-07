#!/usr/bin/env node
// identity-nudge.js — 周期提示 hook（PERIODIC PROMPTS·Stop 事件·ADR-020 + hooks-enhancements-v2 ②）。
//
// 物理文件名保留 `identity-nudge.js`（避免改 hooks.json 注册 + ADR-020 刚落地的 churn），但**概念上它已是
//   periodic-prompts hook**：在长会话里顺序跑一张**周期提示表** `[identity, critpath]`，每条都过 hook-common 的
//   `periodicNudge` helper（同一武装 / 单 active 板守卫 / 各自独立计时）。
//
// 事件：Stop。每当主线 agent 想交还控制权时触发（每回合至多一次·与 usage-pacing / verify-board 同事件）。
//   ① IDENTITY（默认 6h）：轻量重申「你是 master orchestrator」+ 漂离提示重温 SKILL A——补 reinject
//      （SessionStart·compaction 边界整篇重注魂）够不到的盲区「长时间无 compaction 时的缓慢漂移」。
//   ② CRITPATH（默认 2h）：报「临界路径整体进度 X/Y·按期/落后」——补「长会话里埋头派发、对临界路径健康度失感」
//      盲区。X/Y 是 chain ∩ tasks[].status 的**纯计数**（读窄腰·红线2·hook 不算图·红线3）；按期/落后 verdict
//      来自 ccm estimate（无 baseline 降级省从句·ccm 出 verdict·红线3）。
//   两条各读各的 `runtime.<key>` 时间戳判阈值，注入后经 `ccm board set-param` 写回（带锁·进程边界·ADR-020）。
//   **写回成功才注入**——杜绝 ccm 缺时每回合 spam。两条都 due 时同一回合注两条 advisory（各 weak·语义正交·罕见）。
//
// 与 reinject 的边界（互补不重叠）：reinject 在 compaction 处做全量重新接地（整篇 SKILL A substrate）；本 hook
//   在 compaction 之间的长空档做轻量周期 tick。本 hook 不重注 substrate（那是 reinject 的活）、不重申身份给
//   critpath（identity 与 critpath 各报各的·无复述）。
//
// 红线1 / ADR-006：node/JS only，纯 stdlib + spawnSync ccm（进程边界·ADR-014·非 import 引擎·非 python）。
// 红线2：只读 narrow-waist owner.active/session_id 判武装（harness 做）+ 读 ✎ runtime.* + 读窄腰 tasks[].status
//   数 X/Y；写也只写 ✎ runtime.*（经 ccm setter）——**窄腰一字不动**。
// 红线3：图算法 / verdict 是 ccm 引擎 SSOT——chain ← `ccm board critical-path`、on-track/behind ← `ccm estimate`；
//   hook 只对 chain 做纯计数（非图算法）+ 搬运 ccm verdict。
// 红线4：advisory weak·永不 block Stop·不替主线做调度（只温和提示·指挥不演奏不受影响）。
// 红线6（dormant-until-armed）：arm:'boards'·harness 武装后才读/写/注入；未武装静默。
// ship-anywhere（红线5）：ccm 缺 / spawn 失败 / lock timeout → 静默降级（feature 等同关闭·不报错不 block）。

'use strict';

const { spawnSync } = require('child_process');
const { advisory, runHook, parseIsoMs, periodicNudge } = require('./hook-common.js');

// CCM_BIN：进程边界 spawn 的 ccm 可执行（与 usage-pacing / board-lint 同口径）。缺则用 PATH 上的 `ccm`；
//   指向不存在路径即强制走「ccm 缺→静默」降级（测试用）。
const CCM_BIN = process.env.CCM_BIN || 'ccm';
// CC_MASTER_NOW：ISO-8601 覆写「现在」（与 usage-pacing 同口径·测试注入确定性时间）。缺则 Date.now()。
const NOW_OVERRIDE = process.env.CC_MASTER_NOW || '';
// CC_MASTER_IDNUDGE_INTERVAL_SEC：身份提示周期阈值（秒）。缺/非正/非数 → 默认 6h（21600s）。
const IDENTITY_INTERVAL_RAW = process.env.CC_MASTER_IDNUDGE_INTERVAL_SEC || '';
// CC_MASTER_CRITPATH_INTERVAL_SEC：临界路径提示周期阈值（秒）。缺/非正/非数 → 默认 2h（7200s）。临界路径进度是
//   编排健康度的高价值周期信号，值得比身份提示（6h）更勤。
const CRITPATH_INTERVAL_RAW = process.env.CC_MASTER_CRITPATH_INTERVAL_SEC || '';
// ccm 子进程超时（ms）。默认 10s。CC_MASTER_IDNUDGE_TIMEOUT_MS 覆写（测试注入·两条 nudge 共用）。
const CCM_TIMEOUT_MS = (() => {
  const n = Number(process.env.CC_MASTER_IDNUDGE_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 10000;
})();

const DEFAULT_IDENTITY_INTERVAL_SEC = 6 * 60 * 60; // 6h
const DEFAULT_CRITPATH_INTERVAL_SEC = 2 * 60 * 60; // 2h

// intervalSecOf(raw, dflt) → 周期阈值（秒）。空/非正/非数 → 默认（先判空串：Number('')===0 的 JS footgun）。
function intervalSecOf(raw, dflt) {
  if (!raw) return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

// 身份周期提示文案（中文·imperative 给 agent·advisory weak）。
const IDENTITY_TEXT =
  '[身份周期提示] 你是一个 cc-master master orchestrator，正在把某个长程目标编排到完成。' +
  '若你已偏离编排者姿态（开始亲手实现 / 亲自 review / 空转等待 / 把 green gate 当 passed），' +
  '现在是重温 master-orchestrator-guide（SKILL A）七镜头 + 决策程序、回到指挥位的时机。' +
  '若你确在编排轨道上，无需特定动作——继续推进。';

// ── critpath：spawn ccm 读图 + estimate verdict（红线3：ccm 出数/verdict·hook 不算图）──────────────────
// spawnCcmJson(args) → 解析后的 `{ ok, data }` 的 data 对象 | null。spawnSync `ccm <args> --json`（透传
//   CC_MASTER_HOME）。任何失败（ENOENT / 信号 / 坏 JSON / 形状不符）→ null（调用方降级）。
function spawnCcmJson(args, homeDir) {
  const env = Object.assign({}, process.env, { CC_MASTER_HOME: homeDir });
  let r;
  try {
    r = spawnSync(CCM_BIN, args, { encoding: 'utf8', timeout: CCM_TIMEOUT_MS, env });
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
  // critical-path --json 直接是 { chain, makespan, weight_source }；estimate evm --json 是 { ok, data }。
  return parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
}

// buildCritpathText(board, boardPath, homeDir) → critpath advisory 文案 或 null（弃权·chain 空 → 无可报）。
//   ① chain ← spawn `ccm board critical-path --json`（red line 3·ccm 出图）。chain 空 / spawn 失败 → 弃权。
//   ② X/Y ← chain 的 task id 与 board.tasks[].status 交叉**纯计数**（Y=chain.length·X=chain 中 status∈
//      {done,verified} 的数·读窄腰·红线2）。board 已被 harness 解析·无需再 spawn。
//   ③ on-track/behind ← spawn `ccm estimate evm --json`（red line 3·ccm 出 verdict）。has_baseline:false /
//      spawn 失败 → 优雅降级：省「按期/落后」从句，只报 X/Y（不假装有 schedule verdict·诚实记账）。
function buildCritpathText(board, boardPath, homeDir) {
  const cp = spawnCcmJson(['board', 'critical-path', '--json', '--board', boardPath], homeDir);
  const chain = cp && Array.isArray(cp.chain) ? cp.chain : [];
  if (!chain.length) return null; // 空图 / spawn 失败 → 无临界链可报 → 弃权（本回合不注入）

  const tasks = board && Array.isArray(board.tasks) ? board.tasks : [];
  const statusById = new Map();
  for (const t of tasks) {
    if (t && typeof t === 'object' && typeof t.id === 'string') statusById.set(t.id, t.status);
  }
  const Y = chain.length;
  let X = 0;
  for (const id of chain) {
    const st = statusById.get(id);
    if (st === 'done' || st === 'verified') X += 1;
  }

  // verdict（on-track / behind）← ccm estimate evm（无 baseline 降级省从句）。spi_t < 1（或 sv_t < 0）= behind。
  const evm = spawnCcmJson(['estimate', 'evm', '--json', '--board', boardPath], homeDir);
  let verdictClause = '';
  let behindClause = '';
  if (evm && evm.has_baseline === true) {
    const spiT = typeof evm.spi_t === 'number' ? evm.spi_t : null;
    const svT = typeof evm.sv_t === 'number' ? evm.sv_t : null;
    const behind = (spiT !== null && spiT < 1) || (svT !== null && svT < 0);
    if (behind) {
      verdictClause = '·按 ccm estimate 评估为 behind schedule（落后）';
      behindClause =
        '临界链是 makespan 的瓶颈——可考虑把临界节点升档提速 / 补派资源 / 重排 float，但别制造 busywork。';
    } else {
      verdictClause = '·按 ccm estimate 评估为 on-track（按期）';
      behindClause = '无需特定动作，继续推进。';
    }
  } else {
    behindClause = '（无 baseline·不报按期/落后判定）无需特定动作，继续推进。';
  }

  return (
    `[临界路径周期提示] 当前临界路径：${X}/${Y} 关键任务已完成${verdictClause}。` +
    `${behindClause}这是周期性弱提示，最终调度仍由你拍。`
  );
}

// ── body：plumbing（stdin/home/武装/fail-silent/exit 0）由 hook-common.runHook 提供（arm:'boards'）。
//   body 顺序跑周期提示表 `[identity, critpath]`——每条过 periodicNudge（读 runtime.<key> 判阈值 → 写回 →
//   build 文案）。两条各自独立 due；同一回合可能 0/1/2 条注入。倾向先不礼让（两条 weak·罕见同回合·各自有价值）。
function body(ctx) {
  // 多/零 active 板 → 目标板歧义 → 保守不动（同 IDNUDGE·写回需确定性目标板路径透传 --board）。
  if (!ctx.boards || ctx.boards.length !== 1) return;
  const board = ctx.boards[0].board; // harness 已解析·无需 ccm 即可读
  const boardPath = ctx.boards[0].path;

  const nowMs = NOW_OVERRIDE ? parseIsoMs(NOW_OVERRIDE) : Date.now();
  if (nowMs === null) return; // --now 非法 → 静默（不猜）

  const blocks = [];

  // PARITY: rule-identity-nudge-tag-protocol
  // ① IDENTITY 周期提示（advisory weak·source identity-nudge）。
  const identityText = periodicNudge({
    board,
    boardPath,
    homeDir: ctx.homeDir,
    ccmBin: CCM_BIN,
    key: 'last_identity_remind',
    intervalSec: intervalSecOf(IDENTITY_INTERVAL_RAW, DEFAULT_IDENTITY_INTERVAL_SEC),
    nowMs,
    setparamTimeoutMs: CCM_TIMEOUT_MS,
    build: () => IDENTITY_TEXT,
  });
  if (identityText) blocks.push(advisory('identity-nudge', 'weak', identityText));

  // ② CRITPATH 周期提示（advisory weak·source critpath-nudge）。build 在 due 且写回成功后才 spawn ccm 读图
  //   （被 interval 门控·罕见·spawn 节制）；chain 空 → build 弃权 → 不注入（但时间戳已前移·下个 interval 再 due）。
  const critpathText = periodicNudge({
    board,
    boardPath,
    homeDir: ctx.homeDir,
    ccmBin: CCM_BIN,
    key: 'last_critpath_remind',
    intervalSec: intervalSecOf(CRITPATH_INTERVAL_RAW, DEFAULT_CRITPATH_INTERVAL_SEC),
    nowMs,
    setparamTimeoutMs: CCM_TIMEOUT_MS,
    build: () => buildCritpathText(board, boardPath, ctx.homeDir),
  });
  if (critpathText) blocks.push(advisory('critpath-nudge', 'weak', critpathText));

  if (!blocks.length) return; // 两条都未 due / 写回失败 / 弃权 → 静默
  return { additionalContext: blocks.join('\n') };
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
