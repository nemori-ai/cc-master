import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOSTS = ['claude-code', 'codex', 'cursor'];
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

test('canonical allocation is role-first and consumes the cross-provider ccm read model', () => {
  const allocation = read(
    'plugin/src/skills/master-orchestrator-guide/canonical/references/model-allocation.md',
  );
  for (const role of ['`O`', '`T1`', '`T2`', '`T3`']) assert.match(allocation, new RegExp(role, 'u'));
  assert.match(allocation, /ccm model-policy show/u);
  assert.match(allocation, /设计[\s\S]*master-orchestrator[\s\S]*`O`/u);
  assert.match(allocation, /实现[\s\S]*`T1`/u);
  assert.match(allocation, /常规 review[\s\S]*异族[\s\S]*`T1`/u);
  assert.match(allocation, /高风险[\s\S]*异族[\s\S]*`O`/u);
  assert.match(allocation, /只读[\s\S]*`T2`/u);
  assert.match(allocation, /机械[\s\S]*`T3`/u);
  assert.match(allocation, /effect floor[\s\S]*价格[\s\S]*quota[\s\S]*latency[\s\S]*context[\s\S]*integration/u);
  assert.match(allocation, /taste[\s\S]*tie-break/u);
  assert.match(
    allocation,
    /`executor=master-orchestrator`[\s\S]*组织角色[\s\S]*`role_grade=O`[\s\S]*模型资格/u,
  );
  for (const failure of [
    'task-blocked',
    'policy',
    'security',
    'permission',
    'workspace',
  ]) assert.match(allocation, new RegExp(failure, 'u'));
  assert.doesNotMatch(allocation, /\{\{MASTER_HOST_MODEL_ALLOCATION\}\}/u);
});

test('origin-local model slots are removed while origin runtime mechanisms remain adapted', () => {
  for (const host of HOSTS) {
    const masterStrategy = read(
      `plugin/src/skills/master-orchestrator-guide/adapters/${host}/strategy.yaml`,
    );
    const pacingStrategy = read(
      `plugin/src/skills/pacing-and-estimation/adapters/${host}/strategy.yaml`,
    );
    assert.doesNotMatch(masterStrategy, /MASTER_HOST_MODEL_ALLOCATION/u, host);
    assert.doesNotMatch(pacingStrategy, /PACING_MODEL_TIERS_REFERENCE/u, host);
    assert.match(masterStrategy, /BACKGROUND_DISPATCH_MECHANISM_LIST/u, host);
    assert.match(pacingStrategy, /PACING_USAGE_SIGNALS_REFERENCE/u, host);
  }
});

test('using-ccm documents the model-policy read/advice commands and board role/fallback routing', () => {
  const catalog = read('plugin/src/skills/using-ccm/canonical/references/command-catalog.md');
  const board = read('plugin/src/skills/using-ccm/canonical/references/board-model-guide.md');
  for (const command of [
    'ccm model-policy show --task <task-taxonomy>',
    'ccm model-policy advise --input <json|@file|->',
  ]) assert.match(catalog, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.match(board, /quality\.effect_floor[\s\S]*`O \| T1 \| T2 \| T3`/u);
  assert.match(board, /chains\.ample[\s\S]*chains\.tight[\s\S]*effect floor/u);
  assert.match(board, /异族[\s\S]*review/u);
  assert.match(board, /community[\s\S]*registry revision[\s\S]*evidence refs/u);
});

test('all three rendered origins receive the same target model allocation and fact-consumption references', () => {
  const paths = [
    'skills/master-orchestrator-guide/references/model-allocation.md',
    'skills/pacing-and-estimation/references/model-tiers.md',
  ];
  for (const path of paths) {
    const rendered = HOSTS.map((host) => read(`plugin/dist/${host}/${path}`));
    assert.equal(rendered[1], rendered[0], `${path}: codex drift`);
    assert.equal(rendered[2], rendered[0], `${path}: cursor drift`);
  }
});

test('three-origin descriptions route one shared model policy while keeping mechanics origin-local', () => {
  for (const host of HOSTS) {
    const master = read(`plugin/dist/${host}/skills/master-orchestrator-guide/SKILL.md`);
    const pacing = read(`plugin/dist/${host}/skills/pacing-and-estimation/SKILL.md`);
    const using = read(`plugin/dist/${host}/skills/using-ccm/SKILL.md`);
    for (const body of [master, pacing, using]) {
      assert.match(body, /O\/T1\/T2\/T3/u, `${host}: shared role grades`);
    }
    assert.match(pacing, /model-policy/u, `${host}: pacing model-policy trigger`);
    assert.match(pacing, /(?:跨 provider 共享|三路统一)/u, `${host}: pacing global view`);
    assert.match(pacing, /usage[\s\S]*(?:origin|target)[\s\S]*(?:机制|证明)/u, `${host}: pacing local mechanics`);
    assert.match(using, /model-policy show\|advise/u, `${host}: ccm model-policy trigger`);
    assert.match(using, /(?:跨 provider 共享|三路统一)/u, `${host}: ccm global view`);
    assert.match(using, /(?:dispatch|usage)[\s\S]*(?:origin|target)[\s\S]*(?:机制|执行)/u, `${host}: ccm local mechanics`);
  }
});

test('the registered pressure baseline preserves task to role to candidate to fail-closed behavior', () => {
  const baseline = read(
    'design_docs/eval/2026-07-16-unified-model-routing-pressure-baseline.md',
  );
  for (const origin of HOSTS) assert.match(baseline, new RegExp(`\\b${origin}\\b`, 'u'));
  assert.match(baseline, /architecture-design[\s\S]*required role_grade=O/u);
  assert.match(baseline, /candidate[\s\S]*certified/u);
  for (const failure of [
    'task-blocked',
    'policy-blocked',
    'security-blocked',
    'permission-blocked',
    'workspace-mismatch',
  ]) assert.match(baseline, new RegExp(failure, 'u'));
  assert.match(baseline, /do not fall back to T1 and do not spawn/u);

  const guide = read('plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md');
  assert.match(guide, /`spawned=false`/u);
});
