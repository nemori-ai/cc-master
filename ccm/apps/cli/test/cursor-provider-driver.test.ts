import assert from 'node:assert/strict';
import { type ChildProcess, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import {
  CANONICAL_LAUNCH_IDENTITY_FIELD_REGISTRY,
  CANONICAL_LAUNCH_IDENTITY_SCHEMA,
  type CanonicalLaunchIdentity,
  canonicalJson,
  canonicalLaunchIdentityDigest,
  NATIVE_ATTEMPT_CONTRACT,
  NATIVE_ATTEMPT_DESCRIPTOR_REGISTRY,
  nativeAttemptApply,
  normalizeCanonicalLaunchIdentity,
  sha256Digest,
} from '@ccm/engine';
import * as cursorProviderContract from '../src/cursor-provider-driver.js';
import {
  compileCursorProviderInvocation,
  invokeCursorProvider,
  preflightCursorProvider,
  reconcileCursorProviderRun,
} from '../src/cursor-provider-driver.js';
import {
  CURSOR_PROVIDER_LAUNCH_EXTENSION_SCHEMA,
  type CursorProviderLaunchExtension,
  digestCursorProviderLaunchRequest,
  parseCursorProviderLaunchExtension,
} from '../src/cursor-provider-launch-extension.js';
import {
  PROVIDER_PROCESS_TREE_SCHEMA,
  PROVIDER_RUNTIME_SCHEMA,
  type ProviderOwnedChild,
  type ProviderRuntime,
  type ProviderSpawnSpec,
} from '../src/provider-runtime.js';
import {
  canonicalQuotaAdmissionTicketJson,
  digestQuotaAdmissionTicket,
  parseQuotaAdmissionTicket,
  QUOTA_ADMISSION_TICKET_PROVIDER_LAUNCH_BINDING_IDS,
  type QuotaAdmissionTicketProviderLaunchBindingContext,
  validateQuotaAdmissionTicketProviderLaunchBinding,
} from '../src/quota-admission-ticket.js';
import type { QuotaOwnerPreflightReceiptBindingContext } from '../src/quota-owner-receipt.js';
import * as quotaOwnerContract from '../src/quota-owner-receipt.js';

interface Catalog {
  schema: string;
  contract: string;
  registries: Record<string, unknown>;
  owner_receipt: Record<string, unknown>;
  committed_ticket: Record<string, unknown>;
  defaults: Record<string, unknown>;
  cases: Array<{
    id: string;
    title: string;
    overrides: Record<string, unknown>;
    owner_receipt_overrides?: Record<string, unknown>;
    expected: {
      eligible: boolean;
      preflight_eligible?: boolean;
      axis?: string;
      blocker?: string;
      route_relation?: string;
      review_counterexample?: boolean;
    };
  }>;
  invoke_cases: Array<{
    id: string;
    title: string;
    axis: string;
    hard_timeout_ms?: number | 'NaN';
    options_overrides?: {
      runtime_schema?: string;
      invalid_signal?: boolean;
      unexpected?: boolean;
      malformed_child_event_surface?: boolean;
    };
    expected: { state: 'rejected' | 'failed'; blocker: string };
  }>;
  stream_cases: Array<{
    id: string;
    title: string;
    axis: string;
    stream: {
      init_overrides?: Record<string, unknown>;
      terminal_overrides?: Record<string, unknown>;
      duplicate_init?: boolean;
      duplicate_terminal?: boolean;
      omit_init_fields?: string[];
      terminal_before_init?: boolean;
      between_terminal_and_init?: boolean;
      post_terminal_event?: boolean;
    };
    expected: { state: 'failed'; blocker: string };
  }>;
}

const fixtureRoot = new URL('./fixtures/cursor-provider-driver-v2/', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('scenarios.json', fixtureRoot), 'utf8')) as Catalog;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function merge(base: unknown, override: unknown): unknown {
  if (!record(base) || !record(override)) return structuredClone(override);
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    result[key] = record(value) && record(result[key]) ? merge(result[key], value) : value;
  }
  return result;
}

function runtime(
  resolutions: string[],
  spawns: ProviderSpawnSpec[],
  stream: Catalog['stream_cases'][number]['stream'] = {},
  effects?: string[],
  resolvedExecutable = '/fixture/bin/cursor-agent',
): ProviderRuntime {
  return {
    schema: PROVIDER_RUNTIME_SCHEMA,
    process: {
      resolveExecutable(provider) {
        effects?.push('executable.resolve');
        resolutions.push(provider);
        return resolvedExecutable;
      },
      spawnProvider(spec) {
        effects?.push('process.spawn');
        spawns.push(structuredClone(spec));
        return fakeOwnedChild(spec, stream);
      },
    },
    network: {
      request: (operation) => {
        effects?.push('network.request');
        throw new Error(`network denied: ${operation}`);
      },
    },
  };
}

function owner(
  receiptOverrides: Record<string, unknown> = {},
  effects?: string[],
  ticketOverrides: Record<string, unknown> = {},
) {
  return {
    async preflight() {
      effects?.push('owner.preflight');
      return {
        decision: 'launch-claim-allowed',
        automatic_spawn_limit: 1,
        owner_receipt: merge(catalog.owner_receipt, receiptOverrides),
        committed_ticket: merge(catalog.committed_ticket, ticketOverrides),
      };
    },
  };
}

function authorizeRequest(requestValue: unknown): {
  request: Record<string, unknown>;
  owner: ReturnType<typeof owner>;
  ticket: Record<string, unknown>;
  receipt: Record<string, unknown>;
} {
  const rawRequest = structuredClone(requestValue) as Record<string, unknown>;
  const ticket = {
    ...structuredClone(catalog.committed_ticket),
    ...launchAuthorityForRequest(rawRequest),
  };
  const parsed = parseQuotaAdmissionTicket(ticket);
  assert.ok(parsed);
  const ticketDigest = digestQuotaAdmissionTicket(parsed);
  const request = merge(rawRequest, { reservation: { ticket_digest: ticketDigest } }) as Record<
    string,
    unknown
  >;
  const receipt = merge(catalog.owner_receipt, { ticket_digest: ticketDigest }) as Record<
    string,
    unknown
  >;
  return {
    request,
    ticket,
    receipt,
    owner: {
      async preflight() {
        return {
          decision: 'launch-claim-allowed',
          automatic_spawn_limit: 1,
          owner_receipt: receipt,
          committed_ticket: ticket,
        };
      },
    },
  };
}

function ownerForAuthority(
  authority: { ticket: Record<string, unknown>; receipt: Record<string, unknown> },
  effects?: string[],
) {
  return {
    async preflight() {
      effects?.push('owner.preflight');
      return {
        decision: 'launch-claim-allowed',
        automatic_spawn_limit: 1,
        owner_receipt: authority.receipt,
        committed_ticket: authority.ticket,
      };
    },
  };
}

function authorizeRawLaunchRequest(requestValue: unknown): {
  request: Record<string, unknown>;
  ticket: Record<string, unknown>;
  receipt: Record<string, unknown>;
} {
  const request = structuredClone(requestValue) as Record<string, unknown>;
  const base = authorizeRequest(catalog.defaults);
  const candidate = request.candidate as Record<string, unknown>;
  const surfaces = request.surfaces as Record<string, unknown>;
  const agent = surfaces['cursor-agent-cli'] as Record<string, unknown>;
  const binary = agent.binary as Record<string, unknown>;
  const launch = request.launch as Record<string, unknown>;
  const providerExtension = {
    schema: CURSOR_PROVIDER_LAUNCH_EXTENSION_SCHEMA,
    selector: candidate.selector,
    workspace_path: request.workspace,
    executable_path: binary.path,
  };
  const dispatch = {
    attempt_id: request.attempt_id,
    run_ref: request.run_ref,
    launch_idempotency_key: launch.idempotency_key,
    launch_nonce: launch.nonce,
  };
  const canonicalIdentity = structuredClone(base.ticket.canonical_identity) as Record<
    string,
    unknown
  >;
  (canonicalIdentity.input as Record<string, unknown>).digest = sha256Digest(
    String(request.prompt),
  );
  (canonicalIdentity.request as Record<string, unknown>).digest = sha256Digest(
    canonicalJson({ provider_extension: providerExtension, dispatch }),
  );
  const normalizedIdentity = normalizeCanonicalLaunchIdentity(canonicalIdentity);
  const ticket = {
    ...structuredClone(base.ticket),
    canonical_identity: normalizedIdentity,
    canonical_identity_digest: canonicalLaunchIdentityDigest(normalizedIdentity),
    provider_extension: providerExtension,
  };
  const parsedTicket = parseQuotaAdmissionTicket(ticket);
  assert.ok(parsedTicket, 'hostile ticket must remain internally coherent');
  const ticketDigest = digestQuotaAdmissionTicket(parsedTicket);
  const boundRequest = merge(request, { reservation: { ticket_digest: ticketDigest } }) as Record<
    string,
    unknown
  >;
  const receipt = merge(base.receipt, { ticket_digest: ticketDigest }) as Record<string, unknown>;
  return { request: boundRequest, ticket, receipt };
}

function ownerReceiptBindingContext(
  requestValue: unknown,
): QuotaOwnerPreflightReceiptBindingContext {
  const request = requestValue as Record<string, unknown>;
  const ownerRequest = request.owner as Record<string, unknown>;
  const payer = request.payer as Record<string, unknown>;
  const quota = request.quota as Record<string, unknown>;
  const reservation = request.reservation as Record<string, unknown>;
  return {
    reservation_id: String(ownerRequest.reservation_id),
    reservation_request_hash: String(reservation.request_hash),
    ticket_digest: String(reservation.ticket_digest),
    attempt_id: String(request.attempt_id),
    run_ref: String(request.run_ref),
    account_id: String(payer.payer_id),
    pool_id: String(quota.pool_ref),
    source_revision: String(quota.source_revision),
    authority_digest: String(reservation.authority_digest),
  };
}

function providerLaunchBindingContext(
  requestValue: unknown,
  receiptValue: unknown = catalog.owner_receipt,
): QuotaAdmissionTicketProviderLaunchBindingContext {
  const request = requestValue as Record<string, unknown>;
  const surfaces = request.surfaces as Record<string, unknown>;
  const agent = surfaces['cursor-agent-cli'] as Record<string, unknown>;
  const binary = agent.binary as Record<string, unknown>;
  const payer = request.payer as Record<string, unknown>;
  const quota = request.quota as Record<string, unknown>;
  const reservation = request.reservation as Record<string, unknown>;
  const launch = request.launch as Record<string, unknown>;
  const receipt = receiptValue as Record<string, unknown>;
  return {
    ticket_digest: String(receipt.ticket_digest),
    reservation_id: String(reservation.id),
    reservation_request_hash: String(reservation.request_hash),
    reservation_expires_at: String(reservation.expires_at),
    attempt_id: String(request.attempt_id),
    run_ref: String(request.run_ref),
    account_id: String(payer.payer_id),
    pool_id: String(quota.pool_ref),
    identity_fingerprint: String(payer.identity_fingerprint),
    aggregation_key: String(quota.aggregation_key),
    live_source_revision: String(quota.source_revision),
    runtime_sha256: String(binary.runtime_sha256),
    launch_idempotency_key: String(launch.idempotency_key),
    launch_nonce: String(launch.nonce),
    checked_at: String(receipt.checked_at),
    canonical_identity: canonicalIdentityForRequest(request),
    provider_extension: providerExtensionForRequest(request),
  };
}

function providerExtensionForRequest(
  request: Record<string, unknown>,
): Readonly<CursorProviderLaunchExtension> {
  const candidate = request.candidate as Record<string, unknown>;
  const surfaces = request.surfaces as Record<string, unknown>;
  const agent = surfaces['cursor-agent-cli'] as Record<string, unknown>;
  const binary = agent.binary as Record<string, unknown>;
  const extension = parseCursorProviderLaunchExtension({
    schema: CURSOR_PROVIDER_LAUNCH_EXTENSION_SCHEMA,
    selector: candidate.selector,
    workspace_path: request.workspace,
    executable_path: binary.path,
  });
  assert.ok(extension);
  return extension;
}

function canonicalIdentityForRequest(
  request: Record<string, unknown>,
): Readonly<CanonicalLaunchIdentity> {
  const candidate = request.candidate as Record<string, unknown>;
  const lineage = request.lineage as Record<string, unknown>;
  const permission = lineage.permission as Record<string, unknown>;
  const payer = request.payer as Record<string, unknown>;
  const quota = request.quota as Record<string, unknown>;
  const surfaces = request.surfaces as Record<string, unknown>;
  const agent = surfaces['cursor-agent-cli'] as Record<string, unknown>;
  const binary = agent.binary as Record<string, unknown>;
  const launch = request.launch as Record<string, unknown>;
  const extension = providerExtensionForRequest(request);
  return normalizeCanonicalLaunchIdentity({
    schema: CANONICAL_LAUNCH_IDENTITY_SCHEMA,
    origin: { harness: request.origin_harness, session_ref: request.origin_session_ref },
    target: {
      harness: 'cursor',
      adapter: 'cursor/agent-cli-v1',
      surface: 'cli-headless',
      transport: 'cursor-agent-json-stream-v1',
      candidate_id: candidate.candidate_id,
    },
    provider: { id: candidate.provider, model: candidate.model, effort: candidate.effort },
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
    input: { digest: sha256Digest(String(request.prompt)) },
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

function launchAuthorityForRequest(request: Record<string, unknown>): Record<string, unknown> {
  const canonicalIdentity = canonicalIdentityForRequest(request);
  return {
    canonical_identity: canonicalIdentity,
    canonical_identity_digest: canonicalLaunchIdentityDigest(canonicalIdentity),
    provider_extension: providerExtensionForRequest(request),
  };
}

function defaultCatalogSelector(): Record<string, unknown> {
  const catalogValue = catalog.defaults.catalog as Record<string, unknown>;
  assert.ok(Array.isArray(catalogValue.selectors));
  const selector = catalogValue.selectors[0];
  assert.ok(record(selector));
  return selector;
}

function invokeOptions(
  providerRuntime: ProviderRuntime,
  overrides: Record<string, unknown> = {},
): Parameters<typeof invokeCursorProvider>[1] {
  return {
    runtime: providerRuntime,
    hardTimeoutMs: 1_000,
    owner: owner(),
    ...overrides,
  } as unknown as Parameters<typeof invokeCursorProvider>[1];
}

function fakeOwnedChild(
  spec: ProviderSpawnSpec,
  stream: Catalog['stream_cases'][number]['stream'],
): ProviderOwnedChild {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let exitCode: number | null = null;
  let signalCode: NodeJS.Signals | null = null;
  let closed = false;
  const child = emitter as ChildProcess;
  Object.defineProperties(child, {
    stdout: { value: stdout },
    stderr: { value: stderr },
    stdin: { value: null },
    pid: { value: undefined },
    exitCode: { get: () => exitCode },
    signalCode: { get: () => signalCode },
  });
  const close = (code: number | null, signal: NodeJS.Signals | null) => {
    if (closed) return;
    closed = true;
    exitCode = code;
    signalCode = signal;
    stdout.end();
    stderr.end();
    queueMicrotask(() => child.emit('close', code, signal));
  };
  const valueAfter = (flag: string): string | null => {
    const index = spec.argv.indexOf(flag);
    return index < 0 ? null : (spec.argv[index + 1] ?? null);
  };
  const prompt = spec.argv.at(-1) ?? '';
  queueMicrotask(() => {
    if (closed) return;
    child.emit('spawn');
    const init = merge(
      {
        type: 'system',
        subtype: 'init',
        model: valueAfter('--model'),
        cwd: valueAfter('--workspace'),
        session_id: 'cursor-session-fixture',
        permissionMode: 'ask',
        sandboxMode: 'enabled',
      },
      stream.init_overrides ?? {},
    ) as Record<string, unknown>;
    for (const field of stream.omit_init_fields ?? []) delete init[field];
    const terminal = merge(
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'offline cursor fixture complete',
        session_id: 'cursor-session-fixture',
      },
      stream.terminal_overrides ?? {},
    ) as Record<string, unknown>;
    const write = (event: Record<string, unknown>) =>
      !closed && stdout.write(Buffer.from(`${JSON.stringify(event)}\n`));
    if (stream.terminal_before_init) {
      write(terminal);
      if (stream.between_terminal_and_init) write({ type: 'assistant', text: 'late evidence' });
      write(init);
    } else {
      write(init);
      if (stream.duplicate_init) write(init);
      if (prompt.includes('fixture:hang')) return;
      write(terminal);
      if (stream.duplicate_terminal) write(terminal);
      if (stream.post_terminal_event) write({ type: 'assistant', text: 'late evidence' });
    }
    close(0, null);
  });
  return {
    child,
    tree: {
      schema: PROVIDER_PROCESS_TREE_SCHEMA,
      kind: 'posix-process-group',
      groupId: 1,
      signal(signal) {
        close(null, signal);
        return true;
      },
      isAlive: () => !closed,
    },
  };
}

function actualNodeArgvDigest(input: string): string {
  const child = spawnSync(
    process.execPath,
    ['-e', 'process.stdout.write(Buffer.from(process.argv[1], "utf8").toString("hex"))', input],
    { encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr);
  return `sha256:${createHash('sha256').update(Buffer.from(child.stdout, 'hex')).digest('hex')}`;
}

test('fixture catalog freezes the exact v2 request and stream-coherence matrix', () => {
  assert.equal(catalog.schema, 'ccm/cursor-provider-driver-fixtures/v2');
  assert.equal(catalog.contract, 'ccm/cursor-provider-driver/v2');
  assert.equal(catalog.defaults.schema, 'ccm/cursor-provider-request/v2');
  assert.deepEqual(
    catalog.cases.map((entry) => entry.id),
    Array.from({ length: 50 }, (_, index) => `CPD-${String(index + 1).padStart(3, '0')}`),
  );
  assert.deepEqual(
    catalog.stream_cases.map((entry) => entry.id),
    Array.from({ length: 10 }, (_, index) => `CPS-${String(index + 1).padStart(3, '0')}`),
  );
  assert.deepEqual(
    catalog.invoke_cases.map((entry) => entry.id),
    Array.from({ length: 7 }, (_, index) => `CPO-${String(index + 1).padStart(3, '0')}`),
  );
  assert.equal(catalog.cases.length, 50);
  assert.equal(catalog.cases.filter((entry) => entry.expected.eligible).length, 2);
  assert.equal(catalog.cases.filter((entry) => !entry.expected.eligible).length, 48);
  assert.equal(catalog.stream_cases.length, 10);
  assert.equal(catalog.invoke_cases.length, 7);
  assert.equal(
    catalog.cases.length + catalog.stream_cases.length + catalog.invoke_cases.length,
    67,
  );
  assert.equal(
    catalog.cases.filter((entry) => !entry.expected.eligible).length +
      catalog.stream_cases.length +
      catalog.invoke_cases.length,
    65,
  );
  assert.equal(catalog.cases.filter((entry) => entry.expected.review_counterexample).length, 16);
  assert.deepEqual(
    new Set([
      ...catalog.cases.flatMap((entry) => entry.expected.axis ?? []),
      ...catalog.invoke_cases.map((entry) => entry.axis),
      ...catalog.stream_cases.map((entry) => entry.axis),
    ]),
    new Set([
      'request.schema',
      'request.closed-shape',
      'request.origin',
      'request.identity',
      'request.workspace',
      'request.prompt',
      'request.types',
      'request.enums',
      'headless.surface',
      'headless.binary',
      'headless.binary-identity',
      'headless.authentication',
      'payer.provenance',
      'payer.authority',
      'catalog.provenance',
      'catalog.freshness',
      'catalog.binding',
      'catalog.identity',
      'selector.exact',
      'selector.auto',
      'quota.pool',
      'quota.provenance',
      'quota.freshness',
      'quota.revision',
      'quota.state',
      'reservation.binding',
      'reservation.identity',
      'run.identity',
      'sandbox.qualification',
      'policy',
      'owner.request',
      'owner.receipt',
      'owner.receipt-grammar',
      'owner.binding',
      'invoke.timeout',
      'invoke.runtime',
      'invoke.signal',
      'invoke.closed-shape',
      'invoke.supervision-handoff',
      'stream.permission',
      'stream.session',
      'stream.init-cardinality',
      'stream.terminal-cardinality',
      'stream.sandbox',
      'stream.sandbox-attestation',
      'stream.order',
    ]),
  );
});

test('versioned oracle is exact against production-owned closed registries', async () => {
  const ticketContract = (await import('../src/quota-admission-ticket.js').catch(
    () => ({}),
  )) as Record<string, unknown>;
  const productionRegistry = cursorProviderContract.CURSOR_PROVIDER_CONTRACT_REGISTRY;
  assert.deepEqual(productionRegistry, catalog.registries);
  assert.deepEqual(
    quotaOwnerContract.QUOTA_OWNER_PREFLIGHT_RECEIPT_REGISTRY,
    (catalog.registries as Record<string, unknown>).owner_receipt,
  );
  assert.deepEqual(
    ticketContract.QUOTA_ADMISSION_TICKET_REGISTRY,
    (catalog.registries as Record<string, unknown>).ticket,
  );
  for (const name of [
    'parseQuotaAdmissionTicket',
    'validateQuotaAdmissionTicketBinding',
    'validateQuotaAdmissionTicketProviderLaunchBinding',
    'digestQuotaAdmissionTicket',
  ]) {
    assert.equal(typeof ticketContract[name], 'function', name);
  }
});

test('provider preflight admits the verified 2026.07.16 Cursor Agent binary version', () => {
  const request = merge(catalog.defaults, {
    surfaces: {
      'cursor-agent-cli': {
        binary: { version: '2026.07.16-899851b' },
      },
    },
  });
  const decision = preflightCursorProvider(request);

  assert.equal(decision.eligible, true);
  assert.equal(decision.blockers.includes('headless.binary-unsupported'), false);
});

test('owner receipt mutations kill every exported grammar predicate class', () => {
  const mutants: Record<string, Record<string, unknown>> = {
    'closed-fields': { ...catalog.owner_receipt, unexpected: true },
    schema: { ...catalog.owner_receipt, schema: 'ccm/quota-owner-preflight-receipt/v0' },
    'canonical-identifiers': { ...catalog.owner_receipt, reservation_id: 'qres-trailing ' },
    'source-revision': { ...catalog.owner_receipt, source_revision: 'revision-without-prefix' },
    'sha256-digests': { ...catalog.owner_receipt, ticket_digest: 'sha256:not-a-digest' },
    'parseable-checked-at': { ...catalog.owner_receipt, checked_at: 'not-an-instant' },
  };
  assert.deepEqual(
    Object.keys(mutants),
    quotaOwnerContract.QUOTA_OWNER_PREFLIGHT_RECEIPT_REGISTRY.predicate_ids,
  );
  for (const [predicateId, mutant] of Object.entries(mutants)) {
    assert.equal(quotaOwnerContract.parseQuotaOwnerPreflightReceipt(mutant), null, predicateId);
  }
});

test('shared receipt and provider-launch registries are exact, bidirectional mutation oracles', () => {
  const receipt = quotaOwnerContract.parseQuotaOwnerPreflightReceipt(catalog.owner_receipt);
  const ticket = parseQuotaAdmissionTicket(catalog.committed_ticket);
  assert.ok(receipt);
  assert.ok(ticket);

  const receiptContext = ownerReceiptBindingContext(catalog.defaults);
  assert.equal(
    quotaOwnerContract.validateQuotaOwnerPreflightReceiptBinding(receipt, receiptContext),
    true,
  );
  const receiptMutants: Record<string, QuotaOwnerPreflightReceiptBindingContext> = {
    'reservation-id': { ...receiptContext, reservation_id: 'qres-other' },
    'reservation-request-hash': {
      ...receiptContext,
      reservation_request_hash:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    'ticket-digest': {
      ...receiptContext,
      ticket_digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    'attempt-id': { ...receiptContext, attempt_id: 'attempt-other' },
    'run-ref': { ...receiptContext, run_ref: 'run-other' },
    'account-id': { ...receiptContext, account_id: 'account-other' },
    'pool-id': { ...receiptContext, pool_id: 'pool-other' },
    'source-revision': {
      ...receiptContext,
      source_revision: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    'authority-digest': {
      ...receiptContext,
      authority_digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
  };
  assert.deepEqual(
    Object.keys(receiptMutants),
    quotaOwnerContract.QUOTA_OWNER_PREFLIGHT_RECEIPT_BINDING_IDS,
  );
  for (const [bindingId, mutant] of Object.entries(receiptMutants)) {
    assert.equal(
      quotaOwnerContract.validateQuotaOwnerPreflightReceiptBinding(receipt, mutant),
      false,
      bindingId,
    );
  }

  const launchContext = providerLaunchBindingContext(catalog.defaults, receipt);
  assert.equal(validateQuotaAdmissionTicketProviderLaunchBinding(ticket, launchContext), true);
  const otherCanonicalIdentity = structuredClone(launchContext.canonical_identity);
  otherCanonicalIdentity.origin.harness = 'claude-code';
  const currentProviderExtension = parseCursorProviderLaunchExtension(
    launchContext.provider_extension,
  );
  assert.ok(currentProviderExtension);
  const otherProviderExtension: CursorProviderLaunchExtension = {
    ...currentProviderExtension,
    executable_path: '/fixture/bin/runtime-b',
  };
  const launchMutants: Record<string, QuotaAdmissionTicketProviderLaunchBindingContext> = {
    'ticket-digest': {
      ...launchContext,
      ticket_digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    'reservation-id': { ...launchContext, reservation_id: 'qres-other' },
    'reservation-request-hash': {
      ...launchContext,
      reservation_request_hash:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    'reservation-expiry': {
      ...launchContext,
      reservation_expires_at: '2026-07-14T12:04:01.000Z',
    },
    'attempt-id': { ...launchContext, attempt_id: 'attempt-other' },
    'run-ref': { ...launchContext, run_ref: 'run-other' },
    'account-id': { ...launchContext, account_id: 'account-other' },
    'pool-id': { ...launchContext, pool_id: 'pool-other' },
    'identity-fingerprint': {
      ...launchContext,
      identity_fingerprint:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    'aggregation-key': { ...launchContext, aggregation_key: 'aggregation-other' },
    'live-source-revision': {
      ...launchContext,
      live_source_revision:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    'runtime-sha256': {
      ...launchContext,
      runtime_sha256: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    'launch-idempotency-key': {
      ...launchContext,
      launch_idempotency_key: 'launch-other',
    },
    'launch-nonce': { ...launchContext, launch_nonce: 'nonce-other' },
    'checked-at-window': { ...launchContext, checked_at: '2026-07-14T12:03:00.000Z' },
    'canonical-identity': {
      ...launchContext,
      canonical_identity: otherCanonicalIdentity,
    },
    'provider-extension': {
      ...launchContext,
      provider_extension: otherProviderExtension,
    },
  };
  assert.deepEqual(Object.keys(launchMutants), QUOTA_ADMISSION_TICKET_PROVIDER_LAUNCH_BINDING_IDS);
  for (const [bindingId, mutant] of Object.entries(launchMutants)) {
    assert.equal(
      validateQuotaAdmissionTicketProviderLaunchBinding(ticket, mutant),
      false,
      bindingId,
    );
  }
});

test('digest-only spoof and runtime-A ticket to runtime-B launch stop before resolution', async () => {
  const digestOnlyEffects: string[] = [];
  const digestOnlyResolutions: string[] = [];
  const digestOnlySpawns: ProviderSpawnSpec[] = [];
  const digestOnly = await invokeCursorProvider(
    catalog.defaults,
    invokeOptions(runtime(digestOnlyResolutions, digestOnlySpawns, {}, digestOnlyEffects), {
      owner: {
        async preflight() {
          digestOnlyEffects.push('owner.preflight');
          return {
            decision: 'launch-claim-allowed',
            automatic_spawn_limit: 1,
            owner_receipt: catalog.owner_receipt,
          };
        },
      },
    }),
  );
  assert.equal(digestOnly.state, 'rejected');
  assert.ok(digestOnly.blockers.includes('owner.ticket-invalid'));
  assert.deepEqual(digestOnlyEffects, ['owner.preflight']);
  assert.deepEqual(digestOnlyResolutions, []);
  assert.deepEqual(digestOnlySpawns, []);

  const runtimeBRequest = merge(catalog.defaults, {
    surfaces: {
      'cursor-agent-cli': {
        binary: {
          runtime_sha256: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      },
    },
  });
  const runtimeBEffects: string[] = [];
  const runtimeBResolutions: string[] = [];
  const runtimeBSpawns: ProviderSpawnSpec[] = [];
  const runtimeB = await invokeCursorProvider(
    runtimeBRequest,
    invokeOptions(runtime(runtimeBResolutions, runtimeBSpawns, {}, runtimeBEffects), {
      owner: owner({}, runtimeBEffects),
    }),
  );
  assert.equal(runtimeB.state, 'rejected');
  assert.ok(runtimeB.blockers.includes('owner.ticket-binding-mismatch'));
  assert.deepEqual(runtimeBEffects, ['owner.preflight']);
  assert.deepEqual(runtimeBResolutions, []);
  assert.deepEqual(runtimeBSpawns, []);
});

test('unchanged authority rejects synchronized selector, model, effort, and candidate replay before resolution', async () => {
  const request = merge(catalog.defaults, {
    selector: 'composer-other[fast=true]',
    candidate: {
      candidate_id: 'cursor-cli-other-high',
      provider: 'cursor',
      model: 'composer-other',
      effort: 'high',
      selector: 'composer-other[fast=true]',
    },
    catalog: {
      selectors: [
        {
          candidate_id: 'cursor-cli-other-high',
          provider: 'cursor',
          model: 'composer-other',
          effort: 'high',
          selector: 'composer-other[fast=true]',
          authority_id: 'cursor-first-party-owner-fixture',
          payer_id: 'payer-first-party-fixture',
          pool: 'first_party',
          pool_ref: 'cursor:first-party:fixture',
        },
      ],
    },
  });
  assert.equal(preflightCursorProvider(request).eligible, true);
  const effects: string[] = [];
  const resolutions: string[] = [];
  const spawns: ProviderSpawnSpec[] = [];
  const result = await invokeCursorProvider(
    request,
    invokeOptions(runtime(resolutions, spawns, {}, effects), { owner: owner({}, effects) }),
  );
  assert.equal(result.state, 'rejected');
  assert.ok(result.blockers.includes('owner.ticket-binding-mismatch'));
  assert.deepEqual(effects, ['owner.preflight']);
  assert.deepEqual(resolutions, []);
  assert.deepEqual(spawns, []);
  assert.throws(() => compileCursorProviderInvocation(request, catalog.committed_ticket));
});

test('unchanged authority rejects workspace, worktree, and full input replay before resolution', async () => {
  const mutants = {
    workspace_worktree: merge(catalog.defaults, {
      workspace: '/fixture/other-worktree',
      lineage: {
        workspace_ref: 'workspace:other',
        worktree_ref: 'worktree:other',
      },
    }),
    full_input: merge(catalog.defaults, { prompt: 'fixture:different-complete-input' }),
    launch_nonce: merge(catalog.defaults, { launch: { nonce: 'nonce-replayed' } }),
  };
  for (const [id, request] of Object.entries(mutants)) {
    assert.equal(preflightCursorProvider(request).eligible, true, id);
    const effects: string[] = [];
    const resolutions: string[] = [];
    const spawns: ProviderSpawnSpec[] = [];
    const result = await invokeCursorProvider(
      request,
      invokeOptions(runtime(resolutions, spawns, {}, effects), { owner: owner({}, effects) }),
    );
    assert.equal(result.state, 'rejected', id);
    assert.ok(result.blockers.includes('owner.ticket-binding-mismatch'), id);
    assert.deepEqual(effects, ['owner.preflight'], id);
    assert.deepEqual(resolutions, [], id);
    assert.deepEqual(spawns, [], id);
    assert.throws(() => compileCursorProviderInvocation(request, catalog.committed_ticket), id);
  }
});

test('authorized input digest equals the bytes a real Node argv boundary delivers', async () => {
  const vectors = [
    ['lone-high-surrogate', '\ud800'],
    ['lone-low-surrogate', '\udc00'],
    ['reversed-surrogates', '\udc00\ud800'],
    ['paired-surrogate', '\ud83d\ude42'],
    ['emoji-and-cjk', '跨 harness 🙂'],
    ['combining-sequence', 'e\u0301'],
  ] as const;
  for (const [id, prompt] of vectors) {
    const authority = authorizeRequest(merge(catalog.defaults, { prompt }));
    const resolutions: string[] = [];
    const spawns: ProviderSpawnSpec[] = [];
    const result = await invokeCursorProvider(
      authority.request,
      invokeOptions(runtime(resolutions, spawns), { owner: authority.owner }),
    );
    assert.equal(result.state, 'succeeded', id);
    assert.deepEqual(resolutions, ['cursor-agent'], id);
    assert.equal(spawns.length, 1, id);
    const identity = authority.ticket.canonical_identity as CanonicalLaunchIdentity;
    assert.equal(identity.input.digest, actualNodeArgvDigest(prompt), id);
  }
});

test('NUL input is rejected before coherent owner authority and every runtime effect', async () => {
  const effects: string[] = [];
  const resolutions: string[] = [];
  const spawns: ProviderSpawnSpec[] = [];
  const authority = authorizeRawLaunchRequest(merge(catalog.defaults, { prompt: 'left\0right' }));
  const result = await invokeCursorProvider(
    authority.request,
    invokeOptions(runtime(resolutions, spawns, {}, effects), {
      owner: ownerForAuthority(authority, effects),
    }),
  );
  assert.equal(result.state, 'rejected');
  assert.ok(result.blockers.includes('request.input-invalid'));
  assert.deepEqual(effects, []);
  assert.deepEqual(resolutions, []);
  assert.deepEqual(spawns, []);
});

test('NUL OS-bound launch strings fail closed before coherent authority or runtime effects', async (t) => {
  const invalidSelector = 'composer-2.5\0[fast=false]';
  const selectorRow = structuredClone(defaultCatalogSelector());
  selectorRow.selector = invalidSelector;
  const cases = [
    {
      id: 'workspace-path',
      request: merge(catalog.defaults, { workspace: '/fixture/work\0tree' }),
      resolvedExecutable: '/fixture/bin/cursor-agent',
    },
    {
      id: 'raw-selector',
      request: merge(catalog.defaults, {
        selector: invalidSelector,
        candidate: { selector: invalidSelector },
        catalog: { selectors: [selectorRow] },
      }),
      resolvedExecutable: '/fixture/bin/cursor-agent',
    },
    {
      id: 'executable-path',
      request: merge(catalog.defaults, {
        surfaces: { 'cursor-agent-cli': { binary: { path: '/fixture/bin/cursor\0-agent' } } },
      }),
      resolvedExecutable: '/fixture/bin/cursor\0-agent',
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.id, async () => {
      const authority = authorizeRawLaunchRequest(fixture.request);
      const effects: string[] = [];
      const resolutions: string[] = [];
      const spawns: ProviderSpawnSpec[] = [];
      const result = await invokeCursorProvider(
        authority.request,
        invokeOptions(runtime(resolutions, spawns, {}, effects, fixture.resolvedExecutable), {
          owner: ownerForAuthority(authority, effects),
        }),
      );
      assert.deepEqual(effects, [], fixture.id);
      assert.deepEqual(resolutions, [], fixture.id);
      assert.deepEqual(spawns, [], fixture.id);
      assert.equal(result.state, 'rejected', fixture.id);
    });
  }
});

test('formal quota launch-bind example stays in canonical identity registry parity', () => {
  const contract = readFileSync(
    new URL(
      '../../../../design_docs/2026-07-13-cross-harness-quota-admission-contract.md',
      import.meta.url,
    ),
    'utf8',
  );
  const exampleMatch = contract.match(
    /### 5\.2 Commit 与 supervisor launch bind[\s\S]*?```json\n([\s\S]*?)\n```/u,
  );
  const exampleJson = exampleMatch?.[1];
  assert.ok(exampleJson, 'quota launch-bind example must remain machine-readable JSON');
  const ticket = JSON.parse(exampleJson) as Record<string, unknown>;
  const identity = ticket.canonical_identity as Record<string, unknown>;
  const registry = CANONICAL_LAUNCH_IDENTITY_FIELD_REGISTRY;
  const exactFields = (value: unknown, expected: readonly string[], label: string) => {
    assert.ok(record(value), `${label} must be an object`);
    assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), label);
  };

  exactFields(identity, registry.root, 'canonical_identity');
  exactFields(identity.origin, registry.origin, 'canonical_identity.origin');
  exactFields(identity.target, registry.target, 'canonical_identity.target');
  exactFields(identity.provider, registry.provider, 'canonical_identity.provider');
  exactFields(identity.account, registry.account, 'canonical_identity.account');
  exactFields(identity.workspace, registry.workspace, 'canonical_identity.workspace');
  exactFields(identity.permission, registry.permission, 'canonical_identity.permission');
  exactFields(identity.input, registry.digest, 'canonical_identity.input');
  exactFields(identity.request, registry.digest, 'canonical_identity.request');
  exactFields(identity.dispatch, registry.dispatch, 'canonical_identity.dispatch');
  exactFields(identity.runtime, registry.runtime, 'canonical_identity.runtime');
  exactFields(
    (identity.runtime as Record<string, unknown>).selector,
    registry.selector,
    'canonical_identity.runtime.selector',
  );

  const dispatch = identity.dispatch as Record<string, unknown>;
  assert.equal(ticket.run_ref, 'ccm-run:v1:run-7');
  assert.equal(dispatch.run_ref, ticket.run_ref);
  assert.equal(dispatch.idempotency_key, ticket.launch_idempotency_key);
  assert.equal(dispatch.launch_nonce, ticket.launch_nonce);
  assert.equal(dispatch.claim_id, ticket.launch_nonce);
});

test('ticket parser rejects counterfeit runtime and identity SHA-256 shapes', () => {
  const invalid = [
    'sha256:x',
    `sha256:${'a'.repeat(63)}`,
    `sha256:${'a'.repeat(65)}`,
    `sha256:${'A'.repeat(64)}`,
    `sha256:${'a'.repeat(32)}/${'b'.repeat(31)}`,
    ` sha256:${'a'.repeat(64)}`,
    `sha256:${'a'.repeat(64)} `,
  ];
  for (const digest of invalid) {
    const runtimeTicket = structuredClone(catalog.committed_ticket);
    runtimeTicket.runtime_sha256 = digest;
    const runtimeIdentity = runtimeTicket.canonical_identity as Record<string, unknown>;
    (runtimeIdentity.runtime as Record<string, unknown>).image_sha256 = digest;
    assert.equal(parseQuotaAdmissionTicket(runtimeTicket), null, `runtime_sha256=${digest}`);
    const identityTicket = structuredClone(catalog.committed_ticket);
    identityTicket.identity_fingerprint = digest;
    const accountIdentity = identityTicket.canonical_identity as Record<string, unknown>;
    (accountIdentity.account as Record<string, unknown>).identity_fingerprint = digest;
    assert.equal(parseQuotaAdmissionTicket(identityTicket), null, `identity_fingerprint=${digest}`);
  }
});

test('canonical provider request digest is order-independent and binds every extension/dispatch atom', () => {
  const extension = providerExtensionForRequest(catalog.defaults);
  const launch = catalog.defaults.launch as Record<string, unknown>;
  const dispatch = {
    attempt_id: catalog.defaults.attempt_id,
    run_ref: catalog.defaults.run_ref,
    launch_idempotency_key: launch.idempotency_key,
    launch_nonce: launch.nonce,
  };
  const expected = digestCursorProviderLaunchRequest(extension, dispatch);
  assert.equal(
    digestCursorProviderLaunchRequest(
      {
        executable_path: extension.executable_path,
        workspace_path: extension.workspace_path,
        selector: extension.selector,
        schema: extension.schema,
      },
      {
        launch_nonce: dispatch.launch_nonce,
        launch_idempotency_key: dispatch.launch_idempotency_key,
        run_ref: dispatch.run_ref,
        attempt_id: dispatch.attempt_id,
      },
    ),
    expected,
  );
  const mutants = [
    [{ ...extension, selector: 'composer-other[fast=false]' }, dispatch],
    [{ ...extension, workspace_path: '/fixture/other-worktree' }, dispatch],
    [{ ...extension, executable_path: '/fixture/bin/other-agent' }, dispatch],
    [extension, { ...dispatch, attempt_id: 'attempt-other' }],
    [extension, { ...dispatch, run_ref: 'run-other' }],
    [extension, { ...dispatch, launch_idempotency_key: 'launch-other' }],
    [extension, { ...dispatch, launch_nonce: 'nonce-other' }],
  ] as const;
  const digests = mutants.map(([extensionMutant, dispatchMutant]) =>
    digestCursorProviderLaunchRequest(extensionMutant, dispatchMutant),
  );
  assert.equal(new Set([expected, ...digests]).size, 8);
});

test('provider launch extension rejects NUL in every OS-bound field', async (t) => {
  const extension = providerExtensionForRequest(catalog.defaults);
  const mutants = [
    { id: 'raw-selector', value: { ...extension, selector: 'composer\0[fast=false]' } },
    { id: 'workspace-path', value: { ...extension, workspace_path: '/fixture/work\0tree' } },
    {
      id: 'executable-path',
      value: { ...extension, executable_path: '/fixture/bin/cursor\0-agent' },
    },
  ];
  for (const mutant of mutants) {
    await t.test(mutant.id, () => {
      assert.equal(parseCursorProviderLaunchExtension(mutant.value), null, mutant.id);
    });
  }
});

test('unchanged authority kills the complete twenty-atom actual-launch mutation matrix', async () => {
  const synchronizedCandidate = (overrides: Record<string, unknown>) => {
    const candidate = merge(catalog.defaults.candidate, overrides) as Record<string, unknown>;
    const selector = String(candidate.selector);
    return merge(catalog.defaults, {
      selector,
      candidate,
      catalog: { selectors: [{ ...defaultCatalogSelector(), ...candidate }] },
    });
  };
  const mutants: Record<string, unknown> = {
    'candidate-id': synchronizedCandidate({ candidate_id: 'cursor-cli-other-standard' }),
    provider: synchronizedCandidate({ provider: 'other-provider' }),
    model: synchronizedCandidate({ model: 'composer-other' }),
    effort: synchronizedCandidate({ effort: 'high' }),
    selector: synchronizedCandidate({ selector: 'composer-2.5[fast=true]' }),
    origin: merge(catalog.defaults, { origin_harness: 'codex' }),
    account: merge(catalog.defaults, {
      payer: { payer_id: 'payer-other' },
      catalog: {
        payer_id: 'payer-other',
        selectors: [{ ...defaultCatalogSelector(), payer_id: 'payer-other' }],
      },
      quota: { payer_id: 'payer-other' },
      reservation: { payer_id: 'payer-other' },
    }),
    'workspace-path': merge(catalog.defaults, { workspace: '/fixture/other-worktree' }),
    'workspace-ref': merge(catalog.defaults, { lineage: { workspace_ref: 'workspace:other' } }),
    'worktree-ref': merge(catalog.defaults, { lineage: { worktree_ref: 'worktree:other' } }),
    'baseline-commit': merge(catalog.defaults, { lineage: { baseline_commit: '2'.repeat(40) } }),
    'permission-snapshot': merge(catalog.defaults, {
      lineage: { permission: { snapshot_ref: 'permission:other' } },
    }),
    'permission-denies': merge(catalog.defaults, {
      lineage: {
        permission: {
          denies: ['account-mutation', 'credential-write', 'network-access', 'push-remote'],
        },
      },
    }),
    input: merge(catalog.defaults, { prompt: 'fixture:different-complete-input' }),
    'runtime-image': merge(catalog.defaults, {
      surfaces: {
        'cursor-agent-cli': {
          binary: {
            runtime_sha256:
              'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
        },
      },
    }),
    'runtime-path': merge(catalog.defaults, {
      surfaces: { 'cursor-agent-cli': { binary: { path: '/fixture/bin/other-agent' } } },
    }),
    'attempt-id': merge(catalog.defaults, {
      attempt_id: 'attempt-other',
      reservation: { attempt_id: 'attempt-other' },
    }),
    'run-ref': merge(catalog.defaults, {
      run_ref: 'run-other',
      reservation: { run_ref: 'run-other' },
    }),
    'idempotency-key': merge(catalog.defaults, { launch: { idempotency_key: 'launch-other' } }),
    nonce: merge(catalog.defaults, { launch: { nonce: 'nonce-other' } }),
  };
  assert.equal(Object.keys(mutants).length, 20);
  const receiptBefore = canonicalJson(catalog.owner_receipt);
  const ticketBefore = canonicalJson(catalog.committed_ticket);
  for (const [id, request] of Object.entries(mutants)) {
    const effects: string[] = [];
    const resolutions: string[] = [];
    const spawns: ProviderSpawnSpec[] = [];
    const result = await invokeCursorProvider(
      request,
      invokeOptions(runtime(resolutions, spawns, {}, effects), { owner: owner({}, effects) }),
    );
    assert.equal(result.state, 'rejected', id);
    assert.ok(
      result.blockers.some((blocker) =>
        [
          'request.invalid',
          'selector.exact-match-required',
          'candidate.binding-mismatch',
          'owner.binding-mismatch',
          'owner.ticket-binding-mismatch',
        ].includes(blocker),
      ),
      `${id}: ${result.blockers.join(',')}`,
    );
    assert.ok(
      canonicalJson(effects) === canonicalJson([]) ||
        canonicalJson(effects) === canonicalJson(['owner.preflight']),
      `${id}: ${effects.join(',')}`,
    );
    assert.deepEqual(resolutions, [], id);
    assert.deepEqual(spawns, [], id);
  }
  assert.equal(canonicalJson(catalog.owner_receipt), receiptBefore);
  assert.equal(canonicalJson(catalog.committed_ticket), ticketBefore);
});

test('expired ticket and owner-reported claim replay remain pre-resolution denials', async () => {
  const cases = [
    {
      id: 'ticket-expired',
      owner: owner({ checked_at: '2026-07-14T12:03:00.000Z' }),
      blocker: 'owner.ticket-binding-mismatch',
    },
    {
      id: 'claim-replay',
      owner: {
        async preflight() {
          return {
            decision: 'launch-claim-replayed',
            automatic_spawn_limit: 0,
            owner_receipt: catalog.owner_receipt,
            committed_ticket: catalog.committed_ticket,
          };
        },
      },
      blocker: 'owner.receipt-invalid',
    },
  ];
  for (const fixture of cases) {
    const effects: string[] = [];
    const resolutions: string[] = [];
    const spawns: ProviderSpawnSpec[] = [];
    const ownerPort = {
      async preflight(_request: Readonly<Record<string, unknown>>) {
        effects.push('owner.preflight');
        return fixture.owner.preflight();
      },
    };
    const result = await invokeCursorProvider(
      catalog.defaults,
      invokeOptions(runtime(resolutions, spawns, {}, effects), { owner: ownerPort }),
    );
    assert.equal(result.state, 'rejected', fixture.id);
    assert.ok(result.blockers.includes(fixture.blocker), fixture.id);
    assert.deepEqual(effects, ['owner.preflight'], fixture.id);
    assert.deepEqual(resolutions, [], fixture.id);
    assert.deepEqual(spawns, [], fixture.id);
  }
});

test('a repeated launch claim can complete once but the owner replay verdict never resolves twice', async () => {
  let calls = 0;
  const ownerEffects: string[] = [];
  const oneShotOwner = {
    async preflight() {
      calls += 1;
      ownerEffects.push(`owner.preflight.${calls}`);
      return calls === 1
        ? {
            decision: 'launch-claim-allowed',
            automatic_spawn_limit: 1,
            owner_receipt: catalog.owner_receipt,
            committed_ticket: catalog.committed_ticket,
          }
        : {
            decision: 'launch-claim-replayed',
            automatic_spawn_limit: 0,
            owner_receipt: catalog.owner_receipt,
            committed_ticket: catalog.committed_ticket,
          };
    },
  };
  const firstResolutions: string[] = [];
  const firstSpawns: ProviderSpawnSpec[] = [];
  const first = await invokeCursorProvider(
    catalog.defaults,
    invokeOptions(runtime(firstResolutions, firstSpawns), { owner: oneShotOwner }),
  );
  assert.equal(first.state, 'succeeded');
  assert.deepEqual(firstResolutions, ['cursor-agent']);
  assert.equal(firstSpawns.length, 1);

  const replayResolutions: string[] = [];
  const replaySpawns: ProviderSpawnSpec[] = [];
  const replay = await invokeCursorProvider(
    catalog.defaults,
    invokeOptions(runtime(replayResolutions, replaySpawns), { owner: oneShotOwner }),
  );
  assert.equal(replay.state, 'rejected');
  assert.ok(replay.blockers.includes('owner.receipt-invalid'));
  assert.deepEqual(ownerEffects, ['owner.preflight.1', 'owner.preflight.2']);
  assert.deepEqual(replayResolutions, []);
  assert.deepEqual(replaySpawns, []);
});

test('owner preflight cannot mutate the caller alias after the launch request snapshot is sealed', async () => {
  const request = structuredClone(catalog.defaults);
  const resolutions: string[] = [];
  const spawns: ProviderSpawnSpec[] = [];
  const result = await invokeCursorProvider(
    request,
    invokeOptions(runtime(resolutions, spawns), {
      owner: {
        async preflight() {
          request.prompt = 'fixture:mutated-after-preflight';
          request.workspace = '/fixture/mutated-after-preflight';
          return {
            decision: 'launch-claim-allowed',
            automatic_spawn_limit: 1,
            owner_receipt: catalog.owner_receipt,
            committed_ticket: catalog.committed_ticket,
          };
        },
      },
    }),
  );
  assert.equal(result.state, 'succeeded');
  assert.deepEqual(resolutions, ['cursor-agent']);
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0]?.cwd, '/fixture/worktree');
  assert.equal(spawns[0]?.argv.at(-1), 'fixture:success');
});

test('ticket canonicalization delegates to engine and rejects a second CLI truth source', () => {
  const ticket = parseQuotaAdmissionTicket(catalog.committed_ticket);
  assert.ok(ticket);
  assert.equal(canonicalQuotaAdmissionTicketJson(ticket), canonicalJson(ticket));
  assert.equal(digestQuotaAdmissionTicket(ticket), catalog.owner_receipt.ticket_digest);
  assert.equal(existsSync(new URL('../src/canonical-json.ts', import.meta.url)), false);
  assert.equal(existsSync(new URL('../src/canonical-sha256.ts', import.meta.url)), false);
});

test('all sixteen cumulative review counterexamples stop before resolution and spawn', async () => {
  const crossed: string[] = [];
  for (const fixture of catalog.cases.filter((entry) => entry.expected.review_counterexample)) {
    const spawns: ProviderSpawnSpec[] = [];
    const resolutions: string[] = [];
    const effects: string[] = [];
    await invokeCursorProvider(
      merge(catalog.defaults, fixture.overrides),
      invokeOptions(runtime(resolutions, spawns, {}, effects), {
        owner: owner(fixture.owner_receipt_overrides, effects),
      }),
    );
    if (spawns.length !== 0) crossed.push(fixture.id);
    assert.equal(resolutions.length, 0, `${fixture.id} crossed executable resolution`);
    assert.deepEqual(
      effects,
      fixture.expected.preflight_eligible === true ? ['owner.preflight'] : [],
      `${fixture.id} crossed an unauthorized effect boundary`,
    );
  }
  assert.deepEqual(crossed, []);
});

test('preflight keeps IDE and headless truth independent and rejects every bad fact before spawn', async () => {
  for (const fixture of catalog.cases) {
    const request = merge(catalog.defaults, fixture.overrides);
    const decision = preflightCursorProvider(request);
    if (!fixture.expected.eligible) {
      const spawns: ProviderSpawnSpec[] = [];
      const resolutions: string[] = [];
      const effects: string[] = [];
      const result = await invokeCursorProvider(
        request,
        invokeOptions(runtime(resolutions, spawns, {}, effects), {
          owner: owner(fixture.owner_receipt_overrides, effects),
        }),
      );
      assert.equal(result.state, 'rejected', fixture.id);
      assert.equal(result.run_ref, (request as Record<string, unknown>).run_ref, fixture.id);
      assert.equal(resolutions.length, 0, `${fixture.id} crossed executable resolution`);
      assert.equal(spawns.length, 0, `${fixture.id} crossed the process boundary`);
      if (fixture.expected.preflight_eligible !== true) {
        assert.deepEqual(effects, [], `${fixture.id} crossed the effect boundary`);
      } else {
        assert.deepEqual(effects, ['owner.preflight'], fixture.id);
      }
    }
    assert.equal(
      decision.eligible,
      fixture.expected.preflight_eligible ?? fixture.expected.eligible,
      fixture.id,
    );
    if (fixture.expected.blocker && fixture.expected.preflight_eligible !== true) {
      assert.ok(decision.blockers.includes(fixture.expected.blocker), fixture.id);
    }
    if (fixture.expected.route_relation) {
      assert.equal(decision.route_relation, fixture.expected.route_relation, fixture.id);
    }
  }
});

test('stream permission, identity, cardinality, and sandbox counterexamples fail closed', async () => {
  const accepted: string[] = [];
  for (const fixture of catalog.stream_cases) {
    const spawns: ProviderSpawnSpec[] = [];
    const resolutions: string[] = [];
    const result = await invokeCursorProvider(
      catalog.defaults,
      invokeOptions(runtime(resolutions, spawns, fixture.stream)),
    );
    assert.equal(resolutions.length, 1, fixture.id);
    assert.equal(spawns.length, 1, fixture.id);
    if (result.state === 'succeeded' && result.provider_acceptance === 'accepted') {
      accepted.push(fixture.id);
      continue;
    }
    assert.equal(result.state, fixture.expected.state, fixture.id);
    assert.equal(result.provider_acceptance, 'rejected', fixture.id);
    assert.ok(result.blockers.includes(fixture.expected.blocker), fixture.id);
  }
  assert.deepEqual(accepted, []);
});

test('compiled invocation is exact, inspect-only, first-party, and carries no fallback or mutation flags', () => {
  const invocation = compileCursorProviderInvocation(catalog.defaults, catalog.committed_ticket);
  assert.deepEqual(invocation.argv.slice(0, 14), [
    '--workspace',
    '/fixture/worktree',
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
    'composer-2.5[fast=false]',
    'fixture:success',
  ]);
  for (const forbidden of ['--force', '--yolo', '--api-key', 'login', 'logout', 'Auto']) {
    assert.equal(invocation.argv.includes(forbidden), false, forbidden);
  }
  assert.deepEqual(Object.keys(invocation.env).sort(), ['NO_COLOR', 'PATH']);
});

test('provider-local Cursor runs reconcile locally while Native Attempt rejects the CLI descriptor without board mutation', async () => {
  for (const caseId of ['CPD-002', 'CPD-003']) {
    const fixture = catalog.cases.find((entry) => entry.id === caseId);
    assert.ok(fixture);
    const authority = authorizeRequest(merge(catalog.defaults, fixture.overrides));
    const spawns: ProviderSpawnSpec[] = [];
    const resolutions: string[] = [];
    const result = await invokeCursorProvider(
      authority.request,
      invokeOptions(runtime(resolutions, spawns), {
        hardTimeoutMs: 2_000,
        owner: authority.owner,
      }),
    );
    assert.deepEqual(resolutions, ['cursor-agent'], caseId);
    assert.equal(spawns.length, 1, caseId);
    assert.equal(result.state, 'succeeded', `${caseId}: ${JSON.stringify(result)}`);
    assert.equal(result.run_ref, 'ccm-run:v1:cursor-fixture-001', caseId);
    assert.equal(result.requested_selector, 'composer-2.5[fast=false]', caseId);
    assert.equal(result.resolved_selector, result.requested_selector, caseId);
    assert.equal(result.task_acceptance, 'uncertain', caseId);
    const projection = reconcileCursorProviderRun(result);
    assert.deepEqual(projection, {
      schema: 'ccm/cursor-provider-run-reconciliation/v1',
      run_ref: 'ccm-run:v1:cursor-fixture-001',
      attempt_id: 'attempt_cursor_fixture_001',
      attempt_state: 'succeeded',
      task_status: 'uncertain',
      task_done: false,
      terminal: true,
    });
  }

  const nativeFixture = JSON.parse(
    readFileSync(
      new URL(
        '../../../packages/engine/test/fixtures/native-attempt/codex-api-tool-v1.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const board = structuredClone(nativeFixture.initial_board);
  const command = structuredClone(nativeFixture.commands.create);
  const providerCandidate = catalog.defaults.candidate as Record<string, unknown>;
  const candidate = {
    ...board.tasks[0].routing.policy.candidates[0],
    id: providerCandidate.candidate_id,
    harness: 'cursor',
    adapter: 'cursor/agent-cli-v1',
    surface: 'cli-headless',
    provider: providerCandidate.provider,
    model: providerCandidate.model,
    effort: providerCandidate.effort,
  };
  board.tasks[0].routing.policy.candidates = [candidate];
  board.tasks[0].routing.policy.chains.ample = [candidate.id];
  board.tasks[0].routing.policy.chains.tight = [candidate.id];
  command.selection_snapshot.candidate_id = candidate.id;
  command.attempt.candidate_id = candidate.id;
  command.attempt.surface = 'cli-headless';
  command.attempt.transport = 'cursor-agent-json-stream-v1';
  command.attempt.selection_snapshot = structuredClone(command.selection_snapshot);
  command.launch_authority.reservation.candidate_id = candidate.id;

  const identity = structuredClone(command.launch_authority.canonical_identity);
  identity.origin.harness = 'cursor';
  identity.target = {
    harness: 'cursor',
    adapter: 'cursor/agent-cli-v1',
    surface: 'cli-headless',
    transport: 'cursor-agent-json-stream-v1',
    candidate_id: candidate.id,
  };
  identity.provider = {
    id: candidate.provider,
    model: candidate.model,
    effort: candidate.effort,
  };
  identity.runtime.selector = {
    kind: 'exact',
    model_id: candidate.model,
    effort: candidate.effort,
  };
  command.launch_authority.canonical_identity = identity;
  command.launch_authority.canonical_identity_digest = canonicalLaunchIdentityDigest(identity);

  const before = JSON.stringify(board);
  const rejected = nativeAttemptApply(board, command);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.issues?.[0]?.code, 'NATIVE-DESCRIPTOR-UNSUPPORTED');
  assert.equal(JSON.stringify(board), before);
  assert.equal(JSON.stringify(rejected.board), before);
  assert.equal(candidate.id in NATIVE_ATTEMPT_DESCRIPTOR_REGISTRY[NATIVE_ATTEMPT_CONTRACT], false);
});

test('cancellation terminates the owned fake process tree and preserves run_ref for reconcile', async () => {
  const authority = authorizeRequest(merge(catalog.defaults, { prompt: 'fixture:hang' }));
  const spawns: ProviderSpawnSpec[] = [];
  const resolutions: string[] = [];
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error('fixture cancel')), 50);
  const result = await invokeCursorProvider(
    authority.request,
    invokeOptions(runtime(resolutions, spawns), {
      hardTimeoutMs: 2_000,
      signal: controller.signal,
      owner: authority.owner,
    }),
  );
  assert.deepEqual(resolutions, ['cursor-agent']);
  assert.equal(spawns.length, 1);
  assert.equal(result.state, 'cancelled');
  assert.equal(result.run_ref, 'ccm-run:v1:cursor-fixture-001');
  assert.equal(result.task_acceptance, 'uncertain');
  const projection = reconcileCursorProviderRun(result);
  assert.equal(projection.attempt_state, 'cancelled');
  assert.equal(projection.task_done, false);
});

test('review counterexamples and recursive unknown-key mutants reject before resolution and spawn', async () => {
  const mutations: Array<{ id: string; request: unknown }> = [];
  const visit = (value: unknown, path: string[]): void => {
    if (!record(value)) {
      if (Array.isArray(value)) {
        value.forEach((entry, index) => {
          visit(entry, [...path, String(index)]);
        });
      }
      return;
    }
    const mutant = structuredClone(catalog.defaults);
    let target: unknown = mutant;
    for (const segment of path) {
      target = Array.isArray(target)
        ? target[Number(segment)]
        : (target as Record<string, unknown>)[segment];
    }
    (target as Record<string, unknown>).__unexpected_recursive_key__ = true;
    mutations.push({ id: path.join('.') || '<root>', request: mutant });
    for (const [key, child] of Object.entries(value)) visit(child, [...path, key]);
  };
  visit(catalog.defaults, []);
  assert.ok(mutations.length > 10);
  for (const mutation of mutations) {
    const resolutions: string[] = [];
    const spawns: ProviderSpawnSpec[] = [];
    const result = await invokeCursorProvider(
      mutation.request,
      invokeOptions(runtime(resolutions, spawns)),
    );
    assert.equal(result.state, 'rejected', mutation.id);
    assert.deepEqual(resolutions, [], mutation.id);
    assert.deepEqual(spawns, [], mutation.id);
  }
});

test('every owner receipt lineage field is validated at the canonical boundary', async () => {
  for (const field of [
    'reservation_id',
    'reservation_request_hash',
    'ticket_digest',
    'attempt_id',
    'run_ref',
    'account_id',
    'pool_id',
    'source_revision',
    'authority_digest',
  ]) {
    const resolutions: string[] = [];
    const spawns: ProviderSpawnSpec[] = [];
    const result = await invokeCursorProvider(
      catalog.defaults,
      invokeOptions(runtime(resolutions, spawns), {
        owner: owner({
          [field]:
            field.includes('revision') || field.includes('digest') || field.includes('hash')
              ? 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
              : 'other-lineage',
        }),
      }),
    );
    assert.equal(result.state, 'rejected', field);
    assert.deepEqual(resolutions, [], field);
    assert.deepEqual(spawns, [], field);
  }
});

test('every invalid invoke option rejects before executable resolution and spawn', async () => {
  for (const fixture of catalog.invoke_cases.filter(
    (entry) => !entry.options_overrides?.malformed_child_event_surface,
  )) {
    const resolutions: string[] = [];
    const spawns: ProviderSpawnSpec[] = [];
    const providerRuntime = runtime(resolutions, spawns);
    if (fixture.options_overrides?.runtime_schema) {
      (providerRuntime as unknown as { schema: string }).schema =
        fixture.options_overrides.runtime_schema;
    }
    const hardTimeoutMs =
      fixture.hard_timeout_ms === 'NaN' ? Number.NaN : (fixture.hard_timeout_ms ?? 1_000);
    const overrides: Record<string, unknown> = { hardTimeoutMs };
    if (fixture.options_overrides?.invalid_signal) overrides.signal = {};
    if (fixture.options_overrides?.unexpected) overrides.unexpected = true;
    const result = await invokeCursorProvider(
      catalog.defaults,
      invokeOptions(providerRuntime, overrides),
    );
    assert.equal(result.state, fixture.expected.state, fixture.id);
    assert.ok(result.blockers.includes(fixture.expected.blocker), fixture.id);
    assert.deepEqual(resolutions, [], fixture.id);
    assert.deepEqual(spawns, [], fixture.id);
  }
});

test('a rejected supervision Promise with a malformed child event surface still kills and reaps the owned tree', async () => {
  const fixture = catalog.invoke_cases.find(
    (entry) => entry.options_overrides?.malformed_child_event_surface,
  );
  assert.ok(fixture);
  const resolutions: string[] = [];
  const spawns: ProviderSpawnSpec[] = [];
  const signals: NodeJS.Signals[] = [];
  let alive = true;
  let exitCode: number | null = null;
  let signalCode: NodeJS.Signals | null = null;
  const providerRuntime = runtime(resolutions, spawns);
  providerRuntime.process.spawnProvider = (spec) => {
    spawns.push(structuredClone(spec));
    const malformedChild = {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      pid: undefined,
      get exitCode() {
        return exitCode;
      },
      get signalCode() {
        return signalCode;
      },
    } as unknown as ChildProcess;
    return {
      child: malformedChild,
      tree: {
        schema: PROVIDER_PROCESS_TREE_SCHEMA,
        kind: 'posix-process-group',
        groupId: 1,
        signal(signal) {
          signals.push(signal);
          if (signal === 'SIGKILL') {
            alive = false;
            exitCode = null;
            signalCode = signal;
          }
          return true;
        },
        isAlive: () => alive,
      },
    };
  };
  const startedAt = Date.now();
  const result = await invokeCursorProvider(catalog.defaults, invokeOptions(providerRuntime));
  assert.ok(Date.now() - startedAt < 1_000, 'cleanup exceeded its bounded fixture budget');
  assert.deepEqual(resolutions, ['cursor-agent']);
  assert.equal(spawns.length, 1);
  assert.equal(result.state, fixture.expected.state);
  assert.ok(result.blockers.includes(fixture.expected.blocker));
  assert.equal(result.blockers.includes('transport.spawn-failed'), false);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(result.transport.signal, 'SIGKILL');
  assert.equal(result.transport.reaped, true);
  assert.equal(alive, false);
});

test('a synchronous supervisor handoff failure still terminates and reaps the owned child', async () => {
  const resolutions: string[] = [];
  const spawns: ProviderSpawnSpec[] = [];
  const signals: NodeJS.Signals[] = [];
  let alive = true;
  const providerRuntime = runtime(resolutions, spawns);
  providerRuntime.process.spawnProvider = (spec) => {
    spawns.push(structuredClone(spec));
    const owned = fakeOwnedChild(spec, {});
    const originalSignal = owned.tree?.signal.bind(owned.tree);
    assert.ok(owned.tree && originalSignal);
    owned.tree.signal = (signal) => {
      signals.push(signal);
      alive = false;
      return originalSignal(signal);
    };
    owned.tree.isAlive = () => alive;
    Object.defineProperty(owned.tree, 'groupId', { value: 0 });
    return owned;
  };
  const result = await invokeCursorProvider(catalog.defaults, invokeOptions(providerRuntime));
  assert.equal(spawns.length, 1);
  assert.deepEqual(resolutions, ['cursor-agent']);
  assert.equal(result.state, 'failed');
  assert.ok(result.blockers.includes('transport.supervisor-handoff-failed'));
  assert.ok(signals.includes('SIGTERM'));
  assert.equal(result.transport.reaped, true);
  assert.equal(alive, false);
});
