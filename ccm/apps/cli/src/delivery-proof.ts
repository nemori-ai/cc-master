import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  canonicalJson,
  type DeliveryFacts,
  type DeliveryObservationFact,
  type Qualification,
  targetDelivered,
  taskTrulyDone,
} from '@ccm/engine';

const ONE_MIB = 1024 * 1024;
const ARTIFACT_ENTRY_LIMIT = 4096;
const OID_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const SHA256_RE = /^sha256:[a-f0-9]{64}$/;

type Board = Record<string, any>;
type Target = Record<string, any>;
type Task = Record<string, any>;

export interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type GitRunner = (repository: string, args: string[]) => GitResult;

export interface ProofOptions {
  now?: string;
  runGit?: GitRunner;
}

export type TargetInput =
  | { kind: 'git-ref'; ref: string; repository?: string }
  | { kind: 'artifact-set'; namespace: string };

export type AttestationInput =
  | { method: 'git-commit-contained'; candidate_commit: string }
  | {
      method: 'reviewed-reconciliation-contained';
      candidate_commit: string;
      integration_commit: string;
      attestation: string;
    }
  | {
      method: 'artifact-digest-contained';
      artifact: { logical_name: string; version: string; ref: string; digest: string };
    };

export interface AttestationResult {
  qualification: Qualification;
  delivery?: Record<string, any>;
}

export interface RefreshResult {
  board: Board;
  target: Target;
  revalidations: Array<{ task_id: string; qualification: Qualification }>;
}

interface KindedError extends Error {
  errKind?: string;
  diagnostic?: string;
}

function fail(message: string, errKind: string, diagnostic: string): never {
  const error = new Error(`${diagnostic}: ${message}`) as KindedError;
  error.errKind = errKind;
  error.diagnostic = diagnostic;
  throw error;
}

function nowOf(opts: ProofOptions): string {
  return opts.now ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function sha(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function defaultRunGit(repository: string, args: string[]): GitResult {
  const child = spawnSync('git', ['-C', repository, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_NO_LAZY_FETCH: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: child.status ?? 128,
    stdout: typeof child.stdout === 'string' ? child.stdout.trim() : '',
    stderr: typeof child.stderr === 'string' ? child.stderr.trim() : '',
  };
}

function runGit(opts: ProofOptions, repository: string, args: string[]): GitResult {
  return (opts.runGit ?? defaultRunGit)(repository, args);
}

function repositoryOf(board: Board, target: Target): string {
  const repository = target.repository;
  if (repository?.source === 'board.git.worktree') {
    const worktree = board.git?.worktree;
    if (typeof worktree !== 'string' || !worktree) {
      fail('board.git.worktree is unavailable', 'Validation', 'DELIVERY_REPOSITORY_UNAVAILABLE');
    }
    return worktree;
  }
  if (typeof repository?.worktree === 'string' && repository.worktree) {
    return repository.worktree;
  }
  fail('target repository is unavailable', 'Validation', 'DELIVERY_REPOSITORY_UNAVAILABLE');
}

function resolveCommit(repository: string, value: string, opts: ProofOptions): string | null {
  const result = runGit(opts, repository, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${value}^{commit}`,
  ]);
  const oid = result.stdout.split(/\s+/)[0] ?? '';
  return result.status === 0 && OID_RE.test(oid) ? oid : null;
}

function manifestPath(namespace: unknown): string | null {
  if (typeof namespace !== 'string' || !namespace.startsWith('file:')) return null;
  const value = namespace.slice('file:'.length);
  return value.startsWith('/') ? value : null;
}

function readBounded(
  path: string,
  unavailableDiagnostic = 'DELIVERY_ARTIFACT_UNAVAILABLE',
): Buffer {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(path);
  } catch {
    fail(`local file is unavailable: ${path}`, 'Validation', unavailableDiagnostic);
  }
  if (!stat.isFile() || stat.size > ONE_MIB) {
    fail(
      'local evidence file must be a regular file no larger than 1 MiB',
      'Validation',
      'DELIVERY_SIZE_CAP',
    );
  }
  return fs.readFileSync(path);
}

function readManifest(target: Target): { bytes: Buffer; entries: Record<string, unknown>[] } {
  const path = manifestPath(target.namespace);
  if (!path) {
    fail(
      'artifact-set namespace must be file:/absolute/path',
      'Validation',
      'FMT-DELIVERY-CONTRACT',
    );
  }
  const bytes = readBounded(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('artifact-set manifest is not valid JSON', 'Validation', 'DELIVERY_ARTIFACT_MALFORMED');
  }
  const manifest = parsed as { schema?: unknown; entries?: unknown };
  if (manifest?.schema !== 'ccm/artifact-set/v1' || !Array.isArray(manifest.entries)) {
    fail(
      'artifact-set manifest has the wrong schema or entries shape',
      'Validation',
      'DELIVERY_ARTIFACT_MALFORMED',
    );
  }
  if (manifest.entries.length > ARTIFACT_ENTRY_LIMIT) {
    fail(
      `artifact-set manifest exceeds ${ARTIFACT_ENTRY_LIMIT} entries`,
      'Validation',
      'DELIVERY_SIZE_CAP',
    );
  }
  const entries = manifest.entries.filter(
    (entry): entry is Record<string, unknown> =>
      !!entry && typeof entry === 'object' && !Array.isArray(entry),
  );
  if (entries.length !== manifest.entries.length) {
    fail('artifact-set entries must be objects', 'Validation', 'DELIVERY_ARTIFACT_MALFORMED');
  }
  return { bytes, entries };
}

export function resolveTargetDeclaration(
  board: Board,
  _targetId: string,
  input: TargetInput,
  opts: ProofOptions = {},
): Target {
  const observedAt = nowOf(opts);
  if (input.kind === 'git-ref') {
    if (!input.ref) fail('git target requires --ref', 'Usage', 'DELIVERY_TARGET_REF_REQUIRED');
    const target: Target = {
      kind: 'git-ref',
      repository: input.repository
        ? { worktree: input.repository }
        : { source: 'board.git.worktree' },
      ref: input.ref,
    };
    const repository = repositoryOf(board, target);
    const oid = resolveCommit(repository, input.ref, opts);
    if (!oid)
      fail(
        'target ref cannot be resolved from local objects',
        'Validation',
        'DELIVERY_TARGET_OBJECT_MISSING',
      );
    target.snapshot = { oid, observed_at: observedAt };
    return target;
  }
  const target: Target = { kind: 'artifact-set', namespace: input.namespace };
  const manifest = readManifest(target);
  target.snapshot = { digest: sha(manifest.bytes), observed_at: observedAt };
  return target;
}

function targetFact(
  board: Board,
  target: Target,
  opts: ProofOptions,
): NonNullable<DeliveryFacts['targets']>[string] {
  if (target.kind === 'git-ref') {
    let repository: string;
    try {
      repository = repositoryOf(board, target);
    } catch (error) {
      const diagnostic = (error as KindedError).diagnostic ?? 'DELIVERY_REPOSITORY_UNAVAILABLE';
      return { state: 'unknown', reason: diagnostic };
    }
    const oid = resolveCommit(repository, String(target.ref ?? ''), opts);
    if (!oid) return { state: 'unknown', reason: 'DELIVERY_TARGET_OBJECT_MISSING' };
    const resolved = { oid, observed_at: target.snapshot?.observed_at };
    return oid === target.snapshot?.oid
      ? { state: 'current', resolved_snapshot: resolved }
      : { state: 'drift', resolved_snapshot: resolved, reason: 'DELIVERY_TARGET_REF_DRIFT' };
  }
  if (target.kind === 'artifact-set') {
    try {
      const manifest = readManifest(target);
      const digest = sha(manifest.bytes);
      const resolved = { digest, observed_at: target.snapshot?.observed_at };
      return digest === target.snapshot?.digest
        ? { state: 'current', resolved_snapshot: resolved }
        : { state: 'drift', resolved_snapshot: resolved, reason: 'DELIVERY_TARGET_REF_DRIFT' };
    } catch (error) {
      return {
        state: 'unknown',
        reason: (error as KindedError).diagnostic ?? 'DELIVERY_ARTIFACT_UNAVAILABLE',
      };
    }
  }
  return { state: 'unknown', reason: 'FMT-DELIVERY-CONTRACT' };
}

function storedObservationFact(
  board: Board,
  task: Task,
  targetId: string,
  target: Target,
  opts: ProofOptions,
): DeliveryObservationFact | null {
  const candidate = task.delivery?.candidate;
  const observations = Array.isArray(task.delivery?.observations) ? task.delivery.observations : [];
  if (!candidate?.fingerprint) return null;
  const observation = [...observations].reverse().find((entry) => {
    if (
      !entry ||
      entry.target !== targetId ||
      entry.candidate_fingerprint !== candidate.fingerprint
    ) {
      return false;
    }
    return target.kind === 'git-ref'
      ? entry.target_snapshot?.oid === target.snapshot?.oid
      : entry.target_snapshot?.digest === target.snapshot?.digest;
  });
  if (!observation || observation.outcome !== 'delivered') return null;
  const id = typeof observation.id === 'string' ? observation.id : undefined;
  const proof = observation.proof;

  if (proof?.method === 'artifact-digest-contained') {
    try {
      const manifest = readManifest(target);
      const subject = candidate.subject;
      const artifact = subject?.kind === 'artifact' ? { ...subject } : null;
      if (!artifact) {
        return { state: 'unknown', observation_id: id, reason: 'DELIVERY_ARTIFACT_MALFORMED' };
      }
      delete artifact.kind;
      const match = manifest.entries.some(
        (entry) => canonicalJson(entry) === canonicalJson(artifact),
      );
      return match
        ? { state: 'delivered', observation_id: id }
        : {
            state: 'not-delivered',
            observation_id: id,
            reason: 'DELIVERY_ARTIFACT_DIGEST_MISMATCH',
          };
    } catch (error) {
      return {
        state: 'unknown',
        observation_id: id,
        reason: (error as KindedError).diagnostic ?? 'DELIVERY_ARTIFACT_UNAVAILABLE',
      };
    }
  }

  if (target.kind !== 'git-ref') {
    return { state: 'unknown', observation_id: id, reason: 'DELIVERY_TARGET_KIND_MISMATCH' };
  }
  if (proof?.method === 'reviewed-reconciliation-contained') {
    const attestationRef = typeof proof.attestation_ref === 'string' ? proof.attestation_ref : '';
    if (!path.isAbsolute(attestationRef)) {
      return {
        state: 'unknown',
        observation_id: id,
        reason: 'DELIVERY_REVIEW_ATTESTATION_UNAVAILABLE',
      };
    }
    let bytes: Buffer;
    try {
      bytes = readBounded(attestationRef, 'DELIVERY_REVIEW_ATTESTATION_UNAVAILABLE');
    } catch (error) {
      return {
        state: 'unknown',
        observation_id: id,
        reason: (error as KindedError).diagnostic ?? 'DELIVERY_REVIEW_ATTESTATION_UNAVAILABLE',
      };
    }
    if (sha(bytes) !== proof.attestation_digest) {
      return {
        state: 'unknown',
        observation_id: id,
        reason: 'DELIVERY_REVIEW_ATTESTATION_DIGEST_MISMATCH',
      };
    }
    let attestation: Record<string, unknown>;
    try {
      attestation = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
    } catch {
      return {
        state: 'unknown',
        observation_id: id,
        reason: 'DELIVERY_REVIEW_ATTESTATION_MALFORMED',
      };
    }
    if (attestation.verdict === 'REQUEST-CHANGES') {
      return {
        state: 'not-delivered',
        observation_id: id,
        reason: 'DELIVERY_REVIEW_REJECTED',
      };
    }
    const currentTargetOid = String(target.snapshot?.oid ?? '');
    const valid =
      attestation.schema === 'ccm/delivery-review-attestation/v1' &&
      attestation.verdict === 'APPROVE' &&
      attestation.candidate_fingerprint === candidate.fingerprint &&
      attestation.target_id === targetId &&
      attestation.target_snapshot_oid === currentTargetOid &&
      attestation.integration_commit_oid === proof.integration_commit &&
      attestation.reviewed_base_oid === proof.reviewed_base_oid;
    if (!valid) {
      return {
        state: 'unknown',
        observation_id: id,
        reason: 'DELIVERY_REVIEW_BINDING_STALE',
      };
    }
  }
  let repository: string;
  try {
    repository = repositoryOf(board, target);
  } catch (error) {
    return {
      state: 'unknown',
      observation_id: id,
      reason: (error as KindedError).diagnostic ?? 'DELIVERY_REPOSITORY_UNAVAILABLE',
    };
  }
  const subjectOid =
    proof?.method === 'reviewed-reconciliation-contained'
      ? String(proof.integration_commit ?? '')
      : String(proof?.candidate_commit ?? '');
  const commit = resolveCommit(repository, subjectOid, opts);
  const targetOid = resolveCommit(repository, String(target.snapshot?.oid ?? ''), opts);
  if (!commit) {
    return {
      state: 'unknown',
      observation_id: id,
      reason:
        proof?.method === 'reviewed-reconciliation-contained'
          ? 'DELIVERY_INTEGRATION_OBJECT_MISSING'
          : 'DELIVERY_CANDIDATE_OBJECT_MISSING',
    };
  }
  if (!targetOid) {
    return { state: 'unknown', observation_id: id, reason: 'DELIVERY_TARGET_OBJECT_MISSING' };
  }
  const containment = runGit(opts, repository, ['merge-base', '--is-ancestor', commit, targetOid]);
  if (containment.status === 0) return { state: 'delivered', observation_id: id };
  return containment.status === 1
    ? { state: 'not-delivered', observation_id: id, reason: 'DELIVERY_COMMIT_NOT_CONTAINED' }
    : { state: 'unknown', observation_id: id, reason: 'DELIVERY_CONTAINMENT_UNKNOWN' };
}

export function resolveDeliveryFacts(board: Board, opts: ProofOptions = {}): DeliveryFacts {
  const targets = board.delivery_contract?.targets;
  const facts: DeliveryFacts = { targets: {}, observations: {}, now: nowOf(opts) };
  if (!targets || typeof targets !== 'object' || Array.isArray(targets)) return facts;
  for (const [id, target] of Object.entries(targets)) {
    facts.targets![id] = targetFact(board, target as Target, opts);
  }
  for (const task of Array.isArray(board.tasks) ? board.tasks : []) {
    if (!task?.id || !task.delivery) continue;
    for (const [targetId, target] of Object.entries(targets)) {
      if (facts.targets?.[targetId]?.state !== 'current') continue;
      const observation = storedObservationFact(board, task, targetId, target as Target, opts);
      if (!observation) continue;
      const taskFacts = facts.observations![String(task.id)] ?? {};
      facts.observations![String(task.id)] = taskFacts;
      taskFacts[targetId] = observation;
    }
  }
  return facts;
}

function taskOf(board: Board, id: string): Task {
  const task = Array.isArray(board.tasks)
    ? board.tasks.find((entry: Task) => entry?.id === id)
    : null;
  if (!task) fail(`task ${id} not found`, 'NotFound', 'DELIVERY_TASK_NOT_FOUND');
  return task;
}

function targetOf(board: Board, id: string): Target {
  const target = board.delivery_contract?.targets?.[id];
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    fail(`delivery target ${id} not found`, 'NotFound', 'DELIVERY_TARGET_NOT_FOUND');
  }
  return target;
}

function qualification(
  state: Qualification['state'],
  code: string,
  message: string,
  targetId: string,
): Qualification {
  return {
    state,
    basis: 'delivery',
    candidate_complete: true,
    target_delivered: false,
    target_id: targetId,
    reasons: [{ code, message }],
  };
}

function exactArtifact(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.logical_name === 'string' &&
    !!entry.logical_name &&
    typeof entry.version === 'string' &&
    !!entry.version &&
    typeof entry.ref === 'string' &&
    !!entry.ref &&
    typeof entry.digest === 'string' &&
    SHA256_RE.test(entry.digest)
  );
}

function makeCandidate(task: Task, subject: Record<string, unknown>): Record<string, unknown> {
  const binding = {
    task_id: task.id,
    bound_finished_at: task.finished_at,
    bound_artifact: task.artifact,
    subject,
  };
  return {
    fingerprint: sha(canonicalJson(binding)),
    bound_finished_at: task.finished_at,
    bound_artifact: structuredClone(task.artifact),
    subject,
  };
}

function observationId(observation: Record<string, unknown>): string {
  return `D-${sha(canonicalJson(observation)).slice('sha256:'.length, 'sha256:'.length + 20)}`;
}

function deliveredResult(
  board: Board,
  task: Task,
  targetId: string,
  candidate: Record<string, unknown>,
  proof: Record<string, unknown>,
  opts: ProofOptions,
): AttestationResult {
  const target = targetOf(board, targetId);
  const snapshot =
    target.kind === 'git-ref' ? { oid: target.snapshot.oid } : { digest: target.snapshot.digest };
  const body: Record<string, unknown> = {
    target: targetId,
    candidate_fingerprint: candidate.fingerprint,
    target_snapshot: snapshot,
    outcome: 'delivered',
    proof,
    checked_at: nowOf(opts),
  };
  const observation = { id: observationId(body), ...body };
  const existing =
    task.delivery?.candidate?.fingerprint === candidate.fingerprint &&
    Array.isArray(task.delivery?.observations)
      ? task.delivery.observations
      : [];
  const delivery = {
    schema: 'ccm/task-delivery/v1',
    candidate,
    observations: [...existing, observation],
  };
  const shadow = structuredClone(board);
  taskOf(shadow, String(task.id)).delivery = delivery;
  const facts = resolveDeliveryFacts(shadow, opts);
  return {
    qualification: targetDelivered(shadow, taskOf(shadow, String(task.id)), targetId, facts),
    delivery,
  };
}

export function attestDelivery(
  board: Board,
  taskId: string,
  targetId: string,
  input: AttestationInput,
  opts: ProofOptions = {},
): AttestationResult {
  const task = taskOf(board, taskId);
  const target = targetOf(board, targetId);
  if (!taskTrulyDone(task)) {
    return {
      qualification: {
        state: 'unqualified',
        basis: 'delivery',
        candidate_complete: false,
        target_delivered: false,
        target_id: targetId,
        reasons: [
          { code: 'DELIVERY_CANDIDATE_INCOMPLETE', message: 'task is not candidate-complete' },
        ],
      },
    };
  }
  const fact = targetFact(board, target, opts);
  if (fact.state !== 'current') {
    return {
      qualification: qualification(
        'unknown',
        fact.reason ?? 'DELIVERY_TARGET_UNAVAILABLE',
        'target snapshot is not current and locally verifiable',
        targetId,
      ),
    };
  }

  if (input.method === 'artifact-digest-contained') {
    if (target.kind !== 'artifact-set' || !exactArtifact(input.artifact)) {
      return {
        qualification: qualification(
          'unknown',
          'DELIVERY_ARTIFACT_MALFORMED',
          'artifact subject or target is malformed',
          targetId,
        ),
      };
    }
    const manifest = readManifest(target);
    const match = manifest.entries.some(
      (entry) => canonicalJson(entry) === canonicalJson(input.artifact),
    );
    if (!match) {
      return {
        qualification: qualification(
          'unqualified',
          'DELIVERY_ARTIFACT_DIGEST_MISMATCH',
          'exact immutable artifact entry is not present',
          targetId,
        ),
      };
    }
    const candidate = makeCandidate(task, { kind: 'artifact', ...input.artifact });
    return deliveredResult(
      board,
      task,
      targetId,
      candidate,
      {
        method: input.method,
        manifest_digest: target.snapshot.digest,
        artifact: input.artifact,
      },
      opts,
    );
  }

  if (target.kind !== 'git-ref') {
    return {
      qualification: qualification(
        'unknown',
        'DELIVERY_TARGET_KIND_MISMATCH',
        'git proof requires a git-ref target',
        targetId,
      ),
    };
  }
  const repository = repositoryOf(board, target);
  const candidateOid = resolveCommit(repository, input.candidate_commit, opts);
  if (!candidateOid) {
    return {
      qualification: qualification(
        'unknown',
        'DELIVERY_CANDIDATE_OBJECT_MISSING',
        'candidate commit is unavailable locally',
        targetId,
      ),
    };
  }
  const candidate = makeCandidate(task, { kind: 'git-commit', commit_oid: candidateOid });
  const targetOid = String(target.snapshot.oid);

  if (input.method === 'reviewed-reconciliation-contained') {
    const integrationOid = resolveCommit(repository, input.integration_commit, opts);
    if (!integrationOid) {
      return {
        qualification: qualification(
          'unknown',
          'DELIVERY_INTEGRATION_OBJECT_MISSING',
          'integration commit is unavailable locally',
          targetId,
        ),
      };
    }
    const containment = runGit(opts, repository, [
      'merge-base',
      '--is-ancestor',
      integrationOid,
      targetOid,
    ]);
    if (containment.status !== 0) {
      return {
        qualification: qualification(
          containment.status === 1 ? 'unqualified' : 'unknown',
          containment.status === 1
            ? 'DELIVERY_COMMIT_NOT_CONTAINED'
            : 'DELIVERY_CONTAINMENT_UNKNOWN',
          'integration commit is not proven contained in the target snapshot',
          targetId,
        ),
      };
    }
    if (!path.isAbsolute(input.attestation)) {
      fail(
        'review attestation must use a stable absolute local path',
        'Usage',
        'DELIVERY_REVIEW_ATTESTATION_ABSOLUTE_REQUIRED',
      );
    }
    const bytes = readBounded(input.attestation, 'DELIVERY_REVIEW_ATTESTATION_UNAVAILABLE');
    let attestation: Record<string, unknown>;
    try {
      attestation = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
    } catch {
      return {
        qualification: qualification(
          'unknown',
          'DELIVERY_REVIEW_ATTESTATION_MALFORMED',
          'review attestation is not valid JSON',
          targetId,
        ),
      };
    }
    if (attestation.verdict === 'REQUEST-CHANGES') {
      return {
        qualification: qualification(
          'unqualified',
          'DELIVERY_REVIEW_REJECTED',
          'review attestation rejected the reconciliation',
          targetId,
        ),
      };
    }
    const valid =
      attestation.schema === 'ccm/delivery-review-attestation/v1' &&
      attestation.verdict === 'APPROVE' &&
      attestation.candidate_fingerprint === candidate.fingerprint &&
      attestation.target_id === targetId &&
      attestation.target_snapshot_oid === targetOid &&
      attestation.integration_commit_oid === integrationOid &&
      OID_RE.test(String(attestation.reviewed_base_oid ?? ''));
    if (!valid) {
      return {
        qualification: qualification(
          'unknown',
          'DELIVERY_REVIEW_BINDING_STALE',
          'review attestation does not bind all current immutable facts',
          targetId,
        ),
      };
    }
    return deliveredResult(
      board,
      task,
      targetId,
      candidate,
      {
        method: input.method,
        integration_commit: integrationOid,
        target_oid: targetOid,
        reviewed_base_oid: attestation.reviewed_base_oid,
        attestation_digest: sha(bytes),
        attestation_ref: input.attestation,
      },
      opts,
    );
  }

  const containment = runGit(opts, repository, [
    'merge-base',
    '--is-ancestor',
    candidateOid,
    targetOid,
  ]);
  if (containment.status !== 0) {
    return {
      qualification: qualification(
        containment.status === 1 ? 'unqualified' : 'unknown',
        containment.status === 1 ? 'DELIVERY_COMMIT_NOT_CONTAINED' : 'DELIVERY_CONTAINMENT_UNKNOWN',
        'candidate commit is not proven contained in the target snapshot',
        targetId,
      ),
    };
  }
  return deliveredResult(
    board,
    task,
    targetId,
    candidate,
    {
      method: input.method,
      candidate_commit: candidateOid,
      target_oid: targetOid,
    },
    opts,
  );
}

function appendFailedRevalidation(
  task: Task,
  targetId: string,
  target: Target,
  qualificationValue: Qualification,
  sourceMethod: string,
  opts: ProofOptions,
): void {
  if (!task.delivery?.candidate || !Array.isArray(task.delivery.observations)) return;
  if (task.delivery.observations.length >= 128) {
    fail('delivery observations reached the v1 cap', 'Validation', 'DELIVERY_SIZE_CAP');
  }
  const snapshot =
    target.kind === 'git-ref' ? { oid: target.snapshot.oid } : { digest: target.snapshot.digest };
  const body: Record<string, unknown> = {
    target: targetId,
    candidate_fingerprint: task.delivery.candidate.fingerprint,
    target_snapshot: snapshot,
    outcome: qualificationValue.state === 'unqualified' ? 'not-delivered' : 'unknown',
    diagnostic: qualificationValue.reasons[0]?.code ?? 'DELIVERY_EQUIVALENCE_UNPROVEN',
    proof: { method: 'target-refresh-revalidation', source_method: sourceMethod },
    checked_at: nowOf(opts),
  };
  task.delivery.observations.push({ id: observationId(body), ...body });
}

export function refreshDeliveryTarget(
  board: Board,
  targetId: string,
  opts: ProofOptions = {},
): RefreshResult {
  const existing = targetOf(board, targetId);
  const input: TargetInput =
    existing.kind === 'git-ref'
      ? {
          kind: 'git-ref',
          ref: String(existing.ref),
          ...(typeof existing.repository?.worktree === 'string'
            ? { repository: existing.repository.worktree }
            : {}),
        }
      : { kind: 'artifact-set', namespace: String(existing.namespace) };
  const target = resolveTargetDeclaration(board, targetId, input, opts);
  const next = structuredClone(board);
  next.delivery_contract.targets[targetId] = target;
  const revalidations: RefreshResult['revalidations'] = [];

  for (const task of Array.isArray(next.tasks) ? next.tasks : []) {
    if (!task?.delivery?.candidate || !Array.isArray(task.delivery.observations)) continue;
    const prior = [...task.delivery.observations]
      .reverse()
      .find(
        (observation) =>
          observation?.target === targetId &&
          [
            'git-commit-contained',
            'artifact-digest-contained',
            'reviewed-reconciliation-contained',
          ].includes(String(observation?.proof?.method ?? '')),
      );
    if (!prior) continue;
    const subject = task.delivery.candidate.subject;
    let result: AttestationResult;
    if (prior.proof?.method === 'git-commit-contained' && subject?.kind === 'git-commit') {
      result = attestDelivery(
        next,
        String(task.id),
        targetId,
        { method: 'git-commit-contained', candidate_commit: String(subject.commit_oid) },
        opts,
      );
    } else if (
      prior.proof?.method === 'artifact-digest-contained' &&
      subject?.kind === 'artifact'
    ) {
      const { kind: _kind, ...artifact } = subject;
      result = attestDelivery(
        next,
        String(task.id),
        targetId,
        { method: 'artifact-digest-contained', artifact } as AttestationInput,
        opts,
      );
    } else {
      result = {
        qualification: qualification(
          'unknown',
          'DELIVERY_REVIEW_BINDING_STALE',
          'reviewed reconciliation attestation binds the prior target snapshot and must be renewed',
          targetId,
        ),
      };
    }
    if (result.delivery) task.delivery = result.delivery;
    else
      appendFailedRevalidation(
        task,
        targetId,
        target,
        result.qualification,
        String(prior.proof.method),
        opts,
      );
    revalidations.push({ task_id: String(task.id), qualification: result.qualification });
  }
  return { board: next, target, revalidations };
}
