// render.test.mjs — P5.1·ccm CLI 渲染层（人读 vs --json 双形态）契约门。
//
// render.js 只产字符串：human 默认无色（color=true 才 paint）、--json 必产合法 JSON、表格无边框 grep 可过滤。
//   本测试钉死：① json 模式 JSON.parse 必过 + 结构对；② human color=false 时零 ANSI 转义且每行含 id 可 grep；
//   ③ renderGraph 对含 criticalPath 的 analysis 输出关键数字；④ 空列表不崩；⑤ analysis 句柄/纯数据两形态都吃。
//
// 范式照搬 board-model.test.mjs：.mjs + node:test + node:assert/strict + createRequire 加载 CJS。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);

const RENDER = 'cli/src/render.js';

// ANSI 转义探测正则（任何 \x1b[…m 都算上色痕迹）。
const ANSI_RE = /\x1b\[[0-9;]*m/;

test('render.js exists in cli/src (CLI package, requirable)', () => {
  assert.ok(existsSync(join(ROOT, RENDER)), 'render.js exists in cli/src');
});

const R = require(join(ROOT, RENDER));

// 真实板（精简自 board.example.json 的形状）—— 多 status / type / executor 覆盖渲染分支。
function sampleBoard() {
  return {
    schema: 'cc-master/v2',
    goal: 'Internationalize the app to 6 locales',
    owner: { active: true, session_id: 'abc123', heartbeat: '2026-06-05T12:30:00Z' },
    git: { worktree: '/repo/.worktrees/i18n', branch: 'feat/i18n' },
    tasks: [
      { id: 'T0', status: 'done', deps: [], type: 'development', executor: 'subagent', title: 'framework scaffold', verified: true, artifact: 'commit a1b2c3', estimate: { value: 1, unit: 'h' }, started_at: '2026-06-05T11:05:00Z', finished_at: '2026-06-05T11:48:00Z' },
      { id: 'T1', status: 'in_flight', deps: ['T0'], type: 'development', executor: 'subagent', title: 'translation pass', estimate: { value: 2, unit: 'h' }, started_at: '2026-06-05T12:18:00Z' },
      { id: 'T3', status: 'ready', deps: ['T0'], type: 'doc-alignment', title: 'doc align' },
      { id: 'D1', status: 'blocked', deps: [], blocked_on: 'user', title: 'Split the PR?', decision_package: { ask_type: 'decision', question: 'One PR or two?' } },
    ],
  };
}

// 由 board-graph-core 真算一个 analysis 句柄（验证 render 吃真实句柄形态）。
function realAnalysis(board) {
  const { analyzeGraph } = require(join(ROOT, 'cli/src/board-graph-core.js'));
  return analyzeGraph(board);
}

// 解析 json render 的统一壳 → 返回 data。
function parseData(s) {
  const obj = JSON.parse(s); // 断言：必须是合法 JSON
  assert.equal(obj.ok, true, 'json 壳 ok:true');
  return obj.data;
}

// ════ renderBoardSummary ══════════════════════════════════════════════════════════════════════════
test('renderBoardSummary json: 合法 JSON + goal/owner/statusCounts/lint 结构对', () => {
  const lint = { errors: [], warnings: [{ rule: 'FMT-TIME', message: 'x' }] };
  const data = parseData(R.renderBoardSummary(sampleBoard(), { json: true, lint }));
  assert.equal(data.goal, 'Internationalize the app to 6 locales');
  assert.equal(data.owner.active, true);
  assert.equal(data.owner.session_id, 'abc123');
  assert.equal(data.taskCount, 4);
  assert.equal(data.statusCounts.done, 1);
  assert.equal(data.statusCounts.in_flight, 1);
  assert.equal(data.statusCounts.blocked, 1);
  assert.equal(data.lint.ok, true);
  assert.equal(data.lint.errors, 0);
  assert.equal(data.lint.warnings, 1);
});

test('renderBoardSummary human color=false: 无 ANSI + 含 goal/owner/计数/lint', () => {
  const lint = { errors: [], warnings: [] };
  const out = R.renderBoardSummary(sampleBoard(), { color: false, lint });
  assert.ok(!ANSI_RE.test(out), '无 ANSI 转义');
  assert.match(out, /goal/);
  assert.match(out, /session=abc123/);
  assert.match(out, /done=1/);
  assert.match(out, /lint:/);
  assert.match(out, /clean/);
});

test('renderBoardSummary human color=true: 出现 ANSI 转义', () => {
  const out = R.renderBoardSummary(sampleBoard(), { color: true, lint: { errors: [], warnings: [] } });
  assert.ok(ANSI_RE.test(out), 'color=true 应上色');
});

test('renderBoardSummary 无 lint: 标 n/a 不崩', () => {
  const out = R.renderBoardSummary(sampleBoard(), { color: false });
  assert.match(out, /lint: n\/a/);
});

// ════ renderTaskList ══════════════════════════════════════════════════════════════════════════════
test('renderTaskList json: 合法 JSON 数组 + 每元素 id/status/type/executor/title', () => {
  const data = parseData(R.renderTaskList(sampleBoard().tasks, { json: true }));
  assert.ok(Array.isArray(data));
  assert.equal(data.length, 4);
  assert.equal(data[0].id, 'T0');
  assert.equal(data[0].status, 'done');
  assert.equal(data[0].type, 'development');
  assert.equal(data[0].executor, 'subagent');
  assert.equal(data[1].id, 'T1');
});

test('renderTaskList human color=false: 无 ANSI + 每行可被 grep（含 id）', () => {
  const out = R.renderTaskList(sampleBoard().tasks, { color: false });
  assert.ok(!ANSI_RE.test(out), '无 ANSI 转义');
  const lines = out.split('\n');
  // 表头 + 4 行
  assert.equal(lines.length, 5);
  // 每个 task id 都能在某一行 grep 到（grep 可过滤）
  for (const id of ['T0', 'T1', 'T3', 'D1']) {
    assert.ok(lines.some((l) => l.includes(id)), `grep ${id} 命中`);
  }
  // 表头含列名
  assert.match(lines[0], /ID/);
  assert.match(lines[0], /STATUS/);
  assert.match(lines[0], /TITLE/);
});

test('renderTaskList human: 无边框（无 | 竖线、无 +-- 分隔）', () => {
  const out = R.renderTaskList(sampleBoard().tasks, { color: false });
  assert.ok(!out.includes('|'), '无竖线边框');
  assert.ok(!/[+][-]{2,}/.test(out), '无 +--- 边框');
});

test('renderTaskList human: 行尾无尾随空格', () => {
  const out = R.renderTaskList(sampleBoard().tasks, { color: false });
  for (const l of out.split('\n')) {
    assert.ok(!/\s$/.test(l), `行尾无空格: <${l}>`);
  }
});

test('renderTaskList color=true 时上色但去色后仍含 id（对齐不被 ANSI 撑乱）', () => {
  const out = R.renderTaskList(sampleBoard().tasks, { color: true });
  assert.ok(ANSI_RE.test(out), 'color=true 上色');
  const stripped = out.replace(/\x1b\[[0-9;]*m/g, '');
  assert.ok(stripped.includes('T0'));
});

test('renderTaskList 空列表不崩: human 提示 / json 空数组', () => {
  const human = R.renderTaskList([], { color: false });
  assert.equal(typeof human, 'string');
  assert.ok(!ANSI_RE.test(human));
  const data = parseData(R.renderTaskList([], { json: true }));
  assert.deepEqual(data, []);
});

test('renderTaskList 非数组入参不崩', () => {
  assert.doesNotThrow(() => R.renderTaskList(undefined, { color: false }));
  assert.doesNotThrow(() => R.renderTaskList(null, { json: true }));
});

// ════ renderTaskDetail ════════════════════════════════════════════════════════════════════════════
test('renderTaskDetail json: 整 task 原样（裹壳）', () => {
  const t = sampleBoard().tasks[0];
  const data = parseData(R.renderTaskDetail(t, { json: true }));
  assert.equal(data.id, 'T0');
  assert.equal(data.verified, true);
  assert.equal(data.artifact, 'commit a1b2c3');
});

test('renderTaskDetail human color=false: 无 ANSI + 含 id/status/deps/references', () => {
  const t = sampleBoard().tasks[0];
  t.references = [{ kind: 'spec', ref: '/repo/docs/spec.md' }];
  const out = R.renderTaskDetail(t, { color: false });
  assert.ok(!ANSI_RE.test(out));
  assert.match(out, /id: T0/);
  assert.match(out, /status: done/);
  assert.match(out, /spec:\/repo\/docs\/spec\.md/);
});

test('renderTaskDetail 缺省字段跳过（无 description 行）', () => {
  const t = { id: 'X', status: 'ready', deps: [] };
  const out = R.renderTaskDetail(t, { color: false });
  assert.ok(!/description:/.test(out), '无 description 不渲染该行');
  assert.match(out, /id: X/);
});

test('renderTaskDetail null/缺 task 不崩', () => {
  assert.doesNotThrow(() => R.renderTaskDetail(null, { color: false }));
  const data = parseData(R.renderTaskDetail(null, { json: true }));
  assert.equal(data, null);
});

test('renderTaskDetail decision_package 渲染问题', () => {
  const d1 = sampleBoard().tasks[3];
  const out = R.renderTaskDetail(d1, { color: false });
  assert.match(out, /One PR or two\?/);
});

// ════ renderGraph ═════════════════════════════════════════════════════════════════════════════════
test('renderGraph human: 真实 analysis 句柄 → 输出 topo/ready/critical/makespan/weight_source 关键数字', () => {
  const a = realAnalysis(sampleBoard());
  const out = R.renderGraph(a, { color: false });
  assert.ok(!ANSI_RE.test(out));
  assert.match(out, /topo order/);
  assert.match(out, /critical path/);
  assert.match(out, /weight_source/);
  // T0 在临界路径上（它是其它任务的依赖根）
  assert.ok(out.includes('T0'));
});

test('renderGraph json: 合法 JSON + criticalPath{chain,makespan,weight_source} + topoOrder', () => {
  const a = realAnalysis(sampleBoard());
  const data = parseData(R.renderGraph(a, { json: true }));
  assert.ok(Array.isArray(data.topoOrder));
  assert.ok(Array.isArray(data.criticalPath.chain));
  assert.ok('makespan' in data.criticalPath);
  assert.ok('weight_source' in data.criticalPath);
  assert.ok(data.topoOrder.includes('T0'));
});

test('renderGraph 吃 plain data 形态（非句柄）也对', () => {
  const plain = {
    topoSort: { order: ['A', 'B', 'C'], cycle: null },
    readySet: ['A'],
    criticalPath: { chain: ['A', 'B', 'C'], makespan: 6, weight_source: 'estimate' },
    parallelism: { T1: 3, Tinf: 3, parallelism: 1 },
  };
  const out = R.renderGraph(plain, { color: false });
  assert.match(out, /A -> B -> C/);
  assert.match(out, /makespan: 6h/);
  assert.match(out, /weight_source: estimate/);
  const data = parseData(R.renderGraph(plain, { json: true }));
  assert.deepEqual(data.criticalPath.chain, ['A', 'B', 'C']);
  assert.equal(data.criticalPath.makespan, 6);
});

test('renderGraph 含环: human 标 CYCLE / json cycle 非 null', () => {
  const plain = {
    topoSort: { order: [], cycle: ['A', 'B', 'A'] },
    readySet: [],
    criticalPath: { chain: [], makespan: null, weight_source: 'cycle' },
  };
  const out = R.renderGraph(plain, { color: false });
  assert.match(out, /CYCLE/);
  const data = parseData(R.renderGraph(plain, { json: true }));
  assert.deepEqual(data.cycle, ['A', 'B', 'A']);
});

test('renderGraph 空 analysis 不崩', () => {
  assert.doesNotThrow(() => R.renderGraph(undefined, { color: false }));
  assert.doesNotThrow(() => R.renderGraph({}, { json: true }));
  const data = parseData(R.renderGraph({}, { json: true }));
  assert.deepEqual(data.topoOrder, []);
});

// ════ renderCriticalPath ══════════════════════════════════════════════════════════════════════════
test('renderCriticalPath json: chain + makespan + weight_source', () => {
  const a = realAnalysis(sampleBoard());
  const data = parseData(R.renderCriticalPath(a, { json: true }));
  assert.ok(Array.isArray(data.chain));
  assert.ok('makespan' in data);
  assert.ok('weight_source' in data);
});

test('renderCriticalPath human: makespan=null 时报「不报伪精确」而非数字', () => {
  const plain = { criticalPath: { chain: ['A', 'B'], makespan: null, weight_source: 'mixed' } };
  const out = R.renderCriticalPath(plain, { color: false });
  assert.ok(!ANSI_RE.test(out));
  assert.match(out, /makespan: n\/a/);
  assert.match(out, /weight_source: mixed/);
});

test('renderCriticalPath human: 纯估点报小时级 makespan', () => {
  const plain = { criticalPath: { chain: ['A', 'B'], makespan: 5, weight_source: 'estimate' } };
  const out = R.renderCriticalPath(plain, { color: false });
  assert.match(out, /makespan: 5h/);
});

test('renderCriticalPath 含环: 标不可算', () => {
  const plain = { criticalPath: { chain: [], makespan: null, weight_source: 'cycle', cycle: ['A', 'B', 'A'] } };
  const out = R.renderCriticalPath(plain, { color: false });
  assert.match(out, /环|cycle/i);
});

// ════ renderNext ══════════════════════════════════════════════════════════════════════════════════
test('renderNext json: id 字符串数组', () => {
  const data = parseData(R.renderNext(['T3', 'F1'], { json: true }));
  assert.deepEqual(data, ['T3', 'F1']);
});

test('renderNext json: task 对象数组 → id/status/... 子集', () => {
  const tasks = [{ id: 'T3', status: 'ready', type: 'doc-alignment', title: 'doc' }];
  const data = parseData(R.renderNext(tasks, { json: true }));
  assert.equal(data[0].id, 'T3');
  assert.equal(data[0].status, 'ready');
});

test('renderNext human: id 列表每行含 id 可 grep', () => {
  const out = R.renderNext(['T3', 'F1'], { color: false });
  assert.ok(!ANSI_RE.test(out));
  const lines = out.split('\n');
  assert.ok(lines.some((l) => l.includes('T3')));
  assert.ok(lines.some((l) => l.includes('F1')));
});

test('renderNext human: task 对象数组 → 复用表格（含 id）', () => {
  const tasks = [{ id: 'T3', status: 'ready', type: 'doc-alignment', title: 'doc' }];
  const out = R.renderNext(tasks, { color: false });
  assert.ok(out.includes('T3'));
  assert.match(out, /STATUS/); // 表头存在 = 走了表格
});

test('renderNext 空列表不崩', () => {
  assert.doesNotThrow(() => R.renderNext([], { color: false }));
  const data = parseData(R.renderNext([], { json: true }));
  assert.deepEqual(data, []);
});

// ════ renderLintReport ════════════════════════════════════════════════════════════════════════════
test('renderLintReport json: {ok, violations:[{rule,level,task?,message}]}', () => {
  const lint = {
    errors: [{ rule: 'FMT-ID', message: 'task.id 非空', task: 'X' }],
    warnings: [{ rule: 'FMT-TIME', message: '时间非 ISO' }],
  };
  const data = parseData(R.renderLintReport(lint, { json: true }));
  assert.equal(data.ok, false);
  assert.equal(data.violations.length, 2);
  const hard = data.violations.find((v) => v.level === 'hard');
  assert.equal(hard.rule, 'FMT-ID');
  assert.equal(hard.task, 'X');
  const warn = data.violations.find((v) => v.level === 'warn');
  assert.equal(warn.rule, 'FMT-TIME');
  assert.ok(!('task' in warn), 'warn 无 task 时不带该键');
});

test('renderLintReport json clean: ok:true + 空 violations', () => {
  const data = parseData(R.renderLintReport({ errors: [], warnings: [] }, { json: true }));
  assert.equal(data.ok, true);
  assert.deepEqual(data.violations, []);
});

test('renderLintReport human: 对齐 formatReport 风格（FAIL header + [hard]/[warn] 行）', () => {
  const lint = {
    errors: [{ rule: 'FMT-ID', message: 'task.id 非空', task: 'X' }],
    warnings: [{ rule: 'FMT-TIME', message: '时间非 ISO' }],
  };
  const out = R.renderLintReport(lint, { color: false });
  assert.ok(!ANSI_RE.test(out));
  assert.match(out, /FAIL/);
  assert.match(out, /\[hard\] FMT-ID/);
  assert.match(out, /\[warn\] FMT-TIME/);
});

test('renderLintReport human clean: PASS', () => {
  const out = R.renderLintReport({ errors: [], warnings: [] }, { color: false });
  assert.match(out, /PASS/);
});

test('renderLintReport human PASS-with-warnings: PASS header + warn 行', () => {
  const out = R.renderLintReport({ errors: [], warnings: [{ rule: 'FMT-TIME', message: 'x' }] }, { color: false });
  assert.match(out, /PASS/);
  assert.match(out, /\[warn\] FMT-TIME/);
});

test('renderLintReport 空/坏入参不崩', () => {
  assert.doesNotThrow(() => R.renderLintReport(undefined, { color: false }));
  const data = parseData(R.renderLintReport(undefined, { json: true }));
  assert.equal(data.ok, true);
});

// ════ renderTable（复用工具）═════════════════════════════════════════════════════════════════════
test('renderTable: 对齐 + 无边框 + 行尾无空格', () => {
  const out = R.renderTable(['A', 'BB'], [['x', 'yyyy'], ['zzz', 'w']], { color: false });
  const lines = out.split('\n');
  assert.equal(lines.length, 3);
  assert.ok(!out.includes('|'));
  for (const l of lines) assert.ok(!/\s$/.test(l));
});

// ════ paint（导出工具）═══════════════════════════════════════════════════════════════════════════
test('paint enabled=false 原样返回（无色）', () => {
  const s = R.paint('hello', 'red', false);
  assert.equal(s, 'hello');
  assert.ok(!ANSI_RE.test(s));
});
