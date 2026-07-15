import { canonicalSha256Digest } from './canonical-digest.js';
import { isSha256Digest } from './sha256.js';

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

export interface CanonicalLaunchIdentity {
  schema: typeof CANONICAL_LAUNCH_IDENTITY_SCHEMA;
  origin: { harness: string; session_ref: string };
  target: {
    harness: string;
    adapter: string;
    surface: string;
    transport: string;
    candidate_id: string;
  };
  provider: { id: string; model: string; effort: string };
  account: {
    fingerprint_ref: string;
    account_id: string;
    pool_id: string;
    identity_fingerprint: string;
  };
  workspace: { workspace_ref: string; worktree_ref: string; baseline_commit: string };
  permission: { snapshot_ref: string; profile: string; denies: string[] };
  input: { digest: string };
  request: { digest: string };
  dispatch: {
    run_ref: string;
    idempotency_key: string;
    launch_nonce: string;
    claim_id: string;
  };
  runtime: {
    image_sha256: string;
    selector: { kind: 'exact'; model_id: string; effort: string };
  };
}

type Json = Record<string, unknown>;

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

export function normalizeCanonicalLaunchIdentity(
  value: unknown,
): Readonly<CanonicalLaunchIdentity> {
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
    !isSha256Digest(account.identity_fingerprint) ||
    !exact(workspace, fields.workspace) ||
    !strings(workspace, fields.workspace) ||
    !GIT_COMMIT_RE.test(String(workspace.baseline_commit)) ||
    !exact(permission, fields.permission) ||
    !nonempty(permission.snapshot_ref) ||
    !nonempty(permission.profile) ||
    !Array.isArray(permission.denies) ||
    permission.denies.some((entry) => !nonempty(entry)) ||
    !exact(input, fields.digest) ||
    !isSha256Digest(input.digest) ||
    !exact(request, fields.digest) ||
    !isSha256Digest(request.digest) ||
    !exact(dispatch, fields.dispatch) ||
    !strings(dispatch, fields.dispatch) ||
    !isSha256Digest(dispatch.idempotency_key) ||
    !String(dispatch.run_ref).startsWith('ccm-run:v1:') ||
    dispatch.launch_nonce !== dispatch.claim_id ||
    !exact(runtime, fields.runtime) ||
    !isSha256Digest(runtime.image_sha256) ||
    !exact(selector, fields.selector) ||
    selector.kind !== 'exact' ||
    !nonempty(selector.model_id) ||
    !nonempty(selector.effort) ||
    selector.model_id !== provider.model ||
    selector.effort !== provider.effort
  ) {
    throw new Error('CANONICAL-LAUNCH-IDENTITY-INVALID');
  }
  return deepFreeze({
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
  } as CanonicalLaunchIdentity);
}

export function canonicalLaunchIdentityDigest(value: unknown): string {
  return canonicalSha256Digest(normalizeCanonicalLaunchIdentity(value));
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
