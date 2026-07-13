// board-lint-core.test.ts — @ccm/engine·board v2 共享 lint 核心契约门（派生自 board-model）。
//   T1 port：从 cli/test/unit/board-lint-core.test.mjs 移植，CJS createRequire 加载改为对 ported TS 源的 ESM import。
//   原前 3 个「源文件存在 + hook/manual 都 wire 到同一份 + lint-core require board-model」的布局/接线断言
//   测的是旧 cli/src + hooks/ 仓库形态，对 ported @ccm/engine 不再适用——已删；DRY/单一真相源在 TS 引擎里
//   由 board-graph-core import board-lint-core 的静态依赖图天然保证（board-graph-core.test.ts 仍间接覆盖）。
//   行为断言（lintBoard 全集规则 + 级别 SSOT 一致）逐条保留。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
// 测 build 后的 dist 公开 API barrel（见 board-model.test.ts 注：源 NodeNext `.js` specifier 直跑解析不了）。
//   lintBoard / levelOf 都从 @ccm/engine 的统一面取——这正是下游消费方拿到的接口。
import { levelOf, lintBoard } from '../dist/index.mjs';

const model = { levelOf };
const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTED_TASK = JSON.parse(
  readFileSync(join(HERE, 'fixtures', 'cross-harness-routing', 'same-harness-cli.json'), 'utf8'),
).task;
const ROUTING_CONTRACTS = {
  task_planning: 'ccm/task-planning/v1',
  agent_routing: 'ccm/agent-routing/v1',
  agent_routing_activated_at: '2026-07-10T08:00:00Z',
  agent_routing_grandfathered_terminal: [],
};

const ruleSet = (arr: { rule: string }[]) => new Set(arr.map((v) => v.rule));
const has = (r: { errors: { rule: string }[]; warnings: { rule: string }[] }, rule: string) =>
  ruleSet(r.errors).has(rule) || ruleSet(r.warnings).has(rule);

// GOOD：一块真正干净的 v2 板（零 error 零 warning）。done 任务带 started/finished（满足 BIZ-TIME-ORDER）。
const GOOD = {
  schema: 'cc-master/v2',
  meta: { template_version: 3 },
  goal: 'g',
  owner: { active: true, session_id: 's' },
  git: { worktree: '/w', branch: 'b' },
  tasks: [
    {
      id: 'T0',
      status: 'done',
      deps: [],
      verified: true,
      artifact: '/abs/t0.md',
      started_at: '2026-06-23T10:00:00Z',
      finished_at: '2026-06-23T11:00:00Z',
    },
    { id: 'T1', status: 'ready', deps: ['T0'] },
  ],
};
const J = (o: unknown) => JSON.stringify(o);
// 在 GOOD 基础上换/加一个 task 做夹具。
const withTask = (t: unknown) => J({ ...GOOD, tasks: [...GOOD.tasks, t] });
const onlyTask = (t: unknown, extra: Record<string, unknown> = {}) =>
  J({ ...GOOD, ...extra, tasks: [t] });

test('lintBoard exports a pure function returning {errors,warnings}', () => {
  const r = lintBoard(J(GOOD));
  assert.ok(Array.isArray(r.errors) && Array.isArray(r.warnings));
});

test('good v2 board → zero errors, zero warnings', () => {
  const r = lintBoard(J(GOOD));
  assert.equal(r.errors.length, 0, J(r.errors));
  assert.equal(r.warnings.length, 0, J(r.warnings));
});

// ── 级别 SSOT 证明：每条规则落到 errors/warnings 的桶，与 board-model.levelOf 一致 ────────────────────
test('rule levels are sourced from board-model (errors⇔hard, warnings⇔warn)', () => {
  // FMT-SCHEMA 是 hard（model）→ 落 errors。
  const rSchema = lintBoard(J({ ...GOOD, schema: 'cc-master/v1' }));
  assert.equal(model.levelOf('FMT-SCHEMA'), 'hard');
  assert.ok(ruleSet(rSchema.errors).has('FMT-SCHEMA'), 'hard rule → errors bucket');
  // GRAPH-ROLLUP 是 warn（model）→ 落 warnings。
  const rRollup = lintBoard(
    J({
      ...GOOD,
      tasks: [
        { id: 'M', status: 'done', deps: [], verified: true, artifact: '/abs/m.md' },
        { id: 'c', status: 'ready', deps: [], parent: 'M' },
      ],
    }),
  );
  assert.equal(model.levelOf('GRAPH-ROLLUP'), 'warn');
  assert.ok(ruleSet(rRollup.warnings).has('GRAPH-ROLLUP'), 'warn rule → warnings bucket');
});

// ── FMT 板级 ─────────────────────────────────────────────────────────────────────────────────────
test('FMT-JSON: invalid JSON + non-object top-level are hard errors (no throw)', () => {
  assert.ok(ruleSet(lintBoard('{"schema":"cc-master/v2","tasks":[{').errors).has('FMT-JSON'));
  assert.ok(ruleSet(lintBoard('[1,2,3]').errors).has('FMT-JSON'));
});

test('FMT-SCHEMA: must be the v2 literal (v1 now fails)', () => {
  assert.ok(ruleSet(lintBoard(J({ ...GOOD, schema: 'cc-master/v1' })).errors).has('FMT-SCHEMA'));
  assert.ok(ruleSet(lintBoard(J({ ...GOOD, schema: 9 })).errors).has('FMT-SCHEMA'));
});

test('FMT-GOAL / FMT-OWNER / FMT-GIT / FMT-TASKS pinned-waist type errors', () => {
  assert.ok(ruleSet(lintBoard(J({ ...GOOD, goal: 9 })).errors).has('FMT-GOAL'));
  assert.ok(
    ruleSet(lintBoard(J({ ...GOOD, owner: { active: 'yes', session_id: 's' } })).errors).has(
      'FMT-OWNER',
    ),
  );
  assert.ok(
    ruleSet(lintBoard(J({ ...GOOD, owner: { active: true, session_id: 9 } })).errors).has(
      'FMT-OWNER',
    ),
  );
  assert.ok(ruleSet(lintBoard(J({ ...GOOD, git: 9 })).errors).has('FMT-GIT'));
  assert.ok(ruleSet(lintBoard(J({ ...GOOD, tasks: 9 })).errors).has('FMT-TASKS'));
});

test('owner.session_id "" is LEGAL (fresh-bootstrap 待认领板)', () => {
  const r = lintBoard(J({ ...GOOD, owner: { active: true, session_id: '' } }));
  assert.ok(!ruleSet(r.errors).has('FMT-OWNER'), J(r.errors));
});

test('owner.heartbeat non-ISO → FMT-TIME warn (v2 补漏·v1 不查)', () => {
  const r = lintBoard(
    J({ ...GOOD, owner: { active: true, session_id: 's', heartbeat: '12:00Z' } }),
  );
  assert.ok(ruleSet(r.warnings).has('FMT-TIME'));
});

// ── FMT 每-task 钉死契约 ───────────────────────────────────────────────────────────────────────────
test('FMT-ID / FMT-ID-UNIQUE / FMT-STATUS / FMT-DEPS', () => {
  assert.ok(
    ruleSet(lintBoard(withTask({ id: '', status: 'ready', deps: [] })).errors).has('FMT-ID'),
  );
  assert.ok(
    ruleSet(lintBoard(withTask({ id: 'T0', status: 'ready', deps: [] })).errors).has(
      'FMT-ID-UNIQUE',
    ),
  ); // T0 重复
  assert.ok(
    ruleSet(lintBoard(withTask({ id: 'X', status: 'bogus', deps: [] })).errors).has('FMT-STATUS'),
  );
  assert.ok(ruleSet(lintBoard(withTask({ id: 'X', status: 'ready' })).errors).has('FMT-DEPS')); // 缺 deps
  assert.ok(
    ruleSet(lintBoard(withTask({ id: 'X', status: 'ready', deps: 'no' })).errors).has('FMT-DEPS'),
  );
});

// ── GRAPH ──────────────────────────────────────────────────────────────────────────────────────────
test('GRAPH-DANGLING / GRAPH-SELFLOOP / GRAPH-CYCLE', () => {
  assert.ok(
    ruleSet(lintBoard(onlyTask({ id: 'T', status: 'ready', deps: ['GONE'] })).errors).has(
      'GRAPH-DANGLING',
    ),
  );
  assert.ok(
    ruleSet(lintBoard(onlyTask({ id: 'S', status: 'ready', deps: ['S'] })).errors).has(
      'GRAPH-SELFLOOP',
    ),
  );
  const cyc = lintBoard(
    J({
      ...GOOD,
      tasks: [
        { id: 'A', status: 'ready', deps: ['B'] },
        { id: 'B', status: 'ready', deps: ['A'] },
      ],
    }),
  );
  assert.ok(ruleSet(cyc.errors).has('GRAPH-CYCLE'));
});

test('GRAPH-PARENT-EXISTS / DEPTH / CYCLE (hard) + GRAPH-ROLLUP (warn)', () => {
  assert.ok(
    ruleSet(
      lintBoard(onlyTask({ id: 'o', status: 'ready', deps: [], parent: 'GHOST' })).errors,
    ).has('GRAPH-PARENT-EXISTS'),
  );
  // depth>1：grand 的 parent=child，child 的 parent=M → child 既是子又是 parent。
  const depth = lintBoard(
    J({
      ...GOOD,
      tasks: [
        { id: 'M', status: 'ready', deps: [] },
        { id: 'child', status: 'ready', deps: [], parent: 'M' },
        { id: 'grand', status: 'ready', deps: [], parent: 'child' },
      ],
    }),
  );
  assert.ok(ruleSet(depth.errors).has('GRAPH-PARENT-DEPTH'));
  // parent self-loop。
  assert.ok(
    ruleSet(lintBoard(onlyTask({ id: 'A', status: 'ready', deps: [], parent: 'A' })).errors).has(
      'GRAPH-PARENT-CYCLE',
    ),
  );
  // rollup warn：done owner 有非 done 子。
  const roll = lintBoard(
    J({
      ...GOOD,
      tasks: [
        { id: 'M', status: 'done', deps: [], verified: true, artifact: '/abs/m.md' },
        { id: 'c', status: 'ready', deps: [], parent: 'M' },
      ],
    }),
  );
  assert.ok(ruleSet(roll.warnings).has('GRAPH-ROLLUP'));
});

test('GRAPH-CONNECTED (warn): 弱连通分量 > 1 → warn 且列出孤岛分组', () => {
  // ① 全连通图（A←B←C 链 + 主图）→ 无 GRAPH-CONNECTED warn。
  const connected = lintBoard(
    J({
      ...GOOD,
      tasks: [
        { id: 'A', status: 'ready', deps: [] },
        { id: 'B', status: 'ready', deps: ['A'] },
        { id: 'C', status: 'ready', deps: ['B'] },
      ],
    }),
  );
  assert.ok(!ruleSet(connected.warnings).has('GRAPH-CONNECTED'), J(connected.warnings));
  assert.equal(model.levelOf('GRAPH-CONNECTED'), 'warn');

  // ② 两个孤岛：{A→B} 一组、孤立 T8 一组 → warn，且消息含两分量的 task-id（A,B 与 T8）。
  const split = lintBoard(
    J({
      ...GOOD,
      tasks: [
        { id: 'A', status: 'ready', deps: [] },
        { id: 'B', status: 'ready', deps: ['A'] },
        { id: 'T8', status: 'ready', deps: [] },
      ],
    }),
  );
  const w = split.warnings.find((x) => x.rule === 'GRAPH-CONNECTED');
  assert.ok(w, 'GRAPH-CONNECTED 应落 warnings 桶');
  assert.ok(ruleSet(split.warnings).has('GRAPH-CONNECTED'));
  assert.match((w as { message: string }).message, /A, B/); // 主图（最大分量）
  assert.match((w as { message: string }).message, /T8/); // 孤岛
  assert.match((w as { message: string }).message, /2 个互不相连/); // 分量数

  // ③ 单任务 → 不 warn（1 分量）。
  const single = lintBoard(onlyTask({ id: 'X', status: 'ready', deps: [] }));
  assert.ok(!ruleSet(single.warnings).has('GRAPH-CONNECTED'));

  // ④ 空板（零任务）→ 不 warn。
  const empty = lintBoard(J({ ...GOOD, tasks: [] }));
  assert.ok(!ruleSet(empty.warnings).has('GRAPH-CONNECTED'));

  // ⑤ parent 嵌套子任务 deps:[] → 不 warn（连通性 = deps ∪ parent 容器边·ADR-012）。
  //   c 自身无 deps，但经 parent="M" 连进主图（A→M）——parent-edge refinement 前会被误判孤岛。
  const nested = lintBoard(
    J({
      ...GOOD,
      tasks: [
        { id: 'A', status: 'ready', deps: [] },
        { id: 'M', status: 'in_progress', deps: ['A'] },
        { id: 'c', status: 'ready', deps: [], parent: 'M' },
      ],
    }),
  );
  assert.ok(
    !ruleSet(nested.warnings).has('GRAPH-CONNECTED'),
    `parent 嵌套子任务 deps:[] 不该被误判孤岛：${J(nested.warnings)}`,
  );

  // ⑥ fill-work 豁免：主图 {A→B} + 独立 F1(role=fill-work·deps:[]) → **不** warn。
  //   fill-work 定义即「脱离主图的填闲并行工作」、故意独立，从连通性判定中剔除，不该 cry-wolf。
  const fillWorkIsland = lintBoard(
    J({
      ...GOOD,
      tasks: [
        { id: 'A', status: 'ready', deps: [] },
        { id: 'B', status: 'ready', deps: ['A'] },
        { id: 'F1', status: 'ready', deps: [], role: 'fill-work' },
      ],
    }),
  );
  assert.ok(
    !ruleSet(fillWorkIsland.warnings).has('GRAPH-CONNECTED'),
    `纯 fill-work 孤岛应被豁免、不 warn：${J(fillWorkIsland.warnings)}`,
  );

  // ⑦ awaiting-user 不豁免：主图 {A→B} + 独立 D1(blocked_on=user 的决策门·deps:[]) → **仍** warn。
  //   决策门本应连进主图（是某工作节点的子/子图/节点本身），孤立即真遗漏——照常计入（用户拍板·非 fill-work）。
  const awaitingIsland = lintBoard(
    J({
      ...GOOD,
      tasks: [
        { id: 'A', status: 'ready', deps: [] },
        { id: 'B', status: 'ready', deps: ['A'] },
        { id: 'D1', status: 'blocked', deps: [], blocked_on: 'user' },
      ],
    }),
  );
  const wa = awaitingIsland.warnings.find((x) => x.rule === 'GRAPH-CONNECTED');
  assert.ok(wa, `独立 awaiting-user 决策门不豁免、仍应 warn：${J(awaitingIsland.warnings)}`);
  assert.match((wa as { message: string }).message, /D1/);

  // ⑧ 混合：主图 {A→B} + fill-work F1（豁免）+ 真孤岛 T8（非 fill-work）→ warn，孤岛只列 T8、不列 F1。
  const mixed = lintBoard(
    J({
      ...GOOD,
      tasks: [
        { id: 'A', status: 'ready', deps: [] },
        { id: 'B', status: 'ready', deps: ['A'] },
        { id: 'F1', status: 'ready', deps: [], role: 'fill-work' },
        { id: 'T8', status: 'ready', deps: [] },
      ],
    }),
  );
  const wm = mixed.warnings.find((x) => x.rule === 'GRAPH-CONNECTED');
  assert.ok(wm, `真孤岛 T8 应 warn（fill-work F1 被豁免）：${J(mixed.warnings)}`);
  assert.match((wm as { message: string }).message, /T8/); // 真孤岛列出
  assert.doesNotMatch((wm as { message: string }).message, /F1/); // fill-work 不出现（已从节点集剔除）
  assert.match((wm as { message: string }).message, /2 个互不相连/); // 只有 {A,B} 与 {T8} 两分量
});

test('FMT-PARENT: malformed parent (key present, non-empty-string 违例) is hard', () => {
  assert.ok(
    ruleSet(lintBoard(onlyTask({ id: 'A', status: 'ready', deps: [], parent: ['M'] })).errors).has(
      'FMT-PARENT',
    ),
  );
  assert.ok(
    ruleSet(lintBoard(onlyTask({ id: 'A', status: 'ready', deps: [], parent: '' })).errors).has(
      'FMT-PARENT',
    ),
  );
});

// ── silent-on-unknown（红线2）───────────────────────────────────────────────────────────────────────
test('红线2: flat board (no parent) + arbitrary agent-shaped fields → zero errors/warnings', () => {
  const flat = lintBoard(
    J({
      ...GOOD,
      my_custom: 42,
      weird: { x: 1 },
      tasks: [
        { id: 'X', status: 'ready', deps: [], whatever: ['a'], mechanism: 'legacy', notes: 'free' },
      ],
    }),
  );
  assert.equal(flat.errors.length, 0, J(flat.errors));
  assert.equal(flat.warnings.length, 0, J(flat.warnings));
});

// ── FMT v2 新字段枚举/形状 ──────────────────────────────────────────────────────────────────────────
test('FMT-EXECUTOR (hard) / FMT-ROLE (hard) / FMT-TYPE (warn·开放枚举)', () => {
  assert.ok(
    ruleSet(
      lintBoard(onlyTask({ id: 'X', status: 'ready', deps: [], executor: 'shell' })).errors,
    ).has('FMT-EXECUTOR'),
  );
  assert.ok(
    ruleSet(lintBoard(onlyTask({ id: 'X', status: 'ready', deps: [], role: 'boss' })).errors).has(
      'FMT-ROLE',
    ),
  );
  const ty = lintBoard(onlyTask({ id: 'X', status: 'ready', deps: [], type: 'made-up' }));
  assert.ok(ruleSet(ty.warnings).has('FMT-TYPE'), 'unknown type warns (open enum)');
  assert.ok(!ruleSet(ty.errors).has('FMT-TYPE'), 'unknown type never hard-fails');
});

test('FMT-REF: relative path is hard; URL/absolute OK; unknown kind warns (FMT-REF-KIND)', () => {
  assert.ok(
    ruleSet(
      lintBoard(
        onlyTask({
          id: 'X',
          status: 'ready',
          deps: [],
          references: [{ kind: 'spec', ref: 'docs/rel.md' }],
        }),
      ).errors,
    ).has('FMT-REF'),
  );
  const ok = lintBoard(
    onlyTask({
      id: 'X',
      status: 'ready',
      deps: [],
      references: [
        { kind: 'spec', ref: '/abs/x.md' },
        { kind: 'web', ref: 'https://e.com' },
      ],
    }),
  );
  assert.ok(!ruleSet(ok.errors).has('FMT-REF'), J(ok.errors));
  assert.ok(
    ruleSet(
      lintBoard(
        onlyTask({
          id: 'X',
          status: 'ready',
          deps: [],
          references: [{ kind: 'bogus', ref: '/x' }],
        }),
      ).warnings,
    ).has('FMT-REF-KIND'),
  );
});

test('FMT-ESTIMATE / FMT-ACCEPTANCE / FMT-BLOCKED-ON / FMT-WIP / FMT-TIME (warn)', () => {
  assert.ok(
    ruleSet(
      lintBoard(onlyTask({ id: 'X', status: 'ready', deps: [], estimate: { value: 'big' } }))
        .warnings,
    ).has('FMT-ESTIMATE'),
  );
  assert.ok(
    ruleSet(
      lintBoard(onlyTask({ id: 'X', status: 'ready', deps: [], acceptance: { criteria: [] } }))
        .warnings,
    ).has('FMT-ACCEPTANCE'),
  );
  assert.ok(
    ruleSet(
      lintBoard(onlyTask({ id: 'X', status: 'blocked', deps: [], blocked_on: 'NOPE' })).warnings,
    ).has('FMT-BLOCKED-ON'),
  );
  assert.ok(
    ruleSet(
      lintBoard(onlyTask({ id: 'X', status: 'ready', deps: [], wip_limit: 'two' })).warnings,
    ).has('FMT-WIP'),
  );
  assert.ok(
    ruleSet(
      lintBoard(onlyTask({ id: 'X', status: 'ready', deps: [], created_at: '10:00Z' })).warnings,
    ).has('FMT-TIME'),
  );
});

// ── FMT 板级观察/柔性模块 ───────────────────────────────────────────────────────────────────────────
test('FMT-SCHEDULING / FMT-WATCHDOG / FMT-META / FMT-LOG / FMT-JUDGMENT-CALLS / FMT-CADENCE (warn)', () => {
  assert.ok(
    ruleSet(lintBoard(J({ ...GOOD, scheduling: { wip_limit: 'x' } })).warnings).has(
      'FMT-SCHEDULING',
    ),
  );
  assert.ok(
    ruleSet(lintBoard(J({ ...GOOD, watchdog: { mechanism: 'telepathy' } })).warnings).has(
      'FMT-WATCHDOG',
    ),
  );
  assert.ok(
    ruleSet(lintBoard(J({ ...GOOD, watchdog: { fire_at: 'soon' } })).warnings).has('FMT-WATCHDOG'),
  );
  assert.ok(
    ruleSet(lintBoard(J({ ...GOOD, meta: { template_version: 1.5 } })).warnings).has('FMT-META'),
  );
  assert.ok(
    ruleSet(
      lintBoard(J({ ...GOOD, log: [{ ts: '2026-06-23T10:00:00Z', kind: 'bogus' }] })).warnings,
    ).has('FMT-LOG'),
  );
  assert.ok(
    ruleSet(
      lintBoard(J({ ...GOOD, judgment_calls: [{ id: 'J1', summary: 's', severity: 'urgent' }] }))
        .warnings,
    ).has('FMT-JUDGMENT-CALLS'),
  );
  assert.ok(
    ruleSet(
      lintBoard(J({ ...GOOD, cadence: { iterations: [{ id: 'I1', status: 'partly' }] } })).warnings,
    ).has('FMT-CADENCE'),
  );
});

test('watchdog null / absent is legal (no warn)', () => {
  assert.equal(lintBoard(J({ ...GOOD, watchdog: null })).warnings.length, 0);
});

// ── BIZ awaiting-user 完整性 ────────────────────────────────────────────────────────────────────────
const HASH = `sha256:${'a'.repeat(64)}`;
const FULL_DP = {
  ask_type: 'decision',
  context_md: 'why',
  what_i_need: 'pick',
  inputs_hash: HASH,
  enter_cmd: '/cc-master:discuss D1',
  options: [{ label: 'A' }],
};

test('BIZ-AWAITING: awaiting-user node w/o decision_package is hard (blocked & in_flight forms)', () => {
  assert.ok(
    ruleSet(
      lintBoard(onlyTask({ id: 'D1', status: 'blocked', deps: [], blocked_on: 'user' })).errors,
    ).has('BIZ-AWAITING'),
  );
  assert.ok(
    ruleSet(
      lintBoard(
        onlyTask({
          id: 'D1',
          status: 'in_flight',
          deps: [],
          blocked_on: 'user',
          started_at: '2026-06-23T10:00:00Z',
        }),
      ).errors,
    ).has('BIZ-AWAITING'),
  );
  assert.ok(
    ruleSet(
      lintBoard(
        onlyTask({
          id: 'D1',
          status: 'blocked',
          deps: [],
          blocked_on: 'user',
          decision_package: [],
        }),
      ).errors,
    ).has('BIZ-AWAITING'),
  );
});

test('BIZ: a complete decision_package on awaiting-user → zero errors/warnings', () => {
  const r = lintBoard(
    onlyTask({
      id: 'D1',
      status: 'blocked',
      deps: [],
      blocked_on: 'user',
      decision_package: FULL_DP,
    }),
  );
  assert.equal(r.errors.length, 0, J(r.errors));
  assert.equal(r.warnings.length, 0, J(r.warnings));
});

test('BIZ-DECISION-PACKAGE: missing fields warn (never a BIZ-AWAITING hard when package is a real object)', () => {
  const r = lintBoard(
    onlyTask({
      id: 'D1',
      status: 'blocked',
      deps: [],
      blocked_on: 'user',
      decision_package: { ask_type: 'advice' },
    }),
  );
  assert.ok(!ruleSet(r.errors).has('BIZ-AWAITING'));
  assert.ok(ruleSet(r.warnings).has('BIZ-DECISION-PACKAGE'));
});

test('#38: inputs_hash must be sha256:<64 hex> (loose/short now warns)', () => {
  const short = lintBoard(
    onlyTask({
      id: 'D1',
      status: 'blocked',
      deps: [],
      blocked_on: 'user',
      decision_package: { ...FULL_DP, inputs_hash: 'sha256:abc' },
    }),
  );
  assert.ok(ruleSet(short.warnings).has('BIZ-DECISION-PACKAGE'), 'short hash warns');
  const okHash = lintBoard(
    onlyTask({
      id: 'D1',
      status: 'blocked',
      deps: [],
      blocked_on: 'user',
      decision_package: FULL_DP,
    }),
  );
  assert.ok(!ruleSet(okHash.warnings).has('BIZ-DECISION-PACKAGE'), '64-hex hash clean');
});

// ── BIZ 条件业务规则 ────────────────────────────────────────────────────────────────────────────────
test('BIZ-DEV-REFS: type=development ⇒ refs 含 spec + plan（hard，C1 ADR-019 §14 warn→hard）', () => {
  const bad = lintBoard(
    onlyTask({
      id: 'X',
      status: 'ready',
      deps: [],
      type: 'development',
      acceptance: 'done when green',
      references: [{ kind: 'spec', ref: '/s' }],
    }),
  );
  assert.ok(ruleSet(bad.errors).has('BIZ-DEV-REFS'), 'missing plan ref → hard error');
  assert.ok(!ruleSet(bad.warnings).has('BIZ-DEV-REFS'));
  const ok = lintBoard(
    onlyTask({
      id: 'X',
      status: 'ready',
      deps: [],
      type: 'development',
      acceptance: 'done when green',
      references: [
        { kind: 'spec', ref: '/s' },
        { kind: 'plan', ref: '/p' },
      ],
    }),
  );
  assert.ok(!ruleSet(ok.errors).has('BIZ-DEV-REFS'));
  assert.ok(!ruleSet(ok.warnings).has('BIZ-DEV-REFS'));
});

test('BIZ-ACCEPTANCE-REQUIRED: dev-family type ⇒ acceptance 非空', () => {
  assert.ok(
    ruleSet(
      lintBoard(onlyTask({ id: 'X', status: 'ready', deps: [], type: 'acceptance' })).warnings,
    ).has('BIZ-ACCEPTANCE-REQUIRED'),
  );
  assert.ok(
    !ruleSet(
      lintBoard(
        onlyTask({ id: 'X', status: 'ready', deps: [], type: 'acceptance', acceptance: 'DoD' }),
      ).warnings,
    ).has('BIZ-ACCEPTANCE-REQUIRED'),
  );
  // 非 dev-family type 不要求 acceptance。
  assert.ok(
    !ruleSet(
      lintBoard(onlyTask({ id: 'X', status: 'ready', deps: [], type: 'planning' })).warnings,
    ).has('BIZ-ACCEPTANCE-REQUIRED'),
  );
});

test('BIZ-EXECUTOR-HANDLE: only in_flight subagent/workflow tasks require a handle', () => {
  const statuses = ['blocked', 'ready', 'in_flight'] as const;
  const executors = ['subagent', 'workflow', 'external', 'user', 'master-orchestrator'] as const;

  for (const status of statuses) {
    for (const executor of executors) {
      for (const hasHandle of [false, true]) {
        const expectedWarning =
          status === 'in_flight' &&
          (executor === 'subagent' || executor === 'workflow') &&
          !hasHandle;
        const warnings = ruleSet(
          lintBoard(
            onlyTask({
              id: 'X',
              status,
              deps: [],
              executor,
              ...(status === 'in_flight' ? { started_at: '2026-06-23T10:00:00Z' } : {}),
              ...(hasHandle ? { handle: 'bg-1' } : {}),
            }),
          ).warnings,
        );

        assert.equal(
          warnings.has('BIZ-EXECUTOR-HANDLE'),
          expectedWarning,
          `${status}/${executor}/${hasHandle ? 'handle' : 'missing handle'}`,
        );
      }
    }
  }
});

test('external executor issue tracking rules', () => {
  assert.ok(
    ruleSet(
      lintBoard(onlyTask({ id: 'X', status: 'ready', deps: [], executor: 'external' })).warnings,
    ).has('BIZ-EXTERNAL-ISSUE'),
  );
  assert.ok(
    !ruleSet(
      lintBoard(
        onlyTask({
          id: 'X',
          status: 'ready',
          deps: [],
          executor: 'external',
          references: [{ kind: 'issue', ref: 'https://gh/i/1' }],
        }),
      ).warnings,
    ).has('BIZ-EXTERNAL-ISSUE'),
  );
  const issueUrl = 'https://github.com/o/r/issues/9';
  const doneWithIssueAsArtifact = lintBoard(
    onlyTask({
      id: 'X',
      status: 'done',
      deps: [],
      executor: 'external',
      references: [{ kind: 'issue', ref: issueUrl }],
      artifact: issueUrl,
      verified: true,
      started_at: '2026-06-23T10:00:00Z',
      finished_at: '2026-06-23T11:00:00Z',
    }),
  );
  assert.ok(
    ruleSet(doneWithIssueAsArtifact.warnings).has('BIZ-EXTERNAL-ARTIFACT'),
    'external done artifact must not be only the issue tracking anchor',
  );
  const doneWithPrArtifact = lintBoard(
    onlyTask({
      id: 'X',
      status: 'done',
      deps: [],
      executor: 'external',
      references: [{ kind: 'issue', ref: issueUrl }],
      artifact: 'https://github.com/o/r/pull/12',
      verified: true,
      started_at: '2026-06-23T10:00:00Z',
      finished_at: '2026-06-23T11:00:00Z',
    }),
  );
  assert.ok(
    !ruleSet(doneWithPrArtifact.warnings).has('BIZ-EXTERNAL-ARTIFACT'),
    'external done with a real PR artifact is clean',
  );
});

test('BIZ-TIME-ORDER: done⇒finished, in_flight⇒started, ordering', () => {
  assert.ok(
    ruleSet(lintBoard(onlyTask({ id: 'X', status: 'done', deps: [] })).warnings).has(
      'BIZ-TIME-ORDER',
    ),
  ); // done 无 finished
  assert.ok(
    ruleSet(lintBoard(onlyTask({ id: 'X', status: 'in_flight', deps: [] })).warnings).has(
      'BIZ-TIME-ORDER',
    ),
  ); // in_flight 无 started
  const order = lintBoard(
    onlyTask({
      id: 'X',
      status: 'done',
      deps: [],
      started_at: '2026-06-23T11:00:00Z',
      finished_at: '2026-06-23T10:00:00Z',
    }),
  );
  assert.ok(ruleSet(order.warnings).has('BIZ-TIME-ORDER')); // finished 早于 started
});

// ── BIZ-CADENCE-SHIPPED（hard·收口完整性）──────────────────────────────────────────────────────────
test('BIZ-CADENCE-SHIPPED: shipped iteration with incomplete member is hard', () => {
  const bad = lintBoard(
    J({ ...GOOD, cadence: { iterations: [{ id: 'I1', status: 'shipped', members: ['T1'] }] } }),
  );
  // T1 是 ready（非 done+verified）→ hard。
  assert.ok(ruleSet(bad.errors).has('BIZ-CADENCE-SHIPPED'), J(bad.errors));
  const ok = lintBoard(
    J({
      ...GOOD,
      tasks: [
        {
          id: 'T0',
          status: 'done',
          deps: [],
          verified: true,
          artifact: '/abs/t0.md',
          started_at: '2026-06-23T10:00:00Z',
          finished_at: '2026-06-23T11:00:00Z',
        },
      ],
      cadence: { iterations: [{ id: 'I1', status: 'shipped', members: ['T0'] }] },
    }),
  );
  assert.ok(!ruleSet(ok.errors).has('BIZ-CADENCE-SHIPPED'), J(ok.errors));
});

test('BIZ-CADENCE agile health: clean 3h iteration with estimated accepted thin slices has no warnings', () => {
  const ok = lintBoard(
    J({
      ...GOOD,
      cadence: {
        target: { ship_every: '3h', min_unit: '1 PR' },
        iterations: [
          {
            id: 'I1',
            status: 'open',
            started_at: '2026-06-23T10:00:00Z',
            deadline: '2026-06-23T13:00:00Z',
            members: ['A', 'B'],
          },
        ],
      },
      tasks: [
        {
          id: 'A',
          status: 'done',
          deps: [],
          verified: true,
          artifact: '/abs/a.md',
          estimate: { value: 1, unit: 'h' },
          acceptance: 'A endpoint verified',
          started_at: '2026-06-23T10:00:00Z',
          finished_at: '2026-06-23T11:00:00Z',
        },
        {
          id: 'B',
          status: 'ready',
          deps: ['A'],
          estimate: { value: 2, unit: 'h' },
          acceptance: { criteria: [{ desc: 'B endpoint verified', status: 'pending' }] },
        },
      ],
    }),
  );
  assert.equal(ok.errors.length, 0, J(ok.errors));
  for (const rule of [
    'BIZ-CADENCE-MISSING-ESTIMATE',
    'BIZ-CADENCE-OVERBOOKED',
    'BIZ-CADENCE-CRITICAL-PATH-OVER',
    'BIZ-TASK-OVERSIZED-FOR-CADENCE',
    'BIZ-AGILE-ACCEPTANCE-MISSING',
  ]) {
    assert.ok(!ruleSet(ok.warnings).has(rule), `${rule} should not warn: ${J(ok.warnings)}`);
  }
});

test('BIZ-CADENCE agile health warns for missing estimates, overbooked timebox, oversized task, missing acceptance, and critical path over', () => {
  const bad = lintBoard(
    J({
      ...GOOD,
      cadence: {
        target: { ship_every: '3h', min_unit: '1 PR' },
        iterations: [
          {
            id: 'I-bad',
            status: 'open',
            started_at: '2026-06-23T10:00:00Z',
            deadline: '2026-06-23T13:00:00Z',
            members: ['A', 'B', 'C'],
          },
        ],
      },
      tasks: [
        {
          id: 'A',
          status: 'ready',
          deps: [],
          estimate: { value: 2, unit: 'h' },
          acceptance: 'A thin slice ships',
        },
        {
          id: 'B',
          status: 'ready',
          deps: ['A'],
          estimate: { value: 2, unit: 'h' },
          acceptance: 'B thin slice ships',
        },
        {
          id: 'C',
          status: 'ready',
          deps: [],
        },
      ],
    }),
  );
  const warnings = ruleSet(bad.warnings);
  assert.ok(warnings.has('BIZ-CADENCE-MISSING-ESTIMATE'), J(bad.warnings));
  assert.ok(warnings.has('BIZ-CADENCE-OVERBOOKED'), J(bad.warnings));
  assert.ok(warnings.has('BIZ-CADENCE-CRITICAL-PATH-OVER'), J(bad.warnings));
  assert.ok(warnings.has('BIZ-AGILE-ACCEPTANCE-MISSING'), J(bad.warnings));

  const oversized = lintBoard(
    J({
      ...GOOD,
      cadence: {
        target: { ship_every: '3h / 1 PR' },
        iterations: [{ id: 'I-big', status: 'open', members: ['BIG'] }],
      },
      tasks: [
        {
          id: 'BIG',
          status: 'ready',
          deps: [],
          estimate: { value: 4, unit: 'h' },
          acceptance: 'BIG ships a vertical slice',
        },
      ],
    }),
  );
  assert.ok(
    ruleSet(oversized.warnings).has('BIZ-TASK-OVERSIZED-FOR-CADENCE'),
    J(oversized.warnings),
  );
});

test('BIZ-ESTIMATE-STALE: measured drift on a done task suggests re-estimating not-started downstream', () => {
  const stale = lintBoard(
    J({
      ...GOOD,
      tasks: [
        {
          id: 'A',
          status: 'done',
          deps: [],
          verified: true,
          artifact: '/abs/a.md',
          estimate: { value: 1, unit: 'h' },
          started_at: '2026-06-23T10:00:00Z',
          finished_at: '2026-06-23T13:30:00Z',
        },
        { id: 'B', status: 'blocked', deps: ['A'], estimate: { value: 1, unit: 'h' } },
      ],
    }),
  );
  assert.ok(ruleSet(stale.warnings).has('BIZ-ESTIMATE-STALE'), J(stale.warnings));

  const alreadyStarted = lintBoard(
    J({
      ...GOOD,
      tasks: [
        {
          id: 'A',
          status: 'done',
          deps: [],
          verified: true,
          artifact: '/abs/a.md',
          estimate: { value: 1, unit: 'h' },
          started_at: '2026-06-23T10:00:00Z',
          finished_at: '2026-06-23T13:30:00Z',
        },
        {
          id: 'B',
          status: 'in_flight',
          deps: ['A'],
          estimate: { value: 1, unit: 'h' },
          started_at: '2026-06-23T14:00:00Z',
        },
      ],
    }),
  );
  assert.ok(!ruleSet(alreadyStarted.warnings).has('BIZ-ESTIMATE-STALE'));
});

// ── BIZ-DONE-VERIFIED（hard·done 真语义）──────────────────────────────────────────────────────────
test('BIZ-DONE-VERIFIED: done task requires verified=true and non-empty artifact', () => {
  assert.equal(model.levelOf('BIZ-DONE-VERIFIED'), 'hard');
  const missingBoth = lintBoard(
    onlyTask({
      id: 'X',
      status: 'done',
      deps: [],
      started_at: '2026-06-23T10:00:00Z',
      finished_at: '2026-06-23T11:00:00Z',
    }),
  );
  assert.ok(has(missingBoth, 'BIZ-DONE-VERIFIED'), 'missing verified + artifact is hard');

  const missingArtifact = lintBoard(
    onlyTask({
      id: 'X',
      status: 'done',
      deps: [],
      verified: true,
      started_at: '2026-06-23T10:00:00Z',
      finished_at: '2026-06-23T11:00:00Z',
    }),
  );
  assert.ok(has(missingArtifact, 'BIZ-DONE-VERIFIED'), 'missing artifact is hard');

  const emptyArtifact = lintBoard(
    onlyTask({
      id: 'X',
      status: 'done',
      deps: [],
      verified: true,
      artifact: '',
      started_at: '2026-06-23T10:00:00Z',
      finished_at: '2026-06-23T11:00:00Z',
    }),
  );
  assert.ok(has(emptyArtifact, 'BIZ-DONE-VERIFIED'), 'empty artifact is hard');

  const ok = lintBoard(
    onlyTask({
      id: 'X',
      status: 'done',
      deps: [],
      verified: true,
      artifact: '/abs/out.md',
      started_at: '2026-06-23T10:00:00Z',
      finished_at: '2026-06-23T11:00:00Z',
    }),
  );
  assert.ok(!has(ok, 'BIZ-DONE-VERIFIED'), 'done + verified + artifact is clean');
});

test('review dependency gate fields are validated and orphan verdict is rejected', () => {
  assert.equal(model.levelOf('FMT-DEPENDENCY-GATE'), 'hard');
  assert.equal(model.levelOf('FMT-REVIEW-VERDICT'), 'hard');
  assert.equal(model.levelOf('BIZ-REVIEW-VERDICT-GATE'), 'hard');

  const malformedGate = lintBoard(
    onlyTask({
      id: 'R1',
      status: 'ready',
      deps: [],
      dependency_gate: { kind: 'review', required_verdict: 'MERGE' },
    }),
  );
  assert.ok(ruleSet(malformedGate.errors).has('FMT-DEPENDENCY-GATE'));

  const invalidVerdict = lintBoard(
    onlyTask({
      id: 'R1',
      status: 'ready',
      deps: [],
      dependency_gate: { kind: 'review', required_verdict: 'APPROVE' },
      review_verdict: '',
    }),
  );
  assert.ok(ruleSet(invalidVerdict.errors).has('FMT-REVIEW-VERDICT'));

  const orphanVerdict = lintBoard(
    onlyTask({ id: 'R1', status: 'ready', deps: [], review_verdict: 'REQUEST-CHANGES' }),
  );
  assert.ok(ruleSet(orphanVerdict.errors).has('BIZ-REVIEW-VERDICT-GATE'));

  const pendingGate = lintBoard(
    onlyTask({
      id: 'R1',
      status: 'ready',
      deps: [],
      dependency_gate: { kind: 'review', required_verdict: 'APPROVE' },
      review_verdict: null,
    }),
  );
  assert.ok(!has(pendingGate, 'FMT-REVIEW-VERDICT'), 'null means no verdict yet');
  assert.ok(!has(pendingGate, 'BIZ-REVIEW-VERDICT-GATE'));
});

test('routing contracts are additive: legacy boards stay clean; partial activation is hard invalid', () => {
  const legacy = lintBoard(
    onlyTask({ id: 'L', status: 'ready', deps: [], executor: 'subagent', handle: 'legacy' }),
  );
  assert.ok(!ruleSet(legacy.errors).has('BIZ-ROUTED-PLANNING-REQUIRED'));
  assert.ok(!ruleSet(legacy.errors).has('BIZ-ROUTE-POLICY-REQUIRED'));

  const partial = lintBoard(
    J({
      ...GOOD,
      meta: { template_version: 3, contracts: { task_planning: 'ccm/task-planning/v1' } },
    }),
  );
  assert.ok(ruleSet(partial.errors).has('FMT-CONTRACTS'));
});

test('contract-enabled in-flight route enforces planning/policy/selection/attempt handle gates', () => {
  const enabled = (task: unknown) =>
    lintBoard(
      J({
        ...GOOD,
        meta: { template_version: 3, contracts: ROUTING_CONTRACTS },
        tasks: [task],
      }),
    );

  const good = enabled(ROUTED_TASK);
  for (const rule of [
    'BIZ-ROUTED-PLANNING-REQUIRED',
    'BIZ-ROUTE-POLICY-REQUIRED',
    'BIZ-ROUTE-SELECTION-REQUIRED',
    'BIZ-ROUTE-ATTEMPT-REQUIRED',
  ]) {
    assert.ok(!ruleSet(good.errors).has(rule), `${rule}: ${J(good.errors)}`);
  }

  const noPlanning = structuredClone(ROUTED_TASK);
  delete noPlanning.planning;
  assert.ok(ruleSet(enabled(noPlanning).errors).has('BIZ-ROUTED-PLANNING-REQUIRED'));

  const noSelection = structuredClone(ROUTED_TASK);
  noSelection.routing.selected = null;
  assert.ok(ruleSet(enabled(noSelection).errors).has('BIZ-ROUTE-SELECTION-REQUIRED'));

  const fakeHandle = structuredClone(ROUTED_TASK);
  fakeHandle.handle = 'different-claim';
  assert.ok(ruleSet(enabled(fakeHandle).errors).has('BIZ-ROUTE-ATTEMPT-REQUIRED'));
});

test('grandfather is fingerprinted terminal-only and disappears when a task retries', () => {
  const historical = {
    id: 'HIST',
    status: 'failed',
    deps: [],
    executor: 'subagent',
    created_at: '2026-07-01T08:00:00Z',
  };
  const meta = {
    template_version: 3,
    contracts: {
      ...ROUTING_CONTRACTS,
      agent_routing_grandfathered_terminal: [
        { task_id: 'HIST', created_at: '2026-07-01T08:00:00Z' },
      ],
    },
  };
  const old = lintBoard(J({ ...GOOD, meta, tasks: [historical] }));
  assert.ok(!ruleSet(old.errors).has('BIZ-ROUTED-PLANNING-REQUIRED'));

  const retry = lintBoard(J({ ...GOOD, meta, tasks: [{ ...historical, status: 'ready' }] }));
  assert.ok(ruleSet(retry.errors).has('BIZ-ROUTED-PLANNING-REQUIRED'));

  const recreated = lintBoard(
    J({
      ...GOOD,
      meta,
      tasks: [{ ...historical, status: 'done', created_at: '2026-07-10T09:00:00Z' }],
    }),
  );
  assert.ok(ruleSet(recreated.errors).has('BIZ-ROUTED-PLANNING-REQUIRED'));
});

// ── 报告格式 ────────────────────────────────────────────────────────────────────────────────────────
test('agent-friendly report: errors carry rule + message (not a stack trace)', () => {
  const r = lintBoard(J({ ...GOOD, schema: 'cc-master/v1' }));
  const e = r.errors.find((x) => x.rule === 'FMT-SCHEMA');
  assert.ok(e && typeof e.message === 'string' && e.message.length > 0);
  assert.ok(!/at .*\(.*:\d+:\d+\)/.test(e!.message), 'no raw stack frame in message');
});
