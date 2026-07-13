// mutations.ts — board v2 写 SSOT（纯函数·零 IO·ADR-013 §2.3 / cli-design §5·§8）。
//
// 每个 verb 一个纯函数：(board, args) → newBoard。一律 structuredClone 输入后改、返回新对象，
//   **绝不** alias / 原地改入参（调用方持有的原 board 不被触碰）。每次写都盖 owner.heartbeat=stampNow()
//   （cli-design §5 步骤 5：任何写 → owner.heartbeat=now）。
//
// 边界（红线3 / cli-design §8）：mutations 只保证「结构正确地构建/转移」+ 状态机合法性（isLegalTransition）
//   + 🔒 load-bearing path 保护（applySet 拒）。**不做 lint**——不变式校验是 handler 层调 board-lint-core
//   的写入关卡（cli-design §5 步骤 6）。mutations 是那条管线里「mutate(raw,args)→next」这一纯函数环节。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖，纯 stdlib（structuredClone 是 node 全局）。
//
// 错误约定：非法/被拒的写 throw 一个 Error，带 .errKind（router 据此映射退出码）：
//   · 'IllegalTransition' → 非法状态转移（非 force）；message 列出合法后继
//   · 'Validation'        → applySet/applySetJson 命中 🔒 load-bearing path（提示用专属命令）
//   · 'NotFound'          → 目标 task/iteration 不存在
//
// T2a port 注：原 CJS 源（mutations.js）的 require('./board-model.js') 改成从 `@ccm/engine` import
//   SCHEMA_VERSION / isLegalTransition / STATUS_MACHINE；module.exports 换成命名导出。逻辑/数值/正则/
//   报错文案/.errKind 逐字保持。board 用宽松结构类型（mutations 只机械写形状·不强 schema）。

import {
  contractActivation,
  contractWritePolicy,
  createRoutingEnvelope,
  estimateHours,
  isEnumMember,
  isISOUTC,
  isLegalTransition,
  isRetryTransition,
  isReviewDependencyGate,
  routingContractPreflight,
  SCHEMA_VERSION,
  STATUS_MACHINE,
  validateRoutedTaskForInFlight,
  validateTaskPlanning,
  validateTaskRoutePolicy,
} from '@ccm/engine';

// 带 .errKind 的 Error（router 据此映射退出码）。
interface KindedError extends Error {
  errKind?: string;
}

// board / task 用宽松结构类型——mutations 只机械写形状，逐字段索引（不强 schema·与原 JS 同语境）。
type Board = Record<string, any>;
type Task = Record<string, any>;

// ── stampNow：严格 ISO-8601 UTC 秒级（YYYY-MM-DDTHH:MM:SSZ·与 board-model.ISO_UTC_RE 同口径）。
//   new Date().toISOString() 形如 2026-06-24T12:34:56.789Z；切掉毫秒段保留 Z。
export function stampNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ── 内部小工具 ───────────────────────────────────────────────────────────────────────────────────
function clone(board: Board): Board {
  return structuredClone(board);
}

// 盖 owner.heartbeat（每次写都调）。保证 owner 对象存在（防 template/手搓板缺 owner 时崩）。
//   导出：让「inline mutate 而非走 mutations.* 专属 helper」的写 handler（如 policy.set 直接写 b.policy/b.log）
//   也能复用这一 stampNow 逻辑刷 heartbeat，与其它写 verb 保持「任何写 → owner.heartbeat=now」一致（round5 bug3）。
export function touch(board: Board): Board {
  if (!board.owner || typeof board.owner !== 'object')
    board.owner = { active: true, session_id: '', heartbeat: '' };
  board.owner.heartbeat = stampNow();
  return board;
}

function err(message: string, errKind: string): KindedError {
  const e = new Error(message) as KindedError;
  e.errKind = errKind;
  return e;
}

function findTask(board: Board, id: string): Task | undefined {
  if (!Array.isArray(board.tasks)) return undefined;
  return board.tasks.find((t: Task) => t && t.id === id);
}

function requireTask(board: Board, id: string): Task {
  const t = findTask(board, id);
  if (!t) throw err(`task not found: ${id}`, 'NotFound');
  return t;
}

function reviewDependencyGate(value: unknown): Record<string, string> {
  if (value !== 'APPROVE') {
    throw err(
      `refused: review gate currently requires APPROVE, got ${JSON.stringify(value)}`,
      'Validation',
    );
  }
  return { kind: 'review', required_verdict: 'APPROVE' };
}

// ── boardInit({goal, githubIssue}) → 从 template 形态产板。owner.active:true、session_id:""（非 arming·cli-design §7）。
//   不读 template 文件（mutations 零 IO）——把 template 形态硬编码在此（与 board.template.json 对齐：
//   schema / meta.template_version / scheduling.wip_limit / tasks:[] / log:[]）。owner.heartbeat 盖戳。
const TEMPLATE_VERSION = 3;
const DEFAULT_WIP_LIMIT = 4;
export function boardInit(args?: { goal?: string; githubIssue?: string }): Board {
  const githubIssue = args && typeof args.githubIssue === 'string' ? args.githubIssue : '';
  const goal =
    args && typeof args.goal === 'string' && args.goal
      ? args.goal
      : githubIssue
        ? `GitHub issue: ${githubIssue}`
        : '';
  const board: Board = {
    schema: SCHEMA_VERSION,
    meta: { template_version: TEMPLATE_VERSION },
    goal,
    owner: { active: true, session_id: '', heartbeat: '' },
    git: { worktree: '', branch: '' },
    scheduling: { wip_limit: DEFAULT_WIP_LIMIT },
    tasks: [],
    log: [],
  };
  if (githubIssue) {
    board.source = {
      kind: 'github_issue',
      url: githubIssue,
    };
  }
  return touch(board);
}

// ── boardUpdate(board, {goal?, wipLimit?, ownerWip?, branch?, worktree?, priority?}) → 改板级配置。
//   priority 写 ✎ coordination.priority（板级优先级·COORD 裁决主轴·hook 不读·非窄腰）——枚举合法性由调用方
//   （handler isEnumMember 校验）/ lint FMT-COORD 守，此处只负责落字段（与 wipLimit 一样只写不校验）。
export function boardUpdate(
  board: Board,
  args?: {
    goal?: string;
    wipLimit?: unknown;
    ownerWip?: unknown;
    branch?: string;
    worktree?: string;
    priority?: string;
  },
): Board {
  const b = clone(board);
  args = args || {};
  if (args.goal !== undefined) b.goal = args.goal;
  if (args.priority !== undefined) {
    if (!b.coordination || typeof b.coordination !== 'object') b.coordination = {};
    b.coordination.priority = args.priority;
  }
  if (args.wipLimit !== undefined || args.ownerWip !== undefined) {
    if (!b.scheduling || typeof b.scheduling !== 'object') b.scheduling = {};
    if (args.wipLimit !== undefined) b.scheduling.wip_limit = args.wipLimit;
    if (args.ownerWip !== undefined) b.scheduling.owner_wip_limit = args.ownerWip;
  }
  if (args.branch !== undefined || args.worktree !== undefined) {
    if (!b.git || typeof b.git !== 'object') b.git = {};
    if (args.branch !== undefined) b.git.branch = args.branch;
    if (args.worktree !== undefined) b.git.worktree = args.worktree;
  }
  return touch(b);
}

// ── boardArchive(board) → 归档板：翻 owner.active=false（停用即休眠·显式可逆）。
//   带锁写 SSOT——给 stop / handoff 命令一条**经引擎、走 runWrite lock 管线**的归档路径，替代它们曾经
//   手编辑 board JSON 翻 owner.active（手编辑与 ADR-020 的 Stop hook 带锁写并发会 torn-write·毁状态）。
//   只动 owner.active（窄腰字段·红线2）+ touch 刷 heartbeat；tasks / log / goal / git 全留（**非破坏**·
//   审计留痕·日后可经 `/cc-master:as-master-orchestrator --resume` 复活·ADR-009）。幂等：已 false 再 archive
//   仍 false（无副作用）。归档判据是「翻 active」这一步本身——孤儿 / rollup 检查归命令体（在归档前做）。
export function boardArchive(board: Board): Board {
  const b = clone(board);
  if (!b.owner || typeof b.owner !== 'object')
    b.owner = { active: false, session_id: '', heartbeat: '' };
  b.owner.active = false;
  return touch(b);
}

// ── boardSetParam(board, {key, value}) → 写 board.runtime.<白名单 key>（ADR-020·hook-owned 参数区）。
//   least-privilege 字段级 setter：作用域**收窄到 `runtime.*`**，verb 层（本函数）做 ① key 白名单（非白名单
//   → throw .errKind='Usage'·exit 2）+ ② 值类型校验（按 key 的声明类型·如 ISO key 走 isISOUTC·非法 → Usage）。
//   只允许写 `board.runtime.<白名单 key>`——绝不触碰 🔒/👁 窄腰（白名单是第一道闸，applySet 的 assertFlexible
//   是第二道兜底·但本函数直写 runtime 不经 applySet）。touch 刷 owner.heartbeat（与所有写 verb 同口径）。
//
// RUNTIME_PARAM_KEYS：runtime 参数区的键白名单 + 每个键的值校验器（'iso' = 严格 ISO-8601 UTC）。
//   开放扩展：未来加一个周期 hook 簿记键 = 在此加一条（+ board-model FIELDS.runtime 字段说明），复用 set-param。
const RUNTIME_PARAM_KEYS: Record<string, 'iso'> = {
  last_identity_remind: 'iso',
  last_critpath_remind: 'iso', // critpath-nudge（周期临界路径提示·hooks-enhancements-v2 ②）写回时间戳
  last_account_switch: 'iso', // 换号发生时刻（ADR-024·usage-pacing hook 每 Stop 读它注入 ambient·含手动 switch）
  stop_allow_until: 'iso', // Codex Stop decision:block 释放闸：agent 确认可停后写一个短期未来时间
};
export function boardSetParam(board: Board, args?: { key?: string; value?: string }): Board {
  const key = args && typeof args.key === 'string' ? args.key : '';
  const value = args && typeof args.value === 'string' ? args.value : '';
  const valKind = RUNTIME_PARAM_KEYS[key];
  if (valKind === undefined) {
    const allowed = Object.keys(RUNTIME_PARAM_KEYS).join(', ');
    throw err(
      `refused: "${key}" 不在 runtime 参数区白名单（仅允许：${allowed}）。set-param 作用域收窄到 board.runtime.<白名单 key>（ADR-020·least-privilege）。`,
      'Usage',
    );
  }
  if (valKind === 'iso' && !isISOUTC(value)) {
    throw err(
      `refused: runtime.${key} 须是严格 ISO-8601 UTC（YYYY-MM-DDTHH:MM:SSZ），收到 ${JSON.stringify(value)}。`,
      'Usage',
    );
  }
  const b = clone(board);
  if (!b.runtime || typeof b.runtime !== 'object' || Array.isArray(b.runtime)) b.runtime = {};
  b.runtime[key] = value;
  return touch(b);
}

// ── boardStampHarness(board, {harnessId}) → ARM-time owner.harness stamp（ADR-032 P1）。
//   Confidence guard is HARD: callers pass a harnessId only when a known adapter.detect(env) matched.
//   No trusted id means no-op (preserve existing trusted values and do not refresh heartbeat).
export function boardStampHarness(board: Board, args?: { harnessId?: string | null }): Board {
  const harnessId = args && typeof args.harnessId === 'string' ? args.harnessId : '';
  if (!harnessId) return clone(board);
  if (!isEnumMember('harness', harnessId) || harnessId === 'unknown') {
    throw err(
      `refused: owner.harness stamp requires a trusted known harness id, got ${JSON.stringify(harnessId)}.`,
      'Usage',
    );
  }
  const b = clone(board);
  if (!b.owner || typeof b.owner !== 'object' || Array.isArray(b.owner)) {
    b.owner = { active: true, session_id: '', heartbeat: '' };
  }
  b.owner.harness = harnessId;
  return touch(b);
}

function hasRoutingContractState(task: Task): boolean {
  return task.planning !== undefined || task.routing !== undefined;
}

function routedPreparationIssues(task: Task): Array<{ path: string; message: string }> {
  const issues = [...validateTaskPlanning(task.planning), ...validateTaskRoutePolicy(task)];
  if (
    !task.estimate ||
    typeof task.estimate !== 'object' ||
    Array.isArray(task.estimate) ||
    typeof task.estimate.value !== 'number' ||
    task.estimate.value <= 0 ||
    typeof task.estimate.unit !== 'string' ||
    task.estimate.unit === ''
  ) {
    issues.push({
      code: 'ROUTED-TASK-ESTIMATE',
      path: 'estimate',
      message: 'must be a positive {value:number,unit:string}',
    });
  }
  return issues;
}

function assertExecutorMutation(board: Board, task: Task, nextExecutor: unknown): void {
  if (nextExecutor === undefined || nextExecutor === task.executor) return;
  const enabled = contractActivation(board) === 'enabled';
  const routedState = hasRoutingContractState(task);

  if (task.status === 'in_flight' && (enabled || routedState || nextExecutor === 'subagent')) {
    throw err(
      'refused: executor is frozen while a contract-related task is in_flight; finish/reconcile the attempt instead of reclassifying it',
      'Validation',
    );
  }
  if (task.executor === 'subagent' && (enabled || routedState)) {
    throw err(
      'refused: executor is frozen after a subagent enters the active/staged routing contract',
      'Validation',
    );
  }
  if (routedState && nextExecutor !== 'subagent') {
    throw err(
      'refused: a task with planning/routing contract state may only complete its one-way executor assignment to subagent',
      'Validation',
    );
  }
  if (nextExecutor === 'subagent' && (enabled || routedState)) {
    const candidate = { ...task, executor: 'subagent' };
    const issues = routedPreparationIssues(candidate);
    if (issues.length) {
      throw err(
        `refused: executor=subagent requires complete planning/routing/estimate before assignment: ${issues.map((entry) => `${entry.path}: ${entry.message}`).join('; ')}`,
        'Validation',
      );
    }
  }
}

// ── addTask(board, fields) → 建 task。fields 已由 router 从 registry 映射好（字段名对齐 FIELDS.task）。
//   必填语义：id（router 校验非空）。status 缺省 'ready'、deps 缺省 []、created_at 盖戳。其余 ✎ 字段
//   只在 fields 显式给出时写入（silent-on-unknown：不臆造默认）。
export function addTask(board: Board, fields?: Record<string, any>): Board {
  const b = clone(board);
  if (!Array.isArray(b.tasks)) b.tasks = [];
  fields = fields || {};
  if (fields.planning !== undefined || fields.routing !== undefined) {
    throw err(
      'refused: planning/routing use dedicated commands (`task set-planning` / `task set-routing`), not task add fields',
      'Validation',
    );
  }
  if (
    contractActivation(b) === 'enabled' &&
    fields.executor === 'subagent' &&
    fields.status === 'in_flight'
  ) {
    throw err(
      'refused: contract-enabled subagent cannot be added directly in_flight; obtain an opaque handle claim and use `ccm task route-bind`',
      'Validation',
    );
  }
  assertExecutorMutation(
    b,
    { status: fields.status !== undefined ? fields.status : 'ready' },
    fields.executor,
  );
  const task: Task = {
    id: fields.id,
    status: fields.status !== undefined ? fields.status : 'ready',
    deps: Array.isArray(fields.deps) ? fields.deps.slice() : [],
  };
  if (fields.reviewGate !== undefined) {
    task.dependency_gate = reviewDependencyGate(fields.reviewGate);
  }
  // ✎ / 🔒 其余字段：只在显式给出时落（不臆造默认值，degrade 由 lint/缺省语义处理）。
  for (const k of [
    'parent',
    'title',
    'description',
    'type',
    'executor',
    'handle',
    'estimate',
    'references',
    'acceptance',
    'role',
    'justification',
    'verified',
    'artifact',
    'blocked_on',
    'decision_package',
    'output_schema',
    'dep_pins',
    'wip_limit',
    'observability',
    'hitl_rounds',
    'started_at',
    'finished_at',
  ]) {
    if (fields[k] !== undefined) task[k] = fields[k];
  }
  task.created_at = fields.created_at !== undefined ? fields.created_at : stampNow();
  b.tasks.push(task);
  return touch(b);
}

// ── updateTask(board, id, fields) → 改字段 / 增删 deps / 增删 references。
//   fields 形态：直接字段覆写 + 特殊键 addDep/rmDep/addRef/rmRef（数组，逐条增删）。
//   🔒 status/deps/parent 的直接覆写在此层不拦（status 走 transition、deps 走 add/rmDep，parent 走专属）；
//   但本函数仍允许 fields.parent 等被 router 经专属命令显式传入——它只是「机械地写形状」，
//   load-bearing 保护边界由 applySet（通用 --set 逃生口）守。
export function updateTask(board: Board, id: string, fields?: Record<string, any>): Board {
  const b = clone(board);
  const t = requireTask(b, id);
  fields = fields || {};
  if (fields.planning !== undefined || fields.routing !== undefined) {
    throw err(
      'refused: planning/routing are dedicated-writer fields; use `task set-planning` / `task set-routing` / `task route-bind`',
      'Validation',
    );
  }
  if (
    fields.handle !== undefined &&
    contractActivation(b) === 'enabled' &&
    t.executor === 'subagent'
  ) {
    throw err(
      'refused: task.handle is a route-bind projection on contract-enabled subagents; use `task route-bind`',
      'Validation',
    );
  }
  assertExecutorMutation(b, t, fields.executor);
  if (fields.reviewGate !== undefined) {
    t.dependency_gate = reviewDependencyGate(fields.reviewGate);
  }
  // 增删 deps（去重）。
  if (Array.isArray(fields.addDep)) {
    if (!Array.isArray(t.deps)) t.deps = [];
    for (const d of fields.addDep) if (!t.deps.includes(d)) t.deps.push(d);
  }
  if (Array.isArray(fields.rmDep)) {
    if (Array.isArray(t.deps)) t.deps = t.deps.filter((d: unknown) => !fields.rmDep.includes(d));
  }
  // 增删 references（addRef 为 {kind, ref, note?} 对象数组；rmRef 为要删的 ref 字符串数组）。
  if (Array.isArray(fields.addRef)) {
    if (!Array.isArray(t.references)) t.references = [];
    for (const r of fields.addRef) t.references.push(r);
  }
  if (Array.isArray(fields.rmRef)) {
    if (Array.isArray(t.references))
      t.references = t.references.filter((r: any) => !fields.rmRef.includes(r && r.ref));
  }
  // 普通字段覆写（排除已处理的特殊键 + id 不可改）。
  const SPECIAL = new Set(['addDep', 'rmDep', 'addRef', 'rmRef', 'reviewGate', 'id']);
  for (const [k, v] of Object.entries(fields)) {
    if (SPECIAL.has(k)) continue;
    if (v === undefined) continue;
    t[k] = v;
  }
  return touch(b);
}

// ── recordTaskReviewVerdict(board, id, verdict) → 记录 review 结论，不改变执行状态。──────────────
//   review task 的 status=done 只表示 review 工作已经执行；只有显式 APPROVE 才满足下游 deps。
//   verdict 只属于当前 attempt，且必须依附于显式 review gate，避免普通 task 静默长出 review outcome。
export function recordTaskReviewVerdict(board: Board, id: string, verdict: unknown): Board {
  const b = clone(board);
  const t = requireTask(b, id);
  if (!isReviewDependencyGate(t.dependency_gate)) {
    throw err(
      `refused: task ${id} has no explicit review gate; declare it with --review-gate APPROVE before recording a verdict`,
      'Validation',
    );
  }
  if (!isEnumMember('reviewVerdict', verdict)) {
    throw err(
      `refused: invalid review verdict ${JSON.stringify(verdict)}; expected APPROVE or REQUEST-CHANGES`,
      'Validation',
    );
  }
  t.review_verdict = verdict;
  return touch(b);
}

// review_verdict 是 attempt-scoped current evidence。所有新 attempt writer 与 done-without-verdict
// 都复用这一处清理；若 retry writer 要归档旧值，必须先 snapshot，再调用本 helper。
function clearAttemptScopedReviewVerdictInPlace(task: Task): void {
  delete task.review_verdict;
}

export function clearTaskReviewVerdict(board: Board, id: string): Board {
  const b = clone(board);
  clearAttemptScopedReviewVerdictInPlace(requireTask(b, id));
  return touch(b);
}

// ── transition(board, id, toStatus, {force}) → 状态机转移（isLegalTransition）。
//   非法且非 force → throw .errKind='IllegalTransition'（message 列合法后继）。
//   start（→in_flight）盖 started_at、done（→done）盖 finished_at（均经 stampNow；已有则不覆盖? —— 覆盖，
//   以「这次转移发生的时刻」为准，幂等 from===to 仍盖以反映最新动作时间）。
export function transition(
  board: Board,
  id: string,
  toStatus: string,
  opts?: { force?: boolean },
): Board {
  const force = !!(opts && opts.force);
  const b = clone(board);
  const t = requireTask(b, id);
  const from = t.status;
  if (
    toStatus === 'in_flight' &&
    contractActivation(b) === 'enabled' &&
    t.executor === 'subagent'
  ) {
    const issues = validateRoutedTaskForInFlight(t);
    if (issues.length) {
      throw err(
        `refused: contract-enabled subagent enters in_flight only through \`ccm task route-bind\` after a syntactic opaque handle claim; ${issues.map((entry) => `${entry.path}: ${entry.message}`).join('; ')}`,
        'Validation',
      );
    }
  }
  if (!isLegalTransition(from, toStatus) && !force) {
    const outs = STATUS_MACHINE.transitions[from] || [];
    throw err(
      `illegal transition: ${from} → ${toStatus}. legal next from "${from}": ${outs.length ? outs.join(', ') : '(none)'}`,
      'IllegalTransition',
    );
  }
  if (isRetryTransition(from, toStatus)) {
    reactivateTaskInPlace(b, t, from);
    return touch(b);
  }
  t.status = toStatus;
  if (toStatus === 'in_flight') t.started_at = stampNow();
  if (toStatus === 'done') t.finished_at = stampNow();
  return touch(b);
}

// retryTask(board,id) → 开一个干净的新 attempt（stale|failed|escalated → ready）。
// 与 generic transition 的 retry 边共用 reactivateTaskInPlace，避免 `task set-status ... ready` 成为绕过 reset 的第二写路。
export function retryTask(board: Board, id: string): Board {
  const b = clone(board);
  const t = requireTask(b, id);
  const from = t.status;
  if (!isRetryTransition(from, 'ready')) {
    const outs = STATUS_MACHINE.transitions[from] || [];
    throw err(
      `illegal retry: ${from} → ready. retryable statuses: stale, failed, escalated; legal next from "${from}": ${outs.length ? outs.join(', ') : '(none)'}`,
      'IllegalTransition',
    );
  }
  reactivateTaskInPlace(b, t, from);
  return touch(b);
}

function reactivateTaskInPlace(board: Board, task: Task, fromStatus: string): void {
  const priorEvidence: Record<string, unknown> = {};
  // Snapshot every attempt-scoped completion/review fact before clearing current state. The
  // archived verdict is audit evidence only; dependency gates read only task.review_verdict.
  for (const key of ['started_at', 'finished_at', 'artifact', 'verified', 'review_verdict']) {
    if (Object.hasOwn(task, key)) priorEvidence[key] = structuredClone(task[key]);
  }

  if (!Array.isArray(board.log)) board.log = [];
  board.log.push({
    ts: stampNow(),
    summary: `retry task ${String(task.id)}: ${fromStatus} → ready; archived prior attempt evidence`,
    kind: 'replan',
    task: task.id,
    detail: JSON.stringify({
      schema: 'ccm/task-retry/v1',
      from_status: fromStatus,
      prior_evidence: priorEvidence,
    }),
  });

  task.status = 'ready';
  delete task.started_at;
  delete task.finished_at;
  delete task.artifact;
  task.verified = false;
  clearAttemptScopedReviewVerdictInPlace(task);
}

function assertNoContractIssues(
  label: string,
  issues: Array<{ path: string; message: string }>,
): void {
  if (!issues.length) return;
  throw err(
    `refused: invalid ${label}: ${issues.map((entry) => `${entry.path}: ${entry.message}`).join('; ')}`,
    'Validation',
  );
}

export function setTaskPlanning(board: Board, id: string, planning: unknown): Board {
  assertNoContractIssues('task planning', validateTaskPlanning(planning));
  const b = clone(board);
  const t = requireTask(b, id);
  t.planning = structuredClone(planning);
  return touch(b);
}

export function setTaskRoutingPolicy(board: Board, id: string, policy: unknown): Board {
  const b = clone(board);
  const t = requireTask(b, id);
  const existingAttempts =
    t.routing && typeof t.routing === 'object' && Array.isArray(t.routing.attempts)
      ? t.routing.attempts
      : [];
  if (existingAttempts.length > 0 || (t.routing && t.routing.selected)) {
    throw err(
      'refused: set-routing cannot replace a selected route or attempt history; attempts are append-only',
      'Validation',
    );
  }
  const routing = createRoutingEnvelope(policy);
  assertNoContractIssues('task routing policy', validateTaskRoutePolicy({ ...t, routing }));
  t.routing = routing;
  return touch(b);
}

export function bindTaskRoute(
  board: Board,
  id: string,
  args: { selection?: unknown; attempt?: unknown },
): Board {
  const b = clone(board);
  const t = requireTask(b, id);
  if (t.executor !== 'subagent') {
    throw err('refused: route-bind is only valid for executor=subagent', 'Validation');
  }
  if (!t.routing || typeof t.routing !== 'object' || !Array.isArray(t.routing.attempts)) {
    throw err('refused: route-bind requires `task set-routing` first', 'Validation');
  }
  if (!args || !args.selection || !args.attempt || typeof args.attempt !== 'object') {
    throw err('refused: route-bind requires selection and attempt objects', 'Validation');
  }
  const attemptInput = args.attempt as Record<string, any>;
  if (attemptInput.state !== 'running') {
    throw err('refused: C1 route-bind accepts only state=running attempt claims', 'Validation');
  }
  if (typeof attemptInput.handle !== 'string' || attemptInput.handle.trim() === '') {
    throw err(
      'refused: route-bind requires a non-empty opaque handle claim (C1 syntactic claim; not real/live attestation)',
      'Validation',
    );
  }
  if (t.status !== 'ready' && t.status !== 'in_flight') {
    throw err(
      `refused: route-bind requires task status ready or legacy in_flight (current: ${String(t.status)})`,
      'Validation',
    );
  }
  if (
    t.routing.attempts.some(
      (attempt: unknown) =>
        !!attempt &&
        typeof attempt === 'object' &&
        (attempt as Record<string, unknown>).state === 'running',
    )
  ) {
    throw err('refused: route-bind cannot create a second running attempt', 'Validation');
  }
  if (
    t.routing.attempts.some(
      (attempt: unknown) =>
        !!attempt &&
        typeof attempt === 'object' &&
        (attempt as Record<string, unknown>).id === attemptInput.id,
    )
  ) {
    throw err(`refused: duplicate attempt id ${String(attemptInput.id)}`, 'Validation');
  }

  const selection = structuredClone(args.selection);
  const attempt: Record<string, any> = {
    ...structuredClone(attemptInput),
    selection_snapshot: structuredClone(selection),
  };
  t.routing.selected = selection;
  t.routing.attempts.push(attempt);
  t.handle = attempt.handle;
  const wasReady = t.status === 'ready';
  t.status = 'in_flight';
  if (wasReady) t.started_at = stampNow();
  assertNoContractIssues('routed in-flight task', validateRoutedTaskForInFlight(t));
  return touch(b);
}

export function enableRoutingContracts(board: Board): Board {
  if (contractActivation(board) === 'enabled') return clone(board);
  const report = routingContractPreflight(board);
  if (report.tasks.length) {
    throw err(
      `refused: routing contract preflight has ${report.tasks.length} task gap(s): ${report.tasks.map((task) => `${task.task_id}[${task.issues.map((entry) => entry.path).join(',')}]`).join('; ')}`,
      'Validation',
    );
  }
  const b = clone(board);
  if (!b.meta || typeof b.meta !== 'object' || Array.isArray(b.meta)) b.meta = {};
  if (
    !b.meta.contracts ||
    typeof b.meta.contracts !== 'object' ||
    Array.isArray(b.meta.contracts)
  ) {
    b.meta.contracts = {};
  }
  const grandfathered = (Array.isArray(b.tasks) ? b.tasks : [])
    .filter(
      (task: Task) =>
        task &&
        task.executor === 'subagent' &&
        ['done', 'failed', 'escalated'].includes(task.status),
    )
    .map((task: Task) => ({
      task_id: task.id,
      created_at: typeof task.created_at === 'string' ? task.created_at : null,
    }));
  b.meta.contracts.task_planning = 'ccm/task-planning/v1';
  b.meta.contracts.agent_routing = 'ccm/agent-routing/v1';
  b.meta.contracts.agent_routing_activated_at = stampNow();
  b.meta.contracts.agent_routing_grandfathered_terminal = grandfathered;
  return touch(b);
}

// ── blockTask(board, id, {on, decisionPackage}) → status=blocked + blocked_on=on（+ decision_package）。
//   on==='user' 时建议带 decisionPackage（BIZ-AWAITING 在 lint 层 hard 挡，此处不校验、只机械写）。
//   经 transition 的合法性？block 是 ready/in_flight→blocked，二者皆合法；但 block 可从任意态发起（force 语义）——
//   故直接置 status=blocked（不经 transition 闸；状态机里 done→blocked 非法，但 block 命令意图是「卡住」，
//   由 handler 决定是否 force；mutations 这里只忠实写「卡住」形状，合法性留给 transition/set-status 专管）。
export function blockTask(
  board: Board,
  id: string,
  args?: { on?: string; decisionPackage?: unknown },
): Board {
  const b = clone(board);
  const t = requireTask(b, id);
  args = args || {};
  t.status = 'blocked';
  if (args.on !== undefined) t.blocked_on = args.on;
  if (args.decisionPackage !== undefined) t.decision_package = args.decisionPackage;
  return touch(b);
}

// ── unblockTask(board, id) → 清除语义阻塞标记 blocked_on（+ decision_package）。ADR-023。
//   只机械地删 blocked_on / decision_package，**不直接定 status**——status 由写入关卡的 reconcileGating
//   按 dependencySatisfied 归一（deps 全满足→ready，否则→blocked）。这是「blocked_on 作语义阻塞判别器」的解除侧：
//   有 blocked_on 时该 task 豁免自动门控（在等 user / 等某 task）；unblock 后交回 deps 驱动的自动门控。
//   目标 id 不存在 → requireTask throw NotFound（冒泡 router 映射 exit 5）。
export function unblockTask(board: Board, id: string): Board {
  const b = clone(board);
  const t = requireTask(b, id);
  delete t.blocked_on;
  // decision_package 是 awaiting-user 节点的附属采访包——语义阻塞解除后它已无锚点，一并清（避免 BIZ 悬挂包）。
  delete t.decision_package;
  return touch(b);
}

// ── appendLog(board, {summary, kind?, task?, detail?, refs?}) → append-only 审计条目。
//   ts 盖 stampNow。只增不改不删（cli-design §3 / FIELDS.board.log）。
export function appendLog(
  board: Board,
  args?: { summary?: string; kind?: string; task?: string; detail?: string; refs?: unknown },
): Board {
  const b = clone(board);
  if (!Array.isArray(b.log)) b.log = [];
  args = args || {};
  const entry: Record<string, any> = {
    ts: stampNow(),
    summary: args.summary !== undefined ? args.summary : '',
  };
  if (args.kind !== undefined) entry.kind = args.kind;
  if (args.task !== undefined) entry.task = args.task;
  if (args.detail !== undefined) entry.detail = args.detail;
  if (args.refs !== undefined) entry.refs = args.refs;
  b.log.push(entry);
  return touch(b);
}

// ── addJc(board, fields) → judgment_calls 自决台账条目（字段对齐 example：
//   id, summary, category, decision?, rationale?, impact?, severity, refs?, task_ref?, raised_at, status）。
//   status 缺省 'pending_review'、raised_at 盖戳。
export function addJc(board: Board, fields?: Record<string, any>): Board {
  const b = clone(board);
  if (!Array.isArray(b.judgment_calls)) b.judgment_calls = [];
  fields = fields || {};
  const jc: Record<string, any> = {
    id: fields.id,
    summary: fields.summary !== undefined ? fields.summary : '',
    status: fields.status !== undefined ? fields.status : 'pending_review',
  };
  for (const k of ['category', 'decision', 'rationale', 'impact', 'severity', 'refs', 'task_ref']) {
    if (fields[k] !== undefined) jc[k] = fields[k];
  }
  jc.raised_at = fields.raised_at !== undefined ? fields.raised_at : stampNow();
  b.judgment_calls.push(jc);
  return touch(b);
}

// ── resolveJc(board, id, {status, note}) → 把一条 jc 置为 upheld / overturned（+ 可选 note）。
export function resolveJc(
  board: Board,
  id: string,
  args?: { status?: string; note?: string },
): Board {
  const b = clone(board);
  if (!Array.isArray(b.judgment_calls)) b.judgment_calls = [];
  const jc = b.judgment_calls.find((j: Record<string, any>) => j && j.id === id);
  if (!jc) throw err(`judgment_call not found: ${id}`, 'NotFound');
  args = args || {};
  if (args.status !== undefined) jc.status = args.status;
  if (args.note !== undefined) jc.note = args.note;
  jc.resolved_at = stampNow();
  return touch(b);
}

// ── cadence ─────────────────────────────────────────────────────────────────────────────────────
// cadenceUpdate(board, {shipEvery?, minUnit?}) → cadence.target={ship_every, min_unit}。
export function cadenceUpdate(
  board: Board,
  args?: { shipEvery?: unknown; minUnit?: unknown },
): Board {
  const b = clone(board);
  args = args || {};
  if (!b.cadence || typeof b.cadence !== 'object') b.cadence = {};
  if (args.shipEvery !== undefined || args.minUnit !== undefined) {
    if (!b.cadence.target || typeof b.cadence.target !== 'object') b.cadence.target = {};
    if (args.shipEvery !== undefined) b.cadence.target.ship_every = args.shipEvery;
    if (args.minUnit !== undefined) b.cadence.target.min_unit = args.minUnit;
  }
  return touch(b);
}

// cadenceOpen(board, iterId, {goal?, deadline?, members?}) → 开一个 iteration（status=open、started_at 盖戳）。
//   iteration 形态：{id, started_at, deadline, goal, members, status}（对齐 example / FMT-CADENCE）。
export function cadenceOpen(
  board: Board,
  iterId: string,
  args?: { goal?: string; deadline?: string; members?: unknown },
): Board {
  const b = clone(board);
  args = args || {};
  if (!b.cadence || typeof b.cadence !== 'object') b.cadence = {};
  if (!Array.isArray(b.cadence.iterations)) b.cadence.iterations = [];
  const iter: Record<string, any> = { id: iterId, started_at: stampNow(), status: 'open' };
  if (args.goal !== undefined) iter.goal = args.goal;
  if (args.deadline !== undefined) iter.deadline = args.deadline;
  if (args.members !== undefined)
    iter.members = Array.isArray(args.members) ? args.members.slice() : args.members;
  b.cadence.iterations.push(iter);
  return touch(b);
}

// cadenceShip(board, iterId, {force}) → 把一个 iteration 置 status=shipped。
//   注：BIZ-CADENCE-SHIPPED（members 全 done+verified）是 lint 层的 hard 闸，**不在此校验**——
//   mutations 只机械置 status=shipped；成员完整性由写入关卡的 lint 在落盘前挡（cli-design §5）。
//   shipped_at 盖戳。{force} 在 mutations 层无差异（成员校验不在此），保留签名对齐契约。
export function cadenceShip(board: Board, iterId: string, _args?: { force?: boolean }): Board {
  const b = clone(board);
  if (!b.cadence || typeof b.cadence !== 'object' || !Array.isArray(b.cadence.iterations)) {
    throw err(`iteration not found: ${iterId}`, 'NotFound');
  }
  const iter = b.cadence.iterations.find((it: Record<string, any>) => it && it.id === iterId);
  if (!iter) throw err(`iteration not found: ${iterId}`, 'NotFound');
  iter.status = 'shipped';
  iter.shipped_at = stampNow();
  return touch(b);
}

// ── watchdog（ADR-011 自我唤醒）─────────────────────────────────────────────────────────────────
// watchdogArm(board, {fireAt, mechanism, jobId?, checklist?}) → 整对象写入（armed_at 盖戳）。
export function watchdogArm(
  board: Board,
  args?: { fireAt?: string; mechanism?: string; jobId?: string; checklist?: unknown },
): Board {
  const b = clone(board);
  args = args || {};
  const wd: Record<string, any> = { armed_at: stampNow() };
  if (args.fireAt !== undefined) wd.fire_at = args.fireAt;
  if (args.mechanism !== undefined) wd.mechanism = args.mechanism;
  if (args.jobId !== undefined) wd.job_id = args.jobId;
  if (args.checklist !== undefined) wd.checklist = args.checklist;
  b.watchdog = wd;
  return touch(b);
}

// watchdogDisarm(board) → 删整 watchdog 对象（置 null·不留残骸·FIELDS.board.watchdog degrade）。
export function watchdogDisarm(board: Board): Board {
  const b = clone(board);
  b.watchdog = null;
  return touch(b);
}

// ── applySet / applySetJson（通用逃生口·只限 ✎ flexible path·cli-design §3.5）──────────────────────
//   🔒 load-bearing path（board 顶层 schema/owner/goal/git/tasks + task 的 id/status/deps/parent）→
//   throw .errKind='Validation'（提示用专属命令）。只允许 ✎ flexible path。
//
//   dotpath 解析：作用于「已定位的 task 对象」或「board 顶层」。签名设计（契约留给实现）：
//     applySet(board, dotpath, value, opts?) —— dotpath 第一段决定作用域：
//       · 'tasks[<id>].<field>...' 或 'tasks.<id>.<field>...' → 定位到该 id 的 task，改其 <field>
//       · 否则（裸 path）→ 由 opts.defaultTaskId 决定（Finding #83 根治）：
//           · 给了 defaultTaskId（task verb 语境：`task update <id> --set foo=v`）→ scope 到该 task 的 foo
//             （与 --title 等普通 flag 一致的直觉；跨 task 仍可用显式 tasks[<其它id>].field 前缀逃生）
//           · 未给（board update / jc / cadence 语境）→ 作用于 board 顶层 dotpath
//   🔒 拒绝判据：归一化后的「逻辑 path」落在 LOAD_BEARING_PATHS 集合（board 顶层五 + task 四）即拒——
//     scoping 归一**先于**守门，故 task 语境下裸 `--set status=…` 现在命中 LB_TASK 被拒（不再静默落顶层 junk）。

// board 顶层 🔒（FIELDS.board tier==='🔒'）：schema/goal/owner/git/tasks。
const LB_BOARD = new Set(['schema', 'goal', 'owner', 'git', 'tasks']);
// task 🔒（FIELDS.task tier==='🔒'）：id/status/deps/parent。
const LB_TASK = new Set(['id', 'status', 'deps', 'parent']);

interface ParsedPath {
  scope: 'task' | 'board';
  taskId?: string;
  segs: string[];
}

// applySet / applySetJson 的作用域选项：defaultTaskId 给出时，裸 dotpath scope 到该 task（task verb 语境）。
export interface SetScope {
  defaultTaskId?: string;
}

// 把 dotpath 拆成段，支持 tasks[<id>] 与 tasks.<id> 两式定位 task。返回 {scope, taskId?, segs}。
//   scope: 'task' → 作用于某 task；'board' → 作用于 board 顶层。
//   defaultTaskId 给出时，裸 path（不带 tasks[…]/tasks.<id> 前缀）归一为该 task 的字段 path（Finding #83）。
function parsePath(dotpath: string, defaultTaskId?: string): ParsedPath {
  if (typeof dotpath !== 'string' || dotpath === '') {
    throw err(`invalid dotpath: ${JSON.stringify(dotpath)}`, 'Validation');
  }
  // tasks[<id>].rest  或  tasks[<id>]
  const bracket = dotpath.match(/^tasks\[([^\]]+)\](?:\.(.+))?$/);
  if (bracket) {
    const taskId = bracket[1];
    const rest = bracket[2] ? bracket[2].split('.') : [];
    return { scope: 'task', taskId, segs: rest };
  }
  const segs = dotpath.split('.');
  if (segs[0] === 'tasks' && segs.length >= 2) {
    // tasks.<id>.rest 形式（点号定位）。
    const taskId = segs[1];
    const rest = segs.slice(2);
    return { scope: 'task', taskId, segs: rest };
  }
  if (typeof defaultTaskId === 'string' && defaultTaskId !== '') {
    // 裸 path + task verb 语境 → scope 到该 task（与 --title 等普通 flag 一致的直觉）。
    return { scope: 'task', taskId: defaultTaskId, segs };
  }
  return { scope: 'board', taskId: undefined, segs };
}

// 归一后的「逻辑 path」（render 回显用）：task scope → tasks[<id>].<segs>；board scope → <segs>。
//   与 applySet 用同一 parsePath——回显的就是实际写入的落点，消除「报 task 已更新、值却落别处」的零信号。
export function logicalSetPath(dotpath: string, opts?: SetScope): string {
  const parsed = parsePath(dotpath, opts?.defaultTaskId);
  if (parsed.scope === 'task') {
    return `tasks[${parsed.taskId}]${parsed.segs.length ? `.${parsed.segs.join('.')}` : ''}`;
  }
  return parsed.segs.join('.');
}

// 🔒 守门：拒绝 load-bearing path。
function assertFlexible(board: Board, parsed: ParsedPath): void {
  if (parsed.scope === 'board') {
    // 作用于 board 顶层：首段落在 LB_BOARD 即拒（含直接改 tasks 数组本身或 tasks 越界写 🔒 子字段）。
    //   board scope 的 segs 来自 dotpath.split('.')·必 ≥1 段·head 定值；as string 窄断言（不改逻辑·
    //   原 JS 即便 head=undefined 调 Set.has 也安全返回 false）。
    const head = parsed.segs[0] as string;
    if (LB_BOARD.has(head)) {
      throw err(
        `refused: "${head}" is a load-bearing (🔒) field; use the dedicated command (e.g. task add/start/set-status, board update, task add-dep) instead of --set`,
        'Validation',
      );
    }
  } else {
    // 作用于某 task：首段（task 字段名）落在 LB_TASK 即拒。
    const head = parsed.segs[0];
    if (head === undefined) {
      // tasks[<id>] 整对象替换 = 等于改 🔒 id/status/deps 整体，拒。
      throw err(`refused: cannot --set a whole task object; use task add/update`, 'Validation');
    }
    if (LB_TASK.has(head)) {
      throw err(
        `refused: "${head}" is a load-bearing (🔒) task field; use the dedicated command (task set-status / task add-dep / task update --parent) instead of --set`,
        'Validation',
      );
    }
  }
  const policy = contractWritePolicy(parsed.scope, parsed.segs, {
    contractEnabled: contractActivation(board) === 'enabled',
  });
  if (policy !== 'generic') {
    throw err(
      `refused: "${parsed.segs.join('.')}" has ${policy} writer policy; use board enable-contract / task set-planning / task set-routing / task route-bind instead of --set`,
      'Validation',
    );
  }
}

// 沿 segs 设值（中途缺对象则建空对象）。返回根（已定位的 task 或 board）。
//   注（T2a port·noUncheckedIndexedAccess）：i<len-1 与 len-1 索引均在界内·as string 窄断言（不改逻辑）。
function setDeep(root: Record<string, any>, segs: string[], value: unknown): void {
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i] as string;
    if (cur[s] === undefined || cur[s] === null || typeof cur[s] !== 'object') cur[s] = {};
    cur = cur[s];
  }
  cur[segs[segs.length - 1] as string] = value;
}

export function applySet(board: Board, dotpath: string, value: unknown, opts?: SetScope): Board {
  const b = clone(board);
  const parsed = parsePath(dotpath, opts?.defaultTaskId);
  assertFlexible(b, parsed);
  if (parsed.scope === 'task') {
    const t = requireTask(b, parsed.taskId as string);
    if (parsed.segs.length === 1 && parsed.segs[0] === 'executor') {
      assertExecutorMutation(b, t, value);
    }
    setDeep(t, parsed.segs, value);
  } else {
    setDeep(b, parsed.segs, value);
  }
  return touch(b);
}

// applySetJson(board, dotpath, json, opts?) — json 为字符串（待解析）或已解析对象/数组。同 🔒 守门 + 同 scoping。
export function applySetJson(board: Board, dotpath: string, json: unknown, opts?: SetScope): Board {
  let value = json;
  if (typeof json === 'string') {
    try {
      value = JSON.parse(json);
    } catch (e) {
      throw err(`invalid JSON for --set-json ${dotpath}: ${(e as Error).message}`, 'Validation');
    }
  }
  return applySet(board, dotpath, value, opts);
}

// ── baselineSnapshot：从 tasks 快照写 board.baseline（新建·已有时调用者须先判断 force）。
export function baselineSnapshot(board: Board, { t0, note }: { t0: string; note?: string }): Board {
  const b = clone(board);
  touch(b);
  const capturedAt = stampNow();

  // 从当前 tasks 提取 estimate + deps 快照
  const taskEstimates: Record<string, { value: number; unit: string }> = {};
  const dagSnapshot: Record<string, { deps: string[] }> = {};
  let bacH = 0;

  for (const t of (Array.isArray(b.tasks) ? b.tasks : []) as Task[]) {
    if (!t || typeof t.id !== 'string' || !t.id) continue;
    const deps = Array.isArray(t.deps) ? t.deps.filter((d: unknown) => typeof d === 'string') : [];
    dagSnapshot[t.id] = { deps };
    if (t.estimate && typeof t.estimate === 'object' && typeof t.estimate.value === 'number') {
      taskEstimates[t.id] = {
        value: t.estimate.value,
        unit: typeof t.estimate.unit === 'string' ? t.estimate.unit : 'h',
      };
      // 累积 BAC（budget at completion）：换算成小时——共用引擎 estimateHours 这一 SSOT
      //   （d=24h/w=168h·日历口径），与 EVM/estimate/MC 路径完全一致。未知/非法单位 → null
      //   则跳过（与 estimate 路径把未知单位当 unit/no-data 一致，不按旧逻辑当小时塞进去）。
      const hours = estimateHours(t.estimate);
      if (hours != null) bacH += hours;
    }
  }

  b.baseline = {
    captured_at: capturedAt,
    t0,
    task_estimates: taskEstimates,
    dag_snapshot: dagSnapshot,
    bac_h: Math.round(bacH * 100) / 100,
    history: [],
    ...(note ? { note } : {}),
  };

  return b;
}

// ── baselineReset：旧 baseline 进 history[]（只增不删）+ 建新快照。
export function baselineReset(board: Board, { t0, note }: { t0: string; note?: string }): Board {
  const b = clone(board);
  touch(b);

  // 保存旧 baseline 到 history
  const oldBaseline = b.baseline;
  const history: unknown[] = [];

  if (oldBaseline && typeof oldBaseline === 'object') {
    const old = oldBaseline as Record<string, unknown>;
    const oldHistory = Array.isArray(old.history) ? old.history : [];
    // 旧 history 条目保留（只增不删）
    history.push(...oldHistory);
    // 旧 baseline 自身进 history
    history.push({
      reset_at: stampNow(),
      ...(note ? { note } : {}),
      bac_h: old.bac_h,
      task_estimates_snapshot: old.task_estimates || {},
    });
  }

  // 建新快照（复用 snapshot 逻辑）
  const capturedAt = stampNow();
  const taskEstimates: Record<string, { value: number; unit: string }> = {};
  const dagSnapshot: Record<string, { deps: string[] }> = {};
  let bacH = 0;

  for (const t of (Array.isArray(b.tasks) ? b.tasks : []) as Task[]) {
    if (!t || typeof t.id !== 'string' || !t.id) continue;
    const deps = Array.isArray(t.deps) ? t.deps.filter((d: unknown) => typeof d === 'string') : [];
    dagSnapshot[t.id] = { deps };
    if (t.estimate && typeof t.estimate === 'object' && typeof t.estimate.value === 'number') {
      taskEstimates[t.id] = {
        value: t.estimate.value,
        unit: typeof t.estimate.unit === 'string' ? t.estimate.unit : 'h',
      };
      // 累积 BAC：共用引擎 estimateHours SSOT（d=24h/w=168h·日历口径），与 snapshot/EVM/estimate 一致。
      //   未知/非法单位 → null 则跳过（同 snapshot 函数·与 estimate 路径把未知单位当 unit/no-data 一致）。
      const hours = estimateHours(t.estimate);
      if (hours != null) bacH += hours;
    }
  }

  b.baseline = {
    captured_at: capturedAt,
    t0,
    task_estimates: taskEstimates,
    dag_snapshot: dagSnapshot,
    bac_h: Math.round(bacH * 100) / 100,
    history,
  };

  return b;
}
