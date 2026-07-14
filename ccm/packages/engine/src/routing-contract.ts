// routing-contract.ts — cross-harness C1/S0 additive contract SSOT.
//
// Pure, provider-neutral validation only: no fs/network/process/credential reads and no model/provider ranking.
// Board persistence and command composition stay in ccm CLI; this module owns the versioned shapes and invariants.

export const TASK_PLANNING_CONTRACT = 'ccm/task-planning/v1';
export const AGENT_ROUTING_CONTRACT = 'ccm/agent-routing/v1';

export const ROUTE_SURFACES = ['host-native', 'cli-headless'] as const;
export const ROUTE_CHAINS = ['ample', 'tight'] as const;
export const ROUTE_OBJECTIVES = ['quality-first', 'balanced', 'cost-first'] as const;

export const AUTOMATIC_FALLBACK_FAILURES = [
  'binary-unavailable',
  'auth-expired',
  'model-unavailable',
  'model-mismatch',
  'quota-tight',
  'rate-limited',
  'startup-timeout',
  'transport-error',
] as const;

export const NEVER_FALLBACK_FAILURES = [
  'policy-blocked',
  'permission-blocked',
  'security-blocked',
  'workspace-mismatch',
  'task-blocked',
  'acceptance-failed',
] as const;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const PLANNING_DIMENSIONS = {
  reasoning: ['routine', 'multi-step', 'novel', 'frontier'],
  uncertainty: ['low', 'medium', 'high', 'unknown'],
  risk: ['low', 'medium', 'high', 'critical'],
  scope: ['local', 'multi-file', 'cross-module', 'cross-repo'],
  context: ['small', 'medium', 'large', 'oversized'],
  coordination: ['none', 'single-boundary', 'multi-boundary'],
  reversibility: ['reversible', 'costly', 'irreversible'],
} as const;

export interface ContractIssue {
  code: string;
  path: string;
  message: string;
}

export type ContractActivation = 'legacy' | 'enabled' | 'invalid';
export type ContractWritePolicy = 'generic' | 'dedicated' | 'append-only';
export type RouteOutcomeClass =
  | 'same-native'
  | 'same-harness-cli'
  | 'other-harness-cli'
  | 'origin-stay'
  | 'no-route'
  | 'invalid';

interface RecordLike {
  // biome-ignore lint/suspicious/noExplicitAny: This boundary validates untyped board JSON recursively.
  [key: string]: any;
}

function record(value: unknown): value is RecordLike {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function issue(code: string, path: string, message: string): ContractIssue {
  return { code, path, message };
}

function strictIso(value: unknown): value is string {
  if (!nonEmpty(value) || !ISO_UTC.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmpty);
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dup.add(value);
    seen.add(value);
  }
  return [...dup];
}

export function contractActivation(board: unknown): ContractActivation {
  if (!record(board) || !record(board.meta) || !record(board.meta.contracts)) return 'legacy';
  const contracts = board.meta.contracts;
  const hasPlanning = Object.hasOwn(contracts, 'task_planning');
  const hasRouting = Object.hasOwn(contracts, 'agent_routing');
  if (!hasPlanning && !hasRouting) return 'legacy';
  return contracts.task_planning === TASK_PLANNING_CONTRACT &&
    contracts.agent_routing === AGENT_ROUTING_CONTRACT &&
    strictIso(contracts.agent_routing_activated_at) &&
    Array.isArray(contracts.agent_routing_grandfathered_terminal)
    ? 'enabled'
    : 'invalid';
}

const TERMINAL_GRANDFATHER_STATUSES = new Set(['done', 'failed', 'escalated']);

export function routingContractAppliesToTask(board: unknown, task: unknown): boolean {
  if (contractActivation(board) !== 'enabled' || !record(task) || task.executor !== 'subagent') {
    return false;
  }
  if (!TERMINAL_GRANDFATHER_STATUSES.has(task.status)) return true;
  const fingerprints = (board as RecordLike).meta.contracts.agent_routing_grandfathered_terminal;
  const grandfathered = fingerprints.some(
    (entry: unknown) =>
      record(entry) &&
      entry.task_id === task.id &&
      (entry.created_at ?? null) === (task.created_at ?? null),
  );
  return !grandfathered;
}

export function contractWritePolicy(
  scope: 'board' | 'task',
  segments: string[],
  opts: { contractEnabled?: boolean } = {},
): ContractWritePolicy {
  if (scope === 'board' && segments[0] === 'meta') {
    if (segments.length === 1 || segments[1] === 'contracts') return 'dedicated';
  }
  if (scope === 'board' && segments[0] === 'delivery_contract') return 'dedicated';
  if (scope === 'task') {
    if (segments[0] === 'planning') return 'dedicated';
    if (segments[0] === 'routing') {
      return segments[1] === 'attempts' ? 'append-only' : 'dedicated';
    }
    if (segments[0] === 'delivery') return 'dedicated';
    if (segments[0] === 'dependency_requirements') return 'dedicated';
    if (segments[0] === 'handle' && opts.contractEnabled) return 'dedicated';
    if (segments[0] === 'executor' && opts.contractEnabled) return 'dedicated';
  }
  return 'generic';
}

function validateCapabilityList(
  value: unknown,
  path: string,
  required: boolean,
): { issues: ContractIssue[]; ids: string[] } {
  const issues: ContractIssue[] = [];
  if (!Array.isArray(value)) {
    return { issues: [issue('PLANNING-CAPABILITIES', path, 'must be an array')], ids: [] };
  }
  if (required && value.length === 0) {
    issues.push(issue('PLANNING-CAPABILITIES', path, 'must contain at least one capability'));
  }
  const ids: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!record(item) || !nonEmpty(item.id)) {
      issues.push(
        issue('PLANNING-CAPABILITIES', `${path}[${index}].id`, 'must be a non-empty string'),
      );
      continue;
    }
    ids.push(item.id);
  }
  const dup = duplicates(ids);
  if (dup.length) {
    issues.push(issue('PLANNING-CAPABILITIES', path, `contains duplicate ids: ${dup.join(', ')}`));
  }
  return { issues, ids };
}

export function validateTaskPlanning(value: unknown): ContractIssue[] {
  if (!record(value)) return [issue('PLANNING-SHAPE', 'planning', 'must be an object')];
  const out: ContractIssue[] = [];
  if (value.schema !== TASK_PLANNING_CONTRACT) {
    out.push(issue('PLANNING-SCHEMA', 'planning.schema', `must equal ${TASK_PLANNING_CONTRACT}`));
  }
  if (!strictIso(value.assessed_at)) {
    out.push(issue('PLANNING-TIME', 'planning.assessed_at', 'must be strict ISO-8601 UTC'));
  }
  if (!nonEmpty(value.assessor)) {
    out.push(issue('PLANNING-ASSESSOR', 'planning.assessor', 'must be a non-empty string'));
  }

  if (!record(value.dimensions)) {
    out.push(issue('PLANNING-DIMENSIONS', 'planning.dimensions', 'must be an object'));
  } else {
    for (const [name, allowed] of Object.entries(PLANNING_DIMENSIONS)) {
      const actual = value.dimensions[name];
      if (!(allowed as readonly unknown[]).includes(actual)) {
        out.push(
          issue(
            'PLANNING-DIMENSIONS',
            `planning.dimensions.${name}`,
            `must be one of ${allowed.join(', ')}`,
          ),
        );
      }
    }
  }
  if (!['low', 'medium', 'high'].includes(value.estimate_confidence)) {
    out.push(
      issue(
        'PLANNING-ESTIMATE-CONFIDENCE',
        'planning.estimate_confidence',
        'must be low, medium, or high',
      ),
    );
  }
  if (!record(value.quality) || !nonEmpty(value.quality.effect_floor)) {
    out.push(
      issue(
        'PLANNING-QUALITY',
        'planning.quality.effect_floor',
        'must be an open, non-empty capability/effect floor id',
      ),
    );
  }
  if (!record(value.budget)) {
    out.push(issue('PLANNING-BUDGET', 'planning.budget', 'must be an object'));
  } else {
    if (!['ample', 'tight'].includes(value.budget.posture)) {
      out.push(issue('PLANNING-BUDGET', 'planning.budget.posture', 'must be ample or tight'));
    }
    if (!Number.isInteger(value.budget.max_attempts) || value.budget.max_attempts < 1) {
      out.push(
        issue('PLANNING-BUDGET', 'planning.budget.max_attempts', 'must be a positive integer'),
      );
    }
  }

  if (!record(value.capabilities)) {
    out.push(issue('PLANNING-CAPABILITIES', 'planning.capabilities', 'must be an object'));
  } else {
    const required = validateCapabilityList(
      value.capabilities.required,
      'planning.capabilities.required',
      true,
    );
    const preferred = validateCapabilityList(
      value.capabilities.preferred,
      'planning.capabilities.preferred',
      false,
    );
    const forbidden = validateCapabilityList(
      value.capabilities.forbidden,
      'planning.capabilities.forbidden',
      false,
    );
    out.push(...required.issues, ...preferred.issues, ...forbidden.issues);
    const membership = new Map<string, string>();
    for (const [kind, ids] of [
      ['required', required.ids],
      ['preferred', preferred.ids],
      ['forbidden', forbidden.ids],
    ] as const) {
      for (const id of ids) {
        const prior = membership.get(id);
        if (prior && prior !== kind) {
          out.push(
            issue(
              'PLANNING-CAPABILITIES',
              'planning.capabilities',
              `capability ${id} overlaps ${prior} and ${kind}`,
            ),
          );
        } else {
          membership.set(id, kind);
        }
      }
    }
  }
  return out;
}

export function createRoutingEnvelope(policy: unknown): RecordLike {
  return {
    schema: AGENT_ROUTING_CONTRACT,
    mode: 'cross-harness',
    policy: structuredClone(policy),
    selected: null,
    attempts: [],
  };
}

function validateCandidate(value: unknown, index: number): ContractIssue[] {
  const path = `routing.policy.candidates[${index}]`;
  if (!record(value)) return [issue('ROUTING-CANDIDATE', path, 'must be an object')];
  const out: ContractIssue[] = [];
  for (const field of ['id', 'adapter', 'harness', 'provider', 'model', 'effort']) {
    if (!nonEmpty(value[field])) {
      out.push(issue('ROUTING-CANDIDATE', `${path}.${field}`, 'must be a non-empty string'));
    }
  }
  if (!(ROUTE_SURFACES as readonly unknown[]).includes(value.surface)) {
    out.push(issue('ROUTING-CANDIDATE', `${path}.surface`, 'must be host-native or cli-headless'));
  }
  if (value.model === 'auto') {
    out.push(issue('ROUTING-CANDIDATE', `${path}.model`, 'model auto is forbidden'));
  }
  if (!stringArray(value.requires) || value.requires.length === 0) {
    out.push(issue('ROUTING-CANDIDATE', `${path}.requires`, 'must be a non-empty string array'));
  } else {
    const dup = duplicates(value.requires);
    if (dup.length) {
      out.push(
        issue('ROUTING-CANDIDATE', `${path}.requires`, `contains duplicates: ${dup.join(', ')}`),
      );
    }
    const mandatoryPredicates = [
      'capability-match',
      'effect-floor',
      'permission-compatible',
      'account-mutation-forbidden',
    ];
    const missing = mandatoryPredicates.filter((predicate) => !value.requires.includes(predicate));
    if (missing.length) {
      out.push(
        issue(
          'ROUTING-CANDIDATE',
          `${path}.requires`,
          `must include mechanical predicates: ${missing.join(', ')}`,
        ),
      );
    }
  }
  if (!stringArray(value.capabilities)) {
    out.push(issue('ROUTING-CANDIDATE', `${path}.capabilities`, 'must be a string array'));
  } else if (duplicates(value.capabilities).length) {
    out.push(issue('ROUTING-CANDIDATE', `${path}.capabilities`, 'must not contain duplicates'));
  }
  if (!stringArray(value.effect_floors_met) || value.effect_floors_met.length === 0) {
    out.push(
      issue('ROUTING-CANDIDATE', `${path}.effect_floors_met`, 'must be a non-empty string array'),
    );
  }
  if (
    !record(value.permission) ||
    !nonEmpty(value.permission.profile) ||
    !stringArray(value.permission.denies)
  ) {
    out.push(
      issue(
        'ROUTING-CANDIDATE',
        `${path}.permission`,
        'must contain non-empty profile and denies[]',
      ),
    );
  } else if (!value.permission.denies.includes('account-mutation')) {
    out.push(issue('ROUTING-CANDIDATE', `${path}.permission.denies`, 'must deny account-mutation'));
  }
  if (value.account_mutation !== 'forbidden') {
    out.push(issue('ROUTING-CANDIDATE', `${path}.account_mutation`, 'must equal forbidden'));
  }
  return out;
}

function capabilityIds(planning: RecordLike, kind: string): string[] {
  if (!record(planning.capabilities) || !Array.isArray(planning.capabilities[kind])) return [];
  return planning.capabilities[kind]
    .filter(record)
    .map((capability: RecordLike) => capability.id)
    .filter(nonEmpty);
}

function validatePlanningRoutingSets(planning: unknown, routing: unknown): ContractIssue[] {
  if (!record(planning) || !record(routing) || !record(routing.policy)) return [];
  const required = capabilityIds(planning, 'required');
  const forbidden = capabilityIds(planning, 'forbidden');
  const effectFloor = record(planning.quality) ? planning.quality.effect_floor : undefined;
  const candidates = Array.isArray(routing.policy.candidates) ? routing.policy.candidates : [];
  const out: ContractIssue[] = [];
  candidates.forEach((candidate: unknown, index: number) => {
    if (!record(candidate)) return;
    const path = `routing.policy.candidates[${index}]`;
    const capabilities = stringArray(candidate.capabilities) ? candidate.capabilities : [];
    const missingCapabilities = required.filter((id) => !capabilities.includes(id));
    if (missingCapabilities.length) {
      out.push(
        issue(
          'ROUTING-CAPABILITY-MATCH',
          `${path}.capabilities`,
          `missing planning.required: ${missingCapabilities.join(', ')}`,
        ),
      );
    }
    const floors = stringArray(candidate.effect_floors_met) ? candidate.effect_floors_met : [];
    if (nonEmpty(effectFloor) && !floors.includes(effectFloor)) {
      out.push(
        issue(
          'ROUTING-EFFECT-FLOOR',
          `${path}.effect_floors_met`,
          `does not meet planning effect floor: ${effectFloor}`,
        ),
      );
    }
    const denied =
      record(candidate.permission) && stringArray(candidate.permission.denies)
        ? candidate.permission.denies
        : [];
    const missingDenies = [...forbidden, 'account-mutation'].filter((id) => !denied.includes(id));
    if (missingDenies.length) {
      out.push(
        issue(
          'ROUTING-PERMISSION-MATCH',
          `${path}.permission.denies`,
          `must deny planning.forbidden/account mutation: ${missingDenies.join(', ')}`,
        ),
      );
    }
    if (candidate.account_mutation !== 'forbidden') {
      out.push(
        issue(
          'ROUTING-ACCOUNT-MUTATION',
          `${path}.account_mutation`,
          'account mutation is forbidden for routed workers',
        ),
      );
    }
  });
  return out;
}

export function validateTaskRoutePolicy(task: unknown): ContractIssue[] {
  if (!record(task)) return [issue('ROUTED-TASK', 'task', 'must be an object')];
  return [
    ...validateRoutingEnvelope(task.routing),
    ...validatePlanningRoutingSets(task.planning, task.routing),
  ];
}

function validatePolicy(value: unknown): ContractIssue[] {
  if (!record(value)) return [issue('ROUTING-POLICY', 'routing.policy', 'must be an object')];
  const out: ContractIssue[] = [];
  if (!(ROUTE_OBJECTIVES as readonly unknown[]).includes(value.objective)) {
    out.push(
      issue(
        'ROUTING-POLICY',
        'routing.policy.objective',
        'must be quality-first, balanced, or cost-first',
      ),
    );
  }
  if (!record(value.constraints)) {
    out.push(issue('ROUTING-CONSTRAINTS', 'routing.policy.constraints', 'must be an object'));
  } else {
    if (!nonEmpty(value.constraints.effect_floor)) {
      out.push(
        issue(
          'ROUTING-CONSTRAINTS',
          'routing.policy.constraints.effect_floor',
          'must be a non-empty string',
        ),
      );
    }
    if (value.constraints.quota_unknown !== 'ineligible') {
      out.push(
        issue(
          'ROUTING-CONSTRAINTS',
          'routing.policy.constraints.quota_unknown',
          'must be ineligible',
        ),
      );
    }
    if (value.constraints.cross_harness_quota_admission !== 'ample-only') {
      out.push(
        issue(
          'ROUTING-CONSTRAINTS',
          'routing.policy.constraints.cross_harness_quota_admission',
          'must be ample-only',
        ),
      );
    }
  }

  if (!Array.isArray(value.candidates)) {
    out.push(issue('ROUTING-CANDIDATES', 'routing.policy.candidates', 'must be an array'));
  } else {
    value.candidates.forEach((candidate: unknown, index: number) => {
      out.push(...validateCandidate(candidate, index));
    });
    const ids = value.candidates
      .filter(record)
      .map((candidate: RecordLike) => candidate.id)
      .filter(nonEmpty);
    const dup = duplicates(ids);
    if (dup.length) {
      out.push(
        issue(
          'ROUTING-CANDIDATES',
          'routing.policy.candidates',
          `duplicate ids: ${dup.join(', ')}`,
        ),
      );
    }
  }

  const candidateIds = new Set<string>(
    Array.isArray(value.candidates)
      ? value.candidates
          .filter(record)
          .map((candidate: RecordLike) => candidate.id)
          .filter(nonEmpty)
      : [],
  );
  if (!record(value.chains)) {
    out.push(issue('ROUTING-CHAINS', 'routing.policy.chains', 'must be an object'));
  } else {
    for (const chain of ROUTE_CHAINS) {
      const ids = value.chains[chain];
      if (!stringArray(ids)) {
        out.push(
          issue('ROUTING-CHAINS', `routing.policy.chains.${chain}`, 'must be a string array'),
        );
        continue;
      }
      const dup = duplicates(ids);
      if (dup.length) {
        out.push(
          issue(
            'ROUTING-CHAINS',
            `routing.policy.chains.${chain}`,
            `contains duplicates: ${dup.join(', ')}`,
          ),
        );
      }
      const missing = ids.filter((id) => !candidateIds.has(id));
      if (missing.length) {
        out.push(
          issue(
            'ROUTING-CHAINS',
            `routing.policy.chains.${chain}`,
            `references missing candidates: ${missing.join(', ')}`,
          ),
        );
      }
    }
  }

  if (!record(value.fallback)) {
    out.push(issue('ROUTING-FALLBACK', 'routing.policy.fallback', 'must be an object'));
  } else {
    const on = value.fallback.on;
    const neverOn = value.fallback.never_on;
    if (!stringArray(on)) {
      out.push(issue('ROUTING-FALLBACK', 'routing.policy.fallback.on', 'must be a string array'));
    } else {
      const illegal = on.filter(
        (failure) => !(AUTOMATIC_FALLBACK_FAILURES as readonly string[]).includes(failure),
      );
      if (illegal.length) {
        out.push(
          issue(
            'ROUTING-FALLBACK',
            'routing.policy.fallback.on',
            `automatic fallback is limited to mechanical failures; illegal: ${illegal.join(', ')}`,
          ),
        );
      }
    }
    if (!stringArray(neverOn)) {
      out.push(
        issue('ROUTING-FALLBACK', 'routing.policy.fallback.never_on', 'must be a string array'),
      );
    } else {
      const missing = NEVER_FALLBACK_FAILURES.filter((failure) => !neverOn.includes(failure));
      if (missing.length) {
        out.push(
          issue(
            'ROUTING-FALLBACK',
            'routing.policy.fallback.never_on',
            `must contain authority/business failures: ${missing.join(', ')}`,
          ),
        );
      }
      if (stringArray(on)) {
        const overlap = on.filter((failure) => neverOn.includes(failure));
        if (overlap.length) {
          out.push(
            issue(
              'ROUTING-FALLBACK',
              'routing.policy.fallback',
              `on and never_on overlap: ${overlap.join(', ')}`,
            ),
          );
        }
      }
    }
    if (value.fallback.exhaustion !== 'fail-closed') {
      out.push(
        issue('ROUTING-FALLBACK', 'routing.policy.fallback.exhaustion', 'must be fail-closed'),
      );
    }
    if (value.fallback.same_harness !== 'explicit-candidate-only') {
      out.push(
        issue(
          'ROUTING-FALLBACK',
          'routing.policy.fallback.same_harness',
          'must be explicit-candidate-only',
        ),
      );
    }
  }
  return out;
}

function selectedCandidate(routing: RecordLike): RecordLike | undefined {
  if (
    !record(routing.selected) ||
    !record(routing.policy) ||
    !Array.isArray(routing.policy.candidates)
  ) {
    return undefined;
  }
  return routing.policy.candidates.find(
    (candidate: unknown) => record(candidate) && candidate.id === routing.selected.candidate_id,
  );
}

function validateSelection(routing: RecordLike): ContractIssue[] {
  if (routing.selected === null || routing.selected === undefined) return [];
  if (!record(routing.selected)) {
    return [issue('ROUTING-SELECTION', 'routing.selected', 'must be null or an object')];
  }
  const out: ContractIssue[] = [];
  const selection = routing.selected;
  const candidate = selectedCandidate(routing);
  if (!candidate) {
    out.push(
      issue(
        'ROUTING-SELECTION',
        'routing.selected.candidate_id',
        'must reference an existing candidate',
      ),
    );
  }
  if (!(ROUTE_CHAINS as readonly unknown[]).includes(selection.chain)) {
    out.push(issue('ROUTING-SELECTION', 'routing.selected.chain', 'must be ample or tight'));
  } else if (
    !record(routing.policy) ||
    !record(routing.policy.chains) ||
    !Array.isArray(routing.policy.chains[selection.chain]) ||
    !routing.policy.chains[selection.chain].includes(selection.candidate_id)
  ) {
    out.push(
      issue(
        'ROUTING-SELECTION',
        'routing.selected.candidate_id',
        'must be present in the selected chain',
      ),
    );
  }
  if (!strictIso(selection.selected_at)) {
    out.push(
      issue('ROUTING-SELECTION', 'routing.selected.selected_at', 'must be strict ISO-8601 UTC'),
    );
  }
  if (!record(selection.evidence)) {
    out.push(issue('ROUTING-EVIDENCE', 'routing.selected.evidence', 'must be an object'));
  } else {
    const evidence = selection.evidence;
    if (!strictIso(evidence.observed_at)) {
      out.push(
        issue(
          'ROUTING-EVIDENCE',
          'routing.selected.evidence.observed_at',
          'must be strict ISO-8601 UTC',
        ),
      );
    }
    if (!strictIso(evidence.valid_until)) {
      out.push(
        issue(
          'ROUTING-EVIDENCE',
          'routing.selected.evidence.valid_until',
          'must be strict ISO-8601 UTC',
        ),
      );
    }
    if (
      strictIso(evidence.observed_at) &&
      strictIso(selection.selected_at) &&
      strictIso(evidence.valid_until) &&
      !(
        Date.parse(evidence.observed_at) <= Date.parse(selection.selected_at) &&
        Date.parse(selection.selected_at) <= Date.parse(evidence.valid_until)
      )
    ) {
      out.push(
        issue(
          'ROUTING-EVIDENCE',
          'routing.selected.evidence',
          'must satisfy observed_at <= selected_at <= valid_until',
        ),
      );
    }
    if (!Array.isArray(evidence.qualification_results)) {
      out.push(
        issue(
          'ROUTING-EVIDENCE',
          'routing.selected.evidence.qualification_results',
          'must be an array',
        ),
      );
    } else if (candidate && stringArray(candidate.requires)) {
      const required = candidate.requires;
      const counts = new Map<string, number>();
      evidence.qualification_results.forEach((entry: unknown, index: number) => {
        const path = `routing.selected.evidence.qualification_results[${index}]`;
        if (!record(entry) || !nonEmpty(entry.predicate)) {
          out.push(issue('ROUTING-EVIDENCE', path, 'must name a non-empty predicate'));
          return;
        }
        counts.set(entry.predicate, (counts.get(entry.predicate) ?? 0) + 1);
        if (!required.includes(entry.predicate)) {
          out.push(
            issue(
              'ROUTING-EVIDENCE',
              'routing.selected.evidence.qualification_results',
              `predicate ${entry.predicate} is not declared by the selected candidate`,
            ),
          );
        }
        if (entry.status !== 'pass') {
          out.push(
            issue(
              'ROUTING-EVIDENCE',
              'routing.selected.evidence.qualification_results',
              `predicate ${entry.predicate} must have status pass`,
            ),
          );
        }
      });
      for (const predicate of required) {
        const count = counts.get(predicate) ?? 0;
        if (count !== 1) {
          out.push(
            issue(
              'ROUTING-EVIDENCE',
              'routing.selected.evidence.qualification_results',
              `predicate ${predicate} must occur exactly once with status pass; found ${count}`,
            ),
          );
        }
      }
    }
  }
  if (!stringArray(selection.reason_codes) || selection.reason_codes.length === 0) {
    out.push(
      issue(
        'ROUTING-SELECTION',
        'routing.selected.reason_codes',
        'must be a non-empty string array',
      ),
    );
  }
  return out;
}

function validateAttempt(attempt: unknown, index: number, routing: RecordLike): ContractIssue[] {
  const path = `routing.attempts[${index}]`;
  if (!record(attempt)) return [issue('ROUTING-ATTEMPT', path, 'must be an object')];
  const out: ContractIssue[] = [];
  for (const field of ['id', 'candidate_id', 'state']) {
    if (!nonEmpty(attempt[field])) {
      out.push(issue('ROUTING-ATTEMPT', `${path}.${field}`, 'must be a non-empty string'));
    }
  }
  const candidate =
    record(routing.policy) && Array.isArray(routing.policy.candidates)
      ? routing.policy.candidates.find(
          (value: unknown) => record(value) && value.id === attempt.candidate_id,
        )
      : undefined;
  if (!candidate) {
    out.push(
      issue('ROUTING-ATTEMPT', `${path}.candidate_id`, 'must reference an existing candidate'),
    );
  }
  if (attempt.state === 'running') {
    if (!strictIso(attempt.started_at)) {
      out.push(issue('ROUTING-ATTEMPT', `${path}.started_at`, 'must be strict ISO-8601 UTC'));
    }
    if (!nonEmpty(attempt.handle)) {
      out.push(issue('ROUTING-ATTEMPT', `${path}.handle`, 'running attempt requires a handle'));
    }
  }
  if (record(attempt.requested) && candidate) {
    if (attempt.requested.model !== undefined && attempt.requested.model !== candidate.model) {
      out.push(issue('ROUTING-ATTEMPT', `${path}.requested.model`, 'must match candidate model'));
    }
    if (attempt.requested.effort !== undefined && attempt.requested.effort !== candidate.effort) {
      out.push(issue('ROUTING-ATTEMPT', `${path}.requested.effort`, 'must match candidate effort'));
    }
  }
  if (!record(attempt.selection_snapshot)) {
    out.push(
      issue(
        'ROUTING-ATTEMPT',
        `${path}.selection_snapshot`,
        'must freeze the complete selection evidence/rationale',
      ),
    );
  }
  return out;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (record(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function validateRoutingEnvelope(value: unknown): ContractIssue[] {
  if (!record(value)) return [issue('ROUTING-SHAPE', 'routing', 'must be an object')];
  const out: ContractIssue[] = [];
  if (value.schema !== AGENT_ROUTING_CONTRACT) {
    out.push(issue('ROUTING-SCHEMA', 'routing.schema', `must equal ${AGENT_ROUTING_CONTRACT}`));
  }
  if (value.mode !== 'cross-harness') {
    out.push(issue('ROUTING-MODE', 'routing.mode', 'must equal cross-harness'));
  }
  out.push(...validatePolicy(value.policy));
  out.push(...validateSelection(value));
  if (!Array.isArray(value.attempts)) {
    out.push(issue('ROUTING-ATTEMPTS', 'routing.attempts', 'must be an array'));
  } else {
    value.attempts.forEach((attempt: unknown, index: number) => {
      out.push(...validateAttempt(attempt, index, value));
    });
    const ids = value.attempts
      .filter(record)
      .map((attempt: RecordLike) => attempt.id)
      .filter(nonEmpty);
    const dup = duplicates(ids);
    if (dup.length) {
      out.push(
        issue('ROUTING-ATTEMPTS', 'routing.attempts', `duplicate attempt ids: ${dup.join(', ')}`),
      );
    }
  }
  return out;
}

export function validateRoutedTaskForInFlight(task: unknown): ContractIssue[] {
  if (!record(task)) return [issue('ROUTED-TASK', 'task', 'must be an object')];
  const out = [...validateTaskPlanning(task.planning), ...validateTaskRoutePolicy(task)];
  if (
    !record(task.estimate) ||
    typeof task.estimate.value !== 'number' ||
    task.estimate.value <= 0 ||
    !nonEmpty(task.estimate.unit)
  ) {
    out.push(
      issue('ROUTED-TASK-ESTIMATE', 'estimate', 'must be a positive {value:number,unit:string}'),
    );
  }
  if (!record(task.routing)) return out;
  if (!record(task.routing.selected)) {
    out.push(
      issue('ROUTED-TASK-SELECTION', 'routing.selected', 'in-flight task requires selection'),
    );
  }
  if (!Array.isArray(task.routing.attempts)) return out;
  const running = task.routing.attempts.filter(
    (attempt: unknown) => record(attempt) && attempt.state === 'running',
  );
  if (running.length !== 1) {
    out.push(
      issue(
        'ROUTED-TASK-ATTEMPT',
        'routing.attempts',
        `in-flight task requires exactly one running attempt; found ${running.length}`,
      ),
    );
  }
  const active = running[0];
  if (!nonEmpty(task.handle)) {
    out.push(issue('ROUTED-TASK-HANDLE', 'handle', 'in-flight task requires a non-empty handle'));
  }
  if (active) {
    if (task.handle !== active.handle) {
      out.push(issue('ROUTED-TASK-HANDLE', 'handle', 'must equal the running attempt handle'));
    }
    if (
      record(task.routing.selected) &&
      active.candidate_id !== task.routing.selected.candidate_id
    ) {
      out.push(
        issue(
          'ROUTED-TASK-ATTEMPT',
          'routing.attempts',
          'running attempt candidate must equal selected candidate',
        ),
      );
    }
    if (
      record(task.routing.selected) &&
      canonicalJson(active.selection_snapshot) !== canonicalJson(task.routing.selected)
    ) {
      out.push(
        issue(
          'ROUTED-TASK-ATTEMPT',
          'routing.attempts[0].selection_snapshot',
          'running attempt must freeze the current selected projection exactly',
        ),
      );
    }
  }
  return out;
}

export interface ContractPreflightTask {
  task_id: string;
  issues: ContractIssue[];
}

export interface ContractPreflightReport {
  schema: 'ccm/routing-contract-preflight/v1';
  activation: ContractActivation;
  ready: boolean;
  tasks: ContractPreflightTask[];
  grandfathered_terminal_task_ids: string[];
}

export function routingContractPreflight(board: unknown): ContractPreflightReport {
  const tasks: ContractPreflightTask[] = [];
  const grandfatheredTerminalTaskIds: string[] = [];
  if (record(board) && Array.isArray(board.tasks)) {
    for (const task of board.tasks) {
      if (!record(task) || task.executor !== 'subagent') continue;
      if (
        contractActivation(board) !== 'enabled' &&
        TERMINAL_GRANDFATHER_STATUSES.has(task.status)
      ) {
        grandfatheredTerminalTaskIds.push(nonEmpty(task.id) ? task.id : '<unknown>');
        continue;
      }
      if (contractActivation(board) === 'enabled' && !routingContractAppliesToTask(board, task)) {
        grandfatheredTerminalTaskIds.push(nonEmpty(task.id) ? task.id : '<unknown>');
        continue;
      }
      const issues = [...validateTaskPlanning(task.planning), ...validateTaskRoutePolicy(task)];
      if (
        !record(task.estimate) ||
        typeof task.estimate.value !== 'number' ||
        task.estimate.value <= 0 ||
        !nonEmpty(task.estimate.unit)
      ) {
        issues.push(
          issue(
            'ROUTED-TASK-ESTIMATE',
            'estimate',
            'must be a positive {value:number,unit:string}',
          ),
        );
      }
      if (task.status === 'in_flight') issues.push(...validateRoutedTaskForInFlight(task));
      const unique = new Map(
        issues.map((entry) => [`${entry.code}:${entry.path}:${entry.message}`, entry]),
      );
      if (unique.size) {
        tasks.push({
          task_id: nonEmpty(task.id) ? task.id : '<unknown>',
          issues: [...unique.values()],
        });
      }
    }
  }
  const activation = contractActivation(board);
  return {
    schema: 'ccm/routing-contract-preflight/v1',
    activation,
    ready: activation !== 'invalid' && tasks.length === 0,
    tasks,
    grandfathered_terminal_task_ids: grandfatheredTerminalTaskIds,
  };
}

export function routeOutcomeClass(originHarness: string, routing: unknown): RouteOutcomeClass {
  if (!record(routing) || !record(routing.policy)) return 'invalid';
  if (routing.selected === null || routing.selected === undefined) return 'no-route';
  if (!record(routing.selected)) return 'invalid';
  const candidate = selectedCandidate(routing);
  if (!candidate) return 'invalid';
  const reasonCodes = stringArray(routing.selected.reason_codes)
    ? routing.selected.reason_codes
    : [];
  if (candidate.surface === 'host-native') {
    if (candidate.harness !== originHarness) return 'invalid';
    return reasonCodes.some((code) => code.startsWith('origin-stay'))
      ? 'origin-stay'
      : 'same-native';
  }
  if (candidate.surface === 'cli-headless') {
    return candidate.harness === originHarness ? 'same-harness-cli' : 'other-harness-cli';
  }
  return 'invalid';
}
