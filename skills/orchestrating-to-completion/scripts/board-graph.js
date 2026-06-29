#!/usr/bin/env node
'use strict';
// board-graph.js — D3.2 交付：board 图分析手动 CLI（运行时带外、随 skill 分发·设计稿 §5.5）。
//
// 落点为何在这（skills/orchestrating-to-completion/scripts/）：它是 agent/orchestrator 会在决策点主动跑的
//   运行时带外脚本（红线5 / Finding #37 落点纪律）—— prose 引用用 ${CLAUDE_SKILL_DIR}/${CLAUDE_PLUGIN_ROOT}
//   绝对路径，绝不裸相对路径。它**显式被调用**（非 plugin 自动 hook），故不需武装闸（与 board-lint.js /
//   cc-usage.sh / codex-review.sh 同）。它给 orchestrator 提供「机器算的临界路径 / float / 并行度 /
//   ready-set」——替代 status agent 心算（但**永不回写 board**·红线2，只 stdout/--json）。
//
// ★ADR-014 解耦（T4-3b 完成态）：图核心的唯一 SSOT 是 ccm 引擎（解耦后 `@ccm/engine`）。本脚本经
//   **进程边界 shell 调全局 `ccm` 二进制**（`ccm board graph --board <path> --json` + `ccm board show
//   --board <path> --json`）取数，**绝不 in-process require 引擎源码**（红线1 进程边界；3b 已删整个 cli/）。
//   它是用户**显式手动跑**的脚本（非 hook），故 ccm 缺/坏时**明确友好报错退非 0**（不静默降级）。
//   · 调用约定：`CCM_BIN`（绝对路径可执行）是 dev/test/自定义安装的覆写口；生产 `ccm` 在 PATH。
//
// ★ccm CLI 表面（设计稿 board-cli-design §3）：ccm `board graph --json` 现已暴露 **impact / rollup /
//   nesting advisory**（本脚本消费之）——除拓扑 / 环 / readySet / 临界路径(chain·makespan·weight_source) /
//   并行度(T1·Tinf·ratio) 外，新增：**逐节点 impact（descendants 传递闭包·{count,descendants}）/ 逐 owner
//   rollup 进度（{done,total,ratio,children} + inconsistencies）/ nesting 检查（depth-1 · parent 环）**。
//   `board show --json` 补 **statusCounts**（用来还原 WIP 计数）。这三个 advisory 与图算法同一份引擎 SSOT
//   （`@ccm/engine`），经进程边界 shell 取数，绝不 in-process 自己算（红线1 进程边界）。
//
// 红线1 / ADR-006：node/JS only，纯 stdlib（fs/path/child_process），零 npm dep，零网络。
//
// CLI（契约保持，转译为 ccm 调用）：
//   node board-graph.js <board-path>          人读摘要：临界链 / ready-set / WIP / 并行度 / 最高 impact / owner rollup
//   node board-graph.js                        无参 → home 下唯一 active 板（多块则提示传路径）
//   node board-graph.js --json [<path>]        结构化 JSON（ccm board graph --json 的投影 + statusCounts）
//   node board-graph.js --cmd <name> [<path>]  单项：critical | ready | wip | parallelism
//     | impact <id>（该节点 gating 的下游闭包）| rollup <owner>（该 owner 的子完成度）
// 退出码：0 = 成功（含「有环但已报告」）；2 = usage/IO/ccm-不可用。**不因「图坏」非零退出**。

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

// CCM_BIN：dev/test/自定义安装的覆写口（绝对路径可执行）；缺则用 PATH 上的 `ccm`（生产）。
const CCM_BIN = process.env.CCM_BIN || 'ccm';

function die(msg, code) {
  process.stderr.write(msg + '\n');
  process.exit(code);
}

// findSingleActiveBoard(homeDir) → 唯一 active 板的绝对路径，或 die(…,2)（与 board-lint.js 同口径）。
//   board 集中在 <home>/boards/（board-v2 布局），入参传 home 根。
function findSingleActiveBoard(homeDir) {
  const boardsDir = path.join(homeDir, 'boards');
  let entries;
  try {
    entries = fs.readdirSync(boardsDir, { withFileTypes: true });
  } catch (_e) {
    die(`cc-master board-graph: 找不到 board home（${boardsDir}）。\n  怎么修：传一个显式 board 路径，或设 CC_MASTER_HOME。`, 2);
  }
  const active = [];
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith('.board.json')) continue;
    const full = path.join(boardsDir, ent.name);
    try {
      const b = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (b && b.owner && b.owner.active === true) active.push(full);
    } catch (_e) { /* 坏板：无法判 active，跳过 */ }
  }
  if (active.length === 0) {
    die(`cc-master board-graph: home（${homeDir}）里没有 active board。\n  怎么修：传一个显式 board 路径。`, 2);
  }
  if (active.length > 1) {
    die(`cc-master board-graph: home 里有 ${active.length} 块 active board，无法自动选。\n  请传一个显式 board 路径：\n` +
        active.map((p) => `    node board-graph.js ${p}`).join('\n'), 2);
  }
  return active[0];
}

// ccmJson(verb, boardPath) → ccm `board <verb> --board <path> --json` 的 data 字段。
//   ccm 不可用（ENOENT / 非有效 JSON / 错误信封 / 形状不符）→ die(…,2)（手动脚本：让用户知道需要 ccm）。
function ccmJson(verb, boardPath) {
  let r;
  try {
    r = spawnSync(CCM_BIN, ['board', verb, '--board', boardPath, '--json'], {
      encoding: 'utf8',
      timeout: 15000,
    });
  } catch (e) {
    die(`cc-master board-graph: 无法调用 ccm（${CCM_BIN}）—— ${(e && e.message) ? e.message : String(e)}\n` +
        `  本脚本经全局 ccm 二进制取图（ADR-014 解耦）。怎么修：装 ccm 并确保它在 PATH，或设 CCM_BIN 指向 ccm 可执行。`, 2);
  }
  if (!r || r.error || r.signal) {
    const why = r && r.error && r.error.code === 'ENOENT' ? `找不到 ccm（${CCM_BIN}）` :
                (r && r.signal) ? `ccm 被信号 ${r.signal} 终止` : 'ccm 调用失败';
    die(`cc-master board-graph: ${why}。\n` +
        `  本脚本经全局 ccm 二进制取图（ADR-014 解耦）。怎么修：装 ccm 并确保它在 PATH，或设 CCM_BIN 指向 ccm 可执行。`, 2);
  }
  const stdout = typeof r.stdout === 'string' ? r.stdout : '';
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (_e) {
    const stderr = typeof r.stderr === 'string' ? r.stderr.trim() : '';
    die(`cc-master board-graph: ccm 没有返回有效 JSON（退出码 ${r.status}）。${stderr ? '\n  ccm stderr：' + stderr : ''}\n` +
        `  怎么修：确认路径存在、且是合法 board JSON（先跑 board-lint），并确认 ccm 版本支持 \`board ${verb} --json\`。`, 2);
  }
  if (parsed && parsed.ok === false) {
    const msg = typeof parsed.error === 'string' && parsed.error ? parsed.error : `ccm 退出码 ${parsed.exit}`;
    die(`cc-master board-graph: ${msg}\n  怎么修：确认路径存在、可读，且是合法 board JSON（先跑 board-lint）。`, 2);
  }
  const data = parsed && typeof parsed === 'object' ? parsed.data : undefined;
  if (data === undefined) {
    die(`cc-master board-graph: ccm JSON 形状不符（缺 data）。\n  怎么修：确认 ccm 版本支持 \`board ${verb} --json\`。`, 2);
  }
  return data;
}

// ── 人读格式化（消费 ccm board graph --json + board show --json 的投影）──────────────────────────────

// formatCritical(graph) — CPM 临界链人读；诚实标注 weight_source（mixed/unit 只报结构，measured 才报 makespan）。
function formatCritical(graph) {
  const cp = (graph && graph.criticalPath) || {};
  const chain = Array.isArray(cp.chain) ? cp.chain : [];
  const ws = cp.weight_source || 'unit';
  const cycle = graph && Array.isArray(graph.cycle) ? graph.cycle : null;
  if (ws === 'cycle' || (cycle && cycle.length)) {
    const c = cycle && cycle.length ? cycle : chain;
    return `临界路径：deps 图有环（${c.join(' → ')}${c.length ? ' → ' + c[0] : ''}），CPM 在环上未定义——先用 board-lint 解环。`;
  }
  const lines = [];
  const chainStr = chain.length ? chain.join(' → ') : '（空——无任务）';
  lines.push(`临界链（${chain.length} 节点）：${chainStr}`);
  if (ws === 'measured' && typeof cp.makespan === 'number') {
    lines.push(`  权重来源：measured（全节点有 measured 时长）；makespan ≈ ${cp.makespan.toFixed(2)}h。`);
  } else {
    lines.push(`  权重来源：${ws}（部分/全部节点缺 measured 时长）——只报临界链结构 + 节点数，` +
               `不报小时级 float/makespan（避免伪精确）。补全 started_at/finished_at 后可得真 CPM。`);
  }
  return lines.join('\n');
}

// wipFromShow(show) — 从 ccm board show --json 的 statusCounts 还原 WIP 计数（in_flight / blocked / 等用户）。
//   注：ccm show 的 statusCounts 不区分 blocked_on:"user"（无 userGates 维），故等用户位用 blocked 总数注脚标。
function wipCounts(show) {
  const sc = (show && show.statusCounts) || {};
  return {
    in_flight: Number(sc.in_flight) || 0,
    blocked: Number(sc.blocked) || 0,
  };
}

// topImpact(graph) — 从 graph.impact 取 count 最大的节点（impact = gating 的下游闭包大小）。无 impact → null。
function topImpact(graph) {
  const impact = (graph && graph.impact) || {};
  let best = null;
  for (const id of Object.keys(impact)) {
    const count = Number((impact[id] && impact[id].count) || 0);
    if (best === null || count > best.count) best = { id, count, descendants: (impact[id] && impact[id].descendants) || [] };
  }
  return best;
}

function humanSummary(graph, show) {
  const lines = [];
  lines.push('cc-master board-graph 摘要');
  lines.push('');
  lines.push(formatCritical(graph));
  lines.push('');
  const ready = Array.isArray(graph.readySet) ? graph.readySet : [];
  lines.push(`ready-set（deps 全 done ∧ status=ready，可派发）：${ready.length ? ready.join(', ') : '（空）'}`);
  const wip = wipCounts(show);
  lines.push(`WIP：in_flight=${wip.in_flight} · blocked=${wip.blocked}`);
  const par = (graph && graph.parallelism) || {};
  const T1 = par.T1 == null ? 0 : par.T1;
  const Tinf = par.Tinf == null ? 0 : par.Tinf;
  const ratio = typeof par.parallelism === 'number' ? par.parallelism.toFixed(2) : 'n/a';
  lines.push(`并行度：T₁=${T1}（总节点）· T∞=${Tinf}（临界链长）· 加速比≈${ratio}（值得开几条道的上界）`);
  // 最高 impact（gating 最多下游的节点——优先派发的信号）。
  const top = topImpact(graph);
  if (top && top.count > 0) {
    lines.push(`最高 impact：${top.id} gating ${top.count} 个下游（${top.descendants.join(', ')}）——优先解开它。`);
  }
  // owner rollup 段（逐 owner done/total/百分比）。
  const owners = (graph && graph.rollup && graph.rollup.owners) || {};
  const ownerIds = Object.keys(owners);
  if (ownerIds.length) {
    lines.push('');
    lines.push('owner rollup（子任务完成度·advisory）：');
    for (const o of ownerIds) {
      const r = owners[o] || {};
      const total = Number(r.total) || 0;
      const done = Number(r.done) || 0;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      lines.push(`  ${o}：${done}/${total}（${pct}%）· 子: ${(r.children || []).join(', ')}`);
    }
  }
  // rollup 不一致告警（owner 已 done 但有非 done 子·verify-board / board-lint 仍强制 gate，此处只 advisory 提示）。
  const inc = (graph && graph.rollup && graph.rollup.inconsistencies) || [];
  if (inc.length) {
    lines.push('');
    for (const i of inc) {
      lines.push(`⚠ rollup 不一致：${i.owner} 已 done 但子未全 done → ${(i.nonDoneChildren || []).join(', ')}`);
    }
  }
  return lines.join('\n');
}

// fullJson(graph, show) — --json 全量结构化输出（ccm board graph --json 投影 + statusCounts）。
function fullJson(graph, show) {
  const cp = (graph && graph.criticalPath) || {};
  return {
    topo: Array.isArray(graph.topoOrder) ? graph.topoOrder : [],
    cycle: graph && graph.cycle ? graph.cycle : null,
    readySet: Array.isArray(graph.readySet) ? graph.readySet : [],
    critical: {
      chain: Array.isArray(cp.chain) ? cp.chain : [],
      makespan: cp.makespan === undefined ? null : cp.makespan,
      weight_source: cp.weight_source || null,
    },
    parallelism: (graph && graph.parallelism) || {},
    statusCounts: (show && show.statusCounts) || {},
    // advisory 三表面：直接消费 ccm board graph --json 的 impact / rollup / nesting（引擎 SSOT·见文件头）。
    impact: (graph && graph.impact) || {},
    rollup: (graph && graph.rollup) || { owners: {}, inconsistencies: [] },
    nesting: (graph && graph.nesting) || { depth1: [], parentCycles: [] },
  };
}

// runCmd(graph, show, cmd, arg) → 单项输出字符串（--cmd）。
function runCmd(graph, show, cmd, arg) {
  switch (cmd) {
    case 'critical': return formatCritical(graph);
    case 'ready': {
      const r = Array.isArray(graph.readySet) ? graph.readySet : [];
      return r.length ? r.join('\n') : '（ready-set 空）';
    }
    case 'wip': {
      const w = wipCounts(show);
      return `in_flight=${w.in_flight} blocked=${w.blocked}`;
    }
    case 'parallelism': {
      const p = (graph && graph.parallelism) || {};
      const ratio = typeof p.parallelism === 'number' ? p.parallelism.toFixed(2) : 'n/a';
      return `T1=${p.T1 == null ? 0 : p.T1} Tinf=${p.Tinf == null ? 0 : p.Tinf} parallelism=${ratio}`;
    }
    case 'impact': {
      if (!arg) return 'impact 需要一个节点 id：node board-graph.js --cmd impact <id> [<board>]';
      const impact = (graph && graph.impact) || {};
      const e = impact[arg];
      if (!e) return `节点 "${arg}" 不在图里（无 impact 数据）。`;
      const desc = Array.isArray(e.descendants) ? e.descendants : [];
      const count = Number(e.count) || 0;
      return count ? `${arg} gating ${count} 个下游：${desc.join(', ')}` : `${arg} 无下游（叶子节点·gating 0 个）。`;
    }
    case 'rollup': {
      if (!arg) return 'rollup 需要一个 owner id：node board-graph.js --cmd rollup <owner> [<board>]';
      const owners = (graph && graph.rollup && graph.rollup.owners) || {};
      const r = owners[arg];
      if (!r) return `"${arg}" 不是 owner（无子任务·无 rollup 数据）。`;
      const total = Number(r.total) || 0;
      const done = Number(r.done) || 0;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      return `${arg}：${done}/${total}（${pct}%）· 子: ${(r.children || []).join(', ')}`;
    }
    default:
      die(`cc-master board-graph: 未知 --cmd "${cmd}"。合法：critical | ready | wip | parallelism | impact <id> | rollup <owner>`, 2);
  }
}

function main() {
  const argv = process.argv.slice(2);
  let asJson = false;
  let cmd = null, cmdArg = null;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') asJson = true;
    else if (a === '--cmd') { cmd = argv[++i]; }
    else rest.push(a);
  }
  // 位置参数分两类：像路径的（含 / 或 .board.json）当 board 路径，其余当 cmd arg（impact <id> / rollup <owner>）。
  const looksPath = (s) => typeof s === 'string' && (s.includes('/') || s.endsWith('.board.json'));
  const pathArgs = rest.filter(looksPath);
  const nonPathArgs = rest.filter((s) => !looksPath(s));
  let boardPath = pathArgs.length ? pathArgs[pathArgs.length - 1] : null;
  if (cmd === 'impact' || cmd === 'rollup') cmdArg = nonPathArgs.length ? nonPathArgs[0] : null;

  if (!boardPath) {
    // 统一全局口径（与 hook-common.resolveHome / bootstrap-board.sh / ccm 同）：CC_MASTER_HOME 覆写，
    // 否则 $HOME/.claude/cc-master；不再 per-repo（CLAUDE_PROJECT_DIR）或 cwd。board 在 <home>/boards/。
    const home =
      process.env.CC_MASTER_HOME ||
      path.join(process.env.HOME || require('os').homedir(), '.claude', 'cc-master');
    boardPath = findSingleActiveBoard(home); // 内部失败 die(…,2)
  }
  boardPath = path.resolve(boardPath);

  const graph = ccmJson('graph', boardPath);
  // statusCounts 来自 board show（WIP 计数）——只在需要时取（人读摘要 / --json / --cmd wip）。
  const needShow = asJson || !cmd || cmd === 'wip';
  const show = needShow ? ccmJson('show', boardPath) : null;

  if (asJson) {
    process.stdout.write(JSON.stringify(fullJson(graph, show)) + '\n');
  } else if (cmd) {
    process.stdout.write(runCmd(graph, show, cmd, cmdArg) + '\n');
  } else {
    process.stdout.write(humanSummary(graph, show) + '\n');
  }
  process.exit(0); // 成功（含「有环已报告」）——不因图坏非零退出
}

try {
  main();
} catch (e) {
  die(`cc-master board-graph: 内部错误 —— ${(e && e.message) ? e.message : String(e)}`, 2);
}
