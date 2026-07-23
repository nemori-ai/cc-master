import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixturesRoot = path.join(repoRoot, 'tests', 'fixtures', 'skill-knowledge');
const cliPath = path.join(repoRoot, 'scripts', 'skill-knowledge.mjs');

async function loadDomain() {
  return {
    schema: await import('../../scripts/skill-knowledge/schema.mjs'),
    markers: await import('../../scripts/skill-knowledge/markers.mjs'),
    hash: await import('../../scripts/skill-knowledge/hash.mjs'),
    inventory: await import('../../scripts/skill-knowledge/inventory.mjs'),
    loader: await import('../../scripts/skill-knowledge/loader.mjs'),
    contracts: await import('../../scripts/skill-knowledge/contracts.mjs'),
  };
}

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function readFixture(...parts) {
  return fs.readFileSync(path.join(fixturesRoot, ...parts), 'utf8');
}

function readJson(...parts) {
  return JSON.parse(readFixture(...parts));
}

test('SKG-K1-SCHEMA-01: standalone Draft 2020-12 validators accept C1-C5 valid fixtures and reject invalid ones', async () => {
  const { schema } = await loadDomain();
  assert.equal(schema.validatorsAvailable(), true);

  const cases = [
    ['valid/c1-entry-surfaces.portfolio.json', 'source', true],
    ['valid/c2-inventory.skill.json', 'source', true],
    ['valid/c3-c4-module.json', 'source', true],
    ['valid/c5-c6-change.json', 'change', true],
    ['invalid/c1-missing-surfaces.portfolio.json', 'source', false],
    ['invalid/c2-missing-inventory.skill.json', 'source', false],
    ['invalid/c3-derived-missing-hash.module.json', 'source', false],
    ['invalid/c4-accepted-skill-without-admission.skill.json', 'source', false],
    ['invalid/c5-change-missing-chain.change.json', 'change', false],
  ];

  for (const [relative, kind, expectOk] of cases) {
    const document = readJson(relative);
    const result = schema.validateAuthoredDocument(document, kind);
    assert.equal(result.ok, expectOk, relative);
    if (!expectOk) {
      assert.ok(Array.isArray(result.errors) && result.errors.length > 0, relative);
    }
  }
});

test('SKG-K1-MARKER-01: extracts spans, source map, and fails closed on overlap/unclosed/duplicate', async () => {
  const { markers } = await loadDomain();
  const valid = markers.extractMarkers(readFixture('markdown/valid-span.md'), 'markdown/valid-span.md');
  assert.equal(valid.ok, true);
  assert.equal(valid.spans.length, 1);
  assert.equal(valid.spans[0].point_id, 'point:demo.principle');
  assert.equal(valid.spans[0].start_line < valid.spans[0].end_line, true);
  assert.equal(typeof valid.spans[0].content, 'string');
  assert.match(valid.spans[0].content, /Principle body line one/);
  assert.equal(valid.source_map.length, 1);
  assert.equal(valid.source_map[0].point_id, 'point:demo.principle');
  assert.equal(valid.source_map[0].path, 'markdown/valid-span.md');

  for (const name of ['overlap.md', 'unclosed.md', 'duplicate.md']) {
    const result = markers.extractMarkers(readFixture('markdown', name), `markdown/${name}`);
    assert.equal(result.ok, false, name);
    assert.ok(result.diagnostics.length > 0, name);
    assert.match(result.diagnostics[0].code, /^SKG-MARKER-/);
  }

  const nested = markers.extractMarkers(readFixture('markdown/nested.md'), 'markdown/nested.md');
  assert.equal(nested.ok, true);
  assert.equal(nested.spans.length, 2);
  assert.deepEqual(
    nested.spans.map((span) => span.point_id).sort(),
    ['point:demo.inner', 'point:demo.outer'],
  );
});

test('SKG-K1-HASH-01: C7 span hash normalizes CRLF→LF and ignores marker lines', async () => {
  const { hash, markers } = await loadDomain();
  // Do not track a CRLF fixture in git (git show --check treats CR as trailing
  // whitespace). Derive CRLF bytes at runtime from the LF fixture instead.
  const lfText = readFixture('markdown/valid-span.md');
  assert.equal(lfText.includes('\r'), false, 'LF fixture must not contain CR');
  const crlfText = lfText.replace(/\n/g, '\r\n');
  assert.match(crlfText, /\r\n/);
  assert.notEqual(crlfText, lfText);
  assert.equal(hash.normalizeNewlines(crlfText), lfText);
  assert.notEqual(
    hash.sha256Hex(lfText),
    hash.sha256Hex(crlfText),
    'raw CRLF bytes must differ from LF before newline normalization',
  );

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-k1-hash-01-crlf-'));
  try {
    const crlfPath = path.join(tempRoot, 'valid-span.crlf.md');
    fs.writeFileSync(crlfPath, crlfText, 'utf8');
    const crlfBytes = fs.readFileSync(crlfPath);
    assert.ok(
      crlfBytes.includes(Buffer.from('\r\n')),
      'temp CRLF fixture must contain CRLF byte pairs',
    );
    const crlfFromDisk = crlfBytes.toString('utf8');
    assert.equal(crlfFromDisk, crlfText);

    const lf = markers.extractMarkers(lfText, 'markdown/valid-span.md');
    const crlf = markers.extractMarkers(crlfFromDisk, 'markdown/valid-span.crlf.md');
    assert.equal(lf.ok, true);
    assert.equal(crlf.ok, true);
    const lfHash = hash.hashMarkdownSpan(lf.spans[0].content);
    const crlfHash = hash.hashMarkdownSpan(crlf.spans[0].content);
    assert.equal(lfHash, crlfHash);
    assert.equal(lfHash.length, 64);
    assert.equal(
      hash.SPAN_HASH_ALGORITHM,
      'cc-master/skill-knowledge-markdown-span-hash/v1',
    );

    // Marker lines themselves must not be part of the hashed content.
    assert.equal(lf.spans[0].content.includes('ccm:k:start'), false);
    assert.equal(lf.spans[0].content.includes('ccm:k:end'), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('SKG-K1-HASH-02: C8 budget estimator is deterministic ceil(utf8_bytes/3)', async () => {
  const { hash } = await loadDomain();
  assert.equal(
    hash.BUDGET_ALGORITHM,
    'cc-master/skill-knowledge-budget-estimator/v1',
  );
  assert.deepEqual(hash.estimateBudget(''), {
    utf8_bytes: 0,
    lines: 0,
    estimated_tokens: 0,
  });
  assert.deepEqual(hash.estimateBudget('abc'), {
    utf8_bytes: 3,
    lines: 1,
    estimated_tokens: 1,
  });
  assert.deepEqual(hash.estimateBudget('abcd'), {
    utf8_bytes: 4,
    lines: 1,
    estimated_tokens: 2,
  });
  assert.deepEqual(hash.estimateBudget('a\r\nb\r\n'), {
    utf8_bytes: 4,
    lines: 2,
    estimated_tokens: 2,
  });
  assert.deepEqual(hash.estimateBudget('a\nb'), {
    utf8_bytes: 3,
    lines: 2,
    estimated_tokens: 1,
  });
});

test('SKG-K1-HASH-03: C6 canonical graph hash excludes result_graph_sha256 self-reference', async () => {
  const { hash } = await loadDomain();
  assert.equal(
    hash.GRAPH_HASH_ALGORITHM,
    'cc-master/skill-knowledge-canonical-graph-hash/v1',
  );

  const change = readJson('valid/c6-change-with-result-hash.json');
  const portfolio = readJson('valid/c1-entry-surfaces.portfolio.json');
  const skill = readJson('valid/c2-inventory.skill.json');
  const moduleDoc = readJson('valid/c3-c4-module.json');

  const baseInput = {
    manifests: [portfolio, skill, moduleDoc],
    span_hashes: {
      'point:verification.terminal-is-not-done': 'aa'.repeat(32),
      'point:verification.endpoint-procedure': 'bb'.repeat(32),
    },
    inventory: skill.canonical_source_inventory,
    change_head: change,
  };

  const first = hash.canonicalGraphHash(baseInput);
  const mutatedSelfRef = structuredClone(baseInput);
  mutatedSelfRef.change_head.result_graph_sha256 = 'ff'.repeat(32);
  const second = hash.canonicalGraphHash(mutatedSelfRef);
  assert.equal(first, second, 'result_graph_sha256 must not affect graph hash');

  const mutatedParent = structuredClone(baseInput);
  mutatedParent.change_head.parent_change = 'change:20260101.other';
  const third = hash.canonicalGraphHash(mutatedParent);
  assert.notEqual(first, third, 'parent_change must affect change-head digest');

  // Same logical payload with different key insertion order must hash identically.
  const reordered = {
    change_head: change,
    inventory: skill.canonical_source_inventory,
    span_hashes: {
      'point:verification.endpoint-procedure': 'bb'.repeat(32),
      'point:verification.terminal-is-not-done': 'aa'.repeat(32),
    },
    manifests: [moduleDoc, skill, portfolio],
  };
  assert.equal(hash.canonicalGraphHash(reordered), first);
});

test('SKG-K1-INVENTORY-01: attestations detect stale unbound reviews', async () => {
  const { inventory, markers, hash } = await loadDomain();
  const markdownPath = 'tests/fixtures/skill-knowledge/markdown/valid-span.md';
  const markdown = readFixture('markdown/valid-span.md');
  const extracted = markers.extractMarkers(markdown, markdownPath);
  assert.equal(extracted.ok, true);

  const freshHash = inventory.hashUnboundRegions(markdown, extracted.spans);
  const entry = {
    path: markdownPath,
    coverage: 'partial',
    point_ids: ['point:demo.principle'],
    reviewed_unbound_sha256: freshHash,
    unresolved_coverage_debt: ['demo debt'],
  };
  const ok = inventory.attestInventoryEntry(entry, markdown, extracted.spans);
  assert.equal(ok.ok, true);
  assert.equal(ok.attestation.reviewed_unbound_sha256, freshHash);

  const stale = inventory.attestInventoryEntry(
    { ...entry, reviewed_unbound_sha256: '00'.repeat(32) },
    markdown,
    extracted.spans,
  );
  assert.equal(stale.ok, false);
  assert.equal(stale.diagnostics[0].code, 'SKG-INVENTORY-STALE-UNBOUND');

  // Sanity: empty unbound hashes empty string under span-hash rules.
  const fullMarkdown = `<!-- ccm:k:start point:demo.principle -->\nonly\n<!-- ccm:k:end point:demo.principle -->\n`;
  const fullExtracted = markers.extractMarkers(fullMarkdown, 'full.md');
  assert.equal(fullExtracted.ok, true);
  assert.equal(
    inventory.hashUnboundRegions(fullMarkdown, fullExtracted.spans),
    hash.hashMarkdownSpan(''),
  );
});

test('SKG-K1-LOADER-01: source loader emits deterministic diagnostics and IR fields', async () => {
  const { loader } = await loadDomain();
  const sourceRoot = path.join(fixturesRoot, 'loader-source');
  fs.rmSync(sourceRoot, { recursive: true, force: true });
  fs.mkdirSync(sourceRoot, { recursive: true });
  try {
    fs.writeFileSync(
      path.join(sourceRoot, 'portfolio.json'),
      `${JSON.stringify(readJson('valid/c1-entry-surfaces.portfolio.json'))}\n`,
    );
    fs.writeFileSync(
      path.join(sourceRoot, 'bad.json'),
      `${JSON.stringify(readJson('invalid/c1-missing-surfaces.portfolio.json'))}\n`,
    );

    const loaded = loader.loadKnowledgeSource({
      repoRoot,
      sourceRoot,
    });
    assert.equal(loaded.ok, false);
    assert.ok(loaded.documents.some((document) => document.kind === 'portfolio'));
    assert.ok(
      loaded.diagnostics.some((diagnostic) => diagnostic.code === 'SKG-SCHEMA-INVALID'),
    );
    assert.equal(
      loaded.diagnostics.every(
        (diagnostic) =>
          diagnostic.code &&
          diagnostic.message &&
          diagnostic.location &&
          diagnostic.witness &&
          diagnostic.remediation,
      ),
      true,
    );
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  }
});

test('SKG-K1-CLI-01: contract capabilities for the walking skeleton are truthful', async () => {
  const { contracts } = await loadDomain();
  assert.equal(contracts.CAPABILITIES.full_json_schema_validation, true);
  assert.equal(contracts.CAPABILITIES.markdown_binding, true);
  assert.equal(contracts.CAPABILITIES.canonical_source_inventory, true);
  assert.equal(contracts.CAPABILITIES.canonical_graph_hash, true);
  assert.equal(contracts.CAPABILITIES.deterministic_budget_estimator, true);
  assert.equal(contracts.CAPABILITIES.host_portability_probe, true);
  // Explicitly still out of this slice:
  assert.equal(contracts.CAPABILITIES.typed_change_transactions, false);

  const result = runCli(['contract', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.capabilities.full_json_schema_validation, true);
  assert.equal(body.capabilities.markdown_binding, true);
  assert.equal(body.capabilities.canonical_source_inventory, true);
  assert.equal(body.capabilities.canonical_graph_hash, true);
  assert.equal(body.capabilities.deterministic_budget_estimator, true);
});

test('SKG-K1-CLI-02: K0 no longer claims schema validator debt once standalone validators exist', () => {
  const result = runCli(['check', '--stage', 'K0', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.capabilities.full_json_schema_validation, true);
  assert.equal(
    body.diagnostics.some((diagnostic) => diagnostic.code === 'SKG-SCHEMA-VALIDATOR-UNAVAILABLE'),
    false,
  );
  assert.equal(
    body.diagnostics.some((diagnostic) => diagnostic.code === 'SKG-COVERAGE-EMPTY'),
    true,
  );
});

test('SKG-K1-HASH-04: sha256 helper matches node crypto for normalized bytes', async () => {
  const { hash } = await loadDomain();
  const sample = hash.normalizeNewlines('x\r\ny');
  assert.equal(sample, 'x\ny');
  assert.equal(
    hash.sha256Hex(sample),
    crypto.createHash('sha256').update(Buffer.from(sample, 'utf8')).digest('hex'),
  );
});

test('SKG-K1-SCHEMA-02: schema fingerprint drift makes validators unavailable and --check fails', async () => {
  const { schema } = await loadDomain();
  const generatorPath = path.join(repoRoot, 'scripts/skill-knowledge/generate-validators.mjs');
  const schemaRelDir = path.join('design_docs', 'skill-knowledge-graph', 'schemas');
  const committedSchemaPath = path.join(repoRoot, schemaRelDir, 'knowledge-source.schema.json');
  const committedSchemaBytes = fs.readFileSync(committedSchemaPath);
  const manifestPath = path.join(
    repoRoot,
    'scripts/skill-knowledge/validators/schema-manifest.json',
  );
  const schemaNames = [
    'knowledge-source.schema.json',
    'knowledge-change.schema.json',
    'knowledge-cli-output.schema.json',
  ];

  assert.equal(schema.validatorsAvailable(), true);
  assert.equal(typeof schema.schemaFingerprint, 'function');
  const fingerprint = schema.schemaFingerprint(repoRoot);
  assert.equal(typeof fingerprint, 'string');
  assert.equal(fingerprint.length, 64);
  assert.equal(fs.existsSync(manifestPath), true);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.fingerprint, fingerprint);
  assert.equal(typeof manifest.schemas, 'object');

  const checkOk = spawnSync(process.execPath, [generatorPath, '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(checkOk.status, 0, checkOk.stderr || checkOk.stdout);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-k1-schema-02-'));
  try {
    const tempSchemaDir = path.join(tempRoot, schemaRelDir);
    fs.mkdirSync(tempSchemaDir, { recursive: true });
    for (const name of schemaNames) {
      fs.copyFileSync(path.join(repoRoot, schemaRelDir, name), path.join(tempSchemaDir, name));
    }

    const schemaPath = path.join(tempSchemaDir, 'knowledge-source.schema.json');
    const original = fs.readFileSync(schemaPath);
    const beforeMtime = fs.statSync(manifestPath).mtimeMs;

    // Force a real byte change even if file already ended with a single LF.
    fs.writeFileSync(schemaPath, `${original.toString('utf8')}\n`);

    assert.deepEqual(
      fs.readFileSync(committedSchemaPath),
      committedSchemaBytes,
      'checked-in schema must remain untouched during drift probe',
    );

    // Re-import is module-cached; call freshness helpers directly after byte drift.
    const drifted = await import('../../scripts/skill-knowledge/schema.mjs');
    assert.equal(drifted.schemasMatchCommittedValidators(tempRoot), false);
    assert.equal(drifted.validatorFreshness(tempRoot).available, false);

    const checkDrift = spawnSync(
      process.execPath,
      [generatorPath, '--check', '--repo-root', tempRoot],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    );
    assert.notEqual(checkDrift.status, 0, 'generate-validators --check must fail on schema drift');
    assert.equal(fs.statSync(manifestPath).mtimeMs, beforeMtime, '--check must be side-effect-free');

    const k1 = spawnSync(process.execPath, [cliPath, 'check', '--stage', 'K1', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, SKG_SCHEMA_REPO_ROOT: tempRoot },
    });
    assert.notEqual(k1.status, 0);
    const body = JSON.parse(k1.stdout);
    assert.equal(
      body.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === 'SKG-SCHEMA-VALIDATOR-UNAVAILABLE' ||
          diagnostic.code === 'SKG-SCHEMA-VALIDATOR-STALE',
      ),
      true,
    );
    assert.deepEqual(
      fs.readFileSync(committedSchemaPath),
      committedSchemaBytes,
      'checked-in schema must remain untouched after CLI drift probe',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('SKG-K1-SCHEMA-03: tampering any generated validator bundle fails closed', async () => {
  const generatorPath = path.join(repoRoot, 'scripts/skill-knowledge/generate-validators.mjs');
  const committedValidatorsDir = path.join(repoRoot, 'scripts/skill-knowledge/validators');
  const probePath = path.join(repoRoot, 'scripts/skill-knowledge/schema.mjs');
  const validDoc = readJson('valid/c1-entry-surfaces.portfolio.json');
  const bundles = ['validate-source.cjs', 'validate-change.cjs', 'validate-output.cjs'];
  const committedFiles = [...bundles, 'schema-manifest.json'];

  const baseline = spawnSync(process.execPath, [generatorPath, '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(baseline.status, 0, baseline.stderr || baseline.stdout);

  // Snapshot checked-in bytes: this probe must never mutate shared artifacts.
  const committedSnapshots = Object.fromEntries(
    committedFiles.map((name) => [
      name,
      fs.readFileSync(path.join(committedValidatorsDir, name)),
    ]),
  );
  const assertCommittedUntouched = (label) => {
    for (const name of committedFiles) {
      assert.deepEqual(
        fs.readFileSync(path.join(committedValidatorsDir, name)),
        committedSnapshots[name],
        `checked-in ${name} must remain untouched (${label})`,
      );
    }
  };

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-k1-schema-03-'));
  const validatorsDir = path.join(tempRoot, 'validators');
  try {
    fs.cpSync(committedValidatorsDir, validatorsDir, { recursive: true });
    const manifestPath = path.join(validatorsDir, 'schema-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(typeof manifest.bundles, 'object', 'manifest must record emitted bundle digests');
    for (const bundle of bundles) {
      assert.equal(
        typeof manifest.bundles?.[bundle],
        'string',
        `manifest.bundles.${bundle} must be a SHA-256 hex digest`,
      );
      assert.equal(manifest.bundles[bundle].length, 64, bundle);
    }

    for (const bundle of bundles) {
      const bundlePath = path.join(validatorsDir, bundle);
      const original = fs.readFileSync(bundlePath);
      const beforeMtime = fs.statSync(manifestPath).mtimeMs;
      // Poisoned module: if integrity does not gate require(), import/validate throws.
      const poisoned = [
        'module.exports = function poisonedValidator() {',
        "  throw new Error('TAMPERED_VALIDATOR_EXECUTED:" + bundle + "');",
        '};',
        'module.exports.errors = [];',
        '',
      ].join('\n');

      try {
        fs.writeFileSync(bundlePath, poisoned);
        assertCommittedUntouched(`after poisoning ${bundle}`);

        const checkTamper = spawnSync(
          process.execPath,
          [generatorPath, '--check', '--validators-dir', validatorsDir],
          {
            cwd: repoRoot,
            encoding: 'utf8',
          },
        );
        assert.notEqual(
          checkTamper.status,
          0,
          `generate-validators --check must fail when ${bundle} is tampered`,
        );
        assert.equal(
          fs.statSync(manifestPath).mtimeMs,
          beforeMtime,
          '--check must remain side-effect-free under bundle tamper',
        );
        assertCommittedUntouched(`after --check on tampered ${bundle}`);

        // Fresh process: prove we refuse altered code instead of requiring/executing it.
        // Injection keeps production default on the checked-in validators/ path.
        const probeScript = `
          import assert from 'node:assert/strict';
          import { createRequire } from 'node:module';
          import { pathToFileURL } from 'node:url';
          const schema = await import(${JSON.stringify(pathToFileURL(probePath).href)});
          const options = { validatorsDir: ${JSON.stringify(validatorsDir)} };
          assert.equal(schema.validatorsAvailable(options), false);
          const result = schema.validateAuthoredDocument(
            ${JSON.stringify(validDoc)},
            'source',
            options,
          );
          assert.equal(result.ok, false);
          assert.ok(Array.isArray(result.errors) && result.errors.length > 0);
          assert.equal(
            result.errors.some(
              (error) =>
                error.keyword === 'stale' ||
                error.keyword === 'unavailable' ||
                error.keyword === 'integrity',
            ),
            true,
          );
          // Altered bytes must not be loaded into the require cache.
          const require = createRequire(${JSON.stringify(probePath)});
          assert.equal(
            require.cache[${JSON.stringify(bundlePath)}] === undefined,
            true,
            'tampered bundle must not be required',
          );
        `;
        const probe = spawnSync(process.execPath, ['--input-type=module', '-e', probeScript], {
          cwd: repoRoot,
          encoding: 'utf8',
        });
        assert.equal(
          probe.status,
          0,
          `${bundle} tamper probe failed:\n${probe.stderr}\n${probe.stdout}`,
        );
        assert.equal(
          /TAMPERED_VALIDATOR_EXECUTED/.test(probe.stderr + probe.stdout),
          false,
          `tampered ${bundle} must not execute`,
        );
        assertCommittedUntouched(`after probe on tampered ${bundle}`);
      } finally {
        fs.writeFileSync(bundlePath, original);
      }
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    assertCommittedUntouched('after temp cleanup');
  }
});

test('SKG-K1-HASH-05: identity-set permutation is hash-stable; semantic order is not', async () => {
  const { hash, contracts } = await loadDomain();
  const identityFields = contracts.HARDENING_CONTRACT.C6.identity_set_fields;
  assert.ok(Array.isArray(identityFields));
  for (const field of ['skills', 'modules', 'points', 'edges', 'canonical_source_inventory']) {
    assert.equal(identityFields.includes(field), true, field);
  }

  const portfolio = readJson('valid/c1-entry-surfaces.portfolio.json');
  const skill = readJson('valid/c2-inventory.skill.json');
  const moduleDoc = readJson('valid/c3-c4-module.json');

  assert.ok((moduleDoc.points?.length ?? 0) >= 2);
  assert.ok((moduleDoc.edges?.length ?? 0) >= 2);
  assert.ok((skill.canonical_source_inventory?.length ?? 0) >= 2);
  assert.ok((moduleDoc.recognition_cues?.length ?? 0) >= 2);

  const baseInput = {
    manifests: [portfolio, skill, moduleDoc],
    span_hashes: {
      'point:verification.terminal-is-not-done': 'aa'.repeat(32),
      'point:verification.endpoint-procedure': 'bb'.repeat(32),
    },
    inventory: skill.canonical_source_inventory,
    change_head: readJson('valid/c6-change-with-result-hash.json'),
  };
  const baseline = hash.canonicalGraphHash(baseInput);

  const permuted = structuredClone(baseInput);
  permuted.manifests[2].points = [...permuted.manifests[2].points].reverse();
  permuted.manifests[2].edges = [...permuted.manifests[2].edges].reverse();
  permuted.manifests[0].skills = [...(permuted.manifests[0].skills ?? [])].reverse();
  permuted.manifests[1].modules = [...(permuted.manifests[1].modules ?? [])].reverse();
  permuted.inventory = [...permuted.inventory].reverse();
  permuted.manifests[1].canonical_source_inventory = [
    ...permuted.manifests[1].canonical_source_inventory,
  ].reverse();
  assert.equal(
    hash.canonicalGraphHash(permuted),
    baseline,
    'permuting identity-set arrays must not change canonical graph hash',
  );

  const semantic = structuredClone(baseInput);
  semantic.manifests[2].recognition_cues = [...semantic.manifests[2].recognition_cues].reverse();
  assert.notEqual(
    hash.canonicalGraphHash(semantic),
    baseline,
    'permuting semantic-order arrays must change canonical graph hash',
  );
});

test('SKG-K1-HASH-06: Unicode identity-set paths use code-point order (a.md, z.md, ä.md)', async () => {
  const { hash } = await loadDomain();
  const expectedOrder = ['a.md', 'z.md', 'ä.md'];
  assert.notDeepEqual(
    [...expectedOrder].sort((left, right) => left.localeCompare(right)),
    expectedOrder,
    'fixture requires localeCompare to disagree with Unicode code-point order',
  );
  assert.equal(typeof hash.compareCodePoint, 'function');
  assert.deepEqual([...expectedOrder].sort(hash.compareCodePoint), expectedOrder);
  assert.equal(hash.compareCodePoint('ä.md', 'z.md') > 0, true);
  assert.equal('ä.md'.localeCompare('z.md') < 0, true);

  const inventory = [
    { path: 'ä.md', coverage: 'full', point_ids: [], reviewed_unbound_sha256: '00'.repeat(32) },
    { path: 'a.md', coverage: 'full', point_ids: [], reviewed_unbound_sha256: '11'.repeat(32) },
    { path: 'z.md', coverage: 'full', point_ids: [], reviewed_unbound_sha256: '22'.repeat(32) },
  ];
  const serialized = JSON.parse(
    hash.stableSerialize({ canonical_source_inventory: inventory }),
  );
  assert.deepEqual(
    serialized.canonical_source_inventory.map((entry) => entry.path),
    expectedOrder,
    'stableSerialize identity-set inventory must sort by code point',
  );

  // Semantic-order arrays keep authored order, including Unicode strings.
  assert.deepEqual(
    JSON.parse(hash.stableSerialize({ recognition_cues: ['ä.md', 'z.md', 'a.md'] }))
      .recognition_cues,
    ['ä.md', 'z.md', 'a.md'],
  );

  const scrambled = {
    manifests: [
      { id: 'ä-manifest', kind: 'skill' },
      { id: 'a-manifest', kind: 'skill' },
      { id: 'z-manifest', kind: 'skill' },
    ],
    span_hashes: {
      'ä.md': 'aa'.repeat(32),
      'a.md': 'bb'.repeat(32),
      'z.md': 'cc'.repeat(32),
    },
    inventory,
    change_head: null,
  };
  const codePointOrdered = {
    manifests: [
      { id: 'a-manifest', kind: 'skill' },
      { id: 'z-manifest', kind: 'skill' },
      { id: 'ä-manifest', kind: 'skill' },
    ],
    span_hashes: {
      'a.md': 'bb'.repeat(32),
      'z.md': 'cc'.repeat(32),
      'ä.md': 'aa'.repeat(32),
    },
    inventory: [inventory[1], inventory[2], inventory[0]],
    change_head: null,
  };
  const localeOrdered = {
    manifests: [
      { id: 'a-manifest', kind: 'skill' },
      { id: 'ä-manifest', kind: 'skill' },
      { id: 'z-manifest', kind: 'skill' },
    ],
    span_hashes: {
      'a.md': 'bb'.repeat(32),
      'ä.md': 'aa'.repeat(32),
      'z.md': 'cc'.repeat(32),
    },
    inventory: [inventory[1], inventory[0], inventory[2]],
    change_head: null,
  };

  const scrambledHash = hash.canonicalGraphHash(scrambled);
  assert.equal(
    scrambledHash,
    hash.canonicalGraphHash(codePointOrdered),
    'canonicalGraphHash must normalize to Unicode code-point order',
  );
  assert.equal(
    scrambledHash,
    hash.canonicalGraphHash(localeOrdered),
    'locale-preordered input must still normalize to the same code-point hash',
  );

  // Golden payload mirrors canonicalGraphHash after code-point sorts (manifest ids +
  // span keys + identity-set inventory), proving the algorithm is not localeCompare.
  const goldenPayload = {
    algorithm: hash.GRAPH_HASH_ALGORITHM,
    manifests: codePointOrdered.manifests,
    span_hashes: codePointOrdered.span_hashes,
    inventory: codePointOrdered.inventory,
    change_head_digest: null,
  };
  assert.equal(hash.canonicalGraphHash(scrambled), hash.sha256Hex(hash.stableSerialize(goldenPayload)));
});

test('SKG-K1-HASH-07: numeric Unicode code-point order puts U+E000 before U+10000', async () => {
  const { hash } = await loadDomain();
  // U+E000 (BMP PUA) numeric scalar 0xE000; U+10000 (supplementary) scalar 0x10000.
  // UTF-16 code-unit order reverses them because U+10000 encodes as D800 DC00.
  const e000 = '\uE000.md';
  const u10000 = '\u{10000}.md';
  const expectedOrder = [e000, u10000];

  assert.equal(e000 < u10000, false, 'UTF-16 code-unit < must disagree with numeric code-point order');
  assert.equal(typeof hash.compareCodePoint, 'function');
  assert.equal(hash.compareCodePoint(e000, u10000) < 0, true);
  assert.equal(hash.compareCodePoint(u10000, e000) > 0, true);
  assert.equal(hash.compareCodePoint(e000, e000), 0);
  assert.deepEqual([...expectedOrder].reverse().sort(hash.compareCodePoint), expectedOrder);

  // Prefix / length ties: common code-point prefix, then shorter wins; equality is exact.
  assert.equal(hash.compareCodePoint('a', 'a.md') < 0, true);
  assert.equal(hash.compareCodePoint('a.md', 'a') > 0, true);
  assert.equal(hash.compareCodePoint('same', 'same'), 0);

  // Lone surrogates: compare by their numeric scalar (codePointAt value), advance one unit.
  const loneHigh = '\uD800';
  const loneLow = '\uDC00';
  assert.equal(hash.compareCodePoint(loneHigh, loneLow) < 0, true);
  assert.equal(hash.compareCodePoint(loneHigh, loneHigh), 0);
  assert.equal(hash.compareCodePoint(loneHigh + '.md', u10000) < 0, true);

  const inventory = [
    { path: u10000, coverage: 'full', point_ids: [], reviewed_unbound_sha256: '00'.repeat(32) },
    { path: e000, coverage: 'full', point_ids: [], reviewed_unbound_sha256: '11'.repeat(32) },
  ];
  const serialized = JSON.parse(
    hash.stableSerialize({ canonical_source_inventory: inventory }),
  );
  assert.deepEqual(
    serialized.canonical_source_inventory.map((entry) => entry.path),
    expectedOrder,
    'stableSerialize identity-set inventory must use numeric code-point path order',
  );

  // Semantic-order arrays stay authored (including supplementary-plane strings).
  assert.deepEqual(
    JSON.parse(hash.stableSerialize({ recognition_cues: [u10000, e000] })).recognition_cues,
    [u10000, e000],
  );

  const scrambled = {
    manifests: [
      { id: u10000, kind: 'skill' },
      { id: e000, kind: 'skill' },
    ],
    span_hashes: {
      [u10000]: 'aa'.repeat(32),
      [e000]: 'bb'.repeat(32),
    },
    inventory,
    change_head: null,
  };
  const codePointOrdered = {
    manifests: [
      { id: e000, kind: 'skill' },
      { id: u10000, kind: 'skill' },
    ],
    span_hashes: {
      [e000]: 'bb'.repeat(32),
      [u10000]: 'aa'.repeat(32),
    },
    inventory: [inventory[1], inventory[0]],
    change_head: null,
  };
  // UTF-16-preordered input (U+10000 before U+E000) must still normalize to numeric order.
  const utf16Ordered = {
    manifests: [
      { id: u10000, kind: 'skill' },
      { id: e000, kind: 'skill' },
    ],
    span_hashes: {
      [u10000]: 'aa'.repeat(32),
      [e000]: 'bb'.repeat(32),
    },
    inventory: [inventory[0], inventory[1]],
    change_head: null,
  };

  const scrambledHash = hash.canonicalGraphHash(scrambled);
  assert.equal(
    scrambledHash,
    hash.canonicalGraphHash(codePointOrdered),
    'canonicalGraphHash must normalize to numeric Unicode code-point order',
  );
  assert.equal(
    scrambledHash,
    hash.canonicalGraphHash(utf16Ordered),
    'UTF-16-preordered input must still normalize to the same numeric code-point hash',
  );

  const goldenPayload = {
    algorithm: hash.GRAPH_HASH_ALGORITHM,
    manifests: codePointOrdered.manifests,
    span_hashes: codePointOrdered.span_hashes,
    inventory: codePointOrdered.inventory,
    change_head_digest: null,
  };
  assert.equal(
    hash.canonicalGraphHash(scrambled),
    hash.sha256Hex(hash.stableSerialize(goldenPayload)),
  );
});

test('SKG-K1-LOADER-02: source loader documents/diagnostics use code-point path order', async () => {
  const { loader, hash } = await loadDomain();
  const expectedNames = ['a.json', 'z.json', 'ä.json'];
  assert.notDeepEqual(
    [...expectedNames].sort((left, right) => left.localeCompare(right)),
    expectedNames,
    'fixture requires localeCompare to disagree with Unicode code-point order',
  );
  assert.deepEqual([...expectedNames].sort(hash.compareCodePoint), expectedNames);

  const sourceRoot = path.join(fixturesRoot, 'loader-unicode-order');
  fs.rmSync(sourceRoot, { recursive: true, force: true });
  fs.mkdirSync(sourceRoot, { recursive: true });
  try {
    const invalid = readJson('invalid/c1-missing-surfaces.portfolio.json');
    for (const name of ['ä.json', 'a.json', 'z.json']) {
      fs.writeFileSync(path.join(sourceRoot, name), `${JSON.stringify(invalid)}\n`);
    }

    const loaded = loader.loadKnowledgeSource({ repoRoot, sourceRoot });
    assert.equal(loaded.ok, false);
    const documentNames = loaded.documents.map((document) => path.posix.basename(document.path));
    assert.deepEqual(documentNames, expectedNames);

    const schemaDiagnostics = loaded.diagnostics.filter(
      (diagnostic) => diagnostic.code === 'SKG-SCHEMA-INVALID',
    );
    assert.equal(schemaDiagnostics.length, 3);
    assert.deepEqual(
      schemaDiagnostics.map((diagnostic) => path.posix.basename(diagnostic.location)),
      expectedNames,
    );
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  }
});

test('SKG-K1-LOADER-03: loader document order uses numeric code points (U+E000 before U+10000)', async () => {
  const { loader, hash } = await loadDomain();
  const e000 = '\uE000.json';
  const u10000 = '\u{10000}.json';
  const expectedNames = [e000, u10000];

  assert.equal(e000 < u10000, false, 'UTF-16 code-unit < must disagree with numeric code-point order');
  assert.deepEqual([...expectedNames].reverse().sort(hash.compareCodePoint), expectedNames);

  const sourceRoot = path.join(fixturesRoot, 'loader-codepoint-order');
  fs.rmSync(sourceRoot, { recursive: true, force: true });
  fs.mkdirSync(sourceRoot, { recursive: true });
  try {
    const invalid = readJson('invalid/c1-missing-surfaces.portfolio.json');
    for (const name of [u10000, e000]) {
      fs.writeFileSync(path.join(sourceRoot, name), `${JSON.stringify(invalid)}\n`);
    }

    const loaded = loader.loadKnowledgeSource({ repoRoot, sourceRoot });
    assert.equal(loaded.ok, false);
    const documentNames = loaded.documents.map((document) => path.posix.basename(document.path));
    assert.deepEqual(
      documentNames,
      expectedNames,
      'loader documents must sort by numeric Unicode code-point order',
    );

    const schemaDiagnostics = loaded.diagnostics.filter(
      (diagnostic) => diagnostic.code === 'SKG-SCHEMA-INVALID',
    );
    assert.equal(schemaDiagnostics.length, 2);
    assert.deepEqual(
      schemaDiagnostics.map((diagnostic) => path.posix.basename(diagnostic.location)),
      expectedNames,
    );
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  }
});

test('SKG-K1-INVENTORY-02: unbound hash keeps EOF newline and rejects naive concat collisions', async () => {
  const { inventory, markers } = await loadDomain();

  const withEof = [
    '# Title',
    '',
    '<!-- ccm:k:start point:demo.principle -->',
    'bound',
    '<!-- ccm:k:end point:demo.principle -->',
    'tail',
    '',
  ].join('\n');
  const withoutEof = withEof.replace(/\n$/, '');
  assert.equal(withEof.endsWith('\n'), true);
  assert.equal(withoutEof.endsWith('\n'), false);

  const extractedEof = markers.extractMarkers(withEof, 'eof.md');
  const extractedNoEof = markers.extractMarkers(withoutEof, 'no-eof.md');
  assert.equal(extractedEof.ok, true);
  assert.equal(extractedNoEof.ok, true);

  const hashEof = inventory.hashUnboundRegions(withEof, extractedEof.spans);
  const hashNoEof = inventory.hashUnboundRegions(withoutEof, extractedNoEof.spans);
  assert.notEqual(
    hashEof,
    hashNoEof,
    'exact EOF newline presence must change unbound inventory hash',
  );

  // Contiguous unbound runs "ab"+"c" vs "a"+"bc" must not collide under framing.
  const left = [
    'ab',
    '<!-- ccm:k:start point:demo.principle -->',
    'x',
    '<!-- ccm:k:end point:demo.principle -->',
    'c',
  ].join('\n');
  const right = [
    'a',
    '<!-- ccm:k:start point:demo.principle -->',
    'x',
    '<!-- ccm:k:end point:demo.principle -->',
    'bc',
  ].join('\n');
  const leftExtracted = markers.extractMarkers(left, 'left.md');
  const rightExtracted = markers.extractMarkers(right, 'right.md');
  assert.equal(leftExtracted.ok, true);
  assert.equal(rightExtracted.ok, true);
  assert.notEqual(
    inventory.hashUnboundRegions(left, leftExtracted.spans),
    inventory.hashUnboundRegions(right, rightExtracted.spans),
    'unbound hashing must not collide through naive concatenation of runs',
  );
});
