/**
 * K1-06 amendment v3 Blocker 4 — narrow ignore for controlled staging only.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function gitCheckIgnore(paths) {
  return spawnSync('git', ['check-ignore', '-v', ...paths], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

test('v3: .gitignore drops generic .tmp/ and only matches controlled prefixes', () => {
  const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
  assert.doesNotMatch(
    gitignore,
    /^\.tmp\/\s*$/m,
    'generic .tmp/ ignore must be removed',
  );
  assert.match(gitignore, /\/\.tmp\/ccm-provider-guidance-\*\//);
  assert.match(gitignore, /\/\.tmp\/ccm-pacing-read-only-\*\//);

  const scratch = fs.mkdtempSync(path.join(repoRoot, '.tmp-v3-ignore-probe-'));
  try {
    const unknown = path.join(repoRoot, '.tmp', 'unknown-scratch-visible.txt');
    fs.mkdirSync(path.dirname(unknown), { recursive: true });
    fs.writeFileSync(unknown, 'must-remain-visible\n');

    const controlledPg = path.join(
      repoRoot,
      '.tmp',
      `ccm-provider-guidance-probe-${process.pid}`,
      'x.txt',
    );
    const controlledPace = path.join(
      repoRoot,
      '.tmp',
      `ccm-pacing-read-only-probe-${process.pid}`,
      'y.txt',
    );
    fs.mkdirSync(path.dirname(controlledPg), { recursive: true });
    fs.mkdirSync(path.dirname(controlledPace), { recursive: true });
    fs.writeFileSync(controlledPg, 'pg\n');
    fs.writeFileSync(controlledPace, 'pace\n');

    const unknownCheck = gitCheckIgnore([unknown]);
    assert.notEqual(
      unknownCheck.status,
      0,
      `unknown .tmp content must NOT be ignored (stdout=${unknownCheck.stdout})`,
    );

    const controlledCheck = gitCheckIgnore([controlledPg, controlledPace]);
    assert.equal(controlledCheck.status, 0, controlledCheck.stderr);
    assert.match(controlledCheck.stdout, /ccm-provider-guidance/);
    assert.match(controlledCheck.stdout, /ccm-pacing-read-only/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(path.join(repoRoot, '.tmp', 'unknown-scratch-visible.txt'), { force: true });
    fs.rmSync(
      path.join(repoRoot, '.tmp', `ccm-provider-guidance-probe-${process.pid}`),
      { recursive: true, force: true },
    );
    fs.rmSync(
      path.join(repoRoot, '.tmp', `ccm-pacing-read-only-probe-${process.pid}`),
      { recursive: true, force: true },
    );
    try {
      fs.rmdirSync(path.join(repoRoot, '.tmp'));
    } catch {
      // may be non-empty from other work
    }
  }
});
