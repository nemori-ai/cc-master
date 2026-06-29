// account/index.ts — 账号号池模块 barrel（@ccm/engine·Phase 1）。
//
// 把 registry（registry 模型 + 校验 + 锁 + entry 助手 + email 安全 helper）与 select（选号算法）两子模块
//   的公开符号一处 re-export。引擎根 barrel（src/index.ts）以 `export * as account` 整组命名空间导出——
//   避免与 usage/pacing.ts 既有的 flat `tokenExpired`/`effectiveN`/`PoolAccount` 撞名（账号选号的 tokenExpired
//   是严格 ISO 字典序口径、pacing 的是 Date.parse 毫秒口径，刻意分居）。registry 与 select 之间无名字冲突。

// LOADBAL（§2 预测 / §3.1 扩 select / §3.2 WHEN 触发）：predict（inactive 号用量预测·喂选号 + 失衡判定）+
//   when（换号 WHEN「现在该不该切」三触发，与「切哪个」select 解耦）。select 的 §3.1 扩项（reset-proximity /
//   reserve-floor）在 select.js 内、随它一并导出。predict / when 与既有符号无名字冲突。
export * from './predict.js';
export * from './refresh.js';
export * from './registry.js';
export * from './select.js';
export * from './switch.js';
export * from './vault.js';
export * from './when.js';
