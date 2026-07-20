import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import {
  type AuthFactState,
  type BinaryFactState,
  type CapabilityFactState,
  type CompatibilityState,
  evaluateMachineSurfaceEligibility,
  MACHINE_SURFACE_CONTRACT,
  MACHINE_SURFACE_INVENTORY_CONTRACT,
  type MachineSurfaceEligibility,
  type MachineSurfaceEligibilityReason,
  type MachineSurfaceKind,
  type ModelEntitlementState,
  type NegativeCapabilityState,
  type QuotaFactState,
} from '@ccm/engine';
import { type CursorAgentQuotaReading, readCursorAgentQuotaFact } from '../cursor-usage.js';
import { cursorAdapter } from './cursor.js';
import { probeExecutable } from './probe.js';
import type { Env } from './types.js';

const STATIC_TTL_MS = 24 * 60 * 60 * 1000;
const AUTH_TTL_MS = 15 * 60 * 1000;
const QUOTA_TTL_MS = 5 * 60 * 1000;
const PROBE_TIMEOUT_MS = 3_000;
const MAX_FACT_SOURCE_BYTES = 256;
const MAX_FACT_REF_BYTES = 256;
const MAX_FACT_REFS = 8;
const MAX_FACT_REASON_BYTES = 512;
const SUPPORTED_CURSOR_AGENT_VERSIONS = new Set(['2026.07.09-a3815c0', '2026.07.16-899851b']);
export const CURSOR_SURFACE_INVENTORY_MAX_BYTES = 4_096;
const PROJECTION_STRING_BYTES = 96;
const COMPACT_PROJECTION_STRING_BYTES = 24;
const MAX_PROJECTED_REFS = 2;
const MAX_TRUNCATION_FIELDS = 12;

const NEGATIVE_CAPABILITIES: CursorNegativeCapabilities = Object.freeze({
  automatic_login: 'forbidden',
  automatic_logout: 'forbidden',
  account_switch: 'forbidden',
  credential_mutation: 'forbidden',
  credential_import: 'forbidden',
  credential_copy: 'forbidden',
  quota_pool_inference: 'forbidden',
  external_write: 'unknown',
  nested_orchestration: 'unknown',
  network_access: 'unknown',
  mcp_access: 'unknown',
});

export interface CursorNegativeCapabilities {
  automatic_login: NegativeCapabilityState;
  automatic_logout: NegativeCapabilityState;
  account_switch: NegativeCapabilityState;
  credential_mutation: NegativeCapabilityState;
  credential_import: NegativeCapabilityState;
  credential_copy: NegativeCapabilityState;
  quota_pool_inference: NegativeCapabilityState;
  external_write: NegativeCapabilityState;
  nested_orchestration: NegativeCapabilityState;
  network_access: NegativeCapabilityState;
  mcp_access: NegativeCapabilityState;
}

export interface CursorBinaryFact {
  state: BinaryFactState;
  name: string | null;
  path: string | null;
  version: string | null;
  legacy: boolean;
  source: string;
  observed_at: string;
  valid_until: string;
  reason?: string;
}

export interface CursorAuthFact {
  state: AuthFactState;
  source: string;
  observed_at: string;
  valid_until: string | null;
  reason?: string;
}

export interface CursorQuotaFact {
  state: QuotaFactState;
  source: string;
  pool_refs: string[];
  observed_at: string;
  valid_until: string | null;
  reason?: string;
}

export interface CursorModelFact {
  state: ModelEntitlementState;
  source: string;
  model_refs: string[];
  observed_at: string;
  valid_until: string | null;
  reason?: string;
}

export interface CursorExecutionSurfaceDescriptor {
  schema: typeof MACHINE_SURFACE_CONTRACT;
  surface_id: 'cursor-ide-plugin' | 'cursor-agent-cli';
  harness_id: 'cursor';
  surface_kind: MachineSurfaceKind;
  roles: Array<'origin' | 'worker'>;
  installed: boolean;
  binary: CursorBinaryFact;
  compatibility: CompatibilityState;
  auth: CursorAuthFact;
  model: CursorModelFact;
  quota: CursorQuotaFact;
  capabilities: {
    headless_execution: CapabilityFactState;
    structured_result: CapabilityFactState;
    model_selection: CapabilityFactState;
    workspace_selection: CapabilityFactState;
    cancel: CapabilityFactState;
    resume: CapabilityFactState;
    permission_control: CapabilityFactState;
  };
  negative_capabilities: CursorNegativeCapabilities;
  eligibility: MachineSurfaceEligibility;
}

export interface CursorSurfaceInventory {
  schema: typeof MACHINE_SURFACE_INVENTORY_CONTRACT;
  surfaces: CursorExecutionSurfaceDescriptor[];
  eligible_surface_ids: Array<CursorExecutionSurfaceDescriptor['surface_id']>;
  truncation: {
    applied: boolean;
    max_bytes: typeof CURSOR_SURFACE_INVENTORY_MAX_BYTES;
    fields: string[];
    fields_omitted: number;
  };
}

export interface CursorSurfaceProbeDeps {
  now?: () => Date;
  readQuota?: (input: {
    surface_id: 'cursor-agent-cli';
    env: Env;
    observed_at: string;
  }) => CursorQuotaFact;
  readModel?: (input: {
    surface_id: 'cursor-agent-cli';
    env: Env;
    observed_at: string;
  }) => CursorModelFact;
}

interface ReadOnlyProbeResult {
  ok: boolean;
  stdout: string;
}

export function inspectCursorExecutionSurfaces(
  env: Env = process.env,
  deps: CursorSurfaceProbeDeps = {},
): CursorExecutionSurfaceDescriptor[] {
  const now = deps.now?.() ?? new Date();
  const observedAt = now.toISOString();
  return [inspectIdeSurface(env, now), inspectHeadlessSurface(env, now, observedAt, deps)];
}

// defaultCursorAgentQuotaReader — composition-root `readQuota` dep wiring the machine-wide billing-period
//   collector's read (cursor-agent accessToken → dashboard GetCurrentPeriodUsage → pacing-classified
//   ample/tight/exhausted) into a bounded CursorQuotaFact. Fail-closed: unreadable signal or a missing
//   quota-scope fingerprint (can't bind a pool ref) → unknown. No subscription-pool inference across surfaces
//   — the ref is the Agent's own login scope only.
export function cursorAgentQuotaReadingToFact(
  fact: CursorAgentQuotaReading,
  observedAt: string,
): CursorQuotaFact {
  const poolRef = fact.quota_scope_fingerprint;
  if (fact.state === 'unknown' || !poolRef) {
    return {
      state: 'unknown',
      source: fact.source,
      pool_refs: [],
      observed_at: observedAt,
      valid_until: null,
      reason:
        fact.state === 'unknown'
          ? 'Cursor Agent dashboard billing-period usage is unreadable (logged out / token invalid / API change).'
          : 'Cursor Agent billing-period usage lacks a stable quota-scope fingerprint to bind a pool ref.',
    };
  }
  return {
    state: fact.state,
    source: fact.source,
    pool_refs: [poolRef],
    observed_at: observedAt,
    valid_until: expiresAt(new Date(observedAt), QUOTA_TTL_MS),
  };
}

export function defaultCursorAgentQuotaReader(input: {
  surface_id: 'cursor-agent-cli';
  env: Env;
  observed_at: string;
}): CursorQuotaFact {
  return cursorAgentQuotaReadingToFact(readCursorAgentQuotaFact(input.env), input.observed_at);
}

export function buildCursorSurfaceInventory(
  surfaces: readonly CursorExecutionSurfaceDescriptor[],
): CursorSurfaceInventory {
  const firstFields = new Set<string>();
  const firstProjection = surfaces.map((surface) =>
    projectSurface(surface, firstFields, {
      maxStringBytes: PROJECTION_STRING_BYTES,
      maxRefs: MAX_PROJECTED_REFS,
      omitReasons: false,
    }),
  );
  const first = inventoryEnvelope(firstProjection, firstFields);
  if (inventoryBytes(first) <= CURSOR_SURFACE_INVENTORY_MAX_BYTES) return first;

  const compactFields = new Set<string>();
  const compactProjection = surfaces.map((surface) =>
    projectSurface(surface, compactFields, {
      maxStringBytes: COMPACT_PROJECTION_STRING_BYTES,
      maxRefs: 1,
      omitReasons: true,
    }),
  );
  const compact = inventoryEnvelope(compactProjection, compactFields);
  if (inventoryBytes(compact) <= CURSOR_SURFACE_INVENTORY_MAX_BYTES) return compact;

  const minimal = inventoryEnvelope(
    surfaces.map((surface) => minimalFailClosedSurface(surface)),
    new Set(['*']),
  );
  if (inventoryBytes(minimal) > CURSOR_SURFACE_INVENTORY_MAX_BYTES) {
    throw new Error('Cursor surface inventory bounded-projection invariant exceeded');
  }
  return minimal;
}

function inspectIdeSurface(env: Env, now: Date): CursorExecutionSurfaceDescriptor {
  const installation = cursorAdapter.inspectInstallation(env);
  const binary: CursorBinaryFact = {
    state: installation.cli.available ? 'available' : 'missing',
    name: installation.cli.name || 'cursor',
    path: installation.cli.path,
    version: null,
    legacy: false,
    source: installation.cli.available
      ? 'path:cursor'
      : installation.installed
        ? 'cursor-ide-config-or-plugin'
        : 'path:cursor-missing',
    observed_at: now.toISOString(),
    valid_until: expiresAt(now, STATIC_TTL_MS),
  };
  const auth: CursorAuthFact = {
    state: 'unknown',
    source: 'not-probed:cursor-ide',
    observed_at: now.toISOString(),
    valid_until: null,
    reason: 'Cursor IDE authentication is not inferred from plugin/config or Agent CLI state.',
  };
  const quota: CursorQuotaFact = {
    state: 'unknown',
    source: 'not-collected:cursor-ide',
    pool_refs: [],
    observed_at: now.toISOString(),
    valid_until: null,
    reason: 'Cursor IDE quota is a separate fact and is not inferred from Agent CLI auth.',
  };
  const model: CursorModelFact = {
    state: 'unknown',
    source: 'not-collected:cursor-ide',
    model_refs: [],
    observed_at: now.toISOString(),
    valid_until: null,
    reason: 'Cursor IDE model entitlement is not inferred from Agent CLI help or auth.',
  };
  const headlessExecution: CapabilityFactState = 'unsupported';
  return Object.freeze({
    schema: MACHINE_SURFACE_CONTRACT,
    surface_id: 'cursor-ide-plugin',
    harness_id: 'cursor',
    surface_kind: 'origin-plugin',
    roles: Object.freeze(['origin']) as Array<'origin'>,
    installed: installation.installed,
    binary: Object.freeze(binary),
    compatibility: 'unknown',
    auth: Object.freeze(auth),
    model: freezeModel(model),
    quota: freezeQuota(quota),
    capabilities: Object.freeze({
      headless_execution: headlessExecution,
      structured_result: 'unknown',
      model_selection: 'unknown',
      workspace_selection: 'unknown',
      cancel: 'unknown',
      resume: 'unknown',
      permission_control: 'unknown',
    }),
    negative_capabilities: NEGATIVE_CAPABILITIES,
    eligibility: Object.freeze(
      evaluateMachineSurfaceEligibility({
        schema: MACHINE_SURFACE_CONTRACT,
        surface_kind: 'origin-plugin',
        installed: installation.installed,
        binary_state: binary.state,
        compatibility: 'unknown',
        auth_state: auth.state,
        model_entitlement: model.state,
        quota_state: quota.state,
        headless_execution: headlessExecution,
        account_mutation: NEGATIVE_CAPABILITIES.account_switch,
        credential_mutation: NEGATIVE_CAPABILITIES.credential_mutation,
      }),
    ),
  });
}

function inspectHeadlessSurface(
  env: Env,
  now: Date,
  observedAt: string,
  deps: CursorSurfaceProbeDeps,
): CursorExecutionSurfaceDescriptor {
  const selected = selectHeadlessBinary(env);
  let compatibility: CompatibilityState = 'unknown';
  let headlessExecution: CapabilityFactState = 'unknown';
  let auth: CursorAuthFact = unknownAuth(observedAt, 'binary-unavailable');
  let binary: CursorBinaryFact;

  if (!selected.path) {
    binary = {
      state: 'missing',
      name: selected.name,
      path: null,
      version: null,
      legacy: selected.name === 'cursor-agent',
      source: selected.source,
      observed_at: observedAt,
      valid_until: expiresAt(now, STATIC_TTL_MS),
      reason: selected.reason,
    };
  } else {
    const version = runReadOnly(selected.path, ['--version'], env);
    const help = runReadOnly(selected.path, ['--help'], env);
    const statusHelp = runReadOnly(selected.path, ['status', '--help'], env);
    const observedVersion = firstNonEmptyLine(version.stdout);
    const versionSupported =
      version.ok &&
      observedVersion !== null &&
      SUPPORTED_CURSOR_AGENT_VERSIONS.has(observedVersion);
    const compatible =
      versionSupported &&
      help.ok &&
      statusHelp.ok &&
      supportsHeadless(help.stdout, statusHelp.stdout);
    compatibility = compatible ? 'supported' : 'unsupported';
    headlessExecution = compatible ? 'supported' : 'unsupported';
    binary = {
      state: compatible ? 'available' : 'unsupported',
      name: selected.name,
      path: selected.path,
      version: observedVersion,
      legacy: selected.name === 'cursor-agent',
      source: selected.source,
      observed_at: observedAt,
      valid_until: expiresAt(now, STATIC_TTL_MS),
      ...(compatible
        ? {}
        : {
            reason:
              observedVersion === null || !versionSupported
                ? 'Cursor Agent version is unreadable or outside the frozen supported-version contract.'
                : 'Read-only feature probe did not prove --print, --output-format, --workspace, and status --format.',
          }),
    };
    if (compatible) auth = probeAuth(selected.path, env, now);
  }

  const quota = probeQuota(env, observedAt, deps);
  const model = probeModel(env, observedAt, deps);
  const installed = selected.path !== null;
  const eligibility = evaluateMachineSurfaceEligibility({
    schema: MACHINE_SURFACE_CONTRACT,
    surface_kind: 'cli-headless',
    installed,
    binary_state: binary.state,
    compatibility,
    auth_state: auth.state,
    model_entitlement: model.state,
    quota_state: quota.state,
    headless_execution: headlessExecution,
    account_mutation: NEGATIVE_CAPABILITIES.account_switch,
    credential_mutation: NEGATIVE_CAPABILITIES.credential_mutation,
  });

  return Object.freeze({
    schema: MACHINE_SURFACE_CONTRACT,
    surface_id: 'cursor-agent-cli',
    harness_id: 'cursor',
    surface_kind: 'cli-headless',
    roles: Object.freeze(['worker']) as Array<'worker'>,
    installed,
    binary: Object.freeze(binary),
    compatibility,
    auth: Object.freeze(auth),
    model: freezeModel(model),
    quota: freezeQuota(quota),
    capabilities: Object.freeze({
      headless_execution: headlessExecution,
      structured_result: compatibility === 'supported' ? 'supported' : 'unknown',
      model_selection: compatibility === 'supported' ? 'supported' : 'unknown',
      workspace_selection: compatibility === 'supported' ? 'supported' : 'unknown',
      cancel: 'unknown',
      resume: 'unknown',
      permission_control: 'unknown',
    }),
    negative_capabilities: NEGATIVE_CAPABILITIES,
    eligibility: Object.freeze({
      automatic: eligibility.automatic,
      reason_codes: Object.freeze([...eligibility.reason_codes]) as typeof eligibility.reason_codes,
    }),
  });
}

function projectSurface(
  surface: CursorExecutionSurfaceDescriptor,
  truncatedFields: Set<string>,
  options: { maxStringBytes: number; maxRefs: number; omitReasons: boolean },
): CursorExecutionSurfaceDescriptor {
  const prefix = surface.surface_id;
  const before = truncatedFields.size;
  const binaryReason = projectedReason(
    surface.binary.reason,
    `${prefix}.binary.reason`,
    truncatedFields,
    options,
  );
  const authReason = projectedReason(
    surface.auth.reason,
    `${prefix}.auth.reason`,
    truncatedFields,
    options,
  );
  const modelReason = projectedReason(
    surface.model.reason,
    `${prefix}.model.reason`,
    truncatedFields,
    options,
  );
  const quotaReason = projectedReason(
    surface.quota.reason,
    `${prefix}.quota.reason`,
    truncatedFields,
    options,
  );

  const projected: CursorExecutionSurfaceDescriptor = {
    schema: surface.schema,
    surface_id: surface.surface_id,
    harness_id: surface.harness_id,
    surface_kind: surface.surface_kind,
    roles: [...surface.roles],
    installed: surface.installed,
    binary: {
      state: surface.binary.state,
      name: projectedString(
        surface.binary.name,
        `${prefix}.binary.name`,
        truncatedFields,
        options.maxStringBytes,
      ),
      path: projectedString(
        surface.binary.path,
        `${prefix}.binary.path`,
        truncatedFields,
        options.maxStringBytes,
      ),
      version: projectedString(
        surface.binary.version,
        `${prefix}.binary.version`,
        truncatedFields,
        options.maxStringBytes,
      ),
      legacy: surface.binary.legacy,
      source: projectedString(
        surface.binary.source,
        `${prefix}.binary.source`,
        truncatedFields,
        options.maxStringBytes,
      )!,
      observed_at: surface.binary.observed_at,
      valid_until: surface.binary.valid_until,
      ...(binaryReason === undefined ? {} : { reason: binaryReason }),
    },
    compatibility: surface.compatibility,
    auth: {
      state: surface.auth.state,
      source: projectedString(
        surface.auth.source,
        `${prefix}.auth.source`,
        truncatedFields,
        options.maxStringBytes,
      )!,
      observed_at: surface.auth.observed_at,
      valid_until: surface.auth.valid_until,
      ...(authReason === undefined ? {} : { reason: authReason }),
    },
    model: {
      state: surface.model.state,
      source: projectedString(
        surface.model.source,
        `${prefix}.model.source`,
        truncatedFields,
        options.maxStringBytes,
      )!,
      model_refs: projectedRefs(
        surface.model.model_refs,
        `${prefix}.model.model_refs`,
        truncatedFields,
        options,
      ),
      observed_at: surface.model.observed_at,
      valid_until: surface.model.valid_until,
      ...(modelReason === undefined ? {} : { reason: modelReason }),
    },
    quota: {
      state: surface.quota.state,
      source: projectedString(
        surface.quota.source,
        `${prefix}.quota.source`,
        truncatedFields,
        options.maxStringBytes,
      )!,
      pool_refs: projectedRefs(
        surface.quota.pool_refs,
        `${prefix}.quota.pool_refs`,
        truncatedFields,
        options,
      ),
      observed_at: surface.quota.observed_at,
      valid_until: surface.quota.valid_until,
      ...(quotaReason === undefined ? {} : { reason: quotaReason }),
    },
    capabilities: { ...surface.capabilities },
    negative_capabilities: { ...surface.negative_capabilities },
    eligibility: {
      automatic: surface.eligibility.automatic,
      reason_codes: [...surface.eligibility.reason_codes],
    },
  };

  if (truncatedFields.size > before) {
    projected.eligibility = {
      automatic: false,
      reason_codes: [
        ...new Set<MachineSurfaceEligibilityReason>([
          'contract-invalid',
          ...surface.eligibility.reason_codes,
        ]),
      ],
    };
  }
  return projected;
}

function minimalFailClosedSurface(
  surface: CursorExecutionSurfaceDescriptor,
): CursorExecutionSurfaceDescriptor {
  return {
    schema: surface.schema,
    surface_id: surface.surface_id,
    harness_id: surface.harness_id,
    surface_kind: surface.surface_kind,
    roles: [...surface.roles],
    installed: surface.installed,
    binary: {
      state: surface.installed ? 'unknown' : 'missing',
      name: null,
      path: null,
      version: null,
      legacy: surface.binary.legacy,
      source: 'projection-truncated',
      observed_at: surface.binary.observed_at,
      valid_until: surface.binary.valid_until,
    },
    compatibility: 'unknown',
    auth: {
      state: 'unknown',
      source: 'projection-truncated',
      observed_at: surface.auth.observed_at,
      valid_until: null,
    },
    model: {
      state: 'unknown',
      source: 'projection-truncated',
      model_refs: [],
      observed_at: surface.model.observed_at,
      valid_until: null,
    },
    quota: {
      state: 'unknown',
      source: 'projection-truncated',
      pool_refs: [],
      observed_at: surface.quota.observed_at,
      valid_until: null,
    },
    capabilities: {
      headless_execution: 'unknown',
      structured_result: 'unknown',
      model_selection: 'unknown',
      workspace_selection: 'unknown',
      cancel: 'unknown',
      resume: 'unknown',
      permission_control: 'unknown',
    },
    negative_capabilities: { ...surface.negative_capabilities },
    eligibility: { automatic: false, reason_codes: ['contract-invalid'] },
  };
}

function inventoryEnvelope(
  surfaces: CursorExecutionSurfaceDescriptor[],
  truncatedFields: Set<string>,
): CursorSurfaceInventory {
  const allFields = [...truncatedFields].sort();
  return {
    schema: MACHINE_SURFACE_INVENTORY_CONTRACT,
    surfaces,
    eligible_surface_ids: surfaces
      .filter((surface) => surface.eligibility.automatic)
      .map((surface) => surface.surface_id),
    truncation: {
      applied: allFields.length > 0,
      max_bytes: CURSOR_SURFACE_INVENTORY_MAX_BYTES,
      fields: allFields.slice(0, MAX_TRUNCATION_FIELDS),
      fields_omitted: Math.max(0, allFields.length - MAX_TRUNCATION_FIELDS),
    },
  };
}

function projectedReason(
  value: string | undefined,
  field: string,
  truncatedFields: Set<string>,
  options: { maxStringBytes: number; omitReasons: boolean },
): string | undefined {
  if (value === undefined) return undefined;
  if (options.omitReasons) {
    truncatedFields.add(field);
    return undefined;
  }
  return projectedString(value, field, truncatedFields, options.maxStringBytes) ?? undefined;
}

function projectedRefs(
  values: readonly string[],
  field: string,
  truncatedFields: Set<string>,
  options: { maxStringBytes: number; maxRefs: number },
): string[] {
  if (values.length > options.maxRefs) truncatedFields.add(field);
  return values
    .slice(0, options.maxRefs)
    .map((value, index) =>
      projectedString(value, `${field}[${index}]`, truncatedFields, options.maxStringBytes),
    )
    .filter((value): value is string => value !== null);
}

function projectedString(
  value: string | null,
  field: string,
  truncatedFields: Set<string>,
  maxBytes: number,
): string | null {
  if (value === null || Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  truncatedFields.add(field);
  return truncateUtf8(value, maxBytes);
}

function truncateUtf8(value: string, maxBytes: number): string {
  const suffix = '…';
  const budget = Math.max(0, maxBytes - Buffer.byteLength(suffix, 'utf8'));
  let result = '';
  let bytes = 0;
  for (const char of value) {
    const width = Buffer.byteLength(char, 'utf8');
    if (bytes + width > budget) break;
    result += char;
    bytes += width;
  }
  return `${result}${suffix}`;
}

function inventoryBytes(inventory: CursorSurfaceInventory): number {
  return Buffer.byteLength(JSON.stringify(inventory), 'utf8');
}

function selectHeadlessBinary(env: Env): {
  name: string;
  path: string | null;
  source: string;
  reason?: string;
} {
  if (env.CCM_CURSOR_AGENT_BIN) {
    const explicit = probeExecutable(env.CCM_CURSOR_AGENT_BIN, env);
    return {
      name: explicit.name,
      path: explicit.path,
      source: 'env:CCM_CURSOR_AGENT_BIN',
      ...(explicit.available ? {} : { reason: 'Explicit Cursor Agent binary is not executable.' }),
    };
  }
  for (const name of ['agent', 'cursor-agent']) {
    const probe = probeExecutable(name, env);
    if (probe.available) return { name, path: probe.path, source: `path:${name}` };
  }
  return {
    name: 'agent',
    path: null,
    source: 'path:agent|cursor-agent-missing',
    reason: 'Neither agent nor legacy cursor-agent is executable on PATH.',
  };
}

function supportsHeadless(help: string, statusHelp: string): boolean {
  return (
    help.includes('--print') &&
    help.includes('--output-format') &&
    help.includes('--workspace') &&
    help.includes('--model') &&
    help.includes('status') &&
    statusHelp.includes('--format')
  );
}

function probeAuth(binary: string, env: Env, now: Date): CursorAuthFact {
  const result = runReadOnly(binary, ['status', '--format', 'json'], env);
  if (!result.ok) return unknownAuth(now.toISOString(), 'cli-status-error');
  try {
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    const authenticated = parsed.isAuthenticated ?? parsed.authenticated;
    if (authenticated === true) {
      return {
        state: 'authenticated',
        source: 'cursor-agent:status-json',
        observed_at: now.toISOString(),
        valid_until: expiresAt(now, AUTH_TTL_MS),
      };
    }
    if (authenticated === false) {
      return {
        state: 'unauthenticated',
        source: 'cursor-agent:status-json',
        observed_at: now.toISOString(),
        valid_until: expiresAt(now, AUTH_TTL_MS),
      };
    }
  } catch {
    // Raw output is deliberately discarded; malformed private/account data never enters the read model.
  }
  return unknownAuth(now.toISOString(), 'cli-status-schema-unknown');
}

function probeQuota(env: Env, observedAt: string, deps: CursorSurfaceProbeDeps): CursorQuotaFact {
  if (!deps.readQuota) {
    return {
      state: 'unknown',
      source: 'cursor-agent:no-public-quota-source',
      pool_refs: [],
      observed_at: observedAt,
      valid_until: null,
      reason: 'Authentication and model visibility do not prove Cursor quota headroom.',
    };
  }
  try {
    const fact = deps.readQuota({
      surface_id: 'cursor-agent-cli',
      env: probeFactEnv(env),
      observed_at: observedAt,
    });
    if (!isQuotaFact(fact, observedAt)) throw new Error('invalid quota fact');
    return {
      state: fact.state,
      source: fact.source,
      pool_refs: [...new Set(fact.pool_refs)],
      observed_at: fact.observed_at,
      valid_until:
        fact.valid_until ??
        (fact.state === 'unknown' ? null : expiresAt(new Date(observedAt), QUOTA_TTL_MS)),
      ...(fact.reason ? { reason: fact.reason } : {}),
    };
  } catch {
    return {
      state: 'unknown',
      source: 'cursor-agent:quota-collector-error',
      pool_refs: [],
      observed_at: observedAt,
      valid_until: null,
      reason: 'Quota collector failed closed.',
    };
  }
}

function probeModel(env: Env, observedAt: string, deps: CursorSurfaceProbeDeps): CursorModelFact {
  if (!deps.readModel) {
    return {
      state: 'unknown',
      source: 'cursor-agent:no-read-only-model-entitlement-source',
      model_refs: [],
      observed_at: observedAt,
      valid_until: null,
      reason: 'CLI flags and authentication do not prove model entitlement.',
    };
  }
  try {
    const fact = deps.readModel({
      surface_id: 'cursor-agent-cli',
      env: probeFactEnv(env),
      observed_at: observedAt,
    });
    if (!isModelFact(fact, observedAt)) throw new Error('invalid model fact');
    return {
      state: fact.state,
      source: fact.source,
      model_refs: [...new Set(fact.model_refs)],
      observed_at: fact.observed_at,
      valid_until: fact.valid_until,
      ...(fact.reason ? { reason: fact.reason } : {}),
    };
  } catch {
    return {
      state: 'unknown',
      source: 'cursor-agent:model-collector-error',
      model_refs: [],
      observed_at: observedAt,
      valid_until: null,
      reason: 'Model entitlement collector failed closed.',
    };
  }
}

function runReadOnly(binary: string, args: readonly string[], env: Env): ReadOnlyProbeResult {
  if (!isReadOnlyProbe(args)) return { ok: false, stdout: '' };
  try {
    const stdout = execFileSync(binary, [...args], {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: probeChildEnv(env),
    });
    return { ok: true, stdout: String(stdout) };
  } catch {
    return { ok: false, stdout: '' };
  }
}

function isReadOnlyProbe(args: readonly string[]): boolean {
  const signature = args.join('\u0000');
  return new Set([
    '--version',
    '--help',
    ['status', '--help'].join('\u0000'),
    ['status', '--format', 'json'].join('\u0000'),
  ]).has(signature);
}

function probeChildEnv(env: Env): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = {
    PATH: env.PATH || process.env.PATH,
    HOME: env.HOME || os.homedir(),
    NO_OPEN_BROWSER: '1',
  };
  for (const key of ['XDG_CONFIG_HOME', 'APPDATA', 'LOCALAPPDATA']) {
    if (env[key]) child[key] = env[key];
  }
  return child;
}

function probeFactEnv(env: Env): Env {
  return probeChildEnv(env);
}

function unknownAuth(observedAt: string, reason: string): CursorAuthFact {
  return {
    state: 'unknown',
    source: 'cursor-agent:status-unavailable',
    observed_at: observedAt,
    valid_until: null,
    reason,
  };
}

function firstNonEmptyLine(value: string): string | null {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}

function expiresAt(now: Date, ttlMs: number): string {
  return new Date(now.getTime() + ttlMs).toISOString();
}

function freezeQuota(fact: CursorQuotaFact): CursorQuotaFact {
  return Object.freeze({
    ...fact,
    pool_refs: Object.freeze([...fact.pool_refs]) as string[],
  });
}

function freezeModel(fact: CursorModelFact): CursorModelFact {
  return Object.freeze({
    ...fact,
    model_refs: Object.freeze([...fact.model_refs]) as string[],
  });
}

function isQuotaFact(value: unknown, asOf: string): value is CursorQuotaFact {
  return (
    isRecord(value) &&
    ['ample', 'tight', 'exhausted', 'unknown'].includes(String(value.state)) &&
    isBoundedNonEmptyString(value.source, MAX_FACT_SOURCE_BYTES) &&
    isFactRefs(value.pool_refs) &&
    isOptionalReason(value.reason) &&
    isValidFactWindow(value, asOf, QUOTA_TTL_MS) &&
    (value.state === 'unknown' || value.pool_refs.length > 0)
  );
}

function isModelFact(value: unknown, asOf: string): value is CursorModelFact {
  return (
    isRecord(value) &&
    ['entitled', 'not-entitled', 'unknown'].includes(String(value.state)) &&
    isBoundedNonEmptyString(value.source, MAX_FACT_SOURCE_BYTES) &&
    isFactRefs(value.model_refs) &&
    isOptionalReason(value.reason) &&
    isValidFactWindow(value, asOf, STATIC_TTL_MS) &&
    (value.state === 'unknown' || value.model_refs.length > 0)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStrictUtcDate(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  ) {
    return false;
  }
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) return false;
  const canonical = new Date(epoch).toISOString();
  return value === canonical || value === canonical.replace('.000Z', 'Z');
}

function isValidFactWindow(fact: Record<string, unknown>, asOf: string, maxTtlMs: number): boolean {
  if (!isStrictUtcDate(fact.observed_at) || !isStrictUtcDate(asOf)) return false;
  const observed = Date.parse(fact.observed_at);
  const evaluated = Date.parse(asOf);
  if (observed > evaluated) return false;

  if (fact.state === 'unknown' && fact.valid_until === null) return true;
  if (!isStrictUtcDate(fact.valid_until)) return false;
  const validUntil = Date.parse(fact.valid_until);
  return observed < validUntil && evaluated < validUntil && validUntil - observed <= maxTtlMs;
}

function isFactRefs(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_FACT_REFS &&
    value.every((entry) => isBoundedNonEmptyString(entry, MAX_FACT_REF_BYTES)) &&
    new Set(value).size === value.length
  );
}

function isOptionalReason(value: unknown): boolean {
  return value === undefined || isBoundedNonEmptyString(value, MAX_FACT_REASON_BYTES);
}

function isBoundedNonEmptyString(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    Buffer.byteLength(value, 'utf8') <= maxBytes
  );
}
