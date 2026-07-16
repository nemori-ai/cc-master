#!/usr/bin/env node
/**
 * kimi-code host launcher (K4).
 * Parse kimi hook stdin (snake_case) → normalize → spawn *-core.js → emit kimi envelope.
 *
 * Path root: KIMI_PLUGIN_ROOT env (kimi plugin-hook subprocess env) → CC_MASTER_PLUGIN_ROOT →
 *   __dirname. Layout: hooks/_hosts/kimi-code/launcher.js → plugin root is ../../..
 *
 * Envelope SSOT: _hosts/kimi-code/ENVELOPE.md. kimi facts: design_docs/harnesses/kimi-code.md §5/§6.
 * Key kimi divergences from cursor blueprint:
 *   - stdin is snake_case already (hook_event_name / session_id / cwd / prompt / tool_name).
 *   - prompt is a content-block array [{type:"text",text}] (not a plain string).
 *   - session_id is the arming key (session_<uuid>), read directly (no conversation_id).
 *   - injection envelope is `message` (top-level) / `hookSpecificOutput.permissionDecision="deny"`
 *     + `permissionDecisionReason` — NOT additionalContext (CC) / systemMessage (codex).
 *   - Stop hook: only `permissionDecision="deny"` surfaces (agent continues once + reason injected,
 *     probe: agent-core stop handler). A non-deny Stop message is discarded (triggerBlock consumes
 *     only the block decision) → kimi has no non-blocking Stop advisory channel → emit nothing.
 *   - PostToolUse / PostCompact fire via fireAndForgetTrigger (output discarded). We still map
 *     post-tool-use context → top-level `message` (best-effort / forward-compatible; discarded today).
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
    UserPromptSubmit: 'user-prompt-submit',
    SessionStart: 'session-start',
    SessionEnd: 'session-end',
    PreToolUse: 'pre-tool-use',
    PostToolUse: 'post-tool-use',
    PostToolUseFailure: 'post-tool-use-failure',
    Stop: 'stop',
    StopFailure: 'stop-failure',
    SubagentStart: 'subagent-start',
    SubagentStop: 'subagent-stop',
    PreCompact: 'pre-compact',
    PostCompact: 'post-compact',
    Interrupt: 'interrupt',
    Notification: 'notification',
  };
  if (explicit[value]) return explicit[value];
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

function resolvePluginRoot() {
  const fromEnv = process.env.CC_MASTER_PLUGIN_ROOT || process.env.KIMI_PLUGIN_ROOT || '';
  if (path.isAbsolute(fromEnv)) return fromEnv;
  // launcher lives at hooks/_hosts/kimi-code/launcher.js → plugin root is ../../..
  return path.resolve(__dirname, '..', '..', '..');
}

function resolveHome() {
  // cc-master home is independent of KIMI_CODE_HOME (kimi home holds kimi's own state only;
  // boards live under the cc-master home). CC_MASTER_HOME overrides; else $HOME/.cc_master.
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
  if (!state || state.harness !== 'kimi-code' || state.session_id !== sessionId || typeof state.board_path !== 'string') {
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

// kimi `prompt` is a content-block array [{type:"text",text}]; join all text blocks.
function promptText(raw) {
  const p = raw && raw.prompt;
  if (typeof p === 'string') return p;
  if (Array.isArray(p)) {
    return p
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
  }
  return '';
}

function normalize(raw, fallbackEvent) {
  const hostEvent = (raw && raw.hook_event_name) || fallbackEvent || '';
  const event = eventName(hostEvent);
  const sessionId = String((raw && raw.session_id) || '');
  const toolName = raw && raw.tool_name ? String(raw.tool_name) : '';
  const normalized = {
    harness: 'kimi-code',
    event,
    session: { id: sessionId, role: 'unknown' },
    raw: raw || {},
    host: { eventName: hostEvent },
  };
  if (toolName) {
    normalized.tool = {
      name: toolName,
      input: (raw && raw.tool_input) || {},
      response: raw ? raw.tool_response : undefined,
      id: raw && raw.tool_use_id ? String(raw.tool_use_id) : '',
    };
  }
  const text = promptText(raw);
  if (text) {
    normalized.prompt = { text };
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

function emitDeny(message) {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: message || 'denied' },
  })}\n`);
}

function emitMessage(message) {
  process.stdout.write(`${JSON.stringify({ message })}\n`);
}

// Event-scoped envelope mapping — SSOT: ENVELOPE.md
function emitHostResult(result, event) {
  const kind = result && result.kind ? result.kind : 'silent';
  if (kind === 'silent' || kind === 'allow') return;
  const message = String(result.context || result.message || result.followup_message || '');
  if (!message) return;

  const isDeny = kind === 'block' || kind === 'deny';

  if (event === 'stop') {
    // kimi Stop: only permissionDecision="deny" surfaces (agent continues once + reason injected).
    // A non-deny Stop message is discarded by triggerBlock → no non-blocking advisory channel.
    if (isDeny) emitDeny(message);
    return;
  }
  if (event === 'pre-tool-use') {
    if (isDeny) emitDeny(message);
    return;
  }
  if (event === 'user-prompt-submit') {
    if (isDeny) emitDeny(message);
    else emitMessage(message); // injected (probe-confirmed)
    return;
  }
  if (event === 'post-tool-use') {
    // fireAndForgetTrigger → discarded today; emit best-effort message for forward-compat.
    if (!isDeny) emitMessage(message);
    return;
  }
  // Other events (session-start / post-compact / …): no reliable injection channel → emit nothing.
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
    CC_MASTER_HARNESS: 'kimi-code',
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
    // Fail-open on core crash. Map an intentional exit 2 pre-tool-use deny (stderr = reason).
    if (spawned.status === 2 && normalized.event === 'pre-tool-use') {
      emitDeny(String(spawned.stderr || 'denied'));
    }
    return;
  }

  emitHostResult(parseCoreResult(spawned.stdout), normalized.event);
}

try {
  main();
} catch {
  // Fail-open: never crash the kimi agent loop from launcher bugs.
}
