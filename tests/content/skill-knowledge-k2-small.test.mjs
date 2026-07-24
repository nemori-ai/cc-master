/**
 * K2-01 closed-set validation for four small runtime skill shards.
 *
 * Does NOT modify plugin/src/knowledge/portfolio.json (K2-05 integration).
 * Builds a temporary portfolio + entries over the four authored shards and
 * asserts schema / inventory / marker / authority / edge / authored hop budget.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const SKILLS = [
  'dev-as-ml-loop',
  'slicing-goals-into-dags',
  'pacing-and-estimation',
  'distilling-lessons-into-assets',
];

const ENTRY_BY_SKILL = {
  'dev-as-ml-loop': {
    id: 'entry:dev-as-ml-loop',
    module: 'module:devloop.core',
    point: 'point:devloop.objective',
    source_file: 'plugin/src/skills/dev-as-ml-loop/canonical/SKILL.md',
  },
  'slicing-goals-into-dags': {
    id: 'entry:slicing-goals-into-dags',
    module: 'module:slicing.vertical',
    point: 'point:slicing.vertical-rule',
    source_file: 'plugin/src/skills/slicing-goals-into-dags/canonical/SKILL.md',
  },
  'pacing-and-estimation': {
    id: 'entry:pacing-and-estimation',
    module: 'module:pacing.signals',
    point: 'point:pacing.machine-wide-first',
    // SKILL.md is a non_knowledge slot shell; bind entry to the primary signal surface.
    source_file:
      'plugin/src/skills/pacing-and-estimation/canonical/references/usage-signals.md',
  },
  'distilling-lessons-into-assets': {
    id: 'entry:distilling-lessons-into-assets',
    module: 'module:distill.routing',
    point: 'point:distill.routing-tree',
    source_file:
      'plugin/src/skills/distilling-lessons-into-assets/canonical/references/routing-decision-tree.md',
  },
};

async function loadDomain() {
  return {
    schema: await import('../../scripts/skill-knowledge/schema.mjs'),
    markers: await import('../../scripts/skill-knowledge/markers.mjs'),
    graph: await import('../../scripts/skill-knowledge/graph.mjs'),
  };
}

function gitCanonicalMarkdown(skill) {
  const result = spawnSync(
    'git',
    ['-c', 'core.quotepath=false', 'ls-files', '--', `plugin/src/skills/${skill}/canonical`],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.md'))
    .sort();
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
}

function writeJson(abs, value) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`);
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

/** Match loader displayPath: in-repo → relative posix; outside → absolute. */
function displayRepoPath(target) {
  const relative = path.relative(repoRoot, target);
  if (relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..') {
    return relative.split(path.sep).join('/');
  }
  return path.resolve(target);
}

function buildClosedSetSource() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-k2-small-'));
  const sourceRoot = path.join(tempRoot, 'knowledge');
  fs.mkdirSync(sourceRoot, { recursive: true });

  const skillRefs = [];
  const entries = [];

  for (const skill of SKILLS) {
    const from = path.join(repoRoot, 'plugin/src/knowledge/skills', skill);
    const to = path.join(sourceRoot, 'skills', skill);
    copyTree(from, to);

    // Rewrite module manifests to loader-visible paths (absolute when outside repo).
    const skillDoc = JSON.parse(fs.readFileSync(path.join(to, 'skill.json'), 'utf8'));
    for (const ref of skillDoc.modules) {
      const suffix = String(ref.manifest).replace(/^plugin\/src\/knowledge\//, '');
      ref.manifest = displayRepoPath(path.join(sourceRoot, suffix));
    }
    writeJson(path.join(to, 'skill.json'), skillDoc);

    skillRefs.push({
      id: `skill:${skill}`,
      manifest: displayRepoPath(path.join(to, 'skill.json')),
    });

    const entry = ENTRY_BY_SKILL[skill];
    const hosts = ['claude-code', 'codex', 'cursor', 'kimi-code'];
    entries.push({
      id: entry.id,
      label: `${skill} runtime entry`,
      recognition_cues: [`触发 ${skill}`, `${skill} 入口`],
      surfaces: hosts.map((host) => ({
        host,
        source_file: entry.source_file,
        binding: { kind: 'marker', value: entry.point },
        surface_kind: 'skill_entry',
        targets: [
          {
            skill: `skill:${skill}`,
            module: entry.module,
            point: entry.point,
          },
        ],
        lifecycle: { state: 'accepted', since: '2026-07-24' },
      })),
      lifecycle: { state: 'accepted', since: '2026-07-24' },
      admission: {
        evidence: [
          {
            kind: 'canonical-prose',
            ref: entry.source_file,
          },
        ],
        verifiers: [{ kind: 'review', ref: `k2-small.entry.${skill}` }],
      },
    });
  }

  writeJson(path.join(sourceRoot, 'portfolio.json'), {
    schema_version: 'cc-master/skill-knowledge-source/v1alpha1',
    kind: 'portfolio',
    id: 'portfolio:k2-small-closed-set',
    runtime_hosts: ['claude-code', 'codex', 'cursor', 'kimi-code'],
    skills: skillRefs,
    entries,
    hop_policy: {
      point_diameter_max: 3,
      entry_discovery_max: 3,
      critical_entry_to_primary_max: 1,
      critical_any_point_to_primary_max: 2,
      primary_entry_to_primary_max: 2,
    },
    critical_pin_budget: {
      max_modules: 4,
      max_fraction: 0.5,
    },
    router_budget: {
      atlas_max_lines: 120,
      atlas_max_tokens: 1800,
      module_max_lines: 80,
      module_max_tokens: 1200,
      point_nav_max_lines: 4,
    },
    rollout: 'K1',
  });

  return { tempRoot, sourceRoot };
}

test('SKG-K2-SMALL-01: git denominator equals inventory for each of four skills', () => {
  for (const skill of SKILLS) {
    const denominator = gitCanonicalMarkdown(skill);
    assert.ok(denominator.length > 0, skill);
    const skillDoc = readJson(`plugin/src/knowledge/skills/${skill}/skill.json`);
    const inventoryPaths = skillDoc.canonical_source_inventory.map((entry) => entry.path).sort();
    assert.deepEqual(inventoryPaths, denominator, skill);
    for (const entry of skillDoc.canonical_source_inventory) {
      assert.notEqual(entry.coverage, 'partial', `${entry.path} must not be partial at K2`);
      if (entry.coverage === 'full') {
        assert.ok(entry.point_ids.length > 0, `${entry.path} full needs points`);
      }
    }
  }
});

test('SKG-K2-SMALL-02: standalone schema accepts every authored shard', async () => {
  const { schema } = await loadDomain();
  assert.equal(schema.validatorsAvailable(), true);

  for (const skill of SKILLS) {
    const skillDoc = readJson(`plugin/src/knowledge/skills/${skill}/skill.json`);
    const skillResult = schema.validateAuthoredDocument(skillDoc, 'source');
    assert.equal(skillResult.ok, true, `${skill} skill.json: ${JSON.stringify(skillResult.errors)}`);

    for (const ref of skillDoc.modules) {
      const moduleDoc = readJson(ref.manifest);
      const moduleResult = schema.validateAuthoredDocument(moduleDoc, 'source');
      assert.equal(
        moduleResult.ok,
        true,
        `${ref.manifest}: ${JSON.stringify(moduleResult.errors)}`,
      );
    }
  }
});

test('SKG-K2-SMALL-03: markers bind uniquely to declared binding.path', async () => {
  const { markers } = await loadDomain();
  const seen = new Map();

  for (const skill of SKILLS) {
    const skillDoc = readJson(`plugin/src/knowledge/skills/${skill}/skill.json`);
    for (const ref of skillDoc.modules) {
      const moduleDoc = readJson(ref.manifest);
      for (const point of moduleDoc.points) {
        const text = fs.readFileSync(path.join(repoRoot, point.binding.path), 'utf8');
        const extracted = markers.extractMarkers(text, point.binding.path);
        assert.equal(extracted.ok, true, point.binding.path);
        const span = extracted.spans.find((item) => item.point_id === point.id);
        assert.ok(span, `missing marker ${point.id} in ${point.binding.path}`);
        assert.equal(point.binding.marker, point.id);
        assert.equal(seen.has(point.id), false, `duplicate point id ${point.id}`);
        seen.set(point.id, point.binding.path);
      }
    }

    for (const entry of skillDoc.canonical_source_inventory) {
      const text = fs.readFileSync(path.join(repoRoot, entry.path), 'utf8');
      const extracted = markers.extractMarkers(text, entry.path);
      assert.equal(extracted.ok, true, entry.path);
      const markerIds = extracted.spans.map((span) => span.point_id).sort();
      assert.deepEqual(markerIds, [...entry.point_ids].sort(), entry.path);
    }
  }
});

test('SKG-K2-SMALL-04: closed-set graph invariants + authored hop budgets', async () => {
  const { graph } = await loadDomain();
  const { tempRoot, sourceRoot } = buildClosedSetSource();
  try {
    const built = graph.buildAndValidateGraph({
      repoRoot,
      sourceRoot: path.relative(repoRoot, sourceRoot).split(path.sep).join('/'),
    });
    assert.equal(
      built.ok,
      true,
      JSON.stringify(
        built.diagnostics.filter((item) => item.severity === 'error'),
        null,
        2,
      ),
    );
    assert.equal(built.graph.counts.skill, 4);
    assert.ok(built.graph.counts.module >= 12);
    assert.ok(built.graph.counts.point >= 40);
    assert.equal(built.graph.counts.entry, 4);

    // No partial debt in this closed set.
    assert.equal(
      built.diagnostics.some((item) => item.code === 'SKG-COVERAGE-PARTIAL'),
      false,
    );

    const hopPolicy = built.graph.portfolio.hop_policy;
    const primaryByModule = new Map(
      built.graph.modules.map((module) => [module.id, module.access?.primary_points ?? []]),
    );

    for (const entry of built.graph.entries) {
      for (const surface of entry.surfaces ?? []) {
        for (const target of surface.targets ?? []) {
          const primaryPoints = primaryByModule.get(target.module) ?? [];
          assert.ok(primaryPoints.includes(target.point), `${entry.id} target not primary`);

          // Entry discovery: entry target counts as 0 authored hops to itself.
          const toPrimary = graph.shortestPath(built.graph, target.point, target.point);
          assert.equal(toPrimary.reachable, true);
          assert.equal(toPrimary.hops, 0);

          const module = built.graph.modules.find((item) => item.id === target.module);
          const max =
            module?.access?.class === 'critical'
              ? hopPolicy.critical_entry_to_primary_max
              : hopPolicy.primary_entry_to_primary_max;
          // Seed is the targeted primary point; hop from seed to each primary is 0.
          for (const primary of primaryPoints) {
            const pathResult = graph.shortestPath(built.graph, target.point, primary);
            assert.equal(pathResult.reachable, true, `${entry.id} → ${primary}`);
            assert.ok(
              pathResult.hops <= max,
              `${entry.id} → ${primary} hops ${pathResult.hops} > ${max}`,
            );
          }
        }
      }
    }

    // Critical primary reachability from any point in the same skill ≤ 2.
    for (const module of built.graph.modules) {
      if (module.access?.class !== 'critical') continue;
      const skillId = module.owner_skill;
      const skillPoints = built.graph.points.filter((point) => point.owner_skill === skillId);
      for (const primary of module.access.primary_points) {
        for (const point of skillPoints) {
          const pathResult = graph.shortestPath(built.graph, point.id, primary);
          assert.equal(
            pathResult.reachable,
            true,
            `${point.id} → critical ${primary} unreachable`,
          );
          assert.ok(
            pathResult.hops <= hopPolicy.critical_any_point_to_primary_max,
            `${point.id} → ${primary} hops ${pathResult.hops}`,
          );
        }
      }
    }

    // Authored plane: every point reaches its skill hub (entry primary) within
    // entry_discovery_max. Full point↔point diameter is a final-host H2 concern
    // that depends on compiler atlas/router edges (K2-05 portfolio integration).
    for (const skill of SKILLS) {
      const skillId = `skill:${skill}`;
      const hub = ENTRY_BY_SKILL[skill].point;
      const points = built.graph.points.filter((point) => point.owner_skill === skillId);
      for (const point of points) {
        const pathResult = graph.shortestPath(built.graph, point.id, hub);
        assert.equal(
          pathResult.reachable,
          true,
          `${point.id} → hub ${hub} unreachable inside ${skill}`,
        );
        assert.ok(
          pathResult.hops <= hopPolicy.entry_discovery_max,
          `${point.id} → hub ${hub} hops ${pathResult.hops}`,
        );
      }
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('SKG-K2-SMALL-05: host_coverage mirrors copy strategies (all full)', () => {
  for (const skill of SKILLS) {
    const skillDoc = readJson(`plugin/src/knowledge/skills/${skill}/skill.json`);
    assert.equal(skillDoc.host_coverage.length, 4);
    for (const host of ['claude-code', 'codex', 'cursor', 'kimi-code']) {
      const row = skillDoc.host_coverage.find((item) => item.host === host);
      assert.ok(row, `${skill} missing ${host}`);
      assert.equal(row.state, 'full', `${skill} ${host}`);
      const strategyPath = path.join(
        repoRoot,
        'plugin/src/skills',
        skill,
        'adapters',
        host,
        'strategy.yaml',
      );
      assert.equal(fs.existsSync(strategyPath), true, strategyPath);
      const yaml = fs.readFileSync(strategyPath, 'utf8');
      assert.match(yaml, /copy:\s*true|mode:\s*copy/);
    }
  }
});

test('SKG-K2-SMALL-06: enabled edges have unique (type, from, to) across four shards', () => {
  /** @type {Map<string, string[]>} */
  const seen = new Map();
  for (const skill of SKILLS) {
    const skillDoc = readJson(`plugin/src/knowledge/skills/${skill}/skill.json`);
    for (const ref of skillDoc.modules) {
      const moduleDoc = readJson(ref.manifest);
      for (const edge of moduleDoc.edges ?? []) {
        if (edge.runtime?.enabled_by_default === false) continue;
        const key = `${edge.type}\0${edge.from}\0${edge.to}`;
        const owners = seen.get(key) ?? [];
        owners.push(`${edge.id}@${ref.manifest}`);
        seen.set(key, owners);
      }
    }
  }
  const duplicates = [...seen.entries()].filter(([, owners]) => owners.length > 1);
  assert.deepEqual(
    duplicates,
    [],
    `duplicate enabled navigation tuples:\n${duplicates
      .map(([key, owners]) => `${key.replaceAll('\0', ' → ')} :: ${owners.join(' | ')}`)
      .join('\n')}`,
  );
});
