// board-lint-core.test.ts — @ccm/engine·board v2 共享 lint 核心契约门（派生自 board-model）。
//   T1 port：从 cli/test/unit/board-lint-core.test.mjs 移植，CJS createRequire 加载改为对 ported TS 源的 ESM import。
//   原前 3 个「源文件存在 + hook/manual 都 wire 到同一份 + lint-core require board-model」的布局/接线断言
//   测的是旧 cli/src + hooks/ 仓库形态，对 ported @ccm/engine 不再适用——已删；DRY/单一真相源在 TS 引擎里
//   由 board-graph-core import board-lint-core 的静态依赖图天然保证（board-graph-core.test.ts 仍间接覆盖）。
//   行为断言（lintBoard 全集规则 + 级别 SSOT 一致）逐条保留。

import assert from 'node:assert/strict';
import { test } from 'node:test';
// 测 build 后的 dist 公开 API barrel（见 board-model.test.ts 注：源 NodeNext `.js` specifier 直跑解析不了）。
//   lintBoard / levelOf 都从 @ccm/engine 的统一面取——这正是下游消费方拿到的接口。
import { levelOf, lintBoard } from '../dist/index.mjs';

const model = { levelOf };

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
        { id: 'M', status: 'done', deps: [] },
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
        { id: 'M', status: 'done', deps: [] },
        { id: 'c', status: 'ready', deps: [], parent: 'M' },
      ],
    }),
  );
  assert.ok(ruleSet(roll.warnings).has('GRAPH-ROLLUP'));
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
test('BIZ-DEV-REFS: type=development ⇒ refs 含 spec + plan', () => {
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
  assert.ok(ruleSet(bad.warnings).has('BIZ-DEV-REFS'), 'missing plan ref warns');
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

test('BIZ-EXECUTOR-HANDLE: subagent/workflow ⇒ handle; BIZ-EXTERNAL-ISSUE: external ⇒ issue ref', () => {
  assert.ok(
    ruleSet(
      lintBoard(
        onlyTask({
          id: 'X',
          status: 'in_flight',
          deps: [],
          executor: 'subagent',
          started_at: '2026-06-23T10:00:00Z',
        }),
      ).warnings,
    ).has('BIZ-EXECUTOR-HANDLE'),
  );
  assert.ok(
    !ruleSet(
      lintBoard(
        onlyTask({
          id: 'X',
          status: 'in_flight',
          deps: [],
          executor: 'subagent',
          handle: 'bg-1',
          started_at: '2026-06-23T10:00:00Z',
        }),
      ).warnings,
    ).has('BIZ-EXECUTOR-HANDLE'),
  );
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
          started_at: '2026-06-23T10:00:00Z',
          finished_at: '2026-06-23T11:00:00Z',
        },
      ],
      cadence: { iterations: [{ id: 'I1', status: 'shipped', members: ['T0'] }] },
    }),
  );
  assert.ok(!ruleSet(ok.errors).has('BIZ-CADENCE-SHIPPED'), J(ok.errors));
});

// ── BIZ-DONE-VERIFIED 是 reserved（登记在册·lint 暂不强制）──────────────────────────────────────────
test('BIZ-DONE-VERIFIED is reserved: a done task without verified/artifact emits NO such error', () => {
  assert.equal(model.levelOf('BIZ-DONE-VERIFIED'), 'reserved');
  const r = lintBoard(
    onlyTask({
      id: 'X',
      status: 'done',
      deps: [],
      started_at: '2026-06-23T10:00:00Z',
      finished_at: '2026-06-23T11:00:00Z',
    }),
  );
  assert.ok(!has(r, 'BIZ-DONE-VERIFIED'), 'reserved rule is silently skipped by emit()');
});

// ── 报告格式 ────────────────────────────────────────────────────────────────────────────────────────
test('agent-friendly report: errors carry rule + message (not a stack trace)', () => {
  const r = lintBoard(J({ ...GOOD, schema: 'cc-master/v1' }));
  const e = r.errors.find((x) => x.rule === 'FMT-SCHEMA');
  assert.ok(e && typeof e.message === 'string' && e.message.length > 0);
  assert.ok(!/at .*\(.*:\d+:\d+\)/.test(e!.message), 'no raw stack frame in message');
});
