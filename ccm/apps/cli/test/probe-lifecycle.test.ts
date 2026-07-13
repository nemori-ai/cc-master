// probe-lifecycle.test.ts — probe adapter tests must leave their owned temporary roots closed.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const PROBE_TEST = fileURLToPath(new URL('./probe.test.ts', import.meta.url));
const FORCE_FAILURE_ENV = 'CCM_PROBE_LIFECYCLE_FORCE_FAILURE';

function runProbe(subjectTmp: string, extraEnv: NodeJS.ProcessEnv = {}) {
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv[FORCE_FAILURE_ENV];
  return spawnSync(process.execPath, ['--import', 'tsx', '--test', PROBE_TEST], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
    env: {
      ...childEnv,
      TMPDIR: subjectTmp,
      TMP: subjectTmp,
      TEMP: subjectTmp,
      ...extraEnv,
    },
  });
}

function ownedSurvivors(subjectTmp: string): string[] {
  return readdirSync(subjectTmp)
    .filter((entry) => entry.startsWith('ccm-probe-'))
    .sort();
}

test('probe adapter tests close every owned temporary root without deleting unrelated entries', () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-probe-lifecycle-'));
  const subjectTmp = join(root, 'subject');
  const sentinel = join(subjectTmp, 'unrelated-sentinel');
  mkdirSync(sentinel, { recursive: true });

  try {
    const result = runProbe(subjectTmp);

    assert.equal(
      result.status,
      0,
      `isolated probe test failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    assert.deepEqual(ownedSurvivors(subjectTmp), [], 'successful probe test leaked owned roots');

    const failed = runProbe(subjectTmp, { [FORCE_FAILURE_ENV]: '1' });
    assert.notEqual(failed.status, 0, 'failure fixture must fail before lifecycle inspection');
    assert.match(
      `${failed.stdout}\n${failed.stderr}`,
      /intentional probe lifecycle failure/,
      'failure fixture must fail for the intended reason',
    );
    assert.deepEqual(ownedSurvivors(subjectTmp), [], 'failed probe test leaked owned roots');
    assert.equal(existsSync(sentinel), true, 'probe teardown must preserve unrelated entries');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
