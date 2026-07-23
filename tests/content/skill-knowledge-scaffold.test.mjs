import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliPath = path.join(repoRoot, 'scripts', 'skill-knowledge.mjs');
const cliSchema = 'cc-master/skill-knowledge-cli/v1alpha1';

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function parseJson(result) {
  assert.equal(result.stderr, '', `expected empty stderr, got: ${result.stderr}`);
  assert.notEqual(result.stdout, '', 'expected JSON stdout');
  return JSON.parse(result.stdout);
}

function withTempSource(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-test-'));
  try {
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('SKG-CLI-01: contract exposes the frozen K0 capability and vocabulary registry', () => {
  const result = runCli(['contract', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const body = parseJson(result);

  assert.equal(body.schema, cliSchema);
  assert.equal(body.ok, true);
  assert.equal(body.command, 'contract');
  assert.equal(body.result_kind, 'contract');
  assert.equal(body.contract_version, 'v1alpha1');
  assert.deepEqual(body.implemented_commands, ['check', 'contract']);
  assert.deepEqual(body.declared_commands, [
    'change',
    'check',
    'compile',
    'contract',
    'explain',
    'path',
    'report',
  ]);
  assert.deepEqual(body.operations, [
    'add',
    'wording',
    'refine',
    'move',
    'split',
    'merge',
    'transfer_owner',
    'deprecate',
    'retire',
  ]);
  assert.deepEqual(body.planes, [
    'structural',
    'authority',
    'navigation',
    'trigger',
    'constraint',
    'lineage',
    'projection',
  ]);
  assert.equal(body.invariants.length, 16);
  assert.equal(body.exit_codes.capability_not_implemented, 10);
  assert.equal(
    body.schemas.output,
    'design_docs/skill-knowledge-graph/schemas/knowledge-cli-output.schema.json',
  );
  assert.equal(body.capabilities.source_json_parse, true);
  assert.equal(body.capabilities.source_envelope_validation, true);
  assert.equal(body.capabilities.global_id_uniqueness, true);
  assert.equal(body.capabilities.full_json_schema_validation, false);
  assert.equal(body.capabilities.graph_invariants, false);
});

test('SKG-CLI-02: K0 check reports empty inventory and unavailable validator as debt, not success theatre', () => {
  const result = runCli(['check', '--stage', 'K0', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const body = parseJson(result);

  assert.equal(body.schema, cliSchema);
  assert.equal(body.ok, true);
  assert.equal(body.command, 'check');
  assert.equal(body.result_kind, 'check');
  assert.equal(body.stage, 'K0');
  assert.equal(body.source_root, 'plugin/src/knowledge');
  assert.equal(body.summary.documents, 0);
  assert.equal(body.summary.errors, 0);
  assert.equal(body.summary.debts, 2);
  assert.deepEqual(
    body.diagnostics.map((diagnostic) => diagnostic.code).sort(),
    ['SKG-COVERAGE-EMPTY', 'SKG-SCHEMA-VALIDATOR-UNAVAILABLE'],
  );
});

test('SKG-CLI-03: malformed authored JSON fails with a stable parse diagnostic', () =>
  withTempSource((sourceRoot) => {
    fs.writeFileSync(path.join(sourceRoot, 'broken.json'), '{not-json}\n');
    const result = runCli(['check', '--source', sourceRoot, '--stage', 'K0', '--json']);
    assert.equal(result.status, 3);
    const body = parseJson(result);

    assert.equal(body.ok, false);
    assert.equal(body.summary.errors, 1);
    assert.equal(body.diagnostics[0].code, 'SKG-SOURCE-JSON-PARSE');
    assert.match(body.diagnostics[0].location, /broken\.json$/);
    assert.equal(body.diagnostics[0].severity, 'error');
    assert.equal(typeof body.diagnostics[0].witness.parse_error, 'string');
    assert.match(body.diagnostics[0].remediation, /valid JSON/i);
  }));

test('SKG-CLI-04: duplicate global ids fail at the K0 envelope boundary', () =>
  withTempSource((sourceRoot) => {
    const source = {
      schema_version: 'cc-master/skill-knowledge-source/v1alpha1',
      kind: 'module',
      id: 'module:duplicate',
    };
    fs.writeFileSync(path.join(sourceRoot, 'a.json'), `${JSON.stringify(source)}\n`);
    fs.writeFileSync(path.join(sourceRoot, 'b.json'), `${JSON.stringify(source)}\n`);
    const result = runCli(['check', '--source', sourceRoot, '--stage', 'K0', '--json']);
    assert.equal(result.status, 4);
    const body = parseJson(result);

    assert.equal(body.ok, false);
    assert.equal(body.diagnostics.at(-1).code, 'SKG-ID-DUPLICATE');
    assert.equal(body.diagnostics.at(-1).witness.id, 'module:duplicate');
    assert.equal(body.diagnostics.at(-1).witness.locations.length, 2);
  }));

test('SKG-CLI-05: K1 turns empty coverage into a hard failure', () =>
  withTempSource((sourceRoot) => {
    const result = runCli(['check', '--source', sourceRoot, '--stage', 'K1', '--json']);
    assert.equal(result.status, 4);
    const body = parseJson(result);

    assert.equal(body.ok, false);
    assert.equal(body.diagnostics[0].code, 'SKG-COVERAGE-EMPTY');
    assert.equal(body.diagnostics[0].severity, 'error');
  }));

test('SKG-CLI-06: K1 with source fails loud while full schema validation is unavailable', () =>
  withTempSource((sourceRoot) => {
    const source = {
      schema_version: 'cc-master/skill-knowledge-source/v1alpha1',
      kind: 'portfolio',
      id: 'portfolio:pilot',
    };
    fs.writeFileSync(path.join(sourceRoot, 'portfolio.json'), `${JSON.stringify(source)}\n`);
    const result = runCli(['check', '--source', sourceRoot, '--stage', 'K1', '--json']);
    assert.equal(result.status, 10);
    const body = parseJson(result);

    assert.equal(body.ok, false);
    assert.equal(
      body.diagnostics.find((diagnostic) => diagnostic.severity === 'error').code,
      'SKG-SCHEMA-VALIDATOR-UNAVAILABLE',
    );
  }));

test('SKG-CLI-07: declared but unavailable commands fail closed with exit 10', () => {
  for (const command of ['compile', 'report', 'path', 'explain', 'change']) {
    const result = runCli([command, '--json']);
    assert.equal(result.status, 10, `${command}: ${result.stderr}`);
    const body = parseJson(result);
    assert.equal(body.ok, false);
    assert.equal(body.command, command);
    assert.equal(body.diagnostics[0].code, 'SKG-CAPABILITY-NOT-IMPLEMENTED');
    assert.equal(body.diagnostics[0].witness.command, command);
  }
});

test('SKG-CLI-08: usage errors are nonzero and machine-readable', () => {
  const result = runCli(['unknown-command', '--json']);
  assert.equal(result.status, 2);
  const body = parseJson(result);
  assert.equal(body.ok, false);
  assert.equal(body.command, 'unknown-command');
  assert.equal(body.diagnostics[0].code, 'SKG-USAGE');

  const checkResult = runCli(['check', '--bogus', '--json']);
  assert.equal(checkResult.status, 2);
  const checkBody = parseJson(checkResult);
  assert.equal(checkBody.command, 'check');
  assert.equal(checkBody.result_kind, 'diagnostic');
  assert.equal(checkBody.diagnostics[0].code, 'SKG-USAGE');

  const humanCheckResult = runCli(['check', '--bogus']);
  assert.equal(humanCheckResult.status, 2);
  assert.equal(humanCheckResult.stderr, '');
  assert.match(humanCheckResult.stdout, /ERROR SKG-USAGE:/);
  assert.doesNotMatch(humanCheckResult.stdout, /SKG-INTERNAL/);

  const humanContractResult = runCli(['contract', '--bogus']);
  assert.equal(humanContractResult.status, 2);
  assert.equal(humanContractResult.stderr, '');
  assert.match(humanContractResult.stdout, /ERROR SKG-USAGE:/);
  assert.doesNotMatch(humanContractResult.stdout, /SKG-INTERNAL/);
});

test('SKG-CLI-09: envelope ids must match their kind namespace', () =>
  withTempSource((sourceRoot) => {
    const source = {
      schema_version: 'cc-master/skill-knowledge-source/v1alpha1',
      kind: 'module',
      id: 'point:not-a-module',
    };
    fs.writeFileSync(path.join(sourceRoot, 'module.json'), `${JSON.stringify(source)}\n`);
    const result = runCli(['check', '--source', sourceRoot, '--stage', 'K0', '--json']);
    assert.equal(result.status, 3);
    const body = parseJson(result);

    assert.equal(body.ok, false);
    assert.equal(body.diagnostics[0].code, 'SKG-SOURCE-ENVELOPE');
    assert.deepEqual(body.diagnostics[0].witness.invalid_fields, ['id']);
  }));

test('SKG-CONTRACT-01: source-root and normative schema assets exist and parse', () => {
  assert.equal(
    fs.existsSync(path.join(repoRoot, 'plugin', 'src', 'knowledge', 'CONTRACT.md')),
    true,
  );
  for (const name of [
    'knowledge-source.schema.json',
    'knowledge-change.schema.json',
    'knowledge-cli-output.schema.json',
  ]) {
    const schemaPath = path.join(
      repoRoot,
      'design_docs',
      'skill-knowledge-graph',
      'schemas',
      name,
    );
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(schemaPath, 'utf8')), name);
  }
});

test('SKG-CONTRACT-02: CLI output schema requires actionable diagnostics', () => {
  const schemaPath = path.join(
    repoRoot,
    'design_docs',
    'skill-knowledge-graph',
    'schemas',
    'knowledge-cli-output.schema.json',
  );
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  assert.equal(
    schema.$id,
    'https://cc-master.dev/schemas/skill-knowledge-cli-output-v1alpha1.json',
  );
  assert.deepEqual(schema.$defs.diagnostic.required, [
    'severity',
    'code',
    'message',
    'location',
    'witness',
    'remediation',
  ]);
});

test('SKG-CI-01: required build-and-check is an aggregator over ccm and plugin contracts', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ccm-ci.yml'), 'utf8');
  assert.match(workflow, /^  ccm:/m);
  assert.match(workflow, /^  plugin-contracts:/m);
  assert.match(workflow, /^  build-and-check:/m);
  assert.match(workflow, /needs:\s*\[ccm, plugin-contracts\]/);
  assert.match(workflow, /node scripts\/skill-knowledge\.mjs check --stage K0 --json/);
});
