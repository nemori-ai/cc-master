import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { canonicalJson, targetDelivered } from '@ccm/engine';
import {
  attestDelivery,
  type GitRunner,
  refreshDeliveryTarget,
  resolveDeliveryFacts,
  resolveTargetDeclaration,
} from '../src/delivery-proof.js';

const tmp: string[] = [];
test.afterEach(() => {
  for (const dir of tmp.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

function repoFixture(): { repo: string; first: string; tip: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-delivery-git-'));
  tmp.push(repo);
  git(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, 'one.txt'), 'one\n');
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
  const first = git(repo, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repo, 'two.txt'), 'two\n');
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
  return { repo, first, tip: git(repo, 'rev-parse', 'HEAD') };
}

function board(repo: string): Record<string, any> {
  return {
    schema: 'cc-master/v2',
    goal: 'delivery proof',
    owner: { active: true, session_id: 'S', heartbeat: '2026-07-14T00:00:00Z' },
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
    ],
  };
}

test('local git exact containment is immutable evidence and never invokes a network verb', () => {
  const fixture = repoFixture();
  const calls: string[][] = [];
  const runner: GitRunner = (repo, args) => {
    calls.push([...args]);
    try {
      return { status: 0, stdout: git(repo, ...args), stderr: '' };
    } catch (error) {
      const e = error as { status?: number; stdout?: Buffer; stderr?: Buffer };
      return {
        status: typeof e.status === 'number' ? e.status : 128,
        stdout: e.stdout?.toString() ?? '',
        stderr: e.stderr?.toString() ?? '',
      };
    }
  };
  const b = board(fixture.repo);
  const target = resolveTargetDeclaration(
    b,
    'main',
    { kind: 'git-ref', ref: 'HEAD' },
    { now: '2026-07-14T02:00:00Z', runGit: runner },
  );
  b.delivery_contract = {
    schema: 'ccm/delivery-contract/v1',
    mode: 'declared',
    targets: { main: target },
  };
  const result = attestDelivery(
    b,
    'UP',
    'main',
    { method: 'git-commit-contained', candidate_commit: fixture.first },
    { now: '2026-07-14T03:00:00Z', runGit: runner },
  );
  assert.equal(result.qualification.state, 'qualified');
  assert.equal(result.qualification.target_delivered, true);
  assert.ok(result.delivery);
  assert.equal(result.delivery.observations[0].proof.candidate_commit, fixture.first);
  assert.equal(
    calls.some((args) => args.includes('fetch') || args.includes('pull')),
    false,
  );

  b.tasks[0].delivery = result.delivery;
  const missingCandidateRunner: GitRunner = (repo, args) => {
    if (args[0] === 'rev-parse' && args.at(-1) === `${fixture.first}^{commit}`) {
      return { status: 128, stdout: '', stderr: 'missing local object' };
    }
    return runner(repo, args);
  };
  const missingCandidateFacts = resolveDeliveryFacts(b, {
    runGit: missingCandidateRunner,
    now: '2026-07-14T03:30:00Z',
  });
  const noLongerVerifiable = targetDelivered(b, b.tasks[0], 'main', missingCandidateFacts);
  assert.equal(noLongerVerifiable.state, 'unknown');
  assert.equal(noLongerVerifiable.reasons[0]?.code, 'DELIVERY_CANDIDATE_OBJECT_MISSING');

  git(fixture.repo, 'reset', '--hard', '-q', fixture.first);
  const facts = resolveDeliveryFacts(b, { runGit: runner, now: '2026-07-14T04:00:00Z' });
  assert.equal(facts.targets?.main?.state, 'drift');
});

test('missing git object is unknown and cannot create a delivered observation', () => {
  const fixture = repoFixture();
  const b = board(fixture.repo);
  b.delivery_contract = {
    schema: 'ccm/delivery-contract/v1',
    mode: 'declared',
    targets: {
      main: resolveTargetDeclaration(
        b,
        'main',
        { kind: 'git-ref', ref: 'HEAD' },
        {
          now: '2026-07-14T02:00:00Z',
        },
      ),
    },
  };
  const result = attestDelivery(
    b,
    'UP',
    'main',
    { method: 'git-commit-contained', candidate_commit: 'f'.repeat(40) },
    { now: '2026-07-14T03:00:00Z' },
  );
  assert.equal(result.qualification.state, 'unknown');
  assert.equal(result.delivery, undefined);
  assert.equal(result.qualification.reasons[0]?.code, 'DELIVERY_CANDIDATE_OBJECT_MISSING');
});

test('artifact-set proof binds exact manifest bytes and exact immutable entry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-delivery-artifact-'));
  tmp.push(dir);
  const manifest = path.join(dir, 'manifest.json');
  const entry = {
    logical_name: 'report',
    version: 'v1',
    ref: 'file:/abs/report.json',
    digest: `sha256:${'b'.repeat(64)}`,
  };
  fs.writeFileSync(manifest, JSON.stringify({ schema: 'ccm/artifact-set/v1', entries: [entry] }));
  const b = board(dir);
  const target = resolveTargetDeclaration(
    b,
    'archive',
    { kind: 'artifact-set', namespace: `file:${manifest}` },
    { now: '2026-07-14T02:00:00Z' },
  );
  b.delivery_contract = {
    schema: 'ccm/delivery-contract/v1',
    mode: 'declared',
    targets: { archive: target },
  };
  const result = attestDelivery(
    b,
    'UP',
    'archive',
    { method: 'artifact-digest-contained', artifact: entry },
    { now: '2026-07-14T03:00:00Z' },
  );
  assert.equal(result.qualification.state, 'qualified');
  assert.ok(result.delivery);
  assert.equal(result.delivery.observations[0].proof.method, 'artifact-digest-contained');
});

test('artifact target refresh is retryable after a negative observation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-delivery-artifact-refresh-'));
  tmp.push(dir);
  const manifest = path.join(dir, 'manifest.json');
  const entry = {
    logical_name: 'report',
    version: 'v1',
    ref: 'file:/abs/report.json',
    digest: `sha256:${'b'.repeat(64)}`,
  };
  const writeManifest = (entries: Record<string, string>[]) =>
    fs.writeFileSync(manifest, JSON.stringify({ schema: 'ccm/artifact-set/v1', entries }));
  writeManifest([entry]);

  const b = board(dir);
  b.delivery_contract = {
    schema: 'ccm/delivery-contract/v1',
    mode: 'declared',
    targets: {
      archive: resolveTargetDeclaration(
        b,
        'archive',
        { kind: 'artifact-set', namespace: `file:${manifest}` },
        { now: '2026-07-14T02:00:00Z' },
      ),
    },
  };
  const attested = attestDelivery(
    b,
    'UP',
    'archive',
    { method: 'artifact-digest-contained', artifact: entry },
    { now: '2026-07-14T03:00:00Z' },
  );
  assert.equal(attested.qualification.state, 'qualified');
  b.tasks[0].delivery = attested.delivery;
  const original = structuredClone(b);

  writeManifest([]);
  const negative = refreshDeliveryTarget(b, 'archive', { now: '2026-07-14T04:00:00Z' });
  assert.equal(negative.revalidations[0]?.qualification.state, 'unqualified');
  assert.equal(
    negative.board.tasks[0].delivery.observations.at(-1).proof.method,
    'target-refresh-revalidation',
  );
  assert.deepEqual(b, original, 'refresh is transactional and never mutates its input board');

  writeManifest([entry]);
  const recovered = refreshDeliveryTarget(negative.board, 'archive', {
    now: '2026-07-14T05:00:00Z',
  });
  assert.equal(recovered.revalidations[0]?.qualification.state, 'qualified');
  assert.equal(
    recovered.board.tasks[0].delivery.observations.at(-1).proof.method,
    'artifact-digest-contained',
  );
});

test('exact git target refresh is retryable after a negative observation', () => {
  const fixture = repoFixture();
  const b = board(fixture.repo);
  b.delivery_contract = {
    schema: 'ccm/delivery-contract/v1',
    mode: 'declared',
    targets: {
      main: resolveTargetDeclaration(
        b,
        'main',
        { kind: 'git-ref', ref: 'HEAD' },
        { now: '2026-07-14T02:00:00Z' },
      ),
    },
  };
  const attested = attestDelivery(
    b,
    'UP',
    'main',
    { method: 'git-commit-contained', candidate_commit: fixture.first },
    { now: '2026-07-14T03:00:00Z' },
  );
  assert.equal(attested.qualification.state, 'qualified');
  b.tasks[0].delivery = attested.delivery;
  const original = structuredClone(b);

  git(fixture.repo, 'checkout', '-q', '--orphan', 'disconnected-target');
  git(fixture.repo, 'rm', '-rf', '-q', '.');
  fs.writeFileSync(path.join(fixture.repo, 'disconnected.txt'), 'disconnected\n');
  git(fixture.repo, 'add', 'disconnected.txt');
  git(
    fixture.repo,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-qm',
    'disconnected',
  );
  const negative = refreshDeliveryTarget(b, 'main', { now: '2026-07-14T04:00:00Z' });
  assert.equal(negative.revalidations[0]?.qualification.state, 'unqualified');
  assert.equal(
    negative.board.tasks[0].delivery.observations.at(-1).proof.method,
    'target-refresh-revalidation',
  );
  assert.deepEqual(b, original, 'refresh is transactional and never mutates its input board');

  git(fixture.repo, 'checkout', '--detach', '-q', fixture.tip);
  const recovered = refreshDeliveryTarget(negative.board, 'main', {
    now: '2026-07-14T05:00:00Z',
  });
  assert.equal(recovered.revalidations[0]?.qualification.state, 'qualified');
  assert.equal(
    recovered.board.tasks[0].delivery.observations.at(-1).proof.method,
    'git-commit-contained',
  );
});

test('reviewed reconciliation requires contained integration and fresh APPROVE binding', () => {
  const fixture = repoFixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-delivery-review-'));
  tmp.push(dir);
  const b = board(fixture.repo);
  const target = resolveTargetDeclaration(
    b,
    'main',
    { kind: 'git-ref', ref: 'HEAD' },
    { now: '2026-07-14T02:00:00Z' },
  );
  b.delivery_contract = {
    schema: 'ccm/delivery-contract/v1',
    mode: 'declared',
    targets: { main: target },
  };
  const subject = { kind: 'git-commit', commit_oid: fixture.first };
  const fingerprint = `sha256:${createHash('sha256')
    .update(
      canonicalJson({
        task_id: 'UP',
        bound_finished_at: '2026-07-14T01:00:00Z',
        bound_artifact: '/abs/result.md',
        subject,
      }),
    )
    .digest('hex')}`;
  const attestationPath = path.join(dir, 'review.json');
  const attestation = {
    schema: 'ccm/delivery-review-attestation/v1',
    verdict: 'APPROVE',
    candidate_fingerprint: fingerprint,
    target_id: 'main',
    target_snapshot_oid: fixture.tip,
    integration_commit_oid: fixture.tip,
    reviewed_base_oid: fixture.first,
  };
  fs.writeFileSync(attestationPath, JSON.stringify(attestation));
  const approved = attestDelivery(
    b,
    'UP',
    'main',
    {
      method: 'reviewed-reconciliation-contained',
      candidate_commit: fixture.first,
      integration_commit: fixture.tip,
      attestation: attestationPath,
    },
    { now: '2026-07-14T03:00:00Z' },
  );
  assert.equal(approved.qualification.state, 'qualified');
  assert.equal(
    approved.delivery?.observations[0].proof.method,
    'reviewed-reconciliation-contained',
  );
  assert.equal(approved.delivery?.observations[0].proof.attestation_ref, attestationPath);
  b.tasks[0].delivery = approved.delivery;
  let stored = targetDelivered(
    b,
    b.tasks[0],
    'main',
    resolveDeliveryFacts(b, { now: '2026-07-14T03:30:00Z' }),
  );
  assert.equal(stored.state, 'qualified');

  fs.rmSync(attestationPath);
  stored = targetDelivered(
    b,
    b.tasks[0],
    'main',
    resolveDeliveryFacts(b, { now: '2026-07-14T03:31:00Z' }),
  );
  assert.equal(stored.state, 'unknown');
  assert.equal(stored.reasons[0]?.code, 'DELIVERY_REVIEW_ATTESTATION_UNAVAILABLE');

  fs.writeFileSync(attestationPath, JSON.stringify({ ...attestation, verdict: 'REQUEST-CHANGES' }));
  const rejected = attestDelivery(b, 'UP', 'main', {
    method: 'reviewed-reconciliation-contained',
    candidate_commit: fixture.first,
    integration_commit: fixture.tip,
    attestation: attestationPath,
  });
  assert.equal(rejected.qualification.state, 'unqualified');
  assert.equal(rejected.qualification.reasons[0]?.code, 'DELIVERY_REVIEW_REJECTED');
});
