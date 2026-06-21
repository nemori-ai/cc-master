// accounts-lib.test.mjs — A2 T1：accounts.json schema v1 读写校验库的 node 测试。
//
// 覆盖（设计稿 §A schema v1 + §C-T1）：
//   load —— 空池（文件不存在）/ 坏 JSON 抛错 / 读 example 资产；
//   save —— 原子写 + 0600 权限 + 刷新 updated_at + 拒写含 token 的 registry；
//   validate —— good 零错 / 多 active / token-leak（值 + 字段名）/ 坏时间戳 warn / 坏 vault 形态；
//   助手 —— upsert / remove / setActive（唯一性）/ recordSwitchOut；
//   email 安全 —— fileVaultLineMatch 返回 grep -F / awk 安全片段。
//
// 接进 run-tests.sh 的 node 段（它 `find tests -name '*.test.mjs'`）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const LIB = join(ROOT, 'skills/account-management/scripts/accounts-lib.js');
const lib = require(LIB);
const {
  SCHEMA, validateRegistry, loadRegistry, saveRegistry, emptyRegistry,
  upsertAccount, removeAccount, setActive, recordSwitchOut, recordObservedQuota,
  fileVaultLineMatch, nowIso,
} = lib;

// 一个干净的 good registry 工厂（每个测试拿独立副本，避免互相污染）。
const goodReg = () => ({
  schema: SCHEMA,
  updated_at: '2026-06-17T10:40:00Z',
  accounts: {
    'alice@x.com': {
      vault: { kind: 'keychain', service: 'cc-master-oauth', account: 'alice@x.com' },
      token_added_at: '2026-06-17T10:40:00Z',
      token_expires_at: '2027-06-17T10:40:00Z',
      active: false,
      last_switch_out: {
        at: '2026-06-17T09:30:00Z',
        '5h': { used_pct: 89, resets_at: '2026-06-17T11:00:00Z', source: 'account' },
        '7d': { used_pct: 87, resets_at: '2026-06-24T09:00:00Z', source: 'account' },
      },
    },
    'bob@y.com': {
      vault: { kind: 'file', path: '~/.claude/cc-master/accounts.env', key: 'bob@y.com' },
      active: true,
      last_switch_out: null,
    },
  },
});

// 临时目录工具（每个 IO 测试独立目录，结束清理）。
function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ccm-acct-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ── load ─────────────────────────────────────────────────────────────────────────────────────────
test('loadRegistry: 文件不存在 = 返回空池（schema v1 + 空 accounts），不抛', () => {
  withTmp((dir) => {
    const reg = loadRegistry(join(dir, 'nope.json'));
    assert.equal(reg.schema, SCHEMA);
    assert.deepEqual(reg.accounts, {});
  });
});

test('loadRegistry: 坏 JSON = 抛清晰 error（不静默返垃圾）', () => {
  withTmp((dir) => {
    const p = join(dir, 'accounts.json');
    writeFileSync(p, '{"schema":"cc-master/accounts/v1","accounts":{');
    assert.throws(() => loadRegistry(p), /不是合法 JSON|JSON/);
  });
});

test('loadRegistry: 读 example 资产 → 过 validateRegistry 零 error', () => {
  const p = join(ROOT, 'skills/account-management/assets/accounts.example.json');
  const reg = loadRegistry(p);
  assert.equal(reg.schema, SCHEMA);
  const { errors } = validateRegistry(reg);
  assert.equal(errors.length, 0, JSON.stringify(errors));
});

test('emptyRegistry: schema v1 + 空 accounts', () => {
  const r = emptyRegistry();
  assert.equal(r.schema, SCHEMA);
  assert.deepEqual(r.accounts, {});
});

// ── validate：good ─────────────────────────────────────────────────────────────────────────────────
test('validateRegistry: good registry → 零 error 零 warning', () => {
  const r = validateRegistry(goodReg());
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  assert.equal(r.warnings.length, 0, JSON.stringify(r.warnings));
});

test('validateRegistry: 空池 { schema, accounts:{} } 合法', () => {
  const r = validateRegistry(emptyRegistry());
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
});

// ── validate：违例 ──────────────────────────────────────────────────────────────────────────────────
test('validateRegistry: schema 错 = error', () => {
  const reg = goodReg();
  reg.schema = 'cc-master/accounts/v2';
  assert.ok(validateRegistry(reg).errors.some((e) => /schema/.test(e.message)));
});

test('validateRegistry: 多于一个 active = error（active 唯一性）', () => {
  const reg = goodReg();
  reg.accounts['alice@x.com'].active = true; // bob 已 active → 两个
  const r = validateRegistry(reg);
  assert.ok(r.errors.some((e) => /active 唯一性/.test(e.message)), JSON.stringify(r.errors));
});

test('validateRegistry: token 值误入（sk-ant- 串）= error，且 message 不回显 token 值', () => {
  const reg = goodReg();
  reg.accounts['alice@x.com'].leaked = 'sk-ant-oat01-SECRETSECRETSECRET';
  const r = validateRegistry(reg);
  assert.ok(r.errors.some((e) => /token/i.test(e.message)), JSON.stringify(r.errors));
  // 安全：报错信息绝不含真 token 值。
  assert.ok(!JSON.stringify(r.errors).includes('SECRETSECRETSECRET'), 'error 不得回显 token 值');
});

test('validateRegistry: 字段名疑似存 token（如 oauth_token）= error', () => {
  const reg = goodReg();
  reg.accounts['alice@x.com'].oauth_token = 'whatever';
  assert.ok(validateRegistry(reg).errors.some((e) => /token|凭证/i.test(e.message)));
});

test('validateRegistry: 坏时间戳（分精度无秒）= warning（非 error）', () => {
  const reg = goodReg();
  reg.accounts['alice@x.com'].token_expires_at = '2027-06-17T10:40Z'; // 分精度，非严格 ISO
  const r = validateRegistry(reg);
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  assert.ok(r.warnings.some((w) => /token_expires_at/.test(w.message)));
});

test('validateRegistry: 坏 vault（kind 非法）= error', () => {
  const reg = goodReg();
  reg.accounts['alice@x.com'].vault = { kind: 'env', name: 'X' };
  assert.ok(validateRegistry(reg).errors.some((e) => /vault\.kind/.test(e.message)));
});

test('validateRegistry: keychain vault 缺 service = error', () => {
  const reg = goodReg();
  reg.accounts['alice@x.com'].vault = { kind: 'keychain', account: 'alice@x.com' };
  assert.ok(validateRegistry(reg).errors.some((e) => /service/.test(e.message)));
});

test('validateRegistry: file vault 缺 key = error', () => {
  const reg = goodReg();
  reg.accounts['bob@y.com'].vault = { kind: 'file', path: '/x/accounts.env' };
  assert.ok(validateRegistry(reg).errors.some((e) => /file vault 需 key/.test(e.message)));
});

test('validateRegistry: 坏快照（used_pct 越界）= error', () => {
  const reg = goodReg();
  reg.accounts['alice@x.com'].last_switch_out['5h'].used_pct = 150;
  assert.ok(validateRegistry(reg).errors.some((e) => /used_pct/.test(e.message)));
});

test('validateRegistry: active 非 boolean = error', () => {
  const reg = goodReg();
  reg.accounts['alice@x.com'].active = 'no';
  assert.ok(validateRegistry(reg).errors.some((e) => /active 必填/.test(e.message)));
});

// ── save：原子 + 0600 + 拒 token ──────────────────────────────────────────────────────────────────
test('saveRegistry: 写盘 + 0600 权限 + 刷新 updated_at + mkdir -p', () => {
  withTmp((dir) => {
    const p = join(dir, 'nested', 'sub', 'accounts.json'); // 测 mkdir -p
    const reg = goodReg();
    delete reg.updated_at; // 让 save 现盖
    const written = saveRegistry(reg, p);
    assert.equal(written, p);
    assert.ok(existsSync(p));
    // 0600 权限（仅 owner 读写）。
    const mode = statSync(p).mode & 0o777;
    assert.equal(mode, 0o600, `期望 0600，实得 ${mode.toString(8)}`);
    // 落盘内容有 updated_at（严格 ISO）且未篡改入参（入参仍无 updated_at）。
    const onDisk = JSON.parse(readFileSync(p, 'utf8'));
    assert.match(onDisk.updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.ok(!('updated_at' in reg), 'saveRegistry 不得篡改入参（updated_at 只进落盘副本）');
  });
});

test('saveRegistry: 含 token 值的 registry → 拒写抛错，且不落盘、错误信息不含 token 值', () => {
  withTmp((dir) => {
    const p = join(dir, 'accounts.json');
    const reg = goodReg();
    reg.accounts['alice@x.com'].sneaky = 'sk-ant-oat01-LEAKLEAKLEAK';
    assert.throws(() => saveRegistry(reg, p), (e) => {
      assert.ok(/token|凭证/i.test(e.message), '应报 token 拒写');
      assert.ok(!e.message.includes('LEAKLEAKLEAK'), '错误信息不得回显 token 值');
      return true;
    });
    assert.ok(!existsSync(p), '拒写时绝不落盘');
  });
});

test('saveRegistry: 结构非法（多 active）→ 拒写抛错', () => {
  withTmp((dir) => {
    const p = join(dir, 'accounts.json');
    const reg = goodReg();
    reg.accounts['alice@x.com'].active = true; // 两个 active
    assert.throws(() => saveRegistry(reg, p), /硬 error|active/);
    assert.ok(!existsSync(p));
  });
});

test('saveRegistry → loadRegistry round-trip 等价（accounts 不变）', () => {
  withTmp((dir) => {
    const p = join(dir, 'accounts.json');
    const reg = goodReg();
    saveRegistry(reg, p);
    const back = loadRegistry(p);
    assert.deepEqual(back.accounts, reg.accounts);
    assert.equal(back.schema, SCHEMA);
  });
});

// ── 助手：upsert / remove / setActive / recordSwitchOut ─────────────────────────────────────────────
test('upsertAccount: 新增 entry（vault + 时间元信息），active 默认 false，不动其他号', () => {
  const reg = goodReg();
  upsertAccount(reg, 'carol@z.com', {
    vault: { kind: 'keychain', service: 'cc-master-oauth', account: 'carol@z.com' },
    token_added_at: '2026-06-17T12:00:00Z',
    token_expires_at: '2027-06-17T12:00:00Z',
  });
  assert.ok(reg.accounts['carol@z.com']);
  assert.equal(reg.accounts['carol@z.com'].active, false);
  assert.equal(reg.accounts['bob@y.com'].active, true, 'upsert 不动现 active 号');
  assert.equal(validateRegistry(reg).errors.length, 0);
});

test('upsertAccount: 更新已存在 entry（merge，保留未传字段）', () => {
  const reg = goodReg();
  const prevActive = reg.accounts['bob@y.com'].active;
  upsertAccount(reg, 'bob@y.com', { token_refreshed_at: '2026-06-17T13:00:00Z' });
  assert.equal(reg.accounts['bob@y.com'].token_refreshed_at, '2026-06-17T13:00:00Z');
  assert.equal(reg.accounts['bob@y.com'].active, prevActive, 'upsert 不覆盖 active');
  assert.ok(reg.accounts['bob@y.com'].vault, 'merge 保留 vault');
});

test('upsertAccount: 传含 token 的字段 → 抛错（防误入）', () => {
  const reg = goodReg();
  assert.throws(() => upsertAccount(reg, 'x@y.com', { oauth_token: 'x' }), /token|凭证/i);
  assert.throws(() => upsertAccount(reg, 'x@y.com', { vault_ref: 'sk-ant-oat01-XX' }), /token/i);
});

test('removeAccount: 删 entry', () => {
  const reg = goodReg();
  removeAccount(reg, 'alice@x.com');
  assert.ok(!('alice@x.com' in reg.accounts));
  assert.ok('bob@y.com' in reg.accounts);
});

test('setActive: 置一个 active=true、其余全 false（维护唯一性）', () => {
  const reg = goodReg(); // bob 当前 active
  setActive(reg, 'alice@x.com');
  assert.equal(reg.accounts['alice@x.com'].active, true);
  assert.equal(reg.accounts['bob@y.com'].active, false);
  const actives = Object.values(reg.accounts).filter((e) => e.active === true).length;
  assert.equal(actives, 1);
  assert.equal(validateRegistry(reg).errors.length, 0);
});

test('setActive: email 不在池中 → 抛错', () => {
  const reg = goodReg();
  assert.throws(() => setActive(reg, 'ghost@nowhere.com'), /不在号池/);
});

// ── codex round#2 P2: add-marks-active 路径（account-add 录当前登录号 → upsert 后 setActive 标 active:true）─────
//   account-add.sh 录**当前登录号**时 upsert 后调 setActive(reg, email)——本测试证明该路径维护 active 唯一性
//   （新录号 active:true、原 active 号被置 false），且过 validateRegistry 零 error（active 唯一性硬校验仍把关）。
test('add-marks-active: upsert 新号后 setActive 标其 active:true 且维护唯一性（原 active 号被置 false）', () => {
  const reg = goodReg(); // bob 当前 active:true
  // 模拟 account-add 录当前登录号：先 upsert（默认 active:false），再 setActive 标 active:true。
  upsertAccount(reg, 'carol@z.com', {
    vault: { kind: 'keychain', service: 'cc-master-oauth', account: 'carol@z.com' },
    token_added_at: '2026-06-18T09:00:00Z',
  });
  assert.equal(reg.accounts['carol@z.com'].active, false, 'upsert 默认 active:false（add 不自动设 active·§A.5）');
  setActive(reg, 'carol@z.com');
  // carol 现 active:true、bob 被置 false、alice 仍 false → active 唯一。
  assert.equal(reg.accounts['carol@z.com'].active, true, 'setActive 标新录的当前登录号 active:true');
  assert.equal(reg.accounts['bob@y.com'].active, false, 'setActive 把原 active 号 bob 置 false（唯一性）');
  assert.equal(reg.accounts['alice@x.com'].active, false, '其余号保持 active:false');
  const actives = Object.values(reg.accounts).filter((e) => e.active === true).length;
  assert.equal(actives, 1, 'active 唯一性保持（恰一个 active:true）');
  // 过 validateRegistry 零 error（active 唯一性硬校验不报错·saveRegistry 仍把关）。
  assert.equal(validateRegistry(reg).errors.length, 0, JSON.stringify(validateRegistry(reg).errors));
});

test('recordSwitchOut: 写 last_switch_out 快照（fiveHour/sevenDay 映射 5h/7d）+ append history', () => {
  const reg = goodReg();
  recordSwitchOut(reg, 'bob@y.com', {
    at: '2026-06-17T14:00:00Z',
    fiveHour: { used_pct: 92, resets_at: '2026-06-17T16:00:00Z', source: 'account' },
    sevenDay: { used_pct: 78, resets_at: '2026-06-24T14:00:00Z', source: 'account' },
  });
  const lso = reg.accounts['bob@y.com'].last_switch_out;
  assert.equal(lso.at, '2026-06-17T14:00:00Z');
  assert.equal(lso['5h'].used_pct, 92);
  assert.equal(lso['7d'].resets_at, '2026-06-24T14:00:00Z');
  assert.equal(lso['5h'].source, 'account');
  // append 进 history。
  assert.ok(Array.isArray(reg.accounts['bob@y.com'].switch_history));
  assert.equal(reg.accounts['bob@y.com'].switch_history.length, 1);
  // 写后仍合法。
  assert.equal(validateRegistry(reg).errors.length, 0, JSON.stringify(validateRegistry(reg).errors));
});

// ── last_observed_quota（优化①·录号那刻配额快照·弱信号兜底·与 last_switch_out 同形）─────────────────
test('recordObservedQuota: 写 last_observed_quota 快照（fiveHour/sevenDay 映射 5h/7d），不 append history', () => {
  const reg = goodReg();
  recordObservedQuota(reg, 'bob@y.com', {
    at: '2026-06-18T08:00:00Z',
    fiveHour: { used_pct: 12, resets_at: '2026-06-18T10:00:00Z', source: 'account' },
    sevenDay: { used_pct: 34, resets_at: '2026-06-25T08:00:00Z', source: 'account' },
  });
  const loq = reg.accounts['bob@y.com'].last_observed_quota;
  assert.equal(loq.at, '2026-06-18T08:00:00Z');
  assert.equal(loq['5h'].used_pct, 12);
  assert.equal(loq['7d'].resets_at, '2026-06-25T08:00:00Z');
  assert.equal(loq['5h'].source, 'account');
  // recordObservedQuota 绝不 append switch_history（它不是 switch 事件、只是注册时刻一次性快照）。
  assert.ok(!Array.isArray(reg.accounts['bob@y.com'].switch_history));
  // 写后仍合法（last_observed_quota 校验复用 validateSnapshot）。
  assert.equal(validateRegistry(reg).errors.length, 0, JSON.stringify(validateRegistry(reg).errors));
});

test('recordObservedQuota: email 不在池中 → 抛错', () => {
  const reg = goodReg();
  assert.throws(() => recordObservedQuota(reg, 'ghost@nowhere.com', {}), /不在号池/);
});

test('validateRegistry: 坏 last_observed_quota（used_pct 越界）= error（复用 validateSnapshot）', () => {
  const reg = goodReg();
  reg.accounts['bob@y.com'].last_observed_quota = {
    at: '2026-06-18T08:00:00Z',
    '5h': { used_pct: 150, resets_at: '2026-06-18T10:00:00Z', source: 'account' }, // 越界。
    '7d': { used_pct: 20, resets_at: '2026-06-25T08:00:00Z', source: 'account' },
  };
  assert.ok(validateRegistry(reg).errors.some((e) => /used_pct/.test(e.message)), JSON.stringify(validateRegistry(reg).errors));
});

test('validateRegistry: good last_observed_quota → 零 error', () => {
  const reg = goodReg();
  reg.accounts['bob@y.com'].last_observed_quota = {
    at: '2026-06-18T08:00:00Z',
    '5h': { used_pct: 5, resets_at: '2026-06-18T10:00:00Z', source: 'local-derived-approx' },
    '7d': { used_pct: 8, resets_at: '2026-06-25T08:00:00Z', source: 'local-derived-approx' },
  };
  const r = validateRegistry(reg);
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
});

// ── email 安全 helper（给 T3/T4 bash file vault 用）─────────────────────────────────────────────────
test('fileVaultLineMatch: 返回 grep -F / awk 安全片段（对 email 的 . / @ 元字符免疫）', () => {
  const m = fileVaultLineMatch('alice@x.com');
  assert.equal(m.prefix, 'alice@x.com_');
  assert.equal(m.tokenLine, 'alice@x.com_TOKEN=');
  assert.equal(m.expiresLine, 'alice@x.com_EXPIRES=');
  // grep -F（fixed-string）—— 关键：必须是 -F 而非 -E（否则 . 当正则元字符，§A.4 bug）。
  assert.match(m.grepFixedToken, /grep -F/);
  assert.match(m.grepFixedToken, /alice@x\.com_TOKEN=/);
  // awk 守卫用 index()（非正则前缀比较）。
  assert.match(m.awkFieldGuard, /index\(\$0, p\)/);
  // 纪律 note 在。
  assert.match(m.note, /grep -F|awk/);
});

test('fileVaultLineMatch: 空 email 抛错', () => {
  assert.throws(() => fileVaultLineMatch(''), /email/);
});

// ── nowIso 格式纪律 ─────────────────────────────────────────────────────────────────────────────────
test('nowIso: 严格 ISO-8601 UTC 秒精度（YYYY-MM-DDTHH:MM:SSZ，无毫秒）', () => {
  assert.match(nowIso(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});
