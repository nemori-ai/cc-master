// help-budget.test.ts — `--help` 的**预算闸**。
//
// 由来（design_docs/disposition-ledger/output-contract-and-help-budget.md 裁决一）：
//   命令语义（行为 / 边界 / 幂等 / 落盘路径）要写进 `--help`，有人担心 help 膨胀、提议学 Unix 做
//   `--help`（简）+ `man`（详）两层。该提议**已被否决**——分层要付第二套命令面 + 第二套内容槽 + 双份
//   撰写维护，而它想解决的量级（一条 help 一两百 token，且只在真调用时付）与对照物（skill 侧命令目录
//   约 47,000 token 且常驻）差着数量级。
//
//   裁决同时定了替代物：**预算闸**。本文件就是它。它不是装饰——它是「不分层」这个决定的唯一牙齿：
//   没有它，那个决定只是一句话，help 会一次几十 token 地悄悄涨回分层想解决的规模。
//
// 口径：token 估算沿用本仓既有的确定性估算器（scripts/skill-knowledge/hash.mjs 的 estimateBudget v1）——
//   `Math.ceil(utf8_bytes / 3)`，换行先归一化成 LF。这里**不 import 仓库根的 scripts**（跨包边界·ccm 是
//   独立产品），照抄同一口径的小函数，见 estimateTokens。它是一把刻度稳定的尺，不是真 tokenizer；
//   中文密集文本下它偏保守（高估），正合预算闸的用途。
//
// 只闸 verb 层，理由见 MAX_VERB_HELP_TOKENS 注释。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as help from '../src/help.js';
import * as registry from '../src/registry.js';

// ── 预算 ──────────────────────────────────────────────────────────────────────────────────────────
//
// 为什么是 700：
//   · 立闸时实测 146 个 verb —— min 59 / 中位 156 / p90 274 / max 610（`ccm goal deadline`）。
//   · 待迁入的语义段（行为 / 边界 / 幂等 / 落盘路径）按 `calibration capture` 实测约 +80 token。
//   · 最坏命令迁完约 690。700 = 恰好容下这次**已获批准**的迁移在当前最坏命令上的落点，不多留。
//
// 也就是说这条线**没有富余**：迁移一结束，`goal deadline` 就贴着线走，任何再往它里塞长篇的人当场红。
//   这是有意的。一个宽到永远不会红的阈值等于没做这道闸——那正是本文件要替代的东西。
//   迁移收尾后按新实测**收紧**（裁决原话），别反向抬。
//
// 为什么只闸 verb 层，不闸 root / noun 层：
//   root 与 noun 层的正文是从各 verb 的 summary 与 namespace blurb 机械聚合出来的，长篇散文进不去；
//   它们的增长几乎只来自「命令变多」这种正当增长。给正当增长设闸，只会训练出「红了就抬数字」的习惯，
//   而那正是预算闸失效的方式。散文膨胀第一个落在 verb 层，闸就设在它落地的地方。
//   （立闸时实测：root 1181 token；noun 层 min 96 / 中位 186 / max 727〔`ccm task`〕。）
const MAX_VERB_HELP_TOKENS = 700;

// estimateBudget v1 同口径（scripts/skill-knowledge/hash.mjs）：LF 归一化后 ceil(utf8_bytes / 3)。
function estimateTokens(text: string): number {
  const normalized = text.replace(/\r\n/g, '\n');
  return Math.ceil(Buffer.byteLength(normalized, 'utf8') / 3);
}

// 捕获 printHelp 的 out 写。
function renderHelp(noun?: string, verb?: string): string {
  const buf: string[] = [];
  help.printHelp((s: string) => buf.push(s), registry, noun, verb);
  return buf.join('\n');
}

// 枚举全部 (noun, verb)。
function allVerbs(): [string, string][] {
  const pairs: [string, string][] = [];
  for (const noun of Object.keys(registry.REGISTRY)) {
    const nounSpec = registry.REGISTRY[noun];
    if (!nounSpec) continue;
    for (const verb of Object.keys(nounSpec)) pairs.push([noun, verb]);
  }
  return pairs;
}

// ── 闸本体 ────────────────────────────────────────────────────────────────────────────────────────
test(`每条命令的 --help 不超过 ${MAX_VERB_HELP_TOKENS} token（预算闸·替代 --help/man 分层）`, () => {
  const over: string[] = [];
  for (const [noun, verb] of allVerbs()) {
    const tokens = estimateTokens(renderHelp(noun, verb));
    if (tokens > MAX_VERB_HELP_TOKENS) over.push(`ccm ${noun} ${verb}: ${tokens} token`);
  }
  assert.deepEqual(
    over,
    [],
    `以下命令的 --help 超出 ${MAX_VERB_HELP_TOKENS} token 预算：\n  ${over.join('\n  ')}\n` +
      '预算闸替代的是「--help 简 / man 详」分层这个被否决的架构方案，所以它必须真的会红。\n' +
      '正确的处置是把超长内容收回 summary / options / examples 的本分，或把它挪去 using-ccm 技术文档——\n' +
      '不是抬高这里的数字。',
  );
});

// 闸的前提：真的枚举到了命令。registry 若被重构成别的形状而这里静默扫出 0 条，闸就空转了。
test('预算闸确实覆盖了全部命令（防空转）', () => {
  const pairs = allVerbs();
  assert.ok(pairs.length >= 100, `应枚举到全部子命令，实际只有 ${pairs.length} 条`);
  for (const [noun, verb] of pairs) {
    assert.ok(estimateTokens(renderHelp(noun, verb)) > 0, `ccm ${noun} ${verb} 渲染出空 help`);
  }
});
