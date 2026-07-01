// handler-upgrade.test.ts — upgrade handler 纯函数门（平台探测 + 双线版本解析）。
//   只测无 IO 的纯函数（detectAssetName / parseTag / compareSemver / pickLatestTag）——网络 + 自替换 +
//   shell-out 不在单测覆盖（需真 GitHub / 真 SEA / 真 claude CLI）。覆盖关键坑：① ccm 线 vs plugin 线 tag
//   前缀去歧（plugin 排除 ccm-v*）；② semver 排序取最新（含 prerelease）；③ 某线暂无 release → null（优雅）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareSemver,
  detectAssetName,
  parseTag,
  pickLatestTag,
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
