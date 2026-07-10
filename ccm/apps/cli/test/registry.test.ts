// registry.test.ts — 命令 SSOT（registry.ts）契约门 + 反漂移门。
//
// registry.ts 是 CLI 命令面的单一真相源（noun → verb → spec）。本测试钉死：
//   ① 结构契约：每 verb 有 summary / handler / read:bool / positionals / options / examples；
//      options 的 enum 值取自 board-model.ENUMS（零漂移）；handler 串形如 '<noun>.<verb...>'。
//   ② 别名：ALIASES.next→[board,next] / lint→[board,lint]。
//   ③ 反漂移门（cli-design §3.5）：遍历 board-model.FIELDS，凡 writer 含「agent 经 CLI」的字段，
//      断言其 dotpath ∈ WRITABLE_FIELDS_COVERED().fields 或被 --set/--set-json 通配覆盖（漏配即 fail）。
//
// T2a port 注：原 .mjs 经 createRequire 加载 CJS（cli/test/unit/registry.test.mjs），改成正常 ESM import
//   ported registry.ts；board-model 的 ENUMS / FIELDS / TIERS 从 `@ccm/engine` import（rewire 后真链路）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENUMS, FIELDS, TIERS } from '@ccm/engine';
import { ALIASES, REGISTRY, WRITABLE_FIELDS_COVERED } from '../src/registry.js';

const model = { ENUMS, FIELDS, TIERS };

// ── 覆盖全部 namespace 的全部 verb（cli-design §3·ADR-015 加 usage/estimate·Phase 2a 加 account·COORD 加 peers·0.10.0 加 statusline·加 upgrade 自升级·harness inventory·ADR-029 加 web-viewer）──────
const EXPECTED: Record<string, string[]> = {
  board: [
    'show',
    'lint',
    'graph',
    'critical-path',
    'next',
    'init',
    'update',
    'archive',
    'set-param',
    'stamp-harness',
  ],
  baseline: ['snapshot', 'show', 'reset'],
  task: ['add', 'show', 'list', 'update', 'start', 'done', 'block', 'unblock', 'set-status', 'rm'],
  log: ['add', 'list'],
  jc: ['add', 'list', 'show', 'resolve'],
  cadence: ['update', 'open', 'ship', 'status'],
  watchdog: ['arm', 'disarm', 'status'],
  policy: ['show', 'set'],
  peers: ['list'],
  coordination: ['inbox', 'notify', 'arbitrate'],
  usage: ['show', 'advise', 'task-cost', 'burn-rate', 'runway'],
  estimate: ['show', 'forecast', 'evm', 'velocity', 'risk', 'cost-to-complete'],
  account: ['add', 'refresh', 'delete', 'list', 'switch'],
  'status-report': ['render', 'write', 'show', 'watch'],
  statusline: ['render', 'install', 'uninstall'],
  harness: ['list', 'current'],
  'web-viewer': ['start', 'open', 'status', 'stop', 'restart', 'serve'],
  monitor: ['start', 'stop', 'status', 'restart', 'serve', 'install-service', 'uninstall-service'],
  services: ['reconcile'],
  upgrade: ['all', 'ccm', 'plugin'],
};

test('REGISTRY covers all namespaces with all their verbs', () => {
  assert.deepEqual(Object.keys(REGISTRY).sort(), Object.keys(EXPECTED).sort());
  for (const noun of Object.keys(EXPECTED)) {
    assert.deepEqual(
      Object.keys(REGISTRY[noun] as Record<string, unknown>).sort(),
      (EXPECTED[noun] as string[]).slice().sort(),
      `noun ${noun} verbs`,
    );
  }
});

test('every verb spec has the required shape', () => {
  for (const noun of Object.keys(REGISTRY)) {
    const nounSpec = REGISTRY[noun] as Record<string, any>;
    for (const verb of Object.keys(nounSpec)) {
      const spec = nounSpec[verb];
      const where = `${noun} ${verb}`;
      assert.equal(typeof spec.summary, 'string', `${where} summary`);
      assert.ok(spec.summary.length > 0, `${where} summary non-empty`);
      assert.equal(typeof spec.read, 'boolean', `${where} read:bool`);
      assert.ok(Array.isArray(spec.positionals), `${where} positionals[]`);
      assert.ok(spec.options && typeof spec.options === 'object', `${where} options{}`);
      assert.ok(Array.isArray(spec.examples) && spec.examples.length > 0, `${where} examples[]`);
      assert.equal(typeof spec.handler, 'string', `${where} handler string`);
      assert.match(spec.handler, /^[a-z]+\.[A-Za-z]+$/, `${where} handler shaped noun.verb`);
    }
  }
});

test('positionals carry name + required:bool', () => {
  for (const noun of Object.keys(REGISTRY)) {
    const nounSpec = REGISTRY[noun] as Record<string, any>;
    for (const verb of Object.keys(nounSpec)) {
      for (const p of nounSpec[verb].positionals) {
        assert.equal(typeof p.name, 'string', `${noun} ${verb} positional name`);
        assert.equal(typeof p.required, 'boolean', `${noun} ${verb} positional required`);
      }
    }
  }
});

test('options carry type string|boolean and optional metadata', () => {
  for (const noun of Object.keys(REGISTRY)) {
    const nounSpec = REGISTRY[noun] as Record<string, any>;
    for (const verb of Object.keys(nounSpec)) {
      const opts = nounSpec[verb].options;
      for (const flag of Object.keys(opts)) {
        const o = opts[flag];
        const where = `${noun} ${verb} --${flag}`;
        assert.ok(o.type === 'string' || o.type === 'boolean', `${where} type`);
        if (o.enum !== undefined) assert.ok(Array.isArray(o.enum), `${where} enum array`);
        if (o.multiple !== undefined)
          assert.equal(typeof o.multiple, 'boolean', `${where} multiple`);
        if (o.required !== undefined)
          assert.equal(typeof o.required, 'boolean', `${where} required`);
        if (o.field !== undefined) assert.equal(typeof o.field, 'string', `${where} field`);
      }
    }
  }
});

// ── enum 值取自 ENUMS（零漂移抽样校验）──────────────────────────────────────────────────────────
test('option enums are sourced from board-model.ENUMS (no hand-typed drift)', () => {
  assert.deepEqual(REGISTRY.task!.add!.options.type!.enum, model.ENUMS.taskType);
  assert.deepEqual(REGISTRY.task!.add!.options.executor!.enum, model.ENUMS.executor);
  assert.deepEqual(REGISTRY.task!.add!.options.role!.enum, model.ENUMS.role);
  assert.deepEqual(REGISTRY.task!.add!.options.status!.enum, model.ENUMS.status);
  assert.deepEqual(REGISTRY.task!.list!.options.status!.enum, model.ENUMS.status);
  assert.deepEqual(REGISTRY.log!.add!.options.kind!.enum, model.ENUMS.logKind);
  assert.deepEqual(REGISTRY.jc!.add!.options.category!.enum, model.ENUMS.jcCategory);
  assert.deepEqual(REGISTRY.jc!.add!.options.severity!.enum, model.ENUMS.jcSeverity);
  assert.deepEqual(REGISTRY.jc!.list!.options.status!.enum, model.ENUMS.jcStatus);
  assert.deepEqual(REGISTRY.watchdog!.arm!.options.mechanism!.enum, model.ENUMS.watchdogMechanism);
});

// ── usage / estimate 只读不变式（ADR-015 §2 不变式 1·硬约束：纯只读 = 全 verb read:true）──────────────
//   零写不变式的 registry 层守门——这两个 advisory namespace 的每个 verb 都必须 read:true（走 runRead）。
//   若有人误把某 verb 设 read:false（→ runWrite → 抢 board-lock + 落盘），此断言红灯。
test('usage and estimate namespaces are read-only (every verb read:true)', () => {
  for (const noun of ['usage', 'estimate'] as const) {
    const nounSpec = REGISTRY[noun] as Record<string, { read: boolean; handler: string }>;
    for (const verb of Object.keys(nounSpec)) {
      assert.equal(
        (nounSpec[verb] as { read: boolean }).read,
        true,
        `${noun} ${verb} must be read-only (read:true·零写不变式)`,
      );
    }
  }
});

// usage/estimate flag 的 enum 是 CLI-local 呈现枚举（scope/mode/group-by/accounts/ac-source）——非
//   board-model 概念，故有意不取自 ENUMS（同 jc resolve 的 ['upheld','overturned'] 字面量先例）。此处
//   只钉死「它们确实是数组字面量」（结构契约已由 options-shape 测试覆盖），不与 ENUMS 比对（无对应键）。
test('usage/estimate CLI-local enums are present literal arrays (not ENUMS-sourced, by design)', () => {
  assert.deepEqual(REGISTRY.usage!.show!.options.accounts!.enum, ['all', 'current']);
  assert.deepEqual(REGISTRY.usage!['task-cost']!.options['group-by']!.enum, [
    'task',
    'executor',
    'type',
    'tier',
  ]);
  assert.deepEqual(REGISTRY.estimate!.forecast!.options.mode!.enum, [
    'estimate',
    'throughput',
    'both',
  ]);
  assert.deepEqual(REGISTRY.estimate!.evm!.options['ac-source']!.enum, ['duration', 'token']);
  assert.deepEqual(REGISTRY.estimate!.show!.options.scope!.enum, [
    'home',
    'this-repo',
    'this-board',
  ]);
});

// web-viewer 的 --board/--goal 是 viewer 初始 selection 选择器（handler resolveInitialSelection 实际
//   消费）——只有会走 startService 的 verb（start/open/restart）声明它们；status/stop/serve 不消费、不声明。
test('web-viewer selection flags declared exactly on verbs that consume them', () => {
  for (const verb of ['start', 'open', 'restart']) {
    for (const flag of ['board', 'goal']) {
      assert.equal(
        REGISTRY['web-viewer']![verb]!.options[flag]?.type,
        'string',
        `web-viewer ${verb} declares --${flag}`,
      );
    }
  }
  for (const verb of ['status', 'stop', 'serve']) {
    for (const flag of ['board', 'goal']) {
      assert.ok(
        !REGISTRY['web-viewer']![verb]!.options[flag],
        `web-viewer ${verb} must not declare --${flag} (handler does not consume it)`,
      );
    }
  }
});

// ── 别名 ─────────────────────────────────────────────────────────────────────────────────────────
test('ALIASES exposes the hot-path aliases', () => {
  assert.deepEqual(ALIASES.next, ['board', 'next']);
  assert.deepEqual(ALIASES.lint, ['board', 'lint']);
});

// ── transform 值合法 ─────────────────────────────────────────────────────────────────────────────
test('transform values are from the known set', () => {
  const KNOWN = new Set(['duration', 'csv', 'ref', 'kv', 'json', 'input']);
  for (const noun of Object.keys(REGISTRY)) {
    const nounSpec = REGISTRY[noun] as Record<string, any>;
    for (const verb of Object.keys(nounSpec)) {
      const opts = nounSpec[verb].options;
      for (const flag of Object.keys(opts)) {
        const o = opts[flag];
        if (o.transform !== undefined) {
          assert.ok(
            KNOWN.has(o.transform),
            `${noun} ${verb} --${flag} transform=${o.transform} unknown`,
          );
        }
      }
    }
  }
});

// ══ 反漂移门（cli-design §3.5·schema 加字段漏配 flag → 红灯）══════════════════════════════════════
//   遍历 FIELDS（board + task），凡 writers 含「agent 经 CLI」的字段，断言其有 CLI 入口：
//     · 直接的专属 flag（field dotpath ∈ covered.fields，含 'title' 单段 或 'scheduling.wip_limit' 嵌套）；
//     · 或被 --set/--set-json 通配覆盖（covered.hasSet / hasSetJson）。
//   有意豁免（这些「agent 经 CLI」字段经状态机/图/时间机械写，非裸 flag·见 cli-design §3.5）：
//     task: status（set-status/start/done verb）、deps（add/rm-dep verb）、started_at/finished_at（CLI 盖戳）、
//           created_at（CLI 盖戳）、blocked_on/decision_package（block verb 经 --on/--decision）；
//     board: owner（红线6·不经 CLI 写 session）、tasks（task add/rm verb）、log（log add verb）、
//            judgment_calls（jc add verb）、cadence（cadence verb）、watchdog（watchdog verb）、meta（bootstrap）。
const EXEMPT: Record<string, Set<string>> = {
  board: new Set([
    'owner',
    'tasks',
    'log',
    'judgment_calls',
    'cadence',
    'watchdog',
    'meta',
    'git',
    'scheduling',
    'baseline',
    'policy',
  ]),
  task: new Set([
    'id', // 经 `task add <id>` 的 positional 写入（🔒·非 flag·绝不 --set）
    'status',
    'deps',
    'started_at',
    'finished_at',
    'created_at',
    'blocked_on',
    'decision_package',
  ]),
};

test('anti-drift: every "agent 经 CLI" FIELDS field has a CLI entry (flag or --set wildcard)', () => {
  const covered = WRITABLE_FIELDS_COVERED();
  const wildcard = covered.hasSet || covered.hasSetJson;
  assert.ok(wildcard, '--set/--set-json wildcard escape hatch present');

  const missing: string[] = [];
  for (const scope of ['board', 'task'] as const) {
    const fields = model.FIELDS[scope] as Record<string, any>;
    for (const name of Object.keys(fields)) {
      const meta = fields[name];
      const writers = String(meta.writers || '');
      if (!writers.includes('agent 经 CLI')) continue; // 只查 agent 经 CLI 写的
      if ((EXEMPT[scope] as Set<string>).has(name)) continue; // 机械写 / 专属 verb 豁免

      // 覆盖判据：单段名直接命中，或某 dotpath 以 '<name>' 为末段/首段命中，或 --set 通配（✎ flexible 字段）。
      const direct = covered.fields.has(name);
      const asLeaf = [...covered.fields].some(
        (p) => p === name || p.split('.').pop() === name || p.split('.')[0] === name,
      );
      const flexible = meta.tier === model.TIERS.FLEXIBLE && wildcard;
      if (!(direct || asLeaf || flexible)) {
        missing.push(`${scope}.${name} (tier=${meta.tier})`);
      }
    }
  }
  assert.deepEqual(missing, [], `FIELDS 字段无 CLI 入口（漏配 flag）：\n  ${missing.join('\n  ')}`);
});

// 正向：抽样确认常用专属 flag 的 field 真进了 covered.fields。
test('anti-drift: common dedicated flags are registered as writable fields', () => {
  const covered = WRITABLE_FIELDS_COVERED();
  for (const f of [
    'title',
    'description',
    'type',
    'executor',
    'handle',
    'estimate',
    'references',
    'role',
    'justification',
    'artifact',
    'verified',
    'goal',
  ]) {
    assert.ok(covered.fields.has(f), `field ${f} covered`);
  }
});
