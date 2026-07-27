import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');

test('package and workflow consume only the frozen four-host release transaction', () => {
  const packageScript = read('scripts/package-plugin.sh');
  assert.match(packageScript, /--manifest is required/u);
  assert.match(packageScript, /trusted-release-bundle\.mjs/u);
  assert.doesNotMatch(packageScript, /sync-plugin-dist|plugin\/dist|plugin\/src|--all-hosts/u);

  const workflow = read('.github/workflows/plugin-release.yml');
  assert.match(workflow, /Download attested immutable release inputs/u);
  assert.match(workflow, /release-attestation\.json|cc-master-plugin-\$\{\{/u);
  assert.doesNotMatch(workflow, /softprops\/action-gh-release|tags:\s*\n/u);
});

test('installer help and distribution map expose kimi-code as a first-class target', () => {
  const installer = read('install.sh');
  assert.match(installer, /--harness claude-code\|codex\|cursor\|kimi-code\|auto/u);
  assert.match(installer, /Kimi Code：复制到 \$KIMI_CODE_HOME\/plugins\/managed\/cc-master/u);
});
