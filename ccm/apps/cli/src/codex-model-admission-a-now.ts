// Codex exact-model admission A-now walking skeleton.
//
// Authority stays deliberately narrow: live fact collection, pure W1 evaluation and the private
// launch port are captured by one per-run supervisor. Persistent state is accepted only as a
// negative gate; neither a serialized decision nor an audit record can recreate launch authority.

type JsonRecord = Record<string, unknown>;

export type CodexProviderTarget = 'controlled-fixture' | 'real-codex';

export interface W1DecisionV1 {
  verdict: 'admit' | 'reject';
  reason_codes: string[];
  provider_target: CodexProviderTarget | null;
  provider_spawn_permitted: boolean;
  real_provider_request_permitted: boolean;
}

export interface AuthorityResult {
  action: 'spawn' | 'reuse' | 'reject' | 'uncertain';
  spawn_count_delta: 0 | 1;
  state: 'invoking' | 'started' | 'rejected' | 'uncertain';
  reason: string;
  diagnostic_evidence?: AuthorityDiagnosticEvidence;
}

export interface AuthorityDiagnosticEvidence {
  schema: 'ccm/bounded-redacted-diagnostic/v1';
  code: 'preinvoke_authority_changed';
  category:
    | 'workspace-baseline'
    | 'authorization'
    | 'quota-7d'
    | 'reservation'
    | 'policy'
    | 'binary'
    | 'catalog'
    | 'unspecified';
  redacted: true;
}

interface AuthorityRuntimePort {
  attachOriginalRun?: (challenge: Readonly<CodexRunAttachChallenge>) => Promise<unknown> | unknown;
  spawnControlledFixture?: (
    invocation: Readonly<CompiledCodexInvocation>,
  ) => Promise<unknown> | unknown;
  spawnRealCodex?: (invocation: Readonly<CompiledCodexInvocation>) => Promise<unknown> | unknown;
}

export interface CompiledCodexInvocation {
  schema: 'ccm/codex-provider-compiled-invocation/v1';
  provider_target: CodexProviderTarget;
  executable: string;
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  permission: JsonRecord;
  binding: JsonRecord;
}

export interface CodexRunAttachChallenge {
  schema: 'ccm/provider-run-attach-challenge/v1';
  attempt_id: string;
  run_ref: string;
  idempotency_key: string;
  provider_target: CodexProviderTarget;
  compiled_invocation: Readonly<CompiledCodexInvocation>;
}

export interface CodexPreinvokeChallenge {
  schema: 'ccm/codex-model-admission-preinvoke-challenge/v1';
  cut: Readonly<JsonRecord>;
  expected_binding: Readonly<JsonRecord>;
}

export interface CodexModelAdmissionSupervisorPorts extends AuthorityRuntimePort {
  collectEvaluationCut(request: unknown): Promise<unknown> | unknown;
  preinvokeRecheck(challenge: Readonly<CodexPreinvokeChallenge>): Promise<unknown> | unknown;
  spawnControlledFixture: (
    invocation: Readonly<CompiledCodexInvocation>,
  ) => Promise<unknown> | unknown;
  spawnRealCodex: (invocation: Readonly<CompiledCodexInvocation>) => Promise<unknown> | unknown;
}

export interface CodexModelAdmissionSupervisorInput {
  request: unknown;
  now: string;
  timeoutsMs: { collect: number; preinvoke: number };
  durableControl?: unknown;
}

export interface CodexModelAdmissionSupervisorResult {
  decision: W1DecisionV1;
  launch: AuthorityResult;
}

export interface CodexModelAdmissionReconciliationInput {
  actual: unknown;
  providerTerminal: unknown;
  parentVerified: boolean;
}

export interface CodexModelAdmissionSupervisor {
  run(): Promise<CodexModelAdmissionSupervisorResult>;
  reconcile(input: CodexModelAdmissionReconciliationInput): Promise<JsonRecord>;
}

export const CODEX_ADMISSION_REASON_PRIORITY_V1 = Object.freeze([
  'persistent_only_evidence',
  'cut_replayed',
  'binary_unknown',
  'policy_denied',
  'automatic_live_spawn_disabled_strict',
  'provider_request_authorization_missing',
  'provider_request_authorization_mismatch',
  'auth_unknown',
  'auth_stale',
  'catalog_stale',
  'quota_7d_unknown',
  'quota_7d_tight',
  'quota_7d_exhausted',
  'quota_7d_stale',
  'model_exact_mismatch',
  'effort_exact_mismatch',
  'workspace_mismatch',
  'reservation_invalid',
  'account_identity_conflict',
] as const);

export const CODEX_PREINVOKE_CHANGED_REASON_V1 = 'preinvoke_authority_changed' as const;

const AUTHORIZATION_FIELDS = [
  'schema',
  'issuer',
  'authority_ref',
  'attempt_id',
  'run_ref',
  'idempotency_key',
  'provider',
  'operation',
  'model_id',
  'effort',
  'workspace_realpath',
  'baseline_sha256',
  'effect',
  'issued_at',
  'expires_at',
  'nonce',
] as const;

const DURABLE_CONTROL_FIELDS = ['home_claim', 'invoke_intent', 'started_handle'] as const;

type DurableControlState = 'fresh' | 'attach' | 'ambiguous' | 'conflict';

type DurableControlBinding =
  | Readonly<{ state: 'unbound' }>
  | Readonly<{ state: 'binding' }>
  | Readonly<{ state: 'bound'; value: Readonly<JsonRecord> }>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function durableControlState(value: unknown): DurableControlState | null {
  const durable = record(value);
  if (
    !durable ||
    Object.keys(durable).length !== DURABLE_CONTROL_FIELDS.length ||
    !DURABLE_CONTROL_FIELDS.every((field) => Object.hasOwn(durable, field))
  ) {
    return null;
  }
  if (
    durable.home_claim === 'absent' &&
    durable.invoke_intent === 'absent' &&
    durable.started_handle === 'absent'
  ) {
    return 'fresh';
  }
  if (
    durable.home_claim === 'same-key-same-request' &&
    durable.invoke_intent === 'durable' &&
    durable.started_handle === 'present'
  ) {
    return 'attach';
  }
  if (
    durable.home_claim === 'same-key-same-request' &&
    durable.invoke_intent === 'durable' &&
    durable.started_handle === 'unknown'
  ) {
    return 'ambiguous';
  }
  if (
    durable.home_claim === 'same-key-different-request' &&
    durable.invoke_intent === 'absent' &&
    durable.started_handle === 'absent'
  ) {
    return 'conflict';
  }
  return null;
}

function materializedDurableControl(state: DurableControlState): Readonly<JsonRecord> {
  switch (state) {
    case 'fresh':
      return Object.freeze({
        home_claim: 'absent',
        invoke_intent: 'absent',
        started_handle: 'absent',
      });
    case 'attach':
      return Object.freeze({
        home_claim: 'same-key-same-request',
        invoke_intent: 'durable',
        started_handle: 'present',
      });
    case 'ambiguous':
      return Object.freeze({
        home_claim: 'same-key-same-request',
        invoke_intent: 'durable',
        started_handle: 'unknown',
      });
    case 'conflict':
      return Object.freeze({
        home_claim: 'same-key-different-request',
        invoke_intent: 'absent',
        started_handle: 'absent',
      });
  }
}

const INVALID_DURABLE_CONTROL = Object.freeze({});

function bindDurableControlInput(input: CodexModelAdmissionSupervisorInput): Readonly<JsonRecord> {
  try {
    if (!Object.hasOwn(input, 'durableControl')) return materializedDurableControl('fresh');
    const state = durableControlState(input.durableControl);
    return state === null ? INVALID_DURABLE_CONTROL : materializedDurableControl(state);
  } catch {
    return INVALID_DURABLE_CONTROL;
  }
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function instant(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function activeAt(validUntil: unknown, now: number): boolean {
  const valid = instant(validUntil);
  return valid !== null && valid > now;
}

function observedBy(observedAt: unknown, now: number): boolean {
  const observed = instant(observedAt);
  return observed !== null && observed <= now;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>(), depth = 0): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (depth > 64 || seen.has(value)) throw new TypeError('non-json evaluation cut');
  seen.add(value);
  for (const child of Object.values(value as JsonRecord)) deepFreeze(child, seen, depth + 1);
  return Object.freeze(value);
}

function immutableCopy(value: unknown): Readonly<JsonRecord> {
  const copy = structuredClone(value);
  return deepFreeze(record(copy) ?? {});
}

function contractPayload(value: unknown): unknown {
  const wrapper = record(value);
  return wrapper && Object.hasOwn(wrapper, 'input') ? wrapper.input : value;
}

function reject(reason: string): W1DecisionV1 {
  return Object.freeze({
    verdict: 'reject' as const,
    reason_codes: Object.freeze([reason]) as unknown as string[],
    provider_target: null,
    provider_spawn_permitted: false,
    real_provider_request_permitted: false,
  });
}

function admit(target: CodexProviderTarget): W1DecisionV1 {
  return Object.freeze({
    verdict: 'admit' as const,
    reason_codes: Object.freeze([]) as unknown as string[],
    provider_target: target,
    provider_spawn_permitted: true,
    real_provider_request_permitted: target === 'real-codex',
  });
}

function exactAuthorization(cut: JsonRecord, now: number): boolean {
  const identity = record(cut.identity);
  const request = record(cut.request);
  const policy = record(cut.policy);
  const workspace = record(cut.workspace);
  const authorization = record(policy?.launch_authorization);
  if (!identity || !request || !workspace || !authorization) return false;
  if (
    Object.keys(authorization).length !== AUTHORIZATION_FIELDS.length ||
    !AUTHORIZATION_FIELDS.every((field) => Object.hasOwn(authorization, field))
  ) {
    return false;
  }
  const issuedAt = instant(authorization.issued_at);
  const expiresAt = instant(authorization.expires_at);
  return (
    authorization.schema === 'ccm/provider-request-authorization/v1' &&
    (authorization.issuer === 'user' || authorization.issuer === 'operator') &&
    nonempty(authorization.authority_ref) &&
    authorization.attempt_id === identity.attempt_id &&
    authorization.run_ref === identity.run_ref &&
    authorization.idempotency_key === identity.idempotency_key &&
    authorization.provider === 'codex' &&
    authorization.operation === 'inspect' &&
    authorization.model_id === request.model_id &&
    authorization.effort === request.effort &&
    authorization.workspace_realpath === workspace.root_realpath &&
    authorization.baseline_sha256 === workspace.baseline_sha256 &&
    authorization.effect === 'read-only' &&
    issuedAt !== null &&
    issuedAt <= now &&
    expiresAt !== null &&
    expiresAt > now &&
    nonempty(authorization.nonce)
  );
}

function collectReasons(cut: JsonRecord, now: number): Set<string> {
  const reasons = new Set<string>();
  const identity = record(cut.identity);
  const request = record(cut.request);
  const binary = record(cut.binary);
  const auth = record(cut.auth);
  const discovery = record(cut.discovery);
  const resolution = record(cut.resolution);
  const quota = record(cut.quota_7d);
  const policy = record(cut.policy);
  const workspace = record(cut.workspace);
  const reservation = record(cut.reservation);
  const provenance = record(cut.provenance);

  if (
    provenance?.persistent_evidence_used !== false ||
    binary?.source !== 'live-readonly' ||
    auth?.source !== 'live-readonly' ||
    discovery?.source !== 'live-readonly' ||
    quota?.source !== 'live-readonly'
  ) {
    reasons.add('persistent_only_evidence');
  }

  if (
    cut.schema !== 'ccm/codex-model-admission-cut/v1' ||
    !identity ||
    identity.materialization !== 'live-in-memory' ||
    !nonempty(identity.supervisor_instance_id) ||
    identity.collected_by !== identity.supervisor_instance_id ||
    !nonempty(identity.collection_epoch) ||
    !nonempty(identity.attempt_id) ||
    !nonempty(identity.run_ref) ||
    !/^sha256:[0-9a-f]{64}$/.test(String(identity.idempotency_key ?? ''))
  ) {
    reasons.add('cut_replayed');
  }

  if (
    !binary ||
    binary.source !== 'live-readonly' ||
    !nonempty(binary.path) ||
    !binary.path.startsWith('/') ||
    !nonempty(binary.version) ||
    !nonempty(binary.behavior_revision) ||
    binary.freshness !== 'fresh' ||
    binary.completeness !== 'complete'
  ) {
    reasons.add('binary_unknown');
  }

  if (
    !request ||
    request.provider !== 'codex' ||
    request.operation !== 'inspect' ||
    !nonempty(request.model_id) ||
    !nonempty(request.effort) ||
    request.model_id === 'auto' ||
    request.effort === 'auto' ||
    !policy ||
    policy.source !== 'current-authority' ||
    policy.cross_harness !== 'allow' ||
    policy.effect !== 'read-only' ||
    policy.approval !== 'never' ||
    policy.account_mutation !== 'forbidden' ||
    policy.credential_write !== 'forbidden' ||
    policy.threat_policy !== 'strict' ||
    !(
      (request.launch_mode === 'fixture' && request.provider_target === 'controlled-fixture') ||
      (request.launch_mode === 'operator-explicit' && request.provider_target === 'real-codex') ||
      (request.launch_mode === 'automatic' && request.provider_target === 'real-codex')
    )
  ) {
    reasons.add('policy_denied');
  }

  if (request?.launch_mode === 'automatic' && request.provider_target === 'real-codex') {
    reasons.add('automatic_live_spawn_disabled_strict');
  }
  if (request?.launch_mode === 'operator-explicit' && request.provider_target === 'real-codex') {
    if (policy?.launch_authorization === null || policy?.launch_authorization === undefined) {
      reasons.add('provider_request_authorization_missing');
    } else if (!exactAuthorization(cut, now)) {
      reasons.add('provider_request_authorization_mismatch');
    }
  }

  if (
    !auth ||
    auth.state !== 'authenticated' ||
    auth.completeness !== 'complete' ||
    !nonempty(auth.account_id) ||
    !nonempty(auth.credential_id) ||
    !observedBy(auth.observed_at, now)
  ) {
    reasons.add('auth_unknown');
  } else if (auth.freshness !== 'fresh' || !activeAt(auth.valid_until, now)) {
    reasons.add('auth_stale');
  }

  if (
    !discovery ||
    discovery.authority !== 'discovery-only' ||
    discovery.completeness !== 'complete' ||
    !observedBy(discovery.observed_at, now) ||
    discovery.freshness !== 'fresh' ||
    !activeAt(discovery.valid_until, now)
  ) {
    reasons.add('catalog_stale');
  }

  if (
    !quota ||
    quota.status === 'unknown' ||
    quota.completeness !== 'complete' ||
    !observedBy(quota.observed_at, now)
  ) {
    reasons.add('quota_7d_unknown');
  } else if (quota.status === 'tight') {
    reasons.add('quota_7d_tight');
  } else if (quota.status === 'exhausted') {
    reasons.add('quota_7d_exhausted');
  } else if (
    quota.status !== 'ample' ||
    quota.freshness !== 'fresh' ||
    !activeAt(quota.valid_until, now)
  ) {
    reasons.add('quota_7d_stale');
  }

  if (
    !request ||
    !discovery ||
    !resolution ||
    discovery.model_id !== request.model_id ||
    resolution.requested_model_id !== request.model_id ||
    resolution.resolved_model_id !== request.model_id
  ) {
    reasons.add('model_exact_mismatch');
  }
  if (
    !request ||
    !discovery ||
    !resolution ||
    !Array.isArray(discovery.efforts) ||
    !discovery.efforts.includes(request.effort) ||
    resolution.requested_effort !== request.effort ||
    resolution.resolved_effort !== request.effort
  ) {
    reasons.add('effort_exact_mismatch');
  }

  if (
    !workspace ||
    !nonempty(workspace.root_realpath) ||
    !workspace.root_realpath.startsWith('/') ||
    !nonempty(workspace.baseline_sha256) ||
    !/^sha256:[0-9a-f]{64}$/.test(String(workspace.baseline_sha256)) ||
    workspace.isolated !== true ||
    !Array.isArray(workspace.write_set) ||
    workspace.write_set.length !== 0
  ) {
    reasons.add('workspace_mismatch');
  }

  if (
    !reservation ||
    reservation.held !== true ||
    reservation.attempt_id !== identity?.attempt_id ||
    reservation.workspace_realpath !== workspace?.root_realpath ||
    !activeAt(reservation.valid_until, now)
  ) {
    reasons.add('reservation_invalid');
  }

  if (
    !auth ||
    !quota ||
    !reservation ||
    auth.account_id !== quota.account_id ||
    auth.account_id !== reservation.account_id ||
    quota.pool_id !== reservation.pool_id
  ) {
    reasons.add('account_identity_conflict');
  }
  return reasons;
}

export function evaluateCodexAdmissionV1(cutValue: unknown, nowValue: string): W1DecisionV1 {
  const cut = record(cutValue) ?? {};
  const now = instant(nowValue);
  if (now === null) return reject('cut_replayed');
  const reasons = collectReasons(cut, now);
  const reason = CODEX_ADMISSION_REASON_PRIORITY_V1.find((candidate) => reasons.has(candidate));
  if (reason) return reject(reason);
  if (reasons.size > 0) return reject([...reasons].sort()[0] ?? 'cut_replayed');
  const target = record(cut.request)?.provider_target;
  return target === 'real-codex' ? admit('real-codex') : admit('controlled-fixture');
}

export function evaluateW1Case(value: unknown): W1DecisionV1 {
  const input = record(value);
  const domain = record(input?.domain);
  return evaluateCodexAdmissionV1(input?.input, String(domain?.now ?? ''));
}

function exactKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
  );
}

function canonical(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object') throw new TypeError('non-json binding');
  if (seen.has(value)) throw new TypeError('cyclic binding');
  seen.add(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonical(entry, seen)).join(',')}]`;
  const input = value as JsonRecord;
  return `{${Object.keys(input)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(input[key], seen)}`)
    .join(',')}}`;
}

function equalJson(left: unknown, right: unknown): boolean {
  try {
    return canonical(left) === canonical(right);
  } catch {
    return false;
  }
}

function normalizedRequest(value: unknown): JsonRecord | null {
  const request = record(value);
  const selector = record(request?.selector);
  const workspace = record(request?.workspace);
  const launch = record(request?.launch);
  if (
    !request ||
    request.schema !== 'ccm/codex-model-admission-request/v1' ||
    !exactKeys(request, [
      'schema',
      'attempt_id',
      'run_ref',
      'idempotency_key',
      'provider',
      'operation',
      'selector',
      'workspace',
      'launch',
    ]) ||
    !nonempty(request.attempt_id) ||
    !nonempty(request.run_ref) ||
    !/^sha256:[0-9a-f]{64}$/.test(String(request.idempotency_key ?? '')) ||
    request.provider !== 'codex' ||
    request.operation !== 'inspect' ||
    !selector ||
    !exactKeys(selector, ['kind', 'model_id', 'effort']) ||
    selector.kind !== 'exact' ||
    !nonempty(selector.model_id) ||
    selector.model_id === 'auto' ||
    !nonempty(selector.effort) ||
    selector.effort === 'auto' ||
    !workspace ||
    !exactKeys(workspace, ['root_realpath', 'baseline_sha256', 'effect', 'approval', 'network']) ||
    !nonempty(workspace.root_realpath) ||
    !workspace.root_realpath.startsWith('/') ||
    !/^sha256:[0-9a-f]{64}$/.test(String(workspace.baseline_sha256 ?? '')) ||
    workspace.effect !== 'read-only' ||
    workspace.approval !== 'never' ||
    workspace.network !== 'provider-only' ||
    !launch ||
    !exactKeys(launch, ['mode', 'provider_target', 'authorization']) ||
    !(
      (launch.mode === 'fixture' && launch.provider_target === 'controlled-fixture') ||
      (launch.mode === 'operator-explicit' && launch.provider_target === 'real-codex') ||
      (launch.mode === 'automatic' && launch.provider_target === 'real-codex')
    ) ||
    (launch.mode === 'fixture' && launch.authorization !== null)
  ) {
    return null;
  }
  return immutableCopy(request) as JsonRecord;
}

function requestMatchesCut(request: JsonRecord, cut: Readonly<JsonRecord>): boolean {
  const identity = record(cut.identity);
  const cutRequest = record(cut.request);
  const selector = record(request.selector);
  const requestedWorkspace = record(request.workspace);
  const workspace = record(cut.workspace);
  const launch = record(request.launch);
  const policy = record(cut.policy);
  const discovery = record(cut.discovery);
  return !!(
    identity &&
    cutRequest &&
    selector &&
    requestedWorkspace &&
    workspace &&
    launch &&
    policy &&
    discovery &&
    request.attempt_id === identity.attempt_id &&
    request.run_ref === identity.run_ref &&
    request.idempotency_key === identity.idempotency_key &&
    request.provider === cutRequest.provider &&
    request.operation === cutRequest.operation &&
    selector.kind === 'exact' &&
    selector.model_id === cutRequest.model_id &&
    selector.effort === cutRequest.effort &&
    launch.mode === cutRequest.launch_mode &&
    launch.provider_target === cutRequest.provider_target &&
    equalJson(launch.authorization, policy.launch_authorization) &&
    requestedWorkspace.root_realpath === workspace.root_realpath &&
    requestedWorkspace.baseline_sha256 === workspace.baseline_sha256 &&
    requestedWorkspace.effect === policy.effect &&
    requestedWorkspace.approval === policy.approval &&
    discovery.model_identity_kind === 'provider-cli-model-id' &&
    discovery.source_method === 'model/list'
  );
}

function compiledInvocation(cut: Readonly<JsonRecord>): Readonly<CompiledCodexInvocation> {
  const identity = record(cut.identity) ?? {};
  const request = record(cut.request) ?? {};
  const binary = record(cut.binary) ?? {};
  const auth = record(cut.auth) ?? {};
  const quota = record(cut.quota_7d) ?? {};
  const policy = record(cut.policy) ?? {};
  const workspace = record(cut.workspace) ?? {};
  const reservation = record(cut.reservation) ?? {};
  const target = request.provider_target as CodexProviderTarget;
  return deepFreeze({
    schema: 'ccm/codex-provider-compiled-invocation/v1' as const,
    provider_target: target,
    executable: String(binary.path),
    argv: [
      '--ask-for-approval',
      'never',
      'exec',
      '--json',
      '--model',
      String(request.model_id),
      '-c',
      `model_reasoning_effort=${String(request.effort)}`,
      '--sandbox',
      'read-only',
      '--ephemeral',
      '-C',
      String(workspace.root_realpath),
      '-',
    ],
    cwd: String(workspace.root_realpath),
    env: {},
    permission: {
      effect: 'read-only',
      sandbox: 'read-only',
      approval: 'never',
      network: 'provider-only',
      account_mutation: 'forbidden',
      credential_write: 'forbidden',
      write_set: [],
    },
    binding: {
      attempt_id: identity.attempt_id,
      run_ref: identity.run_ref,
      idempotency_key: identity.idempotency_key,
      supervisor_instance_id: identity.supervisor_instance_id,
      collection_epoch: identity.collection_epoch,
      model_id: request.model_id,
      effort: request.effort,
      workspace_realpath: workspace.root_realpath,
      baseline_sha256: workspace.baseline_sha256,
      authorization: policy.launch_authorization,
      auth: {
        account_id: auth.account_id,
        credential_id: auth.credential_id,
        valid_until: auth.valid_until,
      },
      quota_7d: {
        account_id: quota.account_id,
        pool_id: quota.pool_id,
        valid_until: quota.valid_until,
      },
      reservation: {
        account_id: reservation.account_id,
        pool_id: reservation.pool_id,
        valid_until: reservation.valid_until,
      },
      policy: {
        cross_harness: policy.cross_harness,
        effect: policy.effect,
        approval: policy.approval,
        account_mutation: policy.account_mutation,
        credential_write: policy.credential_write,
      },
    },
  });
}

function validCompiledInvocation(value: unknown): value is CompiledCodexInvocation {
  const invocation = record(value);
  return !!(
    invocation &&
    invocation.schema === 'ccm/codex-provider-compiled-invocation/v1' &&
    (invocation.provider_target === 'controlled-fixture' ||
      invocation.provider_target === 'real-codex') &&
    nonempty(invocation.executable) &&
    Array.isArray(invocation.argv) &&
    invocation.argv.every((entry) => typeof entry === 'string') &&
    nonempty(invocation.cwd) &&
    record(invocation.env) &&
    record(invocation.permission) &&
    record(invocation.binding)
  );
}

function preinvokeChallenge(
  cut: Readonly<JsonRecord>,
  invocation: Readonly<CompiledCodexInvocation>,
): Readonly<CodexPreinvokeChallenge> {
  const identity = record(cut.identity) ?? {};
  const binary = record(cut.binary) ?? {};
  const discovery = record(cut.discovery) ?? {};
  const resolution = record(cut.resolution) ?? {};
  return deepFreeze({
    schema: 'ccm/codex-model-admission-preinvoke-challenge/v1' as const,
    cut,
    expected_binding: {
      schema: 'ccm/codex-model-admission-preinvoke-binding/v1',
      supervisor_instance_id: identity.supervisor_instance_id,
      collection_epoch: identity.collection_epoch,
      binary: {
        path: binary.path,
        version: binary.version,
        behavior_revision: binary.behavior_revision,
      },
      discovery: {
        model_id: discovery.model_id,
        model_identity_kind: discovery.model_identity_kind,
        source_method: discovery.source_method,
        valid_until: discovery.valid_until,
      },
      resolution,
      compiled_invocation: invocation,
    },
  });
}

function validStartedHandle(value: unknown, target: CodexProviderTarget): boolean {
  const handle = record(value);
  return !!(
    handle &&
    handle.schema === 'ccm/provider-started-handle/v1' &&
    nonempty(handle.handle_ref) &&
    handle.provider_target === target
  );
}

function runAttachChallenge(
  input: Readonly<JsonRecord>,
  providerTarget: CodexProviderTarget,
  invocation: Readonly<CompiledCodexInvocation>,
): Readonly<CodexRunAttachChallenge> {
  return deepFreeze({
    schema: 'ccm/provider-run-attach-challenge/v1' as const,
    attempt_id: input.attempt_id as string,
    run_ref: input.run_ref as string,
    idempotency_key: input.idempotency_key as string,
    provider_target: providerTarget,
    compiled_invocation: invocation,
  });
}

function validAttachedHandle(value: unknown, expected: Readonly<CodexRunAttachChallenge>): boolean {
  const handle = record(value);
  return !!(
    handle &&
    exactKeys(handle, [
      'schema',
      'handle_ref',
      'attempt_id',
      'run_ref',
      'idempotency_key',
      'provider_target',
      'compiled_invocation',
    ]) &&
    handle.schema === 'ccm/provider-attached-handle/v1' &&
    nonempty(handle.handle_ref) &&
    nonempty(expected.attempt_id) &&
    nonempty(expected.run_ref) &&
    nonempty(expected.idempotency_key) &&
    nonempty(handle.attempt_id) &&
    nonempty(handle.run_ref) &&
    nonempty(handle.idempotency_key) &&
    handle.attempt_id === expected.attempt_id &&
    handle.run_ref === expected.run_ref &&
    handle.idempotency_key === expected.idempotency_key &&
    handle.provider_target === expected.provider_target &&
    equalJson(handle.compiled_invocation, expected.compiled_invocation)
  );
}

function authorityReject(
  reason: string,
  diagnosticEvidence?: AuthorityDiagnosticEvidence,
): AuthorityResult {
  return Object.freeze({
    action: 'reject' as const,
    spawn_count_delta: 0 as const,
    state: 'rejected' as const,
    reason,
    ...(diagnosticEvidence ? { diagnostic_evidence: diagnosticEvidence } : {}),
  });
}

function authorityEffectInProgress(): AuthorityResult {
  return Object.freeze({
    action: 'reuse' as const,
    spawn_count_delta: 0 as const,
    state: 'invoking' as const,
    reason: 'authority_effect_in_progress',
  });
}

function preinvokeChangedCategory(reason: string): AuthorityDiagnosticEvidence['category'] {
  switch (reason) {
    case 'workspace_baseline_changed':
      return 'workspace-baseline';
    case 'authorization_changed':
      return 'authorization';
    case 'quota_7d_changed':
      return 'quota-7d';
    case 'reservation_changed':
      return 'reservation';
    case 'policy_changed':
      return 'policy';
    case 'binary_changed':
      return 'binary';
    case 'catalog_changed':
      return 'catalog';
    default:
      return 'unspecified';
  }
}

function preinvokeChangedReject(reason: string): AuthorityResult {
  return authorityReject(
    CODEX_PREINVOKE_CHANGED_REASON_V1,
    Object.freeze({
      schema: 'ccm/bounded-redacted-diagnostic/v1',
      code: CODEX_PREINVOKE_CHANGED_REASON_V1,
      category: preinvokeChangedCategory(reason),
      redacted: true,
    }),
  );
}

export function createAuthorityHarness(
  inputValue: unknown,
  runtimePort: AuthorityRuntimePort,
): { invoke(): Promise<AuthorityResult>; hasVerifiedStartedHandle(): boolean } {
  const input = immutableCopy(contractPayload(inputValue));
  const decision = record(input.decision);
  const durableState = durableControlState(input.durable_control);
  const providerTarget =
    input.provider_target === 'real-codex' ? 'real-codex' : 'controlled-fixture';
  const invocation = input.compiled_invocation;
  const spawn =
    providerTarget === 'real-codex'
      ? runtimePort.spawnRealCodex
      : runtimePort.spawnControlledFixture;
  const durableAttachRequested = durableState === 'attach';
  let terminal: AuthorityResult | null = null;
  let invoking: Promise<AuthorityResult> | null = null;
  let synchronousAuthorityEffect = false;
  let verifiedStartedHandle: unknown | null = null;

  const stablePreflight = (): AuthorityResult | null => {
    if (durableState === null) {
      return authorityReject('durable_control_invalid');
    }
    if (durableState === 'conflict') {
      return authorityReject('idempotency_conflict');
    }
    if (durableState === 'ambiguous') {
      return Object.freeze({
        action: 'uncertain',
        spawn_count_delta: 0,
        state: 'uncertain',
        reason: 'invoke_outcome_ambiguous_no_auto_retry',
      });
    }
    if (decision?.origin === 'serialized-replay') {
      return authorityReject('serialized_decision_not_authority');
    }
    if (decision?.origin === 'audit-ledger') {
      return authorityReject('persistent_record_not_authority');
    }
    if (decision?.supervisor_instance_id !== input.supervisor_instance_id) {
      return authorityReject('supervisor_identity_mismatch');
    }
    if (decision?.verdict !== 'admit' || decision.origin !== 'same-call-stack') {
      return authorityReject('same_process_live_admit_required');
    }
    if (!validCompiledInvocation(invocation) || invocation.provider_target !== providerTarget) {
      return authorityReject('compiled_invocation_invalid');
    }
    if (!durableAttachRequested && typeof spawn !== 'function') {
      return authorityReject('provider_runtime_unavailable');
    }
    return null;
  };

  const duplicateResult = (outcome: AuthorityResult): AuthorityResult =>
    outcome.action === 'spawn'
      ? Object.freeze({
          action: 'reuse',
          spawn_count_delta: 0,
          state: 'started',
          reason: 'launch_capability_already_used',
        })
      : outcome;

  const beginAuthorityEffect = (
    operation: () => Promise<AuthorityResult>,
  ): Promise<AuthorityResult> => {
    let settle!: (result: AuthorityResult) => void;
    const shared = new Promise<AuthorityResult>((resolve) => {
      settle = resolve;
    });
    invoking = shared;
    synchronousAuthorityEffect = true;
    let operationPromise: Promise<AuthorityResult>;
    try {
      operationPromise = operation();
    } catch {
      operationPromise = Promise.resolve(authorityReject('authority_internal_invariant'));
    } finally {
      synchronousAuthorityEffect = false;
    }
    operationPromise.then(settle, () => settle(authorityReject('authority_internal_invariant')));
    return shared;
  };

  return Object.freeze({
    hasVerifiedStartedHandle(): boolean {
      return verifiedStartedHandle !== null;
    },
    async invoke(): Promise<AuthorityResult> {
      if (terminal) return duplicateResult(terminal);
      if (invoking) {
        if (synchronousAuthorityEffect) return authorityEffectInProgress();
        return duplicateResult(await invoking);
      }

      const rejected = stablePreflight();
      if (rejected) {
        terminal = rejected;
        return rejected;
      }
      if (!validCompiledInvocation(invocation)) {
        terminal = authorityReject('authority_internal_invariant');
        return terminal;
      }
      const compiled = invocation;

      if (durableAttachRequested) {
        const challenge = runAttachChallenge(input, providerTarget, compiled);
        const shared = beginAuthorityEffect(async () => {
          let attachPort: AuthorityRuntimePort['attachOriginalRun'];
          try {
            attachPort = runtimePort.attachOriginalRun;
          } catch {
            return authorityReject('authority_internal_invariant');
          }
          if (typeof attachPort !== 'function') {
            return Object.freeze({
              action: 'uncertain' as const,
              spawn_count_delta: 0 as const,
              state: 'uncertain' as const,
              reason: 'original_run_attach_required',
            });
          }
          try {
            const handle = await attachPort(challenge);
            if (!validAttachedHandle(handle, challenge)) {
              return Object.freeze({
                action: 'uncertain' as const,
                spawn_count_delta: 0 as const,
                state: 'uncertain' as const,
                reason: 'original_run_attach_unverified',
              });
            }
            verifiedStartedHandle = immutableCopy(handle);
            return Object.freeze({
              action: 'reuse' as const,
              spawn_count_delta: 0 as const,
              state: 'started' as const,
              reason: 'original_run_adopted',
            });
          } catch {
            return Object.freeze({
              action: 'uncertain' as const,
              spawn_count_delta: 0 as const,
              state: 'uncertain' as const,
              reason: 'original_run_attach_unverified',
            });
          }
        });
        const outcome = await shared;
        terminal = outcome;
        return outcome;
      }

      if (typeof spawn !== 'function') {
        terminal = authorityReject('authority_internal_invariant');
        return terminal;
      }
      const spawnPort = spawn;

      const shared = beginAuthorityEffect(async () => {
        try {
          const handle = await spawnPort(compiled);
          if (!validStartedHandle(handle, providerTarget)) {
            return Object.freeze({
              action: 'uncertain' as const,
              spawn_count_delta: 0 as const,
              state: 'uncertain' as const,
              reason: 'provider_started_handle_invalid',
            });
          }
          verifiedStartedHandle = handle;
          return Object.freeze({
            action: 'spawn' as const,
            spawn_count_delta: 1 as const,
            state: 'invoking' as const,
            reason: 'same_process_live_admit',
          });
        } catch (cause) {
          if (record(cause)?.code === 'provider_spawn_rejected_before_attempt') {
            return authorityReject('provider_spawn_rejected_before_attempt');
          }
          return Object.freeze({
            action: 'uncertain' as const,
            spawn_count_delta: 0 as const,
            state: 'uncertain' as const,
            reason: 'invoke_outcome_ambiguous_no_auto_retry',
          });
        }
      });
      const outcome = await shared;
      terminal = outcome;
      return outcome;
    },
  });
}

export function evaluateReconciliationCase(value: unknown): JsonRecord {
  const input = record(contractPayload(value)) ?? {};
  const requested = record(input.requested);
  const resolved = record(input.resolved);
  const actual = record(input.actual);
  let attemptOutcome: 'terminal' | 'failed' | 'uncertain';
  let reason: string;
  if (input.provider_terminal === 'failed') {
    attemptOutcome = 'failed';
    reason = 'provider_terminal_failed';
  } else if (input.provider_terminal === 'cancelled') {
    attemptOutcome = 'failed';
    reason = 'provider_terminal_cancelled';
  } else if (input.provider_terminal !== 'succeeded') {
    attemptOutcome = 'uncertain';
    reason = 'provider_terminal_unknown';
  } else if (
    !requested ||
    !resolved ||
    !actual ||
    actual.source !== 'provider-event-channel' ||
    !nonempty(actual.model_id) ||
    !nonempty(actual.effort)
  ) {
    attemptOutcome = 'uncertain';
    reason = 'actual_identity_unknown';
  } else if (actual.model_id !== requested.model_id || actual.model_id !== resolved.model_id) {
    attemptOutcome = 'failed';
    reason = 'actual_model_mismatch';
  } else if (actual.effort !== requested.effort || actual.effort !== resolved.effort) {
    attemptOutcome = 'failed';
    reason = 'actual_effort_mismatch';
  } else {
    attemptOutcome = 'terminal';
    reason = 'actual_identity_exact';
  }
  const parentVerified = attemptOutcome === 'terminal' && input.parent_verified === true;
  return Object.freeze({
    attempt_outcome: attemptOutcome,
    reason,
    task_done: parentVerified,
    parent_verification_required: !parentVerified,
  });
}

export async function evaluateEffectCase(
  value: unknown,
  ports: { controlledFixtureSpawn?: () => Promise<unknown> | unknown },
): Promise<{ status: 'ok' | 'rejected' }> {
  const input = record(contractPayload(value)) ?? {};
  if (input.requested_action !== 'none') return Object.freeze({ status: 'rejected' });
  if (input.operation === 'fixture-attempt' && input.provider_target === 'controlled-fixture') {
    if (typeof ports.controlledFixtureSpawn !== 'function') {
      return Object.freeze({ status: 'rejected' });
    }
    await ports.controlledFixtureSpawn();
  }
  return Object.freeze({ status: 'ok' });
}

class SupervisorTimeoutError extends Error {
  constructor(readonly reason: 'collector_timeout' | 'preinvoke_timeout') {
    super(reason);
    this.name = 'SupervisorTimeoutError';
  }
}

async function withTimeout<T>(
  operation: () => Promise<T> | T,
  timeoutMs: number,
  reason: 'collector_timeout' | 'preinvoke_timeout',
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_resolve, rejectTimeout) => {
        timer = setTimeout(() => rejectTimeout(new SupervisorTimeoutError(reason)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface PreparedAdmission {
  kind: 'prepared';
  cut: Readonly<JsonRecord>;
  decision: W1DecisionV1;
  invocation: Readonly<CompiledCodexInvocation> | null;
}

interface FailedPreparation {
  kind: 'failed';
  result: CodexModelAdmissionSupervisorResult;
}

type Preparation = PreparedAdmission | FailedPreparation;

function zeroAuthorityResult(reason: string): CodexModelAdmissionSupervisorResult {
  return Object.freeze({ decision: reject(reason), launch: authorityReject(reason) });
}

function preinvokeResult(
  value: unknown,
  expectedBinding: Readonly<JsonRecord>,
): AuthorityResult | null {
  const confirmation = record(value);
  if (
    !confirmation ||
    confirmation.schema !== 'ccm/codex-model-admission-preinvoke-confirmation/v1'
  ) {
    return authorityReject('preinvoke_invalid');
  }
  if (confirmation.status === 'changed') {
    return exactKeys(confirmation, ['schema', 'status', 'reason']) && nonempty(confirmation.reason)
      ? preinvokeChangedReject(confirmation.reason)
      : authorityReject('preinvoke_invalid');
  }
  if (
    confirmation.status !== 'unchanged' ||
    !exactKeys(confirmation, ['schema', 'status', 'binding']) ||
    !equalJson(confirmation.binding, expectedBinding)
  ) {
    return authorityReject('preinvoke_invalid');
  }
  return null;
}

function notStartedReconciliation(): JsonRecord {
  return Object.freeze({
    attempt_outcome: 'uncertain',
    reason: 'provider_not_started',
    task_done: false,
    parent_verification_required: true,
  });
}

export function createCodexModelAdmissionSupervisor(
  input: CodexModelAdmissionSupervisorInput,
  ports: CodexModelAdmissionSupervisorPorts,
): CodexModelAdmissionSupervisor {
  let preparation: Promise<Preparation> | null = null;
  let launchSetup: Promise<
    | {
        kind: 'harness';
        harness: {
          invoke(): Promise<AuthorityResult>;
          hasVerifiedStartedHandle(): boolean;
        };
      }
    | { kind: 'reject'; result: AuthorityResult }
  > | null = null;
  let lastLaunch: AuthorityResult | null = null;
  let verifiedStartedHandle = false;
  let reconciliationEvent: string | null = null;
  let durableControlBinding: DurableControlBinding = Object.freeze({ state: 'unbound' });

  const bindDurableControl = (): Readonly<JsonRecord> | null => {
    if (durableControlBinding.state === 'bound') return durableControlBinding.value;
    if (durableControlBinding.state === 'binding') return null;

    durableControlBinding = Object.freeze({ state: 'binding' });
    let value: Readonly<JsonRecord> = INVALID_DURABLE_CONTROL;
    try {
      value = bindDurableControlInput(input);
    } catch {
      value = INVALID_DURABLE_CONTROL;
    }
    durableControlBinding = Object.freeze({ state: 'bound', value });
    return value;
  };

  const prepare = (): Promise<Preparation> => {
    preparation ??= (async () => {
      const collectTimeout = input.timeoutsMs?.collect;
      const preinvokeTimeout = input.timeoutsMs?.preinvoke;
      if (
        !Number.isSafeInteger(collectTimeout) ||
        Number(collectTimeout) <= 0 ||
        Number(collectTimeout) > 60_000 ||
        !Number.isSafeInteger(preinvokeTimeout) ||
        Number(preinvokeTimeout) <= 0 ||
        Number(preinvokeTimeout) > 60_000
      ) {
        return { kind: 'failed', result: zeroAuthorityResult('request_invalid') };
      }

      let request: JsonRecord | null;
      try {
        request = normalizedRequest(input.request);
      } catch {
        request = null;
      }
      if (!request) return { kind: 'failed', result: zeroAuthorityResult('request_invalid') };

      let rawCut: unknown;
      try {
        rawCut = await withTimeout(
          () => ports.collectEvaluationCut(request),
          Number(collectTimeout),
          'collector_timeout',
        );
      } catch (cause) {
        const reason = cause instanceof SupervisorTimeoutError ? cause.reason : 'collector_failed';
        return { kind: 'failed', result: zeroAuthorityResult(reason) };
      }

      let cut: Readonly<JsonRecord>;
      try {
        cut = immutableCopy(rawCut);
      } catch {
        return {
          kind: 'failed',
          result: zeroAuthorityResult('cut_materialization_failed'),
        };
      }
      if (!requestMatchesCut(request, cut)) {
        return { kind: 'failed', result: zeroAuthorityResult('request_cut_mismatch') };
      }
      const decision = evaluateCodexAdmissionV1(cut, input.now);
      return {
        kind: 'prepared',
        cut,
        decision,
        invocation: decision.verdict === 'admit' ? compiledInvocation(cut) : null,
      };
    })();
    return preparation;
  };

  return Object.freeze({
    async run(): Promise<CodexModelAdmissionSupervisorResult> {
      const durableControl = bindDurableControl();
      if (durableControl === null) {
        const result = zeroAuthorityResult('durable_control_invalid');
        lastLaunch = result.launch;
        return result;
      }
      const prepared = await prepare();
      if (prepared.kind === 'failed') {
        lastLaunch = prepared.result.launch;
        return prepared.result;
      }
      if (prepared.decision.verdict === 'reject') {
        const result = Object.freeze({
          decision: prepared.decision,
          launch: authorityReject(prepared.decision.reason_codes[0] ?? 'admission_rejected'),
        });
        lastLaunch = result.launch;
        return result;
      }

      launchSetup ??= (async () => {
        const invocation = prepared.invocation;
        if (!invocation) {
          return {
            kind: 'reject' as const,
            result: authorityReject('compiled_invocation_invalid'),
          };
        }
        const challenge = preinvokeChallenge(prepared.cut, invocation);
        let confirmation: unknown;
        try {
          confirmation = await withTimeout(
            () => ports.preinvokeRecheck(challenge),
            input.timeoutsMs.preinvoke,
            'preinvoke_timeout',
          );
        } catch (cause) {
          return {
            kind: 'reject' as const,
            result: authorityReject(
              cause instanceof SupervisorTimeoutError ? cause.reason : 'preinvoke_failed',
            ),
          };
        }
        const preinvokeFailure = preinvokeResult(confirmation, challenge.expected_binding);
        if (preinvokeFailure) return { kind: 'reject' as const, result: preinvokeFailure };
        const identity = record(prepared.cut.identity) ?? {};
        const authorityInput = {
          attempt_id: identity.attempt_id,
          run_ref: identity.run_ref,
          idempotency_key: identity.idempotency_key,
          supervisor_instance_id: identity.supervisor_instance_id,
          provider_target: prepared.decision.provider_target,
          decision: {
            verdict: prepared.decision.verdict,
            origin: 'same-call-stack',
            supervisor_instance_id: identity.supervisor_instance_id,
            collection_epoch: identity.collection_epoch,
          },
          durable_control: durableControl,
          compiled_invocation: invocation,
        };
        return {
          kind: 'harness' as const,
          harness: createAuthorityHarness(authorityInput, {
            attachOriginalRun: ports.attachOriginalRun,
            spawnControlledFixture: ports.spawnControlledFixture,
            spawnRealCodex: ports.spawnRealCodex,
          }),
        };
      })();

      const setup = await launchSetup;
      const launch = setup.kind === 'harness' ? await setup.harness.invoke() : setup.result;
      lastLaunch = launch;
      verifiedStartedHandle = setup.kind === 'harness' && setup.harness.hasVerifiedStartedHandle();
      return Object.freeze({ decision: prepared.decision, launch });
    },
    async reconcile(observation: CodexModelAdmissionReconciliationInput): Promise<JsonRecord> {
      if (
        !lastLaunch ||
        !verifiedStartedHandle ||
        !(
          lastLaunch.action === 'spawn' ||
          (lastLaunch.action === 'reuse' && lastLaunch.state === 'started')
        )
      ) {
        return notStartedReconciliation();
      }
      const prepared = await prepare();
      if (prepared.kind !== 'prepared') return notStartedReconciliation();
      let event: string;
      try {
        event = canonical({
          actual: observation.actual,
          provider_terminal: observation.providerTerminal,
        });
      } catch {
        return Object.freeze({
          attempt_outcome: 'uncertain',
          reason: 'provider_terminal_invalid',
          task_done: false,
          parent_verification_required: true,
        });
      }
      if (reconciliationEvent !== null && reconciliationEvent !== event) {
        return Object.freeze({
          attempt_outcome: 'failed',
          reason: 'provider_terminal_conflict',
          task_done: false,
          parent_verification_required: true,
        });
      }
      reconciliationEvent = event;
      const request = record(prepared.cut.request) ?? {};
      const resolution = record(prepared.cut.resolution) ?? {};
      return evaluateReconciliationCase({
        requested: { model_id: request.model_id, effort: request.effort },
        resolved: {
          model_id: resolution.resolved_model_id,
          effort: resolution.resolved_effort,
        },
        actual: observation.actual,
        provider_terminal: observation.providerTerminal,
        parent_verified: observation.parentVerified,
      });
    },
  });
}
