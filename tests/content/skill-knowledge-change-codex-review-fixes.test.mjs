/**
 * Product-path regressions for Codex REQUEST_CHANGES on K1 candidate runtime:
 * final_surface_snapshot reparse, zero-write-before-authority, recovery ownership,
 * structured JSON framing, partial ownership fail-closed, failed-envelope revalidation.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { withIsolatedSkillKnowledgeRepo } from './helpers/skill-knowledge-isolated-repo.mjs';
import { validateChangeValidationSemantics } from '../../scripts/skill-knowledge/validation-envelope.mjs';
import { parseStructuredJsonStdout } from '../../scripts/skill-knowledge/json-framing.mjs';
import {
  projectCoverageSubgraph,
  resolveHostCoveragePlan,
} from '../../scripts/skill-knowledge/host-coverage.mjs';
import { buildAndValidateGraph } from '../../scripts/skill-knowledge/graph.mjs';

const PRODUCT_HOSTS = Object.freeze(['claude-code', 'codex', 'cursor', 'kimi-code']);
const MODULE_PATH =
  'plugin/src/knowledge/skills/master-orchestrator-guide/modules/conduct.never-play.json';
const transactionModule = '../../scripts/skill-knowledge/transactions.mjs';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stderr}`);
}

function initGit(repoRoot) {
  run('git', ['init', '-q'], repoRoot);
  run('git', ['config', 'user.email', 'skg@example.test'], repoRoot);
  run('git', ['config', 'user.name', 'SKG Test'], repoRoot);
  run('git', ['add', '.'], repoRoot);
  run('git', ['commit', '-qm', 'base'], repoRoot);
}

function writeDraft(workspace, operation) {
  const metadata = JSON.parse(fs.readFileSync(path.join(workspace, 'workspace.json'), 'utf8'));
  fs.writeFileSync(
    path.join(workspace, 'change.draft.json'),
    `${JSON.stringify(
      {
        schema_version: 'cc-master/skill-knowledge-change/v1alpha1',
        kind: 'change',
        change_id: metadata.change_id,
        base_ref: metadata.base_ref,
        base_graph_sha256: metadata.base_graph_sha256,
        parent_change: null,
        reason: 'codex review fix fixture',
        operations: [operation],
        evidence: [{ kind: 'test', ref: 'skill-knowledge-change-codex-review-fixes.test.mjs' }],
        expected_effects: {
          identity_delta: 0,
          canonical_subject_delta: 0,
          max_hop_regression_allowed: 0,
          coverage_debt_allowed: false,
        },
      },
      null,
      2,
    )}\n`,
  );
}

function refineSummary(workspace, suffix) {
  const modulePath = path.join(workspace, 'candidate', MODULE_PATH);
  const document = JSON.parse(fs.readFileSync(modulePath, 'utf8'));
  const point = document.points.find((item) => item.id === 'point:conduct.never-play');
  assert.ok(point, 'fixture point missing');
  point.summary = `${point.summary} ${suffix}`;
  fs.writeFileSync(modulePath, `${JSON.stringify(document, null, 2)}\n`);
  writeDraft(workspace, {
    op: 'refine',
    subject: 'point:conduct.never-play',
    changed_fields: ['summary'],
    rationale: 'typed refine for codex review fix regressions',
  });
}

test('CODEX-F1: envelope rejects missing snapshot / single check / empty budgets on ok full/partial', () => {
  const baseWitness = {
    host: 'claude-code',
    ok: true,
    mode: 'full',
    artifacts: [{ path: 'knowledge/atlas.md', bytes: 12 }],
    enabled_edges: 1,
    point_anchors: 1,
    hop_report: {
      H1: { ok: true, witness: { host: 'claude-code' }, remediation: 'x' },
      H2: { ok: true, witness: { host: 'claude-code' }, remediation: 'x' },
      H3: { ok: true, witness: { host: 'claude-code' }, remediation: 'x' },
      H4: { ok: true, witness: { host: 'claude-code' }, remediation: 'x' },
    },
    budgets: {},
    executed_checks: ['candidate_runtime_sync'],
    conditional_route_policy: 'enabled_by_default-only',
    result_graph_sha256: 'a'.repeat(64),
  };
  const witnesses = PRODUCT_HOSTS.map((host, index) => ({
    ...baseWitness,
    host,
    ...(index === 0
      ? {}
      : {
          mode: 'stub',
          ok: true,
          artifacts: [],
          enabled_edges: 0,
          point_anchors: 0,
          budgets: {},
          executed_checks: ['host_coverage_stub_abstention'],
          conditional_route_policy: 'abstained',
          hop_report: {
            H1: { ok: true, witness: { host, abstained: true, mode: 'stub' }, remediation: 'x' },
            H2: { ok: true, witness: { host, abstained: true, mode: 'stub' }, remediation: 'x' },
            H3: { ok: true, witness: { host, abstained: true, mode: 'stub' }, remediation: 'x' },
            H4: { ok: true, witness: { host, abstained: true, mode: 'stub' }, remediation: 'x' },
          },
        }),
  }));
  const doc = {
    schema_version: 'cc-master/skill-knowledge-validation/v1alpha1',
    kind: 'change_validation',
    change_id: 'change:codex-f1',
    base_ref: 'HEAD',
    base_graph_sha256: 'b'.repeat(64),
    scope: [],
    result_graph_sha256: 'a'.repeat(64),
    candidate_valid: false,
    candidate_runtime_valid: false,
    optimistic_lock_valid: true,
    git_apply_check: true,
    patch_sha256: 'c'.repeat(64),
    host_projection_witnesses: witnesses,
    diagnostics: [{ severity: 'error', code: 'SKG-CHANGE-CANDIDATE-RUNTIME', message: 'x' }],
  };

  const missingSnap = validateChangeValidationSemantics(structuredClone(doc), {
    runtimeValid: false,
  });
  assert.ok(
    missingSnap.some((item) => item.code === 'SKG-CHANGE-VALIDATION-SNAPSHOT-REQUIRED'),
    JSON.stringify(missingSnap.map((item) => item.code)),
  );

  const singleCheck = structuredClone(doc);
  singleCheck.host_projection_witnesses[0].final_surface_snapshot = {
    host: 'claude-code',
    mode: 'full',
    final_root: 'plugin/dist/claude-code',
    fileset_manifest: ['knowledge/atlas.md'],
    fileset: [{ path: 'knowledge/atlas.md', kind: 'file', bytes: 12, sha256: 'd'.repeat(64) }],
    skills: [],
    modules: [],
    points: [],
    edges: [],
    entries: [],
    enabled_edge_ids: [],
    enabled_adjacency: {},
  };
  const single = validateChangeValidationSemantics(singleCheck, { runtimeValid: false });
  assert.ok(
    single.some((item) => item.code === 'SKG-CHANGE-VALIDATION-EXECUTED-CHECKS'),
    JSON.stringify(single.map((item) => item.code)),
  );

  const emptyBudgets = structuredClone(singleCheck);
  emptyBudgets.host_projection_witnesses[0].executed_checks = [
    'candidate_runtime_sync',
    'candidate_runtime_verify',
  ];
  emptyBudgets.host_projection_witnesses[0].budgets = {};
  const budgets = validateChangeValidationSemantics(emptyBudgets, { runtimeValid: false });
  assert.ok(
    budgets.some((item) => item.code === 'SKG-CHANGE-VALIDATION-BUDGETS'),
    JSON.stringify(budgets.map((item) => item.code)),
  );

  const stubWithSnap = structuredClone(doc);
  stubWithSnap.host_projection_witnesses[1].final_surface_snapshot =
    singleCheck.host_projection_witnesses[0].final_surface_snapshot;
  const stub = validateChangeValidationSemantics(stubWithSnap, { runtimeValid: false });
  assert.ok(
    stub.some((item) => item.code === 'SKG-CHANGE-VALIDATION-SNAPSHOT-FORBIDDEN'),
    JSON.stringify(stub.map((item) => item.code)),
  );
});

test('CODEX-F4: parseStructuredJsonStdout accepts pretty-printed full document', () => {
  const body = { ok: true, host: 'codex', diagnostics: [{ code: 'SKG-HOP-H1', severity: 'error' }] };
  const pretty = `${JSON.stringify(body, null, 2)}\n`;
  const parsed = parseStructuredJsonStdout(pretty, { label: 'attestation' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.diagnostics[0].code, 'SKG-HOP-H1');
  assert.throws(
    () => parseStructuredJsonStdout('noise\n{"ok":true}\n', { label: 'attestation' }),
    /SKG-JSON-FRAMING|single JSON/,
  );
});

test('CODEX-F5: covered_modules cross-skill ownership fail-closed; entry host + access pruned', async () => {
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    const built = buildAndValidateGraph({ repoRoot });
    const { plan, diagnostics } = resolveHostCoveragePlan({
      skills: [
        {
          id: 'skill:master-orchestrator-guide',
          modules: [
            { id: 'module:conduct.never-play' },
            { id: 'module:verification.endpoint' },
            { id: 'module:routing.worker-chain' },
          ],
          host_coverage: [
            {
              host: 'codex',
              state: 'partial',
              covered_modules: ['module:conduct.never-play', 'module:foreign.other-skill'],
              reason: 'ownership probe',
            },
          ],
        },
      ],
    });
    assert.ok(
      diagnostics.some((item) => item.code === 'SKG-HOST-COVERAGE-MODULE-OWNERSHIP'),
      JSON.stringify(diagnostics.map((item) => item.code)),
    );
    assert.ok(!plan.codex.moduleIds.includes('module:foreign.other-skill'));

    const projected = projectCoverageSubgraph(
      built.graph,
      ['module:conduct.never-play', 'module:verification.endpoint'],
      { host: 'codex' },
    );
    for (const entry of projected.entries ?? []) {
      for (const surface of entry.surfaces ?? []) {
        assert.equal(surface.host, 'codex', JSON.stringify(surface));
      }
    }
    const survivingEntries = new Set((projected.entries ?? []).map((item) => item.id));
    for (const module of projected.modules ?? []) {
      for (const entryId of module.access?.relevant_entries ?? []) {
        assert.ok(
          survivingEntries.has(entryId),
          `access.relevant_entries leaked ${entryId} outside surviving entries`,
        );
      }
    }
    assert.ok(!projected.modules.some((item) => item.id === 'module:routing.worker-chain'));
  });
});

test('CODEX-F2: candidate path reject before graph/patch leaves zero new transaction artifacts', async () => {
  const tx = await import(transactionModule);
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    initGit(repoRoot);
    const begun = tx.beginTransaction({
      repoRoot,
      operation: 'refine',
      scope: [MODULE_PATH],
      base: 'HEAD',
    });
    assert.equal(begun.exitCode, 0, JSON.stringify(begun.diagnostics));
    refineSummary(begun.workspace, '(zero-write)');

    const before = new Set(fs.readdirSync(begun.workspace));
    const candidateFile = path.join(begun.workspace, 'candidate', MODULE_PATH);
    fs.unlinkSync(candidateFile);
    fs.symlinkSync('/tmp/skg-codex-f2-escape', candidateFile);

    const validated = tx.validateTransaction({ repoRoot, workspace: begun.workspace });
    assert.notEqual(validated.exitCode, 0);
    assert.ok(
      (validated.diagnostics ?? []).some((item) => String(item.code).startsWith('SKG-PATH-AUTHORITY')),
      JSON.stringify((validated.diagnostics ?? []).map((item) => item.code)),
    );
    const after = fs.readdirSync(begun.workspace);
    for (const name of after) {
      if (!before.has(name)) {
        assert.fail(`unexpected new transaction artifact after path reject: ${name}`);
      }
    }
    assert.equal(fs.existsSync(path.join(begun.workspace, 'apply.patch')), false);
    assert.equal(fs.existsSync(path.join(begun.workspace, 'validation.json')), false);
  });
});

test('CODEX-F3: anomalous pre-existing recovery directory is fail-closed and keeps sentinel', async () => {
  const tx = await import(transactionModule);
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    initGit(repoRoot);
    const begun = tx.beginTransaction({
      repoRoot,
      operation: 'refine',
      scope: [MODULE_PATH],
      base: 'HEAD',
    });
    refineSummary(begun.workspace, '(recovery)');
    const validated = tx.validateTransaction({ repoRoot, workspace: begun.workspace });
    assert.equal(validated.exitCode, 0, JSON.stringify(validated.diagnostics));

    const recoveryRoot = path.join(begun.workspace, 'recovery');
    fs.mkdirSync(recoveryRoot, { recursive: true });
    const sentinel = path.join(recoveryRoot, 'SENTINEL-DO-NOT-DELETE');
    fs.writeFileSync(sentinel, 'owned-by-attacker\n');

    const applied = tx.applyTransaction({ repoRoot, workspace: begun.workspace });
    assert.notEqual(applied.exitCode, 0);
    assert.ok(
      (applied.diagnostics ?? []).some(
        (item) =>
          item.code === 'SKG-PATH-AUTHORITY-RECOVERY-EXISTS' ||
          String(item.code).includes('RECOVERY'),
      ),
      JSON.stringify((applied.diagnostics ?? []).map((item) => item.code)),
    );
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'owned-by-attacker\n');
  });
});

test('CODEX-F6: failed envelope revalidation recomputes runtimeValid from modified document', () => {
  const hash = 'a'.repeat(64);
  const witnesses = PRODUCT_HOSTS.map((host) => ({
    host,
    ok: true,
    mode: 'stub',
    artifacts: [],
    enabled_edges: 0,
    point_anchors: 0,
    hop_report: {
      H1: { ok: true, witness: { host, abstained: true, mode: 'stub' }, remediation: 'x' },
      H2: { ok: true, witness: { host, abstained: true, mode: 'stub' }, remediation: 'x' },
      H3: { ok: true, witness: { host, abstained: true, mode: 'stub' }, remediation: 'x' },
      H4: { ok: true, witness: { host, abstained: true, mode: 'stub' }, remediation: 'x' },
    },
    budgets: {},
    executed_checks: ['host_coverage_stub_abstention'],
    conditional_route_policy: 'abstained',
    result_graph_sha256: hash,
  }));
  const document = {
    schema_version: 'cc-master/skill-knowledge-validation/v1alpha1',
    kind: 'change_validation',
    change_id: 'change:codex-f6',
    base_ref: 'HEAD',
    base_graph_sha256: 'b'.repeat(64),
    scope: [],
    result_graph_sha256: hash,
    candidate_valid: false,
    candidate_runtime_valid: true,
    optimistic_lock_valid: true,
    git_apply_check: true,
    patch_sha256: 'c'.repeat(64),
    host_projection_witnesses: witnesses,
    diagnostics: [],
  };
  const first = validateChangeValidationSemantics(document, {
    runtimeValid: document.candidate_runtime_valid,
  });
  assert.ok(first.some((item) => item.code === 'SKG-CHANGE-VALIDATION-CANDIDATE-FLAG'));

  document.candidate_valid = false;
  document.candidate_runtime_valid = false;
  document.diagnostics = [
    ...document.diagnostics,
    ...first.map(({ exit_code, ...item }) => item),
  ];
  const second = validateChangeValidationSemantics(document, {
    runtimeValid: document.candidate_runtime_valid,
  });
  assert.equal(
    second.length,
    0,
    `failure envelope must be self-consistent after recompute: ${JSON.stringify(second)}`,
  );
});

test('CODEX-F1-product: successful full witness snapshot has fileset digests from final surface', async () => {
  const tx = await import(transactionModule);
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    initGit(repoRoot);
    const begun = tx.beginTransaction({
      repoRoot,
      operation: 'refine',
      scope: [MODULE_PATH],
      base: 'HEAD',
    });
    refineSummary(begun.workspace, '(snapshot-fileset)');
    const validated = tx.validateTransaction({ repoRoot, workspace: begun.workspace });
    assert.equal(validated.exitCode, 0, JSON.stringify(validated.diagnostics));
    const full = validated.validation.host_projection_witnesses.find(
      (item) => item.host === 'claude-code',
    );
    assert.ok(full?.ok);
    const snap = full.final_surface_snapshot;
    assert.ok(snap);
    assert.ok(Array.isArray(snap.fileset));
    assert.ok(snap.fileset.some((item) => item.kind === 'file' && item.sha256 && item.bytes >= 0));
    assert.deepEqual(
      snap.fileset_manifest,
      snap.fileset.map((item) => item.path).sort(),
    );
    assert.ok(full.executed_checks.includes('candidate_runtime_sync'));
    assert.ok(full.executed_checks.includes('candidate_runtime_verify'));
    assert.ok(full.budgets && Object.keys(full.budgets).length > 0);
    assert.equal(snap.host, full.host);
    assert.equal(snap.mode, full.mode);
  });
});

test('CODEX-A-product: disabled authored edge absent from snapshot edges and adjacency', async () => {
  const tx = await import(transactionModule);
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    initGit(repoRoot);
    const disabledId = 'edge:conduct.disabled-for-codex-a';
    const begun = tx.beginTransaction({
      repoRoot,
      operation: 'add',
      scope: [MODULE_PATH],
      base: 'HEAD',
    });
    const modulePath = path.join(begun.workspace, 'candidate', MODULE_PATH);
    const document = JSON.parse(fs.readFileSync(modulePath, 'utf8'));
    document.edges.push({
      id: disabledId,
      type: 'next',
      from: 'point:conduct.never-play',
      to: 'point:conduct.red-lines',
      when: ['never-default'],
      path_role: 'next',
      runtime: { enabled_by_default: false },
      lifecycle: document.edges[0].lifecycle,
      admission: document.edges[0].admission,
    });
    fs.writeFileSync(modulePath, `${JSON.stringify(document, null, 2)}\n`);
    writeDraft(begun.workspace, {
      op: 'add',
      entities: [disabledId],
      rationale: 'disabled edge must not appear in final surface snapshot',
    });
    const validated = tx.validateTransaction({ repoRoot, workspace: begun.workspace });
    assert.equal(validated.exitCode, 0, JSON.stringify(validated.diagnostics));
    const snap = validated.validation.host_projection_witnesses.find(
      (item) => item.host === 'claude-code',
    )?.final_surface_snapshot;
    assert.ok(snap);
    assert.ok(!snap.edges.some((item) => item.id === disabledId));
    assert.ok(!snap.enabled_edge_ids.includes(disabledId));
    const adj = snap.enabled_adjacency['point:conduct.never-play'] ?? [];
    assert.ok(!adj.some((item) => item.edge_id === disabledId));
  });
});

test('CODEX-A-product: multi-match enabled edges for one nav link fail closed without snapshot', async () => {
  const tx = await import(transactionModule);
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    initGit(repoRoot);
    const dupId = 'edge:conduct.principle-to-red-lines-dup';
    const begun = tx.beginTransaction({
      repoRoot,
      operation: 'add',
      scope: [MODULE_PATH],
      base: 'HEAD',
    });
    const modulePath = path.join(begun.workspace, 'candidate', MODULE_PATH);
    const document = JSON.parse(fs.readFileSync(modulePath, 'utf8'));
    const proto = document.edges[0];
    document.edges.push({
      ...JSON.parse(JSON.stringify(proto)),
      id: dupId,
      type: 'deepens_to',
      from: 'point:conduct.never-play',
      to: 'point:conduct.red-lines',
      when: ['duplicate enabled endpoints for snapshot ambiguity'],
      path_role: 'support',
      order: 99,
      runtime: { enabled_by_default: true },
    });
    fs.writeFileSync(modulePath, `${JSON.stringify(document, null, 2)}\n`);
    writeDraft(begun.workspace, {
      op: 'add',
      entities: [dupId],
      rationale: 'multi-match enabled edges must fail closed on snapshot',
    });
    const validated = tx.validateTransaction({ repoRoot, workspace: begun.workspace });
    assert.notEqual(validated.exitCode, 0);
    const amb = (validated.diagnostics ?? []).filter(
      (item) => item.code === 'SKG-CHANGE-SNAPSHOT-EDGE-AMBIGUOUS',
    );
    assert.ok(amb.length > 0, JSON.stringify((validated.diagnostics ?? []).map((d) => d.code)));
    assert.equal(amb[0].witness.from, 'point:conduct.never-play');
    assert.equal(amb[0].witness.to, 'point:conduct.red-lines');
    assert.ok(amb[0].witness.candidate_edge_ids.includes(dupId));
    assert.ok(amb[0].witness.candidate_edge_ids.includes('edge:conduct.principle-to-red-lines'));
    assert.ok(amb[0].witness.host);
    for (const witness of validated.validation?.host_projection_witnesses ?? []) {
      if (witness.mode === 'full' || witness.mode === 'partial') {
        assert.equal(witness.ok, false);
        assert.equal(witness.final_surface_snapshot, undefined);
      }
    }
  });
});

test('CODEX-A-product: 0-match orphan nav link fail closed without snapshot', async () => {
  const tx = await import(transactionModule);
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    initGit(repoRoot);
    const begun = tx.beginTransaction({
      repoRoot,
      operation: 'refine',
      scope: [MODULE_PATH],
      base: 'HEAD',
    });
    refineSummary(begun.workspace, '(orphan-nav)');
    const validated = tx.validateTransaction({
      repoRoot,
      workspace: begun.workspace,
      testSeams: {
        host: 'claude-code',
        mutatePayloadBeforeSnapshot({ payloadRoot }) {
          const skillMd = path.join(
            payloadRoot,
            'skills/master-orchestrator-guide/SKILL.md',
          );
          const text = fs.readFileSync(skillMd, 'utf8');
          const marker = '<!-- ccm:k:nav:start point:conduct.never-play -->';
          const idx = text.indexOf(marker);
          assert.ok(idx >= 0, 'expected compiler nav block for never-play');
          const end = text.indexOf('<!-- ccm:k:nav:end -->', idx);
          assert.ok(end > idx);
          const injected =
            '\n- [orphan 0-match](./SKILL.md#ccm-k-point-conduct-deserting-podium)';
          const next =
            text.slice(0, end) + injected + text.slice(end);
          // Body link outside nav must remain ignored; plant one to prove boundary.
          const withBody =
            next +
            '\n\n[body link ignored](./SKILL.md#ccm-k-point-conduct-deserting-podium)\n';
          fs.writeFileSync(skillMd, withBody);
        },
      },
    });
    assert.notEqual(validated.exitCode, 0);
    const amb = (validated.diagnostics ?? []).filter(
      (item) => item.code === 'SKG-CHANGE-SNAPSHOT-EDGE-AMBIGUOUS',
    );
    assert.ok(amb.length > 0, JSON.stringify((validated.diagnostics ?? []).map((d) => d.code)));
    const orphan = amb.find(
      (item) =>
        item.witness?.from === 'point:conduct.never-play' &&
        item.witness?.to === 'point:conduct.deserting-podium',
    );
    assert.ok(orphan, JSON.stringify(amb.map((item) => item.witness)));
    assert.deepEqual(orphan.witness.candidate_edge_ids, []);
    const claude = validated.validation?.host_projection_witnesses?.find(
      (item) => item.host === 'claude-code',
    );
    assert.equal(claude?.ok, false);
    assert.equal(claude?.final_surface_snapshot, undefined);
  });
});

test('CODEX-E: envelope rejects snapshot edge-set mismatches', () => {
  const hash = 'a'.repeat(64);
  const successHop = {
    ok: true,
    witness: { host: 'claude-code' },
    remediation: 'ok',
  };
  const edge = {
    id: 'edge:conduct.principle-to-red-lines',
    from: 'point:conduct.never-play',
    to: 'point:conduct.red-lines',
    enabled_by_default: true,
  };
  const goodSnap = {
    host: 'claude-code',
    mode: 'full',
    final_root: 'plugin/dist/claude-code',
    fileset_manifest: ['knowledge/atlas.md'],
    fileset: [{ path: 'knowledge/atlas.md', kind: 'file', bytes: 1, sha256: hash }],
    skills: [],
    modules: [],
    points: [],
    edges: [edge],
    entries: [],
    enabled_edge_ids: [edge.id],
    enabled_adjacency: {
      [edge.from]: [{ to: edge.to, edge_id: edge.id }],
    },
  };
  const baseFull = {
    host: 'claude-code',
    ok: true,
    mode: 'full',
    artifacts: [{ path: 'knowledge/atlas.md', bytes: 1 }],
    enabled_edges: 1,
    point_anchors: 1,
    hop_report: { H1: successHop, H2: successHop, H3: successHop, H4: successHop },
    budgets: { atlas_lines: 1 },
    executed_checks: ['candidate_runtime_sync', 'candidate_runtime_verify'],
    conditional_route_policy: 'enabled_by_default-only',
    result_graph_sha256: hash,
    final_surface_snapshot: goodSnap,
  };
  const stubs = PRODUCT_HOSTS.slice(1).map((host) => ({
    host,
    ok: true,
    mode: 'stub',
    artifacts: [],
    enabled_edges: 0,
    point_anchors: 0,
    hop_report: {
      H1: { ok: true, witness: { host, abstained: true, mode: 'stub' }, remediation: 'x' },
      H2: { ok: true, witness: { host, abstained: true, mode: 'stub' }, remediation: 'x' },
      H3: { ok: true, witness: { host, abstained: true, mode: 'stub' }, remediation: 'x' },
      H4: { ok: true, witness: { host, abstained: true, mode: 'stub' }, remediation: 'x' },
    },
    budgets: {},
    executed_checks: ['host_coverage_stub_abstention'],
    conditional_route_policy: 'abstained',
    result_graph_sha256: hash,
  }));
  const doc = {
    schema_version: 'cc-master/skill-knowledge-validation/v1alpha1',
    kind: 'change_validation',
    change_id: 'change:codex-e',
    base_ref: 'HEAD',
    base_graph_sha256: hash,
    scope: [],
    result_graph_sha256: hash,
    candidate_valid: true,
    candidate_runtime_valid: true,
    optimistic_lock_valid: true,
    git_apply_check: true,
    patch_sha256: hash,
    host_projection_witnesses: [baseFull, ...stubs],
    diagnostics: [],
  };

  assert.equal(
    validateChangeValidationSemantics(structuredClone(doc), { runtimeValid: true }).length,
    0,
  );

  const missingId = structuredClone(doc);
  missingId.host_projection_witnesses[0].final_surface_snapshot.enabled_edge_ids = [];
  assert.ok(
    validateChangeValidationSemantics(missingId, { runtimeValid: true }).some(
      (item) => item.code === 'SKG-CHANGE-VALIDATION-SNAPSHOT-EDGE-SET',
    ),
  );

  const missingEdgeObj = structuredClone(doc);
  missingEdgeObj.host_projection_witnesses[0].final_surface_snapshot.edges = [];
  assert.ok(
    validateChangeValidationSemantics(missingEdgeObj, { runtimeValid: true }).some(
      (item) => item.code === 'SKG-CHANGE-VALIDATION-SNAPSHOT-EDGE-SET',
    ),
  );

  const missingAdj = structuredClone(doc);
  missingAdj.host_projection_witnesses[0].final_surface_snapshot.enabled_adjacency = {};
  assert.ok(
    validateChangeValidationSemantics(missingAdj, { runtimeValid: true }).some(
      (item) => item.code === 'SKG-CHANGE-VALIDATION-SNAPSHOT-EDGE-SET',
    ),
  );

  const forged = structuredClone(doc);
  forged.host_projection_witnesses[0].final_surface_snapshot.enabled_edge_ids = [
    edge.id,
    'edge:forged-extra',
  ];
  forged.host_projection_witnesses[0].enabled_edges = 2;
  forged.host_projection_witnesses[0].final_surface_snapshot.edges = [
    edge,
    {
      id: 'edge:forged-extra',
      from: 'point:conduct.never-play',
      to: 'point:conduct.deserting-podium',
      enabled_by_default: true,
    },
  ];
  // adjacency still only the real edge → forge / incomplete correspondence
  assert.ok(
    validateChangeValidationSemantics(forged, { runtimeValid: true }).some(
      (item) => item.code === 'SKG-CHANGE-VALIDATION-SNAPSHOT-EDGE-SET',
    ),
  );

  const dupIds = structuredClone(doc);
  dupIds.host_projection_witnesses[0].final_surface_snapshot.enabled_edge_ids = [
    edge.id,
    edge.id,
  ];
  dupIds.host_projection_witnesses[0].enabled_edges = 2;
  dupIds.host_projection_witnesses[0].final_surface_snapshot.edges = [edge, { ...edge }];
  dupIds.host_projection_witnesses[0].final_surface_snapshot.enabled_adjacency = {
    [edge.from]: [
      { to: edge.to, edge_id: edge.id },
      { to: edge.to, edge_id: edge.id },
    ],
  };
  assert.ok(
    validateChangeValidationSemantics(dupIds, { runtimeValid: true }).some(
      (item) => item.code === 'SKG-CHANGE-VALIDATION-SNAPSHOT-EDGE-SET',
    ),
  );
});

test('CODEX-B: standalone change validator enforces mode+ok snapshot branches', async () => {
  const { validateAuthoredDocument } = await import(
    '../../scripts/skill-knowledge/schema.mjs'
  );
  const hash = 'a'.repeat(64);
  const successHop = {
    ok: true,
    witness: { host: 'claude-code' },
    remediation: 'ok',
  };
  const abstainedHop = {
    ok: true,
    witness: { host: 'codex', abstained: true, mode: 'stub' },
    remediation: 'ok',
  };
  const base = {
    schema_version: 'cc-master/skill-knowledge-validation/v1alpha1',
    kind: 'change_validation',
    change_id: 'change:20260724.codex-b',
    base_ref: 'HEAD',
    base_graph_sha256: hash,
    scope: [
      {
        path: 'plugin/src/knowledge/skills/master-orchestrator-guide/modules/conduct.never-play.json',
        sha256: hash,
      },
    ],
    result_graph_sha256: hash,
    candidate_valid: false,
    candidate_runtime_valid: false,
    optimistic_lock_valid: true,
    git_apply_check: true,
    patch_sha256: hash,
    diagnostics: [],
  };
  const okFullMissingSnap = {
    ...base,
    host_projection_witnesses: [
      {
        host: 'claude-code',
        ok: true,
        mode: 'full',
        artifacts: [{ path: 'knowledge/atlas.md', bytes: 1 }],
        enabled_edges: 1,
        point_anchors: 1,
        hop_report: { H1: successHop, H2: successHop, H3: successHop, H4: successHop },
        budgets: { atlas_lines: 1 },
        executed_checks: ['candidate_runtime_sync', 'candidate_runtime_verify'],
        conditional_route_policy: 'enabled_by_default-only',
        result_graph_sha256: hash,
      },
      ...PRODUCT_HOSTS.slice(1).map((host) => ({
        host,
        ok: true,
        mode: 'stub',
        artifacts: [],
        enabled_edges: 0,
        point_anchors: 0,
        hop_report: {
          H1: { ...abstainedHop, witness: { host, abstained: true, mode: 'stub' } },
          H2: { ...abstainedHop, witness: { host, abstained: true, mode: 'stub' } },
          H3: { ...abstainedHop, witness: { host, abstained: true, mode: 'stub' } },
          H4: { ...abstainedHop, witness: { host, abstained: true, mode: 'stub' } },
        },
        budgets: {},
        executed_checks: ['host_coverage_stub_abstention'],
        conditional_route_policy: 'abstained',
        result_graph_sha256: hash,
      })),
    ],
  };
  const red = validateAuthoredDocument(okFullMissingSnap, 'change');
  assert.equal(red.ok, false, 'ok full without snapshot must fail schema');

  const snap = {
    host: 'claude-code',
    mode: 'full',
    final_root: 'plugin/dist/claude-code',
    fileset_manifest: ['knowledge/atlas.md'],
    fileset: [{ path: 'knowledge/atlas.md', kind: 'file', bytes: 1, sha256: hash }],
    skills: [],
    modules: [],
    points: [],
    edges: [],
    entries: [],
    enabled_edge_ids: [],
    enabled_adjacency: {},
  };
  okFullMissingSnap.host_projection_witnesses[0].final_surface_snapshot = snap;
  const green = validateAuthoredDocument(okFullMissingSnap, 'change');
  assert.equal(green.ok, true, JSON.stringify(green.errors?.slice(0, 8)));

  const failedWithSnap = structuredClone(okFullMissingSnap);
  failedWithSnap.host_projection_witnesses[0].ok = false;
  const forbid = validateAuthoredDocument(failedWithSnap, 'change');
  assert.equal(forbid.ok, false, 'failed full/partial must not carry snapshot');
});

test('CODEX-C: provider-guidance overlay bridge keeps pretty JSON diagnostics', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { parseStructuredJsonStdout } = require('../../scripts/skill-knowledge/json-framing.cjs');
  const pretty = `${JSON.stringify(
    {
      ok: false,
      code: 'SKG-OVERLAY-RAW-SAP-POLLUTED',
      diagnostics: [{ severity: 'error', code: 'SKG-OVERLAY-EXTRA', message: 'x' }],
    },
    null,
    2,
  )}\n`;
  const parsed = parseStructuredJsonStdout(pretty, { label: 'overlay inspect bridge' });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.diagnostics[0].code, 'SKG-OVERLAY-EXTRA');
});

test('CODEX-D-product: second envelope gate failure refuses to write validation.json', async () => {
  const tx = await import(transactionModule);
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    initGit(repoRoot);
    const begun = tx.beginTransaction({
      repoRoot,
      operation: 'refine',
      scope: [MODULE_PATH],
      base: 'HEAD',
    });
    refineSummary(begun.workspace, '(f6-product)');
    const validated = tx.validateTransaction({
      repoRoot,
      workspace: begun.workspace,
      testSeams: {
        forceFirstEnvelopeFailure(document) {
          for (const witness of document.host_projection_witnesses ?? []) {
            if (witness.mode === 'full' || witness.mode === 'partial') {
              delete witness.final_surface_snapshot;
            }
          }
        },
        corruptAfterEnvelopeRewrite(document) {
          document.candidate_valid = true;
          document.candidate_runtime_valid = false;
        },
      },
    });
    assert.notEqual(validated.exitCode, 0);
    assert.equal(fs.existsSync(path.join(begun.workspace, 'validation.json')), false);
    assert.ok(
      (validated.diagnostics ?? []).some((item) =>
        String(item.code).startsWith('SKG-CHANGE-VALIDATION-'),
      ),
      JSON.stringify((validated.diagnostics ?? []).map((item) => item.code)),
    );
  });
});
