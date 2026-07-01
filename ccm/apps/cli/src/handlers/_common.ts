// handlers/_common.ts — 共享读 / 写关卡 runner（设计稿 §5 写入关卡管线·契约 §三 handlers）。
//
// 每个 handler 不重复写「发现板 → 加锁 → 读 → mutate → lint → 落盘」这套管线——它们调 runWrite / runRead，
//   只提供三个回调（resolve / mutate / render 或 resolve / compute / render）。这把写入关卡的纪律收口一处：
//   · 拒绝判据 = post-mutation 板含任何 hard error（--force 越，warn 永不挡）。
//   · --dry-run 跑完整校验但不落盘。
//   · lint 硬错是 **return EXIT.VALIDATION**（不是 throw）；discover / mutation 的 throw **不 catch**——
//     让其冒泡给 P5.3 router 按 .errKind 映射退出码。
//
// buildFields：把 parseArgs 的 values 按 registry spec.options 的 field/transform 组装成 mutation 入参对象
//   （+ 收集 --set / --set-json 成操作列表 sets/setJsons）。这是「flag → FIELDS dotpath」零漂移映射的执行体。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib。handler 直接 import leaf 模块（不经 ctx 注入）。
// 武装闸豁免：纯 helper 库（无 hook 入口，只被 handler / CLI import）——见 AGENTS.md §3 红线6 / §12 grep 门豁免。
//
// T2b port 注：原 CJS 源（handlers/_common.js）的 require → ESM import；module.exports → 命名导出。
//   引擎 rewire：原 require('../board-lint-core.js') 改成从 `@ccm/engine` import { lintBoard, formatReport }。
//   逻辑/数值/正则/报错文案/.errKind 逐字保持。`fs` 由文件顶层 import（原在 runWrite 内 require）。

import * as fs from 'node:fs';
import { formatReport, lintBoard, reconcileGating } from '@ccm/engine';
import * as discover from '../discover.js';
import * as io from '../io.js';
import type { OptionSpec, VerbSpec } from '../registry.js';

const EXIT = io.EXIT;

// 带 .errKind 的 Error（router 据此映射退出码）。
interface KindedError extends Error {
  errKind?: string;
}

// mutations.* 的 board 入/出参类型。mutations.ts 的 `Board`（= Record<string, any>）未导出——本仓共享一个
//   同义别名（Record<string, any>·与 mutations 内部完全一致·any 与 mutations 同源，biome noExplicitAny 已 off），
//   handler 把动态 unknown 形参窄断言成它喂 mutation。忠实偏离记一笔：原 CJS 无类型，故无此别名；
//   TS 下用它把「mutation 的 board 入参类型」收口一处。
export type BoardArg = Record<string, any>;

// ctx 契约形态（契约 §三 ctx 形态·router.buildCtx 产出）。handler / runner 共用。
export interface Ctx {
  values: Record<string, unknown>;
  positionals: string[];
  flags: {
    json: boolean;
    dryRun: boolean;
    force: boolean;
    yes: boolean;
    quiet: boolean;
    verbose: boolean;
    color: boolean;
  };
  sid: string;
  env: Record<string, string | undefined>;
  out: (s: string) => void;
  err: (s: string) => void;
  stdin?: { fd?: number };
  isTTY?: boolean;
}

// buildFields 收集的 --set / --set-json 操作项。
export interface SetOp {
  path: string;
  value: string;
}

// buildFields 出参。fields 是 flag → 转换后值的 map（dotpath / 单段当 key）。
export interface BuiltFields {
  fields: Record<string, unknown>;
  sets: SetOp[];
  setJsons: SetOp[];
}

// ── buildFields(values, spec) → { fields, sets, setJsons } ────────────────────────────────────────
//   遍历 spec.options：凡带 field 的 flag 且 values 里有值 → 按 transform 转换后写进 fields[<field 末段 / dotpath>]。
//     · transform:'duration' → io.parseDuration（"3h"→{value,unit}）。
//     · transform:'csv'      → 拆逗号成数组（trim + 去空）；multiple 的 flag 已是数组，逐项拆后扁平化。
//     · transform:'ref'      → 拆 "kind:ref" 成 {kind, ref}；multiple → 收集成数组。
//     · transform:'input'    → io.readInputSpec（'-'/'@file'/字面量）。
//     · 无 transform         → 原值（string / boolean）。
//   --set / --set-json（transform kv/json，无 field）→ 收集成 sets / setJsons 操作列表（{path, value}）。
//   field 形如 'scheduling.wip_limit'（dotpath）或 'title'（单段）——本函数把整条 dotpath 当 key 存进 fields，
//     由各 handler 自行决定喂给哪个 mutation（mutation 入参用驼峰键时 handler 自己改名；buildFields 只忠实搬运）。
export function buildFields(
  values: Record<string, unknown> | null | undefined,
  spec: VerbSpec | null | undefined,
  opts: { stdin?: { fd?: number } } = {},
): BuiltFields {
  opts = opts || {};
  const v = values || {};
  const options: Record<string, OptionSpec> = (spec && spec.options) || {};
  const fields: Record<string, unknown> = {};
  const sets: SetOp[] = [];
  const setJsons: SetOp[] = [];

  for (const flag of Object.keys(options)) {
    const o = options[flag];
    if (!o) continue; // 防御（noUncheckedIndexedAccess）：遍历 keys 必有值，仅为窄类型。
    if (v[flag] === undefined) continue;
    const raw = v[flag];

    // --set / --set-json 逃生口（无 field·收集成操作列表）。
    if (o.transform === 'kv') {
      for (const pair of asArray(raw)) sets.push(parseKv(pair));
      continue;
    }
    if (o.transform === 'json') {
      for (const pair of asArray(raw)) setJsons.push(parseKv(pair));
      continue;
    }

    if (!o.field) continue; // 无 field 且非 set/json 的 flag（如 --log / --json）不进 fields。

    fields[o.field] = transformValue(raw, o, opts);
  }

  return { fields, sets, setJsons };
}

function asArray<T>(x: T | T[]): T[] {
  return Array.isArray(x) ? x : [x];
}

// transformValue(raw, optSpec, opts) → 按 optSpec.transform 转换单个 flag 值。
function transformValue(raw: unknown, o: OptionSpec, opts: { stdin?: { fd?: number } }): unknown {
  switch (o.transform) {
    case 'duration': {
      // 单值（estimate / ship-every）。
      const s = Array.isArray(raw) ? raw[raw.length - 1] : raw;
      return io.parseDuration(s as string);
    }
    case 'csv': {
      // multiple 的 flag（--add-dep 可重复）→ 每项再拆逗号，扁平化；单值 → 直接拆。
      const items = asArray(raw);
      const out: string[] = [];
      for (const it of items) {
        for (const part of String(it).split(',')) {
          const t = part.trim();
          if (t) out.push(t);
        }
      }
      return out;
    }
    case 'ref': {
      // multiple → 数组 of {kind, ref}；单值 → 数组（统一形态，referenced[] 总是数组）。
      return asArray(raw).map(parseRef);
    }
    case 'input': {
      // '-' / '@file' / 字面量。单值（取最后一次）。
      const s = Array.isArray(raw) ? raw[raw.length - 1] : raw;
      return io.readInputSpec(s as string, { stdin: opts.stdin });
    }
    default: {
      // 无 transform：boolean 原样；string 取最后一次（multiple 极少出现在无 transform 上）。
      if (Array.isArray(raw)) return raw[raw.length - 1];
      return raw;
    }
  }
}

// parseRef('kind:ref') → {kind, ref}。无冒号 → {kind:undefined, ref} 由 lint(FMT-REF) 兜。
//   ref 本身可能含冒号（URL https://…）——只在第一个冒号切分。
export function parseRef(spec: unknown): { kind?: string; ref: string } {
  const s = String(spec);
  const idx = s.indexOf(':');
  if (idx === -1) return { ref: s };
  const kind = s.slice(0, idx);
  const ref = s.slice(idx + 1);
  // kind 段若是 http/https（即整体是个无 kind 的 URL）→ 当无 kind 的纯 ref。
  if (kind === 'http' || kind === 'https') return { ref: s };
  return { kind, ref };
}

// parseKv('path=value') → {path, value}。无 '=' → throw Usage（router 映射 exit 2）。
//   value 可能含 '='（如 JSON 串）——只在第一个 '=' 切分。
export function parseKv(spec: unknown): SetOp {
  const s = String(spec);
  const idx = s.indexOf('=');
  if (idx === -1) {
    const e = new Error(
      `--set/--set-json 须是 path=value 形式（收到 ${JSON.stringify(s)}）`,
    ) as KindedError;
    e.errKind = 'Usage';
    throw e;
  }
  return { path: s.slice(0, idx), value: s.slice(idx + 1) };
}

// ── resolveBoardIgnoringGoal(ctx) → { boardPath, board }（发现板时**忽略** --goal）─────────────────────
//   `goal` 是全局 flag：对绝大多数 verb 它是「按 goal 子串发现哪块板」的消歧过滤器（goalSubstr），故默认
//     resolve（runWrite/runRead）一律把 ctx.values.goal 当 goalSubstr 喂 resolveBoard。但少数写 verb
//     （board update / cadence open）把 `--goal` 重载成 **payload 字段**（重定板 goal / 设 iteration goal）——
//     此时它绝非发现过滤器。若仍把 payload `--goal` 漏进发现当 goalSubstr，会按「现有 goal 含新串」过滤，
//     fresh-init 未认领板（现有 goal 不含新串）即被滤掉 → 假 NotFound（同 verb 跨 flag 发现不一致·Finding #77）。
//   故这些 verb 改用本 resolve：除 goalSubstr 恒省略外，与默认 resolve **完全同一条**两层匹配
//     （精确 sid → 未认领 session_id:"" 兜底·收口到单一 resolveBoard），保证 board update 的所有 flag
//     （--goal / --wip-limit / --git…）走一致发现路径。board init 另有 initResolve（建新板·本就不发现）。
export function resolveBoardIgnoringGoal(ctx: Ctx): { boardPath: string; board: unknown } {
  return discover.resolveBoard({
    boardFlag: ctx.values && (ctx.values.board as string),
    sid: ctx.sid,
    homeFlag: ctx.values && (ctx.values.home as string),
    // goalSubstr 故意省略：本 verb 的 --goal 是 payload，非发现过滤器（Finding #77）。
    env: ctx.env,
  });
}

// runWrite / runRead 回调签名。render 的第三参（{dryRun}）只在 runWrite 传。
type ResolveFn = (ctx: Ctx) => { boardPath: string; board: unknown };
type MutateFn = (board: unknown, ctx: Ctx) => unknown;
type WriteRenderFn = (
  next: unknown,
  ctx: Ctx,
  opts: { dryRun: boolean; boardPath: string },
) => string;
type ComputeFn = (board: unknown, ctx: Ctx) => unknown;
type ReadRenderFn = (result: unknown, ctx: Ctx) => string;

// ── runWrite(ctx, { resolve, mutate, render }) → exitCode ─────────────────────────────────────────
//   设计稿 §5 写入关卡：resolveBoard（discover）→ withBoardLock( read → mutate → lint → 拒/写 )。
//     resolve(ctx) → { boardPath, board }（默认用 discover.resolveBoard；handler 可覆盖，如 board.init 不发现而新建）。
//     mutate(board, ctx) → nextBoard（纯函数·调 mutations.*）。
//     render(nextBoard, ctx, { dryRun }) → string（成功 / dry-run 预览的输出）。
//   流程：
//     1. { boardPath, board } = resolve(ctx)                    （不 catch throw → 冒泡给 router）
//     2. withBoardLock(boardPath, () => {                        （torn-write 防护）
//     3.   raw = JSON.parse(读盘)                                （以盘上最新为准，非 resolve 时的快照）
//     4.   next = mutate(raw, ctx)                               （不 catch throw → 冒泡）
//     5.   res = lintBoard(JSON.stringify(next))
//     6.   if res.errors.length>0 && !force: err(formatReport); return EXIT.VALIDATION   （硬错 return·非 throw）
//     7.   if res.warnings.length: err(warnings)                 （warn 永不挡）
//     8.   if dryRun: out(render(next, {dryRun:true})); return EXIT.OK   （不落盘）
//     9.   writeFileAtomicSync(boardPath, JSON.stringify(next,null,2)+'\n')
//    10.   out(render(next, {dryRun:false})); return EXIT.OK
//   })
//   注：board.init 之类「不发现既有板而新建文件」的写命令传入自定义 resolve（返回目标路径 + 空载板/null），
//     mutate 忽略 raw 直接产板；此时仍走 lock + lint + 原子写同一管线。
export function runWrite(
  ctx: Ctx,
  { resolve, mutate, render }: { resolve?: ResolveFn; mutate: MutateFn; render: WriteRenderFn },
): number {
  const flags = ctx.flags || ({} as Ctx['flags']);

  const resolved =
    typeof resolve === 'function'
      ? resolve(ctx)
      : discover.resolveBoard({
          boardFlag: ctx.values && (ctx.values.board as string),
          sid: ctx.sid,
          homeFlag: ctx.values && (ctx.values.home as string),
          goalSubstr: ctx.values && (ctx.values.goal as string),
          env: ctx.env,
        });
  const boardPath = resolved.boardPath;

  return io.withBoardLock(boardPath, () => {
    // 读盘（以盘上最新为准）。resolve 已读过一份，但加锁后重读防 TOCTOU。init 路径盘上可能没文件 → null。
    let raw: unknown = resolved.board || null;
    try {
      const text = fs.readFileSync(boardPath, 'utf8');
      raw = JSON.parse(text);
    } catch (_e) {
      // 文件不存在 / 坏 JSON：init 路径合法（raw 留 null，mutate 自建）；非 init 路径 resolve 已保证存在。
    }

    // mutate 产出后跑一趟 deps 驱动的门控归一（reconcileGating·ADR-023）：所有写 verb 自动获得
    //   ready↔blocked 归一——status∈{ready,blocked} 且无 blocked_on 的 task 按 deps 完成度定 ready/blocked
    //   （有 blocked_on 的语义阻塞豁免·不产生新 done·幂等）。lint 校验的是归一后的板（含 BIZ-STATUS-DEPS）。
    const next = reconcileGating(mutate(raw, ctx));
    const res = lintBoard(JSON.stringify(next));

    if (res.errors.length > 0 && !flags.force) {
      ctx.err(formatReport(res));
      return EXIT.VALIDATION;
    }
    // QA #6：成功写不再每次重打整板 warning（多任务时刷屏、淹没确认）——默认只一行摘要 + 指路，
    //   --verbose 才全量展开。hard error 仍走上方 EXIT.VALIDATION 分支全量打（那是写入闸要解释为何拒绝）。
    if (res.warnings.length > 0 && !flags.quiet) {
      if (flags.verbose) {
        ctx.err(formatReport({ errors: [], warnings: res.warnings }));
      } else {
        ctx.err(
          `lint: 0 hard error，${res.warnings.length} warning（\`ccm board lint\` 看详情；--verbose 展开）`,
        );
      }
    }

    if (flags.dryRun) {
      ctx.out(render(next, ctx, { dryRun: true, boardPath }));
      return EXIT.OK;
    }

    io.writeFileAtomicSync(boardPath, `${JSON.stringify(next, null, 2)}\n`);
    ctx.out(render(next, ctx, { dryRun: false, boardPath }));
    return EXIT.OK;
  });
}

// ── runRead(ctx, { resolve, compute, render }) → exitCode ─────────────────────────────────────────
//   设计稿 §5 读路径：resolveBoard → 算 → render（human|json）→ EXIT.OK。只读不加锁。
//     resolve(ctx) → { boardPath, board }（默认 discover.resolveBoard）。
//     compute(board, ctx) → 任意结果（render 的输入；如 task list 过滤后的数组、graph 分析句柄）。
//     render(result, ctx) → string。
//   不 catch resolve 的 throw（NotFound/Ambiguous 冒泡给 router 映射 exit 5）。
export function runRead(
  ctx: Ctx,
  { resolve, compute, render }: { resolve?: ResolveFn; compute?: ComputeFn; render: ReadRenderFn },
): number {
  const resolved =
    typeof resolve === 'function'
      ? resolve(ctx)
      : discover.resolveBoard({
          boardFlag: ctx.values && (ctx.values.board as string),
          sid: ctx.sid,
          homeFlag: ctx.values && (ctx.values.home as string),
          goalSubstr: ctx.values && (ctx.values.goal as string),
          env: ctx.env,
        });
  const result = typeof compute === 'function' ? compute(resolved.board, ctx) : resolved.board;
  ctx.out(render(result, ctx));
  return EXIT.OK;
}
