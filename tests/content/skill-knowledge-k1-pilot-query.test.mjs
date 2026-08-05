import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { withIsolatedSkillKnowledgeRepo } from './helpers/skill-knowledge-isolated-repo.mjs';
import { loadPublishedBehaviorEvidence } from '../../scripts/skill-knowledge/behavior-eval.mjs';

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

// Adversarial scenarios below mutate authored knowledge, so they cannot run
// against a copied-out source root: manifests are repo-relative, and a bare
// copy makes every ref dangle at once — the graph fails for the wrong reason
// and the mutation under test proves nothing. They run inside a full isolated
// repo clone instead (the same helper PILOT-08 uses), mutating in place.
const KNOWLEDGE_ROOT = 'plugin/src/knowledge';
const PORTFOLIO_JSON = `${KNOWLEDGE_ROOT}/portfolio.json`;
const GUIDE_COMPOSITION_JSON = `${KNOWLEDGE_ROOT}/compositions/skill.master-orchestrator-guide.json`;
const ENDPOINT_MODULE_JSON = `${KNOWLEDGE_ROOT}/graph/modules/verification.endpoint.json`;
const NEVER_PLAY_MODULE_JSON = `${KNOWLEDGE_ROOT}/graph/modules/conduct.never-play.json`;
const POINTS_DIR = `${KNOWLEDGE_ROOT}/points`;

const readSourceJson = (root, relative) =>
  JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

const writeSourceJson = (root, relative, doc) =>
  fs.writeFileSync(path.join(root, relative), `${JSON.stringify(doc, null, 2)}\n`);

/**
 * Apply one adversarial mutation, run `body`, then put the touched files back.
 *
 * Restoring is what lets a single clone host several independent scenarios: a
 * test that asserts "this mutation trips that diagnostic" is only honest if the
 * graph was otherwise healthy, so a neighbour's leftovers must never survive
 * into the next scenario.
 *
 * @param {string} root isolated repo root
 * @param {string[]} files repo-relative paths the mutation will overwrite
 */
function withMutation(root, files, mutate, body) {
  const saved = files.map((relative) => [
    relative,
    fs.readFileSync(path.join(root, relative), 'utf8'),
  ]);
  try {
    mutate();
    return body();
  } finally {
    for (const [relative, text] of saved) {
      fs.writeFileSync(path.join(root, relative), text);
    }
  }
}

/** Run `check --stage K1` in the clone and return the parsed body + error codes. */
function checkK1(runCli, label) {
  const result = runCli(['check', '--stage', 'K1', '--json']);
  const body = parseJson(result);
  assertValidCliOutput(body, label);
  const codes = (body.diagnostics ?? [])
    .filter((item) => item.severity === 'error')
    .map((item) => item.code);
  return { result, body, codes };
}

/** Assert the mutation failed closed on `code`, and hand back that diagnostic. */
function assertFailsClosed({ result, body, codes }, code, label) {
  assert.equal(result.status, 4, `${label} must exit 4, got ${result.status}: ${result.stdout}`);
  assert.equal(body.ok, false, `${label} must report ok:false`);
  const hit = (body.diagnostics ?? []).find((item) => item.code === code);
  assert.ok(hit, `${label} must raise ${code}, got ${JSON.stringify([...new Set(codes)])}`);
  return hit;
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
  const publishedEvidence = loadPublishedBehaviorEvidence({
    repoRoot,
    graphHash: report.graph_hash,
  });
  const evidenceIsCurrent = publishedEvidence.state === 'baseline';
  assert.equal(
    report.behavioral_evidence_status.state,
    evidenceIsCurrent ? 'baseline' : 'not_run',
  );
  assert.deepEqual(
    report.behavioral_evidence_status.evidence,
    evidenceIsCurrent
      ? ['design_docs/eval/skill-knowledge-router/evidence.json']
      : [],
  );
  assert.equal(Object.hasOwn(report.behavioral_evidence_status, 'verdict'), false);
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
  // Two locations, two meanings: the knowledge is authored in its mother file,
  // and a passage drawn from it is carried by the shipped article.
  assert.equal(
    explained.entity.binding.path,
    'plugin/src/knowledge/points/conduct.never-play.md',
  );
  assert.equal(
    explained.entity.anchor_path,
    'plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md',
  );
  assert.ok(explained.entity.witness.span_sha256);

  const missing = runCli(['explain', 'point:nope', '--json']);
  assert.equal(missing.status, 4);
  const missingBody = parseJson(missing);
  assertValidCliOutput(missingBody, 'explain missing');
  assert.equal(missingBody.diagnostics[0].code, 'SKG-QUERY-NOT-FOUND');
});

test('SKG-PILOT-04: stale inventory and dangling edges fail closed with remediation', async () => {
  await withIsolatedSkillKnowledgeRepo(({ repoRoot: root, runCli: isoCli }) => {
    // An inventory entry that no longer attests the prose it claims to cover.
    withMutation(root, [GUIDE_COMPOSITION_JSON], () => {
      const composition = readSourceJson(root, GUIDE_COMPOSITION_JSON);
      composition.canonical_source_inventory[0].reviewed_unbound_sha256 = 'a'.repeat(64);
      writeSourceJson(root, GUIDE_COMPOSITION_JSON, composition);
    }, () => {
      const stale = checkK1(isoCli, 'stale inventory check');
      const hit = assertFailsClosed(stale, 'SKG-INVENTORY-STALE-UNBOUND', 'stale inventory');
      assert.ok(hit.remediation, 'stale inventory must tell the maintainer how to re-attest');
    });

    // An edge whose target point does not exist anywhere in the graph.
    withMutation(root, [ENDPOINT_MODULE_JSON], () => {
      const module = readSourceJson(root, ENDPOINT_MODULE_JSON);
      module.edges.push({
        ...structuredClone(module.edges[0]),
        id: 'edge:verification.dangling',
        to: 'point:does-not-exist',
      });
      writeSourceJson(root, ENDPOINT_MODULE_JSON, module);
    }, () => {
      const dangling = checkK1(isoCli, 'dangling edge check');
      assertFailsClosed(dangling, 'SKG-EDGE-ENDPOINT-MISSING', 'dangling edge');
    });
  });
});

test('SKG-PILOT-05: critical pin budget overflow fails closed', async () => {
  await withIsolatedSkillKnowledgeRepo(({ repoRoot: root, runCli: isoCli }) => {
    withMutation(root, [PORTFOLIO_JSON], () => {
      const portfolio = readSourceJson(root, PORTFOLIO_JSON);
      // Squeeze the budget below what the live portfolio already pins, so the
      // overflow comes from a real critical-module count rather than a fixture.
      portfolio.critical_pin_budget = { max_modules: 1, max_fraction: 0.001 };
      writeSourceJson(root, PORTFOLIO_JSON, portfolio);
    }, () => {
      const result = checkK1(isoCli, 'budget overflow check');
      const hit = assertFailsClosed(result, 'SKG-BUDGET-CRITICAL-PIN', 'pin budget overflow');
      assert.ok(hit.witness, 'budget overflow must carry a witness');
    });
  });
});

test('SKG-PILOT-06: entity explain requires built.ok; SKG diagnostic channel remains', async () => {
  await withIsolatedSkillKnowledgeRepo(({ repoRoot: root, runCli: isoCli }) => {
    /**
     * Under a broken graph, explaining an *entity* must refuse (an entity answer
     * drawn from an invalid graph would be a confident lie), while explaining the
     * *diagnostic code* must still work — that channel is how a maintainer finds
     * out what broke.
     */
    const assertExplainChannels = (entityId, code, label) => {
      const entity = isoCli(['explain', entityId, '--json']);
      assert.notEqual(entity.status, 0, `${label}: entity explain must not succeed`);
      const entityBody = parseJson(entity);
      assertValidCliOutput(entityBody, `explain entity under ${label}`);
      assert.equal(entityBody.ok, false);
      assert.ok(
        entityBody.diagnostics.some((item) => item.code === code),
        `${label}: entity explain must surface ${code}`,
      );

      const byCode = isoCli(['explain', code, '--json']);
      assert.equal(byCode.status, 0, `${label}: explain ${code} must still succeed`);
      const byCodeBody = parseJson(byCode);
      assertValidCliOutput(byCodeBody, `explain ${code} under ${label}`);
      assert.equal(byCodeBody.ok, true);
      assert.equal(byCodeBody.entity.kind, 'diagnostic');
      assert.equal(byCodeBody.entity.id, code);
    };

    withMutation(root, [GUIDE_COMPOSITION_JSON], () => {
      const composition = readSourceJson(root, GUIDE_COMPOSITION_JSON);
      composition.canonical_source_inventory[0].reviewed_unbound_sha256 = 'b'.repeat(64);
      writeSourceJson(root, GUIDE_COMPOSITION_JSON, composition);
    }, () => {
      assertExplainChannels(
        'point:conduct.never-play',
        'SKG-INVENTORY-STALE-UNBOUND',
        'stale inventory',
      );
    });

    withMutation(root, [ENDPOINT_MODULE_JSON], () => {
      const module = readSourceJson(root, ENDPOINT_MODULE_JSON);
      module.edges.push({
        ...structuredClone(module.edges[0]),
        id: 'edge:verification.dangling-explain',
        to: 'point:does-not-exist',
      });
      writeSourceJson(root, ENDPOINT_MODULE_JSON, module);
    }, () => {
      assertExplainChannels(
        'point:verification.terminal-is-not-done',
        'SKG-EDGE-ENDPOINT-MISSING',
        'dangling edge',
      );
    });
  });
});

// A multiply-owned-module scenario used to live here, asserting a
// `SKG-OWNERSHIP-MULTIPLY` diagnostic when a second skill claimed a module that
// another skill already owned. It was deleted rather than repaired: the rule it
// asserted has been deliberately reversed. A module may now be consumed by
// several compositions (one module, one SSOT, many consumers), the diagnostic
// code no longer exists anywhere in the implementation, and `explain
// module:<id>` reports a *list* of consumers. Restoring the assertion would be
// making the test dictate an abandoned constraint back to the engine.
test('SKG-PILOT-07: ownership tree rejects bad refs, orphans, and broken entry chains', async () => {
  await withIsolatedSkillKnowledgeRepo(({ repoRoot: root, runCli: isoCli }) => {
    // Portfolio ref declares an id the referenced composition does not carry.
    withMutation(root, [PORTFOLIO_JSON], () => {
      const portfolio = readSourceJson(root, PORTFOLIO_JSON);
      portfolio.skills[0].id = 'skill:does-not-match';
      writeSourceJson(root, PORTFOLIO_JSON, portfolio);
    }, () => {
      const result = checkK1(isoCli, 'ownership skill ref mismatch');
      assertFailsClosed(result, 'SKG-OWNERSHIP-REF', 'portfolio skill ref mismatch');
    });

    // Composition module ref keeps its id but points its manifest at a different
    // shard. Swapping the *manifest* (not the id) is what isolates the ref check:
    // a wrong id also derails candidate analysis, and the composition would then
    // be dropped for non-admission before ownership is ever examined.
    withMutation(root, [GUIDE_COMPOSITION_JSON], () => {
      const composition = readSourceJson(root, GUIDE_COMPOSITION_JSON);
      composition.consumes.modules[0].manifest = `${KNOWLEDGE_ROOT}/graph/modules/conduct.never-play.json`;
      writeSourceJson(root, GUIDE_COMPOSITION_JSON, composition);
    }, () => {
      const result = checkK1(isoCli, 'ownership module ref mismatch');
      assertFailsClosed(result, 'SKG-OWNERSHIP-REF', 'composition module ref mismatch');
    });

    // Orphan module shard: on disk, but consumed by no composition.
    withMutation(root, [GUIDE_COMPOSITION_JSON], () => {
      const composition = readSourceJson(root, GUIDE_COMPOSITION_JSON);
      composition.consumes.modules = composition.consumes.modules.filter(
        (ref) => ref.id !== 'module:conduct.never-play',
      );
      composition.entry_modules = (composition.entry_modules ?? []).filter(
        (id) => id !== 'module:conduct.never-play',
      );
      writeSourceJson(root, GUIDE_COMPOSITION_JSON, composition);
    }, () => {
      // 该模块仍是 lifecycle.state:"accepted" —— 自称已定稿却没有任何 skill 分发它，仍必须 fail closed。
      // 诊断码由 SKG-OWNERSHIP-ORPHAN 改为 SKG-MODULE-UNCONSUMED：前者原本同时管「模块没被消费」
      // 和「skill 产物没被 portfolio 引用」两件事，共用一码导致两者无法区分、无法分别处置。
      const result = checkK1(isoCli, 'unconsumed accepted module');
      assertFailsClosed(result, 'SKG-MODULE-UNCONSUMED', 'unconsumed accepted module');
    });

    // 反向：同样摘出模块，但把它标成 draft —— 这是"有意留作备料的知识"的显式声明，必须放行。
    // 知识的存在性与它是否被分发是两件正交的事：做一道菜可以备一批食材，不强制每样都用上。
    // 但放行不等于可以消失，所以 report 必须把它列进 unassigned_knowledge —— 备料是有意为之，
    // 遗忘不是，两者必须分得开。这条用例守的就是这个区分；没有它，将来谁把豁免删掉都不会报警。
    withMutation(root, [GUIDE_COMPOSITION_JSON, NEVER_PLAY_MODULE_JSON], () => {
      const composition = readSourceJson(root, GUIDE_COMPOSITION_JSON);
      composition.consumes.modules = composition.consumes.modules.filter(
        (ref) => ref.id !== 'module:conduct.never-play',
      );
      composition.entry_modules = (composition.entry_modules ?? []).filter(
        (id) => id !== 'module:conduct.never-play',
      );
      writeSourceJson(root, GUIDE_COMPOSITION_JSON, composition);
      const moduleDoc = readSourceJson(root, NEVER_PLAY_MODULE_JSON);
      moduleDoc.lifecycle.state = 'draft';
      writeSourceJson(root, NEVER_PLAY_MODULE_JSON, moduleDoc);
    }, () => {
      const result = checkK1(isoCli, 'draft module may stay unconsumed');
      const codes = (result.diagnostics ?? []).map((item) => item.code);
      assert.equal(
        codes.includes('SKG-MODULE-UNCONSUMED'),
        false,
        'a draft module declared as intentionally unassigned must not be reported as unconsumed',
      );
    });

    // Entry target chain: missing skill / wrong module / cross-module point.
    for (const { label, breakTarget } of [
      { label: 'missing skill', breakTarget: (target) => { target.skill = 'skill:missing'; } },
      // point stays verification.*, which belongs to verification.endpoint
      { label: 'wrong module', breakTarget: (target) => { target.module = 'module:conduct.never-play'; } },
      { label: 'cross-module point', breakTarget: (target) => { target.point = 'point:conduct.never-play'; } },
    ]) {
      withMutation(root, [PORTFOLIO_JSON], () => {
        const portfolio = readSourceJson(root, PORTFOLIO_JSON);
        breakTarget(portfolio.entries[0].surfaces[0].targets[0]);
        writeSourceJson(root, PORTFOLIO_JSON, portfolio);
      }, () => {
        const result = checkK1(isoCli, `entry ${label}`);
        assertFailsClosed(result, 'SKG-ENTRY-TARGET-CHAIN', `entry ${label}`);
      });
    }
  });
});

test('SKG-PILOT-08: a point marker declared in two mother files fails closed', async () => {
  await withIsolatedSkillKnowledgeRepo(({ repoRoot: root, runCli: isoCli }) => {
    // Mother files under plugin/src/knowledge/points/ are the SSOT: exactly one
    // ccm:k marker pair per point, at binding.path. Copying a point's marker
    // pair verbatim into a second mother file gives the knowledge two homes,
    // which is the ambiguity this invariant exists to refuse.
    const pointsDir = path.join(root, POINTS_DIR);
    const motherFiles = fs
      .readdirSync(pointsDir)
      .filter((name) => name.endsWith('.md'))
      .sort();
    const donor = 'conduct.never-play.md';
    assert.ok(motherFiles.includes(donor), `expected mother file ${donor}`);
    const host = motherFiles.find((name) => name !== donor);
    assert.ok(host, 'need a second mother file to host the duplicate');

    const donorText = fs.readFileSync(path.join(pointsDir, donor), 'utf8');
    const pair = donorText.match(
      /<!-- ccm:k:start (point:\S+) -->[\s\S]*?<!-- ccm:k:end \1 -->/,
    );
    assert.ok(pair, `no ccm:k marker pair found in ${donor}`);

    withMutation(root, [`${POINTS_DIR}/${host}`], () => {
      const hostPath = path.join(pointsDir, host);
      const hostText = fs.readFileSync(hostPath, 'utf8');
      fs.writeFileSync(hostPath, `${hostText.trimEnd()}\n\n${pair[0]}\n`);
    }, () => {
      const result = checkK1(isoCli, 'duplicate marker check');
      const hit = assertFailsClosed(
        result,
        'SKG-MARKER-DUPLICATE-GLOBAL',
        'duplicate mother marker',
      );
      assert.equal(hit.witness.point, pair[1]);
      assert.equal(hit.witness.spans.length, 2, 'witness must name both declaring files');
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

test('SKG-PILOT-11: duplicate entry ids fail K-I01 even when bodies differ', async () => {
  await withIsolatedSkillKnowledgeRepo(({ repoRoot: root, runCli: isoCli }) => {
    withMutation(root, [PORTFOLIO_JSON], () => {
      const portfolio = readSourceJson(root, PORTFOLIO_JSON);
      const original = portfolio.entries[0];
      assert.equal(original.id, 'entry:master-orchestrator');
      // Same id, deliberately different body: the id is what must collide, so a
      // schema-level "identical object" dedup would not catch this.
      portfolio.entries.push({
        ...structuredClone(original),
        label: 'Adversarial duplicate entry label',
        recognition_cues: ['不同 cue A', '不同 cue B'],
      });
      writeSourceJson(root, PORTFOLIO_JSON, portfolio);

      const validateSource = require('../../scripts/skill-knowledge/validators/validate-source.cjs');
      assert.equal(
        Boolean(validateSource(portfolio)),
        true,
        `duplicate-entry portfolio must remain schema-valid: ${JSON.stringify(validateSource.errors ?? [])}`,
      );
    }, () => {
      const result = checkK1(isoCli, 'duplicate entry id check');
      const hit = assertFailsClosed(result, 'SKG-ID-DUPLICATE', 'duplicate entry id');
      assert.equal(hit.witness.id, 'entry:master-orchestrator');
      assert.ok(hit.remediation);
    });
  });
});

test('SKG-PILOT-12: router budget counts routable modules only, and still bites', async () => {
  await withIsolatedSkillKnowledgeRepo(({ repoRoot: root, runCli: isoCli }) => {
    // 路由预算量的是**会出现在路由面上**的 cue/intent。尚未分配给任何 skill 的备料
    // （draft + 零消费者）不进任何 composition，也就不进任何 entry 的路由表，它现在
    // 一个 token 都不烧——把它算进来，量的是一笔没人付的成本。
    //
    // 这条用例必须双向：只证"备料不计入"，等于允许有人把整个预算检查删掉也照样通过。
    // 所以同一段膨胀文本，挂在备料上要放行，挂在真的会被路由到的模块上要拦下。
    const inflate = (moduleDoc) => {
      moduleDoc.recognition_cues = Array.from(
        { length: 400 },
        (_unused, index) => `膨胀到足以撑爆路由预算的识别线索 number ${index}`,
      );
    };

    // 备料侧：摘出消费者 + 标 draft + 膨胀 → 必须放行。
    withMutation(root, [GUIDE_COMPOSITION_JSON, NEVER_PLAY_MODULE_JSON], () => {
      const composition = readSourceJson(root, GUIDE_COMPOSITION_JSON);
      composition.consumes.modules = composition.consumes.modules.filter(
        (ref) => ref.id !== 'module:conduct.never-play',
      );
      composition.entry_modules = (composition.entry_modules ?? []).filter(
        (id) => id !== 'module:conduct.never-play',
      );
      writeSourceJson(root, GUIDE_COMPOSITION_JSON, composition);
      const moduleDoc = readSourceJson(root, NEVER_PLAY_MODULE_JSON);
      moduleDoc.lifecycle.state = 'draft';
      inflate(moduleDoc);
      writeSourceJson(root, NEVER_PLAY_MODULE_JSON, moduleDoc);
    }, () => {
      const { codes } = checkK1(isoCli, 'unassigned draft stays out of router budget');
      assert.equal(
        codes.includes('SKG-BUDGET-ROUTER'),
        false,
        'knowledge parked outside every composition must not be charged router budget',
      );
    });

    // 可路由侧：同样的膨胀，模块仍被 composition 消费 → 必须拦下。
    // 没有这一半，上一半就无法区分"豁免生效"与"检查根本不工作"。
    withMutation(root, [NEVER_PLAY_MODULE_JSON], () => {
      const moduleDoc = readSourceJson(root, NEVER_PLAY_MODULE_JSON);
      inflate(moduleDoc);
      writeSourceJson(root, NEVER_PLAY_MODULE_JSON, moduleDoc);
    }, () => {
      const result = checkK1(isoCli, 'consumed module still charged router budget');
      const hit = assertFailsClosed(result, 'SKG-BUDGET-ROUTER', 'routable module over budget');
      assert.ok(hit.witness?.budget, 'router budget overflow must carry a witness');
    });
  });
});
