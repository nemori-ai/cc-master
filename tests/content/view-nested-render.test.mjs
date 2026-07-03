// view-nested-render.test.mjs — webview nested-DAG 折叠/选中渲染的回归门（真浏览器 dogfood 浮现的两个 bug）。
//
// 背景：headless browser 在本仓不可用（无 playwright/puppeteer），render/DOM 层逻辑测不了。
//   两个 bug 的真根因分布在两层，本测试按「能测的钉死、测不到的不假装」分治：
//
//   bug②（折叠 owner 时 owner 自己也消失）：
//     · 数据层（可测）—— 折叠一个 owner 后它必须仍在「可见集」且分配到一个有效位置（非缺失、非 {0,0}）。
//       这一层用真 graph-core + 复刻 buildGraph 的 visible-set/reroute 逻辑断言（本测试 A 组）。
//     · 渲染层（真根因，DOM 测不了）—— 折叠走 fresh re-layout，render 旧实现把 `fresh` 当 firstLayout 传给
//       buildGraph → 每个 tile 重放 `enter` 入场动画（@keyframes nodein from{opacity:0}）+ stagger delay，
//       owner（高 stagger 下标）会按住 opacity:0 约 0.7s，视觉上「消失」。修法 = 把 entrance 一次性化
//       （firstPaintRef），re-layout 不再重放入场。这一层在真 headless Chrome（CDP）里验过；这里用
//       **view.html 源码断言**把修法钉死（B 组）：render 不得再把 `fresh` 直接当 firstLayout 传。
//
//   feat①（点 owner 高亮其 child）：
//     · 计算层（可测）—— 选中一个 owner，高亮集必须含其全部 child（复刻 lineage 计算，C 组）。
//     · 接线（源码断言）—— view.html 把 owner 的 childrenOf 接进 kidSet → lineage='child'、CSS lin-child
//       不被 has-selection 调暗（D 组）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// ★T4-3a: the webview's shared graph core is now the @ccm/engine IIFE, vendored alongside the
//   skill (replacing the old cli/src/ board-model + board-lint-core + board-graph-core trio). The
//   viewer loads it as ONE classic <script> publishing globalThis.__ccmEngine. This test loads the
//   SAME vendored artifact (not cli/src/) so it asserts against the migrated reality.
const ENGINE_IIFE = 'plugin/src/skills/master-orchestrator-guide/canonical/scripts/vendor/ccm-engine.iife.js';
const VIEW = 'plugin/src/skills/master-orchestrator-guide/canonical/scripts/view.html';

// 在一个裸 realm 里加载 vendored @ccm/engine IIFE（模拟浏览器 classic <script>：无 require → banner
// 把 node:fs/crypto 退化成 {}，webview 路径从不触碰 board-lock），拿到 __ccmEngine.analyzeGraph ——
// 这是 view.html 的 analyze() 实际委托的同一份图核心（DRY）。
function loadGraphCore() {
  const ctx = vm.createContext({});
  // 浏览器里 globalThis === window，顶层 var 挂成全局；裸 realm 里给个 globalThis 自引用同形。
  vm.runInContext('var globalThis = this;', ctx);
  vm.runInContext(read(ENGINE_IIFE), ctx, { filename: 'ccm-engine.iife.js' });
  const core = vm.runInContext('(typeof __ccmEngine !== "undefined") ? __ccmEngine : (globalThis.__ccmEngine || null)', ctx);
  assert.ok(core && typeof core.analyzeGraph === 'function', '@ccm/engine IIFE published __ccmEngine.analyzeGraph');
  return core;
}

// 一个复杂嵌套 board（6 owner·每个带数子·跨组依赖）——压测折叠/选中的可见集与高亮集。
function nestedBoard() {
  const t = [];
  // 根链
  t.push({ id: 'T0', status: 'done', deps: [] });
  t.push({ id: 'T1', status: 'done', deps: ['T0'] });
  // M1 owner + 子（M1.a..c）
  t.push({ id: 'M1', status: 'in_flight', deps: ['T1'] });
  t.push({ id: 'M1.a', status: 'done', deps: ['T1'], parent: 'M1' });
  t.push({ id: 'M1.b', status: 'done', deps: ['M1.a'], parent: 'M1' });
  t.push({ id: 'M1.c', status: 'in_flight', deps: ['M1.a'], parent: 'M1' });
  // M2 owner + 子（M2.a..b）—— M2 依赖 M1（跨组）
  t.push({ id: 'M2', status: 'blocked', deps: ['M1'] });
  t.push({ id: 'M2.a', status: 'ready', deps: ['M1.c'], parent: 'M2' });   // 跨组 dep: 子→别组的子
  t.push({ id: 'M2.b', status: 'blocked', deps: ['M2.a'], parent: 'M2' });
  // 终点
  t.push({ id: 'TEND', status: 'blocked', deps: ['M2', 'M1'] });
  return { schema: 'cc-master/v2', goal: 'g', owner: { active: true, session_id: 's' },
    git: { worktree: '', branch: '' }, tasks: t };
}

// ── 复刻 view.html buildGraph 的纯逻辑（visible-set + reroute + lineage）——————————————————————
// 这不是另起一份真相：它逐字镜像 view.html 里 buildGraph 的对应片段，专为断言「折叠后 owner 可见 +
// 位置有效」「选中 owner → 子节点入高亮集」这两条不变式。view.html 改了对应逻辑、这里同步改（与
// board-graph-core.browser.test.mjs 守 IIFE 不变式同一性质：把一条易回归的细节钉成红线）。
function deriveOwners(tasks) {
  const ids = new Set(tasks.map((x) => x.id));
  const owners = new Set();
  for (const x of tasks) {
    const p = (typeof x.parent === 'string' && x.parent !== '') ? x.parent : null;
    if (p && ids.has(p)) owners.add(p);
  }
  return owners;
}

// 折叠后的可见集 + edgePairs（镜像 buildGraph 2592-2620）。
function visibleSetFor(tasks, an, owners, collapsedSet) {
  const parentOf = (id) => an.parentOf(id);
  const hidden = new Set();
  for (const x of tasks) {
    const par = parentOf(x.id);
    if (par && collapsedSet.has(par) && owners.has(par)) hidden.add(x.id);
  }
  const reroute = (id) => {
    if (!hidden.has(id)) return id;
    const par = parentOf(id);
    return (par && !hidden.has(par)) ? par : id; // owner 是 depth-1，永远可见
  };
  const visibleTasks = tasks.filter((x) => !hidden.has(x.id));
  const visibleIds = new Set(visibleTasks.map((x) => x.id));
  const pairSeen = new Set();
  const edgePairs = [];
  for (const x of tasks) {
    for (const d of (x.deps || [])) {
      if (!visibleIds.has(d) && !hidden.has(d)) continue;
      const s = reroute(d), tg = reroute(x.id);
      if (s === tg || !visibleIds.has(s) || !visibleIds.has(tg)) continue;
      const key = s + ' ' + tg;
      if (pairSeen.has(key)) continue;
      pairSeen.add(key);
      edgePairs.push([s, tg]);
    }
  }
  return { hidden, visibleTasks, visibleIds, edgePairs };
}

// 极简确定性布局桩：忠实复刻 buildGraph 对 layout 返回值的「契约」——为 layout(visibleTasks,…) 喂进去
// 的每个可见节点产出一个位置。真实现是 dagre（vm 里加载 dagre 不合算且与本断言无关：我们要验的是
// 「owner 是否进了被布局的集合并拿到位置」，不是 dagre 的具体坐标）。这里给每个可见节点一个唯一非
// {0,0} 坐标（i 从 1 起），精确复现 layout 的「为传入的每个节点产出位置」契约。
function layoutContract(visibleTasks) {
  const pos = new Map();
  visibleTasks.forEach((x, i) => pos.set(x.id, { x: (i + 1) * 200, y: (i + 1) * 92 }));
  return pos;
}

// 选中 owner 时的高亮集（镜像 buildGraph 2624-2643 的 kidSet 分支）。
function lineageFor(an, owners, sel) {
  const ancSet = an.ancestors(sel);
  const descSet = an.descendants(sel);
  const kidSet = owners.has(sel) ? new Set(an.childrenOf ? an.childrenOf(sel) : an.children(sel)) : null;
  return { ancSet, descSet, kidSet };
}

const core = loadGraphCore();
// view.html analyze() 暴露的 childrenOf 即 core.children；这里给个统一别名供镜像逻辑用。
function makeAn(board) {
  const G = core.analyzeGraph({ tasks: board.tasks, owner: board.owner });
  return {
    ancestors: (id) => G.ancestors(id),
    descendants: (id) => G.descendants(id),
    parentOf: (id) => G.parentOf(id),
    childrenOf: (id) => G.children(id),
    byId: new Map(board.tasks.map((t) => [t.id, t])),
  };
}

// ════════════════════════════════════ A 组：bug② 数据层 ════════════════════════════════════
test('A1 — 折叠一个 owner：owner 自己仍在可见集（不进 hidden）', () => {
  const b = nestedBoard();
  const an = makeAn(b);
  const owners = deriveOwners(b.tasks);
  assert.ok(owners.has('M1'), 'M1 被识别为 owner');
  const { hidden, visibleIds } = visibleSetFor(b.tasks, an, owners, new Set(['M1']));
  assert.equal(hidden.has('M1'), false, '被折叠的 owner M1 绝不进 hidden 集');
  assert.equal(visibleIds.has('M1'), true, '折叠后 owner M1 仍在可见集（代表整组留下）');
  // 它的子全部被藏
  for (const c of ['M1.a', 'M1.b', 'M1.c']) assert.equal(hidden.has(c), true, c + ' 被折叠后隐去');
});

test('A2 — 折叠后被布局的可见集含 owner，且 owner 拿到有效位置（非缺失、非 {0,0}）', () => {
  const b = nestedBoard();
  const an = makeAn(b);
  const owners = deriveOwners(b.tasks);
  const { visibleTasks } = visibleSetFor(b.tasks, an, owners, new Set(['M1']));
  assert.ok(visibleTasks.some((t) => t.id === 'M1'), '折叠后 M1 进入被布局的 visibleTasks（→ dagre 会给它位置）');
  const pos = layoutContract(visibleTasks);
  const m1 = pos.get('M1');
  assert.ok(m1, 'owner M1 在 layout 输出里有位置（非缺失）');
  assert.ok(!(m1.x === 0 && m1.y === 0), 'owner M1 的位置非 {0,0}（不退化到原点 = 不掉位）');
});

test('A3 — 折叠两个 owner：两个 owner 都留在可见集 + 都拿到位置', () => {
  const b = nestedBoard();
  const an = makeAn(b);
  const owners = deriveOwners(b.tasks);
  const { visibleTasks, visibleIds } = visibleSetFor(b.tasks, an, owners, new Set(['M1', 'M2']));
  for (const o of ['M1', 'M2']) assert.equal(visibleIds.has(o), true, o + ' 折叠后仍可见');
  const pos = layoutContract(visibleTasks);
  for (const o of ['M1', 'M2']) {
    const p = pos.get(o);
    assert.ok(p && !(p.x === 0 && p.y === 0), o + ' 拿到有效非原点位置');
  }
});

// ════════════════════════════════════ B 组：bug② 渲染层修法的源码门 ════════════════════════════════════
test('B1 — view.html: entrance(`enter`) 已与 re-layout(`fresh`) 解耦（render 不再把 fresh 当 firstLayout）', () => {
  const src = read(VIEW);
  // 修法的核心：引入一次性 firstPaint 标志，且不把 `fresh` 直接作为 firstLayout 传给 buildGraph。
  assert.match(src, /firstPaintRef/, 'render 用一次性 firstPaintRef 驱动 entrance');
  // 旧 bug 形态的精确反模式：buildGraph(..., fresh ? null : posRef.current, fresh, ...) —— 第 5 个实参
  // （firstLayout）直接是 `fresh`。修后第 5 个实参应是 entrance/firstPaint，绝不再是裸 `fresh`。
  assert.doesNotMatch(
    src,
    /buildGraph\([^;]*?,\s*fresh\s*\?\s*null\s*:\s*posRef\.current,\s*fresh\s*,/,
    'render 不得再把 `fresh` 直接当 firstLayout 传给 buildGraph（那会让折叠重放入场动画 → owner 闪没·bug②）',
  );
});

// ════════════════════════════════════ C 组：feat① 高亮集计算层 ════════════════════════════════════
test('C1 — 选中一个 owner：高亮集（kidSet）含其全部 child', () => {
  const b = nestedBoard();
  const an = makeAn(b);
  const owners = deriveOwners(b.tasks);
  const { kidSet } = lineageFor(an, owners, 'M1');
  assert.ok(kidSet, '选中 owner 时 kidSet 被填充（非 null）');
  for (const c of ['M1.a', 'M1.b', 'M1.c']) {
    assert.equal(kidSet.has(c), true, '高亮集含 M1 的子 ' + c);
  }
  assert.equal(kidSet.has('M2.a'), false, '别组的子 M2.a 不进 M1 的 kidSet');
});

test('C2 — 选中一个 leaf（非 owner）：kidSet 为 null（无组高亮，行为不变）', () => {
  const b = nestedBoard();
  const an = makeAn(b);
  const owners = deriveOwners(b.tasks);
  const { kidSet } = lineageFor(an, owners, 'M1.a'); // M1.a 是子，不是 owner
  assert.equal(kidSet, null, '选 leaf 不产生 group 高亮（kidSet=null）');
});

test('C3 — 高亮分类优先级：dep 链上的祖先保持 anc，不被 child 覆盖', () => {
  // M1 是 M2 的 dep-祖先（M2.deps=['M1']）。选中 M2（owner）时：M2.a/M2.b 应 lin-child；
  // 而 M1（M2 的 dep 祖先且是别的 owner）应保持 anc，不被误判进 M2 的 kidSet。
  const b = nestedBoard();
  const an = makeAn(b);
  const owners = deriveOwners(b.tasks);
  const { ancSet, kidSet } = lineageFor(an, owners, 'M2');
  assert.equal(ancSet.has('M1'), true, 'M1 是 M2 的 dep 祖先');
  assert.equal(kidSet.has('M1'), false, 'M1 不在 M2 的 kidSet（它不是 M2 的 child）');
  for (const c of ['M2.a', 'M2.b']) assert.equal(kidSet.has(c), true, c + ' 在 M2 的 kidSet');
});

// ════════════════════════════════════ D 组：feat① 接线的源码门 ════════════════════════════════════
test('D1 — view.html: owner 的 childrenOf 接进 kidSet → lineage="child"', () => {
  const src = read(VIEW);
  assert.match(src, /kidSet\s*=\s*new Set\(\s*an\.childrenOf\(sel\)\s*\)/, 'owner 选中时 kidSet 由 childrenOf(sel) 构成');
  assert.match(src, /owners\.has\(sel\)/, 'kidSet 只在 sel 为 owner 时填充');
  assert.match(src, /kidSet\s*&&\s*kidSet\.has\(t\.id\)\)\s*lineage\s*=\s*['"]child['"]/, '命中 kidSet 的 child 被标 lineage="child"');
});

test('D2 — view.html: lin-child 不被 has-selection 调暗 + 有专属高亮样式', () => {
  const src = read(VIEW);
  // dim 规则把 lin-child 排除在调暗之外
  assert.match(src, /\.has-selection[^{]*:not\(\.lin-child\)\s*\{/, 'has-selection 调暗规则用 :not(.lin-child) 放过组成员');
  // 有 .cc-node.lin-child 专属样式块
  assert.match(src, /\.cc-node\.lin-child\s*\{/, '存在 .cc-node.lin-child 专属高亮样式');
});
