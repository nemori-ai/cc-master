// cursor-provider-driver.ts — provider-local, offline-first Cursor Agent transport composition.
//
// This module owns no discovery, credential, quota-store, board, or network effects. Callers supply
// already-observed facts and the existing ProviderRuntime process boundary. Every load-bearing fact
// is checked before spawn; an eligible child is immediately handed to the shared process supervisor.

import { isAbsolute } from 'node:path';
import {
  CANONICAL_LAUNCH_IDENTITY_SCHEMA,
  type CanonicalLaunchIdentity,
  canonicalJson,
  evaluateLiveQuotaAdmission,
  isSha256Digest,
  normalizeCanonicalLaunchIdentity,
  sha256Digest,
} from '@ccm/engine';
import {
  CURSOR_PROVIDER_LAUNCH_EXTENSION_REGISTRY,
  CURSOR_PROVIDER_LAUNCH_EXTENSION_SCHEMA,
  type CursorProviderLaunchExtension,
  digestCursorProviderLaunchRequest,
  parseCursorProviderLaunchExtension,
} from './cursor-provider-launch-extension.js';
import { evaluateCursorAgentAdmission } from './harnesses/cursor-agent-admission.js';
import {
  createProviderRequestDeadline,
  type ProviderChildResult,
  ProviderChildSupervisorError,
  type ProviderRequestDeadline,
  superviseProviderChild,
  terminateAndReapProviderChild,
} from './provider-child-supervisor.js';
import type { ProviderOwnedChild, ProviderRuntime, ProviderSpawnSpec } from './provider-runtime.js';
import {
  digestQuotaAdmissionTicket,
  parseQuotaAdmissionTicket,
  QUOTA_ADMISSION_TICKET_REGISTRY,
  type QuotaAdmissionTicketProviderLaunchBindingContext,
  validateQuotaAdmissionTicketProviderLaunchBinding,
} from './quota-admission-ticket.js';
import {
  parseQuotaOwnerPreflightReceipt,
  QUOTA_OWNER_PREFLIGHT_RECEIPT_REGISTRY,
  type QuotaOwnerPreflightReceiptBindingContext,
  validateQuotaOwnerPreflightReceiptBinding,
} from './quota-owner-receipt.js';

export const CURSOR_PROVIDER_DRIVER_CONTRACT = 'ccm/cursor-provider-driver/v2' as const;
export const CURSOR_PROVIDER_REQUEST_CONTRACT = 'ccm/cursor-provider-request/v2' as const;

const CURSOR_AGENT_SURFACE = 'cursor-agent-cli';
const CURSOR_AGENT_LAUNCH_DESCRIPTOR = Object.freeze({
  harness: 'cursor',
  adapter: 'cursor/agent-cli-v1',
  surface: 'cli-headless',
  transport: 'cursor-agent-json-stream-v1',
});
const REQUIRED_PERMISSION_DENIES = Object.freeze([
  'account-mutation',
  'credential-write',
  'push-remote',
]);
const REQUEST_FIELDS = Object.freeze({
  $: Object.freeze([
    'schema',
    'as_of',
    'origin_harness',
    'origin_session_ref',
    'run_ref',
    'attempt_id',
    'workspace',
    'prompt',
    'selector',
    'candidate',
    'lineage',
    'owner',
    'surfaces',
    'payer',
    'catalog',
    'quota',
    'reservation',
    'launch',
    'sandbox',
    'policy',
  ]),
  candidate: Object.freeze(['candidate_id', 'provider', 'model', 'effort', 'selector']),
  lineage: Object.freeze([
    'account_fingerprint_ref',
    'workspace_ref',
    'worktree_ref',
    'baseline_commit',
    'permission',
  ]),
  'lineage.permission': Object.freeze(['snapshot_ref', 'profile', 'denies']),
  owner: Object.freeze(['schema', 'source_key', 'reservation_id']),
  surfaces: Object.freeze(['cursor-ide-plugin', 'cursor-agent-cli']),
  'surfaces.cursor-ide-plugin': Object.freeze(['installed', 'auth']),
  'surfaces.cursor-ide-plugin.auth': Object.freeze(['state']),
  'surfaces.cursor-agent-cli': Object.freeze([
    'surface_id',
    'installed',
    'installed_evidence',
    'binary',
    'auth',
  ]),
  'surfaces.cursor-agent-cli.installed_evidence': Object.freeze([
    'surface_id',
    'axis',
    'source',
    'observed_at',
    'valid_until',
  ]),
  'surfaces.cursor-agent-cli.binary': Object.freeze([
    'available',
    'name',
    'path',
    'version',
    'runtime_sha256',
    'surface_id',
    'axis',
    'source',
    'observed_at',
    'valid_until',
  ]),
  'surfaces.cursor-agent-cli.auth': Object.freeze([
    'state',
    'surface_id',
    'axis',
    'source',
    'observed_at',
    'valid_until',
  ]),
  payer: Object.freeze([
    'payer_id',
    'identity_fingerprint',
    'authority_id',
    'surface_id',
    'axis',
    'source',
    'observed_at',
    'valid_until',
  ]),
  catalog: Object.freeze([
    'authority_id',
    'payer_id',
    'pool',
    'pool_ref',
    'surface_id',
    'axis',
    'source',
    'observed_at',
    'valid_until',
    'selectors',
  ]),
  'catalog.selectors[]': Object.freeze([
    'candidate_id',
    'provider',
    'model',
    'effort',
    'selector',
    'authority_id',
    'payer_id',
    'pool',
    'pool_ref',
  ]),
  quota: Object.freeze([
    'state',
    'authority_id',
    'surface_id',
    'axis',
    'source',
    'source_revision',
    'aggregation_key',
    'payer_id',
    'pool',
    'provenance',
    'pool_ref',
    'observed_at',
    'valid_until',
  ]),
  reservation: Object.freeze([
    'id',
    'request_hash',
    'ticket_digest',
    'authority_digest',
    'authority_id',
    'state',
    'run_ref',
    'attempt_id',
    'payer_id',
    'pool',
    'pool_ref',
    'source_revision',
    'launch_by',
    'expires_at',
  ]),
  launch: Object.freeze(['idempotency_key', 'nonce']),
  sandbox: Object.freeze(['required', 'qualified']),
  policy: Object.freeze([
    'decision',
    'mode',
    'automatic_api_fallback',
    'account_mutation',
    'credential_write',
  ]),
});
const CONTRACT_ENUMS = Object.freeze({
  origin_harness: Object.freeze(['claude-code', 'codex', 'cursor']),
  auth_state: Object.freeze(['authenticated', 'unauthenticated', 'unknown']),
  binary_name: Object.freeze(['agent', 'cursor-agent']),
  binary_version: Object.freeze(['2026.07.09-a3815c0']),
  quota_state: Object.freeze(['ample', 'tight', 'exhausted', 'unknown']),
  reservation_state: Object.freeze([
    'held',
    'committed',
    'release_pending',
    'orphaned',
    'released',
    'expired',
  ]),
  policy_decision: Object.freeze(['allow', 'deny']),
  policy_mode: Object.freeze(['ask']),
  forbidden_effect: Object.freeze(['forbidden']),
});
const SUPPORTED_CURSOR_AGENT_NAMES = new Set(CONTRACT_ENUMS.binary_name);
const SUPPORTED_CURSOR_AGENT_VERSIONS = new Set(CONTRACT_ENUMS.binary_version);
const EVIDENCE_SOURCES = {
  installed: 'cursor-agent-cli/install/path-resolution/v1',
  binary: 'cursor-agent-cli/binary/capability-qualified/v1',
  auth: 'cursor-agent-cli/auth/status-json/v1',
  payer: 'cursor-agent-cli/payer/first-party-owner-store/v1',
  catalog: 'cursor-agent-cli/model-catalog/first-party-owner-store/v1',
  quota: 'cursor-agent-cli/quota/first-party-owner-store/v1',
} as const;

const REASON_SETS = Object.freeze({
  preflight: Object.freeze([
    'request.invalid',
    'request.input-invalid',
    'request.schema-invalid',
    'headless.surface-not-installed',
    'headless.binary-unavailable',
    'headless.evidence-invalid',
    'headless.binary-unsupported',
    'headless.authentication-unavailable',
    'payer.provenance-invalid',
    'catalog.stale-or-invalid',
    'catalog.provenance-invalid',
    'selector.auto-forbidden',
    'selector.exact-match-required',
    'candidate.binding-mismatch',
    'lineage.binding-mismatch',
    'permission.binding-mismatch',
    'quota.provenance-invalid',
    'quota.first-party-pool-required',
    'payer.binding-mismatch',
    'payer.authority-mismatch',
    'catalog.binding-mismatch',
    'quota.revision-invalid',
    'reservation.identity-invalid',
    'run.identity-invalid',
    'sandbox.unqualified',
    'reservation.binding-mismatch',
    'policy.denied',
    'quota.tight',
    'quota.exhausted',
    'quota.unknown',
    'quota.stale-or-invalid',
  ]),
  invoke: Object.freeze([
    'runtime.unsupported',
    'invoke.options-invalid',
    'owner.receipt-invalid',
    'owner.binding-mismatch',
    'owner.ticket-invalid',
    'owner.ticket-binding-mismatch',
    'headless.binary-resolution-mismatch',
    'transport.spawn-failed',
    'transport.supervisor-handoff-failed',
    'selector.resolved-mismatch',
    'workspace.resolved-mismatch',
    'result_schema.invalid-shape',
    'task_acceptance.rejected',
  ]),
  stream: Object.freeze([
    'stream.invalid-json',
    'stream.post-terminal-evidence',
    'stream.init-duplicate',
    'session.identity-invalid',
    'stream.terminal-duplicate',
    'stream.terminal-before-init',
    'stream.init-missing',
    'stream.terminal-missing',
    'permission.resolved-mismatch',
    'sandbox.resolved-missing',
    'sandbox.resolved-mismatch',
    'session.identity-mismatch',
  ]),
  supervisor: Object.freeze([
    'transport.startup_timeout',
    'transport.idle_timeout',
    'transport.hard_timeout',
    'transport.cancelled',
    'transport.spawn_error',
    'transport.stdio_unavailable',
    'transport.byte_stream_required',
    'transport.invalid_utf8',
    'transport.output_limit',
    'transport.consumer_error',
    'transport.owned_tree_survived',
  ]),
  dynamic_patterns: Object.freeze(['transport.exit-*', 'transport.signal-*']),
});
const REGISTERED_REASONS = new Set(
  [REASON_SETS.preflight, REASON_SETS.invoke, REASON_SETS.stream, REASON_SETS.supervisor].flat(),
);

export const CURSOR_PROVIDER_CONTRACT_REGISTRY = Object.freeze({
  request_fields: REQUEST_FIELDS,
  enums: CONTRACT_ENUMS,
  effects: Object.freeze([
    'owner.preflight',
    'executable.resolve',
    'process.spawn',
    'network.request',
  ]),
  reason_sets: REASON_SETS,
  owner_receipt: QUOTA_OWNER_PREFLIGHT_RECEIPT_REGISTRY,
  ticket: QUOTA_ADMISSION_TICKET_REGISTRY,
  launch_extension: CURSOR_PROVIDER_LAUNCH_EXTENSION_REGISTRY,
});

type JsonRecord = Record<string, unknown>;
type RouteRelation = 'same-origin' | 'other-origin';
type CursorProviderRunState = 'rejected' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';

export interface CursorProviderPreflight {
  schema: typeof CURSOR_PROVIDER_DRIVER_CONTRACT;
  eligible: boolean;
  blockers: string[];
  route_relation: RouteRelation;
  run_ref: string;
  attempt_id: string;
}

export interface CursorProviderInvocation extends ProviderSpawnSpec {
  contract: typeof CURSOR_PROVIDER_DRIVER_CONTRACT;
  run_ref: string;
  attempt_id: string;
  selector: string;
  route_relation: RouteRelation;
  ticket_digest: string;
  runtime_sha256: string;
  launch_idempotency_key: string;
  launch_nonce: string;
}

export interface CursorProviderRunResult {
  schema: 'ccm/cursor-provider-run-result/v1';
  run_ref: string;
  attempt_id: string;
  state: CursorProviderRunState;
  route_relation: RouteRelation;
  requested_selector: string | null;
  resolved_selector: string | null;
  session_id: string | null;
  provider_acceptance: 'accepted' | 'rejected' | 'unknown';
  task_acceptance: 'uncertain';
  blockers: string[];
  transport: {
    exit_code: number | null;
    signal: string | null;
    reaped: boolean;
  };
}

export interface CursorProviderInvokeOptions {
  runtime: ProviderRuntime;
  owner: {
    preflight(request: Readonly<JsonRecord>): Promise<unknown>;
  };
  hardTimeoutMs: number;
  signal?: AbortSignal;
}

export interface CursorProviderRunReconciliation {
  schema: 'ccm/cursor-provider-run-reconciliation/v1';
  run_ref: string;
  attempt_id: string;
  attempt_state: 'not-started' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';
  task_status: 'uncertain';
  task_done: false;
  terminal: boolean;
}

export function preflightCursorProvider(input: unknown): CursorProviderPreflight {
  const request = object(input);
  const runRef = string(request.run_ref);
  const attemptId = string(request.attempt_id);
  const routeRelation: RouteRelation =
    request.origin_harness === 'cursor' ? 'same-origin' : 'other-origin';
  if (!validCursorProviderRequest(input)) {
    return {
      schema: CURSOR_PROVIDER_DRIVER_CONTRACT,
      eligible: false,
      blockers: ['request.invalid'],
      route_relation: routeRelation,
      run_ref: runRef,
      attempt_id: attemptId,
    };
  }
  const surfaces = object(request.surfaces);
  const agent = object(surfaces['cursor-agent-cli']);
  const binary = object(agent.binary);
  const payer = object(request.payer);
  const catalog = object(request.catalog);
  const quota = object(request.quota);
  const reservation = object(request.reservation);
  const launch = object(request.launch);
  const sandbox = object(request.sandbox);
  const policy = object(request.policy);
  const asOf = instant(request.as_of);
  const selector = string(request.selector);
  const candidate = object(request.candidate);
  const lineage = object(request.lineage);
  const permission = object(lineage.permission);
  const permissionDenies = Array.isArray(permission.denies) ? permission.denies : [];
  const blockers: string[] = [];

  if (request.schema !== CURSOR_PROVIDER_REQUEST_CONTRACT) {
    blockers.push('request.schema-invalid');
  }
  if (string(request.prompt).includes('\0')) blockers.push('request.input-invalid');
  if (agent.installed !== true) blockers.push('headless.surface-not-installed');
  else if (binary.available !== true || !nonempty(binary.path)) {
    blockers.push('headless.binary-unavailable');
  }
  if (
    agent.surface_id !== CURSOR_AGENT_SURFACE ||
    !validEvidence(
      object(agent.installed_evidence),
      'installed',
      EVIDENCE_SOURCES.installed,
      asOf,
    ) ||
    !validEvidence(binary, 'binary', EVIDENCE_SOURCES.binary, asOf) ||
    !validEvidence(object(agent.auth), 'auth', EVIDENCE_SOURCES.auth, asOf)
  ) {
    blockers.push('headless.evidence-invalid');
  }
  if (
    !SUPPORTED_CURSOR_AGENT_NAMES.has(string(binary.name)) ||
    !SUPPORTED_CURSOR_AGENT_VERSIONS.has(string(binary.version)) ||
    !canonicalAbsolutePath(binary.path) ||
    !isSha256Digest(binary.runtime_sha256)
  ) {
    blockers.push('headless.binary-unsupported');
  }
  if (object(agent.auth).state !== 'authenticated') {
    blockers.push('headless.authentication-unavailable');
  }

  if (
    !validEvidence(payer, 'payer', EVIDENCE_SOURCES.payer, asOf) ||
    !nonempty(payer.payer_id) ||
    !isSha256Digest(payer.identity_fingerprint)
  ) {
    blockers.push('payer.provenance-invalid');
  }
  if (
    !validEvidence(catalog, 'catalog', EVIDENCE_SOURCES.catalog, asOf) ||
    !Array.isArray(catalog.selectors)
  ) {
    blockers.push('catalog.stale-or-invalid');
  }
  if (
    catalog.surface_id !== CURSOR_AGENT_SURFACE ||
    catalog.axis !== 'catalog' ||
    catalog.source !== EVIDENCE_SOURCES.catalog
  ) {
    blockers.push('catalog.provenance-invalid');
  }
  if (selector.toLowerCase() === 'auto') blockers.push('selector.auto-forbidden');
  else if (!exactFirstPartyCandidate(catalog, candidate, selector)) {
    blockers.push('selector.exact-match-required');
  }
  if (
    candidate.provider !== 'cursor' ||
    candidate.selector !== selector ||
    !canonicalIdentifier(candidate.candidate_id) ||
    !canonicalIdentifier(candidate.model) ||
    !canonicalIdentifier(candidate.effort)
  ) {
    blockers.push('candidate.binding-mismatch');
  }

  if (!validEvidence(quota, 'quota', EVIDENCE_SOURCES.quota, asOf)) {
    blockers.push('quota.provenance-invalid');
  }
  if (
    quota.pool !== 'first_party' ||
    quota.provenance !== 'first_party' ||
    !nonempty(quota.pool_ref) ||
    !canonicalIdentifier(quota.aggregation_key)
  ) {
    blockers.push('quota.first-party-pool-required');
  }
  const payerIds = [payer.payer_id, catalog.payer_id, quota.payer_id, reservation.payer_id];
  if (!allSameNonempty(payerIds)) {
    blockers.push('payer.binding-mismatch');
  }
  const authorityIds = [
    payer.authority_id,
    catalog.authority_id,
    quota.authority_id,
    reservation.authority_id,
  ];
  if (!allSameNonempty(authorityIds)) blockers.push('payer.authority-mismatch');
  if (
    catalog.pool !== 'first_party' ||
    !nonempty(catalog.pool_ref) ||
    catalog.pool_ref !== quota.pool_ref
  ) {
    blockers.push('catalog.binding-mismatch');
  }
  if (!nonempty(quota.source_revision) || !nonempty(reservation.source_revision)) {
    blockers.push('quota.revision-invalid');
  }
  if (!nonempty(reservation.id)) blockers.push('reservation.identity-invalid');
  if (!nonempty(runRef) || !nonempty(attemptId)) blockers.push('run.identity-invalid');
  if (
    lineage.account_fingerprint_ref !== payer.identity_fingerprint ||
    !canonicalIdentifier(lineage.workspace_ref) ||
    !canonicalIdentifier(lineage.worktree_ref) ||
    !/^[0-9a-f]{40}$/.test(string(lineage.baseline_commit))
  ) {
    blockers.push('lineage.binding-mismatch');
  }
  if (
    permission.profile !== 'workspace-write' ||
    !canonicalIdentifier(permission.snapshot_ref) ||
    !Array.isArray(permission.denies) ||
    permissionDenies.some((deny) => !canonicalIdentifier(deny)) ||
    new Set(permissionDenies).size !== permissionDenies.length ||
    !REQUIRED_PERMISSION_DENIES.every((deny) => permissionDenies.includes(deny))
  ) {
    blockers.push('permission.binding-mismatch');
  }

  if (sandbox.required !== true || sandbox.qualified !== true) {
    blockers.push('sandbox.unqualified');
  }
  if (
    reservation.run_ref !== runRef ||
    reservation.attempt_id !== attemptId ||
    reservation.pool !== 'first_party' ||
    reservation.pool_ref !== quota.pool_ref ||
    reservation.source_revision !== quota.source_revision ||
    !futureInstant(reservation.launch_by, asOf) ||
    !futureInstant(reservation.expires_at, asOf) ||
    !canonicalIdentifier(launch.idempotency_key) ||
    !canonicalIdentifier(launch.nonce)
  ) {
    blockers.push('reservation.binding-mismatch');
  }
  blockers.push(
    ...quotaAdmissionBlockers({ quota, payer, reservation, policy, checkedAt: request.as_of }),
  );

  return {
    schema: CURSOR_PROVIDER_DRIVER_CONTRACT,
    eligible: blockers.length === 0,
    blockers: registeredReasons(unique(blockers)),
    route_relation: routeRelation,
    run_ref: runRef,
    attempt_id: attemptId,
  };
}

export function compileCursorProviderInvocation(
  input: unknown,
  committedTicket: unknown,
): CursorProviderInvocation {
  const request = requestSnapshot(input);
  const decision = preflightCursorProvider(request);
  const ticket = parseQuotaAdmissionTicket(committedTicket);
  if (!decision.eligible) {
    throw new Error(`Cursor provider preflight rejected: ${decision.blockers.join(', ')}`);
  }
  const agent = object(object(request.surfaces)['cursor-agent-cli']);
  const executable = string(object(agent.binary).path);
  const actualIdentity = actualCanonicalLaunchIdentity(request);
  const extension = parseCursorProviderLaunchExtension(ticket?.provider_extension);
  const workspace = extension?.workspace_path ?? '';
  const selector = extension?.selector ?? '';
  const prompt = string(request.prompt);
  if (
    !ticket ||
    !executable ||
    !workspace ||
    !prompt ||
    extension?.executable_path !== executable ||
    canonicalJson(ticket.canonical_identity) !== canonicalJson(actualIdentity) ||
    canonicalJson(extension) !== canonicalJson(actualProviderExtension(request))
  ) {
    throw new Error('Cursor provider invocation requires binary, workspace, and prompt');
  }
  return {
    contract: CURSOR_PROVIDER_DRIVER_CONTRACT,
    run_ref: decision.run_ref,
    attempt_id: decision.attempt_id,
    selector,
    route_relation: decision.route_relation,
    ticket_digest: digestQuotaAdmissionTicket(ticket),
    runtime_sha256: ticket.runtime_sha256,
    launch_idempotency_key: ticket.launch_idempotency_key,
    launch_nonce: ticket.launch_nonce,
    executable,
    argv: [
      '--workspace',
      workspace,
      '--print',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
      '--trust',
      '--sandbox',
      'enabled',
      '--mode',
      'ask',
      '--model',
      selector,
      prompt,
    ],
    cwd: workspace,
    env: {
      NO_COLOR: '1',
      PATH: process.env.PATH || '/usr/bin:/bin',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  };
}

export async function invokeCursorProvider(
  input: unknown,
  options: CursorProviderInvokeOptions,
): Promise<CursorProviderRunResult> {
  const request = requestSnapshot(input);
  const preflight = preflightCursorProvider(request);
  const selector = string(request.selector) || null;
  if (!preflight.eligible) {
    return runResult(preflight, 'rejected', selector, null, null, 'unknown', preflight.blockers, {
      exit_code: null,
      signal: null,
      reaped: false,
    });
  }
  const rawOptions = object(options);
  const rawRuntime = object(rawOptions.runtime);
  if (rawRuntime.schema !== 'ccm/provider-runtime-capabilities/v1') {
    return runResult(
      preflight,
      'rejected',
      selector,
      null,
      null,
      'unknown',
      ['runtime.unsupported'],
      { exit_code: null, signal: null, reaped: false },
    );
  }
  if (!validInvokeOptions(options)) {
    return runResult(
      preflight,
      'rejected',
      selector,
      null,
      null,
      'unknown',
      ['invoke.options-invalid'],
      { exit_code: null, signal: null, reaped: false },
    );
  }

  let deadline: ProviderRequestDeadline;
  try {
    deadline = createProviderRequestDeadline(options.hardTimeoutMs);
  } catch {
    return runResult(
      preflight,
      'rejected',
      selector,
      null,
      null,
      'unknown',
      ['invoke.options-invalid'],
      { exit_code: null, signal: null, reaped: false },
    );
  }

  let ownerDecision: JsonRecord;
  try {
    ownerDecision = object(
      await options.owner.preflight({
        source_key: object(request.owner).source_key,
        reservation_id: object(request.owner).reservation_id,
        checked_at: request.as_of,
      }),
    );
  } catch {
    ownerDecision = {};
  }
  const ownerReceipt = parseQuotaOwnerPreflightReceipt(ownerDecision.owner_receipt);
  const committedTicket = parseQuotaAdmissionTicket(ownerDecision.committed_ticket);
  if (
    ownerDecision.decision !== 'launch-claim-allowed' ||
    ownerDecision.automatic_spawn_limit !== 1 ||
    !ownerReceipt
  ) {
    return runResult(
      preflight,
      'rejected',
      selector,
      null,
      null,
      'unknown',
      ['owner.receipt-invalid'],
      { exit_code: null, signal: null, reaped: false },
    );
  }
  if (
    !committedTicket ||
    digestQuotaAdmissionTicket(committedTicket) !== ownerReceipt.ticket_digest
  ) {
    return runResult(
      preflight,
      'rejected',
      selector,
      null,
      null,
      'unknown',
      ['owner.ticket-invalid'],
      { exit_code: null, signal: null, reaped: false },
    );
  }
  if (
    !validateQuotaOwnerPreflightReceiptBinding(ownerReceipt, ownerReceiptBindingContext(request))
  ) {
    return runResult(
      preflight,
      'rejected',
      selector,
      null,
      null,
      'unknown',
      ['owner.binding-mismatch'],
      { exit_code: null, signal: null, reaped: false },
    );
  }
  let launchBindingContext: QuotaAdmissionTicketProviderLaunchBindingContext;
  try {
    launchBindingContext = providerLaunchBindingContext(request, ownerReceipt);
  } catch {
    return runResult(
      preflight,
      'rejected',
      selector,
      null,
      null,
      'unknown',
      ['owner.ticket-binding-mismatch'],
      { exit_code: null, signal: null, reaped: false },
    );
  }
  if (!validateQuotaAdmissionTicketProviderLaunchBinding(committedTicket, launchBindingContext)) {
    return runResult(
      preflight,
      'rejected',
      selector,
      null,
      null,
      'unknown',
      ['owner.ticket-binding-mismatch'],
      { exit_code: null, signal: null, reaped: false },
    );
  }

  let invocation: CursorProviderInvocation;
  try {
    invocation = compileCursorProviderInvocation(request, committedTicket);
  } catch {
    return runResult(preflight, 'rejected', selector, null, null, 'unknown', ['request.invalid'], {
      exit_code: null,
      signal: null,
      reaped: false,
    });
  }
  let resolvedExecutable: string | null;
  try {
    resolvedExecutable = options.runtime.process.resolveExecutable('cursor-agent');
  } catch {
    resolvedExecutable = null;
  }
  if (resolvedExecutable !== invocation.executable) {
    return runResult(
      preflight,
      'rejected',
      selector,
      null,
      null,
      'unknown',
      ['headless.binary-resolution-mismatch'],
      { exit_code: null, signal: null, reaped: false },
    );
  }

  const limits = {
    startupTimeoutMs: Math.min(options.hardTimeoutMs, 1_000),
    idleTimeoutMs: Math.min(options.hardTimeoutMs, 1_000),
    stdoutLimitBytes: 1_048_576,
    stderrLimitBytes: 65_536,
    terminationGraceMs: 100,
    reapTimeoutMs: 1_000,
  };
  let owned: ProviderOwnedChild;
  try {
    owned = options.runtime.process.spawnProvider(invocation);
  } catch {
    return runResult(
      preflight,
      'failed',
      selector,
      null,
      null,
      'unknown',
      ['transport.spawn-failed'],
      { exit_code: null, signal: null, reaped: false },
    );
  }

  let supervisedPromise: Promise<ProviderChildResult>;
  try {
    supervisedPromise = superviseProviderChild(owned, {
      operation: `cursor-agent:${preflight.run_ref}`,
      deadline,
      limits,
      signal: options.signal,
    });
  } catch {
    const termination = await terminateAndReapProviderChild(owned, limits);
    return runResult(
      preflight,
      'failed',
      selector,
      null,
      null,
      'unknown',
      ['transport.supervisor-handoff-failed'],
      {
        exit_code: termination.exitCode,
        signal: termination.signal,
        reaped: termination.reaped,
      },
    );
  }

  try {
    const supervised = await supervisedPromise;
    const parsed = parseCursorStream(supervised.stdout, {
      permissionMode: 'ask',
      sandboxMode: 'enabled',
    });
    const shapeValid = parsed.valid && parsed.terminal !== null;
    const accepted =
      shapeValid &&
      supervised.exitCode === 0 &&
      parsed.terminal?.subtype === 'success' &&
      parsed.terminal.is_error === false;
    const exactResolution = parsed.init?.model === selector;
    const workspaceExact = parsed.init?.cwd === string(request.workspace);
    const admission = evaluateCursorAgentAdmission({
      request: { mode: 'ask', sandbox: 'required' },
      binary: {
        name: 'cursor-agent',
        path: invocation.executable,
        available: true,
      },
      authentication: { state: 'available', source: 'cursor-provider-preflight' },
      quota: { state: 'available', source: 'cursor-provider-preflight' },
      sandbox: 'supported',
      result_schema: shapeValid ? 'valid' : 'invalid-shape',
      task_acceptance: accepted ? 'accepted' : 'rejected',
      transport: {
        terminated: true,
        exit_code: supervised.exitCode,
        signal: supervised.signal,
      },
    });
    const blockers = [...admission.blockers, ...parsed.blockers];
    if (!exactResolution) blockers.push('selector.resolved-mismatch');
    if (!workspaceExact) blockers.push('workspace.resolved-mismatch');
    return runResult(
      preflight,
      blockers.length === 0 ? 'succeeded' : 'failed',
      selector,
      parsed.init?.model ?? null,
      parsed.terminal?.session_id ?? parsed.init?.session_id ?? null,
      accepted ? 'accepted' : 'rejected',
      unique(blockers),
      {
        exit_code: supervised.exitCode,
        signal: supervised.signal,
        reaped: supervised.reaped,
      },
    );
  } catch (error) {
    if (error instanceof ProviderChildSupervisorError) {
      const state: CursorProviderRunState =
        error.code === 'cancelled'
          ? 'cancelled'
          : error.code.endsWith('_timeout')
            ? 'timed_out'
            : 'failed';
      return runResult(
        preflight,
        state,
        selector,
        null,
        null,
        'unknown',
        [`transport.${error.code}`],
        {
          exit_code: error.termination?.exitCode ?? null,
          signal: error.termination?.signal ?? null,
          reaped: error.termination?.reaped ?? false,
        },
      );
    }
    const termination = await terminateAndReapProviderChild(owned, limits);
    return runResult(
      preflight,
      'failed',
      selector,
      null,
      null,
      'unknown',
      ['transport.supervisor-handoff-failed'],
      {
        exit_code: termination.exitCode,
        signal: termination.signal,
        reaped: termination.reaped,
      },
    );
  }
}

export function reconcileCursorProviderRun(
  result: CursorProviderRunResult,
): CursorProviderRunReconciliation {
  const attemptState =
    result.state === 'rejected'
      ? 'not-started'
      : result.state === 'succeeded'
        ? 'succeeded'
        : result.state;
  return {
    schema: 'ccm/cursor-provider-run-reconciliation/v1',
    run_ref: result.run_ref,
    attempt_id: result.attempt_id,
    attempt_state: attemptState,
    task_status: 'uncertain',
    task_done: false,
    terminal: result.state !== 'rejected',
  };
}

function runResult(
  preflight: CursorProviderPreflight,
  state: CursorProviderRunState,
  requestedSelector: string | null,
  resolvedSelector: string | null,
  sessionId: string | null,
  providerAcceptance: CursorProviderRunResult['provider_acceptance'],
  blockers: string[],
  transport: CursorProviderRunResult['transport'],
): CursorProviderRunResult {
  return {
    schema: 'ccm/cursor-provider-run-result/v1',
    run_ref: preflight.run_ref,
    attempt_id: preflight.attempt_id,
    state,
    route_relation: preflight.route_relation,
    requested_selector: requestedSelector,
    resolved_selector: resolvedSelector,
    session_id: sessionId,
    provider_acceptance: providerAcceptance,
    task_acceptance: 'uncertain',
    blockers: registeredReasons(blockers),
    transport,
  };
}

export function parseCursorStream(
  stdout: string,
  expected: { permissionMode: 'ask'; sandboxMode: 'enabled' },
): {
  valid: boolean;
  blockers: string[];
  init: {
    model: string;
    cwd: string;
    session_id: string;
    permissionMode: string;
    sandboxMode: string | null;
  } | null;
  terminal: { subtype: string; is_error: boolean; result: string; session_id: string } | null;
} {
  let valid = true;
  const blockers: string[] = [];
  let init: {
    model: string;
    cwd: string;
    session_id: string;
    permissionMode: string;
    sandboxMode: string | null;
  } | null = null;
  let terminal: { subtype: string; is_error: boolean; result: string; session_id: string } | null =
    null;
  let initCount = 0;
  let terminalCount = 0;
  let phase: 'before-init' | 'active' | 'terminal' = 'before-init';
  for (const line of stdout.split('\n').filter((entry) => entry.trim().length > 0)) {
    let event: JsonRecord;
    try {
      event = object(JSON.parse(line));
    } catch {
      valid = false;
      blockers.push('stream.invalid-json');
      continue;
    }
    const isInit = event.type === 'system' && event.subtype === 'init';
    const isTerminal = event.type === 'result';
    if (phase === 'terminal') blockers.push('stream.post-terminal-evidence');
    if (isInit) {
      initCount += 1;
      if (initCount > 1) blockers.push('stream.init-duplicate');
      if (phase === 'terminal') blockers.push('stream.post-terminal-evidence');
      if (!canonicalIdentifier(event.session_id)) blockers.push('session.identity-invalid');
      if (
        !nonempty(event.model) ||
        !nonempty(event.cwd) ||
        !nonempty(event.session_id) ||
        !nonempty(event.permissionMode)
      ) {
        valid = false;
      } else if (init === null) {
        init = {
          model: string(event.model),
          cwd: string(event.cwd),
          session_id: string(event.session_id),
          permissionMode: string(event.permissionMode),
          sandboxMode: 'sandboxMode' in event ? string(event.sandboxMode) : null,
        };
      }
      if (phase !== 'terminal') phase = 'active';
    }
    if (isTerminal) {
      terminalCount += 1;
      if (terminalCount > 1) blockers.push('stream.terminal-duplicate');
      if (phase === 'before-init') blockers.push('stream.terminal-before-init');
      if (!canonicalIdentifier(event.session_id)) blockers.push('session.identity-invalid');
      if (
        !nonempty(event.subtype) ||
        typeof event.is_error !== 'boolean' ||
        !nonempty(event.result) ||
        !nonempty(event.session_id)
      ) {
        valid = false;
      } else if (terminal === null) {
        terminal = {
          subtype: string(event.subtype),
          is_error: event.is_error,
          result: string(event.result),
          session_id: string(event.session_id),
        };
      }
      phase = 'terminal';
    }
  }
  if (!init) {
    valid = false;
    blockers.push('stream.init-missing');
  }
  if (!terminal) {
    valid = false;
    blockers.push('stream.terminal-missing');
  }
  if (init && init.permissionMode !== expected.permissionMode) {
    blockers.push('permission.resolved-mismatch');
  }
  if (init) {
    if (!canonicalIdentifier(init.session_id)) blockers.push('session.identity-invalid');
    if (init.sandboxMode === null || !nonempty(init.sandboxMode)) {
      blockers.push('sandbox.resolved-missing');
    } else if (init.sandboxMode !== expected.sandboxMode) {
      blockers.push('sandbox.resolved-mismatch');
    }
  }
  if (terminal && !canonicalIdentifier(terminal.session_id)) {
    blockers.push('session.identity-invalid');
  }
  if (init && terminal) {
    if (init.session_id !== terminal.session_id) blockers.push('session.identity-mismatch');
  }
  valid = valid && blockers.length === 0;
  return { valid, blockers: unique(blockers), init, terminal };
}

function validCursorProviderRequest(input: unknown): boolean {
  const request = object(input);
  if (
    !exactKeys(request, REQUEST_FIELDS.$) ||
    !(typeof request.schema === 'string' || request.schema === null) ||
    typeof request.as_of !== 'string' ||
    !CONTRACT_ENUMS.origin_harness.includes(string(request.origin_harness)) ||
    !canonicalIdentifier(request.origin_session_ref) ||
    !canonicalIdentifier(request.run_ref) ||
    !canonicalIdentifier(request.attempt_id) ||
    !canonicalAbsolutePath(request.workspace) ||
    !nonempty(request.prompt) ||
    !canonicalPlatformString(request.selector)
  ) {
    return false;
  }

  const owner = object(request.owner);
  const candidate = object(request.candidate);
  const lineage = object(request.lineage);
  const permission = object(lineage.permission);
  if (
    !exactKeys(candidate, REQUEST_FIELDS.candidate) ||
    !stringFields(candidate, Object.keys(candidate)) ||
    !exactKeys(lineage, REQUEST_FIELDS.lineage) ||
    !stringFields(
      lineage,
      Object.keys(lineage).filter((field) => field !== 'permission'),
    ) ||
    !exactKeys(permission, REQUEST_FIELDS['lineage.permission']) ||
    !stringFields(permission, ['snapshot_ref', 'profile']) ||
    !Array.isArray(permission.denies) ||
    permission.denies.some((entry) => typeof entry !== 'string') ||
    !exactKeys(owner, REQUEST_FIELDS.owner) ||
    owner.schema !== 'ccm/quota-owner-preflight-request/v1' ||
    !canonicalIdentifier(owner.source_key) ||
    !canonicalIdentifier(owner.reservation_id)
  ) {
    return false;
  }

  const surfaces = object(request.surfaces);
  const ide = object(surfaces['cursor-ide-plugin']);
  const ideAuth = object(ide.auth);
  const agent = object(surfaces['cursor-agent-cli']);
  const installedEvidence = object(agent.installed_evidence);
  const binary = object(agent.binary);
  const auth = object(agent.auth);
  if (
    !exactKeys(surfaces, REQUEST_FIELDS.surfaces) ||
    !exactKeys(ide, REQUEST_FIELDS['surfaces.cursor-ide-plugin']) ||
    typeof ide.installed !== 'boolean' ||
    !exactKeys(ideAuth, REQUEST_FIELDS['surfaces.cursor-ide-plugin.auth']) ||
    !authState(ideAuth.state) ||
    !exactKeys(agent, REQUEST_FIELDS['surfaces.cursor-agent-cli']) ||
    typeof agent.surface_id !== 'string' ||
    typeof agent.installed !== 'boolean' ||
    !exactKeys(installedEvidence, REQUEST_FIELDS['surfaces.cursor-agent-cli.installed_evidence']) ||
    !evidenceShape(installedEvidence) ||
    !exactKeys(binary, REQUEST_FIELDS['surfaces.cursor-agent-cli.binary']) ||
    typeof binary.available !== 'boolean' ||
    typeof binary.name !== 'string' ||
    !(binary.path === null || platformSafeString(binary.path)) ||
    typeof binary.version !== 'string' ||
    typeof binary.runtime_sha256 !== 'string' ||
    !evidenceShape(binary) ||
    !exactKeys(auth, REQUEST_FIELDS['surfaces.cursor-agent-cli.auth']) ||
    !authState(auth.state) ||
    !evidenceShape(auth)
  ) {
    return false;
  }

  const payer = object(request.payer);
  const catalog = object(request.catalog);
  const quota = object(request.quota);
  const reservation = object(request.reservation);
  const launch = object(request.launch);
  const sandbox = object(request.sandbox);
  const policy = object(request.policy);
  if (
    !exactKeys(payer, REQUEST_FIELDS.payer) ||
    !stringFields(payer, Object.keys(payer)) ||
    !exactKeys(catalog, REQUEST_FIELDS.catalog) ||
    !stringFields(
      catalog,
      Object.keys(catalog).filter((field) => field !== 'selectors'),
    ) ||
    !Array.isArray(catalog.selectors) ||
    !catalog.selectors.every(selectorShape) ||
    !exactKeys(quota, REQUEST_FIELDS.quota) ||
    !CONTRACT_ENUMS.quota_state.includes(string(quota.state)) ||
    !stringOrNullFields(
      quota,
      Object.keys(quota).filter((field) => field !== 'state'),
    ) ||
    !exactKeys(reservation, REQUEST_FIELDS.reservation) ||
    !CONTRACT_ENUMS.reservation_state.includes(string(reservation.state)) ||
    !stringOrNullFields(
      reservation,
      Object.keys(reservation).filter((field) => field !== 'state'),
    ) ||
    !exactKeys(launch, REQUEST_FIELDS.launch) ||
    !stringFields(launch, Object.keys(launch)) ||
    !exactKeys(sandbox, REQUEST_FIELDS.sandbox) ||
    typeof sandbox.required !== 'boolean' ||
    typeof sandbox.qualified !== 'boolean' ||
    !exactKeys(policy, REQUEST_FIELDS.policy) ||
    !CONTRACT_ENUMS.policy_decision.includes(string(policy.decision)) ||
    !CONTRACT_ENUMS.policy_mode.includes(string(policy.mode)) ||
    !CONTRACT_ENUMS.forbidden_effect.includes(string(policy.automatic_api_fallback)) ||
    !CONTRACT_ENUMS.forbidden_effect.includes(string(policy.account_mutation)) ||
    !CONTRACT_ENUMS.forbidden_effect.includes(string(policy.credential_write))
  ) {
    return false;
  }
  return true;
}

function validInvokeOptions(value: unknown): value is CursorProviderInvokeOptions {
  const options = object(value);
  const runtime = object(options.runtime);
  const processPort = object(runtime.process);
  const network = object(runtime.network);
  const owner = object(options.owner);
  return (
    exactKeys(options, ['runtime', 'owner', 'hardTimeoutMs', 'signal'], true) &&
    exactKeys(runtime, ['schema', 'process', 'network']) &&
    runtime.schema === 'ccm/provider-runtime-capabilities/v1' &&
    exactKeys(processPort, ['resolveExecutable', 'spawnProvider']) &&
    typeof processPort.resolveExecutable === 'function' &&
    typeof processPort.spawnProvider === 'function' &&
    exactKeys(network, ['request']) &&
    typeof network.request === 'function' &&
    exactKeys(owner, ['preflight']) &&
    typeof owner.preflight === 'function' &&
    typeof options.hardTimeoutMs === 'number' &&
    Number.isFinite(options.hardTimeoutMs) &&
    options.hardTimeoutMs > 0 &&
    (!('signal' in options) ||
      options.signal === undefined ||
      options.signal instanceof AbortSignal)
  );
}

function ownerReceiptBindingContext(request: JsonRecord): QuotaOwnerPreflightReceiptBindingContext {
  const owner = object(request.owner);
  const payer = object(request.payer);
  const quota = object(request.quota);
  const reservation = object(request.reservation);
  return {
    reservation_id: owner.reservation_id === reservation.id ? string(reservation.id) : '',
    reservation_request_hash: string(reservation.request_hash),
    ticket_digest: string(reservation.ticket_digest),
    attempt_id: request.attempt_id === reservation.attempt_id ? string(request.attempt_id) : '',
    run_ref: request.run_ref === reservation.run_ref ? string(request.run_ref) : '',
    account_id:
      payer.payer_id === quota.payer_id && payer.payer_id === reservation.payer_id
        ? string(payer.payer_id)
        : '',
    pool_id: quota.pool_ref === reservation.pool_ref ? string(quota.pool_ref) : '',
    source_revision:
      quota.source_revision === reservation.source_revision ? string(quota.source_revision) : '',
    authority_digest: string(reservation.authority_digest),
  };
}

function providerLaunchBindingContext(
  request: JsonRecord,
  receipt: NonNullable<ReturnType<typeof parseQuotaOwnerPreflightReceipt>>,
): QuotaAdmissionTicketProviderLaunchBindingContext {
  const agent = object(object(request.surfaces)['cursor-agent-cli']);
  const binary = object(agent.binary);
  const payer = object(request.payer);
  const quota = object(request.quota);
  const reservation = object(request.reservation);
  const launch = object(request.launch);
  return {
    ticket_digest: receipt.ticket_digest,
    reservation_id: string(reservation.id),
    reservation_request_hash: string(reservation.request_hash),
    reservation_expires_at: string(reservation.expires_at),
    attempt_id: string(request.attempt_id),
    run_ref: string(request.run_ref),
    account_id: string(payer.payer_id),
    pool_id: string(quota.pool_ref),
    identity_fingerprint: string(payer.identity_fingerprint),
    aggregation_key: string(quota.aggregation_key),
    live_source_revision: string(quota.source_revision),
    runtime_sha256: string(binary.runtime_sha256),
    launch_idempotency_key: string(launch.idempotency_key),
    launch_nonce: string(launch.nonce),
    checked_at: receipt.checked_at,
    canonical_identity: actualCanonicalLaunchIdentity(request),
    provider_extension: actualProviderExtension(request),
  };
}

function actualProviderExtension(request: JsonRecord): Readonly<CursorProviderLaunchExtension> {
  const candidate = object(request.candidate);
  const agent = object(object(request.surfaces)['cursor-agent-cli']);
  const binary = object(agent.binary);
  const extension = parseCursorProviderLaunchExtension({
    schema: CURSOR_PROVIDER_LAUNCH_EXTENSION_SCHEMA,
    selector: candidate.selector,
    workspace_path: request.workspace,
    executable_path: binary.path,
  });
  if (!extension) throw new TypeError('Cursor provider launch extension is invalid');
  return extension;
}

function actualCanonicalLaunchIdentity(request: JsonRecord): Readonly<CanonicalLaunchIdentity> {
  const candidate = object(request.candidate);
  const lineage = object(request.lineage);
  const permission = object(lineage.permission);
  const payer = object(request.payer);
  const quota = object(request.quota);
  const agent = object(object(request.surfaces)['cursor-agent-cli']);
  const binary = object(agent.binary);
  const launch = object(request.launch);
  const extension = actualProviderExtension(request);
  return normalizeCanonicalLaunchIdentity({
    schema: CANONICAL_LAUNCH_IDENTITY_SCHEMA,
    origin: {
      harness: request.origin_harness,
      session_ref: request.origin_session_ref,
    },
    target: {
      ...CURSOR_AGENT_LAUNCH_DESCRIPTOR,
      candidate_id: candidate.candidate_id,
    },
    provider: {
      id: candidate.provider,
      model: candidate.model,
      effort: candidate.effort,
    },
    account: {
      fingerprint_ref: lineage.account_fingerprint_ref,
      account_id: payer.payer_id,
      pool_id: quota.pool_ref,
      identity_fingerprint: payer.identity_fingerprint,
    },
    workspace: {
      workspace_ref: lineage.workspace_ref,
      worktree_ref: lineage.worktree_ref,
      baseline_commit: lineage.baseline_commit,
    },
    permission,
    input: { digest: sha256Digest(string(request.prompt)) },
    request: {
      digest: digestCursorProviderLaunchRequest(extension, {
        attempt_id: request.attempt_id,
        run_ref: request.run_ref,
        launch_idempotency_key: launch.idempotency_key,
        launch_nonce: launch.nonce,
      }),
    },
    dispatch: {
      run_ref: request.run_ref,
      idempotency_key: launch.idempotency_key,
      launch_nonce: launch.nonce,
      claim_id: launch.nonce,
    },
    runtime: {
      image_sha256: binary.runtime_sha256,
      selector: { kind: 'exact', model_id: candidate.model, effort: candidate.effort },
    },
  });
}

function evidenceShape(value: JsonRecord): boolean {
  return stringFields(value, ['surface_id', 'axis', 'source', 'observed_at', 'valid_until']);
}

function selectorShape(value: unknown): boolean {
  const selector = object(value);
  return (
    exactKeys(selector, REQUEST_FIELDS['catalog.selectors[]']) &&
    stringFields(selector, Object.keys(selector)) &&
    canonicalIdentifier(selector.selector)
  );
}

function authState(value: unknown): boolean {
  return CONTRACT_ENUMS.auth_state.includes(string(value));
}

function stringFields(value: JsonRecord, fields: string[]): boolean {
  return fields.every((field) => typeof value[field] === 'string');
}

function stringOrNullFields(value: JsonRecord, fields: string[]): boolean {
  return fields.every((field) => typeof value[field] === 'string' || value[field] === null);
}

function exactKeys(value: JsonRecord, fields: readonly string[], optionalLast = false): boolean {
  const expected = new Set(fields);
  const keys = Object.keys(value);
  const requiredCount = optionalLast ? fields.length - 1 : fields.length;
  return (
    keys.length >= requiredCount &&
    keys.length <= fields.length &&
    keys.every((field) => expected.has(field)) &&
    fields.slice(0, requiredCount).every((field) => field in value)
  );
}

function canonicalAbsolutePath(value: unknown): value is string {
  return canonicalPlatformString(value) && isAbsolute(value);
}

function exactFirstPartyCandidate(
  catalog: JsonRecord,
  candidate: JsonRecord,
  selector: string,
): boolean {
  if (!selector || !Array.isArray(catalog.selectors)) return false;
  return catalog.selectors.some((entry) => {
    const row = object(entry);
    return (
      row.selector === selector &&
      row.candidate_id === candidate.candidate_id &&
      row.provider === candidate.provider &&
      row.model === candidate.model &&
      row.effort === candidate.effort &&
      row.pool === 'first_party' &&
      nonempty(row.authority_id) &&
      row.authority_id === catalog.authority_id &&
      nonempty(row.payer_id) &&
      row.payer_id === catalog.payer_id &&
      nonempty(row.pool_ref) &&
      row.pool_ref === catalog.pool_ref
    );
  });
}

function quotaAdmissionBlockers(input: {
  quota: JsonRecord;
  payer: JsonRecord;
  reservation: JsonRecord;
  policy: JsonRecord;
  checkedAt: unknown;
}): string[] {
  const policyEffectsAllowed =
    input.policy.mode === 'ask' &&
    input.policy.automatic_api_fallback === 'forbidden' &&
    input.policy.account_mutation === 'forbidden' &&
    input.policy.credential_write === 'forbidden';
  const decision = object(
    evaluateLiveQuotaAdmission({
      checked_at: input.checkedAt,
      preflight: {
        identity: input.payer.payer_id,
        aggregation_key: input.quota.pool_ref,
      },
      live: {
        state: input.quota.state,
        freshness: freshFact(input.quota, instant(input.checkedAt)) ? 'fresh' : 'hard-stale',
        identity: input.quota.payer_id,
        aggregation_key: input.quota.pool_ref,
      },
      policy: { decision: input.policy.decision },
      effects: { decision: policyEffectsAllowed ? 'allow' : 'deny' },
      reservation: { id: input.reservation.id, state: input.reservation.state },
      ticket: { launch_by: input.reservation.launch_by },
    }),
  );
  if (decision.decision === 'launch-claim-allowed' && decision.automatic_spawn_limit === 1) {
    return [];
  }
  const reasons = Array.isArray(decision.blocking_reasons)
    ? decision.blocking_reasons.map(String)
    : [];
  if (
    reasons.some((reason) => reason.startsWith('QUOTA_POLICY') || reason.startsWith('QUOTA_EFFECT'))
  ) {
    return ['policy.denied'];
  }
  if (reasons.some((reason) => reason.startsWith('ADMISSION_'))) {
    return ['reservation.binding-mismatch'];
  }
  if (input.quota.state !== 'ample') return [`quota.${string(input.quota.state) || 'unknown'}`];
  return ['quota.stale-or-invalid'];
}

function freshFact(value: JsonRecord, asOf: number | null): boolean {
  if (!nonempty(value.source) || asOf === null) return false;
  const observedAt = instant(value.observed_at);
  const validUntil = instant(value.valid_until);
  return observedAt !== null && validUntil !== null && observedAt <= asOf && asOf < validUntil;
}

function validEvidence(
  value: JsonRecord,
  axis: keyof typeof EVIDENCE_SOURCES,
  source: string,
  asOf: number | null,
): boolean {
  return (
    value.surface_id === CURSOR_AGENT_SURFACE &&
    value.axis === axis &&
    value.source === source &&
    freshFact(value, asOf)
  );
}

function allSameNonempty(values: unknown[]): boolean {
  return values.every(nonempty) && new Set(values).size === 1;
}

function futureInstant(value: unknown, asOf: number | null): boolean {
  const instantValue = instant(value);
  return asOf !== null && instantValue !== null && instantValue > asOf;
}

function instant(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
    ? timestamp
    : null;
}

function object(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function requestSnapshot(value: unknown): JsonRecord {
  try {
    return object(structuredClone(value));
  } catch {
    return {};
  }
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function canonicalIdentifier(value: unknown): value is string {
  return nonempty(value) && value.trim() === value;
}

function platformSafeString(value: unknown): value is string {
  return typeof value === 'string' && !value.includes('\0');
}

function canonicalPlatformString(value: unknown): value is string {
  return canonicalIdentifier(value) && platformSafeString(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function registeredReasons(values: string[]): string[] {
  for (const value of values) {
    if (
      !REGISTERED_REASONS.has(value) &&
      !value.startsWith('transport.exit-') &&
      !value.startsWith('transport.signal-')
    ) {
      throw new Error(`unregistered Cursor provider failure reason: ${value}`);
    }
  }
  return values;
}
