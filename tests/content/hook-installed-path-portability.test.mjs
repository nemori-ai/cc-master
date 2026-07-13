import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  ccMasterHome,
  createRuntimeEnvironment,
  pluginInstallRoot,
  resolveExecutable,
} from '../../ccm/packages/engine/dist/index.mjs';

const repoRoot = process.cwd();
const boardSuffix = '.board' + '.json';

function ccmExecutable() {
  if (process.env.CCM_BIN) return path.resolve(process.env.CCM_BIN);
  const probe = spawnSync('sh', ['-c', 'command -v ccm'], { encoding: 'utf8' });
  assert.equal(probe.status, 0, `ccm is required for installed-path tests: ${probe.stderr}`);
  return probe.stdout.trim();
}

function testEnvironment(ccmBin, home, claudeConfigDir) {
  const env = {
    ...process.env,
    CC_MASTER_HOME: home,
    CLAUDE_CONFIG_DIR: claudeConfigDir,
    CCM_BIN: ccmBin,
    PATH: `${path.dirname(ccmBin)}${path.delimiter}${process.env.PATH || ''}`,
  };
  delete env.CC_MASTER_NO_AUTOINSTALL;
  for (const key of [
    'CODEX_HOME',
    'CODEX_SESSION_ID',
    'CODEX_THREAD_ID',
    'CODEX_SANDBOX',
    'CODEX_PROJECT_DIR',
    'CURSOR_AGENT',
    'CURSOR_VERSION',
    'CURSOR_PROJECT_DIR',
    'CURSOR_CONVERSATION_ID',
  ]) delete env[key];
  delete env.CC_MASTER_PLUGIN_ROOT;
  delete env.PLUGIN_ROOT;
  delete env.CC_MASTER_CURSOR_PLUGIN_ROOT;
  return env;
}

function makePreviousCcmShim(targetCcm) {
  const runtimeRoot = mkdtempSync(path.join('/var/tmp', 'ccm-previous-installed-'));
  const shim = path.join(runtimeRoot, 'previous ccm 0.20.0');
  const invocationLog = path.join(runtimeRoot, 'previous-ccm-invocations.jsonl');
  writeFileSync(
    shim,
    `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const args = process.argv.slice(2);
fs.appendFileSync(process.env.CCM_COMPAT_LOG, JSON.stringify(args) + '\\n');
if (args.includes('--version') || args.includes('-V')) {
  process.stdout.write('ccm 0.20.0\\n');
  process.exit(0);
}

const result = spawnSync(process.env.CCM_SHIM_TARGET, args, {
  env: process.env,
  encoding: 'utf8',
});
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;

let stdout = result.stdout || '';
if (args.includes('board') && args.includes('init') && args.includes('--json')) {
  const envelope = JSON.parse(stdout);
  if (envelope && envelope.data) {
    delete envelope.data.board_path;
    delete envelope.data.capabilities;
  }
  stdout = JSON.stringify(envelope);
}
process.stdout.write(stdout);
process.exit(result.status == null ? 1 : result.status);
`,
  );
  chmodSync(shim, 0o755);
  return { shim, invocationLog, targetCcm, runtimeRoot };
}

function snapshotTree(root) {
  if (!existsSync(root)) return { exists: false, entries: [] };
  const entries = [];
  const visit = (current, relative) => {
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      entries.push({ path: relative, kind: 'symlink', target: readlinkSync(current) });
      return;
    }
    if (stat.isDirectory()) {
      entries.push({ path: relative, kind: 'directory' });
      for (const name of readdirSync(current).sort()) visit(path.join(current, name), path.join(relative, name));
      return;
    }
    entries.push({ path: relative, kind: 'file', bytes: readFileSync(current).toString('base64') });
  };
  visit(root, '.');
  return { exists: true, entries };
}

function makeShellWriteSpies(root) {
  const bin = path.join(root, 'shell-write-spies');
  const log = path.join(root, 'shell-write-spies.log');
  mkdirSync(bin, { recursive: true });
  for (const command of ['mkdir', 'cp']) {
    const found = spawnSync('sh', ['-c', `command -v ${command}`], { encoding: 'utf8' });
    assert.equal(found.status, 0, found.stderr);
    const wrapper = path.join(bin, command);
    writeFileSync(
      wrapper,
      `#!/bin/sh\nprintf '%s\\n' '${command}' >> "$CCM_SHELL_WRITE_LOG"\nexec '${found.stdout.trim()}' "$@"\n`,
    );
    chmodSync(wrapper, 0o755);
  }
  return { bin, log };
}

function makeFixture(host) {
  const root = mkdtempSync(path.join(os.tmpdir(), `ccm-installed-${host}-`));
  const project = path.join(root, 'Project With Spaces 项目');
  const installed = path.join(root, 'Installed Plugins 插件', host, 'cc-master');
  const realHome = path.join(root, 'Real Home 用户');
  const linkedHome = path.join(root, 'Linked Home 链接');
  const claudeConfigDir = path.join(root, 'Claude Config 配置');
  mkdirSync(project, { recursive: true });
  mkdirSync(path.dirname(installed), { recursive: true });
  mkdirSync(realHome, { recursive: true });
  symlinkSync(realHome, linkedHome, 'dir');
  cpSync(path.join(repoRoot, 'plugin', 'dist', host), installed, { recursive: true });
  return { root, project, installed, realHome, linkedHome, claudeConfigDir };
}

function normalized(host, fixture, env, payload, event) {
  const launcher = path.join(fixture.installed, 'hooks', '_hosts', host, 'launcher.js');
  const result = spawnSync(process.execPath, [launcher, '--event', event, '--echo-normalized'], {
    cwd: fixture.project,
    env,
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function hostPayload(host, sessionId, prompt = '') {
  if (host === 'cursor') {
    return {
      conversation_id: sessionId,
      session_id: sessionId,
      hook_event_name: 'beforeSubmitPrompt',
      prompt,
      cwd: '/ignored-host-cwd',
    };
  }
  return {
    session_id: sessionId,
    hook_event_name: 'UserPromptSubmit',
    prompt,
    cwd: '/ignored-host-cwd',
  };
}

function invokeClaude(fixture, env, script, payload) {
  const manifest = JSON.parse(readFileSync(path.join(fixture.installed, 'hooks', 'hooks.json'), 'utf8'));
  const event = script === 'bootstrap-board.sh'
    ? 'UserPromptSubmit'
    : script === 'board-guard.js'
      ? 'PreToolUse'
      : 'PostToolUse';
  const registration = manifest.hooks[event]
    .flatMap((entry) => entry.hooks || [])
    .find((hook) => hook.command.includes(`/${script}`));
  assert.ok(registration, `missing installed Claude registration for ${script}`);
  const command = registration.command.replaceAll('${CLAUDE_PLUGIN_ROOT}', fixture.installed);
  return spawnSync(command, {
    cwd: fixture.project,
    env: { ...env, CLAUDE_PLUGIN_ROOT: fixture.installed },
    input: JSON.stringify(payload),
    encoding: 'utf8',
    shell: true,
  });
}

function invokeLauncher(host, fixture, env, event, core, payload) {
  const launcher = path.join(fixture.installed, 'hooks', '_hosts', host, 'launcher.js');
  const corePath = path.isAbsolute(core) ? core : path.join(fixture.installed, core);
  return spawnSync(process.execPath, [launcher, '--event', event, '--core', corePath], {
    cwd: fixture.project,
    env,
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
}

function bootstrap(host, fixture, env, sessionId, prompt) {
  const payload = hostPayload(host, sessionId, prompt);
  if (host === 'claude-code') return invokeClaude(fixture, env, 'bootstrap-board.sh', payload);
  const event = host === 'cursor' ? 'beforeSubmitPrompt' : 'UserPromptSubmit';
  return invokeLauncher(
    host,
    fixture,
    env,
    event,
    `hooks/bootstrap-board/implementations/${host}/bootstrap-board-core.js`,
    payload,
  );
}

function onlyBoard(home) {
  const boards = readdirSync(path.join(home, 'boards')).filter((name) => name.endsWith(boardSuffix));
  assert.equal(boards.length, 1);
  return path.join(home, 'boards', boards[0]);
}

function seedArchivedBoard(ccmBin, fixture, env) {
  const boardPath = path.join(fixture.linkedHome, 'boards', `resume-one${boardSuffix}`);
  mkdirSync(path.dirname(boardPath), { recursive: true });
  const created = spawnSync(
    ccmBin,
    ['--board', boardPath, 'board', 'init', '--goal', 'Resume portable path', '--json', '--no-input'],
    { cwd: fixture.project, env, encoding: 'utf8' },
  );
  assert.equal(created.status, 0, created.stderr);
  const board = JSON.parse(readFileSync(boardPath, 'utf8'));
  board.owner = { ...(board.owner || {}), active: false, session_id: 'old-session' };
  board.tasks = [{ id: 'keep', status: 'ready', deps: [] }];
  writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`);
  return boardPath;
}

test('installed Codex and Cursor launchers conform to RuntimeEnvironment under opaque paths', () => {
  const ccmBin = ccmExecutable();
  for (const host of ['codex', 'cursor']) {
    const fixture = makeFixture(host);
    try {
      const env = testEnvironment(ccmBin, fixture.linkedHome, fixture.claudeConfigDir);
      delete env.CC_MASTER_PLUGIN_ROOT;
      delete env.PLUGIN_ROOT;
      const rt = createRuntimeEnvironment({
        platform: process.platform,
        arch: process.arch,
        env,
        cwd: fixture.project,
        homeDir: fixture.realHome,
        tempDir: os.tmpdir(),
      });
      const payload = hostPayload(host, `${host}-portable`, 'ordinary prompt');
      const echo = normalized(host, fixture, env, payload, host === 'cursor' ? 'beforeSubmitPrompt' : 'UserPromptSubmit');
      assert.equal(echo.env.CC_MASTER_HOME, ccMasterHome(rt));
      assert.equal(echo.env.CC_MASTER_PLUGIN_ROOT, fixture.installed);
      assert.equal(echo.env.CC_MASTER_HOME, fixture.linkedHome, 'launcher preserves lexical symlink home');
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test('installed fresh bootstrap works for all hosts with spaces, Unicode, and symlink home', () => {
  const ccmBin = ccmExecutable();
  const prompts = {
    'claude-code': '/cc-master:as-master-orchestrator Portable fresh goal',
    codex: '$cc-master:cc-master-as-master-orchestrator Portable fresh goal',
    cursor: '/as-master-orchestrator Portable fresh goal',
  };
  for (const host of ['claude-code', 'codex', 'cursor']) {
    const fixture = makeFixture(host);
    try {
      const env = testEnvironment(ccmBin, fixture.linkedHome, fixture.claudeConfigDir);
      const sessionId = `${host}-fresh-portable`;
      const result = bootstrap(host, fixture, env, sessionId, prompts[host]);
      assert.equal(result.status, 0, `${host}: ${result.stderr}`);
      const boardPath = onlyBoard(fixture.linkedHome);
      const board = JSON.parse(readFileSync(boardPath, 'utf8'));
      assert.equal(board.owner.active, true, host);
      assert.equal(board.owner.session_id, sessionId, host);
      if (host !== 'claude-code') assert.equal(board.goal, 'Portable fresh goal', host);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test('new Claude plugin rejects previous ccm 0.20.0 before board mutation', () => {
  const ccmBin = ccmExecutable();
  const fixture = makeFixture('claude-code');
  let previous;
  try {
    previous = process.env.CCM_PREVIOUS_BIN
      ? {
          shim: path.resolve(process.env.CCM_PREVIOUS_BIN),
          invocationLog: '',
          targetCcm: '',
          runtimeRoot: '',
        }
      : makePreviousCcmShim(ccmBin);
    const env = {
      ...testEnvironment(previous.shim, fixture.linkedHome, fixture.claudeConfigDir),
    };
    if (previous.targetCcm) env.CCM_SHIM_TARGET = previous.targetCcm;
    if (previous.invocationLog) env.CCM_COMPAT_LOG = previous.invocationLog;
    const result = bootstrap(
      'claude-code',
      fixture,
      env,
      'claude-code-previous-ccm',
      '/cc-master:as-master-orchestrator Previous ccm must not mutate',
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ccm.*0\.21\.0/);
    assert.match(result.stdout, /board-init\/structured-board-path-v1/);

    const boardsDir = path.join(fixture.linkedHome, 'boards');
    assert.equal(existsSync(boardsDir), false, 'compatibility refusal leaves no boards directory');
    assert.equal(
      existsSync(fixture.claudeConfigDir),
      false,
      'compatibility refusal leaves Claude config home absent',
    );

    if (previous.invocationLog) {
      const invocations = readFileSync(previous.invocationLog, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const initCalls = invocations.filter((args) => args.includes('board') && args.includes('init'));
      assert.equal(initCalls.length, 1, 'only the non-mutating capability probe may call board init');
      assert.ok(initCalls[0].includes('--capabilities'));
      assert.ok(initCalls[0].includes('--json'));
    }
  } finally {
    if (previous?.runtimeRoot) rmSync(previous.runtimeRoot, { recursive: true, force: true });
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('previous ccm refusal is tree-for-tree zero-write before migration and mkdir', () => {
  const ccmBin = ccmExecutable();
  const fixture = makeFixture('claude-code');
  let previous;
  try {
    previous = process.env.CCM_PREVIOUS_BIN
      ? {
          shim: path.resolve(process.env.CCM_PREVIOUS_BIN),
          invocationLog: '',
          targetCcm: '',
          runtimeRoot: '',
        }
      : makePreviousCcmShim(ccmBin);
    const spies = makeShellWriteSpies(fixture.root);
    const legacyPath = path.join(fixture.linkedHome, `legacy-active${boardSuffix}`);
    writeFileSync(
      legacyPath,
      `${JSON.stringify({ owner: { active: true, session_id: '' }, tasks: [] }, null, 2)}\n`,
    );
    const beforeHome = snapshotTree(fixture.realHome);
    const beforeClaudeConfig = snapshotTree(fixture.claudeConfigDir);
    const env = {
      ...testEnvironment(previous.shim, fixture.linkedHome, fixture.claudeConfigDir),
      CCM_SHELL_WRITE_LOG: spies.log,
      PATH: `${spies.bin}${path.delimiter}${process.env.PATH || ''}`,
    };
    if (previous.targetCcm) env.CCM_SHIM_TARGET = previous.targetCcm;
    if (previous.invocationLog) env.CCM_COMPAT_LOG = previous.invocationLog;

    const result = bootstrap(
      'claude-code',
      fixture,
      env,
      'claude-code-legacy-refusal',
      '/cc-master:as-master-orchestrator Legacy refusal must be inert',
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      snapshotTree(fixture.realHome),
      beforeHome,
      'legacy ccm home must remain byte-identical',
    );
    assert.deepEqual(
      snapshotTree(fixture.claudeConfigDir),
      beforeClaudeConfig,
      'legacy Claude config must remain byte-identical',
    );
    assert.equal(existsSync(path.join(fixture.linkedHome, 'boards')), false);
    assert.equal(existsSync(path.join(fixture.linkedHome, 'channel')), false);
    assert.equal(existsSync(spies.log) ? readFileSync(spies.log, 'utf8') : '', '');
    assert.match(result.stdout, /board-init\/structured-board-path-v1/);

    const missingHome = path.join(fixture.root, 'Missing Home 未创建', 'nested');
    const beforeMissingClaudeConfig = snapshotTree(fixture.claudeConfigDir);
    const missingEnv = {
      ...env,
      CC_MASTER_HOME: missingHome,
    };
    const missing = bootstrap(
      'claude-code',
      fixture,
      missingEnv,
      'claude-code-missing-home-refusal',
      '/cc-master:as-master-orchestrator Missing home refusal must be inert',
    );
    assert.equal(missing.status, 0, missing.stderr);
    assert.equal(existsSync(missingHome), false, 'refusal must not create any home parent');
    assert.deepEqual(
      snapshotTree(fixture.claudeConfigDir),
      beforeMissingClaudeConfig,
      'missing-home refusal must not mutate Claude config',
    );
    assert.equal(existsSync(spies.log) ? readFileSync(spies.log, 'utf8') : '', '');
  } finally {
    if (previous?.runtimeRoot) rmSync(previous.runtimeRoot, { recursive: true, force: true });
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('installed resume, guard, and lint preserve host parity under opaque paths', () => {
  const ccmBin = ccmExecutable();
  const prompts = {
    'claude-code': '/cc-master:as-master-orchestrator --resume resume-one',
    codex: '$cc-master:cc-master-as-master-orchestrator --resume resume-one',
    cursor: '/as-master-orchestrator --resume resume-one',
  };
  for (const host of ['claude-code', 'codex', 'cursor']) {
    const fixture = makeFixture(host);
    try {
      const env = testEnvironment(ccmBin, fixture.linkedHome, fixture.claudeConfigDir);
      const boardPath = seedArchivedBoard(ccmBin, fixture, env);
      const sessionId = `${host}-resume-portable`;
      const resumed = bootstrap(host, fixture, env, sessionId, prompts[host]);
      assert.equal(resumed.status, 0, `${host} resume: ${resumed.stderr}`);
      let board = JSON.parse(readFileSync(boardPath, 'utf8'));
      assert.equal(board.owner.active, true, host);
      assert.equal(board.owner.session_id, sessionId, host);
      assert.equal(board.tasks[0].id, 'keep', host);

      const prePayload = {
        ...hostPayload(host, sessionId),
        hook_event_name: host === 'cursor' ? 'preToolUse' : 'PreToolUse',
        tool_name: host === 'cursor' ? 'Write' : 'Write',
        tool_input: { file_path: boardPath },
      };
      const guarded = host === 'claude-code'
        ? invokeClaude(fixture, env, 'board-guard.js', prePayload)
        : invokeLauncher(
            host,
            fixture,
            env,
            host === 'cursor' ? 'preToolUse' : 'PreToolUse',
            `hooks/board-guard/implementations/${host}/board-guard-core.js`,
            prePayload,
          );
      assert.equal(guarded.status, 0, `${host} guard: ${guarded.stderr}`);
      assert.match(guarded.stdout, host === 'cursor' ? /"permission":"deny"/ : /block/, host);

      board.tasks[0].deps = ['missing'];
      writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`);
      const postPayload = {
        ...hostPayload(host, sessionId),
        hook_event_name: host === 'cursor' ? 'postToolUse' : 'PostToolUse',
        tool_name: 'Write',
        tool_input: { file_path: boardPath },
      };
      const linted = host === 'claude-code'
        ? invokeClaude(fixture, env, 'board-lint.js', postPayload)
        : invokeLauncher(
            host,
            fixture,
            env,
            host === 'cursor' ? 'postToolUse' : 'PostToolUse',
            `hooks/board-lint/implementations/${host}/board-lint-core.js`,
            postPayload,
          );
      assert.equal(linted.status, 0, `${host} lint: ${linted.stderr}`);
      assert.match(linted.stdout, /GRAPH-DANGLING/, host);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test('Cursor IDE plugin root and cursor-agent executable remain separate RuntimeEnvironment surfaces', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ccm-cursor-surfaces-'));
  try {
    const binDir = path.join(root, 'Executable Bin 二进制');
    const executable = path.join(binDir, 'cursor-agent');
    const pluginRoot = path.join(root, 'Cursor IDE Plugin 插件');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(executable, '#!/bin/sh\nexit 0\n');
    chmodSync(executable, 0o755);
    const env = {
      HOME: root,
      PATH: binDir,
      CC_MASTER_CURSOR_PLUGIN_ROOT: pluginRoot,
    };
    const rt = createRuntimeEnvironment({
      platform: process.platform,
      arch: process.arch,
      env,
      cwd: root,
      homeDir: root,
      tempDir: os.tmpdir(),
    });
    const agent = resolveExecutable(rt, 'cursor-agent');
    assert.equal(agent.executable, true);
    assert.equal(agent.lexicalPath, executable);
    assert.equal(pluginInstallRoot(rt, 'cursor'), pluginRoot);
    assert.notEqual(pluginInstallRoot(rt, 'cursor'), agent.lexicalPath);
    const cursorHooks = readFileSync(path.join(repoRoot, 'plugin', 'src', 'hooks', '_hosts', 'cursor', 'hooks.json'), 'utf8');
    assert.doesNotMatch(cursorHooks, /cursor-agent/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
