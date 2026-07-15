import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');

const bootstrap = {
  claude: read('plugin/src/hooks/bootstrap-board/implementations/claude-code/bootstrap-board.sh'),
  codex: read('plugin/src/hooks/bootstrap-board/implementations/codex/bootstrap-board-core.js'),
  cursor: read('plugin/src/hooks/bootstrap-board/implementations/cursor/bootstrap-board-core.js'),
};

test('GC-01: no host bootstrap forwards raw goal text to board init', () => {
  for (const [host, body] of Object.entries(bootstrap)) {
    assert.doesNotMatch(
      body,
      /['"]--goal['"]/,
      `${host} bootstrap must create a pending skeleton, not copy raw input`,
    );
  }
});

test('GC-02/05: entry and resume surfaces name the Goal Contract lifecycle', () => {
  const command = read('plugin/src/commands/as-master-orchestrator/adapters/claude-code/body.md');
  const guide = read('plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md');
  assert.match(command, /ccm goal set/);
  assert.match(command, /raw request.*不是.*goal|原始请求.*不是.*目标/s);
  assert.match(command, /ccm goal check/);
  assert.match(guide, /references\/goal-contract\.md/);
});

test('GC-13: detailed semantic procedure has one canonical reference', () => {
  const reference = read(
    'plugin/src/skills/master-orchestrator-guide/canonical/references/goal-contract.md',
  );
  assert.match(reference, /Goal Framing Test/);
  assert.match(reference, /Goal Trace Test/);
  assert.match(reference, /Goal Delta Classifier/);
  assert.match(reference, /有用.*相关/);
});
