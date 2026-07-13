#!/usr/bin/env node
/**
 * Cursor host launcher (Phase C).
 * Parse Cursor stdin → normalize → spawn *-core.js → emit Cursor envelope.
 * Path root: __dirname → plugin root (probe D1: no PLUGIN_ROOT token assumed).
 * Layout: hooks/_hosts/cursor/launcher.js → plugin root is ../../..
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function parseArgs(argv) {
  const args = { core: '', event: '', echo: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--core') args.core = argv[++i] || '';
    else if (arg === '--event') args.event = argv[++i] || '';
    else if (arg === '--echo-normalized') args.echo = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function eventName(rawEvent) {
  const value = String(rawEvent || '');
  const explicit = {
    beforeSubmitPrompt: 'user-prompt-submit',
    sessionStart: 'session-start',
    preToolUse: 'pre-tool-use',
    postToolUse: 'post-tool-use',
    stop: 'stop',
    preCompact: 'pre-compact',
    subagentStart: 'subagent-start',
    subagentStop: 'subagent-stop',
  };
  if (explicit[value]) return explicit[value];
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

function resolvePluginRoot() {
  const fromEnv = process.env.CC_MASTER_PLUGIN_ROOT || '';
  if (path.isAbsolute(fromEnv)) return fromEnv;
  // launcher lives at hooks/_hosts/cursor/launcher.js → plugin root is ../../..
  return path.resolve(__dirname, '..', '..', '..');
}

function resolveHome() {
  const cwd = process.cwd();
  if (process.env.CC_MASTER_HOME) return path.resolve(cwd, process.env.CC_MASTER_HOME);
  return path.resolve(cwd, process.env.HOME || os.homedir(), '.cc_master');
}

function boardStem(boardPath) {
  return path.basename(boardPath).replace(/\.board\.json$/i, '');
}

function boardMatches(board, sessionId) {
  const owner = board && typeof board === 'object' && board.owner && typeof board.owner === 'object' ? board.owner : {};
  if (owner.active !== true) return false;
  if (!sessionId) return true;
  return owner.session_id === sessionId;
}

function readBoard(boardPath) {
  try {
    return JSON.parse(fs.readFileSync(boardPath, 'utf8'));
  } catch {
    return null;
  }
}

function containedBoardPath(home, candidate) {
  try {
    const boardsDir = fs.realpathSync(path.join(home, 'boards'));
    if (!fs.statSync(boardsDir).isDirectory()) return '';
    const lexical = path.resolve(candidate);
    if (!lexical.endsWith('.board.json') || !fs.lstatSync(lexical).isFile()) return '';
    const real = fs.realpathSync(lexical);
    if (!real.startsWith(`${boardsDir}${path.sep}`) || !fs.statSync(real).isFile()) return '';
    return real;
  } catch {
    return '';
  }
}

function sessionStatePath(home, sessionId) {
  if (!sessionId) return '';
  const safe = encodeURIComponent(sessionId).replace(/%/g, '_');
  return path.join(home, 'sessions', `${safe}.json`);
}

function boardFromSessionState(home, sessionId) {
  const statePath = sessionStatePath(home, sessionId);
  if (!statePath || !fs.existsSync(statePath)) return null;
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
  if (!state || state.harness !== 'cursor' || state.session_id !== sessionId || typeof state.board_path !== 'string') {
    return null;
  }
  const boardPath = containedBoardPath(home, state.board_path);
  if (!boardPath) return null;
  const board = readBoard(boardPath);
  if (!boardMatches(board, sessionId)) return null;
  return { path: boardPath, board, source: 'session-state' };
}

function discoverActiveBoard(home, sessionId) {
  const fromState = boardFromSessionState(home, sessionId);
  if (fromState) return fromState;
  const boardsDir = path.join(home, 'boards');
  let entries;
  try {
    entries = fs.readdirSync(boardsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const matches = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.board.json')) continue;
    const boardPath = containedBoardPath(home, path.join(boardsDir, entry.name));
    if (!boardPath) continue;
    const board = readBoard(boardPath);
    if (boardMatches(board, sessionId)) matches.push({ path: boardPath, board, source: 'board-scan' });
  }
  matches.sort((a, b) => a.path.localeCompare(b.path));
  return matches.length === 1 ? matches[0] : null;
}

function normalize(raw, fallbackEvent) {
  const hostEvent = (raw && raw.hook_event_name) || fallbackEvent || '';
  const event = eventName(hostEvent);
  // Probe D7/D8: conversation_id == session_id; prefer conversation_id.
  const sessionId = String((raw && (raw.conversation_id || raw.session_id)) || '');
  const toolName = raw && raw.tool_name ? String(raw.tool_name) : '';
  const normalized = {
    harness: 'cursor',
    event,
    session: { id: sessionId, role: 'unknown' },
    raw: raw || {},
    host: { eventName: hostEvent },
  };
  if (toolName) {
    normalized.tool = {
      name: toolName,
      input: raw.tool_input || {},
      response: raw.tool_output,
      id: raw.tool_use_id ? String(raw.tool_use_id) : '',
    };
  }
  if (raw && typeof raw.prompt === 'string') {
    normalized.prompt = { text: raw.prompt };
  }
  if (raw && typeof raw.loop_count === 'number') {
    normalized.loop_count = raw.loop_count;
  }
  return normalized;
}

function parseCoreResult(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { kind: 'silent' };
  try {
    return JSON.parse(trimmed);
  } catch {
    return { kind: 'context', context: trimmed };
  }
}

function emitHostResult(result, event) {
  const kind = result && result.kind ? result.kind : 'silent';
  if (kind === 'silent' || kind === 'allow') return;
  const message = String(result.context || result.message || result.followup_message || '');
  if (!message) return;

  // Event-scoped envelope mapping — SSOT: ENVELOPE.md
  if (event === 'stop') {
    process.stdout.write(`${JSON.stringify({ followup_message: message })}\n`);
    return;
  }
  if (kind === 'block' || kind === 'deny') {
    if (event === 'pre-tool-use') {
      process.stdout.write(`${JSON.stringify({ permission: 'deny', user_message: message || 'denied' })}\n`);
    } else if (event === 'user-prompt-submit') {
      process.stdout.write(`${JSON.stringify({ continue: false, user_message: message || 'blocked' })}\n`);
    }
    return;
  }
  if (kind === 'followup') {
    if (event === 'user-prompt-submit') {
      process.stdout.write(`${JSON.stringify({ continue: true, user_message: message })}\n`);
    }
    return;
  }
  if (kind === 'context' || kind === 'system') {
    if (event === 'user-prompt-submit') {
      process.stdout.write(`${JSON.stringify({ continue: true, user_message: message })}\n`);
    } else if (event === 'post-tool-use') {
      process.stdout.write(`${JSON.stringify({ additional_context: message })}\n`);
    }
  }
}

function resolveCorePath(pluginRoot, coreArg) {
  if (!coreArg) throw new Error('missing --core');
  if (path.isAbsolute(coreArg)) return coreArg;
  return path.resolve(pluginRoot, coreArg.replace(/^\.\//, ''));
}

function main() {
  const args = parseArgs(process.argv);
  const stdin = readStdin();
  let raw = {};
  try {
    raw = stdin ? JSON.parse(stdin) : {};
  } catch {
    raw = {};
  }
  const normalized = normalize(raw, args.event);
  const pluginRoot = resolvePluginRoot();
  const home = resolveHome();
  const activeBoard = discoverActiveBoard(home, normalized.session.id);
  if (activeBoard) {
    normalized.board = {
      path: activeBoard.path,
      stem: boardStem(activeBoard.path),
      source: activeBoard.source || 'board-scan',
    };
  }

  const env = {
    ...process.env,
    CC_MASTER_HARNESS: 'cursor',
    CC_MASTER_HOOK_EVENT: normalized.event,
    CC_MASTER_SESSION_ID: normalized.session.id,
    CC_MASTER_PLUGIN_ROOT: pluginRoot,
    CC_MASTER_HOME: home,
  };
  if (activeBoard) {
    env.CC_MASTER_BOARD = activeBoard.path;
    env.CC_MASTER_BOARD_STEM = boardStem(activeBoard.path);
    env.CC_MASTER_BOARD_SOURCE = activeBoard.source || 'board-scan';
  }

  if (args.echo) {
    process.stdout.write(`${JSON.stringify({
      env: {
        CC_MASTER_HARNESS: env.CC_MASTER_HARNESS,
        CC_MASTER_HOOK_EVENT: env.CC_MASTER_HOOK_EVENT,
        CC_MASTER_SESSION_ID: env.CC_MASTER_SESSION_ID,
        CC_MASTER_HOME: env.CC_MASTER_HOME,
        CC_MASTER_PLUGIN_ROOT: env.CC_MASTER_PLUGIN_ROOT,
        CC_MASTER_BOARD: env.CC_MASTER_BOARD || '',
        CC_MASTER_BOARD_STEM: env.CC_MASTER_BOARD_STEM || '',
        CC_MASTER_BOARD_SOURCE: env.CC_MASTER_BOARD_SOURCE || '',
      },
      payload: normalized,
    }, null, 2)}\n`);
    return;
  }

  if (!args.core) return;
  const corePath = resolveCorePath(pluginRoot, args.core);

  if (!fs.existsSync(corePath)) {
    // Fail-open: missing core must not block the agent (scaffold / partial install).
    return;
  }

  const spawned = spawnSync(process.execPath, [corePath], {
    input: `${JSON.stringify(normalized)}\n`,
    encoding: 'utf8',
    env,
    cwd: pluginRoot,
  });

  if (spawned.error || (spawned.status !== 0 && spawned.status !== null)) {
    // Fail-open on core crash (except intentional exit 2 deny — map if stderr present).
    if (spawned.status === 2 && normalized.event === 'pre-tool-use') {
      process.stdout.write(`${JSON.stringify({ permission: 'deny', user_message: String(spawned.stderr || 'denied') })}\n`);
    }
    return;
  }

  emitHostResult(parseCoreResult(spawned.stdout), normalized.event);
}

try {
  main();
} catch {
  // Fail-open: never crash the Cursor agent loop from launcher bugs.
}
