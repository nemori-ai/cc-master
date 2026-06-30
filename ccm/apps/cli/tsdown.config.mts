import { defineConfig } from 'tsdown';

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
});
