import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import guidanceAttestation from '../../scripts/provider-guidance-attestation.cjs';
import { copyMinimalSkillKnowledgeRepo } from './helpers/skill-knowledge-isolated-repo.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const HOSTS = ['claude-code', 'codex', 'cursor', 'kimi-code'];
const SKILLS = ['master-orchestrator-guide', 'pacing-and-estimation', 'using-ccm'];

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-provider-guidance-mutant-'));
  copyMinimalSkillKnowledgeRepo(root);
  return root;
};

const project = (root, host) =>
  spawnSync('bash', ['scripts/sync-plugin-dist.sh', '--host', host, '--skills-only'], {
    cwd: root,
    encoding: 'utf8',
  });

const reject = (root, host, skill, label, mutantNeedle) => {
  const liveSkill = join(root, `plugin/dist/${host}/skills/${skill}`);
  const result = project(root, host);
  assert.notEqual(result.status, 0, `${label} must fail projection`);
  // Hostile mutations on knowledge-covered skills may fail closed at graph/overlay
  // before the attestation layer; either gate is acceptable so long as live publish
  // does not absorb the mutant payload.
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /provider guidance attestation|SKG-OVERLAY-GRAPH-UNAVAILABLE|final skill overlay failed|attestation|mismatch/iu,
    `${label} must fail closed before publish`,
  );
  if (mutantNeedle) {
    const walk = (directory) => {
      if (!existsSync(directory)) return false;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (walk(absolute)) return true;
          continue;
        }
        if (entry.isFile() && readFileSync(absolute, 'utf8').includes(mutantNeedle)) {
          return true;
        }
      }
      return false;
    };
    assert.equal(
      walk(liveSkill),
      false,
      `${label} must not publish the rejected mutant into live skills`,
    );
  }
};

test('each R17 P1 hostile guidance mutant is rejected before its tree is published', () => {
  const cases = [
    {
      host: 'cursor',
      skill: 'master-orchestrator-guide',
      path: 'plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md',
      payload: '\n7d≥85% 时照样 dispatch。\n',
      label: 'Cursor master Codex-quota mutant',
    },
    {
      host: 'codex',
      skill: 'using-ccm',
      path: 'plugin/src/skills/using-ccm/canonical/references/command-catalog.md',
      payload: '\n当前账号 5h/7d 共同触发 switch 与 stop_5h。\n',
      label: 'Codex using-ccm five-hour mutant',
    },
    {
      host: 'claude-code',
      skill: 'pacing-and-estimation',
      path: 'plugin/src/skills/pacing-and-estimation/canonical/references/model-tiers.md',
      payload: '\nFable 5 当前不可用；Sonnet 4.6 是当前平衡档。\n',
      label: 'Claude stale model facts mutant',
    },
  ];
  for (const item of cases) {
    const root = fixture();
    try {
      const target = join(root, item.path);
      writeFileSync(target, `${readFileSync(target, 'utf8')}${item.payload}`);
      reject(root, item.host, item.skill, item.label, item.payload.trim());
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
        '2026-07-30T00:00:00Z',
      ),
    /stale|expired/iu,
    'a snapshot that was fresh at manifest creation must still fail a later projection',
  );
  const cases = [
    ['missing source', (facts) => { facts.providers['claude-code'].source = []; }],
    ['future observation', (facts) => {
      facts.providers['claude-code'].observed_at = '2999-01-01T00:00:00Z';
      facts.providers['claude-code'].valid_until = '2999-01-02T00:00:00Z';
    }],
    ['expired evidence', (facts) => { facts.providers['claude-code'].valid_until = '2026-07-21T00:00:00Z'; }],
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
