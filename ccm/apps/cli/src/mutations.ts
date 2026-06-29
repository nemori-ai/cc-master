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
  estimateHours,
  isISOUTC,
  isLegalTransition,
  SCHEMA_VERSION,
  STATUS_MACHINE,
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

// ── boardInit({goal}) → 从 template 形态产板。owner.active:true、session_id:""（非 arming·cli-design §7）。
//   不读 template 文件（mutations 零 IO）——把 template 形态硬编码在此（与 board.template.json 对齐：
//   schema / meta.template_version / scheduling.wip_limit / tasks:[] / log:[]）。owner.heartbeat 盖戳。
const TEMPLATE_VERSION = 3;
const DEFAULT_WIP_LIMIT = 4;
export function boardInit(args?: { goal?: string }): Board {
  const goal = args && typeof args.goal === 'string' ? args.goal : '';
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
  return touch(board);
}

// ── boardUpdate(board, {goal?, wipLimit?, ownerWip?, branch?, worktree?}) → 改板级配置。
export function boardUpdate(
  board: Board,
  args?: {
    goal?: string;
    wipLimit?: unknown;
    ownerWip?: unknown;
    branch?: string;
    worktree?: string;
  },
): Board {
  const b = clone(board);
  args = args || {};
  if (args.goal !== undefined) b.goal = args.goal;
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

// ── addTask(board, fields) → 建 task。fields 已由 router 从 registry 映射好（字段名对齐 FIELDS.task）。
//   必填语义：id（router 校验非空）。status 缺省 'ready'、deps 缺省 []、created_at 盖戳。其余 ✎ 字段
//   只在 fields 显式给出时写入（silent-on-unknown：不臆造默认）。
export function addTask(board: Board, fields?: Record<string, any>): Board {
  const b = clone(board);
  if (!Array.isArray(b.tasks)) b.tasks = [];
  fields = fields || {};
  const task: Task = {
    id: fields.id,
    status: fields.status !== undefined ? fields.status : 'ready',
    deps: Array.isArray(fields.deps) ? fields.deps.slice() : [],
  };
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
  const SPECIAL = new Set(['addDep', 'rmDep', 'addRef', 'rmRef', 'id']);
  for (const [k, v] of Object.entries(fields)) {
    if (SPECIAL.has(k)) continue;
    if (v === undefined) continue;
    t[k] = v;
  }
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
  if (!isLegalTransition(from, toStatus) && !force) {
    const outs = STATUS_MACHINE.transitions[from] || [];
    throw err(
      `illegal transition: ${from} → ${toStatus}. legal next from "${from}": ${outs.length ? outs.join(', ') : '(none)'}`,
      'IllegalTransition',
    );
  }
  t.status = toStatus;
  if (toStatus === 'in_flight') t.started_at = stampNow();
  if (toStatus === 'done') t.finished_at = stampNow();
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
//     applySet(board, dotpath, value) —— dotpath 第一段决定作用域：
//       · 'tasks[<id>].<field>...' 或 'tasks.<id>.<field>...' → 定位到该 id 的 task，改其 <field>
//       · 否则 → 作用于 board 顶层 dotpath
//   🔒 拒绝判据：归一化后的「逻辑 path」落在 LOAD_BEARING_PATHS 集合（board 顶层五 + task 四）即拒。

// board 顶层 🔒（FIELDS.board tier==='🔒'）：schema/goal/owner/git/tasks。
const LB_BOARD = new Set(['schema', 'goal', 'owner', 'git', 'tasks']);
// task 🔒（FIELDS.task tier==='🔒'）：id/status/deps/parent。
const LB_TASK = new Set(['id', 'status', 'deps', 'parent']);

interface ParsedPath {
  scope: 'task' | 'board';
  taskId?: string;
  segs: string[];
}

// 把 dotpath 拆成段，支持 tasks[<id>] 与 tasks.<id> 两式定位 task。返回 {scope, taskId?, segs}。
//   scope: 'task' → 作用于某 task；'board' → 作用于 board 顶层。
function parsePath(dotpath: string): ParsedPath {
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
  return { scope: 'board', taskId: undefined, segs };
}

// 🔒 守门：拒绝 load-bearing path。
function assertFlexible(parsed: ParsedPath): void {
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

export function applySet(board: Board, dotpath: string, value: unknown): Board {
  const b = clone(board);
  const parsed = parsePath(dotpath);
  assertFlexible(parsed);
  if (parsed.scope === 'task') {
    const t = requireTask(b, parsed.taskId as string);
    setDeep(t, parsed.segs, value);
  } else {
    setDeep(b, parsed.segs, value);
  }
  return touch(b);
}

// applySetJson(board, dotpath, json) — json 为字符串（待解析）或已解析对象/数组。同 🔒 守门。
export function applySetJson(board: Board, dotpath: string, json: unknown): Board {
  let value = json;
  if (typeof json === 'string') {
    try {
      value = JSON.parse(json);
    } catch (e) {
      throw err(`invalid JSON for --set-json ${dotpath}: ${(e as Error).message}`, 'Validation');
    }
  }
  return applySet(board, dotpath, value);
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
