import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import projection from '../../scripts/project-skill.cjs';

const { applySkillProjection, planSkillProjection } = projection;
const ROOT = join(import.meta.dirname, '..', '..');
const HOSTS = ['claude-code', 'codex', 'cursor', 'kimi-code'];
const RECIPE_SLOT = '{{USING_CCM_NATIVE_SUBAGENT_TRANSCRIPT_RECIPE}}';
const HANDLE_ROW_SLOT = '{{USING_CCM_TASK_ID_HANDLE_ROW}}';

const read = (path) => readFileSync(join(ROOT, path), 'utf8');

test('native subagent transcript guidance is an explicit per-host projection slot', () => {
  const catalog = read(
    'plugin/src/skills/using-ccm/canonical/references/command-catalog.md',
  );
  const guide = read(
    'plugin/src/skills/using-ccm/canonical/references/board-model-guide.md',
  );
  assert.match(catalog, new RegExp(RECIPE_SLOT.replace(/[{}]/gu, '\\$&'), 'u'));
  assert.match(guide, new RegExp(HANDLE_ROW_SLOT.replace(/[{}]/gu, '\\$&'), 'u'));
  assert.doesNotMatch(catalog, /subagents\/agent-<agentId>\.jsonl/u);
  assert.doesNotMatch(catalog, /Claude Code 落在/u);
  assert.match(catalog, /要流式观察 native subagent 时按下方 host-specific 配方登记具体 harness/u);
  assert.doesNotMatch(catalog, /--type subagent --harness origin/u);
  assert.doesNotMatch(guide, /subagents\/agent-<agentId>\.jsonl/u);

  for (const host of HOSTS) {
    const strategy = read(
      `plugin/src/skills/using-ccm/adapters/${host}/strategy.yaml`,
    );
    assert.match(strategy, new RegExp(RECIPE_SLOT.replace(/[{}]/gu, '\\$&'), 'u'), host);
    assert.match(strategy, new RegExp(HANDLE_ROW_SLOT.replace(/[{}]/gu, '\\$&'), 'u'), host);
  }
});

test('each using-ccm projection teaches only its verified native subagent transcript contract', () => {
  const expected = {
    'claude-code': {
      include: [
        /--harness claude-code/u,
        /subagents\/agent-<agentId>\.jsonl/u,
        /父 transcript 只作定位锚/u,
      ],
      exclude: [/agents\/main\/wire\.jsonl/u],
    },
    codex: {
      include: [/尚未实证可从父会话 transcript 派生/u, /只绑定子 agent 自己的可读 transcript/u],
      exclude: [/subagents\/agent-<agentId>\.jsonl/u, /agents\/main\/wire\.jsonl/u],
    },
    cursor: {
      include: [/SQLite `state\.vscdb`/u, /只绑定该 Task 子 agent 自己的纯文本日志/u],
      exclude: [/subagents\/agent-<agentId>\.jsonl/u, /agents\/main\/wire\.jsonl/u],
    },
    'kimi-code': {
      include: [
        /--harness kimi-code/u,
        /agents\/main\/wire\.jsonl/u,
        /agents\/<agentId>\/wire\.jsonl/u,
        /父 main wire 只作定位锚/u,
      ],
      exclude: [/subagents\/agent-<agentId>\.jsonl/u],
    },
  };

  for (const host of HOSTS) {
    const staging = mkdtempSync(join(tmpdir(), `using-ccm-subagent-${host}-`));
    try {
      const plan = planSkillProjection({
        repoRoot: ROOT,
        host,
        skill: 'using-ccm',
      });
      applySkillProjection(plan, staging);
      const catalog = readFileSync(join(staging, 'references/command-catalog.md'), 'utf8');
      const guide = readFileSync(join(staging, 'references/board-model-guide.md'), 'utf8');
      const recipe = catalog.match(
        /\*\*(?:Claude Code in-session|Codex native|Cursor Task|Kimi Code Task)[\s\S]*?(?=\n### agent amend)/u,
      )?.[0];
      const handleRow = guide.match(/^\| `task-id` \|.*$/mu)?.[0];
      assert.ok(recipe, `${host}: native subagent recipe`);
      assert.ok(handleRow, `${host}: task-id handle row`);
      const rendered = `${recipe}\n${handleRow}`;
      for (const pattern of expected[host].include) assert.match(rendered, pattern, host);
      for (const pattern of expected[host].exclude) assert.doesNotMatch(rendered, pattern, host);
      assert.doesNotMatch(rendered, /\{\{USING_CCM_(?:NATIVE_SUBAGENT_TRANSCRIPT_RECIPE|TASK_ID_HANDLE_ROW)\}\}/u);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
});
