// prng.ts — seeded 确定性 PRNG（hand-roll sfc32·ADR-015 §2.4 / plan §7）。
//
// 为什么 sfc32：纯 Number uint32 运算（无 BigInt·快），通过 BigCrush + PractRand 全套统计检验，
//   状态小（128 bit·4×uint32）、周期长、初始化简。**plan §7 明确警示：xorshift128+ 系统性 fail
//   TestU01 的 MatrixRank/LinearComp，勿用**——故选 sfc32。
//
// 红线1 / ADR-006：node/JS only，零 npm dep，纯 stdlib。
// 确定性纪律（plan §7）：绝不 Math.random()；每个 MonteCarlo 入口新建独立 PRNG（new Sfc32(seed)），
//   同 seed → 同序列（golden 测试可复现）。所有 >>> 0 强制成 uint32（JS 位运算把操作数当 int32，
//   >>>0 还原成无符号 32 位语义，sfc32 的算术全在 uint32 域）。

// hashSeed(seed) → 把任意整数 seed 散列成 4 个 uint32 种子（sfc32 的 4-word 初态）。
//   用 splitmix32 风格的雪崩混合，让相邻 seed（42 / 43）也产生差异极大的初态，避免低位相关性。
function splitmix32(a: number): () => number {
  let s = a >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

// Sfc32 —— Small Fast Counting PRNG（Pratt 2010·bryc/Vigna 实现口径）。
//   状态 a/b/c/d 四个 uint32；next() 输出 [0,1) 的 double（>>>0 后 / 2^32）。
export class Sfc32 {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    // seed 经 splitmix32 雪崩成 4 word 初态（避免直接把 seed 塞进单 word 留低位相关）。
    const sm = splitmix32(Number.isFinite(seed) ? seed >>> 0 : 0);
    this.a = sm();
    this.b = sm();
    this.c = sm();
    this.d = sm();
    // 预热若干步，让初态充分扩散（标准做法·消除 seed 结构残留）。
    for (let i = 0; i < 12; i++) this.next();
  }

  // next() → [0,1) 均匀分布 double。核心 sfc32 递推（逐字 bryc 口径）。
  next(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) >>> 0;
    t = (t + this.d) >>> 0;
    this.c = (this.c + t) >>> 0;
    return (t >>> 0) / 4294967296;
  }

  // nextInt(n) → [0,n) 的整数（n>0）。直接缩放（n 远小于 2^32 时偏差可忽略·MC 抽样足够）。
  nextInt(n: number): number {
    return Math.floor(this.next() * n);
  }
}

// makePrng(seed) → 一个 next():number 函数（轻量句柄·给只需 [0,1) 流的调用方）。
export function makePrng(seed: number): () => number {
  const g = new Sfc32(seed);
  return () => g.next();
}
