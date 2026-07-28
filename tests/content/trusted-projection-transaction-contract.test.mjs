import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  canonicalHash,
  computeArtifactId,
} from './helpers/trusted-projection/canonical-contract.mjs';
import {
  GOLDEN_ARTIFACT_IDS,
  SIX_ARTIFACT_DEFINITIONS,
  TRUSTED_POLICIES,
  buildGoldenTransactionFixture,
} from './helpers/trusted-projection/golden-fixtures.mjs';
import { validateJsonSchema } from './helpers/trusted-projection/json-schema-validator.mjs';
import {
  FAILPOINTS,
  MUTATION_OPERATORS,
  PRODUCTION_CHECKPOINTS,
  assertScenarioWitness,
  evaluateProductionObservation,
} from './helpers/trusted-projection/scenario-harness.mjs';
import {
  rehashArtifact,
  rehashSnapshot,
  validateTrustedProjectionFixture,
} from './helpers/trusted-projection/semantic-validator.mjs';
import {
  SnapshotOracleError,
  assertPortableModeSupport,
  captureTreeSnapshot,
} from './helpers/trusted-projection/snapshot-oracle.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONTRACT = path.join(
  REPO_ROOT,
  'design_docs/skill-knowledge-graph/trusted-projection-transaction.md',
);
const SCHEMA_PATH = path.join(
  REPO_ROOT,
  'design_docs/skill-knowledge-graph/schemas/trusted-projection-transaction.schema.json',
);
const SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

function clone(value) {
  return structuredClone(value);
}

function withTempTree(prefix, body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function write(root, relative, content, mode = 0o644) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, { mode });
  fs.chmodSync(target, mode);
  return target;
}

function assertOracleCode(fn, code) {
  assert.throws(
    fn,
    (error) =>
      error instanceof SnapshotOracleError &&
      error.code === code &&
      /^[a-f0-9]{64}$/u.test(error.witness_sha256),
    code,
  );
}

function forgedEntries(entries, sha = 'a'.repeat(64)) {
  const forged = clone(entries);
  const file = forged.find((entry) => entry.kind === 'file');
  file.sha256 = sha;
  file.size += 1;
  const root = forged.find((entry) => entry.path === '.');
  root.sha256 = canonicalHash(
    'directory-entry',
    forged
      .filter((entry) => entry.path !== '.')
      .map(({ path: itemPath, kind, sha256, size, executable, posix_mode }) => ({
        path: itemPath,
        kind,
        sha256,
        size,
        executable,
        posix_mode,
      })),
  );
  return forged;
}

function selfConsistentCandidateForgery() {
  const fixture = buildGoldenTransactionFixture();
  const entries = forgedEntries(fixture.hostPlan.expected_entries);
  fixture.hostPlan.expected_entries = entries;
  rehashArtifact('projection-plan', fixture.hostPlan);
  fixture.candidateSnapshot.entries = clone(entries);
  rehashSnapshot(fixture.candidateSnapshot);
  Object.assign(fixture.verifiedSnapshotAttestation, {
    projection_plan_id: fixture.hostPlan.projection_plan_id,
    candidate_snapshot_id: fixture.candidateSnapshot.artifact_snapshot_id,
    authorized_content_id: fixture.candidateSnapshot.artifact_content_id,
    sealed_content_id: fixture.candidateSnapshot.artifact_content_id,
  });
  rehashArtifact(
    'verified-snapshot-attestation',
    fixture.verifiedSnapshotAttestation,
  );
  return fixture;
}

function selfConsistentArchiveForgery() {
  const fixture = buildGoldenTransactionFixture();
  const entries = forgedEntries(fixture.bundlePlan.expected_entries, 'b'.repeat(64));
  fixture.bundlePlan.expected_entries = entries;
  rehashArtifact('projection-plan', fixture.bundlePlan);
  fixture.extractedSnapshot.entries = clone(entries);
  rehashSnapshot(fixture.extractedSnapshot);
  Object.assign(fixture.releaseBundleAttestation, {
    bundle_projection_plan_id: fixture.bundlePlan.projection_plan_id,
    extracted_snapshot_id: fixture.extractedSnapshot.artifact_snapshot_id,
    extracted_content_id: fixture.extractedSnapshot.artifact_content_id,
  });
  rehashArtifact(
    'release-bundle-attestation',
    fixture.releaseBundleAttestation,
  );
  return fixture;
}

test('TPT-CONTRACT-01: prose and executable schema freeze six artifacts, states, and P1-P8', () => {
  const prose = fs.readFileSync(CONTRACT, 'utf8');
  for (const artifact of [
    'SourceSnapshot',
    'ProjectionPlan',
    'ArtifactSnapshot',
    'VerifiedSnapshotAttestation',
    'PublishReceipt',
    'ReleaseBundleAttestation',
  ]) {
    assert.match(prose, new RegExp(`\\b${artifact}\\b`, 'u'));
  }
  for (const state of SCHEMA.$defs.state.enum) {
    assert.match(prose, new RegExp(`\\b${state}\\b`, 'u'));
  }
  assert.deepEqual(SCHEMA.$defs.invariantId.enum, [
    'P1',
    'P2',
    'P3',
    'P4',
    'P5',
    'P6',
    'P7',
    'P8',
  ]);
  assert.equal(SCHEMA.oneOf.length, 7, 'six artifacts plus scenario witness');
  assert.deepEqual(SCHEMA.$defs.scenarioMutation.enum, MUTATION_OPERATORS);
  assert.deepEqual(SCHEMA.$defs.scenarioFailpoint.enum, FAILPOINTS);
  assert.deepEqual(SCHEMA.$defs.productionCheckpoint.enum, PRODUCTION_CHECKPOINTS);
});

test('TPT-HASH-01: six artifact golden IDs pin one domain-separated canonical formula', () => {
  const fixture = buildGoldenTransactionFixture();
  const fields = {
    sourceSnapshot: 'source_snapshot_id',
    hostPlan: 'projection_plan_id',
    candidateSnapshot: 'artifact_snapshot_id',
    verifiedSnapshotAttestation: 'verified_snapshot_attestation_id',
    publishReceipt: 'publish_receipt_id',
    releaseBundleAttestation: 'release_bundle_attestation_id',
  };
  for (const [name, expected] of Object.entries(GOLDEN_ARTIFACT_IDS)) {
    assert.equal(fixture[name][fields[name]], expected, name);
  }
  assert.equal(
    fixture.candidateSnapshot.artifact_content_id,
    fixture.liveAfterSnapshot.artifact_content_id,
    'authorized content identity is location-independent',
  );
  assert.notEqual(
    fixture.candidateSnapshot.artifact_snapshot_id,
    fixture.liveAfterSnapshot.artifact_snapshot_id,
    'observation identity includes logical observation root',
  );
});

test('TPT-SCHEMA-01: executable schema accepts every valid artifact and both publish outcomes', () => {
  const fixture = buildGoldenTransactionFixture();
  for (const [key, definition] of Object.entries(SIX_ARTIFACT_DEFINITIONS)) {
    assert.deepEqual(validateJsonSchema(SCHEMA, fixture[key], definition), {
      ok: true,
      errors: [],
    });
    assert.equal(validateJsonSchema(SCHEMA, fixture[key]).ok, true, key);
  }
  assert.equal(validateJsonSchema(SCHEMA, fixture.bundlePlan, 'projectionPlan').ok, true);

  const committed = fixture.publishReceipt;
  const recovery = {
    schema: committed.schema,
    transaction_id: committed.transaction_id,
    publish_receipt_id: '',
    verified_snapshot_attestation_id:
      committed.verified_snapshot_attestation_id,
    live_before_snapshot_id: committed.live_before_snapshot_id,
    outcome: 'recovery_required',
    last_observation_snapshot_id: null,
    recovery_journal_id: 'journal.golden-1',
    operator_action: 'Inspect journal and run explicit recovery.',
    backup_retained: true,
    trace_head_sha256: committed.trace_head_sha256,
  };
  recovery.publish_receipt_id = computeArtifactId('publish-receipt', recovery);
  assert.equal(validateJsonSchema(SCHEMA, recovery, 'publishReceipt').ok, true);

  const mixedOutcome = { ...recovery, live_after_snapshot_id: committed.live_after_snapshot_id };
  assert.equal(
    validateJsonSchema(SCHEMA, mixedOutcome, 'publishReceipt').ok,
    false,
    'recovery_required cannot also claim committed live-after fields',
  );
});

test('TPT-SCHEMA-02: typed IDs, duplicate exact entries, and ok:false fail at shape layer', () => {
  const fixture = buildGoldenTransactionFixture();
  const wrongTypedId = clone(fixture.sourceSnapshot);
  wrongTypedId.source_snapshot_id = `tpt:plan:${'a'.repeat(64)}`;
  assert.equal(validateJsonSchema(SCHEMA, wrongTypedId, 'sourceSnapshot').ok, false);

  const duplicate = clone(fixture.candidateSnapshot);
  duplicate.entries.push(clone(duplicate.entries.at(-1)));
  assert.ok(
    validateJsonSchema(SCHEMA, duplicate, 'artifactSnapshot').errors.some(
      ({ keyword }) => keyword === 'uniqueItems',
    ),
  );

  const falseCheck = clone(fixture.verifiedSnapshotAttestation);
  falseCheck.checks[0].ok = false;
  assert.equal(
    validateJsonSchema(SCHEMA, falseCheck, 'verifiedSnapshotAttestation').ok,
    false,
  );
});

test('TPT-SEMANTIC-01: independent validator accepts the valid cross-artifact chain', () => {
  assert.deepEqual(
    validateTrustedProjectionFixture(buildGoldenTransactionFixture(), {
      trustedPolicies: TRUSTED_POLICIES,
    }),
    { ok: true, diagnostics: [] },
  );
});

test('TPT-SEMANTIC-02: self-consistent candidate/archive expected claims cannot become SSOT', () => {
  const candidate = validateTrustedProjectionFixture(
    selfConsistentCandidateForgery(),
    { trustedPolicies: TRUSTED_POLICIES },
  );
  assert.ok(
    candidate.diagnostics.some(
      ({ code }) => code === 'TPT-SEMANTIC-EXPECTED-SSOT',
    ),
  );

  const archive = validateTrustedProjectionFixture(
    selfConsistentArchiveForgery(),
    { trustedPolicies: TRUSTED_POLICIES },
  );
  assert.ok(
    archive.diagnostics.some(
      ({ code }) => code === 'TPT-SEMANTIC-EXPECTED-SSOT',
    ),
  );
  assert.ok(
    archive.diagnostics.some(
      ({ code }) => code === 'TPT-SEMANTIC-EXTRACTION-PLAN-MISMATCH',
    ),
  );
});

test('TPT-SEMANTIC-03: P1-P8, hash, order, NFC, transition, and equality have stable rejection codes', () => {
  const cases = [
    {
      invariant: 'P1',
      code: 'TPT-SEMANTIC-EXPECTED-SSOT',
      fixture: selfConsistentCandidateForgery(),
    },
    {
      invariant: 'P2',
      code: 'TPT-SEMANTIC-NON-NFC-PATH',
      fixture() {
        const value = buildGoldenTransactionFixture();
        value.candidateSnapshot.entries[1].path = 'e\u0301.md';
        return value;
      },
    },
    {
      invariant: 'P3',
      code: 'TPT-SEMANTIC-SOURCE-OBSERVATION-INVALID',
      fixture() {
        const value = buildGoldenTransactionFixture();
        value.sourceAtVerify.source_content_id = `tpt:content:${'c'.repeat(64)}`;
        return value;
      },
    },
    {
      invariant: 'P4',
      code: 'TPT-SEMANTIC-ATTESTATION-CANDIDATE-MISMATCH',
      fixture() {
        const value = buildGoldenTransactionFixture();
        value.verifiedSnapshotAttestation.authorized_content_id =
          value.liveBeforeSnapshot.artifact_content_id;
        rehashArtifact(
          'verified-snapshot-attestation',
          value.verifiedSnapshotAttestation,
        );
        return value;
      },
    },
    {
      invariant: 'P5',
      code: 'TPT-SEMANTIC-COMMITTED-OUTCOME-MISMATCH',
      fixture() {
        const value = buildGoldenTransactionFixture();
        value.publishReceipt.committed_content_id =
          value.liveBeforeSnapshot.artifact_content_id;
        rehashArtifact('publish-receipt', value.publishReceipt);
        return value;
      },
    },
    {
      invariant: 'P6',
      code: 'TPT-SEMANTIC-ARTIFACT-ID',
      fixture() {
        const value = buildGoldenTransactionFixture();
        value.sourceSnapshot.source_snapshot_id = `tpt:source:${'d'.repeat(64)}`;
        return value;
      },
    },
    {
      invariant: 'P7',
      code: 'TPT-SEMANTIC-RELEASE-CHAIN-MISMATCH',
      fixture() {
        const value = buildGoldenTransactionFixture();
        value.releaseBundleAttestation.extracted_content_id =
          value.liveBeforeSnapshot.artifact_content_id;
        rehashArtifact(
          'release-bundle-attestation',
          value.releaseBundleAttestation,
        );
        return value;
      },
    },
    {
      invariant: 'P8',
      code: 'TPT-SEMANTIC-ILLEGAL-TRANSITION',
      fixture() {
        const value = buildGoldenTransactionFixture();
        value.trace = ['NEW', 'COMMITTED'];
        return value;
      },
    },
  ];

  for (const entry of cases) {
    const fixture =
      typeof entry.fixture === 'function' ? entry.fixture() : entry.fixture;
    const result = validateTrustedProjectionFixture(fixture, {
      trustedPolicies: TRUSTED_POLICIES,
    });
    assert.ok(
      result.diagnostics.some(
        ({ invariant, code }) =>
          invariant === entry.invariant && code === entry.code,
      ),
      `${entry.invariant}: ${JSON.stringify(result.diagnostics)}`,
    );
  }

  const unordered = buildGoldenTransactionFixture();
  unordered.candidateSnapshot.entries.reverse();
  rehashSnapshot(unordered.candidateSnapshot);
  assert.ok(
    validateTrustedProjectionFixture(unordered, {
      trustedPolicies: TRUSTED_POLICIES,
    }).diagnostics.some(
      ({ code }) => code === 'TPT-SEMANTIC-ENTRY-ORDER-OR-DUPLICATE',
    ),
  );

  const duplicatePath = buildGoldenTransactionFixture();
  duplicatePath.candidateSnapshot.entries.push({
    ...clone(duplicatePath.candidateSnapshot.entries.at(-1)),
    sha256: 'e'.repeat(64),
  });
  assert.ok(
    validateTrustedProjectionFixture(duplicatePath, {
      trustedPolicies: TRUSTED_POLICIES,
    }).diagnostics.some(
      ({ code }) => code === 'TPT-SEMANTIC-ENTRY-ORDER-OR-DUPLICATE',
    ),
  );

  const staleObservation = buildGoldenTransactionFixture();
  staleObservation.sourceAtVerify.entries[1].sha256 = 'f'.repeat(64);
  assert.ok(
    validateTrustedProjectionFixture(staleObservation, {
      trustedPolicies: TRUSTED_POLICIES,
    }).diagnostics.some(
      ({ code }) => code === 'TPT-SEMANTIC-SOURCE-OBSERVATION-INVALID',
    ),
    'source observation entries must be recomputed instead of trusting stale IDs',
  );

  const splitTransaction = buildGoldenTransactionFixture();
  splitTransaction.bundlePlan.transaction_id = 'tpt:tx:split-release';
  rehashArtifact('projection-plan', splitTransaction.bundlePlan);
  splitTransaction.releaseBundleAttestation.transaction_id =
    'tpt:tx:split-release';
  splitTransaction.releaseBundleAttestation.bundle_projection_plan_id =
    splitTransaction.bundlePlan.projection_plan_id;
  rehashArtifact(
    'release-bundle-attestation',
    splitTransaction.releaseBundleAttestation,
  );
  assert.ok(
    validateTrustedProjectionFixture(splitTransaction, {
      trustedPolicies: TRUSTED_POLICIES,
    }).diagnostics.some(
      ({ code }) => code === 'TPT-SEMANTIC-TRANSACTION-SPLIT',
    ),
    'internally rehashed release subchain must not fork transaction identity',
  );
});

test('TPT-ORACLE-01: content identity is root-independent while observations are distinct', () => {
  withTempTree('tpt-oracle-content-', (parent) => {
    const candidate = path.join(parent, 'candidate');
    const live = path.join(parent, 'live');
    write(candidate, 'runtime.md', 'same\n');
    fs.cpSync(candidate, live, { recursive: true });
    const first = captureTreeSnapshot(candidate, { rootId: 'candidate' });
    const second = captureTreeSnapshot(live, { rootId: 'live-after' });
    assert.equal(first.artifact_content_id, second.artifact_content_id);
    assert.equal(first.tree_sha256, second.tree_sha256);
    assert.notEqual(first.artifact_snapshot_id, second.artifact_snapshot_id);
  });
});

test('TPT-ORACLE-02: symlink, hardlink, special, control, and non-NFC paths fail closed', () => {
  const fixtures = [
    {
      name: 'symlink',
      code: 'TPT-ORACLE-SYMLINK',
      arrange(root) {
        write(root, 'target', 'x\n');
        fs.symlinkSync('target', path.join(root, 'alias'));
      },
    },
    {
      name: 'hardlink',
      code: 'TPT-ORACLE-HARDLINK',
      arrange(root) {
        const target = write(root, 'target', 'x\n');
        fs.linkSync(target, path.join(root, 'alias'));
      },
    },
    {
      name: 'special',
      code: 'TPT-ORACLE-SPECIAL',
      arrange(root) {
        const result = spawnSync('mkfifo', [path.join(root, 'pipe')]);
        assert.equal(result.status, 0);
      },
    },
    {
      name: 'control',
      code: 'TPT-ORACLE-CONTROL-PATH',
      arrange(root) {
        write(root, 'line\nbreak', 'x\n');
      },
    },
    {
      name: 'nfc',
      code: 'TPT-ORACLE-NON-NFC-PATH',
      arrange(root) {
        write(root, 'e\u0301', 'x\n');
      },
    },
  ];
  for (const fixture of fixtures) {
    withTempTree(`tpt-oracle-${fixture.name}-`, (root) => {
      fixture.arrange(root);
      assertOracleCode(
        () => captureTreeSnapshot(root, { rootId: 'candidate' }),
        fixture.code,
      );
    });
  }
});

test('TPT-ORACLE-03: same-fd file drift and directory traversal drift are detected', () => {
  withTempTree('tpt-oracle-file-race-', (root) => {
    write(root, 'runtime.md', 'before\n');
    let fired = false;
    assertOracleCode(
      () =>
        captureTreeSnapshot(root, {
          rootId: 'candidate',
          faultHook({ checkpoint, path: relative, absolute }) {
            if (!fired && checkpoint === 'FILE_FD_OPENED' && relative === 'runtime.md') {
              fired = true;
              fs.appendFileSync(absolute, 'drift\n');
            }
          },
        }),
      'TPT-ORACLE-UNSTABLE-READ',
    );
  });
  withTempTree('tpt-oracle-dir-race-', (root) => {
    write(root, 'runtime.md', 'before\n');
    let fired = false;
    assertOracleCode(
      () =>
        captureTreeSnapshot(root, {
          rootId: 'candidate',
          faultHook({ checkpoint, path: relative, absolute }) {
            if (!fired && checkpoint === 'DIRECTORY_LISTED' && relative === '.') {
              fired = true;
              write(absolute, 'late.md', 'drift\n');
            }
          },
        }),
      'TPT-ORACLE-UNSTABLE-DIRECTORY',
    );
  });
});

test('TPT-ORACLE-04: unsupported mode model and missing no-follow support fail closed', () => {
  assertOracleCode(
    () => assertPortableModeSupport({ platform: 'win32', noFollow: 1 }),
    'TPT-ORACLE-UNSUPPORTED-MODE-MODEL',
  );
  assertOracleCode(
    () => assertPortableModeSupport({ platform: 'linux', noFollow: 0 }),
    'TPT-ORACLE-NOFOLLOW-UNAVAILABLE',
  );
});

test('TPT-HARNESS-01: scenario schema is closed over real production vocabulary', () => {
  const sha = 'a'.repeat(64);
  const witness = {
    schema: 'cc-master/trusted-projection-scenario-witness/v1alpha1',
    scenario_id: `tpt:scenario:${sha}`,
    host: 'claude-code',
    surface: 'host',
    seed: 1,
    operator: {
      mutation: 'rewrite-existing-artifact-after-attestation',
      failpoint: 'none',
    },
    production_subject:
      'scripts/skill-knowledge/sync-host-surface.cjs#projectAndPublishHostSurface',
    trace: [
      {
        seq: 0,
        checkpoint:
          'sync-host-surface:injectLateFault:after-compile-attestation-before-publish',
        state: 'CANDIDATE_BUILT',
        observation_sha256: sha,
      },
    ],
    outcome: {
      process_status: 0,
      production_returned: true,
      production_error_code: null,
      live_changed: true,
      live_before_content_id: `tpt:content:${sha}`,
      live_after_content_id: `tpt:content:${'b'.repeat(64)}`,
      live_before_forensic_sha256: sha,
      live_after_forensic_sha256: 'b'.repeat(64),
      production_residues: [],
    },
    contract: {
      ok: false,
      primary_violation: 'P1',
      violations: [
        {
          invariant: 'P1',
          code: 'TPT-P1-PLAN-EXACTNESS',
          checkpoint:
            'sync-host-surface:injectLateFault:after-compile-attestation-before-publish',
          expected_sha256: sha,
          actual_sha256: 'b'.repeat(64),
        },
      ],
    },
  };
  assertScenarioWitness(witness);
  assert.equal(validateJsonSchema(SCHEMA, witness, 'scenarioWitness').ok, true);
});

test('TPT-HARNESS-02: observed precommit rejection satisfies mutation properties', () => {
  const fixture = buildGoldenTransactionFixture();
  const forensic = '9'.repeat(64);
  const result = evaluateProductionObservation({
    markers: [
      {
        checkpoint:
          'sync-host-surface:injectLateFault:after-compile-attestation-before-publish',
        details: {},
      },
      {
        checkpoint: 'mutation:applied',
        details: {
          mutation: 'rewrite-existing-artifact-after-attestation',
        },
      },
      {
        checkpoint: 'projectAndPublishHostSurface:throw',
        details: { error_code: 'TPT-PRODUCTION-PLAN-DRIFT' },
      },
    ],
    processStatus: 1,
    productionResult: {
      production_returned: false,
      production_error_code: 'TPT-PRODUCTION-PLAN-DRIFT',
      committed: false,
    },
    sourceBefore: fixture.sourceSnapshot,
    sourceAfter: fixture.sourceSnapshot,
    liveBefore: fixture.liveBeforeSnapshot,
    liveAfter: { snapshot: fixture.liveBeforeSnapshot, error: null },
    liveBeforeForensicSha256: forensic,
    liveAfterForensicSha256: forensic,
    productionResidues: [],
  });
  assert.deepEqual(result, {
    ok: true,
    primary_violation: null,
    violations: [],
    observed_mutation: 'rewrite-existing-artifact-after-attestation',
    live_changed: false,
  });
});
