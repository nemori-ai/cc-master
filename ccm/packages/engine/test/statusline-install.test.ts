// statusline-install.test.ts — @ccm/engine·install / uninstall / autoInstall + capture 契约门（0.10.0）。
//   全程临时 CLAUDE_CONFIG_DIR（绝不碰真实 ~/.claude）。钉住：备份/覆写/恢复/幂等/opt-out/kill-switch/坏JSON 安全 +
//   sidecar 捕获（缺 rate_limits 不抹旧值·原子写形态）。测 build 后的 dist barrel。

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import {
  autoInstallStatuslineOnce,
  captureRateLimits,
  installStatusline,
  uninstallStatusline,
} from '../dist/index.mjs';

let DIRS: string[] = [];
function mkdir(): string {
  const d = mkdtempSync(join(tmpdir(), 'ccm-sl-'));
  DIRS.push(d);
  return d;
}
afterEach(() => {
  for (const d of DIRS) rmSync(d, { recursive: true, force: true });
  DIRS = [];
});

const CMD = '/abs/path/ccm statusline';
function envFor(dir: string): Record<string, string | undefined> {
  return { CLAUDE_CONFIG_DIR: dir, HOME: dir, CC_MASTER_NOW: '2026-06-30T00:00:00Z' };
}
function readSettings(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
}
function exists(p: string): boolean {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}

// ── install：备份用户原 statusLine + 覆写 ─────────────────────────────────────────────────────────
test('install: 备份用户原 statusLine 并覆写为 ccm 命令', () => {
  const dir = mkdir();
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({ theme: 'dark', statusLine: { type: 'command', command: 'old-sl' } }),
  );
  const r = installStatusline(envFor(dir), CMD);
  assert.equal(r.action, 'installed');
  assert.equal(r.backedUp, true);
  const s = readSettings(dir);
  assert.deepEqual(s.statusLine, { type: 'command', command: CMD }, '覆写为 ccm 命令');
  assert.equal(s.theme, 'dark', '其余设置保留');
  // 原值备份进 state 文件（不污染 settings.json schema）。
  const state = JSON.parse(readFileSync(join(dir, '.cc-master-statusline-state.json'), 'utf8'));
  assert.equal(state.managed, true);
  assert.deepEqual(state.backup, { type: 'command', command: 'old-sl' });
  assert.ok(exists(join(dir, '.cc-master-statusline-installed')), 'installed marker 落');
});

test('install: 无 settings.json → 新建并装', () => {
  const dir = mkdir();
  const r = installStatusline(envFor(dir), CMD);
  assert.equal(r.action, 'installed');
  assert.equal(r.backedUp, false);
  assert.deepEqual(readSettings(dir).statusLine, { type: 'command', command: CMD });
});

test('install: 幂等（第二次 = noop·不重复备份）', () => {
  const dir = mkdir();
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({ statusLine: { type: 'command', command: 'orig' } }),
  );
  installStatusline(envFor(dir), CMD);
  const r2 = installStatusline(envFor(dir), CMD);
  assert.equal(r2.action, 'noop');
  const state = JSON.parse(readFileSync(join(dir, '.cc-master-statusline-state.json'), 'utf8'));
  assert.deepEqual(state.backup, { type: 'command', command: 'orig' }, '备份仍是最初的 orig');
});

test('install: 命令变更 → updated（备份不变）', () => {
  const dir = mkdir();
  installStatusline(envFor(dir), CMD);
  const r2 = installStatusline(envFor(dir), '/new/ccm statusline');
  assert.equal(r2.action, 'updated');
  assert.equal(readSettings(dir).statusLine.command, '/new/ccm statusline');
});

// ── uninstall：从备份恢复 + opt-out ───────────────────────────────────────────────────────────────
test('uninstall: 恢复用户原 statusLine + 落 opt-out', () => {
  const dir = mkdir();
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({ statusLine: { type: 'command', command: 'mine' } }),
  );
  installStatusline(envFor(dir), CMD);
  const r = uninstallStatusline(envFor(dir));
  assert.equal(r.action, 'restored');
  assert.deepEqual(readSettings(dir).statusLine, { type: 'command', command: 'mine' }, '恢复原值');
  assert.ok(exists(join(dir, '.cc-master-statusline-optout')), 'opt-out marker 落');
  assert.ok(!exists(join(dir, '.cc-master-statusline-installed')), 'installed marker 清');
});

test('uninstall: 用户原本无 statusLine → 删字段（removed）', () => {
  const dir = mkdir();
  installStatusline(envFor(dir), CMD); // 无原值
  const r = uninstallStatusline(envFor(dir));
  assert.equal(r.action, 'removed');
  assert.ok(!('statusLine' in readSettings(dir)), 'statusLine 字段删净');
});

// ── autoInstall：marker 守 + opt-out + kill-switch ────────────────────────────────────────────────
test('autoInstall: 首次装·第二次 skip（marker 守·幂等）', () => {
  const dir = mkdir();
  const r1 = autoInstallStatuslineOnce(envFor(dir), CMD);
  assert.equal(r1.action, 'installed');
  const r2 = autoInstallStatuslineOnce(envFor(dir), CMD);
  assert.equal(r2.action, 'skipped');
  assert.equal(r2.reason, 'already-installed');
});

test('autoInstall: opt-out 标记在 → 永不再装（不跟用户较劲）', () => {
  const dir = mkdir();
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({ statusLine: { type: 'command', command: 'mine' } }),
  );
  installStatusline(envFor(dir), CMD);
  uninstallStatusline(envFor(dir)); // 落 opt-out
  const r = autoInstallStatuslineOnce(envFor(dir), CMD);
  assert.equal(r.action, 'skipped');
  assert.equal(r.reason, 'opt-out');
  assert.deepEqual(
    readSettings(dir).statusLine,
    { type: 'command', command: 'mine' },
    '原值仍在·未被重装覆盖',
  );
});

test('autoInstall: kill-switch（CC_MASTER_NO_AUTOINSTALL）→ skip', () => {
  const dir = mkdir();
  const env = { ...envFor(dir), CC_MASTER_NO_AUTOINSTALL: '1' };
  const r = autoInstallStatuslineOnce(env, CMD);
  assert.equal(r.action, 'skipped');
  assert.equal(r.reason, 'kill-switch');
  assert.ok(!exists(join(dir, 'settings.json')), '未写任何 settings');
});

test('显式 install 清 opt-out（用户改主意）', () => {
  const dir = mkdir();
  installStatusline(envFor(dir), CMD);
  uninstallStatusline(envFor(dir)); // opt-out
  const r = installStatusline(envFor(dir), CMD); // 显式重装
  assert.equal(r.action, 'installed');
  assert.ok(!exists(join(dir, '.cc-master-statusline-optout')), 'opt-out 被显式 install 清除');
});

// ── 坏 JSON 安全：绝不覆写可能毁掉用户配置的 settings.json ──────────────────────────────────────────
test('install: settings.json 坏 JSON → error·绝不覆写', () => {
  const dir = mkdir();
  writeFileSync(join(dir, 'settings.json'), '{ this is not json ');
  const r = installStatusline(envFor(dir), CMD);
  assert.equal(r.action, 'error');
  assert.equal(r.reason, 'settings-unparseable');
  assert.equal(
    readFileSync(join(dir, 'settings.json'), 'utf8'),
    '{ this is not json ',
    '原文件原样未动',
  );
});

// ── capture：把 rate_limits 落 sidecar ────────────────────────────────────────────────────────────
test('capture: rate_limits 齐 → 落 sidecar（含 captured_at + 两窗口·CC_MASTER_NOW 确定性）', () => {
  const dir = mkdir();
  const cache = join(dir, 'rate.json');
  const env = { CC_MASTER_RATE_CACHE: cache, CC_MASTER_NOW: '2026-06-30T00:00:00Z' };
  const r = captureRateLimits(
    {
      rate_limits: {
        five_hour: { used_percentage: 64, resets_at: 1750000000 },
        seven_day: { used_percentage: 14 },
      },
    },
    env,
  );
  assert.equal(r.captured, true);
  const sc = JSON.parse(readFileSync(cache, 'utf8'));
  assert.equal(sc.captured_at, Math.floor(Date.parse('2026-06-30T00:00:00Z') / 1000));
  assert.deepEqual(sc.five_hour, { used_percentage: 64, resets_at: 1750000000 });
  assert.deepEqual(sc.seven_day, { used_percentage: 14 });
});

test('capture: 缺 rate_limits → 不写 sidecar（不抹旧值）', () => {
  const dir = mkdir();
  const cache = join(dir, 'rate.json');
  writeFileSync(cache, JSON.stringify({ captured_at: 1, five_hour: { used_percentage: 99 } }));
  const r = captureRateLimits(
    { context_window: { used_percentage: 50 } },
    {
      CC_MASTER_RATE_CACHE: cache,
    },
  );
  assert.equal(r.captured, false);
  // 旧值原样保留。
  assert.deepEqual(JSON.parse(readFileSync(cache, 'utf8')).five_hour, { used_percentage: 99 });
});

test('capture: 非数值 used_percentage → 视缺失（不写）', () => {
  const dir = mkdir();
  const cache = join(dir, 'rate.json');
  const r = captureRateLimits(
    { rate_limits: { five_hour: { used_percentage: null } } },
    {
      CC_MASTER_RATE_CACHE: cache,
    },
  );
  assert.equal(r.captured, false);
  assert.ok(!exists(cache), '未建文件');
});
