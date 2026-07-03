// account/registry.ts — accounts.json 号池调度状态库（@ccm/engine·Phase 1 纯逻辑移植）。
//
// 源：cc-master 插件 skills/account-management/scripts/accounts-lib.js（CJS node 库）。本文件是它的
//   **纯逻辑** TS 移植（registry 模型 + 校验 + 锁原语 + entry 助手 + email 安全 helper）——逐条保住原版不变式，
//   只把 CJS require/module.exports 换 ESM import/export、补类型。**绝不碰 keychain/vault/bash/官方三存储/换号流程**
//   （那是 Phase 2）。本库**只读写 accounts.json 这一份非密 registry**——绝不碰 token、绝不碰 board、绝不 spawn、绝不联网。
//
// 安全命门（HARD·原样保住）：① registry 零 token——绝不打印 / 回显 / 返回任何疑似 token 值；
//   ② validateRegistry 主动断言「无 token 误入」（发现 sk-ant- 等疑似 token 串 = 硬 error）；
//   ③ saveRegistry 写前必过校验，有 token-leak error 就**拒写抛错**（永不把含 token 的 entry 落盘）。
//
// 红线1（ADR-006）：node/JS only，纯 node stdlib（fs/os/path），零第三方依赖。
// TS 移植差异（faithful 但有别处）：见各处 `// TS-port:` 注 + 模块尾导出，以及交付报告。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveCcMasterHome } from '../paths.js';

// ── 常量 ────────────────────────────────────────────────────────────────────────────────────────
export const SCHEMA = 'cc-master/accounts/v1';

// 严格 ISO-8601 UTC 定宽：YYYY-MM-DDTHH:MM:SSZ（秒精度、Z 后缀、定宽）。定宽 + Z 使字典序 == 时间序。
//   TS-port 注：board-model.ts 已导出一个等价的 ISO_UTC_RE（同一正则）；此处保持账号模块自洽、不耦合 board-model
//   的（可能演进的）正则，逐字复制原 accounts-lib.js 的常量，保留 1:1 行为。
export const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// vault.kind 合法枚举（设计稿 §A.4：keychain / file 两形态）。
export const VAULT_KINDS = new Set(['keychain', 'file']);

// 疑似 token 值前缀 / 形态——防误存 token 进 registry。Claude OAuth token 形如 `sk-ant-oat01-...`。
const TOKEN_LIKE_RE = /sk-ant-/i;

// redactToken(s) — 把字符串里任何 sk-ant- 形态 token 子串抹成占位（报错消息兜底·绝不回显 token 值）。
//   **字符集放宽到「非空白」(`\S+`)·codex round#3**：token 校验只查前缀（indexOf(prefix)===0）、**不约束后续字符集**，
//   故 token 可含 `.`/`+`/`/`/`=`/`~` 等——窄字符类（如 [A-Za-z0-9_-]）会只抹半截、留 `.def` 尾段漏 token 尾。`\S+`
//   贪婪吃到任何非空白·最不漏（代价仅可能多吃尾随标点·安全侧可接受·况且消息已不 stringify 原始值·此为纯兜底网）。
//   `sk-ant-` 后须跟 ≥1 个**非空白**字符才算 token——故解释串「命中 sk-ant- 形态」（`sk-ant-` 后跟**空格**）仍不被吞。
function redactToken(s: string): string {
  return typeof s === 'string' ? s.replace(/sk-ant-\S+/gi, '<redacted-token>') : s;
}

// SwitchSnapshot 里两个窗口的固定 key（设计稿 §A.3 SwitchSnapshot）。
const WINDOW_KEYS = ['5h', '7d'] as const;

// AccountEntry 里**不该出现**的字段名（任何疑似存 token 的字段名都拦——纵深防御）。
const FORBIDDEN_FIELD_RE = /token$|^token$|oauth|secret|credential|password|bearer/i;

// subscription_type 合法枚举（非密·来自 vault blob 的 claudeAiOauth.subscriptionType）。
const KNOWN_SUBSCRIPTION_TYPES = new Set(['max', 'pro', 'team', 'enterprise', 'free']);

// ── 类型 ────────────────────────────────────────────────────────────────────────────────────────
export interface ValidationIssue {
  message: string;
  account?: string;
}
export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

// 一个配额窗口快照子结构（非密：{ used_pct, resets_at, source? }）。
export interface WindowSnapshot {
  used_pct?: number;
  resets_at?: string;
  source?: string;
  [key: string]: unknown;
}
// SwitchSnapshot（last_switch_out / last_observed_quota / switch_history[]）。
export interface SwitchSnapshot {
  at?: string;
  '5h'?: WindowSnapshot;
  '7d'?: WindowSnapshot;
  [key: string]: unknown;
}
// AccountEntry：agent-shaped 自由对象——这里只列实际触碰的字段，其余宽松（同 board-model TaskLike 风格）。
export interface AccountEntry {
  vault?: unknown;
  active?: boolean;
  token_added_at?: string | null;
  token_refreshed_at?: string | null;
  token_expires_at?: string | null;
  subscription_type?: string | null;
  identity?: Record<string, unknown> | null;
  switchable?: boolean | null;
  last_switch_out?: SwitchSnapshot | null;
  last_observed_quota?: SwitchSnapshot | null;
  switch_history?: SwitchSnapshot[];
  [key: string]: unknown;
}
export interface Registry {
  schema?: string;
  updated_at?: string;
  accounts: Record<string, AccountEntry>;
  [key: string]: unknown;
}

// validateRegistry / scanForTokenLeak / validateSnapshot 内部的报告回调签名。
type ReportFn = (message: string, account?: string) => void;

// ── 路径解析 ─────────────────────────────────────────────────────────────────────────────────────
// accounts.json 固定路径：${CC_MASTER_HOME:-$HOME/.cc_master}/accounts.json（用户级 home·绝不落 repo 树）。
//   claudeConfigDir 跟随 CLAUDE_CONFIG_DIR（默认 ~/.claude·paths.resolveCcMasterHome SSOT）。
export function defaultRegistryPath(): string {
  return path.join(resolveCcMasterHome(), 'accounts.json');
}

// ── 校验：validateRegistry(obj) → { errors, warnings } ────────────────────────────────────────────
// 纯函数，绝不抛、绝不改入参。errors = 会确凿坏掉契约 / 安全的硬错；warnings = 可疑但可降级。
export function validateRegistry(obj: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  // **错误消息 token 兜底 redaction（codex round#2·#2 leak 收口）**：任一 validation 站点若把原始值拼进
  //   message / account（如畸形 entry 直接是 token 串），在这唯一报告 choke-point 把任何 `sk-ant-` token 子串
  //   一律抹成占位——保证无论哪条规则回显了值，**返回的 errors/warnings + 下游抛错都绝不含 token 值**。
  //   （literal 解释串 `命中 sk-ant- 形态` 后跟空格·非 word char·不被吞·照常可读。）
  const err: ReportFn = (msg, account) =>
    errors.push(
      account
        ? { message: redactToken(msg), account: redactToken(account) }
        : { message: redactToken(msg) },
    );
  const warn: ReportFn = (msg, account) =>
    warnings.push(
      account
        ? { message: redactToken(msg), account: redactToken(account) }
        : { message: redactToken(msg) },
    );

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    err(`registry 顶层必须是一个 JSON 对象（当前：${Array.isArray(obj) ? '数组' : typeof obj}）。`);
    return { errors, warnings };
  }
  const root = obj as Record<string, unknown>;

  // top-level schema（必填、版本门）。
  if (root.schema !== SCHEMA) {
    err(
      `schema 必须是字符串字面量 "${SCHEMA}"（当前：${JSON.stringify(root.schema)}）。它是 registry 版本协议锚点，缺/改 = 未来迁移会错认池。`,
    );
  }

  // top-level updated_at（必填、严格 ISO；非严格 = warn 不阻断，写侧会刷新）。
  if (!('updated_at' in root)) {
    warn('缺 top-level updated_at（registry 最后写入时刻）；saveRegistry 会在落盘时盖上。');
  } else if (typeof root.updated_at !== 'string' || !ISO_UTC_RE.test(root.updated_at)) {
    warn(
      `updated_at 非严格 ISO-8601 UTC YYYY-MM-DDTHH:MM:SSZ（当前：${JSON.stringify(root.updated_at)}）。`,
    );
  }

  // top-level accounts（必填、map：email → AccountEntry；空 {} 合法）。
  const accounts = root.accounts;
  if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) {
    err(
      `accounts 必须是对象（map：email → entry；空 {} 合法）。当前类型：${Array.isArray(accounts) ? '数组' : typeof accounts}。`,
    );
    return { errors, warnings };
  }
  const accountsMap = accounts as Record<string, unknown>;

  // 顶层未知字段——agent-shaped 宽容，仅一次性 warn 提示。
  for (const k of Object.keys(root)) {
    if (k !== 'schema' && k !== 'updated_at' && k !== 'accounts') {
      warn(
        `未知顶层字段 ${JSON.stringify(k)}（registry 已知顶层只有 schema/updated_at/accounts）；放行但请确认非误写。`,
      );
    }
  }

  // **top-level token-leak 缺口收口（codex round#2·#1）**：旧码只对 accounts entries 跑 scanForTokenLeak、
  //   对顶层未知杂字段只 warn 不挡——一个带 `note:"sk-ant-..."` 的 accounts.json 会被 round-trip 原样写回。
  //   修：对**除 accounts 外的所有顶层字段**跑纯值扫描（scanValuesForToken），任何位置出现 `sk-ant-` 形态值 =
  //   硬 error（saveRegistry 据此拒写）。accounts 子树由下面逐 entry 的 scanForTokenLeak 覆盖（含 identity
  //   字段名豁免），此处跳过避免重复报告。
  for (const [k, v] of Object.entries(root)) {
    if (k === 'accounts') continue;
    scanValuesForToken(v, k, err);
  }

  // 逐 entry 校验 + active 唯一性 + token 误入断言。
  let activeCount = 0;
  for (const [email, entryRaw] of Object.entries(accountsMap)) {
    if (!entryRaw || typeof entryRaw !== 'object' || Array.isArray(entryRaw)) {
      // **绝不 JSON.stringify(entryRaw)**（codex round#2·#2）：畸形 registry 里 entry 可能直接是 token 串
      //   （`accounts["a@x.com"]="sk-ant-..."`），stringify 会把 token 带进异常消息。只报固定字符串 + 类型。
      err(
        `entry for ${email} 必须是对象（当前类型：${Array.isArray(entryRaw) ? '数组' : typeof entryRaw}）——原始值已隐去不回显。`,
        email,
      );
      // 非对象 entry 直接是 token 串时也判 token-leak（值扫描·绝不回显值）——与「entry 是 token」的攻击形态对齐。
      scanValuesForToken(entryRaw, `accounts.${email}`, (m) => err(m, email));
      continue;
    }
    const entry = entryRaw as Record<string, unknown>;

    // ── 安全断言：token 绝不进 registry ───────────────────────────────────────────────────────────
    scanForTokenLeak(entry, email, err);

    // ── vault 引用（必填、形态合法）──────────────────────────────────────────────────────────────
    const vault = entry.vault;
    if (!vault || typeof vault !== 'object' || Array.isArray(vault)) {
      err(
        `vault 必填且为对象（token 的非密引用指针，不含 token 值）。当前：${JSON.stringify(vault)}。`,
        email,
      );
    } else {
      const v = vault as Record<string, unknown>;
      if (!VAULT_KINDS.has(v.kind as string)) {
        err(`vault.kind 必须 ∈ {keychain, file}（当前：${JSON.stringify(v.kind)}）。`, email);
      } else if (v.kind === 'keychain') {
        // keychain：{ kind, service, account:email }。
        if (typeof v.service !== 'string' || !v.service) {
          err(
            `keychain vault 需非空 service（如 "cc-master-oauth"）。当前：${JSON.stringify(v.service)}。`,
            email,
          );
        }
        if (typeof v.account !== 'string' || !v.account) {
          err(
            `keychain vault 需 account（= email key）。当前：${JSON.stringify(v.account)}。`,
            email,
          );
        } else if (v.account !== email) {
          warn(
            `keychain vault.account（${JSON.stringify(v.account)}）与 entry key email（${JSON.stringify(email)}）不一致——取 token 会按 account 找、与 key 脱节。`,
            email,
          );
        }
      } else if (v.kind === 'file') {
        // file：{ kind, path, key:email }。
        if (typeof v.path !== 'string' || !v.path) {
          err(
            `file vault 需非空 path（0600 vault 文件路径）。当前：${JSON.stringify(v.path)}。`,
            email,
          );
        }
        if (typeof v.key !== 'string' || !v.key) {
          err(
            `file vault 需 key（= email，vault 行前缀）。当前：${JSON.stringify(v.key)}。`,
            email,
          );
        } else if (v.key !== email) {
          warn(
            `file vault.key（${JSON.stringify(v.key)}）与 entry key email（${JSON.stringify(email)}）不一致——取 token 会按 key 找、与 key 脱节。`,
            email,
          );
        }
      }
    }

    // ── active（必填、boolean、至多一个 true）──────────────────────────────────────────────────────
    if (typeof entry.active !== 'boolean') {
      err(
        `active 必填且为 boolean（是否当前活跃号）。当前：${JSON.stringify(entry.active)}。`,
        email,
      );
    } else if (entry.active === true) {
      activeCount += 1;
    }

    // ── 时间戳字段（可选、严格 ISO；非严格 = warn）─────────────────────────────────────────────────
    // token_expires_at 语义钉死：记的是 **refresh token 的长期有效期**（录号时 now+365d），
    //   **不是** vault blob 里的短期 access-token expiresAt（~8h）。短期 expiresAt 绝不进 registry。
    for (const tf of ['token_added_at', 'token_refreshed_at', 'token_expires_at']) {
      if (tf in entry && entry[tf] != null) {
        if (typeof entry[tf] !== 'string' || !ISO_UTC_RE.test(entry[tf] as string)) {
          warn(
            `${tf} 非严格 ISO-8601 UTC YYYY-MM-DDTHH:MM:SSZ（当前：${JSON.stringify(entry[tf])}）；跨天算时长会错。`,
            email,
          );
        }
      }
    }

    // ── subscription_type（可选、字符串·非密）─────────────────────────────────────────────────────
    if ('subscription_type' in entry && entry.subscription_type != null) {
      if (typeof entry.subscription_type !== 'string' || !entry.subscription_type) {
        warn(
          `subscription_type 应为非空字符串（订阅档枚举·非密，来自 blob.subscriptionType）。当前：${JSON.stringify(entry.subscription_type)}。`,
          email,
        );
      } else if (!KNOWN_SUBSCRIPTION_TYPES.has(entry.subscription_type)) {
        warn(
          `subscription_type ${JSON.stringify(entry.subscription_type)} 不在已知枚举 {max,pro,team,enterprise,free}（放行——Claude Code 可能新增订阅档；仅提示确认非误写）。`,
          email,
        );
      }
    }

    // ── identity（可选、object·非密身份·= ~/.claude.json oauthAccount 原样透传）───────────────────
    if ('identity' in entry && entry.identity != null) {
      if (typeof entry.identity !== 'object' || Array.isArray(entry.identity)) {
        warn(
          `identity 应为对象（~/.claude.json oauthAccount 的非密身份原样透传·accountUuid/emailAddress/… 等）。当前：${JSON.stringify(entry.identity)}。`,
          email,
        );
      } else if (Object.keys(entry.identity).length === 0) {
        warn(
          `identity 是空对象（无身份字段）——switch ②段会降级保留现有 oauthAccount 不动（登录显示可能仍是上一号）；建议重跑 --add 补。`,
          email,
        );
      }
    }

    // ── switchable（可选、boolean·非密·残缺号标注）──────────────────────────────────────────────────
    if (
      'switchable' in entry &&
      entry.switchable != null &&
      typeof entry.switchable !== 'boolean'
    ) {
      warn(
        `switchable 应为 boolean（是否可无重启换号切入·缺省视作可切）。当前：${JSON.stringify(entry.switchable)}。`,
        email,
      );
    }

    // ── last_switch_out（可选、object|null；非 null 时校验快照形态）──────────────────────────────────
    if ('last_switch_out' in entry && entry.last_switch_out != null) {
      validateSnapshot(entry.last_switch_out, email, 'last_switch_out', err, warn);
    }

    // ── last_observed_quota（可选、object|null；与 last_switch_out 同形）────────────────────────────
    if ('last_observed_quota' in entry && entry.last_observed_quota != null) {
      validateSnapshot(entry.last_observed_quota, email, 'last_observed_quota', err, warn);
    }

    // ── switch_history（可选、array<SwitchSnapshot>）─────────────────────────────────────────────────
    if ('switch_history' in entry && entry.switch_history != null) {
      if (!Array.isArray(entry.switch_history)) {
        err(
          `switch_history 必须是数组（当前：${JSON.stringify(typeof entry.switch_history)}）。`,
          email,
        );
      } else {
        entry.switch_history.forEach((snap, i) => {
          validateSnapshot(snap, email, `switch_history[${i}]`, err, warn);
        });
      }
    }
  }

  // active 唯一性：至多一个 true（设计稿 §A.1 不变式3）。
  if (activeCount > 1) {
    err(
      `active 唯一性破坏：发现 ${activeCount} 个 active:true 的号（至多一个当前活跃号）。写侧切入新号时须把旧 active 号置 false。`,
    );
  }

  return { errors, warnings };
}

// 递归扫一个 entry 的所有字符串叶子，发现疑似 token 值 / 疑似 token 字段名 → 硬 error。绝不回显命中的值。
//   identity 子树豁免字段名启发式（CC 官方非密标识键名，未来可能引入含 `oauth` 子串的键名如 `oauthAccountId`）——
//   进入 identity 子树后**只做值扫描（TOKEN_LIKE_RE `sk-ant-` 仍全程生效），跳字段名扫描**。值扫描绝不放宽。
export function scanForTokenLeak(
  node: unknown,
  email: string | undefined,
  err: ReportFn,
  fieldPath?: string,
  inIdentity?: boolean,
): void {
  if (node == null) return;
  if (typeof node === 'string') {
    if (TOKEN_LIKE_RE.test(node)) {
      err(
        `字段 ${fieldPath || '(root)'} 的值疑似含 token（命中 sk-ant- 形态）——registry 绝不该含任何 token / 凭证值（只存 vault 引用指针）。值已隐去不回显。`,
        email,
      );
    }
    return;
  }
  if (typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const childPath = fieldPath ? `${fieldPath}.${k}` : k;
    // identity 子树（本层或祖先已进 identity）→ 豁免字段名启发式。
    const childInIdentity = inIdentity || (!fieldPath && k === 'identity');
    // 字段名疑似存 token（纵深防御）——identity 子树内跳过。
    if (!childInIdentity && FORBIDDEN_FIELD_RE.test(k)) {
      err(
        `字段名 ${JSON.stringify(childPath)} 疑似用于存 token / 凭证（registry 只存 vault 非密引用，绝不存 token 字段）。`,
        email,
      );
    }
    // 值扫描全程生效（含 identity 子树）——任何叶子值是 sk-ant- token 仍拦。
    scanForTokenLeak(v, email, err, childPath, childInIdentity);
  }
}

// scanValuesForToken — **纯值扫描**（无字段名启发式·与 scanForTokenLeak 互补）：递归扫所有字符串叶子，命中
//   sk-ant- 形态 = 报错。用于 registry 顶层非 accounts 字段（含未知杂字段）的 token-leak 兜底。**绝不回显命中值。**
//   与 scanForTokenLeak 的区别：不做 FORBIDDEN_FIELD_RE 字段名检查（故无 identity 子树字段名豁免顾虑·识别
//   纯靠值的 `sk-ant-` 形态），只防「值是 token」这一条——适合扫不含 identity 语义的顶层杂字段。
//   **有意安全侧保守（codex round#3 caveat·可接受不改）**：若某说明性字段的值恰含字面 `sk-ant-` 子串，会被误判
//   token-leak 而拒写——但 registry 是机器写的非密元数据，合法字段不会含 `sk-ant-`，故宁可安全侧误拒也不漏 token。
export function scanValuesForToken(node: unknown, fieldPath: string, report: ReportFn): void {
  if (node == null) return;
  if (typeof node === 'string') {
    if (TOKEN_LIKE_RE.test(node)) {
      report(
        `字段 ${fieldPath || '(root)'} 的值疑似含 token（命中 sk-ant- 形态）——registry 绝不该含任何 token / 凭证值（只存 vault 引用指针）。值已隐去不回显。`,
      );
    }
    return;
  }
  if (typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    scanValuesForToken(v, fieldPath ? `${fieldPath}.${k}` : k, report);
  }
}

// 校验一个 SwitchSnapshot：{ at, 5h:{used_pct,resets_at}, 7d:{...} }。
function validateSnapshot(
  snap: unknown,
  email: string,
  label: string,
  err: ReportFn,
  warn: ReportFn,
): void {
  if (!snap || typeof snap !== 'object' || Array.isArray(snap)) {
    err(`${label} 必须是对象（SwitchSnapshot）。当前：${JSON.stringify(snap)}。`, email);
    return;
  }
  const s = snap as Record<string, unknown>;
  if (typeof s.at !== 'string' || !ISO_UTC_RE.test(s.at)) {
    warn(`${label}.at 非严格 ISO-8601 UTC（当前：${JSON.stringify(s.at)}）。`, email);
  }
  for (const wk of WINDOW_KEYS) {
    const w = s[wk];
    if (!w || typeof w !== 'object' || Array.isArray(w)) {
      err(
        `${label}.${JSON.stringify(wk)} 必须是对象 { used_pct, resets_at }（当前：${JSON.stringify(w)}）。`,
        email,
      );
      continue;
    }
    const win = w as Record<string, unknown>;
    if (
      !Number.isInteger(win.used_pct) ||
      (win.used_pct as number) < 0 ||
      (win.used_pct as number) > 100
    ) {
      err(
        `${label}.${wk}.used_pct 必须是 0-100 整数（当前：${JSON.stringify(win.used_pct)}）。`,
        email,
      );
    }
    if (typeof win.resets_at !== 'string' || !ISO_UTC_RE.test(win.resets_at)) {
      warn(
        `${label}.${wk}.resets_at 非严格 ISO-8601 UTC（当前：${JSON.stringify(win.resets_at)}）；选号算法按它推算恢复度、失真会选错号。`,
        email,
      );
    }
  }
}

// ── 读：loadRegistry(path?) → { schema, updated_at?, accounts } ────────────────────────────────────
// path 缺省走 defaultRegistryPath()。文件不存在 = 返回空池（不报错）。坏 JSON = 抛清晰 error。
export function loadRegistry(p?: string | null): Registry {
  const filePath = p || defaultRegistryPath();
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err && err.code === 'ENOENT') {
      // 文件不存在 = 天然单账号空池。
      return emptyRegistry();
    }
    throw e; // 权限 / IO 错等照实抛。
  }
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    const why = e instanceof Error && e.message ? e.message : String(e);
    throw new Error(
      `accounts.json 不是合法 JSON（${filePath}）：${why}。请人工修复或删除该文件（删除 = 降级回天然单账号空池）。`,
    );
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error(
      `accounts.json 顶层不是对象（${filePath}），解析出 ${Array.isArray(obj) ? '数组' : typeof obj}。`,
    );
  }
  const reg = obj as Registry;
  // 规整：保证 accounts 是对象、schema 有值（容忍历史/手写文件缺 schema，按 v1 当默认补；校验另说）。
  if (!reg.accounts || typeof reg.accounts !== 'object' || Array.isArray(reg.accounts)) {
    reg.accounts = {};
  }
  if (typeof reg.schema !== 'string') {
    reg.schema = SCHEMA;
  }
  return reg;
}

// 空池骨架（文件不存在 / 显式建空池）。
export function emptyRegistry(): Registry {
  return { schema: SCHEMA, accounts: {} };
}

// ── 并发串行化：registry 读-改-写锁（防并发 lost-update）──────────────────────────────────────────
export interface LockHandle {
  path: string;
  owner?: string;
}
export interface AcquireLockOptions {
  timeoutMs?: number;
  staleMs?: number;
  livePid?: number;
}

function lockPath(regPath?: string | null): string {
  return `${regPath || defaultRegistryPath()}.lock`;
}

// 同步睡眠 ms（让出 CPU·非 busy-spin）。
function sleepSyncMs(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, ms | 0));
  } catch (_e) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      /* fallback busy-spin */
    }
  }
}

// 取锁：O_EXCL 独占建 lockfile + 重试 + stale 回收（livePid 存活判优先于 mtime）+ owner-token CAD。绝不写 token。
export function acquireRegistryLock(
  regPath?: string | null,
  opts?: AcquireLockOptions,
): LockHandle {
  const o = opts || {};
  const lp = lockPath(regPath);
  // timeout 默认 20s；CCM_REGISTRY_LOCK_TIMEOUT_MS 可 env 覆写。
  const timeoutMs = Number.isFinite(o.timeoutMs)
    ? (o.timeoutMs as number)
    : Number.isFinite(Number(process.env.CCM_REGISTRY_LOCK_TIMEOUT_MS)) &&
        Number(process.env.CCM_REGISTRY_LOCK_TIMEOUT_MS) > 0
      ? Number(process.env.CCM_REGISTRY_LOCK_TIMEOUT_MS)
      : 20000;
  // staleMs 默认 120s（远超任何真实 RMW、又仍能回收异常死亡的残锁）。CCM_REGISTRY_LOCK_STALE_MS 可 env 覆写。
  const staleMs = Number.isFinite(o.staleMs)
    ? (o.staleMs as number)
    : Number.isFinite(Number(process.env.CCM_REGISTRY_LOCK_STALE_MS)) &&
        Number(process.env.CCM_REGISTRY_LOCK_STALE_MS) > 0
      ? Number(process.env.CCM_REGISTRY_LOCK_STALE_MS)
      : 120000;
  const start = Date.now();
  // livePid：锁记录的 pid 必须在临界区期间活着（bash 传 `$$` 经 opts.livePid）；缺省 = 本 node 进程 pid。
  const livePid =
    o && Number.isInteger(o.livePid) && (o.livePid as number) > 0
      ? (o.livePid as number)
      : process.pid;
  // 确保父目录在。
  try {
    fs.mkdirSync(path.dirname(lp), { recursive: true, mode: 0o700 });
  } catch (_e) {
    /* best-effort */
  }
  // owner token：每次取锁生成唯一 token 写进锁文件；释放/破 stale 时 compare-and-delete。
  const ownerToken = `${String(livePid)}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  for (;;) {
    try {
      // wx = O_CREAT|O_EXCL：文件已存在则抛 EEXIST（别人持锁）。内容仅非密 pid+时刻+owner token。
      const fd = fs.openSync(lp, 'wx', 0o600);
      try {
        fs.writeSync(fd, JSON.stringify({ pid: livePid, at: nowIso(), owner: ownerToken }));
      } catch (_e) {
        /* 内容 best-effort */
      }
      fs.closeSync(fd);
      return { path: lp, owner: ownerToken };
    } catch (e) {
      const eno = e as NodeJS.ErrnoException;
      if (!eno || eno.code !== 'EEXIST') throw e; // 非「已存在」的真错（权限等）→ 抛。
      // 锁已存在：判 stale → 抢占；否则等一会儿重试。**先查 pid 存活性**（活持有者绝不因老 mtime 被破）。
      let stale = false;
      let observedOwner: string | null = null;
      try {
        const st = fs.statSync(lp);
        let pidKnown = false;
        let pidAlive = false;
        try {
          const info = JSON.parse(fs.readFileSync(lp, 'utf8') || '{}') as {
            owner?: unknown;
            pid?: unknown;
          };
          observedOwner = info && typeof info.owner === 'string' ? info.owner : null;
          if (info && typeof info.pid === 'number') {
            pidKnown = true;
            try {
              process.kill(info.pid, 0); // 活着 → 不抛。
              pidAlive = true;
            } catch (ke) {
              const kerr = ke as NodeJS.ErrnoException;
              if (kerr && kerr.code === 'ESRCH') pidAlive = false;
              else pidAlive = true; // EPERM 等 = 进程在 → 当活着·保守不破。
            }
          }
        } catch (_e) {
          pidKnown = false;
          observedOwner = null; // 锁文件坏 / 读不出 pid。
        }
        if (pidKnown) {
          stale = !pidAlive; // 活 → 不破；死 → 回收。mtime 不参与。
        } else {
          stale = Date.now() - st.mtimeMs > staleMs; // 仅当 pid 不可读（坏锁）才退回 mtime 兜底回收。
        }
      } catch (_e) {
        /* stat 失败（锁刚被释放？）→ 下轮重试直接抢 */
      }
      // 破 stale 锁前 compare-and-delete：unlink 前重读锁文件确认 owner 仍是当初观察到的那个才删。
      if (stale) {
        let okToUnlink = true;
        if (observedOwner != null) {
          try {
            const cur = JSON.parse(fs.readFileSync(lp, 'utf8') || '{}') as { owner?: unknown };
            if (cur && typeof cur.owner === 'string' && cur.owner !== observedOwner)
              okToUnlink = false;
          } catch (_e) {
            /* 读不出 = 坏锁/刚被删 → 按可删兜底 */
          }
        }
        if (okToUnlink) {
          try {
            fs.unlinkSync(lp);
          } catch (_e) {
            /* 竞争下别人已删·重试即可 */
          }
        }
        continue;
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `acquireRegistryLock：取 registry 锁超时（${timeoutMs}ms）——另有进程长时间持锁（${lp}）。稍后重试，或确认无卡死进程。`,
        );
      }
      // 同步等待 ~15-25ms 再重试（用 Atomics.wait 真睡眠·让出 CPU；抖动减少 thundering-herd）。
      sleepSyncMs(15 + Math.floor(Math.random() * 10));
    }
  }
}

export function releaseRegistryLock(handle: LockHandle | null | undefined): void {
  if (!handle || !handle.path) return;
  // 只删属于自己的锁：读锁文件确认 owner token 仍是我的才 unlink（防误删新持有者的锁）。
  try {
    if (handle.owner) {
      let cur: { owner?: unknown } | null = null;
      try {
        cur = JSON.parse(fs.readFileSync(handle.path, 'utf8') || '{}') as { owner?: unknown };
      } catch (_e) {
        cur = null;
      }
      if (cur && cur.owner && cur.owner !== handle.owner) return; // 锁已易主 → 不是我的，绝不删。
    }
    fs.unlinkSync(handle.path);
  } catch (_e) {
    /* 已被回收 / 不存在 → 无碍 */
  }
}

// mutateRegistry(regPath, mutator) —— 在锁内做完整 load→mutate→save（消除并发 lost-update）。
export function mutateRegistry(
  regPath: string | null | undefined,
  mutator: (reg: Registry) => void,
): string {
  const rp = regPath || defaultRegistryPath();
  const handle = acquireRegistryLock(rp);
  try {
    const reg = loadRegistry(rp); // 锁内 load 最新态。
    mutator(reg); // 原地改。
    return saveRegistry(reg, rp); // 锁内落盘（原子 tmp+rename + 校验 + token-leak 拒写）。
  } finally {
    releaseRegistryLock(handle); // 无论成功 / 抛错都释放锁（不漏锁）。
  }
}

// ── 通用文件锁（给 file vault 跨进程串行化用·与 registry 同一把锁原语）─────────────────────────────
//   TS-port 注：薄别名——锁原语本身 token-blind（只含非密 pid/at/owner），不碰 vault 内容（那是 Phase 2 bash 的事）。
export function acquireFileLock(targetPath: string, opts?: AcquireLockOptions): LockHandle {
  return acquireRegistryLock(targetPath, opts);
}
export function releaseFileLock(handle: LockHandle | null | undefined): void {
  releaseRegistryLock(handle);
}

// ── 写：saveRegistry(reg, path?) ──────────────────────────────────────────────────────────────────
// 原子写（写 tmp + rename）、mkdir -p 目录、0600 权限、刷新 updated_at。写前过 validateRegistry——
//   有 token-leak / 结构硬 error 就**拒写抛错**（永不把含 token 的 entry 落盘）。
export function saveRegistry(reg: Registry, p?: string | null): string {
  const filePath = p || defaultRegistryPath();
  if (!reg || typeof reg !== 'object' || Array.isArray(reg)) {
    throw new Error('saveRegistry：reg 必须是 registry 对象。');
  }
  // 不改入参——克隆后规整 + 刷新 updated_at。
  const out = JSON.parse(JSON.stringify(reg)) as Registry;
  if (typeof out.schema !== 'string') out.schema = SCHEMA;
  if (!out.accounts || typeof out.accounts !== 'object' || Array.isArray(out.accounts))
    out.accounts = {};
  out.updated_at = nowIso();

  // 写前校验——token-leak / 结构硬 error 一律拒写（安全命门：永不落盘含 token 的 registry）。
  const { errors } = validateRegistry(out);
  if (errors.length > 0) {
    const tokenLeak = errors.some((e) => /token|凭证|secret|credential/i.test(e.message));
    const head = tokenLeak
      ? 'saveRegistry 拒写：registry 含疑似 token / 凭证（安全命门——token 绝不进 accounts.json）。'
      : 'saveRegistry 拒写：registry 校验有硬 error（结构非法，落盘会污染号池）。';
    // 错误信息只列「哪个 account 的哪条规则」，绝不回显任何字段值（防 token 经报错泄漏）。
    const detail = errors
      .map((e) => (e.account ? `[${e.account}] ` : '') + e.message)
      .join('\n  - ');
    throw new Error(`${head}\n  - ${detail}`);
  }

  // 原子写：写 tmp（同目录、0600）→ rename 覆盖。显式 mode 0o600 + 写后再 chmod 兜底。
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.accounts.json.tmp-${process.pid}-${Date.now()}`);
  const json = `${JSON.stringify(out, null, 2)}\n`;
  fs.writeFileSync(tmp, json, { mode: 0o600 });
  try {
    fs.chmodSync(tmp, 0o600); // 兜底：writeFileSync 的 mode 受 umask 影响，显式再钉一次。
    fs.renameSync(tmp, filePath);
    fs.chmodSync(filePath, 0o600); // 目标若先存在则可能保留旧 mode——再钉一次。
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch (_) {
      /* tmp 清理 best-effort */
    }
    throw e;
  }
  return filePath;
}

// ── entry 增删改助手（纯函数，原地改 reg 并返回 reg；绝不碰 token）──────────────────────────────────
export interface AccountFields {
  vault?: unknown;
  token_added_at?: string | null;
  token_refreshed_at?: string | null;
  token_expires_at?: string | null;
  subscription_type?: string | null;
  identity?: Record<string, unknown> | null;
  switchable?: boolean | null;
  [key: string]: unknown;
}

// upsertAccount：插入或更新一个 email 的 entry（vault 引用 + 可选时间元信息）。绝不接受 token 字段。
export function upsertAccount(reg: Registry, email: string, fields?: AccountFields): Registry {
  requireEmail(email);
  const f = fields || {};
  ensureAccounts(reg);
  // 防 token 误入：调用方传进来的 fields 不该含 token——主动拒（不等到 saveRegistry）。
  assertNoTokenInFields(f);
  const prev = reg.accounts[email] || {};
  const entry: AccountEntry = Object.assign({}, prev);
  if (f.vault !== undefined) entry.vault = f.vault;
  if (f.token_added_at !== undefined) entry.token_added_at = f.token_added_at;
  if (f.token_refreshed_at !== undefined) entry.token_refreshed_at = f.token_refreshed_at;
  if (f.token_expires_at !== undefined) entry.token_expires_at = f.token_expires_at;
  // subscription_type：非密订阅档枚举（来自 vault blob.subscriptionType）。
  if (f.subscription_type !== undefined) entry.subscription_type = f.subscription_type;
  // identity：非密身份对象。**token-leak 兜底**：单独跑一次带 identity 豁免 flag 的 scanForTokenLeak
  //   （只豁免字段名启发式·保留值扫描）——任何叶子值混进 sk-ant- token 即抛错拦下。
  if (f.identity !== undefined) {
    if (f.identity != null) {
      const leak: string[] = [];
      scanForTokenLeak(f.identity, email, (m) => leak.push(m), 'identity', true);
      if (leak.length > 0) {
        throw new Error(
          `upsertAccount：identity 子树值疑似含 token（命中 sk-ant- 形态）——身份字段全非密、绝不该含 token 值。值已隐去；identity 不写入。`,
        );
      }
    }
    entry.identity = f.identity;
  }
  // switchable：非密 boolean（残缺号标注）。缺则不写（视作可切）。
  if (f.switchable !== undefined) entry.switchable = f.switchable;
  // active：upsert 默认不动 active（add 不自动设 active）。新 entry 缺 active 时补 false（保证窄腰字段在）。
  if (typeof entry.active !== 'boolean') entry.active = false;
  reg.accounts[email] = entry;
  return reg;
}

// removeAccount：删一个 email 的 entry。
export function removeAccount(reg: Registry, email: string): Registry {
  requireEmail(email);
  ensureAccounts(reg);
  delete reg.accounts[email];
  return reg;
}

// setActive：把指定 email 置 active=true、其余全 false（维护 active 唯一性不变式）。email 不在池中 = 抛错。
export function setActive(reg: Registry, email: string): Registry {
  requireEmail(email);
  ensureAccounts(reg);
  if (!(email in reg.accounts)) {
    throw new Error(`setActive：email ${JSON.stringify(email)} 不在号池中，无法置 active。`);
  }
  for (const [k, entry] of Object.entries(reg.accounts)) {
    if (entry && typeof entry === 'object') entry.active = k === email;
  }
  return reg;
}

// recordSwitchOut：写一个 email 切出时的配额快照到 last_switch_out（+ append switch_history）。
export interface SnapshotInput {
  at?: string;
  fiveHour?: WindowSnapshot;
  sevenDay?: WindowSnapshot;
  '5h'?: WindowSnapshot;
  '7d'?: WindowSnapshot;
}
export function recordSwitchOut(reg: Registry, email: string, snap?: SnapshotInput): Registry {
  requireEmail(email);
  ensureAccounts(reg);
  if (!(email in reg.accounts)) {
    throw new Error(`recordSwitchOut：email ${JSON.stringify(email)} 不在号池中。`);
  }
  const s = snap || {};
  const five = s.fiveHour || s['5h'] || {};
  const seven = s.sevenDay || s['7d'] || {};
  const snapshot: SwitchSnapshot = {
    at: s.at || nowIso(),
    '5h': normalizeWindow(five),
    '7d': normalizeWindow(seven),
  };
  const entry = reg.accounts[email] as AccountEntry;
  entry.last_switch_out = snapshot;
  // switch_history append（保守 append，便于复盘）。
  if (!Array.isArray(entry.switch_history)) entry.switch_history = [];
  entry.switch_history.push(snapshot);
  return reg;
}

// recordObservedQuota：写录号（add/refresh）那刻观察到的配额快照到 last_observed_quota（不 append history）。
export function recordObservedQuota(reg: Registry, email: string, snap?: SnapshotInput): Registry {
  requireEmail(email);
  ensureAccounts(reg);
  if (!(email in reg.accounts)) {
    throw new Error(`recordObservedQuota：email ${JSON.stringify(email)} 不在号池中。`);
  }
  const s = snap || {};
  const five = s.fiveHour || s['5h'] || {};
  const seven = s.sevenDay || s['7d'] || {};
  const snapshot: SwitchSnapshot = {
    at: s.at || nowIso(),
    '5h': normalizeWindow(five),
    '7d': normalizeWindow(seven),
  };
  (reg.accounts[email] as AccountEntry).last_observed_quota = snapshot;
  return reg;
}

// 规整一个窗口快照子结构 { used_pct, resets_at, source? }（source 是信任分级字段，可选透传）。
function normalizeWindow(w: WindowSnapshot): WindowSnapshot {
  const out: WindowSnapshot = {
    used_pct: w.used_pct,
    resets_at: w.resets_at,
  };
  if (w.source !== undefined) out.source = w.source; // 账户权威 vs local-derived-approx。
  return out;
}

// ── email 安全 helper（给 file vault 的 bash 行操作用·纯字符串计算，不执行任何 bash、不碰 token）──────
// email 含 `.`/`@`（正则元字符）；file vault 行操作必须用定字符串匹配（awk index 行首锚定），绝不用 grep -E/BRE。
//   TS-port 注：这是 Phase 2 file-vault bash 消费方的安全契约 helper，本函数只**构造**安全 guard 字符串，
//   绝不执行——属纯逻辑，保留它以保住 email-元字符安全这条不变式。
export interface FileVaultMatch {
  prefix: string;
  tokenLine: string;
  expiresLine: string;
  grepFixedToken: string;
  grepFixedExpires: string;
  awkFieldGuard: string;
  note: string;
}
export function fileVaultLineMatch(email: string): FileVaultMatch {
  requireEmail(email);
  const prefix = `${email}_`;
  return {
    prefix,
    tokenLine: `${email}_TOKEN=`,
    expiresLine: `${email}_EXPIRES=`,
    // grepFixedToken/grepFixedExpires：历史字段（弃用于读 token 行）。仅作向后兼容保留。
    grepFixedToken: `grep -F -- ${shArg(`${email}_TOKEN=`)}`,
    grepFixedExpires: `grep -F -- ${shArg(`${email}_EXPIRES=`)}`,
    // awk 精确前缀守卫（读/删/写一律用这个）：index($0, prefix)==1 表示行以 prefix 起头（行首锚定·非正则）。
    awkFieldGuard: 'index($0, p) == 1',
    note: 'file vault 行操作必须用 awk index($0,p)==1 行首锚定（定字符串前缀比较），绝不用 grep -E/BRE 的 ^email_（email 的 . 是正则元字符会误匹配·§A.4），读 token 行也绝不用 grep -F（子串匹配·非行首锚定·重叠标识下取错行→整行畸形当 token·P2-5）。',
  };
}

// ── 小工具 ──────────────────────────────────────────────────────────────────────────────────────
// 当前时刻的严格 ISO-8601 UTC（秒精度、Z 后缀、定宽）。Date#toISOString 出毫秒（...sssZ），裁到秒。
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function ensureAccounts(reg: Registry): void {
  if (!reg || typeof reg !== 'object' || Array.isArray(reg)) {
    throw new Error('reg 必须是 registry 对象。');
  }
  if (!reg.accounts || typeof reg.accounts !== 'object' || Array.isArray(reg.accounts)) {
    reg.accounts = {};
  }
}

function requireEmail(email: unknown): asserts email is string {
  if (typeof email !== 'string' || !email) {
    throw new Error(`email 必须是非空字符串（当前：${JSON.stringify(email)}）。`);
  }
}

// 防 token 误入助手字段（upsert 时主动拒，不等到 saveRegistry）。绝不回显命中的值。
function assertNoTokenInFields(fields: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(fields || {})) {
    if (FORBIDDEN_FIELD_RE.test(k)) {
      throw new Error(
        `upsertAccount：字段名 ${JSON.stringify(k)} 疑似存 token / 凭证——registry 只存 vault 非密引用，绝不存 token。`,
      );
    }
    if (typeof v === 'string' && TOKEN_LIKE_RE.test(v)) {
      throw new Error(
        `upsertAccount：字段 ${JSON.stringify(k)} 的值疑似含 token（命中 sk-ant- 形态）——值已隐去；registry 绝不存 token 值。`,
      );
    }
  }
}

// POSIX sh 单引号转义（给 shArg 用，让 helper 返回的命令片段嵌进 bash 安全）。
function shArg(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
