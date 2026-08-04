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
// 每条 query 要等一次完整的 claude -p 往返（实测约 1.3 分钟）。串行跑 235 条要 5 小时，
// 而这些调用彼此独立、各自在自己的临时项目里判定，没有任何共享状态需要串起来。并发不增加
// 总调用数（配额消耗不变），只是把墙钟时间压成 1/N。默认 4：够快，又不至于把限流打出来。
const CONCURRENCY = Number(flag('concurrency', '4'));

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
 * 触发信号：Skill 工具**真实调用**时入参里的这一串。
 *
 * 曾经写成 `buf.includes(skillName)` —— 那是错的，而且错得非常隐蔽。claude 启动时会把可用
 * 命令列表注入流里（`"slash_commands":["<skillName>", …]`），于是**每一条 query 的流里都有
 * skill 名**，无论它是否被调用。结果是 recall 1.000 / TN 0：235 条全判触发，包括 119 条
 * near-miss 负例。accuracy 0.494，等于"永远判触发"。
 *
 * 这和它取代的旧装置是同一个病的镜像 —— 那个永远判不触发，这个永远判触发，两者的 accuracy
 * 都在随机线附近，都看着像"description 有问题"。
 *
 * 实测对比（同一 skill，正例 vs 负例）：
 *   正例  {"type":"tool_use","name":"Skill","input":{"skill":"<name>"}}   ← 真调用
 *   负例  "slash_commands":["<name>", …]                                 ← 仅列表注入
 * 故锚定 `"skill":"<name>"`：它只出现在真实调用的入参里，不会出现在列表数组中。
 */
const TRIGGER_MARK = `"skill":"${skillName}"`;

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
      if (!triggered && buf.includes(TRIGGER_MARK)) triggered = true;
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
// **双向自检**：正例必须触发，负例必须不触发。两条都过才算装置可用。
//
// 上一版只跑正例。那只能证明"能触发"，证明不了"能区分" —— 于是检测逻辑的假阳性（把启动时
// 的可用命令列表当成调用）全程隐形，直到全量跑完看见 TN=0 才暴露，白烧一整轮。
//
// 一个只会说"是"的探针，和一个只会说"否"的探针，都不是探针。
const posCanary = queries.find((q) => q.should_trigger === true);
const negCanary = queries.find((q) => q.should_trigger === false);
if (!posCanary || !negCanary) {
  console.error('eval-trigger: 语料需同时含 should_trigger 的正例与负例才能双向自检');
  process.exit(1);
}
let posOk;
let negOk;
try {
  process.stderr.write(`[self-check +] ${posCanary.query.slice(0, 44)}…\n`);
  posOk = await didTrigger(posCanary.query);
  process.stderr.write(`[self-check -] ${negCanary.query.slice(0, 44)}…\n`);
  negOk = !(await didTrigger(negCanary.query));
} catch (e) {
  console.error(`eval-trigger: ABORT — 装置自检时调用失败：${e.message}`);
  process.exit(1);
}
if (!posOk || !negOk) {
  console.error(
    `eval-trigger: ABORT — 双向自检未通过（正例触发=${posOk} 负例拒绝=${negOk}）。\n` +
      (!posOk
        ? '  正例不触发：装置或 description 坏了一个。\n'
        : '  负例也触发：检测逻辑有假阳性，跑下去只会得到一份"全触发"的假报告。\n') +
      '  先查清再跑全量——这一步存在的全部理由，就是别让整轮配额烧在假数据上。',
  );
  process.exit(1);
}
process.stderr.write('[self-check] OK —— 正例触发、负例拒绝，装置能区分，进入全量\n\n');

// ── 全量 ────────────────────────────────────────────────────────────────────────────────────
/** 判定一条 query（含其 RUNS 次重复）。装置级失败向上抛，整批中止。 */
async function judge(q) {
  let hits = 0;
  let ok = 0;
  let errs = 0;
  for (let r = 0; r < RUNS; r += 1) {
    const res = await runQuery(q.query);
    if (res.error) errs += 1;
    else {
      ok += 1;
      hits += res.triggered ? 1 : 0;
    }
  }
  // 全部 run 都超时 → 没有可用观测，剔出分母而不是猜一个值
  if (ok === 0) {
    return { query: q.query, should_trigger: q.should_trigger === true, error: 'timeout', counted: false };
  }
  const rate = hits / ok;
  const predicted = rate >= 0.5;
  return {
    query: q.query,
    should_trigger: q.should_trigger === true,
    trigger_rate: rate,
    predicted,
    pass: predicted === (q.should_trigger === true),
    counted: true,
    ...(errs ? { partial_timeouts: errs } : {}),
  };
}

// 固定大小的并发池，按原序回填结果（顺序稳定，diff 才可读）。
const results = new Array(queries.length);
let cursor = 0;
let done = 0;
async function worker() {
  for (;;) {
    const i = cursor;
    cursor += 1;
    if (i >= queries.length) return;
    const r = await judge(queries[i]); // 抛出即整批中止（装置级）
    results[i] = r;
    done += 1;
    const tag = r.counted ? (r.predicted ? '触发  ' : '未触发') : '超时剔除';
    process.stderr.write(
      `[${String(done).padStart(3)}/${queries.length}] ${tag} ` +
        `(期望 ${r.should_trigger ? '触发' : '未触发'}) ${r.query.slice(0, 34)}…\n`,
    );
  }
}
process.stderr.write(`[并发 ${CONCURRENCY}] 开跑 ${queries.length} 条 × ${RUNS} run\n`);
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queries.length) }, worker));

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
