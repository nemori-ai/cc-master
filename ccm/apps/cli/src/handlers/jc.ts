// handlers/jc.ts — judgment_calls 自决诚实台账 handler（noun jc·cli-design §3）。
//
// 照抄 log.ts 范式：每 verb 导出 handler(ctx) → exitCode；写 verb 用 _common.runWrite（resolve / mutate /
//   render），读 verb 用 _common.runRead（resolve / compute / render）。buildFields 把 parsed flags 按 registry
//   的 field/transform 映射成 mutation 入参；handler 直接 import leaf 模块（不经 ctx 注入·契约 §三 ctx 形态）。
//   mutation / discover 的 throw **不在 handler 内 catch**——冒泡给 router 按 .errKind 映射退出码。
//
// jc 专属点（与兄弟 noun 不同处）：
//   · id 自动分配：mutations.addJc 取 fields.id（**不自分配**），故由本 handler 从既有 judgment_calls 算
//     下一个 J<N>（max 数字后缀 + 1，缺/非 J 前缀按 0 计·见 nextJcId）。
//   · render：render.ts 暂无 renderJcList / renderJcDetail——本 handler 自带渲染（human 表格 / --json 裹壳），
//     沿用 render.jsonString + render.renderTable 的统一形态（与 renderLogList 同风格·形状只增不改）。
//   · --set / --set-json 通用逃生口（add）：buildFields 收集成 sets/setJsons，addJc 后逐条 applySet/applySetJson。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib。
// 武装闸豁免：纯 handler 模块（无 hook 入口，只被 router 经 registry.handler 调）——见 AGENTS.md §3 / §12。
//
// T2b port 注：require → ESM import；module.exports → 命名导出。逻辑/正则/报错文案/.errKind 逐字保持。

import * as mutations from '../mutations.js';
import { REGISTRY } from '../registry.js';
import * as render from '../render.js';
import { type BoardArg, buildFields, type Ctx, runRead, runWrite } from './_common.js';

// 带 .errKind 的 Error（router 据此映射退出码）。
interface KindedError extends Error {
  errKind?: string;
}

// 自决条目的最小读形（渲染只读这些字段·其余原样裹壳）。
interface JcLike {
  id?: string;
  status?: string;
  severity?: string;
  category?: string;
  summary?: string;
  decision?: string;
  rationale?: string;
  impact?: string;
  refs?: unknown;
  task_ref?: string;
  raised_at?: string;
  resolved_at?: string;
  note?: string;
  [k: string]: unknown;
}

// ── nextJcId(board) → 下一个 J<N> id。扫描既有 judgment_calls 的 id，取形如 J<数字> 的最大后缀 + 1。
//   空台账 / 全非 J 前缀 → 'J1'。非数字后缀（如 'Jx'）忽略不计（不阻塞分配·只取能解析的最大值）。
export function nextJcId(board: unknown): string {
  const b = board as { judgment_calls?: JcLike[] };
  const list = b && Array.isArray(b.judgment_calls) ? b.judgment_calls : [];
  let max = 0;
  for (const jc of list) {
    const id = jc && jc.id;
    if (typeof id !== 'string') continue;
    const m = /^J(\d+)$/.exec(id);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `J${max + 1}`;
}

// ── 自带 render：renderJcList（human 表格 / --json 数组）──────────────────────────────────────────
//   human：无边框对齐表格（id / status / severity / category / summary）——每行含 id，grep 可过滤。
//   json：JSON 数组（裹 { ok:true, data:[…] }·形状稳定）。空列表：human 提示 / json 空数组。
export function renderJcList(list: unknown, opts?: { json?: boolean; color?: boolean }): string {
  opts = opts || {};
  const items = (Array.isArray(list) ? list : []) as JcLike[];
  if (opts.json) {
    const data = items.map((j) => ({
      id: (j && j.id) || '',
      status: (j && j.status) || '',
      severity: (j && j.severity) || null,
      category: (j && j.category) || null,
      summary: (j && j.summary) || '',
    }));
    return render.jsonString(data);
  }
  const color = !!opts.color;
  if (items.length === 0) return render.paint('(无自决台账条目)', 'dim', color);
  const headers = ['ID', 'STATUS', 'SEVERITY', 'CATEGORY', 'SUMMARY'];
  const rows = items.map((j) => [
    (j && j.id) || '',
    (j && j.status) || '-',
    (j && j.severity) || '-',
    (j && j.category) || '-',
    (j && j.summary) || '',
  ]);
  return render.renderTable(headers, rows, { color });
}

// ── 自带 render：renderJcDetail（human 竖排 / --json 整对象）─────────────────────────────────────
//   human：逐字段竖排（标签: 值），跳过缺省字段。json：整个 jc 对象原样（裹壳）。null/缺 → human 提示 / data:null。
export function renderJcDetail(jc: unknown, opts?: { json?: boolean; color?: boolean }): string {
  opts = opts || {};
  if (opts.json) return render.jsonString(jc == null ? null : jc);
  const color = !!opts.color;
  if (!jc || typeof jc !== 'object') return render.paint('(无此自决条目)', 'dim', color);
  const j = jc as JcLike;
  const lines: string[] = [];
  const label = (k: string) => render.paint(k, 'bold', color);
  const push = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== '') lines.push(`${label(k)}: ${v}`);
  };
  push('id', j.id);
  push('status', j.status);
  push('summary', j.summary);
  push('category', j.category);
  push('severity', j.severity);
  push('decision', j.decision);
  push('rationale', j.rationale);
  push('impact', j.impact);
  if (Array.isArray(j.refs) && j.refs.length) push('refs', j.refs.join(', '));
  push('task_ref', j.task_ref);
  push('raised_at', j.raised_at);
  push('resolved_at', j.resolved_at);
  push('note', j.note);
  return lines.join('\n');
}

// ── jc add ──────────────────────────────────────────────────────────────────────────────────────
//   summary 是必填 positional（router 已校验非空）；flags：--category / --severity / --decision / --rationale /
//     --impact / --refs（refs csv）/ --task-ref（field task_ref）+ --set / --set-json 逃生口。
//   id 自动分配（nextJcId）；addJc 后若有 --set/--set-json 逐条 applySet/applySetJson（写 ✎ flexible path）。
export function add(ctx: Ctx): number {
  const spec = REGISTRY.jc?.add;
  return runWrite(ctx, {
    mutate: (board, c) => {
      const { fields, sets, setJsons } = buildFields(c.values, spec, { stdin: c.stdin });
      const args = {
        id: nextJcId(board),
        summary: c.positionals[0],
        category: fields.category,
        severity: fields.severity,
        decision: fields.decision,
        rationale: fields.rationale,
        impact: fields.impact,
        refs: fields.refs,
        task_ref: fields.task_ref,
      };
      let next = mutations.addJc(board as BoardArg, args);
      // --set / --set-json 通用逃生口（🔒 path 由 applySet 自拒·errKind Validation 冒泡）。
      for (const s of sets) next = mutations.applySet(next, s.path, s.value);
      for (const s of setJsons) next = mutations.applySetJson(next, s.path, s.value);
      return next;
    },
    render: (next, c, { dryRun }) => {
      const nb = next as { judgment_calls?: JcLike[] };
      const list = nb.judgment_calls || [];
      if (c.flags.json) return renderJcList(list, { json: true });
      const entry = list[list.length - 1];
      const prefix = dryRun ? '[dry-run] 将记一条自决: ' : '自决已记: ';
      const id = entry ? entry.id : '';
      const summary = entry ? entry.summary : '';
      return `${prefix}${id} ${summary}`;
    },
  });
}

// ── jc list ─────────────────────────────────────────────────────────────────────────────────────
//   读 verb：compute = 按 --status / --severity 过滤 board.judgment_calls；render = renderJcList。
export function list(ctx: Ctx): number {
  return runRead(ctx, {
    compute: (board) => {
      const b = board as { judgment_calls?: JcLike[] };
      const items = b && Array.isArray(b.judgment_calls) ? b.judgment_calls : [];
      const fStatus = ctx.values && ctx.values.status;
      const fSeverity = ctx.values && ctx.values.severity;
      return items.filter((j) => {
        if (fStatus && j.status !== fStatus) return false;
        if (fSeverity && j.severity !== fSeverity) return false;
        return true;
      });
    },
    render: (items, c) => renderJcList(items, { json: !!c.flags.json, color: c.flags.color }),
  });
}

// ── jc show ─────────────────────────────────────────────────────────────────────────────────────
//   读 verb：compute = 按 id positional 定位（找不到 → throw NotFound 冒泡 router 映射 exit 5）；render = renderJcDetail。
export function show(ctx: Ctx): number {
  return runRead(ctx, {
    compute: (board) => {
      const id = ctx.positionals[0];
      const b = board as { judgment_calls?: JcLike[] };
      const items = b && Array.isArray(b.judgment_calls) ? b.judgment_calls : [];
      const jc = items.find((j) => j && j.id === id);
      if (!jc) {
        const e = new Error(`judgment_call not found: ${id}`) as KindedError;
        e.errKind = 'NotFound';
        throw e;
      }
      return jc;
    },
    render: (jc, c) => renderJcDetail(jc, { json: !!c.flags.json, color: c.flags.color }),
  });
}

// ── jc resolve ──────────────────────────────────────────────────────────────────────────────────
//   写 verb：id 必填 positional；--status（required·upheld|overturned）/ --note。
//   用 mutations.resolveJc（id 不存在 → throw NotFound 冒泡映射 exit 5）。
export function resolve(ctx: Ctx): number {
  const spec = REGISTRY.jc?.resolve;
  return runWrite(ctx, {
    mutate: (board, c) => {
      const { fields } = buildFields(c.values, spec, { stdin: c.stdin });
      const id = c.positionals[0] as string;
      return mutations.resolveJc(board as BoardArg, id, {
        status: fields.status as string | undefined,
        note: fields.note as string | undefined,
      });
    },
    render: (next, c, { dryRun }) => {
      const id = c.positionals[0];
      const nb = next as { judgment_calls?: JcLike[] };
      const items = nb.judgment_calls || [];
      const jc = items.find((j) => j && j.id === id);
      if (c.flags.json) return renderJcDetail(jc, { json: true });
      const prefix = dryRun ? '[dry-run] 将裁决自决: ' : '自决已裁决: ';
      const status = jc ? jc.status : '';
      return `${prefix}${id} → ${status}`;
    },
  });
}
