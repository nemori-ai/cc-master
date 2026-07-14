import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsdown';

const helperPath = fileURLToPath(new URL('./.native-build/runtime-invoke-helper', import.meta.url));
const helperBytes = readFileSync(helperPath);
const helperSha256 = createHash('sha256').update(helperBytes).digest('hex');
const helperContract =
  process.platform === 'linux' ? 'linux-exact-fd-v1' : 'darwin-path-attested-v1';

export default defineConfig({
  entry: 'src/index.ts',
  // 单 CJS bundle 备 Node SEA（T3）；@ccm/engine 内联进 bundle。
  format: ['cjs'],
  dts: true,
  clean: true,
  // 把 workspace 引擎内联进单 bundle（备 SEA·T3）。
  deps: {
    alwaysBundle: ['@ccm/engine'],
  },
  define: {
    __CCM_RUNTIME_INVOKE_HELPER_BASE64__: JSON.stringify(helperBytes.toString('base64')),
    __CCM_RUNTIME_INVOKE_HELPER_SHA256__: JSON.stringify(helperSha256),
    __CCM_RUNTIME_INVOKE_HELPER_PLATFORM__: JSON.stringify(process.platform),
    __CCM_RUNTIME_INVOKE_HELPER_ARCH__: JSON.stringify(process.arch),
    __CCM_RUNTIME_INVOKE_HELPER_CONTRACT__: JSON.stringify(helperContract),
  },
});
