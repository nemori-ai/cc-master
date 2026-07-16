import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');

const entrySurfaces = {
  'Claude Code command': read(
    'plugin/src/commands/as-master-orchestrator/adapters/claude-code/body.md',
  ),
  'Codex entry skill': read(
    'plugin/src/skills/cc-master-as-master-orchestrator/canonical/SKILL.md',
  ),
  'Cursor IDE command': read(
    'plugin/src/commands/as-master-orchestrator/adapters/cursor/body.md',
  ),
  'Cursor IDE always-on rule': read(
    'plugin/src/rules/cursor/cc-master-orchestrator.mdc',
  ),
};

const projectedEntrySurfaces = {
  'Claude Code command': read(
    'plugin/dist/claude-code/commands/as-master-orchestrator.md',
  ),
  'Codex entry skill': read(
    'plugin/dist/codex/skills/cc-master-as-master-orchestrator/SKILL.md',
  ),
  'Cursor IDE command': read(
    'plugin/dist/cursor/commands/as-master-orchestrator.md',
  ),
  'Cursor IDE always-on rule': read(
    'plugin/dist/cursor/rules/cc-master-orchestrator.mdc',
  ),
};

test('master initialization surfaces establish a board-carried cross-harness identity', () => {
  for (const [surface, body] of Object.entries(entrySurfaces)) {
    assert.match(
      body,
      /连续身份[\s\S]*ccm[\s\S]*board[\s\S]*不由[\s\S]*(?:harness|session|conversation)[\s\S]*进程承载/u,
      `${surface}: identity continuity must live in ccm/board rather than the origin process`,
    );
    assert.match(
      body,
      /handoff[\s\S]*resume[\s\S]*跨 session[\s\S]*受支持的 origin harness/u,
      `${surface}: handoff/resume must allow a supported origin to continue the same orchestration`,
    );
  }
});

test('master initialization surfaces make all locally available supported harness agents candidates', () => {
  for (const [surface, body] of Object.entries(entrySurfaces)) {
    assert.match(
      body,
      /worker 候选[\s\S]*不局限[\s\S]*当前 origin harness/u,
      `${surface}: worker candidates must not stop at the current origin`,
    );
    assert.match(
      body,
      /本机[\s\S]*ccm 支持[\s\S]*可用[\s\S]*harness agent/u,
      `${surface}: the local ccm-supported available agent pool must be named`,
    );
    assert.match(body, /master-orchestrator-guide/u, `${surface}: decision guidance pointer`);
    assert.match(body, /using-ccm/u, `${surface}: worker operation pointer`);
    assert.doesNotMatch(
      body,
      /ccm worker\b/u,
      `${surface}: bootstrap identity surface must not duplicate worker CLI syntax`,
    );
  }
});

test('projected host-native entries preserve the cross-harness identity source exactly', () => {
  for (const [surface, projected] of Object.entries(projectedEntrySurfaces)) {
    assert.match(projected, /跨 harness 身份锚/u, `${surface}: projected identity anchor`);
    assert.match(
      projected,
      /worker 候选[\s\S]*不局限[\s\S]*当前 origin harness/u,
      `${surface}: projected cross-harness worker pool`,
    );
    assert.doesNotMatch(
      projected,
      /ccm worker\b/u,
      `${surface}: projected entry must not duplicate the worker command namespace`,
    );
    assert.equal(
      projected,
      entrySurfaces[surface],
      `${surface}: dist entry must be an exact projection of its source`,
    );
  }
});

test('the Cursor IDE role surface does not conflate Cursor Agent CLI workers', () => {
  const command = entrySurfaces['Cursor IDE command'];
  const rule = entrySurfaces['Cursor IDE always-on rule'];
  assert.match(command, /Cursor IDE Agent conversation/u);
  assert.match(rule, /Cursor IDE[\s\S]*origin/u);
  assert.match(rule, /cursor-agent[\s\S]*Cursor Agent CLI[\s\S]*worker target/u);
  assert.match(rule, /不是同一 (?:execution )?surface/u);
});

test('plugin entry surfaces keep the agent as the actor', () => {
  for (const [surface, body] of Object.entries(entrySurfaces)) {
    assert.match(
      body,
      /行动者始终是 agent[\s\S]*plugin[\s\S]*(?:初始化|指导)/u,
      `${surface}: plugin must remain initialization/guidance substrate`,
    );
  }
});
