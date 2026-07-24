import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function isIgnored(candidate) {
  const result = spawnSync(
    'git',
    ['check-ignore', '--no-index', '-q', '--', candidate],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.ok(
    result.status === 0 || result.status === 1,
    `git check-ignore failed for ${candidate}: ${result.stderr}`,
  );
  return result.status === 0;
}

test('eval publication boundary ignores volatile run exhaust', () => {
  for (const candidate of [
    'design_docs/eval/example/.runs/run-1/transcript.md',
    'design_docs/eval/example/runs/run-1/raw.jsonl',
    'design_docs/eval/example/raw/agent-response.json',
    'design_docs/eval/example/track-a/pre-train.log',
    'design_docs/eval/example/run-1/stderr.txt',
    'design_docs/eval/example/run-1/timing.json',
    'design_docs/eval/example/run-1/ccm-trace.jsonl',
    'design_docs/eval/example/green-track-b/track-b-with-run-1.md',
  ]) {
    assert.equal(isIgnored(candidate), true, `expected ignored: ${candidate}`);
  }
});

test('eval publication boundary keeps contracts, fixtures, prompts, and results visible', () => {
  for (const candidate of [
    'design_docs/eval/example/README.md',
    'design_docs/eval/example/trigger-train.json',
    'design_docs/eval/example/green-track-b/RESULTS.md',
    'design_docs/eval/example/green-track-b/assertions.md',
    'design_docs/eval/example/green-track-b/track-b-with-skill-prompt.md',
    'design_docs/eval/example/green-track-b/verdicts.json',
  ]) {
    assert.equal(isIgnored(candidate), false, `expected visible: ${candidate}`);
  }
});

test('eval README declares the public evidence retention boundary', () => {
  const readme = fs.readFileSync(path.join(repoRoot, 'design_docs', 'eval', 'README.md'), 'utf8');
  assert.match(readme, /Public evidence contract/);
  assert.match(readme, /decision-grade evidence/);
  assert.match(readme, /\.runs\//);
});
