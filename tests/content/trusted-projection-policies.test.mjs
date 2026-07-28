import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  PRODUCT_HOSTS,
  freezeProjectionPlan,
} from '../../scripts/skill-knowledge/trusted-projection/host-plans.mjs';
import {
  REVIEWED_STRATEGIES_SCHEMA,
  buildRepositoryReviewedStrategies,
  deriveTrustedExpectedFiles,
  freezeTrustedProjectionPolicy,
} from '../../scripts/skill-knowledge/trusted-projection/policies.mjs';
import {
  canonicalHash,
  computeArtifactId,
  computeContentId,
  computeTreeSha256,
} from './helpers/trusted-projection/canonical-contract.mjs';
import { buildAndValidateGraph } from '../../scripts/skill-knowledge/graph.mjs';
import { buildHostArtifacts } from '../../scripts/skill-knowledge/compile/emit.mjs';
import { materializeRuntimeArtifacts } from '../../scripts/skill-knowledge/compile/skill-overlay.mjs';

const require = createRequire(import.meta.url);
const { scanTree } = require('../../scripts/skill-knowledge/trusted-projection/transaction.cjs');
const {
  applySkillProjection,
  planSkillProjection,
} = require('../../scripts/project-skill.cjs');

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const CONTENT = Object.freeze({
  '.claude-plugin/plugin.json': Buffer.from('{"host":"claude-code"}\n'),
  '.codex-plugin/plugin.json': Buffer.from('{"host":"codex"}\n'),
  '.cursor-plugin/plugin.json': Buffer.from('{"host":"cursor"}\n'),
  '.kimi-plugin/plugin.json': Buffer.from('{"host":"kimi-code","hooks":["old"]}\n'),
  'hooks/_hosts/kimi-code/hooks.fragment.json': Buffer.from(
    '{"hooks":[{"event":"BeforeTool"}]}\n',
  ),
  'skills/demo/canonical/SKILL.md': Buffer.from('# Demo\n'),
  ...Object.fromEntries(
    PRODUCT_HOSTS.map((host) => [
      `skills/demo/adapters/${host}/strategy.yaml`,
      Buffer.from(`mode: copy\nhost: ${host}\n`),
    ]),
  ),
});

function snapshot(overrides = {}) {
  const modeOverrides = overrides.modes ?? {};
  const content = { ...CONTENT, ...(overrides.content ?? {}) };
  const files = Object.entries(content)
    .map(([path, bytes]) => {
      const posix_mode = modeOverrides[path] ?? 0o644;
      return {
        path,
        kind: 'file',
        sha256: digest(bytes),
        size: bytes.length,
        executable: (posix_mode & 0o111) !== 0,
        posix_mode,
      };
    })
    .sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  const byPath = new Map(files.map((entry) => [entry.path, entry]));
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
    const children = [...byPath.values()]
      .filter(
        (entry) =>
          entry.path !== directory &&
          entry.path.startsWith(prefix) &&
          !entry.path.slice(prefix.length).includes('/'),
      )
      .sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
    byPath.set(directory, {
      path: directory,
      kind: 'directory',
      sha256: canonicalHash('directory-entry', children),
      size: 0,
      executable: true,
      posix_mode: 0o755,
    });
  }
  const entries = [...byPath.values()].sort((left, right) =>
    Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
  );
  const value = {
    schema: 'cc-master/trusted-projection/source-snapshot/v1alpha1',
    transaction_id: overrides.transactionId ?? 'tpt:tx:policy-fixture',
    source_snapshot_id: '',
    source_content_id: computeContentId(entries),
    source_root_id: 'plugin-src',
    git_tree: null,
    mode_model: 'posix-12bit',
    entries,
    tree_sha256: computeTreeSha256(entries),
  };
  value.source_snapshot_id = computeArtifactId('source-snapshot', value);
  return value;
}

function ref(sourceSnapshot, path) {
  const entry = sourceSnapshot.entries.find((candidate) => candidate.path === path);
  return {
    path,
    sha256: entry.sha256,
    size: entry.size,
    posix_mode: entry.posix_mode,
  };
}

function copyOutput(sourceSnapshot, host, source, path) {
  return {
    path,
    kind: 'file',
    producer: 'sap.copy',
    source_refs: [
      ref(sourceSnapshot, source),
      ref(sourceSnapshot, `skills/demo/adapters/${host}/strategy.yaml`),
    ],
    transform: {
      id: 'source-copy/v1',
      parameters: { source },
    },
  };
}

function reviewed(sourceSnapshot) {
  const manifest = {
    'claude-code': '.claude-plugin/plugin.json',
    codex: '.codex-plugin/plugin.json',
    cursor: '.cursor-plugin/plugin.json',
    'kimi-code': '.kimi-plugin/plugin.json',
  };
  return {
    schema: REVIEWED_STRATEGIES_SCHEMA,
    policy_id: 'policy.current-four-host-v1',
    directory_mode: 0o755,
    scope: {
      required_source_paths: Object.values(manifest),
      skills_safe_prefixes: ['skills/'],
      cross_surface_prefixes: ['commands/', 'hooks/', 'adapters/', 'knowledge/'],
      cross_surface_action: 'expand',
    },
    hosts: Object.fromEntries(
      PRODUCT_HOSTS.map((host) => [
        host,
        {
          host_outputs: [
            copyOutput(
              sourceSnapshot,
              host,
              manifest[host],
              host === 'kimi-code' ? 'kimi.plugin.source.json' : manifest[host],
            ),
            copyOutput(
              sourceSnapshot,
              host,
              'skills/demo/canonical/SKILL.md',
              'skills/demo/SKILL.md',
            ),
          ],
          skills_outputs: [
            copyOutput(
              sourceSnapshot,
              host,
              'skills/demo/canonical/SKILL.md',
              'skills/demo/SKILL.md',
            ),
          ],
        },
      ]),
    ),
  };
}

function args(sourceSnapshot = snapshot()) {
  return {
    sourceSnapshot,
    reviewedStrategies: reviewed(sourceSnapshot),
  };
}

test('four-host policy is host-plans branded, deterministic, exact, and provenance-bearing', () => {
  const input = args();
  const policy = freezeTrustedProjectionPolicy(input);
  const expected = deriveTrustedExpectedFiles(input);
  for (const host of PRODUCT_HOSTS) {
    const planA = freezeProjectionPlan({
      sourceSnapshot: input.sourceSnapshot,
      host,
      scope: 'host',
      policy,
    });
    const planB = freezeProjectionPlan({
      sourceSnapshot: input.sourceSnapshot,
      host,
      scope: 'host',
      policy: freezeTrustedProjectionPolicy(input),
    });
    assert.equal(planA.projection_plan_id, planB.projection_plan_id);
    assert.deepEqual(
      planA.expected_entries
        .filter((entry) => entry.kind === 'file')
        .map((entry) => entry.path),
      expected[host].host.map((entry) => entry.path),
    );
    assert.equal(expected[host].host.every((entry) => entry.producer === 'sap.copy'), true);
    assert.equal(
      expected[host].host.every(
        (entry) => entry.source_refs.length === 2 && entry.transform.id === 'source-copy/v1',
      ),
      true,
    );
  }
});

test('an injected legal source file is not promoted into the exact output set', () => {
  const injected = snapshot({
    content: { 'docs/legal-looking.md': Buffer.from('not runtime\n') },
  });
  const expected = deriveTrustedExpectedFiles({
    sourceSnapshot: injected,
    reviewedStrategies: reviewed(injected),
  });
  assert.equal(
    PRODUCT_HOSTS.some((host) =>
      expected[host].host.some((entry) => entry.path === 'docs/legal-looking.md'),
    ),
    false,
  );
});

test('reviewed content, mode, strategy, and source drift fail closed', () => {
  const frozen = snapshot();
  const declaration = reviewed(frozen);
  for (const changed of [
    snapshot({
      content: { 'skills/demo/canonical/SKILL.md': Buffer.from('# Rewritten\n') },
    }),
    snapshot({ modes: { 'skills/demo/canonical/SKILL.md': 0o755 } }),
    snapshot({
      content: {
        'skills/demo/adapters/codex/strategy.yaml': Buffer.from('mode: unsupported_stub\n'),
      },
    }),
  ]) {
    assert.throws(
      () =>
        freezeTrustedProjectionPolicy({
          sourceSnapshot: changed,
          reviewedStrategies: declaration,
        }),
      /TPT-POLICY-SOURCE-DRIFT/u,
    );
  }
});

test('unsafe, knowledge, and undeclared generated outputs fail closed', () => {
  const input = args();
  const mutate = (change) => {
    const declaration = structuredClone(input.reviewedStrategies);
    change(declaration.hosts.codex.host_outputs[0]);
    return () =>
      freezeTrustedProjectionPolicy({
        sourceSnapshot: input.sourceSnapshot,
        reviewedStrategies: declaration,
      });
  };
  assert.throws(mutate((output) => { output.path = '../escape'; }), /TPT-ARTIFACT-UNSAFE/u);
  assert.throws(
    mutate((output) => { output.path = 'knowledge/generated.md'; }),
    /TPT-PLAN-KNOWLEDGE-EXCLUDED/u,
  );
  assert.throws(
    mutate((output) => { output.transform.id = 'compiler-generated/v1'; }),
    /TPT-POLICY-TRANSFORM-UNDECLARED/u,
  );
  assert.throws(
    mutate((output) => {
      output.source_refs[0] = {
        ...output.source_refs[0],
        path: 'knowledge/portfolio.json',
      };
    }),
    /TPT-PLAN-KNOWLEDGE-EXCLUDED|TPT-POLICY-SOURCE-DRIFT/u,
  );
});

test('registered transforms reproduce bytes from snapshot-checked source only', () => {
  const sourceSnapshot = snapshot();
  const declaration = reviewed(sourceSnapshot);
  declaration.hosts['kimi-code'].host_outputs[0] = {
    path: 'kimi.plugin.json',
    kind: 'file',
    producer: 'phip.manifest',
    source_refs: [
      ref(sourceSnapshot, '.kimi-plugin/plugin.json'),
      ref(sourceSnapshot, 'hooks/_hosts/kimi-code/hooks.fragment.json'),
      ref(sourceSnapshot, 'skills/demo/adapters/kimi-code/strategy.yaml'),
    ],
    transform: {
      id: 'kimi-manifest/v1',
      parameters: {
        manifest: '.kimi-plugin/plugin.json',
        hooks_fragment: 'hooks/_hosts/kimi-code/hooks.fragment.json',
      },
    },
  };
  const expected = deriveTrustedExpectedFiles({
    sourceSnapshot,
    reviewedStrategies: declaration,
    sourceBytes: CONTENT,
  })['kimi-code'].host[0];
  const rendered = Buffer.from(
    `${JSON.stringify(
      { host: 'kimi-code', hooks: [{ event: 'BeforeTool' }] },
      null,
      2,
    )}\n`,
  );
  assert.equal(expected.sha256, digest(rendered));
  assert.equal(expected.size, rendered.length);
  assert.throws(
    () =>
      deriveTrustedExpectedFiles({
        sourceSnapshot,
        reviewedStrategies: declaration,
        sourceBytes: {
          ...CONTENT,
          '.kimi-plugin/plugin.json': Buffer.from('{}\n'),
        },
      }),
    /TPT-POLICY-SOURCE-DRIFT/u,
  );
});

test('candidate/live/archive self-authorization inputs are refused', () => {
  assert.throws(
    () => freezeTrustedProjectionPolicy({ ...args(), candidateSnapshot: {} }),
    /TPT-PLAN-SELF-AUTH/u,
  );
});

test('real frozen repository sources produce exact four-host branded plans without dist input', () => {
  const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
  const observation = scanTree(path.join(repoRoot, 'plugin/src'), 'repository-source');
  const directChildren = observation.entries.filter((entry) => !entry.path.includes('/'));
  const entries = [
    {
      path: '.',
      kind: 'directory',
      sha256: canonicalHash('directory-entry', directChildren),
      size: 0,
      executable: true,
      posix_mode: 0o755,
    },
    ...observation.entries,
  ];
  const sourceSnapshot = {
    schema: 'cc-master/trusted-projection/source-snapshot/v1alpha1',
    transaction_id: 'tpt:tx:real-repository-policy',
    source_snapshot_id: '',
    source_content_id: computeContentId(entries),
    source_root_id: 'plugin-src',
    git_tree: null,
    mode_model: 'posix-12bit',
    entries,
    tree_sha256: computeTreeSha256(entries),
  };
  sourceSnapshot.source_snapshot_id = computeArtifactId('source-snapshot', sourceSnapshot);
  const reviewedStrategies = buildRepositoryReviewedStrategies({
    repoRoot,
    sourceSnapshot,
  });
  const expected = deriveTrustedExpectedFiles({
    sourceSnapshot,
    reviewedStrategies,
  });
  const policy = freezeTrustedProjectionPolicy({
    sourceSnapshot,
    reviewedStrategies,
  });
  for (const host of PRODUCT_HOSTS) {
    const plan = freezeProjectionPlan({
      sourceSnapshot,
      host,
      scope: 'host',
      policy,
    });
    const files = plan.expected_entries.filter((entry) => entry.kind === 'file');
    assert.deepEqual(
      files.map(({ path: outputPath, sha256, size, posix_mode }) => ({
        path: outputPath,
        sha256,
        size,
        posix_mode,
      })),
      expected[host].host.map(({ path: outputPath, sha256, size, posix_mode }) => ({
        path: outputPath,
        sha256,
        size,
        posix_mode,
      })),
    );
    const requiredManifest =
      host === 'kimi-code' ? 'kimi.plugin.json' : `.${host.split('-')[0]}-plugin/plugin.json`;
    assert.equal(files.some((entry) => entry.path === requiredManifest), true);
    assert.equal(
      files.some(
        (entry) => entry.path === 'knowledge' || entry.path.startsWith('knowledge/'),
      ),
      false,
    );
    assert.equal(
      files.some((entry) => entry.path.includes('strategy.yaml')),
      false,
    );
  }
});

test('pure pre-compiler planner applies skill anchors to all eight compositions', () => {
  const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
  const built = buildAndValidateGraph({
    repoRoot,
    sourceRoot: 'plugin/src/knowledge',
  });
  assert.equal(built.ok, true);
  assert.equal(built.graph.skills.length, 8);
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-anchor-parity-'));
  try {
    for (const skill of built.graph.skills) {
      const slug = skill.id.replace(/^skill:/u, '');
      applySkillProjection(
        planSkillProjection({ repoRoot, host: 'claude-code', skill: slug }),
        path.join(stagingRoot, 'skills', slug),
      );
    }
    const artifacts = buildHostArtifacts({
      host: 'claude-code',
      graph: built.graph,
      repoRoot,
      hostDistAbsolute: stagingRoot,
    }).artifacts;
    for (const skill of built.graph.skills) {
      const slug = skill.id.replace(/^skill:/u, '');
      const runtimePath = `plugin/dist/claude-code/skills/${slug}/SKILL.md`;
      assert.match(
        artifacts.get(runtimePath),
        new RegExp(`^<a id="ccm-k-skill-${slug}"></a>\\n`, 'u'),
        runtimePath,
      );
    }
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
});

test('all four trusted runtime surfaces omit links to repo-only knowledge routers', () => {
  const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
  const built = buildAndValidateGraph({
    repoRoot,
    sourceRoot: 'plugin/src/knowledge',
  });
  assert.equal(built.ok, true);
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-runtime-links-'));
  try {
    for (const host of PRODUCT_HOSTS) {
      const hostRoot = path.join(stagingRoot, host);
      for (const skill of built.graph.skills) {
        const slug = skill.id.replace(/^skill:/u, '');
        applySkillProjection(
          planSkillProjection({ repoRoot, host, skill: slug }),
          path.join(hostRoot, 'skills', slug),
        );
      }
      const artifacts = materializeRuntimeArtifacts(
        buildHostArtifacts({
          host,
          graph: built.graph,
          repoRoot,
          hostDistAbsolute: hostRoot,
        }).artifacts,
        { host },
      );
      for (const [runtimePath, bytes] of artifacts) {
        if (runtimePath.startsWith(`plugin/dist/${host}/knowledge/`)) continue;
        assert.doesNotMatch(
          bytes,
          /\]\((?:\.\.\/)*knowledge\/(?:atlas\.md|modules\/)/u,
          `${host}: ${runtimePath} links to an unpublished knowledge router`,
        );
      }
    }
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
});
