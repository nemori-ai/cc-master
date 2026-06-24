'use strict';
// handlers/_common.js — 共享读 / 写关卡 runner（设计稿 §5 写入关卡管线·契约 §三 handlers）。
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
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib。CommonJS。handler 直接 require leaf 模块（不经 ctx 注入）。
// 武装闸豁免：纯 helper 库（无 hook 入口，只被 handler / CLI require）——见 AGENTS.md §3 红线6 / §12 grep 门豁免。

const io = require('../io.js');
const discover = require('../discover.js');
const lintCore = require('../board-lint-core.js');

const EXIT = io.EXIT;

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
function buildFields(values, spec, opts) {
  opts = opts || {};
  const v = values || {};
  const options = (spec && spec.options) || {};
  const fields = {};
  const sets = [];
  const setJsons = [];

  for (const flag of Object.keys(options)) {
    const o = options[flag];
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

function asArray(x) {
  return Array.isArray(x) ? x : [x];
}

// transformValue(raw, optSpec, opts) → 按 optSpec.transform 转换单个 flag 值。
function transformValue(raw, o, opts) {
  switch (o.transform) {
    case 'duration': {
      // 单值（estimate / ship-every）。
      const s = Array.isArray(raw) ? raw[raw.length - 1] : raw;
      return io.parseDuration(s);
    }
    case 'csv': {
      // multiple 的 flag（--add-dep 可重复）→ 每项再拆逗号，扁平化；单值 → 直接拆。
      const items = asArray(raw);
      const out = [];
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
      return io.readInputSpec(s, { stdin: opts.stdin });
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
function parseRef(spec) {
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
function parseKv(spec) {
  const s = String(spec);
  const idx = s.indexOf('=');
  if (idx === -1) {
    const e = new Error(`--set/--set-json 须是 path=value 形式（收到 ${JSON.stringify(s)}）`);
    e.errKind = 'Usage';
    throw e;
  }
  return { path: s.slice(0, idx), value: s.slice(idx + 1) };
}

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
function runWrite(ctx, { resolve, mutate, render }) {
  const flags = ctx.flags || {};
  const fs = require('fs');

  const resolved = (typeof resolve === 'function')
    ? resolve(ctx)
    : discover.resolveBoard({
        boardFlag: ctx.values && ctx.values.board,
        sid: ctx.sid,
        homeFlag: ctx.values && ctx.values.home,
        goalSubstr: ctx.values && ctx.values.goal,
        env: ctx.env,
      });
  const boardPath = resolved.boardPath;

  return io.withBoardLock(boardPath, () => {
    // 读盘（以盘上最新为准）。resolve 已读过一份，但加锁后重读防 TOCTOU。init 路径盘上可能没文件 → null。
    let raw = resolved.board || null;
    try {
      const text = fs.readFileSync(boardPath, 'utf8');
      raw = JSON.parse(text);
    } catch (_e) {
      // 文件不存在 / 坏 JSON：init 路径合法（raw 留 null，mutate 自建）；非 init 路径 resolve 已保证存在。
    }

    const next = mutate(raw, ctx);
    const res = lintCore.lintBoard(JSON.stringify(next));

    if (res.errors.length > 0 && !flags.force) {
      ctx.err(lintCore.formatReport(res));
      return EXIT.VALIDATION;
    }
    if (res.warnings.length > 0 && !flags.quiet) {
      ctx.err(lintCore.formatReport({ errors: [], warnings: res.warnings }));
    }

    if (flags.dryRun) {
      ctx.out(render(next, ctx, { dryRun: true }));
      return EXIT.OK;
    }

    io.writeFileAtomicSync(boardPath, JSON.stringify(next, null, 2) + '\n');
    ctx.out(render(next, ctx, { dryRun: false }));
    return EXIT.OK;
  });
}

// ── runRead(ctx, { resolve, compute, render }) → exitCode ─────────────────────────────────────────
//   设计稿 §5 读路径：resolveBoard → 算 → render（human|json）→ EXIT.OK。只读不加锁。
//     resolve(ctx) → { boardPath, board }（默认 discover.resolveBoard）。
//     compute(board, ctx) → 任意结果（render 的输入；如 task list 过滤后的数组、graph 分析句柄）。
//     render(result, ctx) → string。
//   不 catch resolve 的 throw（NotFound/Ambiguous 冒泡给 router 映射 exit 5）。
function runRead(ctx, { resolve, compute, render }) {
  const resolved = (typeof resolve === 'function')
    ? resolve(ctx)
    : discover.resolveBoard({
        boardFlag: ctx.values && ctx.values.board,
        sid: ctx.sid,
        homeFlag: ctx.values && ctx.values.home,
        goalSubstr: ctx.values && ctx.values.goal,
        env: ctx.env,
      });
  const result = (typeof compute === 'function') ? compute(resolved.board, ctx) : resolved.board;
  ctx.out(render(result, ctx));
  return EXIT.OK;
}

module.exports = {
  buildFields,
  runWrite,
  runRead,
  // 内部小工具导出（测试便利 / 其它 handler 复用）。
  parseRef,
  parseKv,
};
