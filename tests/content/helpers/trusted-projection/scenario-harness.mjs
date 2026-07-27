import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { copyMinimalSkillKnowledgeRepo } from '../skill-knowledge-isolated-repo.mjs';
import { canonicalHash, canonicalJson } from './canonical-contract.mjs';
import {
  SnapshotOracleError,
  captureTreeSnapshot,
} from './snapshot-oracle.mjs';

const DRIVER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'production-driver.mjs',
);
const SUBJECT =
  'scripts/skill-knowledge/sync-host-surface.cjs#projectAndPublishHostSurface';
const HOSTS = new Set(['claude-code', 'codex', 'cursor', 'kimi-code']);
const SURFACES = new Set(['host']);
const SHA256 = /^[a-f0-9]{64}$/u;
const CONTENT_ID = /^tpt:content:[a-f0-9]{64}$/u;
const INVARIANT_ORDER = new Map(
  ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'].map((value, index) => [
    value,
    index,
  ]),
);

export const MUTATION_OPERATORS = Object.freeze([
  'add-legal-artifact-after-attestation',
  'rewrite-existing-artifact-after-attestation',
  'flip-executable-bit-after-attestation',
  'replace-with-hardlink-after-attestation',
  'none',
  'mutate-source-after-attestation',
]);

export const FAILPOINTS = Object.freeze([
  'none',
  'sync-host-surface:post-publish',
]);

export const PRODUCTION_CHECKPOINTS = Object.freeze([
  'projectAndPublishHostSurface:return',
  'projectAndPublishHostSurface:throw',
  'sync-host-surface:injectLateFault:after-compile-attestation-before-publish',
  'sync-host-surface:injectPostPublishFault:after-publish',
  'postcondition:live-snapshot',
]);

let warmRoot = null;
let warmRepo = null;

function rmWarmRoot() {
  if (warmRoot) fs.rmSync(warmRoot, { recursive: true, force: true });
  warmRoot = null;
  warmRepo = null;
}

process.once('exit', rmWarmRoot);

function validateInput({ host, surface, mutation, failpoint, seed }) {
  if (!HOSTS.has(host)) throw new TypeError(`unsupported host: ${host}`);
  if (!SURFACES.has(surface)) throw new TypeError(`unsupported surface: ${surface}`);
  if (!MUTATION_OPERATORS.includes(mutation)) {
    throw new TypeError(`unsupported mutation: ${mutation}`);
  }
  if (!FAILPOINTS.includes(failpoint)) {
    throw new TypeError(`unsupported failpoint: ${failpoint}`);
  }
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new TypeError(`seed must be a non-negative safe integer: ${seed}`);
  }
}

function spawnProduction({
  repoRoot,
  host,
  mutation,
  failpoint,
  seed,
  workRoot,
}) {
  const tracePath = path.join(workRoot, 'production-trace.jsonl');
  const resultPath = path.join(workRoot, 'production-result.json');
  const stamp = `tpt-${seed}-${canonicalHash('scenario-stamp', {
    host,
    mutation,
    failpoint,
    seed,
  }).slice(0, 12)}`;
  const child = spawnSync(
    process.execPath,
    [
      DRIVER,
      JSON.stringify({
        repoRoot,
        host,
        stamp,
        mutation,
        failpoint,
        seed,
        tracePath,
        resultPath,
      }),
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const markers = fs.existsSync(tracePath)
    ? fs
        .readFileSync(tracePath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
  const result = fs.existsSync(resultPath)
    ? JSON.parse(fs.readFileSync(resultPath, 'utf8'))
    : null;
  return {
    status: child.status,
    signal: child.signal,
    markers,
    result,
  };
}

function ensureWarmBaseline(host) {
  if (warmRepo) return warmRepo;
  warmRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-production-warm-'));
  warmRepo = path.join(warmRoot, 'repo');
  copyMinimalSkillKnowledgeRepo(warmRepo);
  const workRoot = path.join(warmRoot, 'baseline-driver');
  fs.mkdirSync(workRoot);
  const baseline = spawnProduction({
    repoRoot: warmRepo,
    host,
    mutation: 'none',
    failpoint: 'none',
    seed: 0,
    workRoot,
  });
  if (
    baseline.status !== 0 ||
    baseline.result?.production_returned !== true ||
    baseline.result?.committed !== true
  ) {
    rmWarmRoot();
    throw new Error(
      `TPT-SCENARIO-BASELINE-PRECONDITION: real production baseline failed ` +
        `${canonicalJson({
          status: baseline.status,
          signal: baseline.signal,
          result: baseline.result,
          checkpoints: baseline.markers.map(({ checkpoint }) => checkpoint),
        })}`,
    );
  }
  return warmRepo;
}

function observeSnapshot(absolute, rootId) {
  try {
    return { snapshot: captureTreeSnapshot(absolute, { rootId }), error: null };
  } catch (error) {
    if (!(error instanceof SnapshotOracleError)) throw error;
    return {
      snapshot: null,
      error: {
        code: error.code,
        witness_sha256: error.witness_sha256,
      },
    };
  }
}

function rawForensicFingerprint(root) {
  const rows = [];
  function visit(absolute, relative) {
    for (const name of fs.readdirSync(absolute).sort((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right)),
    )) {
      const child = path.join(absolute, name);
      const childRelative = relative ? `${relative}/${name}` : name;
      const stat = fs.lstatSync(child);
      if (stat.isSymbolicLink()) {
        rows.push({ path: childRelative, kind: 'symlink' });
      } else if (stat.isDirectory()) {
        rows.push({
          path: childRelative,
          kind: 'directory',
          mode: stat.mode & 0o7777,
          nlink: stat.nlink,
        });
        visit(child, childRelative);
      } else if (stat.isFile()) {
        rows.push({
          path: childRelative,
          kind: 'file',
          mode: stat.mode & 0o7777,
          nlink: stat.nlink,
          bytes_sha256: canonicalHash('forensic-file', {
            hex: fs.readFileSync(child).toString('hex'),
          }),
        });
      } else {
        rows.push({ path: childRelative, kind: 'special' });
      }
    }
  }
  visit(root, '');
  return canonicalHash('forensic-tree', rows);
}

function prepareLegitimateSourceUpdate(repoRoot, seed) {
  const relative = 'plugin/src/hooks/_shared/deadline-risk-core.js';
  const absolute = path.join(repoRoot, relative);
  fs.appendFileSync(absolute, `\n// tpt legitimate source update ${seed}\n`);
  return canonicalHash('logical-path', { path: relative });
}

function listProductionResidues(repoRoot) {
  const distParent = path.join(repoRoot, 'plugin/dist');
  return fs
    .readdirSync(distParent)
    .filter((name) => /\.(?:write|bak)-/u.test(name))
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

function violation(invariant, code, checkpoint, expected, actual) {
  return {
    invariant,
    code,
    checkpoint,
    expected_sha256: expected ?? null,
    actual_sha256: actual ?? null,
  };
}

function stateForCheckpoint(checkpoint, result) {
  if (
    checkpoint ===
    'sync-host-surface:injectLateFault:after-compile-attestation-before-publish'
  ) {
    return 'CANDIDATE_BUILT';
  }
  if (
    checkpoint === 'sync-host-surface:injectPostPublishFault:after-publish' ||
    checkpoint === 'projectAndPublishHostSurface:throw'
  ) {
    return 'RECOVERY_REQUIRED';
  }
  if (checkpoint === 'projectAndPublishHostSurface:return') return 'COMMITTED';
  return result.contractOk ? 'CLEANED' : 'RECOVERY_REQUIRED';
}

export function evaluateProductionObservation({
  markers,
  processStatus,
  productionResult,
  sourceBefore,
  sourceAfter,
  liveBefore,
  liveAfter,
  liveBeforeForensicSha256,
  liveAfterForensicSha256,
  productionResidues,
}) {
  const lateCheckpoint =
    'sync-host-surface:injectLateFault:after-compile-attestation-before-publish';
  const applied = markers.find(({ checkpoint }) => checkpoint === 'mutation:applied');
  const observedMutation = applied?.details?.mutation ?? null;
  const committed = productionResult?.committed === true;
  const liveChanged =
    liveAfterForensicSha256 !== liveBeforeForensicSha256;
  const violations = [];

  if (committed && observedMutation) {
    if (
      [
        'add-legal-artifact-after-attestation',
        'rewrite-existing-artifact-after-attestation',
        'flip-executable-bit-after-attestation',
      ].includes(observedMutation)
    ) {
      violations.push(
        violation(
          'P1',
          'TPT-P1-PLAN-EXACTNESS',
          lateCheckpoint,
          liveBefore.tree_sha256,
          liveAfter.snapshot?.tree_sha256 ?? liveAfter.error?.witness_sha256,
        ),
      );
    } else if (observedMutation === 'replace-with-hardlink-after-attestation') {
      violations.push(
        violation(
          'P2',
          'TPT-P2-PORTABLE-IDENTITY',
          lateCheckpoint,
          liveBefore.tree_sha256,
          liveAfter.error?.witness_sha256,
        ),
      );
    } else if (observedMutation === 'mutate-source-after-attestation') {
      violations.push(
        violation(
          'P3',
          'TPT-P3-SOURCE-FRESHNESS',
          lateCheckpoint,
          sourceBefore.tree_sha256,
          sourceAfter.tree_sha256,
        ),
      );
    }
    violations.push(
      violation(
        'P4',
        'TPT-P4-UNVERIFIED-COMMIT',
        productionResult.production_returned
          ? 'projectAndPublishHostSurface:return'
          : 'sync-host-surface:injectPostPublishFault:after-publish',
        canonicalHash('expected-commit-gate', { verified_exact_content: true }),
        canonicalHash('actual-commit-gate', {
          mutation_after_attestation: observedMutation,
          committed: true,
        }),
      ),
    );
  }
  if (
    processStatus !== 0 &&
    (liveChanged || productionResidues.length > 0)
  ) {
    violations.push(
      violation(
        'P5',
        'TPT-P5-FAILURE-ATOMICITY',
        'projectAndPublishHostSurface:throw',
        liveBeforeForensicSha256,
        liveAfterForensicSha256,
      ),
    );
  }
  violations.sort(
    (left, right) =>
      INVARIANT_ORDER.get(left.invariant) - INVARIANT_ORDER.get(right.invariant),
  );
  return {
    ok: violations.length === 0,
    primary_violation: violations[0]?.invariant ?? null,
    violations,
    observed_mutation: observedMutation,
    live_changed: liveChanged,
  };
}

/**
 * Execute one explicit RED property against the real production orchestration.
 *
 * A production-built warmed baseline is reused inside this process, then copied
 * to a private temp repo. Each scenario invokes projectAndPublishHostSurface in
 * a real child process and only uses its documented test seams.
 */
export function runScenario({
  host,
  surface,
  mutation,
  failpoint = 'none',
  seed = 0,
}) {
  const input = { host, surface, mutation, failpoint, seed };
  validateInput(input);
  const baselineRepo = ensureWarmBaseline(host);
  const scenarioRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-production-scenario-'));
  const repoRoot = path.join(scenarioRoot, 'repo');
  const workRoot = path.join(scenarioRoot, 'driver');
  fs.cpSync(baselineRepo, repoRoot, { recursive: true, verbatimSymlinks: true });
  fs.mkdirSync(workRoot);

  try {
    if (mutation === 'none' && failpoint === 'sync-host-surface:post-publish') {
      prepareLegitimateSourceUpdate(repoRoot, seed);
    }
    const sourceRoot = path.join(repoRoot, 'plugin/src');
    const liveRoot = path.join(repoRoot, 'plugin/dist', host);
    const sourceBefore = captureTreeSnapshot(sourceRoot, { rootId: 'source' });
    const liveBefore = captureTreeSnapshot(liveRoot, { rootId: 'live-before' });
    const rawBefore = rawForensicFingerprint(liveRoot);

    const production = spawnProduction({
      repoRoot,
      host,
      mutation,
      failpoint,
      seed,
      workRoot,
    });
    if (production.status === null) {
      throw new Error(
        `TPT-SCENARIO-PRODUCTION-NO-STATUS: signal=${production.signal ?? 'none'}`,
      );
    }
    const checkpoints = production.markers.map(({ checkpoint }) => checkpoint);
    const lateCheckpoint =
      'sync-host-surface:injectLateFault:after-compile-attestation-before-publish';
    if (!checkpoints.includes(lateCheckpoint)) {
      throw new Error(
        `TPT-SCENARIO-PRODUCTION-CHECKPOINT-MISSING: ${lateCheckpoint}; ` +
          `observed=${canonicalJson(checkpoints)}`,
      );
    }
    if (!production.result) {
      throw new Error(
        `TPT-SCENARIO-PRODUCTION-RESULT-MISSING: ${canonicalJson({
          status: production.status,
          checkpoints,
        })}`,
      );
    }

    const sourceAfter = captureTreeSnapshot(sourceRoot, { rootId: 'source' });
    const liveAfter = observeSnapshot(liveRoot, 'live-after');
    const rawAfter = rawForensicFingerprint(liveRoot);
    const productionResidues = listProductionResidues(repoRoot);
    const evaluation = evaluateProductionObservation({
      markers: production.markers,
      processStatus: production.status,
      productionResult: production.result,
      sourceBefore,
      sourceAfter,
      liveBefore,
      liveAfter,
      liveBeforeForensicSha256: rawBefore,
      liveAfterForensicSha256: rawAfter,
      productionResidues,
    });
    const { violations } = evaluation;
    const contractOk = evaluation.ok;
    const liveChanged = evaluation.live_changed;
    const trace = production.markers
      .filter(({ checkpoint }) => PRODUCTION_CHECKPOINTS.includes(checkpoint))
      .map(({ checkpoint, details }, index) => ({
        seq: index,
        checkpoint,
        state: stateForCheckpoint(checkpoint, { contractOk }),
        observation_sha256: canonicalHash('production-observation', {
          checkpoint,
          details,
        }),
      }));
    trace.push({
      seq: trace.length,
      checkpoint: 'postcondition:live-snapshot',
      state: contractOk ? 'CLEANED' : 'RECOVERY_REQUIRED',
      observation_sha256: canonicalHash('production-observation', {
        checkpoint: 'postcondition:live-snapshot',
        process_status: production.status,
        live_changed: liveChanged,
        content_id: liveAfter.snapshot?.artifact_content_id ?? null,
        oracle_error: liveAfter.error,
        production_residues: productionResidues,
      }),
    });

    const witness = {
      schema: 'cc-master/trusted-projection-scenario-witness/v1alpha1',
      scenario_id: `tpt:scenario:${canonicalHash('scenario', input)}`,
      host,
      surface,
      seed,
      operator: { mutation, failpoint },
      production_subject: SUBJECT,
      trace,
      outcome: {
        process_status: production.status,
        production_returned: production.result.production_returned,
        production_error_code: production.result.production_error_code,
        live_changed: liveChanged,
        live_before_content_id: liveBefore.artifact_content_id,
        live_after_content_id: liveAfter.snapshot?.artifact_content_id ?? null,
        live_before_forensic_sha256: rawBefore,
        live_after_forensic_sha256: rawAfter,
        production_residues: productionResidues,
      },
      contract: {
        ok: contractOk,
        primary_violation: violations[0]?.invariant ?? null,
        violations,
      },
    };
    assertScenarioWitness(witness);
    return witness;
  } finally {
    fs.rmSync(scenarioRoot, { recursive: true, force: true });
  }
}

export function assertScenarioWitness(witness) {
  assert.equal(
    witness?.schema,
    'cc-master/trusted-projection-scenario-witness/v1alpha1',
  );
  assert.match(witness.scenario_id, /^tpt:scenario:[a-f0-9]{64}$/u);
  assert.ok(HOSTS.has(witness.host));
  assert.ok(SURFACES.has(witness.surface));
  assert.ok(MUTATION_OPERATORS.includes(witness.operator?.mutation));
  assert.ok(FAILPOINTS.includes(witness.operator?.failpoint));
  assert.equal(witness.production_subject, SUBJECT);
  assert.ok(Array.isArray(witness.trace) && witness.trace.length > 0);
  witness.trace.forEach((row, index) => {
    assert.equal(row.seq, index);
    assert.ok(PRODUCTION_CHECKPOINTS.includes(row.checkpoint));
    assert.match(row.observation_sha256, SHA256);
  });
  assert.ok(Number.isInteger(witness.outcome.process_status));
  assert.match(witness.outcome.live_before_content_id, CONTENT_ID);
  assert.match(witness.outcome.live_before_forensic_sha256, SHA256);
  assert.match(witness.outcome.live_after_forensic_sha256, SHA256);
  assert.ok(Array.isArray(witness.outcome.production_residues));
  if (witness.outcome.live_after_content_id !== null) {
    assert.match(witness.outcome.live_after_content_id, CONTENT_ID);
  }
  assert.equal(witness.contract.ok, witness.contract.violations.length === 0);
  assert.equal(
    witness.contract.primary_violation,
    witness.contract.violations[0]?.invariant ?? null,
  );
  return true;
}

export function clearScenarioWarmCacheForTests() {
  rmWarmRoot();
}
