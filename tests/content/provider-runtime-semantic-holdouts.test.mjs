import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');

const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const readMarkdownTree = (path) => {
  const root = join(ROOT, path);
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(target);
    }
  };
  visit(root);
  return files.sort().map((file) => readFileSync(file, 'utf8')).join('\n');
};

test('Cursor master runtime contains no actionable Codex 7d admission gate', () => {
  const guide = read('plugin/dist/cursor/skills/master-orchestrator-guide/SKILL.md');
  assert.doesNotMatch(
    guide,
    /烧穿 7d 总闸|7d 都 85%|7d 配额已\s*≥?\s*85%|7d≥85%|继续烧 7d|继续消耗 7d 配额/u,
  );
});

test('Cursor native Task review guidance does not prescribe unadmitted API-family models', () => {
  const review = read(
    'plugin/dist/cursor/skills/master-orchestrator-guide/references/resume-verify.md',
  );
  assert.doesNotMatch(
    review,
    /本 host 机制（Cursor）[\s\S]{0,1200}(?:gpt-5\.6|Claude（Opus|Claude 档|GPT-5\.6)/iu,
  );
});

test('complete installed Codex skill portfolio contains no actionable five-hour pacing', () => {
  const portfolio = readMarkdownTree('plugin/dist/codex/skills');
  assert.doesNotMatch(
    portfolio,
    /当前账号\s*5h[·/]7d 用量|当前号\/备号\s*5h\/7d 用量|当前账户\s*5h\/7d|Claude Code\s*\/\s*Codex（5h\+7d）|当前 Codex 账户\s*5h\s*\+\s*7d|Codex 只保留[^\n]*5h\/7d/u,
  );
});

test('Claude runtime model facts include the current Sonnet 5 tier', () => {
  const models = read(
    'plugin/dist/claude-code/skills/pacing-and-estimation/references/model-tiers.md',
  );
  assert.match(models, /Sonnet 5|claude-sonnet-5/u);
});

test('Claude runtime model facts do not claim Fable is unconditionally unavailable', () => {
  const models = read(
    'plugin/dist/claude-code/skills/pacing-and-estimation/references/model-tiers.md',
  );
  assert.doesNotMatch(models, /Fable 5 当前不可用/u);
});
