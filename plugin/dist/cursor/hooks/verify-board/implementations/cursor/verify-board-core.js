#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// CCM_BIN：dev/test/自定义安装的覆写口（绝对路径可执行）；缺则用 PATH 上的 `ccm`（生产）。
const CCM_BIN = process.env.CCM_BIN || 'ccm';

// PARITY: rule-verify-board-tag-protocol — ADR-018 标签协议在 cursor 侧的本地等价包装（无共享 hook-common
// 可 require，故本文件本地复刻，与 claude-code verify-board.js 的 directive/advisory 语义一致）。
function directive(source, body) {
  return `<directive source="${source}">\n${String(body)}\n</directive>`;
}
function advisory(source, strength, body) {
  const s = strength === 'strong' ? 'strong' : 'weak';
  return `<advisory source="${source}" strength="${s}">\n${String(body)}\n</advisory>`;
}

// PARITY: rule-verify-board-fuse — 防死循环保险丝。与 claude-code / codex verify-board 语义一致：
// 会话级连续 block 计数，达阈值即强制放行 + strong advisory。Cursor Stop 无 decision:block，
// launcher 把 kind:block 映射为 followup_message；FUSE + stop_allow_until 是补偿链（ADR-031 Track B）。
const FUSE = 5;
function fuseSidecarPath(home, sessionId) {
  const name = sessionId ? `.cursor-${sessionId}.stopfuse` : '.cursor-nosession.stopfuse';
  return path.join(home, name);
}
function readFuseStreak(scPath) {
  try {
    const raw = fs.readFileSync(scPath, 'utf8').trim();
    return /^[0-9]+$/.test(raw) ? parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}
function writeFuseStreak(scPath, n) {
  try {
    const tmp = `${scPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, String(n));
    fs.renameSync(tmp, scPath);
  } catch {
    /* best-effort sidecar write; failure just means fuse won't advance this round */
  }
}
function clearFuseStreak(scPath) {
  try {
    fs.unlinkSync(scPath);
  } catch {
    /* not present is fine */
  }
}

// rollupOwnersViaCcm(boardPath) → Set<ownerId> | null。PARITY: rule-verify-board-rollup-check（HOOKPAR-DEC
// 分叉修复：codex 侧此前完全缺失，见 §2.2）。与 claude-code verify-board.js 的 rollupOwnersViaCcm 同语义：
// spawn `ccm board lint --board <path> --json`，取 GRAPH-ROLLUP violations 的 owner 集；ccm 不可用/非 JSON/
// 形状不符 → null（调用方跳过本板 rollup part，其余 Stop gate 逻辑照走·优雅降级）。
function rollupOwnersViaCcm(boardPath) {
  let r;
  try {
    r = spawnSync(CCM_BIN, ['board', 'lint', '--board', boardPath, '--json'], {
      encoding: 'utf8',
      timeout: 15000,
    });
  } catch {
    return null;
  }
  if (!r || r.error || r.signal) return null;
  let parsed;
  try {
    parsed = JSON.parse(typeof r.stdout === 'string' ? r.stdout : '');
  } catch {
    return null;
  }
  const data = parsed && typeof parsed === 'object' ? parsed.data : null;
  if (!data || typeof data !== 'object' || !Array.isArray(data.violations)) return null;
  const owners = new Set();
  for (const v of data.violations) {
    if (v && v.rule === 'GRAPH-ROLLUP' && typeof v.task === 'string' && v.task !== '') owners.add(v.task);
  }
  return owners;
}

// PARITY: rule-verify-board-goal-integrity
function goalCheckViaCcm(boardPath, home, board) {
  const contract = board && board.goal_contract;
  if (!contract) return { verdict: 'legacy' };
  if (typeof contract !== 'object' || contract.schema !== 'ccm/goal-contract/v1') return { verdict: 'malformed' };
  try {
    const result = spawnSync(CCM_BIN, ['goal', 'check', '--board', boardPath, '--json', '--no-input'], {
      encoding: 'utf8', timeout: 15000, env: { ...process.env, CC_MASTER_HOME: home },
    });
    if (!result || result.error || result.signal || result.status !== 0) return { verdict: 'check_unavailable' };
    const parsed = JSON.parse(result.stdout || '{}');
    return parsed && parsed.ok === true && parsed.data ? parsed.data : { verdict: 'malformed' };
  } catch {
    return { verdict: 'check_unavailable' };
  }
}

function completePendingDecision(task) {
  if (!task || task.status !== 'blocked' || task.blocked_on !== 'user') return false;
  const dp = task.decision_package;
  if (!dp || typeof dp !== 'object' || Array.isArray(dp)) return false;
  const required = ['context_md', 'what_i_need', 'ask_type', 'inputs_hash', 'enter_cmd'];
  if (!required.every((key) => typeof dp[key] === 'string' && dp[key].trim() !== '')) return false;
  if (!/^sha256:[0-9a-f]{64}$/.test(dp.inputs_hash)) return false;
  return dp.ask_type !== 'decision' || (Array.isArray(dp.options) && dp.options.length > 0);
}

function readJson() {
  const raw = fs.readFileSync(0, 'utf8');
  return raw ? JSON.parse(raw) : {};
}

function resolveHome(env) {
  return env.CC_MASTER_HOME || path.join(env.HOME || os.homedir(), '.cc_master');
}

function boardMatches(board, sessionId) {
  const owner = board && typeof board === 'object' && board.owner && typeof board.owner === 'object'
    ? board.owner
    : {};
  if (owner.active !== true) return false;
  if (!sessionId) return true;
  return owner.session_id === sessionId;
}

function listMatchingBoards(home, sessionId) {
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
    if (boardMatches(board, sessionId)) out.push({ name: entry.name, path: boardPath, board });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function watchdogArmed(board) {
  const wd = board && typeof board === 'object'
    ? (board.watchdog === undefined || board.watchdog === null ? board.wakeup : board.watchdog)
    : null;
  if (!wd || typeof wd !== 'object' || Array.isArray(wd)) return false;
  if (typeof wd.job_id !== 'string' || wd.job_id.trim() === '') return false;
  const fireAt = typeof wd.fire_at === 'string' ? wd.fire_at : '';
  if (!fireAt) return true;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(fireAt)) return true;
  return fireAt >= new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function system(message) {
  process.stdout.write(`${JSON.stringify({ kind: 'system', message })}\n`);
}

function block(message) {
  process.stdout.write(`${JSON.stringify({ kind: 'block', message: directive('verify-board', message) })}\n`);
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function stopAllowed(board) {
  const runtime = board && typeof board === 'object' && board.runtime && typeof board.runtime === 'object' && !Array.isArray(board.runtime)
    ? board.runtime
    : {};
  const until = typeof runtime.stop_allow_until === 'string' ? runtime.stop_allow_until : '';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(until)) return false;
  return until >= nowIso();
}

function releaseHint(boardPath) {
  return `If you have independently verified this board may stop, first run: ccm board set-param stop_allow_until <future-ISO-UTC> --board ${boardPath}`;
}

function main() {
  const payload = readJson();
  if (payload.event !== 'stop') return;
  const sessionId = payload.session && payload.session.id ? payload.session.id : '';
  const home = resolveHome(process.env);
  const boards = listMatchingBoards(home, sessionId);
  if (boards.length === 0) return;

  const notes = [];
  for (const { name, path: boardPath, board } of boards) {
    const goal = typeof board.goal === 'string' && board.goal ? board.goal : '(goal not recorded yet)';
    const hint = releaseHint(boardPath);
    const tasks = Array.isArray(board.tasks)
      ? board.tasks.filter((task) => task && typeof task === 'object' && !Array.isArray(task) && typeof task.id === 'string' && task.id)
      : [];
    const goalState = goalCheckViaCcm(boardPath, home, board);
    if (!['ok', 'legacy', 'pending'].includes(goalState.verdict)) {
      notes.push(`${name} [${goal}]: Goal Contract integrity check failed (${goalState.verdict || 'malformed'}); run ccm goal check/show and restore or explicitly amend the contract. ${hint}.`);
      continue;
    }
    const pendingDecisionOnly = goalState.verdict === 'pending' && tasks.length > 0 &&
      tasks.every(completePendingDecision);
    if (pendingDecisionOnly) continue;
    if (goalState.verdict === 'pending') {
      notes.push(`${name} [${goal}]: Goal Contract is pending; refine it with ccm goal set or surface a complete blocked_on:"user" decision_package, then pass ccm goal check. ${hint}.`);
      continue;
    }
    if (stopAllowed(board)) continue;
    if (tasks.length === 0) {
      notes.push(`${name} [${goal}]: active board has no tasks; decompose the goal into tasks before treating it as complete. ${hint}.`);
      continue;
    }

    const ready = tasks.filter((task) => task.status === 'ready').map((task) => task.id);
    const uncertain = tasks.filter((task) => task.status === 'uncertain').map((task) => task.id);
    const userBlocked = tasks
      .filter((task) => task.status === 'blocked' && task.blocked_on === 'user')
      .map((task) => (typeof task.title === 'string' && task.title ? task.title : task.id));
    const inFlight = tasks.filter((task) => task.status === 'in_flight').map((task) => task.id);
    if (ready.length > 0) notes.push(`${name} [${goal}]: ready tasks remain: ${ready.join(', ')}. ${hint}.`);
    if (uncertain.length > 0) notes.push(`${name} [${goal}]: uncertain tasks need verification: ${uncertain.join(', ')}. ${hint}.`);
    if (userBlocked.length > 0) notes.push(`${name} [${goal}]: user decisions are still open: ${userBlocked.join(', ')}. ${hint}.`);
    if (inFlight.length > 0 && !watchdogArmed(board)) {
      notes.push(`${name} [${goal}]: in-flight tasks have no armed watchdog: ${inFlight.join(', ')}. ${hint}.`);
    }
    if (ready.length === 0 && uncertain.length === 0 && userBlocked.length === 0 && inFlight.length === 0) {
      const c = board.goal_contract;
      const revision = c && c.schema === 'ccm/goal-contract/v1' ? `r${c.revision || '?'} ${c.assurance || 'unknown'}` : 'legacy goal';
      notes.push(`${name} [${goal}]: before stopping, self-check local task acceptance and global acceptance against the current Goal Contract ${revision}; confirm no missing task remains outside the board. ${hint}.`);
    }

    // PARITY: rule-verify-board-rollup-check — owner done 而 child 未 done 的 rollup 不一致（SOFT 提醒，
    // 与 claude-code verify-board.js 同语义）。ccm 不可用 → 跳过本板 rollup part（优雅降级，其余 notes 照写）。
    const flaggedOwners = rollupOwnersViaCcm(boardPath);
    if (flaggedOwners !== null) {
      const rollupParts = [];
      for (const t of tasks) {
        const parent = typeof t.parent === 'string' ? t.parent : '';
        if (!parent || !flaggedOwners.has(parent)) continue;
        const childStatus = typeof t.status === 'string' ? t.status : '';
        if (childStatus === 'done') continue;
        rollupParts.push(`owner ${parent} is \`done\` but child ${t.id} is \`${childStatus}\``);
      }
      if (rollupParts.length) {
        notes.push(`${name} [${goal}]: rollup inconsistency (${rollupParts.join('; ')}): a parent (owner) node should NOT be \`done\` while a child under its \`parent\` is still unfinished. ${hint}.`);
      }
    }
  }

  if (notes.length === 0) {
    clearFuseStreak(fuseSidecarPath(home, sessionId));
    return;
  }

  // PARITY: rule-verify-board-fuse — 会话级连续 block 计数；达阈值强制放行 + strong advisory（不是 block），
  // 防止 Stop 门在判定持续为「需继续」时无限期卡住整个 session（与 claude-code verify-board.js 的 FUSE 同目标）。
  const fusePath = fuseSidecarPath(home, sessionId);
  const streak = readFuseStreak(fusePath) + 1;
  if (streak >= FUSE) {
    clearFuseStreak(fusePath);
    const warn = `cc-master: fuse tripped — blocked ${streak} times in a row. Releasing the stop. ` +
      'If you are stuck, check the board for a task that cannot actually proceed (mark it `blocked`/`escalated`) before continuing.';
    system(advisory('verify-board', 'strong', warn));
    return;
  }
  writeFuseStreak(fusePath, streak);
  block(`cc-master Cursor Stop continuation required:\n${notes.join('\n')}`);
}

try {
  main();
} catch {
  process.exit(0);
}
