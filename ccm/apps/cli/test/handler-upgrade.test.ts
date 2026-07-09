// handler-upgrade.test.ts — upgrade handler 纯函数门（平台探测 + 双线版本解析）。
//   只测无 IO 的纯函数（detectAssetName / parseTag / compareSemver / pickLatestTag）——网络 + 自替换 +
//   shell-out 不在单测覆盖（需真 GitHub / 真 SEA / 真 claude CLI）。覆盖关键坑：① ccm 线 vs plugin 线 tag
//   前缀去歧（plugin 排除 ccm-v*）；② semver 排序取最新（含 prerelease）；③ 某线暂无 release → null（优雅）。

import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Ctx } from '../src/handlers/_common.js';
import {
  compareSemver,
  detectAssetName,
  parseTag,
  pickLatestTag,
  plugin,
} from '../src/handlers/upgrade.js';

// ── detectAssetName（与 install.sh detect_platform 同覆盖）──────────────────────────────────────────
test('detectAssetName maps supported platform/arch → ccm-<os>-<arch>', () => {
  assert.equal(detectAssetName('darwin', 'arm64'), 'ccm-darwin-arm64');
  assert.equal(detectAssetName('darwin', 'x64'), 'ccm-darwin-x64');
  assert.equal(detectAssetName('linux', 'arm64'), 'ccm-linux-arm64');
  assert.equal(detectAssetName('linux', 'x64'), 'ccm-linux-x64');
});
test('detectAssetName returns null for unsupported platform/arch', () => {
  assert.equal(detectAssetName('win32', 'x64'), null);
  assert.equal(detectAssetName('darwin', 'ia32'), null);
  assert.equal(detectAssetName('freebsd', 'arm64'), null);
});

// ── parseTag 双线前缀去歧 ─────────────────────────────────────────────────────────────────────────
test('parseTag ccm line matches only ccm-v* tags', () => {
  const p = parseTag('ccm-v1.2.3', 'ccm');
  assert.ok(p);
  assert.deepEqual(p?.parts, [1, 2, 3]);
  assert.equal(p?.pre, '');
  assert.equal(parseTag('v1.2.3', 'ccm'), null, '裸 v* 不是 ccm 线');
  assert.equal(parseTag('ccm-v1.2', 'ccm'), null, '非三段不匹配');
});
test('parseTag plugin line matches bare v* but excludes ccm-v*', () => {
  const p = parseTag('v0.10.0', 'plugin');
  assert.ok(p);
  assert.deepEqual(p?.parts, [0, 10, 0]);
  assert.equal(parseTag('ccm-v0.1.0', 'plugin'), null, 'ccm-v* 被 plugin 线排除');
  assert.equal(parseTag('0.10.0', 'plugin'), null, '缺 v 前缀不匹配');
});
test('parseTag captures prerelease segment', () => {
  assert.equal(parseTag('ccm-v1.0.0-rc.1', 'ccm')?.pre, 'rc.1');
  assert.equal(parseTag('v2.0.0-beta', 'plugin')?.pre, 'beta');
});

// ── compareSemver：core 优先 + 稳定版 > prerelease ─────────────────────────────────────────────────
test('compareSemver orders by core then stable-over-prerelease', () => {
  const a = parseTag('v1.2.3', 'plugin');
  const b = parseTag('v1.10.0', 'plugin');
  assert.ok(a && b);
  if (a && b) assert.equal(compareSemver(a, b), -1, '1.2.3 < 1.10.0（数值非字典序）');

  const stable = parseTag('v1.0.0', 'plugin');
  const pre = parseTag('v1.0.0-rc.1', 'plugin');
  assert.ok(stable && pre);
  if (stable && pre) {
    assert.equal(compareSemver(stable, pre), 1, '稳定版 > 同 core 的 prerelease');
    assert.equal(compareSemver(pre, stable), -1);
  }
});

// ── pickLatestTag：过滤该线 + 取 semver 最大；无匹配 → null（某线暂无 release）──────────────────────────
test('pickLatestTag picks the semver-greatest tag of its line', () => {
  const tags = ['ccm-v0.1.0', 'ccm-v0.2.0', 'v0.9.0', 'v0.10.0', 'ccm-v0.1.5', 'random-tag'];
  assert.equal(pickLatestTag(tags, 'ccm'), 'ccm-v0.2.0');
  assert.equal(pickLatestTag(tags, 'plugin'), 'v0.10.0', '0.10.0 > 0.9.0（数值序）');
});
test('pickLatestTag returns null when the line has no release（优雅·本线暂无 ccm-v*）', () => {
  // 现实场景：plugin 线已有 release，但 ccm 线（ccm-v*）暂无任何 release。
  const onlyPlugin = ['v0.9.0', 'v0.10.0'];
  assert.equal(
    pickLatestTag(onlyPlugin, 'ccm'),
    null,
    'ccm 线无 release → null（handler 据此优雅报错）',
  );
  assert.equal(pickLatestTag(onlyPlugin, 'plugin'), 'v0.10.0');
  assert.equal(pickLatestTag([], 'plugin'), null, '空列表 → null');
});

test('upgrade plugin --harness codex: dry-run updates marketplace registration plan', async () => {
  const out: string[] = [];
  const err: string[] = [];
  const root = mkdtempSync(join(tmpdir(), 'ccm-upgrade-codex-dry-'));
  const ctx: Ctx = {
    values: { harness: 'codex' },
    positionals: [],
    flags: {
      json: true,
      dryRun: true,
      force: false,
      yes: false,
      quiet: false,
      verbose: false,
      color: false,
    },
    sid: '',
    env: { HOME: root },
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  };

  const code = await plugin(ctx);
  assert.equal(code, 0, err.join('\n'));
  const parsed = JSON.parse(out[out.length - 1] || '{}');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.harness, 'codex');
  assert.equal(parsed.data.dry_run, true);
  assert.match(parsed.data.plugin_root, /cc-master-store|cc-master$/);
  assert.match(parsed.data.marketplace_root, /codex-marketplace$/);
  assert.equal(parsed.data.plugin_id, 'cc-master@cc-master');
});

test('upgrade plugin --harness codex: 注册本地 plugin', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-upgrade-codex-copy-'));
  const pluginBase = join(root, 'cc-master-store');
  const pluginRoot = join(pluginBase, 'codex', 'cc-master');
  const source = join(pluginRoot, 'skills');
  const codexHome = join(root, '.codex');
  const fakeCodex = makeFakeCodex(root);
  mkdirSync(source, { recursive: true });
  mkdirSync(join(pluginRoot, '.codex-plugin'), { recursive: true });
  mkdirSync(join(source, 'cc-master-as-master-orchestrator'), { recursive: true });
  writeFileSync(join(source, 'cc-master-as-master-orchestrator', 'SKILL.md'), 'skill body\n');
  writeFileSync(
    join(pluginRoot, '.codex-plugin', 'plugin.json'),
    '{"id":"cc-master","version":"0.0.0-test"}\n',
  );
  const out: string[] = [];
  const err: string[] = [];
  const ctx: Ctx = {
    values: { harness: 'codex' },
    positionals: [],
    flags: {
      json: true,
      dryRun: false,
      force: false,
      yes: false,
      quiet: false,
      verbose: false,
      color: false,
    },
    sid: '',
    env: {
      CC_MASTER_PLUGIN_DIR: pluginBase,
      CODEX_HOME: codexHome,
      HOME: root,
      PATH: `${fakeCodex.binDir}:${process.env.PATH || ''}`,
    },
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  };

  const code = await plugin(ctx);
  assert.equal(code, 0, err.join('\n'));
  const parsed = JSON.parse(out[out.length - 1] || '{}');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.action, 'updated');
  assert.equal(parsed.data.plugin_installed, true);
  assert.equal(parsed.data.plugin_id, 'cc-master@cc-master');
  assert.equal(parsed.data.plugin_root, pluginRoot);

  const marketplaceRoot = join(pluginBase, 'codex-marketplace');
  const marketplaceJson = join(marketplaceRoot, '.agents', 'plugins', 'marketplace.json');
  assert.equal(existsSync(marketplaceJson), true);
  const marketplace = JSON.parse(readFileSync(marketplaceJson, 'utf8'));
  assert.equal(marketplace.name, 'cc-master');
  assert.equal(marketplace.plugins[0].source.path, './plugins/cc-master');
  assert.equal(marketplace.plugins[0].policy.authentication, 'ON_USE');

  const codexCalls = readFileSync(fakeCodex.log, 'utf8');
  assert.match(codexCalls, /^--version$/m);
  assert.match(codexCalls, /^plugin marketplace add .*codex-marketplace$/m);
  assert.match(codexCalls, /^plugin add cc-master@cc-master$/m);
  assert.match(codexCalls, /^plugin list --json$/m);
});

test('upgrade plugin default: enumerates installed harnesses (Codex dry-run without network)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-upgrade-default-all-'));
  const codexHome = join(root, '.codex');
  const pluginRoot = join(root, 'cc-master');
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(join(pluginRoot, 'skills'), { recursive: true });
  const out: string[] = [];
  const err: string[] = [];
  const ctx: Ctx = {
    values: {},
    positionals: [],
    flags: {
      json: true,
      dryRun: true,
      force: false,
      yes: false,
      quiet: false,
      verbose: false,
      color: false,
    },
    sid: '',
    env: {
      HOME: root,
      CODEX_HOME: codexHome,
      CC_MASTER_PLUGIN_ROOT: pluginRoot,
      PATH: '/does/not/exist',
    },
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  };

  const code = await plugin(ctx);
  assert.equal(code, 0, err.join('\n'));
  const parsed = JSON.parse(out[out.length - 1] || '{}');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.action, 'all-harnesses');
  assert.deepEqual(
    parsed.data.results.map((r: { harness: string; action: string }) => [r.harness, r.action]),
    [['codex', 'dry_run']],
  );
});

test('upgrade plugin --all-harnesses: same as default inventory path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-upgrade-all-harnesses-'));
  const codexHome = join(root, '.codex');
  const pluginRoot = join(root, 'cc-master');
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(join(pluginRoot, 'skills'), { recursive: true });
  const out: string[] = [];
  const err: string[] = [];
  const ctx: Ctx = {
    values: { 'all-harnesses': true },
    positionals: [],
    flags: {
      json: true,
      dryRun: true,
      force: false,
      yes: false,
      quiet: false,
      verbose: false,
      color: false,
    },
    sid: '',
    env: {
      HOME: root,
      CODEX_HOME: codexHome,
      CC_MASTER_PLUGIN_ROOT: pluginRoot,
      PATH: '/does/not/exist',
    },
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  };

  const code = await plugin(ctx);
  assert.equal(code, 0, err.join('\n'));
  const parsed = JSON.parse(out[out.length - 1] || '{}');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.action, 'all-harnesses');
  assert.deepEqual(
    parsed.data.results.map((r: { harness: string; action: string }) => [r.harness, r.action]),
    [['codex', 'dry_run']],
  );
});

test('upgrade plugin: --harness and --all-harnesses are mutually exclusive', async () => {
  const out: string[] = [];
  const err: string[] = [];
  const ctx: Ctx = {
    values: { harness: 'codex', 'all-harnesses': true },
    positionals: [],
    flags: {
      json: false,
      dryRun: true,
      force: false,
      yes: false,
      quiet: false,
      verbose: false,
      color: false,
    },
    sid: '',
    env: { HOME: mkdtempSync(join(tmpdir(), 'ccm-upgrade-mutex-')) },
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  };
  const code = await plugin(ctx);
  assert.equal(code, 2);
  assert.match(err.join('\n'), /--harness.*--all-harnesses/);
});

function makeFakeCodex(root: string): { binDir: string; log: string } {
  const binDir = join(root, 'bin');
  const log = join(root, 'codex-args.log');
  mkdirSync(binDir, { recursive: true });
  const bin = join(binDir, 'codex');
  writeFileSync(
    bin,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> '${log}'
if [ "$1" = "--version" ]; then
  echo "codex 0.0.0-test"
  exit 0
fi
if [ "$1" = "plugin" ] && [ "$2" = "list" ]; then
  echo '{"installed":[{"pluginId":"cc-master@cc-master"}],"available":[]}'
  exit 0
fi
exit 0
`,
  );
  chmodSync(bin, 0o755);
  return { binDir, log };
}
