import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');
const json = (relative) => JSON.parse(read(relative));
const LICENSE_ID = 'PolyForm-Noncommercial-1.0.0';
const REQUIRED_NOTICE = 'Required Notice: Copyright (c) 2026 cc-master contributors.';

test('LICENSE preserves the official PolyForm Noncommercial 1.0.0 text and adds the project notice', () => {
  const license = read('LICENSE');
  assert.ok(license.endsWith(`${REQUIRED_NOTICE}\n`));

  const officialText = license.replace(`\n${REQUIRED_NOTICE}\n`, '');
  const digest = createHash('sha256').update(officialText).digest('hex');
  assert.equal(digest, 'c0ea4a896d2c8c394b29f9427589996db826cd501c512279ff0ed3ef48fabbe5');
  assert.doesNotMatch(license, /permission is hereby granted/iu);
});

test('all current plugin manifests declare the same noncommercial license', () => {
  const manifests = [
    'plugin/src/.claude-plugin/plugin.json',
    'plugin/src/.codex-plugin/plugin.json',
    'plugin/src/.cursor-plugin/plugin.json',
    'plugin/src/.kimi-plugin/plugin.json',
    'plugin/dist/claude-code/.claude-plugin/plugin.json',
    'plugin/dist/codex/.codex-plugin/plugin.json',
    'plugin/dist/cursor/.cursor-plugin/plugin.json',
    'plugin/dist/kimi-code/kimi.plugin.json',
  ];
  for (const manifest of manifests) {
    assert.equal(json(manifest).license, LICENSE_ID, manifest);
  }
  assert.equal(json('plugin/src/.claude-plugin/marketplace.json').plugins[0].license, LICENSE_ID);
});

test('all ccm package manifests declare the same noncommercial license', () => {
  for (const manifest of [
    'ccm/package.json',
    'ccm/apps/cli/package.json',
    'ccm/apps/web-viewer/package.json',
    'ccm/packages/engine/package.json',
  ]) {
    assert.equal(json(manifest).license, LICENSE_ID, manifest);
  }
});

test('public documentation states the source-available noncommercial boundary in both languages', () => {
  const english = read('README.md');
  const chinese = read('README_zh.md');
  const guide = read('LICENSING.md');
  const marks = read('TRADEMARKS.md');

  assert.match(english, /source-available for noncommercial use only/u);
  assert.match(english, /does not permit reselling this project/u);
  assert.match(chinese, /源代码可见，但仅授权非商业用途/u);
  assert.match(chinese, /不允许重新包装销售/u);
  assert.doesNotMatch(english, /\[MIT\]\(LICENSE\)/u);
  assert.doesNotMatch(chinese, /\[MIT\]\(LICENSE\)/u);

  assert.match(guide, /not an OSI-approved open\s+source license/u);
  assert.match(guide, /最后一个按原 MIT 协议发布/u);
  assert.match(guide, /49a9c6a6ff88c282be8d6c6f89669d7c99af1278/u);
  assert.match(marks, /you may\s+not:[\s\S]*brand a fork/iu);
  assert.match(marks, /不得.*把本项目伪装成你自己的原创产品/su);
});

test('plugin and ccm release paths distribute the license documents', () => {
  const packager = read('scripts/package-plugin.sh');
  for (const file of ['LICENSE', 'LICENSING.md', 'TRADEMARKS.md']) {
    assert.match(packager, new RegExp(`include_files=.*\\b${file.replace('.', '\\.')}\\b`, 'u'), file);
  }

  const pluginWorkflow = read('.github/workflows/plugin-release.yml');
  const validationBlocks = pluginWorkflow
    .split(/      - name: Validate /u)
    .slice(1)
    .filter((block) => /packaged (plugin|adapter)/u.test(block.split('\n', 1)[0]));
  assert.equal(validationBlocks.length, 4);
  for (const block of validationBlocks) {
    const step = block.split(/\n      - name: /u, 1)[0];
    for (const file of ['LICENSE', 'LICENSING.md', 'TRADEMARKS.md']) {
      assert.match(step, new RegExp(`/cc-master/${file.replace('.', '\\.')}"`, 'u'), file);
    }
  }

  const ccmWorkflow = read('.github/workflows/ccm-release.yml');
  assert.match(ccmWorkflow, /name: ccm-license-documents/u);
  assert.match(
    ccmWorkflow,
    /Attach checksums and license documents to GitHub release[\s\S]*LICENSE[\s\S]*LICENSING\.md[\s\S]*TRADEMARKS\.md/u,
  );
});
