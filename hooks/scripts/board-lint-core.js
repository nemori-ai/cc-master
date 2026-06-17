'use strict';
// board-lint-core.js — T9 共享 lint 核心（单一真相源）。
//
// 这是 board lint 的纯逻辑：`lintBoard(text) → { errors, warnings }`。被两个薄包装消费——
//   ① PostToolUse hook（hooks/scripts/board-lint.js，同目录 require './board-lint-core.js'）；
//   ② 手动脚本（skills/orchestrating-to-completion/scripts/board-lint.js，经稳定的 plugin 内相对路径
//      require 同一份文件）。两个消费者复用同一段规则，杜绝两份漂移（DRY）。
//
// 落点为何在 hooks/scripts/（而非 skill 目录）：hook 不能伸手进 skill 树（红线5：hook 自洽、不依赖
//   skill 目录存在）；hooks/ 与 skills/ 都是随 plugin 分发的约定目录，依赖方向 skill→hooks 合法（两者
//   都一起 ship），故核心放 hooks/ 让 hook 同目录 require、手动脚本跨目录（plugin 内）require 同一份。
//
// 红线1 / ADR-006：node/JS only。JSON.parse 解析 board + 结构遍历 + deps 图拓扑校验，零 spawn jq/python，
//   零网络，零依赖（纯 stdlib 思路，本文件连 fs 都不用——只吃一段 text）。这正是 ADR-006 §3.0 点名的
//   「deps-graph integrity 用 node」用例（bash awk 串解析做无环检测不可行——Finding #5 家族）。
//
// 红线2（最关键）：lint 只校验**钉死的硬窄腰 + 合法 JSON + deps 图完整性 + viewer 真会挂的字段**，
//   对一切 agent-shaped 自定义字段**silent-on-unknown**（白名单校验 known 字段形状，未知字段一律放行、
//   零 warn）。绝不要求任何柔性边存在，绝不评判内容「合理性」——只校验 type/格式/enum/图完整性。
//   任何「agent 这么写不优雅但能跑」的规则都不进 lint，否则 lint 自己就成了「第二层窄腰」。
//
// 规则分级（设计稿 §2）：hard fail = 会确凿坏掉某条链路（hook / viewer / resume）的结构/语法错；
//   warn = 可疑但 graceful-degrade、不立即坏链路。

// status enum（窄腰一员，board.md §Status enum）。
const STATUS_ENUM = new Set([
  'ready', 'in_flight', 'blocked', 'done', 'escalated', 'failed', 'stale', 'uncertain',
]);

// 严格 ISO-8601 UTC 定宽：YYYY-MM-DDTHH:MM:SSZ（board.md 时间锚格式纪律）。
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// lintBoard(text) — text 是 board 文件的原始字符串。返回 { errors, warnings }，各为
//   [{ rule, message, task? }]。绝不抛（R1 把 JSON.parse 失败收成一条 error）。
function lintBoard(text) {
  const errors = [];
  const warnings = [];
  const err = (rule, message, task) => errors.push(task ? { rule, message, task } : { rule, message });
  const warn = (rule, message, task) => warnings.push(task ? { rule, message, task } : { rule, message });

  // ── R1：合法 JSON ──────────────────────────────────────────────────────────────────────────────
  // 坏什么：viewer 永久冻结（view-server 404 → 客户端静默停在旧帧）；resume 选板读出垃圾；hook 扫描错位。
  let board;
  try {
    board = JSON.parse(text);
  } catch (e) {
    const why = (e && e.message) ? e.message : String(e);
    err('R1',
      `不合法 JSON — board 无法被解析，会导致 webview 永久冻结（404 后停在旧帧）、resume 选板读出垃圾。\n` +
      `  解析器原话（仅供定位）：${why}\n` +
      `  怎么修：检查逗号与括号配对（尤其 sed/echo 截断了含 } 或 " 的字段值）；用 Write 整块重写 board（整写比 sed 改更不易写坏）。`);
    return { errors, warnings }; // JSON 都不合法 → 后续规则无从校验，提前返回
  }

  if (!board || typeof board !== 'object' || Array.isArray(board)) {
    err('R1', `board 顶层不是一个 JSON 对象（解析出 ${Array.isArray(board) ? '数组' : typeof board}）。怎么修：board 必须是 {…} 对象。`);
    return { errors, warnings };
  }

  // ── R2：pinned 窄腰存在且类型对（board.md §narrow-waist + ADR-003）──────────────────────────────
  // R2a schema === "cc-master/v1"
  if (typeof board.schema !== 'string' || board.schema !== 'cc-master/v1') {
    err('R2a',
      `schema 必须是字符串字面量 "cc-master/v1"（当前：${JSON.stringify(board.schema)}）。` +
      `坏什么：它是窄腰版本协议锚点，content 契约断言它；缺/改 = 窄腰破、未来 schema 路由会错认板。`);
  }
  // R2b goal 是 string
  if (typeof board.goal !== 'string') {
    err('R2b',
      `goal 必须是字符串（当前：${JSON.stringify(board.goal)}）。` +
      `坏什么：resume selector 按 goal 子串匹配认板、viewer 顶栏渲染它；缺 = resume 认领退化、顶栏空。`);
  }
  // R2c owner 是对象、owner.active 是 boolean
  const owner = board.owner;
  if (!owner || typeof owner !== 'object' || Array.isArray(owner)) {
    err('R2c', `owner 必须是对象（当前：${JSON.stringify(owner)}）。坏什么：武装闸读 owner.active/session_id；缺 = 本 session 武装判定崩。`);
  } else {
    if (typeof owner.active !== 'boolean') {
      err('R2c',
        `owner.active 必须是 boolean（当前：${JSON.stringify(owner.active)}）。` +
        `坏什么：武装闸（全 hook 的 isArmed）读它；非 bool = orchestrator 不再被 reinject / Stop 不再 gate / pacing 失声。`);
    }
    // R2d owner.session_id 是字符串（空串合法 —— fresh bootstrap 在缺 sid stdin 上建的待认领板）。
    if (typeof owner.session_id !== 'string') {
      err('R2d',
        `owner.session_id 必须是字符串（空串 "" 合法、表示待显式 re-arm 认领；当前：${JSON.stringify(owner.session_id)}）。` +
        `坏什么：武装闸 session-scope 匹配读它（ADR-007）。`);
    }
  }
  // R2e git 是对象（worktree/branch 字符串、可空）
  const git = board.git;
  if (!git || typeof git !== 'object' || Array.isArray(git)) {
    err('R2e', `git 必须是对象（含 worktree/branch 字符串，可空；当前：${JSON.stringify(git)}）。坏什么：窄腰一员（ADR-003），viewer 渲染 git.branch。`);
  } else {
    if (git.worktree !== undefined && typeof git.worktree !== 'string') {
      err('R2e', `git.worktree 若存在必须是字符串（当前：${JSON.stringify(git.worktree)}）。`);
    }
    if (git.branch !== undefined && typeof git.branch !== 'string') {
      err('R2e', `git.branch 若存在必须是字符串（当前：${JSON.stringify(git.branch)}）。`);
    }
  }
  // R2f tasks 是数组
  const tasks = board.tasks;
  if (!Array.isArray(tasks)) {
    err('R2f',
      `tasks 必须是数组（当前：${Array.isArray(tasks) ? 'array' : typeof tasks}）。` +
      `坏什么：goal-hook 数状态、viewer 整个 DAG、resume 重建模型全靠它；非数组 = viewer 空图（静默）、hook 扫描错位。`);
    // tasks 非数组 → R3/R4 无从遍历，但 R2a-e 已校验完，可返回。
    return { errors, warnings };
  }

  // ── R3：每个 task 的 {id, status, deps} 契约（board.md §narrow-waist tasks）──────────────────────
  const ids = new Set();
  const dupIds = new Set();
  const taskById = new Map(); // id -> task（供 R4 用）
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const where = `tasks[${i}]`;
    if (!t || typeof t !== 'object' || Array.isArray(t)) {
      err('R3a', `${where} 必须是对象（当前：${JSON.stringify(t)}）。坏什么：viewer 按 t.id 建节点、goal-hook 按 status 路由。`);
      continue;
    }
    const idLabel = (typeof t.id === 'string' && t.id) ? t.id : where;
    // R3a id 是非空字符串
    if (typeof t.id !== 'string' || t.id === '') {
      err('R3a',
        `${where}.id 必须是非空字符串（当前：${JSON.stringify(t.id)}）。` +
        `坏什么：viewer 用 id 建节点 key、goal-hook 按 id 计数；缺 id = 节点 key 撞/丢、hook 漏数。`, idLabel);
    } else {
      // R3b id 全局唯一
      if (ids.has(t.id)) { dupIds.add(t.id); }
      ids.add(t.id);
      taskById.set(t.id, t);
    }
    // R3c status 存在且 ∈ enum
    if (typeof t.status !== 'string' || !STATUS_ENUM.has(t.status)) {
      err('R3c',
        `${idLabel}.status 是 ${JSON.stringify(t.status)}，不在合法集合内。` +
        `坏什么：goal-hook 无法路由它（可能在还有活时放行 Stop），webview 把它画成 unknown 灯。\n` +
        `  怎么修：改成合法值之一：ready / in_flight / blocked / done / escalated / failed / stale / uncertain。`, idLabel);
    }
    // R3d deps 是 required 硬窄腰字段（board.md §narrow-waist 的 {id,status,deps} 三件套，line 208；
    //   line 210 的「可省略柔性边」明确不含 deps）。缺失（undefined）即 hard error——与 R3a(id)/R3c(status)
    //   对齐；存在则必须是数组、元素为字符串。
    if (t.deps === undefined) {
      err('R3d',
        `${idLabel}.deps 缺失。deps 是钉死的窄腰字段（与 id/status 同级，board.md §narrow-waist），不是可省略的柔性边。` +
        `坏什么：缺 deps = 畸形窄腰；下游图校验把它当无上游，让「手编 tasks[] 忘写 deps」这个真实错误静默溜过。\n` +
        `  怎么修：补上 deps——无上游写 "deps": []，有上游写 "deps": ["<上游 task id>", …]。`, idLabel);
    } else if (!Array.isArray(t.deps)) {
      err('R3d',
        `${idLabel}.deps 必须是字符串数组（当前：${typeof t.deps}）。` +
        `坏什么：viewer 兜底丢掉该任务的全部依赖边（静默错图）。\n` +
        `  怎么修：无上游写 "deps": []，有上游写 "deps": ["<上游 task id>", …]。`, idLabel);
    } else {
      for (const d of t.deps) {
        if (typeof d !== 'string') {
          err('R3d', `${idLabel}.deps 含非字符串元素（${JSON.stringify(d)}）；dep 必须是上游 task 的 id 字符串。`, idLabel);
        }
      }
    }
  }
  for (const dup of dupIds) {
    err('R3b',
      `task id "${dup}" 出现多次，必须全局唯一。` +
      `坏什么：viewer 后写者覆盖前者（静默丢节点）；deps 指向它时歧义。`, dup);
  }

  // ── R4：deps 图完整性（设计稿 §2.2；本 lint 相对 hook 现状的最大增量）──────────────────────────
  // 只对「id 合法、deps 是字符串数组」的 task 参与图校验（坏 task 已在 R3 报过，避免重复噪声）。
  const validIds = ids; // 已存在的 id 集合
  const graph = new Map(); // id -> [dep, ...]（只含指向存在 id 的边，供环检测）
  for (const [id, t] of taskById) {
    const deps = Array.isArray(t.deps) ? t.deps.filter((d) => typeof d === 'string') : [];
    const cleanDeps = [];
    for (const d of deps) {
      // R4a 无悬挂引用
      if (!validIds.has(d)) {
        err('R4a',
          `${id}.deps 含 "${d}"，但没有任何 task 的 id 是 "${d}"。` +
          `坏什么：webview 静默丢这条依赖边，且 ${id} 永远不会因上游完成而解锁。\n` +
          `  怎么修：把 "${d}" 改成真实存在的上游 id，或从 ${id}.deps 删掉它。现有 id：${[...validIds].join(', ')}。`, id);
        continue;
      }
      // R4b 无自环
      if (d === id) {
        err('R4b',
          `${id}.deps 含它自己（自环）。坏什么：${id} 依赖自己 → 永远 blocked、永不 ready。怎么修：从 ${id}.deps 删掉 "${id}"。`, id);
        continue;
      }
      cleanDeps.push(d);
    }
    graph.set(id, cleanDeps);
  }
  // R4c 无环（DFS 着色找有向环）。
  const cycle = findCycle(graph);
  if (cycle) {
    err('R4c',
      `deps 图存在环：${cycle.join(' → ')} → ${cycle[0]}。` +
      `坏什么：环上的任务互相等待 → 永远 ready 不了 → 编排死锁；viewer 拓扑/临界路径算法在环上行为未定义。\n` +
      `  怎么修：打破环——删掉环上某条 deps 边，让依赖关系回到无环的 DAG。`);
  }

  // ── R5：viewer 必需字段（多为 warn —— graceful-degrade，不立即坏链路；设计稿 §2.3）──────────────
  for (const [id, t] of taskById) {
    // R5b blocked_on 若存在，值为 "user" 或某个存在的 task id。
    if (t.blocked_on !== undefined && t.blocked_on !== 'user') {
      if (typeof t.blocked_on !== 'string' || !validIds.has(t.blocked_on)) {
        warn('R5b',
          `${id}.blocked_on 是 ${JSON.stringify(t.blocked_on)}，但它既不是 "user"、也不是某个存在的 task id。` +
          `影响：不致命（webview 显示裸字符串），但这条阻塞关系画不出来。建议指向真实 id 或 "user"。`, id);
      }
    }
    // R5a 时间锚若存在则格式可解析（夹在 R6a 一起处理见下；这里只对 dispatched_at 兜底旧名）。
    // R5c wip_limit 是 top-level，不在 per-task 循环里——见下方 top-level warn。
  }

  // ── R6：三时间戳 + meta.template_version 的形状校验位（全 warn —— agent-shaped 柔性边）──────────
  for (const [id, t] of taskById) {
    for (const field of ['created_at', 'started_at', 'finished_at']) {
      const v = t[field];
      if (v !== undefined && v !== null && !ISO_UTC_RE.test(typeof v === 'string' ? v : '')) {
        // R6a：时间戳存在但非严格 ISO-8601 UTC。
        warn('R6a',
          `${id}.${field} 是 ${JSON.stringify(v)}，非严格 ISO-8601 UTC（YYYY-MM-DDTHH:MM:SSZ）。` +
          `影响：跨天 orchestration 的 timeline 时长会算错；建议用完整 UTC 时间戳。`, id);
      }
    }
    // R6c finished_at 存在则 started_at 也应存在（先起跑才能完成）——纯语义提示。
    if (t.finished_at !== undefined && t.started_at === undefined) {
      warn('R6c',
        `${id} 有 finished_at 却无 started_at（语义：先起跑才能完成）。影响：不坏链路，但暗示盖戳逻辑有漏。`, id);
    }
  }
  // R5c top-level wip_limit 若存在为数字（soft-observed，board.md）。
  if (board.wip_limit !== undefined && typeof board.wip_limit !== 'number') {
    warn('R5c',
      `wip_limit 是 ${JSON.stringify(board.wip_limit)}，非数字。` +
      `影响：posttool-batch 的 C5 过调度软警告会静默关闭（graceful，不致命）；建议用数字或省略。`);
  }
  // R6b top-level meta.template_version 若存在为整数（agent-shaped，timeline 版本门）。
  if (board.meta && typeof board.meta === 'object' && board.meta.template_version !== undefined) {
    const tv = board.meta.template_version;
    if (!Number.isInteger(tv)) {
      warn('R6b',
        `meta.template_version 是 ${JSON.stringify(tv)}，非整数。` +
        `影响：timeline 版本门读它（非整数 → 当旧板走拓扑轴，降级不挂）；建议用整数或省略。`);
    }
  }

  return { errors, warnings };
}

// findCycle(graph: Map<id, deps[]>) → 返回环上的 id 数组（从环起点起），或 null（无环）。
// DFS 三色着色（white 未访 / gray 在栈 / black 完成）；遇到 gray 邻居即回边 = 环。
function findCycle(graph) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  const parent = new Map();
  for (const id of graph.keys()) color.set(id, WHITE);

  for (const start of graph.keys()) {
    if (color.get(start) !== WHITE) continue;
    // 迭代式 DFS（避免大图爆栈）。stack 元素 { node, iter }。
    const stack = [{ node: start, deps: graph.get(start) || [], i: 0 }];
    color.set(start, GRAY);
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.i >= top.deps.length) {
        color.set(top.node, BLACK);
        stack.pop();
        continue;
      }
      const next = top.deps[top.i++];
      const c = color.get(next);
      if (c === undefined) continue; // dep 指向不存在 id（R4a 已报）——不参与环
      if (c === GRAY) {
        // 回边：从 next 沿 parent 链回到 top.node，构造环路径。
        const cyc = [next];
        let cur = top.node;
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

// formatReport({errors,warnings}) → agent-friendly 多行报告字符串（设计稿 §7）。绝不吐原始 stack trace。
//   hard fail 与 warn 分组；每条点名 rule + 字段/task + 怎么修。无 error 无 warn → 返回 ''（静默）。
function formatReport(result) {
  const { errors, warnings } = result;
  if (errors.length === 0 && warnings.length === 0) return '';
  const lines = [];
  const head = errors.length > 0
    ? `cc-master board lint: FAIL（${errors.length} 个 hard error${warnings.length ? `，${warnings.length} warning` : ''}）`
    : `cc-master board lint: PASS（0 hard error，${warnings.length} warning）`;
  lines.push(head, '');
  for (const e of errors) lines.push(`[hard] ${e.rule} ${e.message}`, '');
  for (const w of warnings) lines.push(`[warn] ${w.rule} ${w.message}`, '');
  return lines.join('\n').replace(/\n+$/, '\n');
}

module.exports = { lintBoard, formatReport, findCycle, STATUS_ENUM, ISO_UTC_RE };
