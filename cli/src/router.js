'use strict';
// router.js — ccm CLI 集成路由层（P5.3·契约 §三 router.js / §四阶段表）。
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
//   ⑥ 建 ctx → 由 spec.handler 字符串（'task.setStatus'）split('.') → require('./handlers/'+hnoun)[hkey](ctx)。
//   ⑦ catch handler throw：按 .errKind 映射 EXIT（IllegalTransition/Validation→VALIDATION、NotFound/Ambiguous→
//      NOT_FOUND、message 含 LOCK_TIMEOUT→LOCKED、Usage→USAGE、else→ERROR）；友好 err 输出。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib（node:util.parseArgs）。CommonJS。
// 武装闸豁免：纯路由库（无 hook 入口，只被 bin/ccm.js require）——见 AGENTS.md §3 红线6 / §12 grep 门豁免。

const { parseArgs } = require('node:util');
const path = require('node:path');

const io = require('./io.js');
const help = require('./help.js');
const suggest = require('./suggest.js');
const { REGISTRY, ALIASES } = require('./registry.js');

const EXIT = io.EXIT;

// ── 全局 flag spec：每个命令都隐式接受这些（与命令专属 options 合并喂 parseArgs）。──────────────────────
//   与 help.js GLOBAL_FLAGS / 设计稿 §4 全局 flag 对齐。short 在此声明（parseArgs 的 short）。
//   注意：--json / --force 等若命令 spec.options 已声明（如各 read verb 的 json），合并时命令 spec 优先（不覆盖）。
const GLOBAL_OPTIONS = {
  board: { type: 'string' },
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
const GLOBAL_VALUE_FLAGS = (function () {
  const longs = new Set();
  const shorts = new Set();
  for (const name of Object.keys(GLOBAL_OPTIONS)) {
    const o = GLOBAL_OPTIONS[name];
    if (o.type === 'string') {
      longs.add('--' + name);
      if (o.short) shorts.add('-' + o.short);
    }
  }
  return { longs, shorts };
})();

// scanPositions(tokens) → { positionals:[{token,index}], hasHelp, hasVersion }。
//   flag-aware 扫描：跳过全局 string-flag 的值 token；`--k=v` 内联形不消耗下一个；`--` 之后全当 positional。
//   只需正确认出 noun/verb 两个 positional；命令专属 flag 的精确 arity 由其后真正的 parseArgs 负责。
function scanPositions(tokens) {
  const positionals = [];
  let hasHelp = false;
  let hasVersion = false;
  let afterDoubleDash = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (afterDoubleDash) { positionals.push({ token: t, index: i }); continue; }
    if (t === '--') { afterDoubleDash = true; continue; }
    if (t === '--help' || t === '-h') { hasHelp = true; continue; }
    if (t === '--version' || t === '-V') { hasVersion = true; continue; }
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

// ── run(argv, {out, err, env, stdin}) → exitCode ──────────────────────────────────────────────────
function run(argv, opts = {}) {
  const out = opts.out;
  const err = opts.err;
  const env = opts.env || {};
  const stdin = opts.stdin;
  const args = Array.isArray(argv) ? argv.slice() : [];

  // ── ① 先 flag-aware 扫一遍认出 noun/verb 与顶层 --help/--version（防 `--session-id X` 的 X 被误当 noun）。──
  const scan0 = scanPositions(args);

  if (scan0.positionals.length === 0) {
    // 无 noun：纯 flag（或空）。--version / -V → 版本；其余（含 --help/-h/空）→ 顶层帮助。
    if (scan0.hasVersion) {
      help.printVersion(out);
      return EXIT.OK;
    }
    help.printHelp(out, { REGISTRY, ALIASES });
    return EXIT.OK;
  }

  // ── ② ALIASES 展开：首个 positional 若是 alias → 在原位替换成 [noun, verb]。────────────────────────────
  let working = args;
  {
    const first = scan0.positionals[0];
    if (Object.prototype.hasOwnProperty.call(ALIASES, first.token)) {
      const expansion = ALIASES[first.token]; // [noun, verb]
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
  if (!Object.prototype.hasOwnProperty.call(REGISTRY, noun)) {
    const cands = suggest.suggestSimilar(noun, Object.keys(REGISTRY));
    err(`unknown command: ${noun}`);
    if (cands.length) err(`Did you mean: ${cands.join(', ')}?`);
    err(`Run \`ccm --help\` for the list of commands.`);
    return EXIT.USAGE;
  }

  // `ccm <noun> --help`（无 verb 或 wantsHelp 且 verb 未知）。
  if (!verb) {
    if (wantsHelp) {
      help.printHelp(out, { REGISTRY, ALIASES }, noun);
      return EXIT.OK;
    }
    // 缺 verb：列该 noun 的 verbs 当候选（无输入可纠错，直接列全集）。
    err(`missing command for: ${noun}`);
    err(`Available: ${Object.keys(REGISTRY[noun]).join(', ')}`);
    err(`Run \`ccm ${noun} --help\` for details.`);
    return EXIT.USAGE;
  }

  // ── verb 级别名解析（如 `ccm task ls` → `task list`）。──────────────────────────────────────────────
  //   ALIASES 里形如 `ls:['task','list']` 的条目同时是「verb 级别名」——当 verb 不是 noun 的真 verb，但等于某个
  //   ALIASES key 且该 alias 的 noun 段 === 当前 noun，则把 verb 解析成 alias 的 verb 段（registry §3.2 ls 注释）。
  let resolvedVerb = verb;
  if (!Object.prototype.hasOwnProperty.call(REGISTRY[noun], resolvedVerb)
      && Object.prototype.hasOwnProperty.call(ALIASES, verb)
      && Array.isArray(ALIASES[verb]) && ALIASES[verb][0] === noun) {
    resolvedVerb = ALIASES[verb][1];
  }

  // ── verb 校验。──────────────────────────────────────────────────────────────────────────────────
  if (!Object.prototype.hasOwnProperty.call(REGISTRY[noun], resolvedVerb)) {
    // `ccm <noun> <unknown> --help` → 降级到 noun 级 help（help.js 容忍未知 verb）。
    if (wantsHelp) {
      help.printHelp(out, { REGISTRY, ALIASES }, noun);
      return EXIT.OK;
    }
    const cands = suggest.suggestSimilar(verb, Object.keys(REGISTRY[noun]));
    err(`unknown command: ${noun} ${verb}`);
    if (cands.length) err(`Did you mean: ${cands.map((c) => noun + ' ' + c).join(', ')}?`);
    err(`Run \`ccm ${noun} --help\` for the list of ${noun} commands.`);
    return EXIT.USAGE;
  }

  const spec = REGISTRY[noun][resolvedVerb];

  // `ccm <noun> <verb> --help` → verb 级 help（用解析后的 canonical verb）。
  if (wantsHelp) {
    help.printHelp(out, { REGISTRY, ALIASES }, noun, resolvedVerb);
    return EXIT.OK;
  }

  // ── ④ parseArgs：合并全局 + 命令 spec.options，喂 rest（去掉 noun/verb 两个位置 token）。───────────────
  //   rest = working 去掉 noun（indices[0]）与 verb（indices[1]）那两个位置 token，其余原序保留（含 flags + 后续 positionals）。
  const rest = [];
  const skip = new Set([indices[0], indices[1]]);
  for (let i = 0; i < working.length; i++) {
    if (skip.has(i)) continue;
    rest.push(working[i]);
  }

  // 合并 options：命令 spec.options 优先（同名时命令 spec 覆盖全局，因命令 spec 可能带 enum/multiple/short）。
  const mergedOptions = Object.assign({}, GLOBAL_OPTIONS, spec.options || {});

  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      options: mergedOptions,
      allowPositionals: true,
      strict: true,
      allowNegative: true,
    });
  } catch (e) {
    // ERR_PARSE_ARGS_*（未知 flag / 缺值 / 类型不符）→ 友好 stderr + USAGE。
    err(`usage error: ${friendlyParseError(e, noun, verb)}`);
    err(`Run \`ccm ${noun} ${verb} --help\` for usage.`);
    return EXIT.USAGE;
  }

  const values = parsed.values || {};
  const positionals = parsed.positionals || [];

  // ── ⑤ 校验：required positionals + enum。────────────────────────────────────────────────────────
  const specPositionals = Array.isArray(spec.positionals) ? spec.positionals : [];
  for (let i = 0; i < specPositionals.length; i++) {
    const p = specPositionals[i];
    if (p.required && (positionals[i] === undefined || positionals[i] === '')) {
      err(`usage error: missing required argument <${p.name}> for \`ccm ${noun} ${verb}\``);
      err(`Run \`ccm ${noun} ${verb} --help\` for usage.`);
      return EXIT.USAGE;
    }
  }

  // required flags（spec.options[].required）。
  const opts2 = spec.options || {};
  for (const flag of Object.keys(opts2)) {
    const o = opts2[flag];
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
  let handlerMod;
  try {
    handlerMod = require('./handlers/' + hnoun + '.js');
  } catch (e) {
    err(`internal error: cannot load handler module for ${noun} (${hnoun}): ${e && e.message}`);
    return EXIT.ERROR;
  }
  const fn = handlerMod && handlerMod[hkey];
  if (typeof fn !== 'function') {
    err(`internal error: handler ${spec.handler} is not a function`);
    return EXIT.ERROR;
  }

  // ── ⑦ 调 handler + catch throw 映射退出码。──────────────────────────────────────────────────────
  try {
    const code = fn(ctx);
    return typeof code === 'number' ? code : EXIT.OK;
  } catch (e) {
    return reportHandlerError(e, err, ctx);
  }
}

// ── buildCtx：组装 handler 契约要求的 ctx（契约 §三 ctx 形态）。────────────────────────────────────────
//   color 经 io.resolveColor（stream=out._stream||process.stdout）；sid 取 --session-id > $CLAUDE_CODE_SESSION_ID。
//   isTTY = io.isTTY(process.stdin)（rm 等破坏性 verb 据此要求 --yes）。
function buildCtx({ values, positionals, env, out, err, stdin, argv }) {
  const sid = (values && values['session-id']) || env.CLAUDE_CODE_SESSION_ID || '';
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
function validateEnums(values, options) {
  for (const flag of Object.keys(options)) {
    const o = options[flag];
    if (!Array.isArray(o.enum)) continue;
    if (values[flag] === undefined) continue;
    const vals = Array.isArray(values[flag]) ? values[flag] : [values[flag]];
    for (const v of vals) {
      if (typeof v === 'boolean') continue; // boolean flag 无 enum 语义（防御）
      if (!o.enum.includes(v)) {
        return `invalid value for --${flag}: ${JSON.stringify(v)} (must be one of: ${o.enum.join(', ')})`;
      }
    }
  }
  return null;
}

// ── friendlyParseError：把 node util.parseArgs 的 ERR_PARSE_ARGS_* 重写成可读句子。──────────────────────
function friendlyParseError(e) {
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
function reportHandlerError(e, err, ctx) {
  const kind = (e && (e.errKind || e.kind)) || '';
  const message = (e && e.message) || String(e);

  // JSON 模式：吐统一错误壳到 stderr（data 进 stdout / 诊断进 stderr·设计稿 §2）。
  const wantJson = ctx && ctx.flags && ctx.flags.json;

  let code;
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

module.exports = { run };
