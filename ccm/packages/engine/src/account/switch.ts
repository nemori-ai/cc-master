// account/switch.ts — 无重启换号机制层（覆写官方共享凭证三存储·全或无 + 双向 trap 恢复）·@ccm/engine·Phase 2b。
//
// 源：cc-master 插件 skills/account-management/scripts/switch-account.sh（1700 行·历经 codex ~27 个安全坑）。本文件
//   是它**最重最险**那一段的 TS 移植——逐条保住每个安全闸：① token-blind 全程；② 覆写官方三存储**全或无**（先非
//   权威 ① credentials.json → ② ~/.claude.json → 后权威 ③ keychain，写前快照 ①②·任一步失败回滚到旧号·split-brain
//   绝不留）；③ 双向中断恢复（覆写窗口内未提交 → 回滚 ①②；最终存储已提交 → **前向对齐**而非回滚已提交的 ①，补写
//   keychain ③ + setActive·codex round#17/#18/#19）；④ 切出 token 抢救（Finding #72·补 vault↔官方存储反向新鲜）；
//   ⑤ force-refresh 兜底（端点不通时覆写原 blob + 临近过期逼 claude 自己 refresh）。
//
// **本文件不含**：policy 闸 / 选号 / refresh https / credstore 锁取放 / 退出码——那些是 handler（apps/cli）的编排层
//   职责（policy 闸要读 board·选号复用 select.ts·refresh 复用 refresh.ts·锁复用 registry.acquireFileLock）。本文件
//   只移植「覆写三存储 + 回滚 + 中断恢复 + 切出抢救」这套机械动作的安全机制。
//
// ───────────────────────── token-blindness 铁律（HARD·原样保住）─────────────────────────
// token（OAuth blob，含 refresh token）只经三条信道：① 本 node 进程内字符串变量（ccm 本就是干活的 node 进程·不可避免）；
//   ② 写官方文件 ①②时经 fs.writeFileSync（token 随文件落盘·绝不读值进日志/argv/echo）；③ 写 keychain ③ 时经
//   KeychainProvider.write 的 `security -w "$blob"` argv（唯一审定 argv 例外·避 stdin 128 截断丢 refreshToken）。
//   快照 / 回滚用 fs.copyFileSync（token 随文件 cp·绝不读进变量）。**绝不**写 stdout/stderr/log/registry 明文。
//   本模块所有返回的 messages[] 均非密（只述「写了哪步 / 回滚到哪」·绝不含 blob 值）。
//
// 红线1（ADR-006）：node/JS only，纯 node stdlib（fs/os/path），keychain spawn 经注入的 KeychainProvider（vault.ts）。
// IIFE 守：本模块 import node:fs/os/path——webview 永不调 switch（覆写机器凭证），tsdown banner 占位足够。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveCredentialsPath } from '../paths.js';
import type { AccountEntry, Registry } from './registry.js';
import { loadRegistry, mutateRegistry, setActive } from './registry.js';
import {
  emailOfIdentity,
  extractIdentity,
  KEYCHAIN_CRED_SERVICE,
  type KeychainProvider,
  macKeychainProvider,
  type VaultRef,
  vaultStore,
} from './vault.js';

// ── force-refresh 兜底：把 blob 的 expiresAt 改成 now+60s（逼运行中 claude 自己 refresh·端点不通时的安全网）──────
//   纯函数。bad JSON → null。**不碰 token 值**（只改 expiresAt·refresh token 原样保留）。
export function forceRefreshBlob(blob: string): string | null {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(blob) as Record<string, unknown>;
  } catch (_e) {
    return null;
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  o.expiresAt = Date.now() + 60 * 1000;
  return JSON.stringify(o);
}

// ── 官方存储当前 blob 读取（切出 token 抢救源·Finding #72）──────────────────────────────────────────────
//   覆写官方存储**之前**，存储里 account=$USER 的 blob 仍是切出号被运行中 claude 自主 refresh 更新到最新的那份
//   （含已轮转的新 refreshToken）。读出来才能回写切出号 vault·补「官方存储 → vault」反向流。
//   形状纪律（codex P1）：官方 keychain「Claude Code-credentials」与 credentials.json 都存**包裹形**
//     `{"claudeAiOauth":{...}}` → 解包 `.claudeAiOauth` 成裸对象再回写（cc-master vault 存裸对象·否则污染形状）。
//   源优先级：mac 主路径 = keychain（完整 blob 含 refreshToken）；credentials.json 在 mac 上 refreshToken 可能空 →
//     仅当 keychain 读不到有效 blob 时 fallback（非 mac 唯一源）。校验：解包后须含非空 accessToken/refreshToken/expiresAt。
//   token-blind：blob 含 token·只经返回值回进程内调用方（rescue）·绝不外漏到 log/registry。
export interface ReadOfficialBlobOpts {
  keychain?: KeychainProvider;
  credService?: string; // 默认 KEYCHAIN_CRED_SERVICE（'Claude Code-credentials'）。
  user?: string; // keychain account=$USER。
  credentialsJsonPath?: string; // 非 mac fallback 源（CRED_PATH 可 env 覆写·测试注入）。
}
function unwrapOfficial(s: string | null | undefined): Record<string, unknown> | null {
  if (!s) return null;
  let o: unknown;
  try {
    o = JSON.parse(s);
  } catch (_e) {
    return null;
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const wrapped = (o as Record<string, unknown>).claudeAiOauth;
  const b = wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped) ? wrapped : o;
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
}
function validOfficial(b: Record<string, unknown> | null): boolean {
  if (!b) return false;
  const at = b.accessToken;
  const rt = b.refreshToken;
  const exp = b.expiresAt;
  return (
    typeof at === 'string' &&
    !!at &&
    typeof rt === 'string' &&
    !!rt &&
    (typeof exp === 'number' || (typeof exp === 'string' && !!exp))
  );
}
export function readOfficialBlob(opts?: ReadOfficialBlobOpts): string | null {
  const kc = (opts && opts.keychain) || macKeychainProvider();
  const credService = (opts && opts.credService) || KEYCHAIN_CRED_SERVICE;
  const user = (opts && opts.user) || process.env.USER || '';
  let blob: Record<string, unknown> | null = null;
  if (kc.isAvailable() && user) {
    blob = unwrapOfficial(kc.read(credService, user)); // 主路径：keychain（mac·完整 blob）。
  }
  if (!validOfficial(blob)) {
    // fallback：credentials.json（非 mac 唯一源·mac 上 RT 可能空 → 由 validOfficial 把关）。
    const cjPath = (opts && opts.credentialsJsonPath) || resolveCredentialsPath();
    try {
      blob = unwrapOfficial(fs.readFileSync(cjPath, 'utf8'));
    } catch (_e) {
      blob = null;
    }
  }
  if (!validOfficial(blob)) return null;
  return JSON.stringify(blob); // 单行裸 blob（含 token·只回进程内调用方）。
}

// ── 切出 token 抢救（Finding #72·best-effort·绝不阻断换号）──────────────────────────────────────────────
//   病根：cc-master vault 是官方存储的一次性快照；运行中 claude 自主 refresh 轮转 refreshToken、写回**官方存储**却
//   **绝不**回流 vault → 切出号 vault 停在切入那刻旧值、其 refreshToken 早被服务端吊销 → 下次切回 refresh 失败、号池
//   里用过的号逐个变死号。修：覆写官方存储**之前**（account=$USER 仍是切出号最新 blob）读出·token-blind 回写**切出号** vault。
//   纪律：① 时机——必在 overwriteOfficialStores 之前调；② 身份 guard——官方存储 ~/.claude.json oauthAccount.emailAddress
//   须 == 切出号（防把别号 token 写进切出号 vault·污染号池）；③ best-effort——任一步失败仅跳过、切入照常；④ token-blind。
export interface RescueSwitchoutArgs {
  switchOutEmail: string; // 切出号（= 翻 active 之前的当前 active）。
  switchInEmail: string; // 切入号（== 切出号 / 空 → 无可抢救·跳过）。
  switchOutRef: VaultRef; // 切出号 vault 引用（可与切入号 vault 形态不同）。
  keychain: KeychainProvider;
  user: string;
  credService?: string;
  credentialsJsonPath?: string;
  claudeJsonPath: string; // 身份 guard 源（~/.claude.json）。
  expires?: string | null; // 切出号 registry token_expires_at（file vault 保 _EXPIRES sidecar·codex P3）。
}
export interface RescueResult {
  rescued: boolean;
  skipped: boolean;
  reason?: string; // 'no-switchout' | 'no-valid-official-blob' | 'identity-mismatch' | 'writeback-failed'
  identityEmail?: string | null;
}
export function rescueSwitchoutToken(args: RescueSwitchoutArgs): RescueResult {
  const { switchOutEmail, switchInEmail } = args;
  // 无切出号（首次换入 / 检测不到）或切入==切出（切到自己）→ 无可抢救·跳过。
  if (!switchOutEmail || switchOutEmail === switchInEmail) {
    return { rescued: false, skipped: true, reason: 'no-switchout' };
  }
  // 1) 读官方存储当前完整 blob（裸·已解包·已校验非空 refreshToken）。token 进局部·绝不打印。
  const soBlob = readOfficialBlob({
    keychain: args.keychain,
    credService: args.credService,
    user: args.user,
    credentialsJsonPath: args.credentialsJsonPath,
  });
  if (!soBlob) {
    return { rescued: false, skipped: true, reason: 'no-valid-official-blob' };
  }
  // 2) 身份 guard：官方存储 oauthAccount.emailAddress 须 == 切出号（非密 email）。不匹配 / 读不到 → 保守跳过。
  const idEmail = emailOfIdentity(extractIdentity(args.claudeJsonPath));
  if (!idEmail || idEmail !== switchOutEmail) {
    return { rescued: false, skipped: true, reason: 'identity-mismatch', identityEmail: idEmail };
  }
  // 3) token-blind 回写切出号 vault（vaultStore·目标 = 切出号上下文）。失败仅返回·绝不阻断换号。
  const w = vaultStore(soBlob, args.switchOutRef, args.expires ?? null, {
    keychain: args.keychain,
  });
  if (!w.ok) {
    return { rescued: false, skipped: true, reason: 'writeback-failed' };
  }
  return { rescued: true, skipped: false };
}

// ── reconcileActiveFromStore：从官方 ② 存储**反向对账** registry active（HIGH#2 自愈·token-blind·只读非密 email）─────────
//   病根（codex HIGH#2）：forwardAlignOrRollback 的 setActive 失败后留「官方存储=新号、registry active=旧号」split-brain，
//   而旧 detectCurrentActive **只读 registry** → 那条「下次从存储反向修正」的承诺永不兑现。修：每次 switch 启动时读
//   ②~/.claude.json 的 oauthAccount.emailAddress（**非密** identity·非 token），它是「当前真·登录号」的权威——若它在号池
//   里且 != registry 标记的 active → **以存储为准修正 registry active**（self-heal），让前向对齐 setActive 失败可自愈。
//   返回有效 active email（修正后 / registry 现状 / ''）。token-blind：只读非密 email·绝不碰 token。
export function reconcileActiveFromStore(args: {
  regPath: string;
  claudeJsonPath: string;
}): string {
  let reg: Registry | null = null;
  try {
    reg = loadRegistry(args.regPath);
  } catch (_e) {
    reg = null;
  }
  let regActive = '';
  if (reg && reg.accounts) {
    for (const [email, e] of Object.entries(reg.accounts)) {
      if (e && (e as AccountEntry).active === true) {
        regActive = email;
        break;
      }
    }
  }
  const storeEmail = emailOfIdentity(extractIdentity(args.claudeJsonPath));
  // 存储 email 在号池里且与 registry active 不一致 → 存储是权威 → 修正 registry（self-heal·best-effort）。
  if (storeEmail && reg && reg.accounts && reg.accounts[storeEmail] && storeEmail !== regActive) {
    try {
      mutateRegistry(args.regPath, (r) => {
        if (r.accounts && r.accounts[storeEmail]) setActive(r, storeEmail);
      });
      return storeEmail;
    } catch (_e) {
      /* reconcile best-effort → 退回 regActive */
    }
  }
  return regActive;
}

// ── 中断/退出恢复状态机（trap 的 bash 标志位 → TS 可变状态对象）─────────────────────────────────────────────
//   handler 构造一个 SwitchTrapState（带静态 deps），传给 overwriteOfficialStores（它推进 dynamic 标志），并在
//   SIGINT/SIGTERM 信号处理器里调 forwardAlignOrRollback(trap) 做恢复。这把 bash 的 OVERWRITE_IN_PROGRESS /
//   STORES_COMMITTED / ACTIVE_ALIGNED / SNAP_*_TMP / COMMIT_* 标志位收口成一个可单测的状态对象。
export interface SwitchTrapState {
  // 静态 deps（handler 构造时设·forwardAlignOrRollback 前向恢复要用）。
  regPath: string;
  keychain: KeychainProvider;
  user: string;
  credService: string; // KEYCHAIN_CRED_SERVICE。
  // 含 token 的 ①② 快照目录的**父目录**（handler 设 <home>·测试默认 os.tmpdir）。mkSnapTemp 在它下面用 mkdtempSync
  //   **原子造一个每次换号唯一的 0700 私有子目录**（随机后缀·existing-path 无法被 symlink 劫持·codex CRITICAL#1）。
  snapParent: string;
  // 实际唯一快照目录（mkSnapTemp 懒建·首次造快照时由 mkdtempSync 填入；空 = 尚未造）。cleanup 后留路径串供「已移除」断言。
  snapDir: string;
  // dynamic 标志（overwriteOfficialStores / forwardAlignOrRollback 推进）。
  overwriteInProgress: boolean; // ①② 覆写窗口内、最终存储未提交（中断 → 回滚 ①②）。
  storesCommitted: boolean; // 最终存储（mac ③ / Linux ②）已提交（中断 → 前向对齐·不回滚已提交的 ①）。
  activeAligned: boolean; // registry active 已对齐（幂等·trap 不再重复前向 setActive）。
  overwriteCredPath: string; // ① 路径（trap 回滚用）。
  overwriteCjPath: string; // ② 路径。
  snapCredTmp: string; // ① 0600 快照临时文件（含 token·文件 cp）。
  snapCjTmp: string; // ② 快照临时文件（非密身份）。
  credPreexisted: boolean; // ① 换号前已存在（回滚→snapshot 恢复）/ 新建（回滚→rm）。
  cjPreexisted: boolean;
  commitSwitchinEmail: string; // 待对齐成 active 的切入号（前向恢复用）。
  commitWrappedBlob: string; // 待写 keychain ③ 的 wrapped blob（含 token·前向补写 keychain 用·token-blind argv）。
}
export function newTrapState(deps: {
  regPath: string;
  keychain: KeychainProvider;
  user: string;
  credService?: string;
  snapParent?: string;
}): SwitchTrapState {
  return {
    regPath: deps.regPath,
    keychain: deps.keychain,
    user: deps.user,
    credService: deps.credService || KEYCHAIN_CRED_SERVICE,
    // 父目录默认 os.tmpdir()（handler 覆写成 <home>）；唯一 0700 子目录由 mkSnapTemp 懒用 mkdtempSync 原子造。
    snapParent: deps.snapParent || os.tmpdir(),
    snapDir: '',
    overwriteInProgress: false,
    storesCommitted: false,
    activeAligned: false,
    overwriteCredPath: '',
    overwriteCjPath: '',
    snapCredTmp: '',
    snapCjTmp: '',
    credPreexisted: false,
    cjPreexisted: false,
    commitSwitchinEmail: '',
    commitWrappedBlob: '',
  };
}

// ── 原子写 JSON（tmp + rename·0600·绝不整文件重建——调用方只改目标子对象保留其它键）──────────────────────────
function atomicWriteJson(filePath: string, obj: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, filePath);
    fs.chmodSync(filePath, 0o600);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch (_) {
      /* best-effort */
    }
    throw e;
  }
}

// 清快照临时文件（best-effort 不抛·**任何退出路径〔含信号/trap〕都必清·codex CRITICAL：含 token 的快照绝不残留**）。
//   清完两文件再 rmdir 唯一私有快照目录（空才成功）。幂等（重复调无副作用）。
//   **codex CRITICAL#2（残留可见）**：unlink 真失败（非 ENOENT——如权限/占用）会**静默残留含 token 快照** → 往 messages
//   推一条醒目告警（残留路径 + 手动删指引），让残留可见、用户能清。仍 best-effort 不抛（不为清理失败 wedge 换号）。
function cleanupSnapshots(trap: SwitchTrapState, messages?: string[]): void {
  for (const p of [trap.snapCredTmp, trap.snapCjTmp]) {
    if (p) {
      try {
        fs.unlinkSync(p);
      } catch (e) {
        // ENOENT = 本就不存在（= 已清·成功）；其它 = 真失败 → 含 token 快照可能残留·告警。
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && messages) {
          messages.push(
            `⚠ 含 token 的快照文件清理失败、可能残留于 ${p}——请手动删除（rm -f "${p}"）。`,
          );
        }
      }
    }
  }
  trap.snapCredTmp = '';
  trap.snapCjTmp = '';
  if (trap.snapDir) {
    try {
      fs.rmdirSync(trap.snapDir); // 仅当空目录才成功（残留文件 / 不存在 → 留着 / 吞·告警已由上面 unlink 失败发出）。
    } catch (_) {
      /* best-effort·非空 / 不存在都吞（残留已在上面告警） */
    }
  }
}

// ── rollbackOfficialStores12：把 ①② 回滚到换号前状态（原子·token 随文件走·绝不读值）─────────────────────────────
//   全或无含新建文件（codex P2）：文件原本存在（*Preexisted）→ 从 snapshot cp 回原位（写 tmp + rename）；
//   文件原本不存在（换号新建的）→ rm 删回「无此文件」状态。回 true = 全回滚成功（或本就无可回滚）；false = 至少一步
//   失败（可能 split-brain·caller 据此强告警）。原本存在但无快照（换号前 cp 失败）→ 标失败（不静默放行）。
export interface RollbackResult {
  ok: boolean;
  messages: string[];
}
export function rollbackOfficialStores12(
  credPath: string,
  claudeJsonPath: string,
  trap: SwitchTrapState,
): RollbackResult {
  const messages: string[] = [];
  let ok = true;
  // ① credentials.json（含 token·文件 cp/rm·token-blind）。
  if (trap.credPreexisted && trap.snapCredTmp && fs.existsSync(trap.snapCredTmp)) {
    const tmp = `${credPath}.ccm-rb.${process.pid}`;
    try {
      fs.copyFileSync(trap.snapCredTmp, tmp);
      fs.renameSync(tmp, credPath);
      fs.chmodSync(credPath, 0o600);
    } catch (_e) {
      try {
        fs.unlinkSync(tmp);
      } catch (_) {
        /* best-effort */
      }
      ok = false;
    }
  } else if (!trap.credPreexisted) {
    try {
      fs.rmSync(credPath, { force: true });
      messages.push(
        'stores: 回滚删除换号新建的 ① credentials.json（换号前无此文件·回到无此文件状态·避免 split-brain）。',
      );
    } catch (_e) {
      ok = false;
    }
  } else {
    // 原本存在但无快照（换号前快照失败）——① 已被覆写成新号、无副本可恢复 = split-brain。标失败（不静默放行·codex §7 P2-c）。
    messages.push(
      'stores: ① credentials.json 换号前已存在但无快照可恢复——无法回滚·**可能 split-brain**（① 已是新号 token）·需手动对账！',
    );
    ok = false;
  }
  // ② ~/.claude.json（非密身份·统一文件 cp/rm）。
  if (trap.cjPreexisted && trap.snapCjTmp && fs.existsSync(trap.snapCjTmp)) {
    const tmp = `${claudeJsonPath}.ccm-rb.${process.pid}`;
    try {
      fs.copyFileSync(trap.snapCjTmp, tmp);
      fs.renameSync(tmp, claudeJsonPath);
    } catch (_e) {
      try {
        fs.unlinkSync(tmp);
      } catch (_) {
        /* best-effort */
      }
      ok = false;
    }
  } else if (!trap.cjPreexisted) {
    try {
      fs.rmSync(claudeJsonPath, { force: true });
      messages.push(
        'stores: 回滚删除换号新建的 ② ~/.claude.json（换号前无此文件·回到无此文件状态·避免 split-brain）。',
      );
    } catch (_e) {
      ok = false;
    }
  } else {
    messages.push(
      'stores: ② ~/.claude.json 换号前已存在但无快照可恢复——无法回滚·**可能 split-brain**（② oauthAccount 已是新号）·需手动对账！',
    );
    ok = false;
  }
  return { ok, messages };
}

// ── overwriteOfficialStores：覆写官方共享凭证三存储（$USER 视角·原子·token-blind·全或无 + 进入覆写窗口武装 trap）──
//   ① ~/.claude/.credentials.json 的 .claudeAiOauth（凭证主存·tmp+rename·0600）。
//   ② ~/.claude.json 的 oauthAccount（有 registry identity → 完整替换真切身份·保其它 75+ 键；无 → 降级只同步
//      subscriptionType·非身份切换路·写失败非致命）。
//   ③ macOS keychain「Claude Code-credentials」account=$USER（包裹形 {"claudeAiOauth":{...}}·security -w argv 避 128 截断）。
//      Linux 无 keychain → 跳过（只写 ①②·② 即最终存储）。
//   全或无：写 ①② 前先快照 ①②（文件 cp·必需快照 cp 失败 → 中止换号·三存储原封）。② 身份写失败（① 已写新号）→ 回滚 ①；
//      ③ keychain 失败 → 回滚 ①②；任一步成功提交即推进 trap.storesCommitted（武装前向对齐）。
export interface OverwriteArgs {
  blob: string; // 切入号新 blob（裸·单行 JSON·含 token）。
  identityJson: string; // 切入号 registry identity JSON（非密）或 ''（→ ② 降级）。
  switchInEmail: string; // 切入号（trap 前向对齐 setActive 用）。
  credPath: string;
  claudeJsonPath: string;
  trap: SwitchTrapState; // 推进 dynamic 标志（覆写窗口 / 提交 / 快照路径 / commit blob）。
}
export interface OverwriteResult {
  ok: boolean; // true = 三存储已提交（或 Linux 仅 ①②）。
  committed: boolean;
  rolledBack: boolean;
  splitBrainRisk: boolean; // 回滚自身也失败（部分官方凭证态可能已在新号上·需手动对账）。
  identityDegraded: boolean; // ② 身份**未完整切换**（无 registry identity 走降级 / ② 文件缺/损坏跳过）——token 已切·显示层身份可能滞后（codex HIGH#1·caller 须把降级警告做响）。
  messages: string[]; // 非密诊断（绝不含 blob 值）。
}
export function overwriteOfficialStores(args: OverwriteArgs): OverwriteResult {
  const { blob, identityJson, switchInEmail, credPath, claudeJsonPath, trap } = args;
  const messages: string[] = [];
  // 默认「身份未完整切换」（degraded）；仅当 ② 走「identity 完整替换」成功时翻成 false（codex HIGH#1）。
  let identityDegraded = true;

  // ── 快照 ①②（写之前·全或无前提·token-blind 文件 cp·仅文件存在时做）─────────────────────────────────────
  trap.snapCredTmp = '';
  trap.snapCjTmp = '';
  trap.credPreexisted = false;
  trap.cjPreexisted = false;
  if (fs.existsSync(credPath)) {
    trap.credPreexisted = true;
    const snap = mkSnapTemp(trap, 'credsnap');
    try {
      fs.copyFileSync(credPath, snap);
      fs.chmodSync(snap, 0o600);
      trap.snapCredTmp = snap;
    } catch (_e) {
      try {
        fs.unlinkSync(snap);
      } catch (_) {
        /* best-effort */
      }
      messages.push(
        'stores: 快照 ① credentials.json 失败——**中止换号**（无快照则后续失败无法回滚·会 split-brain）：未覆写任何存储、registry 原封不动、可重试。',
      );
      cleanupSnapshots(trap, messages);
      trap.snapCredTmp = '';
      trap.snapCjTmp = '';
      return {
        ok: false,
        committed: false,
        rolledBack: false,
        splitBrainRisk: false,
        identityDegraded: false,
        messages,
      };
    }
  }
  if (fs.existsSync(claudeJsonPath)) {
    trap.cjPreexisted = true;
    const snap = mkSnapTemp(trap, 'cjsnap');
    try {
      fs.copyFileSync(claudeJsonPath, snap);
      fs.chmodSync(snap, 0o600);
      trap.snapCjTmp = snap;
    } catch (_e) {
      try {
        fs.unlinkSync(snap);
      } catch (_) {
        /* best-effort */
      }
      messages.push(
        'stores: 快照 ② ~/.claude.json 失败——**中止换号**（无快照则后续失败无法回滚·会 split-brain）：未覆写任何存储、registry 原封不动、可重试。',
      );
      cleanupSnapshots(trap, messages);
      trap.snapCredTmp = '';
      trap.snapCjTmp = '';
      return {
        ok: false,
        committed: false,
        rolledBack: false,
        splitBrainRisk: false,
        identityDegraded: false,
        messages,
      };
    }
  }

  // 解析 blob / identity（非密 identity 经入参·token blob 经入参·都在进程内）。
  let blobObj: unknown;
  try {
    blobObj = JSON.parse(blob);
  } catch (_e) {
    cleanupSnapshots(trap, messages);
    trap.snapCredTmp = '';
    trap.snapCjTmp = '';
    messages.push('stores: blob 非法 JSON——未覆写任何存储。');
    return {
      ok: false,
      committed: false,
      rolledBack: false,
      splitBrainRisk: false,
      identityDegraded: false,
      messages,
    };
  }
  let identity: Record<string, unknown> | null = null;
  if (identityJson) {
    try {
      const parsed = JSON.parse(identityJson);
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        Object.keys(parsed).length > 0
      )
        identity = parsed as Record<string, unknown>;
    } catch (_e) {
      identity = null;
    }
  }

  // 进入覆写窗口（中断 → trap 回滚 ①②）。
  trap.overwriteInProgress = true;
  trap.overwriteCredPath = credPath;
  trap.overwriteCjPath = claudeJsonPath;

  // ① credentials.json：读现有 → 只把 .claudeAiOauth 换成新 blob → 保留其它顶层键 → 原子写回。
  try {
    let cred: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        cred = parsed as Record<string, unknown>;
    } catch (_e) {
      cred = {};
    }
    cred.claudeAiOauth = blobObj;
    atomicWriteJson(credPath, cred);
    messages.push('stores: ① credentials.json .claudeAiOauth 已覆写（原子·0600）。');
  } catch (e) {
    // ① 写失败（atomicWrite 在 rename 前抛·② 未写·① 未落新号）→ 无需回滚·仅清快照。
    trap.overwriteInProgress = false;
    cleanupSnapshots(trap, messages);
    trap.snapCredTmp = '';
    trap.snapCjTmp = '';
    messages.push(
      `stores: ① credentials.json 写失败（${codeOf(e)}）——未完成换号（凭证主存未更新）。`,
    );
    return {
      ok: false,
      committed: false,
      rolledBack: false,
      splitBrainRisk: false,
      identityDegraded: false,
      messages,
    };
  }

  // ② ~/.claude.json oauthAccount：有 identity → 完整替换（真切身份·写失败 → 回滚 ①·避免 split-identity）；
  //    无 identity → 降级只同步 subscriptionType（非身份切换路·写失败非致命）；文件缺/损坏 → 跳过（不整文件重写）。
  if (fs.existsSync(claudeJsonPath)) {
    let cj: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        cj = parsed as Record<string, unknown>;
    } catch (_e) {
      cj = null;
    }
    if (cj) {
      if (identity) {
        try {
          cj.oauthAccount = identity;
          atomicWriteJson(claudeJsonPath, cj);
          identityDegraded = false; // 唯一「身份完整切换成功」路径。
          messages.push(
            'stores: ② ~/.claude.json oauthAccount 已用 registry identity 完整替换（真切身份·其它键保留·原子）。',
          );
        } catch (e2) {
          // 身份切换路真写失败（① 已写新号）→ 回滚 ① 到旧号·避免 split-identity（三存储全留旧号·可重试）。
          const rb = rollbackOfficialStores12(credPath, claudeJsonPath, trap);
          for (const m of rb.messages) messages.push(m);
          trap.overwriteInProgress = false;
          cleanupSnapshots(trap, messages);
          trap.snapCredTmp = '';
          trap.snapCjTmp = '';
          if (rb.ok) {
            messages.push(
              `stores: ② 身份写失败（${codeOf(e2)}）→ 已回滚 ①，三存储全留旧号，换号未发生，可重试（避免 split-identity）。`,
            );
          } else {
            messages.push(
              'stores: ② 身份写失败、且 ① 回滚失败——可能 split-identity（① 已是新号 token·② 仍旧号）·需手动对账！',
            );
          }
          return {
            ok: false,
            committed: false,
            rolledBack: rb.ok,
            splitBrainRisk: !rb.ok,
            identityDegraded: false,
            messages,
          };
        }
      } else {
        // 无 identity → 降级（非身份切换路·写失败非致命）。
        try {
          const oa =
            cj.oauthAccount &&
            typeof cj.oauthAccount === 'object' &&
            !Array.isArray(cj.oauthAccount)
              ? (cj.oauthAccount as Record<string, unknown>)
              : {};
          const sub = (blobObj as Record<string, unknown>).subscriptionType;
          if (typeof sub === 'string' && sub && 'subscriptionType' in oa) oa.subscriptionType = sub;
          cj.oauthAccount = oa;
          atomicWriteJson(claudeJsonPath, cj);
          messages.push(
            'stores: ② ~/.claude.json 无 registry identity → 降级只同步 subscriptionType（登录显示可能仍是上一号·建议 --add 补 identity）。',
          );
        } catch (e) {
          messages.push(
            `stores: ② ~/.claude.json 写失败（非致命·身份显示层·非身份切换路）：${codeOf(e)}`,
          );
        }
      }
    } else {
      messages.push('stores: ② ~/.claude.json 非对象/损坏——跳过（不整文件重写·绝不丢配置）。');
    }
  } else {
    messages.push(
      'stores: ② ~/.claude.json 不存在——跳过（不新建·身份由 credentials.json token 主导）。',
    );
  }

  // ③ keychain（mac）/ Linux 跳过。
  if (trap.keychain.isAvailable()) {
    const wrapped = `{"claudeAiOauth":${blob}}`; // blob 是合法单行 JSON → claude 官方包裹格式。
    // 在 security 调用之前就切 post-commit 档（codex round#18·消除「keychain 已提交但 flag 未设」的中断盲窗）。
    trap.storesCommitted = true;
    trap.commitSwitchinEmail = switchInEmail;
    trap.commitWrappedBlob = wrapped; // 供 trap 前向补写 keychain（idempotent·token-blind argv）。
    const okKc = trap.keychain.write(
      trap.credService,
      trap.user,
      `cc-master OAuth: ${trap.user}`,
      wrapped,
    );
    if (okKc) {
      trap.overwriteInProgress = false; // keychain 提交成功·三存储全新号·关回滚分支（trap 后续只前向对齐）。
      messages.push(
        `stores: ③ keychain "Claude Code-credentials" account=${trap.user} 已覆写（argv -w·完整 blob·避 128 截断）。`,
      );
    } else {
      // ③ 显式失败——确知 keychain 仍旧号（没提交）→ 撤回 post-commit·回滚 ①② 到旧号（全或无）。
      trap.storesCommitted = false;
      trap.commitSwitchinEmail = '';
      trap.commitWrappedBlob = '';
      const rb = rollbackOfficialStores12(credPath, claudeJsonPath, trap);
      for (const m of rb.messages) messages.push(m);
      trap.overwriteInProgress = false;
      cleanupSnapshots(trap, messages);
      trap.snapCredTmp = '';
      trap.snapCjTmp = '';
      if (rb.ok) {
        messages.push('stores: ③ keychain 失败 → 已回滚 ①②，三存储全留旧号，换号未发生，可重试。');
      } else {
        messages.push(
          'stores: ③ keychain 失败、且 ①② 回滚失败——可能 split-brain（部分官方凭证态已在新号上）·需手动对账！',
        );
      }
      return {
        ok: false,
        committed: false,
        rolledBack: rb.ok,
        splitBrainRisk: !rb.ok,
        identityDegraded: false,
        messages,
      };
    }
  } else {
    // Linux 无 keychain → ② 即最终存储·①② 已写新号·换号已落地。post-commit 切档（先武装前向·再关回滚）。
    trap.storesCommitted = true;
    trap.commitSwitchinEmail = switchInEmail;
    trap.overwriteInProgress = false;
    messages.push(
      'stores: ③ 无 security（非 mac）——跳过 keychain，只覆写了 ①② 两个文件（Linux 正常路径）。',
    );
  }

  cleanupSnapshots(trap, messages);
  return {
    ok: true,
    committed: true,
    rolledBack: false,
    splitBrainRisk: false,
    identityDegraded,
    messages,
  };
}

// ── forwardAlignOrRollback：on_exit_or_interrupt 的恢复逻辑（双向·按提交阶段选前向对齐 vs 回滚）──────────────────
//   阶段 B——最终存储已提交、active 未对齐（storesCommitted && !activeAligned && commitSwitchinEmail）：① 已是新号·
//     回滚它本身也是可被再中断的 mutation·且 keychain 若已提交回不去 → **前向对齐**：补写 keychain ③（idempotent·消除
//     keychain-lag split-brain）+ setActive（registry 追上存储）。**绝不**回滚已提交的 ①。清 overwriteInProgress（codex
//     re-§7 P1·防第二次 trap 误回滚 ①②）。setActive 失败 / 切入号不在 registry → regAligned=false（可自愈·非永久 split-brain）。
//   阶段 A——覆写窗口内、存储未提交（overwriteInProgress && overwriteCredPath）：回滚 ①② 到旧号（安全·确定性）。
//   handler 的信号处理器调它后再 release 锁 + 清快照 + exit。幂等（再跑一次·标志已清·无副作用）。
export interface TrapActionResult {
  action: 'forward-align' | 'rollback' | 'noop';
  regAligned?: boolean; // 前向对齐时 setActive 是否成功（false = registry 暂留旧号·可自愈）。
  rolledBack?: boolean; // 回滚是否全成功。
  messages: string[];
}
export function forwardAlignOrRollback(trap: SwitchTrapState): TrapActionResult {
  const messages: string[] = [];
  if (trap.storesCommitted && !trap.activeAligned && trap.commitSwitchinEmail) {
    // 阶段 B·前向对齐。① 补写 keychain ③（idempotent·确保 keychain=新号）。
    if (trap.commitWrappedBlob && trap.keychain.isAvailable()) {
      try {
        trap.keychain.write(
          trap.credService,
          trap.user,
          `cc-master OAuth: ${trap.user}`,
          trap.commitWrappedBlob,
        );
      } catch (_e) {
        /* best-effort·trap 路径不抛 */
      }
    }
    // ② best-effort setActive（让 registry 追上存储）。切入号不在 registry → 显式 throw → regAligned=false（RC-P3·不谎报已对齐）。
    let regAligned = false;
    try {
      mutateRegistry(trap.regPath, (reg) => {
        if (!reg.accounts || !reg.accounts[trap.commitSwitchinEmail]) {
          throw new Error(
            'switch-in email not in registry — cannot align active (RC-P3 stale-registry)',
          );
        }
        setActive(reg, trap.commitSwitchinEmail);
      });
      regAligned = true;
    } catch (_e) {
      regAligned = false;
    }
    trap.activeAligned = true;
    // 清回滚物料（codex re-§7 P1·防前向对齐后第二次 trap 误回滚 ①②）。
    trap.overwriteInProgress = false;
    trap.overwriteCredPath = '';
    trap.overwriteCjPath = '';
    if (regAligned) {
      messages.push(
        `switch-account: 换号在「①② 已提交、收尾未完成」窗口被中断——已**前向对齐全部到 ${trap.commitSwitchinEmail}**（补写 keychain ③ + registry active），三存储与 registry 一致·避免 split-brain（不回滚已提交的 ①）。`,
      );
    } else {
      messages.push(
        `switch-account: 换号在「①② 已提交、收尾未完成」窗口被中断——已把三存储前向对齐到 ${trap.commitSwitchinEmail}（补写 keychain ③·不回滚已提交的 ①），但 registry active 对齐失败——registry 暂留旧号、**下次 ccm account switch 启动时 reconcileActiveFromStore 会读 ②~/.claude.json oauthAccount 反向对账修正**（非永久 split-brain·可自愈）。`,
      );
    }
    // **CRITICAL（codex）**：任何退出路径都清含 token 的快照——前向对齐分支结束前必清（信号触发时 handler 随即 exit·靠这里清）。
    cleanupSnapshots(trap, messages);
    return { action: 'forward-align', regAligned, messages };
  }
  if (trap.overwriteInProgress && trap.overwriteCredPath) {
    // 阶段 A·回滚：覆写窗口内、存储未提交 → 回滚 ①② 到旧号。
    const rb = rollbackOfficialStores12(trap.overwriteCredPath, trap.overwriteCjPath, trap);
    trap.overwriteInProgress = false;
    for (const m of rb.messages) messages.push(m);
    messages.push(
      'switch-account: 换号在覆写窗口内被中断——已尝试把 ①② 官方存储回滚到旧号（避免 split-brain）。三存储与 registry 保守留旧号。',
    );
    cleanupSnapshots(trap, messages); // **CRITICAL**：回滚后清含 token 的快照（绝不残留）。
    return { action: 'rollback', rolledBack: rb.ok, messages };
  }
  cleanupSnapshots(trap, messages); // noop 分支也清（防任何残留快照·幂等）。
  return { action: 'noop', messages };
}

// ── 小工具 ──────────────────────────────────────────────────────────────────────────────────────
// mkSnapTemp — 懒建唯一私有快照目录 + 造一个 0600 快照文件名。
//   **codex CRITICAL#1（symlink/竞态收口）**：首次调用用 `fs.mkdtempSync` 在 snapParent 下**原子**造一个带 6 位随机
//   后缀的唯一目录（mode 0700）——mkdtemp 绝不复用 existing path，故攻击者预建的同名 symlink 无法劫持（不像 mkdirSync
//   对已存在路径是 no-op·会顺着 symlink 写穿）。一次换号只造一个目录（snapDir 非空即复用），① ② 两份快照同住其中。
function mkSnapTemp(trap: SwitchTrapState, tag: string): string {
  if (!trap.snapDir) {
    fs.mkdirSync(trap.snapParent, { recursive: true, mode: 0o700 }); // 父目录（home 可能尚未建）。
    trap.snapDir = fs.mkdtempSync(path.join(trap.snapParent, '.ccm-cred-snap-')); // 原子·唯一·0700。
  }
  return path.join(trap.snapDir, `.${tag}.${Date.now()}.${Math.random().toString(36).slice(2)}`);
}
// 抽 error 的非密 code（绝不回显可能含 token 的 message）。
function codeOf(e: unknown): string {
  const c = (e as NodeJS.ErrnoException | undefined)?.code;
  return typeof c === 'string' ? c : 'ERR';
}
