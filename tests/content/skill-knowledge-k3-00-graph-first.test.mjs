/**
 * K3-00 walking skeleton — graph-first / skill-as-artifact.
 *
 * Points + typed relations are global primitives; modules are global aggregates;
 * skills are admitted composition artifacts. Binding paths are evidence only.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliPath = path.join(repoRoot, 'scripts', 'skill-knowledge.mjs');

function runCli(args, cwd = repoRoot) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

function parseJson(result) {
  assert.equal(result.stderr, '', `stderr must be empty: ${result.stderr}`);
  assert.notEqual(result.stdout, '', 'expected JSON stdout');
  return JSON.parse(result.stdout);
}

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relative), 'utf8'));
}

test('SKG-K3-00-01: schema admits composition + candidate_analysis; global module has no owner', async () => {
  const { validateAuthoredDocument, validatorsAvailable } = await import(
    '../../scripts/skill-knowledge/schema.mjs'
  );
  assert.equal(validatorsAvailable(), true);

  const composition = readJson(
    'plugin/src/knowledge/compositions/skill.dev-as-ml-loop.json',
  );
  assert.equal(composition.kind, 'composition');
  const compositionResult = validateAuthoredDocument(composition, 'source');
  assert.equal(compositionResult.ok, true, JSON.stringify(compositionResult.errors?.slice(0, 5)));

  const analysis = readJson(
    'plugin/src/knowledge/analyses/candidate.dev-as-ml-loop.json',
  );
  assert.equal(analysis.kind, 'candidate_analysis');
  const analysisResult = validateAuthoredDocument(analysis, 'source');
  assert.equal(analysisResult.ok, true, JSON.stringify(analysisResult.errors?.slice(0, 5)));

  const moduleDoc = readJson(
    'plugin/src/knowledge/graph/modules/devloop.core.json',
  );
  assert.equal(moduleDoc.kind, 'module');
  assert.equal(
    Object.prototype.hasOwnProperty.call(moduleDoc, 'owner_skill'),
    false,
    'graph-first modules must not declare owner_skill',
  );
  const moduleResult = validateAuthoredDocument(moduleDoc, 'source');
  assert.equal(moduleResult.ok, true, JSON.stringify(moduleResult.errors?.slice(0, 5)));
});

test('SKG-K3-00-02: loader treats points/modules as global; composition consumes them', async () => {
  const { buildAndValidateGraph } = await import('../../scripts/skill-knowledge/graph.mjs');
  const { ok, graph, diagnostics } = buildAndValidateGraph({ repoRoot });
  assert.equal(ok, true, JSON.stringify(diagnostics.filter((d) => d.severity === 'error').slice(0, 5)));

  const core = graph.modules.find((m) => m.id === 'module:devloop.core');
  assert.ok(core, 'global module:devloop.core must load');
  assert.equal(core.owner_skill, undefined);

  const point = graph.points.find((p) => p.id === 'point:devloop.objective');
  assert.ok(point);
  assert.equal(point.module_id, 'module:devloop.core');
  assert.equal(point.owner_skill, undefined, 'membership is module-local, not skill-owned');

  const composition = graph.compositions?.find(
    (c) => c.id === 'composition:skill.dev-as-ml-loop' || c.skill_id === 'skill:dev-as-ml-loop',
  );
  assert.ok(composition, 'composition for dev-as-ml-loop must be present');
  assert.ok(
    (composition.consumes?.modules ?? []).some(
      (item) => (typeof item === 'string' ? item : item.id) === 'module:devloop.core',
    ),
    'composition must explicitly consume global modules via consumes.modules locators',
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(composition, 'modules'),
    false,
    'composition must not keep a parallel modules[] array',
  );
});

test('SKG-K3-00-03: candidate analysis emits scoresheet/witness and admit verdict', async () => {
  const { analyzeSkillCandidate } = await import(
    '../../scripts/skill-knowledge/graph-first.mjs'
  );
  const analysis = readJson(
    'plugin/src/knowledge/analyses/candidate.dev-as-ml-loop.json',
  );
  const recomputed = analyzeSkillCandidate({
    repoRoot,
    skillId: 'skill:dev-as-ml-loop',
    moduleIds: [
      'module:devloop.core',
      'module:devloop.outer',
      'module:devloop.ledger',
    ],
    analysisId: 'analysis:candidate.dev-as-ml-loop',
    compositionId: 'composition:skill.dev-as-ml-loop',
  });
  assert.equal(recomputed.ok, true, JSON.stringify(recomputed.diagnostics?.slice(0, 3)));
  assert.equal(recomputed.verdict, 'admit');
  assert.ok(recomputed.scoresheet);
  assert.equal(recomputed.scoresheet.D1.score, 1);
  assert.equal(recomputed.scoresheet.D2.score, 1);
  assert.ok(['strong', 'weak'].includes(recomputed.scoresheet.D3.probe_a));
  assert.ok(['strong', 'weak'].includes(recomputed.scoresheet.D3.probe_b));
  assert.ok(recomputed.witness);
  assert.ok(recomputed.witness.candidate_points?.length > 0);
  assert.equal(analysis.verdict, 'admit');
  assert.equal(analysis.verdict, recomputed.verdict);
  assert.equal(recomputed.stored_verdict, recomputed.derived_verdict);
});

test('SKG-K3-00-04: admitted composition materializes four-host surfaces without semantic loss', () => {
  const result = runCli(['materialize', '--composition', 'composition:skill.dev-as-ml-loop', '--json']);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const body = parseJson(result);
  assert.equal(body.ok, true);
  assert.equal(body.result_kind, 'materialize');
  assert.deepEqual(body.hosts, ['claude-code', 'codex', 'cursor', 'kimi-code']);
  for (const host of body.hosts) {
    const hostResult = body.host_results.find((item) => item.host === host);
    assert.ok(hostResult?.ok, `${host} materialize failed: ${JSON.stringify(hostResult)}`);
  }

  // Runtime prose markers for the pilot skill remain present on each host.
  for (const host of body.hosts) {
    const skillMd = path.join(
      repoRoot,
      'plugin/dist',
      host,
      'skills/dev-as-ml-loop/SKILL.md',
    );
    assert.equal(fs.existsSync(skillMd), true, `${host} SKILL.md missing`);
    const text = fs.readFileSync(skillMd, 'utf8');
    assert.match(text, /<!--\s*ccm:k:start point:devloop\.objective\s*-->/);
    assert.match(text, /验收\s*=\s*目标函数|objective/i);
  }
});

test('SKG-K3-00-05 NEG: moving binding.path does not change semantic membership', async () => {
  const { buildAndValidateGraph } = await import('../../scripts/skill-knowledge/graph.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-k3-00-bind-'));
  try {
    const copyTree = (fromRel) => {
      const from = path.join(repoRoot, fromRel);
      const to = path.join(tmp, fromRel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.cpSync(from, to, { recursive: true });
    };
    copyTree('plugin/src/knowledge');
    copyTree('plugin/src/skills');
    copyTree('design_docs/skill-knowledge-graph/schemas');
    copyTree('scripts/skill-knowledge/validators');

    const modulePath = path.join(
      tmp,
      'plugin/src/knowledge/graph/modules/devloop.core.json',
    );
    const moduleDoc = JSON.parse(fs.readFileSync(modulePath, 'utf8'));
    const point = moduleDoc.points.find((p) => p.id === 'point:devloop.objective');
    assert.ok(point);
    const beforeModule = point.binding.path;
    point.binding.path =
      'plugin/src/skills/some-other-skill/canonical/MOVED-DOES-NOT-OWN.md';
    fs.writeFileSync(modulePath, `${JSON.stringify(moduleDoc, null, 2)}\n`);

    const moved = path.join(tmp, point.binding.path);
    fs.mkdirSync(path.dirname(moved), { recursive: true });
    fs.writeFileSync(
      moved,
      [
        '<!-- ccm:k:start point:devloop.objective -->',
        'objective',
        '<!-- ccm:k:end point:devloop.objective -->',
        '',
      ].join('\n'),
    );

    // Inventory still points at the original path; update the composition inventory
    // entry so binding attestation does not dominate this membership negative.
    const compositionPath = path.join(
      tmp,
      'plugin/src/knowledge/compositions/skill.dev-as-ml-loop.json',
    );
    const composition = JSON.parse(fs.readFileSync(compositionPath, 'utf8'));
    for (const entry of composition.canonical_source_inventory ?? []) {
      if (entry.path === beforeModule) {
        entry.path = point.binding.path;
        entry.reviewed_unbound_sha256 =
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      }
    }
    fs.writeFileSync(compositionPath, `${JSON.stringify(composition, null, 2)}\n`);

    const { graph, ok, diagnostics } = buildAndValidateGraph({
      repoRoot: tmp,
      sourceRoot: 'plugin/src/knowledge',
    });
    assert.ok(graph, JSON.stringify(diagnostics?.slice(0, 3)));
    const after = graph.points.find((p) => p.id === 'point:devloop.objective');
    assert.equal(after.module_id, 'module:devloop.core');
    assert.notEqual(after.binding.path, beforeModule);
    assert.equal(
      after.owner_skill,
      undefined,
      'path move must not invent skill ownership',
    );
    // ok may be false due to unbound hash / inventory debt; membership must still hold.
    assert.equal(after.module_id, 'module:devloop.core');
    void ok;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('SKG-K3-00-06 NEG: unadmitted candidate cannot materialize a skill', async () => {
  const { runMaterialize } = await import('../../scripts/skill-knowledge/graph-first.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-k3-00-unadmit-'));
  try {
    const copyTree = (fromRel) => {
      const from = path.join(repoRoot, fromRel);
      const to = path.join(tmp, fromRel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.cpSync(from, to, { recursive: true });
    };
    copyTree('plugin/src/knowledge');
    copyTree('plugin/src/skills/dev-as-ml-loop');
    const analysisPath = path.join(
      tmp,
      'plugin/src/knowledge/analyses/candidate.dev-as-ml-loop.json',
    );
    const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
    analysis.scoresheet.D1.score = 0;
    analysis.scoresheet.D3.probe_a = 'weak';
    analysis.scoresheet.D3.probe_b = 'weak';
    analysis.verdict = 'reject';
    fs.writeFileSync(analysisPath, `${JSON.stringify(analysis, null, 2)}\n`);

    const result = runMaterialize({
      repoRoot: tmp,
      compositionId: 'composition:skill.dev-as-ml-loop',
      checkOnly: true,
    });
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.body.ok, false);
    assert.ok(
      result.body.diagnostics.some((d) => d.code === 'SKG-COMPOSITION-NOT-ADMITTED'),
      JSON.stringify(result.body.diagnostics.map((d) => d.code)),
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('SKG-K3-00-07 NEG: directory/path names cannot fake membership', async () => {
  const { membershipFromPath } = await import(
    '../../scripts/skill-knowledge/graph-first.mjs'
  );
  assert.equal(
    membershipFromPath('plugin/src/knowledge/skills/dev-as-ml-loop/modules/devloop.core.json'),
    null,
    'legacy skill-nested path must not imply membership',
  );
  assert.equal(
    membershipFromPath('plugin/src/skills/dev-as-ml-loop/canonical/SKILL.md'),
    null,
    'package Markdown path must not imply module/skill membership',
  );
  assert.equal(
    membershipFromPath('plugin/src/knowledge/graph/modules/devloop.core.json'),
    null,
    'even graph/ path is evidence location only — membership comes from authored IDs',
  );
});

test('SKG-K3-00-08: load-bearing docs no longer claim skill owns modules', () => {
  const spec = fs.readFileSync(
    path.join(repoRoot, 'design_docs/skill-knowledge-graph/specification.md'),
    'utf8',
  );
  const adr = fs.readFileSync(
    path.join(repoRoot, 'adrs/ADR-038-git-native-skill-knowledge-graph.md'),
    'utf8',
  );
  assert.match(spec, /graph-first|skill-as-artifact/i);
  assert.doesNotMatch(
    spec,
    /一个 active module 恰属一个 skill/,
    'spec must not keep skill-first ownership invariant as current truth',
  );
  assert.match(adr, /graph-first|skill-as-artifact|composition/i);
  assert.match(
    spec,
    /composition manifest|候选分析|admit/,
    'spec must describe composition + admission as materialization inputs',
  );
});
