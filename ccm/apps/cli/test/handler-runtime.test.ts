import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
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
import { Worker } from 'node:worker_threads';
import { run } from '../src/router.js';
import {
  createDefaultRuntimeBackend,
  createRuntimeSupplyChain,
  type RuntimeInvokeAssurance,
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

function compileNative(source: string, output: string, defines: string[] = []): void {
  const result = spawnSync(
    process.env.CC || 'cc',
    ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', ...defines, source, '-o', output],
    { encoding: 'utf8' },
  );
  assert.equal(
    result.status,
    0,
    `native fixture compilation failed: ${result.error?.message || result.stderr || result.stdout}`,
  );
  chmodSync(output, 0o755);
}

function nativeFixture(version: string, payloadText: string): ReturnType<typeof fixture> {
  const base = fixture(version);
  compileNative(join(HERE, 'fixtures', 'runtime-test-payload.c'), base.artifact, [
    `-DPAYLOAD_TEXT="${payloadText}"`,
  ]);
  const hash = createHash('sha256').update(readFileSync(base.artifact)).digest('hex');
  const provenance = JSON.parse(readFileSync(base.provenance, 'utf8')) as Record<string, unknown>;
  provenance.sha256 = hash;
  writeFileSync(base.provenance, `${JSON.stringify(provenance, null, 2)}\n`);
  return { ...base, hash };
}

function manager(home: string): RuntimeSupplyChain {
  return createRuntimeSupplyChain({ env: { HOME: join(home, '..'), CC_MASTER_HOME: home } });
}

function createPlatformNeutralContractBackend(
  expectedAsset: string,
  invokeAssurance: RuntimeInvokeAssurance = {
    object_binding: 'exact-fd-v1',
    publisher_identity: 'local-sha256-provenance',
    active_same_uid_replacement: 'resistant',
    platform: `test-${process.arch}`,
  },
): RuntimePlatformBackend {
  return {
    id: 'test-platform-neutral-no-symlink-v1',
    platform: 'win32-simulated',
    arch: process.arch,
    activationSupported: true,
    expectedAsset,
    invokeAssurance,
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

function launcherDirectory(home: string): string {
  return join(runtimeRoot(home), 'launcher');
}

function launcherHelperEntries(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => /^(?:linux-exact-fd-v1|darwin-path-attested-v1)-[a-f0-9]{64}$/.test(name))
    .sort();
}

function launcherHelpers(home: string): string[] {
  return launcherHelperEntries(launcherDirectory(home));
}

function builtLauncherHelperName(): string {
  const contract = process.platform === 'linux' ? 'linux-exact-fd-v1' : 'darwin-path-attested-v1';
  const bytes = readFileSync(join(HERE, '..', '.native-build', 'runtime-invoke-helper'));
  return `${contract}-${createHash('sha256').update(bytes).digest('hex')}`;
}

function launcherContract(): 'linux-exact-fd-v1' | 'darwin-path-attested-v1' {
  return process.platform === 'linux' ? 'linux-exact-fd-v1' : 'darwin-path-attested-v1';
}

function materializerRoot(home: string): string {
  return join(runtimeRoot(home), 'materializers');
}

function materializerInstanceName(
  publisherPid = 99_999_999,
  uuid = '00000000-0000-0000-0000-000000000001',
): string {
  return `.materializer-${launcherContract()}-${publisherPid}-${uuid}.tmp`;
}

function ensureMaterializerRoot(home: string): string {
  const root = materializerRoot(home);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  return root;
}

function seedMaterializerInstance(
  home: string,
  options: {
    publisherPid?: number;
    uuid?: string;
    mode?: 0o600 | 0o500;
    empty?: boolean;
  } = {},
): string {
  const root = ensureMaterializerRoot(home);
  const instance = join(root, materializerInstanceName(options.publisherPid, options.uuid));
  mkdirSync(instance, { mode: 0o700 });
  chmodSync(instance, 0o700);
  if (!options.empty) {
    const executable = join(instance, 'materializer');
    writeFileSync(executable, 'attributed-materializer-bootstrap', {
      mode: options.mode ?? 0o500,
    });
    chmodSync(executable, options.mode ?? 0o500);
  }
  return instance;
}

function materializerInstances(home: string): string[] {
  const root = materializerRoot(home);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((name) => join(root, name))
    .sort();
}

function observedMaterializerBootstraps(home: string): string[] {
  const observed: string[] = [];
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith('ccm-runtime-materializer-')) continue;
    const executable = join(tmpdir(), name, 'materializer');
    if (existsSync(executable)) observed.push(executable);
  }
  const managedRoot = materializerRoot(home);
  if (existsSync(managedRoot)) {
    for (const name of readdirSync(managedRoot)) {
      const executable = join(managedRoot, name, 'materializer');
      if (existsSync(executable)) observed.push(executable);
    }
  }
  return observed.sort();
}

async function waitForCondition(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 600; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

function assertRecoveredLauncherDirectory(home: string): void {
  const directory = lstatSync(launcherDirectory(home));
  assert.equal(directory.isDirectory(), true);
  assert.equal(directory.isSymbolicLink(), false);
  assert.equal(directory.mode & 0o777, 0o700, 'launcher directory must recover stable 0700');
  if (typeof process.geteuid === 'function') {
    assert.equal(directory.uid, process.geteuid(), 'launcher directory owner drifted');
  }
  assert.equal(
    readdirSync(launcherDirectory(home)).some((name) => name.endsWith('.tmp')),
    false,
    'dead publisher temp survived a successful invoke',
  );
}

function expectRuntimeError(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: any) => {
    assert.equal(error.code, code, error?.stack || String(error));
    return true;
  });
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
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
  return new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr })),
  );
}

async function waitForFile(
  filePath: string,
  child: ReturnType<typeof spawn>,
  label: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(filePath)) {
    assert.equal(child.exitCode, null, `${label} exited before publishing its ready handshake`);
    assert.ok(Date.now() < deadline, `${label} did not publish its ready handshake`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
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
  assert.equal(
    resolved.invoke_assurance.object_binding,
    process.platform === 'linux' ? 'exact-fd-v1' : 'path-attested-v1',
  );
  assert.equal(
    resolved.invoke_assurance.active_same_uid_replacement,
    process.platform === 'linux' ? 'resistant' : 'residual',
  );
  assert.deepEqual(runtime.doctor().backend.invoke_assurance, resolved.invoke_assurance);
  assert.equal(existsSync(join(f.home, 'boards', 'keep.board.json')), true);
});

test('exact-object callers fail closed before spawn on a path-attested backend', () => {
  const first = fixture('1.2.4');
  const provenance = JSON.parse(readFileSync(first.provenance, 'utf8')) as { asset: string };
  const base = createPlatformNeutralContractBackend(provenance.asset, {
    object_binding: 'path-attested-v1',
    publisher_identity: 'local-sha256-provenance',
    active_same_uid_replacement: 'residual',
    platform: `test-${process.arch}`,
  });
  let spawnCalls = 0;
  const backend: RuntimePlatformBackend = {
    ...base,
    spawnVerifiedImage() {
      spawnCalls += 1;
      return spawnSync(process.execPath, ['--version']);
    },
  };
  const runtime = createRuntimeSupplyChain({ env: { CC_MASTER_HOME: first.home }, backend });
  const staged = runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance });
  runtime.activate(staged.transaction_id);

  expectRuntimeError(
    () => runtime.invoke([], { requireAssurance: 'exact-object' }),
    'RUNTIME_INVOKE_ASSURANCE',
  );
  assert.equal(spawnCalls, 0, 'strict assurance rejection happens before child creation');

  const invoked = runtime.invoke([]);
  assert.equal(invoked.exit_code, 0);
  assert.equal(spawnCalls, 1, 'non-strict caller may explicitly consume the advertised residual');

  const exactRuntime = createRuntimeSupplyChain({
    env: { CC_MASTER_HOME: first.home },
    backend: {
      ...backend,
      invokeAssurance: {
        object_binding: 'exact-fd-v1',
        publisher_identity: 'local-sha256-provenance',
        active_same_uid_replacement: 'resistant',
        platform: `test-${process.arch}`,
      },
    },
  });
  assert.equal(exactRuntime.invoke([], { requireAssurance: 'exact-object' }).exit_code, 0);
  assert.equal(spawnCalls, 2);
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

test('native invoke enforces the platform assurance tier under a managed-path TOCTOU mutant', () => {
  const first = nativeFixture('4.1.0', 'trusted');
  const malicious = nativeFixture('4.1.9', 'malicious');
  const base = createDefaultRuntimeBackend();
  let swapped = false;
  const mutant = join(first.root, 'runtime-path-swap-mutant');
  compileNative(join(HERE, 'fixtures', 'runtime-path-swap-mutant.c'), mutant);
  const backend: RuntimePlatformBackend = {
    ...base,
    spawnVerifiedImage(imagePath, imageFd, args, childEnv, context) {
      const imageDir = join(imagePath, '..');
      const maliciousPath = join(imageDir, '.native-mutant');
      chmodSync(imageDir, 0o700);
      copyFileSync(malicious.artifact, maliciousPath);
      chmodSync(maliciousPath, 0o500);
      const mutation = spawnSync(mutant, [imagePath, maliciousPath, `${imagePath}.verified`], {
        encoding: 'utf8',
      });
      assert.equal(
        mutation.status,
        0,
        `native TOCTOU mutant failed: ${mutation.error?.message || mutation.stderr}`,
      );
      chmodSync(imageDir, 0o500);
      swapped = true;
      return base.spawnVerifiedImage(imagePath, imageFd, args, childEnv, context);
    },
  };
  const runtime = createRuntimeSupplyChain({ env: { CC_MASTER_HOME: first.home }, backend });
  const staged = runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance });
  runtime.activate(staged.transaction_id);
  const output = join(first.root, 'invoke-output');
  if (process.platform === 'linux') {
    const invoked = runtime.invoke([output]);
    assert.equal(invoked.exit_code, 0);
    assert.equal(readFileSync(output, 'utf8'), 'trusted');
  } else {
    expectRuntimeError(() => runtime.invoke([output]), 'RUNTIME_INVOKE_EXEC');
    assert.equal(
      existsSync(output),
      false,
      'Darwin final attestation rejects the swapped pathname',
    );
  }
  assert.equal(swapped, true);
});

test('native verified-exec helper failure is structured and never half-executes the payload', () => {
  const first = nativeFixture('4.1.1', 'half-executed');
  const invalidHelper = Buffer.from('not a native executable');
  const backend = createDefaultRuntimeBackend(
    process.platform,
    process.arch,
    typeof process.geteuid === 'function' ? process.geteuid() : null,
    {
      contract: process.platform === 'linux' ? 'linux-exact-fd-v1' : 'darwin-path-attested-v1',
      platform: process.platform,
      arch: process.arch,
      sha256: createHash('sha256').update(invalidHelper).digest('hex'),
      bytes: invalidHelper,
    },
  );
  const runtime = createRuntimeSupplyChain({ env: { CC_MASTER_HOME: first.home }, backend });
  const staged = runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance });
  runtime.activate(staged.transaction_id);
  const output = join(first.root, 'must-not-exist');

  expectRuntimeError(() => runtime.invoke([output]), 'RUNTIME_INVOKE_BACKEND');
  assert.equal(existsSync(output), false, 'payload must not run when the launcher cannot exec');
});

test('native image exec-format failure is structured without a shell fallback', () => {
  const first = fixture('4.1.2', 'printf half-executed > "$1"\n');
  const runtime = manager(first.home);
  const staged = runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance });
  runtime.activate(staged.transaction_id);
  const output = join(first.root, 'must-not-exist');

  expectRuntimeError(() => runtime.invoke([output]), 'RUNTIME_INVOKE_EXEC');
  assert.equal(
    existsSync(output),
    false,
    'invalid image bytes must never be interpreted by a shell',
  );
});

test('materialization never changes same-process Worker relative path resolution', () => {
  const first = nativeFixture('4.1.3', 'cwd-worker-trusted');
  const runtime = manager(first.home);
  const staged = runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance });
  runtime.activate(staged.transaction_id);
  const output = join(first.root, 'cwd-worker-output');
  const probeDirectory = join(first.root, 'caller-cwd');
  mkdirSync(probeDirectory, { mode: 0o700 });
  const probe = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      join(HERE, 'fixtures', 'runtime-launcher-cwd-worker-probe.ts'),
      first.home,
      output,
      probeDirectory,
    ],
    { cwd: join(HERE, '..'), encoding: 'utf8' },
  );
  assert.equal(probe.status, 0, probe.stderr);
  const result = JSON.parse(probe.stdout) as {
    exit_code: number;
    cwd: string;
    workerResult: string;
  };
  assert.equal(result.exit_code, 0);
  assert.equal(result.cwd, probeDirectory);
  assert.equal(result.workerResult, 'caller-cwd');
  assert.equal(readFileSync(output, 'utf8'), 'cwd-worker-trusted');
});

test('nested launcher materialization is reentrant and preserves the caller cwd', () => {
  const first = nativeFixture('4.1.4', 'nested-materialization');
  let nested = false;
  const nestedOutput = join(first.root, 'nested-output');
  const backend = createDefaultRuntimeBackend(
    process.platform,
    process.arch,
    typeof process.geteuid === 'function' ? process.geteuid() : null,
    undefined,
    {
      fault(point) {
        if (point !== 'after_directory_recovery' || nested) return;
        nested = true;
        assert.equal(manager(first.home).invoke([nestedOutput]).exit_code, 0);
      },
    },
  );
  const runtime = createRuntimeSupplyChain({ env: { CC_MASTER_HOME: first.home }, backend });
  const staged = runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance });
  runtime.activate(staged.transaction_id);
  const before = process.cwd();
  const outerOutput = join(first.root, 'outer-output');
  assert.equal(runtime.invoke([outerOutput]).exit_code, 0);
  assert.equal(process.cwd(), before);
  assert.equal(readFileSync(nestedOutput, 'utf8'), 'nested-materialization');
  assert.equal(readFileSync(outerOutput, 'utf8'), 'nested-materialization');
});

test('two concurrent cold invokes both succeed through one digest-pinned launcher publication', async () => {
  const first = nativeFixture('4.1.5', 'concurrent-trusted');
  const runtime = manager(first.home);
  const staged = runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance });
  runtime.activate(staged.transaction_id);
  assert.deepEqual(
    launcherHelpers(first.home),
    [],
    'fixture must begin with a cold launcher cache',
  );

  const worker = join(HERE, 'fixtures', 'runtime-launcher-materialization-worker.ts');
  const barrier = join(first.root, 'publish-go');
  const readyA = join(first.root, 'ready-a');
  const readyB = join(first.root, 'ready-b');
  const outputA = join(first.root, 'output-a');
  const outputB = join(first.root, 'output-b');
  const args = ['--import', 'tsx', worker, first.home];
  const a = spawn(
    process.execPath,
    [...args, outputA, readyA, barrier, 'before_helper_publish_native'],
    {
      cwd: join(HERE, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const b = spawn(
    process.execPath,
    [...args, outputB, readyB, barrier, 'before_helper_publish_native'],
    {
      cwd: join(HERE, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  for (let i = 0; i < 400 && !(existsSync(readyA) && existsSync(readyB)); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(existsSync(readyA) && existsSync(readyB), true, 'both publishers reached rename');
  writeFileSync(barrier, 'go');
  const [resultA, resultB] = await Promise.all([waitForExit(a), waitForExit(b)]);
  assert.equal(resultA.code, 0, resultA.stderr);
  assert.equal(resultB.code, 0, resultB.stderr);
  assert.equal(readFileSync(outputA, 'utf8'), 'concurrent-trusted');
  assert.equal(readFileSync(outputB, 'utf8'), 'concurrent-trusted');

  const helpers = launcherHelpers(first.home);
  assert.equal(helpers.length, 1, 'cold race must expose one digest-pinned final helper');
  const helper = join(launcherDirectory(first.home), helpers[0] as string);
  const helperStat = lstatSync(helper);
  assert.equal(helperStat.mode & 0o777, 0o500);
  if (typeof process.geteuid === 'function') assert.equal(helperStat.uid, process.geteuid());
  assert.equal(
    createHash('sha256').update(readFileSync(helper)).digest('hex'),
    helpers[0]?.slice(-64),
    'published helper bytes must match its digest-pinned name',
  );
  assertRecoveredLauncherDirectory(first.home);
});

test('shared materializer root churn between lstat and open preserves directory identity', async () => {
  const first = nativeFixture('4.1.5-root-churn', 'root-churn-trusted');
  const runtime = manager(first.home);
  const staged = runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance });
  runtime.activate(staged.transaction_id);
  ensureMaterializerRoot(first.home);

  const worker = join(HERE, 'fixtures', 'runtime-launcher-materialization-worker.ts');
  const barrier = join(first.root, 'root-open-go');
  const ready = join(first.root, 'root-lstat-ready');
  const blockedOutput = join(first.root, 'blocked-output');
  const concurrentOutput = join(first.root, 'concurrent-output');
  const args = ['--import', 'tsx', worker, first.home];
  const blocked = spawn(
    process.execPath,
    [...args, blockedOutput, ready, barrier, 'after_materializer_root_lstat'],
    {
      cwd: join(HERE, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const blockedExit = waitForExit(blocked);
  await waitForCondition(
    () => existsSync(ready),
    'blocked publisher did not reach the materializer root lstat/open seam',
  );

  const concurrent = spawn(process.execPath, [...args, concurrentOutput], {
    cwd: join(HERE, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const concurrentResult = await waitForExit(concurrent);
  writeFileSync(barrier, 'go');
  const blockedResult = await blockedExit;
  assert.equal(concurrentResult.code, 0, concurrentResult.stderr);
  assert.equal(readFileSync(concurrentOutput, 'utf8'), 'root-churn-trusted');
  assert.equal(blockedResult.code, 0, blockedResult.stderr);
  assert.equal(readFileSync(blockedOutput, 'utf8'), 'root-churn-trusted');
  assert.deepEqual(materializerInstances(first.home), []);
  assert.equal(launcherHelpers(first.home).length, 1);
  assertRecoveredLauncherDirectory(first.home);
});

test('a concurrently appearing invalid launcher final is preserved and rejected', async () => {
  const first = nativeFixture('4.1.6', 'must-not-run-invalid-final');
  const finalPath = join(launcherDirectory(first.home), builtLauncherHelperName());
  const invalidBytes = Buffer.from('concurrent-invalid-launcher-final');
  const readyPath = join(first.root, 'invalid-final-ready');
  const barrierPath = join(first.root, 'invalid-final-go');
  const backend = createDefaultRuntimeBackend(
    process.platform,
    process.arch,
    typeof process.geteuid === 'function' ? process.geteuid() : null,
    undefined,
    {
      nativeTest: {
        point: 'before_helper_publish',
        readyPath,
        barrierPath,
        action: 'pause',
      },
    } as any,
  );
  const runtime = createRuntimeSupplyChain({ env: { CC_MASTER_HOME: first.home }, backend });
  const staged = runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance });
  runtime.activate(staged.transaction_id);

  const output = join(first.root, 'invalid-final-output');
  const publisher = new Worker(
    `
      const { chmodSync, existsSync, writeFileSync } = require('node:fs');
      const { workerData } = require('node:worker_threads');
      const deadline = Date.now() + 3000;
      while (!existsSync(workerData.readyPath) && Date.now() < deadline) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
      if (!existsSync(workerData.readyPath)) throw new Error('materializer seam timeout');
      writeFileSync(workerData.finalPath, Buffer.from(workerData.bytes, 'base64'), { mode: 0o500 });
      chmodSync(workerData.finalPath, 0o500);
      writeFileSync(workerData.barrierPath, 'go');
    `,
    {
      eval: true,
      workerData: {
        readyPath,
        barrierPath,
        finalPath,
        bytes: invalidBytes.toString('base64'),
      },
    },
  );
  try {
    expectRuntimeError(() => runtime.invoke([output]), 'RUNTIME_INVOKE_BACKEND');
  } finally {
    await publisher.terminate();
  }
  assert.equal(existsSync(output), false, 'payload ran after invalid final publication');
  assert.deepEqual(readFileSync(finalPath), invalidBytes, 'invalid final was overwritten');
});

test('launcher pathname replacement after pinning cannot redirect publication', () => {
  const first = nativeFixture('4.1.7', 'must-not-run-path-replacement');
  const launcherDir = launcherDirectory(first.home);
  const pinnedDirectory = `${launcherDir}.pinned`;
  const backend = createDefaultRuntimeBackend(
    process.platform,
    process.arch,
    typeof process.geteuid === 'function' ? process.geteuid() : null,
    undefined,
    {
      fault(point) {
        if (point !== 'after_directory_recovery') return;
        renameSync(launcherDir, pinnedDirectory);
        mkdirSync(launcherDir, { mode: 0o700 });
        chmodSync(launcherDir, 0o700);
      },
    },
  );
  const runtime = createRuntimeSupplyChain({ env: { CC_MASTER_HOME: first.home }, backend });
  const staged = runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance });
  runtime.activate(staged.transaction_id);

  const output = join(first.root, 'path-replacement-output');
  expectRuntimeError(() => runtime.invoke([output]), 'RUNTIME_INVOKE_BACKEND');
  assert.equal(existsSync(output), false, 'payload ran through a replacement launcher directory');
  assert.deepEqual(
    launcherHelperEntries(launcherDir),
    [],
    'publication escaped from the pinned directory into the replacement pathname',
  );
  assert.equal(
    launcherHelperEntries(pinnedDirectory).length,
    1,
    'publication did not remain bound to the pinned directory object',
  );
});

test('an independently verified valid launcher final is idempotent', () => {
  const first = nativeFixture('4.1.8', 'valid-final-idempotent');
  const runtime = manager(first.home);
  const staged = runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance });
  runtime.activate(staged.transaction_id);

  const firstOutput = join(first.root, 'valid-final-first');
  assert.equal(runtime.invoke([firstOutput]).exit_code, 0);
  const finalPath = join(launcherDirectory(first.home), builtLauncherHelperName());
  const before = lstatSync(finalPath);

  const secondOutput = join(first.root, 'valid-final-second');
  assert.equal(runtime.invoke([secondOutput]).exit_code, 0);
  const after = lstatSync(finalPath);
  assert.equal(after.dev, before.dev);
  assert.equal(after.ino, before.ino, 'valid final was republished instead of reused');
  assert.equal(readFileSync(secondOutput, 'utf8'), 'valid-final-idempotent');
  assertRecoveredLauncherDirectory(first.home);
});

test('dead-temp cleanup is idempotent across two cold publishers', async () => {
  const first = nativeFixture('4.1.9', 'stale-temp-concurrent');
  const runtime = manager(first.home);
  const staged = runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance });
  runtime.activate(staged.transaction_id);
  const staleName = `.${launcherContract()}-99999999-00000000-0000-0000-0000-000000000001.tmp`;
  const stalePath = join(launcherDirectory(first.home), staleName);
  writeFileSync(stalePath, 'abandoned-publisher', { mode: 0o600 });
  chmodSync(stalePath, 0o600);

  const worker = join(HERE, 'fixtures', 'runtime-launcher-materialization-worker.ts');
  const barrier = join(first.root, 'cleanup-go');
  const readyA = join(first.root, 'cleanup-ready-a');
  const readyB = join(first.root, 'cleanup-ready-b');
  const outputA = join(first.root, 'cleanup-output-a');
  const outputB = join(first.root, 'cleanup-output-b');
  const args = ['--import', 'tsx', worker, first.home];
  const a = spawn(process.execPath, [...args, outputA, readyA, barrier, 'before_temp_cleanup'], {
    cwd: join(HERE, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const b = spawn(process.execPath, [...args, outputB, readyB, barrier, 'before_temp_cleanup'], {
    cwd: join(HERE, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let index = 0; index < 600 && !(existsSync(readyA) && existsSync(readyB)); index++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(
    existsSync(readyA) && existsSync(readyB),
    true,
    'both cleanup processes must snapshot the proven stale candidate before release',
  );
  writeFileSync(barrier, 'go');
  const [resultA, resultB] = await Promise.all([waitForExit(a), waitForExit(b)]);
  assert.equal(resultA.code, 0, resultA.stderr);
  assert.equal(resultB.code, 0, resultB.stderr);
  assert.equal(readFileSync(outputA, 'utf8'), 'stale-temp-concurrent');
  assert.equal(readFileSync(outputB, 'utf8'), 'stale-temp-concurrent');
  assert.equal(existsSync(stalePath), false, 'stale temp survived concurrent cleanup');
  assert.equal(launcherHelpers(first.home).length, 1, 'cleanup race published multiple finals');
  assertRecoveredLauncherDirectory(first.home);
});

test('dead-temp cleanup fails closed on surviving symlink, type, and permission anomalies', () => {
  const cases = ['symlink', 'directory', 'permission'] as const;
  for (const [index, kind] of cases.entries()) {
    const first = nativeFixture(`4.1.${10 + index}`, `cleanup-reject-${kind}`);
    const runtime = manager(first.home);
    const staged = runtime.stage({
      artifactPath: first.artifact,
      provenancePath: first.provenance,
    });
    runtime.activate(staged.transaction_id);
    const staleName = `.${launcherContract()}-99999999-00000000-0000-0000-0000-00000000000${index + 2}.tmp`;
    const stalePath = join(launcherDirectory(first.home), staleName);
    if (kind === 'symlink') {
      const target = join(first.root, 'untrusted-temp-target');
      writeFileSync(target, 'untrusted');
      symlinkSync(target, stalePath);
    } else if (kind === 'directory') {
      mkdirSync(stalePath, { mode: 0o700 });
    } else {
      writeFileSync(stalePath, 'untrusted-permissions', { mode: 0o644 });
      chmodSync(stalePath, 0o644);
    }
    const output = join(first.root, `cleanup-reject-${kind}-output`);
    expectRuntimeError(() => runtime.invoke([output]), 'RUNTIME_INVOKE_BACKEND');
    assert.equal(existsSync(output), false, `${kind}: payload unexpectedly ran`);
    assert.equal(existsSync(stalePath), true, `${kind}: invalid stale entry was removed`);
  }
});

test('a real publisher-parent SIGKILL cannot strand an executable materializer bootstrap', async () => {
  const first = nativeFixture('4.1.13', 'parent-sigkill-bootstrap-recovery');
  const runtime = manager(first.home);
  const staged = runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance });
  runtime.activate(staged.transaction_id);

  const worker = join(HERE, 'fixtures', 'runtime-launcher-materialization-worker.ts');
  const interruptedOutput = join(first.root, 'real-parent-sigkill-interrupted');
  const ready = join(first.root, 'real-parent-sigkill-ready');
  const barrier = join(first.root, 'real-parent-sigkill-go');
  const before = new Set(observedMaterializerBootstraps(first.home));
  const publisher = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      worker,
      first.home,
      interruptedOutput,
      ready,
      barrier,
      'before_bootstrap_self_cleanup_native',
    ],
    { cwd: join(HERE, '..'), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let during: string[] = [];
  try {
    await waitForCondition(
      () => existsSync(ready),
      'native child did not reach the pre-self-clean pause seam',
    );
    during = observedMaterializerBootstraps(first.home).filter((entry) => !before.has(entry));
    assert.equal(during.length, 1, 'crash probe did not observe one live bootstrap executable');
    publisher.kill('SIGKILL');
    const crashed = await waitForExit(publisher);
    assert.equal(crashed.code, null, crashed.stderr);
    assert.equal(crashed.signal, 'SIGKILL', crashed.stderr);

    writeFileSync(barrier, 'go');
    await waitForCondition(
      () => launcherHelpers(first.home).length === 1,
      'orphaned native child did not finish helper publication',
    );
    const leaked = during.filter((entry) => existsSync(entry));
    assert.deepEqual(
      leaked,
      [],
      `real parent SIGKILL leaked bootstrap evidence ${JSON.stringify({ during, leaked })}`,
    );
  } finally {
    if (publisher.exitCode === null && publisher.signalCode === null) publisher.kill('SIGKILL');
    if (!existsSync(barrier)) writeFileSync(barrier, 'go');
    for (const executable of during) {
      const attributedRoot = dirname(executable);
      if (existsSync(attributedRoot)) rmSync(attributedRoot, { recursive: true, force: true });
    }
  }
});

test('a publisher crash after bootstrap creation is reclaimed by the next activation', async () => {
  const first = nativeFixture('4.1.14', 'pre-spawn-bootstrap-recovery');
  const runtime = manager(first.home);
  const staged = runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance });
  runtime.activate(staged.transaction_id);
  const worker = join(HERE, 'fixtures', 'runtime-launcher-materialization-worker.ts');
  const interruptedOutput = join(first.root, 'pre-spawn-interrupted');
  const ready = join(first.root, 'pre-spawn-ready');
  const barrier = join(first.root, 'pre-spawn-go');
  const publisher = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      worker,
      first.home,
      interruptedOutput,
      ready,
      barrier,
      'after_materializer_bootstrap_create',
    ],
    { cwd: join(HERE, '..'), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try {
    await waitForCondition(
      () => existsSync(ready),
      'publisher did not pause after bootstrap create',
    );
    const attributed = materializerInstances(first.home);
    assert.equal(
      attributed.length,
      1,
      'pre-spawn seam did not expose one owned bootstrap instance',
    );
    publisher.kill('SIGKILL');
    const crashed = await waitForExit(publisher);
    assert.equal(crashed.code, null, crashed.stderr);
    assert.equal(crashed.signal, 'SIGKILL', crashed.stderr);
    assert.equal(existsSync(attributed[0] as string), true, 'fixture did not capture stale owner');

    const recoveredOutput = join(first.root, 'pre-spawn-recovered');
    assert.equal(runtime.invoke([recoveredOutput]).exit_code, 0);
    assert.equal(readFileSync(recoveredOutput, 'utf8'), 'pre-spawn-bootstrap-recovery');
    assert.deepEqual(
      materializerInstances(first.home),
      [],
      'dead pre-spawn owner survived recovery',
    );
  } finally {
    if (publisher.exitCode === null && publisher.signalCode === null) publisher.kill('SIGKILL');
    if (!existsSync(barrier)) writeFileSync(barrier, 'go');
  }
});

test('native bootstrap self-clean survives parent SIGKILL before and after helper publication', async () => {
  const points = ['before_bootstrap_self_cleanup_native', 'after_helper_publish_native'] as const;
  const worker = join(HERE, 'fixtures', 'runtime-launcher-materialization-worker.ts');
  for (const [index, point] of points.entries()) {
    const first = nativeFixture(`4.1.${15 + index}`, `bootstrap-self-clean-${point}`);
    const runtime = manager(first.home);
    const staged = runtime.stage({
      artifactPath: first.artifact,
      provenancePath: first.provenance,
    });
    runtime.activate(staged.transaction_id);
    const ready = join(first.root, `${point}-parent-ready`);
    const barrier = join(first.root, `${point}-parent-go`);
    const interruptedOutput = join(first.root, `${point}-interrupted`);
    const publisher = spawn(
      process.execPath,
      ['--import', 'tsx', worker, first.home, interruptedOutput, ready, barrier, point],
      { cwd: join(HERE, '..'), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    try {
      await waitForCondition(() => existsSync(ready), `${point}: native seam was not reached`);
      const during = materializerInstances(first.home)
        .map((instance) => join(instance, 'materializer'))
        .filter((entry) => existsSync(entry));
      if (point === 'before_bootstrap_self_cleanup_native') {
        assert.equal(during.length, 1, `${point}: expected live bootstrap was not observable`);
      }
      publisher.kill('SIGKILL');
      const crashed = await waitForExit(publisher);
      assert.equal(crashed.code, null, crashed.stderr);
      assert.equal(crashed.signal, 'SIGKILL', crashed.stderr);
      writeFileSync(barrier, 'go');
      await waitForCondition(
        () => launcherHelpers(first.home).length === 1,
        `${point}: orphaned native child did not finish`,
      );
      await waitForCondition(
        () => materializerInstances(first.home).length === 0,
        `${point}: executable bootstrap survived orphan completion`,
      );

      const recoveredOutput = join(first.root, `${point}-recovered`);
      assert.equal(runtime.invoke([recoveredOutput]).exit_code, 0);
      assert.equal(readFileSync(recoveredOutput, 'utf8'), `bootstrap-self-clean-${point}`);
      assert.deepEqual(materializerInstances(first.home), []);
    } finally {
      if (publisher.exitCode === null && publisher.signalCode === null) publisher.kill('SIGKILL');
      if (!existsSync(barrier)) writeFileSync(barrier, 'go');
    }
  }
});

test('dead publisher materializer bootstrap instances are recovered without touching live owners', () => {
  const staleCases = [
    { label: 'partial-write', mode: 0o600 as const },
    { label: 'sealed', mode: 0o500 as const },
    { label: 'empty', empty: true },
  ];
  for (const [index, staleCase] of staleCases.entries()) {
    const first = nativeFixture(`4.1.${14 + index}`, `bootstrap-recovery-${staleCase.label}`);
    const runtime = manager(first.home);
    const staged = runtime.stage({
      artifactPath: first.artifact,
      provenancePath: first.provenance,
    });
    runtime.activate(staged.transaction_id);
    const stale = seedMaterializerInstance(first.home, {
      uuid: `00000000-0000-0000-0000-00000000001${index}`,
      mode: staleCase.mode,
      empty: staleCase.empty,
    });
    const live = seedMaterializerInstance(first.home, {
      publisherPid: process.pid,
      uuid: `00000000-0000-0000-0000-00000000002${index}`,
    });

    const output = join(first.root, `bootstrap-recovery-${staleCase.label}-output`);
    assert.equal(runtime.invoke([output]).exit_code, 0);
    assert.equal(readFileSync(output, 'utf8'), `bootstrap-recovery-${staleCase.label}`);
    assert.equal(existsSync(stale), false, `${staleCase.label}: dead owner instance survived`);
    assert.equal(existsSync(live), true, `${staleCase.label}: live owner instance was reclaimed`);
  }
});

test('dead materializer bootstrap recovery is idempotent across concurrent activations', async () => {
  const first = nativeFixture('4.1.22', 'concurrent-bootstrap-recovery');
  const runtime = manager(first.home);
  const staged = runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance });
  runtime.activate(staged.transaction_id);
  const stale = seedMaterializerInstance(first.home, {
    uuid: '00000000-0000-0000-0000-000000000099',
  });
  const worker = join(HERE, 'fixtures', 'runtime-launcher-materialization-worker.ts');
  const barrier = join(first.root, 'bootstrap-recovery-go');
  const readyA = join(first.root, 'bootstrap-recovery-ready-a');
  const readyB = join(first.root, 'bootstrap-recovery-ready-b');
  const outputA = join(first.root, 'bootstrap-recovery-output-a');
  const outputB = join(first.root, 'bootstrap-recovery-output-b');
  const args = ['--import', 'tsx', worker, first.home];
  const a = spawn(
    process.execPath,
    [...args, outputA, readyA, barrier, 'before_bootstrap_recovery_native'],
    { cwd: join(HERE, '..'), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const b = spawn(
    process.execPath,
    [...args, outputB, readyB, barrier, 'before_bootstrap_recovery_native'],
    { cwd: join(HERE, '..'), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try {
    await waitForCondition(
      () => existsSync(readyA) && existsSync(readyB),
      'both recovery workers must snapshot the dead bootstrap before release',
    );
    writeFileSync(barrier, 'go');
    const [resultA, resultB] = await Promise.all([waitForExit(a), waitForExit(b)]);
    assert.equal(resultA.code, 0, resultA.stderr);
    assert.equal(resultB.code, 0, resultB.stderr);
    assert.equal(readFileSync(outputA, 'utf8'), 'concurrent-bootstrap-recovery');
    assert.equal(readFileSync(outputB, 'utf8'), 'concurrent-bootstrap-recovery');
    assert.equal(existsSync(stale), false, 'dead bootstrap survived concurrent recovery');
    assert.deepEqual(materializerInstances(first.home), []);
  } finally {
    if (a.exitCode === null && a.signalCode === null) a.kill('SIGKILL');
    if (b.exitCode === null && b.signalCode === null) b.kill('SIGKILL');
    if (!existsSync(barrier)) writeFileSync(barrier, 'go');
  }
});

test('native materializer self-cleans its own bootstrap before stale recovery', async () => {
  const first = nativeFixture('4.1.23', 'bootstrap-self-clean-order');
  const runtime = manager(first.home);
  const staged = runtime.stage({ artifactPath: first.artifact, provenancePath: first.provenance });
  runtime.activate(staged.transaction_id);
  const worker = join(HERE, 'fixtures', 'runtime-launcher-materialization-worker.ts');
  const ready = join(first.root, 'bootstrap-self-clean-order-ready');
  const barrier = join(first.root, 'bootstrap-self-clean-order-go');
  const output = join(first.root, 'bootstrap-self-clean-order-output');
  const publisher = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      worker,
      first.home,
      output,
      ready,
      barrier,
      'before_bootstrap_recovery_native',
    ],
    { cwd: join(HERE, '..'), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try {
    await waitForCondition(() => existsSync(ready), 'native child did not reach recovery seam');
    assert.deepEqual(
      materializerInstances(first.home),
      [],
      'own bootstrap remained published until parent graceful cleanup',
    );
    writeFileSync(barrier, 'go');
    const result = await waitForExit(publisher);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(readFileSync(output, 'utf8'), 'bootstrap-self-clean-order');
  } finally {
    if (publisher.exitCode === null && publisher.signalCode === null) publisher.kill('SIGKILL');
    if (!existsSync(barrier)) writeFileSync(barrier, 'go');
  }
});

test('materializer bootstrap recovery fails closed on symlink, type, and permission anomalies', () => {
  const cases = [
    'root-symlink',
    'root-mode',
    'instance-symlink',
    'instance-file',
    'instance-mode',
    'bootstrap-symlink',
    'bootstrap-mode',
    'unknown-leaf',
  ] as const;
  for (const [index, kind] of cases.entries()) {
    const first = nativeFixture(`4.1.${17 + index}`, `must-not-run-bootstrap-${kind}`);
    const runtime = manager(first.home);
    const staged = runtime.stage({
      artifactPath: first.artifact,
      provenancePath: first.provenance,
    });
    runtime.activate(staged.transaction_id);
    const root = materializerRoot(first.home);
    let anomaly: string;
    if (kind === 'root-symlink') {
      rmSync(root, { recursive: true, force: true });
      const target = join(first.root, 'untrusted-materializer-root');
      mkdirSync(target, { mode: 0o700 });
      symlinkSync(target, root);
      anomaly = root;
    } else if (kind === 'root-mode') {
      ensureMaterializerRoot(first.home);
      chmodSync(root, 0o755);
      anomaly = root;
    } else if (kind === 'instance-symlink' || kind === 'instance-file') {
      ensureMaterializerRoot(first.home);
      anomaly = join(
        root,
        materializerInstanceName(99_999_999, `00000000-0000-0000-0000-00000000003${index}`),
      );
      if (kind === 'instance-symlink') {
        const target = join(first.root, 'untrusted-materializer-instance');
        mkdirSync(target, { mode: 0o700 });
        symlinkSync(target, anomaly);
      } else {
        writeFileSync(anomaly, 'untrusted-instance-file', { mode: 0o600 });
      }
    } else {
      anomaly = seedMaterializerInstance(first.home, {
        uuid: `00000000-0000-0000-0000-00000000003${index}`,
      });
      if (kind === 'instance-mode') chmodSync(anomaly, 0o755);
      if (kind === 'bootstrap-symlink') {
        const bootstrap = join(anomaly, 'materializer');
        const target = join(first.root, 'untrusted-materializer-bootstrap');
        writeFileSync(target, 'untrusted');
        unlinkSync(bootstrap);
        symlinkSync(target, bootstrap);
      }
      if (kind === 'bootstrap-mode') chmodSync(join(anomaly, 'materializer'), 0o644);
      if (kind === 'unknown-leaf') writeFileSync(join(anomaly, 'unknown'), 'untrusted');
    }

    const output = join(first.root, `must-not-run-bootstrap-${kind}-output`);
    expectRuntimeError(() => runtime.invoke([output]), 'RUNTIME_INVOKE_BACKEND');
    assert.equal(existsSync(output), false, `${kind}: payload unexpectedly ran`);
    assert.equal(existsSync(anomaly), true, `${kind}: anomalous path was removed`);
  }
});

test('SIGKILL around launcher directory recovery and helper publication is recoverable', () => {
  const worker = join(HERE, 'fixtures', 'runtime-launcher-materialization-worker.ts');
  const points = [
    'before_directory_recovery',
    'after_directory_recovery',
    'before_helper_publish',
    'after_helper_publish',
  ] as const;

  for (const [index, point] of points.entries()) {
    const first = nativeFixture(`4.2.${index}`, `recovered-${point}`);
    const runtime = manager(first.home);
    const staged = runtime.stage({
      artifactPath: first.artifact,
      provenancePath: first.provenance,
    });
    runtime.activate(staged.transaction_id);
    const launcherDir = launcherDirectory(first.home);
    if (point === 'before_directory_recovery') chmodSync(launcherDir, 0o500);
    const ready = join(first.root, `${point}-ready`);
    const interruptedOutput = join(first.root, `${point}-interrupted`);
    const crashed = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        worker,
        first.home,
        interruptedOutput,
        ready,
        '',
        point === 'before_helper_publish'
          ? 'before_helper_publish_native'
          : point === 'after_helper_publish'
            ? 'after_helper_publish_native'
            : point,
      ],
      { cwd: join(HERE, '..'), encoding: 'utf8' },
    );
    assert.equal(crashed.status, null, `${point}: worker unexpectedly exited: ${crashed.stderr}`);
    assert.equal(crashed.signal, 'SIGKILL', `${point}: expected injected SIGKILL`);
    assert.equal(existsSync(ready), true, `${point}: fault seam was not reached`);

    if (point === 'before_helper_publish') {
      assert.deepEqual(
        launcherHelpers(first.home),
        [],
        'pre-publication crash published a final helper',
      );
      assert.equal(
        readdirSync(launcherDir).some((name) => name.endsWith('.tmp')),
        true,
        'pre-publication crash did not preserve the expected abandoned temp probe',
      );
    }
    if (point === 'after_helper_publish') {
      assert.equal(
        launcherHelpers(first.home).length,
        1,
        'post-publication crash lost final helper',
      );
    }

    const recoveredOutput = join(first.root, `${point}-recovered`);
    const recovered = runtime.invoke([recoveredOutput]);
    assert.equal(recovered.exit_code, 0, `${point}: subsequent invoke failed`);
    assert.equal(readFileSync(recoveredOutput, 'utf8'), `recovered-${point}`);
    assert.equal(
      launcherHelpers(first.home).length,
      1,
      `${point}: final helper multiplicity drifted`,
    );
    assertRecoveredLauncherDirectory(first.home);
  }
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
  const winnerReady = join(first.root, 'winner-ready');
  const releaseWinner = join(first.root, 'release-winner');

  const winner = spawn(
    process.execPath,
    [
      ...common,
      tx1.transaction_id,
      JSON.stringify({
        readyFile: winnerReady,
        releaseFile: releaseWinner,
        barrierTimeoutMs: 10_000,
      }),
    ],
    {
      cwd: join(HERE, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const winnerResultPromise = waitForExit(winner);
  const lockPath = join(runtimeRoot(first.home), 'locks', 'activation.lock');
  await waitForFile(winnerReady, winner, 'activation winner');
  assert.equal(existsSync(lockPath), true, 'first worker acquired activation lock');
  const loser = spawn(
    process.execPath,
    [...common, tx2.transaction_id, JSON.stringify({ startupDelayMs: 2_000 })],
    {
      cwd: join(HERE, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const loserResult = await waitForExit(loser);
  assert.equal(loserResult.code, 4, loserResult.stderr);
  assert.match(loserResult.stderr, /RUNTIME_LOCKED/);
  assert.equal(winner.exitCode, null, 'winner remains blocked on the release handshake');
  assert.equal(existsSync(lockPath), true, 'winner still holds the lock after loser attempts');
  writeFileSync(releaseWinner, 'release\n');
  const winnerResult = await winnerResultPromise;
  assert.equal(winnerResult.code, 0, winnerResult.stderr);
  assert.equal(activationCount(first.home), 1);
  assert.equal(runtime.resolve().sha256, tx1.sha256);

  const retried = runtime.activate(tx2.transaction_id);
  assert.equal(retried.sequence, 2);
  assert.equal(retried.current.sha256, tx2.sha256);
  assert.equal(retried.previous?.sha256, tx1.sha256);
  assert.equal(runtime.resolve().sha256, tx2.sha256);
});

test('activation worker failures and barrier timeouts release the lock without publishing a commit', async () => {
  const cases = [
    {
      version: '8.1.0',
      code: 'RUNTIME_TEST_BARRIER_FAILURE',
      control: { failAfterReady: true },
    },
    {
      version: '8.1.1',
      code: 'RUNTIME_TEST_BARRIER_TIMEOUT',
      control: { releaseFile: 'missing', barrierTimeoutMs: 50 },
    },
  ];

  for (const [index, probe] of cases.entries()) {
    const first = fixture(probe.version);
    const runtime = manager(first.home);
    const staged = runtime.stage({
      artifactPath: first.artifact,
      provenancePath: first.provenance,
    });
    const readyFile = join(first.root, `failure-ready-${index}`);
    const control = {
      ...probe.control,
      readyFile,
      ...(probe.control.releaseFile
        ? { releaseFile: join(first.root, probe.control.releaseFile) }
        : {}),
    };
    const worker = join(HERE, 'fixtures', 'runtime-activate-worker.ts');
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', worker, first.home, staged.transaction_id, JSON.stringify(control)],
      { cwd: join(HERE, '..'), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const resultPromise = waitForExit(child);
    await waitForFile(readyFile, child, probe.code);
    const result = await resultPromise;
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stderr, new RegExp(probe.code));
    assert.equal(
      existsSync(join(runtimeRoot(first.home), 'locks', 'activation.lock')),
      false,
      `${probe.code} leaked the activation lock`,
    );
    assert.equal(activationCount(first.home), 0, `${probe.code} published an activation commit`);

    const followUp = fixture(`8.2.${index}`);
    const followUpStaged = runtime.stage({
      artifactPath: followUp.artifact,
      provenancePath: followUp.provenance,
    });
    assert.equal(runtime.activate(followUpStaged.transaction_id).current.sha256, followUp.hash);
  }
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

  const invokeHelp = invokeCli(['runtime', 'invoke', '--help'], first.home);
  assert.equal(invokeHelp.code, 0, invokeHelp.stderr);
  assert.match(invokeHelp.stdout, /--require-assurance <exact-object>/);
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

test('resolve and doctor read paths never initialize or repair runtime layout', () => {
  const empty = fixture('9.2.0');
  expectRuntimeError(() => manager(empty.home).resolve(), 'RUNTIME_CURRENT_MISSING');
  assert.equal(
    existsSync(runtimeRoot(empty.home)),
    false,
    'empty resolve must perform zero writes',
  );

  const active = fixture('9.2.1');
  const runtime = manager(active.home);
  const staged = runtime.stage({
    artifactPath: active.artifact,
    provenancePath: active.provenance,
  });
  runtime.activate(staged.transaction_id);
  const marker = join(runtimeRoot(active.home), 'launcher', 'README.json');
  unlinkSync(marker);
  const beforeEntries = readdirSync(runtimeRoot(active.home), { recursive: true })
    .map(String)
    .sort();

  assert.equal(runtime.resolve().sha256, active.hash);
  assert.equal(runtime.doctor().current?.sha256, active.hash);
  const dryRun = invokeCli(['runtime', 'doctor', '--dry-run', '--json'], active.home);
  assert.equal(dryRun.code, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).data.current.sha256, active.hash);
  assert.equal(existsSync(marker), false, 'read paths must not restore a deleted launcher marker');
  assert.deepEqual(
    readdirSync(runtimeRoot(active.home), { recursive: true }).map(String).sort(),
    beforeEntries,
    'read paths must not add managed entries',
  );
});

test('stage rejects a managed child symlink before chmod, mkdir, staging, or publish', () => {
  const f = fixture('9.3.0');
  const root = runtimeRoot(f.home);
  const external = join(f.root, 'external-images');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  mkdirSync(external, { mode: 0o755 });
  writeFileSync(join(external, 'sentinel.txt'), 'outside-must-not-change\n', { mode: 0o644 });
  symlinkSync(external, join(root, 'images'));
  const beforeMode = lstatSync(external).mode & 0o777;
  const beforeEntries = readdirSync(external, { recursive: true }).map(String).sort();
  const beforeSentinel = readFileSync(join(external, 'sentinel.txt'), 'utf8');

  expectRuntimeError(
    () => manager(f.home).stage({ artifactPath: f.artifact, provenancePath: f.provenance }),
    'RUNTIME_SYMLINK',
  );

  assert.equal(lstatSync(external).mode & 0o777, beforeMode, 'external mode must not be chmodded');
  assert.deepEqual(
    readdirSync(external, { recursive: true }).map(String).sort(),
    beforeEntries,
    'external directory must not receive a staged or published image',
  );
  assert.equal(readFileSync(join(external, 'sentinel.txt'), 'utf8'), beforeSentinel);
  assert.deepEqual(
    readdirSync(root).sort(),
    ['images'],
    'preflight rejection must happen before any other managed directory is created',
  );
});
