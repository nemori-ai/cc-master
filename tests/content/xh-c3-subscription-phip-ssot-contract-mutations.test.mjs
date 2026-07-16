import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const SUITE_ROOT = resolve(import.meta.dirname, '..', '..');
const CHECKER = join(SUITE_ROOT, 'tests/content/xh-c3-subscription-phip-ssot-contract.test.mjs');

function mutationTarget(t, label) {
  const root = mkdtempSync(join(tmpdir(), `ccm-xh-c3-phip-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(join(SUITE_ROOT, '.gitignore'), join(root, '.gitignore'));
  cpSync(join(SUITE_ROOT, 'design_docs'), join(root, 'design_docs'), { recursive: true });
  cpSync(join(SUITE_ROOT, 'plugin/src/hooks'), join(root, 'plugin/src/hooks'), {
    recursive: true,
  });
  const init = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, `failed to initialize mutation fixture:\n${init.stderr}`);
  const add = spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
  assert.equal(add.status, 0, `failed to stage mutation fixture:\n${add.stderr}`);
  return root;
}

function runChecker(root) {
  const env = { ...process.env, CCM_XH_C3_TARGET_ROOT: root };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [CHECKER], {
    cwd: SUITE_ROOT,
    env,
    encoding: 'utf8',
    timeout: 15_000,
  });
}

function assertRejected(result, evidence) {
  assert.equal(
    result.status,
    1,
    `hostile mutation escaped checker:\n${result.stdout}\n${result.stderr}`,
  );
  assert.match(`${result.stdout}\n${result.stderr}`, evidence);
}

test('complete canonical compare rejects previously unchecked response-field drift', (t) => {
  const root = mutationTarget(t, 'field-drift');
  const contract = join(root, 'plugin/src/hooks/coordination-inbox/CONTRACT.md');
  const before = readFileSync(contract, 'utf8');
  const after = before.replace(
    '"required_non_empty_response_fields": ["subscription_id", "session_epoch"]',
    '"required_non_empty_response_fields": ["subscription_id", "adapter_epoch"]',
  );
  assert.notEqual(after, before, 'field-drift mutation did not reach canonical authority block');
  writeFileSync(contract, after);

  assertRejected(
    runChecker(root),
    /inbox\.authority: canonical JSON differs from versioned fixture/,
  );
});

test('all structured markers reject an alternate owner of a canonical subject', (t) => {
  const root = mutationTarget(t, 'alternate-authority');
  const alternate = join(root, 'design_docs/xh-c3-alternate-authority.md');
  writeFileSync(
    alternate,
    [
      '# Hostile alternate authority',
      '',
      '<!-- XH-C3-ALTERNATE-AUTHORITY:BEGIN -->',
      '```json',
      '{"owns":["bounded-inbox-list"]}',
      '```',
      '<!-- XH-C3-ALTERNATE-AUTHORITY:END -->',
      '',
    ].join('\n'),
  );
  const add = spawnSync('git', ['add', 'design_docs/xh-c3-alternate-authority.md'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(add.status, 0, `failed to track alternate authority fixture:\n${add.stderr}`);

  const result = runChecker(root);
  assertRejected(result, /unapproved authority marker XH-C3-ALTERNATE-AUTHORITY/);
  assert.match(`${result.stdout}\n${result.stderr}`, /duplicate authority for bounded-inbox-list/);
});

test('ignored local plan cannot become an authority surface', (t) => {
  const root = mutationTarget(t, 'ignored-plan');
  mkdirSync(join(root, 'design_docs/plans'), { recursive: true });
  const ignoredPlan = join(root, 'design_docs/plans/hostile-local-review.md');
  writeFileSync(
    ignoredPlan,
    [
      '# Local review scratchpad',
      '',
      '<!-- XH-C3-ALTERNATE-AUTHORITY:BEGIN -->',
      '```json',
      '{"owns":["bounded-inbox-list"]}',
      '```',
      '<!-- XH-C3-ALTERNATE-AUTHORITY:END -->',
      '',
      'cc-master/xh-c3-inbox-authority/v1',
      '',
    ].join('\n'),
  );
  const ignored = spawnSync('git', ['check-ignore', '--quiet', ignoredPlan], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(ignored.status, 0, 'hostile local review fixture must remain gitignored');

  const result = runChecker(root);
  assert.equal(
    result.status,
    0,
    `ignored plan leaked into publishable authority scan:\n${result.stdout}\n${result.stderr}`,
  );
});

test('implemented runtime cannot regress to target-only card or generated matrix truth', (t) => {
  const root = mutationTarget(t, 'target-only-truth');
  const card = join(
    root,
    'design_docs/harnesses/capabilities/cross-harness-notification-subscription.md',
  );
  const cardBefore = readFileSync(card, 'utf8');
  const cardAfter = cardBefore.replace('| claude-code | implemented-track-b |', '| claude-code | target |');
  assert.notEqual(cardAfter, cardBefore, 'card status mutation did not reach current truth');
  writeFileSync(card, cardAfter);

  const matrix = join(root, 'design_docs/capability-parity-matrix.md');
  const matrixBefore = readFileSync(matrix, 'utf8');
  const matrixAfter = matrixBefore.replace(
    '| cross-harness-notification-subscription | implemented-track-b |',
    '| cross-harness-notification-subscription | target |',
  );
  assert.notEqual(matrixAfter, matrixBefore, 'matrix status mutation did not reach generated truth');
  writeFileSync(matrix, matrixAfter);

  assertRejected(runChecker(root), /capability\.host-status|capability\.matrix-status/);
});

test('implemented runtime cannot omit a canonical XH C3 PARITY anchor', (t) => {
  const root = mutationTarget(t, 'parity-anchor-omission');
  const contract = join(root, 'plugin/src/hooks/bootstrap-board/CONTRACT.md');
  const before = readFileSync(contract, 'utf8');
  const after = before.replace(
    '- rule: rule-bootstrap-subscription-register\n  required_hosts: [claude-code, codex, cursor]\n',
    '',
  );
  assert.notEqual(after, before, 'PARITY anchor mutation did not reach bootstrap contract');
  writeFileSync(contract, after);

  assertRejected(runChecker(root), /bootstrap\.parity\.rule-bootstrap-subscription-register/);
});
