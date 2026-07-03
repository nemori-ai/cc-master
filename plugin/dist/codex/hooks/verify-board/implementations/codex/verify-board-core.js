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
  const wd = board && typeof board === 'object' ? board.watchdog || board.wakeup : null;
  if (!wd || typeof wd !== 'object' || Array.isArray(wd)) return false;
  const fireAt = typeof wd.fire_at === 'string' ? wd.fire_at : '';
  if (!fireAt) return true;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(fireAt)) return true;
  return fireAt >= new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function system(message) {
  process.stdout.write(`${JSON.stringify({ kind: 'system', message })}\n`);
}

function block(message) {
  process.stdout.write(`${JSON.stringify({ kind: 'block', message })}\n`);
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
    if (stopAllowed(board)) continue;
    const goal = typeof board.goal === 'string' && board.goal ? board.goal : '(goal not recorded yet)';
    const hint = releaseHint(boardPath);
    const tasks = Array.isArray(board.tasks)
      ? board.tasks.filter((task) => task && typeof task === 'object' && !Array.isArray(task) && typeof task.id === 'string' && task.id)
      : [];
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
      notes.push(`${name} [${goal}]: before stopping, self-check against the original goal and confirm no missing task remains outside the board. ${hint}.`);
    }
  }

  if (notes.length === 0) return;
  block(`cc-master Codex Stop continuation required:\n${notes.join('\n')}`);
}

try {
  main();
} catch {
  process.exit(0);
}
