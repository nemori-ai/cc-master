// handlers/board.ts — board noun handler（show / lint / graph / critical-path / next / init / update）。
//
// 照抄 log.ts 范式：每 verb 一个 handler(ctx)→exitCode；读 verb 走 _common.runRead、写 verb 走 runWrite。
//   handler **直接 import leaf 模块**（mutations / render / registry）+ 引擎符号（lintBoard / analyzeGraph），
//   不经 ctx 注入（契约 §三 ctx 形态）。mutation / discover 的 throw **不在 handler 内 catch**——冒泡给
//   router 按 .errKind 映射退出码。handler **绝不 process.exit**（return exitCode）。
//
// 域内分工：
//   · show          → runRead + render.renderBoardSummary（带 lint 结果让摘要显示 lint 是否净）。
//   · lint          → runRead + lintBoard + render.renderLintReport；有 hard error → return EXIT.VALIDATION。
//   · graph         → runRead + analyzeGraph 句柄 → render.renderGraph。
//   · critical-path → runRead + analyzeGraph 句柄 → render.renderCriticalPath。
//   · next          → runRead + analyzeGraph().readySet() → render.renderNext。
//   · init          → runWrite + 自定义 resolve（不发现既有板而新建文件·§7：owner.active:true / session_id:""）
//                     + mutations.boardInit（忽略 raw 直接产板）。
//   · update        → runWrite + mutations.boardUpdate（goal / wip-limit / owner-wip / branch / worktree）
//                     + applySet/applySetJson（--set/--set-json：板级顶层 ✎ 字段正门·Finding #83）。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib。
// 武装闸豁免：纯 handler 模块（无 hook 入口，只被 router 经 registry.handler 调）——见 AGENTS.md §3 / §12。
//
// T2b port 注：require → ESM import；module.exports → 命名导出。引擎 rewire：原 require('../board-lint-core.js')
//   + require('../board-graph-core.js') 改成从 `@ccm/engine` import { lintBoard, analyzeGraph }。
//   逻辑/数值/报错文案/.errKind/退出码逐字保持。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { analyzeGraph, formatReport, isEnumMember, lintBoard } from '@ccm/engine';
import * as discover from '../discover.js';
import * as io from '../io.js';
import * as mutations from '../mutations.js';
import { REGISTRY } from '../registry.js';
import * as render from '../render.js';
import {
  type BoardArg,
  buildFields,
  type Ctx,
  resolveBoardIgnoringGoal,
  runRead,
  runWrite,
  type SetOp,
} from './_common.js';

const EXIT = io.EXIT;

// 带 .errKind 的 Error（router 据此映射退出码）。
interface KindedError extends Error {
  errKind?: string;
}

// ── 读 verb：show ───────────────────────────────────────────────────────────────────────────────
// 摘要 = goal · owner · 任务统计 · lint 是否净。render 需要传入 lint 结果才会渲染 lint 段（render 不自跑 lint）。
export function show(ctx: Ctx): number {
  return runRead(ctx, {
    render: (board, c) => {
      const lint = lintBoard(JSON.stringify(board || {}));
      return render.renderBoardSummary(board, { json: !!c.flags.json, color: c.flags.color, lint });
    },
  });
}

// ── 读 verb：lint ───────────────────────────────────────────────────────────────────────────────
// 校验整板；有 hard error → return EXIT.VALIDATION（设计稿 §4：lint 是「读」但 hard error 退 3）。
//   注：runRead 恒返回 EXIT.OK，故 lint 不走 runRead——自己 resolve + 渲染 + 据 errors 决定退出码。
//
// 两种取板路径：
//   · 默认（discover）：resolveBoard 先 JSON.parse 校验（坏 JSON → throw NotFound → router 退 5），再 lint
//     parse 出的对象的 re-serialize 文本。这是历史行为，零变化（其它消费方契约）。
//   · --raw（board-lint hook 用·须配 --board）：直读 --board 指定文件的**原始字节**喂 lintBoard——绕过
//     discover 的 JSON 预校验，让坏 JSON 被 lint 成 FMT-JSON 错（而非 discover 提前退 5·hook 的本职是
//     catch agent 刚写坏的 JSON）。lintBoard 本身吃 raw string 且自己处理坏 JSON（FMT-JSON·绝不抛）。
//     读文件失败（路径缺失等）→ throw NotFound（router 退 5）；--raw 缺 --board → throw Usage（router 退 2）。
export function lint(ctx: Ctx): number {
  let res: ReturnType<typeof lintBoard>;
  if (ctx.values && ctx.values.raw) {
    const raw = readRawBoard(ctx);
    res = lintBoard(raw);
  } else {
    const resolved = discover.resolveBoard({
      boardFlag: ctx.values && (ctx.values.board as string),
      sid: ctx.sid,
      homeFlag: ctx.values && (ctx.values.home as string),
      goalSubstr: ctx.values && (ctx.values.goal as string),
      env: ctx.env,
    });
    res = lintBoard(JSON.stringify(resolved.board || {}));
  }
  // --json additive：折进 data.report（= formatReport 文本，与人读模式同一份）。board-lint hook 一次
  //   `ccm board lint --raw --json` 拿到 violations（判有无 findings）+ report（直接注入 agent 的文本）。
  //   人读模式 renderLintReport 自渲染（不需 report 参数·formatReport 只在 json 路径折入）。
  const report = ctx.flags.json ? formatReport(res) : undefined;
  ctx.out(render.renderLintReport(res, { json: !!ctx.flags.json, color: ctx.flags.color, report }));
  return Array.isArray(res.errors) && res.errors.length > 0 ? EXIT.VALIDATION : EXIT.OK;
}

// readRawBoard(ctx) → --board 指定文件的原始文本（绕过 discover 的 JSON 预校验·--raw 专用）。
//   --raw 须配显式 --board / $CC_MASTER_BOARD（坏 JSON 文件没法靠 discover 自动锚——文件本就读不成 board）。
//     缺 → throw Usage（router 退 2）。文件读不到（不存在/权限）→ throw NotFound（router 退 5）。
function readRawBoard(ctx: Ctx): string {
  const explicit =
    (ctx.values && (ctx.values.board as string)) || (ctx.env && ctx.env.CC_MASTER_BOARD);
  if (!explicit) {
    const e = new Error(
      'board lint --raw 须配 --board <path>（直读原始字节，不经 discover）',
    ) as KindedError;
    e.errKind = 'Usage';
    throw e;
  }
  try {
    return fs.readFileSync(path.resolve(explicit), 'utf8');
  } catch (_e) {
    const e = new Error(`board lint --raw 读不到文件：${path.resolve(explicit)}`) as KindedError;
    e.errKind = 'NotFound';
    throw e;
  }
}

// ── 读 verb：graph ──────────────────────────────────────────────────────────────────────────────
// DAG 全量分析：把 analyzeGraph(board) 句柄直接喂 render.renderGraph（render 内部探测句柄方法·_coerceAnalysis）。
export function graph(ctx: Ctx): number {
  return runRead(ctx, {
    compute: (board) => analyzeGraph((board || {}) as Parameters<typeof analyzeGraph>[0]),
    render: (analysis, c) =>
      render.renderGraph(analysis, { json: !!c.flags.json, color: c.flags.color }),
  });
}

// ── 读 verb：critical-path ──────────────────────────────────────────────────────────────────────
export function criticalPath(ctx: Ctx): number {
  return runRead(ctx, {
    compute: (board) => analyzeGraph((board || {}) as Parameters<typeof analyzeGraph>[0]),
    render: (analysis, c) =>
      render.renderCriticalPath(analysis, { json: !!c.flags.json, color: c.flags.color }),
  });
}

// ── 读 verb：next ───────────────────────────────────────────────────────────────────────────────
// readySet——现在能派发什么。analyzeGraph().readySet() 返回 id 数组 → render.renderNext。
export function next(ctx: Ctx): number {
  return runRead(ctx, {
    compute: (board) =>
      analyzeGraph((board || {}) as Parameters<typeof analyzeGraph>[0]).readySet(),
    render: (ready, c) => render.renderNext(ready, { json: !!c.flags.json, color: c.flags.color }),
  });
}

// ── 写 verb：init（特殊·不发现既有板而新建文件·§7）────────────────────────────────────────────────
//   自定义 resolve：--board 显式路径优先，否则在 resolveHome 内生成时间序文件名（与 bootstrap-board.sh 同口径）。
//     resolve 返回 { boardPath, board:null }——mutate 忽略 raw 直接 boardInit 产板（owner.active:true / session_id:""）。
//   仍走 runWrite 的 lock + lint + 原子写同一管线（模板含 hard error → EXIT.VALIDATION）。
function initResolve(ctx: Ctx): { boardPath: string; board: null } {
  const explicit =
    (ctx.values && (ctx.values.board as string)) || (ctx.env && ctx.env.CC_MASTER_BOARD);
  let boardPath: string;
  if (explicit) {
    boardPath = path.resolve(explicit);
  } else {
    const home = discover.resolveHome({
      homeFlag: ctx.values && (ctx.values.home as string),
      env: ctx.env,
    });
    const stamp = new Date()
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z')
      .replace(/[:-]/g, '');
    // board 集中落 <home>/boards/（board-v2 布局，与 bootstrap-board.sh / discover.listBoardFiles 同口径）。
    boardPath = path.join(discover.boardsDir(home), `${stamp}-${process.pid}.board.json`);
  }
  // QA #16：init 是「建板」命令——目标目录不存在时自建（否则 runWrite 抢锁 openSync('<board>.lock','wx')
  //   先撞 ENOENT 而非建板，`ccm board init --home <新目录>` 报错且不留痕）。只有 init 这么做：它创建板，
  //   故得负责让承载目录就位；其它写命令的板已由 discover 找到、父目录必然在，无需 mkdir。
  fs.mkdirSync(path.dirname(boardPath), { recursive: true });
  return { boardPath, board: null };
}

function parseGithubIssueUrl(value: unknown): string {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!url) return '';
  if (!/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/[0-9]+(?:[?#].*)?$/.test(url)) {
    const e = new Error(
      `--github-issue 须是 GitHub issue URL（形如 https://github.com/owner/repo/issues/123，当前：${JSON.stringify(value)}）`,
    ) as KindedError;
    e.errKind = 'Usage';
    throw e;
  }
  return url;
}

export function init(ctx: Ctx): number {
  return runWrite(ctx, {
    resolve: initResolve,
    mutate: () => {
      const goal = ctx.values && typeof ctx.values.goal === 'string' ? ctx.values.goal : '';
      const githubIssue = parseGithubIssueUrl(ctx.values && ctx.values['github-issue']);
      return mutations.boardInit({ goal, githubIssue });
    },
    render: (board, c, { dryRun, boardPath }) => {
      const b = board as { goal?: string; source?: { kind?: string; url?: string } };
      if (c.flags.json) return render.renderBoardSummary(b, { json: true });
      const goalStr = b.goal ? `goal="${b.goal}"` : '(无 goal)';
      const sourceStr =
        b.source && b.source.kind === 'github_issue' && b.source.url
          ? `  来源: ${b.source.url}\n`
          : '';
      // QA #13：建板后打印板路径 + 下一步，免得用户不知道板在哪 / 怎么接着加任务（同 home 下后续命令自动发现）。
      if (dryRun) return `[dry-run] 将建板: ${goalStr}`;
      return (
        `board 已建: ${goalStr}\n` +
        sourceStr +
        `  路径: ${boardPath}\n` +
        '  下一步: ccm task add <id> --type development --title <标题>（同 home 下自动发现，或 --board <上面路径>）'
      );
    },
  });
}

// ── 写 verb：update（改板级配置：goal / wip-limit / owner-wip / branch / worktree / --set / --set-json）──
//   registry 的 --wip-limit / --owner-wip 是 string（无 transform）——boardUpdate 期待 number，故在此显式 coerce。
//   坏整数（非数字）→ throw Usage（router 映射 exit 2）；不静默写非数字（否则 FMT-SCHEDULING warn）。
//   至少给一个可识别 flag——全无 → throw Usage（设计稿 update：「至少给一个 flag」）。
//   --set/--set-json（Finding #83）：板级顶层 ✎ flexible 字段的正门——裸 dotpath 落 board 顶层
//   （🔒 schema/goal/owner/git/tasks 由 applySet 守门拒·exit 3）；tasks[<id>].field 前缀仍按原契约
//   作用于该 task。非 --json 输出回显实际写入的逻辑 path（消除静默错落点）。
export function update(ctx: Ctx): number {
  let echoOps: SetOp[] = []; // mutate 收集 → render 回显逻辑落点
  return runWrite(ctx, {
    // --goal 在 update 是 payload（重定板 goal）而非发现过滤器——发现必须忽略它，否则 fresh-init 未认领板
    //   会被「现有 goal 含新串」滤掉 → 假 NotFound（与 --wip-limit / task add 等发现路径不一致·Finding #77）。
    //   resolveBoardIgnoringGoal 走与默认 resolve 同一条两层匹配，仅省 goalSubstr——统一 update 全 flag 的发现。
    resolve: resolveBoardIgnoringGoal,
    mutate: (board) => {
      const v = ctx.values || {};
      const args: Record<string, unknown> = {};
      if (v.goal !== undefined) args.goal = v.goal;
      if (v['wip-limit'] !== undefined) args.wipLimit = parseIntFlag(v['wip-limit'], '--wip-limit');
      if (v['owner-wip'] !== undefined) args.ownerWip = parseIntFlag(v['owner-wip'], '--owner-wip');
      if (v.branch !== undefined) args.branch = v.branch;
      if (v.worktree !== undefined) args.worktree = v.worktree;
      // --priority 写 ✎ coordination.priority（板级优先级·COORD）——枚举校验在此（坏值 → throw Usage·exit 2），
      //   不静默写非法值（否则 lint FMT-COORD warn + peers 跨板读时该板优先级退化为 normal）。
      if (v.priority !== undefined) {
        if (!isEnumMember('coordPriority', v.priority)) {
          const e = new Error(
            `--priority 须 ∈ {urgent, high, normal, low, trivial}（当前：${JSON.stringify(v.priority)}）`,
          ) as KindedError;
          e.errKind = 'Usage';
          throw e;
        }
        args.priority = v.priority;
      }
      // --set / --set-json：buildFields 只用来收集 sets/setJsons 操作列表（具名 flag 仍走上面的手动
      //   coerce 路径，fields 忽略）。board 语境不传 defaultTaskId——裸 path 落 board 顶层（正门语义）。
      const { sets, setJsons } = buildFields(ctx.values, REGISTRY.board?.update, {
        stdin: ctx.stdin,
      });
      echoOps = [...sets, ...setJsons];
      if (Object.keys(args).length === 0 && sets.length === 0 && setJsons.length === 0) {
        const e = new Error(
          'board update 至少须给一个 flag（--goal / --wip-limit / --owner-wip / --branch / --worktree / --priority / --set / --set-json）',
        ) as KindedError;
        e.errKind = 'Usage';
        throw e;
      }
      // args 是动态拼的 Record<string,unknown>（与原 JS 同形）；boardUpdate 期望窄入参对象——
      //   窄断言搬运（不改逻辑：键名/coerce 已对齐其 {goal,wipLimit,ownerWip,branch,worktree}）。
      let next = mutations.boardUpdate(
        board as BoardArg,
        args as Parameters<typeof mutations.boardUpdate>[1],
      );
      // 🔒 board 顶层（schema/goal/owner/git/tasks）由 applySet 守门拒（Validation 冒泡 → exit 3）。
      for (const op of sets) next = mutations.applySet(next, op.path, op.value);
      for (const op of setJsons) next = mutations.applySetJson(next, op.path, op.value);
      return next;
    },
    render: (board, c, { dryRun }) => {
      const b = board as {
        goal?: string;
        scheduling?: { wip_limit?: unknown };
        coordination?: { priority?: unknown };
      };
      if (c.flags.json) return render.renderBoardSummary(b, { json: true });
      const prefix = dryRun ? '[dry-run] 将改板级配置' : 'board 配置已更新';
      const sc = b.scheduling && typeof b.scheduling === 'object' ? b.scheduling : {};
      const co = b.coordination && typeof b.coordination === 'object' ? b.coordination : {};
      const parts = [
        `goal="${b.goal || ''}"`,
        `wip_limit=${sc.wip_limit !== undefined ? sc.wip_limit : '-'}`,
        `priority=${co.priority !== undefined ? co.priority : '-'}`,
      ];
      // --set/--set-json 落点回显：逻辑 path（board 语境无 defaultTaskId·裸 path 即顶层）。
      const setEcho = echoOps.map((op) => `\n  set ${mutations.logicalSetPath(op.path)}`).join('');
      return `${prefix}: ${parts.join('  ')}${setEcho}`;
    },
  });
}

// ── 写 verb：archive（归档板·翻 owner.active=false·带锁·停用即休眠·显式可逆）──────────────────────────
//   走 runWrite 同一条 lock + lint + 原子写管线（与 update / set-param 同口径）——这是 stop / handoff 命令
//   归档板的**唯一带锁路径**，替代它们手编辑 board JSON（手编辑与 ADR-020 Stop hook 带锁写并发会 torn-write）。
//   发现忽略 --goal（与 update 同：archive 无 --goal payload，但复用同一条两层发现保持一致·避免 goalSubstr 误滤）。
//   非破坏：tasks / log / goal / git 全留（mutations.boardArchive 只翻 active）；幂等。孤儿 / rollup 闸归命令体（归档前做）。
export function archive(ctx: Ctx): number {
  return runWrite(ctx, {
    resolve: resolveBoardIgnoringGoal,
    mutate: (board) => mutations.boardArchive(board as BoardArg),
    render: (board, c, { dryRun }) => {
      const b = board as { goal?: string };
      if (c.flags.json) return render.renderBoardSummary(b, { json: true });
      const prefix = dryRun
        ? '[dry-run] 将归档板（owner.active→false）'
        : '板已归档（owner.active=false·已停用·全套 hook 对它休眠·可经 --resume 复活）';
      return `${prefix}: goal="${b.goal || ''}"`;
    },
  });
}

// ── 写 verb：set-param（写 board.runtime.<白名单 key>·hook-owned 参数区·ADR-020·照 update / policy.set 体例）─
//   positionals = [key, value]（router 已校验 required·非空）。走 runWrite 带锁管线 → mutations.boardSetParam
//   做白名单 + 值校验（非白名单 key / 非法值 → throw .errKind='Usage' 冒泡 router 映射 exit 2）→ lint → 原子写。
//   作用域收窄到 runtime.*（least-privilege）：这是 ADR-020 松绑「hook 可经 ccm 写特定 ✎ board 字段」的落点，
//   hook 经进程边界 spawn `ccm board set-param`、带锁写、绝不碰 🔒/👁 窄腰。
export function setParam(ctx: Ctx): number {
  return runWrite(ctx, {
    mutate: (board) => {
      const key = ctx.positionals[0] as string;
      const value = ctx.positionals[1] as string;
      return mutations.boardSetParam(board as BoardArg, { key, value });
    },
    render: (next, c, { dryRun }) => {
      const n = next as { runtime?: Record<string, unknown> };
      const key = ctx.positionals[0] as string;
      const val = n.runtime ? n.runtime[key] : undefined;
      if (c.flags.json) {
        return JSON.stringify({ ok: true, data: { runtime: n.runtime || null } });
      }
      const prefix = dryRun ? '[dry-run] 将设 runtime' : 'runtime 参数已设';
      return `${prefix}: ${key}=${val}`;
    },
  });
}

// parseIntFlag(raw, flagName) → 正整数；坏 → throw Usage（router 映射 exit 2）。
//   multiple:false 的 string flag·raw 是单值；防御性取最后一次（若数组）。
function parseIntFlag(raw: unknown, flagName: string): number {
  const s = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0) {
    const e = new Error(`${flagName} 须是非负整数（收到 ${JSON.stringify(s)}）`) as KindedError;
    e.errKind = 'Usage';
    throw e;
  }
  return n;
}
