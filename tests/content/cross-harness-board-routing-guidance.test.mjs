import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOSTS = ['claude-code', 'codex', 'cursor'];
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

function section(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing section start: ${start}`);
  const to = end ? text.indexOf(end, from + start.length) : text.length;
  assert.notEqual(to, -1, `missing section end: ${end}`);
  return text.slice(from, to);
}

function assertCurrentBoundary(text, label) {
  assert.match(
    text,
    /(?:planning\s*\/\s*routing[^\n]{0,120}opt-in|opt-in[^\n]{0,120}(?:planning\s*\/\s*ledger|board planning))[^\n]{0,120}不是自动派发器/iu,
    label,
  );
  assert.match(text, /set-routing[^。\n]*(?:不选|不选择)[^。\n]*(?:不 spawn|不派发)/isu, label);
  assert.match(text, /ccm worker help\/run[\s\S]{0,500}(?:没有自动接线|不会自动)/iu, label);
  assert.match(text, /legacy[\s\S]{0,300}(?:保持|继续)/iu, label);
}

test('using-ccm makes the opt-in cross-harness planning/routing ledger discoverable', () => {
  const skill = read('plugin/src/skills/using-ccm/canonical/SKILL.md');
  assert.match(skill, /ccm\/task-planning\/v1/u);
  assert.match(skill, /ccm\/agent-routing\/v1/u);
  assert.match(skill, /board-model-guide\.md[^\n]*§C\.5/u);
  for (const command of ['board enable-contract', 'task set-planning', 'task set-routing', 'task route-bind']) {
    assert.match(skill, new RegExp(command.replace(' ', '\\s+'), 'u'), command);
  }
  assertCurrentBoundary(skill, 'using-ccm SKILL boundary');
});

test('board-model guide covers planning dimensions, route chains, fallback and dedicated gates', () => {
  const guide = read('plugin/src/skills/using-ccm/canonical/references/board-model-guide.md');
  const contract = section(guide, '## C.5 cross-harness planning / routing 合同', '\n## D.');

  for (const dimension of [
    'reasoning',
    'uncertainty',
    'risk',
    'scope',
    'context',
    'coordination',
    'reversibility',
  ]) {
    assert.match(contract, new RegExp(`\\b${dimension}\\b`, 'u'), dimension);
  }
  for (const field of [
    'estimate_confidence',
    'quality.effect_floor',
    'budget.posture',
    'budget.max_attempts',
    'capabilities.required/preferred/forbidden',
  ]) {
    assert.match(contract, new RegExp(field.replace('.', '\\.').replace('/', '\\/'), 'u'), field);
  }
  for (const field of [
    'surface',
    'adapter',
    'harness',
    'provider',
    'model',
    'effort',
    'chains.ample',
    'chains.tight',
    'fallback.on',
    'fallback.never_on',
  ]) {
    assert.match(contract, new RegExp(field.replace('.', '\\.'), 'u'), field);
  }
  for (const invariant of [
    'FMT-CONTRACTS',
    'FMT-TASK-PLANNING',
    'FMT-TASK-ROUTING',
    'BIZ-ROUTED-PLANNING-REQUIRED',
    'BIZ-ROUTE-POLICY-REQUIRED',
    'BIZ-ROUTE-SELECTION-REQUIRED',
    'BIZ-ROUTE-ATTEMPT-REQUIRED',
  ]) {
    assert.match(guide, new RegExp(invariant, 'u'), invariant);
  }
  assert.match(contract, /已 enabled[\s\S]*set-planning[\s\S]*set-routing[\s\S]*executor subagent/iu);
  assert.match(contract, /route-bind[\s\S]*opaque running handle[\s\S]*syntactic claim/iu);
  assert.match(contract, /fallback\.on[\s\S]*transport-error/iu);
  assert.match(contract, /fallback\.never_on[\s\S]*acceptance-failed/iu);
  assertCurrentBoundary(contract, 'board-model guide boundary');
});

test('command catalog exposes every dedicated writer and does not claim runtime dispatch', () => {
  const catalog = read('plugin/src/skills/using-ccm/canonical/references/command-catalog.md');
  const cases = [
    ['### board enable-contract', '\n---', /ccm board enable-contract \[--preflight\] \[--json\]/u],
    ['### task set-planning', '\n### task set-routing', /ccm task set-planning <id> --profile <json\|@file\|-> \[--json\]/u],
    ['### task set-routing', '\n### task route-bind', /ccm task set-routing <id> --policy <json\|@file\|-> \[--json\]/u],
    ['### task route-bind', '\n### task native-attempt-create', /ccm task route-bind <id> --selection <json\|@file\|-> --attempt <json\|@file\|-> \[--json\]/u],
  ];
  for (const [start, end, syntax] of cases) {
    const body = section(catalog, start, end);
    assert.match(body, syntax, start);
    assert.match(body, /(?:不 spawn|不启动 worker|不派发|只读)/u, `${start}: runtime boundary`);
  }
  assert.match(catalog, /ccm\/routing-contract-preflight\/v1/u);
  assert.match(catalog, /generic[^。\n]*(?:setter|--set-json)[^。\n]*(?:不能|不可)/iu);
  assert.match(catalog, /同步 `ccm worker run`[^。\n]*不会自动/u);
});

test('command catalog gives an honest discovery-to-raw-dispatch hot path', () => {
  const catalog = read('plugin/src/skills/using-ccm/canonical/references/command-catalog.md');
  const hotPath = section(catalog, '## 跨 harness 主动查询目标事实', '\n---');

  for (const command of [
    'ccm harness list --machine-wide --json',
    'ccm worker help --harness <codex|claude-code|cursor-agent> --scope agent',
    'ccm provider facts <target-provider> --json',
    'ccm --harness <claude-code|codex|cursor> usage show --accounts current --json',
    'ccm quota status --json',
    'ccm quota preflight --input <json|@file|-> --json',
    'ccm route advise <task-id>',
    'ccm worker run --harness <codex|claude-code|cursor-agent>',
  ]) {
    assert.ok(hotPath.includes(command), command);
  }
  assert.match(hotPath, /route advise[\s\S]*spawned:false[\s\S]*不 reserve[\s\S]*不写 board/iu);
  assert.match(hotPath, /不存在[\s\S]*通用 `ccm quota \.\.\. --harness <X>`[\s\S]*unknown/iu);
  assert.match(hotPath, /quota preflight[\s\S]*只重验已有 authority evidence[\s\S]*不会现场查询/u);
  assert.match(hotPath, /worker run[\s\S]*origin harness[\s\S]*后台[\s\S]*handle/iu);
  assert.match(hotPath, /不会返回 running handle[\s\S]*ccm\/worker-process-result\/v1[\s\S]*不是 running handle/iu);
});

test('goal slicing points to using-ccm without cloning the routing schema', () => {
  const slicing = read('plugin/src/skills/slicing-goals-into-dags/canonical/SKILL.md');
  assert.match(slicing, /近期准备交给 agent[^\n]*可路由画像/u);
  assert.match(slicing, /using-ccm[^\n]*board-model-guide §C\.5/u);
  assert.doesNotMatch(slicing, /ccm\/task-planning\/v1|ccm\/agent-routing\/v1|task set-routing/u);
});

test('all three SAP strategies project the canonical routing guidance', () => {
  for (const host of HOSTS) {
    const strategy = read(`plugin/src/skills/using-ccm/adapters/${host}/strategy.yaml`);
    assert.match(strategy, /projection:\s*\n\s+source: canonical\//u, host);
    assert.doesNotMatch(strategy, /exclude(?:_canonical)?:[\s\S]*?(?:board-model-guide|command-catalog)\.md/u, host);
  }
});

test('all three rendered host skills carry the same board routing contract after projection', () => {
  for (const host of HOSTS) {
    const skill = read(`plugin/dist/${host}/skills/using-ccm/SKILL.md`);
    const guide = read(`plugin/dist/${host}/skills/using-ccm/references/board-model-guide.md`);
    const catalog = read(`plugin/dist/${host}/skills/using-ccm/references/command-catalog.md`);
    assert.match(skill, /ccm\/task-planning\/v1/u, host);
    assert.match(guide, /## C\.5 cross-harness planning \/ routing 合同/u, host);
    assert.match(catalog, /### board enable-contract/u, host);
    assert.match(catalog, /### task set-planning/u, host);
    assert.match(catalog, /### task set-routing/u, host);
    assert.match(catalog, /### task route-bind/u, host);
    assert.match(catalog, /ccm harness list --machine-wide --json/u, host);
    assert.match(catalog, /route advise[\s\S]*spawned:false/iu, host);
    assert.match(catalog, /不存在[\s\S]*通用 `ccm quota \.\.\. --harness <X>`/iu, host);
    assert.match(catalog, /后台 handle 来自 origin harness/u, host);
    assertCurrentBoundary(guide, `${host} boundary`);
  }
});
