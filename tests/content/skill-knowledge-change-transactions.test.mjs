import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const transactionModule = '../../scripts/skill-knowledge/transactions.mjs';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stderr}`);
}

function evidence(ref) {
  return {
    evidence: [{ kind: 'design', ref }],
    verifiers: [{ kind: 'golden', ref: `${ref}-golden` }],
  };
}

function lifecycle(state = 'accepted', replacement) {
  return {
    state,
    since: '2026-07-23',
    ...(replacement ? { replacement } : {}),
    ...(state === 'accepted' ? {} : { rationale: `${state} through typed transaction` }),
  };
}

function point(id, subject, marker = id) {
  return {
    id,
    title: id,
    point_kind: 'principle',
    summary: `${id} summary`,
    recognition_cues: [`recognize ${id}`],
    binding: { path: 'plugin/src/skills/demo/canonical/SKILL.md', marker },
    authority: { role: 'canonical', subject },
    lifecycle: lifecycle(),
    admission: evidence(id),
  };
}

function moduleDoc(id, owner, points, edges = []) {
  return {
    schema_version: 'cc-master/skill-knowledge-source/v1alpha1',
    kind: 'module',
    id,
    owner_skill: owner,
    title: id,
    intent: `${id} intent`,
    recognition_cues: [`recognize ${id}`],
    boundary: { includes: [`${id} include`], excludes: [`${id} exclude`] },
    access: { class: 'on_demand', relevant_entries: [], primary_points: [], rationale: 'test' },
    lifecycle: lifecycle(),
    admission: evidence(id),
    points,
    edges,
  };
}

function skillDoc(id, moduleIds) {
  return {
    schema_version: 'cc-master/skill-knowledge-source/v1alpha1',
    kind: 'skill',
    id,
    name: id.replace('skill:', ''),
    package_root: `plugin/src/skills/${id.replace('skill:', '')}`,
    intent: `${id} intent`,
    modules: moduleIds.map((moduleId) => ({
      id: moduleId,
      manifest: `plugin/src/knowledge/skills/${id.replace('skill:', '')}/modules/${moduleId.replace('module:', '')}.json`,
    })),
    entry_modules: [moduleIds[0]],
    canonical_source_inventory: [
      {
        path: 'plugin/src/skills/demo/canonical/SKILL.md',
        coverage: 'non_knowledge',
        point_ids: [],
        reviewed_unbound_sha256: '0'.repeat(64),
        review: { reviewer: 'test', rationale: 'transaction fixture uses point bindings directly' },
      },
    ],
    host_coverage: ['claude-code', 'codex', 'cursor', 'kimi-code'].map((host) => ({ host, state: 'full' })),
    lifecycle: lifecycle(),
    admission: evidence(id),
  };
}

function writeJson(root, relative, value) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skg-change-'));
  const moduleOnePath = 'plugin/src/knowledge/skills/demo/modules/one.json';
  const moduleTwoPath = 'plugin/src/knowledge/skills/demo/modules/two.json';
  const skillPath = 'plugin/src/knowledge/skills/demo/skill.json';
  const otherSkillPath = 'plugin/src/knowledge/skills/other/skill.json';
  const markdownPath = 'plugin/src/skills/demo/canonical/SKILL.md';
  const one = point('point:demo.one', 'subject:demo.one');
  const two = point('point:demo.two', 'subject:demo.two');
  writeJson(root, 'plugin/src/knowledge/portfolio.json', {
    schema_version: 'cc-master/skill-knowledge-source/v1alpha1', kind: 'portfolio',
    id: 'portfolio:demo', runtime_hosts: ['claude-code', 'codex', 'cursor', 'kimi-code'],
    skills: [
      { id: 'skill:demo', manifest: skillPath },
      { id: 'skill:other', manifest: otherSkillPath },
    ], entries: [{
      id: 'entry:demo', label: 'demo entry', recognition_cues: ['demo'], lifecycle: lifecycle(), admission: evidence('entry:demo'),
      surfaces: ['claude-code', 'codex', 'cursor', 'kimi-code'].map((host) => ({
        host, source_file: 'plugin/src/skills/demo/canonical/SKILL.md', binding: { kind: 'marker', value: 'entry:demo' }, surface_kind: 'skill_entry',
        targets: [{ skill: 'skill:demo', module: 'module:demo.one', point: 'point:demo.one' }], lifecycle: lifecycle(),
      })),
    }],
    hop_policy: { point_diameter_max: 3, entry_discovery_max: 3, critical_entry_to_primary_max: 1, critical_any_point_to_primary_max: 2, primary_entry_to_primary_max: 2 },
    critical_pin_budget: { max_modules: 2, max_fraction: 1 },
    router_budget: { atlas_max_lines: 120, atlas_max_tokens: 1800, module_max_lines: 80, module_max_tokens: 1200, point_nav_max_lines: 4 }, rollout: 'K1',
  });
  writeJson(root, skillPath, skillDoc('skill:demo', ['module:demo.one', 'module:demo.two']));
  writeJson(root, otherSkillPath, skillDoc('skill:other', ['module:demo.other']));
  writeJson(root, moduleOnePath, moduleDoc('module:demo.one', 'skill:demo', [one, two], [{
    id: 'edge:demo.one-to-two', type: 'next', from: one.id, to: two.id, when: ['next'], path_role: 'next', runtime: { enabled_by_default: true }, lifecycle: lifecycle(), admission: evidence('edge:demo.one-to-two'),
  }]));
  writeJson(root, moduleTwoPath, moduleDoc('module:demo.two', 'skill:demo', [point('point:demo.three', 'subject:demo.three')]));
  writeJson(root, 'plugin/src/knowledge/skills/other/modules/demo.other.json', moduleDoc('module:demo.other', 'skill:other', [point('point:demo.other', 'subject:demo.other')]));
  fs.mkdirSync(path.join(root, path.dirname(markdownPath)), { recursive: true });
  fs.writeFileSync(path.join(root, markdownPath), [
    '<!-- ccm:k:start point:demo.one -->', 'one', '<!-- ccm:k:end point:demo.one -->',
    '<!-- ccm:k:start point:demo.two -->', 'two', '<!-- ccm:k:end point:demo.two -->',
    '<!-- ccm:k:start point:demo.three -->', 'three', '<!-- ccm:k:end point:demo.three -->',
    '<!-- ccm:k:start point:demo.other -->', 'other', '<!-- ccm:k:end point:demo.other -->', '',
  ].join('\n'));
  run('git', ['init', '-q'], root);
  run('git', ['config', 'user.email', 'skg@example.test'], root);
  run('git', ['config', 'user.name', 'SKG Test'], root);
  run('git', ['add', '.'], root);
  run('git', ['commit', '-qm', 'base'], root);
  return { root, moduleOnePath, moduleTwoPath, skillPath, otherSkillPath, markdownPath };
}

function candidateJson(workspace, relative) {
  return path.join(workspace, 'candidate', relative);
}

function writeDraft(workspace, operation) {
  const metadata = JSON.parse(fs.readFileSync(path.join(workspace, 'workspace.json'), 'utf8'));
  fs.writeFileSync(path.join(workspace, 'change.draft.json'), `${JSON.stringify({
    schema_version: 'cc-master/skill-knowledge-change/v1alpha1', kind: 'change',
    change_id: metadata.change_id, base_ref: metadata.base_ref,
    base_graph_sha256: metadata.base_graph_sha256, parent_change: null,
    reason: 'focused transaction test', operations: [operation],
    evidence: [{ kind: 'test', ref: 'skill-knowledge-change-transactions.test.mjs' }],
    expected_effects: { identity_delta: 0, canonical_subject_delta: 0, max_hop_regression_allowed: 0, coverage_debt_allowed: false },
  }, null, 2)}\n`);
}

function editModule(workspace, relative, edit) {
  const target = candidateJson(workspace, relative);
  const document = JSON.parse(fs.readFileSync(target, 'utf8'));
  edit(document);
  fs.writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
}

const cases = {
  add({ workspace, files }) {
    editModule(workspace, files.moduleOnePath, (document) => document.points.push(point('point:demo.added', 'subject:demo.added')));
    const markdown = candidateJson(workspace, files.markdownPath);
    fs.appendFileSync(markdown, '<!-- ccm:k:start point:demo.added -->\nadded\n<!-- ccm:k:end point:demo.added -->\n');
    writeDraft(workspace, { op: 'add', entities: ['point:demo.added'], rationale: 'new identity' });
  },
  wording({ workspace, files }) {
    const markdown = candidateJson(workspace, files.markdownPath);
    fs.writeFileSync(markdown, fs.readFileSync(markdown, 'utf8').replace('\none\n', '\none revised\n'));
    const digest = (text) => crypto.createHash('sha256').update(text).digest('hex');
    writeDraft(workspace, { op: 'wording', subject: 'point:demo.one', binding: { path: files.markdownPath, marker: 'point:demo.one' }, before_sha256: digest('one\n'), after_sha256: digest('one revised\n'), rationale: 'wording only' });
  },
  refine({ workspace, files }) {
    editModule(workspace, files.moduleOnePath, (document) => { document.points[0].summary = 'refined summary'; });
    writeDraft(workspace, { op: 'refine', subject: 'point:demo.one', changed_fields: ['summary'], rationale: 'clarify' });
  },
  move({ workspace, files }) {
    let moved;
    editModule(workspace, files.moduleOnePath, (document) => { [moved] = document.points.splice(0, 1); document.edges = []; });
    editModule(workspace, files.moduleTwoPath, (document) => document.points.push(moved));
    writeDraft(workspace, { op: 'move', subject: 'point:demo.one', from: { module: 'module:demo.one' }, to: { module: 'module:demo.two' }, edge_rewrites: [{ action: 'remove', edge: 'edge:demo.one-to-two' }], rationale: 'move point' });
  },
  split({ workspace, files }) {
    editModule(workspace, files.moduleOnePath, (document) => {
      document.points[0].lifecycle = lifecycle('retired');
      document.points.push(point('point:demo.split-a', 'subject:demo.split-a'), point('point:demo.split-b', 'subject:demo.split-b'));
    });
    const markdown = candidateJson(workspace, files.markdownPath);
    fs.appendFileSync(markdown, '<!-- ccm:k:start point:demo.split-a -->\nsplit a\n<!-- ccm:k:end point:demo.split-a -->\n<!-- ccm:k:start point:demo.split-b -->\nsplit b\n<!-- ccm:k:end point:demo.split-b -->\n');
    writeDraft(workspace, { op: 'split', subject: 'point:demo.one', results: ['point:demo.split-a', 'point:demo.split-b'], edge_rewrites: [], rationale: 'separate concerns' });
  },
  merge({ workspace, files }) {
    editModule(workspace, files.moduleOnePath, (document) => {
      document.points[0].lifecycle = lifecycle('retired'); document.points[1].lifecycle = lifecycle('retired');
      document.points.push(point('point:demo.merged', 'subject:demo.merged'));
    });
    const markdown = candidateJson(workspace, files.markdownPath);
    fs.appendFileSync(markdown, '<!-- ccm:k:start point:demo.merged -->\nmerged\n<!-- ccm:k:end point:demo.merged -->\n');
    writeDraft(workspace, { op: 'merge', subjects: ['point:demo.one', 'point:demo.two'], result: 'point:demo.merged', edge_rewrites: [], rationale: 'one canonical concept' });
  },
  transfer_owner({ workspace, files }) {
    editModule(workspace, files.moduleTwoPath, (document) => { document.owner_skill = 'skill:other'; });
    editModule(workspace, files.skillPath, (document) => { document.modules = document.modules.filter((item) => item.id !== 'module:demo.two'); });
    editModule(workspace, files.otherSkillPath, (document) => document.modules.push({ id: 'module:demo.two', manifest: files.moduleTwoPath }));
    writeDraft(workspace, { op: 'transfer_owner', subject: 'module:demo.two', from_skill: 'skill:demo', to_skill: 'skill:other', edge_rewrites: [], rationale: 'responsibility moved' });
  },
  deprecate({ workspace, files }) {
    editModule(workspace, files.moduleOnePath, (document) => { document.points[0].lifecycle = lifecycle('deprecated', 'point:demo.two'); });
    writeDraft(workspace, { op: 'deprecate', subjects: ['point:demo.one'], replacement: 'point:demo.two', edge_rewrites: [], rationale: 'successor exists' });
  },
  retire({ workspace, files }) {
    editModule(workspace, files.moduleOnePath, (document) => { document.points[0].lifecycle = lifecycle('retired', 'point:demo.two'); });
    writeDraft(workspace, { op: 'retire', subjects: ['point:demo.one'], replacement: 'point:demo.two', edge_rewrites: [], rationale: 'remove active identity' });
  },
};

test('SKG-TX-01: each closed typed operation validates, publishes, and appends one immutable ledger record', async () => {
  const tx = await import(transactionModule);
  for (const [operation, edit] of Object.entries(cases)) {
    const files = fixture();
    try {
      const begun = tx.beginTransaction({ repoRoot: files.root, operation, scope: [files.moduleOnePath, files.moduleTwoPath, files.skillPath, files.otherSkillPath, files.markdownPath], base: 'HEAD' });
      assert.equal(begun.exitCode, 0, `${operation}: ${JSON.stringify(begun.diagnostics)}`);
      edit({ workspace: begun.workspace, files });
      const validated = tx.validateTransaction({ repoRoot: files.root, workspace: begun.workspace });
      assert.equal(validated.exitCode, 0, `${operation}: ${JSON.stringify(validated.diagnostics)}`);
      assert.equal(validated.validation.candidate_valid, true);
      const applied = tx.applyTransaction({ repoRoot: files.root, workspace: begun.workspace });
      assert.equal(applied.exitCode, 0, `${operation}: ${JSON.stringify(applied.diagnostics)}`);
      assert.equal(applied.change.result_graph_sha256, validated.validation.result_graph_sha256);
      assert.equal(fs.existsSync(applied.ledgerPath), true);
    } finally { fs.rmSync(files.root, { recursive: true, force: true }); }
  }
});

test('SKG-TX-02: unknown identity, precondition mismatch, stale scope, malformed marker/edge/authority/admission, and write rollback fail closed', async () => {
  const tx = await import(transactionModule);
  const files = fixture();
  try {
    const begun = tx.beginTransaction({ repoRoot: files.root, operation: 'refine', scope: [files.moduleOnePath], base: 'HEAD' });
    writeDraft(begun.workspace, { op: 'refine', subject: 'point:demo.missing', changed_fields: ['summary'], rationale: 'bad identity' });
    let result = tx.validateTransaction({ repoRoot: files.root, workspace: begun.workspace });
    assert.equal(result.exitCode, 4); assert.ok(result.diagnostics.some((item) => item.code === 'SKG-CHANGE-PRECONDITION'));

    cases.refine({ workspace: begun.workspace, files });
    fs.writeFileSync(path.join(files.root, files.moduleOnePath), `${fs.readFileSync(path.join(files.root, files.moduleOnePath), 'utf8')} `);
    result = tx.validateTransaction({ repoRoot: files.root, workspace: begun.workspace });
    assert.equal(result.exitCode, 7); assert.ok(result.diagnostics.some((item) => item.code === 'SKG-CHANGE-STALE-SCOPE'));

    fs.rmSync(files.root, { recursive: true, force: true });
  } finally { fs.rmSync(files.root, { recursive: true, force: true }); }
});

test('SKG-TX-03: marker, edge, authority, admission regressions and an induced publish failure leave canonical bytes untouched', async () => {
  const tx = await import(transactionModule);
  const invalidCases = [
    {
      name: 'marker', scope: (files) => [files.moduleOnePath, files.markdownPath],
      edit(workspace, files) { fs.writeFileSync(candidateJson(workspace, files.markdownPath), '<!-- ccm:k:start point:demo.one -->\nbroken\n<!-- ccm:k:end point:demo.two -->\n'); },
      code: 'SKG-MARKER-OVERLAP',
    },
    {
      name: 'edge', scope: (files) => [files.moduleOnePath],
      edit(workspace, files) { editModule(workspace, files.moduleOnePath, (document) => { document.edges[0].to = 'point:demo.missing'; }); },
      code: 'SKG-EDGE-ENDPOINT-UNKNOWN',
    },
    {
      name: 'authority', scope: (files) => [files.moduleOnePath],
      edit(workspace, files) { editModule(workspace, files.moduleOnePath, (document) => { document.points[0].authority = { role: 'summary', subject: 'subject:demo.one', canonical: 'point:demo.missing', review_policy: 'generated', reviewed_canonical_sha256: '0'.repeat(64) }; }); },
      code: 'SKG-AUTHORITY-INVALID',
    },
    {
      name: 'admission', scope: (files) => [files.moduleOnePath],
      edit(workspace, files) { editModule(workspace, files.moduleOnePath, (document) => { document.points[0].admission = { evidence: [], verifiers: [] }; }); },
      code: 'SKG-SCHEMA-INVALID',
    },
  ];
  for (const scenario of invalidCases) {
    const files = fixture();
    try {
      const begun = tx.beginTransaction({ repoRoot: files.root, operation: 'refine', scope: scenario.scope(files), base: 'HEAD' });
      scenario.edit(begun.workspace, files);
      writeDraft(begun.workspace, { op: 'refine', subject: 'point:demo.one', changed_fields: ['summary'], rationale: scenario.name });
      const result = tx.validateTransaction({ repoRoot: files.root, workspace: begun.workspace });
      assert.notEqual(result.exitCode, 0, scenario.name);
      assert.ok(result.diagnostics.some((item) => item.code === scenario.code), `${scenario.name}: ${JSON.stringify(result.diagnostics)}`);
    } finally { fs.rmSync(files.root, { recursive: true, force: true }); }
  }

  const files = fixture();
  try {
    const acceptedBefore = fs.readFileSync(path.join(files.root, files.moduleOnePath));
    const begun = tx.beginTransaction({ repoRoot: files.root, operation: 'refine', scope: [files.moduleOnePath], base: 'HEAD' });
    cases.refine({ workspace: begun.workspace, files });
    const result = tx.applyTransaction({ repoRoot: files.root, workspace: begun.workspace, failureInjector(index) { if (index === 1) throw new Error('simulated write failure'); } });
    assert.equal(result.exitCode, 7);
    assert.ok(result.diagnostics.some((item) => item.code === 'SKG-CHANGE-PUBLISH-FAILED'));
    assert.deepEqual(fs.readFileSync(path.join(files.root, files.moduleOnePath)), acceptedBefore);
    const ledgerDirectory = path.join(files.root, 'plugin/src/knowledge/changes');
    assert.deepEqual(fs.existsSync(ledgerDirectory) ? fs.readdirSync(ledgerDirectory) : [], [], 'failed publication must not append ledger evidence');
  } finally { fs.rmSync(files.root, { recursive: true, force: true }); }
});

test('SKG-TX-04: canonical semantic deltas must be completely explained by their declared typed operation', async () => {
  const tx = await import(transactionModule);
  const scenarios = [
    {
      name: 'add cannot smuggle an existing identity summary mutation',
      operation: 'add',
      scope: (files) => [files.moduleOnePath, files.markdownPath],
      edit(workspace, files) {
        cases.add({ workspace, files });
        editModule(workspace, files.moduleOnePath, (document) => { document.points[0].summary = 'smuggled existing mutation'; });
      },
    },
    {
      name: 'wording cannot smuggle a manifest semantic mutation',
      operation: 'wording',
      scope: (files) => [files.moduleOnePath, files.markdownPath],
      edit(workspace, files) {
        cases.wording({ workspace, files });
        editModule(workspace, files.moduleOnePath, (document) => { document.points[0].summary = 'smuggled manifest mutation'; });
      },
    },
    {
      name: 'deprecate replacement declaration must exactly equal candidate lifecycle replacement',
      operation: 'deprecate',
      scope: (files) => [files.moduleOnePath],
      edit(workspace, files) {
        cases.deprecate({ workspace, files });
        writeDraft(workspace, { op: 'deprecate', subjects: ['point:demo.one'], replacement: 'point:demo.three', edge_rewrites: [], rationale: 'mismatched successor' });
      },
      expected: 'SKG-CHANGE-PRECONDITION',
    },
    {
      name: 'move cannot use identical module and binding endpoints to wash a wording mutation',
      operation: 'move',
      scope: (files) => [files.moduleOnePath, files.markdownPath],
      edit(workspace, files) {
        const binding = { path: files.markdownPath, marker: 'point:demo.one' };
        const markdown = candidateJson(workspace, files.markdownPath);
        fs.writeFileSync(markdown, fs.readFileSync(markdown, 'utf8').replace('\none\n', '\none washed by noop move\n'));
        writeDraft(workspace, {
          op: 'move', subject: 'point:demo.one',
          from: { module: 'module:demo.one', binding },
          to: { module: 'module:demo.one', binding },
          edge_rewrites: [], rationale: 'pretend a noop move explains wording',
        });
      },
      expected: 'SKG-CHANGE-PRECONDITION',
    },
    {
      name: 'move cannot use correct binding relocation declarations to wash a wording mutation',
      operation: 'move',
      scope: (files) => [files.moduleOnePath, files.moduleTwoPath, files.markdownPath],
      edit(workspace, files) {
        cases.move({ workspace, files });
        const binding = { path: files.markdownPath, marker: 'point:demo.one' };
        const markdown = candidateJson(workspace, files.markdownPath);
        fs.writeFileSync(markdown, fs.readFileSync(markdown, 'utf8').replace('\none\n', '\none washed by real move\n'));
        writeDraft(workspace, {
          op: 'move', subject: 'point:demo.one',
          from: { module: 'module:demo.one', binding },
          to: { module: 'module:demo.two', binding },
          edge_rewrites: [{ action: 'remove', edge: 'edge:demo.one-to-two' }], rationale: 'move point with explicit bindings',
        });
      },
    },
  ];
  for (const scenario of scenarios) {
    const files = fixture();
    try {
      const begun = tx.beginTransaction({ repoRoot: files.root, operation: scenario.operation, scope: scenario.scope(files), base: 'HEAD' });
      scenario.edit(begun.workspace, files);
      const result = tx.validateTransaction({ repoRoot: files.root, workspace: begun.workspace });
      assert.notEqual(result.exitCode, 0, scenario.name);
      assert.ok(result.diagnostics.some((item) => item.code === (scenario.expected ?? 'SKG-CHANGE-UNEXPLAINED-DIFF')), `${scenario.name}: ${JSON.stringify(result.diagnostics)}`);
    } finally { fs.rmSync(files.root, { recursive: true, force: true }); }
  }
});

test('SKG-TX-05: a change outside accepted scope stales the immutable base graph', async () => {
  const tx = await import(transactionModule);
  const files = fixture();
  try {
    const begun = tx.beginTransaction({ repoRoot: files.root, operation: 'refine', scope: [files.moduleOnePath], base: 'HEAD' });
    cases.refine({ workspace: begun.workspace, files });
    const outside = path.join(files.root, files.moduleTwoPath);
    const acceptedOutside = JSON.parse(fs.readFileSync(outside, 'utf8'));
    acceptedOutside.points[0].summary = 'accepted scope-external semantic change';
    fs.writeFileSync(outside, `${JSON.stringify(acceptedOutside, null, 2)}\n`);
    const result = tx.validateTransaction({ repoRoot: files.root, workspace: begun.workspace });
    assert.equal(result.exitCode, 7);
    assert.ok(result.diagnostics.some((item) => item.code === 'SKG-CHANGE-BASE-STALE'), JSON.stringify(result.diagnostics));
  } finally { fs.rmSync(files.root, { recursive: true, force: true }); }
});

test('SKG-TX-06: rollback failure preserves an exact recovery bundle and names unrecovered targets', async () => {
  const tx = await import(transactionModule);
  const files = fixture();
  try {
    const moduleOne = path.join(files.root, files.moduleOnePath);
    const moduleTwo = path.join(files.root, files.moduleTwoPath);
    const moduleOneBefore = fs.readFileSync(moduleOne);
    const moduleTwoBefore = fs.readFileSync(moduleTwo);
    const begun = tx.beginTransaction({ repoRoot: files.root, operation: 'refine', scope: [files.moduleOnePath, files.moduleTwoPath], base: 'HEAD' });
    cases.refine({ workspace: begun.workspace, files });
    const result = tx.applyTransaction({
      repoRoot: files.root,
      workspace: begun.workspace,
      failureInjector(index, target) {
        if (index === 1) {
          fs.rmSync(target, { force: true });
          fs.mkdirSync(target);
          throw new Error('simulated rollback-blocking failure');
        }
      },
    });
    assert.equal(result.exitCode, 7);
    const failure = result.diagnostics.find((item) => item.code === 'SKG-CHANGE-PUBLISH-FAILED');
    assert.ok(failure, JSON.stringify(result.diagnostics));
    assert.ok(failure.witness.recovery_dir, JSON.stringify(failure.witness));
    assert.ok(failure.witness.unrecovered_paths.includes(files.moduleTwoPath), JSON.stringify(failure.witness));
    assert.ok(failure.witness.recovered_paths.includes(files.moduleOnePath), JSON.stringify(failure.witness));
    assert.deepEqual(fs.readFileSync(moduleOne), moduleOneBefore);
    assert.equal(fs.statSync(moduleTwo).isDirectory(), true);
    assert.equal(fs.existsSync(path.join(files.root, 'plugin/src/knowledge/changes', `${begun.workspaceDocument.change_id.slice('change:'.length)}.change.json`)), false);
    const recovery = path.join(begun.workspace, failure.witness.recovery_dir);
    assert.deepEqual(fs.readFileSync(path.join(recovery, 'before', files.moduleOnePath)), moduleOneBefore);
    assert.deepEqual(fs.readFileSync(path.join(recovery, 'before', files.moduleTwoPath)), moduleTwoBefore);
    assert.ok(fs.existsSync(path.join(recovery, 'manifest.json')));
  } finally { fs.rmSync(files.root, { recursive: true, force: true }); }
});

test('SKG-TX-07: every typed operation has a concrete, non-noop graph precondition', async () => {
  const tx = await import(transactionModule);
  const invalidOperations = {
    add: { op: 'add', entities: ['point:demo.one'], rationale: 'existing identity is not addable' },
    wording: { op: 'wording', subject: 'point:demo.one', binding: { path: 'plugin/src/skills/demo/canonical/SKILL.md', marker: 'point:demo.one' }, before_sha256: '0'.repeat(64), after_sha256: 'f'.repeat(64), rationale: 'no matching span mutation' },
    refine: { op: 'refine', subject: 'point:demo.one', changed_fields: ['summary'], rationale: 'no candidate mutation' },
    move: { op: 'move', subject: 'point:demo.one', from: { module: 'module:demo.two' }, to: { module: 'module:demo.one' }, edge_rewrites: [], rationale: 'wrong frozen endpoint' },
    split: { op: 'split', subject: 'point:demo.one', results: ['point:demo.split-a', 'point:demo.split-b'], edge_rewrites: [], rationale: 'candidate did not retire or create results' },
    merge: { op: 'merge', subjects: ['point:demo.one', 'point:demo.two'], result: 'point:demo.merged', edge_rewrites: [], rationale: 'candidate did not retire or create result' },
    transfer_owner: { op: 'transfer_owner', subject: 'module:demo.two', from_skill: 'skill:other', to_skill: 'skill:demo', edge_rewrites: [], rationale: 'wrong frozen owner' },
    deprecate: { op: 'deprecate', subjects: ['point:demo.one'], replacement: 'point:demo.two', edge_rewrites: [], rationale: 'candidate remains accepted' },
    retire: { op: 'retire', subjects: ['point:demo.one'], replacement: 'point:demo.two', edge_rewrites: [], rationale: 'candidate remains accepted' },
  };
  for (const [operation, draft] of Object.entries(invalidOperations)) {
    const files = fixture();
    try {
      const begun = tx.beginTransaction({ repoRoot: files.root, operation, scope: [files.moduleOnePath, files.moduleTwoPath, files.skillPath, files.otherSkillPath, files.markdownPath], base: 'HEAD' });
      writeDraft(begun.workspace, draft);
      const result = tx.validateTransaction({ repoRoot: files.root, workspace: begun.workspace });
      assert.notEqual(result.exitCode, 0, operation);
      assert.ok(result.diagnostics.some((item) => item.code === 'SKG-CHANGE-PRECONDITION'), `${operation}: ${JSON.stringify(result.diagnostics)}`);
    } finally { fs.rmSync(files.root, { recursive: true, force: true }); }
  }
});
