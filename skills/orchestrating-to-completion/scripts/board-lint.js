#!/usr/bin/env node
'use strict';
// board-lint.js — T9 交付 B：独立手动 lint 脚本（运行时带外、随 skill 分发）。
//
// 落点为何在这（skills/orchestrating-to-completion/scripts/）：它是**终端用户/agent 会跑的运行时**带外
//   脚本（红线5 / Finding #37 落点纪律）—— prose 引用用 ${CLAUDE_SKILL_DIR}/${CLAUDE_PLUGIN_ROOT} 绝对
//   路径，绝不裸相对路径。它**显式被调用**（不是 plugin-level 自动 hook），故**不需要武装闸**（武装闸是
//   防 hook 在无关 session 自动出声；显式跑就是想要它跑 —— 与 cc-usage.sh / codex-review.sh 同）；它对
//   任意给定的 board 路径都 lint（想查归档板也行），补 PostToolUse hook 看不见的编辑路径（尤其 Bash 改 board）。
//
// ★ADR-014 解耦（T4-3b 完成态）：lint 规则的唯一 SSOT 是 ccm 引擎（解耦后 `@ccm/engine`）。本脚本经
//   **进程边界 shell 调全局 `ccm` 二进制**（`spawnSync(CCM_BIN || 'ccm', ['board','lint','--board',<path>,
//   '--raw','--json'])` → parse stdout JSON → 打印 data.report 人读文本），**绝不 in-process require 引擎
//   源码**（红线1 进程边界；3b 已删整个 cli/）。它是用户**显式手动跑**的脚本（非 hook），故 ccm 缺/坏时
//   **明确友好报错退非 0**（不静默降级——hook 才静默；手动脚本要让用户知道「需要装 ccm」）。
//   · 调用约定：`CCM_BIN`（绝对路径可执行）是 dev/test/自定义安装的覆写口；生产 `ccm` 在 PATH。
//
// 红线1 / ADR-006：node/JS only，纯 stdlib（fs/path/child_process），零 npm dep，零网络。
//
// CLI（契约保持，转译为 ccm 调用）：
//   node board-lint.js <board-path>     lint 该文件
//   node board-lint.js                  无参 → lint CC_MASTER_HOME 下唯一的 active 板（多块则提示传路径）
//   node board-lint.js --json [<path>]  出结构化 {errors, warnings} JSON（供编排读·从 ccm violations 投影）
// 退出码：0 = 无 hard error（可能有 warning）；1 = 至少一个 hard error；2 = usage/IO/ccm-不可用 错。

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// CCM_BIN：dev/test/自定义安装的覆写口（绝对路径可执行）；缺则用 PATH 上的 `ccm`（生产）。
const CCM_BIN = process.env.CCM_BIN || 'ccm';

function die(msg, code) {
  process.stderr.write(msg + '\n');
  process.exit(code);
}

// findSingleActiveBoard(homeDir) → 唯一 active 板的绝对路径，或抛一个 agent-friendly 错。
//   board 集中在 <home>/boards/（board-v2 布局·与 bootstrap-board.sh / ccm 同口径），入参传 home 根。
function findSingleActiveBoard(homeDir) {
  const boardsDir = path.join(homeDir, 'boards');
  let entries;
  try {
    entries = fs.readdirSync(boardsDir, { withFileTypes: true });
  } catch (_e) {
    die(`cc-master board lint: 找不到 board home（${boardsDir}）。\n  怎么修：传一个显式 board 路径，或设 CC_MASTER_HOME。`, 2);
  }
  const active = [];
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith('.board.json')) continue;
    const full = path.join(boardsDir, ent.name);
    try {
      const b = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (b && b.owner && b.owner.active === true) active.push(full);
    } catch (_e) {
      // 坏板：无法判 active —— 跳过（用户可显式传它的路径来 lint）。
    }
  }
  if (active.length === 0) {
    die(`cc-master board lint: home（${boardsDir}）里没有 active board。\n  怎么修：传一个显式 board 路径。`, 2);
  }
  if (active.length > 1) {
    die(`cc-master board lint: home 里有 ${active.length} 块 active board，无法自动选。\n  请传一个显式 board 路径，例如：\n` +
        active.map((p) => `    node board-lint.js ${p}`).join('\n'), 2);
  }
  return active[0];
}

// lintViaCcm(boardPath) → { violations, report } —— spawnSync ccm board lint --board <path> --raw --json。
//   ccm 不可用（ENOENT / 非有效 JSON / 形状不符）→ 明确友好 die(…,2)（手动脚本：让用户知道需要 ccm）。
//   契约（1a）：stdout = { ok:true, data:{ ok:<lint净>, report:<文本>, violations:[{rule,level,message,task?}] } }；
//   退出码 0 无 hard error / 3 有 hard error / 2 用法 / 5 文件读不到——本脚本只据 data 判定，不靠退出码。
function lintViaCcm(boardPath) {
  let r;
  try {
    r = spawnSync(CCM_BIN, ['board', 'lint', '--board', boardPath, '--raw', '--json'], {
      encoding: 'utf8',
      timeout: 15000,
    });
  } catch (e) {
    die(`cc-master board lint: 无法调用 ccm（${CCM_BIN}）—— ${(e && e.message) ? e.message : String(e)}\n` +
        `  本脚本经全局 ccm 二进制 lint（ADR-014 解耦）。怎么修：装 ccm 并确保它在 PATH，或设 CCM_BIN 指向 ccm 可执行。`, 2);
  }
  if (!r || r.error || r.signal) {
    const why = r && r.error && r.error.code === 'ENOENT' ? `找不到 ccm（${CCM_BIN}）` :
                (r && r.signal) ? `ccm 被信号 ${r.signal} 终止` : 'ccm 调用失败';
    die(`cc-master board lint: ${why}。\n` +
        `  本脚本经全局 ccm 二进制 lint（ADR-014 解耦）。怎么修：装 ccm 并确保它在 PATH，或设 CCM_BIN 指向 ccm 可执行。`, 2);
  }
  const stdout = typeof r.stdout === 'string' ? r.stdout : '';
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (_e) {
    const stderr = typeof r.stderr === 'string' ? r.stderr.trim() : '';
    die(`cc-master board lint: ccm 没有返回有效 JSON（退出码 ${r.status}）。${stderr ? '\n  ccm stderr：' + stderr : ''}\n` +
        `  本脚本经全局 ccm 二进制 lint（ADR-014 解耦）。怎么修：确认 ccm 版本支持 \`board lint --raw --json\`。`, 2);
  }
  // ccm 错误信封：{ ok:false, exit, error, … }（如文件读不到 exit:5 / 用法 exit:2）——给 agent-friendly 错（非裸 stack）。
  if (parsed && parsed.ok === false) {
    const msg = typeof parsed.error === 'string' && parsed.error ? parsed.error : `ccm 退出码 ${parsed.exit}`;
    die(`cc-master board lint: ${msg}\n  怎么修：确认路径存在、可读，且 ccm 可正常调用。`, 2);
  }
  const data = parsed && typeof parsed === 'object' ? parsed.data : null;
  if (!data || typeof data !== 'object' || !Array.isArray(data.violations)) {
    die(`cc-master board lint: ccm JSON 形状不符（缺 data.violations）。\n` +
        `  怎么修：确认 ccm 版本支持 \`board lint --raw --json\`（契约 { ok:true, data:{ violations:[…], report } }）。`, 2);
  }
  return data;
}

function main() {
  const argv = process.argv.slice(2);
  let asJson = false;
  const rest = [];
  for (const a of argv) {
    if (a === '--json') asJson = true;
    else rest.push(a);
  }

  let boardPath = rest[0];
  if (!boardPath) {
    // 统一全局口径（与 hook-common.resolveHome / bootstrap-board.sh / ccm 同）：CC_MASTER_HOME 覆写，
    // 否则 <claudeConfigDir>/cc-master（claudeConfigDir 跟随 CLAUDE_CONFIG_DIR·默认 $HOME/.claude）；
    // 不再 per-repo（CLAUDE_PROJECT_DIR）或 cwd。board 在 <home>/boards/。
    const claudeConfigDir =
      process.env.CLAUDE_CONFIG_DIR ||
      path.join(process.env.HOME || require('os').homedir(), '.claude');
    const home =
      process.env.CC_MASTER_HOME || path.join(claudeConfigDir, 'cc-master');
    boardPath = findSingleActiveBoard(home); // 内部失败会 die(…,2)
  }
  boardPath = path.resolve(boardPath);

  const data = lintViaCcm(boardPath);
  // 从 ccm violations 投影出 {errors, warnings}（level:'hard' → error / 'warn' → warning），保留契约形状。
  const errors = data.violations.filter((v) => v && v.level === 'hard');
  const warnings = data.violations.filter((v) => v && v.level === 'warn');

  if (asJson) {
    process.stdout.write(JSON.stringify({ errors, warnings }) + '\n');
  } else {
    const report = typeof data.report === 'string' ? data.report : '';
    if (report) process.stdout.write(report.replace(/\n+$/, '') + '\n');
    else process.stdout.write('cc-master board lint: PASS（0 hard error，0 warning）\n');
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

try {
  main();
} catch (e) {
  // 手动脚本失败要 agent-friendly（非裸 stack trace）—— 但这是显式调用，给一条可读错 + rc 2。
  die(`cc-master board lint: 内部错误 —— ${(e && e.message) ? e.message : String(e)}`, 2);
}
