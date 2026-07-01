#!/usr/bin/env node
'use strict';
// board-guard.js — PreToolUse hook（ADR-025）。把「board 变更只走 ccm」从纪律硬化为机制。
//
// 事件：PreToolUse（matcher Write|Edit|MultiEdit|Bash）。在工具**执行前**拦截 agent 直接 file-edit
//   本 home `boards/` 下的 `*.board.json`（或用 Bash 的 sed/echo/tee/cp… 手改它），把这类绕过 ccm 写
//   关卡的写入 **deny** 掉——board 的 schema/状态机/锁不变式只在走 ccm 时才被强制；手改会静默腐蚀
//   deps 图 / 状态机转移 / 窄腰，让下游（viewer / resume / hooks）读到谎。deny 时注入一条
//   `<directive source="board-guard">`（含 why + 该改用哪个 ccm verb），让 agent 立刻改道 ccm。
//
// 红线1 / ADR-006：node/JS only。纯 stdlib（path），零 spawn jq/python，零网络，零依赖。全程 try/catch
//   由 hook-common.runHook 兜住 → 任何异常静默 exit 0（**fail-open**：崩溃的 guard 绝不能卡死 agent）。
//
// 红线2：只读窄腰的 owner.active / owner.session_id 判武装（isArmed），deny 判定纯靠 tool_name + 路径
//   字符串（BOARDS_DIR 前缀 + `.board.json` 后缀）+ Bash 命令启发式，绝不读/写 board 内容。
//
// 红线6（dormant-until-armed）：arm:'custom'——body 顶部先 isArmed，**未武装一律静默放行**（普通非编排
//   session 必须能自由 Write/Edit 任意文件，含碰巧叫 *.board.json 的）。bootstrap-board.sh 仍是唯一豁免
//   的 ARM 动作（它经 ccm 建板、不走 Write 工具，与本 guard 无冲突）。
//
// Bash 启发式（best-effort·偏假阴）：解析任意 shell 找输出重定向/原地改写是不可判定的；故只在命令**同时**
//   含 `.board.json` 路径**与**一个写操作符（`>`/`>>`/`sed -i`/`tee`/`cp`/`mv`/`dd`/`truncate`）时 deny，
//   且命令含 `ccm` 调用则**早放行**（别拦 ccm 自己去写 board）。漏网的 Bash 手改由 PostToolUse board-lint
//   事后兜（软提示）——PreToolUse guard 挡结构化 Write/Edit（可靠）+ 明显的 Bash 写（启发式）。

const path = require('path');
const { resolveHome, boardsDir, isArmed, directive, runHook } = require('./hook-common.js');

// denyReason —— directive 文案（ADR-018 §13·真硬闸用 <directive>·含 why + fix）。收口成常量：所有 deny
//   路径共用同一文案，嗓音一致、只有一处写法。
const DENY_BODY = [
  '直接 file-edit board 被拦（board-guard·ADR-025）。',
  'why：board 的 schema / 状态机 / 锁不变式**只在走 ccm 时**才被强制。手改（Write/Edit/sed/echo/cat>）',
  '绕过写关卡，会静默腐蚀 deps 图 / 状态机转移 / 窄腰，让下游（viewer / resume / hooks）读到谎——',
  '且大多不报错、只在 resume 或 viewer 冻结时才现形。',
  'fix：改用 ccm verb——',
  '  · status → `ccm task start|done|block|set-status|unblock`',
  '  · 字段  → `ccm task update --set …`',
  '  · deps  → `ccm task update --add-dep|--rm-dep`',
  '  · 新任务 → `ccm task add`',
  '  · 板级  → `ccm board update`',
  '命令面详见 using-ccm skill（command-catalog）。',
].join('\n');

// denyPayload() → { raw }：PreToolUse deny envelope（body 自控整段 payload·runHook 原样写）。
//   permissionDecision:"deny" 硬阻断该工具调用；reason 包成 <directive source="board-guard">（含 why+fix）。
function denyPayload() {
  return {
    raw:
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: directive('board-guard', DENY_BODY),
        },
      }) + '\n',
  };
}

const HOME_DIR = resolveHome();
const BOARDS_DIR = path.resolve(boardsDir(HOME_DIR));

// pathIsBoard(filePath) → 该文件路径是否落在 <home>/boards/ 下且以 .board.json 结尾（纯字符串·无文件读）。
function pathIsBoard(filePath) {
  if (!filePath) return false;
  const resolved = path.resolve(filePath);
  const inBoards =
    resolved === BOARDS_DIR || resolved.startsWith(BOARDS_DIR + path.sep);
  if (!inBoards) return false;
  return path.basename(resolved).endsWith('.board.json');
}

// 写操作符启发式：命令里出现任一即视为「可能在写文件」。best-effort、偏假阴（宁可漏也别误伤只读命令）。
const WRITE_OP_RE =
  />>?|(^|\s)sed\s+[^|]*-i|(^|\s)tee(\s|$)|(^|\s)cp(\s|$)|(^|\s)mv(\s|$)|(^|\s)dd(\s|$)|(^|\s)truncate(\s|$)/;
const CCM_RE = /(^|\s)ccm(\s|$)/;
const BOARD_PATH_RE = /\.board\.json/;

// bashWritesBoard(command) → 该 Bash 命令是否**启发式命中**「手改 board」。命令含 ccm 调用 → 早放行（别拦
//   ccm 自己）；否则须同时含 .board.json 路径 + 写操作符才判命中。
function bashWritesBoard(command) {
  if (typeof command !== 'string' || !command) return false;
  if (CCM_RE.test(command)) return false; // ccm 调用 → 放行（ccm 才是合法写路径）
  if (!BOARD_PATH_RE.test(command)) return false;
  return WRITE_OP_RE.test(command);
}

// body(ctx)：Gate 0 武装 → Gate 1 工具/路径判定 → deny 或静默放行。
function body(ctx) {
  const { toolName, filePath, sid, obj } = ctx;

  // ── Gate 0：武装闸（红线6）——未武装一律静默放行（普通 session 自由 Write/Edit）────────────────
  if (!isArmed(HOME_DIR, sid)) return; // 返回 falsy → runHook 静默（空 stdout·RC0·不 block）

  // ── Gate 1：工具/路径判定 ────────────────────────────────────────────────────────────────────────
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit') {
    // 结构化 file_path（可靠判定）：落在 boards/ 下的 *.board.json → deny。
    if (pathIsBoard(filePath)) return denyPayload();
    return; // 非 board 文件 → 放行
  }
  if (toolName === 'Bash') {
    const cmd =
      obj && obj.tool_input && typeof obj.tool_input.command === 'string'
        ? obj.tool_input.command
        : '';
    if (bashWritesBoard(cmd)) return denyPayload();
    return; // 非手改-board 的 Bash（含所有 ccm 调用）→ 放行
  }
  return; // 其余工具 → 放行
}

// runHook：arm:'custom'（board-guard 武装是 body 内的 isArmed，非 harness 预设武装——须先判武装再看工具/
//   路径，否则未武装 session 会被误拦）。event 'PreToolUse'（body 走 { raw } 自控 payload·harness 原样写）。
//   全程 try/catch + exit 0 由 harness 保证——**fail-open**：任何异常静默放行（崩溃 guard 绝不卡死 agent）。
runHook({ event: 'PreToolUse', arm: 'custom', body });
