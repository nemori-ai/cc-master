#!/usr/bin/env node
'use strict';
// board-lint.js — T9 PostToolUse hook（ADR-006 解锁的 node hook）。
//
// 事件：PostToolUse（matcher Write|Edit）。每当 agent 用 Write/Edit 改了**本 session 的 active board**
//   后触发，JSON.parse 重读它、跑共享 lint 核心（board-lint-core.js），不通过则注入一条**非阻断**的
//   additionalContext 报告（hookEventName "PostToolUse"），点名「违了哪条规则 + 哪个 task + 怎么修」，
//   让 agent 下一步去修。**绝不 decision:block** —— PostToolUse 编辑已落盘、撤不回，hook 只软提示。
//
// ★ADR-014 解耦（T4-3b 完成态）：四闸全过后，lint **经进程边界 shell 调全局 `ccm` 二进制**
//   （`spawnSync(CCM_BIN || 'ccm', ['board','lint','--board',<file>,'--raw','--json'])` → parse stdout JSON →
//   `data.violations` 判有无 finding、`data.report` 即注入文本）。这是 plugin 从「in-process require board 引擎」
//   解耦为「shell 调 ccm + JSON」的消费侧——绝不 import 引擎（红线1 仍守：spawn 一个二进制是允许的 shell 操作）。
//   · 调用约定：`CCM_BIN` 环境变量（绝对路径可执行）是 dev/test/自定义安装的覆写口；生产环境 `ccm` 在 PATH。
//   · 优雅降级：ccm 不可用（ENOENT / 非有效 JSON / 形状不符）→ **静默 exit 0**（hook 绝不污染 agent 流，
//     与现有 try/catch 纪律一致）。**ccm 是唯一 lint 路径**——3b 已删整个 cli/，不再有 require fallback：
//     ccm 失败即降级为「不出声」而非退回 in-process 引擎（lint 是软提示·PostToolUse 非 gate，缺一次无害）。
//
// 红线1 / ADR-006：node/JS only。JSON.parse 解析 stdin + board，零 spawn jq/python，零网络，零依赖
//   （spawn `ccm` 二进制 + JSON 是 ADR-014 许可的进程边界访问，非 import 引擎）。
//   全程 try/catch 兜住 → 任何失败都静默 exit 0（hook 崩绝不污染 agent 流，与 usage-pacing 同纪律）。
//
// 红线2：lint 只校验窄腰 + 合法 JSON + deps 图完整性 + viewer 真会挂的字段，对 agent-shaped 字段
//   silent-on-unknown —— 规则实现全在 ccm 引擎（lintBoard·解耦后 `@ccm/engine` SSOT），本 hook 只负责
//   「门 + 调 ccm + 注入」。
//
// 红线6（dormant-until-armed）：本 hook 是 PostToolUse（非 bootstrap），不豁免武装闸。复用与
//   usage-pacing.js **字字相同**的 board-derived isArmed —— 未武装一律静默。再叠一道「改的是本 session
//   的 active board 吗」判定（闸4），只对当前在用的真相源把关，不对归档板 / 别 session 的板出声。
//
// DRY：lint 规则的唯一 SSOT 是 ccm 引擎（`ccm board lint --raw --json`·解耦后 `@ccm/engine`）；本 hook
//   绝不复制规则集、绝不 in-process require 任何引擎源码（红线1 进程边界）。

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
// ★v2 收编：HOME 解析 + 武装闸 isArmed 收口到共享 hook-common（取代旧内联副本·SSOT、四个 node hook 一份）。
const { resolveHome, boardsDir, isArmed } = require('./hook-common.js');

// ── lint 核心获取：经 ccm 二进制（进程边界）；不可用即优雅降级静默（3b 已删 cli/，无 require fallback）─────
// CCM_BIN：dev/test/自定义安装的覆写口（绝对路径可执行）；缺则用 PATH 上的 `ccm`（生产）。
const CCM_BIN = process.env.CCM_BIN || 'ccm';

// lintViaCcm(resolvedFile) → { report } | null。
//   spawnSync ccm board lint --board <file> --raw --json → parse stdout JSON。
//   · 有 violations（含 hard / warn）→ 返回 { report: data.report }（注入文本）。
//   · 0 violations → 返回 { report: '' }（lint 净，调用方静默）。
//   · spawn 失败 / stdout 非有效 JSON / 形状不对 → 返回 null（→ 优雅降级静默 exit 0；3b 无 fallback）。
//   退出码契约（1a 定）：0 无 hard error（含只 warn）/ 3 有 hard error；--raw 坏 JSON 也走 lint（exit 3），
//   故 0 与 3 都是「ccm 跑成功、有有效 JSON」的正常态，不据退出码判有无 finding——只扫 data.violations。
function lintViaCcm(resolvedFile) {
  let r;
  try {
    r = spawnSync(CCM_BIN, ['board', 'lint', '--board', resolvedFile, '--raw', '--json'], {
      encoding: 'utf8',
      timeout: 15000,
    });
  } catch (_e) {
    return null; // spawn 本身抛（极少）→ 优雅降级
  }
  // ENOENT（ccm 不在 PATH / CCM_BIN 指向不存在）/ 被信号杀 → 优雅降级。
  if (!r || r.error || r.signal) return null;
  const stdout = typeof r.stdout === 'string' ? r.stdout : '';
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (_e) {
    return null; // 无有效 JSON（如 usage 错走 stderr、exit 2/5）→ 优雅降级
  }
  // 形状校验：{ ok:true, data:{ violations:[...], report:<string> } }。形状不符 → 优雅降级。
  const data = parsed && typeof parsed === 'object' ? parsed.data : null;
  if (!data || typeof data !== 'object' || !Array.isArray(data.violations)) return null;
  if (data.violations.length === 0) return { report: '' }; // lint 净
  const report = typeof data.report === 'string' ? data.report : '';
  return { report };
}

// HOME_DIR：home 根（CC_MASTER_HOME 覆写，否则 $HOME/.claude/cc-master·hook-common SSOT 同口径）。
//   board 落 <home>/boards/，故闸2 的「在 home 内」判定锚到 BOARDS_DIR（只对 boards/ 下的真相源 board 把关，
//   不对 home 根的 accounts.json / sidecar 出声）。测试经 CC_MASTER_HOME 注入。
const HOME_DIR = resolveHome();
const BOARDS_DIR = boardsDir(HOME_DIR);

// targetIsMyActiveBoard(filePath, sid)：闸4 —— 被编辑文件是不是「本 session 拥有的那块 active
//   board」。读该 board 的 owner.active === true 且（sid 非空时）owner.session_id === sid。
//   防的是：agent 手动编辑一块归档的 / 别 session 的 board，lint 不该对它出声。
//   返回：true（是我的 active 板）/ false（解析成功但归档 or 别 session）/ null（文件 JSON 读不出——
//   可能正是刚写坏的本 session active 板，由调用方用 targetOwnedByMeTolerant 这道坏-JSON 专用闸再判）。
function targetIsMyActiveBoard(filePath, sid) {
  let board;
  try {
    board = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_e) {
    // 文件读不出 / JSON 不合法 —— 但它可能正是 agent 刚写坏的本 session active board，我们仍想 lint 它。
    // 从坏 JSON 读不出结构化 owner，故返回 null 让调用方走坏-JSON 专用的容错认领闸（红线6 仍守）。
    return null;
  }
  const owner = (board && board.owner) || {};
  if (owner.active !== true) return false; // 归档板（active:false）→ 不出声
  if (sid && owner.session_id !== sid) return false; // 别 session 的 active 板 → 不出声
  return true;
}

// targetOwnedByMeTolerant(filePath, sid)：坏-JSON 专用闸 —— 目标文件 JSON.parse 失败时，对**原始文本**
//   做容错扫描，判它的 owner.session_id 是否属于本 session。这道闸专为「本 session 把自己唯一的 active
//   board 写成 invalid JSON」而设：此时结构化 isArmed 扫不到任何可解析 active 板（坏板自己 parse 失败被
//   跳过）→ 标准武装闸误判未武装 → lint 漏掉它最该 catch 的那种坏写入（codex 逮到的 single-active-board
//   盲区）。
//
//   红线6（dormant-until-armed）守法依据：只在原始文本里真能扫出 owner.session_id === sid（sid 非空时）
//   时才认领；sid 空时（compaction 边界降级）退而认任意写坏 *.board.json 的本 home 编辑（已过闸2 = 文件
//   在 cc-master home 内且匹配 *.board.json，一个 agent 主动往 home 写 board 文件已在和 cc-master 打交道，
//   给它一条「JSON 写坏了」的非阻断软提示是帮助而非骚扰）。**绝不**对「文本里扫出别 session 的
//   session_id」认领（防红线6 泄漏：从没跑过 orchestrator 的 session 编辑一块别人的坏板须保持静默）。
//   纯字符串扫描、零文件结构信任、任何异常静默 false。
function targetOwnedByMeTolerant(filePath, sid) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (_e) {
    return false; // 读不出 → 不认领
  }
  // 容错扫 owner.session_id 的值（首个 "session_id":"<value>"）。坏 JSON 也常保留 owner 块完整、只截断
  //   后续 tasks —— 这正是 agent 写坏的典型形态。
  const m = raw.match(/"session_id"\s*:\s*"([^"]*)"/);
  if (sid) {
    // sid 非空：只认领文本里明确写着本 session 的板。扫不出 / 写的是别 session → 不认领（红线6）。
    return !!m && m[1] === sid;
  }
  // sid 空（降级）：本 home 内写坏的 *.board.json 即认领（已过闸2，给软提示是帮助）。
  return true;
}

function main() {
  // 读 stdin，取 tool_name / tool_input.file_path / session_id。
  let stdin = '';
  try {
    stdin = fs.readFileSync(0, 'utf8');
  } catch (_e) {
    return; // stdin 读不到 → 静默
  }
  let toolName = '';
  let filePath = '';
  let sid = '';
  try {
    const o = JSON.parse(stdin || '{}');
    if (o && typeof o.tool_name === 'string') toolName = o.tool_name;
    if (o && typeof o.session_id === 'string') sid = o.session_id;
    const ti = (o && o.tool_input) || {};
    if (typeof ti.file_path === 'string') filePath = ti.file_path;
  } catch (_e) {
    return; // 非法 stdin → 静默
  }

  // ── 闸1：tool_name ∈ {Write, Edit, MultiEdit}（最高频早退；其余 Read/Grep/Bash 立即静默）──────────
  // Bash 改 board（sed/echo/cat >）的 tool_input 是 command 字符串、无结构化 file_path —— 静态 hook 无法
  // 可靠判断它改没改 board（解析任意 shell 找输出重定向不可判定），交手动脚本补（设计稿 §5.1）。
  if (toolName !== 'Write' && toolName !== 'Edit' && toolName !== 'MultiEdit') return;

  // ── 闸2：file_path 落在 <home>/boards/ 内且匹配 *.board.json（纯字符串判断，无文件读）────────────
  if (!filePath) return;
  const resolvedFile = path.resolve(filePath);
  const resolvedBoards = path.resolve(BOARDS_DIR);
  const inBoards =
    resolvedFile === resolvedBoards ||
    resolvedFile.startsWith(resolvedBoards + path.sep);
  if (!inBoards) return;
  if (!path.basename(resolvedFile).endsWith('.board.json')) return;

  // ── 闸3+闸4：武装 ∧「编辑的是本 session 的 active board」——但二者必须解耦（codex 逮到的 bug）─────
  // 先算闸4（目标本身是不是本 session 的 active 板），因为坏-JSON 目标要走专用的容错认领路径，不能被
  // 闸3 标准 isArmed 提前堵死。三个分支：
  const verdict = targetIsMyActiveBoard(resolvedFile, sid);
  if (verdict === false) return; // 解析成功但归档板 / 别 session 板 → 静默（现有正确行为，别动）
  if (verdict === true) {
    // 目标解析成功且是本 session 的 active 板 —— 它自己就是武装证据（lint 跑它会静默通过或报 warn）。
    // 标准 isArmed 此时必然也成立（它能 parse 这块 active 板），但我们不再依赖它「找到另一块」可解析板。
    // 仍过一道 isArmed 兜「目标解析成功但 owner 被改成非本 session 而 sid 空降级匹配到它」的常规路径。
    if (!isArmed(HOME_DIR, sid)) return;
  } else {
    // verdict === null：目标文件 JSON.parse 失败（可能正是刚写坏的本 session active board）。
    //   标准 isArmed 在「本 session 只有这一块 active 板、且它就是被写坏的目标」时会**误判未武装**
    //   （坏板 parse 失败被 isArmed 跳过、没有别的可解析 active 板救场 → return false）——这正是 codex
    //   逮到的 single-active-board 盲区。故对坏-JSON 目标用专用容错闸认领，而非标准 isArmed：
    //   - 它在文本里扫出 owner.session_id === sid（sid 非空）→ 是本 session 的板 → 放行 lint 报 R1。
    //   - sid 空（降级）→ 本 home 内写坏的 *.board.json 即认领 → 放行 lint 报 R1。
    //   - 扫出别 session 的 session_id / 扫不出且 sid 非空 → 不认领 → 静默（红线6：never-armed session
    //     编辑别人的坏板须沉默）。
    if (!targetOwnedByMeTolerant(resolvedFile, sid)) return;
  }

  // ── 四闸全过 → lint 被编辑的 board ──────────────────────────────────────────────────────────────
  // 经进程边界 shell 调 ccm（ADR-014·唯一路径，3b 已删 cli/、无 require fallback）。
  // 优雅降级：ccm 不可用 → outcome 为 null → 静默 exit 0（hook 绝不污染 agent 流·lint 是软提示非 gate）。
  const outcome = lintViaCcm(resolvedFile);
  if (outcome === null) return; // ccm 不可用 → 优雅降级（静默 exit 0）

  const report = outcome.report;
  if (!report) return; // lint 净（0 finding）→ 静默（不刷屏）

  // 非阻断注入：仅 additionalContext，hookEventName "PostToolUse"。绝不 decision:block。
  const payload = {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: report,
    },
  };
  process.stdout.write(JSON.stringify(payload) + '\n');
}

try {
  main();
} catch (_e) {
  // 兜底：任何未预期异常都不得污染 agent 流 —— 静默成功退出。
}
process.exit(0);
