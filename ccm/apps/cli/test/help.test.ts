// help.test.ts — help 渲染层（help.ts）契约门。
//
// help.ts 导出 printHelp(out, registry, noun?, verb?) + printVersion(out)（技术栈契约 §二 help.js）。
//   本测试用真 registry，端到端验证三层帮助文本各含关键命令名 / flag / section 标题，并验 version 形如 x.y.z：
//     · 顶层（无 noun）：列全 namespace（含已升 live 的 account/usage/estimate）+ 别名 next/lint + GLOBAL FLAGS + EXIT CODES。
//     · noun 层：列该域全 verb（summary）+ USAGE + 例子。
//     · verb 层：USAGE / ARGUMENTS（有 positional 时）/ FLAGS（含 enum / required 标注）/ EXAMPLES。
//     · printVersion：'ccm <ver>'，<ver> 形如 \d+.\d+.\d+（读 apps/cli/package.json version）。
//
// T2a port 注：原 .mjs 经 createRequire 加载 CJS（cli/test/unit/help.test.mjs），改成正常 ESM import
//   ported .ts 源。registry 整模块当 { REGISTRY, ALIASES } 传给 printHelp（容忍整模块或裸 REGISTRY）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as help from '../src/help.js';
import * as registry from '../src/registry.js';

// 捕获 out 写：返回 { out, text() }。
function cap() {
  const buf: string[] = [];
  return { out: (s: string) => buf.push(s), text: () => buf.join('\n') };
}

// ══ printHelp 顶层（无 noun）══════════════════════════════════════════════════════════════════════
test('printHelp top-level lists all namespaces (incl now-live account/usage/estimate) + aliases + global flags', () => {
  const c = cap();
  help.printHelp(c.out, registry);
  const t = c.text();
  // 全 namespace 在（含已从 RESERVED 升为 live 的 account/usage/estimate·ADR-015/019）。
  for (const noun of [
    'board',
    'task',
    'log',
    'jc',
    'cadence',
    'watchdog',
    'account',
    'usage',
    'estimate',
  ]) {
    assert.ok(t.includes(noun), `top-level mentions namespace ${noun}`);
  }
  // account/usage/estimate 现是 live namespace（CORE NAMESPACES 带 blurb），不再列 RESERVED。
  assert.ok(!t.includes('RESERVED'), 'no RESERVED section (all placeholders now live)');
  assert.ok(t.includes('换号号池'), 'account namespace has a live blurb');
  // 别名 next / lint（command 级）+ viewer（namespace 级 NOUN_ALIASES → web-viewer）。
  assert.ok(t.includes('next'), 'mentions alias next');
  assert.ok(t.includes('lint'), 'mentions alias lint');
  assert.ok(t.includes('ALIASES'), 'has ALIASES section');
  assert.ok(
    /viewer\s+↔ ccm web-viewer/.test(t),
    'renders viewer namespace-alias row (↔ ccm web-viewer)',
  );
  // 全局 flag + 退出码。
  assert.ok(t.includes('GLOBAL FLAGS'), 'has GLOBAL FLAGS section');
  assert.ok(t.includes('--board'), 'lists --board global flag');
  assert.ok(t.includes('--dry-run'), 'lists --dry-run global flag');
  assert.ok(t.includes('--set'), 'lists --set global flag');
  assert.ok(t.includes('EXIT CODES'), 'has EXIT CODES section');
  assert.ok(t.includes('USAGE'), 'has USAGE section');
});

// 容忍传裸 REGISTRY（非整模块）也不崩。
test('printHelp top-level tolerates bare REGISTRY object', () => {
  const c = cap();
  help.printHelp(c.out, registry.REGISTRY);
  const t = c.text();
  assert.ok(t.includes('board'), 'bare REGISTRY still renders namespaces');
});

// ══ printHelp noun 层 ════════════════════════════════════════════════════════════════════════════
test('printHelp board lists all board verbs with summaries', () => {
  const c = cap();
  help.printHelp(c.out, registry, 'board');
  const t = c.text();
  assert.ok(t.includes('COMMANDS'), 'has COMMANDS section');
  for (const verb of ['show', 'lint', 'graph', 'critical-path', 'next', 'init', 'update']) {
    assert.ok(t.includes(verb), `board help lists verb ${verb}`);
  }
  assert.ok(t.includes('EXAMPLES'), 'board help has EXAMPLES');
  assert.ok(t.includes('GLOBAL FLAGS  见 ccm --help'), 'noun level references global flags');
});

test('printHelp task lists all task verbs (incl ls alias mark)', () => {
  const c = cap();
  help.printHelp(c.out, registry, 'task');
  const t = c.text();
  for (const verb of [
    'add',
    'show',
    'list',
    'update',
    'start',
    'done',
    'retry',
    'block',
    'set-status',
    'rm',
  ]) {
    assert.ok(t.includes(verb), `task help lists verb ${verb}`);
  }
  assert.ok(t.includes('(ls)'), 'task list shows (ls) alias mark');
});

// ══ printHelp verb 层 ════════════════════════════════════════════════════════════════════════════
test('printHelp task add shows USAGE/ARGUMENTS/FLAGS/EXAMPLES with id positional', () => {
  const c = cap();
  help.printHelp(c.out, registry, 'task', 'add');
  const t = c.text();
  assert.ok(t.includes('USAGE'), 'has USAGE');
  assert.ok(t.includes('ccm task add <id>'), 'usage line shows required positional <id>');
  assert.ok(t.includes('ARGUMENTS'), 'has ARGUMENTS (positional present)');
  assert.ok(t.includes('FLAGS'), 'has FLAGS');
  // 关键 flag 在。
  assert.ok(t.includes('--type'), 'lists --type flag');
  assert.ok(t.includes('--deps'), 'lists --deps flag');
  assert.ok(t.includes('--estimate'), 'lists --estimate flag');
  assert.ok(t.includes('--review-gate'), 'lists --review-gate flag');
  assert.ok(t.includes('EXAMPLES'), 'has EXAMPLES');
  // 例子原文（从 registry.examples 直出）。
  assert.ok(t.includes('ccm task add T7'), 'shows registry example verbatim');
});

test('printHelp verb level marks required flags in usage line', () => {
  const c = cap();
  help.printHelp(c.out, registry, 'watchdog', 'arm');
  const t = c.text();
  // --fire-at / --mechanism / --job-id 都是 required → 进 USAGE 行。
  assert.ok(t.includes('--fire-at'), 'usage/flags show --fire-at');
  assert.ok(t.includes('--mechanism'), 'usage/flags show --mechanism');
  assert.ok(t.includes('--job-id'), 'usage/flags show --job-id');
  assert.ok(/USAGE[\s\S]*--fire-at/.test(t), 'required --fire-at appears in usage line');
  assert.ok(/USAGE[\s\S]*--job-id/.test(t), 'required --job-id appears in usage line');
  assert.ok(t.includes('必填'), 'required flag tagged 必填');
});

test('printHelp verb level shows enum metavar for short enums, generic for long', () => {
  const c = cap();
  help.printHelp(c.out, registry, 'task', 'block');
  const t = c.text();
  // block 有 --on（required·非 enum·str）+ --decision（input）。
  assert.ok(t.includes('--on'), 'block lists --on');
  assert.ok(t.includes('--decision'), 'block lists --decision');

  // jc resolve 的 --status 是短 enum（upheld|overturned）→ 列全。
  const c2 = cap();
  help.printHelp(c2.out, registry, 'jc', 'resolve');
  const t2 = c2.text();
  assert.ok(t2.includes('upheld') && t2.includes('overturned'), 'short enum listed in metavar');
});

test('printHelp read verb with no positionals omits ARGUMENTS but keeps FLAGS', () => {
  const c = cap();
  help.printHelp(c.out, registry, 'board', 'show');
  const t = c.text();
  assert.ok(t.includes('USAGE'), 'has USAGE');
  assert.ok(!t.includes('ARGUMENTS'), 'no ARGUMENTS section (board show has no positionals)');
  assert.ok(t.includes('--json'), 'lists --json flag');
});

// 防御：未知 noun → 降级顶层；未知 verb → 降级 noun 层（不崩）。
test('printHelp degrades gracefully on unknown noun/verb', () => {
  const c1 = cap();
  help.printHelp(c1.out, registry, 'nonsense');
  assert.ok(c1.text().includes('CORE NAMESPACES'), 'unknown noun → top level');

  const c2 = cap();
  help.printHelp(c2.out, registry, 'board', 'nonsense');
  assert.ok(c2.text().includes('COMMANDS'), 'unknown verb → noun level');
});

// ══ printVersion ═════════════════════════════════════════════════════════════════════════════════
test('printVersion outputs "ccm <semver>" (GNU format)', () => {
  const c = cap();
  help.printVersion(c.out);
  const t = c.text();
  assert.ok(t.startsWith('ccm '), 'GNU format: program name then space then version');
  const ver = t.slice('ccm '.length);
  assert.match(ver, /^\d+\.\d+\.\d+/, 'version is semver-shaped');
});
