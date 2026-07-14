// Offline Claude CLI provider slice.
//
// This module owns only provider-local selection, admission, compilation, process-result parsing,
// and reconciliation. It accepts a supervisor-issued run_ref and an injected runtime; it does not
// create durable runs, probe accounts/quota, mutate credentials, or request provider/network APIs.

import * as path from 'node:path';
import {
  createProviderRequestDeadline,
  type ProviderChildLimits,
  type ProviderChildResult,
  ProviderChildSupervisorError,
  superviseProviderChild,
} from './provider-child-supervisor.js';
import type { ProviderRuntime } from './provider-runtime.js';

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

interface TimedFact {
  observed_at: string;
  valid_until: string;
}

export interface ClaudeProviderRequest {
  schema: typeof CLAUDE_PROVIDER_REQUEST_SCHEMA;
  request_id: string;
  /** Issued upstream. The provider must preserve it and must never manufacture a durable run. */
  run_ref: string;
  origin_harness: ClaudeOriginHarness;
  provider: 'claude';
  workspace: string;
  objective: string;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
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
      pool: { kind: PoolKind; pool_id: string };
      preflight: {
        decision: 'allow' | 'reject' | 'unknown';
        freshness: 'fresh' | 'soft-stale' | 'hard-stale' | 'unknown' | 'conflict';
        spawn_count: 0;
      };
      ticket: {
        schema: 'ccm/quota-admission-ticket/v1';
        run_ref: string;
        account_id: string;
        pool_id: string;
        identity_fingerprint: string;
        launch_by: string;
      };
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
  request_id: string;
  run_ref: string;
  selection: ClaudeProviderSelection;
  decision: 'allow' | 'reject';
  reason_codes: string[];
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
  run_ref: string;
  attempt_state: 'terminal';
  task_state: 'unproven';
  needs_independent_acceptance: true;
}

export interface ClaudeProviderResult {
  schema: typeof CLAUDE_PROVIDER_RESULT_SCHEMA;
  request_id: string;
  run_ref: string;
  status: ProviderStatus;
  selection: ClaudeProviderSelection;
  preflight: { decision: 'allow' | 'reject'; reason_codes: string[] };
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
  requested_model: string;
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
  if (request.schema !== CLAUDE_PROVIDER_REQUEST_SCHEMA || request.provider !== 'claude')
    reasons.push('request_schema_invalid');
  if (!isNonEmpty(request.request_id)) reasons.push('request_id_invalid');
  if (!isNonEmpty(request.run_ref)) reasons.push('run_ref_invalid');
  if (!isNonEmpty(request.workspace) || !path.isAbsolute(request.workspace))
    reasons.push('workspace_invalid');
  if (!isNonEmpty(request.objective)) reasons.push('objective_invalid');
  if (!isNonEmpty(request.model) || request.model === 'auto') reasons.push('model_invalid');
  if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(request.effort))
    reasons.push('effort_invalid');
  if (
    request.permission.mode !== 'dontAsk' ||
    request.permission.account_mutation !== 'forbidden' ||
    request.permission.credential_write !== 'forbidden' ||
    request.permission.remote_mutation !== 'forbidden'
  )
    reasons.push('permission_policy_invalid');
  if (
    !validTimeout(request.timeouts_ms.startup) ||
    !validTimeout(request.timeouts_ms.idle) ||
    !validTimeout(request.timeouts_ms.hard)
  )
    reasons.push('timeouts_invalid');
  if (request.timeouts_ms.startup > request.timeouts_ms.hard)
    reasons.push('startup_exceeds_hard_timeout');

  const facts = request.admission;
  if (facts.policy.decision !== 'allow') reasons.push(`policy_${facts.policy.decision}`);
  if (facts.auth.state !== 'authenticated') reasons.push(`auth_${facts.auth.state}`);
  if (facts.quota.state !== 'ample') reasons.push(`quota_${facts.quota.state}`);
  if (facts.quota.preflight.decision !== 'allow')
    reasons.push(`quota_preflight_${facts.quota.preflight.decision}`);
  if (facts.quota.preflight.freshness !== 'fresh') reasons.push('quota_preflight_stale');
  if (facts.quota.preflight.spawn_count !== 0) reasons.push('quota_preflight_effect_invalid');
  if (facts.model.state !== 'available') reasons.push(`model_${facts.model.state}`);
  if (facts.model.requested !== request.model || facts.model.resolved !== request.model)
    reasons.push('model_mismatch');
  if (facts.quota.pool.kind !== 'subscription') reasons.push('quota_pool_kind_mismatch');
  if (!isNonEmpty(facts.quota.pool.pool_id)) reasons.push('quota_pool_id_invalid');
  const ticket = facts.quota.ticket;
  if (
    ticket.schema !== 'ccm/quota-admission-ticket/v1' ||
    ticket.run_ref !== request.run_ref ||
    ticket.pool_id !== facts.quota.pool.pool_id ||
    !isNonEmpty(ticket.account_id) ||
    !isNonEmpty(ticket.identity_fingerprint) ||
    !Number.isFinite(Date.parse(ticket.launch_by)) ||
    Date.parse(ticket.launch_by) <= nowMs
  )
    reasons.push('quota_ticket_mismatch');
  for (const [name, fact] of Object.entries(facts)) {
    if (!Number.isFinite(nowMs) || !isFresh(fact, nowMs)) reasons.push(`${name}_stale_or_invalid`);
  }
  return [...new Set(reasons)];
}

export function preflightClaudeProvider(
  request: ClaudeProviderRequest,
  now = new Date().toISOString(),
): ClaudeProviderPreflight {
  const reasonCodes = validationReasons(request, now);
  return {
    schema: CLAUDE_PROVIDER_PREFLIGHT_SCHEMA,
    request_id: request.request_id,
    run_ref: request.run_ref,
    selection: selectionFor(request.origin_harness),
    decision: reasonCodes.length === 0 ? 'allow' : 'reject',
    reason_codes: reasonCodes,
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
  request: ClaudeProviderRequest,
  now = new Date().toISOString(),
): CompiledClaudeProviderInvocation {
  const preflight = preflightClaudeProvider(request, now);
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

export function reconcileClaudeProviderTerminal(runRef: string): ClaudeProviderReconciliation {
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
  request: ClaudeProviderRequest,
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
    request_id: request.request_id,
    run_ref: request.run_ref,
    selection: preflight.selection,
    preflight: { decision: preflight.decision, reason_codes: [...preflight.reason_codes] },
    requested_model: request.model,
    reconciliation: reconcileClaudeProviderTerminal(request.run_ref),
    side_effects: { ...ZERO_SIDE_EFFECTS },
  };
}

function rejectedResult(
  request: ClaudeProviderRequest,
  preflight: ClaudeProviderPreflight,
): ClaudeProviderResult {
  return {
    ...resultBase(request, preflight),
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

function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
      ...resultBase(request, preflight),
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
    ...resultBase(request, preflight),
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
    ...resultBase(request, preflight),
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
  request: ClaudeProviderRequest,
  runtime: ProviderRuntime,
  options: InvokeOfflineClaudeProviderOptions = {},
): Promise<ClaudeProviderResult> {
  const now = options.now ?? new Date().toISOString();
  const preflight = preflightClaudeProvider(request, now);
  if (preflight.decision !== 'allow') return rejectedResult(request, preflight);
  const executable = runtime.process.resolveExecutable('claude');
  if (!executable) {
    return {
      ...rejectedResult(request, {
        ...preflight,
        decision: 'reject',
        reason_codes: ['cli_missing'],
      }),
      error: { code: 'cli_missing', messages: [] },
    };
  }
  const compiled = compileClaudeProviderInvocation(request, now);
  const ownedChild = runtime.process.spawnProvider({
    executable,
    argv: compiled.argv,
    cwd: compiled.cwd,
    env: compiled.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
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
