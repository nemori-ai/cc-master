import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const buildScript = readFileSync(
  new URL('../scripts/build-runtime-invoke-helper.mjs', import.meta.url),
  'utf8',
);

test('Linux verified execution retains exact-fd fexecve without executable fd pseudo-paths', () => {
  assert.doesNotMatch(runtimeSource, /\/dev\/fd|\/proc\/self\/fd/);
  assert.match(runtimeSource, /linux-exact-fd-v1/);
  assert.match(linuxHelperSource, /fexecve\s*\(/);
  assert.doesNotMatch(linuxHelperSource, /\/dev\/fd|\/proc\/self\/fd|posix_spawn/);
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
