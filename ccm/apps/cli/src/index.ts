import { SCHEMA_VERSION } from '@ccm/engine';

// T0 占位 —— T2b 替换为真 CLI（router + registry + handlers + mutations）。
// 注：T1 把引擎 barrel 从 ENGINE_PLACEHOLDER 换成真符号后，本占位改引一个真实导出（SCHEMA_VERSION）
//   以保占位可编译；真 wiring 仍留给 T2b。
export function run(): number {
  return SCHEMA_VERSION ? 0 : 1;
}
