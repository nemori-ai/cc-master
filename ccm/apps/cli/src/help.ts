// help.ts — `ccm --help` / `ccm <noun> --help` / `ccm <noun> <verb> --help` 的渲染层（技术栈契约 §二 help.js）。
//
// 定位：手拼 help（零 npm 依赖逼出·研究妥协表第 5 行）——把 registry 的 summary / positionals / options /
//   examples 渲染成三层帮助文本，再渲染 `--version`。router（P5.3）在 noun/verb 切分后据 `--help` / `--version`
//   调本模块；本模块**只产文本经 out 写出**，不 process.exit、不读 board、不碰任何状态（与 render.js 同纪律）。
//
// 三层（gh 式·例子优先·clig「lead with examples」）：
//   · printHelp(out, registry)              —— 无 noun：列全 namespace + 别名 + reserved + 全局 flag + 退出码。
//   · printHelp(out, registry, noun)        —— 有 noun：列该域 COMMANDS（verb summary）+ 例子。
//   · printHelp(out, registry, noun, verb)  —— 有 verb：该命令 USAGE / ARGUMENTS / FLAGS / EXAMPLES（从 spec 手拼）。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib（fs + path 仅 printVersion 用）。
// 武装闸豁免：纯渲染库（无 hook 入口，只被 router / CLI import）——见 AGENTS.md §3 红线6 / §12 grep 门豁免。
//
// T2a port 注：原 CJS 源（help.js）的 require('fs'/'path') 换成 ESM node import；module.exports 换成命名
//   导出；CJS 的 __dirname 由 import.meta.url 重建（ESM 无 __dirname 全局）。逻辑/文案逐字保持。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
// 直接复用 registry.ts 的 spec 类型（SSOT·避免 help 端再造一份易漂移的镜像类型）。
import type { NounSpec, OptionSpec, Registry, VerbSpec } from './registry.js';

// ESM 重建 __dirname（原 CJS 源直接用全局 __dirname；本文件位置 = apps/cli/src）。
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// out 写函数（router 注入 → stdout）。
type Out = (s: string) => void;

type Reg = Registry;
type Aliases = Record<string, [string, string]>;
// 容忍传整模块（{ REGISTRY, ALIASES }）或裸 REGISTRY。
interface RegistryModule {
  REGISTRY?: Reg;
  ALIASES?: Aliases;
  // 容忍整模块命名空间（含 WRITABLE_FIELDS_COVERED / 类型导出等额外成员）也能当 registry 传入。
  [k: string]: unknown;
}

// ── 全局 flag（DRY：只在顶层列一次·help 草稿 §0；各命令末尾以 GLOBAL FLAGS 一行带过）────────────────
//   与 help 草稿 §0 GLOBAL FLAGS 逐字段对齐。short 在前缀里手标（parseArgs 的 short 在 registry 不覆盖全局）。
const GLOBAL_FLAGS: [string, string][] = [
  ['    --board <path>', '指定 board 文件（最高优先）'],
  ['    --session-id <id>', '指定 session（特权调用者注入；默认读 $CLAUDE_CODE_SESSION_ID）'],
  [
    '    --home <dir>',
    '指定 cc-master home（默认 $CC_MASTER_HOME → CLAUDE_PROJECT_DIR → 向上 walk）',
  ],
  ['    --goal <substr>', '多 active 板时按 goal 子串消歧'],
  ['    --json', '机器可读 JSON 输出（非 TTY 时默认开）'],
  ['-n, --dry-run', '预览：跑完整校验但不落盘'],
  ['-f, --force', '越过 hard error / 非法状态转移闸（记 log）'],
  ['-y, --yes', '跳过破坏性操作的确认（非交互）'],
  ['-q, --quiet', '只出错误'],
  ['-v, --verbose', '详细输出（诊断走 stderr）'],
  ['    --no-color', '禁用颜色（亦遵循 NO_COLOR / 非 TTY / TERM=dumb）'],
  ['    --no-input', '绝不交互提示（脚本 / agent 模式）'],
  ['    --set <p>=<v>', '通用设 ✎ 标量字段（仅写命令；🔒 字段不可）'],
  ['    --set-json <p>=<j>', '通用设 ✎ 对象/数组（仅写命令；兜长尾 + 前向兼容）'],
  ['-h, --help', '显示帮助'],
  ['    --version', '显示版本'],
];

// ── EXIT CODES 一行（顶层全集；命令级只 hint「见 ccm --help」对齐 DRY）──────────────────────────────
const EXIT_LINE = '  0 成功 · 1 未预期错 · 2 用法错 · 3 校验拒绝 · 4 锁超时 · 5 无 active board';

// ── 顶层 namespace / 别名 / reserved 文案（help 草稿 §0；reserved 是占位·暂未实现）─────────────────────
const RESERVED: [string, string][] = [
  ['account', '换号号池机制（skill C 收口）'],
  ['estimate', '运筹学 / ML 估算引擎（用时 / 关键路径 / 配速）'],
  ['usage', '用量配速（usage-pacing 收口）'],
];

// ── printHelp(out, registry, noun?, verb?) ────────────────────────────────────────────────────────
//   out 是 (s)=>void 写函数（router 注入 → stdout）。registry = REGISTRY（noun→verb→spec）+ 同模块的 ALIASES。
//   noun / verb 缺省决定层级。未知 noun / verb 不在此处兜（router 在切分时已 suggestSimilar + exit2）——
//     本函数只在 registry 命中的前提下渲染；防御性地：若给了未知 noun/verb，降级到上一层（不崩）。
export function printHelp(
  out: Out,
  registry: Reg | RegistryModule,
  noun?: string,
  verb?: string,
): void {
  const mod = registry as RegistryModule;
  const reg = mod && mod.REGISTRY ? mod.REGISTRY : (registry as Reg); // 容忍传整模块或裸 REGISTRY
  const aliases = mod && mod.ALIASES ? mod.ALIASES : {};

  if (!noun || !reg[noun]) {
    out(_topLevel(reg, aliases));
    return;
  }
  if (!verb || !reg[noun][verb]) {
    out(_nounLevel(reg, noun));
    return;
  }
  out(_verbLevel(reg, noun, verb));
}

// ── 顶层（无 noun）────────────────────────────────────────────────────────────────────────────────
function _topLevel(reg: Reg, aliases: Aliases): string {
  const lines: string[] = [];
  lines.push('ccm —— cc-master board 命令行（数据模型 SSOT 的唯一写入关卡）');
  lines.push('');
  lines.push('USAGE');
  lines.push('  ccm <namespace> <command> [args] [flags]');
  lines.push('  ccm <alias> [args] [flags]');
  lines.push('');
  lines.push('CORE NAMESPACES');
  for (const noun of Object.keys(reg)) {
    lines.push(`  ${_padRight(noun, 12)}${_namespaceBlurb(noun)}`);
  }
  // ALIASES：alias → [noun, verb]，渲染成 ccm <noun> <verb>。
  const aliasKeys = Object.keys(aliases || {});
  if (aliasKeys.length) {
    lines.push('');
    lines.push('ALIASES (热路径捷径)');
    for (const a of aliasKeys) {
      // a 源自 Object.keys(aliases)·必命中（as 窄断言·不改逻辑）。
      const [n, v] = aliases[a] as [string, string];
      lines.push(`  ${_padRight(a, 12)}↔ ccm ${n} ${v}`);
    }
  }
  lines.push('');
  lines.push('RESERVED (占位·暂未实现)');
  for (const [name, desc] of RESERVED) {
    lines.push(`  ${_padRight(name, 12)}${desc}`);
  }
  lines.push('');
  lines.push('LEARN MORE');
  lines.push('  ccm <namespace> --help        看某域的命令清单');
  lines.push('  ccm <namespace> <cmd> --help  看某命令的用法 + 例子');
  lines.push('');
  lines.push(_globalFlagsBlock());
  lines.push('');
  lines.push('EXIT CODES');
  lines.push(EXIT_LINE);
  return lines.join('\n');
}

// namespace 一行简述（help 草稿 §0 CORE NAMESPACES）。未知 noun → 用其首个 verb 的 summary 兜底。
function _namespaceBlurb(noun: string): string {
  const M: Record<string, string> = {
    board: '板级：查看 / 校验 / DAG 分析 / 建板 / 改配置',
    task: '任务：增删改查 + 状态机（DAG 节点）',
    log: 'append-only 审计轨迹',
    jc: 'judgment_calls 自决诚实台账',
    cadence: '节奏 / iteration 收口',
    watchdog: '自我唤醒 watchdog（ADR-011）',
  };
  return M[noun] || '';
}

// ── noun 层（有 noun 无 verb）：列该域 COMMANDS（verb summary）+ 例子 ────────────────────────────────
function _nounLevel(reg: Reg, noun: string): string {
  // printHelp 已确认 reg[noun] 存在才进本函数（as 窄断言·不改逻辑）。
  const verbs = reg[noun] as NounSpec;
  const lines: string[] = [];
  lines.push(`ccm ${noun} —— ${_namespaceBlurb(noun)}`);
  lines.push('');
  lines.push('USAGE');
  lines.push(`  ccm ${noun} <command> [args] [flags]`);
  lines.push('');
  lines.push('COMMANDS');
  // verb 名列宽 = 各 verb 名最长（+ 别名标记 ls）。
  const verbNames = Object.keys(verbs);
  const aliasMark: Record<string, string> = { list: ' (ls)' };
  const labels = verbNames.map((v) => v + (aliasMark[v] || ''));
  const w = Math.max(...labels.map((l) => l.length), 4) + 2;
  for (let i = 0; i < verbNames.length; i++) {
    // labels[i]/verbNames[i] 由 i<length 在界内；verbs[verbNames[i]] 必命中（as 窄断言·不改逻辑）。
    lines.push(
      '  ' +
        _padRight(labels[i] as string, w) +
        (verbs[verbNames[i] as string] as VerbSpec).summary,
    );
  }
  // 例子：取该域各 verb 的首例（最多 3 条·别淹没）。
  const examples: string[] = [];
  for (const v of verbNames) {
    const ex = (verbs[v] as VerbSpec).examples;
    if (Array.isArray(ex) && ex.length) examples.push(ex[0] as string);
    if (examples.length >= 3) break;
  }
  if (examples.length) {
    lines.push('');
    lines.push('EXAMPLES');
    for (const e of examples) lines.push(`  $ ${e}`);
  }
  lines.push('');
  lines.push('GLOBAL FLAGS  见 ccm --help');
  return lines.join('\n');
}

// ── verb 层（有 verb）：USAGE / ARGUMENTS / FLAGS / EXAMPLES（从 spec 手拼·例子优先）────────────────────
function _verbLevel(reg: Reg, noun: string, verb: string): string {
  // printHelp 已确认 reg[noun][verb] 存在才进本函数（as 窄断言·不改逻辑）。
  const spec = (reg[noun] as NounSpec)[verb] as VerbSpec;
  const lines: string[] = [];
  lines.push(`ccm ${noun} ${verb} —— ${spec.summary}`);
  lines.push('');

  // USAGE：noun verb + 必填 positional <name> + 必填 flag --x <…> + [flags]。
  lines.push('USAGE');
  lines.push(`  ${_usageLine(noun, verb, spec)}`);

  // ARGUMENTS：positionals（有则列）。
  const positionals = Array.isArray(spec.positionals) ? spec.positionals : [];
  if (positionals.length) {
    lines.push('');
    lines.push('ARGUMENTS');
    const w = Math.max(...positionals.map((p) => `<${p.name}>`.length), 4) + 2;
    for (const p of positionals) {
      const tag = `<${p.name}>`;
      const req = p.required ? '（必填）' : '（可选）';
      lines.push(`  ${_padRight(tag, w)}${req}`);
    }
  }

  // FLAGS：本命令专属 options（含 enum / required / multiple 标注）。--json / --log 也照列（它们是真 option）。
  const options = spec.options || {};
  const flagNames = Object.keys(options);
  if (flagNames.length) {
    lines.push('');
    lines.push('FLAGS');
    const rows = flagNames.map((f): [string, string] => [
      // f 源自 Object.keys(options)·options[f] 必命中（as 窄断言·不改逻辑）。
      _flagLabel(f, options[f] as OptionSpec),
      _flagDesc(options[f] as OptionSpec),
    ]);
    const w = Math.max(...rows.map((r) => r[0].length), 4) + 2;
    for (const [label, desc] of rows) {
      lines.push(`  ${_padRight(label, w)}${desc}`);
    }
  }

  // EXAMPLES（例子优先·已在 USAGE 后；clig 实际把例子放显眼处——此处放在 FLAGS 后对齐 gh `--help` 视觉序）。
  const examples = Array.isArray(spec.examples) ? spec.examples : [];
  if (examples.length) {
    lines.push('');
    lines.push('EXAMPLES');
    for (const e of examples) lines.push(`  $ ${e}`);
  }

  lines.push('');
  lines.push('GLOBAL FLAGS  见 ccm --help');
  return lines.join('\n');
}

// _usageLine：ccm <noun> <verb> <reqPositional…> --<reqFlag> <…> [flags]。
function _usageLine(noun: string, verb: string, spec: VerbSpec): string {
  const parts = ['ccm', noun, verb];
  for (const p of spec.positionals || []) {
    parts.push(p.required ? `<${p.name}>` : `[${p.name}]`);
  }
  const options = spec.options || {};
  for (const f of Object.keys(options)) {
    // f 源自 Object.keys(options)·options[f] 必命中（as 窄断言·不改逻辑）。
    const o = options[f] as OptionSpec;
    if (o.required) {
      parts.push(`--${f}${o.type === 'boolean' ? '' : ` <${_argMeta(f, o)}>`}`);
    }
  }
  parts.push('[flags]');
  return parts.join(' ');
}

// _flagLabel：--<flag> [<argmeta>]（boolean 无 argmeta）。
function _flagLabel(flag: string, o: OptionSpec): string {
  if (o.type === 'boolean') return `--${flag}`;
  return `--${flag} <${_argMeta(flag, o)}>`;
}

// _argMeta：flag 取值的占位符——enum → enum|enum、transform 决定 dur/kind:ref/path=val 等、否则 str。
function _argMeta(_flag: string, o: OptionSpec): string {
  if (Array.isArray(o.enum)) {
    // enum 列全 vs 'enum' 占位：按**拼接后字符长度**判（避免长 enum 撑爆 FLAGS 列对齐）。
    const joined = o.enum.join('|');
    return joined.length > 28 ? 'enum' : joined;
  }
  switch (o.transform) {
    case 'duration':
      return 'dur';
    case 'csv':
      return 'a,b';
    case 'ref':
      return 'kind:ref';
    case 'input':
      return 'str|@file';
    case 'kv':
      return 'path=val';
    case 'json':
      return 'path=json';
    default:
      return 'str';
  }
}

// _flagDesc：desc + （必填）/（可重复）标注；标注与 desc 内容去重（registry desc 已含「可重复」时不再叠加）。
function _flagDesc(o: OptionSpec): string {
  const d = o.desc || '';
  const tags: string[] = [];
  if (o.required && !d.includes('必填')) tags.push('必填');
  if (o.multiple && !d.includes('可重复')) tags.push('可重复');
  if (tags.length) return `${d}（${tags.join('·')}）`;
  return d;
}

// _globalFlagsBlock：GLOBAL FLAGS 段（顶层一次性·DRY）。
function _globalFlagsBlock(): string {
  const lines = ['GLOBAL FLAGS'];
  const w = Math.max(...GLOBAL_FLAGS.map((r) => r[0].length)) + 2;
  for (const [label, desc] of GLOBAL_FLAGS) {
    lines.push(`  ${_padRight(label, w)}${desc}`);
  }
  return lines.join('\n');
}

// 右补空格（去 ANSI 不需要——help 文本无色）。
function _padRight(s: string, width: number): string {
  const str = String(s);
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
}

// ── printVersion(out) ─────────────────────────────────────────────────────────────────────────────
//   读 cli/package.json 的 version；缺时 fallback 到根 .claude-plugin/plugin.json。
//   两者都缺 → '0.0.0'（不崩）。输出 GNU 格式 'ccm <ver>'（版本号在末空格后·便于脚本解析）。
export function printVersion(out: Out): void {
  out(`ccm ${_readVersion()}`);
}

// _readVersion：process.env.CCM_VERSION → cli/package.json → .claude-plugin/plugin.json → '0.0.0'。
//   __dirname = apps/cli/src；package.json 在 apps/cli/（上一级）；plugin.json 在更上层 .claude-plugin（fallback）。
//   CCM_VERSION 优先：SEA blob 内 __dirname 不指向 apps/cli/，相对 package.json 读会落空 → '0.0.0'；
//   故 SEA 入口（src/sea.ts）构建期把版本号注入 env.CCM_VERSION（见 ADR-014·T3）。非 SEA 路径不设该 env，行为不变。
function _readVersion(): string {
  const envVer = typeof process.env.CCM_VERSION === 'string' ? process.env.CCM_VERSION.trim() : '';
  if (envVer) return envVer;
  const candidates = [
    path.join(__dirname, '..', 'package.json'), // apps/cli/package.json
    path.join(__dirname, '..', '..', '.claude-plugin', 'plugin.json'), // 上层 plugin.json（fallback）
  ];
  for (const p of candidates) {
    try {
      const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (obj && typeof obj.version === 'string' && obj.version) return obj.version;
    } catch (_e) {
      /* 缺文件 / 坏 JSON → 试下一个候选 */
    }
  }
  return '0.0.0';
}
