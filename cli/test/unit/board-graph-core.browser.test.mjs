// board-graph-core.browser.test.mjs — D3.7 followup·浏览器 classic-script 共享 global 词法环境回归守卫。
//
// 锁的不变式（codex P2 bug 的永久回归门）：board-lint-core.js 与 board-graph-core.js 作为两个 classic
//   `<script>` 加载进**同一个浏览器 global 词法环境**时，board-graph-core 的 __ccmBoardGraphCore 必须照常发布。
//   bug 形态：lint-core 顶层声明 `function buildGraph/findCycle` + `const ISO_UTC_RE`（泄漏进 global 词法环境）；
//   若 graph-core 也在顶层裸声明同名标识符（即没被 IIFE 包裹），第二个脚本会 `SyntaxError: Identifier
//   'buildGraph' has already been declared` → analyzeGraph 永不发布 → webview 套娃/owner rollup 静默回退。
//   修法 = 把整个 graph-core 模块体裹进 IIFE（顶层零 let/const/function 泄漏）。本测试守的就是这条 IIFE 不变式。
//
// 为什么用「同一个 vm context 里两次 runInContext」而非 runInNewContext：classic `<script>` 各自是独立的
//   顶层 program，但**共享同一个 global 词法环境**——跨脚本重复声明同名 const/function 仍抛。两次
//   `runInContext` 喂同一个 ctx 忠实复现这一共享语义；`runInNewContext`（per-script 独立 realm）复现不出
//   共享，恰是上个 agent「验证翻车」的根因（文件头 IIFE 说明也点名这一陷阱）。给 ctx 备浏览器近似全局：
//   有 globalThis、module/require 缺席（模拟浏览器宿主走 UMD 的 globalThis 分支）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const MODEL_CORE = 'cli/src/board-model.js';
const LINT_CORE = 'cli/src/board-lint-core.js';
const GRAPH_CORE = 'cli/src/board-graph-core.js';

const modelSrc = read(MODEL_CORE);
const lintSrc = read(LINT_CORE);
const graphSrc = read(GRAPH_CORE);

// 造一个模拟浏览器宿主的 vm context：globalThis 存在、module/require 缺席（→ UMD 走 globalThis 分支）。
// view-server 的 serve 顺序是 lint-core 先、graph-core 后（lint 先把 __ccmBoardLintCore 挂上 global，
// graph 的 require-fallback 才读得到 buildGraph/findCycle），这里照此顺序在同一 realm 串起两个脚本。
function browserRealmWith(graphScriptSrc) {
  const ctx = vm.createContext({});
  // 浏览器宿主：无 CommonJS。显式把 module/require 钉成 undefined，让三份 UMD 尾都走 globalThis 分支。
  vm.runInContext('var module = undefined; var require = undefined;', ctx);
  // ★v2 serve 顺序：board-model.js 先（IIFE·零泄漏·挂 __ccmBoardModel），lint-core 的 require-fallback 才读得到。
  vm.runInContext(modelSrc, ctx, { filename: 'board-model.js' });
  // <script src="board-lint-core.js"> —— 顶层 function buildGraph/findCycle + const ISO_UTC_RE 进 global 词法环境。
  vm.runInContext(lintSrc, ctx, { filename: 'board-lint-core.js' });
  // <script src="board-graph-core.js"> —— 同一 global 词法环境；IIFE 包裹下顶层零泄漏，不撞名。
  vm.runInContext(graphScriptSrc, ctx, { filename: 'board-graph-core.js' });
  return ctx;
}

// 小 board 构造糖（与 board-graph-core.test.mjs 同形）。
const board = (tasks, extra = {}) => ({
  schema: 'cc-master/v2', goal: 'g', owner: { active: true, session_id: 's' },
  git: { worktree: '', branch: '' }, tasks, ...extra,
});

// ── 主断言：真实（IIFE-wrapped）两文件在共享 realm 里发布 __ccmBoardGraphCore.analyzeGraph ──────────
test('classic-script shared-realm: lint-core + graph-core publish __ccmBoardGraphCore (no redeclare SyntaxError)', () => {
  // 这一行就是回归门：若 graph-core 的 IIFE 被删/破坏，第二个 runInContext 会抛 SyntaxError，本测试直接 RED。
  const ctx = browserRealmWith(graphSrc);

  const pub = vm.runInContext('typeof globalThis.__ccmBoardGraphCore', ctx);
  assert.equal(pub, 'object', '__ccmBoardGraphCore must be published on globalThis in browser mode');
  const analyzeType = vm.runInContext(
    'globalThis.__ccmBoardGraphCore && typeof globalThis.__ccmBoardGraphCore.analyzeGraph', ctx);
  assert.equal(analyzeType, 'function', '__ccmBoardGraphCore.analyzeGraph must be a function');

  // lint-core 也按 UMD globalThis 分支挂上了（graph-core 的 buildGraph 正来自它）。
  const lintBuild = vm.runInContext(
    'globalThis.__ccmBoardLintCore && typeof globalThis.__ccmBoardLintCore.buildGraph', ctx);
  assert.equal(lintBuild, 'function', 'lint-core publishes buildGraph on globalThis (graph-core reuses it)');
});

// ── 套娃功能真能跑：把嵌套 board fixture 喂进 realm 里的 analyzeGraph，断言关键结果 ────────────────────
test('classic-script shared-realm: analyzeGraph runs a nested (owner + children) board correctly', () => {
  const ctx = browserRealmWith(graphSrc);

  // 把 fixture 注入 realm，调 realm 内的 analyzeGraph（彻底走浏览器加载路径，不复用 node require 的实例）。
  const fixture = board([
    { id: 'M1', status: 'in_flight', deps: [], kind: 'owner' },
    { id: 'M1.a', status: 'done', deps: [], parent: 'M1' },
    { id: 'M1.b', status: 'ready', deps: ['M1.a'], parent: 'M1' },
    { id: 'M2', status: 'in_flight', deps: [], kind: 'owner' },
    { id: 'M2.a', status: 'ready', deps: ['M1.b'], parent: 'M2' }, // 跨 owner 的 open dep
  ]);
  ctx.__fixture = JSON.parse(JSON.stringify(fixture)); // 纯 JSON，跨 realm 安全
  // analyzeGraph 在 vm realm 内跑，返回的 array/object 带的是该 realm 的 prototype——直接 assert.deepEqual
  // 会因跨 realm prototype 不等而假红。realm 内 JSON.stringify 成纯字符串、再在本 realm parse 回纯结构，
  // 抹平 realm 归属（这正是浏览器/worker 跨边界传图的标准做法），只比结构。
  const out = JSON.parse(vm.runInContext(`
    const g = globalThis.__ccmBoardGraphCore.analyzeGraph(__fixture);
    JSON.stringify({
      childrenM1: g.children('M1'),
      childrenM2: g.children('M2'),
      parentOfM1b: g.parentOf('M1.b'),
      rollupM1: g.rollupProgress('M1'),
      longest: g.longestPath(),
      ready: g.readySet().sort(),
      rollupConsistency: g.rollupConsistency(),
    })
  `, ctx));

  // children / parent 倒排（套娃的地基）。
  assert.deepEqual(out.childrenM1, ['M1.a', 'M1.b'], 'M1 children invert parent edges');
  assert.deepEqual(out.childrenM2, ['M2.a'], 'M2 owns M2.a');
  assert.equal(out.parentOfM1b, 'M1');
  // rollup advisory：M1 两子，1 个 done。
  assert.deepEqual(out.rollupM1, { done: 1, total: 2, ratio: 0.5 });
  // longestPath 跨 owner 边界沿 open dep：M1.a→M1.b→M2.a，3 节点。
  assert.deepEqual(out.longest, { chain: ['M1.a', 'M1.b', 'M2.a'], length: 3 });
  // readySet：只有 deps 全 done ∧ status==ready 的 M1.b。
  assert.deepEqual(out.ready, ['M1.b']);
  // owner 都 in_flight（非 done）→ 无 rollup 不一致。
  assert.deepEqual(out.rollupConsistency, []);
});

// ── 守卫断言（直指 bug 根因）：证明「没 IIFE」会 redeclare-throw、套娃静默失效 ──────────────────────
// 锁的就是「graph-core 顶层零泄漏（IIFE 包裹）」这条不变式：合成一个剥掉 IIFE 的 graph-core（即未修版本），
// 在同一共享 realm 里它必抛 Syntax(redeclare)、且 __ccmBoardGraphCore 不发布。这条让本测试在 IIFE 被删时确凿 RED——
// 它不是测「现状」，而是钉死「为什么要有 IIFE」：删了 IIFE，下面这段会变成 NO-throw，断言翻红。
test('regression guard: an un-IIFE-wrapped graph-core (the pre-fix shape) WOULD redeclare-throw in the shared realm', () => {
  // 从真实源剥掉 IIFE 包裹：开头 `(function () {\n` + 'use strict' 之后的体，结尾 `})(); // …` 注释。
  // 剥掉后顶层裸 `const { buildGraph, findCycle } = …` / `const ISO_UTC_RE` 会与 lint-core 撞名。
  const unwrapped = graphSrc
    .replace(/\(function \(\) \{\n/, '')           // 去 IIFE 头
    .replace(/\n\}\)\(\); \/\/[\s\S]*$/, '\n');     // 去 IIFE 尾 `})();` + 收口注释

  // 自证「剥皮」确实发生了（否则这条守卫会假绿）：剥掉后顶层应出现裸 const buildGraph 解构。
  assert.match(unwrapped, /^const \{ buildGraph, findCycle \} =/m,
    'sanity: unwrapped variant exposes a bare top-level `const { buildGraph, findCycle }` (no IIFE)');

  assert.throws(
    () => browserRealmWith(unwrapped),
    // 错误从 vm realm 抛出，跨 realm `instanceof SyntaxError` 为 false（不同 realm 的构造器）——按 e.name 判型。
    (e) => e && e.name === 'SyntaxError' && /buildGraph|findCycle|ISO_UTC_RE|already been declared/.test(e.message),
    'without the IIFE, the second classic <script> must throw a redeclare SyntaxError — this is exactly the bug the IIFE fixes',
  );
});
