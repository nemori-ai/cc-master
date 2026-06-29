// account-registry.test.ts — @ccm/engine·account.registry（Phase 1 纯逻辑移植）契约门。
//   覆盖 validateRegistry / scanForTokenLeak / loadRegistry / saveRegistry / entry 助手 / fileVaultLineMatch /
//   nowIso / defaultRegistryPath，逐条钉住原 accounts-lib.js 的不变式。
//   测 build 后的 dist 公开 API barrel（account 命名空间），与 board-* 测试同口径。

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { account } from '../dist/index.mjs';

const SCHEMA = 'cc-master/accounts/v1';
const ISO = '2026-06-25T13:00:00Z';

function tmpDir(): { dir: string; reg: string } {
  const d = mkdtempSync(join(tmpdir(), 'ccm-acct-'));
  return { dir: d, reg: join(d, 'accounts.json') };
}

// 一个最小合法 entry（keychain vault·active:false）。
function kcEntry(email: string, extra: Record<string, unknown> = {}) {
  return {
    vault: { kind: 'keychain', service: 'cc-master-oauth', account: email },
    active: false,
    ...extra,
  };
}

// ── 常量 / 形态 ───────────────────────────────────────────────────────────────────
test('account: exposes registry surface + SCHEMA constant', () => {
  assert.equal(account.SCHEMA, SCHEMA);
  assert.equal(typeof account.validateRegistry, 'function');
  assert.equal(typeof account.loadRegistry, 'function');
  assert.equal(typeof account.saveRegistry, 'function');
  assert.equal(typeof account.mutateRegistry, 'function');
  assert.ok(account.VAULT_KINDS.has('keychain') && account.VAULT_KINDS.has('file'));
});

// ── validateRegistry：schema / 顶层形态 ────────────────────────────────────────────
test('validateRegistry: rejects non-object top level', () => {
  assert.equal(account.validateRegistry(null).errors.length, 1);
  assert.equal(account.validateRegistry([]).errors.length, 1);
  assert.equal(account.validateRegistry('x').errors.length, 1);
});

test('validateRegistry: wrong schema is a hard error', () => {
  const r = account.validateRegistry({ schema: 'nope', accounts: {} });
  assert.ok(r.errors.some((e) => /schema 必须/.test(e.message)));
});

test('validateRegistry: clean minimal registry has no errors', () => {
  const r = account.validateRegistry({ schema: SCHEMA, updated_at: ISO, accounts: {} });
  assert.equal(r.errors.length, 0);
});

test('validateRegistry: accounts must be an object map', () => {
  const r = account.validateRegistry({ schema: SCHEMA, accounts: [] });
  assert.ok(r.errors.some((e) => /accounts 必须是对象/.test(e.message)));
});

test('validateRegistry: unknown top-level field warns (agent-shaped tolerance)', () => {
  const r = account.validateRegistry({ schema: SCHEMA, accounts: {}, extra: 1 });
  assert.equal(r.errors.length, 0);
  assert.ok(r.warnings.some((w) => /未知顶层字段/.test(w.message)));
});

// ── active 唯一性 ─────────────────────────────────────────────────────────────────
test('validateRegistry: at most one active=true (uniqueness invariant)', () => {
  const reg = {
    schema: SCHEMA,
    accounts: {
      'a@x.com': kcEntry('a@x.com', { active: true }),
      'b@x.com': kcEntry('b@x.com', { active: true }),
    },
  };
  const r = account.validateRegistry(reg);
  assert.ok(r.errors.some((e) => /active 唯一性破坏/.test(e.message)));
  // 单 active → 合法。
  reg.accounts['b@x.com'].active = false;
  assert.equal(account.validateRegistry(reg).errors.length, 0);
});

test('validateRegistry: active must be boolean', () => {
  const r = account.validateRegistry({
    schema: SCHEMA,
    accounts: {
      'a@x.com': { vault: { kind: 'keychain', service: 's', account: 'a@x.com' }, active: 'yes' },
    },
  });
  assert.ok(r.errors.some((e) => /active 必填且为 boolean/.test(e.message)));
});

// ── token-leak 扫描（值 + 字段名 + identity 豁免）─────────────────────────────────
test('scanForTokenLeak: sk-ant- value anywhere is a hard error (value not echoed)', () => {
  const r = account.validateRegistry({
    schema: SCHEMA,
    accounts: { 'a@x.com': kcEntry('a@x.com', { note: 'sk-ant-oat01-DEADBEEF' }) },
  });
  const hit = r.errors.find((e) => /疑似含 token/.test(e.message));
  assert.ok(hit, 'token-like value is flagged');
  assert.ok(!/DEADBEEF/.test(hit?.message ?? ''), 'the token value is NOT echoed into the message');
});

test('scanForTokenLeak: forbidden field NAME is a hard error', () => {
  for (const name of ['token', 'oauth_token', 'access_secret', 'credential', 'bearer']) {
    const r = account.validateRegistry({
      schema: SCHEMA,
      accounts: { 'a@x.com': kcEntry('a@x.com', { [name]: 'whatever' }) },
    });
    assert.ok(
      r.errors.some((e) => /疑似用于存 token|疑似含 token/.test(e.message)),
      `field name ${name} flagged`,
    );
  }
});

test('scanForTokenLeak: identity subtree EXEMPTS field-name heuristic but KEEPS value scan', () => {
  // identity 里允许含 `oauth` 子串的字段名（CC 官方非密键名 oauthAccountUuid 等）——字段名豁免。
  const okIdentity = account.validateRegistry({
    schema: SCHEMA,
    accounts: {
      'a@x.com': kcEntry('a@x.com', {
        identity: { accountUuid: 'u-1', oauthAccountUuid: 'oa-1', emailAddress: 'a@x.com' },
      }),
    },
  });
  assert.equal(okIdentity.errors.length, 0, 'identity field-name with oauth substring is allowed');

  // 但 identity 子树里任何叶子值是 sk-ant- token 仍硬拒（值扫描全程生效）。
  const leakIdentity = account.validateRegistry({
    schema: SCHEMA,
    accounts: {
      'a@x.com': kcEntry('a@x.com', { identity: { accountUuid: 'sk-ant-oat01-LEAK' } }),
    },
  });
  assert.ok(
    leakIdentity.errors.some((e) => /疑似含 token/.test(e.message)),
    'value scan still fires in identity',
  );
});

test('scanForTokenLeak helper is directly callable + collects via err callback', () => {
  const msgs: string[] = [];
  account.scanForTokenLeak({ a: 'sk-ant-x', b: { token: 'plain' } }, 'e@x.com', (m) =>
    msgs.push(m),
  );
  assert.ok(msgs.some((m) => /疑似含 token/.test(m)));
  assert.ok(msgs.some((m) => /疑似用于存 token/.test(m)));
});

// ── vault 形态 ────────────────────────────────────────────────────────────────────
test('validateRegistry: vault required + kind ∈ {keychain,file}', () => {
  const noVault = account.validateRegistry({
    schema: SCHEMA,
    accounts: { 'a@x.com': { active: false } },
  });
  assert.ok(noVault.errors.some((e) => /vault 必填/.test(e.message)));

  const badKind = account.validateRegistry({
    schema: SCHEMA,
    accounts: { 'a@x.com': { vault: { kind: 'sqlite' }, active: false } },
  });
  assert.ok(badKind.errors.some((e) => /vault\.kind 必须/.test(e.message)));
});

test('validateRegistry: file vault needs path + key; key≠email warns', () => {
  const r = account.validateRegistry({
    schema: SCHEMA,
    accounts: {
      'a@x.com': {
        vault: { kind: 'file', path: '/v/accounts.env', key: 'b@x.com' },
        active: false,
      },
    },
  });
  assert.equal(r.errors.length, 0);
  assert.ok(r.warnings.some((w) => /file vault\.key.*不一致/.test(w.message)));
});

// ── 时间戳 + subscription_type + snapshot ─────────────────────────────────────────
test('validateRegistry: non-strict ISO timestamps warn (not error)', () => {
  const r = account.validateRegistry({
    schema: SCHEMA,
    accounts: { 'a@x.com': kcEntry('a@x.com', { token_expires_at: '2026-06-25' }) },
  });
  assert.equal(r.errors.length, 0);
  assert.ok(r.warnings.some((w) => /token_expires_at 非严格 ISO/.test(w.message)));
});

test('validateRegistry: snapshot used_pct must be 0-100 int; bad resets_at warns', () => {
  const r = account.validateRegistry({
    schema: SCHEMA,
    accounts: {
      'a@x.com': kcEntry('a@x.com', {
        last_switch_out: {
          at: ISO,
          '5h': { used_pct: 150, resets_at: ISO },
          '7d': { used_pct: 50, resets_at: 'bad' },
        },
      }),
    },
  });
  assert.ok(r.errors.some((e) => /5h\.used_pct 必须是 0-100/.test(e.message)));
  assert.ok(r.warnings.some((w) => /7d\.resets_at 非严格 ISO/.test(w.message)));
});

// ── loadRegistry ──────────────────────────────────────────────────────────────────
test('loadRegistry: missing file → empty pool (ENOENT, no throw)', () => {
  const { dir, reg } = tmpDir();
  try {
    const r = account.loadRegistry(reg);
    assert.deepEqual(r, { schema: SCHEMA, accounts: {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadRegistry: bad JSON throws a clear error', () => {
  const { dir, reg } = tmpDir();
  try {
    writeFileSync(reg, '{ not json');
    assert.throws(() => account.loadRegistry(reg), /不是合法 JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadRegistry: non-object top level throws', () => {
  const { dir, reg } = tmpDir();
  try {
    writeFileSync(reg, '[1,2,3]');
    assert.throws(() => account.loadRegistry(reg), /顶层不是对象/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadRegistry: regularizes missing accounts/schema', () => {
  const { dir, reg } = tmpDir();
  try {
    writeFileSync(reg, JSON.stringify({ updated_at: ISO }));
    const r = account.loadRegistry(reg);
    assert.equal(r.schema, SCHEMA);
    assert.deepEqual(r.accounts, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── saveRegistry：原子写 + 0600 + updated_at + token-leak 拒写 ────────────────────
test('saveRegistry: atomic write, 0600 perms, refreshes updated_at', () => {
  const { dir, reg } = tmpDir();
  try {
    const out = account.saveRegistry(
      { schema: SCHEMA, accounts: { 'a@x.com': kcEntry('a@x.com') } },
      reg,
    );
    assert.equal(out, reg);
    assert.ok(existsSync(reg));
    const mode = statSync(reg).mode & 0o777;
    assert.equal(mode, 0o600, 'registry file is 0600');
    const parsed = JSON.parse(readFileSync(reg, 'utf8'));
    assert.equal(parsed.schema, SCHEMA);
    assert.ok(account.ISO_UTC_RE.test(parsed.updated_at), 'updated_at refreshed to strict ISO');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saveRegistry: refuses to persist a token leak (security hard gate)', () => {
  const { dir, reg } = tmpDir();
  try {
    assert.throws(
      () =>
        account.saveRegistry(
          { schema: SCHEMA, accounts: { 'a@x.com': kcEntry('a@x.com', { note: 'sk-ant-LEAK' }) } },
          reg,
        ),
      /拒写.*token/,
    );
    assert.ok(!existsSync(reg), 'nothing written on token-leak reject');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saveRegistry: refuses structurally invalid registry', () => {
  const { dir, reg } = tmpDir();
  try {
    assert.throws(
      () =>
        account.saveRegistry(
          {
            schema: SCHEMA,
            accounts: {
              'a@x.com': kcEntry('a@x.com', { active: true }),
              'b@x.com': kcEntry('b@x.com', { active: true }),
            },
          },
          reg,
        ),
      /拒写.*硬 error/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saveRegistry: does not mutate the input object', () => {
  const { dir, reg } = tmpDir();
  try {
    const input = { schema: SCHEMA, accounts: { 'a@x.com': kcEntry('a@x.com') } };
    account.saveRegistry(input, reg);
    assert.equal('updated_at' in input, false, 'input untouched (clone-before-write)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── entry 助手 ────────────────────────────────────────────────────────────────────
test('upsertAccount: inserts entry, defaults active:false, never sets active', () => {
  const reg = account.emptyRegistry();
  account.upsertAccount(reg, 'a@x.com', {
    vault: { kind: 'keychain', service: 's', account: 'a@x.com' },
    token_expires_at: ISO,
  });
  assert.equal(reg.accounts['a@x.com'].active, false);
  assert.equal(reg.accounts['a@x.com'].token_expires_at, ISO);
});

test('upsertAccount: rejects token-bearing fields up front', () => {
  const reg = account.emptyRegistry();
  assert.throws(() => account.upsertAccount(reg, 'a@x.com', { token: 'x' }), /疑似存 token/);
  assert.throws(() => account.upsertAccount(reg, 'a@x.com', { note: 'sk-ant-x' }), /疑似含 token/);
});

test('upsertAccount: identity value-leak rejected (field-name exempt, value scanned)', () => {
  const reg = account.emptyRegistry();
  // 字段名含 oauth 在 identity 内放行。
  account.upsertAccount(reg, 'a@x.com', { identity: { oauthAccountUuid: 'oa-1' } });
  assert.deepEqual(reg.accounts['a@x.com'].identity, { oauthAccountUuid: 'oa-1' });
  // 但值是 token 仍拒。
  assert.throws(
    () => account.upsertAccount(reg, 'a@x.com', { identity: { accountUuid: 'sk-ant-x' } }),
    /identity 子树值疑似含 token/,
  );
});

test('upsertAccount: empty email throws', () => {
  const reg = account.emptyRegistry();
  assert.throws(() => account.upsertAccount(reg, '', {}), /email 必须是非空字符串/);
});

test('setActive: makes one active, all others false; unknown email throws', () => {
  const reg = account.emptyRegistry();
  account.upsertAccount(reg, 'a@x.com', {
    vault: { kind: 'keychain', service: 's', account: 'a@x.com' },
  });
  account.upsertAccount(reg, 'b@x.com', {
    vault: { kind: 'keychain', service: 's', account: 'b@x.com' },
  });
  account.setActive(reg, 'a@x.com');
  assert.equal(reg.accounts['a@x.com'].active, true);
  assert.equal(reg.accounts['b@x.com'].active, false);
  account.setActive(reg, 'b@x.com');
  assert.equal(reg.accounts['a@x.com'].active, false);
  assert.equal(reg.accounts['b@x.com'].active, true);
  assert.throws(() => account.setActive(reg, 'nope@x.com'), /不在号池中/);
});

test('removeAccount: deletes the entry', () => {
  const reg = account.emptyRegistry();
  account.upsertAccount(reg, 'a@x.com', {
    vault: { kind: 'keychain', service: 's', account: 'a@x.com' },
  });
  account.removeAccount(reg, 'a@x.com');
  assert.equal('a@x.com' in reg.accounts, false);
});

test('recordSwitchOut: writes last_switch_out (5h/7d) + appends switch_history', () => {
  const reg = account.emptyRegistry();
  account.upsertAccount(reg, 'a@x.com', {
    vault: { kind: 'keychain', service: 's', account: 'a@x.com' },
  });
  account.recordSwitchOut(reg, 'a@x.com', {
    at: ISO,
    fiveHour: { used_pct: 80, resets_at: ISO, source: 'account' },
    sevenDay: { used_pct: 40, resets_at: ISO },
  });
  const e = reg.accounts['a@x.com'];
  assert.equal(e.last_switch_out?.['5h']?.used_pct, 80);
  assert.equal(e.last_switch_out?.['5h']?.source, 'account');
  assert.equal(e.last_switch_out?.['7d']?.used_pct, 40);
  assert.equal(e.switch_history?.length, 1);
});

test('recordObservedQuota: writes last_observed_quota, does NOT append history', () => {
  const reg = account.emptyRegistry();
  account.upsertAccount(reg, 'a@x.com', {
    vault: { kind: 'keychain', service: 's', account: 'a@x.com' },
  });
  account.recordObservedQuota(reg, 'a@x.com', {
    at: ISO,
    fiveHour: { used_pct: 10, resets_at: ISO },
    sevenDay: { used_pct: 5, resets_at: ISO },
  });
  const e = reg.accounts['a@x.com'];
  assert.equal(e.last_observed_quota?.['5h']?.used_pct, 10);
  assert.equal(e.switch_history, undefined, 'observed quota is not a switch event → no history');
});

// ── fileVaultLineMatch（email 元字符安全·纯字符串 helper）─────────────────────────
test('fileVaultLineMatch: builds fixed-string guards (email metachar safe)', () => {
  const m = account.fileVaultLineMatch('alice@x.com');
  assert.equal(m.prefix, 'alice@x.com_');
  assert.equal(m.tokenLine, 'alice@x.com_TOKEN=');
  assert.equal(m.awkFieldGuard, 'index($0, p) == 1', 'uses awk index anchoring, not regex');
  assert.ok(!/grep -E/.test(m.awkFieldGuard), 'never regex BRE/ERE');
});

// ── nowIso / defaultRegistryPath ──────────────────────────────────────────────────
test('nowIso: strict ISO-8601 UTC, second precision (no millis)', () => {
  assert.ok(account.ISO_UTC_RE.test(account.nowIso()));
});

test('defaultRegistryPath: honors CC_MASTER_HOME', () => {
  const prev = process.env.CC_MASTER_HOME;
  try {
    process.env.CC_MASTER_HOME = '/tmp/ccm-home-xyz';
    assert.equal(account.defaultRegistryPath(), '/tmp/ccm-home-xyz/accounts.json');
  } finally {
    if (prev === undefined) delete process.env.CC_MASTER_HOME;
    else process.env.CC_MASTER_HOME = prev;
  }
});
