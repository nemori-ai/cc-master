// account-refresh.test.ts — @ccm/engine·account/refresh（Phase 2a 主动 OAuth refresh）契约门。
//   钉住安全命门：refresh 端点 host 白名单（构造含 token 的 body 之前校验·token 未授权端点从不上网）/
//   refresh token 经 POST body 不进 argv / 端点轮转标记 / 失败码语义。用 loopback http stub 端点测真 POST 路径。

import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { test } from 'node:test';
import { account } from '../dist/index.mjs';

const GOOD_BLOB = JSON.stringify({
  accessToken: 'sk-ant-oat-OLD',
  refreshToken: 'sk-ant-ort-OLD',
  expiresAt: 1,
  subscriptionType: 'max',
});

// ══ isRefreshHostAllowed（纯函数白名单）══════════════════════════════════════════════════════════════
test('isRefreshHostAllowed: https Claude/Anthropic hosts allowed; everything else rejected', () => {
  const ok = (u: string, opts?: { allowLoopback?: boolean }) =>
    account.isRefreshHostAllowed(u, opts).allowed;
  // 放行：https 的授权主机 + 子域。
  assert.equal(ok('https://platform.claude.com/v1/oauth/token'), true);
  assert.equal(ok('https://claude.ai/oauth/token'), true);
  assert.equal(ok('https://api.anthropic.com/oauth/token'), true);
  assert.equal(ok('https://claude.com/x'), true);
  assert.equal(ok('https://anthropic.com/x'), true);
  // 拒：明文 http 的授权主机（即便是 claude.com）。
  assert.equal(ok('http://claude.com/x'), false, 'http rejected even for authorized host');
  // 拒：非授权主机（攻击者端）。
  assert.equal(ok('https://evil.example.com/steal'), false);
  assert.equal(ok('https://claude.com.evil.example.com/x'), false, 'suffix-spoof rejected');
  // 拒：loopback 默认（无 opt-in）。
  assert.equal(ok('http://127.0.0.1:8080/token'), false);
  assert.equal(ok('http://localhost:8080/token'), false);
  // 放行：loopback 仅显式 opt-in。
  assert.equal(ok('http://127.0.0.1:8080/token', { allowLoopback: true }), true);
  assert.equal(ok('http://localhost:8080/token', { allowLoopback: true }), true);
  // 坏 URL → 拒。
  assert.equal(ok('not a url'), false);
});

// ══ refreshBlob host 拒（token 从不上网）══════════════════════════════════════════════════════════════
test('refreshBlob: rejects unauthorized host BEFORE sending token (HOST_REJECTED, code 6)', async () => {
  // 指向一个**会接连接的** loopback 端点但不 opt-in loopback → 必须在发请求前就拒（端点永不被命中）。
  let hit = false;
  const server = await listen((_req, res) => {
    hit = true;
    res.end('{}');
  });
  try {
    const url = `http://127.0.0.1:${port(server)}/token`;
    await assert.rejects(
      () => account.refreshBlob(GOOD_BLOB, { url, allowLoopback: false }),
      (e: Error & { code?: number }) => {
        assert.equal(e.code, account.REFRESH_EXIT.HOST_REJECTED);
        assert.ok(!/sk-ant/.test(e.message), 'error message carries no token');
        return true;
      },
    );
    assert.equal(hit, false, 'endpoint NEVER hit — token never left the process');
  } finally {
    await close(server);
  }
});

test('refreshBlob: blob missing refreshToken → NO_REFRESH_TOKEN (code 3), no network', async () => {
  const noRt = JSON.stringify({ accessToken: 'sk-ant-oat-X', expiresAt: 1 });
  await assert.rejects(
    () => account.refreshBlob(noRt, { url: 'https://claude.com/token' }),
    (e: Error & { code?: number }) => {
      assert.equal(e.code, account.REFRESH_EXIT.NO_REFRESH_TOKEN);
      return true;
    },
  );
});

// ══ refreshBlob 成功路径（loopback stub·POST body 含 refresh token·不进 argv）══════════════════════════
test('refreshBlob: posts refresh_token in body, returns fresh blob; rotation flagged', async () => {
  let receivedBody = '';
  const server = await listen((req, res) => {
    let b = '';
    req.on('data', (c) => {
      b += c;
    });
    req.on('end', () => {
      receivedBody = b;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          access_token: 'sk-ant-oat-NEW',
          refresh_token: 'sk-ant-ort-ROTATED',
          expires_in: 28800,
          scope: 'user:inference',
        }),
      );
    });
  });
  try {
    const url = `http://127.0.0.1:${port(server)}/token`;
    const out = await account.refreshBlob(GOOD_BLOB, { url, allowLoopback: true });
    // refresh token 在 POST body（不进 argv）。
    assert.ok(receivedBody.includes('grant_type=refresh_token'));
    assert.ok(receivedBody.includes(`refresh_token=${encodeURIComponent('sk-ant-ort-OLD')}`));
    // 新 blob：新 access + 轮转后的 refresh + subscriptionType 保留。
    const nb = JSON.parse(out.blob);
    assert.equal(nb.accessToken, 'sk-ant-oat-NEW');
    assert.equal(nb.refreshToken, 'sk-ant-ort-ROTATED');
    assert.equal(out.rotated, true, 'rotation flagged');
    assert.equal(nb.subscriptionType, 'max', 'non-secret meta preserved');
    assert.ok(nb.expiresAt > Date.now(), 'expiresAt in the future');
  } finally {
    await close(server);
  }
});

test('refreshBlob: non-2xx endpoint → HTTP_ERROR (code 4), response body not echoed', async () => {
  const server = await listen((_req, res) => {
    res.statusCode = 401;
    res.end('{"error":"invalid_grant","secret":"sk-ant-leak"}');
  });
  try {
    const url = `http://127.0.0.1:${port(server)}/token`;
    await assert.rejects(
      () => account.refreshBlob(GOOD_BLOB, { url, allowLoopback: true }),
      (e: Error & { code?: number }) => {
        assert.equal(e.code, account.REFRESH_EXIT.HTTP_ERROR);
        assert.ok(!/sk-ant-leak/.test(e.message), 'response body not echoed');
        return true;
      },
    );
  } finally {
    await close(server);
  }
});

// ── http stub helpers ────────────────────────────────────────────────────────────────────────────
function listen(handler: Parameters<typeof createServer>[1]): Promise<Server> {
  return new Promise((resolve) => {
    const s = createServer(handler);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}
function port(s: Server): number {
  const a = s.address();
  return a && typeof a === 'object' ? a.port : 0;
}
function close(s: Server): Promise<void> {
  return new Promise((resolve) => s.close(() => resolve()));
}
