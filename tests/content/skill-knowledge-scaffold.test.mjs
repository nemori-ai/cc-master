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
  assert.deepEqual(body.implemented_commands, [
    'change',
    'check',
    'compile',
    'contract',
    'explain',
    'path',
    'report',
  ]);
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
  assert.equal(body.capabilities.full_json_schema_validation, true);
  assert.equal(body.capabilities.markdown_binding, true);
  assert.equal(body.capabilities.graph_invariants, true);
  assert.equal(body.capabilities.entry_surface_binding, true);
  assert.equal(body.capabilities.canonical_source_inventory, true);
  assert.equal(body.capabilities.derived_freshness, true);
  assert.equal(body.capabilities.canonical_graph_hash, true);
  assert.equal(body.capabilities.deterministic_budget_estimator, true);
  assert.equal(body.capabilities.host_portability_probe, true);
  assert.equal(body.capabilities.semantic_coverage, true);
  assert.equal(body.capabilities.behavioral_evidence_tracking, true);
  assert.equal(body.capabilities.hop_analysis, true);
  assert.equal(body.capabilities.runtime_projection, true);
  assert.equal(body.capabilities.typed_change_transactions, true);
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
  assert.ok(body.hardening_contract.C6.identity_set_fields.includes('points'));
  assert.ok(body.hardening_contract.C6.identity_set_fields.includes('canonical_source_inventory'));
  assert.ok(body.hardening_contract.C6.semantic_order_fields.includes('operations'));
  assert.ok(body.hardening_contract.C6.semantic_order_fields.includes('recognition_cues'));
  assert.deepEqual(body.hardening_contract.C9.hosts, [
    'claude-code',
    'codex',
    'cursor',
    'kimi-code',
  ]);
  assert.deepEqual(body.hardening_contract.C9.worker_allowlist, ['codex', 'cursor']);
  assert.deepEqual(body.hardening_contract.C9.payload_modes, [
    'canonical',
    'partial',
    'stub',
  ]);
  assert.equal(body.hardening_contract.C9.anchor_form, 'explicit-html-id');
  assert.equal(body.hardening_contract.C9.path_policy, 'relative-final-host-path');
  assert.equal(body.hardening_contract.C14.runtime_skill_count, 8);
  assert.equal(body.hardening_contract.C14.governance_meta_skill_is_runtime, false);
});

test('SKG-CLI-02: K0 check reads the admitted full-portfolio inventory without coverage-empty debt', () => {
  const result = runCli(['check', '--stage', 'K0', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const body = parseJson(result);

  assert.equal(body.schema, cliSchema);
  assert.equal(body.ok, true);
  assert.equal(body.command, 'check');
  assert.equal(body.result_kind, 'check');
  assert.equal(body.stage, 'K0');
  assert.equal(body.source_root, 'plugin/src/knowledge');
  assert.ok(body.summary.documents >= 50, `expected full-portfolio documents, got ${body.summary.documents}`);
  assert.equal(body.summary.portfolio, 1);
  assert.equal(body.summary.skill, 8);
  assert.ok(body.summary.module >= 40, `expected full-portfolio modules, got ${body.summary.module}`);
  assert.equal(body.summary.errors, 0);
  assert.equal(body.summary.debts, 0);
  assert.equal(body.capabilities.full_json_schema_validation, true);
  assert.equal(
    body.diagnostics.some((diagnostic) => diagnostic.code === 'SKG-COVERAGE-EMPTY'),
    false,
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

test('SKG-CLI-06: K1 with envelope-only source fails full schema validation loudly', () =>
  withTempSource((sourceRoot) => {
    const source = {
      schema_version: 'cc-master/skill-knowledge-source/v1alpha1',
      kind: 'portfolio',
      id: 'portfolio:pilot',
    };
    fs.writeFileSync(path.join(sourceRoot, 'portfolio.json'), `${JSON.stringify(source)}\n`);
    const result = runCli(['check', '--source', sourceRoot, '--stage', 'K1', '--json']);
    assert.equal(result.status, 3);
    const body = parseJson(result);

    assert.equal(body.ok, false);
    assert.equal(
      body.diagnostics.find((diagnostic) => diagnostic.severity === 'error').code,
      'SKG-SCHEMA-INVALID',
    );
  }));

test('SKG-CLI-07: only undelivered check/report options fail closed with exit 10', () => {
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

  const reportHost = runCli(['report', '--host', 'codex', '--json']);
  assert.equal(reportHost.status, 10, `report --host: ${reportHost.stdout}`);
  const reportBody = parseJson(reportHost);
  assert.equal(reportBody.ok, false);
  assert.equal(reportBody.diagnostics[0].code, 'SKG-CAPABILITY-NOT-IMPLEMENTED');
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
    'candidate_runtime_valid',
    'optimistic_lock_valid',
    'git_apply_check',
    'patch_sha256',
    'host_projection_witnesses',
    'diagnostics',
  ]);
  const witnessArray = schema.$defs.changeValidation.properties.host_projection_witnesses;
  assert.equal(witnessArray.prefixItems.length, 4);
  assert.equal(witnessArray.items, false);
  assert.equal(witnessArray.prefixItems[0].allOf[1].properties.host.const, 'claude-code');
  assert.equal(witnessArray.prefixItems[3].allOf[1].properties.host.const, 'kimi-code');
  const witnessModeBranches = schema.$defs.hostProjectionWitness.allOf;
  assert.equal(
    witnessModeBranches.length,
    3,
    'stub/unsupported + ok full/partial + failed full/partial mode branches',
  );
  assert.deepEqual(witnessModeBranches[0].if.properties.mode.enum, ['stub', 'unsupported']);
  assert.equal(witnessModeBranches[0].then.properties.final_surface_snapshot, false);
  assert.deepEqual(witnessModeBranches[1].if.properties.mode.enum, ['full', 'partial']);
  assert.equal(witnessModeBranches[1].if.properties.ok.const, true);
  assert.ok(witnessModeBranches[1].then.required.includes('final_surface_snapshot'));
  assert.deepEqual(witnessModeBranches[2].if.properties.mode.enum, ['full', 'partial']);
  assert.equal(witnessModeBranches[2].if.properties.ok.const, false);
  assert.equal(witnessModeBranches[2].then.properties.final_surface_snapshot, false);
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

test('SKG-EXAMPLES-03: K1 pilot has one admitted skill, three modules, and four unique hosts', () => {
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
  assert.equal(skill.modules.length, 3);
  assert.equal(new Set(portfolio.runtime_hosts).size, 4);
  assert.deepEqual(portfolio.runtime_hosts, ['claude-code', 'codex', 'cursor', 'kimi-code']);
  assert.deepEqual(hosts, portfolio.runtime_hosts);
  assert.equal(new Set(hosts).size, 4);
  assert.equal(skill.lifecycle.state, 'accepted');
  assert.ok(skill.admission.evidence.length > 0);
  assert.ok(skill.admission.verifiers.length > 0);
  assert.ok(skill.canonical_source_inventory.length >= 14);
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
  const sample = cliContract.match(/成功报告[^\n]*：\s*```json\n([\s\S]*?)\n```/);
  assert.ok(sample, 'K0 success sample must remain machine-readable JSON');
  const documented = JSON.parse(sample[1]);
  assert.deepEqual(documented.capabilities, contract.capabilities);
  assert.equal(documented.summary.debts, check.summary.debts);
  assert.deepEqual(
    documented.diagnostics.map((diagnostic) => diagnostic.code).sort(),
    check.diagnostics.map((diagnostic) => diagnostic.code).sort(),
  );
});

test('SKG-DOC-02: knowledge CONTRACT, examples README, design docs, and plugin/src/AGENTS stay truthful about K2', () => {
  const knowledgeContract = fs.readFileSync(
    path.join(repoRoot, 'plugin', 'src', 'knowledge', 'CONTRACT.md'),
    'utf8',
  );
  const examplesReadme = fs.readFileSync(path.join(examplesRoot, 'README.md'), 'utf8');
  const designReadme = fs.readFileSync(
    path.join(repoRoot, 'design_docs', 'skill-knowledge-graph', 'README.md'),
    'utf8',
  );
  const cliContract = fs.readFileSync(
    path.join(repoRoot, 'design_docs', 'skill-knowledge-graph', 'cli-contract.md'),
    'utf8',
  );
  const pluginSrcAgents = fs.readFileSync(
    path.join(repoRoot, 'plugin', 'src', 'AGENTS.md'),
    'utf8',
  );

  assert.match(
    knowledgeContract,
    /\bK2\b/,
    'knowledge CONTRACT must state current maturity is K2',
  );
  assert.match(
    knowledgeContract,
    /eight\s+runtime\s+skills|8\s+runtime\s+skills|full\s+portfolio/i,
    'knowledge CONTRACT must state eight-skill full portfolio inventory',
  );

  // Host portability: four-host fixture probe is delivered (capability=true); check --host CLI is not.
  assert.doesNotMatch(
    knowledgeContract,
    /host\s+portability\s+probe\s+仍未实现/i,
    'must not claim the four-host fixture probe itself is unimplemented',
  );
  assert.match(
    knowledgeContract,
    /host_portability_probe[\s\S]{0,160}true|capability\s*=\s*true[\s\S]{0,160}host|四\s*host[\s\S]{0,120}(fixture\s+)?probe[\s\S]{0,80}(已|true)/i,
    'must state four-host fixture probe / host_portability_probe=true is delivered',
  );
  assert.match(
    knowledgeContract,
    /(--host|check\s+--host)[\s\S]{0,120}(exit\s*10|仍未|尚未|未接通|未接线|not\s+yet|not\s+wired)/i,
    'must keep the undelivered fact: check --host CLI integration still exit 10',
  );

  // Standalone Draft 2020-12 validators (three bundles) are delivered; forbid stale "not yet" claims.
  assert.doesNotMatch(
    examplesReadme,
    /`?full_json_schema_validation`?\s*仍未实现/i,
    'must not claim full_json_schema_validation is still unimplemented',
  );
  assert.doesNotMatch(
    examplesReadme,
    /未来\s*full\s+validator\s*交付/i,
    'must not treat standalone Draft 2020-12 validators as future-only delivery',
  );
  assert.match(
    examplesReadme,
    /standalone\s+Draft\s+2020-12\s+validator|full_json_schema_validation[\s\S]{0,80}true|三份\s*(emitted\s+)?CJS\s+bundle|validators?\s+(已|already)/i,
    'must acknowledge standalone Draft 2020-12 validators / three bundles are landed',
  );

  // design_docs README: current maturity is K2 full portfolio with real inventory + delivered query surface.
  assert.match(designReadme, /\bK2\b/, 'README must state current maturity is K2');
  assert.match(
    designReadme,
    /8\s+(admitted\s+)?runtime\s+skills?|eight\s+runtime\s+skills?|full\s+portfolio\s+inventory/i,
    'README must state real inventory is eight runtime skills / full portfolio',
  );
  assert.doesNotMatch(
    designReadme,
    /当前是\s*\*\*K1\s+pilot\*\*|已落真实 inventory[：:]\s*\*\*1\*\*\s+admitted skill|3\s+modules?\s*\/\s*9\s+points?/i,
    'README must not keep the retired K1 pilot inventory claim as current truth',
  );
  for (const command of ['change', 'check', 'contract', 'compile', 'report', 'path', 'explain']) {
    assert.match(
      designReadme,
      new RegExp(`\`${command}\`|\\b${command}\\b`, 'i'),
      `README must mention implemented command ${command}`,
    );
  }
  assert.match(
    designReadme,
    /(check|contract|compile|change|report|path|explain)[\s\S]{0,220}(已实现|implemented)/i,
    'README must state check/contract/compile/change/report/path/explain are implemented',
  );
  assert.match(
    designReadme,
    /typed\s+change\s+transactions[\s\S]{0,180}(已交付|implemented|begin\s*→\s*validate\s*→\s*apply)/i,
    'README must state typed change transactions are implemented rather than declared unavailable',
  );
  assert.match(
    designReadme,
    /runtime_projection[\s\S]{0,40}true|compile[\s\S]{0,80}(已实现|implemented)/i,
    'README must state runtime_projection/compile is delivered',
  );
  assert.doesNotMatch(
    designReadme,
    /`?compile`?[\s\S]{0,80}`?change`?[\s\S]{0,80}exit\s*10/,
    'must not keep compile bundled with change as exit 10',
  );
  assert.doesNotMatch(
    designReadme,
    /`?change`?[\s\S]{0,40}exit\s*10/i,
    'must not keep change itself as exit 10 after typed transactions landed',
  );
  assert.doesNotMatch(
    designReadme,
    /`?compile`?[\s\S]{0,40}exit\s*10/i,
    'must not keep compile itself as exit 10 after runtime projection landed',
  );
  assert.match(
    designReadme,
    /(check\s+--host|--host|--base)[\s\S]{0,160}exit\s*10/i,
    'README must keep check --host/--base as exit 10',
  );
  assert.match(
    designReadme,
    /report\s+--host[\s\S]{0,120}exit\s*10/i,
    'README must keep report --host as exit 10',
  );
  assert.match(
    designReadme,
    /四\s*host[\s\S]{0,120}(fixture\s+)?probe[\s\S]{0,120}(已|交付|landed|delivered)/i,
    'README must state four-host fixture probe is delivered',
  );
  assert.match(
    designReadme,
    /(不等于|≠|not\s+(equal|the\s+same|equivalent)|probe[\s\S]{0,80}≠)[\s\S]{0,120}(CLI|check\s+--host|host\s+integration)/i,
    'README must distinguish fixture probe from CLI host integration',
  );
  assert.match(
    designReadme,
    /standalone\s+(Draft\s+2020-12\s+)?validators?|Draft\s+2020-12\s+validators?/i,
    'README must acknowledge standalone validators are delivered',
  );
  assert.match(
    designReadme,
    /Markdown\s+binding|markdown_binding/i,
    'README must acknowledge Markdown binding is delivered',
  );
  assert.match(
    designReadme,
    /graph\s+invariants?|graph_invariants/i,
    'README must acknowledge graph invariants are delivered',
  );
  assert.match(
    designReadme,
    /(authored[\s-]+plane\s+)?hop\s+analysis|hop_analysis/i,
    'README must acknowledge authored hop analysis is delivered',
  );
  // Forbid stale K0 maturity claims that contradict the admitted pilot.
  assert.doesNotMatch(
    designReadme,
    /当前完成\s+\*\*K0\s+executable\s+outer\s+contract\*\*/i,
    'must not present K0 outer contract as current maturity',
  );
  assert.doesNotMatch(
    designReadme,
    /inventory\s+有意为空|为空并报告\s*debt/i,
    'must not claim inventory is intentionally empty',
  );
  assert.doesNotMatch(
    designReadme,
    /未实现的\s*`?compile\/report\/path\/explain`?/i,
    'must not claim report/path/explain are still unimplemented',
  );
  assert.doesNotMatch(
    designReadme,
    /真实\s+pilot\s+inventory[\s\S]{0,80}仍属于\s*K1\+|完整\s+JSON\s+Schema[\s\S]{0,80}仍属于\s*K1\+/i,
    'must not list delivered validators/pilot inventory as future-only K1+ work',
  );

  // cli-contract unavailable sample must mirror live K1 pilot wording (exit/capability unchanged).
  const unavailableSample = cliContract.match(
    /失败也使用同一\s*envelope：\s*```json\n([\s\S]*?)\n```/,
  );
  assert.ok(unavailableSample, 'cli-contract must keep a machine-readable unavailable envelope sample');
  const documentedFailure = JSON.parse(unavailableSample[1]);
  assert.equal(documentedFailure.diagnostics[0].code, 'SKG-CAPABILITY-NOT-IMPLEMENTED');
  assert.match(
    documentedFailure.diagnostics[0].message,
    /\bK1\b/,
    'unavailable sample message must say K1, not stale K0',
  );
  assert.doesNotMatch(
    documentedFailure.diagnostics[0].message,
    /\bK0\b/,
    'unavailable sample message must not say K0',
  );
  assert.equal(
    documentedFailure.diagnostics[0].witness.stage,
    'K1',
    'unavailable sample witness.stage must be K1',
  );

  // plugin/src/AGENTS.md: directory nav + maintainer discipline only (no runtime methodology dump).
  assert.doesNotMatch(
    pluginSrcAgents,
    /当前\s*K0\s*只落\s*CONTRACT\s*骨架/i,
    'plugin/src/AGENTS.md must not claim knowledge/ is still K0 CONTRACT-only skeleton',
  );
  assert.doesNotMatch(
    pluginSrcAgents,
    /只允许\s*K0\s*`?check`?/i,
    'plugin/src/AGENTS.md must not claim only K0 check is allowed',
  );
  assert.doesNotMatch(
    pluginSrcAgents,
    /不代表\s*inventory\/coverage\s*已完成|inventory\s+有意为空|为空\s*inventory/i,
    'plugin/src/AGENTS.md must not claim inventory is incomplete or intentionally empty',
  );
  assert.match(
    pluginSrcAgents,
    /\bK2\b/,
    'plugin/src/AGENTS.md must state current knowledge maturity is K2',
  );
  assert.match(
    pluginSrcAgents,
    /8\s+runtime\s+skills?|full\s+portfolio\s+inventory/i,
    'plugin/src/AGENTS.md must state authored inventory is eight runtime skills / full portfolio',
  );
  assert.doesNotMatch(
    pluginSrcAgents,
    /K1\s+pilot\s+已落\s*3\s+modules?[\s\/,与和]+9\s+points?/i,
    'plugin/src/AGENTS.md must not keep the retired K1 pilot inventory claim',
  );
  for (const command of ['change', 'check', 'compile', 'contract', 'explain', 'path', 'report']) {
    assert.match(
      pluginSrcAgents,
      new RegExp(`\`${command}\`|\\b${command}\\b`, 'i'),
      `plugin/src/AGENTS.md must mention implemented command ${command}`,
    );
  }
  assert.match(
    pluginSrcAgents,
    /(change|check|compile|contract|explain|path|report)[\s\S]{0,220}(已实现|implemented)/i,
    'plugin/src/AGENTS.md must state change/check/compile/contract/explain/path/report are implemented',
  );
  assert.doesNotMatch(
    pluginSrcAgents,
    /`?compile`?[\s\S]{0,40}exit\s*10/i,
    'plugin/src/AGENTS.md must not keep compile as exit 10',
  );
  assert.doesNotMatch(
    pluginSrcAgents,
    /`?change`?[\s\S]{0,40}exit\s*10/i,
    'plugin/src/AGENTS.md must not keep change as exit 10',
  );
  assert.match(
    pluginSrcAgents,
    /(check\s+--host|--host|--base)[\s\S]{0,160}exit\s*10/i,
    'plugin/src/AGENTS.md must keep check --host/--base as exit 10',
  );
  assert.match(
    pluginSrcAgents,
    /report\s+--host[\s\S]{0,120}exit\s*10/i,
    'plugin/src/AGENTS.md must keep report --host as exit 10',
  );
  assert.match(
    pluginSrcAgents,
    /四\s*host[\s\S]{0,120}(fixture\s+)?probe[\s\S]{0,120}(已|交付|landed|delivered)/i,
    'plugin/src/AGENTS.md must state four-host fixture probe is delivered',
  );
  assert.match(
    pluginSrcAgents,
    /(不等于|≠|not\s+(equal|the\s+same|equivalent)|probe[\s\S]{0,80}≠)[\s\S]{0,120}(CLI|check\s+--host|host\s+integration)/i,
    'plugin/src/AGENTS.md must distinguish fixture probe from CLI host integration',
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
