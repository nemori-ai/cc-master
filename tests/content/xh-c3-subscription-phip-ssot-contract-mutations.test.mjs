import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const SUITE_ROOT = resolve(import.meta.dirname, '..', '..');
const CHECKER = join(SUITE_ROOT, 'tests/content/xh-c3-subscription-phip-ssot-contract.test.mjs');

function mutationTarget(t, label) {
  const root = mkdtempSync(join(tmpdir(), `ccm-xh-c3-phip-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(join(SUITE_ROOT, 'design_docs'), join(root, 'design_docs'), { recursive: true });
  cpSync(join(SUITE_ROOT, 'plugin/src/hooks'), join(root, 'plugin/src/hooks'), {
    recursive: true,
  });
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

  const result = runChecker(root);
  assertRejected(result, /unapproved authority marker XH-C3-ALTERNATE-AUTHORITY/);
  assert.match(`${result.stdout}\n${result.stderr}`, /duplicate authority for bounded-inbox-list/);
});
