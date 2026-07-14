import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CONTRACT = 'ccm/cursor-dual-surface-contract/v1';
const RUN_RED = process.env.CCM_CURSOR_DUAL_SURFACE_CONTRACT_RED === '1';
const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_ROOT, '../../../..');
const FIXTURE_ROOT = join(TEST_ROOT, 'fixtures', 'cursor-dual-surface-contract-v1');
const SURFACE_IDS = ['cursor-ide-plugin', 'cursor-agent-cli'] as const;

type SurfaceId = (typeof SURFACE_IDS)[number];

interface EvidenceWindow {
  source: string | null;
  observed_at: string | null;
  valid_until: string | null;
}

interface TrackAnchor {
  kind: string;
  path: string;
  contains: string[];
  surface_id?: SurfaceId;
}

interface TrackClaim {
  surface_id: SurfaceId;
  track: 'A' | 'B';
  status: string;
  anchors: TrackAnchor[];
}

interface FixtureManifest {
  schema: string;
  contract: string;
  surface_ids: SurfaceId[];
  legacy_aliases: Record<string, SurfaceId>;
  fixture_files: string[];
  required_coverage: string[];
  provenance_policy: Record<SurfaceId, Record<string, string[]>>;
  profiles: Record<SurfaceId, Record<string, unknown>>;
  track_claims: Record<string, TrackClaim>;
  negative_capabilities: Record<string, string>;
}

interface FixtureCase {
  id: string;
  title: string;
  coverage: string[];
  overrides: Record<string, unknown>;
  expected: ContractDecision;
}

interface FixtureScenarios {
  schema: string;
  contract: string;
  defaults: Record<SurfaceId, Record<string, unknown>>;
  cases: FixtureCase[];
}

interface ProvenanceMutant {
  id: string;
  title: string;
  base_case_id?: string;
  target: {
    surface_id: SurfaceId;
    role: 'master-origin' | 'worker-target';
  };
  patch: Record<string, unknown>;
  expected_eligible: boolean;
  expected_blockers: string[];
}

interface ProvenanceMutants {
  schema: string;
  contract: string;
  base_case_id: string;
  mutants: ProvenanceMutant[];
}

interface LifecycleFixtures {
  schema: string;
  contract: string;
  migration: {
    id: string;
    input: Record<string, unknown>;
    expected: Record<string, unknown>;
  };
  rollback: {
    id: string;
    input: Record<string, unknown>;
    expected: Record<string, unknown>;
  };
  rollback_mutants: Array<{
    id: string;
    title: string;
    strict_facts_after_rollback: Record<string, unknown>;
    expected_automatic_eligible_surface_ids: string[];
  }>;
}

interface ContractDecision {
  installed_surface_ids: string[];
  master_origin_eligible_surface_ids: string[];
  worker_eligible_surface_ids: string[];
  blockers: Record<string, string[]>;
  pool_relations: Array<Record<string, unknown>>;
}

interface OracleOptions {
  authFromQuota?: boolean;
  ideQuotaAuthorizesAgentAuth?: boolean;
  alwaysRequireSandbox?: boolean;
  resultImpliesInvoke?: boolean;
  ignoreResume?: boolean;
  ignoreProvenance?: boolean;
  ignoreProvenanceFor?: SurfaceId;
}

const manifest = readJson<FixtureManifest>('manifest.json');
const scenarios = readJson<FixtureScenarios>('scenarios.json');
const provenanceMutants = readJson<ProvenanceMutants>('provenance-mutants.json');
const lifecycle = readJson<LifecycleFixtures>('lifecycle.json');

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, name), 'utf8')) as T;
}

function merge(base: unknown, overrides: unknown): unknown {
  if (!isRecord(base) || !isRecord(overrides)) return structuredClone(overrides);
  const result: Record<string, unknown> = structuredClone(base);
  for (const [key, value] of Object.entries(overrides)) {
    result[key] = isRecord(value) && isRecord(result[key]) ? merge(result[key], value) : value;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  assert.ok(isRecord(value), `${label} must be an object`);
  return value;
}

function canonicalInstant(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) return null;
  return milliseconds;
}

function evidencePrefix(axis: string): string {
  const names: Record<string, string> = {
    auth_state: 'auth',
    model_entitlement: 'model-entitlement',
    quota_state: 'quota',
    pool_ref: 'pool',
  };
  return names[axis] ?? axis.replaceAll('_', '-');
}

function evidenceIssue(
  surfaceId: SurfaceId,
  surface: Record<string, unknown>,
  axis: string,
): string | null {
  const prefix = evidencePrefix(axis);
  const evidence = isRecord(surface.evidence) ? surface.evidence[axis] : null;
  if (!isRecord(evidence)) return `${prefix}-evidence-source-unknown`;
  const window = evidence as unknown as EvidenceWindow;
  if (typeof window.source !== 'string' || window.source.length === 0)
    return `${prefix}-evidence-source-unknown`;
  if (!manifest.provenance_policy[surfaceId][axis]?.includes(window.source))
    return `${prefix}-evidence-source-untrusted`;

  const asOf = canonicalInstant(surface.as_of);
  const observedAt = canonicalInstant(window.observed_at);
  const validUntil = canonicalInstant(window.valid_until);
  if (asOf === null || observedAt === null || validUntil === null || observedAt >= validUntil)
    return `${prefix}-evidence-window-invalid`;
  if (observedAt > asOf) return `${prefix}-evidence-future`;
  if (asOf >= validUntil) return `${prefix}-evidence-stale`;
  return null;
}

function factGate(
  blockers: string[],
  surfaceId: SurfaceId,
  surface: Record<string, unknown>,
  axis: string,
  satisfied: boolean,
  ordinaryBlocker: string,
  options: OracleOptions,
): boolean {
  if (!satisfied) {
    blockers.push(ordinaryBlocker);
    return false;
  }
  const issue =
    options.ignoreProvenance || options.ignoreProvenanceFor === surfaceId
      ? null
      : evidenceIssue(surfaceId, surface, axis);
  if (issue) {
    blockers.push(issue);
    return false;
  }
  return true;
}

function evaluateFixture(
  input: Record<string, unknown>,
  options: OracleOptions = {},
): ContractDecision {
  const ide = input['cursor-ide-plugin'] as Record<string, unknown>;
  const agent = input['cursor-agent-cli'] as Record<string, unknown>;
  const ideBlockers: string[] = [];
  const agentBlockers: string[] = [];

  const ideInstalled = factGate(
    ideBlockers,
    'cursor-ide-plugin',
    ide,
    'installed',
    ide.installed === true,
    'surface-not-installed',
    options,
  );
  factGate(
    ideBlockers,
    'cursor-ide-plugin',
    ide,
    'plugin_host_qualified',
    ide.plugin_host_qualified === true,
    'plugin-host-unqualified',
    options,
  );
  factGate(
    ideBlockers,
    'cursor-ide-plugin',
    ide,
    'origin_session_attested',
    ide.origin_session_attested === true,
    'origin-session-unattested',
    options,
  );

  const agentInstalled = factGate(
    agentBlockers,
    'cursor-agent-cli',
    agent,
    'installed',
    agent.installed === true,
    'surface-not-installed',
    options,
  );
  factGate(
    agentBlockers,
    'cursor-agent-cli',
    agent,
    'binary_state',
    agent.binary_state === 'available',
    `binary-${String(agent.binary_state)}`,
    options,
  );
  factGate(
    agentBlockers,
    'cursor-agent-cli',
    agent,
    'compatibility',
    agent.compatibility === 'supported',
    `compatibility-${String(agent.compatibility)}`,
    options,
  );
  const authSatisfied =
    agent.auth_state === 'authenticated' ||
    (options.authFromQuota === true && agent.quota_state === 'ample') ||
    (options.ideQuotaAuthorizesAgentAuth === true && ide.quota_state === 'ample');
  factGate(
    agentBlockers,
    'cursor-agent-cli',
    agent,
    'auth_state',
    authSatisfied,
    `auth-${String(agent.auth_state)}`,
    options,
  );
  factGate(
    agentBlockers,
    'cursor-agent-cli',
    agent,
    'model_entitlement',
    agent.model_entitlement === 'entitled',
    `model-entitlement-${String(agent.model_entitlement)}`,
    options,
  );
  factGate(
    agentBlockers,
    'cursor-agent-cli',
    agent,
    'quota_state',
    agent.quota_state === 'ample',
    `quota-${String(agent.quota_state)}`,
    options,
  );
  factGate(
    agentBlockers,
    'cursor-agent-cli',
    agent,
    'pool_ref',
    typeof agent.pool_ref === 'string' && agent.pool_ref.length > 0,
    'pool-unbound',
    options,
  );

  const sandboxRequired = options.alwaysRequireSandbox === true || agent.sandbox_required === true;
  if (sandboxRequired) {
    factGate(
      agentBlockers,
      'cursor-agent-cli',
      agent,
      'sandbox_qualified',
      agent.sandbox_qualified === true,
      'sandbox-unqualified',
      options,
    );
  }
  const invokeSatisfied =
    agent.invoke_qualified === true ||
    (options.resultImpliesInvoke === true && agent.result_qualified === true);
  factGate(
    agentBlockers,
    'cursor-agent-cli',
    agent,
    'invoke_qualified',
    invokeSatisfied,
    'invoke-unqualified',
    options,
  );
  factGate(
    agentBlockers,
    'cursor-agent-cli',
    agent,
    'result_qualified',
    agent.result_qualified === true,
    'result-unqualified',
    options,
  );
  factGate(
    agentBlockers,
    'cursor-agent-cli',
    agent,
    'effective_cancel_qualified',
    agent.effective_cancel_qualified === true,
    'cancel-unqualified',
    options,
  );
  if (agent.route_kind === 'continuation' && options.ignoreResume !== true) {
    factGate(
      agentBlockers,
      'cursor-agent-cli',
      agent,
      'resume_qualified',
      agent.resume_qualified === true,
      'resume-unqualified',
      options,
    );
  }

  const installedSurfaceIds: string[] = [];
  if (ideInstalled) installedSurfaceIds.push('cursor-ide-plugin');
  if (agentInstalled) installedSurfaceIds.push('cursor-agent-cli');
  const idePool = typeof ide.pool_ref === 'string' ? ide.pool_ref : null;
  const agentPool = typeof agent.pool_ref === 'string' ? agent.pool_ref : null;

  return {
    installed_surface_ids: installedSurfaceIds,
    master_origin_eligible_surface_ids: ideBlockers.length === 0 ? ['cursor-ide-plugin'] : [],
    worker_eligible_surface_ids: agentBlockers.length === 0 ? ['cursor-agent-cli'] : [],
    blockers: {
      'cursor-ide-plugin:master-origin': ideBlockers,
      'cursor-ide-plugin:worker-target': ['role-unsupported'],
      'cursor-agent-cli:master-origin': ['role-unsupported'],
      'cursor-agent-cli:worker-target': agentBlockers,
    },
    pool_relations:
      ideInstalled && agentInstalled && idePool !== null && agentPool !== null
        ? [
            {
              left: idePool,
              right: agentPool,
              join_allowed: false,
              reason: 'cross-surface-pool-inference-forbidden',
            },
          ]
        : [],
  };
}

function claimRefs(profile: Record<string, unknown>): string[] {
  const roles = requiredRecord(profile.roles, 'profile.roles');
  const masterOrigin = requiredRecord(roles.master_origin, 'profile.roles.master_origin');
  return (masterOrigin.claim_refs ?? []) as string[];
}

function validateTrackClaims(candidate: FixtureManifest): void {
  const referencedClaims = SURFACE_IDS.flatMap((surfaceId) =>
    claimRefs(candidate.profiles[surfaceId]),
  );
  assert.deepEqual(
    [...new Set(referencedClaims)].sort(),
    Object.keys(candidate.track_claims).sort(),
  );

  for (const surfaceId of SURFACE_IDS) {
    const profile = candidate.profiles[surfaceId];
    const roles = requiredRecord(profile.roles, `${surfaceId}.roles`);
    const masterOrigin = requiredRecord(roles.master_origin, `${surfaceId}.roles.master_origin`);
    const declaredTracks = String(masterOrigin.track).split('+').sort();
    const anchoredTracks = claimRefs(profile)
      .map((claimId) => {
        const claim = candidate.track_claims[claimId];
        assert.ok(claim, `${surfaceId} references missing claim ${claimId}`);
        assert.equal(
          claim.surface_id,
          surfaceId,
          `${claimId} surface binding must match ${surfaceId}`,
        );
        return claim.track;
      })
      .sort();
    assert.deepEqual(anchoredTracks, declaredTracks, `${surfaceId} Track claim mismatch`);
  }

  for (const [claimId, claim] of Object.entries(candidate.track_claims)) {
    assert.equal(claim.surface_id in candidate.profiles, true, claimId);
    assert.ok(claim.status.length > 0, claimId);
    const kinds = new Set(claim.anchors.map((anchor) => anchor.kind));
    for (const requiredKind of [
      'capability-intent',
      'machine-surface-descriptor',
      'adapter-strategy',
      'host-native-dist',
      'probe-evidence',
    ]) {
      assert.equal(kinds.has(requiredKind), true, `${claimId} missing ${requiredKind}`);
    }
    assert.equal(
      kinds.has('hook-contract') || kinds.has('transport-contract'),
      true,
      `${claimId} missing CONTRACT anchor`,
    );

    for (const anchor of claim.anchors) {
      if (anchor.kind === 'machine-surface-descriptor') {
        assert.equal(
          anchor.surface_id,
          claim.surface_id,
          `${claimId} descriptor surface must match ${claim.surface_id}`,
        );
      }
      const absolute = resolve(REPO_ROOT, anchor.path);
      assert.equal(
        absolute === REPO_ROOT || absolute.startsWith(`${REPO_ROOT}${sep}`),
        true,
        `${claimId}:${anchor.path} escapes repo`,
      );
      assert.equal(existsSync(absolute), true, `${claimId}:${anchor.path} missing`);
      const content = readFileSync(absolute, 'utf8');
      for (const fragment of anchor.contains) {
        assert.equal(
          content.includes(fragment),
          true,
          `${claimId}:${anchor.kind}:${anchor.path} drifted at ${JSON.stringify(fragment)}`,
        );
      }
    }
  }
}

function migrationResult(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = String(input.incoming_surface_id);
  const normalized = manifest.legacy_aliases[incoming] ?? incoming;
  return {
    normalized_surface_id: normalized,
    journal: { surface_id: normalized },
    reservation: { surface_id: normalized, pool_ref: input.pool_ref },
    new_run: {
      surface_id: normalized,
      pool_ref: input.pool_ref,
      runtime_sha256: input.runtime_sha256,
      evidence_revision: input.evidence_revision,
    },
    active_runs: structuredClone(input.active_runs),
  };
}

function rollbackResult(input: Record<string, unknown>): Record<string, unknown> {
  const strict = input.strict_facts_after_rollback as Record<string, unknown>;
  const requiredStrictFacts = [
    'effective_cancel_qualified',
    'plugin_host_qualified',
    'sandbox_qualified',
  ];
  const strictFactsComplete =
    isRecord(strict) &&
    requiredStrictFacts.every((key) => Object.hasOwn(strict, key) && strict[key] === 'qualified') &&
    Object.values(strict).every((value) => value === 'qualified');
  return {
    ordered_steps: ['disable-profile-consumers', 'restore-legacy-producer'],
    automatic_eligible_surface_ids: strictFactsComplete ? ['cursor-agent-cli'] : [],
    active_runs: structuredClone(input.active_runs),
    effects: {
      login: false,
      logout: false,
      account_switch: false,
      credential_migration: false,
      pool_merge: false,
      active_run_reparent: false,
      destructive_cancel: false,
    },
  };
}

test('fixture manifest freezes two canonical bounded contexts and one alias only', () => {
  assert.equal(manifest.schema, 'ccm/cursor-dual-surface-fixture-manifest/v1');
  assert.equal(manifest.contract, CONTRACT);
  assert.deepEqual(manifest.surface_ids, SURFACE_IDS);
  assert.deepEqual(Object.keys(manifest.profiles), SURFACE_IDS);
  assert.deepEqual(manifest.legacy_aliases, { 'cursor-agent': 'cursor-agent-cli' });
  assert.deepEqual(manifest.fixture_files, [
    'scenarios.json',
    'provenance-mutants.json',
    'lifecycle.json',
  ]);

  const ide = manifest.profiles['cursor-ide-plugin'];
  const agent = manifest.profiles['cursor-agent-cli'];
  assert.equal(ide.bounded_context, 'ide-origin-plugin');
  assert.equal(agent.bounded_context, 'headless-worker-transport');
  const ideRoles = requiredRecord(ide.roles, 'cursor-ide-plugin.roles');
  const agentRoles = requiredRecord(agent.roles, 'cursor-agent-cli.roles');
  assert.equal(requiredRecord(ideRoles.master_origin, 'ide.master_origin').state, 'supported');
  assert.equal(
    requiredRecord(agentRoles.master_origin, 'agent.master_origin').state,
    'unsupported',
  );
  assert.equal(requiredRecord(agentRoles.worker_target, 'agent.worker_target').state, 'supported');
});

test('Track A/B profile claims are bound to contracts, descriptors, source strategies, dist, and probes', () => {
  validateTrackClaims(manifest);
  const anchorKinds = new Set<string>();
  for (const [claimId, claim] of Object.entries(manifest.track_claims)) {
    for (const [index, anchor] of claim.anchors.entries()) {
      if (anchorKinds.has(anchor.kind)) continue;
      anchorKinds.add(anchor.kind);
      const drifted = structuredClone(manifest);
      const driftedAnchor = drifted.track_claims[claimId]?.anchors[index];
      assert.ok(driftedAnchor);
      driftedAnchor.contains[0] = 'counterfeit-track-status';
      assert.throws(() => validateTrackClaims(drifted), /drifted/u, anchor.kind);
    }
  }
  assert.deepEqual([...anchorKinds].sort(), [
    'adapter-strategy',
    'capability-intent',
    'hook-contract',
    'host-native-dist',
    'machine-surface-descriptor',
    'probe-evidence',
    'transport-contract',
  ]);

  const crossSurfaceClaim = structuredClone(manifest);
  const reboundClaim = crossSurfaceClaim.track_claims['cursor-ide-track-b-lifecycle'];
  assert.ok(reboundClaim);
  reboundClaim.surface_id = 'cursor-agent-cli';
  assert.throws(() => validateTrackClaims(crossSurfaceClaim), /surface binding/u);

  const crossSurfaceDescriptor = structuredClone(manifest);
  const descriptorClaim = crossSurfaceDescriptor.track_claims['cursor-ide-track-b-lifecycle'];
  assert.ok(descriptorClaim);
  const descriptorAnchor = descriptorClaim.anchors.find(
    (anchor) => anchor.kind === 'machine-surface-descriptor',
  );
  assert.ok(descriptorAnchor);
  descriptorAnchor.surface_id = 'cursor-agent-cli';
  assert.throws(() => validateTrackClaims(crossSurfaceDescriptor), /descriptor surface/u);
});

test('fixtures cover every declared axis and agree with the executable contract oracle', () => {
  assert.equal(scenarios.schema, 'ccm/cursor-dual-surface-scenarios/v1');
  assert.equal(scenarios.contract, CONTRACT);
  const ids = scenarios.cases.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  const covered = new Set(scenarios.cases.flatMap((entry) => entry.coverage));
  assert.deepEqual([...manifest.required_coverage].sort(), [...covered].sort());

  for (const entry of scenarios.cases) {
    assert.match(entry.id, /^CSD-[0-9]{3}$/u);
    assert.ok(entry.title.length > 0);
    const input = merge(scenarios.defaults, entry.overrides) as Record<string, unknown>;
    assert.deepEqual(Object.keys(input).sort(), [...SURFACE_IDS].sort());
    for (const surfaceId of SURFACE_IDS) {
      const surface = input[surfaceId] as Record<string, unknown>;
      assert.deepEqual(
        Object.keys(surface.evidence as Record<string, unknown>).sort(),
        Object.keys(manifest.provenance_policy[surfaceId]).sort(),
        `${entry.id}:${surfaceId}`,
      );
      for (const axis of Object.keys(manifest.provenance_policy[surfaceId])) {
        assert.equal(
          evidenceIssue(surfaceId, surface, axis),
          null,
          `${entry.id}:${surfaceId}:${axis}`,
        );
      }
    }
    assert.deepEqual(evaluateFixture(input), entry.expected, entry.id);
  }
});

test('inverse axes kill counterfeit auth/quota, sandbox, invoke/result, and resume evaluators', () => {
  const mutants: Array<{ name: string; options: OracleOptions; killedBy: string[] }> = [
    {
      name: 'quota-ample-implies-auth-and-always-require-sandbox',
      options: { authFromQuota: true, alwaysRequireSandbox: true },
      killedBy: ['CSD-013', 'CSD-014'],
    },
    {
      name: 'result-implies-invoke',
      options: { resultImpliesInvoke: true },
      killedBy: ['CSD-015'],
    },
    {
      name: 'continuation-ignores-resume',
      options: { ignoreResume: true },
      killedBy: ['CSD-016'],
    },
    {
      name: 'ide-quota-implies-agent-auth',
      options: { ideQuotaAuthorizesAgentAuth: true },
      killedBy: ['CSD-018'],
    },
  ];

  for (const mutant of mutants) {
    const killed = scenarios.cases
      .filter((entry) => {
        const input = merge(scenarios.defaults, entry.overrides) as Record<string, unknown>;
        return !isDeepEqual(evaluateFixture(input, mutant.options), entry.expected);
      })
      .map((entry) => entry.id);
    for (const caseId of mutant.killedBy) {
      assert.ok(killed.includes(caseId), `${mutant.name} survived ${caseId}`);
    }
  }
});

function isDeepEqual(left: unknown, right: unknown): boolean {
  try {
    assert.deepEqual(left, right);
    return true;
  } catch {
    return false;
  }
}

test('stale, unknown, cross-surface, future, and inverted provenance mutants fail closed', () => {
  assert.equal(provenanceMutants.schema, 'ccm/cursor-dual-surface-provenance-mutants/v1');
  assert.equal(provenanceMutants.contract, CONTRACT);

  for (const mutant of provenanceMutants.mutants) {
    const baseCaseId = mutant.base_case_id ?? provenanceMutants.base_case_id;
    const base = scenarios.cases.find((entry) => entry.id === baseCaseId);
    assert.ok(base);
    const baseInput = merge(scenarios.defaults, base.overrides) as Record<string, unknown>;
    const eligibilityKey =
      mutant.target.role === 'master-origin'
        ? 'master_origin_eligible_surface_ids'
        : 'worker_eligible_surface_ids';
    assert.equal(
      evaluateFixture(baseInput)[eligibilityKey].includes(mutant.target.surface_id),
      true,
      `${mutant.id} base must be eligible`,
    );
    const input = merge(baseInput, mutant.patch) as Record<string, unknown>;
    const decision = evaluateFixture(input);
    assert.equal(
      decision[eligibilityKey].includes(mutant.target.surface_id),
      mutant.expected_eligible,
      mutant.id,
    );
    const blockerKey = `${mutant.target.surface_id}:${mutant.target.role}`;
    assert.deepEqual(decision.blockers[blockerKey], mutant.expected_blockers);
    const provenanceBlind = evaluateFixture(input, {
      ignoreProvenanceFor: mutant.target.surface_id,
    });
    assert.notDeepEqual(
      provenanceBlind,
      decision,
      `${mutant.id} did not kill provenance-blind logic`,
    );
  }
});

test('migration and consumer-first rollback fixtures execute fail-closed lifecycle invariants', () => {
  assert.equal(lifecycle.schema, 'ccm/cursor-dual-surface-lifecycle-fixtures/v1');
  assert.equal(lifecycle.contract, CONTRACT);
  const migrated = migrationResult(lifecycle.migration.input);
  assert.deepEqual(migrated, lifecycle.migration.expected, lifecycle.migration.id);
  const rolledBack = rollbackResult(lifecycle.rollback.input);
  assert.deepEqual(rolledBack, lifecycle.rollback.expected, lifecycle.rollback.id);

  for (const mutant of lifecycle.rollback_mutants) {
    const input = structuredClone(lifecycle.rollback.input);
    input.strict_facts_after_rollback = mutant.strict_facts_after_rollback;
    assert.deepEqual(
      rollbackResult(input).automatic_eligible_surface_ids,
      mutant.expected_automatic_eligible_surface_ids,
      mutant.id,
    );
  }

  const activeRunRewrite = structuredClone(migrated);
  (
    (activeRunRewrite.active_runs as Array<Record<string, unknown>>)[0] as Record<string, unknown>
  ).runtime_sha256 = lifecycle.migration.input.runtime_sha256;
  const migrationMutants = [
    merge(migrated, { journal: { surface_id: 'cursor-agent' } }),
    activeRunRewrite,
  ];
  for (const mutant of migrationMutants) assert.notDeepEqual(mutant, lifecycle.migration.expected);

  const activeRunReparent = structuredClone(rolledBack);
  const reparented = (activeRunReparent.active_runs as Array<Record<string, unknown>>)[0];
  assert.ok(reparented);
  reparented.surface_id = 'cursor-agent';
  reparented.pool_ref = 'legacy:joined-pool';
  const rollbackMutants = [
    merge(rolledBack, {
      ordered_steps: ['restore-legacy-producer', 'disable-profile-consumers'],
    }),
    merge(rolledBack, { automatic_eligible_surface_ids: ['cursor-agent-cli'] }),
    merge(rolledBack, { effects: { account_switch: true } }),
    activeRunReparent,
  ];
  for (const mutant of rollbackMutants) assert.notDeepEqual(mutant, lifecycle.rollback.expected);
});

test('both Cursor surfaces retain the complete account/credential/pool mutation deny floor', () => {
  assert.deepEqual(manifest.negative_capabilities, {
    automatic_login: 'forbidden',
    automatic_logout: 'forbidden',
    account_switch: 'forbidden',
    session_switch: 'forbidden',
    credential_import: 'forbidden',
    credential_copy: 'forbidden',
    credential_write: 'forbidden',
    auth_store_write: 'forbidden',
    cross_surface_pool_inference: 'forbidden',
  });

  for (const entry of scenarios.cases) {
    for (const relation of entry.expected.pool_relations) {
      assert.equal(relation.join_allowed, false, `${entry.id} must never join surface pools`);
      assert.equal(relation.reason, 'cross-surface-pool-inference-forbidden');
    }
  }
});

if (RUN_RED) {
  test('RED: production evaluator and lifecycle functions satisfy frozen fixtures', async () => {
    const cursorSurfaces = (await import(
      '../src/harnesses/cursor-surfaces.js'
    )) as unknown as Record<string, unknown>;
    const evaluator = cursorSurfaces.evaluateCursorDualSurfaceContract;
    assert.equal(
      typeof evaluator,
      'function',
      'HONEST RED: cursor-surfaces.ts does not export evaluateCursorDualSurfaceContract yet',
    );

    for (const entry of scenarios.cases) {
      const input = merge(scenarios.defaults, entry.overrides);
      const output = (evaluator as (value: unknown) => Record<string, unknown>)(input);
      assert.equal(output.schema, CONTRACT, entry.id);
      for (const surface of output.surfaces as Array<Record<string, unknown>>) {
        assert.deepEqual(
          surface.profile,
          manifest.profiles[surface.surface_id as SurfaceId],
          entry.id,
        );
        assert.deepEqual(surface.negative_capabilities, manifest.negative_capabilities, entry.id);
      }
      assert.deepEqual(output.decision, entry.expected, entry.id);
    }

    for (const mutant of provenanceMutants.mutants) {
      const baseCaseId = mutant.base_case_id ?? provenanceMutants.base_case_id;
      const base = scenarios.cases.find((entry) => entry.id === baseCaseId);
      assert.ok(base);
      const baseInput = merge(scenarios.defaults, base.overrides);
      const input = merge(baseInput, mutant.patch);
      const output = (evaluator as (value: unknown) => Record<string, unknown>)(input);
      const decision = output.decision as ContractDecision;
      const eligibilityKey =
        mutant.target.role === 'master-origin'
          ? 'master_origin_eligible_surface_ids'
          : 'worker_eligible_surface_ids';
      assert.equal(
        decision[eligibilityKey].includes(mutant.target.surface_id),
        mutant.expected_eligible,
        mutant.id,
      );
      assert.deepEqual(
        decision.blockers[`${mutant.target.surface_id}:${mutant.target.role}`],
        mutant.expected_blockers,
        mutant.id,
      );
    }

    const migrate = cursorSurfaces.migrateCursorDualSurfaceLifecycle;
    assert.equal(
      typeof migrate,
      'function',
      'HONEST RED: cursor-surfaces.ts does not export migrateCursorDualSurfaceLifecycle yet',
    );
    assert.deepEqual(
      (migrate as (value: unknown) => Record<string, unknown>)(lifecycle.migration.input),
      lifecycle.migration.expected,
      lifecycle.migration.id,
    );

    const rollback = cursorSurfaces.rollbackCursorDualSurfaceLifecycle;
    assert.equal(
      typeof rollback,
      'function',
      'HONEST RED: cursor-surfaces.ts does not export rollbackCursorDualSurfaceLifecycle yet',
    );
    assert.deepEqual(
      (rollback as (value: unknown) => Record<string, unknown>)(lifecycle.rollback.input),
      lifecycle.rollback.expected,
      lifecycle.rollback.id,
    );
    for (const mutant of lifecycle.rollback_mutants) {
      const input = structuredClone(lifecycle.rollback.input);
      input.strict_facts_after_rollback = mutant.strict_facts_after_rollback;
      const output = (rollback as (value: unknown) => Record<string, unknown>)(input);
      assert.deepEqual(
        output.automatic_eligible_surface_ids,
        mutant.expected_automatic_eligible_surface_ids,
        mutant.id,
      );
    }
  });
}
