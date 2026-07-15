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

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import type { QuotaEffectBoundary } from '@ccm/engine';
import {
  formatReport,
  lintBoard,
  reconcileGating,
  reconcileInbox,
  validateNativeAttemptMutation,
} from '@ccm/engine';
import * as discover from '../discover.js';
import * as io from '../io.js';
import type { ProviderRuntime } from '../provider-runtime.js';
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

export type NativeAttemptEvidenceClass = 'bind' | 'terminal' | 'reconcile';

export interface NativeAttemptVerifiedEvidence {
  schema: 'ccm/native-verified-evidence/v1';
  evidence_class: NativeAttemptEvidenceClass;
  record_ref: string;
  record_hash: string;
  producer: {
    producer_id: string;
    channel: string;
    registration_ref: string;
  };
  resolved_context: {
    account: string;
    permission_profile: string;
    permission_denies: string;
  };
  scope: {
    contract: string;
    origin: string;
    harness: string;
    adapter: string;
    surface: string;
    transport: string;
    task_id: string;
    attempt_id: string;
    candidate_id: string;
    dispatch_key: string;
    input_hash: string;
    request_hash: string;
    launch_claim_id: string;
    reservation_id: string;
    ticket_digest: string;
    launch_identity_digest: string;
    create_hash: string;
  };
  observed: {
    descriptor: {
      origin: string;
      harness: string;
      adapter: string;
      surface: string;
      transport: string;
    };
    target: string | null;
    source: string;
    current_lineage: Record<string, any>;
    handle?: string;
    handle_kind?: string;
    spawn?: Record<string, any>;
    roster?: Record<string, any>;
  };
  payload: Record<string, any>;
}

export interface NativeAttemptEvidenceStageResult {
  ok: boolean;
  transaction_id?: string;
  verified_evidence?: NativeAttemptVerifiedEvidence;
  issues?: Array<{ code: string; path?: string; message?: string }>;
}

export interface NativeAttemptPrivateEvidenceBoundary {
  schema: string;
  channel: string;
  stageAndVerify: (input: {
    board_path: string;
    evidence_class: NativeAttemptEvidenceClass;
    record_ref: string;
    expected: Record<string, any>;
    existing_evidence?: {
      record_ref: string;
      record_hash: string;
    };
  }) => NativeAttemptEvidenceStageResult;
  commit: (input: {
    transaction_id: string;
    board_path: string;
    board_content_hash: string;
  }) => void;
  rollback: (input: { transaction_id: string; reason: string }) => void;
}

export interface NativeAttemptAdmissionBoundary {
  stageCreate: (input: {
    board_path: string;
    task_id: string;
    selection_snapshot: Record<string, any>;
    attempt: Record<string, any>;
    replay_intent?: string;
    existing_attempt?: Record<string, any>;
  }) => {
    ok: boolean;
    transaction_id?: string;
    admission_snapshot?: Record<string, any>;
    launch_authority?: Record<string, any>;
    issues?: Array<{ code: string; path?: string; message?: string }>;
  };
  commit: (input: {
    transaction_id: string;
    board_path: string;
    board_content_hash: string;
  }) => void;
  rollback: (input: { transaction_id: string; reason: string }) => void;
  resolveControl: (input: { task_id: string; attempt_id: string }) => Record<string, any>;
}

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
  // Optional host capability injection used exclusively by provider handlers.  Production creates
  // it at the router seam; tests replace it with a controlled transport.
  providerRuntime?: ProviderRuntime;
  // Session-bound worker cancellation injection. Production SIGINT/SIGTERM is bridged by its
  // handler; tests use this seam without signaling the test runner process.
  workerSignal?: AbortSignal;
  quotaEffects?: QuotaEffectBoundary;
  nativeAttemptPrivateEvidence?: NativeAttemptPrivateEvidenceBoundary;
  nativeAttemptAdmission?: NativeAttemptAdmissionBoundary;
  writeFileAtomicSync?: typeof io.writeFileAtomicSync;
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
type MutateFn = (board: unknown, ctx: Ctx, opts: { boardPath: string }) => unknown;
type WriteRenderFn = (
  next: unknown,
  ctx: Ctx,
  opts: { dryRun: boolean; boardPath: string },
) => string;
type ComputeFn = (board: unknown, ctx: Ctx) => unknown;
type ReadRenderFn = (result: unknown, ctx: Ctx) => string;

export type NativeAttemptWriterKind =
  | 'generic'
  | 'generic-state'
  | 'native-create'
  | 'native-bind'
  | 'native-cancel'
  | 'native-terminal'
  | 'native-reconcile';

export interface WriteTransactionLifecycle {
  rollback: (input: { reason: string }) => void;
  commit: (input: { boardPath: string; boardContentHash: string }) => void;
  active?: () => boolean;
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
export function runWrite(
  ctx: Ctx,
  {
    resolve,
    mutate,
    render,
    writerKind = 'generic',
    targetTaskIds,
    transaction,
  }: {
    resolve?: ResolveFn;
    mutate: MutateFn;
    render: WriteRenderFn;
    writerKind?: NativeAttemptWriterKind;
    targetTaskIds?: readonly string[];
    transaction?: WriteTransactionLifecycle;
  },
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

  const execute = (raw: unknown): number => {
    let boardPersisted = false;
    const rollback = (reason: string): void => {
      if (!transaction || (transaction.active && !transaction.active())) return;
      transaction.rollback({ reason });
    };

    try {
      // mutate 后跑写关卡 reconcile（mutate → reconcile → lint）：
      //   ① reconcileGating：deps 驱动 ready↔blocked 归一（ADR-023）。
      //   ② reconcileInbox：通知收件箱过期 / supersede / GC（ADR-032）。
      // lint 校验的是归一后的板（含 BIZ-STATUS-DEPS / FMT-INBOX）。
      // generic-state 表达的是 writer intent；即使底层 mutation 会先以旧错误拒绝或最终不产生 byte delta，
      // active native attempt 也必须由同一 ownership guard 统一拒绝。
      if (writerKind === 'generic-state') {
        const intentIssues = validateNativeAttemptMutation(
          raw as Record<string, any>,
          raw as Record<string, any>,
          writerKind,
          targetTaskIds,
        );
        if (intentIssues.length > 0) {
          rollback('native-attempt-mutation-guard');
          ctx.err(intentIssues.map((issue) => issue.code).join(', '));
          return EXIT.VALIDATION;
        }
      }

      const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
      const next = reconcileInbox(reconcileGating(mutate(raw, ctx, { boardPath })), now);

      // Native attempt 的 writer ownership 是 mutation-boundary hard gate，先于可被 --force 越过的普通 lint。
      // generic 是所有既有 writer 的默认值；只有 dedicated native verb 显式传对应 writerKind。
      const nativeIssues = validateNativeAttemptMutation(
        raw as Record<string, any>,
        next as Record<string, any>,
        writerKind,
        targetTaskIds,
      );
      if (nativeIssues.length > 0) {
        rollback('native-attempt-mutation-guard');
        ctx.err(nativeIssues.map((issue) => issue.code).join(', '));
        return EXIT.VALIDATION;
      }

      const res = lintBoard(JSON.stringify(next));

      if (res.errors.length > 0 && (!flags.force || transaction?.active?.())) {
        rollback('lint');
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
        rollback('dry-run');
        ctx.out(render(next, ctx, { dryRun: true, boardPath }));
        return EXIT.OK;
      }

      const boardContent = `${JSON.stringify(next, null, 2)}\n`;
      const boardContentHash = `sha256:${createHash('sha256').update(boardContent).digest('hex')}`;
      (ctx.writeFileAtomicSync || io.writeFileAtomicSync)(boardPath, boardContent);
      boardPersisted = true;
      transaction?.commit({ boardPath, boardContentHash });
      ctx.out(render(next, ctx, { dryRun: false, boardPath }));
      return EXIT.OK;
    } catch (error) {
      // Board 写成功以后 commit/render 的异常不能释放 reservation：此时 board 已经 durable，精确重试须
      // 由 evidence boundary 依据 board hash 幂等 finalize。写成功以前的任何失败都必须 rollback。
      if (!boardPersisted) rollback('write-pipeline-error');
      throw error;
    }
  };

  // dry-run 是真正的零写操作：不创建锁、临时文件或父目录。resolve 已给出只读快照，
  // 预览在该快照上做 mutate + lint；真实写入仍在锁内重读，保留 TOCTOU 防护。
  if (flags.dryRun) return execute(resolved.board || null);

  return io.withBoardLock(boardPath, () => {
    // 读盘（以盘上最新为准）。resolve 已读过一份，但加锁后重读防 TOCTOU。init 路径盘上可能没文件 → null。
    let raw: unknown = resolved.board || null;
    try {
      const text = fs.readFileSync(boardPath, 'utf8');
      raw = JSON.parse(text);
    } catch (_e) {
      // 文件不存在 / 坏 JSON：init 路径合法（raw 留 null，mutate 自建）；非 init 路径 resolve 已保证存在。
    }
    return execute(raw);
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
