// paths.test.ts — @ccm/engine·cc-master home / Claude Code host path 解析契约门。
//   钉住覆写优先级链：cc-master home 默认 $HOME/.cc_master；Claude Code host path 仍跟随 CLAUDE_CONFIG_DIR。
//   测 build 后的 dist 公开 API barrel（与其余 engine 测试同口径）。

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  captureRuntimeEnvironment,
  ccMasterHome,
  resolveCcMasterHome,
  resolveClaudeCodeConfigDir,
  resolveClaudeConfigDir,
  resolveClaudeJsonPath,
  resolveCredentialsPath,
  resolveHostConfigDir,
  resolveProjectsDir,
  resolveRateCachePath,
} from '../dist/index.mjs';

// ── resolveClaudeConfigDir ───────────────────────────────────────────────────────────────────────
test('resolveClaudeConfigDir: $CLAUDE_CONFIG_DIR wins (absolutized)', () => {
  assert.equal(resolveClaudeConfigDir({ CLAUDE_CONFIG_DIR: '/cfg/dir', HOME: '/h' }), '/cfg/dir');
});

test('resolveClaudeConfigDir: no CLAUDE_CONFIG_DIR → $HOME/.claude', () => {
  assert.equal(resolveClaudeConfigDir({ HOME: '/h' }), join('/h', '.claude'));
});

test('resolveClaudeCodeConfigDir: alias equals legacy resolveClaudeConfigDir', () => {
  assert.equal(
    resolveClaudeCodeConfigDir({ CLAUDE_CONFIG_DIR: '/cfg/dir', HOME: '/h' }),
    '/cfg/dir',
  );
});

test('resolveHostConfigDir: defaults to host config directory', () => {
  assert.equal(resolveHostConfigDir({ HOME: '/h' }), join('/h', '.claude'));
});

// ── resolveCcMasterHome（CC_MASTER_HOME > $HOME/.cc_master；不跟随 CLAUDE_CONFIG_DIR）────────────────
test('resolveCcMasterHome: $CC_MASTER_HOME wins over CLAUDE_CONFIG_DIR', () => {
  assert.equal(
    resolveCcMasterHome({
      CC_MASTER_HOME: '/explicit/home',
      CLAUDE_CONFIG_DIR: '/cfg',
      HOME: '/h',
    }),
    '/explicit/home',
  );
});

test('resolveCcMasterHome: no CC_MASTER_HOME → $HOME/.cc_master (ignores CLAUDE_CONFIG_DIR)', () => {
  assert.equal(
    resolveCcMasterHome({ CLAUDE_CONFIG_DIR: '/cfg', HOME: '/h' }),
    join('/h', '.cc_master'),
  );
  assert.equal(resolveCcMasterHome({ HOME: '/h' }), join('/h', '.cc_master'));
});

test('resolveCcMasterHome compatibility facade is byte-equal to the central contract matrix', () => {
  const cases = [
    {},
    { HOME: '/home/alice' },
    { HOME: '/Users/收件人/My Project' },
    { HOME: '/home/alice', CC_MASTER_HOME: '/opt/cc master' },
    { HOME: 'relative-home' },
    { HOME: '/home/alice', CC_MASTER_HOME: 'relative-cc-master' },
  ];

  for (const env of cases) {
    assert.equal(
      resolveCcMasterHome(env),
      ccMasterHome(captureRuntimeEnvironment({ env })),
      `legacy facade drifted from RuntimeEnvironment contract for ${JSON.stringify(env)}`,
    );
  }
});

// ── resolveRateCachePath ─────────────────────────────────────────────────────────────────────────
test('resolveRateCachePath: $CC_MASTER_RATE_CACHE override wins', () => {
  assert.equal(
    resolveRateCachePath({ CC_MASTER_RATE_CACHE: '/x/sidecar.json', CLAUDE_CONFIG_DIR: '/cfg' }),
    '/x/sidecar.json',
  );
});

test('resolveRateCachePath: derives from cc-master home', () => {
  assert.equal(
    resolveRateCachePath({ CLAUDE_CONFIG_DIR: '/cfg', HOME: '/h' }),
    join('/h', '.cc_master', '.cc-master-rate-limits.json'),
  );
  assert.equal(
    resolveRateCachePath({ CC_MASTER_HOME: '/cc/home', CLAUDE_CONFIG_DIR: '/cfg', HOME: '/h' }),
    join('/cc/home', '.cc-master-rate-limits.json'),
  );
});

// ── resolveCredentialsPath（Linux/Windows file credential·CRED_PATH 覆写·跟随 CLAUDE_CONFIG_DIR）─────
test('resolveCredentialsPath: $CRED_PATH override wins', () => {
  assert.equal(
    resolveCredentialsPath({ CRED_PATH: '/x/.credentials.json', CLAUDE_CONFIG_DIR: '/cfg' }),
    '/x/.credentials.json',
  );
});

test('resolveCredentialsPath: Linux file credential follows CLAUDE_CONFIG_DIR', () => {
  // 这是 Linux 换号写路径①的落点：无 keychain → 写 <claudeConfigDir>/.credentials.json。
  assert.equal(
    resolveCredentialsPath({ CLAUDE_CONFIG_DIR: '/cfg', HOME: '/h' }),
    join('/cfg', '.credentials.json'),
  );
  assert.equal(resolveCredentialsPath({ HOME: '/h' }), join('/h', '.claude', '.credentials.json'));
});

// ── resolveClaudeJsonPath（双路径容错：<claudeConfigDir>/.claude.json 优先·缺退 $HOME/.claude.json）──────
test('resolveClaudeJsonPath: $CLAUDE_JSON_PATH override wins (absolutized)', () => {
  assert.equal(
    resolveClaudeJsonPath({ CLAUDE_JSON_PATH: '/x/.claude.json', CLAUDE_CONFIG_DIR: '/cfg' }),
    '/x/.claude.json',
  );
});

test('resolveClaudeJsonPath: prefers <claudeConfigDir>/.claude.json when it exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccm-paths-'));
  try {
    const inDir = join(dir, '.claude.json');
    writeFileSync(inDir, '{}');
    // CLAUDE_CONFIG_DIR points at dir (which HAS .claude.json) → that path is returned.
    assert.equal(resolveClaudeJsonPath({ CLAUDE_CONFIG_DIR: dir, HOME: '/h' }), inDir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveClaudeJsonPath: falls back to $HOME/.claude.json when configDir copy absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccm-paths-'));
  try {
    // configDir has NO .claude.json → fall back to $HOME/.claude.json.
    assert.equal(
      resolveClaudeJsonPath({ CLAUDE_CONFIG_DIR: dir, HOME: '/home/me' }),
      join('/home/me', '.claude.json'),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── resolveProjectsDir ───────────────────────────────────────────────────────────────────────────
test('resolveProjectsDir: <claudeConfigDir>/projects', () => {
  assert.equal(resolveProjectsDir({ CLAUDE_CONFIG_DIR: '/cfg' }), join('/cfg', 'projects'));
  assert.equal(resolveProjectsDir({ HOME: '/h' }), join('/h', '.claude', 'projects'));
});
