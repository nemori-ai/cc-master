// handlers/policy.ts — policy noun handler（show / set）。
//
// board.policy 是用户对 master-orchestrator 自主换号的授权开关：
//   · show  → runRead：只读当前 board 的 policy + 有效值（缺省 = allow）。
//   · set   → runWrite：写 board.policy.autonomous_account_switch；非 TTY 须 --user-authorized。
//
// 授权闸：policy 是用户所有的授权字段，非 TTY 必须显式 --user-authorized（与 baseline reset 的 --yes 同模式）。
//
// exit codes：0 OK · 2 USAGE（非 TTY 无 --user-authorized） · 3 VALIDATION · 4 LOCK · 5 NOT_FOUND。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib。
// 武装闸豁免：纯 handler 模块（无 hook 入口）。

import * as mutations from '../mutations.js';
import { type BoardArg, type Ctx, runRead, runWrite } from './_common.js';

// 带 errKind 的 Error（router 据此映射退出码）。
interface KindedError extends Error {
  errKind?: string;
}

// ── policy show ──────────────────────────────────────────────────────────────
export function show(ctx: Ctx): number {
  return runRead(ctx, {
    render: (board, c) => {
      const b = board as BoardArg;
      const policy = b && typeof b === 'object' ? b.policy : undefined;
      const hasPolicy = !!policy && typeof policy === 'object' && !Array.isArray(policy);
      const policyObj = hasPolicy ? (policy as Record<string, unknown>) : {};
      // effective: missing → allow（向后兼容缺省）
      const effectiveSwitch =
        typeof policyObj.autonomous_account_switch === 'string'
          ? policyObj.autonomous_account_switch
          : 'allow';
      if (c.flags.json) {
        return JSON.stringify({
          ok: true,
          data: {
            policy: hasPolicy ? policy : null,
            effective: { autonomous_account_switch: effectiveSwitch },
          },
        });
      }
      const policyLine = hasPolicy ? JSON.stringify(policy) : '(none)';
      return `policy: ${policyLine}\neffective.autonomous_account_switch: ${effectiveSwitch}\n`;
    },
  });
}

// ── policy set ──────────────────────────────────────────────────────────────
export function set(ctx: Ctx): number {
  // 授权闸：policy 为用户所有，非 TTY 须 --user-authorized
  if (!ctx.isTTY && !ctx.values['user-authorized']) {
    const e = new Error('policy 为用户所有·非 TTY 须 --user-authorized') as KindedError;
    e.errKind = 'Usage';
    throw e;
  }
  return runWrite(ctx, {
    mutate: (board) => {
      const b = board as BoardArg;
      const switchVal = ctx.values['autonomous-account-switch'] as string;

      // Capture old value before mutating
      const existingPolicy =
        b.policy && typeof b.policy === 'object' && !Array.isArray(b.policy)
          ? (b.policy as Record<string, unknown>)
          : undefined;
      const oldSwitch =
        existingPolicy && typeof existingPolicy.autonomous_account_switch === 'string'
          ? existingPolicy.autonomous_account_switch
          : '(缺省allow)';

      // Write policy
      if (!b.policy || typeof b.policy !== 'object' || Array.isArray(b.policy)) {
        b.policy = {};
      }
      (b.policy as Record<string, unknown>).autonomous_account_switch = switchVal;

      const userAuthorized = !!(ctx.isTTY || ctx.values['user-authorized']);
      // Append to board.log
      const logEntry = {
        ts: mutations.stampNow(),
        kind: 'decision',
        summary: `policy.autonomous_account_switch 从 ${oldSwitch}→${switchVal}·user-authorized=${String(userAuthorized)}`,
      };
      if (!Array.isArray(b.log)) b.log = [];
      (b.log as unknown[]).push(logEntry);
      return b;
    },
    render: (next, c) => {
      const n = next as BoardArg;
      const policy = n.policy as Record<string, unknown> | undefined;
      const switchVal = policy?.autonomous_account_switch;
      if (c.flags.json) {
        return JSON.stringify({
          ok: true,
          data: { policy: policy || null },
        });
      }
      return `policy set OK: autonomous_account_switch=${switchVal}\n`;
    },
  });
}
