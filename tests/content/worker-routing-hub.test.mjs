import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');
const HOSTS = ['claude-code', 'codex', 'cursor', 'kimi-code'];
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const MASTER = 'plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md';
const HUB =
  'plugin/src/skills/master-orchestrator-guide/canonical/references/worker-routing.md';
const DISPATCH =
  'plugin/src/skills/master-orchestrator-guide/canonical/references/dispatch.md';
const ALLOCATION =
  'plugin/src/skills/master-orchestrator-guide/canonical/references/model-allocation.md';
const EVAL = 'design_docs/eval/routing-guidance-hub-workspace/iteration-1';
const require = createRequire(import.meta.url);
const { applySkillProjection, planSkillProjection } = require('../../scripts/project-skill.cjs');

const ORDERED_CHAIN = [
  'task shape',
  'executor',
  'target surface',
  'O/T1/T2/T3 effect floor',
  'exact qualification',
  'same-floor ranking / fallback',
  'real runtime handle',
  'endpoint verification',
];

test('the master skill preserves identity, red lines, seven lenses, and deterministic control loop', () => {
  const master = read(MASTER);
  for (const invariant of [
    '## ① 身份：你是谁',
    '### 你的底线',
    '### Rationalization Table',
    '### Red Flags',
    '### 七镜头',
    'digraph decision_program',
    'STOP: do NOT stop',
    'write the step-6 ledger first',
  ]) assert.match(master, new RegExp(invariant.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));

  for (const lens of [
    '指挥不演奏',
    '目标即依赖图',
    '就绪即发，绝不在 barrier 干等',
    '主观能动，不被动空等',
    '量力而行，不顶满',
    '只信端点验收',
    '该问就问',
  ]) assert.match(master, new RegExp(lens, 'u'));
});

test('fresh routing starts with one direct drill and the hub owns the complete ordered contract', () => {
  const master = read(MASTER);
  const hub = read(HUB);

  assert.match(master, /`worker-routing\.md`[^\n]*派发与选型唯一入口/u);
  assert.match(master, /准备派 worker 时直接 drill `references\/worker-routing\.md`/u);
  assert.doesNotMatch(master, /ccm harness list[\s\S]*ccm worker help[\s\S]*ccm model-policy show/u);

  const chainMatch = hub.match(/```text\n([\s\S]*?)```/u);
  assert.ok(chainMatch, 'missing ordered routing chain block');
  const chain = chainMatch[1];
  let previous = -1;
  for (const step of ORDERED_CHAIN) {
    const current = chain.indexOf(step);
    assert.ok(current > previous, `${step} must appear after the previous routing step`);
    previous = current;
  }

  assert.match(
    hub,
    /routing record 的输出字段也必须保持这一次序[\s\S]*不得把 `effect_floor` 提前到 `target_surface` 之前/u,
  );
  assert.match(
    hub,
    /`effect_floor`[^\n]*任务形状[^\n]*风险[^\n]*理由/u,
  );

  for (const heading of [
    '## 任务形状决定 executor',
    '## executor 不等于 target surface',
    '## workflow 是规划语义，不保证同名 runtime',
    '## 确定 effect floor',
    '## 做 exact qualification',
    '## 同档排序与 fallback',
    '## 拿到真实 handle 才算派发',
    '## 终端态之后做端点验收',
    '## 权威 owner 地图',
  ]) assert.match(hub, new RegExp(heading, 'u'));

  assert.match(hub, /candidate[^\n]*值得验证/u);
  assert.match(hub, /任一硬门没有证据[\s\S]*insufficient/u);
  assert.match(hub, /fallback 只沿同档/u);
  assert.match(hub, /没有 handle 或 link 的 `in_flight` 是幽灵任务/u);
  assert.match(hub, /runtime terminal[^\n]*不说明父 task 完成/u);
  assert.match(
    hub,
    /只是在回答或写 routing record[\s\S]*本页闭环[\s\S]*停止下钻/u,
  );
  assert.match(
    hub,
    /仅因场景含 fan-out \/ join[\s\S]*不得继续打开 `dispatch\.md`/u,
  );
  assert.match(
    hub,
    /仅需说明 terminal ≠ done[\s\S]*不得继续打开 `resume-verify\.md`/u,
  );
  assert.match(
    hub,
    /runtime 一旦停止[\s\S]*无论 artifact 后续能否通过验收[\s\S]*终结 agent 登记/u,
  );
  assert.match(hub, /验收失败[\s\S]*task 保持 active[\s\S]*retry 或 replan/u);
  assert.doesNotMatch(hub, /只有证据通过，才收口 agent 登记/u);
});

test('routing owners point inward without duplicating the volatile provider catalog', () => {
  const master = read(MASTER);
  const hub = read(HUB);
  const dispatch = read(DISPATCH);
  const allocation = read(ALLOCATION);

  assert.doesNotMatch(hub, /five_hour|seven_day|billing_period|claude-cli|codex-cli|cursor-ide-plugin/u);
  assert.doesNotMatch(master, /Claude Code `claude-cli`|Codex `codex-cli`|cursor-ide-plugin/u);
  assert.match(hub, /不要在本页或 board 复制 provider 型号、窗口、价格与 quota catalog/u);

  assert.match(dispatch, /完整顺序只有一份[：:][\s\S]*worker-routing\.md/u);
  assert.doesNotMatch(dispatch, /三种后台机制/u);
  assert.match(allocation, /稳定的 `O \/ T1 \/ T2 \/ T3` floor[\s\S]*只在[\s\S]*worker-routing\.md/u);
  assert.doesNotMatch(allocation, /\| 工作形态 \| 默认 effect floor/u);
});

test('new distributed routing prose stays Chinese, second-person, and free of repo-internal codes', () => {
  const paths = [
    HUB,
    ...HOSTS.map(
      (host) =>
        `plugin/src/skills/master-orchestrator-guide/adapters/${host}/overlays/workflow-runtime-semantics.md`,
    ),
  ];
  for (const path of paths) {
    const body = read(path);
    assert.match(body, /你/u, `${path}: second-person voice`);
    assert.match(body, /[\u3400-\u9fff]/u, `${path}: Chinese prose`);
    assert.doesNotMatch(body, /ADR-\d+|Finding\s*#?\d+|SKILL\s*[A-I]\b/u, path);
    assert.doesNotMatch(body, /plugin\/src|design_docs|issue\s*#?\d+/iu, path);
  }
});

test('Codex workflow planning versus runtime semantics has one user-facing owner', () => {
  const codexRoot = 'plugin/src/skills/master-orchestrator-guide/adapters/codex/overlays';
  const owner = read(`${codexRoot}/workflow-runtime-semantics.md`);
  assert.match(owner, /不支持 Claude Code Workflow runtime/u);
  assert.match(owner, /`executor=workflow`[^\n]*planning 责任/u);
  assert.match(owner, /Codex subagents[\s\S]*真实 handle/u);

  for (const file of [
    'authoring-workflows-row.md',
    'background-dispatch-executor-mapping.md',
    'dataflow-micro-scale-guidance.md',
    'executor-value-guidance.md',
  ]) {
    const pointer = read(`${codexRoot}/${file}`);
    assert.match(pointer, /routing hub|worker-routing\.md/u, file);
    assert.doesNotMatch(pointer, /不支持 Claude Code Workflow runtime|当前没有 Claude Code Workflow API/u, file);
  }
});

test('canonical links and named anchors used by the routing contract stay live', () => {
  const files = {
    hub: read(HUB),
    dispatch: read(DISPATCH),
    allocation: read(ALLOCATION),
    verify: read(
      'plugin/src/skills/master-orchestrator-guide/canonical/references/resume-verify.md',
    ),
  };
  const contracts = [
    [files.hub, 'dispatch.md#两个尺度上的-dataflow--为何这些高度是自相似的', files.dispatch, '## 两个尺度上的 dataflow —— 为何这些高度是自相似的'],
    [files.hub, 'model-allocation.md#容量收紧时按顺序决策', files.allocation, '## 容量收紧时按顺序决策'],
    [files.hub, 'resume-verify.md#3-端点验收--唯一可靠的正确性点', files.verify, '## 3. 端点验收 —— 唯一可靠的正确性点'],
    [files.dispatch, 'worker-routing.md#一条不可换序的路由链', files.hub, '## 一条不可换序的路由链'],
    [files.dispatch, 'worker-routing.md#做-exact-qualification', files.hub, '## 做 exact qualification'],
    [files.allocation, 'worker-routing.md#确定-effect-floor', files.hub, '## 确定 effect floor'],
    [files.allocation, 'worker-routing.md#同档排序与-fallback', files.hub, '## 同档排序与 fallback'],
  ];

  for (const [source, href, target, heading] of contracts) {
    assert.match(source, new RegExp(href.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'), href);
    assert.match(target, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'), heading);
  }
});

test('every host strategy resolves workflow runtime semantics through the projection SSOT', () => {
  const hostRuntime = {
    'claude-code': /支持 Claude Code 的 `Workflow` runtime/u,
    codex: /Codex adapter \*\*不支持 Claude Code Workflow runtime\*\*/u,
    cursor: /Cursor adapter \*\*不支持 Claude Code Workflow runtime\*\*/u,
    'kimi-code': /kimi-code adapter \*\*不支持 Claude Code Workflow runtime\*\*/u,
  };

  for (const host of HOSTS) {
    const strategy = read(
      `plugin/src/skills/master-orchestrator-guide/adapters/${host}/strategy.yaml`,
    );
    assert.match(strategy, /"\{\{WORKFLOW_RUNTIME_SEMANTICS\}\}"/u, host);
    const overlayPath =
      `plugin/src/skills/master-orchestrator-guide/adapters/${host}/overlays/workflow-runtime-semantics.md`;
    assert.equal(existsSync(join(ROOT, overlayPath)), true, overlayPath);

    const staging = mkdtempSync(join(tmpdir(), `worker-routing-${host}-`));
    try {
      const plan = planSkillProjection({
        repoRoot: ROOT,
        host,
        skill: 'master-orchestrator-guide',
      });
      applySkillProjection(plan, staging);
      const rendered = readFileSync(join(staging, 'references/worker-routing.md'), 'utf8');
      assert.match(rendered, hostRuntime[host], host);
      assert.doesNotMatch(rendered, /\{\{[A-Z0-9_]+\}\}/u, `${host}: unresolved slot`);
      for (const step of ['任务形状决定 executor', '确定 effect floor', '做 exact qualification', '拿到真实 handle', '端点验收']) {
        assert.match(rendered, new RegExp(step, 'u'), `${host}: ${step}`);
      }
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
});

test('manual user-directed Cursor T1 comparison records fresh runs, blinded judgments, and uplift', () => {
  const manifest = JSON.parse(read(`${EVAL}/arm-manifest.json`));
  const cases = JSON.parse(read(`${EVAL}/cases.json`));
  const graderPrompt = read(`${EVAL}/grader-prompt.md`);
  const rubric = JSON.parse(read(`${EVAL}/grader-rubric.json`));
  const results = JSON.parse(read(`${EVAL}/results.json`));
  const runbook = read(`${EVAL}/runbook.md`);
  const design = read(
    'plugin/src/skills/master-orchestrator-guide/.design/DESIGN.md',
  );
  const designSection = design.match(/### 2\.1 派发与模型路由 hub 增量诊断[\s\S]*?(?=\n## 3\.)/u)?.[0];
  assert.ok(designSection, 'missing routing-hub design amendment section');

  assert.equal(manifest.arms['without-hub'].hub_present, false);
  assert.equal(manifest.arms['with-hub'].required_first_drill.endsWith('worker-routing.md'), true);
  assert.equal(cases.cases.length, 3);
  assert.ok(cases.cases.some((entry) => entry.split === 'near-miss-holdout'));
  assert.equal(rubric.judge_requirement.provider_family, 'Cursor');
  assert.deepEqual(rubric.judge_requirement.pool_identity, {
    pool: 'first_party',
    model: 'Composer 2.5',
  });
  assert.deepEqual(rubric.judge_requirement.execution, {
    surface: 'Cursor Agent CLI',
    selector: 'composer-2.5',
    version: '2026.07.20-8cc9c0b',
    mode: 'ask',
  });
  assert.equal(rubric.judge_requirement.required_role_grade, 'T1');
  assert.equal(rubric.judge_requirement.qualification_status, 'manual-user-directed-qualified');
  assert.equal(rubric.judge_requirement.authorization.automatic_provider_certification_claim, false);
  assert.equal(rubric.assertions.filter((entry) => entry.load_bearing).length, 9);
  assert.equal(results.status, 'passed');
  assert.equal(results.heterogeneous_review.status, 'passed');
  assert.deepEqual(results.heterogeneous_review.judge_agent_ids, ['agt-064', 'agt-063', 'agt-066']);
  assert.equal(results.heterogeneous_review.cases.length, 3);
  assert.ok(results.heterogeneous_review.cases.every((entry) => entry.with_hub_pass === true));
  assert.deepEqual(
    results.heterogeneous_review.cases.map((entry) => entry.with_hub_reference_drills),
    [1, 1, 1],
  );
  assert.deepEqual(
    results.heterogeneous_review.cases.map((entry) => entry.without_hub_reference_drills),
    [2, 4, 4],
  );
  assert.equal(results.heterogeneous_review.uplift_claim, true);
  assert.equal(results.heterogeneous_review.automatic_provider_certification_claim, false);
  const fairPairs = [
    ['train-workflow-on-codex/without-hub/run-2.json', 'train-workflow-on-codex/with-hub/run-3.json'],
    ['train-candidate-is-not-qualified/without-hub/run-2.json', 'train-candidate-is-not-qualified/with-hub/run-2.json'],
    ['holdout-terminal-is-not-done/without-hub/run-2.json', 'holdout-terminal-is-not-done/with-hub/run-3.json'],
  ];
  for (const [withoutPath, withPath] of fairPairs) {
    const withoutRun = JSON.parse(read(`${EVAL}/runs/${withoutPath}`));
    const withRun = JSON.parse(read(`${EVAL}/runs/${withPath}`));
    assert.equal(withoutRun.prompt_contract_revision, 'fair-final-v1');
    assert.equal(withRun.prompt_contract_revision, withoutRun.prompt_contract_revision);
  }
  assert.match(graderPrompt, /manual user-directed/iu);
  assert.match(graderPrompt, /不要猜哪份答案来自哪个 arm/iu);
  assert.match(runbook, /manual user-directed/iu);
  assert.match(runbook, /每个 case、每个 arm 使用 fresh session/u);
  assert.match(runbook, /normalized capture/iu);
  assert.match(designSection, /3\/3[\s\S]*A1–A10/u);
  for (const artifact of [graderPrompt, JSON.stringify(rubric), JSON.stringify(results), runbook, designSection]) {
    assert.doesNotMatch(artifact, /kimi/iu);
    assert.doesNotMatch(artifact, /--model\s+auto|"selector"\s*:\s*"auto"/iu);
  }
});
