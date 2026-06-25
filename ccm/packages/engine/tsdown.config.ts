import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: 'src/index.ts',
  format: ['esm', 'cjs', 'iife'],
  // IIFE 产物给 webview 用：挂到 globalThis.__ccmEngine（T1 定真名）。
  globalName: '__ccmEngine',
  dts: true,
  clean: true,
  // board-lock 用 node:fs / node:crypto，history-loader（ADR-015 usage 层）用 node:fs / node:path——这些在
  //   ESM/CJS 产物里是正常 node 内建依赖，但 IIFE 产物（webview 路径）跑在浏览器里没有它们。webview **只用**
  //   board-model / lint-core / graph-core / 算法层的纯计算函数（零 fs/path），从不触碰 board-lock 也不触碰
  //   history-loader 的 loadHomeBoards/loadCorpus（读 home 的 fs/path 函数）。给 IIFE 把这三个 external 映射成
  //   banner 里定义的全局占位：有 require（node 跑 IIFE）→ 取真模块；无 require（浏览器）→ 退化成 {}（这些
  //   node 内建在浏览器路径不被调用，占位对象足够，绝不在浏览器路径上执行其逻辑）。这让 IIFE 在裸浏览器 realm
  //   加载即发布 __ccmEngine 而不抛。node:path 是 ADR-015 history-loader 引入的第三个（同 fs/crypto 既有模式）。
  outputOptions: (options, format) => {
    if (format === 'iife') {
      options.globals = {
        'node:fs': '__ccm_node_fs',
        'node:crypto': '__ccm_node_crypto',
        'node:path': '__ccm_node_path',
      };
      options.banner =
        "var __ccm_node_fs = (typeof require !== 'undefined') ? require('node:fs') : {};\n" +
        "var __ccm_node_crypto = (typeof require !== 'undefined') ? require('node:crypto') : {};\n" +
        "var __ccm_node_path = (typeof require !== 'undefined') ? require('node:path') : {};";
    }
    return options;
  },
});
