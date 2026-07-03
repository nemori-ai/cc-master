// handler-account-switch.test.ts — `ccm account switch`（无重启换号·Phase 2b 编排层）契约门。
//
// 端到端（mkdtemp home + 真 @ccm/engine switch 机制层 + bash security stub keychain + loopback refresh stub +
//   temp 官方 ①②③ 存储）验证编排 + 每个安全闸：
//   · 云后端 no-op（exit 0·零副作用）。
//   · policy deny（--board 指 deny 板）→ exit 7·**未读 vault、未覆写任何存储**（零副作用）。
//   · 全员逼顶（select NONE_ALL_EXHAUSTED）→ exit 3·未切。
//   · refresh 硬失败（端点 401）→ exit 1·未覆写任何存储。
//   · 成功路径：选号/refresh/切出抢救/覆写三存储/setActive 全跑通 → exit 0·三存储=新号·registry active 翻转·
//     切出号 vault 被抢救（Finding #72）。
//   · ★token-blindness：所有 verb 的 out/err 绝不含任何 token 值（sk-ant-*）。

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { Ctx } from '../src/handlers/_common.js';
import * as accountHandler from '../src/handlers/account.js';

const TOKEN_NEEDLE = 'sk-ant-';
const OLD_SWITCHOUT_BLOB = {
  accessToken: 'sk-ant-oat-OLDACCESS',
  refreshToken: 'sk-ant-ort-OLDRT',
  expiresAt: 111,
};
const SWITCHIN_VAULT_BLOB = JSON.stringify({
  accessToken: 'sk-ant-oat-STALE',
  refreshToken: 'sk-ant-ort-NEWRT',
  expiresAt: 111,
  subscriptionType: 'max',
});

let TMP: string[] = [];
const CHMOD_RESTORE: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ccm-swh-'));
  TMP.push(d);
  return d;
}
afterEach(() => {
  for (const p of CHMOD_RESTORE) {
    try {
      chmodSync(p, 0o700);
    } catch (_) {
      /* best-effort */
    }
  }
  CHMOD_RESTORE.length = 0;
  for (const d of TMP) rmSync(d, { recursive: true, force: true });
  TMP = [];
});

// bash security stub（store 落 <storeDir>/<svc>__<acct>·find 不带 -w 只看 status·add -w 取 argv 值）。
function makeSecurityStub(storeDir: string): string {
  mkdirSync(storeDir, { recursive: true });
  const script = `#!/usr/bin/env bash
STORE=${JSON.stringify(storeDir)}
mkdir -p "$STORE"
sub="$1"; shift || true
svc=""; acc=""; blob=""; want_w=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    -s) svc="$2"; shift 2;;
    -a) acc="$2"; shift 2;;
    -l) shift 2;;
    -U) shift;;
    -w)
      want_w=1
      if [ "$sub" = "add-generic-password" ] && [ "$#" -ge 2 ]; then blob="$2"; shift 2; else shift; fi;;
    *) shift;;
  esac
done
key="$STORE/$(printf '%s' "$svc" | tr '/ ' '__')__$(printf '%s' "$acc" | tr '/ ' '__')"
case "$sub" in
  find-generic-password)
    if [ -f "$key" ]; then if [ "$want_w" = "1" ]; then cat "$key"; fi; exit 0; else exit 44; fi;;
  add-generic-password)
    printf '%s' "$blob" > "$key"; exit 0;;
  delete-generic-password)
    if [ -f "$key" ]; then rm -f "$key"; exit 0; else exit 44; fi;;
  *) echo "usage: security ..." >&2; exit 2;;
esac
`;
  const p = join(storeDir, 'security-stub.sh');
  writeFileSync(p, script, { mode: 0o755 });
  chmodSync(p, 0o755);
  return p;
}
function stubKey(storeDir: string, svc: string, acct: string): string {
  const sanitize = (s: string) => s.replace(/[/ ]/g, '_');
  return join(storeDir, `${sanitize(svc)}__${sanitize(acct)}`);
}

type TestCtx = Ctx & { outBuf: string[]; errBuf: string[] };
function mkCtx(
  values: Record<string, unknown>,
  env: Record<string, string | undefined>,
  flags?: Partial<Ctx['flags']>,
): TestCtx {
  const outBuf: string[] = [];
  const errBuf: string[] = [];
  return {
    values,
    positionals: [],
    flags: {
      json: false,
      dryRun: false,
      force: false,
      yes: false,
      quiet: false,
      verbose: false,
      color: false,
      ...flags,
    },
    sid: 'sid-sw',
    env,
    out: (s: string) => outBuf.push(s),
    err: (s: string) => errBuf.push(s),
    isTTY: false,
    outBuf,
    errBuf,
  };
}
function assertTokenBlind(ctx: TestCtx): void {
  for (const s of [...ctx.outBuf, ...ctx.errBuf]) {
    assert.ok(!s.includes(TOKEN_NEEDLE), `output carries no token: ${s}`);
  }
}

test('codex harness: account switch is NotImplemented before touching vault or registry', async () => {
  const ctx = mkCtx({}, { CC_MASTER_HOST: 'codex', HOME: '/tmp/no-touch' });
  const rc = await accountHandler.switchAccount(ctx);
  assert.equal(rc, 2);
  assert.match(ctx.errBuf.join('\n'), /NotImplemented: `ccm account switch`/);
  assert.match(ctx.errBuf.join('\n'), /Codex harness/);
  assertTokenBlind(ctx);
});

// loopback refresh stub server。
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

// 共享 fixture：home + registry（old active / new switchable）+ keychain stub + 官方 ①②③。
function setupFixture(): {
  home: string;
  store: string;
  regPath: string;
  credPath: string;
  claudeJson: string;
  baseEnv: Record<string, string | undefined>;
} {
  const home = mkTmp();
  const store = join(home, 'kcstore');
  const stub = makeSecurityStub(store);
  const regPath = join(home, 'accounts.json');
  writeFileSync(
    regPath,
    `${JSON.stringify(
      {
        schema: 'cc-master/accounts/v1',
        accounts: {
          'old@x.com': {
            vault: { kind: 'keychain', service: 'cc-master-oauth', account: 'old@x.com' },
            active: true,
            token_expires_at: '2027-01-01T00:00:00Z',
            identity: { emailAddress: 'old@x.com' },
          },
          'new@x.com': {
            vault: { kind: 'keychain', service: 'cc-master-oauth', account: 'new@x.com' },
            active: false,
            switchable: true,
            token_expires_at: '2027-01-01T00:00:00Z',
            identity: { emailAddress: 'new@x.com', accountUuid: 'u-new' },
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  // keychain：switchin vault blob + 官方 ③（切出号最新 blob·rescue 源）。
  writeFileSync(stubKey(store, 'cc-master-oauth', 'new@x.com'), SWITCHIN_VAULT_BLOB);
  writeFileSync(
    stubKey(store, 'Claude Code-credentials', 'tester'),
    JSON.stringify({ claudeAiOauth: OLD_SWITCHOUT_BLOB }),
  );
  // 官方 ① credentials.json + ② ~/.claude.json（切出号态·带其它键验保留）。
  const credPath = join(home, 'credentials.json');
  const claudeJson = join(home, 'claude.json');
  writeFileSync(
    credPath,
    JSON.stringify({ claudeAiOauth: OLD_SWITCHOUT_BLOB, otherTop: 'keepme' }),
  );
  writeFileSync(
    claudeJson,
    JSON.stringify({ oauthAccount: { emailAddress: 'old@x.com' }, numStartups: 9 }),
  );
  const baseEnv: Record<string, string | undefined> = {
    CC_MASTER_HOME: home,
    CCM_SECURITY_BIN: stub,
    USER: 'tester',
    CRED_PATH: credPath,
    CLAUDE_JSON_PATH: claudeJson,
    CCM_CREDSTORE_LOCK: join(home, 'credstore'),
    CCM_ALLOW_LOOPBACK_REFRESH: '1',
  };
  return { home, store, regPath, credPath, claudeJson, baseEnv };
}

// ══ 云后端 no-op ══════════════════════════════════════════════════════════════════════════════════════
test('switch: cloud backend → no-op exit 0 (zero side effects)', async () => {
  const f = setupFixture();
  const ctx = mkCtx({ email: 'new@x.com' }, { ...f.baseEnv, CLAUDE_CODE_USE_BEDROCK: '1' });
  const rc = await accountHandler.switchAccount(ctx);
  assert.equal(rc, 0);
  // 三存储原封（仍旧号）。
  assert.equal(
    JSON.parse(readFileSync(f.credPath, 'utf8')).claudeAiOauth.accessToken,
    'sk-ant-oat-OLDACCESS',
  );
  assertTokenBlind(ctx);
});

// ══ policy deny ══════════════════════════════════════════════════════════════════════════════════════
test('switch: board.policy deny → exit 7, no vault read, no store overwrite', async () => {
  const f = setupFixture();
  const boardPath = join(f.home, 'deny.board.json');
  writeFileSync(
    boardPath,
    JSON.stringify({
      schema: 'cc-master/board/v2',
      goal: 'g',
      policy: { autonomous_account_switch: 'deny' },
      owner: { active: true, session_id: 'sid-sw' },
      tasks: [],
    }),
  );
  const ctx = mkCtx({ email: 'new@x.com', board: boardPath }, { ...f.baseEnv });
  const rc = await accountHandler.switchAccount(ctx);
  assert.equal(rc, 7, 'policy deny → exit 7');
  // 零副作用：① credentials.json 仍旧号·官方 ③ 仍旧号。
  assert.equal(
    JSON.parse(readFileSync(f.credPath, 'utf8')).claudeAiOauth.accessToken,
    'sk-ant-oat-OLDACCESS',
    '① untouched',
  );
  const official = readFileSync(stubKey(f.store, 'Claude Code-credentials', 'tester'), 'utf8');
  assert.equal(
    JSON.parse(official).claudeAiOauth.accessToken,
    'sk-ant-oat-OLDACCESS',
    '③ untouched',
  );
  // registry active 原封（old 仍 active）。
  assert.equal(JSON.parse(readFileSync(f.regPath, 'utf8')).accounts['old@x.com'].active, true);
  assertTokenBlind(ctx);
});

// ══ 全员逼顶（select NONE_ALL_EXHAUSTED）══════════════════════════════════════════════════════════════
test('switch: all backups exhausted → exit 3 (not switched)', async () => {
  const f = setupFixture();
  // 把 new@x.com 改成 7d 硬闸（last_switch_out 5h/7d used_pct=95·gated）→ 无可切候选 → NONE_ALL_EXHAUSTED。
  const reg = JSON.parse(readFileSync(f.regPath, 'utf8'));
  reg.accounts['new@x.com'].last_switch_out = {
    at: '2026-01-01T00:00:00Z',
    '5h': { used_pct: 95, resets_at: '2099-01-01T00:00:00Z' },
    '7d': { used_pct: 95, resets_at: '2099-01-01T00:00:00Z' },
  };
  writeFileSync(f.regPath, `${JSON.stringify(reg, null, 2)}\n`);
  const ctx = mkCtx({ now: '2026-01-01T01:00:00Z' }, { ...f.baseEnv }); // 无 --email → 自动选号。
  const rc = await accountHandler.switchAccount(ctx);
  assert.equal(rc, 3, 'NONE_ALL_EXHAUSTED → exit 3');
  assert.equal(
    JSON.parse(readFileSync(f.credPath, 'utf8')).claudeAiOauth.accessToken,
    'sk-ant-oat-OLDACCESS',
    '① untouched',
  );
  assertTokenBlind(ctx);
});

// ══ refresh 硬失败（端点 401·refresh token 失效）→ exit 1·未覆写 ════════════════════════════════════════
test('switch: refresh endpoint 401 → exit 1, no store overwrite', async () => {
  const f = setupFixture();
  const server = await listen((_req, res) => {
    res.statusCode = 401;
    res.end('{"error":"invalid_grant"}');
  });
  try {
    const ctx = mkCtx(
      { email: 'new@x.com' },
      { ...f.baseEnv, REFRESH_TOKEN_URL: `http://127.0.0.1:${port(server)}/token` },
    );
    const rc = await accountHandler.switchAccount(ctx);
    assert.equal(rc, 1, 'refresh hard-fail → exit 1');
    assert.equal(
      JSON.parse(readFileSync(f.credPath, 'utf8')).claudeAiOauth.accessToken,
      'sk-ant-oat-OLDACCESS',
      '① untouched (refresh fail before overwrite)',
    );
    assertTokenBlind(ctx);
  } finally {
    await close(server);
  }
});

// ══ 成功路径（选号/refresh/切出抢救/覆写三存储/setActive 全跑通）═══════════════════════════════════════
test('switch: full success overwrites ①②③ + flips registry active + rescues switch-out token', async () => {
  const f = setupFixture();
  let postedRefreshToken = '';
  const server = await listen((req, res) => {
    let b = '';
    req.on('data', (c) => {
      b += c;
    });
    req.on('end', () => {
      postedRefreshToken = b;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ access_token: 'sk-ant-oat-FRESH', expires_in: 28800 }));
    });
  });
  try {
    const ctx = mkCtx(
      { email: 'new@x.com' },
      { ...f.baseEnv, REFRESH_TOKEN_URL: `http://127.0.0.1:${port(server)}/token` },
    );
    const rc = await accountHandler.switchAccount(ctx);
    assert.equal(rc, 0, 'clean success → exit 0');

    // refresh 把 switchin 的 refresh token 放 POST body（不进 argv）。
    assert.ok(
      postedRefreshToken.includes(`refresh_token=${encodeURIComponent('sk-ant-ort-NEWRT')}`),
    );

    // ① credentials.json = 新号 access·otherTop 保留。
    const cred = JSON.parse(readFileSync(f.credPath, 'utf8'));
    assert.equal(cred.claudeAiOauth.accessToken, 'sk-ant-oat-FRESH', '① overwritten to fresh');
    assert.equal(cred.otherTop, 'keepme', '① other top-level keys preserved');
    // ② ~/.claude.json oauthAccount = 切入号 identity·其它键保留。
    const cj = JSON.parse(readFileSync(f.claudeJson, 'utf8'));
    assert.equal(cj.oauthAccount.emailAddress, 'new@x.com', '② identity replaced');
    assert.equal(cj.oauthAccount.accountUuid, 'u-new');
    assert.equal(cj.numStartups, 9, '② other keys preserved');
    // ③ keychain「Claude Code-credentials」/$USER = 新号 wrapped。
    const official = JSON.parse(
      readFileSync(stubKey(f.store, 'Claude Code-credentials', 'tester'), 'utf8'),
    );
    assert.equal(
      official.claudeAiOauth.accessToken,
      'sk-ant-oat-FRESH',
      '③ keychain overwritten (wrapped)',
    );
    // registry active 翻转。
    const reg = JSON.parse(readFileSync(f.regPath, 'utf8'));
    assert.equal(reg.accounts['new@x.com'].active, true, 'switch-in active');
    assert.equal(reg.accounts['old@x.com'].active, false, 'switch-out deactivated');
    // 切出 token 抢救（Finding #72）：old@x.com vault 收到官方存储最新 blob（含 old refresh token）。
    const rescuedVault = JSON.parse(
      readFileSync(stubKey(f.store, 'cc-master-oauth', 'old@x.com'), 'utf8'),
    );
    assert.equal(
      rescuedVault.refreshToken,
      'sk-ant-ort-OLDRT',
      'switch-out vault rescued with fresh official blob',
    );

    assertTokenBlind(ctx);
  } finally {
    await close(server);
  }
});

// ══ 成功路径下自动选号（无 --email）══════════════════════════════════════════════════════════════════
test('switch: auto-select picks the only non-active switchable backup', async () => {
  const f = setupFixture();
  const server = await listen((req, res) => {
    req.on('data', () => {}); // drain（不捕获 body·本测试不断言 POST 内容）。
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ access_token: 'sk-ant-oat-FRESH2', expires_in: 28800 }));
    });
  });
  try {
    const ctx = mkCtx(
      { now: '2026-06-01T00:00:00Z' },
      { ...f.baseEnv, REFRESH_TOKEN_URL: `http://127.0.0.1:${port(server)}/token` },
    );
    const rc = await accountHandler.switchAccount(ctx);
    assert.equal(rc, 0);
    assert.equal(
      JSON.parse(readFileSync(f.regPath, 'utf8')).accounts['new@x.com'].active,
      true,
      'auto-selected new@x.com',
    );
    assertTokenBlind(ctx);
  } finally {
    await close(server);
  }
});

// ══ codex MEDIUM — dry-run 也受 policy deny 闸约束（绝不读 vault·exit 7）══════════════════════════════════
test('switch: --dry-run on a deny board → exit 7, no vault read, no store touch', async () => {
  const f = setupFixture();
  const boardPath = join(f.home, 'deny.board.json');
  writeFileSync(
    boardPath,
    JSON.stringify({
      schema: 'cc-master/board/v2',
      goal: 'g',
      policy: { autonomous_account_switch: 'deny' },
      owner: { active: true, session_id: 'sid-sw' },
      tasks: [],
    }),
  );
  const ctx = mkCtx({ email: 'new@x.com', board: boardPath }, { ...f.baseEnv }, { dryRun: true });
  const rc = await accountHandler.switchAccount(ctx);
  assert.equal(rc, 7, 'deny applies to dry-run too (deny means no switch, dry-run no exception)');
  // 零凭证副作用：① credentials.json 仍旧号（dry-run 也没读 vault / 没动存储）。
  assert.equal(
    JSON.parse(readFileSync(f.credPath, 'utf8')).claudeAiOauth.accessToken,
    'sk-ant-oat-OLDACCESS',
    '① untouched',
  );
  // dry-run deny 不写 board.log（无副作用预览）——board 仍无 log。
  const board = JSON.parse(readFileSync(boardPath, 'utf8'));
  assert.ok(
    !Array.isArray(board.log) || board.log.length === 0,
    'dry-run deny does not write board.log audit',
  );
  assertTokenBlind(ctx);
});

// ══ codex HIGH#1 — 无 registry identity → 成功但身份降级警告做响（identity_degraded）═══════════════════════
test('switch: no registry identity → exit 0 but loud identity-degraded warning; ② identity NOT switched', async () => {
  const f = setupFixture();
  // 去掉 new@x.com 的 registry identity → ② 走降级路径。
  const reg = JSON.parse(readFileSync(f.regPath, 'utf8'));
  delete reg.accounts['new@x.com'].identity;
  writeFileSync(f.regPath, `${JSON.stringify(reg, null, 2)}\n`);
  const server = await listen((req, res) => {
    req.on('data', () => {}); // drain（不捕获 body）。
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ access_token: 'sk-ant-oat-FRESH', expires_in: 28800 }));
    });
  });
  try {
    const ctx = mkCtx(
      { email: 'new@x.com', json: '1' },
      { ...f.baseEnv, REFRESH_TOKEN_URL: `http://127.0.0.1:${port(server)}/token` },
      { json: true },
    );
    const rc = await accountHandler.switchAccount(ctx);
    assert.equal(rc, 0, 'token switched → exit 0 (identity degrade is non-fatal)');
    // ① 凭证主存切到新号（认证按它走）。
    assert.equal(
      JSON.parse(readFileSync(f.credPath, 'utf8')).claudeAiOauth.accessToken,
      'sk-ant-oat-FRESH',
      '① switched',
    );
    // ② oauthAccount.email **未**切（仍旧号·只降级）。
    assert.equal(
      JSON.parse(readFileSync(f.claudeJson, 'utf8')).oauthAccount.emailAddress,
      'old@x.com',
      '② identity NOT switched (degraded)',
    );
    // 做响的降级警告 + json identity_degraded:true。
    assert.ok(
      ctx.errBuf.some((s) => s.includes('身份显示层未完整切换')),
      'loud degrade warning surfaced',
    );
    assert.ok(
      ctx.outBuf.some((s) => s.includes('"identity_degraded":true')),
      'json flags identity_degraded',
    );
    assertTokenBlind(ctx);
  } finally {
    await close(server);
  }
});

// ══ SNAPWIRE — 切出 used_pct 快照（喂 LOADBAL §2 inactive 预测）══════════════════════════════════════════
//   设计：CLI 切出前读 statusline sidecar（CC_MASTER_RATE_CACHE）取 outgoing(=active) 号 5h/7d used_pct+resets_at，
//   转成引擎 SnapshotInput（used_pct 取整·resets_at epoch 秒→严格 ISO·source=sidecar）写进 outgoing 号 last_switch_out；
//   读不到 → 降级跳过、换号不受影响。engine 保持配额源盲（只在 CLI 读 sidecar）。
test('switch: sidecar present → records switch-out used_pct snapshot to last_switch_out (SNAPWIRE)', async () => {
  const f = setupFixture();
  // 真实 sidecar 形态（statusline-capture.js 写）：used_percentage 可为浮点、resets_at 为 epoch 秒。
  const ratePath = join(f.home, 'rate-limits.json');
  const resets5h = 4102444800; // 2100-01-01T00:00:00Z（epoch 秒）。
  const resets7d = 4105123200; // 2100-02-01T00:00:00Z。
  writeFileSync(
    ratePath,
    JSON.stringify({
      captured_at: 1750000000,
      five_hour: { used_percentage: 72.6, resets_at: resets5h },
      seven_day: { used_percentage: 41.2, resets_at: resets7d },
    }),
  );
  const server = await listen((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ access_token: 'sk-ant-oat-FRESH', expires_in: 28800 }));
    });
  });
  try {
    const ctx = mkCtx(
      { email: 'new@x.com' },
      {
        ...f.baseEnv,
        REFRESH_TOKEN_URL: `http://127.0.0.1:${port(server)}/token`,
        CC_MASTER_RATE_CACHE: ratePath,
      },
    );
    const rc = await accountHandler.switchAccount(ctx);
    assert.equal(rc, 0, 'clean success → exit 0');
    // 切出号 old@x.com 拿到 last_switch_out 快照——口径与 predict.ts recoveredWindow 对齐：
    //   used_pct 是 0-100 整数（浮点取整：72.6→73, 41.2→41）、resets_at 严格 ISO-8601 UTC、source=sidecar。
    const reg = JSON.parse(readFileSync(f.regPath, 'utf8'));
    const lso = reg.accounts['old@x.com'].last_switch_out;
    assert.ok(lso, 'switch-out account got a last_switch_out snapshot');
    assert.equal(lso['5h'].used_pct, 73, '5h used_pct rounded to integer');
    assert.equal(lso['5h'].resets_at, '2100-01-01T00:00:00Z', '5h resets_at epoch→strict ISO');
    assert.equal(lso['5h'].source, 'sidecar', '5h trust tier = sidecar (account-authoritative)');
    assert.equal(lso['7d'].used_pct, 41, '7d used_pct rounded to integer');
    assert.equal(lso['7d'].resets_at, '2100-02-01T00:00:00Z', '7d resets_at epoch→strict ISO');
    // switch_history 也 append（复盘留痕）。
    assert.ok(
      Array.isArray(reg.accounts['old@x.com'].switch_history) &&
        reg.accounts['old@x.com'].switch_history.length >= 1,
      'switch_history appended',
    );
    // 醒目记录提示（非降级措辞）。
    assert.ok(
      ctx.errBuf.some((s) => s.includes('已记录切出快照') && s.includes('old@x.com')),
      'records-snapshot message surfaced',
    );
    // active 仍正常翻转（快照与换号核心解耦·P2-2）。
    assert.equal(reg.accounts['new@x.com'].active, true);
    assertTokenBlind(ctx);
  } finally {
    await close(server);
  }
});

test('switch: sidecar absent → snapshot downgrade-skip, no last_switch_out, switch still succeeds (SNAPWIRE fallback)', async () => {
  const f = setupFixture();
  const server = await listen((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ access_token: 'sk-ant-oat-FRESH', expires_in: 28800 }));
    });
  });
  try {
    // CC_MASTER_RATE_CACHE 指向不存在的 sidecar → 读不到 → 降级跳过（不崩·维持旧行为）。
    const ctx = mkCtx(
      { email: 'new@x.com' },
      {
        ...f.baseEnv,
        REFRESH_TOKEN_URL: `http://127.0.0.1:${port(server)}/token`,
        CC_MASTER_RATE_CACHE: join(f.home, 'no-such-sidecar.json'),
      },
    );
    const rc = await accountHandler.switchAccount(ctx);
    assert.equal(rc, 0, 'switch still clean-succeeds without a usage source');
    const reg = JSON.parse(readFileSync(f.regPath, 'utf8'));
    // 切出号没有 last_switch_out（无有效 used_pct 源 → 不写空快照·避免引擎校验拒写）。
    assert.equal(
      reg.accounts['old@x.com'].last_switch_out,
      undefined,
      'no snapshot written when no usage source',
    );
    // 降级跳过提示做响（含「降级跳过」措辞）。
    assert.ok(
      ctx.errBuf.some((s) => s.includes('降级跳过') && s.includes('old@x.com')),
      'downgrade-skip message surfaced',
    );
    // active 仍翻转（解耦）。
    assert.equal(reg.accounts['new@x.com'].active, true);
    assertTokenBlind(ctx);
  } finally {
    await close(server);
  }
});
