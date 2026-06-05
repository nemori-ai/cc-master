import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('plugin.json is valid and well-formed', () => {
  const j = JSON.parse(read('.claude-plugin/plugin.json'));
  assert.equal(j.name, 'cc-master');
  assert.ok(typeof j.version === 'string' && j.version.length > 0);
  assert.ok(typeof j.description === 'string' && j.description.length > 0);
});

test('hooks.json registers all 3 hooks via plugin-root paths', () => {
  const h = JSON.parse(read('hooks/hooks.json'));
  assert.ok(h.hooks.UserPromptSubmit, 'UserPromptSubmit registered');
  assert.ok(h.hooks.Stop, 'Stop registered');
  assert.ok(h.hooks.SessionStart, 'SessionStart registered');
  const all = JSON.stringify(h);
  for (const s of ['bootstrap-board.sh', 'verify-board.sh', 'reinject.sh']) assert.match(all, new RegExp(s));
  assert.match(all, /CLAUDE_PLUGIN_ROOT/);
});

test('sentinel consistency: command body carries the exact string the bootstrap hook greps', () => {
  const cmd = read('commands/as-master-orchestrator.md');
  const hook = read('hooks/scripts/bootstrap-board.sh');
  assert.match(cmd, /<!-- cc-master:bootstrap:v1 -->/, 'command embeds body sentinel');
  assert.match(hook, /cc-master:bootstrap:v1/, 'hook greps body sentinel');
  assert.match(hook, /cc-master:as-master-orchestrator/, 'hook also greps command-name sentinel');
});

test('every SKILL.md has YAML frontmatter with name + description', () => {
  const skillDirs = readdirSync(join(ROOT, 'skills'));
  for (const d of skillDirs) {
    const md = read(`skills/${d}/SKILL.md`);
    assert.match(md, /^---\n[\s\S]*?^name:\s*\S+/m, `${d}/SKILL.md has name`);
    assert.match(md, /\ndescription:\s*\S+/m, `${d}/SKILL.md has description`);
  }
});
