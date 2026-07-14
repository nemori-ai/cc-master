// index.ts — ccm CLI 包入口（tsdown bundle 的 entry·备 Node SEA·T3）。
//
// 导出可注入的 router.run 与为可执行入口显式组装 quota filesystem boundary 的 runProduction。
//   runProduction(argv, {out, err, env, stdin}) → exitCode（绝不 process.exit·契约 §一.7：退出码只在 bin 设一次）。
//
// T2b：替换 T0 占位（原占位返回 SCHEMA_VERSION?0:1）。真 wiring = 直接 re-export router.run（tsdown 把
//   router + handlers + registry + io + @ccm/engine 全内联进单 CJS bundle·dist/index.cjs）。

export { runProduction } from './production-run.js';
export { run } from './router.js';
