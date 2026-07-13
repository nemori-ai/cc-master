import assert from 'node:assert/strict';
import {
  chmodSync,
  closeSync,
  constants,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { compileAttemptWriteSet, type WorktreeWriteLease, type WriteSetPlan } from '@ccm/engine';
import * as attemptWriteSet from '../src/attempt-write-set.js';
import { buildWriteSetRequest, resolveWorktreeGitLayout } from '../src/attempt-write-set.js';
import * as io from '../src/io.js';
import { REGISTRY } from '../src/registry.js';
import { run } from '../src/router.js';

const TMP: string[] = [];

afterEach(() => {
  for (const root of TMP.splice(0)) {
    try {
      chmodTree(root);
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort fixture cleanup
    }
  }
});

function chmodTree(root: string): void {
  try {
    chmodSync(root, 0o755);
  } catch {}
  // Fixture paths are known and shallow; restoring the roots is enough for recursive rm on POSIX.
  for (const rel of ['main/.git', 'main/.git/worktrees/wt-admin', 'wt', 'main/design_docs/plans']) {
    try {
      chmodSync(join(root, rel), 0o755);
    } catch {}
  }
}

function realTmp(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), prefix)));
  TMP.push(root);
  return root;
}

interface FakeLinkedWorktree {
  base: string;
  main: string;
  worktree: string;
  commonDir: string;
  gitDir: string;
  artifactRoot: string;
  lease: WorktreeWriteLease;
}

// Local executable fixture: build the exact files Git worktree would create, without child processes.
function makeLinkedWorktree({
  nestedWorktree = false,
}: {
  nestedWorktree?: boolean;
} = {}): FakeLinkedWorktree {
  const base = realTmp('ccm-writeset-');
  const main = join(base, 'main');
  const worktree = nestedWorktree ? join(main, '.worktrees', 'wt') : join(base, 'wt');
  const commonDir = join(main, '.git');
  const gitDir = join(commonDir, 'worktrees', 'wt-admin');
  const artifactRoot = join(main, 'design_docs', 'plans');
  mkdirSync(join(commonDir, 'objects'), { recursive: true });
  mkdirSync(join(commonDir, 'refs', 'heads'), { recursive: true });
  mkdirSync(join(commonDir, 'logs', 'refs', 'heads'), { recursive: true });
  mkdirSync(gitDir, { recursive: true });
  mkdirSync(join(worktree, 'src'), { recursive: true });
  mkdirSync(artifactRoot, { recursive: true });
  writeFileSync(join(commonDir, 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/feature\n');
  writeFileSync(join(gitDir, 'commondir'), '../..\n');
  writeFileSync(join(gitDir, 'gitdir'), `${join(worktree, '.git')}\n`);
  writeFileSync(join(worktree, '.git'), `gitdir: ${gitDir}\n`);
  writeFileSync(join(worktree, 'src', 'seed.ts'), 'export const seed = 1;\n');
  return {
    base,
    main,
    worktree,
    commonDir,
    gitDir,
    artifactRoot,
    lease: {
      schema: 'ccm/worktree-write-lease/v1',
      lease_ref: 'worktree-lease:local-fixture',
      worktree_root: worktree,
      baseline_commit: '1111111111111111111111111111111111111111',
      artifact_write_roots: [artifactRoot],
    },
  };
}

function compileFixture(
  fixture: FakeLinkedWorktree,
  profile = 'codex-managed-workspace',
): WriteSetPlan {
  return compileAttemptWriteSet(
    buildWriteSetRequest({
      lease: fixture.lease,
      profile,
      artifactRootsRw: [fixture.artifactRoot],
    }),
  );
}

function within(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function guard(plan: WriteSetPlan, target: string): void {
  const allowed = plan.authorized.some(
    (entry) => entry.mode === 'read-write' && entry.scope === 'tree' && within(entry.path, target),
  );
  if (!allowed) throw new Error(`WRITESET-UNDECLARED-WRITE: ${target}`);
}

function writeGuarded(plan: WriteSetPlan, target: string, data: string): void {
  guard(plan, target);
  writeFileSync(target, data);
}

// A faithful local write-shape fixture for edit → stage(index lock) → object/ref/reflog commit → report.
function executeFakeLocalCommit(
  fixture: FakeLinkedWorktree,
  plan: WriteSetPlan,
  marker: string,
): void {
  const source = join(fixture.worktree, 'src', 'seed.ts');
  writeGuarded(plan, source, `export const seed = ${JSON.stringify(marker)};\n`);

  const indexLock = join(fixture.gitDir, 'index.lock');
  const index = join(fixture.gitDir, 'index');
  writeGuarded(plan, indexLock, `index:${marker}\n`);
  guard(plan, index);
  renameSync(indexLock, index);

  const objectBucket = join(fixture.commonDir, 'objects', 'aa');
  mkdirSync(objectBucket, { recursive: true });
  writeGuarded(plan, join(objectBucket, `object-${marker}`), `object:${marker}\n`);

  const refLock = join(fixture.commonDir, 'refs', 'heads', 'feature.lock');
  const ref = join(fixture.commonDir, 'refs', 'heads', 'feature');
  writeGuarded(plan, refLock, `${marker.repeat(40).slice(0, 40)}\n`);
  guard(plan, ref);
  renameSync(refLock, ref);

  writeGuarded(
    plan,
    join(fixture.commonDir, 'logs', 'refs', 'heads', 'feature'),
    `commit ${marker}\n`,
  );
  writeGuarded(plan, join(fixture.artifactRoot, `${marker}-report.md`), `report ${marker}\n`);
}

test('resolver safely resolves gitfile → direct worktree gitdir → commondir/backlink and narrow roots', () => {
  const fixture = makeLinkedWorktree();
  const layout = resolveWorktreeGitLayout(fixture.worktree);
  assert.deepEqual(layout, {
    kind: 'linked-worktree',
    resolution: 'resolved',
    dot_git_file: join(fixture.worktree, '.git'),
    git_dir: fixture.gitDir,
    common_dir: fixture.commonDir,
    objects_dir: join(fixture.commonDir, 'objects'),
    refs_dir: join(fixture.commonDir, 'refs'),
    logs_dir: join(fixture.commonDir, 'logs'),
  });
  const plan = compileFixture(fixture);
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  assert.equal(
    plan.authorized.some((entry) => entry.path === fixture.commonDir),
    false,
  );
});

test('RED calibration: read-only per-worktree metadata rejects index.lock and preflight fails before work', (t) => {
  const fixture = makeLinkedWorktree();
  chmodSync(fixture.gitDir, 0o555);
  let observed = false;
  try {
    const fd = openSync(
      join(fixture.gitDir, 'index.lock'),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    closeSync(fd);
    rmSync(join(fixture.gitDir, 'index.lock'), { force: true });
  } catch (error) {
    observed = true;
    assert.match((error as NodeJS.ErrnoException).code ?? '', /EACCES|EPERM|EROFS/);
  }
  if (!observed) {
    t.skip('privileged runtime bypassed directory mode bits; EROFS-class calibration unavailable');
    return;
  }
  const plan = compileFixture(fixture);
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.authorized, []);
  assert.ok(
    plan.issues.some(
      (entry) => entry.code === 'WRITESET-PATH-NOT-WRITABLE' && entry.path === fixture.gitDir,
    ),
  );
});

test('Codex and Claude fixture mappings can edit/stage/local-commit/write declared artifact; undeclared stays denied', () => {
  for (const profile of ['codex-managed-workspace', 'claude-managed-workspace']) {
    const fixture = makeLinkedWorktree();
    const plan = compileFixture(fixture, profile);
    assert.equal(plan.ok, true, `${profile}: ${JSON.stringify(plan.issues)}`);
    executeFakeLocalCommit(fixture, plan, profile.startsWith('codex') ? 'c' : 'h');
    assert.match(readFileSync(join(fixture.worktree, 'src', 'seed.ts'), 'utf8'), /seed/);
    assert.equal(
      readFileSync(
        join(fixture.artifactRoot, `${profile.startsWith('codex') ? 'c' : 'h'}-report.md`),
        'utf8',
      ).startsWith('report'),
      true,
    );
    assert.throws(() => guard(plan, join(fixture.main, 'README.md')), /WRITESET-UNDECLARED-WRITE/);
    assert.throws(() => guard(plan, '/etc/cron.d/evil'), /WRITESET-UNDECLARED-WRITE/);
    for (const deny of [
      'account-mutation',
      'credential-read',
      'network',
      'push-remote',
      'pr-create',
      'merge',
      'release',
    ]) {
      assert.ok(plan.profile_plan.denies.includes(deny), `${profile}: ${deny}`);
    }
  }
});

test('resolver and artifact negatives fail closed: symlink, escape, missing, non-worktree, main worktree, undeclared root', () => {
  const symlinkFixture = makeLinkedWorktree();
  rmSync(join(symlinkFixture.worktree, '.git'));
  symlinkSync(symlinkFixture.gitDir, join(symlinkFixture.worktree, '.git'));
  assert.equal(resolveWorktreeGitLayout(symlinkFixture.worktree).resolution, 'symlink');

  const escapeFixture = makeLinkedWorktree();
  const evilCommon = join(escapeFixture.base, 'evil.git');
  mkdirSync(join(evilCommon, 'objects'), { recursive: true });
  mkdirSync(join(evilCommon, 'refs'), { recursive: true });
  mkdirSync(join(evilCommon, 'logs'), { recursive: true });
  writeFileSync(join(evilCommon, 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(join(escapeFixture.gitDir, 'commondir'), `${evilCommon}\n`);
  assert.equal(resolveWorktreeGitLayout(escapeFixture.worktree).resolution, 'escape');

  const missing = realTmp('ccm-writeset-missing-');
  mkdirSync(join(missing, 'wt'));
  assert.equal(resolveWorktreeGitLayout(join(missing, 'wt')).resolution, 'missing');

  const junk = realTmp('ccm-writeset-junk-');
  mkdirSync(join(junk, 'wt'));
  writeFileSync(join(junk, 'wt', '.git'), 'not a gitfile\n');
  assert.equal(resolveWorktreeGitLayout(join(junk, 'wt')).resolution, 'not-a-worktree');

  const main = realTmp('ccm-writeset-main-');
  mkdirSync(join(main, '.git', 'objects'), { recursive: true });
  mkdirSync(join(main, '.git', 'refs'), { recursive: true });
  mkdirSync(join(main, '.git', 'logs'), { recursive: true });
  writeFileSync(join(main, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const mainLayout = resolveWorktreeGitLayout(main);
  assert.equal(mainLayout.kind, 'main-worktree');
  assert.equal(mainLayout.resolution, 'resolved');

  const artifactFixture = makeLinkedWorktree();
  const undeclared = join(artifactFixture.base, 'undeclared');
  mkdirSync(undeclared);
  const outside = compileAttemptWriteSet(
    buildWriteSetRequest({
      lease: artifactFixture.lease,
      profile: 'codex-managed-workspace',
      artifactRootsRw: [undeclared],
    }),
  );
  assert.equal(outside.ok, false);
  assert.ok(outside.issues.some((entry) => entry.code === 'WRITESET-ARTIFACT-OUTSIDE-LEASE'));

  const realArtifact = join(artifactFixture.base, 'real-artifact');
  const linkedArtifact = join(artifactFixture.base, 'linked-artifact');
  mkdirSync(realArtifact);
  symlinkSync(realArtifact, linkedArtifact);
  artifactFixture.lease.artifact_write_roots = [linkedArtifact];
  const symlinked = compileAttemptWriteSet(
    buildWriteSetRequest({
      lease: artifactFixture.lease,
      profile: 'codex-managed-workspace',
      artifactRootsRw: [linkedArtifact],
    }),
  );
  assert.equal(symlinked.ok, false);
  assert.ok(symlinked.issues.some((entry) => entry.code === 'WRITESET-ARTIFACT-ROOT-SYMLINK'));

  const relativeArtifact = compileAttemptWriteSet(
    buildWriteSetRequest({
      lease: artifactFixture.lease,
      profile: 'codex-managed-workspace',
      artifactRootsRw: ['relative-report-root'],
    }),
  );
  assert.equal(relativeArtifact.ok, false);
  assert.ok(
    relativeArtifact.issues.some((entry) => entry.code === 'WRITESET-ARTIFACT-ROOT-ESCAPE'),
  );
});

test('structural negatives call the injected writability probe zero times', () => {
  assert.equal(
    buildWriteSetRequest.length,
    2,
    'request builder must expose the probe boundary for ordering verification',
  );

  const rows: Array<{
    id: string;
    arrange: () => Parameters<typeof buildWriteSetRequest>[0];
    issue: string;
  }> = [
    {
      id: 'main-worktree',
      arrange: () => {
        const fixture = makeLinkedWorktree();
        return {
          lease: { ...fixture.lease, worktree_root: fixture.main, artifact_write_roots: [] },
          profile: 'codex-managed-workspace',
        };
      },
      issue: 'WRITESET-WORKTREE-NOT-ISOLATED',
    },
    {
      id: 'undeclared-artifact',
      arrange: () => {
        const fixture = makeLinkedWorktree();
        const undeclared = join(fixture.base, 'undeclared');
        mkdirSync(undeclared);
        return {
          lease: fixture.lease,
          profile: 'codex-managed-workspace',
          artifactRootsRw: [undeclared],
        };
      },
      issue: 'WRITESET-ARTIFACT-OUTSIDE-LEASE',
    },
    {
      id: 'artifact-symlink',
      arrange: () => {
        const fixture = makeLinkedWorktree();
        const realArtifact = join(fixture.base, 'real-artifact');
        const linkedArtifact = join(fixture.base, 'linked-artifact');
        mkdirSync(realArtifact);
        symlinkSync(realArtifact, linkedArtifact);
        return {
          lease: { ...fixture.lease, artifact_write_roots: [linkedArtifact] },
          profile: 'codex-managed-workspace',
          artifactRootsRw: [linkedArtifact],
        };
      },
      issue: 'WRITESET-ARTIFACT-ROOT-SYMLINK',
    },
    {
      id: 'artifact-escape',
      arrange: () => {
        const fixture = makeLinkedWorktree();
        return {
          lease: fixture.lease,
          profile: 'codex-managed-workspace',
          artifactRootsRw: ['relative-report-root'],
        };
      },
      issue: 'WRITESET-ARTIFACT-ROOT-ESCAPE',
    },
    {
      id: 'duplicate-lease-grant',
      arrange: () => {
        const fixture = makeLinkedWorktree();
        return {
          lease: {
            ...fixture.lease,
            artifact_write_roots: [fixture.artifactRoot, fixture.artifactRoot],
          },
          profile: 'codex-managed-workspace',
          artifactRootsRw: [fixture.artifactRoot],
        };
      },
      issue: 'WRITESET-LEASE',
    },
  ];

  for (const row of rows) {
    const calls: string[] = [];
    const request = buildWriteSetRequest(row.arrange(), {
      probeWritable: (root) => {
        calls.push(root);
        return true;
      },
    });
    const plan = compileAttemptWriteSet(request);
    assert.equal(plan.ok, false, `${row.id}: unexpectedly accepted`);
    assert.deepEqual(plan.authorized, [], `${row.id}: leaked authorization`);
    assert.ok(
      plan.issues.some((entry) => entry.code === row.issue),
      `${row.id}: ${JSON.stringify(plan.issues)}`,
    );
    assert.deepEqual(calls, [], `${row.id}: wrote a probe before refusal`);
  }
});

test('a valid request probes exactly the engine-approved read-write roots before final compilation', () => {
  const fixture = makeLinkedWorktree();
  const calls: string[] = [];
  const request = buildWriteSetRequest(
    {
      lease: fixture.lease,
      profile: 'codex-managed-workspace',
      artifactRootsRw: [fixture.artifactRoot],
    },
    {
      probeWritable: (root) => {
        calls.push(root);
        return true;
      },
    },
  );
  const plan = compileAttemptWriteSet(request);
  assert.equal(plan.ok, true, JSON.stringify(plan.issues));
  assert.deepEqual(calls, plan.profile_plan.writable_roots);
});

test('real CLI rejects equal, child, and ancestor artifact overlap with common Git metadata', () => {
  for (const overlap of ['equal', 'child', 'ancestor'] as const) {
    const fixture = makeLinkedWorktree();
    const artifactRoot =
      overlap === 'equal'
        ? fixture.commonDir
        : overlap === 'child'
          ? join(fixture.commonDir, 'hooks')
          : fixture.main;
    if (overlap === 'child') mkdirSync(artifactRoot);
    const lease = { ...fixture.lease, artifact_write_roots: [artifactRoot] };
    const leaseFile = join(fixture.base, `lease-${overlap}.json`);
    writeFileSync(leaseFile, JSON.stringify(lease));
    const result = runCli([
      'attempt',
      'write-set',
      '--lease',
      `@${leaseFile}`,
      '--profile',
      'codex-managed-workspace',
      '--artifact-root',
      artifactRoot,
    ]);
    assert.equal(result.code, io.EXIT.VALIDATION, `${overlap}: ${result.stderr}`);
    assert.equal(result.stdout, '', `${overlap}: refusal exposed a plan`);
    const violations = JSON.parse(result.stderr).violations as Array<{
      code: string;
      path: string;
    }>;
    assert.ok(
      violations.some((entry) => entry.code === 'WRITESET-ARTIFACT-GIT-METADATA'),
      `${overlap}: ${result.stderr}`,
    );
    if (overlap === 'ancestor') {
      assert.deepEqual(
        violations
          .filter((entry) => entry.code === 'WRITESET-ARTIFACT-GIT-METADATA')
          .map((entry) => entry.path)
          .sort(),
        ['declared_artifact_roots[0].path', 'lease.artifact_write_roots[0]'],
        'common Git ancestor must hit both independent validation boundaries',
      );
    }
  }
});

test('real preflight rejects a sibling-worktree ancestor at both boundary guards without probing', () => {
  const fixture = makeLinkedWorktree({ nestedWorktree: true });
  const boundary = join(fixture.main, '.worktrees');
  const lease = { ...fixture.lease, artifact_write_roots: [boundary] };
  const calls: string[] = [];
  const request = buildWriteSetRequest(
    {
      lease,
      profile: 'codex-managed-workspace',
      artifactRootsRw: [boundary],
    },
    {
      probeWritable: (root) => {
        calls.push(root);
        return true;
      },
    },
  );
  request.requested_writes = [join(boundary, 'sibling-worktree', 'file')];
  const plan = compileAttemptWriteSet(request);
  assert.equal(plan.ok, false, JSON.stringify(plan.issues));
  assert.deepEqual(plan.authorized, []);
  assert.deepEqual(calls, [], 'worktree-boundary refusal must precede writability probes');
  assert.deepEqual(
    plan.issues
      .filter((entry) => entry.code === 'WRITESET-ARTIFACT-WORKTREE-BOUNDARY')
      .map((entry) => entry.path)
      .sort(),
    ['declared_artifact_roots[0].path', 'lease.artifact_write_roots[0]'],
    'lease and declared-root guards must independently reject sibling-worktree widening',
  );

  const leaseFile = join(fixture.base, 'lease-worktree-boundary.json');
  writeFileSync(leaseFile, JSON.stringify(lease));
  const result = runCli([
    'attempt',
    'write-set',
    '--lease',
    `@${leaseFile}`,
    '--profile',
    'codex-managed-workspace',
    '--artifact-root',
    boundary,
  ]);
  assert.equal(result.code, io.EXIT.VALIDATION, result.stderr);
  assert.equal(result.stdout, '');
  const violations = JSON.parse(result.stderr).violations as Array<{
    code: string;
    path: string;
  }>;
  assert.deepEqual(
    violations
      .filter((entry) => entry.code === 'WRITESET-ARTIFACT-WORKTREE-BOUNDARY')
      .map((entry) => entry.path)
      .sort(),
    ['declared_artifact_roots[0].path', 'lease.artifact_write_roots[0]'],
  );
});

test('real CLI rejects duplicate, nested, and read/write-conflicting lease grants', () => {
  for (const conflict of ['duplicate', 'nested', 'read-write'] as const) {
    const fixture = makeLinkedWorktree();
    const lease: WorktreeWriteLease = structuredClone(fixture.lease);
    if (conflict === 'duplicate') lease.artifact_write_roots.push(fixture.artifactRoot);
    if (conflict === 'nested') lease.artifact_write_roots.push(fixture.main);
    if (conflict === 'read-write') lease.artifact_read_roots = [fixture.artifactRoot];
    const leaseFile = join(fixture.base, `lease-${conflict}.json`);
    writeFileSync(leaseFile, JSON.stringify(lease));
    const result = runCli([
      'attempt',
      'write-set',
      '--lease',
      `@${leaseFile}`,
      '--profile',
      'codex-managed-workspace',
      '--artifact-root',
      fixture.artifactRoot,
    ]);
    assert.equal(result.code, io.EXIT.VALIDATION, `${conflict}: ${result.stderr}`);
    assert.equal(result.stdout, '', `${conflict}: refusal exposed a plan`);
    assert.ok(
      JSON.parse(result.stderr).violations.some(
        (entry: { code: string }) => entry.code === 'WRITESET-LEASE',
      ),
      `${conflict}: ${result.stderr}`,
    );
  }
});

test('CLI registry/router/handler compile the real preflight and reject caller fact bypass with structured errors', () => {
  const fixture = makeLinkedWorktree();
  const leaseFile = join(fixture.base, 'lease.json');
  writeFileSync(leaseFile, JSON.stringify(fixture.lease));
  const accepted = runCli([
    'attempt',
    'write-set',
    '--lease',
    `@${leaseFile}`,
    '--profile',
    'codex-managed-workspace',
    '--artifact-root',
    fixture.artifactRoot,
  ]);
  assert.equal(accepted.code, io.EXIT.OK, accepted.stderr);
  const plan = JSON.parse(accepted.stdout).data as WriteSetPlan;
  assert.equal(plan.ok, true);
  assert.equal(plan.launch_ready, false);

  const bypass = runCli(['attempt', 'write-set', '--request', '{}']);
  assert.equal(bypass.code, io.EXIT.USAGE);
  assert.match(bypass.stderr, /Unknown option|unknown option|request/i);

  const malformedLease = join(fixture.base, 'malformed-lease.json');
  writeFileSync(malformedLease, '{}');
  const malformed = runCli([
    'attempt',
    'write-set',
    '--lease',
    `@${malformedLease}`,
    '--profile',
    'codex-managed-workspace',
  ]);
  assert.equal(malformed.code, io.EXIT.VALIDATION);
  assert.equal(malformed.stdout, '');
  assert.ok(
    JSON.parse(malformed.stderr).violations.some(
      (entry: { code: string }) => entry.code === 'WRITESET-LEASE',
    ),
  );

  chmodSync(fixture.gitDir, 0o555);
  const refused = runCli([
    'attempt',
    'write-set',
    '--lease',
    `@${leaseFile}`,
    '--profile',
    'codex-managed-workspace',
  ]);
  assert.equal(refused.code, io.EXIT.VALIDATION);
  assert.equal(refused.stdout, '', 'refusal must not emit ok:true data first');
  const error = JSON.parse(refused.stderr);
  assert.equal(error.ok, false);
  assert.ok(
    error.violations.some((entry: { code: string }) => entry.code === 'WRITESET-PATH-NOT-WRITABLE'),
  );
});

test('default surface is honest: standalone preflight exists but no production dispatch consumer is claimed', () => {
  assert.ok(REGISTRY.attempt?.['write-set']);
  assert.equal((attemptWriteSet as Record<string, unknown>).prepareManagedAttemptLaunch, undefined);
});

test('OPT-IN RED: trusted lease → preflight → provider profile → only spawn effect is integrated', {
  skip: process.env.CCM_ATTEMPT_WRITE_SET_DISPATCH_RED !== '1',
}, () => {
  const prepare = (attemptWriteSet as Record<string, unknown>).prepareManagedAttemptLaunch;
  assert.equal(
    typeof prepare,
    'function',
    'dispatcher seam is intentionally absent: standalone/caller-supplied preflight must not become launch-ready',
  );
});

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(argv: string[]): CliResult {
  const out: string[] = [];
  const err: string[] = [];
  const config = realTmp('ccm-writeset-config-');
  const code = run(argv.concat(['--json']), {
    out: (value: string) => out.push(value),
    err: (value: string) => err.push(value),
    env: { CLAUDE_CONFIG_DIR: config },
  }) as number;
  return { code, stdout: out.join('\n'), stderr: err.join('\n') };
}
