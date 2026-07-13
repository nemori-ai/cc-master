#!/usr/bin/env node
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIAGNOSTIC_TEXT_LIMIT = 4096;
const DIAGNOSTIC_RAW_LIMIT = 16384;

function resolveHookDiagEnabled() {
  return process.env.CC_MASTER_HOOK_DIAGNOSTIC === '1' || !!process.env.CC_MASTER_HOOK_DIAGNOSTIC_DIR;
}

function resolveHookDiagUnsafeRawEnabled() {
  return process.env.CC_MASTER_HOOK_DIAGNOSTIC_UNSAFE_RAW === '1';
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function utf8ByteLength(text) {
  return Buffer.byteLength(String(text || ''), 'utf8');
}

function truncateText(text, limit) {
  const value = String(text || '');
  if (value.length <= limit) return { text: value, truncated: false, chars: value.length, bytes: utf8ByteLength(value) };
  const truncated = value.slice(0, limit);
  return {
    text: truncated,
    truncated: true,
    chars: value.length,
    bytes: utf8ByteLength(value),
    preview_chars: truncated.length,
    preview_bytes: utf8ByteLength(truncated),
  };
}

function redactSensitiveText(text) {
  return String(text || '')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"',}]+/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[REDACTED]')
    .replace(/\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{8,}\b/g, '[REDACTED]')
    .replace(/\b([A-Za-z0-9_ -]*(?:password|passwd|token|api[_-]?key|secret)[A-Za-z0-9_ -]*\s*[:=]\s*)[^\s"',}]+/gi, '$1[REDACTED]')
    .replace(/("(?:password|passwd|token|api[_-]?key|secret|authorization)"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2');
}

function summarizeText(text, limit = DIAGNOSTIC_TEXT_LIMIT) {
  const value = String(text || '');
  const redacted = redactSensitiveText(value);
  const truncated = truncateText(redacted, limit);
  return {
    bytes: utf8ByteLength(value),
    chars: value.length,
    sha256: sha256Text(value),
    truncated: truncated.truncated,
    preview: truncated.text,
  };
}

function objectKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value).sort();
}

function summarizePayload(raw, normalized, stdin, rawParseError) {
  const tool = raw && typeof raw === 'object' && raw.tool_name
    ? {
        name: String(raw.tool_name),
        id_present: !!raw.tool_use_id,
        input_keys: objectKeys(raw.tool_input),
        response_present: Object.prototype.hasOwnProperty.call(raw, 'tool_response'),
      }
    : null;
  return {
    stdin: {
      bytes: utf8ByteLength(stdin),
      sha256: sha256Text(stdin),
      json_parse_ok: !rawParseError,
    },
    raw_parse_error: rawParseError ? summarizeText(rawParseError, 512) : '',
    payload: {
      top_level_keys: objectKeys(raw),
      prompt_present: typeof (raw && raw.prompt) === 'string',
      prompt_bytes: typeof (raw && raw.prompt) === 'string' ? utf8ByteLength(raw.prompt) : 0,
      tool,
    },
    normalized: {
      event: normalized.event,
      host_event_name: normalized.host && normalized.host.eventName ? String(normalized.host.eventName) : '',
      session_id_present: !!(normalized.session && normalized.session.id),
      session_id_sha256: normalized.session && normalized.session.id ? sha256Text(normalized.session.id) : '',
      tool_name: normalized.tool && normalized.tool.name ? normalized.tool.name : '',
      board_present: !!normalized.board,
    },
  };
}

function unsafeRawDiagnostic(stdin, raw, normalized, coreStdout, coreStderr) {
  return {
    stdin_text: truncateText(stdin, DIAGNOSTIC_RAW_LIMIT),
    payload_raw_json: truncateText(JSON.stringify(raw || {}), DIAGNOSTIC_RAW_LIMIT),
    payload_normalized_json: truncateText(JSON.stringify(normalized || {}), DIAGNOSTIC_RAW_LIMIT),
    core_stdout: truncateText(coreStdout, DIAGNOSTIC_RAW_LIMIT),
    core_stderr: truncateText(coreStderr, DIAGNOSTIC_RAW_LIMIT),
  };
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
    fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(baseDir, 0o700);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(baseDir, `${stamp}-${process.pid}.json`);
    const output = {
      ...payload,
      wrote_at: new Date().toISOString(),
    };
    fs.writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
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
  // Installed layout: hooks/_hosts/codex/launcher.js → plugin root is ../../..
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
  if (!state || state.harness !== 'codex' || state.session_id !== sessionId || typeof state.board_path !== 'string') {
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
  const shouldSystemMessage = event === 'session-start' || event === 'user-prompt-submit';
  if (kind === 'block') {
    if (event === 'pre-tool-use') {
      process.stdout.write(`${JSON.stringify({ decision: 'block', reason: message })}\n`);
    } else if (event === 'stop' || event === 'subagent-stop' || event === 'user-prompt-submit') {
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
  if (shouldSystemMessage) {
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
    const unsafeRaw = resolveHookDiagUnsafeRawEnabled();
    writeDiagnostic(home, {
      schema: 'cc-master-codex-hook-diagnostic/v2',
      raw_capture: unsafeRaw ? 'unsafe-opt-in' : 'disabled',
      invocation: {
        event: args.event,
        eventNormalized: normalized.event,
        hostEventName: normalized.host && normalized.host.eventName,
        core: args.core,
        pluginRoot,
        board: activeBoard
          ? {
              path: activeBoard.path,
              stem: boardStem(activeBoard.path),
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
      summary: summarizePayload(raw, normalized, stdin, rawParseError),
      core: {
        status: coreStatus,
        signal: coreSignal,
        error: coreError ? summarizeText(coreError, 1024) : '',
        stdout: summarizeText(coreStdout),
        stderr: summarizeText(coreStderr),
      },
      ...(unsafeRaw ? { unsafe_raw: unsafeRawDiagnostic(stdin, raw, normalized, coreStdout, coreStderr) } : {}),
    });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`cc-master codex hook launcher: ${error && error.message ? error.message : String(error)}\n`);
  process.exit(2);
}
