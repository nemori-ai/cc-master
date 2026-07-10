import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run } from '../src/router.js';
import {
  createDefaultRuntimeBackend,
  createRuntimeSupplyChain,
  type RuntimePlatformBackend,
  type RuntimeSupplyChain,
} from '../src/runtime-supply-chain.js';

const TMP: string[] = [];
const HERE = dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  for (const root of TMP) {
    makeTreeWritable(root);
    rmSync(root, { recursive: true, force: true });
  }
  TMP.length = 0;
});

function makeTreeWritable(target: string): void {
  if (!existsSync(target)) return;
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    chmodSync(target, 0o700);
    for (const entry of readdirSync(target)) makeTreeWritable(join(target, entry));
  } else {
    chmodSync(target, 0o600);
  }
}

function fixture(
  version: string,
  script = `#!/bin/sh\nprintf '%s\\n' '${version}'\n`,
): {
  root: string;
  home: string;
  artifact: string;
  provenance: string;
  hash: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'ccm-runtime-'));
  TMP.push(root);
  const home = join(root, 'home');
  mkdirSync(join(home, 'boards'), { recursive: true });
  writeFileSync(join(home, 'boards', 'keep.board.json'), '{"keep":true}\n');
  const artifact = join(root, `ccm-${version}`);
  writeFileSync(artifact, script, { mode: 0o755 });
  chmodSync(artifact, 0o755);
  const hash = createHash('sha256').update(readFileSync(artifact)).digest('hex');
  const provenance = join(root, `provenance-${version}.json`);
  writeFileSync(
    provenance,
    `${JSON.stringify(
      {
        schema: 'ccm/runtime-provenance/v1',
        repository: 'nemori-ai/cc-master',
        tag: `ccm-v${version}`,
        asset:
          process.platform === 'darwin'
            ? `ccm-darwin-${process.arch}`
            : `ccm-linux-${process.arch}`,
        sha256: hash,
      },
      null,
      2,
    )}\n`,
    { mode: 0o644 },
  );
  return { root, home, artifact, provenance, hash };
}

function manager(home: string): RuntimeSupplyChain {
  return createRuntimeSupplyChain({ env: { HOME: join(home, '..'), CC_MASTER_HOME: home } });
}

function createPlatformNeutralContractBackend(expectedAsset: string): RuntimePlatformBackend {
  return {
    id: 'test-platform-neutral-no-symlink-v1',
    platform: 'win32-simulated',
    arch: process.arch,
    activationSupported: true,
    expectedAsset,
    ensurePrivateDirectory(dirPath) {
      mkdirSync(dirPath, { recursive: true });
    },
    verifyOpenFile(_filePath, _fd, stat) {
      assert.equal(stat.isFile(), true);
    },
    verifyManagedDirectory(_dirPath, stat) {
      assert.equal(stat.isDirectory(), true);
    },
    sealFile() {},
    publishUniqueFile(tempPath, finalPath) {
      try {
        linkSync(tempPath, finalPath);
        unlinkSync(tempPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          const failure = new Error('no replace') as Error & { code?: string; errKind?: string };
          failure.code = 'RUNTIME_REPLACE';
          failure.errKind = 'Validation';
          throw failure;
        }
        throw error;
      }
    },
    publishImage(stagingDir, finalDir) {
      try {
        mkdirSync(finalDir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'exists';
        throw error;
      }
      for (const name of ['ccm', 'provenance.json', 'manifest.json', 'READY']) {
        linkSync(join(stagingDir, name), join(finalDir, name));
      }
      return 'published';
    },
    spawnVerifiedImage(imagePath, _imageFd, args, childEnv) {
      return spawnSync(imagePath, args, { env: childEnv });
    },
    flushDirectory() {},
    isProcessAlive() {
      return false;
    },
  };
}

function runtimeRoot(home: string): string {
  return join(home, 'runtimes', 'ccm', 'v1');
}

function activationCount(home: string): number {
  const dir = join(runtimeRoot(home), 'activations');
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')).length : 0;
}

function expectRuntimeError(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: any) => {
    assert.equal(error.code, code, error?.stack || String(error));
    return true;
  });
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });
  return new Promise((resolve) => child.once('exit', (code) => resolve({ code, stdout, stderr })));
}

function invokeCli(args: string[], home: string): { code: number; stdout: string; stderr: string } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = run(args, {
    env: { HOME: join(home, '..'), CC_MASTER_HOME: home },
    out: (line: string) => stdout.push(line),
    err: (line: string) => stderr.push(line),
  });
  assert.equal(typeof code, 'number');
  return { code: code as number, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

test('stage -> activate publishes one atomic current/previous pair and preserves home data', () => {
  const f = fixture('1.2.3');
  const runtime = manager(f.home);

  const staged = runtime.stage({ artifactPath: f.artifact, provenancePath: f.provenance });
  assert.equal(staged.sha256, f.hash);
  assert.equal(existsSync(staged.image_path), true);
  assert.equal(lstatSync(staged.image_path).isSymbolicLink(), false);
  assert.equal(existsSync(join(f.home, 'boards', 'keep.board.json')), true);

  const activated = runtime.activate(staged.transaction_id);
  assert.equal(activated.current.sha256, f.hash);
  assert.equal(activated.previous, null);
  assert.equal(activated.sequence, 1);

  const resolved = runtime.resolve();
  assert.equal(resolved.sha256, f.hash);
  assert.equal(resolved.image_path, staged.image_path);
  assert.equal(existsSync(join(f.home, 'boards', 'keep.board.json')), true);
});

test('stage rejects bad hash, untrusted provenance, unsafe permissions, owner mismatch, and input symlinks', () => {
  const badHash = fixture('2.0.0');
  const hashDoc = JSON.parse(readFileSync(badHash.provenance, 'utf8'));
  hashDoc.sha256 = '0'.repeat(64);
  writeFileSync(badHash.provenance, `${JSON.stringify(hashDoc)}\n`);
  expectRuntimeError(
    () =>
      manager(badHash.home).stage({
        artifactPath: badHash.artifact,
        provenancePath: badHash.provenance,
      }),
    'RUNTIME_HASH',
  );
  assert.equal(activationCount(badHash.home), 0);

  const untrusted = fixture('2.0.1');
  const provenanceDoc = JSON.parse(readFileSync(untrusted.provenance, 'utf8'));
  provenanceDoc.repository = 'attacker/example';
  writeFileSync(untrusted.provenance, `${JSON.stringify(provenanceDoc)}\n`);
  expectRuntimeError(
    () =>
      manager(untrusted.home).stage({
        artifactPath: untrusted.artifact,
        provenancePath: untrusted.provenance,
      }),
    'RUNTIME_PROVENANCE',
  );
  assert.equal(activationCount(untrusted.home), 0);

  const permissions = fixture('2.0.2');
  chmodSync(permissions.artifact, 0o775);
  expectRuntimeError(
    () =>
      manager(permissions.home).stage({
        artifactPath: permissions.artifact,
        provenancePath: permissions.provenance,
      }),
    'RUNTIME_PERMISSION',
  );

  const owner = fixture('2.0.3');
  const wrongOwnerBackend = createDefaultRuntimeBackend(
    process.platform,
    process.arch,
    (typeof process.geteuid === 'function' ? process.geteuid() : 0) + 1,
  );
  const ownerRuntime = createRuntimeSupplyChain({
    env: { CC_MASTER_HOME: owner.home },
    backend: wrongOwnerBackend,
  });
  expectRuntimeError(
    () => ownerRuntime.stage({ artifactPath: owner.artifact, provenancePath: owner.provenance }),
    'RUNTIME_OWNER',
  );

  const symlink = fixture('2.0.4');
  const artifactLink = join(symlink.root, 'artifact-link');
  symlinkSync(symlink.artifact, artifactLink);
  expectRuntimeError(
    () =>
      manager(symlink.home).stage({
        artifactPath: artifactLink,
        provenancePath: symlink.provenance,
      }),
    'RUNTIME_SYMLINK',
  );
  const provenanceLink = join(symlink.root, 'provenance-link');
  symlinkSync(symlink.provenance, provenanceLink);
  expectRuntimeError(
    () =>
      manager(symlink.home).stage({
        artifactPath: symlink.artifact,
        provenancePath: provenanceLink,
      }),
    'RUNTIME_SYMLINK',
  );
  assert.equal(activationCount(symlink.home), 0);
});

test('activate re-verifies immutable image hash/symlink/path containment and never changes current on failure', () => {
  const first = fixture('3.0.0');
  const runtime = manager(first.home);
  const firstStage = runtime.stage({
    artifactPath: first.artifact,
    provenancePath: first.provenance,
  });
  runtime.activate(firstStage.transaction_id);

  const tampered = fixture('3.0.1');
  const tamperedRuntime = createRuntimeSupplyChain({ env: { CC_MASTER_HOME: first.home } });
  const tamperedStage = tamperedRuntime.stage({
    artifactPath: tampered.artifact,
    provenancePath: tampered.provenance,
  });
  chmodSync(tamperedStage.image_path, 0o700);
  writeFileSync(tamperedStage.image_path, 'tampered bytes');
  chmodSync(tamperedStage.image_path, 0o500);
  expectRuntimeError(() => tamperedRuntime.activate(tamperedStage.transaction_id), 'RUNTIME_HASH');
  assert.equal(runtime.resolve().sha256, firstStage.sha256);
  assert.equal(activationCount(first.home), 1);

  const linked = fixture('3.0.2');
  const linkedStage = tamperedRuntime.stage({
    artifactPath: linked.artifact,
    provenancePath: linked.provenance,
  });
  chmodSync(join(linkedStage.image_path, '..'), 0o700);
  unlinkSync(linkedStage.image_path);
  symlinkSync(first.artifact, linkedStage.image_path);
  expectRuntimeError(() => tamperedRuntime.activate(linkedStage.transaction_id), 'RUNTIME_SYMLINK');
  assert.equal(runtime.resolve().sha256, firstStage.sha256);

  const escaped = fixture('3.0.3');
  const escapedStage = tamperedRuntime.stage({
    artifactPath: escaped.artifact,
    provenancePath: escaped.provenance,
  });
  const txDir = join(runtimeRoot(first.home), 'transactions', escapedStage.transaction_id);
  const stagedEventPath = join(txDir, '0001-staged.json');
  const stagedEvent = JSON.parse(readFileSync(stagedEventPath, 'utf8'));
  stagedEvent.image.image = '../../outside/ccm';
  chmodSync(stagedEventPath, 0o600);
  writeFileSync(stagedEventPath, `${JSON.stringify(stagedEvent)}\n`);
  chmodSync(stagedEventPath, 0o400);
  expectRuntimeError(
    () => tamperedRuntime.activate(escapedStage.transaction_id),
    'RUNTIME_IMAGE_REF',
  );
  assert.equal(runtime.resolve().sha256, firstStage.sha256);
  assert.equal(activationCount(first.home), 1);
});

test('resolve binds hash to release identity and rejects manifest/provenance drift or same-hash retagging', () => {
  const first = fixture('3.1.0');
  const runtime = manager(first.home);
  const staged = runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance });
  runtime.activate(staged.transaction_id);

  const retaggedPath = join(first.root, 'retagged.json');
  const retagged = JSON.parse(readFileSync(first.provenance, 'utf8'));
  retagged.tag = 'ccm-v3.1.1';
  writeFileSync(retaggedPath, `${JSON.stringify(retagged, null, 2)}\n`, { mode: 0o644 });
  expectRuntimeError(
    () => runtime.stage({ artifactPath: first.artifact, provenancePath: retaggedPath }),
    'RUNTIME_IDENTITY',
  );
  assert.equal(activationCount(first.home), 1);

  const imageDir = join(staged.image_path, '..');
  const managedProvenance = join(imageDir, 'provenance.json');
  chmodSync(imageDir, 0o700);
  chmodSync(managedProvenance, 0o600);
  const drifted = JSON.parse(readFileSync(managedProvenance, 'utf8'));
  drifted.tag = 'ccm-v3.1.9';
  writeFileSync(managedProvenance, `${JSON.stringify(drifted, null, 2)}\n`);
  chmodSync(managedProvenance, 0o400);
  chmodSync(imageDir, 0o500);
  expectRuntimeError(() => runtime.resolve(), 'RUNTIME_PROVENANCE_DIGEST');
});

test('stage pins an O_NOFOLLOW artifact fd and rejects a pathname swap as TOCTOU', () => {
  const first = fixture('3.2.0');
  const original = readFileSync(first.artifact);
  const base = createDefaultRuntimeBackend();
  let swapped = false;
  const swappingBackend: RuntimePlatformBackend = {
    ...base,
    verifyOpenFile(filePath, fd, stat, purpose) {
      base.verifyOpenFile(filePath, fd, stat, purpose);
      if (purpose === 'artifact' && !swapped) {
        swapped = true;
        renameSync(filePath, `${filePath}.pinned`);
        writeFileSync(filePath, '#!/bin/sh\nprintf malicious\n', { mode: 0o755 });
        chmodSync(filePath, 0o755);
      }
    },
  };
  const runtime = createRuntimeSupplyChain({
    env: { CC_MASTER_HOME: first.home },
    backend: swappingBackend,
  });
  expectRuntimeError(
    () => runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance }),
    'RUNTIME_TOCTOU',
  );
  assert.equal(swapped, true);
  assert.notDeepEqual(
    readFileSync(first.artifact),
    original,
    'source pathname now points at attacker bytes',
  );
  assert.equal(activationCount(first.home), 0);
  assert.equal(readdirSync(join(runtimeRoot(first.home), 'transactions')).length, 0);
});

test('rollback affects only new invocations; a resolved old image keeps running', async () => {
  const first = fixture(
    '4.0.0',
    '#!/bin/sh\nprintf started > "$1"\nwhile [ ! -f "$2" ]; do sleep 0.02; done\nprintf old > "$3"\n',
  );
  const runtime = manager(first.home);
  const firstStage = runtime.stage({
    artifactPath: first.artifact,
    provenancePath: first.provenance,
  });
  runtime.activate(firstStage.transaction_id);
  const pinnedOld = runtime.resolve();

  const started = join(first.root, 'started');
  const release = join(first.root, 'release');
  const result = join(first.root, 'result');
  const child = spawn(pinnedOld.image_path, [started, release, result], { stdio: 'ignore' });
  for (let i = 0; i < 100 && !existsSync(started); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(existsSync(started), true, 'old image process reached its wait point');

  const second = fixture('4.0.1');
  const secondStage = runtime.stage({
    artifactPath: second.artifact,
    provenancePath: second.provenance,
  });
  runtime.activate(secondStage.transaction_id);
  assert.equal(runtime.resolve().sha256, secondStage.sha256, 'new invocation resolves new current');
  writeFileSync(release, 'go');
  const exit = await new Promise<number | null>((resolve) => child.once('exit', resolve));
  assert.equal(exit, 0);
  assert.equal(
    readFileSync(result, 'utf8'),
    'old',
    'already-running old image was not hot-reloaded or killed',
  );
  assert.equal(existsSync(pinnedOld.image_path), true, 'old image remains available');

  const rolledBack = runtime.rollback();
  assert.equal(rolledBack.current.sha256, firstStage.sha256);
  assert.equal(rolledBack.previous?.sha256, secondStage.sha256);
  assert.equal(runtime.resolve().sha256, firstStage.sha256);
});

test('invoke executes the already-verified fd even if the managed pathname is swapped before spawn', () => {
  const first = fixture('4.1.0', '#!/bin/sh\nprintf trusted > "$1"\n');
  const base = createDefaultRuntimeBackend();
  let swapped = false;
  const backend: RuntimePlatformBackend = {
    ...base,
    spawnVerifiedImage(imagePath, imageFd, args, childEnv) {
      const imageDir = join(imagePath, '..');
      chmodSync(imageDir, 0o700);
      renameSync(imagePath, `${imagePath}.verified`);
      writeFileSync(imagePath, '#!/bin/sh\nprintf malicious > "$1"\n', { mode: 0o500 });
      chmodSync(imagePath, 0o500);
      chmodSync(imageDir, 0o500);
      swapped = true;
      return base.spawnVerifiedImage(imagePath, imageFd, args, childEnv);
    },
  };
  const runtime = createRuntimeSupplyChain({ env: { CC_MASTER_HOME: first.home }, backend });
  const staged = runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance });
  runtime.activate(staged.transaction_id);
  const output = join(first.root, 'invoke-output');
  const invoked = runtime.invoke([output]);
  assert.equal(invoked.exit_code, 0);
  assert.equal(swapped, true);
  assert.equal(readFileSync(output, 'utf8'), 'trusted');
});

test('publish EXDEV and activation kill-switch fail closed without changing current', () => {
  const first = fixture('5.0.0');
  const runtime = manager(first.home);
  const firstStage = runtime.stage({
    artifactPath: first.artifact,
    provenancePath: first.provenance,
  });
  runtime.activate(firstStage.transaction_id);
  const second = fixture('5.0.1');
  const secondStage = runtime.stage({
    artifactPath: second.artifact,
    provenancePath: second.provenance,
  });

  const base = createDefaultRuntimeBackend();
  const crossVolume: RuntimePlatformBackend = {
    ...base,
    publishUniqueFile(tempPath, finalPath) {
      if (finalPath.includes(`${join('v1', 'activations')}${join('').slice(0, 0)}`)) {
        const error = new Error('cross-device link') as NodeJS.ErrnoException;
        error.code = 'EXDEV';
        throw error;
      }
      base.publishUniqueFile(tempPath, finalPath);
    },
  };
  const failing = createRuntimeSupplyChain({
    env: { CC_MASTER_HOME: first.home },
    backend: crossVolume,
  });
  assert.throws(() => failing.activate(secondStage.transaction_id), /cross-device link/);
  assert.equal(runtime.resolve().sha256, firstStage.sha256);
  assert.equal(activationCount(first.home), 1);

  const disabled = createRuntimeSupplyChain({
    env: { CC_MASTER_HOME: first.home, CCM_RUNTIME_ACTIVATION_DISABLE: '1' },
  });
  expectRuntimeError(() => disabled.activate(secondStage.transaction_id), 'RUNTIME_DISABLED');
  expectRuntimeError(() => disabled.rollback(), 'RUNTIME_DISABLED');
  assert.equal(runtime.resolve().sha256, firstStage.sha256);
});

test('doctor reports repeatable in-place migration dry-run and recovers crash-after-commit journal', () => {
  const first = fixture('6.0.0');
  const runtime = manager(first.home);
  const staged = runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance });
  const crashed = createRuntimeSupplyChain({
    env: { CC_MASTER_HOME: first.home },
    fault(point) {
      if (point === 'after_commit') throw new Error('synthetic crash after commit');
    },
  });
  assert.throws(() => crashed.activate(staged.transaction_id), /synthetic crash/);
  assert.equal(
    runtime.resolve().sha256,
    staged.sha256,
    'published commit is authoritative after crash',
  );

  const before = runtime.doctor({ installedPath: first.artifact });
  assert.deepEqual(before.migration, runtime.doctor({ installedPath: first.artifact }).migration);
  assert.equal(before.migration?.kind, 'in-place-file');
  assert.equal(before.migration?.mutates_source, false);
  assert.equal(before.migration?.preserves_home, true);
  assert.deepEqual(
    before.incomplete_transactions.map((entry) => [entry.transaction_id, entry.state]),
    [[staged.transaction_id, 'commit-published-event-missing']],
  );

  const repaired = runtime.doctor({ installedPath: first.artifact, repair: true });
  assert.equal(repaired.incomplete_transactions[0]?.repaired, 'recovered');
  assert.deepEqual(runtime.doctor().incomplete_transactions, []);
  assert.equal(runtime.resolve().sha256, staged.sha256);
});

test('doctor leaves staged transactions eligible, aborts only prepared-no-commit under lock, and terminals are idempotent', () => {
  const first = fixture('6.0.1');
  const runtime = manager(first.home);
  const staged = runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance });
  assert.deepEqual(
    runtime.doctor().incomplete_transactions,
    [],
    'plain staged transaction is not incomplete',
  );

  const interrupted = createRuntimeSupplyChain({
    env: { CC_MASTER_HOME: first.home },
    fault(point) {
      if (point === 'after_prepare') throw new Error('synthetic pre-commit crash');
    },
  });
  assert.throws(() => interrupted.activate(staged.transaction_id), /synthetic pre-commit crash/);
  assert.deepEqual(
    runtime.doctor().incomplete_transactions.map((entry) => entry.state),
    ['prepared-no-commit'],
  );
  const lockPath = join(runtimeRoot(first.home), 'locks', 'activation.lock');
  writeFileSync(
    lockPath,
    `${JSON.stringify({ schema: 'ccm/runtime-lock/v1', pid: process.pid, created_at: new Date().toISOString() })}\n`,
    { mode: 0o400 },
  );
  expectRuntimeError(() => runtime.doctor({ repair: true }), 'RUNTIME_LOCKED');
  assert.deepEqual(
    runtime.doctor().incomplete_transactions.map((entry) => entry.state),
    ['prepared-no-commit'],
    'live lock prevented repair mutation',
  );
  chmodSync(lockPath, 0o600);
  unlinkSync(lockPath);
  const repaired = runtime.doctor({ repair: true });
  assert.equal(repaired.incomplete_transactions[0]?.repaired, 'aborted');
  expectRuntimeError(() => runtime.activate(staged.transaction_id), 'RUNTIME_TRANSACTION_ABORTED');
  assert.deepEqual(runtime.doctor({ repair: true }).incomplete_transactions, []);

  const second = fixture('6.0.2');
  const secondStaged = runtime.stage({
    artifactPath: second.artifact,
    provenancePath: second.provenance,
  });
  const firstActivation = runtime.activate(secondStaged.transaction_id);
  const repeated = runtime.activate(secondStaged.transaction_id);
  assert.equal(repeated.activation_path, firstActivation.activation_path);
  assert.equal(repeated.sequence, firstActivation.sequence);
  assert.equal(activationCount(first.home), 1);
});

test('process crash after commit leaves a stale lock that doctor repairs without rolling current back', () => {
  const first = fixture('6.1.0');
  const runtime = manager(first.home);
  const staged = runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance });
  const worker = join(HERE, 'fixtures', 'runtime-crash-worker.ts');
  const crashed = spawnSync(
    process.execPath,
    ['--import', 'tsx', worker, first.home, staged.transaction_id],
    { cwd: join(HERE, '..'), encoding: 'utf8' },
  );
  assert.equal(crashed.status, 91, crashed.stderr);
  assert.equal(runtime.resolve().sha256, staged.sha256);

  const before = runtime.doctor();
  assert.equal(before.stale_lock.present, true);
  assert.equal(before.stale_lock.alive, false);
  assert.deepEqual(
    before.incomplete_transactions.map((entry) => entry.state),
    ['commit-published-event-missing'],
  );

  const repaired = runtime.doctor({ repair: true });
  assert.equal(repaired.stale_lock.repaired, true);
  assert.equal(repaired.incomplete_transactions[0]?.repaired, 'recovered');
  const after = runtime.doctor();
  assert.equal(after.stale_lock.present, false);
  assert.deepEqual(after.incomplete_transactions, []);
  assert.equal(runtime.resolve().sha256, staged.sha256);
});

test('platform backend seam activates without symlinks and keeps the public commit contract platform-neutral', () => {
  const f = fixture('7.0.0');
  const provenance = JSON.parse(readFileSync(f.provenance, 'utf8'));
  provenance.asset = 'ccm-windows-test-x64';
  writeFileSync(f.provenance, `${JSON.stringify(provenance)}\n`);
  const seam = createPlatformNeutralContractBackend(provenance.asset);
  const runtime = createRuntimeSupplyChain({ env: { CC_MASTER_HOME: f.home }, backend: seam });
  const staged = runtime.stage({ artifactPath: f.artifact, provenancePath: f.provenance });
  const activated = runtime.activate(staged.transaction_id);
  assert.equal(activated.current.sha256, f.hash);
  assert.equal(lstatSync(activated.activation_path).isFile(), true);
  assert.equal(lstatSync(staged.image_path).isSymbolicLink(), false);
  assert.equal(
    readdirSync(runtimeRoot(f.home), { recursive: true }).some((entry) =>
      lstatSync(join(runtimeRoot(f.home), String(entry))).isSymbolicLink(),
    ),
    false,
  );

  const windowsDefault = createDefaultRuntimeBackend('win32', 'x64');
  assert.equal(windowsDefault.activationSupported, false);
  const failClosed = createRuntimeSupplyChain({
    env: { CC_MASTER_HOME: join(f.root, 'windows-home') },
    backend: windowsDefault,
  });
  expectRuntimeError(
    () => failClosed.stage({ artifactPath: f.artifact, provenancePath: f.provenance }),
    'RUNTIME_BACKEND',
  );
});

test('concurrent activation has one linearization winner and a locked loser, then retries without a torn pair', async () => {
  const first = fixture('8.0.0');
  const runtime = manager(first.home);
  const tx1 = runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance });
  const second = fixture('8.0.1');
  const tx2 = runtime.stage({ artifactPath: second.artifact, provenancePath: second.provenance });
  const worker = join(HERE, 'fixtures', 'runtime-activate-worker.ts');
  const common = ['--import', 'tsx', worker, first.home];

  const winner = spawn(process.execPath, [...common, tx1.transaction_id, '1500'], {
    cwd: join(HERE, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lockPath = join(runtimeRoot(first.home), 'locks', 'activation.lock');
  for (let i = 0; i < 400 && !existsSync(lockPath); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(existsSync(lockPath), true, 'first worker acquired activation lock');
  const loser = spawn(process.execPath, [...common, tx2.transaction_id, '0'], {
    cwd: join(HERE, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const [winnerResult, loserResult] = await Promise.all([waitForExit(winner), waitForExit(loser)]);
  assert.equal(winnerResult.code, 0, winnerResult.stderr);
  assert.equal(loserResult.code, 4, loserResult.stderr);
  assert.match(loserResult.stderr, /RUNTIME_LOCKED/);
  assert.equal(activationCount(first.home), 1);
  assert.equal(runtime.resolve().sha256, tx1.sha256);

  const retried = runtime.activate(tx2.transaction_id);
  assert.equal(retried.sequence, 2);
  assert.equal(retried.current.sha256, tx2.sha256);
  assert.equal(retried.previous?.sha256, tx1.sha256);
  assert.equal(runtime.resolve().sha256, tx2.sha256);
});

test('no-replace publish has one winner under a real two-process race and never overwrites final', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccm-publish-race-'));
  TMP.push(root);
  const tempA = join(root, 'a.tmp');
  const tempB = join(root, 'b.tmp');
  const finalPath = join(root, 'final.json');
  const barrier = join(root, 'go');
  const readyA = join(root, 'ready-a');
  const readyB = join(root, 'ready-b');
  writeFileSync(tempA, 'A');
  writeFileSync(tempB, 'B');
  const worker = join(HERE, 'fixtures', 'runtime-publish-worker.ts');
  const common = ['--import', 'tsx', worker];
  const a = spawn(process.execPath, [...common, tempA, finalPath, barrier, readyA], {
    cwd: join(HERE, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const b = spawn(process.execPath, [...common, tempB, finalPath, barrier, readyB], {
    cwd: join(HERE, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 400 && !(existsSync(readyA) && existsSync(readyB)); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(existsSync(readyA) && existsSync(readyB), true, 'both publishers reached barrier');
  writeFileSync(barrier, 'go');
  const results = await Promise.all([waitForExit(a), waitForExit(b)]);
  assert.deepEqual(
    results.map((result) => result.code).sort(),
    [0, 3],
    results.map((result) => result.stderr).join('\n'),
  );
  assert.match(results.map((result) => result.stderr).join('\n'), /RUNTIME_REPLACE/);
  assert.match(readFileSync(finalPath, 'utf8'), /^(A|B)$/);
  const winner = readFileSync(finalPath, 'utf8');
  writeFileSync(existsSync(tempA) ? tempA : tempB, 'CHANGED');
  assert.equal(
    readFileSync(finalPath, 'utf8'),
    winner,
    'loser temp mutation cannot overwrite final hard-link',
  );
});

test('runtime CLI exposes stage/activate/resolve/doctor/rollback as stable JSON endpoints', () => {
  const first = fixture('9.0.0');
  const stage = invokeCli(
    ['runtime', 'stage', first.artifact, '--provenance', first.provenance, '--json'],
    first.home,
  );
  assert.equal(stage.code, 0, stage.stderr);
  const staged = JSON.parse(stage.stdout).data;
  assert.equal(staged.sha256, first.hash);

  const activate = invokeCli(['runtime', 'activate', staged.transaction_id, '--json'], first.home);
  assert.equal(activate.code, 0, activate.stderr);
  assert.equal(JSON.parse(activate.stdout).data.current.sha256, first.hash);

  const resolve = invokeCli(['runtime', 'resolve', '--json'], first.home);
  assert.equal(resolve.code, 0, resolve.stderr);
  assert.equal(JSON.parse(resolve.stdout).data.sha256, first.hash);

  const second = fixture('9.0.1');
  const stage2 = invokeCli(
    ['runtime', 'stage', second.artifact, '--provenance', second.provenance, '--json'],
    first.home,
  );
  const staged2 = JSON.parse(stage2.stdout).data;
  assert.equal(
    invokeCli(['runtime', 'activate', staged2.transaction_id, '--json'], first.home).code,
    0,
  );
  const rollback = invokeCli(['runtime', 'rollback', '--json'], first.home);
  assert.equal(rollback.code, 0, rollback.stderr);
  assert.equal(JSON.parse(rollback.stdout).data.current.sha256, first.hash);

  const doctor = invokeCli(
    ['runtime', 'doctor', '--installed-path', first.artifact, '--json'],
    first.home,
  );
  assert.equal(doctor.code, 0, doctor.stderr);
  const report = JSON.parse(doctor.stdout).data;
  assert.equal(report.schema, 'ccm/runtime-doctor/v1');
  assert.equal(report.migration.kind, 'in-place-file');
  assert.equal(report.migration.mutates_source, false);
});

test('runtime CLI dry-run is read-only and never silently executes mutation verbs', () => {
  const first = fixture('9.1.0');

  const doctor = invokeCli(
    ['runtime', 'doctor', '--installed-path', first.artifact, '--dry-run', '--json'],
    first.home,
  );
  assert.equal(doctor.code, 0, doctor.stderr);
  assert.equal(JSON.parse(doctor.stdout).data.migration.mutates_source, false);
  assert.equal(
    existsSync(runtimeRoot(first.home)),
    false,
    'read-only doctor must not create layout',
  );

  const stageDryRun = invokeCli(
    ['runtime', 'stage', first.artifact, '--provenance', first.provenance, '--dry-run', '--json'],
    first.home,
  );
  assert.equal(stageDryRun.code, 2, stageDryRun.stderr);
  assert.match(stageDryRun.stderr, /--dry-run.*runtime stage/);
  assert.equal(existsSync(runtimeRoot(first.home)), false);

  const runtime = manager(first.home);
  const staged = runtime.stage({
    artifactPath: first.artifact,
    provenancePath: first.provenance,
  });
  const activateDryRun = invokeCli(
    ['runtime', 'activate', staged.transaction_id, '--dry-run', '--json'],
    first.home,
  );
  assert.equal(activateDryRun.code, 2, activateDryRun.stderr);
  assert.equal(activationCount(first.home), 0);

  runtime.activate(staged.transaction_id);
  const rollbackDryRun = invokeCli(['runtime', 'rollback', '--dry-run', '--json'], first.home);
  assert.equal(rollbackDryRun.code, 2, rollbackDryRun.stderr);
  assert.equal(runtime.resolve().sequence, 1);

  const repairDryRun = invokeCli(
    ['runtime', 'doctor', '--repair', '--dry-run', '--json'],
    first.home,
  );
  assert.equal(repairDryRun.code, 2, repairDryRun.stderr);

  const invokeDryRun = invokeCli(['runtime', 'invoke', '--dry-run', '--', '--version'], first.home);
  assert.equal(invokeDryRun.code, 2, invokeDryRun.stderr);
});
