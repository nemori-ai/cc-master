import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_ROOT, '../../../..');
const CCM_ROOT = join(REPO_ROOT, 'ccm');
const TURBO_ENTRY = join(CCM_ROOT, 'node_modules', 'turbo', 'bin', 'turbo');

interface DryRunTask {
  taskId: string;
  hash: string;
  dependencies: string[];
}

interface DryRunSummary {
  tasks: DryRunTask[];
}

function writeFixtureFile(root: string, path: string, content: string): string {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, TURBO_TELEMETRY_DISABLED: '1' },
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result.stdout;
}

function testTask(root: string, options: { only?: boolean } = {}): DryRunTask {
  const args = ['run', 'test', '--dry=json'];
  if (options.only) args.push('--only');
  const summary = JSON.parse(run(process.execPath, [TURBO_ENTRY, ...args], root)) as DryRunSummary;
  const task = summary.tasks.find((candidate) => candidate.taskId === 'ccm#test');
  assert.ok(task, 'dry run must include ccm#test');
  return task;
}

test('#101: ccm#test hashes default app, hook contract, and capability inputs', (t) => {
  assert.equal(existsSync(TURBO_ENTRY), true, 'pnpm -C ccm install must provide turbo');

  const fixture = mkdtempSync(join(tmpdir(), 'ccm-turbo-inputs-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));

  const repository = join(fixture, 'repository');
  const turboRoot = join(repository, 'ccm');
  const cliRoot = join(turboRoot, 'apps', 'cli');
  mkdirSync(cliRoot, { recursive: true });

  writeFixtureFile(turboRoot, 'turbo.json', readFileSync(join(CCM_ROOT, 'turbo.json'), 'utf8'));
  const cliTurboConfig = join(CCM_ROOT, 'apps', 'cli', 'turbo.json');
  if (existsSync(cliTurboConfig)) {
    writeFixtureFile(cliRoot, 'turbo.json', readFileSync(cliTurboConfig, 'utf8'));
  }
  writeFixtureFile(
    turboRoot,
    'package.json',
    `${JSON.stringify({
      name: 'turbo-input-fixture',
      private: true,
      packageManager: 'pnpm@10.22.0',
    })}\n`,
  );
  writeFixtureFile(turboRoot, 'pnpm-workspace.yaml', 'packages:\n  - "apps/*"\n');
  writeFixtureFile(
    turboRoot,
    'pnpm-lock.yaml',
    "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n  apps/cli: {}\n",
  );
  writeFixtureFile(
    cliRoot,
    'package.json',
    `${JSON.stringify({
      name: 'ccm',
      version: '0.0.0',
      private: true,
      scripts: {
        build: 'node -e ""',
        test: 'node -e ""',
      },
    })}\n`,
  );

  const contract = writeFixtureFile(
    repository,
    'plugin/src/hooks/bootstrap-board/CONTRACT.md',
    'contract-v1\n',
  );
  const capabilityCard = writeFixtureFile(
    repository,
    'design_docs/harnesses/capabilities/path-token-resolution.md',
    'capability-card-v1\n',
  );
  const defaultAppSource = writeFixtureFile(
    repository,
    'ccm/apps/cli/src/default-input.ts',
    "export const defaultInput = 'v1';\n",
  );
  const unrelated = writeFixtureFile(repository, 'README.md', 'unrelated-v1\n');

  run('git', ['init', '--quiet'], repository);
  run('git', ['add', '.'], repository);
  run(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ],
    repository,
  );

  const baseline = testTask(turboRoot);
  assert.deepEqual(
    baseline.dependencies,
    ['ccm#build'],
    'package overlay must inherit test dependsOn',
  );
  // Isolate test's own inputs from ccm#build, whose hash also changes for app source edits.
  const defaultInputBaseline = testTask(turboRoot, { only: true });

  writeFileSync(contract, 'contract-v2\n');
  const contractChanged = testTask(turboRoot);
  writeFileSync(contract, 'contract-v1\n');

  writeFileSync(capabilityCard, 'capability-card-v2\n');
  const capabilityCardChanged = testTask(turboRoot);
  writeFileSync(capabilityCard, 'capability-card-v1\n');

  writeFileSync(defaultAppSource, "export const defaultInput = 'v2';\n");
  const defaultAppSourceChanged = testTask(turboRoot, { only: true });
  writeFileSync(defaultAppSource, "export const defaultInput = 'v1';\n");

  writeFileSync(unrelated, 'unrelated-v2\n');
  const unrelatedChanged = testTask(turboRoot);

  assert.notEqual(contractChanged.hash, baseline.hash, 'CONTRACT.md must invalidate ccm#test');
  assert.notEqual(
    capabilityCardChanged.hash,
    baseline.hash,
    'capability card must invalidate ccm#test',
  );
  assert.notEqual(
    defaultAppSourceChanged.hash,
    defaultInputBaseline.hash,
    '$TURBO_DEFAULT$ must preserve default app source inputs',
  );
  assert.equal(unrelatedChanged.hash, baseline.hash, 'unrelated repository files stay out of hash');
});
