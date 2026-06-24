import { ENGINE_PLACEHOLDER } from '@ccm/engine';

// T0 占位 —— T2 替换为真 CLI（router + registry + handlers + mutations）。
export function run(): number {
  return ENGINE_PLACEHOLDER ? 0 : 1;
}
