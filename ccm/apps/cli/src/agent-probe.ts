// agent-probe.ts — Agent Registry 活性探测（S2）。按 handle 类型分级实证 agent 是否还在跑。
//
// 纯 CLI-side（不进 engine：engine 是纯函数、不碰 fs/process；探测本质要 stat 文件 mtime / kill -0 进程）。
// 保真红线：拿不到就 observed=unknown，**绝不用相邻字段推导补齐**。
//
// 探测手段按 handle.kind × harness 分级：
//   · pid                    → process.kill(pid, 0) 存活判定（alive / gone / unknown）。
//   · session-id (codex)     → ~/.codex/sessions/**/rollout-*-<sid>.json(l) 文件存在性 + mtime。
//   · session-id (claude-code) → ~/.claude/projects/*/<sid>.jsonl 文件存在性 + mtime。
//   · task-id / subagent     → transcript_ref 路径存在则 mtime，否则 unknown。
//   · 其余 / none             → method=none, observed=unknown。
//
// observed 语义：alive（进程活 / 文件 mtime 在 freshness 窗内）· silent（文件在但 mtime 陈旧）·
//   gone（**仅确定性判死**：pid kill-0 ESRCH——进程不存在）· unknown（无可探测句柄 / 无已知落盘路径 /
//   会话·transcript 文件不存在——「从未见过文件」≠「曾在而消失」，启动竞态下文件可能尚未写出，不判死）。
//
// 会话落盘根目录可经 env 覆写（测试注入临时 home）：CODEX_HOME / CLAUDE_CONFIG_DIR，否则回落 os.homedir()。

import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ProbeInput {
  harness?: string; // agentHarness
  handleKind?: string; // agentHandleKind
  handleValue?: string;
  transcriptRef?: string | null;
  type?: string; // agentType（subagent 走 transcript 分支）
}

export interface ProbeResult {
  method: string; // agentProbeMethod
  observed: string; // agentObserved
}

export interface ProbeOpts {
  env?: Record<string, string | undefined>;
  home?: string; // os home 覆写（测试用）
  nowMs?: number; // 当前时刻（测试可注入固定时钟）
  freshnessSec?: number; // mtime 判活窗口秒（默认 300）
  // 进程存活探针（测试可注入，默认 process.kill）。返回 'alive' | 'gone' | 'unknown'。
  pidProbe?: (pid: number) => 'alive' | 'gone' | 'unknown';
}

const DEFAULT_FRESHNESS_SEC = 300;

// pid 存活：kill(pid,0) 成功或 EPERM（存在但无权）→ alive；ESRCH → gone；其余 → unknown。
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

// 递归找一个文件名包含 sid 的 *.json(l) 文件，返回其 mtime(ms)；找不到返回 null。
//   bounded：只走目录，命中即回报最新 mtime（多个匹配取最大）。
function findSessionFileMtime(root: string, sid: string): number | null {
  if (!sid || !existsSync(root)) return null;
  let best: number | null = null;
  const stack: string[] = [root];
  let budget = 20000; // 目录条目预算上限（防病态大树·保真：预算耗尽即当未找到，不猜）
  while (stack.length > 0 && budget > 0) {
    const dir = stack.pop() as string;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      budget--;
      if (budget <= 0) break;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (
        ent.isFile() &&
        ent.name.includes(sid) &&
        (ent.name.endsWith('.json') || ent.name.endsWith('.jsonl'))
      ) {
        try {
          const m = statSync(full).mtimeMs;
          if (best === null || m > best) best = m;
        } catch {
          /* stat 失败：跳过（保真·不猜） */
        }
      }
    }
  }
  return best;
}

function mtimeToObserved(mtimeMs: number | null, nowMs: number, freshnessSec: number): string {
  // 文件不存在 → unknown（不是 gone）：无法区分「尚未写出」（启动竞态·worker 刚起、session 文件未落盘）
  //   和「已清理」——gone 只保留给能确定性判死的方法（pid kill-0 ESRCH）。unknown 保真、不触发降级。
  if (mtimeMs === null) return 'unknown';
  return nowMs - mtimeMs <= freshnessSec * 1000 ? 'alive' : 'silent';
}

function codexSessionsDir(opts: ProbeOpts): string {
  const env = opts.env || {};
  const base = env.CODEX_HOME || join(opts.home || homedir(), '.codex');
  return join(base, 'sessions');
}

function claudeProjectsDir(opts: ProbeOpts): string {
  const env = opts.env || {};
  const base = env.CLAUDE_CONFIG_DIR || join(opts.home || homedir(), '.claude');
  return join(base, 'projects');
}

// claude-code：~/.claude/projects/<slug>/<sid>.jsonl —— 扫 projects 下每个 slug 目录找 <sid>.jsonl。
function findClaudeSessionMtime(projectsDir: string, sid: string): number | null {
  if (!sid || !existsSync(projectsDir)) return null;
  let slugs: import('node:fs').Dirent[];
  try {
    slugs = readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  let best: number | null = null;
  for (const slug of slugs) {
    if (!slug.isDirectory()) continue;
    const candidate = join(projectsDir, slug.name, `${sid}.jsonl`);
    if (existsSync(candidate)) {
      try {
        const m = statSync(candidate).mtimeMs;
        if (best === null || m > best) best = m;
      } catch {
        /* skip */
      }
    }
  }
  return best;
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

  // session-id：按 harness 分流到会话文件 mtime。
  if (kind === 'session-id') {
    if (input.harness === 'codex') {
      const m = findSessionFileMtime(codexSessionsDir(opts), value);
      return { method: 'session-file-mtime', observed: mtimeToObserved(m, nowMs, freshnessSec) };
    }
    if (input.harness === 'claude-code') {
      const m = findClaudeSessionMtime(claudeProjectsDir(opts), value);
      return { method: 'session-file-mtime', observed: mtimeToObserved(m, nowMs, freshnessSec) };
    }
    // 其它 harness 的 session-id 无已知落盘路径 → 保真 unknown（不猜路径）。
    return { method: 'none', observed: 'unknown' };
  }

  // task-id / subagent：有 transcript_ref 路径则 mtime，否则 unknown。
  if (kind === 'task-id' || input.type === 'subagent') {
    const ref = (input.transcriptRef || '').trim();
    if (ref && existsSync(ref)) {
      try {
        const m = statSync(ref).mtimeMs;
        return { method: 'transcript-mtime', observed: mtimeToObserved(m, nowMs, freshnessSec) };
      } catch {
        return { method: 'transcript-mtime', observed: 'unknown' };
      }
    }
    // 有 ref 但文件缺 → unknown（可能尚未写出·mtime 类方法不判死）；无 ref → unknown（保真·不推导）。
    return ref
      ? { method: 'transcript-mtime', observed: 'unknown' }
      : { method: 'none', observed: 'unknown' };
  }

  // 无可探测句柄（none / 缺失）→ 保真 unknown。
  return { method: 'none', observed: 'unknown' };
}

// reconcileAgentState — 观测与登记态冲突时以观测为准（双向 reconcile·M4：只改 agent 自己）。
//   active {starting,running,uncertain}：gone→orphaned · silent→uncertain · alive→running · unknown→不变。
//   orphaned：alive→running（**证据式恢复**——观测即证据；orphaned 可能来自误判死或 pid 复用，见 probe
//     字段的 method/as_of 证据链），其余观测不动（gone/silent/unknown 都不能证明它复活）。
//   terminal：唯一终态，probe 永不复活（收口是显式动作）。
export function reconcileAgentState(state: string, observed: string): string {
  if (state === 'terminal') return state;
  if (state === 'orphaned') return observed === 'alive' ? 'running' : state;
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
