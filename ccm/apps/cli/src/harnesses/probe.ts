// probe.ts — harness 可执行探测的 CLI 边界适配器。
//
// 可执行发现的**纯契约**（PATH 语义 / 相对条目 / 空条目安全拒绝 / lexical vs realpath / symlink 身份）住
//   `@ccm/engine` 的 RuntimeEnvironment/PathResolver（runtime-env.ts）——本文件只做 composition 边界：
//   注入 env、cwd/platform 由真实进程捕获（captureRuntimeEnvironment），把 ResolvedExecutable 投影成
//   现有 HarnessCliProbe 形（path = 命中的 lexical 路径·未命中 null）。
//
// 关键不变式（由契约保证·此处仅转发）：注入 env 用 presence 而非 truthiness——空/缺 PATH 绝不回落 process.env。
//   symlink 命中回报 lexical 符号链接路径（非 realpath），保持既有 harness registry 语义。

import { captureRuntimeEnvironment, resolveExecutable } from '@ccm/engine';
import type { Env, HarnessCliProbe } from './types.js';

export function probeExecutable(name: string, env: Env): HarnessCliProbe {
  // env 注入、cwd/platform/homeDir 从真实进程边界捕获（唯一进程读点在契约的 capture 内）。
  const rt = captureRuntimeEnvironment({ env });
  const resolved = resolveExecutable(rt, name);
  const pathHit = resolved.executable ? resolved.lexicalPath : null;
  return { name, path: pathHit, available: pathHit != null };
}
