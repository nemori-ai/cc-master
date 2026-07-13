// render.ts — ccm CLI 渲染层（人读 vs --json 双形态·设计稿 §4 输出契约 / 契约 §三）。
//
// 职责边界（红线 / 自包含纪律）：
//   · render.ts **只产字符串**——不读盘、不 process.exit、不碰 board 写、不算图（图算法住 board-graph-core）。
//     每个 render 函数接 (result, {json, color}) → string。
//   · human 模式默认**无色**——只有 opts.color===true 才 paint（颜色开关由调用方据 §一.6 resolveColor 决定后传入，
//     render 不自己嗅 TTY/NO_COLOR）。
//   · --json 模式输出**合法 JSON**（JSON.parse 必过），形状只增不改（agent 可靠 parse·§4 输出契约稳定）。
//   · 表格**无边框**（12-factor / clig 可组合）——空格对齐、grep 可过滤、每行含 id 便于 `| grep <id>`。
//
// 依赖：paint 从 ./io.js 取（颜色 enabled=false 时原样返回）。红线1/5：纯 node stdlib，零 npm 依赖。
//
// T2a port 注：原 CJS 源（render.js）的 module.exports 换成命名导出。原 CJS 对 paint 做「懒 require ./io.js
//   + 本地 noop 兜底（_localPaint）」（为解并行 leaf 落地顺序——io.js 可能尚未落地）；ESM + 本 monorepo 里
//   io.ts 是确定可解析的兄弟模块，故改为静态 import io.paint（行为等价：io.paint 与原懒路径在 io.js 可用时
//   走的是同一个 io.paint）。原 _localPaint 兜底仅在 io.js 不可用时触发，此条件在 ESM 静态依赖下永不成立，
//   故不再保留该死代码分支（**唯一一处行为面简化**·见报告）。注：renderTable 表头用 paint(h,'bold',…)，
//   而 io.paint 的 SGR 表无 'bold'→原样返回——这与原 CJS 在 io.js 可用时的行为**完全一致**（原 _localPaint
//   的 'bold' 只在 require io.js 失败时才会生效·正常路径同样不上色表头）。

import { paint as ioPaint } from './io.js';

// render 各函数的 opts 形（全部可选）。
interface RenderOpts {
  json?: boolean;
  color?: boolean;
  lint?: { errors?: unknown[]; warnings?: unknown[] } | null;
  // report（renderLintReport 专用·additive）：调用方传入的 formatReport 文本——--json 时折进 data.report，
  //   让 board-lint hook 一次 `ccm board lint --raw --json` 既拿 violations（判有无）又拿 report（注入文本）。
  //   不传 → data 不带 report 字段（json 形状只增不改·向后兼容）。
  report?: string;
}

// paint：直接走 io.paint（原 CJS 的懒 require + 兜底在 ESM 下退化为静态 import·行为等价）。
function paint(s: string, color: string, enabled: boolean): string {
  return ioPaint(s, color, enabled);
}

// ── JSON 壳（与 io.jsonOk 同形；render 自带一份以独立可用·§4 统一壳 { ok:true, data:… }）──────────────
export function jsonString(data: unknown): string {
  return JSON.stringify({ ok: true, data }, null, 2);
}

// ── 小工具：对齐表格（无边框·空格 pad）─────────────────────────────────────────────────────────────
// renderTable(headers, rows, {color}) → string：
//   · 每列宽 = max(表头, 该列各单元格)的**可见宽度**（去 ANSI 后计长，避免上色撑乱对齐）；
//   · 列间两空格分隔，行尾不留尾空格（grep/diff 友好）；
//   · 表头默认上色（bold·若 color），数据行原样。空 rows → 只输出表头行（不崩）。
function _visibleLen(s: unknown): number {
  // 去掉 SGR 转义后计长度（中文按字符数算·够用，CLI 表格无需全角宽度精算）。
  // biome-ignore lint/suspicious/noControlCharactersInRegex: \x1b(ESC) 是 ANSI/SGR 转义的字面起始·去色对齐的本质所需（非误用控制字符）。
  return String(s).replace(/\x1b\[[0-9;]*m/g, '').length;
}
// width 容忍 undefined（原 JS：cells 比 headers 多时 widths[i] 为 undefined → pad=NaN → 不补·返回原样）。
function _padCell(s: unknown, width: number | undefined): string {
  const pad = (width as number) - _visibleLen(s);
  return pad > 0 ? String(s) + ' '.repeat(pad) : String(s);
}
export function renderTable(
  headers: string[],
  rows: unknown[][],
  opts?: { color?: boolean },
): string {
  const color = !!(opts && opts.color);
  const ncol = headers.length;
  const widths = headers.map((h) => _visibleLen(h));
  for (const row of rows) {
    for (let i = 0; i < ncol; i++) {
      const w = _visibleLen(row[i] == null ? '' : row[i]);
      // widths[i] 由 headers.map 填满 [0,ncol)·i<ncol 故必有值；as number 窄断言（不改逻辑）。
      if (w > (widths[i] as number)) widths[i] = w;
    }
  }
  const sep = '  ';
  const fmtRow = (cells: unknown[]) =>
    cells
      .map((c, i) => _padCell(c == null ? '' : c, widths[i]))
      .join(sep)
      .replace(/\s+$/, ''); // 行尾去空格
  const lines: string[] = [];
  lines.push(fmtRow(headers.map((h) => paint(h, 'bold', color))));
  for (const row of rows) lines.push(fmtRow(row));
  return lines.join('\n');
}

// 状态着色映射（advisory·只在 color 时生效）。done 绿、in_flight 青、blocked/failed 红、ready 黄、其余灰。
function _statusColor(status: unknown): string {
  switch (status) {
    case 'done':
      return 'green';
    case 'in_flight':
      return 'cyan';
    case 'blocked':
    case 'failed':
    case 'escalated':
      return 'red';
    case 'ready':
      return 'yellow';
    default:
      return 'gray';
  }
}

// ══ renderBoardSummary(board, opts) ══════════════════════════════════════════════════════════════
//   human：goal · owner(active/session) · 任务按 status 计数 · lint 是否净。
//   json：{ goal, owner:{active,session_id,heartbeat}, taskCount, statusCounts:{…}, lint:{ok,errors,warnings} }。
//   opts.lint（可选）= lintBoard 结果 { errors, warnings }；缺则 lint 段标 'n/a'（render 不自己跑 lint·只渲染传入）。
export function renderBoardSummary(board: any, opts?: RenderOpts): string {
  opts = opts || {};
  const b = board || {};
  const tasks = Array.isArray(b.tasks) ? b.tasks : [];
  const owner = b.owner && typeof b.owner === 'object' ? b.owner : {};
  const counts: Record<string, number> = {};
  for (const t of tasks) {
    const s = (t && t.status) || 'unknown';
    counts[s] = (counts[s] || 0) + 1;
  }
  const lint = opts.lint && typeof opts.lint === 'object' ? opts.lint : null;
  const lintErrs = lint && Array.isArray(lint.errors) ? lint.errors.length : null;
  const lintWarns = lint && Array.isArray(lint.warnings) ? lint.warnings.length : null;
  const lintClean = lint ? lintErrs === 0 : null;

  if (opts.json) {
    return jsonString({
      goal: typeof b.goal === 'string' ? b.goal : '',
      owner: {
        active: owner.active === true,
        session_id: typeof owner.session_id === 'string' ? owner.session_id : '',
        heartbeat: typeof owner.heartbeat === 'string' ? owner.heartbeat : null,
      },
      taskCount: tasks.length,
      statusCounts: counts,
      lint: lint ? { ok: lintClean, errors: lintErrs, warnings: lintWarns } : null,
    });
  }

  const color = !!opts.color;
  const lines: string[] = [];
  lines.push(`${paint('goal', 'bold', color)}: ${b.goal || '(无 goal)'}`);
  const ownerLine = `owner: active=${owner.active === true} session=${owner.session_id || '(空)'}`;
  lines.push(ownerLine);
  // 任务计数（按枚举顺序稳定输出，含 0 的状态略过）
  const order = [
    'ready',
    'in_flight',
    'blocked',
    'done',
    'escalated',
    'failed',
    'stale',
    'uncertain',
  ];
  const parts: string[] = [];
  for (const s of order) {
    if (counts[s]) parts.push(paint(`${s}=${counts[s]}`, _statusColor(s), color));
  }
  // 兜底：枚举外的状态（如 'unknown'）也列出
  for (const s of Object.keys(counts)) {
    if (!order.includes(s)) parts.push(`${s}=${counts[s]}`);
  }
  lines.push(`tasks (${tasks.length}): ${parts.length ? parts.join('  ') : '(无任务)'}`);
  if (lint) {
    const verdict = lintClean
      ? paint(`clean (0 error, ${lintWarns} warning)`, 'green', color)
      : paint(`FAIL (${lintErrs} error, ${lintWarns} warning)`, 'red', color);
    lines.push(`lint: ${verdict}`);
  } else {
    lines.push('lint: n/a');
  }
  return lines.join('\n');
}

// ══ renderTaskList(tasks, opts) ══════════════════════════════════════════════════════════════════
//   human：无边框对齐表格（id / status / type / executor / title）——每行含 id，grep 可过滤。
//   json：JSON 数组（裹 { ok:true, data:[…] }；每元素是原 task 子集形状稳定）。
//   空列表：human → 一行提示「(无任务)」（不崩）；json → 空数组。
export function renderTaskList(tasks: any, opts?: RenderOpts): string {
  opts = opts || {};
  const list: any[] = Array.isArray(tasks) ? tasks : [];

  if (opts.json) {
    const data = list.map((t) => ({
      id: (t && t.id) || '',
      status: (t && t.status) || '',
      type: (t && t.type) || null,
      executor: (t && t.executor) || null,
      title: (t && t.title) || '',
    }));
    return jsonString(data);
  }

  const color = !!opts.color;
  if (list.length === 0) return paint('(无任务)', 'dim', color);
  const headers = ['ID', 'STATUS', 'TYPE', 'EXECUTOR', 'TITLE'];
  const rows = list.map((t) => {
    const status = (t && t.status) || '';
    return [
      (t && t.id) || '',
      paint(status, _statusColor(status), color),
      (t && t.type) || '-',
      (t && t.executor) || '-',
      (t && t.title) || '',
    ];
  });
  return renderTable(headers, rows, { color });
}

// ══ renderTaskDetail(task, opts) ═════════════════════════════════════════════════════════════════
//   human：逐字段竖排（标签: 值），跳过缺省字段；deps/references 等数组展平为可读。
//   json：整个 task 对象原样（裹壳）。null/缺 task → human 提示 / json data:null。
export function renderTaskDetail(task: any, opts?: RenderOpts): string {
  opts = opts || {};
  if (opts.json) return jsonString(task == null ? null : task);

  const color = !!opts.color;
  if (!task || typeof task !== 'object') return paint('(无此任务)', 'dim', color);
  const t = task;
  const lines: string[] = [];
  const label = (k: string) => paint(k, 'bold', color);
  const push = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== '') lines.push(`${label(k)}: ${v}`);
  };

  // id / status 头部（status 上色）
  lines.push(`${label('id')}: ${t.id || ''}`);
  lines.push(`${label('status')}: ${paint(t.status || '', _statusColor(t.status), color)}`);
  push('type', t.type);
  push('executor', t.executor);
  push('handle', t.handle);
  push('role', t.role && t.role !== 'normal' ? t.role : undefined);
  push('parent', t.parent);
  push('title', t.title);
  push('description', t.description);
  if (Array.isArray(t.deps) && t.deps.length) push('deps', t.deps.join(', '));
  push('blocked_on', t.blocked_on);
  if (t.estimate && typeof t.estimate === 'object')
    push('estimate', `${t.estimate.value}${t.estimate.unit || ''}`);
  push('verified', t.verified === true ? 'true' : undefined);
  if (t.dependency_gate !== undefined && t.dependency_gate !== null) {
    push(
      'dependency_gate',
      typeof t.dependency_gate === 'string' ? t.dependency_gate : JSON.stringify(t.dependency_gate),
    );
  }
  push('review_verdict', t.review_verdict);
  // artifact 可能是对象
  if (t.artifact !== undefined && t.artifact !== null && t.artifact !== '') {
    push('artifact', typeof t.artifact === 'string' ? t.artifact : JSON.stringify(t.artifact));
  }
  push('justification', t.justification);
  // acceptance：string 或 object
  if (t.acceptance !== undefined && t.acceptance !== null && t.acceptance !== '') {
    if (typeof t.acceptance === 'string') push('acceptance', t.acceptance);
    else if (Array.isArray(t.acceptance.criteria)) {
      const met = t.acceptance.criteria.filter((c: any) => c && c.status === 'met').length;
      push('acceptance', `${met}/${t.acceptance.criteria.length} criteria met`);
    }
  }
  // references 展平
  if (Array.isArray(t.references) && t.references.length) {
    const refs = t.references
      .map((r: any) => `${r.kind ? `${r.kind}:` : ''}${r.ref || ''}`)
      .join(', ');
    push('references', refs);
  }
  push('created_at', t.created_at);
  push('started_at', t.started_at);
  push('finished_at', t.finished_at);
  if (t.decision_package && typeof t.decision_package === 'object') {
    push(
      'decision_package',
      `[${t.decision_package.ask_type || 'decision'}] ${t.decision_package.question || ''}`,
    );
  }
  return lines.join('\n');
}

// analysis 适配器的产出形（探测句柄 / 纯数据后归一）。
interface CoercedAnalysis {
  topoSort?: { order?: string[]; cycle?: string[] | null };
  readySet?: string[];
  criticalPath?: {
    chain?: string[];
    makespan?: number | null;
    weight_source?: string | null;
    cycle?: string[];
  };
  wipStats?: unknown;
  parallelism?: { T1?: number | null; Tinf?: number | null; parallelism?: number | null };
}

// advisory 三表面的归一形（impact / rollup / nesting·additive·见 renderGraph json 段）。
interface GraphAdvisory {
  impact: Record<string, { count: number; descendants: string[] }>;
  rollup: {
    owners: Record<string, { done: number; total: number; ratio: number; children: string[] }>;
    inconsistencies: Array<{ owner: string; nonDoneChildren: string[] }>;
  };
  nesting: {
    depth1: Array<{ owner: string; grandchild: string }>;
    parentCycles: string[][];
  };
}

// 空 advisory（传入的是纯 data 对象、无句柄方法时的缺省·json 形状只增不改）。
function _emptyAdvisory(): GraphAdvisory {
  return {
    impact: {},
    rollup: { owners: {}, inconsistencies: [] },
    nesting: { depth1: [], parentCycles: [] },
  };
}

// ── advisory 投影：只有传入的是带 per-id 方法的 analyzeGraph 句柄才能算 ─────────────────────────────
//   per-id 方法（descendants/children/rollupProgress）不是无参 getter，_coerceAnalysis 的「调一次」模式
//   不够——此处直接在句柄上遍历 ids 构造 impact/rollup，再用无参方法读 rollupConsistency/checkDepth1/
//   parentCycles 填 nesting。纯 data 对象（无这些方法 / 无 ids）→ 返回空 advisory（退化不抛·保 render 纪律）。
function _coerceAdvisory(analysis: any): GraphAdvisory {
  const out = _emptyAdvisory();
  if (!analysis || typeof analysis !== 'object') return out;
  // 句柄探测：descendants 是 per-id 方法、ids 是节点全集；缺任一即认作纯 data 对象 → 空 advisory。
  const hasHandle =
    typeof analysis.descendants === 'function' &&
    typeof analysis.children === 'function' &&
    analysis.ids &&
    typeof analysis.ids[Symbol.iterator] === 'function';
  if (!hasHandle) return out;
  try {
    const ids: string[] = Array.from(analysis.ids as Iterable<string>);
    // impact：每节点的传递后代闭包（descendants）。count = 后代数。
    for (const id of ids) {
      const desc = analysis.descendants(id);
      const list = desc && typeof desc[Symbol.iterator] === 'function' ? Array.from(desc) : [];
      out.impact[id] = { count: list.length, descendants: list as string[] };
    }
    // rollup.owners：有子的节点（children 非空）→ rollupProgress + children 列表。
    for (const id of ids) {
      const kids = analysis.children(id);
      if (Array.isArray(kids) && kids.length > 0) {
        const prog =
          typeof analysis.rollupProgress === 'function'
            ? analysis.rollupProgress(id)
            : { done: 0, total: kids.length, ratio: 0 };
        out.rollup.owners[id] = {
          done: prog.done,
          total: prog.total,
          ratio: prog.ratio,
          children: kids.slice(),
        };
      }
    }
    // rollup.inconsistencies / nesting：无参方法直接读。
    if (typeof analysis.rollupConsistency === 'function') {
      const inc = analysis.rollupConsistency();
      if (Array.isArray(inc)) out.rollup.inconsistencies = inc;
    }
    if (typeof analysis.checkDepth1 === 'function') {
      const d1 = analysis.checkDepth1();
      if (Array.isArray(d1)) out.nesting.depth1 = d1;
    }
    if (typeof analysis.parentCycles === 'function') {
      const pc = analysis.parentCycles();
      if (Array.isArray(pc)) out.nesting.parentCycles = pc;
    }
  } catch (_e) {
    // 句柄方法抛了（坏图）→ 退化为已积累的部分 + 空兜底，绝不向上抛（render 不抛纪律）。
    return out;
  }
  return out;
}

// ── analysis 适配器：接受「analyzeGraph 句柄」或「已算好的 plain data 对象」两种形态 ───────────────────
//   handler 既可直接传 analyzeGraph(board) 的句柄（含方法），也可传 { topoSort, readySet, criticalPath, wipStats }
//   的纯数据。本层探测：有同名方法就调，否则读同名字段。这让 render 与调用方解耦（render 不依赖句柄实现）。
function _coerceAnalysis(analysis: any): CoercedAnalysis {
  if (!analysis || typeof analysis !== 'object') return {};
  const get = (name: string): any => {
    if (typeof analysis[name] === 'function') {
      try {
        return analysis[name]();
      } catch (_e) {
        return undefined;
      }
    }
    return analysis[name];
  };
  return {
    topoSort: get('topoSort'),
    readySet: get('readySet'),
    criticalPath: get('criticalPath'),
    wipStats: get('wipStats'),
    parallelism: get('parallelism'),
  };
}

// ══ renderGraph(analysis, opts) ══════════════════════════════════════════════════════════════════
//   全量图分析摘要：拓扑序 / 环 / readySet / 临界路径 + makespan + weight_source / 并行度。
//   analysis = analyzeGraph(board) 句柄 或 等价 plain data（见 _coerceAnalysis）。
export function renderGraph(analysis: any, opts?: RenderOpts): string {
  opts = opts || {};
  const a = _coerceAnalysis(analysis);
  const topo = a.topoSort || {};
  const order = Array.isArray(topo.order) ? topo.order : [];
  const cycle = topo.cycle || null;
  const ready = Array.isArray(a.readySet) ? a.readySet : [];
  const cp = a.criticalPath || {};
  const cpChain = Array.isArray(cp.chain) ? cp.chain : [];
  const para = a.parallelism || {};
  // additive advisory（impact / rollup / nesting）——只有传入句柄才有值，纯 data 对象退化为空。
  const adv = _coerceAdvisory(analysis);

  if (opts.json) {
    return jsonString({
      topoOrder: order,
      cycle: cycle || null,
      readySet: ready,
      criticalPath: {
        chain: cpChain,
        makespan: cp.makespan === undefined ? null : cp.makespan,
        weight_source: cp.weight_source || null,
      },
      parallelism: {
        T1: para.T1 == null ? null : para.T1,
        Tinf: para.Tinf == null ? null : para.Tinf,
        parallelism: para.parallelism == null ? null : para.parallelism,
      },
      // ── additive（json 形状只增不改·上面五字段逐字不变）────────────────────────────────────────
      impact: adv.impact,
      rollup: adv.rollup,
      nesting: adv.nesting,
    });
  }

  const color = !!opts.color;
  const lines: string[] = [];
  if (cycle && cycle.length) {
    lines.push(paint(`CYCLE detected: ${cycle.join(' -> ')}`, 'red', color));
  }
  lines.push(`topo order (${order.length}): ${order.length ? order.join(' -> ') : '(空)'}`);
  lines.push(`ready (${ready.length}): ${ready.length ? ready.join(', ') : '(无)'}`);
  const ms = cp.makespan === undefined || cp.makespan === null ? 'n/a' : `${cp.makespan}h`;
  lines.push(
    `critical path (${cpChain.length}): ${cpChain.length ? cpChain.join(' -> ') : '(空)'}`,
  );
  lines.push(`  makespan: ${ms}  weight_source: ${cp.weight_source || 'n/a'}`);
  if (para.T1 != null) {
    const par = typeof para.parallelism === 'number' ? para.parallelism.toFixed(2) : 'n/a';
    lines.push(`parallelism: T1=${para.T1} T∞=${para.Tinf} ratio=${par}`);
  }
  // ── 高信号告警行（只增·不 dump 全量 per-node impact 噪音）──────────────────────────────────────
  for (const inc of adv.rollup.inconsistencies) {
    lines.push(
      paint(
        `⚠ rollup 不一致: ${inc.owner} → 非done子: ${(inc.nonDoneChildren || []).join(', ')}`,
        'yellow',
        color,
      ),
    );
  }
  for (const d of adv.nesting.depth1) {
    lines.push(
      paint(`⚠ nesting depth>1: ${d.owner} → 孙节点 ${d.grandchild}（违 depth=1）`, 'red', color),
    );
  }
  for (const pc of adv.nesting.parentCycles) {
    lines.push(paint(`⚠ parent 环: ${(pc || []).join(' -> ')}`, 'red', color));
  }
  return lines.join('\n');
}

// ══ renderCriticalPath(analysis, opts) ═══════════════════════════════════════════════════════════
//   专注临界路径链 + makespan + weight_source（board critical-path 命令）。
//   诚实性（graph-core §5.6）：weight_source ∈ measured|estimate 才有小时级 makespan；mixed/unit/cycle → null。
export function renderCriticalPath(analysis: any, opts?: RenderOpts): string {
  opts = opts || {};
  const a = _coerceAnalysis(analysis);
  const cp = a.criticalPath || {};
  const chain = Array.isArray(cp.chain) ? cp.chain : [];
  const makespan = cp.makespan === undefined ? null : cp.makespan;
  const ws = cp.weight_source || null;

  if (opts.json) {
    return jsonString({ chain, makespan, weight_source: ws });
  }

  const color = !!opts.color;
  const lines: string[] = [];
  if (ws === 'cycle') {
    lines.push(paint('critical path: 不可算（图含环）', 'red', color));
    if (Array.isArray(cp.cycle) && cp.cycle.length) lines.push(`  cycle: ${cp.cycle.join(' -> ')}`);
    return lines.join('\n');
  }
  lines.push(`critical path (${chain.length}): ${chain.length ? chain.join(' -> ') : '(空)'}`);
  const ms = makespan === null ? 'n/a（非纯实测/估点·不报伪精确）' : `${makespan}h`;
  lines.push(`makespan: ${ms}`);
  lines.push(`weight_source: ${ws || 'n/a'}`);
  return lines.join('\n');
}

// ══ renderNext(readyTasks, opts) ═════════════════════════════════════════════════════════════════
//   「现在能派发什么」——readySet。入参既可是 id 字符串数组，也可是 task 对象数组（探测后统一渲染）。
//   human：复用 task 表格（若是对象）或裸 id 列表；json：id 数组 或 task 子集数组（裹壳）。
export function renderNext(readyTasks: any, opts?: RenderOpts): string {
  opts = opts || {};
  const list: any[] = Array.isArray(readyTasks) ? readyTasks : [];
  const isObjList = list.length > 0 && typeof list[0] === 'object' && list[0] !== null;

  if (opts.json) {
    if (isObjList) {
      return jsonString(
        list.map((t) => ({
          id: (t && t.id) || '',
          status: (t && t.status) || '',
          type: (t && t.type) || null,
          executor: (t && t.executor) || null,
          title: (t && t.title) || '',
        })),
      );
    }
    return jsonString(list.map((x) => String(x)));
  }

  const color = !!opts.color;
  if (list.length === 0) return paint('(现在没有可派发的任务)', 'dim', color);
  if (isObjList) return renderTaskList(list, { color });
  // 裸 id 列表
  return list.map((id) => String(id)).join('\n');
}

// ══ renderLintReport(lintResult, opts) ═══════════════════════════════════════════════════════════
//   human：对齐 board-lint-core.formatReport 的风格（header + [hard]/[warn] 行）。
//   json：{ ok, violations:[{rule, level, task?, message}] }（裹 { ok:true, data:{…} } 外壳）。
//   lintResult = lintBoard(text) 结果 { errors:[{rule,message,task?}], warnings:[…] }。
export function renderLintReport(lintResult: any, opts?: RenderOpts): string {
  opts = opts || {};
  const res = lintResult && typeof lintResult === 'object' ? lintResult : {};
  const errors: any[] = Array.isArray(res.errors) ? res.errors : [];
  const warnings: any[] = Array.isArray(res.warnings) ? res.warnings : [];
  const clean = errors.length === 0;

  if (opts.json) {
    const violations = ([] as any[])
      .concat(errors.map((e) => _violation(e, 'hard')))
      .concat(warnings.map((w) => _violation(w, 'warn')));
    const data: Record<string, any> = { ok: clean, violations };
    // additive：调用方给了 report（formatReport 文本）→ 折进 data.report（与文本模式同一份）。
    //   board-lint hook 据此注入；不传则不带（json 形状只增不改）。
    if (typeof opts.report === 'string') data.report = opts.report;
    return jsonString(data);
  }

  const color = !!opts.color;
  if (clean && warnings.length === 0) {
    return paint('cc-master board lint: PASS（0 hard error，0 warning）', 'green', color);
  }
  const lines: string[] = [];
  const head = !clean
    ? paint(
        `cc-master board lint: FAIL（${errors.length} 个 hard error${warnings.length ? `，${warnings.length} warning` : ''}）`,
        'red',
        color,
      )
    : paint(
        `cc-master board lint: PASS（0 hard error，${warnings.length} warning）`,
        'green',
        color,
      );
  lines.push(head, '');
  for (const e of errors) {
    lines.push(
      `${paint('[hard]', 'red', color)} ${e.rule}${e.task ? ` (${e.task})` : ''} ${e.message}`,
      '',
    );
  }
  for (const w of warnings) {
    lines.push(
      `${paint('[warn]', 'yellow', color)} ${w.rule}${w.task ? ` (${w.task})` : ''} ${w.message}`,
      '',
    );
  }
  return lines.join('\n').replace(/\n+$/, '');
}
function _violation(entry: any, level: string): Record<string, any> {
  const v: Record<string, any> = {
    rule: (entry && entry.rule) || '',
    level,
    message: (entry && entry.message) || '',
  };
  if (entry && entry.task) v.task = entry.task;
  return v;
}

// ══ renderLogList(entries, opts) ═════════════════════════════════════════════════════════════════
//   append-only 审计流（log list 命令）。entries = board.log（[{ts, summary, kind?, task?, detail?, refs?}]）。
//   human：无边框对齐表格（ts / kind / task / summary）——每行含 ts，grep/管道友好。
//   json：JSON 数组（原条目子集形状稳定·裹 { ok:true, data:[…] }）。空列表：human 提示 / json 空数组。
export function renderLogList(entries: any, opts?: RenderOpts): string {
  opts = opts || {};
  const list: any[] = Array.isArray(entries) ? entries : [];

  if (opts.json) {
    const data = list.map((e) => ({
      ts: (e && e.ts) || '',
      kind: (e && e.kind) || null,
      task: (e && e.task) || null,
      summary: (e && e.summary) || '',
      detail: (e && e.detail) || null,
      refs: e && Array.isArray(e.refs) ? e.refs : null,
    }));
    return jsonString(data);
  }

  const color = !!opts.color;
  if (list.length === 0) return paint('(无 log 条目)', 'dim', color);
  const headers = ['TS', 'KIND', 'TASK', 'SUMMARY'];
  const rows = list.map((e) => [
    (e && e.ts) || '',
    (e && e.kind) || '-',
    (e && e.task) || '-',
    (e && e.summary) || '',
  ]);
  return renderTable(headers, rows, { color });
}

// paint 导出（测试便利 / handler 可用·原 CJS 也在 module.exports 暴露 paint）。
export { paint };
