// prng.mjs — seeded 确定性 PRNG（sfc32）。
//
// 从 ccm/packages/engine/src/estimate/prng.ts 逐字移植（零算法改动·仅 TS→ESM .mjs）。
// D3B 移植回引擎时直接复用现成 prng.ts，无需改动——此文件只为 spike 自包含运行。
//
// 为什么 sfc32：纯 uint32 运算（无 BigInt·快）、通过 BigCrush+PractRand、状态 128bit、周期长。
// 确定性纪律：绝不 Math.random()；同 seed → 同序列（golden 可复现）。

function splitmix32(a) {
  let s = a >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export class Sfc32 {
  constructor(seed) {
    const sm = splitmix32(Number.isFinite(seed) ? seed >>> 0 : 0);
    this.a = sm();
    this.b = sm();
    this.c = sm();
    this.d = sm();
    for (let i = 0; i < 12; i++) this.next();
  }

  next() {
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

  nextInt(n) {
    return Math.floor(this.next() * n);
  }
}

export function makePrng(seed) {
  const g = new Sfc32(seed);
  return () => g.next();
}
