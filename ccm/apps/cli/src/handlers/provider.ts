// provider.ts — Codex read-only candidate inspection + one gated execution.
//
// This is deliberately a production handler rather than a fixture adapter: the only provider
// seam is ctx.providerRuntime.  It compiles the documented Codex argv, probes live app-server
// facts, preserves all quota windows, and fails closed on unknown admission/actual identity.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as io from '../io.js';
import {
  assessCodexCapability,
  type CodexCapabilityAssessment,
  type CodexTextProbe,
} from '../provider-capability.js';
import {
  createProviderRequestDeadline,
  type ProviderChildLimits,
  type ProviderChildResult,
  ProviderChildSupervisorError,
  type ProviderRequestDeadline,
  superviseProviderChild,
} from '../provider-child-supervisor.js';
import {
  compileCodexChildEnvironment,
  createCompiledInvocationAudit,
  createProviderEvidence,
  type ProviderBinaryIdentity,
  type ProviderEvidence,
  redactProviderDiagnostic,
  sha256Canonical,
} from '../provider-evidence.js';
import {
  type CompiledProviderOutputSchema,
  compileProviderOutputSchema,
  ProviderJsonSchemaError,
} from '../provider-json-schema.js';
import { providerModelFacts } from '../provider-model-facts.js';
import {
  assertCodexQualificationDispatcher,
  CODEX_QUALIFICATION_PHASE_REGISTRY,
  type CodexQualificationFailureOutcome,
  type CodexQualificationPhase,
  finalizeCodexQualificationFailure,
  isCodexQualificationEvidenceMethod,
} from '../provider-qualification.js';
import type { ProviderRuntime } from '../provider-runtime.js';
import type { Ctx } from './_common.js';

const RESULT_SCHEMA = 'ccm/codex-provider-inspection/v1';
const CONTRACT = 'ccm/codex-candidate-provider-driver/v1';
const IDENTITY_EVENT_SCHEMA = 'ccm/codex-provider-identity-event/v1';
const BUCKET_SCHEMA = 'ccm/codex-quota-bucket-reference/v1';
const ROLLING_SCHEMA = 'ccm/codex-rolling-24h-derivation/v1';
const MAX_TIMEOUT_MS = 600_000;
const MAX_JSONL_BYTES = 1_048_576;
const MAX_JSONL_LINE_BYTES = 1_048_576;
const MAX_JSONL_EVENTS = 10_000;
const MAX_STRUCTURED_OUTPUT_BYTES = 1_048_576;
const MAX_STDERR_CAPTURE_BYTES = 65_536;
const MAX_STDERR_EXCERPT_BYTES = 4_096;
const MAX_CAPABILITY_TEXT_BYTES = 512 * 1024;
const MAX_CAPABILITY_SCHEMA_BYTES = 2 * 1024 * 1024;
const TERMINATION_GRACE_MS = 50;
const REAP_TIMEOUT_MS = 500;
const APP_SERVER_EVIDENCE_TTL_MS = 60_000;
const PREDICATE_IDS = [
  'binary-available',
  'behavioral-capability-proven',
  'auth-fresh',
  'entitlement-fresh',
  'registry-allowed',
  'model-exact',
  'effort-exact',
  'quota-7d-ample',
  'permission-read-only',
  'approval-never',
  'account-mutation-forbidden',
  'credential-write-forbidden',
] as const;

type Json = Record<string, any>;
type PredicateId = (typeof PREDICATE_IDS)[number];
type Predicate = {
  id: PredicateId;
  passed: boolean;
  reason_code: string;
  evidence_ids: string[];
};
type PredicateEvidenceBindings = Partial<Record<PredicateId, string[]>>;
type TimeoutPhase = 'startup' | 'idle' | 'hard';

export function facts(ctx: Ctx): number {
  const provider = ctx.positionals[0] ?? '';
  const asOf =
    typeof ctx.values['as-of'] === 'string' ? ctx.values['as-of'] : new Date().toISOString();
  ctx.out(`${io.jsonOk(providerModelFacts(provider, asOf))}\n`);
  return io.EXIT.OK;
}

function plain(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (plain(value))
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(canonical(value)))
    .digest('hex');
}

function parseRequest(ctx: Ctx): Json {
  const raw = ctx.values.request;
  const spec = typeof raw === 'string' ? raw : '';
  if (!spec) throw new Error('provider inspect requires --request');
  const bytes = spec.startsWith('@') ? fs.readFileSync(spec.slice(1), 'utf8') : spec;
  const value = JSON.parse(bytes);
  if (!plain(value)) throw new Error('provider request must be a JSON object');
  return value;
}

function now(ctx: Ctx): string {
  const supplied = ctx.env.CCM_CODEX_PROVIDER_NOW;
  return supplied && !Number.isNaN(Date.parse(supplied)) ? supplied : new Date().toISOString();
}

function exitResult(
  ctx: Ctx,
  request: Json,
  requestedEvidence: ProviderEvidence,
  error: string | Json,
  predicates: Predicate[],
  evidenceList: ProviderEvidence[] = [requestedEvidence],
): number {
  const normalizedError = typeof error === 'string' ? { code: error } : error;
  const reason = String(normalizedError.code);
  const data = {
    schema: RESULT_SCHEMA,
    contract: CONTRACT,
    request_id: request.request_id ?? null,
    provider: 'codex',
    candidate: { automatic_eligible: false, reason_codes: [reason], predicates },
    execution: emptyExecution(),
    identity: {
      requested: {
        model: request.model ?? null,
        effort: request.effort ?? null,
        evidence_id: requestedEvidence.evidence_id,
      },
      resolved: null,
      actual: null,
    },
    quota: {
      admission_7d: 'unknown',
      five_hour_effect: 'ignored',
      buckets: [],
      rolling_24h: unavailableRolling(null, null, null),
    },
    evidence: evidenceList,
    side_effects: {
      board_writes: 0,
      remote_mutations: 0,
      account_mutations: 0,
      credential_writes: 0,
    },
    result: { status: 'rejected', output: null },
    error: normalizedError,
  };
  assertPredicateEvidence(predicates, evidenceList);
  ctx.out(`${JSON.stringify({ ok: true, data })}\n`);
  return 0;
}

function predicatesFor(
  passed: Partial<Record<PredicateId, boolean>>,
  bindings: PredicateEvidenceBindings,
  failedReasons: Partial<Record<PredicateId, string>> = {},
): Predicate[] {
  return PREDICATE_IDS.map((id) => ({
    id,
    passed: passed[id] === true,
    reason_code:
      passed[id] === true
        ? 'predicate_passed'
        : passed[id] === false
          ? (failedReasons[id] ?? 'predicate_failed')
          : 'not_evaluated',
    evidence_ids: passed[id] === undefined ? [] : [...(bindings[id] ?? [])],
  }));
}

function policyEvidenceBindings(
  passed: Partial<Record<PredicateId, boolean>>,
  requestEvidenceId: string,
): PredicateEvidenceBindings {
  const result: PredicateEvidenceBindings = {};
  for (const id of [
    'permission-read-only',
    'approval-never',
    'account-mutation-forbidden',
    'credential-write-forbidden',
  ] as const)
    if (passed[id] !== undefined) result[id] = [requestEvidenceId];
  return result;
}

function evidenceAllowedForPredicate(predicate: PredicateId, item: ProviderEvidence): boolean {
  const method = item.source.method;
  switch (predicate) {
    case 'binary-available':
      return (
        item.kind === 'binary-capability' &&
        (['ccm-provider-runtime/resolveExecutable', 'codex-capability/assess'].includes(method) ||
          isCodexQualificationEvidenceMethod(method))
      );
    case 'behavioral-capability-proven':
      return (
        item.kind === 'binary-capability' &&
        (method === 'codex-capability/assess' || isCodexQualificationEvidenceMethod(method))
      );
    case 'auth-fresh':
      return item.kind === 'auth' && method === 'account/read';
    case 'entitlement-fresh':
    case 'model-exact':
      return item.kind === 'entitlement' && method === 'model/list';
    case 'registry-allowed':
      return item.kind === 'model-catalog' && method === 'ccm-model-registry/read';
    case 'effort-exact':
      return (
        (item.kind === 'entitlement' && method === 'model/list') ||
        (item.kind === 'model-catalog' && method === 'ccm-model-registry/read')
      );
    case 'quota-7d-ample':
      return item.kind === 'quota' && method === 'account/rateLimits/read';
    case 'permission-read-only':
    case 'approval-never':
    case 'account-mutation-forbidden':
    case 'credential-write-forbidden':
      return item.kind === 'execution' && method === 'ccm-provider-inspect/request';
  }
}

function assertPredicateEvidence(predicates: Predicate[], evidenceList: ProviderEvidence[]): void {
  const byId = new Map(evidenceList.map((item) => [item.evidence_id, item]));
  for (const predicate of predicates) {
    if (predicate.passed && predicate.evidence_ids.length === 0)
      throw new Error(`passed provider predicate lacks evidence: ${predicate.id}`);
    if (predicate.reason_code !== 'not_evaluated' && predicate.evidence_ids.length === 0)
      throw new Error(`evaluated provider predicate lacks evidence: ${predicate.id}`);
    for (const evidenceId of predicate.evidence_ids) {
      const item = byId.get(evidenceId);
      if (!item) throw new Error(`provider predicate cites missing evidence: ${predicate.id}`);
      if (!evidenceAllowedForPredicate(predicate.id, item))
        throw new Error(`provider predicate cites wrong evidence facet: ${predicate.id}`);
      if (
        predicate.id === 'binary-available' &&
        predicate.passed &&
        item.source.method === 'ccm-provider-runtime/resolveExecutable'
      )
        throw new Error('negative executable resolution evidence cannot support a pass');
    }
  }
}

function emptyExecution(): Json {
  return {
    attempted: false,
    invocation_compiled: false,
    parser_exercised: false,
    invocation: null,
    terminal_count: 0,
    timeout_phase: null,
    cancel_observed: false,
    stdout: { bytes_seen: 0, limit_bytes: MAX_JSONL_BYTES, truncated: false },
    stderr: { excerpt: '', limit_bytes: MAX_STDERR_EXCERPT_BYTES, truncated: false },
  };
}

function requestValidationError(request: Json): Json | null {
  if (typeof request.request_id !== 'string' || request.request_id.trim().length === 0)
    return {
      code: 'request_schema_invalid',
      field: 'request_id',
      reason: 'required_nonempty_string',
    };
  if (!plain(request.timeouts_ms))
    return {
      code: 'request_schema_invalid',
      field: 'timeouts_ms',
      reason: 'required_object',
    };
  for (const phase of ['startup', 'idle', 'hard'] as const) {
    const value = request.timeouts_ms[phase];
    if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMEOUT_MS)
      return {
        code: 'request_schema_invalid',
        field: `timeouts_ms.${phase}`,
        reason: 'required_positive_bounded_integer',
      };
  }
  return null;
}

function childLimits(
  request: Json,
  stdoutLimitBytes: number,
  stderrLimitBytes = MAX_STDERR_CAPTURE_BYTES,
): ProviderChildLimits {
  return {
    startupTimeoutMs: Number(request.timeouts_ms.startup),
    idleTimeoutMs: Number(request.timeouts_ms.idle),
    stdoutLimitBytes,
    stderrLimitBytes,
    terminationGraceMs: TERMINATION_GRACE_MS,
    reapTimeoutMs: REAP_TIMEOUT_MS,
  };
}

interface ProviderChildInvocation {
  operation: string;
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  input?: string;
  signal?: AbortSignal;
  stdoutLimitBytes: number;
  stderrLimitBytes?: number;
  onStdoutText?: (text: string) => void;
  onStderrText?: (text: string) => void;
  onStarted?: (write: (text: string) => void, end: () => void) => void;
}

async function runProviderChild(
  runtime: ProviderRuntime,
  executable: string,
  request: Json,
  deadline: ProviderRequestDeadline,
  invocation: ProviderChildInvocation,
): Promise<ProviderChildResult> {
  const ownedChild = runtime.process.spawnProvider({
    executable,
    argv: invocation.argv,
    cwd: invocation.cwd,
    env: invocation.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const { child } = ownedChild;
  child.stdin?.on('error', () => {
    // A supervised child may reject input and close first; its exit/transport result remains the
    // canonical failure rather than an unhandled host-side EPIPE.
  });
  const supervised = superviseProviderChild(ownedChild, {
    operation: invocation.operation,
    deadline,
    limits: childLimits(
      request,
      invocation.stdoutLimitBytes,
      invocation.stderrLimitBytes ?? MAX_STDERR_CAPTURE_BYTES,
    ),
    signal: invocation.signal,
    onStdoutText: invocation.onStdoutText,
    onStderrText: invocation.onStderrText,
    onStarted: () => {
      if (invocation.onStarted) {
        invocation.onStarted(
          (text) => {
            child.stdin?.write(text);
          },
          () => child.stdin?.end(),
        );
      } else child.stdin?.end(invocation.input);
    },
  });
  return await supervised;
}

async function textProbe(
  runtime: ProviderRuntime,
  executable: string,
  request: Json,
  deadline: ProviderRequestDeadline,
  operation: string,
  argv: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<CodexTextProbe> {
  const result = await runProviderChild(runtime, executable, request, deadline, {
    operation,
    argv,
    cwd,
    env,
    stdoutLimitBytes: MAX_CAPABILITY_TEXT_BYTES,
  });
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function readBoundedUtf8File(filePath: string): string | undefined {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_CAPABILITY_SCHEMA_BYTES) return undefined;
    const bytes = fs.readFileSync(filePath);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function capabilityProbePayload(
  assessment: CodexCapabilityAssessment,
  probes: Record<string, CodexTextProbe>,
  parseOnly: CodexTextProbe,
  schemaBundle: Record<string, string | undefined>,
): Json {
  const transcript = Object.fromEntries(
    Object.entries(probes).map(([phase, probe]) => [
      phase,
      {
        exit_code: probe.exitCode,
        signal: probe.signal,
        stdout_sha256: digest(probe.stdout),
        stderr_sha256: digest(redactProviderDiagnostic(probe.stderr)),
      },
    ]),
  );
  return {
    schema: assessment.schema,
    assessment,
    transcript,
    parse_only: {
      exit_code: parseOnly.exitCode,
      signal: parseOnly.signal,
      stdout_sha256: digest(parseOnly.stdout),
      stderr_sha256: digest(redactProviderDiagnostic(parseOnly.stderr)),
    },
    generated_schema_sha256: Object.fromEntries(
      Object.entries(schemaBundle).map(([name, value]) => [
        name,
        value === undefined ? null : digest(value),
      ]),
    ),
  };
}

function boundedUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maxBytes) return value;
  return bytes
    .subarray(0, maxBytes)
    .toString('utf8')
    .replace(/\uFFFD$/u, '');
}

function redactEvent(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[REDACTED_DEPTH]';
  if (Array.isArray(value)) return value.slice(0, 64).map((item) => redactEvent(item, depth + 1));
  if (!plain(value))
    return typeof value === 'string' ? boundedUtf8(redactProviderDiagnostic(value), 1_024) : value;
  const entries = Object.entries(value).slice(0, 64);
  return Object.fromEntries(
    entries.map(([key, child]) => [
      key,
      /token|password|secret|credential|authorization|cookie/iu.test(key)
        ? '[REDACTED]'
        : redactEvent(child, depth + 1),
    ]),
  );
}

class CodexJsonlParser {
  bytesSeen = 0;
  truncated = false;
  terminalCount = 0;
  metadata: Json | null = null;
  providerError: Json | null = null;
  unknownEvents: Json[] = [];
  private buffer = '';
  private eventCount = 0;
  private threadId: string | null = null;
  private turnId: string | null = null;
  private terminalType: 'turn.completed' | 'turn.failed' | null = null;
  private streamError: 'stream_malformed' | 'terminal_duplicate' | null = null;

  constructor(private readonly identityEventType: string) {}

  push(chunk: string): boolean {
    const chunkBytes = Buffer.byteLength(chunk, 'utf8');
    const remaining = Math.max(0, MAX_JSONL_BYTES - this.bytesSeen);
    this.bytesSeen += chunkBytes;
    const accepted = chunkBytes > remaining ? boundedUtf8(chunk, remaining) : chunk;
    this.buffer += accepted;
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_JSONL_LINE_BYTES) {
      this.truncated = true;
      this.streamError = 'stream_malformed';
      this.buffer = '';
      return false;
    }
    while (this.buffer.includes('\n')) {
      const index = this.buffer.indexOf('\n');
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (line.trim()) this.parseLine(line);
    }
    if (chunkBytes > remaining) {
      this.truncated = true;
      this.streamError = 'stream_malformed';
      this.buffer = '';
      return false;
    }
    return this.eventCount <= MAX_JSONL_EVENTS;
  }

  finish(): void {
    if (this.buffer.trim() && !this.truncated) this.parseLine(this.buffer);
    this.buffer = '';
  }

  errorCode(): string | null {
    if (this.providerError) return 'provider_failed';
    if (this.streamError) return this.streamError;
    if (this.terminalCount === 0) return 'terminal_missing';
    if (this.terminalCount > 1) return 'terminal_duplicate';
    if (this.terminalType === 'turn.failed') return 'provider_failed';
    return null;
  }

  private invalidate(code: 'stream_malformed' | 'terminal_duplicate' = 'stream_malformed'): void {
    if (!this.streamError || code === 'terminal_duplicate') this.streamError = code;
  }

  private nonemptyId(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private parseLine(line: string): void {
    this.eventCount += 1;
    if (this.eventCount > MAX_JSONL_EVENTS) {
      this.truncated = true;
      this.invalidate();
      return;
    }
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      this.invalidate();
      return;
    }
    if (!plain(event) || typeof event.type !== 'string') {
      this.invalidate();
      return;
    }
    if (event.type === this.identityEventType) {
      if (!this.threadId || !this.turnId || this.terminalCount > 0 || this.metadata)
        this.invalidate();
      else this.metadata = event;
      return;
    }
    switch (event.type) {
      case 'thread.started': {
        const id = this.nonemptyId(event.thread_id);
        if (!id || this.threadId || this.turnId || this.terminalCount > 0) this.invalidate();
        else this.threadId = id;
        break;
      }
      case 'turn.started': {
        const id = this.nonemptyId(event.turn_id);
        if (!id || !this.threadId || this.turnId || this.terminalCount > 0) this.invalidate();
        else this.turnId = id;
        break;
      }
      case 'item.started':
      case 'item.updated':
      case 'item.completed':
        if (!this.threadId || !this.turnId || this.terminalCount > 0) this.invalidate();
        break;
      case 'turn.completed':
      case 'turn.failed': {
        this.terminalCount += 1;
        const id = this.nonemptyId(event.turn_id);
        if (!this.threadId || !this.turnId || !id || id !== this.turnId) this.invalidate();
        if (this.terminalCount > 1) this.invalidate('terminal_duplicate');
        else this.terminalType = event.type;
        break;
      }
      case 'error':
        if (!this.providerError) this.providerError = event;
        break;
      default:
        this.unknownEvents.push(redactEvent(event) as Json);
    }
  }
}

function verifiedIdentityMetadata(metadata: Json | null): Json | null {
  if (!metadata || metadata.schema !== IDENTITY_EVENT_SCHEMA) return null;
  if (typeof metadata.model !== 'string' || metadata.model.trim().length === 0) return null;
  if (
    metadata.effort !== undefined &&
    metadata.effort !== null &&
    (typeof metadata.effort !== 'string' || metadata.effort.trim().length === 0)
  )
    return null;
  return metadata;
}

function readStructuredOutput(outputPath: string, schema: CompiledProviderOutputSchema): unknown {
  const stat = fs.statSync(outputPath);
  if (!stat.isFile() || stat.size > MAX_STRUCTURED_OUTPUT_BYTES) throw new Error('invalid output');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(outputPath));
  const value = JSON.parse(text);
  schema.assertValid(value);
  return value;
}

class AppServerProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppServerProtocolError';
  }
}

async function appServer(
  runtime: ProviderRuntime,
  executable: string,
  request: Json,
  deadline: ProviderRequestDeadline,
  cwd: string,
  env: Record<string, string>,
): Promise<{ auth: Json; entitlement: Json; quota: Json }> {
  const methods = new Map([
    [1, 'initialize'],
    [2, 'account/read'],
    [3, 'model/list'],
    [4, 'account/rateLimits/read'],
  ]);
  const replies = new Map<number, Json>();
  let buffer = '';
  let writeRequest: ((text: string) => void) | null = null;
  let endInput: (() => void) | null = null;

  const send = (id: number, method: string, params: Json = {}): void => {
    if (!writeRequest) throw new AppServerProtocolError('app-server stdin is unavailable');
    writeRequest(`${JSON.stringify({ id, method, params })}\n`);
  };
  const parseLine = (line: string): void => {
    if (!line.trim()) return;
    let reply: unknown;
    try {
      reply = JSON.parse(line);
    } catch {
      throw new AppServerProtocolError('app-server emitted malformed JSONL');
    }
    if (!plain(reply)) throw new AppServerProtocolError('app-server reply must be an object');
    if (!Object.hasOwn(reply, 'id')) return;
    const id = Number(reply.id);
    const method = methods.get(id);
    if (!method || replies.has(id))
      throw new AppServerProtocolError('app-server reply id is unbound or duplicate');
    if (Object.hasOwn(reply, 'error'))
      throw new AppServerProtocolError(`app-server ${method} returned JSON-RPC error`);
    if (!Object.hasOwn(reply, 'result') || !plain(reply.result))
      throw new AppServerProtocolError(`app-server ${method} result is missing or invalid`);
    replies.set(id, reply.result);
    if (id === 1) {
      if (!writeRequest) throw new AppServerProtocolError('app-server stdin is unavailable');
      writeRequest(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
      send(2, 'account/read');
      send(3, 'model/list');
      send(4, 'account/rateLimits/read');
    }
    if (replies.size === methods.size) endInput?.();
  };
  const consume = (text: string): void => {
    buffer += text;
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n');
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      parseLine(line);
    }
  };

  const result = await runProviderChild(runtime, executable, request, deadline, {
    operation: 'app-server',
    argv: ['app-server', '--listen', 'stdio://'],
    cwd,
    env,
    stdoutLimitBytes: MAX_JSONL_BYTES,
    onStdoutText: consume,
    onStarted: (write, end) => {
      writeRequest = write;
      endInput = end;
      send(1, 'initialize', {
        clientInfo: { name: 'ccm', title: 'ccm', version: '0.20.0' },
      });
    },
  });
  if (buffer.trim()) parseLine(buffer);
  if (result.exitCode !== 0 || result.signal !== null)
    throw new AppServerProtocolError('app-server exited unsuccessfully');
  for (const id of methods.keys())
    if (!replies.has(id)) throw new AppServerProtocolError(`app-server reply ${id} is missing`);
  return {
    auth: replies.get(2) as Json,
    entitlement: replies.get(3) as Json,
    quota: replies.get(4) as Json,
  };
}

function pointerEscape(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}
function quotaBuckets(quota: Json, quotaEvidence: Json, envelope: Json): Json[] {
  const rows: Array<{ schema: string; path: string; row: Json }> = [];
  if (plain(quota.rateLimits))
    rows.push({ schema: 'legacy-rateLimits', path: '/rateLimits', row: quota.rateLimits });
  if (plain(quota.rateLimitsByLimitId))
    for (const [id, row] of Object.entries(quota.rateLimitsByLimitId))
      if (plain(row))
        rows.push({
          schema: 'rateLimitsByLimitId',
          path: `/rateLimitsByLimitId/${pointerEscape(id)}`,
          row,
        });
  const result: Json[] = [];
  for (const { schema, path: rowPath, row } of rows)
    for (const role of ['primary', 'secondary']) {
      const window = row[role];
      if (!plain(window)) continue;
      const source_path = `${rowPath}/${role}`;
      result.push({
        bucket_id: `bucket-${digest({ schema: BUCKET_SCHEMA, source_evidence_id: quotaEvidence.evidence_id, source_revision: quotaEvidence.source.revision, source_path })}`,
        provider_limit_id: row.limitId ?? 'legacy-single',
        limit_name: row.limitName ?? null,
        credential_id: row.credentialId ?? 'unknown',
        account_id: row.accountId ?? 'unknown',
        payer_id: row.payerId ?? 'unknown',
        pool_id: row.poolId ?? 'unknown',
        shared_scope: row.sharedScope ?? 'unknown',
        unit: row.unit ?? 'unknown',
        window: {
          duration_minutes: window.windowDurationMins ?? null,
          used_percent: window.usedPercent ?? null,
          resets_at:
            typeof window.resetsAt === 'number'
              ? new Date(window.resetsAt * 1000).toISOString()
              : null,
        },
        rate_limit_reached_type: row.rateLimitReachedType ?? null,
        observed_at: envelope.observed_at,
        valid_until: envelope.valid_until,
        freshness: envelope.freshness,
        source_method: 'account/rateLimits/read',
        source_schema: schema,
        source_evidence_id: quotaEvidence.evidence_id,
        source_payload_sha256: quotaEvidence.payload_sha256,
        source_revision: quotaEvidence.source.revision,
        source_path,
      });
    }
  return result.sort((a, b) => String(a.source_path).localeCompare(String(b.source_path)));
}

function unavailableRolling(
  quotaEvidence: Json | null,
  sourceRevision: string | null,
  history: unknown,
): Json {
  const common = {
    advisory_only: true,
    source_evidence_ids: quotaEvidence ? [quotaEvidence.evidence_id] : [],
    source_payload_sha256: quotaEvidence?.payload_sha256 ?? null,
    source_revision: sourceRevision,
  };
  const output = {
    status: 'unavailable',
    ...common,
    delta_percent_points: null,
    elapsed_hours: null,
    daily_budget_percent_points: null,
    burn_ratio: null,
    coverage: null,
    confidence: 'unavailable',
  };
  return {
    ...output,
    derivation_sha256: digest({
      schema: ROLLING_SCHEMA,
      algorithm: 'codex-seven-day-snapshot-delta/v1',
      source: common,
      history: history ?? [],
      output,
    }),
  };
}
function rolling24(quotaEnvelope: Json, quotaEvidence: Json): Json {
  const history = quotaEnvelope.seven_day_history;
  if (
    quotaEnvelope.freshness !== 'fresh' ||
    !Array.isArray(history) ||
    !plain(history[0]) ||
    !plain(history[1])
  )
    return unavailableRolling(quotaEvidence, quotaEvidence.source.revision, history);
  const common = {
    advisory_only: true,
    source_evidence_ids: [quotaEvidence.evidence_id],
    source_payload_sha256: quotaEvidence.payload_sha256,
    source_revision: quotaEvidence.source.revision,
  };
  const elapsed_hours =
    (Date.parse(String(history[1].observed_at)) - Date.parse(String(history[0].observed_at))) /
    3_600_000;
  const delta_percent_points = Number(history[1].used_percent) - Number(history[0].used_percent);
  const daily_budget_percent_points = 100 / 7;
  const output = {
    status: 'available',
    ...common,
    delta_percent_points,
    elapsed_hours,
    daily_budget_percent_points,
    burn_ratio: delta_percent_points / (elapsed_hours / 24) / daily_budget_percent_points,
    coverage: 1,
    confidence: 'high',
  };
  return {
    ...output,
    derivation_sha256: digest({
      schema: ROLLING_SCHEMA,
      algorithm: 'codex-seven-day-snapshot-delta/v1',
      source: common,
      history,
      output,
    }),
  };
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function normalizedAuthState(payload: Json): 'authenticated' | 'unauthenticated' | 'unknown' {
  if (payload.authState === 'authenticated' || payload.authState === 'unauthenticated')
    return payload.authState;
  if (plain(payload.account)) return 'authenticated';
  if (payload.account === null) return 'unauthenticated';
  return 'unknown';
}

function quotaAdmission(quota: Json, freshness: string): string {
  if (freshness === 'hard-stale') return 'hard-stale';
  if (freshness !== 'fresh') return 'unknown';
  const windows: number[] = [];
  const rows = [
    ...(plain(quota.rateLimits) ? [quota.rateLimits] : []),
    ...(plain(quota.rateLimitsByLimitId) ? Object.values(quota.rateLimitsByLimitId) : []),
  ];
  for (const row of rows) {
    if (!plain(row)) continue;
    for (const role of ['primary', 'secondary']) {
      const window = row[role];
      if (
        plain(window) &&
        window.windowDurationMins === 10_080 &&
        typeof window.usedPercent === 'number' &&
        Number.isFinite(window.usedPercent)
      )
        windows.push(window.usedPercent);
    }
  }
  if (windows.length === 0) return 'unknown';
  const used = Math.max(...windows);
  if (used >= 90) return 'exhausted';
  if (used >= 80) return 'tight';
  return 'ample';
}

function sourceEnvelope(
  payload: Json,
  facet: 'auth' | 'entitlement' | 'quota',
  observedNow: string,
): Json {
  const observedProvided = Object.hasOwn(payload, 'observedAt');
  const expiresProvided = Object.hasOwn(payload, 'expiresAt');
  const providerTimesValid =
    validTimestamp(payload.observedAt) && validTimestamp(payload.expiresAt);
  const providerTimesAbsent = !observedProvided && !expiresProvided;
  const observationMs = Date.parse(observedNow);
  const observedAt = validTimestamp(payload.observedAt) ? payload.observedAt : observedNow;
  const validUntil = providerTimesValid
    ? payload.expiresAt
    : providerTimesAbsent && Number.isFinite(observationMs)
      ? new Date(observationMs + APP_SERVER_EVIDENCE_TTL_MS).toISOString()
      : null;
  const freshness = providerTimesValid
    ? Date.parse(payload.observedAt) > observationMs
      ? 'unknown'
      : Date.parse(payload.expiresAt) >= observationMs
        ? 'fresh'
        : 'hard-stale'
    : providerTimesAbsent && Number.isFinite(observationMs)
      ? 'fresh'
      : 'unknown';
  const complete =
    facet === 'auth'
      ? typeof payload.requiresOpenaiAuth === 'boolean' &&
        Object.hasOwn(payload, 'account') &&
        (payload.account === null || plain(payload.account))
      : facet === 'entitlement'
        ? Array.isArray(payload.data) && Object.hasOwn(payload, 'nextCursor')
        : plain(payload.rateLimits) || plain(payload.rateLimitsByLimitId);
  return {
    observed_at: observedAt,
    valid_until: validUntil,
    freshness,
    completeness: complete ? 'complete' : 'partial',
    ...(facet === 'quota'
      ? {
          admission_7d: quotaAdmission(payload, freshness),
          seven_day_history: Array.isArray(payload.sevenDayHistory)
            ? payload.sevenDayHistory
            : null,
        }
      : {}),
  };
}

export async function inspect(ctx: Ctx): Promise<number> {
  const request = parseRequest(ctx);
  const requestEvidence = createProviderEvidence(
    { binaryRealpath: null, binaryVersion: null },
    {
      kind: 'execution',
      surface: 'cli-headless',
      method: 'ccm-provider-inspect/request',
      revision: String(request.schema),
      schemaVersion: typeof request.schema === 'string' ? request.schema : null,
      payload: request,
      observedAt: now(ctx),
      validUntil: null,
      freshness: 'fresh',
      completeness: 'complete',
    },
  );
  const validationError = requestValidationError(request);
  if (validationError)
    return exitResult(ctx, request, requestEvidence, validationError, predicatesFor({}, {}));
  const permission = plain(request.permission) ? request.permission : {};
  const policyPassed: Partial<Record<PredicateId, boolean>> = {
    'permission-read-only': permission.sandbox === 'read-only',
    'approval-never': permission.approval === 'never',
    'account-mutation-forbidden': permission.account_mutation === 'forbidden',
    'credential-write-forbidden': permission.credential_write === 'forbidden',
  };
  const policyReasons: Partial<Record<PredicateId, string>> = {
    'permission-read-only': 'permission_read_only_required',
    'approval-never': 'approval_never_required',
    'account-mutation-forbidden': 'account_mutation_forbidden',
    'credential-write-forbidden': 'credential_write_forbidden',
  };
  const policyError =
    ctx.positionals[0] !== 'codex'
      ? 'provider_unsupported'
      : request.schema !== 'ccm/codex-provider-inspect-request/v1' || request.provider !== 'codex'
        ? 'request_schema_invalid'
        : request.model === 'auto' || !request.model
          ? 'model_auto_forbidden'
          : request.effort === 'auto' || !request.effort
            ? 'model_auto_forbidden'
            : typeof request.workspace !== 'string' || !path.isAbsolute(request.workspace)
              ? 'workspace_invalid'
              : typeof request.prompt !== 'string' ||
                  (typeof request.output_schema !== 'boolean' && !plain(request.output_schema))
                ? 'request_schema_invalid'
                : permission.network !== 'provider-only'
                  ? 'network_policy_required'
                  : !policyPassed['permission-read-only']
                    ? 'permission_read_only_required'
                    : !policyPassed['approval-never']
                      ? 'approval_never_required'
                      : !policyPassed['account-mutation-forbidden']
                        ? 'account_mutation_forbidden'
                        : !policyPassed['credential-write-forbidden']
                          ? 'credential_write_forbidden'
                          : null;
  if (policyError)
    return exitResult(
      ctx,
      request,
      requestEvidence,
      policyError,
      predicatesFor(
        policyPassed,
        policyEvidenceBindings(policyPassed, requestEvidence.evidence_id),
        policyReasons,
      ),
    );

  let outputSchemaValidator: CompiledProviderOutputSchema;
  try {
    outputSchemaValidator = compileProviderOutputSchema(request.output_schema);
  } catch (error) {
    if (!(error instanceof ProviderJsonSchemaError)) throw error;
    return exitResult(
      ctx,
      request,
      requestEvidence,
      {
        code: 'request_schema_invalid',
        field: 'output_schema',
        reason: error.code,
        schema_path: error.schemaPath,
      },
      predicatesFor(
        policyPassed,
        policyEvidenceBindings(policyPassed, requestEvidence.evidence_id),
        policyReasons,
      ),
    );
  }

  const runtime = ctx.providerRuntime;
  if (!runtime || runtime.schema !== 'ccm/provider-runtime-capabilities/v1')
    return exitResult(
      ctx,
      request,
      requestEvidence,
      'provider_runtime_unavailable',
      predicatesFor(
        policyPassed,
        policyEvidenceBindings(policyPassed, requestEvidence.evidence_id),
        policyReasons,
      ),
    );
  const childEnv = compileCodexChildEnvironment(ctx.env);
  const resolvedExecutable = runtime.process.resolveExecutable('codex');
  let executable: string | null = null;
  try {
    if (resolvedExecutable) {
      const realpath = fs.realpathSync(resolvedExecutable);
      const stat = fs.statSync(realpath);
      fs.accessSync(realpath, fs.constants.X_OK);
      if (stat.isFile() && path.isAbsolute(realpath)) executable = realpath;
    }
  } catch {
    executable = null;
  }
  if (!executable) {
    const resolutionFailureEvidence = createProviderEvidence(
      { binaryRealpath: null, binaryVersion: null },
      {
        kind: 'binary-capability',
        surface: 'cli-headless',
        method: 'ccm-provider-runtime/resolveExecutable',
        revision: 'ccm/provider-runtime-capabilities/v1',
        schemaVersion: null,
        payload: { resolved: null },
        observedAt: now(ctx),
        validUntil: null,
        freshness: 'unknown',
        completeness: 'complete',
      },
    );
    return exitResult(
      ctx,
      request,
      requestEvidence,
      'binary_unavailable',
      predicatesFor(
        { ...policyPassed, 'binary-available': false },
        {
          ...policyEvidenceBindings(policyPassed, requestEvidence.evidence_id),
          'binary-available': [resolutionFailureEvidence.evidence_id],
        },
        { ...policyReasons, 'binary-available': 'binary_unavailable' },
      ),
      [requestEvidence, resolutionFailureEvidence],
    );
  }
  const workspace = typeof request.workspace === 'string' ? request.workspace : process.cwd();
  const deadline = createProviderRequestDeadline(Number(request.timeouts_ms.hard));
  const temp = fs.mkdtempSync(path.join(childEnv.TMPDIR as string, 'ccm-codex-provider-'));
  const schemaPath = path.join(temp, 'output.schema.json');
  const outputPath = path.join(temp, 'result.json');
  const generatedSchemaDir = path.join(temp, 'app-server-schema');
  fs.mkdirSync(generatedSchemaDir, { recursive: true });
  fs.writeFileSync(schemaPath, JSON.stringify(request.output_schema));

  let observedBinaryVersion: string | null = null;
  const exitAttemptedQualificationFailure = (
    phase: CodexQualificationPhase,
    outcome: CodexQualificationFailureOutcome,
  ): number => {
    const finalization = finalizeCodexQualificationFailure({
      phase,
      binary: { binaryRealpath: executable, binaryVersion: observedBinaryVersion },
      observedAt: now(ctx),
      outcome,
    });
    fs.rmSync(temp, { recursive: true, force: true });
    return exitResult(
      ctx,
      request,
      requestEvidence,
      finalization.error,
      predicatesFor(
        { ...policyPassed, ...finalization.passed },
        {
          ...policyEvidenceBindings(policyPassed, requestEvidence.evidence_id),
          ...finalization.bindings,
        },
        { ...policyReasons, ...finalization.failedReasons },
      ),
      [requestEvidence, finalization.evidence],
    );
  };

  const qualificationDispatcher: Record<CodexQualificationPhase, () => Promise<CodexTextProbe>> = {
    version: () =>
      textProbe(
        runtime,
        executable,
        request,
        deadline,
        'version',
        ['--version'],
        workspace,
        childEnv,
      ),
    'root-help': () =>
      textProbe(
        runtime,
        executable,
        request,
        deadline,
        'root-help',
        ['--help'],
        workspace,
        childEnv,
      ),
    'exec-help': () =>
      textProbe(
        runtime,
        executable,
        request,
        deadline,
        'exec-help',
        ['exec', '--help'],
        workspace,
        childEnv,
      ),
    'app-server-help': () =>
      textProbe(
        runtime,
        executable,
        request,
        deadline,
        'app-server-help',
        ['app-server', '--help'],
        workspace,
        childEnv,
      ),
    'app-server-schema': () =>
      textProbe(
        runtime,
        executable,
        request,
        deadline,
        'app-server-schema',
        ['app-server', 'generate-json-schema', '--experimental', '--out', generatedSchemaDir],
        workspace,
        childEnv,
      ),
    'exec-parse-only': () =>
      textProbe(
        runtime,
        executable,
        request,
        deadline,
        'exec-parse-only',
        [
          '--ask-for-approval',
          'never',
          'exec',
          '--json',
          '--output-schema',
          schemaPath,
          '--output-last-message',
          outputPath,
          '--model',
          String(request.model),
          '-c',
          `model_reasoning_effort=${String(request.effort)}`,
          '--sandbox',
          'read-only',
          '--ephemeral',
          '-C',
          workspace,
          '-',
          '--help',
        ],
        workspace,
        childEnv,
      ),
  };
  assertCodexQualificationDispatcher(qualificationDispatcher);
  const completedProbes: Partial<Record<CodexQualificationPhase, CodexTextProbe>> = {};
  for (const definition of CODEX_QUALIFICATION_PHASE_REGISTRY) {
    const phase = definition.id;
    let probe: CodexTextProbe;
    try {
      probe = await qualificationDispatcher[phase]();
    } catch (error) {
      if (!(error instanceof ProviderChildSupervisorError)) throw error;
      return exitAttemptedQualificationFailure(phase, {
        kind: 'supervisor-error',
        code: error.code,
        operation: error.operation,
        stream: error.stream,
        limitBytes: error.limitBytes,
        observedBytes: error.observedBytes,
        termination: error.termination,
        reapTimedOut: error.reapTimedOut,
      });
    }
    completedProbes[phase] = probe;
    if (probe.exitCode !== 0 || probe.signal !== null) {
      return exitAttemptedQualificationFailure(phase, {
        kind: 'nonzero',
        exitCode: probe.exitCode,
        signal: probe.signal,
        stdout: probe.stdout,
        stderr: probe.stderr,
      });
    }
    if (phase === 'version') {
      observedBinaryVersion = probe.stdout.match(/^codex-cli\s+(\S{1,128})\s*$/u)?.[1] ?? null;
    }
  }

  const versionProbe = completedProbes.version as CodexTextProbe;
  const rootHelpProbe = completedProbes['root-help'] as CodexTextProbe;
  const execHelpProbe = completedProbes['exec-help'] as CodexTextProbe;
  const appServerHelpProbe = completedProbes['app-server-help'] as CodexTextProbe;
  const schemaProbe = completedProbes['app-server-schema'] as CodexTextProbe;
  const parseOnlyProbe = completedProbes['exec-parse-only'] as CodexTextProbe;

  const schemaBundle = {
    'ClientRequest.json': readBoundedUtf8File(path.join(generatedSchemaDir, 'ClientRequest.json')),
    'codex_exec_jsonl.schema.json': readBoundedUtf8File(
      path.join(generatedSchemaDir, 'codex_exec_jsonl.schema.json'),
    ),
  };
  const assessed = assessCodexCapability({
    version: versionProbe,
    rootHelp: rootHelpProbe,
    execHelp: execHelpProbe,
    appServerHelp: appServerHelpProbe,
    schemaBundle,
  });
  const capabilityAssessment: CodexCapabilityAssessment = assessed;
  const binary: ProviderBinaryIdentity = {
    binaryRealpath: executable,
    binaryVersion: capabilityAssessment.binary_version,
  };
  const capabilityPayload = capabilityProbePayload(
    capabilityAssessment,
    {
      version: versionProbe,
      'root-help': rootHelpProbe,
      'exec-help': execHelpProbe,
      'app-server-help': appServerHelpProbe,
      'app-server-schema': schemaProbe,
    },
    parseOnlyProbe,
    schemaBundle,
  );
  let capabilityEvidence: ProviderEvidence | null = null;
  if (binary.binaryVersion) {
    capabilityEvidence = createProviderEvidence(binary, {
      kind: 'binary-capability',
      surface: 'cli-headless',
      method: 'codex-capability/assess',
      revision: `sha256:${sha256Canonical({
        binary_version: binary.binaryVersion,
        generated_schema_sha256: capabilityPayload.generated_schema_sha256,
      })}`,
      schemaVersion: capabilityAssessment.schema,
      payload: capabilityPayload,
      observedAt: now(ctx),
      validUntil: null,
      freshness: capabilityAssessment.supported ? 'fresh' : 'unknown',
      completeness: capabilityAssessment.supported ? 'complete' : 'partial',
      errors: capabilityAssessment.reason_code ? [capabilityAssessment.reason_code] : [],
    });
  }
  if (!capabilityAssessment.supported || !capabilityEvidence) {
    fs.rmSync(temp, { recursive: true, force: true });
    const capabilityBindings = policyEvidenceBindings(policyPassed, requestEvidence.evidence_id);
    if (capabilityEvidence) {
      capabilityBindings['binary-available'] = [capabilityEvidence.evidence_id];
      capabilityBindings['behavioral-capability-proven'] = [capabilityEvidence.evidence_id];
    }
    return exitResult(
      ctx,
      request,
      requestEvidence,
      {
        code: 'binary_capability_unproven',
        reason: capabilityAssessment.reason_code ?? 'binary_version_unverified',
        detail: capabilityAssessment.detail,
      },
      predicatesFor(
        capabilityEvidence
          ? {
              ...policyPassed,
              'binary-available': true,
              'behavioral-capability-proven': false,
            }
          : policyPassed,
        capabilityBindings,
        {
          ...policyReasons,
          'binary-available': 'binary_probe_failed',
          'behavioral-capability-proven': 'binary_capability_unproven',
        },
      ),
      capabilityEvidence ? [requestEvidence, capabilityEvidence] : [requestEvidence],
    );
  }

  let sources: { auth: Json; entitlement: Json; quota: Json };
  try {
    sources = await appServer(runtime, executable, request, deadline, workspace, childEnv);
  } catch (error) {
    fs.rmSync(temp, { recursive: true, force: true });
    const normalized =
      error instanceof ProviderChildSupervisorError
        ? { code: error.code, phase: error.operation }
        : { code: 'provider_transport_failed', phase: 'app-server' };
    return exitResult(
      ctx,
      request,
      requestEvidence,
      normalized,
      predicatesFor(
        { ...policyPassed, 'binary-available': true, 'behavioral-capability-proven': true },
        {
          ...policyEvidenceBindings(policyPassed, requestEvidence.evidence_id),
          'binary-available': [capabilityEvidence.evidence_id],
          'behavioral-capability-proven': [capabilityEvidence.evidence_id],
        },
        policyReasons,
      ),
      [requestEvidence, capabilityEvidence],
    );
  }
  const observedNow = now(ctx);
  const authEnvelope = sourceEnvelope(sources.auth, 'auth', observedNow);
  const entitlementEnvelope = sourceEnvelope(sources.entitlement, 'entitlement', observedNow);
  const quotaEnvelope = sourceEnvelope(sources.quota, 'quota', observedNow);
  const clientSchema = JSON.parse(schemaBundle['ClientRequest.json'] as string) as unknown;
  const appServerRevision = `sha256:${sha256Canonical(clientSchema)}`;
  const appServerSchemaVersion =
    plain(clientSchema) && typeof clientSchema.$schema === 'string' ? clientSchema.$schema : null;
  const authEvidence = createProviderEvidence(binary, {
    kind: 'auth',
    surface: 'app-server',
    method: 'account/read',
    revision: appServerRevision,
    schemaVersion: appServerSchemaVersion,
    payload: sources.auth,
    observedAt: String(authEnvelope.observed_at),
    validUntil: authEnvelope.valid_until as string | null,
    freshness: authEnvelope.freshness,
    completeness: authEnvelope.completeness,
  });
  const entitlementEvidence = createProviderEvidence(binary, {
    kind: 'entitlement',
    surface: 'app-server',
    method: 'model/list',
    revision: appServerRevision,
    schemaVersion: appServerSchemaVersion,
    payload: sources.entitlement,
    observedAt: String(entitlementEnvelope.observed_at),
    validUntil: entitlementEnvelope.valid_until as string | null,
    freshness: entitlementEnvelope.freshness,
    completeness: entitlementEnvelope.completeness,
  });
  const quotaEvidence = createProviderEvidence(binary, {
    kind: 'quota',
    surface: 'app-server',
    method: 'account/rateLimits/read',
    revision: appServerRevision,
    schemaVersion: appServerSchemaVersion,
    payload: sources.quota,
    observedAt: String(quotaEnvelope.observed_at),
    validUntil: quotaEnvelope.valid_until as string | null,
    freshness: quotaEnvelope.freshness,
    completeness: quotaEnvelope.completeness,
  });
  let registry: Json | null = null;
  try {
    registry = JSON.parse(fs.readFileSync(ctx.env.CCM_CODEX_MODEL_REGISTRY_PATH || '', 'utf8'));
  } catch {
    registry = null;
  }
  const registryEnvelope = registry || {
    observed_at: now(ctx),
    valid_until: null,
    freshness: 'unknown',
    completeness: 'unknown',
    version: 'unknown',
  };
  const registryEvidence = createProviderEvidence(binary, {
    kind: 'model-catalog',
    surface: 'cli-headless',
    method: 'ccm-model-registry/read',
    revision: String(registryEnvelope.version),
    schemaVersion: typeof registryEnvelope.schema === 'string' ? registryEnvelope.schema : null,
    payload: registryEnvelope,
    observedAt: String(registryEnvelope.observed_at),
    validUntil:
      typeof registryEnvelope.valid_until === 'string' ? registryEnvelope.valid_until : null,
    freshness: registryEnvelope.freshness,
    completeness: registryEnvelope.completeness,
  });
  const evidenceList = [
    capabilityEvidence,
    authEvidence,
    entitlementEvidence,
    quotaEvidence,
    registryEvidence,
    requestEvidence,
  ];
  const models = Array.isArray(sources.entitlement.data) ? sources.entitlement.data : [];
  const live = models.find((model: unknown) => plain(model) && model.model === request.model) as
    | Json
    | undefined;
  const efforts =
    live && Array.isArray(live.supportedReasoningEfforts)
      ? live.supportedReasoningEfforts.map((item: unknown) =>
          plain(item) ? item.reasoningEffort : null,
        )
      : [];
  const allowed = Array.isArray(registry?.allowed)
    ? (registry.allowed.find((entry: unknown) => plain(entry) && entry.model === request.model) as
        | Json
        | undefined)
    : undefined;
  const authFresh =
    normalizedAuthState(sources.auth) === 'authenticated' &&
    authEnvelope.freshness === 'fresh' &&
    authEnvelope.completeness === 'complete';
  const entitlementFresh =
    entitlementEnvelope.freshness === 'fresh' && entitlementEnvelope.completeness === 'complete';
  const registryFresh =
    !!registry &&
    registryEnvelope.freshness === 'fresh' &&
    registryEnvelope.completeness === 'complete';
  // A registry may intentionally leave a new model unclassified. Such a model is not eligible
  // for ordinary work: only an explicit override or a low-risk canary may cross this boundary.
  const unclassifiedRestricted =
    allowed?.classification === 'unclassified' &&
    request.unclassified_override !== true &&
    !(request.risk === 'low' && request.execution_class === 'canary');
  const modelExact = !!live && live.id === request.model && live.model === request.model;
  const effortExact =
    efforts.includes(request.effort) &&
    !!allowed &&
    Array.isArray(allowed.efforts) &&
    allowed.efforts.includes(request.effort);
  const quotaAmple =
    quotaEnvelope.freshness === 'fresh' &&
    quotaEnvelope.completeness === 'complete' &&
    quotaEnvelope.admission_7d === 'ample';
  const allPassed: Partial<Record<PredicateId, boolean>> = {
    ...policyPassed,
    'binary-available': true,
    'behavioral-capability-proven': true,
    'auth-fresh': authFresh,
    'entitlement-fresh': entitlementFresh,
    'registry-allowed': registryFresh && !!allowed && !unclassifiedRestricted,
    'model-exact': modelExact,
    'effort-exact': effortExact,
    'quota-7d-ample': quotaAmple,
  };
  const qualificationBindings: PredicateEvidenceBindings = {
    ...policyEvidenceBindings(policyPassed, requestEvidence.evidence_id),
    'binary-available': [capabilityEvidence.evidence_id],
    'behavioral-capability-proven': [capabilityEvidence.evidence_id],
    'auth-fresh': [authEvidence.evidence_id],
    'entitlement-fresh': [entitlementEvidence.evidence_id],
    'registry-allowed': [registryEvidence.evidence_id],
    'model-exact': [entitlementEvidence.evidence_id],
    'effort-exact': [entitlementEvidence.evidence_id, registryEvidence.evidence_id],
    'quota-7d-ample': [quotaEvidence.evidence_id],
  };
  const reason: string | null = !authFresh
    ? 'auth_unknown'
    : !entitlementFresh
      ? 'entitlement_unknown'
      : !registry
        ? 'registry_unknown'
        : registryEnvelope.freshness === 'hard-stale'
          ? 'registry_hard_stale'
          : !registryFresh
            ? 'registry_unknown'
            : unclassifiedRestricted
              ? 'unclassified_model_restricted'
              : !live
                ? 'model_unavailable'
                : !modelExact
                  ? 'model_mismatch'
                  : !effortExact
                    ? 'effort_mismatch'
                    : quotaEnvelope.freshness === 'hard-stale'
                      ? 'quota_hard_stale'
                      : quotaEnvelope.freshness !== 'fresh' ||
                          quotaEnvelope.admission_7d === 'unknown'
                        ? 'quota_unknown'
                        : quotaEnvelope.admission_7d === 'tight'
                          ? 'quota_tight'
                          : quotaEnvelope.admission_7d !== 'ample'
                            ? 'quota_7d_exhausted'
                            : null;
  const qualificationReasons: Partial<Record<PredicateId, string>> = {
    ...policyReasons,
    'binary-available': 'binary_unavailable',
    'behavioral-capability-proven': 'binary_capability_unproven',
    'auth-fresh': 'auth_unknown',
    'entitlement-fresh': 'entitlement_unknown',
    'registry-allowed': !registry
      ? 'registry_unknown'
      : registryEnvelope.freshness === 'hard-stale'
        ? 'registry_hard_stale'
        : unclassifiedRestricted
          ? 'unclassified_model_restricted'
          : 'registry_unknown',
    'model-exact': !live ? 'model_unavailable' : 'model_mismatch',
    'effort-exact': 'effort_mismatch',
    'quota-7d-ample':
      quotaEnvelope.freshness === 'hard-stale'
        ? 'quota_hard_stale'
        : quotaEnvelope.admission_7d === 'tight'
          ? 'quota_tight'
          : quotaEnvelope.admission_7d === 'exhausted'
            ? 'quota_7d_exhausted'
            : 'quota_unknown',
  };
  const quota = {
    admission_7d: quotaEnvelope.admission_7d ?? 'unknown',
    five_hour_effect: 'ignored',
    buckets: quotaBuckets(sources.quota, quotaEvidence, quotaEnvelope),
    rolling_24h: rolling24(quotaEnvelope, quotaEvidence),
  };
  if (reason) {
    const predicates = predicatesFor(allPassed, qualificationBindings, qualificationReasons);
    const data = {
      schema: RESULT_SCHEMA,
      contract: CONTRACT,
      request_id: request.request_id ?? null,
      provider: 'codex',
      candidate: { automatic_eligible: false, reason_codes: [reason], predicates },
      execution: emptyExecution(),
      identity: {
        requested: {
          model: request.model,
          effort: request.effort,
          evidence_id: requestEvidence.evidence_id,
        },
        resolved: null,
        actual: null,
      },
      quota,
      evidence: evidenceList,
      side_effects: {
        board_writes: 0,
        remote_mutations: 0,
        account_mutations: 0,
        credential_writes: 0,
      },
      result: { status: 'rejected', output: null },
      error: { code: reason },
    };
    assertPredicateEvidence(predicates, evidenceList);
    ctx.out(`${JSON.stringify({ ok: true, data })}\n`);
    return 0;
  }
  const resolutionPayload = {
    schema: 'ccm/codex-model-resolution-intersection/v1',
    requested: { model: request.model, effort: request.effort },
    resolved: { model: request.model, effort: request.effort },
    catalog: {
      evidence_id: entitlementEvidence.evidence_id,
      payload_sha256: entitlementEvidence.payload_sha256,
      revision: entitlementEvidence.source.revision,
    },
    registry: {
      evidence_id: registryEvidence.evidence_id,
      payload_sha256: registryEvidence.payload_sha256,
      revision: registryEvidence.source.revision,
    },
  };
  const valid_until =
    Date.parse(String(entitlementEvidence.valid_until)) <
    Date.parse(String(registryEvidence.valid_until))
      ? entitlementEvidence.valid_until
      : registryEvidence.valid_until;
  const resolutionEvidence = createProviderEvidence(binary, {
    kind: 'model-catalog',
    surface: 'cli-headless',
    method: 'ccm-provider-model-resolution/intersection',
    revision: resolutionPayload.schema,
    schemaVersion: resolutionPayload.schema,
    payload: resolutionPayload,
    observedAt: now(ctx),
    validUntil: valid_until,
    freshness: 'fresh',
    completeness: 'complete',
  });
  evidenceList.push(resolutionEvidence);
  const argv = [
    '--ask-for-approval',
    'never',
    'exec',
    '--json',
    '--output-schema',
    schemaPath,
    '--output-last-message',
    outputPath,
    '--model',
    request.model,
    '-c',
    `model_reasoning_effort=${request.effort}`,
    '--sandbox',
    'read-only',
    '--ephemeral',
    '-C',
    workspace,
    '-',
  ];
  const stdin = `${request.prompt}\n`;
  const invocation = createCompiledInvocationAudit({
    executable,
    argv,
    env: childEnv,
    stdin,
    cwd: workspace,
    permission,
    requested: {
      model: request.model,
      effort: request.effort,
      evidence_id: requestEvidence.evidence_id,
    },
    resolved: {
      model: request.model,
      effort: request.effort,
      evidence_id: resolutionEvidence.evidence_id,
    },
  });
  const cancelMs = Number(ctx.env.CCM_CODEX_PROVIDER_TEST_CANCEL_AFTER_MS);
  const externalCancellation = Number.isFinite(cancelMs) && cancelMs > 0;
  let status = 'succeeded';
  let error: Json | null = null;
  let actual: Json | null = null;
  let output: unknown = null;
  const execution = {
    attempted: true,
    invocation_compiled: true,
    parser_exercised: true,
    terminal_count: 0,
    timeout_phase: null as TimeoutPhase | null,
    cancel_observed: false,
    stdout: { bytes_seen: 0, limit_bytes: MAX_JSONL_BYTES, truncated: false },
    stderr: { excerpt: '', limit_bytes: MAX_STDERR_EXCERPT_BYTES, truncated: false },
    invocation,
  };
  const identityEventType = capabilityAssessment.exec_jsonl_contract.identity_event_type;
  if (!identityEventType) throw new Error('eligible capability lacks an identity event type');
  const parser = new CodexJsonlParser(identityEventType);
  let stderrRaw = '';
  const cancellation = new AbortController();
  let cancelTimer: NodeJS.Timeout | null = null;
  try {
    const finished = await runProviderChild(runtime, executable, request, deadline, {
      operation: 'exec',
      argv,
      cwd: workspace,
      env: childEnv,
      signal: cancellation.signal,
      stdoutLimitBytes: MAX_JSONL_BYTES,
      stderrLimitBytes: MAX_STDERR_CAPTURE_BYTES,
      onStdoutText: (text) => {
        if (!parser.push(text)) throw new Error('stream_malformed');
      },
      onStderrText: (text) => {
        stderrRaw += text;
      },
      onStarted: (write, end) => {
        if (externalCancellation) {
          cancelTimer = setTimeout(
            () => cancellation.abort(new Error('provider request cancelled')),
            cancelMs,
          );
          cancelTimer.unref();
        }
        write(stdin);
        end();
      },
    });
    parser.finish();
    execution.terminal_count = parser.terminalCount;
    execution.stdout = {
      bytes_seen: finished.stdoutBytes,
      limit_bytes: MAX_JSONL_BYTES,
      truncated: parser.truncated,
    };
    const redactedStderr = redactProviderDiagnostic(stderrRaw);
    execution.stderr = {
      excerpt: boundedUtf8(redactedStderr, MAX_STDERR_EXCERPT_BYTES),
      limit_bytes: MAX_STDERR_EXCERPT_BYTES,
      truncated:
        finished.stderrBytes > Buffer.byteLength(stderrRaw, 'utf8') ||
        Buffer.byteLength(redactedStderr, 'utf8') > MAX_STDERR_EXCERPT_BYTES,
    };

    for (const unknown of parser.unknownEvents) {
      const retained = createProviderEvidence(binary, {
        kind: 'execution',
        surface: 'cli-headless',
        method: 'codex-exec/unknown-event',
        revision: String(unknown.schema ?? unknown.type ?? 'unknown'),
        schemaVersion: typeof unknown.schema === 'string' ? unknown.schema : null,
        payload: unknown,
        observedAt: now(ctx),
        validUntil: null,
        freshness: 'unknown',
        completeness: 'partial',
      });
      evidenceList.push(retained);
    }
    const metadata = verifiedIdentityMetadata(parser.metadata);
    if (metadata) {
      const actualEvidence = createProviderEvidence(binary, {
        kind: 'execution',
        surface: 'cli-headless',
        method: metadata.type,
        revision: metadata.schema,
        schemaVersion: metadata.schema,
        payload: metadata,
        observedAt: now(ctx),
        validUntil: null,
        freshness: 'fresh',
        completeness: 'complete',
      });
      evidenceList.push(actualEvidence);
      actual = {
        model: metadata.model ?? null,
        effort: metadata.effort ?? null,
        evidence_id: actualEvidence.evidence_id,
      };
    }
    const parserError = parser.errorCode();
    if (parserError) {
      status = 'failed';
      const message =
        typeof parser.providerError?.message === 'string'
          ? boundedUtf8(
              redactProviderDiagnostic(parser.providerError.message),
              MAX_STDERR_EXCERPT_BYTES,
            )
          : execution.stderr.excerpt;
      error = { code: parserError, ...(message ? { message } : {}) };
    } else if (finished.exitCode !== 0 || finished.signal !== null) {
      status = 'failed';
      error = {
        code: 'provider_failed',
        ...(execution.stderr.excerpt ? { message: execution.stderr.excerpt } : {}),
      };
    } else if (!metadata || metadata.model === null || metadata.model === undefined) {
      status = 'failed';
      error = { code: 'actual_model_missing' };
    } else if (metadata.model !== request.model) {
      status = 'failed';
      error = { code: 'model_mismatch' };
    } else if (metadata.effort === null || metadata.effort === undefined) {
      status = 'failed';
      error = { code: 'actual_effort_missing' };
    } else if (metadata.effort !== request.effort) {
      status = 'failed';
      error = { code: 'effort_mismatch' };
    } else {
      try {
        output = readStructuredOutput(outputPath, outputSchemaValidator);
      } catch {
        status = 'failed';
        error = { code: 'structured_output_malformed' };
        output = null;
      }
    }
  } catch (caught) {
    if (!(caught instanceof ProviderChildSupervisorError)) throw caught;
    execution.terminal_count = parser.terminalCount;
    const observedBytes = caught.observedBytes ?? parser.bytesSeen;
    if (caught.stream === 'stdout') {
      execution.stdout.bytes_seen = observedBytes;
      execution.stdout.truncated = caught.code === 'output_limit' || parser.truncated;
    }
    if (caught.stream === 'stderr') {
      const redacted = redactProviderDiagnostic(stderrRaw);
      execution.stderr.excerpt = boundedUtf8(redacted, MAX_STDERR_EXCERPT_BYTES);
      execution.stderr.truncated = caught.code === 'output_limit';
    }
    if (caught.code === 'cancelled') {
      execution.cancel_observed = true;
      status = 'cancelled';
      error = { code: 'cancelled', phase: caught.operation };
    } else if (caught.code.endsWith('_timeout')) {
      execution.timeout_phase = caught.code.slice(0, -'_timeout'.length) as TimeoutPhase;
      status = 'timed_out';
      error = { code: caught.code, phase: caught.operation };
    } else {
      status = 'failed';
      const stderrLimitFailure = caught.code === 'output_limit' && caught.stream === 'stderr';
      error = {
        code: stderrLimitFailure ? 'provider_failed' : 'stream_malformed',
        phase: caught.operation,
      };
    }
  } finally {
    if (cancelTimer) clearTimeout(cancelTimer);
    fs.rmSync(temp, { recursive: true, force: true });
  }
  const predicates = predicatesFor({ ...allPassed }, qualificationBindings, qualificationReasons);
  const data = {
    schema: RESULT_SCHEMA,
    contract: CONTRACT,
    request_id: request.request_id ?? null,
    provider: 'codex',
    candidate: { automatic_eligible: true, reason_codes: error ? [error.code] : [], predicates },
    execution,
    identity: {
      requested: {
        model: request.model,
        effort: request.effort,
        evidence_id: requestEvidence.evidence_id,
      },
      resolved: {
        model: request.model,
        effort: request.effort,
        evidence_id: resolutionEvidence.evidence_id,
      },
      actual,
    },
    quota,
    evidence: evidenceList,
    side_effects: {
      board_writes: 0,
      remote_mutations: 0,
      account_mutations: 0,
      credential_writes: 0,
    },
    result: { status, output },
    error,
  };
  assertPredicateEvidence(predicates, evidenceList);
  ctx.out(`${JSON.stringify({ ok: true, data })}\n`);
  return 0;
}
