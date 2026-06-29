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

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { account } from '@ccm/engine';
import * as discover from '../discover.js';
import * as io from '../io.js';
import * as mutations from '../mutations.js';
import type { BoardArg, Ctx } from './_common.js';

const EXIT = io.EXIT;

// switch（无重启换号）专属退出码（超出 io.EXIT 的 0-5·见 switch-account.sh 头注释·router 透传 handler 原始 number）。
//   0 成功 / 1 vault·选号·refresh·覆写失败 / 2 用法·前置 / 3 全员逼顶（未切）/ 4 换号生效但 registry active 落盘失败 /
//   7 policy deny（覆写三存储前被 board.policy 机制硬闸拦下·零副作用）。
const SWITCH_EXIT = {
  OK: 0,
  FAIL: 1,
  USAGE: 2,
  EXHAUSTED: 3,
  ACTIVE_WRITE_FAILED: 4,
  POLICY_DENY: 7,
} as const;

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

// ════════════════════ switch（无重启换号·Phase 2b·最重最险）════════════════════════════════════════
//   覆写机器全局官方凭证三存储让运行中 claude 惰性重读接管新号——逐条保住安全闸（token-blind / policy 闸前移 /
//   refresh preflight / 切出抢救 / 三存储全或无 + trap / setActive 与快照解耦 / credstore 锁）。机制层在
//   @ccm/engine account/switch.ts；本 handler 是编排层（选号 + policy 闸 + 锁 + refresh + 退出码）。
//   **async**（唯一 async verb·await refreshBlob）——router 透传 Promise·bin await 落码。
export async function switchAccount(ctx: Ctx): Promise<number> {
  const env = ctx.env;
  // ── 0. 云后端自检（红线5·no-op·先于任何 token 读）─────────────────────────────────────────────────
  if (env.CLAUDE_CODE_USE_BEDROCK || env.CLAUDE_CODE_USE_VERTEX || env.CLAUDE_CODE_USE_FOUNDRY) {
    ctx.err(
      'switch: 云后端（Bedrock/Vertex/Foundry）无订阅 5h/7d 配额窗口、无可换的订阅 OAuth token —— 换号不适用，no-op 退出。',
    );
    return SWITCH_EXIT.OK;
  }

  const regPath = resolveRegistryPath(ctx);
  const home = resolveHome(env);
  const kc = makeKeychain(ctx);
  const dryRun = ctx.flags.dryRun;
  const now = (ctx.values.now as string) || undefined;
  const defaultVaultFile = resolveVaultFile(ctx);

  // ── 1. 选号（或 --email 覆写）──────────────────────────────────────────────────────────────────────
  const explicitEmail = (ctx.values.email as string) || (ctx.values.account as string) || '';
  let email = explicitEmail;
  if (!explicitEmail) {
    const reg = safeLoadRegistry(regPath);
    const sel = account.selectAccount(reg, now);
    for (const w of sel.warnings) ctx.err(`switch(select): ${w}`);
    if (sel.reason === 'NONE_ALL_EXHAUSTED') {
      ctx.err(
        'switch: 所有可切换备号都已逼顶 / 不可用（NONE_ALL_EXHAUSTED）——blocked_on:"user" 决策（等 reset 还是别的·用户拍板）。**未切换**。',
      );
      return SWITCH_EXIT.EXHAUSTED;
    }
    if (sel.reason !== 'SELECTED' || !sel.selected) {
      ctx.err(
        'switch: 选号未选出可切入号（无备号 / registry 不可用 / 单账号）——保持现状、未切换。先 ccm account add <email>，或 --email <email>。',
      );
      return SWITCH_EXIT.FAIL;
    }
    email = sel.selected;
    ctx.err(`switch: 自动选号 → 切入号 = ${email}（按切出快照 + reset 推算的最优切入号）。`);
  } else {
    ctx.err(`switch: 用户显式指定切入号 = ${email}（跳过自动选号）。`);
  }

  // ── 2. 解析切入号 vault 引用 + identity（全非密）──────────────────────────────────────────────────
  const sw = resolveSwitchRef(ctx, regPath, email, kc, defaultVaultFile);

  // ── 3. policy 闸（读任何 vault 之前·least-privilege·**dry-run 也生效**·codex MEDIUM：deny 板上 dry-run 也不许切）──
  //   deny → exit 7（绝不读 vault）。审计 board.log 仅真切路径写（dry-run 是无副作用预览·不写 board.log）。
  {
    const pol = evalSwitchPolicy(ctx);
    if (!pol.allow) {
      const denyTail = dryRun
        ? '（dry-run 也不例外：deny means 这个 session 不许切·绝不读 vault）'
        : '';
      if (pol.explicitDeny) {
        ctx.err(
          `switch: 机制层硬闸：board.policy.autonomous_account_switch=deny，**拒绝本次自主换号**${denyTail}——零**凭证**副作用（未读 vault、未 refresh、未覆写任何凭证存储·registry 原封不动；仅真切路径往 board.log 记一条 best-effort 审计）。`,
        );
        ctx.err(
          "  如需换号，须用户先 'ccm policy set --autonomous-account-switch=allow --user-authorized' 修改 board policy，再重试。",
        );
        if (!dryRun) {
          bestEffortDecisionLog(
            ctx,
            '机制层按 board.policy=deny 拦下一次自主换号（ccm account switch exit 7）',
          );
        }
      } else {
        ctx.err(
          `switch: 机制层硬闸：有明确目标板上下文（--board/$CC_MASTER_BOARD）却**读不到该板 policy**（缺板 / 歧义 / 坏 JSON）——保守拒绝本次自主换号${denyTail}——零**凭证**副作用（未读 vault、未 refresh、未覆写任何凭证存储·registry 原封不动；仅真切路径往 board.log 记一条 best-effort 审计）。`,
        );
        ctx.err(
          '  确认 --board/$CC_MASTER_BOARD 指向正确的 active board 再重试（多 active board 共享 home 时尤须带板上下文）。',
        );
        if (!dryRun) {
          bestEffortDecisionLog(
            ctx,
            '机制层因目标板 policy 读取失败/歧义保守拦下一次自主换号（ccm account switch exit 7）',
          );
        }
      }
      return SWITCH_EXIT.POLICY_DENY;
    }
  }

  // ── dry-run：打印计划（不读 vault·不 refresh·不覆写·不写 registry）──────────────────────────────────
  if (dryRun) {
    ctx.out('── ccm account switch DRY-RUN（不真 refresh / 不真覆写三存储 / 不真写 registry）──');
    ctx.out(
      `switch-in email : ${email}${explicitEmail ? ' (--email override)' : ' (auto-select)'}`,
    );
    ctx.out(`registry        : ${regPath}`);
    ctx.out(
      `vault           : ${sw.ref.kind === 'keychain' ? `keychain service=${sw.ref.service} account=${email}` : `file=${sw.ref.path} key=${email}`}`,
    );
    ctx.out(
      `identity        : ${sw.identityJson ? '(registry identity → ② oauthAccount 完整替换)' : '(无 identity → ② 降级只同步 subscriptionType)'}`,
    );
    ctx.out(
      'would refresh   : node https POST（refresh token 放 body·不进 argv）→ 新鲜 8h access token',
    );
    ctx.out(
      'would overwrite : ① ~/.claude/.credentials.json ② ~/.claude.json oauthAccount ③ keychain "Claude Code-credentials"/$USER（全或无·快照+回滚）',
    );
    ctx.out('would setActive : 覆写三存储成功后才翻 active（与切出快照解耦·P2-2）');
    ctx.out(
      'note            : 凭证全程脚本子进程 / vault / refresh body / 三存储写，绝不进 agent / registry / argv。',
    );
    if (ctx.flags.json) ctx.out(io.jsonOk({ email, dry_run: true, vault_kind: sw.ref.kind }));
    return SWITCH_EXIT.OK;
  }

  // ── 4. 读 vault blob（含 refresh token·只在本进程内·绝不回显）────────────────────────────────────────
  const vaultBlob = account.vaultRead(sw.ref, { keychain: kc });
  if (!vaultBlob) {
    ctx.err(`error: 无法从 vault 读取 ${email} 的 OAuth blob（${sw.ref.kind}）。`);
    ctx.err(
      `  录号（一次性人工·在该号已登录环境）: ccm account add ${email} → 完整 blob 存进 vault。`,
    );
    return SWITCH_EXIT.FAIL;
  }

  // ── 5. 主动 refresh（非变更性 preflight·失败不动任何存储）──────────────────────────────────────────
  let newBlob = '';
  let forceRefreshFallback = false;
  let refreshRotated = false;
  try {
    const r = await account.refreshBlob(vaultBlob, {
      url: env.REFRESH_TOKEN_URL,
      clientId: env.OAUTH_CLIENT_ID,
      allowLoopback: env.CCM_ALLOW_LOOPBACK_REFRESH === '1',
      timeoutMs: env.REFRESH_TIMEOUT_MS ? Number(env.REFRESH_TIMEOUT_MS) : undefined,
    });
    newBlob = r.blob;
    refreshRotated = r.rotated;
  } catch (e) {
    const code = (e as account.RefreshError).code;
    ctx.err((e as Error).message || 'refresh 失败');
    if (code === account.REFRESH_EXIT.NETWORK) {
      // rc=5 网络错 → force-refresh 兜底（覆写原 blob + expiresAt 临近过期·逼官方 CLI 自己 refresh·有 vault-stale 风险）。
      const ff = account.forceRefreshBlob(vaultBlob);
      if (!ff) {
        ctx.err(
          'error: force-refresh 兜底也失败（blob 处理出错）——未覆写任何存储、registry 原封不动。',
        );
        return SWITCH_EXIT.FAIL;
      }
      newBlob = ff;
      forceRefreshFallback = true;
      ctx.err(
        'switch: 主动 refresh 网络不通——退化到 force-refresh 兜底（覆写原 blob + expiresAt 临近过期·逼官方 CLI 自己 refresh）。⚠ vault-stale 风险：下次换回该号可能需先 ccm account refresh。',
      );
    } else {
      // rc=2/3/4/6 → 硬失败（refresh token 失效 / 残缺 / 未授权端点 / 输入错）——不覆写任何存储。
      ctx.err(
        'error: refresh 失败——**未覆写任何存储**、registry 原封不动（设计 step 6）。请 ccm account refresh 重录完整 blob 后重试。',
      );
      return SWITCH_EXIT.FAIL;
    }
  }

  // ── 6. 回写 cc-master vault（保 refresh token 新鲜·force-refresh 兜底下不回写）────────────────────────
  if (!forceRefreshFallback) {
    const w = account.vaultStore(newBlob, sw.ref, sw.ref.kind === 'file' ? sw.expires : null, {
      keychain: kc,
    });
    if (!w.ok) {
      if (refreshRotated) {
        // 轮转后回写失败 → 抢救 NEW_BLOB 到 0600 recovery 文件 + 硬失败（绝不丢轮转的唯一 token·防 brick）。
        const recovered = rescueRotatedBlob(home, email, newBlob);
        ctx.err(
          'error: refresh token 已被服务端**轮转**、但回写 cc-master vault 失败——新 refresh token 是唯一副本。',
        );
        if (recovered) {
          ctx.err(
            `  ✓ 已把轮转后的完整 blob 抢救到 0600 recovery 文件（绝不丢该 token）：${recovered}`,
          );
        } else {
          ctx.err(
            `  ✗ 连 recovery 文件也写不进——该号 vault 只剩已吊销旧 token：需重新登录 ${email}（Orca / claude login）后 ccm account refresh 重录。`,
          );
        }
        ctx.err(
          '  **未覆写任何官方存储、registry 原封不动**（不冒险继续到会丢弃 NEW_BLOB 的覆写路）。',
        );
        return SWITCH_EXIT.FAIL;
      }
      ctx.err(
        `switch: ⚠ vault 回写失败（refresh token 未轮转·旧 token 仍有效）——三存储仍会覆写（换号继续），但 vault 的 ${email} access token 未更新到最新（下次换回可能需 ccm account refresh）。`,
      );
    } else {
      ctx.err(`switch: 已回写 cc-master vault（${email}·refresh token 保新鲜）。`);
    }
  }

  // ── 7. credstore 换号锁 → 切出抢救 → 覆写三存储 → setActive → 快照（临界段·锁内·signal trap）──────────────
  //   锁键 = 机器全局 credstore（anchor 在 cc-master home·**非 CRED_PATH**——②③ 是机器全局不随 CRED_PATH·SWGAP）。
  const lockTarget = env.CCM_CREDSTORE_LOCK || path.join(home, 'credstore');
  let lockHandle: account.LockHandle | null = null;
  try {
    lockHandle = account.acquireFileLock(lockTarget, { livePid: process.pid });
  } catch (_e) {
    lockHandle = null;
  }
  if (!lockHandle || !lockHandle.owner) {
    ctx.err(
      `error: 无法取得换号锁（${lockTarget}.lock·另有 switch 在跑 / 锁超时）——**拒绝无锁覆写官方存储**（防并发交错三存储损坏），未换号、registry 原封不动。`,
    );
    return SWITCH_EXIT.FAIL;
  }

  const user = env.USER || os.userInfo().username || '';
  const credService = env.KEYCHAIN_CRED_SERVICE || account.KEYCHAIN_CRED_SERVICE;
  const credPath = env.CRED_PATH || path.join(os.homedir(), '.claude', '.credentials.json');
  const claudeJson = env.CLAUDE_JSON_PATH || path.join(os.homedir(), '.claude.json');
  // 含 token 的 ①② 快照落 <home> 下一个 mkdtemp 造的**唯一 0700 私有目录**（snapParent=home·**绝不共享 /tmp 根**·
  //   mkdtemp 原子创建抗 symlink/竞态劫持·codex CRITICAL#1）；任何退出路径必清（清理失败会 surface 告警·codex CRITICAL#2）。
  const trap = account.newTrapState({ regPath, keychain: kc, user, credService, snapParent: home });

  // signal trap（SIGINT/SIGTERM·中断恢复·镜像 bash INT/TERM trap）：双向恢复后 process.exit。
  //   注：Node 单线程·临界段全 sync（锁→覆写→setActive 间无 await）·信号不能撕裂 sync JS——trap 主要兜「两 sync 操作
  //   之间被 kill」边缘 + 保持与 bash 同形态。process.exit 仅此信号驱动的紧急恢复例外（窄域·finally 即摘除监听）。
  let trapFired = false;
  const onSignal = (sig: 'SIGINT' | 'SIGTERM'): void => {
    if (trapFired) return;
    trapFired = true;
    const res = account.forwardAlignOrRollback(trap);
    for (const m of res.messages) ctx.err(m);
    try {
      account.releaseFileLock(lockHandle);
    } catch (_e) {
      /* best-effort */
    }
    process.exit(sig === 'SIGINT' ? 130 : 143);
  };
  const sigint = (): void => onSignal('SIGINT');
  const sigterm = (): void => onSignal('SIGTERM');
  process.on('SIGINT', sigint);
  process.on('SIGTERM', sigterm);

  let activeWriteFailed = false;
  let identityDegraded = false;
  try {
    // 切出号 = 翻 active 之前的当前 active（钉一次·供切出抢救 + 切出快照共用）。
    //   **从官方 ② 存储反向对账 registry active（codex HIGH#2 自愈）**：若上次换号前向对齐 setActive 失败留下
    //   「存储=新号、registry=旧号」split-brain，这里读 ②oauthAccount.email（非密·权威）以存储为准修正 registry——
    //   让那条「下次从存储反向修正」承诺真兑现，并返回真·当前 active 当切出号。
    const switchOut = account.reconcileActiveFromStore({ regPath, claudeJsonPath: claudeJson });

    // 2.5) 切出 token 抢救（覆写官方存储之前·锁内·身份 guard·best-effort·Finding #72）。
    if (switchOut && switchOut !== email) {
      const so = resolvePlainRef(regPath, switchOut, defaultVaultFile);
      const rescue = account.rescueSwitchoutToken({
        switchOutEmail: switchOut,
        switchInEmail: email,
        switchOutRef: so.ref,
        keychain: kc,
        user,
        credService,
        credentialsJsonPath: credPath,
        claudeJsonPath: claudeJson,
        expires: so.expires,
      });
      if (rescue.rescued) {
        ctx.err(
          `rescue: 已把官方存储最新 blob 回写切出号（${switchOut}）vault——补 vault↔官方存储反向新鲜（Finding #72）。`,
        );
      } else {
        ctx.err(`rescue: 跳过切出 token 抢救（${rescue.reason}·best-effort·非致命·切入照常）。`);
      }
    }

    // 3) 覆写官方三存储（先非权威后权威·全或无·trap 武装）。
    const ow = account.overwriteOfficialStores({
      blob: newBlob,
      identityJson: sw.identityJson,
      switchInEmail: email,
      credPath,
      claudeJsonPath: claudeJson,
      trap,
    });
    for (const m of ow.messages) ctx.err(m);
    if (!ow.ok) {
      ctx.err(
        'error: 覆写官方凭证存储失败（见上 stores: 标到哪步）——换号未完成。registry 不翻 active（避免「registry 标新号、存储仍旧号」损坏态）。',
      );
      return SWITCH_EXIT.FAIL;
    }
    identityDegraded = ow.identityDegraded; // ② 身份未完整切换（无 identity / ② 缺损）→ 末尾做响降级警告（codex HIGH#1）。

    // 4) setActive（关键态·覆写成功后立刻可靠落盘·与切出快照解耦·P2-2）。
    const sa = setActiveInRegistry(regPath, email);
    for (const m of sa.messages) ctx.err(m);
    activeWriteFailed = !sa.ok;
    trap.activeAligned = true; // setActive 跑完 → trap 不再前向 setActive（幂等）。
    trap.commitWrappedBlob = ''; // 收尾·清 trap 前向补写 keychain 的 token 物料（token 清理）。

    // 5) 切出快照（best-effort·后置观测·active 已先翻·绝不阻断/绝不再留 split-brain 窗口）。
    recordSwitchOutBestEffort(switchOut, email, ctx);
  } finally {
    process.removeListener('SIGINT', sigint);
    process.removeListener('SIGTERM', sigterm);
    try {
      account.releaseFileLock(lockHandle);
    } catch (_e) {
      /* best-effort */
    }
  }

  // ── 8. 最终消息 + 退出码（active 落盘成功 → 0；失败 → 4·不谎报干净成功）──────────────────────────────
  if (activeWriteFailed) {
    ctx.err(
      `⚠ 无重启换号已生效但 registry 未对齐：官方共享凭证三存储已覆写为 ${email}（claude 会接管新号），但 registry active 落盘失败、仍与现实脱节——**这不是干净成功**：ccm account list 对账、修好 accounts.json 后重跑换号让 active 归位（三存储已是新号·重跑幂等）。`,
    );
    if (forceRefreshFallback)
      ctx.err('  （本次走 force-refresh 兜底·有 vault-stale 风险，见上。）');
    return SWITCH_EXIT.ACTIVE_WRITE_FAILED;
  }
  ctx.out(
    `✓ 无重启换号完成：官方共享凭证三存储已覆写为 ${email}——运行中 claude 在 token 临近过期时惰性 refresh、重读被覆写的存储 → 新号接管（无需重启进程）。`,
  );
  if (forceRefreshFallback) ctx.err('  （本次走 force-refresh 兜底·有 vault-stale 风险，见上。）');
  // **身份降级警告做响（codex HIGH#1）**：token 已切（① 凭证主存 + ③ keychain 是新号·认证按它走），但 ② 显示层
  //   身份未完整切换（无 registry identity → 只同步 subscriptionType / 或 ② 文件缺损）——登录显示可能仍是上一号。
  if (identityDegraded) {
    ctx.err(
      `⚠ 身份显示层未完整切换：token 已切到 ${email}（凭证主存已是新号 token·认证生效），但 ②~/.claude.json oauthAccount 未用 registry identity 完整替换（该号 registry 缺 identity / ② 文件缺损）——登录**显示**可能仍是上一号（不影响认证）。建议跑 \`ccm account add ${email}\` 在该号已登录环境补 identity，下次换号即可真切身份显示。`,
    );
  }
  if (ctx.flags.json) {
    ctx.out(
      io.jsonOk({
        email,
        switched: true,
        force_refresh_fallback: forceRefreshFallback,
        identity_degraded: identityDegraded,
      }),
    );
  }
  return SWITCH_EXIT.OK;
}

// ── switch helpers ──────────────────────────────────────────────────────────────────────────────────
// resolveSwitchRef — 切入号 vault 引用 + token_expires_at + 非密 identity（显式 flag > registry > 默认）。
interface SwitchRef {
  ref: account.VaultRef;
  expires: string;
  identityJson: string;
}
function resolveSwitchRef(
  ctx: Ctx,
  regPath: string,
  email: string,
  kc: account.KeychainProvider,
  defaultVaultFile: string,
): SwitchRef {
  const reg = safeLoadRegistry(regPath);
  const entry = (reg.accounts && reg.accounts[email]) || {};
  const ev = (entry.vault as Record<string, unknown>) || {};
  const explicitKind = ctx.values['vault-kind'] as string | undefined;
  const kind: 'keychain' | 'file' =
    explicitKind === 'keychain' || explicitKind === 'file'
      ? explicitKind
      : ev.kind === 'file'
        ? 'file'
        : ev.kind === 'keychain'
          ? 'keychain'
          : account.defaultVaultKind(kc);
  let ref: account.VaultRef;
  if (kind === 'keychain') {
    const service =
      (ctx.values['keychain-service'] as string) ||
      (typeof ev.service === 'string' ? ev.service : '') ||
      account.DEFAULT_KEYCHAIN_SERVICE;
    ref = { kind: 'keychain', service, account: email };
  } else {
    const vpath =
      (ctx.values['vault-file'] as string) ||
      (typeof ev.path === 'string' ? ev.path : '') ||
      defaultVaultFile;
    ref = { kind: 'file', path: vpath, key: email };
  }
  const expires =
    typeof entry.token_expires_at === 'string' && account.ISO_UTC_RE.test(entry.token_expires_at)
      ? entry.token_expires_at
      : account.defaultExpiresIso();
  const id = entry.identity;
  const identityJson =
    id && typeof id === 'object' && !Array.isArray(id) && Object.keys(id).length > 0
      ? JSON.stringify(id)
      : '';
  return { ref, expires, identityJson };
}

// resolvePlainRef — 切出号 vault 引用 + expires（registry > 默认·无显式 flag 覆写·切出号 vault 形态可与切入号不同）。
function resolvePlainRef(
  regPath: string,
  email: string,
  defaultVaultFile: string,
): { ref: account.VaultRef; expires: string | null } {
  const reg = safeLoadRegistry(regPath);
  const entry = (reg.accounts && reg.accounts[email]) || {};
  const ev = (entry.vault as Record<string, unknown>) || {};
  let ref: account.VaultRef;
  if (ev.kind === 'file') {
    const vpath = typeof ev.path === 'string' && ev.path ? ev.path : defaultVaultFile;
    ref = { kind: 'file', path: vpath, key: email };
  } else {
    const service =
      typeof ev.service === 'string' && ev.service ? ev.service : account.DEFAULT_KEYCHAIN_SERVICE;
    ref = { kind: 'keychain', service, account: email };
  }
  const expires =
    typeof entry.token_expires_at === 'string' && account.ISO_UTC_RE.test(entry.token_expires_at)
      ? entry.token_expires_at
      : null;
  return { ref, expires };
}

// setActiveInRegistry — 翻 active 到切入号（独立可靠落盘·与切出快照解耦·P2-2）。ok=false → ACTIVE_WRITE_FAILED（exit 4）。
function setActiveInRegistry(regPath: string, email: string): { ok: boolean; messages: string[] } {
  const messages: string[] = [];
  try {
    let notInReg = false;
    account.mutateRegistry(regPath, (reg) => {
      if (reg.accounts && reg.accounts[email]) {
        account.setActive(reg, email);
      } else {
        notInReg = true; // 切入号不在 registry → 不强写（setActive 会抛）·标 misalign。
      }
    });
    if (notInReg) {
      messages.push(
        `active: 切入号 ${email} 不在 registry——未置 active（token 已读到·换号已生效；建议 ccm account add ${email} 让 registry 对齐）。`,
      );
      return { ok: false, messages };
    }
    messages.push(`active: 已置 ${email} 为 active（其余号 active=false）。`);
    return { ok: true, messages };
  } catch (_e) {
    messages.push(
      'active: setActive 落盘失败（accounts.json 不可写 / 坏 JSON / 锁超时）——换号已生效（三存储已是切入号），但 registry active 未翻成功、与现实脱节·需手动对账。',
    );
    return { ok: false, messages };
  }
}

// recordSwitchOutBestEffort — 切出快照（best-effort·后置观测）。ccm 引擎不带 cc-usage 配额探测（那是
//   orchestrating-to-completion 的带外脚本）——本阶段无有效 used_pct 源 → 降级跳过（recordSwitchOut 会因 used_pct
//   非 0-100 整数被拒写）。换号核心（三存储 + active）已先完成、绝不受影响（P2-2 解耦）。
function recordSwitchOutBestEffort(switchOut: string, switchIn: string, ctx: Ctx): void {
  if (!switchOut || switchOut === switchIn) return;
  ctx.err(
    `switch: 切出快照（${switchOut}）降级跳过——ccm 引擎无 cc-usage 配额源（used_pct 无有效值）。换号不受影响（active 已先翻·P2-2 解耦）。`,
  );
}

// rescueRotatedBlob — 轮转后回写失败时把 NEW_BLOB 抢救到 0600 recovery 文件（token-blind·直写 fs·绝不 echo）。
function rescueRotatedBlob(home: string, email: string, blob: string): string | null {
  try {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    const file = path.join(home, `rotated-blob-recovery.${email}.${process.pid}.json`);
    fs.writeFileSync(file, blob, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
    return file;
  } catch (_e) {
    return null;
  }
}

// evalSwitchPolicy — in-process 读 board.policy.autonomous_account_switch（switch IS ccm·进程边界塌缩·比 shell-out
//   ccm policy show 更可靠）。fail-open 二分（ADR-016 §2.3）：(a) 无板上下文且 discovery 失败 → allow；(b) 有明确板
//   上下文（--board/$CC_MASTER_BOARD）却读不到/歧义/坏 → 保守 deny。读到 deny → 显式 deny；读到 allow/缺 → allow（缺=effective allow）。
function evalSwitchPolicy(ctx: Ctx): { allow: boolean; explicitDeny: boolean } {
  const boardFlag = ctx.values.board as string | undefined;
  const hasBoardCtx = !!(boardFlag || ctx.env.CC_MASTER_BOARD);
  let board: Record<string, unknown> | null = null;
  try {
    const resolved = discover.resolveBoard({
      boardFlag,
      sid: ctx.sid,
      homeFlag: ctx.values.home as string,
      goalSubstr: ctx.values.goal as string,
      env: ctx.env,
    });
    board = resolved.board as Record<string, unknown>;
  } catch (_e) {
    // discovery 失败 / 歧义 / 缺板 → (a) 无板上下文 fail-open allow；(b) 有板上下文保守 deny（绝不静默放行·codex P1）。
    return { allow: !hasBoardCtx, explicitDeny: false };
  }
  const policy = board && board.policy;
  const val =
    policy && typeof policy === 'object' && !Array.isArray(policy)
      ? (policy as Record<string, unknown>).autonomous_account_switch
      : undefined;
  if (val === 'deny') return { allow: false, explicitDeny: true };
  return { allow: true, explicitDeny: false }; // allow / 缺（effective allow·向后兼容）。
}

// bestEffortDecisionLog — policy deny 时往目标板 board.log 记一条 decision（ADR-016 §2.2 审计留痕·best-effort·失败静默吞）。
function bestEffortDecisionLog(ctx: Ctx, summary: string): void {
  try {
    const resolved = discover.resolveBoard({
      boardFlag: ctx.values.board as string,
      sid: ctx.sid,
      homeFlag: ctx.values.home as string,
      goalSubstr: ctx.values.goal as string,
      env: ctx.env,
    });
    io.withBoardLock(resolved.boardPath, () => {
      let board: unknown;
      try {
        board = JSON.parse(fs.readFileSync(resolved.boardPath, 'utf8'));
      } catch (_e) {
        return;
      }
      const next = mutations.appendLog(board as BoardArg, { summary, kind: 'decision' });
      io.writeFileAtomicSync(resolved.boardPath, `${JSON.stringify(next, null, 2)}\n`);
    });
  } catch (_e) {
    /* best-effort·审计留痕失败不影响 deny 拦截本身 */
  }
}
