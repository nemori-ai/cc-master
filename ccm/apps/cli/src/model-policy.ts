import rawRoleRegistry from './data/model-policy/role-candidates.json' with { type: 'json' };
import rawAffinityRegistry from './data/model-policy/task-affinity.json' with { type: 'json' };
import {
  PROVIDER_MODEL_FACTS_REGISTRY,
  type ProviderModelFactsProvider,
  providerModelFacts,
} from './provider-model-facts.js';

type JsonObject = Record<string, unknown>;
type RoleGrade = 'O' | 'T1' | 'T2' | 'T3';
type Posture = 'ample' | 'tight';

interface RoleCandidate {
  candidate_id: string;
  provider: ProviderModelFactsProvider;
  surface: string;
  model_id: string;
  candidate_role_grades: RoleGrade[];
  state: 'candidate' | 'certified' | 'expired' | 'revoked' | 'rejected';
  provenance?: Array<{ kind: string; ref: string; recorded_at: string }>;
  blockers: string[];
}

interface ExcludedRoute {
  provider: ProviderModelFactsProvider;
  surface: string;
  model_id: string;
  reason_code: string;
}

interface OrderingPolicy {
  effect_floor_gate: 'hard';
  never_on: string[];
  equivalence_band: number;
  max_affinity_delta: number;
  postures: Record<Posture, Record<MetricName, number>>;
  community_affinity: {
    mode: 'bounded-tie-break-only';
    stale: 'neutral';
    mixed: 'neutral';
    unknown: 'neutral';
    contradictions: 'neutral';
    very_weak_confidence_below: number;
  };
}

interface RoleRegistry {
  schema: 'ccm/model-role-candidate-registry/v1';
  revision: string;
  role_grades: Record<RoleGrade, string>;
  task_policy: Record<string, RoleGrade>;
  candidates: RoleCandidate[];
  excluded_automatic_routes: ExcludedRoute[];
  ordering: OrderingPolicy;
}

interface AffinitySource {
  url: string;
  author: string;
  published_at: string;
  retrieved_at: string;
}

interface AffinityEntry {
  evidence_id: string;
  provider: ProviderModelFactsProvider;
  surface: string;
  model_id: string;
  task_taxonomy: string;
  signal: 'positive' | 'negative' | 'mixed' | 'unknown';
  direction: number;
  confidence: number;
  source: AffinitySource;
  observed_at: string;
  valid_until: string;
  contradictions: string[];
  limitations: string[];
}

interface AffinityRegistry {
  schema: 'ccm/task-affinity-registry/v1';
  revision: string;
  entries: AffinityEntry[];
}

type MetricName =
  | 'cost_score'
  | 'quota_headroom'
  | 'latency_score'
  | 'context_fit'
  | 'integration_score';

interface AdviceAffinity {
  state: 'current' | 'stale' | 'mixed' | 'unknown' | 'contradictory' | 'weak';
  direction: number;
  confidence: number;
  observed_at: string | null;
  valid_until: string | null;
  registry_revision: string;
  evidence_refs: string[];
  contradictions: string[];
}

interface AdviceCandidate {
  id: string;
  provider: ProviderModelFactsProvider;
  surface: string;
  model: string;
  qualification: {
    schema: 'ccm/model-policy-live-qualification/v1';
    candidate_id: string;
    provider: ProviderModelFactsProvider;
    surface: string;
    model: string;
    status: 'qualified' | 'unqualified' | 'unknown';
    certified_role_grades: RoleGrade[];
    evidence_refs: string[];
    revision: string;
    observed_at: string;
    valid_until: string;
  };
  admission: {
    schema: 'ccm/model-policy-live-admission/v1';
    candidate_id: string;
    provider: ProviderModelFactsProvider;
    surface: string;
    model: string;
    status: 'admitted' | 'rejected' | 'unknown';
    evidence_refs: string[];
    revision: string;
    observed_at: string;
    valid_until: string;
  };
  hard_gate: {
    exact_selector: boolean;
    quota_state: string;
    policy_compatible: boolean;
    security_compatible: boolean;
    permission_compatible: boolean;
    workspace_compatible: boolean;
    task_unblocked: boolean;
    acceptance_satisfied: boolean;
    paid_use_authorized: boolean;
    retention_compatible: boolean;
  };
  metrics: Record<MetricName, number>;
  community_affinity: {
    registry_revision: string;
    evidence_refs: string[];
  };
}

interface AdviceRequest {
  schema: 'ccm/model-policy-advice-request/v1';
  task_taxonomy: string;
  required_role_grade: RoleGrade;
  posture: Posture;
  candidates: AdviceCandidate[];
}

const ROLE_GRADES = new Set<RoleGrade>(['O', 'T1', 'T2', 'T3']);
const METRICS: MetricName[] = [
  'cost_score',
  'quota_headroom',
  'latency_score',
  'context_fit',
  'integration_score',
];
const NEVER_ON = [
  'policy-blocked',
  'permission-blocked',
  'security-blocked',
  'workspace-mismatch',
  'task-blocked',
  'acceptance-failed',
] as const;

export const MODEL_ROLE_CANDIDATE_REGISTRY = rawRoleRegistry as unknown as RoleRegistry;
export const TASK_AFFINITY_REGISTRY = rawAffinityRegistry as unknown as AffinityRegistry;

function object(value: unknown, path: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as JsonObject;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`${path} must be non-empty`);
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`);
  return value;
}

function exactKeys(value: JsonObject, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${path} keys must be exactly ${wanted.join(', ')}`);
  }
}

function utc(value: unknown, path: string): number {
  const text = string(value, path);
  if (!text.endsWith('Z')) throw new Error(`${path} must be UTC RFC3339`);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) throw new Error(`${path} must be RFC3339`);
  return parsed;
}

function unit(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${path} must be a number in [0,1]`);
  }
  return value;
}

function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${path} must be a string array`);
  }
  return value as string[];
}

function nonemptyStrings(value: unknown, path: string): string[] {
  const items = strings(value, path);
  if (items.some((item) => item.trim() === ''))
    throw new Error(`${path} must be non-empty strings`);
  if (new Set(items).size !== items.length) throw new Error(`${path} contains duplicates`);
  return items;
}

function validateTrackedRegistries(): void {
  const roles = object(MODEL_ROLE_CANDIDATE_REGISTRY, 'role_registry');
  if (roles.schema !== 'ccm/model-role-candidate-registry/v1') {
    throw new Error('role_registry.schema is invalid');
  }
  string(roles.revision, 'role_registry.revision');
  const taskPolicy = object(roles.task_policy, 'role_registry.task_policy');
  for (const [task, role] of Object.entries(taskPolicy)) {
    string(task, 'role_registry.task_policy key');
    if (!ROLE_GRADES.has(role as RoleGrade)) throw new Error(`${task} has invalid role grade`);
  }
  if (!Array.isArray(roles.candidates) || roles.candidates.length === 0) {
    throw new Error('role_registry.candidates must be non-empty');
  }
  const candidateIds = new Set<string>();
  for (const [index, raw] of roles.candidates.entries()) {
    const candidate = object(raw, `role_registry.candidates[${index}]`);
    const id = string(candidate.candidate_id, `role_registry.candidates[${index}].candidate_id`);
    if (candidateIds.has(id)) throw new Error(`duplicate model role candidate: ${id}`);
    candidateIds.add(id);
    const provider = string(candidate.provider, `${id}.provider`) as ProviderModelFactsProvider;
    if (!Object.hasOwn(PROVIDER_MODEL_FACTS_REGISTRY.providers, provider)) {
      throw new Error(`${id} references unknown provider ${provider}`);
    }
    const snapshot = PROVIDER_MODEL_FACTS_REGISTRY.providers[provider];
    const models = Array.isArray(snapshot.models) ? snapshot.models : [];
    if (!models.some((item) => object(item, `${provider}.model`).model_id === candidate.model_id)) {
      throw new Error(`${id} references unknown provider model ${String(candidate.model_id)}`);
    }
    const grades = strings(candidate.candidate_role_grades, `${id}.candidate_role_grades`);
    if (grades.length === 0 || grades.some((grade) => !ROLE_GRADES.has(grade as RoleGrade))) {
      throw new Error(`${id} has invalid candidate role grades`);
    }
    if (candidate.provenance !== undefined) {
      if (!Array.isArray(candidate.provenance) || candidate.provenance.length === 0) {
        throw new Error(`${id}.provenance must be a non-empty array when present`);
      }
      for (const [provenanceIndex, rawProvenance] of candidate.provenance.entries()) {
        const provenance = object(rawProvenance, `${id}.provenance[${provenanceIndex}]`);
        string(provenance.kind, `${id}.provenance[${provenanceIndex}].kind`);
        string(provenance.ref, `${id}.provenance[${provenanceIndex}].ref`);
        utc(provenance.recorded_at, `${id}.provenance[${provenanceIndex}].recorded_at`);
      }
    }
    strings(candidate.blockers, `${id}.blockers`);
  }

  const ordering = object(roles.ordering, 'role_registry.ordering');
  const neverOn = strings(ordering.never_on, 'role_registry.ordering.never_on');
  if (
    neverOn.length !== NEVER_ON.length ||
    neverOn.some((reason, index) => reason !== NEVER_ON[index])
  ) {
    throw new Error(`role_registry.ordering.never_on must equal ${NEVER_ON.join(',')}`);
  }
  unit(ordering.equivalence_band, 'role_registry.ordering.equivalence_band');
  unit(ordering.max_affinity_delta, 'role_registry.ordering.max_affinity_delta');
  const affinityPolicy = object(
    ordering.community_affinity,
    'role_registry.ordering.community_affinity',
  );
  unit(
    affinityPolicy.very_weak_confidence_below,
    'role_registry.ordering.community_affinity.very_weak_confidence_below',
  );
  const postures = object(ordering.postures, 'role_registry.ordering.postures');
  for (const posture of ['ample', 'tight'] as const) {
    const weights = object(postures[posture], `role_registry.ordering.postures.${posture}`);
    const total = METRICS.reduce(
      (sum, metric) => sum + unit(weights[metric], `${posture}.${metric}`),
      0,
    );
    if (Math.abs(total - 1) > 1e-9)
      throw new Error(`${posture} model-policy weights must sum to 1`);
  }

  const affinity = object(TASK_AFFINITY_REGISTRY, 'affinity_registry');
  if (affinity.schema !== 'ccm/task-affinity-registry/v1') {
    throw new Error('affinity_registry.schema is invalid');
  }
  string(affinity.revision, 'affinity_registry.revision');
  if (!Array.isArray(affinity.entries))
    throw new Error('affinity_registry.entries must be an array');
  const trackedTargets = new Set(
    MODEL_ROLE_CANDIDATE_REGISTRY.candidates.map(
      (candidate) => `${candidate.provider}\u0000${candidate.surface}\u0000${candidate.model_id}`,
    ),
  );
  const evidenceIds = new Set<string>();
  for (const [index, raw] of affinity.entries.entries()) {
    const entry = object(raw, `affinity_registry.entries[${index}]`);
    const evidenceId = string(entry.evidence_id, `affinity_registry.entries[${index}].evidence_id`);
    if (evidenceIds.has(evidenceId)) throw new Error(`duplicate affinity evidence: ${evidenceId}`);
    evidenceIds.add(evidenceId);
    const provider = string(entry.provider, `${evidenceId}.provider`);
    const surface = string(entry.surface, `${evidenceId}.surface`);
    const modelId = string(entry.model_id, `${evidenceId}.model_id`);
    const taskTaxonomy = string(entry.task_taxonomy, `${evidenceId}.task_taxonomy`);
    if (!Object.hasOwn(MODEL_ROLE_CANDIDATE_REGISTRY.task_policy, taskTaxonomy)) {
      throw new Error(`${evidenceId} references unknown task taxonomy ${taskTaxonomy}`);
    }
    if (!trackedTargets.has(`${provider}\u0000${surface}\u0000${modelId}`)) {
      throw new Error(`${evidenceId} references an untracked model candidate`);
    }
    if (!['positive', 'negative', 'mixed', 'unknown'].includes(String(entry.signal))) {
      throw new Error(`${evidenceId}.signal is invalid`);
    }
    const observed = utc(entry.observed_at, `${evidenceId}.observed_at`);
    const validUntil = utc(entry.valid_until, `${evidenceId}.valid_until`);
    if (observed > validUntil) throw new Error(`${evidenceId} expires before observation`);
    const direction = entry.direction;
    if (typeof direction !== 'number' || direction < -1 || direction > 1) {
      throw new Error(`${evidenceId}.direction must be in [-1,1]`);
    }
    unit(entry.confidence, `${evidenceId}.confidence`);
    strings(entry.contradictions, `${evidenceId}.contradictions`);
    strings(entry.limitations, `${evidenceId}.limitations`);
    const source = object(entry.source, `${evidenceId}.source`);
    const sourceUrl = new URL(string(source.url, `${evidenceId}.source.url`));
    if (sourceUrl.protocol !== 'https:') throw new Error(`${evidenceId}.source.url must be HTTPS`);
    string(source.author, `${evidenceId}.source.author`);
    utc(source.published_at, `${evidenceId}.source.published_at`);
    utc(source.retrieved_at, `${evidenceId}.source.retrieved_at`);
  }
}

function providerModel(provider: ProviderModelFactsProvider, modelId: string): JsonObject {
  const snapshot = PROVIDER_MODEL_FACTS_REGISTRY.providers[provider];
  const models = Array.isArray(snapshot.models) ? snapshot.models : [];
  const model = models.find((item) => object(item, `${provider}.model`).model_id === modelId);
  if (!model)
    throw new Error(`model candidate is absent from provider facts: ${provider}/${modelId}`);
  return structuredClone(object(model, `${provider}.${modelId}`));
}

export function modelPolicyReadModel(taskTaxonomy: string, asOf: string): JsonObject {
  validateTrackedRegistries();
  const asOfMs = utc(asOf, 'as_of');
  const requiredRole = MODEL_ROLE_CANDIDATE_REGISTRY.task_policy[taskTaxonomy];
  if (!requiredRole) throw new Error(`unsupported model-policy task taxonomy: ${taskTaxonomy}`);
  const providers = (['claude-code', 'codex', 'cursor', 'kimi-code'] as const).map((provider) =>
    providerModelFacts(provider, asOf),
  );
  const candidates = MODEL_ROLE_CANDIDATE_REGISTRY.candidates.map((candidate) => ({
    ...structuredClone(candidate),
    official_model_fact: providerModel(candidate.provider, candidate.model_id),
    eligible_for_automatic_selection: false,
    automatic_selection_blockers: [...candidate.blockers],
  }));
  const affinityEntries = TASK_AFFINITY_REGISTRY.entries
    .filter((entry) => entry.task_taxonomy === taskTaxonomy)
    .map((entry) => ({
      ...structuredClone(entry),
      freshness:
        asOfMs < Date.parse(entry.observed_at)
          ? 'future-invalid'
          : asOfMs > Date.parse(entry.valid_until)
            ? 'stale'
            : entry.signal === 'mixed'
              ? 'mixed'
              : 'current',
    }));
  return {
    schema: 'ccm/model-policy-read-model/v1',
    revision: `${MODEL_ROLE_CANDIDATE_REGISTRY.revision}+${TASK_AFFINITY_REGISTRY.revision}`,
    as_of: asOf,
    task: { task_taxonomy: taskTaxonomy, required_role_grade: requiredRole },
    layers: {
      hard_facts: {
        provider_registry_revision: PROVIDER_MODEL_FACTS_REGISTRY.revision,
        providers,
      },
      project_role_evidence: {
        registry_revision: MODEL_ROLE_CANDIDATE_REGISTRY.revision,
        candidates,
        excluded_automatic_routes: structuredClone(
          MODEL_ROLE_CANDIDATE_REGISTRY.excluded_automatic_routes,
        ),
      },
      community_advisory: {
        registry_revision: TASK_AFFINITY_REGISTRY.revision,
        entries: affinityEntries,
        missing_for_task: affinityEntries.length === 0,
      },
    },
    ordering: structuredClone(MODEL_ROLE_CANDIDATE_REGISTRY.ordering),
    side_effects: {
      provider_requests: 0,
      account_mutations: 0,
      credential_writes: 0,
      board_writes: 0,
    },
  };
}

function validateAdviceRequest(value: unknown): AdviceRequest {
  validateTrackedRegistries();
  const request = object(value, 'request');
  exactKeys(
    request,
    ['schema', 'task_taxonomy', 'required_role_grade', 'posture', 'candidates'],
    'request',
  );
  if (request.schema !== 'ccm/model-policy-advice-request/v1') {
    throw new Error('request.schema must be ccm/model-policy-advice-request/v1');
  }
  string(request.task_taxonomy, 'request.task_taxonomy');
  if (!ROLE_GRADES.has(request.required_role_grade as RoleGrade)) {
    throw new Error('request.required_role_grade must be O, T1, T2 or T3');
  }
  if (request.posture !== 'ample' && request.posture !== 'tight') {
    throw new Error('request.posture must be ample or tight');
  }
  const policyRole = MODEL_ROLE_CANDIDATE_REGISTRY.task_policy[request.task_taxonomy as string];
  if (!policyRole) {
    throw new Error(`unsupported model-policy task taxonomy: ${String(request.task_taxonomy)}`);
  }
  if (policyRole !== request.required_role_grade) {
    throw new Error(
      `request.required_role_grade must match task policy ${request.task_taxonomy}:${policyRole}`,
    );
  }
  if (!Array.isArray(request.candidates)) throw new Error('request.candidates must be an array');
  const ids = new Set<string>();
  for (const [index, raw] of request.candidates.entries()) {
    const candidate = object(raw, `request.candidates[${index}]`);
    exactKeys(
      candidate,
      [
        'id',
        'provider',
        'surface',
        'model',
        'qualification',
        'admission',
        'hard_gate',
        'metrics',
        'community_affinity',
      ],
      `request.candidates[${index}]`,
    );
    const id = string(candidate.id, `request.candidates[${index}].id`);
    if (ids.has(id)) throw new Error(`duplicate advice candidate: ${id}`);
    ids.add(id);
    const tracked = MODEL_ROLE_CANDIDATE_REGISTRY.candidates.find(
      (entry) => entry.candidate_id === id,
    );
    if (!tracked) throw new Error(`${id} is not a tracked model candidate`);
    const provider = string(candidate.provider, `${id}.provider`);
    const surface = string(candidate.surface, `${id}.surface`);
    const model = string(candidate.model, `${id}.model`);
    if (
      provider !== tracked.provider ||
      surface !== tracked.surface ||
      model !== tracked.model_id
    ) {
      throw new Error(`${id} provider/surface/model must match tracked candidate`);
    }

    const qualification = object(candidate.qualification, `${id}.qualification`);
    exactKeys(
      qualification,
      [
        'schema',
        'candidate_id',
        'provider',
        'surface',
        'model',
        'status',
        'certified_role_grades',
        'evidence_refs',
        'revision',
        'observed_at',
        'valid_until',
      ],
      `${id}.qualification`,
    );
    if (qualification.schema !== 'ccm/model-policy-live-qualification/v1') {
      throw new Error(`${id}.qualification.schema is invalid`);
    }
    if (
      qualification.candidate_id !== id ||
      qualification.provider !== provider ||
      qualification.surface !== surface ||
      qualification.model !== model
    ) {
      throw new Error(`${id}.qualification target must match tracked candidate`);
    }
    if (!['qualified', 'unqualified', 'unknown'].includes(String(qualification.status))) {
      throw new Error(`${id}.qualification.status is invalid`);
    }
    const grades = strings(
      qualification.certified_role_grades,
      `${id}.qualification.certified_role_grades`,
    );
    if (grades.some((grade) => !ROLE_GRADES.has(grade as RoleGrade))) {
      throw new Error(`${id}.qualification.certified_role_grades is invalid`);
    }
    const qualificationRefs = nonemptyStrings(
      qualification.evidence_refs,
      `${id}.qualification.evidence_refs`,
    );
    if (qualification.status === 'qualified' && qualificationRefs.length === 0) {
      throw new Error(`${id}.qualification.evidence_refs must prove qualified status`);
    }
    string(qualification.revision, `${id}.qualification.revision`);
    const qualificationObserved = utc(qualification.observed_at, `${id}.qualification.observed_at`);
    const qualificationValidUntil = utc(
      qualification.valid_until,
      `${id}.qualification.valid_until`,
    );
    if (qualificationObserved > qualificationValidUntil) {
      throw new Error(`${id}.qualification expires before observation`);
    }

    const admission = object(candidate.admission, `${id}.admission`);
    exactKeys(
      admission,
      [
        'schema',
        'candidate_id',
        'provider',
        'surface',
        'model',
        'status',
        'evidence_refs',
        'revision',
        'observed_at',
        'valid_until',
      ],
      `${id}.admission`,
    );
    if (admission.schema !== 'ccm/model-policy-live-admission/v1') {
      throw new Error(`${id}.admission.schema is invalid`);
    }
    if (
      admission.candidate_id !== id ||
      admission.provider !== provider ||
      admission.surface !== surface ||
      admission.model !== model
    ) {
      throw new Error(`${id}.admission target must match tracked candidate`);
    }
    if (!['admitted', 'rejected', 'unknown'].includes(String(admission.status))) {
      throw new Error(`${id}.admission.status is invalid`);
    }
    const admissionRefs = nonemptyStrings(admission.evidence_refs, `${id}.admission.evidence_refs`);
    if (admission.status === 'admitted' && admissionRefs.length === 0) {
      throw new Error(`${id}.admission.evidence_refs must prove admitted status`);
    }
    string(admission.revision, `${id}.admission.revision`);
    const admissionObserved = utc(admission.observed_at, `${id}.admission.observed_at`);
    const admissionValidUntil = utc(admission.valid_until, `${id}.admission.valid_until`);
    if (admissionObserved > admissionValidUntil) {
      throw new Error(`${id}.admission expires before observation`);
    }

    const hardGate = object(candidate.hard_gate, `${id}.hard_gate`);
    exactKeys(
      hardGate,
      [
        'exact_selector',
        'quota_state',
        'policy_compatible',
        'security_compatible',
        'permission_compatible',
        'workspace_compatible',
        'task_unblocked',
        'acceptance_satisfied',
        'paid_use_authorized',
        'retention_compatible',
      ],
      `${id}.hard_gate`,
    );
    for (const gate of [
      'exact_selector',
      'policy_compatible',
      'security_compatible',
      'permission_compatible',
      'workspace_compatible',
      'task_unblocked',
      'acceptance_satisfied',
      'paid_use_authorized',
      'retention_compatible',
    ]) {
      boolean(hardGate[gate], `${id}.hard_gate.${gate}`);
    }
    if (!['ample', 'tight', 'exhausted', 'unknown'].includes(String(hardGate.quota_state))) {
      throw new Error(`${id}.hard_gate.quota_state is invalid`);
    }

    const metrics = object(candidate.metrics, `${id}.metrics`);
    exactKeys(metrics, METRICS, `${id}.metrics`);
    for (const metric of METRICS) unit(metrics[metric], `${id}.metrics.${metric}`);
    const affinity = object(candidate.community_affinity, `${id}.community_affinity`);
    exactKeys(affinity, ['registry_revision', 'evidence_refs'], `${id}.community_affinity`);
    if (affinity.registry_revision !== TASK_AFFINITY_REGISTRY.revision) {
      throw new Error(
        `${id}.community_affinity.registry_revision must equal tracked revision ${TASK_AFFINITY_REGISTRY.revision}`,
      );
    }
    const evidenceRefs = nonemptyStrings(
      affinity.evidence_refs,
      `${id}.community_affinity.evidence_refs`,
    );
    for (const evidenceRef of evidenceRefs) {
      const evidence = TASK_AFFINITY_REGISTRY.entries.find(
        (entry) => entry.evidence_id === evidenceRef,
      );
      if (!evidence) throw new Error(`unknown community affinity evidence: ${evidenceRef}`);
      if (
        evidence.task_taxonomy !== request.task_taxonomy ||
        evidence.provider !== provider ||
        evidence.surface !== surface ||
        evidence.model_id !== model
      ) {
        throw new Error(
          `${evidenceRef} does not bind request task and candidate ${request.task_taxonomy}/${id}`,
        );
      }
    }
  }
  return value as AdviceRequest;
}

function currentWindow(observedAt: string, validUntil: string, asOfMs: number): boolean {
  const observed = Date.parse(observedAt);
  const valid = Date.parse(validUntil);
  return observed <= asOfMs && asOfMs <= valid && observed <= valid;
}

function rejectionReasons(
  candidate: AdviceCandidate,
  tracked: RoleCandidate,
  requiredRole: RoleGrade,
  asOfMs: number,
): string[] {
  const reasons: string[] = [];
  if (
    !tracked.candidate_role_grades.includes(requiredRole) ||
    candidate.qualification.status !== 'qualified' ||
    !candidate.qualification.certified_role_grades.includes(requiredRole) ||
    !currentWindow(candidate.qualification.observed_at, candidate.qualification.valid_until, asOfMs)
  ) {
    reasons.push('effect-floor-not-met');
  }
  if (!candidate.hard_gate.exact_selector) reasons.push('exact-selector-unproven');
  if (
    candidate.admission.status !== 'admitted' ||
    !currentWindow(candidate.admission.observed_at, candidate.admission.valid_until, asOfMs)
  ) {
    reasons.push('live-admission-unproven');
  }
  if (candidate.hard_gate.quota_state !== 'ample') reasons.push('quota-not-ample');
  if (!candidate.hard_gate.policy_compatible) reasons.push('policy-blocked');
  if (!candidate.hard_gate.security_compatible) reasons.push('security-blocked');
  if (!candidate.hard_gate.permission_compatible) reasons.push('permission-blocked');
  if (!candidate.hard_gate.workspace_compatible) reasons.push('workspace-mismatch');
  if (!candidate.hard_gate.task_unblocked) reasons.push('task-blocked');
  if (!candidate.hard_gate.acceptance_satisfied) reasons.push('acceptance-failed');
  if (!candidate.hard_gate.paid_use_authorized) reasons.push('paid-use-not-authorized');
  if (!candidate.hard_gate.retention_compatible) reasons.push('retention-incompatible');
  return reasons;
}

function affinityDelta(affinity: AdviceAffinity, asOfMs: number, maxDelta: number): number {
  if (affinity.state !== 'current' || affinity.evidence_refs.length === 0) return 0;
  const observed = Date.parse(affinity.observed_at ?? '');
  const validUntil = Date.parse(affinity.valid_until ?? '');
  if (asOfMs < observed || asOfMs > validUntil || validUntil <= observed) return 0;
  const remaining = (validUntil - asOfMs) / (validUntil - observed);
  const raw = affinity.direction * affinity.confidence * remaining;
  return Math.max(-maxDelta, Math.min(maxDelta, raw * maxDelta));
}

function resolveAffinity(candidate: AdviceCandidate, asOfMs: number): AdviceAffinity {
  const evidenceRefs = candidate.community_affinity.evidence_refs;
  const neutral = (
    state: AdviceAffinity['state'],
    entries: AffinityEntry[] = [],
  ): AdviceAffinity => ({
    state,
    direction: 0,
    confidence: 0,
    observed_at:
      entries.length === 0
        ? null
        : new Date(
            Math.max(...entries.map((entry) => Date.parse(entry.observed_at))),
          ).toISOString(),
    valid_until:
      entries.length === 0
        ? null
        : new Date(
            Math.min(...entries.map((entry) => Date.parse(entry.valid_until))),
          ).toISOString(),
    registry_revision: TASK_AFFINITY_REGISTRY.revision,
    evidence_refs: [...evidenceRefs],
    contradictions: [...new Set(entries.flatMap((entry) => entry.contradictions))],
  });
  if (evidenceRefs.length === 0) return neutral('unknown');
  const entries = evidenceRefs.map(
    (ref) => TASK_AFFINITY_REGISTRY.entries.find((entry) => entry.evidence_id === ref)!,
  );
  if (
    entries.some(
      (entry) => asOfMs < Date.parse(entry.observed_at) || asOfMs > Date.parse(entry.valid_until),
    )
  ) {
    return neutral('stale', entries);
  }
  if (entries.some((entry) => entry.signal === 'unknown')) return neutral('unknown', entries);
  if (entries.some((entry) => entry.signal === 'mixed')) return neutral('mixed', entries);
  const confidence = Math.min(...entries.map((entry) => entry.confidence));
  if (
    confidence <
    MODEL_ROLE_CANDIDATE_REGISTRY.ordering.community_affinity.very_weak_confidence_below
  ) {
    return neutral('weak', entries);
  }
  const hasContradiction = entries.some((entry) => entry.contradictions.length > 0);
  const directions = new Set(entries.map((entry) => Math.sign(entry.direction)));
  if (hasContradiction || directions.size > 1) return neutral('contradictory', entries);
  const weight = entries.reduce((sum, entry) => sum + entry.confidence, 0);
  const direction =
    weight === 0
      ? 0
      : entries.reduce((sum, entry) => sum + entry.direction * entry.confidence, 0) / weight;
  const observedAt = new Date(
    Math.max(...entries.map((entry) => Date.parse(entry.observed_at))),
  ).toISOString();
  const validUntil = new Date(
    Math.min(...entries.map((entry) => Date.parse(entry.valid_until))),
  ).toISOString();
  return {
    state: 'current',
    direction,
    confidence,
    observed_at: observedAt,
    valid_until: validUntil,
    registry_revision: TASK_AFFINITY_REGISTRY.revision,
    evidence_refs: [...evidenceRefs],
    contradictions: [],
  };
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function modelPolicyAdvice(value: unknown, asOf: string): JsonObject {
  const request = validateAdviceRequest(value);
  const asOfMs = utc(asOf, 'as_of');
  const policy = MODEL_ROLE_CANDIDATE_REGISTRY.ordering;
  const weights = policy.postures[request.posture];
  const rejected: Array<{ id: string; reason_codes: string[] }> = [];
  const eligible = request.candidates.flatMap((candidate) => {
    const tracked = MODEL_ROLE_CANDIDATE_REGISTRY.candidates.find(
      (entry) => entry.candidate_id === candidate.id,
    )!;
    const reasonCodes = rejectionReasons(candidate, tracked, request.required_role_grade, asOfMs);
    if (reasonCodes.length > 0) {
      rejected.push({ id: candidate.id, reason_codes: reasonCodes });
      return [];
    }
    const baseScore = METRICS.reduce(
      (sum, metric) => sum + candidate.metrics[metric] * weights[metric],
      0,
    );
    const communityAffinity = resolveAffinity(candidate, asOfMs);
    return [
      {
        ...structuredClone(candidate),
        community_affinity: communityAffinity,
        base_score: rounded(baseScore),
        community_delta: rounded(
          affinityDelta(communityAffinity, asOfMs, policy.max_affinity_delta),
        ),
        community_tie_break_applied: false,
      },
    ];
  });

  eligible.sort((a, b) => b.base_score - a.base_score || a.id.localeCompare(b.id));
  const ranked: typeof eligible = [];
  for (let start = 0; start < eligible.length; ) {
    const groupTop = eligible[start];
    if (!groupTop) break;
    let end = start + 1;
    while (
      end < eligible.length &&
      groupTop.base_score - (eligible[end]?.base_score ?? Number.NEGATIVE_INFINITY) <=
        policy.equivalence_band
    ) {
      end += 1;
    }
    const group = eligible.slice(start, end);
    if (group.length > 1) {
      for (const item of group) {
        item.community_tie_break_applied = item.community_delta !== 0;
      }
      group.sort(
        (a, b) =>
          b.base_score + b.community_delta - (a.base_score + a.community_delta) ||
          b.base_score - a.base_score ||
          a.id.localeCompare(b.id),
      );
    }
    ranked.push(...group);
    start = end;
  }

  return {
    schema: 'ccm/model-policy-advice/v1',
    as_of: asOf,
    task_taxonomy: request.task_taxonomy,
    required_role_grade: request.required_role_grade,
    posture: request.posture,
    policy: {
      registry_revision: MODEL_ROLE_CANDIDATE_REGISTRY.revision,
      effect_floor_gate: policy.effect_floor_gate,
      never_on: [...policy.never_on],
      weights,
      equivalence_band: policy.equivalence_band,
      max_affinity_delta: policy.max_affinity_delta,
      community_affinity_mode: policy.community_affinity.mode,
    },
    ranked,
    rejected,
    side_effects: {
      provider_requests: 0,
      account_mutations: 0,
      credential_writes: 0,
      board_writes: 0,
    },
  };
}
