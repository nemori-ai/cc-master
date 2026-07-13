import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';

const EVIDENCE_REFERENCE_SCHEMA = 'ccm/provider-evidence-reference/v1';
const INVOCATION_SCHEMA = 'ccm/codex-compiled-invocation/v1';
const COMPILER_VERSION = 'ccm/codex-invocation-compiler/v1';

type JsonObject = Record<string, unknown>;
type RedactionCategory = 'credential' | 'email' | 'token';

const REQUEST_EVIDENCE_METHOD = 'ccm-provider-inspect/request';
const RESOLVE_EXECUTABLE_METHOD = 'ccm-provider-runtime/resolveExecutable';
const MAX_CANONICAL_DEPTH = 64;
const MAX_CANONICAL_NODES = 50_000;
const ERROR_EXCERPT_BYTES = 1_024;
const ERROR_SCAN_BYTES = 4_096;
const REQUIRED_ENV_KEYS = ['CODEX_HOME', 'HOME', 'NO_COLOR', 'PATH', 'TMPDIR'] as const;

export type ProviderEvidenceKind =
  | 'binary-capability'
  | 'auth'
  | 'entitlement'
  | 'model-catalog'
  | 'quota'
  | 'execution';

export type EvidenceFreshness = 'fresh' | 'soft-stale' | 'hard-stale' | 'unknown';
export type EvidenceCompleteness = 'complete' | 'partial' | 'unknown';

export interface ProviderBinaryIdentity {
  binaryRealpath: string | null;
  binaryVersion: string | null;
}

export interface ProviderEvidenceInput {
  kind: ProviderEvidenceKind;
  surface: 'cli-headless' | 'app-server';
  method: string;
  revision: string;
  schemaVersion: string | null;
  payload: unknown;
  observedAt: string;
  validUntil: string | null;
  freshness: EvidenceFreshness;
  completeness: EvidenceCompleteness;
  errors?: string[];
}

export interface ProviderEvidence {
  evidence_id: string;
  kind: ProviderEvidenceKind;
  source: {
    provider: 'codex';
    surface: 'cli-headless' | 'app-server';
    method: string;
    revision: string;
    binary_realpath: string | null;
    binary_version: string | null;
    schema_version: string | null;
  };
  observed_at: string;
  valid_until: string | null;
  freshness: EvidenceFreshness;
  completeness: EvidenceCompleteness;
  payload_sha256: string;
  redactions: string[];
  errors: string[];
}

function isPlainObject(value: unknown): value is JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

interface CanonicalState {
  ancestors: Set<object>;
  nodes: number;
}

function canonicalizeStrict(value: unknown, state: CanonicalState, depth: number): unknown {
  state.nodes += 1;
  if (depth > MAX_CANONICAL_DEPTH || state.nodes > MAX_CANONICAL_NODES)
    throw new Error('strict JSON exceeds canonicalization bounds');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('strict JSON requires finite numbers');
    return value;
  }
  if (typeof value !== 'object') throw new Error(`strict JSON cannot encode ${typeof value}`);
  if (state.ancestors.has(value)) throw new Error('cyclic strict JSON is not allowed');
  state.ancestors.add(value);
  try {
    if (Array.isArray(value))
      return value.map((child) => canonicalizeStrict(child, state, depth + 1));
    if (!isPlainObject(value)) throw new Error('strict JSON requires a plain object');
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string'))
      throw new Error('strict JSON object keys must be strings');
    const entries = (keys as string[])
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !('value' in descriptor))
          throw new Error('strict JSON requires enumerable data properties');
        return [key, canonicalizeStrict(descriptor.value, state, depth + 1)] as const;
      });
    return Object.fromEntries(entries);
  } finally {
    state.ancestors.delete(value);
  }
}

export function canonicalize(value: unknown): unknown {
  return canonicalizeStrict(value, { ancestors: new Set(), nodes: 0 }, 0);
}

export function canonicalJson(value: unknown): string {
  const encoded = JSON.stringify(canonicalize(value));
  if (encoded === undefined) throw new Error('canonical JSON cannot encode undefined');
  return encoded;
}

export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function sha256Bytes(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function redactionKind(key: string): RedactionCategory | null {
  const normalized = key.replaceAll(/[-_]/gu, '').toLowerCase();
  if (normalized.includes('email')) return 'email';
  if (
    normalized.includes('token') ||
    normalized.includes('authorization') ||
    normalized.includes('cookie') ||
    normalized.includes('apikey')
  )
    return 'token';
  if (
    normalized.includes('password') ||
    normalized.includes('secret') ||
    (normalized.includes('credential') && !normalized.endsWith('credentialid'))
  )
    return 'credential';
  return null;
}

function redactSensitiveText(value: string, categories: Set<RedactionCategory>): string {
  let redacted = value.replace(
    /(^[^\S\r\n]*authorization[^\S\r\n]*:[^\S\r\n]*)(basic|bearer)[^\S\r\n]+[^\r\n]*/gimu,
    (_match: string, prefix: string, scheme: string) => {
      categories.add(scheme.toLowerCase() === 'basic' ? 'credential' : 'token');
      return `${prefix}${scheme} [REDACTED]`;
    },
  );
  redacted = redacted.replace(
    /(^[^\S\r\n]*(?:set-cookie|cookie)[^\S\r\n]*:[^\S\r\n]*)[^\r\n]*/gimu,
    (_match: string, prefix: string) => {
      categories.add('token');
      return `${prefix}[REDACTED]`;
    },
  );
  redacted = redacted.replace(
    /(\bauthorization\s*[:=]\s*)(bearer|basic)\s+(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/giu,
    (_match: string, prefix: string, scheme: string) => {
      categories.add(scheme.toLowerCase() === 'basic' ? 'credential' : 'token');
      return `${prefix}${scheme} [REDACTED]`;
    },
  );
  redacted = redacted.replace(
    /(\bbearer\s+)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/giu,
    (_match: string, prefix: string) => {
      categories.add('token');
      return `${prefix}[REDACTED]`;
    },
  );
  redacted = redacted.replace(
    /(\b(access[-_]?token|refresh[-_]?token|id[-_]?token|token|api[-_]?key|password|secret|set[-_]?cookie|cookie|credential)\b\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/giu,
    (_match: string, prefix: string, key: string) => {
      categories.add(redactionKind(key) ?? 'credential');
      return `${prefix}[REDACTED]`;
    },
  );
  return redacted.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, () => {
    categories.add('email');
    return '[REDACTED_EMAIL]';
  });
}

export function redactProviderDiagnostic(value: string): string {
  return redactSensitiveText(value, new Set<RedactionCategory>());
}

export function compileCodexChildEnvironment(
  source: Record<string, string | undefined>,
): Record<string, string> {
  const home = source.HOME || os.homedir();
  return {
    CODEX_HOME: source.CODEX_HOME || path.join(home, '.codex'),
    HOME: home,
    NO_COLOR: '1',
    PATH: source.PATH || process.env.PATH || '/usr/bin:/bin',
    TMPDIR: source.TMPDIR || os.tmpdir(),
  };
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let bytes = 0;
  let output = '';
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > maxBytes) break;
    output += character;
    bytes += size;
  }
  return output;
}

function redact(value: unknown, categories: Set<RedactionCategory>, depth = 0): unknown {
  if (depth > 64) throw new Error('provider evidence exceeds redaction depth');
  if (Array.isArray(value)) return value.map((child) => redact(child, categories, depth + 1));
  if (typeof value === 'string') return redactSensitiveText(value, categories);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      const kind = redactionKind(key);
      if (kind) {
        categories.add(kind);
        return [key, kind === 'email' ? '[REDACTED_EMAIL]' : '[REDACTED]'];
      }
      return [key, redact(child, categories, depth + 1)];
    }),
  );
}

function boundedError(value: string, categories: Set<RedactionCategory>): string {
  const boundedInput = truncateUtf8(value, ERROR_SCAN_BYTES);
  return truncateUtf8(redactSensitiveText(boundedInput, categories), ERROR_EXCERPT_BYTES);
}

const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/u;

function parseRfc3339(value: string, field: string): number {
  const match = RFC3339.exec(value);
  if (!match) throw new Error(`provider evidence ${field} must be strict RFC3339`);
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    offsetHour,
    offsetMinute,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (monthDays[month - 1] ?? 0) ||
    Number(hourText) > 23 ||
    Number(minuteText) > 59 ||
    Number(secondText) > 59 ||
    (offsetHour !== undefined && Number(offsetHour) > 23) ||
    (offsetMinute !== undefined && Number(offsetMinute) > 59)
  )
    throw new Error(`provider evidence ${field} must be strict RFC3339`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp))
    throw new Error(`provider evidence ${field} must be strict RFC3339`);
  return timestamp;
}

function exactNegativeResolution(input: ProviderEvidenceInput, payload: unknown): boolean {
  return (
    input.method === RESOLVE_EXECUTABLE_METHOD &&
    input.kind === 'binary-capability' &&
    input.surface === 'cli-headless' &&
    input.schemaVersion === null &&
    input.validUntil === null &&
    input.freshness === 'unknown' &&
    input.completeness === 'complete' &&
    (input.errors?.length ?? 0) === 0 &&
    isPlainObject(payload) &&
    Object.keys(payload).length === 1 &&
    payload.resolved === null
  );
}

function validateBinaryIdentity(
  binary: ProviderBinaryIdentity,
  input: ProviderEvidenceInput,
  payload: unknown,
): void {
  const realpathNull = binary.binaryRealpath === null;
  const versionNull = binary.binaryVersion === null;
  if (realpathNull) {
    if (!versionNull)
      throw new Error(
        'provider evidence binary realpath and version must both be null when no binary resolved',
      );
    const requestPreflight =
      input.method === REQUEST_EVIDENCE_METHOD &&
      input.kind === 'execution' &&
      input.surface === 'cli-headless';
    if (!requestPreflight && !exactNegativeResolution(input, payload))
      throw new Error('provider evidence requires an absolute binary realpath');
    return;
  }
  if (!path.isAbsolute(binary.binaryRealpath as string))
    throw new Error('provider evidence requires an absolute binary realpath');
  if (versionNull) {
    if (
      input.kind !== 'binary-capability' ||
      input.surface !== 'cli-headless' ||
      input.freshness !== 'unknown' ||
      input.validUntil !== null
    )
      throw new Error(
        'provider evidence with an unresolved binary version must be an unknown CLI capability observation',
      );
    return;
  }
  if (!(binary.binaryVersion as string).trim())
    throw new Error('provider evidence requires a nonempty binary version');
}

export function createProviderEvidence(
  binary: ProviderBinaryIdentity,
  input: ProviderEvidenceInput,
): ProviderEvidence {
  if (!input.method.trim() || !input.revision.trim())
    throw new Error('provider evidence method and revision are required');
  const errors = input.errors ?? [];
  if (!Array.isArray(errors) || !errors.every((error) => typeof error === 'string'))
    throw new Error('provider evidence errors must be an array of strings');
  const observedAt = parseRfc3339(input.observedAt, 'observed_at');
  const validUntil =
    input.validUntil === null ? null : parseRfc3339(input.validUntil, 'valid_until');
  if (validUntil !== null && validUntil < observedAt)
    throw new Error('provider evidence valid_until cannot be before observed_at');
  if (input.freshness === 'fresh' && input.completeness !== 'complete')
    throw new Error('fresh evidence must be complete');
  if (input.freshness === 'fresh' && errors.length > 0)
    throw new Error('fresh evidence cannot contain errors');
  const strictPayload = canonicalize(input.payload);
  validateBinaryIdentity(binary, input, strictPayload);
  const categories = new Set<RedactionCategory>();
  const redactedPayload = redact(strictPayload, categories);
  const payloadSha256 = sha256Canonical(redactedPayload);
  const reference = {
    schema: EVIDENCE_REFERENCE_SCHEMA,
    source_method: input.method,
    source_revision: input.revision,
    payload_sha256: payloadSha256,
  };
  const redactedErrors = errors.map((error) => boundedError(error, categories));
  return {
    evidence_id: `ev-${sha256Canonical(reference)}`,
    kind: input.kind,
    source: {
      provider: 'codex',
      surface: input.surface,
      method: input.method,
      revision: input.revision,
      binary_realpath: binary.binaryRealpath,
      binary_version: binary.binaryVersion,
      schema_version: input.schemaVersion,
    },
    observed_at: input.observedAt,
    valid_until: input.validUntil,
    freshness: input.freshness,
    completeness: input.completeness,
    payload_sha256: payloadSha256,
    redactions: [...categories].sort(),
    errors: redactedErrors,
  };
}

export interface CompiledInvocationAuditInput {
  executable: string;
  argv: string[];
  env: Record<string, string>;
  stdin: string | Uint8Array;
  cwd: string;
  permission: JsonObject;
  requested: JsonObject;
  resolved: JsonObject;
}

interface IdentityReference {
  model: string;
  effort: string;
  evidence_id: string;
}

function identityReference(value: JsonObject, label: 'requested' | 'resolved'): IdentityReference {
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'effort,evidence_id,model')
    throw new Error(`${label} identity must contain exactly model, effort, and evidence_id`);
  for (const field of ['model', 'effort', 'evidence_id'] as const)
    if (typeof value[field] !== 'string' || !value[field].trim())
      throw new Error(`${label} identity ${field} must be a nonempty string`);
  return value as unknown as IdentityReference;
}

function validatePermission(permission: JsonObject): void {
  const expected: JsonObject = {
    sandbox: 'read-only',
    approval: 'never',
    network: 'provider-only',
    account_mutation: 'forbidden',
    credential_write: 'forbidden',
  };
  if (canonicalJson(permission) !== canonicalJson(expected))
    throw new Error('compiled invocation requires the frozen read-only permission profile');
}

function validateInvocationArgv(argv: string[], cwd: string, resolved: IdentityReference): void {
  if (!Array.isArray(argv) || !argv.every((argument) => typeof argument === 'string'))
    throw new Error('compiled invocation argv must be a string array');
  if (argv.some((argument) => /<[^>]+>/u.test(argument)))
    throw new Error('compiled invocation cannot contain a placeholder');
  const forbidden = new Set([
    '--dangerously-bypass-approvals-and-sandbox',
    '--full-auto',
    '--add-dir',
    '--search',
    'resume',
    'fork',
    'login',
    'logout',
  ]);
  const forbiddenArgument = argv.find((argument) => forbidden.has(argument));
  if (forbiddenArgument) throw new Error(`forbidden invocation argument: ${forbiddenArgument}`);
  const execIndexes = argv.flatMap((argument, index) => (argument === 'exec' ? [index] : []));
  const approvalIndexes = argv.flatMap((argument, index) =>
    argument === '--ask-for-approval' ? [index] : [],
  );
  if (
    execIndexes.length !== 1 ||
    approvalIndexes.length !== 1 ||
    approvalIndexes[0] !== 0 ||
    argv[1] !== 'never' ||
    (approvalIndexes[0] as number) >= (execIndexes[0] as number)
  )
    throw new Error('approval never must appear before exec');
  const execIndex = execIndexes[0] as number;
  if (execIndex !== 2) throw new Error('approval never must appear before exec');
  if (argv.at(-1) !== '-') throw new Error('stdin prompt must be the last argv element');

  const required = new Map([
    ['--json', 0],
    ['--output-schema', 0],
    ['--output-last-message', 0],
    ['--model', 0],
    ['-c', 0],
    ['--sandbox', 0],
    ['--ephemeral', 0],
    ['-C', 0],
  ]);
  const values = new Map<string, string>();
  const paired = new Set([
    '--output-schema',
    '--output-last-message',
    '--model',
    '-c',
    '--sandbox',
    '-C',
  ]);
  for (let index = execIndex + 1; index < argv.length - 1; index += 1) {
    const argument = argv[index] as string;
    if (!required.has(argument)) throw new Error(`forbidden invocation argument: ${argument}`);
    required.set(argument, (required.get(argument) ?? 0) + 1);
    if (paired.has(argument)) {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`compiled invocation ${argument} requires a value`);
      values.set(argument, value);
      index += 1;
    }
  }
  for (const [argument, count] of required)
    if (count !== 1) throw new Error(`compiled invocation requires exactly one ${argument}`);
  if (values.get('--sandbox') !== 'read-only')
    throw new Error('compiled invocation requires a read-only sandbox');
  for (const argument of ['--output-schema', '--output-last-message', '-C'])
    if (!path.isAbsolute(values.get(argument) ?? ''))
      throw new Error(`compiled invocation ${argument} path must be absolute`);
  if (values.get('-C') !== cwd) throw new Error('compiled invocation cwd must match -C workspace');
  if (values.get('--model') !== resolved.model)
    throw new Error('compiled invocation model must match resolved identity');
  if (values.get('-c') !== `model_reasoning_effort=${resolved.effort}`)
    throw new Error('compiled invocation effort must match resolved identity');
}

function validateEnvironment(env: Record<string, string>): void {
  const keys = Object.keys(env).sort();
  if (keys.join(',') !== [...REQUIRED_ENV_KEYS].sort().join(','))
    throw new Error('compiled invocation requires exact environment keys');
  if (keys.some((key) => typeof env[key] !== 'string' || env[key] === ''))
    throw new Error('compiled invocation environment values must be nonempty strings');
  if (env.NO_COLOR !== '1')
    throw new Error('compiled invocation NO_COLOR must use the compiler-selected value');
}

export type CompiledInvocationAudit = ReturnType<typeof createCompiledInvocationAudit>;

export function createCompiledInvocationAudit(input: CompiledInvocationAuditInput) {
  if (!path.isAbsolute(input.executable))
    throw new Error('compiled invocation requires an absolute executable');
  if (!path.isAbsolute(input.cwd)) throw new Error('compiled invocation requires an absolute cwd');
  const requested = identityReference(input.requested, 'requested');
  const resolved = identityReference(input.resolved, 'resolved');
  if (requested.evidence_id === resolved.evidence_id)
    throw new Error('requested and resolved identities require distinct evidence ids');
  validatePermission(input.permission);
  validateEnvironment(input.env);
  validateInvocationArgv(input.argv, input.cwd, resolved);
  const body = {
    schema: INVOCATION_SCHEMA,
    compiler_version: COMPILER_VERSION,
    executable: input.executable,
    argv: [...input.argv],
    env_keys: Object.keys(input.env).sort(),
    stdin_sha256: sha256Bytes(input.stdin),
    cwd: input.cwd,
    permission: canonicalize(input.permission),
    requested: canonicalize(input.requested),
    resolved: canonicalize(input.resolved),
  };
  return { ...body, invocation_sha256: sha256Canonical(body) };
}
