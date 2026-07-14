import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsdown';

// tsdown.sea.config.mts — SEA 自包含可执行 bundle 的独立构建配置（T3·ADR-014）。
//
// 与默认 tsdown.config.mts（产库 bundle dist/index.cjs，export { run }）分开：
//   本配置 entry = src/sea.ts（顶层执行 CLI 的可执行入口），产 dist/ccm-sea.cjs（单文件、自包含）。
//   clean:false——绝不擦掉默认配置产的 dist/index.cjs / *.d.cts（两个 bundle 共存于 dist/）。
//
// 版本号 define：SEA blob 内 __dirname 不指向 apps/cli/，help._readVersion 的 fs 读会落空。
//   故构建期把 package.json.version 文本替换进 __CCM_SEA_VERSION__（src/sea.ts 据此设 env.CCM_VERSION）。

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(`${__dirname}/package.json`, 'utf8')) as { version?: string };
const version = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
const helperBytes = readFileSync(`${__dirname}/.native-build/runtime-invoke-helper`);
const helperSha256 = createHash('sha256').update(helperBytes).digest('hex');
const helperContract =
  process.platform === 'linux' ? 'linux-exact-fd-v1' : 'darwin-path-attested-v1';

export default defineConfig({
  entry: 'src/sea.ts',
  format: ['cjs'],
  // 自包含可执行 bundle：单文件、引擎 + router + handlers 全内联。
  dts: false,
  clean: false, // 不擦默认配置的 dist/index.cjs（两 bundle 共存）。
  outDir: 'dist',
  // 产物固定命名 dist/ccm-sea.cjs（sea-config.json 的 main 指向它）。
  outputOptions: {
    entryFileNames: 'ccm-sea.cjs',
  },
  deps: {
    alwaysBundle: ['@ccm/engine'],
  },
  // 构建期注入版本号（literal 文本替换；JSON.stringify 包成字符串字面量）。
  define: {
    __CCM_SEA_VERSION__: JSON.stringify(version),
    __CCM_RUNTIME_INVOKE_HELPER_BASE64__: JSON.stringify(helperBytes.toString('base64')),
    __CCM_RUNTIME_INVOKE_HELPER_SHA256__: JSON.stringify(helperSha256),
    __CCM_RUNTIME_INVOKE_HELPER_PLATFORM__: JSON.stringify(process.platform),
    __CCM_RUNTIME_INVOKE_HELPER_ARCH__: JSON.stringify(process.arch),
    __CCM_RUNTIME_INVOKE_HELPER_CONTRACT__: JSON.stringify(helperContract),
  },
});
