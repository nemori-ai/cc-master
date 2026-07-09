#!/usr/bin/env node
/**
 * Cursor hook probe — capture stdin/env/cwd/argv to JSON fixtures.
 * Modes (CC_MASTER_CURSOR_HOOK_PROBE_MODE):
 *   silent | context | followup | deny | exit2
 */
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

function safeName(value) {
  return String(value || 'unknown').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
}

function jsonEscape(value) {
  return JSON.stringify(String(value || ''));
}

const stdin = readStdin();
const event = process.env.CC_MASTER_CURSOR_HOOK_PROBE_EVENT || 'unknown';
const mode = process.env.CC_MASTER_CURSOR_HOOK_PROBE_MODE || 'silent';
const root = process.env.CC_MASTER_CURSOR_HOOK_PROBE_DIR ||
  path.join(os.tmpdir(), 'cc-master-cursor-hook-probes');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(root, safeName(event));
fs.mkdirSync(outDir, { recursive: true });

const record = {
  recorded_at: new Date().toISOString(),
  event,
  mode,
  argv: process.argv,
  cwd: process.cwd(),
  node: process.version,
  which_node_hint: process.execPath,
  env_subset: Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => /^(CURSOR|CC_MASTER|PLUGIN|CLAUDE_PLUGIN|PWD|HOME|SHELL|TMPDIR|PATH|USER)\b/.test(key))
    .sort(([a], [b]) => a.localeCompare(b))),
  stdin_text: stdin,
  stdin_json: null,
};

try {
  record.stdin_json = stdin ? JSON.parse(stdin) : null;
} catch (error) {
  record.stdin_json_error = error && error.message ? error.message : String(error);
}

fs.writeFileSync(
  path.join(outDir, `${stamp}-${process.pid}.json`),
  `${JSON.stringify(record, null, 2)}\n`,
);

if (mode === 'context') {
  const text = `[cc-master cursor probe] ${event}: additional_context mode — if you see this in the agent reply, D4/D5 PASS.`;
  process.stdout.write(`{"additional_context":${jsonEscape(text)}}\n`);
} else if (mode === 'followup') {
  const text = `[cc-master cursor probe] ${event}: followup_message mode — reply exactly: PROBE_FOLLOWUP_OK`;
  process.stdout.write(`{"followup_message":${jsonEscape(text)}}\n`);
} else if (mode === 'deny') {
  process.stdout.write(`{"permission":"deny","user_message":"cc-master cursor probe ${event}: deny mode"}\n`);
} else if (mode === 'exit2') {
  process.stderr.write(`cc-master cursor probe ${event}: exit2 mode\n`);
  process.exit(2);
}
// silent: capture only, empty stdout
