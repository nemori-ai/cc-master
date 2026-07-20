// usage-refresh-hint.ts — generic "short-lived token → manual refresh" recovery hint builder.
//
// Some harnesses authenticate with a short-lived credential that the harness itself refreshes
// (during an active session), while ccm stays strictly observe-only on that credential. When the
// stored token lapses, the usage signal degrades to `unknown`. Rather than surface a bare `unknown`,
// ccm emits an *actionable* recovery hint: the exact harness-native command that refreshes the
// credential + how to re-query afterward.
//
// SAFETY (hard line): ccm NEVER writes / refreshes / rotates / moves / deletes credentials. This
// module only produces *text* telling the user/agent which harness command to run. Zero credential
// I/O — it takes a plain state enum + a per-harness recovery recipe and returns a text hint.
//
// AGENT AUTHORITY (ADR-018): the hint additionally carries a machine-readable `agent_authorized`
// boolean + an imperative `authorization` prose so a consuming orchestrator bound by "never touch
// credentials" knows it *is* allowed to self-recover. Only the `expired` state is authorized: running
// `refreshCommand` is an ordinary harness call that makes the harness self-refresh its own token —
// the agent/ccm never touch a credential. The authorization is scoped to exactly that call and the
// never-touch-credentials red line is restated in every branch, so the boundary never loosens.
//
// Generic-by-design: kimi-code is the first instance, but any short-lived-token harness declares a
// `ShortLivedTokenRecovery` recipe and reuses `shortLivedTokenRefreshHint` — no per-harness special
// casing in the usage output layer. Red line 1 / ADR-006: node/JS only, zero deps, pure stdlib.

import type { UsageRefreshHint } from './types.js';

/** Which recoverable / opaque state the harness credential is in. */
export type ShortLivedTokenState = 'expired' | 'absent' | 'opaque';

/**
 * Per-harness recovery recipe for a short-lived credential. Declares the honest reason strings and
 * the harness-native commands that let the *user* (never ccm) restore a fresh credential.
 */
export interface ShortLivedTokenRecovery {
  /** Human label for the harness, e.g. 'kimi-code'. */
  harnessLabel: string;
  /** `--harness` value used to build the recheck command, e.g. 'kimi-code'. */
  recheckHarness: string;
  /** Honest, secret-free reason strings per state. */
  reasons: { expired: string; absent: string; opaque: string };
  /**
   * Harness-native command that makes the harness self-refresh its token when the credential exists
   * but the access token lapsed (e.g. `kimi -p 'hi'` triggers kimi's own ensureFresh on its next
   * managed call). The command drives the *harness*; ccm never touches the credential itself.
   */
  refreshCommand: string;
  /** Full re-authentication command when there is no credential to refresh from (e.g. `kimi login`). */
  reauthCommand: string;
}

// Red-line clause reused verbatim in every authorization string: the authorization NEVER extends to
// the agent directly mutating a credential — the one and only authorized act is the ordinary harness
// call that lets the harness self-refresh its own token. This clause is generic (no harness hardcoded).
const NEVER_TOUCH_CREDENTIALS =
  '你仍然绝不被授权直接 refresh / rotate / 修改 / 移动 / 删除任何凭证或凭证文件——那条红线一字不松';

/**
 * Build an actionable, secret-free {@link UsageRefreshHint} from a token state + recovery recipe.
 * `expired` / `absent` are user-recoverable (recoverable:true, with a concrete command + remedy);
 * `opaque` (network / 401 / API change) is not user-fixable (recoverable:false, command/remedy null).
 *
 * The `agent_authorized` / `authorization` pair (ADR-018 machine-readable authority) is populated at
 * this generic layer, worded by harness name — only `expired` (an ordinary harness call self-refreshes
 * the harness's own token) is agent-authorized; `absent` (interactive user login) and `opaque` (no
 * recovery action) are not. The never-touch-credentials boundary is stated in every branch.
 */
export function shortLivedTokenRefreshHint(
  state: ShortLivedTokenState,
  recovery: ShortLivedTokenRecovery,
): UsageRefreshHint {
  const recheck = `ccm usage show --harness ${recovery.recheckHarness}`;
  if (state === 'expired') {
    return {
      reason: recovery.reasons.expired,
      recoverable: true,
      command: recovery.refreshCommand,
      remedy:
        `恢复：运行 \`${recovery.refreshCommand}\`（或在 ${recovery.harnessLabel} 里发一条消息）` +
        `让它自行刷新 token（ccm 只读、绝不写凭证），刷新后重跑 \`${recheck}\``,
      recheck,
      agent_authorized: true,
      authorization:
        `你（orchestrator/agent）有权直接执行此恢复：运行 \`${recovery.refreshCommand}\`` +
        `（或在 ${recovery.harnessLabel} 里发一条普通消息）。` +
        `这不违反「绝不碰凭证」红线——它只是一次普通的 harness 调用，由 ${recovery.harnessLabel} 本体` +
        `自行刷新它自己的短命 token，你和 ccm 全程都不读、不写、不轮转任何凭证。` +
        `授权边界（务必守住）：此授权仅限这次普通调用触发的自刷；${NEVER_TOUCH_CREDENTIALS}。`,
    };
  }
  if (state === 'absent') {
    return {
      reason: recovery.reasons.absent,
      recoverable: true,
      command: recovery.reauthCommand,
      remedy:
        `恢复：运行 \`${recovery.reauthCommand}\` 登录 ${recovery.harnessLabel} 建立凭证，` +
        `登录后重跑 \`${recheck}\``,
      recheck,
      agent_authorized: false,
      authorization:
        `此恢复需要一次交互式登录（\`${recovery.reauthCommand}\`）来为 ${recovery.harnessLabel} 建立凭证——` +
        `这属于用户操作，你不要自行登录，请把它 surface 给用户。无论如何，${NEVER_TOUCH_CREDENTIALS}。`,
    };
  }
  return {
    reason: recovery.reasons.opaque,
    recoverable: false,
    command: null,
    remedy: null,
    recheck,
    agent_authorized: false,
    authorization:
      `这是网络 / 401 / API 变更导致的失败，不是可自刷的凭证态，没有可供你直接执行的恢复动作——` +
      `请等待或 surface 给用户。${NEVER_TOUCH_CREDENTIALS}。`,
  };
}
