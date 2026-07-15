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

test('GC-07/08/09: lifecycle hooks declare cross-host goal guards', () => {
  for (const host of ['claude-code', 'codex', 'cursor']) {
    assert.match(bootstrap[host === 'claude-code' ? 'claude' : host], /PARITY: rule-bootstrap-raw-request-is-evidence/);
  }
  for (const rel of [
    'plugin/src/hooks/identity-nudge/implementations/claude-code/identity-nudge.js',
    'plugin/src/hooks/identity-nudge/implementations/codex/identity-nudge-core.js',
    'plugin/src/hooks/identity-nudge/implementations/cursor/identity-nudge-core.js',
    'plugin/src/hooks/verify-board/implementations/claude-code/verify-board.js',
    'plugin/src/hooks/verify-board/implementations/codex/verify-board-core.js',
    'plugin/src/hooks/verify-board/implementations/cursor/verify-board-core.js',
  ]) {
    assert.match(read(rel), /goal_contract|goal-contract/);
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
  assert.match(reference, /ccm log add.*--kind finding/);
  assert.match(reference, /不借机改写 Goal Contract 或成功状态/);
});
