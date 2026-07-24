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
      assert.equal(point.owner_skill, item.expected.owner_skill);
      assert.equal(point.module_id, item.expected.module_id);
      assert.equal(
        item.prompt.includes(item.expected.point_id),
        false,
        `${item.id} leaks expected point id`,
      );
    }
  }
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
      owner_skill: point.owner_skill,
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

test('SKG-BEH-07: published evidence applies only to the exact current graph hash', () =>
  withTempDirectory((directory) => {
    const evidenceDirectory = path.join(directory, 'design_docs/eval/skill-knowledge-router');
    fs.mkdirSync(evidenceDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(evidenceDirectory, 'evidence.json'),
      `${JSON.stringify(
        {
          schema: 'cc-master/skill-knowledge-behavior-evidence/v1',
          protocol_version: 'cc-master/skill-knowledge-router-eval/v1',
          graph_hash: 'a'.repeat(64),
          behavioral_evidence_status: {
            state: 'baseline',
            evidence: ['design_docs/eval/skill-knowledge-router/evidence.json'],
          },
          coverage: { complete: false },
          conditions: {},
        },
        null,
        2,
      )}\n`,
    );
    const current = loadPublishedBehaviorEvidence({
      repoRoot: directory,
      graphHash: 'a'.repeat(64),
    });
    assert.equal(current.state, 'baseline');
    const stale = loadPublishedBehaviorEvidence({
      repoRoot: directory,
      graphHash: 'b'.repeat(64),
    });
    assert.equal(stale.state, 'not_run');
    assert.equal(stale.stale, true);
  }));
