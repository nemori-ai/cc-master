// runtime-env.test.ts — RuntimeEnvironment / PathResolver 纯契约验收矩阵（Linux/macOS 可移植性 slice 2）。
//   钉住：linux/darwin/other 归一、HOME 缺失、显式 XDG 覆写、空格/Unicode、相对 PATH、空 PATH 条目安全拒绝、
//   symlink/nonexec/regular-file、lexical 与 realpath 分离、所有对外路径绝对、注入 env 不暗读 process.env、
//   默认已有位置不变。测 build 后的 dist 公开 API barrel（与其余 engine 测试同口径）。

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, sep } from 'node:path';
import { afterEach, test } from 'node:test';
import {
  boardSessionPointer,
  captureRuntimeEnvironment,
  ccMasterHome,
  createRuntimeEnvironment,
  homeBase,
  hostConfig,
  launchAgentsDir,
  localPluginBase,
  pluginInstallRoot,
  resolveExecutable,
  systemdUserDir,
} from '../dist/index.mjs';

let TMPDIRS: string[] = [];
function mkTmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  TMPDIRS.push(d);
  return d;
}
afterEach(() => {
  for (const d of TMPDIRS) rmSync(d, { recursive: true, force: true });
  TMPDIRS = [];
});

function mkExec(p: string): void {
  writeFileSync(p, '#!/bin/sh\nexit 0\n');
  chmodSync(p, 0o755);
}

// 构造一份 rt：默认 linux/x64、显式 homeDir/cwd/tempDir，env 全显式（矩阵可控·无进程读）。
function rt(env: Record<string, string | undefined>, over: Record<string, unknown> = {}) {
  return createRuntimeEnvironment({
    platform: 'linux',
    arch: 'x64',
    env,
    cwd: '/work/dir',
    homeDir: '/home/alice',
    tempDir: '/tmp',
    ...over,
  });
}

// ── 平台 / 架构归一 ────────────────────────────────────────────────────────────────────────────
test('platform/arch: linux/darwin/x64/arm64 pass through; anything else → other', () => {
  assert.equal(rt({}, { platform: 'linux' }).platform, 'linux');
  assert.equal(rt({}, { platform: 'darwin' }).platform, 'darwin');
  assert.equal(rt({}, { platform: 'win32' }).platform, 'other');
  assert.equal(rt({}, { platform: 'freebsd' }).platform, 'other');
  assert.equal(rt({}, { arch: 'x64' }).arch, 'x64');
  assert.equal(rt({}, { arch: 'arm64' }).arch, 'arm64');
  assert.equal(rt({}, { arch: 'ia32' }).arch, 'other');
});

// ── home 伞根：默认位置不变 + 覆写 + HOME 缺失 ─────────────────────────────────────────────────
test('ccMasterHome: default is $HOME/.cc_master (unchanged); CC_MASTER_HOME overrides', () => {
  assert.equal(ccMasterHome(rt({ HOME: '/home/alice' })), '/home/alice/.cc_master');
  assert.equal(ccMasterHome(rt({ HOME: '/home/alice', CC_MASTER_HOME: '/opt/ccm' })), '/opt/ccm');
});

test('ccMasterHome: HOME absent → falls back to explicit injected homeDir (not a hidden process read)', () => {
  const home = ccMasterHome(rt({}, { homeDir: '/injected/home' }));
  assert.equal(home, '/injected/home/.cc_master');
});

test('homeBase: env.HOME wins over homeDir; empty HOME falls to homeDir', () => {
  assert.equal(homeBase({ HOME: '/h' }, '/fallback'), '/h');
  assert.equal(homeBase({ HOME: '' }, '/fallback'), '/fallback');
  assert.equal(homeBase({}, '/fallback'), '/fallback');
});

// ── XDG 根：默认不变 + 显式覆写 ─────────────────────────────────────────────────────────────────
test('roots: defaults follow ~/.local/{state,share}, ~/.config, ~/.cache (unchanged); runtimes under home', () => {
  const r = rt({ HOME: '/home/alice' }).roots;
  assert.equal(r.state, '/home/alice/.local/state');
  assert.equal(r.config, '/home/alice/.config');
  assert.equal(r.data, '/home/alice/.local/share');
  assert.equal(r.cache, '/home/alice/.cache');
  assert.equal(r.runtimePersistent, '/home/alice/.cc_master/runtimes');
  assert.equal(r.runtimeEphemeral, null);
});

test('roots: explicit XDG overrides win and are absolutized', () => {
  const r = rt({
    HOME: '/home/alice',
    XDG_STATE_HOME: '/xdg/state',
    XDG_CONFIG_HOME: '/xdg/config',
    XDG_DATA_HOME: '/xdg/data',
    XDG_CACHE_HOME: '/xdg/cache',
    XDG_RUNTIME_DIR: '/run/user/1000',
  }).roots;
  assert.equal(r.state, '/xdg/state');
  assert.equal(r.config, '/xdg/config');
  assert.equal(r.data, '/xdg/data');
  assert.equal(r.cache, '/xdg/cache');
  assert.equal(r.runtimeEphemeral, '/run/user/1000');
  // 持久 runtime 绝不路由到 XDG_RUNTIME_DIR（必须跨重启存活）。
  assert.equal(r.runtimePersistent, '/home/alice/.cc_master/runtimes');
});

test('roots: every root is absolute even under relative env inputs', () => {
  const r = rt({
    HOME: 'relative-user-home',
    CC_MASTER_HOME: 'rel/home',
    XDG_STATE_HOME: 'rel/state',
    XDG_CONFIG_HOME: 'rel/config',
    XDG_DATA_HOME: 'rel/data',
    XDG_CACHE_HOME: 'rel/cache',
    XDG_RUNTIME_DIR: 'rel/runtime',
  }).roots;
  assert.ok(isAbsolute(r.ccMasterHome));
  assert.ok(isAbsolute(r.state));
  assert.ok(isAbsolute(r.config));
  assert.ok(isAbsolute(r.data));
  assert.ok(isAbsolute(r.cache));
  assert.ok(isAbsolute(r.runtimePersistent));
  assert.ok(isAbsolute(r.runtimeEphemeral ?? ''));
  assert.equal(r.ccMasterHome, '/work/dir/rel/home');
  assert.equal(r.state, '/work/dir/rel/state');
});

test('pure snapshot: relative HOME and path overrides are anchored only to captured cwd', () => {
  const realCwdA = mkTmp('ccm-rte-real-cwd-a-');
  const realCwdB = mkTmp('ccm-rte-real-cwd-b-');
  const capturedCwd = '/captured/runtime-cwd';
  const input = {
    platform: 'linux',
    arch: 'x64',
    cwd: capturedCwd,
    homeDir: 'relative-homedir-fallback',
    tempDir: 'relative-temp',
    env: {
      HOME: 'relative-home',
      CC_MASTER_HOME: 'relative-cc-master',
      XDG_STATE_HOME: 'relative-state',
      XDG_CONFIG_HOME: 'relative-config',
      XDG_DATA_HOME: 'relative-data',
      XDG_CACHE_HOME: 'relative-cache',
      XDG_RUNTIME_DIR: 'relative-runtime',
      CLAUDE_CONFIG_DIR: 'relative-claude',
      CODEX_HOME: 'relative-codex',
      CC_MASTER_PLUGIN_ROOT: 'relative-plugin-root',
      CC_MASTER_PLUGIN_DIR: 'relative-plugin-base',
      CC_MASTER_CURSOR_PLUGIN_ROOT: 'relative-cursor-plugin',
    },
  };

  const observe = () => {
    const snapshot = createRuntimeEnvironment(input);
    return {
      cwd: snapshot.cwd,
      homeDir: snapshot.homeDir,
      tempDir: snapshot.tempDir,
      roots: snapshot.roots,
      claude: hostConfig(snapshot, 'claude-code'),
      codex: hostConfig(snapshot, 'codex'),
      codexPlugin: pluginInstallRoot(snapshot, 'codex'),
      cursorPlugin: pluginInstallRoot(snapshot, 'cursor'),
      pluginBase: localPluginBase(snapshot),
    };
  };

  const originalCwd = process.cwd();
  let fromA: ReturnType<typeof observe>;
  let fromB: ReturnType<typeof observe>;
  try {
    process.chdir(realCwdA);
    fromA = observe();
    process.chdir(realCwdB);
    fromB = observe();
  } finally {
    process.chdir(originalCwd);
  }

  assert.deepEqual(fromA, fromB, 'real process cwd must not influence a pure snapshot');
  assert.equal(fromA.cwd, capturedCwd);
  assert.equal(fromA.homeDir, `${capturedCwd}/relative-homedir-fallback`);
  assert.equal(fromA.tempDir, `${capturedCwd}/relative-temp`);
  assert.equal(fromA.roots.ccMasterHome, `${capturedCwd}/relative-cc-master`);
  assert.equal(fromA.roots.state, `${capturedCwd}/relative-state`);
  assert.deepEqual(fromA.claude, [`${capturedCwd}/relative-claude`]);
  assert.deepEqual(fromA.codex, [`${capturedCwd}/relative-codex`]);
  assert.equal(fromA.codexPlugin, `${capturedCwd}/relative-plugin-root`);
  assert.equal(fromA.cursorPlugin, `${capturedCwd}/relative-cursor-plugin`);
  assert.equal(fromA.pluginBase, `${capturedCwd}/relative-plugin-base`);
});

test('pure snapshot: relative and empty HOME cannot produce relative public paths', () => {
  const relativeHome = rt({ HOME: 'relative-home' });
  assert.equal(ccMasterHome(relativeHome), '/work/dir/relative-home/.cc_master');
  assert.deepEqual(hostConfig(relativeHome, 'codex'), ['/work/dir/relative-home/.codex']);
  assert.equal(
    pluginInstallRoot(relativeHome, 'cursor'),
    '/work/dir/relative-home/.cursor/plugins/local/cc-master',
  );

  const emptyHome = rt({ HOME: '' }, { homeDir: 'relative-fallback-home' });
  assert.equal(ccMasterHome(emptyHome), '/work/dir/relative-fallback-home/.cc_master');
  assert.ok(isAbsolute(boardSessionPointer(emptyHome, 'sid-relative-home')));
});

test('pure snapshot: a relative captured cwd is rejected instead of consulting process.cwd', () => {
  assert.throws(
    () =>
      createRuntimeEnvironment({
        platform: 'linux',
        arch: 'x64',
        env: { HOME: '/home/alice' },
        cwd: 'relative-cwd',
        homeDir: '/home/alice',
        tempDir: '/tmp',
      }),
    /cwd.*absolute/i,
  );
});

// ── session pointer：跟 state 根（P2-1 split-home 修复）────────────────────────────────────────
test('boardSessionPointer: under state root; honors env.HOME fallback (not process homedir)', () => {
  assert.equal(
    boardSessionPointer(rt({ HOME: '/home/bob' }), 'sid-1'),
    '/home/bob/.local/state/cc-master/boards/sid-1.path',
  );
  assert.equal(
    boardSessionPointer(rt({ HOME: '/home/bob', XDG_STATE_HOME: '/xdg/state' }), 'sid-1'),
    '/xdg/state/cc-master/boards/sid-1.path',
  );
});

// ── host config：默认不变 + 覆写 + darwin 分支 ─────────────────────────────────────────────────
test('hostConfig: claude-code / codex honor overrides else default under home', () => {
  assert.deepEqual(hostConfig(rt({ HOME: '/home/alice' }), 'claude-code'), ['/home/alice/.claude']);
  assert.deepEqual(
    hostConfig(rt({ HOME: '/home/alice', CLAUDE_CONFIG_DIR: '/cfg' }), 'claude-code'),
    ['/cfg'],
  );
  assert.deepEqual(hostConfig(rt({ HOME: '/home/alice' }), 'codex'), ['/home/alice/.codex']);
  assert.deepEqual(hostConfig(rt({ HOME: '/home/alice', CODEX_HOME: '/cdx' }), 'codex'), ['/cdx']);
});

test('hostConfig: cursor is platform-specific (darwin Application Support vs linux XDG config)', () => {
  assert.deepEqual(hostConfig(rt({ HOME: '/home/alice' }, { platform: 'linux' }), 'cursor'), [
    '/home/alice/.config/Cursor',
  ]);
  assert.deepEqual(hostConfig(rt({ HOME: '/Users/alice' }, { platform: 'darwin' }), 'cursor'), [
    '/Users/alice/Library/Application Support/Cursor',
  ]);
  // linux cursor 跟 XDG_CONFIG_HOME。
  assert.deepEqual(
    hostConfig(
      rt({ HOME: '/home/alice', XDG_CONFIG_HOME: '/xdg/config' }, { platform: 'linux' }),
      'cursor',
    ),
    ['/xdg/config/Cursor'],
  );
});

// ── plugin install root：默认不变（.local/share·非 XDG_DATA_HOME 迁移）+ 覆写 ────────────────────
test('pluginInstallRoot: codex default under ~/.local/share/cc-master; CC_MASTER_PLUGIN_ROOT overrides', () => {
  assert.equal(
    pluginInstallRoot(rt({ HOME: '/home/alice' }), 'codex'),
    '/home/alice/.local/share/cc-master/cc-master',
  );
  assert.equal(
    pluginInstallRoot(rt({ HOME: '/home/alice', CC_MASTER_PLUGIN_ROOT: '/opt/p' }), 'codex'),
    '/opt/p',
  );
  assert.equal(
    pluginInstallRoot(rt({ HOME: '/home/alice', CC_MASTER_PLUGIN_DIR: '/data/plugins' }), 'codex'),
    '/data/plugins/cc-master',
  );
});

test('pluginInstallRoot: plugin base does NOT migrate to XDG_DATA_HOME (first slice preserves location)', () => {
  // roots.data 跟 XDG_DATA_HOME，但插件安装根有意固定 .local/share，首轮不搬用户数据。
  const r = rt({ HOME: '/home/alice', XDG_DATA_HOME: '/xdg/data' });
  assert.equal(r.roots.data, '/xdg/data');
  assert.equal(pluginInstallRoot(r, 'codex'), '/home/alice/.local/share/cc-master/cc-master');
  assert.equal(localPluginBase(r), '/home/alice/.local/share/cc-master');
});

test('pluginInstallRoot: cursor uses host-native ~/.cursor/plugins/local/cc-master', () => {
  assert.equal(
    pluginInstallRoot(rt({ HOME: '/home/alice' }), 'cursor'),
    '/home/alice/.cursor/plugins/local/cc-master',
  );
  // cursor 只认 CC_MASTER_CURSOR_PLUGIN_ROOT。
  assert.equal(
    pluginInstallRoot(
      rt({ HOME: '/home/alice', CC_MASTER_CURSOR_PLUGIN_ROOT: '/opt/cur' }),
      'cursor',
    ),
    '/opt/cur',
  );
});

test('pluginInstallRoot: per-host overrides do not bleed across hosts (regression guard)', () => {
  // 通用 CC_MASTER_PLUGIN_ROOT 绝不劫持 cursor 的 host-native 根（否则 cursor 会被误判 installed）。
  const e = { HOME: '/home/alice', CC_MASTER_PLUGIN_ROOT: '/generic/plugin/root' };
  assert.equal(pluginInstallRoot(rt(e), 'cursor'), '/home/alice/.cursor/plugins/local/cc-master');
  assert.equal(pluginInstallRoot(rt(e), 'codex'), '/generic/plugin/root');
});

// ── 空格 / Unicode：数据、非分隔符 ─────────────────────────────────────────────────────────────
test('spaces and Unicode in home are carried as data, never split', () => {
  const spaced = ccMasterHome(rt({ HOME: '/Users/me/My Project' }));
  assert.equal(spaced, '/Users/me/My Project/.cc_master');
  const unicode = boardSessionPointer(rt({ HOME: '/home/收件人 δ' }), 'sid-x');
  assert.equal(unicode, '/home/收件人 δ/.local/state/cc-master/boards/sid-x.path');
});

// ── 注入 env 不暗读 process.env（快照冻结·纯输入）──────────────────────────────────────────────
test('env snapshot is frozen and does not leak process.env', () => {
  const snap = rt({ HOME: '/home/alice', FOO: 'bar' });
  assert.equal(snap.env.FOO, 'bar');
  assert.equal(snap.env.PATH, undefined, 'PATH not injected → absent, not process PATH');
  assert.throws(() => {
    (snap.env as Record<string, string>).FOO = 'mutated';
  });
});

// ── 可执行发现矩阵 ──────────────────────────────────────────────────────────────────────────────
test('resolveExecutable: absolute PATH hit → executable, lexical + realpath populated', () => {
  const root = mkTmp('ccm-rte-abs-');
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  mkExec(join(bin, 'tool'));
  const r = resolveExecutable(rt({ PATH: bin }), 'tool');
  assert.equal(r.executable, true);
  assert.equal(r.regularFile, true);
  assert.equal(r.symlink, false);
  assert.equal(r.lexicalPath, join(bin, 'tool'));
  assert.equal(r.realPath, join(bin, 'tool'));
  assert.equal(r.source, 'path');
  assert.equal(r.reason, null);
});

test('resolveExecutable: relative PATH entry resolves against captured cwd (not process.cwd)', () => {
  const root = mkTmp('ccm-rte-rel-');
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  mkExec(join(bin, 'tool'));
  // cwd 注入为 root；PATH 传相对 'bin' → 应对 root 解析，绝不用 process.cwd()。
  const r = resolveExecutable(rt({ PATH: 'bin' }, { cwd: root }), 'tool');
  assert.equal(r.executable, true);
  assert.equal(r.lexicalPath, join(bin, 'tool'));
  assert.ok(isAbsolute(r.lexicalPath));
});

test('resolveExecutable: symlink hit keeps lexical (symlink) separate from realPath (target)', () => {
  const root = mkTmp('ccm-rte-link-');
  mkdirSync(join(root, 'versions'), { recursive: true });
  mkdirSync(join(root, 'bin'), { recursive: true });
  const target = join(root, 'versions', 'real');
  const link = join(root, 'bin', 'tool');
  mkExec(target);
  symlinkSync(target, link);
  const r = resolveExecutable(rt({ PATH: join(root, 'bin') }), 'tool');
  assert.equal(r.executable, true);
  assert.equal(r.symlink, true);
  assert.equal(r.lexicalPath, link);
  assert.equal(r.realPath, target, 'realPath follows the symlink; lexical does not');
});

test('resolveExecutable: non-executable file and directory are rejected with reason', () => {
  const root = mkTmp('ccm-rte-reject-');
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'noexec'), '#!/bin/sh\n');
  mkdirSync(join(bin, 'adir'), { recursive: true });
  const noexec = resolveExecutable(rt({ PATH: bin }), 'noexec');
  assert.equal(noexec.executable, false);
  assert.ok(noexec.reason);
  const dir = resolveExecutable(rt({ PATH: bin }), 'adir');
  assert.equal(dir.executable, false);
  assert.equal(dir.regularFile, false);
});

test('resolveExecutable: injected empty PATH is a safe reject — no process.env fallback', () => {
  const r = resolveExecutable(rt({ PATH: '' }), 'node');
  assert.equal(r.executable, false);
  assert.match(r.reason ?? '', /empty/i);
});

test('resolveExecutable: PATH key absent → no search, no process.env leak', () => {
  const r = resolveExecutable(rt({ HOME: '/home/alice' }), 'node');
  assert.equal(r.executable, false);
  assert.match(r.reason ?? '', /not present/i);
});

test('resolveExecutable: empty PATH entry is rejected, never a silent cwd search', () => {
  const root = mkTmp('ccm-rte-emptyentry-');
  mkExec(join(root, 'tool'));
  // PATH = ":<realbin>" — 前导空条目（传统意为 cwd）必须被拒；cwd=root 下若误搜 cwd 会命中 tool。
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const withEmptyLeading = `${delimiter}${bin}`;
  const r = resolveExecutable(rt({ PATH: withEmptyLeading }, { cwd: root }), 'tool');
  // tool 在 cwd(root) 下存在但不在 bin 下 → 若空条目被当 cwd 搜就会误命中；正确行为是拒绝空条目 → 未命中。
  assert.equal(r.executable, false, 'empty leading PATH entry must not silently search cwd');
});

test('resolveExecutable: explicit relative path resolves against captured cwd', () => {
  const root = mkTmp('ccm-rte-explicit-');
  const sub = join(root, 'sub');
  mkdirSync(sub, { recursive: true });
  mkExec(join(sub, 'tool'));
  const r = resolveExecutable(rt({}, { cwd: root }), `.${sep}sub${sep}tool`);
  assert.equal(r.source, 'explicit');
  assert.equal(r.executable, true);
  assert.equal(r.lexicalPath, join(sub, 'tool'));
});

test('resolveExecutable: empty request rejected', () => {
  const r = resolveExecutable(rt({ PATH: '/bin' }), '');
  assert.equal(r.executable, false);
  assert.ok(r.reason);
});

// ── captureRuntimeEnvironment：composition 边界快照 + env 注入覆写 ───────────────────────────────
test('captureRuntimeEnvironment: overrides.env is injected while cwd/platform come from process', () => {
  const snap = captureRuntimeEnvironment({
    env: { HOME: '/injected', CC_MASTER_HOME: '/inj/home' },
  });
  assert.equal(ccMasterHome(snap), '/inj/home');
  assert.equal(snap.env.HOME, '/injected');
  assert.equal(typeof snap.cwd, 'string');
  assert.ok(isAbsolute(snap.cwd));
});

// ── service unit locations（launchd LaunchAgents / systemd user·经 contract 派生·无硬编码 home）─────
test('launchAgentsDir: derives <home>/Library/LaunchAgents from the contract home, not process HOME', () => {
  const dir = launchAgentsDir(rt({ HOME: '/home/alice' }));
  assert.equal(dir, join('/home/alice', 'Library', 'LaunchAgents'));
  assert.ok(isAbsolute(dir));
});

test('systemdUserDir: default is <home>/.config/systemd/user; honors XDG_CONFIG_HOME override', () => {
  const dflt = systemdUserDir(rt({ HOME: '/home/alice' }));
  assert.equal(dflt, join('/home/alice', '.config', 'systemd', 'user'));
  const xdg = systemdUserDir(rt({ HOME: '/home/alice', XDG_CONFIG_HOME: '/xdg cfg/α' }));
  assert.equal(xdg, join('/xdg cfg/α', 'systemd', 'user'));
});

test('systemdUserDir / launchAgentsDir: spaces + Unicode in home are data, never delimiters', () => {
  const home = '/home/用户/My Home';
  assert.equal(launchAgentsDir(rt({ HOME: home })), join(home, 'Library', 'LaunchAgents'));
  assert.equal(systemdUserDir(rt({ HOME: home })), join(home, '.config', 'systemd', 'user'));
});
