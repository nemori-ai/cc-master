/**
 * Candidate runtime hard gate for change validate: path authority, mixed host
 * coverage, failure witnesses, mutation measurements, and conditional edges.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { withIsolatedSkillKnowledgeRepo } from './helpers/skill-knowledge-isolated-repo.mjs';
import { validateAuthoredDocument } from '../../scripts/skill-knowledge/schema.mjs';
import { validateChangeValidationSemantics } from '../../scripts/skill-knowledge/validation-envelope.mjs';
import {
  projectCoverageSubgraph,
  resolveHostCoveragePlan,
} from '../../scripts/skill-knowledge/host-coverage.mjs';
import { buildAndValidateGraph } from '../../scripts/skill-knowledge/graph.mjs';

const PRODUCT_HOSTS = Object.freeze(['claude-code', 'codex', 'cursor', 'kimi-code']);
const MODULE_PATH =
  'plugin/src/knowledge/skills/master-orchestrator-guide/modules/conduct.never-play.json';
const SKILL_PATH = 'plugin/src/knowledge/skills/master-orchestrator-guide/skill.json';
const ENTRY_PATH = 'plugin/src/commands/as-master-orchestrator/adapters/claude-code/body.md';
const LEDGER_DIR = 'plugin/src/knowledge/changes';
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

function sha256Bytes(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function acceptedSourceDigest(repoRoot) {
  const rows = [];
  const visit = (directory, relativePrefix) => {
    if (!fs.existsSync(directory)) return;
    for (const dirent of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const absolute = path.join(directory, dirent.name);
      const relative = relativePrefix ? `${relativePrefix}/${dirent.name}` : dirent.name;
      if (dirent.isSymbolicLink()) {
        rows.push(`symlink:${relative}->${fs.readlinkSync(absolute)}`);
        continue;
      }
      if (dirent.isDirectory()) {
        rows.push(`dir:${relative}`);
        visit(absolute, relative);
        continue;
      }
      if (dirent.isFile()) {
        rows.push(`file:${relative}:${sha256Bytes(fs.readFileSync(absolute))}`);
      }
    }
  };
  visit(path.join(repoRoot, 'plugin/src'), 'plugin/src');
  return sha256Bytes(Buffer.from(rows.join('\n'), 'utf8'));
}

function liveDistDigest(repoRoot) {
  const distRoot = path.join(repoRoot, 'plugin/dist');
  if (!fs.existsSync(distRoot)) return sha256Bytes(Buffer.from('', 'utf8'));
  const rows = [];
  const visit = (directory, relativePrefix) => {
    for (const dirent of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (dirent.name === 'codex-marketplace') continue;
      const absolute = path.join(directory, dirent.name);
      const relative = relativePrefix ? `${relativePrefix}/${dirent.name}` : dirent.name;
      if (dirent.isSymbolicLink()) {
        rows.push(`symlink:${relative}->${fs.readlinkSync(absolute)}`);
        continue;
      }
      if (dirent.isDirectory()) {
        rows.push(`dir:${relative}`);
        visit(absolute, relative);
        continue;
      }
      if (dirent.isFile()) {
        rows.push(`file:${relative}:${sha256Bytes(fs.readFileSync(absolute))}`);
      }
    }
  };
  visit(distRoot, 'plugin/dist');
  return sha256Bytes(Buffer.from(rows.join('\n'), 'utf8'));
}

function ledgerListing(repoRoot) {
  const dir = path.join(repoRoot, LEDGER_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort();
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
        reason: 'candidate runtime gate fixture',
        operations: [operation],
        evidence: [{ kind: 'test', ref: 'skill-knowledge-change-candidate-runtime.test.mjs' }],
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
    rationale: 'typed refine for candidate runtime gate coverage',
  });
}

function editCandidateProjectionBreak(workspace) {
  refineSummary(workspace, '(candidate runtime gate)');
  const entryPath = path.join(workspace, 'candidate', ENTRY_PATH);
  const entryText = fs.readFileSync(entryPath, 'utf8');
  assert.match(entryText, /cc-master:bootstrap:v1/);
  fs.writeFileSync(
    entryPath,
    entryText.replaceAll('cc-master:bootstrap:v1', 'cc-master:bootstrap:BROKEN'),
  );
}

function setHostCoverage(workspace, coverageRows) {
  const skillPath = path.join(workspace, 'candidate', SKILL_PATH);
  const document = JSON.parse(fs.readFileSync(skillPath, 'utf8'));
  document.host_coverage = coverageRows;
  fs.writeFileSync(skillPath, `${JSON.stringify(document, null, 2)}\n`);
}

function abstainedWitness(host, hash, ok = true) {
  const gate = {
    ok: true,
    witness: { abstained: true, host, mode: 'stub' },
    remediation: 'Host coverage is stub; point hop gates are abstained.',
  };
  return {
    host,
    ok,
    mode: 'stub',
    artifacts: [],
    enabled_edges: 0,
    point_anchors: 0,
    hop_report: { H1: { ...gate }, H2: { ...gate }, H3: { ...gate }, H4: { ...gate } },
    budgets: {},
    executed_checks: ['host_coverage_stub_abstention'],
    conditional_route_policy: 'abstained',
    result_graph_sha256: hash,
  };
}

test('SKG-TX-RUNTIME-01: validate fail-closes on ENTRY-ANCHOR-MISSING; accepted+ledger+dist untouched', async () => {
  const tx = await import(transactionModule);
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    initGit(repoRoot);
    const beforeDigest = acceptedSourceDigest(repoRoot);
    const beforeDist = liveDistDigest(repoRoot);
    const beforeLedger = ledgerListing(repoRoot);

    const begun = tx.beginTransaction({
      repoRoot,
      operation: 'refine',
      scope: [MODULE_PATH, ENTRY_PATH],
      base: 'HEAD',
    });
    assert.equal(begun.exitCode, 0, JSON.stringify(begun.diagnostics));
    editCandidateProjectionBreak(begun.workspace);

    const validated = tx.validateTransaction({ repoRoot, workspace: begun.workspace });

    assert.notEqual(validated.exitCode, 0);
    assert.equal(validated.validation?.candidate_valid, false);
    assert.equal(validated.validation?.candidate_runtime_valid, false);
    assert.ok(
      (validated.diagnostics ?? []).some((item) => item.code === 'SKG-ENTRY-ANCHOR-MISSING'),
      `expected SKG-ENTRY-ANCHOR-MISSING, got: ${JSON.stringify(
        (validated.diagnostics ?? []).map((item) => item.code),
      )}`,
    );
    assert.equal(validated.validation?.host_projection_witnesses?.length, 4);
    for (const witness of validated.validation.host_projection_witnesses) {
      assert.equal(witness.ok, false, JSON.stringify(witness));
      for (const gate of ['H1', 'H2', 'H3', 'H4']) {
        if (witness.hop_report[gate].witness?.skipped) {
          assert.equal(witness.hop_report[gate].ok, false);
        }
        assert.notEqual(witness.hop_report[gate].witness?.abstained, true);
      }
      assert.ok(!witness.executed_checks.includes('candidate_runtime_compile'));
    }

    assert.equal(acceptedSourceDigest(repoRoot), beforeDigest);
    assert.equal(liveDistDigest(repoRoot), beforeDist);
    assert.deepEqual(ledgerListing(repoRoot), beforeLedger);
    assert.equal(fs.existsSync(path.join(begun.workspace, 'runtime-candidate')), false);
  });
});

test('SKG-TX-RUNTIME-02: validate success emits four host witnesses sharing result_graph_sha256', async () => {
  const tx = await import(transactionModule);
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    initGit(repoRoot);
    const beforeDigest = acceptedSourceDigest(repoRoot);
    const beforeDist = liveDistDigest(repoRoot);
    const beforeLedger = ledgerListing(repoRoot);

    const begun = tx.beginTransaction({
      repoRoot,
      operation: 'refine',
      scope: [MODULE_PATH],
      base: 'HEAD',
    });
    assert.equal(begun.exitCode, 0, JSON.stringify(begun.diagnostics));
    refineSummary(begun.workspace, '(runtime success)');

    const validated = tx.validateTransaction({ repoRoot, workspace: begun.workspace });
    assert.equal(validated.exitCode, 0, JSON.stringify(validated.diagnostics));
    assert.equal(validated.validation.candidate_valid, true);
    assert.equal(validated.validation.candidate_runtime_valid, true);

    const witnesses = validated.validation.host_projection_witnesses;
    assert.equal(witnesses.length, 4);
    assert.deepEqual(
      witnesses.map((item) => item.host),
      [...PRODUCT_HOSTS],
    );
    for (const witness of witnesses) {
      assert.equal(witness.ok, true, JSON.stringify(witness));
      assert.equal(witness.mode, 'full');
      assert.equal(witness.conditional_route_policy, 'enabled_by_default-only');
      assert.equal(witness.result_graph_sha256, validated.validation.result_graph_sha256);
      assert.ok(witness.executed_checks.includes('candidate_runtime_sync'));
      assert.ok(witness.executed_checks.includes('candidate_runtime_compile_check'));
      assert.ok(!witness.executed_checks.includes('candidate_runtime_compile'));
      for (const gate of ['H1', 'H2', 'H3', 'H4']) {
        assert.equal(witness.hop_report[gate].ok, true, `${witness.host} ${gate}`);
        assert.notEqual(witness.hop_report[gate].witness?.abstained, true);
      }
    }

    const schema = validateAuthoredDocument(validated.validation, 'change');
    assert.equal(schema.ok, true, JSON.stringify(schema.errors));

    assert.equal(acceptedSourceDigest(repoRoot), beforeDigest);
    assert.equal(liveDistDigest(repoRoot), beforeDist);
    assert.deepEqual(ledgerListing(repoRoot), beforeLedger);
  });
});

test('SKG-TX-RUNTIME-03: coverage aggregation rejects full+stub / full+partial as overall full', () => {
  const { plan } = resolveHostCoveragePlan({
    skills: [
      {
        data: {
          id: 'skill:a',
          modules: [{ id: 'module:a' }],
          host_coverage: [
            { host: 'claude-code', state: 'full' },
            { host: 'codex', state: 'full' },
            { host: 'cursor', state: 'partial', covered_modules: ['module:a'], reason: 'partial' },
            { host: 'kimi-code', state: 'stub', reason: 'stub' },
          ],
        },
      },
      {
        data: {
          id: 'skill:b',
          modules: [{ id: 'module:b' }],
          host_coverage: [
            { host: 'claude-code', state: 'stub', reason: 'stub' },
            { host: 'codex', state: 'partial', covered_modules: ['module:b'], reason: 'partial' },
            { host: 'cursor', state: 'full' },
            { host: 'kimi-code', state: 'stub', reason: 'stub' },
          ],
        },
      },
    ],
  });
  assert.equal(plan['claude-code'].mode, 'partial');
  assert.equal(plan.codex.mode, 'partial');
  assert.equal(plan.cursor.mode, 'partial');
  assert.equal(plan['kimi-code'].mode, 'stub');
  assert.deepEqual(plan.codex.moduleIds, ['module:a', 'module:b']);
});

test('SKG-TX-RUNTIME-04: all-stub does not cleanup unknown/outside runtime symlink sentinel', async () => {
  const tx = await import(transactionModule);
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    initGit(repoRoot);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-outside-'));
    const sentinel = path.join(outside, 'sentinel.txt');
    fs.writeFileSync(sentinel, 'alive\n');

    const begun = tx.beginTransaction({
      repoRoot,
      operation: 'refine',
      scope: [MODULE_PATH, SKILL_PATH],
      base: 'HEAD',
    });
    assert.equal(begun.exitCode, 0, JSON.stringify(begun.diagnostics));
    refineSummary(begun.workspace, '(all-stub)');
    setHostCoverage(
      begun.workspace,
      PRODUCT_HOSTS.map((host) => ({ host, state: 'stub', reason: 'all-stub fixture' })),
    );
    // Also declare refine on skill coverage via refine draft already set; skill change needs refine fields.
    // Coverage-only skill mutation is unexplained unless we include skill in refine differently.
    // Use a wording-free path: rewrite draft as refine on point only; skill host_coverage change
    // would be unexplained. For all-stub runtime gate we call the runtime helper path via
    // validate after making coverage change explained — temporarily use refine on skill summary
    // is not available. Instead mutate only for unit runtime by importing validateCandidateRuntime.
    const { validateCandidateRuntimeProjection } = await import(
      '../../scripts/skill-knowledge/candidate-runtime.mjs'
    );
    const runtimeLink = path.join(begun.workspace, 'runtime-candidate');
    fs.symlinkSync(outside, runtimeLink);

    const runtime = validateCandidateRuntimeProjection({
      repoRoot,
      workspace: begun.workspace,
      scope: JSON.parse(fs.readFileSync(path.join(begun.workspace, 'workspace.json'), 'utf8')).scope,
      candidateGraph: {
        skills: [
          {
            data: {
              id: 'skill:master-orchestrator-guide',
              modules: [{ id: 'module:conduct.never-play' }],
              host_coverage: PRODUCT_HOSTS.map((host) => ({
                host,
                state: 'stub',
                reason: 'all-stub',
              })),
            },
          },
        ],
      },
      resultGraphSha256: 'a'.repeat(64),
    });

    assert.equal(runtime.candidate_runtime_valid, true, JSON.stringify(runtime.diagnostics));
    assert.equal(fs.existsSync(sentinel), true, 'outside sentinel must survive all-stub cleanup');
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'alive\n');
    assert.ok(fs.lstatSync(runtimeLink).isSymbolicLink());
    fs.rmSync(outside, { recursive: true, force: true });
  });
});

test('SKG-TX-RUNTIME-05: workspace symlink escape fails closed and does not delete outside sentinel', async () => {
  const { validateCandidateRuntimeProjection } = await import(
    '../../scripts/skill-knowledge/candidate-runtime.mjs'
  );
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    initGit(repoRoot);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-ws-outside-'));
    const sentinel = path.join(outside, 'do-not-delete.txt');
    fs.writeFileSync(sentinel, 'keep\n');

    const workspaces = path.join(repoRoot, '.skill-knowledge', 'workspaces');
    fs.mkdirSync(workspaces, { recursive: true });
    const fakeWorkspace = path.join(workspaces, 'symlink-escape');
    fs.symlinkSync(outside, fakeWorkspace);
    fs.mkdirSync(path.join(outside, 'candidate'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'candidate', 'x.json'), '{}\n');

    const runtime = validateCandidateRuntimeProjection({
      repoRoot,
      workspace: fakeWorkspace,
      scope: [{ path: 'x.json', sha256: 'b'.repeat(64) }],
      candidateGraph: {
        skills: [
          {
            data: {
              id: 'skill:demo',
              modules: [{ id: 'module:demo' }],
              host_coverage: PRODUCT_HOSTS.map((host) => ({
                host,
                state: 'full',
              })),
            },
          },
        ],
      },
      resultGraphSha256: 'c'.repeat(64),
    });

    assert.equal(runtime.candidate_runtime_valid, false);
    assert.ok(
      runtime.diagnostics.some(
        (item) =>
          item.code === 'SKG-PATH-AUTHORITY-SYMLINK' ||
          item.code === 'SKG-PATH-AUTHORITY-WORKSPACE' ||
          item.code === 'SKG-PATH-AUTHORITY-ESCAPE',
      ),
      JSON.stringify(runtime.diagnostics),
    );
    assert.equal(fs.existsSync(sentinel), true);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep\n');
    for (const witness of runtime.witnesses) {
      if (witness.mode === 'full' || witness.mode === 'partial') {
        assert.equal(witness.ok, false);
        assert.equal(witness.hop_report.H1.ok, false);
        assert.equal(witness.hop_report.H1.witness.skipped, true);
      }
    }
    fs.rmSync(outside, { recursive: true, force: true });
  });
});

test('SKG-TX-RUNTIME-06: mixed full/partial/stub four-host E2E excludes a real module from partial tree', async () => {
  const tx = await import(transactionModule);
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    const skillDoc = JSON.parse(fs.readFileSync(path.join(repoRoot, SKILL_PATH), 'utf8'));
    const covered = ['module:conduct.never-play', 'module:verification.endpoint'];
    const excluded = 'module:routing.worker-chain';
    skillDoc.host_coverage = [
      { host: 'claude-code', state: 'full' },
      {
        host: 'codex',
        state: 'partial',
        covered_modules: covered,
        reason: 'mixed partial fixture excludes routing.worker-chain',
      },
      { host: 'cursor', state: 'stub', reason: 'mixed stub fixture' },
      { host: 'kimi-code', state: 'stub', reason: 'mixed stub fixture' },
    ];
    fs.writeFileSync(path.join(repoRoot, SKILL_PATH), `${JSON.stringify(skillDoc, null, 2)}\n`);
    initGit(repoRoot);
    const beforeDigest = acceptedSourceDigest(repoRoot);
    const beforeDist = liveDistDigest(repoRoot);
    const beforeLedger = ledgerListing(repoRoot);

    const begun = tx.beginTransaction({
      repoRoot,
      operation: 'refine',
      scope: [MODULE_PATH],
      base: 'HEAD',
    });
    assert.equal(begun.exitCode, 0, JSON.stringify(begun.diagnostics));
    refineSummary(begun.workspace, '(mixed coverage)');

    const validated = tx.validateTransaction({ repoRoot, workspace: begun.workspace });
    assert.equal(validated.exitCode, 0, JSON.stringify(validated.diagnostics));
    const byHost = Object.fromEntries(
      validated.validation.host_projection_witnesses.map((item) => [item.host, item]),
    );
    assert.equal(byHost['claude-code'].mode, 'full');
    assert.equal(byHost.codex.mode, 'partial');
    assert.equal(byHost.cursor.mode, 'stub');
    assert.equal(byHost['kimi-code'].mode, 'stub');
    assert.equal(byHost.cursor.point_anchors, 0);
    assert.equal(byHost.cursor.enabled_edges, 0);
    assert.equal(byHost.cursor.artifacts.length, 0);
    assert.equal(byHost.cursor.hop_report.H1.witness.abstained, true);
    assert.equal(byHost.codex.conditional_route_policy, 'enabled_by_default-only');
    assert.notEqual(byHost.codex.mode, 'full');
    assert.ok(byHost.codex.ok, JSON.stringify(byHost.codex));
    assert.ok(byHost.codex.executed_checks.includes('candidate_runtime_partial_tree'));
    // Excluded module must not appear in partial artifact denominator.
    assert.ok(
      !byHost.codex.artifacts.some((item) => String(item.path).includes('routing.worker-chain')),
      `excluded module leaked into codex artifacts: ${JSON.stringify(byHost.codex.artifacts)}`,
    );
    assert.ok(
      byHost.codex.artifacts.some((item) => String(item.path).includes('conduct.never-play')),
      'covered module missing from partial artifacts',
    );

    // Assert pruned final surface from witness snapshot (captured before cleanup).
    const snap = byHost.codex.final_surface_snapshot;
    assert.ok(snap, 'codex witness must include final_surface_snapshot');
    assert.equal(snap.mode, 'partial');
    assert.match(snap.final_root, /^plugin\/dist\/codex\.write-partial-/);
    assert.ok(
      !snap.fileset_manifest.some((item) => item.includes('routing.worker-chain')),
      `excluded module path leaked into final fileset: ${JSON.stringify(
        snap.fileset_manifest.filter((item) => item.includes('routing')),
      )}`,
    );
    assert.ok(
      snap.fileset_manifest.some((item) => item.includes('conduct.never-play')),
      'covered module missing from final fileset',
    );
    assert.ok(!snap.modules.some((item) => item.id === excluded));
    assert.ok(!snap.points.some((item) => item.module_id === excluded));
    assert.ok(
      !snap.edges.some(
        (item) => item.from.startsWith('point:routing.') || item.to.startsWith('point:routing.'),
      ),
    );
    for (const entry of snap.entries ?? []) {
      for (const target of entry.targets ?? []) {
        assert.notEqual(target.module, excluded, JSON.stringify(target));
        assert.ok(
          covered.includes(target.module),
          `entry target module ${target.module} outside covered_modules`,
        );
      }
    }
    for (const module of snap.modules) {
      for (const primary of module.access?.primary_points ?? []) {
        const point = snap.points.find((item) => item.id === primary);
        assert.ok(point, `access.primary_points leaked excluded primary ${primary}`);
        assert.notEqual(point.module_id, excluded);
      }
    }
    const skillSnap = snap.skills.find((item) => item.id === 'skill:master-orchestrator-guide');
    assert.ok(skillSnap);
    const coveredFromSnap = skillSnap.covered_modules_by_host.codex;
    assert.ok(Array.isArray(coveredFromSnap));
    for (const moduleId of coveredFromSnap) {
      assert.ok(
        skillSnap.modules.includes(moduleId),
        `covered_modules ${moduleId} must belong to declaring skill modules`,
      );
    }
    assert.equal(fs.existsSync(path.join(begun.workspace, 'runtime-candidate')), false);

    assert.equal(acceptedSourceDigest(repoRoot), beforeDigest);
    assert.equal(liveDistDigest(repoRoot), beforeDist);
    assert.deepEqual(ledgerListing(repoRoot), beforeLedger);
  });
});

test('SKG-TX-RUNTIME-07: apply re-runs validate and rejects after candidate corruption', async () => {
  const tx = await import(transactionModule);
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    initGit(repoRoot);
    const beforeDigest = acceptedSourceDigest(repoRoot);
    const beforeDist = liveDistDigest(repoRoot);
    const beforeLedger = ledgerListing(repoRoot);

    const begun = tx.beginTransaction({
      repoRoot,
      operation: 'refine',
      scope: [MODULE_PATH],
      base: 'HEAD',
    });
    refineSummary(begun.workspace, '(apply revalidate)');
    const validated = tx.validateTransaction({ repoRoot, workspace: begun.workspace });
    assert.equal(validated.exitCode, 0, JSON.stringify(validated.diagnostics));

    // Corrupt a field outside the declared refine changed_fields so re-validate
    // must fail closed (summary-only refine cannot explain recognition_cues drift).
    const modulePath = path.join(begun.workspace, 'candidate', MODULE_PATH);
    const document = JSON.parse(fs.readFileSync(modulePath, 'utf8'));
    document.points[0].recognition_cues = ['CORRUPT AFTER VALIDATE'];
    fs.writeFileSync(modulePath, `${JSON.stringify(document, null, 2)}\n`);

    const applied = tx.applyTransaction({ repoRoot, workspace: begun.workspace });
    assert.notEqual(applied.exitCode, 0);
    assert.equal(applied.validation?.candidate_valid, false);
    assert.ok(
      (applied.diagnostics ?? []).some(
        (item) =>
          item.code === 'SKG-CHANGE-UNEXPLAINED-DIFF' || item.code === 'SKG-CHANGE-PRECONDITION',
      ),
      JSON.stringify((applied.diagnostics ?? []).map((item) => item.code)),
    );
    assert.equal(acceptedSourceDigest(repoRoot), beforeDigest);
    assert.equal(liveDistDigest(repoRoot), beforeDist);
    assert.deepEqual(ledgerListing(repoRoot), beforeLedger);
  });
});

test('SKG-TX-RUNTIME-08: enabled_by_default false edges are not emitted into adjacency', async () => {
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    initGit(repoRoot);
    const modulePath = path.join(repoRoot, MODULE_PATH);
    const document = JSON.parse(fs.readFileSync(modulePath, 'utf8'));
    const disabledId = 'edge:conduct.disabled-for-k1-runtime';
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

    const built = buildAndValidateGraph({ repoRoot });
    assert.equal(built.ok, true, JSON.stringify(built.diagnostics.filter((d) => d.severity === 'error')));
    const from = built.graph.adjacency.get('point:conduct.never-play') ?? [];
    assert.ok(
      !from.some((item) => item.edge_id === disabledId),
      `disabled edge leaked into adjacency: ${JSON.stringify(from)}`,
    );
    // The default-enabled twin edge may still be present; only the false edge must be absent.
    assert.ok(from.some((item) => item.edge_id === 'edge:conduct.principle-to-red-lines'));

    const projected = projectCoverageSubgraph(built.graph, [
      'module:conduct.never-play',
    ]);
    const projectedFrom = projected.adjacency.get('point:conduct.never-play') ?? [];
    assert.ok(!projectedFrom.some((item) => item.edge_id === disabledId));
  });
});

test('SKG-TX-RUNTIME-09: hop verifier mutation yields precise SKG-HOP diagnostics', async () => {
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    initGit(repoRoot);
    // Project one host so surface verifier has a real payload root.
    const sync = spawnSync('bash', ['scripts/sync-plugin-dist.sh', '--host', 'claude-code'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.equal(sync.status, 0, sync.stderr);
    const built = buildAndValidateGraph({ repoRoot });
    assert.equal(built.ok, true, JSON.stringify(built.diagnostics.filter((d) => d.severity === 'error')));

    const { verifyHopContracts, countEnabledRuntimeEdges } = await import(
      '../../scripts/skill-knowledge/compile/surface-verifier.mjs'
    );
    const payloadRoot = path.join(repoRoot, 'plugin/dist/claude-code');
    const surface = countEnabledRuntimeEdges({
      host: 'claude-code',
      payloadRoot,
      repoRoot,
      mode: 'canonical',
      scopedRoots: ['knowledge', 'skills/master-orchestrator-guide'],
    });
    // Mutate the surface navigation plane the hop verifier actually consumes.
    const brokenSurface = {
      ...surface,
      enabled_edges: 0,
      enabled_edge_list: [],
    };
    const hops = verifyHopContracts({
      host: 'claude-code',
      graph: built.graph,
      surface: brokenSurface,
      repoRoot,
      payloadRoot,
    });
    assert.ok(
      hops.diagnostics.some((item) => String(item.code).startsWith('SKG-HOP-')),
      JSON.stringify(hops.diagnostics.map((item) => item.code)),
    );
    assert.equal(hops.hopReport.H1.ok, false);
    assert.notEqual(hops.hopReport.H1.witness?.abstained, true);
  });
});

test('SKG-TX-RUNTIME-10: router budget failure fail-closes with SKG-BUDGET-ROUTER', async () => {
  const tx = await import(transactionModule);
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    const portfolioPath = path.join(repoRoot, 'plugin/src/knowledge/portfolio.json');
    const portfolio = JSON.parse(fs.readFileSync(portfolioPath, 'utf8'));
    portfolio.router_budget = {
      ...portfolio.router_budget,
      atlas_max_lines: 1,
      atlas_max_tokens: 8,
    };
    fs.writeFileSync(portfolioPath, `${JSON.stringify(portfolio, null, 2)}\n`);
    initGit(repoRoot);
    const beforeDigest = acceptedSourceDigest(repoRoot);
    const beforeDist = liveDistDigest(repoRoot);

    const begun = tx.beginTransaction({
      repoRoot,
      operation: 'refine',
      scope: [MODULE_PATH],
      base: 'HEAD',
    });
    refineSummary(begun.workspace, '(budget fail)');
    const validated = tx.validateTransaction({ repoRoot, workspace: begun.workspace });
    assert.notEqual(validated.exitCode, 0);
    assert.equal(validated.validation?.candidate_valid, false);
    assert.ok(
      (validated.diagnostics ?? []).some((item) => item.code === 'SKG-BUDGET-ROUTER'),
      JSON.stringify((validated.diagnostics ?? []).map((item) => item.code)),
    );
    assert.equal(acceptedSourceDigest(repoRoot), beforeDigest);
    assert.equal(liveDistDigest(repoRoot), beforeDist);
  });
});

test('SKG-TX-RUNTIME-11: validation envelope schema+semantic reject bad hosts/hash/stub surfaces', () => {
  const hash = 'd'.repeat(64);
  const base = {
    schema_version: 'cc-master/skill-knowledge-validation/v1alpha1',
    kind: 'change_validation',
    change_id: 'change:20260724.envelope',
    base_ref: 'HEAD',
    base_graph_sha256: hash,
    scope: [{ path: 'plugin/src/knowledge/portfolio.json', sha256: hash }],
    result_graph_sha256: hash,
    candidate_valid: true,
    candidate_runtime_valid: true,
    optimistic_lock_valid: true,
    git_apply_check: true,
    patch_sha256: hash,
    diagnostics: [],
  };

  const reversed = {
    ...base,
    host_projection_witnesses: [...PRODUCT_HOSTS].reverse().map((host) => ({
      host,
      ok: true,
      mode: 'full',
      artifacts: [{ path: 'x', bytes: 1 }],
      enabled_edges: 1,
      point_anchors: 1,
      hop_report: {
        H1: { ok: true, witness: { ran: true }, remediation: 'ok' },
        H2: { ok: true, witness: { ran: true }, remediation: 'ok' },
        H3: { ok: true, witness: { ran: true }, remediation: 'ok' },
        H4: { ok: true, witness: { ran: true }, remediation: 'ok' },
      },
      budgets: {},
      executed_checks: ['candidate_runtime_verify'],
      conditional_route_policy: 'enabled_by_default-only',
      result_graph_sha256: hash,
    })),
  };
  assert.equal(validateAuthoredDocument(reversed, 'change').ok, false);

  const dup = {
    ...base,
    host_projection_witnesses: PRODUCT_HOSTS.map(() => ({
      host: 'claude-code',
      ok: true,
      mode: 'full',
      artifacts: [],
      enabled_edges: 0,
      point_anchors: 0,
      hop_report: {
        H1: { ok: true, witness: { ran: true }, remediation: 'ok' },
        H2: { ok: true, witness: { ran: true }, remediation: 'ok' },
        H3: { ok: true, witness: { ran: true }, remediation: 'ok' },
        H4: { ok: true, witness: { ran: true }, remediation: 'ok' },
      },
      budgets: {},
      executed_checks: ['x'],
      conditional_route_policy: 'enabled_by_default-only',
      result_graph_sha256: hash,
    })),
  };
  assert.equal(validateAuthoredDocument(dup, 'change').ok, false);

  const hashMismatch = {
    ...base,
    host_projection_witnesses: PRODUCT_HOSTS.map((host) => ({
      host,
      ok: true,
      mode: 'full',
      artifacts: [],
      enabled_edges: 0,
      point_anchors: 0,
      hop_report: {
        H1: { ok: true, witness: { ran: true }, remediation: 'ok' },
        H2: { ok: true, witness: { ran: true }, remediation: 'ok' },
        H3: { ok: true, witness: { ran: true }, remediation: 'ok' },
        H4: { ok: true, witness: { ran: true }, remediation: 'ok' },
      },
      budgets: {},
      executed_checks: ['x'],
      conditional_route_policy: 'enabled_by_default-only',
      result_graph_sha256: host === 'codex' ? 'e'.repeat(64) : hash,
    })),
  };
  const semanticHash = validateChangeValidationSemantics(hashMismatch);
  assert.ok(semanticHash.some((item) => item.code === 'SKG-CHANGE-VALIDATION-HASH-MISMATCH'));

  const stubLie = {
    ...base,
    candidate_valid: false,
    candidate_runtime_valid: false,
    host_projection_witnesses: PRODUCT_HOSTS.map((host) => ({
      ...abstainedWitness(host, hash, true),
      artifacts: [{ path: 'fake', bytes: 99 }],
      enabled_edges: 99,
      point_anchors: 99,
      hop_report: {
        H1: { ok: true, witness: { ran: true }, remediation: 'lie' },
        H2: { ok: true, witness: { ran: true }, remediation: 'lie' },
        H3: { ok: true, witness: { ran: true }, remediation: 'lie' },
        H4: { ok: true, witness: { ran: true }, remediation: 'lie' },
      },
      conditional_route_policy: 'enabled_by_default-only',
    })),
  };
  assert.equal(validateAuthoredDocument(stubLie, 'change').ok, false);

  // Reverse inconsistency: internals all green but candidate_valid false.
  const reverseLie = {
    ...base,
    candidate_valid: false,
    candidate_runtime_valid: true,
    host_projection_witnesses: PRODUCT_HOSTS.map((host) => ({
      host,
      ok: true,
      mode: 'full',
      artifacts: [{ path: 'x', bytes: 1 }],
      enabled_edges: 1,
      point_anchors: 1,
      hop_report: {
        H1: { ok: true, witness: { ran: true }, remediation: 'ok' },
        H2: { ok: true, witness: { ran: true }, remediation: 'ok' },
        H3: { ok: true, witness: { ran: true }, remediation: 'ok' },
        H4: { ok: true, witness: { ran: true }, remediation: 'ok' },
      },
      budgets: { atlas: { estimated_tokens: 1 } },
      executed_checks: ['candidate_runtime_sync', 'candidate_runtime_verify'],
      conditional_route_policy: 'enabled_by_default-only',
      result_graph_sha256: hash,
    })),
  };
  const reverse = validateChangeValidationSemantics(reverseLie);
  assert.ok(
    reverse.some((item) => item.code === 'SKG-CHANGE-VALIDATION-CANDIDATE-FLAG'),
    JSON.stringify(reverse.map((item) => item.code)),
  );

  // Forward false green: ok:true with skipped hops.
  const falseGreen = {
    ...base,
    candidate_valid: true,
    host_projection_witnesses: PRODUCT_HOSTS.map((host) => ({
      host,
      ok: true,
      mode: 'full',
      artifacts: [{ path: 'x', bytes: 1 }],
      enabled_edges: 1,
      point_anchors: 1,
      hop_report: {
        H1: { ok: false, witness: { skipped: true }, remediation: 'skip' },
        H2: { ok: false, witness: { skipped: true }, remediation: 'skip' },
        H3: { ok: false, witness: { skipped: true }, remediation: 'skip' },
        H4: { ok: false, witness: { skipped: true }, remediation: 'skip' },
      },
      budgets: {},
      executed_checks: ['candidate_runtime_sync'],
      conditional_route_policy: 'enabled_by_default-only',
      result_graph_sha256: hash,
    })),
  };
  const fg = validateChangeValidationSemantics(falseGreen);
  assert.ok(fg.some((item) => item.code === 'SKG-CHANGE-VALIDATION-HOP-NOT-EXECUTED'));
});

test('SKG-TX-RUNTIME-12: typed add of accepted edge enters candidate four-host H1-H4', async () => {
  const tx = await import(transactionModule);
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    initGit(repoRoot);
    const beforeDigest = acceptedSourceDigest(repoRoot);
    const beforeDist = liveDistDigest(repoRoot);
    const beforeLedger = ledgerListing(repoRoot);

    const begun = tx.beginTransaction({
      repoRoot,
      operation: 'add',
      scope: [MODULE_PATH],
      base: 'HEAD',
    });
    assert.equal(begun.exitCode, 0, JSON.stringify(begun.diagnostics));

    const modulePath = path.join(begun.workspace, 'candidate', MODULE_PATH);
    const document = JSON.parse(fs.readFileSync(modulePath, 'utf8'));
    const proto = document.edges[0];
    const edgeId = 'edge:conduct.deserting-to-principle-roundtrip';
    document.edges.push({
      ...JSON.parse(JSON.stringify(proto)),
      id: edgeId,
      type: 'next',
      from: 'point:conduct.deserting-podium',
      to: 'point:conduct.never-play',
      when: ['roundtrip for diameter'],
      path_role: 'next',
      order: 99,
    });
    fs.writeFileSync(modulePath, `${JSON.stringify(document, null, 2)}\n`);
    writeDraft(begun.workspace, {
      op: 'add',
      entities: [edgeId],
      rationale: 'typed add of schema-legal accepted navigation edge',
    });

    const validated = tx.validateTransaction({ repoRoot, workspace: begun.workspace });
    assert.equal(validated.exitCode, 0, JSON.stringify(validated.diagnostics));
    assert.equal(validated.validation.candidate_valid, true);
    assert.equal(validated.validation.candidate_runtime_valid, true);
    for (const witness of validated.validation.host_projection_witnesses) {
      assert.equal(witness.ok, true, JSON.stringify(witness));
      assert.equal(witness.mode, 'full');
      for (const gate of ['H1', 'H2', 'H3', 'H4']) {
        assert.equal(witness.hop_report[gate].ok, true, `${witness.host} ${gate}`);
        assert.notEqual(witness.hop_report[gate].witness?.skipped, true);
        assert.notEqual(witness.hop_report[gate].witness?.abstained, true);
      }
    }
    assert.equal(acceptedSourceDigest(repoRoot), beforeDigest);
    assert.equal(liveDistDigest(repoRoot), beforeDist);
    assert.deepEqual(ledgerListing(repoRoot), beforeLedger);
  });
});

test('SKG-TX-RUNTIME-13: sync post-publish fault leaves residual dist but no H1-H4 false green', async () => {
  const { validateCandidateRuntimeProjection } = await import(
    '../../scripts/skill-knowledge/candidate-runtime.mjs'
  );
  const tx = await import(transactionModule);
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    initGit(repoRoot);
    const begun = tx.beginTransaction({
      repoRoot,
      operation: 'refine',
      scope: [MODULE_PATH],
      base: 'HEAD',
    });
    refineSummary(begun.workspace, '(post-publish fault)');
    const scope = JSON.parse(fs.readFileSync(path.join(begun.workspace, 'workspace.json'), 'utf8'))
      .scope;
    const built = buildAndValidateGraph({ repoRoot });
    assert.equal(built.ok, true);

    const runtime = validateCandidateRuntimeProjection({
      repoRoot,
      workspace: begun.workspace,
      scope,
      candidateGraph: built.graph,
      resultGraphSha256: 'a'.repeat(64),
      testSeams: {
        host: 'claude-code',
        injectPostPublishFault: () => {
          // Throw is performed by sync after this hook; residual live dist exists.
        },
      },
    });

    assert.equal(runtime.candidate_runtime_valid, false);
    const claude = runtime.witnesses.find((item) => item.host === 'claude-code');
    assert.ok(claude);
    assert.equal(claude.ok, false);
    assert.deepEqual(claude.artifacts, []);
    assert.deepEqual(claude.budgets, {});
    assert.equal(claude.enabled_edges, 0);
    assert.equal(claude.point_anchors, 0);
    assert.deepEqual(claude.executed_checks, ['candidate_runtime_sync']);
    for (const gate of ['H1', 'H2', 'H3', 'H4']) {
      assert.equal(claude.hop_report[gate].ok, false);
      assert.equal(claude.hop_report[gate].witness.skipped, true);
    }
    const syncDiag = runtime.diagnostics.find(
      (item) => item.code === 'SKG-SYNC-POST-PUBLISH-FAULT',
    );
    assert.ok(syncDiag, JSON.stringify(runtime.diagnostics.map((item) => item.code)));
    assert.equal(syncDiag.witness?.sync_envelope?.schema, 'cc-master/skill-knowledge-sync/v1alpha1');
    assert.equal(syncDiag.witness?.sync_envelope?.ok, false);
    assert.equal(syncDiag.witness?.sync_envelope?.residual_live_dist, true);
    assert.equal(syncDiag.witness?.sync_envelope?.phase, 'post_publish');
    assert.equal(syncDiag.witness?.sync_envelope?.host, 'claude-code');
  });
});

test('SKG-TX-RUNTIME-14: begin through .skill-knowledge symlink creates nothing outside repo', async () => {
  const tx = await import(transactionModule);
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    initGit(repoRoot);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-begin-outside-'));
    const sentinel = path.join(outside, 'must-stay-empty-marker');
    fs.writeFileSync(sentinel, 'before\n');
    const beforeListing = fs.readdirSync(outside).sort();

    fs.symlinkSync(outside, path.join(repoRoot, '.skill-knowledge'));
    const begun = tx.beginTransaction({
      repoRoot,
      operation: 'refine',
      scope: [MODULE_PATH],
      base: 'HEAD',
    });
    assert.notEqual(begun.exitCode, 0);
    assert.ok(
      (begun.diagnostics ?? []).some((item) => String(item.code).startsWith('SKG-PATH-AUTHORITY')),
      JSON.stringify(begun.diagnostics),
    );
    assert.deepEqual(fs.readdirSync(outside).sort(), beforeListing);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'before\n');
    // No workspaces directory created through the symlink.
    assert.equal(fs.existsSync(path.join(outside, 'workspaces')), false);
    fs.rmSync(outside, { recursive: true, force: true });
  });
});

test('SKG-TX-RUNTIME-15: pre-existing runtime sentinel survives refuse-to-reuse', async () => {
  const { validateCandidateRuntimeProjection } = await import(
    '../../scripts/skill-knowledge/candidate-runtime.mjs'
  );
  const tx = await import(transactionModule);
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    initGit(repoRoot);
    const begun = tx.beginTransaction({
      repoRoot,
      operation: 'refine',
      scope: [MODULE_PATH],
      base: 'HEAD',
    });
    refineSummary(begun.workspace, '(preexisting runtime)');
    const runtimeRoot = path.join(begun.workspace, 'runtime-candidate');
    fs.mkdirSync(runtimeRoot, { recursive: true });
    const sentinel = path.join(runtimeRoot, 'do-not-delete.txt');
    fs.writeFileSync(sentinel, 'keep-me\n');

    const scope = JSON.parse(fs.readFileSync(path.join(begun.workspace, 'workspace.json'), 'utf8'))
      .scope;
    const runtime = validateCandidateRuntimeProjection({
      repoRoot,
      workspace: begun.workspace,
      scope,
      candidateGraph: {
        skills: [
          {
            data: {
              id: 'skill:master-orchestrator-guide',
              modules: [{ id: 'module:conduct.never-play' }],
              host_coverage: PRODUCT_HOSTS.map((host) => ({ host, state: 'full' })),
            },
          },
        ],
      },
      resultGraphSha256: 'b'.repeat(64),
    });

    assert.equal(runtime.candidate_runtime_valid, false);
    assert.ok(
      runtime.diagnostics.some((item) => item.code === 'SKG-PATH-AUTHORITY-RUNTIME-EXISTS'),
      JSON.stringify(runtime.diagnostics.map((item) => item.code)),
    );
    assert.equal(fs.existsSync(sentinel), true);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep-me\n');
  });
});

test('SKG-TX-RUNTIME-15b: forged workspace token+marker never authorizes delete of unknown runtime', async () => {
  const { validateCandidateRuntimeProjection } = await import(
    '../../scripts/skill-knowledge/candidate-runtime.mjs'
  );
  const tx = await import(transactionModule);
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    initGit(repoRoot);
    const begun = tx.beginTransaction({
      repoRoot,
      operation: 'refine',
      scope: [MODULE_PATH],
      base: 'HEAD',
    });
    refineSummary(begun.workspace, '(forged ownership)');
    const runtimeRoot = path.join(begun.workspace, 'runtime-candidate');
    fs.mkdirSync(runtimeRoot, { recursive: true });
    const sentinel = path.join(runtimeRoot, 'unknown-payload.bin');
    fs.writeFileSync(sentinel, 'attacker-owned\n');
    // Forge both a workspace-side token file and an on-disk marker — still must refuse.
    const forged = 'skg-runtime:forged:deadbeef';
    fs.writeFileSync(path.join(begun.workspace, '.runtime-ownership-token'), `${forged}\n`);
    fs.writeFileSync(path.join(runtimeRoot, '.skg-runtime-ownership'), `${forged}\n`);

    const scope = JSON.parse(fs.readFileSync(path.join(begun.workspace, 'workspace.json'), 'utf8'))
      .scope;
    const runtime = validateCandidateRuntimeProjection({
      repoRoot,
      workspace: begun.workspace,
      scope,
      candidateGraph: {
        skills: [
          {
            data: {
              id: 'skill:master-orchestrator-guide',
              modules: [{ id: 'module:conduct.never-play' }],
              host_coverage: PRODUCT_HOSTS.map((host) => ({ host, state: 'full' })),
            },
          },
        ],
      },
      resultGraphSha256: 'c'.repeat(64),
    });

    assert.equal(runtime.candidate_runtime_valid, false);
    assert.ok(
      runtime.diagnostics.some((item) => item.code === 'SKG-PATH-AUTHORITY-RUNTIME-EXISTS'),
      JSON.stringify(runtime.diagnostics.map((item) => item.code)),
    );
    assert.equal(fs.existsSync(sentinel), true);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'attacker-owned\n');
    assert.equal(fs.existsSync(path.join(begun.workspace, '.runtime-ownership-token')), true);
  });
});

test('SKG-TX-RUNTIME-16: product-path hop failure yields SKG-HOP-* with zero ledger/dist pollution', async () => {
  const tx = await import(transactionModule);
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    initGit(repoRoot);
    const beforeDigest = acceptedSourceDigest(repoRoot);
    const beforeDist = liveDistDigest(repoRoot);
    const beforeLedger = ledgerListing(repoRoot);
    const PORTFOLIO_PATH = 'plugin/src/knowledge/portfolio.json';

    const begun = tx.beginTransaction({
      repoRoot,
      operation: 'refine',
      scope: [PORTFOLIO_PATH],
      base: 'HEAD',
    });
    assert.equal(begun.exitCode, 0, JSON.stringify(begun.diagnostics));

    // Tighten a real hop_policy leaf (currently 2) to 1 — schema-legal, not point_diameter_max/0.
    const portfolioPath = path.join(begun.workspace, 'candidate', PORTFOLIO_PATH);
    const portfolio = JSON.parse(fs.readFileSync(portfolioPath, 'utf8'));
    assert.equal(portfolio.hop_policy.critical_any_point_to_primary_max, 2);
    portfolio.hop_policy.critical_any_point_to_primary_max = 1;
    fs.writeFileSync(portfolioPath, `${JSON.stringify(portfolio, null, 2)}\n`);
    writeDraft(begun.workspace, {
      op: 'refine',
      subject: portfolio.id,
      changed_fields: ['hop_policy.critical_any_point_to_primary_max'],
      rationale:
        'Tighten critical any-point→primary SLO from 2 to 1 to force authored SKG-HOP-H4 on candidate-v2',
    });

    const validated = tx.validateTransaction({ repoRoot, workspace: begun.workspace });
    assert.notEqual(validated.exitCode, 0);
    assert.equal(validated.validation?.candidate_valid, false);
    assert.equal(validated.validation?.candidate_runtime_valid, false);
    const codes = (validated.diagnostics ?? []).map((item) => item.code);
    assert.ok(
      codes.some((code) => String(code).startsWith('SKG-HOP-')),
      JSON.stringify(codes),
    );
    assert.ok(
      !codes.some((code) =>
        [
          'SKG-SCHEMA-INVALID',
          'SKG-CHANGE-SCHEMA-INVALID',
          'SKG-CHANGE-PRECONDITION',
          'SKG-CHANGE-UNEXPLAINED-DIFF',
        ].includes(code),
      ),
      `hop product gate must not be early schema/semantic substitute: ${JSON.stringify(codes)}`,
    );
    for (const witness of validated.validation?.host_projection_witnesses ?? []) {
      if (witness.mode === 'full' || witness.mode === 'partial') {
        assert.equal(witness.ok, false);
        assert.equal(witness.hop_report.H4.ok, false);
        assert.notEqual(witness.hop_report.H4.witness?.skipped, true);
        assert.notEqual(witness.hop_report.H4.witness?.abstained, true);
      }
    }
    assert.equal(acceptedSourceDigest(repoRoot), beforeDigest);
    assert.equal(liveDistDigest(repoRoot), beforeDist);
    assert.deepEqual(ledgerListing(repoRoot), beforeLedger);
  });
});

test('SKG-TX-RUNTIME-17: enabled_by_default false edge absent from final reparsed surface', async () => {
  const tx = await import(transactionModule);
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    initGit(repoRoot);
    const disabledId = 'edge:conduct.disabled-for-k1-runtime-e2e';

    const begun = tx.beginTransaction({
      repoRoot,
      operation: 'add',
      scope: [MODULE_PATH],
      base: 'HEAD',
    });
    assert.equal(begun.exitCode, 0, JSON.stringify(begun.diagnostics));

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
      rationale: 'typed add of disabled_by_default edge must stay out of enabled adjacency',
    });

    const validated = tx.validateTransaction({ repoRoot, workspace: begun.workspace });
    assert.equal(validated.exitCode, 0, JSON.stringify(validated.diagnostics));
    assert.equal(validated.validation.candidate_runtime_valid, true);
    assert.equal(fs.existsSync(path.join(begun.workspace, 'runtime-candidate')), false);

    const snap = validated.validation.host_projection_witnesses.find(
      (item) => item.host === 'claude-code',
    )?.final_surface_snapshot;
    assert.ok(snap, 'claude-code witness must include final_surface_snapshot');
    assert.equal(snap.mode, 'full');
    // Disabled edges are never emitted into the final host tree; snapshot must
    // not invent them from authored endpoint co-presence.
    assert.ok(
      !snap.edges.some((item) => item.id === disabledId),
      `disabled edge leaked into snapshot.edges: ${JSON.stringify(snap.edges)}`,
    );
    assert.ok(
      !snap.enabled_edge_ids.includes(disabledId),
      `disabled edge leaked into enabled_edge_ids: ${JSON.stringify(snap.enabled_edge_ids)}`,
    );
    const fromAdj = snap.enabled_adjacency['point:conduct.never-play'] ?? [];
    assert.ok(
      !fromAdj.some((item) => item.edge_id === disabledId),
      `disabled edge leaked into enabled_adjacency: ${JSON.stringify(fromAdj)}`,
    );

    for (const witness of validated.validation.host_projection_witnesses) {
      assert.ok(witness.executed_checks.includes('enabled_by_default-only'));
      assert.equal(witness.conditional_route_policy, 'enabled_by_default-only');
      if (witness.mode === 'full') {
        assert.ok(witness.executed_checks.includes('candidate_runtime_final_surface_snapshot'));
        assert.ok(witness.final_surface_snapshot);
      }
    }
  });
});

test('SKG-TX-RUNTIME-18: all-stub transaction E2E does not create runtime-candidate', async () => {
  const tx = await import(transactionModule);
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    const skillDoc = JSON.parse(fs.readFileSync(path.join(repoRoot, SKILL_PATH), 'utf8'));
    skillDoc.host_coverage = PRODUCT_HOSTS.map((host) => ({
      host,
      state: 'stub',
      reason: 'all-stub transaction e2e',
    }));
    fs.writeFileSync(path.join(repoRoot, SKILL_PATH), `${JSON.stringify(skillDoc, null, 2)}\n`);
    initGit(repoRoot);

    const begun = tx.beginTransaction({
      repoRoot,
      operation: 'refine',
      scope: [MODULE_PATH],
      base: 'HEAD',
    });
    refineSummary(begun.workspace, '(all-stub e2e)');
    const validated = tx.validateTransaction({ repoRoot, workspace: begun.workspace });
    assert.equal(validated.exitCode, 0, JSON.stringify(validated.diagnostics));
    assert.equal(fs.existsSync(path.join(begun.workspace, 'runtime-candidate')), false);
    for (const witness of validated.validation.host_projection_witnesses) {
      assert.equal(witness.mode, 'stub');
      assert.equal(witness.ok, true);
      assert.equal(witness.artifacts.length, 0);
      assert.equal(witness.hop_report.H1.witness.abstained, true);
    }
  });
});

test('SKG-TX-RUNTIME-19: apply rejects runtime-only candidate corruption after validate green', async () => {
  const tx = await import(transactionModule);
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot }) => {
    initGit(repoRoot);
    const beforeDigest = acceptedSourceDigest(repoRoot);
    const beforeDist = liveDistDigest(repoRoot);
    const beforeLedger = ledgerListing(repoRoot);

    const begun = tx.beginTransaction({
      repoRoot,
      operation: 'refine',
      scope: [MODULE_PATH, ENTRY_PATH],
      base: 'HEAD',
    });
    refineSummary(begun.workspace, '(apply runtime corruption)');
    const validated = tx.validateTransaction({ repoRoot, workspace: begun.workspace });
    assert.equal(validated.exitCode, 0, JSON.stringify(validated.diagnostics));

    // Corrupt entry surface only — typed refine still explains summary, but runtime
    // projection must fail closed on re-validate inside apply.
    const entryPath = path.join(begun.workspace, 'candidate', ENTRY_PATH);
    const entryText = fs.readFileSync(entryPath, 'utf8');
    fs.writeFileSync(
      entryPath,
      entryText.replaceAll('cc-master:bootstrap:v1', 'cc-master:bootstrap:CORRUPT'),
    );

    const applied = tx.applyTransaction({ repoRoot, workspace: begun.workspace });
    assert.notEqual(applied.exitCode, 0);
    assert.equal(applied.validation?.candidate_valid, false);
    assert.equal(applied.validation?.candidate_runtime_valid, false);
    const codes = (applied.diagnostics ?? []).map((item) => item.code);
    const runtimeGate = new Set([
      'SKG-ENTRY-ANCHOR-MISSING',
      'SKG-CHANGE-CANDIDATE-RUNTIME',
      'SKG-CHANGE-CANDIDATE-ATTESTATION',
    ]);
    assert.ok(
      codes.some((code) => runtimeGate.has(code)),
      `expected runtime gate codes, got: ${JSON.stringify(codes)}`,
    );
    assert.ok(
      !codes.includes('SKG-CHANGE-UNEXPLAINED-DIFF'),
      `RUNTIME-19 must not accept semantic-gate substitute UNEXPLAINED-DIFF: ${JSON.stringify(codes)}`,
    );
    assert.ok(
      !codes.every((code) =>
        ['SKG-CHANGE-PRECONDITION', 'SKG-CHANGE-SCHEMA-INVALID', 'SKG-SCHEMA-INVALID'].includes(
          code,
        ),
      ),
      `RUNTIME-19 must not be early schema-only failure: ${JSON.stringify(codes)}`,
    );
    assert.equal(acceptedSourceDigest(repoRoot), beforeDigest);
    assert.equal(liveDistDigest(repoRoot), beforeDist);
    assert.deepEqual(ledgerListing(repoRoot), beforeLedger);
  });
});
