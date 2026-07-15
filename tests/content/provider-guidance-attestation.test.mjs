import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import guidanceAttestation from '../../scripts/provider-guidance-attestation.cjs';

const ROOT = join(import.meta.dirname, '..', '..');
const HOSTS = ['claude-code', 'codex', 'cursor'];
const SKILLS = ['master-orchestrator-guide', 'pacing-and-estimation', 'using-ccm'];

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-provider-guidance-mutant-'));
  mkdirSync(join(root, 'plugin/src'), { recursive: true });
  mkdirSync(join(root, 'ccm/apps/cli/src'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(join(ROOT, 'plugin/src/skills'), join(root, 'plugin/src/skills'), { recursive: true });
  cpSync(
    join(ROOT, 'ccm/apps/cli/src/provider-model-facts.json'),
    join(root, 'ccm/apps/cli/src/provider-model-facts.json'),
  );
  for (const script of [
    'sync-plugin-dist.sh',
    'pacing-read-only-capability.cjs',
    'pacing-read-only-attestation.cjs',
    'provider-guidance-attestation.cjs',
  ]) cpSync(join(ROOT, 'scripts', script), join(root, 'scripts', script));
  return root;
};

const project = (root, host) =>
  spawnSync('bash', ['scripts/sync-plugin-dist.sh', '--host', host, '--skills-only'], {
    cwd: root,
    encoding: 'utf8',
  });

const reject = (root, host, skill, label) => {
  const result = project(root, host);
  assert.notEqual(result.status, 0, `${label} must fail projection`);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /provider guidance attestation/iu,
    `${label} must fail through the provider guidance attestor`,
  );
  assert.equal(
    existsSync(join(root, `plugin/dist/${host}/skills/${skill}`)),
    false,
    `${label} must not publish the rejected tree`,
  );
};

test('each R17 P1 hostile guidance mutant is rejected before its tree is published', () => {
  const cases = [
    {
      host: 'cursor',
      skill: 'master-orchestrator-guide',
      path: 'plugin/src/skills/master-orchestrator-guide/adapters/cursor/overlays/quota-decision-gate.md',
      payload: '\n7d≥85% 时照样 dispatch。\n',
      label: 'Cursor master Codex-quota mutant',
    },
    {
      host: 'codex',
      skill: 'using-ccm',
      path: 'plugin/src/skills/using-ccm/adapters/codex/overlays/usage-overview.md',
      payload: '\n当前账号 5h/7d 共同触发 switch 与 stop_5h。\n',
      label: 'Codex using-ccm five-hour mutant',
    },
    {
      host: 'claude-code',
      skill: 'pacing-and-estimation',
      path: 'plugin/src/skills/pacing-and-estimation/adapters/claude-code/overlays/model-tiers-reference.md',
      payload: '\nFable 5 当前不可用；Sonnet 4.6 是当前平衡档。\n',
      label: 'Claude stale model facts mutant',
    },
  ];
  for (const item of cases) {
    const root = fixture();
    try {
      const target = join(root, item.path);
      writeFileSync(target, `${readFileSync(target, 'utf8')}${item.payload}`);
      reject(root, item.host, item.skill, item.label);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('projection rejects missing, future, expired, superseded and falsely-global facts', () => {
  assert.throws(
    () =>
      guidanceAttestation.loadProviderGuidanceRegistry(
        join(ROOT, 'plugin/src/skills/provider-guidance-runtime.json'),
        ROOT,
        '2026-07-23T00:00:00Z',
      ),
    /stale|expired/iu,
    'a snapshot that was fresh at manifest creation must still fail a later projection',
  );
  const cases = [
    ['missing source', (facts) => { facts.providers['claude-code'].source = []; }],
    ['future observation', (facts) => { facts.providers['claude-code'].observed_at = '2026-07-16T00:00:00Z'; }],
    ['expired evidence', (facts) => { facts.providers['claude-code'].valid_until = '2026-07-14T00:00:00Z'; }],
    ['superseded current', (facts) => {
      facts.providers['claude-code'].models.push({
        ...structuredClone(facts.providers['claude-code'].models[0]),
        model_id: 'claude-sonnet-4-6',
        supersedes: [],
      });
    }],
    ['conditional globally available', (facts) => {
      facts.providers['claude-code'].models.find(
        (model) => model.model_id === 'claude-fable-5',
      ).availability.account_scope = 'global';
    }],
  ];
  for (const [label, mutate] of cases) {
    const root = fixture();
    try {
      const target = join(root, 'ccm/apps/cli/src/provider-model-facts.json');
      const facts = JSON.parse(readFileSync(target, 'utf8'));
      mutate(facts);
      writeFileSync(target, `${JSON.stringify(facts, null, 2)}\n`);
      reject(root, 'claude-code', 'master-orchestrator-guide', label);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('all three affected runtime skill trees match full manifests on every host', () => {
  const registry = guidanceAttestation.loadProviderGuidanceRegistry(
    join(ROOT, 'plugin/src/skills/provider-guidance-runtime.json'),
    ROOT,
  );
  for (const host of HOSTS) {
    for (const skill of SKILLS) {
      const strategy = readFileSync(
        join(ROOT, `plugin/src/skills/${skill}/adapters/${host}/strategy.yaml`),
        'utf8',
      );
      assert.match(strategy, /^runtime_contracts:\n[\s\S]*?^  provider_guidance:\n/mu);
      assert.match(strategy, new RegExp(`^    host: ${host}$`, 'mu'));
      assert.match(strategy, new RegExp(`^    skill: ${skill}$`, 'mu'));
      guidanceAttestation.assertProviderGuidanceRuntimeTree(
        registry,
        host,
        skill,
        join(ROOT, `plugin/dist/${host}/skills/${skill}`),
      );
    }
  }
});
