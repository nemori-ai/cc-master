#!/usr/bin/env node
/**
 * Track A —— skill 触发准确率测量装置。
 *
 * ## 为什么不用 skill-creator 的 run_eval
 *
 * 它把被测 skill 写成 `.claude/commands/<name>.md`（一个 slash command），再跑 `claude -p`
 * 指望自然语言 query 自动触发它。实测（2026-08-04）：**不会触发**。同一条 query、同一份
 * description，装成 `.claude/skills/<name>/SKILL.md` 则稳定触发。
 *
 * 那个装置因此对每一条 query 都判"未触发"，产出一份格式完整、正例触发率恒为 0 的报告——
 * 看起来像"description 太差"，实则它测的东西和它想测的东西不是一回事。而 run_eval 住在
 * 插件缓存里（`~/.claude/plugins/cache/...`），改了会被插件更新冲掉。故自研。
 *
 * ## 这个装置对自己的三条要求（全部来自踩过的坑）
 *
 * 1. **装置自检先于测量。** 每轮开跑前先用一条保证触发的 canary query 验证装置活着；canary
 *    不触发就 abort，绝不进入全量。没有这一步，"零触发"永远分不清是 description 差还是
 *    装置坏——那正是上一版浪费掉一整轮配额的原因。
 * 2. **任何 spawn 失败都是硬失败。** 不 Warning、不跳过、不用残缺分母算准确率。一次调用
 *    起不来，这份报告的分母就是脏的。
 * 3. **不写死 PATH 上的 claude。** fnm 装的 claude 在 PATH 里指向
 *    /run/user/<uid>/fnm_multishells/<pid>_<ts>/bin/claude —— 那是跟 shell session 绑定的
 *    临时目录，长跑期间会塌。一律解引用到稳定真实路径。
 *
 * ## 用法
 *
 *   node scripts/eval-trigger.mjs <skill-name> [--runs N] [--limit N] [--json <out>]
 *
 *   --runs   每条 query 重复次数（默认 3，抗随机性）
 *   --limit  只跑前 N 条 query（小样本验证装置用，别拿它当 baseline）
 *   --json   把完整结果写到文件
 *
 * 认证：复用 `claude` CLI 的登录态，**不需要 API key**；消耗的是订阅配额。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── 参数 ────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const skillName = argv.find((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
if (!skillName) {
  console.error('usage: eval-trigger.mjs <skill-name> [--runs N] [--limit N] [--json <out>]');
  process.exit(2);
}
const RUNS = Number(flag('runs', '3'));
const LIMIT = flag('limit', null) ? Number(flag('limit')) : null;
const JSON_OUT = flag('json', null);

// ── 解析 claude 到稳定真实路径（见头部第 3 条）────────────────────────────────────────────
function resolveClaude() {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) {
    const candidate = path.join(d, 'claude');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.realpathSync(candidate);
    } catch {
      /* keep looking */
    }
  }
  return null;
}
const CLAUDE = resolveClaude();
if (!CLAUDE) {
  console.error('eval-trigger: claude not found on PATH — Track A needs the claude CLI');
  process.exit(1);
}

// ── 语料与被测 skill ────────────────────────────────────────────────────────────────────────
const evalSet = path.join(REPO, 'plugin/src/skills', skillName, 'evals/trigger.json');
const canonical = path.join(REPO, 'plugin/src/skills', skillName, 'canonical');
for (const [p, what] of [[evalSet, 'eval set'], [path.join(canonical, 'SKILL.md'), 'SKILL.md']]) {
  if (!fs.existsSync(p)) {
    console.error(`eval-trigger: no ${what} at ${p}`);
    process.exit(1);
  }
}
const raw = JSON.parse(fs.readFileSync(evalSet, 'utf8'));
let queries = (Array.isArray(raw) ? raw : Object.values(raw)).filter((q) => q && q.query);
if (LIMIT) queries = queries.slice(0, LIMIT);

// ── 临时项目：把被测 skill 装成**真 skill**（这是与 run_eval 的关键差异）──────────────────
const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-trigger-'));
const skillDir = path.join(projectRoot, '.claude/skills', skillName);
fs.mkdirSync(skillDir, { recursive: true });
fs.cpSync(canonical, skillDir, { recursive: true });
process.on('exit', () => fs.rmSync(projectRoot, { recursive: true, force: true }));

const QUERY_TIMEOUT_MS = 240_000;

/**
 * 跑一条 query。返回 `{ triggered }` 或 `{ error }`。
 *
 * **两类失败必须分开，这是这个装置最容易写错的地方。** 初版把它们混为一谈——任何异常都
 * 抛出去让整批 abort，结果一条 query 超时就废掉了已经跑完的 23/28。那是从"静默吞错误给
 * 假数据"这个极端，跳到了"给不出数据"的另一个极端，两个都错。
 *
 *   spawn 起不来 / 进程报错  → 装置坏了，整批分母都脏 → 抛，硬失败
 *   单条 query 超时          → 只是这一条慢，其余数据完好 → 记 error，剔出分母，继续
 *
 * 判据是「这次失败是否污染了别的条目」。污染了才有资格中止全批。
 */
function runQuery(query) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE; // 允许在 Claude Code 会话内嵌套 claude -p
    const child = spawn(
      CLAUDE,
      ['-p', query, '--output-format', 'stream-json', '--verbose', '--include-partial-messages'],
      { cwd: projectRoot, env, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let buf = '';
    let triggered = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, QUERY_TIMEOUT_MS);
    child.stdout.on('data', (c) => {
      buf += c.toString('utf8');
      // 触发信号：流里出现被测 skill 的名字（Skill 工具的入参或工具名）
      if (!triggered && buf.includes(skillName)) triggered = true;
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e); // 装置级：claude 根本起不来
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        // 超时前若已观察到触发信号，那个信号是真的，照收
        resolve(triggered ? { triggered: true } : { error: 'timeout' });
        return;
      }
      if (code !== 0 && buf.length === 0) {
        reject(new Error(`claude exited ${code} with no output`)); // 装置级
        return;
      }
      resolve({ triggered });
    });
  });
}

/** 只关心是否触发的场合（canary）。装置级失败仍会抛。 */
async function didTrigger(query) {
  const r = await runQuery(query);
  return r.triggered === true;
}

// ── 装置自检（见头部第 1 条）───────────────────────────────────────────────────────────────
// canary 取语料里第一条 should_trigger=true 的 query。它若不触发，要么装置坏了，要么这个
// skill 连自己最典型的正例都接不住 —— 两种都不该继续烧配额跑全量，先让人来看。
const canary = queries.find((q) => q.should_trigger === true);
if (!canary) {
  console.error('eval-trigger: 语料里没有 should_trigger=true 的 query，无法自检');
  process.exit(1);
}
process.stderr.write(`[self-check] canary: ${canary.query.slice(0, 46)}…\n`);
let canaryOk = false;
try {
  canaryOk = await didTrigger(canary.query);
} catch (e) {
  console.error(`eval-trigger: ABORT — 装置自检时调用失败：${e.message}`);
  process.exit(1);
}
if (!canaryOk) {
  console.error(
    'eval-trigger: ABORT — canary 正例未触发。装置或 description 有一个是坏的，先查清再跑全量，\n' +
      '不要拿一份"全零"报告当 baseline（上一版装置就是这么产出假数据的）。',
  );
  process.exit(1);
}
process.stderr.write('[self-check] OK —— 装置能触发，进入全量\n\n');

// ── 全量 ────────────────────────────────────────────────────────────────────────────────────
const results = [];
for (const [i, q] of queries.entries()) {
  let hits = 0;
  let ok = 0;
  let errs = 0;
  for (let r = 0; r < RUNS; r += 1) {
    const res = await runQuery(q.query); // 装置级失败仍会抛出，整批中止
    if (res.error) errs += 1;
    else {
      ok += 1;
      hits += res.triggered ? 1 : 0;
    }
  }
  // 一条 query 的全部 run 都超时 → 它没有可用观测，剔出分母而不是猜一个值
  if (ok === 0) {
    results.push({
      query: q.query,
      should_trigger: q.should_trigger === true,
      error: 'timeout',
      counted: false,
    });
    process.stderr.write(
      `[${String(i + 1).padStart(3)}/${queries.length}] 超时(剔出分母) ${q.query.slice(0, 34)}…\n`,
    );
    continue;
  }
  const rate = hits / ok;
  const predicted = rate >= 0.5;
  results.push({
    query: q.query,
    should_trigger: q.should_trigger === true,
    trigger_rate: rate,
    predicted,
    pass: predicted === (q.should_trigger === true),
    counted: true,
    ...(errs ? { partial_timeouts: errs } : {}),
  });
  process.stderr.write(
    `[${String(i + 1).padStart(3)}/${queries.length}] ${predicted ? '触发' : '未触发'} ` +
      `(期望 ${q.should_trigger ? '触发' : '未触发'}) ${q.query.slice(0, 36)}…\n`,
  );
}

// ── 统计 ────────────────────────────────────────────────────────────────────────────────────
const counted = results.filter((r) => r.counted);
const dropped = results.filter((r) => !r.counted);
const tp = counted.filter((r) => r.should_trigger && r.predicted).length;
const fp = counted.filter((r) => !r.should_trigger && r.predicted).length;
const fn = counted.filter((r) => r.should_trigger && !r.predicted).length;
const tn = counted.filter((r) => !r.should_trigger && !r.predicted).length;
const ratio = (a, b) => (b === 0 ? null : Number((a / b).toFixed(4)));
// 分母诚实：准确率永远相对 counted 而非 total。超时条目单列，不摊进任何一格。
const dropRate = results.length ? dropped.length / results.length : 0;
const summary = {
  skill: skillName,
  runs_per_query: RUNS,
  total_queries: results.length,
  counted: counted.length,
  dropped_timeout: dropped.length,
  tp, fp, fn, tn,
  precision: ratio(tp, tp + fp),
  recall: ratio(tp, tp + fn),
  accuracy: ratio(tp + tn, counted.length),
  // 掉太多就别假装这是一份可比的 baseline —— 分母都不一样了，跨版本对比会骗人
  reliability: dropRate > 0.2 ? 'degraded' : 'ok',
  self_check: 'passed',
  claude_binary: CLAUDE,
};
if (summary.reliability === 'degraded') {
  process.stderr.write(
    `\n⚠️  ${dropped.length}/${results.length} 条超时被剔出分母（>20%）——这份结果标记为 degraded，\n` +
      `   不要拿它跨版本对比：分母都不一样。\n`,
  );
}

console.log(JSON.stringify({ summary, results }, null, 2));
if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, `${JSON.stringify({ summary, results }, null, 2)}\n`);
  process.stderr.write(`\n结果已写入 ${JSON_OUT}\n`);
}
process.stderr.write(
  `\n${skillName}: accuracy ${summary.accuracy} | precision ${summary.precision} | recall ${summary.recall}` +
    ` (TP ${tp} FP ${fp} FN ${fn} TN ${tn})\n`,
);
