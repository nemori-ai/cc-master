// suggest.ts — did-you-mean 候选（Damerau-Levenshtein 距离·纯函数·契约 §三 suggest.js / §一妥协）。
//
// 定位：零依赖复刻 commander 的 `suggestSimilar`——用户/agent 敲错 noun/verb 时，router 用它给「你是不是想敲 …」。
//   Damerau-Levenshtein（带相邻换位 transposition）比纯 Levenshtein 更贴合真实打字错（'baord'↔'board' 一步换位）。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib（无 import）。纯函数·零 IO·无副作用。
// 武装闸豁免：纯 helper 库（无 hook 入口，只被 CLI / router import）——见 AGENTS.md §3 红线6 / §12 grep 门豁免。
//
// T2a port 注：原 CJS 源（suggest.js）的 module.exports 换成命名导出；逻辑/阈值/正则逐字保持。

// 阈值（对齐 commander suggestSimilar 的语义）：
//   · MAX_DISTANCE：绝对距离上限，超过即不视为「相近」。
//   · REL_THRESHOLD：相对长度阈值——距离须 ≤ max(input,cand) 长度 * 比例，避免短词被远距离误判为相近。
const MAX_DISTANCE = 3;
const REL_THRESHOLD = 0.4;

// damerauLevenshtein(a, b) → 编辑距离（增/删/改 + 相邻换位）。经典 DP 二维表（O(len(a)·len(b))，候选短·够用）。
export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  // d[i][j] = a[0..i) → b[0..j) 的距离。多开一行一列放空串边界。
  // 注（T2a port·noUncheckedIndexedAccess）：DP 表所有索引由循环结构保证在界内，逐处 `as number`
  //   窄断言（与 @ccm/engine board-graph-core 同约定），不改算法逻辑。
  const d: number[][] = [];
  for (let i = 0; i <= la; i++) {
    d[i] = new Array(lb + 1).fill(0);
    (d[i] as number[])[0] = i;
  }
  const d0 = d[0] as number[];
  for (let j = 0; j <= lb; j++) d0[j] = j;

  for (let i = 1; i <= la; i++) {
    const di = d[i] as number[];
    const dim1 = d[i - 1] as number[];
    const dim2 = i > 1 ? (d[i - 2] as number[]) : undefined;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(
        (dim1[j] as number) + 1, // 删
        (di[j - 1] as number) + 1, // 增
        (dim1[j - 1] as number) + cost, // 改/相同
      );
      // 相邻换位（Damerau）：a[i-1]==b[j-2] 且 a[i-2]==b[j-1] → 一步换位。
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, ((dim2 as number[])[j - 2] as number) + 1);
      }
      di[j] = v;
    }
  }
  return (d[la] as number[])[lb] as number;
}

// suggestSimilar(input, candidates) → string[]
//   返回与 input「相近」的若干 candidate，按距离升序（同距离保留候选原相对序·稳定）。
//   筛选：距离 ≤ MAX_DISTANCE 且 ≤ max(len(input),len(cand)) * REL_THRESHOLD（向上取整以容短词一步错）。
//   input 为空 / candidates 空 → []。完全无关输入 → []（无候选过阈）。
export function suggestSimilar(input: unknown, candidates: unknown): string[] {
  if (typeof input !== 'string' || input === '') return [];
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const scored: { cand: string; dist: number; idx: number }[] = [];
  for (let idx = 0; idx < candidates.length; idx++) {
    const cand = candidates[idx];
    if (typeof cand !== 'string' || cand === '') continue;
    const dist = damerauLevenshtein(input, cand);
    if (dist === 0) {
      // 精确命中：直接当唯一最佳候选返回（避免把自身淹没在近邻里）。
      return [cand];
    }
    const maxLen = Math.max(input.length, cand.length);
    const relCap = Math.ceil(maxLen * REL_THRESHOLD);
    if (dist <= MAX_DISTANCE && dist <= relCap) {
      scored.push({ cand, dist, idx });
    }
  }

  // 按距离升序，同距离按原序（稳定）。
  scored.sort((x, y) => x.dist - y.dist || x.idx - y.idx);
  return scored.map((s) => s.cand);
}
