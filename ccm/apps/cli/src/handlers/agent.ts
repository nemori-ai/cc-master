// handlers/agent.ts — Agent Registry noun handler（create / bind / amend / link / terminal / probe / list / show / rm）。
//
// agent = 实际跑起来的运行时实例（runtime 层）·board-scoped 顶层实体（board.agents[] ✎ 段）·与 node 多对多。
//   凡派发皆登记：sub-agent / 后台 shell / workflow / 跨 harness CLI worker 全进同一花名册（各类型探测能力分级）。
//
// 命令面冻结裁定：agent 是**登记/探测/读取 noun**——verbs 不含任何 spawn/route/dispatch 语义（不起进程、
//   不选路、不派活）。所有写经 engine 既有写入关卡（runWrite·带锁 + lint after mutate）。
//
// 状态机（逐字复用 native-attempt 铁律）：starting→running（bind 交真实 handle 证据·无证据拒绝）·
//   starting/running/uncertain/orphaned→terminal（登记 outcome·starting→terminal = 启动失败收口·
//   terminal ≠ task done·绝不碰 task status）·
//   uncertain→running（probe alive / 再 bind 复活）· probe 观测冲突以观测为准降级。
//
// agent↔task join 存 **agent 侧 links[]**（非 task.routing.attempts[]）：见 create/link 注。
//   probe 只写 agents[] 自己的 probe/lifecycle 字段——绝不碰 task.handle / attempt 投影（那是 native-attempt writer 地盘）。
//
// exit codes：0 OK · 2 USAGE（缺必填 flag·router 层） · 3 VALIDATION（无 handle 证据 / 非法转移 / task 引用不存在） ·
//   4 LOCK · 5 NOT_FOUND（agent id 不存在）。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib。武装闸豁免：纯 handler 模块（无 hook 入口）。

import { AGENT_STATE_MACHINE, isLegalAgentTransition } from '@ccm/engine';
import { probeAgent, reconcileAgentState } from '../agent-probe.js';
import * as io from '../io.js';
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

// 逐条过滤非对象条目（null / 字符串 / 数组·手改板产物）——坏条目静默跳过，对齐 FMT-AGENTS lint 的
//   graceful 降级（坏条目 warn 不阻断）与 web-viewer 侧同名函数的做法；否则 probe/list 对 agents:[null,…]
//   直接 TypeError 崩溃。
function agentsOf(board: BoardArg): AgentRecord[] {
  return Array.isArray(board.agents)
    ? (board.agents as unknown[]).filter(
        (a): a is AgentRecord => !!a && typeof a === 'object' && !Array.isArray(a),
      )
    : [];
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
      // launch.cwd 是 attach/resume 的关键接入证据（claude-code resume 必须回原目录·viewer 的
      //   cwd-aware attach 命令也依赖它）——不靠登记者自觉：--cwd 未传时默认记录登记时刻的工作目录。
      rec.launch.cwd = ctx.values.cwd !== undefined ? ctx.values.cwd : process.cwd();
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

// handle 证据解析 + 校验（bind / amend 共用·同一套规则不漂移）：kind ∈ session-id|pid|task-id、value 非空。
//   不合规 → 拒绝（VALIDATION）。
function parseHandleSpec(raw: unknown, verb: string, why: string): { kind: string; value: string } {
  const handleSpec = (raw as string) || '';
  const idx = handleSpec.indexOf(':');
  const kind = idx === -1 ? '' : handleSpec.slice(0, idx);
  const value = idx === -1 ? '' : handleSpec.slice(idx + 1);
  if (!['session-id', 'pid', 'task-id'].includes(kind) || value.trim() === '') {
    throw fail(
      `${verb} 需真实 handle 证据 --handle <kind:value>（kind ∈ session-id|pid|task-id，value 非空）——${why}（收到 ${JSON.stringify(handleSpec)}）`,
      'Validation',
    );
  }
  return { kind, value: value.trim() };
}

// ── agent bind <id> --handle <kind:value> ─────────────────────────────────────
//   交证据 starting→running（无真实 handle 拒绝·「无真实 handle 不算 running」铁律）。handle.kind ∈ session-id|pid|task-id。
export function bind(ctx: Ctx): number {
  const id = ctx.positionals[0] as string;
  const { kind, value } = parseHandleSpec(ctx.values.handle, 'bind', '无证据不算 running');
  let bound: AgentRecord = {};
  return runWrite(ctx, {
    mutate: (board) => {
      const b = board as BoardArg;
      const agent = findAgent(b, id);
      if (!agent) throw fail(`agent ${id} 不存在（先 \`ccm agent create\`）`, 'NotFound');
      const state = agent.lifecycle?.state ?? 'starting';
      if (!isLegalAgentTransition(state, 'running')) {
        // 文案从 AGENT_STATE_MACHINE 推导（单一 SSOT·不与机器漂移——机器允许 orphaned 再 bind 复活）。
        const ok = Object.keys(AGENT_STATE_MACHINE).filter((s) =>
          isLegalAgentTransition(s, 'running'),
        );
        throw fail(
          `agent ${id} 非法转移 ${state}→running（仅 ${ok.join('/')} 可 bind 成 running）`,
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

// ── agent amend <id> [--handle <kind:value>] [--attach-cmd "..."] [--transcript <path>] ─
//   登记簿事后补正（真实缺口：坏 handle 在 agent 已 terminal 后才发现——bind 被状态机拒〔terminal 冻结〕，
//   唯一出路曾是重复登记新 record，一个真实 worker 在 roster 撕成两行）。
//   语义边界：**只**允许改 handle 域三件套（handle / attach_cmd / transcript_ref），至少给一项；
//   **任何 lifecycle 状态可用（含 terminal）**——amend 不是状态转移、不交证据、不复活：
//   **绝不**触碰 lifecycle.state / probe / links / intent（要改状态走 bind/terminal 等既有 verb）。
//   handle 校验复用 bind 的同一套规则（parseHandleSpec）。仍是登记簿语义——无 spawn/route/dispatch。
export function amend(ctx: Ctx): number {
  const id = ctx.positionals[0] as string;
  const hasHandle = ctx.values.handle !== undefined;
  const hasAttach = ctx.values['attach-cmd'] !== undefined;
  const hasTranscript = ctx.values.transcript !== undefined;
  if (!hasHandle && !hasAttach && !hasTranscript) {
    throw fail(
      'amend 至少给一项 --handle / --attach-cmd / --transcript（只允许补正 handle 域三件套）',
      'Usage',
    );
  }
  const parsed = hasHandle
    ? parseHandleSpec(ctx.values.handle, 'amend', '坏 handle 不入登记簿')
    : null;
  let amended: AgentRecord = {};
  return runWrite(ctx, {
    mutate: (board) => {
      const b = board as BoardArg;
      const agent = findAgent(b, id);
      if (!agent) throw fail(`agent ${id} 不存在`, 'NotFound');
      if (!agent.handle || typeof agent.handle !== 'object') {
        agent.handle = { kind: 'none', value: '' };
      }
      if (parsed) {
        agent.handle.kind = parsed.kind;
        agent.handle.value = parsed.value;
      }
      if (hasAttach) agent.handle.attach_cmd = ctx.values['attach-cmd'];
      if (hasTranscript) agent.handle.transcript_ref = ctx.values.transcript;
      amended = agent;
      return mutations.touch(b);
    },
    render: (_next, c) => {
      if (c.flags.json) return JSON.stringify({ ok: true, data: { agent: amended } });
      return `agent ${id} handle 域已补正（handle=${amended.handle?.kind}:${amended.handle?.value}·state=${amended.lifecycle?.state} 不变——amend 不做状态转移）\n`;
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
      const taskExists = Array.isArray(b.tasks) && b.tasks.some((t: any) => t && t.id === taskId);
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
//   starting/running/uncertain/orphaned → terminal，登记 outcome（starting→terminal = 启动失败收口）。
//   terminal ≠ task done——**绝不碰 task status**（父层独立验收）。
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
        // 文案从 AGENT_STATE_MACHINE 推导（单一 SSOT·含 starting→terminal 启动失败收口）。
        const ok = Object.keys(AGENT_STATE_MACHINE).filter(
          (s) => s !== 'terminal' && isLegalAgentTransition(s, 'terminal'),
        );
        throw fail(
          `agent ${id} 非法转移 ${state}→terminal（仅 ${ok.join('/')} 可收口为 terminal）`,
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

// --freshness-sec 校验（一次·probe 入口）：NaN（如 '5m'）会让判活比较恒 false → 活 agent 恒 silent
//   被降级写盘；0/负数同理。非法值拒绝进入写路径（Usage·router 映射 exit 2，对齐其他 flag 校验模式）。
function parseFreshnessSec(raw: unknown): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw fail(
      `--freshness-sec 须为正数（秒）——收到 ${JSON.stringify(raw)}（非法值会把活 agent 误判 silent 并降级写盘）`,
      'Usage',
    );
  }
  return n;
}

interface ReconcileRejection {
  id: string;
  from: string;
  to: string;
}

// probe 一条 agent 记录（原地改其 probe/lifecycle）——只写 agents[] 自己的字段（M4）。
//   prevMethod/prevObserved 喂 seen-before 判死（读旧 probe 字段须在覆写之前）；
//   reconcile 产出的转移写盘前经 isLegalAgentTransition 断言（引擎状态机是唯一 SSOT——
//   不合法则保持原态并记入 rejected 供 --json 输出标注）。
function probeOne(
  agent: AgentRecord,
  ctx: Ctx,
  now: string,
  freshnessSec: number | undefined,
  dirCache: Map<string, unknown>,
  rejected: ReconcileRejection[],
): void {
  const res = probeAgent(
    {
      harness: agent.harness,
      handleKind: agent.handle?.kind,
      handleValue: agent.handle?.value,
      transcriptRef: agent.handle?.transcript_ref,
      type: agent.type,
      prevMethod: agent.probe?.method,
      prevObserved: agent.probe?.observed,
    },
    { env: ctx.env, freshnessSec, dirCache },
  );
  agent.probe = {
    last_probe_at: now,
    method: res.method,
    observed: res.observed,
    as_of: now,
  };
  if (!agent.lifecycle || typeof agent.lifecycle !== 'object') agent.lifecycle = {};
  const cur = agent.lifecycle.state ?? 'starting';
  const next = reconcileAgentState(cur, res.observed, res.method);
  if (next === cur || isLegalAgentTransition(cur, next)) {
    agent.lifecycle.state = next;
  } else {
    rejected.push({ id: String(agent.id ?? '?'), from: cur, to: next });
  }
}

// ── agent probe [<id> | --board <ref>] ────────────────────────────────────────
//   活性探测 + reconcile（观测冲突以观测为准降级）。只写 agents[] 的 probe/lifecycle 字段——绝不碰 task/attempt 投影。
//   全量 probe 共享一个 dirCache：N 个 session-id agent 只做一趟目录遍历（board lock 内的效率约束）。
export function probe(ctx: Ctx): number {
  const id = ctx.positionals[0] as string | undefined;
  const freshnessSec = parseFreshnessSec(ctx.values['freshness-sec']); // 写路径之前拒绝非法值
  let probed: AgentRecord[] = [];
  let rejected: ReconcileRejection[] = [];
  return runWrite(ctx, {
    mutate: (board) => {
      const b = board as BoardArg;
      const now = mutations.stampNow();
      const dirCache = new Map<string, unknown>();
      probed = [];
      rejected = [];
      if (id) {
        const agent = findAgent(b, id);
        if (!agent) throw fail(`agent ${id} 不存在`, 'NotFound');
        probeOne(agent, ctx, now, freshnessSec, dirCache, rejected);
        probed = [agent];
      } else {
        probed = agentsOf(b);
        for (const agent of probed) probeOne(agent, ctx, now, freshnessSec, dirCache, rejected);
      }
      return mutations.touch(b);
    },
    render: (_next, c) => {
      if (c.flags.json) {
        return JSON.stringify({ ok: true, data: { probed, reconcile_rejected: rejected } });
      }
      const lines = probed.map(
        (a) =>
          `  ${a.id}: observed=${a.probe?.observed}·method=${a.probe?.method}·state=${a.lifecycle?.state}`,
      );
      const rej = rejected.map(
        (r) => `  ! ${r.id}: reconcile 提议 ${r.from}→${r.to} 非法（状态机拒绝）·已保持原态`,
      );
      return `probe ${probed.length} agent(s):\n${[...lines, ...rej].join('\n')}\n`;
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

// ── agent rm <id> ─────────────────────────────────────────────────────────────
//   删除一条 agent 记录（links[] 存在 agent 侧、随记录一并消失）——重复登记 / 误登记的撕裂行修正出口。
//   破坏性：非 TTY 须 --yes（对齐 task rm 语义·agent 永不撞交互提示·clig/12-factor）。
//   登记簿删除 ≠ 状态转移——不经状态机；仍走 runWrite（带锁 + lint after mutate）。
export function rm(ctx: Ctx): number {
  const id = ctx.positionals[0] as string;
  // TTY 检测：ctx 显式注入 isTTY 时用之（测试便利），否则嗅 process.stdin.isTTY（非 TTY → 须 --yes）。
  const tty = ctx.isTTY !== undefined ? ctx.isTTY : io.isTTY(process.stdin);
  if (!tty && !ctx.flags.yes) {
    ctx.err(`refused: "agent rm ${id}" 是破坏性操作；非交互环境须加 --yes 确认`);
    return io.EXIT.USAGE;
  }
  return runWrite(ctx, {
    mutate: (board) => {
      const b = board as BoardArg;
      const exists = agentsOf(b).some((a) => a.id === id);
      if (!exists) throw fail(`agent ${id} 不存在`, 'NotFound');
      b.agents = (b.agents as unknown[]).filter(
        (a) => !(!!a && typeof a === 'object' && !Array.isArray(a) && (a as AgentRecord).id === id),
      );
      return mutations.touch(b);
    },
    render: (_next, c, { dryRun }) => {
      if (c.flags.json) return JSON.stringify({ ok: true, data: { removed: id } });
      return dryRun ? `[dry-run] 将删除 agent: ${id}\n` : `agent 已删除: ${id}\n`;
    },
  });
}
