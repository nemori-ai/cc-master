// suggest.test.mjs — P5.1·suggest.js（did-you-mean·Damerau-Levenshtein）契约门。
//
// 钉死：suggestSimilar('baord',['board','task']) 含 'board'；完全无关输入返回空；按距离升序；
//   相邻换位（transposition）一步距离；空输入/空候选边界。CJS 经 createRequire 加载。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);
const SUGGEST = 'cli/src/suggest.js';

test('suggest.js exists in cli/src (CLI package, requirable)', () => {
  assert.ok(existsSync(join(ROOT, SUGGEST)), 'suggest.js exists in cli/src');
});

const S = require(join(ROOT, SUGGEST));

// ── 核心要求：典型打字错命中 ──────────────────────────────────────────────────────────────────────
test("suggestSimilar('baord', ['board','task']) includes 'board'", () => {
  const out = S.suggestSimilar('baord', ['board', 'task']);
  assert.ok(out.includes('board'), `expected 'board' in suggestions, got ${JSON.stringify(out)}`);
  // 'task' 与 'baord' 相距甚远，不该出现。
  assert.ok(!out.includes('task'), `'task' should not be suggested for 'baord', got ${JSON.stringify(out)}`);
});

test('完全无关输入返回空 []', () => {
  assert.deepEqual(S.suggestSimilar('zzzzzzzz', ['board', 'task', 'log']), []);
  assert.deepEqual(S.suggestSimilar('qqqq', ['cadence', 'watchdog']), []);
});

// ── noun/verb 真实场景（registry candidates）─────────────────────────────────────────────────────
test('typo across realistic noun set ranks closest first', () => {
  const nouns = ['board', 'task', 'log', 'jc', 'cadence', 'watchdog'];
  assert.deepEqual(S.suggestSimilar('tsak', nouns)[0], 'task');   // transposition
  assert.deepEqual(S.suggestSimilar('borad', nouns)[0], 'board'); // transposition
  assert.deepEqual(S.suggestSimilar('cadance', nouns)[0], 'cadence'); // one sub
});

test('verb typos resolve', () => {
  const verbs = ['add', 'show', 'list', 'update', 'rm', 'start', 'done', 'block'];
  assert.deepEqual(S.suggestSimilar('ad', verbs)[0], 'add');
  assert.deepEqual(S.suggestSimilar('shwo', verbs)[0], 'show');   // transposition
  assert.deepEqual(S.suggestSimilar('updaet', verbs)[0], 'update'); // transposition
});

// ── 排序：按距离升序 ─────────────────────────────────────────────────────────────────────────────
test('results are sorted by ascending edit distance', () => {
  // 'lst' → 'list'(1 ins) 最近；候选里放几个不同距离的。
  const out = S.suggestSimilar('lst', ['list', 'last', 'lost', 'task']);
  // 'list' 距离 1（插 i），'last' 距离 1（插 a），'lost' 距离 1（插 o）——都距 1，'task' 远。
  assert.ok(out.length >= 1);
  assert.ok(!out.includes('task'), `'task' too far, got ${JSON.stringify(out)}`);
  // 第一个的距离不大于最后一个的距离（升序）。
  const d0 = S.damerauLevenshtein('lst', out[0]);
  const dN = S.damerauLevenshtein('lst', out[out.length - 1]);
  assert.ok(d0 <= dN, `ascending distance: ${d0} <= ${dN} (out=${JSON.stringify(out)})`);
});

// ── 精确命中：自身唯一返回 ───────────────────────────────────────────────────────────────────────
test('exact match returns only itself', () => {
  assert.deepEqual(S.suggestSimilar('board', ['board', 'broad', 'boards']), ['board']);
});

// ── 边界 ──────────────────────────────────────────────────────────────────────────────────────────
test('empty input or empty candidates → []', () => {
  assert.deepEqual(S.suggestSimilar('', ['board']), []);
  assert.deepEqual(S.suggestSimilar('board', []), []);
  assert.deepEqual(S.suggestSimilar('', []), []);
});

test('non-string input / non-array candidates → [] (defensive)', () => {
  assert.deepEqual(S.suggestSimilar(null, ['board']), []);
  assert.deepEqual(S.suggestSimilar(undefined, ['board']), []);
  assert.deepEqual(S.suggestSimilar('board', null), []);
  assert.deepEqual(S.suggestSimilar(42, ['board']), []);
});

test('skips non-string candidates without crashing', () => {
  const out = S.suggestSimilar('baord', ['board', null, 42, '', 'task']);
  assert.deepEqual(out, ['board']);
});

// ── damerauLevenshtein 直接验（换位 = 1，非 2）─────────────────────────────────────────────────────
test('damerauLevenshtein: transposition is one edit (Damerau, not plain Levenshtein)', () => {
  assert.equal(S.damerauLevenshtein('baord', 'board'), 1);  // ao↔oa 换位 = 1
  assert.equal(S.damerauLevenshtein('ca', 'ac'), 1);
  assert.equal(S.damerauLevenshtein('board', 'board'), 0);  // 相同 = 0
  assert.equal(S.damerauLevenshtein('', 'abc'), 3);         // 空串 → 全增
  assert.equal(S.damerauLevenshtein('abc', ''), 3);
  assert.equal(S.damerauLevenshtein('kitten', 'sitting'), 3); // 经典 Levenshtein 例
});
