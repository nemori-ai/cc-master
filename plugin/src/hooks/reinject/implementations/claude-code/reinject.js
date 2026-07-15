#!/usr/bin/env node
'use strict';
// reinject.js — SessionStart hook（startup|resume|compact）·v2 node 收编（ADR-013 §2.4）。
//
// 职责：fresh start / resume / compaction 后从外部**重注**「我是 orchestrator」这一角色——compaction 会
//   整块丢掉它，agent 自己注不回来。指向 HOME + 列出**本 session** 的 active 板（带 goal），但不绑定具体板
//   （agent 按 goal 自辨己板）。再叠 H4：列出未对账（stale/escalated）节点，把计划更新的事务断点在 resume 时点名。
//
// ★v2 收编：取代 v1 reinject.sh 里 owner_region / dangling_nodes / board_matches 三段脆弱 awk 深度扫描——
//   node 的 JSON.parse 直接、正确地读 owner 子对象与 top-level task.status（归档板嵌套 active:true、task-local
//   log[] 里的 stale 都天然不再误触，CODEX7 / Case J/Q 类盲区由数据模型解析根除）。武装闸复用 hook-common。
//
// ★phase-1b：plumbing（stdin/home/listMatchingBoards 武装/additionalContext envelope/fail-silent/exit 0）收口
//   进 hook-common.runHook（arm:'boards'）；body 只剩独有的「列 active 板 + dangling 节点 + 拼 substrate 文案」。
//   reinject 输出是 agent 的操作 substrate（魂重注·**不进 ADR-018 标签体系**·§13），但 plumbing 与其余三个
//   listMatchingBoards hook 同构、可共用 harness——harness 不碰文案，标签由各 body 自决（reinject 不套）。
//
// 红线1/ADR-006：node/JS only，纯 stdlib + 有界 ccm goal check（进程边界），零网络/第三方依赖。红线6：dormant-until-armed——harness 武装闸
//   （arm:'boards' 空列表静默 exit 0）。红线2：只读 narrow-waist（owner.active/session_id 判武装 + goal/
//   tasks[].status/parent 列信息，不写 board）。

const { spawnSync } = require('child_process');
const { boardsDir, jsonEscape, runHook } = require('./hook-common.js');

function goalLabel(board) {
  const goal = (typeof board.goal === 'string' && board.goal) ? board.goal : '(goal not recorded yet)';
  const contract = board.goal_contract;
  if (!contract || typeof contract !== 'object' || contract.schema !== 'ccm/goal-contract/v1') return `legacy: ${goal}`;
  return `r${contract.revision || '?'} ${contract.assurance || 'unknown'}: ${goal}`;
}

function goalCheck(boardPath, homeDir) {
  const ccm = process.env.CCM_BIN || 'ccm';
  try {
    const result = spawnSync(ccm, ['goal', 'check', '--board', boardPath, '--json', '--no-input'], {
      encoding: 'utf8', timeout: 10000, env: { ...process.env, CC_MASTER_HOME: homeDir },
    });
    if (!result || result.error || result.signal || result.status !== 0) return { verdict: 'check_unavailable' };
    const parsed = JSON.parse(result.stdout || '{}');
    return parsed && parsed.ok === true && parsed.data ? parsed.data : { verdict: 'check_unavailable' };
  } catch (_) {
    return { verdict: 'check_unavailable' };
  }
}

runHook({
  event: 'SessionStart',
  arm: 'boards', // 本 session 的 active 板（武装闸 board_matches）；空 → harness 静默 exit 0（无 active orchestration）
  body(ctx) {
    const BOARDS_DIR = boardsDir(ctx.homeDir); // 给注入文案指明 board 集中目录（listMatchingBoards 内部自走 boards/）
    const boards = ctx.boards;                 // harness 已按文件名升序排 = 与 v1 glob `*.board.json` 同序（确定性）

    let listing = '';
    const danglingEntries = [];
    const emptyBoards = [];
    const goalStops = [];
    for (const { name, path: boardPath, board } of boards) {
      const label = goalLabel(board);
      listing += ` • ${name} [${label}]`;
      const tasks = Array.isArray(board.tasks) ? board.tasks : [];
      const hasContract = !!(board.goal_contract && board.goal_contract.schema === 'ccm/goal-contract/v1');
      if (hasContract) {
        const check = goalCheck(boardPath, ctx.homeDir);
        if (check.verdict !== 'ok') goalStops.push(`${name} [${label}] verdict=${check.verdict || 'malformed'}`);
      }
      if (tasks.length === 0) emptyBoards.push({ text: `${name} [${label}]`, pending: hasContract && board.goal_contract.assurance === 'pending' });
      for (const t of tasks) {
        if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
        if (t.status !== 'stale' && t.status !== 'escalated') continue; // 只看 top-level task 的 status
        const id = (typeof t.id === 'string' && t.id) ? t.id : '';
        if (!id) continue;
        const par = (typeof t.parent === 'string' && t.parent) ? t.parent : '';
        danglingEntries.push(par ? `${id} (owner ${par})` : id); // 有 parent 的子标注 owner（D3.7 分组）
      }
    }

    let ctxText = `You are a cc-master master orchestrator. Your orchestration board(s) live in ${BOARDS_DIR}. Active:${listing}. ` +
      `Run ccm goal check for the board you are working on, read its current Goal Brief when present, then invoke the master-orchestrator-guide skill ` +
      `and continue the decision program. Do not restart work already done/verified; integrate any completed background results first.`;

    // PARITY: rule-reinject-goal-integrity
    if (goalStops.length) {
      ctxText += ` HARD STOP: Goal Contract integrity/assurance requires reconciliation before dispatch: ${goalStops.join(', ')}. ` +
        `Use ccm goal show/check; refine with ccm goal set, or amend through ccm goal amend. Never bypass a bad Brief hash.`;
    }

    // PARITY: rule-reinject-empty-board-hard-stop
    if (emptyBoards.length) {
      const pending = emptyBoards.filter((entry) => entry.pending).map((entry) => entry.text);
      const settled = emptyBoards.filter((entry) => !entry.pending).map((entry) => entry.text);
      ctxText += ` HARD STOP: active board(s) with zero tasks are not runnable orchestration DAGs: ${emptyBoards.map((entry) => entry.text).join(', ')}. `;
      if (pending.length) ctxText += `Pending Goal Contract board(s) ${pending.join(', ')} must be clarified and persisted via ccm goal set, then pass ccm goal check before decomposition. `;
      if (settled.length) ctxText += `For settled/legacy board(s) ${settled.join(', ')}, write tasks with acceptance criteria via ccm task add. `;
      ctxText += `Do not treat an armed empty board as permission to proceed.`;
    }

    // H4：点名未对账节点（stale/escalated）。空 → ctx 与无 note 时字节一致。
    // PARITY: rule-reinject-dangling-nodes
    if (danglingEntries.length) {
      ctxText += ` Note on resume: your board has unresolved node(s) needing attention — stale/escalated: ${danglingEntries.join(', ')}. ` +
        `Reconcile these (re-run stale, re-altitude escalated) before scheduling new work.`;
    }

    // reinject 是 substrate 魂重注（不套 ADR-018 标签）。手拼 additionalContext envelope 经 jsonEscape，
    //   与 harness 的 { additionalContext } 形态字节等价（已验证 key 序 + 转义一致），故用 raw 直拼保持原样。
    return { raw: `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":${jsonEscape(ctxText)}}}\n` };
  },
});
