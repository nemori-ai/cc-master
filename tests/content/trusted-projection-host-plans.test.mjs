import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PLAN_INVARIANTS,
  deriveProjectionScope,
  freezeProjectionPlan,
  freezeTrustedHostPolicy,
  projectionLockTarget,
} from '../../scripts/skill-knowledge/trusted-projection/host-plans.mjs';
import {
  canonicalHash,
  computeArtifactId,
  computeContentId,
  computeTreeSha256,
} from './helpers/trusted-projection/canonical-contract.mjs';
import { validateJsonSchema } from './helpers/trusted-projection/json-schema-validator.mjs';
import fs from 'node:fs';

const HOSTS = ['claude-code', 'codex', 'cursor', 'kimi-code'];

const SOURCE_FILES = Object.freeze([
  ['.claude-plugin/plugin.json', 'a'.repeat(64), 12, 0o644],
  ['.codex-plugin/plugin.json', 'b'.repeat(64), 12, 0o644],
  ['.cursor-plugin/plugin.json', 'c'.repeat(64), 12, 0o644],
  ['.kimi-plugin/plugin.json', 'd'.repeat(64), 12, 0o644],
  ['knowledge/portfolio.json', 'e'.repeat(64), 17, 0o644],
  ['skills/demo/SKILL.md', 'f'.repeat(64), 23, 0o644],
  ['skills/demo/adapters/claude-code/strategy.yaml', '1'.repeat(64), 9, 0o644],
  ['skills/demo/adapters/codex/strategy.yaml', '2'.repeat(64), 9, 0o644],
  ['skills/demo/adapters/cursor/strategy.yaml', '3'.repeat(64), 9, 0o644],
  ['skills/demo/adapters/kimi-code/strategy.yaml', '4'.repeat(64), 9, 0o644],
]);

function source(overrides = {}) {
  const files = (overrides.files ?? SOURCE_FILES)
    .map(([path, sha256, size, posix_mode]) => ({
      path,
      kind: 'file',
      sha256,
      size,
      executable: (posix_mode & 0o111) !== 0,
      posix_mode,
    }))
    .sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  const entriesByPath = new Map(files.map((entry) => [entry.path, entry]));
  const directories = new Set(['.']);
  for (const entry of files) {
    const segments = entry.path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join('/'));
    }
  }
  for (const directory of [...directories].sort(
    (left, right) => right.split('/').length - left.split('/').length,
  )) {
    const prefix = directory === '.' ? '' : `${directory}/`;
    const children = [...entriesByPath.values()]
      .filter(
        (entry) =>
          entry.path !== directory &&
          entry.path.startsWith(prefix) &&
          !entry.path.slice(prefix.length).includes('/'),
      )
      .sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
    entriesByPath.set(directory, {
      path: directory,
      kind: 'directory',
      sha256: canonicalHash('directory-entry', children),
      size: 0,
      executable: true,
      posix_mode: 0o755,
    });
  }
  const entries = [...entriesByPath.values()].sort((left, right) =>
    Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
  );
  const snapshot = {
    schema: 'cc-master/trusted-projection/source-snapshot/v1alpha1',
    transaction_id: overrides.transactionId ?? 'tpt:tx:host-plan-fixture',
    source_snapshot_id: '',
    source_content_id: computeContentId(entries),
    source_root_id: 'plugin-src',
    git_tree: null,
    mode_model: 'posix-12bit',
    entries,
    tree_sha256: computeTreeSha256(entries),
  };
  snapshot.source_snapshot_id = computeArtifactId('source-snapshot', snapshot);
  return snapshot;
}

function policy({
  crossSurfaceAction = 'expand',
  codexSkillTarget = 'skills/demo/SKILL.md',
  codexManifestTarget = '.codex-plugin/plugin.json',
  codexHostRules = null,
} = {}) {
  const manifestByHost = {
    'claude-code': '.claude-plugin/plugin.json',
    codex: '.codex-plugin/plugin.json',
    cursor: '.cursor-plugin/plugin.json',
    'kimi-code': '.kimi-plugin/plugin.json',
  };
  const declaration = {
    schema: 'cc-master/trusted-projection-host-policy/v1alpha1',
    directory_mode: 0o755,
    scope: {
      required_source_paths: [
        '.claude-plugin/plugin.json',
        '.codex-plugin/plugin.json',
        '.cursor-plugin/plugin.json',
        '.kimi-plugin/plugin.json',
        'skills/demo/SKILL.md',
      ],
      skills_safe_prefixes: ['skills/'],
      cross_surface_prefixes: ['knowledge/', 'adapters/', 'hooks/', 'commands/'],
      cross_surface_action: crossSurfaceAction,
    },
    hosts: Object.fromEntries(
      HOSTS.map((host) => [
        host,
        {
          host_rules:
            host === 'codex' && codexHostRules
              ? codexHostRules
              : [
                  {
                    operator: 'trusted.copy',
                    from: manifestByHost[host],
                    to:
                      host === 'kimi-code'
                        ? 'kimi.plugin.json'
                        : host === 'codex'
                          ? codexManifestTarget
                          : `${manifestByHost[host].split('/')[0]}/plugin.json`,
                  },
                  {
                    operator: 'trusted.copy',
                    from: 'skills/demo/SKILL.md',
                    to: host === 'codex' ? codexSkillTarget : 'skills/demo/SKILL.md',
                  },
                ],
          skills_rules: [
            {
              operator: 'trusted.copy',
              from: 'skills/demo/SKILL.md',
              to: 'skills/demo/SKILL.md',
            },
          ],
        },
      ]),
    ),
  };
  return freezeTrustedHostPolicy({
    id: 'policy.cc-master-host-plan-v1',
    declaration,
  });
}

function verifiedBase(sourceSnapshot, host = 'claude-code', liveDigest = '9'.repeat(64)) {
  return {
    schema: 'cc-master/trusted-projection-verified-base/v1alpha1',
    host,
    source_snapshot: sourceSnapshot,
    verified_source_content_id: sourceSnapshot.source_content_id,
    live_artifact_content_id: `tpt:content:${liveDigest}`,
  };
}

test('four hosts freeze deterministic typed plans with one P1-P8 vocabulary', () => {
  const schema = JSON.parse(
    fs.readFileSync(
      new URL(
        '../../design_docs/skill-knowledge-graph/schemas/trusted-projection-transaction.schema.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const snapshot = source();
  const plans = HOSTS.map((host) =>
    freezeProjectionPlan({
      sourceSnapshot: snapshot,
      host,
      scope: 'host',
      policy: policy(),
    }),
  );

  assert.deepEqual(PLAN_INVARIANTS, ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
  for (const [index, plan] of plans.entries()) {
    assert.equal(plan.host, HOSTS[index]);
    assert.equal(plan.surface, 'host');
    assert.match(plan.projection_plan_id, /^tpt:plan:[0-9a-f]{64}$/u);
    assert.equal(
      plan.projection_plan_id,
      computeArtifactId('projection-plan', plan),
      'production plan id must match the independent TX0 canonical oracle',
    );
    assert.deepEqual(validateJsonSchema(schema, plan, 'projectionPlan'), {
      ok: true,
      errors: [],
    });
    assert.deepEqual(Object.keys(plan), Object.keys(plans[0]));
    assert.deepEqual(
      plan.operations.map((operation) => Object.keys(operation)),
      plan.operations.map(() => ['operator', 'inputs', 'outputs', 'parameters_sha256']),
    );
    assert.equal(
      freezeProjectionPlan({
        sourceSnapshot: snapshot,
        host: HOSTS[index],
        scope: 'host',
        policy: policy(),
      }).projection_plan_id,
      plan.projection_plan_id,
    );
    assert.equal(
      plan.expected_entries.some((entry) => entry.path === 'knowledge' || entry.path.startsWith('knowledge/')),
      false,
    );
  }
});

test('all four hosts also freeze schema-valid skills plans on a verified full-host base', () => {
  const schema = JSON.parse(
    fs.readFileSync(
      new URL(
        '../../design_docs/skill-knowledge-graph/schemas/trusted-projection-transaction.schema.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const before = source({ transactionId: 'tpt:tx:skills-before' });
  const current = source({ transactionId: 'tpt:tx:skills-current' });
  for (const host of HOSTS) {
    const plan = freezeProjectionPlan({
      sourceSnapshot: current,
      host,
      scope: 'skills',
      policy: policy(),
      verifiedBase: verifiedBase(before, host),
    });
    assert.equal(plan.surface, 'skills');
    assert.deepEqual(validateJsonSchema(schema, plan, 'projectionPlan'), {
      ok: true,
      errors: [],
    });
    assert.deepEqual(
      plan.expected_entries
        .filter((entry) => entry.kind === 'file')
        .map((entry) => entry.path),
      ['skills/demo/SKILL.md'],
    );
  }
});

test('expected entries are source + trusted-policy derived and reject self-auth inputs', () => {
  const snapshot = source();
  const args = {
    sourceSnapshot: snapshot,
    host: 'codex',
    scope: 'host',
    policy: policy(),
  };
  const plan = freezeProjectionPlan(args);
  const drifted = source({
    files: SOURCE_FILES.map((entry) =>
      entry[0] === 'skills/demo/SKILL.md'
        ? [entry[0], '0'.repeat(64), entry[2], entry[3]]
        : entry,
    ),
  });
  const driftedPlan = freezeProjectionPlan({ ...args, sourceSnapshot: drifted });
  assert.notEqual(driftedPlan.projection_plan_id, plan.projection_plan_id);
  assert.notEqual(
    driftedPlan.expected_entries.find((entry) => entry.path === 'skills/demo/SKILL.md').sha256,
    plan.expected_entries.find((entry) => entry.path === 'skills/demo/SKILL.md').sha256,
  );
  const strategyDrift = policy({ codexSkillTarget: 'skills/demo-v2/SKILL.md' });
  const strategyPlan = freezeProjectionPlan({ ...args, policy: strategyDrift });
  assert.notEqual(strategyPlan.projection_plan_id, plan.projection_plan_id);
  assert.equal(
    strategyPlan.expected_entries.some((entry) => entry.path === 'skills/demo-v2/SKILL.md'),
    true,
  );
  const trustedTransform = policy({
    codexHostRules: [
      {
        operator: 'trusted.render',
        inputs: [
          '.codex-plugin/plugin.json',
          'skills/demo/adapters/codex/strategy.yaml',
        ],
        to: '.codex-plugin/plugin.json',
        expected: {
          sha256: '5'.repeat(64),
          size: 31,
          posix_mode: 0o644,
        },
      },
      {
        operator: 'trusted.copy',
        from: 'skills/demo/SKILL.md',
        to: 'skills/demo/SKILL.md',
      },
    ],
  });
  const transformedPlan = freezeProjectionPlan({ ...args, policy: trustedTransform });
  assert.deepEqual(
    transformedPlan.expected_entries.find(
      (entry) => entry.path === '.codex-plugin/plugin.json',
    ),
    {
      path: '.codex-plugin/plugin.json',
      kind: 'file',
      sha256: '5'.repeat(64),
      size: 31,
      executable: false,
      posix_mode: 0o644,
    },
  );
  assert.throws(
    () => freezeProjectionPlan({ ...args, candidateSnapshot: { expected_entries: [] } }),
    /TPT-PLAN-SELF-AUTH/u,
  );
  assert.throws(
    () =>
      freezeProjectionPlan({
        ...args,
        policy: {
          id: args.policy.id,
          declaration: structuredClone(args.policy.declaration),
        },
      }),
    /TPT-PLAN-UNTRUSTED-POLICY/u,
  );
  assert.throws(
    () =>
      freezeProjectionPlan({
        ...args,
        policy: policy({
          codexHostRules: [
            {
              operator: 'trusted.copy',
              from: 'skills/demo/SKILL.md',
              to: 'knowledge/forbidden.json',
            },
          ],
        }),
      }),
    /TPT-PLAN-KNOWLEDGE-EXCLUDED/u,
  );
  const escapingPolicy = policy({ codexManifestTarget: '../escape' });
  assert.throws(
    () => freezeProjectionPlan({ ...args, policy: escapingPolicy }),
    /TPT-ARTIFACT-UNSAFE/u,
  );
});

test('path controls, traversal, symlink and special entries fail closed', () => {
  for (const badPath of ['/absolute', '../escape', 'skills/\u0001bad']) {
    const unsafe = source();
    unsafe.entries = [
      ...unsafe.entries,
      {
        path: badPath,
        kind: 'file',
        sha256: 'a'.repeat(64),
        size: 1,
        executable: false,
        posix_mode: 0o644,
      },
    ].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
    assert.throws(
      () =>
        freezeProjectionPlan({
          sourceSnapshot: unsafe,
          host: 'cursor',
          scope: 'host',
          policy: policy(),
        }),
      /TPT-ARTIFACT-UNSAFE/u,
    );
  }
  for (const kind of ['symlink', 'fifo', 'socket', 'device', 'hardlink']) {
    assert.throws(
      () =>
        freezeProjectionPlan({
          sourceSnapshot: {
            ...source(),
            entries: [
              ...source().entries,
              {
                path: `unsafe-${kind}`,
                kind,
                sha256: 'a'.repeat(64),
                size: 1,
                executable: false,
                posix_mode: 0o644,
              },
            ],
          },
          host: 'cursor',
          scope: 'host',
          policy: policy(),
        }),
      /TPT-ARTIFACT-UNSAFE/u,
    );
  }
});

test('skills scope requires verified full-host base, serializes with full, and expands or fails closed', () => {
  const before = source({ transactionId: 'tpt:tx:before' });
  const unchanged = source({ transactionId: 'tpt:tx:after' });
  assert.throws(
    () =>
      deriveProjectionScope({
        sourceSnapshot: unchanged,
        host: 'claude-code',
        scope: 'skills',
        policy: policy(),
      }),
    /TPT-SKILLS-BASE-UNVERIFIED/u,
  );

  const scoped = deriveProjectionScope({
    sourceSnapshot: unchanged,
    host: 'claude-code',
    scope: 'skills',
    policy: policy(),
    verifiedBase: verifiedBase(before),
  });
  assert.equal(scoped.effective_surface, 'skills');
  assert.equal(
    projectionLockTarget({ host: 'claude-code', surface: 'host' }).lock_key,
    projectionLockTarget({ host: 'claude-code', surface: 'skills' }).lock_key,
  );

  const graphChanged = source({
    transactionId: 'tpt:tx:graph-change',
    files: SOURCE_FILES.map((entry) =>
      entry[0] === 'knowledge/portfolio.json'
        ? [entry[0], '8'.repeat(64), entry[2], entry[3]]
        : entry,
    ),
  });
  const expanded = deriveProjectionScope({
    sourceSnapshot: graphChanged,
    host: 'claude-code',
    scope: 'skills',
    policy: policy(),
    verifiedBase: verifiedBase(before),
  });
  assert.equal(expanded.effective_surface, 'host');
  assert.deepEqual(expanded.changed_paths, ['knowledge/portfolio.json']);

  const adapterChanged = source({
    transactionId: 'tpt:tx:adapter-change',
    files: [...SOURCE_FILES, ['adapters/origin.json', '7'.repeat(64), 5, 0o644]],
  });
  assert.equal(
    deriveProjectionScope({
      sourceSnapshot: adapterChanged,
      host: 'claude-code',
      scope: 'skills',
      policy: policy(),
      verifiedBase: verifiedBase(before),
    }).effective_surface,
    'host',
  );

  assert.throws(
    () =>
      deriveProjectionScope({
        sourceSnapshot: graphChanged,
        host: 'claude-code',
        scope: 'skills',
        policy: policy({ crossSurfaceAction: 'fail' }),
        verifiedBase: verifiedBase(before),
      }),
    /TPT-SKILLS-SCOPE-CROSS-SURFACE/u,
  );

  const scopedPlanA = freezeProjectionPlan({
    sourceSnapshot: unchanged,
    host: 'claude-code',
    scope: 'skills',
    policy: policy(),
    verifiedBase: verifiedBase(before, 'claude-code', '9'.repeat(64)),
  });
  const scopedPlanB = freezeProjectionPlan({
    sourceSnapshot: unchanged,
    host: 'claude-code',
    scope: 'skills',
    policy: policy(),
    verifiedBase: verifiedBase(before, 'claude-code', '6'.repeat(64)),
  });
  assert.notEqual(
    scopedPlanA.projection_plan_id,
    scopedPlanB.projection_plan_id,
    'verified live base must be cryptographically bound into a skills plan',
  );
});
