import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const runtimeSource = readFileSync(
  new URL('../src/runtime-supply-chain.ts', import.meta.url),
  'utf8',
);
const linuxHelperSource = readFileSync(
  new URL('../native/runtime-invoke-helper-linux.c', import.meta.url),
  'utf8',
);
const darwinHelperSource = readFileSync(
  new URL('../native/runtime-invoke-helper-darwin.c', import.meta.url),
  'utf8',
);
const materializerPath = new URL('../native/runtime-launcher-materializer.h', import.meta.url);
const materializerSource = existsSync(materializerPath)
  ? readFileSync(materializerPath, 'utf8')
  : '';
const buildScript = readFileSync(
  new URL('../scripts/build-runtime-invoke-helper.mjs', import.meta.url),
  'utf8',
);

test('Linux verified execution retains exact-fd fexecve without executable fd pseudo-paths', () => {
  assert.match(runtimeSource, /linux-exact-fd-v1/);
  assert.match(linuxHelperSource, /fexecve\s*\(/);
  assert.doesNotMatch(linuxHelperSource, /\/dev\/fd|\/proc\/self\/fd|posix_spawn/);
  assert.doesNotMatch(runtimeSource, /spawnSync\(\s*[`'"]\/(?:dev\/fd|proc\/self\/fd)/);
});

test('Darwin verified execution is explicitly path-attested and never claims descriptor exec', () => {
  assert.match(runtimeSource, /darwin-path-attested-v1/);
  assert.doesNotMatch(darwinHelperSource, /fexecve|execveat|\/dev\/fd|\/proc\/self\/fd/);
  assert.match(darwinHelperSource, /O_NOFOLLOW/);
  assert.match(darwinHelperSource, /CC_SHA256_(?:Init|Update|Final)/);
  assert.match(darwinHelperSource, /st_gen/);
  assert.match(darwinHelperSource, /execve\s*\(/);
  assert.match(buildScript, /runtime-invoke-helper-\$\{process\.platform\}\.c/);
});

test('both native helpers keep an error-only control fd close-on-exec', () => {
  for (const source of [linuxHelperSource, darwinHelperSource]) {
    assert.match(source, /FD_CLOEXEC/);
    assert.match(source, /CCM_RUNTIME_INVOKE_ERROR/);
  }
});

test('launcher materialization uses true dirfd-relative syscalls without changing cwd or using fd pseudo-paths', () => {
  assert.match(runtimeSource, /before_directory_recovery/);
  assert.match(runtimeSource, /after_directory_recovery/);
  assert.match(runtimeSource, /before_helper_publish/);
  assert.match(runtimeSource, /after_helper_publish/);
  assert.match(runtimeSource, /fchmodSync\([^,]+,\s*0o700\)/);
  assert.doesNotMatch(runtimeSource, /process\.chdir|\/dev\/fd|\/proc\/self\/fd/);
  assert.doesNotMatch(materializerSource, /\bchdir\s*\(|\bfchdir\s*\(|\/dev\/fd|\/proc\/self\/fd/);
  assert.match(materializerSource, /\bopenat\s*\(/);
  assert.match(materializerSource, /\bfstatat\s*\([^;]+AT_SYMLINK_NOFOLLOW/);
  assert.match(materializerSource, /\blinkat\s*\(/);
  assert.match(materializerSource, /\bunlinkat\s*\(/);
  assert.match(materializerSource, /\bfdopendir\s*\(/);
  assert.match(materializerSource, /\bfsync\s*\(/);
  assert.doesNotMatch(runtimeSource, /renameSync\([^,]+,\s*helperPath\)/);
  assert.match(runtimeSource, /flushMaterializedLauncherDirectory/);
  assert.match(runtimeSource, /darwin[\s\S]*EINVAL[\s\S]*ENOTSUP/);
  assert.doesNotMatch(runtimeSource, /chmodSync\(launcherDir,\s*0o500\)/);
});

test('materializer bootstrap lifecycle has native self-clean and dead-owner recovery barriers', () => {
  assert.match(runtimeSource, /context\.root[\s\S]*['"]materializers['"]/);
  assert.doesNotMatch(runtimeSource, /tmpdir\s*\(|ccm-runtime-materializer-/);
  assert.match(materializerSource, /CCM_MATERIALIZER_BOOTSTRAP_ROOT_FD/);
  assert.match(materializerSource, /CCM_MATERIALIZER_BOOTSTRAP_INSTANCE_FD/);
  assert.match(materializerSource, /CCM_MATERIALIZER_BOOTSTRAP_FILE_FD/);
  assert.match(materializerSource, /ccm_materializer_self_cleanup_bootstrap\s*\(/);
  assert.match(materializerSource, /ccm_materializer_recover_bootstraps\s*\(/);
  assert.match(materializerSource, /ccm_materializer_dead_process\s*\(/);
  assert.match(materializerSource, /ccm_materializer_same_object_identity\s*\(/);
  assert.match(materializerSource, /ccm_materializer_same_file_revision\s*\(/);
  const directoryIdentityContract =
    materializerSource.match(/static int ccm_materializer_same_object_identity[\s\S]*?\n}/)?.[0] ||
    '';
  assert.doesNotMatch(directoryIdentityContract, /st_size|st_mtime|st_ctime/);
  assert.match(
    materializerSource,
    /ccm_materializer_self_cleanup_bootstrap[\s\S]*instance_after[\s\S]*instance_path_after[\s\S]*ccm_materializer_same_object_identity\(&instance_after,[\s\S]*&instance_path_after\)[\s\S]*AT_REMOVEDIR/,
  );
  assert.match(materializerSource, /st_uid\s*!=\s*geteuid\s*\(\)/);
  assert.match(materializerSource, /unlinkat\s*\([^;]+AT_REMOVEDIR/);
});
