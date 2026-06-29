// handlers/account.ts — account noun handler（add / delete / refresh / list）·Phase 2a。
//
// 号池 CRUD：把 @ccm/engine 的 account 安全层（vault 读/写/删/探 + registry upsert/remove + 身份提取）接成
//   `ccm account add|delete|refresh|list` 四个 verb。**不是 board 操作**——不走 discover/runWrite/runRead，直接
//   调 account 引擎 + 自管 registry 路径（从 --registry / CC_MASTER_HOME 解析·env 注入可测）。**不含 switch（Phase 2b）。**
//
// ───────────────────────── token-blindness（HARD·原样保住）─────────────────────────
// blob 经引擎安全层流动（vaultStore 写 / captureCurrentLoginBlob 读 / vaultProbe 只回布尔）——handler **绝不**把
//   任何 blob 值写进 ctx.out/ctx.err（agent 读的输出流）、绝不进 board.log、绝不进 registry。registry 写只传非密
//   email/vault 引用/时间戳/subscription_type/identity（引擎 upsertAccount 自带 token-leak 断言兜底）。
//
// ── 退出码语义（逐条保留 account-*.sh）────────────────────────────────────────────────────────────────
//   add/refresh：0 成功 / 0 手动恢复（vault 已有有效 blob → 标 switchable）/ 1 捕获失败·身份不匹配·vault 写失败
//                / 3 vault 写成但 registry upsert 失败（token 安全·非干净成功）。（2 usage 由 router 校验。）
//   delete：0 删净 / 1 vault 删真错·registry 删失败。（2 usage 由 router。）
//   list：fail-safe——坏 JSON / 缺文件一律降级空池·exit 0。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib + @ccm/engine。武装闸豁免：纯 handler（无 hook 入口）。

import * as os from 'node:os';
import * as path from 'node:path';
import { account } from '@ccm/engine';
import * as io from '../io.js';
import type { Ctx } from './_common.js';

const EXIT = io.EXIT;

// ── 路径 / 形态解析（全从 ctx.env 注入·可测）────────────────────────────────────────────────────────
function resolveHome(env: Record<string, string | undefined>): string {
  return env.CC_MASTER_HOME || path.join(os.homedir(), '.claude', 'cc-master');
}
function resolveRegistryPath(ctx: Ctx): string {
  const explicit = ctx.values.registry as string | undefined;
  return explicit || path.join(resolveHome(ctx.env), 'accounts.json');
}
function resolveVaultFile(ctx: Ctx): string {
  const explicit = ctx.values['vault-file'] as string | undefined;
  return explicit || path.join(resolveHome(ctx.env), 'accounts.env');
}
function resolveKeychainService(ctx: Ctx): string {
  return (ctx.values['keychain-service'] as string) || account.DEFAULT_KEYCHAIN_SERVICE;
}
function makeKeychain(ctx: Ctx): account.KeychainProvider {
  // CCM_SECURITY_BIN env 覆写（测试经 stub 验真 spawnSync/argv 路径·与 bash 测试同模式）。
  return account.macKeychainProvider({ bin: ctx.env.CCM_SECURITY_BIN });
}
// vault 形态：CLI 显式 --vault-kind > 跨平台默认（mac+keychain → keychain·否则 file floor）。
function resolveVaultKind(ctx: Ctx, kc: account.KeychainProvider): 'keychain' | 'file' {
  const explicit = ctx.values['vault-kind'] as string | undefined;
  if (explicit === 'keychain' || explicit === 'file') return explicit;
  return account.defaultVaultKind(kc);
}
function vaultRefFor(email: string, kind: 'keychain' | 'file', ctx: Ctx): account.VaultRef {
  if (kind === 'keychain') {
    return { kind: 'keychain', service: resolveKeychainService(ctx), account: email };
  }
  return { kind: 'file', path: resolveVaultFile(ctx), key: email };
}

// ── add / refresh（refresh = add upsert·幂等）─────────────────────────────────────────────────────────
//   直读 keychain「Claude Code-credentials」(account=$USER) 的当前登录 blob → 身份 guard（--email==当前登录）→
//   存 vault → upsert registry（active:true·当前登录号·token_refreshed_at=now）。身份 guard 失败时旁路：vault 已
//   有有效 blob → 纯恢复标记 switchable:true + exit 0（不依赖登录·无 mislabel 风险）。
function addOrRefresh(ctx: Ctx): number {
  const email = ctx.positionals[0];
  if (!email) {
    ctx.err('error: 缺 email（用法：ccm account add <email>）');
    return EXIT.USAGE;
  }
  const kc = makeKeychain(ctx);
  const vaultKind = resolveVaultKind(ctx, kc);
  const ref = vaultRefFor(email, vaultKind, ctx);
  const regPath = resolveRegistryPath(ctx);
  const expires = (ctx.values.expires as string) || account.defaultExpiresIso();

  // 身份提取（非密·当前登录身份）。CLAUDE_JSON_PATH env 覆写（测试注入）。
  const claudeJson = ctx.env.CLAUDE_JSON_PATH || path.join(os.homedir(), '.claude.json');
  const identity = account.extractIdentity(claudeJson);
  const currentEmail = account.emailOfIdentity(identity);

  // 身份 guard：--email 必须 == 当前登录 email（防把 B 的 blob 错标成 A）。失败 → 旁路恢复 / 退 1。
  if (currentEmail !== email) {
    // 旁路：vault 自身已有有效 blob（手动恢复完成·不依赖登录）→ 标 switchable:true + exit 0。
    if (account.vaultHasValidBlob(ref, { keychain: kc })) {
      const reg2 = upsertRegistry(regPath, email, ref, expires, null, null, true, false);
      if (reg2) {
        ctx.err(
          `  ✓ vault 已有 ${email} 的有效 blob（含非空 refreshToken）→ 已标 switchable:true（可切·手动恢复闭环）。`,
        );
        return EXIT.OK;
      }
      ctx.err(
        `error: 检测到 vault 有有效 blob，但 registry 登记失败——恢复未完成。修好 accounts.json 后重跑。`,
      );
      return EXIT.ERROR;
    }
    if (!currentEmail) {
      ctx.err(
        `error: 无法从 ${claudeJson} 读出当前登录身份 email（未登录 / 文件缺）——请先登录 ${email} 再重跑。`,
      );
    } else {
      ctx.err(
        `error: 身份不匹配——当前登录是 ${currentEmail}、不是 ${email}。keychain 存的是当前登录号凭证；`,
      );
      ctx.err(
        `       按 --email ${email} 录入会把 ${currentEmail} 的 blob 错标成 ${email}。请先登录 ${email} 再重跑。`,
      );
    }
    return EXIT.ERROR;
  }

  // 捕获当前登录完整 blob（主路径 keychain·非 mac fallback credentials.json）。blob 只在本进程内·绝不回显。
  const blob = account.captureCurrentLoginBlob({
    keychain: kc,
    credService: ctx.env.KEYCHAIN_CRED_SERVICE,
    user: ctx.env.USER,
    credentialsJsonPath: ctx.env.CREDENTIALS_JSON,
  });
  if (!blob) {
    ctx.err(
      `✗ 未取到含非空 refreshToken 的完整 blob（keychain 无 item / refreshToken 空 / 非 mac credentials.json 残缺）。`,
    );
    ctx.err(
      `  无重启换号死依赖 refreshToken——拒绝存残缺 blob。请用 Orca / claude login 走完整登录后重跑。`,
    );
    return EXIT.ERROR;
  }

  // 存 vault（blob 含 refresh token·绝不回显）。
  const w = account.vaultStore(blob, ref, vaultKind === 'file' ? expires : null, { keychain: kc });
  if (!w.ok) {
    ctx.err(`error: vault 写入失败——${w.error || '未知'}（blob 未存）。`);
    return EXIT.ERROR;
  }
  // 抽非密 subscription_type（绝不带 token）；blob 用完即弃（让 GC 回收·绝不进 registry/log）。
  const subType = account.subscriptionTypeOf(blob);

  // upsert registry（全非密·active:true 当前登录号·token_refreshed_at=now·switchable:true 覆写旧 false）。
  const ok = upsertRegistry(regPath, email, ref, expires, subType, identity, true, true);
  if (!ok) {
    // vault 已写好（凭证安全），但 registry upsert 失败 → 非干净成功（exit 3）。
    ctx.err(`error: vault 已写好（凭证安全·已进 vault），但 accounts.json registry 写入失败——`);
    ctx.err(
      `  录号未完成：该号对 list/select 不可见。修好 accounts.json 后重跑 ccm account add ${email} 补登记。`,
    );
    return EXIT.VALIDATION;
  }

  ctx.out(`✓ 已录入 ${email}（vault=${vaultKind}·token 含 refresh·blob <redacted>·从不回显）。`);
  if (ctx.flags.json) {
    ctx.out(
      io.jsonOk({
        email,
        vault_kind: vaultKind,
        active: true,
        switchable: true,
        token_expires_at: expires,
        subscription_type: subType,
      }),
    );
  }
  return EXIT.OK;
}

// upsertRegistry — 锁内 load→upsert(+setActive)→save。成功 true / 抛错（坏 JSON·锁超时·token-leak 拒写）false。
//   全非密入参（绝不传 blob/token）；引擎 upsertAccount 对 identity 子树跑值扫描·token 误入会抛错拦下。
function upsertRegistry(
  regPath: string,
  email: string,
  ref: account.VaultRef,
  expires: string,
  subType: string | null,
  identity: Record<string, unknown> | null,
  switchable: boolean,
  isActive: boolean,
): boolean {
  try {
    account.mutateRegistry(regPath, (reg) => {
      const prev = (reg.accounts && reg.accounts[email]) || {};
      const now = account.nowIso();
      const fields: account.AccountFields = {
        vault: ref,
        token_added_at: prev.token_added_at || now, // 已存在则保留首次录入时刻（refresh 不改）。
        token_refreshed_at: now,
        token_expires_at: expires,
        switchable,
      };
      if (subType) fields.subscription_type = subType;
      if (identity && Object.keys(identity).length > 0) fields.identity = identity;
      account.upsertAccount(reg, email, fields); // 绝不传 token·自带 token-leak 断言。
      if (isActive) account.setActive(reg, email); // 当前登录号 active:true·其余 false（唯一性）。
    });
    return true;
  } catch (_e) {
    return false;
  }
}

export function add(ctx: Ctx): number {
  return addOrRefresh(ctx);
}
export function refresh(ctx: Ctx): number {
  // refresh = add upsert 幂等（重捕获当前登录 blob·重存·更新 token_refreshed_at）。
  return addOrRefresh(ctx);
}

// ── delete ────────────────────────────────────────────────────────────────────────────────────────
//   先删 vault（token 痕迹·token-blind 按前缀/项）·再删 registry entry（非密）。vault 真删失败 → 不继续删 registry。
export function deleteAccount(ctx: Ctx): number {
  const email = ctx.positionals[0];
  if (!email) {
    ctx.err('error: 缺 email（用法：ccm account delete <email>）');
    return EXIT.USAGE;
  }
  // 破坏性·非 TTY 须 --yes（与 task rm / baseline reset 同模式）。
  if (!ctx.isTTY && !ctx.flags.yes && !ctx.values.yes) {
    ctx.err('error: 删号是破坏性操作·非 TTY 须 --yes 确认。');
    return EXIT.USAGE;
  }
  const kc = makeKeychain(ctx);
  const regPath = resolveRegistryPath(ctx);

  // 从 registry entry 推断 vault 形态（非密指针）。CLI 显式 > registry 推断 > 默认。
  const reg = safeLoadRegistry(regPath);
  const entry = (reg.accounts && reg.accounts[email]) || {};
  const entryVault = (entry.vault as Record<string, unknown>) || {};
  const explicitKind = ctx.values['vault-kind'] as string | undefined;
  const kind: 'keychain' | 'file' =
    explicitKind === 'keychain' || explicitKind === 'file'
      ? explicitKind
      : entryVault.kind === 'file'
        ? 'file'
        : entryVault.kind === 'keychain'
          ? 'keychain'
          : account.defaultVaultKind(kc);
  let ref: account.VaultRef;
  if (kind === 'keychain') {
    const service =
      (ctx.values['keychain-service'] as string) ||
      (typeof entryVault.service === 'string' ? entryVault.service : '') ||
      account.DEFAULT_KEYCHAIN_SERVICE;
    ref = { kind: 'keychain', service, account: email };
  } else {
    const vpath =
      (ctx.values['vault-file'] as string) ||
      (typeof entryVault.path === 'string' ? entryVault.path : '') ||
      resolveVaultFile(ctx);
    ref = { kind: 'file', path: vpath, key: email };
  }

  // 删 vault（token-blind）。'deleted'/'absent' → 继续删 registry；'error'/'unavailable' → 真错·不继续。
  const vres = account.vaultDelete(ref, { keychain: kc });
  if (vres === 'error') {
    ctx.err('✗ vault 删除失败——未继续删 registry（避免 registry 指向已没的 vault 却仍留 token）。');
    return EXIT.ERROR;
  }
  if (vres === 'unavailable') {
    ctx.err(
      '✗ keychain 不可用（非 mac？）——该号若是 file 形态请 --vault-kind file。未删 registry。',
    );
    return EXIT.ERROR;
  }
  if (vres === 'absent') {
    ctx.err(`· vault 里没找到 ${email} 的 token（可能已删 / 从没录）——继续删 registry entry。`);
  }

  // 删 registry entry（非密·removeAccount·entry 不存在 = no-op）。
  try {
    account.mutateRegistry(regPath, (r) => {
      account.removeAccount(r, email);
    });
  } catch (_e) {
    ctx.err(
      '✗ registry entry 删除失败（坏 JSON？）——vault token 已删，但 registry 仍残留 entry。请人工检查 accounts.json。',
    );
    return EXIT.ERROR;
  }
  ctx.out(`✓ 删号完成：${email} 已从号池（registry + vault）删干净。`);
  if (ctx.flags.json) ctx.out(io.jsonOk({ email, deleted: true, vault: vres }));
  return EXIT.OK;
}

// ── list（fail-safe·token-blind 探测·绝不取 token 值）─────────────────────────────────────────────────
export function list(ctx: Ctx): number {
  const regPath = resolveRegistryPath(ctx);
  const reg = safeLoadRegistry(regPath); // 坏 JSON / 缺文件 → 空池（fail-safe·exit 0）。
  const accounts = reg.accounts || {};
  const emails = Object.keys(accounts);
  const now = account.nowIso();
  const probeKeychain = !!ctx.values['probe-keychain'];

  interface Row {
    email: string;
    vault_kind: string;
    expires: string;
    active: boolean;
    switchable: boolean;
    token_state: string; // ok / EXPIRED / no-token / ?
    last_switch_out: string;
    locator: string;
  }
  const rows: Row[] = [];
  for (const email of emails) {
    const e = accounts[email] || {};
    const v = (e.vault as Record<string, unknown>) || {};
    const kind = typeof v.kind === 'string' ? v.kind : '?';
    const locator =
      kind === 'keychain'
        ? typeof v.service === 'string'
          ? v.service
          : ''
        : typeof v.path === 'string'
          ? v.path
          : '';
    const expires = typeof e.token_expires_at === 'string' ? e.token_expires_at : '';
    const active = e.active === true;
    const switchable = e.switchable !== false; // 缺省/null 视作可切；仅显式 false = 不可切。
    // token_state（token-blind·绝不取值）：
    //   switchable:false → no-token；file → vaultProbe（只回布尔·blob 不外漏）→ 按 expires 判 ok/EXPIRED/?；
    //   keychain → 按 token_expires_at 严格 ISO 字典序判（可选 probe-keychain 探活·不带 -w）。
    let tokenState = '?';
    if (!switchable) {
      tokenState = 'no-token';
    } else if (kind === 'file') {
      const present = account.vaultProbe({ kind: 'file', path: locator, key: email });
      if (!present) tokenState = 'no-token';
      else if (!expires || !account.ISO_UTC_RE.test(expires)) tokenState = '?';
      else tokenState = expires < now ? 'EXPIRED' : 'ok';
    } else if (kind === 'keychain') {
      if (probeKeychain) {
        const present = account.vaultProbe(
          { kind: 'keychain', service: locator, account: email },
          { keychain: makeKeychain(ctx) },
        );
        if (!present) tokenState = 'no-token';
      }
      if (tokenState !== 'no-token' && expires && account.ISO_UTC_RE.test(expires)) {
        tokenState = expires < now ? 'EXPIRED' : 'ok';
      }
    }
    const lso =
      e.last_switch_out && typeof (e.last_switch_out as Record<string, unknown>).at === 'string'
        ? ((e.last_switch_out as Record<string, unknown>).at as string)
        : '-';
    rows.push({
      email,
      vault_kind: kind,
      expires: expires || '-',
      active,
      switchable,
      token_state: tokenState,
      last_switch_out: lso,
      locator,
    });
  }

  if (ctx.flags.json) {
    ctx.out(io.jsonOk({ registry: regPath, count: rows.length, accounts: rows }));
    return EXIT.OK;
  }
  ctx.out('── cc-master 号池（accounts.json） ──');
  ctx.out(`registry : ${regPath}`);
  if (rows.length === 0) {
    ctx.out('号池为空（0 个号）。用 ccm account add <email> 录第一个备号。');
    return EXIT.OK;
  }
  ctx.out(`共 ${rows.length} 个号：`);
  ctx.out(
    `  ${pad('EMAIL', 26)} ${pad('VAULT', 9)} ${pad('EXPIRES', 22)} ${pad('ACTIVE', 7)} ${pad('SWITCHABLE', 11)} ${pad('TOKEN', 9)} ${pad('LAST-SWITCH-OUT', 22)} VAULT-LOCATOR`,
  );
  for (const r of rows) {
    const sw = r.switchable ? 'yes' : 'no(补录)';
    ctx.out(
      `  ${pad(r.email, 26)} ${pad(r.vault_kind, 9)} ${pad(r.expires, 22)} ${pad(r.active ? 'yes' : 'no', 7)} ${pad(sw, 11)} ${pad(r.token_state, 9)} ${pad(r.last_switch_out, 22)} ${r.locator}`,
    );
  }
  ctx.out('（TOKEN 列只示存在性/过期：ok / EXPIRED / no-token / ?。绝不取 token 值。）');
  return EXIT.OK;
}

// safeLoadRegistry — fail-safe：坏 JSON / 缺文件 → 空池（绝不崩）。
function safeLoadRegistry(regPath: string): account.Registry {
  try {
    return account.loadRegistry(regPath);
  } catch (_e) {
    return account.emptyRegistry();
  }
}

function pad(s: string, n: number): string {
  const str = String(s);
  return str.length >= n ? str : str + ' '.repeat(n - str.length);
}
