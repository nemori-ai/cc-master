// agent-probe.ts — Agent Registry 活性探测（S2）。按 handle 类型分级实证 agent 是否还在跑。
//
// 纯 CLI-side（不进 engine：engine 是纯函数、不碰 fs/process；探测本质要 stat 文件 mtime / kill -0 进程）。
// 保真红线：拿不到就 observed=unknown，**绝不用相邻字段推导补齐**。
//
// 探测手段按 handle.kind × harness 分级：
//   · pid                    → process.kill(pid, 0) 存活判定（alive / gone / unknown）。
//   · session-id             → 会话落盘根来自 harness adapter 的 `sessionStoreRoots(env)`（PathResolver SSOT·
//     不再手写 ~/.codex / ~/.claude 平行实现）；匹配策略按 harness 表驱动（claude-code 走
//     projects/<slug>/<sid>.jsonl 目标寻址，其余 harness 走递归 walk + 文件名边界精确匹配）。
//     adapter 无 session 根（如 origin / 未知 harness）→ 如实 method=none。
//   · task-id / subagent     → transcript_ref 路径存在则 mtime，否则 unknown。
//   · 其余 / none             → method=none, observed=unknown。
//
// observed 语义：alive（进程活 / 文件 mtime 在 freshness 窗内）· silent（文件在但 mtime 陈旧）·
//   gone（确定性判死：pid kill-0 ESRCH，或 **seen-before**——上一次同方法观测到 alive/silent、本次完整
//   扫描确认文件消失：「曾在而消失」= 真死亡证据）· unknown（无可探测句柄 / 无已知落盘路径 /
//   **从未见过**的会话·transcript 文件不存在——启动竞态下文件可能尚未写出，不判死；扫描不完整
//   〔预算耗尽 / readdir·stat 失败〕同样不判死）。
//
// 会话根目录经 harness adapter 解析（CODEX_HOME / CLAUDE_CONFIG_DIR 等 env 覆写由 adapter 契约承接）；
//   测试注入口保留：opts.home 桥接为 env.HOME（adapter 的 homeBase 契约读 env.HOME 优先）。

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveHarnessAdapter } from './harnesses/registry.js';

export interface ProbeInput {
  harness?: string; // agentHarness
  handleKind?: string; // agentHandleKind
  handleValue?: string;
  transcriptRef?: string | null;
  type?: string; // agentType（subagent 走 transcript 分支）
  prevMethod?: string; // 上一次 probe 的 method（seen-before 判死用·来自 agent.probe.method）
  prevObserved?: string; // 上一次 probe 的 observed（seen-before 判死用·来自 agent.probe.observed）
}

export interface ProbeResult {
  method: string; // agentProbeMethod
  observed: string; // agentObserved
}

export interface ProbeOpts {
  env?: Record<string, string | undefined>;
  home?: string; // os home 覆写（测试用·桥接为 env.HOME 喂 adapter）
  nowMs?: number; // 当前时刻（测试可注入固定时钟）
  freshnessSec?: number; // mtime 判活窗口秒（默认 300）
  // 进程存活探针（测试可注入，默认 process.kill）。返回 'alive' | 'gone' | 'unknown'。
  pidProbe?: (pid: number) => 'alive' | 'gone' | 'unknown';
  // 单次 probe 调用内的目录扫描 memo（同 handler 一次全量 probe 传同一 Map：N 个 session-id agent
  //   共享一趟目录遍历，而非 N 次全树 readdir——board lock 内的效率约束）。
  dirCache?: Map<string, unknown>;
}

const DEFAULT_FRESHNESS_SEC = 300;

// pid 存活：kill(pid,0) 成功或 EPERM（存在但无权）→ alive；ESRCH → gone；其余 → unknown。
//   注意：EPERM-alive 只用于维持 running——它不验证进程身份（pid 复用假 alive），不够格复活 orphaned
//   （证据强度闸在 reconcileAgentState：pid 类 alive 不解开 orphaned 棘轮）。
function defaultPidProbe(pid: number): 'alive' | 'gone' | 'unknown' {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return 'alive';
    if (code === 'ESRCH') return 'gone';
    return 'unknown';
  }
}

// ── 会话文件扫描（roots 来自 harness adapter·结果带完整性标记）───────────────────────────────────────
//   complete=false（预算耗尽 / readdir·stat 失败）时「没找到」不可作「曾在而消失」的判死证据。

interface SessionScan {
  mtimeMs: number | null;
  complete: boolean;
}

interface WalkFile {
  base: string; // 文件名去掉 .json/.jsonl 后缀
  mtimeMs: number; // 遍历时一次 stat（索引经 dirCache memo·匹配阶段零 fs 调用）
  full: string; // 绝对路径（transcript 定位复用同一索引取文件路径）
}

interface WalkIndex {
  files: WalkFile[];
  complete: boolean;
}

const WALK_BUDGET = 20000; // 目录条目预算上限（防病态大树·保真：预算耗尽即 complete=false，不猜）

function stripSessionExt(name: string): string | null {
  if (name.endsWith('.jsonl')) return name.slice(0, -'.jsonl'.length);
  if (name.endsWith('.json')) return name.slice(0, -'.json'.length);
  return null;
}

// 递归收集 root 下全部 *.json(l) 文件（一次遍历建索引·经 dirCache memo 供多个 sid 复用）。
function walkSessionRoot(root: string, cache?: Map<string, unknown>): WalkIndex {
  const key = `walk:${root}`;
  const hit = cache?.get(key);
  if (hit) return hit as WalkIndex;
  const files: WalkFile[] = [];
  let complete = true;
  if (existsSync(root)) {
    const stack: string[] = [root];
    let budget = WALK_BUDGET;
    while (stack.length > 0) {
      if (budget <= 0) {
        complete = false;
        break;
      }
      const dir = stack.pop() as string;
      let entries: import('node:fs').Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        complete = false;
        continue;
      }
      for (const ent of entries) {
        budget--;
        if (budget <= 0) {
          complete = false;
          break;
        }
        const full = join(dir, ent.name);
        if (ent.isDirectory()) {
          stack.push(full);
        } else if (ent.isFile()) {
          const base = stripSessionExt(ent.name);
          if (base !== null) {
            try {
              files.push({ base, mtimeMs: statSync(full).mtimeMs, full });
            } catch {
              complete = false; // stat 失败：该文件「没拿到」——不可作消失证据
            }
          }
        }
      }
    }
  }
  const idx: WalkIndex = { files, complete };
  cache?.set(key, idx);
  return idx;
}

// 文件名边界精确匹配（非裸 includes——短 sid 子串会误命中他人 session 取到假 alive）：
//   base === sid（<sid>.jsonl）或 base 以 `-<sid>` 结尾（rollout-<ts>-<sid>.jsonl 的结尾精确段）。
function baseMatchesSid(base: string, sid: string): boolean {
  return base === sid || base.endsWith(`-${sid}`);
}

type SessionScanner = (roots: string[], sid: string, cache?: Map<string, unknown>) => SessionScan;

// 通用策略：递归 walk 索引 + 边界匹配，多命中取最新 mtime（匹配阶段纯内存·索引已含 mtime）。
const scanWalkRoots: SessionScanner = (roots, sid, cache) => {
  let best: number | null = null;
  let complete = true;
  for (const root of roots) {
    const idx = walkSessionRoot(root, cache);
    if (!idx.complete) complete = false;
    for (const f of idx.files) {
      if (!baseMatchesSid(f.base, sid)) continue;
      if (best === null || f.mtimeMs > best) best = f.mtimeMs;
    }
  }
  return { mtimeMs: best, complete };
};

// claude-code 策略：projects/<slug>/<sid>.jsonl 目标寻址（projects 树可能很大·不做全树 walk）。
//   slug 目录清单经 dirCache memo（`slugs:<root>`），每个 sid 只做 O(slugs) 次 existsSync。
const scanClaudeRoots: SessionScanner = (roots, sid, cache) => {
  let best: number | null = null;
  let complete = true;
  for (const root of roots) {
    const key = `slugs:${root}`;
    let idx = cache?.get(key) as { slugs: string[]; complete: boolean } | undefined;
    if (!idx) {
      let slugs: string[] = [];
      let ok = true;
      if (existsSync(root)) {
        try {
          slugs = readdirSync(root, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
        } catch {
          ok = false;
        }
      }
      idx = { slugs, complete: ok };
      cache?.set(key, idx);
    }
    if (!idx.complete) complete = false;
    for (const slug of idx.slugs) {
      const candidate = join(root, slug, `${sid}.jsonl`);
      if (!existsSync(candidate)) continue;
      try {
        const m = statSync(candidate).mtimeMs;
        if (best === null || m > best) best = m;
      } catch {
        complete = false;
      }
    }
  }
  return { mtimeMs: best, complete };
};

// 匹配策略表（roots 一律来自 adapter；只有匹配文件名的方式按 harness 特化）。
const SESSION_SCANNERS: Record<string, SessionScanner> = {
  'claude-code': scanClaudeRoots,
};

// 会话根来自 harness adapter 的 sessionStoreRoots（PathResolver SSOT）；opts.home 桥接为 env.HOME
//   保留测试注入口（adapter 的 homeBase 契约：env.HOME 优先于 os.homedir()）。
//   未知 harness（如 origin / cursor-agent）→ generic adapter → 空 roots → 调用方如实 method=none。
function sessionRootsFor(harness: string, opts: ProbeOpts): string[] {
  const env: Record<string, string | undefined> = { ...(opts.env || {}) };
  if (opts.home && !env.HOME) env.HOME = opts.home;
  try {
    return resolveHarnessAdapter({ harnessFlag: harness, env }).sessionStoreRoots(env);
  } catch {
    return []; // adapter 解析失败：保真降级为「无已知落盘路径」
  }
}

// seen-before 判定：上一次 probe 用同一 mtime 类方法观测到过 alive/silent → 文件「曾在」。
function seenBefore(input: ProbeInput, method: string): boolean {
  return (
    input.prevMethod === method &&
    (input.prevObserved === 'alive' || input.prevObserved === 'silent')
  );
}

function mtimeToObserved(
  scan: SessionScan,
  nowMs: number,
  freshnessSec: number,
  wasSeen: boolean,
): string {
  if (scan.mtimeMs === null) {
    // 「从未见过文件」≠「曾在而消失」：前者可能是启动竞态（尚未写出）→ unknown 不判死；
    //   后者（上次同方法观测 alive/silent + 本次**完整**扫描确认缺失）= 真死亡证据 → gone。
    //   扫描不完整（预算耗尽 / fs 失败）一律 unknown——拿不到不猜。
    return scan.complete && wasSeen ? 'gone' : 'unknown';
  }
  return nowMs - scan.mtimeMs <= freshnessSec * 1000 ? 'alive' : 'silent';
}

// probeAgent — 主入口：吃一条 agent 的探测输入，出 {method, observed}。纯观测，不改状态（reconcile 在 handler）。
export function probeAgent(input: ProbeInput, opts: ProbeOpts = {}): ProbeResult {
  const nowMs = opts.nowMs ?? Date.now();
  const freshnessSec = opts.freshnessSec ?? DEFAULT_FRESHNESS_SEC;
  const pidProbe = opts.pidProbe || defaultPidProbe;
  const kind = input.handleKind;
  const value = (input.handleValue || '').trim();

  // pid：进程存活。
  if (kind === 'pid') {
    if (!value || !/^\d+$/.test(value)) return { method: 'pid', observed: 'unknown' };
    return { method: 'pid', observed: pidProbe(Number(value)) };
  }

  // session-id：会话根来自 harness adapter，匹配策略表驱动。
  if (kind === 'session-id') {
    if (!value || !input.harness) return { method: 'none', observed: 'unknown' };
    const roots = sessionRootsFor(input.harness, opts);
    // adapter 无 session 根（origin / 未知 harness）→ 保真 unknown（不猜路径）。
    if (roots.length === 0) return { method: 'none', observed: 'unknown' };
    const scanner = SESSION_SCANNERS[input.harness] ?? scanWalkRoots;
    const scan = scanner(roots, value, opts.dirCache);
    return {
      method: 'session-file-mtime',
      observed: mtimeToObserved(scan, nowMs, freshnessSec, seenBefore(input, 'session-file-mtime')),
    };
  }

  // task-id / subagent：有 transcript_ref 路径则 mtime，否则 unknown。
  if (kind === 'task-id' || input.type === 'subagent') {
    const ref = (input.transcriptRef || '').trim();
    if (!ref) return { method: 'none', observed: 'unknown' }; // 无 ref → 保真·不推导
    if (existsSync(ref)) {
      try {
        const m = statSync(ref).mtimeMs;
        return {
          method: 'transcript-mtime',
          observed: mtimeToObserved(
            { mtimeMs: m, complete: true },
            nowMs,
            freshnessSec,
            seenBefore(input, 'transcript-mtime'),
          ),
        };
      } catch {
        return { method: 'transcript-mtime', observed: 'unknown' };
      }
    }
    // ref 在但文件缺：曾观测 alive/silent（seen-before）→ gone（曾在而消失）；从未见过 → unknown（可能尚未写出）。
    return {
      method: 'transcript-mtime',
      observed: seenBefore(input, 'transcript-mtime') ? 'gone' : 'unknown',
    };
  }

  // 无可探测句柄（none / 缺失）→ 保真 unknown。
  return { method: 'none', observed: 'unknown' };
}

// ── transcript 文件定位（复用 probe 的会话根解析 + 文件匹配·供实时流增量 tail 用）─────────────
//   与 probeAgent 共享同一套 roots / 匹配规则，避免第二份 ~/.codex ~/.claude 平行实现。
//   保真：拿不到就返回 null（调用方如实降级 source.kind='none'），绝不猜路径。

export interface TranscriptLocation {
  path: string;
  mtimeMs: number;
}

// claude-code：projects/<slug>/<sid>.jsonl 目标寻址（同 scanClaudeRoots 的 slug 策略）。
function locateClaudeTranscript(
  roots: string[],
  sid: string,
  cache?: Map<string, unknown>,
): TranscriptLocation | null {
  let best: TranscriptLocation | null = null;
  for (const root of roots) {
    const key = `slugs:${root}`;
    let idx = cache?.get(key) as { slugs: string[]; complete: boolean } | undefined;
    if (!idx) {
      let slugs: string[] = [];
      let ok = true;
      if (existsSync(root)) {
        try {
          slugs = readdirSync(root, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
        } catch {
          ok = false;
        }
      }
      idx = { slugs, complete: ok };
      cache?.set(key, idx);
    }
    for (const slug of idx.slugs) {
      const candidate = join(root, slug, `${sid}.jsonl`);
      if (!existsSync(candidate)) continue;
      try {
        const m = statSync(candidate).mtimeMs;
        if (best === null || m > best.mtimeMs) best = { path: candidate, mtimeMs: m };
      } catch {
        /* stat 失败：该候选拿不到路径·跳过 */
      }
    }
  }
  return best;
}

// 通用策略：递归 walk 索引 + 文件名边界匹配，多命中取最新 mtime（复用 scanWalkRoots 的索引）。
function locateWalkTranscript(
  roots: string[],
  sid: string,
  cache?: Map<string, unknown>,
): TranscriptLocation | null {
  let best: TranscriptLocation | null = null;
  for (const root of roots) {
    const idx = walkSessionRoot(root, cache);
    for (const f of idx.files) {
      if (!baseMatchesSid(f.base, sid)) continue;
      if (best === null || f.mtimeMs > best.mtimeMs) best = { path: f.full, mtimeMs: f.mtimeMs };
    }
  }
  return best;
}

// locateTranscriptFile — 按 agent handle 解析其 transcript 文件路径（实时流的源定位单点）。
//   优先级：transcript_ref 存在即用 → session-id 经 harness adapter roots + 匹配 → 否则 null。
//
//   信任边界（有意不做路径 allowlist）：transcript_ref 是 board 内容 ⇒ 指向任意本地文件的只读
//   tail。这是正当功能——bg-shell / workflow worker 的日志文件就登记在这里，圈死到 session 目录
//   会杀掉这类用法。防线由外层承担：web-viewer 只绑 127.0.0.1 + bearer token 门 + board 本身是
//   operator 自有文件（能写 board 的人本就能读这台机器上的文件）。此处不再重复鉴权。
export function locateTranscriptFile(
  input: ProbeInput,
  opts: ProbeOpts = {},
): TranscriptLocation | null {
  const ref = (input.transcriptRef || '').trim();
  if (ref && existsSync(ref)) {
    try {
      return { path: ref, mtimeMs: statSync(ref).mtimeMs };
    } catch {
      return null;
    }
  }
  if (input.handleKind === 'session-id' && input.harness) {
    const value = (input.handleValue || '').trim();
    if (!value) return null;
    const roots = sessionRootsFor(input.harness, opts);
    if (roots.length === 0) return null;
    return input.harness === 'claude-code'
      ? locateClaudeTranscript(roots, value, opts.dirCache)
      : locateWalkTranscript(roots, value, opts.dirCache);
  }
  return null;
}

// mtime 类方法（sid/路径内容寻址·身份强）——orphaned 复活的证据强度门槛。
const MTIME_METHODS = new Set(['session-file-mtime', 'transcript-mtime']);

// reconcileAgentState — 观测与登记态冲突时以观测为准（双向 reconcile·M4：只改 agent 自己）。
//   active {starting,running,uncertain}：gone→orphaned · silent→uncertain · alive→running · unknown→不变。
//   orphaned：alive 且 method 为 mtime 类（session-file/transcript·sid 内容寻址、身份强）→ running
//     （证据式恢复）；**pid 类 alive 不复活 orphaned**——kill-0 无法验证进程身份（pid 复用产生假 alive、
//     EPERM 也被判 alive），证据强度不够解开棘轮（uncertain + pid alive 仍可回 running——uncertain 非死态）。
//   terminal：唯一终态，probe 永不复活（收口是显式动作）。
export function reconcileAgentState(state: string, observed: string, method?: string): string {
  if (state === 'terminal') return state;
  if (state === 'orphaned') {
    return observed === 'alive' && MTIME_METHODS.has(method ?? '') ? 'running' : state;
  }
  if (state !== 'starting' && state !== 'running' && state !== 'uncertain') return state;
  switch (observed) {
    case 'gone':
      return 'orphaned';
    case 'silent':
      return 'uncertain';
    case 'alive':
      return 'running';
    default:
      return state; // unknown：保真·不改
  }
}
