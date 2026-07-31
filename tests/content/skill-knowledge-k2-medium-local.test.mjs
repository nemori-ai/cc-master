import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import { attestInventoryEntry } from '../../scripts/skill-knowledge/inventory.mjs';
import { extractMarkers } from '../../scripts/skill-knowledge/markers.mjs';

const require = createRequire(import.meta.url);
const validateSource = require('../../scripts/skill-knowledge/validators/validate-source.cjs');
const repoRoot = path.resolve(import.meta.dirname, '../..');

const targets = [
  {
    name: 'engineering-with-craft',
    composition: 'plugin/src/knowledge/compositions/skill.engineering-with-craft.json',
    canonical: 'plugin/src/skills/engineering-with-craft/canonical',
    expectedEntry: 'entry:engineering-craft',
    expectedSkillPrimary: 'point:craft.shared-spine',
    expectedCoverage: {
      'claude-code': 'full',
      codex: 'full',
      cursor: 'full',
      'kimi-code': 'full',
    },
    nonKnowledge: [],
  },
  {
    name: 'authoring-workflows',
    composition: 'plugin/src/knowledge/compositions/skill.authoring-workflows.json',
    canonical: 'plugin/src/skills/authoring-workflows/canonical',
    expectedEntry: 'entry:workflow-authoring',
    expectedSkillPrimary: 'point:workflow.shape-tree',
    expectedCoverage: {
      'claude-code': 'full',
      codex: 'stub',
      cursor: 'stub',
      'kimi-code': 'stub',
    },
    nonKnowledge: [
      'plugin/src/skills/authoring-workflows/canonical/.design/OBJECTIVE.md',
    ],
  },
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function gitMarkdownDenominator(canonicalRoot) {
  return execFileSync(
    'git',
    ['ls-files', `${canonicalRoot}/**/*.md`, `${canonicalRoot}/*.md`],
    { cwd: repoRoot, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .sort();
}

function assertSchema(document, location) {
  assert.equal(
    Boolean(validateSource(document)),
    true,
    `${location} failed source schema: ${JSON.stringify(validateSource.errors ?? [])}`,
  );
}

function shortestDistance(adjacency, from, to) {
  if (from === to) return 0;
  const queue = [[from, 0]];
  const seen = new Set([from]);
  while (queue.length > 0) {
    const [current, distance] = queue.shift();
    for (const next of adjacency.get(current) ?? []) {
      if (next === to) return distance + 1;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push([next, distance + 1]);
      }
    }
  }
  return null;
}

for (const target of targets) {
  test(`${target.name}: schema, denominator, markers, authority and local authored paths close`, () => {
    const composition = readJson(target.composition);
    assertSchema(composition, target.composition);

    const denominator = gitMarkdownDenominator(target.canonical);
    const inventoryPaths = composition.canonical_source_inventory
      .map((entry) => entry.path)
      .sort();
    assert.deepEqual(inventoryPaths, denominator, 'inventory must equal the Git Markdown denominator');
    assert.equal(
      composition.canonical_source_inventory.some((entry) => entry.coverage === 'partial'),
      false,
      'K2 shard must not contain partial coverage',
    );

    const points = new Map();
    const edges = new Map();
    const modules = composition.consumes.modules.map((reference) => {
      const module = readJson(reference.manifest);
      assertSchema(module, reference.manifest);
      assert.equal(Object.hasOwn(module, 'owner_skill'), false);
      for (const point of module.points) {
        assert.equal(points.has(point.id), false, `duplicate point ${point.id}`);
        points.set(point.id, { point, module });
      }
      for (const edge of module.edges) {
        assert.equal(edges.has(edge.id), false, `duplicate edge ${edge.id}`);
        edges.set(edge.id, edge);
      }
      return module;
    });

    assert.deepEqual(
      composition.entry_modules.slice().sort(),
      modules.map((module) => module.id).sort(),
      'every local module must be an entry module pending shared portfolio integration',
    );

    const inventoryPointIds = new Set(
      composition.canonical_source_inventory.flatMap((entry) => entry.point_ids),
    );
    assert.deepEqual(
      [...inventoryPointIds].sort(),
      [...points.keys()].sort(),
      'inventory point membership must equal module point membership',
    );

    for (const entry of composition.canonical_source_inventory) {
      const text = fs.readFileSync(path.join(repoRoot, entry.path), 'utf8');
      const parsed = extractMarkers(text, entry.path);
      assert.equal(parsed.ok, true, JSON.stringify(parsed.diagnostics));
      assert.deepEqual(
        parsed.spans.map((span) => span.point_id).sort(),
        entry.point_ids.slice().sort(),
        `${entry.path} marker set must equal inventory point_ids`,
      );
      assert.equal(
        attestInventoryEntry(entry, text, parsed.spans).ok,
        true,
        `${entry.path} reviewed_unbound_sha256 must be fresh`,
      );
      assert.equal(
        text.includes('ccm:k:generated'),
        false,
        `${entry.path} must not contain authored generated navigation`,
      );

      const expectedNonKnowledge = target.nonKnowledge.includes(entry.path);
      assert.equal(entry.coverage, expectedNonKnowledge ? 'non_knowledge' : 'full');
      if (expectedNonKnowledge) {
        assert.deepEqual(entry.point_ids, []);
        assert.ok(entry.review?.reviewer);
        assert.ok(entry.review?.rationale);
      }
    }

    const canonicalBySubject = new Map();
    for (const { point } of points.values()) {
      assert.equal(point.binding.marker, point.id);
      assert.equal(point.authority.role, 'canonical');
      assert.equal(
        canonicalBySubject.has(point.authority.subject),
        false,
        `duplicate canonical authority for ${point.authority.subject}`,
      );
      canonicalBySubject.set(point.authority.subject, point.id);
    }

    // A skill is closed over its *content*, not over its routing. Cross-skill
    // nav edges (contrast / route-to) are how a reader is pointed at a
    // neighbouring skill, so their far end lives outside this shard by design;
    // the portfolio exempts exactly those types from the cut-coupling budget.
    // Any other type leaving the shard means real content lives elsewhere,
    // which is what this closure check is for.
    const NAV_TYPES = new Set(['contrasts_with', 'routes_to']);
    for (const edge of edges.values()) {
      if (NAV_TYPES.has(edge.type) && !(points.has(edge.from) && points.has(edge.to))) {
        assert.ok(
          points.has(edge.from) || points.has(edge.to),
          `nav edge touches neither end of this skill: ${edge.id}`,
        );
        continue;
      }
      assert.ok(points.has(edge.from), `edge source missing: ${edge.id}`);
      assert.ok(points.has(edge.to), `edge target missing: ${edge.id}`);
      assert.equal(edge.runtime.enabled_by_default, true);
    }

    const skillAdjacency = new Map([...points.keys()].map((id) => [id, []]));
    for (const edge of edges.values()) {
      skillAdjacency.get(edge.from).push(edge.to);
    }
    for (const id of points.keys()) {
      assert.ok(
        shortestDistance(skillAdjacency, id, target.expectedSkillPrimary) <= 2,
        `${id} must reach the skill canonical main point within two authored hops`,
      );
    }

    for (const module of modules) {
      assert.deepEqual(module.access.relevant_entries, [target.expectedEntry]);
      assert.equal(module.access.primary_points.length, 1);
      const primary = module.access.primary_points[0];
      assert.ok(points.has(primary));
      const members = new Set(module.points.map((point) => point.id));
      const adjacency = new Map([...members].map((id) => [id, []]));
      for (const edge of module.edges) {
        if (members.has(edge.from) && members.has(edge.to)) {
          adjacency.get(edge.from).push(edge.to);
        }
      }
      for (const id of members) {
        assert.ok(
          shortestDistance(adjacency, id, primary) <= 1,
          `${id} must have a direct authored return path to ${primary}`,
        );
        assert.ok(
          shortestDistance(adjacency, primary, id) <= 1,
          `${primary} must have a direct authored discovery path to ${id}`,
        );
      }
    }

    assert.deepEqual(
      Object.fromEntries(composition.host_coverage.map((item) => [item.host, item.state])),
      target.expectedCoverage,
    );
  });
}
