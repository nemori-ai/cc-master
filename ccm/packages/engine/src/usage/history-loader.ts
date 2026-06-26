// history-loader.ts — home 跨板历史语料读取（ADR-015 §2.3·plan §4）。
//
// ML 层的数据底座：读 home 最近 N 块板（current + /stop 归档·保留 tasks·ADR-009）的全部 done tasks，
//   抽成一组扁平 DoneRecord 喂下游（EWMA 校准 / k-NN / conformal / velocity / SLE / task-cost）。
//
// 关键设计（plan §2/§4）：**把「读」与「算」分离**——`loadHomeBoards()` 是唯一碰 fs 的入口（读 home），
//   `extractDoneRecords()` / `applyRecency()` / 多层桶都是**纯函数**（吃 board 对象 / record 数组，零 fs），
//   故算的部分可在测试里直接喂 fixture board 对象、无需真 home。这守住「算法层纯函数可测」（plan §2.6）。
//
// 红线1 / ADR-006：node/JS only，零 npm dep，纯 stdlib（fs + 内建）。
// 红线2：只读 board、永不回写；只取 done 任务的派生特征，不碰 narrow waist 写。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { estimateHours } from '../board-graph-core.js';
import type { TaskLike } from '../board-model.js';
import { ISO_UTC_RE } from '../board-model.js';

// recency / cap 默认（plan §4：防远古数据污染 EWMA·模型速度/估值习惯/代码库会漂）。
export const DEFAULT_MAX_BOARDS = 50;
export const DEFAULT_MAX_DAYS_AGO = 90;

// 一条 done 任务的派生特征（下游统一消费的扁平记录·plan §4「每条 done 记录字段」）。
export interface DoneRecord {
  boardFile: string; // 来源板文件名（调试 / 溯源）
  repo: string; // repo 身份（git.remote/root 或 worktree+branch·喂 repo-match k-NN）
  taskId: string;
  type: string; // taskType（喂 Mondrian / k-NN）
  executor: string; // 执行者（喂 Mondrian / 分层）
  model: string; // model 档（喂 tier 校准 / #34）
  tier: string; // tier 档
  estimateHours: number | null; // 估点折算小时（缺/坏 → null）
  actualHours: number | null; // finished − started（小时·缺锚 → null）
  ratio: number | null; // actual / estimate（两者皆有且 est>0 才有）
  depsCount: number; // deps 数（结构特征·喂 k-NN）
  tokensIn: number | null; // observability.tokens.input（缺 → null·喂 task-cost / coverage）
  tokensOut: number | null;
  finishedAtMs: number | null; // 完成时戳（喂 recency 衰减 / velocity 窗口）
  boardTimeMs: number | null; // 板时戳（owner.heartbeat / meta.created_at·recency fallback）
}

// 解析严格 ISO-8601 UTC → ms epoch 或 null（与 graph-core/lint 同口径）。
function parseTs(v: unknown): number | null {
  if (typeof v !== 'string' || !ISO_UTC_RE.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

// boardRepo(board) → repo 身份字符串。优先 git.worktree（+branch 区分多 worktree），否则 goal 前缀兜底。
//   k-NN 的 repo-match 距离用它（同 repo 权重最高·plan §4）。
export function boardRepo(board: { git?: unknown; goal?: unknown }): string {
  const git = (board && typeof board.git === 'object' ? board.git : {}) as {
    worktree?: unknown;
    branch?: unknown;
    remote?: unknown;
    root?: unknown;
  };
  if (typeof git.remote === 'string' && git.remote) return git.remote;
  if (typeof git.root === 'string' && git.root) return git.root;
  if (typeof git.worktree === 'string' && git.worktree) return git.worktree;
  return typeof board.goal === 'string' ? board.goal.slice(0, 24) : 'unknown';
}

// boardTime(board) → 板的代表时戳 ms（owner.heartbeat 优先·否则 meta.created_at）。recency fallback 用。
function boardTime(board: {
  owner?: { heartbeat?: unknown };
  meta?: { created_at?: unknown };
}): number | null {
  const hb = parseTs(board?.owner?.heartbeat);
  if (hb != null) return hb;
  return parseTs(board?.meta?.created_at);
}

// extractDoneRecords(board, boardFile) → 该板全部 done 任务的 DoneRecord[]（纯函数·零 fs）。
//   board 是已 parse 的对象（坏/非对象 → 空数组，绝不抛）。下游算法的喂料入口。
export function extractDoneRecords(board: unknown, boardFile = ''): DoneRecord[] {
  const b = board as { tasks?: unknown; git?: unknown; goal?: unknown } | null;
  if (!b || typeof b !== 'object' || !Array.isArray(b.tasks)) return [];
  const repo = boardRepo(b);
  const bt = boardTime(b as never);
  const out: DoneRecord[] = [];
  for (const raw of b.tasks) {
    const t = raw as TaskLike;
    if (!t || typeof t !== 'object' || t.status !== 'done') continue;
    const est = estimateHours(t.estimate as never);
    const started = parseTs(t.started_at);
    const finished = parseTs(t.finished_at);
    const actual =
      started != null && finished != null && finished > started
        ? (finished - started) / 3600000
        : null;
    const ratio = est != null && actual != null && est > 0 ? actual / est : null;
    const obs = (t.observability && typeof t.observability === 'object' ? t.observability : {}) as {
      tokens?: { input?: unknown; output?: unknown };
    };
    const tok = obs.tokens && typeof obs.tokens === 'object' ? obs.tokens : null;
    const tokensIn = tok && typeof tok.input === 'number' ? tok.input : null;
    const tokensOut = tok && typeof tok.output === 'number' ? tok.output : null;
    out.push({
      boardFile,
      repo,
      taskId: typeof t.id === 'string' ? t.id : '',
      type: typeof t.type === 'string' ? t.type : '',
      executor: typeof t.executor === 'string' ? t.executor : '',
      model: typeof t.model === 'string' ? t.model : '',
      tier: typeof t.tier === 'string' ? t.tier : '',
      estimateHours: est,
      actualHours: actual,
      ratio,
      depsCount: Array.isArray(t.deps) ? t.deps.length : 0,
      tokensIn,
      tokensOut,
      finishedAtMs: finished,
      boardTimeMs: bt,
    });
  }
  return out;
}

// recencyWeight(record, nowMs, halfLifeDays) → [0,1] 的指数衰减权重（越近越重·plan §4）。
//   按完成时戳（缺则板时戳）算 ageDays，权重 = 0.5^(age/halfLife)。无时戳 → 中性权重 0.5。
export function recencyWeight(record: DoneRecord, nowMs: number, halfLifeDays = 30): number {
  const ts = record.finishedAtMs ?? record.boardTimeMs;
  if (ts == null) return 0.5;
  const ageDays = (nowMs - ts) / 86400000;
  if (ageDays <= 0) return 1;
  return 2 ** (-ageDays / halfLifeDays);
}

// loadHomeBoards(homeDir, opts) → 读 home 下所有 *.board.json（**唯一碰 fs 的函数**）。
//   返回已 parse 的 { file, board } 列表（坏 JSON 跳过·绝不抛）。cap + recency 截断：
//     · 按板时戳降序排，取最近 maxBoards 块；
//     · 丢掉板时戳早于 maxDaysAgo 的（防远古污染）。
//   home 不存在/不可读 → 空列表（冷启动·下游降级 no-history）。
export interface LoadOptions {
  maxBoards?: number;
  maxDaysAgo?: number;
  nowMs?: number;
}
export function loadHomeBoards(
  homeDir: string,
  opts: LoadOptions = {},
): Array<{ file: string; board: unknown }> {
  const maxBoards = opts.maxBoards ?? DEFAULT_MAX_BOARDS;
  const maxDaysAgo = opts.maxDaysAgo ?? DEFAULT_MAX_DAYS_AGO;
  const nowMs = opts.nowMs ?? Date.now();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(homeDir, { withFileTypes: true });
  } catch {
    return []; // home 不存在/不可读 → 冷启动
  }
  const parsed: Array<{ file: string; board: unknown; ts: number }> = [];
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith('.board.json')) continue;
    let board: unknown;
    try {
      board = JSON.parse(fs.readFileSync(path.join(homeDir, ent.name), 'utf8'));
    } catch {
      continue; // 坏板跳过
    }
    const ts = boardTime(board as never) ?? 0;
    parsed.push({ file: ent.name, board, ts });
  }
  // recency 截断 + cap：按板时戳降序，丢远古，取最近 maxBoards。
  const cutoff = nowMs - maxDaysAgo * 86400000;
  return parsed
    .filter((p) => p.ts === 0 || p.ts >= cutoff)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, maxBoards)
    .map((p) => ({ file: p.file, board: p.board }));
}

// loadCorpus(homeDir, opts) → home 全部板的 DoneRecord[]（读 + 抽一步到位·便利包装）。
//   = loadHomeBoards 然后逐板 extractDoneRecords 拍平。下游 usage/estimate 的总入口。
export function loadCorpus(homeDir: string, opts: LoadOptions = {}): DoneRecord[] {
  const boards = loadHomeBoards(homeDir, opts);
  const out: DoneRecord[] = [];
  for (const { file, board } of boards) {
    for (const r of extractDoneRecords(board, file)) out.push(r);
  }
  return out;
}

// ── 多层收缩桶（hierarchical partial pooling·plan §4）─────────────────────────────────────────────
// 同 repo+type+executor+tier → 同 repo+type → 同 type → 全 home，逐层退化。
// poolLayers(records, query) → 按特异性从高到低的层（每层 { key, records }），供校准/k-NN 选「N≥阈值的最具体层」。
export interface PoolQuery {
  repo?: string;
  type?: string;
  executor?: string;
  tier?: string;
}
export interface PoolLayer {
  level: 'repo+type+executor+tier' | 'repo+type' | 'type' | 'home';
  records: DoneRecord[];
}
export function poolLayers(records: DoneRecord[], query: PoolQuery): PoolLayer[] {
  const match = (r: DoneRecord, keys: Array<keyof PoolQuery>): boolean =>
    keys.every((k) => query[k] === undefined || query[k] === '' || (r as never)[k] === query[k]);
  return [
    {
      level: 'repo+type+executor+tier',
      records: records.filter((r) => match(r, ['repo', 'type', 'executor', 'tier'])),
    },
    { level: 'repo+type', records: records.filter((r) => match(r, ['repo', 'type'])) },
    { level: 'type', records: records.filter((r) => match(r, ['type'])) },
    { level: 'home', records: records.slice() },
  ];
}

// selectPoolLayer(records, query, minN, isUsable?) → 选「可用样本数」≥minN 的最具体层（plan §4：每层 N≥3 才用，否则向上退化）。
//   返回 { layer, confidence }——最具体层 → high；次层 → medium；type/home 兜底 → low。
//   `isUsable` 定义一条记录对该消费场景是否「可用」（默认全计）；校准 / 离散度按 **可用 ratio 样本数**
//   而非原始记录数判「够用」——否则最具体层记录虽多但 ratio 全缺时会被误选，错过更宽层里的有效 ratio（codex round-8 P2）。
export function selectPoolLayer(
  records: DoneRecord[],
  query: PoolQuery,
  minN = 3,
  isUsable: (r: DoneRecord) => boolean = () => true,
): { layer: PoolLayer; confidence: 'high' | 'medium' | 'low' } {
  const layers = poolLayers(records, query);
  const usableCount = (layer: PoolLayer): number =>
    layer.records.reduce((n, r) => n + (isUsable(r) ? 1 : 0), 0);
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (layer && usableCount(layer) >= minN) {
      const confidence = i === 0 ? 'high' : i === 1 ? 'medium' : 'low';
      return { layer, confidence };
    }
  }
  // 全都不足 minN → 退最宽的 home 层 + low（可能仍空·调用方据此降级 no-history）。
  const home = layers[layers.length - 1] as PoolLayer;
  return { layer: home, confidence: 'low' };
}
