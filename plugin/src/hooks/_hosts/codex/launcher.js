#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function resolveHookDiagEnabled() {
  return process.env.CC_MASTER_HOOK_DIAGNOSTIC === '1' || !!process.env.CC_MASTER_HOOK_DIAGNOSTIC_DIR;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function writeDiagnostic(fileBaseDir, payload) {
  if (!resolveHookDiagEnabled() || !fileBaseDir) return;
  let baseDir = process.env.CC_MASTER_HOOK_DIAGNOSTIC_DIR;
  if (!baseDir) baseDir = path.join(fileBaseDir, 'hooks', 'diagnostics');
  try {
    fs.mkdirSync(baseDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(baseDir, `${stamp}-${process.pid}.json`);
    const output = {
      ...payload,
      wrote_at: new Date().toISOString(),
    };
    fs.writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
  } catch {
    // Intentionally swallow diagnostics failures to avoid changing hook behavior.
  }
}

function parseArgs(argv) {
  const args = { core: '', event: '', echo: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--core') {
      args.core = argv[++i] || '';
    } else if (arg === '--event') {
      args.event = argv[++i] || '';
    } else if (arg === '--echo-normalized') {
      args.echo = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function eventName(rawEvent) {
  const value = String(rawEvent || '');
  const explicit = {
    UserPromptSubmit: 'user-prompt-submit',
    SessionStart: 'session-start',
    PreToolUse: 'pre-tool-use',
    PostToolUse: 'post-tool-use',
    Stop: 'stop',
    SubagentStart: 'subagent-start',
    SubagentStop: 'subagent-stop',
  };
  if (explicit[value]) return explicit[value];
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

function resolvePluginRoot() {
  const fromEnv = process.env.CC_MASTER_PLUGIN_ROOT || process.env.PLUGIN_ROOT || '';
  if (path.isAbsolute(fromEnv)) return fromEnv;
  return path.resolve(__dirname, '..', '..');
}

function resolveHome() {
  return process.env.CC_MASTER_HOME || path.join(process.env.HOME || '', '.cc_master');
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
  if (!state || state.harness !== 'codex' || state.session_id !== sessionId || typeof state.board_path !== 'string') {
    return null;
  }
  const boardPath = path.resolve(state.board_path);
  const boardsDir = path.resolve(path.join(home, 'boards'));
  if (!boardPath.startsWith(`${boardsDir}${path.sep}`) || !boardPath.endsWith('.board.json')) return null;
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
    const boardPath = path.join(boardsDir, entry.name);
    const board = readBoard(boardPath);
    if (boardMatches(board, sessionId)) matches.push({ path: boardPath, board, source: 'board-scan' });
  }
  matches.sort((a, b) => a.path.localeCompare(b.path));
  return matches.length === 1 ? matches[0] : null;
}

function normalize(raw, fallbackEvent) {
  const hostEvent = raw && raw.hook_event_name ? raw.hook_event_name : fallbackEvent;
  const event = eventName(hostEvent);
  const sessionId = raw && raw.session_id ? String(raw.session_id) : '';
  const toolName = raw && raw.tool_name ? String(raw.tool_name) : '';
  const normalized = {
    harness: 'codex',
    event,
    session: {
      id: sessionId,
      role: 'unknown',
    },
    raw: raw || {},
    host: {
      eventName: hostEvent || '',
    },
  };
  if (toolName) {
    normalized.tool = {
      name: toolName,
      input: raw.tool_input || {},
      response: raw.tool_response,
      id: raw.tool_use_id ? String(raw.tool_use_id) : '',
    };
  }
  if (raw && typeof raw.prompt === 'string') {
    normalized.prompt = { text: raw.prompt };
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

function emitHostResult(result, event, hostEventName) {
  const kind = result && result.kind ? result.kind : 'silent';
  if (kind === 'silent' || kind === 'allow') return;
  const message = String(result.context || result.message || '');
  if (!message) return;
  if (kind === 'block') {
    if (event === 'pre-tool-use') {
      process.stdout.write(`${JSON.stringify({ decision: 'block', reason: message })}\n`);
    } else {
      process.stdout.write(`${JSON.stringify({ systemMessage: message })}\n`);
    }
    return;
  }
  if (kind === 'system') {
    process.stdout.write(`${JSON.stringify({ systemMessage: message })}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({
      hookSpecificOutput: {
      hookEventName: result.hookEventName || result.hostEventName || hostEventName || '',
      additionalContext: message,
    },
  })}\n`);
}

function main() {
  const args = parseArgs(process.argv);
  const stdin = readStdin();
  let raw = {};
  let rawParseError = '';
  try {
    raw = stdin ? JSON.parse(stdin) : {};
  } catch (error) {
    rawParseError = error && error.message ? error.message : String(error);
  }
  const normalized = normalize(raw, args.event);
  const pluginRoot = resolvePluginRoot();
  const home = resolveHome();
  const activeBoard = discoverActiveBoard(home, normalized.session.id);
  if (activeBoard) {
    normalized.board = {
      path: activeBoard.path,
      stem: boardStem(activeBoard.path),
      source: activeBoard.source,
    };
  }
  const env = {
    ...process.env,
    CC_MASTER_HARNESS: 'codex',
    CC_MASTER_HOOK_EVENT: normalized.event,
    CC_MASTER_SESSION_ID: normalized.session.id,
    CC_MASTER_AGENT_ROLE: normalized.session.role,
    CC_MASTER_HOME: home,
    CC_MASTER_PLUGIN_ROOT: pluginRoot,
    ...(activeBoard
      ? {
          CC_MASTER_BOARD: activeBoard.path,
          CC_MASTER_BOARD_STEM: boardStem(activeBoard.path),
          CC_MASTER_BOARD_SOURCE: activeBoard.source,
        }
      : {}),
  };

  if (args.echo) {
    process.stdout.write(`${JSON.stringify({ env: {
      CC_MASTER_HARNESS: env.CC_MASTER_HARNESS,
      CC_MASTER_HOOK_EVENT: env.CC_MASTER_HOOK_EVENT,
      CC_MASTER_SESSION_ID: env.CC_MASTER_SESSION_ID,
      CC_MASTER_AGENT_ROLE: env.CC_MASTER_AGENT_ROLE,
      CC_MASTER_HOME: env.CC_MASTER_HOME,
      CC_MASTER_PLUGIN_ROOT: env.CC_MASTER_PLUGIN_ROOT,
      CC_MASTER_BOARD: env.CC_MASTER_BOARD || '',
      CC_MASTER_BOARD_STEM: env.CC_MASTER_BOARD_STEM || '',
      CC_MASTER_BOARD_SOURCE: env.CC_MASTER_BOARD_SOURCE || '',
    }, payload: normalized }, null, 2)}\n`);
    return;
  }

  if (!args.core) return;
  let child;
  try {
    child = spawnSync(args.core, {
      input: `${JSON.stringify(normalized)}\n`,
      encoding: 'utf8',
      env,
      shell: false,
    });
    if (child.stderr) process.stderr.write(child.stderr);
    if (child.error) {
      if (normalized.event === 'stop') {
        process.stderr.write(`cc-master codex hook launcher: core error on Stop: ${child.error.message || String(child.error)}\n`);
        return;
      }
      throw child.error;
    }
    const result = parseCoreResult(child.stdout);
    emitHostResult(result, normalized.event, normalized.host && normalized.host.eventName);
    if (child.status && child.status !== 0) {
      // Stop hooks are advisory in Codex. We never re-enter on advisory stop,
      // so any non-zero from a Stop core should not fail the session.
      if (normalized.event === 'stop') return;
      process.exit(child.status);
    }
  } finally {
    const coreStdout = child && typeof child.stdout === 'string' ? child.stdout : '';
    const coreStderr = child && typeof child.stderr === 'string' ? child.stderr : '';
    const coreStatus = child && Number.isInteger(child.status) ? child.status : null;
    const coreSignal = child && child.signal ? child.signal : null;
    const coreError = child && child.error ? (child.error.message || String(child.error)) : '';
    writeDiagnostic(home, {
      invocation: {
        event: args.event,
        eventNormalized: normalized.event,
        hostEventName: normalized.host && normalized.host.eventName,
        core: args.core,
        pluginRoot,
        board: activeBoard
          ? {
              path: activeBoard.path,
              stem: activeBoard.stem,
              source: activeBoard.source,
            }
          : null,
      },
      env: {
        CC_MASTER_HOOK_EVENT: env.CC_MASTER_HOOK_EVENT,
        CC_MASTER_SESSION_ID: env.CC_MASTER_SESSION_ID,
        CC_MASTER_AGENT_ROLE: env.CC_MASTER_AGENT_ROLE,
        CC_MASTER_HOME: env.CC_MASTER_HOME,
        CC_MASTER_PLUGIN_ROOT: env.CC_MASTER_PLUGIN_ROOT,
      },
      stdin_text: stdin,
      raw_parse_error: rawParseError,
      payload_raw: raw,
      payload_normalized: normalized,
      core: {
        status: coreStatus,
        signal: coreSignal,
        error: coreError,
        stdout: coreStdout,
        stderr: coreStderr,
      },
    });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`cc-master codex hook launcher: ${error && error.message ? error.message : String(error)}\n`);
  process.exit(2);
}
