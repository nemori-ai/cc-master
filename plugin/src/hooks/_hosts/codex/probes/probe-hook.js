#!/usr/bin/env node
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
const event = process.env.CC_MASTER_CODEX_HOOK_PROBE_EVENT || 'unknown';
const mode = process.env.CC_MASTER_CODEX_HOOK_PROBE_MODE || 'silent';
const root = process.env.CC_MASTER_CODEX_HOOK_PROBE_DIR ||
  path.join(os.tmpdir(), 'cc-master-codex-hook-probes');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(root, safeName(event));
fs.mkdirSync(outDir, { recursive: true });

const record = {
  recorded_at: new Date().toISOString(),
  event,
  mode,
  argv: process.argv,
  cwd: process.cwd(),
  env_subset: Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => /^(CODEX|CC_MASTER|PLUGIN|CLAUDE_PLUGIN|PWD|HOME|SHELL|TMPDIR|PATH)\b/.test(key))
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
  const text = `cc-master Codex hook probe ${event}: context mode`;
  process.stdout.write(`{"hookSpecificOutput":{"hookEventName":${jsonEscape(event)},"additionalContext":${jsonEscape(text)}}}\n`);
} else if (mode === 'block') {
  const reason = `cc-master Codex hook probe ${event}: block mode`;
  process.stdout.write(`{"decision":"block","reason":${jsonEscape(reason)}}\n`);
} else if (mode === 'exit2') {
  process.stderr.write(`cc-master Codex hook probe ${event}: exit2 mode\n`);
  process.exit(2);
} else if (mode === 'system-message') {
  const message = `cc-master Codex hook probe ${event}: system-message mode`;
  process.stdout.write(`{"systemMessage":${jsonEscape(message)}}\n`);
}
