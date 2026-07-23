import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { withIsolatedSkillKnowledgeRepo } from './helpers/skill-knowledge-isolated-repo.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliPath = path.join(repoRoot, 'scripts', 'skill-knowledge.mjs');
const require = createRequire(import.meta.url);
const validateOutput = require('../../scripts/skill-knowledge/validators/validate-output.cjs');

const PRODUCT_HOSTS = Object.freeze(['claude-code', 'codex', 'cursor', 'kimi-code']);

const EXPECTED_POINT_IDS = Object.freeze([
  'point:conduct.deserting-podium',
  'point:conduct.never-play',
  'point:conduct.red-lines',
  'point:routing.executor-vs-target',
  'point:routing.handle-gate',
  'point:routing.ordered-chain',
  'point:verification.endpoint-procedure',
  'point:verification.terminal-is-not-done',
  'point:verification.terminal-summary',
]);

/** Runtime edge classes counted from final clickable relative links (not prose). */
const EXPECTED_EDGE_CLASS_BREAKDOWN = Object.freeze({
  'entry->point': 3,
  'entry->module': 3,
  'knowledge->point': 11,
  'knowledge->module': 3,
  'knowledge->atlas': 3,
  'point->atlas': 9,
  'point->module': 9,
  'point->point': 10,
});
const EXPECTED_ENABLED_EDGES = Object.freeze(
  Object.values(EXPECTED_EDGE_CLASS_BREAKDOWN).reduce((sum, n) => sum + n, 0),
);

function classifyEnabledEdge(edge) {
  const from = edge.from_file.startsWith('knowledge/')
    ? 'knowledge'
    : edge.from_file.includes('commands/') || edge.from_file.includes('cc-master-as-master')
      ? 'entry'
      : 'point';
  const to = edge.to_file.startsWith('knowledge/atlas')
    ? 'atlas'
    : edge.to_file.startsWith('knowledge/modules')
      ? 'module'
      : 'point';
  return `${from}->${to}`;
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function extractEntryPinBlock(markdown) {
  const match = markdown.match(
    /<!--\s*ccm:k:entry-pin:start\s*-->[\s\S]*?<!--\s*ccm:k:entry-pin:end\s*-->/,
  );
  return match ? match[0] : '';
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd ?? repoRoot,
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

function withTempDir(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-compile-'));
  try {
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Closed-set digest of a directory tree without following directory symlinks.
 * Symlink nodes contribute their link target string; files contribute raw bytes.
 */
function closedSetTreeDigest(rootAbsolute) {
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
        rows.push(`file:${relative}:${fs.readFileSync(absolute).toString('hex')}`);
      }
    }
  };
  visit(rootAbsolute, '');
  return sha256Text(rows.join('\n'));
}

function knowledgeHasSymlinkNode(knowledgeRoot) {
  if (!fs.existsSync(knowledgeRoot)) return false;
  const rootStat = fs.lstatSync(knowledgeRoot);
  if (rootStat.isSymbolicLink()) return true;
  const stack = [knowledgeRoot];
  while (stack.length > 0) {
    const directory = stack.pop();
    for (const dirent of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, dirent.name);
      if (dirent.isSymbolicLink()) return true;
      if (dirent.isDirectory()) stack.push(absolute);
    }
  }
  return false;
}

/** Find compile temp/backup leftovers under a closed-set tree (no dir symlink follow). */
function listCompileTempBackupNames(rootAbsolute) {
  const hits = [];
  const visit = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const dirent of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, dirent.name);
      if (/^knowledge\.(write|bak)-/u.test(dirent.name) || /\.tmp-/u.test(dirent.name)) {
        hits.push(dirent.name);
      }
      if (dirent.isSymbolicLink()) continue;
      if (dirent.isDirectory()) visit(absolute);
    }
  };
  visit(rootAbsolute);
  return hits;
}

function snapshotKnowledgeTree(host) {
  const root = path.join(repoRoot, 'plugin/dist', host, 'knowledge');
  const files = [];
  if (!fs.existsSync(root)) return { root, files: [], digest: '' };
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) {
        files.push({
          path: path.relative(root, target).split(path.sep).join('/'),
          bytes: fs.readFileSync(target),
        });
      }
    }
  };
  visit(root);
  const digest = files
    .map((item) => `${item.path}:${item.bytes.toString('hex')}`)
    .join('\n');
  return { root, files, digest };
}

function snapshotPointNavSnippets(host) {
  const skillRoot = path.join(repoRoot, 'plugin/dist', host, 'skills/master-orchestrator-guide');
  const snippets = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        const text = fs.readFileSync(target, 'utf8');
        if (text.includes('ccm:k:nav:start') || text.includes('ccm-k-point-')) {
          snippets.push({
            path: path.relative(skillRoot, target).split(path.sep).join('/'),
            text,
          });
        }
      }
    }
  };
  if (fs.existsSync(skillRoot)) visit(skillRoot);
  return snippets;
}

test('SKG-COMPILE-01: contract flips runtime_projection and lists compile+change as implemented', () => {
  const body = parseJson(runCli(['contract', '--json']));
  assertValidCliOutput(body, 'contract');
  assert.equal(body.capabilities.runtime_projection, true);
  assert.equal(body.capabilities.host_portability_probe, true);
  assert.equal(body.capabilities.typed_change_transactions, true);
  assert.ok(body.implemented_commands.includes('compile'));
  assert.ok(body.declared_commands.includes('compile'));
  assert.ok(body.declared_commands.includes('change'));
  assert.ok(body.implemented_commands.includes('change'));
});

test('SKG-COMPILE-02: four-host compile keeps shared knowledge bytes and proves host-native entry/token divergence', async () => {
  const body = parseJson(runCli(['compile', '--json']));
  assert.equal(body.ok, true, JSON.stringify(body.diagnostics, null, 2));
  assertValidCliOutput(body, 'compile success');
  assert.equal(body.command, 'compile');
  assert.equal(body.result_kind, 'compile');
  assert.equal(body.compile_mode, 'write');
  assert.deepEqual(body.hosts, [...PRODUCT_HOSTS]);
  assert.equal(body.host_results.length, PRODUCT_HOSTS.length);

  const {
    countEnabledRuntimeEdges,
  } = await import('../../scripts/skill-knowledge/compile/surface-verifier.mjs');
  const { entrySurfaceToDistPath } = await import('../../scripts/skill-knowledge/compile/paths.mjs');
  const { buildAndValidateGraph } = await import('../../scripts/skill-knowledge/graph.mjs');
  const { executeHostTokenContract } = await import(
    '../../scripts/skill-knowledge/host-portability/adapter-contract.mjs'
  );

  const graph = buildAndValidateGraph({
    repoRoot,
    sourceRoot: 'plugin/src/knowledge',
  }).graph;
  assert.deepEqual(
    graph.points.map((point) => point.id).sort(),
    [...EXPECTED_POINT_IDS],
    'authored point identities must be exactly the K1 pilot set',
  );

  const knowledgeDigests = new Map();
  const nativeFingerprints = new Map();

  for (const host of PRODUCT_HOSTS) {
    const result = body.host_results.find((item) => item.host === host);
    assert.ok(result, `missing host_results for ${host}`);
    assert.equal(result.ok, true, `${host}: ${JSON.stringify(result)}`);
    assert.equal(result.enabled_edges, EXPECTED_ENABLED_EDGES, `${host} enabled edge count`);
    assert.equal(result.point_anchors, EXPECTED_POINT_IDS.length, `${host} point anchors`);

    for (const gate of ['H1', 'H2', 'H3', 'H4']) {
      assert.equal(result.hop_report[gate].ok, true, `${host} ${gate}`);
      assert.ok(result.hop_report[gate].witness, `${host} ${gate} witness`);
      assert.ok(result.hop_report[gate].remediation, `${host} ${gate} remediation`);
    }

    const knowledge = snapshotKnowledgeTree(host);
    assert.ok(knowledge.files.length > 0, `${host} knowledge tree`);
    knowledgeDigests.set(host, knowledge.digest);

    const payloadRoot = path.join(repoRoot, 'plugin/dist', host);
    const skillDirs = (graph.skills ?? []).map(
      (skill) => `skills/${skill.id.replace(/^skill:/, '')}`,
    );
    const scopedRoots = ['knowledge', ...skillDirs];
    for (const entry of graph.entries ?? []) {
      for (const surfaceSpec of entry.surfaces ?? []) {
        if (surfaceSpec.host !== host) continue;
        const distRel = entrySurfaceToDistPath(host, surfaceSpec.source_file);
        if (!distRel) continue;
        const relative = distRel.replace(`plugin/dist/${host}/`, '');
        if (!scopedRoots.includes(relative)) scopedRoots.push(relative);
      }
    }
    const surface = countEnabledRuntimeEdges({
      host,
      payloadRoot,
      repoRoot,
      mode: 'canonical',
      scopedRoots,
    });
    assert.equal(surface.enabled_edges, EXPECTED_ENABLED_EDGES, `${host} reparsed edges`);
    const breakdown = {};
    for (const edge of surface.enabled_edge_list) {
      const key = classifyEnabledEdge(edge);
      breakdown[key] = (breakdown[key] ?? 0) + 1;
    }
    assert.deepEqual(breakdown, { ...EXPECTED_EDGE_CLASS_BREAKDOWN }, `${host} edge-class breakdown`);

    const entry = (graph.entries ?? [])[0];
    const surfaceSpec = (entry?.surfaces ?? []).find((item) => item.host === host);
    assert.ok(surfaceSpec, `${host} entry surface`);
    const entryDist = entrySurfaceToDistPath(host, surfaceSpec.source_file);
    assert.ok(entryDist, `${host} entry dist path`);
    const entryRel = entryDist.replace(`plugin/dist/${host}/`, '');
    const entryText = fs.readFileSync(path.join(repoRoot, entryDist), 'utf8');
    const pinBlock = extractEntryPinBlock(entryText);
    assert.ok(pinBlock.length > 0, `${host} entry pin block`);

    const tokenContract = executeHostTokenContract(host);
    assert.equal(tokenContract.ok, true, `${host} token contract`);
    // Fingerprint must NOT bake host labels, host path prefixes, or token-contract:<host> tags.
    const nativeFingerprint = JSON.stringify({
      entry_surface_relpath: entryRel,
      entry_pin_sha256: sha256Text(pinBlock),
      token_contract_facts: tokenContract.path_tokens,
    });
    assert.equal(
      nativeFingerprints.has(nativeFingerprint),
      false,
      `host-native fingerprint collided for ${host}; evidence must come from entry path/content + resolved token facts`,
    );
    nativeFingerprints.set(nativeFingerprint, host);
  }

  assert.equal(nativeFingerprints.size, PRODUCT_HOSTS.length);
  // Shared knowledge bytes across hosts are allowed and honestly accepted.
  assert.equal(
    new Set(knowledgeDigests.values()).size,
    1,
    'K1 pilot knowledge routers are host-shared byte-identical; anti-relabel must not require knowledge forks',
  );
});

test('SKG-COMPILE-03: same source compile is byte-identical twice; --check stays green', () => {
  const first = parseJson(runCli(['compile', '--json']));
  assert.equal(first.ok, true);
  const before = Object.fromEntries(PRODUCT_HOSTS.map((host) => [host, snapshotKnowledgeTree(host)]));
  const beforeNav = Object.fromEntries(
    PRODUCT_HOSTS.map((host) => [host, snapshotPointNavSnippets(host)]),
  );

  const second = parseJson(runCli(['compile', '--json']));
  assert.equal(second.ok, true);
  assert.equal(first.graph_hash, second.graph_hash);

  for (const host of PRODUCT_HOSTS) {
    const after = snapshotKnowledgeTree(host);
    assert.equal(after.digest, before[host].digest, `${host} knowledge tree must be byte-identical`);
    assert.deepEqual(
      snapshotPointNavSnippets(host).map((item) => item.text),
      beforeNav[host].map((item) => item.text),
      `${host} injected nav/anchors must be byte-identical`,
    );
  }

  const check = parseJson(runCli(['compile', '--check', '--json']));
  assert.equal(check.ok, true, JSON.stringify(check.diagnostics, null, 2));
  assert.equal(check.compile_mode, 'check');
  assertValidCliOutput(check, 'compile --check');
});

test('SKG-COMPILE-04: final verifier counts only real clickable edges; prose/heading/stub do not count', async () => {
  const {
    countEnabledRuntimeEdges,
  } = await import('../../scripts/skill-knowledge/compile/surface-verifier.mjs');

  withTempDir((root) => {
    const payload = path.join(root, 'surface');
    fs.mkdirSync(path.join(payload, 'knowledge'), { recursive: true });
    fs.mkdirSync(path.join(payload, 'skills/demo'), { recursive: true });
    fs.writeFileSync(
      path.join(payload, 'knowledge', 'atlas.md'),
      [
        '# Atlas',
        '',
        '<a id="ccm-k-module-demo"></a>',
        '',
        '[real](../skills/demo/SKILL.md#ccm-k-point-demo-principle)',
        'See point:demo.principle in prose — must not count.',
        '[heading only](#Demo-principle)',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(payload, 'skills/demo/SKILL.md'),
      [
        '# Demo',
        '',
        '<a id="ccm-k-point-demo-principle"></a>',
        '',
        '[back](../../knowledge/atlas.md#ccm-k-module-demo)',
        '',
      ].join('\n'),
    );

    const counted = countEnabledRuntimeEdges({
      host: 'claude-code',
      payloadRoot: payload,
      repoRoot,
    });
    assert.equal(counted.ok, false, 'heading-only fragment must fail closed');
    assert.equal(counted.enabled_edges, 2);
    assert.equal(
      counted.diagnostics.some((item) => item.code === 'SKG-HOST-ANCHOR-UNVERIFIABLE'),
      true,
      'heading-only fragment must fail closed',
    );
  });

  withTempDir((root) => {
    const stub = path.join(root, 'stub');
    fs.mkdirSync(path.join(stub, 'skills/demo'), { recursive: true });
    fs.writeFileSync(
      path.join(stub, 'skills/demo/SKILL.md'),
      ['# Stub', '', '<a id="ccm-k-point-demo-principle"></a>', ''].join('\n'),
    );
    const counted = countEnabledRuntimeEdges({
      host: 'cursor',
      payloadRoot: stub,
      repoRoot,
      mode: 'stub',
    });
    assert.equal(counted.ok, false);
    assert.equal(
      counted.diagnostics.some((item) => item.code === 'SKG-HOST-STUB-FALSE-COVERAGE'),
      true,
    );
    assert.equal(counted.enabled_edges, 0);
  });
});

test('SKG-COMPILE-05: broken link / malformed / duplicate / path-token / drift mutations fail closed', () => {
  withIsolatedSkillKnowledgeRepo(({ repoRoot: isoRoot, runCli: isoCli }) => {
    assert.equal(parseJson(isoCli(['compile', '--json'])).ok, true);

    const atlas = path.join(isoRoot, 'plugin/dist/claude-code/knowledge/atlas.md');
    const original = fs.readFileSync(atlas, 'utf8');

    fs.writeFileSync(
      atlas,
      `${original}\n[broken](./missing.md#ccm-k-point-verification-terminal-is-not-done)\n`,
    );
    const broken = parseJson(isoCli(['compile', '--host', 'claude-code', '--check', '--json']));
    assert.equal(broken.ok, false);
    assert.ok(broken.diagnostics.length > 0);
    assert.ok(
      broken.diagnostics.some(
        (item) =>
          item.code === 'SKG-HOST-LINK-TARGET-MISSING' ||
          item.code === 'SKG-COMPILE-DRIFT' ||
          item.code === 'SKG-PROJECTION-DRIFT',
      ),
      JSON.stringify(broken.diagnostics.map((item) => item.code)),
    );

    fs.writeFileSync(atlas, original);
    fs.writeFileSync(
      atlas,
      `${original}\n<a id="ccm-k-module-verification-endpoint></a>\n`,
    );
    const malformed = parseJson(isoCli(['compile', '--host', 'claude-code', '--check', '--json']));
    assert.equal(malformed.ok, false);
    assert.ok(
      malformed.diagnostics.some(
        (item) =>
          item.code === 'SKG-HOST-ANCHOR-MALFORMED' ||
          item.code === 'SKG-COMPILE-DRIFT' ||
          item.code === 'SKG-PROJECTION-DRIFT',
      ),
    );

    fs.writeFileSync(atlas, original);
    fs.writeFileSync(
      atlas,
      `${original}\nSee \${CLAUDE_PLUGIN_ROOT}/skills/master-orchestrator-guide/SKILL.md\n`,
    );
    const token = parseJson(isoCli(['compile', '--host', 'claude-code', '--check', '--json']));
    assert.equal(token.ok, false);
    assert.ok(
      token.diagnostics.some(
        (item) =>
          item.code === 'SKG-HOST-PATH-TOKEN-FORBIDDEN' ||
          item.code === 'SKG-COMPILE-DRIFT' ||
          item.code === 'SKG-PROJECTION-DRIFT',
      ),
    );
  });
});

test('SKG-COMPILE-06: per-host compile and unknown host / check --host remain honest', () => {
  const one = parseJson(runCli(['compile', '--host', 'codex', '--json']));
  assert.equal(one.ok, true);
  assert.deepEqual(one.hosts, ['codex']);
  assertValidCliOutput(one, 'compile --host codex');

  const unknown = parseJson(runCli(['compile', '--host', 'windsurf', '--json']));
  assert.equal(unknown.ok, false);
  assert.equal(unknown.diagnostics[0].code, 'SKG-HOST-UNKNOWN');

  const changeUsage = runCli(['change', '--json']);
  assert.equal(changeUsage.status, 2, 'bare change is usage, not capability-unavailable');
  assert.equal(parseJson(changeUsage).diagnostics[0].code, 'SKG-USAGE');

  const checkHost = runCli(['check', '--host', 'codex', '--json']);
  assert.equal(checkHost.status, 10);
  assert.equal(parseJson(checkHost).diagnostics[0].code, 'SKG-CAPABILITY-NOT-IMPLEMENTED');
});

test('SKG-COMPILE-07: sync-plugin-dist post-pass keeps knowledge in package allowlist and out of hooks', () => {
  const sync = fs.readFileSync(path.join(repoRoot, 'scripts/sync-plugin-dist.sh'), 'utf8');
  assert.match(
    sync,
    /skill-knowledge\.mjs\s+compile|skill-knowledge\/compile/,
    'sync-plugin-dist must invoke knowledge compile post-pass',
  );
  assert.doesNotMatch(
    sync,
    /cp .*skill-knowledge\.mjs.*hooks|hooks\/.*skill-knowledge/,
    'must not ship compile toolkit into runtime hooks',
  );

  const packager = fs.readFileSync(path.join(repoRoot, 'scripts/package-plugin.sh'), 'utf8');
  assert.match(
    packager,
    /include_dirs=\(.*\bknowledge\b/,
    'package-plugin allowlist must include knowledge/',
  );
});

test('SKG-COMPILE-08: docs lockstep — compile+change delivered; check --host still exit 10', () => {
  const knowledgeContract = fs.readFileSync(
    path.join(repoRoot, 'plugin/src/knowledge/CONTRACT.md'),
    'utf8',
  );
  const designReadme = fs.readFileSync(
    path.join(repoRoot, 'design_docs/skill-knowledge-graph/README.md'),
    'utf8',
  );
  const cliContract = fs.readFileSync(
    path.join(repoRoot, 'design_docs/skill-knowledge-graph/cli-contract.md'),
    'utf8',
  );
  const specification = fs.readFileSync(
    path.join(repoRoot, 'design_docs/skill-knowledge-graph/specification.md'),
    'utf8',
  );

  assert.match(knowledgeContract, /runtime_projection[\s\S]{0,80}true|compile[\s\S]{0,80}(已|implemented)/i);
  assert.match(
    knowledgeContract,
    /typed_change_transactions[\s\S]{0,40}true|change begin[\s\S]{0,80}validate[\s\S]{0,80}apply/i,
  );
  assert.match(knowledgeContract, /(check\s+--host|--host)[\s\S]{0,120}exit\s*10/i);
  assert.doesNotMatch(knowledgeContract, /Still declared-unavailable[\s\S]{0,40}`change`/i);
  assert.doesNotMatch(knowledgeContract, /Still declared-unavailable[\s\S]{0,40}`compile`/i);

  assert.match(designReadme, /`?compile`?[\s\S]{0,160}(已实现|implemented)/i);
  assert.match(designReadme, /runtime_projection[\s\S]{0,40}true/i);
  assert.match(
    designReadme,
    /typed\s+change\s+transactions[\s\S]{0,180}(已交付|implemented|begin\s*→\s*validate\s*→\s*apply)/i,
  );
  assert.doesNotMatch(
    designReadme,
    /`?compile`?[\s\S]{0,80}`?change`?[\s\S]{0,80}exit\s*10/,
    'must not keep compile bundled with change as exit 10',
  );

  assert.match(cliContract, /`compile`[\s\S]{0,80}implemented|compile.*implemented-k1/i);
  assert.match(cliContract, /runtime_projection": true/);
  assert.match(cliContract, /typed_change_transactions": true/);
  assert.match(cliContract, /`change begin\\|validate\\|apply`[\s\S]{0,40}implemented-k1/);
  assert.match(cliContract, /(check\s+--host|--host|--base)[\s\S]{0,120}exit\s*10|declared-unavailable/i);

  assert.match(specification, /runtime_projection[\s\S]{0,40}true|compile[\s\S]{0,80}已实现/i);
  assert.match(specification, /typed_change_transactions[\s\S]{0,40}true|typed `change`/i);
});

test('SKG-COMPILE-09: wrong-file point anchor placement fails binding verification (bypass diffArtifacts)', async () => {
  await withIsolatedSkillKnowledgeRepo(async ({ repoRoot: isoRoot, runCli: isoCli }) => {
    assert.equal(parseJson(isoCli(['compile', '--host', 'claude-code', '--json'])).ok, true);

    const {
      countEnabledRuntimeEdges,
      verifyHopContracts,
    } = await import('../../scripts/skill-knowledge/compile/surface-verifier.mjs');
    const { entrySurfaceToDistPath } = await import('../../scripts/skill-knowledge/compile/paths.mjs');
    const { buildAndValidateGraph } = await import('../../scripts/skill-knowledge/graph.mjs');

    const host = 'claude-code';
    const atlas = path.join(isoRoot, 'plugin/dist', host, 'knowledge/atlas.md');
    const router = path.join(
      isoRoot,
      'plugin/dist',
      host,
      'knowledge/modules/verification.endpoint.md',
    );
    const originalAtlas = fs.readFileSync(atlas, 'utf8');
    const originalRouter = fs.readFileSync(router, 'utf8');

    // Bypass diffArtifacts: mutate the live surface so fragment-only matching would still "work".
    fs.writeFileSync(
      atlas,
      originalAtlas.replace(
        '## Critical pins',
        '<a id="ccm-k-point-verification-terminal-is-not-done"></a>\n\n## Critical pins',
      ),
    );
    const mutatedRouter = originalRouter.replace(
      '](../../skills/master-orchestrator-guide/references/worker-routing.md#ccm-k-point-verification-terminal-is-not-done)',
      '](../atlas.md#ccm-k-point-verification-terminal-is-not-done)',
    );
    assert.notEqual(mutatedRouter, originalRouter, 'router mutation must apply');
    fs.writeFileSync(router, mutatedRouter);

    const graph = buildAndValidateGraph({
      repoRoot: isoRoot,
      sourceRoot: 'plugin/src/knowledge',
    }).graph;
    const payloadRoot = path.join(isoRoot, 'plugin/dist', host);
    const skillDirs = (graph.skills ?? []).map(
      (skill) => `skills/${skill.id.replace(/^skill:/, '')}`,
    );
    const scopedRoots = ['knowledge', ...skillDirs];
    for (const entry of graph.entries ?? []) {
      for (const surfaceSpec of entry.surfaces ?? []) {
        if (surfaceSpec.host !== host) continue;
        const distRel = entrySurfaceToDistPath(host, surfaceSpec.source_file);
        if (!distRel) continue;
        const relative = distRel.replace(`plugin/dist/${host}/`, '');
        if (!scopedRoots.includes(relative)) scopedRoots.push(relative);
      }
    }

    const surface = countEnabledRuntimeEdges({
      host,
      payloadRoot,
      repoRoot: isoRoot,
      mode: 'canonical',
      scopedRoots,
    });
    const hops = verifyHopContracts({ host, graph, surface, repoRoot: isoRoot });

    assert.equal(
      hops.surface_ok,
      false,
      'point anchor in atlas + router retarget must fail binding verification',
    );
    assert.equal(hops.ok, false);
    const codes = hops.diagnostics.map((item) => item.code);
    assert.ok(
      codes.some((code) =>
        [
          'SKG-SURFACE-BINDING-MISMATCH',
          'SKG-SURFACE-SOURCE-UNRESOLVED',
          'SKG-SURFACE-TARGET-UNRESOLVED',
          'SKG-SURFACE-ANCHOR-MISPLACED',
        ].includes(code),
      ),
      `expected binding diagnostic, got ${JSON.stringify(codes)}`,
    );
  });
});

test('SKG-COMPILE-10: knowledge dir is an exact-managed tree (extra/stale + symlink escape)', () => {
  withIsolatedSkillKnowledgeRepo(({ repoRoot: isoRoot, runCli: isoCli }) => {
    assert.equal(parseJson(isoCli(['compile', '--host', 'claude-code', '--json'])).ok, true);

    const knowledgeRoot = path.join(isoRoot, 'plugin/dist/claude-code/knowledge');
    const stale = path.join(knowledgeRoot, 'stale-extra.md');
    const escapeLink = path.join(knowledgeRoot, 'escape-link.md');

    fs.writeFileSync(stale, '# benign stale file\n');
    const checkStale = parseJson(isoCli(['compile', '--host', 'claude-code', '--check', '--json']));
    assert.equal(checkStale.ok, false, 'extra file must fail check');
    assert.notEqual(checkStale.ok === true ? 0 : 1, 0);
    const driftDiag = checkStale.diagnostics.find((item) => item.code === 'SKG-COMPILE-DRIFT');
    assert.ok(driftDiag, 'expected SKG-COMPILE-DRIFT');
    assert.ok(
      (driftDiag.witness?.drift ?? []).some(
        (item) => item.kind === 'extra' && String(item.path).endsWith('stale-extra.md'),
      ),
      `expected extra witness, got ${JSON.stringify(driftDiag.witness)}`,
    );

    const write = parseJson(isoCli(['compile', '--host', 'claude-code', '--json']));
    assert.equal(write.ok, true, JSON.stringify(write.diagnostics, null, 2));
    assert.equal(fs.existsSync(stale), false, 'write must delete stale knowledge files');

    const checkClean = parseJson(isoCli(['compile', '--host', 'claude-code', '--check', '--json']));
    assert.equal(checkClean.ok, true, JSON.stringify(checkClean.diagnostics, null, 2));

    // Symlink / path escape must not be silently accepted as managed content.
    fs.symlinkSync('/etc/passwd', escapeLink);
    const checkLink = parseJson(isoCli(['compile', '--host', 'claude-code', '--check', '--json']));
    assert.equal(checkLink.ok, false, 'symlink escape must fail check');
    assert.ok(
      checkLink.diagnostics.some((item) => item.code === 'SKG-COMPILE-DRIFT'),
      JSON.stringify(checkLink.diagnostics.map((item) => item.code)),
    );
    const writeLink = parseJson(isoCli(['compile', '--host', 'claude-code', '--json']));
    assert.equal(writeLink.ok, true, JSON.stringify(writeLink.diagnostics, null, 2));
    assert.equal(fs.existsSync(escapeLink), false, 'write must remove escape symlink');
  });
});

test('SKG-COMPILE-12: knowledge root / modules external symlink must not write outside (fail-without-touch)', () => {
  withIsolatedSkillKnowledgeRepo(({ repoRoot: isoRoot, runCli: isoCli }) => {
    assert.equal(parseJson(isoCli(['compile', '--host', 'claude-code', '--json'])).ok, true);

    const host = 'claude-code';
    const knowledgeRoot = path.join(isoRoot, 'plugin/dist', host, 'knowledge');
    const modulesDir = path.join(knowledgeRoot, 'modules');

    // --- mutation 1: entire knowledge/ is an external symlink ---
    withTempDir((externalRoot) => {
      const marker = path.join(externalRoot, 'EXTERNAL-MARKER.txt');
      fs.writeFileSync(marker, 'do-not-touch\n');
      const beforeDigest = closedSetTreeDigest(externalRoot);
      assert.equal(beforeDigest.length, 64);

      fs.rmSync(knowledgeRoot, { recursive: true, force: true });
      fs.symlinkSync(externalRoot, knowledgeRoot);
      assert.equal(fs.lstatSync(knowledgeRoot).isSymbolicLink(), true);

      const write = parseJson(isoCli(['compile', '--host', host, '--json']));
      assert.equal(write.ok, true, JSON.stringify(write.diagnostics, null, 2));

      const afterDigest = closedSetTreeDigest(externalRoot);
      assert.equal(
        afterDigest,
        beforeDigest,
        'external tree closed-set digest must be unchanged after write compile',
      );
      assert.equal(fs.readFileSync(marker, 'utf8'), 'do-not-touch\n');
      assert.equal(fs.existsSync(marker), true);
      assert.equal(
        fs.lstatSync(knowledgeRoot).isSymbolicLink(),
        false,
        'final knowledge root must not remain a symlink',
      );
      assert.equal(
        knowledgeHasSymlinkNode(knowledgeRoot),
        false,
        'final host knowledge tree must contain no symlink nodes',
      );

      const check = parseJson(isoCli(['compile', '--host', host, '--check', '--json']));
      assert.equal(check.ok, true, JSON.stringify(check.diagnostics, null, 2));
    });

    // Restore a clean projected tree before the second mutation.
    assert.equal(parseJson(isoCli(['compile', '--host', host, '--json'])).ok, true);

    // --- mutation 2: knowledge/modules/ is an external symlink ---
    withTempDir((externalModules) => {
      const marker = path.join(externalModules, 'MODULES-EXTERNAL-MARKER.txt');
      fs.writeFileSync(marker, 'modules-sealed\n');
      const beforeDigest = closedSetTreeDigest(externalModules);

      fs.rmSync(modulesDir, { recursive: true, force: true });
      fs.symlinkSync(externalModules, modulesDir);
      assert.equal(fs.lstatSync(modulesDir).isSymbolicLink(), true);

      const write = parseJson(isoCli(['compile', '--host', host, '--json']));
      assert.equal(write.ok, true, JSON.stringify(write.diagnostics, null, 2));

      const afterDigest = closedSetTreeDigest(externalModules);
      assert.equal(
        afterDigest,
        beforeDigest,
        'external modules tree closed-set digest must be unchanged',
      );
      assert.equal(fs.readFileSync(marker, 'utf8'), 'modules-sealed\n');
      assert.equal(
        fs.lstatSync(modulesDir).isSymbolicLink(),
        false,
        'final modules/ must not remain a symlink',
      );
      assert.equal(
        knowledgeHasSymlinkNode(knowledgeRoot),
        false,
        'final host knowledge tree must contain no symlink nodes',
      );

      const check = parseJson(isoCli(['compile', '--host', host, '--check', '--json']));
      assert.equal(check.ok, true, JSON.stringify(check.diagnostics, null, 2));
    });
  });
});

test('SKG-COMPILE-13: plugin/dist or plugin external symlink fails closed (repo trust root)', () => {
  withIsolatedSkillKnowledgeRepo(({ repoRoot: isoRoot, runCli }) => {
    const warm = runCli(['compile', '--host', 'claude-code', '--json']);
    assert.equal(warm.status, 0, warm.stderr || warm.stdout);
    assert.equal(parseJson(warm).ok, true);

    // --- mutation A: entire plugin/dist is an external symlink ---
    withTempDir((externalRoot) => {
      const externalDist = path.join(externalRoot, 'dist-payload');
      const distInRepo = path.join(isoRoot, 'plugin/dist');
      fs.renameSync(distInRepo, externalDist);
      fs.symlinkSync(externalDist, distInRepo);
      assert.equal(fs.lstatSync(distInRepo).isSymbolicLink(), true);

      const marker = path.join(externalRoot, 'DIST-EXTERNAL-MARKER.txt');
      fs.writeFileSync(marker, 'dist-sealed\n');
      const beforeDigest = closedSetTreeDigest(externalRoot);

      const write = runCli(['compile', '--host', 'claude-code', '--json']);
      assert.notEqual(write.status, 0, 'write compile must fail closed when plugin/dist is external symlink');
      const body = JSON.parse(write.stdout);
      assert.equal(body.ok, false);
      assert.ok(
        (body.diagnostics ?? []).some((item) =>
          /SKG-COMPILE-(ANCESTOR-SYMLINK|HOST-DIST-OUTSIDE-REPO|WRITE-FAILED|PATH-ESCAPE)/.test(
            item.code,
          ) ||
          /ANCESTOR-SYMLINK|HOST-DIST-OUTSIDE-REPO|symlink ancestor|outside repo/i.test(
            item.message ?? '',
          ),
        ),
        `expected rootedness diagnostic, got ${JSON.stringify(body.diagnostics)}`,
      );

      assert.equal(closedSetTreeDigest(externalRoot), beforeDigest);
      assert.equal(fs.readFileSync(marker, 'utf8'), 'dist-sealed\n');
      assert.deepEqual(
        listCompileTempBackupNames(externalRoot),
        [],
        'external tree must not receive compile temp/backup leftovers',
      );
      assert.equal(fs.lstatSync(distInRepo).isSymbolicLink(), true);
    });

    // Restore a real plugin/dist via fresh isolated warm path is unnecessary —
    // mutation A lives in withTempDir and leaves the iso tree with a dangling
    // or restored state. Re-copy isolation for mutation B.
  });

  withIsolatedSkillKnowledgeRepo(({ repoRoot: isoRoot, runCli }) => {
    const warm = runCli(['compile', '--host', 'claude-code', '--json']);
    assert.equal(warm.status, 0, warm.stderr || warm.stdout);
    assert.equal(parseJson(warm).ok, true);

    // --- mutation B: entire plugin/ is an external symlink ---
    withTempDir((externalRoot) => {
      const externalPlugin = path.join(externalRoot, 'plugin-payload');
      const pluginInRepo = path.join(isoRoot, 'plugin');
      fs.renameSync(pluginInRepo, externalPlugin);
      fs.symlinkSync(externalPlugin, pluginInRepo);
      assert.equal(fs.lstatSync(pluginInRepo).isSymbolicLink(), true);

      const marker = path.join(externalRoot, 'PLUGIN-EXTERNAL-MARKER.txt');
      fs.writeFileSync(marker, 'plugin-sealed\n');
      const beforeDigest = closedSetTreeDigest(externalRoot);

      const write = runCli(['compile', '--host', 'claude-code', '--json']);
      assert.notEqual(write.status, 0, 'write compile must fail closed when plugin/ is external symlink');
      const body = JSON.parse(write.stdout);
      assert.equal(body.ok, false);

      assert.equal(closedSetTreeDigest(externalRoot), beforeDigest);
      assert.equal(fs.readFileSync(marker, 'utf8'), 'plugin-sealed\n');
      assert.deepEqual(listCompileTempBackupNames(externalRoot), []);
      assert.equal(fs.lstatSync(pluginInRepo).isSymbolicLink(), true);
    });
  });
});

test('SKG-COMPILE-11: emitted entry pin / routers end with exactly one trailing newline', () => {
  const body = parseJson(runCli(['compile', '--json']));
  assert.equal(body.ok, true, JSON.stringify(body.diagnostics, null, 2));

  for (const host of PRODUCT_HOSTS) {
    const knowledge = snapshotKnowledgeTree(host);
    for (const file of knowledge.files) {
      const text = file.bytes.toString('utf8');
      assert.ok(text.endsWith('\n'), `${host}/${file.path} must end with newline`);
      assert.equal(
        text.endsWith('\n\n'),
        false,
        `${host}/${file.path} must not end with double newline`,
      );
    }

    const entryCandidates = [
      path.join(repoRoot, `plugin/dist/${host}/commands/as-master-orchestrator.md`),
      path.join(repoRoot, `plugin/dist/${host}/skills/cc-master-as-master-orchestrator/SKILL.md`),
    ];
    for (const candidate of entryCandidates) {
      if (!fs.existsSync(candidate)) continue;
      const text = fs.readFileSync(candidate, 'utf8');
      if (!text.includes('ccm:k:entry-pin:end')) continue;
      assert.ok(text.endsWith('\n'), `${candidate} must end with newline`);
      assert.equal(
        text.endsWith('\n\n'),
        false,
        `${candidate} must not end with double newline (entry pin template)`,
      );
    }
  }

  const diffCheck = spawnSync('git', ['diff', '--check', '--', 'plugin/dist'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(
    diffCheck.status,
    0,
    `git diff --check must be green after compile:\n${diffCheck.stdout}\n${diffCheck.stderr}`,
  );
});
