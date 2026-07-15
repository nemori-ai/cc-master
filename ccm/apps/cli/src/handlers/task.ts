// handlers/task.ts — task noun handler（add/show/list/update/start/done/block/set-status/rm·cli-design §3.2）。
//
// 照搬 log.ts 范式：每 verb 一个 handler(ctx) → exitCode；写 verb 用 _common.runWrite（resolve / mutate / render
//   三回调），读 verb 用 runRead（resolve / compute / render）。buildFields 把 parsed flags 按 registry 的
//   field/transform 映射成 mutation 入参。handler **直接 import leaf 模块**（mutations / render / registry），
//   不经 ctx 注入（契约 §三 ctx 形态）。mutation / discover 的 throw **不在 handler 内 catch**——冒泡给 router
//   按 .errKind 映射退出码（IllegalTransition/Validation→3、NotFound/Ambiguous→5、Usage→2）。
//
// 状态机：start→in_flight、done→done 经 mutations.transition（自动盖 started_at/finished_at·非法转移 throw
//   IllegalTransition，--force 越）；block 经 mutations.blockTask（机械写 blocked + blocked_on，awaiting-user 缺
//   decision_package 由写入关卡的 lint hard 挡）；set-status 是通用转移闸。
//
// rm 破坏性：非 TTY 须 ctx.flags.yes 否则 return USAGE（clig/12-factor·agent 永不撞提示）。无专属 removeTask
//   mutation——在 mutate 回调里机械 filter 掉该 task；删后留悬挂 deps 由写入关卡 lint hard 挡（return VALIDATION）。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib。
// 武装闸豁免：纯 handler 模块（无 hook 入口，只被 router 经 registry.handler 调）——见 AGENTS.md §3 / §12。
//
// T2b port 注：require → ESM import；module.exports → 命名导出。逻辑/正则/报错文案/.errKind/退出码逐字保持。
//   动态派发的 board 形参类型为 unknown（runWrite/runRead 回调签名）——按需窄断言为 BoardArg / 任务数组。

import * as io from '../io.js';
import * as mutations from '../mutations.js';
import { REGISTRY } from '../registry.js';
import * as render from '../render.js';
import {
  type BoardArg,
  buildFields,
  type Ctx,
  type NativeAttemptEvidenceClass,
  type NativeAttemptVerifiedEvidence,
  type NativeAttemptWriterKind,
  runRead,
  runWrite,
  type SetOp,
} from './_common.js';

const EXIT = io.EXIT;

// 带 .errKind 的 Error（router 据此映射退出码）。
interface KindedError extends Error {
  errKind?: string;
}

// 任务的最小读形（render 取 id / status 等）。
interface TaskLike {
  id?: string;
  status?: unknown;
  [k: string]: unknown;
}

// ── 内部：把 buildFields 的 sets/setJsons 操作列表逐条 apply 到 board（通用 --set / --set-json 逃生口）。──
//   applySet/applySetJson 命中 🔒 load-bearing path → throw Validation（冒泡 router 映射 exit 3）。
//   taskId：task verb 语境的默认作用域（Finding #83）——裸 dotpath scope 到该 task（与 --title 等普通 flag
//   一致的直觉）；显式 tasks[<其它id>].field 前缀仍按原契约作用于指定 task（跨 task 逃生口）。
function applyOps(board: BoardArg, sets: SetOp[], setJsons: SetOp[], taskId?: string): BoardArg {
  let b = board;
  const scope = { defaultTaskId: taskId };
  for (const op of sets) b = mutations.applySet(b, op.path, op.value, scope);
  for (const op of setJsons) b = mutations.applySetJson(b, op.path, op.value, scope);
  return b;
}

// ── 内部：--set/--set-json 写入后的逻辑落点回显行（非 --json 输出用·Finding #83「零信号」修复）。
//   回显实际写入的归一化 path（如 `  set tasks[T7].decision_package`），消除「报 task 已更新、值却落别处」。
function echoSetPaths(ops: SetOp[], taskId?: string): string {
  if (!ops.length) return '';
  const scope = { defaultTaskId: taskId };
  return ops.map((op) => `\n  set ${mutations.logicalSetPath(op.path, scope)}`).join('');
}

// ── 内部：若给了 --log 则追一条 log（与主写动作同一笔落盘·log.ts 范式外延）。
function maybeLog(board: BoardArg, ctx: Ctx, summaryFallback: string): BoardArg {
  const logMsg = ctx.values && ctx.values.log;
  if (logMsg === undefined) return board;
  return mutations.appendLog(board, {
    summary: typeof logMsg === 'string' ? logMsg : summaryFallback,
  });
}

// 从 next board 找一个 task（render 用）。
function findTask(next: unknown, id: string): TaskLike | undefined {
  const nb = next as { tasks?: TaskLike[] };
  return (nb.tasks || []).find((x) => x && x.id === id);
}

function readJsonInput(ctx: Ctx, value: unknown, label: string): unknown {
  const text = io.readInputSpec(value as string, { stdin: ctx.stdin });
  try {
    return JSON.parse(text);
  } catch (error) {
    const e = new Error(
      `${label} 必须是合法 JSON（@/absolute/file.json、- 或 JSON 字面量）：${(error as Error).message}`,
    ) as KindedError;
    e.errKind = 'Usage';
    throw e;
  }
}

// ── task add ───────────────────────────────────────────────────────────────────────────────────────
//   id 是必填 positional（router 已校验非空）；其余字段经 buildFields 从 registry 的 field/transform 映射。
//   addTask 缺省 status='ready'、deps=[]、盖 created_at；其余 ✎ 字段只在显式给出时落。
export function add(ctx: Ctx): number {
  const spec = REGISTRY.task?.add;
  let echoOps: SetOp[] = []; // mutate 收集 → render 回显逻辑落点（Finding #83）
  return runWrite(ctx, {
    mutate: (board) => {
      const { fields, sets, setJsons } = buildFields(ctx.values, spec, { stdin: ctx.stdin });
      echoOps = [...sets, ...setJsons];
      const args = Object.assign({ id: ctx.positionals[0] }, fields);
      let next = mutations.addTask(board as BoardArg, args);
      next = applyOps(next, sets, setJsons, ctx.positionals[0] as string);
      next = maybeLog(next, ctx, `add task ${ctx.positionals[0]}`);
      return next;
    },
    render: (next, c, { dryRun }) => {
      const id = ctx.positionals[0] as string;
      if (c.flags.json) {
        const t = findTask(next, id);
        return render.renderTaskDetail(t, { json: true });
      }
      const prefix = dryRun ? `[dry-run] 将新建 task: ${id}` : `task 已新建: ${id}`;
      return prefix + echoSetPaths(echoOps, id);
    },
  });
}

// ── task update 的 --artifact 提前诊断（issue #57 问题2·体验性提前诊断，不替代 lint 校验权威）───────────
//   目标 task 已是 status:"done" 且 verified 非 true 时，单独设 --artifact（不带 --verified）必然无法让它
//   满足 done 真语义（BIZ-DONE-VERIFIED：verified===true 且 artifact 非空缺一不可）——mutate 后 lintBoard
//   仍会因 verified 仍非 true 而 hard 拒、整条写入不落盘（exit 3），但那份诊断要绕一圈到全板 lint report
//   才现形，容易被读成「静默忽略」。这里提前侦测这个必然失败的字段组合，直接给一个指路更直达的 Usage 错误
//   （exit 2）——**不改变最终会不会失败**（真正的校验权威仍是 lintBoard；这只是把「为什么会失败 + 怎么修」
//   提前说清楚，不是新增一条校验规则）。同时给了 --verified，或目标不是「已 done 且未 verified」，一律放行
//   给 lint 去判（含目标 id 不存在——留给 updateTask 抛 NotFound）。
function diagnoseArtifactOnlyOnAlreadyDoneTask(
  board: BoardArg,
  id: string,
  fields: Record<string, unknown>,
): void {
  if (fields.artifact === undefined) return; // 没设 --artifact，不涉及本诊断
  if (fields.verified !== undefined) return; // 同时给了 --verified，交给 lint 判是否已经足够
  const b = board as { tasks?: TaskLike[] };
  const tasks = Array.isArray(b.tasks) ? b.tasks : [];
  const t = tasks.find((x) => x && x.id === id);
  if (!t) return; // 目标不存在留给 updateTask 抛 NotFound
  if (t.status === 'done' && t.verified !== true) {
    const e = new Error(
      `task ${id} 已是 status=done 但 verified 非 true；单独设 --artifact 不会满足 done 真语义` +
        `（BIZ-DONE-VERIFIED 需要 verified===true 且 artifact 非空），写入会被 lint 拒绝（exit 3）。\n` +
        `  怎么修：同时加 --verified（\`ccm task update ${id} --artifact <path-or-url> --verified\`），` +
        `或改用 \`ccm task done ${id} --artifact <path-or-url> --verified\`。`,
    ) as KindedError;
    e.errKind = 'Usage';
    throw e;
  }
}

// ── task update ──────────────────────────────────────────────────────────────────────────────────
//   id 必填 positional。普通字段覆写 + addDep/rmDep/addRef/rmRef（buildFields 的 field 名直接对齐 updateTask 特殊键）。
//   目标 id 不存在 → mutations.updateTask throw NotFound（冒泡 router 映射 exit 5）。
function asStringArray(value: unknown): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

export function update(ctx: Ctx): number {
  const spec = REGISTRY.task?.update;
  const id = ctx.positionals[0] as string;
  let echoOps: SetOp[] = []; // mutate 收集 → render 回显逻辑落点（Finding #83）
  const rawSetOps = [...asStringArray(ctx.values.set), ...asStringArray(ctx.values['set-json'])];
  const targetsHandle =
    ctx.values.handle !== undefined ||
    rawSetOps.some((entry) => {
      const path = entry.slice(0, entry.indexOf('=') === -1 ? entry.length : entry.indexOf('='));
      return path === 'handle' || /(?:^|\.)handle$/.test(path);
    });
  return runWrite(ctx, {
    mutate: (board) => {
      const { fields, sets, setJsons } = buildFields(ctx.values, spec, { stdin: ctx.stdin });
      echoOps = [...sets, ...setJsons];
      diagnoseArtifactOnlyOnAlreadyDoneTask(board as BoardArg, id, fields);
      let next = mutations.updateTask(board as BoardArg, id, fields);
      next = applyOps(next, sets, setJsons, id);
      next = maybeLog(next, ctx, `update task ${id}`);
      return next;
    },
    render: (next, c, { dryRun }) => {
      if (c.flags.json) {
        const t = findTask(next, id);
        return render.renderTaskDetail(t, { json: true });
      }
      const prefix = dryRun ? `[dry-run] 将更新 task: ${id}` : `task 已更新: ${id}`;
      return prefix + echoSetPaths(echoOps, id);
    },
    writerKind: targetsHandle ? 'generic-state' : 'generic',
    targetTaskIds: [id],
  });
}

// ── task start / done：状态机语义糖（→ in_flight / → done，自动盖时间戳由 mutations.transition 管）──────────
//   批量语义（issue #57 问题3 方案3·根治"批量回填死结"）：ctx.positionals 是**全部**非 flag token（router 层
//   本就把它们悉数收进这个数组，registry 的单个必填 positional 声明只保证「至少一个」，不是解析上限）——
//   这里遍历全部 id、在**同一次** mutate 回调里逐个转移 + 覆写字段，交给 runWrite 的既有管线只跑**一次**
//   lintBoard + **一次**落盘。把 N 次独立 CLI 调用（各自一次 mutate+lint+write）坍缩成一次调用，天然规避
//   "board 上还有其它任务的存量违规 → 每次单独调用都被全板 lint 拒绝、45 个只 1 个生效" 的死结（详见
//   design_docs/plans/2026-07-07-ccm-batch-verb-spec.md）。--artifact/--verified 对本次调用的**每个** id
//   一视同仁施加（批量回填典型诉求：这批 task 共享同一产物链接）。--force 对整批统一生效（既有全局语义，
//   未新增细粒度控制）。任一 id 非法转移或不存在 → mutate() 内 throw 冒泡、runWrite 不落盘——
//   all-or-nothing（批量里其它本来合法的 id 也不落盘，与单 id 语义一致地推广，不引入部分提交）。
//   单 id 调用（positionals 长度 1）行为逐字不变；`--json` 输出形状从「单对象」统一为「数组」（长度恒等于
//   传入 id 数，含单 id 情形——见 mini-spec「与 §6 锁步纪律的配套改动」一节记录的唯一形状变化）。
function _transitionVerb(ctx: Ctx, toStatus: string, label: string): number {
  const ids = ctx.positionals as string[];
  return runWrite(ctx, {
    mutate: (board) => {
      let next = board as BoardArg;
      for (const id of ids) {
        // done verb 还可带 --artifact / --verified（先转移盖时间戳，再覆写产物字段）。
        next = mutations.transition(next, id, toStatus, { force: ctx.flags.force });
        if (toStatus === 'done') {
          const fields: Record<string, unknown> = {};
          if (ctx.values && ctx.values.artifact !== undefined)
            fields.artifact = ctx.values.artifact;
          if (ctx.values && ctx.values.verified !== undefined)
            fields.verified = ctx.values.verified;
          if (Object.keys(fields).length) next = mutations.updateTask(next, id, fields);
          if (ctx.values && ctx.values['review-verdict'] !== undefined) {
            next = mutations.recordTaskReviewVerdict(next, id, ctx.values['review-verdict']);
          } else {
            next = mutations.clearTaskReviewVerdict(next, id);
          }
        }
      }
      next = maybeLog(next, ctx, `${label} ${ids.join(', ')}`);
      return next;
    },
    render: (next, c, { dryRun }) => {
      if (c.flags.json) {
        // 完整 task JSON 数组（每元素同 renderTaskDetail 的单对象形状，不是 renderTaskList 的窄子集）——
        //   `--json` 输出形状统一为数组（长度恒等于传入 id 数，含单 id 情形）。
        const tasks = ids.map((id) => findTask(next, id) ?? null);
        return render.jsonString(tasks);
      }
      const idList = ids.join(', ');
      return dryRun
        ? `[dry-run] 将 ${label} task: ${idList} (→ ${toStatus})`
        : `task ${idList} → ${toStatus}`;
    },
    writerKind: 'generic-state',
    targetTaskIds: ids,
  });
}
export function start(ctx: Ctx): number {
  return _transitionVerb(ctx, 'in_flight', 'start');
}
export function done(ctx: Ctx): number {
  return _transitionVerb(ctx, 'done', 'done');
}

// ── task retry：stale|failed|escalated → ready，并原子归档/清理上一 attempt evidence。──────────────
//   与 start/done 同样支持批量：一笔 runWrite 内逐个 retry，任一 id 非法/不存在则整批零落盘。
export function retry(ctx: Ctx): number {
  const ids = ctx.positionals as string[];
  return runWrite(ctx, {
    mutate: (board) => {
      let next = board as BoardArg;
      for (const id of ids) next = mutations.retryTask(next, id);
      next = maybeLog(next, ctx, `retry ${ids.join(', ')}`);
      return next;
    },
    render: (next, c, { dryRun }) => {
      if (c.flags.json) {
        const tasks = ids.map((id) => findTask(next, id) ?? null);
        return render.jsonString(tasks);
      }
      const outcomes = ids.map((id) => `${id} → ${String(findTask(next, id)?.status)}`).join(', ');
      return dryRun
        ? `[dry-run] 将 retry task: ${outcomes} (归档并清理旧 attempt evidence)`
        : `task retry: ${outcomes} (旧 attempt evidence 已归档)`;
    },
  });
}

export function setPlanning(ctx: Ctx): number {
  const id = ctx.positionals[0] as string;
  return runWrite(ctx, {
    mutate: (board) =>
      mutations.setTaskPlanning(
        board as BoardArg,
        id,
        readJsonInput(ctx, ctx.values && ctx.values.profile, '--profile'),
      ),
    render: (next, c, { dryRun }) => {
      const task = findTask(next, id);
      if (c.flags.json) return render.renderTaskDetail(task, { json: true });
      return dryRun
        ? `[dry-run] 将写入 task ${id} planning contract`
        : `task ${id} planning contract 已写入`;
    },
  });
}

export function setRouting(ctx: Ctx): number {
  const id = ctx.positionals[0] as string;
  return runWrite(ctx, {
    mutate: (board) =>
      mutations.setTaskRoutingPolicy(
        board as BoardArg,
        id,
        readJsonInput(ctx, ctx.values && ctx.values.policy, '--policy'),
      ),
    render: (next, c, { dryRun }) => {
      const task = findTask(next, id);
      if (c.flags.json) return render.renderTaskDetail(task, { json: true });
      return dryRun
        ? `[dry-run] 将写入 task ${id} routing policy`
        : `task ${id} routing policy 已写入（未 selection / 未 attempt / 未 spawn）`;
    },
  });
}

export function routeBind(ctx: Ctx): number {
  const id = ctx.positionals[0] as string;
  return runWrite(ctx, {
    mutate: (board) =>
      mutations.bindTaskRoute(board as BoardArg, id, {
        selection: readJsonInput(ctx, ctx.values && ctx.values.selection, '--selection'),
        attempt: readJsonInput(ctx, ctx.values && ctx.values.attempt, '--attempt'),
      }),
    render: (next, c, { dryRun }) => {
      const task = findTask(next, id);
      if (c.flags.json) return render.renderTaskDetail(task, { json: true });
      return dryRun
        ? `[dry-run] 将 bind task ${id} opaque handle claim`
        : `task ${id} route 已 bind（opaque handle claim；非 real/live attestation）`;
    },
    writerKind: 'generic-state',
    targetTaskIds: [id],
  });
}

function nativeAttemptError(code: string): never {
  const error = new Error(code) as KindedError;
  error.errKind = 'Validation';
  throw error;
}

function nativeAttemptRecord(value: unknown, code: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) nativeAttemptError(code);
  return value as Record<string, any>;
}

function nativeAttemptTask(board: BoardArg, id: string): Record<string, any> {
  const task = Array.isArray(board.tasks)
    ? board.tasks.find((entry: Record<string, any>) => entry?.id === id)
    : undefined;
  return nativeAttemptRecord(task, 'NATIVE-TASK-NOT-FOUND');
}

function nativeAttemptExpected(
  board: BoardArg,
  taskId: string,
  attemptId: string,
): Record<string, any> {
  const task = nativeAttemptTask(board, taskId);
  const attempt = Array.isArray(task.routing?.attempts)
    ? task.routing.attempts.find((entry: Record<string, any>) => entry?.id === attemptId)
    : undefined;
  const row = nativeAttemptRecord(attempt, 'NATIVE-ATTEMPT-NOT-FOUND');
  const immutableDescriptor = nativeAttemptRecord(
    row.descriptor,
    'NATIVE-ATTEMPT-DESCRIPTOR-MISSING',
  );
  return {
    contract: row.schema,
    origin: immutableDescriptor.origin,
    harness: immutableDescriptor.harness,
    adapter: immutableDescriptor.adapter,
    surface: immutableDescriptor.surface,
    create_hash: row.create_hash,
    task_id: taskId,
    attempt_id: row.id,
    candidate_id: row.candidate_id,
    transport: immutableDescriptor.transport,
    dispatch_key: row.dispatch?.key,
    input_hash: row.dispatch?.input_hash,
    request_hash: row.dispatch?.request_hash,
    launch_claim_id: row.dispatch?.launch_claim_id,
    reservation_id: row.launch_authority?.reservation?.reservation_id,
    ticket_digest: row.launch_authority?.ticket_digest,
    launch_identity_digest: row.launch_authority?.canonical_identity_digest,
    lineage: structuredClone(row.lineage),
  };
}

function nativeAttemptWrite(
  ctx: Ctx,
  writerKind: NativeAttemptWriterKind,
  makeCommand: (
    board: BoardArg,
    stageEvidence: (input: {
      evidenceClass: NativeAttemptEvidenceClass;
      recordRef: string;
      expected: Record<string, any>;
      existingEvidence?: { record_ref: string; record_hash: string };
    }) => NativeAttemptVerifiedEvidence,
    stageLaunch: (input: {
      task_id: string;
      selection_snapshot: Record<string, any>;
      attempt: Record<string, any>;
      replay_intent?: string;
      existing_attempt?: Record<string, any>;
    }) => { admissionSnapshot: Record<string, any>; launchAuthority: Record<string, any> },
    boardPath: string,
  ) => Record<string, any>,
): number {
  const id = ctx.positionals[0] as string;
  let operationResult: Record<string, any> | undefined;
  let boardPath = '';
  let evidenceTransaction:
    | {
        boundary: {
          commit: NonNullable<Ctx['nativeAttemptPrivateEvidence']>['commit'];
          rollback: NonNullable<Ctx['nativeAttemptPrivateEvidence']>['rollback'];
        };
        transactionId: string;
      }
    | undefined;

  const stageEvidence = ({
    evidenceClass,
    recordRef,
    expected,
    existingEvidence,
  }: {
    evidenceClass: NativeAttemptEvidenceClass;
    recordRef: string;
    expected: Record<string, any>;
    existingEvidence?: { record_ref: string; record_hash: string };
  }): NativeAttemptVerifiedEvidence => {
    if (evidenceTransaction) nativeAttemptError('NATIVE-EVIDENCE-TRANSACTION-CONFLICT');
    const boundary = ctx.nativeAttemptPrivateEvidence;
    if (!boundary) nativeAttemptError('NATIVE-EVIDENCE-AUTHENTICATOR-UNAVAILABLE');
    const staged = boundary.stageAndVerify({
      board_path: boardPath,
      evidence_class: evidenceClass,
      record_ref: recordRef,
      expected,
      existing_evidence: existingEvidence,
    });
    if (staged.transaction_id) {
      evidenceTransaction = { boundary, transactionId: staged.transaction_id };
    }
    if (!staged.ok) {
      const codes = Array.isArray(staged.issues)
        ? staged.issues.map((issue) => issue.code).join(', ')
        : 'NATIVE-EVIDENCE-AUTHENTICATION-FAILED';
      nativeAttemptError(codes);
    }
    if (!evidenceTransaction) nativeAttemptError('NATIVE-EVIDENCE-TRANSACTION-MISSING');
    if (!staged.verified_evidence) nativeAttemptError('NATIVE-EVIDENCE-PROJECTION-MISSING');
    return staged.verified_evidence;
  };

  const stageLaunch = (input: {
    task_id: string;
    selection_snapshot: Record<string, any>;
    attempt: Record<string, any>;
    replay_intent?: string;
    existing_attempt?: Record<string, any>;
  }): { admissionSnapshot: Record<string, any>; launchAuthority: Record<string, any> } => {
    if (evidenceTransaction) nativeAttemptError('NATIVE-EVIDENCE-TRANSACTION-CONFLICT');
    const boundary = ctx.nativeAttemptAdmission;
    if (!boundary) nativeAttemptError('NATIVE-CREATE-ADMISSION-UNAVAILABLE');
    const staged = boundary.stageCreate({ ...input, board_path: boardPath });
    if (staged.transaction_id) {
      evidenceTransaction = { boundary, transactionId: staged.transaction_id };
    }
    if (!staged.ok) {
      const codes = Array.isArray(staged.issues)
        ? staged.issues.map((issue) => issue.code).join(', ')
        : 'NATIVE-LAUNCH-AUTHORITY-INVALID';
      nativeAttemptError(codes);
    }
    if (!evidenceTransaction) nativeAttemptError('NATIVE-LAUNCH-TRANSACTION-MISSING');
    if (!staged.admission_snapshot || !staged.launch_authority) {
      nativeAttemptError('NATIVE-LAUNCH-AUTHORITY-MISSING');
    }
    return {
      admissionSnapshot: staged.admission_snapshot,
      launchAuthority: staged.launch_authority,
    };
  };

  return runWrite(ctx, {
    mutate: (board, _ctx, opts) => {
      boardPath = opts.boardPath;
      const applied = mutations.applyNativeAttemptCommand(
        board as BoardArg,
        makeCommand(board as BoardArg, stageEvidence, stageLaunch, boardPath),
      );
      operationResult = applied.result;
      return applied.board;
    },
    render: (_next, c, { dryRun }) => {
      if (c.flags.json) return render.jsonString(operationResult ?? null);
      const suffix = dryRun ? '（dry-run）' : '';
      return `task ${id} native attempt 已更新${suffix}`;
    },
    writerKind,
    transaction: {
      active: () => !!evidenceTransaction,
      rollback: ({ reason }) => {
        if (!evidenceTransaction) return;
        const { boundary, transactionId } = evidenceTransaction;
        boundary.rollback({ transaction_id: transactionId, reason });
        evidenceTransaction = undefined;
      },
      commit: ({ boardPath, boardContentHash }) => {
        if (!evidenceTransaction) return;
        const { boundary, transactionId } = evidenceTransaction;
        boundary.commit({
          transaction_id: transactionId,
          board_path: boardPath,
          board_content_hash: boardContentHash,
        });
        evidenceTransaction = undefined;
      },
    },
  });
}

export function nativeAttemptCreate(ctx: Ctx): number {
  return nativeAttemptWrite(ctx, 'native-create', (board, _stageEvidence, stageLaunch) => {
    const selectionSnapshot = nativeAttemptRecord(
      readJsonInput(ctx, ctx.values.selection, '--selection'),
      'NATIVE-SELECTION-MISMATCH',
    );
    const attempt = nativeAttemptRecord(
      readJsonInput(ctx, ctx.values.attempt, '--attempt'),
      'NATIVE-ATTEMPT-MISSING',
    );
    const taskId = ctx.positionals[0] as string;
    const replayIntent = ctx.values['replay-intent'] as string | undefined;
    const task = nativeAttemptTask(board, taskId);
    const existingAttempt = Array.isArray(task.routing?.attempts)
      ? task.routing.attempts.find(
          (entry: Record<string, any>) => entry?.dispatch?.key === attempt.dispatch?.key,
        )
      : undefined;
    const staged = stageLaunch({
      task_id: taskId,
      selection_snapshot: selectionSnapshot,
      attempt,
      replay_intent: replayIntent,
      existing_attempt: existingAttempt ? structuredClone(existingAttempt) : undefined,
    });
    return {
      type: 'create',
      task_id: taskId,
      selection_snapshot: selectionSnapshot,
      attempt,
      replay_intent: replayIntent,
      admission_snapshot: staged.admissionSnapshot,
      launch_authority: staged.launchAuthority,
    };
  });
}

export function nativeAttemptBind(ctx: Ctx): number {
  return nativeAttemptWrite(ctx, 'native-bind', (board, stageEvidence) => {
    const taskId = ctx.positionals[0] as string;
    const attemptId = ctx.values['attempt-id'] as string;
    const evidenceRef = ctx.values['evidence-record-ref'] as string;
    const task = nativeAttemptTask(board, taskId);
    const existingAttempt = Array.isArray(task.routing?.attempts)
      ? task.routing.attempts.find((entry: Record<string, any>) => entry?.id === attemptId)
      : undefined;
    const existingBinding = existingAttempt?.handle_binding;
    const verifiedEvidence = stageEvidence({
      evidenceClass: 'bind',
      recordRef: evidenceRef,
      expected: nativeAttemptExpected(board, taskId, attemptId),
      existingEvidence:
        existingBinding?.evidence_record_ref && existingBinding?.evidence_hash
          ? {
              record_ref: existingBinding.evidence_record_ref,
              record_hash: existingBinding.evidence_hash,
            }
          : undefined,
    });
    return {
      type: 'bind',
      task_id: taskId,
      attempt_id: attemptId,
      evidence_record_ref: evidenceRef,
      verified_evidence: verifiedEvidence,
    };
  });
}

export function nativeAttemptCancel(ctx: Ctx): number {
  return nativeAttemptWrite(ctx, 'native-cancel', () => {
    const authority = ctx.nativeAttemptAdmission;
    if (!authority) nativeAttemptError('NATIVE-CONTROL-AUTHORITY-UNAVAILABLE');
    return {
      type: 'cancel',
      task_id: ctx.positionals[0],
      attempt_id: ctx.values['attempt-id'],
      request: readJsonInput(ctx, ctx.values.request, '--request'),
      authority_snapshot: authority.resolveControl({
        task_id: ctx.positionals[0] as string,
        attempt_id: ctx.values['attempt-id'] as string,
      }),
      acknowledgement_terminal_class: ctx.values['acknowledgement-terminal-class'],
    };
  });
}

export function nativeAttemptTerminal(ctx: Ctx): number {
  return nativeAttemptWrite(ctx, 'native-terminal', (board, stageEvidence) => {
    const taskId = ctx.positionals[0] as string;
    const attemptId = ctx.values['attempt-id'] as string;
    const evidenceRef = ctx.values['evidence-record-ref'] as string;
    const task = nativeAttemptTask(board, taskId);
    const existingAttempt = Array.isArray(task.routing?.attempts)
      ? task.routing.attempts.find((entry: Record<string, any>) => entry?.id === attemptId)
      : undefined;
    const existingTerminal = existingAttempt?.terminal;
    return {
      type: 'terminal',
      task_id: taskId,
      attempt_id: attemptId,
      evidence_record_ref: evidenceRef,
      verified_evidence: stageEvidence({
        evidenceClass: 'terminal',
        recordRef: evidenceRef,
        expected: nativeAttemptExpected(board, taskId, attemptId),
        existingEvidence:
          existingTerminal?.evidence_record_ref && existingTerminal?.evidence_hash
            ? {
                record_ref: existingTerminal.evidence_record_ref,
                record_hash: existingTerminal.evidence_hash,
              }
            : undefined,
      }),
      requested_task_status: ctx.values['requested-task-status'],
    };
  });
}

export function nativeAttemptReconcile(ctx: Ctx): number {
  return nativeAttemptWrite(ctx, 'native-reconcile', (board, stageEvidence) => {
    const taskId = ctx.positionals[0] as string;
    const attemptId = ctx.values['attempt-id'] as string;
    const evidenceRef = ctx.values['evidence-record-ref'] as string;
    const task = nativeAttemptTask(board, taskId);
    const existingAttempt = Array.isArray(task.routing?.attempts)
      ? task.routing.attempts.find((entry: Record<string, any>) => entry?.id === attemptId)
      : undefined;
    const existingReconciliation = Array.isArray(existingAttempt?.reconciliation)
      ? existingAttempt.reconciliation.find(
          (entry: Record<string, any>) => entry?.evidence_record_ref === evidenceRef,
        )
      : undefined;
    return {
      type: 'reconcile',
      task_id: taskId,
      attempt_id: attemptId,
      evidence_record_ref: evidenceRef,
      verified_evidence: stageEvidence({
        evidenceClass: 'reconcile',
        recordRef: evidenceRef,
        expected: nativeAttemptExpected(board, taskId, attemptId),
        existingEvidence:
          existingReconciliation?.evidence_record_ref && existingReconciliation?.evidence_hash
            ? {
                record_ref: existingReconciliation.evidence_record_ref,
                record_hash: existingReconciliation.evidence_hash,
              }
            : undefined,
      }),
    };
  });
}

// ── task block：→ blocked，设 blocked_on（+ --on user 时 decision_package）──────────────────────────
//   --on user 缺 decision_package → BIZ-AWAITING lint hard 挡（写入关卡 return VALIDATION·exit 3）。
export function block(ctx: Ctx): number {
  const id = ctx.positionals[0] as string;
  return runWrite(ctx, {
    mutate: (board) => {
      const on = ctx.values && (ctx.values.on as string | undefined);
      const args: { on?: string; decisionPackage?: unknown } = { on };
      // --decision 经 input transform（@file / - / 字面量）已被 buildFields 读成字符串；尝试 JSON.parse 成对象。
      const decisionRaw = ctx.values && ctx.values.decision;
      if (decisionRaw !== undefined) {
        const text = io.readInputSpec(decisionRaw as string, { stdin: ctx.stdin });
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text);
        } catch (_e) {
          /* 非 JSON → 留原文（lint 会按形状校验） */
        }
        args.decisionPackage = parsed;
      }
      let next = mutations.blockTask(board as BoardArg, id, args);
      next = maybeLog(next, ctx, `block ${id} on ${on}`);
      return next;
    },
    render: (next, c, { dryRun }) => {
      if (c.flags.json) {
        const t = findTask(next, id);
        return render.renderTaskDetail(t, { json: true });
      }
      const on = ctx.values && ctx.values.on;
      return dryRun ? `[dry-run] 将阻塞 task: ${id} (on ${on})` : `task ${id} → blocked (on ${on})`;
    },
    writerKind: 'generic-state',
    targetTaskIds: [id],
  });
}

// ── task unblock：清除 blocked_on 语义阻塞标记（→ 交回 reconcileGating 按 deps 定 ready/blocked）。ADR-023。
//   不直接定 status——写入关卡的 reconcileGating 据 dependencySatisfied 归一（deps 全满足→ready，否则→blocked）。
//   目标 id 不存在 → mutations.unblockTask throw NotFound（冒泡 router 映射 exit 5）。
export function unblock(ctx: Ctx): number {
  const id = ctx.positionals[0] as string;
  return runWrite(ctx, {
    mutate: (board) => {
      let next = mutations.unblockTask(board as BoardArg, id);
      next = maybeLog(next, ctx, `unblock ${id}`);
      return next;
    },
    render: (next, c, { dryRun }) => {
      if (c.flags.json) {
        const t = findTask(next, id);
        return render.renderTaskDetail(t, { json: true });
      }
      const t = findTask(next, id) as { status?: unknown } | undefined;
      const st = t && t.status ? ` (→ ${t.status})` : '';
      return dryRun ? `[dry-run] 将解除阻塞 task: ${id}` : `task ${id} 已解除 blocked_on${st}`;
    },
    writerKind: 'generic-state',
    targetTaskIds: [id],
  });
}

// ── task set-status：通用状态转移（positionals = [id, status]）。非法转移 throw IllegalTransition（--force 越）。
export function setStatus(ctx: Ctx): number {
  const id = ctx.positionals[0] as string;
  const toStatus = ctx.positionals[1] as string;
  return runWrite(ctx, {
    mutate: (board) => {
      let next = mutations.transition(board as BoardArg, id, toStatus, { force: ctx.flags.force });
      next = maybeLog(next, ctx, `set-status ${id} ${toStatus}`);
      return next;
    },
    render: (next, c, { dryRun }) => {
      if (c.flags.json) {
        const t = findTask(next, id);
        return render.renderTaskDetail(t, { json: true });
      }
      return dryRun ? `[dry-run] 将转移 task: ${id} → ${toStatus}` : `task ${id} → ${toStatus}`;
    },
    writerKind: 'generic-state',
    targetTaskIds: [id],
  });
}

// ── task rm：破坏性删除。非 TTY 须 ctx.flags.yes 否则 return USAGE（agent 永不撞提示·clig/12-factor）。
//   无专属 removeTask mutation——在 mutate 里 filter 掉该 id；目标不存在 → 这里主动 throw NotFound（与
//   其它 verb 的「不存在即 NotFound」一致）。删后留悬挂 deps 由写入关卡 lint hard 挡（return VALIDATION）。
export function rm(ctx: Ctx): number {
  const id = ctx.positionals[0] as string;
  // TTY 检测：ctx 显式注入 isTTY 时用之（测试便利），否则嗅 process.stdin.isTTY（非 TTY → 须 --yes）。
  const tty = ctx.isTTY !== undefined ? ctx.isTTY : io.isTTY(process.stdin);
  if (!tty && !ctx.flags.yes) {
    ctx.err(`refused: "task rm ${id}" 是破坏性操作；非交互环境须加 --yes 确认`);
    return EXIT.USAGE;
  }
  return runWrite(ctx, {
    mutate: (board) => {
      const b0 = board as { tasks?: TaskLike[] };
      const tasks = Array.isArray(b0.tasks) ? b0.tasks : [];
      const exists = tasks.some((t) => t && t.id === id);
      if (!exists) {
        const e = new Error(`task not found: ${id}`) as KindedError;
        e.errKind = 'NotFound';
        throw e;
      }
      // 无专属 removeTask mutation——就地纯结构操作（clone + filter），与 mutations.touch 同口径刷心跳。
      const b = structuredClone(board) as {
        tasks?: TaskLike[];
        owner?: { active?: boolean; session_id?: string; heartbeat?: string };
      };
      b.tasks = (Array.isArray(b.tasks) ? b.tasks : []).filter((t) => !(t && t.id === id));
      // 盖 owner.heartbeat（与 mutations.touch 同口径：任何写都刷心跳）。
      if (!b.owner || typeof b.owner !== 'object')
        b.owner = { active: true, session_id: '', heartbeat: '' };
      b.owner.heartbeat = mutations.stampNow();
      let out: BoardArg = b as BoardArg;
      out = maybeLog(out, ctx, `rm task ${id}`);
      return out;
    },
    render: (next, c, { dryRun }) => {
      if (c.flags.json) {
        const nb = next as { tasks?: TaskLike[] };
        return render.renderTaskList(nb.tasks || [], { json: true });
      }
      return dryRun ? `[dry-run] 将删除 task: ${id}` : `task 已删除: ${id}`;
    },
  });
}

// ── task show：单任务详情（读 verb）。不存在 → renderTaskDetail 出「无此任务」占位（human）/ data:null（json）。
export function show(ctx: Ctx): number {
  return runRead(ctx, {
    compute: (board) => {
      const id = ctx.positionals[0] as string;
      const b = board as { tasks?: TaskLike[] };
      const tasks = Array.isArray(b.tasks) ? b.tasks : [];
      return tasks.find((t) => t && t.id === id) || null;
    },
    render: (task, c) =>
      render.renderTaskDetail(task, { json: !!c.flags.json, color: c.flags.color }),
  });
}

// ── task list：列出任务（可按 --status/--executor/--type/--parent 过滤；--status 可重复）。读 verb。
export function list(ctx: Ctx): number {
  return runRead(ctx, {
    compute: (board) => {
      const b = board as { tasks?: TaskLike[] };
      const tasks = Array.isArray(b.tasks) ? b.tasks : [];
      const v = ctx.values || {};
      // --status multiple → 数组（parseArgs 形态）；规整成数组以便 includes。
      const statusFilter =
        v.status === undefined ? null : Array.isArray(v.status) ? v.status : [v.status];
      return tasks.filter((t) => {
        if (statusFilter && !statusFilter.includes(t && t.status)) return false;
        if (v.executor !== undefined && (t && t.executor) !== v.executor) return false;
        if (v.type !== undefined && (t && t.type) !== v.type) return false;
        if (v.parent !== undefined && (t && t.parent) !== v.parent) return false;
        return true;
      });
    },
    render: (tasks, c) =>
      render.renderTaskList(tasks, { json: !!c.flags.json, color: c.flags.color }),
  });
}
