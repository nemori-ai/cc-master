// account/refresh.ts — 主动 OAuth refresh（refresh 端点 host 白名单 + node https POST）·@ccm/engine·Phase 2a。
//
// 源：cc-master 插件 skills/account-management/scripts/switch-account.sh 的 refresh_blob。本文件是它的 TS 移植——
//   用 node https 把 vault blob 的 refresh token 换一份新鲜 access token。**switch 换号流程本身是 Phase 2b**；
//   这里只移植**安全机制**（host 白名单 + token 经 POST body 不进 argv），供 2b 的 switch 消费 + 现在单测。
//
// ───────────────────────── 安全命门（HARD·codex round#7 Finding A）─────────────────────────
// refresh token 是 bearer secret——POST 到哪个 URL 由 url 控制，若被污染 env / 误抄测试值指到非 Claude 主机或
//   明文 http，token 就被发到攻击者端（仍「不进 argv/log」却实质泄漏）。故**在构造含 token 的 POST body 之前**
//   先校验 host（isRefreshHostAllowed）：① https 的 *.claude.com / *.anthropic.com / claude.ai 永远放行；
//   ② loopback（127.0.0.1/localhost/::1）仅显式 opt-in（allowLoopback·测试 stub）放行；③ 其它一律拒（HostRejected·
//   token 从未进 body·从未上网）。token-blind 给 node 的方式：blob 在本进程内·refresh token 只进 POST body·绝不进 argv。
//
// 红线1（ADR-006）：node/JS only，纯 node stdlib（https/http/url），零第三方依赖。
// IIFE 守：本模块 import node:https/http——webview 永不调 refresh，tsdown banner 占位 {} 足够（见 vault.ts 同注）。

import * as http from 'node:http';
import * as https from 'node:https';

// 公开 OAuth client id（**非密**·CC 官方固定值）。
export const DEFAULT_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
// 默认 refresh 端点。
export const DEFAULT_REFRESH_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';

// refresh 失败码（对齐 switch-account.sh refresh_blob 的 node exit 码语义）。
export const REFRESH_EXIT = {
  BAD_INPUT: 2, // vault blob / url 非法 JSON / URL。
  NO_REFRESH_TOKEN: 3, // blob 缺 refreshToken（残缺 blob）。
  HTTP_ERROR: 4, // 端点非 2xx / 响应非 JSON / 缺 access_token。
  NETWORK: 5, // 网络错 / 超时。
  HOST_REJECTED: 6, // host 白名单拒（token 未发送）。
} as const;

// 带 .code 的 refresh 错误（调用方据 .code 映射上层退出码 / 决定 force-refresh 兜底）。
export class RefreshError extends Error {
  code: number;
  constructor(message: string, code: number) {
    super(message);
    this.name = 'RefreshError';
    this.code = code;
  }
}

// ── isRefreshHostAllowed：refresh 端点白名单（纯函数·可单测）──────────────────────────────────────
//   入: urlStr + { allowLoopback }。出: { allowed, host, proto }（host/proto 非密·可用于报错·绝不含 token）。
//   ① https 的 claude.ai / claude.com / anthropic.com / *.claude.com / *.anthropic.com → 放行。
//   ② loopback（127.0.0.1 / localhost / ::1）仅当 allowLoopback → 放行（测试 stub 端点）。
//   ③ 其它（含非 Claude 主机、明文 http 的授权主机）→ 拒。
export function isRefreshHostAllowed(
  urlStr: string,
  opts?: { allowLoopback?: boolean },
): { allowed: boolean; host: string; proto: string } {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch (_e) {
    return { allowed: false, host: '', proto: '' };
  }
  const host = (u.hostname || '').toLowerCase();
  const proto = u.protocol;
  const isHttps = proto === 'https:';
  const isLoopback =
    host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  const isAuthorizedClaudeHost =
    host === 'claude.ai' ||
    host === 'claude.com' ||
    host === 'anthropic.com' ||
    host.endsWith('.claude.com') ||
    host.endsWith('.anthropic.com');
  const allowLoopback = !!(opts && opts.allowLoopback);
  const allowed = (isAuthorizedClaudeHost && isHttps) || (isLoopback && allowLoopback);
  return { allowed, host, proto };
}

// ── refreshBlob：主动 refresh，把 in_blob 的 refresh token 换一份新鲜 8h access token ──────────────────
//   入: in_blob（单行 JSON·含 refreshToken）+ opts。出: Promise<{ blob: 新单行 blob, rotated }>。
//   token-blind：refresh token 经 **POST body**（不进 argv·绝不用 curl）；host 白名单在构造含 token 的 body **之前**校验。
//   失败抛 RefreshError（带 .code）——绝不回显 token（仅报非密 host/proto/状态码）。
export interface RefreshOptions {
  url?: string;
  clientId?: string;
  allowLoopback?: boolean;
  timeoutMs?: number;
}
export interface RefreshResult {
  blob: string;
  rotated: boolean; // refresh token 是否被端点轮转（轮转时新 blob 是新 refresh token 唯一副本·回写当硬前提）。
}
export function refreshBlob(inBlob: string, opts?: RefreshOptions): Promise<RefreshResult> {
  const url = (opts && opts.url) || DEFAULT_REFRESH_TOKEN_URL;
  const clientId = (opts && opts.clientId) || DEFAULT_OAUTH_CLIENT_ID;
  const allowLoopback = !!(opts && opts.allowLoopback);
  let timeoutMs = opts && Number(opts.timeoutMs);
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) timeoutMs = 15000;

  return new Promise<RefreshResult>((resolve, reject) => {
    let blob: Record<string, unknown>;
    try {
      blob = JSON.parse(inBlob) as Record<string, unknown>;
    } catch (_e) {
      reject(new RefreshError('refresh: vault blob 非法 JSON。', REFRESH_EXIT.BAD_INPUT));
      return;
    }
    const rt = blob && blob.refreshToken;
    if (typeof rt !== 'string' || rt.indexOf('sk-ant-ort') !== 0) {
      reject(
        new RefreshError(
          'refresh: vault blob 缺 refreshToken（前缀非 sk-ant-ort）——该号无 refresh token，无法主动续期。',
          REFRESH_EXIT.NO_REFRESH_TOKEN,
        ),
      );
      return;
    }
    let u: URL;
    try {
      u = new URL(url);
    } catch (_e) {
      reject(new RefreshError('refresh: REFRESH_TOKEN_URL 非法。', REFRESH_EXIT.BAD_INPUT));
      return;
    }
    // **host 白名单（构造含 token 的 body 之前）**：拒则 token 从未进 body、从未上网。
    const gate = isRefreshHostAllowed(url, { allowLoopback });
    if (!gate.allowed) {
      reject(
        new RefreshError(
          `refresh: 拒绝向未授权 refresh 端点发送 refresh token（host=${gate.host} proto=${gate.proto}）——只允许 https://*.claude.com / *.anthropic.com / claude.ai（或显式 opt-in 的 loopback 测试端点）。token 未发送。`,
          REFRESH_EXIT.HOST_REJECTED,
        ),
      );
      return;
    }
    // 通过白名单后才构造含 token 的 POST body（refresh token 放 body·绝不进 argv）。
    const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(rt)}&client_id=${encodeURIComponent(clientId)}`;
    const mod = u.protocol === 'http:' ? http : https;
    const reqOpts: http.RequestOptions = {
      method: 'POST',
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + (u.search || ''),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = mod.request(reqOpts, (res) => {
      let chunks = '';
      res.on('data', (c) => {
        chunks += c;
      });
      res.on('end', () => {
        const status = res.statusCode || 0;
        if (status < 200 || status >= 300) {
          // 绝不回显响应体（可能含 token / 错误细节）——只报状态码。
          reject(
            new RefreshError(
              `refresh: oauth 端点返回 HTTP ${status}（refresh token 可能失效）。`,
              REFRESH_EXIT.HTTP_ERROR,
            ),
          );
          return;
        }
        let r: Record<string, unknown>;
        try {
          r = JSON.parse(chunks) as Record<string, unknown>;
        } catch (_e) {
          reject(new RefreshError('refresh: oauth 响应非 JSON。', REFRESH_EXIT.HTTP_ERROR));
          return;
        }
        const at = r.access_token;
        if (typeof at !== 'string' || at.indexOf('sk-ant-oat') !== 0) {
          reject(
            new RefreshError(
              'refresh: oauth 响应缺 access_token（前缀非 sk-ant-oat）。',
              REFRESH_EXIT.HTTP_ERROR,
            ),
          );
          return;
        }
        const expiresIn = Number(r.expires_in);
        // 响应给了新 refresh token 用新的，否则保留旧的（端点可能轮转）。
        const rotated =
          typeof r.refresh_token === 'string' &&
          (r.refresh_token as string).indexOf('sk-ant-ort') === 0 &&
          r.refresh_token !== rt;
        const newBlob: Record<string, unknown> = {
          accessToken: at,
          refreshToken: rotated ? r.refresh_token : rt,
          expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 8 * 3600) * 1000,
        };
        if (typeof r.scope === 'string' && r.scope) newBlob.scopes = r.scope.split(/\s+/);
        else if (Array.isArray(blob.scopes)) newBlob.scopes = blob.scopes;
        if (typeof blob.subscriptionType === 'string' && blob.subscriptionType)
          newBlob.subscriptionType = blob.subscriptionType;
        if (typeof blob.rateLimitTier === 'string' && blob.rateLimitTier)
          newBlob.rateLimitTier = blob.rateLimitTier;
        resolve({ blob: JSON.stringify(newBlob), rotated });
      });
    });
    req.on('error', (e) => {
      reject(
        new RefreshError(
          `refresh: 网络错误（${(e && (e as NodeJS.ErrnoException).code) || 'ERR'}）。`,
          REFRESH_EXIT.NETWORK,
        ),
      );
    });
    // socket-inactivity timeout：端点接了连接却挂死不响应 → destroy + 当网络错（上层 force-refresh 兜底·优雅降级）。
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(
        new RefreshError(
          `refresh: oauth 端点 ${timeoutMs}ms 内无响应（连接 stall / captive proxy？）——当网络不通处理。`,
          REFRESH_EXIT.NETWORK,
        ),
      );
    });
    req.write(body);
    req.end();
  });
}
