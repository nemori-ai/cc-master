#!/usr/bin/env node
// exam-closed-book.mjs — 闭卷考试：不给 skill、不给网、不给本地文档，看模型自己知道多少。
//
// 用途：汰换台账的第一层筛子。协议见
//   design_docs/disposition-ledger/exam-first-funnel.md
//
// ── 三条从 Track A 装置（scripts/eval-trigger.mjs）继承的教训 ────────────────────────────
//
// 1. **claude 要解引用到稳定真实路径。** fnm 装的 claude 在 PATH 上指向
//    /run/user/<uid>/fnm_multishells/<pid>_<ts>/bin/claude —— 跟创建它的 shell 绑定的临时
//    目录。一轮考试跑几分钟，那个 shell 若已退出，路径就塌了，每题 ENOENT。
//
// 2. **spawn 失败即硬失败，单题超时只剔出分母。** 判据是「这次失败有没有污染别的题」：
//    进程起不来 = 装置坏了、整批分母都脏 → 抛；单题超时 = 只有这题慢 → 剔除、继续。
//    准确率永远相对 counted 而非 total。
//
// 3. **不 Warning 然后继续。** 吞掉错误再吐一份格式完整的报告，是给假数据，比不给更糟。
//
// ── 本装置特有的一条：隔离必须真隔离，而「换个目录」根本不算隔离 ──────────────────
//
// 初版只做了「在仓库外的空临时目录里跑」。**实测当场破功**：探针问「你能找到 cc-master
// 这个仓库吗？它的 AGENTS.md 第一行是什么」，模型从空目录出发，自己走到
// /data/qiwei/repos/cc-master 把文件读了，答案逐字正确（第一行 `---`、108576 字节）。
//
// 教训：**模型有文件系统工具，cwd 限制不住它。** 换目录只挡住了「顺手 grep」，挡不住
// 「主动去找」。而这种破功是无声的——它照样答得出，你还以为它本来就知道，于是把一条
// 其实该留的知识判成了冗余。
//
// 真隔离靠 `--tools ""`：禁掉全部内置工具，它只能用自己脑子里的东西回答。
// 空目录仍然保留（第二道防线，且让 cwd 里没有任何可读的东西），但不再是主要手段。
//
// 用法：
//   node scripts/exam-closed-book.mjs --questions <path.json> --out <path.json>
//
// questions.json 形如：
//   [{ "point_id": "...", "question": "...", "timeout_ms": 180000 }]

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function flag(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function resolveClaude() {
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    const c = path.join(d, 'claude');
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return fs.realpathSync(c); // 见头部第 1 条
    } catch {
      /* keep looking */
    }
  }
  return null;
}

const CLAUDE = resolveClaude();
if (!CLAUDE) {
  console.error('exam: claude 不在 PATH 上——闭卷考试需要 claude CLI');
  process.exit(1);
}

const QUESTIONS = flag('questions');
const OUT = flag('out');
if (!QUESTIONS || !OUT) {
  console.error('用法: node scripts/exam-closed-book.mjs --questions <in.json> --out <out.json>');
  process.exit(1);
}

const REPO = fs.realpathSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..'));

/** 在一个仓库外的空目录里跑一题。 */
function ask(question, timeoutMs) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-exam-'));
    // 隔离的硬检查：临时目录若落在仓库内（例如 TMPDIR 被指到仓库里），当场拒跑。
    // 静默地在仓库里开卷，比考砸严重得多。
    if (fs.realpathSync(dir).startsWith(`${REPO}${path.sep}`)) {
      reject(new Error(`exam: 临时目录落在仓库内（${dir}），闭卷条件不成立——检查 TMPDIR`));
      return;
    }
    const env = { ...process.env };
    delete env.CLAUDECODE; // 允许在 Claude Code 会话内嵌套
    // --tools "" 禁掉全部内置工具（含 Read/Bash/WebSearch）。这是闭卷的**主要**手段；
    // 空 cwd 只是第二道防线。见头部说明——只靠换目录已实测破功。
    const child = spawn(CLAUDE, ['--tools', '', '-p', question], {
      cwd: dir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (c) => {
      out += c.toString('utf8');
    });
    child.stderr.on('data', (c) => {
      err += c.toString('utf8');
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      fs.rmSync(dir, { recursive: true, force: true });
      reject(e); // 装置级：见头部第 2 条
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      fs.rmSync(dir, { recursive: true, force: true });
      if (timedOut) return resolve({ status: 'timeout', answer: null });
      if (code !== 0) return resolve({ status: 'error', answer: null, stderr: err.slice(0, 400) });
      const answer = out.trim();
      // ── 退出码 0 不等于答了题 ────────────────────────────────────────────────────────
      //
      // `--tools ""` 之下模型有时会**幻觉出一次工具调用**然后停住：吐一句「我先扫一眼仓库」
      // 或一段假的 `**Tool Use: Bash**` JSON，就结束了。进程退 0、stdout 非空，装置照记
      // `ok`——而里面根本没有答案。实测命中率约 9%（114 份里 10 份）。
      //
      // 这类产物比掉出**更危险**：掉出会进 dropped 计数、看得见；这个混进 counted，评分时
      // 变成一个凭空捏造的「模型不知道」。方向上偏保守（把会的判成不会），但仍是假数据，
      // 而假数据会驱动错误决策。
      //
      // 判据取两条形态特征，不用长度阈值——长度会把真正简短的正确回答误杀。
      const looksLikeToolAttempt =
        /(\*\*Tool Use|<\/?(function_calls|invoke|antml)|\*\(checking|我先(看|瞅|扫)一眼|我先看看)/.test(
          answer,
        ) && answer.length < 400;
      if (!answer || looksLikeToolAttempt) {
        return resolve({ status: 'no-answer', answer, reason: 'tool-attempt-or-empty' });
      }
      resolve({ status: 'ok', answer });
    });
  });
}

const questions = JSON.parse(fs.readFileSync(QUESTIONS, 'utf8'));
const results = [];
let counted = 0;
let dropped = 0;

for (const [i, q] of questions.entries()) {
  process.stderr.write(`[${i + 1}/${questions.length}] ${q.point_id} … `);
  // no-answer 自动重试：这类失败是随机的（同一题再问一次通常就正常答了），不像 timeout
  // 那样反映题本身慢。最多三次，之后计入 dropped 而**绝不**当 ok 混进分母。
  let r = await ask(q.question, q.timeout_ms ?? 240_000);
  for (let attempt = 2; r.status === 'no-answer' && attempt <= 3; attempt++) {
    process.stderr.write(`no-answer,重试 ${attempt}/3 … `);
    r = await ask(q.question, q.timeout_ms ?? 240_000);
  }
  if (r.status === 'ok') counted += 1;
  else dropped += 1;
  process.stderr.write(`${r.status}${r.answer ? ` (${r.answer.length} 字)` : ''}\n`);
  results.push({ point_id: q.point_id, question: q.question, ...r });
}

// 掉出率 >20% 时标 degraded：分母都不一样了,那种数字跨版本比会骗人。
const degraded = dropped / questions.length > 0.2;
fs.writeFileSync(
  OUT,
  `${JSON.stringify(
    { total: questions.length, counted, dropped, degraded, results },
    null,
    2,
  )}\n`,
);
console.error(`\n写入 ${OUT}：counted=${counted} dropped=${dropped}${degraded ? ' ⚠degraded' : ''}`);
if (degraded) process.exitCode = 1;
