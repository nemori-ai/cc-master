// output-contract-conformance.test.ts — 声明的输出契约必须与真实输出一致。
//
// 这是 `--schema` 能成立的**唯一理由**。把 `data` 的形状从 using-ccm 的文档副本挪进
// registry，本身并不解决漂移——换个文件后缀不等于拿到 SSOT，那只是把副本从 markdown
// 换成了 TS。真正让它不过期的是这道闸：跑真命令、拿真输出对声明校验，声明与现实分家
// 就当场红。
//
// 诚实边界（同样写在 registry 的 OutputSchemaSpec 卷首）：
//   · 只校验 `data` 的**必有顶层键**，不校验类型、不穷举可选键。它抓「键被改名 / 被删」
//     这类最常见的漂移，抓不到类型变化。
//   · 只保证「声明了的必须真」，**不保证「该声明的都声明了」**——覆盖率靠另一条用例报告，
//     不靠一道假装全覆盖的闸。

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { REGISTRY } from '../src/registry.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ccm.cjs');

// 两种板状态。一条键若只在其中一态出现，它就不是「必有键」——单态验证会把
// 「这个状态下碰巧有」误判成「恒有」，声明出来仍是假 SSOT。两态都跑，过度声明当场红。
const STATES = ['empty', 'rich'] as const;
type State = (typeof STATES)[number];
const homes: Record<State, string> = { empty: '', rich: '' };

/** 在指定板状态下跑一条真命令，返回解析后的信封。 */
function run(state: State, args: string[]): { ok: boolean; data: unknown } {
  const out = execFileSync(process.execPath, [CLI, ...args, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, CC_MASTER_HOME: homes[state] },
  });
  return JSON.parse(out);
}

before(() => {
  for (const state of STATES) {
    const dir = mkdtempSync(join(tmpdir(), `ccm-contract-${state}-`));
    homes[state] = dir;
    const env = { ...process.env, CC_MASTER_HOME: dir };
    const q = (args: string[]) =>
      execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env });
    // board init --goal 已经立起 Goal Contract，再 goal set 会被拒（already active）。
    q(['board', 'init', '--goal', `output contract conformance probe (${state})`]);
    if (state === 'rich') {
      q(['task', 'add', 'T1', '--title', 'probe task', '--estimate', '2h']);
      q(['task', 'add', 'T2', '--title', 'downstream', '--deps', 'T1']);
      q(['task', 'start', 'T1']);
      q(['log', 'add', 'probe log', '--kind', 'note']);
    }
  }
});

after(() => {
  for (const dir of Object.values(homes)) if (dir) rmSync(dir, { recursive: true, force: true });
});

/** 声明了 outputSchema 的 verb（noun/verb/spec 三元组）。 */
function declared(): Array<{
  noun: string;
  verb: string;
  keys: readonly string[];
  array: boolean;
}> {
  const rows: Array<{ noun: string; verb: string; keys: readonly string[]; array: boolean }> = [];
  for (const [noun, verbs] of Object.entries(REGISTRY)) {
    for (const [verb, spec] of Object.entries(verbs)) {
      if (spec.outputSchema) {
        rows.push({
          noun,
          verb,
          keys: spec.outputSchema.keys,
          array: !!spec.outputSchema.array,
        });
      }
    }
  }
  return rows;
}

// 每条声明各跑一次真命令。用例参数化到 noun/verb，红的时候一眼看出是哪条契约漂了。
for (const row of declared()) {
  // 需要位置参数的 verb 在这里补上（种子板里 T1 必存在）。
  const positionals: Record<string, string[]> = { 'task show': ['T1'] };
  const key = `${row.noun} ${row.verb}`;
  for (const state of STATES) {
    // 需要位置参数的 verb 在空板上没有那个实体 → 合法空结果，nullable 分支会放行。
    test(`输出契约与真实输出一致：${key}（${state} 板）`, () => {
      const env = run(state, [row.noun, row.verb, ...(positionals[key] ?? [])]);
      assert.equal(env.ok, true, `${key} 应成功返回`);
      const payload = row.array
        ? (env.data as unknown[])
        : env.data === null
          ? null
          : [env.data as Record<string, unknown>];
      if (payload === null) return; // nullable 的合法空结果，不参与键校验
      assert.ok(Array.isArray(payload), `${key} 的 data 形状与 array 声明不符`);
      if (payload.length === 0) return; // 空数组：无元素可校验，不算违约
      for (const item of payload as Array<Record<string, unknown>>) {
        for (const k of row.keys) {
          assert.ok(
            Object.hasOwn(item, k),
            `${key} 声明必有键 "${k}"，真实输出里没有——声明与现实分家了，改声明或改实现`,
          );
        }
      }
    });
  }
}

test('覆盖率是报告，不是闸——只记录当前有多少 verb 声明了契约', () => {
  let total = 0;
  for (const verbs of Object.values(REGISTRY)) {
    for (const spec of Object.values(verbs)) if (spec.read) total += 1;
  }
  const n = declared().length;
  // 故意不设下限：设一个能过的下限等于给自己发通行证。这里只把数字打出来，
  // 让「迁移完成了吗」这个问题永远有一个当场可读的答案，而不是靠记忆。
  console.log(`[output-contract] 已声明 ${n} 条 / 只读 verb 共 ${total} 条`);
  assert.ok(n > 0, '至少要有一条声明，否则这道闸空转');
});
