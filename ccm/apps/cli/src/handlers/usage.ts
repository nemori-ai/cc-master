// handlers/usage.ts — usage noun handler（show / advise / task-cost·ADR-015 §2.6·plan §5/§7）。
//
// usage = 配额侧只读 advisory namespace（charter ②控制 token 消耗速度 + ⑤资源下最大化效率）。
//   · show       → runRead：当前号 + 全备号 5h/7d used%/resets_at（备号=accounts.json registry 生命周期快照）。
//   · advise     → runRead：双侧走廊 verdict（throttle|accelerate|hold|hard_stop）+ 推荐 lever + switch_candidate。
//   · task-cost  → runRead：单/聚合任务 token（读 board observability·shell=N/A·coverage_pct·--group-by）。
//
// 硬不变式（plan §2 不变式 1·硬约束）：**usage 纯只读** = query/compute，零写、不抢 board-lock、不落状态。
//   全部 verb 走 runRead（绝不 runWrite）；备号数据**只读** accounts.json（JSON.parse），绝不写 registry、
//   绝不碰 token、绝不 import account-management 的 JS（进程/包边界·plan §5）。
//
// 诚实降级（plan §2 行 26/69）：账户信号不可得 = exit 0 + `data.available:false`（非 exit 1）；
//   无 registry / 文件不存在 → 天然单账号·effective_n=1（优雅降级·不报错）。诚实字段：source /
//   confidence / as_of / coverage_pct / snapshot_stale。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib（fs + path）。消费 `@ccm/engine` 的 pacing 数学。
// 红线3：usage 出 verdict / 数据，**不替 orchestrator 决策**（真动作归 SKILL A·plan §2 不变式 2）。
// 武装闸豁免：纯 handler 模块（无 hook 入口）。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  effectiveN,
  extractDoneRecords,
  type PacingOptions,
  pacingAdvice,
  type UsageSignal,
} from '@ccm/engine';
import { type BoardArg, type Ctx, runRead } from './_common.js';

// 备号窗口快照（registry SwitchSnapshot 投影）。
interface WindowSnap {
  used_pct: number | null;
  resets_at: string | null;
}
interface BackupAccount {
  email: string;
  active: boolean;
  switchable: boolean;
  as_of: string | null;
  five_hour: WindowSnap;
  seven_day: WindowSnap;
  snapshot_stale: boolean;
  source: 'registry-snapshot';
}

// ── accounts.json registry 解析（只读·绝不写）──────────────────────────────────────────────────────
//   路径同 accounts-lib.js 的 defaultRegistryPath：${CC_MASTER_HOME:-$HOME/.claude/cc-master}/accounts.json。
//   无文件 / 坏 JSON / 非对象 → null（天然单账号优雅降级·不抛）。
function registryPath(env: Record<string, string | undefined>): string {
  const home = env.CC_MASTER_HOME || path.join(os.homedir(), '.claude', 'cc-master');
  return path.join(home, 'accounts.json');
}

function readRegistry(env: Record<string, string | undefined>): Record<string, unknown> | null {
  const p = registryPath(env);
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return null; // 文件不存在 → 单账号
  }
  try {
    const obj = JSON.parse(raw);
    const accounts =
      obj && typeof obj === 'object' ? (obj as { accounts?: unknown }).accounts : null;
    if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) return null;
    return accounts as Record<string, unknown>;
  } catch {
    return null; // 坏 JSON → 单账号降级
  }
}

// pickLatestSnapshot(entry) → 该账号「最新一份」配额快照（last_observed_quota / last_switch_out /
//   switch_history[] 里 at 最大的那条·plan §5）。无任何快照 → null。
function pickLatestSnapshot(entry: Record<string, unknown>): Record<string, unknown> | null {
  const cands: Array<Record<string, unknown>> = [];
  for (const key of ['last_observed_quota', 'last_switch_out']) {
    const s = entry[key];
    if (s && typeof s === 'object' && !Array.isArray(s)) cands.push(s as Record<string, unknown>);
  }
  if (Array.isArray(entry.switch_history)) {
    for (const s of entry.switch_history) {
      if (s && typeof s === 'object' && !Array.isArray(s)) cands.push(s as Record<string, unknown>);
    }
  }
  if (cands.length === 0) return null;
  // 取 at（ISO）最大的那条；缺 at 的排最后。
  let best: Record<string, unknown> | null = null;
  let bestMs = -Infinity;
  for (const s of cands) {
    const ms = typeof s.at === 'string' ? Date.parse(s.at) : Number.NaN;
    const v = Number.isFinite(ms) ? ms : -Infinity;
    if (v >= bestMs) {
      bestMs = v;
      best = s;
    }
  }
  return best;
}

// snapWindow(snap, key) → 从快照里取一个窗口（"5h" / "7d"）的 {used_pct, resets_at}。
function snapWindow(snap: Record<string, unknown> | null, key: '5h' | '7d'): WindowSnap {
  const w =
    snap && snap[key] && typeof snap[key] === 'object'
      ? (snap[key] as Record<string, unknown>)
      : null;
  const usedPct = w && typeof w.used_pct === 'number' ? w.used_pct : null;
  const resetsAt = w && typeof w.resets_at === 'string' ? w.resets_at : null;
  return { used_pct: usedPct, resets_at: resetsAt };
}

// staleByAge(asOf, nowMs) → 快照是否过期（as_of 距今 > 7 天·或对应窗口都已过 reset）。
//   保守阈：备号快照是生命周期投影（非实时），>7d 视作 stale（弱信号）。
function staleByAge(asOf: string | null, nowMs: number): boolean {
  if (!asOf) return true;
  const ms = Date.parse(asOf);
  if (!Number.isFinite(ms)) return true;
  const ageDays = (nowMs - ms) / 86400000;
  return ageDays > 7;
}

// readBackups(env, nowMs) → 全部账号的备号快照视图（含 active 号本身·plan §5）。
//   registry 缺失 → null（单账号·available:false）。
function readBackups(
  env: Record<string, string | undefined>,
  nowMs: number,
): { accounts: BackupAccount[]; raw: Record<string, unknown> } | null {
  const accounts = readRegistry(env);
  if (!accounts) return null;
  const out: BackupAccount[] = [];
  for (const [email, rawEntry] of Object.entries(accounts)) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue;
    const entry = rawEntry as Record<string, unknown>;
    const snap = pickLatestSnapshot(entry);
    const asOf = snap && typeof snap.at === 'string' ? snap.at : null;
    out.push({
      email,
      active: entry.active === true,
      switchable: entry.switchable !== false,
      as_of: asOf,
      five_hour: snapWindow(snap, '5h'),
      seven_day: snapWindow(snap, '7d'),
      snapshot_stale: staleByAge(asOf, nowMs),
      source: 'registry-snapshot',
    });
  }
  // active 号排首，其余按 email 稳定排序。
  out.sort((a, b) => (a.active === b.active ? a.email.localeCompare(b.email) : a.active ? -1 : 1));
  return { accounts: out, raw: accounts };
}

// ── 当前号信号（status-line sidecar·account-authoritative·Finding #37）─────────────────────────────
//   sidecar 落点：${CC_MASTER_RATE_CACHE:-$HOME/.claude/.cc-master-rate-limits.json}（账户级·跨 project
//   共享）——这是 statusline-capture.js（writer）/ cc-usage.sh / usage-pacing.js hook（readers）三者钉死
//   的同一路径。**绝非 ${home}/usage-snapshot.json**（旧错路径·永远找不到真 sidecar·P4 修复）。
//   真实形态（statusline-capture.js 写）：`{ captured_at:<epoch秒>, five_hour:{used_percentage:<num>,
//   resets_at?:<epoch秒>}, seven_day:{used_percentage,resets_at?} }`——`resets_at`/`captured_at` 是 epoch 秒。
//   缺 → null（pacingAdvice 据此 available:false 降级·本地反推不归这俩只读 namespace·plan §4 性能边界）。
function rateCachePath(env: Record<string, string | undefined>): string {
  return (
    env.CC_MASTER_RATE_CACHE || path.join(os.homedir(), '.claude', '.cc-master-rate-limits.json')
  );
}

function readUsageSidecar(env: Record<string, string | undefined>): UsageSignal | null {
  try {
    const raw = fs.readFileSync(rateCachePath(env), 'utf8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return normalizeSignal(obj as Record<string, unknown>);
  } catch {
    return null; // 缺/坏 sidecar → 账户口径不可用（降级 available:false）
  }
  return null;
}

// normalizeSignal(obj) → 把 sidecar 归一到 UsageSignal。**真实 sidecar 形态**（statusline-capture.js 写）是
//   `five_hour`/`seven_day` + `used_percentage`(num) + `resets_at`/`captured_at`(epoch 秒·num)——
//   number 分支直接采纳。容忍冗余别名（5h/used_pct）+ ISO 字符串 resets_at/captured_at（Date.parse→epoch 秒），
//   兼容 registry 快照口径，但**权威路径是真实 sidecar 的 epoch-秒数字形态**。
function normalizeSignal(obj: Record<string, unknown>): UsageSignal {
  const win = (
    k1: string,
    k2: string,
  ): { used_percentage: number | null; resets_at: number | null } => {
    const w = (obj[k1] ?? obj[k2]) as Record<string, unknown> | undefined;
    if (!w || typeof w !== 'object') return { used_percentage: null, resets_at: null };
    const up =
      typeof w.used_percentage === 'number'
        ? w.used_percentage
        : typeof w.used_pct === 'number'
          ? w.used_pct
          : null;
    let ra: number | null = null;
    if (typeof w.resets_at === 'number') ra = w.resets_at;
    else if (typeof w.resets_at === 'string') {
      const ms = Date.parse(w.resets_at);
      ra = Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
    }
    return { used_percentage: up, resets_at: ra };
  };
  let capturedAt: number | null = null;
  if (typeof obj.captured_at === 'number') capturedAt = obj.captured_at;
  else if (typeof obj.captured_at === 'string') {
    const ms = Date.parse(obj.captured_at);
    capturedAt = Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  return {
    five_hour: win('five_hour', '5h'),
    seven_day: win('seven_day', '7d'),
    captured_at: capturedAt,
  };
}

// effectiveNFromRegistry(env, nowMs) → 号池有效配额份数（复用引擎 effectiveN 纯函数）。无 registry → 1。
function effectiveNFromRegistry(env: Record<string, string | undefined>, nowMs: number): number {
  const accounts = readRegistry(env);
  if (!accounts) return 1;
  return effectiveN(accounts as never, nowMs).effective_n;
}

// ── usage show ──────────────────────────────────────────────────────────────
//   当前号 + 全备号 5h/7d used%/resets_at（备号=registry 生命周期快照·标 as_of/snapshot_stale）。
//   --accounts all|current（默认 all）；信号不可得 = exit 0 + available:false。
export function show(ctx: Ctx): number {
  return runRead(ctx, {
    // usage show 不需要 active board（号池是用户级·跨板）——自定义 resolve 兜空板，避免无板时 exit 5。
    resolve: () => ({ boardPath: '', board: {} }),
    render: (_b, c) => {
      const nowMs = Date.now();
      const accountsScope = (c.values.accounts as string) || 'all';
      const sidecar = readUsageSidecar(c.env);
      const backups = readBackups(c.env, nowMs);
      const en = effectiveNFromRegistry(c.env, nowMs);

      const current = sidecar
        ? {
            source: 'account' as const,
            available: true,
            five_hour: sidecar.five_hour ?? null,
            seven_day: sidecar.seven_day ?? null,
            captured_at: sidecar.captured_at ?? null,
          }
        : {
            source: 'account' as const,
            available: false,
            five_hour: null,
            seven_day: null,
            captured_at: null,
          };

      const accountList =
        backups == null
          ? []
          : accountsScope === 'current'
            ? backups.accounts.filter((a) => a.active)
            : backups.accounts;

      const data = {
        available: current.available || (backups != null && backups.accounts.length > 0),
        accounts_scope: accountsScope,
        effective_n: en,
        current,
        accounts: accountList,
        registry_present: backups != null,
        as_of:
          current.captured_at != null
            ? new Date(current.captured_at * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
            : null,
        source: backups != null ? 'registry-snapshot' : 'account',
        confidence: current.available ? 'high' : backups != null ? 'medium' : 'low',
      };

      if (c.flags.json) return JSON.stringify({ ok: true, data });

      const lines: string[] = [];
      lines.push(`usage show（effective_n=${en}·accounts=${accountsScope}）`);
      if (current.available) {
        const p5 = current.five_hour?.used_percentage;
        const p7 = current.seven_day?.used_percentage;
        lines.push(`  current（account 权威）: 5h=${fmtPct(p5)} 7d=${fmtPct(p7)}`);
      } else {
        lines.push('  current: 账户权威信号不可用（无 status-line sidecar·available:false·降级）');
      }
      if (backups == null) {
        lines.push('  备号: 无 accounts.json registry（单账号·effective_n=1）');
      } else if (accountList.length === 0) {
        lines.push('  备号: registry 存在但无可列账号');
      } else {
        for (const a of accountList) {
          const tag = a.active ? '[active]' : a.switchable ? '[backup]' : '[backup·不可切]';
          const stale = a.snapshot_stale ? '·stale' : '';
          lines.push(
            `  ${tag} ${a.email}: 5h=${fmtPct(a.five_hour.used_pct)} 7d=${fmtPct(a.seven_day.used_pct)} (as_of=${a.as_of ?? 'N/A'}${stale}·registry-snapshot)`,
          );
        }
      }
      return `${lines.join('\n')}\n`;
    },
  });
}

function fmtPct(p: number | null | undefined): string {
  return typeof p === 'number' ? `${p}%` : 'N/A';
}

// ── usage advise ──────────────────────────────────────────────────────────────
//   双侧走廊 verdict + 推荐 lever + switch_candidate（收口 usage-pacing 数学·引擎 pacingAdvice）。
export function advise(ctx: Ctx): number {
  return runRead(ctx, {
    resolve: () => ({ boardPath: '', board: {} }),
    render: (_b, c) => {
      const nowMs = Date.now();
      const nowSec = Math.floor(nowMs / 1000);
      const sidecar = readUsageSidecar(c.env);
      const backups = readBackups(c.env, nowMs);
      // --effective-n 覆写优先；否则从 registry 算。
      const enFlag = c.values['effective-n'];
      const en =
        typeof enFlag === 'string' && Number.isInteger(Number(enFlag)) && Number(enFlag) >= 1
          ? Number(enFlag)
          : effectiveNFromRegistry(c.env, nowMs);

      const opts: PacingOptions = { nowSec, effectiveN: en };
      const advice = pacingAdvice(sidecar, opts);

      // switch_candidate：仅当 verdict 含切号 lever 且 registry 有可切备号时给（选 7d used% 最低的可切备号·恢复最多）。
      let switchCandidate: string | null = null;
      const wantsSwitch =
        advice.levers.includes('switch_account') ||
        advice.levers.includes('switch_account_user_decision');
      if (wantsSwitch && backups != null) {
        const switchable = backups.accounts.filter((a) => !a.active && a.switchable);
        switchable.sort((a, b) => sevenDayPctOrInf(a) - sevenDayPctOrInf(b));
        switchCandidate = switchable.length > 0 ? (switchable[0] as BackupAccount).email : null;
      }

      const data = {
        verdict: advice.verdict,
        reason: advice.reason,
        levers: advice.levers,
        hard_stop_7d: advice.hard_stop_7d,
        window_5h_pct: advice.window_5h_pct,
        window_7d_pct: advice.window_7d_pct,
        effective_n: advice.effective_n,
        switch_candidate: switchCandidate,
        confidence: advice.confidence,
        source: advice.available ? 'account' : 'local-derived-approx',
        as_of:
          sidecar && typeof sidecar.captured_at === 'number'
            ? new Date(sidecar.captured_at * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
            : null,
        available: advice.available,
      };

      if (c.flags.json) return JSON.stringify({ ok: true, data });
      const lines = [
        `usage advise: ${data.verdict}（effective_n=${data.effective_n}·confidence=${data.confidence}）`,
        `  reason: ${data.reason}`,
        `  5h=${fmtPct(data.window_5h_pct)} 7d=${fmtPct(data.window_7d_pct)} hard_stop_7d=${data.hard_stop_7d}`,
      ];
      if (data.levers.length) lines.push(`  levers: ${data.levers.join(', ')}`);
      if (switchCandidate) lines.push(`  switch_candidate: ${switchCandidate}`);
      if (!data.available)
        lines.push('  （账户权威信号不可用·source=local-derived-approx·pacing 降级）');
      return `${lines.join('\n')}\n`;
    },
  });
}

function sevenDayPctOrInf(a: BackupAccount): number {
  return typeof a.seven_day.used_pct === 'number' ? a.seven_day.used_pct : Number.POSITIVE_INFINITY;
}

// ── usage task-cost ──────────────────────────────────────────────────────────────
//   单/聚合任务 token（读 board observability·shell=N/A·coverage_pct·--group-by）。
//   单任务：[<task-id>] positional；聚合：--group-by task|executor|type|tier。
export function taskCost(ctx: Ctx): number {
  return runRead(ctx, {
    render: (board, c) => {
      const b = board as BoardArg;
      const records = extractDoneRecords(b);
      const taskId = c.positionals[0];
      const groupBy = (c.values['group-by'] as string) || 'task';

      // 全 board 任务（含非 done·读 observability·shell/无 token=N/A）——用 raw tasks 才能标 N/A vs 缺。
      const tasks: Array<Record<string, unknown>> = Array.isArray(b?.tasks)
        ? (b.tasks as Array<Record<string, unknown>>)
        : [];

      // 提取每任务 token（input+output·缺/shell → null）。
      const rows = tasks.map((t) => {
        const id = typeof t.id === 'string' ? t.id : '';
        const executor = typeof t.executor === 'string' ? t.executor : '';
        const type = typeof t.type === 'string' ? t.type : '';
        const tier = typeof t.tier === 'string' ? t.tier : '';
        const obs =
          t.observability && typeof t.observability === 'object'
            ? (t.observability as { tokens?: { input?: unknown; output?: unknown } })
            : null;
        const tok = obs?.tokens && typeof obs.tokens === 'object' ? obs.tokens : null;
        const tin = tok && typeof tok.input === 'number' ? tok.input : null;
        const tout = tok && typeof tok.output === 'number' ? tok.output : null;
        const total = tin == null && tout == null ? null : (tin ?? 0) + (tout ?? 0);
        // executor=shell（历史枚举·v2 已无，但旧板可能有）/ 无 token → N/A（诚实标注）。
        const isNA = total == null;
        return { id, executor, type, tier, tokens_in: tin, tokens_out: tout, total, na: isNA };
      });

      const covered = rows.filter((r) => !r.na).length;
      const coveragePct = rows.length > 0 ? Math.round((covered / rows.length) * 100) : 0;

      // 单任务模式。
      if (taskId) {
        const row = rows.find((r) => r.id === taskId);
        const data = {
          task: taskId,
          found: !!row,
          tokens: row ? { input: row.tokens_in, output: row.tokens_out, total: row.total } : null,
          na: row ? row.na : true,
          source: 'observability' as const,
          confidence: row && !row.na ? 'high' : 'low',
        };
        if (c.flags.json) return JSON.stringify({ ok: true, data });
        if (!row) return `usage task-cost ${taskId}: 任务不存在\n`;
        return row.na
          ? `usage task-cost ${taskId}: N/A（无 observability token·shell 任务或未遥测）\n`
          : `usage task-cost ${taskId}: total=${row.total} (in=${row.tokens_in}, out=${row.tokens_out})·source=observability\n`;
      }

      // 聚合模式（--group-by）。
      const groups = new Map<string, { sum: number; n: number; na: number }>();
      const keyOf = (r: (typeof rows)[number]): string => {
        if (groupBy === 'executor') return r.executor || '(none)';
        if (groupBy === 'type') return r.type || '(none)';
        if (groupBy === 'tier') return r.tier || '(none)';
        return r.id;
      };
      for (const r of rows) {
        const k = keyOf(r);
        const g = groups.get(k) || { sum: 0, n: 0, na: 0 };
        g.n += 1;
        if (r.na) g.na += 1;
        else g.sum += r.total as number;
        groups.set(k, g);
      }
      const grouped = [...groups.entries()]
        .map(([key, g]) => ({ key, total: g.sum, n: g.n, na_count: g.na }))
        .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));

      const data = {
        group_by: groupBy,
        groups: grouped,
        total: grouped.reduce((s, g) => s + g.total, 0),
        coverage_pct: coveragePct,
        history_n: records.length,
        source: 'observability' as const,
        confidence: coveragePct >= 50 ? 'medium' : 'low',
      };
      if (c.flags.json) return JSON.stringify({ ok: true, data });
      const lines = [
        `usage task-cost（group-by=${groupBy}·coverage_pct=${coveragePct}%·total=${data.total} tok）`,
      ];
      for (const g of grouped) {
        const naTag = g.na_count > 0 ? `·${g.na_count} N/A` : '';
        lines.push(`  ${g.key}: ${g.total} tok (${g.n} tasks${naTag})`);
      }
      if (coveragePct < 50)
        lines.push('  （coverage<50%·token 遥测稀疏·聚合仅供参考·confidence=low）');
      return `${lines.join('\n')}\n`;
    },
  });
}
