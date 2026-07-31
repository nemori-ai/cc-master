/**
 * K2-04 using-ccm shard — local closed-set validation.
 *
 * Does NOT mutate shared portfolio.json (K2-05). Proves the using-ccm skill shard
 * is self-consistent by materializing an ephemeral temp source root (same pattern as
 * skill-knowledge-k1-pilot-query withTempSource) — no tracked fixture directory.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRequire } from 'node:module';

import {
  liveAdmissionPolicy,
  pruneDanglingNavEdges,
  rederiveSubsetAnalyses,
} from './helpers/skill-knowledge-subset-fixture.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const validateSource = require('../../scripts/skill-knowledge/validators/validate-source.cjs');

const COMPOSITION_PATH =
  'plugin/src/knowledge/compositions/skill.using-ccm.json';
const ANALYSIS_PATH =
  'plugin/src/knowledge/analyses/candidate.using-ccm.json';
const CANONICAL_ROOT = 'plugin/src/skills/using-ccm/canonical';
const CRITICAL = 'point:ccm.status-state-machine';
const ENTRY = 'entry:using-ccm';
const SINCE = '2026-07-24';
const SCHEMA = 'cc-master/skill-knowledge-source/v1alpha1';

function listCanonicalMarkdown() {
  const abs = path.join(repoRoot, CANONICAL_ROOT);
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(path.relative(repoRoot, target).split(path.sep).join('/'));
      }
    }
  };
  walk(abs);
  return out;
}

function gitTrackedCanonicalMarkdown() {
  const result = spawnSync(
    'git',
    ['ls-files', '--', 'plugin/src/skills/using-ccm/canonical/**/*.md', 'plugin/src/skills/using-ccm/canonical/*.md'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

async function loadGraphTools() {
  const graph = await import('../../scripts/skill-knowledge/graph.mjs');
  const markers = await import('../../scripts/skill-knowledge/markers.mjs');
  const inventory = await import('../../scripts/skill-knowledge/inventory.mjs');
  return { ...graph, ...markers, ...inventory };
}

function displayRepoPath(target) {
  const relative = path.relative(repoRoot, target);
  if (relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..') {
    return relative.split(path.sep).join('/');
  }
  return path.resolve(target);
}

/**
 * Ephemeral using-ccm-only knowledge source: portfolio + live composition/global modules.
 * Markdown bindings stay on real repo canonical paths (inventory SSOT).
 */
function withUsingCcmTempSource(callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-using-ccm-'));
  const run = () => {
    const liveComposition = JSON.parse(
      fs.readFileSync(path.join(repoRoot, COMPOSITION_PATH), 'utf8'),
    );
    const modulesDir = path.join(dir, 'graph/modules');
    fs.mkdirSync(modulesDir, { recursive: true });

    const moduleRefs = [];
    for (const ref of liveComposition.consumes.modules) {
      const base = path.basename(ref.manifest);
      const dest = path.join(modulesDir, base);
      fs.copyFileSync(path.join(repoRoot, ref.manifest), dest);
      moduleRefs.push({ id: ref.id, manifest: displayRepoPath(dest) });
    }

    const compositionPath = path.join(dir, 'compositions/skill.using-ccm.json');
    fs.mkdirSync(path.dirname(compositionPath), { recursive: true });
    const compositionDoc = {
      ...liveComposition,
      consumes: { modules: moduleRefs },
    };
    fs.writeFileSync(compositionPath, `${JSON.stringify(compositionDoc, null, 2)}\n`);
    const analysisPath = path.join(dir, 'analyses/candidate.using-ccm.json');
    fs.mkdirSync(path.dirname(analysisPath), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, ANALYSIS_PATH), analysisPath);

    const portfolio = {
      schema_version: SCHEMA,
      kind: 'portfolio',
      id: 'portfolio:cc-master-runtime-skills',
      runtime_hosts: ['claude-code', 'codex', 'cursor', 'kimi-code'],
      skills: [
        {
          id: 'skill:using-ccm',
          manifest: displayRepoPath(compositionPath),
        },
      ],
      entries: [
        {
          id: ENTRY,
          label: 'using-ccm skill entry',
          recognition_cues: ['要用 ccm 操作 board', '查 command catalog 或 board-model'],
          surfaces: ['claude-code', 'codex', 'cursor', 'kimi-code'].map((host) => ({
            host,
            source_file: 'plugin/src/skills/using-ccm/canonical/SKILL.md',
            binding: { kind: 'marker', value: 'point:ccm.when-to-open' },
            surface_kind: 'skill_entry',
            targets: [
              {
                skill: 'skill:using-ccm',
                module: 'module:ccm.mind-model',
                point: CRITICAL,
              },
            ],
            lifecycle: { state: 'accepted', since: SINCE },
          })),
          lifecycle: { state: 'accepted', since: SINCE },
          admission: {
            evidence: [
              {
                kind: 'canonical-prose',
                ref: 'plugin/src/skills/using-ccm/canonical/SKILL.md',
              },
            ],
            verifiers: [{ kind: 'review', ref: 'golden.entry.using-ccm' }],
          },
        },
      ],
      hop_policy: {
        point_diameter_max: 3,
        entry_discovery_max: 3,
        critical_entry_to_primary_max: 1,
        critical_any_point_to_primary_max: 2,
        primary_entry_to_primary_max: 2,
      },
      critical_pin_budget: { max_modules: 2, max_fraction: 0.5 },
      router_budget: {
        atlas_max_lines: 120,
        atlas_max_tokens: 1800,
        module_max_lines: 80,
        module_max_tokens: 1200,
        point_nav_max_lines: 4,
      },
      // Judge the subset by the live rules, not the conservative defaults a
      // synthetic portfolio would otherwise inherit.
      candidate_admission: liveAdmissionPolicy(repoRoot),
      rollout: 'K2',
    };
    pruneDanglingNavEdges(path.join(dir, 'graph/modules'));
    fs.writeFileSync(path.join(dir, 'portfolio.json'), `${JSON.stringify(portfolio, null, 2)}\n`);

    return callback(dir);
  };

  try {
    const result = run();
    if (result && typeof result.then === 'function') {
      return result.finally(() => {
        fs.rmSync(dir, { recursive: true, force: true });
      });
    }
    fs.rmSync(dir, { recursive: true, force: true });
    return result;
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

test('SKG-K2-USING-CCM-01: git denominator equals 4 canonical Markdown files at 100% inventory', () => {
  const normalize = (rows) => [...rows].sort((a, b) => a.localeCompare(b));
  const tracked = normalize(gitTrackedCanonicalMarkdown());
  const onDisk = normalize(listCanonicalMarkdown());
  assert.deepEqual(tracked, onDisk);
  assert.deepEqual(
    tracked,
    normalize([
      'plugin/src/skills/using-ccm/canonical/SKILL.md',
      'plugin/src/skills/using-ccm/canonical/references/account-pool.md',
      'plugin/src/skills/using-ccm/canonical/references/board-model-guide.md',
      'plugin/src/skills/using-ccm/canonical/references/command-catalog.md',
    ]),
  );

  const skill = JSON.parse(fs.readFileSync(path.join(repoRoot, COMPOSITION_PATH), 'utf8'));
  const inventoryPaths = normalize(skill.canonical_source_inventory.map((row) => row.path));
  assert.deepEqual(inventoryPaths, tracked);
  assert.equal(
    skill.canonical_source_inventory.every((row) => row.coverage === 'full'),
    true,
  );
  assert.equal(
    skill.canonical_source_inventory.every((row) => !row.unresolved_coverage_debt),
    true,
  );
});

test('SKG-K2-USING-CCM-02: schema + markers + unbound hashes + unique canonical authority', async () => {
  const { extractMarkers, hashUnboundRegions, buildAndValidateGraph } = await loadGraphTools();
  const skill = JSON.parse(fs.readFileSync(path.join(repoRoot, COMPOSITION_PATH), 'utf8'));
  assert.equal(Boolean(validateSource(skill)), true, JSON.stringify(validateSource.errors ?? []));

  const subjects = new Map();
  for (const ref of skill.consumes.modules) {
    const mod = JSON.parse(fs.readFileSync(path.join(repoRoot, ref.manifest), 'utf8'));
    assert.equal(
      Boolean(validateSource(mod)),
      true,
      `${ref.id}: ${JSON.stringify(validateSource.errors ?? [])}`,
    );
    for (const point of mod.points) {
      if (point.authority.role !== 'canonical') continue;
      const prev = subjects.get(point.authority.subject);
      assert.equal(
        prev,
        undefined,
        `duplicate canonical subject ${point.authority.subject}: ${prev} vs ${point.id}`,
      );
      subjects.set(point.authority.subject, point.id);
    }
  }

  for (const entry of skill.canonical_source_inventory) {
    const text = fs.readFileSync(path.join(repoRoot, entry.path), 'utf8');
    const parsed = extractMarkers(text, entry.path);
    assert.equal(parsed.ok, true, JSON.stringify(parsed.diagnostics, null, 2));
    const expected = new Set(entry.point_ids);
    const actual = new Set(parsed.spans.map((span) => span.point_id));
    assert.deepEqual([...actual].sort(), [...expected].sort());
    const hash = hashUnboundRegions(
      text,
      parsed.spans.filter((span) => expected.has(span.point_id)),
    );
    assert.equal(hash, entry.reviewed_unbound_sha256, entry.path);
    assert.equal(text.includes('<!-- ccm:k:nav'), false, 'no compiler nav blocks in source');
  }

  await withUsingCcmTempSource(async (sourceRoot) => {
    await rederiveSubsetAnalyses({ repoRoot, sourceRoot });
    const built = buildAndValidateGraph({ repoRoot, sourceRoot });
    const errors = built.diagnostics.filter((item) => item.severity === 'error');
    assert.equal(errors.length, 0, JSON.stringify(errors.slice(0, 5), null, 2));
    assert.equal(built.ok, true);
    assert.equal(built.graph.counts.skill, 1);
    assert.equal(built.graph.counts.module, 8);
    assert.equal(built.graph.counts.point, 52);
    assert.ok(built.graph.counts.edge >= 100);
    assert.equal(built.graph.counts.entry, 1);
  });
});

test('SKG-K2-USING-CCM-03: CLI-fact vs judgment authority boundary is explicit', () => {
  const skill = JSON.parse(fs.readFileSync(path.join(repoRoot, COMPOSITION_PATH), 'utf8'));
  const byModule = new Map();
  for (const ref of skill.consumes.modules) {
    const mod = JSON.parse(fs.readFileSync(path.join(repoRoot, ref.manifest), 'utf8'));
    byModule.set(mod.id, mod);
  }

  // What this boundary is about is where the *prose* sits: CLI facts belong in
  // the command catalog, judgment belongs elsewhere. Since the point text moved
  // into its own mother file, `binding.path` names the knowledge source, not the
  // article — the composition inventory is now the authored record of which
  // article carries which point, so that is what the placement rule reads.
  const articleOf = new Map();
  for (const entry of skill.canonical_source_inventory ?? []) {
    for (const pointId of entry.point_ids ?? []) articleOf.set(pointId, entry.path);
  }
  const inCatalog = (point) => (articleOf.get(point.id) ?? '').endsWith('command-catalog.md');

  const cliModules = [
    'module:ccm.commands.core',
    'module:ccm.commands.scheduling',
    'module:ccm.commands.extended',
  ];
  for (const id of cliModules) {
    const mod = byModule.get(id);
    assert.ok(mod, id);
    assert.equal(
      mod.points.every(inCatalog),
      true,
      `${id} must bind CLI facts to command-catalog`,
    );
    assert.equal(
      mod.points.every((point) => point.point_kind === 'reference'),
      true,
      `${id} CLI fact points stay reference role`,
    );
  }

  const judgmentModules = [
    'module:ccm.mind-model',
    'module:ccm.hotpath-footgun',
    'module:ccm.board-model.lifecycle',
    'module:ccm.board-model.contracts',
    'module:ccm.account-pool',
  ];
  for (const id of judgmentModules) {
    const mod = byModule.get(id);
    assert.ok(mod, id);
    assert.equal(
      mod.points.some((point) => !inCatalog(point)),
      true,
      `${id} must own judgment prose outside command-catalog`,
    );
  }

  const account = byModule.get('module:ccm.account-pool');
  const accountCmd = account.points.find((point) => point.id === 'point:ccm.cmd.account');
  assert.ok(accountCmd);
  assert.equal(inCatalog(accountCmd), true);
  assert.equal(
    account.points.filter((point) => (articleOf.get(point.id) ?? '').endsWith('account-pool.md')).length,
    4,
  );
});

test('SKG-K2-USING-CCM-04: authored hop budget to critical primary + entry fan-out', async () => {
  const { buildAndValidateGraph, shortestPath } = await loadGraphTools();
  await withUsingCcmTempSource(async (sourceRoot) => {
    await rederiveSubsetAnalyses({ repoRoot, sourceRoot });
    const built = buildAndValidateGraph({ repoRoot, sourceRoot });
    assert.equal(built.ok, true);

    const violations = [];
    for (const point of built.graph.points) {
      const result = shortestPath(built.graph, point.id, CRITICAL);
      if (!result.reachable || result.hops == null || result.hops > 2) {
        violations.push({ from: point.id, hops: result.hops, reachable: result.reachable });
      }
    }
    assert.deepEqual(violations, []);

    for (const mod of built.graph.modules) {
      const primary = mod.access.primary_points[0];
      const result = shortestPath(built.graph, CRITICAL, primary);
      const limit = mod.access.class === 'critical' ? 0 : mod.access.class === 'primary' ? 2 : 3;
      assert.equal(result.reachable, true, `${mod.id} primary unreachable from entry landing`);
      assert.ok(result.hops <= limit, `${mod.id} hops ${result.hops} > ${limit}`);
      assert.ok(mod.access.relevant_entries.includes(ENTRY));
    }

    assert.equal(
      built.graph.modules.filter((mod) => mod.access.class === 'critical').length,
      1,
    );
  });
});

test('SKG-K2-USING-CCM-05: live knowledge root admits using-ccm in the integrated portfolio', async () => {
  const { buildAndValidateGraph } = await loadGraphTools();
  const built = buildAndValidateGraph({
    repoRoot,
    sourceRoot: 'plugin/src/knowledge',
  });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics.filter((d) => d.severity === 'error'), null, 2));
  assert.ok(
    built.graph.skills.some((skill) => skill.id === 'skill:using-ccm'),
    'using-ccm must be present in the integrated portfolio graph',
  );
  const orphan = built.diagnostics.find(
    (item) =>
      item.code === 'SKG-OWNERSHIP-ORPHAN' && item.witness?.skill === 'skill:using-ccm',
  );
  assert.equal(orphan, undefined, 'using-ccm must not remain an ownership orphan after K2-05');
});

/**
 * Parse strategy.yaml exclude_canonical entries without a YAML dependency.
 * Only the simple list form used by using-ccm adapters is supported.
 */
function parseExcludeCanonical(strategyText) {
  const lines = strategyText.split(/\r?\n/);
  const start = lines.findIndex((line) => /^exclude_canonical:\s*$/.test(line));
  if (start < 0) return [];
  const out = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\S/.test(line)) break;
    const match = line.match(/^\s+-\s+(\S+)\s*$/);
    if (match) out.push(match[1]);
  }
  return out;
}

test('SKG-K2-USING-CCM-06: adapter-excluded canonical points cannot be claimed host full', () => {
  const skill = JSON.parse(fs.readFileSync(path.join(repoRoot, COMPOSITION_PATH), 'utf8'));
  const modules = skill.consumes.modules.map((ref) =>
    JSON.parse(fs.readFileSync(path.join(repoRoot, ref.manifest), 'utf8')),
  );
  const coverageByHost = new Map(skill.host_coverage.map((row) => [row.host, row]));

  const accountPoolModule = modules.find((mod) => mod.id === 'module:ccm.account-pool');
  assert.ok(accountPoolModule);
  // Which article carries a point's prose is recorded in the composition inventory;
  // `binding.path` now names the mother file the prose was written from.
  const articleOf = new Map();
  for (const entry of skill.canonical_source_inventory ?? []) {
    for (const pointId of entry.point_ids ?? []) articleOf.set(pointId, entry.path);
  }
  const accountPoolPoints = accountPoolModule.points.filter((point) =>
    (articleOf.get(point.id) ?? '').endsWith('/references/account-pool.md'),
  );
  assert.equal(accountPoolPoints.length, 4);

  const hosts = ['claude-code', 'codex', 'cursor', 'kimi-code'];
  for (const host of hosts) {
    const strategyPath = path.join(
      repoRoot,
      'plugin/src/skills/using-ccm/adapters',
      host,
      'strategy.yaml',
    );
    const strategyText = fs.readFileSync(strategyPath, 'utf8');
    const excluded = parseExcludeCanonical(strategyText);
    const coverage = coverageByHost.get(host);
    assert.ok(coverage, `missing host_coverage for ${host}`);

    const excludesAccountPool = excluded.some(
      (item) => item === 'references/account-pool.md' || item.endsWith('/account-pool.md'),
    );

    if (host === 'claude-code') {
      assert.equal(excludesAccountPool, false);
      assert.equal(coverage.state, 'full');
      continue;
    }

    assert.equal(
      excludesAccountPool,
      true,
      `${host} strategy must exclude account-pool.md (adapter contract)`,
    );
    assert.notEqual(
      coverage.state,
      'full',
      `${host} must not claim full while excluding account-pool.md which owns 4 accepted points`,
    );
    assert.equal(coverage.state, 'partial');
    assert.ok(Array.isArray(coverage.covered_modules));
    assert.equal(coverage.covered_modules.includes('module:ccm.account-pool'), false);
    assert.equal(coverage.covered_modules.length, 7);
    assert.match(
      coverage.reason ?? '',
      /account-pool|account_switch/i,
      `${host} partial reason must mention account-pool / account_switch`,
    );

    // Modules whose accepted points are written into an excluded canonical file are
    // uncovered on that host. The article a point is written into comes from the
    // composition inventory; `binding.path` names its mother file.
    const uncoveredByExclude = modules
      .filter((mod) =>
        mod.points.some((point) => {
          const article = articleOf.get(point.id) ?? '';
          return excluded.some((rel) => article.endsWith(`/${rel}`) || article.endsWith(rel));
        }),
      )
      .map((mod) => mod.id);
    assert.ok(uncoveredByExclude.includes('module:ccm.account-pool'));
    for (const moduleId of uncoveredByExclude) {
      assert.equal(
        coverage.covered_modules.includes(moduleId),
        false,
        `${host} covered_modules must omit ${moduleId} (points live in excluded canonical file)`,
      );
    }
  }
});
