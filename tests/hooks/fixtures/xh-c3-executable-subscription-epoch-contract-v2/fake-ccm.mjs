#!/usr/bin/env node

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
const argv = process.argv.slice(2);
const capture = process.env.CCM_XH_C3_CAPTURE || '';
const phase = process.env.CCM_XH_C3_PHASE || 'hook';
const host = process.env.CCM_XH_C3_HOST || 'unknown';
const sessionId = process.env.CCM_XH_C3_SESSION_ID || 'sess-exact';
const testCase = JSON.parse(process.env.CCM_XH_C3_CASE || '{"phase":"hook","family":"standalone","name":"success"}');
const home = resolve(process.env.CC_MASTER_HOME || join(process.env.HOME || '.', '.cc_master'));
const contract = manifest.contract;

function value(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : '';
}

function same(actual, expected) {
  return actual.length === expected.length && actual.every((item, index) => item === expected[index]);
}

function absoluteBoard(valueToCheck) {
  return typeof valueToCheck === 'string' && valueToCheck.startsWith('/') && valueToCheck.endsWith('.board.json');
}

function expectedRegister(board) {
  return [
    'coordination',
    'subscription',
    'register',
    '--board',
    board,
    '--origin',
    host,
    '--session-id',
    sessionId,
    '--capability',
    contract.capability,
    '--json',
    '--no-input',
  ];
}

function expectedCurrent(board) {
  return [
    'coordination',
    'subscription',
    'current',
    '--board',
    board,
    '--origin',
    host,
    '--session-id',
    sessionId,
    '--capability',
    contract.capability,
    '--json',
    '--no-input',
  ];
}

function expectedList(board, epoch) {
  return [
    'coordination',
    'inbox',
    'list',
    '--current-subscription',
    '--board',
    board,
    '--origin',
    host,
    '--session-id',
    sessionId,
    '--session-epoch',
    epoch,
    '--capability',
    contract.capability,
    '--unconsumed',
    '--json',
    '--no-input',
  ];
}

function classifyBootstrap() {
  if (same(argv, ['--version'])) return 'version';
  if (same(argv, ['board', 'init', '--capabilities', '--json', '--no-input'])) return 'board-init-capabilities';
  if (same(argv, ['board', 'init', '--json'])) return 'board-init';
  if (
    argv.length === 6 &&
    argv[0] === '--board' &&
    absoluteBoard(argv[1]) &&
    same(argv.slice(2), ['board', 'init', '--json', '--no-input'])
  ) {
    return 'board-init';
  }
  if (
    argv.length >= 8 &&
    argv[0] === '--board' &&
    absoluteBoard(argv[1]) &&
    argv[2] === 'board' &&
    argv[3] === 'init' &&
    argv[4] === '--goal' &&
    argv[6] === '--json' &&
    argv[7] === '--no-input' &&
    argv.length === 8
  ) {
    return 'board-init';
  }
  if (
    argv.length === 5 &&
    argv[0] === 'board' &&
    argv[1] === 'stamp-harness' &&
    argv[2] === '--board' &&
    absoluteBoard(argv[3]) &&
    argv[4] === '--json'
  ) {
    return 'board-stamp-harness';
  }
  if (
    argv.length === 6 &&
    argv[0] === '--board' &&
    absoluteBoard(argv[1]) &&
    same(argv.slice(2), ['board', 'stamp-harness', '--json', '--no-input'])
  ) {
    return 'board-stamp-harness';
  }
  const board = value('--board');
  if (absoluteBoard(board) && same(argv, expectedRegister(board))) return 'subscription-register';
  return 'rejected';
}

function classifyHook() {
  const board = value('--board');
  if (absoluteBoard(board) && same(argv, expectedCurrent(board))) return 'subscription-current';
  if (absoluteBoard(board) && same(argv, expectedList(board, value('--session-epoch')))) {
    if (value('--session-epoch') !== contract.session_epoch) return 'rejected';
    return 'bounded-inbox-list';
  }
  return 'rejected';
}

const commandKind = phase === 'bootstrap' ? classifyBootstrap() : classifyHook();
const allowed = commandKind !== 'rejected';

if (capture) {
  mkdirSync(dirname(capture), { recursive: true });
  appendFileSync(
    capture,
    `${JSON.stringify({ type: 'ccm', phase, case_id: testCase.id || '', command_kind: commandKind, allowed, argv })}\n`,
  );
}

function reply(data) {
  process.stdout.write(`${JSON.stringify({ ok: true, data })}\n`);
}

function fail(code, message) {
  process.stderr.write(`${message || 'fixture failure'}\n`);
  process.exit(code);
}

if (!allowed) fail(23, `fixture closed allowlist rejected ${JSON.stringify(argv)}`);

if (commandKind === 'version') {
  process.stdout.write('ccm 99.0.0-fixture\n');
  process.exit(0);
}

if (commandKind === 'board-init-capabilities') {
  reply({ capabilities: ['board-init/structured-board-path-v1', 'goal-contract/v1'] });
  process.exit(0);
}

if (commandKind === 'board-init') {
  const explicit = value('--board');
  const boardPath = resolve(explicit || join(home, 'boards', `fixture-${process.pid}.board.json`));
  mkdirSync(dirname(boardPath), { recursive: true });
  writeFileSync(
    boardPath,
    `${JSON.stringify(
      {
        schema: 'cc-master/v2',
        goal: value('--goal') || '',
        owner: { active: true, session_id: '', heartbeat: '2026-07-15T00:00:00Z' },
        git: {},
        tasks: [],
        log: [],
      },
      null,
      2,
    )}\n`,
  );
  reply({ board_path: boardPath });
  process.exit(0);
}

if (commandKind === 'board-stamp-harness') {
  reply({ updated: true });
  process.exit(0);
}

function baseSubscription(state = 'current') {
  return {
    subscription_id: contract.subscription_id,
    session_id: sessionId,
    session_epoch: contract.session_epoch,
    origin: host,
    capability: contract.capability,
    state,
  };
}

function mutate(object, field, mutation) {
  if (mutation === 'missing') delete object[field];
  else if (mutation === 'empty') object[field] = '';
  else if (mutation === 'wrong-type') object[field] = 17;
  else if (mutation === 'mismatch') object[field] = `wrong-${String(object[field] || field)}`;
}

if (commandKind === 'subscription-register') {
  if (testCase.family === 'standalone' && testCase.name === 'registration-failure') {
    fail(9, 'fixture registration failure');
  }
  if (testCase.family === 'standalone' && testCase.name === 'register-malformed-json') {
    process.stdout.write('{not-json\n');
    process.exit(0);
  }
  const subscription = baseSubscription();
  if (testCase.family === 'register_response') mutate(subscription, testCase.field, testCase.mutation);
  reply({ subscription });
  process.exit(0);
}

if (commandKind === 'subscription-current') {
  if (testCase.phase === 'bootstrap' && !(testCase.family === 'standalone' && testCase.name === 'success')) {
    reply({ subscription: baseSubscription('missing') });
    process.exit(0);
  }
  if (testCase.family === 'standalone' && testCase.name === 'current-command-failure') {
    fail(10, 'fixture current failure');
  }
  if (testCase.family === 'standalone' && testCase.name === 'current-malformed-json') {
    process.stdout.write('{not-json\n');
    process.exit(0);
  }
  const subscription = baseSubscription(
    testCase.family === 'standalone' && testCase.name === 'stale-epoch' ? 'stale' : 'current',
  );
  if (testCase.family === 'current_response') mutate(subscription, testCase.field, testCase.mutation);
  reply({ subscription });
  process.exit(0);
}

if (commandKind === 'bounded-inbox-list') {
  if (testCase.family === 'standalone' && testCase.name === 'list-command-failure') {
    fail(11, 'fixture list failure');
  }
  if (testCase.family === 'standalone' && testCase.name === 'list-malformed-json') {
    process.stdout.write('{not-json\n');
    process.exit(0);
  }
  const subscription = baseSubscription();
  delete subscription.state;
  if (testCase.family === 'list_response') mutate(subscription, testCase.field, testCase.mutation);
  const provenance = {
    subscription_id: contract.subscription_id,
    session_id: sessionId,
    session_epoch: contract.session_epoch,
    origin: host,
    capability: contract.capability,
    source_policy_revision: contract.source_policy_revision,
    consent_provenance_ref: contract.consent_provenance_ref,
  };
  if (testCase.family === 'delivery_provenance') mutate(provenance, testCase.field, testCase.mutation);
  reply({
    subscription,
    count: 1,
    inbox: [
      {
        id: 'ntf-exact',
        kind: 'pacing_throttle',
        status: 'unconsumed',
        strength: 'strong',
        summary: 'exact subscription notification',
        delivery_provenance: provenance,
      },
    ],
  });
  process.exit(0);
}

fail(24, 'fixture reached an impossible command branch');
