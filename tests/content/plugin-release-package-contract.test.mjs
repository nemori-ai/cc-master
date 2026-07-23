import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');

test('kimi package validation is closed over every load-bearing manifest surface', () => {
  const manifest = JSON.parse(read('plugin/dist/kimi-code/kimi.plugin.json'));
  assert.ok(Array.isArray(manifest.hooks) && manifest.hooks.length > 0, 'kimi manifest must register hooks');
  assert.ok(
    manifest.hooks.every(({ command }) => typeof command === 'string' && command.includes('/hooks/')),
    'each kimi hook command must resolve through the packaged hooks tree',
  );

  const packageScript = read('scripts/package-plugin.sh');
  assert.match(
    packageScript,
    /\[ -d "\$\{pkg\}\/hooks" \] \|\| die "缺 hooks\/——kimi\.plugin\.json 已注册运行时 hooks，不能发布悬空命令"/u,
  );
  assert.match(packageScript, /command\.matchAll\(\/\\\$KIMI_PLUGIN_ROOT/u);
  assert.match(packageScript, /existsSync\(join\(process\.env\.KIMI_PACKAGE_ROOT, relative\)\)/u);

  const workflow = read('.github/workflows/plugin-release.yml');
  const kimiValidation = workflow.split('- name: Validate kimi-code packaged adapter')[1] ?? '';
  assert.match(kimiValidation, /test -d "\$\{DEST\}\/cc-master\/hooks"/u);
});

test('installer help and distribution map expose kimi-code as a first-class target', () => {
  const installer = read('install.sh');
  assert.match(installer, /--harness claude-code\|codex\|cursor\|kimi-code\|auto/u);
  assert.match(installer, /Kimi Code：复制到 \$KIMI_CODE_HOME\/plugins\/managed\/cc-master/u);
});
