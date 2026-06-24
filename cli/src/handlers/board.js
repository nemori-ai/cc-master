'use strict';
// handlers/board.js — board noun handler（show / lint / graph / critical-path / next / init / update）。
//
// 照抄 log.js 范式：每 verb 一个 handler(ctx)→exitCode；读 verb 走 _common.runRead、写 verb 走 runWrite。
//   handler **直接 require leaf 模块**（mutations / render / registry / board-graph-core / board-lint-core），
//   不经 ctx 注入（契约 §三 ctx 形态）。mutation / discover 的 throw **不在 handler 内 catch**——冒泡给
//   router 按 .errKind 映射退出码。handler **绝不 process.exit**（return exitCode）。
//
// 域内分工：
//   · show          → runRead + render.renderBoardSummary（带 lint 结果让摘要显示 lint 是否净）。
//   · lint          → runRead + lintCore.lintBoard + render.renderLintReport；有 hard error → return EXIT.VALIDATION。
//   · graph         → runRead + analyzeGraph 句柄 → render.renderGraph。
//   · critical-path → runRead + analyzeGraph 句柄 → render.renderCriticalPath。
//   · next          → runRead + analyzeGraph().readySet() → render.renderNext。
//   · init          → runWrite + 自定义 resolve（不发现既有板而新建文件·§7：owner.active:true / session_id:""）
//                     + mutations.boardInit（忽略 raw 直接产板）。
//   · update        → runWrite + mutations.boardUpdate（goal / wip-limit / owner-wip / branch / worktree）。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib。CommonJS。
// 武装闸豁免：纯 handler 模块（无 hook 入口，只被 router 经 registry.handler 调）——见 AGENTS.md §3 / §12。

const path = require('path');
const mutations = require('../mutations.js');
const render = require('../render.js');
const discover = require('../discover.js');
const io = require('../io.js');
const lintCore = require('../board-lint-core.js');
const graphCore = require('../board-graph-core.js');
const { runWrite, runRead } = require('./_common.js');

const EXIT = io.EXIT;

// ── 读 verb：show ───────────────────────────────────────────────────────────────────────────────
// 摘要 = goal · owner · 任务统计 · lint 是否净。render 需要传入 lint 结果才会渲染 lint 段（render 不自跑 lint）。
function show(ctx) {
  return runRead(ctx, {
    render: (board, c) => {
      const lint = lintCore.lintBoard(JSON.stringify(board || {}));
      return render.renderBoardSummary(board, { json: !!c.flags.json, color: c.flags.color, lint });
    },
  });
}

// ── 读 verb：lint ───────────────────────────────────────────────────────────────────────────────
// 校验整板；有 hard error → return EXIT.VALIDATION（设计稿 §4：lint 是「读」但 hard error 退 3）。
//   注：runRead 恒返回 EXIT.OK，故 lint 不走 runRead——自己 resolve + 渲染 + 据 errors 决定退出码。
function lint(ctx) {
  const resolved = discover.resolveBoard({
    boardFlag: ctx.values && ctx.values.board,
    sid: ctx.sid,
    homeFlag: ctx.values && ctx.values.home,
    goalSubstr: ctx.values && ctx.values.goal,
    env: ctx.env,
  });
  const res = lintCore.lintBoard(JSON.stringify(resolved.board || {}));
  ctx.out(render.renderLintReport(res, { json: !!ctx.flags.json, color: ctx.flags.color }));
  return (Array.isArray(res.errors) && res.errors.length > 0) ? EXIT.VALIDATION : EXIT.OK;
}

// ── 读 verb：graph ──────────────────────────────────────────────────────────────────────────────
// DAG 全量分析：把 analyzeGraph(board) 句柄直接喂 render.renderGraph（render 内部探测句柄方法·_coerceAnalysis）。
function graph(ctx) {
  return runRead(ctx, {
    compute: (board) => graphCore.analyzeGraph(board || {}),
    render: (analysis, c) => render.renderGraph(analysis, { json: !!c.flags.json, color: c.flags.color }),
  });
}

// ── 读 verb：critical-path ──────────────────────────────────────────────────────────────────────
function criticalPath(ctx) {
  return runRead(ctx, {
    compute: (board) => graphCore.analyzeGraph(board || {}),
    render: (analysis, c) => render.renderCriticalPath(analysis, { json: !!c.flags.json, color: c.flags.color }),
  });
}

// ── 读 verb：next ───────────────────────────────────────────────────────────────────────────────
// readySet——现在能派发什么。analyzeGraph().readySet() 返回 id 数组 → render.renderNext。
function next(ctx) {
  return runRead(ctx, {
    compute: (board) => graphCore.analyzeGraph(board || {}).readySet(),
    render: (ready, c) => render.renderNext(ready, { json: !!c.flags.json, color: c.flags.color }),
  });
}

// ── 写 verb：init（特殊·不发现既有板而新建文件·§7）────────────────────────────────────────────────
//   自定义 resolve：--board 显式路径优先，否则在 resolveHome 内生成时间序文件名（与 bootstrap-board.sh 同口径）。
//     resolve 返回 { boardPath, board:null }——mutate 忽略 raw 直接 boardInit 产板（owner.active:true / session_id:""）。
//   仍走 runWrite 的 lock + lint + 原子写同一管线（模板含 hard error → EXIT.VALIDATION）。
function initResolve(ctx) {
  const explicit = (ctx.values && ctx.values.board) || (ctx.env && ctx.env.CC_MASTER_BOARD);
  if (explicit) return { boardPath: path.resolve(explicit), board: null };
  const home = discover.resolveHome({ homeFlag: ctx.values && ctx.values.home, env: ctx.env });
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[:-]/g, '');
  const boardPath = path.join(home, `${stamp}-${process.pid}.board.json`);
  return { boardPath, board: null };
}

function init(ctx) {
  return runWrite(ctx, {
    resolve: initResolve,
    mutate: () => {
      const goal = ctx.values && typeof ctx.values.goal === 'string' ? ctx.values.goal : '';
      return mutations.boardInit({ goal });
    },
    render: (board, c, { dryRun }) => {
      if (c.flags.json) return render.renderBoardSummary(board, { json: true });
      const prefix = dryRun ? '[dry-run] 将建板: ' : 'board 已建: ';
      return prefix + (board.goal ? `goal="${board.goal}"` : '(无 goal)');
    },
  });
}

// ── 写 verb：update（改板级配置：goal / wip-limit / owner-wip / branch / worktree）───────────────────
//   registry 的 --wip-limit / --owner-wip 是 string（无 transform）——boardUpdate 期待 number，故在此显式 coerce。
//   坏整数（非数字）→ throw Usage（router 映射 exit 2）；不静默写非数字（否则 FMT-SCHEDULING warn）。
//   至少给一个可识别 flag——全无 → throw Usage（设计稿 update：「至少给一个 flag」）。
function update(ctx) {
  return runWrite(ctx, {
    mutate: (board) => {
      const v = ctx.values || {};
      const args = {};
      if (v.goal !== undefined) args.goal = v.goal;
      if (v['wip-limit'] !== undefined) args.wipLimit = parseIntFlag(v['wip-limit'], '--wip-limit');
      if (v['owner-wip'] !== undefined) args.ownerWip = parseIntFlag(v['owner-wip'], '--owner-wip');
      if (v.branch !== undefined) args.branch = v.branch;
      if (v.worktree !== undefined) args.worktree = v.worktree;
      if (Object.keys(args).length === 0) {
        const e = new Error('board update 至少须给一个 flag（--goal / --wip-limit / --owner-wip / --branch / --worktree）');
        e.errKind = 'Usage';
        throw e;
      }
      return mutations.boardUpdate(board, args);
    },
    render: (board, c, { dryRun }) => {
      if (c.flags.json) return render.renderBoardSummary(board, { json: true });
      const prefix = dryRun ? '[dry-run] 将改板级配置' : 'board 配置已更新';
      const sc = (board.scheduling && typeof board.scheduling === 'object') ? board.scheduling : {};
      const parts = [
        `goal="${board.goal || ''}"`,
        `wip_limit=${sc.wip_limit !== undefined ? sc.wip_limit : '-'}`,
      ];
      return `${prefix}: ${parts.join('  ')}`;
    },
  });
}

// parseIntFlag(raw, flagName) → 正整数；坏 → throw Usage（router 映射 exit 2）。
//   multiple:false 的 string flag·raw 是单值；防御性取最后一次（若数组）。
function parseIntFlag(raw, flagName) {
  const s = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0) {
    const e = new Error(`${flagName} 须是非负整数（收到 ${JSON.stringify(s)}）`);
    e.errKind = 'Usage';
    throw e;
  }
  return n;
}

module.exports = { show, lint, graph, criticalPath, next, init, update };
