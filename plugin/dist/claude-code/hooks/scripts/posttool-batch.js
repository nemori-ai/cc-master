#!/usr/bin/env node
'use strict';
// posttool-batch.js — PostToolBatch hook（WIP 软警告·H5）·v2 node 收编（ADR-013 §2.4）。
//
// 职责：一批并行工具调用解析完后，读**本 session 的 active 板**，按板独立比对 in_flight 数与该板的 WIP
//   上限——超 cap 的板贡献一条**非阻断** additionalContext 软警告（「下一回合别再加并行活、defer 高 float」）。
//   两级 WIP：① 全局 wip_limit（限整板 in_flight 总数 M）；② per-owner owner_wip_limit（限每个 owner 名下
//   in_flight 子任务数 N，owner 节点自带 wip_limit 可覆写）。两级各自独立判定，graceful-degrade（缺/非数即关）。
//   **绝不 decision:block** —— 并行自由不剥夺，只软推（lens 5 ~75% 利用率）。
//
// ★v2 收编：取代 v1 posttool-batch.sh 里 stdin_top_fields / owner_region / board_root_stream / tasks_region /
//   owner_wip_violations 五段脆弱 awk 深度扫描——node 的 JSON.parse 直接读 stdin 顶层字段（tool_results 内同名
//   字段天然不污染）、读 board.owner 子对象判武装、读 top-level task.status/parent 数 in_flight（嵌在 log[] 里
//   的 status/parent/wip_limit 不能冒充顶层，由数据模型解析根除·CODEX7/CODEX10/codex round-2 类盲区）。
//
// ★phase-1b：plumbing（stdin/home/listMatchingBoards 武装/additionalContext envelope/fail-silent/exit 0）收口
//   进 hook-common.runHook（arm:'boards'）；sub-agent 闸 + 非法-stdin 早退放 preGate（须比武装更早静默）；
//   body 只剩独有的「按板比对两级 WIP cap + 拼软警告」。
//
// ★v2 字段映射：全局 cap 从 v1 根 `wip_limit` → v2 `board.scheduling.wip_limit`（缺则降级 fallback 根 wip_limit，
//   兼容旧板；都缺则全局检查静默关）；per-owner 默认 cap 从根 `owner_wip_limit` → v2 `board.scheduling.owner_wip_limit`
//   （同样降级 fallback 根 owner_wip_limit）；per-task `wip_limit` 留在 task 上不变。schema-agnostic：不校验
//   schema 字符串；其余 v2 新字段（executor/type/references/estimate/acceptance/cadence/judgment_calls）silent-on-unknown。
//
// 红线1/ADR-006：node/JS only，纯 stdlib，零 spawn（不调 jq/python/awk）/网络/依赖。红线6：dormant-until-armed
//   ——harness 武装闸（arm:'boards' 空列表静默 exit 0·复用 hook-common 的 boardMatches）。红线2：只读 narrow-waist
//   （owner.active/session_id 判武装 + tasks[].status/parent + scheduling.wip_limit）判断，不写 board。红线4：
//   sub-agent 上下文（stdin 带顶层 agent_id）静默早退——指挥专属的 WIP 软警告绝不泄漏给 leaf worker。

const { jsonEscape, advisory, runHook } = require('./hook-common.js');

// numericCap(v) — 把一个值规整成「数值 cap」：仅接受非负整数（数字字面量或纯数字字符串），否则返回 null。
//   v1 用 grep -oE '[0-9]+' + 整数 case 守护，等价于「值是数字且为非负整数」——"auto" / 非数字 → 无 cap（关）。
function numericCap(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  if (typeof v === 'string' && /^[0-9]+$/.test(v)) return parseInt(v, 10);
  return null;
}

// schedCap(board, key) — v2 字段读取 + 降级 fallback：先看 board.scheduling[key]（v2），缺/非数则 fallback 到
//   board[key]（v1 旧板根字段，graceful 兼容）。两处都缺/非数 → null（该级检查静默关）。
function schedCap(board, key) {
  const sched = (board && typeof board === 'object' && board.scheduling && typeof board.scheduling === 'object')
    ? board.scheduling : {};
  const fromSched = numericCap(sched[key]);
  if (fromSched !== null) return fromSched;       // v2 位置优先
  return numericCap(board ? board[key] : undefined); // 降级 fallback：v1 根字段
}

runHook({
  event: 'PostToolBatch',
  arm: 'boards', // 本 session 的 active 板（武装闸 boardMatches）；空 → harness 静默 exit 0（dormant-until-armed）

  // ── preGate：武装之前的早退（非法 stdin + SUB-AGENT 闸）─────────────────────────────────────────────
  // ① **仅非法 JSON** stdin → 静默早退（与原 main 顶部 `try{JSON.parse}catch{return}` 字字对齐）。**数组 /
  //    非对象 JSON 不早退**——原代码 catch 外的 `if (...&&!Array.isArray(o)) obj=o;` 把它们当 `obj={}` 继续
  //    （sid='' → 武装走空-sid 降级匹配、agent_id 缺 → 视主线、in_flight 仍按板算）。raw 重解析（stdin 已被
  //    harness 读走、放在 ctx.raw），与原 main 顶部口径同（区分「非法 JSON」与「合法但非对象」）。
  // ② SUB-AGENT 闸（红线4：指挥不演奏）：PostToolBatch 在 sub-agent（Task 派生子 agent）上下文内部也触发；
  //    官方 stdin 此时带顶层 `agent_id`（主线缺席）。注入进 sub-agent 的 additionalContext 进的是 leaf worker
  //    自己的 context——主编排者专属的 WIP 软警告绝不能泄漏给单元 worker（破红线4）。只认带引号的字符串
  //    agent_id：`"agent_id":null` 或字段缺席 / 非对象 stdin → 非字符串 → 视为主线；非空字符串（sub-agent）→
  //    静默早退（在武装闸之前，最早可静默处·与 v1 sed「只认带引号值」字字对齐）。
  preGate(ctx) {
    let o;
    try {
      o = JSON.parse(ctx.raw || '{}');
    } catch (_e) {
      return true; // 非法 JSON → 早退（静默）。数组/非对象 JSON 解析成功 → 不早退（原代码当 obj={} 继续）。
    }
    // agent_id 仅从「合法对象（非数组）」顶层读；数组/非对象 → 无 agent_id → 视主线（原 obj={} 同效）。
    const isObj = o && typeof o === 'object' && !Array.isArray(o);
    const agentId = (isObj && typeof o.agent_id === 'string') ? o.agent_id : '';
    if (agentId) return true; // sub-agent 上下文 → 静默早退（红线4）
    return false;
  },

  body(ctx) {
    const boards = ctx.boards; // harness 已按文件名升序排 = 与 v1 glob `*.board.json` 同序（确定性）

    // ── 按板独立比对各自 board-local cap（wip_limit 是 board-LOCAL，绝不跨板聚合 in_flight·codex round-2）──
    let overWarn = '';
    for (const { board } of boards) {
      const tasks = Array.isArray(board.tasks) ? board.tasks : [];

      // 只数 top-level task 对象里 status==="in_flight" 的（嵌在 log[] 里的 status 不能冒充顶层·narrow-waist）。
      let n = 0;
      for (const t of tasks) {
        if (t && typeof t === 'object' && !Array.isArray(t) && t.status === 'in_flight') n++;
      }

      // ── LEVEL 1：全局 wip_limit（限整板 in_flight 总数 M）──────────────────────────────────────────────
      // v2 读 board.scheduling.wip_limit，降级 fallback 根 wip_limit。缺/非数 → 仅关全局级，绝不影响下面的
      // owner 级（两级独立）。仅在有数值 cap 且 in_flight 严格超过时触发（N==M 不警告）。
      const m = schedCap(board, 'wip_limit');
      if (m !== null && n > m) {
        overWarn += `cc-master: WIP is over the cap (${n} in_flight, wip_limit ${m}). Don't add more parallel work next round — consider deferring high-float tasks to keep ~75% utilization (lens 5). This is a soft warning, not a block. `;
      }

      // ── LEVEL 2：per-owner owner_wip_limit（限每个 owner 名下 in_flight 子任务数 N·rollup-aware D3.7）────
      // root 默认 per-owner cap：v2 board.scheduling.owner_wip_limit，降级 fallback 根 owner_wip_limit（缺/非数
      // → 无 root 默认）。按 task.parent 把 in_flight 子任务分组到各 owner（flat，max depth=1）；某 owner
      // 名下 in_flight 子数严格超其有效 cap（owner 节点自带 wip_limit 覆写 root 默认 N）→ 点名该 owner 的软警告。
      const rootN = schedCap(board, 'owner_wip_limit'); // null = 无 root 默认 N

      // 收集：① 每个 owner 名下 in_flight 子计数；② 每个 owner 自身节点的 wip_limit 覆写（仅 top-level task）。
      const inflightChildren = Object.create(null); // ownerId → in_flight 子数
      const seenOwner = Object.create(null);        // ownerId → 有过至少一个子
      const ownCap = Object.create(null);           // taskId → 该 task 自带 numeric wip_limit（覆写）
      for (const t of tasks) {
        if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
        const id = (typeof t.id === 'string') ? t.id : '';
        if (id) {
          const own = numericCap(t.wip_limit);       // owner 节点自带 wip_limit（覆写 root N）
          if (own !== null) ownCap[id] = own;
        }
        const parent = (typeof t.parent === 'string' && t.parent) ? t.parent : '';
        if (!parent) continue;                       // 非子任务 → 跳过
        seenOwner[parent] = true;                    // 该 owner 名下至少一个子
        if (t.status === 'in_flight') {
          inflightChildren[parent] = (inflightChildren[parent] || 0) + 1;
        }
      }

      // flat group-by-owner：对每个有子的 owner，cap 优先取其自带 wip_limit，否则 root 默认 N；
      // 无有效数值 cap → graceful degrade 跳过；in_flight 子数严格超 cap → 点名警告。
      // 遍历顺序：v1 awk `for (o in seen)` 顺序不定，但 owner 级警告各自独立成句（点名各自 owner），
      // 测试只 assert_contains 单个 owner id，顺序不影响断言；这里用 tasks 出现顺序的稳定遍历（确定性更好）。
      for (const owner of Object.keys(seenOwner)) {
        const cap = (owner in ownCap) ? ownCap[owner] : rootN; // 自带覆写优先于 root 默认
        if (cap === null) continue;                  // 无有效数值 cap → 跳过（graceful degrade）
        const c = inflightChildren[owner] || 0;
        if (c > cap) {
          overWarn += `cc-master: owner ${owner} has ${c} in_flight children (per-owner cap ${cap}). Don't fan out more work under this owner next round — defer high-float children to keep ~75% utilization (lens 5). This is a soft warning, not a block. `;
        }
      }
    }

    // ── self-gate：没有任何板超 cap → 静默（nothing to warn）─────────────────────────────────────────────
    if (!overWarn) return null;

    // ── 一块或多块板超 cap → 注入 NON-BLOCKING additionalContext（绝不 decision:block）────────────────────
    // ADR-018：WIP 软警告归 **advisory·weak**（§13/P4）——决策归 agent（要不要降并发是它的编排判断·非系统硬闸），
    //   低 stakes 且可逆（并行自由不剥夺·只软推 ~75% 利用率），故 weak 而非 strong/directive。source=posttool-batch。
    const warn = overWarn.replace(/ $/, ''); // 去尾随分隔空格（与 v1 `${over_warn% }` 等价）
    const wrapped = advisory('posttool-batch', 'weak', warn);
    // 手拼 additionalContext envelope 经 jsonEscape，与 harness { additionalContext } 形态字节等价（已验证）；
    //   用 raw 直拼保持与原输出逐字相同。
    return {
      raw: `{"hookSpecificOutput":{"hookEventName":"PostToolBatch","additionalContext":${jsonEscape(wrapped)}}}\n`,
    };
  },
});
