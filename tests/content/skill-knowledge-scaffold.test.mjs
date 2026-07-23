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
const examplesRoot = path.join(
  repoRoot,
  'design_docs',
  'skill-knowledge-graph',
  'examples',
);
const operationTypes = [
  'add',
  'wording',
  'refine',
  'move',
  'split',
  'merge',
  'transfer_owner',
  'deprecate',
  'retire',
];

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
  assert.deepEqual(body.operations, operationTypes);
  assert.deepEqual(body.planes, [
    'structural',
    'authority',
    'navigation',
    'trigger',
    'constraint',
    'lineage',
    'projection',
  ]);
  assert.equal(body.invariants.length, 23);
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
  assert.equal(body.capabilities.entry_surface_binding, false);
  assert.equal(body.capabilities.canonical_source_inventory, false);
  assert.equal(body.capabilities.derived_freshness, false);
  assert.equal(body.capabilities.canonical_graph_hash, false);
  assert.equal(body.capabilities.deterministic_budget_estimator, false);
  assert.equal(body.capabilities.host_portability_probe, false);
  assert.equal(body.capabilities.semantic_coverage, false);
  assert.equal(body.capabilities.behavioral_evidence_tracking, false);
  assert.deepEqual(Object.keys(body.hardening_contract),
    Array.from({ length: 14 }, (_, index) => `C${index + 1}`));
  assert.deepEqual(body.hardening_contract.C5.change_workflow, ['begin', 'validate', 'apply']);
  assert.deepEqual(body.hardening_contract.C6.authored_manifest_kinds, [
    'portfolio',
    'skill',
    'module',
  ]);
  assert.deepEqual(body.hardening_contract.C6.change_head_digest_excludes, [
    'result_graph_sha256',
  ]);
  assert.deepEqual(body.hardening_contract.C9.hosts, [
    'claude-code',
    'codex',
    'cursor',
    'kimi-code',
  ]);
  assert.equal(body.hardening_contract.C14.runtime_skill_count, 8);
  assert.equal(body.hardening_contract.C14.governance_meta_skill_is_runtime, false);
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

  for (const [option, value] of [
    ['--host', 'codex'],
    ['--base', 'HEAD^'],
  ]) {
    const result = runCli(['check', option, value, '--json']);
    assert.equal(result.status, 10, `check ${option} ${value}: ${result.stdout}`);
    const body = parseJson(result);
    assert.equal(body.ok, false);
    assert.equal(body.command, 'check');
    assert.equal(body.diagnostics[0].code, 'SKG-CAPABILITY-NOT-IMPLEMENTED');
    assert.match(
      body.diagnostics[0].message,
      new RegExp(`${option.replaceAll('-', '\\-')}.*(?:unavailable|not implemented)`, 'i'),
      `check ${option} must name the unavailable option, not pretend check itself is unimplemented`,
    );
    assert.equal(body.diagnostics[0].witness.command, 'check');
    assert.equal(body.diagnostics[0].witness.option, option);
    assert.equal(body.diagnostics[0].witness.value, value);
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
  assert.equal(schema.properties.hardening_contract.$ref, '#/$defs/hardeningContract');
  assert.equal(schema.properties.result_kind.enum.includes('report'), true);
  for (const capability of [
    'entry_surface_binding',
    'canonical_source_inventory',
    'derived_freshness',
    'canonical_graph_hash',
    'deterministic_budget_estimator',
    'host_portability_probe',
    'semantic_coverage',
    'behavioral_evidence_tracking',
  ]) {
    assert.equal(schema.$defs.capabilities.required.includes(capability), true, capability);
  }
});

test('SKG-CONTRACT-03: source schema freezes C1-C4 and the four-host denominator', () => {
  const schema = JSON.parse(
    fs.readFileSync(
      path.join(
        repoRoot,
        'design_docs',
        'skill-knowledge-graph',
        'schemas',
        'knowledge-source.schema.json',
      ),
      'utf8',
    ),
  );

  assert.deepEqual(schema.$defs.knownHost.enum, [
    'claude-code',
    'codex',
    'cursor',
    'kimi-code',
  ]);
  assert.equal(schema.$defs.hostCoverage.properties.host.$ref, '#/$defs/knownHost');
  assert.equal(schema.$defs.entry.required.includes('surfaces'), true);
  assert.equal(schema.$defs.entry.properties.surfaces.minItems, 4);
  assert.equal(schema.$defs.entry.properties.surfaces.maxItems, 4);
  assert.equal(schema.$defs.entry.properties.surfaces.allOf.length, 4);
  assert.equal(schema.$defs.skill.properties.host_coverage.minItems, 4);
  assert.equal(schema.$defs.skill.properties.host_coverage.maxItems, 4);
  assert.equal(schema.$defs.skill.properties.host_coverage.allOf.length, 4);
  assert.deepEqual(schema.$defs.entrySurface.required, [
    'host',
    'source_file',
    'binding',
    'surface_kind',
    'targets',
    'lifecycle',
  ]);
  assert.deepEqual(schema.$defs.sourceInventoryEntry.properties.coverage.enum, [
    'full',
    'partial',
    'non_knowledge',
    'excluded',
  ]);
  assert.equal(
    schema.$defs.sourceInventoryEntry.required.includes('reviewed_unbound_sha256'),
    true,
  );
  assert.equal(schema.$defs.skill.required.includes('canonical_source_inventory'), true);
  assert.equal(schema.$defs.skill.required.includes('admission'), true);
  assert.deepEqual(schema.$defs.derivedAuthority.required, [
    'role',
    'subject',
    'canonical',
    'review_policy',
    'reviewed_canonical_sha256',
  ]);
});

test('SKG-CONTRACT-04: change schema freezes C5/C10 workspace and immutable chain', () => {
  const schema = JSON.parse(
    fs.readFileSync(
      path.join(
        repoRoot,
        'design_docs',
        'skill-knowledge-graph',
        'schemas',
        'knowledge-change.schema.json',
      ),
      'utf8',
    ),
  );

  assert.deepEqual(schema.oneOf.map((item) => item.$ref), [
    '#/$defs/finalChange',
    '#/$defs/changeWorkspace',
    '#/$defs/changeValidation',
  ]);
  for (const field of ['base_ref', 'parent_change', 'scope']) {
    assert.equal(schema.$defs.finalChange.required.includes(field), true, field);
  }
  assert.deepEqual(schema.$defs.changeWorkspace.properties.status.enum, [
    'begun',
    'validated',
    'applied',
  ]);
  assert.deepEqual(schema.$defs.changeValidation.required, [
    'schema_version',
    'kind',
    'change_id',
    'base_ref',
    'base_graph_sha256',
    'scope',
    'result_graph_sha256',
    'candidate_valid',
    'optimistic_lock_valid',
    'git_apply_check',
    'patch_sha256',
    'diagnostics',
  ]);
  assert.equal(schema.$defs.operation.oneOf.length, 9);
  const outputSchema = JSON.parse(
    fs.readFileSync(
      path.join(
        repoRoot,
        'design_docs',
        'skill-knowledge-graph',
        'schemas',
        'knowledge-cli-output.schema.json',
      ),
      'utf8',
    ),
  );
  assert.deepEqual(
    schema.$defs.workspaceDiagnostic.required,
    outputSchema.$defs.diagnostic.required,
    'workspace and CLI diagnostics must require the same actionable fields',
  );
  assert.equal(
    schema.$defs.workspaceDiagnostic.properties.message.$ref,
    '#/$defs/nonEmptyString',
  );

  const ignoredWorkspace = spawnSync(
    'git',
    ['check-ignore', '-q', '.skill-knowledge/workspaces/example/workspace.json'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.equal(ignoredWorkspace.status, 0, 'C5 workspace root must be ignored by Git');
});

test('SKG-EXAMPLES-01: every JSON example parses and operation fragments cover the closed set', () => {
  for (const name of fs.readdirSync(examplesRoot).filter((entry) => entry.endsWith('.json'))) {
    assert.doesNotThrow(
      () => JSON.parse(fs.readFileSync(path.join(examplesRoot, name), 'utf8')),
      name,
    );
  }

  const library = JSON.parse(
    fs.readFileSync(path.join(examplesRoot, 'operation-examples.json'), 'utf8'),
  );
  assert.equal(library.fragment_target, '#/$defs/operation');
  assert.deepEqual(Object.keys(library.operations), operationTypes);
  assert.deepEqual(
    Object.entries(library.operations).map(([key, fragment]) => {
      assert.equal(fragment.op, key);
      return fragment.op;
    }),
    operationTypes,
  );
});

test('SKG-EXAMPLES-02: change workspace, validation, and ledger identity remain lockstep', () => {
  const workspace = JSON.parse(
    fs.readFileSync(
      path.join(examplesRoot, 'endpoint-verification-split.workspace.json'),
      'utf8',
    ),
  );
  const validation = JSON.parse(
    fs.readFileSync(
      path.join(examplesRoot, 'endpoint-verification-split.validation.json'),
      'utf8',
    ),
  );
  const change = JSON.parse(
    fs.readFileSync(
      path.join(examplesRoot, 'endpoint-verification-split.change.json'),
      'utf8',
    ),
  );

  for (const document of [validation, change]) {
    assert.equal(document.change_id, workspace.change_id);
    assert.equal(document.base_ref, workspace.base_ref);
    assert.equal(document.base_graph_sha256, workspace.base_graph_sha256);
  }
  assert.equal(validation.result_graph_sha256, change.result_graph_sha256);
  assert.deepEqual(validation.scope, workspace.scope);
  assert.deepEqual(
    change.scope.map(({ path: scopePath, before_sha256: sha256 }) => ({
      path: scopePath,
      sha256,
    })),
    workspace.scope,
  );
});

test('SKG-EXAMPLES-03: K1 pilot has one admitted inventoried skill and four unique hosts', () => {
  const portfolio = JSON.parse(
    fs.readFileSync(path.join(examplesRoot, 'portfolio.json'), 'utf8'),
  );
  const skill = JSON.parse(
    fs.readFileSync(
      path.join(examplesRoot, 'master-orchestrator-guide.skill.json'),
      'utf8',
    ),
  );
  const hosts = portfolio.entries.flatMap((entry) =>
    entry.surfaces.map((surface) => surface.host));

  assert.equal(portfolio.rollout, 'K1');
  assert.equal(portfolio.skills.length, 1);
  assert.equal(new Set(portfolio.runtime_hosts).size, 4);
  assert.deepEqual(portfolio.runtime_hosts, ['claude-code', 'codex', 'cursor', 'kimi-code']);
  assert.deepEqual(hosts, portfolio.runtime_hosts);
  assert.equal(new Set(hosts).size, 4);
  assert.equal(skill.lifecycle.state, 'accepted');
  assert.ok(skill.admission.evidence.length > 0);
  assert.ok(skill.admission.verifiers.length > 0);
  assert.ok(skill.canonical_source_inventory.length > 0);
});

test('SKG-EXAMPLES-04: report golden keeps structural and behavioral evidence separate', () => {
  const report = JSON.parse(
    fs.readFileSync(path.join(examplesRoot, 'report.json'), 'utf8'),
  );
  assert.equal(report.result_kind, 'report');
  assert.equal(typeof report.structural_status.state, 'string');
  assert.equal(typeof report.behavioral_evidence_status.state, 'string');
  assert.ok(Array.isArray(report.behavioral_evidence_status.evidence));
  assert.equal(Object.hasOwn(report, 'improvement_claim'), false);
});

test('SKG-DOC-01: K0 check success sample uses the executable capability map', () => {
  const contract = parseJson(runCli(['contract', '--json']));
  const check = parseJson(runCli(['check', '--stage', 'K0', '--json']));
  const cliContract = fs.readFileSync(
    path.join(repoRoot, 'design_docs', 'skill-knowledge-graph', 'cli-contract.md'),
    'utf8',
  );
  const sample = cliContract.match(/成功报告：\s*```json\n([\s\S]*?)\n```/);
  assert.ok(sample, 'K0 success sample must remain machine-readable JSON');
  const documented = JSON.parse(sample[1]);
  assert.deepEqual(documented.capabilities, contract.capabilities);
  assert.equal(documented.summary.debts, check.summary.debts);
  assert.deepEqual(
    documented.diagnostics.map((diagnostic) => diagnostic.code).sort(),
    check.diagnostics.map((diagnostic) => diagnostic.code).sort(),
  );
});

test('SKG-CONTRACT-05: C6-C14 prose and supersession records remain explicit', () => {
  const specification = fs.readFileSync(
    path.join(repoRoot, 'design_docs', 'skill-knowledge-graph', 'specification.md'),
    'utf8',
  );
  for (let index = 1; index <= 14; index += 1) {
    assert.equal(specification.includes(`| \`C${index}\` |`), true, `C${index}`);
  }
  assert.match(specification, /ceil\(utf8_bytes \/ 3\)/);
  assert.match(specification, /change-head digest/);
  assert.match(specification, /排除自引用字段\s+`result_graph_sha256`/);
  assert.match(specification, /structural_status/);
  assert.match(specification, /behavioral_evidence_status/);
  assert.match(specification, /scripts\/sync-codex-skills\.sh/);

  for (const relative of [
    'design_docs/research/skill_knowledge_graph/00_executive_summary.md',
    'design_docs/research/skill_knowledge_graph/04_cc_master_implications.md',
  ]) {
    assert.match(
      fs.readFileSync(path.join(repoRoot, relative), 'utf8'),
      /superseded as a portfolio decision/,
      relative,
    );
  }
});

test('SKG-CI-01: required build-and-check is an aggregator over ccm and plugin contracts', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ccm-ci.yml'), 'utf8');
  assert.match(workflow, /^  ccm:/m);
  assert.match(workflow, /^  plugin-contracts:/m);
  assert.match(workflow, /^  build-and-check:/m);
  assert.match(workflow, /needs:\s*\[ccm, plugin-contracts\]/);
  assert.match(workflow, /node scripts\/skill-knowledge\.mjs check --stage K0 --json/);
});
