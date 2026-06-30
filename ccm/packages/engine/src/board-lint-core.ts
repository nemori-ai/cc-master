// board-lint-core.ts — board v2 共享 lint 核心（单一真相源·派生自 board-model）。
//
// 这是 board lint 的纯逻辑：`lintBoard(text) → { errors, warnings }`。被两个薄包装消费——
//   ① PostToolUse hook（hooks/scripts/board-lint.js，同目录 require './board-lint-core.js'）；
//   ② 手动脚本（skills/orchestrating-to-completion/scripts/board-lint.js，经稳定的 plugin 内相对路径 require）。
//   两个消费者复用同一段规则，杜绝两份漂移（DRY）。
//
// ★v2 演进（ADR-013）：本文件不再内联硬编码 enums / 规则级别——**枚举、不变式级别、共享谓词全部从
//   board-model 派生**（import './board-model.js'）。每条规则的「是 hard 还是 warn」由 `levelOf(id)`
//   决定（INVARIANTS 注册表是级别 SSOT）；改级别只动 board-model 一处，lint 自动跟随（零漂移·严谨底线）。
//   本文件保留的是「校验逻辑 + 规范图构建（buildGraph SSOT）+ 丰富报错」——facts 在 model，UX 在这里。
//
// 红线1 / ADR-006：node/JS only。JSON.parse 解析 board + 结构遍历 + deps 图拓扑校验，零 spawn jq/python，
//   零网络，零依赖（纯 stdlib——本文件连 fs 都不用，只吃一段 text + import 同目录 board-model）。
//
// 红线2（最关键）：lint 只校验**钉死的硬窄腰（🔒）+ 合法 JSON + 图完整性 + 观察档/柔性边的形状/枚举**，
//   对一切未建模的 agent 自定义字段 **silent-on-unknown**。真正受红线2 保护的仍只是 🔒 子集；本文件对 ✎/👁
//   字段只校验「形状/枚举/格式」与「条件业务规则（BIZ）」，绝不评判内容「合理性」。
//
// 规则家族（board-model INVARIANTS）：FMT（格式/类型）· GRAPH（图）· BIZ（条件业务规则）。
//   level：hard（确凿坏链路/坏数据）· warn（可疑但 graceful-degrade）· reserved（登记在册·lint 暂不强制）。
//
// T1 port 注：原 CJS 源的 UMD 桥（require './board-model.js' + globalThis fallback）已删除，换成正经 ESM
//   静态 import；UMD 尾导出（module.exports / globalThis.__ccmBoardLintCore）已删除，换成命名导出。
//   逻辑、规则码、报错文案、级别分流逐字保持（零行为变化）。浏览器形态由 tsdown 的 IIFE 产物承接。

import {
  ENUMS,
  isAbsolutePathOrUrl,
  isAwaitingUser,
  isEnumMember,
  isISOUTC,
  levelOf,
  ISO_UTC_RE as MODEL_ISO_UTC_RE,
  SCHEMA_VERSION as MODEL_SCHEMA_VERSION,
  type TaskLike,
} from './board-model.js';

// ── lint 报告条目 / 结果类型 ───────────────────────────────────────────────────────────────────────
export interface LintEntry {
  rule: string;
  message: string;
  task?: string;
}
export interface LintResult {
  errors: LintEntry[];
  warnings: LintEntry[];
}
type Emit = (id: string, message: string, task?: string) => void;

// board 是 agent-shaped 自由对象——lint 只触碰窄腰 + 已建模字段，其余宽松。
type BoardLike = Record<string, unknown>;

// 从 model 取派生事实（v2：model 现为静态 import，必在；保留 enum 集合等本地常量与原源同形）。
const STATUS_ENUM_LOCAL = new Set<string>(ENUMS.status);
const ISO_UTC_RE_LOCAL: RegExp = MODEL_ISO_UTC_RE;
const SCHEMA_VERSION_LOCAL: string = MODEL_SCHEMA_VERSION;

// badTimestamp(v) — 时间锚格式 warn 判定：仅当字段**存在且非空**却不是严格 ISO 时才算坏。
//   空串 "" / null / 缺省 = 「未设置」(模板/骨架的合法占位，如 owner.heartbeat:"")，不 warn(graceful)。
const badTimestamp = (v: unknown): boolean =>
  v !== undefined && v !== null && v !== '' && !isISOUTC(v);

// acceptance 是否「非空」（string 非空 或 obj 有非空 criteria）——BIZ-ACCEPTANCE-REQUIRED 用。
function acceptanceNonEmpty(a: unknown): boolean {
  if (typeof a === 'string') return a.trim() !== '';
  if (a && typeof a === 'object' && !Array.isArray(a)) {
    const criteria = (a as { criteria?: unknown }).criteria;
    return Array.isArray(criteria) && criteria.length > 0;
  }
  return false;
}

// lintBoard(text) — text 是 board 文件的原始字符串。返回 { errors, warnings }，各为 [{ rule, message, task? }]。
//   绝不抛（FMT-JSON 把 JSON.parse 失败收成一条 error）。每条经 emit() 按 levelOf(id) 分流到 errors/warnings；
//   level==='reserved' 的规则 emit 时被静默丢弃（登记在册但暂不强制·如 BIZ-DONE-VERIFIED）。
export function lintBoard(text: string): LintResult {
  const errors: LintEntry[] = [];
  const warnings: LintEntry[] = [];
  // emit：唯一出口——级别从 board-model 注册表读，零漂移。reserved → 丢弃。未注册 id → 默认 hard（surface bug）。
  const emit: Emit = (id, message, task) => {
    const lvl = levelOf(id) || 'hard';
    if (lvl === 'reserved') return;
    const entry: LintEntry = task ? { rule: id, message, task } : { rule: id, message };
    (lvl === 'warn' ? warnings : errors).push(entry);
  };

  // ── FMT-JSON：合法 JSON + 顶层对象 ─────────────────────────────────────────────────────────────────
  let board: unknown;
  try {
    board = JSON.parse(text);
  } catch (e) {
    const why = e && (e as Error).message ? (e as Error).message : String(e);
    emit(
      'FMT-JSON',
      `不合法 JSON — board 无法被解析，会导致 webview 永久冻结（404 后停在旧帧）、resume 选板读出垃圾。\n` +
        `  解析器原话（仅供定位）：${why}\n` +
        `  怎么修：检查逗号与括号配对（尤其 sed/echo 截断了含 } 或 " 的字段值）；经 CLI 写盘（写入校验挡住大多数手写坏 JSON）。`,
    );
    return { errors, warnings };
  }
  if (!board || typeof board !== 'object' || Array.isArray(board)) {
    emit(
      'FMT-JSON',
      `board 顶层不是一个 JSON 对象（解析出 ${Array.isArray(board) ? '数组' : typeof board}）。怎么修：board 必须是 {…} 对象。`,
    );
    return { errors, warnings };
  }
  const b = board as BoardLike;

  // ── 板级钉死窄腰 FMT（🔒：schema / goal / owner / git / tasks）────────────────────────────────────
  // FMT-SCHEMA
  if (typeof b.schema !== 'string' || b.schema !== SCHEMA_VERSION_LOCAL) {
    emit(
      'FMT-SCHEMA',
      `schema 必须是字符串字面量 "${SCHEMA_VERSION_LOCAL}"（当前：${JSON.stringify(b.schema)}）。` +
        `坏什么：它是窄腰版本协议锚点，content 契约断言它；缺/改 = 窄腰破、schema 路由会错认板。`,
    );
  }
  // FMT-GOAL
  if (typeof b.goal !== 'string') {
    emit(
      'FMT-GOAL',
      `goal 必须是字符串（当前：${JSON.stringify(b.goal)}）。` +
        `坏什么：resume selector 按 goal 子串匹配认板、viewer 顶栏渲染它；缺 = resume 认领退化、顶栏空。`,
    );
  }
  // FMT-OWNER（owner 对象 + active:bool + session_id:string；heartbeat 非 ISO → FMT-TIME warn）
  const owner = b.owner;
  if (!owner || typeof owner !== 'object' || Array.isArray(owner)) {
    emit(
      'FMT-OWNER',
      `owner 必须是对象（当前：${JSON.stringify(owner)}）。坏什么：武装闸读 owner.active/session_id；缺 = 本 session 武装判定崩。`,
    );
  } else {
    const ow = owner as Record<string, unknown>;
    if (typeof ow.active !== 'boolean') {
      emit(
        'FMT-OWNER',
        `owner.active 必须是 boolean（当前：${JSON.stringify(ow.active)}）。` +
          `坏什么：武装闸（全 hook 的 isArmed）读它；非 bool = orchestrator 不再被 reinject / Stop 不再 gate / pacing 失声。`,
      );
    }
    if (typeof ow.session_id !== 'string') {
      emit(
        'FMT-OWNER',
        `owner.session_id 必须是字符串（空串 "" 合法、表示待显式 re-arm 认领；当前：${JSON.stringify(ow.session_id)}）。` +
          `坏什么：武装闸 session-scope 匹配读它（ADR-007）。`,
      );
    }
    // ★v2 补漏（v1 lint 不查 heartbeat）：heartbeat 是 🔒 owner 一员（resume 探测读），存在则须 ISO（warn·graceful）。
    if (badTimestamp(ow.heartbeat)) {
      emit(
        'FMT-TIME',
        `owner.heartbeat 是 ${JSON.stringify(ow.heartbeat)}，非严格 ISO-8601 UTC（YYYY-MM-DDTHH:MM:SSZ）。` +
          `影响：resume 探测活 session 新鲜度读它——格式不对则换班判定退化（不致命，建议补全 UTC 时间戳）。`,
      );
    }
  }
  // FMT-GIT
  const git = b.git;
  if (!git || typeof git !== 'object' || Array.isArray(git)) {
    emit(
      'FMT-GIT',
      `git 必须是对象（含 worktree/branch 字符串，可空；当前：${JSON.stringify(git)}）。坏什么：窄腰一员（ADR-003），viewer 渲染 git.branch。`,
    );
  } else {
    const gi = git as Record<string, unknown>;
    if (gi.worktree !== undefined && typeof gi.worktree !== 'string') {
      emit('FMT-GIT', `git.worktree 若存在必须是字符串（当前：${JSON.stringify(gi.worktree)}）。`);
    }
    if (gi.branch !== undefined && typeof gi.branch !== 'string') {
      emit('FMT-GIT', `git.branch 若存在必须是字符串（当前：${JSON.stringify(gi.branch)}）。`);
    }
  }

  // ── 板级观察档/柔性模块 FMT（不依赖 tasks，先校验——即便 tasks 坏也能报）──────────────────────────
  lintScheduling(b, emit);
  lintWatchdog(b, emit);
  lintMeta(b, emit);
  lintLog(b, emit);
  lintJudgmentCalls(b, emit);
  lintCadenceFormat(b, emit);
  lintBaseline(b, emit);
  lintPolicy(b, emit);
  lintCoordination(b, emit);
  lintRuntime(b, emit);

  // FMT-TASKS（数组）——非数组无从遍历，板级检查已做，提前返回。
  const tasks = b.tasks;
  if (!Array.isArray(tasks)) {
    emit(
      'FMT-TASKS',
      `tasks 必须是数组（当前：${Array.isArray(tasks) ? 'array' : typeof tasks}）。` +
        `坏什么：goal-hook 数状态、viewer 整个 DAG、resume 重建模型全靠它；非数组 = viewer 空图（静默）、hook 扫描错位。`,
    );
    return { errors, warnings };
  }

  // ── 每个 task 的钉死契约 FMT（🔒：id / status / deps）+ id 唯一 ─────────────────────────────────────
  const ids = new Set<string>();
  const dupIds = new Set<string>();
  const taskById = new Map<string, TaskLike>();
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i] as TaskLike;
    const where = `tasks[${i}]`;
    if (!t || typeof t !== 'object' || Array.isArray(t)) {
      emit(
        'FMT-ID',
        `${where} 必须是对象（当前：${JSON.stringify(t)}）。坏什么：viewer 按 t.id 建节点、goal-hook 按 status 路由。`,
      );
      continue;
    }
    const idLabel = typeof t.id === 'string' && t.id ? t.id : where;
    if (typeof t.id !== 'string' || t.id === '') {
      emit(
        'FMT-ID',
        `${where}.id 必须是非空字符串（当前：${JSON.stringify(t.id)}）。` +
          `坏什么：viewer 用 id 建节点 key、goal-hook 按 id 计数；缺 id = 节点 key 撞/丢、hook 漏数。`,
        idLabel,
      );
    } else {
      if (ids.has(t.id)) {
        dupIds.add(t.id);
      }
      ids.add(t.id);
      taskById.set(t.id, t);
    }
    if (typeof t.status !== 'string' || !STATUS_ENUM_LOCAL.has(t.status)) {
      emit(
        'FMT-STATUS',
        `${idLabel}.status 是 ${JSON.stringify(t.status)}，不在合法集合内。` +
          `坏什么：goal-hook 无法路由它（可能在还有活时放行 Stop），webview 把它画成 unknown 灯。\n` +
          `  怎么修：改成合法值之一：${[...STATUS_ENUM_LOCAL].join(' / ')}。`,
        idLabel,
      );
    }
    if (t.deps === undefined) {
      emit(
        'FMT-DEPS',
        `${idLabel}.deps 缺失。deps 是钉死的窄腰字段（与 id/status 同级），不是可省略的柔性边。` +
          `坏什么：缺 deps = 畸形窄腰；下游图校验把它当无上游，让「手编 tasks[] 忘写 deps」这个真实错误静默溜过。\n` +
          `  怎么修：补上 deps——无上游写 "deps": []，有上游写 "deps": ["<上游 task id>", …]。`,
        idLabel,
      );
    } else if (!Array.isArray(t.deps)) {
      emit(
        'FMT-DEPS',
        `${idLabel}.deps 必须是字符串数组（当前：${typeof t.deps}）。` +
          `坏什么：viewer 兜底丢掉该任务的全部依赖边（静默错图）。\n` +
          `  怎么修：无上游写 "deps": []，有上游写 "deps": ["<上游 task id>", …]。`,
        idLabel,
      );
    } else {
      for (const d of t.deps) {
        if (typeof d !== 'string') {
          emit(
            'FMT-DEPS',
            `${idLabel}.deps 含非字符串元素（${JSON.stringify(d)}）；dep 必须是上游 task 的 id 字符串。`,
            idLabel,
          );
        }
      }
    }
  }
  for (const dup of dupIds) {
    emit(
      'FMT-ID-UNIQUE',
      `task id "${dup}" 出现多次，必须全局唯一。` +
        `坏什么：viewer 后写者覆盖前者（静默丢节点）；deps 指向它时歧义。`,
      dup,
    );
  }

  // ── 图完整性（buildGraph SSOT；deps 悬挂/自环/环 + parent nesting）──────────────────────────────────
  const validIds = ids;
  const g = buildGraph(tasks);
  for (const issue of g.edgeIssues) {
    if (issue.kind === 'dangling') {
      emit(
        'GRAPH-DANGLING',
        `${issue.id}.deps 含 "${issue.dep}"，但没有任何 task 的 id 是 "${issue.dep}"。` +
          `坏什么：webview 静默丢这条依赖边，且 ${issue.id} 永远不会因上游完成而解锁。\n` +
          `  怎么修：把 "${issue.dep}" 改成真实存在的上游 id，或从 ${issue.id}.deps 删掉它。现有 id：${[...validIds].join(', ')}。`,
        issue.id,
      );
    } else {
      emit(
        'GRAPH-SELFLOOP',
        `${issue.id}.deps 含它自己（自环）。坏什么：${issue.id} 依赖自己 → 永远 blocked、永不 ready。怎么修：从 ${issue.id}.deps 删掉 "${issue.id}"。`,
        issue.id,
      );
    }
  }
  const cycle = findCycle(g.upstream);
  if (cycle) {
    emit(
      'GRAPH-CYCLE',
      `deps 图存在环：${cycle.join(' → ')} → ${cycle[0]}。` +
        `坏什么：环上的任务互相等待 → 永远 ready 不了 → 编排死锁；viewer 拓扑/临界路径算法在环上行为未定义。\n` +
        `  怎么修：打破环——删掉环上某条 deps 边，让依赖关系回到无环的 DAG。`,
    );
  }

  // ── parent nesting（FMT-PARENT 类型 + GRAPH-PARENT-* 引用/depth/环 + GRAPH-ROLLUP 一致性）────────────
  const { parentOf, children } = g;
  // FMT-PARENT：parent 键存在但值非「非空 string」→ hard（否则 buildGraph 静默丢弃、套娃/rollup 保护失效）。
  for (const tt of tasks) {
    const t = tt as TaskLike;
    if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
    if (typeof t.id !== 'string' || t.id === '' || taskById.get(t.id) !== t) continue;
    if (!Object.hasOwn(t, 'parent')) continue;
    if (typeof t.parent !== 'string' || t.parent === '') {
      emit(
        'FMT-PARENT',
        `${t.id}.parent 必须是非空字符串（指向一个存在的 owner id；当前：${JSON.stringify(t.parent)}）。` +
          `parent 是钉死的窄腰容器边（ADR-012），非字符串会被图构建静默丢弃，悄悄关掉套娃 depth=1 与 rollup 保护。\n` +
          `  怎么修：把 parent 改成单个 owner task 的 id 字符串（如 "M1"），或删掉 parent 键让它成顶层节点。`,
        t.id,
      );
    }
  }
  for (const [child, ownerId] of parentOf) {
    if (!validIds.has(ownerId)) {
      emit(
        'GRAPH-PARENT-EXISTS',
        `${child}.parent 是 "${ownerId}"，但没有任何 task 的 id 是 "${ownerId}"。` +
          `坏什么：悬挂 parent = rollup gate 找不到 owner、webview 分组渲染丢边。\n` +
          `  怎么修：把 "${ownerId}" 改成真实存在的 owner id，或从 ${child} 删掉 parent。现有 id：${[...validIds].join(', ')}。`,
        child,
      );
    }
  }
  for (const [owner2, kids] of children) {
    for (const c of kids) {
      if (children.has(c)) {
        emit(
          'GRAPH-PARENT-DEPTH',
          `${c} 既是 ${owner2} 的子（有 parent="${owner2}"），自己又是某些节点的 parent——违反 depth=1（owner 只能含 leaf 子）。` +
            `坏什么：破 depth=1 type 不变式，rollup 与 webview 分组的「一层」假设崩。\n` +
            `  怎么修：把 ${c} 的孙子节点（${(children.get(c) as string[]).join(', ')}）改挂到顶层 owner，或把 ${c} 升为顶层 owner（删它的 parent）。`,
          c,
        );
      }
    }
  }
  const padj = new Map<string, string[]>();
  for (const id of validIds) padj.set(id, []);
  for (const [child, ownerId] of parentOf) {
    if (validIds.has(child) && validIds.has(ownerId)) (padj.get(child) as string[]).push(ownerId);
  }
  const pCycle = findCycle(padj);
  if (pCycle) {
    emit(
      'GRAPH-PARENT-CYCLE',
      `parent 链存在环：${pCycle.join(' → ')} → ${pCycle[0]}（含自指或 2-环）。` +
        `坏什么：parent 成环 = 容器归属无穷回指，rollup 永远算不出顶层 owner、depth=1 也被违反。\n` +
        `  怎么修：打破环——让 parent 链回到「子单跳指向一个无 parent 的顶层 owner」。`,
    );
  }
  for (const [owner2, kids] of children) {
    const ownerTask = taskById.get(owner2);
    if (!ownerTask || ownerTask.status !== 'done') continue;
    const bad = kids.filter((c) => {
      const ct = taskById.get(c);
      return !ct || ct.status !== 'done';
    });
    if (bad.length) {
      emit(
        'GRAPH-ROLLUP',
        `${owner2} 标 done，但它的子 ${bad.join(', ')} 还非 done——rollup 不一致（父不应在子未全 done 时算真 done）。` +
          `影响：不致命（可能是父整合中、子刚标完的瞬态），但若非瞬态 = 父被错标 done 而子在飞，子图静默漏掉。\n` +
          `  建议：确认子全 done + 父端点验收过再标父 done（Finding #12）。`,
        owner2,
      );
    }
  }

  // ── 每个 task 的 v2 字段 FMT（executor/role/type/references/estimate/acceptance/blocked_on/wip_limit/时间）──
  for (const [id, t] of taskById) {
    lintTaskFields(id, t, validIds, emit);
  }

  // ── BIZ 条件业务规则（per-task）+ awaiting-user 完整性 ───────────────────────────────────────────────
  for (const [id, t] of taskById) {
    lintTaskBiz(id, t, emit);
  }

  // ── BIZ-CADENCE-SHIPPED（iteration 收口完整性：shipped ⇒ members 全 done+verified·hard）───────────────
  lintCadenceShipped(b, taskById, emit);

  return { errors, warnings };
}

// ── 板级模块 lint 辅助 ──────────────────────────────────────────────────────────────────────────────

// FMT-SCHEDULING：scheduling.wip_limit / owner_wip_limit 是数字（聚合自 v1 平铺顶层；v2 补 owner_wip_limit）。
//   兼容：v1 平铺的 top-level board.wip_limit 也兜底校验（旧板降级路径）。
function lintScheduling(board: BoardLike, emit: Emit): void {
  const sc = board.scheduling;
  if (sc !== undefined) {
    if (!sc || typeof sc !== 'object' || Array.isArray(sc)) {
      emit(
        'FMT-SCHEDULING',
        `scheduling 若存在必须是对象（含 wip_limit / owner_wip_limit 数字；当前：${JSON.stringify(sc)}）。`,
      );
    } else {
      const s = sc as Record<string, unknown>;
      for (const k of ['wip_limit', 'owner_wip_limit']) {
        if (s[k] !== undefined && typeof s[k] !== 'number') {
          emit(
            'FMT-SCHEDULING',
            `scheduling.${k} 是 ${JSON.stringify(s[k])}，非数字。影响：posttool-batch 的两级 WIP 软警告会静默关闭（graceful）；建议用数字或省略。`,
          );
        }
      }
    }
  }
  // v1 兼容：平铺 top-level wip_limit（旧板）。
  if (board.wip_limit !== undefined && typeof board.wip_limit !== 'number') {
    emit(
      'FMT-SCHEDULING',
      `wip_limit（顶层·旧板形态）是 ${JSON.stringify(board.wip_limit)}，非数字。影响：WIP 软警告静默关闭（graceful）；建议迁入 scheduling.wip_limit。`,
    );
  }
}

// FMT-WATCHDOG：watchdog.mechanism ∈ enum + fire_at/armed_at ISO（观察档·graceful；v2 补 fire_at 格式·v1 漏）。
function lintWatchdog(board: BoardLike, emit: Emit): void {
  const w = board.watchdog;
  if (w === undefined || w === null) return; // 缺/null 合法（无 watchdog）
  if (typeof w !== 'object' || Array.isArray(w)) {
    emit('FMT-WATCHDOG', `watchdog 若存在必须是对象或 null（当前：${JSON.stringify(w)}）。`);
    return;
  }
  const wd = w as Record<string, unknown>;
  if (wd.mechanism !== undefined && !isEnumMember('watchdogMechanism', wd.mechanism)) {
    emit(
      'FMT-WATCHDOG',
      `watchdog.mechanism 是 ${JSON.stringify(wd.mechanism)}，应 ∈ {cron, loop, monitor, shell}。影响：verify-board 到点/缺失提醒按机制分支——错值则提醒退化。`,
    );
  }
  for (const k of ['armed_at', 'fire_at']) {
    if (badTimestamp(wd[k])) {
      emit(
        'FMT-WATCHDOG',
        `watchdog.${k} 是 ${JSON.stringify(wd[k])}，非严格 ISO-8601 UTC。影响：verify-board 到点判定/过期 self-heal 读它——格式不对则自我唤醒提醒失准。`,
      );
    }
  }
}

// FMT-META：meta.template_version 整数。
function lintMeta(board: BoardLike, emit: Emit): void {
  const m = board.meta;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return;
  const mt = m as Record<string, unknown>;
  if (mt.template_version !== undefined && !Number.isInteger(mt.template_version)) {
    emit(
      'FMT-META',
      `meta.template_version 是 ${JSON.stringify(mt.template_version)}，非整数。影响：timeline 版本门读它（非整数 → 当旧板走拓扑轴，降级不挂）；建议用整数或省略。`,
    );
  }
  if (badTimestamp(mt.created_at)) {
    emit(
      'FMT-META',
      `meta.created_at 是 ${JSON.stringify(mt.created_at)}，非严格 ISO-8601 UTC。影响：viewer 建板时刻渲染退化（不致命）。`,
    );
  }
}

// FMT-LOG：log[] 是数组；每条 ts/summary 字符串（ts 宜 ISO）+ kind ∈ logKind（append-only·柔性·warn）。
function lintLog(board: BoardLike, emit: Emit): void {
  const log = board.log;
  if (log === undefined) return;
  if (!Array.isArray(log)) {
    emit('FMT-LOG', `log 若存在必须是数组（append-only 审计轨迹；当前：${JSON.stringify(log)}）。`);
    return;
  }
  for (let i = 0; i < log.length; i++) {
    const e = log[i] as Record<string, unknown>;
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      emit('FMT-LOG', `log[${i}] 应为对象 {ts, summary, …}（当前：${JSON.stringify(e)}）。`);
      continue;
    }
    if (typeof e.ts !== 'string')
      emit('FMT-LOG', `log[${i}].ts 应为字符串时间戳（当前：${JSON.stringify(e.ts)}）。`);
    else if (!isISOUTC(e.ts))
      emit(
        'FMT-LOG',
        `log[${i}].ts 是 ${JSON.stringify(e.ts)}，非严格 ISO-8601 UTC（影响 timeline 排序，不致命）。`,
      );
    if (typeof e.summary !== 'string' || e.summary === '')
      emit('FMT-LOG', `log[${i}].summary 应为非空字符串（当前：${JSON.stringify(e.summary)}）。`);
    if (e.kind !== undefined && !isEnumMember('logKind', e.kind)) {
      emit(
        'FMT-LOG',
        `log[${i}].kind 是 ${JSON.stringify(e.kind)}，应 ∈ {dispatch, recon, verify, finding, decision, replan, handoff, note}。`,
      );
    }
  }
}

// FMT-JUDGMENT-CALLS：judgment_calls[] 是数组；每条 summary 字符串 + category/severity/status ∈ 各枚举（观察档·warn）。
function lintJudgmentCalls(board: BoardLike, emit: Emit): void {
  const jc = board.judgment_calls;
  if (jc === undefined) return;
  if (!Array.isArray(jc)) {
    emit(
      'FMT-JUDGMENT-CALLS',
      `judgment_calls 若存在必须是数组（自决诚实台账；当前：${JSON.stringify(jc)}）。`,
    );
    return;
  }
  for (let i = 0; i < jc.length; i++) {
    const e = jc[i] as Record<string, unknown>;
    const lbl = e && typeof e.id === 'string' && e.id ? e.id : `judgment_calls[${i}]`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      emit('FMT-JUDGMENT-CALLS', `${lbl} 应为对象（当前：${JSON.stringify(e)}）。`);
      continue;
    }
    if (typeof e.summary !== 'string' || e.summary === '')
      emit('FMT-JUDGMENT-CALLS', `${lbl}.summary 应为非空字符串。`);
    if (e.category !== undefined && !isEnumMember('jcCategory', e.category)) {
      emit(
        'FMT-JUDGMENT-CALLS',
        `${lbl}.category 是 ${JSON.stringify(e.category)}，应 ∈ {architecture, drift, spec-impl-misalignment, other}。`,
      );
    }
    if (e.severity !== undefined && !isEnumMember('jcSeverity', e.severity)) {
      emit(
        'FMT-JUDGMENT-CALLS',
        `${lbl}.severity 是 ${JSON.stringify(e.severity)}，应 ∈ {low, medium, high, critical}（回前台 hook 按它告知）。`,
      );
    }
    if (e.status !== undefined && !isEnumMember('jcStatus', e.status)) {
      emit(
        'FMT-JUDGMENT-CALLS',
        `${lbl}.status 是 ${JSON.stringify(e.status)}，应 ∈ {pending_review, upheld, overturned}。`,
      );
    }
    for (const k of ['raised_at', 'resolved_at']) {
      if (badTimestamp(e[k])) {
        emit('FMT-JUDGMENT-CALLS', `${lbl}.${k} 是 ${JSON.stringify(e[k])}，非严格 ISO-8601 UTC。`);
      }
    }
  }
}

// FMT-CADENCE：cadence 对象；iterations[] 每条 id 字符串 + status ∈ iterationStatus + 时间 ISO + members 字符串数组。
function lintCadenceFormat(board: BoardLike, emit: Emit): void {
  const c = board.cadence;
  if (c === undefined) return;
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    emit(
      'FMT-CADENCE',
      `cadence 若存在必须是对象 {target?, iterations?}（当前：${JSON.stringify(c)}）。`,
    );
    return;
  }
  const cd = c as Record<string, unknown>;
  if (cd.iterations !== undefined) {
    if (!Array.isArray(cd.iterations)) {
      emit(
        'FMT-CADENCE',
        `cadence.iterations 若存在必须是数组（当前：${JSON.stringify(cd.iterations)}）。`,
      );
    } else {
      for (let i = 0; i < cd.iterations.length; i++) {
        const it = cd.iterations[i] as Record<string, unknown>;
        const lbl = it && typeof it.id === 'string' && it.id ? it.id : `cadence.iterations[${i}]`;
        if (!it || typeof it !== 'object' || Array.isArray(it)) {
          emit(
            'FMT-CADENCE',
            `${lbl} 应为对象 {id, started_at, deadline?, goal?, members?, status}（当前：${JSON.stringify(it)}）。`,
          );
          continue;
        }
        if (typeof it.id !== 'string' || it.id === '')
          emit('FMT-CADENCE', `${lbl}.id 应为非空字符串。`);
        if (it.status !== undefined && !isEnumMember('iterationStatus', it.status)) {
          emit(
            'FMT-CADENCE',
            `${lbl}.status 是 ${JSON.stringify(it.status)}，应 ∈ {open, shipped}。`,
          );
        }
        for (const k of ['started_at', 'deadline']) {
          if (badTimestamp(it[k])) {
            emit('FMT-CADENCE', `${lbl}.${k} 是 ${JSON.stringify(it[k])}，非严格 ISO-8601 UTC。`);
          }
        }
        if (it.members !== undefined) {
          if (!Array.isArray(it.members) || it.members.some((m) => typeof m !== 'string')) {
            emit(
              'FMT-CADENCE',
              `${lbl}.members 应为 task-id 字符串数组（当前：${JSON.stringify(it.members)}）。`,
            );
          }
        }
      }
    }
  }
}

// FMT-BASELINE：baseline 对象形状（present 才校验）
function lintBaseline(board: BoardLike, emit: Emit): void {
  const bl = board.baseline;
  if (bl === undefined || bl === null) return;
  if (typeof bl !== 'object' || Array.isArray(bl)) {
    emit('FMT-BASELINE', `baseline 若存在必须是对象（当前：${JSON.stringify(bl)}）。`);
    return;
  }
  const b = bl as Record<string, unknown>;
  for (const k of ['captured_at', 't0']) {
    if (badTimestamp(b[k])) {
      emit(
        'FMT-BASELINE',
        `baseline.${k} 是 ${JSON.stringify(b[k])}，非严格 ISO-8601 UTC（YYYY-MM-DDTHH:MM:SSZ）。影响：estimate evm 读它——格式不对则 EVM 时间轴错位。`,
      );
    }
  }
  for (const k of ['task_estimates', 'dag_snapshot']) {
    if (b[k] !== undefined && (typeof b[k] !== 'object' || Array.isArray(b[k]) || b[k] === null)) {
      emit('FMT-BASELINE', `baseline.${k} 若存在必须是对象（当前：${JSON.stringify(b[k])}）。`);
    }
  }
  if (b.bac_h !== undefined && typeof b.bac_h !== 'number') {
    emit('FMT-BASELINE', `baseline.bac_h 若存在必须是数字（当前：${JSON.stringify(b.bac_h)}）。`);
  }
  if (b.history !== undefined) {
    if (!Array.isArray(b.history)) {
      emit(
        'FMT-BASELINE',
        `baseline.history 若存在必须是数组（当前：${JSON.stringify(b.history)}）。`,
      );
    } else {
      for (let i = 0; i < b.history.length; i++) {
        const h = b.history[i] as Record<string, unknown>;
        if (!h || typeof h !== 'object' || Array.isArray(h)) {
          emit(
            'FMT-BASELINE',
            `baseline.history[${i}] 应为对象 {reset_at, note?, bac_h, task_estimates_snapshot}（当前：${JSON.stringify(h)}）。`,
          );
          continue;
        }
        if (badTimestamp(h.reset_at)) {
          emit(
            'FMT-BASELINE',
            `baseline.history[${i}].reset_at 是 ${JSON.stringify(h.reset_at)}，非严格 ISO-8601 UTC。`,
          );
        }
        if (h.bac_h !== undefined && typeof h.bac_h !== 'number') {
          emit(
            'FMT-BASELINE',
            `baseline.history[${i}].bac_h 若存在必须是数字（当前：${JSON.stringify(h.bac_h)}）。`,
          );
        }
      }
    }
  }
}

// FMT-POLICY：policy 对象形状（present 才校验）
function lintPolicy(board: BoardLike, emit: Emit): void {
  const pl = board.policy;
  if (pl === undefined || pl === null) return;
  if (typeof pl !== 'object' || Array.isArray(pl)) {
    emit(
      'FMT-POLICY',
      `policy 若存在必须是对象（当前：${JSON.stringify(pl)}）。影响：switch-account.sh 机制硬闸读 policy.autonomous_account_switch——非对象则读不出、硬闸解析退化为 allow。`,
    );
    return;
  }
  const p = pl as Record<string, unknown>;
  if (
    p.autonomous_account_switch !== undefined &&
    !isEnumMember('accountSwitchPolicy', p.autonomous_account_switch)
  ) {
    emit(
      'FMT-POLICY',
      `policy.autonomous_account_switch 是 ${JSON.stringify(p.autonomous_account_switch)}，应 ∈ {allow, deny}。影响：硬闸只认这两个值——未知值则开关判定失效。`,
    );
  }
}

// FMT-COORD：coordination 块形状（COORD·present 才校验·全 warn·graceful）。
//   coordination 是 ✎ agent-shaped 协调 hint（hook 不读·非窄腰）——形状坏不阻断写盘，只让 ccm peers
//   跨板读时把该 peer 的对应维度降级（退单板·fail-safe）。校验：① 整块是对象；② priority ∈ coordPriority
//   五挡；③ state / state.current / state.planned 若存在须是对象；④ 数字字段（active_tasks / burn_contribution
//   / cost_to_complete_pct）若存在须是数字、人类可读字段（workload / remaining_work）若存在须是字符串。
function lintCoordination(board: BoardLike, emit: Emit): void {
  const co = board.coordination;
  if (co === undefined || co === null) return;
  if (typeof co !== 'object' || Array.isArray(co)) {
    emit(
      'FMT-COORD',
      `coordination 若存在必须是对象（当前：${JSON.stringify(co)}）。影响：ccm peers 跨板读它出花名册——非对象则该 peer 整块降级、不计入感知（退单板 pacing·fail-safe）。`,
    );
    return;
  }
  const c = co as Record<string, unknown>;
  if (c.priority !== undefined && !isEnumMember('coordPriority', c.priority)) {
    emit(
      'FMT-COORD',
      `coordination.priority 是 ${JSON.stringify(c.priority)}，应 ∈ {urgent, high, normal, low, trivial}。影响：板级优先级是裁决主轴 + 机械 fair-share 权重源——未知值则该板优先级退化为默认 normal。`,
    );
  }
  if (c.state !== undefined) {
    if (typeof c.state !== 'object' || Array.isArray(c.state) || c.state === null) {
      emit(
        'FMT-COORD',
        `coordination.state 若存在必须是对象 {current?, planned?}（当前：${JSON.stringify(c.state)}）。`,
      );
      return;
    }
    const st = c.state as Record<string, unknown>;
    // current：{active_tasks?:int·数字, workload?:string, burn_contribution?:number}
    if (st.current !== undefined) {
      if (typeof st.current !== 'object' || Array.isArray(st.current) || st.current === null) {
        emit(
          'FMT-COORD',
          `coordination.state.current 若存在必须是对象（当前：${JSON.stringify(st.current)}）。`,
        );
      } else {
        const cur = st.current as Record<string, unknown>;
        for (const k of ['active_tasks', 'burn_contribution']) {
          if (cur[k] !== undefined && typeof cur[k] !== 'number') {
            emit(
              'FMT-COORD',
              `coordination.state.current.${k} 若存在必须是数字（当前：${JSON.stringify(cur[k])}）。影响：数字喂机械 fair-share floor / headroom 估计——非数字则该维度降级忽略。`,
            );
          }
        }
        if (cur.workload !== undefined && typeof cur.workload !== 'string') {
          emit(
            'FMT-COORD',
            `coordination.state.current.workload 若存在必须是字符串（人类可读·喂 peer 价值推理；当前：${JSON.stringify(cur.workload)}）。`,
          );
        }
      }
    }
    // planned：{remaining_work?:string, cost_to_complete_pct?:number}
    if (st.planned !== undefined) {
      if (typeof st.planned !== 'object' || Array.isArray(st.planned) || st.planned === null) {
        emit(
          'FMT-COORD',
          `coordination.state.planned 若存在必须是对象（当前：${JSON.stringify(st.planned)}）。`,
        );
      } else {
        const pl = st.planned as Record<string, unknown>;
        if (pl.cost_to_complete_pct !== undefined && typeof pl.cost_to_complete_pct !== 'number') {
          emit(
            'FMT-COORD',
            `coordination.state.planned.cost_to_complete_pct 若存在必须是数字（当前：${JSON.stringify(pl.cost_to_complete_pct)}）。影响：偿付力信号喂价值/紧迫推理——非数字则降级忽略。`,
          );
        }
        if (pl.remaining_work !== undefined && typeof pl.remaining_work !== 'string') {
          emit(
            'FMT-COORD',
            `coordination.state.planned.remaining_work 若存在必须是字符串（人类可读·喂 peer 价值推理；当前：${JSON.stringify(pl.remaining_work)}）。`,
          );
        }
      }
    }
  }
}

// FMT-RUNTIME：runtime 参数区形状（hook-owned ✎·present 才校验·全 warn·graceful·ADR-020）。
//   runtime 装「周期 hook/script 运行时维护的瞬态簿记」（IDNUDGE 的 last_identity_remind 等）。形状坏不阻断
//   写盘——只让消费方（IDNUDGE 读 last_identity_remind / critpath-nudge 读 last_critpath_remind 判阈值）按
//   缺失降级（首次必提示·fail-safe）。校验：① 整块是对象；② 已知时间锚键（last_identity_remind /
//   last_critpath_remind）若存在须严格 ISO-8601 UTC。其余键 silent-on-unknown
//   （未来同形成员复用本规则·扩展位无须改 lint）。
function lintRuntime(board: BoardLike, emit: Emit): void {
  const rt = board.runtime;
  if (rt === undefined || rt === null) return;
  if (typeof rt !== 'object' || Array.isArray(rt)) {
    emit(
      'FMT-RUNTIME',
      `runtime 若存在必须是对象（当前：${JSON.stringify(rt)}）。影响：IDNUDGE 等周期 hook 读 runtime.<key> 判阈值——非对象则读不出、退化为「从未提示」(首次必提示·fail-safe)。`,
    );
    return;
  }
  const r = rt as Record<string, unknown>;
  if (badTimestamp(r.last_identity_remind)) {
    emit(
      'FMT-RUNTIME',
      `runtime.last_identity_remind 是 ${JSON.stringify(r.last_identity_remind)}，非严格 ISO-8601 UTC（YYYY-MM-DDTHH:MM:SSZ）。影响：IDNUDGE 读它判周期阈值——格式不对则退化为「从未提示」(首次必提示)。`,
    );
  }
  if (badTimestamp(r.last_critpath_remind)) {
    emit(
      'FMT-RUNTIME',
      `runtime.last_critpath_remind 是 ${JSON.stringify(r.last_critpath_remind)}，非严格 ISO-8601 UTC（YYYY-MM-DDTHH:MM:SSZ）。影响：critpath-nudge 读它判周期阈值——格式不对则退化为「从未提示」(首次必提示)。`,
    );
  }
}

// ── 每个 task 的 v2 字段 FMT ────────────────────────────────────────────────────────────────────────
function lintTaskFields(id: string, t: TaskLike, validIds: Set<string>, emit: Emit): void {
  // FMT-EXECUTOR（hard·枚举5）
  if (t.executor !== undefined && !isEnumMember('executor', t.executor)) {
    emit(
      'FMT-EXECUTOR',
      `${id}.executor 是 ${JSON.stringify(t.executor)}，应 ∈ {user, master-orchestrator, subagent, workflow, external}。` +
        `坏什么：执行者类型路由派发/viewer 渲染；非法值 = 调度与展示错配。`,
      id,
    );
  }
  // FMT-ROLE（hard·枚举）
  if (t.role !== undefined && !isEnumMember('role', t.role)) {
    emit('FMT-ROLE', `${id}.role 是 ${JSON.stringify(t.role)}，应 ∈ {normal, fill-work}。`, id);
  }
  // FMT-TYPE（warn·开放枚举，未知值不 fail）
  if (t.type !== undefined && !isEnumMember('taskType', t.type)) {
    emit(
      'FMT-TYPE',
      `${id}.type 是 ${JSON.stringify(t.type)}，不在已知集合 {design, planning, development, development-demo, acceptance, e2e-integration, doc-alignment, pr} 内。` +
        `影响：type 是开放枚举（未来可扩展），未知值不致命；但若是 typo 会让基于 type 的 BIZ 规则（如 spec/plan refs 必填）漏触发。`,
      id,
    );
  }
  // FMT-REF / FMT-REF-KIND（references 数组；ref 绝对路径或 URL·hard；kind ∈ refKind·warn）
  if (t.references !== undefined) {
    if (!Array.isArray(t.references)) {
      emit(
        'FMT-REF',
        `${id}.references 若存在必须是数组 [{kind, ref, note?}]（当前：${JSON.stringify(t.references)}）。`,
        id,
      );
    } else {
      for (let i = 0; i < t.references.length; i++) {
        const r = t.references[i] as Record<string, unknown>;
        if (!r || typeof r !== 'object' || Array.isArray(r)) {
          emit(
            'FMT-REF',
            `${id}.references[${i}] 应为对象 {kind, ref, note?}（当前：${JSON.stringify(r)}）。`,
            id,
          );
          continue;
        }
        if (!isAbsolutePathOrUrl(r.ref)) {
          emit(
            'FMT-REF',
            `${id}.references[${i}].ref 是 ${JSON.stringify(r.ref)}，必须是绝对路径（/…）或 URL（http(s)://…）——禁相对路径。` +
              `坏什么：相对路径装到别的机器/cwd 解析就死链（Finding #38 家族）；ref 是给别的 session/人/viewer 跳转用的，必须自洽。`,
            id,
          );
        }
        if (r.kind !== undefined && !isEnumMember('refKind', r.kind)) {
          emit(
            'FMT-REF-KIND',
            `${id}.references[${i}].kind 是 ${JSON.stringify(r.kind)}，应 ∈ {spec, plan, doc, web, code, issue, other}（开放枚举，未知值不致命）。`,
            id,
          );
        }
      }
    }
  }
  // FMT-ESTIMATE（warn·{value:number, unit:string}）
  if (t.estimate !== undefined) {
    const e = t.estimate as Record<string, unknown>;
    if (
      !e ||
      typeof e !== 'object' ||
      Array.isArray(e) ||
      typeof e.value !== 'number' ||
      typeof e.unit !== 'string'
    ) {
      emit(
        'FMT-ESTIMATE',
        `${id}.estimate 应为对象 {value:number, unit:string}（当前：${JSON.stringify(e)}）。影响：cadence 拆解校验 / CPM 喂时长读它——形状坏则降级 unit（不致命）。`,
        id,
      );
    }
  }
  // FMT-ACCEPTANCE（warn·string 或 {criteria 非空, criterion.status ∈ enum}）
  if (t.acceptance !== undefined) {
    const a = t.acceptance;
    if (typeof a !== 'string') {
      if (!a || typeof a !== 'object' || Array.isArray(a)) {
        emit(
          'FMT-ACCEPTANCE',
          `${id}.acceptance 应为字符串（一句话 DoD）或对象 {criteria:[…]}（当前：${JSON.stringify(a)}）。`,
          id,
        );
      } else {
        const ao = a as { criteria?: unknown };
        if (!Array.isArray(ao.criteria) || ao.criteria.length === 0) {
          emit(
            'FMT-ACCEPTANCE',
            `${id}.acceptance 是目标函数对象时 criteria 必须是非空数组（当前：${JSON.stringify(ao.criteria)}）。`,
            id,
          );
        } else {
          for (let i = 0; i < ao.criteria.length; i++) {
            const cr = ao.criteria[i] as Record<string, unknown>;
            if (
              !cr ||
              typeof cr !== 'object' ||
              (cr.status !== undefined && !isEnumMember('acceptanceStatus', cr.status))
            ) {
              emit(
                'FMT-ACCEPTANCE',
                `${id}.acceptance.criteria[${i}].status 应 ∈ {pending, met, failed}（当前：${JSON.stringify(cr && cr.status)}）。`,
                id,
              );
            }
          }
        }
      }
    }
  }
  // FMT-BLOCKED-ON（warn·"user" 或存在 id）
  if (t.blocked_on !== undefined && t.blocked_on !== 'user') {
    if (typeof t.blocked_on !== 'string' || !validIds.has(t.blocked_on)) {
      emit(
        'FMT-BLOCKED-ON',
        `${id}.blocked_on 是 ${JSON.stringify(t.blocked_on)}，但它既不是 "user"、也不是某个存在的 task id。` +
          `影响：不致命（webview 显示裸字符串），但这条阻塞关系画不出来。建议指向真实 id 或 "user"。`,
        id,
      );
    }
  }
  // FMT-WIP（warn·task.wip_limit 数字，覆写 owner cap）
  if (t.wip_limit !== undefined && typeof t.wip_limit !== 'number') {
    emit(
      'FMT-WIP',
      `${id}.wip_limit 是 ${JSON.stringify(t.wip_limit)}，非数字。影响：posttool-batch 两级 WIP 读它覆写 owner cap——非数字则该覆写静默失效（graceful）。`,
      id,
    );
  }
  // FMT-MODEL（warn·task.model 若存在须为 string）
  if (t.model !== undefined && typeof t.model !== 'string') {
    emit(
      'FMT-MODEL',
      `${id}.model 是 ${JSON.stringify(t.model)}，非字符串。影响：estimate 层 tier 分层校准读它——非 string 则降级忽略。`,
      id,
    );
  }
  // FMT-TIME（warn·三时间锚 ISO）
  for (const field of ['created_at', 'started_at', 'finished_at']) {
    const v = t[field];
    if (badTimestamp(v)) {
      emit(
        'FMT-TIME',
        `${id}.${field} 是 ${JSON.stringify(v)}，非严格 ISO-8601 UTC（YYYY-MM-DDTHH:MM:SSZ）。` +
          `影响：跨天 orchestration 的 timeline 时长会算错；建议用完整 UTC 时间戳。`,
        id,
      );
    }
  }
}

// ── 每个 task 的 BIZ 条件业务规则 ───────────────────────────────────────────────────────────────────
function lintTaskBiz(id: string, t: TaskLike, emit: Emit): void {
  const refs = Array.isArray(t.references)
    ? t.references.filter((r) => r && typeof r === 'object')
    : [];
  const hasRefKind = (k: string) => refs.some((r) => (r as Record<string, unknown>).kind === k);

  // BIZ-DEV-REFS（warn）：type=development ⇒ references 含 spec≥1 且 plan≥1。
  if (t.type === 'development') {
    if (!hasRefKind('spec') || !hasRefKind('plan')) {
      emit(
        'BIZ-DEV-REFS',
        `${id} 是 development task，但 references 缺 ${!hasRefKind('spec') ? 'kind=spec ' : ''}${!hasRefKind('plan') ? 'kind=plan' : ''} 引用。` +
          `影响：开发型节点至少要有 spec doc 与 plan doc 作为依据，缺则执行者/复盘者无锚点（用户定·warn 容渐进补全）。`,
        id,
      );
    }
  }
  // BIZ-ACCEPTANCE-REQUIRED（warn）：特定 type ⇒ acceptance 非空。
  const ACCEPTANCE_TYPES = new Set([
    'development',
    'development-demo',
    'acceptance',
    'e2e-integration',
  ]);
  if (ACCEPTANCE_TYPES.has(t.type as string) && !acceptanceNonEmpty(t.acceptance)) {
    emit(
      'BIZ-ACCEPTANCE-REQUIRED',
      `${id} 是 ${t.type} task，但缺 acceptance（验收标准）。` +
        `影响：这些 type 的 done 真语义靠 acceptance 锚定，缺则「做完了没」无客观判据（warn 容 in_flight 起补全）。`,
      id,
    );
  }
  // BIZ-EXECUTOR-HANDLE（warn）：executor ∈ {subagent, workflow} ⇒ handle 存在。
  if (
    (t.executor === 'subagent' || t.executor === 'workflow') &&
    (typeof t.handle !== 'string' || t.handle === '')
  ) {
    emit(
      'BIZ-EXECUTOR-HANDLE',
      `${id}.executor=${JSON.stringify(t.executor)} 但缺 handle（后台句柄）。` +
        `影响：resume 接驳在飞后台任务靠 handle，缺则换 session 后接不回（warn 容刚派发未回填的瞬态）。`,
      id,
    );
  }
  // BIZ-EXTERNAL-ISSUE（warn）：executor=external ⇒ references 含 issue≥1（#31）。
  if (t.executor === 'external' && !hasRefKind('issue')) {
    emit(
      'BIZ-EXTERNAL-ISSUE',
      `${id}.executor=external 但 references 缺 kind=issue 引用。` +
        `影响：外部第三方执行的任务该挂一个 issue 做追踪锚点（#31·task→github issue 映射），缺则无外部协作落点。`,
      id,
    );
  }
  // BIZ-AWAITING（hard）+ BIZ-DECISION-PACKAGE（warn）：awaiting-user 完整性。
  if (isAwaitingUser(t)) {
    const dp = t.decision_package;
    if (!dp || typeof dp !== 'object' || Array.isArray(dp)) {
      emit(
        'BIZ-AWAITING',
        `${id} 是 awaiting-user 节点（blocked_on:"user" + status=${JSON.stringify(t.status)}），但缺少 decision_package 对象（当前：${JSON.stringify(dp)}）。` +
          `awaiting-user 节点的存在意义就是一个「备好料的用户决策点」——没包 = 新 session 跑 /cc-master:discuss 开不起来讨论，采访闭环塌掉。\n` +
          `  怎么修：在 ${id} 上挂 decision_package（version/inputs_hash/ask_type/context_md/what_i_need/options…），或若已不在等用户拍板，改 blocked_on / status。`,
        id,
      );
    } else {
      lintDecisionPackage(id, dp as Record<string, unknown>, emit);
    }
  }
  // BIZ-TIME-ORDER（warn）：时间序 created≤started≤finished;in_flight⇒started;done⇒finished。
  lintTimeOrder(id, t, emit);
}

// BIZ-DECISION-PACKAGE（warn）：包在但字段不全（每项不合 → 一条 warn）。
function lintDecisionPackage(id: string, dp: Record<string, unknown>, emit: Emit): void {
  const INPUTS_HASH_RE = /^sha256:[0-9a-f]{64}$/; // #38：收紧为定长 64 hex（v1 曾用 + 宽松量词）
  if (typeof dp.context_md !== 'string' || dp.context_md === '') {
    emit(
      'BIZ-DECISION-PACKAGE',
      `${id}.decision_package.context_md 应为非空字符串（当前：${JSON.stringify(dp.context_md)}）。影响：discuss 用它讲清「为什么卡在这」——缺它用户被空投到失上下文决策点。`,
      id,
    );
  }
  if (typeof dp.what_i_need !== 'string' || dp.what_i_need === '') {
    emit(
      'BIZ-DECISION-PACKAGE',
      `${id}.decision_package.what_i_need 应为非空字符串（当前：${JSON.stringify(dp.what_i_need)}）。影响：discuss 据它告诉用户「该给你什么」——缺它讨论没有明确产出物。`,
      id,
    );
  }
  if (typeof dp.ask_type !== 'string' || !isEnumMember('askType', dp.ask_type)) {
    emit(
      'BIZ-DECISION-PACKAGE',
      `${id}.decision_package.ask_type 应 ∈ {decision, advice, solution}（当前：${JSON.stringify(dp.ask_type)}）。影响：discuss 据它设定姿态——缺/错则姿态错配。`,
      id,
    );
  } else if (dp.ask_type === 'decision' && !(Array.isArray(dp.options) && dp.options.length > 0)) {
    emit(
      'BIZ-DECISION-PACKAGE',
      `${id}.decision_package.ask_type 是 "decision" 却没有非空 options 数组（当前 options：${JSON.stringify(dp.options)}）。影响：decision 型采访让用户在 options 里拍板——没选项用户无从选起。`,
      id,
    );
  }
  if (typeof dp.inputs_hash !== 'string' || !INPUTS_HASH_RE.test(dp.inputs_hash)) {
    emit(
      'BIZ-DECISION-PACKAGE',
      `${id}.decision_package.inputs_hash 应匹配 sha256:<64位hex>（当前：${JSON.stringify(dp.inputs_hash)}）。影响：discuss 入口重算此值做 freshness-check——格式不对则时效性校验失效。`,
      id,
    );
  }
  if (typeof dp.enter_cmd !== 'string' || dp.enter_cmd === '') {
    emit(
      'BIZ-DECISION-PACKAGE',
      `${id}.decision_package.enter_cmd 应为非空字符串（当前：${JSON.stringify(dp.enter_cmd)}）。影响：webview 据此渲染复制 /cc-master:discuss 按钮——缺它「复制即用」那一环断掉。`,
      id,
    );
  }
}

// BIZ-TIME-ORDER（warn）：created≤started≤finished;in_flight⇒started;done⇒finished。
function lintTimeOrder(id: string, t: TaskLike, emit: Emit): void {
  const c = isISOUTC(t.created_at) ? Date.parse(t.created_at as string) : null;
  const s = isISOUTC(t.started_at) ? Date.parse(t.started_at as string) : null;
  const f = isISOUTC(t.finished_at) ? Date.parse(t.finished_at as string) : null;
  if (c != null && s != null && s < c)
    emit('BIZ-TIME-ORDER', `${id} started_at 早于 created_at（语义乱序）。`, id);
  if (s != null && f != null && f < s)
    emit('BIZ-TIME-ORDER', `${id} finished_at 早于 started_at（语义乱序）。`, id);
  if (t.finished_at !== undefined && t.started_at === undefined) {
    emit('BIZ-TIME-ORDER', `${id} 有 finished_at 却无 started_at（语义：先起跑才能完成）。`, id);
  }
  if (t.status === 'in_flight' && t.started_at === undefined) {
    emit('BIZ-TIME-ORDER', `${id} status=in_flight 却无 started_at（已派发执行应有起跑戳）。`, id);
  }
  if (t.status === 'done' && t.finished_at === undefined) {
    emit('BIZ-TIME-ORDER', `${id} status=done 却无 finished_at（完成应有完成戳）。`, id);
  }
}

// BIZ-CADENCE-SHIPPED（hard）：iteration.status=shipped ⇒ members 全存在且 done+verified（收口完整性）。
function lintCadenceShipped(board: BoardLike, taskById: Map<string, TaskLike>, emit: Emit): void {
  const c = board.cadence as { iterations?: unknown } | undefined;
  if (!c || typeof c !== 'object' || Array.isArray(c) || !Array.isArray(c.iterations)) return;
  for (const itAny of c.iterations) {
    const it = itAny as Record<string, unknown>;
    if (!it || typeof it !== 'object' || it.status !== 'shipped') continue;
    const members = Array.isArray(it.members)
      ? it.members.filter((m) => typeof m === 'string')
      : [];
    const bad: string[] = [];
    for (const m of members) {
      const mt = taskById.get(m);
      if (!mt) {
        bad.push(`${m}(不存在)`);
        continue;
      }
      if (mt.status !== 'done' || mt.verified !== true)
        bad.push(`${m}(${mt.status}${mt.verified === true ? '' : '/未验'})`);
    }
    if (bad.length) {
      emit(
        'BIZ-CADENCE-SHIPPED',
        `cadence iteration "${it.id}" 标 status=shipped，但其 members 未全部 done+verified：${bad.join(', ')}。` +
          `坏什么：iteration 收口（shipped）的语义就是「这一批纵切切片全交付并验过」——成员没到位却标 shipped = 收口完整性破，节奏台账谎报进度。\n` +
          `  怎么修：把未完成成员推到 done+verified 再标 shipped，或把它们移出本 iteration 的 members。`,
      );
    }
  }
}

// ── buildGraph / findCycle 的图结构类型 ──────────────────────────────────────────────────────────────
export interface EdgeIssue {
  kind: 'dangling' | 'selfLoop';
  id: string;
  dep?: string;
}
export interface BoardGraph {
  ids: Set<string>;
  taskById: Map<string, TaskLike>;
  upstream: Map<string, string[]>;
  downstream: Map<string, string[]>;
  dangling: Array<{ id: string; dep: string }>;
  selfLoops: string[];
  edgeIssues: EdgeIssue[];
  children: Map<string, string[]>;
  parentOf: Map<string, string>;
}

// buildGraph(tasks) — 从一个 tasks 数组建出图结构的纯函数（不抛、只读、对坏输入退化）。
//   board-lint-core 与 board-graph-core 共享的**单一真相源邻接构建器**（DRY）。lintBoard 调它拿 deps 邻接
//   + dangling/selfLoops 转 GRAPH-* 报告 + parent 倒排供 nesting 校验；board-graph-core require 它叠 CPM 等重算法。
export function buildGraph(tasks: unknown): BoardGraph {
  const list = (Array.isArray(tasks) ? tasks : []) as TaskLike[];
  const ids = new Set<string>();
  const taskById = new Map<string, TaskLike>();
  for (const t of list) {
    if (
      t &&
      typeof t === 'object' &&
      !Array.isArray(t) &&
      typeof t.id === 'string' &&
      t.id !== ''
    ) {
      if (!ids.has(t.id)) {
        ids.add(t.id);
        taskById.set(t.id, t);
      }
    }
  }

  const upstream = new Map<string, string[]>();
  const downstream = new Map<string, string[]>();
  for (const id of ids) {
    upstream.set(id, []);
    downstream.set(id, []);
  }

  const dangling: Array<{ id: string; dep: string }> = [];
  const selfLoops: string[] = [];
  const edgeIssues: EdgeIssue[] = [];

  for (const t of list) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
    const id = t.id;
    if (typeof id !== 'string' || id === '' || !ids.has(id)) continue;
    if (taskById.get(id) !== t) continue;
    const deps = Array.isArray(t.deps) ? t.deps.filter((d) => typeof d === 'string') : [];
    for (const d of deps) {
      if (!ids.has(d)) {
        dangling.push({ id, dep: d });
        edgeIssues.push({ kind: 'dangling', id, dep: d });
        continue;
      }
      if (d === id) {
        selfLoops.push(id);
        edgeIssues.push({ kind: 'selfLoop', id });
        continue;
      }
      (upstream.get(id) as string[]).push(d);
      (downstream.get(d) as string[]).push(id);
    }
  }

  const parentOf = new Map<string, string>();
  const children = new Map<string, string[]>();
  for (const t of list) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
    const id = t.id;
    if (typeof id !== 'string' || id === '' || !ids.has(id)) continue;
    if (taskById.get(id) !== t) continue;
    const p = t.parent;
    if (typeof p !== 'string' || p === '') continue;
    parentOf.set(id, p);
    if (!children.has(p)) children.set(p, []);
    (children.get(p) as string[]).push(id);
  }

  return {
    ids,
    taskById,
    upstream,
    downstream,
    dangling,
    selfLoops,
    edgeIssues,
    children,
    parentOf,
  };
}

// findCycle(graph: Map<id, deps[]>) → 环上 id 数组（从环起点起），或 null。DFS 三色着色（迭代式·避免爆栈）。
export function findCycle(graph: Map<string, string[]>): string[] | null {
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string>();
  for (const id of graph.keys()) color.set(id, WHITE);

  for (const start of graph.keys()) {
    if (color.get(start) !== WHITE) continue;
    const stack: Array<{ node: string; deps: string[]; i: number }> = [
      { node: start, deps: graph.get(start) || [], i: 0 },
    ];
    color.set(start, GRAY);
    while (stack.length) {
      const top = stack[stack.length - 1] as { node: string; deps: string[]; i: number };
      if (top.i >= top.deps.length) {
        color.set(top.node, BLACK);
        stack.pop();
        continue;
      }
      const next = top.deps[top.i++] as string;
      const c = color.get(next);
      if (c === undefined) continue;
      if (c === GRAY) {
        const cyc = [next];
        let cur: string | undefined = top.node;
        while (cur !== next && cur !== undefined) {
          cyc.push(cur);
          cur = parent.get(cur);
        }
        return cyc.reverse();
      }
      if (c === WHITE) {
        color.set(next, GRAY);
        parent.set(next, top.node);
        stack.push({ node: next, deps: graph.get(next) || [], i: 0 });
      }
    }
  }
  return null;
}

// formatReport({errors,warnings}) → agent-friendly 多行报告字符串。无 error 无 warn → 返回 ''（静默）。
export function formatReport(result: LintResult): string {
  const { errors, warnings } = result;
  if (errors.length === 0 && warnings.length === 0) return '';
  const lines: string[] = [];
  const head =
    errors.length > 0
      ? `cc-master board lint: FAIL（${errors.length} 个 hard error${warnings.length ? `，${warnings.length} warning` : ''}）`
      : `cc-master board lint: PASS（0 hard error，${warnings.length} warning）`;
  lines.push(head, '');
  for (const e of errors) lines.push(`[hard] ${e.rule} ${e.message}`, '');
  for (const w of warnings) lines.push(`[warn] ${w.rule} ${w.message}`, '');
  return lines.join('\n').replace(/\n+$/, '\n');
}

// 与原 CJS 源导出对齐：STATUS_ENUM（Set）+ ISO_UTC_RE（从 model 透传）。
export const STATUS_ENUM = STATUS_ENUM_LOCAL;
export const ISO_UTC_RE = ISO_UTC_RE_LOCAL;
