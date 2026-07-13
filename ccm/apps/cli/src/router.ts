// router.ts — ccm CLI 集成路由层（P5.3·契约 §三 router.js / §四阶段表）。
//
// 定位：把已建的命令层（registry / io / suggest / help / handlers/*）接成一条「argv → exitCode」管线。
//   run(argv, {out, err, env, stdin}) → exitCode（**全 sync·绝不 process.exit**·契约 §一.7：退出码只在 bin 设一次）。
//
// 七步管线（契约 §三 router）：
//   ① 无参 / --help / -h（无 noun）→ help.printHelp；--version / -V → help.printVersion；return OK。
//   ② ALIASES 展开（registry.ALIASES：next→[board,next]、lint→[board,lint]、ls→[task,list]）。
//   ③ noun/verb 切分 + 查 REGISTRY：未知 noun → err + suggestSimilar(noun, nouns) + USAGE；
//      noun 有但 verb 未知/缺 → err + suggestSimilar(verb, 该 noun 的 verbs) + USAGE；
//      `ccm <noun> --help` → printHelp(out,REG,noun)；`ccm <noun> <verb> --help` → printHelp(out,REG,noun,verb)。
//   ④ parseArgs({args:rest, options:spec.options, allowPositionals:true, strict:true, allowNegative:true})；
//      try/catch 把 ERR_PARSE_ARGS_* 重写成友好 stderr + USAGE。
//   ⑤ 校验：required positionals + enum（spec.options[].enum）→ 不满足 err + USAGE。
//   ⑥ 建 ctx → 由 spec.handler 字符串（'task.setStatus'）split('.') → HANDLERS[hnoun][hkey](ctx)。
//   ⑦ catch handler throw：按 .errKind 映射 EXIT（IllegalTransition/Validation→VALIDATION、NotFound/Ambiguous→
//      NOT_FOUND、message 含 LOCK_TIMEOUT→LOCKED、Usage→USAGE、else→ERROR）；友好 err 输出。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib（node:util.parseArgs）。
// 武装闸豁免：纯路由库（无 hook 入口，只被 bin/ccm.cjs 经 index.ts import）——见 AGENTS.md §3 红线6 / §12 grep 门豁免。
//
// T2b port 注：require → ESM import；module.exports → 命名导出。**忠实偏离**：原 ⑥ 步用 `require('./handlers/'+hnoun)`
//   动态加载 handler 模块；ESM/bundled（tsdown 单 CJS bundle·备 SEA）下无 `require` 且需静态可达——故改成
//   静态 HANDLERS 表（noun → 已 import 的 handler 模块），按 spec.handler 的 hnoun/hkey 查表派发。行为等价
//   （同一组 handler、同一派发键），只是把「运行时动态 require」换成「静态注册 + 动态查表」。其余逻辑/数值/
//   正则/报错文案/.errKind/退出码逐字保持。

import { parseArgs } from 'node:util';
import type { Ctx } from './handlers/_common.js';
import * as accountHandler from './handlers/account.js';
import * as attemptHandler from './handlers/attempt.js';
import * as baselineHandler from './handlers/baseline.js';
import * as boardHandler from './handlers/board.js';
import * as cadenceHandler from './handlers/cadence.js';
import * as coordinationHandler from './handlers/coordination.js';
import * as estimateHandler from './handlers/estimate.js';
import * as harnessHandler from './handlers/harness.js';
import * as jcHandler from './handlers/jc.js';
import * as logHandler from './handlers/log.js';
import * as monitorHandler from './handlers/monitor.js';
import * as peersHandler from './handlers/peers.js';
import * as policyHandler from './handlers/policy.js';
import * as runtimeHandler from './handlers/runtime.js';
import * as servicesHandler from './handlers/services.js';
import type { ShadowRoutingBoundary } from './handlers/shadow-routing.js';
import * as shadowRoutingHandler from './handlers/shadow-routing.js';
import * as statusReportHandler from './handlers/status-report.js';
import * as statuslineHandler from './handlers/statusline.js';
import * as taskHandler from './handlers/task.js';
import * as upgradeHandler from './handlers/upgrade.js';
import * as usageHandler from './handlers/usage.js';
import * as watchdogHandler from './handlers/watchdog.js';
import * as webViewerHandler from './handlers/web-viewer.js';
import { harnessSessionId } from './harnesses/registry.js';
import * as help from './help.js';
import * as io from './io.js';
import {
  ALIASES,
  NOUN_ALIASES,
  type NounSpec,
  type OptionSpec,
  REGISTRY,
  type VerbSpec,
} from './registry.js';
import * as suggest from './suggest.js';

const EXIT = io.EXIT;

// 带 .errKind / .kind 的 Error（router 据此映射退出码）。
interface KindedError extends Error {
  errKind?: string;
  kind?: string;
  violations?: unknown[];
  code?: string; // node parseArgs 的 ERR_PARSE_ARGS_*（NodeJS.ErrnoException 风格）。
}

// run 的 opts（注入流 + env + stdin）。out 可挂 _stream 供 io.resolveColor 探测 isTTY。
interface RunOpts {
  out: ((s: string) => void) & { _stream?: NodeJS.WriteStream };
  err: (s: string) => void;
  env?: Record<string, string | undefined>;
  stdin?: { fd?: number };
  shadowRoutingBoundary?: ShadowRoutingBoundary;
}

// 一个 handler 模块 = 名字 → handler(ctx) 函数（动态派发·hkey 在运行期定）。
type HandlerModule = Record<string, (ctx: Ctx) => number>;

// ── 静态 HANDLERS 表：noun → handler 模块（取代原 require('./handlers/'+hnoun)·见文件头偏离注记）。──────
//   key 与 spec.handler 字符串的首段（hnoun）对齐：'task.setStatus' → HANDLERS.task.setStatus。
const HANDLERS: Record<string, HandlerModule> = {
  attempt: attemptHandler as unknown as HandlerModule,
  board: boardHandler as unknown as HandlerModule,
  task: taskHandler as unknown as HandlerModule,
  log: logHandler as unknown as HandlerModule,
  jc: jcHandler as unknown as HandlerModule,
  cadence: cadenceHandler as unknown as HandlerModule,
  coordination: coordinationHandler as unknown as HandlerModule,
  watchdog: watchdogHandler as unknown as HandlerModule,
  baseline: baselineHandler as unknown as HandlerModule,
  policy: policyHandler as unknown as HandlerModule,
  runtime: runtimeHandler as unknown as HandlerModule,
  orchestrator: shadowRoutingHandler as unknown as HandlerModule,
  route: shadowRoutingHandler as unknown as HandlerModule,
  peers: peersHandler as unknown as HandlerModule,
  monitor: monitorHandler as unknown as HandlerModule,
  services: servicesHandler as unknown as HandlerModule,
  usage: usageHandler as unknown as HandlerModule,
  webviewer: webViewerHandler as unknown as HandlerModule,
  estimate: estimateHandler as unknown as HandlerModule,
  harness: harnessHandler as unknown as HandlerModule,
  account: accountHandler as unknown as HandlerModule,
  statusreport: statusReportHandler as unknown as HandlerModule,
  statusline: statuslineHandler as unknown as HandlerModule,
  upgrade: upgradeHandler as unknown as HandlerModule,
};

// ── DEFAULT_VERBS：某些 noun 无 verb 时落到约定默认 verb（让 `ccm statusline` ≡ `ccm statusline render`）。──
//   status-line 命令本身写进 settings.json 的是裸 `ccm statusline`，故 bare noun 必须能渲染——此表把它解析成 render。
//   两处特例：statusline→render（status-line 命令本身写裸 `ccm statusline`）、upgrade→all（裸 `ccm upgrade`
//   = 两件发布物各升各自线最新·见 handlers/upgrade.ts）。其余 noun 缺 verb 仍报「missing command」。
const DEFAULT_VERBS: Record<string, string> = {
  statusline: 'render',
  upgrade: 'all',
};

// node util.parseArgs 的 options 形态（带 short / multiple）——router 自有，独立于 registry 的 OptionSpec。
interface ParseOption {
  type: 'string' | 'boolean';
  short?: string;
  multiple?: boolean;
  enum?: readonly string[];
  required?: boolean;
}

// ── 全局 flag spec：每个命令都隐式接受这些（与命令专属 options 合并喂 parseArgs）。──────────────────────
//   与 help.js GLOBAL_FLAGS / 设计稿 §4 全局 flag 对齐。short 在此声明（parseArgs 的 short）。
//   注意：--json / --force 等若命令 spec.options 已声明（如各 read verb 的 json），合并时命令 spec 优先（不覆盖）。
const GLOBAL_OPTIONS: Record<string, ParseOption> = {
  board: { type: 'string' },
  harness: { type: 'string' },
  'session-id': { type: 'string' },
  home: { type: 'string' },
  goal: { type: 'string' },
  json: { type: 'boolean' },
  'dry-run': { type: 'boolean', short: 'n' },
  force: { type: 'boolean', short: 'f' },
  yes: { type: 'boolean', short: 'y' },
  quiet: { type: 'boolean', short: 'q' },
  verbose: { type: 'boolean', short: 'v' },
  color: { type: 'boolean' },
  'no-color': { type: 'boolean' },
  'no-input': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' },
};

// 全局 string-flag（取值型）的长名 + short 名集合——noun/verb 扫描时须跳过它们的值 token（如
//   `ccm --session-id SID1 board init` 里 SID1 是 --session-id 的值，不是 noun）。boolean 全局 flag 不消耗下一个 token。
const GLOBAL_VALUE_FLAGS = (() => {
  const longs = new Set<string>();
  const shorts = new Set<string>();
  for (const name of Object.keys(GLOBAL_OPTIONS)) {
    const o = GLOBAL_OPTIONS[name];
    if (!o) continue; // 防御（noUncheckedIndexedAccess）：遍历 keys 必有值。
    if (o.type === 'string') {
      longs.add(`--${name}`);
      if (o.short) shorts.add(`-${o.short}`);
    }
  }
  return { longs, shorts };
})();

interface ScanResult {
  positionals: Array<{ token: string; index: number }>;
  hasHelp: boolean;
  hasVersion: boolean;
}

// scanPositions(tokens) → { positionals:[{token,index}], hasHelp, hasVersion }。
//   flag-aware 扫描：跳过全局 string-flag 的值 token；`--k=v` 内联形不消耗下一个；`--` 之后全当 positional。
//   只需正确认出 noun/verb 两个 positional；命令专属 flag 的精确 arity 由其后真正的 parseArgs 负责。
function scanPositions(tokens: string[]): ScanResult {
  const positionals: Array<{ token: string; index: number }> = [];
  let hasHelp = false;
  let hasVersion = false;
  let afterDoubleDash = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as string; // i < length·必有值（noUncheckedIndexedAccess 窄断言·不改逻辑）。
    if (afterDoubleDash) {
      positionals.push({ token: t, index: i });
      continue;
    }
    if (t === '--') {
      afterDoubleDash = true;
      continue;
    }
    if (t === '--help' || t === '-h') {
      hasHelp = true;
      continue;
    }
    if (t === '--version' || t === '-V') {
      hasVersion = true;
      continue;
    }
    if (t.startsWith('-') && t !== '-') {
      // flag。内联 `--k=v` 自带值；否则若是全局 string-flag（长或短）则吞掉下一个 token 当其值。
      if (t.includes('=')) continue;
      if (GLOBAL_VALUE_FLAGS.longs.has(t) || GLOBAL_VALUE_FLAGS.shorts.has(t)) {
        i++; // 跳过值 token（即便它长得像 noun）。
      }
      continue;
    }
    // 非 flag token（`-` 也算 positional：stdin sentinel）。
    positionals.push({ token: t, index: i });
  }
  return { positionals, hasHelp, hasVersion };
}

function readGlobalStringFlag(tokens: string[], name: string): string | null {
  const long = `--${name}`;
  const prefix = `${long}=`;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as string;
    if (t === '--') return null;
    if (t === long) {
      const v = tokens[i + 1];
      return typeof v === 'string' ? v : null;
    }
    if (t.startsWith(prefix)) return t.slice(prefix.length);
  }
  return null;
}

function hasExactFlagBeforeDoubleDash(tokens: string[], flag: string): boolean {
  for (const token of tokens) {
    if (token === '--') return false;
    if (token === flag) return true;
  }
  return false;
}

function isReadOnlyCapabilityNegotiation(args: string[], scan: ScanResult): boolean {
  return (
    scan.positionals[0]?.token === 'board' &&
    scan.positionals[1]?.token === 'init' &&
    hasExactFlagBeforeDoubleDash(args, '--capabilities')
  );
}

// ── run(argv, {out, err, env, stdin}) → exitCode ──────────────────────────────────────────────────
//   返回 number（绝大多数 sync verb·同步落码）；`account switch`（唯一 async verb·await refresh）返回
//   Promise<number>，由 bin await。sync verb 路径全程不变（仍同步 return number）。
export function run(argv: string[], opts: Partial<RunOpts> = {}): number | Promise<number> {
  const out = opts.out as RunOpts['out'];
  const err = opts.err as RunOpts['err'];
  const env = opts.env || {};
  const stdin = opts.stdin;
  const args = Array.isArray(argv) ? argv.slice() : [];

  // ── ① 先 flag-aware 扫一遍认出 noun/verb 与顶层 --help/--version（防 `--session-id X` 的 X 被误当 noun）。──
  const scan0 = scanPositions(args);
  const harnessFlag0 = readGlobalStringFlag(args, 'harness');

  // ── NOUN_ALIASES 展开（namespace 级·先于 ALIASES/自动安装判断）：只换 noun 那一个 token，verb token
  //   原样透传——如 `ccm viewer start` → `ccm web-viewer start`；`ccm viewer`（裸敲）→ `ccm web-viewer`
  //   （裸敲，含相同的「missing command」提示）。原地改写 `args`（flag-aware 定位到的 index），下游 scan /
  //   ALIASES / REGISTRY 查找全部按改写后的真实 noun 走，无需另开一条分支。
  if (scan0.positionals.length > 0) {
    const first0 = scan0.positionals[0] as { token: string; index: number };
    if (Object.hasOwn(NOUN_ALIASES, first0.token)) {
      args[first0.index] = NOUN_ALIASES[first0.token] as string;
    }
  }

  // ── 无感知自动安装（0.10.0·marker 守·幂等·静默·绝不抛）：除 `statusline` 子命令本身和纯只读
  //   `board init --capabilities` 协商端点外，任意命令首次跑时
  //   把 ccm 自带的 status line 立起来（status line 高频跑·绝不触发自身）。kill-switch / opt-out / installed
  //   marker 任一在即 skip（详见 @ccm/engine autoInstallStatuslineOnce）。放在最前（no-noun 早退之前）让
  //   `ccm --help` / `ccm --version` 等也算「首次被调用」。env 注入 → 测试用临时 CLAUDE_CONFIG_DIR 隔离。
  //   capability discovery 必须在任何 init 路径解析/持久化前安全运行；它的零写契约不能要求每个 caller
  //   记住一个无关 statusline kill switch，所以 router 自身显式免除 auto-install。
  if (
    (scan0.positionals[0] && scan0.positionals[0].token) !== 'statusline' &&
    !isReadOnlyCapabilityNegotiation(args, scan0)
  ) {
    statuslineHandler.autoInstall(env, harnessFlag0 || undefined);
  }

  if (scan0.positionals.length === 0) {
    // 无 noun：纯 flag（或空）。--version / -V → 版本；其余（含 --help/-h/空）→ 顶层帮助。
    if (scan0.hasVersion) {
      help.printVersion(out);
      return EXIT.OK;
    }
    help.printHelp(out, { REGISTRY, ALIASES, NOUN_ALIASES });
    return EXIT.OK;
  }

  // ── ② ALIASES 展开：首个 positional 若是 alias → 在原位替换成 [noun, verb]。────────────────────────────
  let working = args;
  {
    // length>0 已由上方早退保证·positionals[0] 必有值（窄断言·不改逻辑）。
    const first = scan0.positionals[0] as { token: string; index: number };
    if (Object.hasOwn(ALIASES, first.token)) {
      // hasOwnProperty 已保证命中·ALIASES[first.token] 必为 [noun, verb]（! 窄断言）。
      const expansion = ALIASES[first.token] as [string, string]; // [noun, verb]
      working = args.slice(0, first.index).concat(expansion, args.slice(first.index + 1));
    }
  }

  // 展开后重扫（alias 注入了新 positional）。
  const scan = scanPositions(working);
  const indices = scan.positionals.map((p) => p.index);
  const noun = scan.positionals[0] && scan.positionals[0].token;
  const verb = scan.positionals[1] && scan.positionals[1].token;

  // 是否带 --help / -h（顶层 flag·决定降级到 help 而非真跑）。`--` 之后的 --help 不算（scanPositions 已处理）。
  const wantsHelp = scan.hasHelp;

  // ── ③ noun 校验。────────────────────────────────────────────────────────────────────────────────
  if (!Object.hasOwn(REGISTRY, noun as string)) {
    const cands = suggest.suggestSimilar(noun, Object.keys(REGISTRY));
    err(`unknown command: ${noun}`);
    if (cands.length) err(`Did you mean: ${cands.join(', ')}?`);
    err('Run `ccm --help` for the list of commands.');
    return EXIT.USAGE;
  }

  // hasOwnProperty 已保证 noun 在 REGISTRY·此处 noun 必为 string、nounSpec 必有值（窄断言·不改逻辑）。
  //   后续以 nounSpec 复用 REGISTRY[noun]（避免反复 noUncheckedIndexedAccess 窄化）。
  const nounStr = noun as string;
  const nounSpec = REGISTRY[nounStr] as NounSpec;

  // `ccm <noun> --help`（无 verb 或 wantsHelp 且 verb 未知）。
  if (!verb) {
    if (wantsHelp) {
      help.printHelp(out, { REGISTRY, ALIASES, NOUN_ALIASES }, nounStr);
      return EXIT.OK;
    }
    // 缺 verb 但该 noun 有约定默认 verb（如 statusline→render）→ 不报错，落默认 verb 继续（见 resolvedVerb 初值）。
    if (!Object.hasOwn(DEFAULT_VERBS, nounStr)) {
      // 缺 verb：列该 noun 的 verbs 当候选（无输入可纠错，直接列全集）。
      err(`missing command for: ${noun}`);
      err(`Available: ${Object.keys(nounSpec).join(', ')}`);
      err(`Run \`ccm ${noun} --help\` for details.`);
      return EXIT.USAGE;
    }
  }

  // ── verb 级别名解析（如 `ccm task ls` → `task list`）。──────────────────────────────────────────────
  //   ALIASES 里形如 `ls:['task','list']` 的条目同时是「verb 级别名」——当 verb 不是 noun 的真 verb，但等于某个
  //   ALIASES key 且该 alias 的 noun 段 === 当前 noun，则把 verb 解析成 alias 的 verb 段（registry §3.2 ls 注释）。
  //   verb 缺省时落 DEFAULT_VERBS（statusline→render）：bare `ccm statusline` 等价 `ccm statusline render`。
  let resolvedVerb = (verb ?? DEFAULT_VERBS[nounStr]) as string;
  if (
    verb !== undefined &&
    !Object.hasOwn(nounSpec, resolvedVerb) &&
    Object.hasOwn(ALIASES, verb) &&
    Array.isArray(ALIASES[verb]) &&
    (ALIASES[verb] as [string, string])[0] === noun
  ) {
    resolvedVerb = (ALIASES[verb] as [string, string])[1];
  }

  // ── verb 校验。──────────────────────────────────────────────────────────────────────────────────
  if (!Object.hasOwn(nounSpec, resolvedVerb)) {
    // `ccm <noun> <unknown> --help` → 降级到 noun 级 help（help.js 容忍未知 verb）。
    if (wantsHelp) {
      help.printHelp(out, { REGISTRY, ALIASES, NOUN_ALIASES }, nounStr);
      return EXIT.OK;
    }
    const cands = suggest.suggestSimilar(verb, Object.keys(nounSpec));
    err(`unknown command: ${noun} ${verb}`);
    if (cands.length) err(`Did you mean: ${cands.map((c) => `${noun} ${c}`).join(', ')}?`);
    err(`Run \`ccm ${noun} --help\` for the list of ${noun} commands.`);
    return EXIT.USAGE;
  }

  // hasOwnProperty 已保证 resolvedVerb 在 nounSpec·spec 必有值（窄断言·不改逻辑）。
  const spec: VerbSpec = nounSpec[resolvedVerb] as VerbSpec;

  // `ccm <noun> <verb> --help` → verb 级 help（用解析后的 canonical verb）。
  if (wantsHelp) {
    help.printHelp(out, { REGISTRY, ALIASES, NOUN_ALIASES }, nounStr, resolvedVerb);
    return EXIT.OK;
  }

  // ── ④ parseArgs：合并全局 + 命令 spec.options，喂 rest（去掉 noun/verb 两个位置 token）。───────────────
  //   rest = working 去掉 noun（indices[0]）与 verb（indices[1]）那两个位置 token，其余原序保留（含 flags + 后续 positionals）。
  const rest: string[] = [];
  const skip = new Set<number | undefined>([indices[0], indices[1]]);
  for (let i = 0; i < working.length; i++) {
    if (skip.has(i)) continue;
    rest.push(working[i] as string); // i < length·必有值（窄断言·不改逻辑）。
  }

  // 合并 options：命令 spec.options 优先（同名时命令 spec 覆盖全局，因命令 spec 可能带 enum/multiple/short）。
  const mergedOptions = Object.assign({}, GLOBAL_OPTIONS, spec.options || {});

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: rest,
      // mergedOptions 混了 router 的 ParseOption 与 registry 的 OptionSpec（同字段子集）·parseArgs 只读 type/short/multiple；
      //   窄断言为 parseArgs 期望的 options 形（不改逻辑·原 JS 直接喂同一合并对象）。
      options: mergedOptions as NonNullable<Parameters<typeof parseArgs>[0]>['options'],
      allowPositionals: true,
      strict: true,
      allowNegative: true,
    });
  } catch (e) {
    // ERR_PARSE_ARGS_*（未知 flag / 缺值 / 类型不符）→ 友好 stderr + USAGE。
    err(`usage error: ${friendlyParseError(e as KindedError)}`);
    err(`Run \`ccm ${noun} ${verb} --help\` for usage.`);
    return EXIT.USAGE;
  }

  const values = (parsed.values || {}) as Record<string, unknown>;
  const positionals = (parsed.positionals || []) as string[];

  // ── ⑤ 校验：required positionals + enum。────────────────────────────────────────────────────────
  const specPositionals = Array.isArray(spec.positionals) ? spec.positionals : [];
  for (let i = 0; i < specPositionals.length; i++) {
    const p = specPositionals[i];
    if (!p) continue; // 防御（noUncheckedIndexedAccess）：i < length 必有值。
    if (p.required && (positionals[i] === undefined || positionals[i] === '')) {
      err(`usage error: missing required argument <${p.name}> for \`ccm ${noun} ${verb}\``);
      err(`Run \`ccm ${noun} ${verb} --help\` for usage.`);
      return EXIT.USAGE;
    }
  }

  // required flags（spec.options[].required）。
  const opts2: Record<string, OptionSpec> = spec.options || {};
  for (const flag of Object.keys(opts2)) {
    const o = opts2[flag];
    if (!o) continue; // 防御（noUncheckedIndexedAccess）：遍历 keys 必有值。
    if (o.required && values[flag] === undefined) {
      err(`usage error: missing required flag --${flag} for \`ccm ${noun} ${verb}\``);
      err(`Run \`ccm ${noun} ${verb} --help\` for usage.`);
      return EXIT.USAGE;
    }
  }

  // enum 校验：spec.options[].enum 限定值集。multiple → 逐项校验。enum 是开放的（OPEN_ENUMS）时 board-model
  //   会在 lint 出 warn 而非 error；但 router 层校验只对**声明了 enum 的 flag**做硬拒（registry 已选定哪些闭集）。
  const enumErr = validateEnums(values, opts2);
  if (enumErr) {
    err(`usage error: ${enumErr}`);
    err(`Run \`ccm ${noun} ${verb} --help\` for usage.`);
    return EXIT.USAGE;
  }

  // ── ⑥ 建 ctx + 分发。────────────────────────────────────────────────────────────────────────────
  const ctx = buildCtx({ values, positionals, env, out, err, stdin, argv: working });

  const [hnoun, hkey] = String(spec.handler).split('.');
  // hnoun/hkey 是 split 结果（string | undefined）·下方 !handlerMod / typeof fn 守门已覆盖 undefined；
  //   索引处窄断言为 string（不改逻辑·原 JS 直接 require('./handlers/'+hnoun)[hkey]）。
  const handlerMod =
    (hnoun === 'orchestrator' || hnoun === 'route') && opts.shadowRoutingBoundary
      ? (shadowRoutingHandler.createShadowRoutingHandlers(
          opts.shadowRoutingBoundary,
        ) as unknown as HandlerModule)
      : HANDLERS[hnoun as string];
  if (!handlerMod) {
    err(`internal error: cannot load handler module for ${noun} (${hnoun})`);
    return EXIT.ERROR;
  }
  const fn = handlerMod[hkey as string];
  if (typeof fn !== 'function') {
    err(`internal error: handler ${spec.handler} is not a function`);
    return EXIT.ERROR;
  }

  // ── ⑦ 调 handler + catch throw 映射退出码。──────────────────────────────────────────────────────
  //   绝大多数 handler 全 sync 返回 number（run 同步返回·契约不变）。**唯一例外**：`account switch` 是 async
  //   （要 await refresh https·复用 @ccm/engine refreshBlob）——它返回 Promise<number>，此处透传成 Promise，
  //   由 bin/ccm.cjs await 后落 process.exitCode（sync 路径字节级不变·只多一条 thenable 分支）。
  try {
    const code = fn(ctx) as number | Promise<number>;
    if (code && typeof (code as { then?: unknown }).then === 'function') {
      return (code as Promise<number>).then(
        (c) => (typeof c === 'number' ? c : EXIT.OK),
        (e) => reportHandlerError(e as KindedError, err, ctx),
      );
    }
    return typeof code === 'number' ? code : EXIT.OK;
  } catch (e) {
    return reportHandlerError(e as KindedError, err, ctx);
  }
}

// ── buildCtx：组装 handler 契约要求的 ctx（契约 §三 ctx 形态）。────────────────────────────────────────
//   color 经 io.resolveColor（stream=out._stream||process.stdout）；sid 取 --session-id > selected harness session。
//   isTTY = io.isTTY(process.stdin)（rm 等破坏性 verb 据此要求 --yes）。
function buildCtx({
  values,
  positionals,
  env,
  out,
  err,
  stdin,
  argv,
}: {
  values: Record<string, unknown>;
  positionals: string[];
  env: Record<string, string | undefined>;
  out: RunOpts['out'];
  err: RunOpts['err'];
  stdin?: { fd?: number };
  argv: string[];
}): Ctx {
  const harnessFlag = typeof values.harness === 'string' ? values.harness : undefined;
  const sid =
    (values && (values['session-id'] as string)) || harnessSessionId({ env, harnessFlag }) || '';
  const stream = (out && out._stream) || process.stdout;
  const color = io.resolveColor({ stream, argv, env });

  const flags = {
    json: !!values.json,
    dryRun: !!values['dry-run'],
    force: !!values.force,
    yes: !!values.yes,
    quiet: !!values.quiet,
    verbose: !!values.verbose,
    color,
  };

  return {
    values,
    positionals,
    flags,
    sid,
    env,
    out,
    err,
    stdin,
    isTTY: io.isTTY(process.stdin),
  };
}

// ── validateEnums：对声明了 enum 的 flag 校验取值（multiple → 逐项）。返回错误串 或 null。──────────────
function validateEnums(
  values: Record<string, unknown>,
  options: Record<string, OptionSpec>,
): string | null {
  for (const flag of Object.keys(options)) {
    const o = options[flag];
    if (!o) continue; // 防御（noUncheckedIndexedAccess）：遍历 keys 必有值。
    if (!Array.isArray(o.enum)) continue;
    if (o.openEnum) continue; // 开放枚举（taskType·QA #2）：enum 仅作 help 建议，未知值不硬拒（交 lint FMT-TYPE warn）。
    if (values[flag] === undefined) continue;
    const vals = Array.isArray(values[flag]) ? (values[flag] as unknown[]) : [values[flag]];
    for (const v of vals) {
      if (typeof v === 'boolean') continue; // boolean flag 无 enum 语义（防御）
      if (!o.enum.includes(v as string)) {
        return `invalid value for --${flag}: ${JSON.stringify(v)} (must be one of: ${o.enum.join(', ')})`;
      }
    }
  }
  return null;
}

// ── friendlyParseError：把 node util.parseArgs 的 ERR_PARSE_ARGS_* 重写成可读句子。──────────────────────
function friendlyParseError(e: KindedError | null): string {
  if (!e) return 'failed to parse arguments';
  const code = e.code || '';
  const msg = e.message || String(e);
  switch (code) {
    case 'ERR_PARSE_ARGS_UNKNOWN_OPTION':
      return msg; // node 的 message 已含「Unknown option '--x'」且常带 did-you-mean
    case 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE':
      return msg; // 「Option '--x <value>' argument missing」之类
    case 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL':
      return msg;
    default:
      return msg;
  }
}

// ── reportHandlerError：按 .errKind / message 把 handler throw 映射成退出码 + 友好 stderr。────────────────
//   契约 §三 router ⑦：IllegalTransition/Validation→VALIDATION(3)、NotFound/Ambiguous→NOT_FOUND(5)、
//     message 含 LOCK_TIMEOUT→LOCKED(4)、Usage→USAGE(2)、else→ERROR(1)。router 不 process.exit（返回码）。
function reportHandlerError(e: KindedError, err: RunOpts['err'], ctx: Ctx): number {
  const kind = (e && (e.errKind || e.kind)) || '';
  const message = (e && e.message) || String(e);

  // JSON 模式：吐统一错误壳到 stderr（data 进 stdout / 诊断进 stderr·设计稿 §2）。
  const wantJson = ctx && ctx.flags && ctx.flags.json;

  let code: number;
  if (kind === 'IllegalTransition' || kind === 'Validation') {
    code = EXIT.VALIDATION;
  } else if (kind === 'NotFound' || kind === 'Ambiguous') {
    code = EXIT.NOT_FOUND;
  } else if (typeof message === 'string' && message.includes('LOCK_TIMEOUT')) {
    code = EXIT.LOCKED;
  } else if (kind === 'Usage') {
    code = EXIT.USAGE;
  } else {
    code = EXIT.ERROR;
  }

  if (wantJson) {
    err(io.jsonErr({ exit: code, error: message, violations: (e && e.violations) || [] }));
  } else {
    err(`error: ${message}`);
  }
  return code;
}
