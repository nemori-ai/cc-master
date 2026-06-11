import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
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

test('hooks.json registers all 5 hook scripts across 4 events via plugin-root paths', () => {
  const h = JSON.parse(read('hooks/hooks.json'));
  assert.ok(h.hooks.UserPromptSubmit, 'UserPromptSubmit registered');
  assert.ok(h.hooks.Stop, 'Stop registered');
  assert.ok(h.hooks.SessionStart, 'SessionStart registered');
  assert.ok(h.hooks.PostToolBatch, 'PostToolBatch registered');
  // Stop carries two hooks: the goal-hook (verify-board) + the node usage-pacing hook.
  assert.equal(h.hooks.Stop.length, 2, 'Stop has both verify-board and usage-pacing');
  const all = JSON.stringify(h);
  for (const s of ['bootstrap-board.sh', 'verify-board.sh', 'reinject.sh', 'posttool-batch.sh', 'usage-pacing.js']) assert.match(all, new RegExp(s));
  assert.match(all, /CLAUDE_PLUGIN_ROOT/);
});

test('sentinel consistency: command body carries the exact string the bootstrap hook greps', () => {
  const cmd = read('commands/as-master-orchestrator.md');
  const hook = read('hooks/scripts/bootstrap-board.sh');
  assert.match(cmd, /<!-- cc-master:bootstrap:v1 -->/, 'command embeds body sentinel');
  assert.match(hook, /cc-master:bootstrap:v1/, 'hook greps body sentinel');
  assert.match(hook, /cc-master:as-master-orchestrator/, 'hook also greps command-name sentinel');
});

test('every SKILL.md (distributed + project-internal) has YAML frontmatter with name + description', () => {
  // Validate BOTH the distributed plugin skills (skills/) and the project-internal dev skills
  // (.claude/skills/, e.g. cc-master-skillsmith) — the latter are not shipped but are still tracked
  // skills that must load, so they get the same structure gate (Finding #1 YAML footgun applies to both).
  for (const label of ['skills', '.claude/skills']) {
    const dir = join(ROOT, label);
    if (!existsSync(dir)) continue;
    for (const d of readdirSync(dir)) {
      if (!statSync(join(dir, d)).isDirectory()) continue;
      if (!existsSync(join(dir, d, 'SKILL.md'))) continue;
      const md = read(`${label}/${d}/SKILL.md`);
      assert.match(md, /^---\n[\s\S]*?^name:\s*\S+/m, `${label}/${d}/SKILL.md has name`);
      assert.match(md, /\ndescription:\s*\S+/m, `${label}/${d}/SKILL.md has description`);
    }
  }
});
