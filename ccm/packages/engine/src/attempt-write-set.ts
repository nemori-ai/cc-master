// Managed cross-harness attempt write-set contract.
//
// This module is deliberately pure: callers resolve filesystem facts and probe writability, then
// this compiler either returns a narrow, immutable authorization plan or no usable roots at all.

import { posix as path } from 'node:path';
import type { ContractIssue } from './routing-contract.js';

export const WORKTREE_WRITE_LEASE = 'ccm/worktree-write-lease/v1';
export const ATTEMPT_WRITE_SET_REQUEST = 'ccm/attempt-write-set-request/v1';
export const ATTEMPT_WRITE_SET = 'ccm/attempt-write-set/v1';

const ATTEMPT_DENY_FLOOR = Object.freeze([
  'account-mutation',
  'credential-read',
  'network',
  'push-remote',
  'pr-create',
  'merge',
  'release',
] as const);
export const REQUIRED_ATTEMPT_DENIES: readonly string[] = Object.freeze([...ATTEMPT_DENY_FLOOR]);
export const UNDECLARED_PATH_DENY = 'undeclared-path';

export type ManagedWriteProfileId = 'codex-managed-workspace' | 'claude-managed-workspace';
export type PathResolution = 'resolved' | 'symlink' | 'escape' | 'missing' | 'not-a-worktree';
export type ArtifactMode = 'read-only' | 'read-write';

export interface ManagedWriteProfile {
  provider: 'openai' | 'anthropic';
  adapter: string;
  effective_profile: 'workspace-write';
  runtime_status: 'fixture-only';
  denies: readonly string[];
}

export const MANAGED_WRITE_PROFILES: Readonly<Record<ManagedWriteProfileId, ManagedWriteProfile>> =
  Object.freeze({
    'codex-managed-workspace': Object.freeze({
      provider: 'openai',
      adapter: 'codex/managed-workspace-roots/v1',
      effective_profile: 'workspace-write',
      runtime_status: 'fixture-only',
      denies: Object.freeze([...ATTEMPT_DENY_FLOOR]),
    }),
    'claude-managed-workspace': Object.freeze({
      provider: 'anthropic',
      adapter: 'claude-code/managed-workspace-roots/v1',
      effective_profile: 'workspace-write',
      runtime_status: 'fixture-only',
      denies: Object.freeze([...ATTEMPT_DENY_FLOOR]),
    }),
  });

export interface WorktreeWriteLease {
  schema: typeof WORKTREE_WRITE_LEASE;
  lease_ref: string;
  worktree_root: string;
  baseline_commit: string;
  artifact_write_roots: string[];
  artifact_read_roots?: string[];
}

export interface GitLayoutFacts {
  kind: 'linked-worktree' | 'main-worktree' | 'unknown';
  resolution: PathResolution;
  dot_git_file?: string;
  git_dir?: string;
  common_dir?: string;
  objects_dir?: string;
  refs_dir?: string;
  logs_dir?: string;
}

export interface DeclaredArtifactRoot {
  path: string;
  mode: ArtifactMode;
  purpose?: string;
  resolution: Exclude<PathResolution, 'not-a-worktree'>;
}

export interface WritabilityFact {
  path: string;
  writable: boolean | null;
}

export interface WriteSetRequest {
  schema: typeof ATTEMPT_WRITE_SET_REQUEST;
  profile: ManagedWriteProfileId | string;
  lease: WorktreeWriteLease;
  git_layout: GitLayoutFacts;
  declared_artifact_roots: DeclaredArtifactRoot[];
  writability: WritabilityFact[];
  requested_writes?: string[];
}

export type WriteReason =
  | 'worktree-content'
  | 'git-worktree-metadata'
  | 'git-common-objects'
  | 'git-common-refs'
  | 'git-common-logs'
  | 'declared-artifact-root';

export interface WriteSetAuthorization {
  readonly path: string;
  readonly mode: ArtifactMode;
  readonly scope: 'tree';
  readonly reason: WriteReason;
}

export interface ManagedProfilePlan {
  readonly id: ManagedWriteProfileId | string;
  readonly provider: string | null;
  readonly adapter: string | null;
  readonly effective_profile: 'workspace-write' | null;
  readonly runtime_status: 'fixture-only' | 'unknown';
  readonly writable_roots: readonly string[];
  readonly read_only_roots: readonly string[];
  readonly denies: readonly string[];
}

export interface AttemptPermissionSnapshot {
  readonly ref: null;
  readonly profile: 'workspace-write' | null;
  readonly writable_roots: readonly string[];
  readonly read_only_roots: readonly string[];
  readonly denies: readonly string[];
}

export interface WriteSetPlan {
  readonly schema: typeof ATTEMPT_WRITE_SET;
  readonly ok: boolean;
  readonly launch_ready: false;
  readonly integration_status: 'preflight-only-dispatcher-missing';
  readonly lease_ref: string | null;
  readonly authorized: readonly WriteSetAuthorization[];
  readonly profile_plan: ManagedProfilePlan;
  readonly permission_snapshot: AttemptPermissionSnapshot;
  readonly issues: readonly ContractIssue[];
}

export interface WriteSetProbePreparation {
  readonly ok: boolean;
  readonly probe_roots: readonly string[];
  readonly issues: readonly ContractIssue[];
}

interface RecordLike {
  [key: string]: unknown;
}

function record(value: unknown): value is RecordLike {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function issue(code: string, issuePath: string, message: string): ContractIssue {
  return { code, path: issuePath, message };
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalAbsolute(value: unknown): value is string {
  return nonEmpty(value) && path.isAbsolute(value) && path.resolve(value) === value;
}

function within(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function intersects(left: string, right: string): boolean {
  return within(left, right) || within(right, left);
}

function exactlyOneOf(candidate: string, roots: string[]): boolean {
  return roots.some((root) => within(root, candidate));
}

function emptyProfile(id: string): ManagedProfilePlan {
  return {
    id,
    provider: null,
    adapter: null,
    effective_profile: null,
    runtime_status: 'unknown',
    writable_roots: [],
    read_only_roots: [],
    denies: [...ATTEMPT_DENY_FLOOR, UNDECLARED_PATH_DENY],
  };
}

function refused(input: unknown, issues: ContractIssue[]): WriteSetPlan {
  const rawProfile = record(input) && nonEmpty(input.profile) ? input.profile : 'unknown';
  const leaseValue = record(input) && record(input.lease) ? input.lease : undefined;
  const leaseRef = leaseValue && nonEmpty(leaseValue.lease_ref) ? leaseValue.lease_ref : null;
  const known = MANAGED_WRITE_PROFILES[rawProfile as ManagedWriteProfileId];
  const profile: ManagedProfilePlan = known
    ? {
        id: rawProfile,
        provider: known.provider,
        adapter: known.adapter,
        effective_profile: known.effective_profile,
        runtime_status: known.runtime_status,
        writable_roots: [],
        read_only_roots: [],
        denies: [...ATTEMPT_DENY_FLOOR, UNDECLARED_PATH_DENY],
      }
    : emptyProfile(rawProfile);
  return deepFreeze({
    schema: ATTEMPT_WRITE_SET,
    ok: false,
    launch_ready: false,
    integration_status: 'preflight-only-dispatcher-missing',
    lease_ref: leaseRef,
    authorized: [],
    profile_plan: profile,
    permission_snapshot: {
      ref: null,
      profile: profile.effective_profile,
      writable_roots: [],
      read_only_roots: [],
      denies: [...profile.denies],
    },
    issues,
  });
}

export function isWorktreeWriteLease(value: unknown): value is WorktreeWriteLease {
  if (
    !(
      record(value) &&
      value.schema === WORKTREE_WRITE_LEASE &&
      nonEmpty(value.lease_ref) &&
      canonicalAbsolute(value.worktree_root) &&
      nonEmpty(value.baseline_commit) &&
      /^[0-9a-f]{40}$/i.test(value.baseline_commit) &&
      Array.isArray(value.artifact_write_roots) &&
      value.artifact_write_roots.every(canonicalAbsolute) &&
      (value.artifact_read_roots === undefined ||
        (Array.isArray(value.artifact_read_roots) &&
          value.artifact_read_roots.every(canonicalAbsolute)))
    )
  ) {
    return false;
  }
  const grants = [...value.artifact_write_roots, ...(value.artifact_read_roots ?? [])] as string[];
  for (let left = 0; left < grants.length; left += 1) {
    for (let right = left + 1; right < grants.length; right += 1) {
      if (intersects(grants[left]!, grants[right]!)) return false;
    }
  }
  return true;
}

function validateLease(value: unknown, issues: ContractIssue[]): WorktreeWriteLease | null {
  if (!isWorktreeWriteLease(value)) {
    issues.push(issue('WRITESET-LEASE', 'lease', `must conform to ${WORKTREE_WRITE_LEASE}`));
    return null;
  }
  return value;
}

function validateLayout(
  value: unknown,
  lease: WorktreeWriteLease | null,
  issues: ContractIssue[],
): GitLayoutFacts | null {
  if (!record(value) || !nonEmpty(value.resolution) || !nonEmpty(value.kind)) {
    issues.push(
      issue('WRITESET-GIT-LAYOUT-NOT-WORKTREE', 'git_layout', 'layout facts are missing'),
    );
    return null;
  }
  const resolution = value.resolution;
  if (resolution !== 'resolved') {
    const code =
      resolution === 'symlink'
        ? 'WRITESET-GIT-LAYOUT-SYMLINK'
        : resolution === 'escape'
          ? 'WRITESET-GIT-LAYOUT-ESCAPE'
          : resolution === 'missing'
            ? 'WRITESET-GIT-LAYOUT-MISSING'
            : 'WRITESET-GIT-LAYOUT-NOT-WORKTREE';
    issues.push(issue(code, 'git_layout.resolution', `layout resolution is ${String(resolution)}`));
    return null;
  }
  if (value.kind !== 'linked-worktree') {
    issues.push(
      issue(
        'WRITESET-WORKTREE-NOT-ISOLATED',
        'git_layout.kind',
        'managed writes require an isolated linked worktree',
      ),
    );
    return null;
  }

  const fields = [
    'dot_git_file',
    'git_dir',
    'common_dir',
    'objects_dir',
    'refs_dir',
    'logs_dir',
  ] as const;
  if (fields.some((field) => !canonicalAbsolute(value[field]))) {
    issues.push(
      issue(
        'WRITESET-GIT-LAYOUT-ESCAPE',
        'git_layout',
        'layout paths must be canonical absolute paths',
      ),
    );
    return null;
  }
  const dotGitFile = value.dot_git_file as string;
  const gitDir = value.git_dir as string;
  const commonDir = value.common_dir as string;
  const objectsDir = value.objects_dir as string;
  const refsDir = value.refs_dir as string;
  const logsDir = value.logs_dir as string;
  const adminParent = path.join(commonDir, 'worktrees');
  const coherent =
    !!lease &&
    dotGitFile === path.join(lease.worktree_root, '.git') &&
    path.dirname(gitDir) === adminParent &&
    gitDir !== adminParent &&
    objectsDir === path.join(commonDir, 'objects') &&
    refsDir === path.join(commonDir, 'refs') &&
    logsDir === path.join(commonDir, 'logs') &&
    !within(lease.worktree_root, commonDir);
  if (!coherent) {
    issues.push(
      issue('WRITESET-GIT-LAYOUT-ESCAPE', 'git_layout', 'linked-worktree layout is incoherent'),
    );
    return null;
  }
  return value as unknown as GitLayoutFacts;
}

function validateLeaseGrantBoundaries(
  lease: WorktreeWriteLease | null,
  layout: GitLayoutFacts | null,
  issues: ContractIssue[],
): void {
  if (!lease || !layout?.common_dir) return;
  const groups = [
    ['artifact_write_roots', lease.artifact_write_roots],
    ['artifact_read_roots', lease.artifact_read_roots ?? []],
  ] as const;
  for (const [field, roots] of groups) {
    roots.forEach((root, index) => {
      if (intersects(layout.common_dir!, root)) {
        issues.push(
          issue(
            'WRITESET-ARTIFACT-GIT-METADATA',
            `lease.${field}[${index}]`,
            'artifact lease grant overlaps Git metadata',
          ),
        );
      }
      if (within(root, lease.worktree_root)) {
        issues.push(
          issue(
            'WRITESET-ARTIFACT-WORKTREE-BOUNDARY',
            `lease.${field}[${index}]`,
            'artifact lease grant widens over the worktree boundary',
          ),
        );
      }
    });
  }
}

function validateArtifacts(
  value: unknown,
  lease: WorktreeWriteLease | null,
  layout: GitLayoutFacts | null,
  issues: ContractIssue[],
): DeclaredArtifactRoot[] {
  if (!Array.isArray(value)) {
    issues.push(
      issue('WRITESET-ARTIFACT-ROOT-MISSING', 'declared_artifact_roots', 'must be an array'),
    );
    return [];
  }
  const accepted: DeclaredArtifactRoot[] = [];
  const seen = new Set<string>();
  const leaseWrite = lease?.artifact_write_roots ?? [];
  const leaseRead = lease?.artifact_read_roots ?? [];
  for (let index = 0; index < value.length; index += 1) {
    const root = value[index];
    const base = `declared_artifact_roots[${index}]`;
    if (
      !record(root) ||
      !canonicalAbsolute(root.path) ||
      !['read-only', 'read-write'].includes(String(root.mode))
    ) {
      issues.push(issue('WRITESET-ARTIFACT-ROOT-MISSING', base, 'artifact root shape is invalid'));
      continue;
    }
    if (root.resolution !== 'resolved') {
      const suffix = String(root.resolution).toUpperCase().replaceAll('-', '_');
      issues.push(
        issue(
          `WRITESET-ARTIFACT-ROOT-${suffix}`,
          `${base}.resolution`,
          'artifact root did not resolve safely',
        ),
      );
      continue;
    }
    if (seen.has(root.path)) {
      issues.push(issue('WRITESET-ROOT-DUPLICATE', `${base}.path`, 'artifact root is duplicated'));
      continue;
    }
    seen.add(root.path);
    const allowedRoots = root.mode === 'read-write' ? leaseWrite : [...leaseWrite, ...leaseRead];
    if (!exactlyOneOf(root.path, allowedRoots)) {
      issues.push(
        issue(
          'WRITESET-ARTIFACT-OUTSIDE-LEASE',
          `${base}.path`,
          'artifact root is not in the lease',
        ),
      );
    }
    if (layout?.common_dir && intersects(layout.common_dir, root.path)) {
      issues.push(
        issue(
          'WRITESET-ARTIFACT-GIT-METADATA',
          `${base}.path`,
          'artifact root overlaps Git metadata',
        ),
      );
    }
    if (lease && within(root.path, lease.worktree_root)) {
      issues.push(
        issue(
          'WRITESET-ARTIFACT-WORKTREE-BOUNDARY',
          `${base}.path`,
          'artifact root widens over the worktree boundary',
        ),
      );
    }
    accepted.push(root as unknown as DeclaredArtifactRoot);
  }
  return accepted;
}

function validateWritability(
  value: unknown,
  requiredRoots: string[],
  issues: ContractIssue[],
): Map<string, boolean | null> {
  const facts = new Map<string, boolean | null>();
  if (!Array.isArray(value)) {
    issues.push(
      issue('WRITESET-PATH-NOT-WRITABLE', 'writability', 'writability facts are missing'),
    );
    return facts;
  }
  for (let index = 0; index < value.length; index += 1) {
    const fact = value[index];
    if (
      !record(fact) ||
      !canonicalAbsolute(fact.path) ||
      ![true, false, null].includes(fact.writable as never)
    ) {
      issues.push(
        issue('WRITESET-PATH-NOT-WRITABLE', `writability[${index}]`, 'writability fact is invalid'),
      );
      continue;
    }
    if (facts.has(fact.path) && facts.get(fact.path) !== fact.writable) {
      issues.push(
        issue(
          'WRITESET-WRITABILITY-CONFLICT',
          `writability[${index}]`,
          'conflicting writability facts',
        ),
      );
    }
    facts.set(fact.path, fact.writable as boolean | null);
  }
  for (const root of requiredRoots) {
    if (facts.get(root) !== true) {
      issues.push(
        issue('WRITESET-PATH-NOT-WRITABLE', root, 'required root is not demonstrably writable'),
      );
    }
  }
  return facts;
}

function validateRequestedWrites(value: unknown, roots: string[], issues: ContractIssue[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push(issue('WRITESET-UNDECLARED-WRITE', 'requested_writes', 'must be an array'));
    return;
  }
  for (let index = 0; index < value.length; index += 1) {
    const candidate = value[index];
    if (!canonicalAbsolute(candidate) || !exactlyOneOf(candidate, roots)) {
      issues.push(
        issue(
          'WRITESET-UNDECLARED-WRITE',
          `requested_writes[${index}]`,
          'write is outside authorized roots',
        ),
      );
    }
  }
}

interface WriteSetStructure {
  profileId: string;
  profile: ManagedWriteProfile | undefined;
  lease: WorktreeWriteLease | null;
  authorizations: WriteSetAuthorization[];
  writableRoots: string[];
  readOnlyRoots: string[];
  issues: ContractIssue[];
}

function analyzeWriteSetStructure(input: RecordLike): WriteSetStructure {
  const issues: ContractIssue[] = [];
  const profileId = nonEmpty(input.profile) ? input.profile : 'unknown';
  const profile = MANAGED_WRITE_PROFILES[profileId as ManagedWriteProfileId];
  if (!profile)
    issues.push(
      issue('WRITESET-PROFILE-UNKNOWN', 'profile', `unknown managed profile: ${profileId}`),
    );

  const lease = validateLease(input.lease, issues);
  const layout = validateLayout(input.git_layout, lease, issues);
  validateLeaseGrantBoundaries(lease, layout, issues);
  const artifacts = validateArtifacts(input.declared_artifact_roots, lease, layout, issues);
  const authorizations: WriteSetAuthorization[] = [];
  if (lease && layout?.git_dir && layout.objects_dir && layout.refs_dir && layout.logs_dir) {
    authorizations.push(
      { path: lease.worktree_root, mode: 'read-write', scope: 'tree', reason: 'worktree-content' },
      { path: layout.git_dir, mode: 'read-write', scope: 'tree', reason: 'git-worktree-metadata' },
      { path: layout.objects_dir, mode: 'read-write', scope: 'tree', reason: 'git-common-objects' },
      { path: layout.refs_dir, mode: 'read-write', scope: 'tree', reason: 'git-common-refs' },
      { path: layout.logs_dir, mode: 'read-write', scope: 'tree', reason: 'git-common-logs' },
    );
  }
  for (const artifact of artifacts) {
    authorizations.push({
      path: artifact.path,
      mode: artifact.mode,
      scope: 'tree',
      reason: 'declared-artifact-root',
    });
  }
  const writableRoots = authorizations
    .filter((entry) => entry.mode === 'read-write')
    .map((entry) => entry.path);
  const readOnlyRoots = authorizations
    .filter((entry) => entry.mode === 'read-only')
    .map((entry) => entry.path);
  validateRequestedWrites(input.requested_writes, writableRoots, issues);
  return { profileId, profile, lease, authorizations, writableRoots, readOnlyRoots, issues };
}

export function prepareAttemptWriteSetProbe(input: unknown): WriteSetProbePreparation {
  if (!record(input) || input.schema !== ATTEMPT_WRITE_SET_REQUEST) {
    return deepFreeze({
      ok: false,
      probe_roots: [],
      issues: [issue('WRITESET-SHAPE', '', `must conform to ${ATTEMPT_WRITE_SET_REQUEST}`)],
    });
  }
  const structure = analyzeWriteSetStructure(input);
  if (structure.issues.length > 0 || !structure.profile) {
    return deepFreeze({ ok: false, probe_roots: [], issues: structure.issues });
  }
  return deepFreeze({ ok: true, probe_roots: [...structure.writableRoots], issues: [] });
}

export function compileAttemptWriteSet(input: unknown): WriteSetPlan {
  if (!record(input) || input.schema !== ATTEMPT_WRITE_SET_REQUEST) {
    return refused(input, [
      issue('WRITESET-SHAPE', '', `must conform to ${ATTEMPT_WRITE_SET_REQUEST}`),
    ]);
  }
  const structure = analyzeWriteSetStructure(input);
  if (structure.issues.length > 0 || !structure.profile) {
    return refused(input, structure.issues);
  }
  validateWritability(input.writability, structure.writableRoots, structure.issues);
  if (structure.issues.length > 0) return refused(input, structure.issues);

  const profilePlan: ManagedProfilePlan = {
    id: structure.profileId,
    provider: structure.profile.provider,
    adapter: structure.profile.adapter,
    effective_profile: structure.profile.effective_profile,
    runtime_status: structure.profile.runtime_status,
    writable_roots: structure.writableRoots,
    read_only_roots: structure.readOnlyRoots,
    denies: [...ATTEMPT_DENY_FLOOR, UNDECLARED_PATH_DENY],
  };
  return deepFreeze({
    schema: ATTEMPT_WRITE_SET,
    ok: true,
    launch_ready: false,
    integration_status: 'preflight-only-dispatcher-missing',
    lease_ref: structure.lease?.lease_ref ?? null,
    authorized: structure.authorizations,
    profile_plan: profilePlan,
    permission_snapshot: {
      ref: null,
      profile: structure.profile.effective_profile,
      writable_roots: structure.writableRoots,
      read_only_roots: structure.readOnlyRoots,
      denies: [...profilePlan.denies],
    },
    issues: [],
  });
}

export function permissionSnapshotSatisfies(
  actual: AttemptPermissionSnapshot,
  required: { profile?: string; denies?: readonly string[] },
): boolean {
  if (required.profile && actual.profile !== required.profile) return false;
  return (required.denies ?? []).every((deny) => actual.denies.includes(deny));
}
