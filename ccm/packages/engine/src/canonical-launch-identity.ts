import { canonicalSha256Digest } from './canonical-digest.js';

export const CANONICAL_LAUNCH_IDENTITY_SCHEMA = 'ccm/canonical-launch-identity/v1';

export const CANONICAL_LAUNCH_IDENTITY_FIELD_REGISTRY = Object.freeze({
  root: Object.freeze([
    'schema',
    'origin',
    'target',
    'provider',
    'account',
    'workspace',
    'permission',
    'input',
    'request',
    'dispatch',
    'runtime',
  ]),
  origin: Object.freeze(['harness', 'session_ref']),
  target: Object.freeze(['harness', 'adapter', 'surface', 'transport', 'candidate_id']),
  provider: Object.freeze(['id', 'model', 'effort']),
  account: Object.freeze(['fingerprint_ref', 'account_id', 'pool_id', 'identity_fingerprint']),
  workspace: Object.freeze(['workspace_ref', 'worktree_ref', 'baseline_commit']),
  permission: Object.freeze(['snapshot_ref', 'profile', 'denies']),
  digest: Object.freeze(['digest']),
  dispatch: Object.freeze(['run_ref', 'idempotency_key', 'launch_nonce', 'claim_id']),
  runtime: Object.freeze(['image_sha256', 'selector']),
  selector: Object.freeze(['kind', 'model_id', 'effort']),
});

type Json = Record<string, unknown>;

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const GIT_COMMIT_RE = /^[0-9a-f]{40}$/;

function object(value: unknown): Json | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function exact(value: Json | undefined, keys: readonly string[]): value is Json {
  if (!value) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function strings(value: Json, keys: readonly string[]): boolean {
  return keys.every((key) => nonempty(value[key]));
}

export function normalizeCanonicalLaunchIdentity(value: unknown): Json {
  const row = object(value);
  const origin = object(row?.origin);
  const target = object(row?.target);
  const provider = object(row?.provider);
  const account = object(row?.account);
  const workspace = object(row?.workspace);
  const permission = object(row?.permission);
  const input = object(row?.input);
  const request = object(row?.request);
  const dispatch = object(row?.dispatch);
  const runtime = object(row?.runtime);
  const selector = object(runtime?.selector);
  const fields = CANONICAL_LAUNCH_IDENTITY_FIELD_REGISTRY;
  if (
    !exact(row, fields.root) ||
    row.schema !== CANONICAL_LAUNCH_IDENTITY_SCHEMA ||
    !exact(origin, fields.origin) ||
    !strings(origin, fields.origin) ||
    !exact(target, fields.target) ||
    !strings(target, fields.target) ||
    !exact(provider, fields.provider) ||
    !strings(provider, fields.provider) ||
    !exact(account, fields.account) ||
    !strings(account, fields.account) ||
    !exact(workspace, fields.workspace) ||
    !strings(workspace, fields.workspace) ||
    !GIT_COMMIT_RE.test(String(workspace.baseline_commit)) ||
    !exact(permission, fields.permission) ||
    !nonempty(permission.snapshot_ref) ||
    !nonempty(permission.profile) ||
    !Array.isArray(permission.denies) ||
    permission.denies.some((entry) => !nonempty(entry)) ||
    !exact(input, fields.digest) ||
    !SHA256_RE.test(String(input.digest)) ||
    !exact(request, fields.digest) ||
    !SHA256_RE.test(String(request.digest)) ||
    !exact(dispatch, fields.dispatch) ||
    !strings(dispatch, fields.dispatch) ||
    !SHA256_RE.test(String(dispatch.idempotency_key)) ||
    !String(dispatch.run_ref).startsWith('ccm-run:v1:') ||
    dispatch.launch_nonce !== dispatch.claim_id ||
    !exact(runtime, fields.runtime) ||
    !SHA256_RE.test(String(runtime.image_sha256)) ||
    !exact(selector, fields.selector) ||
    selector.kind !== 'exact' ||
    !nonempty(selector.model_id) ||
    !nonempty(selector.effort) ||
    selector.model_id !== provider.model ||
    selector.effort !== provider.effort
  ) {
    throw new Error('CANONICAL-LAUNCH-IDENTITY-INVALID');
  }
  return {
    schema: CANONICAL_LAUNCH_IDENTITY_SCHEMA,
    origin: { harness: origin.harness, session_ref: origin.session_ref },
    target: {
      harness: target.harness,
      adapter: target.adapter,
      surface: target.surface,
      transport: target.transport,
      candidate_id: target.candidate_id,
    },
    provider: { id: provider.id, model: provider.model, effort: provider.effort },
    account: {
      fingerprint_ref: account.fingerprint_ref,
      account_id: account.account_id,
      pool_id: account.pool_id,
      identity_fingerprint: account.identity_fingerprint,
    },
    workspace: {
      workspace_ref: workspace.workspace_ref,
      worktree_ref: workspace.worktree_ref,
      baseline_commit: workspace.baseline_commit,
    },
    permission: {
      snapshot_ref: permission.snapshot_ref,
      profile: permission.profile,
      denies: [...new Set(permission.denies as string[])].sort(),
    },
    input: { digest: input.digest },
    request: { digest: request.digest },
    dispatch: {
      run_ref: dispatch.run_ref,
      idempotency_key: dispatch.idempotency_key,
      launch_nonce: dispatch.launch_nonce,
      claim_id: dispatch.claim_id,
    },
    runtime: {
      image_sha256: runtime.image_sha256,
      selector: { kind: 'exact', model_id: selector.model_id, effort: selector.effort },
    },
  };
}

export function canonicalLaunchIdentityDigest(value: unknown): string {
  return canonicalSha256Digest(normalizeCanonicalLaunchIdentity(value));
}
