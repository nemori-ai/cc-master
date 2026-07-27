import { createHash } from 'node:crypto';

import {
  canonicalHash,
  computeArtifactId,
  computeContentId,
  computeTreeSha256,
} from './canonical-contract.mjs';

const TRANSACTION_ID = 'tpt:tx:golden-1';

function bytesSha256(bytes) {
  return createHash('sha256').update(bytes, 'utf8').digest('hex');
}

function flatEntries(files) {
  const fileEntries = files
    .map(({ path, bytes, mode = 0o644 }) => ({
      path,
      kind: 'file',
      sha256: bytesSha256(bytes),
      size: Buffer.byteLength(bytes),
      executable: (mode & 0o111) !== 0,
      posix_mode: mode,
    }))
    .sort((left, right) =>
      Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
    );
  const root = {
    path: '.',
    kind: 'directory',
    sha256: canonicalHash('directory-entry', fileEntries),
    size: 0,
    executable: true,
    posix_mode: 0o755,
  };
  return [root, ...fileEntries];
}

function withId(kind, body, idField) {
  const artifact = { ...body, [idField]: '' };
  artifact[idField] = computeArtifactId(kind, artifact);
  return artifact;
}

function artifactSnapshot(rootId, entries) {
  const independentEntries = structuredClone(entries);
  const treeSha256 = computeTreeSha256(independentEntries);
  return withId(
    'artifact-snapshot',
    {
      schema: 'cc-master/trusted-projection/artifact-snapshot/v1alpha1',
      artifact_content_id: computeContentId(independentEntries),
      root_id: rootId,
      mode_model: 'posix-12bit',
      entries: independentEntries,
      tree_sha256: treeSha256,
    },
    'artifact_snapshot_id',
  );
}

export const TRUSTED_POLICIES = Object.freeze({
  'copy-exact.v1': Object.freeze({
    declaration: Object.freeze({
      id: 'copy-exact.v1',
      operators: Object.freeze(['copy-exact']),
      mode_semantics: 'preserve',
    }),
    derive(inputEntries, operations) {
      const byPath = new Map(inputEntries.map((entry) => [entry.path, entry]));
      const files = [];
      for (const operation of operations) {
        if (
          operation.operator !== 'copy-exact' ||
          operation.inputs.length !== operation.outputs.length
        ) {
          throw new Error('unsupported golden copy operation');
        }
        for (let index = 0; index < operation.inputs.length; index += 1) {
          const input = byPath.get(operation.inputs[index]);
          if (!input || input.kind !== 'file') {
            throw new Error(`missing trusted input ${operation.inputs[index]}`);
          }
          files.push({
            path: operation.outputs[index],
            kind: input.kind,
            sha256: input.sha256,
            size: input.size,
            executable: input.executable,
            posix_mode: input.posix_mode,
          });
        }
      }
      files.sort((left, right) =>
        Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
      );
      return [
        {
          path: '.',
          kind: 'directory',
          sha256: canonicalHash('directory-entry', files),
          size: 0,
          executable: true,
          posix_mode: 0o755,
        },
        ...files,
      ];
    },
  }),
});

export function trustedPolicySha256(policyId) {
  const policy = TRUSTED_POLICIES[policyId];
  if (!policy) throw new Error(`unknown trusted policy ${policyId}`);
  return canonicalHash('trusted-policy', policy.declaration);
}

export function buildGoldenTransactionFixture() {
  const sourceEntries = flatEntries([{ path: 'runtime.md', bytes: 'runtime-v1\n' }]);
  const sourceTreeSha256 = computeTreeSha256(sourceEntries);
  const sourceSnapshot = withId(
    'source-snapshot',
    {
      schema: 'cc-master/trusted-projection/source-snapshot/v1alpha1',
      transaction_id: TRANSACTION_ID,
      source_content_id: computeContentId(sourceEntries),
      source_root_id: 'plugin-src',
      git_tree: null,
      mode_model: 'posix-12bit',
      entries: sourceEntries,
      tree_sha256: sourceTreeSha256,
    },
    'source_snapshot_id',
  );

  const operation = {
    operator: 'copy-exact',
    inputs: ['runtime.md'],
    outputs: ['runtime.md'],
    parameters_sha256: canonicalHash('operation-parameters', {
      preserve_mode: true,
    }),
  };
  const hostExpected = TRUSTED_POLICIES['copy-exact.v1'].derive(
    sourceEntries,
    [operation],
  );
  const hostPlan = withId(
    'projection-plan',
    {
      schema: 'cc-master/trusted-projection/projection-plan/v1alpha1',
      transaction_id: TRANSACTION_ID,
      host: 'claude-code',
      surface: 'host',
      input_kind: 'source_snapshot',
      input_snapshot_id: sourceSnapshot.source_snapshot_id,
      input_content_id: sourceSnapshot.source_content_id,
      upstream_publish_receipt_id: null,
      trusted_policy_id: 'copy-exact.v1',
      trusted_policy_sha256: trustedPolicySha256('copy-exact.v1'),
      operations: [operation],
      expected_entries: hostExpected,
    },
    'projection_plan_id',
  );

  const candidateSnapshot = artifactSnapshot('candidate', hostExpected);
  const verifiedSnapshotAttestation = withId(
    'verified-snapshot-attestation',
    {
      schema:
        'cc-master/trusted-projection/verified-snapshot-attestation/v1alpha1',
      transaction_id: TRANSACTION_ID,
      source_snapshot_id: sourceSnapshot.source_snapshot_id,
      projection_plan_id: hostPlan.projection_plan_id,
      candidate_snapshot_id: candidateSnapshot.artifact_snapshot_id,
      authorized_content_id: candidateSnapshot.artifact_content_id,
      verifier_id: 'test-verifier.v1',
      verifier_contract_sha256: canonicalHash('verifier-contract', {
        invariants: ['P1', 'P2', 'P3', 'P4', 'P6', 'P8'],
      }),
      checks: ['P1', 'P2', 'P3', 'P4', 'P6', 'P8'].map((invariant) => ({
        invariant,
        ok: true,
        code: `TPT-${invariant}-PASS`,
        witness_sha256: canonicalHash('check-witness', { invariant }),
      })),
      trace_head_sha256: canonicalHash('trace-head', {
        state: 'SEALED',
      }),
      sealed_content_id: candidateSnapshot.artifact_content_id,
    },
    'verified_snapshot_attestation_id',
  );

  const liveBeforeSnapshot = artifactSnapshot(
    'live-before',
    flatEntries([{ path: 'runtime.md', bytes: 'runtime-old\n' }]),
  );
  const liveAfterSnapshot = artifactSnapshot('live-after', hostExpected);
  const publishReceipt = withId(
    'publish-receipt',
    {
      schema: 'cc-master/trusted-projection/publish-receipt/v1alpha1',
      transaction_id: TRANSACTION_ID,
      verified_snapshot_attestation_id:
        verifiedSnapshotAttestation.verified_snapshot_attestation_id,
      live_before_snapshot_id: liveBeforeSnapshot.artifact_snapshot_id,
      outcome: 'committed',
      live_after_snapshot_id: liveAfterSnapshot.artifact_snapshot_id,
      committed_content_id: liveAfterSnapshot.artifact_content_id,
      commit_method: 'rename-swap.v1',
      durability_barrier: 'parent-directory-fsync',
      backup_retained: false,
      recovery_ref: null,
      trace_head_sha256: canonicalHash('trace-head', {
        state: 'COMMITTED',
      }),
    },
    'publish_receipt_id',
  );

  const bundleOperation = {
    operator: 'copy-exact',
    inputs: ['runtime.md'],
    outputs: ['runtime.md'],
    parameters_sha256: canonicalHash('operation-parameters', {
      archive_root: '.',
    }),
  };
  const bundleExpected = TRUSTED_POLICIES['copy-exact.v1'].derive(
    liveAfterSnapshot.entries,
    [bundleOperation],
  );
  const bundlePlan = withId(
    'projection-plan',
    {
      schema: 'cc-master/trusted-projection/projection-plan/v1alpha1',
      transaction_id: TRANSACTION_ID,
      host: 'claude-code',
      surface: 'release_bundle',
      input_kind: 'committed_artifact',
      input_snapshot_id: liveAfterSnapshot.artifact_snapshot_id,
      input_content_id: liveAfterSnapshot.artifact_content_id,
      upstream_publish_receipt_id: publishReceipt.publish_receipt_id,
      trusted_policy_id: 'copy-exact.v1',
      trusted_policy_sha256: trustedPolicySha256('copy-exact.v1'),
      operations: [bundleOperation],
      expected_entries: bundleExpected,
    },
    'projection_plan_id',
  );
  const extractedSnapshot = artifactSnapshot('extracted-bundle', bundleExpected);
  const releaseBundleAttestation = withId(
    'release-bundle-attestation',
    {
      schema:
        'cc-master/trusted-projection/release-bundle-attestation/v1alpha1',
      transaction_id: TRANSACTION_ID,
      publish_receipt_id: publishReceipt.publish_receipt_id,
      bundle_projection_plan_id: bundlePlan.projection_plan_id,
      archive_sha256: canonicalHash('archive-bytes-fixture', {
        payload: 'golden-archive',
      }),
      archive_format: 'tar.gz',
      extracted_snapshot_id: extractedSnapshot.artifact_snapshot_id,
      extracted_content_id: extractedSnapshot.artifact_content_id,
      checks: ['P6', 'P7', 'P8'].map((invariant) => ({
        invariant,
        ok: true,
        code: `TPT-${invariant}-PASS`,
        witness_sha256: canonicalHash('check-witness', {
          invariant,
          phase: 'release',
        }),
      })),
    },
    'release_bundle_attestation_id',
  );

  return {
    sourceSnapshot,
    sourceAtVerify: structuredClone(sourceSnapshot),
    sourceAtCommitPrepare: structuredClone(sourceSnapshot),
    hostPlan,
    candidateSnapshot,
    verifiedSnapshotAttestation,
    liveBeforeSnapshot,
    liveAfterSnapshot,
    publishReceipt,
    bundlePlan,
    extractedSnapshot,
    releaseBundleAttestation,
    trace: [
      'NEW',
      'LOCKED',
      'SOURCE_FROZEN',
      'PLAN_FROZEN',
      'CANDIDATE_BUILT',
      'VERIFIED',
      'SEALED',
      'COMMIT_PREPARED',
      'COMMITTING',
      'COMMITTED',
      'CLEANED',
    ],
  };
}

export const SIX_ARTIFACT_DEFINITIONS = Object.freeze({
  sourceSnapshot: 'sourceSnapshot',
  hostPlan: 'projectionPlan',
  candidateSnapshot: 'artifactSnapshot',
  verifiedSnapshotAttestation: 'verifiedSnapshotAttestation',
  publishReceipt: 'publishReceipt',
  releaseBundleAttestation: 'releaseBundleAttestation',
});

/**
 * Reviewable constants, generated once from the normative formula and then
 * frozen. Tests compare fresh computation to these literals so changing the
 * canonicalizer/domain cannot silently regenerate its own expected answer.
 */
export const GOLDEN_ARTIFACT_IDS = Object.freeze({
  sourceSnapshot:
    'tpt:source:b5b92532e512feaae16ccf2af6bbc8e560d6cb2ee8c5bd45c25e55c5339a2c46',
  hostPlan:
    'tpt:plan:6b342a10f397dfcea5c57da830cc05f4fe603fe3c4b16745d440890f6cd2fc01',
  candidateSnapshot:
    'tpt:observation:bbb6efc0dc884f1a00e3e37d8d329533494dd2549e9b7a17ddb5f564727aed79',
  verifiedSnapshotAttestation:
    'tpt:verify:c7a6e041eac3e13ce7fc09ab5ecabf953161a888ad15b0683c222c4306494cc0',
  publishReceipt:
    'tpt:publish:036887616ac8954624fadd501120034e520d9a96e243fe937733d1ed5c1548db',
  releaseBundleAttestation:
    'tpt:release:667ba4435f9a621a6c178ef4673feb4f88479f72d05c0d62d394fc5d1bc359a8',
});
