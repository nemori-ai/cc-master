// Offline Claude CLI provider slice.
//
// This module owns only provider-local selection, admission, compilation, process-result parsing,
// and reconciliation. It accepts a supervisor-issued run_ref and an injected runtime; it does not
// create durable runs, probe accounts/quota, mutate credentials, or request provider/network APIs.

import { createHash } from 'node:crypto';
import * as path from 'node:path';
import {
  createProviderRequestDeadline,
  type ProviderChildLimits,
  type ProviderChildResult,
  ProviderChildSupervisorError,
  superviseProviderChild,
} from './provider-child-supervisor.js';
import {
  type ProviderOwnedChild,
  ProviderProcessTreeOwnershipError,
  type ProviderRuntime,
} from './provider-runtime.js';

export const CLAUDE_PROVIDER_REQUEST_SCHEMA = 'ccm/claude-provider-request/v1' as const;
export const CLAUDE_PROVIDER_PREFLIGHT_SCHEMA = 'ccm/claude-provider-preflight/v1' as const;
export const CLAUDE_PROVIDER_INVOCATION_SCHEMA =
  'ccm/claude-provider-compiled-invocation/v1' as const;
export const CLAUDE_PROVIDER_RESULT_SCHEMA = 'ccm/claude-provider-result/v1' as const;
export const CLAUDE_PROVIDER_RECONCILIATION_SCHEMA =
  'ccm/claude-provider-reconciliation/v1' as const;

type ClaudeOriginHarness = 'claude-code' | 'codex' | 'cursor';
type AdmissionDecision = 'allow' | 'deny' | 'unknown';
type AdmissionState = 'authenticated' | 'unauthenticated' | 'unknown';
type QuotaState = 'ample' | 'tight' | 'exhausted' | 'unknown';
type ModelState = 'available' | 'unavailable' | 'unknown';
type PoolKind = 'subscription' | 'api' | 'cloud';
type ProviderStatus = 'rejected' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';

export const CLAUDE_PROVIDER_PARSE_REASON_CODES = Object.freeze([
  'request_not_object',
  'request_fields_invalid',
  'request_schema_invalid',
  'provider_invalid',
  'origin_harness_invalid',
  'effort_invalid',
  'permission_invalid',
  'admission_fields_invalid',
  'policy_fact_invalid',
  'auth_fact_invalid',
  'quota_fact_invalid',
  'quota_pool_invalid',
  'quota_reservation_invalid',
  'quota_preflight_invalid',
  'quota_ticket_invalid',
  'model_fact_invalid',
  'timeouts_fields_invalid',
] as const);

export const CLAUDE_PROVIDER_VALIDATION_REASON_CODES = Object.freeze([
  'clock_invalid',
  'request_id_invalid',
  'run_ref_invalid',
  'attempt_id_invalid',
  'workspace_invalid',
  'objective_invalid',
  'model_invalid',
  'runtime_sha256_invalid',
  'launch_idempotency_key_invalid',
  'launch_nonce_invalid',
  'timeouts_invalid',
  'startup_exceeds_hard_timeout',
  'policy_not_allowed',
  'auth_not_authenticated',
  'quota_not_ample',
  'quota_preflight_not_allowed',
  'quota_preflight_stale',
  'quota_preflight_effect_invalid',
  'model_not_available',
  'model_mismatch',
  'quota_pool_kind_mismatch',
  'quota_authority_invalid',
  'quota_ticket_digest_mismatch',
  'quota_ticket_time_invalid',
  'quota_ticket_expired',
  'quota_ticket_mismatch',
  'policy_stale_or_invalid',
  'auth_stale_or_invalid',
  'quota_stale_or_invalid',
  'model_stale_or_invalid',
] as const);

export const CLAUDE_PROVIDER_TERMINAL_FAILURE_CODES = Object.freeze([
  'terminal_malformed',
  'terminal_invalid',
  'provider_failed',
  'actual_model_missing',
  'actual_model_mismatch',
  'actual_effort_missing',
  'actual_effort_mismatch',
  'actual_identity_missing',
  'actual_identity_mismatch',
  'structured_output_malformed',
] as const);

interface TimedFact {
  observed_at: string;
  valid_until: string;
}

export interface ClaudeProviderRequest {
  schema: typeof CLAUDE_PROVIDER_REQUEST_SCHEMA;
  request_id: string;
  /** Issued upstream. The provider must preserve it and must never manufacture a durable run. */
  run_ref: string;
  attempt_id: string;
  origin_harness: ClaudeOriginHarness;
  provider: 'claude';
  workspace: string;
  objective: string;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  runtime_sha256: string;
  launch_idempotency_key: string;
  launch_nonce: string;
  permission: {
    mode: 'dontAsk';
    account_mutation: 'forbidden';
    credential_write: 'forbidden';
    remote_mutation: 'forbidden';
  };
  admission: {
    policy: TimedFact & { decision: AdmissionDecision };
    auth: TimedFact & { state: AdmissionState };
    quota: TimedFact & {
      state: QuotaState;
      /** Pool kinds remain disjoint; this fixture slice admits only subscription evidence. */
      pool: {
        kind: PoolKind;
        pool_id: string;
        account_id: string;
        identity_fingerprint: string;
      };
      reservation: {
        reservation_id: string;
        request_hash: string;
        expires_at: string;
        aggregation_key: string;
        source_revision: string;
      };
      preflight: {
        decision: 'allow' | 'reject' | 'unknown';
        freshness: 'fresh' | 'soft-stale' | 'hard-stale' | 'unknown' | 'conflict';
        spawn_count: 0;
      };
      ticket: {
        schema: 'ccm/quota-admission-ticket/v1';
        ticket_id: string;
        reservation_id: string;
        reservation_request_hash: string;
        reservation_expires_at: string;
        attempt_id: string;
        run_ref: string;
        account_id: string;
        pool_id: string;
        identity_fingerprint: string;
        aggregation_key: string;
        live_source_revision: string;
        runtime_sha256: string;
        launch_idempotency_key: string;
        launch_nonce: string;
        issued_at: string;
        committed_at: string;
        launch_by: string;
      };
      ticket_digest: string;
    };
    model: TimedFact & {
      state: ModelState;
      requested: string;
      resolved: string;
    };
  };
  timeouts_ms: {
    startup: number;
    idle: number;
    hard: number;
  };
}

export interface ClaudeProviderSelection {
  origin_harness: ClaudeOriginHarness;
  provider_harness: 'claude-code';
  relation: 'same-origin' | 'other-origin';
  surface: 'cli-headless';
}

export interface ClaudeProviderPreflight {
  schema: typeof CLAUDE_PROVIDER_PREFLIGHT_SCHEMA;
  request_id: string | null;
  run_ref: string | null;
  selection: ClaudeProviderSelection | null;
  decision: 'allow' | 'reject';
  reason_codes: string[];
  claim_count: 0;
  process_effects: 0;
}

export interface CompiledClaudeProviderInvocation {
  schema: typeof CLAUDE_PROVIDER_INVOCATION_SCHEMA;
  provider: 'claude';
  run_ref: string;
  cwd: string;
  argv: string[];
  stdin: string;
  env: Record<string, string>;
  constraints: ClaudeProviderRequest['permission'];
}

export interface ClaudeProviderReconciliation {
  schema: typeof CLAUDE_PROVIDER_RECONCILIATION_SCHEMA;
  run_ref: string | null;
  attempt_state: 'terminal';
  task_state: 'unproven';
  needs_independent_acceptance: true;
}

export interface ClaudeProviderResult {
  schema: typeof CLAUDE_PROVIDER_RESULT_SCHEMA;
  request_id: string | null;
  run_ref: string | null;
  status: ProviderStatus;
  selection: ClaudeProviderSelection | null;
  preflight: { decision: 'allow' | 'reject'; reason_codes: string[]; claim_count: 0 };
  process: {
    spawn_count: 0 | 1;
    exit_code: number | null;
    signal: NodeJS.Signals | null;
    reaped: boolean;
    duration_ms: number | null;
  };
  terminal: {
    kind: 'provider_terminal' | 'supervisor_terminal' | 'none';
    subtype: string | null;
    session_id: string | null;
  };
  requested_model: string | null;
  actual_models: string[];
  actual_identity: {
    model: string;
    effort: ClaudeProviderRequest['effort'];
    identity_fingerprint: string;
  } | null;
  output: unknown;
  error: { code: string; messages: string[] } | null;
  reconciliation: ClaudeProviderReconciliation;
  side_effects: {
    account_mutations: 0;
    credential_writes: 0;
    provider_requests: 0;
    remote_mutations: 0;
  };
}

export interface InvokeOfflineClaudeProviderOptions {
  now?: string;
  signal?: AbortSignal;
}

const PROMPT =
  'Treat stdin as the complete worker envelope and return only the requested JSON result.';
const MAX_TIMEOUT_MS = 600_000;
const STDOUT_LIMIT_BYTES = 1024 * 1024;
const STDERR_LIMIT_BYTES = 64 * 1024;

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return (
    Object.keys(value).length === keys.length && Object.keys(value).every((key) => allowed.has(key))
  );
}

function stringFields(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => typeof value[key] === 'string');
}

function member(value: unknown, values: readonly string[]): boolean {
  return typeof value === 'string' && values.includes(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

type ParseReason = (typeof CLAUDE_PROVIDER_PARSE_REASON_CODES)[number];
type ParsedRequest =
  | { ok: true; request: ClaudeProviderRequest }
  | {
      ok: false;
      reason: ParseReason;
      request_id: string | null;
      run_ref: string | null;
      requested_model: string | null;
    };

function parseFailure(input: unknown, reason: ParseReason): ParsedRequest {
  const object = plain(input) ? input : {};
  return {
    ok: false,
    reason,
    request_id: typeof object.request_id === 'string' ? object.request_id : null,
    run_ref: typeof object.run_ref === 'string' ? object.run_ref : null,
    requested_model: typeof object.model === 'string' ? object.model : null,
  };
}

export function parseClaudeProviderRequest(input: unknown): ParsedRequest {
  if (!plain(input)) return parseFailure(input, 'request_not_object');
  const topKeys = [
    'schema',
    'request_id',
    'run_ref',
    'attempt_id',
    'origin_harness',
    'provider',
    'workspace',
    'objective',
    'model',
    'effort',
    'runtime_sha256',
    'launch_idempotency_key',
    'launch_nonce',
    'permission',
    'admission',
    'timeouts_ms',
  ] as const;
  if (
    !exactKeys(input, topKeys) ||
    !stringFields(input, [
      'schema',
      'request_id',
      'run_ref',
      'attempt_id',
      'origin_harness',
      'provider',
      'workspace',
      'objective',
      'model',
      'effort',
      'runtime_sha256',
      'launch_idempotency_key',
      'launch_nonce',
    ])
  )
    return parseFailure(input, 'request_fields_invalid');
  if (input.schema !== CLAUDE_PROVIDER_REQUEST_SCHEMA)
    return parseFailure(input, 'request_schema_invalid');
  if (input.provider !== 'claude') return parseFailure(input, 'provider_invalid');
  if (!member(input.origin_harness, ['claude-code', 'codex', 'cursor']))
    return parseFailure(input, 'origin_harness_invalid');
  if (!member(input.effort, ['low', 'medium', 'high', 'xhigh', 'max']))
    return parseFailure(input, 'effort_invalid');

  const permission = input.permission;
  if (
    !plain(permission) ||
    !exactKeys(permission, ['mode', 'account_mutation', 'credential_write', 'remote_mutation']) ||
    permission.mode !== 'dontAsk' ||
    permission.account_mutation !== 'forbidden' ||
    permission.credential_write !== 'forbidden' ||
    permission.remote_mutation !== 'forbidden'
  )
    return parseFailure(input, 'permission_invalid');

  const admission = input.admission;
  if (!plain(admission) || !exactKeys(admission, ['policy', 'auth', 'quota', 'model']))
    return parseFailure(input, 'admission_fields_invalid');
  const policy = admission.policy;
  if (
    !plain(policy) ||
    !exactKeys(policy, ['decision', 'observed_at', 'valid_until']) ||
    !member(policy.decision, ['allow', 'deny', 'unknown']) ||
    !stringFields(policy, ['observed_at', 'valid_until'])
  )
    return parseFailure(input, 'policy_fact_invalid');
  const auth = admission.auth;
  if (
    !plain(auth) ||
    !exactKeys(auth, ['state', 'observed_at', 'valid_until']) ||
    !member(auth.state, ['authenticated', 'unauthenticated', 'unknown']) ||
    !stringFields(auth, ['observed_at', 'valid_until'])
  )
    return parseFailure(input, 'auth_fact_invalid');
  const quota = admission.quota;
  if (
    !plain(quota) ||
    !exactKeys(quota, [
      'state',
      'pool',
      'reservation',
      'preflight',
      'ticket',
      'ticket_digest',
      'observed_at',
      'valid_until',
    ]) ||
    !member(quota.state, ['ample', 'tight', 'exhausted', 'unknown']) ||
    !stringFields(quota, ['ticket_digest', 'observed_at', 'valid_until'])
  )
    return parseFailure(input, 'quota_fact_invalid');
  const pool = quota.pool;
  if (
    !plain(pool) ||
    !exactKeys(pool, ['kind', 'pool_id', 'account_id', 'identity_fingerprint']) ||
    !member(pool.kind, ['subscription', 'api', 'cloud']) ||
    !stringFields(pool, ['pool_id', 'account_id', 'identity_fingerprint'])
  )
    return parseFailure(input, 'quota_pool_invalid');
  const reservation = quota.reservation;
  if (
    !plain(reservation) ||
    !exactKeys(reservation, [
      'reservation_id',
      'request_hash',
      'expires_at',
      'aggregation_key',
      'source_revision',
    ]) ||
    !stringFields(reservation, [
      'reservation_id',
      'request_hash',
      'expires_at',
      'aggregation_key',
      'source_revision',
    ])
  )
    return parseFailure(input, 'quota_reservation_invalid');
  const quotaPreflight = quota.preflight;
  if (
    !plain(quotaPreflight) ||
    !exactKeys(quotaPreflight, ['decision', 'freshness', 'spawn_count']) ||
    !member(quotaPreflight.decision, ['allow', 'reject', 'unknown']) ||
    !member(quotaPreflight.freshness, [
      'fresh',
      'soft-stale',
      'hard-stale',
      'unknown',
      'conflict',
    ]) ||
    typeof quotaPreflight.spawn_count !== 'number'
  )
    return parseFailure(input, 'quota_preflight_invalid');
  const ticket = quota.ticket;
  const ticketFields = [
    'schema',
    'ticket_id',
    'reservation_id',
    'reservation_request_hash',
    'reservation_expires_at',
    'attempt_id',
    'run_ref',
    'account_id',
    'pool_id',
    'identity_fingerprint',
    'aggregation_key',
    'live_source_revision',
    'runtime_sha256',
    'launch_idempotency_key',
    'launch_nonce',
    'issued_at',
    'committed_at',
    'launch_by',
  ] as const;
  if (
    !plain(ticket) ||
    !exactKeys(ticket, ticketFields) ||
    !stringFields(ticket, ticketFields) ||
    ticket.schema !== 'ccm/quota-admission-ticket/v1'
  )
    return parseFailure(input, 'quota_ticket_invalid');
  const model = admission.model;
  if (
    !plain(model) ||
    !exactKeys(model, ['state', 'requested', 'resolved', 'observed_at', 'valid_until']) ||
    !member(model.state, ['available', 'unavailable', 'unknown']) ||
    !stringFields(model, ['requested', 'resolved', 'observed_at', 'valid_until'])
  )
    return parseFailure(input, 'model_fact_invalid');
  const timeouts = input.timeouts_ms;
  if (
    !plain(timeouts) ||
    !exactKeys(timeouts, ['startup', 'idle', 'hard']) ||
    !['startup', 'idle', 'hard'].every((key) => typeof timeouts[key] === 'number')
  )
    return parseFailure(input, 'timeouts_fields_invalid');

  const cloned = structuredClone(input) as unknown as ClaudeProviderRequest;
  return { ok: true, request: deepFreeze(cloned) };
}

function isFresh(fact: TimedFact, nowMs: number): boolean {
  const observedAt = Date.parse(fact.observed_at);
  const validUntil = Date.parse(fact.valid_until);
  return (
    Number.isFinite(observedAt) &&
    Number.isFinite(validUntil) &&
    observedAt <= nowMs &&
    nowMs <= validUntil &&
    observedAt <= validUntil
  );
}

function validTimeout(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_TIMEOUT_MS;
}

function selectionFor(origin: ClaudeOriginHarness): ClaudeProviderSelection {
  return {
    origin_harness: origin,
    provider_harness: 'claude-code',
    relation: origin === 'claude-code' ? 'same-origin' : 'other-origin',
    surface: 'cli-headless',
  };
}

function validationReasons(request: ClaudeProviderRequest, now: string): string[] {
  const reasons: string[] = [];
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) reasons.push('clock_invalid');
  if (!isNonEmpty(request.request_id)) reasons.push('request_id_invalid');
  if (!isNonEmpty(request.run_ref)) reasons.push('run_ref_invalid');
  if (!isNonEmpty(request.attempt_id)) reasons.push('attempt_id_invalid');
  if (!isNonEmpty(request.workspace) || !path.isAbsolute(request.workspace))
    reasons.push('workspace_invalid');
  if (!isNonEmpty(request.objective)) reasons.push('objective_invalid');
  if (!isNonEmpty(request.model) || request.model === 'auto') reasons.push('model_invalid');
  if (!isNonEmpty(request.runtime_sha256)) reasons.push('runtime_sha256_invalid');
  if (!isNonEmpty(request.launch_idempotency_key)) reasons.push('launch_idempotency_key_invalid');
  if (!isNonEmpty(request.launch_nonce)) reasons.push('launch_nonce_invalid');
  if (
    !validTimeout(request.timeouts_ms.startup) ||
    !validTimeout(request.timeouts_ms.idle) ||
    !validTimeout(request.timeouts_ms.hard)
  )
    reasons.push('timeouts_invalid');
  if (request.timeouts_ms.startup > request.timeouts_ms.hard)
    reasons.push('startup_exceeds_hard_timeout');

  const facts = request.admission;
  if (facts.policy.decision !== 'allow') reasons.push('policy_not_allowed');
  if (facts.auth.state !== 'authenticated') reasons.push('auth_not_authenticated');
  if (facts.quota.state !== 'ample') reasons.push('quota_not_ample');
  if (facts.quota.preflight.decision !== 'allow') reasons.push('quota_preflight_not_allowed');
  if (facts.quota.preflight.freshness !== 'fresh') reasons.push('quota_preflight_stale');
  if (facts.quota.preflight.spawn_count !== 0) reasons.push('quota_preflight_effect_invalid');
  if (facts.model.state !== 'available') reasons.push('model_not_available');
  if (facts.model.requested !== request.model || facts.model.resolved !== request.model)
    reasons.push('model_mismatch');
  if (facts.quota.pool.kind !== 'subscription') reasons.push('quota_pool_kind_mismatch');
  const authority = facts.quota;
  const reservation = authority.reservation;
  const pool = authority.pool;
  const ticket = facts.quota.ticket;
  if (
    ![
      request.attempt_id,
      request.runtime_sha256,
      request.launch_idempotency_key,
      request.launch_nonce,
      pool.pool_id,
      pool.account_id,
      pool.identity_fingerprint,
      reservation.reservation_id,
      reservation.request_hash,
      reservation.expires_at,
      reservation.aggregation_key,
      reservation.source_revision,
      authority.ticket_digest,
      ticket.ticket_id,
    ].every(isNonEmpty)
  )
    reasons.push('quota_authority_invalid');
  if (authority.ticket_digest !== digest(ticket)) reasons.push('quota_ticket_digest_mismatch');
  const issuedAt = Date.parse(ticket.issued_at);
  const committedAt = Date.parse(ticket.committed_at);
  const launchBy = Date.parse(ticket.launch_by);
  const reservationExpiresAt = Date.parse(ticket.reservation_expires_at);
  if (
    ![issuedAt, committedAt, launchBy, reservationExpiresAt].every(Number.isFinite) ||
    committedAt < issuedAt ||
    launchBy < committedAt ||
    launchBy > reservationExpiresAt
  )
    reasons.push('quota_ticket_time_invalid');
  if (launchBy <= nowMs || reservationExpiresAt <= nowMs) reasons.push('quota_ticket_expired');
  if (
    ticket.reservation_id !== reservation.reservation_id ||
    ticket.reservation_request_hash !== reservation.request_hash ||
    ticket.reservation_expires_at !== reservation.expires_at ||
    ticket.attempt_id !== request.attempt_id ||
    ticket.run_ref !== request.run_ref ||
    ticket.account_id !== pool.account_id ||
    ticket.pool_id !== pool.pool_id ||
    ticket.identity_fingerprint !== pool.identity_fingerprint ||
    ticket.aggregation_key !== reservation.aggregation_key ||
    ticket.live_source_revision !== reservation.source_revision ||
    ticket.runtime_sha256 !== request.runtime_sha256 ||
    ticket.launch_idempotency_key !== request.launch_idempotency_key ||
    ticket.launch_nonce !== request.launch_nonce
  )
    reasons.push('quota_ticket_mismatch');
  for (const [name, fact] of Object.entries(facts)) {
    if (!Number.isFinite(nowMs) || !isFresh(fact, nowMs)) reasons.push(`${name}_stale_or_invalid`);
  }
  return [...new Set(reasons)];
}

export function preflightClaudeProvider(
  input: unknown,
  now = new Date().toISOString(),
): ClaudeProviderPreflight {
  const parsed = parseClaudeProviderRequest(input);
  if (!parsed.ok) {
    return {
      schema: CLAUDE_PROVIDER_PREFLIGHT_SCHEMA,
      request_id: parsed.request_id,
      run_ref: parsed.run_ref,
      selection: null,
      decision: 'reject',
      reason_codes: [parsed.reason],
      claim_count: 0,
      process_effects: 0,
    };
  }
  return preflightParsedClaudeProvider(parsed.request, now);
}

function preflightParsedClaudeProvider(
  request: ClaudeProviderRequest,
  now: string,
): ClaudeProviderPreflight {
  const reasonCodes = validationReasons(request, now);
  return {
    schema: CLAUDE_PROVIDER_PREFLIGHT_SCHEMA,
    request_id: request.request_id,
    run_ref: request.run_ref,
    selection: selectionFor(request.origin_harness),
    decision: reasonCodes.length === 0 ? 'allow' : 'reject',
    reason_codes: reasonCodes,
    claim_count: 0,
    process_effects: 0,
  };
}

function compiledEnvelope(request: ClaudeProviderRequest): Record<string, unknown> {
  return {
    schema: CLAUDE_PROVIDER_REQUEST_SCHEMA,
    request_id: request.request_id,
    run_ref: request.run_ref,
    origin_harness: request.origin_harness,
    objective: request.objective,
    workspace: request.workspace,
    requested: { model: request.model, effort: request.effort },
    constraints: request.permission,
  };
}

export function compileClaudeProviderInvocation(
  input: unknown,
  now = new Date().toISOString(),
): CompiledClaudeProviderInvocation {
  const parsed = parseClaudeProviderRequest(input);
  if (!parsed.ok) {
    throw new TypeError(`Claude provider request rejected: ${parsed.reason}`);
  }
  const request = parsed.request;
  const preflight = preflightParsedClaudeProvider(request, now);
  if (preflight.decision !== 'allow') {
    throw new TypeError(`Claude provider request rejected: ${preflight.reason_codes.join(',')}`);
  }
  return {
    schema: CLAUDE_PROVIDER_INVOCATION_SCHEMA,
    provider: 'claude',
    run_ref: request.run_ref,
    cwd: request.workspace,
    argv: [
      '-p',
      PROMPT,
      '--model',
      request.model,
      '--effort',
      request.effort,
      '--permission-mode',
      'dontAsk',
      '--output-format',
      'json',
    ],
    stdin: `${JSON.stringify(compiledEnvelope(request))}\n`,
    env: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' },
    constraints: { ...request.permission },
  };
}

export function reconcileClaudeProviderTerminal(
  runRef: string | null,
): ClaudeProviderReconciliation {
  return {
    schema: CLAUDE_PROVIDER_RECONCILIATION_SCHEMA,
    run_ref: runRef,
    attempt_state: 'terminal',
    task_state: 'unproven',
    needs_independent_acceptance: true,
  };
}

const ZERO_SIDE_EFFECTS = Object.freeze({
  account_mutations: 0 as const,
  credential_writes: 0 as const,
  provider_requests: 0 as const,
  remote_mutations: 0 as const,
});

function resultBase(
  context: {
    request_id: string | null;
    run_ref: string | null;
    requested_model: string | null;
  },
  preflight: ClaudeProviderPreflight,
): Pick<
  ClaudeProviderResult,
  | 'schema'
  | 'request_id'
  | 'run_ref'
  | 'selection'
  | 'preflight'
  | 'requested_model'
  | 'reconciliation'
  | 'side_effects'
> {
  return {
    schema: CLAUDE_PROVIDER_RESULT_SCHEMA,
    request_id: context.request_id,
    run_ref: context.run_ref,
    selection: preflight.selection,
    preflight: {
      decision: preflight.decision,
      reason_codes: [...preflight.reason_codes],
      claim_count: 0,
    },
    requested_model: context.requested_model,
    reconciliation: reconcileClaudeProviderTerminal(context.run_ref),
    side_effects: { ...ZERO_SIDE_EFFECTS },
  };
}

function requestContext(request: ClaudeProviderRequest): {
  request_id: string;
  run_ref: string;
  requested_model: string;
} {
  return {
    request_id: request.request_id,
    run_ref: request.run_ref,
    requested_model: request.model,
  };
}

function rejectedResult(
  context: {
    request_id: string | null;
    run_ref: string | null;
    requested_model: string | null;
  },
  preflight: ClaudeProviderPreflight,
): ClaudeProviderResult {
  return {
    ...resultBase(context, preflight),
    status: 'rejected',
    process: {
      spawn_count: 0,
      exit_code: null,
      signal: null,
      reaped: false,
      duration_ms: null,
    },
    terminal: { kind: 'none', subtype: null, session_id: null },
    actual_models: [],
    actual_identity: null,
    output: null,
    error: { code: preflight.reason_codes[0] ?? 'preflight_rejected', messages: [] },
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function parseProviderTerminal(
  request: ClaudeProviderRequest,
  preflight: ClaudeProviderPreflight,
  processResult: ProviderChildResult,
): ClaudeProviderResult {
  let terminal: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(processResult.stdout.trim());
    if (!plain(parsed)) throw new TypeError('terminal must be an object');
    terminal = parsed;
  } catch (error) {
    return {
      ...resultBase(requestContext(request), preflight),
      status: 'failed',
      process: {
        spawn_count: 1,
        exit_code: processResult.exitCode,
        signal: processResult.signal,
        reaped: processResult.reaped,
        duration_ms: processResult.durationMs,
      },
      terminal: { kind: 'provider_terminal', subtype: null, session_id: null },
      actual_models: [],
      actual_identity: null,
      output: null,
      error: {
        code: 'terminal_malformed',
        messages: [
          error instanceof Error ? error.message : String(error),
          ...(processResult.stderr.trim() ? [processResult.stderr.trim()] : []),
        ],
      },
    };
  }

  const subtype = typeof terminal.subtype === 'string' ? terminal.subtype : null;
  const sessionId = typeof terminal.session_id === 'string' ? terminal.session_id : null;
  const actualModels = plain(terminal.modelUsage) ? Object.keys(terminal.modelUsage).sort() : [];
  const metadata = plain(terminal.provider_metadata) ? terminal.provider_metadata : null;
  const actualModel = metadata && isNonEmpty(metadata.model) ? metadata.model : null;
  const actualEffort = metadata && isNonEmpty(metadata.effort) ? metadata.effort : null;
  const actualIdentityFingerprint =
    metadata && isNonEmpty(metadata.identity_fingerprint) ? metadata.identity_fingerprint : null;
  const structuredOutput = plain(terminal.structured_output) ? terminal.structured_output : null;
  const outputValid =
    structuredOutput !== null &&
    isNonEmpty(structuredOutput.outcome) &&
    isNonEmpty(structuredOutput.summary);
  const terminalValid =
    terminal.type === 'result' &&
    isNonEmpty(subtype) &&
    typeof terminal.is_error === 'boolean' &&
    isNonEmpty(sessionId);
  const providerSuccess =
    terminalValid &&
    subtype === 'success' &&
    terminal.is_error === false &&
    processResult.exitCode === 0 &&
    processResult.signal === null;
  let errorCode: string | null = null;
  if (!terminalValid) errorCode = 'terminal_invalid';
  else if (!providerSuccess) errorCode = 'provider_failed';
  else if (!actualModel || actualModels.length === 0) errorCode = 'actual_model_missing';
  else if (
    actualModel !== request.model ||
    actualModels.length !== 1 ||
    actualModels[0] !== request.model
  )
    errorCode = 'actual_model_mismatch';
  else if (!actualEffort) errorCode = 'actual_effort_missing';
  else if (actualEffort !== request.effort) errorCode = 'actual_effort_mismatch';
  else if (!actualIdentityFingerprint) errorCode = 'actual_identity_missing';
  else if (actualIdentityFingerprint !== request.admission.quota.ticket.identity_fingerprint)
    errorCode = 'actual_identity_mismatch';
  else if (!outputValid) errorCode = 'structured_output_malformed';
  const status: ProviderStatus = errorCode === null ? 'succeeded' : 'failed';
  const verifiedIdentity =
    errorCode === null && actualModel && actualEffort && actualIdentityFingerprint
      ? {
          model: actualModel,
          effort: actualEffort as ClaudeProviderRequest['effort'],
          identity_fingerprint: actualIdentityFingerprint,
        }
      : null;
  return {
    ...resultBase(requestContext(request), preflight),
    status,
    process: {
      spawn_count: 1,
      exit_code: processResult.exitCode,
      signal: processResult.signal,
      reaped: processResult.reaped,
      duration_ms: processResult.durationMs,
    },
    terminal: { kind: 'provider_terminal', subtype, session_id: sessionId },
    actual_models: actualModels,
    actual_identity: verifiedIdentity,
    output: errorCode === null ? structuredOutput : null,
    error: errorCode ? { code: errorCode, messages: stringArray(terminal.errors) } : null,
  };
}

function supervisorFailureResult(
  request: ClaudeProviderRequest,
  preflight: ClaudeProviderPreflight,
  error: unknown,
): ClaudeProviderResult {
  const supervised = error instanceof ProviderChildSupervisorError ? error : null;
  const code = supervised?.code ?? 'provider_invoke_failed';
  const status: ProviderStatus =
    code === 'cancelled'
      ? 'cancelled'
      : code.endsWith('_timeout')
        ? 'timed_out'
        : code === 'spawn_error'
          ? 'rejected'
          : 'failed';
  return {
    ...resultBase(requestContext(request), preflight),
    status,
    process: {
      spawn_count: 1,
      exit_code: supervised?.termination?.exitCode ?? null,
      signal: supervised?.termination?.signal ?? null,
      reaped: supervised?.termination?.reaped ?? false,
      duration_ms: null,
    },
    terminal: { kind: 'supervisor_terminal', subtype: code, session_id: null },
    actual_models: [],
    actual_identity: null,
    output: null,
    error: { code, messages: [error instanceof Error ? error.message : String(error)] },
  };
}

function synchronousEffectFailureResult(
  request: ClaudeProviderRequest,
  preflight: ClaudeProviderPreflight,
  phase: 'resolve' | 'spawn',
  error: unknown,
): ClaudeProviderResult {
  const code =
    phase === 'resolve'
      ? 'resolve_error'
      : error instanceof ProviderProcessTreeOwnershipError
        ? error.code
        : 'spawn_error';
  return {
    ...resultBase(requestContext(request), preflight),
    status: 'rejected',
    process: {
      spawn_count: phase === 'spawn' ? 1 : 0,
      exit_code: null,
      signal: null,
      reaped: false,
      duration_ms: null,
    },
    terminal: { kind: 'supervisor_terminal', subtype: code, session_id: null },
    actual_models: [],
    actual_identity: null,
    output: null,
    error: { code, messages: [error instanceof Error ? error.message : String(error)] },
  };
}

function childLimits(request: ClaudeProviderRequest): ProviderChildLimits {
  return {
    startupTimeoutMs: request.timeouts_ms.startup,
    idleTimeoutMs: request.timeouts_ms.idle,
    stdoutLimitBytes: STDOUT_LIMIT_BYTES,
    stderrLimitBytes: STDERR_LIMIT_BYTES,
    terminationGraceMs: 50,
    reapTimeoutMs: 500,
  };
}

export async function invokeOfflineClaudeProvider(
  input: unknown,
  runtime: ProviderRuntime,
  options: InvokeOfflineClaudeProviderOptions = {},
): Promise<ClaudeProviderResult> {
  const now = options.now ?? new Date().toISOString();
  const parsed = parseClaudeProviderRequest(input);
  if (!parsed.ok) {
    const preflight = preflightClaudeProvider(input, now);
    return rejectedResult(parsed, preflight);
  }
  const request = parsed.request;
  const preflight = preflightParsedClaudeProvider(request, now);
  if (preflight.decision !== 'allow') return rejectedResult(requestContext(request), preflight);
  let executable: string | null;
  try {
    executable = runtime.process.resolveExecutable('claude');
  } catch (error) {
    return synchronousEffectFailureResult(request, preflight, 'resolve', error);
  }
  if (!executable) {
    return {
      ...rejectedResult(requestContext(request), {
        ...preflight,
        decision: 'reject',
        reason_codes: ['cli_missing'],
      }),
      error: { code: 'cli_missing', messages: [] },
    };
  }
  const compiled = compileClaudeProviderInvocation(request, now);
  let ownedChild: ProviderOwnedChild;
  try {
    ownedChild = runtime.process.spawnProvider({
      executable,
      argv: compiled.argv,
      cwd: compiled.cwd,
      env: compiled.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    return synchronousEffectFailureResult(request, preflight, 'spawn', error);
  }
  ownedChild.child.stdin?.on('error', () => {
    // The supervised terminal/cleanup result remains authoritative when a child closes stdin first.
  });
  try {
    const processResult = await superviseProviderChild(ownedChild, {
      operation: `claude-provider:${request.request_id}`,
      deadline: createProviderRequestDeadline(request.timeouts_ms.hard),
      limits: childLimits(request),
      signal: options.signal,
      onStarted: () => {
        if (!ownedChild.child.stdin) throw new Error('Claude provider stdin is unavailable');
        ownedChild.child.stdin.write(compiled.stdin);
        ownedChild.child.stdin.end();
      },
    });
    return parseProviderTerminal(request, preflight, processResult);
  } catch (error) {
    return supervisorFailureResult(request, preflight, error);
  }
}
