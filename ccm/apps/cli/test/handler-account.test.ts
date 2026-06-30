// handler-account.test.ts — account noun handler（handlers/account.ts·Phase 2a CRUD）契约门。
//
// 端到端（mkdtemp 临时 home + 真 @ccm/engine account 安全层 + file vault / stub security keychain）验证：
//   · add（file vault·credentials.json 捕获）→ exit 0·registry active:true switchable:true·vault 有 token 行。
//   · add 身份不匹配 → exit 1；vault 已有有效 blob 的旁路恢复 → exit 0 switchable:true。
//   · add vault 写成但 registry 坏 JSON → exit 3（token 安全·非干净成功）。
//   · add（keychain·stub security·-w argv）→ 完整 blob 经 argv 存 keychain·list 探活可见。
//   · delete → exit 0·entry 删净；非 TTY 无 --yes → exit 2。
//   · list → token-blind 表 / --json·坏 JSON fail-safe exit 0。
//   · ★token-blindness：所有 verb 的 out/err 绝不含任何 token 值（sk-ant-*）。

import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { Ctx } from '../src/handlers/_common.js';
import * as accountHandler from '../src/handlers/account.js';
import * as io from '../src/io.js';

const EXIT = io.EXIT;

// 当前登录号的官方完整 blob（含非空 refreshToken）·测试假串。
const WRAPPED = JSON.stringify({
  claudeAiOauth: {
    accessToken: 'sk-ant-oat-TESTACCESS',
    refreshToken: 'sk-ant-ort-TESTREFRESH',
    expiresAt: 1893456000000,
    subscriptionType: 'max',
  },
});
const TOKEN_NEEDLE = 'sk-ant-'; // token-blindness 断言用：输出绝不含此前缀。

let TMP: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ccm-hacc-'));
  TMP.push(d);
  return d;
}
afterEach(() => {
  for (const d of TMP) rmSync(d, { recursive: true, force: true });
  TMP = [];
});

type TestCtx = Ctx & { outBuf: string[]; errBuf: string[] };
function mkCtx(
  positionals: string[],
  {
    values = {},
    env = {},
    flags = {},
    isTTY = true,
  }: {
    values?: Record<string, unknown>;
    env?: Record<string, string | undefined>;
    flags?: Partial<Ctx['flags']>;
    isTTY?: boolean;
  } = {},
): TestCtx {
  const outBuf: string[] = [];
  const errBuf: string[] = [];
  return {
    values,
    positionals,
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
    sid: 'sid-acc',
    env,
    out: (s: string) => outBuf.push(s),
    err: (s: string) => errBuf.push(s),
    isTTY,
    outBuf,
    errBuf,
  };
}

// 一个临时 home（CC_MASTER_HOME）+ 身份/凭证文件，构造 add 所需 env。
function mkEnvHome(
  loginEmail: string,
  opts?: { credentials?: string },
): {
  home: string;
  env: Record<string, string | undefined>;
} {
  const root = mkTmp();
  const home = join(root, 'cc-master');
  mkdirSync(home, { recursive: true });
  const claudeJson = join(root, 'claude.json');
  writeFileSync(
    claudeJson,
    JSON.stringify({ oauthAccount: { emailAddress: loginEmail, accountUuid: 'u-1' } }),
  );
  const credJson = join(root, '.credentials.json');
  writeFileSync(credJson, opts && 'credentials' in opts ? (opts.credentials as string) : WRAPPED);
  return {
    home,
    env: {
      CC_MASTER_HOME: home,
      CLAUDE_JSON_PATH: claudeJson,
      CREDENTIALS_JSON: credJson,
      // 让 keychain 不可用 → file vault floor + credentials.json 捕获（hermetic·不碰真 keychain）。
      CCM_SECURITY_BIN: '/nonexistent/security-xyz',
      USER: 'bob',
    },
  };
}

// stub「security」（backing dir·验真 keychain argv 路径·与 engine 测试同款·find/add/delete）。
function makeSecurityStub(dir: string): string {
  const script = `#!/usr/bin/env bash
STORE=${JSON.stringify(dir)}
mkdir -p "$STORE"
sub="$1"; shift || true
svc=""; acc=""; blob=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -s) svc="$2"; shift 2;;
    -a) acc="$2"; shift 2;;
    -l) shift 2;;
    -U) shift;;
    -w) if [ "$sub" = "add-generic-password" ] && [ "$#" -ge 2 ]; then blob="$2"; shift 2; else shift; fi;;
    *) shift;;
  esac
done
key="$STORE/$(printf '%s' "$svc" | tr '/ ' '__')__$(printf '%s' "$acc" | tr '/' '_')"
case "$sub" in
  find-generic-password) if [ -f "$key" ]; then cat "$key"; exit 0; else exit 44; fi;;
  add-generic-password) printf '%s' "$blob" > "$key"; exit 0;;
  delete-generic-password) if [ -f "$key" ]; then rm -f "$key"; exit 0; else exit 44; fi;;
  *) echo usage >&2; exit 2;;
esac
`;
  const p = join(dir, 'security-stub.sh');
  writeFileSync(p, script, { mode: 0o755 });
  chmodSync(p, 0o755);
  return p;
}

function noToken(ctx: TestCtx, label: string): void {
  const all = ctx.outBuf.concat(ctx.errBuf).join('\n');
  assert.equal(
    all.includes(TOKEN_NEEDLE),
    false,
    `${label}: output must never contain a token value`,
  );
}

// ══ add（file vault·credentials.json 捕获）══════════════════════════════════════════════════════════
test('account add (file vault): exit 0, registry active+switchable, vault has token line, token-blind', () => {
  const { home, env } = mkEnvHome('me@x.com');
  const ctx = mkCtx(['me@x.com'], { values: { 'vault-kind': 'file' }, env });
  const code = accountHandler.add(ctx);
  assert.equal(code, EXIT.OK);
  // registry entry。
  const reg = JSON.parse(readFileSync(join(home, 'accounts.json'), 'utf8'));
  const e = reg.accounts['me@x.com'];
  assert.ok(e, 'entry written');
  assert.equal(e.active, true, 'current-login → active:true');
  assert.equal(e.switchable, true);
  assert.equal(e.vault.kind, 'file');
  assert.equal(e.subscription_type, 'max', 'non-secret subscription captured');
  assert.ok(e.identity && e.identity.emailAddress === 'me@x.com', 'identity captured');
  // registry 零 token。
  assert.equal(JSON.stringify(reg).includes(TOKEN_NEEDLE), false, 'registry has no token');
  // vault 文件有 token 行（含 token·但那是 0600 vault·不是 agent 输出）。
  const vault = readFileSync(join(home, 'accounts.env'), 'utf8');
  assert.ok(vault.includes('me@x.com_TOKEN='), 'vault token line present');
  // ★token-blindness：handler 的 out/err 绝不含 token 值。
  noToken(ctx, 'add');
  assert.ok(ctx.outBuf.join('').includes('<redacted>'), 'blob shown redacted');
});

// ══ add 身份不匹配 → exit 1 ═════════════════════════════════════════════════════════════════════════
test('account add: identity mismatch → exit 1 (no vault write)', () => {
  const { home, env } = mkEnvHome('someone-else@x.com'); // 当前登录 != --email。
  const ctx = mkCtx(['me@x.com'], { values: { 'vault-kind': 'file' }, env });
  const code = accountHandler.add(ctx);
  assert.equal(code, EXIT.ERROR);
  assert.equal(existsSync(join(home, 'accounts.json')), false, 'no registry written');
  noToken(ctx, 'add-mismatch');
});

// ══ add 身份不匹配但 vault 已有有效 blob → 旁路恢复 exit 0 ════════════════════════════════════════════
test('account add: identity mismatch but vault already valid → recovery marks switchable, exit 0', () => {
  const { home, env } = mkEnvHome('someone-else@x.com');
  // 预放一个 me@x.com 的有效 blob 进 file vault（手动恢复已完成的情形）。
  const vfile = join(home, 'accounts.env');
  const goodBlob = JSON.stringify({
    accessToken: 'sk-ant-oat-PRE',
    refreshToken: 'sk-ant-ort-PRE',
    expiresAt: 1893456000000,
  });
  writeFileSync(vfile, `me@x.com_TOKEN=${goodBlob}\n`, { mode: 0o600 });
  const ctx = mkCtx(['me@x.com'], { values: { 'vault-kind': 'file' }, env });
  const code = accountHandler.add(ctx);
  assert.equal(code, EXIT.OK, 'recovery path → exit 0');
  const reg = JSON.parse(readFileSync(join(home, 'accounts.json'), 'utf8'));
  assert.equal(reg.accounts['me@x.com'].switchable, true, 'marked switchable on recovery');
  noToken(ctx, 'add-recovery');
});

// ══ add vault 写成但 registry 坏 JSON → exit 3 ══════════════════════════════════════════════════════
test('account add: vault stored but registry corrupt → exit 3 (token safe, not clean success)', () => {
  const { home, env } = mkEnvHome('me@x.com');
  writeFileSync(join(home, 'accounts.json'), '{ this is not valid json', 'utf8');
  const ctx = mkCtx(['me@x.com'], { values: { 'vault-kind': 'file' }, env });
  const code = accountHandler.add(ctx);
  assert.equal(code, EXIT.VALIDATION, 'registry write failed → exit 3');
  // vault 仍写好了（token 安全进 vault）。
  assert.ok(readFileSync(join(home, 'accounts.env'), 'utf8').includes('me@x.com_TOKEN='));
  noToken(ctx, 'add-regfail');
});

// ══ add / refresh（keychain·stub security·-w argv·完整 blob 不截断）═════════════════════════════════
test('account add (keychain stub): captures current-login blob via argv, stores in keychain, list sees it', () => {
  const { home, env } = mkEnvHome('me@x.com');
  const stub = makeSecurityStub(home);
  // 预置「Claude Code-credentials」item（account=$USER=bob）= 当前登录完整 blob。
  // stub key 规则：service/空格→_，故 "Claude Code-credentials" → "Claude_Code-credentials"。
  writeFileSync(join(home, 'Claude_Code-credentials__bob'), WRAPPED);
  const env2 = { ...env, CCM_SECURITY_BIN: stub };
  const ctx = mkCtx(['me@x.com'], { values: { 'vault-kind': 'keychain' }, env: env2 });
  const code = accountHandler.add(ctx);
  assert.equal(code, EXIT.OK);
  // keychain backing 文件里是完整规整 blob（argv 写·未截断）。
  const stored = readFileSync(join(home, 'cc-master-oauth__me@x.com'), 'utf8');
  assert.ok(
    stored.includes('sk-ant-ort-TESTREFRESH'),
    'full blob (with refresh token) stored intact',
  );
  // registry keychain 形态。
  const reg = JSON.parse(readFileSync(join(home, 'accounts.json'), 'utf8'));
  assert.equal(reg.accounts['me@x.com'].vault.kind, 'keychain');
  noToken(ctx, 'add-keychain');

  // refresh = upsert 幂等（再跑一次·token_added_at 保留·token_refreshed_at 更新）。
  const added1 = reg.accounts['me@x.com'].token_added_at;
  const ctx2 = mkCtx(['me@x.com'], { values: { 'vault-kind': 'keychain' }, env: env2 });
  assert.equal(accountHandler.refresh(ctx2), EXIT.OK);
  const reg2 = JSON.parse(readFileSync(join(home, 'accounts.json'), 'utf8'));
  assert.equal(
    reg2.accounts['me@x.com'].token_added_at,
    added1,
    'token_added_at preserved on refresh',
  );
});

// ══ delete ══════════════════════════════════════════════════════════════════════════════════════════
test('account delete: removes vault token + registry entry → exit 0', () => {
  const { home, env } = mkEnvHome('me@x.com');
  // 先 add 一个 file 号。
  assert.equal(
    accountHandler.add(mkCtx(['me@x.com'], { values: { 'vault-kind': 'file' }, env })),
    EXIT.OK,
  );
  const ctx = mkCtx(['me@x.com'], { env, isTTY: true });
  const code = accountHandler.deleteAccount(ctx);
  assert.equal(code, EXIT.OK);
  const reg = JSON.parse(readFileSync(join(home, 'accounts.json'), 'utf8'));
  assert.equal('me@x.com' in reg.accounts, false, 'entry removed');
  assert.equal(
    readFileSync(join(home, 'accounts.env'), 'utf8').includes('me@x.com_TOKEN='),
    false,
    'token line removed',
  );
  noToken(ctx, 'delete');
});

test('account delete: non-TTY without --yes → exit 2 (USAGE)', () => {
  const { env } = mkEnvHome('me@x.com');
  const ctx = mkCtx(['me@x.com'], { env, isTTY: false });
  assert.equal(accountHandler.deleteAccount(ctx), EXIT.USAGE);
});

// ══ list（token-blind·fail-safe）═══════════════════════════════════════════════════════════════════
test('account list: renders table token-blind; --json structured; bad JSON → fail-safe exit 0', () => {
  const { home, env } = mkEnvHome('me@x.com');
  accountHandler.add(mkCtx(['me@x.com'], { values: { 'vault-kind': 'file' }, env }));

  // 人类表格。
  const ctx = mkCtx([], { env });
  assert.equal(accountHandler.list(ctx), EXIT.OK);
  const out = ctx.outBuf.join('\n');
  assert.ok(out.includes('me@x.com'));
  assert.ok(out.includes('SWITCHABLE') && out.includes('TOKEN'));
  noToken(ctx, 'list');

  // --json。
  const ctxJ = mkCtx([], { env, flags: { json: true } });
  assert.equal(accountHandler.list(ctxJ), EXIT.OK);
  const parsed = JSON.parse(ctxJ.outBuf.join(''));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.accounts[0].email, 'me@x.com');
  assert.equal(parsed.data.accounts[0].token_state, 'ok');
  assert.equal(ctxJ.outBuf.join('').includes(TOKEN_NEEDLE), false, 'json has no token');

  // 坏 JSON → fail-safe 空池·exit 0。
  writeFileSync(join(home, 'accounts.json'), 'garbage{', 'utf8');
  const ctxBad = mkCtx([], { env });
  assert.equal(accountHandler.list(ctxBad), EXIT.OK);
  assert.ok(ctxBad.outBuf.join('\n').includes('号池为空'), 'bad JSON degrades to empty pool');
});

// ══ list：file 号 vault 无 token → no-token（不冒充 ok）═══════════════════════════════════════════════
test('account list: file account with empty vault shows no-token (token-blind probe)', () => {
  const { home, env } = mkEnvHome('me@x.com');
  // 手写一条 registry entry（file·有 expires）但 vault 里没有 token 行。
  const reg = {
    schema: 'cc-master/accounts/v1',
    accounts: {
      'ghost@x.com': {
        vault: { kind: 'file', path: join(home, 'accounts.env'), key: 'ghost@x.com' },
        active: false,
        token_expires_at: '2099-01-01T00:00:00Z',
      },
    },
  };
  writeFileSync(join(home, 'accounts.json'), JSON.stringify(reg), 'utf8');
  const ctx = mkCtx([], { env, flags: { json: true } });
  assert.equal(accountHandler.list(ctx), EXIT.OK);
  const parsed = JSON.parse(ctx.outBuf.join(''));
  assert.equal(parsed.data.accounts[0].token_state, 'no-token', 'empty vault → no-token (not ok)');
});
