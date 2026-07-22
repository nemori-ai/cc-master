import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOSTS = ['claude-code', 'codex', 'cursor', 'kimi-code'];
const HISTORICAL_BASELINE_HOSTS = ['claude-code', 'codex', 'cursor'];
const MASTER_QUOTA_SLOTS = [
  'PACING_COST_RESPONSIBILITY',
  'PACING_BUDGET_STEWARDSHIP',
  'CAPACITY_ACCOUNT_GUIDANCE',
  'PACING_COMMAND_SUMMARY',
  'HOST_QUOTA_DESERTION_EXAMPLE',
  'HOST_QUOTA_RATIONALIZATION_ROW',
  'HOST_QUOTA_RED_FLAG',
  'HOST_QUOTA_DECISION_GATE',
  'HOST_QUOTA_JUDGMENT_ROW',
];
const MASTER_QUOTA_OVERLAYS = [
  'pacing-cost-responsibility.md',
  'pacing-budget-stewardship.md',
  'capacity-account-guidance.md',
  'pacing-command-summary.md',
  'quota-desertion-example.md',
  'quota-rationalization-row.md',
  'quota-red-flag.md',
  'quota-decision-gate.md',
  'quota-judgment-row.md',
];
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const require = createRequire(import.meta.url);
const { applySkillProjection, planSkillProjection } = require('../../scripts/project-skill.cjs');
const projectMaster = (host, relativePath) => {
  const staging = mkdtempSync(join(tmpdir(), `unified-model-${host}-`));
  try {
    const plan = planSkillProjection({
      repoRoot: ROOT,
      host,
      skill: 'master-orchestrator-guide',
    });
    applySkillProjection(plan, staging);
    return readFileSync(join(staging, relativePath), 'utf8');
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
};

test('canonical routing hub is role-first while allocation keeps only deeper capacity decisions', () => {
  const hub = read(
    'plugin/src/skills/master-orchestrator-guide/canonical/references/worker-routing.md',
  );
  const allocation = read(
    'plugin/src/skills/master-orchestrator-guide/canonical/references/model-allocation.md',
  );
  for (const role of ['`O`', '`T1`', '`T2`', '`T3`']) assert.match(hub, new RegExp(role, 'u'));
  assert.match(hub, /系统、架构[^\n]*`O`[^\n]*master-orchestrator/u);
  assert.match(hub, /完整 spec[\s\S]*`T1`/u);
  assert.match(hub, /常规异构 review[\s\S]*`T1`/u);
  assert.match(hub, /不可逆高风险[\s\S]*`O`/u);
  assert.match(hub, /只读研究[\s\S]*`T2`/u);
  assert.match(hub, /机械、确定性[\s\S]*`T3`/u);
  assert.match(hub, /cost[\s\S]*quota headroom[\s\S]*latency[\s\S]*context fit[\s\S]*integration cost/u);
  assert.match(hub, /taste[\s\S]*tie-break/u);
  assert.match(
    hub,
    /`executor=master-orchestrator`[\s\S]*组织角色[\s\S]*`effect_floor=O`[\s\S]*资格/u,
  );
  for (const failure of [
    'policy',
    'security',
    'permission',
    'workspace',
  ]) assert.match(hub, new RegExp(failure, 'u'));
  assert.match(allocation, /稳定的 `O \/ T1 \/ T2 \/ T3` floor[\s\S]*worker-routing\.md/u);
  assert.match(allocation, /容量收紧时按顺序决策/u);
  assert.doesNotMatch(hub, /\{\{MASTER_HOST_MODEL_ALLOCATION\}\}/u);

  const guide = read('plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md');
  assert.match(guide, /派发与选型唯一入口[\s\S]*worker-routing\.md/u);
  assert.doesNotMatch(guide, /ccm model-policy show --task <task-taxonomy>/u);
  assert.doesNotMatch(guide, /ccm model-policy advise --input <json\|@file\|->/u);
});

test('origin-local model and quota interpretation slots are removed while origin runtime mechanisms remain adapted', () => {
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
    assert.doesNotMatch(pacingStrategy, /PACING_USAGE_SIGNALS_REFERENCE|PACING_LEVERS_REFERENCE/u, host);
  }
});

test('master keeps capacity discipline but volatile provider windows stay in pacing facts', () => {
  const guide = read('plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md');
  const signals = read(
    'plugin/src/skills/pacing-and-estimation/canonical/references/usage-signals.md',
  );
  for (const slot of MASTER_QUOTA_SLOTS) {
    assert.doesNotMatch(guide, new RegExp(`\\{\\{${slot}\\}\\}`, 'u'), slot);
  }
  assert.match(guide, /ccm quota status --machine-wide --json/u);
  assert.match(guide, /selected target/u);
  assert.match(guide, /unknown[^\n]*stale[^\n]*missing[^\n]*fail closed/u);
  assert.doesNotMatch(guide, /Claude Code `claude-cli`|Codex `codex-cli`|cursor-ide-plugin/u);
  assert.match(signals, /Claude Code `claude-cli`[\s\S]*`five_hour` \+ `seven_day`/u);
  assert.match(signals, /Codex `codex-cli`[\s\S]*仅 `seven_day`/u);
  assert.match(signals, /cursor-ide-plugin[\s\S]*cursor-agent-cli[\s\S]*独立/u);
  for (const host of HOSTS) {
    const strategy = read(
      `plugin/src/skills/master-orchestrator-guide/adapters/${host}/strategy.yaml`,
    );
    for (const slot of MASTER_QUOTA_SLOTS) assert.doesNotMatch(strategy, new RegExp(slot, 'u'), host);
    for (const overlay of MASTER_QUOTA_OVERLAYS) {
      assert.equal(
        existsSync(
          join(
            ROOT,
            `plugin/src/skills/master-orchestrator-guide/adapters/${host}/overlays/${overlay}`,
          ),
        ),
        false,
        `${host}/${overlay} must stay removed`,
      );
    }

    const rendered = projectMaster(host, 'SKILL.md');
    assert.match(rendered, /ccm quota status --machine-wide --json/u, host);
    assert.match(rendered, /selected target/u, host);
    assert.doesNotMatch(rendered, /Claude Code `claude-cli`|Codex `codex-cli`|cursor-ide-plugin/u, host);
    for (const slot of MASTER_QUOTA_SLOTS) {
      assert.doesNotMatch(rendered, new RegExp(`\\{\\{${slot}\\}\\}`, 'u'), host);
    }
  }
});

test('all origins receive one machine-wide quota view and exact ccm quota contract', () => {
  const guide = read('plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md');
  const catalog = read('plugin/src/skills/using-ccm/canonical/references/command-catalog.md');
  const signals = read(
    'plugin/src/skills/pacing-and-estimation/canonical/references/usage-signals.md',
  );
  const levers = read(
    'plugin/src/skills/pacing-and-estimation/canonical/references/pacing-levers.md',
  );

  assert.match(guide, /ccm quota status --machine-wide --json/u);
  assert.match(catalog, /ccm quota refresh --machine-wide/u);
  assert.match(catalog, /ccm\/machine-quota-status\/v1/u);
  assert.match(catalog, /cached|缓存/u);
  assert.match(signals, /claude-cli[\s\S]*five_hour[\s\S]*seven_day/u);
  assert.match(signals, /codex-cli[\s\S]*仅 `seven_day`/u);
  assert.match(signals, /cursor-ide-plugin[\s\S]*cursor-agent-cli/u);
  assert.match(levers, /Codex 自动换号永久禁止/u);
  assert.match(levers, /Cursor 自动换号永久禁止/u);

  for (const host of HOSTS) {
    const usingStrategy = read(`plugin/src/skills/using-ccm/adapters/${host}/strategy.yaml`);
    assert.doesNotMatch(
      usingStrategy,
      /USING_CCM_USAGE_(?:NAMESPACE_ROW|OVERVIEW|SIGNAL_SOURCE|SHOW_|ADVISE_|BURN_RATE_|RUNWAY_)/u,
      host,
    );
  }
});

test('using-ccm pins capacity_views to the exact built CLI object schema', () => {
  const catalog = read('plugin/src/skills/using-ccm/canonical/references/command-catalog.md');
  const match = catalog.match(
    /`capacity_views` 的精确对象形状：\n\n\s*```json\n([\s\S]*?)\n\s*```/u,
  );
  assert.ok(match, 'capacity_views JSON example must remain parseable');
  const capacityViews = JSON.parse(match[1]);

  assert.deepEqual(Object.keys(capacityViews), [
    'schema',
    'known_capacities',
    'unresolved_scope_digests',
    'unresolved_capacity_units',
  ]);
  assert.equal(capacityViews.schema, 'ccm/machine-quota-capacity-views/v1');
  assert.ok(Array.isArray(capacityViews.known_capacities));
  assert.deepEqual(Object.keys(capacityViews.known_capacities[0]), [
    'quota_scope_digest',
    'capacity_units',
    'scope_digests',
  ]);
  assert.ok(Array.isArray(capacityViews.unresolved_scope_digests));
  assert.equal(capacityViews.unresolved_capacity_units, null);
  assert.match(catalog, /完整 CLI status 始终返回这个对象/u);
  assert.match(catalog, /hook \/ session 注入边界可以省略 `capacity_views`/u);
  assert.doesNotMatch(catalog, /capacity_views:\[\.\.\.\]/u);
});

test('using-ccm documents the model-policy read/advice commands and board role/fallback routing', () => {
  const catalog = read('plugin/src/skills/using-ccm/canonical/references/command-catalog.md');
  const board = read('plugin/src/skills/using-ccm/canonical/references/board-model-guide.md');
  for (const command of [
    'ccm model-policy show --task <task-taxonomy>',
    'ccm model-policy advise --input <json|@file|->',
  ]) assert.match(catalog, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.match(catalog, /`--role`、`--taxonomy`、`--require` 不是该命令的 flag/u);
  assert.match(board, /quality\.effect_floor[\s\S]*`O \| T1 \| T2 \| T3`/u);
  assert.match(board, /chains\.ample[\s\S]*chains\.tight[\s\S]*effect floor/u);
  assert.match(board, /异族[\s\S]*review/u);
  assert.match(board, /community[\s\S]*registry revision[\s\S]*evidence refs/u);
});

test('all four rendered origins receive the same target model allocation and fact-consumption references', () => {
  const paths = [
    'skills/master-orchestrator-guide/references/model-allocation.md',
    'skills/pacing-and-estimation/references/model-tiers.md',
  ];
  for (const path of paths) {
    const relativePath = path.replace('skills/master-orchestrator-guide/', '');
    const rendered = HOSTS.map((host) =>
      path.startsWith('skills/master-orchestrator-guide/')
        ? projectMaster(host, relativePath)
        : read(`plugin/dist/${host}/${path}`),
    );
    for (let index = 1; index < HOSTS.length; index += 1) {
      assert.equal(rendered[index], rendered[0], `${path}: ${HOSTS[index]} drift`);
    }
  }
});

test('four-origin descriptions route one shared model policy while keeping mechanics origin-local', () => {
  const pacingLocalBoundary = {
    'claude-code': /信号仍须绑定精确 surface/u,
    codex: /Codex 只把 7d 当 hard pacing 窗口[\s\S]*自动换号永久禁止/u,
    cursor: /Cursor IDE 与 Agent 必须分别绑定[\s\S]*自动换号永久禁止/u,
    'kimi-code': /kimi-code 的当前登录态 5h\/7d[\s\S]*无 non-blocking Stop pacing hook/u,
  };
  for (const host of HOSTS) {
    const master = projectMaster(host, 'SKILL.md');
    // Adapter descriptions are source truth. Dist/runtime hashes are guarded independently by the
    // attestation projection gate and may intentionally await the endpoint-wide regeneration step.
    const pacing = read(
      `plugin/src/skills/pacing-and-estimation/adapters/${host}/overlays/description.md`,
    );
    const using = read(`plugin/src/skills/using-ccm/adapters/${host}/overlays/description.md`);
    for (const body of [master, pacing, using]) {
      assert.match(body, /O\/T1\/T2\/T3/u, `${host}: shared role grades`);
    }
    assert.match(pacing, /model-policy/u, `${host}: pacing model-policy trigger`);
    assert.match(pacing, /(?:跨 provider 共享|四 provider 统一)/u, `${host}: pacing global view`);
    assert.match(pacing, pacingLocalBoundary[host], `${host}: pacing local mechanics`);
    assert.match(using, /model-policy show\|advise/u, `${host}: ccm model-policy trigger`);
    assert.match(using, /(?:跨 provider 共享|四 provider 统一)/u, `${host}: ccm global view`);
    assert.match(using, /(?:dispatch|usage)[\s\S]*(?:origin|target)[\s\S]*(?:机制|执行)/u, `${host}: ccm local mechanics`);
  }
});

test('the registered pressure baseline preserves task to role to candidate to fail-closed behavior', () => {
  const baseline = read(
    'design_docs/eval/2026-07-16-unified-model-routing-pressure-baseline.md',
  );
  for (const origin of HISTORICAL_BASELINE_HOSTS) {
    assert.match(baseline, new RegExp(`\\b${origin}\\b`, 'u'));
  }
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
  for (const trace of [
    '2026-07-16T11:08:30Z',
    'Claude Code `2.1.211` / `claude-fable-5`',
    '2026-07-16T11:10:20Z',
    'Codex `0.144.4` / `gpt-5.6-sol`',
    '2026-07-16T11:10:53Z',
    'Cursor Agent `2026.07.09-a3815c0` / first-party `cursor-grok-4.5-high`',
    '2026-07-16T11:22:42Z',
    'ccm model-policy show --task architecture-design --json',
    'owned_tree_survived',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'CURSOR_API_KEY',
  ]) assert.match(baseline, new RegExp(trace.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.match(baseline, /没有 API、BYOK、on-demand、第三方 Cursor model route 或自动账号切换/u);
  assert.match(baseline, /--role`、`--taxonomy` 或 `--require` flag/u);
  assert.match(baseline, /命令语法 RED 已关闭/u);
  assert.match(baseline, /整体压力场景[。\s\S]*PARTIAL/u);

  const catalog = read('plugin/src/skills/using-ccm/canonical/references/command-catalog.md');
  assert.match(catalog, /spawned[\s\S]*false/u);
});
