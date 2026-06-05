import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const LINTER = join(HERE, '..', '..', 'skills', 'authoring-workflows', 'scripts', 'validate-workflow.mjs');
const fix = (n) => join(HERE, 'fixtures', n);

// returns {code, out}
function lint(file) {
  try {
    const out = execFileSync('node', [LINTER, file], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') }; }
}

test('good-minimal passes', () => {
  const { code } = lint(fix('good-minimal.js'));
  assert.equal(code, 0);
});

test('bad-no-meta fails with meta-first rule', () => {
  const { code, out } = lint(fix('bad-no-meta.js'));
  assert.equal(code, 1);
  assert.match(out, /meta/i);
});

const CASES = [
  ['bad-determinism.js', /determinism|Date\.now/i],
  ['bad-require.js', /require|escape/i],
  ['bad-meta-computed.js', /literal/i],
  ['bad-parallel-bare.js', /thunk|parallel/i],
];
for (const [f, re] of CASES) {
  test(`${f} fails`, () => {
    const { code, out } = lint(fix(f));
    assert.equal(code, 1, `${f} should fail`);
    assert.match(out, re);
  });
}
test('good-full passes', () => assert.equal(lint(fix('good-full.js')).code, 0));
// Regression: forbidden patterns (Date.now/require/parallel([...])) inside COMMENTS must not
// be flagged — the linter blanks comments before pattern-scanning.
test('good-commented passes (forbidden patterns in comments are ignored)', () =>
  assert.equal(lint(fix('good-commented.js')).code, 0));
