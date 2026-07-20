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

/**
 * Build an actionable, secret-free {@link UsageRefreshHint} from a token state + recovery recipe.
 * `expired` / `absent` are user-recoverable (recoverable:true, with a concrete command + remedy);
 * `opaque` (network / 401 / API change) is not user-fixable (recoverable:false, command/remedy null).
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
    };
  }
  return {
    reason: recovery.reasons.opaque,
    recoverable: false,
    command: null,
    remedy: null,
    recheck,
  };
}
