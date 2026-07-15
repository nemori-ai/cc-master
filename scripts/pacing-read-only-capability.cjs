'use strict';

const fs = require('node:fs');
const {
  expectedPacingRenderedDigest,
  expectedPacingRuntimeManifest,
} = require('./pacing-read-only-attestation.cjs');

const SCHEMA = 'cc-master.pacing-read-only-capability.v2';
const SLOT = '{{PACING_READ_ONLY_CAPABILITY}}';
const OPERATIONS = [
  'read_and_interpret_ccm_advisory',
  'reference_model_registry',
  'handoff_decision_input',
];
const HOST_PROFILES = {
  'claude-code': 'claude-5h-7d',
  codex: 'codex-7d-rolling24h',
  cursor: 'cursor-billing-period',
};
const PROFILE_GUIDANCE = {
  'claude-5h-7d':
    '读取 5h / 7d 的 `hold`、`throttle`、`switch`、`stop_5h`、`stop_7d` 与 reset 事实；verdict 本身不是账号 mutation 授权。',
  'codex-7d-rolling24h':
    '只把当前账号 7d 当 hard ceiling，rolling-24h 只作过快消耗 advisory；历史或额外 `five_hour` / 5h 字段仅是 ignored provenance，不得触发 `throttle`、`switch`、`stop_5h`、reset 或 wakeup。Codex 自动换号永久禁止。',
  'cursor-billing-period':
    '读取 aggregate `billing_period` 的 `hold`、`throttle`、`stop_billing_period` 与 reset 事实；它不证明容量池拓扑，自动换号永久禁止。',
};
const ADVISORIES = {
  usage_advise: {
    command: 'ccm usage advise --json',
    interpretation: '读 `available`、`verdict`、`strength` 与 `nearest_reset`；不自行重算走廊。',
  },
  usage_show: {
    command: 'ccm usage show --json',
    interpretation: '读当前 host 已证明的窗口百分比与 reset 状态；缺失字段保持 unknown。',
  },
  usage_task_cost: {
    command: 'ccm usage task-cost <id> --json',
    interpretation: '读单任务可归因的 token / duration 事实；不要用账户 aggregate delta 反推节点成本。',
  },
  coordination_inbox_list: {
    command: 'ccm coordination inbox list --unconsumed --json',
    interpretation: '只读已经产出的 pool-aware own row 与通知；不存在或陈旧时保持不可判。',
  },
  estimate_forecast: {
    command: 'ccm estimate forecast --json',
    interpretation: '读 p50 / p80 / p95、`coverage_pct`、`confidence` 与区间宽度。',
  },
  estimate_evm: {
    command: 'ccm estimate evm --json',
    interpretation: '读 `has_baseline`、`spi_t` 与 `cpi`；`has_baseline:false` 时不制造计划事实。',
  },
  estimate_velocity: {
    command: 'ccm estimate velocity --json',
    interpretation: '读吞吐、backlog ETA 与 SLE 区间。',
  },
  estimate_risk: {
    command: 'ccm estimate risk --json',
    interpretation: '读 criticality、WIP aging 与 CCPM zone 等风险事实。',
  },
  estimate_cost_to_complete: {
    command: 'ccm estimate cost-to-complete --json',
    interpretation: '读剩余配额区间与 `available`，作为 usage × estimate 张力输入。',
  },
};
const REFERENCE_LABELS = {
  'references/model-tiers.md': '当前 host 的模型事实 registry：可用性、provenance、相对成本与能力边界。',
  'references/usage-signals.md': 'usage 信号源、窗口与诚实天花板。',
  'references/pacing-levers.md': 'verdict 与候选 lever 类的事实映射。',
  'references/estimation.md': 'estimate 字段、baseline-derived 事实与不确定性读法。',
  'references/pool-aware-advice.md': '已经产出的 own row 与 pool-aware 通知读法。',
};

const REGISTRY_KEYS = [
  'schema',
  'slot',
  'operations',
  'advisories',
  'model_registry',
  'references',
  'owners',
  'hosts',
];

function fail(message) {
  throw new Error(`pacing read-only capability: ${message}`);
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
}

function assertExactKeys(value, expected, label) {
  assertRecord(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label} keys must be exactly ${wanted.join(', ')}; got ${actual.join(', ')}`);
  }
}

function assertExactArray(value, expected, label) {
  if (!Array.isArray(value) || JSON.stringify(value) !== JSON.stringify(expected)) {
    fail(`${label} must be exactly ${JSON.stringify(expected)}`);
  }
}

function validatePacingReadOnlyRegistry(registry) {
  assertExactKeys(registry, REGISTRY_KEYS, 'registry');
  if (registry.schema !== SCHEMA) fail(`schema must be ${SCHEMA}`);
  if (registry.slot !== SLOT) fail(`slot must be ${SLOT}`);
  assertExactArray(registry.operations, OPERATIONS, 'operations');

  if (!Array.isArray(registry.advisories) || registry.advisories.length === 0) {
    fail('advisories must be a non-empty array');
  }
  if (new Set(registry.advisories).size !== registry.advisories.length) {
    fail('advisories must not contain duplicates');
  }
  for (const advisory of registry.advisories) {
    if (!Object.hasOwn(ADVISORIES, advisory)) fail(`unknown advisory id ${advisory}`);
  }

  if (registry.model_registry !== 'references/model-tiers.md') {
    fail('model_registry must be references/model-tiers.md');
  }
  assertExactArray(
    registry.references,
    [
      'references/usage-signals.md',
      'references/pacing-levers.md',
      'references/estimation.md',
      'references/pool-aware-advice.md',
    ],
    'references',
  );
  for (const reference of [registry.model_registry, ...registry.references]) {
    if (!Object.hasOwn(REFERENCE_LABELS, reference)) fail(`unknown reference ${reference}`);
  }

  assertExactKeys(registry.owners, ['command_and_mutation', 'decision'], 'owners');
  if (registry.owners.command_and_mutation !== 'using-ccm') {
    fail('command_and_mutation owner must be using-ccm');
  }
  if (registry.owners.decision !== 'master-orchestrator-guide') {
    fail('decision owner must be master-orchestrator-guide');
  }

  assertExactKeys(registry.hosts, Object.keys(HOST_PROFILES), 'hosts');
  for (const [host, profile] of Object.entries(HOST_PROFILES)) {
    assertExactKeys(
      registry.hosts[host],
      ['profile', 'rendered_body_sha256', 'rendered_runtime_manifest'],
      `hosts.${host}`,
    );
    if (registry.hosts[host].profile !== profile) {
      fail(`hosts.${host}.profile must be ${profile}`);
    }
    expectedPacingRenderedDigest(registry, host);
    expectedPacingRuntimeManifest(registry, host);
  }
  return registry;
}

function loadPacingReadOnlyRegistry(path) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`cannot read ${path}: ${error.message}`);
  }
  return validatePacingReadOnlyRegistry(parsed);
}

function renderPacingReadOnlyCapability(registry, host) {
  validatePacingReadOnlyRegistry(registry);
  if (!Object.hasOwn(HOST_PROFILES, host)) fail(`unsupported host ${host}`);
  const profile = registry.hosts[host].profile;
  const commandRows = registry.advisories.map((id) => {
    const advisory = ADVISORIES[id];
    return `| \`${advisory.command}\` | ${advisory.interpretation} |`;
  });
  const references = [registry.model_registry, ...registry.references].map(
    (path) => `- **[${path}](${path})** — ${REFERENCE_LABELS[path]}`,
  );

  return [
    '# pacing-and-estimation — 消费 ccm 只读 advisory 配速 + 估算',
    '',
    '> 这里只执行三类能力：读取并解释 ccm 已产生的 advisory；引用当前 host 的模型事实 registry；把整理后的决策输入交给 `master-orchestrator-guide`。',
    '',
    '## 封闭能力边界',
    '',
    '1. **读取并解释 advisory**：只消费 ccm 已返回的字段，不在这里产生或更新 board、baseline、coordination 或账号状态。',
    `2. **引用模型 registry**：只从 [${registry.model_registry}](${registry.model_registry}) 读取当前 host 已证明的可用性、provenance、能力与成本事实。`,
    `3. **交接决策输入**：只把 verdict、reset、不确定性、模型事实与来源整理给 \`${registry.owners.decision}\`；具体编排动作由它决定。`,
    '',
    `命令形状、flag 与任何状态 mutation 都查 \`${registry.owners.command_and_mutation}\`。前置事实不存在时保持 \`unknown\` / \`available:false\`，不要在这里补造。`,
    '',
    '## 当前 host 事实入口',
    '',
    `- **host**：\`${host}\``,
    `- **usage profile**：${PROFILE_GUIDANCE[profile]}`,
    `- **模型事实 registry**：[${registry.model_registry}](${registry.model_registry})`,
    '',
    '## 只读 advisory 速查',
    '',
    '| 命令 | 只读解释 |',
    '|---|---|',
    ...commandRows,
    '',
    '先读 `available`、provenance 与诚实字段。低覆盖、低置信或宽区间只会降低输入权重，不能被改写成确定承诺。命令的完整 flag、exit code 与 JSON schema 查 `using-ccm`；这里保留字段解释，不复算 ccm 引擎算法。',
    '',
    '## 交给决策层的最小输入',
    '',
    '- usage：`verdict`、`strength`、`nearest_reset`、窗口事实与信号来源。',
    '- estimate：p50 / p80 / p95、`coverage_pct`、`confidence`、conformal 区间、EVM 与风险字段。',
    '- pool-aware：只读已经产出的 own row、通知 freshness 与 pool identity 证据。',
    '- model：registry 中当前 host 已证明的可用性、provenance、能力与相对成本。',
    '',
    `把以上输入交给 \`${registry.owners.decision}\`；超出三类能力的具体编排动作一律归它决定。`,
    '',
    '## Pointers',
    '',
    ...references,
    '',
  ].join('\n');
}

function pacingCanonicalTemplateViolations(text, slot = SLOT) {
  const match = text.match(
    /^---\nname: pacing-and-estimation\ndescription: '\{\{PACING_DESCRIPTION\}\}'\n---\n\n([\s\S]*?)\n?$/u,
  );
  if (!match) return ['pacing template frontmatter is outside the closed grammar'];
  return match[1] === slot
    ? []
    : ['pacing template body contains prose outside the declared generated block'];
}

function assertPacingCanonicalTemplate(text, slot = SLOT) {
  const violations = pacingCanonicalTemplateViolations(text, slot);
  if (violations.length > 0) fail(violations.join('; '));
}

module.exports = {
  OPERATIONS,
  SCHEMA,
  SLOT,
  assertPacingCanonicalTemplate,
  loadPacingReadOnlyRegistry,
  pacingCanonicalTemplateViolations,
  renderPacingReadOnlyCapability,
  validatePacingReadOnlyRegistry,
};
