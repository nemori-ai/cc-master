// coordination/peers.ts — 多 orchestrator 感知通道：跨板只读花名册（COORD·设计稿 §3.2）。
//
// COORD 的「读侧」：M 个 orchestrator 并行抽同一活跃配额缸，各自孤立 pacing 会公地悲剧——感知通道让每个
//   orchestrator 看见全体 peer 的 goal / workload / priority / 死活，喂价值感知的**独立**自我配速
//   （不必双向协商即可单方面合理让路 / 认领 slack）。通信通道已砍（设计稿 §4 墓碑）——这里只有只读感知。
//
// 关键设计（同 history-loader「读/算分离」）：**把「读 home」与「算花名册」分离**——
//   `buildPeerRoster(boards, opts)` 是**纯函数**（吃已 parse 的 {file, board} 列表 → 投影花名册，零 fs），
//   故可在测试里直接喂 fixture board 对象、无需真 home。CLI handler 负责碰 fs（经引擎 loadHomeBoards 读 home）。
//
// liveness（设计稿 §10）：peer = owner.active===true 且 owner.heartbeat **新鲜**（距 now < freshnessSec）。
//   心跳过期板不计入花名册、不占 M（死 orchestrator 不永久占额）。freshnessSec 默认 600s（10min）——
//   与 bootstrap-board.sh 的 FRESHNESS_THRESHOLD_SECS=600「possibly still live」判活窗口同口径（活 session
//   每回合 flush heartbeat·ADR-009）。无 heartbeat / 非 ISO → 视为不新鲜（保守·不计入·fail-safe 退单板）。
//
// 红线1 / ADR-006：node/JS only，零 npm dep，纯 stdlib。
// 红线2：coordination 是 ✎ agent-shaped（hook 不读·非窄腰）——本模块只**读** board 派生花名册，永不回写。
// 红线（token-blind）：花名册只投影 goal / priority / workload / state% / liveness——**无任何 secret / token**。

import { ISO_UTC_RE, isEnumMember } from '../board-model.js';

// peer 心跳判活窗口（秒）。与 bootstrap-board.sh FRESHNESS_THRESHOLD_SECS=600 同口径（设计稿 §10 liveness）。
export const PEER_FRESHNESS_SEC = 600;

// 解析严格 ISO-8601 UTC → ms epoch 或 null（与 history-loader / lint 同口径）。
function parseISOms(v: unknown): number | null {
  if (typeof v !== 'string' || !ISO_UTC_RE.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

// 一个 peer 的当前时态投影（coordination.state.current·设计稿 §3.1）。
export interface PeerCurrent {
  active_tasks: number | null; // 当前在飞任务数（数字喂机械 fair-share）
  workload: string | null; // 人类可读：此刻在烧什么（喂 peer 价值推理）
  burn_contribution: number | null; // 对聚合配额% burn 的估计贡献（%-burn 增量）
}

// 一个 peer 的规划时态投影（coordination.state.planned·设计稿 §3.1）。
export interface PeerPlanned {
  remaining_work: string | null; // 人类可读：还剩多少活（喂价值/紧迫推理）
  cost_to_complete_pct: number | null; // %-cost-to-complete（偿付力·喂让路推理）
}

// 花名册一行（一个活+新鲜 peer 的只读快照）。token-blind：无任何 secret。
export interface PeerEntry {
  board_file: string; // 来源板文件名（溯源·调试）
  goal: string; // 人类可读 goal（从 board.goal 取·喂相对价值推理）
  harness: string; // owner.harness；缺/坏 → unknown（配额池分区键·不参与武装闸）
  priority: string; // 板级优先级（coordination.priority·缺省解析为 normal）
  session_id: string; // owner.session_id（哪个 session 在跑·"" = 未认领活板）
  heartbeat: string | null; // owner.heartbeat（ISO·新鲜度锚）
  heartbeat_age_sec: number | null; // 距 now 的心跳年龄（秒·null = 无可解析心跳）
  current: PeerCurrent | null; // coordination.state.current 投影（缺→null·降级）
  planned: PeerPlanned | null; // coordination.state.planned 投影（缺→null·降级）
}

export interface PeerPool {
  pool_id: string; // known harness: harness id; unknown boards: unknown:<board_file>
  harness: string; // claude-code | codex | cursor | unknown
  peers: PeerEntry[];
  count: number;
}

// 花名册聚合结果。
export interface PeerRoster {
  peers: PeerEntry[]; // 活+新鲜 peer（按 priority 降序、再按 heartbeat 新→旧稳定排）
  pools: PeerPool[]; // 按 harness 分区后的竞争池；unknown 每板单例池
  count: number; // = peers.length（M·头部数 active 板·喂 headroom/M 防过冲·设计稿 §8）
  freshness_sec: number; // 本次判活用的心跳窗口（回显·透明）
  as_of: string; // 判活基准时刻（ISO·now）
}

// numOrNull(v) → v 是数字则原样、否则 null（降级·缺/坏字段不污染花名册）。
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
// strOrNull(v) → v 是字符串则原样、否则 null。
function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

// projectCurrent(co) → coordination.state.current 投影（缺/坏 → null·全字段 optional·缺即降级）。
function projectCurrent(state: Record<string, unknown> | null): PeerCurrent | null {
  const cur =
    state && typeof state.current === 'object' && !Array.isArray(state.current) && state.current
      ? (state.current as Record<string, unknown>)
      : null;
  if (!cur) return null;
  return {
    active_tasks: numOrNull(cur.active_tasks),
    workload: strOrNull(cur.workload),
    burn_contribution: numOrNull(cur.burn_contribution),
  };
}

// projectPlanned(state) → coordination.state.planned 投影（缺/坏 → null）。
function projectPlanned(state: Record<string, unknown> | null): PeerPlanned | null {
  const pl =
    state && typeof state.planned === 'object' && !Array.isArray(state.planned) && state.planned
      ? (state.planned as Record<string, unknown>)
      : null;
  if (!pl) return null;
  return {
    remaining_work: strOrNull(pl.remaining_work),
    cost_to_complete_pct: numOrNull(pl.cost_to_complete_pct),
  };
}

// priorityRank(p) → 板级优先级排序权重（小=更优先·urgent 最前）。未知/缺 → normal 的秩（设计稿 §5 默认 normal）。
const _PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
  trivial: 4,
};
function priorityRank(p: string): number {
  return _PRIORITY_RANK[p] ?? _PRIORITY_RANK.normal ?? 2;
}

function harnessOf(owner: Record<string, unknown>, boardFile: string): { harness: string; poolId: string } {
  const raw = owner.harness;
  const harness = isEnumMember('harness', raw) ? (raw as string) : 'unknown';
  // Missing or bad harness is conservative: never mix it with known pools or other unknown boards.
  const poolId = harness === 'unknown' ? `unknown:${boardFile}` : harness;
  return { harness, poolId };
}

export interface RosterOptions {
  nowMs?: number; // 判活基准（默认 Date.now()）
  freshnessSec?: number; // 心跳判活窗口（默认 PEER_FRESHNESS_SEC=600）
}

// ── buildPeerRoster(boards, opts) → PeerRoster（纯函数·零 fs·设计稿 §3.2）────────────────────────────
//   boards = 已 parse 的 {file, board} 列表（由 CLI handler 经 loadHomeBoards 喂入）。逐板：
//     ① owner.active===true 且 ② owner.heartbeat 新鲜（距 now < freshnessSec）→ 计入花名册。
//   priority 缺/坏 → 解析为 normal（设计稿 §5）；coordination.state.current/planned 缺 → null（降级）。
//   排序：priority 降序（urgent→trivial）→ heartbeat 新→旧（稳定·让最活跃高优 peer 排前）。
//   坏板（board 非对象 / owner 非对象）→ 跳过（防御·绝不抛）。
export function buildPeerRoster(
  boards: Array<{ file: string; board: unknown }>,
  opts: RosterOptions = {},
): PeerRoster {
  const nowMs = opts.nowMs ?? Date.now();
  const freshnessSec = opts.freshnessSec ?? PEER_FRESHNESS_SEC;
  const freshnessMs = freshnessSec * 1000;

  const peers: PeerEntry[] = [];
  const poolIds = new Map<PeerEntry, string>();
  for (const { file, board } of boards) {
    if (!board || typeof board !== 'object' || Array.isArray(board)) continue;
    const b = board as Record<string, unknown>;
    const owner =
      b.owner && typeof b.owner === 'object' && !Array.isArray(b.owner)
        ? (b.owner as Record<string, unknown>)
        : null;
    if (!owner || owner.active !== true) continue; // 非 active 板不入花名册（设计稿 §3.2）

    // liveness：heartbeat 新鲜（距 now < freshnessSec）。无心跳 / 非 ISO / 过期 → 不计入（保守·fail-safe）。
    const hbStr = typeof owner.heartbeat === 'string' ? owner.heartbeat : null;
    const hbMs = parseISOms(owner.heartbeat);
    if (hbMs == null) continue; // 无可解析心跳 → 视为不新鲜（不占 M·设计稿 §10）
    const ageMs = nowMs - hbMs;
    // 过期（age ≥ 窗口）→ 死 orchestrator·跳过。未来心跳（age<0）容忍（时钟偏移·算 fresh）。
    if (ageMs >= freshnessMs) continue;

    const co =
      b.coordination && typeof b.coordination === 'object' && !Array.isArray(b.coordination)
        ? (b.coordination as Record<string, unknown>)
        : null;
    const state =
      co && typeof co.state === 'object' && !Array.isArray(co.state) && co.state
        ? (co.state as Record<string, unknown>)
        : null;
    // priority：coordination.priority ∈ coordPriority 枚举则原样、否则解析为 normal（设计稿 §5 默认）。
    const rawPriority = co ? co.priority : undefined;
    const priority = isEnumMember('coordPriority', rawPriority)
      ? (rawPriority as string)
      : 'normal';

    const harness = harnessOf(owner, file);
    const peer: PeerEntry = {
      board_file: file,
      goal: typeof b.goal === 'string' ? b.goal : '',
      harness: harness.harness,
      priority,
      session_id: typeof owner.session_id === 'string' ? owner.session_id : '',
      heartbeat: hbStr,
      heartbeat_age_sec: Math.round(ageMs / 1000),
      current: projectCurrent(state),
      planned: projectPlanned(state),
    };
    peers.push(peer);
    poolIds.set(peer, harness.poolId);
  }

  // 排序：priority 升秩（urgent 先）→ heartbeat 新→旧（age 小先）→ board_file 字典序（稳定 tiebreak）。
  peers.sort((a, b) => {
    const pr = priorityRank(a.priority) - priorityRank(b.priority);
    if (pr !== 0) return pr;
    const ageA = a.heartbeat_age_sec ?? Number.POSITIVE_INFINITY;
    const ageB = b.heartbeat_age_sec ?? Number.POSITIVE_INFINITY;
    if (ageA !== ageB) return ageA - ageB;
    return a.board_file.localeCompare(b.board_file);
  });

  const byPool = new Map<string, { harness: string; peers: PeerEntry[] }>();
  for (const peer of peers) {
    const poolId = poolIds.get(peer) || `unknown:${peer.board_file}`;
    let bucket = byPool.get(poolId);
    if (!bucket) {
      bucket = { harness: peer.harness, peers: [] };
      byPool.set(poolId, bucket);
    }
    bucket.peers.push(peer);
  }
  const pools: PeerPool[] = Array.from(byPool.entries())
    .map(([pool_id, bucket]) => ({
      pool_id,
      harness: bucket.harness,
      peers: bucket.peers,
      count: bucket.peers.length,
    }))
    .sort((a, b) => a.pool_id.localeCompare(b.pool_id));

  return {
    peers,
    pools,
    count: peers.length,
    freshness_sec: freshnessSec,
    as_of: new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}
