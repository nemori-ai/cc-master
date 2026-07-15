import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import * as engine from '../dist/index.mjs';
import {
  CANONICAL_LAUNCH_IDENTITY_SCHEMA,
  normalizeCanonicalLaunchIdentity,
  sha256Hex,
} from '../dist/index.mjs';

function identity(): Record<string, unknown> {
  return {
    schema: CANONICAL_LAUNCH_IDENTITY_SCHEMA,
    origin: { harness: 'codex', session_ref: 'session-ref:r7-red' },
    target: {
      harness: 'cursor',
      adapter: 'cursor/agent-cli-v1',
      surface: 'cli-headless',
      transport: 'cursor-agent-json-stream-v1',
      candidate_id: 'cursor-cli-composer-standard',
    },
    provider: { id: 'cursor', model: 'composer-2.5', effort: 'standard' },
    account: {
      fingerprint_ref: 'account-ref:opaque-owner-reference',
      account_id: 'payer-first-party-fixture',
      pool_id: 'cursor:first-party:fixture',
      identity_fingerprint:
        'sha256:5555555555555555555555555555555555555555555555555555555555555555',
    },
    workspace: {
      workspace_ref: 'workspace:cursor-fixture',
      worktree_ref: 'worktree:cursor-fixture',
      baseline_commit: '1111111111111111111111111111111111111111',
    },
    permission: {
      snapshot_ref: 'permission:cursor-fixture',
      profile: 'workspace-write',
      denies: ['account-mutation', 'credential-write', 'push-remote'],
    },
    input: { digest: `sha256:${'2'.repeat(64)}` },
    request: { digest: `sha256:${'3'.repeat(64)}` },
    dispatch: {
      run_ref: 'ccm-run:v1:cursor-r7-fixture',
      idempotency_key: `sha256:${'4'.repeat(64)}`,
      launch_nonce: 'nonce:cursor-r7-fixture',
      claim_id: 'nonce:cursor-r7-fixture',
    },
    runtime: {
      image_sha256: `sha256:${'6'.repeat(64)}`,
      selector: { kind: 'exact', model_id: 'composer-2.5', effort: 'standard' },
    },
  };
}

test('engine exposes one canonical launch identity and no R6 parallel identity protocol', () => {
  assert.equal(
    existsSync(new URL('../src/agent-launch-intent.ts', import.meta.url)),
    false,
    'R6 parallel launch-intent module must be removed',
  );
  assert.equal(
    existsSync(new URL('../src/agent-attempt-vocabulary.ts', import.meta.url)),
    false,
    'R6 parallel vocabulary module must be removed',
  );
  assert.equal('AGENT_LAUNCH_INTENT_SCHEMA' in engine, false);
  assert.equal('AGENT_ATTEMPT_VOCABULARY' in engine, false);
  assert.equal(engine.CANONICAL_LAUNCH_IDENTITY_SCHEMA, 'ccm/canonical-launch-identity/v1');
});

test('shared SHA-256 matches the bytes Node uses for every spawnable UTF-8 edge', () => {
  const vectors = [
    ['ascii', 'fixture-input'],
    ['lone-high-surrogate', '\ud800'],
    ['lone-low-surrogate', '\udc00'],
    ['reversed-surrogates', '\udc00\ud800'],
    ['paired-surrogate', '\ud83d\ude42'],
    ['emoji-and-cjk', '跨 harness 🙂'],
    ['combining-sequence', 'e\u0301'],
    ['embedded-nul-hash-semantics', 'left\0right'],
  ] as const;
  for (const [id, input] of vectors) {
    const expected = createHash('sha256').update(Buffer.from(input, 'utf8')).digest('hex');
    assert.equal(sha256Hex(input), expected, id);
  }
});

test('canonical identity rejects every counterfeit identity/runtime SHA-256 shape', () => {
  const invalid = [
    'sha256:x',
    `sha256:${'a'.repeat(63)}`,
    `sha256:${'a'.repeat(65)}`,
    `sha256:${'A'.repeat(64)}`,
    `sha256:${'a'.repeat(32)}/${'b'.repeat(31)}`,
    ` sha256:${'a'.repeat(64)}`,
    `sha256:${'a'.repeat(64)} `,
  ];
  assert.doesNotThrow(() => normalizeCanonicalLaunchIdentity(identity()));
  for (const digest of invalid) {
    const badIdentity = structuredClone(identity());
    (badIdentity.account as Record<string, unknown>).identity_fingerprint = digest;
    assert.throws(
      () => normalizeCanonicalLaunchIdentity(badIdentity),
      /CANONICAL-LAUNCH-IDENTITY-INVALID/,
      `identity_fingerprint=${digest}`,
    );
    const badRuntime = structuredClone(identity());
    (badRuntime.runtime as Record<string, unknown>).image_sha256 = digest;
    assert.throws(
      () => normalizeCanonicalLaunchIdentity(badRuntime),
      /CANONICAL-LAUNCH-IDENTITY-INVALID/,
      `runtime.image_sha256=${digest}`,
    );
  }
});
