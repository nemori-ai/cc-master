// board-lint-remediation.test.ts — 每条 lint 诊断都要能自己说清补救动作。
//
// 背景：改这件事之前，153 个 emit 点里只有 24 个带「怎么修」，其余只报「什么不对」。
// 而那些缺失的修法在全仓的唯一陈述处，是 using-ccm 的规则速查表——一份要靠人锁步维护
// 的文档副本。副本会过期，接口不会；所以修法归引擎。
//
// 本文件是那道结构性的闸：新增一条规则却不给修法，这里立刻红。没有它，
// 「每条都带修法」只是这一次的状态，不是往后的性质。

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { INVARIANTS, RULE_REMEDIATION } from '../dist/index.mjs';

/** registry 里所有会真正报出来的规则（reserved 登记在册但 lint 不强制，不要求修法）。 */
function enforceableRuleIds(): string[] {
  return (INVARIANTS as ReadonlyArray<{ id: string; level: string }>)
    .filter((rule) => rule.level !== 'reserved')
    .map((rule) => rule.id)
    .sort();
}

test('每条可强制的规则都有兜底修法', () => {
  const missing = enforceableRuleIds().filter((id) => !RULE_REMEDIATION[id]);
  assert.deepEqual(
    missing,
    [],
    `这些规则报错时说不出怎么修，请在 board-lint-remediation.ts 补上：${missing.join(', ')}`,
  );
});

test('修法表不含已不存在的规则', () => {
  const known = new Set((INVARIANTS as ReadonlyArray<{ id: string }>).map((rule) => rule.id));
  const orphans = Object.keys(RULE_REMEDIATION).filter((id) => !known.has(id));
  assert.deepEqual(
    orphans,
    [],
    `修法表里这些规则码已从 registry 消失，删掉它们：${orphans.join(', ')}`,
  );
});

test('修法是可执行的动作，不是复述规则', () => {
  // 一条「怎么修」若只是把触发条件换个说法，读者拿它没有任何下一步动作。
  // 机械判据只能查形状：非空、够长到能承载一个动作、且不以「不允许 / 非法」这类
  // 纯陈述开头。品味仍靠人审，这里只挡住明显退化。
  const offenders: string[] = [];
  for (const [id, fix] of Object.entries(RULE_REMEDIATION)) {
    if (fix.trim().length < 8) offenders.push(`${id}（过短：${fix}）`);
    else if (/^(不允许|非法|禁止|错误)/.test(fix.trim()))
      offenders.push(`${id}（只陈述禁令，未给动作）`);
  }
  assert.deepEqual(offenders, [], `以下修法不构成可执行动作：\n  ${offenders.join('\n  ')}`);
});
