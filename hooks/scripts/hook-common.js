'use strict';
// hook-common.js — node hook 共享地基（武装闸 SSOT + HOME 解析 + stdin + 找板）。
//
// ★v2 收编（ADR-013 §2.4）：reinject / verify-board / posttool-batch / board-lint 四个 node hook 共用这一份
//   武装逻辑，取代 v1 时代每个 bash hook 各自一份脆弱的 awk 深度扫描（owner_region/board_matches/tasks_region）。
//   node 的 JSON.parse 一行替代那些「字符串/转义/方括号双深度」手写扫描——这正是收编消除的最大一类漂移。
//
// 红线1 / ADR-006：node/JS only，纯 stdlib（fs + path），零 spawn、零网络、零 npm 依赖。
// 红线2：只读 narrow-waist 的 owner.active / owner.session_id 判武装（不碰 agent-shaped 字段、不写 board）。
// 红线6（dormant-until-armed）：boardMatches / isArmed 即这道闸——本文件**含 `isArmed` 字样**，故天然过
//   §3 红线6 的 grep 门（与 board-lint-core.js 同——纯库无 hook 入口，但因含该词自然不被旗标，无需列豁免）。
//
// 武装语义（与 v1 board_matches 字字对齐·ADR-007）：一块板「是我的」⟺ owner.active===true 且
//   （stdin sid 空 → 非对称降级：任一 active 板；否则 owner.session_id===sid 精确匹配）。空 owner.session_id
//   的板**不被收养**（落到 "" === "<非空 sid>" → false → 休眠，fail-safe·红线6 防跨 session 污染·CODEX14）。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// claudeConfigDir() → claude 配置根（跟随 $CLAUDE_CONFIG_DIR·默认 $HOME/.claude·HOME 缺退 os.homedir()）。
//   纯 env 读（红线1 安全·绝不 spawn ccm/claude）——hook 不能 import @ccm/engine（红线5），故各 node
//   hook 共用 hook-common 这一份与 paths.resolveClaudeConfigDir 同口径的内联实现。
function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR ||
    path.join(process.env.HOME || os.homedir(), '.claude');
}

// resolveHome() → HOME_DIR（cc-master home **根**·统一全局口径·ADR-board-v2 home 收口）。
//   优先级：$CC_MASTER_HOME 覆写 → <claudeConfigDir>/cc-master（全局·默认·跟随 CLAUDE_CONFIG_DIR）。**不再**
//   per-repo（CLAUDE_PROJECT_DIR/.claude/cc-master）或 cwd fallback——所有 orchestration 的 board 集中到一个
//   用户级 home，跨 repo 不再各起一份。**这是全 hook（node + bash）+ ccm discover 的 node SSOT**：
//   board-lint / usage-pacing / reinject / verify-board / posttool-batch 都经本函数解析，不再各自内联。
//   测试经 CC_MASTER_HOME / CLAUDE_CONFIG_DIR 注入隔离 home。
function resolveHome() {
  return process.env.CC_MASTER_HOME ||
    path.join(claudeConfigDir(), 'cc-master');
}

// boardsDir(homeDir) → home 下集中放所有 *.board.json 的子目录（<home>/boards/·board-v2 布局）。
//   board 枚举 / 武装扫描一律走这里；home 根只放 accounts.json（全局·不动）+ hook sidecar（.stopcheck）
//   + 预留 channel/。把「home 根」与「boards 目录」分开，使 home 根能承载非 board 的全局资源不互撞。
function boardsDir(homeDir) {
  return path.join(homeDir, 'boards');
}

// readStdin() → stdin 原始字符串（读不到 → ''）。
function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (_e) { return ''; }
}

// parseStdin(raw) → { obj, sid, toolName, filePath }。非法 JSON → 空壳（sid='' 等）。
//   与 board-lint.js 取值口径一致：session_id / tool_name / tool_input.file_path。
function parseStdin(raw) {
  const out = { obj: {}, sid: '', toolName: '', filePath: '' };
  try {
    const o = JSON.parse(raw || '{}');
    if (o && typeof o === 'object') {
      out.obj = o;
      if (typeof o.session_id === 'string') out.sid = o.session_id;
      if (typeof o.tool_name === 'string') out.toolName = o.tool_name;
      const ti = o.tool_input || {};
      if (ti && typeof ti.file_path === 'string') out.filePath = ti.file_path;
    }
  } catch (_e) { /* 非法 stdin → 空壳 */ }
  return out;
}

// boardMatches(board, sid) → 这块（已解析的）board 是不是「我的 active 板」（武装谓词·narrow-waist only）。
//   只读 owner.active / owner.session_id。坏输入 → false。
function boardMatches(board, sid) {
  const owner = (board && typeof board === 'object' && board.owner) || {};
  if (owner.active !== true) return false;
  if (!sid) return true;                       // 非对称降级：stdin sid 空 → 任一 active 板
  return owner.session_id === sid;             // session-scoped 精确匹配（空 board sid 落 false → 不收养）
}

// listMatchingBoards(homeDir, sid) → [{ path, name, board }]——<home>/boards/ 里所有能解析且 boardMatches
//   的 *.board.json。坏板（读/解析失败）跳过（按「不匹配」处理）。供需要遍历自己所有 active 板的 hook
//   （reinject / verify-board / posttool-batch）。入参是 home **根**，内部走 boardsDir 扫 boards/ 子目录。
function listMatchingBoards(homeDir, sid) {
  const out = [];
  const dir = boardsDir(homeDir);
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return out; }
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith('.board.json')) continue;
    const p = path.join(dir, ent.name);
    let board;
    try { board = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_e) { continue; }
    if (boardMatches(board, sid)) out.push({ path: p, name: ent.name, board });
  }
  return out;
}

// isArmed(homeDir, sid) → 本 session 是否武装（<home>/boards/ 里存在至少一块匹配的 active 板）。
//   与 board-lint.js 旧内联 isArmed 语义字字相同（红线6 dormant-until-armed 的唯一判定）。入参是 home
//   **根**，内部走 boardsDir 扫 boards/ 子目录。
function isArmed(homeDir, sid) {
  const dir = boardsDir(homeDir);
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return false; }
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith('.board.json')) continue;
    let board;
    try { board = JSON.parse(fs.readFileSync(path.join(dir, ent.name), 'utf8')); } catch (_e) { continue; }
    if (boardMatches(board, sid)) return true;
  }
  return false;
}

// jsonEscape(str) → 安全注入进 JSON 字符串字面量的转义（hook 输出 additionalContext 用）。
function jsonEscape(str) { return JSON.stringify(String(str)); }

// ── ADR-018 hook→agent 标签化消息协议（作者侧 SSOT·AGENTS.md §13）──────────────────────────────────
// 所有 hook 往 agent context 注入的 transient 文本都按三类标签写（reinject/bootstrap 的角色 substrate 豁免，
//   见 ADR-018 §2.5）。三类固定对应三个标签；`strength`（weak|strong）**只给 advisory**（ambient 恒低 /
//   directive 恒满，保持最小集·P4）；**所有标签必带 `source`**（注的是哪个 hook·可追溯可审计·P6）。
//   把包装收口到这一份共享 helper：① 各 hook 注入嗓音一致、不漂移；② tag/source 语法只有一处写法，
//   防回潮 lint（structure.test.mjs）有唯一锚点对得上。纯字符串拼接、零依赖（红线1）。
//
//   ambient(source, body)             → <ambient source="...">…</ambient>     背景·塑模型·无 action
//   advisory(source, strength, body)  → <advisory source="..." strength="weak|strong">…</advisory>  喂判断·action 可选
//   directive(source, body)           → <directive source="...">…</directive>  硬约束·必须遵从·内含 why（P5 由调用方保证）
// body 已含必要 why（directive）/ levers（advisory）的完整文案；helper 只负责套标签外壳，不改文案语义。
function ambient(source, body) {
  return `<ambient source="${source}">\n${String(body)}\n</ambient>`;
}
function advisory(source, strength, body) {
  const s = (strength === 'strong') ? 'strong' : 'weak'; // 非法/缺 → weak（最低够用·P2）
  return `<advisory source="${source}" strength="${s}">\n${String(body)}\n</advisory>`;
}
function directive(source, body) {
  return `<directive source="${source}">\n${String(body)}\n</directive>`;
}

// ── runHook harness（phase-1b·设计稿 §9 Q1=做）─────────────────────────────────────────────────────
// 把五个 node hook 的同构样板收口成一个共享 runner，让每个 hook 只剩独有的 body 逻辑——新 hook
//   correct-by-construction（武装闸 / stdin 解析 / fail-silent 包裹 / exit 0 由 harness 一处保证，不会
//   各自漏掉）。**行为保持（behavior-preserving）**：与各 hook 原内联骨架字节级等价——武装语义（空 sid
//   降级、不收养空 owner sid，全由 hook-common 的 boardMatches/isArmed/listMatchingBoards 提供，不变）、
//   输出 envelope（additionalContext 经 JSON.stringify+'\n'，与旧手拼字节相同·已验证 key 序 + 转义一致）、
//   ADR-018 标签（body 自己套 ambient/advisory/directive，harness 不碰文案）、全程 try/catch + exit 0。
//
// 红线1/ADR-006：纯 stdlib、零 spawn/网络/依赖（spawn ccm 仍在各 body 内·进程边界 ADR-014，不在 harness）。
// 红线6（dormant-until-armed）：**武装闸是 harness 的固定环节**——unarmed 必静默（空 stdout、RC 0、不 block）。
//   这把「每个 hook 入口都先过武装」从「各 hook 自觉」升级为「harness 结构性保证」（红线 6 只增强不弱化；
//   bootstrap-board.sh 仍 bash·唯一豁免·绝不进本 harness）。
//
// spec 形状：
//   { event, arm, preGate?, body }
//   · event  : envelope 的 hookEventName（'SessionStart'|'Stop'|'PostToolBatch'|'PostToolUse'）；
//              body 走 { raw } 自控输出时可省（verify-board 自拼 decision/reason envelope）。
//   · arm    : 武装策略——
//              'isArmed'  → harness 调 isArmed(home, sid)；未武装 return（board-lint/usage-pacing）。
//              'boards'   → harness 调 listMatchingBoards(home, sid) 放进 ctx.boards（已按 name 升序排，
//                           与 v1 glob `*.board.json` 同序）；空列表 return（reinject/verify-board/posttool-batch）。
//              'custom'   → 不在 harness 武装；body 自己判武装（board-lint 的特殊四闸——它的武装是
//                           targetIsMyActiveBoard + isArmed/容错认领的复合闸，必须在 body 内做）。
//   · preGate: 可选 (ctx)=>bool；在**武装闸之前**跑，返回 true 即静默早退（posttool-batch 的 sub-agent
//              闸、usage-pacing 的 stop_hook_active 重入闸——它们须比武装更早静默）。
//   · body   : (ctx) => 输出意图。ctx = { raw, obj, sid, toolName, filePath, homeDir, boards }
//              （raw = stdin 原始串，obj = parseStdin 解析对象〔非法 JSON → {}〕，供 body/preGate 自判）。
//              返回值（输出意图，harness 据此写 stdout）：
//                falsy（null/undefined/不返回） → 静默（不写 stdout）。
//                { additionalContext } → 写 {"hookSpecificOutput":{"hookEventName":event,"additionalContext":…}}
//                                        （JSON.stringify+'\n'，与旧手拼字节等价）。
//                { raw }               → body 已自定整段 payload 字符串，harness 原样写（+ 不补 '\n'·
//                                        body 自带；verify-board 的 decision/reason/fuse 三态走这条）。
function runHook(spec) {
  try {
    const sp = spec || {};
    const raw = readStdin();
    const { obj, sid, toolName, filePath } = parseStdin(raw);
    const homeDir = resolveHome();
    const ctx = { raw, obj, sid, toolName, filePath, homeDir, boards: [] };

    // preGate：武装之前的早退（sub-agent / stop_hook_active 重入须先于武装静默）。
    if (typeof sp.preGate === 'function' && sp.preGate(ctx)) return;

    // 武装闸（红线6·harness 固定环节）。
    if (sp.arm === 'isArmed') {
      if (!isArmed(homeDir, sid)) return;
    } else if (sp.arm === 'boards') {
      ctx.boards = listMatchingBoards(homeDir, sid)
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      if (ctx.boards.length === 0) return; // dormant-until-armed：无匹配 active 板 → 静默
    } // 'custom'：body 自判武装（不在此 gate）

    // event：envelope 的 hookEventName。支持函数形态——多事件 hook（usage-pacing 同时挂 Stop + PostToolBatch）
    //   据 ctx（已解析 stdin 的 hook_event_name）解析触发事件，让 envelope 的 hookEventName 与实际触发事件一致。
    const resolvedEvent = typeof sp.event === 'function' ? sp.event(ctx) : sp.event;

    const out = sp.body ? sp.body(ctx) : null;
    if (!out) return;                       // 静默意图
    if (typeof out.raw === 'string') {      // body 自控整段 payload（verify-board）
      process.stdout.write(out.raw);
      return;
    }
    if (typeof out.additionalContext === 'string') {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: resolvedEvent, additionalContext: out.additionalContext },
      }) + '\n');
    }
  } catch (_e) {
    // 兜底：任何异常都不得污染 agent 流 → 静默成功退出（fail-silent·全 hook 同纪律）。
  }
  process.exit(0);
}

// ── 周期提示共享地基（ADR-020·hooks-enhancements-v2 ②：IDNUDGE + critpath-nudge 收口同形机制）─────────
// 两条周期提示（identity / critpath）都是「Stop·单 active 板守卫·读 board.runtime.<key> 判时间阈值·写回
//   时间戳·写回成功才注入·advisory 注入」的同形结构，差异只有 {key, intervalSec, build} 三元组。把这套
//   机制收口进本共享库，让一个 Stop hook 顺序跑一张「周期提示表」而非各起一个 Stop hook 文件（DRY + hook 薄）。
//
// 红线1/ADR-006：spawnSync ccm 是 ADR-014 进程边界（非 import 引擎·非 python）。红线2：只写 ✎ runtime.*（经
//   ccm setter·窄腰一字不动）。红线6：调用方在 arm:'boards' 武装后才跑 body（harness 保证）。

// parseIsoMs(s) → epoch ms 或 null（容错·非法当缺失）。Z → +00:00 让 Date 正确取 UTC。
function parseIsoMs(s) {
  if (typeof s !== 'string' || !s) return null;
  const t = Date.parse(s.replace('Z', '+00:00'));
  return Number.isNaN(t) ? null : t;
}
// isoNow(ms) → 严格 ISO-8601 UTC 秒级（YYYY-MM-DDTHH:MM:SSZ·与 mutations.stampNow / ISO_UTC_RE 同口径）。
function isoNow(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// spawnCcmSetParam(ccmBin, boardPath, homeDir, key, value, timeoutMs) → true ⟺ 写回成功（ccm exit 0）。
//   spawnSync `ccm board set-param <key> <value> --board <path> --home <home>`（透传 CC_MASTER_HOME 让 ccm
//   解析同一 home）。**fail-silent**：ENOENT（ccm 不在 PATH）/ spawn 抛 / 被信号杀 / 非 0 退出（lint hard /
//   lock timeout / Usage）→ false（调用方据此不注入·本回合不提示）。token-blind：参数区只有时间戳·绝无 secret。
function spawnCcmSetParam(ccmBin, boardPath, homeDir, key, value, timeoutMs) {
  const args = ['board', 'set-param', key, value, '--board', boardPath, '--home', homeDir];
  const env = Object.assign({}, process.env, { CC_MASTER_HOME: homeDir });
  let r;
  try {
    r = spawnSync(ccmBin, args, {
      encoding: 'utf8',
      timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10000,
      env,
    });
  } catch (_e) {
    return false; // spawn 本身抛（极少）→ 视为 ccm 不在·不注入
  }
  if (!r || r.error || r.signal) return false; // ENOENT（ccm 不在 PATH）/ 被信号杀（超时）→ 降级静默
  return r.status === 0; // exit 0 = 写回成功；非 0（lint/lock/Usage）→ 不注入
}

// periodicNudge(spec) → advisory 字符串（要注入）或 null（未到阈值 / 写回失败 / build 弃权 → 静默）。
//   spec = { board, boardPath, homeDir, ccmBin, key, intervalSec, nowMs, setparamTimeoutMs, build }
//     · board / boardPath：单 active 目标板（调用方已守 ctx.boards.length===1）。
//     · key：runtime 簿记时间戳键（白名单·last_identity_remind / last_critpath_remind）。
//     · intervalSec：周期阈值（秒）。距上次满此即 due。
//     · nowMs：当前 epoch ms（调用方解析·支持 CC_MASTER_NOW 测试注入）。
//     · build(ctx)：() => advisory 字符串 或 null（弃权·如 critpath 当前无可报内容）。在「due 且写回成功」后才调。
//   流程（与 IDNUDGE 原内联字字对齐）：读 runtime[key] 判 due（缺/非 ISO → 视「从未提示」首次必 due）→ 未到
//   静默 → 先写回（写成功才注入·避免 ccm 缺时每回合 spam·进程边界 spawn·token-blind·带锁·fail-silent）→
//   写回失败静默 → build() 出文案（弃权则静默·不白写时间戳？写回已发生·见下注）。
//   ★写回与 build 顺序：与 IDNUDGE 同——**先写回再 build**（写回成功才有资格注入；build 弃权时本回合不注入，
//     时间戳已前移到 now，下个 interval 后再 due——这与 IDNUDGE「写成功即 seed」同语义，可接受：弃权≈本周期无
//     内容可报、跳过即可，不需要重试更早）。critpath 的 build 极少弃权（chain 空时才弃权），故影响可忽略。
function periodicNudge(spec) {
  const s = spec || {};
  const rt =
    s.board && typeof s.board.runtime === 'object' && s.board.runtime ? s.board.runtime : null;
  const last = rt ? rt[s.key] : undefined;
  const lastMs = parseIsoMs(last); // 缺 / 非 ISO → null → 视「从未提示」（首次必提示）
  const intervalSec = Number.isFinite(s.intervalSec) && s.intervalSec > 0 ? s.intervalSec : 0;
  const due = lastMs === null || s.nowMs - lastMs >= intervalSec * 1000;
  if (!due) return null; // 未到阈值 → 静默
  // 先写回（写成功才注入）。
  const ok = spawnCcmSetParam(
    s.ccmBin,
    s.boardPath,
    s.homeDir,
    s.key,
    isoNow(s.nowMs),
    s.setparamTimeoutMs,
  );
  if (!ok) return null; // ccm 缺 / 失败 / lock timeout → 静默（本回合不提示·下回合再试）
  const text = typeof s.build === 'function' ? s.build() : null;
  if (!text) return null; // build 弃权（无内容可报）→ 本回合不注入
  return text;
}

module.exports = {
  claudeConfigDir, resolveHome, boardsDir, readStdin, parseStdin, boardMatches, listMatchingBoards, isArmed, jsonEscape,
  ambient, advisory, directive, runHook,
  parseIsoMs, isoNow, spawnCcmSetParam, periodicNudge,
};
