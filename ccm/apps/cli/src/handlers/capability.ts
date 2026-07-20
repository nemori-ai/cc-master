import { buildManifest, capabilityIds, isCapabilitySupported } from '../capability-manifest.js';
import { readVersion } from '../help.js';
import * as io from '../io.js';
import * as render from '../render.js';
import type { Ctx } from './_common.js';

// ── ccm capability check <id> ─────────────────────────────────────────────────────────────────────
// 单个 capability 的断言式查询：支持 → exit 0；未声明 → exit VALIDATION(3) + 明确提示。
//   这是**优雅降级的原语**：consumer（plugin/hook）跑 `if ccm capability check <id>; then …; else 降级; fi`，
//   对任意非零一律降级——同时覆盖「这个 ccm 没有该能力」与「ccm 太旧、连 capability 子命令都没有 → unknown
//   command 也非零」两种斜错，无需 consumer 区分。
export function check(ctx: Ctx): number {
  const capability = String(ctx.positionals[0] || '');
  if (!isCapabilitySupported(capability)) {
    const advertised = capabilityIds().join(', ');
    const error =
      `unsupported capability: ${capability || '(empty)'} — this ccm ${readVersion()} advertises: ${advertised}. ` +
      'The requesting side needs a capability this ccm build does not provide; upgrade ccm or let the feature degrade gracefully.';
    ctx.err(ctx.flags.json ? io.jsonErr({ exit: io.EXIT.VALIDATION, error }) : error);
    return io.EXIT.VALIDATION;
  }
  const data = { capability, supported: true };
  ctx.out(ctx.flags.json ? render.jsonString(data) : `${capability}: supported`);
  return io.EXIT.OK;
}

// ── ccm capability list ───────────────────────────────────────────────────────────────────────────
// 全集清单查询：ccm 声明它兑现的全部 capability + 版本（结构化 JSON）。这是**协商基础**——consumer 拉全集、
//   自己判断某能力是否可用，不必逐个 `check`。清单 append-only，故旧 plugin 拉到的新 ccm 清单仍含所有旧 id
//   （向后兼容），新 plugin 拉到旧 ccm 清单则看不到自己要的新 id（据此降级 + 提示升级）。
export function list(ctx: Ctx): number {
  const manifest = buildManifest(readVersion());
  if (ctx.flags.json) {
    ctx.out(render.jsonString(manifest));
    return io.EXIT.OK;
  }
  const lines = [
    `ccm ${manifest.ccm_version} — ${manifest.schema}`,
    ...manifest.capabilities.map((c) => `  ${c.id} (${c.name} v${c.version})`),
  ];
  ctx.out(lines.join('\n'));
  return io.EXIT.OK;
}
