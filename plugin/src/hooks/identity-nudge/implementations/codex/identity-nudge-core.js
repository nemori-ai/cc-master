#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CCM_BIN = process.env.CCM_BIN || 'ccm';
const DEFAULT_IDENTITY_INTERVAL_SEC = 6 * 60 * 60;
const DEFAULT_CRITPATH_INTERVAL_SEC = 2 * 60 * 60;
const DEFAULT_GOAL_INTERVAL_SEC = 2 * 60 * 60;

const IDENTITY_TEXT =
  '[身份周期提示] 你是一个 cc-master master orchestrator，正在把某个长程目标编排到完成。' +
  '若你已偏离编排者姿态（开始亲手实现 / 亲自 review / 空转等待 / 把 green gate 当 passed），' +
  '现在是重温 master-orchestrator-guide（SKILL A）七镜头 + 决策程序、回到指挥位的时机。' +
  '若你确在编排轨道上，无需特定动作——继续推进。';

function goalText(board) {
  const contract = board && board.goal_contract;
  if (!contract || contract.schema !== 'ccm/goal-contract/v1') return '';
  const compact = String(board.goal || '(goal pending)').replace(/\s+/g, ' ').trim().slice(0, 160);
  return `[目标对齐周期提示] 当前 Goal Contract r${contract.revision || '?'} ${contract.assurance || 'unknown'}：${compact}。` +
    '有用不等于相关：继续前先做 Goal Trace Test，工作必须能追溯到当前 goal / acceptance；新发现只能分类为 in-scope、amendment、follow-up 或 unrelated，绝不静默扩 scope。';
}

function readJson() {
  const raw = fs.readFileSync(0, 'utf8');
  return raw ? JSON.parse(raw) : {};
}

function resolveHome(env) {
  return env.CC_MASTER_HOME || path.join(env.HOME || os.homedir(), '.cc_master');
}

function parseIsoMs(value) {
  if (typeof value !== 'string' || !value) return null;
  const t = Date.parse(value.replace('Z', '+00:00'));
  return Number.isNaN(t) ? null : t;
}

function isoNow(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function intervalSec(raw, fallback) {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function boardMatches(board, sessionId) {
  const owner = board && typeof board === 'object' && board.owner && typeof board.owner === 'object'
    ? board.owner
    : {};
  if (owner.active !== true) return false;
  if (!sessionId) return true;
  return owner.session_id === sessionId;
}

function listBoards(home, sessionId) {
  const dir = path.join(home, 'boards');
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.board.json')) continue;
    const boardPath = path.join(dir, entry.name);
    let board;
    try {
      board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
    } catch {
      continue;
    }
    if (boardMatches(board, sessionId)) out.push({ path: boardPath, board });
  }
  return out;
}

function setParam(home, boardPath, key, value) {
  let result;
  try {
    result = spawnSync(CCM_BIN, ['board', 'set-param', key, value, '--board', boardPath, '--home', home], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, CC_MASTER_HOME: home },
    });
  } catch {
    return false;
  }
  return !!result && !result.error && !result.signal && result.status === 0;
}

function due(board, key, nowMs, seconds) {
  const runtime = board && typeof board.runtime === 'object' && board.runtime ? board.runtime : {};
  const last = parseIsoMs(runtime[key]);
  return last === null || nowMs - last >= seconds * 1000;
}

function ccmJson(args, home) {
  let result;
  try {
    result = spawnSync(CCM_BIN, args, {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, CC_MASTER_HOME: home },
    });
  } catch {
    return null;
  }
  if (!result || result.error || result.signal || result.status !== 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(result.stdout || '');
  } catch {
    return null;
  }
  return parsed && typeof parsed === 'object' && parsed.data && typeof parsed.data === 'object'
    ? parsed.data
    : parsed;
}

function critpathText(board, boardPath, home) {
  const cp = ccmJson(['board', 'critical-path', '--json', '--board', boardPath], home);
  const chain = cp && Array.isArray(cp.chain) ? cp.chain : [];
  if (chain.length === 0) return '';
  const statusById = new Map();
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  for (const task of tasks) {
    if (task && typeof task === 'object' && typeof task.id === 'string') statusById.set(task.id, task.status);
  }
  let done = 0;
  for (const id of chain) {
    const status = statusById.get(id);
    if (status === 'done' || status === 'verified') done += 1;
  }
  const evm = ccmJson(['estimate', 'evm', '--json', '--board', boardPath], home);
  let verdictClause = '';
  let suffix = '（无 baseline·不报按期/落后判定）无需特定动作，继续推进。';
  if (evm && evm.has_baseline === true) {
    const behind = (typeof evm.spi_t === 'number' && evm.spi_t < 1) ||
      (typeof evm.sv_t === 'number' && evm.sv_t < 0);
    if (behind) {
      verdictClause = '·按 ccm estimate 评估为 behind schedule（落后）';
      suffix = '临界链是 makespan 的瓶颈——可考虑把临界节点升档提速 / 补派资源 / 重排 float，但别制造 busywork。';
    } else {
      verdictClause = '·按 ccm estimate 评估为 on-track（按期）';
      suffix = '无需特定动作，继续推进。';
    }
  }
  return `[临界路径周期提示] 当前临界路径：${done}/${chain.length} 关键任务已完成${verdictClause}。${suffix}这是周期性弱提示，最终调度仍由你拍。`;
}

function system(message) {
  process.stdout.write(`${JSON.stringify({ kind: 'system', message })}\n`);
}

// PARITY: rule-identity-nudge-tag-protocol — ADR-018 标签协议在 codex 侧的本地等价包装（无共享 hook-common
// 可 require，故本文件本地复刻；与 claude-code identity-nudge.js 的 advisory('identity-nudge'|'critpath-nudge',
// 'weak', body) 语义一致——两条周期提示都是 weak advisory：可合理忽略，但默认应顺手权衡）。
function advisory(source, strength, body) {
  const s = strength === 'strong' ? 'strong' : 'weak';
  return `<advisory source="${source}" strength="${s}">\n${String(body)}\n</advisory>`;
}

function main() {
  const payload = readJson();
  if (payload.event !== 'stop') return;
  if (payload.raw && payload.raw.stop_hook_active === true) return;
  const sessionId = payload.session && payload.session.id ? payload.session.id : '';
  const home = resolveHome(process.env);
  const boards = listBoards(home, sessionId);
  if (boards.length !== 1) return;
  const { board, path: boardPath } = boards[0];
  const nowMs = process.env.CC_MASTER_NOW ? parseIsoMs(process.env.CC_MASTER_NOW) : Date.now();
  if (nowMs === null) return;
  const nowIso = isoNow(nowMs);
  const messages = [];

  if (due(board, 'last_identity_remind', nowMs, intervalSec(process.env.CC_MASTER_IDNUDGE_INTERVAL_SEC, DEFAULT_IDENTITY_INTERVAL_SEC))) {
    if (setParam(home, boardPath, 'last_identity_remind', nowIso)) {
      messages.push(advisory('identity-nudge', 'weak', IDENTITY_TEXT));
    }
  }
  // PARITY: rule-identity-nudge-goal-cadence
  if (board.goal_contract && board.goal_contract.schema === 'ccm/goal-contract/v1' &&
      due(board, 'last_goal_remind', nowMs, intervalSec(process.env.CC_MASTER_GOAL_REMIND_INTERVAL_SEC, DEFAULT_GOAL_INTERVAL_SEC))) {
    if (setParam(home, boardPath, 'last_goal_remind', nowIso)) {
      const text = goalText(board);
      if (text) messages.push(advisory('goal-alignment-nudge', 'weak', text));
    }
  }
  if (due(board, 'last_critpath_remind', nowMs, intervalSec(process.env.CC_MASTER_CRITPATH_INTERVAL_SEC, DEFAULT_CRITPATH_INTERVAL_SEC))) {
    if (setParam(home, boardPath, 'last_critpath_remind', nowIso)) {
      const text = critpathText(board, boardPath, home);
      if (text) messages.push(advisory('critpath-nudge', 'weak', text));
    }
  }
  if (messages.length > 0) system(messages.join('\n'));
}

try {
  main();
} catch {
  process.exit(0);
}
