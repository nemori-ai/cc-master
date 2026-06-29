// account/vault.ts — vault / token I/O 安全层（@ccm/engine·Phase 2a 移植）。
//
// 源：cc-master 插件 skills/account-management/scripts/account-add.sh（keychain 读/写、file vault 写、blob
//   规整/校验、身份提取）+ account-delete.sh（keychain delete / file 删行）+ account-list.sh（token-blind
//   file 探测）+ accounts-lib.js 的 with_vault_lock。本文件是它们**安全机制层**的 TS 移植——逐条保住
//   token-blindness 不变式，把 bash 的「`security … | node …` 管道 / awk index 行首锚定 / 文件锁」搬进 node。
//   **不含 switch 换号流程**（那是 Phase 2b）；refresh 端点逻辑在姊妹模块 refresh.ts。
//
// ───────────────────────── token-blindness 铁律（HARD·原样保住）─────────────────────────
// token（OAuth blob，含 refresh token）**只经两条信道流动**：
//   ① macOS `security` 子进程的 **argv**（唯一审定单点例外）——写 keychain 用 `add-generic-password -w "$blob"`
//      把 blob 作 argv 元素（**必须 argv·不能走 stdin readpassphrase 的 128 字节截断**会丢 refreshToken）。
//      用 `spawnSync`（数组 argv·无 shell·无注入）；**绝不**用会把 argv 拼进 .message 的 throw 型 API。
//   ② node 进程内（refresh 时经 https POST body·见 refresh.ts；读 keychain 时经 `security` stdout 进本进程
//      局部变量）——blob 在本 node 进程内存活着是不可避免的（ccm 本身就是干活的 node 进程），但**绝不**：
//      写 stdout/stderr（agent 读的输出流）、绝不进 log、绝不进 registry（accounts.json）明文、绝不进普通 argv。
// 任何返回 blob 值的函数（vaultRead / captureCurrentLoginBlob …）只返回给**进程内调用方**（store / refresh /
//   probe-validate），渲染层只拿到布尔 / 非密元信息。token-blind 探测（vaultProbe）只回布尔、绝不外漏 blob 值。
//
// 红线1（ADR-006）：node/JS only，纯 node stdlib（child_process/fs/os/path），零第三方依赖。
// IIFE 守（tsdown banner 占位）：本模块 import node:child_process——webview 永不调 vault，占位 {} 足够。

import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  type AcquireLockOptions,
  acquireFileLock,
  fileVaultLineMatch,
  releaseFileLock,
} from './registry.js';

// ── 常量 ────────────────────────────────────────────────────────────────────────────────────────
// keychain 写入 cc-master 备号 blob 的默认 service（account=email）。
export const DEFAULT_KEYCHAIN_SERVICE = 'cc-master-oauth';
// 官方「Claude Code-credentials」item（account=$USER）= 机器**当前登录号**的完整 blob（含 refreshToken）。
export const KEYCHAIN_CRED_SERVICE = 'Claude Code-credentials';

// 疑似 token 前缀（access / refresh）——校验 blob 形态用，绝不回显命中的值。
const ACCESS_PREFIX = 'sk-ant-oat';
const REFRESH_PREFIX = 'sk-ant-ort';

// ── 类型 ────────────────────────────────────────────────────────────────────────────────────────
// vault 引用（= registry entry.vault 的两形态·非密指针，不含 token 值）。
export type VaultRef =
  | { kind: 'keychain'; service: string; account: string }
  | { kind: 'file'; path: string; key: string };

// keychain delete 三态结果。
export type DeleteResult = 'deleted' | 'absent' | 'unavailable';

// vault 写结果（token-blind：error 只含非密原因，绝不含 blob 值）。
export interface VaultWriteResult {
  ok: boolean;
  error?: string;
}

// vault 操作可注入项：keychain provider（测试可注入 fake）+ 锁参数。
export interface VaultOpts {
  keychain?: KeychainProvider;
  lockOpts?: AcquireLockOptions;
}

// ── keychain provider 抽象（跨平台分界 SSOT）──────────────────────────────────────────────────────
//   macOS 用 `security`（硬依赖）；非 mac 无 keychain → isAvailable()=false，调用方退 file vault floor（明文 0600）。
//   抽成接口便于：① 测试注入 fake（无需真 keychain）；② 未来别的 OS secret store（libsecret / DPAPI）接同一形。
export interface KeychainProvider {
  // keychain 是否可用（macOS `security` 在 PATH）。非 mac / 缺 security → false。
  isAvailable(): boolean;
  // **存在性探测（不带 `-w`·绝不取值·codex round#2·#3）**：只看 item 在不在（exit status），**压根不读 blob**。
  //   探活（vaultProbe）用它而非 read——对齐「探活不取值」语义（read 会把 blob 读进内存再丢·此函数连读都不读）。
  exists(service: string, account: string): boolean;
  // 读一个 item 的 password（= blob 单行 JSON）。item 不存在 / 不可用 → null。**返回值只给进程内调用方·绝不外漏。**
  read(service: string, account: string): string | null;
  // 写一个 item（-U upsert）。blob 作 `security` argv（避 128 截断）。成功 → true。**token-blind：绝不把 blob 进 log。**
  write(service: string, account: string, label: string, blob: string): boolean;
  // 删一个 item（**不带 -w·不取值**）。删了 → 'deleted'；本就无 → 'absent'；security 缺 → 'unavailable'。
  delete(service: string, account: string): DeleteResult;
}

// ── macKeychainProvider：用 macOS `security` 实现（spawnSync·数组 argv·无 shell）──────────────────────
//   绝不用 execFileSync（它在非 0 退出时把**整条 argv（含 blob）拼进抛出的 .message**·会泄 token）。spawnSync
//   只回 {status,stdout,stderr,error}·不抛（除 spawn 失败如 ENOENT）·我们全程不读会含 blob 的字段、不外漏。
//   bin 可注入（默认 `security`；测试经 CCM_SECURITY_BIN 指向 stub 脚本验真 spawn 路径·与 bash 测试同模式）。
export function macKeychainProvider(opts?: { bin?: string }): KeychainProvider {
  const bin = (opts && opts.bin) || 'security';
  let availCache: boolean | null = null;

  function run(args: string[], input?: string): SpawnSyncReturns<string> {
    // encoding utf8 → stdout/stderr 是 string；input（无）默认不喂 stdin。blob 只在 args（argv）里。
    return spawnSync(bin, args, { encoding: 'utf8', input });
  }

  return {
    isAvailable(): boolean {
      if (availCache !== null) return availCache;
      // 裸跑（无参）：security 印 usage 到 stderr、退非 0，但**存在**（ENOENT 才是真不可用）。
      const r = spawnSync(bin, [], { encoding: 'utf8' });
      availCache = !(r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT');
      return availCache;
    },
    exists(service, account): boolean {
      // `security find-generic-password`（**不带 `-w`**）只回 item 属性 + exit status（0=在·非 0=不在），**绝不打印
      //   password**。我们只看 status——blob 从不被取出（比 read 后丢更强的 token-blind·codex round#2·#3）。
      const r = run(['find-generic-password', '-s', service, '-a', account]);
      if (r.error) return false; // ENOENT / spawn 失败 → 当不在。
      return r.status === 0;
    },
    read(service, account): string | null {
      // security -w 把 password（blob）打到 stdout → 本进程局部捕获（不外漏）。item 不存在 → status 非 0 → null。
      const r = run(['find-generic-password', '-w', '-s', service, '-a', account]);
      if (r.error) return null; // ENOENT / spawn 失败 → 当不可用/无。
      if (r.status !== 0) return null; // item 不存在 / 未授权。
      const out = typeof r.stdout === 'string' ? r.stdout : '';
      // security -w 的 stdout 末尾带换行；裁掉。blob 本体 [A-Za-z0-9_+/=.\-{}":,] 无内嵌换行。
      const blob = out.replace(/\r?\n$/, '');
      return blob.length > 0 ? blob : null;
    },
    write(service, account, label, blob): boolean {
      // -U：项已存在则更新（refresh/add 复用同一条）。blob 作 `-w` 后的 argv 元素（**避 stdin 128 截断**）。
      //   spawnSync 数组 argv·无 shell·blob 不进 .message（不抛）·不进 log。
      const r = run([
        'add-generic-password',
        '-U',
        '-s',
        service,
        '-a',
        account,
        '-l',
        label,
        '-w',
        blob,
      ]);
      if (r.error) return false; // security 缺 / spawn 失败。
      return r.status === 0;
    },
    delete(service, account): DeleteResult {
      const r = run(['delete-generic-password', '-a', account, '-s', service]); // **不带 -w·不取值**。
      if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') return 'unavailable';
      if (r.error) return 'absent'; // 其它 spawn 异常 → 当本就无（保守）。
      return r.status === 0 ? 'deleted' : 'absent'; // 删不到（本就不存在）→ absent·非致命。
    },
  };
}

// 解析默认 keychain provider（从注入 opts 或默认 `security`）。
function resolveKeychain(opts?: VaultOpts): KeychainProvider {
  return (opts && opts.keychain) || macKeychainProvider();
}

// ── blob 规整 / 校验（token-blind·绝不回显值）──────────────────────────────────────────────────────
// normalizeClaudeAiOauthBlob(raw) — 从官方完整 blob `{claudeAiOauth:{...}}` 抽出规整单行 blob。
//   校验三必需字段：accessToken(sk-ant-oat) / refreshToken(sk-ant-ort·**非空**) / expiresAt(数字)。
//   refreshToken 空/缺 → null（绝不存残缺 switchable:false blob·无重启换号死依赖 refreshToken）。失败 → null。
export function normalizeClaudeAiOauthBlob(raw: string): string | null {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch (_e) {
    return null;
  }
  const o = j && typeof j === 'object' ? (j as Record<string, unknown>).claudeAiOauth : null;
  if (!o || typeof o !== 'object') return null;
  const oa = o as Record<string, unknown>;
  if (typeof oa.accessToken !== 'string' || (oa.accessToken as string).indexOf(ACCESS_PREFIX) !== 0)
    return null;
  if (
    typeof oa.refreshToken !== 'string' ||
    !oa.refreshToken ||
    (oa.refreshToken as string).indexOf(REFRESH_PREFIX) !== 0
  )
    return null;
  if (typeof oa.expiresAt !== 'number' || !Number.isFinite(oa.expiresAt)) return null;
  const blob: Record<string, unknown> = {
    accessToken: oa.accessToken,
    refreshToken: oa.refreshToken,
    expiresAt: oa.expiresAt,
  };
  if (Array.isArray(oa.scopes)) blob.scopes = oa.scopes;
  if (typeof oa.subscriptionType === 'string' && oa.subscriptionType)
    blob.subscriptionType = oa.subscriptionType;
  if (typeof oa.rateLimitTier === 'string' && oa.rateLimitTier)
    blob.rateLimitTier = oa.rateLimitTier;
  return JSON.stringify(blob); // 单行（无缩进·无内嵌换行）。
}

// validateBlob(blob) — 规整后单行 blob 的最后一道关（顶层三必需字段 + 单行不变式）。绝不回显 token。
export function validateBlob(blob: string): boolean {
  if (typeof blob !== 'string' || !blob) return false;
  // 单行守卫：blob 绝不含内嵌换行（file vault 取行会截断）。
  if (blob.indexOf('\n') !== -1 || blob.indexOf('\r') !== -1) return false;
  let o: unknown;
  try {
    o = JSON.parse(blob);
  } catch (_e) {
    return false;
  }
  if (!o || typeof o !== 'object') return false;
  const b = o as Record<string, unknown>;
  const okAt =
    typeof b.accessToken === 'string' && (b.accessToken as string).indexOf(ACCESS_PREFIX) === 0;
  const okRt =
    typeof b.refreshToken === 'string' &&
    !!b.refreshToken &&
    (b.refreshToken as string).indexOf(REFRESH_PREFIX) === 0;
  const okExp = typeof b.expiresAt === 'number' && Number.isFinite(b.expiresAt as number);
  return okAt && okRt && okExp;
}

// subscriptionTypeOf(blob) — 抽非密订阅枚举（给 registry 写·绝不带 token）。缺/坏 → null。
export function subscriptionTypeOf(blob: string): string | null {
  try {
    const o = JSON.parse(blob) as Record<string, unknown>;
    if (o && typeof o.subscriptionType === 'string' && o.subscriptionType)
      return o.subscriptionType;
  } catch (_e) {
    /* 坏 JSON → null */
  }
  return null;
}

// ── 身份提取（非密·= ~/.claude.json oauthAccount 原样）──────────────────────────────────────────────
// identity 全非密（accountUuid/emailAddress/organization… 16 字段），**可经返回值回到调用方**（与 token 不同）。
//   也是身份 guard（--email 必须 == 当前登录 email）的 email 来源。失败 → null。
export function extractIdentity(claudeJsonPath: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = fs.readFileSync(claudeJsonPath, 'utf8');
  } catch (_e) {
    return null;
  }
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch (_e) {
    return null;
  }
  const oa = j && typeof j === 'object' ? (j as Record<string, unknown>).oauthAccount : null;
  if (!oa || typeof oa !== 'object' || Array.isArray(oa)) return null;
  if (Object.keys(oa as Record<string, unknown>).length === 0) return null;
  return oa as Record<string, unknown>;
}

// emailOfIdentity(identity) — 取 identity 的 emailAddress（非密·身份 guard 用）。缺 → null。
export function emailOfIdentity(identity: unknown): string | null {
  if (identity && typeof identity === 'object') {
    const e = (identity as Record<string, unknown>).emailAddress;
    if (typeof e === 'string' && e) return e;
  }
  return null;
}

// ── 当前登录号完整 blob 捕获（主路径·直读 keychain「Claude Code-credentials」account=$USER）────────────
//   非 mac / 无 item → 降级读 credentials.json（CC 官方 Linux 凭证存储·该文件 mac 上 refreshToken 可能空·校验拦下）。
export interface CaptureOpts {
  keychain?: KeychainProvider;
  credService?: string; // 默认 KEYCHAIN_CRED_SERVICE。
  user?: string; // keychain account=$USER。
  credentialsJsonPath?: string; // 非 mac fallback 源。
}
export function captureCurrentLoginBlob(opts?: CaptureOpts): string | null {
  const kc = (opts && opts.keychain) || macKeychainProvider();
  const credService = (opts && opts.credService) || KEYCHAIN_CRED_SERVICE;
  const user = (opts && opts.user) || process.env.USER || '';
  // 主路径：keychain 直读（含 refreshToken·非空）。返回值只在本进程内、立即规整。
  if (kc.isAvailable() && user) {
    const raw = kc.read(credService, user);
    if (raw) {
      const blob = normalizeClaudeAiOauthBlob(raw);
      if (blob) return blob;
    }
  }
  // 非 mac fallback：credentials.json 的 .claudeAiOauth。
  const cjPath =
    (opts && opts.credentialsJsonPath) || path.join(os.homedir(), '.claude', '.credentials.json');
  let raw: string;
  try {
    raw = fs.readFileSync(cjPath, 'utf8');
  } catch (_e) {
    return null;
  }
  return normalizeClaudeAiOauthBlob(raw);
}

// ── 跨平台默认形态 ────────────────────────────────────────────────────────────────────────────────
// defaultVaultKind — mac 且 keychain 可用 → 'keychain'；否则退 'file'（0600 明文 floor·非 mac 唯一形态）。
export function defaultVaultKind(keychain?: KeychainProvider): 'keychain' | 'file' {
  const kc = keychain || macKeychainProvider();
  return process.platform === 'darwin' && kc.isAvailable() ? 'keychain' : 'file';
}

// defaultVaultFile — file vault 默认路径（与 accounts.json 同一用户级 home）。env 可注入。
export function defaultVaultFile(env?: Record<string, string | undefined>): string {
  const e = env || process.env;
  const home = e.CC_MASTER_HOME || path.join(os.homedir(), '.claude', 'cc-master');
  return path.join(home, 'accounts.env');
}

// ── file vault 行操作（token-blind·`startsWith` 行首锚定·对 email 的 ./@ 元字符免疫）───────────────────
//   bash 用 `awk index($0,p)==1`（定字符串行首锚定）；node 等价用 `String.startsWith(prefix)`——同样是定字符串
//   前缀比较·**绝不**正则（email 的 `.`/`@` 是正则元字符·裸 `^email_` 会误匹配·§A.4 必修 bug）。
//   只匹配本号**精确**的 `<email>_TOKEN=` / `<email>_EXPIRES=` 两类行（绝不用宽 `<email>_` 前缀·否则删 `foo`
//   会误删 sibling `foo_bar_TOKEN=`·codex round#2/#3 重叠标识 bug 收口）。

// file vault 原子写（temp + rename·0600）。失败抛（调用方在锁内 try）。
function atomicWriteFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.accounts.env.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  try {
    fs.chmodSync(tmp, 0o600); // writeFileSync 的 mode 受 umask 影响·显式再钉。
    fs.renameSync(tmp, filePath); // 同目录 rename 原子。
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

// 保留「既不以 tokenLine 也不以 expiresLine 起头」的非空行（= 删本号两类行·token-blind 不读值）。
function keepOtherLines(text: string, tokenLine: string, expiresLine: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (line === '') continue; // 丢空行（含尾随空行）·重组时再加换行。
    if (line.startsWith(tokenLine) || line.startsWith(expiresLine)) continue;
    out.push(line);
  }
  return out;
}

// fileVaultStore — 写本号完整记录（_TOKEN=<单行blob> + 可选 _EXPIRES）。全或无原子 + vault 锁 fail-closed。
function fileVaultStore(
  blob: string,
  filePath: string,
  key: string,
  expires: string | null | undefined,
  opts?: VaultOpts,
): VaultWriteResult {
  const { tokenLine, expiresLine } = fileVaultLineMatch(key);
  let lock: ReturnType<typeof acquireFileLock>;
  try {
    lock = acquireFileLock(filePath, opts && opts.lockOpts); // fail-closed：取不到锁则抛·绝不无锁跑临界区。
  } catch (_e) {
    return {
      ok: false,
      error: 'vault: 无法取得 file vault 锁——拒绝无锁重写 vault（防并发互踩），未写入。',
    };
  }
  try {
    let kept: string[] = [];
    try {
      if (fs.existsSync(filePath)) {
        kept = keepOtherLines(fs.readFileSync(filePath, 'utf8'), tokenLine, expiresLine);
      }
    } catch (_e) {
      return { ok: false, error: 'vault: 读旧 vault 失败（不可读？）——保留原文件，未写入。' };
    }
    kept.push(`${tokenLine}${blob}`); // tokenLine == `${key}_TOKEN=`·blob 进文件、绝不回显。
    if (expires) kept.push(`${expiresLine}${expires}`);
    try {
      atomicWriteFile(filePath, `${kept.join('\n')}\n`);
    } catch (_e) {
      return {
        ok: false,
        error: 'vault: 原子写 file vault 失败（磁盘满 / rename 错？）——原 vault 原封不动，未写入。',
      };
    }
    return { ok: true };
  } finally {
    releaseFileLock(lock); // 无论成功/抛错都释放（不漏锁）。
  }
}

// fileVaultDelete — 删本号两类行（token-blind）。删了 → 'deleted'；本就无 / 文件缺 → 'absent'；锁/IO 失败 → 'error'。
function fileVaultDelete(filePath: string, key: string, opts?: VaultOpts): DeleteResult | 'error' {
  if (!fs.existsSync(filePath)) return 'absent';
  const { tokenLine, expiresLine } = fileVaultLineMatch(key);
  let lock: ReturnType<typeof acquireFileLock>;
  try {
    lock = acquireFileLock(filePath, opts && opts.lockOpts);
  } catch (_e) {
    return 'error';
  }
  try {
    let text: string;
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch (_e) {
      return 'error';
    }
    // 数本号两类行（区分「删了」vs「本就无」）·只数前缀·不读值。
    let had = 0;
    for (const line of text.split('\n')) {
      if (line.startsWith(tokenLine) || line.startsWith(expiresLine)) had += 1;
    }
    if (had === 0) return 'absent';
    const kept = keepOtherLines(text, tokenLine, expiresLine);
    try {
      atomicWriteFile(filePath, kept.length ? `${kept.join('\n')}\n` : '');
    } catch (_e) {
      return 'error'; // rename 失败 → 当删除失败（绝不谎报删净·token 仍在）。
    }
    return 'deleted';
  } finally {
    releaseFileLock(lock);
  }
}

// fileVaultProbe — token-blind 存在性布尔：`<key>_TOKEN=` 行存在**且等号后非空**。**绝不 slice 出 blob 值**
//   （只比前缀 + 长度·blob 本体从不进任何变量·这是 bash awk `index($0,p)==1 && length>length(p)` 的 node 等价）。
function fileVaultProbe(filePath: string, key: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const { tokenLine } = fileVaultLineMatch(key);
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (_e) {
    return false;
  }
  for (const line of text.split('\n')) {
    // startsWith 行首锚定·length 守等号后非空——**绝不** line.slice 取值（token 不外漏）。
    if (line.startsWith(tokenLine) && line.length > tokenLine.length) return true;
  }
  return false;
}

// fileVaultRead — **内部**：取本号 _TOKEN= 行的 blob 值（给 refresh / probe-validate）。绝不外漏到渲染/log。
function fileVaultRead(filePath: string, key: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const { tokenLine } = fileVaultLineMatch(key);
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (_e) {
    return null;
  }
  for (const line of text.split('\n')) {
    if (line.startsWith(tokenLine) && line.length > tokenLine.length) {
      return line.slice(tokenLine.length); // 切前缀取值（仅给进程内调用方）。
    }
  }
  return null;
}

// ── vault 形态分流：按 ref.kind 派 keychain / file ────────────────────────────────────────────────
// vaultStore — 存一段已校验的单行 blob 进 vault。blob 绝不回显。
export function vaultStore(
  blob: string,
  ref: VaultRef,
  expires?: string | null,
  opts?: VaultOpts,
): VaultWriteResult {
  if (!validateBlob(blob)) {
    return {
      ok: false,
      error: 'vault: blob 校验失败（缺三必需字段 / 非单行）——拒绝写入残缺 blob。',
    };
  }
  if (ref.kind === 'keychain') {
    const kc = resolveKeychain(opts);
    if (!kc.isAvailable()) {
      return { ok: false, error: 'vault: keychain 不可用（非 mac？）——请用 file vault 形态。' };
    }
    const ok = kc.write(ref.service, ref.account, `cc-master OAuth: ${ref.account}`, blob);
    return ok ? { ok: true } : { ok: false, error: 'vault: keychain 写入失败（security 非 0）。' };
  }
  return fileVaultStore(blob, ref.path, ref.key, expires, opts);
}

// vaultDelete — 删 vault 里该 ref 的 token（token-blind·按前缀/项·不取值）。
export function vaultDelete(ref: VaultRef, opts?: VaultOpts): DeleteResult | 'error' {
  if (ref.kind === 'keychain') {
    const kc = resolveKeychain(opts);
    return kc.delete(ref.service, ref.account);
  }
  return fileVaultDelete(ref.path, ref.key, opts);
}

// vaultProbe — token-blind 存在性布尔（list 探活用·绝不外漏 blob 值）。
export function vaultProbe(ref: VaultRef, opts?: VaultOpts): boolean {
  if (ref.kind === 'keychain') {
    const kc = resolveKeychain(opts);
    if (!kc.isAvailable()) return false;
    // keychain：用 `exists`（`security find` **不带 -w**·只看 exit status·**压根不取 blob**·codex round#2·#3）——
    //   比旧「read 回 blob 再丢」更强：blob 从未被读出。对齐 file 形态「只回布尔·blob 不进诊断进程」。
    return ref.account ? kc.exists(ref.service, ref.account) : false;
  }
  return fileVaultProbe(ref.path, ref.key);
}

// vaultRead — **内部 API**：取 vault 里该 ref 的 blob 值（给 refresh / writeback / probe-validate）。
//   **返回值绝不外漏到渲染 / log / registry**——调用方有责任只把它喂给 store / refresh POST body。
export function vaultRead(ref: VaultRef, opts?: VaultOpts): string | null {
  if (ref.kind === 'keychain') {
    const kc = resolveKeychain(opts);
    if (!kc.isAvailable()) return null;
    return kc.read(ref.service, ref.account);
  }
  return fileVaultRead(ref.path, ref.key);
}

// vaultHasValidBlob — token-blind：vault 是否已有**含非空 refreshToken** 的有效 blob（add 手动恢复确认路）。
//   读 blob → 顶层 refreshToken(sk-ant-ort) + accessToken(sk-ant-oat) 校验 → 只回布尔（blob 立即丢弃·绝不外漏）。
export function vaultHasValidBlob(ref: VaultRef, opts?: VaultOpts): boolean {
  const blob = vaultRead(ref, opts);
  if (!blob) return false;
  let o: unknown;
  try {
    o = JSON.parse(blob);
  } catch (_e) {
    return false;
  }
  if (!o || typeof o !== 'object') return false;
  const b = o as Record<string, unknown>;
  const okRt =
    typeof b.refreshToken === 'string' &&
    (b.refreshToken as string).indexOf(REFRESH_PREFIX) === 0 &&
    !!b.refreshToken;
  const okAt =
    typeof b.accessToken === 'string' && (b.accessToken as string).indexOf(ACCESS_PREFIX) === 0;
  return okRt && okAt;
}

// ── 时间元信息（registry 用·全非密）──────────────────────────────────────────────────────────────
// defaultExpiresIso — token_expires_at 默认 = now+365d（refresh token 长期有效期量级·严格 ISO 秒精度）。
export function defaultExpiresIso(): string {
  const d = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
