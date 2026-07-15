#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

const invokedAs = basename(process.argv[1] || 'unknown');
const argv = process.argv.slice(2);
const logPath = process.env.CCM_XH_C3_EFFECT_LOG;
const schema = process.env.CCM_XH_C3_ALLOWED_CCM_SCHEMA || '';
const harness = process.env.CCM_XH_C3_HARNESS || '';
if (!logPath) process.exit(91);

function boardPath(value) {
  return typeof value === 'string' && isAbsolute(value) && value.endsWith('.board.json');
}

function isoInstant(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value);
}

function armShape(args) {
  if (
    args.length === 5 &&
    args[0] === 'board' &&
    args[1] === 'init' &&
    args[2] === '--capabilities' &&
    args[3] === '--json' &&
    args[4] === '--no-input'
  ) return true;
  if (harness === 'claude-code') {
    if (args.length === 3 && args[0] === 'board' && args[1] === 'init' && args[2] === '--json') {
      return true;
    }
    return (
      args.length === 5 &&
      args[0] === 'board' &&
      args[1] === 'stamp-harness' &&
      args[2] === '--board' &&
      boardPath(args[3]) &&
      args[4] === '--json'
    );
  }
  return (
    args.length === 6 &&
    args[0] === '--board' &&
    boardPath(args[1]) &&
    args[2] === 'board' &&
    (args[3] === 'init' || args[3] === 'stamp-harness') &&
    args[4] === '--json' &&
    args[5] === '--no-input'
  );
}

function reinjectShape(args) {
  return (
    args.length === 6 &&
    args[0] === 'goal' &&
    args[1] === 'check' &&
    args[2] === '--board' &&
    boardPath(args[3]) &&
    args[4] === '--json' &&
    args[5] === '--no-input'
  );
}

function contextShape(args) {
  const base =
    args.length >= 11 &&
    args[0] === 'orchestrator' &&
    args[1] === 'context' &&
    args[2] === '--cached-only' &&
    args[3] === '--agent-visible' &&
    args[4] === '--as-of' &&
    isoInstant(args[5]) &&
    args[6] === '--harness' &&
    args[7] === harness &&
    args[8] === '--board' &&
    boardPath(args[9]) &&
    args[10] === '--json';
  if (!base) return false;
  if (args.length === 11) return true;
  return (
    args.length === 13 &&
    args[11] === '--snapshot' &&
    typeof args[12] === 'string' &&
    args[12].startsWith('@') &&
    isAbsolute(args[12].slice(1))
  );
}

const allowed =
  invokedAs === 'ccm' &&
  ((schema === 'arm' && armShape(argv)) ||
    (schema === 'reinject' && reinjectShape(argv)) ||
    (schema === 'orchestrator-context' && contextShape(argv)));
appendFileSync(
  logPath,
  `${JSON.stringify({ invoked_as: invokedAs, argv, schema, allowed })}\n`,
);
if (!allowed) {
  process.stderr.write(`CLOSED_EFFECT_SANDBOX: ccm argv denied for ${schema || 'unknown-event'}\n`);
  process.exit(invokedAs === 'ccm' ? 95 : 93);
}

if (argv[0] === 'board' && argv[1] === 'init' && argv[2] === '--capabilities') {
  process.stdout.write(
    `${JSON.stringify({ ok: true, data: { capabilities: ['board-init/structured-board-path-v1', 'goal-contract/v1'] } })}\n`,
  );
  process.exit(0);
}

const boardFlag = argv.indexOf('--board');
const resolvedBoard = boardFlag >= 0 && argv[boardFlag + 1] ? resolve(argv[boardFlag + 1]) : '';
const boardNoun = argv.indexOf('board');
const boardVerb = boardNoun >= 0 ? argv[boardNoun + 1] : '';

if (boardVerb === 'init') {
  const output =
    resolvedBoard ||
    join(resolve(process.env.CC_MASTER_HOME || ''), 'boards', 'fixture-fresh.board.json');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(
    output,
    `${JSON.stringify(
      {
        schema: 'cc-master-board/v2',
        goal: '',
        goal_contract: {
          schema: 'ccm/goal-contract/v1',
          status: 'pending',
          raw_request: 'fixture',
        },
        owner: { active: true, session_id: '', heartbeat: '1970-01-01T00:00:00Z' },
        git: { repo: '', branch: '', base: '' },
        tasks: [],
        log: [],
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`${JSON.stringify({ ok: true, data: { board_path: output } })}\n`);
  process.exit(0);
}

if (boardVerb === 'stamp-harness') {
  if (resolvedBoard) {
    try {
      const board = JSON.parse(readFileSync(resolvedBoard, 'utf8'));
      const sessionFlag = argv.indexOf('--session-id');
      if (sessionFlag >= 0 && argv[sessionFlag + 1]) {
        board.owner.session_id = argv[sessionFlag + 1];
      }
      board.owner.active = true;
      writeFileSync(resolvedBoard, `${JSON.stringify(board, null, 2)}\n`);
    } catch {
      // The hook remains responsible for validating its own board lifecycle result.
    }
  }
  process.stdout.write(`${JSON.stringify({ ok: true, data: {} })}\n`);
  process.exit(0);
}

if (argv[0] === 'orchestrator' && argv[1] === 'context') {
  process.stdout.write(`${JSON.stringify({ ok: true, data: { unavailable: true } })}\n`);
  process.exit(0);
}

if (argv[0] === 'goal' && argv[1] === 'check') {
  process.stdout.write(`${JSON.stringify({ ok: true, data: { verdict: 'pending' } })}\n`);
  process.exit(0);
}

process.stderr.write('CLOSED_EFFECT_SANDBOX: allowed ccm argv lacks fixture response\n');
process.exit(96);
