// self.ts — 解析「重新调起本 ccm 的绝对命令」（写进 settings.json 的 statusLine.command 用）。
//
// status line 安装把 `statusLine.command` 设成一个**绝对命令字符串**（别用 `${CLAUDE_PLUGIN_ROOT}`·它在
//   statusLine.command 不展开·Finding #39）。形态二分：
//   · SEA 二进制（生产分发）：process.execPath 就是 ccm 自身 → `"<bin>" statusline`。
//   · node-bin（全局 npm install / dev-shim）：process.execPath = node，process.argv[1] = bin/ccm.cjs →
//       `"<node>" "<ccm.cjs>" statusline`。
//
// 路径含空格 → 双引号包裹（shell 安全）。本模块只读 process.execPath / process.argv（CLI 入口侧事实）。
//
// 红线1 / ADR-006：node/JS only，纯 stdlib（path）。武装闸豁免：纯 helper（无 hook 入口）。

import * as path from 'node:path';

// shQuote(p) → 含空格 / 特殊字符时双引号包裹（内部双引号转义）。空串原样。
function shQuote(p: string): string {
  if (!p) return p;
  if (/^[A-Za-z0-9_./@:+,=-]+$/.test(p)) return p; // 安全字符集 → 免引号
  return `"${p.replace(/(["\\$`])/g, '\\$1')}"`;
}

// resolveSelfCommand() → 重新调起 ccm 的绝对命令（**不含** `statusline` 子命令·调用方自己拼）。
export function resolveSelfCommand(): string {
  const exec = process.execPath || 'ccm';
  const base = path.basename(exec).toLowerCase();
  const isNode = base === 'node' || base === 'node.exe';
  if (isNode) {
    // node-bin 路径：node <argv[1]>（argv[1] = bin/ccm.cjs 的绝对路径）。
    const script = process.argv[1] || '';
    if (script) return `${shQuote(exec)} ${shQuote(script)}`;
    // argv[1] 缺（极少）→ 退回裸 ccm（假设 PATH 上有）。
    return 'ccm';
  }
  // SEA 二进制：execPath 即 ccm 自身。
  return shQuote(exec);
}

// resolveStatuslineCommand() → 完整 status line 命令：`<self> statusline`。
export function resolveStatuslineCommand(): string {
  return `${resolveSelfCommand()} statusline`;
}

// resolveSelfBinPath(env?) → 本次 ccm 进程**入口的裸（未引号包裹）绝对路径**，喂给 autoInstall 的 DEV-GUARD
//   （@ccm/engine looksLikeDevInvocation）判定「是否从非安装位置〔worktree / 仓库内〕跑起来」。
//   · `env.CCM_BIN`（最高优先）：复用本仓既有 CCM_BIN 约定（hook 用它指向真 ccm·dev-bin shim）——显式声明
//     「本次 ccm 的真实二进制路径」，让 dev 检测有确定的探测点（也让 CLI 集成测试能注入一个安装路径模拟真实用户）。
//   · node-bin（dev-shim / 全局 npm install·无 CCM_BIN）：execPath=node → 入口是 `process.argv[1]`（bin/ccm.cjs）。
//   · SEA 二进制（生产分发）：execPath 即 ccm 自身。
//   与 resolveSelfCommand 同源事实，但**不做 shell 引号包裹**（dev 检测要的是真实文件路径去 fs 探标记）。
export function resolveSelfBinPath(env?: Record<string, string | undefined>): string | undefined {
  const e = env || process.env;
  if (e.CCM_BIN) return e.CCM_BIN;
  const exec = process.execPath || '';
  const base = path.basename(exec).toLowerCase();
  const isNode = base === 'node' || base === 'node.exe';
  if (isNode) return process.argv[1] || undefined; // 入口脚本 = bin/ccm.cjs 绝对路径
  return exec || undefined; // SEA：二进制自身
}
