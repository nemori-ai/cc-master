/**
 * K3-00 reviewer REQUEST_CHANGES — load-bearing mutation / negative tests.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
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

function copyTree(fromRel, tmp) {
  const from = path.join(repoRoot, fromRel);
  const to = path.join(tmp, fromRel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

function writeJson(abs, value) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`);
}

function seedPilotTree(tmp) {
  copyTree('plugin/src/knowledge', tmp);
  copyTree('plugin/src/skills/dev-as-ml-loop', tmp);
  copyTree('design_docs/skill-knowledge-graph/schemas', tmp);
  copyTree('scripts/skill-knowledge/validators', tmp);
  copyTree('scripts/skill-knowledge.mjs', tmp);
  // scripts are imported from real repoRoot in unit tests; CLI uses cwd.
}

test('SKG-K3-00-R01 NEG: public --analysis-override is rejected', () => {
  const result = runCli([
    'materialize',
    '--composition',
    'composition:skill.dev-as-ml-loop',
    '--analysis-override',
    '{"verdict":"reject"}',
    '--json',
  ]);
  assert.notEqual(result.status, 0);
  const body = parseJson(result);
  assert.equal(body.ok, false);
  assert.ok(
    body.diagnostics.some((d) => d.code === 'SKG-USAGE' || /analysis-override/i.test(d.message)),
    JSON.stringify(body.diagnostics),
  );
});

test('SKG-K3-00-R02 NEG: weak scoresheet cannot keep stored admit verdict', async () => {
  const { analyzeSkillCandidate } = await import(
    '../../scripts/skill-knowledge/graph-first.mjs'
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-k3-r02-'));
  try {
    seedPilotTree(tmp);
    const analysisPath = path.join(
      tmp,
      'plugin/src/knowledge/analyses/candidate.dev-as-ml-loop.json',
    );
    const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
    analysis.scoresheet.D1.score = 0;
    analysis.scoresheet.D3.probe_a = 'weak';
    analysis.scoresheet.D3.probe_b = 'weak';
    analysis.verdict = 'admit';
    writeJson(analysisPath, analysis);

    const recomputed = analyzeSkillCandidate({
      repoRoot: tmp,
      skillId: 'skill:dev-as-ml-loop',
      moduleIds: [
        'module:devloop.core',
        'module:devloop.outer',
        'module:devloop.ledger',
      ],
      analysisId: 'analysis:candidate.dev-as-ml-loop',
      compositionId: 'composition:skill.dev-as-ml-loop',
    });
    assert.equal(recomputed.ok, false);
    assert.notEqual(recomputed.verdict, 'admit');
    assert.ok(
      (recomputed.diagnostics ?? []).some(
        (d) =>
          d.code === 'SKG-ANALYSIS-VERDICT-MISMATCH' ||
          d.code === 'SKG-ANALYSIS-NOT-ADMITTED',
      ),
      JSON.stringify(recomputed.diagnostics ?? recomputed),
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('SKG-K3-00-R03 NEG: analysis skill_id / module-set mismatch fails closed', async () => {
  const { analyzeSkillCandidate } = await import(
    '../../scripts/skill-knowledge/graph-first.mjs'
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-k3-r03-'));
  try {
    seedPilotTree(tmp);
    const analysisPath = path.join(
      tmp,
      'plugin/src/knowledge/analyses/candidate.dev-as-ml-loop.json',
    );
    const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
    analysis.skill_id = 'skill:other-skill';
    analysis.candidate_modules = ['module:devloop.core'];
    writeJson(analysisPath, analysis);

    const recomputed = analyzeSkillCandidate({
      repoRoot: tmp,
      skillId: 'skill:dev-as-ml-loop',
      moduleIds: [
        'module:devloop.core',
        'module:devloop.outer',
        'module:devloop.ledger',
      ],
      analysisId: 'analysis:candidate.dev-as-ml-loop',
      compositionId: 'composition:skill.dev-as-ml-loop',
    });
    assert.equal(recomputed.ok, false);
    assert.ok(
      (recomputed.diagnostics ?? []).some(
        (d) =>
          d.code === 'SKG-ANALYSIS-IDENTITY-MISMATCH' ||
          d.code === 'SKG-ANALYSIS-MODULE-MISMATCH',
      ),
      JSON.stringify(recomputed.diagnostics ?? recomputed),
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('SKG-K3-00-R04 NEG: missing analysis never defaults Counterfactual A/B to strong', async () => {
  const { analyzeSkillCandidate } = await import(
    '../../scripts/skill-knowledge/graph-first.mjs'
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-k3-r04-'));
  try {
    seedPilotTree(tmp);
    fs.rmSync(path.join(tmp, 'plugin/src/knowledge/analyses'), {
      recursive: true,
      force: true,
    });
    const recomputed = analyzeSkillCandidate({
      repoRoot: tmp,
      skillId: 'skill:dev-as-ml-loop',
      moduleIds: [
        'module:devloop.core',
        'module:devloop.outer',
        'module:devloop.ledger',
      ],
      analysisId: 'analysis:candidate.dev-as-ml-loop',
      compositionId: 'composition:skill.dev-as-ml-loop',
    });
    assert.equal(recomputed.ok, false);
    assert.equal(recomputed.verdict, 'reject');
    assert.notEqual(recomputed.scoresheet?.D3?.probe_a, 'strong');
    assert.notEqual(recomputed.scoresheet?.D3?.probe_b, 'strong');
    assert.ok(
      (recomputed.diagnostics ?? []).some((d) => d.code === 'SKG-ANALYSIS-MISSING'),
      JSON.stringify(recomputed.diagnostics ?? recomputed),
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('SKG-K3-00-R05: composition consumption SSOT is consumes.modules locators only', () => {
  const composition = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, 'plugin/src/knowledge/compositions/skill.dev-as-ml-loop.json'),
      'utf8',
    ),
  );
  assert.equal(Object.prototype.hasOwnProperty.call(composition, 'modules'), false);
  assert.ok(Array.isArray(composition.consumes?.modules));
  for (const ref of composition.consumes.modules) {
    assert.equal(typeof ref, 'object');
    assert.equal(typeof ref.id, 'string');
    assert.equal(typeof ref.manifest, 'string');
    assert.match(ref.id, /^module:/);
    assert.match(ref.manifest, /graph\/modules\//);
  }
});

test('SKG-K3-00-R06 NEG: draft/reject/reference/decompose refused by materialize and ordinary compile', async () => {
  const { buildAndValidateGraph } = await import('../../scripts/skill-knowledge/graph.mjs');
  const { runMaterialize } = await import('../../scripts/skill-knowledge/graph-first.mjs');
  const { runCompile } = await import('../../scripts/skill-knowledge/compile.mjs');
  const { analyzeAgainstGraph, consumeModuleIds, computeCandidateMetrics } =
    await import('../../scripts/skill-knowledge/candidate-analysis.mjs');

  const cases = [
    { label: 'draft', lifecycle: 'draft', verdict: null },
    { label: 'reject', lifecycle: 'accepted', verdict: 'reject' },
    { label: 'reference', lifecycle: 'accepted', verdict: 'reference' },
    { label: 'decompose', lifecycle: 'accepted', verdict: 'decompose' },
  ];

  for (const scenario of cases) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `skg-k3-r06-${scenario.label}-`));
    try {
      seedPilotTree(tmp);
      const compositionPath = path.join(
        tmp,
        'plugin/src/knowledge/compositions/skill.dev-as-ml-loop.json',
      );
      const analysisPath = path.join(
        tmp,
        'plugin/src/knowledge/analyses/candidate.dev-as-ml-loop.json',
      );
      const composition = JSON.parse(fs.readFileSync(compositionPath, 'utf8'));
      composition.lifecycle.state = scenario.lifecycle;
      writeJson(compositionPath, composition);

      if (scenario.verdict) {
        const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
        if (scenario.verdict === 'decompose') {
          analysis.scoresheet.D2.score = 0;
        } else if (scenario.verdict === 'reference') {
          analysis.scoresheet.D3.probe_a = 'strong';
          analysis.scoresheet.D3.probe_b = 'weak';
        } else if (scenario.verdict === 'reject') {
          analysis.scoresheet.D1.score = 0;
          analysis.scoresheet.D3.probe_a = 'weak';
          analysis.scoresheet.D3.probe_b = 'weak';
        }
        analysis.verdict = scenario.verdict;
        // Keep persisted metrics/witness lockstep with live recompute so the
        // failure mode is the non-admit verdict/lifecycle, not metrics drift.
        const provisional = buildAndValidateGraph({
          repoRoot: tmp,
          sourceRoot: 'plugin/src/knowledge',
          skipCompositionAdmission: true,
        });
        const metrics = computeCandidateMetrics({
          graph: provisional.graph,
          moduleIds: consumeModuleIds(composition),
          composition,
          repoRoot: tmp,
        });
        analysis.graph_metrics = metrics.graph_metrics;
        analysis.witness = {
          reason: analysis.witness.reason,
          composition_id: composition.id,
          ...metrics.witness_metrics,
          graph_metrics: metrics.graph_metrics,
          admission_gates: {
            ok: metrics.admission_gates.ok,
            module_count_matches_candidate:
              metrics.admission_gates.module_count_matches_candidate,
            point_count_positive: metrics.admission_gates.point_count_positive,
            trigger_job_coherence: metrics.admission_gates.trigger_job_coherence,
            ssot_closure: metrics.admission_gates.ssot_closure,
            internal_cohesion: metrics.admission_gates.internal_cohesion,
            external_cut: metrics.admission_gates.external_cut,
            overlap_within_budget: metrics.admission_gates.overlap_within_budget,
            hop: metrics.admission_gates.hop,
            read_budget: metrics.admission_gates.read_budget,
            token_budget: metrics.admission_gates.token_budget,
            four_host_denominator: metrics.admission_gates.four_host_denominator,
            host_portability: metrics.admission_gates.host_portability,
          },
        };
        writeJson(analysisPath, analysis);
        const derived = analyzeAgainstGraph({
          repoRoot: tmp,
          graph: provisional.graph,
          skillId: composition.skill_id,
          moduleIds: consumeModuleIds(composition),
          analysisId: analysis.id,
          compositionId: composition.id,
          composition,
        });
        assert.equal(derived.derived_verdict, scenario.verdict, scenario.label);
      }

      const built = buildAndValidateGraph({
        repoRoot: tmp,
        sourceRoot: 'plugin/src/knowledge',
      });
      assert.equal(
        (built.graph?.skills ?? []).some((s) => s.id === 'skill:dev-as-ml-loop'),
        false,
        `${scenario.label}: must not project skill product view`,
      );
      assert.equal(built.ok, false, scenario.label);

      const mat = runMaterialize({
        repoRoot: tmp,
        compositionId: 'composition:skill.dev-as-ml-loop',
        checkOnly: true,
      });
      assert.notEqual(mat.exitCode, 0, `${scenario.label} materialize`);
      assert.ok(Array.isArray(mat.body.diagnostics));
      assert.ok(
        mat.body.diagnostics.some(
          (d) =>
            d.code === 'SKG-COMPOSITION-NOT-ADMITTED' ||
            d.code === 'SKG-COMPOSITION-LIFECYCLE',
        ),
        `${scenario.label} materialize diags: ${JSON.stringify(mat.body.diagnostics.map((d) => d.code))}`,
      );

      const compiled = runCompile({
        repoRoot: tmp,
        source: 'plugin/src/knowledge',
        check: true,
      });
      assert.notEqual(compiled.exitCode, 0, `${scenario.label} compile exit`);
      assert.equal(compiled.body?.ok, false, `${scenario.label} compile body`);
      assert.ok(Array.isArray(compiled.body?.diagnostics), `${scenario.label} compile diagnostics`);
      assert.ok(
        compiled.body.diagnostics.some(
          (d) =>
            d.code === 'SKG-COMPOSITION-NOT-ADMITTED' ||
            d.code === 'SKG-COMPOSITION-LIFECYCLE' ||
            d.code === 'SKG-ENTRY-TARGET-CHAIN',
        ),
        `${scenario.label} compile diags: ${JSON.stringify(compiled.body.diagnostics.map((d) => d.code).slice(0, 8))}`,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});

test('SKG-K3-00-R07: governance hash mutates for consumes/scoresheet/verdict/witness/evidence', async () => {
  const { buildAndValidateGraph } = await import('../../scripts/skill-knowledge/graph.mjs');
  const baseline = buildAndValidateGraph({ repoRoot });
  assert.equal(baseline.ok, true);
  const baseHash = baseline.graph.graph_hash;

  const mutations = [
    {
      name: 'consumes',
      apply(tmp) {
        const compositionPath = path.join(
          tmp,
          'plugin/src/knowledge/compositions/skill.dev-as-ml-loop.json',
        );
        const composition = JSON.parse(fs.readFileSync(compositionPath, 'utf8'));
        // Drop ledger module from consumption (still leave core+outer).
        composition.consumes.modules = composition.consumes.modules.filter(
          (ref) => ref.id !== 'module:devloop.ledger',
        );
        composition.entry_modules = composition.entry_modules.filter(
          (id) => id !== 'module:devloop.ledger',
        );
        writeJson(compositionPath, composition);
      },
    },
    {
      name: 'scoresheet',
      apply(tmp) {
        const analysisPath = path.join(
          tmp,
          'plugin/src/knowledge/analyses/candidate.dev-as-ml-loop.json',
        );
        const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
        analysis.scoresheet.D1.evidence = `${analysis.scoresheet.D1.evidence} [hash-mutation-scoresheet]`;
        writeJson(analysisPath, analysis);
      },
    },
    {
      name: 'verdict',
      apply(tmp) {
        const analysisPath = path.join(
          tmp,
          'plugin/src/knowledge/analyses/candidate.dev-as-ml-loop.json',
        );
        const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
        analysis.verdict = 'reject';
        writeJson(analysisPath, analysis);
      },
    },
    {
      name: 'witness',
      apply(tmp) {
        const analysisPath = path.join(
          tmp,
          'plugin/src/knowledge/analyses/candidate.dev-as-ml-loop.json',
        );
        const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
        analysis.witness.internal_cohesion = 999;
        writeJson(analysisPath, analysis);
      },
    },
    {
      name: 'evidence',
      apply(tmp) {
        const analysisPath = path.join(
          tmp,
          'plugin/src/knowledge/analyses/candidate.dev-as-ml-loop.json',
        );
        const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
        analysis.scoresheet.D3.evidence = `${analysis.scoresheet.D3.evidence} [hash-mutation-evidence]`;
        writeJson(analysisPath, analysis);
      },
    },
  ];

  for (const mutation of mutations) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `skg-k3-r07-${mutation.name}-`));
    try {
      seedPilotTree(tmp);
      mutation.apply(tmp);
      const mutated = buildAndValidateGraph({
        repoRoot: tmp,
        sourceRoot: 'plugin/src/knowledge',
      });
      assert.ok(
        mutated.graph?.graph_hash,
        `${mutation.name}: expected graph_hash even when admission fails`,
      );
      assert.notEqual(
        mutated.graph.graph_hash,
        baseHash,
        `${mutation.name}: canonical graph hash must change`,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});

test('SKG-K3-00-R08: multi-composition shared module derives reverse consumers only', async () => {
  const { buildAndValidateGraph } = await import('../../scripts/skill-knowledge/graph.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-k3-r08-'));
  try {
    const knowledge = path.join(tmp, 'plugin/src/knowledge');
    fs.mkdirSync(path.join(knowledge, 'graph/modules'), { recursive: true });
    fs.mkdirSync(path.join(knowledge, 'compositions'), { recursive: true });
    fs.mkdirSync(path.join(knowledge, 'analyses'), { recursive: true });
    const emptyUnbound =
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const hosts = [
      { host: 'claude-code', state: 'full' },
      { host: 'codex', state: 'full' },
      { host: 'cursor', state: 'full' },
      { host: 'kimi-code', state: 'full' },
    ];

    const point = (id, skill) => ({
      id,
      title: id,
      point_kind: 'principle',
      summary: id,
      recognition_cues: [id],
      binding: {
        path: `plugin/src/skills/${skill}/canonical/SKILL.md`,
        marker: id,
      },
      // subjectId = subject:<slug>; never prefix with point: (pattern forbids ':')
      authority: {
        role: 'canonical',
        subject: `subject:${id.replace(/^point:/, '')}`,
      },
      lifecycle: { state: 'accepted', since: '2026-07-24' },
      admission: {
        evidence: [{ kind: 'canonical-prose', ref: id }],
        verifiers: [{ kind: 'golden', ref: id }],
      },
    });

    writeJson(path.join(knowledge, 'graph/modules/devloop.core.json'), {
      schema_version: 'cc-master/skill-knowledge-source/v1alpha1',
      kind: 'module',
      id: 'module:devloop.core',
      title: 'shared.core',
      intent: 'shared SSOT module',
      recognition_cues: ['shared core'],
      boundary: { includes: ['shared'], excludes: ['private'] },
      access: {
        class: 'primary',
        relevant_entries: ['entry:shared-a', 'entry:shared-b'],
        primary_points: ['point:shared.a', 'point:shared.b'],
        rationale: 'shared fixture',
      },
      lifecycle: { state: 'accepted', since: '2026-07-24' },
      admission: {
        evidence: [{ kind: 'design', ref: 'shared' }],
        verifiers: [{ kind: 'golden', ref: 'shared' }],
      },
      points: [point('point:shared.a', 'shared-a'), point('point:shared.b', 'shared-b')],
      edges: [
        {
          id: 'edge:shared.a-to-b',
          type: 'next',
          from: 'point:shared.a',
          to: 'point:shared.b',
          when: ['next'],
          path_role: 'next',
          runtime: { enabled_by_default: true },
          lifecycle: { state: 'accepted', since: '2026-07-24' },
          admission: {
            evidence: [{ kind: 'design', ref: 'edge' }],
            verifiers: [{ kind: 'golden', ref: 'edge' }],
          },
        },
      ],
    });

    for (const [skill, pointId] of [
      ['shared-a', 'point:shared.a'],
      ['shared-b', 'point:shared.b'],
    ]) {
      const md = path.join(tmp, `plugin/src/skills/${skill}/canonical/SKILL.md`);
      fs.mkdirSync(path.dirname(md), { recursive: true });
      fs.writeFileSync(
        md,
        [
          `<!-- ccm:k:start ${pointId} -->`,
          pointId,
          `<!-- ccm:k:end ${pointId} -->`,
          '',
        ].join('\n'),
      );
    }

    const mkComposition = (skill, pointId) => ({
      schema_version: 'cc-master/skill-knowledge-source/v1alpha1',
      kind: 'composition',
      id: `composition:skill.${skill}`,
      skill_id: `skill:${skill}`,
      name: skill,
      package_root: `plugin/src/skills/${skill}`,
      intent: `Shared SSOT consumer ${skill}`,
      consumes: {
        modules: [
          {
            id: 'module:devloop.core',
            manifest: 'plugin/src/knowledge/graph/modules/devloop.core.json',
          },
        ],
      },
      entry_modules: ['module:devloop.core'],
      canonical_source_inventory: [
        {
          path: `plugin/src/skills/${skill}/canonical/SKILL.md`,
          coverage: 'full',
          point_ids: [pointId],
          reviewed_unbound_sha256: emptyUnbound,
        },
      ],
      host_coverage: hosts,
      analysis_ref: `analysis:candidate.${skill}`,
      lifecycle: { state: 'accepted', since: '2026-07-24' },
      admission: {
        evidence: [{ kind: 'design', ref: skill }],
        verifiers: [{ kind: 'review', ref: skill }],
      },
    });
    const mkAnalysis = (skill, compositionId) => ({
      schema_version: 'cc-master/skill-knowledge-source/v1alpha1',
      kind: 'candidate_analysis',
      id: `analysis:candidate.${skill}`,
      skill_id: `skill:${skill}`,
      composition_id: compositionId,
      candidate_modules: ['module:devloop.core'],
      scoresheet: {
        D1: {
          score: 1,
          audience_plane: 'runtime-user',
          evidence: 'user-plane shared consumer',
        },
        D2: {
          score: 1,
          bounded_context: 'single shared-SSOT consumer job',
          evidence: 'single job slice over shared SSOT',
        },
        D3: {
          probe_a: 'strong',
          probe_b: 'strong',
          evidence: 'Counterfactual A/B both strong for shared-view fixture.',
          evidence_refs: [`plugin/src/skills/${skill}/canonical/SKILL.md`],
        },
      },
      graph_metrics: {
        module_count: 1,
        point_count: 2,
        internal_edge_count: 1,
        external_edge_count: 0,
      },
      verdict: 'admit',
      witness: { reason: 'shared-ssot-fixture', composition_id: compositionId },
      lifecycle: { state: 'accepted', since: '2026-07-24' },
      admission: {
        evidence: [
          {
            kind: 'canonical-prose',
            ref: `plugin/src/skills/${skill}/canonical/SKILL.md`,
          },
        ],
        verifiers: [{ kind: 'review', ref: skill }],
      },
    });

    const aComp = mkComposition('shared-a', 'point:shared.a');
    const bComp = mkComposition('shared-b', 'point:shared.b');
    writeJson(path.join(knowledge, 'compositions/skill.shared-a.json'), aComp);
    writeJson(path.join(knowledge, 'compositions/skill.shared-b.json'), bComp);
    writeJson(
      path.join(knowledge, 'analyses/candidate.shared-a.json'),
      mkAnalysis('shared-a', aComp.id),
    );
    writeJson(
      path.join(knowledge, 'analyses/candidate.shared-b.json'),
      mkAnalysis('shared-b', bComp.id),
    );
    writeJson(path.join(knowledge, 'portfolio.json'), {
      schema_version: 'cc-master/skill-knowledge-source/v1alpha1',
      kind: 'portfolio',
      id: 'portfolio:shared-ssot-fixture',
      runtime_hosts: ['claude-code', 'codex', 'cursor', 'kimi-code'],
      skills: [
        { id: 'skill:shared-a', manifest: 'plugin/src/knowledge/compositions/skill.shared-a.json' },
        { id: 'skill:shared-b', manifest: 'plugin/src/knowledge/compositions/skill.shared-b.json' },
      ],
      entries: ['shared-a', 'shared-b'].map((skill) => ({
        id: `entry:${skill}`,
        label: skill,
        recognition_cues: [skill],
        surfaces: hosts.map((row) => ({
          host: row.host,
          source_file: `plugin/src/skills/${skill}/canonical/SKILL.md`,
          binding: {
            kind: 'marker',
            value: skill === 'shared-a' ? 'point:shared.a' : 'point:shared.b',
          },
          surface_kind: 'skill_entry',
          targets: [
            {
              skill: `skill:${skill}`,
              module: 'module:devloop.core',
              point: skill === 'shared-a' ? 'point:shared.a' : 'point:shared.b',
            },
          ],
          lifecycle: { state: 'accepted', since: '2026-07-24' },
        })),
        lifecycle: { state: 'accepted', since: '2026-07-24' },
        admission: {
          evidence: [
            {
              kind: 'canonical-prose',
              ref: `plugin/src/skills/${skill}/canonical/SKILL.md`,
            },
          ],
          verifiers: [{ kind: 'review', ref: `entry-${skill}` }],
        },
      })),
      hop_policy: {
        point_diameter_max: 3,
        entry_discovery_max: 3,
        critical_entry_to_primary_max: 1,
        critical_any_point_to_primary_max: 2,
        primary_entry_to_primary_max: 2,
      },
      critical_pin_budget: { max_modules: 4, max_fraction: 0.5 },
      router_budget: {
        atlas_max_lines: 120,
        atlas_max_tokens: 1800,
        module_max_lines: 80,
        module_max_tokens: 1200,
        point_nav_max_lines: 4,
      },
      candidate_admission: {
        inventory_max_utf8_bytes: 65536,
        inventory_max_lines: 2000,
        inventory_max_tokens: 20000,
        min_internal_cohesion: 0.5,
        max_external_edge_count: 0,
        max_overlap_shared_modules: 2,
        require_ssot_closure: true,
        require_four_host_denominator: true,
        reject_all_hosts_unsupported: true,
        require_declared_projection: true,
        hop_gate: 'directed_projection_topology',
      },
      rollout: 'K1',
    });

    for (const skill of ['shared-a', 'shared-b']) {
      for (const host of ['claude-code', 'codex', 'cursor', 'kimi-code']) {
        const strategyDir = path.join(tmp, `plugin/src/skills/${skill}/adapters`, host);
        fs.mkdirSync(strategyDir, { recursive: true });
        fs.writeFileSync(
          path.join(strategyDir, 'strategy.yaml'),
          ['mode: copy', 'copy: true', ''].join('\n'),
        );
      }
    }

    const { computeCandidateMetrics, consumeModuleIds } = await import(
      '../../scripts/skill-knowledge/candidate-analysis.mjs'
    );
    const provisional = buildAndValidateGraph({
      repoRoot: tmp,
      sourceRoot: 'plugin/src/knowledge',
      skipCompositionAdmission: true,
    });
    assert.ok(provisional.graph);
    for (const [skill, composition] of [
      ['shared-a', aComp],
      ['shared-b', bComp],
    ]) {
      const metrics = computeCandidateMetrics({
        graph: provisional.graph,
        moduleIds: consumeModuleIds(composition),
        composition,
        repoRoot: tmp,
      });
      assert.equal(
        metrics.admission_gates.ok,
        true,
        `${skill}: ${JSON.stringify(metrics.admission_gates)}`,
      );
      writeJson(path.join(knowledge, `analyses/candidate.${skill}.json`), {
        ...mkAnalysis(skill, composition.id),
        graph_metrics: metrics.graph_metrics,
        verdict: 'admit',
        witness: {
          reason: 'shared-ssot-fixture',
          composition_id: composition.id,
          ...metrics.witness_metrics,
          graph_metrics: metrics.graph_metrics,
          admission_gates: {
            ok: metrics.admission_gates.ok,
            module_count_matches_candidate:
              metrics.admission_gates.module_count_matches_candidate,
            point_count_positive: metrics.admission_gates.point_count_positive,
            trigger_job_coherence: metrics.admission_gates.trigger_job_coherence,
            ssot_closure: metrics.admission_gates.ssot_closure,
            internal_cohesion: metrics.admission_gates.internal_cohesion,
            external_cut: metrics.admission_gates.external_cut,
            overlap_within_budget: metrics.admission_gates.overlap_within_budget,
            hop: metrics.admission_gates.hop,
            read_budget: metrics.admission_gates.read_budget,
            token_budget: metrics.admission_gates.token_budget,
            four_host_denominator: metrics.admission_gates.four_host_denominator,
            host_portability: metrics.admission_gates.host_portability,
          },
        },
      });
    }

    const built = buildAndValidateGraph({
      repoRoot: tmp,
      sourceRoot: 'plugin/src/knowledge',
    });
    assert.equal(
      built.ok,
      true,
      JSON.stringify(built.diagnostics.filter((d) => d.severity === 'error').slice(0, 5)),
    );
    const core = built.graph.modules.find((m) => m.id === 'module:devloop.core');
    assert.ok(core);
    assert.equal(core.owner_skill, undefined);
    assert.ok(Array.isArray(core.consumers));
    assert.ok(core.consumers.includes('skill:shared-a'));
    assert.ok(core.consumers.includes('skill:shared-b'));
    assert.deepEqual(core.consumers, ['skill:shared-a', 'skill:shared-b']);
    for (const pointId of ['point:shared.a', 'point:shared.b']) {
      const placements = built.graph.points.filter((point) => point.id === pointId);
      assert.equal(placements.length, 1, `${pointId} must have one global placement`);
      assert.equal(placements[0].module_id, 'module:devloop.core');
      assert.equal(placements[0].authority.role, 'canonical');
      const sameSubjectCanonicals = built.graph.points.filter(
        (point) =>
          point.authority?.role === 'canonical' &&
          point.authority.subject === placements[0].authority.subject,
      );
      assert.equal(
        sameSubjectCanonicals.length,
        1,
        `${pointId} authority must remain globally unique`,
      );
    }
    const { runExplain } = await import('../../scripts/skill-knowledge/query.mjs');
    const explained = runExplain({
      repoRoot: tmp,
      source: 'plugin/src/knowledge',
      target: 'module:devloop.core',
    });
    assert.equal(explained.exitCode, 0, JSON.stringify(explained.body.diagnostics));
    assert.deepEqual(explained.body.entity.witness.consumers, [
      'skill:shared-a',
      'skill:shared-b',
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('SKG-K3-00-R09: ownerless module+composition+analysis typed change begin/validate exits naturally', async () => {
  const { beginTransaction, validateTransaction } = await import(
    '../../scripts/skill-knowledge/transactions.mjs'
  );
  const { buildAndValidateGraph } = await import('../../scripts/skill-knowledge/graph.mjs');
  const { computeCandidateMetrics, consumeModuleIds } = await import(
    '../../scripts/skill-knowledge/candidate-analysis.mjs'
  );
  const { resolveHostCoveragePlan } = await import(
    '../../scripts/skill-knowledge/host-coverage.mjs'
  );
  const { PRODUCT_HOSTS } = await import('../../scripts/skill-knowledge/compile/paths.mjs');

  const sha256File = (abs) => crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  const runGit = (args, cwd) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')}\n${result.stderr}`);
  };

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-k3-r09-'));
  let workspace = null;
  try {
    // Allowlist only — never copy plugin/dist (runtime builds it; avoids codex-marketplace).
    for (const rel of [
      'plugin/src',
      'scripts',
      'design_docs/skill-knowledge-graph',
      'ccm/apps/cli/src/provider-model-facts.json',
    ]) {
      const from = path.join(repoRoot, rel);
      const to = path.join(root, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.cpSync(from, to, { recursive: true });
    }
    assert.equal(fs.existsSync(path.join(root, 'plugin/dist')), false);

    // Keep the real runtime skills and accepted knowledge graph. The demo
    // composition is added alongside them so production attestation receives
    // its genuine required guidance inputs without a fixture bypass.

    const modulePath = 'plugin/src/knowledge/graph/modules/demo.core.json';
    const compositionPath = 'plugin/src/knowledge/compositions/skill.demo.json';
    const analysisPath = 'plugin/src/knowledge/analyses/candidate.demo.json';
    const markdownPath = 'plugin/src/skills/demo/canonical/SKILL.md';
    const hosts = [...PRODUCT_HOSTS];
    const emptyUnbound =
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    fs.mkdirSync(path.join(root, 'plugin/src/knowledge/graph/modules'), { recursive: true });
    fs.mkdirSync(path.join(root, 'plugin/src/knowledge/compositions'), { recursive: true });
    fs.mkdirSync(path.join(root, 'plugin/src/knowledge/analyses'), { recursive: true });

    fs.mkdirSync(path.join(root, path.dirname(markdownPath)), { recursive: true });
    fs.writeFileSync(
      path.join(root, markdownPath),
      [
        '<!-- ccm:k:start point:demo.one -->',
        'one',
        '<!-- ccm:k:end point:demo.one -->',
        '',
      ].join('\n'),
    );
    for (const host of hosts) {
      const strategyDir = path.join(root, 'plugin/src/skills/demo/adapters', host);
      fs.mkdirSync(strategyDir, { recursive: true });
      fs.writeFileSync(
        path.join(strategyDir, 'strategy.yaml'),
        [
          `host: ${host}`,
          'skill: demo',
          'version: 1',
          'projection:',
          '  source: canonical/',
          '  target: skills/demo/',
          '  copy: true',
          '',
        ].join('\n'),
      );
    }

    writeJson(path.join(root, modulePath), {
      schema_version: 'cc-master/skill-knowledge-source/v1alpha1',
      kind: 'module',
      id: 'module:demo.core',
      title: 'demo.core',
      intent: 'ownerless demo module',
      recognition_cues: ['demo core'],
      boundary: { includes: ['demo'], excludes: ['other'] },
      access: {
        class: 'primary',
        relevant_entries: ['entry:demo'],
        primary_points: ['point:demo.one'],
        rationale: 'demo',
      },
      lifecycle: { state: 'accepted', since: '2026-07-24' },
      admission: {
        evidence: [{ kind: 'canonical-prose', ref: 'demo' }],
        verifiers: [{ kind: 'golden', ref: 'demo' }],
      },
      points: [
        {
          id: 'point:demo.one',
          title: 'demo.one',
          point_kind: 'principle',
          summary: 'demo one',
          recognition_cues: ['demo one'],
          binding: { path: markdownPath, marker: 'point:demo.one' },
          authority: { role: 'canonical', subject: 'subject:demo.one' },
          lifecycle: { state: 'accepted', since: '2026-07-24' },
          admission: {
            evidence: [{ kind: 'canonical-prose', ref: 'demo.one' }],
            verifiers: [{ kind: 'golden', ref: 'demo.one' }],
          },
        },
      ],
      edges: [],
    });

    const composition = {
      schema_version: 'cc-master/skill-knowledge-source/v1alpha1',
      kind: 'composition',
      id: 'composition:skill.demo',
      skill_id: 'skill:demo',
      name: 'demo',
      package_root: 'plugin/src/skills/demo',
      intent: 'demo composition over ownerless module',
      consumes: {
        modules: [{ id: 'module:demo.core', manifest: modulePath }],
      },
      entry_modules: ['module:demo.core'],
      canonical_source_inventory: [
        {
          path: markdownPath,
          coverage: 'full',
          point_ids: ['point:demo.one'],
          reviewed_unbound_sha256: emptyUnbound,
        },
      ],
      host_coverage: hosts.map((host) => ({ host, state: 'full' })),
      analysis_ref: 'analysis:candidate.demo',
      lifecycle: { state: 'accepted', since: '2026-07-24' },
      admission: {
        evidence: [{ kind: 'design', ref: 'demo' }],
        verifiers: [{ kind: 'review', ref: 'demo' }],
      },
    };
    writeJson(path.join(root, compositionPath), composition);

    const portfolioPath = path.join(root, 'plugin/src/knowledge/portfolio.json');
    const portfolio = JSON.parse(fs.readFileSync(portfolioPath, 'utf8'));
    portfolio.skills.push({ id: 'skill:demo', manifest: compositionPath });
    portfolio.entries.push({
      id: 'entry:demo',
      label: 'demo',
      recognition_cues: ['demo'],
      surfaces: hosts.map((host) => ({
        host,
        source_file: markdownPath,
        binding: { kind: 'marker', value: 'point:demo.one' },
        surface_kind: 'skill_entry',
        targets: [
          {
            skill: 'skill:demo',
            module: 'module:demo.core',
            point: 'point:demo.one',
          },
        ],
        lifecycle: { state: 'accepted', since: '2026-07-24' },
      })),
      lifecycle: { state: 'accepted', since: '2026-07-24' },
      admission: {
        evidence: [{ kind: 'canonical-prose', ref: markdownPath }],
        verifiers: [{ kind: 'review', ref: 'entry-demo' }],
      },
    });
    writeJson(portfolioPath, portfolio);

    const provisional = buildAndValidateGraph({
      repoRoot: root,
      sourceRoot: 'plugin/src/knowledge',
      skipCompositionAdmission: true,
    });
    assert.ok(provisional.graph, JSON.stringify(provisional.diagnostics?.slice(0, 5)));
    const metrics = computeCandidateMetrics({
      graph: provisional.graph,
      moduleIds: consumeModuleIds(composition),
      composition,
      repoRoot: root,
    });
    assert.equal(metrics.admission_gates.ok, true, JSON.stringify(metrics.admission_gates));
    writeJson(path.join(root, analysisPath), {
      schema_version: 'cc-master/skill-knowledge-source/v1alpha1',
      kind: 'candidate_analysis',
      id: 'analysis:candidate.demo',
      skill_id: 'skill:demo',
      composition_id: 'composition:skill.demo',
      candidate_modules: ['module:demo.core'],
      scoresheet: {
        D1: {
          score: 1,
          audience_plane: 'runtime-user',
          evidence: 'user plane demo',
        },
        D2: {
          score: 1,
          bounded_context: 'single demo runtime job',
          evidence: 'single job',
        },
        D3: {
          probe_a: 'strong',
          probe_b: 'strong',
          evidence: 'Counterfactual A/B strong for demo.',
          evidence_refs: [markdownPath],
        },
      },
      graph_metrics: metrics.graph_metrics,
      verdict: 'admit',
      witness: {
        reason: 'demo-derived',
        composition_id: 'composition:skill.demo',
        ...metrics.witness_metrics,
        graph_metrics: metrics.graph_metrics,
        admission_gates: {
          ok: metrics.admission_gates.ok,
          module_count_matches_candidate:
            metrics.admission_gates.module_count_matches_candidate,
          point_count_positive: metrics.admission_gates.point_count_positive,
          trigger_job_coherence: metrics.admission_gates.trigger_job_coherence,
          ssot_closure: metrics.admission_gates.ssot_closure,
          internal_cohesion: metrics.admission_gates.internal_cohesion,
          external_cut: metrics.admission_gates.external_cut,
          overlap_within_budget: metrics.admission_gates.overlap_within_budget,
          hop: metrics.admission_gates.hop,
          read_budget: metrics.admission_gates.read_budget,
          token_budget: metrics.admission_gates.token_budget,
          four_host_denominator: metrics.admission_gates.four_host_denominator,
          host_portability: metrics.admission_gates.host_portability,
        },
      },
      lifecycle: { state: 'accepted', since: '2026-07-24' },
      admission: {
        evidence: [{ kind: 'canonical-prose', ref: markdownPath }],
        verifiers: [{ kind: 'review', ref: 'demo' }],
      },
    });

    const admitted = buildAndValidateGraph({
      repoRoot: root,
      sourceRoot: 'plugin/src/knowledge',
    });
    assert.equal(
      admitted.ok,
      true,
      JSON.stringify(admitted.diagnostics.filter((d) => d.severity === 'error').slice(0, 8)),
    );
    const core = admitted.graph.modules.find((m) => m.id === 'module:demo.core');
    assert.ok(core);
    assert.equal(core.owner_skill, undefined);
    assert.deepEqual(core.consumers, ['skill:demo']);
    assert.ok(
      admitted.graph.compositions.some((item) => item.id === 'composition:skill.demo'),
    );
    assert.ok(
      admitted.graph.candidate_analyses.some(
        (item) => item.id === 'analysis:candidate.demo',
      ),
    );
    const projected = admitted.graph.skills.find((s) => s.id === 'skill:demo');
    assert.ok(projected, 'admitted composition must project skill:demo');
    assert.equal(projected._from_composition, true);
    assert.equal(projected._composition_id, 'composition:skill.demo');
    assert.equal(projected._analysis_ref, 'analysis:candidate.demo');
    const baseGraphHash = admitted.graph.graph_hash;
    assert.match(baseGraphHash, /^[a-f0-9]{64}$/);
    const coveragePlan = resolveHostCoveragePlan(admitted.graph);
    assert.deepEqual(coveragePlan.diagnostics, []);

    // Independent governance-hash mutations (not only change-record bytes).
    {
      const compositionDoc = JSON.parse(fs.readFileSync(path.join(root, compositionPath), 'utf8'));
      compositionDoc.intent = `${compositionDoc.intent} [hash-intent]`;
      writeJson(path.join(root, compositionPath), compositionDoc);
      const afterIntent = buildAndValidateGraph({
        repoRoot: root,
        sourceRoot: 'plugin/src/knowledge',
      });
      assert.ok(afterIntent.graph?.graph_hash);
      assert.notEqual(afterIntent.graph.graph_hash, baseGraphHash);
      compositionDoc.intent = compositionDoc.intent.replace(' [hash-intent]', '');
      writeJson(path.join(root, compositionPath), compositionDoc);
    }
    {
      const analysisDoc = JSON.parse(fs.readFileSync(path.join(root, analysisPath), 'utf8'));
      analysisDoc.scoresheet.D1.evidence = `${analysisDoc.scoresheet.D1.evidence} [hash-evidence]`;
      writeJson(path.join(root, analysisPath), analysisDoc);
      const afterEvidence = buildAndValidateGraph({
        repoRoot: root,
        sourceRoot: 'plugin/src/knowledge',
      });
      assert.ok(afterEvidence.graph?.graph_hash);
      assert.notEqual(afterEvidence.graph.graph_hash, baseGraphHash);
      analysisDoc.scoresheet.D1.evidence = analysisDoc.scoresheet.D1.evidence.replace(
        ' [hash-evidence]',
        '',
      );
      writeJson(path.join(root, analysisPath), analysisDoc);
    }
    const restored = buildAndValidateGraph({
      repoRoot: root,
      sourceRoot: 'plugin/src/knowledge',
    });
    assert.equal(restored.graph.graph_hash, baseGraphHash);

    runGit(['init', '-q'], root);
    runGit(['config', 'user.email', 'skg@example.test'], root);
    runGit(['config', 'user.name', 'SKG Test'], root);
    runGit(['add', '.'], root);
    runGit(['commit', '-qm', 'base'], root);

    const acceptedDigests = Object.fromEntries(
      [modulePath, compositionPath, analysisPath].map((rel) => [
        rel,
        sha256File(path.join(root, rel)),
      ]),
    );
    const ledgerDir = path.join(root, 'plugin/src/knowledge/changes');
    const ledgerBefore = fs.existsSync(ledgerDir)
      ? fs.readdirSync(ledgerDir).sort().join('\0')
      : '';

    const begin = beginTransaction({
      repoRoot: root,
      operation: 'refine',
      scope: [modulePath, compositionPath, analysisPath],
      base: 'HEAD',
    });
    assert.equal(begin.exitCode, 0, JSON.stringify(begin.diagnostics?.slice(0, 5)));
    workspace = begin.workspace;
    assert.equal(begin.workspaceDocument.scope.length, 3);
    assert.deepEqual(
      begin.workspaceDocument.scope.map((item) => item.path),
      [modulePath, compositionPath, analysisPath],
    );
    for (const item of begin.workspaceDocument.scope) {
      assert.match(item.sha256, /^[a-f0-9]{64}$/);
      assert.equal(item.sha256, acceptedDigests[item.path]);
    }

    const beforeBytes = Object.fromEntries(
      [modulePath, compositionPath, analysisPath].map((rel) => [
        rel,
        fs.readFileSync(path.join(workspace, 'candidate', rel)),
      ]),
    );

    const candidateModule = path.join(workspace, 'candidate', modulePath);
    const candidateComposition = path.join(workspace, 'candidate', compositionPath);
    const candidateAnalysis = path.join(workspace, 'candidate', analysisPath);
    const moduleDoc = JSON.parse(fs.readFileSync(candidateModule, 'utf8'));
    moduleDoc.intent = `${moduleDoc.intent} (typed-change)`;
    writeJson(candidateModule, moduleDoc);
    const compositionDoc = JSON.parse(fs.readFileSync(candidateComposition, 'utf8'));
    compositionDoc.intent = `${compositionDoc.intent} (typed-change)`;
    writeJson(candidateComposition, compositionDoc);
    const analysisDoc = JSON.parse(fs.readFileSync(candidateAnalysis, 'utf8'));
    analysisDoc.scoresheet.D1.evidence = `${analysisDoc.scoresheet.D1.evidence} (typed-change)`;
    writeJson(candidateAnalysis, analysisDoc);

    const draftPath = path.join(workspace, 'change.draft.json');
    const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
    draft.reason = 'ownerless module/composition/analysis refine';
    draft.evidence = [{ kind: 'test', ref: 'skill-knowledge-k3-00-reviewer-mutations.test.mjs' }];
    draft.operations = [
      {
        op: 'refine',
        subject: 'module:demo.core',
        changed_fields: ['intent'],
        rationale: 'Clarify module intent without inventing ownership',
      },
      {
        op: 'refine',
        subject: 'composition:skill.demo',
        changed_fields: ['intent'],
        rationale: 'Clarify composition intent',
      },
      {
        op: 'refine',
        subject: 'analysis:candidate.demo',
        changed_fields: ['scoresheet.D1.evidence'],
        rationale: 'Clarify Counterfactual evidence wording',
      },
    ];
    writeJson(draftPath, draft);

    const validated = validateTransaction({ repoRoot: root, workspace });
    assert.equal(
      validated.exitCode,
      0,
      JSON.stringify(validated.diagnostics?.filter((d) => d.severity === 'error').slice(0, 12)),
    );
    assert.equal(
      (validated.diagnostics ?? []).filter((d) => d.severity === 'error').length,
      0,
    );
    assert.equal(validated.validation.candidate_valid, true);
    assert.equal(validated.validation.candidate_runtime_valid, true);
    assert.match(validated.validation.result_graph_sha256, /^[a-f0-9]{64}$/);
    assert.equal(validated.change.result_graph_sha256, validated.validation.result_graph_sha256);
    assert.notEqual(validated.validation.result_graph_sha256, validated.validation.base_graph_sha256);
    assert.equal(validated.change.operations.length, 3);
    assert.deepEqual(
      validated.change.operations.map((op) => op.subject),
      ['module:demo.core', 'composition:skill.demo', 'analysis:candidate.demo'],
    );
    assert.equal(validated.change.scope.length, 3);
    for (const item of validated.change.scope) {
      assert.notEqual(item.before_sha256, item.after_sha256, item.path);
      assert.match(item.before_sha256, /^[a-f0-9]{64}$/);
      assert.match(item.after_sha256, /^[a-f0-9]{64}$/);
    }

    const witnesses = validated.validation.host_projection_witnesses;
    assert.deepEqual(
      witnesses.map((w) => w.host),
      hosts,
    );
    for (const witness of witnesses) {
      assert.equal(witness.ok, true, witness.host);
      assert.equal(witness.mode, coveragePlan.plan[witness.host].mode, witness.host);
      assert.ok(witness.executed_checks.includes('candidate_runtime_sync'), witness.host);
      if (witness.mode === 'full') {
        assert.ok(
          witness.executed_checks.includes('candidate_runtime_compile_check'),
          witness.host,
        );
      } else {
        assert.equal(witness.mode, 'partial', witness.host);
        assert.ok(
          witness.executed_checks.includes('candidate_runtime_partial_tree'),
          witness.host,
        );
      }
      assert.ok(
        witness.executed_checks.includes('candidate_runtime_final_surface_snapshot'),
        witness.host,
      );
      for (const gate of ['H1', 'H2', 'H3', 'H4']) {
        assert.equal(witness.hop_report[gate].ok, true, `${witness.host} ${gate}`);
        assert.notEqual(witness.hop_report[gate].witness?.skipped, true, `${witness.host} ${gate}`);
        assert.notEqual(
          witness.hop_report[gate].witness?.abstained,
          true,
          `${witness.host} ${gate}`,
        );
      }
      assert.ok(witness.final_surface_snapshot, `${witness.host} snapshot`);
    }

    assert.equal(
      fs.existsSync(path.join(workspace, 'runtime-candidate')),
      false,
      'runtime root must be cleaned after validate',
    );
    for (const [rel, digest] of Object.entries(acceptedDigests)) {
      assert.equal(sha256File(path.join(root, rel)), digest, `accepted source drifted: ${rel}`);
    }
    assert.equal(fs.existsSync(path.join(root, 'plugin/dist')), false);
    const ledgerAfter = fs.existsSync(ledgerDir)
      ? fs.readdirSync(ledgerDir).sort().join('\0')
      : '';
    assert.equal(ledgerAfter, ledgerBefore);
    void beforeBytes;
  } finally {
    if (workspace && fs.existsSync(workspace)) {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SKG-K3-00-R10: witness gates fail closed for unsupported hosts/budget/unreachable/forged metrics', async () => {
  const { analyzeSkillCandidate } = await import(
    '../../scripts/skill-knowledge/graph-first.mjs'
  );
  const { buildAndValidateGraph } = await import('../../scripts/skill-knowledge/graph.mjs');
  const { computeCandidateMetrics, consumeModuleIds, analyzeAgainstGraph } = await import(
    '../../scripts/skill-knowledge/candidate-analysis.mjs'
  );

  // Happy path still persists real witness metrics.
  const happy = analyzeSkillCandidate({
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
  assert.equal(happy.ok, true, JSON.stringify(happy.diagnostics ?? happy));
  assert.equal(happy.verdict, 'admit');
  assert.ok(happy.witness?.admission_gates?.ok);
  assert.ok(happy.witness?.budgets?.read?.utf8_bytes > 100);
  assert.notEqual(
    happy.witness?.budgets?.hop?.observed?.undirected_entry_distance_max,
    happy.witness?.budgets?.hop?.policy?.critical_any_point_to_primary_max,
  );

  // 1) Four-host all unsupported → reject.
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-k3-r10-hosts-'));
    try {
      seedPilotTree(tmp);
      const compositionPath = path.join(
        tmp,
        'plugin/src/knowledge/compositions/skill.dev-as-ml-loop.json',
      );
      const composition = JSON.parse(fs.readFileSync(compositionPath, 'utf8'));
      composition.host_coverage = composition.host_coverage.map((row) => ({
        ...row,
        state: 'unsupported',
      }));
      writeJson(compositionPath, composition);
      for (const host of ['claude-code', 'codex', 'cursor', 'kimi-code']) {
        fs.writeFileSync(
          path.join(tmp, composition.package_root, 'adapters', host, 'strategy.yaml'),
          'mode: unsupported_stub\n',
        );
      }
      const built = buildAndValidateGraph({
        repoRoot: tmp,
        sourceRoot: 'plugin/src/knowledge',
        skipCompositionAdmission: true,
      });
      const metrics = computeCandidateMetrics({
        graph: built.graph,
        moduleIds: consumeModuleIds(composition),
        composition,
        repoRoot: tmp,
      });
      assert.equal(metrics.admission_gates.host_portability, false);
      assert.equal(metrics.admission_gates.ok, false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // 2) Real inventory body over policy budget → reject.
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-k3-r10-budget-'));
    try {
      seedPilotTree(tmp);
      const portfolioPath = path.join(tmp, 'plugin/src/knowledge/portfolio.json');
      const portfolio = JSON.parse(fs.readFileSync(portfolioPath, 'utf8'));
      portfolio.candidate_admission = {
        ...(portfolio.candidate_admission ?? {}),
        inventory_max_tokens: 10,
        inventory_max_lines: 5,
        inventory_max_utf8_bytes: 100,
      };
      writeJson(portfolioPath, portfolio);
      const composition = JSON.parse(
        fs.readFileSync(
          path.join(tmp, 'plugin/src/knowledge/compositions/skill.dev-as-ml-loop.json'),
          'utf8',
        ),
      );
      const built = buildAndValidateGraph({
        repoRoot: tmp,
        sourceRoot: 'plugin/src/knowledge',
        skipCompositionAdmission: true,
      });
      const metrics = computeCandidateMetrics({
        graph: built.graph,
        moduleIds: consumeModuleIds(composition),
        composition,
        repoRoot: tmp,
      });
      assert.equal(metrics.admission_gates.read_budget, false);
      assert.equal(metrics.admission_gates.token_budget, false);
      assert.equal(metrics.admission_gates.ok, false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // 3) Directed projection diameter over budget → hop gate reject.
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-k3-r10-hop-'));
    try {
      seedPilotTree(tmp);
      const portfolioPath = path.join(tmp, 'plugin/src/knowledge/portfolio.json');
      const portfolio = JSON.parse(fs.readFileSync(portfolioPath, 'utf8'));
      portfolio.hop_policy = {
        ...(portfolio.hop_policy ?? {}),
        point_diameter_max: 0,
      };
      writeJson(portfolioPath, portfolio);
      const composition = JSON.parse(
        fs.readFileSync(
          path.join(tmp, 'plugin/src/knowledge/compositions/skill.dev-as-ml-loop.json'),
          'utf8',
        ),
      );
      const built = buildAndValidateGraph({
        repoRoot: tmp,
        sourceRoot: 'plugin/src/knowledge',
        skipCompositionAdmission: true,
      });
      const metrics = computeCandidateMetrics({
        graph: built.graph,
        moduleIds: consumeModuleIds(composition),
        composition,
        repoRoot: tmp,
      });
      assert.equal(metrics.admission_gates.hop, false);
      assert.equal(metrics.admission_gates.ok, false);
      assert.ok(metrics.witness_metrics.hop.projected_directed_diameter > 0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // 4) Forged graph_metrics / witness must reject.
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-k3-r10-forge-'));
    try {
      seedPilotTree(tmp);
      const analysisPath = path.join(
        tmp,
        'plugin/src/knowledge/analyses/candidate.dev-as-ml-loop.json',
      );
      const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
      analysis.graph_metrics.point_count = 999;
      analysis.witness.internal_cohesion = 999;
      writeJson(analysisPath, analysis);
      const result = analyzeSkillCandidate({
        repoRoot: tmp,
        skillId: 'skill:dev-as-ml-loop',
        moduleIds: [
          'module:devloop.core',
          'module:devloop.outer',
          'module:devloop.ledger',
        ],
        analysisId: 'analysis:candidate.dev-as-ml-loop',
        compositionId: 'composition:skill.dev-as-ml-loop',
      });
      assert.equal(result.ok, false);
      assert.ok(
        (result.diagnostics ?? []).some(
          (d) =>
            d.code === 'SKG-ANALYSIS-METRICS-MISMATCH' ||
            d.code === 'SKG-ANALYSIS-WITNESS-MISMATCH',
        ),
        JSON.stringify(result.diagnostics ?? result),
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  void analyzeAgainstGraph;
});

test('SKG-K3-00-R11A: mode copy + missing slot replacement rejects host_portability', async () => {
  const { buildAndValidateGraph } = await import('../../scripts/skill-knowledge/graph.mjs');
  const { computeCandidateMetrics, consumeModuleIds, projectionCapabilityForHost } =
    await import('../../scripts/skill-knowledge/candidate-analysis.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-k3-r11a-'));
  try {
    seedPilotTree(tmp);
    const composition = JSON.parse(
      fs.readFileSync(
        path.join(tmp, 'plugin/src/knowledge/compositions/skill.dev-as-ml-loop.json'),
        'utf8',
      ),
    );
    // Live four hosts still plan successfully before the attack.
    for (const host of ['claude-code', 'codex', 'cursor', 'kimi-code']) {
      const capability = projectionCapabilityForHost(tmp, composition, host);
      assert.equal(capability.planner_ok, true, `${host}: ${capability.error}`);
      assert.ok(
        capability.state === 'full' || capability.state === 'partial',
        `${host} state=${capability.state}`,
      );
    }
    const strategyPath = path.join(
      tmp,
      'plugin/src/skills/dev-as-ml-loop/adapters/claude-code/strategy.yaml',
    );
    fs.writeFileSync(
      strategyPath,
      [
        'mode: copy',
        'slot_replacements:',
        '  "{{MISSING_SLOT}}": adapters/claude-code/does-not-exist.md',
        '',
      ].join('\n'),
    );
    const attacked = projectionCapabilityForHost(tmp, composition, 'claude-code');
    assert.equal(attacked.planner_ok, false);
    assert.match(String(attacked.error), /missing slot replacement/i);
    const built = buildAndValidateGraph({
      repoRoot: tmp,
      sourceRoot: 'plugin/src/knowledge',
      skipCompositionAdmission: true,
    });
    const metrics = computeCandidateMetrics({
      graph: built.graph,
      moduleIds: consumeModuleIds(composition),
      composition,
      repoRoot: tmp,
    });
    assert.equal(metrics.admission_gates.host_portability, false);
    assert.equal(metrics.admission_gates.ok, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('SKG-K3-00-R11B: fabricated witness extra key is rejected', async () => {
  const { analyzeSkillCandidate } = await import(
    '../../scripts/skill-knowledge/graph-first.mjs'
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-k3-r11b-'));
  try {
    seedPilotTree(tmp);
    const analysisPath = path.join(
      tmp,
      'plugin/src/knowledge/analyses/candidate.dev-as-ml-loop.json',
    );
    const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
    analysis.witness.untrusted_payload = { forged: true };
    writeJson(analysisPath, analysis);
    const result = analyzeSkillCandidate({
      repoRoot: tmp,
      skillId: 'skill:dev-as-ml-loop',
      moduleIds: [
        'module:devloop.core',
        'module:devloop.outer',
        'module:devloop.ledger',
      ],
      analysisId: 'analysis:candidate.dev-as-ml-loop',
      compositionId: 'composition:skill.dev-as-ml-loop',
    });
    assert.equal(result.ok, false);
    assert.ok(
      (result.diagnostics ?? []).some((d) => d.code === 'SKG-ANALYSIS-WITNESS-EXTRA'),
      JSON.stringify(result.diagnostics ?? result),
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('SKG-K3-00-R11D: low cohesion and overlap-over-budget reject', async () => {
  const { buildAndValidateGraph } = await import('../../scripts/skill-knowledge/graph.mjs');
  const { computeCandidateMetrics, consumeModuleIds } = await import(
    '../../scripts/skill-knowledge/candidate-analysis.mjs'
  );

  // Low cohesion: raise threshold above observed edges/points.
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-k3-r11d-cohesion-'));
    try {
      seedPilotTree(tmp);
      const portfolioPath = path.join(tmp, 'plugin/src/knowledge/portfolio.json');
      const portfolio = JSON.parse(fs.readFileSync(portfolioPath, 'utf8'));
      portfolio.candidate_admission = {
        ...(portfolio.candidate_admission ?? {}),
        min_internal_cohesion: 99,
      };
      writeJson(portfolioPath, portfolio);
      const composition = JSON.parse(
        fs.readFileSync(
          path.join(tmp, 'plugin/src/knowledge/compositions/skill.dev-as-ml-loop.json'),
          'utf8',
        ),
      );
      const built = buildAndValidateGraph({
        repoRoot: tmp,
        sourceRoot: 'plugin/src/knowledge',
        skipCompositionAdmission: true,
      });
      const metrics = computeCandidateMetrics({
        graph: built.graph,
        moduleIds: consumeModuleIds(composition),
        composition,
        repoRoot: tmp,
      });
      assert.ok(metrics.witness_metrics.internal_cohesion < 99);
      assert.equal(metrics.admission_gates.internal_cohesion, false);
      assert.equal(metrics.admission_gates.ok, false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // Overlap over budget: two accepted compositions sharing a module with max=0.
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-k3-r11d-overlap-'));
    try {
      seedPilotTree(tmp);
      const portfolioPath = path.join(tmp, 'plugin/src/knowledge/portfolio.json');
      const portfolio = JSON.parse(fs.readFileSync(portfolioPath, 'utf8'));
      portfolio.candidate_admission = {
        ...(portfolio.candidate_admission ?? {}),
        max_overlap_shared_modules: 0,
      };
      writeJson(portfolioPath, portfolio);
      const composition = JSON.parse(
        fs.readFileSync(
          path.join(tmp, 'plugin/src/knowledge/compositions/skill.dev-as-ml-loop.json'),
          'utf8',
        ),
      );
      const built = buildAndValidateGraph({
        repoRoot: tmp,
        sourceRoot: 'plugin/src/knowledge',
        skipCompositionAdmission: true,
      });
      assert.ok(built.graph);
      // Inject an in-memory accepted peer that shares module:devloop.core.
      built.graph.compositions.push({
        id: 'composition:skill.overlap-peer',
        skill_id: 'skill:overlap-peer',
        name: 'overlap-peer',
        lifecycle: { state: 'accepted', since: '2026-07-24' },
        consumes: {
          modules: [{ id: 'module:devloop.core' }],
        },
      });
      const metrics = computeCandidateMetrics({
        graph: built.graph,
        moduleIds: consumeModuleIds(composition),
        composition,
        repoRoot: tmp,
      });
      assert.ok(
        Object.keys(metrics.witness_metrics.overlap_signature).length > 0,
        JSON.stringify(metrics.witness_metrics.overlap_signature),
      );
      assert.equal(metrics.admission_gates.overlap_within_budget, false);
      assert.equal(metrics.admission_gates.ok, false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});

test('SKG-K3-00-R11E: materialize --check is compile_mode=check and does not write host dist', () => {
  const hosts = ['claude-code', 'codex', 'cursor', 'kimi-code'];
  const digestTree = (host) => {
    const root = path.join(repoRoot, 'plugin/dist', host);
    const hash = crypto.createHash('sha256');
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const name of fs.readdirSync(dir).sort()) {
        const abs = path.join(dir, name);
        const st = fs.lstatSync(abs);
        hash.update(`${path.relative(root, abs)}\0${st.isFile() ? st.size : 'd'}\0`);
        if (st.isDirectory()) walk(abs);
        else if (st.isFile()) hash.update(fs.readFileSync(abs));
      }
    };
    walk(root);
    return hash.digest('hex');
  };
  const mtimeMap = (host) => {
    const root = path.join(repoRoot, 'plugin/dist', host);
    const out = {};
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const name of fs.readdirSync(dir).sort()) {
        const abs = path.join(dir, name);
        const st = fs.lstatSync(abs);
        if (st.isDirectory()) walk(abs);
        else if (st.isFile()) out[path.relative(root, abs)] = st.mtimeMs;
      }
    };
    walk(root);
    return out;
  };

  // Ensure write-mode baseline exists.
  const warm = runCli([
    'materialize',
    '--composition',
    'composition:skill.dev-as-ml-loop',
    '--json',
  ]);
  assert.equal(warm.status, 0, warm.stdout || warm.stderr);
  const warmBody = parseJson(warm);
  assert.equal(warmBody.compile_mode, 'write');

  const before = Object.fromEntries(
    hosts.map((host) => [host, { digest: digestTree(host), mtimes: mtimeMap(host) }]),
  );

  const check = runCli([
    'materialize',
    '--composition',
    'composition:skill.dev-as-ml-loop',
    '--check',
    '--json',
  ]);
  assert.equal(check.status, 0, check.stdout || check.stderr);
  const checkBody = parseJson(check);
  assert.equal(checkBody.ok, true);
  assert.equal(checkBody.compile_mode, 'check');

  for (const host of hosts) {
    assert.equal(digestTree(host), before[host].digest, `${host} digest changed under --check`);
    assert.deepEqual(mtimeMap(host), before[host].mtimes, `${host} mtimes changed under --check`);
  }
});

test('SKG-K3-00-R12: projected hop forecast SCC=1 diameter≤3; structural arc removal fails', async () => {
  const {
    buildExpectedProjectionTopology,
    evaluateDirectedPointHopGates,
    projectionNodeKey,
  } = await import('../../scripts/skill-knowledge/compile/surface-verifier.mjs');
  const { buildAndValidateGraph } = await import('../../scripts/skill-knowledge/graph.mjs');
  const { analyzeSkillCandidate } = await import(
    '../../scripts/skill-knowledge/graph-first.mjs'
  );

  const happy = analyzeSkillCandidate({
    repoRoot,
    skillId: 'skill:dev-as-ml-loop',
    moduleIds: ['module:devloop.core', 'module:devloop.outer', 'module:devloop.ledger'],
    analysisId: 'analysis:candidate.dev-as-ml-loop',
    compositionId: 'composition:skill.dev-as-ml-loop',
  });
  assert.equal(happy.ok, true, JSON.stringify(happy.diagnostics ?? happy));
  assert.equal(happy.witness.hop.protocol, 'directed_projection_topology');
  assert.equal(happy.witness.hop.projected_ok, true);
  assert.equal(happy.witness.hop.projected_scc_count, 1);
  assert.ok(happy.witness.hop.projected_directed_diameter <= 3);
  assert.ok(happy.witness.hop.authored_directed_unreachable_pair_count > 0);

  const built = buildAndValidateGraph({ repoRoot });
  assert.equal(built.ok, true);
  const pointFilter = new Set(
    (built.graph.points ?? [])
      .filter((point) =>
        ['module:devloop.core', 'module:devloop.outer', 'module:devloop.ledger'].includes(
          point.module_id,
        ),
      )
      .map((point) => point.id),
  );
  const moduleFilter = new Set([
    'module:devloop.core',
    'module:devloop.outer',
    'module:devloop.ledger',
  ]);
  const topology = buildExpectedProjectionTopology({
    graph: built.graph,
    pointIdFilter: pointFilter,
    moduleIdFilter: moduleFilter,
  });
  const baseline = evaluateDirectedPointHopGates({
    adjacency: topology.adjacency,
    pointNodes: topology.pointNodes,
    hopPolicy: built.graph.portfolio.hop_policy,
  });
  assert.equal(baseline.h1Ok, true);
  assert.equal(baseline.h2Ok, true);

  const attacks = [
    {
      label: 'drop point→atlas',
      mutate(adj) {
        const atlas = projectionNodeKey('atlas', 'knowledge-atlas');
        for (const [from, tos] of adj.entries()) {
          if (from.startsWith('point:')) tos.delete(atlas);
        }
      },
    },
    {
      label: 'drop atlas→module',
      mutate(adj) {
        const atlas = projectionNodeKey('atlas', 'knowledge-atlas');
        const tos = adj.get(atlas);
        if (!tos) return;
        for (const to of [...tos]) {
          if (to.startsWith('module:')) tos.delete(to);
        }
      },
    },
    {
      label: 'drop module→member',
      mutate(adj) {
        for (const [from, tos] of adj.entries()) {
          if (!from.startsWith('module:')) continue;
          for (const to of [...tos]) {
            if (to.startsWith('point:')) tos.delete(to);
          }
        }
      },
    },
  ];
  for (const attack of attacks) {
    const clone = buildExpectedProjectionTopology({
      graph: built.graph,
      pointIdFilter: pointFilter,
      moduleIdFilter: moduleFilter,
    });
    attack.mutate(clone.adjacency);
    const gates = evaluateDirectedPointHopGates({
      adjacency: clone.adjacency,
      pointNodes: clone.pointNodes,
      hopPolicy: built.graph.portfolio.hop_policy,
    });
    assert.equal(
      gates.h1Ok && gates.h2Ok,
      false,
      `${attack.label} should fail hop gates`,
    );
  }
});
