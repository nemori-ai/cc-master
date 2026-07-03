#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

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
  for (const { name, board } of boards) {
    const goal = typeof board.goal === 'string' && board.goal ? board.goal : '(goal not recorded yet)';
    listing += ` • ${name} [${goal}]`;
    const tasks = Array.isArray(board.tasks) ? board.tasks : [];
    if (tasks.length === 0) emptyBoards.push(`${name} [${goal}]`);
    for (const task of tasks) {
      if (!task || typeof task !== 'object' || Array.isArray(task)) continue;
      if (task.status !== 'stale' && task.status !== 'escalated') continue;
      if (typeof task.id !== 'string' || !task.id) continue;
      const parent = typeof task.parent === 'string' && task.parent ? task.parent : '';
      dangling.push(parent ? `${task.id} (owner ${parent})` : task.id);
    }
  }

  let context = `You are a cc-master master orchestrator. Your orchestration board(s) live in ${boardsDir(home)}. Active:${listing}. ` +
    'Re-read the board for the task you are working on (recognise it by its goal), then invoke the master-orchestrator-guide skill ' +
    'and continue the decision program. Do not restart work already done/verified; integrate any completed background results first.';

  if (emptyBoards.length > 0) {
    context += ` HARD STOP: active board(s) with zero tasks are not runnable orchestration DAGs: ${emptyBoards.join(', ')}. ` +
      'Before any implementation, tests, git, push, or PR work, decompose the goal and write tasks with acceptance criteria via ccm task add. ' +
      'Do not treat an armed empty board as permission to proceed.';
  }

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
