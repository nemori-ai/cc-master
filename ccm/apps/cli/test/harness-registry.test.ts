// harness-registry.test.ts — HarnessAdapter selection contract.

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { probeCursorAgentAuthFact } from '../src/harnesses/cursor.js';
import {
  detectTrustedHarnessId,
  harnessSessionId,
  inspectKnownHarnesses,
  MachineHarnessRegistry,
  resolveHarnessAdapter,
  resolveHarnessId,
} from '../src/harnesses/registry.js';
import type { HarnessCliProbe } from '../src/harnesses/types.js';

test('--harness flag wins over env aliases', () => {
  const adapter = resolveHarnessAdapter({
    harnessFlag: 'codex',
    env: { CC_MASTER_HARNESS: 'claude-code', CLAUDE_CODE_SESSION_ID: 'cc-sid' },
  });
  assert.equal(adapter.id, 'codex');
});

test('CC_MASTER_HARNESS wins over legacy host env aliases', () => {
  assert.equal(
    resolveHarnessId({
      env: { CC_MASTER_HARNESS: 'codex', CC_MASTER_HOST: 'claude-code' },
    }),
    'codex',
  );
});

test('legacy host env aliases still work', () => {
  assert.equal(resolveHarnessId({ env: { CC_MASTER_HOST: 'openai-codex' } }), 'codex');
  assert.equal(resolveHarnessId({ env: { CCM_HOST: 'claude' } }), 'claude-code');
});

test('explicit unknown harness uses generic adapter, not Claude fallback', () => {
  const adapter = resolveHarnessAdapter({ harnessFlag: 'future-agent', env: {} });
  assert.equal(adapter.id, 'future-agent');
  assert.equal(adapter.accountPool.supported, false);
  assert.equal(adapter.externalStatusline.supported, false);
  assert.equal(adapter.readCurrentUsage({}).source, 'unavailable');
});

test('auto-detect recognizes Codex and Claude Code markers', () => {
  assert.equal(resolveHarnessId({ env: { CODEX_SESSION_ID: 'cx-sid' } }), 'codex');
  assert.equal(resolveHarnessId({ env: { CODEX_THREAD_ID: 'cx-thread' } }), 'codex');
  assert.equal(resolveHarnessId({ env: { CLAUDE_CODE_SESSION_ID: 'cc-sid' } }), 'claude-code');
});

test('auto-detect recognizes CURSOR_AGENT → cursor', () => {
  assert.equal(resolveHarnessId({ env: { CURSOR_AGENT: '1' } }), 'cursor');
  assert.equal(resolveHarnessId({ env: { CURSOR_CONVERSATION_ID: 'conv-1' } }), 'cursor');
});

test('Codex thread marker wins over Claude-compatible fallback and mixed local env', () => {
  assert.equal(
    resolveHarnessId({
      env: { CODEX_THREAD_ID: 'cx-thread', CLAUDE_CODE_SSE_PORT: '32445' },
    }),
    'codex',
  );
});

test('CURSOR_AGENT wins over CLAUDE_CODE_SSE_PORT', () => {
  assert.equal(
    resolveHarnessId({
      env: { CURSOR_AGENT: '1', CLAUDE_CODE_SSE_PORT: '32445' },
    }),
    'cursor',
  );
});

test('no explicit harness and no detection keeps transitional Claude-compatible default', () => {
  assert.equal(resolveHarnessId({ env: {} }), 'claude-code');
});

test('trusted harness detection ignores transitional default and explicit flags', () => {
  assert.equal(detectTrustedHarnessId({}), null);
  assert.equal(detectTrustedHarnessId({ CC_MASTER_HARNESS: 'codex' }), null);
  assert.equal(detectTrustedHarnessId({ CODEX_SESSION_ID: 'cx-sid' }), 'codex');
  assert.equal(detectTrustedHarnessId({ CURSOR_AGENT: '1' }), 'cursor');
  assert.equal(detectTrustedHarnessId({ CLAUDE_CODE_SESSION_ID: 'cc-sid' }), 'claude-code');
});

test('session id comes from selected adapter', () => {
  assert.equal(
    harnessSessionId({
      harnessFlag: 'codex',
      env: { CODEX_SESSION_ID: 'cx-sid', CLAUDE_CODE_SESSION_ID: 'cc-sid' },
    }),
    'cx-sid',
  );
  assert.equal(
    harnessSessionId({
      env: { CODEX_THREAD_ID: 'cx-thread', CLAUDE_CODE_SSE_PORT: '32445' },
    }),
    'cx-thread',
  );
  assert.equal(harnessSessionId({ harnessFlag: 'future-agent', env: {} }), '');
});

test('inspectKnownHarnesses detects installed supported harnesses from PATH/config', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-harness-probe-'));
  const bin = join(root, 'codex');
  writeFileSync(bin, '#!/bin/sh\nexit 0\n');
  chmodSync(bin, 0o755);

  const inv = inspectKnownHarnesses({
    PATH: root,
    HOME: join(root, 'home'),
    CODEX_SESSION_ID: 'cx-sid',
  });
  const codex = inv.find((h) => h.id === 'codex');
  assert.ok(codex);
  assert.equal(codex?.installed, true);
  assert.equal(codex?.active, true);
  assert.equal(codex?.cli.path, bin);
  assert.equal(codex?.capabilities.pluginDistribution.supported, true);
});

test('Cursor inventory keeps IDE plugin and headless agent as independent surfaces', () => {
  const cases = [
    { name: 'only-agent', ide: false, agent: true },
    { name: 'only-IDE', ide: true, agent: false },
    { name: 'both', ide: true, agent: true },
    { name: 'neither', ide: false, agent: false },
  ] as const;

  for (const fixture of cases) {
    const root = mkdtempSync(join(tmpdir(), `ccm-cursor-surfaces-${fixture.name}-`));
    const bin = join(root, 'bin');
    mkdirSync(bin, { recursive: true });
    if (fixture.ide) writeExecutable(join(bin, 'cursor'));
    if (fixture.agent) writeExecutable(join(bin, 'cursor-agent'));

    const cursor = inspectKnownHarnesses({ PATH: bin, HOME: join(root, 'home') }).find(
      (h) => h.id === 'cursor',
    );
    assert.ok(cursor, fixture.name);
    const ide = cursor.surfaces.find((surface) => surface.id === 'cursor-ide-plugin');
    const agent = cursor.surfaces.find((surface) => surface.id === 'cursor-agent');
    assert.ok(ide, fixture.name);
    assert.ok(agent, fixture.name);

    assert.equal(cursor.installed, fixture.ide, `${fixture.name}: top-level remains IDE-only`);
    assert.equal(ide.kind, 'ide-plugin');
    assert.equal(ide.installed, fixture.ide, fixture.name);
    assert.equal(ide.available, fixture.ide, fixture.name);
    assert.equal(agent.kind, 'cli-headless');
    assert.equal(agent.installed, fixture.agent, fixture.name);
    assert.equal(agent.available, fixture.agent, fixture.name);
    assert.equal(agent.binary.name, 'cursor-agent');
    assert.equal(agent.binary.path, fixture.agent ? join(bin, 'cursor-agent') : null);
    assert.deepEqual(agent.facts.authentication, { state: 'unknown', source: 'not-probed' });
    assert.deepEqual(agent.facts.quota, { state: 'unknown', source: 'not-probed' });
    assert.ok(agent.admission, fixture.name);
    assert.equal(agent.admission.binary.available, fixture.agent);
    assert.equal(agent.admission.authentication.state, 'unknown');
    assert.equal(agent.admission.quota.state, 'unknown');
    assert.equal(agent.admission.sandbox, 'unknown');
    assert.equal(agent.admission.result_schema, 'unknown');
    assert.equal(agent.admission.task_acceptance, 'unknown');
    assert.equal(agent.admission.schedulable, false);
    assert.equal(agent.capabilities.accountMutation.state, 'forbidden');
    assert.equal(agent.capabilities.accountAutoswitch.state, 'unsupported');
    assert.equal(agent.capabilities.pluginDistribution.state, 'unsupported');
  }
});

// ── cursor-agent 认证态探测（probeCursorAgentAuthFact·mock runner 三态 + 边界）────────────────
//   fail-closed 铁律：仅在官方机读接口 `status --format json` 明确 isAuthenticated:true 时判 available。
const AGENT_BIN: HarnessCliProbe = {
  name: 'cursor-agent',
  path: '/opt/bin/cursor-agent',
  available: true,
};

test('probeCursorAgentAuthFact: 已登录（isAuthenticated:true）→ available', () => {
  const fact = probeCursorAgentAuthFact(AGENT_BIN, {}, () => ({
    ok: true,
    stdout: '{"status":"authenticated","isAuthenticated":true,"userInfo":{"email":"x@y.z"}}',
  }));
  assert.deepEqual(fact, { state: 'available', source: 'cursor-agent:status-json' });
});

test('probeCursorAgentAuthFact: 未登录（isAuthenticated:false）→ unavailable（observed negative·仍不放行）', () => {
  const fact = probeCursorAgentAuthFact(AGENT_BIN, {}, () => ({
    ok: true,
    stdout: '{"isAuthenticated":false}',
  }));
  assert.deepEqual(fact, { state: 'unavailable', source: 'cursor-agent:status-json' });
  assert.notEqual(fact.state, 'available'); // 绝不误放行
});

test('probeCursorAgentAuthFact: 进程错误（非零退出 / 超时 / spawn 失败）→ unknown（fail-closed）', () => {
  const fact = probeCursorAgentAuthFact(AGENT_BIN, {}, () => ({ ok: false, stdout: '' }));
  assert.equal(fact.state, 'unknown');
  assert.equal(fact.source, 'cursor-agent:status-unavailable');
});

test('probeCursorAgentAuthFact: 无法解析的人类可读文案 → unknown（不 grep 文案）', () => {
  const fact = probeCursorAgentAuthFact(AGENT_BIN, {}, () => ({
    ok: true,
    stdout: '✓ Logged in as x@y.z',
  }));
  assert.equal(fact.state, 'unknown');
  assert.equal(fact.source, 'cursor-agent:status-unparseable');
});

test('probeCursorAgentAuthFact: schema 变更（认证布尔缺失）→ unknown（绝不默认 authed）', () => {
  const fact = probeCursorAgentAuthFact(AGENT_BIN, {}, () => ({
    ok: true,
    stdout: '{"status":"weird","some":"field"}',
  }));
  assert.equal(fact.state, 'unknown');
  assert.equal(fact.source, 'cursor-agent:status-schema-unknown');
});

test('probeCursorAgentAuthFact: 兼容旧键 authenticated:true → available', () => {
  const fact = probeCursorAgentAuthFact(AGENT_BIN, {}, () => ({
    ok: true,
    stdout: '{"authenticated":true}',
  }));
  assert.deepEqual(fact, { state: 'available', source: 'cursor-agent:status-json' });
});

test('probeCursorAgentAuthFact: 二进制不可用 → not-probed unknown，runner 绝不被调用', () => {
  let called = false;
  const fact = probeCursorAgentAuthFact(
    { name: 'cursor-agent', path: null, available: false },
    {},
    () => {
      called = true;
      return { ok: true, stdout: '{"isAuthenticated":true}' };
    },
  );
  assert.deepEqual(fact, { state: 'unknown', source: 'not-probed' });
  assert.equal(called, false);
});

test('harness list opt-in 探测：已登录 cursor-agent → facts available + admission 去掉 auth blocker', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-cursor-authprobe-in-'));
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeStatusStub(join(bin, 'cursor-agent'), '{"isAuthenticated":true}');

  const cursor = inspectKnownHarnesses(
    { PATH: bin, HOME: join(root, 'home') },
    { probeHeadlessAuth: true },
  ).find((h) => h.id === 'cursor');
  const agent = cursor?.surfaces.find((surface) => surface.id === 'cursor-agent');
  assert.ok(agent);
  assert.deepEqual(agent.facts.authentication, {
    state: 'available',
    source: 'cursor-agent:status-json',
  });
  assert.equal(agent.admission?.authentication.state, 'available');
  // auth 不再是 blocker（quota 无只读源仍 unknown → admission 整体仍 fail-closed·非误放行）。
  assert.equal(
    agent.admission?.blockers.some((b) => b.startsWith('authentication.')),
    false,
  );
  assert.equal(agent.facts.quota.state, 'unknown');
  assert.equal(agent.admission?.schedulable, false);
});

test('harness list opt-in 探测：未登录 cursor-agent → unavailable，admission 仍 blocked', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-cursor-authprobe-out-'));
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeStatusStub(join(bin, 'cursor-agent'), '{"isAuthenticated":false}');

  const cursor = inspectKnownHarnesses(
    { PATH: bin, HOME: join(root, 'home') },
    { probeHeadlessAuth: true },
  ).find((h) => h.id === 'cursor');
  const agent = cursor?.surfaces.find((surface) => surface.id === 'cursor-agent');
  assert.equal(agent?.facts.authentication.state, 'unavailable');
  assert.equal(agent?.admission?.schedulable, false);
});

test('harness list 默认路径不 opt-in → 保持轻量 unprobed（零回归·不 spawn）', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-cursor-authprobe-cheap-'));
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  // 该 stub 若被调用会返回 authed；默认路径不得触发它，认证态须维持 not-probed。
  writeStatusStub(join(bin, 'cursor-agent'), '{"isAuthenticated":true}');

  const cursor = inspectKnownHarnesses({ PATH: bin, HOME: join(root, 'home') }).find(
    (h) => h.id === 'cursor',
  );
  const agent = cursor?.surfaces.find((surface) => surface.id === 'cursor-agent');
  assert.deepEqual(agent?.facts.authentication, { state: 'unknown', source: 'not-probed' });
});

test('Cursor headless executable probe accepts symlinks and rejects non-executable files', () => {
  const symlinkRoot = mkdtempSync(join(tmpdir(), 'ccm-cursor-agent-symlink-'));
  const target = join(symlinkRoot, 'versions', 'cursor-agent-real');
  const link = join(symlinkRoot, 'bin', 'cursor-agent');
  mkdirSync(join(symlinkRoot, 'versions'), { recursive: true });
  mkdirSync(join(symlinkRoot, 'bin'), { recursive: true });
  writeExecutable(target);
  symlinkSync(target, link);

  const linkedCursor = inspectKnownHarnesses({
    PATH: join(symlinkRoot, 'bin'),
    HOME: join(symlinkRoot, 'home'),
  }).find((h) => h.id === 'cursor');
  const linkedAgent = linkedCursor?.surfaces.find((surface) => surface.id === 'cursor-agent');
  assert.equal(linkedAgent?.installed, true);
  assert.equal(linkedAgent?.available, true);
  assert.equal(linkedAgent?.binary.path, link);

  const nonExecutableRoot = mkdtempSync(join(tmpdir(), 'ccm-cursor-agent-nonexec-'));
  const nonExecutableBin = join(nonExecutableRoot, 'bin');
  mkdirSync(nonExecutableBin, { recursive: true });
  writeFileSync(join(nonExecutableBin, 'cursor-agent'), '#!/bin/sh\nexit 0\n');

  const nonExecutableCursor = inspectKnownHarnesses({
    PATH: nonExecutableBin,
    HOME: join(nonExecutableRoot, 'home'),
  }).find((h) => h.id === 'cursor');
  const nonExecutableAgent = nonExecutableCursor?.surfaces.find(
    (surface) => surface.id === 'cursor-agent',
  );
  assert.equal(nonExecutableAgent?.installed, false);
  assert.equal(nonExecutableAgent?.available, false);
  assert.equal(nonExecutableAgent?.binary.path, null);
});

test('Cursor headless executable probe rejects searchable directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-cursor-agent-directory-'));
  const bin = join(root, 'bin');
  mkdirSync(join(bin, 'cursor-agent'), { recursive: true });

  const cursor = inspectKnownHarnesses({ PATH: bin, HOME: join(root, 'home') }).find(
    (h) => h.id === 'cursor',
  );
  const agent = cursor?.surfaces.find((surface) => surface.id === 'cursor-agent');
  assert.equal(agent?.installed, false);
  assert.equal(agent?.available, false);
  assert.equal(agent?.binary.path, null);
});

test('Cursor headless executable probe reports an absolute path from relative PATH entries', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-cursor-agent-relative-path-'));
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeExecutable(join(bin, 'cursor-agent'));

  const cursor = inspectKnownHarnesses({
    PATH: relative(process.cwd(), bin),
    HOME: join(root, 'home'),
  }).find((h) => h.id === 'cursor');
  const agent = cursor?.surfaces.find((surface) => surface.id === 'cursor-agent');
  assert.equal(agent?.installed, true);
  assert.equal(agent?.available, true);
  assert.equal(agent?.binary.path, join(bin, 'cursor-agent'));
});

test('harness adapters expose machine-wide registry coordinates', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-harness-coords-'));
  const claudeConfig = join(root, 'claude-config');
  const ccmHome = join(root, 'ccm-home');
  const codexHome = join(root, 'codex-home');
  const cursorState = join(root, 'Cursor', 'User', 'globalStorage', 'state.vscdb');

  const claude = resolveHarnessAdapter({ harnessFlag: 'claude-code', env: {} });
  assert.deepEqual(claude.sessionStoreRoots({ HOME: root, CLAUDE_CONFIG_DIR: claudeConfig }), [
    join(claudeConfig, 'projects'),
  ]);
  assert.deepEqual(claude.usageSource({}), {
    kind: 'statusline-sidecar',
    pollable: false,
    quotaModel: 'rolling-5h-7d',
  });
  assert.equal(
    claude.accountPoolLocation({ HOME: root, CC_MASTER_HOME: ccmHome }),
    join(ccmHome, 'accounts.json'),
  );

  const codex = resolveHarnessAdapter({ harnessFlag: 'codex', env: {} });
  assert.deepEqual(codex.sessionStoreRoots({ HOME: root, CODEX_HOME: codexHome }), [
    join(codexHome, 'sessions'),
  ]);
  assert.deepEqual(codex.usageSource({}), {
    kind: 'app-server',
    pollable: true,
    quotaModel: 'primary-secondary',
  });
  assert.equal(codex.accountPoolLocation({ HOME: root }), null);

  const cursor = resolveHarnessAdapter({ harnessFlag: 'cursor', env: {} });
  assert.deepEqual(cursor.sessionStoreRoots({ HOME: root, CCM_CURSOR_STATE_DB: cursorState }), [
    join(root, 'Cursor', 'User', 'globalStorage'),
  ]);
  assert.deepEqual(cursor.usageSource({}), {
    kind: 'dashboard-api',
    pollable: true,
    quotaModel: 'billing-period',
  });
  assert.equal(cursor.accountPoolLocation({ HOME: root }), null);

  const kimiHome = join(root, 'kimi-home');
  const kimi = resolveHarnessAdapter({ harnessFlag: 'kimi-code', env: {} });
  assert.deepEqual(kimi.sessionStoreRoots({ HOME: root, KIMI_CODE_HOME: kimiHome }), [
    join(kimiHome, 'sessions'),
  ]);
  assert.deepEqual(kimi.usageSource({}), {
    kind: 'dashboard-api',
    pollable: false,
    quotaModel: 'rolling-5h-7d',
  });
  assert.equal(kimi.accountPoolLocation({ HOME: root }), null);
});

test('kimi-code adapter: detection, aliases, unsupported usage/account, plugin distribution', () => {
  assert.equal(resolveHarnessId({ env: { KIMI_CODE_HOME: '/tmp/kimi-home' } }), 'kimi-code');
  assert.equal(detectTrustedHarnessId({ KIMI_CODE_HOME: '/tmp/kimi-home' }), 'kimi-code');

  const kimi = resolveHarnessAdapter({ harnessFlag: 'kimi', env: {} });
  assert.equal(kimi.id, 'kimi-code');

  const usage = kimi.readCurrentUsage({});
  assert.equal(usage.signal, null);
  assert.equal(usage.source, 'unavailable');

  assert.equal(kimi.accountPool.supported, false);
  assert.equal(kimi.externalStatusline.supported, false);
  assert.equal(kimi.pluginDistribution.supported, true);
  assert.deepEqual(kimi.accountSwitchPreflight({}), {
    action: 'noop',
    reason: kimi.accountPool.reason,
  });
});

test('kimi-code inventory reports install from bin or home without claiming other harnesses', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-kimi-inventory-'));
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeExecutable(join(bin, 'kimi'));

  const kimi = inspectKnownHarnesses({ PATH: bin, HOME: join(root, 'home') }).find(
    (h) => h.id === 'kimi-code',
  );
  assert.ok(kimi);
  assert.equal(kimi?.installed, true);
  assert.equal(kimi?.cli.path, join(bin, 'kimi'));
  assert.equal(kimi?.capabilities.pluginDistribution.supported, true);
  assert.equal(kimi?.capabilities.accountPool.supported, false);
});

test('MachineHarnessRegistry.sweep walks all known adapters into an immutable snapshot', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-machine-harness-'));
  mkdirSync(join(root, 'bin'), { recursive: true });
  writeExecutable(join(root, 'bin', 'cursor-agent'));
  mkdirSync(join(root, '.codex'), { recursive: true });
  mkdirSync(join(root, '.claude'), { recursive: true });

  const registry = MachineHarnessRegistry.sweep({
    HOME: root,
    PATH: join(root, 'bin'),
    CODEX_HOME: join(root, '.codex'),
    CC_MASTER_HARNESS: 'codex',
  });
  const snapshot = registry.toJSON();

  assert.equal(snapshot.schema, 'ccm/machine-harness-registry/v1');
  assert.deepEqual(
    snapshot.harnesses.map((h) => h.id),
    ['codex', 'cursor', 'kimi-code', 'claude-code'],
  );
  assert.ok(snapshot.installed.includes('codex'));
  assert.ok(snapshot.installed.includes('claude-code'));
  assert.equal(registry.byId('cursor')?.usageSource.quotaModel, 'billing-period');
  assert.deepEqual(snapshot.installedSurfaces, ['cursor-agent']);
  assert.equal(registry.byId('cursor')?.installed, false);
  assert.equal(registry.byId('cursor')?.surfaces.length, 2);
  assert.equal(registry.poolOf('claude-code')?.location, join(root, '.cc_master', 'accounts.json'));
  assert.equal(registry.poolOf('codex'), null);
  assert.equal(Object.isFrozen(snapshot.harnesses), true);
  assert.equal(Object.isFrozen(snapshot.harnesses[0]), true);
  assert.equal(Object.isFrozen(registry.byId('cursor')?.surfaces), true);
});

function writeExecutable(path: string): void {
  writeFileSync(path, '#!/bin/sh\nexit 0\n');
  chmodSync(path, 0o755);
}

// 可执行 stub：对 `status --format json` 回 statusJson，其余 arg 静默 exit 0。
function writeStatusStub(path: string, statusJson: string): void {
  const body = [
    '#!/bin/sh',
    'if [ "$1" = "status" ]; then',
    `  printf '%s' '${statusJson}'`,
    '  exit 0',
    'fi',
    'exit 0',
    '',
  ].join('\n');
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}
