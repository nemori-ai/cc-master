#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function readJson() {
  const raw = fs.readFileSync(0, 'utf8');
  return raw ? JSON.parse(raw) : {};
}

function resolveHome(env) {
  return env.CC_MASTER_HOME || path.join(env.HOME || os.homedir(), '.cc_master');
}

function boardsDir(home) {
  return path.join(home, 'boards');
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
  const dir = boardsDir(home);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const boards = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.board.json')) continue;
    const boardPath = path.join(dir, entry.name);
    let board;
    try {
      board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
    } catch {
      continue;
    }
    if (boardMatches(board, sessionId)) {
      boards.push({ name: entry.name, path: boardPath, board });
    }
  }
  return boards.sort((a, b) => a.name.localeCompare(b.name));
}

function emitContext(context) {
  process.stdout.write(`${JSON.stringify({ kind: 'context', context })}\n`);
}

function goalLabel(board) {
  const goal = typeof board.goal === 'string' && board.goal ? board.goal : '(goal not recorded yet)';
  const contract = board.goal_contract;
  if (!contract || typeof contract !== 'object' || contract.schema !== 'ccm/goal-contract/v1') return `legacy: ${goal}`;
  return `r${contract.revision || '?'} ${contract.assurance || 'unknown'}: ${goal}`;
}

function goalCheck(boardPath, home) {
  try {
    const result = spawnSync(process.env.CCM_BIN || 'ccm', ['goal', 'check', '--board', boardPath, '--json', '--no-input'], {
      encoding: 'utf8', timeout: 10000, env: { ...process.env, CC_MASTER_HOME: home },
    });
    if (!result || result.error || result.signal || result.status !== 0) return { verdict: 'check_unavailable' };
    const parsed = JSON.parse(result.stdout || '{}');
    return parsed && parsed.ok === true && parsed.data ? parsed.data : { verdict: 'check_unavailable' };
  } catch (_) {
    return { verdict: 'check_unavailable' };
  }
}

function main() {
  const payload = readJson();
  const event = String(payload.event || payload.hook_event_name || '').toLowerCase();
  if (event !== 'session-start' && event !== 'sessionstart') return;
  const sessionId = payload.session && payload.session.id ? payload.session.id : '';
  const home = resolveHome(process.env);
  const boards = listMatchingBoards(home, sessionId);
  if (boards.length === 0) return;

  let listing = '';
  const dangling = [];
  const emptyBoards = [];
  const goalStops = [];
  for (const { name, path: boardPath, board } of boards) {
    const label = goalLabel(board);
    listing += ` • ${name} [${label}]`;
    const tasks = Array.isArray(board.tasks) ? board.tasks : [];
    const hasContract = !!(board.goal_contract && board.goal_contract.schema === 'ccm/goal-contract/v1');
    if (hasContract) {
      const check = goalCheck(boardPath, home);
      if (check.verdict !== 'ok') goalStops.push(`${name} [${label}] verdict=${check.verdict || 'malformed'}`);
    }
    if (tasks.length === 0) emptyBoards.push({ text: `${name} [${label}]`, pending: hasContract && board.goal_contract.assurance === 'pending' });
    for (const task of tasks) {
      if (!task || typeof task !== 'object' || Array.isArray(task)) continue;
      if (task.status !== 'stale' && task.status !== 'escalated') continue;
      if (typeof task.id !== 'string' || !task.id) continue;
      const parent = typeof task.parent === 'string' && task.parent ? task.parent : '';
      dangling.push(parent ? `${task.id} (owner ${parent})` : task.id);
    }
  }

  let context = `You are a cc-master master orchestrator. Your orchestration board(s) live in ${boardsDir(home)}. Active:${listing}. ` +
    'Run ccm goal check for the board you are working on, read its current Goal Brief when present, then invoke the master-orchestrator-guide skill ' +
    'and continue the decision program. In Codex API/tool sessions, if you need subagent dispatch and the multi-agent tools are not visible, ' +
    'use tool_search to surface them before treating subagent dispatch as unavailable; once discovered, use multi_agent_v1.spawn_agent and record the returned handle. ' +
    'Do not restart work already done/verified; integrate any completed background results first.';

  // PARITY: rule-reinject-goal-integrity
  if (goalStops.length > 0) {
    context += ` HARD STOP: Goal Contract integrity/assurance requires reconciliation before dispatch: ${goalStops.join(', ')}. ` +
      'Use ccm goal show/check; refine with ccm goal set, or amend through ccm goal amend. Never bypass a bad Brief hash.';
  }

  // PARITY: rule-reinject-empty-board-hard-stop
  if (emptyBoards.length > 0) {
    const pending = emptyBoards.filter((entry) => entry.pending).map((entry) => entry.text);
    const settled = emptyBoards.filter((entry) => !entry.pending).map((entry) => entry.text);
    context += ` HARD STOP: active board(s) with zero tasks are not runnable orchestration DAGs: ${emptyBoards.map((entry) => entry.text).join(', ')}. `;
    if (pending.length) context += `Pending Goal Contract board(s) ${pending.join(', ')} must be clarified and persisted via ccm goal set, then pass ccm goal check before decomposition. `;
    if (settled.length) context += `For settled/legacy board(s) ${settled.join(', ')}, write tasks with acceptance criteria via ccm task add. `;
    context += 'Do not treat an armed empty board as permission to proceed.';
  }

  // PARITY: rule-reinject-dangling-nodes
  if (dangling.length > 0) {
    context += ` Note on resume: your board has unresolved node(s) needing attention — stale/escalated: ${dangling.join(', ')}. ` +
      'Reconcile these (re-run stale, re-altitude escalated) before scheduling new work.';
  }

  emitContext(context);
}

try {
  main();
} catch {
  process.exit(0);
}
