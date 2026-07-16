// shadow-routing.ts — C1 cached machine context + pure advisory route.
//
// This module is deliberately IO-free. It accepts already-cached, redacted facts and an already
// planned routing policy. It never probes, reserves, spawns, mutates a board, or ranks by brand.

import {
  type ContractIssue,
  contractActivation,
  routeOutcomeClass,
  validateTaskPlanning,
  validateTaskRoutePolicy,
} from './routing-contract.js';

export const MACHINE_CONTEXT_CACHE_SCHEMA = 'ccm/machine-context-cache/v1';
export const ORCHESTRATOR_CONTEXT_SCHEMA = 'ccm/orchestrator-context/v1';
export const SHADOW_ROUTE_ADVICE_SCHEMA = 'ccm/shadow-route-advice/v1';
export const ORIGIN_CONTEXT_SCHEMA = 'ccm/origin-context/v1';
export const CURSOR_SURFACE_CONTEXT_SCHEMA = 'ccm/cursor-surface-context/v1';
export const MACHINE_QUOTA_SUMMARY_SCHEMA = 'ccm/machine-quota-summary/v1';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const AVAILABILITY = ['available', 'unavailable', 'unknown'] as const;
const QUOTA = ['ample', 'tight', 'exhausted', 'unknown'] as const;
const QUALIFICATION = ['pass', 'fail', 'unknown'] as const;
const AUTH = ['authenticated', 'unauthenticated', 'expired', 'unknown'] as const;
const MODEL = ['available', 'unavailable', 'unknown'] as const;
const RUNTIME = ['healthy', 'unhealthy', 'unknown'] as const;
export const ORCHESTRATOR_CONTEXT_MAX_BYTES = 4096;
const MAX_REVISION_LENGTH = 256;
const MAX_ORIGIN_LENGTH = 128;
const MAX_ID_LENGTH = 128;
const MAX_HARNESS_LENGTH = 64;
const MAX_PREDICATE_LENGTH = 128;
const MAX_REF_LENGTH = 256;
const MAX_WARNING_LENGTH = 256;
const MAX_AGENT_ROUTE_SUMMARIES = 12;
const SAFE_PUBLIC_CODE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SAFE_PUBLIC_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const MACHINE_QUOTA_REASON = /^[A-Z0-9][A-Z0-9_:-]{0,127}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const SECRET_KEY =
  /credential|token|(?:^|_)argv(?:_|$)|(?:^|_)env(?:ironment)?(?:_|$)|raw.*response|transcript|balance/i;
// BEGIN ORIGIN_PRIVATE_VALUE_LANGUAGE
const SECRET_SK_VALUE = /(?:^|[^A-Za-z0-9])(sk-[A-Za-z0-9_-]{16,})(?=$|[^A-Za-z0-9_-])/i;
const SECRET_JWT_VALUE =
  /(?:^|[^A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?=$|[^A-Za-z0-9_-])/;
const SECRET_GITHUB_VALUE =
  /(?:^|[^A-Za-z0-9_])(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{8,}(?=$|[^A-Za-z0-9_])/i;
const SECRET_ASSIGNMENT_VALUE =
  /\b(?:api[\s_-]*key|credentials?|(?:access|refresh)[\s_-]*token|client[\s_-]*secret|secret[\s_-]*key)\b\s*[:=]\s*["']?([A-Za-z0-9._~+/=-]{8,})/i;
const BEARER_VALUE = /\bBearer\s+([A-Za-z0-9._~+/=-]{8,})(?=$|[^A-Za-z0-9._~+/=-])/i;
const NON_SECRET_ASSIGNMENT_VALUES = new Set([
  'unknown',
  'unavailable',
  'redacted',
  'missing',
  'none',
  'not-configured',
  'forbidden',
]);
const NON_SECRET_BEARER_VALUES = new Set([
  'unknown',
  'unavailable',
  'redacted',
  'missing',
  'none',
  'not-configured',
  'forbidden',
]);
const NON_SECRET_BEARER_AUTH_STATUS =
  /^(?:(?:\s+is)?\s+|:\s*)(?:unknown|unavailable|missing|not[- ]configured|forbidden)\b/i;
// END ORIGIN_PRIVATE_VALUE_LANGUAGE
const CONTRACT_PREDICATES = new Set([
  'capability-match',
  'effect-floor',
  'permission-compatible',
  'account-mutation-forbidden',
]);

const CURSOR_SURFACE_STATES = ['only-ide', 'only-agent', 'both', 'neither'] as const;
const CURSOR_SURFACE_SPECS = [
  {
    surface_id: 'cursor-ide-plugin',
    surface: 'host-native',
    role: 'master-origin',
    installed_source: 'cursor-ide/plugin-install-probe/v1',
    authentication_source: null,
    eligibility_sources: [
      'cursor-ide/plugin-host-qualification/v1',
      'cursor-ide/origin-session-attestation/v1',
    ],
  },
  {
    surface_id: 'cursor-agent-cli',
    surface: 'cli-headless',
    role: 'worker-target',
    installed_source: 'cursor-agent/version-help-probe/v1',
    authentication_source: 'cursor-agent/status-json/v1',
    eligibility_sources: [
      'cursor-agent/status-json/v1',
      'cursor-agent/model-entitlement-collector/v1',
      'cursor-agent/quota-collector/v1',
      'cursor-agent/sandbox-runtime-qualification/v1',
      'cursor-agent/transport-qualification/v1',
      'ccm/supervisor-process-tree-qualification/v1',
    ],
  },
] as const;

type Availability = (typeof AVAILABILITY)[number];
type Quota = (typeof QUOTA)[number];
type QualificationStatus = (typeof QUALIFICATION)[number];

interface RecordLike {
  // biome-ignore lint/suspicious/noExplicitAny: public JSON boundary is validated before use.
  [key: string]: any;
}

export interface CachedQualification {
  predicate: string;
  status: QualificationStatus;
  ref?: string;
}

export interface CachedCandidateFact {
  candidate_id: string;
  harness: string;
  surface: 'host-native' | 'cli-headless';
  availability: Availability;
  quota: Quota;
  auth: (typeof AUTH)[number];
  model: (typeof MODEL)[number];
  runtime: (typeof RUNTIME)[number];
  qualifications: CachedQualification[];
}

export type CursorSurfaceState = (typeof CURSOR_SURFACE_STATES)[number];

export interface CursorSurfaceContextFact {
  surface_id: 'cursor-ide-plugin' | 'cursor-agent-cli';
  harness: 'cursor';
  surface: 'host-native' | 'cli-headless';
  role: 'master-origin' | 'worker-target';
  installed: boolean;
  auth_state: 'authenticated' | 'unauthenticated' | 'unknown';
  role_eligible: boolean;
  blocker_codes: string[];
  provenance: {
    installed: string;
    authentication: string | null;
    role_eligibility: string[];
  };
}

export interface CursorSurfaceContext {
  schema: typeof CURSOR_SURFACE_CONTEXT_SCHEMA;
  state: CursorSurfaceState;
  surfaces: [CursorSurfaceContextFact, CursorSurfaceContextFact];
}

export interface MachineQuotaSummaryDecision {
  scope_digest: string;
  target: {
    harness_id: string;
    surface_id: string;
    provider_id: string;
    identity_scope_digest: string;
    payer_scope: string;
    pool_scope_digest: string;
    bucket_id: string;
    unit: string;
    window: { kind: string; name: string; duration_sec: number };
  };
  policy_digest: string;
  requirement_digest: string;
  state: 'healthy' | 'tight' | 'exhausted' | 'stale' | 'unknown';
  freshness: 'fresh' | 'soft-stale' | 'hard-stale' | 'unknown';
  reason_codes: string[];
  decision_revision: string;
  observation_revision: string;
  fanout_covered: boolean;
}

export interface MachineQuotaSummary {
  schema: typeof MACHINE_QUOTA_SUMMARY_SCHEMA;
  decisions: MachineQuotaSummaryDecision[];
}

export interface MachineContextCache {
  schema: typeof MACHINE_CONTEXT_CACHE_SCHEMA;
  revision: string;
  board_revision: string;
  observed_at: string;
  valid_until: string;
  candidates: CachedCandidateFact[];
  cursor_surfaces?: CursorSurfaceContext;
  warnings: string[];
}

export interface OrchestratorContext {
  schema: typeof ORCHESTRATOR_CONTEXT_SCHEMA;
  cached_only: true;
  available: boolean;
  origin_harness: string;
  revisions: { board: string; machine: string };
  freshness: {
    state: 'fresh' | 'stale' | 'unknown';
    observed_at: string;
    valid_until: string;
    as_of: string;
  };
  candidates: CachedCandidateFact[];
  cursor_surfaces?: CursorSurfaceContext;
  machine_quota?: MachineQuotaSummary;
  warnings: string[];
  truncation: {
    applied: boolean;
    omitted_candidates: number;
    omitted_warnings: number;
    shortened_fields: number;
    omitted_quota_scopes: number;
    max_bytes: typeof ORCHESTRATOR_CONTEXT_MAX_BYTES;
  };
}

export interface ShadowCandidateEvaluation {
  candidate_id: string;
  harness: string;
  surface: 'host-native' | 'cli-headless';
  eligible: boolean;
  reason_codes: string[];
  qualification_results: CachedQualification[];
}

export interface ShadowRouteAdvice {
  schema: typeof SHADOW_ROUTE_ADVICE_SCHEMA;
  advisory_only: true;
  spawned: false;
  eligible: boolean;
  outcome: 'same-native' | 'same-harness-cli' | 'other-harness-cli' | 'origin-stay' | 'no-route';
  chain: 'ample' | 'tight';
  selected: null | {
    candidate_id: string;
    harness: string;
    surface: 'host-native' | 'cli-headless';
    model: string;
    effort: string;
  };
  reason_codes: string[];
  revisions: { board: string; machine: string };
  evaluations: ShadowCandidateEvaluation[];
  sensitivity: {
    order_dependent: boolean;
    eligible_alternatives: string[];
    rejected_before_selection: string[];
  };
  warnings: string[];
}

export interface OriginContextCandidate {
  candidate_id: string;
  harness: string;
  surface: 'host-native' | 'cli-headless';
  availability: Availability;
  quota: Quota;
  auth: (typeof AUTH)[number];
  model: (typeof MODEL)[number];
  runtime: (typeof RUNTIME)[number];
  qualifications: Array<{ predicate: string; status: QualificationStatus }>;
}

export interface OriginContextRouteSummary {
  task_id: string;
  status: 'ready';
  eligible: boolean;
  outcome: ShadowRouteAdvice['outcome'];
  selected: null | {
    candidate_id: string;
    harness: string;
    surface: 'host-native' | 'cli-headless';
  };
  reason_codes: string[];
}

export interface OriginContextPayload {
  schema: typeof ORIGIN_CONTEXT_SCHEMA;
  cached_only: true;
  shadow_only: true;
  dispatch_enabled: false;
  origin_harness: string;
  available: boolean;
  revisions: { board: string; machine: string };
  freshness: { state: 'fresh' | 'stale' | 'unknown'; valid_until: string };
  contract_activation: 'legacy' | 'enabled' | 'invalid';
  candidates: OriginContextCandidate[];
  cursor_surfaces?: CursorSurfaceContext;
  machine_quota?: MachineQuotaSummary;
  routes: OriginContextRouteSummary[];
  warnings: string[];
  truncation: {
    applied: boolean;
    omitted_candidates: number;
    omitted_routes: number;
    omitted_warnings: number;
    omitted_quota_scopes: number;
    max_bytes: typeof ORCHESTRATOR_CONTEXT_MAX_BYTES;
  };
}

export interface OriginContextContent {
  payload: OriginContextPayload;
  content: string;
  content_bytes: number;
}

function record(value: unknown): value is RecordLike {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function boundedString(value: unknown, max: number): value is string {
  return nonEmpty(value) && value.length <= max;
}

function exactKeys(value: RecordLike, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function strictIso(value: unknown): value is string {
  if (!nonEmpty(value) || !ISO_UTC.test(value)) return false;
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) return false;
  return new Date(epoch).toISOString().replace('.000Z', 'Z') === value;
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmpty);
}

function issue(code: string, path: string, message: string): ContractIssue {
  return { code, path, message };
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate];
}

function secretShapedValue(value: string): boolean {
  // BEGIN ORIGIN_PRIVATE_VALUE_ALGORITHM
  if (SECRET_SK_VALUE.test(value)) return true;
  if (SECRET_JWT_VALUE.test(value)) return true;
  if (SECRET_GITHUB_VALUE.test(value)) return true;
  for (const match of value.matchAll(new RegExp(SECRET_ASSIGNMENT_VALUE.source, 'gi'))) {
    const assignment = match[1]?.toLowerCase();
    if (assignment === undefined || NON_SECRET_ASSIGNMENT_VALUES.has(assignment)) continue;
    return true;
  }
  for (const match of value.matchAll(new RegExp(BEARER_VALUE.source, 'gi'))) {
    const bearer = match[1]?.toLowerCase();
    if (bearer === undefined || NON_SECRET_BEARER_VALUES.has(bearer)) continue;
    const suffix = value.slice((match.index ?? 0) + match[0].length);
    if (
      (bearer === 'authentication' || bearer === 'auth') &&
      NON_SECRET_BEARER_AUTH_STATUS.test(suffix)
    ) {
      continue;
    }
    return true;
  }
  return false;
  // END ORIGIN_PRIVATE_VALUE_ALGORITHM
}

function scanSecrets(value: unknown, path: string, out: ContractIssue[]): void {
  if (typeof value === 'string') {
    if (secretShapedValue(value)) {
      out.push(
        issue(
          'MACHINE-CONTEXT-FORBIDDEN-VALUE',
          path,
          'forbidden credential/token-shaped value is not accepted',
        ),
      );
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      scanSecrets(entry, `${path}[${index}]`, out);
    });
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (SECRET_KEY.test(key)) {
      out.push(
        issue(
          'MACHINE-CONTEXT-FORBIDDEN-FIELD',
          childPath,
          'forbidden secret/private field is not accepted',
        ),
      );
      continue;
    }
    scanSecrets(child, childPath, out);
  }
}

function freshnessAt(
  observedAt: string,
  validUntil: string,
  asOf: string,
): OrchestratorContext['freshness']['state'] {
  if (!strictIso(observedAt) || !strictIso(validUntil) || !strictIso(asOf)) return 'unknown';
  if (Date.parse(asOf) < Date.parse(observedAt)) return 'unknown';
  return Date.parse(asOf) <= Date.parse(validUntil) ? 'fresh' : 'stale';
}

function hasExactKeys(value: RecordLike, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function cursorState(ideInstalled: boolean, agentInstalled: boolean): CursorSurfaceState {
  if (ideInstalled && agentInstalled) return 'both';
  if (ideInstalled) return 'only-ide';
  if (agentInstalled) return 'only-agent';
  return 'neither';
}

function validateCursorSurfaceContext(value: unknown): ContractIssue[] {
  const out: ContractIssue[] = [];
  const rootPath = 'snapshot.cursor_surfaces';
  if (!record(value)) return [issue('CURSOR-SURFACE-SHAPE', rootPath, 'must be an object')];
  if (!hasExactKeys(value, ['schema', 'state', 'surfaces'])) {
    out.push(
      issue('CURSOR-SURFACE-SHAPE', rootPath, 'must contain exactly schema, state, and surfaces'),
    );
  }
  if (value.schema !== CURSOR_SURFACE_CONTEXT_SCHEMA) {
    out.push(
      issue(
        'CURSOR-SURFACE-SCHEMA',
        `${rootPath}.schema`,
        `must equal ${CURSOR_SURFACE_CONTEXT_SCHEMA}`,
      ),
    );
  }
  if (!(CURSOR_SURFACE_STATES as readonly unknown[]).includes(value.state)) {
    out.push(
      issue(
        'CURSOR-SURFACE-STATE',
        `${rootPath}.state`,
        `must be one of ${CURSOR_SURFACE_STATES.join(', ')}`,
      ),
    );
  }
  if (!Array.isArray(value.surfaces) || value.surfaces.length !== CURSOR_SURFACE_SPECS.length) {
    out.push(
      issue(
        'CURSOR-SURFACE-PAIR',
        `${rootPath}.surfaces`,
        'must contain the canonical ordered IDE and Agent descriptors',
      ),
    );
    return out;
  }

  value.surfaces.forEach((surface: unknown, index: number) => {
    const path = `${rootPath}.surfaces[${index}]`;
    const spec = CURSOR_SURFACE_SPECS[index]!;
    if (!record(surface)) {
      out.push(issue('CURSOR-SURFACE-DESCRIPTOR', path, 'must be an object'));
      return;
    }
    if (
      !hasExactKeys(surface, [
        'surface_id',
        'harness',
        'surface',
        'role',
        'installed',
        'auth_state',
        'role_eligible',
        'blocker_codes',
        'provenance',
      ])
    ) {
      out.push(
        issue('CURSOR-SURFACE-DESCRIPTOR', path, 'contains unknown or missing descriptor fields'),
      );
    }
    if (
      surface.surface_id !== spec.surface_id ||
      surface.harness !== 'cursor' ||
      surface.surface !== spec.surface ||
      surface.role !== spec.role
    ) {
      out.push(
        issue(
          'CURSOR-SURFACE-IDENTITY',
          path,
          'descriptor identity, role, and transport must match its canonical surface',
        ),
      );
    }
    if (
      typeof surface.installed !== 'boolean' ||
      !['authenticated', 'unauthenticated', 'unknown'].includes(surface.auth_state) ||
      typeof surface.role_eligible !== 'boolean'
    ) {
      out.push(
        issue(
          'CURSOR-SURFACE-FACT',
          path,
          'installed/role_eligible must be booleans and auth_state must be valid',
        ),
      );
    }
    if (surface.auth_state !== 'unknown' && surface.installed !== true) {
      out.push(
        issue(
          'CURSOR-SURFACE-INFERENCE',
          `${path}.auth_state`,
          'an uninstalled surface cannot claim an authentication state',
        ),
      );
    }
    if (spec.surface_id === 'cursor-ide-plugin' && surface.auth_state !== 'unknown') {
      out.push(
        issue(
          'CURSOR-SURFACE-INFERENCE',
          `${path}.auth_state`,
          'Cursor IDE authentication is not part of this cached plugin-origin slice',
        ),
      );
    }
    if (
      spec.surface_id === 'cursor-agent-cli' &&
      surface.role_eligible === true &&
      surface.auth_state !== 'authenticated'
    ) {
      out.push(
        issue(
          'CURSOR-SURFACE-INFERENCE',
          `${path}.auth_state`,
          'an eligible Agent worker requires independently cached authentication',
        ),
      );
    }
    if (surface.role_eligible === true && surface.installed !== true) {
      out.push(
        issue(
          'CURSOR-SURFACE-INFERENCE',
          `${path}.role_eligible`,
          'an uninstalled surface cannot be role eligible',
        ),
      );
    }
    if (
      !Array.isArray(surface.blocker_codes) ||
      !surface.blocker_codes.every(
        (code: unknown) => typeof code === 'string' && SAFE_PUBLIC_CODE.test(code),
      )
    ) {
      out.push(
        issue(
          'CURSOR-SURFACE-BLOCKERS',
          `${path}.blocker_codes`,
          'must be an array of safe machine-readable codes',
        ),
      );
    } else {
      if (duplicateValues(surface.blocker_codes).length > 0) {
        out.push(
          issue(
            'CURSOR-SURFACE-BLOCKERS',
            `${path}.blocker_codes`,
            'must not contain duplicate blocker codes',
          ),
        );
      }
      if (surface.role_eligible === true && surface.blocker_codes.length !== 0) {
        out.push(
          issue(
            'CURSOR-SURFACE-INFERENCE',
            `${path}.blocker_codes`,
            'an eligible surface cannot carry blockers',
          ),
        );
      }
      if (surface.role_eligible === false && surface.blocker_codes.length === 0) {
        out.push(
          issue(
            'CURSOR-SURFACE-INFERENCE',
            `${path}.blocker_codes`,
            'an ineligible surface must retain at least one blocker',
          ),
        );
      }
    }
    if (
      !record(surface.provenance) ||
      !hasExactKeys(surface.provenance, ['installed', 'authentication', 'role_eligibility'])
    ) {
      out.push(
        issue(
          'CURSOR-SURFACE-PROVENANCE',
          `${path}.provenance`,
          'must contain exactly installed, authentication, and role_eligibility provenance',
        ),
      );
      return;
    }
    if (surface.provenance.installed !== spec.installed_source) {
      out.push(
        issue(
          'CURSOR-SURFACE-PROVENANCE',
          `${path}.provenance.installed`,
          'installation provenance belongs to the wrong surface',
        ),
      );
    }
    if (
      (surface.provenance.authentication !== null &&
        surface.provenance.authentication !== spec.authentication_source) ||
      (surface.auth_state !== 'unknown' &&
        surface.provenance.authentication !== spec.authentication_source)
    ) {
      out.push(
        issue(
          'CURSOR-SURFACE-PROVENANCE',
          `${path}.provenance.authentication`,
          'authentication provenance belongs to the wrong surface or is missing',
        ),
      );
    }
    if (
      !Array.isArray(surface.provenance.role_eligibility) ||
      !surface.provenance.role_eligibility.every(
        (source: unknown) =>
          typeof source === 'string' &&
          (spec.eligibility_sources as readonly string[]).includes(source),
      ) ||
      duplicateValues(
        Array.isArray(surface.provenance.role_eligibility)
          ? surface.provenance.role_eligibility.filter(
              (source: unknown): source is string => typeof source === 'string',
            )
          : [],
      ).length > 0
    ) {
      out.push(
        issue(
          'CURSOR-SURFACE-PROVENANCE',
          `${path}.provenance.role_eligibility`,
          'eligibility provenance must be a unique surface-local source subset',
        ),
      );
    } else if (
      surface.role_eligible === true &&
      surface.provenance.role_eligibility.length !== spec.eligibility_sources.length
    ) {
      out.push(
        issue(
          'CURSOR-SURFACE-PROVENANCE',
          `${path}.provenance.role_eligibility`,
          'eligible surfaces require every approved role qualification source',
        ),
      );
    }
  });

  const ide = value.surfaces[0];
  const agent = value.surfaces[1];
  if (
    record(ide) &&
    typeof ide.installed === 'boolean' &&
    record(agent) &&
    typeof agent.installed === 'boolean' &&
    value.state !== cursorState(ide.installed, agent.installed)
  ) {
    out.push(
      issue(
        'CURSOR-SURFACE-STATE',
        `${rootPath}.state`,
        'must equal the deterministic state derived from the two installed facts',
      ),
    );
  }
  return out;
}

export function validateMachineQuotaSummary(
  value: unknown,
  rootPath = 'machine_quota',
): ContractIssue[] {
  if (!record(value)) return [issue('MACHINE-QUOTA-SHAPE', rootPath, 'must be an object')];
  const out: ContractIssue[] = [];
  scanSecrets(value, rootPath, out);
  if (!exactKeys(value, ['schema', 'decisions']) || value.schema !== MACHINE_QUOTA_SUMMARY_SCHEMA) {
    out.push(
      issue(
        'MACHINE-QUOTA-SCHEMA',
        rootPath,
        `must contain exactly schema=${MACHINE_QUOTA_SUMMARY_SCHEMA} and decisions`,
      ),
    );
  }
  if (!Array.isArray(value.decisions)) {
    out.push(issue('MACHINE-QUOTA-DECISIONS', `${rootPath}.decisions`, 'must be an array'));
    return out;
  }
  const scopes: string[] = [];
  value.decisions.forEach((decision: unknown, index: number) => {
    const path = `${rootPath}.decisions[${index}]`;
    if (!record(decision)) {
      out.push(issue('MACHINE-QUOTA-DECISION', path, 'must be an object'));
      return;
    }
    if (
      !exactKeys(decision, [
        'scope_digest',
        'target',
        'policy_digest',
        'requirement_digest',
        'state',
        'freshness',
        'reason_codes',
        'decision_revision',
        'observation_revision',
        'fanout_covered',
      ])
    ) {
      out.push(issue('MACHINE-QUOTA-DECISION', path, 'contains unknown or missing fields'));
    }
    for (const field of [
      'scope_digest',
      'policy_digest',
      'requirement_digest',
      'decision_revision',
      'observation_revision',
    ]) {
      if (typeof decision[field] !== 'string' || !SHA256_DIGEST.test(decision[field])) {
        out.push(issue('MACHINE-QUOTA-DIGEST', `${path}.${field}`, 'must be a sha256 digest'));
      }
    }
    if (typeof decision.scope_digest === 'string') scopes.push(decision.scope_digest);
    if (!record(decision.target)) {
      out.push(issue('MACHINE-QUOTA-TARGET', `${path}.target`, 'must be an object'));
    } else {
      const target = decision.target;
      if (
        !exactKeys(target, [
          'harness_id',
          'surface_id',
          'provider_id',
          'identity_scope_digest',
          'payer_scope',
          'pool_scope_digest',
          'bucket_id',
          'unit',
          'window',
        ])
      ) {
        out.push(
          issue('MACHINE-QUOTA-TARGET', `${path}.target`, 'contains unknown or missing fields'),
        );
      }
      for (const field of [
        'harness_id',
        'surface_id',
        'provider_id',
        'payer_scope',
        'bucket_id',
        'unit',
      ]) {
        if (!boundedString(target[field], 128)) {
          out.push(issue('MACHINE-QUOTA-TARGET', `${path}.target.${field}`, 'must be bounded'));
        }
      }
      for (const field of ['identity_scope_digest', 'pool_scope_digest']) {
        if (typeof target[field] !== 'string' || !SHA256_DIGEST.test(target[field])) {
          out.push(
            issue('MACHINE-QUOTA-DIGEST', `${path}.target.${field}`, 'must be a sha256 digest'),
          );
        }
      }
      if (
        !record(target.window) ||
        !exactKeys(target.window, ['kind', 'name', 'duration_sec']) ||
        !boundedString(target.window.kind, 64) ||
        !boundedString(target.window.name, 64) ||
        !Number.isSafeInteger(target.window.duration_sec) ||
        target.window.duration_sec <= 0
      ) {
        out.push(
          issue('MACHINE-QUOTA-WINDOW', `${path}.target.window`, 'must be a bounded window'),
        );
      }
    }
    if (!['healthy', 'tight', 'exhausted', 'stale', 'unknown'].includes(decision.state)) {
      out.push(issue('MACHINE-QUOTA-STATE', `${path}.state`, 'must be a closed quota state'));
    }
    if (!['fresh', 'soft-stale', 'hard-stale', 'unknown'].includes(decision.freshness)) {
      out.push(
        issue('MACHINE-QUOTA-FRESHNESS', `${path}.freshness`, 'must be a closed freshness state'),
      );
    }
    if (
      !Array.isArray(decision.reason_codes) ||
      decision.reason_codes.some(
        (candidate: unknown) =>
          typeof candidate !== 'string' || !MACHINE_QUOTA_REASON.test(candidate),
      )
    ) {
      out.push(issue('MACHINE-QUOTA-REASONS', `${path}.reason_codes`, 'must be safe codes'));
    }
    if (typeof decision.fanout_covered !== 'boolean') {
      out.push(issue('MACHINE-QUOTA-COVERAGE', `${path}.fanout_covered`, 'must be boolean'));
    }
  });
  if (
    new Set(scopes).size !== scopes.length ||
    scopes.some((scope, i) => i > 0 && scopes[i - 1]! > scope)
  ) {
    out.push(
      issue(
        'MACHINE-QUOTA-ORDER',
        `${rootPath}.decisions`,
        'must be unique and ordered by scope_digest',
      ),
    );
  }
  return out;
}

export function validateMachineContextCache(value: unknown): ContractIssue[] {
  if (!record(value)) return [issue('MACHINE-CONTEXT-SHAPE', 'snapshot', 'must be an object')];
  const out: ContractIssue[] = [];
  scanSecrets(value, 'snapshot', out);
  if (value.schema !== MACHINE_CONTEXT_CACHE_SCHEMA) {
    out.push(
      issue(
        'MACHINE-CONTEXT-SCHEMA',
        'snapshot.schema',
        `must equal ${MACHINE_CONTEXT_CACHE_SCHEMA}`,
      ),
    );
  }
  if (!boundedString(value.revision, MAX_REVISION_LENGTH)) {
    out.push(
      issue(
        'MACHINE-CONTEXT-REVISION',
        'snapshot.revision',
        `must be non-empty and <= ${MAX_REVISION_LENGTH} characters`,
      ),
    );
  }
  if (!boundedString(value.board_revision, MAX_REVISION_LENGTH)) {
    out.push(
      issue(
        'MACHINE-CONTEXT-REVISION',
        'snapshot.board_revision',
        `must be non-empty and <= ${MAX_REVISION_LENGTH} characters`,
      ),
    );
  }
  if (!strictIso(value.observed_at)) {
    out.push(issue('MACHINE-CONTEXT-TIME', 'snapshot.observed_at', 'must be strict ISO-8601 UTC'));
  }
  if (!strictIso(value.valid_until)) {
    out.push(issue('MACHINE-CONTEXT-TIME', 'snapshot.valid_until', 'must be strict ISO-8601 UTC'));
  }
  if (
    strictIso(value.observed_at) &&
    strictIso(value.valid_until) &&
    Date.parse(value.observed_at) > Date.parse(value.valid_until)
  ) {
    out.push(issue('MACHINE-CONTEXT-TIME', 'snapshot', 'must satisfy observed_at <= valid_until'));
  }
  if (!strings(value.warnings)) {
    out.push(issue('MACHINE-CONTEXT-WARNINGS', 'snapshot.warnings', 'must be a string array'));
  }
  if (value.cursor_surfaces !== undefined) {
    out.push(...validateCursorSurfaceContext(value.cursor_surfaces));
  }
  if (!Array.isArray(value.candidates)) {
    out.push(issue('MACHINE-CONTEXT-CANDIDATES', 'snapshot.candidates', 'must be an array'));
    return out;
  }

  const candidateIds: string[] = [];
  value.candidates.forEach((candidate: unknown, index: number) => {
    const path = `snapshot.candidates[${index}]`;
    if (!record(candidate)) {
      out.push(issue('MACHINE-CONTEXT-CANDIDATE', path, 'must be an object'));
      return;
    }
    for (const [field, max] of [
      ['candidate_id', MAX_ID_LENGTH],
      ['harness', MAX_HARNESS_LENGTH],
    ] as const) {
      if (!boundedString(candidate[field], max)) {
        out.push(
          issue(
            'MACHINE-CONTEXT-CANDIDATE',
            `${path}.${field}`,
            `must be non-empty and <= ${max} characters`,
          ),
        );
      }
    }
    if (nonEmpty(candidate.candidate_id)) candidateIds.push(candidate.candidate_id);
    if (!['host-native', 'cli-headless'].includes(candidate.surface)) {
      out.push(
        issue(
          'MACHINE-CONTEXT-CANDIDATE',
          `${path}.surface`,
          'must be host-native or cli-headless',
        ),
      );
    }
    if (!(AVAILABILITY as readonly unknown[]).includes(candidate.availability)) {
      out.push(
        issue(
          'MACHINE-CONTEXT-CANDIDATE',
          `${path}.availability`,
          'must be available, unavailable, or unknown',
        ),
      );
    }
    if (!(QUOTA as readonly unknown[]).includes(candidate.quota)) {
      out.push(
        issue(
          'MACHINE-CONTEXT-CANDIDATE',
          `${path}.quota`,
          'must be ample, tight, exhausted, or unknown',
        ),
      );
    }
    for (const [field, allowed] of [
      ['auth', AUTH],
      ['model', MODEL],
      ['runtime', RUNTIME],
    ] as const) {
      if (!(allowed as readonly unknown[]).includes(candidate[field])) {
        out.push(
          issue(
            'MACHINE-CONTEXT-CANDIDATE',
            `${path}.${field}`,
            `must be one of ${allowed.join(', ')}`,
          ),
        );
      }
    }
    if (!Array.isArray(candidate.qualifications)) {
      out.push(
        issue('MACHINE-CONTEXT-QUALIFICATIONS', `${path}.qualifications`, 'must be an array'),
      );
      return;
    }
    const predicates: string[] = [];
    candidate.qualifications.forEach((qualification: unknown, qIndex: number) => {
      const qPath = `${path}.qualifications[${qIndex}]`;
      if (!record(qualification) || !boundedString(qualification.predicate, MAX_PREDICATE_LENGTH)) {
        out.push(
          issue(
            'MACHINE-CONTEXT-QUALIFICATION',
            qPath,
            `must name a non-empty predicate <= ${MAX_PREDICATE_LENGTH} characters`,
          ),
        );
        return;
      }
      predicates.push(qualification.predicate);
      if (!(QUALIFICATION as readonly unknown[]).includes(qualification.status)) {
        out.push(
          issue(
            'MACHINE-CONTEXT-QUALIFICATION',
            `${qPath}.status`,
            'must be pass, fail, or unknown',
          ),
        );
      }
      if (qualification.ref !== undefined && !nonEmpty(qualification.ref)) {
        out.push(
          issue('MACHINE-CONTEXT-QUALIFICATION', `${qPath}.ref`, 'must be non-empty when set'),
        );
      }
    });
    if (duplicateValues(predicates).length) {
      out.push(
        issue(
          'MACHINE-CONTEXT-QUALIFICATIONS',
          `${path}.qualifications`,
          `contains duplicate predicates: ${duplicateValues(predicates).join(', ')}`,
        ),
      );
    }
    const runtimeQualification = candidate.qualifications.find(
      (entry: unknown) => record(entry) && entry.predicate === 'runtime-healthy',
    );
    const expectedRuntimeStatus =
      candidate.runtime === 'healthy'
        ? 'pass'
        : candidate.runtime === 'unhealthy'
          ? 'fail'
          : candidate.runtime === 'unknown'
            ? 'unknown'
            : null;
    if (
      record(runtimeQualification) &&
      expectedRuntimeStatus !== null &&
      runtimeQualification.status !== expectedRuntimeStatus
    ) {
      out.push(
        issue(
          'MACHINE-CONTEXT-RUNTIME-CONTRADICTION',
          `${path}.qualifications`,
          'runtime-healthy qualification contradicts the independent runtime fact',
        ),
      );
    }
  });
  if (duplicateValues(candidateIds).length) {
    out.push(
      issue(
        'MACHINE-CONTEXT-CANDIDATES',
        'snapshot.candidates',
        `contains duplicate candidate ids: ${duplicateValues(candidateIds).join(', ')}`,
      ),
    );
  }
  return out;
}

function contractError(
  message: string,
  issues: ContractIssue[],
): Error & { issues: ContractIssue[] } {
  const detail = issues.map((entry) => `${entry.path}: ${entry.message}`).join('; ');
  const error = new Error(`${message}: ${detail}`) as Error & { issues: ContractIssue[] };
  error.issues = issues;
  return error;
}

function shortenPublic(value: string, max: number, counter: { value: number }): string {
  if (value.length <= max) return value;
  counter.value++;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function projectCandidate(
  candidate: CachedCandidateFact,
  shortened: { value: number },
): CachedCandidateFact {
  return {
    candidate_id: candidate.candidate_id,
    harness: candidate.harness,
    surface: candidate.surface,
    availability: candidate.availability,
    quota: candidate.quota,
    auth: candidate.auth,
    model: candidate.model,
    runtime: candidate.runtime,
    qualifications: candidate.qualifications.map((qualification) => ({
      predicate: qualification.predicate,
      status: qualification.status,
      ...(qualification.ref === undefined
        ? {}
        : { ref: shortenPublic(qualification.ref, MAX_REF_LENGTH, shortened) }),
    })),
  };
}

function contextBytes(context: OrchestratorContext): number {
  return new TextEncoder().encode(JSON.stringify(context)).byteLength;
}

function boundContextProjection(
  value: Omit<OrchestratorContext, 'truncation'>,
): OrchestratorContext {
  const shortened = { value: 0 };
  const originalCandidates = value.candidates.length;
  const originalWarnings = value.warnings.length;
  const originalQuotaScopes = value.machine_quota?.decisions.length ?? 0;
  const result: OrchestratorContext = {
    ...value,
    candidates: value.candidates.map((candidate) => projectCandidate(candidate, shortened)),
    warnings: value.warnings.map((warning) =>
      shortenPublic(warning, MAX_WARNING_LENGTH, shortened),
    ),
    ...(value.machine_quota ? { machine_quota: structuredClone(value.machine_quota) } : {}),
    truncation: {
      applied: shortened.value > 0,
      omitted_candidates: 0,
      omitted_warnings: 0,
      shortened_fields: shortened.value,
      omitted_quota_scopes: 0,
      max_bytes: ORCHESTRATOR_CONTEXT_MAX_BYTES,
    },
  };

  while (contextBytes(result) > ORCHESTRATOR_CONTEXT_MAX_BYTES && result.warnings.length > 0) {
    result.warnings.pop();
    result.truncation.omitted_warnings = originalWarnings - result.warnings.length;
    result.truncation.applied = true;
  }
  while (
    contextBytes(result) > ORCHESTRATOR_CONTEXT_MAX_BYTES &&
    result.machine_quota &&
    result.machine_quota.decisions.length > 0
  ) {
    result.machine_quota.decisions.pop();
    result.truncation.omitted_quota_scopes =
      originalQuotaScopes - result.machine_quota.decisions.length;
    result.truncation.applied = true;
  }
  while (contextBytes(result) > ORCHESTRATOR_CONTEXT_MAX_BYTES && result.candidates.length > 0) {
    result.candidates.pop();
    result.truncation.omitted_candidates = originalCandidates - result.candidates.length;
    result.truncation.applied = true;
  }
  if (contextBytes(result) > ORCHESTRATOR_CONTEXT_MAX_BYTES) {
    throw new Error('orchestrator context load-bearing envelope exceeds 4096 bytes');
  }
  return result;
}

export function buildCachedOrchestratorContext(input: {
  originHarness: string;
  boardRevision: string;
  snapshot: unknown;
  asOf: string;
  machineQuota?: unknown;
}): OrchestratorContext {
  const issues = validateMachineContextCache(input.snapshot);
  if (input.machineQuota !== undefined) {
    issues.push(...validateMachineQuotaSummary(input.machineQuota));
  }
  if (!boundedString(input.originHarness, MAX_ORIGIN_LENGTH)) {
    issues.push(
      issue(
        'ORCHESTRATOR-CONTEXT-ORIGIN',
        'origin_harness',
        `must be non-empty and <= ${MAX_ORIGIN_LENGTH} characters`,
      ),
    );
  }
  if (!boundedString(input.boardRevision, MAX_REVISION_LENGTH)) {
    issues.push(
      issue(
        'ORCHESTRATOR-CONTEXT-REVISION',
        'board_revision',
        `must be non-empty and <= ${MAX_REVISION_LENGTH} characters`,
      ),
    );
  }
  if (!strictIso(input.asOf)) {
    issues.push(issue('ORCHESTRATOR-CONTEXT-TIME', 'as_of', 'must be strict ISO-8601 UTC'));
  }
  if (issues.length) throw contractError('invalid cached machine context', issues);

  const snapshot = input.snapshot as MachineContextCache;
  const warnings = [...snapshot.warnings];
  if (snapshot.board_revision !== input.boardRevision) warnings.push('board-revision-mismatch');
  const freshness = freshnessAt(snapshot.observed_at, snapshot.valid_until, input.asOf);
  if (freshness === 'stale') warnings.push('machine-context-stale');
  if (freshness === 'unknown') warnings.push('machine-context-not-yet-observed');

  return boundContextProjection({
    schema: ORCHESTRATOR_CONTEXT_SCHEMA,
    cached_only: true,
    available: true,
    origin_harness: input.originHarness,
    revisions: { board: snapshot.board_revision, machine: snapshot.revision },
    freshness: {
      state: freshness,
      observed_at: snapshot.observed_at,
      valid_until: snapshot.valid_until,
      as_of: input.asOf,
    },
    candidates: snapshot.candidates,
    ...(snapshot.cursor_surfaces
      ? { cursor_surfaces: structuredClone(snapshot.cursor_surfaces) }
      : {}),
    ...(input.machineQuota
      ? { machine_quota: structuredClone(input.machineQuota) as MachineQuotaSummary }
      : {}),
    warnings: [...new Set(warnings)],
  });
}

export function attachMachineQuotaSummary(
  context: OrchestratorContext,
  summary: unknown,
): OrchestratorContext {
  const issues = [...validateContext(context), ...validateMachineQuotaSummary(summary)];
  if (issues.length) throw contractError('invalid machine quota context attachment', issues);
  const { truncation: _truncation, ...base } = context;
  return boundContextProjection({
    ...base,
    machine_quota: structuredClone(summary) as MachineQuotaSummary,
  });
}

function validateContext(value: unknown): ContractIssue[] {
  if (!record(value)) return [issue('ORCHESTRATOR-CONTEXT-SHAPE', 'context', 'must be an object')];
  const out: ContractIssue[] = [];
  scanSecrets(value, 'context', out);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > ORCHESTRATOR_CONTEXT_MAX_BYTES) {
    out.push(
      issue(
        'ORCHESTRATOR-CONTEXT-SIZE',
        'context',
        `serialized public context must be <= ${ORCHESTRATOR_CONTEXT_MAX_BYTES} bytes`,
      ),
    );
  }
  if (
    value.schema !== ORCHESTRATOR_CONTEXT_SCHEMA ||
    value.cached_only !== true ||
    typeof value.available !== 'boolean'
  ) {
    out.push(
      issue(
        'ORCHESTRATOR-CONTEXT-SCHEMA',
        'context',
        `must be ${ORCHESTRATOR_CONTEXT_SCHEMA} with cached_only=true and available:boolean`,
      ),
    );
  }
  if (!boundedString(value.origin_harness, MAX_ORIGIN_LENGTH)) {
    out.push(
      issue(
        'ORCHESTRATOR-CONTEXT-ORIGIN',
        'context.origin_harness',
        `must be non-empty and <= ${MAX_ORIGIN_LENGTH} characters`,
      ),
    );
  }
  if (
    !record(value.revisions) ||
    !boundedString(value.revisions.board, MAX_REVISION_LENGTH) ||
    !boundedString(value.revisions.machine, MAX_REVISION_LENGTH)
  ) {
    out.push(
      issue('ORCHESTRATOR-CONTEXT-REVISION', 'context.revisions', 'must contain board and machine'),
    );
  }
  if (!record(value.freshness)) {
    out.push(issue('ORCHESTRATOR-CONTEXT-FRESHNESS', 'context.freshness', 'must be an object'));
  } else {
    const stateValid = ['fresh', 'stale', 'unknown'].includes(value.freshness.state);
    const timestampsValid = ['observed_at', 'valid_until', 'as_of'].every((field) =>
      strictIso(value.freshness[field]),
    );
    if (!stateValid || !timestampsValid) {
      out.push(
        issue(
          'ORCHESTRATOR-CONTEXT-FRESHNESS',
          'context.freshness',
          'must contain a legal state and strict observed_at, valid_until, and as_of timestamps',
        ),
      );
    } else if (Date.parse(value.freshness.observed_at) > Date.parse(value.freshness.valid_until)) {
      out.push(
        issue(
          'ORCHESTRATOR-CONTEXT-FRESHNESS',
          'context.freshness',
          'must satisfy observed_at <= valid_until',
        ),
      );
    } else if (
      value.freshness.state !==
      freshnessAt(value.freshness.observed_at, value.freshness.valid_until, value.freshness.as_of)
    ) {
      out.push(
        issue(
          'ORCHESTRATOR-CONTEXT-FRESHNESS',
          'context.freshness.state',
          'contradicts the public freshness timestamps',
        ),
      );
    }
  }
  if (!Array.isArray(value.candidates)) {
    out.push(issue('ORCHESTRATOR-CONTEXT-CANDIDATES', 'context.candidates', 'must be an array'));
  }
  if (!strings(value.warnings)) {
    out.push(issue('ORCHESTRATOR-CONTEXT-WARNINGS', 'context.warnings', 'must be string[]'));
  }
  if (value.machine_quota !== undefined) {
    out.push(...validateMachineQuotaSummary(value.machine_quota, 'context.machine_quota'));
  }
  if (
    !record(value.truncation) ||
    typeof value.truncation.applied !== 'boolean' ||
    !Number.isInteger(value.truncation.omitted_candidates) ||
    value.truncation.omitted_candidates < 0 ||
    !Number.isInteger(value.truncation.omitted_warnings) ||
    value.truncation.omitted_warnings < 0 ||
    !Number.isInteger(value.truncation.shortened_fields) ||
    value.truncation.shortened_fields < 0 ||
    !Number.isInteger(value.truncation.omitted_quota_scopes) ||
    value.truncation.omitted_quota_scopes < 0 ||
    value.truncation.max_bytes !== ORCHESTRATOR_CONTEXT_MAX_BYTES
  ) {
    out.push(
      issue(
        'ORCHESTRATOR-CONTEXT-TRUNCATION',
        'context.truncation',
        'must contain deterministic non-negative truncation metadata and max_bytes=4096',
      ),
    );
  } else if (
    value.truncation.applied !==
    (value.truncation.omitted_candidates > 0 ||
      value.truncation.omitted_warnings > 0 ||
      value.truncation.shortened_fields > 0 ||
      value.truncation.omitted_quota_scopes > 0)
  ) {
    out.push(
      issue(
        'ORCHESTRATOR-CONTEXT-TRUNCATION',
        'context.truncation.applied',
        'must equal whether any candidate, warning, or field was truncated',
      ),
    );
  }
  if (
    record(value.revisions) &&
    record(value.freshness) &&
    Array.isArray(value.candidates) &&
    strings(value.warnings)
  ) {
    out.push(
      ...validateMachineContextCache({
        schema: MACHINE_CONTEXT_CACHE_SCHEMA,
        revision: value.revisions.machine,
        board_revision: value.revisions.board,
        observed_at: value.freshness.observed_at,
        valid_until: value.freshness.valid_until,
        candidates: value.candidates,
        ...(value.cursor_surfaces === undefined ? {} : { cursor_surfaces: value.cursor_surfaces }),
        warnings: value.warnings,
      }).map((entry) => ({
        ...entry,
        path: entry.path.replace(/^snapshot/, 'context'),
      })),
    );
  }
  return out;
}

function deriveQualification(
  predicate: string,
  fact: CachedCandidateFact | undefined,
): CachedQualification {
  if (CONTRACT_PREDICATES.has(predicate)) {
    return { predicate, status: 'pass', ref: `contract://routing/${predicate}` };
  }
  const cached = fact?.qualifications.find((entry) => entry.predicate === predicate);
  return cached
    ? structuredClone(cached)
    : { predicate, status: 'unknown', ref: 'cache://qualification/missing' };
}

function outcomeFor(
  originHarness: string,
  selected: RecordLike,
  originStay: boolean,
): ShadowRouteAdvice['outcome'] {
  const routing = {
    policy: { candidates: [selected] },
    selected: {
      candidate_id: selected.id,
      reason_codes: originStay ? ['origin-stay-cli-ineligible'] : ['shadow-first-eligible'],
    },
  };
  const outcome = routeOutcomeClass(originHarness, routing);
  return outcome === 'invalid' || outcome === 'no-route' ? 'no-route' : outcome;
}

export function adviseShadowRoute(input: {
  task: unknown;
  context: unknown;
  originHarness: string;
  boardRevision: string;
  asOf: string;
}): ShadowRouteAdvice {
  const issues = [
    ...validateContext(input.context),
    ...validateTaskPlanning(record(input.task) ? input.task.planning : undefined),
    ...validateTaskRoutePolicy(input.task),
  ];
  if (!boundedString(input.originHarness, MAX_ORIGIN_LENGTH)) {
    issues.push(
      issue(
        'SHADOW-ROUTE-ORIGIN',
        'origin_harness',
        `must be non-empty and <= ${MAX_ORIGIN_LENGTH} characters`,
      ),
    );
  }
  if (
    record(input.context) &&
    nonEmpty(input.context.origin_harness) &&
    input.context.origin_harness !== input.originHarness
  ) {
    issues.push(
      issue(
        'SHADOW-ROUTE-ORIGIN',
        'context.origin_harness',
        'must equal the advice origin harness',
      ),
    );
  }
  if (!boundedString(input.boardRevision, MAX_REVISION_LENGTH)) {
    issues.push(
      issue(
        'SHADOW-ROUTE-REVISION',
        'board_revision',
        `must be non-empty and <= ${MAX_REVISION_LENGTH} characters`,
      ),
    );
  }
  if (!strictIso(input.asOf)) {
    issues.push(issue('SHADOW-ROUTE-TIME', 'as_of', 'must be strict ISO-8601 UTC'));
  }
  if (issues.length) throw contractError('invalid shadow route input', issues);

  const task = input.task as RecordLike;
  const context = input.context as OrchestratorContext;
  const policy = task.routing.policy as RecordLike;
  const chain = task.planning.budget.posture as 'ample' | 'tight';
  const chainIds = policy.chains[chain] as string[];
  const candidates = policy.candidates as RecordLike[];
  const facts = new Map(context.candidates.map((entry) => [entry.candidate_id, entry]));
  const warnings = [...context.warnings];
  if (context.freshness.state === 'stale') warnings.push('machine-context-stale');
  if (context.freshness.state === 'unknown') warnings.push('machine-context-not-yet-observed');
  const adviceFreshness = freshnessAt(
    context.freshness.observed_at,
    context.freshness.valid_until,
    input.asOf,
  );
  if (adviceFreshness === 'stale') warnings.push('machine-context-stale');
  if (adviceFreshness === 'unknown') warnings.push('machine-context-not-yet-observed');
  if (context.revisions.board !== input.boardRevision) warnings.push('board-revision-mismatch');
  const globalBlocked =
    context.available !== true ||
    context.freshness.state !== 'fresh' ||
    adviceFreshness !== 'fresh' ||
    context.revisions.board !== input.boardRevision;

  const evaluations: ShadowCandidateEvaluation[] = chainIds.map((candidateId) => {
    const candidate = candidates.find((entry) => entry.id === candidateId) as RecordLike;
    const fact = facts.get(candidateId);
    const reasonCodes: string[] = [];
    if (globalBlocked) reasonCodes.push('frozen-input-invalid');
    if (context.available !== true) reasonCodes.push('context-unavailable');
    if (context.freshness.state !== 'fresh') {
      reasonCodes.push(`context-freshness-${context.freshness.state}`);
    }
    if (adviceFreshness !== 'fresh') reasonCodes.push(`advice-time-${adviceFreshness}`);
    if (context.revisions.board !== input.boardRevision)
      reasonCodes.push('board-revision-mismatch');
    if (!fact) {
      reasonCodes.push('candidate-facts-missing');
    } else {
      if (fact.harness !== candidate.harness) reasonCodes.push('candidate-harness-mismatch');
      if (fact.surface !== candidate.surface) reasonCodes.push('candidate-surface-mismatch');
      if (fact.availability !== 'available') {
        reasonCodes.push(`availability-${fact.availability}`);
      }
      if (fact.auth !== 'authenticated') reasonCodes.push(`auth-${fact.auth}`);
      if (fact.model !== 'available') reasonCodes.push(`model-${fact.model}`);
      if (fact.runtime !== 'healthy') reasonCodes.push(`runtime-${fact.runtime}`);
      if (fact.quota === 'unknown' || fact.quota === 'exhausted') {
        reasonCodes.push(`quota-${fact.quota}`);
      }
      if (candidate.surface === 'cli-headless' && fact.quota !== 'ample') {
        reasonCodes.push('cli-quota-not-ample');
      }
    }
    if (candidate.surface === 'host-native' && candidate.harness !== input.originHarness) {
      reasonCodes.push('host-native-origin-mismatch');
    }
    const qualificationResults = (candidate.requires as string[]).map((predicate) =>
      deriveQualification(predicate, fact),
    );
    for (const qualification of qualificationResults) {
      if (qualification.status !== 'pass') {
        reasonCodes.push(`qualification-${qualification.predicate}-${qualification.status}`);
      }
    }
    const eligible = reasonCodes.length === 0;
    if (eligible) reasonCodes.push('candidate-eligible');
    return {
      candidate_id: candidateId,
      harness: candidate.harness,
      surface: candidate.surface,
      eligible,
      reason_codes: [...new Set(reasonCodes)],
      qualification_results: qualificationResults,
    };
  });

  const selectedIndex = evaluations.findIndex((entry) => entry.eligible);
  const selectedEvaluation = selectedIndex >= 0 ? evaluations[selectedIndex] : undefined;
  const selectedCandidate = selectedEvaluation
    ? candidates.find((entry) => entry.id === selectedEvaluation.candidate_id)
    : undefined;
  const rejectedBeforeSelection =
    selectedIndex < 0
      ? evaluations.filter((entry) => !entry.eligible).map((entry) => entry.candidate_id)
      : evaluations
          .slice(0, selectedIndex)
          .filter((entry) => !entry.eligible)
          .map((entry) => entry.candidate_id);
  const originStay = Boolean(
    selectedCandidate?.surface === 'host-native' &&
      evaluations
        .slice(0, selectedIndex)
        .some((entry) => entry.surface === 'cli-headless' && !entry.eligible),
  );
  const selected = selectedCandidate
    ? {
        candidate_id: selectedCandidate.id,
        harness: selectedCandidate.harness,
        surface: selectedCandidate.surface,
        model: selectedCandidate.model,
        effort: selectedCandidate.effort,
      }
    : null;
  const eligibleAlternatives = evaluations
    .filter((entry) => entry.eligible && entry.candidate_id !== selected?.candidate_id)
    .map((entry) => entry.candidate_id);
  const reasonCodes = selected
    ? originStay
      ? ['origin-stay-cli-ineligible', 'shadow-first-eligible']
      : ['shadow-first-eligible']
    : ['no-eligible-candidate'];

  return {
    schema: SHADOW_ROUTE_ADVICE_SCHEMA,
    advisory_only: true,
    spawned: false,
    eligible: selected !== null,
    outcome: selectedCandidate
      ? outcomeFor(input.originHarness, selectedCandidate, originStay)
      : 'no-route',
    chain,
    selected,
    reason_codes: reasonCodes,
    revisions: { board: input.boardRevision, machine: context.revisions.machine },
    evaluations,
    sensitivity: {
      order_dependent: eligibleAlternatives.length > 0,
      eligible_alternatives: eligibleAlternatives,
      rejected_before_selection: rejectedBeforeSelection,
    },
    warnings: [...new Set(warnings)],
  };
}

function safePublicId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_PUBLIC_ID.test(value) && !secretShapedValue(value);
}

function safePublicHarness(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_HARNESS_LENGTH &&
    /^[a-z0-9][a-z0-9-]*$/.test(value)
  );
}

function safeWarningCodes(values: string[]): string[] {
  return [...new Set(values.filter((value) => SAFE_PUBLIC_CODE.test(value)))];
}

function originAmbient(payload: OriginContextPayload): string {
  return `<ambient source="orchestrator-context">${JSON.stringify(payload)}</ambient>`;
}

function agentCandidate(candidate: CachedCandidateFact): OriginContextCandidate | null {
  if (!safePublicId(candidate.candidate_id) || !safePublicHarness(candidate.harness)) return null;
  return {
    candidate_id: candidate.candidate_id,
    harness: candidate.harness,
    surface: candidate.surface,
    availability: candidate.availability,
    quota: candidate.quota,
    auth: candidate.auth,
    model: candidate.model,
    runtime: candidate.runtime,
    qualifications: candidate.qualifications
      .filter((entry) => SAFE_PUBLIC_CODE.test(entry.predicate))
      .map((entry) => ({ predicate: entry.predicate, status: entry.status })),
  };
}

/**
 * Build the complete agent-visible ambient payload for every origin adapter.
 *
 * This is deliberately pure and stricter than the raw context endpoint: refs, arbitrary warning
 * prose, route policy internals, model names and provider data never cross this boundary.
 */
export function buildOriginContextContent(input: {
  board: unknown;
  context: unknown;
  originHarness: string;
  boardRevision: string;
  asOf: string;
}): OriginContextContent {
  const contextIssues = validateContext(input.context);
  if (contextIssues.length) throw contractError('invalid origin context input', contextIssues);
  if (!safePublicHarness(input.originHarness)) {
    throw contractError('invalid origin context input', [
      issue('ORIGIN-CONTEXT-ORIGIN', 'origin_harness', 'must be a safe harness id'),
    ]);
  }
  if (!strictIso(input.asOf)) {
    throw contractError('invalid origin context input', [
      issue('ORIGIN-CONTEXT-TIME', 'as_of', 'must be strict ISO-8601 UTC'),
    ]);
  }

  const context = input.context as OrchestratorContext;
  const board = record(input.board) ? input.board : {};
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  const activation = contractActivation(board);
  const warnings = safeWarningCodes(context.warnings);
  const projectedCandidates = context.candidates
    .map(agentCandidate)
    .filter((entry): entry is OriginContextCandidate => entry !== null);
  if (projectedCandidates.length !== context.candidates.length) {
    warnings.push('unsafe-candidate-omitted');
  }

  const readyTasks =
    activation === 'enabled' ? tasks.filter((task) => record(task) && task.status === 'ready') : [];
  const routes: OriginContextRouteSummary[] = [];
  for (const task of readyTasks.slice(0, MAX_AGENT_ROUTE_SUMMARIES)) {
    if (!record(task) || !safePublicId(task.id)) {
      warnings.push('unsafe-task-omitted');
      continue;
    }
    try {
      const advice = adviseShadowRoute({
        task,
        context,
        originHarness: input.originHarness,
        boardRevision: input.boardRevision,
        asOf: input.asOf,
      });
      if (
        advice.selected !== null &&
        (!safePublicId(advice.selected.candidate_id) || !safePublicHarness(advice.selected.harness))
      ) {
        warnings.push('unsafe-route-omitted');
        continue;
      }
      routes.push({
        task_id: task.id,
        status: 'ready',
        eligible: advice.eligible,
        outcome: advice.outcome,
        selected: advice.selected
          ? {
              candidate_id: advice.selected.candidate_id,
              harness: advice.selected.harness,
              surface: advice.selected.surface,
            }
          : null,
        reason_codes: safeWarningCodes(advice.reason_codes),
      });
    } catch {
      warnings.push('route-contract-invalid');
    }
  }

  const safeBoardRevision = safePublicId(context.revisions.board)
    ? context.revisions.board
    : 'unknown';
  const safeMachineRevision = safePublicId(context.revisions.machine)
    ? context.revisions.machine
    : 'unknown';
  if (safeBoardRevision === 'unknown' && context.revisions.board !== 'unknown') {
    warnings.push('unsafe-board-revision-redacted');
  }
  if (safeMachineRevision === 'unknown' && context.revisions.machine !== 'unknown') {
    warnings.push('unsafe-machine-revision-redacted');
  }

  const payload: OriginContextPayload = {
    schema: ORIGIN_CONTEXT_SCHEMA,
    cached_only: true,
    shadow_only: true,
    dispatch_enabled: false,
    origin_harness: input.originHarness,
    available: context.available,
    revisions: { board: safeBoardRevision, machine: safeMachineRevision },
    freshness: {
      state: context.freshness.state,
      valid_until: context.freshness.valid_until,
    },
    contract_activation: activation,
    candidates: projectedCandidates,
    ...(context.cursor_surfaces
      ? { cursor_surfaces: structuredClone(context.cursor_surfaces) }
      : {}),
    ...(context.machine_quota ? { machine_quota: structuredClone(context.machine_quota) } : {}),
    routes,
    warnings: safeWarningCodes(warnings),
    truncation: {
      applied: readyTasks.length > routes.length,
      omitted_candidates: 0,
      omitted_routes: Math.max(0, readyTasks.length - routes.length),
      omitted_warnings: 0,
      omitted_quota_scopes: 0,
      max_bytes: ORCHESTRATOR_CONTEXT_MAX_BYTES,
    },
  };

  const originalCandidateCount = payload.candidates.length;
  const originalRouteCount = payload.routes.length;
  const originalWarningCount = payload.warnings.length;
  const originalQuotaScopeCount = payload.machine_quota?.decisions.length ?? 0;
  let content = originAmbient(payload);
  while (
    new TextEncoder().encode(content).byteLength > ORCHESTRATOR_CONTEXT_MAX_BYTES &&
    payload.warnings.length > 0
  ) {
    payload.warnings.pop();
    payload.truncation.omitted_warnings = originalWarningCount - payload.warnings.length;
    payload.truncation.applied = true;
    content = originAmbient(payload);
  }
  while (
    new TextEncoder().encode(content).byteLength > ORCHESTRATOR_CONTEXT_MAX_BYTES &&
    payload.machine_quota &&
    payload.machine_quota.decisions.length > 0
  ) {
    payload.machine_quota.decisions.pop();
    payload.truncation.omitted_quota_scopes =
      originalQuotaScopeCount - payload.machine_quota.decisions.length;
    payload.truncation.applied = true;
    content = originAmbient(payload);
  }
  while (
    new TextEncoder().encode(content).byteLength > ORCHESTRATOR_CONTEXT_MAX_BYTES &&
    payload.routes.length > 0
  ) {
    payload.routes.pop();
    payload.truncation.omitted_routes = readyTasks.length - payload.routes.length;
    payload.truncation.applied = true;
    content = originAmbient(payload);
  }
  while (
    new TextEncoder().encode(content).byteLength > ORCHESTRATOR_CONTEXT_MAX_BYTES &&
    payload.candidates.length > 0
  ) {
    payload.candidates.pop();
    payload.truncation.omitted_candidates = originalCandidateCount - payload.candidates.length;
    payload.truncation.applied = true;
    content = originAmbient(payload);
  }
  // Keep the explicit route cap visible even when no byte-bound truncation was needed.
  payload.truncation.omitted_routes = Math.max(
    payload.truncation.omitted_routes,
    readyTasks.length - originalRouteCount,
  );
  payload.truncation.applied =
    payload.truncation.applied ||
    payload.truncation.omitted_routes > 0 ||
    payload.truncation.omitted_candidates > 0 ||
    payload.truncation.omitted_warnings > 0 ||
    payload.truncation.omitted_quota_scopes > 0;
  content = originAmbient(payload);
  const contentBytes = new TextEncoder().encode(content).byteLength;
  if (contentBytes > ORCHESTRATOR_CONTEXT_MAX_BYTES) {
    throw new Error('origin context load-bearing envelope exceeds 4096 bytes');
  }
  return { payload, content, content_bytes: contentBytes };
}
