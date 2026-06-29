// handlers/peers.ts — peers noun handler（list·COORD 多 orchestrator 感知通道·设计稿 §3.2）。
//
// peers = 跨板只读花名册（charter ① 异步并行多线程 + ⑤ 资源下最大化效率·多 orchestrator 协调感知层）：
//   · list → runRead：扫 <home>/boards/ 全体 active + 心跳新鲜板 → 各自 coordination + goal + owner + liveness
//     聚成一张花名册（每 peer：goal / workload(current+planned) / priority / liveness）。
//
// 硬不变式（设计稿 §10）：**peers 纯只读跨板** = query/compute，零写、不抢 board-lock、不落状态。
//   走 runRead（绝不 runWrite）；**绝不写任何板**（只读 owner.active/heartbeat/coordination·投影花名册）。
//   花名册 token-blind：只投影 goal / priority / workload / state% / liveness——**无任何 secret / token**。
//
// fail-safe（设计稿 §10）：home 不存在 / 无活板 → 空花名册（count:0·exit 0·不报错·退单板 pacing）。
//   coordination 缺 / 字段缺 → 该 peer 对应维度降级（current/planned=null）·仍计入花名册（活+新鲜即在册）。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib（消费 @ccm/engine buildPeerRoster + loadHomeBoards）。
// 红线2：coordination 是 ✎ agent-shaped（hook 不读·非窄腰）——本 handler 只读派生花名册、永不回写。
// 武装闸豁免：纯 handler 模块（无 hook 入口）。

import { buildPeerRoster, loadHomeBoards, PEER_FRESHNESS_SEC, type PeerEntry } from '@ccm/engine';
import * as discover from '../discover.js';
import { type Ctx, runRead } from './_common.js';

// ── peers list ──────────────────────────────────────────────────────────────
//   扫 <home>/boards/ 全体活+新鲜板 → 花名册。--freshness-sec 覆写心跳判活窗口（默认 600）。
//   无 active board 自身也能跑（号池/感知是用户级·跨板）——自定义 resolve 兜空板，避免无板 exit 5（同 usage）。
export function list(ctx: Ctx): number {
  return runRead(ctx, {
    resolve: () => ({ boardPath: '', board: {} }),
    render: (_b, c) => {
      const homeFlag = c.values.home as string | undefined;
      // 心跳判活窗口：--freshness-sec 正整数覆写，否则引擎默认 600s。
      const fsFlag = c.values['freshness-sec'];
      const freshnessSec =
        typeof fsFlag === 'string' && Number.isInteger(Number(fsFlag)) && Number(fsFlag) >= 1
          ? Number(fsFlag)
          : PEER_FRESHNESS_SEC;

      // 读 home/boards/ 全部板（layout-agnostic·loadHomeBoards 读给定目录·坏 JSON 跳过·绝不抛）。
      //   maxDaysAgo:Infinity → 不按板时戳裁（active 板靠 heartbeat 判活·非 recency；防极端把活板裁掉）。
      let boards: Array<{ file: string; board: unknown }> = [];
      try {
        const home = discover.resolveHome({ homeFlag, env: c.env });
        boards = loadHomeBoards(discover.boardsDir(home), { maxDaysAgo: Number.POSITIVE_INFINITY });
      } catch {
        boards = []; // home 解不出 / 不可读 → 空花名册（fail-safe·退单板）
      }

      const roster = buildPeerRoster(boards, { freshnessSec });

      if (c.flags.json) return JSON.stringify({ ok: true, data: roster });

      const lines: string[] = [];
      lines.push(
        `peers（活+心跳新鲜 orchestrator·M=${roster.count}·freshness=${roster.freshness_sec}s·as_of=${roster.as_of}）`,
      );
      if (roster.count === 0) {
        lines.push('  （无活+新鲜 peer·单板 pacing·M=1 退化）');
        return `${lines.join('\n')}\n`;
      }
      for (const p of roster.peers) {
        lines.push(
          `  [${p.priority}] ${fmtGoal(p.goal)}（hb 距今 ${fmtAge(p.heartbeat_age_sec)}）`,
        );
        const sub = fmtState(p);
        if (sub) lines.push(`      ${sub}`);
      }
      return `${lines.join('\n')}\n`;
    },
  });
}

// fmtGoal(goal) → 截断到 56 字符的人类可读 goal（空 → 占位）。
function fmtGoal(goal: string): string {
  if (!goal) return '(无 goal)';
  return goal.length > 56 ? `${goal.slice(0, 56)}…` : goal;
}

// fmtAge(sec) → "Ns" / "Nm"（心跳年龄人类可读）。
function fmtAge(sec: number | null): string {
  if (sec == null) return 'N/A';
  if (sec < 90) return `${sec}s`;
  return `${Math.round(sec / 60)}m`;
}

// fmtState(p) → 人类可读 workload/remaining + 数字维度一行（缺维度跳过·全缺 → 空串）。
function fmtState(p: PeerEntry): string {
  const parts: string[] = [];
  if (p.current) {
    if (typeof p.current.active_tasks === 'number') parts.push(`active=${p.current.active_tasks}`);
    if (p.current.workload) parts.push(`烧=${p.current.workload}`);
    if (typeof p.current.burn_contribution === 'number')
      parts.push(`burn≈${p.current.burn_contribution}%`);
  }
  if (p.planned) {
    if (p.planned.remaining_work) parts.push(`剩=${p.planned.remaining_work}`);
    if (typeof p.planned.cost_to_complete_pct === 'number')
      parts.push(`ctc≈${p.planned.cost_to_complete_pct}%`);
  }
  return parts.join(' · ');
}
