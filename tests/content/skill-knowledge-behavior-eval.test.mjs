import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  aggregateBehaviorRuns,
  buildEvalSurface,
  buildHarnessInvocation,
  gradeBehaviorRun,
  loadBehaviorCases,
  loadPublishedBehaviorEvidence,
  resolveAcceptedCompositionOwner,
} from '../../scripts/skill-knowledge/behavior-eval.mjs';
import { buildAndValidateGraph } from '../../scripts/skill-knowledge/graph.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');

function withTempDirectory(fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-behavior-test-'));
  try {
    return fn(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function expectedSurfacePath(point) {
  return point.binding.path
    .replace(/^plugin\/src\/skills\//, 'skills/')
    .replace('/canonical/', '/');
}

test('SKG-BEH-01: train and holdout each cover the eight runtime skill owners', () => {
  const built = buildAndValidateGraph({
    repoRoot,
    sourceRoot: 'plugin/src/knowledge',
  });
  assert.equal(built.ok, true);
  const expectedOwners = new Set(built.graph.skills.map((skill) => skill.id));
  assert.equal(expectedOwners.size, 8);
  const migratedSkill = built.graph.skills.find(
    (skill) => skill.id === 'skill:dev-as-ml-loop',
  );
  assert.equal(migratedSkill._from_composition, true);
  assert.equal(migratedSkill._composition_id, 'composition:skill.dev-as-ml-loop');

  for (const split of ['train', 'holdout']) {
    const fixture = loadBehaviorCases({ repoRoot, split });
    assert.equal(fixture.cases.length, 8);
    assert.deepEqual(
      new Set(fixture.cases.map((item) => item.expected.owner_skill)),
      expectedOwners,
    );
    for (const item of fixture.cases) {
      const point = built.graph.points.find((candidate) => candidate.id === item.expected.point_id);
      assert.ok(point, `${split} missing ${item.expected.point_id}`);
      assert.equal(point.module_id, item.expected.module_id);
      assert.equal(
        resolveAcceptedCompositionOwner(built.graph, {
          pointId: point.id,
          moduleId: point.module_id,
        }),
        item.expected.owner_skill,
      );
      assert.equal(
        item.prompt.includes(item.expected.point_id),
        false,
        `${item.id} leaks expected point id`,
      );
    }
  }

  const legacyPlacement = {
    id: 'skill:legacy',
    lifecycle: { state: 'accepted' },
    modules: [{ id: 'module:shared' }],
    canonical_source_inventory: [{ point_ids: ['point:shared'] }],
  };
  const compositionWithoutPoint = {
    id: 'skill:composition',
    lifecycle: { state: 'accepted' },
    modules: [{ id: 'module:shared' }],
    canonical_source_inventory: [{ point_ids: [] }],
    _from_composition: true,
  };
  assert.throws(
    () =>
      resolveAcceptedCompositionOwner(
        { skills: [legacyPlacement, compositionWithoutPoint] },
        { pointId: 'point:shared', moduleId: 'module:shared' },
      ),
    /found 0/,
    'an accepted composition consuming the module must not fall back to a legacy placement',
  );

  const secondCompositionPlacement = {
    ...compositionWithoutPoint,
    id: 'skill:composition-two',
    canonical_source_inventory: [{ point_ids: ['point:shared'] }],
  };
  assert.throws(
    () =>
      resolveAcceptedCompositionOwner(
        {
          skills: [
            legacyPlacement,
            {
              ...compositionWithoutPoint,
              canonical_source_inventory: [{ point_ids: ['point:shared'] }],
            },
            secondCompositionPlacement,
          ],
        },
        { pointId: 'point:shared', moduleId: 'module:shared' },
      ),
    /found 2/,
    'multiple accepted composition placements must fail structurally',
  );
});

test('SKG-BEH-02: baseline surface removes router artifacts while candidate preserves them', () =>
  withTempDirectory((directory) => {
    const baseline = path.join(directory, 'baseline');
    const candidate = path.join(directory, 'candidate');
    buildEvalSurface({
      repoRoot,
      surfaceHost: 'claude-code',
      condition: 'baseline',
      destination: baseline,
    });
    buildEvalSurface({
      repoRoot,
      surfaceHost: 'claude-code',
      condition: 'candidate',
      destination: candidate,
    });

    assert.equal(fs.existsSync(path.join(baseline, 'knowledge')), false);
    assert.equal(fs.existsSync(path.join(candidate, 'knowledge', 'atlas.md')), true);
    const baselineSkill = fs.readFileSync(
      path.join(baseline, 'skills', 'dev-as-ml-loop', 'SKILL.md'),
      'utf8',
    );
    const candidateSkill = fs.readFileSync(
      path.join(candidate, 'skills', 'dev-as-ml-loop', 'SKILL.md'),
      'utf8',
    );
    assert.doesNotMatch(baselineSkill, /ccm:k:nav:start|ccm:k:entry-pin:start/);
    assert.doesNotMatch(baselineSkill, /<a id="ccm-k-point-/);
    assert.match(candidateSkill, /ccm:k:nav:start/);
    assert.match(candidateSkill, /<a id="ccm-k-point-/);
    assert.match(fs.readFileSync(path.join(candidate, 'README.md'), 'utf8'), /knowledge\/atlas/);
  }));

test('SKG-BEH-03: grader emits point, owner, grounding, hops, reads and token metrics', () =>
  withTempDirectory((directory) => {
    const surface = path.join(directory, 'candidate');
    buildEvalSurface({
      repoRoot,
      surfaceHost: 'claude-code',
      condition: 'candidate',
      destination: surface,
    });
    const item = loadBehaviorCases({ repoRoot, split: 'train' }).cases.find(
      (candidate) => candidate.id === 'train-devloop-plateau',
    );
    const built = buildAndValidateGraph({
      repoRoot,
      sourceRoot: 'plugin/src/knowledge',
    });
    const point = built.graph.points.find((candidate) => candidate.id === item.expected.point_id);
    const quote = built.graph.spans.find((span) => span.point_id === point.id).content
      .split('\n')
      .find((line) => line.trim().length > 20)
      .trim();
    const evidencePath = expectedSurfacePath(point);
    const response = {
      case_id: item.id,
      point_id: point.id,
      module_id: point.module_id,
      owner_skill: resolveAcceptedCompositionOwner(built.graph, {
        pointId: point.id,
        moduleId: point.module_id,
      }),
      evidence_path: evidencePath,
      evidence_quote: quote,
      answer: 'restart',
      visited_files: [
        'README.md',
        'knowledge/atlas.md',
        'knowledge/modules/devloop.core.md',
        evidencePath,
      ],
      route: [
        'README.md',
        'knowledge/atlas.md',
        'knowledge/modules/devloop.core.md#ccm-k-module-devloop-core',
        `${evidencePath}#ccm-k-point-devloop-plateau-restart`,
      ],
      abstained: false,
    };
    const graded = gradeBehaviorRun({
      repoRoot,
      surfaceRoot: surface,
      condition: 'candidate',
      surfaceHost: 'claude-code',
      harness: 'codex',
      caseDefinition: item,
      response,
      rawTranscript: JSON.stringify(response),
      durationMs: 120,
      providerUsage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    });
    assert.equal(graded.metrics.point_hit, true);
    assert.equal(graded.metrics.owner_correct, true);
    assert.equal(graded.metrics.module_correct, true);
    assert.equal(graded.metrics.wrong_owner, false);
    assert.equal(graded.metrics.evidence_grounded, true);
    assert.equal(graded.metrics.navigation_hops, 3);
    assert.equal(graded.metrics.navigation_grounded, true);
    assert.equal(graded.metrics.reads.value, 4);
    assert.equal(graded.metrics.reads.measurement_source, 'validated_agent_trace');
    assert.ok(graded.metrics.estimated_tokens.value > 0);
    assert.equal(graded.metrics.estimated_tokens.exact_provider_tokenizer, false);
    assert.equal(graded.metrics.provider_reported_tokens.total_tokens, 30);
  }));

test('SKG-BEH-04: grader rejects a wrong owner and an ungrounded quote', () =>
  withTempDirectory((directory) => {
    const surface = path.join(directory, 'baseline');
    buildEvalSurface({
      repoRoot,
      surfaceHost: 'claude-code',
      condition: 'baseline',
      destination: surface,
    });
    const item = loadBehaviorCases({ repoRoot, split: 'train' }).cases[0];
    const graded = gradeBehaviorRun({
      repoRoot,
      surfaceRoot: surface,
      condition: 'baseline',
      surfaceHost: 'claude-code',
      harness: 'cursor',
      caseDefinition: item,
      response: {
        case_id: item.id,
        point_id: item.expected.point_id,
        module_id: item.expected.module_id,
        owner_skill: 'skill:using-ccm',
        evidence_path: 'skills/authoring-workflows/SKILL.md',
        evidence_quote: 'invented quote',
        answer: 'wrong',
        visited_files: ['README.md'],
        route: [],
        abstained: false,
      },
      rawTranscript: '{}',
      durationMs: 1,
      providerUsage: null,
    });
    assert.equal(graded.metrics.point_hit, true);
    assert.equal(graded.metrics.owner_correct, false);
    assert.equal(graded.metrics.wrong_owner, true);
    assert.equal(graded.metrics.evidence_grounded, false);
    assert.equal(graded.metrics.navigation_hops, null);
  }));

test('SKG-BEH-05: aggregation never promotes incomplete stochastic runs to holdout verdict', () => {
  const graphHash = buildAndValidateGraph({
    repoRoot,
    sourceRoot: 'plugin/src/knowledge',
  }).graph.graph_hash;
  const run = {
    schema: 'cc-master/skill-knowledge-behavior-run/v1',
    protocol_version: 'cc-master/skill-knowledge-router-eval/v1',
    graph_hash: graphHash,
    condition: 'baseline',
    harness: 'codex',
    surface_host: 'claude-code',
    case_id: 'train-devloop-plateau',
    run_index: 1,
    metrics: {
      point_hit: true,
      owner_correct: true,
      module_correct: true,
      wrong_owner: false,
      evidence_grounded: true,
      navigation_hops: null,
      navigation_grounded: false,
      reads: { value: 2, measurement_source: 'validated_agent_trace' },
      estimated_tokens: { value: 10, exact_provider_tokenizer: false },
      provider_reported_tokens: null,
      duration_ms: 1,
    },
  };
  const aggregate = aggregateBehaviorRuns({
    repoRoot,
    runs: [run],
    minimumRunsPerCase: 3,
  });
  assert.equal(aggregate.behavioral_evidence_status.state, 'baseline');
  assert.equal(aggregate.behavioral_evidence_status.verdict, undefined);
  assert.equal(aggregate.coverage.complete, false);
  assert.equal(Object.hasOwn(aggregate, 'improvement_claim'), false);
  assert.equal(aggregate.conditions.baseline.metrics.point_hit_accuracy, 1);
  assert.deepEqual(aggregate.harness_execution_posture.codex, {
    mode: 'exec',
    permission_mode: 'non_interactive_default',
    sandbox: 'read-only',
    kernel_sandbox_available: true,
    workspace: 'temporary',
    session_persistence: 'ephemeral',
    user_config: 'ignored',
    user_rules: 'ignored',
  });
  assert.deepEqual(aggregate.harness_execution_posture.cursor, {
    mode: 'ask',
    permission_mode: 'read_only_ask',
    sandbox: 'disabled',
    kernel_sandbox_available: false,
    kernel_sandbox_unavailable_reason:
      'worker host does not meet Cursor kernel v6.2/AppArmor requirement',
    workspace: 'temporary',
    workspace_trust: 'explicit',
    isolation_equivalence: 'weaker_than_codex_read_only_sandbox',
  });
});

test('SKG-BEH-06: harness invocation is closed to Codex and Cursor', () => {
  const codex = buildHarnessInvocation({ harness: 'codex', prompt: 'x', cwd: '/tmp' });
  assert.equal(codex.command, 'codex');
  assert.ok(codex.args.includes('--ephemeral'));
  assert.ok(codex.args.includes('--ignore-user-config'));
  assert.ok(codex.args.includes('--ignore-rules'));
  assert.equal(codex.args[codex.args.indexOf('--sandbox') + 1], 'read-only');

  const cursor = buildHarnessInvocation({ harness: 'cursor', prompt: 'x', cwd: '/tmp' });
  assert.equal(cursor.command, 'cursor-agent');
  assert.equal(cursor.args[cursor.args.indexOf('--model') + 1], 'cursor-grok-4.5-high');
  assert.equal(cursor.args[cursor.args.indexOf('--mode') + 1], 'ask');
  assert.equal(cursor.args[cursor.args.indexOf('--sandbox') + 1], 'disabled');
  assert.ok(cursor.args.includes('--trust'));
  assert.equal(cursor.args[cursor.args.indexOf('--workspace') + 1], '/tmp');
  assert.throws(
    () => buildHarnessInvocation({ harness: 'claude', prompt: 'x', cwd: '/tmp' }),
    /codex|cursor/,
  );
});

test('SKG-BEH-07: published evidence requires exact graph hash or explicit byte-identical baseline compatibility', () =>
  withTempDirectory((directory) => {
    const evidenceDirectory = path.join(directory, 'design_docs/eval/skill-knowledge-router');
    const evidenceFile = path.join(evidenceDirectory, 'evidence.json');
    fs.mkdirSync(evidenceDirectory, { recursive: true });
    const compatibleGraphHash = 'b'.repeat(64);
    const validEvidence = {
      schema: 'cc-master/skill-knowledge-behavior-evidence/v1',
      protocol_version: 'cc-master/skill-knowledge-router-eval/v1',
      graph_hash: 'a'.repeat(64),
      behavioral_evidence_status: {
        state: 'baseline',
        evidence: ['design_docs/eval/skill-knowledge-router/evidence.json'],
      },
      compatible_graphs: [
        {
          graph_hash: compatibleGraphHash,
          scope: 'baseline',
          proof: {
            method: 'byte-identical-no-router-surface/v1',
            source_graph_hash: 'a'.repeat(64),
            target_graph_hash: compatibleGraphHash,
            source_revision: '1'.repeat(40),
            target_revision: '2'.repeat(40),
            surface_host: 'claude-code',
            file_count: 62,
            source_surface_sha256: 'd'.repeat(64),
            target_surface_sha256: 'd'.repeat(64),
            model_runs_reexecuted: false,
            rationale: 'The no-router baseline surface is byte-identical.',
          },
        },
      ],
      coverage: { complete: false },
      conditions: {
        baseline: { runs: 2 },
        candidate: { runs: 0 },
        holdout: { runs: 0 },
      },
    };
    const publish = (value) => {
      fs.writeFileSync(evidenceFile, `${JSON.stringify(value, null, 2)}\n`);
    };
    publish(validEvidence);
    const current = loadPublishedBehaviorEvidence({
      repoRoot: directory,
      graphHash: 'a'.repeat(64),
    });
    assert.equal(current.state, 'baseline');
    const compatible = loadPublishedBehaviorEvidence({
      repoRoot: directory,
      graphHash: 'b'.repeat(64),
    });
    assert.equal(compatible.state, 'baseline');
    assert.equal(compatible.compatible_graph, true);

    const mutations = [
      ...['graph_hash', 'scope', 'proof'].map((field) => [
        `missing compatibility ${field}`,
        (value) => delete value.compatible_graphs[0][field],
      ]),
      ...[
        'method',
        'source_graph_hash',
        'target_graph_hash',
        'source_revision',
        'target_revision',
        'surface_host',
        'file_count',
        'source_surface_sha256',
        'target_surface_sha256',
        'model_runs_reexecuted',
        'rationale',
      ].map((field) => [
        `missing proof ${field}`,
        (value) => delete value.compatible_graphs[0].proof[field],
      ]),
      ['wrong target graph hash', (value) => {
        value.compatible_graphs[0].proof.target_graph_hash = 'c'.repeat(64);
      }],
      ['wrong source graph hash', (value) => {
        value.compatible_graphs[0].proof.source_graph_hash = 'c'.repeat(64);
      }],
      ['malformed matching source graph hashes', (value) => {
        value.graph_hash = 'not-a-hash';
        value.compatible_graphs[0].proof.source_graph_hash = 'not-a-hash';
      }],
      ['wrong proof method', (value) => {
        value.compatible_graphs[0].proof.method = 'trust-me/v1';
      }],
      ['malformed source revision', (value) => {
        value.compatible_graphs[0].proof.source_revision = 'not-a-revision';
      }],
      ['malformed target revision', (value) => {
        value.compatible_graphs[0].proof.target_revision = 'not-a-revision';
      }],
      ['wrong surface host', (value) => {
        value.compatible_graphs[0].proof.surface_host = 'codex';
      }],
      ['wrong file count', (value) => {
        value.compatible_graphs[0].proof.file_count = 61;
      }],
      ['string file count', (value) => {
        value.compatible_graphs[0].proof.file_count = '62';
      }],
      ['empty source digest', (value) => {
        value.compatible_graphs[0].proof.source_surface_sha256 = '';
      }],
      ['unequal digest', (value) => {
        value.compatible_graphs[0].proof.target_surface_sha256 = 'e'.repeat(64);
      }],
      ['model runs reexecuted', (value) => {
        value.compatible_graphs[0].proof.model_runs_reexecuted = true;
      }],
      ['empty rationale', (value) => {
        value.compatible_graphs[0].proof.rationale = '';
      }],
      ['candidate scope', (value) => {
        value.compatible_graphs[0].scope = 'candidate';
      }],
      ['holdout scope', (value) => {
        value.compatible_graphs[0].scope = 'holdout';
      }],
      ['candidate state', (value) => {
        value.behavioral_evidence_status.state = 'candidate';
      }],
      ['holdout state', (value) => {
        value.behavioral_evidence_status.state = 'holdout';
      }],
      ['wrong baseline count', (value) => {
        value.conditions.baseline.runs = 1;
      }],
      ['candidate runs present', (value) => {
        value.conditions.candidate.runs = 1;
      }],
      ['holdout runs present', (value) => {
        value.conditions.holdout.runs = 1;
      }],
      ['verdict key present', (value) => {
        value.behavioral_evidence_status.verdict = null;
      }],
      ['improvement claim key present', (value) => {
        value.improvement_claim = '';
      }],
      ['extra compatibility field', (value) => {
        value.compatible_graphs[0].extra = null;
      }],
      ['extra proof field', (value) => {
        value.compatible_graphs[0].proof.extra = null;
      }],
      ['duplicate compatible attestation', (value) => {
        value.compatible_graphs.push(structuredClone(value.compatible_graphs[0]));
      }],
    ];
    for (const [label, mutate] of mutations) {
      const mutated = structuredClone(validEvidence);
      mutate(mutated);
      publish(mutated);
      const result = loadPublishedBehaviorEvidence({
        repoRoot: directory,
        graphHash: compatibleGraphHash,
      });
      assert.equal(result.state, 'not_run', label);
      assert.equal(result.stale, true, label);
    }
  }));
