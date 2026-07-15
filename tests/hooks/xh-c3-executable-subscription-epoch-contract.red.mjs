#!/usr/bin/env node

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const runnerPath = fileURLToPath(import.meta.url);
const defaultRoot = resolve(here, '..', '..');
const root = resolve(process.env.CCM_XH_C3_TARGET_ROOT || defaultRoot);
const fixtureDir = join(here, 'fixtures', 'xh-c3-executable-subscription-epoch-contract-v2');
const manifest = JSON.parse(readFileSync(join(fixtureDir, 'manifest.json'), 'utf8'));
const fakeCcm = join(fixtureDir, 'fake-ccm.mjs');
const effectSentinel = join(fixtureDir, 'effect-sentinel.cjs');
const knownGoodEntry = join(fixtureDir, 'known-good-entry.mjs');
const fixtureOnly = process.argv.includes('--fixture-self-test');
const calibrateCounterfeits = process.argv.includes('--counterfeit-calibration');
const caseFilter = process.env.CCM_XH_C3_CASE_FILTER || '';
const contract = manifest.contract;
const failures = [];
const executedCases = new Set();
const executedProbes = new Set();

function entryPath(host, key) {
  const value = manifest.entry_paths[host][key];
  return value.startsWith('plugin/') ? join(root, value) : join(fixtureDir, value);
}

const productionHosts = {
  'claude-code': {
    origin: 'claude-code',
    bootstrap: ['/usr/bin/bash', entryPath('claude-code', 'production_bootstrap')],
    hook: [process.execPath, entryPath('claude-code', 'production_hook')],
    bootstrapInput(sessionId) {
      return {
        session_id: sessionId,
        hook_event_name: 'UserPromptSubmit',
        prompt: '/cc-master:as-master-orchestrator transport-contract',
      };
    },
    hookInput(sessionId) {
      return { session_id: sessionId, hook_event_name: 'Stop' };
    },
  },
  codex: {
    origin: 'codex',
    bootstrap: [
      'node',
      entryPath('codex', 'launcher'),
      '--event',
      'UserPromptSubmit',
      '--core',
      entryPath('codex', 'production_bootstrap'),
    ],
    hook: [
      'node',
      entryPath('codex', 'launcher'),
      '--event',
      'Stop',
      '--core',
      entryPath('codex', 'production_hook'),
    ],
    bootstrapInput(sessionId) {
      return {
        session_id: sessionId,
        hook_event_name: 'UserPromptSubmit',
        prompt: '$cc-master-as-master-orchestrator transport-contract',
      };
    },
    hookInput(sessionId) {
      return { session_id: sessionId, hook_event_name: 'Stop' };
    },
  },
  cursor: {
    origin: 'cursor',
    bootstrap: [
      'node',
      entryPath('cursor', 'launcher'),
      '--event',
      'beforeSubmitPrompt',
      '--core',
      entryPath('cursor', 'production_bootstrap'),
    ],
    hook: [
      'node',
      entryPath('cursor', 'launcher'),
      '--event',
      'stop',
      '--core',
      entryPath('cursor', 'production_hook'),
    ],
    bootstrapInput(sessionId) {
      return {
        conversation_id: sessionId,
        session_id: sessionId,
        hook_event_name: 'beforeSubmitPrompt',
        prompt: '/cc-master-as-master-orchestrator transport-contract',
      };
    },
    hookInput(sessionId) {
      return {
        conversation_id: sessionId,
        session_id: sessionId,
        hook_event_name: 'stop',
      };
    },
  },
};

function fixtureHosts() {
  return {
    'claude-code': {
      ...productionHosts['claude-code'],
      bootstrap: [process.execPath, entryPath('claude-code', 'known_good_bootstrap')],
      hook: [process.execPath, entryPath('claude-code', 'known_good_hook')],
    },
    codex: {
      ...productionHosts.codex,
      bootstrap: [
        process.execPath,
        entryPath('codex', 'launcher'),
        '--event',
        'UserPromptSubmit',
        '--core',
        entryPath('codex', 'known_good_bootstrap'),
      ],
      hook: [
        process.execPath,
        entryPath('codex', 'launcher'),
        '--event',
        'Stop',
        '--core',
        entryPath('codex', 'known_good_hook'),
      ],
    },
    cursor: {
      ...productionHosts.cursor,
      bootstrap: [
        process.execPath,
        entryPath('cursor', 'launcher'),
        '--event',
        'beforeSubmitPrompt',
        '--core',
        entryPath('cursor', 'known_good_bootstrap'),
      ],
      hook: [
        process.execPath,
        entryPath('cursor', 'launcher'),
        '--event',
        'stop',
        '--core',
        entryPath('cursor', 'known_good_hook'),
      ],
    },
  };
}

const hosts = fixtureOnly ? fixtureHosts() : productionHosts;

function fail(label, detail) {
  failures.push(`${label}: ${detail}`);
}

function assert(label, condition, detail) {
  if (!condition) fail(label, detail);
}

function expandCases() {
  const cases = [];
  for (const phase of ['bootstrap', 'hook']) {
    const families = manifest.case_families[phase];
    for (const name of families.standalone) {
      cases.push({ id: `${phase}:${name}`, phase, family: 'standalone', name });
    }
    for (const [family, schema] of Object.entries(families)) {
      if (family === 'standalone') continue;
      for (const [field, mutations] of Object.entries(schema)) {
        for (const mutation of mutations) {
          cases.push({ id: `${phase}:${family}:${field}:${mutation}`, phase, family, field, mutation });
        }
      }
    }
  }
  return cases;
}

const cases = expandCases();
const selectedCases = caseFilter ? cases.filter((item) => item.id === caseFilter) : cases;

function expectedProbeNames(testCase) {
  if (testCase.phase === 'bootstrap') {
    const names = [
      'bootstrap-spawn',
      'owner-preserved',
      'register-command',
      'closed-ccm-allowlist',
      'zero-effects',
    ];
    if (!(testCase.family === 'standalone' && testCase.name === 'success')) {
      names.push(
        'no-fallback-artifact',
        'post-failure-hook-spawn',
        'post-failure-current',
        'post-failure-no-list',
        'post-failure-silent',
      );
    }
    return names;
  }
  const names = ['hook-spawn', 'current-command', 'closed-ccm-allowlist', 'zero-effects'];
  if (hookExpectsList(testCase)) names.push('bounded-list-command');
  else names.push('no-list');
  names.push(hookExpectsSurface(testCase) ? 'host-native-surface-once' : 'silent');
  return names;
}

function caseKey(host, testCase) {
  return `${host}:${testCase.id}`;
}

function probe(host, testCase, name, condition, detail) {
  executedProbes.add(`${caseKey(host, testCase)}:${name}`);
  assert(`${caseKey(host, testCase)}/${name}`, condition, detail);
}

function validateManifest() {
  assert('manifest/schema', manifest.schema.endsWith('/v2'), manifest.schema || '(missing)');
  assert(
    'manifest/hosts',
    JSON.stringify(manifest.hosts) === JSON.stringify(['claude-code', 'codex', 'cursor']),
    JSON.stringify(manifest.hosts),
  );
  assert(
    'manifest/provenance-fields',
    JSON.stringify(contract.provenance_fields) ===
      JSON.stringify([
        'subscription_id',
        'session_id',
        'session_epoch',
        'origin',
        'capability',
        'source_policy_revision',
        'consent_provenance_ref',
      ]),
    JSON.stringify(contract.provenance_fields),
  );
  assert('manifest/case-ids-unique', new Set(cases.map((item) => item.id)).size === cases.length, 'duplicate case id');
  assert(
    'manifest/case-filter-reachable',
    !caseFilter || selectedCases.length === 1,
    caseFilter || '(none)',
  );
  for (const host of manifest.hosts) {
    const entries = manifest.entry_paths[host];
    assert(`manifest/entry-paths/${host}`, !!entries && typeof entries === 'object', JSON.stringify(entries));
    if (!entries) continue;
    for (const key of ['production_bootstrap', 'production_hook', 'known_good_bootstrap', 'known_good_hook']) {
      assert(`manifest/entry-paths/${host}/${key}`, typeof entries[key] === 'string' && !!entries[key], String(entries[key]));
    }
  }
}

function makeSandbox(host, testCase) {
  const safeCase = testCase.id.replace(/[^a-z0-9]+/gi, '-').slice(0, 60);
  const base = mkdtempSync(join(tmpdir(), `ccm-xh-c3-${host}-${safeCase}-`));
  const home = join(base, 'home');
  const bin = join(base, 'bin');
  const capture = join(base, 'ccm-capture.jsonl');
  const effectCapture = join(base, 'effect-capture.jsonl');
  const tmp = join(base, 'tmp');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(tmp, { recursive: true });
  const wrapper = join(bin, 'ccm');
  writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${fakeCcm}" "$@"\n`);
  chmodSync(wrapper, 0o755);
  const nodeWrapper = join(bin, 'node');
  writeFileSync(nodeWrapper, `#!/bin/sh\nexec "${process.execPath}" "$@"\n`);
  chmodSync(nodeWrapper, 0o755);
  for (const name of [
    'awk',
    'basename',
    'cat',
    'cp',
    'cut',
    'date',
    'dirname',
    'find',
    'grep',
    'head',
    'mkdir',
    'mktemp',
    'mv',
    'readlink',
    'realpath',
    'rm',
    'sed',
    'sort',
    'stat',
    'tail',
    'tr',
  ]) {
    const system = existsSync(`/usr/bin/${name}`) ? `/usr/bin/${name}` : `/bin/${name}`;
    assert(`sandbox/system-command/${name}`, existsSync(system), system);
    const allowed = join(bin, name);
    writeFileSync(allowed, `#!/bin/sh\nexec "${system}" "$@"\n`);
    chmodSync(allowed, 0o755);
  }
  for (const name of manifest.shell_effect_traps) {
    const sentinel = join(bin, name);
    writeFileSync(
      sentinel,
      `#!/bin/sh\nprintf '%s\\n' '{"type":"effect","kind":"process","detail":"${name}"}' >> "$CCM_XH_C3_EFFECT_CAPTURE"\nexit 97\n`,
    );
    chmodSync(sentinel, 0o755);
  }
  return { base, home, bin, capture, effectCapture, tmp, wrapper };
}

function envFor(sandbox, host, testCase, sessionId, phase, board = '') {
  const nodeOptions = `--require=${effectSentinel}`;
  const config = hosts[host];
  const childPaths = new Set([sandbox.wrapper, knownGoodEntry]);
  for (const command of [config.bootstrap, config.hook]) {
    for (const token of command) {
      if (typeof token === 'string' && token.startsWith('/') && existsSync(token)) childPaths.add(token);
    }
  }
  return {
    PATH: sandbox.bin,
    HOME: sandbox.home,
    TMPDIR: sandbox.tmp,
    XDG_CONFIG_HOME: join(sandbox.home, '.config'),
    XDG_CACHE_HOME: join(sandbox.home, '.cache'),
    XDG_DATA_HOME: join(sandbox.home, '.local', 'share'),
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    NODE_OPTIONS: nodeOptions,
    CCM_BIN: sandbox.wrapper,
    CC_MASTER_HOME: sandbox.home,
    CC_MASTER_INBOX_SURFACE_STATE: join(sandbox.base, 'surface-state.json'),
    CC_MASTER_INBOX_SURFACE_COOLDOWN_SEC: '0',
    CC_MASTER_NOW: '2026-07-15T00:01:00Z',
    CC_MASTER_PLUGIN_ROOT: join(root, `plugin/dist/${host}`),
    CLAUDE_PROJECT_DIR: root,
    CLAUDE_CONFIG_DIR: join(sandbox.home, '.claude'),
    CCM_XH_C3_CAPTURE: sandbox.capture,
    CCM_XH_C3_EFFECT_CAPTURE: sandbox.effectCapture,
    CCM_XH_C3_ALLOWED_CHILDREN_JSON: JSON.stringify([...childPaths]),
    CCM_XH_C3_PHASE: phase,
    CCM_XH_C3_HOST: host,
    CCM_XH_C3_SESSION_ID: sessionId,
    CCM_XH_C3_CASE: JSON.stringify(testCase),
    CCM_XH_C3_COUNTERFEIT: process.env.CCM_XH_C3_COUNTERFEIT || '',
    CCM_XH_C3_BOARD: board,
    HTTP_PROXY: 'http://127.0.0.1:9',
    HTTPS_PROXY: 'http://127.0.0.1:9',
    ALL_PROXY: 'socks5://127.0.0.1:9',
    NO_PROXY: '127.0.0.1,localhost',
    http_proxy: 'http://127.0.0.1:9',
    https_proxy: 'http://127.0.0.1:9',
    all_proxy: 'socks5://127.0.0.1:9',
    no_proxy: '127.0.0.1,localhost',
    GIT_TERMINAL_PROMPT: '0',
    AWS_EC2_METADATA_DISABLED: 'true',
  };
}

function spawnEntry(command, input, env) {
  return spawnSync(command[0], command.slice(1), {
    cwd: root,
    input: `${JSON.stringify(input)}\n`,
    encoding: 'utf8',
    timeout: 20000,
    env,
  });
}

function jsonLines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function ccmRows(sandbox) {
  return jsonLines(sandbox.capture).filter((row) => row.type === 'ccm');
}

function effectRows(sandbox) {
  return jsonLines(sandbox.effectCapture).filter((row) => row.type === 'effect');
}

function rowsSince(rows, start) {
  return rows.slice(start);
}

function commandRows(rows, kind) {
  return rows.filter((row) => row.command_kind === kind);
}

function sameArgv(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function expectedRegister(board, host, sessionId) {
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

function expectedCurrent(board, host, sessionId) {
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

function expectedList(board, host, sessionId) {
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
    contract.session_epoch,
    '--capability',
    contract.capability,
    '--unconsumed',
    '--json',
    '--no-input',
  ];
}

function findBoard(home) {
  const boards = join(home, 'boards');
  if (!existsSync(boards)) return '';
  const found = readdirSync(boards)
    .filter((name) => name.endsWith('.board.json'))
    .sort();
  return found.length === 1 ? join(boards, found[0]) : '';
}

function readBoard(board) {
  try {
    return JSON.parse(readFileSync(board, 'utf8'));
  } catch {
    return null;
  }
}

function seedBoard(home, sessionId) {
  const boards = join(home, 'boards');
  mkdirSync(boards, { recursive: true });
  const board = join(boards, 'armed.board.json');
  writeFileSync(
    board,
    `${JSON.stringify({
      schema: 'cc-master/v2',
      goal: 'transport contract fixture',
      owner: { active: true, session_id: sessionId, heartbeat: '2026-07-15T00:00:00Z' },
      git: {},
      tasks: [{ id: 'T1', status: 'in_flight', deps: [] }],
      log: [],
    })}\n`,
  );
  return board;
}

function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isDirectory()) out.push(...walkFiles(path));
    else if (stat.isFile()) out.push(path);
  }
  return out;
}

function fallbackArtifacts(home) {
  const needles = [contract.subscription_id, contract.session_epoch, `wrong-${contract.session_epoch}`];
  const hits = [];
  for (const file of walkFiles(home)) {
    let body = '';
    try {
      body = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (needles.some((needle) => body.includes(needle))) hits.push(file);
  }
  return hits;
}

function closedBootstrapRows(rows) {
  if (rows.some((row) => row.allowed !== true)) return false;
  const counts = Object.fromEntries(
    ['version', 'board-init-capabilities', 'board-init', 'board-stamp-harness', 'subscription-register'].map((kind) => [
      kind,
      commandRows(rows, kind).length,
    ]),
  );
  return (
    counts.version <= 1 &&
    counts['board-init-capabilities'] <= 1 &&
    counts['board-init'] === 1 &&
    counts['board-stamp-harness'] === 1 &&
    counts['subscription-register'] === 1 &&
    Object.values(counts).reduce((sum, count) => sum + count, 0) === rows.length
  );
}

function closedHookRows(rows, listCount) {
  return (
    rows.every((row) => row.allowed === true) &&
    commandRows(rows, 'subscription-current').length === 1 &&
    commandRows(rows, 'bounded-inbox-list').length === listCount &&
    rows.length === 1 + listCount
  );
}

function hookExpectsList(testCase) {
  if (testCase.family === 'list_response' || testCase.family === 'delivery_provenance') return true;
  return (
    testCase.family === 'standalone' &&
    ['success', 'list-command-failure', 'list-malformed-json'].includes(testCase.name)
  );
}

function hookExpectsSurface(testCase) {
  return testCase.family === 'standalone' && testCase.name === 'success';
}

function occurrenceCount(text, needle) {
  if (!needle) return 0;
  return String(text).split(needle).length - 1;
}

function nativeContext(host, stdout) {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) return { ok: false, detail: '(empty)' };
  let envelope;
  try {
    envelope = JSON.parse(trimmed);
  } catch (error) {
    return { ok: false, detail: `not one JSON envelope: ${error.message}` };
  }
  let context = '';
  if (host === 'claude-code') {
    const output = envelope && envelope.hookSpecificOutput;
    if (!output || output.hookEventName !== 'Stop') return { ok: false, detail: trimmed };
    context = output.additionalContext;
  } else if (host === 'codex') {
    context = envelope && envelope.systemMessage;
  } else if (host === 'cursor') {
    context = envelope && envelope.followup_message;
  }
  if (typeof context !== 'string' || !context) return { ok: false, detail: trimmed };
  const exactOnce = [
    'ntf-exact',
    contract.source_policy_revision,
    contract.consent_provenance_ref,
  ].every((needle) => occurrenceCount(context, needle) === 1);
  return { ok: exactOnce, detail: exactOnce ? context : trimmed };
}

function verifyBootstrap(hostName, testCase) {
  const host = hosts[hostName];
  const sessionId = `sess-${hostName}-${testCase.id.replace(/[^a-z0-9]+/gi, '-')}`;
  const sandbox = makeSandbox(hostName, testCase);
  try {
    const result = spawnEntry(
      host.bootstrap,
      host.bootstrapInput(sessionId),
      envFor(sandbox, hostName, testCase, sessionId, 'bootstrap'),
    );
    probe(
      hostName,
      testCase,
      'bootstrap-spawn',
      result.status === 0,
      `rc=${result.status} error=${result.error ? result.error.message : ''} stderr=${result.stderr}`,
    );
    const board = findBoard(sandbox.home);
    const boardBody = board ? readBoard(board) : null;
    probe(
      hostName,
      testCase,
      'owner-preserved',
      !!boardBody && boardBody.owner && boardBody.owner.active === true && boardBody.owner.session_id === sessionId,
      board ? JSON.stringify(boardBody && boardBody.owner) : 'bootstrap did not create exactly one board',
    );
    const rows = ccmRows(sandbox);
    const registrations = commandRows(rows, 'subscription-register');
    probe(
      hostName,
      testCase,
      'register-command',
      !!board && registrations.length === 1 && sameArgv(registrations[0].argv, expectedRegister(board, host.origin, sessionId)),
      JSON.stringify(registrations.map((row) => row.argv)),
    );
    probe(hostName, testCase, 'closed-ccm-allowlist', closedBootstrapRows(rows), JSON.stringify(rows));
    probe(hostName, testCase, 'zero-effects', effectRows(sandbox).length === 0, JSON.stringify(effectRows(sandbox)));

    const negative = !(testCase.family === 'standalone' && testCase.name === 'success');
    if (negative) {
      probe(
        hostName,
        testCase,
        'no-fallback-artifact',
        fallbackArtifacts(sandbox.home).length === 0,
        JSON.stringify(fallbackArtifacts(sandbox.home)),
      );
      const before = ccmRows(sandbox).length;
      const hookResult = spawnEntry(
        host.hook,
        host.hookInput(sessionId),
        envFor(sandbox, hostName, testCase, sessionId, 'hook', board),
      );
      probe(
        hostName,
        testCase,
        'post-failure-hook-spawn',
        hookResult.status === 0,
        `rc=${hookResult.status} error=${hookResult.error ? hookResult.error.message : ''} stderr=${hookResult.stderr}`,
      );
      const postRows = rowsSince(ccmRows(sandbox), before);
      const currents = commandRows(postRows, 'subscription-current');
      probe(
        hostName,
        testCase,
        'post-failure-current',
        currents.length === 1 && sameArgv(currents[0].argv, expectedCurrent(board, host.origin, sessionId)),
        JSON.stringify(postRows),
      );
      probe(
        hostName,
        testCase,
        'post-failure-no-list',
        closedHookRows(postRows, 0),
        JSON.stringify(postRows),
      );
      probe(
        hostName,
        testCase,
        'post-failure-silent',
        String(hookResult.stdout || '').trim() === '' && fallbackArtifacts(sandbox.home).length === 0,
        String(hookResult.stdout || '') || JSON.stringify(fallbackArtifacts(sandbox.home)),
      );
    }
    executedCases.add(caseKey(hostName, testCase));
  } finally {
    rmSync(sandbox.base, { recursive: true, force: true });
  }
}

function verifyHook(hostName, testCase) {
  const host = hosts[hostName];
  const sessionId = `sess-${hostName}-${testCase.id.replace(/[^a-z0-9]+/gi, '-')}`;
  const sandbox = makeSandbox(hostName, testCase);
  try {
    const board = seedBoard(sandbox.home, sessionId);
    const result = spawnEntry(
      host.hook,
      host.hookInput(sessionId),
      envFor(sandbox, hostName, testCase, sessionId, 'hook', board),
    );
    probe(
      hostName,
      testCase,
      'hook-spawn',
      result.status === 0,
      `rc=${result.status} error=${result.error ? result.error.message : ''} stderr=${result.stderr}`,
    );
    const rows = ccmRows(sandbox);
    const currents = commandRows(rows, 'subscription-current');
    probe(
      hostName,
      testCase,
      'current-command',
      currents.length === 1 && sameArgv(currents[0].argv, expectedCurrent(board, host.origin, sessionId)),
      `${JSON.stringify(rows)} stderr=${result.stderr || ''}`,
    );
    const listCount = hookExpectsList(testCase) ? 1 : 0;
    const lists = commandRows(rows, 'bounded-inbox-list');
    const listOk =
      listCount === 0
        ? lists.length === 0
        : lists.length === 1 && sameArgv(lists[0].argv, expectedList(board, host.origin, sessionId));
    probe(hostName, testCase, listCount ? 'bounded-list-command' : 'no-list', listOk, JSON.stringify(rows));
    probe(hostName, testCase, 'closed-ccm-allowlist', closedHookRows(rows, listCount), JSON.stringify(rows));
    probe(hostName, testCase, 'zero-effects', effectRows(sandbox).length === 0, JSON.stringify(effectRows(sandbox)));
    if (hookExpectsSurface(testCase)) {
      const native = nativeContext(hostName, result.stdout);
      probe(hostName, testCase, 'host-native-surface-once', native.ok, native.detail);
    } else {
      probe(
        hostName,
        testCase,
        'silent',
        String(result.stdout || '').trim() === '',
        String(result.stdout || '') || '(empty)',
      );
    }
    executedCases.add(caseKey(hostName, testCase));
  } finally {
    rmSync(sandbox.base, { recursive: true, force: true });
  }
}

function verifyDeclaredExecution() {
  const expectedCases = [];
  const expectedProbes = [];
  for (const host of manifest.hosts) {
    for (const testCase of selectedCases) {
      expectedCases.push(caseKey(host, testCase));
      for (const name of expectedProbeNames(testCase)) expectedProbes.push(`${caseKey(host, testCase)}:${name}`);
    }
  }
  const actualCases = [...executedCases].sort();
  const actualProbes = [...executedProbes].sort();
  assert(
    'manifest/executed-case-set-exact',
    JSON.stringify(actualCases) === JSON.stringify(expectedCases.sort()),
    `expected=${expectedCases.length} actual=${actualCases.length}`,
  );
  assert(
    'manifest/executed-probe-set-exact',
    JSON.stringify(actualProbes) === JSON.stringify(expectedProbes.sort()),
    `expected=${expectedProbes.length} actual=${actualProbes.length}`,
  );
}

function verifyBoundaryCalibration() {
  const testCase = { id: 'fixture:boundary-calibration', phase: 'hook', family: 'standalone', name: 'success' };
  const sandbox = makeSandbox('codex', testCase);
  const sessionId = 'sess-boundary-calibration';
  const board = seedBoard(sandbox.home, sessionId);
  const env = envFor(sandbox, 'codex', testCase, sessionId, 'hook', board);
  try {
    const unknown = spawnSync(sandbox.wrapper, ['coordination', 'remote', 'send'], { encoding: 'utf8', env });
    assert('fixture-boundary/unknown-ccm-rejected', unknown.status === 23, `rc=${unknown.status}`);
    const write = spawnSync(sandbox.wrapper, ['board', 'update', '--board', board, '--json'], {
      encoding: 'utf8',
      env,
    });
    assert('fixture-boundary/write-ccm-rejected', write.status === 23, `rc=${write.status}`);
    const direct = spawnSync('curl', ['https://example.invalid'], { encoding: 'utf8', env });
    assert('fixture-boundary/direct-process-rejected', direct.status !== 0, `rc=${direct.status}`);
    const network = spawnSync(process.execPath, ['-e', "fetch('https://example.invalid')"], {
      encoding: 'utf8',
      env,
    });
    assert('fixture-boundary/node-network-rejected', network.status !== 0, `rc=${network.status}`);
    const effects = effectRows(sandbox);
    assert(
      'fixture-boundary/sentinels-recorded',
      effects.some((row) => row.kind === 'process') && effects.some((row) => row.kind === 'network:fetch'),
      JSON.stringify(effects),
    );
  } finally {
    rmSync(sandbox.base, { recursive: true, force: true });
  }
}

function verifyCounterfeitCalibration() {
  for (const counterfeit of manifest.counterfeit_calibration) {
    const result = spawnSync(process.execPath, [runnerPath, '--fixture-self-test'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
      env: {
        ...process.env,
        CCM_XH_C3_COUNTERFEIT: counterfeit.id,
        CCM_XH_C3_CASE_FILTER: counterfeit.case,
      },
    });
    assert(
      `counterfeit/${counterfeit.id}/rejected`,
      result.status === 1,
      `rc=${result.status} stdout=${result.stdout || ''} stderr=${result.stderr || ''}`,
    );
    assert(
      `counterfeit/${counterfeit.id}/reason`,
      String(result.stderr || '').includes(`/${counterfeit.expected_failure}:`),
      result.stderr || '(empty)',
    );
  }
}

if (calibrateCounterfeits) {
  verifyCounterfeitCalibration();
  if (failures.length > 0) {
    process.stderr.write(`XH C3 counterfeit calibration: ${failures.length} failure(s)\n`);
    for (const item of failures) process.stderr.write(`- ${item}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `XH C3 counterfeit calibration: GREEN (${manifest.counterfeit_calibration.length} counterfeits rejected)\n`,
  );
  process.exit(0);
}

validateManifest();

for (const host of manifest.hosts) {
  const config = hosts[host];
  assert(`entry/${host}`, !!config, 'manifest host has no entry mapping');
  if (!config) continue;
  for (const file of [...config.bootstrap, ...config.hook].filter(
    (item) => typeof item === 'string' && item !== process.execPath && (item.startsWith(root) || item.startsWith(fixtureDir)),
  )) {
    assert(`entry/${host}/${basename(file)}`, existsSync(file), 'manifest-selected executable entry missing');
  }
  for (const testCase of selectedCases) {
    if (testCase.phase === 'bootstrap') verifyBootstrap(host, testCase);
    else verifyHook(host, testCase);
  }
}

verifyDeclaredExecution();
if (fixtureOnly) verifyBoundaryCalibration();

if (failures.length > 0) {
  process.stderr.write(`XH C3 executable subscription/epoch contract: ${failures.length} failure(s)\n`);
  for (const item of failures) process.stderr.write(`- ${item}\n`);
  process.exit(1);
}

process.stdout.write(
  fixtureOnly
    ? `XH C3 executable subscription/epoch known-good fixture: GREEN (${executedCases.size} cases)\n`
    : `XH C3 executable subscription/epoch contract: GREEN (${executedCases.size} real-entry cases)\n`,
);
