import {
  canonicalHash,
  canonicalJson,
  computeArtifactId,
  computeContentId,
  computeTreeSha256,
} from './canonical-contract.mjs';

const TRANSITIONS = Object.freeze({
  NEW: new Set(['LOCKED', 'ABORTED']),
  LOCKED: new Set(['SOURCE_FROZEN', 'ABORTED']),
  SOURCE_FROZEN: new Set(['PLAN_FROZEN', 'ABORTED']),
  PLAN_FROZEN: new Set(['CANDIDATE_BUILT', 'ABORTED']),
  CANDIDATE_BUILT: new Set(['VERIFIED', 'ABORTED']),
  VERIFIED: new Set(['SEALED', 'ABORTED']),
  SEALED: new Set(['COMMIT_PREPARED', 'ABORTED']),
  COMMIT_PREPARED: new Set(['COMMITTING', 'ABORTED']),
  COMMITTING: new Set(['COMMITTED', 'ABORTED', 'RECOVERY_REQUIRED']),
  COMMITTED: new Set(['CLEANED', 'RECOVERY_REQUIRED']),
  CLEANED: new Set(),
  ABORTED: new Set(),
  RECOVERY_REQUIRED: new Set(),
});

function same(left, right) {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function comparePath(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function diagnostic(invariant, code, path, witness = {}) {
  return { invariant, code, path, witness };
}

function validateEntries(entries, path, diagnostics) {
  const paths = entries.map((entry) => entry.path);
  const sorted = [...paths].sort(comparePath);
  if (!same(paths, sorted) || new Set(paths).size !== paths.length) {
    diagnostics.push(
      diagnostic('P8', 'TPT-SEMANTIC-ENTRY-ORDER-OR-DUPLICATE', path, {
        paths,
      }),
    );
  }
  for (const [index, entry] of entries.entries()) {
    if (entry.path !== entry.path.normalize('NFC')) {
      diagnostics.push(
        diagnostic('P2', 'TPT-SEMANTIC-NON-NFC-PATH', `${path}/${index}/path`),
      );
    }
    if (entry.executable !== ((entry.posix_mode & 0o111) !== 0)) {
      diagnostics.push(
        diagnostic('P2', 'TPT-SEMANTIC-MODE-MISMATCH', `${path}/${index}`),
      );
    }
  }

  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const entry of entries) {
    if (entry.kind !== 'directory') continue;
    const prefix = entry.path === '.' ? '' : `${entry.path}/`;
    const directChildren = entries
      .filter((candidate) => {
        if (candidate.path === entry.path || !candidate.path.startsWith(prefix)) {
          return false;
        }
        return !candidate.path.slice(prefix.length).includes('/');
      })
      .map((candidate) => ({
        path: candidate.path,
        kind: candidate.kind,
        sha256: candidate.sha256,
        size: candidate.size,
        executable: candidate.executable,
        posix_mode: candidate.posix_mode,
      }))
      .sort((left, right) => comparePath(left.path, right.path));
    let expected;
    try {
      expected = canonicalHash('directory-entry', directChildren);
    } catch {
      diagnostics.push(
        diagnostic('P2', 'TPT-SEMANTIC-NONCANONICAL-ENTRY', `${path}/${entry.path}`),
      );
      continue;
    }
    if (entry.sha256 !== expected) {
      diagnostics.push(
        diagnostic('P2', 'TPT-SEMANTIC-DIRECTORY-HASH', `${path}/${entry.path}`, {
          expected,
          actual: entry.sha256,
        }),
      );
    }
  }
  if (!byPath.has('.') || byPath.get('.')?.kind !== 'directory') {
    diagnostics.push(
      diagnostic('P2', 'TPT-SEMANTIC-ROOT-DIRECTORY-MISSING', path),
    );
  }
}

function validateContentClaim(artifact, entriesField, contentField, treeField, path, diagnostics) {
  const entries = artifact[entriesField];
  validateEntries(entries, `${path}/${entriesField}`, diagnostics);
  let treeSha256;
  let contentId;
  try {
    treeSha256 = computeTreeSha256(entries);
    contentId = computeContentId(entries);
  } catch {
    diagnostics.push(
      diagnostic('P2', 'TPT-SEMANTIC-NONCANONICAL-CONTENT', path),
    );
    return;
  }
  if (artifact[treeField] !== treeSha256) {
    diagnostics.push(
      diagnostic('P6', 'TPT-SEMANTIC-TREE-HASH', `${path}/${treeField}`, {
        expected: treeSha256,
        actual: artifact[treeField],
      }),
    );
  }
  if (artifact[contentField] !== contentId) {
    diagnostics.push(
      diagnostic('P6', 'TPT-SEMANTIC-CONTENT-ID', `${path}/${contentField}`, {
        expected: contentId,
        actual: artifact[contentField],
      }),
    );
  }
}

function validateArtifactId(kind, artifact, field, path, diagnostics) {
  let expected;
  try {
    expected = computeArtifactId(kind, artifact);
  } catch {
    diagnostics.push(
      diagnostic('P6', 'TPT-SEMANTIC-NONCANONICAL-ARTIFACT', `${path}/${field}`),
    );
    return;
  }
  if (artifact[field] !== expected) {
    diagnostics.push(
      diagnostic('P6', 'TPT-SEMANTIC-ARTIFACT-ID', `${path}/${field}`, {
        expected,
        actual: artifact[field],
      }),
    );
  }
}

function deriveExpected(plan, inputEntries, trustedPolicies, path, diagnostics) {
  const policy = trustedPolicies[plan.trusted_policy_id];
  if (!policy) {
    diagnostics.push(
      diagnostic('P1', 'TPT-SEMANTIC-UNTRUSTED-POLICY', `${path}/trusted_policy_id`),
    );
    return null;
  }
  const expectedPolicyHash = canonicalHash('trusted-policy', policy.declaration);
  if (plan.trusted_policy_sha256 !== expectedPolicyHash) {
    diagnostics.push(
      diagnostic('P1', 'TPT-SEMANTIC-POLICY-HASH', `${path}/trusted_policy_sha256`, {
        expected: expectedPolicyHash,
        actual: plan.trusted_policy_sha256,
      }),
    );
    return null;
  }
  let derived;
  try {
    derived = policy.derive(inputEntries, plan.operations);
  } catch (error) {
    diagnostics.push(
      diagnostic('P1', 'TPT-SEMANTIC-PLAN-DERIVATION', `${path}/operations`, {
        error: error?.message ?? String(error),
      }),
    );
    return null;
  }
  if (!same(plan.expected_entries, derived)) {
    diagnostics.push(
      diagnostic('P1', 'TPT-SEMANTIC-EXPECTED-SSOT', `${path}/expected_entries`, {
        derived_sha256: computeTreeSha256(derived),
        claimed_sha256: computeTreeSha256(plan.expected_entries),
      }),
    );
  }
  return derived;
}

function validateChecks(checks, required, path, diagnostics) {
  const ids = checks.map((check) => check.invariant);
  if (new Set(ids).size !== ids.length) {
    diagnostics.push(
      diagnostic('P8', 'TPT-SEMANTIC-DUPLICATE-CHECK', path, { ids }),
    );
  }
  for (const invariant of required) {
    const check = checks.find((candidate) => candidate.invariant === invariant);
    if (!check || check.ok !== true) {
      diagnostics.push(
        diagnostic(invariant, 'TPT-SEMANTIC-CHECK-NOT-PASS', path, {
          invariant,
        }),
      );
    }
  }
}

function validateTrace(trace, diagnostics) {
  if (!Array.isArray(trace) || trace.length === 0 || trace[0] !== 'NEW') {
    diagnostics.push(diagnostic('P8', 'TPT-SEMANTIC-TRACE-START', '/trace'));
    return;
  }
  for (let index = 1; index < trace.length; index += 1) {
    if (!TRANSITIONS[trace[index - 1]]?.has(trace[index])) {
      diagnostics.push(
        diagnostic('P8', 'TPT-SEMANTIC-ILLEGAL-TRANSITION', `/trace/${index}`, {
          from: trace[index - 1],
          to: trace[index],
        }),
      );
    }
  }
}

function validateFreshSourceObservation(observation, frozen, path, diagnostics) {
  validateEntries(observation.entries, `${path}/entries`, diagnostics);
  let treeSha256;
  let contentId;
  let snapshotId;
  try {
    treeSha256 = computeTreeSha256(observation.entries);
    contentId = computeContentId(observation.entries);
    snapshotId = computeArtifactId('source-snapshot', observation);
  } catch {
    diagnostics.push(
      diagnostic('P3', 'TPT-SEMANTIC-SOURCE-OBSERVATION-INVALID', path),
    );
    return;
  }
  if (
    observation.tree_sha256 !== treeSha256 ||
    observation.source_content_id !== contentId ||
    observation.source_snapshot_id !== snapshotId ||
    treeSha256 !== frozen.tree_sha256 ||
    contentId !== frozen.source_content_id ||
    snapshotId !== frozen.source_snapshot_id
  ) {
    diagnostics.push(
      diagnostic('P3', 'TPT-SEMANTIC-SOURCE-OBSERVATION-INVALID', path, {
        recomputed_tree_sha256: treeSha256,
        recomputed_content_id: contentId,
        recomputed_snapshot_id: snapshotId,
      }),
    );
  }
}

export function validateTrustedProjectionFixture(fixture, { trustedPolicies }) {
  const diagnostics = [];
  const {
    sourceSnapshot: source,
    sourceAtVerify,
    sourceAtCommitPrepare,
    hostPlan,
    candidateSnapshot: candidate,
    verifiedSnapshotAttestation: verified,
    liveBeforeSnapshot,
    liveAfterSnapshot,
    publishReceipt: receipt,
    bundlePlan,
    extractedSnapshot,
    releaseBundleAttestation: release,
  } = fixture;

  validateContentClaim(
    source,
    'entries',
    'source_content_id',
    'tree_sha256',
    '/sourceSnapshot',
    diagnostics,
  );
  validateArtifactId(
    'source-snapshot',
    source,
    'source_snapshot_id',
    '/sourceSnapshot',
    diagnostics,
  );
  for (const [name, snapshot] of [
    ['candidateSnapshot', candidate],
    ['liveBeforeSnapshot', liveBeforeSnapshot],
    ['liveAfterSnapshot', liveAfterSnapshot],
    ['extractedSnapshot', extractedSnapshot],
  ]) {
    validateContentClaim(
      snapshot,
      'entries',
      'artifact_content_id',
      'tree_sha256',
      `/${name}`,
      diagnostics,
    );
    validateArtifactId(
      'artifact-snapshot',
      snapshot,
      'artifact_snapshot_id',
      `/${name}`,
      diagnostics,
    );
  }

  const derivedHost = deriveExpected(
    hostPlan,
    source.entries,
    trustedPolicies,
    '/hostPlan',
    diagnostics,
  );
  validateArtifactId(
    'projection-plan',
    hostPlan,
    'projection_plan_id',
    '/hostPlan',
    diagnostics,
  );
  if (
    hostPlan.input_kind !== 'source_snapshot' ||
    hostPlan.input_snapshot_id !== source.source_snapshot_id ||
    hostPlan.input_content_id !== source.source_content_id
  ) {
    diagnostics.push(
      diagnostic('P6', 'TPT-SEMANTIC-HOST-PLAN-INPUT', '/hostPlan'),
    );
  }
  if (derivedHost && !same(candidate.entries, derivedHost)) {
    diagnostics.push(
      diagnostic('P1', 'TPT-SEMANTIC-CANDIDATE-PLAN-MISMATCH', '/candidateSnapshot'),
    );
  }

  validateFreshSourceObservation(
    sourceAtVerify,
    source,
    '/sourceAtVerify',
    diagnostics,
  );
  validateFreshSourceObservation(
    sourceAtCommitPrepare,
    source,
    '/sourceAtCommitPrepare',
    diagnostics,
  );

  const transactionIds = [
    ['sourceSnapshot', source.transaction_id],
    ['hostPlan', hostPlan.transaction_id],
    ['bundlePlan', bundlePlan.transaction_id],
    ['verifiedSnapshotAttestation', verified.transaction_id],
    ['publishReceipt', receipt.transaction_id],
    ['releaseBundleAttestation', release.transaction_id],
  ];
  if (transactionIds.some(([, id]) => id !== source.transaction_id)) {
    diagnostics.push(
      diagnostic('P6', 'TPT-SEMANTIC-TRANSACTION-SPLIT', '/transaction_id', {
        transaction_ids: Object.fromEntries(transactionIds),
      }),
    );
  }

  validateArtifactId(
    'verified-snapshot-attestation',
    verified,
    'verified_snapshot_attestation_id',
    '/verifiedSnapshotAttestation',
    diagnostics,
  );
  validateChecks(
    verified.checks,
    ['P1', 'P2', 'P3', 'P4', 'P6', 'P8'],
    '/verifiedSnapshotAttestation/checks',
    diagnostics,
  );
  if (
    verified.source_snapshot_id !== source.source_snapshot_id ||
    verified.projection_plan_id !== hostPlan.projection_plan_id ||
    verified.candidate_snapshot_id !== candidate.artifact_snapshot_id ||
    verified.authorized_content_id !== candidate.artifact_content_id ||
    verified.sealed_content_id !== candidate.artifact_content_id
  ) {
    diagnostics.push(
      diagnostic('P4', 'TPT-SEMANTIC-ATTESTATION-CANDIDATE-MISMATCH', '/verifiedSnapshotAttestation'),
    );
  }

  validateArtifactId(
    'publish-receipt',
    receipt,
    'publish_receipt_id',
    '/publishReceipt',
    diagnostics,
  );
  if (
    receipt.verified_snapshot_attestation_id !==
    verified.verified_snapshot_attestation_id
  ) {
    diagnostics.push(
      diagnostic('P6', 'TPT-SEMANTIC-RECEIPT-ATTESTATION-MISMATCH', '/publishReceipt'),
    );
  }
  if (receipt.outcome === 'committed') {
    if (
      receipt.live_before_snapshot_id !== liveBeforeSnapshot.artifact_snapshot_id ||
      receipt.live_after_snapshot_id !== liveAfterSnapshot.artifact_snapshot_id ||
      receipt.committed_content_id !== liveAfterSnapshot.artifact_content_id ||
      receipt.committed_content_id !== verified.authorized_content_id
    ) {
      diagnostics.push(
        diagnostic('P5', 'TPT-SEMANTIC-COMMITTED-OUTCOME-MISMATCH', '/publishReceipt'),
      );
    }
  } else if (receipt.outcome !== 'recovery_required') {
    diagnostics.push(
      diagnostic('P5', 'TPT-SEMANTIC-UNKNOWN-PUBLISH-OUTCOME', '/publishReceipt'),
    );
  }

  const derivedBundle = deriveExpected(
    bundlePlan,
    liveAfterSnapshot.entries,
    trustedPolicies,
    '/bundlePlan',
    diagnostics,
  );
  validateArtifactId(
    'projection-plan',
    bundlePlan,
    'projection_plan_id',
    '/bundlePlan',
    diagnostics,
  );
  if (
    bundlePlan.surface !== 'release_bundle' ||
    bundlePlan.input_kind !== 'committed_artifact' ||
    bundlePlan.input_snapshot_id !== liveAfterSnapshot.artifact_snapshot_id ||
    bundlePlan.input_content_id !== liveAfterSnapshot.artifact_content_id ||
    bundlePlan.upstream_publish_receipt_id !== receipt.publish_receipt_id ||
    receipt.outcome !== 'committed'
  ) {
    diagnostics.push(
      diagnostic('P7', 'TPT-SEMANTIC-BUNDLE-PLAN-INPUT', '/bundlePlan'),
    );
  }
  if (derivedBundle && !same(extractedSnapshot.entries, derivedBundle)) {
    diagnostics.push(
      diagnostic('P7', 'TPT-SEMANTIC-EXTRACTION-PLAN-MISMATCH', '/extractedSnapshot'),
    );
  }
  validateArtifactId(
    'release-bundle-attestation',
    release,
    'release_bundle_attestation_id',
    '/releaseBundleAttestation',
    diagnostics,
  );
  validateChecks(
    release.checks,
    ['P6', 'P7', 'P8'],
    '/releaseBundleAttestation/checks',
    diagnostics,
  );
  if (
    release.publish_receipt_id !== receipt.publish_receipt_id ||
    release.bundle_projection_plan_id !== bundlePlan.projection_plan_id ||
    release.extracted_snapshot_id !== extractedSnapshot.artifact_snapshot_id ||
    release.extracted_content_id !== extractedSnapshot.artifact_content_id
  ) {
    diagnostics.push(
      diagnostic('P7', 'TPT-SEMANTIC-RELEASE-CHAIN-MISMATCH', '/releaseBundleAttestation'),
    );
  }

  validateTrace(fixture.trace, diagnostics);
  return { ok: diagnostics.length === 0, diagnostics };
}

export function rehashArtifact(kind, artifact) {
  const fields = {
    'source-snapshot': 'source_snapshot_id',
    'projection-plan': 'projection_plan_id',
    'artifact-snapshot': 'artifact_snapshot_id',
    'verified-snapshot-attestation': 'verified_snapshot_attestation_id',
    'publish-receipt': 'publish_receipt_id',
    'release-bundle-attestation': 'release_bundle_attestation_id',
  };
  const field = fields[kind];
  if (!field) throw new Error(`unknown artifact kind ${kind}`);
  artifact[field] = computeArtifactId(kind, artifact);
  return artifact;
}

export function rehashSnapshot(snapshot) {
  snapshot.tree_sha256 = computeTreeSha256(snapshot.entries);
  const contentField =
    snapshot.schema === 'cc-master/trusted-projection/source-snapshot/v1alpha1'
      ? 'source_content_id'
      : 'artifact_content_id';
  snapshot[contentField] = computeContentId(snapshot.entries);
  return rehashArtifact(
    contentField === 'source_content_id' ? 'source-snapshot' : 'artifact-snapshot',
    snapshot,
  );
}
