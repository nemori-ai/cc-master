// board-reconcile.ts — deps 驱动的 ready↔blocked 门控归一化（ADR-023·Model 1）。
//
// reconcileGating(board) → 新 board（纯函数·structuredClone 后改·绝不 alias 入参·与 mutations.ts 同纪律）：
//   把每个「无语义阻塞（blocked_on 空）且 status ∈ {ready, blocked}」的 task 按 deps 完成度归一——
//   deps 全 done → ready，否则 → blocked。**有 blocked_on 的整体豁免**（语义阻塞：等 "user" / 等某 task，
//   即便 deps 满足也不自动翻——它在等的是人 / 另一件事，不是拓扑就绪）。其余状态
//   （in_flight/done/failed/escalated/stale/uncertain）一律不碰。
//
// 一趟全板 O(V+E)、幂等（同一板重复跑结果稳定）、**不产生新 done（无级联）**——deps 完成度按「入参板的
//   done 快照」评估（reconcile 绝不写 done → 快照稳定 → 单趟即幂等、与遍历顺序无关）。
//
// 复用 analyzeGraph（predecessors 邻接·readySet SSOT·排除 dangling/self-loop）+ isDoneStatus（done 口径），
//   保证「reconcile 判就绪」与「board-graph-core.readySet 判就绪」零漂移（同一条 deps.every(isDone) 判据）。
//
// 接入落点：apps/cli 的写入关卡 runWrite 在 mutate 之后、lint 之前跑一趟——所有写 verb 自动获得归一化，
//   CLI 写路径永不产生「ready 但 deps 未全 done」/「blocked 无 blocked_on 但 deps 全 done」的不一致态
//   （BIZ-STATUS-DEPS lint warn 兜手改 board 造出的这类不一致）。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖，纯 stdlib（structuredClone 是 node 全局）。
// 红线2：只碰 task.status（✎ 域·非窄腰 hook-read 语义），deps/blocked_on 只读不写——不动窄腰协议。

import { analyzeGraph } from './board-graph-core.js';
import { isDoneStatus } from './board-model.js';

// 受门控归一的状态集（ready/blocked 两态才自动翻；其余态豁免）。
const GATED = new Set(['ready', 'blocked']);

// 语义阻塞：blocked_on 是非空字符串（等 "user" 或某 task id）→ 该 task 整体豁免自动门控。
function hasSemanticBlock(t: { blocked_on?: unknown }): boolean {
  return typeof t.blocked_on === 'string' && t.blocked_on !== '';
}

export function reconcileGating<T>(board: T): T {
  if (!board || typeof board !== 'object' || Array.isArray(board)) return board;
  const src = board as { tasks?: unknown };
  if (!Array.isArray(src.tasks)) return board; // 无 tasks（如 init 空板）→ 原样返回。

  const b = structuredClone(board) as unknown as { tasks: Array<Record<string, unknown>> };
  const g = analyzeGraph(b); // 建图（clone 上）：g.taskById / predecessors 指向 clone 的 task 对象。

  // done 快照（按入参态）：reconcile 绝不产生新 done → 快照稳定 → 遍历顺序无关、单趟即幂等。
  const doneIds = new Set<string>();
  for (const t of b.tasks) {
    if (t && typeof t === 'object' && typeof t.id === 'string' && isDoneStatus(t.status)) {
      doneIds.add(t.id);
    }
  }

  for (const t of b.tasks) {
    if (!t || typeof t !== 'object' || typeof t.id !== 'string') continue;
    if (!GATED.has(t.status as string)) continue; // 只归一 ready/blocked，其余态豁免。
    if (hasSemanticBlock(t)) continue; // 语义阻塞（blocked_on 非空）豁免，deps 满足也不翻。
    const deps = g.predecessors(t.id); // 规范上游（排除 dangling/self-loop·同 readySet 口径）。
    t.status = deps.every((d) => doneIds.has(d)) ? 'ready' : 'blocked';
  }
  return b as T;
}
