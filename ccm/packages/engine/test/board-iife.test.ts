// board-iife.test.ts — @ccm/engine·IIFE 产物契约门（T1·browser 测试处置选项①）。
//
// 旧 cli/test 的 board-graph-core.browser.test.mjs 守的是「三份 classic <script>（board-model / lint-core /
//   graph-core）加载进同一浏览器 global 词法环境时各自的 UMD 尾照常发布 __ccmBoard* + 不 redeclare-throw」。
//   那套 UMD/globalThis 多文件路径在 TS 引擎里已废——webview 改由 tsdown 的**单个 IIFE 产物**消费（一个
//   bundle、一个 globalName），不再有「多脚本共享 realm 撞名」这个问题面。故本测试改为守新形态的等价契约：
//   **build 出的 dist/index.iife.js 在裸浏览器 realm 加载即把完整公开 API 挂上 globalThis.__ccmEngine，
//   且 analyzeGraph 能在该 realm 内正确跑一块嵌套 board**（验证 IIFE 产物的浏览器消费契约·选项①）。
//
// 依赖 build 产物：本测试在 `pnpm build` 之后跑（三道门顺序：build → typecheck → test）。dist 缺失时给出
//   明确指引而非静默假绿。

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const IIFE = join(HERE, '..', 'dist', 'index.iife.js');

// 造一个模拟浏览器宿主的 vm context：globalThis 存在、module/require 缺席。
//   classic <script> 语义：顶层 `var __ccmEngine = …` 成为 global 属性。banner 里的 require fallback
//   在无 require 时把 node:fs/node:crypto 退化成 {}（board-lock 在浏览器路径不被调用，占位足够）。
function browserRealmWithIIFE(src: string) {
  const ctx = vm.createContext({});
  vm.runInContext(src, ctx, { filename: 'index.iife.js' });
  return ctx;
}

test('dist/index.iife.js exists (built by `pnpm build` before this gate)', () => {
  assert.ok(
    existsSync(IIFE),
    'dist/index.iife.js 缺失——先跑 `pnpm -F @ccm/engine build`（三道门顺序：build → typecheck → test）。',
  );
});

test('IIFE publishes the full public API on globalThis.__ccmEngine (no throw in a bare browser realm)', () => {
  const src = readFileSync(IIFE, 'utf8');
  const ctx = browserRealmWithIIFE(src);
  const r = (expr: string) => vm.runInContext(expr, ctx);

  assert.equal(r('typeof globalThis.__ccmEngine'), 'object', '__ccmEngine published on globalThis');
  // 跨 4 个模块的代表性公开符号都挂上了。
  for (const fn of [
    'analyzeGraph',
    'nodeDuration',
    'estimateHours',
    'lintBoard',
    'formatReport',
    'buildGraph',
    'findCycle',
    'isEnumMember',
    'isAwaitingUser',
    'acquire',
    'release',
    'lockPathFor',
  ]) {
    assert.equal(
      r(`typeof globalThis.__ccmEngine.${fn}`),
      'function',
      `__ccmEngine.${fn} is a function`,
    );
  }
  // 值/常量导出。
  assert.equal(r('globalThis.__ccmEngine.SCHEMA_VERSION'), 'cc-master/v2');
  assert.equal(r('Array.isArray(globalThis.__ccmEngine.INVARIANTS)'), true);
  assert.equal(r('globalThis.__ccmEngine.ENUMS && globalThis.__ccmEngine.ENUMS.status.length'), 8);
});

test('IIFE realm: analyzeGraph runs a nested (owner + children) board correctly', () => {
  const src = readFileSync(IIFE, 'utf8');
  const ctx = browserRealmWithIIFE(src);

  const fixture = {
    schema: 'cc-master/v2',
    goal: 'g',
    owner: { active: true, session_id: 's' },
    git: { worktree: '', branch: '' },
    tasks: [
      { id: 'M1', status: 'in_flight', deps: [], kind: 'owner' },
      { id: 'M1.a', status: 'done', deps: [], parent: 'M1' },
      { id: 'M1.b', status: 'ready', deps: ['M1.a'], parent: 'M1' },
      { id: 'M2', status: 'in_flight', deps: [], kind: 'owner' },
      { id: 'M2.a', status: 'ready', deps: ['M1.b'], parent: 'M2' }, // 跨 owner 的 open dep
    ],
  };
  (ctx as Record<string, unknown>).__fixture = JSON.parse(JSON.stringify(fixture));
  // analyzeGraph 在 realm 内跑、realm 内 JSON.stringify 成纯字符串、本 realm parse 回纯结构（抹平 realm 归属）。
  const out = JSON.parse(
    vm.runInContext(
      `
    const g = globalThis.__ccmEngine.analyzeGraph(__fixture);
    JSON.stringify({
      childrenM1: g.children('M1'),
      childrenM2: g.children('M2'),
      parentOfM1b: g.parentOf('M1.b'),
      rollupM1: g.rollupProgress('M1'),
      longest: g.longestPath(),
      ready: g.readySet().sort(),
      rollupConsistency: g.rollupConsistency(),
    })
  `,
      ctx,
    ),
  );

  assert.deepEqual(out.childrenM1, ['M1.a', 'M1.b'], 'M1 children invert parent edges');
  assert.deepEqual(out.childrenM2, ['M2.a'], 'M2 owns M2.a');
  assert.equal(out.parentOfM1b, 'M1');
  assert.deepEqual(out.rollupM1, { done: 1, total: 2, ratio: 0.5 });
  assert.deepEqual(out.longest, { chain: ['M1.a', 'M1.b', 'M2.a'], length: 3 });
  assert.deepEqual(out.ready, ['M1.b']);
  assert.deepEqual(out.rollupConsistency, []);
});

test('IIFE realm: lintBoard runs and flags a hard schema error', () => {
  const src = readFileSync(IIFE, 'utf8');
  const ctx = browserRealmWithIIFE(src);
  (ctx as Record<string, unknown>).__bad = JSON.stringify({
    schema: 'cc-master/v1',
    goal: 'g',
    owner: { active: true, session_id: 's' },
    git: {},
    tasks: [],
  });
  const out = JSON.parse(
    vm.runInContext(
      `
    const r = globalThis.__ccmEngine.lintBoard(__bad);
    JSON.stringify({ rules: r.errors.map((e) => e.rule) })
  `,
      ctx,
    ),
  );
  assert.ok(
    out.rules.includes('FMT-SCHEMA'),
    'lintBoard flags FMT-SCHEMA hard error in the IIFE realm',
  );
});
