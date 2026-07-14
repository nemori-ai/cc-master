import { taskTrulyDone } from './board-model.js';
import { reconcileGating } from './board-reconcile.js';
import { canonicalJson } from './canonical-json.js';
import { sha256Hex } from './sha256.js';

export const NATIVE_ATTEMPT_CONTRACT = 'ccm/native-attempt/v1';
export const NATIVE_VERIFIED_EVIDENCE_CONTRACT = 'ccm/native-verified-evidence/v1';
export const NATIVE_ATTEMPT_PROJECTION_RULE = 'BIZ-NATIVE-ATTEMPT-PROJECTION';
export const NATIVE_HANDLE_EVIDENCE_RECORD_CODEX_API_TOOL =
  'ccm/native-handle-evidence-record/codex-api-tool/v1';
export const NATIVE_ATTEMPT_FEATURE_PROBE_CODEX_API_TOOL =
  'ccm/native-attempt-feature-probe/codex-api-tool/v1';
export const NATIVE_CANCEL_CONTROL_INTERRUPT_AGENT = 'interrupt-agent';

export const NATIVE_ATTEMPT_DESCRIPTOR_REGISTRY = Object.freeze({
  [NATIVE_ATTEMPT_CONTRACT]: Object.freeze({
    'codex-native': Object.freeze({
      origin: 'codex',
      harness: 'codex',
      adapter: 'codex/api-tool-multi-agent-v1',
      surface: 'host-native',
      transport: 'codex-api-tool-multi-agent',
    }),
  }),
});

// biome-ignore lint/suspicious/noExplicitAny: Board/native evidence is an additive JSON contract projected field-by-field.
type JsonObject = Record<string, any>;

export interface NativeAttemptIssue {
  code: string;
  path?: string;
  message?: string;
  task_id?: string;
}

export type NativeAttemptWriterKind =
  | 'generic'
  | 'generic-state'
  | 'native-create'
  | 'native-bind'
  | 'native-cancel'
  | 'native-terminal'
  | 'native-reconcile';

export interface NativeAttemptApplyResult {
  ok: boolean;
  board: JsonObject;
  result?: JsonObject;
  issues?: NativeAttemptIssue[];
}

class NativeAttemptError extends Error {
  constructor(
    readonly code: string,
    readonly path?: string,
  ) {
    super(code);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function same(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return canonicalJson(left) === canonicalJson(right);
}

function reject(code: string, path?: string): never {
  throw new NativeAttemptError(code, path);
}

function required(value: unknown, code: string, path?: string): asserts value {
  if (value === undefined || value === null || value === '') reject(code, path);
}

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const GIT_COMMIT_RE = /^[0-9a-f]{40}$/;
const UTC_SECOND_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ACTIVE_STATES = new Set(['starting', 'running', 'uncertain']);
const ATTEMPT_STATES = new Set(['starting', 'running', 'uncertain', 'terminal', 'orphaned']);
const TERMINAL_CLASSES = new Set(['succeeded', 'failed', 'cancelled', 'startup_failed']);
const PROFILE_RESTRICTION_RANK = new Map([
  ['danger-full-access', 0],
  ['workspace-write', 1],
  ['read-only', 2],
]);

function isUtcSecond(value: unknown): value is string {
  if (typeof value !== 'string' || !UTC_SECOND_RE.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().replace('.000Z', 'Z') === value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasExactKeys(value: JsonObject, expectedKeys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function descriptorForAttempt(attempt: JsonObject): JsonObject {
  const registry = NATIVE_ATTEMPT_DESCRIPTOR_REGISTRY[NATIVE_ATTEMPT_CONTRACT];
  const descriptor = registry[attempt?.candidate_id as keyof typeof registry];
  if (
    !descriptor ||
    attempt?.surface !== descriptor.surface ||
    attempt?.transport !== descriptor.transport
  ) {
    reject('NATIVE-DESCRIPTOR-UNSUPPORTED', 'attempt');
  }
  return clone(descriptor);
}

function canonicalCreateSnapshot(command: JsonObject): JsonObject {
  const incoming = command.attempt;
  const descriptor = descriptorForAttempt(incoming);
  return {
    task_id: command.task_id,
    selection_snapshot: clone(command.selection_snapshot),
    attempt: { ...clone(incoming), descriptor },
  };
}

function createHashFor(snapshot: JsonObject): string {
  return `sha256:${sha256Hex(canonicalJson(snapshot))}`;
}

function findTask(board: JsonObject, taskId: unknown): JsonObject {
  const task = Array.isArray(board.tasks)
    ? board.tasks.find((entry: JsonObject) => entry?.id === taskId)
    : undefined;
  if (!task) reject('NATIVE-TASK-NOT-FOUND', 'task_id');
  return task;
}

function findAttempt(task: JsonObject, attemptId: unknown): JsonObject {
  const attempt = Array.isArray(task.routing?.attempts)
    ? task.routing.attempts.find((entry: JsonObject) => entry?.id === attemptId)
    : undefined;
  if (!attempt) reject('NATIVE-ATTEMPT-NOT-FOUND', 'attempt_id');
  return attempt;
}

function requireContract(board: JsonObject): void {
  if (board.meta?.contracts?.native_attempt !== NATIVE_ATTEMPT_CONTRACT) {
    reject('NATIVE-CONTRACT-NOT-ACTIVE', 'meta.contracts.native_attempt');
  }
}

function requireKnownAccount(value: unknown): void {
  if (value === 'unknown') reject('NATIVE-ACCOUNT-FINGERPRINT-UNKNOWN');
  if (value !== 'known-current' && value !== 'current') {
    reject('NATIVE-ACCOUNT-FINGERPRINT-MISMATCH');
  }
}

function requireCompatiblePermission(profile: unknown, denies: unknown): void {
  if (profile !== 'compatible') reject('NATIVE-PERMISSION-PROFILE-INCOMPATIBLE');
  if (denies !== 'compatible') reject('NATIVE-PERMISSION-DENY-INCOMPATIBLE');
}

function denySuperset(effective: unknown, requiredDenies: unknown): boolean {
  if (!Array.isArray(effective) || !Array.isArray(requiredDenies)) return false;
  const effectiveSet = new Set(effective);
  return requiredDenies.every((entry) => typeof entry === 'string' && effectiveSet.has(entry));
}

function profileAtLeastAsRestricted(effective: unknown, requiredProfile: unknown): boolean {
  if (typeof effective !== 'string' || typeof requiredProfile !== 'string') return false;
  const effectiveRank = PROFILE_RESTRICTION_RANK.get(effective);
  const requiredRank = PROFILE_RESTRICTION_RANK.get(requiredProfile);
  return effectiveRank !== undefined && requiredRank !== undefined && effectiveRank >= requiredRank;
}

const LINEAGE_STRING_FIELDS = [
  'origin_session_ref',
  'parent_target',
  'expected_child_target',
  'account_fingerprint_ref',
  'workspace_ref',
  'worktree_ref',
  'baseline_commit',
] as const;

function requireStructurallyCompleteLineage(value: unknown): asserts value is JsonObject {
  if (!isJsonObject(value)) {
    reject('NATIVE-LINEAGE-MISMATCH');
  }
  const lineage = value as JsonObject;
  if (
    LINEAGE_STRING_FIELDS.some((field) => !isNonEmptyString(lineage[field])) ||
    !GIT_COMMIT_RE.test(lineage.baseline_commit)
  ) {
    reject('NATIVE-LINEAGE-MISMATCH');
  }
  if (
    !isJsonObject(lineage.permission) ||
    !isNonEmptyString(lineage.permission?.snapshot_ref) ||
    !PROFILE_RESTRICTION_RANK.has(lineage.permission?.profile) ||
    !Array.isArray(lineage.permission?.denies) ||
    lineage.permission.denies.some((entry: unknown) => !isNonEmptyString(entry))
  ) {
    reject('NATIVE-LINEAGE-MISMATCH');
  }
}

function requireSelectionSnapshotStructure(value: unknown): asserts value is JsonObject {
  if (!isJsonObject(value)) reject('NATIVE-ATTEMPT-INVALID', 'selection_snapshot');
  const selection = value as JsonObject;
  if (
    !isNonEmptyString(selection.candidate_id) ||
    !isNonEmptyString(selection.chain) ||
    !isUtcSecond(selection.selected_at) ||
    !isJsonObject(selection.evidence) ||
    !Array.isArray(selection.reason_codes) ||
    selection.reason_codes.some((entry: unknown) => !isNonEmptyString(entry))
  ) {
    reject('NATIVE-ATTEMPT-INVALID', 'selection_snapshot');
  }
}

function requireAttemptBaseStructure(
  value: unknown,
  expectedOrdinal: number,
): asserts value is JsonObject {
  if (!isJsonObject(value)) reject('NATIVE-ATTEMPT-INVALID', 'attempt');
  const attempt = value as JsonObject;
  if (
    attempt.schema !== NATIVE_ATTEMPT_CONTRACT ||
    !isNonEmptyString(attempt.id) ||
    !Number.isSafeInteger(attempt.ordinal) ||
    attempt.ordinal !== expectedOrdinal ||
    !isNonEmptyString(attempt.candidate_id) ||
    !isNonEmptyString(attempt.surface) ||
    !isNonEmptyString(attempt.transport) ||
    !ATTEMPT_STATES.has(attempt.state) ||
    !isUtcSecond(attempt.created_at) ||
    !isJsonObject(attempt.dispatch) ||
    !isNonEmptyString(attempt.dispatch.key) ||
    !SHA256_RE.test(attempt.dispatch.request_hash) ||
    !isNonEmptyString(attempt.dispatch.launch_claim_id) ||
    !isNonEmptyString(attempt.dispatch.claim_owner_session_ref) ||
    !Array.isArray(attempt.reconciliation)
  ) {
    reject('NATIVE-ATTEMPT-INVALID', 'attempt');
  }
  requireStructurallyCompleteLineage(attempt.lineage);
  if (attempt.dispatch.claim_owner_session_ref !== attempt.lineage.origin_session_ref) {
    reject('NATIVE-ATTEMPT-INVALID', 'attempt.dispatch.claim_owner_session_ref');
  }
  requireSelectionSnapshotStructure(attempt.selection_snapshot);
}

function requireInitialCreateAttempt(value: unknown, expectedOrdinal: number): void {
  requireAttemptBaseStructure(value, expectedOrdinal);
  const attempt = value as JsonObject;
  if (
    attempt.state !== 'starting' ||
    attempt.handle_binding !== null ||
    attempt.cancel !== null ||
    attempt.terminal !== null ||
    attempt.reconciliation.length !== 0 ||
    attempt.handle !== undefined ||
    attempt.started_at !== undefined ||
    attempt.finished_at !== undefined ||
    attempt.orphan_audit !== undefined
  ) {
    reject('NATIVE-ATTEMPT-INVALID', 'attempt');
  }
}

function requireCancelRequest(value: unknown): asserts value is JsonObject {
  if (!isJsonObject(value)) reject('NATIVE-CANCEL-REQUEST-INVALID', 'request');
  const request = value as JsonObject;
  if (
    !hasExactKeys(request, [
      'id',
      'request_hash',
      'requested_at',
      'requested_by_session_ref',
      'control',
      'reason_code',
    ]) ||
    !isNonEmptyString(request.id) ||
    !SHA256_RE.test(request.request_hash) ||
    !isUtcSecond(request.requested_at) ||
    !isNonEmptyString(request.requested_by_session_ref) ||
    request.control !== NATIVE_CANCEL_CONTROL_INTERRUPT_AGENT ||
    !isNonEmptyString(request.reason_code)
  ) {
    reject('NATIVE-CANCEL-REQUEST-INVALID', 'request');
  }
}

function requireNormalizedHandleBinding(value: unknown): asserts value is JsonObject {
  if (!isJsonObject(value)) reject('NATIVE-HANDLE-BINDING-INVALID', 'handle_binding');
  const binding = value as JsonObject;
  if (
    !hasExactKeys(binding, [
      'evidence_record_ref',
      'evidence_hash',
      'producer_id',
      'handle_kind',
      'handle',
      'bound_at',
      'durability_class',
    ]) ||
    !isNonEmptyString(binding.evidence_record_ref) ||
    !SHA256_RE.test(binding.evidence_hash) ||
    !isNonEmptyString(binding.producer_id) ||
    !isNonEmptyString(binding.handle_kind) ||
    !isNonEmptyString(binding.handle) ||
    !isUtcSecond(binding.bound_at) ||
    binding.durability_class !== 'legacy_session_bound'
  ) {
    reject('NATIVE-HANDLE-BINDING-INVALID', 'handle_binding');
  }
}

const RECONCILIATION_PRIVATE_SOURCE = 'ccm-private-adapter/v1';
const RECONCILIATION_RECORD_KEYS = new Map<string, readonly string[]>([
  [
    'uncertain',
    [
      'classification',
      'evidence_record_ref',
      'evidence_hash',
      'observed_at',
      'reason_code',
      'observed',
    ],
  ],
  [
    'running',
    [
      'classification',
      'evidence_record_ref',
      'evidence_hash',
      'observed_at',
      'same_handle_evidence_record_ref',
      'handle',
      'observed',
    ],
  ],
  [
    'terminal',
    [
      'classification',
      'evidence_record_ref',
      'evidence_hash',
      'observed_at',
      'terminal',
      'observed',
    ],
  ],
  [
    'orphaned',
    [
      'classification',
      'evidence_record_ref',
      'evidence_hash',
      'observed_at',
      'orphan_audit',
      'observed',
    ],
  ],
]);

function requireStoredOrphanAudit(value: unknown): asserts value is JsonObject {
  if (!isJsonObject(value)) reject('NATIVE-ORPHAN-AUDIT-INCOMPLETE', 'orphan_audit');
  const audit = value as JsonObject;
  if (
    !hasExactKeys(audit, [
      'origin_session_status',
      'handle_status',
      'worktree_authority',
      'account_authority',
      'audit_ref',
      'audit_hash',
    ]) ||
    audit.origin_session_status !== 'unavailable' ||
    audit.handle_status !== 'unaddressable' ||
    audit.worktree_authority !== 'fenced' ||
    audit.account_authority !== 'unchanged' ||
    !isNonEmptyString(audit.audit_ref) ||
    !SHA256_RE.test(audit.audit_hash)
  ) {
    reject('NATIVE-ORPHAN-AUDIT-INCOMPLETE', 'orphan_audit');
  }
}

function requireStoredReconciliationCommon(
  attempt: JsonObject,
  value: unknown,
  evidenceRefs: Set<string>,
  evidenceHashes: Set<string>,
  previousObservedAt: string,
): asserts value is JsonObject {
  if (!isJsonObject(value)) reject('NATIVE-ATTEMPT-INVALID', 'reconciliation');
  const record = value as JsonObject;
  const expectedKeys = RECONCILIATION_RECORD_KEYS.get(record.classification);
  if (
    !expectedKeys ||
    !hasExactKeys(record, expectedKeys) ||
    !isNonEmptyString(record.evidence_record_ref) ||
    !SHA256_RE.test(record.evidence_hash) ||
    !isUtcSecond(record.observed_at) ||
    new Date(record.observed_at).valueOf() <= new Date(previousObservedAt).valueOf() ||
    evidenceRefs.has(record.evidence_record_ref) ||
    evidenceHashes.has(record.evidence_hash) ||
    !isJsonObject(record.observed) ||
    !same(record.observed.descriptor, attempt.descriptor) ||
    record.observed.source !== RECONCILIATION_PRIVATE_SOURCE
  ) {
    reject('NATIVE-ATTEMPT-INVALID', 'reconciliation');
  }
  const observedKeys = ['descriptor', 'target', 'source', 'current_lineage'];
  if (record.classification === 'running') {
    observedKeys.push('handle', 'handle_kind', 'spawn', 'roster');
  }
  if (!hasExactKeys(record.observed, observedKeys)) {
    reject('NATIVE-ATTEMPT-INVALID', 'reconciliation.observed');
  }
  evidenceRefs.add(record.evidence_record_ref);
  evidenceHashes.add(record.evidence_hash);
}

function requireStoredAttemptLifecycle(attempt: JsonObject): void {
  const hasBinding = attempt.handle_binding !== null;
  const hasCancel = attempt.cancel !== null;
  const hasTerminal = attempt.terminal !== null;
  const hasStartedAt = attempt.started_at !== undefined;
  const hasFinishedAt = attempt.finished_at !== undefined;
  const hasOrphanAudit = attempt.orphan_audit !== undefined;

  if (
    hasBinding !== hasStartedAt ||
    (hasCancel && !hasBinding) ||
    hasFinishedAt !== hasTerminal ||
    hasOrphanAudit !== (attempt.state === 'orphaned') ||
    hasTerminal !== (attempt.state === 'terminal') ||
    (hasTerminal && attempt.finished_at !== attempt.terminal?.observed_at)
  ) {
    reject('NATIVE-ATTEMPT-INVALID', 'attempt.state');
  }

  let reachableState = hasBinding ? 'running' : 'starting';
  const initialObservationTimes = [
    attempt.created_at,
    attempt.started_at,
    attempt.handle_binding?.bound_at,
  ].filter(isUtcSecond);
  let previousObservedAt = initialObservationTimes.reduce((latest, current) =>
    new Date(current).valueOf() > new Date(latest).valueOf() ? current : latest,
  );
  const evidenceRefs = new Set<string>();
  const evidenceHashes = new Set<string>();
  for (const record of attempt.reconciliation) {
    requireStoredReconciliationCommon(
      attempt,
      record,
      evidenceRefs,
      evidenceHashes,
      previousObservedAt,
    );
    previousObservedAt = record.observed_at;
    switch (record.classification) {
      case 'uncertain':
        if (
          (reachableState !== 'starting' && reachableState !== 'running') ||
          !isNonEmptyString(record.reason_code) ||
          record.observed.target !== null
        ) {
          reject('NATIVE-ATTEMPT-INVALID', 'reconciliation');
        }
        requireStructurallyCompleteLineage(record.observed.current_lineage);
        reachableState = 'uncertain';
        break;
      case 'running':
        if (
          reachableState !== 'uncertain' ||
          !hasBinding ||
          record.same_handle_evidence_record_ref !== attempt.handle_binding.evidence_record_ref ||
          record.handle !== attempt.handle_binding.handle ||
          record.observed.handle !== attempt.handle_binding.handle ||
          record.observed.handle_kind !== attempt.handle_binding.handle_kind ||
          record.observed.spawn?.observed_at !== attempt.started_at ||
          record.observed.roster?.observed_at !== record.observed_at
        ) {
          reject('NATIVE-ATTEMPT-INVALID', 'reconciliation');
        }
        requireLineage(record.observed.current_lineage, attempt.lineage);
        requireAuthoritativeLiveTarget({ observed: record.observed, scope: {} }, attempt);
        reachableState = 'running';
        break;
      case 'terminal':
        if (
          reachableState !== 'uncertain' ||
          !hasTerminal ||
          record.observed.target !== attempt.lineage.expected_child_target ||
          !isJsonObject(record.terminal) ||
          !hasExactKeys(record.terminal, [
            'class',
            'result_ref',
            'artifact_refs',
            'evidence_hash',
          ]) ||
          !SHA256_RE.test(record.terminal.evidence_hash)
        ) {
          reject('NATIVE-ATTEMPT-INVALID', 'reconciliation');
        }
        requireLineage(record.observed.current_lineage, attempt.lineage);
        requireTerminalPayload({ ...record.terminal, observed_at: record.observed_at });
        if (
          !same(attempt.terminal, {
            class: record.terminal.class,
            observed_at: record.observed_at,
            result_ref: record.terminal.result_ref,
            artifact_refs: clone(record.terminal.artifact_refs),
            evidence_record_ref: record.evidence_record_ref,
            evidence_hash: record.evidence_hash,
            source: record.observed.source,
          })
        ) {
          reject('NATIVE-ATTEMPT-INVALID', 'terminal');
        }
        reachableState = 'terminal';
        break;
      case 'orphaned':
        if (reachableState !== 'uncertain' || !hasOrphanAudit || record.observed.target !== null) {
          reject('NATIVE-ATTEMPT-INVALID', 'reconciliation');
        }
        requireLineage(record.observed.current_lineage, attempt.lineage);
        requireStoredOrphanAudit(record.orphan_audit);
        if (!same(record.orphan_audit, attempt.orphan_audit)) {
          reject('NATIVE-ATTEMPT-INVALID', 'orphan_audit');
        }
        reachableState = 'orphaned';
        break;
      default:
        reject('NATIVE-ATTEMPT-INVALID', 'reconciliation');
    }
  }

  if (hasTerminal && reachableState !== 'terminal') {
    if (reachableState !== 'running' && reachableState !== 'uncertain') {
      reject('NATIVE-ATTEMPT-INVALID', 'terminal');
    }
    reachableState = 'terminal';
  }
  if (reachableState !== attempt.state) {
    reject('NATIVE-ATTEMPT-INVALID', 'attempt.state');
  }
}

function requireStoredAttemptStructure(value: unknown, expectedOrdinal: number): void {
  requireAttemptBaseStructure(value, expectedOrdinal);
  const attempt = value as JsonObject;
  if (attempt.handle_binding !== null) requireNormalizedHandleBinding(attempt.handle_binding);
  if (attempt.cancel !== null) requireCancelRequest(attempt.cancel);
  if (attempt.terminal !== null && !terminalEvidenceAllowsDone(attempt.terminal)) {
    reject('NATIVE-TERMINAL-EVIDENCE-INVALID', 'terminal');
  }
  if (attempt.started_at !== undefined && !isUtcSecond(attempt.started_at)) {
    reject('NATIVE-ATTEMPT-INVALID', 'started_at');
  }
  if (attempt.finished_at !== undefined && !isUtcSecond(attempt.finished_at)) {
    reject('NATIVE-ATTEMPT-INVALID', 'finished_at');
  }
  requireStoredAttemptLifecycle(attempt);
}

function requireLineage(actual: unknown, expected: unknown): void {
  requireStructurallyCompleteLineage(actual);
  requireStructurallyCompleteLineage(expected);
  const actualRow = clone(actual as JsonObject);
  const expectedRow = clone(expected as JsonObject);
  const actualPermission = actualRow.permission;
  const expectedPermission = expectedRow.permission;
  delete actualRow.permission;
  delete expectedRow.permission;
  if (!same(actualRow, expectedRow)) reject('NATIVE-LINEAGE-MISMATCH');
  if (
    actualPermission?.snapshot_ref !== expectedPermission?.snapshot_ref ||
    !profileAtLeastAsRestricted(actualPermission?.profile, expectedPermission?.profile)
  ) {
    reject('NATIVE-PERMISSION-PROFILE-INCOMPATIBLE');
  }
  if (!denySuperset(actualPermission?.denies, expectedPermission?.denies)) {
    reject('NATIVE-PERMISSION-DENY-INCOMPATIBLE');
  }
}

type ObservedLineagePolicy = 'exact-or-stricter' | 'structurally-complete-drift';

function requireObservedLineage(
  attempt: JsonObject,
  observed: unknown,
  policy: ObservedLineagePolicy,
): void {
  if (policy === 'structurally-complete-drift') {
    requireStructurallyCompleteLineage(observed);
    return;
  }
  requireLineage(observed, attempt.lineage);
}

function requireAdmission(attempt: JsonObject, admission: JsonObject): void {
  requireCurrentAuthority(attempt, admission);
  required(admission?.account, 'NATIVE-ACCOUNT-FINGERPRINT-UNKNOWN');
  requireKnownAccount(admission.account.status);
  if (
    admission.account.requested_fingerprint_ref !== attempt.lineage?.account_fingerprint_ref ||
    admission.account.current_fingerprint_ref !== attempt.lineage?.account_fingerprint_ref
  ) {
    reject('NATIVE-ACCOUNT-FINGERPRINT-MISMATCH');
  }

  const permission = admission.permission;
  required(permission, 'NATIVE-PERMISSION-PROFILE-INCOMPATIBLE');
  requireCompatiblePermission(permission.profile_status, permission.deny_status);
  if (
    permission.snapshot_ref !== attempt.lineage?.permission?.snapshot_ref ||
    permission.requested_profile !== attempt.lineage?.permission?.profile ||
    !profileAtLeastAsRestricted(permission.effective_profile, attempt.lineage?.permission?.profile)
  ) {
    reject('NATIVE-PERMISSION-PROFILE-INCOMPATIBLE');
  }
  if (
    !denySuperset(permission.required_denies, attempt.lineage?.permission?.denies) ||
    !denySuperset(attempt.lineage?.permission?.denies, permission.required_denies) ||
    !denySuperset(permission.effective_denies, attempt.lineage?.permission?.denies)
  ) {
    reject('NATIVE-PERMISSION-DENY-INCOMPATIBLE');
  }
}

function requireCurrentAuthority(attempt: JsonObject, authority: unknown): JsonObject {
  if (!isJsonObject(authority)) reject('NATIVE-LINEAGE-MISMATCH');
  const currentLineage = authority.current_lineage;
  requireLineage(currentLineage, attempt.lineage);
  return currentLineage as JsonObject;
}

function requireSelection(task: JsonObject, selection: JsonObject, attempt: JsonObject): void {
  if (
    !same(selection, attempt.selection_snapshot) ||
    selection.candidate_id !== attempt.candidate_id
  ) {
    reject('NATIVE-SELECTION-MISMATCH');
  }
  const candidate = task.routing?.policy?.candidates?.find(
    (entry: JsonObject) => entry?.id === selection.candidate_id,
  );
  const chain = task.routing?.policy?.chains?.[selection.chain];
  const descriptor = descriptorForAttempt(attempt);
  if (
    !candidate ||
    candidate.surface !== descriptor.surface ||
    candidate.adapter !== descriptor.adapter ||
    candidate.harness !== descriptor.harness ||
    !Array.isArray(chain) ||
    !chain.includes(candidate.id)
  ) {
    reject('NATIVE-DESCRIPTOR-UNSUPPORTED');
  }
  const taskForbidden = Array.isArray(task.planning?.capabilities?.forbidden)
    ? task.planning.capabilities.forbidden
        .map((entry: JsonObject) => entry?.id)
        .filter(isNonEmptyString)
    : [];
  const requiredDenies = [...new Set([...(candidate.permission?.denies ?? []), ...taskForbidden])];
  if (attempt.lineage?.permission?.profile !== candidate.permission?.profile) {
    reject('NATIVE-PERMISSION-PROFILE-INCOMPATIBLE');
  }
  if (!denySuperset(attempt.lineage?.permission?.denies, requiredDenies)) {
    reject('NATIVE-PERMISSION-DENY-INCOMPATIBLE');
  }
}

function expectedEvidenceScope(task: JsonObject, attempt: JsonObject): JsonObject {
  return {
    contract: NATIVE_ATTEMPT_CONTRACT,
    ...clone(attempt.descriptor),
    task_id: task.id,
    attempt_id: attempt.id,
    candidate_id: attempt.candidate_id,
    dispatch_key: attempt.dispatch?.key,
    request_hash: attempt.dispatch?.request_hash,
    launch_claim_id: attempt.dispatch?.launch_claim_id,
    create_hash: attempt.create_hash,
  };
}

function requireVerifiedEnvelope(
  command: JsonObject,
  task: JsonObject,
  attempt: JsonObject,
  evidenceClass: 'bind' | 'terminal' | 'reconcile',
): JsonObject {
  const evidence = command.verified_evidence;
  if (command.evidence !== undefined) {
    reject('NATIVE-EVIDENCE-ENVELOPE-REQUIRED', 'evidence');
  }
  if (!evidence || evidence.schema !== NATIVE_VERIFIED_EVIDENCE_CONTRACT) {
    reject('NATIVE-EVIDENCE-ENVELOPE-REQUIRED', 'verified_evidence');
  }
  if (
    evidence.evidence_class !== evidenceClass ||
    !isNonEmptyString(evidence.record_ref) ||
    !SHA256_RE.test(evidence.record_hash) ||
    !isNonEmptyString(command.evidence_record_ref) ||
    command.evidence_record_ref !== evidence.record_ref
  ) {
    reject('NATIVE-EVIDENCE-SCOPE-MISMATCH', 'verified_evidence');
  }
  if (!same(evidence.scope, expectedEvidenceScope(task, attempt))) {
    reject('NATIVE-EVIDENCE-SCOPE-MISMATCH', 'verified_evidence.scope');
  }
  if (!same(evidence.observed?.descriptor, attempt.descriptor)) {
    reject('NATIVE-DESCRIPTOR-UNSUPPORTED', 'verified_evidence.observed.descriptor');
  }
  if (
    !isNonEmptyString(evidence.producer?.producer_id) ||
    evidence.producer?.channel !== 'ccm-private-adapter/v1'
  ) {
    reject('NATIVE-EVIDENCE-UNTRUSTED-PRODUCER', 'verified_evidence.producer');
  }
  requireKnownAccount(evidence.resolved_context?.account);
  requireCompatiblePermission(
    evidence.resolved_context?.permission_profile,
    evidence.resolved_context?.permission_denies,
  );
  required(evidence.observed?.source, 'NATIVE-EVIDENCE-SOURCE-MISSING');
  required(evidence.observed?.current_lineage, 'NATIVE-LINEAGE-MISMATCH');
  if (
    !evidence.payload ||
    typeof evidence.payload !== 'object' ||
    Array.isArray(evidence.payload)
  ) {
    reject('NATIVE-EVIDENCE-PAYLOAD-INVALID', 'verified_evidence.payload');
  }
  return evidence;
}

function requireAuthoritativeLiveTarget(evidence: JsonObject, attempt: JsonObject): void {
  const observed = evidence.observed;
  required(observed?.handle, 'NATIVE-HANDLE-MISSING');
  if (
    observed.handle === attempt.lineage?.origin_session_ref ||
    observed.handle === attempt.lineage?.parent_target ||
    observed.handle === evidence.scope?.task_id
  ) {
    reject('NATIVE-HANDLE-PARENT-SESSION');
  }
  const expectedTarget = attempt.lineage?.expected_child_target;
  if (observed.target !== expectedTarget) {
    reject('NATIVE-EXPECTED-CHILD-MISMATCH');
  }
  if (
    !isNonEmptyString(observed.target) ||
    !isNonEmptyString(observed.handle_kind) ||
    observed.spawn?.target !== observed.target ||
    !isUtcSecond(observed.spawn?.observed_at) ||
    observed.roster?.target !== observed.target ||
    observed.roster?.handle !== observed.handle ||
    observed.roster?.state !== 'running' ||
    !isUtcSecond(observed.roster?.observed_at)
  ) {
    reject('NATIVE-HANDLE-UNATTESTED');
  }
}

function requireTerminalPayload(payload: JsonObject): void {
  if (
    !TERMINAL_CLASSES.has(payload.class) ||
    !isUtcSecond(payload.observed_at) ||
    !isNonEmptyString(payload.result_ref) ||
    !Array.isArray(payload.artifact_refs) ||
    payload.artifact_refs.some((entry: unknown) => !isNonEmptyString(entry))
  ) {
    reject('NATIVE-TERMINAL-EVIDENCE-INVALID');
  }
}

function normalizeTerminalEvidence(evidence: JsonObject): JsonObject {
  const payload = evidence.payload;
  requireTerminalPayload(payload);
  return {
    class: payload.class,
    observed_at: payload.observed_at,
    result_ref: payload.result_ref,
    artifact_refs: clone(payload.artifact_refs),
    evidence_record_ref: evidence.record_ref,
    evidence_hash: evidence.record_hash,
    source: evidence.observed.source,
  };
}

function create(board: JsonObject, command: JsonObject): NativeAttemptApplyResult {
  const task = findTask(board, command.task_id);
  const incoming = command.attempt;
  required(incoming, 'NATIVE-ATTEMPT-MISSING', 'attempt');
  if (incoming.create_snapshot !== undefined || incoming.create_hash !== undefined) {
    reject('NATIVE-ATTEMPT-INVALID', 'attempt');
  }
  const createSnapshot = canonicalCreateSnapshot(command);
  const attempts = task.routing?.attempts;
  if (!Array.isArray(attempts)) reject('NATIVE-ROUTING-MISSING', 'routing.attempts');
  const replay = attempts.find(
    (entry: JsonObject) => entry?.dispatch?.key === incoming.dispatch?.key,
  );
  requireInitialCreateAttempt(incoming, replay?.ordinal ?? nativeAttempts(task).length + 1);
  requireSelectionSnapshotStructure(command.selection_snapshot);
  const createHash = createHashFor(createSnapshot);

  if (replay) {
    if (replay.create_hash !== createHash || !same(replay.create_snapshot, createSnapshot)) {
      reject('NATIVE-ATTEMPT-REPLAY-CONFLICT');
    }
    if (command.replay_intent === 'require-new-launch') {
      reject('NATIVE-LAUNCH-REPLAY-DENIED');
    }
    return {
      ok: true,
      board,
      result: { created: false, launch_allowed: false, attempt_id: replay.id },
    };
  }
  if (attempts.some((entry: JsonObject) => entry?.id === incoming.id)) {
    reject('NATIVE-ATTEMPT-REPLAY-CONFLICT');
  }
  if (
    attempts.some((entry: JsonObject) =>
      ['starting', 'running', 'uncertain'].includes(entry?.state),
    )
  ) {
    reject('NATIVE-ATTEMPT-ACTIVE');
  }
  if (task.status !== 'ready' || task.executor !== 'subagent') reject('NATIVE-TASK-NOT-READY');
  requireSelection(task, command.selection_snapshot, incoming);
  requireAdmission(incoming, command.admission_snapshot);

  task.routing.selected = clone(command.selection_snapshot);
  task.routing.attempts.push({
    ...clone(incoming),
    descriptor: clone(createSnapshot.attempt.descriptor),
    create_snapshot: createSnapshot,
    create_hash: createHash,
  });
  delete task.handle;
  return {
    ok: true,
    board,
    result: { created: true, launch_allowed: true, attempt_id: incoming.id },
  };
}

function bind(board: JsonObject, command: JsonObject): NativeAttemptApplyResult {
  if (command.claimed_durability_class) reject('NATIVE-HANDOFF-UNSUPPORTED');
  const task = findTask(board, command.task_id);
  const attempt = findAttempt(task, command.attempt_id);
  const evidence = requireVerifiedEnvelope(command, task, attempt, 'bind');
  requireObservedLineage(attempt, evidence.observed.current_lineage, 'exact-or-stricter');
  if (evidence.payload.durability_class !== 'legacy_session_bound') {
    reject('NATIVE-HANDOFF-UNSUPPORTED');
  }

  if (attempt.handle_binding) {
    if (
      attempt.handle_binding?.evidence_record_ref !== evidence.record_ref ||
      attempt.handle_binding?.evidence_hash !== evidence.record_hash ||
      attempt.handle_binding?.handle !== evidence.observed?.handle
    ) {
      reject('NATIVE-ATTEMPT-REPLAY-CONFLICT');
    }
    requireAuthoritativeLiveTarget(evidence, attempt);
    return { ok: true, board, result: { bound: false, attempt_id: attempt.id } };
  }
  if (attempt.state !== 'starting') reject('NATIVE-ATTEMPT-STATE-CONFLICT');
  requireAuthoritativeLiveTarget(evidence, attempt);
  const observed = evidence.observed;

  attempt.state = 'running';
  attempt.handle = observed.handle;
  attempt.started_at = observed.spawn?.observed_at;
  attempt.handle_binding = {
    evidence_record_ref: evidence.record_ref,
    evidence_hash: evidence.record_hash,
    producer_id: evidence.producer.producer_id,
    handle_kind: observed.handle_kind,
    handle: observed.handle,
    bound_at: observed.roster.observed_at,
    durability_class: 'legacy_session_bound',
  };
  task.handle = observed.handle;
  task.status = 'in_flight';
  task.started_at ??= observed.spawn?.observed_at;
  return { ok: true, board, result: { bound: true, attempt_id: attempt.id } };
}

function cancel(board: JsonObject, command: JsonObject): NativeAttemptApplyResult {
  if (command.acknowledgement_terminal_class) reject('NATIVE-CANCEL-UNCONFIRMED');
  const task = findTask(board, command.task_id);
  const attempt = findAttempt(task, command.attempt_id);
  required(command.request, 'NATIVE-CANCEL-REQUEST-MISSING');
  requireCancelRequest(command.request);
  const currentLineage = requireCurrentAuthority(attempt, command.authority_snapshot);
  if (command.request.requested_by_session_ref !== currentLineage.origin_session_ref) {
    reject('NATIVE-LINEAGE-MISMATCH');
  }
  if (attempt.cancel) {
    if (!same(attempt.cancel, command.request)) reject('NATIVE-ATTEMPT-REPLAY-CONFLICT');
    return { ok: true, board, result: { host_control_effects: 0, attempt_id: attempt.id } };
  }
  if (attempt.state !== 'running') reject('NATIVE-ATTEMPT-STATE-CONFLICT');
  attempt.cancel = clone(command.request);
  return { ok: true, board, result: { host_control_effects: 1, attempt_id: attempt.id } };
}

function terminal(board: JsonObject, command: JsonObject): NativeAttemptApplyResult {
  if (command.requested_task_status === 'done') reject('NATIVE-TERMINAL-DIRECT-DONE');
  const task = findTask(board, command.task_id);
  const attempt = findAttempt(task, command.attempt_id);
  const evidence = requireVerifiedEnvelope(command, task, attempt, 'terminal');
  requireObservedLineage(attempt, evidence.observed.current_lineage, 'exact-or-stricter');
  if (evidence.observed.target !== attempt.lineage?.expected_child_target) {
    reject('NATIVE-EXPECTED-CHILD-MISMATCH');
  }
  const normalized = normalizeTerminalEvidence(evidence);
  if (attempt.state === 'terminal') {
    if (!same(attempt.terminal, normalized)) reject('NATIVE-ATTEMPT-REPLAY-CONFLICT');
    return { ok: true, board, result: { terminalized: false, attempt_id: attempt.id } };
  }
  if (!['running', 'uncertain'].includes(attempt.state)) {
    reject('NATIVE-ATTEMPT-STATE-CONFLICT');
  }
  attempt.state = 'terminal';
  attempt.terminal = normalized;
  attempt.finished_at = normalized.observed_at;
  delete attempt.handle;
  task.status = 'uncertain';
  delete task.handle;
  return { ok: true, board, result: { terminalized: true, attempt_id: attempt.id } };
}

function reconcile(board: JsonObject, command: JsonObject): NativeAttemptApplyResult {
  const task = findTask(board, command.task_id);
  const attempt = findAttempt(task, command.attempt_id);
  const envelope = requireVerifiedEnvelope(command, task, attempt, 'reconcile');
  const evidence = envelope.payload;
  const normalizedRecord = {
    ...clone(evidence),
    evidence_record_ref: envelope.record_ref,
    evidence_hash: envelope.record_hash,
    observed: clone(envelope.observed),
  };
  const records = Array.isArray(attempt.reconciliation) ? attempt.reconciliation : [];
  const replay = records.find(
    (entry: JsonObject) => entry?.evidence_record_ref === envelope.record_ref,
  );
  if (replay) {
    if (!same(replay, normalizedRecord)) reject('NATIVE-RECONCILE-CONFLICT');
    return { ok: true, board, result: { reconciled: false, attempt_id: attempt.id } };
  }
  if (['terminal', 'orphaned'].includes(attempt.state)) reject('NATIVE-RECONCILE-CONFLICT');

  switch (evidence.classification) {
    case 'uncertain':
      if (!['starting', 'running'].includes(attempt.state)) reject('NATIVE-RECONCILE-CONFLICT');
      if (envelope.observed.target !== null) reject('NATIVE-EVIDENCE-SCOPE-MISMATCH');
      requireObservedLineage(
        attempt,
        envelope.observed.current_lineage,
        'structurally-complete-drift',
      );
      attempt.state = 'uncertain';
      delete attempt.handle;
      task.status = 'uncertain';
      delete task.handle;
      break;
    case 'running':
      requireObservedLineage(attempt, envelope.observed.current_lineage, 'exact-or-stricter');
      requireAuthoritativeLiveTarget(envelope, attempt);
      if (
        attempt.state !== 'uncertain' ||
        !attempt.handle_binding ||
        evidence.same_handle_evidence_record_ref !== attempt.handle_binding.evidence_record_ref ||
        envelope.observed.handle !== attempt.handle_binding.handle
      ) {
        reject('NATIVE-RECONCILE-CONFLICT');
      }
      attempt.state = 'running';
      attempt.handle = envelope.observed.handle;
      task.status = 'in_flight';
      task.handle = envelope.observed.handle;
      break;
    case 'terminal':
      requireObservedLineage(attempt, envelope.observed.current_lineage, 'exact-or-stricter');
      if (
        attempt.state !== 'uncertain' ||
        envelope.observed.target !== attempt.lineage?.expected_child_target ||
        !evidence.terminal
      ) {
        reject('NATIVE-RECONCILE-CONFLICT');
      }
      requireTerminalPayload({ ...evidence.terminal, observed_at: evidence.observed_at });
      attempt.state = 'terminal';
      attempt.terminal = {
        ...clone(evidence.terminal),
        observed_at: evidence.observed_at,
        evidence_record_ref: envelope.record_ref,
        evidence_hash: envelope.record_hash,
        source: envelope.observed.source,
      };
      attempt.finished_at = evidence.observed_at;
      delete attempt.handle;
      task.status = 'uncertain';
      delete task.handle;
      break;
    case 'orphaned': {
      if (attempt.state !== 'uncertain') reject('NATIVE-RECONCILE-CONFLICT');
      if (envelope.observed.target !== null) reject('NATIVE-EVIDENCE-SCOPE-MISMATCH');
      requireObservedLineage(attempt, envelope.observed.current_lineage, 'exact-or-stricter');
      const audit = evidence.orphan_audit;
      if (
        audit?.origin_session_status !== 'unavailable' ||
        audit?.handle_status !== 'unaddressable' ||
        audit?.worktree_authority !== 'fenced' ||
        audit?.account_authority !== 'unchanged' ||
        !isNonEmptyString(audit?.audit_ref) ||
        !SHA256_RE.test(audit?.audit_hash)
      ) {
        reject('NATIVE-ORPHAN-AUDIT-INCOMPLETE');
      }
      attempt.state = 'orphaned';
      attempt.orphan_audit = clone(audit);
      delete attempt.handle;
      task.status = 'ready';
      delete task.handle;
      task.status = expectedOrphanedTaskStatus(board, task);
      break;
    }
    default:
      reject('NATIVE-RECONCILE-CONFLICT');
  }
  records.push(normalizedRecord);
  attempt.reconciliation = records;
  return { ok: true, board, result: { reconciled: true, attempt_id: attempt.id } };
}

function nativeAttempts(task: JsonObject): JsonObject[] {
  if (!Array.isArray(task?.routing?.attempts)) return [];
  return task.routing.attempts.filter(
    (entry: JsonObject) =>
      entry?.schema === NATIVE_ATTEMPT_CONTRACT ||
      entry?.create_snapshot?.attempt?.schema === NATIVE_ATTEMPT_CONTRACT ||
      (isJsonObject(entry?.create_snapshot) && entry?.create_hash !== undefined),
  );
}

function terminalEvidenceAllowsDone(terminalEvidence: JsonObject | undefined): boolean {
  return Boolean(
    terminalEvidence &&
      TERMINAL_CLASSES.has(terminalEvidence.class) &&
      isUtcSecond(terminalEvidence.observed_at) &&
      isNonEmptyString(terminalEvidence.result_ref) &&
      Array.isArray(terminalEvidence.artifact_refs) &&
      terminalEvidence.artifact_refs.every(isNonEmptyString) &&
      isNonEmptyString(terminalEvidence.evidence_record_ref) &&
      SHA256_RE.test(terminalEvidence.evidence_hash),
  );
}

function createIdentityValid(task: JsonObject, attempt: JsonObject): boolean {
  const snapshot = attempt.create_snapshot;
  const frozen = snapshot?.attempt;
  try {
    if (
      !SHA256_RE.test(attempt.create_hash) ||
      attempt.create_hash !== createHashFor(snapshot) ||
      snapshot?.task_id !== task.id ||
      !frozen ||
      frozen.id !== attempt.id ||
      frozen.candidate_id !== attempt.candidate_id ||
      frozen.surface !== attempt.surface ||
      frozen.transport !== attempt.transport ||
      !same(frozen.dispatch, attempt.dispatch) ||
      !same(frozen.lineage, attempt.lineage) ||
      !same(frozen.selection_snapshot, attempt.selection_snapshot) ||
      !same(frozen.descriptor, attempt.descriptor) ||
      !same(snapshot.selection_snapshot, frozen.selection_snapshot)
    ) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

function projectionIssue(task: JsonObject, message: string, path: string): NativeAttemptIssue {
  return {
    code: 'NATIVE-ATTEMPT-PROJECTION-MISMATCH',
    path,
    message,
    task_id: typeof task.id === 'string' ? task.id : undefined,
  };
}

function expectedOrphanedTaskStatus(board: JsonObject, task: JsonObject): unknown {
  const candidate = clone(board);
  const candidateTask = Array.isArray(candidate.tasks)
    ? candidate.tasks.find((entry: JsonObject) => entry?.id === task.id)
    : undefined;
  if (!candidateTask) return 'ready';
  candidateTask.status = 'ready';
  const reconciled = reconcileGating(candidate);
  return Array.isArray(reconciled.tasks)
    ? reconciled.tasks.find((entry: JsonObject) => entry?.id === task.id)?.status
    : 'ready';
}

export function validateNativeAttemptProjection(inputBoard: JsonObject): NativeAttemptIssue[] {
  if (inputBoard?.meta?.contracts?.native_attempt !== NATIVE_ATTEMPT_CONTRACT) return [];
  const issues: NativeAttemptIssue[] = [];
  for (const task of Array.isArray(inputBoard.tasks) ? inputBoard.tasks : []) {
    const attempts = nativeAttempts(task);
    if (attempts.length === 0) continue;
    const dispatchKeys = new Set<string>();
    const dispatchIdentities = new Set<string>();
    const active = attempts.filter((entry) => ACTIVE_STATES.has(entry.state));
    if (active.length > 1) {
      issues.push(
        projectionIssue(task, 'at most one native attempt may be active', 'routing.attempts'),
      );
    }
    const latest = attempts.at(-1) as JsonObject;
    if (active.length > 0 && !ACTIVE_STATES.has(latest.state)) {
      issues.push(
        projectionIssue(
          task,
          'an older active native attempt cannot hide behind a later terminal/orphan attempt',
          'routing.attempts',
        ),
      );
    }
    for (const [index, current] of attempts.entries()) {
      try {
        requireStoredAttemptStructure(current, index + 1);
        requireInitialCreateAttempt(current.create_snapshot?.attempt, index + 1);
      } catch (error) {
        if (!(error instanceof NativeAttemptError)) throw error;
        issues.push(
          projectionIssue(
            task,
            `native record schema is invalid: ${error.code}`,
            error.path ?? 'routing.attempts',
          ),
        );
      }
      const dispatchKey = current.dispatch?.key;
      const dispatchIdentity = `${dispatchKey ?? ''}\0${current.dispatch?.request_hash ?? ''}`;
      if (
        !isNonEmptyString(dispatchKey) ||
        dispatchKeys.has(dispatchKey) ||
        dispatchIdentities.has(dispatchIdentity)
      ) {
        issues.push(
          projectionIssue(
            task,
            'native dispatch identity must be unique and structurally valid',
            'routing.attempts',
          ),
        );
      }
      if (isNonEmptyString(dispatchKey)) dispatchKeys.add(dispatchKey);
      dispatchIdentities.add(dispatchIdentity);
      const descriptor =
        NATIVE_ATTEMPT_DESCRIPTOR_REGISTRY[NATIVE_ATTEMPT_CONTRACT][
          current.candidate_id as 'codex-native'
        ];
      if (!descriptor || !same(current.descriptor, descriptor)) {
        issues.push(
          projectionIssue(task, 'native descriptor is absent or unsupported', 'routing.attempts'),
        );
      }
      if (!createIdentityValid(task, current)) {
        issues.push(
          projectionIssue(task, 'native create identity is absent or mutable', 'routing.attempts'),
        );
      }
    }
    const taskHasHandle = isNonEmptyString(task.handle);
    const attemptHasHandle = isNonEmptyString(latest.handle);
    switch (latest.state) {
      case 'starting':
        if (task.status !== 'ready' || taskHasHandle || attemptHasHandle) {
          issues.push(projectionIssue(task, 'starting requires ready with no handle', 'status'));
        }
        break;
      case 'running':
        if (
          task.status !== 'in_flight' ||
          !taskHasHandle ||
          task.handle !== latest.handle ||
          latest.handle_binding?.handle !== latest.handle ||
          !isNonEmptyString(latest.handle_binding?.evidence_record_ref) ||
          !SHA256_RE.test(latest.handle_binding?.evidence_hash)
        ) {
          issues.push(
            projectionIssue(
              task,
              'running requires in_flight and one authenticated identical handle',
              'status',
            ),
          );
        }
        break;
      case 'uncertain':
        if (task.status !== 'uncertain' || taskHasHandle || attemptHasHandle) {
          issues.push(
            projectionIssue(task, 'uncertain requires uncertain with no active handle', 'status'),
          );
        }
        break;
      case 'terminal':
        if (taskHasHandle || attemptHasHandle) {
          issues.push(projectionIssue(task, 'terminal cannot retain an active handle', 'handle'));
        }
        if (!terminalEvidenceAllowsDone(latest.terminal)) {
          issues.push(
            projectionIssue(task, 'terminal evidence is structurally invalid', 'routing.attempts'),
          );
        }
        if (
          task.status === 'in_flight' ||
          (task.status === 'done' &&
            (!terminalEvidenceAllowsDone(latest.terminal) || !taskTrulyDone(task)))
        ) {
          issues.push(
            projectionIssue(
              task,
              'done requires authenticated terminal evidence and ordinary true-done invariants',
              'status',
            ),
          );
        }
        break;
      case 'orphaned':
        if (
          task.status !== expectedOrphanedTaskStatus(inputBoard, task) ||
          taskHasHandle ||
          attemptHasHandle ||
          latest.orphan_audit?.origin_session_status !== 'unavailable' ||
          latest.orphan_audit?.handle_status !== 'unaddressable' ||
          latest.orphan_audit?.worktree_authority !== 'fenced' ||
          latest.orphan_audit?.account_authority !== 'unchanged' ||
          !isNonEmptyString(latest.orphan_audit?.audit_ref) ||
          !SHA256_RE.test(latest.orphan_audit?.audit_hash)
        ) {
          issues.push(
            projectionIssue(
              task,
              'orphaned requires dependency-gated ready/blocked with no handle',
              'status',
            ),
          );
        }
        break;
      default:
        issues.push(projectionIssue(task, 'unknown native attempt state', 'routing.attempts'));
    }
  }
  return issues;
}

export function validateNativeAttemptMutation(
  beforeBoard: JsonObject | null | undefined,
  afterBoard: JsonObject,
  writerKind: NativeAttemptWriterKind = 'generic',
  targetedTaskIds?: readonly string[],
): NativeAttemptIssue[] {
  const issues = validateNativeAttemptProjection(afterBoard);
  if (writerKind !== 'generic' && writerKind !== 'generic-state') return issues;
  const beforeTasks = new Map(
    (Array.isArray(beforeBoard?.tasks) ? beforeBoard.tasks : []).map((task: JsonObject) => [
      task?.id,
      task,
    ]),
  );
  const afterTasks = new Map(
    (Array.isArray(afterBoard?.tasks) ? afterBoard.tasks : []).map((task: JsonObject) => [
      task?.id,
      task,
    ]),
  );
  const intentTargets = targetedTaskIds ? new Set(targetedTaskIds) : undefined;
  for (const [taskId, beforeTask] of beforeTasks) {
    if (nativeAttempts(beforeTask).length > 0 && !afterTasks.has(taskId)) {
      issues.push({
        code: 'NATIVE-DEDICATED-WRITER-REQUIRED',
        path: 'tasks',
        message: 'generic writers cannot remove a task with native attempt history',
        task_id: typeof taskId === 'string' ? taskId : undefined,
      });
    }
  }
  const stateControlFields = [
    'status',
    'handle',
    'blocked_on',
    'blocked_reason',
    'decision_package',
    'started_at',
    'finished_at',
    'verified',
    'artifact',
  ];
  for (const afterTask of Array.isArray(afterBoard?.tasks) ? afterBoard.tasks : []) {
    const beforeTask = beforeTasks.get(afterTask?.id);
    if (!beforeTask) continue;
    const beforeAttempts = nativeAttempts(beforeTask);
    const afterAttempts = nativeAttempts(afterTask);
    if (beforeAttempts.length === 0 && afterAttempts.length === 0) continue;
    const beforeLatest = beforeAttempts.at(-1);
    const afterLatest = afterAttempts.at(-1);
    if (!same(beforeAttempts, afterAttempts)) {
      issues.push({
        code: 'NATIVE-DEDICATED-WRITER-REQUIRED',
        path: 'routing.attempts',
        message: 'generic writers cannot mutate the native attempt ledger',
        task_id: afterTask.id,
      });
    }
    const activeBoundary =
      ACTIVE_STATES.has(beforeLatest?.state) || ACTIVE_STATES.has(afterLatest?.state);
    if (
      activeBoundary &&
      ((writerKind === 'generic-state' &&
        (intentTargets === undefined || intentTargets.has(afterTask.id))) ||
        stateControlFields.some((field) => !same(beforeTask[field], afterTask[field])))
    ) {
      issues.push({
        code: 'NATIVE-DEDICATED-WRITER-REQUIRED',
        path: 'status',
        message:
          'generic writers cannot mutate state-control fields while a native attempt is active',
        task_id: afterTask.id,
      });
    }
    if (
      afterTask.status === 'done' &&
      afterLatest?.state === 'terminal' &&
      (!terminalEvidenceAllowsDone(afterLatest.terminal) || !taskTrulyDone(afterTask))
    ) {
      issues.push({
        code: 'NATIVE-PARENT-DONE-EVIDENCE-REQUIRED',
        path: 'status',
        message: 'parent done requires terminal evidence plus ordinary true-done invariants',
        task_id: afterTask.id,
      });
    }
  }
  return issues;
}

export function nativeAttemptApply(
  inputBoard: JsonObject,
  inputCommand: JsonObject,
): NativeAttemptApplyResult {
  const board = clone(inputBoard);
  const command = clone(inputCommand);
  try {
    requireContract(board);
    const preexistingProjectionIssues = validateNativeAttemptProjection(board);
    if (preexistingProjectionIssues.length > 0) {
      reject(
        'NATIVE-ATTEMPT-PROJECTION-MISMATCH',
        preexistingProjectionIssues[0]?.path ?? 'routing.attempts',
      );
    }
    let outcome: NativeAttemptApplyResult;
    switch (command.type) {
      case 'create':
        outcome = create(board, command);
        break;
      case 'bind':
        outcome = bind(board, command);
        break;
      case 'cancel':
        outcome = cancel(board, command);
        break;
      case 'terminal':
        outcome = terminal(board, command);
        break;
      case 'reconcile':
        outcome = reconcile(board, command);
        break;
      case 'route-bind':
        return reject('NATIVE-ROUTE-BIND-BYPASS');
      default:
        return reject('NATIVE-COMMAND-UNKNOWN', 'type');
    }
    const projectedIssues = validateNativeAttemptProjection(outcome.board);
    if (projectedIssues.length > 0) {
      reject('NATIVE-ATTEMPT-PROJECTION-MISMATCH', projectedIssues[0]?.path ?? 'routing.attempts');
    }
    return outcome;
  } catch (error) {
    if (!(error instanceof NativeAttemptError)) throw error;
    return {
      ok: false,
      board: clone(inputBoard),
      issues: [{ code: error.code, path: error.path, message: error.code }],
    };
  }
}

export function nativeAttemptFeatureDecision(input: JsonObject): JsonObject {
  const requiredOperations = ['spawn', 'list', 'wait', 'interrupt'];
  const observed = new Map(
    (Array.isArray(input.observations) ? input.observations : []).map((entry: JsonObject) => [
      entry.operation,
      entry,
    ]),
  );
  const allPresent = requiredOperations.every((operation) => observed.has(operation));
  const allLive = requiredOperations.every(
    (operation) => observed.get(operation)?.presence === 'observed',
  );
  const reasons: string[] = [];
  if (input.capture_kind === 'synthetic-contract-template') reasons.push('PROBE-SYNTHETIC-ONLY');
  if (input.capture_kind === 'version-only') reasons.push('PROBE-VERSION-NOT-CAPABILITY-EVIDENCE');
  if (!allPresent) reasons.push('PROBE-OPERATIONS-MISSING');
  if (
    input.capture_kind !== 'version-only' &&
    input.producer_trust !== 'verified-private-adapter'
  ) {
    reasons.push('PROBE-PRODUCER-UNVERIFIED');
  }
  const promotionEligible =
    input.capture_kind === 'sanitized-live-probe' &&
    input.producer_trust === 'verified-private-adapter' &&
    allPresent &&
    allLive;
  return {
    selection_status:
      input.capture_kind === 'synthetic-contract-template' && allPresent
        ? 'selected-for-contract-only'
        : promotionEligible
          ? 'selected-for-runtime'
          : 'unsupported',
    runtime_status: promotionEligible ? 'supported' : 'unsupported',
    promotion_eligible: promotionEligible,
    reason_codes: reasons,
  };
}
