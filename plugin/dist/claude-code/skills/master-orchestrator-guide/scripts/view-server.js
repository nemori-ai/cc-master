#!/usr/bin/env node
// cc-master board view server —— dependency-free local webview for a board's task DAG.
//
// Red line 1 (ADR-006): node/JS only, no jq/python/tsx. Pure stdlib http/fs.
// Red line 5 (ship-anywhere): binds 127.0.0.1 only, serves locally vendored assets —
//   ZERO network access at runtime. Everything under ./vendor/ is self-contained.
//
// Legacy internal payload: invoked only by ccm migration bridges or tests with an explicit board path env.
// Prints exactly one local URL line so an internal launcher can scrape it. Bind port 0 => OS picks a free port.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BOARD_PATH = process.env.CC_MASTER_BOARD;
if (!BOARD_PATH) {
  console.error('cc-master board view: ERROR — CC_MASTER_BOARD env (absolute board path) is required');
  process.exit(1);
}

// Resolve served files relative to THIS script, never cwd (the launcher may run from anywhere).
const SCRIPT_DIR = __dirname;
const VENDOR_DIR = path.join(SCRIPT_DIR, 'vendor');
const HTML_PATH = path.join(SCRIPT_DIR, 'view.html');
const ENGINE_IIFE_PATH = path.join(VENDOR_DIR, 'ccm-engine.iife.js');
// The shared graph-analysis core is now the @ccm/engine IIFE, vendored ALONGSIDE this skill at
// ./vendor/ccm-engine.iife.js (a build artifact vendored into this skill bundle and
// re-generated each release). It publishes a
// SINGLE global — globalThis.__ccmEngine — carrying every engine symbol (analyzeGraph / lintBoard /
// ENUMS / …). The viewer loads it as ONE classic <script> so its analyze() delegates to the same
// analyzeGraph() instead of carrying a divergent copy (DRY). Self-contained: resolved relative to
// THIS script (under ./vendor/), never cwd, never up-tree into cli/ — the whole webview now lives
// inside this skill (red line 5 ship-anywhere / self-contain).

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const ACCESS_TOKEN = crypto.randomBytes(32).toString('base64url');
const CSP_NONCE = crypto.randomBytes(16).toString('base64url');
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'nonce-" + CSP_NONCE + "'",
  "style-src 'self' 'nonce-" + CSP_NONCE + "'",
  "style-src-attr 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function securityHeaders(extra) {
  return Object.assign({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  }, extra || {});
}

function contentType(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function sendNotFound(res, body) {
  res.writeHead(404, securityHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
  res.end(body !== undefined ? body : '{}');
}

function sendForbidden(res) {
  res.writeHead(403, securityHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
  res.end('{"error":"forbidden"}');
}

function hasAccessToken(url) {
  return url.searchParams.get('token') === ACCESS_TOKEN;
}

function injectHtmlNonce(buf) {
  return String(buf)
    .replace('<style>', '<style nonce="' + CSP_NONCE + '">')
    .replace('<script type="importmap">', '<script type="importmap" nonce="' + CSP_NONCE + '">')
    .replace('<script type="module">', '<script type="module" nonce="' + CSP_NONCE + '">');
}

// Board home = directory containing the board file. discuss sidecars live alongside it.
const BOARD_HOME = path.dirname(BOARD_PATH);
// cc-master home defaults to the parent of the boards directory, but callers may pin it
// explicitly. Multi-board APIs read <home>/boards only; they never write boards.
const CC_MASTER_HOME = process.env.CC_MASTER_HOME ||
  (path.basename(BOARD_HOME) === 'boards' ? path.dirname(BOARD_HOME) : BOARD_HOME);
const BOARDS_DIR = path.join(CC_MASTER_HOME, 'boards');
const PEER_FRESHNESS_SEC_FALLBACK = 600;

// Parse a minimal flat `key: value` YAML frontmatter block (the only shape discuss
// sidecars emit). Pure hand-rolled — red line 1 forbids jq/python. Returns {} on any
// shape we don't recognize. Tolerant of torn writes (no closing fence => parse what we got).
function parseFrontmatter(text) {
  const out = {};
  // Frontmatter is a leading `---` fenced block. Tolerate a UTF-8 BOM / leading blank lines.
  const m = text.replace(/^﻿/, '').match(/^[ \t]*\r?\n?---[ \t]*\r?\n([\s\S]*?)(?:\r?\n---[ \t]*(?:\r?\n|$)|$)/);
  if (!m) {
    // Also accept a `---` on the very first line with no preceding newline.
    const m2 = text.replace(/^﻿/, '').match(/^---[ \t]*\r?\n([\s\S]*?)(?:\r?\n---[ \t]*(?:\r?\n|$)|$)/);
    if (!m2) return out;
    return parseFlatYaml(m2[1]);
  }
  return parseFlatYaml(m[1]);
}

function parseFlatYaml(block) {
  const out = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    let val = line.slice(idx + 1).trim();
    // Strip a single layer of matching quotes.
    if ((val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
        (val.startsWith("'") && val.endsWith("'") && val.length >= 2)) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

// Extract the first non-empty line under a `## TL;DR` heading (case-insensitive),
// truncated to a sane length. Returns '' if no TL;DR section / no content.
function extractTldr(text) {
  const lines = text.split(/\r?\n/);
  let inSection = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^#{1,6}\s/.test(line)) {
      // A heading line. Enter the section iff it's a TL;DR heading; otherwise leaving it.
      inSection = /^#{1,6}\s*TL;?\s*DR\b/i.test(line);
      continue;
    }
    if (inSection && line) {
      return line.length > 200 ? line.slice(0, 200) : line;
    }
  }
  return '';
}

// Pull <node-id> out of a filename shaped `<board-stem>--<node-id>--<stamp>.decision.md`.
// Returns '' if the shape doesn't match.
function nodeIdFromFilename(file) {
  const base = file.replace(/\.decision\.md$/i, '');
  const parts = base.split('--');
  // Expected: [stem..., nodeId, stamp]. The stamp is the last segment; nodeId is second-to-last.
  if (parts.length >= 3) return parts[parts.length - 2];
  return '';
}

// Build the /decisions.json payload by scanning the selected board home for *.decision.md sidecars.
// Read-only, single directory level (no recursion, no symlink following). Any individual
// file that fails to read/parse is skipped — never throws, never 500s.
function collectDecisions(boardPath) {
  const boardHome = path.dirname(boardPath || BOARD_PATH);
  const boardStem = path.basename(boardPath || BOARD_PATH).replace(/\.board\.json$/i, '');
  let entries;
  try {
    entries = fs.readdirSync(boardHome, { withFileTypes: true });
  } catch (_e) {
    return []; // home gone / unreadable => empty, graceful.
  }
  const rows = [];
  // Cross-board filter (this board only): sidecars are named
  //   <board-stem>--<node-id>--<stamp>.decision.md
  // so a sidecar belonging to THIS board must start with `${BOARD_STEM}--`. A shared
  // cc-master home can hold several boards; without this prefix gate, another board's
  // same-named node (e.g. both have `D1`) would bleed into this board's cards and skew
  // the "discussed N times" count / latest TL;DR. Other boards' sidecars are dropped.
  const STEM_PREFIX = boardStem + '--';
  for (const ent of entries) {
    // Only plain files named *.decision.md, this directory level only. Don't follow
    // symlinks out of the home (mirrors the /vendor/* containment discipline).
    if (!ent.isFile()) continue;
    const file = ent.name;
    if (!/\.decision\.md$/i.test(file)) continue;
    // Belongs to this board only (cross-board bleed guard).
    if (!file.startsWith(STEM_PREFIX)) continue;
    const full = path.join(boardHome, file);
    let text;
    try {
      const st = fs.lstatSync(full);
      if (!st.isFile()) continue; // symlink/dir masquerading => skip.
      text = fs.readFileSync(full, 'utf8');
    } catch (_e) {
      continue; // torn write / vanished mid-scan / unreadable => skip this one.
    }
    let fm;
    try {
      fm = parseFrontmatter(text);
    } catch (_e) {
      continue;
    }
    const nodeId = (fm.node_id && String(fm.node_id).trim()) || nodeIdFromFilename(file);
    if (!nodeId) continue; // can't attribute it to a node => not useful, skip.
    rows.push({
      node_id: nodeId,
      file,
      resolved_at: (fm.resolved_at && String(fm.resolved_at)) || '',
      ask_type: (fm.ask_type && String(fm.ask_type)) || '',
      tldr: extractTldr(text),
      // _stamp is an internal sort key (filename stamp, falls back to resolved_at); dropped before output.
      _stamp: stampFromFilename(file) || (fm.resolved_at && String(fm.resolved_at)) || '',
    });
  }

  // round = 1-based index within a node_id group, ordered ascending by stamp/resolved_at.
  const byNode = new Map();
  for (const r of rows) {
    if (!byNode.has(r.node_id)) byNode.set(r.node_id, []);
    byNode.get(r.node_id).push(r);
  }
  for (const group of byNode.values()) {
    group.sort((a, b) => (a._stamp < b._stamp ? -1 : a._stamp > b._stamp ? 1 : (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)));
    group.forEach((r, i) => { r.round = i + 1; });
  }

  // Final order: by node_id, then by round.
  rows.sort((a, b) =>
    (a.node_id < b.node_id ? -1 : a.node_id > b.node_id ? 1 : a.round - b.round));

  // Strip internal sort key and emit the pinned shape.
  return rows.map((r) => ({
    node_id: r.node_id,
    file: r.file,
    resolved_at: r.resolved_at,
    ask_type: r.ask_type,
    round: r.round,
    tldr: r.tldr,
  }));
}

// Last `--`-delimited segment (sans .decision.md) is the compact stamp; '' if absent.
// May carry a same-second collision-avoidance suffix (`<STAMP>-2`, `-3`, …) when two
// discusses on one node land in the same UTC second (discuss.md §5). The suffix sorts
// lexically AFTER the bare stamp (a prefix), and `-2` < `-3`, so the existing string
// sort still yields write order; the suffix is only a uniqueness tiebreak.
function stampFromFilename(file) {
  const base = file.replace(/\.decision\.md$/i, '');
  const parts = base.split('--');
  if (parts.length >= 3) return parts[parts.length - 1];
  return '';
}

let engineLoadAttempted = false;
let engineCache = null;
let engineLoadError = '';

function nowIso() {
  return new Date().toISOString();
}

function hrtimeMsSince(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function makeEtag(kind, hash) {
  return '"' + kind + '-' + hash.slice(0, 32) + '"';
}

function requestHasEtag(req, etag) {
  const raw = req.headers['if-none-match'];
  if (!raw) return false;
  const wanted = String(etag);
  return String(raw).split(',').some((part) => {
    const tag = part.trim();
    return tag === '*' || tag === wanted || tag === ('W/' + wanted);
  });
}

function sendNotModified(res, etag) {
  res.writeHead(304, securityHeaders({ ETag: etag }));
  res.end();
}

function resolveRequestedBoardPath(url) {
  const requested = url && (url.searchParams.get('board') || url.searchParams.get('board_file'));
  if (!requested) return BOARD_PATH;
  const file = String(requested).trim();
  if (!/^[^/\\]+\.board\.json$/i.test(file)) return null;
  if (file === path.basename(BOARD_PATH)) return BOARD_PATH;
  const resolved = path.resolve(BOARDS_DIR, file);
  const root = path.resolve(BOARDS_DIR);
  if (resolved !== root && resolved.startsWith(root + path.sep)) return resolved;
  return null;
}

function readBoardSnapshot(boardPath) {
  const selectedBoardPath = boardPath || BOARD_PATH;
  const st = fs.statSync(selectedBoardPath);
  const txt = fs.readFileSync(selectedBoardPath, 'utf8');
  const board = JSON.parse(txt);
  const boardHash = sha256Hex(txt);
  return {
    boardPath: selectedBoardPath,
    txt,
    board,
    stat: st,
    boardHash,
    etag: makeEtag('board', boardHash),
  };
}

// Server-side read-model code reuses the vendored @ccm/engine IIFE that the browser view
// already loads. The IIFE is not a CommonJS module, so we evaluate the bundled artifact and
// read its exported object. If a future bundle changes shape, /view-model.json degrades to
// a minimal observed-status model instead of importing repo-local TS or changing persistence.
function loadCcmEngine() {
  if (engineLoadAttempted) return engineCache;
  engineLoadAttempted = true;
  const start = process.hrtime.bigint();
  try {
    if (process.env.CC_MASTER_VIEW_DISABLE_ENGINE === '1') {
      engineLoadError = 'ccm engine disabled by CC_MASTER_VIEW_DISABLE_ENGINE';
      return null;
    }
    const src = fs.readFileSync(ENGINE_IIFE_PATH, 'utf8');
    // eslint-disable-next-line no-new-func
    const loaded = Function('require', src + '\nreturn typeof __ccmEngine !== "undefined" ? __ccmEngine : null;')(require);
    if (loaded && typeof loaded === 'object') {
      engineCache = loaded;
    } else {
      engineLoadError = 'ccm engine IIFE did not return an export object';
    }
  } catch (e) {
    engineLoadError = e && e.message ? e.message : String(e);
  } finally {
    loadCcmEngine.lastLoadMs = hrtimeMsSince(start);
  }
  return engineCache;
}
loadCcmEngine.lastLoadMs = 0;

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function parseIsoUtcMs(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

function heartbeatFreshness(heartbeat, nowMs, freshnessSec) {
  const hbMs = parseIsoUtcMs(heartbeat);
  if (hbMs == null) return { heartbeat_age_sec: null, heartbeat_fresh: false };
  const ageSec = Math.round((nowMs - hbMs) / 1000);
  return {
    heartbeat_age_sec: ageSec,
    heartbeat_fresh: ageSec < freshnessSec,
  };
}

function observedStatusCounts(tasks) {
  const out = {};
  for (const task of tasks) {
    if (!isPlainObject(task) || typeof task.status !== 'string') continue;
    out[task.status] = (out[task.status] || 0) + 1;
  }
  return out;
}

function openTaskCount(tasks) {
  return tasks.reduce((n, task) => {
    if (!isPlainObject(task)) return n;
    return task.status === 'done' || task.status === 'cancelled' ? n : n + 1;
  }, 0);
}

function summarizeTaskCounts(tasks) {
  const statusCounts = observedStatusCounts(tasks);
  const parts = Object.keys(statusCounts)
    .map((status) => status + '=' + statusCounts[status]);
  return {
    total: tasks.length,
    open: openTaskCount(tasks),
    done: statusCounts.done || 0,
    status_counts: statusCounts,
    summary: tasks.length + ' tasks' + (parts.length ? '; ' + parts.join(', ') : ''),
  };
}

function currentBoardMatches(fullPath) {
  return path.resolve(fullPath) === path.resolve(BOARD_PATH);
}

function readBoardSummary(fullPath, file, nowMs, freshnessSec) {
  const st = fs.lstatSync(fullPath);
  if (!st.isFile()) return null;
  const txt = fs.readFileSync(fullPath, 'utf8');
  const board = JSON.parse(txt);
  if (!isPlainObject(board)) return null;
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const owner = isPlainObject(board.owner) ? board.owner : {};
  const git = isPlainObject(board.git) ? board.git : {};
  const heartbeat = typeof owner.heartbeat === 'string' ? owner.heartbeat : null;
  const current = currentBoardMatches(fullPath);
  return {
    file,
    path: fullPath,
    current,
    active: owner.active === true,
    goal: typeof board.goal === 'string' ? board.goal : '',
    owner: {
      active: owner.active === true,
      session_id: typeof owner.session_id === 'string' ? owner.session_id : '',
      heartbeat,
      ...heartbeatFreshness(heartbeat, nowMs, freshnessSec),
    },
    priority: isPlainObject(board.coordination) && typeof board.coordination.priority === 'string'
      ? board.coordination.priority
      : null,
    tasks: summarizeTaskCounts(tasks),
    git: {
      worktree: typeof git.worktree === 'string' ? git.worktree : '',
      branch: typeof git.branch === 'string' ? git.branch : '',
    },
    rev: {
      boardHash: 'sha256:' + sha256Hex(txt),
      mtimeMs: st.mtimeMs,
      size: st.size,
    },
  };
}

function listBoardSummaries(opts) {
  const nowMs = opts && typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();
  const freshnessSec = opts && typeof opts.freshnessSec === 'number'
    ? opts.freshnessSec
    : PEER_FRESHNESS_SEC_FALLBACK;
  let entries;
  try {
    entries = fs.readdirSync(BOARDS_DIR, { withFileTypes: true });
  } catch (_e) {
    return [];
  }
  const rows = [];
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith('.board.json')) continue;
    const fullPath = path.join(BOARDS_DIR, ent.name);
    try {
      const row = readBoardSummary(fullPath, ent.name, nowMs, freshnessSec);
      if (row) rows.push(row);
    } catch (_e) {
      // Bad/torn/unreadable boards are skipped so the viewer remains read-only and live.
    }
  }
  rows.sort((a, b) => {
    if (a.rev.mtimeMs !== b.rev.mtimeMs) return b.rev.mtimeMs - a.rev.mtimeMs;
    return b.file.localeCompare(a.file);
  });
  return rows;
}

function buildBoardsPayload() {
  const engine = loadCcmEngine();
  const freshnessSec = engine && typeof engine.PEER_FRESHNESS_SEC === 'number'
    ? engine.PEER_FRESHNESS_SEC
    : PEER_FRESHNESS_SEC_FALLBACK;
  const boards = listBoardSummaries({ freshnessSec });
  const currentFile = path.basename(BOARD_PATH);
  const current = boards.find((b) => b.current) || null;
  return {
    available: true,
    home: CC_MASTER_HOME,
    boards_dir: BOARDS_DIR,
    count: boards.length,
    current: {
      file: currentFile,
      path: BOARD_PATH,
      in_list: !!current,
    },
    boards,
  };
}

function buildPeersPayload() {
  const engine = loadCcmEngine();
  const base = {
    home: CC_MASTER_HOME,
    boards_dir: BOARDS_DIR,
    current: {
      file: path.basename(BOARD_PATH),
      path: BOARD_PATH,
    },
  };
  if (!engine || typeof engine.buildPeerRoster !== 'function' || typeof engine.loadHomeBoards !== 'function') {
    return {
      available: false,
      error: engineLoadError || 'ccm engine peers support unavailable',
      count: 0,
      peers: [],
      freshness_sec: null,
      as_of: nowIso(),
      ...base,
    };
  }

  const freshnessSec = typeof engine.PEER_FRESHNESS_SEC === 'number'
    ? engine.PEER_FRESHNESS_SEC
    : PEER_FRESHNESS_SEC_FALLBACK;
  let boards = [];
  try {
    boards = engine.loadHomeBoards(BOARDS_DIR, { maxDaysAgo: Number.POSITIVE_INFINITY });
  } catch (_e) {
    boards = [];
  }
  let roster;
  try {
    roster = engine.buildPeerRoster(boards, { freshnessSec });
  } catch (e) {
    return {
      available: false,
      error: e && e.message ? e.message : String(e),
      count: 0,
      peers: [],
      freshness_sec: freshnessSec,
      as_of: nowIso(),
      ...base,
    };
  }
  return {
    available: true,
    ...base,
    ...roster,
    peers: Array.isArray(roster.peers) ? roster.peers.map((peer) => ({
      ...peer,
      heartbeat_fresh: true,
    })) : [],
  };
}

function statusListFromEngine(engine, tasks) {
  const statusEnum = engine && Array.isArray(engine.STATUS_ENUM)
    ? engine.STATUS_ENUM
    : engine && engine.ENUMS && Array.isArray(engine.ENUMS.status)
      ? engine.ENUMS.status
      : [];
  if (statusEnum.length) return statusEnum.slice();
  const seen = new Set();
  for (const task of tasks) if (task && typeof task.status === 'string') seen.add(task.status);
  return Array.from(seen).sort();
}

function countStatuses(tasks, engine) {
  const out = {};
  for (const status of statusListFromEngine(engine, tasks)) out[status] = 0;
  for (const task of tasks) {
    if (!task || typeof task.status !== 'string') continue;
    out[task.status] = (out[task.status] || 0) + 1;
  }
  return out;
}

function countAwaitingUser(tasks, engine) {
  if (engine && typeof engine.isAwaitingUser === 'function') {
    return tasks.filter((task) => engine.isAwaitingUser(task)).length;
  }
  return tasks.filter((task) => (
    task &&
    typeof task === 'object' &&
    task.blocked_on === 'user' &&
    (task.status === 'blocked' || task.status === 'in_flight')
  )).length;
}

function compactTask(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return null;
  const out = {};
  for (const key of [
    'id',
    'title',
    'status',
    'deps',
    'parent',
    'type',
    'executor',
    'blocked_on',
    'estimate',
    'artifact',
    'verified',
    'created_at',
    'started_at',
    'finished_at',
    'updated_at',
  ]) {
    if (task[key] !== undefined) out[key] = task[key];
  }
  if (task.acceptance !== undefined) out.acceptance = task.acceptance;
  if (task.decision_package !== undefined) {
    const dp = task.decision_package;
    out.decision_package = isPlainObject(dp) ? dp : true;
  }
  return out;
}

function topologyHashFor(board) {
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : [];
  const topology = tasks
    .filter((task) => task && typeof task === 'object' && typeof task.id === 'string')
    .map((task) => ({
      id: task.id,
      deps: Array.isArray(task.deps) ? task.deps.filter((d) => typeof d === 'string').slice().sort() : [],
      parent: typeof task.parent === 'string' ? task.parent : '',
    }))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return sha256Hex(JSON.stringify(topology));
}

function mapToObject(map) {
  const out = {};
  if (!map || typeof map.forEach !== 'function') return out;
  map.forEach((value, key) => {
    out[key] = Array.isArray(value) ? value.slice() : value;
  });
  return out;
}

function summarizeCriticalPath(cp) {
  if (!cp || typeof cp !== 'object') {
    return { chain: [], makespan: null, weight_source: 'unavailable' };
  }
  return {
    chain: Array.isArray(cp.chain) ? cp.chain.slice() : [],
    makespan: cp.makespan === undefined ? null : cp.makespan,
    weight_source: cp.weight_source || '',
    cycle: Array.isArray(cp.cycle) ? cp.cycle.slice() : undefined,
  };
}

function summarizeDecisions(rows) {
  const countsByNode = {};
  const latestByNode = {};
  const sorted = rows.slice().sort((a, b) => {
    const ak = a.resolved_at || a.file || '';
    const bk = b.resolved_at || b.file || '';
    return ak < bk ? 1 : ak > bk ? -1 : 0;
  });
  for (const row of rows) {
    countsByNode[row.node_id] = (countsByNode[row.node_id] || 0) + 1;
  }
  for (const row of sorted) {
    if (!latestByNode[row.node_id]) latestByNode[row.node_id] = row;
  }
  return {
    count: rows.length,
    countsByNode,
    latestByNode,
    latest: sorted.slice(0, 20),
  };
}

function buildViewModel(snapshot) {
  const totalStart = process.hrtime.bigint();
  const diagnostics = {
    engineLoaded: false,
    engineLoadError: '',
    timingsMs: {},
  };
  const board = snapshot.board;
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const engineStart = process.hrtime.bigint();
  const engine = loadCcmEngine();
  diagnostics.timingsMs.engineLoad = loadCcmEngine.lastLoadMs || hrtimeMsSince(engineStart);
  diagnostics.engineLoaded = !!engine;
  diagnostics.engineLoadError = engine ? '' : engineLoadError;

  let analysis = null;
  let readySet = [];
  let criticalPath = { chain: [], makespan: null, weight_source: 'unavailable' };
  let topoOrder = [];
  let cycle = null;
  let upstream = {};
  let downstream = {};
  let parents = {};
  const analyzeStart = process.hrtime.bigint();
  try {
    if (engine && typeof engine.analyzeGraph === 'function') {
      analysis = engine.analyzeGraph(board);
      readySet = typeof analysis.readySet === 'function' ? analysis.readySet() : [];
      criticalPath = summarizeCriticalPath(typeof analysis.criticalPath === 'function' ? analysis.criticalPath({ now: Date.now() }) : null);
      const topo = typeof analysis.topoSort === 'function' ? analysis.topoSort() : null;
      topoOrder = topo && Array.isArray(topo.order) ? topo.order : [];
      cycle = topo && Array.isArray(topo.cycle) ? topo.cycle : null;
      upstream = mapToObject(analysis.upstream);
      downstream = mapToObject(analysis.downstream);
      parents = mapToObject(analysis.parentOf);
    }
  } catch (e) {
    diagnostics.analysisError = e && e.message ? e.message : String(e);
  }
  diagnostics.timingsMs.analysis = hrtimeMsSince(analyzeStart);

  const lintStart = process.hrtime.bigint();
  let lintErrors = [];
  let lintWarnings = [];
  try {
    if (engine && typeof engine.lintBoard === 'function') {
      const lint = engine.lintBoard(snapshot.txt);
      lintErrors = Array.isArray(lint && lint.errors) ? lint.errors : [];
      lintWarnings = Array.isArray(lint && lint.warnings) ? lint.warnings : [];
    }
  } catch (e) {
    diagnostics.lintError = e && e.message ? e.message : String(e);
  }
  diagnostics.timingsMs.lint = hrtimeMsSince(lintStart);

  const decisionsStart = process.hrtime.bigint();
  let decisionRows = [];
  try {
    decisionRows = collectDecisions(snapshot.boardPath);
  } catch (_e) {
    decisionRows = [];
  }
  diagnostics.timingsMs.decisions = hrtimeMsSince(decisionsStart);

  const graphEdges = [];
  for (const task of tasks) {
    if (!task || typeof task !== 'object' || typeof task.id !== 'string') continue;
    for (const dep of Array.isArray(task.deps) ? task.deps : []) {
      if (typeof dep === 'string') graphEdges.push({ from: dep, to: task.id, type: 'dep' });
    }
    if (typeof task.parent === 'string' && task.parent) {
      graphEdges.push({ from: task.parent, to: task.id, type: 'parent' });
    }
  }

  diagnostics.timingsMs.total = hrtimeMsSince(totalStart);
  return {
    rev: {
      boardHash: 'sha256:' + snapshot.boardHash,
      topologyHash: 'sha256:' + topologyHashFor(board),
      mtimeMs: snapshot.stat.mtimeMs,
      size: snapshot.stat.size,
      generatedAt: nowIso(),
    },
    board: {
      schema: board.schema,
      goal: board.goal,
      source: snapshot.boardPath,
      owner: board.owner || null,
      git: board.git || null,
      meta: board.meta || null,
    },
    summary: {
      statusCounts: countStatuses(tasks, engine),
      readySet,
      criticalPath,
      lint: {
        ok: lintErrors.length === 0,
        errors: lintErrors.length,
        warnings: lintWarnings.length,
      },
      awaitingUserCount: countAwaitingUser(tasks, engine),
    },
    tasks: tasks.map(compactTask).filter(Boolean),
    graph: {
      nodeCount: tasks.length,
      edgeCount: graphEdges.length,
      edges: graphEdges,
      topoOrder,
      cycle,
      upstream,
      downstream,
      parents,
    },
    decisions: summarizeDecisions(decisionRows),
    diagnostics,
  };
}

function viewModelStateHash(model) {
  const stable = {
    rev: {
      boardHash: model.rev.boardHash,
      topologyHash: model.rev.topologyHash,
      mtimeMs: model.rev.mtimeMs,
      size: model.rev.size,
    },
    board: model.board,
    summary: model.summary,
    tasks: model.tasks,
    graph: model.graph,
    decisions: model.decisions,
    diagnostics: {
      engineLoaded: model.diagnostics.engineLoaded,
      engineLoadError: model.diagnostics.engineLoadError,
      analysisError: model.diagnostics.analysisError || '',
      lintError: model.diagnostics.lintError || '',
    },
  };
  return sha256Hex(JSON.stringify(stable));
}

const server = http.createServer((req, res) => {
  // Only GET is supported (read-only viewer).
  if (req.method !== 'GET') {
    res.writeHead(405, securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
    res.end('Method Not Allowed');
    return;
  }

  let parsedUrl;
  let urlPath;
  try {
    parsedUrl = new URL(req.url, 'http://127.0.0.1');
    urlPath = decodeURIComponent(parsedUrl.pathname);
  } catch (_e) {
    sendNotFound(res);
    return;
  }

  // GET / -> view.html
  if (urlPath === '/' || urlPath === '/index.html') {
    if (!hasAccessToken(parsedUrl)) {
      sendForbidden(res);
      return;
    }
    fs.readFile(HTML_PATH, (err, buf) => {
      if (err) {
        sendNotFound(res, 'view.html not found');
        return;
      }
      res.writeHead(200, securityHeaders({ 'Content-Type': CONTENT_TYPES['.html'] }));
      res.end(injectHtmlNonce(buf));
    });
    return;
  }

  // GET /favicon.ico -> 204 No Content. The viewer ships no icon; without this the
  // browser's automatic favicon request logs a lone 404 in the console. Silence it.
  if (urlPath === '/favicon.ico') {
    res.writeHead(204, securityHeaders());
    res.end();
    return;
  }

  // GET /board.json -> read the board fresh each request (no cache). Board may be
  // mid-write by the orchestrator; on any read/parse failure return 404 + {} so the
  // client just retries on its next poll (no crash, no stale cache).
  if (urlPath === '/board.json') {
    if (!hasAccessToken(parsedUrl)) {
      sendForbidden(res);
      return;
    }
    const selectedBoardPath = resolveRequestedBoardPath(parsedUrl);
    if (!selectedBoardPath) {
      sendNotFound(res);
      return;
    }
    let snapshot;
    try {
      snapshot = readBoardSnapshot(selectedBoardPath); // validates JSON; torn writes still degrade to 404.
    } catch (_e) {
      sendNotFound(res);
      return;
    }
    if (requestHasEtag(req, snapshot.etag)) {
      sendNotModified(res, snapshot.etag);
      return;
    }
    res.writeHead(200, securityHeaders({
      'Content-Type': CONTENT_TYPES['.json'],
      ETag: snapshot.etag,
    }));
    res.end(snapshot.txt);
    return;
  }

  // GET /view-model.json -> compact server read-model for viewer v2. It is derived from
  // the board plus read-only decision sidecar scans; it never writes the board or sidecars.
  if (urlPath === '/view-model.json') {
    if (!hasAccessToken(parsedUrl)) {
      sendForbidden(res);
      return;
    }
    const selectedBoardPath = resolveRequestedBoardPath(parsedUrl);
    if (!selectedBoardPath) {
      sendNotFound(res);
      return;
    }
    let snapshot;
    let model;
    try {
      snapshot = readBoardSnapshot(selectedBoardPath);
      model = buildViewModel(snapshot);
    } catch (_e) {
      sendNotFound(res);
      return;
    }
    const etag = makeEtag('view-model', viewModelStateHash(model));
    if (requestHasEtag(req, etag)) {
      sendNotModified(res, etag);
      return;
    }
    res.writeHead(200, securityHeaders({
      'Content-Type': CONTENT_TYPES['.json'],
      ETag: etag,
    }));
    res.end(JSON.stringify(model));
    return;
  }

  if (urlPath === '/boards.json') {
    if (!hasAccessToken(parsedUrl)) {
      sendForbidden(res);
      return;
    }
    const payload = buildBoardsPayload();
    const etag = makeEtag('boards', sha256Hex(JSON.stringify(payload)));
    if (requestHasEtag(req, etag)) {
      sendNotModified(res, etag);
      return;
    }
    res.writeHead(200, securityHeaders({
      'Content-Type': CONTENT_TYPES['.json'],
      ETag: etag,
    }));
    res.end(JSON.stringify(payload));
    return;
  }

  if (urlPath === '/peers.json') {
    if (!hasAccessToken(parsedUrl)) {
      sendForbidden(res);
      return;
    }
    const payload = buildPeersPayload();
    const etag = makeEtag('peers', sha256Hex(JSON.stringify(payload)));
    if (requestHasEtag(req, etag)) {
      sendNotModified(res, etag);
      return;
    }
    res.writeHead(200, securityHeaders({
      'Content-Type': CONTENT_TYPES['.json'],
      ETag: etag,
    }));
    res.end(JSON.stringify(payload));
    return;
  }

  // GET /decisions.json -> scan the board home for discuss sidecars (*.decision.md) and
  // return them as a pinned-shape JSON array. Read-only, single dir level, no symlink
  // follow-out (mirrors /vendor/* containment). Any unreadable/torn/unparseable file is
  // skipped; a missing home or zero sidecars yields [] (200) — graceful, never 500.
  if (urlPath === '/decisions.json') {
    if (!hasAccessToken(parsedUrl)) {
      sendForbidden(res);
      return;
    }
    const selectedBoardPath = resolveRequestedBoardPath(parsedUrl);
    if (!selectedBoardPath) {
      sendNotFound(res);
      return;
    }
    let payload;
    try {
      payload = collectDecisions(selectedBoardPath);
    } catch (_e) {
      payload = []; // defensive: any unexpected failure degrades to empty, not 500.
    }
    res.writeHead(200, securityHeaders({
      'Content-Type': CONTENT_TYPES['.json'],
    }));
    res.end(JSON.stringify(payload));
    return;
  }

  // GET /vendor/* -> serve locally vendored assets, guarded against path traversal.
  // This now also covers the shared graph-analysis core: /vendor/ccm-engine.iife.js (the
  // @ccm/engine IIFE that publishes globalThis.__ccmEngine). The viewer loads it as ONE
  // classic <script> so analyze() reuses the same analyzeGraph() (DRY). Read-only, no network.
  if (urlPath.startsWith('/vendor/')) {
    const rel = urlPath.slice('/vendor/'.length);
    const resolved = path.resolve(VENDOR_DIR, rel);
    // Containment check: resolved must stay inside VENDOR_DIR.
    if (resolved !== VENDOR_DIR && !resolved.startsWith(VENDOR_DIR + path.sep)) {
      sendNotFound(res);
      return;
    }
    fs.readFile(resolved, (err, buf) => {
      if (err) {
        sendNotFound(res);
        return;
      }
      res.writeHead(200, securityHeaders({
        'Content-Type': contentType(resolved),
      }));
      res.end(buf);
    });
    return;
  }

  sendNotFound(res);
});

// listen(0) => OS assigns a free port. Bind 127.0.0.1 only (no external exposure).
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  // Exactly one machine-scrapeable line.
  console.log('cc-master board view: http://127.0.0.1:' + port + '/?token=' + ACCESS_TOKEN);
});

server.on('error', (err) => {
  console.error('cc-master board view: ERROR — ' + err.message);
  process.exit(1);
});
