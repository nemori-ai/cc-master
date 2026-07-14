import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const sourcePath = new URL(
  '../../plugin/src/adapters/native-attempt/adapters/codex/native-attempt.js',
  import.meta.url,
);
const distPath = new URL('../../plugin/dist/codex/adapters/native-attempt.js', import.meta.url);
const strategyPath = (host) =>
  new URL(`../../plugin/src/adapters/native-attempt/adapters/${host}/strategy.yaml`, import.meta.url);

test('native-attempt runtime stays unsupported on every projected host', () => {
  for (const host of ['claude-code', 'codex', 'cursor']) {
    const strategy = readFileSync(strategyPath(host), 'utf8');
    assert.match(strategy, /^mode: unsupported$/m, `${host} unexpectedly enabled native invoke`);
    assert.doesNotMatch(strategy, /^mode: host_native$/m, `${host} inherited spawn support`);
    assert.doesNotMatch(strategy, /^projection:/m, `${host} retained an invoke projection`);
  }
});

test('unsupported Codex runtime ships no invokable source or generated artifact', () => {
  assert.equal(existsSync(sourcePath), false, 'unsupported Codex runtime retained invoke source');
  assert.equal(existsSync(distPath), false, 'unsupported Codex runtime retained invoke projection');
});
