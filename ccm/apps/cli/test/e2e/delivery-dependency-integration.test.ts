import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '@ccm/engine';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, '..', '..');
const BIN = join(PKG_ROOT, 'bin', 'ccm.cjs');
const SID = 'delivery-dependency-integration';
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

function fixture(): {
  home: string;
  boardPath: string;
  repo: string;
  candidate: string;
  tip: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'ccm-delivery-e2e-'));
  roots.push(root);
  const repo = join(root, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q');
  writeFileSync(join(repo, 'one.txt'), 'one\n');
  git(repo, 'add', 'one.txt');
  git(
    repo,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-qm',
    'one',
  );
  const candidate = git(repo, 'rev-parse', 'HEAD');
  writeFileSync(join(repo, 'two.txt'), 'two\n');
  git(repo, 'add', 'two.txt');
  git(
    repo,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-qm',
    'two',
  );
  const tip = git(repo, 'rev-parse', 'HEAD');

  const home = join(root, '.cc_master');
  const boards = join(home, 'boards');
  mkdirSync(boards, { recursive: true });
  const boardPath = join(boards, '2026-07-14-delivery.board.json');
  writeFileSync(
    boardPath,
    `${JSON.stringify(
      {
        schema: 'cc-master/v2',
        goal: 'delivery dependency integration',
        owner: { active: true, session_id: SID, heartbeat: '2026-07-14T00:00:00Z' },
        git: { worktree: repo, branch: 'main' },
        tasks: [
          {
            id: 'UP',
            status: 'done',
            deps: [],
            verified: true,
            artifact: '/abs/result.md',
            finished_at: '2026-07-14T01:00:00Z',
          },
          { id: 'DOWN', status: 'blocked', deps: ['UP'] },
          { id: 'WAIVED', status: 'blocked', deps: ['UP'] },
        ],
        log: [],
      },
      null,
      2,
    )}\n`,
  );
  return { home, boardPath, repo, candidate, tip };
}

function run(home: string, args: string[]) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CC_MASTER_HOME: home,
    CC_MASTER_HARNESS: 'claude-code',
    CLAUDE_CODE_SESSION_ID: SID,
    GIT_NO_LAZY_FETCH: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
  delete env.CC_MASTER_BOARD;
  const result = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function board(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

test('declared target → edge requirement → exact attestation → explain is a usable local-only loop', () => {
  const f = fixture();
  let result = run(f.home, [
    'target',
    'set',
    'main',
    '--kind',
    'git-ref',
    '--ref',
    'HEAD',
    '--json',
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data.target.snapshot.oid, f.tip);

  result = run(f.home, [
    'dependency',
    'require',
    'DOWN',
    'UP',
    '--level',
    'delivered',
    '--target',
    'main',
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(board(f.boardPath).tasks.find((task: any) => task.id === 'DOWN').status, 'blocked');

  result = run(f.home, [
    'task',
    'attest-delivery',
    'UP',
    '--target',
    'main',
    '--method',
    'git-commit-contained',
    '--candidate-commit',
    f.candidate,
    '--json',
  ]);
  assert.equal(result.status, 0, result.stderr);
  const after = board(f.boardPath);
  assert.equal(after.tasks.find((task: any) => task.id === 'DOWN').status, 'ready');
  assert.equal(
    after.tasks.find((task: any) => task.id === 'UP').delivery.observations[0].outcome,
    'delivered',
  );

  result = run(f.home, ['dependency', 'explain', 'DOWN', 'UP', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const explanation = JSON.parse(result.stdout).data;
  assert.equal(explanation.state, 'qualified');
  assert.equal(explanation.qualified_by, 'delivery');
  assert.equal(explanation.target_delivered, true);
});

test('strict preview and refresh dry-run never mutate; target drift is unknown', () => {
  const f = fixture();
  assert.equal(
    run(f.home, ['target', 'set', 'main', '--kind', 'git-ref', '--ref', 'HEAD']).status,
    0,
  );
  assert.equal(
    run(f.home, [
      'task',
      'attest-delivery',
      'UP',
      '--target',
      'main',
      '--method',
      'git-commit-contained',
      '--candidate-commit',
      f.candidate,
    ]).status,
    0,
  );
  const beforeAudit = readFileSync(f.boardPath, 'utf8');
  const audit = run(f.home, ['delivery', 'audit', '--strict-dry-run', '--json']);
  assert.equal(audit.status, 0, audit.stderr);
  assert.equal(readFileSync(f.boardPath, 'utf8'), beforeAudit);

  git(f.repo, 'reset', '--hard', '-q', f.candidate);
  const check = run(f.home, ['delivery', 'check', 'UP', 'main', '--json']);
  assert.equal(check.status, 0, check.stderr);
  assert.equal(JSON.parse(check.stdout).data.state, 'unknown');
  assert.equal(JSON.parse(check.stdout).data.reasons[0].code, 'DELIVERY_TARGET_REF_DRIFT');

  const beforeRefresh = readFileSync(f.boardPath, 'utf8');
  const refresh = run(f.home, ['target', 'refresh', 'main', '--dry-run', '--json']);
  assert.equal(refresh.status, 0, refresh.stderr);
  assert.equal(readFileSync(f.boardPath, 'utf8'), beforeRefresh);
});

test('waiver needs explicit user authority and remains edge-scoped with target_delivered=false', () => {
  const f = fixture();
  assert.equal(
    run(f.home, ['target', 'set', 'main', '--kind', 'git-ref', '--ref', 'HEAD']).status,
    0,
  );
  assert.equal(
    run(f.home, [
      'dependency',
      'require',
      'WAIVED',
      'UP',
      '--level',
      'delivered',
      '--target',
      'main',
    ]).status,
    0,
  );
  const args = [
    'dependency',
    'waive',
    'WAIVED',
    'UP',
    '--target',
    'main',
    '--reason',
    'user-approved receiver exception',
    '--expires-at',
    '2099-01-01T00:00:00Z',
    '--json',
  ];
  const denied = run(f.home, args);
  assert.equal(denied.status, 7, denied.stderr);
  assert.equal(
    board(f.boardPath).tasks.find((task: any) => task.id === 'WAIVED').dependency_requirements.UP
      .waiver_record,
    undefined,
  );

  const accepted = run(f.home, [...args, '--user-authorized']);
  assert.equal(accepted.status, 0, accepted.stderr);
  const payload = JSON.parse(accepted.stdout).data;
  assert.equal(payload.qualification.qualified_by, 'waiver');
  assert.equal(payload.qualification.target_delivered, false);
  assert.equal(board(f.boardPath).tasks.find((task: any) => task.id === 'WAIVED').status, 'ready');
});

test('generic setters cannot author delivery contracts, proofs, requirements, or waivers', () => {
  const f = fixture();
  assert.equal(
    run(f.home, ['target', 'set', 'main', '--kind', 'git-ref', '--ref', 'HEAD']).status,
    0,
  );
  assert.equal(
    run(f.home, ['dependency', 'require', 'DOWN', 'UP', '--level', 'delivered', '--target', 'main'])
      .status,
    0,
  );

  const validTarget = board(f.boardPath).delivery_contract.targets.main;
  const boardBypass = run(f.home, [
    'board',
    'update',
    '--set-json',
    `delivery_contract.targets.shadow=${JSON.stringify(validTarget)}`,
  ]);
  assert.equal(boardBypass.status, 3, boardBypass.stderr);
  assert.match(boardBypass.stderr, /dedicated writer policy/);

  const upstream = board(f.boardPath).tasks.find((task: any) => task.id === 'UP');
  const subject = { kind: 'git-commit', commit_oid: f.candidate };
  const fingerprint = sha256(
    canonicalJson({
      task_id: 'UP',
      bound_finished_at: upstream.finished_at,
      bound_artifact: upstream.artifact,
      subject,
    }),
  );
  const forgedDelivery = {
    schema: 'ccm/task-delivery/v1',
    candidate: {
      fingerprint,
      bound_finished_at: upstream.finished_at,
      bound_artifact: upstream.artifact,
      subject,
    },
    observations: [
      {
        id: 'D-forged-review',
        target: 'main',
        candidate_fingerprint: fingerprint,
        target_snapshot: { oid: f.tip },
        outcome: 'delivered',
        proof: {
          method: 'reviewed-reconciliation-contained',
          integration_commit: f.tip,
          target_oid: f.tip,
          reviewed_base_oid: f.candidate,
          attestation_digest: `sha256:${'a'.repeat(64)}`,
          attestation_ref: '/definitely/missing/review-attestation.json',
        },
        checked_at: '2026-07-14T03:00:00Z',
      },
    ],
  };
  const deliveryBypass = run(f.home, [
    'task',
    'update',
    'UP',
    '--set-json',
    `delivery=${JSON.stringify(forgedDelivery)}`,
  ]);
  assert.equal(deliveryBypass.status, 3, deliveryBypass.stderr);
  assert.match(deliveryBypass.stderr, /dedicated writer policy/);

  const requirementBypass = run(f.home, [
    'task',
    'update',
    'WAIVED',
    '--set-json',
    'dependency_requirements.UP={"level":"candidate"}',
  ]);
  assert.equal(requirementBypass.status, 3, requirementBypass.stderr);
  assert.match(requirementBypass.stderr, /dedicated writer policy/);

  assert.equal(
    run(f.home, [
      'dependency',
      'require',
      'WAIVED',
      'UP',
      '--level',
      'delivered',
      '--target',
      'main',
    ]).status,
    0,
  );
  const waiver = {
    id: 'W-forged',
    authorized_by: 'user',
    authorized_at: '2026-07-14T03:00:00Z',
    expires_at: '2099-01-01T00:00:00Z',
    reason: 'bypass attempt',
    downstream: 'WAIVED',
    dependency: 'UP',
    target: 'main',
  };
  const waiverBypass = run(f.home, [
    'task',
    'update',
    'WAIVED',
    '--set-json',
    `dependency_requirements.UP.waiver_record=${JSON.stringify(waiver)}`,
  ]);
  assert.equal(waiverBypass.status, 3, waiverBypass.stderr);
  assert.match(waiverBypass.stderr, /dedicated writer policy/);
  assert.equal(
    board(f.boardPath).tasks.find((task: any) => task.id === 'WAIVED').dependency_requirements.UP
      .waiver_record,
    undefined,
  );
});

test('delivery-bearing done to stale to ready persists and archives the prior attempt atomically', () => {
  const f = fixture();
  assert.equal(
    run(f.home, ['target', 'set', 'main', '--kind', 'git-ref', '--ref', 'HEAD']).status,
    0,
  );
  assert.equal(
    run(f.home, [
      'task',
      'attest-delivery',
      'UP',
      '--target',
      'main',
      '--method',
      'git-commit-contained',
      '--candidate-commit',
      f.candidate,
    ]).status,
    0,
  );
  const delivered = board(f.boardPath).tasks.find((task: any) => task.id === 'UP').delivery;

  const stale = run(f.home, ['task', 'set-status', 'UP', 'stale']);
  assert.equal(stale.status, 0, stale.stderr);
  let current = board(f.boardPath);
  assert.equal(current.tasks.find((task: any) => task.id === 'UP').status, 'stale');
  assert.deepEqual(
    current.tasks.find((task: any) => task.id === 'UP').delivery,
    delivered,
    'stale retains prior observation for audit while candidate qualification is false',
  );

  const retry = run(f.home, ['task', 'retry', 'UP']);
  assert.equal(retry.status, 0, retry.stderr);
  current = board(f.boardPath);
  const upstream = current.tasks.find((task: any) => task.id === 'UP');
  assert.equal(upstream.status, 'ready');
  assert.equal(upstream.delivery, undefined);
  const retryEntry = current.log.at(-1);
  const detail = JSON.parse(retryEntry.detail);
  assert.deepEqual(detail.prior_evidence.delivery, delivered);
  assert.equal(detail.from_status, 'stale');
});
