import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { withIsolatedSkillKnowledgeRepo } from './helpers/skill-knowledge-isolated-repo.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliPath = path.join(repoRoot, 'scripts', 'skill-knowledge.mjs');
const require = createRequire(import.meta.url);
const validateOutput = require('../../scripts/skill-knowledge/validators/validate-output.cjs');

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
  });
}

function parseJson(result) {
  assert.equal(result.stderr, '', result.stderr);
  return JSON.parse(result.stdout);
}

function assertValidCliOutput(body, label = 'cli output') {
  const ok = Boolean(validateOutput(body));
  assert.equal(
    ok,
    true,
    `${label} failed standalone output validator: ${JSON.stringify(validateOutput.errors ?? [])}`,
  );
}

function withTempSource(callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-pilot-'));
  const result = callback(dir);
  if (result && typeof result.then === 'function') {
    return result.finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

function displayRepoPath(target, root = repoRoot) {
  const relative = path.relative(root, target);
  if (relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..') {
    return relative.split(path.sep).join('/');
  }
  return path.resolve(target);
}

function copyPilotSource(targetRoot, sourceRepoRoot = repoRoot) {
  const sourceRoot = path.join(sourceRepoRoot, 'plugin/src/knowledge');
  const walk = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const src = path.join(from, entry.name);
      const dest = path.join(to, entry.name);
      if (entry.isDirectory()) walk(src, dest);
      else if (entry.name.endsWith('.json')) fs.copyFileSync(src, dest);
    }
  };
  walk(sourceRoot, targetRoot);

  // Rewrite manifest refs so ownership checks resolve against the temp loaded shards.
  const portfolioPath = path.join(targetRoot, 'portfolio.json');
  const portfolio = JSON.parse(fs.readFileSync(portfolioPath, 'utf8'));
  for (const ref of portfolio.skills ?? []) {
    const suffix = String(ref.manifest).replace(/^plugin\/src\/knowledge\//, '');
    ref.manifest = displayRepoPath(path.join(targetRoot, suffix), sourceRepoRoot);
  }
  fs.writeFileSync(portfolioPath, `${JSON.stringify(portfolio, null, 2)}\n`);

  const skillPath = path.join(targetRoot, 'skills/master-orchestrator-guide/skill.json');
  const skill = JSON.parse(fs.readFileSync(skillPath, 'utf8'));
  for (const ref of skill.modules ?? []) {
    const suffix = String(ref.manifest).replace(/^plugin\/src\/knowledge\//, '');
    ref.manifest = displayRepoPath(path.join(targetRoot, suffix), sourceRepoRoot);
  }
  fs.writeFileSync(skillPath, `${JSON.stringify(skill, null, 2)}\n`);
}

test('SKG-PILOT-01: check loads full portfolio inventory with stable graph hash', () => {
  const first = parseJson(runCli(['check', '--stage', 'K2', '--json']));
  const second = parseJson(runCli(['check', '--stage', 'K2', '--json']));
  assertValidCliOutput(first, 'check success');
  assert.equal(first.ok, true);
  assert.equal(first.summary.skill, 8);
  assert.equal(first.summary.portfolio, 1);
  assert.ok(first.summary.module >= 40, `expected full-portfolio modules, got ${first.summary.module}`);
  assert.equal(typeof first.graph_hash, 'string');
  assert.match(first.graph_hash, /^[a-f0-9]{64}$/);
  assert.equal(first.graph_hash, second.graph_hash);
  assert.equal(first.summary.errors, 0);
  assert.equal(
    first.diagnostics.every((item) => item.severity !== 'error' || Boolean(item.witness)),
    true,
  );

  const report = parseJson(runCli(['report', '--json']));
  assertValidCliOutput(report, 'report success');
  assert.equal(report.result_kind, 'report');
  assert.equal(report.structural_status.state, 'pass');
  assert.equal(report.behavioral_evidence_status.state, 'not_run');
  assert.equal(Object.hasOwn(report, 'improvement_claim'), false);
  assert.equal(report.structural_status.counts.skill, 8);
  assert.equal(report.structural_status.counts.entry, 8);
  assert.ok(report.structural_status.counts.point >= 200);
  assert.equal(report.structural_status.counts.module, first.summary.module);
  assert.equal(report.graph_hash, first.graph_hash);
});

test('SKG-PILOT-02: path covers entry→point, cross-module, and unreachable fail-closed', () => {
  const entryPath = parseJson(
    runCli([
      'path',
      '--from',
      'entry:master-orchestrator',
      '--to',
      'point:verification.endpoint-procedure',
      '--host',
      'claude-code',
      '--json',
    ]),
  );
  assertValidCliOutput(entryPath, 'path reachable');
  assert.equal(entryPath.ok, true);
  assert.equal(entryPath.result_kind, 'path');
  assert.equal(entryPath.path_result.reachable, true);
  assert.equal(typeof entryPath.path_result.hops, 'number');
  assert.ok(entryPath.path_result.hops >= 1);
  assert.ok(entryPath.path_result.witness);
  assert.deepEqual(entryPath.path_result.nodes[0], 'entry:master-orchestrator');

  const cross = parseJson(
    runCli([
      'path',
      '--from',
      'point:routing.ordered-chain',
      '--to',
      'point:verification.terminal-is-not-done',
      '--host',
      'claude-code',
      '--json',
    ]),
  );
  assertValidCliOutput(cross, 'path cross-module');
  assert.equal(cross.ok, true);
  assert.equal(cross.path_result.reachable, true);
  assert.equal(cross.path_result.hops, 1);

  const missing = runCli([
    'path',
    '--from',
    'point:does-not-exist',
    '--to',
    'point:verification.terminal-is-not-done',
    '--host',
    'claude-code',
    '--json',
  ]);
  assert.equal(missing.status, 4);
  const missingBody = parseJson(missing);
  assertValidCliOutput(missingBody, 'path missing');
  assert.equal(missingBody.ok, false);
  assert.equal(missingBody.diagnostics[0].code, 'SKG-QUERY-NOT-FOUND');
  assert.ok(missingBody.diagnostics[0].remediation);

  const unreachable = runCli([
    'path',
    '--from',
    'point:verification.endpoint-procedure',
    '--to',
    'point:conduct.never-play',
    '--host',
    'claude-code',
    '--json',
  ]);
  assert.equal(unreachable.status, 6);
  const unreachableBody = parseJson(unreachable);
  assertValidCliOutput(unreachableBody, 'path unreachable');
  assert.equal(unreachableBody.ok, false);
  assert.equal(unreachableBody.path_result.reachable, false);
  assert.equal(unreachableBody.path_result.hops, null);
  assert.equal(unreachableBody.diagnostics[0].code, 'SKG-PATH-UNREACHABLE');
  assert.ok(unreachableBody.diagnostics[0].witness);
});

test('SKG-PILOT-03: explain returns authority/binding/witness for points and fail-closed on ambiguity', () => {
  const explained = parseJson(runCli(['explain', 'point:conduct.never-play', '--json']));
  assertValidCliOutput(explained, 'explain success');
  assert.equal(explained.ok, true);
  assert.equal(explained.result_kind, 'explain');
  assert.equal(explained.entity.kind, 'point');
  assert.equal(explained.entity.authority.role, 'canonical');
  assert.equal(
    explained.entity.binding.path,
    'plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md',
  );
  assert.ok(explained.entity.witness.span_sha256);

  const missing = runCli(['explain', 'point:nope', '--json']);
  assert.equal(missing.status, 4);
  const missingBody = parseJson(missing);
  assertValidCliOutput(missingBody, 'explain missing');
  assert.equal(missingBody.diagnostics[0].code, 'SKG-QUERY-NOT-FOUND');
});

test('SKG-PILOT-04: stale inventory and dangling edges fail closed with remediation', () =>
  withTempSource((sourceRoot) => {
    copyPilotSource(sourceRoot);
    const skillPath = path.join(
      sourceRoot,
      'skills/master-orchestrator-guide/skill.json',
    );
    const skill = JSON.parse(fs.readFileSync(skillPath, 'utf8'));
    skill.canonical_source_inventory[0].reviewed_unbound_sha256 =
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    fs.writeFileSync(skillPath, `${JSON.stringify(skill, null, 2)}\n`);

    const stale = runCli(['check', '--source', sourceRoot, '--stage', 'K1', '--json']);
    assert.equal(stale.status, 4);
    const staleBody = parseJson(stale);
    assertValidCliOutput(staleBody, 'stale inventory check');
    assert.ok(
      staleBody.diagnostics.some((item) => item.code === 'SKG-INVENTORY-STALE-UNBOUND'),
    );
    assert.ok(
      staleBody.diagnostics.find((item) => item.code === 'SKG-INVENTORY-STALE-UNBOUND')
        .remediation,
    );

    copyPilotSource(sourceRoot);
    const modulePath = path.join(
      sourceRoot,
      'skills/master-orchestrator-guide/modules/verification.endpoint.json',
    );
    const module = JSON.parse(fs.readFileSync(modulePath, 'utf8'));
    module.edges.push({
      id: 'edge:verification.dangling',
      type: 'next',
      from: 'point:verification.terminal-is-not-done',
      to: 'point:does-not-exist',
      when: ['fixture dangling'],
      path_role: 'support',
      runtime: { enabled_by_default: true },
      lifecycle: { state: 'accepted', since: '2026-07-23' },
      admission: {
        evidence: [{ kind: 'design', ref: 'fixture' }],
        verifiers: [{ kind: 'review', ref: 'fixture' }],
      },
    });
    fs.writeFileSync(modulePath, `${JSON.stringify(module, null, 2)}\n`);
    const dangling = runCli(['check', '--source', sourceRoot, '--stage', 'K1', '--json']);
    assert.equal(dangling.status, 4, dangling.stdout);
    const danglingBody = parseJson(dangling);
    assertValidCliOutput(danglingBody, 'dangling edge check');
    assert.ok(
      danglingBody.diagnostics.some((item) => item.code === 'SKG-EDGE-ENDPOINT-MISSING'),
    );
  }));

test('SKG-PILOT-05: critical pin budget overflow fails closed', () =>
  withTempSource((sourceRoot) => {
    copyPilotSource(sourceRoot);
    const portfolioPath = path.join(sourceRoot, 'portfolio.json');
    const portfolio = JSON.parse(fs.readFileSync(portfolioPath, 'utf8'));
    // 1 critical / 3 modules ≈ 0.333 > 0.1 → hard fail without breaking schema mins.
    portfolio.critical_pin_budget = { max_modules: 2, max_fraction: 0.1 };
    fs.writeFileSync(portfolioPath, `${JSON.stringify(portfolio, null, 2)}\n`);
    const result = runCli(['check', '--source', sourceRoot, '--stage', 'K1', '--json']);
    assert.equal(result.status, 4, result.stdout);
    const body = parseJson(result);
    assertValidCliOutput(body, 'budget overflow check');
    assert.ok(body.diagnostics.some((item) => item.code === 'SKG-BUDGET-CRITICAL-PIN'));
    assert.ok(
      body.diagnostics.find((item) => item.code === 'SKG-BUDGET-CRITICAL-PIN').witness,
    );
  }));

test('SKG-PILOT-06: entity explain requires built.ok; SKG diagnostic channel remains', () =>
  withTempSource(async (sourceRoot) => {
    copyPilotSource(sourceRoot);
    const skillPath = path.join(
      sourceRoot,
      'skills/master-orchestrator-guide/skill.json',
    );
    const skill = JSON.parse(fs.readFileSync(skillPath, 'utf8'));
    skill.canonical_source_inventory[0].reviewed_unbound_sha256 =
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    fs.writeFileSync(skillPath, `${JSON.stringify(skill, null, 2)}\n`);

    const staleEntity = runCli([
      'explain',
      'point:conduct.never-play',
      '--source',
      sourceRoot,
      '--json',
    ]);
    assert.notEqual(staleEntity.status, 0);
    const staleEntityBody = parseJson(staleEntity);
    assertValidCliOutput(staleEntityBody, 'explain under stale inventory');
    assert.equal(staleEntityBody.ok, false);
    assert.ok(
      staleEntityBody.diagnostics.some((item) => item.code === 'SKG-INVENTORY-STALE-UNBOUND'),
    );

    const staleCode = runCli([
      'explain',
      'SKG-INVENTORY-STALE-UNBOUND',
      '--source',
      sourceRoot,
      '--json',
    ]);
    assert.equal(staleCode.status, 0);
    const staleCodeBody = parseJson(staleCode);
    assertValidCliOutput(staleCodeBody, 'explain SKG diagnostic under stale');
    assert.equal(staleCodeBody.ok, true);
    assert.equal(staleCodeBody.entity.kind, 'diagnostic');

    copyPilotSource(sourceRoot);
    const modulePath = path.join(
      sourceRoot,
      'skills/master-orchestrator-guide/modules/verification.endpoint.json',
    );
    const module = JSON.parse(fs.readFileSync(modulePath, 'utf8'));
    module.edges.push({
      id: 'edge:verification.dangling-explain',
      type: 'next',
      from: 'point:verification.terminal-is-not-done',
      to: 'point:does-not-exist',
      when: ['fixture dangling explain'],
      path_role: 'support',
      runtime: { enabled_by_default: true },
      lifecycle: { state: 'accepted', since: '2026-07-23' },
      admission: {
        evidence: [{ kind: 'design', ref: 'fixture' }],
        verifiers: [{ kind: 'review', ref: 'fixture' }],
      },
    });
    fs.writeFileSync(modulePath, `${JSON.stringify(module, null, 2)}\n`);

    const danglingEntity = runCli([
      'explain',
      'point:verification.terminal-is-not-done',
      '--source',
      sourceRoot,
      '--json',
    ]);
    assert.notEqual(danglingEntity.status, 0);
    const danglingEntityBody = parseJson(danglingEntity);
    assertValidCliOutput(danglingEntityBody, 'explain under dangling edge');
    assert.equal(danglingEntityBody.ok, false);
    assert.ok(
      danglingEntityBody.diagnostics.some((item) => item.code === 'SKG-EDGE-ENDPOINT-MISSING'),
    );

    const danglingCode = runCli([
      'explain',
      'SKG-EDGE-ENDPOINT-MISSING',
      '--source',
      sourceRoot,
      '--json',
    ]);
    assert.equal(danglingCode.status, 0);
    const danglingCodeBody = parseJson(danglingCode);
    assertValidCliOutput(danglingCodeBody, 'explain SKG diagnostic under dangling');
    assert.equal(danglingCodeBody.entity.kind, 'diagnostic');
  }));

test('SKG-PILOT-07: ownership tree rejects bad refs, orphans, multiply-owned, and broken entry chains', () =>
  withTempSource((sourceRoot) => {
    copyPilotSource(sourceRoot);
    const portfolioPath = path.join(sourceRoot, 'portfolio.json');
    const skillPath = path.join(sourceRoot, 'skills/master-orchestrator-guide/skill.json');

    // Wrong skill id on portfolio ref (manifest still points at real skill shard).
    {
      copyPilotSource(sourceRoot);
      const portfolio = JSON.parse(fs.readFileSync(portfolioPath, 'utf8'));
      portfolio.skills[0].id = 'skill:does-not-match';
      fs.writeFileSync(portfolioPath, `${JSON.stringify(portfolio, null, 2)}\n`);
      const result = runCli(['check', '--source', sourceRoot, '--stage', 'K1', '--json']);
      assert.equal(result.status, 4, result.stdout);
      const body = parseJson(result);
      assertValidCliOutput(body, 'ownership skill ref mismatch');
      assert.ok(
        body.diagnostics.some((item) => item.code === 'SKG-OWNERSHIP-REF'),
      );
    }

    // Wrong module id on skill.modules ref.
    {
      copyPilotSource(sourceRoot);
      const skill = JSON.parse(fs.readFileSync(skillPath, 'utf8'));
      skill.modules[0].id = 'module:wrong-id';
      fs.writeFileSync(skillPath, `${JSON.stringify(skill, null, 2)}\n`);
      const result = runCli(['check', '--source', sourceRoot, '--stage', 'K1', '--json']);
      assert.equal(result.status, 4, result.stdout);
      const body = parseJson(result);
      assertValidCliOutput(body, 'ownership module ref mismatch');
      assert.ok(body.diagnostics.some((item) => item.code === 'SKG-OWNERSHIP-REF'));
    }

    // Orphan module shard: present on disk but not owned by any skill.modules ref.
    {
      copyPilotSource(sourceRoot);
      const skill = JSON.parse(fs.readFileSync(skillPath, 'utf8'));
      skill.modules = skill.modules.filter((ref) => ref.id !== 'module:conduct.never-play');
      skill.entry_modules = skill.entry_modules.filter(
        (id) => id !== 'module:conduct.never-play',
      );
      fs.writeFileSync(skillPath, `${JSON.stringify(skill, null, 2)}\n`);
      const result = runCli(['check', '--source', sourceRoot, '--stage', 'K1', '--json']);
      assert.equal(result.status, 4, result.stdout);
      const body = parseJson(result);
      assertValidCliOutput(body, 'ownership orphan module');
      assert.ok(body.diagnostics.some((item) => item.code === 'SKG-OWNERSHIP-ORPHAN'));
    }

    // Multiply-owned module: second skill claims the same module.
    {
      copyPilotSource(sourceRoot);
      const secondSkillDir = path.join(sourceRoot, 'skills/second-owner');
      fs.mkdirSync(secondSkillDir, { recursive: true });
      const primarySkill = JSON.parse(fs.readFileSync(skillPath, 'utf8'));
      const secondSkill = {
        ...primarySkill,
        id: 'skill:second-owner',
        name: 'second-owner',
        modules: [
          {
            id: 'module:verification.endpoint',
            manifest: primarySkill.modules[0].manifest,
          },
        ],
        entry_modules: ['module:verification.endpoint'],
        canonical_source_inventory: primarySkill.canonical_source_inventory,
      };
      const secondSkillPath = path.join(secondSkillDir, 'skill.json');
      fs.writeFileSync(secondSkillPath, `${JSON.stringify(secondSkill, null, 2)}\n`);
      const portfolio = JSON.parse(fs.readFileSync(portfolioPath, 'utf8'));
      portfolio.skills.push({
        id: 'skill:second-owner',
        manifest: displayRepoPath(secondSkillPath),
      });
      fs.writeFileSync(portfolioPath, `${JSON.stringify(portfolio, null, 2)}\n`);
      const result = runCli(['check', '--source', sourceRoot, '--stage', 'K1', '--json']);
      assert.equal(result.status, 4, result.stdout);
      const body = parseJson(result);
      assertValidCliOutput(body, 'ownership multiply-owned module');
      assert.ok(body.diagnostics.some((item) => item.code === 'SKG-OWNERSHIP-MULTIPLY'));
    }

    // Entry target: missing skill / wrong module / cross-module point.
    {
      copyPilotSource(sourceRoot);
      const portfolio = JSON.parse(fs.readFileSync(portfolioPath, 'utf8'));
      const target = portfolio.entries[0].surfaces[0].targets[0];
      target.skill = 'skill:missing';
      fs.writeFileSync(portfolioPath, `${JSON.stringify(portfolio, null, 2)}\n`);
      const missingSkill = runCli(['check', '--source', sourceRoot, '--stage', 'K1', '--json']);
      assert.equal(missingSkill.status, 4);
      const missingSkillBody = parseJson(missingSkill);
      assertValidCliOutput(missingSkillBody, 'entry missing skill');
      assert.ok(
        missingSkillBody.diagnostics.some((item) => item.code === 'SKG-ENTRY-TARGET-CHAIN'),
      );

      copyPilotSource(sourceRoot);
      const portfolio2 = JSON.parse(fs.readFileSync(portfolioPath, 'utf8'));
      const target2 = portfolio2.entries[0].surfaces[0].targets[0];
      target2.module = 'module:conduct.never-play';
      // point still verification.* which belongs to verification.endpoint
      fs.writeFileSync(portfolioPath, `${JSON.stringify(portfolio2, null, 2)}\n`);
      const wrongModule = runCli(['check', '--source', sourceRoot, '--stage', 'K1', '--json']);
      assert.equal(wrongModule.status, 4);
      const wrongModuleBody = parseJson(wrongModule);
      assertValidCliOutput(wrongModuleBody, 'entry wrong module/point chain');
      assert.ok(
        wrongModuleBody.diagnostics.some((item) => item.code === 'SKG-ENTRY-TARGET-CHAIN'),
      );

      copyPilotSource(sourceRoot);
      const portfolio3 = JSON.parse(fs.readFileSync(portfolioPath, 'utf8'));
      const target3 = portfolio3.entries[0].surfaces[0].targets[0];
      target3.point = 'point:conduct.never-play';
      fs.writeFileSync(portfolioPath, `${JSON.stringify(portfolio3, null, 2)}\n`);
      const crossPoint = runCli(['check', '--source', sourceRoot, '--stage', 'K1', '--json']);
      assert.equal(crossPoint.status, 4);
      const crossPointBody = parseJson(crossPoint);
      assertValidCliOutput(crossPointBody, 'entry cross-module point');
      assert.ok(
        crossPointBody.diagnostics.some((item) => item.code === 'SKG-ENTRY-TARGET-CHAIN'),
      );
    }
  }));

test('SKG-PILOT-08: cross-inventory duplicate point markers fail closed even after unbound refresh', async () => {
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot: isoRoot, runCli: isoCli }) => {
    const inventory = await import('../../scripts/skill-knowledge/inventory.mjs');
    const markers = await import('../../scripts/skill-knowledge/markers.mjs');
    const skillMdPath = path.join(
      isoRoot,
      'plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md',
    );
    const otherPath = path.join(
      isoRoot,
      'plugin/src/skills/master-orchestrator-guide/canonical/references/async-hitl.md',
    );
    const skillText = fs.readFileSync(skillMdPath, 'utf8');
    const extracted = markers.extractMarkers(skillText, 'SKILL.md');
    assert.equal(extracted.ok, true);
    const span = extracted.spans.find((item) => item.point_id === 'point:conduct.never-play');
    assert.ok(span);

    await withTempSource(async (sourceRoot) => {
      copyPilotSource(sourceRoot, isoRoot);
      const duplicateBlock = [
        '',
        '<!-- ccm:k:start point:conduct.never-play -->',
        span.content.trimEnd(),
        '<!-- ccm:k:end point:conduct.never-play -->',
        '',
      ].join('\n');
      const originalOther = fs.readFileSync(otherPath, 'utf8');
      fs.writeFileSync(otherPath, `${originalOther.trimEnd()}\n${duplicateBlock}`);

      const skillPath = path.join(
        sourceRoot,
        'skills/master-orchestrator-guide/skill.json',
      );
      const skill = JSON.parse(fs.readFileSync(skillPath, 'utf8'));
      const otherEntry = skill.canonical_source_inventory.find(
        (entry) => entry.path === displayRepoPath(otherPath, isoRoot),
      );
      assert.ok(otherEntry);
      const otherText = fs.readFileSync(otherPath, 'utf8');
      const otherMarkers = markers.extractMarkers(otherText, otherEntry.path);
      assert.equal(otherMarkers.ok, true);
      otherEntry.reviewed_unbound_sha256 = inventory.hashUnboundRegions(
        otherText,
        otherMarkers.spans.filter((item) => (otherEntry.point_ids ?? []).includes(item.point_id)),
      );
      fs.writeFileSync(skillPath, `${JSON.stringify(skill, null, 2)}\n`);

      const result = isoCli(['check', '--source', sourceRoot, '--stage', 'K1', '--json']);
      assert.equal(result.status, 4, result.stdout);
      const body = parseJson(result);
      assertValidCliOutput(body, 'duplicate marker check');
      assert.ok(
        body.diagnostics.some((item) => item.code === 'SKG-MARKER-DUPLICATE-GLOBAL'),
      );
    });
  });
});

test('SKG-PILOT-09: CLI host/format enums fail closed with machine diagnostics', async () => {
  const unknownHost = runCli([
    'path',
    '--from',
    'point:conduct.never-play',
    '--to',
    'point:conduct.red-lines',
    '--host',
    'bogus-host',
    '--json',
  ]);
  assert.notEqual(unknownHost.status, 0);
  const unknownHostBody = parseJson(unknownHost);
  assertValidCliOutput(unknownHostBody, 'unknown host path');
  assert.equal(unknownHostBody.ok, false);
  assert.ok(
    unknownHostBody.diagnostics.some(
      (item) => item.code === 'SKG-USAGE' || item.code === 'SKG-HOST-UNKNOWN',
    ),
  );

  const yamlReport = runCli(['report', '--format', 'yaml', '--json']);
  assert.notEqual(yamlReport.status, 0);
  const yamlBody = parseJson(yamlReport);
  assertValidCliOutput(yamlBody, 'report format yaml');
  assert.equal(yamlBody.ok, false);
  assert.ok(yamlBody.diagnostics.some((item) => item.code === 'SKG-USAGE'));

  const { runPath } = await import(
    pathToFileURL(path.join(repoRoot, 'scripts/skill-knowledge/query.mjs')).href
  );
  const direct = runPath({
    repoRoot,
    from: 'point:conduct.never-play',
    to: 'point:conduct.red-lines',
    host: 'not-a-host',
  });
  assert.notEqual(direct.exitCode, 0);
  assertValidCliOutput(direct.body, 'direct runPath unknown host');
  assert.equal(direct.body.ok, false);
});

test('SKG-PILOT-10: report/path/explain failure envelopes omit counts and stay schema-valid', () => {
  const missingSource = '/tmp/skg-pilot-missing-source-does-not-exist';

  const missingReport = runCli(['report', '--source', missingSource, '--json']);
  assert.notEqual(missingReport.status, 0);
  const missingReportBody = parseJson(missingReport);
  assertValidCliOutput(missingReportBody, 'report missing source');
  assert.equal(missingReportBody.ok, false);
  assert.equal(missingReportBody.structural_status.state, 'fail');
  assert.equal(Object.hasOwn(missingReportBody.structural_status, 'counts'), false);
  assert.ok(
    missingReportBody.diagnostics.some((item) => item.code === 'SKG-SOURCE-ROOT-MISSING'),
  );
  assert.ok(
    missingReportBody.diagnostics.find((item) => item.code === 'SKG-SOURCE-ROOT-MISSING')
      .remediation,
  );

  withTempSource((sourceRoot) => {
    const emptyReport = runCli(['report', '--source', sourceRoot, '--json']);
    assert.notEqual(emptyReport.status, 0, emptyReport.stdout);
    const emptyReportBody = parseJson(emptyReport);
    assertValidCliOutput(emptyReportBody, 'report empty source');
    assert.equal(emptyReportBody.ok, false);
    assert.equal(emptyReportBody.structural_status.state, 'fail');
    assert.equal(Object.hasOwn(emptyReportBody.structural_status, 'counts'), false);
    assert.ok(
      emptyReportBody.diagnostics.some((item) => item.code === 'SKG-COVERAGE-EMPTY'),
    );
    assert.ok(
      emptyReportBody.diagnostics.find((item) => item.code === 'SKG-COVERAGE-EMPTY').remediation,
    );
  });

  withTempSource((sourceRoot) => {
    fs.writeFileSync(path.join(sourceRoot, 'broken.json'), '{not-json}\n');
    const malformedReport = runCli(['report', '--source', sourceRoot, '--json']);
    assert.notEqual(malformedReport.status, 0);
    const malformedReportBody = parseJson(malformedReport);
    assertValidCliOutput(malformedReportBody, 'report malformed source');
    assert.equal(malformedReportBody.ok, false);
    assert.equal(malformedReportBody.structural_status.state, 'fail');
    assert.equal(Object.hasOwn(malformedReportBody.structural_status, 'counts'), false);
    assert.ok(
      malformedReportBody.diagnostics.some((item) => item.code === 'SKG-SOURCE-JSON-PARSE'),
    );
    assert.ok(
      malformedReportBody.diagnostics.find((item) => item.code === 'SKG-SOURCE-JSON-PARSE')
        .remediation,
    );
  });

  const pathMissing = runCli([
    'path',
    '--from',
    'point:conduct.never-play',
    '--to',
    'point:conduct.red-lines',
    '--host',
    'claude-code',
    '--source',
    missingSource,
    '--json',
  ]);
  assert.notEqual(pathMissing.status, 0);
  const pathMissingBody = parseJson(pathMissing);
  assertValidCliOutput(pathMissingBody, 'path missing source');
  assert.equal(pathMissingBody.ok, false);
  assert.ok(
    pathMissingBody.diagnostics.some((item) => item.code === 'SKG-SOURCE-ROOT-MISSING'),
  );

  const explainMissing = runCli([
    'explain',
    'point:conduct.never-play',
    '--source',
    missingSource,
    '--json',
  ]);
  assert.notEqual(explainMissing.status, 0);
  const explainMissingBody = parseJson(explainMissing);
  assertValidCliOutput(explainMissingBody, 'explain missing source');
  assert.equal(explainMissingBody.ok, false);
  assert.ok(
    explainMissingBody.diagnostics.some((item) => item.code === 'SKG-SOURCE-ROOT-MISSING'),
  );
});

test('SKG-PILOT-11: duplicate entry ids fail K-I01 even when bodies differ', () =>
  withTempSource((sourceRoot) => {
    copyPilotSource(sourceRoot);
    const portfolioPath = path.join(sourceRoot, 'portfolio.json');
    const portfolio = JSON.parse(fs.readFileSync(portfolioPath, 'utf8'));
    const original = portfolio.entries[0];
    assert.equal(original.id, 'entry:master-orchestrator');
    const duplicate = {
      ...structuredClone(original),
      label: 'Adversarial duplicate entry label',
      recognition_cues: ['不同 cue A', '不同 cue B'],
    };
    portfolio.entries.push(duplicate);
    fs.writeFileSync(portfolioPath, `${JSON.stringify(portfolio, null, 2)}\n`);

    const validateSource = require('../../scripts/skill-knowledge/validators/validate-source.cjs');
    assert.equal(
      Boolean(validateSource(portfolio)),
      true,
      `duplicate-entry portfolio must remain schema-valid: ${JSON.stringify(validateSource.errors ?? [])}`,
    );

    const result = runCli(['check', '--source', sourceRoot, '--stage', 'K1', '--json']);
    assert.notEqual(result.status, 0, result.stdout);
    const body = parseJson(result);
    assertValidCliOutput(body, 'duplicate entry id check');
    assert.equal(body.ok, false);
    assert.ok(body.diagnostics.some((item) => item.code === 'SKG-ID-DUPLICATE'));
    const duplicateDiag = body.diagnostics.find((item) => item.code === 'SKG-ID-DUPLICATE');
    assert.equal(duplicateDiag.witness.id, 'entry:master-orchestrator');
    assert.ok(duplicateDiag.remediation);
  }));
