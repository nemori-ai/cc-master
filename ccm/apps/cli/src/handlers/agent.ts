// handlers/agent.ts — Agent Registry noun handler（create / bind / link / terminal / probe / list / show）。
//
// agent = 实际跑起来的运行时实例（runtime 层）·board-scoped 顶层实体（board.agents[] ✎ 段）·与 node 多对多。
//   凡派发皆登记：sub-agent / 后台 shell / workflow / 跨 harness CLI worker 全进同一花名册（各类型探测能力分级）。
//
// 命令面冻结裁定：agent 是**登记/探测/读取 noun**——verbs 不含任何 spawn/route/dispatch 语义（不起进程、
//   不选路、不派活）。所有写经 engine 既有写入关卡（runWrite·带锁 + lint after mutate）。
//
// 状态机（逐字复用 native-attempt 铁律）：starting→running（bind 交真实 handle 证据·无证据拒绝）·
//   running/uncertain→terminal（登记 outcome·terminal ≠ task done·绝不碰 task status）·
//   uncertain→running（probe alive / 再 bind 复活）· probe 观测冲突以观测为准降级。
//
// agent↔task join 存 **agent 侧 links[]**（非 task.routing.attempts[]）：见 create/link 注。
//   probe 只写 agents[] 自己的 probe/lifecycle 字段——绝不碰 task.handle / attempt 投影（那是 native-attempt writer 地盘）。
//
// exit codes：0 OK · 2 USAGE（缺必填 flag·router 层） · 3 VALIDATION（无 handle 证据 / 非法转移 / task 引用不存在） ·
//   4 LOCK · 5 NOT_FOUND（agent id 不存在）。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib。武装闸豁免：纯 handler 模块（无 hook 入口）。

import { isLegalAgentTransition } from '@ccm/engine';
import { probeAgent, reconcileAgentState } from '../agent-probe.js';
import * as mutations from '../mutations.js';
import { type BoardArg, type Ctx, runRead, runWrite } from './_common.js';

interface KindedError extends Error {
  errKind?: string;
}
function fail(message: string, errKind: string): KindedError {
  const e = new Error(message) as KindedError;
  e.errKind = errKind;
  return e;
}

type AgentRecord = Record<string, any>;

function agentsOf(board: BoardArg): AgentRecord[] {
  return Array.isArray(board.agents) ? (board.agents as AgentRecord[]) : [];
}

function findAgent(board: BoardArg, id: string): AgentRecord | undefined {
  return agentsOf(board).find((a) => a && typeof a === 'object' && a.id === id);
}

// genAgentId — agt-NNN（NNN = 现有 agt-\d+ 最大值 + 1·零填充 3 位）。语法遵守 AGENT_ID_RE。
function genAgentId(board: BoardArg): string {
  let max = 0;
  for (const a of agentsOf(board)) {
    const m = typeof a?.id === 'string' ? a.id.match(/^agt-(\d+)$/) : null;
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `agt-${String(max + 1).padStart(3, '0')}`;
}

// ── agent create ─────────────────────────────────────────────────────────────
//   登记一条 starting 记录，返回 agent_id。account_ref/quota_pool_ref 预留 null（只存 ref 不存数值·配额工作流共签形状）。
export function create(ctx: Ctx): number {
  let createdId = '';
  let createdRecord: AgentRecord = {};
  return runWrite(ctx, {
    mutate: (board) => {
      const b = board as BoardArg;
      if (!Array.isArray(b.agents)) b.agents = [];
      const id = genAgentId(b);
      const now = mutations.stampNow();
      const rec: AgentRecord = {
        id,
        type: ctx.values.type,
        harness: ctx.values.harness,
        intent: (ctx.values.intent as string) ?? '',
        launch: { created_at: now },
        handle: { kind: 'none', value: '' },
        lifecycle: { state: 'starting', registered_at: now, ended_at: null, outcome: null },
        account_ref: null,
        quota_pool_ref: null,
      };
      if (ctx.values.model !== undefined) rec.model = ctx.values.model;
      if (ctx.values.cwd !== undefined) rec.launch.cwd = ctx.values.cwd;
      (b.agents as AgentRecord[]).push(rec);
      createdId = id;
      createdRecord = rec;
      return mutations.touch(b);
    },
    render: (_next, c) => {
      if (c.flags.json) {
        return JSON.stringify({ ok: true, data: { agent_id: createdId, agent: createdRecord } });
      }
      return `agent ${createdId} 已登记（state=starting·type=${ctx.values.type}·harness=${ctx.values.harness}）\n`;
    },
  });
}

// ── agent bind <id> --handle <kind:value> ─────────────────────────────────────
//   交证据 starting→running（无真实 handle 拒绝·「无真实 handle 不算 running」铁律）。handle.kind ∈ session-id|pid|task-id。
export function bind(ctx: Ctx): number {
  const id = ctx.positionals[0] as string;
  const handleSpec = (ctx.values.handle as string) || '';
  const idx = handleSpec.indexOf(':');
  const kind = idx === -1 ? '' : handleSpec.slice(0, idx);
  const value = idx === -1 ? '' : handleSpec.slice(idx + 1);
  // 无真实 handle 证据 → 拒绝（VALIDATION）。kind 须 ∈ session-id|pid|task-id、value 非空。
  if (!['session-id', 'pid', 'task-id'].includes(kind) || value.trim() === '') {
    throw fail(
      `bind 需真实 handle 证据 --handle <kind:value>（kind ∈ session-id|pid|task-id，value 非空）——无证据不算 running（收到 ${JSON.stringify(handleSpec)}）`,
      'Validation',
    );
  }
  let bound: AgentRecord = {};
  return runWrite(ctx, {
    mutate: (board) => {
      const b = board as BoardArg;
      const agent = findAgent(b, id);
      if (!agent) throw fail(`agent ${id} 不存在（先 \`ccm agent create\`）`, 'NotFound');
      const state = agent.lifecycle?.state ?? 'starting';
      if (!isLegalAgentTransition(state, 'running')) {
        throw fail(
          `agent ${id} 非法转移 ${state}→running（仅 starting/uncertain/running 可 bind 成 running）`,
          'IllegalTransition',
        );
      }
      agent.handle = { kind, value: value.trim() };
      if (ctx.values['attach-cmd'] !== undefined)
        agent.handle.attach_cmd = ctx.values['attach-cmd'];
      if (ctx.values.transcript !== undefined) agent.handle.transcript_ref = ctx.values.transcript;
      if (!agent.lifecycle || typeof agent.lifecycle !== 'object') agent.lifecycle = {};
      agent.lifecycle.state = 'running';
      bound = agent;
      return mutations.touch(b);
    },
    render: (_next, c) => {
      if (c.flags.json) return JSON.stringify({ ok: true, data: { agent: bound } });
      return `agent ${id} bound（handle=${kind}:${value.trim()}·state=running）\n`;
    },
  });
}

// ── agent link <id> --task <task-id> ──────────────────────────────────────────
//   建 agent↔task 关联。**join 存 agent 侧 links[]**（非 task.routing.attempts[]）：
//     · 冻结的 agent-routing/v1 envelope 会 hard 校验任何 task.routing（FMT-TASK-ROUTING）——往 legacy task 的
//       attempts[] 塞轻量条目会逼出全套 envelope 硬错；native attempt 又被 native-attempt writer guard 锁死
//       （generic writer 不得改 attempt ledger）。故 join 落 agent 侧 links[]，维持 single-writer + board lock +
//       lint 干净 + 冻结合同零改动。viewer read-model 由 server join agents[].links→node.agent_refs。
//   幂等：若已有指向本 task 的 link 则不重复追加。
export function link(ctx: Ctx): number {
  const id = ctx.positionals[0] as string;
  const taskId = ctx.values.task as string;
  let linked: AgentRecord = {};
  let already = false;
  return runWrite(ctx, {
    mutate: (board) => {
      const b = board as BoardArg;
      const agent = findAgent(b, id);
      if (!agent) throw fail(`agent ${id} 不存在（先 \`ccm agent create\`）`, 'NotFound');
      const taskExists =
        Array.isArray(b.tasks) && b.tasks.some((t: any) => t && t.id === taskId);
      if (!taskExists) {
        throw fail(`link 目标 task ${taskId} 不存在于本 board（无法建关联）`, 'Validation');
      }
      if (!Array.isArray(agent.links)) agent.links = [];
      if ((agent.links as AgentRecord[]).some((l) => l && l.task_id === taskId)) {
        already = true; // 幂等：已关联
      } else {
        (agent.links as AgentRecord[]).push({ task_id: taskId, linked_at: mutations.stampNow() });
      }
      linked = agent;
      return mutations.touch(b);
    },
    render: (_next, c) => {
      if (c.flags.json)
        return JSON.stringify({ ok: true, data: { agent: linked, idempotent: already } });
      return `agent ${id} ${already ? '已关联（幂等·未重复）' : '关联'} task ${taskId}\n`;
    },
  });
}

// ── agent terminal <id> --outcome "..." ───────────────────────────────────────
//   running/uncertain/orphaned → terminal，登记 outcome。terminal ≠ task done——**绝不碰 task status**（父层独立验收）。
export function terminal(ctx: Ctx): number {
  const id = ctx.positionals[0] as string;
  const outcome = ctx.values.outcome as string;
  let ended: AgentRecord = {};
  return runWrite(ctx, {
    mutate: (board) => {
      const b = board as BoardArg;
      const agent = findAgent(b, id);
      if (!agent) throw fail(`agent ${id} 不存在`, 'NotFound');
      const state = agent.lifecycle?.state ?? 'starting';
      if (state !== 'terminal' && !isLegalAgentTransition(state, 'terminal')) {
        throw fail(
          `agent ${id} 非法转移 ${state}→terminal（仅 running/uncertain/orphaned 可收口为 terminal）`,
          'IllegalTransition',
        );
      }
      if (!agent.lifecycle || typeof agent.lifecycle !== 'object') agent.lifecycle = {};
      agent.lifecycle.state = 'terminal';
      agent.lifecycle.ended_at = mutations.stampNow();
      agent.lifecycle.outcome = outcome ?? '';
      ended = agent;
      return mutations.touch(b);
    },
    render: (_next, c) => {
      if (c.flags.json) return JSON.stringify({ ok: true, data: { agent: ended } });
      return `agent ${id} → terminal（outcome=${outcome ?? ''}·注：terminal ≠ task done）\n`;
    },
  });
}

// probe 一条 agent 记录（原地改其 probe/lifecycle）——只写 agents[] 自己的字段（M4）。
function probeOne(agent: AgentRecord, ctx: Ctx, now: string): void {
  const freshnessSec = ctx.values['freshness-sec']
    ? Number(ctx.values['freshness-sec'])
    : undefined;
  const res = probeAgent(
    {
      harness: agent.harness,
      handleKind: agent.handle?.kind,
      handleValue: agent.handle?.value,
      transcriptRef: agent.handle?.transcript_ref,
      type: agent.type,
    },
    { env: ctx.env, freshnessSec },
  );
  agent.probe = {
    last_probe_at: now,
    method: res.method,
    observed: res.observed,
    as_of: now,
  };
  if (!agent.lifecycle || typeof agent.lifecycle !== 'object') agent.lifecycle = {};
  agent.lifecycle.state = reconcileAgentState(agent.lifecycle.state ?? 'starting', res.observed);
}

// ── agent probe [<id> | --board <ref>] ────────────────────────────────────────
//   活性探测 + reconcile（观测冲突以观测为准降级）。只写 agents[] 的 probe/lifecycle 字段——绝不碰 task/attempt 投影。
export function probe(ctx: Ctx): number {
  const id = ctx.positionals[0] as string | undefined;
  let probed: AgentRecord[] = [];
  return runWrite(ctx, {
    mutate: (board) => {
      const b = board as BoardArg;
      const now = mutations.stampNow();
      if (id) {
        const agent = findAgent(b, id);
        if (!agent) throw fail(`agent ${id} 不存在`, 'NotFound');
        probeOne(agent, ctx, now);
        probed = [agent];
      } else {
        probed = agentsOf(b);
        for (const agent of probed) probeOne(agent, ctx, now);
      }
      return mutations.touch(b);
    },
    render: (_next, c) => {
      if (c.flags.json) return JSON.stringify({ ok: true, data: { probed } });
      const lines = probed.map(
        (a) => `  ${a.id}: observed=${a.probe?.observed}·method=${a.probe?.method}·state=${a.lifecycle?.state}`,
      );
      return `probe ${probed.length} agent(s):\n${lines.join('\n')}\n`;
    },
  });
}

// ── agent list --board <ref> --json ───────────────────────────────────────────
export function list(ctx: Ctx): number {
  return runRead(ctx, {
    render: (board, c) => {
      const b = board as BoardArg;
      const agents = agentsOf(b);
      const buckets: Record<string, number> = {};
      for (const a of agents) {
        const st = a?.lifecycle?.state ?? 'unknown';
        buckets[st] = (buckets[st] ?? 0) + 1;
      }
      if (c.flags.json) {
        return JSON.stringify({ ok: true, data: { count: agents.length, buckets, agents } });
      }
      if (agents.length === 0) return 'agents: (none)\n';
      const bucketLine = Object.entries(buckets)
        .map(([k, v]) => `${k}:${v}`)
        .join(' ');
      const rows = agents.map((a) => {
        const links = Array.isArray(a.links)
          ? (a.links as AgentRecord[]).map((l) => l.task_id).join(',')
          : '';
        return `  ${a.id}  ${a.lifecycle?.state ?? '?'}  ${a.harness}/${a.type}  ${a.intent ?? ''}${links ? `  →[${links}]` : ''}`;
      });
      return `agents (${agents.length})  [${bucketLine}]\n${rows.join('\n')}\n`;
    },
  });
}

// ── agent show <id> --json ────────────────────────────────────────────────────
export function show(ctx: Ctx): number {
  const id = ctx.positionals[0] as string;
  return runRead(ctx, {
    render: (board, c) => {
      const b = board as BoardArg;
      const agent = findAgent(b, id);
      if (!agent) throw fail(`agent ${id} 不存在`, 'NotFound');
      if (c.flags.json) return JSON.stringify({ ok: true, data: { agent } });
      const attach = agent.handle?.attach_cmd ? `\n  attach: ${agent.handle.attach_cmd}` : '';
      const transcript = agent.handle?.transcript_ref
        ? `\n  transcript: ${agent.handle.transcript_ref}`
        : '';
      const links = Array.isArray(agent.links)
        ? (agent.links as AgentRecord[]).map((l) => l.task_id).join(', ')
        : '(none)';
      return (
        `agent ${agent.id}\n` +
        `  state: ${agent.lifecycle?.state}  type: ${agent.type}  harness: ${agent.harness}\n` +
        `  intent: ${agent.intent ?? ''}\n` +
        `  handle: ${agent.handle?.kind}:${agent.handle?.value ?? ''}${attach}${transcript}\n` +
        `  probe: observed=${agent.probe?.observed ?? '(未探测)'}·as_of=${agent.probe?.as_of ?? '-'}\n` +
        `  links: ${links}\n`
      );
    },
  });
}
