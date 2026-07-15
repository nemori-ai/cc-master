import { dependencySatisfied, isISOUTC, type TaskLike, taskTrulyDone } from './board-model.js';
import { canonicalJson } from './canonical-json.js';
import { sha256Hex } from './sha256.js';

export const DELIVERY_CONTRACT_SCHEMA = 'ccm/delivery-contract/v1';
export const TASK_DELIVERY_SCHEMA = 'ccm/task-delivery/v1';
export const DELIVERY_TARGET_LIMIT = 64;
export const DELIVERY_OBSERVATION_LIMIT = 128;
export const DEPENDENCY_REQUIREMENT_LIMIT = 256;

const TARGET_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256_RE = /^sha256:[a-f0-9]{64}$/;
const OID_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

type UnknownRecord = Record<string, unknown>;

export interface DeliveryDiagnostic {
  code: string;
  message: string;
  path?: string;
  severity?: 'hard' | 'warn';
}

export interface Qualification {
  state: 'qualified' | 'unqualified' | 'unknown';
  basis: 'legacy' | 'candidate' | 'delivery' | 'waiver';
  reasons: DeliveryDiagnostic[];
  candidate_complete: boolean;
  target_delivered?: boolean;
  target_id?: string;
  observation_id?: string;
  qualified_by?: 'legacy' | 'candidate' | 'delivery' | 'waiver';
}

export interface DeliveryTargetFact {
  state: 'current' | 'drift' | 'unknown';
  resolved_snapshot?: UnknownRecord;
  reason?: string;
}

export interface DeliveryObservationFact {
  state: 'delivered' | 'not-delivered' | 'unknown';
  observation_id?: string;
  reason?: string;
}

export interface DeliveryFacts {
  targets?: Record<string, DeliveryTargetFact>;
  observations?: Record<string, Record<string, DeliveryObservationFact>>;
  now?: string;
  strict_preview?: boolean;
}

export interface DeliveryBoardLike {
  delivery_contract?: unknown;
  tasks?: unknown;
  [key: string]: unknown;
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function nonEmptyString(value: unknown, maxBytes = 4096): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= maxBytes
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function reason(
  code: string,
  message: string,
  path?: string,
  severity?: 'hard' | 'warn',
): DeliveryDiagnostic {
  return { code, message, ...(path ? { path } : {}), ...(severity ? { severity } : {}) };
}

function result(
  state: Qualification['state'],
  basis: Qualification['basis'],
  candidateComplete: boolean,
  reasons: DeliveryDiagnostic[] = [],
  extra: Partial<Qualification> = {},
): Qualification {
  return {
    state,
    basis,
    candidate_complete: candidateComplete,
    reasons,
    ...(state === 'qualified' ? { qualified_by: basis } : {}),
    ...extra,
  };
}

function tasksOf(board: DeliveryBoardLike): TaskLike[] {
  return Array.isArray(board.tasks) ? (board.tasks as TaskLike[]) : [];
}

function taskById(board: DeliveryBoardLike, id: string): TaskLike | undefined {
  return tasksOf(board).find((task) => task && task.id === id);
}

function contractOf(board: DeliveryBoardLike): UnknownRecord | null {
  return record(board.delivery_contract);
}

function targetsOf(board: DeliveryBoardLike): UnknownRecord | null {
  return record(contractOf(board)?.targets);
}

function requirementsOf(task: TaskLike): UnknownRecord | null {
  return record(task.dependency_requirements);
}

function requirementFor(task: TaskLike, upstreamId: string): UnknownRecord | null {
  const requirements = requirementsOf(task);
  if (!requirements) return null;
  return record(requirements[upstreamId]) ?? record(requirements['*']);
}

function candidateOf(task: TaskLike): UnknownRecord | null {
  return record(record(task.delivery)?.candidate);
}

function candidateBindingMatches(task: TaskLike): boolean {
  const candidate = candidateOf(task);
  if (!candidate) return false;
  const subject = record(candidate.subject);
  if (!subject) return false;
  const subjectValid =
    (subject.kind === 'git-commit' && OID_RE.test(String(subject.commit_oid ?? ''))) ||
    (subject.kind === 'artifact' &&
      nonEmptyString(subject.logical_name) &&
      nonEmptyString(subject.version) &&
      nonEmptyString(subject.ref) &&
      SHA256_RE.test(String(subject.digest ?? '')));
  if (!subjectValid) return false;
  const expectedFingerprint = `sha256:${sha256Hex(
    canonicalJson({
      task_id: task.id,
      bound_finished_at: task.finished_at,
      bound_artifact: task.artifact,
      subject,
    }),
  )}`;
  return (
    SHA256_RE.test(String(candidate.fingerprint ?? '')) &&
    candidate.fingerprint === expectedFingerprint &&
    candidate.bound_finished_at === task.finished_at &&
    sameValue(candidate.bound_artifact, task.artifact)
  );
}

function targetSnapshot(target: UnknownRecord): UnknownRecord | null {
  return record(target.snapshot);
}

function observationSnapshotMatches(observation: UnknownRecord, target: UnknownRecord): boolean {
  const observed = record(observation.target_snapshot);
  const declared = targetSnapshot(target);
  if (!observed || !declared) return false;
  if (target.kind === 'git-ref') return observed.oid === declared.oid;
  if (target.kind === 'artifact-set') return observed.digest === declared.digest;
  return false;
}

function negativeObservationReason(observation: UnknownRecord): DeliveryDiagnostic {
  const diagnostic = nonEmptyString(observation.diagnostic) ? observation.diagnostic : undefined;
  if (diagnostic)
    return reason(diagnostic, 'delivery observation recorded a verified negative result');
  const method = record(observation.proof)?.method;
  if (method === 'artifact-digest-contained') {
    return reason(
      'DELIVERY_ARTIFACT_DIGEST_MISMATCH',
      'artifact digest is not contained in the target snapshot',
    );
  }
  return reason(
    'DELIVERY_COMMIT_NOT_CONTAINED',
    'candidate or integration commit is not contained in the target snapshot',
  );
}

function unknownObservationReason(observation: UnknownRecord): DeliveryDiagnostic {
  const diagnostic = nonEmptyString(observation.diagnostic) ? observation.diagnostic : undefined;
  return reason(
    diagnostic ?? 'DELIVERY_EQUIVALENCE_UNPROVEN',
    'delivery evidence cannot be re-verified for the current candidate and target snapshot',
  );
}

function liveWaiver(
  requirement: UnknownRecord,
  downstreamId: string,
  upstreamId: string,
  targetId: string,
  now: string | undefined,
): Qualification | null {
  const waiver = record(requirement.waiver_record);
  if (!waiver) return null;
  if (waiver.authorized_by !== 'user') {
    return result(
      'unqualified',
      'waiver',
      true,
      [reason('DELIVERY_WAIVER_AUTHORITY', 'waiver is not user-authorized')],
      { target_id: targetId, target_delivered: false },
    );
  }
  if (
    waiver.downstream !== downstreamId ||
    waiver.dependency !== upstreamId ||
    waiver.target !== targetId
  ) {
    return result(
      'unqualified',
      'waiver',
      true,
      [
        reason(
          'DELIVERY_WAIVER_SCOPE',
          'waiver does not match the exact downstream/dependency/target edge',
        ),
      ],
      { target_id: targetId, target_delivered: false },
    );
  }
  if (
    !nonEmptyString(waiver.reason) ||
    !isISOUTC(waiver.authorized_at) ||
    !isISOUTC(waiver.expires_at)
  ) {
    return result(
      'unqualified',
      'waiver',
      true,
      [
        reason(
          'DELIVERY_WAIVER_MALFORMED',
          'waiver requires reason and ISO authorization/expiry times',
        ),
      ],
      { target_id: targetId, target_delivered: false },
    );
  }
  if (!now || !isISOUTC(now)) {
    return result(
      'unknown',
      'waiver',
      true,
      [
        reason(
          'DELIVERY_WAIVER_TIME_UNKNOWN',
          'current time fact is required to evaluate waiver expiry',
        ),
      ],
      { target_id: targetId, target_delivered: false },
    );
  }
  const authorizedAt = Date.parse(waiver.authorized_at as string);
  const expiresAt = Date.parse(waiver.expires_at as string);
  const nowMs = Date.parse(now);
  if (!(expiresAt > authorizedAt) || nowMs >= expiresAt) {
    return result(
      'unqualified',
      'waiver',
      true,
      [reason('DELIVERY_WAIVER_EXPIRED', 'waiver has expired or has a non-forward expiry')],
      { target_id: targetId, target_delivered: false },
    );
  }
  return result('qualified', 'waiver', true, [], {
    target_id: targetId,
    target_delivered: false,
  });
}

export function targetDelivered(
  board: DeliveryBoardLike,
  task: TaskLike,
  targetId: string,
  facts: DeliveryFacts = {},
): Qualification {
  const complete = taskTrulyDone(task);
  if (!complete) {
    return result(
      'unqualified',
      'delivery',
      false,
      [reason('DELIVERY_CANDIDATE_INCOMPLETE', 'task is not candidate-complete')],
      { target_id: targetId, target_delivered: false },
    );
  }
  if (!candidateBindingMatches(task)) {
    return result(
      'unknown',
      'delivery',
      true,
      [
        reason(
          'DELIVERY_CANDIDATE_BINDING_STALE',
          'delivery candidate does not bind current finished_at/artifact',
        ),
      ],
      { target_id: targetId, target_delivered: false },
    );
  }
  const target = record(targetsOf(board)?.[targetId]);
  if (!target) {
    return result(
      'unknown',
      'delivery',
      true,
      [reason('DELIVERY_TARGET_NOT_FOUND', `delivery target ${targetId} is not declared`)],
      { target_id: targetId, target_delivered: false },
    );
  }

  const fact = facts.targets?.[targetId];
  if (fact?.state === 'drift') {
    return result(
      'unknown',
      'delivery',
      true,
      [
        reason(
          'DELIVERY_TARGET_REF_DRIFT',
          `delivery target ${targetId} resolved snapshot has drifted`,
        ),
      ],
      { target_id: targetId, target_delivered: false },
    );
  }
  if (fact?.state === 'unknown') {
    const code = nonEmptyString(fact.reason) ? fact.reason : 'DELIVERY_TARGET_UNAVAILABLE';
    return result(
      'unknown',
      'delivery',
      true,
      [reason(code, `delivery target ${targetId} cannot be resolved locally`)],
      {
        target_id: targetId,
        target_delivered: false,
      },
    );
  }
  if (
    fact?.state === 'current' &&
    fact.resolved_snapshot &&
    !sameValue(fact.resolved_snapshot, targetSnapshot(target))
  ) {
    return result(
      'unknown',
      'delivery',
      true,
      [
        reason(
          'DELIVERY_TARGET_REF_DRIFT',
          `delivery target ${targetId} resolved snapshot differs from the declared snapshot`,
        ),
      ],
      { target_id: targetId, target_delivered: false },
    );
  }

  const delivery = record(task.delivery);
  const observations = Array.isArray(delivery?.observations)
    ? (delivery.observations as unknown[])
    : [];
  const fingerprint = candidateOf(task)?.fingerprint;
  const matching = observations
    .map(record)
    .filter(
      (observation): observation is UnknownRecord =>
        observation !== null &&
        observation.target === targetId &&
        observation.candidate_fingerprint === fingerprint &&
        observationSnapshotMatches(observation, target),
    );
  const observation = matching.at(-1);
  if (!observation) {
    return result(
      'unknown',
      'delivery',
      true,
      [
        reason(
          'DELIVERY_OBSERVATION_MISSING',
          'no observation binds the current candidate and target snapshot',
        ),
      ],
      { target_id: targetId, target_delivered: false },
    );
  }
  const observationFact = facts.observations?.[String(task.id)]?.[targetId];
  if (
    observationFact &&
    (!observationFact.observation_id || observationFact.observation_id === observation.id)
  ) {
    if (observationFact.state === 'unknown') {
      return result(
        'unknown',
        'delivery',
        true,
        [
          reason(
            observationFact.reason ?? 'DELIVERY_EQUIVALENCE_UNPROVEN',
            'stored delivery observation cannot be re-verified from current local facts',
          ),
        ],
        { target_id: targetId, target_delivered: false, observation_id: String(observation.id) },
      );
    }
    if (observationFact.state === 'not-delivered') {
      return result(
        'unqualified',
        'delivery',
        true,
        [
          reason(
            observationFact.reason ?? 'DELIVERY_COMMIT_NOT_CONTAINED',
            'current local proof contradicts the stored delivered observation',
          ),
        ],
        { target_id: targetId, target_delivered: false, observation_id: String(observation.id) },
      );
    }
  }
  if (observation.outcome === 'delivered') {
    return result('qualified', 'delivery', true, [], {
      target_id: targetId,
      target_delivered: true,
      observation_id: String(observation.id),
    });
  }
  if (observation.outcome === 'not-delivered') {
    return result('unqualified', 'delivery', true, [negativeObservationReason(observation)], {
      target_id: targetId,
      target_delivered: false,
      observation_id: String(observation.id),
    });
  }
  return result('unknown', 'delivery', true, [unknownObservationReason(observation)], {
    target_id: targetId,
    target_delivered: false,
    observation_id: String(observation.id),
  });
}

export function dependencyQualified(
  board: DeliveryBoardLike,
  downstreamId: string,
  upstreamId: string,
  facts: DeliveryFacts = {},
): Qualification {
  const downstream = taskById(board, downstreamId);
  const upstream = taskById(board, upstreamId);
  const complete = taskTrulyDone(upstream);
  if (!downstream || !upstream) {
    return result('unknown', 'legacy', complete, [
      reason('DEPENDENCY_TASK_NOT_FOUND', 'downstream or upstream task is not present'),
    ]);
  }

  const contract = contractOf(board);
  const legacy = (): Qualification =>
    dependencySatisfied(upstream)
      ? result('qualified', 'legacy', complete)
      : result('unqualified', 'legacy', complete, [
          reason('DEPENDENCY_UNQUALIFIED', 'legacy dependency predicate is not satisfied'),
        ]);
  if (!contract) return legacy();
  if (contract.schema !== DELIVERY_CONTRACT_SCHEMA || contract.mode !== 'declared') {
    return result('unknown', 'candidate', complete, [
      reason(
        'FMT-DELIVERY-CONTRACT',
        'delivery contract is malformed or attempts to persist unsupported strict mode',
      ),
    ]);
  }

  const requirement = requirementFor(downstream, upstreamId);
  if (!requirement) {
    if (facts.strict_preview) {
      return result('unknown', 'candidate', complete, [
        reason(
          'DEPENDENCY_REQUIREMENT_MISSING',
          'strict preview requires an explicit exact or * requirement',
        ),
      ]);
    }
    return legacy();
  }
  if (!complete) {
    return result('unqualified', 'candidate', false, [
      reason(
        'DELIVERY_CANDIDATE_INCOMPLETE',
        'explicit dependency requirement requires taskTrulyDone',
      ),
    ]);
  }
  if (!dependencySatisfied(upstream)) {
    return result('unqualified', 'candidate', true, [
      reason('DELIVERY_REVIEW_REJECTED', 'review-gated dependency is missing exact APPROVE'),
    ]);
  }
  if (requirement.level === 'candidate') return result('qualified', 'candidate', true);
  if (requirement.level !== 'delivered' || !nonEmptyString(requirement.target, 64)) {
    return result('unknown', 'candidate', true, [
      reason(
        'FMT-DEPENDENCY-REQUIREMENTS',
        'requirement must be candidate or delivered with a target',
      ),
    ]);
  }

  const targetId = requirement.target;
  const waiver = liveWaiver(requirement, downstreamId, upstreamId, targetId, facts.now);
  if (waiver) return waiver;
  return targetDelivered(board, upstream, targetId, facts);
}

function validateTarget(targetId: string, value: unknown, out: DeliveryDiagnostic[]): void {
  const path = `delivery_contract.targets.${targetId}`;
  const target = record(value);
  if (!TARGET_ID_RE.test(targetId) || !target) {
    out.push(
      reason('FMT-DELIVERY-CONTRACT', 'target id or target object is malformed', path, 'hard'),
    );
    return;
  }
  const snapshot = targetSnapshot(target);
  if (!snapshot || !isISOUTC(snapshot.observed_at)) {
    out.push(
      reason(
        'FMT-DELIVERY-CONTRACT',
        'target snapshot requires observed_at',
        `${path}.snapshot`,
        'hard',
      ),
    );
  }
  if (target.kind === 'git-ref') {
    const repository = record(target.repository);
    const repoShape =
      repository?.source === 'board.git.worktree' || nonEmptyString(repository?.worktree);
    if (!repoShape || !nonEmptyString(target.ref) || !OID_RE.test(String(snapshot?.oid ?? ''))) {
      out.push(
        reason(
          'FMT-DELIVERY-CONTRACT',
          'git-ref target requires repository, ref, and immutable oid',
          path,
          'hard',
        ),
      );
    }
    return;
  }
  if (target.kind === 'artifact-set') {
    if (!nonEmptyString(target.namespace) || !SHA256_RE.test(String(snapshot?.digest ?? ''))) {
      out.push(
        reason(
          'FMT-DELIVERY-CONTRACT',
          'artifact-set target requires namespace and sha256 snapshot digest',
          path,
          'hard',
        ),
      );
    }
    return;
  }
  out.push(
    reason('FMT-DELIVERY-CONTRACT', 'target kind must be git-ref or artifact-set', path, 'hard'),
  );
}

function validateObservation(
  taskId: string,
  candidate: UnknownRecord,
  value: unknown,
  index: number,
  targets: UnknownRecord | null,
  out: DeliveryDiagnostic[],
): void {
  const path = `tasks.${taskId}.delivery.observations.${index}`;
  const observation = record(value);
  const targetId = observation?.target;
  const target = typeof targetId === 'string' ? record(targets?.[targetId]) : null;
  const proof = record(observation?.proof);
  if (
    !observation ||
    !nonEmptyString(observation.id, 128) ||
    !nonEmptyString(targetId, 64) ||
    !target ||
    observation.candidate_fingerprint !== candidate.fingerprint ||
    !['delivered', 'not-delivered', 'unknown'].includes(String(observation.outcome)) ||
    !isISOUTC(observation.checked_at) ||
    !proof ||
    Object.hasOwn(observation, 'qualified')
  ) {
    out.push(
      reason(
        'FMT-TASK-DELIVERY',
        'delivery observation binding/outcome/proof shape is malformed',
        path,
        'hard',
      ),
    );
    return;
  }
  const snapshot = record(observation.target_snapshot);
  if (
    !snapshot ||
    (target.kind === 'git-ref' && !OID_RE.test(String(snapshot.oid ?? ''))) ||
    (target.kind === 'artifact-set' && !SHA256_RE.test(String(snapshot.digest ?? '')))
  ) {
    out.push(
      reason(
        'FMT-TASK-DELIVERY',
        'delivery observation target snapshot is malformed',
        `${path}.target_snapshot`,
        'hard',
      ),
    );
  }
  if (observation.outcome !== 'delivered') return;
  if (proof.method === 'git-commit-contained') {
    if (
      target.kind !== 'git-ref' ||
      !OID_RE.test(String(proof.candidate_commit ?? '')) ||
      proof.candidate_commit !== record(candidate.subject)?.commit_oid ||
      proof.target_oid !== snapshot?.oid
    ) {
      out.push(
        reason(
          'FMT-TASK-DELIVERY',
          'exact git containment proof does not bind candidate/target OIDs',
          `${path}.proof`,
          'hard',
        ),
      );
    }
    return;
  }
  if (proof.method === 'reviewed-reconciliation-contained') {
    if (
      target.kind !== 'git-ref' ||
      !OID_RE.test(String(proof.integration_commit ?? '')) ||
      !OID_RE.test(String(proof.reviewed_base_oid ?? '')) ||
      !SHA256_RE.test(String(proof.attestation_digest ?? '')) ||
      !nonEmptyString(proof.attestation_ref) ||
      !String(proof.attestation_ref).startsWith('/') ||
      proof.target_oid !== snapshot?.oid
    ) {
      out.push(
        reason(
          'FMT-TASK-DELIVERY',
          'reviewed reconciliation proof binding is malformed',
          `${path}.proof`,
          'hard',
        ),
      );
    }
    return;
  }
  if (proof.method === 'artifact-digest-contained') {
    if (
      target.kind !== 'artifact-set' ||
      proof.manifest_digest !== snapshot?.digest ||
      !record(proof.artifact)
    ) {
      out.push(
        reason(
          'FMT-TASK-DELIVERY',
          'artifact containment proof binding is malformed',
          `${path}.proof`,
          'hard',
        ),
      );
    }
    return;
  }
  out.push(
    reason(
      'FMT-TASK-DELIVERY',
      'delivered observation uses an unsupported proof method',
      `${path}.proof`,
      'hard',
    ),
  );
}

export function validateDeliveryContracts(board: DeliveryBoardLike): DeliveryDiagnostic[] {
  const out: DeliveryDiagnostic[] = [];
  const contract = contractOf(board);
  const targets = targetsOf(board);
  if (board.delivery_contract !== undefined) {
    if (
      !contract ||
      contract.schema !== DELIVERY_CONTRACT_SCHEMA ||
      contract.mode !== 'declared' ||
      !targets
    ) {
      out.push(
        reason(
          'FMT-DELIVERY-CONTRACT',
          'declared-mode v1 requires schema, mode=declared, and targets object',
          'delivery_contract',
          'hard',
        ),
      );
    }
    if (targets) {
      const entries = Object.entries(targets);
      if (entries.length > DELIVERY_TARGET_LIMIT) {
        out.push(
          reason(
            'DELIVERY_SIZE_CAP',
            `delivery target count exceeds ${DELIVERY_TARGET_LIMIT}`,
            'delivery_contract.targets',
            'hard',
          ),
        );
      }
      for (const [id, value] of entries) validateTarget(id, value, out);
    }
  }

  for (const task of tasksOf(board)) {
    const id = typeof task.id === 'string' ? task.id : '<unknown>';
    const delivery = record(task.delivery);
    if (task.delivery !== undefined) {
      const candidate = candidateOf(task);
      const observations = delivery?.observations;
      if (
        !delivery ||
        delivery.schema !== TASK_DELIVERY_SCHEMA ||
        !candidate ||
        !Array.isArray(observations) ||
        !SHA256_RE.test(String(candidate.fingerprint ?? '')) ||
        Object.hasOwn(delivery ?? {}, 'qualified') ||
        Object.hasOwn(candidate ?? {}, 'qualified')
      ) {
        out.push(
          reason(
            'FMT-TASK-DELIVERY',
            'task delivery shape is malformed',
            `tasks.${id}.delivery`,
            'hard',
          ),
        );
      } else {
        if (observations.length > DELIVERY_OBSERVATION_LIMIT) {
          out.push(
            reason(
              'DELIVERY_SIZE_CAP',
              `delivery observation count exceeds ${DELIVERY_OBSERVATION_LIMIT}`,
              `tasks.${id}.delivery.observations`,
              'hard',
            ),
          );
        }
        const bindingMatches = candidateBindingMatches(task);
        const retainedStaleEvidence = task.status === 'stale' && bindingMatches;
        if (!bindingMatches || (!taskTrulyDone(task) && !retainedStaleEvidence)) {
          out.push(
            reason(
              'BIZ-DELIVERY-CANDIDATE-BINDING',
              'delivery candidate must bind current true-done evidence or the retained stale attempt',
              `tasks.${id}.delivery.candidate`,
              'hard',
            ),
          );
        }
        for (let index = 0; index < observations.length; index++) {
          validateObservation(id, candidate, observations[index], index, targets, out);
        }
      }
    }

    const requirements = requirementsOf(task);
    if (task.dependency_requirements !== undefined) {
      if (!requirements) {
        out.push(
          reason(
            'FMT-DEPENDENCY-REQUIREMENTS',
            'dependency_requirements must be an object',
            `tasks.${id}.dependency_requirements`,
            'hard',
          ),
        );
        continue;
      }
      const entries = Object.entries(requirements);
      if (entries.length > DEPENDENCY_REQUIREMENT_LIMIT) {
        out.push(
          reason(
            'DELIVERY_SIZE_CAP',
            `dependency requirement count exceeds ${DEPENDENCY_REQUIREMENT_LIMIT}`,
            `tasks.${id}.dependency_requirements`,
            'hard',
          ),
        );
      }
      const deps = Array.isArray(task.deps)
        ? task.deps.filter((dep): dep is string => typeof dep === 'string')
        : [];
      for (const [dep, value] of entries) {
        const requirement = record(value);
        const path = `tasks.${id}.dependency_requirements.${dep}`;
        if (!requirement || !['candidate', 'delivered'].includes(String(requirement.level))) {
          out.push(
            reason(
              'FMT-DEPENDENCY-REQUIREMENTS',
              'requirement level must be candidate or delivered',
              path,
              'hard',
            ),
          );
          continue;
        }
        if (Object.hasOwn(requirement, 'qualified')) {
          out.push(
            reason(
              'FMT-DEPENDENCY-REQUIREMENTS',
              'qualification is derived and must not be persisted',
              path,
              'hard',
            ),
          );
        }
        if (dep !== '*' && !deps.includes(dep)) {
          out.push(
            reason(
              'BIZ-DEPENDENCY-REQUIREMENT',
              'requirement key is not a current deps[] member',
              path,
              'warn',
            ),
          );
        }
        if (requirement.level === 'candidate' && requirement.target !== undefined) {
          out.push(
            reason(
              'FMT-DEPENDENCY-REQUIREMENTS',
              'candidate requirement must not name a target',
              path,
              'hard',
            ),
          );
        }
        if (requirement.level === 'delivered') {
          const targetId = requirement.target;
          if (!nonEmptyString(targetId, 64) || !targets || !record(targets[targetId])) {
            out.push(
              reason(
                'FMT-DEPENDENCY-REQUIREMENTS',
                'delivered requirement target is not declared',
                path,
                'hard',
              ),
            );
          }
          const waiver = record(requirement.waiver_record);
          if (waiver) {
            const valid =
              waiver.authorized_by === 'user' &&
              waiver.downstream === id &&
              waiver.dependency === dep &&
              waiver.target === targetId &&
              nonEmptyString(waiver.reason) &&
              isISOUTC(waiver.authorized_at) &&
              isISOUTC(waiver.expires_at) &&
              Date.parse(waiver.expires_at as string) > Date.parse(waiver.authorized_at as string);
            if (!valid)
              out.push(
                reason(
                  'FMT-DEPENDENCY-REQUIREMENTS',
                  'waiver authority/scope/reason/expiry is malformed',
                  `${path}.waiver_record`,
                  'hard',
                ),
              );
          }
        }
      }
    }
  }
  return out;
}
