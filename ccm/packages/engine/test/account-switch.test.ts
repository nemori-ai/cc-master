// account-switch.test.ts — @ccm/engine·account/switch（Phase 2b 无重启换号机制层）契约门。
//   钉住最重最险那段的每个安全闸：三存储全或无（① credentials.json → ② ~/.claude.json → ③ keychain·快照+回滚）/
//   ② 身份写失败回滚 ① / ③ keychain 失败回滚 ①② / 快照失败 fail-closed 中止 / 切出 token 抢救（Finding #72·身份 guard）/
//   双向中断恢复（前向对齐 vs 回滚）/ force-refresh 兜底 / token-blindness（返回 messages 绝不含 token）。
//   测 build 后的 dist 公开 API barrel（account 命名空间），与 account-vault / account-refresh 同口径。

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
import { account } from '../dist/index.mjs';

const OLD_BLOB = JSON.stringify({
  accessToken: 'sk-ant-oat-OLDACCESS',
  refreshToken: 'sk-ant-ort-OLDREFRESH',
  expiresAt: 111,
  subscriptionType: 'max',
});
const NEW_BLOB = JSON.stringify({
  accessToken: 'sk-ant-oat-NEWACCESS',
  refreshToken: 'sk-ant-ort-NEWREFRESH',
  expiresAt: 1893456000000,
  subscriptionType: 'max',
});
const TOKEN_NEEDLE = 'sk-ant-';

let TMP: string[] = [];
const CHMOD_RESTORE: string[] = [];
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ccm-sw-'));
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

// ── controllable in-memory fake KeychainProvider ──────────────────────────────────────────────────
function fakeKeychain(opts?: { available?: boolean }) {
  const store = new Map<string, string>();
  let failWrite = false;
  const k = (s: string, a: string) => `${s}\0${a}`;
  const provider = {
    isAvailable: () => opts?.available !== false,
    exists: (s: string, a: string) => store.has(k(s, a)),
    read: (s: string, a: string) => (store.has(k(s, a)) ? (store.get(k(s, a)) as string) : null),
    write: (s: string, a: string, _l: string, blob: string) => {
      if (failWrite) return false;
      store.set(k(s, a), blob);
      return true;
    },
    delete: (s: string, a: string) => {
      if (store.has(k(s, a))) {
        store.delete(k(s, a));
        return 'deleted' as const;
      }
      return 'absent' as const;
    },
  };
  return { provider, store, setFailWrite: (v: boolean) => (failWrite = v), key: k };
}

function noTokenInAll(msgs: string[]): void {
  for (const m of msgs) assert.ok(!m.includes(TOKEN_NEEDLE), `message carries no token: ${m}`);
}

// ══ forceRefreshBlob ════════════════════════════════════════════════════════════════════════════════
test('forceRefreshBlob: sets expiresAt to ~now+60s, keeps refresh token', () => {
  const out = account.forceRefreshBlob(OLD_BLOB);
  assert.ok(out);
  const o = JSON.parse(out as string);
  assert.equal(o.refreshToken, 'sk-ant-ort-OLDREFRESH', 'refresh token preserved');
  assert.ok(
    o.expiresAt > Date.now() && o.expiresAt <= Date.now() + 70 * 1000,
    'expiresAt ~now+60s',
  );
  assert.equal(account.forceRefreshBlob('not json'), null);
});

// ══ readOfficialBlob ════════════════════════════════════════════════════════════════════════════════
test('readOfficialBlob: unwraps claudeAiOauth from keychain; falls back to credentials.json', () => {
  const dir = mkTmp();
  const kc = fakeKeychain();
  const user = 'tester';
  // keychain 官方条目（包裹形）。
  kc.store.set(
    kc.key('Claude Code-credentials', user),
    JSON.stringify({ claudeAiOauth: JSON.parse(OLD_BLOB) }),
  );
  const got = account.readOfficialBlob({ keychain: kc.provider, user });
  assert.ok(got);
  const o = JSON.parse(got as string);
  assert.equal(o.accessToken, 'sk-ant-oat-OLDACCESS', 'bare oauth object unwrapped');
  assert.ok(!('claudeAiOauth' in o), 'unwrapped (no wrapper)');

  // keychain 无 → fallback credentials.json。
  const credPath = join(dir, '.credentials.json');
  writeFileSync(credPath, JSON.stringify({ claudeAiOauth: JSON.parse(NEW_BLOB) }));
  const kc2 = fakeKeychain();
  const got2 = account.readOfficialBlob({
    keychain: kc2.provider,
    user,
    credentialsJsonPath: credPath,
  });
  assert.equal(JSON.parse(got2 as string).accessToken, 'sk-ant-oat-NEWACCESS');

  // 缺 refreshToken → null（抢救一个残缺 blob 无意义）。
  const kc3 = fakeKeychain();
  kc3.store.set(
    kc3.key('Claude Code-credentials', user),
    JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-X', expiresAt: 1 } }),
  );
  assert.equal(
    account.readOfficialBlob({
      keychain: kc3.provider,
      user,
      credentialsJsonPath: join(dir, 'nope.json'),
    }),
    null,
  );
});

// ══ overwriteOfficialStores · 成功路径（mac·identity 完整替换·三存储全新号）════════════════════════════
test('overwriteOfficialStores: success overwrites ①②③, preserves other keys, replaces identity', () => {
  const dir = mkTmp();
  const credPath = join(dir, '.credentials.json');
  const claudeJson = join(dir, '.claude.json');
  writeFileSync(
    credPath,
    JSON.stringify({ claudeAiOauth: JSON.parse(OLD_BLOB), otherTop: 'keepme' }),
  );
  writeFileSync(
    claudeJson,
    JSON.stringify({
      oauthAccount: { emailAddress: 'old@x.com', accountUuid: 'u-old' },
      numStartups: 7,
      projects: { a: 1 },
    }),
  );
  const kc = fakeKeychain();
  const user = 'tester';
  const identity = JSON.stringify({
    emailAddress: 'new@x.com',
    accountUuid: 'u-new',
    organizationName: 'Org',
  });
  const trap = account.newTrapState({
    regPath: join(dir, 'accounts.json'),
    keychain: kc.provider,
    user,
    snapParent: dir, // 快照唯一目录造在 dir 下（mkdtemp·private 0700）。
  });

  const r = account.overwriteOfficialStores({
    blob: NEW_BLOB,
    identityJson: identity,
    switchInEmail: 'new@x.com',
    credPath,
    claudeJsonPath: claudeJson,
    trap,
  });
  assert.equal(r.ok, true);
  assert.equal(r.committed, true);
  assert.equal(r.identityDegraded, false, 'identity fully replaced → not degraded');
  noTokenInAll(r.messages);

  // ① credentials.json：.claudeAiOauth 换新号·otherTop 保留。
  const cred = JSON.parse(readFileSync(credPath, 'utf8'));
  assert.equal(cred.claudeAiOauth.accessToken, 'sk-ant-oat-NEWACCESS');
  assert.equal(cred.otherTop, 'keepme', 'other top-level keys preserved');
  // ② ~/.claude.json：oauthAccount 完整替换·其它键保留。
  const cj = JSON.parse(readFileSync(claudeJson, 'utf8'));
  assert.deepEqual(cj.oauthAccount, JSON.parse(identity), 'oauthAccount fully replaced');
  assert.equal(cj.numStartups, 7, 'other keys preserved');
  assert.deepEqual(cj.projects, { a: 1 });
  // ③ keychain：包裹形 wrapped。
  const wrapped = kc.store.get(kc.key('Claude Code-credentials', user));
  assert.ok(wrapped && JSON.parse(wrapped).claudeAiOauth.accessToken === 'sk-ant-oat-NEWACCESS');
  // trap：已提交·窗口关·含 token 的快照已清（snapDir 已移除·绝不残留·codex CRITICAL#1/#2）。
  assert.equal(trap.storesCommitted, true);
  assert.equal(trap.overwriteInProgress, false);
  assert.equal(trap.snapCredTmp, '');
  // snapDir 是 mkdtemp 造的**唯一私有目录**（前缀 .ccm-cred-snap-·随机后缀·抗 symlink 劫持·codex CRITICAL#1）。
  assert.ok(trap.snapDir.includes('.ccm-cred-snap-'), 'snapshot dir is a unique mkdtemp dir');
  assert.equal(existsSync(trap.snapDir), false, 'unique snapshot dir removed after cleanup');
});

// ══ overwriteOfficialStores · ③ keychain 失败 → 回滚 ①② 到旧号（全或无）════════════════════════════════
test('overwriteOfficialStores: ③ keychain failure rolls back ①② to old account', () => {
  const dir = mkTmp();
  const credPath = join(dir, '.credentials.json');
  const claudeJson = join(dir, '.claude.json');
  writeFileSync(credPath, JSON.stringify({ claudeAiOauth: JSON.parse(OLD_BLOB) }));
  writeFileSync(
    claudeJson,
    JSON.stringify({ oauthAccount: { emailAddress: 'old@x.com' }, keep: 1 }),
  );
  const kc = fakeKeychain();
  kc.setFailWrite(true); // ③ keychain 写必失败。
  const trap = account.newTrapState({
    regPath: join(dir, 'accounts.json'),
    keychain: kc.provider,
    user: 'tester',
  });

  const r = account.overwriteOfficialStores({
    blob: NEW_BLOB,
    identityJson: JSON.stringify({ emailAddress: 'new@x.com' }),
    switchInEmail: 'new@x.com',
    credPath,
    claudeJsonPath: claudeJson,
    trap,
  });
  assert.equal(r.ok, false);
  assert.equal(r.rolledBack, true);
  assert.equal(r.splitBrainRisk, false);
  noTokenInAll(r.messages);
  // 三存储全留旧号（换号未发生·可重试）。
  assert.equal(
    JSON.parse(readFileSync(credPath, 'utf8')).claudeAiOauth.accessToken,
    'sk-ant-oat-OLDACCESS',
    '① rolled back',
  );
  assert.deepEqual(
    JSON.parse(readFileSync(claudeJson, 'utf8')).oauthAccount,
    { emailAddress: 'old@x.com' },
    '② rolled back',
  );
  assert.equal(trap.storesCommitted, false);
  assert.equal(trap.overwriteInProgress, false);
});

// ══ overwriteOfficialStores · ② 身份写失败 → 回滚 ①（避免 split-identity）════════════════════════════════
test('overwriteOfficialStores: ② identity write failure rolls back ① (no split-identity)', () => {
  const dirA = mkTmp(); // ① 可写。
  const dirB = mkTmp(); // ② 之后置只读迫使写失败。
  const credPath = join(dirA, '.credentials.json');
  const claudeJson = join(dirB, '.claude.json');
  writeFileSync(credPath, JSON.stringify({ claudeAiOauth: JSON.parse(OLD_BLOB) }));
  writeFileSync(claudeJson, JSON.stringify({ oauthAccount: { emailAddress: 'old@x.com' } }));
  chmodSync(dirB, 0o500); // 只读目录：② 的 atomicWrite tmp 创建失败 → 身份写失败。
  CHMOD_RESTORE.push(dirB);
  const kc = fakeKeychain();
  const trap = account.newTrapState({
    regPath: join(dirA, 'accounts.json'),
    keychain: kc.provider,
    user: 'tester',
  });

  const r = account.overwriteOfficialStores({
    blob: NEW_BLOB,
    identityJson: JSON.stringify({ emailAddress: 'new@x.com' }),
    switchInEmail: 'new@x.com',
    credPath,
    claudeJsonPath: claudeJson,
    trap,
  });
  // 关键安全性质（防 split-identity）：② 写失败 → ① 必回滚到旧号、② 本就未被改、③ keychain 从未触达。
  //   注：本测试以「只读目录」迫使 ② 写失败，该注入也连带使 ② 的回滚 restore 失败（同一目录）——那是注入产物，
  //   非真实行为（② 原值完好·原子写失败前未 rename）。故只断言真正的安全性质，不断言 rolledBack/splitBrainRisk 标志。
  assert.equal(r.ok, false);
  assert.equal(r.committed, false);
  noTokenInAll(r.messages);
  assert.equal(
    JSON.parse(readFileSync(credPath, 'utf8')).claudeAiOauth.accessToken,
    'sk-ant-oat-OLDACCESS',
    '① rolled back to old (no split-identity)',
  );
  assert.equal(
    JSON.parse(readFileSync(claudeJson, 'utf8')).oauthAccount.emailAddress,
    'old@x.com',
    '② never modified (atomic write failed before rename)',
  );
  assert.equal(kc.store.size, 0, 'keychain never written (③ unreached)');
  assert.equal(trap.storesCommitted, false);
});

// ══ overwriteOfficialStores · 快照失败 → fail-closed 中止（三存储原封）════════════════════════════════════
test('overwriteOfficialStores: snapshot failure aborts without touching any store', () => {
  const dir = mkTmp();
  const credPath = join(dir, '.credentials.json');
  writeFileSync(credPath, JSON.stringify({ claudeAiOauth: JSON.parse(OLD_BLOB) }));
  chmodSync(credPath, 0o000); // 不可读 → 快照 cp 失败。
  CHMOD_RESTORE.push(credPath);
  const kc = fakeKeychain();
  const trap = account.newTrapState({
    regPath: join(dir, 'accounts.json'),
    keychain: kc.provider,
    user: 'tester',
  });

  const r = account.overwriteOfficialStores({
    blob: NEW_BLOB,
    identityJson: '',
    switchInEmail: 'new@x.com',
    credPath,
    claudeJsonPath: join(dir, '.claude.json'),
    trap,
  });
  assert.equal(r.ok, false);
  assert.equal(r.committed, false);
  assert.ok(
    r.messages.some((m) => m.includes('中止换号')),
    'abort message',
  );
  assert.equal(kc.store.size, 0, 'keychain untouched');
  assert.equal(trap.overwriteInProgress, false, 'never entered overwrite window');
});

// ══ rollbackOfficialStores12 · 新建文件 rm + 无快照 split-brain 检测 ════════════════════════════════════
test('rollbackOfficialStores12: removes new files; flags split-brain when preexisted but no snapshot', () => {
  const dir = mkTmp();
  const credPath = join(dir, '.credentials.json');
  const claudeJson = join(dir, '.claude.json');
  // 场景 1：换号新建（preexisted=false）→ rm 删回无此文件。
  writeFileSync(credPath, JSON.stringify({ claudeAiOauth: JSON.parse(NEW_BLOB) }));
  writeFileSync(claudeJson, '{}');
  const kc = fakeKeychain();
  const trap1 = account.newTrapState({
    regPath: join(dir, 'a.json'),
    keychain: kc.provider,
    user: 'u',
  });
  trap1.credPreexisted = false;
  trap1.cjPreexisted = false;
  const r1 = account.rollbackOfficialStores12(credPath, claudeJson, trap1);
  assert.equal(r1.ok, true);
  assert.equal(existsSync(credPath), false, 'new ① removed');
  assert.equal(existsSync(claudeJson), false, 'new ② removed');

  // 场景 2：preexisted=true 但无快照（换号前快照失败）→ 标 split-brain（ok=false·不静默放行）。
  writeFileSync(credPath, JSON.stringify({ claudeAiOauth: JSON.parse(NEW_BLOB) }));
  const trap2 = account.newTrapState({
    regPath: join(dir, 'a.json'),
    keychain: kc.provider,
    user: 'u',
  });
  trap2.credPreexisted = true;
  trap2.snapCredTmp = ''; // 无快照。
  trap2.cjPreexisted = false;
  const r2 = account.rollbackOfficialStores12(credPath, claudeJson, trap2);
  assert.equal(r2.ok, false, 'no-snapshot pre-existing → rollback failure flagged');
  assert.ok(r2.messages.some((m) => m.includes('split-brain')));
});

// ══ rescueSwitchoutToken · 身份 guard + 成功回写（Finding #72）════════════════════════════════════════════
test('rescueSwitchoutToken: identity guard skips on mismatch; rescues on match', () => {
  const dir = mkTmp();
  const claudeJson = join(dir, '.claude.json');
  const kc = fakeKeychain();
  const user = 'tester';
  // 官方存储当前 = 切出号最新 blob（含轮转后新 refreshToken）。
  kc.store.set(
    kc.key('Claude Code-credentials', user),
    JSON.stringify({ claudeAiOauth: JSON.parse(NEW_BLOB) }),
  );
  const soRef = {
    kind: 'keychain' as const,
    service: 'cc-master-oauth',
    account: 'switchout@x.com',
  };

  // 身份不匹配（官方存储 oauthAccount 不是切出号）→ 跳过·绝不污染切出号 vault。
  writeFileSync(
    claudeJson,
    JSON.stringify({ oauthAccount: { emailAddress: 'someoneelse@x.com' } }),
  );
  const miss = account.rescueSwitchoutToken({
    switchOutEmail: 'switchout@x.com',
    switchInEmail: 'switchin@x.com',
    switchOutRef: soRef,
    keychain: kc.provider,
    user,
    claudeJsonPath: claudeJson,
  });
  assert.equal(miss.rescued, false);
  assert.equal(miss.reason, 'identity-mismatch');
  assert.equal(
    kc.store.has(kc.key('cc-master-oauth', 'switchout@x.com')),
    false,
    'switchout vault NOT polluted',
  );

  // 身份匹配 → 回写切出号 vault（补 vault↔官方存储反向新鲜）。
  writeFileSync(claudeJson, JSON.stringify({ oauthAccount: { emailAddress: 'switchout@x.com' } }));
  const ok = account.rescueSwitchoutToken({
    switchOutEmail: 'switchout@x.com',
    switchInEmail: 'switchin@x.com',
    switchOutRef: soRef,
    keychain: kc.provider,
    user,
    claudeJsonPath: claudeJson,
  });
  assert.equal(ok.rescued, true);
  const rescued = kc.store.get(kc.key('cc-master-oauth', 'switchout@x.com'));
  assert.equal(
    JSON.parse(rescued as string).refreshToken,
    'sk-ant-ort-NEWREFRESH',
    'fresh refresh token saved to switchout vault',
  );

  // 切入==切出 → 无可抢救·跳过。
  const self = account.rescueSwitchoutToken({
    switchOutEmail: 'same@x.com',
    switchInEmail: 'same@x.com',
    switchOutRef: soRef,
    keychain: kc.provider,
    user,
    claudeJsonPath: claudeJson,
  });
  assert.equal(self.skipped, true);
  assert.equal(self.reason, 'no-switchout');
});

// ══ forwardAlignOrRollback · 阶段 B 前向对齐（不回滚已提交的 ①）════════════════════════════════════════
test('forwardAlignOrRollback: forward-aligns when stores committed (rewrites keychain ③ + setActive)', () => {
  const dir = mkTmp();
  const regPath = join(dir, 'accounts.json');
  writeFileSync(
    regPath,
    JSON.stringify({
      schema: 'cc-master/accounts/v1',
      accounts: {
        'old@x.com': {
          vault: { kind: 'keychain', service: 'cc-master-oauth', account: 'old@x.com' },
          active: true,
        },
        'new@x.com': {
          vault: { kind: 'keychain', service: 'cc-master-oauth', account: 'new@x.com' },
          active: false,
        },
      },
    }),
  );
  const kc = fakeKeychain();
  const user = 'tester';
  const trap = account.newTrapState({ regPath, keychain: kc.provider, user });
  // 模拟「最终存储已提交、收尾未完成」窗口被中断。
  trap.storesCommitted = true;
  trap.activeAligned = false;
  trap.commitSwitchinEmail = 'new@x.com';
  trap.commitWrappedBlob = `{"claudeAiOauth":${NEW_BLOB}}`;
  trap.overwriteInProgress = true; // 残留（codex re-§7 P1：前向对齐须清掉它防第二次 trap 误回滚）。
  trap.overwriteCredPath = join(dir, '.credentials.json');

  const r = account.forwardAlignOrRollback(trap);
  assert.equal(r.action, 'forward-align');
  assert.equal(r.regAligned, true);
  noTokenInAll(r.messages);
  // keychain ③ 被补写新号。
  assert.ok((kc.store.get(kc.key('Claude Code-credentials', user)) || '').includes('NEWACCESS'));
  // registry active 翻到切入号。
  const reg = JSON.parse(readFileSync(regPath, 'utf8'));
  assert.equal(reg.accounts['new@x.com'].active, true);
  assert.equal(reg.accounts['old@x.com'].active, false);
  // 清掉回滚物料（防第二次 trap 误回滚）。
  assert.equal(trap.overwriteInProgress, false);
  assert.equal(trap.activeAligned, true);
});

test('forwardAlignOrRollback: forward-align regAligned=false when switch-in not in registry (RC-P3)', () => {
  const dir = mkTmp();
  const regPath = join(dir, 'accounts.json');
  writeFileSync(
    regPath,
    JSON.stringify({
      schema: 'cc-master/accounts/v1',
      accounts: {
        'old@x.com': {
          vault: { kind: 'keychain', service: 'cc-master-oauth', account: 'old@x.com' },
          active: true,
        },
      },
    }),
  );
  const kc = fakeKeychain();
  const trap = account.newTrapState({ regPath, keychain: kc.provider, user: 'tester' });
  trap.storesCommitted = true;
  trap.commitSwitchinEmail = 'absent@x.com'; // 不在 registry。
  const r = account.forwardAlignOrRollback(trap);
  assert.equal(r.action, 'forward-align');
  assert.equal(r.regAligned, false, 'stale-registry honestly reported (not falsely aligned)');
});

// ══ forwardAlignOrRollback · 阶段 A 回滚（覆写窗口内未提交）+ noop ════════════════════════════════════════
test('forwardAlignOrRollback: rolls back when in overwrite window (uncommitted); noop on fresh trap', () => {
  const dir = mkTmp();
  const credPath = join(dir, '.credentials.json');
  const claudeJson = join(dir, '.claude.json');
  // 覆写窗口内被中断：① 已写新号、有快照（preexisted）。
  const snap = join(dir, 'credsnap');
  writeFileSync(snap, JSON.stringify({ claudeAiOauth: JSON.parse(OLD_BLOB) })); // 旧号快照。
  writeFileSync(credPath, JSON.stringify({ claudeAiOauth: JSON.parse(NEW_BLOB) })); // 已被覆写新号。
  const kc = fakeKeychain();
  const trap = account.newTrapState({
    regPath: join(dir, 'a.json'),
    keychain: kc.provider,
    user: 'u',
  });
  trap.overwriteInProgress = true;
  trap.storesCommitted = false;
  trap.overwriteCredPath = credPath;
  trap.overwriteCjPath = claudeJson;
  trap.credPreexisted = true;
  trap.snapCredTmp = snap;
  trap.cjPreexisted = false; // claude.json 新建（不存在）→ rm（本就不存在·no-op）。

  const r = account.forwardAlignOrRollback(trap);
  assert.equal(r.action, 'rollback');
  assert.equal(r.rolledBack, true);
  assert.equal(
    JSON.parse(readFileSync(credPath, 'utf8')).claudeAiOauth.accessToken,
    'sk-ant-oat-OLDACCESS',
    '① rolled back to old',
  );
  assert.equal(trap.overwriteInProgress, false);
  // **CRITICAL（codex）**：trap 路径（信号触发·随后 process.exit）必清含 token 的快照——绝不残留。
  assert.equal(existsSync(snap), false, 'token-bearing snapshot removed on trap rollback path');
  assert.equal(trap.snapCredTmp, '', 'snapCredTmp cleared after cleanup');

  // fresh trap → noop。
  const fresh = account.newTrapState({
    regPath: join(dir, 'a.json'),
    keychain: kc.provider,
    user: 'u',
  });
  assert.equal(account.forwardAlignOrRollback(fresh).action, 'noop');
});

// ══ overwriteOfficialStores · 无 registry identity → identityDegraded 标志（codex HIGH#1·降级做响）═══════════
test('overwriteOfficialStores: no registry identity → identityDegraded=true; ② identity NOT switched', () => {
  const dir = mkTmp();
  const credPath = join(dir, '.credentials.json');
  const claudeJson = join(dir, '.claude.json');
  writeFileSync(credPath, JSON.stringify({ claudeAiOauth: JSON.parse(OLD_BLOB) }));
  writeFileSync(
    claudeJson,
    JSON.stringify({ oauthAccount: { emailAddress: 'old@x.com', subscriptionType: 'pro' } }),
  );
  const kc = fakeKeychain();
  const trap = account.newTrapState({
    regPath: join(dir, 'a.json'),
    keychain: kc.provider,
    user: 'u',
    snapParent: dir,
  });
  const r = account.overwriteOfficialStores({
    blob: NEW_BLOB, // subscriptionType=max。
    identityJson: '', // 无 registry identity → ② 降级。
    switchInEmail: 'new@x.com',
    credPath,
    claudeJsonPath: claudeJson,
    trap,
  });
  assert.equal(r.ok, true, 'token 已切（① ③）·exit 0 仍成功');
  assert.equal(
    r.identityDegraded,
    true,
    'no identity → degraded flag set (caller makes warning loud)',
  );
  // ① 凭证主存切到新号（认证按它走）。
  assert.equal(
    JSON.parse(readFileSync(credPath, 'utf8')).claudeAiOauth.accessToken,
    'sk-ant-oat-NEWACCESS',
  );
  // ② oauthAccount.email **未**切（仍旧号·只降级同步 subscriptionType）。
  const oa = JSON.parse(readFileSync(claudeJson, 'utf8')).oauthAccount;
  assert.equal(oa.emailAddress, 'old@x.com', '② identity display NOT switched (degraded)');
  assert.equal(oa.subscriptionType, 'max', '② subscriptionType synced (degrade path)');
  noTokenInAll(r.messages);
});

// ══ reconcileActiveFromStore · 从官方存储反向对账自愈 registry active（codex HIGH#2）════════════════════════
test('reconcileActiveFromStore: heals stale registry active from official store; no-op when consistent / non-pool', () => {
  const dir = mkTmp();
  const regPath = join(dir, 'accounts.json');
  const claudeJson = join(dir, '.claude.json');
  const reg = {
    schema: 'cc-master/accounts/v1',
    accounts: {
      'old@x.com': {
        vault: { kind: 'keychain', service: 'cc-master-oauth', account: 'old@x.com' },
        active: true,
      },
      'new@x.com': {
        vault: { kind: 'keychain', service: 'cc-master-oauth', account: 'new@x.com' },
        active: false,
      },
    },
  };
  writeFileSync(regPath, JSON.stringify(reg));
  // split-brain: registry active=old, 官方 ②=new（in pool·前一次前向对齐 setActive 失败的残留）。
  writeFileSync(claudeJson, JSON.stringify({ oauthAccount: { emailAddress: 'new@x.com' } }));
  const healed = account.reconcileActiveFromStore({ regPath, claudeJsonPath: claudeJson });
  assert.equal(healed, 'new@x.com', 'returns store-authoritative active');
  const after = JSON.parse(readFileSync(regPath, 'utf8'));
  assert.equal(after.accounts['new@x.com'].active, true, 'registry healed to match store');
  assert.equal(after.accounts['old@x.com'].active, false);

  // consistent（store==registry）→ no-op·返回 regActive。
  assert.equal(
    account.reconcileActiveFromStore({ regPath, claudeJsonPath: claudeJson }),
    'new@x.com',
  );

  // store email 不在号池 → 不强写·返回 registry 现状（不污染）。
  writeFileSync(claudeJson, JSON.stringify({ oauthAccount: { emailAddress: 'stranger@x.com' } }));
  assert.equal(
    account.reconcileActiveFromStore({ regPath, claudeJsonPath: claudeJson }),
    'new@x.com',
    'non-pool store email → keep registry active (no forced setActive)',
  );
});

// ══ codex CRITICAL#2 — 快照 unlink 失败不静默吞·往 messages 推醒目告警（残留可见）════════════════════════════
test('cleanupSnapshots (via forwardAlignOrRollback): unlink failure surfaces a visible warning, not silent', () => {
  const dir = mkTmp();
  const roDir = join(dir, 'ro');
  mkdirSync(roDir, { recursive: true });
  const snapFile = join(roDir, '.credsnap.tok'); // 含 token 的快照（测试假串）。
  writeFileSync(snapFile, JSON.stringify({ claudeAiOauth: JSON.parse(OLD_BLOB) }));
  chmodSync(roDir, 0o500); // 只读目录 → 删目录内文件需 dir 写权 → unlink 失败 EACCES。
  CHMOD_RESTORE.push(roDir);
  const kc = fakeKeychain();
  const trap = account.newTrapState({
    regPath: join(dir, 'a.json'),
    keychain: kc.provider,
    user: 'u',
  });
  // noop 分支（未提交·非覆写窗口）也调 cleanupSnapshots(trap, messages)——unlink 失败须告警。
  trap.snapCredTmp = snapFile;
  const r = account.forwardAlignOrRollback(trap);
  assert.equal(r.action, 'noop');
  assert.ok(
    r.messages.some((m) => m.includes('快照文件清理失败') && m.includes(snapFile)),
    'unlink failure surfaced as visible warning carrying the residual path',
  );
  // 文件确实残留（被告警·非静默吞——这正是要让残留可见的点）。
  assert.equal(existsSync(snapFile), true, 'residual file remains but is now visible/warned');
  noTokenInAll(r.messages);
});
